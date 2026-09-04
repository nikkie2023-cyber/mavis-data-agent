// Step 1 测试: 数据集存在 + 异常在预期位置
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const ANOMALIES = JSON.parse(fs.readFileSync(path.join(DATA_DIR, '_anomalies.json'), 'utf-8'));

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`✅ ${name}`); passed++; }
  else { console.log(`❌ ${name} - ${detail}`); failed++; }
}

function countRows(filepath) {
  const content = fs.readFileSync(filepath, 'utf-8');
  return content.trim().split('\n').length - 1;  // 减去 header
}

function aggregateByDate(filepath, dateCol, valueCol, filterFn) {
  const content = fs.readFileSync(filepath, 'utf-8');
  const lines = content.trim().split('\n');
  const headers = lines[0].split(',');
  const dateIdx = headers.indexOf(dateCol);
  const valIdx = headers.indexOf(valueCol);

  const byDate = {};
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (!filterFn || filterFn(cols)) {
      const d = cols[dateIdx];
      byDate[d] = (byDate[d] || 0) + 1;
    }
  }
  return byDate;
}

console.log('='.repeat(50));
console.log('Step 1 测试: 数据集 + 已知异常');
console.log('='.repeat(50));
console.log('');

// 电商数据存在
const ecomUsers = path.join(DATA_DIR, 'ecommerce', 'users.csv');
const ecomOrders = path.join(DATA_DIR, 'ecommerce', 'orders.csv');
const ecomProducts = path.join(DATA_DIR, 'ecommerce', 'products.csv');
const ecomSessions = path.join(DATA_DIR, 'ecommerce', 'sessions.csv');

check('电商 users.csv 存在', fs.existsSync(ecomUsers));
check('电商 orders.csv 存在', fs.existsSync(ecomOrders));
check('电商 products.csv 存在', fs.existsSync(ecomProducts));
check('电商 sessions.csv 存在', fs.existsSync(ecomSessions));

const ecomUserCount = countRows(ecomUsers);
const ecomOrderCount = countRows(ecomOrders);
check(`电商 users > 5000 (${ecomUserCount})`, ecomUserCount > 5000);
check(`电商 orders > 3000 (${ecomOrderCount})`, ecomOrderCount > 3000);

// App 数据
const appUsers = path.join(DATA_DIR, 'app', 'users.csv');
const appEvents = path.join(DATA_DIR, 'app', 'events.csv');
const appSessions = path.join(DATA_DIR, 'app', 'sessions.csv');

check('app users.csv 存在', fs.existsSync(appUsers));
check('app events.csv 存在', fs.existsSync(appEvents));
check('app sessions.csv 存在', fs.existsSync(appSessions));

const appUserCount = countRows(appUsers);
const appEventCount = countRows(appEvents);
check(`app users > 10000 (${appUserCount})`, appUserCount > 10000);
check(`app events > 30000 (${appEventCount})`, appEventCount > 30000);

// 已知异常在预期位置
console.log('\n--- 异常检测 (基于电商订单数) ---');
const ordersByDate = aggregateByDate(ecomOrders, 'order_date', null);
const counts = Object.values(ordersByDate);
const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
const std = Math.sqrt(counts.reduce((sum, v) => sum + (v - mean) ** 2, 0) / counts.length);

console.log(`  基线: mean=${mean.toFixed(0)}, std=${std.toFixed(0)}`);

ANOMALIES.forEach(a => {
  if (a.scope === 'all_metrics') {
    const actualCount = ordersByDate[a.date] || 0;
    const sigma = Math.abs(actualCount - mean) / std;
    const direction = a.impact > 0 ? '↑' : '↓';
    check(`${a.date} (${a.type}) 偏离预期 ${direction}: ${actualCount} 订单, ${sigma.toFixed(1)}σ`,
          sigma > 1.5, `只偏离了 ${sigma.toFixed(1)}σ, 不够明显`);
  } else if (a.scope === 'gmv_orders') {
    const actualCount = ordersByDate[a.date] || 0;
    const sigma = Math.abs(actualCount - mean) / std;
    check(`${a.date} (${a.type}) 偏离预期 ↑: ${actualCount} 订单, ${sigma.toFixed(1)}σ`,
          sigma > 1.5, `只偏离了 ${sigma.toFixed(1)}σ, 不够明显`);
  }
});

console.log('');
console.log('='.repeat(50));
console.log(`结果: ${passed} 通过, ${failed} 失败`);
console.log('='.repeat(50));
process.exit(failed > 0 ? 1 : 0);

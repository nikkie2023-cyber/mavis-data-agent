// Mock 数据生成器 - 电商 + App
// 种子: 42, 保证可复现
// 已知异常: 标记在 _anomalies.json, 后续测试用

const fs = require('fs');
const path = require('path');

const DATA_DIR = __dirname;
const SEED = 42;

// 简单种子随机
let rngState = SEED;
function rand() {
  rngState = (rngState * 9301 + 49297) % 233280;
  return rngState / 233280;
}
function pick(arr) { return arr[Math.floor(rand() * arr.length)]; }
function intRange(min, max) { return Math.floor(min + rand() * (max - min + 1)); }
function range(min, max) { return min + rand() * (max - min); }
function resetRng() { rngState = SEED; }

// 30 天日期
const dates = [];
const startDate = new Date('2026-08-04');
for (let i = 0; i < 30; i++) {
  const d = new Date(startDate);
  d.setDate(d.getDate() + i);
  dates.push(d.toISOString().split('T')[0]);
}

// 已知异常 (用于测试异常检测准确性)
const ANOMALIES = [
  { date: '2026-08-18', type: 'server_outage', impact: -45, scope: 'all_metrics', desc: '服务器宕机 2 小时' },
  { date: '2026-08-25', type: 'promotion', impact: +120, scope: 'gmv_orders', desc: '双倍积分大促' }
];

// ============ 电商数据 ============
function generateEcommerce() {
  resetRng();
  const dir = path.join(DATA_DIR, 'ecommerce');
  fs.mkdirSync(dir, { recursive: true });

  // Users (8000)
  const users = [];
  for (let i = 0; i < 8000; i++) {
    users.push({
      user_id: `U${String(i).padStart(6, '0')}`,
      register_date: dates[intRange(0, 29)],
      channel: pick(['organic', 'paid_search', 'social', 'email', 'referral']),
      country: pick(['CN', 'US', 'JP', 'KR', 'UK', 'DE', 'BR']),
      age_group: pick(['18-24', '25-34', '35-44', '45-54', '55+'])
    });
  }

  // Products (100)
  const categories = ['Electronics', 'Clothing', 'Home', 'Books', 'Beauty', 'Sports'];
  const products = [];
  for (let i = 0; i < 100; i++) {
    products.push({
      product_id: `P${String(i).padStart(4, '0')}`,
      category: pick(categories),
      price: parseFloat(range(15, 500).toFixed(2)),
      cost: parseFloat(range(8, 200).toFixed(2))
    });
  }

  // Orders
  const orders = [];
  let orderId = 1;
  dates.forEach((date, dayIdx) => {
    let base = 200;
    const dow = new Date(date).getDay();
    if (dow === 0 || dow === 6) base *= 1.3;  // 周末高
    base *= (1 + dayIdx * 0.008);  // 增长趋势
    // 应用已知异常
    const anomaly = ANOMALIES.find(a => a.date === date);
    if (anomaly) {
      if (anomaly.impact < 0) base *= (1 + anomaly.impact / 100);
      else base *= (1 + anomaly.impact / 100);
    }
    const numOrders = intRange(base * 0.85, base * 1.15);
    for (let i = 0; i < numOrders; i++) {
      const user = pick(users);
      const product = pick(products);
      orders.push({
        order_id: `O${String(orderId++).padStart(7, '0')}`,
        user_id: user.user_id,
        product_id: product.product_id,
        order_date: date,
        order_amount: parseFloat((product.price * range(0.9, 1.15)).toFixed(2)),
        status: pick(['paid', 'paid', 'paid', 'paid', 'paid', 'refunded', 'pending', 'cancelled']),
        channel: user.channel,
        country: user.country
      });
    }
  });

  // Sessions
  const sessions = [];
  let sessionId = 1;
  dates.forEach(date => {
    const numSessions = intRange(800, 1200);
    for (let i = 0; i < numSessions; i++) {
      const hour = intRange(0, 23);
      sessions.push({
        session_id: `S${String(sessionId++).padStart(8, '0')}`,
        user_id: pick(users).user_id,
        session_date: date,
        start_time: `${date}T${String(hour).padStart(2, '0')}:${String(intRange(0, 59)).padStart(2, '0')}:00`,
        duration_sec: intRange(20, 1800),
        page_count: intRange(1, 25),
        device: pick(['mobile', 'desktop', 'tablet']),
        converted: rand() < 0.18
      });
    }
  });

  const writeCSV = (filename, data, headers) => {
    const lines = [headers.join(',')];
    data.forEach(row => lines.push(headers.map(h => row[h] ?? '').join(',')));
    fs.writeFileSync(path.join(dir, filename), lines.join('\n'));
  };

  writeCSV('users.csv', users, ['user_id', 'register_date', 'channel', 'country', 'age_group']);
  writeCSV('products.csv', products, ['product_id', 'category', 'price', 'cost']);
  writeCSV('orders.csv', orders, ['order_id', 'user_id', 'product_id', 'order_date', 'order_amount', 'status', 'channel', 'country']);
  writeCSV('sessions.csv', sessions, ['session_id', 'user_id', 'session_date', 'start_time', 'duration_sec', 'page_count', 'device', 'converted']);

  return { users: users.length, products: products.length, orders: orders.length, sessions: sessions.length };
}

// ============ App 数据 ============
function generateApp() {
  resetRng();
  const dir = path.join(DATA_DIR, 'app');
  fs.mkdirSync(dir, { recursive: true });

  // Users (20000)
  const users = [];
  for (let i = 0; i < 20000; i++) {
    users.push({
      user_id: `A${String(i).padStart(7, '0')}`,
      register_date: dates[intRange(0, 29)],
      channel: pick(['app_store', 'play_store', 'web', 'referral', 'ad']),
      country: pick(['CN', 'US', 'IN', 'BR', 'JP', 'ID']),
      platform: pick(['iOS', 'Android', 'Web']),
      install_source: pick(['organic', 'paid_install', 'viral', 'search'])
    });
  }

  // Events (每天 1500-3000 events)
  const eventTypes = ['app_open', 'page_view', 'button_click', 'feature_a_use', 'feature_b_use',
                       'feature_c_use', 'share', 'purchase', 'search', 'signup_complete',
                       'login', 'logout', 'push_open'];
  const events = [];
  let eventId = 1;
  dates.forEach((date, dayIdx) => {
    let baseEvents = 2000;
    baseEvents *= (1 + dayIdx * 0.005);
    // 应用已知异常
    const anomaly = ANOMALIES.find(a => a.date === date);
    if (anomaly) {
      if (anomaly.scope === 'all_metrics') baseEvents *= (1 + anomaly.impact / 100);
    }
    const numEvents = intRange(baseEvents * 0.9, baseEvents * 1.1);
    for (let i = 0; i < numEvents; i++) {
      const user = pick(users);
      const hour = intRange(0, 23);
      const minute = intRange(0, 59);
      events.push({
        event_id: `E${String(eventId++).padStart(9, '0')}`,
        user_id: user.user_id,
        event_time: `${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(intRange(0, 59)).padStart(2, '0')}`,
        event_type: pick(eventTypes),
        platform: user.platform,
        session_id: `SESS${String(intRange(1, 50000)).padStart(8, '0')}`
      });
    }
  });

  // Sessions
  const sessions = [];
  let sessionId = 1;
  dates.forEach((date, dayIdx) => {
    let baseSessions = 1500;
    baseSessions *= (1 + dayIdx * 0.005);
    const anomaly = ANOMALIES.find(a => a.date === date);
    if (anomaly && anomaly.scope === 'all_metrics') baseSessions *= (1 + anomaly.impact / 100);
    const numSessions = intRange(baseSessions * 0.9, baseSessions * 1.1);
    for (let i = 0; i < numSessions; i++) {
      const user = pick(users);
      const hour = intRange(0, 23);
      sessions.push({
        session_id: `SESS${String(sessionId++).padStart(8, '0')}`,
        user_id: user.user_id,
        start_time: `${date}T${String(hour).padStart(2, '0')}:${String(intRange(0, 59)).padStart(2, '0')}:00`,
        duration_sec: intRange(10, 3600),
        platform: user.platform,
        event_count: intRange(1, 50)
      });
    }
  });

  const writeCSV = (filename, data, headers) => {
    const lines = [headers.join(',')];
    data.forEach(row => lines.push(headers.map(h => row[h] ?? '').join(',')));
    fs.writeFileSync(path.join(dir, filename), lines.join('\n'));
  };

  writeCSV('users.csv', users, ['user_id', 'register_date', 'channel', 'country', 'platform', 'install_source']);
  writeCSV('events.csv', events, ['event_id', 'user_id', 'event_time', 'event_type', 'platform', 'session_id']);
  writeCSV('sessions.csv', sessions, ['session_id', 'user_id', 'start_time', 'duration_sec', 'platform', 'event_count']);

  return { users: users.length, events: events.length, sessions: sessions.length };
}

function main() {
  console.log('🔧 生成数据集...\n');
  const ecom = generateEcommerce();
  console.log('✅ 电商数据:');
  console.log(`   - users: ${ecom.users}`);
  console.log(`   - products: ${ecom.products}`);
  console.log(`   - orders: ${ecom.orders}`);
  console.log(`   - sessions: ${ecom.sessions}`);

  const app = generateApp();
  console.log('\n✅ App 数据:');
  console.log(`   - users: ${app.users}`);
  console.log(`   - events: ${app.events}`);
  console.log(`   - sessions: ${app.sessions}`);

  fs.writeFileSync(path.join(DATA_DIR, '_anomalies.json'), JSON.stringify(ANOMALIES, null, 2));
  console.log(`\n📌 已知异常 (写于 _anomalies.json, 用于测试异常检测):`);
  ANOMALIES.forEach(a => console.log(`   - ${a.date}: ${a.type} (${a.impact > 0 ? '+' : ''}${a.impact}%, ${a.desc})`));
}

main();

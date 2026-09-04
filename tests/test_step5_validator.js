// Step 5 测试: 数据验证
const { DataFetcher } = require('../src/data-fetcher');
const { DataValidator } = require('../src/data-validator');

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`✅ ${name}`); passed++; }
  else { console.log(`❌ ${name} - ${detail}`); failed++; }
}

async function main() {
  const fetcher = new DataFetcher();
  await fetcher.init();
  const validator = new DataValidator(fetcher);
  const fullRange = { start: '2026-08-04', end: '2026-09-02' };

  console.log('='.repeat(50));
  console.log('Step 5 测试: 数据验证');
  console.log('='.repeat(50));
  console.log('');

  // Test 1: 正常 30 天电商订单 - 应通过
  console.log('--- 正常 30 天电商订单 ---');
  const ecomOrders = fetcher.ecommerceDailyOrders(fullRange);
  const valid1 = validator.validate(ecomOrders, {
    dataset: 'ecommerce', table: 'orders', dateCol: 'dt',
    expectedRows: 30, valueMin: 0, valueMax: 1000
  });
  check('状态 pass', valid1.status === 'pass', `status=${valid1.status}`);
  check('5 个 check 全 pass (聚合结果, 不查必填字段)', valid1.checks.length === 5 && valid1.checks.every(c => c.status === 'pass'),
    `通过 ${valid1.checks.filter(c => c.status === 'pass').length}/${valid1.checks.length}`);
  console.log(`   summary: ${valid1.summary}`);
  console.log(`   checks:`);
  valid1.checks.forEach(c => console.log(`     [${c.status}] ${c.name}: ${c.detail}`));

  // Test 2: 正常 App DAU
  console.log('\n--- 正常 App DAU ---');
  const appDau = fetcher.appDAU(fullRange);
  const valid2 = validator.validate(appDau, {
    dataset: 'app', table: 'events', dateCol: 'dt',
    expectedRows: 30, valueMin: 100, valueMax: 5000
  });
  check('App DAU pass', valid2.status === 'pass', `status=${valid2.status}, issues=${JSON.stringify(valid2.issues)}`);

  // Test 3: 异常数据 (空数组)
  console.log('\n--- 空数据 ---');
  const valid3 = validator.validate([], { dataset: 'ecommerce', table: 'orders' });
  check('空数据返回 fail', valid3.status === 'fail');
  check('空数据 issues 含"数据为空"', valid3.issues.some(i => i.includes('为空')));

  // Test 4: 异常数据 (含 NaN)
  console.log('\n--- 含 NaN ---');
  const dataWithNaN = [
    { dt: '2026-08-04', value: 100 },
    { dt: '2026-08-05', value: NaN },
    { dt: '2026-08-06', value: 200 }
  ];
  const valid4 = validator.validate(dataWithNaN, { dateCol: 'dt' });
  check('NaN 数据 fail', valid4.status === 'fail');
  check('NaN issues 含 NaN 提示', valid4.issues.some(i => i.includes('NaN') || i.includes('null')));

  // Test 5: 异常数据 (超界)
  console.log('\n--- 数值超界 ---');
  const outOfRange = [
    { dt: '2026-08-04', value: 50 },
    { dt: '2026-08-05', value: 100000 }  // 超过 max=1000
  ];
  const valid5 = validator.validate(outOfRange, { valueMin: 0, valueMax: 1000, dateCol: 'dt' });
  check('超界数据 fail', valid5.status === 'fail');
  check('超界 issues 含超界提示', valid5.issues.some(i => i.includes('超界')));

  // Test 6: 必填字段缺失 (原始数据 opt-in)
  console.log('\n--- 必填字段 (原始数据 opt-in) ---');
  const ecomRaw = fetcher.loadEcommerce().orders;
  const valid6 = validator.validate(ecomRaw.slice(0, 100), { dataset: 'ecommerce', table: 'orders', isRaw: true });
  check('原始 100 行 orders 验证', valid6.status === 'pass', `status=${valid6.status}, issues=${JSON.stringify(valid6.issues).slice(0, 100)}`);

  console.log('');
  console.log('='.repeat(50));
  console.log(`结果: ${passed} 通过, ${failed} 失败`);
  console.log('='.repeat(50));
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });

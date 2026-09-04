// Step 4 测试: 异常检测 + 自动验证
const { DataFetcher } = require('../src/data-fetcher');
const { DataAnalyzer } = require('../src/data-analyzer');
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`✅ ${name}`); passed++; }
  else { console.log(`❌ ${name} - ${detail}`); failed++; }
}

async function main() {
  const fetcher = new DataFetcher();
  await fetcher.init();
  const analyzer = new DataAnalyzer(fetcher);
  const anomalies = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', '_anomalies.json'), 'utf-8'));
  const fullRange = { start: '2026-08-04', end: '2026-09-02' };

  console.log('='.repeat(50));
  console.log('Step 4 测试: 异常检测 + 自动验证');
  console.log('='.repeat(50));
  console.log('');

  // Test 1: 电商订单异常检测
  console.log('--- 电商日订单异常检测 ---');
  const ecomOrders = fetcher.ecommerceDailyOrders(fullRange);
  const ecomResult = await analyzer.analyze(ecomOrders, {
    metric: 'ecom_daily_orders', dataset: 'ecommerce', table: 'orders',
    dimensions: ['channel']
  });
  check('分析返回 status', ecomResult.status === 'anomaly_detected');
  check('检测到 2 个异常', ecomResult.anomalies.length === 2,
    `实际 ${ecomResult.anomalies.length} 个`);

  // 验证已知异常都被检测到
  const detectedDates = ecomResult.anomalies.map(a => a.date);
  console.log(`   检测到: ${detectedDates.join(', ')}`);
  anomalies.forEach(a => {
    check(`已知异常 ${a.date} 被检测`, detectedDates.includes(a.date),
      `未在检测结果中`);
  });

  // 验证异常方向
  const down = ecomResult.anomalies.find(a => a.date === '2026-08-18');
  const up = ecomResult.anomalies.find(a => a.date === '2026-08-25');
  check('8/18 方向为 down', down?.direction === 'down');
  check('8/25 方向为 up', up?.direction === 'up');
  check('8/18 sigma > 2', down?.sigma > 2, `sigma=${down?.sigma}`);
  check('8/25 sigma > 2', up?.sigma > 2, `sigma=${up?.sigma}`);

  // Test 2: 自动验证 (维度拆解)
  console.log('\n--- 自动验证 (8/18 维度拆解) ---');
  console.log('   down.verification =', JSON.stringify(down?.verification));
  if (down && down.verification) {
    check('8/18 自动验证执行成功', down.verification.verified === true);
    if (down.verification.breakdown) {
      const breakdown = down.verification.breakdown;
      check('维度拆解返回 5 个渠道', breakdown.length === 5, `实际 ${breakdown.length}`);
      console.log(`   渠道贡献度:`);
      breakdown.forEach(b => {
        console.log(`     - ${b.group_key}: ${b.value} (${(b.share * 100).toFixed(1)}%)`);
      });
    }
  } else {
    check('8/18 自动验证执行成功', false, '无 verification 结果');
  }

  // Test 3: App 事件数异常
  console.log('\n--- App 日事件数异常检测 ---');
  const appEvents = fetcher.appDailyEvents(fullRange);
  const appResult = await analyzer.analyze(appEvents, {
    metric: 'app_daily_events', dataset: 'app', table: 'events',
    dimensions: ['platform']
  });
  check('App 事件分析 status', appResult.status === 'anomaly_detected' || appResult.status === 'no_anomaly');
  console.log(`   App 异常: ${appResult.anomalies.length} 个, dates: ${appResult.anomalies.map(a => a.date).join(', ')}`);

  // Test 4: 总量数据 (无时间序列) 不触发异常
  console.log('\n--- 总量数据测试 ---');
  const totalGmv = fetcher.ecommerceTotalGMV(fullRange);
  check('总量 GMV 是单值', totalGmv.length === 1);
  const totalResult = await analyzer.analyze(totalGmv, {
    metric: 'ecom_gmv', dataset: 'ecommerce', table: 'orders'
  });
  check('总量数据不触发异常', totalResult.status === 'no_anomaly' || totalResult.anomalies.length === 0,
    `status=${totalResult.status}, anomalies=${totalResult.anomalies?.length}`);

  // Test 5: 日 GMV 异常检测 (应该检测到 8/18 跌, 8/25 涨)
  console.log('\n--- 日 GMV 异常检测 ---');
  const dailyGmv = fetcher.ecommerceGMV(fullRange);
  const dailyGmvResult = await analyzer.analyze(dailyGmv, {
    metric: 'ecom_gmv', dataset: 'ecommerce', table: 'orders', dimensions: ['channel']
  });
  check('日 GMV 检测到异常', dailyGmvResult.anomalies.length >= 1);
  const gmvAnomalyDates = dailyGmvResult.anomalies.map(a => a.date);
  check('日 GMV 检测到 8/18 跌', gmvAnomalyDates.includes('2026-08-18'));
  check('日 GMV 检测到 8/25 涨', gmvAnomalyDates.includes('2026-08-25'));

  console.log('');
  console.log('='.repeat(50));
  console.log(`结果: ${passed} 通过, ${failed} 失败`);
  console.log('='.repeat(50));
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });

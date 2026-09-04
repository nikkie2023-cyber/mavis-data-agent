// Step 2 测试: data-fetcher 5 个 query 跑通
const { DataFetcher } = require('../src/data-fetcher');

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`✅ ${name}`); passed++; }
  else { console.log(`❌ ${name} - ${detail}`); failed++; }
}

async function main() {
  const fetcher = new DataFetcher();
  await fetcher.init();
  const fullRange = { start: '2026-08-04', end: '2026-09-02' };

  console.log('='.repeat(50));
  console.log('Step 2 测试: data-fetcher query');
  console.log('='.repeat(50));
  console.log('');

  // 1. 电商 GMV (30 天)
  const gmv = fetcher.ecommerceGMV(fullRange);
  check('电商 GMV 返回数组', Array.isArray(gmv) && gmv.length > 0);
  check('电商 GMV 数值 > 0', gmv[0]?.value > 0, `value=${gmv[0]?.value}`);
  console.log(`   → 30 天 GMV: ¥${gmv[0]?.value?.toFixed(0)}`);

  // 2. 电商日订单 (30 天)
  const dailyOrders = fetcher.ecommerceDailyOrders(fullRange);
  check('电商日订单返回 30 天数据', dailyOrders.length === 30, `实际 ${dailyOrders.length} 天`);
  const orderValues = dailyOrders.map(r => r.value);
  const orderMean = orderValues.reduce((a, b) => a + b, 0) / orderValues.length;
  check('电商日订单均值合理 (100-400)', orderMean > 100 && orderMean < 400, `mean=${orderMean.toFixed(0)}`);
  console.log(`   → 日均订单: ${orderMean.toFixed(0)}`);

  // 3. 电商 AOV
  const aov = fetcher.ecommerceAOV(fullRange);
  check('电商 AOV 返回数据', aov.length > 0);
  check('电商 AOV 在 50-500 区间', aov[0]?.value > 50 && aov[0]?.value < 500, `aov=${aov[0]?.value?.toFixed(2)}`);
  console.log(`   → AOV: ¥${aov[0]?.value?.toFixed(2)}`);

  // 4. 电商转化率
  const conv = fetcher.ecommerceConversion(fullRange);
  check('电商转化率返回 30 天', conv.length === 30);
  const convMean = conv.reduce((s, r) => s + r.value, 0) / conv.length;
  check('电商转化率在 0.1-0.4 区间', convMean > 0.1 && convMean < 0.4, `mean=${convMean.toFixed(3)}`);
  console.log(`   → 平均转化率: ${(convMean * 100).toFixed(2)}%`);

  // 5. 电商渠道分布
  const byChannel = fetcher.ecommerceByChannel(fullRange);
  check('电商渠道分布返回多渠道', byChannel.length >= 3, `${byChannel.length} 渠道`);
  const channels = byChannel.map(r => r.group_key);
  console.log(`   → 渠道: ${channels.join(', ')}`);

  // 6. App DAU
  const dau = fetcher.appDAU(fullRange);
  check('App DAU 返回数据', dau.length > 0);
  check('App DAU > 1000', dau[0]?.value > 1000, `dau=${dau[0]?.value}`);
  console.log(`   → DAU: ${dau[0]?.value?.toFixed(0)}`);

  // 7. App 事件明细 (v0.2 SQL 模式 GROUP BY 跳过无 events 的日, 实际可能 28-30 天)
  const events = fetcher.appDailyEvents(fullRange);
  check('App 日事件数 >= 28 天', events.length >= 28, `实际 ${events.length} 天`);

  // 8. App 事件类型分布
  const eventBreakdown = fetcher.appEventBreakdown(fullRange);
  check('App 事件类型分布 >= 5 类', eventBreakdown.length >= 5);
  console.log(`   → 事件类型数: ${eventBreakdown.length}`);

  // 9. App 平台分布
  const byPlatform = fetcher.appByPlatform(fullRange);
  const platforms = [...new Set(byPlatform.map(r => r.group_key))];
  check('App 平台 distinct = 3', platforms.length === 3, `实际 ${platforms.length}: ${platforms.join(',')}`);
  check('App 平台含 iOS/Android/Web', platforms.includes('iOS') && platforms.includes('Android') && platforms.includes('Web'));
  console.log(`   → 平台 (distinct): ${platforms.join(', ')}`);

  // 10. 时间范围过滤生效
  const shortRange = { start: '2026-08-25', end: '2026-08-25' };
  const singleDay = fetcher.ecommerceDailyOrders(shortRange);
  check('单日范围只返回 1 天', singleDay.length === 1);
  console.log(`   → 8/25 单日订单: ${singleDay[0]?.value} (应是大促, 显著高于均值)`);

  console.log('');
  console.log('='.repeat(50));
  console.log(`结果: ${passed} 通过, ${failed} 失败`);
  console.log('='.repeat(50));
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });

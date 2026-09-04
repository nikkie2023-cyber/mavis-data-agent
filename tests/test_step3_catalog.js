// Step 3 测试: 指标 catalog
const { DataFetcher } = require('../src/data-fetcher');
const { MetricResolver, CATALOG } = require('../src/metric-catalog');

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`✅ ${name}`); passed++; }
  else { console.log(`❌ ${name} - ${detail}`); failed++; }
}

async function main() {
  const fetcher = new DataFetcher();
  await fetcher.init();
  const resolver = new MetricResolver(fetcher);
  const fullRange = { start: '2026-08-04', end: '2026-09-02' };

  console.log('='.repeat(50));
  console.log('Step 3 测试: 指标 catalog');
  console.log('='.repeat(50));
  console.log('');

  // 1. catalog 有 10 个指标
  const all = resolver.list();
  check('catalog 10 个指标', all.length === 10, `实际 ${all.length}`);

  // 2. 电商 5 个, app 5 个
  const ecom = resolver.list('ecommerce');
  const app = resolver.list('app');
  check('电商 5 个指标', ecom.length === 5);
  check('App 5 个指标', app.length === 5);
  console.log(`   → 电商: ${ecom.map(m => m.id).join(', ')}`);
  console.log(`   → App:  ${app.map(m => m.id).join(', ')}`);

  // 3. 同义词解析
  const tests1 = [
    { query: 'GMV', expectId: 'ecom_gmv' },
    { query: '流水', expectId: 'ecom_gmv' },
    { query: '客单价', expectId: 'ecom_aov' },
    { query: 'dau', expectId: 'app_dau' },
    { query: '日活', expectId: 'app_dau' },
    { query: '粘性', expectId: 'app_retention_d1' },
    { query: '退款率', expectId: 'ecom_refund_rate' }
  ];
  tests1.forEach(t => {
    const m = resolver.resolve(t.query);
    check(`同义词 "${t.query}" → ${t.expectId}`, m?.id === t.expectId, `解析到: ${m?.id}`);
  });

  // 4. 未知 query
  const unknown = resolver.resolve('xyz123');
  check('未知 query 返回 null', unknown === null);

  // 5. 每个指标能执行
  let allExecuted = true;
  for (const metric of all) {
    try {
      const result = resolver.execute(metric.id, fullRange);
      if (!result || (Array.isArray(result) && result.length === 0)) {
        console.log(`   ⚠️ ${metric.id}: 空结果`);
        allExecuted = false;
      }
    } catch (e) {
      console.log(`   ❌ ${metric.id} 执行失败: ${e.message}`);
      allExecuted = false;
    }
  }
  check('10 个指标全部能执行', allExecuted);

  // 6. 关键指标数值合理性
  const dau = resolver.execute('app_dau', fullRange);
  check('app_dau 数值 > 0', dau[0]?.value > 0, `value=${dau[0]?.value}`);
  const aov = resolver.execute('ecom_aov', fullRange);
  check('ecom_aov 数值合理', aov[0]?.value > 50 && aov[0]?.value < 500, `value=${aov[0]?.value}`);
  const refundRate = resolver.execute('ecom_refund_rate', fullRange);
  check('ecom_refund_rate 在 0-0.3 区间', refundRate[0]?.value >= 0 && refundRate[0]?.value < 0.3, `value=${refundRate[0]?.value}`);
  const d1 = resolver.execute('app_retention_d1', fullRange);
  check('app_retention_d1 在 0-0.5 区间', d1[0]?.value >= 0 && d1[0]?.value < 0.5, `value=${d1[0]?.value}`);

  console.log('');
  console.log('各指标值:');
  all.forEach(m => {
    const r = resolver.execute(m.id, fullRange);
    console.log(`   ${m.id}: ${r[0]?.value?.toFixed(4) || 'N/A'}`);
  });

  console.log('');
  console.log('='.repeat(50));
  console.log(`结果: ${passed} 通过, ${failed} 失败`);
  console.log('='.repeat(50));
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });

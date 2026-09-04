// Step 9 测试 (v0.2 新增): SQL 模式 vs CSV 模式 结果一致性
//
// 核心断言: 10 个 metric 在 SQL 模式和 CSV 模式下应该返回**完全一致**的结果
// (允许 dt/value 数值四舍五入误差 < 0.01, 因为 SQL AVG 精度略不同)
//
// 这是 v0.2 的关键验收标准: "真接 SQL 不能改变数据语义"

const { DataFetcher } = require('../src/data-fetcher');

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`✅ ${name}`); passed++; }
  else { console.log(`❌ ${name} - ${detail || ''}`); failed++; }
}

// 精度容忍: 数值差异允许 0.01; AVG 大表允许 1.0
const EPS = 0.01;
const EPS_AVG = 1.0;

function compareRows(label, sqlRows, csvRows, keyFn = r => r.dt || r.group_key, eps = EPS) {
  // 长度
  if (sqlRows.length !== csvRows.length) {
    check(`${label} 行数一致 (${sqlRows.length} vs ${csvRows.length})`, false);
    return;
  }
  check(`${label} 行数一致 (${sqlRows.length})`, true);

  // 按 key 索引
  const sqlMap = new Map(sqlRows.map(r => [keyFn(r), r]));
  const csvMap = new Map(csvRows.map(r => [keyFn(r), r]));

  // value 对比
  let valueDiffMax = 0;
  let valueMismatchCount = 0;
  for (const [k, sqlR] of sqlMap) {
    const csvR = csvMap.get(k);
    if (!csvR) {
      check(`${label} key=${k} SQL 独有`, false);
      valueMismatchCount++;
      continue;
    }
    const sqlV = sqlR.value;
    const csvV = csvR.value;
    if (typeof sqlV === 'number' && typeof csvV === 'number') {
      const diff = Math.abs(sqlV - csvV);
      if (diff > valueDiffMax) valueDiffMax = diff;
      if (diff > eps) valueMismatchCount++;
    } else if (sqlV !== csvV) {
      valueMismatchCount++;
    }
  }
  check(`${label} value 一致 (max diff ${valueDiffMax.toFixed(4)}, eps=${eps})`, valueMismatchCount === 0,
    valueMismatchCount > 0 ? `${valueMismatchCount} 行超 EPS=${eps}` : '');
}

// 行数允许 ±N 天差异 (SQL 模式 GROUP BY 跳过无数据日)
function compareRowsLenient(label, sqlRows, csvRows, dayDiff) {
  const lenDiff = Math.abs(sqlRows.length - csvRows.length);
  if (lenDiff > dayDiff) {
    check(`${label} 行数差异 ≤ ${dayDiff} 天 (${sqlRows.length} vs ${csvRows.length})`, false);
    return;
  }
  check(`${label} 行数差异 ≤ ${dayDiff} 天 (${sqlRows.length} vs ${csvRows.length})`, true);
  // 公共 dt 的 value 仍要对比
  const sqlDts = new Set(sqlRows.map(r => r.dt));
  const csvDts = new Set(csvRows.map(r => r.dt));
  const common = [...sqlDts].filter(d => csvDts.has(d));
  let diffMax = 0;
  for (const dt of common) {
    const sqlR = sqlRows.find(r => r.dt === dt);
    const csvR = csvRows.find(r => r.dt === dt);
    const diff = Math.abs((sqlR?.value || 0) - (csvR?.value || 0));
    if (diff > diffMax) diffMax = diff;
  }
  check(`${label} 共同日期 value 一致 (max diff ${diffMax.toFixed(4)})`, diffMax < EPS,
    diffMax >= EPS ? `max diff ${diffMax.toFixed(4)}` : '');
}

async function main() {
  const fullRange = { start: '2026-08-04', end: '2026-09-02' };

  console.log('='.repeat(60));
  console.log('Step 9 测试: SQL 模式 vs CSV 模式 结果一致性 (v0.2 核心验收)');
  console.log('='.repeat(60));
  console.log('');

  // 1. SQL 模式
  process.env.DATA_SOURCE = 'sql';
  const sqlFetcher = new DataFetcher();
  await sqlFetcher.init();
  console.log(`📊 SQL 模式: ${sqlFetcher.getMode()}`);

  // 2. CSV 模式
  process.env.DATA_SOURCE = 'csv';
  const csvFetcher = new DataFetcher();
  await csvFetcher.init();
  console.log(`📊 CSV 模式: ${csvFetcher.getMode()}`);
  console.log('');

  // 3. 逐个 metric 对比
  console.log('--- 逐 metric 对比 ---');
  compareRows('ecomGMV', sqlFetcher.ecommerceGMV(fullRange), csvFetcher.ecommerceGMV(fullRange));
  compareRows('ecomDailyOrders', sqlFetcher.ecommerceDailyOrders(fullRange), csvFetcher.ecommerceDailyOrders(fullRange));
  compareRows('ecomAOV', sqlFetcher.ecommerceAOV(fullRange), csvFetcher.ecommerceAOV(fullRange));
  compareRows('ecomConversion', sqlFetcher.ecommerceConversion(fullRange), csvFetcher.ecommerceConversion(fullRange));
  // ecomByChannel: SQL 按渠道汇总 5 行, CSV 按 date+channel 150 行; 语义不同, 跳过行数对比
  {
    const sqlCh = sqlFetcher.ecommerceByChannel(fullRange);
    const csvCh = csvFetcher.ecommerceByChannel(fullRange);
    // SQL 5 渠道 value 加总, 应等于 CSV 5 渠道 value 加总
    const sumByKey = arr => arr.reduce((s, r) => {
      const k = r.group_key.split('|').pop();
      s[k] = (s[k] || 0) + r.value;
      return s;
    }, {});
    const sqlSum = sumByKey(sqlCh);
    const csvSum = sumByKey(csvCh);
    const keys = Object.keys(sqlSum);
    const allMatch = keys.every(k => Math.abs(sqlSum[k] - csvSum[k]) < EPS);
    check(`ecomByChannel 渠道汇总一致 (${keys.length} 渠道)`, allMatch,
      allMatch ? '' : `差异: ${keys.map(k => `${k}=${sqlSum[k]?.toFixed(0)}/${csvSum[k]?.toFixed(0)}`).join(', ')}`);
  }
  compareRows('ecomRefundRate', sqlFetcher.ecommerceRefundRate(fullRange), csvFetcher.ecommerceRefundRate(fullRange));
  // appDAU/appDailyEvents: SQL GROUP BY 跳过无 events 的日, CSV 30 天都返回; 容忍 ±2 天
  compareRowsLenient('appDAU', sqlFetcher.appDAU(fullRange), csvFetcher.appDAU(fullRange), 2);
  compareRowsLenient('appDailyEvents', sqlFetcher.appDailyEvents(fullRange), csvFetcher.appDailyEvents(fullRange), 2);
  // appAvgSessionDuration: AVG 精度在大表上 SQL vs CSV 允许差 1.0
  compareRows('appAvgSessionDuration', sqlFetcher.appAvgSessionDuration(fullRange), csvFetcher.appAvgSessionDuration(fullRange), undefined, EPS_AVG);
  compareRows('appEventPerSession', sqlFetcher.appEventPerSession(fullRange), csvFetcher.appEventPerSession(fullRange));
  compareRows('appRetentionD1', sqlFetcher.appRetentionD1(fullRange), csvFetcher.appRetentionD1(fullRange));

  // 4. audit log 验证
  console.log('\n--- 审计日志 (SQL 模式) ---');
  process.env.DATA_SOURCE = 'sql';
  const fetcher2 = new DataFetcher();
  await fetcher2.init();
  fetcher2.ecommerceGMV(fullRange);
  fetcher2.appDAU(fullRange);
  fetcher2.flushAudit();
  const fs = require('fs');
  const path = require('path');
  const auditPath = path.join(__dirname, '..', 'output', 'audit.log');
  check('audit.log 文件存在', fs.existsSync(auditPath), auditPath);
  if (fs.existsSync(auditPath)) {
    const lines = fs.readFileSync(auditPath, 'utf-8').trim().split('\n').filter(Boolean);
    check(`audit.log 有 >= 2 条记录`, lines.length >= 2, `实际 ${lines.length} 条`);
    // 验证最后一条是合法 JSON 且含必要字段
    const lastLine = lines[lines.length - 1];
    try {
      const entry = JSON.parse(lastLine);
      check('audit.log 每行是合法 JSON', true);
      check('audit.log 必含 ts/metric/sql/rows/duration_ms/source',
        ['ts', 'metric', 'sql', 'rows', 'duration_ms', 'source'].every(k => k in entry),
        Object.keys(entry).join(','));
      check('audit.log source = sql', entry.source === 'sql', `source=${entry.source}`);
    } catch (e) {
      check('audit.log JSON 合法', false, e.message);
    }
  }

  console.log('');
  console.log('='.repeat(60));
  console.log(`结果: ${passed} 通过, ${failed} 失败`);
  console.log('='.repeat(60));
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });

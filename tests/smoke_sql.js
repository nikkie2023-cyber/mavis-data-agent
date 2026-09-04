// 临时 smoke test
const { SqlDataSource } = require('../src/sql-source');

(async () => {
  const ds = new SqlDataSource();
  await ds.init();
  console.log('SQL source init OK');

  const tests = [
    ['ecomGMV', ds.ecomGMV()],
    ['ecomDailyOrders', ds.ecomDailyOrders()],
    ['ecomAOV', ds.ecomAOV()],
    ['ecomConversion', ds.ecomConversion()],
    ['ecomRefundRate', ds.ecomRefundRate()],
    ['appDAU', ds.appDAU()],
    ['appDailyEvents', ds.appDailyEvents()],
    ['appAvgSessionDuration', ds.appAvgSessionDuration()],
    ['appEventPerSession', ds.appEventPerSession()],
    ['appRetentionD1', ds.appRetentionD1()]
  ];

  for (const [name, rows] of tests) {
    console.log(`  ${name}: ${rows.length} 行, 首行=${JSON.stringify(rows[0])}`);
  }
  console.log(`\naudit 缓冲: ${ds.getAuditCount()} 条`);
  await ds.close();
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });

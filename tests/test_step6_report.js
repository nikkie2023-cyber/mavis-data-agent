// Step 6 测试: report-builder 生成 HTML dashboard
const { DataFetcher } = require('../src/data-fetcher');
const { DataAnalyzer } = require('../src/data-analyzer');
const { DataValidator } = require('../src/data-validator');
const { ReportBuilder } = require('../src/report-builder');
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
  const validator = new DataValidator(fetcher);
  const builder = new ReportBuilder();
  const fullRange = { start: '2026-08-04', end: '2026-09-02' };

  console.log('='.repeat(50));
  console.log('Step 6 测试: report-builder HTML dashboard');
  console.log('='.repeat(50));
  console.log('');

  // 准备数据
  const queryResult = fetcher.ecommerceDailyOrders(fullRange);
  const analysis = await analyzer.analyze(queryResult, {
    metric: 'ecom_daily_orders', dataset: 'ecommerce', table: 'orders',
    dimensions: ['channel']
  });
  const validation = validator.validate(queryResult, {
    dataset: 'ecommerce', table: 'orders',
    expectedRows: 30, valueMin: 0, valueMax: 1000
  });

  // Test 1: 电商报告
  console.log('--- 电商日订单报告 ---');
  const report1 = builder.build({
    title: '电商日订单分析',
    metric: 'ecom_daily_orders',
    queryResult,
    analysis,
    validation,
    dataset: 'ecommerce',
    timeRange: fullRange
  });
  check('报告文件生成', fs.existsSync(report1.path), report1.path);
  check('报告大小 > 1KB', report1.size > 1024, `${report1.size} bytes`);
  const content1 = fs.readFileSync(report1.path, 'utf-8');
  check('HTML 含 DOCTYPE', content1.includes('<!DOCTYPE html>'));
  check('HTML 含标题', content1.includes('电商日订单分析'));
  check('HTML 含 canvas 元素', content1.includes('<canvas'));
  check('HTML 含异常检测', content1.includes('异常检测'));
  check('HTML 是自包含 (无 CDN)', !content1.includes('cdn.jsdelivr') && !content1.includes('unpkg.com'));
  check('HTML 含内嵌 JS (drawLineChart)', content1.includes('drawLineChart'));
  console.log(`   → ${report1.path} (${(report1.size / 1024).toFixed(1)} KB)`);

  // Test 2: App 报告 (无异常场景)
  console.log('\n--- App DAU 报告 ---');
  const appDau = fetcher.appDAU(fullRange);
  const appAnalysis = await analyzer.analyze(appDau, {
    metric: 'app_dau', dataset: 'app', table: 'events'
  });
  const appValidation = validator.validate(appDau, {
    dataset: 'app', table: 'events', expectedRows: 30, valueMin: 100, valueMax: 5000
  });
  const report2 = builder.build({
    title: 'App DAU 趋势',
    metric: 'app_dau',
    queryResult: appDau,
    analysis: appAnalysis,
    validation: appValidation,
    dataset: 'app',
    timeRange: fullRange
  });
  check('App 报告生成', fs.existsSync(report2.path));
  const content2 = fs.readFileSync(report2.path, 'utf-8');
  check('App 报告含 DAU', content2.includes('App DAU'));

  // Test 3: 报告输出到 output 目录
  console.log('\n--- 输出目录 ---');
  const outputDir = path.join(__dirname, '..', 'output');
  const reportFiles = fs.readdirSync(outputDir).filter(f => f.endsWith('.html'));
  check('output 目录有报告文件', reportFiles.length >= 2, `找到 ${reportFiles.length} 个`);
  console.log(`   → 报告文件: ${reportFiles.join(', ')}`);

  console.log('');
  console.log('='.repeat(50));
  console.log(`结果: ${passed} 通过, ${failed} 失败`);
  console.log('='.repeat(50));
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });

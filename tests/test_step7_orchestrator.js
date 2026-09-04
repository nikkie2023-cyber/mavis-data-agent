// Step 7 测试: orchestrator 路由
const { Orchestrator } = require('../src/orchestrator');
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`✅ ${name}`); passed++; }
  else { console.log(`❌ ${name} - ${detail}`); failed++; }
}

async function main() {
  const orch = new Orchestrator();

  console.log('='.repeat(50));
  console.log('Step 7 测试: orchestrator routing');
  console.log('='.repeat(50));
  console.log('');

  // Test 1: 简单查询路由
  console.log('--- 简单查询 ---');
  const r1 = await orch.run('今天 GMV 多少');
  check('简单查询 status=complete', r1.status === 'complete');
  check('简单查询 intent=simple', r1.intent === 'simple');
  check('简单查询调 4 个 step (含 metric_resolution + audit_log)', r1.steps.length === 4, `实际 ${r1.steps.length} 个 step`);
  check('简单查询无 report', !r1.report);
  check('简单查询有 result', r1.result && r1.result.length > 0);
  console.log(`   intent=${r1.intent}, steps=${r1.steps.length}, duration=${r1.duration_ms}ms`);

  // Test 2: 分析查询路由
  console.log('\n--- 分析查询 ---');
  const r2 = await orch.run('DAU 为啥跌了');
  check('分析查询 status=complete', r2.status === 'complete');
  check('分析查询 intent=analysis', r2.intent === 'analysis');
  check('分析查询调 6 个 step (含 metric_resolution + audit_log)', r2.steps.length === 6, `实际 ${r2.steps.length} 个 step`);
  check('分析查询有 report', !!r2.report);
  check('分析查询有 analysis', !!r2.analysis);
  console.log(`   intent=${r2.intent}, steps=${r2.steps.length}, anomalies=${r2.analysis?.anomalies?.length || 0}`);

  // Test 3: 探索查询
  console.log('\n--- 探索查询 ---');
  const r3 = await orch.run('看看最近订单');
  check('探索查询 status=complete', r3.status === 'complete');
  console.log(`   intent=${r3.intent}, steps=${r3.steps.length}`);

  // Test 4: 未知 query 兜底
  console.log('\n--- 未知 query ---');
  const r4 = await orch.run('xyz123 乱七八糟');
  check('未知 query 返回 fail', r4.status === 'fail');
  check('未知 query 有 error 信息', !!r4.error);

  // Test 5: GMV 查询
  console.log('\n--- GMV 分析 ---');
  const r5 = await orch.run('最近 GMV 怎么跌的');
  check('GMV 查询 metric=ecom_gmv', r5.metric?.id === 'ecom_gmv');
  check('GMV 查询完成', r5.status === 'complete');
  check('GMV 查询生成报告', !!r5.report);

  // Test 6: DAU 查询
  console.log('\n--- DAU 查询 ---');
  const r6 = await orch.run('日活怎么样');
  check('DAU 查询 metric=app_dau', r6.metric?.id === 'app_dau');
  check('DAU 查询完成', r6.status === 'complete');

  // Test 7: 所有报告都生成在 output
  console.log('\n--- 报告生成 ---');
  const outputDir = path.join(__dirname, '..', 'output');
  const reportFiles = fs.readdirSync(outputDir).filter(f => f.endsWith('.html') && f.startsWith('report_'));
  check('output 有报告文件', reportFiles.length >= 2);
  console.log(`   → ${reportFiles.length} 个 report_* 文件`);

  console.log('');
  console.log('='.repeat(50));
  console.log(`结果: ${passed} 通过, ${failed} 失败`);
  console.log('='.repeat(50));
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });

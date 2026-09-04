// 端到端 smoke test: 直接调 orchestrator 跑 "DAU 为啥跌了"
// 验证: SQL 模式 + audit log + report 生成
const { Orchestrator } = require('../src/orchestrator');

(async () => {
  // 清空 audit.log 让本次干净
  const fs = require('fs');
  const path = require('path');
  const auditPath = path.join(__dirname, '..', 'output', 'audit.log');
  fs.writeFileSync(auditPath, '');

  const orch = new Orchestrator();
  console.log('🚀 跑 query: "DAU 为啥跌了"');
  const r = await orch.run('DAU 为啥跌了', (ev) => {
    if (ev.type === 'step_start' || ev.type === 'step_done') {
      console.log(`  [${ev.type}] ${ev.name} - ${ev.detail || ev.status} (${ev.timing || '-'})`);
    }
  });

  console.log('\n📊 结果:');
  console.log(`  status: ${r.status}`);
  console.log(`  intent: ${r.intent}`);
  console.log(`  metric: ${r.metric?.name}`);
  console.log(`  steps: ${r.steps.length}`);
  console.log(`  duration: ${r.duration_ms}ms`);
  console.log(`  anomalies: ${r.analysis?.anomalies?.length}`);
  console.log(`  report: ${r.report?.path}`);
  console.log(`  llm_stats: ${JSON.stringify(r.llm_stats)}`);

  console.log('\n📋 Audit log:');
  const auditContent = fs.readFileSync(auditPath, 'utf-8');
  const lines = auditContent.trim().split('\n').filter(Boolean);
  console.log(`  ${lines.length} 条记录`);
  lines.forEach((l, i) => {
    const entry = JSON.parse(l);
    console.log(`  ${i+1}. [${entry.metric}] rows=${entry.rows} ${entry.duration_ms}ms - ${entry.sql?.slice(0, 60)}...`);
  });
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });

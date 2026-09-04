// v0.3 端到端 demo: 启用飞书推送, 跑一次完整分析
const { Orchestrator } = require('../src/orchestrator');
const fs = require('fs');
const path = require('path');

(async () => {
  // 清空旧的 feishu-mock.log
  const mockPath = path.join(__dirname, '..', 'output', 'feishu-mock.log');
  if (fs.existsSync(mockPath)) fs.writeFileSync(mockPath, '');

  const orch = new Orchestrator(null, { autoPushFeishu: true });

  console.log('🚀 v0.3 端到端 demo (启用飞书 mock 推送)\n');
  const r = await orch.run('订单为啥跌了', (ev) => {
    if (ev.type === 'step_start' || ev.type === 'step_done') {
      const dur = ev.timing || '-';
      console.log(`  [${ev.type}] ${ev.name} - ${(ev.detail || ev.status || '').slice(0, 60)} (${dur})`);
    }
  });

  console.log('\n📊 关键结果:');
  console.log(`  status=${r.status} intent=${r.intent}`);
  console.log(`  metric=${r.metric?.name} (${r.metricId})`);
  console.log(`  steps=${r.steps.length} 异常=${r.analysis?.anomalies?.length}`);
  console.log(`  报告: ${r.report?.path} (${r.report?.size} bytes)`);
  console.log(`  飞书推送: mode=${r.feishu?.mode} ok=${r.feishu?.ok}`);

  console.log('\n📋 feishu-mock.log (推送卡片):');
  if (fs.existsSync(mockPath)) {
    const lines = fs.readFileSync(mockPath, 'utf-8').trim().split('\n').filter(Boolean);
    lines.forEach((l, i) => {
      const entry = JSON.parse(l);
      console.log(`  [${i+1}] ${entry.title}`);
      console.log(`      summary: ${entry.summary?.slice(0, 100)}...`);
      console.log(`      reportUrl: ${entry.reportUrl}`);
      console.log(`      msg_type: ${entry.card.msg_type}, template: ${entry.card.card.header.template}`);
    });
  } else {
    console.log('  (空)');
  }

  console.log('\n📋 报告 (output):');
  if (r.report?.path && fs.existsSync(r.report.path)) {
    const reportContent = fs.readFileSync(r.report.path, 'utf-8');
    const hasDataSource = /数据来源/.test(reportContent);
    const hasSQL = /SQL 模板/.test(reportContent);
    const hasComment = /批注|评论/.test(reportContent);
    const hasAudit = /审计|audit/.test(reportContent);
    const hasChart = /canvas/.test(reportContent);
    console.log(`  canvas 图表: ${hasChart}`);
    console.log(`  数据来源: ${hasDataSource}`);
    console.log(`  SQL 模板: ${hasSQL}`);
    console.log(`  审计链接: ${hasAudit}`);
    console.log(`  评论区 (空, 待飞书同步): ${hasComment}`);
  }
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });

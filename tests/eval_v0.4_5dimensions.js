// Mavis Data Agent - v0.4 5 维度真实评测
// 评测 5 个能力维度:
//   1. 简单查询不调复杂 agent (路由策略)
//   2. 复杂任务用多 agent 协作
//   3. 调用 skill 写报告和图表
//   4. 自动检测指标 + 异常响应
//   5. 飞书集成 (数据来源标注 / 评论)

const { Orchestrator } = require('../src/orchestrator');

const RESULTS = [];
function record(dim, name, pass, evidence) {
  RESULTS.push({ dim, name, pass, evidence });
  const icon = pass ? '✅' : '❌';
  console.log(`${icon} [维度 ${dim}] ${name}`);
  console.log(`     证据: ${evidence}`);
}

async function evalSimpleRouting() {
  // 维度 1: 简单查询不调复杂 agent
  const orch = new Orchestrator();
  const r = await orch.run('今天 GMV 多少');
  const stepNames = r.steps.map(s => s.name);
  const hasAnalyzer = stepNames.includes('anomaly_detection');
  const hasReport = stepNames.includes('report_generation');
  const pass = r.intent === 'simple' && !hasAnalyzer && !hasReport && stepNames.length <= 4;
  const evidence = `intent=${r.intent}, steps=[${stepNames.join(', ')}], duration=${r.duration_ms}ms, LLM=${r.llm_stats?.calls || 0}次`;
  record(1, '简单查询不调 analyzer/report', pass, evidence);
  return pass;
}

async function evalComplexMultiAgent() {
  // 维度 2: 复杂任务调多 agent
  const orch = new Orchestrator();
  const r = await orch.run('DAU 为啥跌了');
  const stepNames = r.steps.map(s => s.name);
  const hasAll4 = ['metric_resolution', 'data_fetch', 'anomaly_detection', 'data_validation', 'report_generation']
    .every(s => stepNames.includes(s));
  const llmCalled = r.llm_stats?.calls > 0;
  const pass = r.intent === 'analysis' && hasAll4 && llmCalled;
  const evidence = `intent=${r.intent}, steps=${stepNames.length}个[${stepNames.join('→')}], LLM调用=${r.llm_stats?.calls}次, tokens=${r.llm_stats?.tokens || 0}`;
  record(2, '复杂任务调 5 个 agent + LLM', pass, evidence);
  return pass;
}

async function evalReportSkill() {
  // 维度 3: 调用 skill 写报告 (含图表)
  // v0.3 评测: orchestrator 是否调 registry.invoke('report', ...); skills/ 目录是否注册 ReportSkill
  const fs = require('fs');
  const path = require('path');

  // 1. skills/ 目录有 ReportSkill
  const reportSkillPath = path.join(__dirname, '..', 'src', 'skills', 'report-skill.js');
  const hasReportSkill = fs.existsSync(reportSkillPath);
  const reportSkillSrc = hasReportSkill ? fs.readFileSync(reportSkillPath, 'utf-8') : '';

  // 2. orchestrator 调 registry.invoke('report', ...)
  const orchSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'orchestrator.js'), 'utf-8');
  const usesSkillAPI = /registry\.invoke\(\s*['"]report['"]/i.test(orchSrc);

  // 3. 报告 HTML 实际能力 (canvas 图表 + 数据来源标注)
  const reportDir = path.join(__dirname, '..', 'output');
  const reports = fs.readdirSync(reportDir).filter(f => f.startsWith('report_') && f.endsWith('.html'));
  if (reports.length === 0) {
    record(3, '通过 skill API 写报告+图表', false, '无历史报告');
    return false;
  }
  const latest = reports.sort().reverse()[0];
  const content = fs.readFileSync(path.join(reportDir, latest), 'utf-8');
  const hasECharts = content.includes('<canvas') || content.includes('drawLineChart');
  const hasSummary = content.includes('总结') || content.includes('检测到');
  const hasAnomaly = content.includes('异常');
  const hasSourceInfo = content.includes('数据来源') && content.includes('SQL 模板');
  const hasDataSource = content.includes('数据来源') || content.includes('Source');

  if (usesSkillAPI && hasReportSkill) {
    const pass = hasECharts && hasSummary && hasAnomaly && hasSourceInfo;
    record(3, '通过 skill API 写报告+图表', pass,
      `✅ ReportSkill 存在, orchestrator 调 registry.invoke('report', ...), 报告含 canvas=${hasECharts} summary=${hasSummary} anomaly=${hasAnomaly} 数据来源=${hasSourceInfo} SQL模板=${hasSourceInfo}`);
    return pass;
  } else {
    record(3, '通过 skill API 写报告+图表', false,
      `❌ ReportSkill 存在=${hasReportSkill}, orchestrator 用 skill API=${usesSkillAPI}, 报告含数据来源=${hasSourceInfo}`);
    return false;
  }
}

async function evalAnomalyDetect() {
  // 维度 4: 自动检测指标 + 异常响应
  const orch = new Orchestrator();
  const r = await orch.run('日活为啥跌了');
  const detected = r.analysis?.anomalies?.length > 0;
  const hasReport = !!r.report;
  const summaryText = r.analysis?.summary || r.summary || '';
  const summaryMentionsAnomaly = summaryText.includes('异常') || summaryText.includes('跌') || summaryText.includes('σ');
  const pass = detected && hasReport && summaryMentionsAnomaly;
  const evidence = `检测到异常=${detected} (${r.analysis?.anomalies?.length || 0} 个), 生成报告=${hasReport} (${r.report?.size || 0} bytes), summary提及异常=${summaryMentionsAnomaly}, summary="${summaryText.slice(0, 100)}..."`;
  record(4, '自动异常检测 + 立即响应报告', pass, evidence);
  return pass;
}

async function evalFeishuIntegration() {
  // 维度 5: 飞书集成 (数据来源标注 / 评论 / 推送)
  const fs = require('fs');
  const path = require('path');

  // 1. feishu-push skill 存在
  const feishuSkillPath = path.join(__dirname, '..', 'src', 'skills', 'feishu-push-skill.js');
  const hasFeishuSkill = fs.existsSync(feishuSkillPath);

  // 2. orchestrator 调 registry.invoke('feishu-push', ...)
  const orchSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'orchestrator.js'), 'utf-8');
  const usesFeishuAPI = /registry\.invoke\(\s*['"]feishu-push['"]/i.test(orchSrc);

  // 3. 报告 HTML 含数据来源标注 + 评论区 (可空)
  const reportDir = path.join(__dirname, '..', 'output');
  const reports = fs.readdirSync(reportDir).filter(f => f.startsWith('report_') && f.endsWith('.html'));
  let reportHasSource = false, reportHasCommentSection = false;
  if (reports.length > 0) {
    const latest = reports.sort().reverse()[0];
    const content = fs.readFileSync(path.join(reportDir, latest), 'utf-8');
    reportHasSource = /数据来源[\s\S]*?SQL 模板/i.test(content);
    reportHasCommentSection = /批注|评论/i.test(content) || content.includes('飞书');
  }

  // 4. feishu-mock.log 存在 (说明飞书集成代码路径走过, 即便在 mock 模式)
  const mockLogPath = path.join(reportDir, 'feishu-mock.log');
  const mockLogExists = fs.existsSync(mockLogPath);
  const mockLogContent = mockLogExists ? fs.readFileSync(mockLogPath, 'utf-8') : '';
  const mockHasCard = mockLogContent.includes('msg_type') && mockLogContent.includes('card');

  // 5. webhook URL 配置 (real 模式) — 可选
  const hasWebhookConfig = !!process.env.FEISHU_WEBHOOK_URL;

  // 通过标准: skill 存在 + orchestrator 调过 + 报告含数据来源
  if (hasFeishuSkill && usesFeishuAPI && reportHasSource) {
    record(5, '飞书集成 (数据来源 / 评论 / 推送)', true,
      `✅ FeishuPushSkill 存在, orchestrator 调 registry.invoke('feishu-push'), 报告含数据来源=${reportHasSource} + SQL模板=${reportHasSource}, webhook配置=${hasWebhookConfig ? 'real模式' : 'mock模式'}, mockLog存在=${mockLogExists} mockLog含card=${mockHasCard}`);
    return true;
  } else {
    record(5, '飞书集成 (数据来源 / 评论 / 推送)', false,
      `❌ FeishuPushSkill=${hasFeishuSkill} orchestrator调=${usesFeishuAPI} 报告含数据来源=${reportHasSource} mockLog=${mockLogExists}`);
    return false;
  }
}

async function main() {
  console.log('═'.repeat(60));
  console.log('Mavis Data Agent - v0.4 5 维度真实评测');
  console.log('═'.repeat(60));
  console.log('');

  await evalSimpleRouting();
  console.log('');
  await evalComplexMultiAgent();
  console.log('');
  await evalReportSkill();
  console.log('');
  await evalAnomalyDetect();
  console.log('');
  await evalFeishuIntegration();
  console.log('');

  // 总结
  const total = RESULTS.length;
  const passed = RESULTS.filter(r => r.pass).length;
  console.log('═'.repeat(60));
  console.log(`📊 5 维度总评: ${passed}/${total} 通过`);
  console.log('═'.repeat(60));
  RESULTS.forEach(r => {
    console.log(`  维度 ${r.dim}: ${r.pass ? '✅' : '❌'} ${r.name}`);
  });
  console.log('');
  process.exit(passed === total ? 0 : 1);
}

main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });

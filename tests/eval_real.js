// Mavis Data Agent - 正式评测 (20+ case, 5 维度, 真实 DeepSeek)
//
// 评测标准 (5 维度, 每维度独立打分):
//   1. 功能正确性 (functional): 10 case
//   2. 路由智能性 (routing):     5 case
//   3. 异常检测准确性 (accuracy): 3 case
//   4. 性能 (performance):       2 case
//   5. 成本 (cost):              2 case
//   总计: 22 case
//
// 用法: $env:DEEPSEEK_API_KEY = "sk-..."; node tests/eval_real.js
// 输出: eval/eval_report.md (人类可读) + eval/eval_results.json (机器可读)

const { Orchestrator } = require('../src/orchestrator');
const { createLLM } = require('../src/llm');
const { DataFetcher } = require('../src/data-fetcher');
const { DataAnalyzer } = require('../src/data-analyzer');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EVAL_DIR = path.join(ROOT, 'eval');
const REPORT_MD = path.join(EVAL_DIR, 'eval_report.md');
const REPORT_JSON = path.join(EVAL_DIR, 'eval_results.json');
const ANOMALIES = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', '_anomalies.json'), 'utf-8'));

// ============ 评测标准 (rubric) ============
const RUBRIC = {
  functional:   { name: '功能正确性', weight: 0.30, max: 10, description: '每个指标 query 能正确返回' },
  routing:      { name: '路由智能性', weight: 0.20, max: 5,  description: '简单/分析/同义词/未知 query 正确路由' },
  accuracy:     { name: '异常检测准确性', weight: 0.25, max: 3,  description: '能准确识别已知异常' },
  performance:  { name: '性能', weight: 0.10, max: 2,  description: '延迟在合理范围' },
  cost:         { name: '成本', weight: 0.15, max: 2,  description: 'token 消耗在合理范围' }
};

// ============ Test Cases (22 个) ============
const TEST_CASES = [
  // ===== 功能正确性 (10) =====
  { category: 'functional', id: 1,  name: '电商 GMV', query: 'GMV 多少', expectMetric: 'ecom_gmv', expectSteps: ['data_fetch', 'data_validation'] },
  { category: 'functional', id: 2,  name: '日订单数', query: '日订单数', expectMetric: 'ecom_daily_orders', expectSteps: ['data_fetch'] },
  { category: 'functional', id: 3,  name: '客单价', query: '客单价怎么样', expectMetric: 'ecom_aov', expectSteps: ['data_fetch'] },
  { category: 'functional', id: 4,  name: '转化率', query: '转化率', expectMetric: 'ecom_conversion', expectSteps: ['data_fetch'] },
  { category: 'functional', id: 5,  name: '退款率', query: '退款率多少', expectMetric: 'ecom_refund_rate', expectSteps: ['data_fetch'] },
  { category: 'functional', id: 6,  name: 'App DAU', query: '日活', expectMetric: 'app_dau', expectSteps: ['data_fetch'] },
  { category: 'functional', id: 7,  name: 'App 日事件', query: 'app 日事件', expectMetric: 'app_daily_events', expectSteps: ['data_fetch'] },
  { category: 'functional', id: 8,  name: 'session 时长', query: 'session 时长', expectMetric: 'app_avg_session_duration', expectSteps: ['data_fetch'] },
  { category: 'functional', id: 9,  name: '事件密度', query: '事件密度', expectMetric: 'app_event_per_session', expectSteps: ['data_fetch'] },
  { category: 'functional', id: 10, name: 'D1 留存', query: 'D1 留存', expectMetric: 'app_retention_d1', expectSteps: ['data_fetch'] },

  // ===== 路由智能性 (5) =====
  { category: 'routing', id: 11, name: '简单查询', query: '今天 DAU 多少', expectIntent: 'simple', expectSteps: ['data_fetch', 'data_validation'] },
  { category: 'routing', id: 12, name: '分析查询', query: 'DAU 为啥跌了', expectIntent: 'analysis', expectSteps: ['data_fetch', 'anomaly_detection', 'report_generation'] },
  { category: 'routing', id: 13, name: '同义词: 粘性=留存', query: '粘性怎么样', expectMetric: 'app_retention_d1' },
  { category: 'routing', id: 14, name: '同义词: 流水=GMV', query: '最近流水', expectMetric: 'ecom_gmv' },
  { category: 'routing', id: 15, name: '未知 query 兜底', query: 'xyz123 乱七八糟', expectStatus: 'fail', expectError: true },

  // ===== 异常检测准确性 (3) =====
  { category: 'accuracy', id: 16, name: '检测 8/18 server outage', query: '订单为啥跌', expectAnomaly: '2026-08-18', expectDirection: 'down' },
  { category: 'accuracy', id: 17, name: '检测 8/25 promotion', query: '订单为啥涨', expectAnomaly: '2026-08-25', expectDirection: 'up' },
  { category: 'accuracy', id: 18, name: '检测 DAU 8/18 跌', query: 'DAU 为啥跌', expectAnomaly: '2026-08-18', expectDirection: 'down' },

  // ===== 性能 (2) =====
  { category: 'performance', id: 19, name: '简单查询延迟 < 3s', query: 'GMV 多少', maxMs: 3000 },
  { category: 'performance', id: 20, name: '分析查询延迟 < 30s', query: 'DAU 为啥跌了', maxMs: 30000 },

  // ===== 成本 (2) =====
  { category: 'cost', id: 21, name: '简单查询 tokens < 500', query: 'GMV 多少', maxTokens: 500 },
  { category: 'cost', id: 22, name: '分析查询 tokens < 3000', query: 'DAU 为啥跌了', maxTokens: 3000 }
];

// ============ 评分函数 ============
function scoreCase(testCase, result) {
  const checks = [];
  let pass = true;

  // === 功能正确性检查 ===
  if (testCase.expectMetric) {
    const got = result.metric?.id;
    if (got === testCase.expectMetric) {
      checks.push({ name: 'metric_match', status: 'pass', detail: `命中 ${got}` });
    } else {
      checks.push({ name: 'metric_match', status: 'fail', detail: `期望 ${testCase.expectMetric}, 实际 ${got}` });
      pass = false;
    }
  }

  if (testCase.expectSteps) {
    const calledSteps = (result.steps || []).map(s => s.name);
    const missing = testCase.expectSteps.filter(s => !calledSteps.includes(s));
    if (missing.length === 0) {
      checks.push({ name: 'steps_match', status: 'pass', detail: `调用了 ${testCase.expectSteps.length} 个 step` });
    } else {
      checks.push({ name: 'steps_match', status: 'fail', detail: `缺少 step: ${missing.join(', ')}` });
      pass = false;
    }
  }

  if (testCase.expectIntent) {
    if (result.intent === testCase.expectIntent) {
      checks.push({ name: 'intent_match', status: 'pass', detail: `intent=${result.intent}` });
    } else {
      checks.push({ name: 'intent_match', status: 'fail', detail: `期望 ${testCase.expectIntent}, 实际 ${result.intent}` });
      pass = false;
    }
  }

  if (testCase.expectStatus) {
    if (result.status === testCase.expectStatus) {
      checks.push({ name: 'status_match', status: 'pass', detail: `status=${result.status}` });
    } else {
      checks.push({ name: 'status_match', status: 'fail', detail: `期望 ${testCase.expectStatus}, 实际 ${result.status}` });
      pass = false;
    }
  }

  if (testCase.expectError !== undefined) {
    const hasError = !!result.error;
    if (hasError === testCase.expectError) {
      checks.push({ name: 'error_match', status: 'pass', detail: hasError ? '有 error (符合预期)' : '无 error (符合预期)' });
    } else {
      checks.push({ name: 'error_match', status: 'fail', detail: `期望 error=${testCase.expectError}, 实际 error=${hasError}` });
      pass = false;
    }
  }

  if (testCase.expectAnomaly) {
    const detected = (result.analysis?.anomalies || []).map(a => a.date);
    if (detected.includes(testCase.expectAnomaly)) {
      const anomaly = result.analysis.anomalies.find(a => a.date === testCase.expectAnomaly);
      if (testCase.expectDirection && anomaly.direction !== testCase.expectDirection) {
        checks.push({ name: 'anomaly_direction', status: 'fail', detail: `${testCase.expectAnomaly} 方向不符: 期望 ${testCase.expectDirection}, 实际 ${anomaly.direction}` });
        pass = false;
      } else {
        checks.push({ name: 'anomaly_detected', status: 'pass', detail: `检测到 ${testCase.expectAnomaly} (${anomaly.direction}, ${anomaly.sigma}σ)` });
      }
    } else {
      checks.push({ name: 'anomaly_detected', status: 'fail', detail: `未检测到 ${testCase.expectAnomaly}, 实际检测: ${detected.join(', ') || '无'}` });
      pass = false;
    }
  }

  if (testCase.maxMs !== undefined) {
    if (result.duration_ms <= testCase.maxMs) {
      checks.push({ name: 'latency', status: 'pass', detail: `${result.duration_ms}ms <= ${testCase.maxMs}ms` });
    } else {
      checks.push({ name: 'latency', status: 'fail', detail: `${result.duration_ms}ms > ${testCase.maxMs}ms` });
      pass = false;
    }
  }

  if (testCase.maxTokens !== undefined) {
    const tokens = result.llm_stats?.tokens || 0;
    if (tokens <= testCase.maxTokens) {
      checks.push({ name: 'token_cost', status: 'pass', detail: `${tokens} tokens <= ${testCase.maxTokens}` });
    } else {
      checks.push({ name: 'token_cost', status: 'fail', detail: `${tokens} tokens > ${testCase.maxTokens}` });
      pass = false;
    }
  }

  return { pass, checks };
}

// ============ 主流程 ============
async function main() {
  if (!fs.existsSync(EVAL_DIR)) fs.mkdirSync(EVAL_DIR, { recursive: true });

  const llm = createLLM();
  const orch = new Orchestrator(llm);

  console.log('═'.repeat(60));
  console.log('🧪 Mavis Data Agent - 正式评测');
  console.log('═'.repeat(60));
  console.log(`📅 时间:     ${new Date().toLocaleString('zh-CN')}`);
  console.log(`🧠 LLM:      ${llm.mode === 'deepseek' ? 'DeepSeek (真实)' : 'Mock'}`);
  console.log(`📋 用例数:   ${TEST_CASES.length}`);
  console.log('');

  const results = [];
  const startTotal = Date.now();
  let llmTokenStart = llm.totalTokens;
  let llmCallStart = llm.callCount;

  for (const tc of TEST_CASES) {
    process.stdout.write(`▶ Case ${tc.id.toString().padStart(2, '0')} (${tc.category.padEnd(11)}) ${tc.name}... `);
    try {
      const start = Date.now();
      const result = await orch.run(tc.query);
      result.duration_ms = Date.now() - start;
      const score = scoreCase(tc, result);
      console.log(`${score.pass ? '✅' : '❌'} ${result.duration_ms}ms`);
      results.push({ ...tc, result, score, status: score.pass ? 'pass' : 'fail' });
    } catch (e) {
      console.log(`❌ ERROR: ${e.message.slice(0, 50)}`);
      results.push({ ...tc, error: e.message, score: { pass: false, checks: [] }, status: 'error' });
    }
  }

  const totalTime = Date.now() - startTotal;
  const llmTotalTokens = llm.totalTokens - llmTokenStart;
  const llmTotalCalls = llm.callCount - llmCallStart;
  const llmTotalCost = llmTotalTokens * 0.000001;

  // 按类别汇总
  const byCategory = {};
  TEST_CASES.forEach(tc => { byCategory[tc.category] = byCategory[tc.category] || []; });
  Object.keys(byCategory).forEach(cat => {
    byCategory[cat] = results.filter(r => r.category === cat);
  });

  const summary = {};
  Object.keys(RUBRIC).forEach(cat => {
    const total = byCategory[cat]?.length || 0;
    const passed = byCategory[cat]?.filter(r => r.score?.pass).length || 0;
    summary[cat] = { total, passed, passRate: total > 0 ? passed / total : 0 };
  });

  // 总体
  const totalPassed = results.filter(r => r.score?.pass).length;
  const overallPassRate = totalPassed / results.length;

  // 打印总结
  console.log('');
  console.log('═'.repeat(60));
  console.log('📊 评测总结');
  console.log('═'.repeat(60));
  Object.keys(RUBRIC).forEach(cat => {
    const r = RUBRIC[cat];
    const s = summary[cat];
    const bar = '█'.repeat(Math.round(s.passRate * 20)) + '░'.repeat(20 - Math.round(s.passRate * 20));
    console.log(`  ${r.name.padEnd(8)} ${bar} ${s.passed}/${s.total} (${Math.round(s.passRate*100)}%)  权重 ${(r.weight*100).toFixed(0)}%`);
  });
  console.log('');
  console.log(`  总计     ${totalPassed}/${results.length} 通过 (${Math.round(overallPassRate*100)}%)`);
  console.log(`  LLM 调用  ${llmTotalCalls} 次, ${llmTotalTokens} tokens, ¥${llmTotalCost.toFixed(4)}`);
  console.log(`  总耗时    ${(totalTime/1000).toFixed(1)}s`);

  // ===== 生成报告 =====
  const reportMd = generateMarkdownReport(results, summary, RUBRIC, totalPassed, overallPassRate, totalTime, llmTotalTokens, llmTotalCost, llmTotalCalls, llm.mode);
  fs.writeFileSync(REPORT_MD, reportMd);
  console.log('');
  console.log(`📄 报告: ${REPORT_MD}`);

  const reportJson = {
    timestamp: new Date().toISOString(),
    llm_mode: llm.mode,
    summary,
    overall: { passed: totalPassed, total: results.length, passRate: overallPassRate },
    llm_stats: { calls: llmTotalCalls, tokens: llmTotalTokens, cost: llmTotalCost },
    duration_ms: totalTime,
    results
  };
  fs.writeFileSync(REPORT_JSON, JSON.stringify(reportJson, null, 2));
  console.log(`📄 JSON:  ${REPORT_JSON}`);

  process.exit(totalPassed === results.length ? 0 : 1);
}

function generateMarkdownReport(results, summary, rubric, totalPassed, overallPassRate, totalTime, llmTokens, llmCost, llmCalls, llmMode) {
  let md = `# Mavis Data Agent - 评测报告

| 项目 | 值 |
|------|---|
| **生成时间** | ${new Date().toLocaleString('zh-CN')} |
| **LLM 模式** | ${llmMode === 'deepseek' ? 'DeepSeek (真实)' : 'Mock'} |
| **用例总数** | ${results.length} |
| **通过** | ${totalPassed} (${Math.round(overallPassRate*100)}%) |
| **总耗时** | ${(totalTime/1000).toFixed(1)}s |
| **LLM 调用** | ${llmCalls} 次, ${llmTokens} tokens, ¥${llmCost.toFixed(4)} |

## 评测标准 (5 维度评分)

| 维度 | 权重 | 通过 | 总数 | 通过率 | 说明 |
|------|------|------|------|--------|------|
`;
  Object.keys(rubric).forEach(cat => {
    const r = rubric[cat];
    const s = summary[cat];
    const bar = '█'.repeat(Math.round(s.passRate * 15)) + '░'.repeat(15 - Math.round(s.passRate * 15));
    md += `| ${r.name} | ${(r.weight*100).toFixed(0)}% | ${s.passed} | ${s.total} | ${bar} ${Math.round(s.passRate*100)}% | ${r.description} |\n`;
  });

  md += `\n## 详细结果\n\n`;

  const categories = ['functional', 'routing', 'accuracy', 'performance', 'cost'];
  const catNames = {
    functional: '1. 功能正确性',
    routing: '2. 路由智能性',
    accuracy: '3. 异常检测准确性',
    performance: '4. 性能',
    cost: '5. 成本'
  };

  categories.forEach(cat => {
    md += `\n### ${catNames[cat]}\n\n`;
    md += `| # | 用例 | 查询 | 状态 | 耗时 | tokens | 备注 |\n`;
    md += `|---|------|------|------|------|--------|------|\n`;
    results.filter(r => r.category === cat).forEach(r => {
      const ok = r.score?.pass ? '✅' : '❌';
      const dur = r.result?.duration_ms || 0;
      const tokens = r.result?.llm_stats?.tokens || 0;
      const detail = r.score?.checks?.map(c => c.detail).join(' / ') || r.error || '';
      md += `| ${r.id} | ${r.name} | ${r.query} | ${ok} | ${dur}ms | ${tokens} | ${detail} |\n`;
    });
  });

  md += `\n## 关键发现\n\n`;

  // 自动总结
  const failCases = results.filter(r => !r.score?.pass);
  if (failCases.length === 0) {
    md += `- ✅ **所有用例通过**, 系统在 5 个维度上均达标\n`;
    md += `- 📊 共消耗 ${llmTokens} tokens, 平均每次 LLM 调用 ${(llmTokens/Math.max(1, llmCalls)).toFixed(0)} tokens\n`;
    md += `- 💰 总成本 ¥${llmCost.toFixed(4)}, 单次平均 ¥${(llmCost/results.length).toFixed(6)}\n`;
    md += `- ⏱️ 平均响应 ${(totalTime/results.length).toFixed(0)}ms/case\n`;
  } else {
    md += `- ⚠️ **${failCases.length} 个用例失败**, 需关注:\n`;
    failCases.forEach(r => {
      md += `  - Case ${r.id} (${r.name}): ${r.score?.checks?.filter(c => c.status === 'fail').map(c => c.detail).join('; ')}\n`;
    });
  }

  md += `\n## 评测方法论\n\n`;
  md += `### 5 维度评分法\n\n`;
  md += `本评测不只测"能不能跑",而是测"跑得好不好"。每个维度独立计分:\n\n`;
  md += `1. **功能正确性 (30%)**: 10 个指标 query 都能命中正确指标并返回数据\n`;
  md += `2. **路由智能性 (20%)**: 5 种 query 类型 (简单/分析/同义词/未知) 路由正确\n`;
  md += `3. **异常检测准确性 (25%)**: 3 个已知异常能被稳定识别\n`;
  md += `4. **性能 (10%)**: 延迟在合理范围 (简单 < 3s, 分析 < 30s)\n`;
  md += `5. **成本 (15%)**: token 消耗经济 (简单 < 500, 分析 < 3000)\n\n`;
  md += `### 通过判定\n\n`;
  md += `- 单 case 通过 = 所有断言通过\n`;
  md += `- 总体通过 = 通过 case 数 / 总 case 数\n\n`;
  md += `### 测试数据\n\n`;
  md += `- 电商数据集: 8000 用户, 100 商品, 7140 订单, 30007 sessions\n`;
  md += `- App 数据集: 20000 用户, 62529 events, 47343 sessions\n`;
  md += `- 已知异常 (用于 accuracy 测试):\n`;
  ANOMALIES.forEach(a => {
    md += `  - ${a.date} (${a.type}): ${a.impact > 0 ? '+' : ''}${a.impact}% (${a.desc})\n`;
  });

  md += `\n## 复现方式\n\n`;
  md += '```bash\n';
  md += '# 设置 API key\n';
  md += '$env:DEEPSEEK_API_KEY = "sk-your-key"\n\n';
  md += '# 跑评测\n';
  md += 'cd mavis-data-agent\n';
  md += 'node tests/eval_real.js\n';
  md += '```\n';

  md += `\n---\n报告由 Mavis Data Agent 自动生成\n`;

  return md;
}

main().catch(e => { console.error(e); process.exit(1); });

// Skills 中心: 一行注册所有 skill
// 启动时: registerAll(defaultRegistry) 一次, 之后 orchestrator 调 registry.invoke

const { DataFetchSkill } = require('./data-fetch-skill');
const { AnomalySkill } = require('./anomaly-skill');
const { AuditSkill } = require('./audit-skill');
const { ReportSkill } = require('./report-skill');
const { FeishuPushSkill } = require('./feishu-push-skill');

function registerAll(registry, { fetcher, llm, outputDir } = {}) {
  if (fetcher) {
    registry.register(new DataFetchSkill(fetcher));
    registry.register(new AnomalySkill(fetcher, llm));
    registry.register(new AuditSkill(fetcher));
  }
  registry.register(new ReportSkill(outputDir));
  registry.register(new FeishuPushSkill());
  return registry;
}

module.exports = { registerAll, DataFetchSkill, AnomalySkill, AuditSkill, ReportSkill, FeishuPushSkill };

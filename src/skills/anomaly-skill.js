// Anomaly Skill: 把 data-analyzer 包装成 skill
// v0.3: 抽出来, 注册到 skill registry

const { Skill } = require('../skill');
const { DataAnalyzer } = require('../data-analyzer');

class AnomalySkill extends Skill {
  constructor(fetcher, llm) {
    super({
      name: 'anomaly',
      version: '0.3.0',
      description: 'z-score 异常检测 + 维度自动验证 + LLM 归因. 输入时序数据, 输出 anomalies + summary.',
      inputs: [
        { name: 'queryResult', type: 'array', required: true, desc: '时序数据 [{dt, value}, ...]' },
        { name: 'metric', type: 'string', required: true, desc: '指标 id (e.g. app_dau)' },
        { name: 'dataset', type: 'string', required: false },
        { name: 'table', type: 'string', required: false },
        { name: 'dimensions', type: 'array', required: false, default: [] }
      ],
      outputs: [
        { name: 'status', type: 'string', desc: 'anomaly_detected | no_anomaly' },
        { name: 'anomalies', type: 'array' },
        { name: 'summary', type: 'string' },
        { name: 'confidence', type: 'string' },
        { name: 'llm_stats', type: 'object' }
      ],
      execute: '_execute'
    });
    this.analyzer = new DataAnalyzer(fetcher, llm);
  }

  async _execute(inputs) {
    return await this.analyzer.analyze(inputs.queryResult, {
      metric: inputs.metric,
      dataset: inputs.dataset,
      table: inputs.table,
      dimensions: inputs.dimensions || []
    });
  }
}

module.exports = { AnomalySkill };

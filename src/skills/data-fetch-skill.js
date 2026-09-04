// Data Fetch Skill: 把 metric-catalog 包装成 skill
// v0.3: 抽出来, 注册到 skill registry

const { Skill } = require('../skill');
const { MetricResolver } = require('../metric-catalog');

class DataFetchSkill extends Skill {
  constructor(fetcher) {
    super({
      name: 'data-fetch',
      version: '0.3.0',
      description: '根据指标 id + 时间范围从数据源取数. SQL 模式 / CSV 模式自动切换.',
      inputs: [
        { name: 'metricId', type: 'string', required: true, desc: 'e.g. app_dau, ecom_gmv' },
        { name: 'timeRange', type: 'object', required: true, desc: '{ start: "YYYY-MM-DD", end: "YYYY-MM-DD" }' }
      ],
      outputs: [
        { name: 'rows', type: 'array' },
        { name: 'source', type: 'string', desc: 'sql | csv' },
        { name: 'sql', type: 'string', required: false, desc: '实际跑的 SQL (SQL 模式)' }
      ],
      execute: '_execute'
    });
    this.resolver = new MetricResolver(fetcher);
  }

  async _execute(inputs) {
    // 取数
    const result = this.resolver.execute(inputs.metricId, inputs.timeRange);
    // 取 source info (如果 fetcher 是 DataFetcher 委派类)
    const source = this.resolver.fetcher?.getMode?.() || 'unknown';
    return { rows: result, source };
  }
}

module.exports = { DataFetchSkill };

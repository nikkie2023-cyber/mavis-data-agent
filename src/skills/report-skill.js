// Report Skill: 把 report-builder 包装成 skill
// v0.3: 增数据来源标注 + 评论支持

const path = require('path');
const fs = require('fs');
const { Skill } = require('../skill');
const { ReportBuilder } = require('../report-builder');

class ReportSkill extends Skill {
  constructor(outputDir) {
    super({
      name: 'report',
      version: '0.3.0',
      description: '生成自包含 HTML dashboard (canvas 折线图 + 异常高亮 + 数据来源标注 + 评论区). 离线可看, 单文件 5-15KB.',
      inputs: [
        { name: 'title', type: 'string', required: false, default: 'Mavis Data Agent 报告' },
        { name: 'metric', type: 'string', required: false },
        { name: 'metricId', type: 'string', required: false, desc: '指标 id (e.g. app_dau)' },
        { name: 'queryResult', type: 'array', required: true },
        { name: 'analysis', type: 'object', required: false },
        { name: 'validation', type: 'object', required: false },
        { name: 'dataset', type: 'string', required: false },
        { name: 'table', type: 'string', required: false },
        { name: 'timeRange', type: 'object', required: false },
        { name: 'sourceInfo', type: 'object', required: false, desc: '{ mode: "sql"|"csv", sql: "...", metric_id: "..." }' },
        { name: 'comments', type: 'array', required: false, desc: '[{ author, text, ts }] 飞书评论缓存' }
      ],
      outputs: [
        { name: 'path', type: 'string', desc: 'HTML 报告绝对路径' },
        { name: 'taskId', type: 'string', desc: '报告 taskId, 用于 /report/<taskId>.html 访问' },
        { name: 'size', type: 'number', desc: 'HTML 字节数' }
      ],
      execute: '_execute'
    });
    this.builder = new ReportBuilder(outputDir || path.join(__dirname, '..', '..', 'output'));
  }

  async _execute(inputs) {
    // 直接走 ReportBuilder.build, 后续 v0.3.1 会注入数据来源 + 评论 section
    return this.builder.build(inputs);
  }
}

module.exports = { ReportSkill };

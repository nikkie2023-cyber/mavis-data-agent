// Audit Skill: 把 data-validator + flush audit log 包装成 skill
// v0.3: 抽出来, 注册到 skill registry

const { Skill } = require('../skill');
const { DataValidator } = require('../data-validator');

class AuditSkill extends Skill {
  constructor(fetcher) {
    super({
      name: 'audit',
      version: '0.3.0',
      description: '数据验证 (完整性/范围/时序性/口径) + 写 audit log. v0.2 的 data_validation 步骤.',
      inputs: [
        { name: 'queryResult', type: 'array', required: true },
        { name: 'dataset', type: 'string', required: false },
        { name: 'table', type: 'string', required: false },
        { name: 'metric', type: 'string', required: false },
        { name: 'valueMin', type: 'number', required: false },
        { name: 'valueMax', type: 'number', required: false }
      ],
      outputs: [
        { name: 'status', type: 'string', desc: 'pass | fail | warn' },
        { name: 'checks', type: 'array' },
        { name: 'issues', type: 'array' },
        { name: 'summary', type: 'string' }
      ],
      execute: '_execute'
    });
    this.validator = new DataValidator(fetcher);
  }

  async _execute(inputs) {
    return this.validator.validate(inputs.queryResult, {
      dataset: inputs.dataset,
      table: inputs.table,
      valueMin: inputs.valueMin,
      valueMax: inputs.valueMax
    });
  }
}

module.exports = { AuditSkill };

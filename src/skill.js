// Skill 基类 + 能力声明
//
// v0.3 新增: 让 orchestrator 通过 skill 抽象层调用能力, 而不是直接 import 模块
// 跟 v0.4 路线图 Part 4 "可注册的多 agent 能力" 对齐

class Skill {
  constructor({ name, description, version = '0.1.0', inputs, outputs, execute, canRun }) {
    this.name = name;
    this.description = description;
    this.version = version;
    this.inputs = inputs || [];
    this.outputs = outputs || [];
    this.execute = execute;
    this.canRun = canRun || (() => true);
  }

  // 描述这个 skill 做什么 (给 orchestrator / LLM 看的)
  describe() {
    return {
      name: this.name,
      version: this.version,
      description: this.description,
      inputs: this.inputs,
      outputs: this.outputs
    };
  }

  // 执行, 带时间记录
  async run(inputs, ctx = {}) {
    const start = Date.now();
    if (!this.canRun(ctx)) {
      throw new Error(`Skill "${this.name}" cannot run in current context`);
    }
    // execute 可能是函数 (推荐) 或字符串方法名 (派生类 super 调用时无法访问 this 时用)
    const fn = typeof this.execute === 'string' ? this[this.execute].bind(this) : this.execute;
    const result = await fn(inputs, ctx);
    return {
      ...result,
      _meta: {
        skill: this.name,
        version: this.version,
        duration_ms: Date.now() - start
      }
    };
  }
}

module.exports = { Skill };

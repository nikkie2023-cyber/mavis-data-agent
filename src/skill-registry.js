// SkillRegistry: 集中注册 + 调度的 skill 注册中心
//
// 设计:
//   - 全局单例 (defaultRegistry), 也可以 new 出来给特定上下文用
//   - 启动时 register() 一次, 之后 invoke() 调用
//   - 支持 listAll() 让 orchestrator 看可用能力
//   - invoke() 自动 catch 错误 + 返回 skill name/duration 便于审计
//
// v0.3: 替换 orchestrator 里的直接 import, 改用 registry.invoke('report', {...})

class SkillRegistry {
  constructor(name = 'default') {
    this.name = name;
    this.skills = new Map();
  }

  // 注册一个 skill (幂等, 同名会覆盖)
  register(skill) {
    if (!skill || !skill.name) {
      throw new Error('Skill must have a name');
    }
    this.skills.set(skill.name, skill);
    return this;
  }

  // 注销
  unregister(name) {
    return this.skills.delete(name);
  }

  get(name) {
    return this.skills.get(name);
  }

  has(name) {
    return this.skills.has(name);
  }

  // 列出所有 skill 描述 (给 LLM 看的)
  listAll() {
    return Array.from(this.skills.values()).map(s => s.describe());
  }

  // 调用
  async invoke(name, inputs = {}, ctx = {}) {
    const skill = this.skills.get(name);
    if (!skill) {
      throw new Error(`Skill not found: ${name} (registered: ${Array.from(this.skills.keys()).join(', ')})`);
    }
    return await skill.run(inputs, ctx);
  }

  size() { return this.skills.size; }
}

// 全局单例
const defaultRegistry = new SkillRegistry('global');

module.exports = { SkillRegistry, defaultRegistry };

// LLM Client: DeepSeek (优先) + Mock 兜底
// 用法: const llm = new DeepSeekLLM() 或 new MockLLM()
//       const text = await llm.call(system, user)

class MockLLM {
  constructor() {
    this.totalTokens = 0;
    this.totalCost = 0;
    this.callCount = 0;
    this.mode = 'mock';
  }
  async call(system, user) {
    this.callCount++;
    const tokens = Math.floor((system.length + user.length) / 3);
    this.totalTokens += tokens;
    this.totalCost = tokens * 0.000001;
    if (system.includes('summary') || system.includes('总结')) {
      return '基于 30 天数据分析, 整体趋势正常, 存在 1-2 个异常点需关注。';
    }
    if (system.includes('hypothesis') || system.includes('假设')) {
      return '1. 投放波动: 该日某渠道投放暂停或减少\n2. 系统问题: 基础设施/网络异常\n3. 自然波动: 周末/节假日效应';
    }
    return '{}';
  }
}

class DeepSeekLLM {
  constructor(apiKey) {
    this.apiKey = apiKey || process.env.DEEPSEEK_API_KEY;
    this.totalTokens = 0;
    this.totalCost = 0;
    this.callCount = 0;
    this.mode = 'deepseek';
    if (!this.apiKey) {
      throw new Error('DEEPSEEK_API_KEY not set');
    }
  }

  async call(system, user, options = {}) {
    this.callCount++;
    const start = Date.now();
    const resp = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: options.model || 'deepseek-chat',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ],
        temperature: options.temperature || 0.3,
        max_tokens: options.maxTokens || 500
      })
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`DeepSeek ${resp.status}: ${errText.slice(0, 200)}`);
    }

    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content || '{}';
    this.totalTokens += data.usage?.total_tokens || 0;
    this.totalCost = this.totalTokens * 0.000001;
    this.lastLatency = Date.now() - start;
    return content;
  }
}

function createLLM() {
  if (process.env.DEEPSEEK_API_KEY) {
    console.log('   [LLM] 使用 DeepSeek (真实)');
    return new DeepSeekLLM();
  }
  console.log('   [LLM] 使用 Mock (无 DEEPSEEK_API_KEY)');
  return new MockLLM();
}

module.exports = { MockLLM, DeepSeekLLM, createLLM };

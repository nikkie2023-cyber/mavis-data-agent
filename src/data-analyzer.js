// Data Analyzer: 异常检测 + 自动验证
// 流程: 时序数据 → z-score 异常 → 生成假设 → 自动验证 → 归因结论

const { createLLM } = require('./llm');

class DataAnalyzer {
  constructor(fetcher, llm) {
    this.fetcher = fetcher;
    this.llm = llm || createLLM();
  }

  // z-score 异常检测
  detectAnomalies(timeSeries, sigma = 2) {
    const values = timeSeries.map(r => r.value).filter(v => !isNaN(v));
    if (values.length < 3) return [];
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
    const std = Math.sqrt(variance);
    if (std === 0) return [];

    return timeSeries.filter(r => {
      const sigmaVal = Math.abs(r.value - mean) / std;
      return sigmaVal > sigma;
    }).map(r => ({
      ...r,
      mean: parseFloat(mean.toFixed(2)),
      std: parseFloat(std.toFixed(2)),
      sigma: parseFloat((Math.abs(r.value - mean) / std).toFixed(2)),
      direction: r.value > mean ? 'up' : 'down'
    }));
  }

  // 自动验证: 给定异常 + 维度拆分函数, 找到贡献最大的维度
  async verifyDimensionBreakdown(anomaly, breakdownFn) {
    const breakdown = await breakdownFn(anomaly.dt);
    if (!breakdown || breakdown.length === 0) {
      return { verified: false, reason: 'no breakdown data' };
    }

    // 计算每个维度的占比 + 异常程度
    const totalValue = breakdown.reduce((s, b) => s + b.value, 0);
    const enriched = breakdown.map(b => ({
      ...b,
      share: totalValue > 0 ? b.value / totalValue : 0
    })).sort((a, b) => b.value - a.value);

    return {
      verified: true,
      breakdown: enriched,
      total: totalValue,
      top_dimension: enriched[0]?.group_key
    };
  }

  // 主分析入口
  async analyze(queryResult, options = {}) {
    const { metric, dataset, table, dimensions = [] } = options;

    // 1. 异常检测
    const anomalies = this.detectAnomalies(queryResult);

    if (anomalies.length === 0) {
      return {
        status: 'no_anomaly',
        anomalies: [],
        summary: '数据在正常范围内, 无明显异常',
        confidence: 'high'
      };
    }

    // 2. 对每个异常生成假设 + 验证
    const enriched = await Promise.all(anomalies.map(async a => {
      const hypothesis = {
        date: a.dt,
        value: a.value,
        direction: a.direction,
        sigma: a.sigma,
        hypotheses: []
      };

      // 假设 1: 全局异常 (所有维度都跌)
      hypothesis.hypotheses.push({
        text: '所有维度同时异常, 可能是基础设施问题 (服务器/网络)',
        verification_method: '检查各维度的贡献度是否都异常'
      });

      // 假设 2: 某个特定维度异常
      hypothesis.hypotheses.push({
        text: '某个特定维度 (渠道/平台/品类) 异常, 可能是该维度单独的投放/活动问题',
        verification_method: '运行维度拆解, 看哪个维度贡献度最大'
      });

      // 假设 3: 上升可能是运营活动
      if (a.direction === 'up') {
        hypothesis.hypotheses.push({
          text: '上升可能是营销活动/推送/促销带来的',
          verification_method: '检查当天是否有 campaign 配置'
        });
      }

      // 自动验证: 维度拆解
      if (dataset && table) {
        try {
          const breakdownResult = await this.verifyDimensionBreakdown(a,
            (date) => this.fetcher.query(dataset, table, {
              dateCol: this._dateColFor(table),
              dateRange: { start: date, end: date },
              groupBy: dimensions.length ? dimensions : this._defaultDims(dataset, table),
              agg: { col: this._valueColFor(table), op: this._aggOpFor(metric) }
            })
          );
          hypothesis.verification = breakdownResult;
        } catch (e) {
          hypothesis.verification = { verified: false, reason: e.message };
        }
      }

      return hypothesis;
    }));

    // 3. 总结 (用 LLM 生成自然语言解释)
    const summary = await this._summarize(enriched, queryResult, metric, dataset);

    return {
      status: 'anomaly_detected',
      anomalies: enriched,
      summary,
      confidence: enriched.length > 0 ? 'high' : 'medium',
      llm_stats: {
        mode: this.llm.mode,
        calls: this.llm.callCount,
        tokens: this.llm.totalTokens,
        cost: this.llm.totalCost
      }
    };
  }

  _dateColFor(table) {
    return { orders: 'order_date', sessions: 'session_date', events: 'event_time', users: 'register_date' }[table] || 'dt';
  }

  _valueColFor(table) {
    return { orders: 'order_amount', sessions: 'session_id', events: 'event_id', users: 'user_id' }[table] || 'value';
  }

  _aggOpFor(metric) {
    if (!metric) return 'count';
    if (metric.includes('gmv') || metric.includes('aov')) return 'sum';
    if (metric.includes('count') || metric.includes('orders')) return 'count';
    return 'distinct';
  }

  _defaultDims(dataset, table) {
    if (dataset === 'ecommerce') {
      if (table === 'orders') return ['channel'];
      if (table === 'sessions') return ['device'];
    }
    if (dataset === 'app') {
      if (table === 'events') return ['platform'];
      if (table === 'sessions') return ['platform'];
    }
    return [];
  }

  _summarize(enriched, queryResult, metricId, dataset) {
    if (enriched.length === 0) return Promise.resolve('无异常');
    const first = enriched[0];
    const dir = first.direction === 'up' ? '上涨' : '下跌';

    // 真实 LLM 生成自然语言总结
    const systemPrompt = `你是一个数据分析 agent. 用中文给出一段简洁的总结 (2-3 句话), 包含:
1. 检测到的异常情况 (数量, 方向, 严重程度)
2. 可能的原因 (基于异常类型)
3. 建议的下一步行动
不要用 markdown 格式, 直接给纯文本.`;

    const anomalyList = enriched.map(a => `- ${a.date}: ${a.direction === 'up' ? '↑' : '↓'} 偏离 ${a.sigma}σ (值=${a.value?.toFixed(0)})`).join('\n');
    const datasetName = dataset === 'ecommerce' ? '电商' : 'App';
    const userPrompt = `${datasetName}数据指标 ${metricId || 'N/A'} 的异常分析:\n\n异常点列表:\n${anomalyList}\n\n请给出总结.`;

    return this.llm.call(systemPrompt, userPrompt, { maxTokens: 300 })
      .catch(e => {
        console.error('   LLM 总结失败:', e.message.slice(0, 80));
        return `检测到 ${enriched.length} 个异常点, 主要是 ${first.date} 偏离 ${first.sigma}σ (${dir})`;
      });
  }
}

module.exports = { DataAnalyzer };

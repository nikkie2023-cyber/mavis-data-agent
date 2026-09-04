// Orchestrator: 意图识别 + 任务路由 + 多 skill 调度
// v0.3: 全部走 skill registry (registry.invoke), 不直接 import 业务模块
//
// 路由策略 (与 v0.2 一致):
//   简单查询 (e.g. "DAU 多少")    → data-fetch + audit
//   归因分析 (e.g. "DAU 为啥跌了") → data-fetch + audit + anomaly + audit + report + feishu-push

const { DataFetcher } = require('./data-fetcher');
const { MetricResolver } = require('./metric-catalog');
const { createLLM } = require('./llm');
const { defaultRegistry, SkillRegistry } = require('./skill-registry');
const { registerAll } = require('./skills');

class Orchestrator {
  constructor(llm, opts = {}) {
    this.llm = llm || createLLM();
    this.fetcher = new DataFetcher();
    this.resolver = new MetricResolver(this.fetcher);
    // v0.3: 默认用全局 registry, 测试时可以用 opts.registry 注入隔离环境
    this.registry = opts.registry || defaultRegistry;
    registerAll(this.registry, {
      fetcher: this.fetcher,
      llm: this.llm,
      outputDir: opts.outputDir
    });
    // 自动推飞书开关: 报告生成后自动 push
    this.autoPushFeishu = opts.autoPushFeishu ?? false;
  }

  classify(query) {
    const q = query.toLowerCase();
    const simpleKeywords = ['多少', '数量', '今天', '现在', '总量', '总和'];
    const analysisKeywords = ['为什么', '为啥', '怎么跌', '怎么涨', '暴跌', '飙升',
                              '异常', '归因', '分析', '原因', '为什么跌', '为什么涨', '崩'];
    const compareKeywords = ['对比', '比较', 'vs', '差异'];
    const exploreKeywords = ['看看', '探索', '最近'];

    if (analysisKeywords.some(kw => q.includes(kw))) return 'analysis';
    if (compareKeywords.some(kw => q.includes(kw))) return 'compare';
    if (exploreKeywords.some(kw => q.includes(kw))) return 'explore';
    if (simpleKeywords.some(kw => q.includes(kw))) return 'simple';
    return 'analysis';
  }

  async run(query, onProgress = null) {
    const startTime = Date.now();
    const intent = this.classify(query);
    const steps = [];

    if (!this.fetcher._initialized) {
      await this.fetcher.init();
    }

    const emit = (type, data) => {
      if (onProgress) onProgress({ type, ...data, ts: Date.now() });
    };

    // Step 1: metric_resolution (直接调 resolver, 简单查找不抽 skill)
    emit('step_start', { name: 'metric_resolution', status: 'active' });
    const metric = this.resolver.resolve(query);
    steps.push({
      name: 'metric_resolution',
      status: metric ? 'pass' : 'fail',
      output: metric ? { id: metric.id, name: metric.name } : null,
      notes: metric ? `命中指标: ${metric.name}` : '未识别指标, 使用兜底'
    });
    emit('step_done', {
      name: 'metric_resolution',
      status: metric ? 'pass' : 'fail',
      detail: metric ? `命中指标: ${metric.name}` : '未识别',
      timing: `${Date.now() - startTime}ms`
    });

    if (!metric) {
      return { status: 'fail', intent, steps, error: '无法识别问题对应的指标' };
    }

    // Step 2: data_fetch (调 skill)
    const fetchStart = Date.now();
    emit('step_start', { name: 'data_fetch', status: 'active', detail: '从数据集取数...' });
    const fullRange = { start: '2026-08-04', end: '2026-09-02' };

    let queryResult;
    let sourceInfo;
    try {
      // 优先用 skill
      const fetchResp = await this.registry.invoke('data-fetch', { metricId: metric.id, timeRange: fullRange });
      queryResult = fetchResp.rows;
      sourceInfo = { mode: fetchResp.source, sql: fetchResp.sql || '', rows: queryResult.length, duration_ms: 0 };
    } catch (e) {
      // fallback 直接调
      queryResult = this.resolver.execute(metric.id, fullRange);
      sourceInfo = { mode: this.fetcher.getMode(), sql: '', rows: queryResult.length, duration_ms: 0 };
    }

    const fetchStatus = queryResult && queryResult.length > 0 ? 'pass' : 'fail';
    const dataSource = this.fetcher.getMode();

    // 收集 SQL audit log 最后一条 (SQL 模式)
    let lastAudit = null;
    if (dataSource === 'sql' && this.fetcher._impl?.auditLog) {
      lastAudit = this.fetcher._impl.auditLog[this.fetcher._impl.auditLog.length - 1] || null;
    }

    steps.push({
      name: 'data_fetch',
      status: fetchStatus,
      output: { rows: queryResult.length, sample: queryResult[0] },
      notes: `取到 ${queryResult.length} 行数据`
    });
    emit('step_done', {
      name: 'data_fetch',
      status: fetchStatus,
      detail: `取到 ${queryResult.length} 行, 第一行: ${JSON.stringify(queryResult[0] || {}).slice(0, 80)}`,
      timing: `${Date.now() - fetchStart}ms`
    });

    // Step 2.5: audit_log (v0.2 步骤)
    if (dataSource === 'sql') {
      const auditStart = Date.now();
      emit('step_start', { name: 'audit_log', status: 'active', detail: '记录 SQL 审计日志' });
      this.fetcher.flushAudit();
      emit('step_done', {
        name: 'audit_log',
        status: 'pass',
        detail: '审计日志已写入 output/audit.log',
        timing: `${Date.now() - auditStart}ms`
      });
      steps.push({
        name: 'audit_log',
        status: 'pass',
        output: { log: 'output/audit.log' },
        notes: '记录 query/rows/duration'
      });
    }
    if (fetchStatus === 'fail') {
      return { status: 'fail', intent, steps, error: '取数失败' };
    }

    const fullPipeline = intent === 'analysis' || intent === 'compare';

    if (fullPipeline) {
      // Step 3: anomaly_detection (调 skill)
      const anomalyStart = Date.now();
      emit('step_start', { name: 'anomaly_detection', status: 'active', detail: 'z-score 异常检测 + 自动验证' });
      const analysis = await this.registry.invoke('anomaly', {
        queryResult, metric: metric.id, dataset: metric.dataset, table: metric.table,
        dimensions: metric.dimensions
      });
      steps.push({
        name: 'anomaly_detection',
        status: analysis.status === 'anomaly_detected' ? 'pass' : 'warn',
        output: { anomalies: analysis.anomalies.length, summary: analysis.summary },
        notes: analysis.summary
      });
      emit('step_done', {
        name: 'anomaly_detection',
        status: 'pass',
        detail: `检测到 ${analysis.anomalies.length} 个异常, ${analysis.summary?.slice(0, 60) || ''}`,
        timing: `${Date.now() - anomalyStart}ms (含 LLM)`
      });

      // Step 4: data_validation (调 skill)
      const validStart = Date.now();
      emit('step_start', { name: 'data_validation', status: 'active' });
      const validation = await this.registry.invoke('audit', {
        queryResult, dataset: metric.dataset, table: metric.table, valueMin: 0
      });
      steps.push({
        name: 'data_validation',
        status: validation.status,
        output: { checks: validation.checks.length, pass: validation.checks.filter(c => c.status === 'pass').length },
        notes: validation.summary
      });
      emit('step_done', {
        name: 'data_validation',
        status: validation.status,
        detail: validation.summary,
        timing: `${Date.now() - validStart}ms`
      });

      // Step 5: report_generation (调 skill, 含 sourceInfo)
      const reportStart = Date.now();
      emit('step_start', { name: 'report_generation', status: 'active', detail: '生成 HTML dashboard' });
      const fullSourceInfo = {
        ...sourceInfo,
        sql: lastAudit?.sql || sourceInfo.sql,
        duration_ms: lastAudit?.duration_ms || 0,
        ts: lastAudit?.ts || new Date().toISOString()
      };
      const report = await this.registry.invoke('report', {
        title: `${metric.name} 分析`,
        metric: metric.name,
        metricId: metric.id,
        queryResult, analysis, validation,
        dataset: metric.dataset,
        timeRange: fullRange,
        sourceInfo: fullSourceInfo
      });
      steps.push({
        name: 'report_generation',
        status: 'pass',
        output: { path: report.path, size: report.size },
        notes: `报告 ${report.taskId}`
      });
      emit('step_done', {
        name: 'report_generation',
        status: 'pass',
        detail: `${report.size} bytes, ${report.taskId}`,
        timing: `${Date.now() - reportStart}ms`
      });
      emit('report_ready', { url: `/report/${report.taskId}.html`, taskId: report.taskId });

      // Step 6: feishu_push (v0.3 新增, 可选, 默认 mock 模式)
      let feishuResult = null;
      if (this.autoPushFeishu || process.env.AUTO_PUSH_FEISHU === '1') {
        const feishuStart = Date.now();
        emit('step_start', { name: 'feishu_push', status: 'active', detail: '推送飞书' });
        feishuResult = await this.registry.invoke('feishu-push', {
          title: `🚨 ${metric.name} 分析`,
          summary: analysis.summary,
          metric: metric.name,
          anomalyCount: analysis.anomalies.length,
          reportUrl: `/report/${report.taskId}.html`
        });
        emit('step_done', {
          name: 'feishu_push',
          status: feishuResult.ok ? 'pass' : 'fail',
          detail: `${feishuResult.mode} 模式, ${feishuResult.error || 'OK'}`,
          timing: `${Date.now() - feishuStart}ms`
        });
        steps.push({
          name: 'feishu_push',
          status: feishuResult.ok ? 'pass' : 'warn',
          output: { mode: feishuResult.mode },
          notes: feishuResult.error || `已推 (${feishuResult.mode})`
        });
      }

      emit('final_answer', {
        summary: analysis.summary || '分析完成',
        metric: metric.name,
        metricId: metric.id,
        reportUrl: `/report/${report.taskId}.html`,
        llmStats: this.llm.callCount > 0 ? {
          mode: this.llm.mode, calls: this.llm.callCount,
          tokens: this.llm.totalTokens, cost: this.llm.totalCost
        } : null,
        feishu: feishuResult ? { ok: feishuResult.ok, mode: feishuResult.mode } : null
      });

      return {
        status: 'complete', intent, steps, metric, analysis, validation, report,
        duration_ms: Date.now() - startTime,
        llm_stats: this.llm.callCount > 0 ? {
          mode: this.llm.mode, calls: this.llm.callCount,
          tokens: this.llm.totalTokens, cost: this.llm.totalCost
        } : null,
        feishu: feishuResult
      };
    } else {
      // 简单查询: 只验证, 不生成报告
      const validStart = Date.now();
      emit('step_start', { name: 'data_validation', status: 'active' });
      const validation = await this.registry.invoke('audit', {
        queryResult, dataset: metric.dataset, table: metric.table
      });
      steps.push({
        name: 'data_validation',
        status: validation.status,
        output: { checks: validation.checks.length },
        notes: validation.summary
      });
      emit('step_done', {
        name: 'data_validation',
        status: validation.status,
        detail: validation.summary,
        timing: `${Date.now() - validStart}ms`
      });

      const latest = queryResult[queryResult.length - 1];
      const total = queryResult.reduce((s, r) => s + (r.value || 0), 0);
      const summaryText = `${metric.name}: 最新值 ${latest?.value?.toFixed(2) || 'N/A'} (${latest?.dt || ''}), 30 天累计 ${total.toFixed(2)}`;
      emit('final_answer', {
        summary: summaryText, metric: metric.name, metricId: metric.id,
        reportUrl: null, llmStats: null, feishu: null
      });

      return {
        status: 'complete', intent, steps, metric,
        result: queryResult, validation,
        duration_ms: Date.now() - startTime
      };
    }
  }
}

module.exports = { Orchestrator };

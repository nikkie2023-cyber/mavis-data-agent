// DataFetcher: v0.2 委派版, 默认走 SQL, env DATA_SOURCE=csv 切到 CsvFetcher
//
// 设计 (PM 视角):
//   - 默认 SQL 模式, 让 demo 走真实路径 (性能差异自然暴露在 eval)
//   - env 切换, 一行回退到 CSV (演示 "渐进迁移" 的产品策略)
//   - 业务方法在 init 后是同步的, 跟 v0.1 保持兼容 (test 几乎不用改)
//   - 内部 _impl 委派, 不污染业务代码

const { SqlDataSource } = require('./sql-source');
const { CsvFetcher } = require('./csv-fetcher');

class DataFetcher {
  constructor() {
    this.source = (process.env.DATA_SOURCE || 'sql').toLowerCase();
    this._impl = null;
    this._initialized = false;
  }

  async init() {
    if (this._initialized) return;
    if (this.source === 'sql') {
      this._impl = new SqlDataSource();
      await this._impl.init();
    } else {
      this._impl = new CsvFetcher();
    }
    this._initialized = true;
  }

  getMode() { return this.source; }

  // 写 audit log (只在 SQL 模式有意义; CSV 模式 no-op)
  flushAudit() {
    if (this._impl && typeof this._impl.flushAudit === 'function') {
      this._impl.flushAudit();
    }
  }

  // 通用 query (给 data-analyzer 维度拆解用)
  query(dataset, table, opts) {
    if (typeof this._impl.query !== 'function') {
      throw new Error(`Data source "${this.source}" 不支持通用 query()`);
    }
    return this._impl.query(dataset, table, opts);
  }

  // ============ 业务方法 — 全部委派到 _impl (同步, 假设 init 完) ============
  ecommerceGMV(range)                 { return this._impl.ecommerceGMV(range); }
  ecommerceDailyOrders(range)         { return this._impl.ecommerceDailyOrders(range); }
  ecommerceAOV(range)                 { return this._impl.ecommerceAOV(range); }
  ecommerceConversion(range)          { return this._impl.ecommerceConversion(range); }
  ecommerceByChannel(range)           { return this._impl.ecommerceByChannel(range); }
  ecommerceRefundRate(range)          { return this._impl.ecommerceRefundRate(range); }
  appDAU(range)                       { return this._impl.appDAU(range); }
  appDailyEvents(range)               { return this._impl.appDailyEvents(range); }
  appEventBreakdown(range)            { return this._impl.appEventBreakdown(range); }
  appByPlatform(range)                { return this._impl.appByPlatform(range); }
  appAvgSessionDuration(range)        { return this._impl.appAvgSessionDuration(range); }
  appEventPerSession(range)           { return this._impl.appEventPerSession(range); }
  appRetentionD1(range)               { return this._impl.appRetentionD1(range); }
  ecommerceTotalGMV(range)            { return this._impl.ecommerceTotalGMV ? this._impl.ecommerceTotalGMV(range) : this._totalGMV(range); }
  loadEcommerce()                     { return this._impl.loadEcommerce ? this._impl.loadEcommerce() : null; }
  loadApp()                           { return this._impl.loadApp ? this._impl.loadApp() : null; }

  // CSV-only 兼容
  _totalGMV(range) {
    const daily = this.ecommerceGMV(range);
    const total = daily.reduce((sum, d) => sum + d.value, 0);
    return [{ value: total, days: daily.length }];
  }
}

module.exports = { DataFetcher };

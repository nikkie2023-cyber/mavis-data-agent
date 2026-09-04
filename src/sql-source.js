// Mavis Data Agent v0.2 - SQL 数据源
//
// 核心设计 (PM 视角):
//   - 预定义 SQL 模板, 不靠 LLM 生成 SQL (稳定性 + 可审计)
//   - 只用 SELECT, 无 DDL/DML (read-only 安全模型)
//   - 每次 query 自动写 audit log (合规 + 排错)
//   - sql.js (纯 WASM) 零编译, 跨平台; v0.4 切 MySQL 只换 driver
//
// 用法:
//   const ds = new SqlDataSource();
//   await ds.init();
//   const rows = ds.ecomGMV({start: '2026-08-04', end: '2026-09-02'});
//   await ds.close();

const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const DB_PATH = path.join(__dirname, '..', 'data', 'analytics.db');
const AUDIT_PATH = path.join(__dirname, '..', 'output', 'audit.log');

// ============ 预定义 SQL 模板 (v0.2 范围) ============
// 设计原则:
//   1. 每条 SQL 都用 ? 参数化, 防注入
//   2. 输出列名统一: dt (日期) + value (数值) + 可选 extra (total/count 等)
//   3. 时间过滤: start/end 形参, 缺省时取全量
//   4. 表名加 ecom_/app_ 前缀, 避免冲突

const SQL = {
  ecom_gmv: `
    SELECT order_date AS dt, SUM(order_amount) AS value
    FROM ecom_orders
    WHERE status = 'paid'
      AND order_date >= ? AND order_date <= ?
    GROUP BY order_date
    ORDER BY order_date`,

  ecom_daily_orders: `
    SELECT order_date AS dt, COUNT(*) AS value
    FROM ecom_orders
    WHERE status = 'paid'
      AND order_date >= ? AND order_date <= ?
    GROUP BY order_date
    ORDER BY order_date`,

  ecom_aov: `
    SELECT order_date AS dt, AVG(order_amount) AS value
    FROM ecom_orders
    WHERE status = 'paid'
      AND order_date >= ? AND order_date <= ?
    GROUP BY order_date
    ORDER BY order_date`,

  ecom_conversion: `
    WITH daily_orders AS (
      SELECT order_date AS dt, COUNT(*) AS n
      FROM ecom_orders
      WHERE status = 'paid'
        AND order_date >= ? AND order_date <= ?
      GROUP BY order_date
    ),
    daily_sessions AS (
      SELECT session_date AS dt, COUNT(*) AS n
      FROM ecom_sessions
      WHERE session_date >= ? AND session_date <= ?
      GROUP BY session_date
    )
    SELECT COALESCE(o.dt, s.dt) AS dt,
           COALESCE(o.n, 0) AS orders,
           COALESCE(s.n, 0) AS sessions,
           CASE WHEN COALESCE(s.n, 0) > 0
                THEN CAST(COALESCE(o.n, 0) AS REAL) / s.n
                ELSE 0 END AS value
    FROM daily_orders o
    FULL OUTER JOIN daily_sessions s USING (dt)
    ORDER BY dt`,

  ecom_refund_rate: `
    SELECT
      SUM(CASE WHEN status = 'refunded' THEN 1 ELSE 0 END) AS refunded,
      COUNT(*) AS total,
      CAST(SUM(CASE WHEN status = 'refunded' THEN 1 ELSE 0 END) AS REAL) / COUNT(*) AS value
    FROM ecom_orders
    WHERE order_date >= ? AND order_date <= ?`,

  app_dau: `
    SELECT substr(event_time, 1, 10) AS dt, COUNT(DISTINCT user_id) AS value
    FROM app_events
    WHERE event_time >= ? AND event_time <= ?
    GROUP BY dt
    ORDER BY dt`,

  app_daily_events: `
    SELECT substr(event_time, 1, 10) AS dt, COUNT(*) AS value
    FROM app_events
    WHERE event_time >= ? AND event_time <= ?
    GROUP BY dt
    ORDER BY dt`,

  app_avg_session_duration: `
    SELECT
      AVG(duration_sec) AS value,
      COUNT(*) AS total,
      SUM(duration_sec) AS sum_duration
    FROM app_sessions
    WHERE start_time >= ? AND start_time <= ?`,

  app_event_per_session: `
    WITH ev AS (
      SELECT COUNT(*) AS n FROM app_events
      WHERE event_time >= ? AND event_time <= ?
    ),
    ss AS (
      SELECT COUNT(*) AS n FROM app_sessions
      WHERE start_time >= ? AND start_time <= ?
    )
    SELECT ev.n AS events, ss.n AS sessions,
           CASE WHEN ss.n > 0 THEN CAST(ev.n AS REAL) / ss.n ELSE 0 END AS value
    FROM ev, ss`,

  app_retention_d1: `
    SELECT
      SUM(CASE WHEN retained THEN 1 ELSE 0 END) AS retained,
      COUNT(*) AS total,
      CAST(SUM(CASE WHEN retained THEN 1 ELSE 0 END) AS REAL) / COUNT(*) AS value
    FROM (
      SELECT u.user_id,
        CASE WHEN EXISTS(
          SELECT 1 FROM app_events e
          WHERE e.user_id = u.user_id
            AND substr(e.event_time, 1, 10) = date(u.register_date, '+1 day')
        ) THEN 1 ELSE 0 END AS retained
      FROM app_users u
    )`,

  // 下面 3 个是老 DataFetcher 里的 method, v0.2 SQL 模式也支持
  ecommerce_by_channel: `
    SELECT channel AS group_key, SUM(order_amount) AS value
    FROM ecom_orders
    WHERE status = 'paid'
      AND order_date >= ? AND order_date <= ?
    GROUP BY channel
    ORDER BY value DESC`,

  app_event_breakdown: `
    SELECT event_type AS group_key, COUNT(*) AS value
    FROM app_events
    WHERE event_time >= ? AND event_time <= ?
    GROUP BY event_type
    ORDER BY value DESC`,

  app_by_platform: `
    SELECT platform AS group_key, COUNT(DISTINCT user_id) AS value
    FROM app_events
    WHERE event_time >= ? AND event_time <= ?
    GROUP BY platform
    ORDER BY value DESC`
};

// 默认时间范围 (跟 v0.1 一致, 让 v0.2 兼容)
const DEFAULT_RANGE = { start: '2026-08-04', end: '2026-09-02' };

class SqlDataSource {
  constructor(dbPath = DB_PATH) {
    this.dbPath = dbPath;
    this.SQL = null;
    this.db = null;
    this.auditLog = [];
    this.connected = false;
  }

  async init() {
    if (this.connected) return;
    this.SQL = await initSqlJs();
    if (!fs.existsSync(this.dbPath)) {
      throw new Error(`SQLite db 不存在: ${this.dbPath}\n请先跑: node data/seed_sqlite.js`);
    }
    const buffer = fs.readFileSync(this.dbPath);
    this.db = new this.SQL.Database(buffer);
    this.connected = true;
  }

  async close() {
    if (!this.connected) return;
    this.flushAudit();
    this.db.close();
    this.connected = false;
  }

  // ============ 内部: 执行 SQL + audit ============
  _run(metric, sql, params) {
    if (!this.connected) throw new Error('SqlDataSource 未 init, 请先 await ds.init()');
    const start = Date.now();
    let rows, error = null;
    try {
      const stmt = this.db.prepare(sql);
      stmt.bind(params);
      rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      stmt.free();
    } catch (e) {
      error = e.message;
      throw e;
    } finally {
      this.auditLog.push({
        ts: new Date().toISOString(),
        metric,
        sql: sql.replace(/\s+/g, ' ').trim().slice(0, 200),
        params,
        rows: rows ? rows.length : 0,
        duration_ms: Date.now() - start,
        source: 'sql',
        error
      });
    }
    return rows;
  }

  flushAudit() {
    if (this.auditLog.length === 0) return;
    const dir = path.dirname(AUDIT_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const lines = this.auditLog.map(e => JSON.stringify(e)).join('\n') + '\n';
    fs.appendFileSync(AUDIT_PATH, lines);
    this.auditLog = [];
  }

  getAuditCount() { return this.auditLog.length; }

  // ============ 10 个 metric 业务方法 ============
  // 方法名跟原 DataFetcher 完全一致, 让 orchestrator + tests 无缝切换
  // 输出格式也保持一致 (dt, value, group_key, ...)

  ecommerceGMV(range = DEFAULT_RANGE) {
    return this._run('ecom_gmv', SQL.ecom_gmv, [range.start, range.end])
      .map(r => ({ dt: r.dt, value: r.value }));
  }

  ecommerceDailyOrders(range = DEFAULT_RANGE) {
    return this._run('ecom_daily_orders', SQL.ecom_daily_orders, [range.start, range.end])
      .map(r => ({ dt: r.dt, value: r.value }));
  }

  ecommerceAOV(range = DEFAULT_RANGE) {
    return this._run('ecom_aov', SQL.ecom_aov, [range.start, range.end])
      .map(r => ({ dt: r.dt, value: r.value }));
  }

  ecommerceConversion(range = DEFAULT_RANGE) {
    return this._run('ecom_conversion', SQL.ecom_conversion,
      [range.start, range.end, range.start, range.end])
      .map(r => ({ dt: r.dt, orders: r.orders, sessions: r.sessions, value: r.value }));
  }

  ecommerceRefundRate(range = DEFAULT_RANGE) {
    const rows = this._run('ecom_refund_rate', SQL.ecom_refund_rate, [range.start, range.end]);
    const r = rows[0] || {};
    return [{ value: r.value || 0, total: r.total || 0, refunded: r.refunded || 0 }];
  }

  ecommerceByChannel(range = DEFAULT_RANGE) {
    return this._run('ecommerce_by_channel', SQL.ecommerce_by_channel, [range.start, range.end])
      .map(r => ({ group_key: r.group_key, value: r.value }));
  }

  appDAU(range = DEFAULT_RANGE) {
    return this._run('app_dau', SQL.app_dau, [range.start, range.end])
      .map(r => ({ dt: r.dt, value: r.value }));
  }

  appDailyEvents(range = DEFAULT_RANGE) {
    return this._run('app_daily_events', SQL.app_daily_events, [range.start, range.end])
      .map(r => ({ dt: r.dt, value: r.value }));
  }

  appEventBreakdown(range = DEFAULT_RANGE) {
    return this._run('app_event_breakdown', SQL.app_event_breakdown, [range.start, range.end])
      .map(r => ({ group_key: r.group_key, value: r.value }));
  }

  appByPlatform(range = DEFAULT_RANGE) {
    return this._run('app_by_platform', SQL.app_by_platform, [range.start, range.end])
      .map(r => ({ group_key: r.group_key, value: r.value }));
  }

  appAvgSessionDuration(range = DEFAULT_RANGE) {
    const rows = this._run('app_avg_session_duration', SQL.app_avg_session_duration,
      [range.start, range.end]);
    const r = rows[0] || {};
    return [{ value: r.value || 0, total: r.total || 0, sum_duration: r.sum_duration || 0 }];
  }

  appEventPerSession(range = DEFAULT_RANGE) {
    const rows = this._run('app_event_per_session', SQL.app_event_per_session,
      [range.start, range.end, range.start, range.end]);
    const r = rows[0] || {};
    return [{ value: r.value || 0, events: r.events || 0, sessions: r.sessions || 0 }];
  }

  appRetentionD1(range = DEFAULT_RANGE) {
    const rows = this._run('app_retention_d1', SQL.app_retention_d1, []);
    const r = rows[0] || {};
    return [{ value: r.value || 0, total: r.total || 0, retained: r.retained || 0 }];
  }

  // ============ 兼容原 DataFetcher.loadXxx() 风格 ============
  // 一些 test 拿原始表行做验证; SQL 模式用 SELECT * 返回数组
  loadEcommerce() {
    return {
      users: this._raw('SELECT * FROM ecom_users'),
      products: this._raw('SELECT * FROM ecom_products'),
      orders: this._raw('SELECT * FROM ecom_orders'),
      sessions: this._raw('SELECT * FROM ecom_sessions')
    };
  }

  loadApp() {
    return {
      users: this._raw('SELECT * FROM app_users'),
      events: this._raw('SELECT * FROM app_events'),
      sessions: this._raw('SELECT * FROM app_sessions')
    };
  }

  _raw(sql) {
    if (!this.connected) return [];
    const stmt = this.db.prepare(sql);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  }

  // ============ 通用 query (供 data-analyzer 做维度拆解等动态查询) ============
  // 输入: { dataset, table, dateCol, dateRange, filters, groupBy, agg }
  // 输出: [{ dt, group_key?, value }, ...]
  // 安全: 不接外部 user input, 内部 agent 编排用
  query(dataset, table, opts = {}) {
    const { dateCol, dateRange, filters, groupBy = [], agg } = opts;
    const fullTable = `${dataset === 'ecommerce' ? 'ecom' : 'app'}_${table}`;

    const selectParts = [];
    if (dateCol) selectParts.push(`${dateCol} AS dt`);
    groupBy.forEach(g => selectParts.push(g));
    if (agg) {
      const op = agg.op === 'distinct'
        ? `COUNT(DISTINCT ${agg.col})`
        : `${agg.op.toUpperCase()}(${agg.col})`;
      selectParts.push(`${op} AS value`);
    }
    if (selectParts.length === 0) selectParts.push('*');

    let sql = `SELECT ${selectParts.join(', ')} FROM ${fullTable}`;
    const where = [];
    if (dateCol && dateRange) {
      where.push(`${dateCol} >= '${dateRange.start || '0000-00-00'}'`);
      where.push(`${dateCol} <= '${dateRange.end || '9999-99-99'}'`);
    }
    if (filters) {
      Object.entries(filters).forEach(([col, val]) => {
        if (Array.isArray(val)) {
          where.push(`${col} IN (${val.map(v => `'${v}'`).join(',')})`);
        } else {
          where.push(`${col} = '${val}'`);
        }
      });
    }
    if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
    if (groupBy.length) {
      const groupCols = [];
      if (dateCol) groupCols.push(dateCol);
      groupCols.push(...groupBy);
      sql += ` GROUP BY ${groupCols.join(', ')}`;
    }
    if (dateCol) sql += ` ORDER BY ${dateCol}`;

    const rows = this._run('query', sql, []);
    // 给 groupBy 加 group_key 字段 (跟 CsvFetcher 行为一致)
    if (groupBy.length) {
      return rows.map(r => ({ ...r, group_key: groupBy.map(g => r[g]).join('|') }));
    }
    return rows;
  }
}

module.exports = { SqlDataSource, SQL_TEMPLATES: SQL, DEFAULT_RANGE };

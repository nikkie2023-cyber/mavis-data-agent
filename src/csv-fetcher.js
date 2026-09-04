// CsvFetcher: v0.1 原始实现, CSV 内存计算
// v0.2 fallback 用 — 当 DATA_SOURCE=csv 时启用
// 设计: 不依赖 SQL 引擎, 全内存 group/agg

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

class CsvFetcher {
  constructor() {
    this.cache = { ecommerce: null, app: null };
  }

  loadEcommerce() {
    if (this.cache.ecommerce) return this.cache.ecommerce;
    const dir = path.join(DATA_DIR, 'ecommerce');
    this.cache.ecommerce = {
      users: this._readCSV(path.join(dir, 'users.csv')),
      products: this._readCSV(path.join(dir, 'products.csv')),
      orders: this._readCSV(path.join(dir, 'orders.csv')),
      sessions: this._readCSV(path.join(dir, 'sessions.csv'))
    };
    return this.cache.ecommerce;
  }

  loadApp() {
    if (this.cache.app) return this.cache.app;
    const dir = path.join(DATA_DIR, 'app');
    this.cache.app = {
      users: this._readCSV(path.join(dir, 'users.csv')),
      events: this._readCSV(path.join(dir, 'events.csv')),
      sessions: this._readCSV(path.join(dir, 'sessions.csv'))
    };
    return this.cache.app;
  }

  query(dataset, table, opts = {}) {
    const data = dataset === 'ecommerce' ? this.loadEcommerce() : this.loadApp();
    let rows = data[table];
    if (!rows) throw new Error(`Table ${table} not in ${dataset}`);

    const numericFields = ['order_amount', 'price', 'cost', 'duration_sec', 'page_count', 'event_count'];
    rows = rows.map(r => {
      const copy = { ...r };
      numericFields.forEach(f => {
        if (copy[f] !== undefined && copy[f] !== '') copy[f] = parseFloat(copy[f]);
      });
      return copy;
    });

    if (opts.dateCol && opts.dateRange) {
      const { start, end } = opts.dateRange;
      const startDate = start || '0000-00-00';
      const endDate = end || '9999-99-99';
      rows = rows.filter(r => {
        const d = (r[opts.dateCol] || '').slice(0, 10);
        return d >= startDate && d <= endDate;
      });
    }

    if (opts.filters) {
      Object.entries(opts.filters).forEach(([col, val]) => {
        if (Array.isArray(val)) rows = rows.filter(r => val.includes(r[col]));
        else rows = rows.filter(r => r[col] === val);
      });
    }

    if (opts.groupBy) {
      const groups = {};
      rows.forEach(r => {
        const dateVal = opts.dateCol ? (r[opts.dateCol] || '').slice(0, 10) : 'all';
        const groupKey = opts.groupBy.map(g => r[g] ?? '').join('|');
        const key = `${dateVal}|${groupKey}`;
        if (!groups[key]) groups[key] = { dt: dateVal, group_key: groupKey, _rows: [] };
        groups[key]._rows.push(r);
      });
      return Object.values(groups).map(g => {
        const { _rows, ...rest } = g;
        if (opts.agg) {
          const { col, op } = opts.agg;
          const values = _rows.map(r => r[col]).filter(v => !isNaN(parseFloat(v)));
          if (op === 'count') rest.value = _rows.length;
          else if (op === 'sum') rest.value = values.reduce((a, b) => a + b, 0);
          else if (op === 'avg') rest.value = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
          else if (op === 'distinct') rest.value = new Set(_rows.map(r => r[col])).size;
        }
        return rest;
      }).sort((a, b) => (a.dt || '').localeCompare(b.dt || ''));
    }

    return rows;
  }

  ecommerceGMV(dateRange) {
    return this.query('ecommerce', 'orders', {
      dateCol: 'order_date', dateRange,
      filters: { status: 'paid' },
      groupBy: [],
      agg: { col: 'order_amount', op: 'sum' }
    });
  }

  ecommerceTotalGMV(dateRange) {
    const daily = this.ecommerceGMV(dateRange);
    const total = daily.reduce((sum, d) => sum + d.value, 0);
    return [{ value: total, days: daily.length }];
  }

  ecommerceDailyOrders(dateRange) {
    return this.query('ecommerce', 'orders', {
      dateCol: 'order_date', dateRange,
      filters: { status: 'paid' },
      groupBy: [],
      agg: { col: 'order_id', op: 'count' }
    }).map(r => ({ ...r, value: r.value }));
  }

  ecommerceAOV(dateRange) {
    return this.query('ecommerce', 'orders', {
      dateCol: 'order_date', dateRange,
      filters: { status: 'paid' },
      groupBy: [],
      agg: { col: 'order_amount', op: 'avg' }
    });
  }

  ecommerceConversion(dateRange) {
    const orders = this.query('ecommerce', 'orders', {
      dateCol: 'order_date', dateRange,
      filters: { status: 'paid' }
    });
    const sessions = this.query('ecommerce', 'sessions', {
      dateCol: 'session_date', dateRange
    });
    const orderDates = new Set(orders.map(o => o.order_date));
    const sessionDates = new Set(sessions.map(s => s.session_date));
    const allDates = [...new Set([...orderDates, ...sessionDates])].sort();
    return allDates.map(dt => {
      const o = orders.filter(x => x.order_date === dt).length;
      const s = sessions.filter(x => x.session_date === dt).length;
      return { dt, orders: o, sessions: s, value: s > 0 ? o / s : 0 };
    });
  }

  ecommerceByChannel(dateRange) {
    return this.query('ecommerce', 'orders', {
      dateCol: 'order_date', dateRange,
      filters: { status: 'paid' },
      groupBy: ['channel'],
      agg: { col: 'order_amount', op: 'sum' }
    });
  }

  appDAU(dateRange) {
    return this.query('app', 'events', {
      dateCol: 'event_time', dateRange,
      groupBy: [],
      agg: { col: 'user_id', op: 'distinct' }
    });
  }

  appDailyEvents(dateRange) {
    return this.query('app', 'events', {
      dateCol: 'event_time', dateRange,
      groupBy: [],
      agg: { col: 'event_id', op: 'count' }
    });
  }

  appEventBreakdown(dateRange) {
    return this.query('app', 'events', {
      dateCol: 'event_time', dateRange,
      groupBy: ['event_type'],
      agg: { col: 'event_id', op: 'count' }
    });
  }

  appByPlatform(dateRange) {
    return this.query('app', 'events', {
      dateCol: 'event_time', dateRange,
      groupBy: ['platform'],
      agg: { col: 'user_id', op: 'distinct' }
    });
  }

  ecommerceRefundRate(dateRange) {
    const orders = this.loadEcommerce().orders;
    const dateFiltered = orders.filter(o => {
      if (!dateRange) return true;
      return o.order_date >= (dateRange.start || '0000-00-00') && o.order_date <= (dateRange.end || '9999-99-99');
    });
    const total = dateFiltered.length;
    const refunded = dateFiltered.filter(o => o.status === 'refunded').length;
    return [{ value: total > 0 ? refunded / total : 0, total, refunded }];
  }

  appAvgSessionDuration(dateRange) {
    const sessions = this.loadApp().sessions;
    const dateFiltered = sessions.filter(s => {
      if (!dateRange) return true;
      const d = (s.start_time || '').slice(0, 10);
      return d >= (dateRange.start || '0000-00-00') && d <= (dateRange.end || '9999-99-99');
    });
    const total = dateFiltered.length;
    const sumDuration = dateFiltered.reduce((s, x) => s + parseFloat(x.duration_sec || 0), 0);
    return [{ value: total > 0 ? sumDuration / total : 0, total, sum_duration: sumDuration }];
  }

  appEventPerSession(dateRange) {
    const events = this.loadApp().events;
    const sessions = this.loadApp().sessions;
    const eventDateFiltered = events.filter(e => {
      if (!dateRange) return true;
      const d = (e.event_time || '').slice(0, 10);
      return d >= (dateRange.start || '0000-00-00') && d <= (dateRange.end || '9999-99-99');
    });
    const sessionDateFiltered = sessions.filter(s => {
      if (!dateRange) return true;
      const d = (s.start_time || '').slice(0, 10);
      return d >= (dateRange.start || '0000-00-00') && d <= (dateRange.end || '9999-99-99');
    });
    return [{ value: sessionDateFiltered.length > 0 ? eventDateFiltered.length / sessionDateFiltered.length : 0,
              events: eventDateFiltered.length, sessions: sessionDateFiltered.length }];
  }

  appRetentionD1(dateRange) {
    const users = this.loadApp().users;
    const events = this.loadApp().events;
    const retention = users.map(u => {
      const regDate = u.register_date;
      if (!regDate) return { user_id: u.user_id, retained: 0 };
      const d1 = new Date(regDate);
      d1.setDate(d1.getDate() + 1);
      const d1Str = d1.toISOString().split('T')[0];
      const retained = events.some(e => e.user_id === u.user_id && (e.event_time || '').slice(0, 10) === d1Str);
      return { user_id: u.user_id, retained: retained ? 1 : 0 };
    });
    const total = retention.length;
    const retained = retention.filter(r => r.retained).length;
    return [{ value: total > 0 ? retained / total : 0, total, retained }];
  }

  _readCSV(filepath) {
    const content = fs.readFileSync(filepath, 'utf-8');
    const lines = content.trim().split('\n');
    const headers = lines[0].split(',');
    return lines.slice(1).map(line => {
      const values = line.split(',');
      const obj = {};
      headers.forEach((h, i) => obj[h] = values[i]);
      return obj;
    });
  }
}

module.exports = { CsvFetcher };

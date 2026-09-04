// Metric Catalog: 5 电商 + 5 app 指标
// 每个指标: id, name, dataset, query_name, synonyms, dims, format

const CATALOG = {
  // ============ 电商 (5) ============
  ecom_gmv: {
    id: 'ecom_gmv',
    name: '日 GMV (成交总额)',
    dataset: 'ecommerce',
    table: 'orders',
    query: 'ecommerceGMV',
    unit: '¥',
    format: 'currency',
    synonyms: ['gmv', '流水', '成交额', '大盘', '销售额', '营收'],
    dimensions: ['channel', 'country'],
    desc: '每日 paid 订单金额'
  },
  ecom_daily_orders: {
    id: 'ecom_daily_orders',
    name: '日订单数',
    dataset: 'ecommerce',
    table: 'orders',
    query: 'ecommerceDailyOrders',
    unit: '单',
    format: 'integer',
    synonyms: ['订单', '订单数', '日单', '出单'],
    dimensions: ['channel', 'country'],
    desc: '每日 paid 订单数量'
  },
  ecom_aov: {
    id: 'ecom_aov',
    name: '客单价 (AOV)',
    dataset: 'ecommerce',
    table: 'orders',
    query: 'ecommerceAOV',
    unit: '¥',
    format: 'currency',
    synonyms: ['客单价', 'aov', '单均价', '平均订单金额'],
    dimensions: ['channel', 'country'],
    desc: '平均每单金额'
  },
  ecom_conversion: {
    id: 'ecom_conversion',
    name: '转化率',
    dataset: 'ecommerce',
    table: 'sessions',
    query: 'ecommerceConversion',
    unit: '%',
    format: 'percent',
    synonyms: ['转化率', '转化', '下单率', '付费率', '成交率'],
    dimensions: ['device'],
    desc: 'paid 订单数 / session 数'
  },
  ecom_refund_rate: {
    id: 'ecom_refund_rate',
    name: '退款率',
    dataset: 'ecommerce',
    table: 'orders',
    query: 'ecommerceRefundRate',
    unit: '%',
    format: 'percent',
    synonyms: ['退款率', '退款', '退货率'],
    dimensions: ['channel', 'country'],
    desc: 'refunded 订单 / 总订单'
  },

  // ============ App (5) ============
  app_dau: {
    id: 'app_dau',
    name: 'DAU (日活跃用户)',
    dataset: 'app',
    table: 'events',
    query: 'appDAU',
    unit: '人',
    format: 'integer',
    synonyms: ['dau', '日活', '日活量', '打开人数', '活跃用户', '今天来的人'],
    dimensions: ['platform'],
    desc: '每日有 events 的 distinct user_id'
  },
  app_daily_events: {
    id: 'app_daily_events',
    name: '日事件数',
    dataset: 'app',
    table: 'events',
    query: 'appDailyEvents',
    unit: '次',
    format: 'integer',
    synonyms: ['事件数', '日事件', 'pv', 'event count'],
    dimensions: ['event_type'],
    desc: '每日 events 总数'
  },
  app_avg_session_duration: {
    id: 'app_avg_session_duration',
    name: '人均 session 时长',
    dataset: 'app',
    table: 'sessions',
    query: 'appAvgSessionDuration',
    unit: '秒',
    format: 'duration',
    synonyms: ['session 时长', '使用时长', '人均时长', '平均时长', '停留时长'],
    dimensions: ['platform'],
    desc: '平均每个 session 的持续时间'
  },
  app_event_per_session: {
    id: 'app_event_per_session',
    name: '每 session 事件数',
    dataset: 'app',
    table: 'sessions',
    query: 'appEventPerSession',
    unit: '个',
    format: 'decimal',
    synonyms: ['每会话事件', '事件密度', 'session 深度', '使用深度'],
    dimensions: ['platform'],
    desc: '总事件数 / session 数'
  },
  app_retention_d1: {
    id: 'app_retention_d1',
    name: 'D1 次日留存',
    dataset: 'app',
    table: 'users',
    query: 'appRetentionD1',
    unit: '%',
    format: 'percent',
    synonyms: ['次日留存', 'd1 留存', 'd1', '留存', '粘性', '回头率'],
    dimensions: ['platform', 'install_source'],
    desc: '注册后第 1 天回访的比例'
  }
};

class MetricResolver {
  constructor(fetcher) {
    this.fetcher = fetcher;
  }

  // 通过同义词/ID 解析
  resolve(query) {
    const q = query.toLowerCase().trim();
    // 1. 直接 ID 匹配
    if (CATALOG[q]) return CATALOG[q];
    // 2. 同义词匹配
    for (const metric of Object.values(CATALOG)) {
      if (metric.synonyms.some(s => q.includes(s.toLowerCase()))) {
        return metric;
      }
    }
    return null;
  }

  // 列出所有指标
  list(dataset) {
    return Object.values(CATALOG).filter(m => !dataset || m.dataset === dataset);
  }

  // 执行指标
  execute(metricId, dateRange) {
    const metric = CATALOG[metricId];
    if (!metric) throw new Error(`Unknown metric: ${metricId}`);
    const queryFn = this.fetcher[metric.query];
    if (!queryFn) throw new Error(`Fetcher missing query: ${metric.query}`);
    return queryFn.call(this.fetcher, dateRange);
  }
}

module.exports = { CATALOG, MetricResolver };

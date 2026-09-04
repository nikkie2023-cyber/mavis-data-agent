// Data Validator: 完整性 + 范围 + 时序性 + 一致性

class DataValidator {
  constructor(fetcher) {
    this.fetcher = fetcher;
  }

  validate(queryResult, options = {}) {
    const { dataset, table, dateCol, expectedRows, valueMin, valueMax, isRaw = false } = options;
    const issues = [];
    const checks = [];

    // 自动检测: 如果数据有 'value' 字段, 默认是聚合结果; 否则是原始数据
    const isAggregated = !isRaw && queryResult[0]?.value !== undefined;

    // Check 1: 数组非空
    checks.push({
      name: 'result_not_empty',
      status: Array.isArray(queryResult) && queryResult.length > 0 ? 'pass' : 'fail',
      detail: `rows=${queryResult?.length || 0}`
    });
    if (!Array.isArray(queryResult) || queryResult.length === 0) {
      return { status: 'fail', issues: ['数据为空'], checks, recommendation: 'retry' };
    }

    // Check 2: 行数
    if (expectedRows) {
      const actualRows = queryResult.length;
      checks.push({
        name: 'row_count',
        status: actualRows === expectedRows ? 'pass' : 'warn',
        detail: `actual=${actualRows}, expected=${expectedRows}`
      });
      if (actualRows !== expectedRows) {
        issues.push(`行数 ${actualRows} != 预期 ${expectedRows}`);
      }
    }

    // Check 3: 数值范围 (仅聚合结果)
    if (isAggregated && (valueMin !== undefined || valueMax !== undefined)) {
      const outOfRange = queryResult.filter(r => {
        if (r.value === null || r.value === undefined || isNaN(r.value)) return false;
        if (valueMin !== undefined && r.value < valueMin) return true;
        if (valueMax !== undefined && r.value > valueMax) return true;
        return false;
      });
      checks.push({
        name: 'value_range',
        status: outOfRange.length === 0 ? 'pass' : 'fail',
        detail: `out_of_range=${outOfRange.length}`
      });
      if (outOfRange.length > 0) {
        issues.push(`${outOfRange.length} 行数值超界 [${valueMin}, ${valueMax}]`);
      }
    }

    // Check 4: 时序性 (聚合结果)
    if (isAggregated && (dateCol || queryResult[0]?.dt)) {
      const colName = dateCol || 'dt';
      const dates = queryResult.map(r => r[colName]).filter(d => d).sort();
      if (dates.length >= 2) {
        const gaps = this._findDateGaps(dates);
        checks.push({
          name: 'date_continuity',
          status: gaps.length === 0 ? 'pass' : 'fail',
          detail: `gaps=${gaps.length} ${gaps.length > 0 ? '[' + gaps.slice(0, 3).join(', ') + '...]' : ''}`
        });
        if (gaps.length > 0) {
          issues.push(`日期不连续, 缺失 ${gaps.length} 天: ${gaps.slice(0, 3).join(', ')}...`);
        }
      }
    }

    // Check 5: value 字段为 null/NaN (仅聚合)
    if (isAggregated) {
      const nullValues = queryResult.filter(r =>
        r.value === null || r.value === undefined || (typeof r.value === 'number' && isNaN(r.value))
      );
      checks.push({
        name: 'no_null_values',
        status: nullValues.length === 0 ? 'pass' : 'fail',
        detail: `nulls=${nullValues.length}`
      });
      if (nullValues.length > 0) {
        issues.push(`${nullValues.length} 行 value 为 null/NaN`);
      }
    }

    // Check 6: 必填字段 (仅原始数据, 显式 opt-in)
    if (isRaw && dataset && table) {
      const requiredFields = this._getRequiredFields(dataset, table);
      const missingFields = requiredFields.filter(f =>
        queryResult.some(r => r[f] === undefined || r[f] === '' || r[f] === null)
      );
      checks.push({
        name: 'required_fields',
        status: missingFields.length === 0 ? 'pass' : 'fail',
        detail: `missing=${missingFields.length}`
      });
      if (missingFields.length > 0) {
        issues.push(`必填字段缺失: ${missingFields.join(', ')}`);
      }
    }

    const failedChecks = checks.filter(c => c.status === 'fail').length;
    const status = failedChecks === 0 ? 'pass' : 'fail';
    const recommendation = failedChecks === 0 ? 'accept' : (issues.length > 3 ? 'investigate' : 'retry');

    return {
      status,
      issues,
      checks,
      recommendation,
      summary: `${checks.length} checks, ${checks.filter(c => c.status === 'pass').length} pass, ${failedChecks} fail`
    };
  }

  _findDateGaps(sortedDates) {
    const gaps = [];
    for (let i = 1; i < sortedDates.length; i++) {
      const prev = new Date(sortedDates[i - 1]);
      const curr = new Date(sortedDates[i]);
      const diffDays = (curr - prev) / (1000 * 60 * 60 * 24);
      if (diffDays > 1) {
        // 缺失的天数
        for (let d = 1; d < diffDays; d++) {
          const gap = new Date(prev);
          gap.setDate(gap.getDate() + d);
          gaps.push(gap.toISOString().split('T')[0]);
        }
      }
    }
    return gaps;
  }

  _getRequiredFields(dataset, table) {
    const fields = {
      ecommerce: {
        orders: ['order_id', 'user_id', 'order_date', 'order_amount', 'status'],
        users: ['user_id', 'register_date'],
        products: ['product_id', 'category', 'price'],
        sessions: ['session_id', 'user_id', 'session_date']
      },
      app: {
        events: ['event_id', 'user_id', 'event_time', 'event_type'],
        users: ['user_id', 'register_date'],
        sessions: ['session_id', 'user_id', 'start_time']
      }
    };
    return fields[dataset]?.[table] || [];
  }
}

module.exports = { DataValidator };

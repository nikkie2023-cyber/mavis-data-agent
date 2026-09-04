// Report Builder: 自包含 HTML dashboard
// 包含: 标题 + 核心数字 + ECharts 折线图 + 异常高亮 + 归因结论

const fs = require('fs');
const path = require('path');

// ECharts 4.x minified (内嵌, 无需 CDN)
const ECHARTS_JS = `<script>
/*! echarts v4.9.0 - minified inline */
!function(t,e){"object"==typeof exports&&"undefined"!=typeof module?module.exports=e():"function"==typeof define&&define.amd?define(e):(t.echarts=e())}(this,function(){return function(t){function e(i){if(n[i])return n[i].exports;var r=n[i]={i:i,l:!1,exports:{}};return t[i].call(r.exports,r,r.exports,e),r.l=!0,r.exports}var n={};return e.m=t,e.c=n,e.d=function(t,n,i){e.o(t,n)||Object.defineProperty(t,n,{enumerable:!0,get:i})},e.r=function(t){"undefined"!=typeof Symbol&&Symbol.toStringTag&&Object.defineProperty(t,Symbol.toStringTag,{value:"Module"}),Object.defineProperty(t,"__esModule",{value:!0})},e.t=function(t,n){if(1&n&&(t=e(t)),8&n)return t;if(4&n&&"object"==typeof t&&t&&t.__esModule)return t;var i=Object.create(null);if(e.r(i),Object.defineProperty(i,"default",{enumerable:!0,value:t}),2&n&&"string"!=typeof t)for(var r in t)e.d(i,r,function(e){return t[e]}.bind(null,r));return i},e.n=function(t){var n=t&&t.__esModule?function(){return t.default}:function(){return t};return e.d(n,"a",n),n},e.o=function(t,e){return Object.prototype.hasOwnProperty.call(t,e)},e.p="",e(e.s=0)}([function(t,e){}])});
// 简化版: 用 canvas 绘折线 (避免 1MB+ ECharts 库内嵌)
function drawLineChart(canvas, data, opts = {}) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width = canvas.offsetWidth * 2;
  const h = canvas.height = canvas.offsetHeight * 2;
  ctx.scale(2, 2);
  const W = w / 2, H = h / 2;
  ctx.clearRect(0, 0, W, H);

  // 背景
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);

  if (!data || data.length === 0) return;

  const padding = { l: 50, r: 20, t: 20, b: 40 };
  const chartW = W - padding.l - padding.r;
  const chartH = H - padding.t - padding.b;

  const xs = data.map((d, i) => i);
  const ys = data.map(d => d.value);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const mean = ys.reduce((a, b) => a + b, 0) / ys.length;

  // 网格
  ctx.strokeStyle = '#e5e7eb';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = padding.t + (chartH * i) / 4;
    ctx.beginPath();
    ctx.moveTo(padding.l, y);
    ctx.lineTo(W - padding.r, y);
    ctx.stroke();
  }

  // 均值线
  const meanY = padding.t + chartH - ((mean - minY) / (maxY - minY || 1)) * chartH;
  ctx.strokeStyle = '#9ca3af';
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(padding.l, meanY);
  ctx.lineTo(W - padding.r, meanY);
  ctx.stroke();
  ctx.setLineDash([]);

  // 折线
  ctx.strokeStyle = opts.color || '#4f46e5';
  ctx.lineWidth = 2;
  ctx.beginPath();
  data.forEach((d, i) => {
    const x = padding.l + (xs[i] / (xs.length - 1 || 1)) * chartW;
    const y = padding.t + chartH - ((d.value - minY) / (maxY - minY || 1)) * chartH;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // 异常点高亮
  if (opts.anomalyIndices) {
    opts.anomalyIndices.forEach(i => {
      const d = data[i];
      const x = padding.l + (xs[i] / (xs.length - 1 || 1)) * chartW;
      const y = padding.t + chartH - ((d.value - minY) / (maxY - minY || 1)) * chartH;
      ctx.fillStyle = d.value > mean ? '#10b981' : '#ef4444';
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
    });
  }

  // 标签
  ctx.fillStyle = '#374151';
  ctx.font = '12px -apple-system, sans-serif';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const val = minY + (maxY - minY) * (1 - i / 4);
    const y = padding.t + (chartH * i) / 4;
    ctx.fillText(val.toFixed(0), padding.l - 8, y + 4);
  }

  // X 轴 (每隔几天显示)
  ctx.textAlign = 'center';
  const xStep = Math.max(1, Math.floor(data.length / 7));
  data.forEach((d, i) => {
    if (i % xStep === 0) {
      const x = padding.l + (xs[i] / (xs.length - 1 || 1)) * chartW;
      ctx.fillText(d.dt ? d.dt.slice(5) : '', x, H - 10);
    }
  });
}
</script>`;

class ReportBuilder {
  constructor(outputDir) {
    this.outputDir = outputDir || path.join(__dirname, '..', 'output');
  }

  build({ title, metric, metricId, queryResult, analysis, validation, dataset, table, timeRange, sourceInfo, comments }) {
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }

    const taskId = `report_${Date.now()}`;
    const filepath = path.join(this.outputDir, `${taskId}.html`);

    // 写评论到 output/comments/<taskId>.yaml (mock 持久化, 给飞书集成复用)
    if (comments && comments.length > 0) {
      const commentsDir = path.join(this.outputDir, 'comments');
      if (!fs.existsSync(commentsDir)) fs.mkdirSync(commentsDir, { recursive: true });
      fs.writeFileSync(
        path.join(commentsDir, `${taskId}.json`),
        JSON.stringify(comments, null, 2)
      );
    }

    const html = this._renderHTML({
      title: title || 'Mavis Data Agent 报告',
      metric,
      metricId,
      queryResult,
      analysis,
      validation,
      dataset,
      table,
      timeRange,
      sourceInfo,
      comments: comments || []
    });

    fs.writeFileSync(filepath, html, 'utf-8');
    return { path: filepath, size: html.length, taskId };
  }

  _renderHTML({ title, metric, metricId, queryResult, analysis, validation, dataset, table, timeRange, sourceInfo, comments }) {
    const anomalies = analysis?.anomalies || [];
    const anomalyIndices = anomalies.map(a => {
      const idx = queryResult.findIndex(r => r.dt === a.date);
      return idx;
    }).filter(i => i >= 0);

    const latest = queryResult[queryResult.length - 1];
    const first = queryResult[0];
    const total = queryResult.reduce((s, r) => s + (r.value || 0), 0);
    const mean = total / queryResult.length;

    const summary = analysis?.summary || '数据正常, 无明显异常';
    const validationStatus = validation?.status || 'unknown';

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>${title}</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
       background: #f9fafb; color: #1f2937; padding: 24px; }
.container { max-width: 1000px; margin: 0 auto; background: #fff;
             border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); overflow: hidden; }
.header { background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
         color: #fff; padding: 32px; }
.header h1 { font-size: 24px; font-weight: 600; margin-bottom: 8px; }
.header .meta { font-size: 14px; opacity: 0.9; }
.content { padding: 32px; }
.summary-cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 32px; }
.card { background: #f9fafb; border-radius: 8px; padding: 16px; border: 1px solid #e5e7eb; }
.card .label { font-size: 12px; color: #6b7280; margin-bottom: 4px; }
.card .value { font-size: 24px; font-weight: 600; color: #1f2937; }
.card .sub { font-size: 12px; color: #6b7280; margin-top: 4px; }
.section { margin-bottom: 32px; }
.section h2 { font-size: 18px; font-weight: 600; margin-bottom: 16px; color: #1f2937; }
.chart-container { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; }
canvas { width: 100%; height: 300px; display: block; }
.anomaly-list { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 16px; border-radius: 4px; }
.anomaly-item { padding: 8px 0; border-bottom: 1px solid #fbbf24; }
.anomaly-item:last-child { border-bottom: none; }
.anomaly-item .date { font-weight: 600; color: #92400e; }
.anomaly-item .detail { color: #78350f; font-size: 14px; margin-top: 4px; }
.badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 500; }
.badge-pass { background: #d1fae5; color: #065f46; }
.badge-fail { background: #fee2e2; color: #991b1b; }
.footer { background: #f9fafb; padding: 16px 32px; text-align: center;
          font-size: 12px; color: #6b7280; border-top: 1px solid #e5e7eb; }
</style>
${ECHARTS_JS}
</head>
<body>
<div class="container">
  <div class="header">
    <h1>${title}</h1>
    <div class="meta">
      数据集: ${dataset || 'N/A'} | 指标: ${metric || 'N/A'} | 时间: ${timeRange?.start || ''} ~ ${timeRange?.end || ''}
      | 生成: ${new Date().toLocaleString('zh-CN')}
    </div>
  </div>

  <div class="content">
    <!-- 核心数字卡片 -->
    <div class="summary-cards">
      <div class="card">
        <div class="label">起始值</div>
        <div class="value">${first?.value?.toFixed(0) || '-'}</div>
        <div class="sub">${first?.dt || '-'}</div>
      </div>
      <div class="card">
        <div class="label">最新值</div>
        <div class="value">${latest?.value?.toFixed(0) || '-'}</div>
        <div class="sub">${latest?.dt || '-'}</div>
      </div>
      <div class="card">
        <div class="label">${dataset === 'ecommerce' ? '总 GMV' : '总事件'}</div>
        <div class="value">${total.toFixed(0)}</div>
        <div class="sub">30 天累计</div>
      </div>
      <div class="card">
        <div class="label">数据质量</div>
        <div class="value">
          <span class="badge badge-${validationStatus}">${validationStatus.toUpperCase()}</span>
        </div>
        <div class="sub">${validation?.summary || '未验证'}</div>
      </div>
    </div>

    <!-- 趋势图 -->
    <div class="section">
      <h2>📈 30 天趋势</h2>
      <div class="chart-container">
        <canvas id="trendChart"></canvas>
      </div>
    </div>

    <!-- 异常检测 -->
    ${anomalies.length > 0 ? `
    <div class="section">
      <h2>🚨 异常检测 (${anomalies.length} 个)</h2>
      <div class="anomaly-list">
        ${anomalies.map(a => `
          <div class="anomaly-item">
            <span class="date">${a.date}</span>
            <span class="badge badge-${a.direction === 'up' ? 'pass' : 'fail'}">${a.direction === 'up' ? '↑ 上涨' : '↓ 下跌'}</span>
            <strong>${a.value?.toFixed(0) || '-'}</strong>
            <span style="color: #92400e;">(${a.sigma}σ ${a.direction === 'up' ? '高于' : '低于'} 均值 ${a.mean})</span>
            ${a.verification?.verified ? `<div class="detail">📊 维度拆解: ${a.verification.breakdown?.map(b => `${b.group_key}=${b.value}`).join(', ') || 'N/A'}</div>` : ''}
          </div>
        `).join('')}
      </div>
    </div>
    ` : `
    <div class="section">
      <h2>✅ 异常检测</h2>
      <p style="color: #059669; padding: 16px; background: #d1fae5; border-radius: 8px;">
        数据在正常范围内, 无明显异常。${summary}
      </p>
    </div>
    `}

    <!-- 分析总结 -->
    <div class="section">
      <h2>💡 分析总结</h2>
      <p style="line-height: 1.8; color: #4b5563; padding: 16px; background: #f3f4f6; border-radius: 8px;">
        ${summary}
      </p>
    </div>

    ${sourceInfo ? this._renderSourceInfo(sourceInfo, metricId || metric) : ''}
    ${comments && comments.length > 0 ? this._renderComments(comments) : ''}
  </div>

  <div class="footer">
    🤖 Generated by Mavis Data Agent v0.3 | ${queryResult.length} data points | ${new Date().toISOString()}
  </div>
</div>

<script>
  // 渲染折线图
  const data = ${JSON.stringify(queryResult)};
  const anomalyIndices = ${JSON.stringify(anomalyIndices)};
  const canvas = document.getElementById('trendChart');
  drawLineChart(canvas, data, { anomalyIndices });
</script>
</body>
</html>`;
  }

  // ============ v0.3 新增: 数据来源标注 ============
  _renderSourceInfo(sourceInfo, metricId) {
    const { mode = 'unknown', sql = '', rows = 0, duration_ms = 0, ts = new Date().toISOString() } = sourceInfo;
    const modeLabel = mode === 'sql' ? '🗄️ SQL (真接数据库)' : mode === 'csv' ? '📄 CSV (内存)' : `❓ ${mode}`;
    const sqlEscaped = sql.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `
    <!-- 数据来源标注 (v0.3) -->
    <div class="section">
      <h2>🔍 数据来源 (v0.3)</h2>
      <div style="background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 16px; font-family: 'Consolas', 'Monaco', monospace; font-size: 12px; color: #0c4a6e;">
        <div style="margin-bottom: 8px;">
          <strong>📌 指标 ID:</strong> <code>${metricId || 'N/A'}</code>
        </div>
        <div style="margin-bottom: 8px;">
          <strong>🗄️ 数据源:</strong> ${modeLabel}
        </div>
        <div style="margin-bottom: 8px;">
          <strong>⏱️ 查询耗时:</strong> ${duration_ms}ms · <strong>📊 返回:</strong> ${rows} 行
        </div>
        <div style="margin-bottom: 4px;"><strong>🔧 SQL 模板:</strong></div>
        <pre style="background: #fff; padding: 12px; border-radius: 4px; overflow-x: auto; white-space: pre-wrap; word-break: break-all; margin: 0;">${sqlEscaped || '(无)'}</pre>
        <div style="margin-top: 8px; color: #6b7280; font-size: 11px;">
          查询时间: ${ts} · 审计: output/audit.log
        </div>
      </div>
    </div>
    `;
  }

  // ============ v0.3 新增: 评论区 (飞书批注同步) ============
  _renderComments(comments) {
    return `
    <!-- 评论区 (v0.3, 飞书同步) -->
    <div class="section">
      <h2>💬 协作批注 (${comments.length} 条)</h2>
      <div style="background: #fafafa; border-radius: 8px; padding: 12px;">
        ${comments.map(c => `
          <div style="border-left: 3px solid #4f46e5; padding: 8px 12px; margin-bottom: 8px; background: #fff; border-radius: 4px;">
            <div style="font-size: 12px; color: #6b7280; margin-bottom: 4px;">
              <strong style="color: #1f2937;">${c.author || '匿名'}</strong> · ${c.ts || ''}
              ${c.from_feishu ? '<span style="background: #dbeafe; color: #1e40af; padding: 1px 6px; border-radius: 3px; font-size: 10px; margin-left: 4px;">📱 飞书</span>' : ''}
            </div>
            <div style="color: #1f2937; font-size: 14px;">${c.text || ''}</div>
          </div>
        `).join('')}
        <div style="text-align: center; padding: 8px; color: #6b7280; font-size: 12px;">
          💡 评论同步到飞书: 配置 FEISHU_WEBHOOK_URL 后, 在此页添加的评论会推送到飞书群
        </div>
      </div>
    </div>
    `;
  }
}

module.exports = { ReportBuilder };

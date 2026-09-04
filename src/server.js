// Mavis Data Agent - Web UI Server
// 提供: UI (/), API (/api/*), 报告 (/report/*)
// 端口: 8765 (默认), 可通过 PORT 环境变量修改
//
// 用法: node src/server.js

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const { Orchestrator } = require('./orchestrator');
const { createLLM } = require('./llm');

const PORT = parseInt(process.env.PORT || 8765);
const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const OUTPUT_DIR = path.join(ROOT, 'output');
const HISTORY_FILE = path.join(OUTPUT_DIR, 'history.json');

if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
if (!fs.existsSync(HISTORY_FILE)) fs.writeFileSync(HISTORY_FILE, '[]');

// ============ 工具函数 ============
function loadHistory() {
  try {
    return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
  } catch (e) {
    return [];
  }
}

function saveHistory(history) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
}

function addHistory(entry) {
  const history = loadHistory();
  history.unshift(entry);
  if (history.length > 100) history.pop();  // 保留最近 100 条
  saveHistory(history);
}

function buildFileTree() {
  // 简化版: 按重要文件分类展示
  const tree = [];

  // 1. reports/
  const reports = fs.readdirSync(OUTPUT_DIR).filter(f => f.startsWith('report_') && f.endsWith('.html'));
  if (reports.length) {
    const sorted = reports.sort().reverse().slice(0, 20);  // 最新 20 个
    tree.push({
      type: 'folder', name: 'reports/',
      children: sorted.map(f => {
        const stat = fs.statSync(path.join(OUTPUT_DIR, f));
        return { type: 'file', name: f, size: stat.size, url: `/report/${f}` };
      })
    });
  }

  // 2. eval/
  const evalDir = path.join(ROOT, 'eval');
  if (fs.existsSync(evalDir)) {
    const evalFiles = fs.readdirSync(evalDir).filter(f => f.endsWith('.md') || f.endsWith('.json'));
    if (evalFiles.length) {
      tree.push({
        type: 'folder', name: 'eval/',
        children: evalFiles.map(f => {
          const stat = fs.statSync(path.join(evalDir, f));
          return { type: 'file', name: f, size: stat.size, url: `/eval-file/${f}` };
        })
      });
    }
  }

  // 2.5 audit.log (v0.2 新增, 审计日志)
  const auditPath = path.join(OUTPUT_DIR, 'audit.log');
  if (fs.existsSync(auditPath)) {
    const stat = fs.statSync(auditPath);
    tree.unshift({
      type: 'folder', name: 'audit/',
      children: [{
        type: 'file', name: 'audit.log', size: stat.size,
        url: '/audit-log'
      }]
    });
  }

  // 3. docs/
  const docsDir = path.join(ROOT, 'docs');
  if (fs.existsSync(docsDir)) {
    const docsFiles = fs.readdirSync(docsDir).filter(f => f.endsWith('.docx') || f.endsWith('.md'));
    if (docsFiles.length) {
      tree.push({
        type: 'folder', name: 'docs/',
        children: docsFiles.map(f => {
          const stat = fs.statSync(path.join(docsDir, f));
          return { type: 'file', name: f, size: stat.size, url: `/docs-file/${f}` };
        })
      });
    }
  }

  // 4. data/
  const dataDir = path.join(ROOT, 'data');
  if (fs.existsSync(dataDir)) {
    const dataSubdirs = ['ecommerce', 'app'].filter(d => fs.existsSync(path.join(dataDir, d)));
    const dataAnomalies = fs.existsSync(path.join(dataDir, '_anomalies.json'));
    const dataChildren = [];
    if (dataAnomalies) {
      const stat = fs.statSync(path.join(dataDir, '_anomalies.json'));
      dataChildren.push({ type: 'file', name: '_anomalies.json', size: stat.size, url: '/data-file/_anomalies.json' });
    }
    dataSubdirs.forEach(d => {
      const files = fs.readdirSync(path.join(dataDir, d));
      dataChildren.push({
        type: 'folder', name: `${d}/`,
        children: files.map(f => ({ type: 'file', name: f, size: 0, url: `/data-file/${d}/${f}` }))
      });
    });
    if (dataChildren.length) {
      tree.push({ type: 'folder', name: 'data/', children: dataChildren });
    }
  }

  return tree;
}

function getContentType(ext) {
  const map = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
  };
  return map[ext] || 'application/octet-stream';
}

function sendJson(res, data, code = 200) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function sendFile(res, filePath) {
  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { 'Content-Type': getContentType(ext) });
  fs.createReadStream(filePath).pipe(res);
}

// ============ 路由 ============
async function handleRequest(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // === UI 入口 ===
  if (pathname === '/' || pathname === '/index.html') {
    return sendFile(res, path.join(PUBLIC_DIR, 'index.html'));
  }

  // === 静态资源 (public/ 下的 css/js) ===
  if (pathname.startsWith('/static/') || pathname.match(/\.(css|js|svg|png|ico)$/)) {
    const filePath = path.join(PUBLIC_DIR, pathname);
    if (fs.existsSync(filePath) && !pathname.includes('..')) {
      return sendFile(res, filePath);
    }
  }

  // === API: 历史记录 ===
  if (pathname === '/api/history' && req.method === 'GET') {
    return sendJson(res, loadHistory());
  }

  // === API: 文件树 ===
  if (pathname === '/api/files' && req.method === 'GET') {
    return sendJson(res, buildFileTree());
  }

  // === API: 跑 query (NDJSON 流式) ===
  if (pathname === '/api/query' && req.method === 'POST') {
    return handleQuery(req, res);
  }

  // === 报告文件 ===
  if (pathname.startsWith('/report/')) {
    const filename = pathname.slice('/report/'.length);
    if (filename.includes('..')) {
      res.writeHead(403);
      return res.end('Forbidden');
    }
    return sendFile(res, path.join(OUTPUT_DIR, filename));
  }

  // === eval 文件 ===
  if (pathname.startsWith('/eval-file/')) {
    const filename = pathname.slice('/eval-file/'.length);
    if (filename.includes('..')) {
      res.writeHead(403);
      return res.end('Forbidden');
    }
    return sendFile(res, path.join(ROOT, 'eval', filename));
  }

  // === docs 文件 (docx 下载) ===
  if (pathname.startsWith('/docs-file/')) {
    const filename = pathname.slice('/docs-file/'.length);
    if (filename.includes('..')) {
      res.writeHead(403);
      return res.end('Forbidden');
    }
    return sendFile(res, path.join(ROOT, 'docs', filename));
  }

  // === audit.log 文件 (v0.2) ===
  if (pathname === '/audit-log') {
    return sendFile(res, path.join(OUTPUT_DIR, 'audit.log'));
  }

  // === 数据源信息 (v0.2) ===
  if (pathname === '/api/source' && req.method === 'GET') {
    return sendJson(res, { mode: global.globalFetcher ? global.globalFetcher.getMode() : 'unknown' });
  }

  // === data 文件 (JSON 文本预览) ===
  if (pathname.startsWith('/data-file/')) {
    const rel = pathname.slice('/data-file/'.length);
    if (rel.includes('..')) {
      res.writeHead(403);
      return res.end('Forbidden');
    }
    return sendFile(res, path.join(ROOT, 'data', rel));
  }

  // === 404 ===
  res.writeHead(404);
  res.end('Not Found');
}

async function handleQuery(req, res) {
  let body = '';
  for await (const chunk of req) body += chunk;
  let query;
  try {
    query = JSON.parse(body).query;
  } catch (e) {
    res.writeHead(400);
    return res.end('Invalid JSON');
  }

  if (!query || typeof query !== 'string') {
    res.writeHead(400);
    return res.end('Missing query');
  }

  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache',
    'X-Accel-Buffering': 'no'
  });

  const queryId = `q_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const startTime = Date.now();

  const emit = (event) => {
    try { res.write(JSON.stringify({ queryId, ...event }) + '\n'); } catch (e) {}
  };

  emit({ type: 'start', query, llm_mode: process.env.DEEPSEEK_API_KEY ? 'deepseek' : 'mock' });

  const llm = createLLM();
  const orch = new Orchestrator(llm);

  let result;
  try {
    result = await orch.run(query, (event) => emit(event));
    emit({ type: 'done', status: 'complete', duration_ms: Date.now() - startTime });
  } catch (e) {
    emit({ type: 'error', message: e.message });
    result = { status: 'fail', error: e.message };
  }

  res.end();

  // 记录历史
  addHistory({
    id: queryId,
    query,
    time: new Date().toLocaleString('zh-CN'),
    status: result.status,
    intent: result.intent,
    metric: result.metric?.id,
    reportFile: result.report ? path.basename(result.report.path) : null,
    durationMs: Date.now() - startTime,
    llmStats: result.llm_stats || (llm.callCount > 0 ? {
      mode: llm.mode, calls: llm.callCount, tokens: llm.totalTokens, cost: llm.totalCost
    } : null)
  });
}

// ============ 启动 ============
const { DataFetcher } = require('./data-fetcher');
const server = http.createServer(handleRequest);

(async () => {
  // 初始化 fetcher (SQL 模式需等 WASM 加载)
  const globalFetcher = new DataFetcher();
  try {
    await globalFetcher.init();
    // 把 globalFetcher 暴露到全局, 让 /api/source 路由访问
    global.globalFetcher = globalFetcher;
  } catch (e) {
    console.error(`⚠️  数据源初始化失败: ${e.message}`);
    console.error(`   fallback 到 CSV 模式请设置: $env:DATA_SOURCE='csv'`);
    process.exit(1);
  }

  // v0.3 部署: 默认 listen 0.0.0.0 (公网可访问), HOST=127.0.0.1 退回本机
  const HOST = process.env.HOST || '0.0.0.0';
  server.listen(PORT, HOST, () => {
    const llmMode = process.env.DEEPSEEK_API_KEY ? 'DeepSeek (真实)' : 'Mock (无 API key)';
    console.log('');
    console.log('═'.repeat(60));
    console.log('🤖 Mavis Data Agent - Web UI');
    console.log('═'.repeat(60));
    console.log(`📍 地址:        http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}/`);
    if (HOST === '0.0.0.0') {
      console.log(`   公网部署提示:  设置 PORT=80 + 用 cloudflared/Render/Fly.io 暴露`);
    }
    console.log(`📂 报告目录:    ${OUTPUT_DIR}`);
    console.log(`🎨 UI 目录:     ${PUBLIC_DIR}`);
    console.log(`🗄️  数据源:      ${globalFetcher.getMode().toUpperCase()}`);
    console.log(`🧠 LLM 模式:    ${llmMode}`);
    console.log('');
    console.log('👇 在浏览器打开:');
    console.log(`   http://localhost:${PORT}/`);
    console.log('');
    console.log('按 Ctrl+C 停止');
    console.log('═'.repeat(60));
  });
})();

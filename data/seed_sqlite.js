// Mavis Data Agent v0.2 - 把 CSV 灌进 SQLite
// 用法: node data/seed_sqlite.js
// 产物: data/analytics.db
//
// 设计要点 (PM 视角):
//   - 一键幂等: 删了重建, 同 seed 同结果
//   - 显式 schema: 写清楚列 + 类型, 是审计和可读性的基础
//   - 不接外部输入: seed 阶段不调 LLM, 不解析 user query, 所以 SQL 拼接安全

const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const DATA_DIR = __dirname;
const CSV_DIR = {
  ecommerce: path.join(DATA_DIR, 'ecommerce'),
  app: path.join(DATA_DIR, 'app')
};
const DB_PATH = path.join(DATA_DIR, 'analytics.db');

// ============ Schema (显式定义, 方便审计) ============
// 表名加 dataset 前缀, 避免 ecommerce.users / app.users 同名冲突
// 也贴近真实 MySQL 多 schema 场景
const SCHEMA = {
  ecommerce: {
    users: `
      CREATE TABLE ecom_users (
        user_id      TEXT PRIMARY KEY,
        register_date TEXT,
        channel      TEXT,
        country      TEXT,
        age_group    TEXT
      );`,
    products: `
      CREATE TABLE ecom_products (
        product_id TEXT PRIMARY KEY,
        category   TEXT,
        price      REAL,
        cost       REAL
      );`,
    orders: `
      CREATE TABLE ecom_orders (
        order_id     TEXT PRIMARY KEY,
        user_id      TEXT,
        product_id   TEXT,
        order_date   TEXT,
        order_amount REAL,
        status       TEXT,
        channel      TEXT,
        country      TEXT
      );
      CREATE INDEX idx_ecom_orders_date   ON ecom_orders(order_date);
      CREATE INDEX idx_ecom_orders_status ON ecom_orders(status);`,
    sessions: `
      CREATE TABLE ecom_sessions (
        session_id   TEXT PRIMARY KEY,
        user_id      TEXT,
        session_date TEXT,
        start_time   TEXT,
        duration_sec INTEGER,
        page_count   INTEGER,
        device       TEXT,
        converted    INTEGER
      );
      CREATE INDEX idx_ecom_sessions_date ON ecom_sessions(session_date);`
  },
  app: {
    users: `
      CREATE TABLE app_users (
        user_id        TEXT PRIMARY KEY,
        register_date  TEXT,
        channel        TEXT,
        country        TEXT,
        platform       TEXT,
        install_source TEXT
      );`,
    events: `
      CREATE TABLE app_events (
        event_id   TEXT PRIMARY KEY,
        user_id    TEXT,
        event_time TEXT,
        event_type TEXT,
        platform   TEXT,
        session_id TEXT
      );
      CREATE INDEX idx_app_events_time ON app_events(event_time);
      CREATE INDEX idx_app_events_user ON app_events(user_id);`,
    sessions: `
      CREATE TABLE app_sessions (
        session_id   TEXT PRIMARY KEY,
        user_id      TEXT,
        start_time   TEXT,
        duration_sec INTEGER,
        platform     TEXT,
        event_count  INTEGER
      );
      CREATE INDEX idx_app_sessions_start ON app_sessions(start_time);`
  }
};

const INSERT_TEMPLATES = {
  ecommerce: {
    users:   (r) => `INSERT INTO ecom_users VALUES ('${esc(r.user_id)}','${esc(r.register_date)}','${esc(r.channel)}','${esc(r.country)}','${esc(r.age_group)}')`,
    products:(r) => `INSERT INTO ecom_products VALUES ('${esc(r.product_id)}','${esc(r.category)}',${num(r.price)},${num(r.cost)})`,
    orders:  (r) => `INSERT INTO ecom_orders VALUES ('${esc(r.order_id)}','${esc(r.user_id)}','${esc(r.product_id)}','${esc(r.order_date)}',${num(r.order_amount)},'${esc(r.status)}','${esc(r.channel)}','${esc(r.country)}')`,
    sessions:(r) => `INSERT INTO ecom_sessions VALUES ('${esc(r.session_id)}','${esc(r.user_id)}','${esc(r.session_date)}','${esc(r.start_time)}',${num(r.duration_sec)},${num(r.page_count)},'${esc(r.device)}',${num(r.converted)})`
  },
  app: {
    users:   (r) => `INSERT INTO app_users VALUES ('${esc(r.user_id)}','${esc(r.register_date)}','${esc(r.channel)}','${esc(r.country)}','${esc(r.platform)}','${esc(r.install_source)}')`,
    events:  (r) => `INSERT INTO app_events VALUES ('${esc(r.event_id)}','${esc(r.user_id)}','${esc(r.event_time)}','${esc(r.event_type)}','${esc(r.platform)}','${esc(r.session_id)}')`,
    sessions:(r) => `INSERT INTO app_sessions VALUES ('${esc(r.session_id)}','${esc(r.user_id)}','${esc(r.start_time)}',${num(r.duration_sec)},'${esc(r.platform)}',${num(r.event_count)})`
  }
};

// SQL escape (单引号转义; seed 阶段不接外部输入, 但好习惯)
function esc(v) {
  if (v === undefined || v === null) return '';
  return String(v).replace(/'/g, "''");
}
function num(v) {
  if (v === undefined || v === null || v === '') return 'NULL';
  const n = parseFloat(v);
  return isNaN(n) ? 'NULL' : n;
}

function readCSV(filepath) {
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

async function main() {
  console.log('🗄️  灌数据到 SQLite\n');

  const SQL = await initSqlJs();
  const db = new SQL.Database();

  let totalRows = 0;

  for (const [dataset, tables] of Object.entries(SCHEMA)) {
    console.log(`📁 ${dataset}/`);
    for (const [table, ddl] of Object.entries(tables)) {
      // 1. 跑 DDL (可能含多个 CREATE, 用 ; split)
      ddl.split(';').map(s => s.trim()).filter(Boolean).forEach(stmt => {
        db.run(stmt);
      });

      // 2. 读 CSV + 写 INSERT
      const csvPath = path.join(CSV_DIR[dataset], `${table}.csv`);
      if (!fs.existsSync(csvPath)) {
        console.log(`   ⚠️  ${table}.csv 不存在, 跳过`);
        continue;
      }
      const rows = readCSV(csvPath);
      const inserter = INSERT_TEMPLATES[dataset][table];
      db.run('BEGIN');
      rows.forEach(r => db.run(inserter(r)));
      db.run('COMMIT');

      console.log(`   ✅ ${table}: ${rows.length} 行`);
      totalRows += rows.length;
    }
  }

  // 3. 持久化
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
  db.close();

  const sizeMB = (fs.statSync(DB_PATH).size / 1024 / 1024).toFixed(2);
  console.log(`\n💾 ${DB_PATH} 写入完成`);
  console.log(`📊 总计 ${totalRows} 行, ${sizeMB} MB`);
  console.log('\n👇 验证:');
  console.log(`   node tests/test_step9_sql.js`);
}

main().catch(e => {
  console.error('❌ 失败:', e.message);
  process.exit(1);
});

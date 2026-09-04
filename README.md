# Mavis Data Agent

数据分析 Agent demo：自然语言提问 → 自动取数 → 异常检测 → 报告生成。

输入 `DAU 为啥跌了`，2 秒输出含数据来源 + SQL 模板 + 趋势图 + 异常点高亮的 HTML 报告。

---

## 特性

- **v0.1** 多 Agent 编排（4 worker + orchestrator），mock CSV 数据
- **v0.2** 真接 SQL（SQLite + 预定义模板 + 审计日志）
- **v0.3** Skill 抽象层（5 个 skill 通过注册中心调度）+ 飞书集成（webhook + mock 模式）

---

## 架构

```
[User: "DAU 为啥跌了"]
        ↓
[mavis orchestrator] — 意图识别 + 任务路由
        ↓
[data-fetch → anomaly → audit → report → feishu-push] (Skill 调度)
        ↓
HTML 报告 + 飞书消息卡片
```

5 个 skill 通过 `registry.invoke('skill-name', ...)` 调度，orchestrator 与能力实现解耦。

---

## 5 分钟跑通

```bash
git clone https://github.com/<your-username>/mavis-data-agent.git
cd mavis-data-agent
npm install
node data/seed_sqlite.js   # 灌 175k 行 mock 数据到 SQLite
node src/server.js         # 启动, 监听 0.0.0.0:8765
```

打开 http://localhost:8765，输入 `DAU 为啥跌了`。

### 环境变量（可选）

| 变量 | 作用 | 默认 |
|---|---|---|
| `DEEPSEEK_API_KEY` | 启用复杂任务 LLM 总结 | 无（不配也能跑简单查询） |
| `FEISHU_WEBHOOK_URL` | 飞书推送（real 模式） | 无（默认 mock 写本地 log） |
| `AUTO_PUSH_FEISHU` | 自动推送结果到飞书 | `0` |
| `DATA_SOURCE` | 数据源切换: `sql` 或 `csv` | `sql` |
| `PORT` | 监听端口 | `8765` |

---

## 项目结构

```
mavis-data-agent/
├── src/
│   ├── server.js              # HTTP 入口
│   ├── orchestrator.js        # 任务路由
│   ├── skill.js               # Skill 基类
│   ├── skill-registry.js      # Skill 注册中心
│   ├── skills/                # 5 个 skill
│   │   ├── data-fetch-skill.js
│   │   ├── anomaly-skill.js
│   │   ├── audit-skill.js
│   │   ├── report-skill.js
│   │   └── feishu-push-skill.js
│   ├── sql-source.js          # 10 个预定义 SQL 模板 + 审计
│   ├── csv-fetcher.js         # v0.1 CSV fallback
│   ├── data-fetcher.js        # 委派（默认 SQL）
│   ├── data-analyzer.js
│   ├── data-validator.js
│   ├── metric-catalog.js
│   ├── llm.js
│   └── report-builder.js
├── data/
│   ├── generate.js            # Mock 数据生成器
│   ├── seed_sqlite.js         # CSV → SQLite
│   ├── mock_dau.csv           # 30 天假数据
│   └── analytics.db           # SQLite (gitignore, 一键生成)
├── tests/                     # 单元 + e2e + 5 维度评测
├── public/index.html          # Web UI
├── AGENTS.md                  # 4 个 agent 提示词（备用）
├── render.yaml                # Render 部署配置
├── package.json
├── run_all.js                 # 一键跑全测试
└── README.md
```

---

## 5 维度评测

`node tests/eval_v0.4_5dimensions.js` 一键跑（5/5 通过）：

| 维度 | 状态 |
|---|---|
| 简单查询不调复杂 agent | ✅ |
| 复杂任务用多 agent 协作 | ✅ |
| 调用 skill 写报告和图表 | ✅ |
| 自动检测指标 + 异常响应 | ✅ |
| 飞书集成（数据来源 / 评论 / 推送） | ✅ |

---

## 成本

| 模型 | 单次 query | 调试 5 次 |
|---|---|---|
| DeepSeek-V3 | ¥0.0002 | ¥0.001 |
| GPT-4o-mini | ¥0.2 | ¥1 |
| Claude Sonnet | ¥0.5 | ¥2.5 |

简单查询 0 LLM 调用（直查 SQL），复杂分析 1 次 LLM。

---

## License

MIT

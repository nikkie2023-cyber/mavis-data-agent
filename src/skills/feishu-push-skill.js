// Feishu Push Skill: 把报告 summary 推到飞书自定义机器人 webhook
// v0.3: webhook 模式, 不依赖官方 SDK, 5 行集成

const { Skill } = require('../skill');
const fs = require('fs');
const path = require('path');

class FeishuPushSkill extends Skill {
  constructor() {
    super({
      name: 'feishu-push',
      version: '0.3.0',
      description: '把报告 summary 推到飞书群机器人 webhook. 适配飞书自定义机器人消息卡片格式. 无 webhook 配置时进入 mock 模式, 写到 output/feishu-mock.log.',
      inputs: [
        { name: 'title', type: 'string', required: true, desc: '报告标题' },
        { name: 'summary', type: 'string', required: true, desc: '一段话总结' },
        { name: 'metric', type: 'string', required: false, desc: '指标名' },
        { name: 'anomalyCount', type: 'number', required: false, default: 0 },
        { name: 'reportUrl', type: 'string', required: false, desc: '可访问的报告 URL (相对路径 /report/xxx.html)' },
        { name: 'webhookUrl', type: 'string', required: false, desc: '飞书机器人 webhook URL, 默认从 env FEISHU_WEBHOOK_URL 读' },
        { name: 'mode', type: 'string', required: false, default: 'auto', desc: 'auto | real | mock' }
      ],
      outputs: [
        { name: 'ok', type: 'boolean' },
        { name: 'mode', type: 'string', desc: 'real | mock' },
        { name: 'error', type: 'string', required: false }
      ],
      execute: '_execute'
    });
    this.mockLogPath = path.join(__dirname, '..', '..', 'output', 'feishu-mock.log');
  }

  async _execute(inputs) {
    const webhookUrl = inputs.webhookUrl || process.env.FEISHU_WEBHOOK_URL;
    // 默认 mode='auto': 有 webhook 走 real, 没 webhook 走 mock
    const requestedMode = inputs.mode || 'auto';
    const mode = requestedMode === 'auto' ? (webhookUrl ? 'real' : 'mock') : requestedMode;

    const card = this._buildCard(inputs);

    if (mode === 'mock') {
      // Mock 模式: 把消息写到 output/feishu-mock.log
      const entry = {
        ts: new Date().toISOString(),
        mode: 'mock',
        title: inputs.title,
        summary: inputs.summary,
        metric: inputs.metric,
        anomalyCount: inputs.anomalyCount,
        reportUrl: inputs.reportUrl,
        card
      };
      fs.appendFileSync(this.mockLogPath, JSON.stringify(entry) + '\n');
      return { ok: true, mode: 'mock', path: this.mockLogPath };
    }

    // Real 模式: HTTP POST 到飞书 webhook
    try {
      const resp = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(card)
      });
      const data = await resp.json().catch(() => ({}));
      const ok = resp.ok && (data.StatusCode === 0 || data.code === 0 || data.ok === true);
      return { ok, mode: 'real', error: ok ? null : `飞书返回错误: ${JSON.stringify(data).slice(0, 200)}` };
    } catch (e) {
      return { ok: false, mode: 'real', error: `HTTP 调用失败: ${e.message}` };
    }
  }

  _buildCard(inputs) {
    const { title, summary, metric, anomalyCount = 0, reportUrl } = inputs;
    const template = anomalyCount > 0 ? 'red' : 'blue';
    return {
      msg_type: 'interactive',
      card: {
        header: {
          title: { tag: 'plain_text', content: title || 'Mavis Data Agent 报告' },
          template
        },
        elements: [
          {
            tag: 'div',
            text: {
              tag: 'lark_md',
              content: [
                `**指标:** ${metric || 'N/A'}`,
                `**异常:** ${anomalyCount} 个`,
                `**总结:** ${summary?.slice(0, 300) || '无'}`,
                `**生成时间:** ${new Date().toLocaleString('zh-CN')}`
              ].join('\n')
            }
          },
          reportUrl ? {
            tag: 'action',
            actions: [{
              tag: 'button',
              text: { tag: 'plain_text', content: '📄 查看完整报告' },
              type: 'primary',
              url: reportUrl.startsWith('http') ? reportUrl : `http://localhost:8765${reportUrl}`
            }, {
              tag: 'button',
              text: { tag: 'plain_text', content: '💬 添加批注' },
              type: 'default',
              value: 'add_comment',
              url: reportUrl.startsWith('http') ? reportUrl : `http://localhost:8765${reportUrl}#comments`
            }]
          } : { tag: 'hr' },
          {
            tag: 'note',
            elements: [
              { tag: 'plain_text', content: '🤖 Mavis Data Agent · 数据来源可追溯 (v0.3 审计)' }
            ]
          }
        ]
      }
    };
  }
}

module.exports = { FeishuPushSkill };

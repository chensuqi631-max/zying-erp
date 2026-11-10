#!/usr/bin/env node
/**
 * 市场分析 · 独立小服务 (最小可用版)
 * ==================================================================
 * 为什么需要独立服务而不是只挂进 ERP:
 *   ERP 的 server.js 跑在 DeepSeek Harness.exe 宿主进程里, 重启宿主会连带中断会话。
 *   这里起一个独立进程, 打开网页即可用, 与 ERP 互不影响。
 *
 * 用法:
 *   node market-serve.js            # 默认 3089
 *   node market-serve.js 3090       # 指定端口
 *
 * 路由(与 ERP 里挂的那份完全一致):
 *   /                                  → 可分析类目列表
 *   /api/market/list[?format=json]     → 同上
 *   /api/market/analyze?site=&cat=     → 分析报告(HTML)
 *   /api/market/analyze?...&format=md|json → 原始产物
 */
'use strict';
const http = require('http');
const api = require('./market-api.js');

const PORT = Number(process.argv[2] || process.env.ZYING_MARKET_PORT || 3089);

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const p = url.pathname;

  const html = (code, body) => {
    res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(body);
  };
  const json = (code, o) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(o, null, 1));
  };

  try {
    if (p === '/' || p === '/api/market/list') {
      const rows = api.listCategories();
      if (url.searchParams.get('format') === 'json') return json(200, { ok: true, rows });
      return html(200, api.renderList(rows));
    }

    if (p === '/api/market/analyze') {
      const site = String(url.searchParams.get('site') || '').trim();
      const cat = String(url.searchParams.get('cat') || '').trim();
      const fmt = url.searchParams.get('format') || 'html';
      if (!site || !cat) return json(400, { ok: false, error: '缺少 site / cat 参数' });

      const r = api.analyze(site, cat);
      if (!r.ok) {
        if (fmt === 'json') return json(500, r);
        const shell = api.renderReport({
          ok: false, site, cat, ccy: api.SITE_CCY[site] || '',
          norm: { meta: { row_count_raw: 0, row_count_kept: 0, dropped: {}, quality: {} } },
          metrics: null,
        });
        return html(500, shell.replace('</div></body>',
          '<div class="alert badb">⛔ 分析失败（' + String(r.step) + '）：' +
          String(r.err || '').slice(0, 600).replace(/[<>&]/g, '') + '</div></div></body>'));
      }
      if (fmt === 'json') return json(200, { ok: true, meta: r.norm.meta, metrics: r.metrics });
      if (fmt === 'md') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end(r.md);
      }
      return html(200, api.renderReport(r));
    }

    if (p === '/api/market/ping') return json(200, { ok: true, port: PORT, cwd: __dirname });

    return html(404, '<div style="font:13px sans-serif;padding:24px;color:#ccc;background:#0e1013">' +
      '404 — <a style="color:#8fb8f0" href="/">回到类目列表</a></div>');
  } catch (e) {
    return json(500, { ok: false, error: String((e && e.message) || e) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('市场分析服务已启动');
  console.log('  → http://127.0.0.1:' + PORT + '/');
  console.log('  （独立进程，与 ERP 互不影响；Ctrl+C 停止）');
});

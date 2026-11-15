'use strict';
/**
 * headless-finder.js —— 用【本地无头浏览器】在 Amazon 列表页/品牌页「找品」（只拿 ASIN）
 *
 * 定位（与智赢插件彻底解耦）：
 *   · 找品：无头 Chromium 打开列表页，从 DOM 里读 data-asin（不依赖智赢插件面板）
 *   · 采数：拿到 ASIN 后交给直连通道（本地签名）批量取数，见 server 的 /api/collect/direct
 *
 * 为什么不用 visible 采集浏览器：无头可以后台跑、不打扰用户、可多页连翻；
 * 需要时也能切 offscreen（窗口移到屏幕外，风控更友好）——由 browser-service 的 mode 决定。
 */
const http = require('http');
const browserService = require('./browser-service.js');

const PORT = Number(process.env.ZYING_HEADLESS_PORT || 9333);
const SITE_MAP = {
  'amazon.com': 'us', 'amazon.de': 'de', 'amazon.co.uk': 'uk', 'amazon.fr': 'fr',
  'amazon.it': 'it', 'amazon.es': 'es', 'amazon.co.jp': 'jp', 'amazon.ca': 'ca',
  'amazon.in': 'in', 'amazon.com.au': 'au', 'amazon.nl': 'nl', 'amazon.se': 'se',
  'amazon.pl': 'pl', 'amazon.com.mx': 'mx', 'amazon.com.br': 'br', 'amazon.sg': 'sg',
  'amazon.ae': 'ae', 'amazon.sa': 'sa',
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const siteOfUrl = (url) => {
  try {
    const h = new URL(url).hostname.replace(/^www\./, '');
    return SITE_MAP[h] || null;
  } catch (e) { return null; }
};

function httpJSON(p, method) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: p, method: method || 'GET', timeout: 5000 }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

/** 确保无头浏览器在跑（没跑就起一个 headless） */
async function ensure() {
  const v = await httpJSON('/json/version');
  if (v && v.Browser) return { ok: true, started: false, version: v.Browser };
  try {
    await browserService.start({ mode: 'headless', port: PORT });
  } catch (e) {
    throw new Error('无头浏览器启动失败: ' + String((e && e.message) || e).slice(0, 160));
  }
  for (let i = 0; i < 30; i++) {
    await sleep(400);
    const vv = await httpJSON('/json/version');
    if (vv && vv.Browser) return { ok: true, started: true, version: vv.Browser };
  }
  throw new Error('无头浏览器启动超时（端口 ' + PORT + '）');
}

function wsConnect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pend = new Map();
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result || m); pend.delete(m.id); }
    });
    ws.addEventListener('open', () => resolve({
      ws,
      send: (method, params) => new Promise((r) => {
        const i = ++id;
        pend.set(i, r);
        ws.send(JSON.stringify({ id: i, method, params: params || {} }));
        setTimeout(() => r(null), 30000);
      }),
    }));
    ws.addEventListener('error', () => reject(new Error('CDP 连接失败')));
    setTimeout(() => reject(new Error('CDP 连接超时')), 8000);
  });
}

/* 从列表页 DOM 提取 ASIN（不依赖任何插件；兼容搜索结果/品牌店铺/类目页） */
const EXTRACT_JS = `(() => {
  const out = [];
  const seen = new Set();
  const push = (asin) => {
    const a = String(asin || '').toUpperCase();
    if (!/^[A-Z0-9]{10}$/.test(a) || seen.has(a)) return;
    seen.add(a); out.push(a);
  };
  document.querySelectorAll('[data-asin][data-component-type="s-search-result"]').forEach((n) => push(n.getAttribute('data-asin')));
  if (!out.length) document.querySelectorAll('div.s-result-item[data-asin], [data-asin][data-index]').forEach((n) => push(n.getAttribute('data-asin')));
  if (!out.length) document.querySelectorAll('[data-asin]').forEach((n) => push(n.getAttribute('data-asin')));
  return JSON.stringify({ n: out.length, asins: out.slice(0, 120) });
})()`;

/** 打开一个 URL 并等列表渲染出来 */
async function grabPage(url, opts) {
  const o = opts || {};
  const page = await browserService.openPage(url, PORT);
  if (!page || !page.webSocketDebuggerUrl) throw new Error('无法创建无头浏览器标签页');
  const c = await wsConnect(page.webSocketDebuggerUrl);
  try {
    await c.send('Page.enable');
    await c.send('Runtime.enable');
    const t0 = Date.now();
    let last = { n: 0, asins: [] };
    while (Date.now() - t0 < (o.timeoutMs || 25000)) {
      await sleep(700);
      const r = await c.send('Runtime.evaluate', { expression: EXTRACT_JS, returnByValue: true });
      const v = r && r.result && r.result.value;
      if (!v) continue;
      try { last = JSON.parse(v); } catch (e) { last = { n: 0, asins: [] }; }
      if (last.n >= (o.minCards || 5)) break;
    }
    const title = await c.send('Runtime.evaluate', { expression: 'document.title', returnByValue: true });
    return { asins: last.asins || [], count: last.n || 0, title: (title && title.result && title.result.value) || null };
  } finally {
    try { c.ws.close(); } catch (e) {}
    /* 关闭这个临时标签页，避免无头浏览器堆积 */
    try { await httpJSON('/json/close/' + page.id); } catch (e) {}
  }
}

/** 列表页翻页：page=2..N（Amazon 用 &page=N；URL 已带 page 参数时就地替换） */
function pageUrl(url, n) {
  if (n <= 1) return url;
  try {
    const u = new URL(url);
    u.searchParams.set('page', String(n));
    return u.toString();
  } catch (e) {
    return url + (url.indexOf('?') >= 0 ? '&' : '?') + 'page=' + n;
  }
}

/**
 * 找品主入口
 * @returns { site, pages, asins[], perPage[], count }
 */
async function findAsins(url, opts) {
  const o = opts || {};
  const site = siteOfUrl(url);
  if (!site) throw new Error('不是有效的 Amazon URL: ' + url);
  const maxPages = Math.max(1, Math.min(10, Number(o.maxPages) || 1));
  const maxItems = Math.max(1, Math.min(400, Number(o.maxItems) || 100));
  await ensure();

  const asins = [];
  const seen = new Set();
  const perPage = [];
  for (let p = 1; p <= maxPages; p++) {
    if (asins.length >= maxItems) break;
    const u = pageUrl(url, p);
    const got = await grabPage(u, o);
    perPage.push({ page: p, count: got.count, title: got.title });
    for (const a of got.asins) {
      if (seen.has(a)) continue;
      seen.add(a);
      asins.push(a);
      if (asins.length >= maxItems) break;
    }
    if (!got.asins.length) break;          // 该页没东西 → 不继续翻
    await sleep(o.gapMs == null ? 800 : Math.max(0, Number(o.gapMs)));
  }
  return { site, pages: perPage.length, asins, perPage, count: asins.length };
}

async function status() {
  const v = await httpJSON('/json/version');
  return { running: !!(v && v.Browser), port: PORT, version: (v && v.Browser) || null };
}

module.exports = { ensure, findAsins, status, siteOfUrl, PORT };

// 搞薯条 · 列表页卡片信息（Amazon 搜索/品牌/类目列表页）
// ★ 2026-11-14: 在每张商品卡片下面加一行「BG 状态 + 品牌/价格/BSR/上架天数/月销」
//   数据来自我们自己的 ERP（直连智赢库），不经过智赢插件。
//   与详情页面板互不干扰：详情页由 zy-panel.js 负责，这里只在列表页工作。
(function () {
  'use strict';
  if (window.__ZYL_INJECTED__) return;
  window.__ZYL_INJECTED__ = true;

  var SITES = {
    'amazon.com': 'us', 'amazon.de': 'de', 'amazon.co.uk': 'uk', 'amazon.fr': 'fr',
    'amazon.it': 'it', 'amazon.es': 'es', 'amazon.co.jp': 'jp', 'amazon.ca': 'ca',
    'amazon.in': 'in', 'amazon.com.au': 'au', 'amazon.nl': 'nl', 'amazon.se': 'se',
    'amazon.pl': 'pl', 'amazon.com.mx': 'mx', 'amazon.com.br': 'br', 'amazon.sg': 'sg',
    'amazon.ae': 'ae', 'amazon.sa': 'sa',
  };
  var BG = {
    OK: { t: '可售', c: '#237804', bg: '#f6ffed', b: '#b7eb8f' },
    APPROVAL_REQUIRED: { t: '需批准', c: '#d46b08', bg: '#fffbe6', b: '#ffd591' },
    NOT_ELIGIBLE: { t: '不可售', c: '#cf1322', bg: '#fff1f0', b: '#ffa39e' },
    ASIN_NOT_FOUND: { t: 'ASIN无', c: '#595959', bg: '#f5f5f5', b: '#d9d9d9' },
    ERROR: { t: '失败', c: '#cf1322', bg: '#fff1f0', b: '#ffa39e' },
  };

  /* ★ 2026-11-14 卡片底色：AMZ 蓝 / FBA 红 / FBM 绿（可在扩展设置页自定义） */
  var DEF_COLORS = { amz: '#1677ff', fba: '#cf1322', fbm: '#237804', other: '#8c8c8c' };
  var COLORS = Object.assign({}, DEF_COLORS);
  function loadColors() {
    try {
      chrome.storage.local.get(['settings'], function (o) {
        var c = o && o.settings && o.settings.zylColors;
        COLORS = Object.assign({}, DEF_COLORS, (c && typeof c === 'object') ? c : {});
        recolorAll();
      });
    } catch (e) {}
  }
  function hexToRgba(hex, a) {
    var h = String(hex || '').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var v = parseInt(h, 16);
    if (isNaN(v)) return 'rgba(140,140,140,' + a + ')';
    return 'rgba(' + ((v >> 16) & 255) + ',' + ((v >> 8) & 255) + ',' + (v & 255) + ',' + a + ')';
  }
  /** 判断配送类型 → 颜色 */
  function typeOf(info) {
    if (!info) return { key: 'other', label: '', color: COLORS.other };
    if (info.shipByAmazon === true) return { key: 'amz', label: 'AMZ', color: COLORS.amz };
    if (info.isFba === true) return { key: 'fba', label: 'FBA', color: COLORS.fba };
    if (info.isFba === false) return { key: 'fbm', label: 'FBM', color: COLORS.fbm };
    return { key: 'other', label: '', color: COLORS.other };
  }
  function paintBlock(el, info) {
    if (!el) return;
    var t = typeOf(info);
    el.style.background = hexToRgba(t.color, 0.10);
    el.style.borderColor = hexToRgba(t.color, 0.45);
    el.style.borderLeft = '3px solid ' + t.color;
    el.setAttribute('data-zyl-type', t.key);
  }
  function recolorAll() {
    var nodes = document.querySelectorAll('.zyl-b[data-zyl="1"]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var asin = el.getAttribute('data-asin');
      var info = asin ? cacheGet(asin) : null;
      if (info) paintBlock(el, info);
    }
  }

  function siteOf() {
    var h = location.hostname.replace(/^www\./, '');
    return SITES[h] || 'de';
  }
  function isListPage() { return /\/s(\?|\/|$)|\?k=|\/stores\/|\/b\?|\/gp\/bestsellers/.test(location.pathname + location.search); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function send(type, payload, cb) {
    try {
      chrome.runtime.sendMessage(Object.assign({ type: type }, payload || {}), function (res) {
        if (chrome.runtime.lastError) { if (cb) cb({ ok: false, error: chrome.runtime.lastError.message }); return; }
        if (cb) cb(res);
      });
    } catch (e) { if (cb) cb({ ok: false, error: String(e && e.message || e) }); }
  }

  /* ---------- 样式（注入一次） ---------- */
  var CSS = '' +
    '.zyl-b{margin:8px 0 2px;padding:5px 7px;border:1px solid #e3e3e3;border-radius:8px;background:#fafafa;' +
    'width:auto;max-width:100%;box-sizing:border-box;' +
    'font:11.5px/1.55 -apple-system,"Segoe UI",system-ui,"PingFang SC","Microsoft YaHei",sans-serif;color:#333;display:flex;flex-wrap:wrap;gap:5px 8px;align-items:center}' +
    '.zyl-b .bg{font-weight:700;padding:0 6px;border-radius:5px;border:1px solid #ddd;line-height:17px;white-space:nowrap}' +
    '.zyl-b .kv{color:#555;white-space:nowrap}' +
    '.zyl-b .kv b{color:#111;font-weight:600}' +
    '.zyl-b .lbl{color:#999;font-size:10.5px;margin-right:2px}' +
    '.zyl-b .ld{color:#999}' +
    '.zyl-b .er{color:#c41d7f}' +
    '.zyl-b .tag{font-size:10px;font-weight:700;color:#fff;background:#2f6fd0;border-radius:4px;padding:0 5px;line-height:16px;letter-spacing:.3px}' +
    '.zyl-b .dt{font-weight:700;font-size:10.5px;padding:0 5px;border-radius:4px;line-height:16px;color:#fff}';
  function injectCss() {
    if (document.getElementById('__zyl_style__')) return;
    var st = document.createElement('style');
    st.id = '__zyl_style__';
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  /* ---------- 缓存 ---------- */
  var TTL = 10 * 60 * 1000;
  function cacheKey(a) { return 'zyl2_' + siteOf() + '_' + a; }
  function cacheGet(a) {
    try {
      var raw = sessionStorage.getItem(cacheKey(a));
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || !o.at || (Date.now() - o.at) > TTL) return null;
      return o.v;
    } catch (e) { return null; }
  }
  function cacheSet(a, v) {
    try { sessionStorage.setItem(cacheKey(a), JSON.stringify({ at: Date.now(), v: v })); } catch (e) {}
  }

  /* ---------- 渲染一行 ---------- */
  function renderBlock(el, info) {
    if (!el || !info) return;
    var bg = info.bg ? (BG[info.bg.status] || { t: info.bg.status, c: '#666', bg: '#f5f5f5', b: '#ddd' }) : null;
    var parts = [];
    if (bg) {
      var title = (info.bg && info.bg.error) ? (' title="' + esc(info.bg.error) + '"') : '';
      parts.push('<span class="bg" style="color:' + bg.c + ';background:' + bg.bg + ';border-color:' + bg.b + '"' + title + '>● ' + esc(bg.t) + (info.bg && info.bg.abbr ? ' ' + esc(info.bg.abbr) : '') + '</span>');
    }
    var tp = typeOf(info);
    if (tp.label) parts.push('<span class="dt" style="background:' + tp.color + '">' + tp.label + '</span>');
    if (info.brand) parts.push('<span class="kv"><span class="lbl">品牌</span><b>' + esc(info.brand) + '</b></span>');
    if (info.price != null) parts.push('<span class="kv"><span class="lbl">BuyBox</span><b>' + esc(info.price) + '</b> ' + esc(info.currency || '') + '</span>');
    if (info.bsrTop) parts.push('<span class="kv"><span class="lbl">类目排名</span><b>#' + esc(info.bsrTop) + '</b></span>');
    if (info.bsrMain) parts.push('<span class="kv"><span class="lbl">大类</span><b>#' + esc(info.bsrMain) + '</b></span>');
    if (info.firstDays != null) parts.push('<span class="kv"><span class="lbl">上架</span><b>' + info.firstDays + '</b> 天</span>');
    if (info.sales) parts.push('<span class="kv"><span class="lbl">月销</span><b>' + esc(info.sales) + '</b></span>');
    if (info.brandHasRecord) parts.push('<span class="kv" style="color:#237804">品牌已备案</span>');
    if (!parts.length) return;
    el.innerHTML = '<span class="tag">搞薯条</span>' + parts.join('');
    el.style.display = 'flex';
    if (info.asin) el.setAttribute('data-asin', info.asin);
    paintBlock(el, info);
  }

  /* ---------- 主流程 ---------- */
  var processed = {};    // asin -> true
  var MAX_CARDS = 200;

  function cardRoots() {
    var sels = [
      '[data-component-type="s-search-result"][data-asin]',
      'div.s-result-item[data-asin]',
      'div[data-asin][data-index]',
      '[data-asin].s-card-container',
    ];
    var out = [];
    var seen = {};
    sels.forEach(function (sel) {
      var nodes = document.querySelectorAll(sel);
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        var asin = (n.getAttribute('data-asin') || '').toUpperCase();
        if (!/^[A-Z0-9]{10}$/.test(asin)) continue;
        if (seen[asin]) continue;
        // 只要"看起来像卡片"的（有价格或标题）
        if (!n.querySelector('.a-price, [data-cy="price-recipe"], h2, .a-text-normal')) continue;
        seen[asin] = 1;
        out.push({ asin: asin, node: n });
      }
    });
    return out;
  }

  /* ★ 2026-11-15 滚动加载: 懒加载出来的卡片继续处理（以前只处理首屏 30 个） */
  var runTimer = null;
  function scheduleRun() {
    if (runTimer) return;
    runTimer = setTimeout(function () { runTimer = null; run(); }, 600);
  }
  window.addEventListener('scroll', scheduleRun, { passive: true });
  document.addEventListener('DOMContentLoaded', scheduleRun);
  (function () {
    /* 兜底轮询: 有些列表页滚动事件不触发(嵌套滚动容器), 每 2 秒扫一次 */
    setInterval(function () { if (isListPage()) scheduleRun(); }, 2000);
    try {
      var mo = new MutationObserver(scheduleRun);
      mo.observe(document.body, { childList: true, subtree: true });
    } catch (e) {}
  })();

  function run() {
    if (!isListPage()) return;
    injectCss();
    var cards = cardRoots().slice(0, MAX_CARDS);
    if (!cards.length) return;

    var todo = [];
    cards.forEach(function (c) {
      var cached = cacheGet(c.asin);
      if (cached) { ensureBlock(c, cached); return; }
      if (processed[c.asin]) return;
      processed[c.asin] = true;
      ensureBlock(c, null);   // 先占位显示"检测中"
      todo.push(c);
    });

    if (!todo.length) return;
    // 分批：每批 12 个，逐批请求（避免一次太多导致慢）
    var chunks = [];
    for (var i = 0; i < todo.length; i += 12) chunks.push(todo.slice(i, i + 12));
    chunks.forEach(function (chunk, idx) {
      setTimeout(function () {
        send('ZY_CARDS', { asins: chunk.map(function (x) { return x.asin; }), site: siteOf() }, function (res) {
          if (!res || !res.ok || !res.items) {
            chunk.forEach(function (c) {
              var b = blockOf(c.node);
              if (b) { b.innerHTML = '<span class="er">✗ ' + esc((res && (res.error || res.message)) || '取数失败') + '</span>'; }
            });
            return;
          }
          chunk.forEach(function (c) {
            var info = res.items[c.asin];
            if (!info) { var b0 = blockOf(c.node); if (b0) b0.style.display = 'none'; return; }
            cacheSet(c.asin, info);
            var b = blockOf(c.node);
            renderBlock(b, info);
            if (b) b.setAttribute('data-zyl', '1');
          });
        });
      }, idx * 250);
    });
  }

  function blockOf(card) {
    var b = card.querySelector('.zyl-b');
    if (b) return b;
    b = document.createElement('div');
    b.className = 'zyl-b';
    b.innerHTML = '<span class="ld">搞薯条：检测中…</span>';
    /* ★ 2026-11-14 恢复原位置：插在标题/价格这一块之后（智赢面板之上，视觉最自然） */
    var anchor = card.querySelector('.a-row.a-size-base.a-color-secondary, .a-price, .a-row') || null;
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(b, anchor.nextSibling);
    else card.appendChild(b);
    return b;
  }

  function ensureBlock(card, info) {
    var b = blockOf(card.node);
    if (!b) return;
    if (info) { renderBlock(b, info); b.setAttribute('data-zyl', '1'); }
  }

  /* 首次 + 滚动加载更多时增量处理 */
  loadColors();
  try {
    chrome.storage.onChanged.addListener(function (ch, area) {
      if (area === 'local' && ch.settings) {
        var c = ch.settings.newValue && ch.settings.newValue.zylColors;
        COLORS = Object.assign({}, DEF_COLORS, (c && typeof c === 'object') ? c : {});
        recolorAll();
      }
    });
  } catch (e) {}
  setTimeout(run, 1500);
  var lastRun = 0;
  function throttledRun() {
    var now = Date.now();
    if (now - lastRun < 2500) return;
    lastRun = now;
    run();
  }
  try {
    var obs = new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) { if (muts[i].addedNodes && muts[i].addedNodes.length) { throttledRun(); return; } }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {}
  window.addEventListener('scroll', throttledRun, { passive: true });
})();

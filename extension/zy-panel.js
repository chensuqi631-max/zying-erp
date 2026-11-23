// 搞薯条 · 商品面板 v3（注入 Amazon 商品页，替换旧 zy-panel.js）
// -----------------------------------------------------------------------------
// 设计：
//   · 数据来源 = 我们的 ERP（直连通道 / ifast 直连），不经过智赢插件
//   · 内容页脚本不能直连 127.0.0.1 → 统一通过 background 的 ZY_API 转发
//   · 面板分区：① 商品信息 ② 重量/算价 ④ 上架店铺 ⑤ 变体上架 ⑦ ifast 直连
//   · ② 的「±」= 本币调整，按站点记忆（DE 默认 -3），换商品/刷新都保留
// -----------------------------------------------------------------------------
(function () {
  'use strict';
  if (window.__ZYP_INJECTED__) return;
  window.__ZYP_INJECTED__ = true;

  /* 只在商品详情页注入（列表页由 zy-list.js 负责） */
  (function () {
    var m = location.pathname.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})/i);
    if (!m) { window.__ZYP_NO_PANEL__ = true; }
  })();
  if (window.__ZYP_NO_PANEL__) return;

  var SITES = {
    'amazon.com': 'US', 'amazon.de': 'DE', 'amazon.co.uk': 'UK', 'amazon.fr': 'FR',
    'amazon.it': 'IT', 'amazon.es': 'ES', 'amazon.co.jp': 'JP', 'amazon.ca': 'CA',
    'amazon.in': 'IN', 'amazon.com.au': 'AU', 'amazon.nl': 'NL', 'amazon.se': 'SE',
    'amazon.pl': 'PL', 'amazon.com.mx': 'MX', 'amazon.com.br': 'BR', 'amazon.sg': 'SG',
    'amazon.ae': 'AE', 'amazon.sa': 'SA',
  };
  var CC = { US: 'US', DE: 'DE', UK: 'GB', FR: 'FR', IT: 'IT', ES: 'ES', JP: 'JP', CA: 'CA', IN: 'IN', AU: 'AU', NL: 'NL', SE: 'SE', PL: 'PL', MX: 'MX', BR: 'BR', SG: 'SG', AE: 'AE', SA: 'SA' };
  var CUR = { US: '$', DE: '€', UK: '£', FR: '€', IT: '€', ES: '€', JP: '¥', CA: 'C$', AU: 'A$' };
  var FX_DEF = { US: 7.1, DE: 7.38, UK: 8.83, FR: 7.38, IT: 7.38, ES: 7.38, JP: 0.047, CA: 5.2, AU: 4.73 };
  var BG = {
    OK: { t: '可售', c: '#237804', bg: '#f6ffed', b: '#b7eb8f' },
    APPROVAL_REQUIRED: { t: '需批准', c: '#d46b08', bg: '#fffbe6', b: '#ffd591' },
    NOT_ELIGIBLE: { t: '不可售', c: '#cf1322', bg: '#fff1f0', b: '#ffa39e' },
    ASIN_NOT_FOUND: { t: 'ASIN无', c: '#595959', bg: '#f5f5f5', b: '#d9d9d9' },
    ERROR: { t: '出错', c: '#8c8c8c', bg: '#fafafa', b: '#d9d9d9' },
  };

  function siteOf() {
    var h = location.hostname.replace(/^www\./, '');
    return SITES[h] || 'US';
  }
  function asinOf() {
    var m = location.pathname.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})/i);
    return m ? m[1].toUpperCase() : null;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function num(v) { var n = Number(String(v == null ? '' : v).replace(/[^\d.\-]/g, '')); return isFinite(n) ? n : null; }
  function r2(v) { return Math.round((Number(v) || 0) * 100) / 100; }
  function curSym(site) { return CUR[site] || '€'; }

  /* ---------- 与 background 通讯 ---------- */
  /* ★ 2026-11-21 扩展被重载后，页面里的旧脚本会报 Extension context invalidated —— 自动刷新页面恢复 */
  var __ctxReloading = false;
  function zvCtxInvalid(m) { return /Extension context invalidated/i.test(String(m || '')); }
  function zvHandleCtxInvalid() {
    if (__ctxReloading) return;
    __ctxReloading = true;
    try { ft.textContent = '扩展已更新，正在刷新页面以恢复连接…'; } catch (e) {}
    try {
      var d = document.createElement('div');
      d.textContent = '扩展已更新，正在刷新页面…';
      d.style.cssText = 'position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:2147483647;background:#f5222d;color:#fff;padding:8px 14px;border-radius:8px;font:13px sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.4)';
      document.body.appendChild(d);
    } catch (e) {}
    setTimeout(function () { try { location.reload(); } catch (e) {} }, 1500);
  }
  function send(type, payload, cb) {
    try {
      chrome.runtime.sendMessage(Object.assign({ type: type }, payload || {}), function (res) {
        if (chrome.runtime.lastError) {
          var lm = chrome.runtime.lastError.message;
          if (zvCtxInvalid(lm)) { zvHandleCtxInvalid(); return; }
          if (cb) cb({ ok: false, error: lm });
          return;
        }
        if (cb) cb(res);
      });
    } catch (e) {
      var em = String((e && e.message) || e);
      if (zvCtxInvalid(em)) { zvHandleCtxInvalid(); return; }
      if (cb) cb({ ok: false, error: em });
    }
  }
  /** 调 ERP 的 /api/*（经 background 转发） */
  function erp(method, path, body) {
    return new Promise(function (res) {
      send('ZY_API', { method: method, path: path, body: body || null }, function (r) { res(r || { ok: false, error: 'no response' }); });
    });
  }

  /* ---------- 设置（按站点记忆 ± 调整） ---------- */
  var STORE_KEY = 'zyp_v3_settings';
  var SET = { shopId: '', stock: 100, leadDays: 5, autoUpload: false, adjBySite: {},
    /* ★ 2026-11-21 各国税率（%），锁定后按国家取值计算 */
    taxBySite: { UK: 0.68, AU: 0.85, DE: 0.68, ES: 0.68, IT: 0.68, FR: 0.68 }, taxKMode: true, taxLock: false, taxSite: '',
    /* ★ 2026-11-21 手动承受价（按 ASIN 持久化，填了就不再被公式覆盖） */
    manualBearByAsin: {},
    /* ★ 2026-11-22 锁定初始价（按 ASIN 持久化）:
     *   用户改过的「初始价」记在这里，切换网页/重新加载变体后依然用这个值，
     *   不会被数据源重算覆盖；用户随时可以再改(改了即更新这里的锁定值)。 */
    initPriceByAsin: {}, fieldLocks: {} };
  function loadSettings(cb) {
    try {
      chrome.storage.local.get(STORE_KEY, function (o) {
        var v = (o && o[STORE_KEY]) || null;
        if (v) SET = Object.assign(SET, v);
        try {
          /* 2026-11-21 一次性迁移：检测到旧百分比税率（>1）→ 换成定价表「到手比例 K」 */
          var __needMig = (function (m) { for (var k in m) { if (Number(m[k]) > 1) return true; } return false; })(SET.taxBySite || {});
          if (__needMig || !SET.taxKMode) {
            var __old = SET.taxBySite || {};
            var __cv = function (v, dft) { var x = Number(v); if (!isFinite(x) || x <= 0) return dft; return x > 1 ? Math.round((1 - x / 100) * 100) / 100 : x; };
            SET.taxBySite = { UK: 0.68, DE: 0.68, AU: 0.85, ES: __cv(__old.ES, 0.68), IT: __cv(__old.IT, 0.68), FR: __cv(__old.FR, 0.68) };
            SET.taxKMode = true;
            try { saveSettings(); } catch (e2) {}
          }
          SET.taxBySite = Object.assign({ UK: 0.68, AU: 0.85, DE: 0.68, ES: 0.68, IT: 0.68, FR: 0.68 }, SET.taxBySite || {});
          if (SET.taxLock == null) SET.taxLock = false;
        } catch (e) {}
        S.initAdj = Number(SET.initAdj) || 0;
        S.autoUpload = !!SET.autoUpload;
        if (!SET.adjBySite || typeof SET.adjBySite !== 'object') SET.adjBySite = {};
        cb();
      });
    } catch (e) { cb(); }
  }
  function saveSettings() { try { var o = {}; o[STORE_KEY] = SET; chrome.storage.local.set(o); } catch (e) {} }
  function adjOf(site) {
    if (SET.adjBySite[site] != null) return Number(SET.adjBySite[site]) || 0;
    return site === 'DE' ? -3 : 0;
  }

  /* ---------- 面板容器（shadow DOM，隔离页面样式） ---------- */
  var host = document.createElement('div');
  host.id = '__zyp_host__';
  host.style.cssText = 'position:fixed;top:88px;right:16px;z-index:2147483600;';
  var root = host.attachShadow({ mode: 'open' });
/* ★ 2026-11-23 轮询兜底：输入框失焦后自动记字段锁（换页/刷新保留 + 蓝框） */
try {
  setInterval(function () {
    try {
      if (!S || !S.variants || !S.variants.length) return;
      var MAP = [['data-r-w','weight'],['data-r-cost','cost'],['data-r-margin','margin'],['data-r-tax','tax'],['data-r-fx','fx'],['data-r-adj','adj'],['data-r-bp','bear'],['data-r-ip','ip'],['data-r-ipadj','ipAdj']];
      var act = document.activeElement;
      MAP.forEach(function (pair) {
        root.querySelectorAll('[' + pair[0] + ']').forEach(function (el) {
          var raw = String(el.value || '').trim();
          if (el.__lkSeen !== 1) { el.__lkSeen = 1; el.__lkLast = raw; return; }
          if (el.__lkLast === raw) return;
          el.__lkLast = raw;
          if (act === el) return;
          var asin = el.getAttribute(pair[0]);
          if (!asin) return;
          var f = pair[1];
          var v = S.variants.find(function (x) { return String(x.asin) === String(asin); });
          if (!v) return;
          if (f === 'weight') v.weight = (raw === '' ? null : Math.max(1, Math.round(Number(raw) || 0)));
          else if (f === 'bear') v.manualPrice = (raw === '' ? null : Number(raw));
          else if (f === 'ip') v.price = (raw === '' ? null : (Number(raw) - (Number(S.initAdj) || 0)));
          else if (f === 'ipAdj') v.ipAdj = (raw === '' ? null : Number(raw));
          else v[f] = (raw === '' ? null : Number(raw));
          saveFieldLock(asin, f, raw);
          el.style.borderColor = raw === '' ? '' : '#4c9aff';
          el.style.boxShadow = raw === '' ? '' : '0 0 0 1px rgba(76,154,255,.35)';
          try { render(); } catch (eR) {}
        });
      });
    } catch (e) {}
  }, 900);
} catch (e) {}
  document.documentElement.appendChild(host);

  var CSS = [
    ':host{all:initial}',
    '*{box-sizing:border-box;font-family:-apple-system,"Segoe UI",system-ui,"PingFang SC","Microsoft YaHei",sans-serif}',
    '.wrap{width:378px;max-height:86vh;display:flex;flex-direction:column;background:#0f1114;border:1px solid #2b3038;border-radius:12px;box-shadow:0 10px 32px rgba(0,0,0,.55);color:#e7eaf0;font-size:12.5px;overflow:hidden}',
    '.hd{display:flex;align-items:center;gap:6px;padding:8px 10px;background:#15181d;border-bottom:1px solid #23272e}',
    '.hd b{font-size:12.5px}',
    '.hd .sp{flex:1}',
    '.hd button{all:unset;cursor:pointer;padding:2px 8px;border:1px solid #2b3038;border-radius:6px;color:#cfd4dc;font-size:11.5px}',
    '.hd button:hover{background:#22272e}',
    '.bd{overflow:auto;padding:0}',
    '.sec{padding:8px 10px;border-bottom:1px solid #1c2026}',
    '.sec h4{margin:0 0 6px;font-size:11.5px;color:#9aa3af;font-weight:600;display:flex;align-items:center;gap:6px;flex-wrap:wrap}',
    '.row{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:4px 0}',
    '.kv{display:flex;gap:6px;font-size:11.5px;color:#b9c0c9;padding:1px 0}',
    '.kv b{color:#e7eaf0;font-weight:600}',
    '.note{font-size:10.5px;color:#8b939d}',
    '.inp{background:#0b0d10;border:1px solid #2b3038;border-radius:6px;color:#e7eaf0;padding:3px 6px;font-size:12px;outline:none}',
    '.inp:focus{border-color:#3f7fd0}',
    '.num{width:66px;text-align:right}',
    '.sm{width:44px;text-align:right}',
    '.btn{all:unset;cursor:pointer;padding:4px 10px;border:1px solid #2b3038;border-radius:6px;color:#d3d8e0;font-size:11.5px;background:#15181d}',
    '.btn:hover{background:#22272e}',
    '.pri{background:#e7eaf0;color:#14161a;border-color:#e7eaf0;font-weight:600}',
    '.pri:hover{background:#f2f5f9}',
    '.adjbox{display:inline-flex;align-items:center;gap:2px}',
    '.old{text-decoration:line-through;color:#e06c72;margin-right:4px}',
    '.wrap{position:relative}',
    '.hd{cursor:move;user-select:none}',
    '.rs{position:absolute;right:0;bottom:0;width:16px;height:16px;cursor:nwse-resize;z-index:5;background:linear-gradient(135deg,transparent 46%,#5a6472 46%,#5a6472 58%,transparent 58%)}',
    '.wide{overflow-x:auto;margin-top:4px}',
    '.wtab{min-width:1080px}',
    '.wtab th{white-space:nowrap;font-size:10.5px;position:sticky;top:0;background:#0f1114;z-index:2;box-shadow:0 1px 0 #23272e}',
    '.wtab td{white-space:nowrap;vertical-align:top;padding:3px 4px}',
    '.wtab .inp{width:62px}',
    '.wtab .sm{width:46px}',
    '.wmin{max-height:60vh}',
    '.newv{color:#5fd08a;font-weight:600}',
    '.bg{display:inline-block;padding:0 6px;border-radius:999px;font-size:10.5px;border:1px solid}',
    '.spec{display:inline-block;padding:1px 6px;border:1px solid #2b3038;border-radius:999px;font-size:10.5px;color:#b9c0c9}',
    '.tbl{width:100%;border-collapse:collapse;font-size:11.5px}',
    '.tbl th{text-align:left;color:#8b939d;font-weight:500;padding:4px 3px;border-bottom:1px solid #23272e}',
    '.tbl td{padding:4px 3px;border-bottom:1px solid #1c2026}',
    '.ft{padding:5px 10px;border-top:1px solid #23272e;font-size:10.5px;color:#7d858f;display:flex;gap:6px;align-items:center}',
    '.mini{display:none}',
  '.fab:hover{transform:scale(1.08);transition:transform .15s ease}',
    '.setwrap{position:absolute;inset:0;background:#14161a;border:1px solid #2b3038;border-radius:10px;display:flex;flex-direction:column;overflow:hidden;z-index:5}',
    '.sethd{display:flex;align-items:center;gap:6px;padding:4px 8px;border-bottom:1px solid #2b3038;background:#1b1f24;font-size:12px}',
    '.sethd .sp{flex:1}',
    '.btn.s{font-size:11px;padding:1px 6px;text-decoration:none;color:#e7eaf0;background:#232833;border:1px solid #2b3038;border-radius:4px;cursor:pointer}',
    '.setframe{flex:1;width:100%;border:0;background:#14161a}',
    '.setfallback{padding:10px;color:#e0b25c;font-size:12px}',
    '.fab{position:fixed;right:16px;top:88px;width:38px;height:38px;border-radius:50%;background:transparent;color:#14161a;border:none;padding:0;overflow:hidden;display:none;align-items:center;justify-content:center;font-size:17px;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.5);z-index:2147483601}',
  ].join('\n');

  var styleEl = document.createElement('style');
  styleEl.textContent = CSS;
  root.appendChild(styleEl);

  /* ---------- 状态 ---------- */
  var S = {
    site: siteOf(), asin: asinOf(),
    weightG: 450, cost: 30, margin: 0.3, net: 0.65, fx: FX_DEF[siteOf()] || 7.38,
    adj: adjOf(siteOf()),
    price: null, freight: null, freightCh: '', freightErr: '',
    variants: [], varsSel: {}, dims: {}, colors: {},
    ifast: { ok: false, shops: [], sites: [] },
    tokens: { activeId: null, accounts: [] },   // ★ 智赢多账号（ERP /api/zy/tokens）
    siteStats: null,                            // ★ 各站点 大排名/配送方式（ERP /api/zy/asin-sites）
    listing: null,                              // ★ 各站点已上架记录（ERP /api/listing/check）
    panelBox: (SET.panelBox || null),           // ★ 面板位置/尺寸（拖动/缩放后记忆）
    shopsSel: {}, bg: [], bgStat: {}, accounts: [], accSel: {}, product: null,
    initAdj: 0, autoUpload: false,
    view: 'main', setD: null, setChs: null, setRates: null,
    collapsed: true,   /* ★ 2026-11-21 需求：进入商品页默认收起为圆球 */
    busy: false,
  };
  /* ★ 2026-11-23 每个填空框独立锁定（重量/采购/利润率/税率/汇率/±/承受价/初始价） */
  function fieldLockOf(asin, f) {
    var m = (SET.fieldLocks || {})[String(asin)] || {};
    var v = m[f];
    return (v != null && v !== '' && isFinite(Number(v))) ? Number(v) : null;
  }
  function lockStyle(asin, f) {
    return fieldLockOf(asin, f) != null
      ? ' style="border-color:#4c9aff;box-shadow:0 0 0 1px rgba(76,154,255,.35)" title="已锁定：清空即解锁"'
      : ' title="填入数字即锁定：换页/重算都保留"';
  }
  function saveFieldLock(asin, f, raw) {
    try {
      if (!SET.fieldLocks || typeof SET.fieldLocks !== 'object') SET.fieldLocks = {};
      var k = String(asin);
      if (!SET.fieldLocks[k]) SET.fieldLocks[k] = {};
      if (raw === '' || raw == null || !isFinite(Number(raw))) delete SET.fieldLocks[k][f];
      else SET.fieldLocks[k][f] = Number(raw);
      saveSettings();
    } catch (e) {}
  }
  S.shopId = SET.shopId || '';

  /* ---------- 构建 ---------- */
  var wrap = document.createElement('div'); wrap.className = 'wrap';
  var hd = document.createElement('div'); hd.className = 'hd';
  hd.innerHTML = '<b>🍟 搞薯条面板</b><span class="sp"></span>'
    + '<button data-act="refresh">刷新</button>'
    + '<button data-act="settings" title="打开设置页（算价/物流/采集/上传默认值/连接）">⚙</button>'
    + '<button data-act="collapse">–</button>'
    + '<button data-act="close">✕</button>';
  var bd = document.createElement('div'); bd.className = 'bd';
  var ft = document.createElement('div'); ft.className = 'ft';
  wrap.appendChild(hd); wrap.appendChild(bd); wrap.appendChild(ft);
root.appendChild(wrap);
  var fab = document.createElement('div'); fab.className = 'fab'; fab.title = '搞薯条';
/* ★ 2026-11-23 圆球换成项目 Logo（薯条盒 + 金色薯条 + 增长箭头） */
fab.innerHTML = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\" width=\"100%\" height=\"100%\">\n  <circle cx=\"32\" cy=\"32\" r=\"30\" fill=\"#14161a\" stroke=\"#f2b705\" stroke-width=\"2.5\"/>\n  <rect x=\"20\" y=\"12\" width=\"6\" height=\"20\" rx=\"2.4\" fill=\"#f7c948\" transform=\"rotate(-8 23 22)\"/>\n  <rect x=\"29\" y=\"8\"  width=\"6\" height=\"24\" rx=\"2.4\" fill=\"#ffd75e\"/>\n  <rect x=\"38\" y=\"11\" width=\"6\" height=\"21\" rx=\"2.4\" fill=\"#f7c948\" transform=\"rotate(8 41 21)\"/>\n  <rect x=\"24\" y=\"16\" width=\"5\" height=\"18\" rx=\"2\" fill=\"#ffdf7e\" transform=\"rotate(-3 26 25)\"/>\n  <path d=\"M16 32 L48 32 L43.5 54 Q43 56.5 40.5 56.5 L23.5 56.5 Q21 56.5 20.5 54 Z\" fill=\"#e63946\"/>\n  <path d=\"M16 32 L48 32 L46.6 37 L17.4 37 Z\" fill=\"#c92f3c\"/>\n  <path d=\"M32 50 L27 43.5 L30.3 43.5 L30.3 39 L33.7 39 L33.7 43.5 L37 43.5 Z\" fill=\"#fff3d6\"/>\n  <path d=\"M18 24 Q20 14 30 11\" fill=\"none\" stroke=\"#ffffff\" stroke-opacity=\".18\" stroke-width=\"2\" stroke-linecap=\"round\"/>\n</svg>";
  root.appendChild(fab);
  /* ★ 2026-11-21 初始即圆球：面板隐藏、只留右下/右上的🍟圆球；点圆球展开 */
  try {
    if (S.collapsed) { wrap.classList.add('mini'); fab.style.display = 'flex'; }
  } catch (e) {}

  /* ★ 2026-11-23 「BG 多站点检测 → 重新检测」 */
  try {
    root.addEventListener('click', function (e) {
      var el = e.target && e.target.closest ? e.target.closest('[data-act=bg-refresh]') : null;
      if (!el) return;
      e.preventDefault(); e.stopPropagation();
      ft.textContent = '正在按全部可用店铺重新检测 BG…';
      erp('POST', '/api/bg/by-asin', { asin: S.asin }).then(function (j) {
        if (j && j.ok) { S.bgSites = j.items || {}; ft.textContent = 'BG 多站点检测完成'; render(); }
        else ft.textContent = '检测失败: ' + ((j && j.error) || '未知错误');
      }).catch(function (e2) { ft.textContent = '检测失败: ' + e2.message; });
    }, true);
  } catch (eBG) {}

  /* ★ 2026-11-23 收到 popup/background 消息 → 打开面板内置设置 */
  try {
    chrome.runtime.onMessage.addListener(function (msg) {
      if (msg && msg.type === 'ZYP_OPEN_SETTINGS') { try { openSettings(); } catch (e) {} }
    });
  } catch (e) {}

  hd.addEventListener('click', function (e) {
    var a = e.target && e.target.getAttribute && e.target.getAttribute('data-act');
    if (!a) return;
    if (a === 'refresh') loadAll(true);
    else if (a === 'settings') { openSettings(); }
    else if (a === 'collapse') { S.collapsed = true; wrap.classList.add('mini'); fab.style.display = 'flex'; }
    else if (a === 'close') { wrap.style.display = 'none'; fab.style.display = 'flex'; }
  });
fab.addEventListener('click', function () { S.collapsed = false; wrap.classList.remove('mini'); wrap.style.display = 'flex'; fab.style.display = 'none'; });

  /* ---------- 计算 ---------- */
  /* ★ 2026-11-21 税率替代到手比例：锁定=按国家税率，未锁定=可用行内税率，默认取国家税率 */
  function taxPctOf(site) {
    var up = String(site || S.site || '').toUpperCase();
    var m = SET.taxBySite || {};
    var v = m[up];
    return v == null ? 0 : (Number(v) || 0);
  }
  function effTaxPct(v) {
    if (SET.taxLock) return taxPctOf(S.site);
    if (v && v.tax != null && isFinite(Number(v.tax))) return Number(v.tax);
    return taxPctOf(S.site);
  }
  /* 2026-11-21 定价表口径：本币价 = 售价 ÷ K ÷ 汇率（K=到手比例 0.68/0.85）；>1 视为百分比按 (1-v/100) 兼容 */
  function kOf(v) {
    var x = Number(v);
    if (!isFinite(x) || x <= 0) return 1;
    if (x > 1) x = 1 - x / 100;
    return Math.min(1, Math.max(0.05, x));
  }
  function bearBase() {
    var ship = S.freight != null ? S.freight : 0;
    var cnyCost = r2(ship + (Number(S.cost) || 0));
    var cnyPrice = r2(cnyCost * (1 + (Number(S.margin) || 0)));
    var k = kOf(effTaxPct(null));
    var fx = Number(S.fx) || 7.8;
    return r2(cnyPrice / k / fx);
  }
  function bearRow(v) {
    /* 手填承受价优先（含持久化值） */
    var mv = null;
    if (v && v.manualPrice != null && isFinite(Number(v.manualPrice))) mv = Number(v.manualPrice);
    else if (v && SET.manualBearByAsin && SET.manualBearByAsin[String(v.asin)] != null && isFinite(Number(SET.manualBearByAsin[String(v.asin)]))) mv = Number(SET.manualBearByAsin[String(v.asin)]);
    if (mv != null) return r2(mv);
    return r2(bearBase() + (Number(S.adj) || 0));
  }

  /* ---------- 数据加载 ---------- */
  /* 底部状态: 第一行 ERP 直连时间, 第二行 ifast 直连状态 */
  function footSet(prodOk, ifs, stamp) {
    if (ft) { ft.style.flexDirection = 'column'; ft.style.alignItems = 'flex-start'; ft.style.lineHeight = '1.45'; }
    var t = stamp || new Date().toLocaleTimeString('zh-CN');
    var i = (ifs && ifs.ok)
      ? ('ifast 直连 · ● 已连接 · ' + ((ifs.shops || []).length) + ' 个跟卖方案')
      : ('ifast 直连 · ● 未连接' + (ifs && ifs.error ? ('（' + ifs.error + '）') : ''));
    ft.innerHTML = '<div>' + (prodOk ? 'ERP 直连 · ' : 'ERP 无数据 · ') + esc(t) + '</div><div>' + esc(i) + '</div>';
  }

  function localeAutoCheck() {
    try {
      var siteUp = String(S.site || '').toUpperCase();
      var low = siteUp === 'UK' ? 'uk' : siteUp.toLowerCase();
      var loc = (SET.localeBySite || {})[siteUp] || {};
      var zip = loc.zip || SITE_ZIP[low];
      var cur = loc.currency || SITE_CUR[low];
      if (!zip || !cur) return;
      var addrEl = document.querySelector('#glow-ingress-line2');
      var addrTxt = addrEl ? String(addrEl.textContent || '') : '';
      var m = document.cookie.match(/i18n-prefs=([^;]+)/);
      var curNow = m ? m[1] : '';
      var zipNorm = String(zip).replace(/\s/g, '').toUpperCase();
      var addrNorm = addrTxt.replace(/[\u200b-\u200f\u2060\ufeff\s]/g, '').toUpperCase();
      var zipOk = !!zipNorm && addrNorm.indexOf(zipNorm) >= 0;
      var curOk = String(curNow).toUpperCase() === String(cur).toUpperCase();
      if (zipOk && curOk) return;
      var key = 'zyp_locfix_' + low + '_' + zipNorm + '_' + cur;
      try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, '1'); } catch (e) { }
      ft.textContent = '正在把本站点切成 ' + siteUp + '（邮编 ' + zip + ' · 货币 ' + cur + '）…';
      localeFixLocal(zip, cur).then(function () {
        setTimeout(function () { location.reload(); }, 900);
      });
    } catch (e) { }
  }

  function loadAll(manual) {
    if (S.busy) return;
    S.busy = true;
    ft.textContent = '加载中…';
    var asin = asinOf(); S.asin = asin; S.site = siteOf();
    S.adj = adjOf(S.site);
    S.fx = FX_DEF[S.site] || S.fx;
    if (!manual) localeAutoCheck();
    if (!asin) { render(); S.busy = false; return; }

    var p1 = new Promise(function (res) { send('ZY_PANEL', { asin: asin, site: S.site }, function (r) { res(r || {}); }); });
    var p2 = erp('GET', '/api/ifast/status').catch(function () { return {}; });
    var p3 = new Promise(function (res) { send('ZY_ACCOUNTS', {}, function (r) { res((r && r.accounts) || []); }); });
    var p4 = erp('GET', '/api/zy/tokens').catch(function () { return {}; });
    var p5 = (SET.useLiveFx !== false) ? erp('GET', '/api/rates').catch(function () { return {}; }) : Promise.resolve({});
    Promise.all([p1, p2, p3, p4, p5]).then(function (arr) {
      S.tokens = { activeId: (arr[3] && arr[3].activeId) || null, accounts: (arr[3] && arr[3].accounts) || [] };
      var prod = arr[0] || {}, ifs = arr[1] || {};
      S.accounts = (arr[2] || []).filter(function (a) { return a && a.usable !== false; });
      /* ★ 2026-11-18 实时汇率同步到变体汇率框（勾选「英/德/澳 也用 ERP 实时汇率」时） */
      try {
        if (SET.useLiveFx !== false) {
          var _rr = (arr[4] && arr[4].rates) || null;
          if (_rr) {
            S.setRates = arr[4];
            var _cur = SITE_CUR[String(S.site).toLowerCase()];
            if (_cur && _rr[_cur] > 0) S.fx = r2(_rr[_cur]);
          }
        }
      } catch (e) {}
      S.dbg = { ifast: JSON.stringify(ifs).slice(0, 300) };
      S.product = prod;
      S.price = num(prod.price);
      S.ifast = { ok: !!ifs.ok, shops: ifs.shops || [], sites: ifs.sites || [] };
      if (S.ifast.shops.length && !S.shopId) {
        var match = S.ifast.shops.find(function (x) { return x.name && /全天/.test(x.name); }) || S.ifast.shops[0];
        S.shopId = match.id;
      }
      S.shopsSel = {};
      S.ifast.shops.forEach(function (x, i) { S.shopsSel[x.id] = i === 0; });
      var ccSite = CC[S.site] || S.site;
      S.accSel = {};
      S.accounts.forEach(function (a) { S.accSel[a.id] = (String(a.abbr || '').toUpperCase() === ccSite); });
      if (!S.accounts.some(function (a) { return S.accSel[a.id]; }) && S.accounts.length) S.accSel[S.accounts[0].id] = true;
      footSet(prod.ok, ifs);
      /* ★ 拉当前 ASIN 在各站点的 大排名 / AMZ-FBA-FBM（面板 ④ 用） */
      S.siteStats = null;
      try {
        var siteList0 = S.accounts.map(function (a) { return String(a.abbr || '').toUpperCase(); })
          .map(function (ab) { return ab === 'GB' ? 'uk' : ab.toLowerCase(); })
          .filter(function (x) { return /^[a-z]{2}$/.test(x); });
        siteList0 = siteList0.filter(function (x, i) { return siteList0.indexOf(x) === i; });
        S.listing = {};
        siteList0.forEach(function (st) {
          erp('GET', '/api/listing/check?asin=' + encodeURIComponent(asin) + '&site=' + encodeURIComponent(st)).then(function (j) {
            if (j && j.ok) { S.listing[st] = { duplicated: !!j.duplicated, where: j.where || [] }; render(); }
          }).catch(function () {});
        });
        if (siteList0.length && asin) {
          erp('GET', '/api/zy/asin-sites?asin=' + encodeURIComponent(asin) + '&sites=' + siteList0.join(',')).then(function (j) {
            if (j && j.ok) { S.siteStats = j.items || {}; render(); }
          }).catch(function () {});
        }
      } catch (e) {}
      /* 变体族 + 尺寸 + 颜色 */
      /* ★ 2026-11-15 变体: 优先走 ERP 接口（页面 HTML 逆向 + 数据源补价，不依赖页面渲染） */
      var pf = pageFacts();
      S.pageFacts = pf;
      return erp('POST', '/api/zy/variants', { asin: asin, site: String(S.site).toLowerCase() }).catch(function () { return { ok: false }; }).then(function (vr) {
        var out = [];
        if (vr && vr.ok && vr.items && vr.items.length) {
          vr.items.forEach(function (x) {
            out.push({ asin: x.asin, price: (x.price == null ? null : Number(x.price)), cur: x.currency || null,
              title: '', brand: (prod && prod.brand) || '', image: '', manualPrice: null, attrs: x.attrs || [] });
          });
          S.variantSrc = 'http';
          S.pageCurs = [(vr.items[0] && vr.items[0].currency) || ''];
          S.pageCurMismatch = false;
        } else {
          /* 兜底: 页面内解析（接口失败时） */
          var pv = pageVariants();
          pv.forEach(function (p) {
            out.push({ asin: p.asin, price: (p.price == null ? null : p.price), cur: null,
              title: '', brand: (prod && prod.brand) || '', image: '', manualPrice: null, attrs: p.attrs || [] });
          });
          S.variantSrc = 'page';
          S.pageCurs = [];
          S.pageCurMismatch = false;
        }
        if (!out.length && asin) {
          out = [{ asin: asin, price: (prod && prod.price != null ? Number(prod.price) : null), cur: (prod && prod.currency) || null,
            title: (prod && prod.title) || '', brand: (prod && prod.brand) || '', image: (prod && prod.image) || '', manualPrice: null, attrs: [] }];
        }
        var curV = out.filter(function (v) { return v.asin === asin; })[0];
        out.forEach(function (v) { if (!v.title && curV) { v.title = curV.title; v.brand = curV.brand; v.image = curV.image; } });
        S.variants = out;
        /* ★ 2026-11-22 初始价锁定: 把「每个 ASIN 锁定过的初始价」回填到 price(扣掉该行初始±),
         *   这样后面所有重算/渲染/上架取值都等于用户锁定后的数字, 切网页也不会变。 */
        (function applyInitPriceLocks() {
          var m = SET.initPriceByAsin || {};
          S.variants.forEach(function (v) {
            var lk = m[String(v.asin)];
            if (lk == null || lk === '' || !isFinite(Number(lk))) return;
            var adj = (v.ipAdj != null && isFinite(Number(v.ipAdj))) ? Number(v.ipAdj) : (Number(S.initAdj) || 0);
            v.price = r2(Number(lk) - adj);
            v.priceLocked = true;
          });
        })();
        /* ★ 2026-11-23 隐式锁定（每行独立）：只回填「这个 ASIN 填过的初始价」，切回同一商品仍保留 */
        try {
          var __m = SET.initPriceByAsin || {};
          S.variants.forEach(function (x) {
            var lk = __m[String(x.asin)];
            if (lk == null || lk === '' || !isFinite(Number(lk))) return;
            var a2 = (x.ipAdj != null && isFinite(Number(x.ipAdj))) ? Number(x.ipAdj) : (Number(S.initAdj) || 0);
            x.price = r2(Number(lk) - a2); x.priceLocked = true;
          });
        } catch (eG) {}
        /* ★ 2026-11-23 回填字段锁 */
        try {
          var __fl = SET.fieldLocks || {};
          S.variants.forEach(function (x) {
            var m = __fl[String(x.asin)];
            if (!m) return;
            ['weight','cost','margin','tax','fx','adj'].forEach(function (f) { if (m[f] != null && isFinite(Number(m[f]))) x[f] = Number(m[f]); });
            if (m.bear != null && isFinite(Number(m.bear))) x.manualPrice = Number(m.bear);
            if (m.ip != null && isFinite(Number(m.ip))) x.price = r2(Number(m.ip) - (Number(S.initAdj) || 0));
            if (m.ipAdj != null && isFinite(Number(m.ipAdj))) x.ipAdj = Number(m.ipAdj);
          });
        } catch (eFL) {}
        S.pageVariantTotal = out.length;
        S.pagePriceCur = (out[0] && out[0].cur) || null;
        if (pf.weightG) { S.weightG = pf.weightG; S.weightSrc = '页面'; }
        else if (!S.weightG) { S.weightSrc = '页面未读到'; }
        S.varsSel = {}; S.variants.forEach(function (v) { S.varsSel[v.asin] = true; });
        /* ★ 变体列 BG：一次查库（最多 60 个 ASIN），用于表格「BG」列 */
        S.varBg = {};
        try {
          var bgAsins = out.slice(0, 60).map(function (v) { return v.asin; });
          if (bgAsins.length) {
            erp('GET', '/api/bg/lookup?site=' + encodeURIComponent(String(S.site).toLowerCase()) + '&asins=' + bgAsins.join(',')).then(function (j) {
              if (j && j.ok && j.items) { S.varBg = j.items; render(); }
            }).catch(function () { });
          }
        } catch (e) {}
        S.dims = {}; S.colors = {};
        setTimeout(refreshPageFacts, 2500);
      });
    }).then(function () {
      S.busy = false;
      return loadFreight();
    }).catch(function (e) {
      S.busy = false;
      ft.textContent = '加载失败: ' + String((e && e.message) || e);
      render();
    });
  }

  function loadFreight() {
    var cc = CC[S.site] || S.site;
    if (!(S.weightG > 0)) { S.freight = null; S.freightCh = ''; S.freightErr = '页面未读到重量'; render(); return Promise.resolve(); }
    return erp('GET', '/api/zy/freight/quote?country=' + encodeURIComponent(cc) + '&weight=' + Math.max(1, Math.round(S.weightG)) + '&channel=' + encodeURIComponent('云途普货')).then(function (j) {
      S.dbg = Object.assign(S.dbg || {}, { freight: JSON.stringify(j).slice(0, 300) });
      if (j && j.picked) { S.freight = Number(j.picked.price); S.freightCh = j.picked.channel; S.freightErr = ''; }
      else if (j && j.cheapest) { S.freight = Number(j.cheapest.price); S.freightCh = j.cheapest.channel; S.freightErr = ''; }
      else { S.freightErr = (j && j.error) || '运价不可用'; }
      render();
    });
  }

  /* ---------- BG 多店检测（用授权店铺账号查该 ASIN 能否销售） ---------- */
  function loadBg() {
    send('ZY_ACCOUNTS', {}, function (acc) {
      S.accounts = (acc && acc.accounts) || [];
      /* 不带 sites：查全部授权店铺（含其他站点），这样 BG 能看到所有站点结果 */
      send('ZY_BG_MULTI', { asin: S.asin }, function (r) {
        S.bg = (r && r.results) || [];
        S.bgStat = (r && r.stat) || {};
        S.bgErr = (r && r.ok === false) ? (r.error || '查询失败') : '';
      /* ★ 2026-11-24 多站点附加数据：配送/排名/价格 + 上架状态 */
      try {
        (function () {
          var S6 = ['uk', 'de', 'fr', 'it', 'es', 'au'];
          erp('GET', '/api/zy/asin-sites?asin=' + encodeURIComponent(S.asin) + '&sites=' + S6.join(',')).then(function (j3) {
            if (j3 && j3.ok) { S.bgSiteStats = j3.items || {}; render(); }
          }).catch(function () {});
          erp('GET', '/api/ifast/asin-status?asin=' + encodeURIComponent(S.asin)).then(function (j4) {
            if (j4 && j4.ok) { S.ifastAsin = j4.items || {}; S.ifastAsinLive = !!j4.live; S.ifastAsinErr = j4.liveError || ''; render(); }
          }).catch(function () {});
        })();
      } catch (eBGE) {}
      /* ★ 2026-11-23 多站点 BG：走 ERP by-asin（按站点返回 status/at/name） */
      erp('POST', '/api/bg/by-asin', { asin: S.asin }).then(function (j2) {
        if (j2 && j2.ok) { S.bgSites = j2.items || {}; render(); }
      }).catch(function () {});
        render();
      });
    });
  }

  /* ---------- 渲染 ---------- */
  function bgTag(st, abbr) {
    var m = BG[st] || { t: st || '-', c: '#8c8c8c', bg: '#1f1f26', b: '#444' };
    return '<span class="bg" style="color:' + m.c + ';background:' + m.bg + ';border-color:' + m.b + '" title="店铺 ' + esc(abbr || '') + '">' + esc(m.t) + '</span>';
  }

  /* 页面采集: 重量 / 尺寸 / 价格（不经过智赢数据库） */
  /* 在【当前页面所属浏览器】里改邮编/货币：面板显示的是这个浏览器，必须就地改 */
  function localeFixLocal(zip, cur) {
    var host = location.hostname;
    var dom = '.' + host.replace(/^www\./, '');
    return fetch(location.origin + '/portal-migration/hz/glow/address-change', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: 'locationType=LOCATION_INPUT&zipCode=' + encodeURIComponent(zip) + '&deviceType=web&storeContext=generic&pageType=Gateway&actionSource=glow',
      credentials: 'include',
    }).then(function (r) { return r.json(); }).catch(function () { return {}; }).then(function (j) {
      try { document.cookie = 'i18n-prefs=' + cur + '; path=/; domain=' + dom + '; secure'; } catch (e) {}
      try { document.cookie = 'i18n-prefs=' + cur + '; path=/; secure'; } catch (e) {}
      return { ok: !!(j && (j.isAddressUpdated === 1 || j.isAddressUpdated === true)), country: j && j.address && j.address.countryCode, zip: j && j.address && j.address.zipCode, city: j && j.address && j.address.city };
    });
  }

  /* 各站点默认邮编（与 ERP 的 SITE_ZIP 一致） */
  var SITE_ZIP = { de: '10115', uk: 'SW1A1AA', fr: '75001', it: '00100', es: '28001', au: '2000', us: '10001', ca: 'M5V2T6', jp: '100-0001' };
  var SITE_CUR = { de: 'EUR', uk: 'GBP', fr: 'EUR', it: 'EUR', es: 'EUR', au: 'AUD', us: 'USD', ca: 'CAD', jp: 'JPY' };
  var CUR_SITE = { de: 'EUR', uk: 'GBP', fr: 'EUR', it: 'EUR', es: 'EUR', au: 'AUD', us: 'USD', ca: 'CAD', jp: 'JPY' };
  function parseMoney(str) {
    var t = String(str == null ? '' : str).trim();
    if (!t) return null;
    if (/,\d{2}$/.test(t)) return parseFloat(t.replace(/\./g, '').replace(',', '.'));
    if (/\.\d{1,2}$/.test(t)) return parseFloat(t.replace(/,/g, ''));
    if (/,\d{1,2}$/.test(t)) return parseFloat(t.replace(/,/g, '.'));
    var v = parseFloat(t.replace(/[^\d.]/g, ''));
    return isFinite(v) ? v : null;
  }
  function toGrams(num, unit) {
    var u = String(unit || '').toLowerCase();
    var v = Number(num);
    if (!isFinite(v)) return null;
    if (/^k/.test(u) || u === 'kg') return Math.round(v * 1000);   // kg / kilogram(s) / kilogramm
    if (/^g/.test(u) || u === 'g' || u === 'gr' || /gram/.test(u)) return Math.round(v);   // g / gram(s) / gramm
    if (/lb|pfund|pound/.test(u)) return Math.round(v * 453.592);
    if (/oz|unze|ounce/.test(u)) return Math.round(v * 28.3495);
    return null;
  }
  function pageFacts() {
    var out = { weightG: null, weightText: '', dimsText: '', mainPrice: null, mainCur: null, prices: {} };
    try {
      var rows = [];
      document.querySelectorAll('#productDetails_techSpec_section_1 tr, #productDetails_detailBullets_sections1 tr, #productDetails_expanderSectionTables tr, #productDetails tr, #productDetails_db_sections tr, #prodDetails tr, #productDetails_feature_div li, #detailBullets_feature_div li, #technicalSpecifications_section_1 tr').forEach(function (el) {
        var t = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (t && rows.indexOf(t) < 0) rows.push(t);
      });
      for (var i = 0; i < rows.length && i < 120; i++) {
        var t = rows[i];
        if (!out.weightG) {
          var mw = t.match(/(?:gewicht|weight|artikelgewicht|item weight)[^0-9]{0,20}([\d.,]+)\s*(kg|kgs|kilogram(?:s|m)?|g|gr|gram(?:s|m)?|lb|lbs|pound(?:s)?|oz|ounce(?:s)?|pfund|unzen?)/i);
          if (mw) {
            var g = toGrams(String(mw[1]).replace(/\./g, '').replace(',', '.'), mw[2]);
            if (g && g > 0) { out.weightG = g; out.weightText = t.slice(0, 60); }
          }
        }
        if (!out.dimsText) {
          var md = t.match(/(?:abmessungen|dimensions|produktabmessungen|größe|size)[^0-9]{0,20}([\d.,]+\s*[x×]\s*[\d.,]+(?:\s*[x×]\s*[\d.,]+)?)\s*(cm|mm|m|inch|in|zoll)?/i);
          if (md) out.dimsText = (md[1] + ' ' + (md[2] || '')).trim();
        }
      }
      var pe = document.querySelector('#corePriceDisplay_desktop_feature_div .a-price .a-offscreen, #corePrice_feature_div .a-price .a-offscreen, #corePrice_feature_div .a-offscreen, #priceblock_ourprice, #price_inside_buybox');
      if (pe) {
        var pt = (pe.textContent || '').trim();
        var mm = pt.match(/(HKD|EUR|GBP|USD|AUD|CAD|JPY|€|£|$)/);
        var mn = pt.match(/([\d][\d.,]*)/);
        if (mn) {
          out.mainPrice = parseMoney(mn[1]);
          out.mainCur = mm ? ({ '€': 'EUR', '£': 'GBP', '$': 'USD' }[mm[1]] || mm[1]) : null;
        }
      }
      document.querySelectorAll('#inline-twister-expander-content-size_name li[data-asin], #inline-twister-expander-content-color_name li[data-asin], li.inline-twister-swatch[data-asin]').forEach(function (li) {
        var asin = String(li.getAttribute('data-asin') || '').toUpperCase();
        if (!asin) return;
        var t = (li.textContent || '').replace(/\s+/g, ' ').trim();
        var pm = t.match(/(HKD|EUR|GBP|USD|AUD|CAD|JPY|€|£|$)\s*([\d][\d.,]*)/);
        if (!pm) return;
        var cur = ({ '€': 'EUR', '£': 'GBP', '$': 'USD' }[pm[1]] || pm[1]);
        var val = parseMoney(pm[2]);
        if (isFinite(val)) out.prices[asin] = { v: val, cur: cur };
      });
    } catch (e) {}
    return out;
  }

  /* 页面事实可能晚于脚本 JSON 渲染出来 → 延迟补几次 */
  function refreshPageFacts() {
    var pf = pageFacts();
    var siteCur = CUR_SITE[String(S.site).toLowerCase()] || 'EUR';
    var changed = false;
    Object.keys(pf.prices || {}).forEach(function (a) {
      var p = pf.prices[a];
      if (!p) return;
      (S.variants || []).forEach(function (v) {
        if (v.asin === a && v.price == null) { v.price = p.v; changed = true; }
      });
    });
    if (pf.weightG && pf.weightG !== S.weightG) { S.weightG = pf.weightG; S.weightSrc = '页面'; changed = true; loadFreight(); }
    var pcur = {};
    Object.keys(pf.prices || {}).forEach(function (k) { pcur[pf.prices[k].cur] = 1; });
    S.pageCurs = Object.keys(pcur);
    S.pageCurMismatch = S.pageCurs.length > 0 && S.pageCurs.indexOf(siteCur) < 0;
    if (changed || S.pageCurMismatch) render();
  }

  /* 从商品页 DOM 抓全部变体 (Amazon 新的 inline-twister) */
  function pageVariants() {
    try {
      var holder = '';
      var scripts = document.querySelectorAll('script');
      for (var i = 0; i < scripts.length; i++) {
        var t = scripts[i].textContent || '';
        if (t.indexOf('dimensionValuesDisplayData') >= 0) { holder = t; break; }
      }
      if (!holder) return [];
      var mi = holder.indexOf('"dimensionValuesDisplayData"');
      var startB = holder.indexOf('{', mi);
      var depth = 0, endB = -1;
      for (var k = startB; k < holder.length; k++) {
        var c = holder.charAt(k);
        if (c === '{') depth++;
        else if (c === '}') { depth--; if (depth === 0) { endB = k; break; } }
      }
      if (endB < 0) return [];
      var map = JSON.parse(holder.slice(startB, endB + 1));
      var prices = {};
      document.querySelectorAll('li[data-asin]').forEach(function (li) {
        var a = String(li.getAttribute('data-asin') || '').toUpperCase();
        if (!a) return;
        var pe = li.querySelector('.twister_swatch_price, .olp-message, .a-color-price');
        if (!pe) return;
        var m2 = (pe.textContent || '').replace(/\s/g, '').match(/([\d.,]+)/);
        if (m2) { var v2 = parseFloat(m2[1].replace(/\./g, '').replace(',', '.')); if (isFinite(v2)) prices[a] = v2; }
      });
      return Object.keys(map).map(function (asin) {
        return { asin: String(asin).toUpperCase(), attrs: map[asin] || [], price: prices[String(asin).toUpperCase()] };
      });
    } catch (e) { return []; }
  }

  function specChips(v) {
    var dims = S.dims[v.asin] || [];
    if (!Array.isArray(dims) || !dims.length) {
      if (Array.isArray(v.attrs) && v.attrs.length) {
        return v.attrs.map(function (x) { return x ? ('<span class="spec">' + esc(String(x)) + '</span>') : ''; }).join('');
      }
      return '';
    }
    return dims.map(function (d) {
      var val = String(d.value == null ? '' : d.value);
      if (!val) return '';
      var isColor = /color|colour/i.test(d.key || '') || /颜色/.test(d.label || '');
      if (isColor && /^[A-Za-z0-9]{1,2}$/.test(val)) {
        var c = S.colors[v.asin];
        if (c && c.color) return '<span class="spec">颜色 ' + esc(c.color) + '（' + esc(val) + '）</span>';
      }
      return '<span class="spec">' + esc((d.label || d.key) + ' ' + val) + '</span>';
    }).join('');
  }

  /* ================= 设置视图（沿用演示版结构：利润率已删） ================= */
  function openSettings() {
    S.view = 'settings';
    S.setD = {
      site: SET.site || S.site,
      sellingId: SET.shopId || '',
      stock: SET.stock == null ? 100 : SET.stock,
      leadDays: SET.leadDays == null ? 5 : SET.leadDays,
      autoUpload: !!SET.autoUpload,
      channel: '云途普货',
      useLiveFx: SET.useLiveFx !== false,
      colors: Object.assign({ fba: '#cf1322', fbm: '#237804', amz: '#1677ff' }, SET.colors || {}),
    };
    S.setChs = null; S.setRates = null;
    render();
    erp('GET', '/api/zy/freight/channels').then(function (j) {
      S.setChs = (j && j.ok && j.channels) ? j.channels : [];
    }).catch(function () { S.setChs = []; }).then(function () { if (S.view === 'settings') render(); });
    erp('GET', '/api/rates').then(function (j) { S.setRates = j || {}; }).catch(function () { S.setRates = {}; }).then(function () { if (S.view === 'settings') render(); });
  }

  function sRow(label, ctl, sub) {
    return '<div class="row" style="align-items:flex-start;margin-bottom:9px">'
      + '<div style="flex:0 0 106px;color:#9a9aa4;font-size:12px;padding-top:3px">' + label + '</div>'
      + '<div style="flex:1;min-width:0">' + ctl + (sub ? '<div class="note" style="margin-top:3px">' + sub + '</div>' : '') + '</div></div>';
  }
  function sSec(title, tag, kids) {
    return '<div class="sec"><h4>' + title + (tag ? '<span class="note">' + tag + '</span>' : '') + '</h4>' + kids + '</div>';
  }
  function settingsHtml() {
    var D2 = S.setD || {};
    var shops = (S.ifast.shops || []);
    var shopOpts = shops.map(function (sh) {
      return '<option value="' + esc(sh.id) + '"' + (sh.id === D2.sellingId ? ' selected' : '') + '>' + esc(sh.name) + '</option>';
    }).join('');
    var chs = S.setChs;
    var chOpts = '<option value="">自动（取最便宜渠道）</option>' + (chs || []).map(function (c) {
      var nm = c.name || c;
      return '<option value="' + esc(nm) + '"' + (nm === D2.channel ? ' selected' : '') + '>' + esc(nm) + '</option>';
    }).join('');
    var R = (S.setRates && S.setRates.rates) || {};
    var fxTxt = S.setRates ? ('基准 ' + (S.setRates.base || '-') + ' · ' + (S.setRates.date || '-') + ' · USD ' + (R.USD != null ? R.USD : '-') + ' · GBP ' + (R.GBP != null ? R.GBP : '-') + ' · AUD ' + (R.AUD != null ? R.AUD : '-') + ' · EUR ' + (R.EUR != null ? R.EUR : '-'))
      : '读取中…';
    var siteOpts = ['DE', 'UK', 'FR', 'IT', 'ES', 'AU', 'US'].map(function (st) {
      return '<option value="' + st + '"' + (st === D2.site ? ' selected' : '') + '>' + st + '</option>';
    }).join('');

    var h = '<div class="sec" style="padding:8px 10px"><h4><span>⚙ 面板设置</span><span class="note">改完点「保存并返回」生效（不需要刷新页面）</span></h4></div>';

    h += sSec('💰 算价', '照定价表：承受价格 = (采购成本 + 物流成本) × (1 + 利润率) ÷ 到手比例K ÷ 汇率（德国默认 -3）',
      sRow('汇率来源', '<label class="row" style="gap:6px;cursor:pointer"><input type="checkbox" data-set="useLiveFx"' + (D2.useLiveFx ? ' checked' : '') + '><span class="note">英/德/澳 也用 ERP 实时汇率</span></label>',
        '不勾 = 用定价表里的固定汇率；勾上 = 走实时汇率')
      + sRow('ERP 实时汇率', '<span id="set-fx" class="note">' + esc(fxTxt) + '</span><button class="btn" data-set="fx-refresh" style="margin-left:6px">⟳ 拉取</button>'));

    /* ★ 2026-11-21 各国税率设置（下拉选国家 → 改税率 → 可锁定） */
    (function () {
      var TAX_SITES = [['UK', '英国'], ['AU', '澳大利亚'], ['DE', '德国'], ['ES', '西班牙'], ['IT', '意大利'], ['FR', '法国']];
      var curTaxSite = String(SET.taxSite || S.site || 'UK').toUpperCase();
      var taxOpts = TAX_SITES.map(function (x) { return '<option value="' + x[0] + '"' + (x[0] === curTaxSite ? ' selected' : '') + '>' + x[1] + '（' + x[0] + '）</option>'; }).join('');
      var taxRate = (SET.taxBySite && SET.taxBySite[curTaxSite] != null) ? SET.taxBySite[curTaxSite] : 0;
      h += sSec('🧾 税率', '锁定后：各国家按这里的税率计算承受价；不锁定：可用表格「税率%」列逐行临时改',
        sRow('国家/站点', '<select class="inp" data-tax-site style="padding:2px 8px;min-width:150px">' + taxOpts + '</select>', '选择要修改税率的国家')
        + sRow('税率（%）', '<input class="inp num" data-tax-rate value="' + esc(taxRate) + '" style="width:64px"><label class="row" style="gap:6px;cursor:pointer;margin-left:8px"><input type="checkbox" data-tax-lock' + (SET.taxLock ? ' checked' : '') + '><span class="note">锁定税率</span></label>', '定价表口径：英国 0.68 · 德国 0.68 · 澳大利亚 0.85（西/意/法默认 0.68）；填 0.68=到手比例，填 20=旧百分比兼容'));
    })();

    h += sSec('🚚 物流成本', '运费实时来自智赢数据源（不存静态表）',
      sRow('实时运价', '<span class="note">' + (S.setChs == null ? '读取中…' : ('● ' + (S.setChs.length || 0) + ' 个渠道（每次现取）')) + '</span><button class="btn" data-set="ch-refresh" style="margin-left:6px">⟳ 刷新渠道</button>')
      + sRow('默认物流渠道', '<b style="color:#5fd08a">云途普货</b><span class="note">（固定渠道，不可更改）</span>'
        + '<div class="note" data-set="chStatus" style="margin-top:4px"></div>',
        '所有运费都按云途普货计算'));

    h += sSec('📤 上架默认值', '设置一次，之后所有商品上架都按这里',
      sRow('默认跟卖方案', '<select class="inp" data-set="sellingId" style="padding:2px 8px;min-width:190px">' + (shopOpts || '<option value="">无方案</option>') + '</select>', 'ifast 的销售分组（如 午夜 / 全天跟卖）')
      + sRow('默认库存 / 备货周期', '<span class="note">库存</span><input class="inp num" data-set="stock" value="' + esc(D2.stock) + '"><span class="note">备货(天)</span><input class="inp num" data-set="leadDays" value="' + esc(D2.leadDays) + '">')
      + sRow('默认上架站点', '<select class="inp" data-set="site" style="padding:2px 6px">' + siteOpts + '</select>', '上架时按该站点提交（商品页可临时切换）')
      + sRow('提交亚马逊', '<label class="row" style="gap:6px;cursor:pointer"><input type="checkbox" data-set="autoUpload"' + (D2.autoUpload ? ' checked' : '') + '><span class="note">上架后立即 item_upload 提交亚马逊</span></label>'));

    var locD = (SET.localeBySite || {})[String(D2.site || S.site).toUpperCase()] || {};
    var locZip = locD.zip || SITE_ZIP[String(D2.site || S.site).toLowerCase()] || '';
    var locCur = locD.currency || SITE_CUR[String(D2.site || S.site).toLowerCase()] || 'EUR';
    var curOpts = ['EUR', 'GBP', 'USD', 'AUD', 'CAD', 'JPY'].map(function (c2) {
      return '<option value="' + c2 + '"' + (c2 === locCur ? ' selected' : '') + '>' + c2 + '</option>';
    }).join('');
    h += sSec('🌐 站点与货币', '采集/切站时自动把浏览器切到该站点的邮编与货币',
      sRow('当前站点', '<b>' + esc(D2.site || S.site) + '</b><span class="note">（在上方「默认上架站点」里改）</span>')
      + sRow('邮编', '<input class="inp" data-set="locZip" value="' + esc(locZip) + '" style="width:110px">'
        + '<span class="note">默认 ' + esc(SITE_ZIP[String(D2.site || S.site).toLowerCase()] || '-') + '</span>')
      + sRow('货币', '<select class="inp" data-set="locCur" style="padding:2px 8px">' + curOpts + '</select>')
      + sRow('立即切换', '<button class="btn" data-set="locApply">⟳ 切到本店站点（邮编+货币）</button><span class="note">点一下立即生效</span>'));

    h += sSec('🎨 搞薯条面板配色', '商品列表页卡片下方那行信息的底色',
      sRow('FBA 商品', '<input type="color" data-set="c-fba" value="' + esc(D2.colors.fba) + '" style="width:48px;height:26px;padding:0;border:1px solid #3a3a44;border-radius:5px;background:none">')
      + sRow('FBM 商品', '<input type="color" data-set="c-fbm" value="' + esc(D2.colors.fbm) + '" style="width:48px;height:26px;padding:0;border:1px solid #3a3a44;border-radius:5px;background:none">')
      + sRow('AMZ 自营', '<input type="color" data-set="c-amz" value="' + esc(D2.colors.amz) + '" style="width:48px;height:26px;padding:0;border:1px solid #3a3a44;border-radius:5px;background:none">'));

    /* 👤 智赢账号管理 */
    var tokLis = (S.tokens && S.tokens.accounts) || [];
    var tokHtml = tokLis.length ? tokLis.map(function (a) {
      var act = a.active || a.id === (S.tokens && S.tokens.activeId);
      return '<div class="row" style="margin:4px 0">'
        + '<span class="bg" style="color:' + (act ? '#237804' : '#8c8c8c') + ';background:' + (act ? '#f6ffed' : '#1f1f26') + ';border-color:' + (act ? '#b7eb8f' : '#3a3a44') + '">' + (act ? '● 使用中' : '○') + '</span>'
        + '<b>' + esc(a.label || a.id) + '</b><span class="note">' + esc(a.tokenHint || '') + '</span>'
        + (a.source ? '<span class="note">（' + esc(a.source) + '）</span>' : '')
        + '<span style="margin-left:auto"></span>'
        + '<button class="btn" data-acct-switch="' + esc(a.id) + '"' + (act ? ' disabled' : '') + '>切换</button>'
        + '<button class="btn" data-acct-del="' + esc(a.id) + '">删除</button></div>';
    }).join('') : '<div class="note">还没有保存的智赢账号</div>';

    h += sSec('👤 智赢账号管理', '可保存多个账号，一键切换（采集/上架/BG 都用当前账号）',
      tokHtml
      + sRow('登录新账号', '<input class="inp" data-set="acctLabel" placeholder="备注名" style="width:80px">'
        + '<input class="inp" data-set="acctName" placeholder="智赢账号/手机号" style="width:130px">'
        + '<input class="inp" data-set="acctPwd" type="password" placeholder="密码" style="width:110px">'
        + '<button class="btn pri" data-set="acctLogin">登录并保存</button>'));

    h += sSec('🔗 ifast 直连', '上架系统的登录态与站点',
      sRow('连接状态', '<span class="note">' + (S.ifast.ok ? ('● 已连接 · ' + (S.ifast.shops || []).length + ' 个跟卖方案') : '● 未连接') + '</span>'
        + '<button class="btn" data-set="sync-cookie" style="margin-left:6px">从浏览器同步登录态</button>'
        + '<button class="btn" data-set="open-ifast" style="margin-left:6px" title="在采集浏览器(9222)里打开 ifast 登录页">在采集浏览器打开登录页</button>'
        + '<button class="btn" data-set="ifast-refresh" style="margin-left:6px">⟳ 刷新</button>', '登录态存本机；过期后：登录 ifast → 从浏览器同步')
      + sRow('站点', '<span class="note">' + esc((S.ifast.sites || []).map(function (x) { return x.country + '=' + x.id; }).join(' · ') || '-') + '</span>')
      + sRow('账号密码登录',
          '<input class="inp" data-if-u placeholder="ifast 账号" style="width:130px">'
          + '<input class="inp" data-if-p type="password" placeholder="ifast 密码" style="width:120px" autocomplete="off">'
          + '<button class="btn pri" data-if-login>登录 ifast</button>'
          + '<label class="note" style="display:inline-flex;gap:4px;align-items:center;cursor:pointer;margin-left:4px"><input type="checkbox" data-if-save checked>保存账号</label>',
          '填账号密码登录；勾「保存账号」= 本地加密保存，之后可一键切换'
      )
      + sRow('已存账号',
          '<select class="inp" data-if-list style="padding:2px 8px;min-width:190px"><option value="">（读取中…）</option></select>'
          + '<button class="btn pri" data-if-switch style="margin-left:6px">切换登录</button>'
          + '<button class="btn" data-if-del style="margin-left:6px">删除</button>',
          '选择已保存账号 → 切换登录（密码本地 AES 加密保存）'
      ));

    h += '<div class="row" style="padding:2px 2px 8px"><button class="btn pri" data-set="save">✔ 保存并返回</button><button class="btn" data-set="back">← 返回</button></div>';
    return h;
  }

  function bindSettings() {
    /* 固定渠道：打开设置就查一次云途普货当前站点运价 */
    (function () {
      var st0 = bd.querySelector('[data-set=chStatus]');
      if (!st0) return;
      var cc0 = (CC[String(S.site).toUpperCase()] || String(S.site)).toUpperCase();
      st0.style.color = '#e0b25c'; st0.textContent = '正在获取「云途普货」的运价…';
      erp('GET', '/api/zy/freight/quote?country=' + encodeURIComponent(cc0) + '&weight=200&refresh=0&channel=' + encodeURIComponent('云途普货')).then(function (j) {
        var el0 = bd.querySelector('[data-set=chStatus]'); if (!el0) return;
        if (j && j.ok && j.picked) { el0.style.color = '#5fd08a'; el0.textContent = '✔ 云途普货 ¥' + j.picked.price + ' / 200g · ' + cc0; }
        else if (j && j.ok && j.channelMissing) { el0.style.color = '#e06c72'; el0.textContent = '✖ 该站点无云途普货'; }
        else { el0.style.color = '#e06c72'; el0.textContent = '✖ 获取失败：' + ((j && j.error) || ''); }
      }).catch(function (e2) { var el4 = bd.querySelector('[data-set=chStatus]'); if (el4) { el4.style.color = '#e06c72'; el4.textContent = '✖ 获取失败：' + e2.message; } });
    })();
    /* ★ 2026-11-21 税率控件：改完立即存（不依赖「保存并返回」） */
    (function () {
      var sel = bd.querySelector('[data-tax-site]');
      var inp = bd.querySelector('[data-tax-rate]');
      var lk = bd.querySelector('[data-tax-lock]');
      function curSite() { return String((sel && sel.value) || SET.taxSite || S.site || 'UK').toUpperCase(); }
      function curRate() { var m = SET.taxBySite || {}; var v = m[curSite()]; return v == null ? 0 : (Number(v) || 0); }
      function sync() { if (inp) inp.value = curRate(); if (lk) lk.checked = !!SET.taxLock; }
      if (sel) sel.addEventListener('change', function () { SET.taxSite = sel.value; sync(); saveSettings(); });
      if (inp) inp.addEventListener('change', function () { var x = Number(inp.value); if (!isFinite(x) || x < 0 || x >= 100) x = 0; if (!SET.taxBySite) SET.taxBySite = {}; SET.taxBySite[curSite()] = x; saveSettings(); inp.value = x; });
      if (lk) lk.addEventListener('change', function () { SET.taxLock = !!lk.checked; saveSettings(); });
      sync();
    })();
    var D2 = S.setD || {};
    bd.querySelectorAll('[data-set]').forEach(function (el2) {
      var k = el2.getAttribute('data-set');
      if (k === 'save') {
        el2.addEventListener('click', function () {
          SET.site = D2.site; SET.shopId = D2.sellingId;
          SET.stock = Number(D2.stock) || 0; SET.leadDays = Number(D2.leadDays) || 0;
          SET.autoUpload = !!D2.autoUpload; SET.channel = '云途普货'; SET.useLiveFx = !!D2.useLiveFx;
          SET.colors = D2.colors;
          var siteUp2 = String(D2.site || S.site).toUpperCase();
          var zEl = bd.querySelector('[data-set=locZip]'), cEl = bd.querySelector('[data-set=locCur]');
          if (zEl || cEl) {
            if (SET.localeBySite == null) SET.localeBySite = {};
            SET.localeBySite[siteUp2] = {
              zip: (zEl && zEl.value) || SITE_ZIP[siteUp2.toLowerCase()] || '',
              currency: (cEl && cEl.value) || SITE_CUR[siteUp2.toLowerCase()] || 'EUR',
            };
          }
          saveSettings();
          S.shopId = SET.shopId; S.autoUpload = SET.autoUpload;
          S.view = 'main';
          footSet(true, S.ifast, '设置已保存 · ' + (D2.sellingId || '-'));
          render();
        });
      } else if (k === 'back') {
        el2.addEventListener('click', function () { S.view = 'main'; render(); });
      } else if (k === 'locZip') {
        el2.addEventListener('input', function () { D2.locZip = el2.value; });
      } else if (k === 'locCur') {
        el2.addEventListener('change', function () { D2.locCur = el2.value; });
      } else if (k === 'locApply') {
        el2.addEventListener('click', function () {
          var siteUp = String(D2.site || S.site).toUpperCase();
          var siteLow = siteUp.toLowerCase();
          var zip = D2.locZip || (el2.ownerDocument && bd.querySelector('[data-set=locZip]') ? bd.querySelector('[data-set=locZip]').value : '') || SITE_ZIP[siteLow] || '';
          var cur = D2.locCur || (bd.querySelector('[data-set=locCur]') || {}).value || SITE_CUR[siteLow] || 'EUR';
          ft.textContent = '正在切换站点：' + siteUp + ' / ' + zip + ' / ' + cur + ' …';
          localeFixLocal(zip, cur).then(function () {
            return erp('POST', '/api/zy/locale/fix', { site: siteLow, zip: zip, currency: cur });
          }).then(function (r) {
            if (SET.localeBySite == null) SET.localeBySite = {};
            SET.localeBySite[siteUp] = { zip: zip, currency: cur };
            saveSettings();
            ft.textContent = r && r.ok
              ? ('已切换：' + siteUp + ' · 邮编 ' + (r.addrAfter || zip) + ' · 货币 ' + (r.curAfter || cur))
              : ('切换失败: ' + ((r && r.error) || ''));
          }).catch(function (e) { ft.textContent = '切换失败: ' + e.message; });
        });
      } else if (k === 'fx-refresh') {
        el2.addEventListener('click', function () {
          erp('GET', '/api/rates').then(function (j) {
            S.setRates = j || {};
            try {
              var _cur2 = SITE_CUR[String(S.site).toLowerCase()];
              var _r2 = (S.setRates && S.setRates.rates) || {};
              if (SET.useLiveFx !== false && _cur2 && _r2[_cur2] > 0) { S.fx = r2(_r2[_cur2]); ft.textContent = '已同步实时汇率 ' + _cur2 + ' ' + S.fx; }
            } catch (e) {}
            render();
          }).catch(function () { ft.textContent = '汇率拉取失败'; });
        });
      } else if (k === 'ch-refresh') {
        el2.addEventListener('click', function () {
          ft.textContent = '正在向智赢取实时渠道…';
          var t0c = Date.now();
          erp('GET', '/api/zy/freight/channels?refresh=1').then(function (j) {
            S.setChs = (j && j.ok && j.channels) || [];
            var wait = Math.max(0, 500 - (Date.now() - t0c));
            setTimeout(function () { ft.textContent = '渠道已更新 · ' + (S.setChs.length || 0) + ' 个'; render(); }, wait);
          }).catch(function (e) { ft.textContent = '渠道拉取失败: ' + e.message; });
        });
      } else if (k === 'acctLogin') {
        el2.addEventListener('click', function () {
          var lb = (bd.querySelector('[data-set=acctLabel]') || {}).value || '';
          var nm = (bd.querySelector('[data-set=acctName]') || {}).value || '';
          var pw = (bd.querySelector('[data-set=acctPwd]') || {}).value || '';
          loginZyAccount(nm, pw, lb, function (ok) { if (ok) loadAll(true); });
        });
      } else if (k === 'acctAdd') {
        el2.addEventListener('click', function () {
          var lb = (bd.querySelector('[data-set=acctLabel]') || {}).value || '';
          var tk = (bd.querySelector('[data-set=acctToken]') || {}).value || '';
          ft.textContent = '正在添加账号…';
          erp('POST', '/api/zy/tokens', { label: lb, token: tk }).then(function (j) {
            if (j && j.ok) { ft.textContent = '已添加账号: ' + lb; loadAll(true); }
            else ft.textContent = '添加失败: ' + ((j && j.error) || '');
          }).catch(function (e) { ft.textContent = '添加失败: ' + e.message; });
        });
      } else if (k === 'acctAuto') {
        el2.addEventListener('click', function () {
          ft.textContent = '正在从浏览器智赢插件获取 token…';
          erp('POST', '/api/zy/tokens', { label: '浏览器插件' }).then(function (j) {
            if (j && j.ok) { ft.textContent = '已获取并添加: ' + ((j.account && j.account.label) || ''); loadAll(true); }
            else ft.textContent = '获取失败: ' + ((j && j.error) || '');
          }).catch(function (e) { ft.textContent = '获取失败: ' + e.message; });
        });
      } else if (k === 'open-ifast') {
        el2.addEventListener('click', function () {
          ft.textContent = '正在采集浏览器(9222)里打开 ifast 登录页…';
          erp('POST', '/api/ifast/open-login', {}).then(function (j) {
            ft.textContent = j && j.ok ? '已在采集浏览器打开 ifast —— 登录后点「从浏览器同步登录态」'
              : ('打开失败: ' + ((j && j.error) || ''));
          }).catch(function (e) { ft.textContent = '打开失败: ' + e.message; });
        });
      } else if (k === 'sync-cookie') {
        el2.addEventListener('click', function () {
          ft.textContent = '正在从采集浏览器抓 ifast 登录态…';
          erp('POST', '/api/ifast/cookie', { browser: true }).then(function (j) {
            ft.textContent = j && j.ok ? '登录态已同步' : ('同步失败: ' + ((j && j.error) || ''));
            loadAll(false);
          }).catch(function (e) { ft.textContent = '同步失败: ' + e.message; });
        });
      } else if (k === 'ifast-refresh') {
        el2.addEventListener('click', function () { loadAll(false); });
      } else {
        el2.addEventListener('change', function () {
          if (k === 'useLiveFx') D2.useLiveFx = el2.checked;
          else if (k === 'autoUpload') D2.autoUpload = el2.checked;
          else if (k === 'sellingId') D2.sellingId = el2.value;
          else if (k === 'site') D2.site = el2.value;
          else if (k === '__channel_disabled') {
            D2.channel = el2.value;
            var stEl = bd.querySelector('[data-set=chStatus]');
            var ccNow = (CC[String(D2.site || S.site).toUpperCase()] || String(D2.site || S.site)).toUpperCase();
            var t0q = Date.now();
            if (stEl) { stEl.style.color = '#e0b25c'; stEl.textContent = '正在获取「' + (D2.channel || '自动（最便宜）') + '」的运价…'; }
            var applyStatus = function (txt, color) {
              var wait = Math.max(0, 500 - (Date.now() - t0q));
              setTimeout(function () {
                var el3 = bd.querySelector('[data-set=chStatus]');
                if (el3) { el3.style.color = color; el3.textContent = txt; }
              }, wait);
            };
            erp('GET', '/api/zy/freight/quote?country=' + encodeURIComponent(ccNow) + '&weight=200&refresh=0&channel=' + encodeURIComponent(D2.channel || '')).then(function (j) {
              if (!stEl) return;
              if (j && j.ok) {
                if (j.channelMissing) applyStatus('✖ 该站点没有此渠道（' + ccNow + '），保存后运费会自动用最便宜渠道', '#e06c72');
                else if (j.picked) applyStatus('✔ 获取成功：' + (j.picked.channel || '') + ' ¥' + j.picked.price + ' / 200g · ' + ccNow + '（最便宜 ' + ((j.cheapest && j.cheapest.channel) || '-') + ' ¥' + ((j.cheapest && j.cheapest.price) || '-') + '）', '#5fd08a');
                else applyStatus('✖ 没拿到运价', '#e06c72');
              } else {
                applyStatus('✖ 获取失败：' + ((j && j.error) || '未知错误'), '#e06c72');
              }
            }).catch(function (e) {
              applyStatus('✖ 获取失败：' + e.message, '#e06c72');
            });
          }
          else if (k === 'stock') D2.stock = Number(el2.value) || 0;
          else if (k === 'leadDays') D2.leadDays = Number(el2.value) || 0;
          else if (k === 'c-fba' || k === 'c-fbm' || k === 'c-amz') D2.colors[k.slice(2)] = el2.value;
        });
      }
    });

    /* ★ 2026-11-21 ifast 账号密码登录 + 已存账号切换 */
    (function () {
      var uEl = bd.querySelector('[data-if-u]'), pEl = bd.querySelector('[data-if-p]'), bEl = bd.querySelector('[data-if-login]');
      if (!bEl) return;
      var saveEl = bd.querySelector('[data-if-save]');
      var listEl = bd.querySelector('[data-if-list]');
      var swEl = bd.querySelector('[data-if-switch]');
      var delEl = bd.querySelector('[data-if-del]');
      var ACC = { accounts: [], active: '' };
      function fillList() {
        if (!listEl) return;
        var opts = (ACC.accounts || []).map(function (a) {
          return '<option value="' + a.username + '"' + (a.username === ACC.active ? ' selected' : '') + '>' + a.username + (a.note ? ('（' + a.note + '）') : '') + (a.username === ACC.active ? ' · 当前' : '') + '</option>';
        });
        listEl.innerHTML = opts.length ? opts.join('') : '<option value="">（还没有保存的账号）</option>';
      }
      function loadAccts() {
        erp('GET', '/api/ifast/accounts').then(function (j) { ACC = j || ACC; fillList(); }).catch(function () { fillList(); });
      }
      loadAccts();
      if (swEl) swEl.addEventListener('click', function () {
        var u = listEl && listEl.value;
        if (!u) { ft.textContent = '先选一个已保存账号'; return; }
        swEl.disabled = true; ft.textContent = '正在用 ' + u + ' 登录 ifast…';
        erp('POST', '/api/ifast/accounts/login', { username: u }).then(function (j) {
          swEl.disabled = false;
          if (j && j.ok) { ft.textContent = '✓ 已切换为 ' + u + '：' + (j.shops || 0) + ' 个跟卖方案 · ' + (j.sites || 0) + ' 个站点'; S.ifast = (j.status || {}); ACC = j.accounts || ACC; fillList(); loadAll(false); }
          else ft.textContent = '切换失败: ' + ((j && j.error) || '');
        }).catch(function (e) { swEl.disabled = false; ft.textContent = '切换失败: ' + e.message; });
      });
      if (delEl) delEl.addEventListener('click', function () {
        var u = listEl && listEl.value;
        if (!u) { ft.textContent = '先选一个已保存账号'; return; }
        if (!confirm('删除已保存账号 ' + u + '？（不影响当前登录态）')) return;
        erp('POST', '/api/ifast/accounts/delete', { username: u }).then(function (j) { ACC = j || ACC; fillList(); ft.textContent = '已删除保存的账号: ' + u; }).catch(function (e) { ft.textContent = '删除失败: ' + e.message; });
      });
      try { var lastU = localStorage.getItem('zyp_ifast_user'); if (lastU && uEl) uEl.value = lastU; } catch (e) {}
      bEl.addEventListener('click', function () {
        var u = String((uEl && uEl.value) || '').trim();
        var p = String((pEl && pEl.value) || '');
        if (!u || !p) { ft.textContent = '请先填 ifast 账号和密码'; return; }
        bEl.disabled = true; ft.textContent = '正在登录 ifast…';
        erp('POST', '/api/ifast/login', { username: u, password: p, remember: true, save: !!(saveEl && saveEl.checked) }).then(function (j) {
          bEl.disabled = false;
          if (j && j.ok) {
            try { localStorage.setItem('zyp_ifast_user', u); } catch (e) {}
            if (pEl) pEl.value = '';
            ft.textContent = '✓ ifast 登录成功：' + (j.shops || 0) + ' 个跟卖方案 · ' + (j.sites || 0) + ' 个站点';
            S.ifast = (j.status || { ok: true, shops: [], sites: [] });
            if (j.accounts) { ACC = j.accounts; fillList(); }
            loadAll(false);
          } else {
            ft.textContent = '登录失败: ' + ((j && j.error) || '账号或密码错误');
          }
        }).catch(function (e) { bEl.disabled = false; ft.textContent = '登录失败: ' + e.message; });
      });
    })();
  }

  /* ★ 面板可自由拖动 / 缩放，位置尺寸存 SET.panelBox */
  function applyPanelBox() {
    var b = SET.panelBox;
    var wrap = root.querySelector('.wrap');
    if (!wrap) return;
    if (b && b.w) { wrap.style.width = b.w + 'px'; }
    if (b && b.h) { wrap.style.height = b.h + 'px'; }
    if (!b) { wrap.style.width = Math.min(1180, Math.max(420, window.innerWidth - 48)) + 'px'; }
    if (b && b.left != null && b.top != null) {
      host.style.left = b.left + 'px';
      host.style.top = b.top + 'px';
      host.style.right = 'auto';
    }
  }
  function panelChrome() {
    var wrap = root.querySelector('.wrap');
    if (!wrap) return;
    applyPanelBox();
    /* 缩放把手 */
    var rs = wrap.querySelector('.rs');
    if (!rs) {
      rs = document.createElement('div');
      rs.className = 'rs';
      rs.title = '拖动调整大小';
      wrap.appendChild(rs);
    }
    if (!rs.dataset.bound) {
      rs.dataset.bound = '1';
      rs.addEventListener('mousedown', function (e) {
        e.preventDefault(); e.stopPropagation();
        var r = wrap.getBoundingClientRect();
        var sx = e.clientX, sy = e.clientY, sw = r.width, sh = r.height;
        function mm(ev) {
          var w = Math.max(300, Math.min(window.innerWidth - 20, sw + (ev.clientX - sx)));
          var h = Math.max(200, Math.min(window.innerHeight - 20, sh + (ev.clientY - sy)));
          wrap.style.width = w + 'px';
          wrap.style.height = h + 'px';
          if (ev.clientX - sx < 0) {
            var nr = wrap.getBoundingClientRect();
            host.style.left = Math.max(0, nr.left - (sw - w)) + 'px';
            host.style.right = 'auto';
          }
        }
        function mu() {
          document.removeEventListener('mousemove', mm, true);
          document.removeEventListener('mouseup', mu, true);
          var rr = wrap.getBoundingClientRect();
          SET.panelBox = { left: Math.round(rr.left), top: Math.round(rr.top), w: Math.round(rr.width), h: Math.round(rr.height) };
          saveSettings();
        }
        document.addEventListener('mousemove', mm, true);
        document.addEventListener('mouseup', mu, true);
      });
    }
    /* 标题栏拖动 */
    var hd = wrap.querySelector('.hd');
    if (hd && !hd.dataset.bound) {
      hd.dataset.bound = '1';
      hd.addEventListener('mousedown', function (e) {
        if (e.target && e.target.closest && e.target.closest('button')) return;   // 按钮不触发拖动
        e.preventDefault();
        var r = wrap.getBoundingClientRect();
        var sx = e.clientX, sy = e.clientY, sl = r.left, st = r.top;
        function mm(ev) {
          var l = Math.max(0, Math.min(window.innerWidth - 60, sl + (ev.clientX - sx)));
          var t = Math.max(0, Math.min(window.innerHeight - 40, st + (ev.clientY - sy)));
          host.style.left = l + 'px';
          host.style.top = t + 'px';
          host.style.right = 'auto';
        }
        function mu() {
          document.removeEventListener('mousemove', mm, true);
          document.removeEventListener('mouseup', mu, true);
          var rr = wrap.getBoundingClientRect();
          SET.panelBox = { left: Math.round(rr.left), top: Math.round(rr.top), w: Math.round(rr.width), h: Math.round(rr.height) };
          saveSettings();
        }
        document.addEventListener('mousemove', mm, true);
        document.addEventListener('mouseup', mu, true);
      });
      /* 双击标题栏 = 复位到右上角默认位置 */
      hd.addEventListener('dblclick', function (e) {
        if (e.target && e.target.closest && e.target.closest('button')) return;
        SET.panelBox = null; saveSettings();
        host.style.left = ''; host.style.top = ''; host.style.right = '16px';
        wrap.style.width = ''; wrap.style.height = '';
      });
    }
  }

  /* 主图放大灯箱 */
  function openZoom(url) {
    var old = root.querySelector('#zyb-zoom');
    if (old) old.remove();
    var box = document.createElement('div');
    box.id = 'zyb-zoom';
    box.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.82);display:flex;align-items:center;justify-content:center;cursor:zoom-out';
    box.innerHTML = '<img src="' + url + '" style="max-width:92vw;max-height:92vh;object-fit:contain;background:#fff;border-radius:8px">';
    box.addEventListener('click', function () { box.remove(); });
    root.appendChild(box);
  }

  function render() {
    if (S.view === 'settings') { bd.innerHTML = settingsHtml(); bindSettings(); panelChrome(); return; }
    var p = S.product || {};
    var html = '';

    /* ① 商品信息 */
    if (!p.ok) {
      html += '<div class="sec"><h4>① 商品信息</h4><div class="note">✗ ' + esc(p.error || '未取到商品数据') + '</div></div>';
    } else {
      var siteOpts = ['DE','UK','FR','IT','ES','AU','US'].map(function (x) { return '<option value="' + x + '"' + (x === S.site ? ' selected' : '') + '>' + x + '</option>'; }).join('');
      var bgOf = function (cc) { return (S.bg || []).find(function (b) { return String(b.abbr || '').toUpperCase() === String(cc).toUpperCase(); }); };
      var ccNow = CC[S.site] || S.site;
      var bgNow = bgOf(ccNow);
      var bgBadge = bgNow ? (function(){ var m = BG[bgNow.status] || {t:bgNow.status,c:'#8c8c8c',bg:'#1f1f26',b:'#444'}; return '<span class="bg" style="color:'+m.c+';background:'+m.bg+';border-color:'+m.b+'">'+esc(m.t)+'</span>'; })() : '<span class="note">未检测</span>';
      html += '<div class="sec"><h4>① 商品信息 <select data-site style="background:#0b0d10;border:1px solid #2b3038;border-radius:6px;color:#e7eaf0;font-size:11px;padding:1px 4px">'
      + ['DE','UK','FR','IT','ES','AU','US'].map(function (s2) { return '<option value="' + s2 + '"' + (String(S.site).toUpperCase() === s2 ? ' selected' : '') + '>' + s2 + '</option>'; }).join('')
      + '</select>'
      + ' ' + bgBadge
      + '<a class="note" href="' + esc('https://www.amazon.' + (S.site === 'UK' ? 'co.uk' : S.site.toLowerCase()) + '/dp/' + S.asin) + '" target="_blank" style="margin-left:auto;color:#7aa2ff">Amazon ↗</a></h4>';

    /* 顶部速览条 */
    (function () {
      var vN = S.variants.length, selN = S.variants.filter(function (v) { return S.varsSel[v.asin]; }).length;
      var shipName = '';
      try { var h2 = (S.ifast.shops || []).find(function (x) { return x.id === S.shopId; }); shipName = h2 ? h2.name : ''; } catch (e) {}
      var bgOk = 0, bgApr = 0;
      Object.keys(S.varBg || {}).forEach(function (k) { var st = (S.varBg[k] || {}).status; if (st === 'OK') bgOk++; else if (st === 'APPROVAL_REQUIRED') bgApr++; });
      html += '<div class="row" style="margin:2px 0 6px;padding:4px 6px;background:#14171c;border:1px solid #23272e;border-radius:6px;gap:10px">'
        + '<span class="note">变体 <b style="color:#e7eaf0">' + vN + '</b></span>'
        + '<span class="note">已选 <b style="color:#e7eaf0">' + selN + '</b></span>'
        + '<span class="note">BG 可售 <b style="color:#5fd08a">' + bgOk + '</b> / 需批准 <b style="color:#e0b25c">' + bgApr + '</b></span>'
        + '<span class="note">目标站点 <b style="color:#e7eaf0">' + esc(S.site) + '</b></span>'
        + (shipName ? ('<span class="note">跟卖方案 <b style="color:#e7eaf0">' + esc(shipName) + '</b></span>') : '')
        + '</div>';
    })();

    /* 左图 + 右数据 */
    html += '<div style="display:flex;gap:12px;align-items:flex-start">';
    html += '<div style="flex:none">'
      + (p.image
        ? '<img data-zoom="' + esc(p.image) + '" src="' + esc(p.image) + '" title="点击放大主图" style="width:104px;height:104px;object-fit:contain;border-radius:8px;background:#fff;cursor:zoom-in;border:1px solid #23272e">'
        : '<div style="width:104px;height:104px;border:1px dashed #2b3038;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#6b7280;font-size:11px">无主图</div>')
      + '</div>';
    html += '<div style="flex:1;min-width:0">';
    html += '<div style="font-size:12px;line-height:1.45;max-height:36px;overflow:hidden">' + esc(p.title || '') + '</div>'
      + '<div class="note">' + esc(S.asin) + ' · ' + esc(p.brand || '-') + '</div>';
    html += '<div class="kv"><span>BuyBox</span><b>' + (p.price != null ? esc(p.price + ' ' + (p.currency || '')) : '-') + '</b>'
      + '<span class="note">' + (p.sales ? ('月销 ' + esc(p.sales)) : '') + (p.isFba === true ? ' · FBA' : (p.isFba === false ? ' · FBM' : '')) + '</span></div>';
    if (Array.isArray(p.bsr) && p.bsr.length) html += '<div class="kv"><span>排名</span><b>' + esc(p.bsr.map(function (b) { return '#' + b.rank; }).join(' / ')) + '</b></div>';
    html += '<div class="kv"><span>品牌</span><b>' + esc(p.brand || '-') + '</b>'
      + '<span class="note">' + (p.brandHasRecord ? ('备案 ' + esc((p.brandSources || []).slice(0, 1).join(','))) : '备案 未查到') + '</span></div>';
    if (p.sellerId || p.offers != null) html += '<div class="kv"><span>跟卖/卖家</span><b>' + (p.offers != null ? (p.offers + ' 家') : '-') + '</b><span class="note">' + esc(p.sellerId || '') + '</span></div>';
    var dims = Array.isArray(p.dims) && p.dims.length ? (p.dims.join(' × ') + ' ' + (p.dimsUnit || '')) : '';
    if (dims || p.weight != null) html += '<div class="kv"><span>尺寸/重量</span><b>' + esc(dims) + (p.weight != null ? (' · ' + esc(p.weight + ' ' + (p.weightUnit || ''))) : '') + '</b></div>';
    /* BG 店铺可售（并入商品信息） */
    if (S.bg && S.bg.length) {
      html += '<div class="row" style="gap:4px;margin-top:3px"><span class="note">BG 店铺可售</span>';
      S.bg.forEach(function (x) {
        var m = BG[x.status] || { t: x.status || '-', c: '#8c8c8c', bg: '#1f1f26', b: '#444' };
        html += '<span class="bg" style="color:' + m.c + ';background:' + m.bg + ';border-color:' + m.b + '" title="' + esc((x.name || '') + ' ' + (x.error || '')) + '">'
          + esc(x.abbr || '') + ' ' + esc(m.t) + '</span>';
      });
      html += '</div>';
    } else if (S.bgErr) {
      html += '<div class="note" style="color:#e06c72">BG 检测失败: ' + esc(S.bgErr) + '</div>';
    }
    /* ★ 2026-11-23 BG 多站点检测结果表 */
    (function () {
      var SITES_BG = [['UK','GB'],['DE','DE'],['FR','FR'],['IT','IT'],['ES','ES'],['AU','AU']];
      var src = S.bgSites || {};
      html += '<div class="row" style="margin-top:5px"><span class="note">BG 多站点检测</span><button class="btn" data-act="bg-refresh" style="margin-left:auto" title="按当前所有可用店铺重新检测，并写入商品库">⟳ 重新检测</button></div>';
      html += '<table class="tbl" style="width:100%;font-size:11px"><thead><tr><th style="width:44px">站点</th><th style="width:110px">BG 结果</th><th style="width:64px">配送</th><th style="width:92px">排名</th><th style="width:88px">价格</th><th style="width:86px">上架状态</th><th>检测时间</th></tr></thead><tbody>';
      SITES_BG.forEach(function (sg) {
        var it = src[sg[1]] || null;
        var m = it ? (BG[it.status] || { t: it.status, c: '#8c8c8c', bg: '#1f1f26', b: '#444' }) : null;
        var __sk = String(sg[0]).toLowerCase();
        var __st = (S.bgSiteStats || {})[__sk] || null;
        var __lst = (S.bgSiteListed || {})[__sk] || null;
        var ful = __st ? (__st.amazonSell ? 'AMZ' : (__st.fulfill || '—')) : '—';
        var rk = (__st && __st.rankParent != null) ? ('#' + Number(__st.rankParent).toLocaleString('en-US')) : '—';
        var pr = (__st && __st.price != null) ? (__st.price + ' ' + (__st.currency || '')) : '—';
        var __if = (S.ifastAsin || {})[__sk] || null;
        var IF_MAP = { 0: '待上传', 10: '检查中', 20: '已上架', 30: '失败', 40: '暂停' };
        var lsd = __if ? ((__if.statusText || IF_MAP[__if.itemStatus] || '已上架') + (__if.storeName ? (' · ' + __if.storeName) : '')) : '未上架';
        var lsdColor = __if ? (__if.itemStatus === 20 ? '#3f8600' : (__if.itemStatus === 30 ? '#e06c72' : '#e0b25c')) : '';
        html += '<tr><td><b>' + sg[0] + '</b></td><td>'
          + (it ? '<span class="bg" style="color:' + m.c + ';background:' + m.bg + ';border-color:' + m.b + '">● ' + esc(m.t) + '</span>' : '<span class="note">' + ((S.accounts || []).some(function (a) { return String(a.abbr || '').toUpperCase() === sg[1]; }) ? '未检测' : '无店铺') + '</span>')
          + '</td><td class="note">' + esc(ful) + '</td>'
          + '<td class="note">' + esc(rk) + '</td>'
          + '<td class="note">' + esc(pr) + '</td>'
          + '<td class="note" ' + (lsdColor ? ('style="color:' + lsdColor + '" title="' + esc((__if.storeName || '') + ' 更新: ' + (__if.updateTime || __if.createTime || '')) + '"') : '') + '>' + esc(lsd) + '</td>'
          + '<td class="note">' + (it && it.at ? esc(String(it.at).slice(5, 16)) : '—') + '</td></tr>';
      });
      html += '</tbody></table>';
      if (S.ifastAsinErr) html += '<div class="note" style="color:#e0b25c;margin-top:2px">ifast 实时查询失败：' + esc(S.ifastAsinErr) + '（当前显示本机上次同步的 ifast 商品数据）</div>';
    })();

    html += '<div class="row" style="gap:6px;margin-top:4px">'
      + '<a class="note" style="color:#7aa2ff" target="_blank" href="' + esc('https://www.amazon.' + (S.site === 'UK' ? 'co.uk' : S.site.toLowerCase()) + '/dp/' + S.asin) + '">商品页</a>'
      + '<a class="note" style="color:#7aa2ff" target="_blank" href="' + esc('https://www.amazon.' + (S.site === 'UK' ? 'co.uk' : S.site.toLowerCase()) + '/s?k=' + encodeURIComponent(p.brand || '')) + '">品牌页</a>'
      + '<a class="note" style="color:#7aa2ff" target="_blank" href="https://www.1688.com/offer_search/-6D6732.html?keywords=' + encodeURIComponent((p.title || '').slice(0, 30)) + '">1688 同款</a>'
      + '</div>';
    html += '</div></div>';
    html += '</div>';
    }   /* end if (prod && prod.ok) */

    /* ② 横排表格：多选+ASIN → 初始价 → 重量 → 运费 → 采购价 → 利润率 → 到手 → 汇率 → 承受价 → ± → 原价(红删) / 现价(绿) */
    var sym = curSym(S.site);
    var selV = S.variants.filter(function (v) { return S.varsSel[v.asin]; });
    var shipNow = S.freight != null ? S.freight : null;

    function rowCalc(v) {
      var ship = v.freight != null ? Number(v.freight) : (shipNow == null ? 0 : shipNow);
      var cost = v.cost != null ? Number(v.cost) : (Number(S.cost) || 0);
      var margin = v.margin != null ? Number(v.margin) : (Number(S.margin) || 0);
      var taxPct = effTaxPct(v);
      var k = kOf(taxPct);
      var fx = v.fx != null ? Number(v.fx) : (Number(S.fx) || 7.8);
      var base = r2(r2(ship + cost) * (1 + margin) / k / fx);
      var adj = v.adj != null ? Number(v.adj) : (Number(S.adj) || 0);
      /* ★ 2026-11-21 手填承受价：优先显示/使用手填值，不被公式覆盖 */
      var manual = null;
      if (v.manualPrice != null && isFinite(Number(v.manualPrice))) manual = Number(v.manualPrice);
      else if (SET.manualBearByAsin && SET.manualBearByAsin[String(v.asin)] != null && isFinite(Number(SET.manualBearByAsin[String(v.asin)]))) manual = Number(SET.manualBearByAsin[String(v.asin)]);
      var nowV = manual != null ? r2(manual) : r2(base + adj);
      return { base: base, adj: adj, now: nowV, manual: manual, cost: cost, margin: margin, taxPct: taxPct, fx: fx };
    }

    var statPriceAvg = '', statBearAvg = '';
    if (S.variants.length) {
      var ps = S.variants.filter(function (v) { return v.price != null; });
      var bs = S.variants.map(function (v) { return rowCalc(v).now; });
      if (ps.length) statPriceAvg = (ps.reduce(function (a, v) { return a + Number(v.price); }, 0) / ps.length);
      statBearAvg = bs.reduce(function (a, b) { return a + b; }, 0) / bs.length;
    }
    var bgCount = { ok: 0, apr: 0, other: 0, known: 0 };
    Object.keys(S.varBg || {}).forEach(function (k) {
      var st = (S.varBg[k] || {}).status;
      if (!st) return;
      bgCount.known++;
      if (st === 'OK') bgCount.ok++; else if (st === 'APPROVAL_REQUIRED') bgCount.apr++; else bgCount.other++;
    });
    html += '<div class="sec"><h4>② 变体 / 重量 · 算价（' + selV.length + '/' + S.variants.length + ' 已选）'
      + '<span class="note">' + (statPriceAvg !== '' ? ('原价均 ' + sym + r2(statPriceAvg) + ' · ') : '')
      + '承受价均 ' + sym + r2(statBearAvg)
      + (function () {
          if (!bgCount.known) return ' · BG 未检测';
          var miss = Math.max(0, S.variants.length - bgCount.known);
          return ' · BG 可售 ' + bgCount.ok + ' / 需批准 ' + bgCount.apr + (bgCount.other ? (' / 其它 ' + bgCount.other) : '') + (miss ? (' / 未检测 ' + miss) : '');
        })()
      + '</span>'
      + '<span class="note" style="margin-left:auto">' + (S.variantSrc === 'http' ? '页面HTML+数据源价' : '页面采集（数据源价获取失败，初始价请手填）')
      + (S.pageCurs && S.pageCurs.length ? (' · ' + S.pageCurs.join('/')) : '') + '</span></h4>'
      /* 工具条 + 商品级参数 */
      + '<div class="row"><button class="btn" data-act="selall">全选</button><button class="btn" data-act="selnone">清空</button>'
      + '<button class="btn" data-act="fillall" title="把第一行整行参数填到其余变体">一键填充</button>'
      + '<button class="btn" data-act="allbear" title="每行承受价都按当前参数重算">全部用承受价</button>'
      + '<span class="note" style="margin-left:8px">商品级</span>'
      + '<span class="note">重量g</span><input class="inp num" data-f="weight" value="' + (S.weightG > 0 ? S.weightG : '') + '" placeholder="未读到">'
      + '<span class="note">运费</span><b>' + (shipNow != null ? '¥' + shipNow : (S.freightErr ? '—' : '…')) + '</b>'
      + (S.freightCh ? '<span class="note">' + esc(S.freightCh) + '</span>' : '')
      + '<label class="note" style="display:inline-flex;gap:3px;align-items:center;margin-left:auto"><input type="checkbox" data-f="autoUpload"' + (S.autoUpload ? ' checked' : '') + '>提交亚马逊</label></div>';

    if (!S.variants.length) {
      html += '<div class="note">没有变体数据（商品库未收录该族）</div>';
    } else {
      html += '<div class="wide"><table class="tbl wtab"><thead><tr>'
        + '<th style="width:22px"></th><th style="width:158px">变体 / ASIN</th><th style="width:66px">初始价</th>'
        + '<th style="width:84px">初始± <button class="btn" data-fill-ipadj title="把 ± 数字向下填充到所有变体">↓填充</button></th>'
        + '<th style="width:58px">重量g</th><th style="width:62px">运费</th>'
        + '<th style="width:96px">采购¥ <button class="btn" data-fill-cost title="把采购¥向下填充到所有变体">↓填充</button></th><th style="width:54px">利润率</th><th style="width:54px">税率%</th><th style="width:56px">汇率</th>'
        + '<th style="width:66px">承受价' + sym + '</th><th style="width:84px">± <button class="btn" data-fill-adj title="把 ± 数字向下填充到所有变体">↓填充</button></th><th style="width:56px">差额</th>'
        + '<th style="width:60px">原价</th><th style="width:60px">现价</th><th style="width:60px">BG</th></tr></thead><tbody>';
      S.variants.forEach(function (v) {
        var on = !!S.varsSel[v.asin];
        var c = rowCalc(v);
        var ipAdjV = (v.ipAdj != null && isFinite(Number(v.ipAdj))) ? Number(v.ipAdj) : (Number(S.initAdj) || 0);
        var ip = v.price != null ? r2(v.price + ipAdjV) : '';
        html += '<tr>'
          + '<td><input type="checkbox" data-var="' + esc(v.asin) + '"' + (on ? ' checked' : '') + '></td>'
          + '<td><b style="font-size:11px' + (String(v.asin) === String(S.asin) ? ';color:#4c9aff' : '') + '"' + (String(v.asin) === String(S.asin) ? ' title="当前打开的变体页面"' : '') + '>' + esc(v.asin) + '</b>'
          + ' <a class="note" style="color:#7aa2ff" target="_blank" title="打开商品页" href="https://www.amazon.' + (S.site === 'UK' ? 'co.uk' : String(S.site).toLowerCase()) + '/dp/' + esc(v.asin) + '">↗</a>'
          + '<div class="row" style="gap:2px;margin-top:1px">' + specChips(v) + '</div></td>'
          + '<td><input class="inp num" data-r-ip="' + esc(v.asin) + '" value="' + ip + '"' + (function () {
              var lk = (SET.initPriceByAsin || {})[String(v.asin)];
              return (lk != null && lk !== '' && isFinite(Number(lk)))
                ? ' title="已锁定（切网页也保留）：清空即解锁" style="border-color:#4c9aff;box-shadow:0 0 0 1px rgba(76,154,255,.35)"'
                : ' title="填入数字即锁定：边框变蓝，切网页不会丢"';
            })() + '></td>'
          + '<td><input class="inp sm" data-r-ipadj="' + esc(v.asin) + '" value="' + (v.ipAdj != null ? v.ipAdj : '') + '" placeholder="' + (Number(S.initAdj) || 0) + '" title="输入 ± 数：改这个变体的初始价"></td>'
          + '<td><input class="inp num" data-r-w="' + esc(v.asin) + '" value="' + (v.weight != null ? v.weight : '') + '" placeholder="' + (S.weightG > 0 ? S.weightG : '') + '"' + lockStyle(v.asin, 'weight') + '></td>'
          + '<td><span class="note"' + (v.weight != null ? ' style="color:#8ab4ff"' : '') + '>' + (v.freight != null ? ('¥' + v.freight) : (shipNow != null ? ('¥' + shipNow) : '…')) + '</span></td>'
          + '<td><input class="inp num" data-r-cost="' + esc(v.asin) + '" value="' + (v.cost != null ? v.cost : '') + '" placeholder="' + (Number(S.cost) || 0) + '"' + lockStyle(v.asin, 'cost') + '></td>'
          + '<td><input class="inp sm" data-r-margin="' + esc(v.asin) + '" value="' + (v.margin != null ? v.margin : '') + '" placeholder="' + (Number(S.margin) || 0) + '"' + lockStyle(v.asin, 'margin') + '></td>'
          + '<td style="white-space:nowrap"><input class="inp sm" data-r-tax="' + esc(v.asin) + '" value="' + (v.tax != null ? v.tax : '') + '" placeholder="' + effTaxPct(v) + '"' + (SET.taxLock ? ' readonly style="opacity:.85" title="税率已锁定（在设置里改）"' : '') + '></td>'
          + '<td><input class="inp sm" data-r-fx="' + esc(v.asin) + '" value="' + (v.fx != null ? v.fx : r2(Number(S.fx) || 7.8)) + '"' + lockStyle(v.asin, 'fx') + '></td>'
          + '<td><input class="inp num" data-r-bp="' + esc(v.asin) + '" value="' + r2(c.now) + '"' + lockStyle(v.asin, 'bear') + '></td>'
          + '<td><input class="inp sm" data-r-adj="' + esc(v.asin) + '" value="' + (v.adj != null ? v.adj : '') + '" placeholder="' + (Number(S.adj) || 0) + '"' + lockStyle(v.asin, 'adj') + '></td>'
          + '<td>' + (Math.abs(c.now - c.base) >= 0.005
              ? (c.now > c.base
                ? '<span style="color:#5fd08a;font-weight:600">+' + r2(c.now - c.base) + '</span>'
                : '<span style="color:#e06c72;font-weight:600">' + r2(c.now - c.base) + '</span>')
              : '<span class="note">0</span>') + '</td>'
          + '<td>' + (Math.abs(c.now - c.base) >= 0.005 ? '<span class="old">' + sym + c.base + '</span>' : '<span class="note">' + sym + c.base + '</span>') + '</td>'
          + '<td><span class="newv">' + sym + c.now + '</span></td>'
          + '<td>' + (function () {
              var b = (S.varBg || {})[v.asin];
              if (!b || !b.status) return '<span class="note">—</span>';
              var m = BG[b.status] || { t: b.status, c: '#8c8c8c', bg: '#1f1f26', b: '#444' };
              return '<span class="bg" style="color:' + m.c + ';background:' + m.bg + ';border-color:' + m.b + '">' + esc(m.t) + '</span>';
            })() + '</td>'
          + '</tr>';
      });
      html += '</tbody></table></div>';
      html += '<div class="row" style="margin-top:6px"><button class="btn pri" data-act="upload">🚀 上架到 ifast（' + selV.length + ' 个）</button>'
        + '<span class="note">空白=用商品级默认；填了=该变体单独算。红=未调整价，绿=最终承受价。</span></div>';
    }
    html += '</div>';

    /* ④ 上架店铺（Amazon 店铺 × 站点） */
    html += '<div class="sec"><h4>④ 上架店铺 <span class="note">当前站点 ' + esc(S.site) + '</span></h4>';
    if (!S.accounts.length) html += '<div class="note">未读取到店铺账号（先登录智赢账号）</div>';
    else {
      S.accounts.forEach(function (a) {
        var on = !!S.accSel[a.id];
        var ab = String(a.abbr || '').toUpperCase();
        var bgB = '';
        var b = (S.bg || []).find(function (x) { return String(x.abbr || '').toUpperCase() === ab; });
        if (b) { var m = BG[b.status] || { t: b.status, c: '#8c8c8c', bg: '#1f1f26', b: '#444' }; bgB = '<span class="bg" style="color:' + m.c + ';background:' + m.bg + ';border-color:' + m.b + '">● ' + esc(m.t) + '</span>'; }
        /* ★ 该站点的大排名 / 配送方式（AMZ自营 / FBA / FBM）/ 价格 */
        var statB = '';
        try {
          var sk = (ab === 'GB' ? 'uk' : ab.toLowerCase());
          var st = S.siteStats ? S.siteStats[sk] : null;
          if (st && !st.error) {
            var rp = (st.rankParent != null) ? ('#' + Number(st.rankParent).toLocaleString('en-US')) : '未上榜';
            var fm = st.amazonSell ? 'AMZ自营' : (st.fulfill || '-');
            var fmColor = st.amazonSell ? '#c9a227' : (st.fulfill === 'FBA' ? '#3f8600' : (st.fulfill === 'FBM' ? '#2f6fed' : '#8c8c8c'));
            statB += '<span class="note" title="该站点大排名">· 大类 ' + rp + '</span>'
              + '<span class="note" style="color:' + fmColor + ';font-weight:600" title="配送方式">· ' + esc(fm) + '</span>';
            if (st.price != null) statB += '<span class="note">· ' + esc(st.price) + ' ' + esc(st.currency || '') + '</span>';
          } else if (S.siteStats) {
            statB += '<span class="note" title="该站点没有数据">· 无该站数据</span>';
          } else {
            statB += '<span class="note">· 读取中…</span>';
          }
        } catch (e) {}
        /* ★ 该站点是否已上架（来自上架记录 /api/listing/check） */
        var listB = '';
        try {
          var lst = S.listing ? S.listing[(ab === 'GB' ? 'uk' : ab.toLowerCase())] : null;
          if (lst && lst.duplicated && lst.where && lst.where.length) {
            var h0 = lst.where[0];
            var when = String(h0.at || '').slice(5, 16);
            var pr0 = (h0.price != null) ? (' · ' + h0.price + ' ' + (h0.currency || '')) : '';
            listB = '<span class="note" style="color:#3f8600;font-weight:600" title="已上架：' + esc((h0.shop || '') + ' ' + (h0.at || '') + (h0.title ? ('｜' + h0.title) : '')) + '">· ✅已上架 ' + esc(when) + pr0 + '</span>';
          } else if (S.listing) {
            listB = '<span class="note" style="color:#8c8c8c">· 未上架</span>';
          } else {
            listB = '<span class="note">· 上架状态…</span>';
          }
        } catch (e) {}
        html += '<label class="row" style="cursor:pointer"><input type="checkbox" data-acc="' + esc(a.id) + '"' + (on ? ' checked' : '') + '> '
          + '<b>' + esc(a.name || '店铺') + '</b><span class="note">· ' + esc(ab === 'GB' ? 'UK' : ab) + '</span>' + bgB + statB + listB + '</label>';
      });
    }
    var shopName = '';
    try { var hitShop = (S.ifast.shops || []).find(function (x) { return x.id === S.shopId; }); shopName = hitShop ? hitShop.name : (S.shopId || '-'); } catch (e) {}
    html += '<div class="row" style="margin-top:4px;padding-top:4px;border-top:1px dashed #23272e">'
      + '<span class="note">本次将上架 <b style="color:#e7eaf0">' + S.variants.filter(function (v) { return S.varsSel[v.asin]; }).length + '</b> 个变体</span>'
      + '<span class="note">站点 <b style="color:#e7eaf0">' + esc(S.site) + '</b></span>'
      + '<span class="note">跟卖方案 <b style="color:#e7eaf0">' + esc(shopName || '-') + '</b></span>'
      + '<span class="note">库存/备货 见设置</span></div>'
      + '<div class="note">上架时按所选店铺的站点提交；跟卖方案用默认（见 ⑦）</div></div>';

    /* 🏪 店铺管理：智赢账号（登录/切换）+ 亚马逊店铺（站点/BG） */
    var tokLis = (S.tokens && S.tokens.accounts) || [];
    html += '<div class="sec"><h4>🏪 店铺管理 <span class="note">智赢账号 + 亚马逊店铺</span></h4>';
    html += tokLis.length ? tokLis.map(function (a) {
      var act = a.active || a.id === (S.tokens && S.tokens.activeId);
      return '<div class="row" style="margin:3px 0">'
        + '<span class="bg" style="color:' + (act ? '#237804' : '#8c8c8c') + ';background:' + (act ? '#f6ffed' : '#1f1f26') + ';border-color:' + (act ? '#b7eb8f' : '#3a3a44') + '">' + (act ? '● 使用中' : '○') + '</span>'
        + '<b>' + esc(a.label || a.id) + '</b><span class="note">' + esc(a.tokenHint || '') + '</span>'
        + (a.source ? '<span class="note">（' + esc(a.source) + '）</span>' : '')
        + '<span style="margin-left:auto"></span>'
        + '<button class="btn" data-acct-switch="' + esc(a.id) + '"' + (act ? ' disabled' : '') + '>切换</button>'
        + '<button class="btn" data-acct-del="' + esc(a.id) + '">删除</button></div>';
    }).join('') : '<div class="note">还没有保存的智赢账号（点右上角「从浏览器获取并保存」）</div>';
    html += '<div class="row" style="margin-top:4px"><input class="inp" data-f="acctLabel" placeholder="备注名" style="width:76px">'
      + '<input class="inp" data-f="acctName" placeholder="智赢账号/手机号" style="width:128px">'
      + '<input class="inp" data-f="acctPwd" type="password" placeholder="密码" style="width:104px">'
      + '<button class="btn pri" data-act="acctLogin">登录并保存</button></div>';
    /* 亚马逊店铺 */
    if (S.accounts && S.accounts.length) {
      html += '<div class="row" style="margin-top:6px;gap:6px"><span class="note">亚马逊店铺</span>';
      S.accounts.forEach(function (a) {
        var ab = String(a.abbr || '').toUpperCase();
        var b = (S.bg || []).find(function (x) { return String(x.abbr || '').toUpperCase() === ab; });
        var chip = '';
        if (b) { var m = BG[b.status] || { t: b.status, c: '#8c8c8c', bg: '#1f1f26', b: '#444' }; chip = ' <span class="bg" style="color:' + m.c + ';background:' + m.bg + ';border-color:' + m.b + '">' + esc(m.t) + '</span>'; }
        html += '<span class="note" style="padding:1px 5px;border:1px solid #2b3038;border-radius:999px">' + esc(a.name || '店铺') + ' · ' + esc(ab === 'GB' ? 'UK' : ab) + chip + '</span>';
      });
      html += '</div>';
    }
    html += '</div>';

    /* ⑦ ifast */
    html += '<div class="sec"><h4>⑦ ifast 直连 ' + (S.ifast.ok ? '<span class="bg" style="color:#237804;background:#f6ffed;border-color:#b7eb8f">● 已连接 · ' + S.ifast.shops.length + ' 个跟卖方案</span>' : '<span class="bg" style="color:#d46b08;background:#fffbe6;border-color:#ffd591">● 未连接</span>') + '</h4>'
      + '<div class="kv"><span>站点</span><b>' + esc((S.ifast.sites || []).map(function (x) { return x.country + '=' + x.id; }).join(' · ') || '-') + '</b></div>'
      + (S.ifast.ok ? (S.ifast.shops || []).map(function (sh) {
          var cur = (sh.id === S.shopId);
          return '<div class="kv"><span class="bg" style="color:' + (cur ? '#237804' : '#8c8c8c') + ';background:' + (cur ? '#f6ffed' : '#1f1f26') + ';border-color:' + (cur ? '#b7eb8f' : '#444') + '">' + (cur ? '★ 当前' : '跟卖方案') + '</span><b>' + esc(sh.name) + '</b><span class="note">' + esc(sh.id) + '</span></div>';
        }).join('') : '')
      + '<div class="note">默认跟卖方案在 ERP 设置里改；这里只显示状态</div>'
      + '</div>';

    bd.innerHTML = html;
    bind();
    panelChrome();
  }

  function bind() {
    bd.querySelectorAll('[data-acct-switch]').forEach(function (el) {
      el.addEventListener('click', function () {
        var id = el.getAttribute('data-acct-switch');
        ft.textContent = '正在切换账号…';
        erp('POST', '/api/zy/tokens/active', { id: id }).then(function (j) {
          ft.textContent = (j && j.ok) ? ('已切换到: ' + ((j.account && j.account.label) || id)) : ('切换失败: ' + ((j && j.error) || ''));
          if (j && j.ok) loadAll(true);
        }).catch(function (e) { ft.textContent = '切换失败: ' + e.message; });
      });
    });
    bd.querySelectorAll('[data-acct-del]').forEach(function (el) {
      el.addEventListener('click', function () {
        var id = el.getAttribute('data-acct-del');
        if (!confirm('删除这个智赢账号？')) return;
        erp('POST', '/api/zy/tokens/remove', { id: id }).then(function (j) {
          ft.textContent = (j && j.ok) ? '已删除' : ('删除失败: ' + ((j && j.error) || ''));
          if (j && j.ok) loadAll(true);
        }).catch(function (e) { ft.textContent = '删除失败: ' + e.message; });
      });
    });
    bd.querySelectorAll('input[data-f]').forEach(function (el) {
      el.addEventListener('change', function () {
        var f = el.getAttribute('data-f'), v = el.value;
        if (f === 'weight') { S.weightG = Math.max(1, Math.round(Number(v) || 0)); loadFreight(); }
        else if (f === 'cost') { S.cost = Number(v) || 0; render(); }
        else if (f === 'margin') { S.margin = Number(v) || 0; render(); }
        else if (f === 'net') { S.net = Number(v) || 0.65; render(); }
        else if (f === 'fx') { S.fx = Number(v) || 7.8; render(); }
        else if (f === 'initAdj') { S.initAdj = Number(v) || 0; render(); }
        else if (f === 'autoUpload') { S.autoUpload = !!el.checked; SET.autoUpload = S.autoUpload; saveSettings(); }
        else if (f === 'adj') {
          S.adj = Number(v) || 0; SET.adjBySite[S.site] = S.adj; saveSettings(); render();
        }
      });
    });
    var siteSel = bd.querySelector('[data-site]');
    if (siteSel) siteSel.addEventListener('change', function () {
      var next = String(siteSel.value || '').toUpperCase();
      var slug = { US:'com', DE:'de', UK:'co.uk', FR:'fr', IT:'it', ES:'es', AU:'com.au' }[next] || 'de';
      var low = next === 'UK' ? 'uk' : next.toLowerCase();
      var loc = (SET.localeBySite || {})[next] || {};
      var zip = loc.zip || SITE_ZIP[low] || '';
      var cur = loc.currency || SITE_CUR[low] || 'EUR';
      ft.textContent = '切换到 ' + next + '：邮编 ' + zip + ' · 货币 ' + cur + ' …';
      localeFixLocal(zip, cur).then(function () {
        return erp('POST', '/api/zy/locale/fix', { site: low, zip: zip, currency: cur }).catch(function () { return null; });
      }).then(function (r) {
        ft.textContent = (r && r.ok ? ('已切换 ' + next + ' / ' + (r.curAfter || cur)) : '站点切换失败，仍跳转') + ' · 正在打开…';
        location.href = 'https://www.amazon.' + slug + '/dp/' + S.asin;
      });
    });
    bd.querySelectorAll('[data-act]').forEach(function (el) {
      el.addEventListener('click', function () {
        var a = el.getAttribute('data-act');
        if (a === 'adj-') { S.adj = r2(S.adj - 1); SET.adjBySite[S.site] = S.adj; saveSettings(); render(); }
        else if (a === 'adj+') { S.adj = r2(S.adj + 1); SET.adjBySite[S.site] = S.adj; saveSettings(); render(); }
        else if (a === 'selall') { S.variants.forEach(function (v) { S.varsSel[v.asin] = true; }); render(); }
        else if (a === 'selnone') { S.variants.forEach(function (v) { S.varsSel[v.asin] = false; }); render(); }
        else if (a === 'fillall') {
          var first = S.variants[0];
          if (!first) return;
          var ip0 = first.price != null ? r2(first.price + (Number(S.initAdj) || 0)) : null;
          var bp0 = r2(first.manualPrice != null ? Number(first.manualPrice) : (bearBase() + (Number(S.adj) || 0)));
          S.variants.forEach(function (v, i) { if (i > 0) { v.price = ip0; v.manualPrice = bp0; S.varsSel[v.asin] = true; } });
          /* ★ 2026-11-22 一键填充也算"用户定的初始价" → 一起锁定, 切网页不被数据源改回去 */
          try {
            if (!SET.initPriceByAsin) SET.initPriceByAsin = {};
            S.variants.forEach(function (v) {
              var adj = (v.ipAdj != null && isFinite(Number(v.ipAdj))) ? Number(v.ipAdj) : (Number(S.initAdj) || 0);
              if (v.price == null) delete SET.initPriceByAsin[String(v.asin)];
              else SET.initPriceByAsin[String(v.asin)] = r2(Number(v.price) + adj);
            });
            saveSettings();
          } catch (eL) {}
          ft.textContent = '已把第一行的初始价/承受价填到其余 ' + (S.variants.length - 1) + ' 个变体（初始价已锁定）';
          render();
        }
        else if (a === 'allbear') {
          var bpAll = r2(bearBase() + (Number(S.adj) || 0));
          S.variants.forEach(function (v) { v.manualPrice = bpAll; if (!SET.manualBearByAsin) SET.manualBearByAsin = {}; SET.manualBearByAsin[String(v.asin)] = bpAll; });
          try { saveSettings(); } catch (e) {}
          ft.textContent = '全部变体承受价已设为 ' + curSym(S.site) + bpAll;
          render();
        }
        else if (a === 'upload') { upload(); }
        else if (a === 'acctLogin') {
          var l2 = bd.querySelector('[data-f=acctLabel]') || {}, n2 = bd.querySelector('[data-f=acctName]') || {}, p2 = bd.querySelector('[data-f=acctPwd]') || {};
          loginZyAccount(n2.value || '', p2.value || '', l2.value || '', function (ok) { if (ok) loadAll(true); });
        }
        else if (a === 'acctAdd') {
          var lbEl = bd.querySelector('[data-f=acctLabel]'), tkEl = bd.querySelector('[data-f=acctToken]');
          var lb = lbEl ? lbEl.value.trim() : '', tk = tkEl ? tkEl.value.trim() : '';
          ft.textContent = '保存账号中…';
          erp('POST', '/api/zy/tokens', { label: lb, token: tk }).then(function (j) {
            ft.textContent = (j && j.ok) ? ('已保存账号: ' + ((j.account && j.account.label) || lb)) : ('保存失败: ' + ((j && j.error) || ''));
            if (j && j.ok) loadAll(true);
          }).catch(function (e) { ft.textContent = '保存失败: ' + e.message; });
        }
        else if (a === 'acctAuto') {
          ft.textContent = '正在从浏览器智赢插件获取 token…';
          erp('POST', '/api/zy/tokens', { label: '浏览器插件' }).then(function (j) {
            ft.textContent = (j && j.ok) ? ('已获取并保存: ' + ((j.account && j.account.label) || '')) : ('获取失败: ' + ((j && j.error) || ''));
            if (j && j.ok) loadAll(true);
          }).catch(function (e) { ft.textContent = '获取失败: ' + e.message; });
        }
      });
    });
    bd.querySelectorAll('[data-zoom]').forEach(function (el) {
      el.addEventListener('click', function () { openZoom(el.getAttribute('data-zoom')); });
    });
    bd.querySelectorAll('[data-acc]').forEach(function (el) {
      el.addEventListener('change', function () { S.accSel[el.getAttribute('data-acc')] = el.checked; });
    });
    bd.querySelectorAll('[data-var]').forEach(function (el) {
      el.addEventListener('change', function () { S.varsSel[el.getAttribute('data-var')] = el.checked; render(); });
    });
    /* 行内字段（初始价 / 采购 / 利润率 / 到手 / 汇率 / 承受价 / ±） */
    function rowOf(asin) { return S.variants.find(function (x) { return x.asin === asin; }) || null; }
    bd.querySelectorAll('[data-r-ip]').forEach(function (el) {
      el.addEventListener('change', function () {
        var v = rowOf(el.getAttribute('data-r-ip'));
        if (v) {
          var adjUse = (v.ipAdj != null && isFinite(Number(v.ipAdj))) ? Number(v.ipAdj) : (Number(S.initAdj) || 0);
          v.price = el.value === '' ? null : (Number(el.value) - adjUse);
        /* ★ 2026-11-23 隐式锁定（每行独立）：只锁当前行 ASIN，不同步其他变体（同步只由「一键填充」做） */
        try {
          if (!SET.initPriceByAsin || typeof SET.initPriceByAsin !== 'object') SET.initPriceByAsin = {};
          if (el.value !== '' && isFinite(Number(el.value))) {
            SET.initPriceByAsin[String(v.asin)] = r2(Number(el.value));
            v.priceLocked = true;
          } else {
            delete SET.initPriceByAsin[String(v.asin)];
            v.priceLocked = false;
          }
          saveSettings();
        } catch (eG) {}
          /* ★ 2026-11-22 锁定初始价(按 ASIN): 记下用户填的显示值 → 切网页/重载变体时回填,
           *   清空则解除锁定(下次回到数据源价)。 */
          try {
            if (!SET.initPriceByAsin) SET.initPriceByAsin = {};
            if (el.value === '') delete SET.initPriceByAsin[String(v.asin)];
            else if (isFinite(Number(el.value))) SET.initPriceByAsin[String(v.asin)] = r2(Number(el.value));
            saveSettings();
          } catch (eL) {}
          render();
        }
      });
    });
    [['data-r-cost', 'cost'], ['data-r-margin', 'margin'], ['data-r-tax', 'tax'], ['data-r-fx', 'fx'], ['data-r-adj', 'adj']].forEach(function (pair) {
      bd.querySelectorAll('[' + pair[0] + ']').forEach(function (el) {
        el.addEventListener('change', function () {
          var v = rowOf(el.getAttribute(pair[0]));
          if (!v) return;
          var val = el.value.trim();
          v[pair[1]] = (val === '') ? null : Number(val);
          render();
        });
      });
    });
    /* ★ 2026-11-21 初始价 ± 输入 + 向下填充 */
    /* ★ 2026-11-21 ± 输入：input 即时联动同行初始价（不重渲染，避免焦点丢失）；Enter/失焦 再落库渲染 */
    function ipAdjOf(v) { return (v.ipAdj != null && isFinite(Number(v.ipAdj))) ? Number(v.ipAdj) : (Number(S.initAdj) || 0); }
    function applyIpAdjLive(el) {
      var asin = el.getAttribute('data-r-ipadj');
      var v = rowOf(asin);
      if (!v) return;
      var raw = String(el.value || '').trim().replace(/^\+/, '');
      var ok = raw === '' || isFinite(Number(raw));
      el.style.borderColor = ok ? '' : '#e06c72';
      if (!ok) return;
      var n = raw === '' ? null : Number(raw);
      v.ipAdj = n;
      var ipEl = bd.querySelector('[data-r-ip="' + asin + '"]');
      if (ipEl && v.price != null) {
        var disp = r2(Number(v.price) + ipAdjOf(v));
        ipEl.value = disp;
        /* ★ 2026-11-22 初始± 改变了实际初始价 → 同步更新锁定值(落盘交给 change 事件, 避免每敲一下就写盘) */
        try { if (!SET.initPriceByAsin) SET.initPriceByAsin = {}; SET.initPriceByAsin[String(v.asin)] = disp; } catch (eL) {}
      }
    }
    bd.querySelectorAll('[data-r-ipadj]').forEach(function (el) {
      el.addEventListener('input', function () { applyIpAdjLive(el); });
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
      });
      el.addEventListener('change', function () {
        applyIpAdjLive(el);
        var raw = String(el.value || '').trim().replace(/^\+/, '');
        if (raw === '' || isFinite(Number(raw))) el.value = (raw === '' ? '' : raw);
        try { saveSettings(); } catch (eS) {}   /* ★ 2026-11-22 初始± 改动的锁定值落盘 */
        render();
      });
    });
    /* ★ 2026-11-21 采购¥ / ± 的向下填充（与初始±同一套交互） */
    function fillDown(colKey, globalVal) {
      var src = null;
      for (var i = 0; i < S.variants.length; i++) {
        var vv = S.variants[i];
        if (vv && vv[colKey] != null && isFinite(Number(vv[colKey]))) { src = Number(vv[colKey]); break; }
      }
      if (src == null) src = Number(globalVal) || 0;
      S.variants.forEach(function (v) { v[colKey] = src; });
      render();
    }
    bd.querySelectorAll('[data-fill-cost]').forEach(function (el) {
      el.addEventListener('click', function (e) { e.stopPropagation(); fillDown('cost', S.cost); });
    });
    bd.querySelectorAll('[data-fill-adj]').forEach(function (el) {
      el.addEventListener('click', function (e) { e.stopPropagation(); fillDown('adj', S.adj); });
    });
    bd.querySelectorAll('[data-fill-ipadj]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        var src = null;
        for (var i = 0; i < S.variants.length; i++) {
          var vv = S.variants[i];
          if (vv && vv.ipAdj != null && isFinite(Number(vv.ipAdj))) { src = Number(vv.ipAdj); break; }
        }
        if (src == null) src = Number(S.initAdj) || 0;
        S.variants.forEach(function (v) { v.ipAdj = src; });
        render();
      });
    });

    var freightTimer = null;
    function refetchRowFreights() {
      var ws = [];
      S.variants.forEach(function (v) { if (v.weight != null && v.weight > 0) ws.push(v.weight); });
      if (!ws.length) return;
      var uniq = ws.filter(function (x, i) { return ws.indexOf(x) === i; }).slice(0, 60);
      var cc = (typeof CC !== 'undefined' && CC[S.site]) || S.site;
      erp('GET', '/api/zy/freight/prices?country=' + encodeURIComponent(cc) + '&channel=' + encodeURIComponent('云途普货') + '&weights=' + uniq.join(',')).then(function (j) {
        if (!j || !j.ok) return;
        S.variants.forEach(function (v) {
          if (v.weight != null && j.prices && j.prices[String(v.weight)] != null) v.freight = j.prices[String(v.weight)];
        });
        render();
      }).catch(function () { });
    }
    bd.querySelectorAll('[data-r-w]').forEach(function (el) {
      el.addEventListener('change', function () {
        var v = rowOf(el.getAttribute('data-r-w'));
        if (!v) return;
        var val = el.value.trim();
        v.weight = (val === '') ? null : Math.max(1, Math.round(Number(val) || 0));
        if (v.weight == null) v.freight = null;
        if (freightTimer) clearTimeout(freightTimer);
        freightTimer = setTimeout(refetchRowFreights, 500);
        render();
      });
    });
    bd.querySelectorAll('[data-r-bp]').forEach(function (el) {
      el.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); el.blur(); } });
      el.addEventListener('change', function () {
        var v = rowOf(el.getAttribute('data-r-bp'));
        if (!v) return;
        var val = el.value.trim();
        v.manualPrice = (val === '') ? null : Number(val);
        try {
          if (!SET.manualBearByAsin) SET.manualBearByAsin = {};
          if (v.manualPrice == null) delete SET.manualBearByAsin[String(v.asin)];
          else SET.manualBearByAsin[String(v.asin)] = v.manualPrice;
          saveSettings();
        } catch (e) {}
        render();
      });
    });
  }

  /* 智赢账号登录（账号+密码；需要短信时发码并提示输入） */
  function loginZyAccount(name, pwd, label, done) {
    var nm = String(name || '').trim(), pw = String(pwd || '');
    if (!nm || !pw) { ft.textContent = '请填写智赢账号和密码'; return; }
    ft.textContent = '正在登录智赢账号…';
    erp('POST', '/api/zy/login', { name: nm, pwd: pw, label: label || nm }).then(function (r) {
      if (r && r.ok) {
        ft.textContent = '✔ 已登录并保存: ' + ((r.account && r.account.label) || nm);
        if (done) done(true);
        return;
      }
      if (r && (r.needSms || r.needToken)) {
        ft.textContent = '需要短信验证码，正在发送…';
        return erp('POST', '/api/zy/sms', { name: nm, pwd: pw, phone: (r.phone || nm) }).then(function (sm) {
          if (!sm || !sm.ok) { ft.textContent = '短信发送失败: ' + ((sm && (sm.message || sm.error)) || ''); return; }
          var code = window.prompt('短信验证码已发送到 ' + (r.phone || nm) + '，请输入 6 位验证码：');
          if (!code) { ft.textContent = '已取消短信验证'; return; }
          ft.textContent = '正在提交验证码…';
          return erp('POST', '/api/zy/login', { name: nm, pwd: pw, label: label || nm, type: 1, code: code, codeId: sm.codeId }).then(function (r2) {
            if (r2 && r2.ok) {
              ft.textContent = '✔ 已登录并保存: ' + ((r2.account && r2.account.label) || nm);
              if (done) done(true);
            } else ft.textContent = '登录失败: ' + ((r2 && (r2.message || r2.error)) || '未知');
          });
        });
      }
      ft.textContent = '登录失败: ' + ((r && (r.message || r.error)) || '未知');
    }).catch(function (e) { ft.textContent = '登录失败: ' + e.message; });
  }

  function upload() {
    var sel = S.variants.filter(function (v) { return S.varsSel[v.asin]; });
    if (!sel.length) { ft.textContent = '先选变体'; return; }
    var accs = S.accounts.filter(function (a) { return S.accSel[a.id]; });
    if (!accs.length) { ft.textContent = '先选店铺'; return; }
    var shopId = S.shopId || (S.ifast.shops[0] && S.ifast.shops[0].id) || '';
    if (!shopId) { ft.textContent = 'ifast 里没有跟卖方案（先登录 ifast）'; return; }
    /* ★ 2026-11-21 上架数值必须与面板显示一致：初始价含「初始±」，承受价含逐行采购/利润率/税率/汇率/±/手填 */
    function uploadInitPrice(v) {
      var adjIp = (v.ipAdj != null && isFinite(Number(v.ipAdj))) ? Number(v.ipAdj) : (Number(S.initAdj) || 0);
      return v.price != null ? r2(Number(v.price) + adjIp) : '';
    }
    function uploadBearPrice(v) {
      var manual = null;
      if (v.manualPrice != null && isFinite(Number(v.manualPrice))) manual = Number(v.manualPrice);
      else if (SET.manualBearByAsin && SET.manualBearByAsin[String(v.asin)] != null && isFinite(Number(SET.manualBearByAsin[String(v.asin)]))) manual = Number(SET.manualBearByAsin[String(v.asin)]);
      if (manual != null) return r2(manual);
      var ship = v.freight != null ? Number(v.freight) : (S.freight != null ? Number(S.freight) : 0);
      var cost = v.cost != null ? Number(v.cost) : (Number(S.cost) || 0);
      var margin = v.margin != null ? Number(v.margin) : (Number(S.margin) || 0);
      var k = kOf(effTaxPct(v));
      var fx = v.fx != null ? Number(v.fx) : (Number(S.fx) || 7.8);
      var base = r2(r2(ship + cost) * (1 + margin) / k / fx);
      var adj = v.adj != null ? Number(v.adj) : (Number(S.adj) || 0);
      return r2(base + adj);
    }
    var items = sel.map(function (v) {
      return { asin: v.asin, initPrice: uploadInitPrice(v), lowerPrice: uploadBearPrice(v), title: v.title || (S.product && S.product.title) || '', brand: v.brand || (S.product && S.product.brand) || '', image: v.image || (S.product && S.product.image) || '' };
    });
    var siteList = accs.map(function (a) { var ab = String(a.abbr || '').toUpperCase(); return ab === 'GB' ? 'UK' : ab; });
    var msg = '上架 ' + items.length + ' 个变体\n店铺: ' + accs.map(function (a) { return a.name + '·' + a.abbr; }).join(', ')
      + '\n站点: ' + siteList.join(', ') + '\n跟卖方案: ' + shopId + (S.autoUpload ? '\n⚠ 同时提交亚马逊' : '\n（只写入 ifast）') + '\n\n'
      + items.map(function (x) { return x.asin + '  初始 ' + x.initPrice + ' / 承受 ' + x.lowerPrice; }).join('\n');
    if (!confirm(msg)) return;
    ft.textContent = '上架中…';
    var jobs = siteList.map(function (site) {
      return erp('POST', '/api/ifast/add', {
        site: site, sellingId: shopId, stock: SET.stock, leadDays: SET.leadDays, onOff: 1, autoUpload: !!(S.autoUpload || SET.autoUpload),
        items: items, purchaseCost: Number(S.cost) || null, logisticsCost: S.freight != null ? S.freight : null,
        weightKg: Math.round(S.weightG) / 1000, margin: S.margin, net: S.net, fx: S.fx,
      }).then(function (j) { return { site: site, j: j || {} }; });
    });
    Promise.all(jobs).then(function (rs) {
      var okN = 0, addN = 0, lines = [];
      rs.forEach(function (x) {
        if (x.j && x.j.ok) { okN++; addN += (x.j.added || 0); lines.push(x.site + ' +' + (x.j.added || 0) + (x.j.skipped ? (' 跳过' + x.j.skipped) : '')); }
        else lines.push(x.site + ' ✗ ' + ((x.j && x.j.error) || '失败'));
      });
      ft.textContent = (okN ? ('✔ 上架完成: 新增 ' + addN + ' 条 · ') : '✗ 上架失败: ') + lines.join(' · ');
    });
  }

  /* ---------- 启动 ---------- */
  ft.textContent = '数据源: ERP 直连 · ifast 直连';
  loadSettings(function () { loadAll(false); loadBg(); });
  var lastUrl = location.href;
  setInterval(function () {
    if (location.href !== lastUrl) { lastUrl = location.href; if (asinOf()) loadAll(false); }
  }, 1500);
})();

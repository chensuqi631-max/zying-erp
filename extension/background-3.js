// 智赢采集器 v2 — 后台 (MV3 Service Worker)
// 为什么这一跳必须放在这里: 内容脚本的 fetch 受【页面 CORS / 私有网络】约束,
// 实测从 amazon.com.au 页面直连 http://127.0.0.1:3088 会直接超时; service worker 有
// host_permissions, 可跨源直发。所以采集在页面里做, 入库请求从这里发。
//
// 接口: POST /api/collect/ingest-push
//   { site, pageType, url, items: [...], filter: <canonical 过滤条件> }
//   服务端语义: 统一过滤(未知字段放行) → 已存在 ASIN 只跳过 → 一次保存

const API_BASE = 'http://127.0.0.1:3088';

// ★ 2026-09-26 实时汇率缓存(1 小时)。
//   用途: 「承受价格」按定价表.xlsx 的算法换算成站点本币时, 定价表里只写了
//   英 9.07 / 德 7.8 / 澳 4.73 三个站点的汇率, 其它站点(美/日/加…)没有 →
//   用 ERP /api/rates (基准 CNY) 兜底, 免得插件里再维护一份汇率表过期。
let __ratesCache = null;

/* ★ 2026-09-26 ERP 地址改成可配置(设置页「连接与维护」): 从 settings.erpBase 读, 5 秒缓存,
 *   缺失/非法就退回默认。换端口或换机器时不用改代码。 */
let __apiBase = null, __apiBaseAt = 0;
async function apiBase() {
  if (__apiBase && (Date.now() - __apiBaseAt) < 5000) return __apiBase;
  let b = API_BASE;
  try {
    const o = await chrome.storage.local.get('settings');
    const v = o && o.settings && o.settings.erpBase;
    if (v && /^https?:\/\//.test(v)) b = String(v);
  } catch (e) {}
  __apiBase = b.replace(/\/+$/, ''); __apiBaseAt = Date.now();
  return __apiBase;
}

async function api(path, { method = 'GET', body } = {}) {
  let r;
  const base = await apiBase();
  try {
    r = await fetch(base + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new Error('连不上本地智赢ERP (' + base + ') — 请确认 ERP 后端已启动');
  }
  const text = await r.text();
  let j = {};
  if (text) { try { j = JSON.parse(text); } catch (e) { j = { error: text.slice(0, 200) }; } }
  if (!r.ok) throw new Error((j && j.error) || ('HTTP ' + r.status));
  return j;
}

// 过滤条件: 存在 chrome.storage.local.filter (canonical schema 的 JSON), 空则无过滤
async function currentFilter() {
  try {
    const o = await chrome.storage.local.get('filter');
    const f = o && o.filter;
    if (!f || typeof f !== 'object') return {};
    // 去掉纯空值, 避免把空字符串当条件发过去
    const out = {};
    Object.keys(f).forEach((k) => {
      const v = f[k];
      if (v == null || v === '' || v === false) return;
      if (Array.isArray(v) && !v.length) return;
      out[k] = v;
    });
    return out;
  } catch (e) { return {}; }
}

/* ══════════ ★ 多店铺隔离 (2026-10-06) ══════════
 * 店铺 = ifast 账号名(createUserName)。上架器(bridge.js)在 ifast 页登录后写进
 * chrome.storage.local.currentShop / shops; 这里取出来给上传/取任务/查重带上,
 * 后端据此把「上架记录 / 填表任务 / 上传日志 / 选品归档」按店铺隔离。
 * 没登录 → name = null: 后端把记录归到「未分类」, 插件照旧可用(不阻断采集与上传)。 */
async function currentShop() {
  try {
    const o = await chrome.storage.local.get(['currentShop', 'shops']);
    const shops = (o && o.shops && typeof o.shops === 'object') ? o.shops : {};
    const cur = (o && o.currentShop) || null;
    const it = cur ? (shops[cur] || null) : null;
    return {
      name: cur || null,
      userId: (it && it.userId != null) ? it.userId : null,
      sites: (it && (it.countries || it.sites)) || null,
      groups: (it && it.sellingGroups) || null,
      known: !!it,
    };
  } catch (e) { return { name: null, userId: null, sites: null, groups: null, known: false } }
}

/** 店铺对象 → 上报后端的形状(后端 /api/shop/register 认这几项) */
function shopPayload(s) {
  return { shop: s.name, userId: s.userId, sites: s.sites || undefined, groups: s.groups || undefined };
}

/**
 * 把后端返回的拦截信息整理成「一句人话 + 结构化字段」。
 * 插件三处(popup 工作台 / content 面板 / bridge 上架器)都显示这个 text,
 * 所以**店铺名与上架时间**在这里统一拼好, 不在各处重复拼(容易漏字段)。
 * 后端原始形状: { blocked:true, reason, message, where:[{shop,site,at,url,title,sellingId}] }
 *              或部分拦截: { ok:true, blocked:true, blockedItems:[{asin,site,scope,reason,message,where}] }
 */
function blockInfo(r) {
  if (!r) return null;
  const items = Array.isArray(r.blockedItems) ? r.blockedItems : [];
  const it0 = items[0] || null;
  const w = (Array.isArray(r.where) && r.where[0]) || (it0 && Array.isArray(it0.where) && it0.where[0]) || null;
  const scope = r.scope || (it0 && it0.scope) || (w && w.scope) || null;
  const shop = (w && w.shop) || null;
  const at = (w && w.at) ? String(w.at).slice(0, 16) : null;
  const site = String((w && w.site) || (it0 && it0.site) || '').toLowerCase() || null;
  const asin = (it0 && it0.asin) || (w && w.id ? String(w.id).split('@')[0] : null) || null;
  const title = (w && w.title) || null;
  const url = (w && w.url) || null;
  const label = asin ? (asin + (site ? ' / ' + site.toUpperCase() : '')) : '该商品';
  const text = '⛔ 已被拦截: ' + label + ' 已在「' + (shop || '未分类店铺') + '」'
    + (site ? (' · ' + site.toUpperCase() + ' 站') : '')
    + ' 于 ' + (at || '(时间未知)') + ' 上架过'
    + (scope === 'same-shop' ? ' —— 本店铺重复(同店也拦)' : ' —— 跨店铺重复')
    + '，本次未提交 ifast';
  return { reason: r.reason || (it0 && it0.reason) || null, scope, shop, at, site, asin, title, url,
    message: r.message || (it0 && it0.message) || null, text, where: r.where || [], items };
}

/* ★★ 2026-10-07 新增【给页面发消息必须带超时】—— 实测踩到的硬坑:
 *   扩展被重载/更新后, 已经打开的 ifast 页面里的内容脚本实例会失效。此时
 *   chrome.tabs.sendMessage **既不响应、也不报错, 会永久挂住**(实测 12 秒仍在等, ping 也一样)。
 *   凡是 await 它的逻辑(取填表任务 / 预检 / 店铺刷新)都会跟着一起卡死 —— 用户看到的就是"点上传没反应"。
 *   所以: 所有"发给页面"的消息一律走这个带超时的封装, 超时就当失败, 由上层决定重试/自动刷新页面。 */
function sendToTab(tabId, msg, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return; done = true;
      resolve({ ok: false, timeout: true, error: '页面实例无响应(扩展刚被重载/更新过, 需要刷新该 ifast 页面)' });
    }, timeoutMs || 5000);
    try {
      chrome.tabs.sendMessage(tabId, msg, (r) => {
        if (done) return; done = true; clearTimeout(timer);
        const le = chrome.runtime.lastError;
        if (le) resolve({ ok: false, error: le.message || String(le) });
        else resolve(r || { ok: false, error: '页面没有返回内容' });
      });
    } catch (e) {
      if (done) return; done = true; clearTimeout(timer);
      resolve({ ok: false, error: String((e && e.message) || e) });
    }
  });
}

/* ★ 2026-10-07 新增 / 2026-10-08 改进: 扩展被安装/更新(或浏览器启动)后, 检查已打开的 ifast 页面。
 *   为什么需要: 扩展重载后, 老页面里的内容脚本实例会失效(消息端口销毁) —— 不处理的话
 *   上架器浮层/自动化填表全都"连不上", 用户只能自己按 F5。
 *   ★ 改进(用户报障"插件加载会跳切"): 原来是【无条件刷新】每个 ifast 页 —— 只要浏览器启动或扩展被重载,
 *     用户正开着的管理系统页面就会自己刷新(筛选/滚动位置全丢, 看起来就像"页面自己跳")。
 *     现在先发一个极轻的 PING_PAGE 探针: **能答话 = 实例是新的 → 绝不刷新**; 只有真失联才刷新,
 *     并把"存活几个/刷新几个"写进日志, 行为可追溯。 */
async function reviveIfastTabs(why) {
  await new Promise((r) => setTimeout(r, 3000));
  let tabs = [];
  try { tabs = await chrome.tabs.query({ url: 'https://www.ifast.top/*' }) } catch (e) { return }
  if (!tabs || !tabs.length) return;
  let live = 0, reloaded = 0, skipped = 0;
  for (const t of tabs) {
    const r = await sendToTab(t.id, { type: 'PING_PAGE' }, 2500);
    if (r && r.ok) { live++; continue }                       // 实例还活着 → 不打扰它
    /* ★ 2026-10-08: 只有【真正要干活的那页】(亚马逊→ASIN管理 列表页)才立刻刷新 ——
     *   其他 ifast 页(首页等)的失效实例不必现在刷: 真用到时会走各自的自愈路径(带超时+自动刷新),
     *   这样"扩展一重载, 所有 ifast 页一起跳"就收窄成"只有列表页会刷一次"。 */
    if (!/item_list\.html/.test(t.url || '')) { skipped++; continue }
    try { await chrome.tabs.reload(t.id); reloaded++ } catch (e) {}
  }
  console.log('[zying-bg] ifast 页实例自检(' + why + '): 存活 ' + live + ' 个(未刷新)' +
    (reloaded ? (', 已刷新 ' + reloaded + ' 个失效的列表页') : '') + (skipped ? (', 其余 ' + skipped + ' 个失效页留待按需自愈') : ''));
  /* 顺带提醒: Amazon 采集页上的采集器实例同样会在扩展重载后失效 —— 那边【不自动刷新】
   * (用户可能正在看/填商品页, 刷新会打断他), 只记一条日志, 需要时由用户自己 F5。 */
  try {
    const az = await chrome.tabs.query({ url: 'https://www.amazon.*/*' });
    if (az && az.length) {
      let dead = 0;
      for (const t of az) { const r = await sendToTab(t.id, { type: 'SCAN' }, 1500); if (!r || !r.ok) dead++ }
      if (dead) console.log('[zying-bg] 有 ' + dead + '/' + az.length + ' 个 Amazon 页面的采集器实例已失效(不自动刷新, 需要时按 F5)');
    }
  } catch (e) {}
}
try { chrome.runtime.onInstalled.addListener((d) => reviveIfastTabs((d && d.reason) || 'installed')) } catch (e) {}
try { chrome.runtime.onStartup.addListener(() => reviveIfastTabs('startup')) } catch (e) {}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      const t = msg && msg.type;

      if (t === 'PING') {
        const h = await api('/api/health');
        let total = null;
        try { const p = await api('/api/products?limit=1'); total = p.total; } catch (e) {}
        sendResponse({ ok: true, health: h, total });
        return;
      }

      /* ★ 2026-11-13 商品面板：内容脚本拿不到 127.0.0.1（页面 CORS），统一从这里转发。
       *   数据源是 ERP 的直连通道（智赢库 → 本地签名），不经过智赢插件。 */
      if (t === 'ZY_PANEL') {
        const asin = String((msg && msg.asin) || '').toUpperCase();
        const site = String((msg && msg.site) || 'de').toLowerCase();
        if (!/^[A-Z0-9]{10}$/.test(asin)) { sendResponse({ ok: false, error: 'asin 不合法' }); return; }
        const body = { asin, site };
        if (msg && msg.aid != null) body.aid = Number(msg.aid);
        const r = await api('/api/zy/panel', { method: 'POST', body });
        sendResponse(r);
        return;
      }
      if (t === 'ZY_STATUS') {
        const r = await api('/api/zy/status');
        sendResponse(r);
        return;
      }
      /* ── 多账号（智赢账号）管理 ── */
      if (t === 'ZY_LOGIN') {
        const body = { name: msg.name, pwd: msg.pwd };
        if (msg.code) body.code = msg.code;
        if (msg.codeId) body.codeId = msg.codeId;
        if (msg.type) body.type = msg.type;
        if (msg.label) body.label = msg.label;
        const r = await api('/api/zy/login', { method: 'POST', body: body });
        sendResponse(r);
        return;
      }
      if (t === 'ZY_SMS') {
        const r = await api('/api/zy/sms', { method: 'POST', body: { phone: msg.phone } });
        sendResponse(r);
        return;
      }
      if (t === 'ZY_TOKENS') {
        const r = await api('/api/zy/tokens');
        sendResponse(r);
        return;
      }
      if (t === 'ZY_TOKEN_SWITCH') {
        const r = await api('/api/zy/tokens/active', { method: 'POST', body: { id: msg.id } });
        sendResponse(r);
        return;
      }
      if (t === 'ZY_TOKEN_ADD') {
        const r = await api('/api/zy/tokens', { method: 'POST', body: { label: msg.label } });
        sendResponse(r);
        return;
      }
      if (t === 'ZY_TOKEN_REMOVE') {
        const r = await api('/api/zy/tokens/remove', { method: 'POST', body: { id: msg.id } });
        sendResponse(r);
        return;
      }
      /* 多店铺 BG：同一商品一次拿全部店铺结果 */
      /* 列表页卡片数据（多个 ASIN 的字段 + BG） */
      if (t === 'ZY_CARDS') {
        const r = await api('/api/zy/cards', { method: 'POST', body: { asins: msg.asins || [], site: msg.site || 'de' } });
        sendResponse(r);
        return;
      }
      if (t === 'ZY_BG_MULTI') {
        const body = { asin: String((msg && msg.asin) || '').toUpperCase() };
        if (msg && msg.aids) body.aids = msg.aids;
        /* ★ 按站点匹配店铺（DE 页只查 DE 店）；之前漏传 sites，导致还是查了全部店铺 */
        if (msg && Array.isArray(msg.sites) && msg.sites.length) body.sites = msg.sites;
        const r = await api('/api/bg/probe-multi', { method: 'POST', body: body });
        /* 临时调试: 把实际用的 base 和请求体回传，便于排查"参数没生效" */
        try { r._dbgBase = await apiBase(); r._dbgBody = body; } catch (e) {}
        sendResponse(r);
        return;
      }
      if (t === 'ZY_BG') {
        const body = { asin: String((msg && msg.asin) || '').toUpperCase(), aid: msg && msg.aid != null ? Number(msg.aid) : undefined };
        if (body.aid == null) delete body.aid;
        const r = await api('/api/bg/probe', { method: 'POST', body });
        sendResponse(r);
        return;
      }
      if (t === 'ZY_EXPIRY') {
        const r = await api('/api/zy/expiry');
        sendResponse(r);
        return;
      }
      if (t === 'ZY_ACCOUNTS') {
        const r = await api('/api/zy/accounts');
        sendResponse(r);
        return;
      }

      if (t === 'STATUS') {
        let online = true, err = '', prog = { running: false }, total = null;
        try { prog = await api('/api/collect/progress'); } catch (e) { online = false; err = e.message; }
        try { const p = await api('/api/products?limit=1'); total = p.total; } catch (e) {}
        sendResponse({ ok: true, online, error: err, progress: prog || { running: false }, total });
        return;
      }

      if (t === 'PUSH') {
        const pl = msg.payload || {};
        const items = Array.isArray(pl.items) ? pl.items : [];
        if (!items.length) throw new Error('没有采到任何商品');
        const filter = await currentFilter();
        const raw = await api('/api/collect/ingest-push', {
          method: 'POST',
          body: { site: pl.site || '', pageType: pl.pageType || 'list', url: pl.url || '', items, filter },
        });
        if (raw && raw.ok === false) throw new Error(raw.error || '服务端拒绝入库');
        sendResponse({ ok: true, result: raw });
        return;
      }

      // ★ 待入库清单 → ERP【上架记录】(与商品库隔离)
      // ★ 2026-09-25 插件「确认上传」→ 落库上架记录(fill 字段 + fillStatus=todo) → 供 ifast 页 bridge 取任务填表
    if (t === 'LISTING_UPLOAD') {
      const item = msg.item || (msg.payload && msg.payload.item);
      if (!item || !item.asin) throw new Error('缺少 item');
      /* ★ 多店铺隔离: 带上当前登录店铺(上架器识别到的 ifast 账号名) */
      const sp = await currentShop();
      /* ★ 2026-10-24 PRD F5: 用户在弹窗点了「我确认，强制上架」→ 带 force:true
       *   后端不拦, 但在跨店台账里留一条 override 审计(谁/何时/从哪个店铺手上强行放过)。 */
      const forceUp = !!(msg.force === true || (msg.payload && msg.payload.force === true) || item.force === true);
      const raw = await api('/api/listing/upload', {
        method: 'POST',
        body: { item: item, site: msg.site || item.site, shop: sp.name || undefined, currentShop: sp.name || undefined, shopUserId: sp.userId != null ? sp.userId : undefined, force: forceUp || undefined, forceReason: forceUp ? ((msg.payload && msg.payload.forceReason) || '上传前弹窗确认强制上架') : undefined },
      });
      /* ★ 被查重拦下【不是错误】—— 要把"在哪个店铺 / 什么时候上架过"原样带回界面显示。
       *   后端返回 HTTP 200 + { ok:false, blocked:true, reason, message, where:[{shop,site,at,...}] }。
       *   老后端(还没重启)没有这套字段 → blocked 为空, 走原来的老路, 不影响使用。 */
      if (raw && raw.blocked && raw.ok === false) {
        sendResponse({ ok: false, blocked: true, block: blockInfo(raw), result: raw, shop: sp.name || null });
        return;
      }
      if (raw && raw.ok === false) throw new Error(raw.error || raw.message || '服务端拒绝');
      /* 部分拦截(有商品被拦、也有商品入队): ok=true 但仍然把拦截详情带回去, 让界面能说明白 */
      sendResponse({
        ok: true, result: raw, shop: sp.name || null,
        blocked: !!(raw && raw.blocked), block: (raw && raw.blocked) ? blockInfo(raw) : null,
      });
      return;
    }
    /* ★ 2026-10-24 PRD F1: 上传前查跨店台账(纯本地索引, 毫秒级, 不碰 ifast) */
    if (t === 'CLAIMS_CHECK') {
      const r = await api('/api/claims/check', { method: 'POST', body: (msg && msg.payload) || {} });
      sendResponse({ ok: true, result: r });
      return;
    }

    /* ★ 2026-10-24 局域网共享端口: 建/停/启/删/查(由 ERP 真正监听, 这里只是转发) */
    if (t === 'PORTS') {
      const p = (msg && msg.payload) || {};
      const act = String(p.action || 'list');
      let path = '/api/ports', method = 'GET', body = null;
      if (act === 'create') { method = 'POST'; body = { port: p.port, note: p.note }; }
      else if (act === 'stop' || act === 'start' || act === 'delete') { path = '/api/ports/' + act; method = 'POST'; body = { port: p.port }; }
      const r = await api(path, { method, body });
      if (r && r.ok === false) throw new Error(r.error || '服务端拒绝');
      sendResponse({ ok: true, result: r });
      return;
    }

    /* ★ 2026-10-24 设备连接(端口弹窗里的「🔗 连接」) —— 转给 ERP 的 peers 接口 */
    if (t === 'PEERS') {
      const p = (msg && msg.payload) || {};
      const act = String(p.action || 'list');
      let path = '/api/peers', method = 'GET', body = null;
      if (act === 'connect') { method = 'POST'; body = { url: p.url, name: p.name }; }
      else if (act === 'sync') { path = '/api/peers/sync'; method = 'POST'; body = { id: p.id }; }
      else if (act === 'sync-all') { path = '/api/peers/sync-all'; method = 'POST'; body = {}; }
      else if (act === 'delete') { path = '/api/peers/delete'; method = 'POST'; body = { id: p.id }; }
      const r = await api(path, { method, body });
      if (r && r.ok === false) throw new Error(r.error || '服务端拒绝');
      sendResponse({ ok: true, result: r });
      return;
    }

    if (t === 'LISTING_INGEST') {
        const items = (msg.payload && msg.payload.items) || [];
        if (!items.length) throw new Error('待入库清单为空');
        const raw = await api('/api/listing/ingest', { method: 'POST', body: { items: items } });
        if (raw && raw.ok === false) throw new Error(raw.error || '服务端拒绝');
        sendResponse({ ok: true, result: raw });
        return;
      }

      // ★ 读上架记录 (供上品工具页面/弹窗展示)
      if (t === 'LISTING_RECORDS') {
        const q = (msg && msg.query) || {};
        const qs = Object.keys(q).filter((k) => q[k] != null && q[k] !== '').map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(q[k])).join('&');
        const r = await api('/api/listing/records' + (qs ? '?' + qs : ''));
        sendResponse({ ok: true, records: r });
        return;
      }

      // ★ 上架记录导出 (csv/txt, 供上品工具一键取用)
      if (t === 'LISTING_EXPORT') {
        const fmt = (msg && msg.format) || 'json';
        const ids = (msg && msg.ids) || [];
        const qs = 'format=' + encodeURIComponent(fmt) + (ids.length ? '&ids=' + encodeURIComponent(ids.join(',')) : '');
        const r = await api('/api/listing/export?' + qs);
        sendResponse({ ok: true, data: r });
        return;
      }

      // ★ 改上架状态 (上品工具回写"已上架")
      if (t === 'LISTING_STATUS') {
        const r = await api('/api/listing/records/status', { method: 'POST', body: { ids: (msg && msg.ids) || [], status: (msg && msg.status) || 'listed', note: msg && msg.note } });
        sendResponse({ ok: true, result: r });
        return;
      }

      // ★ 2026-09-25 上品工具自动填表: 取待填任务 / 回报填表结果
      //   bridge.js(注入 ifast.top) 在「导入导出 → 添加跟卖」弹窗里填完 5 个字段后回报;
      //   验证阶段 payload.dryRun=true, submitted 恒为 false —— 绝不提交上传。
      if (t === 'LISTING_FILL_TASKS') {
        /* ★ 多店铺隔离: 只取【当前店铺】的待填任务(上架器登录什么店铺就用什么店铺的数据)。
         *   老后端会忽略 shop 参数 → 行为与以前完全一致。 */
        const sp = await currentShop();
        const qs = 'status=' + encodeURIComponent((msg && msg.status) || 'todo') + '&limit=' + encodeURIComponent((msg && msg.limit) || 5)
          + (sp.name ? ('&shop=' + encodeURIComponent(sp.name)) : '');
        const r = await api('/api/listing/fill-tasks?' + qs);
        sendResponse({ ok: true, result: r, shop: sp.name || null, shopFilter: !!(r && r.shopFilter) });
        return;
      }

      /* ★ 2026-10-06 查重预检: 上架器在"填表 / 点保存之前"先问一次 ERP —— 命中就别提交。
       *   为什么必须有: 后端虽然在上传时就不给重复的商品入队, 但"入队之后别家先上架了"的时序
       *   仍然可能发生; 而一旦点了保存, 请求就发出去了(回退纪律: 只允许在提交【之前】拦)。
       *   老后端(没重启)没有这个路由 → 404, 这里【静默降级】(supported:false), 绝不因为预检失败
       *   就把正常的填表流程拦下。 */
      if (t === 'LISTING_CHECK') {
        const p = (msg && msg.payload) || {};
        const asin = String(p.asin || '').toUpperCase().trim();
        const site = String(p.site || '').toLowerCase().trim();
        if (!/^[A-Z0-9]{10}$/.test(asin) || !site) {
          sendResponse({ ok: true, supported: true, duplicated: false, skipped: true, error: '缺 asin/site, 本次不预检' });
          return;
        }
        const sp = await currentShop();
        const q = 'asin=' + encodeURIComponent(asin) + '&site=' + encodeURIComponent(site)
          + (sp.name ? ('&shop=' + encodeURIComponent(sp.name)) : '');
        let r = null;
        try { r = await api('/api/listing/check?' + q) }
        catch (e) {
          const m = String((e && e.message) || '');
          sendResponse({
            // ★ 2026-10-20 清理冗余: 原来是 /HTTP 404/.test(m) ? false : false —— 两边都是 false, 恒等。
            ok: true, supported: false, duplicated: false, shop: sp.name || null,
            error: '后端没有 /api/listing/check(重启 ERP 后生效), 本次不做预检: ' + m,
          });
          return;
        }
        /* ★ 关键: 老后端对未知路由返回的是【HTTP 200 + {error:'未知接口: ...'}】(实测),
         *   不是 404 —— 所以"能不能用"必须按响应内容判断, 不能只看 HTTP 状态。
         *   不可用时 supported=false: 上架器会把预检跳过, 绝不因此拦下正常填表。 */
        const usable = !!(r && r.ok === true && r.key && typeof r.duplicated === 'boolean');
        /* ★ 2026-10-07 修【开关失效】: 必须把后端的 enforce(要不要拦)原样透传 ——
         *   原来是漏传的, 上架器只能按 duplicated 判, 于是"关了拦截开关也照拦"(实测踩到)。
         *   老后端没有这个字段 → 默认 true(按拦处理), 保持旧行为。 */
        const enforce = usable ? (r.enforce !== false) : true;
        sendResponse({
          ok: true, supported: usable, shop: sp.name || null,
          duplicated: usable ? !!r.duplicated : false,
          enforce: enforce,
          blocked: usable ? (!!r.duplicated && enforce) : false,
          scope: usable ? (r.scope || null) : null,
          message: usable ? (r.message || null) : null,
          block: (usable && r.duplicated) ? blockInfo(r) : null,
          error: usable ? null : ('后端还没有 /api/listing/check(重启 ERP 后生效) —— 响应: ' + JSON.stringify(r).slice(0, 80)),
        });
        return;
      }

      /* ★ 2026-10-07 新增: 「重复上架拦截」总开关(存在 ERP 的 shops.json 里, 跟数据走)。
       *   GET  → 读状态; payload {enabled:true|false} → 切换。设置页 / 上架器都用它。 */
      if (t === 'LISTING_BLOCKING') {
        const p = (msg && msg.payload) || {};
        if (typeof p.enabled === 'boolean') {
          const r = await api('/api/listing/blocking', { method: 'POST', body: { enabled: p.enabled, note: p.note } });
          sendResponse({ ok: true, result: r });
          return;
        }
        const r = await api('/api/listing/blocking');
        sendResponse({ ok: true, result: r });
        return;
      }

      /* ★ 2026-10-07: 问 ifast 的真相(经 ifast 页的 bridge 转发 —— 跨源只能它去 fetch)。
       *   用途: 上传被拦时提示里补上"ifast 侧实际: 创建于 X, 操作人 Y"。
       *   实测背景: 我们的记录写"13:15 上架过", 而 ifast 那条其实创建于 2026-09-24(操作人 xiaotang) ——
       *   只报自己的时间会让用户以为"我没上过这个品, 为什么拦我"。 */
      if (t === 'IFAST_LISTING') {
        const asin = String(((msg && msg.payload) || {}).asin || (msg && msg.asin) || '').toUpperCase().trim();
        /* ★ 2026-10-07 必须把【站点】一起转过去: 实测 ifast 的 `asin=` 查询会跨站点返回多行
         *   (同一个 ASIN 可以同时挂在 IT + ES), 不带站点就会把别的站点那条当成本站的记录。 */
        const siteQ = String(((msg && msg.payload) || {}).site || (msg && msg.site) || '').toLowerCase().trim();
        if (!/^[A-Z0-9]{10}$/.test(asin)) { sendResponse({ ok: false, error: 'asin 不合法' }); return }
        let tabs = [];
        try { tabs = await chrome.tabs.query({ url: 'https://www.ifast.top/*' }) } catch (e) {}
        if (!tabs || !tabs.length) { sendResponse({ ok: false, error: '没有打开的 ifast 页面(先打开上架列表页并登录)' }); return }
        /* ★ 2026-10-07: 优先问「ASIN管理」列表页 —— 上架器(bridge)真正干活的那页。
         *   实测: 若先问 ifast 首页(它的实例可能已失效), 要白等满一个超时(5s)才轮到列表页,
         *   采集器的"上传前预检"就会慢 5 秒。排序后正常情况 <1 秒返回。 */
        tabs = tabs.slice().sort((a, b) => (/item_list\.html/.test(b.url || '') ? 1 : 0) - (/item_list\.html/.test(a.url || '') ? 1 : 0));
        let lastErr = null;
        for (const tb of tabs) {
          /* ★ 带超时(5s): 失效实例会永久挂住, 必须靠超时收口 —— 见 sendToTab 的说明 */
          const r = await sendToTab(tb.id, { type: 'IFAST_LISTING', payload: { asin: asin, site: siteQ } }, 5000);
          if (r && r.ok && r.listing) { sendResponse({ ok: true, listing: r.listing, tabId: tb.id }); return }
          lastErr = (r && r.error) || lastErr;
          /* ★ 顺手自愈: 这一页没响应 → 刷新它(下次调用就快了), 不阻塞本次返回 */
          if (r && r.timeout) { try { chrome.tabs.reload(tb.id) } catch (e) {} }
        }
        sendResponse({
          ok: false,
          error: (lastErr && /无响应|Receiving end|message port/i.test(String(lastErr)))
            ? 'ifast 页面上的插件实例已失效 —— 刷新该 ifast 页即可恢复(或点一次「填入并保存」会自动刷新)'
            : ('ifast 页面没有响应: ' + (lastErr || '未登录 / 没有打开的 ifast 页')),
        });
        return;
      }

      /* ★ 当前店铺(给 popup/content 显示"当前店铺: X"用) */
      if (t === 'SHOP_CURRENT') {
        sendResponse({ ok: true, shop: await currentShop() });
        return;
      }

      /* ★ 上架器登录后把店铺报给 ERP(后端 shops.json) —— 让 ERP 侧也知道"当前是哪个店铺"。
       *   老后端没有这个路由 → 404, 静默忽略(本机 chrome.storage 里已经记了, 不影响功能)。 */
      if (t === 'SHOP_REGISTER') {
        const sp = await currentShop();
        if (!sp.name) { sendResponse({ ok: false, error: '未登录(没有当前店铺)' }); return }
        let r = null;
        try { r = await api('/api/shop/register', { method: 'POST', body: shopPayload(sp) }) }
        catch (e) {
          const m = String((e && e.message) || '');
          sendResponse({ ok: false, soft: true, error: '后端还没有 /api/shop/register(重启 ERP 后生效): ' + m });
          return;
        }
        /* 老后端同样是 HTTP 200 + {error:'未知接口'} → 按内容判断, 并且算"软失败"(不刷错误日志) */
        if (r && r.error) { sendResponse({ ok: false, soft: true, error: '后端还没有 /api/shop/register(重启 ERP 后生效): ' + String(r.error).slice(0, 80) }); return }
        sendResponse({ ok: true, current: r && r.current, changed: r && r.changed, throttled: r && r.throttled });
        return;
      }

      /* ★ ERP 侧店铺列表(设置页显示"ERP 已知店铺"用) */
      if (t === 'SHOP_LIST') {
        let r = null;
        try { r = await api('/api/shop/list') } catch (e) { sendResponse({ ok: false, error: String((e && e.message) || e) }); return }
        sendResponse({ ok: true, list: r, local: await currentShop() });
        return;
      }
      if (t === 'LISTING_FILL_RESET') {
        const r = await api('/api/listing/fill-reset', { method: 'POST', body: (msg && msg.payload) || {} });
        if (r && r.ok === false) throw new Error(r.error || '服务端拒绝');
        sendResponse({ ok: true, result: r });
        return;
      }
      /* ★ 2026-10-07 清理: 这里原来把 LISTING_FILL_RESET 分支写了两遍(逐字相同), 第二遍永远走不到。 */
      /* ★ 2026-10-24 ifast 店铺商品同步: 上架器面板「🔄 同步商品」分批把商品推给 ERP
       *   (内容脚本在 ifast 页里只负责拉 ifast 接口; 推到 127.0.0.1 由 SW 来做, 不受页面 CORS 限制) */
      if (t === 'IFAST_COOKIE_REFRESH') {
        /* 从浏览器抓一次 ifast 登录 cookie 存到 ERP（供 ERP 直连同步用） */
        const r = await api('/api/ifast/cookie', { method: 'POST', body: { browser: true } });
        if (r && r.ok === false) throw new Error(r.error || '刷新登录态失败');
        sendResponse({ ok: true, result: r });
        return;
      }
      if (t === 'ZY_API') {
        /* 商品页面板用：把 /api/* 请求转给本地 ERP（内容脚本不能直连 127.0.0.1） */
        const path = String((msg && msg.path) || '');
        if (!path.startsWith('/api/')) { sendResponse({ ok: false, error: '仅允许 /api/*' }); return; }
        const method = String((msg && msg.method) || 'GET').toUpperCase();
        const body = msg && msg.body != null ? msg.body : undefined;
        const r = await api(path, { method, body });
        sendResponse(r);
        return;
      }
      if (t === 'IFAST_SYNC_PUSH') {
        const r = await api('/api/ifast/sync', { method: 'POST', body: (msg && msg.payload) || {} });
        if (r && r.ok === false) throw new Error(r.error || '服务端拒绝');
        sendResponse({ ok: true, result: r });
        return;
      }
      if (t === 'LISTING_FILL_RESULT') {
        const r = await api('/api/listing/fill-result', { method: 'POST', body: (msg && msg.payload) || {} });
        if (r && r.ok === false) throw new Error(r.error || '服务端拒绝');
        sendResponse({ ok: true, result: r, fillStatus: r && r.fillStatus });
        return;
      }

      /* ★ 2026-09-26 采集器点「上传」后直接驱动 ifast 填表(+提交):
       *   采集器在 Amazon 页, 管理系统的浮层在 ifast 页 —— 跨站跨标签, 只有 background 能牵线。
       *   bridge 收到后【立刻回执】(不等 30~90 秒的填表流程), 真正结果由 bridge 自己回报 ERP,
       *   采集器靠轮询 ERP 记录状态看进度。
       */
      if (t === 'FILL_TASK_NOW') {
        const p = (msg && msg.payload) || {};
        const wantId = p.taskId || null;
        // 找已经开着「亚马逊 → ASIN管理」列表页的标签
        let tabs = await chrome.tabs.query({ url: 'https://www.ifast.top/*' });
        let list = tabs.find((x) => /item_list\.html/.test(x.url || ''));
        let opened = false;
        if (!list) {
          // 没开着就开一个(用户要求"直接", 所以这里替他打开)
          list = await chrome.tabs.create({ url: 'https://www.ifast.top/amazon/selling/item/item_list.html', active: false });
          opened = true;
          await new Promise((r) => setTimeout(r, 9000));   // 等内容脚本注入
        }
        let sent = null, err = null;
        /* ★ 2026-10-07 新增【失效实例自动恢复】:
         *   扩展被重载/更新后, 已经打开的 ifast 页面里的 bridge.js 属于"上一代扩展",
         *   它的消息端口已被销毁 —— 实测连试 8 次全是 "Receiving end does not exist", 等多久都没用。
         *   原来只提示用户"按 F5 刷新页面"(体验被动, 用户会以为数据坏了)。
         *   现在: 识别到这类错误 → **自动 F5 那个 ifast 标签页** → 等页面重载+内容脚本注入 → 重试。
         *   只自动刷新一次(避免和用户手动操作打架), 并在返回里标 reloaded 让上层能说明白。 */
        let reloaded = false;
        const deadInstance = (m) => /Receiving end does not exist|Extension context invalidated|message port closed|Could not establish connection|无响应|实例已失效/i.test(String(m || ''));
        for (let i = 0; i < 8 && !sent; i++) {
          /* ★★ 2026-10-07 关键修复: 必须用 sendToTab(带 5 秒超时)。
           *   原来直接 await chrome.tabs.sendMessage —— 实例失效时它会【永久挂住】,
           *   于是 FILL_TASK_NOW 永远不返回, 用户看到"点上传没反应"(而不是有明确报错)。 */
          const rr = await sendToTab(list.id, { type: 'RUN_FILL', autoSubmit: p.autoSubmit !== false, taskId: wantId }, 5000);
          if (rr && rr.ok) { sent = rr; break }
          err = (rr && rr.error) || err;
          if (deadInstance(err) && !reloaded) {
            reloaded = true;
            try { await chrome.tabs.reload(list.id) } catch (e2) {}
            await new Promise((r) => setTimeout(r, 10000));   // 等重载完成 + 内容脚本注入(实测 9s 够)
          } else {
            await new Promise((r) => setTimeout(r, 2500));
          }
        }
        sendResponse({
          ok: !!sent, dispatched: !!sent, tabId: list.id, opened: opened, reloaded: reloaded, reply: sent,
          error: sent ? null
            : (reloaded ? 'ifast 页面上的插件实例已自动刷新, 但仍未响应(可能未登录 / 页面不是「ASIN管理」列表页)'
              : ('找不到 ifast 浮层: ' + (err || '内容脚本没响应'))),
        });
        return;
      }

      /* ★ 2026-10-07 新增: 扩展被更新/重载后, 把已打开的 ifast 页面刷新一遍 ——
       *   否则那些页面里的 bridge.js 是"上一代扩展"的实例, 一整天都要靠用户手动 F5 才能用。
       *   只刷 ifast 页面(不动 Amazon 页), 且延迟几秒, 避免和用户刚打开的动作打架。 */
      if (t === 'REVIVE_IFAST_TABS') {
        let tabs = [];
        try { tabs = await chrome.tabs.query({ url: 'https://www.ifast.top/*' }) } catch (e) {}
        let n = 0;
        for (const tb of tabs) { try { await chrome.tabs.reload(tb.id); n++ } catch (e) {} }
        sendResponse({ ok: true, reloaded: n, tabs: tabs.length });
        return;
      }

      // ★ 实时汇率 (基准 CNY): 供「承受价格」换算本币用(定价表只给了英/德/澳三个站点)
      if (t === 'RATES') {
        const now = Date.now();
        if (__ratesCache && (now - __ratesCache.at) < 3600 * 1000) {
          sendResponse({ ok: true, cached: true, base: __ratesCache.base, date: __ratesCache.date, rates: __ratesCache.rates });
          return;
        }
        const r = await api('/api/rates');
        __ratesCache = { at: now, base: (r && r.base) || 'CNY', date: (r && r.date) || null, rates: (r && r.rates) || {} };
        sendResponse({ ok: true, cached: false, base: __ratesCache.base, date: __ratesCache.date, rates: __ratesCache.rates });
        return;
      }

      /* ★ 设置页保存后 → 转发给各页面里的内容脚本, 让面板立刻重读参数(不用刷新页面)。
       * 为什么要这一跳: 设置页用 chrome.runtime.sendMessage 广播时, 【内容脚本收不到】——
       *   内容脚本只接收 chrome.tabs.sendMessage 定向发给它所在标签页的消息(实测踩过:
       *   设置保存了, 但采集器面板还在用旧参数, 直到刷新页面才变)。 */
      if (t === 'SETTINGS_CHANGED') {
        let notified = 0;
        try {
          const tabs = await chrome.tabs.query({});
          for (const tb of tabs) {
            const u = String(tb.url || '');
            if (!/^https?:\/\/(www\.)?amazon\./i.test(u) && !/^https?:\/\/www\.ifast\.top\//i.test(u)) continue;
            try { const r = await sendToTab(tb.id, { type: 'SETTINGS_CHANGED' }, 3000); if (!r.timeout) notified++; } catch (e) {}
          }
        } catch (e) {}
        sendResponse({ ok: true, notified: notified });
        return;
      }

      // ★ 打开设置页(三个地方都从这里进: 采集器面板 / ifast 上架面板 / 工作台 popup)
      //   为什么用标签页而不是弹窗: 设置项分组多、要写说明, popup 宽度上限塞不下, 而且 popup 一关就没了。
      if (t === 'OPEN_SETTINGS') {
        /* ★ 2026-11-23 设置网页已删除：通知当前标签页的面板打开内置设置 */
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tab && tab.id) await chrome.tabs.sendMessage(tab.id, { type: 'ZYP_OPEN_SETTINGS' });
          sendResponse({ ok: !!(tab && tab.id) });
        } catch (e) { sendResponse({ ok: false }); }
        return;
      }
      // ★ 物流报价查询 (供页面浮层的「重量 → 查询」用)
      //   为什么必须走这里: 内容脚本直连 127.0.0.1:3088 受页面 CORS/私有网络限制(实测超时),
      //   service worker 有 host_permissions 才能跨源直发。
      /* ★ 2026-10-06 设置页「立即检测登录」: 转发给 ifast 标签让它跑一次店铺识别(bridge.js 的 refreshShop) */
      if (t === 'SHOP_REFRESH') {
        const tabs = await chrome.tabs.query({ url: 'https://www.ifast.top/*' });
        if (!tabs || !tabs.length) { sendResponse({ ok: false, error: '没有打开的 ifast 页面(先打开上架列表页并登录)' }); return; }
        let got = null;
        for (const tb of tabs) {
          /* ★ 带超时: 失效实例会永久挂住(见 sendToTab 说明) */
          const r = await sendToTab(tb.id, { type: 'SHOP_REFRESH_NOW' }, 6000);
          if (r && r.ok) { got = r; break; }
        }
        /* ★ 2026-10-07: shop 统一成【名字字符串】再回给调用方 —— bridge 给的 shop 是个对象
         *   ({name,userId,...}), 设置页直接拼字符串会显示成 "[object Object]"(实测踩到)。 */
        const nm = got && got.shop ? (got.shop.name || got.shop.shop || (typeof got.shop === 'string' ? got.shop : null)) : null;
        sendResponse(got ? Object.assign({}, got, { shop: nm }) : { ok: false, error: 'ifast 页面上没有响应 —— 该页面刷新一下(F5)即可恢复' });
        return;
      }

      if (t === 'LOGISTICS_QUOTE') {
        const p = (msg && msg.payload) || {};
        const country = String(p.country || '').toUpperCase();
        const weight = Number(p.weight) || 0;
        if (!country || !(weight > 0)) throw new Error('缺少 country 或 weight');

        // ★ 优先用设置页「物流成本 → 导入物流报价表」导入的表 (chrome.storage.local.freightQuote)
        //   表结构: { rates: { GB: { '200': 27.13, ... } } }, 键是克数。命中了就不去问 ERP。
        //   ★ 2026-10-04 修复(实测发现的准确性问题): 面板在英国页给的站点码是 'UK',
        //     而报价表的键是 'GB' —— 原来直接 rates['UK'] 查不到, 就【悄悄回落到 ERP】那张表,
        //     报出来的是别的渠道的价(0.5kg 实测 22, 而云途普货应为 41.61), 且没有任何提示。
        //     现在先按别名归一(UK→GB)再查, 表里两种写法都能命中。
        const FQ_CC_ALIAS = { UK: 'GB', GB: 'GB', 'UNITED KINGDOM': 'GB' };
        const fqCc = (c) => FQ_CC_ALIAS[String(c || '').toUpperCase()] || String(c || '').toUpperCase();
        try {
          const st = await chrome.storage.local.get('freightQuote');
          const fq = st && st.freightQuote;
          const all = (fq && fq.rates) || null;
          let tbl = all ? all[country] : null;
          if (!tbl && all) {
            const want = fqCc(country);
            const alt = Object.keys(all).find((k) => fqCc(k) === want);
            if (alt) tbl = all[alt];
          }
          if (tbl && typeof tbl === 'object') {
            const keys = Object.keys(tbl).map(Number).filter((n) => n > 0).sort((a, b) => a - b);
            const g = Math.ceil((weight * 1000) / 100) * 100;   // 按 100g 档向上取
            let hit = tbl[String(g)];
            if (hit == null && keys.length) {
              const below = keys.filter((k) => k <= g);
              hit = tbl[String(below.length ? below[below.length - 1] : keys[0])];
            }
            if (hit != null) {
              sendResponse({
                ok: true, country, weight, source: 'imported', updatedAt: fq.importedAt || null,
                quotes: [{ channel: fq.channel || '云途普货', total: Number(hit), eta: '', grams: g }],
              });
              return;
            }
          }
        } catch (e) { /* 导入表读不了就回落到 ERP */ }

        /* ★ 改为智赢实时运价（重量 kg → 克） */
        const _grams = Math.max(1, Math.round(Number(weight) * 1000));
        const r = await api('/api/zy/freight/quote?country=' + encodeURIComponent(country) + '&weight=' + _grams);
        const _pick = r && (r.picked || r.cheapest);
        const _quotes = _pick ? [{ channel: _pick.channel, total: _pick.price, eta: '', grams: _grams }] : [];
        sendResponse({ ok: !!_pick, country, weight, source: 'zying-live', quotes: _quotes, updatedAt: r && r.fetchedAt, error: _pick ? null : ((r && r.error) || '智赢运价不可用') });
        return;
      }

      sendResponse({ ok: false, error: '未知消息类型: ' + t });
    } catch (e) {
      sendResponse({ ok: false, error: (e && e.message) || '未知错误' });
    }
  })();
  return true;
});

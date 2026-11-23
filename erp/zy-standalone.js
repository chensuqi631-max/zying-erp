'use strict';
/**
 * zy-standalone.js —— 智赢数据源「直连通道」（不经过浏览器插件）
 *
 * 逆向来源：智赢选品扩展 5.2.0（2026-11 逆向）
 *   ① 签名：扩展内嵌安全 wasm（assets/img/static-chunk.png 解密而来），本模块附带解密后的副本
 *      输入 = "ZSG1"(4B) + 版本(1B=2) + 5×uint32LE 长度 + body + method + path + timestamp + token
 *      输出 = 64 字节 ASCII（64 个 hex 字符）
 *   ② token：插件 chrome.storage.local['zying_token']（用 CDP 读一次即可），
 *      之后用 POST seller.zying.net/api/AuthV2/RefreshToken 自动续期
 *
 * 能力（实测）：
 *   amazon_acc.sum                  授权店铺列表
 *   zbig/APILimitStatus             配额
 *   zbig/MoreAboutAsin/v2/{site}    商品数据（品牌/制造商/BSR/变体/尺寸/重量/上架日/卖点/报价/卖家/月销/品牌备案）
 *   zbig/MoreAboutAsin/simple/{site} 标题 + 主图（每批 ≤2）
 *   ZBig/BrandStatusWithSource      品牌各站点备案
 *   CmdHandler?cmd=amazon_hub_restriction.get  BG 门控检测（需可用 aid）
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const DATA = process.env.ZYING_DATA || path.join(os.homedir(), '.zying-erp', 'data');
const WASM_FILE = path.join(__dirname, 'tools', 'zy-security.wasm');
const TOKEN_FILE = path.join(DATA, 'zy-token.json');
const AMZ = 'https://amazon.zying.net/api';
const SELLER = 'https://seller.zying.net/api';
const MELI = 'https://meli.zying.net/api';
const ERP_API = 'https://erp.zying.net/api';
const CDP_PORT = Number(process.env.ZYING_CDP_PORT || 9222);
/* ★ 2026-11-15 插件 ID 会随版本变化：实测 gmnnic… 是当前在用的智赢选品插件，
 *   旧值 pembnii… 已不存在 → bootstrap 永远读不到 token。这里改成「候选 ID 列表 + 兜底扫描」。 */
const EXT_IDS = ['gmnnicmdgiafgenphemmdcigmdkpolabhb', 'gmnnicmdgiafgenphemmdcigkpolabhb', 'pembniiibielncgmegepmgcbkieljieh'];
const EXT_ID = EXT_IDS[0];

/* ============================ 签名器 ============================ */
let _signer = null;
function signer() {
  if (_signer) return _signer;
  if (!fs.existsSync(WASM_FILE)) throw new Error('缺少签名模块: ' + WASM_FILE);
  const wasm = fs.readFileSync(WASM_FILE);
  const inst = new WebAssembly.Instance(new WebAssembly.Module(wasm), {});
  const ex = inst.exports;
  const ENC = new TextEncoder();
  const toBytes = (s) => ENC.encode(typeof s === 'string' ? s : String(s == null ? '' : s));

  _signer = {
    /** 计算签名 → 64 字符 hex */
    sign({ body, method, path, timestamp, token }) {
      const parts = [toBytes(body), toBytes(method), toBytes(path), toBytes(timestamp), toBytes(token)];
      const head = 5 + 4 * parts.length;
      const total = parts.reduce((n, p) => n + p.byteLength, head);
      if (total > 0xc00000) throw new Error('签名输入过大');
      const input = new Uint8Array(total);
      input.set([90, 83, 71, 49, 2], 0);            // "ZSG1" + 版本 2
      const dv = new DataView(input.buffer);
      let off = 5;
      for (const p of parts) { dv.setUint32(off, p.byteLength, true); off += 4; }
      for (const p of parts) { input.set(p, off); off += p.byteLength; }

      const ptr = Number(ex.a(input.byteLength));
      new Uint8Array(ex.memory.buffer).set(input, ptr);
      const outPtr = Number(ex.a(64));
      const rc = ex.s(ptr, input.byteLength, outPtr);
      const raw = new Uint8Array(ex.memory.buffer.slice(outPtr, outPtr + 64));
      ex.d(ptr, input.byteLength);
      ex.d(outPtr, 64);
      if (rc !== 0) throw new Error('签名失败 rc=' + rc);
      return Buffer.from(raw).toString('latin1');
    },
  };
  return _signer;
}

/* ============================ token 管理 ============================ */
/* ══════════════════════════════════════════════════════════════════
 * 多账号 token 仓库（2026-11-13）
 *   目的: 保存多个「智赢账号」的 token, 一键切换; BG 检测可跨店铺/跨账号批量查。
 *   存储: ~/.zying-erp/data/zy-tokens.json
 *     { activeId, accounts: [ { id, label, token, savedAt, source, lastOkAt, lastErr } ] }
 *   兼容: 老的单 token 文件 zy-token.json 会在首次读取时自动迁移为 accounts[0]。
 *   注意: 这里存的是【智赢账号】token; 店铺(亚马逊授权)是智赢侧的另一层, 不在这里。
 * ══════════════════════════════════════════════════════════════════ */
const TOKENS_FILE = path.join(DATA, 'zy-tokens.json');
let _tokDb = null;

function loadTokDb() {
  if (_tokDb) return _tokDb;
  let db = null;
  try { db = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8')); } catch (e) {}
  if (!db || !Array.isArray(db.accounts)) {
    db = { activeId: null, accounts: [] };
    /* 迁移老文件 */
    try {
      const old = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
      if (old && old.token) {
        db.accounts.push({ id: 'acc1', label: old.source === 'manual-seed' ? '本机账号' : '默认账号', token: old.token,
          savedAt: old.savedAt || new Date().toISOString(), source: old.source || 'migrated' });
        db.activeId = 'acc1';
        fs.mkdirSync(DATA, { recursive: true });
        fs.writeFileSync(TOKENS_FILE, JSON.stringify(db, null, 1), 'utf8');
      }
    } catch (e) {}
  }
  _tokDb = db;
  return db;
}
function saveTokDb(db) {
  _tokDb = db;
  try { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(TOKENS_FILE, JSON.stringify(db, null, 1), 'utf8'); } catch (e) {}
  return db;
}
/** 当前生效的账号（返回 {id,label,token,savedAt} 或 null） */
function readToken() {
  const db = loadTokDb();
  const a = db.accounts.find((x) => x.id === db.activeId) || db.accounts[0] || null;
  return a && a.token ? a : null;
}
/** 保存/更新当前账号 token（保持向后兼容：无账号时新建） */
function saveToken(token, meta) {
  const db = loadTokDb();
  const m = meta || {};
  let a = db.accounts.find((x) => x.id === db.activeId);
  if (!a) {
    a = { id: 'acc' + (db.accounts.length + 1), label: m.label || ('账号' + (db.accounts.length + 1)), token: token, savedAt: new Date().toISOString(), source: m.source || 'manual' };
    db.accounts.push(a);
    db.activeId = a.id;
  } else {
    a.token = token;
    a.savedAt = new Date().toISOString();
    a.source = m.source || a.source || 'manual';
    if (m.label) a.label = m.label;
  }
  saveTokDb(db);
  /* 兼容老读法 */
  try { fs.writeFileSync(TOKEN_FILE, JSON.stringify({ token: a.token, savedAt: a.savedAt, source: a.source }, null, 1), 'utf8'); } catch (e) {}
  return a;
}
/** 账号列表（token 打码） */
function listTokens() {
  const db = loadTokDb();
  return {
    activeId: db.activeId,
    accounts: db.accounts.map((a) => ({
      id: a.id, label: a.label, active: a.id === db.activeId,
      savedAt: a.savedAt, source: a.source, lastOkAt: a.lastOkAt || null, lastErr: a.lastErr || null,
      tokenHint: a.token ? (String(a.token).slice(0, 8) + '…' + String(a.token).slice(-4)) : null,
      tokenLength: a.token ? String(a.token).length : 0,
    })),
  };
}
/** 新增一个账号（label 可选；token 不传则用插件当前 token） */
function addToken(label, token, meta) {
  const db = loadTokDb();
  const t = token || (readToken() && readToken().token);
  if (!t) throw new Error('没有可用 token：请先在插件里登录智赢，或直接传 token');
  const id = 'acc' + Date.now().toString(36);
  const a = { id, label: label || ('账号' + (db.accounts.length + 1)), token: t, savedAt: new Date().toISOString(), source: (meta && meta.source) || 'manual' };
  db.accounts.push(a);
  db.activeId = id;
  saveTokDb(db);
  return a;
}
function switchToken(id) {
  const db = loadTokDb();
  const a = db.accounts.find((x) => x.id === id);
  if (!a) throw new Error('账号不存在: ' + id);
  db.activeId = id;
  saveTokDb(db);
  return a;
}
function removeToken(id) {
  const db = loadTokDb();
  const i = db.accounts.findIndex((x) => x.id === id);
  if (i < 0) throw new Error('账号不存在: ' + id);
  db.accounts.splice(i, 1);
  if (db.activeId === id) db.activeId = db.accounts[0] ? db.accounts[0].id : null;
  saveTokDb(db);
  return { removed: id, activeId: db.activeId };
}
/** 标记某账号最近一次调用结果（用于面板显示"有效/失效"） */
function markTokenResult(ok, err) {
  const db = loadTokDb();
  const a = db.accounts.find((x) => x.id === db.activeId);
  if (!a) return;
  if (ok) { a.lastOkAt = new Date().toISOString(); a.lastErr = null; }
  else { a.lastErr = String(err || '').slice(0, 160); }
  saveTokDb(db);
}

/* 从插件读到 token（三种策略，按成功率排序）
 *   A. 扩展后台 SW（活跃时 /json/list 里会出现）—— 先尝试唤醒（调一次插件接口）
 *   B. 页面的【扩展隔离世界】执行上下文（content script 也拥有 chrome.storage 权限）← 最稳
 *   C. 手动 token（POST /api/zy/token {token}）
 */
async function bootstrapFromPlugin() {
  /* A. 先唤醒插件（调一次需要插件的接口），再找 SW */
  try { await fetch('http://127.0.0.1:3088/api/collect/api-selftest').catch(() => {}); } catch (e) {}
  for (let i = 0; i < 4; i++) {
    const list = await cdpJSON('/json/list').catch(() => []);
    /* 先按候选 ID 找；找不到就把所有扩展 SW 都试一遍（ID 变了也不影响） */
    const allSw = (list || []).filter((t) => String(t.url || '').includes('chrome-extension://') && /background/i.test(String(t.url || '')));
    const ordered = allSw.slice().sort((a, b) => {
      const score = (u) => (EXT_IDS.some((id) => String(u).includes(id)) ? 0 : 1);
      return score(a.url) - score(b.url);
    });
    for (const sw of ordered) {
      if (!sw.webSocketDebuggerUrl) continue;
      const t = await evalInTarget(sw.webSocketDebuggerUrl, STORAGE_EXPR);
      if (t) return saveToken(t, { source: 'plugin-sw' });
    }
    await new Promise((r) => setTimeout(r, 700));
  }

  /* B. 到 amazon 页面的扩展隔离世界里读 */
  const list = await cdpJSON('/json/list').catch(() => []);
  const page = (list || []).find((t) => t.type === 'page' && /amazon\./.test(t.url || ''));
  if (page && page.webSocketDebuggerUrl) {
    const t = await evalInExtensionWorld(page.webSocketDebuggerUrl, STORAGE_EXPR);
    if (t) return saveToken(t, { source: 'plugin-page-world' });
  }
  throw new Error('读不到插件 token：请确认采集浏览器开着、智赢选品插件已登录；或 POST /api/zy/token {token:"..."} 手动设置');
}

const STORAGE_EXPR = `new Promise(res=>{try{chrome.storage.local.get(['zying_token'],o=>res(JSON.stringify({t:o&&o.zying_token})))}catch(e){res(JSON.stringify({err:String(e&&e.message||e)}))}})`;

function pickToken(obj) {
  if (!obj) return null;
  const t = typeof obj.t === 'string' ? obj.t : (obj.t && (obj.t.token || obj.t.value)) || null;
  return t && t.length > 40 ? t : null;
}

/** 连一个 target 并在默认上下文求值 */
function evalInTarget(wsUrl, expression) {
  return new Promise(async (resolve) => {
    let done = false;
    const fin = (v) => { if (!done) { done = true; try { ws.close(); } catch (e) {} resolve(v); } };
    let ws;
    try { ws = new WebSocket(wsUrl); } catch (e) { return fin(null); }
    let id = 0; const pend = new Map();
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result || m); pend.delete(m.id); }
    });
    ws.addEventListener('open', async () => {
      const send = (method, params) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params: params || {} })); setTimeout(() => r(null), 8000); });
      await send('Runtime.enable', {});
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      const val = r && r.result && r.result.value;
      let obj = null; try { obj = JSON.parse(val || '{}'); } catch (e) {}
      fin(pickToken(obj));
    });
    setTimeout(() => fin(null), 9000);
  });
}

/** 连页面，等扩展隔离世界（origin=chrome-extension://<EXT_ID>）出现后在其中求值 */
function evalInExtensionWorld(wsUrl, expression) {
  return new Promise((resolve) => {
    let done = false;
    const fin = (v) => { if (!done) { done = true; try { ws.close(); } catch (e) {} resolve(v); } };
    let ws;
    try { ws = new WebSocket(wsUrl); } catch (e) { return fin(null); }
    let id = 0; const pend = new Map();
    const ctxs = [];
    let send;
    ws.addEventListener('message', async (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result || m); pend.delete(m.id); return; }
      if (m.method === 'Runtime.executionContextCreated') ctxs.push(m.params.context);
    });
    ws.addEventListener('open', async () => {
      send = (method, params) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params: params || {} })); setTimeout(() => r(null), 8000); });
      await send('Runtime.enable', {});
      /* 等一会儿让隔离世界注册进来，再找扩展上下文 */
      for (let i = 0; i < 12; i++) {
        await new Promise((r) => setTimeout(r, 350));
        const hit = ctxs.find((c) => String(c.origin || '').indexOf('chrome-extension://' + EXT_ID) === 0 && c.auxData && c.auxData.type === 'isolated');
        if (!hit) continue;
        const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, contextId: hit.id });
        const val = r && r.result && r.result.value;
        let obj = null; try { obj = JSON.parse(val || '{}'); } catch (e) {}
        const t = pickToken(obj);
        if (t) return fin(t);
      }
      fin(null);
    });
    setTimeout(() => fin(null), 12000);
  });
}

function cdpJSON(p) {
  return new Promise((res, rej) => {
    require('http').get('http://127.0.0.1:' + CDP_PORT + p, (r) => {
      let d = ''; r.on('data', (c) => (d += c));
      r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    }).on('error', rej);
  });
}

/* ============================ HTTP 调用 ============================ */
function buildSignedPath(baseUrl, p) {
  const i = baseUrl.indexOf('/api');
  return (i >= 0 ? baseUrl.slice(i) : '') + p;
}

async function call(baseUrl, p, data, method = 'POST', tokenOverride, timeoutMs) {
  const st = readToken();
  const token = tokenOverride || (st && st.token);
  if (!token) { const e = new Error('还没有 token：请先 POST /api/zy/token {bootstrap:true} 或 {token:"..."}'); e.needToken = true; throw e; }
  const ts = String(Math.round(Date.now() / 1000));
  const body = data ? JSON.stringify(data) : '';
  const sig = signer().sign({ body, method: String(method).toUpperCase(), path: buildSignedPath(baseUrl, p), timestamp: ts, token });
  const headers = { token, timestamp: ts, signature: sig, appclient: '3', version: 'v1.1',
    /* ★ 智赢服务端会校验插件版本（/authv2/Login 会直接拒绝低版本）*/ 
    ext_version: (process.env.ZYING_EXT_VERSION || '5.2.0'), 'Content-Type': 'application/json' };
  /* ★ 2026-11-14 必须带超时：实测接口被限流后会长时间不返回，无超时会把整轮采集挂死 */
  const ac = new AbortController();
  const tid = setTimeout(() => ac.abort(), Math.max(3000, Number(timeoutMs) || 30000));
  let r, text;
  try {
    r = await fetch(baseUrl + p, { method, headers, body: body || undefined, signal: ac.signal });
    text = await r.text();
  } finally {
    clearTimeout(tid);
  }
  let json = null;
  try { json = JSON.parse(text); } catch (e) {}
  return { status: r.status, ok: r.ok, json, text };
}

/* token 续期（失败不抛，返回 false 让调用方决定） */
async function refresh() {
  const st = readToken();
  if (!st || !st.token) return { ok: false, reason: 'no-token' };
  try {
    const r = await call(SELLER, '/AuthV2/RefreshToken', {}, 'POST');
    const t = r.json && r.json.token;
    if (t) { saveToken(t, { source: 'refresh' }); return { ok: true, token: t }; }
    return { ok: false, reason: 'no-token-in-response', status: r.status, body: (r.text || '').slice(0, 200) };
  } catch (e) { return { ok: false, reason: e.message }; }
}

/* 401/失效时自动续期一次再重试 */
async function callAuto(baseUrl, p, data, method, tokenOverride, timeoutMs) {
  let r = await call(baseUrl, p, data, method, tokenOverride, timeoutMs);
  const bad = r.status === 401 || (r.json && (r.json.code === 401 || r.json.code === 9999));
  if (bad) {
    const rf = await refresh();
    if (rf.ok) r = await call(baseUrl, p, data, method, tokenOverride, timeoutMs);
  }
  return r;
}

/* ============================ 业务封装 ============================ */
async function accounts() {
  const r = await callAuto(AMZ, '/CmdHandler?cmd=amazon_acc.sum', { page: 1, pageSize: 100 });
  const d = r.json && r.json.data;
  const list = (d && d.list && d.list.data) || [];
  return list.map((a) => ({ id: a.id, abbr: a.abbr || null, name: a.name || a.shop || null, flag: a.flag, usable: a.flag !== 9 }));
}

async function quota() {
  const r = await callAuto(AMZ, '/zbig/APILimitStatus', null, 'GET');
  return r.json && r.json.data !== undefined ? r.json.data : null;
}

/** 原始记录批量拉取（智赢原始结构，供 server 的 mergeZyApiRecord 直接合并）
 *  单批上限 20（实测 30 起 500）→ 内部分片 + 小间隔 */
async function moreAboutAsinRaw(asins, site, opts) {
  const o = opts || {};
  const list = (asins || []).map((a) => String(a).toUpperCase()).filter((a) => /^[A-Z0-9]{10}$/.test(a));
  const gap = o.gapMs == null ? 120 : Math.max(0, Number(o.gapMs));
  const data = {};
  const failedAsins = [];
  const retries = o.retries == null ? 2 : Math.max(0, Number(o.retries));
  for (let i = 0; i < list.length; i += 20) {
    const chunk = list.slice(i, i + 20);
    let ok = false;
    for (let attempt = 0; attempt <= retries && !ok; attempt++) {
      try {
        const r = await callAuto(AMZ, '/zbig/MoreAboutAsin/v2/' + site, chunk.map((a) => ({ asin: a })), 'POST', null, o.timeoutMs || 25000);
        const d = (r.json && r.json.data) || {};
        const got = Object.keys(d).length;
        if (r.status === 200 && got > 0) {
          for (const [asin, rec] of Object.entries(d)) if (rec && typeof rec === 'object') data[asin] = rec;
          ok = true;
        }
      } catch (e) { /* 超时/网络错误 → 退避重试 */ }
      if (!ok && attempt < retries) await new Promise((r2) => setTimeout(r2, 600 * (attempt + 1)));
    }
    if (!ok) for (const a of chunk) failedAsins.push(a);
    if (i + 20 < list.length && gap) await new Promise((r2) => setTimeout(r2, gap));
  }
  return { data, failedAsins };
}

/** 商品数据（无浏览器）：品牌/制造商/BSR/变体/尺寸/重量/上架日/卖点/报价/卖家/月销/品牌备案
 *  ★ 单批上限 20（实测 40 条整批返回 0/500）→ 内部自动分片 */
async function moreAboutAsin(asins, site) {
  const list = (asins || []).map((a) => String(a).toUpperCase());
  const out = {};
  for (let i = 0; i < list.length; i += 20) {
    const chunk = list.slice(i, i + 20);
    let d = {};
    try {
      const r = await callAuto(AMZ, '/zbig/MoreAboutAsin/v2/' + site, chunk.map((a) => ({ asin: a })));
      d = (r.json && r.json.data) || {};
    } catch (e) { /* 单批失败跳过 */ }
    for (const [asin, rec] of Object.entries(d)) {
      const o = (rec.Offers || []).find((x) => x.IsBuyBoxWinner) || (rec.Offers || [])[0] || null;
      out[asin] = {
        brand: rec.Brand || null,
        manufacturer: rec.Manufacturer || null,
        bsr: (rec.BSR || []).map((b) => ({ title: b.Title, id: b.Id, rank: b.Rank })),
        variations: rec.Variations || null,
        dims: rec.Dimensions || null, dimsUnit: rec.DimensionsUnit || null,
        weight: rec.Weight != null ? rec.Weight : null, weightUnit: rec.WeightUnit || null,
        firstAvailable: rec.FirstTime || null,
        bullets: rec.BulletPoint || [],
        price: o ? o.Listing : null, currency: o ? o.Currency : null,
        shipping: o ? o.Shipping : null, isFba: o ? !!o.IsFba : null,
        sellerId: rec.SellerId || null, offers: (rec.Offers || []).length,
        sales: rec.Sales || null, shipByAmazon: !!rec.ShipByAmazon,
        brandHasRecord: rec.BrandHasRecord === true,
        brandSources: rec.BrandSources || [],
        trademarkCount: (rec.BrandSourceDetails || []).length,
      };
    }
    if (i + 20 < list.length) await new Promise((r) => setTimeout(r, 150));
  }
  return out;
}

/** 标题 + 主图（simple 接口，每批 ≤2） */
async function titlesImages(asins, site) {
  const out = {};
  for (let i = 0; i < asins.length; i += 3) {
    const chunk = asins.slice(i, i + 3);
    try {
      const r = await callAuto(AMZ, '/zbig/MoreAboutAsin/simple/' + site, chunk);
      const d = (r.json && r.json.data) || [];
      for (const x of d) if (x && x.Asin) out[x.Asin] = { title: x.Title || null, image: x.Image || null };
    } catch (e) { /* 单批失败不影响整体 */ }
    if (i + 3 < asins.length) await new Promise((r) => setTimeout(r, 110));
  }
  return out;
}

async function brandStatus(brands) {
  const r = await callAuto(SELLER, '/ZBig/BrandStatusWithSource', { brands });
  return (r.json && r.json.data) || {};
}

/** BG 门控检测：返回 { ok, status, raw, code, message } */
async function bgCheck(aid, asin) {
  const r = await callAuto(AMZ, '/CmdHandler?cmd=amazon_hub_restriction.get', { aid: Number(aid), asin: String(asin).toUpperCase() });
  const j = r.json || {};
  if (j.code && j.code !== 200) {
    const msg = String(j.message || '');
    return { ok: false, code: j.code, message: msg, accountDisabled: /禁用|未授权|请先登录/i.test(msg) };
  }
  /* 与插件 content.js 同口径解析 */
  const d = j.data !== undefined ? j.data : j;
  let arr = [];
  if (Array.isArray(d)) arr = d;
  else if (d && Array.isArray(d.result)) arr = d.result;
  else if (d && d.result) arr = [d.result];
  let v = '';
  if (arr.length) { const hit = arr.find((x) => !(x && x.asin) || String(x.asin).toUpperCase() === String(asin).toUpperCase()) || arr[0]; v = (hit && hit.result) || ''; }
  else if (typeof d === 'string') v = d;
  const u = String(v == null ? '' : v).trim().toUpperCase();
  const map = { NOT_ELIGIBLE: 'NOT_ELIGIBLE', APPROVAL_REQUIRED: 'APPROVAL_REQUIRED', ASIN_NOT_FOUND: 'ASIN_NOT_FOUND', ERROR: 'ERROR', OK: 'OK', ELIGIBLE: 'OK', NORMAL: 'OK' };
  let status = map[u] || '';
  if (!status) {
    if (d && typeof d === 'object' && d.isRestricted !== undefined) status = d.isRestricted ? 'NOT_ELIGIBLE' : 'OK';
    else status = u || 'ERROR';
  }
  return { ok: true, status, raw: j };
}

/** 多店铺 BG 检测：对多个 aid 并发查同一个 ASIN
 *  @param asin 商品
 *  @param aids 店铺账号 id 数组（不传 = 当前账号下所有店铺）
 *  @returns [{aid, abbr, name, status, error, accountDisabled, ms}]
 */
async function bgProbeMulti(asin, aids, opts) {
  const asinU = String(asin || '').toUpperCase();
  if (!/^[A-Z0-9]{10}$/.test(asinU)) throw new Error('asin 不合法');
  let list = [];
  if (Array.isArray(aids) && aids.length) {
    /* 显式指定 aid 时，也去账号表里补上 abbr/name，面板才能显示"DE / GB"而不是空 */
    let all = [];
    try { all = await accounts(); } catch (e) {}
    list = aids.map((id) => {
      const hit = all.find((a) => Number(a.id) === Number(id)) || null;
      return { id: Number(id), abbr: (hit && hit.abbr) || null, name: (hit && hit.name) || null, usable: hit ? hit.usable : null };
    });
  } else {
    list = await accounts();
  }
  /* ★ 2026-11-20 改为【小并发】查多个店铺（原来串行 + 每店 250ms，6 店要 4~6 秒）
   *   并发上限 3，单店之间留 120ms 抖动，避免触发限流；返回顺序与 list 一致。 */
  const conc = Math.max(1, Math.min(4, Number((opts && opts.concurrency) || 3)));
  const out = new Array(list.length);
  let cursor = 0;
  const worker = async () => {
    while (true) {
      const i = cursor++;
      if (i >= list.length) return;
      const a = list[i];
      const t0 = Date.now();
      try {
        const r = await bgCheck(a.id, asinU);
        out[i] = {
          aid: a.id, abbr: a.abbr || null, name: a.name || null,
          status: r.ok ? r.status : 'ERROR',
          error: r.ok ? null : (r.message || '检测失败'),
          accountDisabled: !r.ok && !!r.accountDisabled,
          usable: a.usable,
          ms: Date.now() - t0,
        };
      } catch (e) {
        out[i] = { aid: a.id, abbr: a.abbr || null, name: a.name || null, status: 'ERROR', error: String((e && e.message) || e).slice(0, 160), accountDisabled: false, usable: a.usable, ms: Date.now() - t0 };
      }
      await new Promise((r) => setTimeout(r, 120));   // 防限流抖动
    }
  };
  await Promise.all(Array.from({ length: Math.min(conc, list.length) }, worker));
  return out.filter(Boolean);
}

/* ══════════════════════════════════════════════════════════════════
 * 智赢账号登录（逆向 5.1.99 登录框架）
 *   POST seller.zying.net/api/authv2/Login
 *     body { name, pwd, remember:true }            ← 账号密码
 *     body { name, pwd, remember:true, type:1, code, codeId }  ← 需要短信验证码时
 *   返回 { success, type, phone, token, uinfo, failtype, message }
 *     success=true          → token 可用
 *     type=1                → 需要手机验证码(先调 sendSms 拿 codeId)
 *     type=2                → 需要二次验证码
 *   POST seller.zying.net/api/authv2/SendSms { phone } → { success, codeId }
 *   注意: 密码只用于本次请求, 不落盘; 落盘的只有 token。
 * ══════════════════════════════════════════════════════════════════ */
async function loginV2(opts) {
  const o = opts || {};
  if (!o.name || !o.pwd) throw new Error('需要账号和密码');
  /* ★ 2026-11-13: 智赢后端是强类型模型(ASP.NET)，字段类型错了直接 400：
   *   remember 必须是 Boolean（发 1 会 400）
   *   codeId   必须是 String （发数字会 400）
   *   type     必须是枚举 1/2（发 "1" 字符串会 400）
   *   这里统一强制类型，并在缺字段时提前给可读提示，不把畸形请求发出去。 */
  const body = { name: String(o.name).trim(), pwd: String(o.pwd), remember: true };
  const t = o.type == null || o.type === '' ? null : Number(o.type);
  if (t === 1 || t === 2) {
    body.type = t;
    body.code = String(o.code == null ? '' : o.code);
    if (t === 1) {
      if (!o.codeId) throw new Error('缺少 codeId：请先点「发送」获取短信验证码');
      body.codeId = String(o.codeId);
    }
  }
  const r = await call(SELLER, '/authv2/Login', body, 'POST');
  const j = r.json || {};
  const out = {
    ok: j.success === true,
    httpStatus: r.status,
    message: j.message || null,
    type: j.type == null ? null : j.type,
    failtype: j.failtype == null ? null : j.failtype,
    phone: j.phone || null,
    token: j.token || null,
    uinfo: j.uinfo || null,
    needSms: j.success === false && Number(j.type) === 1,
    needToken: j.success === false && Number(j.type) === 2,
    raw: j,
  };
  if (j.errors && typeof j.errors === 'object') {
    const parts = Object.keys(j.errors).map((k) => k + ': ' + (Array.isArray(j.errors[k]) ? j.errors[k].join('; ') : String(j.errors[k])));
    out.message = '参数校验失败 —— ' + parts.join(' | ');
    out.fieldErrors = j.errors;
  }
  if (!out.ok && !out.needSms && !out.needToken && !out.message) out.message = (r.text || '').slice(0, 200);
  return out;
}

/** 发送短信验证码 → { ok, codeId, message } */
async function sendSms(phone) {
  if (!phone) throw new Error('需要手机号');
  const r = await call(SELLER, '/authv2/SendSms', { phone: String(phone).trim() }, 'POST');
  const j = r.json || {};
  return { ok: j.success === true, codeId: j.codeId || null, message: j.message || null, raw: j };
}

async function status() {
  const st = readToken();
  const out = { hasToken: !!(st && st.token), tokenSource: st && st.source, tokenSavedAt: st && st.savedAt, tokenAgeMin: null, accounts: null, usable: null, quota: null, tokenValid: null, error: null };
  if (st && st.savedAt) { const t = Date.parse(st.savedAt); if (!isNaN(t)) out.tokenAgeMin = Math.round((Date.now() - t) / 60000); }
  if (!out.hasToken) return out;
  try {
    const accs = await accounts();
    out.accounts = accs.length;
    out.usable = accs.filter((a) => a.usable).length;
    out.tokenValid = true;
  } catch (e) { out.tokenValid = false; out.error = String(e.message || e).slice(0, 200); }
  try { out.quota = await quota(); } catch (e) {}
  return out;
}

module.exports = {
  signer, call, callAuto, refresh, accounts, quota, moreAboutAsin, moreAboutAsinRaw, titlesImages, brandStatus, bgCheck, bgProbeMulti, status,
  bootstrapFromPlugin, readToken, saveToken, listTokens, addToken, switchToken, removeToken, markTokenResult, loginV2, sendSms,
  AMZ, SELLER, MELI, ERP_API, TOKEN_FILE, TOKENS_FILE, WASM_FILE,
};

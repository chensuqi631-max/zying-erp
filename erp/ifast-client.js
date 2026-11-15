'use strict';
/**
 * ifast-client.js —— 直连 www.ifast.top（IFAST 业务系统）
 *
 * 认证：单 Cookie `shiroCookie`（httpOnly）。用 CDP 从浏览器抓一次后加密存本机。
 * 约定：所有接口返回 {code,msg,count,data}；code=0(或空串) 成功。
 *
 * 上架单位 = 站点(siteId) + 跟卖方案(sellingId)
 *   站点：GET /amazon/site/enable              → 69181 GB / 69182 DE / 69183 FR / 69184 ES / 69185 IT / 69208 AU
 *   跟卖：GET /amazon/selling//user/selling.json → 午夜 / 全天跟卖 / 午夜正根 / 1
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

const DATA = process.env.ZYING_DATA || path.join(os.homedir(), '.zying-erp', 'data');
const FILE = path.join(DATA, 'ifast-cookie.json');
const BASE = 'https://www.ifast.top';
const CDP = 9222;

let cache = { shops: null, sites: null, at: 0 };
const CACHE_MS = 5 * 60 * 1000;

/* ---------- Cookie 存取 ---------- */
function loadCookie() {
  try {
    const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return { cookie: String(j.cookie || ''), at: j.at || null };
  } catch (e) { return { cookie: '', at: null }; }
}
function saveCookie(cookie) {
  fs.mkdirSync(DATA, { recursive: true });
  const rec = { cookie: String(cookie || '').trim(), at: new Date().toISOString() };
  fs.writeFileSync(FILE, JSON.stringify(rec, null, 1), 'utf8');
  try { fs.chmodSync(FILE, 0o600); } catch (e) {}
  cache = { shops: null, sites: null, at: 0 };
  return rec;
}

/** 从采集浏览器（CDP 9222）抓 ifast 的 cookie */
async function captureCookieFromBrowser() {
  const list = await new Promise((res) => {
    http.get('http://127.0.0.1:' + CDP + '/json/list', (r) => {
      let d = ''; r.on('data', (c) => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { res([]); } });
    }).on('error', () => res([]));
  });
  const page = (list || []).find((t) => t.type === 'page' && String(t.url).includes('ifast.top'));
  if (!page) throw new Error('采集浏览器里没有打开 ifast.top 的标签页（先打开并登录）');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result || m); pend.delete(m.id); } });
  await new Promise((r, rej) => { ws.addEventListener('open', r); setTimeout(() => rej(new Error('CDP 连接超时')), 8000); });
  const send = (m, p) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); setTimeout(() => r(null), 20000); });
  try {
    await send('Network.enable');
    const ck = await send('Network.getCookies', { urls: [BASE + '/'] });
    const cookies = (ck && ck.cookies) || [];
    if (!cookies.length) throw new Error('浏览器里没有 ifast 的 cookie（先登录 ifast.top）');
    const str = cookies.map((c) => c.name + '=' + c.value).join('; ');
    saveCookie(str);
    return { ok: true, cookie: str, count: cookies.length };
  } finally { try { ws.close(); } catch (e) {} }
}

/* ---------- 请求 ---------- */
async function req(p, opts) {
  const o = opts || {};
  const { cookie } = loadCookie();
  if (!cookie) throw new Error('还没有 ifast 登录态：先在浏览器登录 ifast.top，然后点「同步登录态」');
  const headers = { cookie, 'user-agent': 'Mozilla/5.0', 'x-requested-with': 'XMLHttpRequest' };
  let body;
  if (o.json) { headers['content-type'] = 'application/json'; body = JSON.stringify(o.json); }
  else if (o.form) {
    headers['content-type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
    body = new URLSearchParams(o.form).toString();
  }
  const ac = new AbortController();
  const tid = setTimeout(() => ac.abort(), o.timeoutMs || 25000);
  let r, text;
  try {
    r = await fetch(BASE + p, { method: o.method || (body ? 'POST' : 'GET'), headers, body, signal: ac.signal });
    text = await r.text();
  } finally { clearTimeout(tid); }
  let j = null;
  try { j = JSON.parse(text); } catch (e) { /* 非 JSON = 被踢回登录页 */ }
  if (!j) throw new Error('ifast 返回的不是 JSON（登录态可能已过期，请重新同步 Cookie）');
  if (j.code !== 0 && j.code !== '' && j.code !== undefined && j.code !== null) {
    const err = new Error(j.msg || ('ifast 返回 code=' + j.code));
    err.code = j.code; err.msg = j.msg;
    throw err;
  }
  return j;
}

/* ---------- 读 ---------- */
async function shops(force) {
  if (!force && cache.shops && Date.now() - cache.at < CACHE_MS) return cache.shops;
  const j = await req('/amazon/selling//user/selling.json');
  cache.shops = (j.data || []).map((s) => ({
    id: String(s.id), name: s.name, offSaleDesc: s.offSaleDesc || '', onSaleDesc: s.onSaleDesc || '',
    offSaleTime: s.offSaleTime || '', onSaleTime: s.onSaleTime || '', status: s.status,
  }));
  cache.at = Date.now();
  return cache.shops;
}
async function sites(force) {
  if (!force && cache.sites && Date.now() - cache.at < CACHE_MS) return cache.sites;
  const j = await req('/amazon/site/enable');
  cache.sites = (j.data || []).map((s) => ({ id: String(s.id), country: s.country }));
  cache.at = Date.now();
  return cache.sites;
}
function siteIdOf(sitesList, site) {
  const c = String(site || '').toUpperCase() === 'UK' ? 'GB' : String(site || '').toUpperCase();
  const hit = (sitesList || []).find((s) => String(s.country).toUpperCase() === c);
  return hit ? hit.id : null;
}
async function listItems(q) {
  const p = new URLSearchParams();
  p.set('page', String(q.page || 1));
  p.set('limit', String(q.limit || 50));
  ['asinSearch', 'searchName', 'siteId', 'sellingId', 'priceType', 'buyBoxType', 'subUserId', 'minCreateTime', 'maxCreateTime'].forEach((k) => {
    if (q[k] != null && q[k] !== '') p.set(k, String(q[k]));
  });
  const j = await req('/amazon/selling/item/item_list.json?' + p.toString());
  return { total: j.count || 0, items: j.data || [] };
}
/* 子账号（可上架的操作员）*/
async function subUsers() {
  const j = await req('/member/user/sub/available.json');
  return j.data || [];
}

async function asinSearch(asin, country) {
  const j = await req('/amazon/tool/asin_search.json', { form: { asin, country: country || '' } });
  return j.data || [];
}

/* ---------- 写 ---------- */
async function addItems(o) {
  const body = {
    siteId: String(o.siteId), sellingId: String(o.sellingId || ''),
    stock: String(o.stock == null ? 100 : o.stock),
    fulfillmentLatency: String(o.fulfillmentLatency == null ? 5 : o.fulfillmentLatency),
    remark: o.remark || '', onOff: String(o.onOff == null ? 1 : o.onOff),
    items: (o.items || []).map((x) => ({
      asin: String(x.asin).toUpperCase(), sku: x.sku || '',
      initPrice: x.initPrice == null ? '' : String(x.initPrice),
      lowerPrice: x.lowerPrice == null ? '' : String(x.lowerPrice),
      title: x.title || '', brand: x.brand || '', image: x.image || '', type: x.type || '',
    })),
  };
  const j = await req('/amazon/selling/item/product_add.json', { json: body });
  return { added: j.data || 0, raw: j };
}
async function upload(ids) {
  const j = await req('/amazon/selling/item/item_upload.json', { json: ids.map(Number) });
  return { ok: true, raw: j };
}
async function onOff(ids, status) {
  const form = { status: String(status) };
  ids.forEach((x, i) => { form['ids[' + i + ']'] = String(x); });
  const j = await req('/amazon/selling/item/batch/item_on_off.json', { form });
  return { ok: true, raw: j };
}
async function pause(ids) { return req('/amazon/selling/item/item_pause.json', { json: ids.map(Number) }); }
async function remove(id) { return req('/amazon/selling/item/item_delete.json', { form: { id: String(id) } }); }
async function setSelling(ids, sellingId) {
  return req('/amazon/selling/item/batch/selling_edit.json', { json: { ids: ids.map(Number), sellingId: String(sellingId) } });
}

/** 查重：这批 ASIN 在该站点是否已存在 */
async function duplicates(asins, siteId) {
  const out = {};
  for (const a of asins) {
    try {
      const r = await listItems({ page: 1, limit: 5, asinSearch: String(a).toUpperCase(), siteId });
      const hit = (r.items || []).find((x) => String(x.asin || '').toUpperCase() === String(a).toUpperCase());
      if (hit) out[String(a).toUpperCase()] = { id: hit.id, itemStatus: hit.itemStatus, siteId: hit.siteId };
    } catch (e) { /* 查不到就当不存在 */ }
  }
  return out;
}

async function status() {
  const { cookie, at } = loadCookie();
  const out = { ok: false, cookieSet: !!cookie, cookieAt: at, shops: [], sites: [], error: null };
  if (!cookie) { out.error = '还没有保存 ifast 登录态'; return out; }
  try {
    out.shops = await shops(true);
    out.sites = await sites(true);
    out.ok = true;
  } catch (e) { out.error = String((e && e.message) || e).slice(0, 200); }
  return out;
}

module.exports = {
  subUsers,
  BASE, loadCookie, saveCookie, captureCookieFromBrowser, status,
  shops, sites, siteIdOf, listItems, asinSearch,
  addItems, upload, onOff, pause, remove, setSelling, duplicates,
};

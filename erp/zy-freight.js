'use strict';
/**
 * zy-freight.js —— 实时向智赢数据源取运价（不落地静态表、不需要登录）
 *
 * 实测结论（A 路线逆向）：
 *   · 抓到的 mpush.select(name=ZYWL) 帧可**独立重放**，不需要先登录；
 *   · 服务器直接返回实时渠道费率表（约 176KB，50 个渠道）；
 *   · 价格算法：price = (fee + price_per × ceil(weightG / per)) × 1.14
 *
 * 只需保存一帧（62 字节）。帧失效（响应变小）时提示重新抓包。
 */
const net = require('net');
const fs = require('fs');
const path = require('path');
const os = require('os');

const DATA = process.env.ZYING_DATA || path.join(os.homedir(), '.zying-erp', 'data');
function ensureSurchargeSeed() {
  try {
    const f = path.join(DATA, 'zy-freight-surcharge.json');
    if (!fs.existsSync(f)) {
      fs.mkdirSync(DATA, { recursive: true });
      fs.writeFileSync(f, JSON.stringify({ '云途普货': 40 }, null, 1), 'utf8');
    }
  } catch (e) {}
}
const FRAME_FILE = path.join(DATA, 'zy-zywl-frame.json');
const SERVER = { host: '47.119.36.166', port: 7735 };
const K = 1.14;                    // 校准系数（燃油/服务费 14%）
const TTL_MS = 10 * 60 * 1000;     // 表缓存 10 分钟
const SURCHARGE_FILE = path.join(DATA, 'zy-freight-surcharge.json');
/** 渠道附加费（元/票）：{"云途普货":40, "云途普货@DE":40} */
function loadSurcharge() {
  try { return JSON.parse(fs.readFileSync(SURCHARGE_FILE, 'utf8')) || {}; } catch (e) { return {}; }
}
function saveSurcharge(obj) {
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(SURCHARGE_FILE, JSON.stringify(obj, null, 1), 'utf8');
  cache = { at: 0, channels: null };
  return obj;
}
function surchargeOf(channel, country) {
  const m = loadSurcharge();
  return Number(m[channel + '@' + country] != null ? m[channel + '@' + country] : (m[channel] || 0)) || 0;
}

/* 默认帧（本次抓包所得；可通过 /api/zy/freight/frame 覆盖） */
const DEFAULT_FRAME = Buffer.from(
  '52450000c551f4c03d796140a88d87dadf69cd29137212c1a2f7bf469eda1f5194bc91c1' +
  '0c6d707573682e73656c656374046e616d65040000005a59574c', 'hex');

ensureSurchargeSeed();
let cache = { at: 0, channels: null };
let lastError = null;

/* ---------- 帧存取 ---------- */
function loadFrame() {
  try {
    const j = JSON.parse(fs.readFileSync(FRAME_FILE, 'utf8'));
    if (j.frame) return { frame: Buffer.from(j.frame, 'base64'), at: j.at || null };
  } catch (e) {}
  return { frame: DEFAULT_FRAME, at: null };
}
function saveFrame(buf, meta) {
  fs.mkdirSync(DATA, { recursive: true });
  const rec = { frame: Buffer.from(buf).toString('base64'), at: new Date().toISOString(), meta: meta || null };
  fs.writeFileSync(FRAME_FILE, JSON.stringify(rec, null, 1), 'utf8');
  try { fs.chmodSync(FRAME_FILE, 0o600); } catch (e) {}
  cache = { at: 0, channels: null };
  return rec;
}

/* ---------- 帧/解析工具 ---------- */
const wrap = (b) => { const h = Buffer.alloc(5); h[0] = 0x4d; h.writeUInt32LE(b.length, 1); return Buffer.concat([h, b]); };
function splitFrames(buf) {
  const out = []; let i = 0;
  while (i + 6 <= buf.length) {
    const m = buf[i];
    if (m === 0x63 || m === 0x4d) {
      const len = buf.readUInt32LE(i + 2);
      if (len > 0 && len < 3e6 && i + 6 + len <= buf.length) { out.push({ len, payload: buf.slice(i + 6, i + 6 + len) }); i += 6 + len; continue; }
    }
    i++;
  }
  return out;
}
function balanced(text, from) {
  let d = 0, s = -1;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (c === '{') { if (d === 0) s = i; d++; }
    else if (c === '}') { d--; if (d === 0 && s >= 0) return { s: text.slice(s, i + 1), end: i + 1 }; }
  }
  return null;
}
function looseJson(s) {
  const fixed = s
    .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":')
    .replace(/:\s*([A-Za-z][A-Za-z0-9_]*)\s*([,}\]])/g, ':"$1"$2');
  try { return JSON.parse(fixed); } catch (e) { return null; }
}
function cleanName(raw) {
  return String(raw || '')
    .replace(/[\u0000-\u001f]/g, ' ')
    .replace(/[^\u4e00-\u9fa5A-Za-z0-9（）()\-\/\.,\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);
}
/** 短名：去掉开头编码、取第一个 '-' 前、去尾部括号编码 → 云途普货 / CNE普货8 / 4PX标准带电 */
function shortName(longName) {
  let s = String(longName || '').trim();
  const i = s.indexOf('-');
  if (i > 0) s = s.slice(0, i);
  s = s.replace(/\s*\([A-Z0-9]{3,10}\)\s*$/, '').trim();
  return s.slice(0, 24).trim();
}
function parseChannels(body) {
  /* 逐行解析 + 自动重同步：
   *   行 = id(u32) + 名称(u32 len + UTF-8) + 规则(u32 len + JSON) + [可选尾部串]
   *   规则结束后向后最多 400 字节找下一个合法行头，避免字段差异导致错位
   */
  const text = body.toString('latin1');
  const fi = text.indexOf('freetax');
  if (fi < 0) return [];

  function validRowAt(q) {
    if (q + 8 > body.length) return null;
    const nlen = body.readUInt32LE(q + 4);
    if (nlen < 4 || nlen > 300 || q + 8 + nlen > body.length) return null;
    let name;
    try { name = new TextDecoder('utf-8', { fatal: true }).decode(body.slice(q + 8, q + 8 + nlen)); } catch (e) { return null; }
    if (!/[\u4e00-\u9fa5]/.test(name)) return null;
    const rq = q + 8 + nlen;
    if (rq + 4 > body.length) return null;
    const rlen = body.readUInt32LE(rq);
    if (rlen < 8 || rlen > 400000 || rq + 4 + rlen > body.length) return null;
    const rt = body.slice(rq + 4, rq + 4 + rlen).toString('latin1');
    if (rt[0] !== '{') return null;
    return { id: body.readUInt32LE(q), name, rlen, ruleText: rt, next: rq + 4 + rlen };
  }

  const rows = [];
  let p = fi + 8;
  for (let guard = 0; guard < 4000; guard++) {
    let row = validRowAt(p);
    if (!row) {
      /* 重同步：向后 400 字节找下一个合法行头 */
      let found = null;
      for (let off = 1; off <= 400 && p + off + 8 < body.length; off++) {
        const cand = validRowAt(p + off);
        if (cand) { found = { pos: p + off, row: cand }; break; }
      }
      if (!found) break;
      p = found.pos; row = found.row;
    }
    p = row.next;
    const rule = looseJson(row.ruleText);
    if (!rule) continue;
    const countries = {};
    for (const k of Object.keys(rule)) {
      if (['len', 'spec', 'type', 'cur', 'name', 'round', 'total', 'maxsides', 'factor'].includes(k)) continue;
      const v = rule[k];
      if (v && typeof v === 'object' && (v.ws || v.first != null)) countries[k] = v;
    }
    if (!Object.keys(countries).length) continue;
    const first = Object.values(countries)[0] || {};
    rows.push({
      id: row.id,
      name: shortName(cleanName(row.name)) || cleanName(row.name),
      nameFull: cleanName(row.name),
      factor: first.factor || 8000,
      countryCount: Object.keys(countries).length,
      countries,
    });
  }
  const map = new Map();
  for (const c of rows) {
    const prev = map.get(c.name);
    if (!prev) { map.set(c.name, c); continue; }
    prev.countries = Object.assign({}, c.countries, prev.countries);
    prev.countryCount = Object.keys(prev.countries).length;
  }
  return [...map.values()];
}

/* ---------- 实时取表 ---------- */
function fetchChannels(opts) {
  const o = opts || {};
  if (!o.refresh && cache.channels && Date.now() - cache.at < TTL_MS) return Promise.resolve(cache.channels);
  const lf = loadFrame();
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: SERVER.host, port: SERVER.port });
    let acc = Buffer.alloc(0), done = false;
    const finish = (err, val) => {
      if (done) return; done = true;
      try { sock.destroy(); } catch (e) {}
      if (err) { lastError = String(err.message || err); return reject(err); }
      cache = { at: Date.now(), channels: val }; lastError = null; resolve(val);
    };
    sock.setTimeout(15000, () => finish(new Error('智赢服务器超时（帧可能失效）')));
    sock.on('error', (e) => finish(new Error('连接智赢失败: ' + e.message)));
    sock.on('data', (d) => { acc = Buffer.concat([acc, d]); });
    sock.on('connect', () => {
      sock.write(wrap(lf.frame));
      setTimeout(() => {
        const fr = splitFrames(acc);
        if (!fr.length) return finish(new Error('智赢无响应（抓包帧已失效，需要重新抓一次）'));
        const body = fr[fr.length - 1].payload.slice(36);
        const channels = parseChannels(body);
        if (channels.length < 3) {
          return finish(new Error('运价表异常（仅 ' + channels.length + ' 条，帧可能失效；重新抓包即可）'));
        }
        finish(null, channels);
      }, 6000);
    });
  });
}

/* ---------- 算价 ---------- */
function pickTier(rule, w) {
  const ws = (rule.ws || []).slice().sort((a, b) => a.max - b.max);
  for (const t of ws) if (w <= t.max) return t;
  return ws[ws.length - 1] || null;
}
function priceOf(rule, weightG, channel, country) {
  const t = pickTier(rule, weightG);
  if (!t) return null;
  const per = Number(t.per) || 100;
  const base = (Number(t.fee || 0) + Number(t.price || 0) * Math.ceil(weightG / per)) * K;
  const extra = surchargeOf(channel, country);
  return Math.round((base + extra) * 100) / 100;
}
async function quote(country, weightG, opts) {
  const channels = await fetchChannels(opts);
  const ct = String(country || '').toUpperCase();
  const w = Number(weightG) || 0;
  const list = [];
  for (const c of channels) {
    const rule = c.countries[ct];
    if (!rule) continue;
    const p = priceOf(rule, w, c.name, ct);
    if (p == null) continue;
    const t = pickTier(rule, w);
    list.push({
      channel: c.name, channelFull: c.nameFull || c.name, country: ct, weightG: w, price: p,
      surcharge: surchargeOf(c.name, ct),
      fee: Number(t.fee) || 0, pricePer: Number(t.price) || 0, per: Number(t.per) || 100,
      firstG: rule.first || null, factor: c.factor || 8000,
      maxLength: rule.maxlength || null, maxWidth: rule.maxwidth || null, maxHeight: rule.maxheight || null,
    });
  }
  list.sort((a, b) => a.price - b.price);
  return { country: ct, weightG: w, k: K, count: list.length, channels: list, fetchedAt: new Date(cache.at).toISOString() };
}

function status() {
  const lf = loadFrame();
  return {
    ok: !!lf.frame,
    frameAt: lf.at,
    frameBytes: lf.frame ? lf.frame.length : 0,
    cacheAt: cache.at ? new Date(cache.at).toISOString() : null,
    cachedChannels: cache.channels ? cache.channels.length : 0,
    ttlSec: Math.round(TTL_MS / 1000),
    lastError,
  };
}

module.exports = { loadFrame, saveFrame, fetchChannels, quote, priceOf, status, parseChannels, K, DEFAULT_FRAME,
  loadSurcharge, saveSurcharge, surchargeOf, ensureSurchargeSeed };

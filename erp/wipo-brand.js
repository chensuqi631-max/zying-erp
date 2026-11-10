/**
 * WIPO Global Brand Database 客户端 —— 纯 HTTP，无需浏览器
 * =============================================================================
 * 逆向自 branddb.wipo.int 前端（实测 2026-10 通过，覆盖 EM/GB/AU/US/DE/FR… 全部局别，
 * 包含马德里国际注册 WO —— 这是本机唯一能查「英国/澳洲」的商标源）。
 *
 * 握手流程：
 *   1) GET  /captcha?t=<sessionId>        → Altcha 工作量证明挑战 {algorithm,challenge,salt,signature,maxnumber}
 *   2) 本地暴力解 PoW: sha256(salt + n) === challenge，n ∈ [0, maxnumber]
 *   3) GET  /dbinfo?token=<base64(解)>    → 200 即会话激活成功（同时下发有效会话）
 *   4) POST /search                       → 返回 base64 密文，AES 解密后是 JSON
 *
 * ★ 解密必须用 crypto-js（已内置在 ./vendor/crypto-js.js）：
 *   密钥字符串 = "8?)i_~Nk6qv0IX;2" + guid，长度 84 字节(21 个 32 位字)，
 *   走的是 crypto-js 的「变长密钥 → 轮数 = 字数 + 6 = 27 轮」实现，不是标准 AES-256，
 *   Node 内置 crypto 只有 16/24/32 字节密钥，解不开（实测全部 bad decrypt）。
 *
 * ★ 砖块语法（实测）：
 *     文本字段（brandName/applicant）必须带 strategy（Simple/Fuzzy/Phonetic）；
 *     枚举字段（office/status/niceClass）不能带 strategy，且只能单值。
 *
 * ★ 礼貌：全局限速 ≥2s/次（1.1s 会被限流），会话约 10 次后自动重建，401 自动重试。
 * =============================================================================
 */
'use strict';

const crypto = require('crypto');
const CryptoJS = require('./vendor/crypto-js.js');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0';
const API = 'https://api.branddb.wipo.int';
const ORIGIN = 'https://branddb.wipo.int';
const KEY_PREFIX = '8?)i_~Nk6qv0IX;2';       // 16 字符固定前缀，后面拼 HashSearch 的 guid
const MIN_INTERVAL_MS = Number(process.env.ZY_WIPO_MIN_GAP || 2000);
const REQ_TIMEOUT_MS = Number(process.env.ZY_WIPO_TIMEOUT || 20000);
const MAX_CALLS_PER_SESSION = 10;            // 实测约 10~15 次后会话失效
const SEARCH_PAGE_URL = 'https://branddb.wipo.int/en/similarname';

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const b64url = (buf) => buf.toString('base64').replace(/[+/=]/g, (c) => ({ '+': '-', '/': '_', '=': '' }[c]));
function newGuid() {
  const p8 = () => (Math.random().toString(16) + '000000000').substring(2, 10);
  return p8() + p8() + '-' + p8() + '-' + p8() + '-' + p8() + '-' + p8() + p8() + p8();
}
function safeJson(t) { try { return JSON.parse(t); } catch (e) { return null; } }

/** 带超时的 fetch（WIPO 偶发挂起，不能让一次请求拖死整个查重） */
async function fx(url, init = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => { try { ac.abort(); } catch (e) { /* ignore */ } }, REQ_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }
}

let _lastCall = 0;
async function throttle() {
  const wait = MIN_INTERVAL_MS - (Date.now() - _lastCall);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  _lastCall = Date.now();
}

/** 建会话: 解 Altcha PoW → /dbinfo?token= 激活 */
async function openSession() {
  const sid = Date.now() + '|' + b64url(crypto.randomBytes(24));
  const g = newGuid();
  const headers = {
    'User-Agent': UA, Origin: ORIGIN, Referer: ORIGIN + '/', HashSearch: g,
    Cookie: 'session_id=' + sid, Accept: 'application/json, text/plain, */*',
  };
  const capRes = await fx(`${API}/captcha?t=${encodeURIComponent(sid)}`, { headers });
  const capTxt = await capRes.text();
  const cap = safeJson(capTxt);
  if (!cap || !cap.challenge) throw new Error('WIPO 没拿到 captcha 挑战: ' + String(capTxt).slice(0, 120));

  let number = -1;
  const maxn = Number(cap.maxnumber || 100000);
  for (let n = 0; n <= maxn; n++) { if (sha256(cap.salt + n) === cap.challenge) { number = n; break; } }
  if (number < 0) throw new Error('WIPO PoW 解不出 (maxnumber=' + maxn + ')');

  const token = Buffer.from(JSON.stringify({
    algorithm: cap.algorithm, challenge: cap.challenge, number, salt: cap.salt, signature: cap.signature, took: 1,
  })).toString('base64');
  const dRes = await fx(`${API}/dbinfo?token=${encodeURIComponent(token)}`, { headers });
  const dTxt = await dRes.text();
  if (dRes.status !== 200) throw new Error('WIPO /dbinfo 激活失败: HTTP ' + dRes.status + ' ' + String(dTxt).slice(0, 120));
  return { sid, guid: g, headers, aesKey: KEY_PREFIX + g };
}

let _session = null;
let _sessionCalls = 0;
async function getSession(force) {
  if (force || !_session || _sessionCalls >= MAX_CALLS_PER_SESSION) {
    _session = await openSession();
    _sessionCalls = 0;
  }
  return _session;
}

/** 解密 /search 响应（AES-ECB，crypto-js 变长密钥实现） */
function decrypt(ct, keyStr) {
  const key = CryptoJS.enc.Utf8.parse(keyStr);
  for (const cfg of [{ mode: CryptoJS.mode.ECB }, { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 }]) {
    try {
      const plain = CryptoJS.AES.decrypt(ct, key, cfg).toString(CryptoJS.enc.Utf8);
      if (plain && plain.trim().startsWith('{')) return JSON.parse(plain);
    } catch (e) { /* 试下一种 */ }
  }
  return null;
}

/**
 * 检索商标。
 * @param {string} term 品牌名 / 关键词
 * @param {Object} opts { rows, start, strategy:'Simple'|'Fuzzy'|'Phonetic', office, status, niceClass }
 * @returns {Promise<{numFound:number, docs:Array, mode:string}>}
 */
async function searchBrand(term, opts = {}) {
  const brand = String(term || '').trim();
  if (!brand) throw new Error('关键词不能为空');
  const rows = String(opts.rows != null ? opts.rows : 30);
  const start = String(opts.start != null ? opts.start : 0);
  const strategy = opts.strategy || 'Simple';

  const bricks = [{ key: 'brandName', value: brand, strategy }];
  if (opts.office) bricks.push({ key: 'office', value: String(opts.office) });
  if (opts.status) bricks.push({ key: 'status', value: String(opts.status) });
  if (opts.niceClass != null) bricks.push({ key: 'niceClass', value: String(opts.niceClass) });

  const body = JSON.stringify({
    sort: 'score desc', rows, start,
    asStructure: JSON.stringify({ boolean: 'AND', bricks }),
    fg: '_void_',
  });

  for (let attempt = 1; attempt <= 3; attempt++) {
    const s = await getSession(attempt > 1);
    await throttle();
    const r = await fx(`${API}/search`, {
      method: 'POST',
      headers: { ...s.headers, 'Content-Type': 'application/json' },
      body,
    });
    const ct = await r.text();
    if (r.status === 401 && attempt < 3) { _session = null; _sessionCalls = 0; continue; }  // 会话失效 → 重建
    _sessionCalls++;
    if (r.status !== 200) throw new Error('WIPO HTTP ' + r.status + ' ' + String(ct).slice(0, 120));
    const json = decrypt(ct, s.aesKey);
    if (!json) throw new Error('WIPO 响应解密失败 (ctLen=' + ct.length + ')');
    const resp = json.response || json;
    const docs = (resp.docs || []).map((d) => ({
      brandName: Array.isArray(d.brandName) ? d.brandName.join(' / ') : (d.brandName || ''),
      office: d.office || '',
      status: d.status || '',
      niceClass: Array.isArray(d.niceClass) ? d.niceClass.map(Number) : [],
      applicant: Array.isArray(d.applicant) ? d.applicant.join(' / ') : (d.applicant || ''),
      registrationNumber: d.registrationNumber || '',
      registrationDate: d.registrationDate || '',
      applicationNumber: d.applicationNumber || '',
      applicationDate: d.applicationDate || '',
      expiryDate: d.expiryDate || '',
      designation: Array.isArray(d.designation) ? d.designation : [],
      type: d.type || '',
      markFeature: d.markFeature || '',
      st13: d.st13 || '',
      score: d.score || 0,
      collection: d.collection || '',
    }));
    return { numFound: resp.numFound != null ? resp.numFound : (json.numFound || docs.length), docs, mode: 'ECB' };
  }
  throw new Error('WIPO 连续 401，会话无法建立');
}

/** 会话状态（给 /api/ip/providers 展示用，不发请求） */
function sessionInfo() {
  return { active: !!_session, calls: _sessionCalls, maxCalls: MAX_CALLS_PER_SESSION, minGapMs: MIN_INTERVAL_MS };
}

module.exports = { searchBrand, openSession, getSession, decrypt, sessionInfo, SEARCH_PAGE_URL, MIN_INTERVAL_MS };

/* ===== 自测: node wipo-brand.js Anker ===== */
if (require.main === module) {
  (async () => {
    const term = process.argv[2] || 'Anker';
    const t0 = Date.now();
    const r = await searchBrand(term, { rows: Number(process.argv[3] || 5) });
    console.log(`[wipo] ${term} numFound=${r.numFound} 返回=${r.docs.length} 耗时=${Date.now() - t0}ms`);
    console.log(JSON.stringify(r.docs.slice(0, 3), null, 1));
  })().catch((e) => { console.error(JSON.stringify({ error: e && e.message })); process.exit(1); });
}

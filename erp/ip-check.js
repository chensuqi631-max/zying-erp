/**
 * 知识产权查重 (IP Check) — 直连官方商标 / 外观设计库
 * =============================================================================
 * 目的: 上架前的合规风控。用商品品牌名 / 标题关键词 / 外观图，去官方库里查
 *       「这个名字/这个外观有没有被人注册过」，避免侵权下架。
 *
 * ★ 关键结论(实测 2026-10): 官方库分两类 ——
 *
 *   【可以直接调接口，不需要浏览器】✅
 *     · TMview 全球商标库   POST https://www.tmdn.org/tmview/api/search/results
 *         —— 欧盟知识产权局运维的全球聚合库，覆盖 70+ 国家/地区局，含中国(CN)、
 *            美国(US)、欧盟(EM)、英国(GB)、日本(JP)、韩国(KR)、澳大利亚(AU)、
 *            巴西(BR)、印度(IN)、WIPO 国际注册(WO) 等。返回 JSON。
 *            ★ 一个接口 = 全球商标，这是主力数据源。
 *     · USPTO 美国商标       POST https://tmsearch.uspto.gov/prod-stage-v1-0-0/tmsearch
 *         —— 美国专利商标局官方检索前端用的就是它，Elasticsearch DSL 查询。
 *            免 Key、免验证码。信息最全(alive/registered/状态码/商品服务项)。
 *     · EUIPO 欧盟商标       POST https://euipo.europa.eu/copla/ctmsearch/json
 *     · EUIPO 共同体外观设计  POST https://euipo.europa.eu/copla/rcdsearch/json
 *         —— ★ 外观设计返回 imagegallery，能直接拿到设计图，可做视觉比对初筛。
 *
 *   【必须走浏览器自动化】⚠️
 *     · WIPO Global Brand Database   —— Altcha 工作量证明验证码(altcha.min.js)
 *     · WIPO Global Design Database  —— JSF 会话 + qz(LZ-String) 状态载荷，结果是 HTML
 *     · 中国商标网 CNIPA             —— 风控 + 需登录
 *         (中国商标已被 TMview 覆盖，所以 CNIPA 不接也不影响可用性)
 *
 * 合规与礼貌: 这些都是公共服务，本模块强制串行 + 最小间隔 + 磁盘缓存(默认 7 天)，
 *            绝不并发轰炸。缓存命中直接返回，不重复请求。
 * =============================================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');
const wipoBrand = require('./wipo-brand.js');

/* ============================ 配置 ============================ */

const DATA_DIR = process.env.ZYING_DATA ? path.resolve(process.env.ZYING_DATA) : path.join(__dirname, 'data');
const CACHE_FILE = path.join(DATA_DIR, 'ip-cache.json');
const CACHE_TTL_MS = Number(process.env.ZY_IP_CACHE_TTL || 7 * 24 * 3600 * 1000);   // 默认 7 天
const MIN_GAP_MS = Number(process.env.ZY_IP_MIN_GAP || 1200);                       // 同一站点两次请求最小间隔
const TIMEOUT_MS = Number(process.env.ZY_IP_TIMEOUT || 25000);
const RETRY = Number(process.env.ZY_IP_RETRY || 2);
const CACHE_MAX = Number(process.env.ZY_IP_CACHE_MAX || 4000);                      // 缓存条目上限

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0';

/* ============================ 数据源(局别)对照 ============================ */

const OFFICES = {
  CN: '中国', US: '美国', EM: '欧盟', GB: '英国', JP: '日本', KR: '韩国', DE: '德国', FR: '法国',
  IT: '意大利', ES: '西班牙', CA: '加拿大', AU: '澳大利亚', NZ: '新西兰', MX: '墨西哥', BR: '巴西',
  AR: '阿根廷', CL: '智利', CO: '哥伦比亚', PE: '秘鲁', PY: '巴拉圭', UY: '乌拉圭', IN: '印度',
  WO: 'WIPO 国际注册', TR: '土耳其', RU: '俄罗斯', UA: '乌克兰', PL: '波兰', PT: '葡萄牙',
  NL: '荷兰', BE: '比利时', LU: '卢森堡', AT: '奥地利', CH: '瑞士', SE: '瑞典', NO: '挪威',
  DK: '丹麦', FI: '芬兰', IE: '爱尔兰', CZ: '捷克', HU: '匈牙利', RO: '罗马尼亚', BG: '保加利亚',
  GR: '希腊', HR: '克罗地亚', SI: '斯洛文尼亚', SK: '斯洛伐克', EE: '爱沙尼亚', LV: '拉脱维亚',
  LT: '立陶宛', MT: '马耳他', CY: '塞浦路斯', IS: '冰岛', LI: '列支敦士登', MC: '摩纳哥', SM: '圣马力诺',
  RS: '塞尔维亚', ME: '黑山', MK: '北马其顿', BA: '波黑', AL: '阿尔巴尼亚', MD: '摩尔多瓦',
  GE: '格鲁吉亚', AM: '亚美尼亚', AZ: '阿塞拜疆', KZ: '哈萨克斯坦', BY: '白俄罗斯', TM: '土库曼斯坦',
  UZ: '乌兹别克斯坦', KG: '吉尔吉斯斯坦', TJ: '塔吉克斯坦', MN: '蒙古', VN: '越南', TH: '泰国',
  MY: '马来西亚', SG: '新加坡', ID: '印度尼西亚', PH: '菲律宾', KH: '柬埔寨', LA: '老挝',
  BN: '文莱', MM: '缅甸', LK: '斯里兰卡', BD: '孟加拉国', PK: '巴基斯坦', NP: '尼泊尔',
  IL: '以色列', JO: '约旦', SA: '沙特', AE: '阿联酋', QA: '卡塔尔', KW: '科威特', BH: '巴林',
  OM: '阿曼', EG: '埃及', MA: '摩洛哥', TN: '突尼斯', DZ: '阿尔及利亚', LY: '利比亚',
  NG: '尼日利亚', KE: '肯尼亚', ZA: '南非', GH: '加纳', TZ: '坦桑尼亚', UG: '乌干达',
  ZM: '赞比亚', ZW: '津巴布韦', BW: '博茨瓦纳', NA: '纳米比亚', MU: '毛里求斯', ET: '埃塞俄比亚',
  CU: '古巴', DO: '多米尼加', GT: '危地马拉', CR: '哥斯达黎加', PA: '巴拿马', SV: '萨尔瓦多',
  HN: '洪都拉斯', NI: '尼加拉瓜', BO: '玻利维亚', EC: '厄瓜多尔', VE: '委内瑞拉', BB: '巴巴多斯',
  JM: '牙买加', TT: '特立尼达', BS: '巴哈马', BZ: '伯利兹', GD: '格林纳达', LC: '圣卢西亚',
  AG: '安提瓜', DM: '多米尼克', KN: '圣基茨', VC: '圣文森特', HT: '海地', SR: '苏里南',
  'AP': '非洲知识产权组织(OAPI)', 'OA': '非洲地区工业产权组织(ARIPO)', BX: '比荷卢',
  EA: '欧亚专利组织', GC: '海湾合作委员会', EM_ALIAS: '欧盟',
};

const officeName = (c) => OFFICES[String(c || '').toUpperCase()] || String(c || '未知');

/* ============================ ★ 亚马逊站点 → 商标管辖「按站判定」 ============================
 * 关键业务口径(用户明确要求): 我上德国站, 就只看"在德国有效的商标";
 * 上英国站, 就只看"在英国有效的商标"。别的国家有商标不影响我上这个站。
 *
 * 要做到准, 必须理解三层权利范围 —— 这是最容易搞错的地方:
 *   1) 单一国家商标:  DE 德国商标只保护德国；GB 英国商标只保护英国
 *   2) 区域商标:      ★ EM 欧盟商标(EUTM) 一次性覆盖全部 27 个成员国 —— 所以德国站
 *                     不仅要查 DE, 还要查 EM；反过来法国/意大利/西班牙站也一样
 *   3) 国际注册:      WO 马德里体系国际注册, 保护范围是"指定国清单" —— 指定了 DE
 *                     就在德国有效, 只指定了 AU/US 就跟德国无关
 *
 * TMview 每条记录都带 tProtection(保护范围)字段, 正好是判定的依据:
 *   德国商标        → ["DE"]
 *   欧盟商标        → ["AT","BE",...,"DE",...,"EM","BX"]   (27 国 + EM + BX)
 *   国际注册        → ["DE","GB","AU",...] 或 ["WO"](尚未指定)
 *   ★ 英国脱欧后欧盟商标不再覆盖英国: EUTM 的 tProtection 里没有 GB,
 *     所以英国站只查 GB + WO, 不能把 EM 算进去 —— 这是最容易多报的地方。
 *
 * offices  = 去 TMview 检索时限定哪些局(减少无用请求)
 * requires = 命中记录的保护范围里出现这些地区代码, 才算"在你这个站有风险"
 * ========================================================================== */

/** 欧盟 27 个成员国 —— 欧盟商标/共同体外观设计的保护范围 */
const EU_MEMBERS = ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT',
  'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE'];
/** 欧盟商标记录里 tProtection 出现的完整集合(27 国 + EM 自身 + BX 比荷卢) */
const EU_PROTECTION = EU_MEMBERS.concat(['EM', 'BX']);

/** 亚马逊各站点 → 商标管辖 */
const AMAZON_SITES = {
  'amazon.de': { cc: 'DE', name: '德国站', flag: '🇩🇪', region: 'EU', requires: ['DE'], offices: ['DE', 'EM', 'WO'] },
  'amazon.co.uk': { cc: 'GB', name: '英国站', flag: '🇬🇧', region: 'UK', requires: ['GB'], offices: ['GB', 'WO'] },
  'amazon.fr': { cc: 'FR', name: '法国站', flag: '🇫🇷', region: 'EU', requires: ['FR'], offices: ['FR', 'EM', 'WO'] },
  'amazon.it': { cc: 'IT', name: '意大利站', flag: '🇮🇹', region: 'EU', requires: ['IT'], offices: ['IT', 'EM', 'WO'] },
  'amazon.es': { cc: 'ES', name: '西班牙站', flag: '🇪🇸', region: 'EU', requires: ['ES'], offices: ['ES', 'EM', 'WO'] },
  'amazon.nl': { cc: 'NL', name: '荷兰站', flag: '🇳🇱', region: 'EU', requires: ['NL', 'BX'], offices: ['NL', 'BX', 'EM', 'WO'] },
  'amazon.com.be': { cc: 'BE', name: '比利时站', flag: '🇧🇪', region: 'EU', requires: ['BE', 'BX'], offices: ['BE', 'BX', 'EM', 'WO'] },
  'amazon.se': { cc: 'SE', name: '瑞典站', flag: '🇸🇪', region: 'EU', requires: ['SE'], offices: ['SE', 'EM', 'WO'] },
  'amazon.pl': { cc: 'PL', name: '波兰站', flag: '🇵🇱', region: 'EU', requires: ['PL'], offices: ['PL', 'EM', 'WO'] },
  'amazon.ie': { cc: 'IE', name: '爱尔兰站', flag: '🇮🇪', region: 'EU', requires: ['IE'], offices: ['IE', 'EM', 'WO'] },
  'amazon.com': { cc: 'US', name: '美国站', flag: '🇺🇸', region: 'NA', requires: ['US'], offices: ['US', 'WO'] },
  'amazon.ca': { cc: 'CA', name: '加拿大站', flag: '🇨🇦', region: 'NA', requires: ['CA'], offices: ['CA', 'WO'] },
  'amazon.com.mx': { cc: 'MX', name: '墨西哥站', flag: '🇲🇽', region: 'NA', requires: ['MX'], offices: ['MX', 'WO'] },
  'amazon.com.br': { cc: 'BR', name: '巴西站', flag: '🇧🇷', region: 'NA', requires: ['BR'], offices: ['BR', 'WO'] },
  'amazon.co.jp': { cc: 'JP', name: '日本站', flag: '🇯🇵', region: 'AP', requires: ['JP'], offices: ['JP', 'WO'] },
  'amazon.com.au': { cc: 'AU', name: '澳洲站', flag: '🇦🇺', region: 'AP', requires: ['AU'], offices: ['AU', 'WO'] },
  'amazon.sg': { cc: 'SG', name: '新加坡站', flag: '🇸🇬', region: 'AP', requires: ['SG'], offices: ['SG', 'WO'] },
  'amazon.in': { cc: 'IN', name: '印度站', flag: '🇮🇳', region: 'AP', requires: ['IN'], offices: ['IN', 'WO'] },
  'amazon.ae': { cc: 'AE', name: '阿联酋站', flag: '🇦🇪', region: 'ME', requires: ['AE'], offices: ['AE', 'WO'] },
  'amazon.sa': { cc: 'SA', name: '沙特站', flag: '🇸🇦', region: 'ME', requires: ['SA'], offices: ['SA', 'WO'] },
  'amazon.com.tr': { cc: 'TR', name: '土耳其站', flag: '🇹🇷', region: 'ME', requires: ['TR'], offices: ['TR', 'WO'] },
  'amazon.eg': { cc: 'EG', name: '埃及站', flag: '🇪🇬', region: 'ME', requires: ['EG'], offices: ['EG', 'WO'] },
  'amazon.co.za': { cc: 'ZA', name: '南非站', flag: '🇿🇦', region: 'AF', requires: ['ZA'], offices: ['ZA', 'WO'] },
  'amazon.cn': { cc: 'CN', name: '中国站', flag: '🇨🇳', region: 'AP', requires: ['CN'], offices: ['CN', 'WO'] },
  'amazon.com.hk': { cc: 'HK', name: '香港', flag: '🇭🇰', region: 'AP', requires: ['HK'], offices: ['HK', 'WO'] },
};

/** 站点清单(给前端渲染选择器) */
function siteList() {
  return Object.keys(AMAZON_SITES).map(function (k) {
    const s = AMAZON_SITES[k];
    return { id: k, cc: s.cc, name: s.name, flag: s.flag, region: s.region, offices: s.offices, requires: s.requires };
  });
}

/** 把选中的站点(可多选)合成一个"目标市场"对象 */
function marketFromSites(siteIds) {
  const ids = (Array.isArray(siteIds) ? siteIds : String(siteIds || '').split(','))
    .map(function (s) { return String(s).trim(); })
    .filter(function (s) { return !!AMAZON_SITES[s]; });
  if (!ids.length) return null;
  const requires = [], offices = [], names = [], flags = [];
  ids.forEach(function (id) {
    const s = AMAZON_SITES[id];
    s.requires.forEach(function (c) { if (requires.indexOf(c) < 0) requires.push(c); });
    s.offices.forEach(function (c) { if (offices.indexOf(c) < 0) offices.push(c); });
    names.push(s.name); flags.push(s.flag);
  });
  return {
    sites: ids, requires, offices,
    name: names.join(' + '),
    flag: flags.join(''),
    // 纯单一国家(没有区域局)时, 说明区域商标无关
    label: names.join(' + ') + ' → 只看在 ' + requires.join('/') + ' 有效的商标',
  };
}

/* ============================ 小工具 ============================ */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowMs = () => Date.now();

/** 查询归一化(缓存 key 用): 去空格/标点、转小写；中日韩字符保留 */
function normTerm(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/[\s\u3000]+/g, ' ')
    .replace(/[^\p{L}\p{N}\u4e00-\u9fff ]+/gu, '')
    .trim();
}

/** 严格归一化(精确比对用): 连空格都不要 */
function tight(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[^\p{L}\p{N}\u4e00-\u9fff]+/gu, '');
}

/** 毫秒时间戳 → YYYY-MM-DD */
function fmtDate(v) {
  if (v == null || v === '') return '';
  let ms = null;
  if (typeof v === 'number') ms = v > 1e12 ? v : v > 1e9 ? v * 1000 : null;
  else {
    const s = String(v);
    if (/^\d+$/.test(s)) { const n = Number(s); ms = n > 1e12 ? n : n > 1e9 ? n * 1000 : null; }
    else { const t = Date.parse(s); if (!Number.isNaN(t)) ms = t; }
  }
  if (ms == null) return String(v).slice(0, 10);
  try { return new Date(ms).toISOString().slice(0, 10); } catch { return ''; }
}

/** 带超时的 JSON/文本请求 */
async function httpJson(url, init = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal });
    const txt = await r.text();
    if (!r.ok) { const e = new Error(`HTTP ${r.status}`); e.status = r.status; e.body = txt.slice(0, 300); throw e; }
    if (!txt) { const e = new Error('空响应体'); e.status = r.status; throw e; }
    try { return JSON.parse(txt); } catch { const e = new Error('返回不是 JSON: ' + txt.slice(0, 120)); throw e; }
  } finally { clearTimeout(timer); }
}

/* ============================ 磁盘缓存 ============================ */

let cache = null;
let cacheDirty = false;
let cacheTimer = null;

function loadCache() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    if (!cache || typeof cache !== 'object' || Array.isArray(cache)) cache = {};
  } catch { cache = {}; }
  return cache;
}

function flushCache(force = false) {
  if (!cacheDirty && !force) return;
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const c = loadCache();
    // 超上限时按时间砍掉最旧的一半
    const keys = Object.keys(c);
    if (keys.length > CACHE_MAX) {
      keys.sort((a, b) => (c[a].t || 0) - (c[b].t || 0));
      keys.slice(0, keys.length - Math.floor(CACHE_MAX * 0.5)).forEach((k) => delete c[k]);
    }
    const tmp = CACHE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(c), 'utf8');
    fs.renameSync(tmp, CACHE_FILE);
    cacheDirty = false;
  } catch (e) { /* 缓存写失败不影响主流程 */ }
}

function cacheGet(key) {
  const c = loadCache();
  const it = c[key];
  if (!it) return null;
  if (nowMs() - (it.t || 0) > CACHE_TTL_MS) { delete c[key]; cacheDirty = true; return null; }
  it.hits_used = (it.hits_used || 0) + 1;
  return it.v;
}

function cacheSet(key, v) {
  const c = loadCache();
  c[key] = { t: nowMs(), v };
  cacheDirty = true;
  if (!cacheTimer) cacheTimer = setTimeout(() => { cacheTimer = null; flushCache(); }, 4000);
  if (cacheTimer.unref) cacheTimer.unref();
}

function cacheStats() {
  const c = loadCache();
  const keys = Object.keys(c);
  const fresh = keys.filter((k) => nowMs() - (c[k].t || 0) <= CACHE_TTL_MS).length;
  return { file: CACHE_FILE, total: keys.length, fresh, stale: keys.length - fresh, ttlDays: Math.round(CACHE_TTL_MS / 86400000) };
}

function cacheClear() {
  cache = {}; cacheDirty = false;
  try { if (fs.existsSync(CACHE_FILE)) fs.unlinkSync(CACHE_FILE); } catch { }
  return { ok: true };
}

/* ============================ 站点礼貌队列 ============================ */

const queues = Object.create(null);
function enqueue(host, fn) {
  const q = queues[host] || (queues[host] = { chain: Promise.resolve(), last: 0 });
  const run = q.chain.then(async () => {
    const wait = MIN_GAP_MS - (nowMs() - q.last);
    if (wait > 0) await sleep(wait);
    try { return await fn(); } finally { q.last = nowMs(); }
  });
  // 让链条不因单次失败而断
  q.chain = run.then(() => { }, () => { });
  return run;
}

async function withRetry(fn, tries = RETRY) {
  let last = null;
  for (let i = 0; i <= tries; i++) {
    try { return await fn(); }
    catch (e) {
      last = e;
      // 4xx(除 429) 不重试
      const st = e && e.status;
      if (st && st >= 400 && st < 500 && st !== 429) break;
      if (i < tries) await sleep(600 * (i + 1));
    }
  }
  throw last;
}

/* ============================ 状态归类 ============================ */

/** 商标状态原文 → alive / dead / pending / unknown */
function tmStatusGroup(statusText, extra = {}) {
  const s = String(statusText || '').toLowerCase();
  if (extra.alive === true) return extra.registered === true ? 'alive' : 'pending';
  if (extra.alive === false) return 'dead';
  if (!s) return 'unknown';
  // 失效类
  if (/ended|expired|dead|abandon|cancel|refus|withdraw|surrend|invalid|deleted|removed|ceased|revoked|注销|无效|驳回|撤回|无效|期满|终止|失效|lapsed|not\s*renewed|died/.test(s)) return 'dead';
  // 有效类
  if (/registered|registration\s*(published|in\s*force)|granted|in\s*force|renewed/.test(s)) return 'alive';
  // 中间态
  if (/filed|application|examin|published|opposition|pending|appeal|accepted|under|待审|审查|公告|异议|申请/.test(s)) return 'pending';
  return 'unknown';
}

/** 外观设计状态 */
function designStatusGroup(statusText) {
  const s = String(statusText || '').toLowerCase();
  if (!s) return 'unknown';
  if (/expired|lapsed|cancel|invalid|refus|withdraw|surrend|deleted|terminated|ended|失效|无效|终止|注销/.test(s)) return 'dead';
  if (/registered|in\s*force|published|granted|有效|注册/.test(s)) return 'alive';
  if (/filed|application|examin|pending|待审|审查|申请/.test(s)) return 'pending';
  return 'unknown';
}

/* ============================ 数据源 1: TMview 全球商标 ============================ */

const TMVIEW_HEADERS = {
  'content-type': 'application/json', 'user-agent': UA,
  origin: 'https://www.tmdn.org', referer: 'https://www.tmdn.org/tmview/',
};
const TMVIEW_API = 'https://www.tmdn.org/tmview/api/search/results';

function mapTmviewRow(t) {
  return {
    source: 'tmview', sourceName: 'TMview 全球商标库',
    kind: 'trademark',
    id: t.ST13 || t.applicationNumber || '',
    title: t.tmName || '',
    type: t.tradeMarkType || '',
    office: t.tmOffice || '', officeName: officeName(t.tmOffice),
    protection: t.tProtection || [],
    status: t.tradeMarkStatus || '', statusGroup: tmStatusGroup(t.tradeMarkStatus),
    owner: (t.applicantName || [])[0] || '',
    nice: (t.niceClass || []).map(Number),
    filed: fmtDate(t.applicationDate), registered: '', expiry: '',
    images: [], detailUrl: t.tmOfficeURL || '',
    mediaUrl: t.tmOfficeURL || '',
  };
}

async function searchTmview(term, opts = {}) {
  /* pageSize 下限给到 50(而不是直接用显示条数): TMview 按相关度排序, 精确同名排在最前,
   * 但"去掉空格后同名"的写法(如 AIRFRYER vs AIR FRYER)可能排在后面 —— 多拿一点更保险。
   * 市场口径下命中总数通常很小(德国站 "air fryer" 只有 20 条), 成本可以忽略。 */
  const pageSize = Math.max(50, Math.min(100, Number(opts.limit) || 30));
  const fOffices = Array.isArray(opts.offices) && opts.offices.length ? opts.offices : [];
  const niceClass = Array.isArray(opts.nice) && opts.nice.length ? opts.nice.map(String) : null;

  const key = 'tmview|' + normTerm(term) + '|' + (fOffices.join(',') || '*') + '|' + ((niceClass || []).join(',') || '*') + '|' + pageSize;
  const hit = cacheGet(key);
  if (hit) return { ...hit, cached: true };

  const body = { page: String(opts.page || 1), pageSize: String(pageSize), criteria: 'C', basicSearch: term, fOffices };
  if (niceClass) body.niceClass = niceClass;

  const d = await enqueue('tmdn.org', () => withRetry(() => httpJson(TMVIEW_API, {
    method: 'POST', headers: TMVIEW_HEADERS, body: JSON.stringify(body),
  })));

  let rows = (d.tradeMarks || []).slice();
  const totalAll = d.totalResults || 0;

  /* ★ 关键: 结果被截断时必须补一次「精确匹配」查询。
   * 否则同名商标一旦排在第 pageSize 名之后, 就会被判成"没风险" —— 这是最危险的漏判。
   * criteria:'E' 是精确口径(实测 "air fryer" 由 20 条收敛到 3 条), 拿它兜底最省事。 */
  let exactAdded = 0;
  if (totalAll > rows.length) {
    try {
      const bodyE = Object.assign({}, body, { criteria: 'E', pageSize: '100' });
      const dE = await enqueue('tmdn.org', () => withRetry(() => httpJson(TMVIEW_API, {
        method: 'POST', headers: TMVIEW_HEADERS, body: JSON.stringify(bodyE),
      })));
      const have = new Set(rows.map((x) => (x.ST13 || '') + '|' + (x.tmName || '')));
      (dE.tradeMarks || []).forEach((x) => {
        const k = (x.ST13 || '') + '|' + (x.tmName || '');
        if (have.has(k)) return;
        have.add(k); rows.push(x); exactAdded++;
      });
    } catch (e) { /* 兜底查询失败不影响主流程 */ }
  }

  const items = rows.map(mapTmviewRow);
  const out = {
    source: 'tmview', sourceName: 'TMview 全球商标库',
    total: totalAll, totalPages: d.totalPages || 0, items, cached: false,
    exactAdded, truncated: totalAll > (d.tradeMarks || []).length,
  };
  cacheSet(key, out);
  return out;
}

/* ============================ 数据源 2: USPTO 美国商标 ============================ */

async function searchUspto(term, opts = {}) {
  const size = Math.max(1, Math.min(100, Number(opts.limit) || 30));
  const q = { bool: { must: [{ match_phrase: { WM: { query: term, boost: 5 } } }] } };
  const filters = [];
  if (opts.aliveOnly) filters.push({ term: { alive: true } });
  if (opts.registeredOnly) filters.push({ term: { registered: true } });
  if (filters.length) q.bool.filter = filters;

  const key = 'uspto|' + normTerm(term) + '|' + size + '|' + (opts.aliveOnly ? 'A' : '') + (opts.registeredOnly ? 'R' : '');
  const hit = cacheGet(key);
  if (hit) return { ...hit, cached: true };

  const d = await enqueue('tmsearch.uspto.gov', () => withRetry(() => httpJson('https://tmsearch.uspto.gov/prod-stage-v1-0-0/tmsearch', {
    method: 'POST',
    headers: {
      'content-type': 'application/json', 'user-agent': UA,
      origin: 'https://tmsearch.uspto.gov', referer: 'https://tmsearch.uspto.gov/search/search-information',
    },
    body: JSON.stringify({
      query: q, size, from: 0,
      _source: ['id', 'wordmark', 'alive', 'registered', 'statusCode', 'statusDescription', 'internationalClass',
        'ownerName', 'filedDate', 'registrationDate', 'abandonDate', 'markType', 'designCodeDescription',
        'goodsAndServices', 'markDescription', 'standardCharacterClaim'],
    }),
  })));

  let items = (d.hits?.hits || []).map((h) => {
    const s = h.source || {};
    const st = tmStatusGroup(s.statusDescription, { alive: s.alive, registered: s.registered });
    return {
      source: 'uspto', sourceName: 'USPTO 美国专利商标局',
      kind: 'trademark',
      id: s.id || h.id || '', title: s.wordmark || (s.markDescription || [])[0] || '(图形商标)',
      type: (s.markType || [])[0] || '', office: 'US', officeName: '美国',
      protection: ['US'],
      status: s.statusDescription || '', statusCode: s.statusCode || null, statusGroup: st,
      alive: !!s.alive, registered: !!s.registered,
      owner: (s.ownerName || [])[0] || '',
      nice: (s.internationalClass || []).map((x) => parseInt(String(x).replace(/[^0-9]/g, ''), 10)).filter(Boolean),
      filed: fmtDate(s.filedDate), registered_date: fmtDate(s.registrationDate),
      registeredAt: fmtDate(s.registrationDate), abandoned: fmtDate(s.abandonDate),
      goods: (s.goodsAndServices || []).slice(0, 3),
      images: [], detailUrl: s.id ? `https://tsdr.uspto.gov/#caseNumber=${s.id}&caseSearchType=US_APPLICATION&caseType=DEFAULT&searchType=statusSearch` : '',
      mediaUrl: s.id ? `https://tsdr.uspto.gov/#caseNumber=${s.id}&caseSearchType=US_APPLICATION&caseType=DEFAULT&searchType=statusSearch` : '',
    };
  });

  // USPTO 的 internationalClass 是分词字段，term 过滤会失效 → 本地按尼斯分类过滤
  if (Array.isArray(opts.nice) && opts.nice.length) {
    const want = new Set(opts.nice.map(Number));
    items = items.filter((it) => it.nice.some((n) => want.has(n)));
  }

  const out = {
    source: 'uspto', sourceName: 'USPTO 美国专利商标局',
    total: d.hits?.totalValue || 0, items, cached: false,
  };
  cacheSet(key, out);
  return out;
}

/* ============================ 数据源 3: EUIPO 欧盟商标 ============================ */

async function searchEuipoTm(term, opts = {}) {
  const rows = Math.max(1, Math.min(100, Number(opts.limit) || 30));
  const key = 'euipo-tm|' + normTerm(term) + '|' + rows;
  const hit = cacheGet(key);
  if (hit) return { ...hit, cached: true };

  const d = await enqueue('euipo.europa.eu', () => withRetry(() => httpJson('https://euipo.europa.eu/copla/ctmsearch/json', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8', 'user-agent': UA,
      origin: 'https://euipo.europa.eu', referer: 'https://euipo.europa.eu/eSearch/',
      'x-requested-with': 'XMLHttpRequest',
    },
    body: new URLSearchParams({
      start: '0', rows: String(rows), searchMode: 'basic',
      criterion_1: 'MarkVerbalElementText', term_1: term, operator_1: 'OR', condition_1: 'CONTAINS',
      sortField: 'ApplicationNumber', sortOrder: 'asc',
    }).toString(),
  })));

  let items = (d.items || []).map((s) => {
    const st = tmStatusGroup(s.status);
    const img = s.thumbnailurl || s.imageurl || '';
    return {
      source: 'euipo-tm', sourceName: 'EUIPO 欧盟知识产权局',
      kind: 'trademark',
      id: s.number || '', title: s.name || '', type: s.type || '',
      office: 'EM', officeName: '欧盟',
      protection: EU_PROTECTION.slice(),   // 欧盟商标一次性覆盖全部 27 个成员国
      status: s.status || '', statusGroup: st,
      owner: s.applicantname || '',
      nice: String(s.nice || '').split(/[,\s]+/).map((x) => parseInt(x, 10)).filter(Boolean),
      filed: fmtDate(s.filingdate), registeredAt: fmtDate(s.registrationdate), expiry: fmtDate(s.expirydate),
      images: img ? ['https://euipo.europa.eu' + (img.startsWith('/') ? img : '/' + img)] : [],
      detailUrl: s.number ? `https://euipo.europa.eu/eSearch/#details/trademarks/${encodeURIComponent(s.number)}` : '',
      mediaUrl: s.number ? `https://euipo.europa.eu/eSearch/#details/trademarks/${encodeURIComponent(s.number)}` : '',
    };
  });

  if (Array.isArray(opts.nice) && opts.nice.length) {
    const want = new Set(opts.nice.map(Number));
    items = items.filter((it) => it.nice.some((n) => want.has(n)));
  }

  const out = { source: 'euipo-tm', sourceName: 'EUIPO 欧盟知识产权局', total: d.total || 0, items, cached: false };
  cacheSet(key, out);
  return out;
}

/* ============================ 数据源 4: EUIPO 共同体外观设计 (RCD) ============================ */

async function searchEuipoRcd(term, opts = {}) {
  const rows = Math.max(1, Math.min(100, Number(opts.limit) || 30));
  const key = 'euipo-rcd|' + normTerm(term) + '|' + rows;
  const hit = cacheGet(key);
  if (hit) return { ...hit, cached: true };

  const d = await enqueue('euipo.europa.eu', () => withRetry(() => httpJson('https://euipo.europa.eu/copla/rcdsearch/json', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8', 'user-agent': UA,
      origin: 'https://euipo.europa.eu', referer: 'https://euipo.europa.eu/eSearch/',
      'x-requested-with': 'XMLHttpRequest',
    },
    body: new URLSearchParams({
      start: '0', rows: String(rows), searchMode: 'basic',
      criterion_1: 'VerbalElementText', term_1: term, operator_1: 'OR', condition_1: 'CONTAINS',
      sortField: 'DesignIdentifier', sortOrder: 'asc',
    }).toString(),
  })));

  let items = (d.items || []).map((s) => {
    const st = designStatusGroup(s.status);
    let gallery = [];
    try {
      const g = typeof s.imagegallery === 'string' ? JSON.parse(s.imagegallery || '[]') : (s.imagegallery || []);
      gallery = g.map((x) => 'https://euipo.europa.eu' + (String(x.imageurl || '').startsWith('/') ? x.imageurl : '/' + x.imageurl)).filter((u) => u.length > 30);
    } catch { }
    if (!gallery.length && s.thumbnailurl) gallery = ['https://euipo.europa.eu' + s.thumbnailurl];
    return {
      source: 'euipo-rcd', sourceName: 'EUIPO 共同体外观设计',
      kind: 'design',
      id: s.number || s.applicantsreference || '', title: s.name || '',
      type: 'Design',
      office: 'EM', officeName: '欧盟',
      protection: EU_PROTECTION.slice(),   // 共同体外观设计同样覆盖全部 27 个成员国
      status: s.status || '', statusGroup: st,
      owner: s.applicantname || '',
      locarno: s.classnumber || '', indication: s.indicationdesc || '',
      nice: [],
      filed: fmtDate(s.filingdate), registeredAt: fmtDate(s.registrationdate), expiry: fmtDate(s.expirydate),
      images: gallery.slice(0, 6),
      detailUrl: s.number ? `https://euipo.europa.eu/eSearch/#details/designs/${encodeURIComponent(s.number)}` : '',
      mediaUrl: gallery[0] || '',
    };
  });

  // 洛迦诺分类本地过滤
  if (Array.isArray(opts.locarno) && opts.locarno.length) {
    const want = opts.locarno.map((x) => String(x).trim());
    items = items.filter((it) => want.some((w) => String(it.locarno || '').startsWith(w)));
  }

  const out = { source: 'euipo-rcd', sourceName: 'EUIPO 共同体外观设计', total: d.total || 0, items, cached: false };
  cacheSet(key, out);
  return out;
}

/* ============================ 数据源 5: WIPO 全球品牌库 ============================ */
/* ★ 为什么必须有它: 本机 TMview(tmdn.org) 网络不可达, 而 EUIPO 只覆盖欧盟、USPTO 只覆盖美国。
 *   英国站(GB)/澳洲站(AU)/马德里国际注册(WO) 只有 WIPO 查得到 —— 客户主打的英国站全靠它。
 *   接口逆向与解密说明见 ./wipo-brand.js 顶部。 */

function mapWipoRow(d) {
  const p = Array.isArray(d.designation) ? d.designation.map((x) => String(x).toUpperCase()) : [];
  // 单一国家注册的 designation 就是本国; 马德里国际注册(WO)的 designation 是「指定国清单」——
  // 这正好是判定「在目标市场是否有效」的依据。
  const protection = p.length ? p : (d.office ? [String(d.office).toUpperCase()] : []);
  const id = d.st13 || d.registrationNumber || d.applicationNumber || '';
  return {
    source: 'wipo-brand', sourceName: 'WIPO 全球品牌库',
    kind: 'trademark',
    id,
    title: d.brandName || '',
    type: d.markFeature || d.type || '',
    office: String(d.office || '').toUpperCase(),
    officeName: officeName(d.office),
    protection,
    status: d.status || '',
    statusGroup: tmStatusGroup(d.status),
    owner: d.applicant || '',
    nice: Array.isArray(d.niceClass) ? d.niceClass.map(Number).filter(Boolean) : [],
    filed: fmtDate(d.applicationDate),
    registeredAt: fmtDate(d.registrationDate),
    expiry: fmtDate(d.expiryDate),
    images: [],
    detailUrl: SEARCH_UI + '?brandName=' + encodeURIComponent(d.brandName || ''),
    mediaUrl: SEARCH_UI + '?brandName=' + encodeURIComponent(d.brandName || ''),
  };
}

const SEARCH_UI = 'https://branddb.wipo.int/en/similarname';

async function searchWipoBrand(term, opts = {}) {
  const limit = Math.max(1, Math.min(100, Number(opts.limit) || 30));
  // ★ 不按 office 过滤(接口的 office 只能单值), 拉多一些再按「目标市场保护范围」筛:
  //   上英国站时 GB 记录可能排在几十条之后, 只取 30 条会漏。上限 100 是接口允许的最大页。
  const rows = Math.max(50, Math.min(100, limit * 3));
  const strategy = opts.strategy === 'Fuzzy' ? 'Fuzzy' : 'Simple';
  const key = 'wipo-brand|' + normTerm(term) + '|' + rows + '|' + strategy;
  const hit = cacheGet(key);
  if (hit) return { ...hit, cached: true };

  const r = await enqueue('api.branddb.wipo.int', () => withRetry(() => wipoBrand.searchBrand(term, { rows, strategy })));
  let items = (r.docs || []).map(mapWipoRow);

  if (Array.isArray(opts.nice) && opts.nice.length) {
    const want = new Set(opts.nice.map(Number));
    items = items.filter((it) => it.nice.some((n) => want.has(n)));
  }

  const out = {
    source: 'wipo-brand', sourceName: 'WIPO 全球品牌库',
    total: r.numFound || items.length, items, cached: false,
  };
  cacheSet(key, out);
  return out;
}

/* ============================ 数据源注册表 ============================ */

const PROVIDERS = {
  tmview: {
    id: 'tmview', name: 'TMview 全球商标库', short: '全球商标', scope: '全球 70+ 局 (含中国)',
    kind: 'trademark', method: 'api', ready: true,
    home: 'https://www.tmdn.org/tmview/',
    note: '欧盟知识产权局运维的全球聚合库；一个接口覆盖中国、美国、欧盟、英国、日本、韩国等。',
    run: searchTmview,
  },
  uspto: {
    id: 'uspto', name: 'USPTO 美国专利商标局', short: '美国商标', scope: '美国',
    kind: 'trademark', method: 'api', ready: true,
    home: 'https://tmsearch.uspto.gov/',
    note: '官方检索前端同款接口；含有效/已注册标志位、USPTO 状态码、商品服务项。',
    run: searchUspto,
  },
  'euipo-tm': {
    id: 'euipo-tm', name: 'EUIPO 欧盟商标 (EUTM)', short: '欧盟商标', scope: '欧盟',
    kind: 'trademark', method: 'api', ready: true,
    home: 'https://euipo.europa.eu/eSearch/',
    note: '欧盟知识产权局官方 eSearch 接口；含尼斯分类与注册状态。',
    run: searchEuipoTm,
  },
  'euipo-rcd': {
    id: 'euipo-rcd', name: 'EUIPO 共同体外观设计 (RCD)', short: '欧盟外观', scope: '欧盟',
    kind: 'design', method: 'api', ready: true,
    home: 'https://euipo.europa.eu/eSearch/',
    note: '★ 返回外观设计图，可直接和你的商品图做视觉比对初筛。',
    run: searchEuipoRcd,
  },
  'wipo-brand': {
    id: 'wipo-brand', name: 'WIPO 全球品牌库', short: 'WIPO 商标', scope: '全球 (各局 + 马德里体系)',
    kind: 'trademark', method: 'api', ready: true,
    home: 'https://branddb.wipo.int/',
    note: '★ 英国/澳洲/国际注册(WO) 唯一可用的商标源；Altcha PoW 握手 + AES 解密已在本地实现，每 2s 一次、约 10 次重建会话。',
    run: searchWipoBrand,
  },
  'wipo-design': {
    id: 'wipo-design', name: 'WIPO 全球外观设计库', short: 'WIPO 外观', scope: '全球 (海牙体系)',
    kind: 'design', method: 'browser', ready: false,
    home: 'https://designdb.wipo.int/designdb/en/',
    note: '⚠️ JSF 会话 + qz 状态载荷、结果是 HTML 而非 JSON，需浏览器自动化。',
    run: null,
  },
  cnipa: {
    id: 'cnipa', name: '中国商标网 (CNIPA)', short: '中国商标', scope: '中国',
    kind: 'trademark', method: 'browser', ready: false,
    home: 'https://sbj.cnipa.gov.cn/',
    note: '⚠️ 有风控且需登录。中国商标已由 TMview 覆盖，暂不需单独接。',
    run: null,
  },
};

/* 默认查全部已接入的 API 数据源 —— 不用怕多余:
 * search() 会按目标站点自动裁剪(上英国站会自动跳过欧盟局, 上德国站会自动跳过美国局)。
 * ★ 2026-10-19: tmview 不再列为默认 —— 本机 tmdn.org 网络不可达(fetch failed), 放进默认会让
 *   每次查重白等 34s; 且它失败时旧逻辑会误报「无冲突」。WIPO 已能覆盖它的全球范围(含 GB/AU)。 */
const DEFAULT_SOURCES = ['wipo-brand', 'euipo-tm', 'euipo-rcd', 'uspto'];

function providerList() {
  return Object.values(PROVIDERS).map((p) => ({
    id: p.id, name: p.name, short: p.short, scope: p.scope, kind: p.kind,
    method: p.method, ready: p.ready, home: p.home, note: p.note,
  }));
}

/* ============================ 归一化 + 风险判定 ============================ */

/** 中文数字/罗马数字的尼斯分类解析 */
function parseNiceList(v) {
  if (v == null || v === '') return [];
  if (Array.isArray(v)) return v.map((x) => parseInt(String(x).replace(/[^0-9]/g, ''), 10)).filter(Boolean);
  return String(v).split(/[,\s、;|]+/).map((x) => parseInt(String(x).replace(/[^0-9]/g, ''), 10)).filter(Boolean);
}

const LEVEL_RANK = { unknown: 0, none: 1, low: 2, medium: 3, high: 4 };
const worse = (a, b) => (LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b);

const ADVICE_MARKET = {
  high: (m) => `❌ 高危 —— 这个站不能上。该名称在 ${m} 已有有效注册商标。`,
  medium: (m) => `⚠️ 中风险 —— 上 ${m} 前建议改名或咨询代理。`,
  low: (m) => `✅ 低风险 —— 在 ${m} 可以上，但请自行确认图形商标与外观设计。`,
  none: (m) => `✅ 在 ${m} 未查到冲突 —— 可以上。`,
  unknown: () => '❓ 查询失败 —— 请稍后重试或换数据源。',
};

/**
 * 风险判定 —— ★ 完全按「目标市场」口径算
 *
 * 用户口径(必须严格遵循): 我上德国站, 就只看在德国有效的商标; 上英国站就只看英国的。
 * 别的国家有商标 ≠ 我不能上这个站。所以:
 *   1) 先用保护范围(protection)把命中切成「在本市场有效」和「只在别的市场有效」两堆
 *   2) 风险等级只由「在本市场有效」那堆决定
 *   3) 「只在别的市场有效」那堆只作参考展示, 一句话带过, 不参与打分
 *
 * 商标与外观仍然分开算(文字命中对商标是强证据, 对外观只是线索)。
 * @param {Array} hits 归一化后的命中条目(带 kind / office / protection)
 * @param {Object} opt { term, nice:[], locarno:[], market }
 */
function assess(hits, opt = {}) {
  const term = tight(opt.term);
  const wantNice = new Set(parseNiceList(opt.nice));
  const wantLoc = (opt.locarno || []).map(String);
  const hasNiceFilter = wantNice.size > 0;
  const hasLocFilter = wantLoc.length > 0;
  const market = opt.market || null;
  const req = market && Array.isArray(market.requires) && market.requires.length ? new Set(market.requires) : null;
  const mktName = market ? market.name : '全部市场';

  /** 这条记录在目标市场有没有效力 */
  const inMarket = (h) => {
    if (!req) return true;                                  // 没指定站点 → 退回全球口径
    const p = Array.isArray(h.protection) ? h.protection : [];
    if (p.length) return p.some((x) => req.has(x));         // 有保护范围 → 精确判断
    return req.has(h.office);                               // 没有保护范围 → 用局别兜底
  };
  const scoped = hits.filter(inMarket);
  const others = hits.filter((h) => !inMarket(h));

  const isExact = (h) => { const t = tight(h.title); return !!t && (t === term || t.replace(/^(the|a|an)/, '') === term); };
  const isNear = (h) => {
    const t = tight(h.title);
    if (!t || !term) return false;
    if (t === term) return true;
    /* ★ 子串必须在「词边界」上才算近似。
     *   不做词边界时 "tanker"/"Grundtanker" 会因为包含 "anker" 被判成近似 ——
     *   EUIPO 按 CONTAINS 检索会捞出 "…i dine tanker…" 这种整句商标, 于是平白抬到中风险。
     *   带边界后: "Anker Home" 仍命中, "tanker" 不再命中。 */
    const nt = normTerm(h.title), nterm = normTerm(opt.term);
    const bounded = (a, b) => {
      if (!a || !b) return false;
      let i = b.indexOf(a);
      while (i >= 0) {
        const before = b[i - 1] || ' ';
        const after = b[i + a.length] || ' ';
        if (!/[\p{L}\p{N}]/u.test(before) && !/[\p{L}\p{N}]/u.test(after)) return true;
        i = b.indexOf(a, i + 1);
      }
      return false;
    };
    if (bounded(nterm, nt) || bounded(nt, nterm)) return true;
    const A = new Set(String(h.title).toLowerCase().split(/[^\p{L}\p{N}\u4e00-\u9fff]+/u).filter(Boolean));
    const B = new Set(String(opt.term).toLowerCase().split(/[^\p{L}\p{N}\u4e00-\u9fff]+/u).filter(Boolean));
    if (!A.size || !B.size) return false;
    let inter = 0; A.forEach((x) => { if (B.has(x)) inter++; });
    return inter / Math.min(A.size, B.size) >= 0.6;
  };
  /** 是否落在用户给出的分类条件内；没给条件时返回 null 表示"未知"而不是"是" */
  const inClass = (h) => {
    if (h.kind === 'design') {
      if (!hasLocFilter) return null;
      return wantLoc.some((w) => String(h.locarno || '').startsWith(w));
    }
    if (!hasNiceFilter) return null;
    if (!h.nice || !h.nice.length) return null;      // 库里没标类目 → 无法判断
    return h.nice.some((n) => wantNice.has(n));
  };

  const seg = (list) => {
    const alive = list.filter((h) => h.statusGroup === 'alive');
    const pending = list.filter((h) => h.statusGroup === 'pending');
    const dead = list.filter((h) => h.statusGroup === 'dead');
    const strong = list.filter(isExact);
    return { list, alive, pending, dead, exact: list.filter(isExact), exactAlive: alive.filter(isExact), nearAlive: alive.filter(isNear), strong };
  };

  /* ★ 风险只按「在目标市场有效」的记录算, 别国的命中走 others, 不参与打分 */
  const tm = seg(scoped.filter((h) => h.kind !== 'design'));
  const dz = seg(scoped.filter((h) => h.kind === 'design'));

  /* ---------------- 商标风险 ---------------- */
  const tmReasons = [];
  let tmLevel = 'none', tmScore = 0;
  {
    const exactAliveInClass = tm.exactAlive.filter((h) => inClass(h) === true);
    const exactAliveUnknown = tm.exactAlive.filter((h) => inClass(h) === null);
    const exactAliveOut = tm.exactAlive.filter((h) => inClass(h) === false);

    if (exactAliveInClass.length) {
      tmLevel = 'high'; tmScore = 98;
      tmReasons.push(`❌ 找到 ${exactAliveInClass.length} 件【有效】注册商标，名称完全相同，且就在你指定的类目内 —— 在${mktName}直接使用会侵权。`);
    } else if (exactAliveUnknown.length) {
      tmLevel = 'high'; tmScore = hasNiceFilter ? 82 : 90;
      tmReasons.push(`❌ 找到 ${exactAliveUnknown.length} 件【有效】注册商标，名称完全相同${hasNiceFilter ? '（未标类目，无法确认是否同类别）' : '（未限定类目）'} —— 在${mktName}存在直接侵权风险。`);
    } else if (exactAliveOut.length) {
      tmLevel = 'medium'; tmScore = 55;
      tmReasons.push(`⚠️ 找到 ${exactAliveOut.length} 件【有效】同名注册商标，但类目不同 —— 跨类目仍可能构成混淆，需谨慎。`);
    }

    if (LEVEL_RANK[tmLevel] < LEVEL_RANK.high) {
      const nearInClass = tm.nearAlive.filter((h) => inClass(h) !== false);
      if (nearInClass.length) {
        const L = 'medium';
        if (LEVEL_RANK[L] > LEVEL_RANK[tmLevel]) { tmLevel = L; tmScore = Math.max(tmScore, 60); }
        tmReasons.push(`⚠️ ${nearInClass.length} 件【有效】注册商标与你的名称高度近似 —— 有混淆风险。`);
      }
      if (tm.exact.filter((h) => h.statusGroup === 'pending').length) {
        if (LEVEL_RANK.medium > LEVEL_RANK[tmLevel]) { tmLevel = 'medium'; tmScore = Math.max(tmScore, 45); }
        tmReasons.push(`⚠️ ${tm.exact.filter((h) => h.statusGroup === 'pending').length} 件同名商标【正在审查中】 —— 还没下证，但有人在抢注这个名字。`);
      }
      if (tm.alive.length) {
        if (LEVEL_RANK.low > LEVEL_RANK[tmLevel]) { tmLevel = 'low'; tmScore = Math.max(tmScore, 20); }
        tmReasons.push(`ℹ️ 另有 ${tm.alive.length} 件有效商标，但名称与你的关键词差异较大。`);
      }
    }
    if (tm.exact.filter((h) => h.statusGroup === 'dead').length === tm.exact.length && tm.exact.length
      && LEVEL_RANK[tmLevel] <= LEVEL_RANK.low) {
      tmReasons.push(`ℹ️ 同名商标 ${tm.exact.length} 件均已失效 —— 一般可用，确认无续展/复活即可。`);
    }
    if (!tm.list.length) {
      tmReasons.push(market
        ? `✅ 在${mktName}没有任何相关商标记录。`
        : '✅ 商标库未查到相关记录。');
    } else if (LEVEL_RANK[tmLevel] <= LEVEL_RANK.none) {
      tmReasons.push(`ℹ️ 在${mktName}命中 ${tm.list.length} 条，但都跟你的名称没实质关系。`);
    }
  }

  /* ---------------- 外观风险 ---------------- */
  const dzReasons = [];
  let dzLevel = 'unknown', dzScore = 0;
  if (!dz.list.length) {
    dzLevel = 'none';
    dzReasons.push(market
      ? `未在${mktName}查到相关外观设计记录（或该数据源对这个站不适用）。`
      : '未查到相关外观设计记录（或该数据源未启用）。');
  } else {
    const exactAlive = dz.exactAlive.filter((h) => inClass(h) !== false);
    const nearAlive = dz.nearAlive.filter((h) => inClass(h) !== false);
    if (exactAlive.length || nearAlive.length) {
      dzLevel = 'medium'; dzScore = 55;
      dzReasons.push(`⚠️ ${exactAlive.length + nearAlive.length} 件【有效】外观设计名称与你的关键词相同/近似 —— 但外观保护的是造型，文字命中只是线索。`);
      dzReasons.push('👉 请点开下面的设计图，和你的商品图做视觉比对。');
    } else if (dz.alive.length) {
      dzLevel = 'low'; dzScore = 20;
      dzReasons.push(`ℹ️ 该关键词下有 ${dz.alive.length} 件有效外观设计，但名称关联度低。`);
    } else if (dz.list.length) {
      dzLevel = 'none'; dzScore = 5;
      dzReasons.push(`命中 ${dz.list.length} 条外观记录，均无有效权利或关联度低。`);
    }
    if (!hasLocFilter) dzReasons.push('💡 想更准: 填上洛迦诺分类（如 07-01 炊具 / 14-01 影音设备），能大幅缩小范围。');
  }

  /* ---------------- 合并 ---------------- */
  const level = worse(tmLevel, dzLevel);
  const score = Math.max(tmScore, dzScore);
  const reasons = [...tmReasons, ...dzReasons];

  /* ★ 「别的市场有商标」只作参考 —— 明确告诉用户这不影响他上这个站 */
  if (others.length) {
    const byOffice = {};
    others.forEach((h) => { const k = h.officeName || h.office || '?'; byOffice[k] = (byOffice[k] || 0) + 1; });
    const detail = Object.keys(byOffice).sort((a, b) => byOffice[b] - byOffice[a])
      .slice(0, 8).map((k) => k + ' ' + byOffice[k]).join(' / ');
    const othersAlive = others.filter((h) => h.statusGroup === 'alive').length;
    reasons.push(`ℹ️ 另有 ${others.length} 条记录只在你没选的其它市场有效（有效 ${othersAlive} 条）: ${detail} —— 不影响你上${mktName}，已折叠。`);
  }

  if (LEVEL_RANK[level] <= LEVEL_RANK.low) {
    reasons.push('⚠️ 官方库只能查"文字"。图形商标(Logo/图案)需要图形近似检索，不在本结果覆盖范围内。');
  }

  const aliveAll = scoped.filter((h) => h.statusGroup === 'alive').length;
  const pendingAll = scoped.filter((h) => h.statusGroup === 'pending').length;
  const deadAll = scoped.filter((h) => h.statusGroup === 'dead').length;

  return {
    level, score,
    advice: (ADVICE_MARKET[level] || ADVICE_MARKET.unknown)(mktName),
    reasons,
    market: market ? { sites: market.sites, name: market.name, requires: market.requires, offices: market.offices, label: market.label } : null,
    trademark: { level: tmLevel, score: tmScore, total: tm.list.length, alive: tm.alive.length, pending: tm.pending.length, dead: tm.dead.length, exactAlive: tm.exactAlive.length },
    design: { level: dzLevel, score: dzScore, total: dz.list.length, alive: dz.alive.length, pending: dz.pending.length, dead: dz.dead.length, exactAlive: dz.exactAlive.length },
    counts: { total: hits.length, scoped: scoped.length, otherMarkets: others.length, alive: aliveAll, pending: pendingAll, dead: deadAll },
    exact: {
      alive: tm.exactAlive.length,
      aliveAnyClass: tm.exactAlive.length,
      pending: tm.exact.filter((h) => h.statusGroup === 'pending').length,
      dead: tm.exact.filter((h) => h.statusGroup === 'dead').length,
    },
    filters: { nice: [...wantNice], locarno: wantLoc, hasNiceFilter, hasLocFilter },
  };
}

/* ============================ 统一检索入口 ============================ */

/** 数据源 → 它属于哪个区域局。目标站点的管辖局列表里没有这个局, 就跳过, 省一次无用请求。
 * ★ 注意用 market.offices 判断而不是 market.requires:
 *     amazon.de 的 offices = [DE, EM, WO] → 含 EM → 欧盟局要查(欧盟商标覆盖德国) ✓
 *     amazon.co.uk 的 offices = [GB, WO]   → 不含 EM → 欧盟局跳过(脱欧后与英国无关) ✓
 */
const SOURCE_REGIONS = {
  tmview: null,            // null = 全球聚合, 永远要查
  'wipo-brand': null,      // 全球(含马德里指定国) → 永远要查
  uspto: 'US',
  'euipo-tm': 'EM',
  'euipo-rcd': 'EM',
};

/**
 * @param {string} term 关键词 / 品牌名
 * @param {Object} opt  { sites:[], sources:[], nice:[], locarno:[], limit, aliveOnly, registeredOnly }
 *   sites 例: ['amazon.de'] / ['amazon.de','amazon.co.uk'] —— 决定"只看哪些地区有效的商标"
 */
async function search(term, opt = {}) {
  const q = String(term || '').trim();
  const t0 = nowMs();
  if (!q) return { ok: false, error: '关键词不能为空', term: q };

  const market = marketFromSites(opt.sites);
  const wantOffices = market ? market.offices
    : (Array.isArray(opt.offices) && opt.offices.length ? opt.offices : []);

  let srcIds = (Array.isArray(opt.sources) && opt.sources.length ? opt.sources : DEFAULT_SOURCES)
    .map(String).filter((s) => PROVIDERS[s]);
  if (!srcIds.length) return { ok: false, error: '没有可用的数据源', term: q };

  // ★ 按目标市场裁剪数据源: 上英国站就别去问欧盟局(脱欧后无关), 上德国站就别去问美国局
  const skipped = [];
  if (market) {
    srcIds = srcIds.filter((id) => {
      const need = SOURCE_REGIONS[id];
      if (!need) return true;
      const hit = market.offices.indexOf(need) >= 0;
      if (!hit) skipped.push({ source: id, sourceName: PROVIDERS[id].name, reason: `与${market.name}无关，已跳过` });
      return hit;
    });
  }

  const limit = Math.max(1, Math.min(100, Number(opt.limit) || 30));
  const settled = srcIds.length ? await Promise.all(srcIds.map(async (id) => {
    const P = PROVIDERS[id];
    if (!P.ready || !P.run) return { id, ok: false, error: '该数据源需要浏览器自动化，暂未接入', items: [], total: 0 };
    try {
      const r = await P.run(q, {
        offices: wantOffices, nice: opt.nice, locarno: opt.locarno, limit,
        aliveOnly: opt.aliveOnly !== false, registeredOnly: !!opt.registeredOnly,
      });
      return { id, ok: true, ...r };
    } catch (e) {
      return { id, ok: false, error: (e && e.message) || String(e), items: [], total: 0, sourceName: P.name };
    }
  })) : [];

  const results = settled.map((s) => ({
    source: s.id, sourceName: s.sourceName || PROVIDERS[s.id].name,
    ok: !!s.ok, error: s.error || null,
    total: s.total || 0, cached: !!s.cached,
    items: (s.items || []).map((it) => ({ ...it, source: s.id, sourceName: s.sourceName || PROVIDERS[s.id].name })),
  }));

  const all = [];
  const seen = new Set();
  results.forEach((r) => r.items.forEach((it) => {
    const k = tight(it.title) + '|' + it.office + '|' + (it.id || '');
    if (seen.has(k)) return; seen.add(k); all.push(it);
  }));

  // ★ 排序: 先在目标市场有效的 → 再有效 → 再新→旧
  const inMarketFn = (h) => {
    if (!market) return true;
    const p = Array.isArray(h.protection) ? h.protection : [];
    if (p.length) return p.some((x) => market.requires.indexOf(x) >= 0);
    return market.requires.indexOf(h.office) >= 0;
  };
  const ORDER = { alive: 0, pending: 1, unknown: 2, dead: 3 };
  all.forEach((h) => { h.inMarket = inMarketFn(h); });
  all.sort((a, b) => (a.inMarket === b.inMarket ? 0 : (a.inMarket ? -1 : 1))
    || (ORDER[a.statusGroup] ?? 9) - (ORDER[b.statusGroup] ?? 9)
    || String(b.filed || '').localeCompare(String(a.filed || '')));

  const risk = assess(all, { term: q, nice: opt.nice, locarno: opt.locarno, market });

  /* ★ 数据源健康度 —— 查询失败 ≠ 没有冲突。
   *   旧逻辑把所有数据源都失败当成 0 条命中 → level='none' → 文案写「✅ 可以上」,
   *   这是会直接导致侵权上架的假阴性(实测: tmview fetch failed 时德国站 Nike 被判「可以上」)。
   *   现在的口径: 全部失败 → unknown(无法判定, 明确提示重试); 部分失败 → 保留结论但显式警告「可能有漏网」。 */
  const srcFailed = results.filter((r) => !r.ok);
  const srcOk = results.filter((r) => r.ok);
  if (srcFailed.length) {
    const detail = srcFailed.map((r) => `${r.sourceName || r.source}: ${r.error || '查询失败'}`).join('; ');
    if (!srcOk.length) {
      risk.level = 'unknown';
      risk.score = 0;
      risk.advice = `⚠️ 无法判定 —— ${srcFailed.length} 个数据源全部查询失败（${detail}）。这不代表没有商标冲突，请稍后重试或换数据源。`;
      risk.reasons = [`❌ 数据源全部失败，本次没有任何库返回结果：${detail}`].concat(risk.reasons || []);
    } else {
      risk.reasons = [`⚠️ ${detail} 查询失败 —— 本次结论仅基于 ${srcOk.map((r) => r.sourceName || r.source).join('、')}，可能有漏网。`]
        .concat(risk.reasons || []);
    }
    risk.sourceHealth = {
      used: srcOk.map((r) => r.source),
      failed: srcFailed.map((r) => ({ source: r.source, error: r.error })),
    };
  }

  return {
    ok: true, term: q, tookMs: nowMs() - t0,
    market: market ? { sites: market.sites, name: market.name, label: market.label, requires: market.requires, offices: market.offices } : null,
    sources: results.map((r) => ({ source: r.source, sourceName: r.sourceName, ok: r.ok, error: r.error, total: r.total, cached: r.cached, returned: r.items.length })),
    skipped,
    risk,
    counts: {
      byOffice: all.filter((h) => h.inMarket).reduce((m, h) => { m[h.office || '?'] = (m[h.office || '?'] || 0) + 1; return m; }, {}),
      bySource: results.reduce((m, r) => { m[r.source] = r.ok ? r.items.length : -1; return m; }, {}),
    },
    total: all.length,
    items: all.slice(0, Math.max(limit * 2, 60)),
  };
}

/** 依据查重结果推导商品「品牌备案」状态 —— 与商品库字段对接
 * 语义对照商品库既有约定:
 *   registered = 该名字已被(他人)注册 —— 用于「排除已备案」筛选
 *   notfound   = 官方库里完全没有这个名字
 *   unchecked  = 查过但结论不明(类目缺失/只有中间态/查询失败)
 */
function brandVerdict(risk) {
  if (!risk) return { brandStatus: 'unchecked', trademarkCount: 0, text: '', level: 'unknown', score: 0 };
  const tm = risk.trademark || { alive: 0, total: 0, exactAlive: 0 };
  const trademarkCount = tm.alive || 0;

  let brandStatus = 'unchecked';
  if (risk.level === 'unknown') brandStatus = 'unchecked';
  else if (tm.exactAlive > 0) brandStatus = 'registered';           // 有人注册了同名商标
  else if (tm.total === 0 && (risk.counts?.total || 0) === 0) brandStatus = 'notfound';
  else brandStatus = 'unchecked';

  const c = risk.counts || {};
  const text = `[知产查重] ${risk.advice} 有效${c.alive || 0} / 审查中${c.pending || 0} / 已失效${c.dead || 0} · 风险分 ${risk.score}`;
  return { brandStatus, trademarkCount, text, level: risk.level, score: risk.score };
}

module.exports = {
  search, assess, brandVerdict, providerList, siteList, marketFromSites,
  PROVIDERS, DEFAULT_SOURCES, OFFICES, officeName, AMAZON_SITES, EU_MEMBERS,
  cacheStats, cacheClear, normTerm, tight,
  parseNiceList, tmStatusGroup, designStatusGroup,
  _searchTmview: searchTmview, _searchUspto: searchUspto,
  _searchEuipoTm: searchEuipoTm, _searchEuipoRcd: searchEuipoRcd,
  _searchWipoBrand: searchWipoBrand,
};

/* ============================ 自测 ============================ */
if (require.main === module) {
  (async () => {
    const term = process.argv[2] || 'air fryer';
    const sites = (process.argv[3] || 'amazon.de').split(',');
    const sources = (process.argv[4] || 'tmview,uspto,euipo-tm,euipo-rcd').split(',');
    const nice = process.argv[5];
    const mkt = marketFromSites(sites);
    console.log('查: ' + term);
    console.log('目标站点: ' + (mkt ? mkt.flag + ' ' + mkt.label : '(未指定 → 全球口径)'));
    console.log('数据源: ' + sources.join(','));
    const r = await search(term, { sites, sources, limit: 5, nice });
    console.log('\n耗时 ' + r.tookMs + 'ms  总计命中 ' + r.total + ' / 本市场相关 ' + r.risk.counts.scoped + ' / 别国 ' + r.risk.counts.otherMarkets);
    console.log('数据源: ' + r.sources.map((s) => `${s.sourceName}=${s.ok ? s.returned + '/' + s.total : '✗' + s.error}`).join('  '));
    if (r.skipped.length) console.log('已跳过: ' + r.skipped.map((s) => s.sourceName + '(' + s.reason + ')').join(' '));
    console.log('风险: ' + r.risk.level + ' (' + r.risk.score + ') ' + r.risk.advice);
    console.log('  商标: ' + r.risk.trademark.level + ' (本市场有效 ' + r.risk.trademark.alive + ' / 同名有效 ' + r.risk.trademark.exactAlive + ')');
    console.log('  外观: ' + r.risk.design.level + ' (本市场有效 ' + r.risk.design.alive + ')');
    r.risk.reasons.forEach((x) => console.log('   · ' + x));
    console.log('\n前几条(带 ★ 的表示在本市场有效):');
    r.items.slice(0, 10).forEach((it) => console.log(`  ${it.inMarket ? '★' : ' '}[${it.kind}/${it.statusGroup}] ${it.officeName} "${it.title}" | ${it.status} | 尼斯${JSON.stringify(it.nice)} | ${(it.owner || '').slice(0, 30)}`.slice(0, 175)));
  })().catch((e) => { console.error('失败: ' + e.stack); process.exit(1); });
}

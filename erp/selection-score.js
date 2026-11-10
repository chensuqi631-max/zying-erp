/**
 * 选品评分引擎 (纯函数, 不碰网络/文件 —— 可直接 node 单测)
 * ==================================================================
 * 输入: 列表页采集出来的商品数组 (字段见 normalize())
 * 输出: ① 类目/细分类五维评分  ② 候选品(战术卡命中)  ③ CSV
 *
 * 五维权重(源自开源选品框架 Sorftime 五维模型, 按 GBP 站点口径改造):
 *   市场规模 20  —— 榜单评论量级 (需求验证)
 *   增长潜力 25  —— 低评论占比(新品能挤进来) 60% + 非自营占比 40%
 *   竞争烈度 20  —— 品牌 Top3 集中度 越低越好
 *   进入壁垒 20  —— 高评分门槛 + A+ 内容覆盖
 *   利润空间 15  —— 货值 + 轻小件运费优势
 *
 * 铁律: 缺字段就是缺, 用 null 参与"覆盖度"统计, 绝不用默认值伪造 (0 分/4 星都不填)。
 */
'use strict';

/* ---------- 解析工具 ---------- */
/** 重量文本 → 克。'227 grams' / '1.2 kg' / '8 oz' / '1.5 pounds' → number|null */
function parseWeightG(v) {
  if (v == null) return null;
  if (typeof v === 'number' && isFinite(v)) return v > 0 ? Math.round(v) : null;
  const m = String(v).replace(/,/g, '').match(/([\d.]+)\s*(kg|kilograms?|g|grams?|gr\b|oz|ounces?|lb|lbs?|pounds?)/i);
  if (!m) {
    const bare = String(v).replace(/,/g, '').match(/^[\s]*([\d.]+)[\s]*$/);
    return bare ? Math.round(Number(bare[1])) : null;
  }
  const n = Number(m[1]);
  const u = m[2].toLowerCase();
  if (!isFinite(n) || n <= 0) return null;
  if (u.startsWith('k')) return Math.round(n * 1000);
  if (u.startsWith('lb') || u.startsWith('pound')) return Math.round(n * 453.592);
  if (u.startsWith('oz') || u.startsWith('ounce')) return Math.round(n * 28.3495);
  return Math.round(n);                                   // g / gram
}

/** 任意 → 数字|null (不把 0 当缺失, 也不把 '' 当 0) */
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const n = Number(String(v).replace(/[^\d.-]/g, ''));
  return isFinite(n) ? n : null;
}

/** 品牌名归一化: 同一个品牌常被写成 ANSIO / Ansio / ANSIO-UK / ANSIO® Ltd, 不归一 Top3 集中度会算歪 */
const BRAND_SUFFIX = /(ltd|limited|llc|inc|gmbh|co|company|corp|official|store|shop|group|uk|usa|eu|de|global|international)$/;
function brandKey(name) {
  if (!name) return null;
  let s = String(name).toLowerCase()
    .replace(/[®™©]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '');       // 去空格/连字符/点
  for (let i = 0; i < 2 && s.length > 3; i++) {       // 反复剥后缀 (ANSIOUK → ansio)
    const m = s.match(BRAND_SUFFIX);
    if (!m || m[0].length >= s.length) break;
    s = s.slice(0, s.length - m[0].length);
  }
  return s || null;
}

/** 统一字段名: 兼容采集层给的 weight / weightText / panelWeight 等多种写法 */
function normalize(it) {
  const brand = String(it.brand || '').trim();
  return {
    asin: it.asin || null,
    title: it.title || '',
    brand: brand && brand.toLowerCase() !== 'unknown' ? brand : null,
    brandKey: brand && brand.toLowerCase() !== 'unknown' ? brandKey(brand) : null,
    price: num(it.price) > 0 ? num(it.price) : null,
    rating: num(it.rating),
    reviews: num(it.reviews),
    weightG: parseWeightG(it.weightG != null ? it.weightG : (it.weight != null ? it.weight : it.panelWeight)),
    ptype: String(it.ptype || it.productType || '').trim() || null,
    cat: it.cat || null,
    catName: it.catName || null,
    site: it.site || null,
    rank: num(it.rank),
    /* 三态: true=明确自营 / false=明确非自营 / null=没读到(不能当非自营) */
    amazonSeller: it.amazonSeller === true ? true
      : (it.fulfill === 'AMZ' ? true
        : (it.hasPanel === false ? null
          : (it.amazonSeller === false || it.fulfill === 'FBA' || it.fulfill === 'FBM' ? false : null))),
    fulfill: it.fulfill || null,
    aplus: it.aplus === true ? true : (it.hasPanel === false ? null : (it.aplus === false ? false : null)),
    variants: num(it.variants) || num(it.variantsCount) || null,
    followCount: num(it.followCount),
    raw: it,
  };
}

/* ---------- 统计 ---------- */
const median = (xs) => {
  const a = xs.filter((x) => x != null && isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const share = (xs, f) => (xs.length ? xs.filter(f).length / xs.length : null);
/** 只在"读到的"样本里算占比 (null 表示没读到, 不进分母) */
const shareKnown = (xs, f) => {
  const known = xs.filter((x) => x != null);
  return known.length ? known.filter(f).length / known.length : null;
};
const round = (v, d = 1) => (v == null || !isFinite(v) ? null : Math.round(v * Math.pow(10, d)) / Math.pow(10, d));

/**
 * 一个同组商品集合 → 五维评分
 * @param {Array} rawItems 原始商品
 * @param {string} label 组名 (类目名 / 细分类名)
 * @param {object} opt {minSample}
 */
function scoreGroup(rawItems, label, opt = {}) {
  const minSample = opt.minSample || 8;
  const items = rawItems.map(normalize).filter((x) => x.price > 0);
  const n = items.length;
  if (n < minSample) return { label, n, skipped: '样本<' + minSample };

  const prices = items.map((x) => x.price);
  const revs = items.map((x) => x.reviews).filter((x) => x != null);
  const ratings = items.map((x) => x.rating).filter((x) => x != null && x > 0);
  const weights = items.map((x) => x.weightG).filter((x) => x != null && x > 0);

  const light = revs.length ? share(revs, (r) => r < 200) : null;     // 新品能挤进来
  const heavy = revs.length ? share(revs, (r) => r > 1000) : null;    // 老品盘踞
  const highscore = ratings.length ? share(ratings, (r) => r >= 4.5) : null;
  const amazon = shareKnown(items.map((x) => x.amazonSeller), (v) => v === true);
  const aplus = shareKnown(items.map((x) => x.aplus), (v) => v === true);

  // 品牌集中度: 归一化后统计 (ANSIO / Ansio-UK 视为同一个品牌)
  const bc = new Map();
  for (const x of items) if (x.brandKey) bc.set(x.brandKey, (bc.get(x.brandKey) || 0) + 1);
  const brandTotal = [...bc.values()].reduce((a, b) => a + b, 0);
  const top3 = brandTotal ? [...bc.values()].sort((a, b) => b - a).slice(0, 3).reduce((a, b) => a + b, 0) / brandTotal : null;

  const medRev = median(revs);
  const medPrice = median(prices);
  const medW = median(weights);

  /* —— 五维 —— */
  const market = medRev == null ? null : (medRev > 3000 ? 20 : medRev > 1000 ? 17 : medRev > 300 ? 14 : 10);
  // 增长: 低评论占比(60%) + 非自营占比(40%); 缺项时按现有项回收权重, 不硬填
  let growth = null;
  if (light != null && amazon != null) growth = 25 * (0.6 * light + 0.4 * (1 - amazon));
  else if (light != null) growth = 25 * light;
  else if (amazon != null) growth = 25 * (1 - amazon);
  const comp = top3 == null ? null : 20 * (1 - top3);
  let barrier = null;
  if (highscore != null && aplus != null) barrier = 20 * (0.6 * (1 - highscore) + 0.4 * (1 - aplus));
  else if (highscore != null) barrier = 20 * (1 - highscore);
  let profit = medPrice == null ? null : (medPrice >= 100 ? 15 : medPrice >= 50 ? 13 : medPrice >= 20 ? 11 : 8);
  if (profit != null && medW != null) {
    if (medW <= 500) profit = Math.min(15, profit + 2);
    else if (medW > 5000) profit = Math.max(0, profit - 2);
  }

  // 缺维度 → 按已得满分占比折算到 100 分制, 同时给出"评分覆盖度"
  const parts = { market, growth, comp, barrier, profit };
  const max = { market: 20, growth: 25, comp: 20, barrier: 20, profit: 15 };
  let got = 0, full = 0;
  for (const k of Object.keys(parts)) { if (parts[k] != null) { got += parts[k]; full += max[k]; } }
  const score = full ? round((got / full) * 100, 1) : null;
  const coverage = round(full / 100, 2);

  return {
    label, n,
    medPrice: round(medPrice, 2), medRev: medRev == null ? null : Math.round(medRev), medWeightG: medW == null ? null : Math.round(medW),
    light: round(light, 2), heavy: round(heavy, 2), highscore: round(highscore, 2),
    amazonShare: round(amazon, 2), aplusShare: round(aplus, 2),
    top3Share: round(top3, 2), brandCount: bc.size,
    score, coverage,
    parts: { market: round(market), growth: round(growth), comp: round(comp), barrier: round(barrier), profit: round(profit) },
    /* 覆盖度自述: 哪几项缺 */
    missing: Object.keys(parts).filter((k) => parts[k] == null),
    samples: { reviews: revs.length, ratings: ratings.length, weights: weights.length, brands: brandTotal },
  };
}

/** 按组(类目/细分类)批量评分 */
function scoreGroups(rawItems, groupFn, opt = {}) {
  const groups = new Map();
  for (const it of rawItems) {
    const k = groupFn(it);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(it);
  }
  return [...groups.entries()]
    .map(([k, arr]) => scoreGroup(arr, k, opt))
    .filter((r) => !r.skipped)
    .sort((a, b) => (b.score || 0) - (a.score || 0));
}

/* ---------- 战术卡 ---------- */
/**
 * 候选品: 命中"能被小卖家抢进去"的信号
 * 卡片分值: 低竞争上榜30 / 热销低评分25 / 价带合适15 / 轻小件10 / 无自营5
 */
function candidates(rawItems, opt = {}) {
  const priceMin = opt.priceMin || 10;
  const priceMax = opt.priceMax || 45;
  const out = [];
  for (const raw of rawItems) {
    const x = normalize(raw);
    if (x.price == null) continue;
    const rank = x.rank || 9999;
    const cards = [];
    // ① 低竞争上榜: 榜内排名靠前但评论少 —— 需求已验证、护城河没建起来
    if (x.reviews != null && x.reviews < 300 && rank <= 60) cards.push('低竞争上榜');
    // ② 热销低评分: 卖得动但口碑差 —— 有明确改进点
    if (x.rating != null && x.rating > 0 && x.rating <= 4.2 && rank <= 30) cards.push('热销低评分');
    // ③ 价带: FBA 起步最舒服的货值区间
    if (x.price >= priceMin && x.price <= priceMax) cards.push('价带合适');
    // ④ 轻小件: 头程+FBA 费用可控
    if (x.weightG != null && x.weightG > 0 && x.weightG <= 500) cards.push('轻小件');
    // ⑤ 无自营: 不是跟 Amazon 抢饭吃
    if (x.amazonSeller === false) cards.push('无自营');
    // ⑥ 冷启动: 榜上有名但评论几乎为零 —— 可能是真新品, 也可能是刷上去的, 必须降权人工看
    const coldStart = x.reviews != null && x.reviews < 10;
    if (coldStart) cards.push('冷启动(无评论验证)');
    // 无强信号直接丢 (只看价格/轻小件没有选品意义)
    if (!cards.includes('低竞争上榜') && !cards.includes('热销低评分')) continue;
    let pick = (cards.includes('低竞争上榜') ? 30 : 0)
      + (cards.includes('热销低评分') ? 25 : 0)
      + (cards.includes('价带合适') ? 15 : 0)
      + (cards.includes('轻小件') ? 10 : 0)
      + (cards.includes('无自营') ? 5 : 0);
    if (coldStart) pick -= 10;
    out.push({
      asin: x.asin, title: x.title, brand: x.brand, price: x.price, rating: x.rating, reviews: x.reviews,
      weightG: x.weightG, ptype: x.ptype, catName: x.catName, rank: x.rank, variants: x.variants,
      followCount: x.followCount, amazonSeller: x.amazonSeller, aplus: x.aplus, site: x.site,
      cards, pick,
    });
  }
  out.sort((a, b) => b.pick - a.pick || (a.rank || 9999) - (b.rank || 9999));
  return out;
}

/* ---------- 导出 ---------- */
function toCSV(items) {
  const head = ['站点', '类目', '细分类', '排名', 'ASIN', '品牌', '价格', '评分', '评论数', '重量g', '变体', '跟卖数', 'Amazon自营', 'A+', '命中卡片', '分数', '标题'];
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const rows = [head.join(',')];
  for (const c of items) {
    rows.push([c.site, c.catName, c.ptype, c.rank, c.asin, c.brand, c.price, c.rating, c.reviews, c.weightG,
      c.variants, c.followCount, c.amazonSeller ? '是' : '否', c.aplus ? '是' : '否',
      (c.cards || []).join('/'), c.pick, c.title].map(esc).join(','));
  }
  return '\uFEFF' + rows.join('\r\n');
}

/** 数据覆盖度体检: 告诉前端"这次抓回来的数据能支撑哪些结论" */
function coverage(rawItems) {
  const items = rawItems.map(normalize);
  const n = items.length;
  const c = (f) => items.filter(f).length;
  return {
    total: n,
    price: c((x) => x.price != null),
    rating: c((x) => x.rating != null),
    reviews: c((x) => x.reviews != null),
    brand: c((x) => x.brand != null),
    weight: c((x) => x.weightG != null),
    ptype: c((x) => x.ptype != null),
    aplus: c((x) => x.aplus === true),
    amazonSeller: c((x) => x.amazonSeller === true),
  };
}

module.exports = { parseWeightG, normalize, brandKey, scoreGroup, scoreGroups, candidates, toCSV, coverage, median };

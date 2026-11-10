/**
 * 单品选品分析 · 给每个商品打上「它在类目里处于什么位置 + 该怎么办」的标签
 * =====================================================================
 * 为什么要相对位置而不是绝对值:
 *   「月销 50 件」在 A 类目是垃圾、在 B 类目是爆款 —— 只有跟【同站点同上级类目】比才有意义。
 *   所以先按 (site, 上级类目) 聚合出基准（分位数 / 品牌铺货量 / 卖家铺货量），再逐个商品判定。
 *
 * 需求强度取三级来源（本库现状: 9696 条里 3993 有月销、3464 有排名、5144 两者都没有）:
 *   ① basis='sales' — price × monthlySales = 销售额，在类目内的分位（最准）
 *   ② basis='rank'  — 没有月销时用类目排名分位当需求代理（排名越靠前需求越强）
 *   ③ basis=null    — 两者都没有 → 标「无需求数据」，只给价格带定位，不硬猜
 *
 * 口径与 market-prepare.js 保持一致（避免两套数字互相打架）:
 *   revenue = price × monthlySales
 *   上级类目 = bsr[0].category → bsrShopCat → cat1（并排除采集模式名）
 *   卖家 = mainSeller → sellerId（没有就记 (未填写)）
 *
 * 输出（在商品对象上加一个 insight 字段，不改其它字段）:
 *   { label, short, advice, tone, color, basis, why: string[], rel: {...} }
 *
 * 四象限规则（按优先级命中第一条；demandPct 越高需求越强）:
 *   精品强链接 — 需求前 25% 且 该品牌在本类目 ≤3 个品 → 一条链接打天下，别正面刚
 *   铺货型     — 需求前 25% 且 品牌铺货多          → 靠数量占位，壁垒低，可跟
 *   垃圾铺货   — 需求后 50% 且 品牌铺货多          → 没量还铺得多，别参考
 *   潜力样板   — 上架短 + 跟卖少 + 评论少 + 需求过中位 → 刚起量没被围剿，可抄
 *   常规       — 其余
 */
'use strict';

/* 采集模式名 —— 它们不是商品类目，必须排除（与 market-prepare.js 同一张表） */
const MODE_NAMES = new Set(['Links', 'FollowShop', 'ListDirect', 'ListFiltered', 'ListPage',
  'Search', 'Shop', 'CategorySearch', 'BrandBatch', 'SiteBulk', 'PanelShop', 'ShopList']);

const nn = (v) => v !== null && v !== undefined && v !== '';
/* ★ 2026-10-18 修坑: 原写法 `Number(String(v).replace(/[^\d.\-]/g,''))` 把 null 变成 ''，
 *   而 Number('') === 0 → 缺月销量的商品被算成"月销 0"，在"全类目都没月销"的类目里
 *   所有商品并列最高分位 → 误判成「精品强链接」。必须先判空。 */
const num = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/[^\d.\-]/g, '');
  if (s === '' || s === '-' || s === '.' || s === '-.') return null;
  const n = Number(s);
  return isFinite(n) ? n : null;
};

/** 上级类目（与 market-prepare.js 的 bigCat 一致） */
function bigCat(x) {
  if (Array.isArray(x.bsr) && x.bsr.length && x.bsr[0] && x.bsr[0].category) return x.bsr[0].category;
  if (nn(x.bsrShopCat) && !MODE_NAMES.has(x.bsrShopCat)) return x.bsrShopCat;
  if (nn(x.cat1) && !MODE_NAMES.has(x.cat1)) return x.cat1;
  return null;
}
/** 卖家身份：优先名字，退回 ID（保证同一卖家不被拆成多个） */
function sellerOf(x) {
  if (nn(x.mainSeller)) return String(x.mainSeller);
  if (nn(x.sellerId)) return String(x.sellerId);
  return '(未填写)';
}
function brandOf(x) {
  if (!nn(x.brand)) return '(未填写)';
  return String(x.brand).replace(/\s*\d*\s*个?\s*已?\s*(申请|注册|备案)\s*$/g, '').trim() || '(未填写)';
}
/** 取一个"大排名"：父类 → 根类 → 子类（与界面卡片口径一致） */
function rankOf(x) {
  const a = num(x.rankParent), b = num(x.rank), c = num(x.rankChild);
  if (a !== null && a > 0) return a;
  if (b !== null && b > 0) return b;
  if (c !== null && c > 0) return c;
  return null;
}
function ageDays(listedAt) {
  if (!nn(listedAt)) return null;
  const t = Date.parse(String(listedAt).trim());
  if (!isFinite(t)) return null;
  return Math.max(0, Math.round((Date.now() - t) / 86400000));
}

/** 分位数（升序数组中 ≤ v 的比例，0–1） */
function pctRank(sorted, v) {
  const n = sorted.length;
  if (!n) return 0;
  let lo = 0, hi = n;
  while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] <= v) lo = m + 1; else hi = m; }
  return lo / n;
}
function quantile(sorted, q) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)));
  return sorted[i];
}

/* ---------------- 类目基准索引（带缓存） ---------------- */
let _cache = null, _cacheAt = 0, _cacheLen = -1;

function buildIndex(all) {
  const now = Date.now();
  if (_cache && (now - _cacheAt) < 60000 && _cacheLen === all.length) return _cache;

  const idx = new Map();   // "site|cat" -> bucket
  const bucketOf = (key) => {
    let b = idx.get(key);
    if (!b) {
      b = { n: 0, revs: [], mss: [], ranks: [], prices: [], brands: new Map(), sellers: new Map() };
      idx.set(key, b);
    }
    return b;
  };

  for (const x of all) {
    const cat = bigCat(x);
    if (!cat) continue;
    const price = num(x.price), ms = num(x.monthlySales);
    const key = String(x.site || '?') + '|' + cat;
    const b = bucketOf(key);
    b.n++;
    const br = brandOf(x), se = sellerOf(x);
    b.brands.set(br, (b.brands.get(br) || 0) + 1);
    b.sellers.set(se, (b.sellers.get(se) || 0) + 1);
    if (price !== null && price > 0) {
      b.prices.push(price);
      if (ms !== null && ms >= 0) b.revs.push(price * ms);
    }
    if (ms !== null && ms >= 0) b.mss.push(ms);
    const rk = rankOf(x);
    if (rk !== null) b.ranks.push(rk);
  }

  for (const b of idx.values()) {
    b.revs.sort((a, c) => a - c);
    b.mss.sort((a, c) => a - c);
    b.ranks.sort((a, c) => a - c);
    b.prices.sort((a, c) => a - c);
    b.p50rev = quantile(b.revs, 0.50);
    b.p75rev = quantile(b.revs, 0.75);
    b.p50ms = quantile(b.mss, 0.50);
    b.p75ms = quantile(b.mss, 0.75);
    const counts = [...b.brands.values()].sort((a, c) => a - c);
    b.medBrandItems = quantile(counts, 0.50) || 1;
    /* 「铺货型品牌」阈值：至少 6 个品, 且不低于类目中位品牌商品数的 2 倍 */
    b.fatThreshold = Math.max(6, Math.ceil(b.medBrandItems * 2));
  }

  _cache = idx; _cacheAt = now; _cacheLen = all.length;
  return idx;
}

/* ---------------- 判定规则（对外可查：GET /api/products/insight-rules） ---------------- */
/** 规则表：与下面 annotate() 里的 if 顺序严格一一对应。
 *  改判定逻辑时【必须同步改这里】—— 界面上的「❓ 选品规则」就是读这份数据渲染的。 */
const RULES = [
  { tone: 'hot', label: '精品强链接', short: '精品', color: '#f28b8b', verdict: '别正面刚',
    condition: '需求强度前 25% + 该品牌在本类目 ≤3 个品',
    advice: '一条链接打天下 —— 学它的价格带和配置, 不要正面拼' },
  { tone: 'wide', label: '铺货型', short: '铺货', color: '#7ee2a8', verdict: '壁垒低可跟进',
    condition: '需求强度前 25% + 品牌铺货量 ≥ 铺货线',
    advice: '靠数量占位、没有强壁垒 —— 可以跟进, 拼的是选品和效率' },
  { tone: 'junk', label: '垃圾铺货', short: '垃圾', color: '#8b93a0', verdict: '别学',
    condition: '需求强度后 50% + 品牌铺货量 ≥ 铺货线',
    advice: '没量还铺得多 —— 不要参考它的价格和配置' },
  { tone: 'chance', label: '潜力样板', short: '潜力', color: '#8ab4ff', verdict: '可抄',
    condition: '上架 ≤365 天 + 跟卖 ≤3 + 评论 ≤100 + 需求强度 ≥ P50',
    advice: '刚起来就有量、还没被围剿 —— 可抄配置和定价, 尽快上' },
  { tone: 'normal', label: '常规', short: '常规', color: '#c8b98a', verdict: '再判断',
    condition: '以上都不满足',
    advice: '中位水平 —— 结合价格带和利润再判断' },
  { tone: 'none', label: '无需求数据', short: '缺需求', color: '#6b7480', verdict: '只做价格带',
    condition: '既无月销量、也无排名（或类目有效样本 <5）',
    advice: '只能按价格带定位, 建议补采月销或排名' },
  { tone: 'nodata', label: '数据不足', short: '缺数据', color: '#5f6670', verdict: '先补采',
    condition: '没有上级类目 / 没有价格',
    advice: '补采类目后即可分析' },
];

/** 阈值（界面展示用；annotate() 里是同一组数） */
const THRESHOLDS = {
  demandStrongPct: 75,      // 需求强度前 25%（分位 ≥0.75）
  demandMidPct: 50,         // 需求强度后 50%（分位 <0.50）
  brandSingleMax: 3,        // 「一条链接」：品牌在本类目 ≤3 个品
  fatMin: 6,                // 铺货线下限
  fatMedianMult: 2,         // 铺货线 = max(6, 类目中位品牌商品数 × 2)
  freshDays: 365,           // 上架天数 ≤365 算"新"
  followQuietMax: 3,        // 跟卖数 ≤3 算"没被围剿"
  reviewsQuietMax: 100,     // 评论数 ≤100 算"还没起评论"
};
const RULES_META = {
  demandBasis: '需求强度优先用「销售额分位」(价格×月销量)；没有月销量时退用「类目排名分位」；两者都没有 → 无需求数据',
  groupBy: '对比基准 = 同站点 + 同上级类目（bsr[0].category → bsrShopCat → cat1）',
  note: '标签由它在本类目内的相对位置决定, 不是绝对值。卡片悬停可看到这一条的实际判定依据与数值。',
  coverageGap: '当前约 64% 的品没有上级类目（绝大多数来自 brand-links 品牌链采集, 该路径不采类目）→ 只能标「数据不足」, 补采类目后即可分析。',
};

/* ---------------- 标签定义 ---------------- */
const TONES = {
  hot:    { tone: 'hot',    color: '#f28b8b', short: '精品',   label: '精品强链接', verdict: '别正面刚',
            advice: '一条链接打天下 —— 学它的价格带和配置, 不要正面拼' },
  wide:   { tone: 'wide',   color: '#7ee2a8', short: '铺货',   label: '铺货型', verdict: '壁垒低可跟进',
            advice: '靠数量占位、没有强壁垒 —— 可以跟进, 拼的是选品和效率' },
  chance: { tone: 'chance', color: '#8ab4ff', short: '潜力',   label: '潜力样板', verdict: '可抄',
            advice: '刚起来就有量、还没被围剿 —— 可抄配置和定价, 尽快上' },
  junk:   { tone: 'junk',   color: '#8b93a0', short: '垃圾',   label: '垃圾铺货', verdict: '别学',
            advice: '没量还铺得多 —— 不要参考它的价格和配置' },
  normal: { tone: 'normal', color: '#c8b98a', short: '常规',   label: '常规', verdict: '再判断',
            advice: '中位水平 —— 结合价格带和利润再判断' },
  nodata: { tone: 'nodata', color: '#5f6670', short: '缺数据', label: '数据不足', verdict: '先补采',
            advice: '缺价格或类目, 无法判断 —— 先补采' },
  none:   { tone: 'none',   color: '#6b7480', short: '缺需求', label: '无需求数据', verdict: '只做价格带',
            advice: '既无月销量也无排名 —— 只能按价格带定位, 建议补采月销或排名' },
};

/**
 * 给一页商品打标签。
 * @param {Array} items 要返回给前端的商品（会被就地加上 insight 字段）
 * @param {Array} all   全量商品库（用来算类目基准）
 */
function annotate(items, all) {
  if (!Array.isArray(items) || !items.length) return items;
  let idx;
  try { idx = buildIndex(Array.isArray(all) ? all : items); }
  catch (e) { return items; }

  for (const x of items) {
    try {
      const cat = bigCat(x);
      const b = cat ? idx.get(String(x.site || '?') + '|' + cat) : null;
      const price = num(x.price);
      const ms = num(x.monthlySales);
      const rank = rankOf(x);
      const why = [];
      const rel = { cat: cat, price: price, monthlySales: ms, rank: rank, catN: b ? b.n : 0 };

      if (!b) {
        why.push('该品没有上级类目（采集来源 ' + (x.source || '?') + ' 没带类目）');
        why.push('补采类目后即可分析');
        x.insight = Object.assign({ why: why, rel: rel }, TONES.nodata);
        continue;
      }
      /* 价格分位（几乎人人都有，拿来做「价格带定位」的兜底信息） */
      rel.pricePct = (price !== null && b.prices.length >= 5) ? Math.round(pctRank(b.prices, price) * 100) : null;

      /* ---- 需求强度：月销 → 排名 → 无 ---- */
      let basis = null, demandPct = null, rev = null;
      if (ms !== null && ms >= 0 && price !== null && price > 0 && b.revs.length >= 5 && b.p75rev > 0) {
        rev = price * ms;
        demandPct = pctRank(b.revs, rev);
        basis = 'sales';
      } else if (rank !== null && b.ranks.length >= 5) {
        demandPct = 1 - pctRank(b.ranks, rank);   // 排名越靠前 → 分位越高
        basis = 'rank';
      }

      if (basis === null) {
        if (ms !== null) why.push('类目里可算销售额的样本太少(' + b.revs.length + ' 条)');
        else if (rank !== null) why.push('类目里有排名的样本太少(' + b.ranks.length + ' 条)');
        else why.push('无月销量、也无排名');
        if (rel.pricePct !== null) why.push('价格处类目 P' + rel.pricePct);
        x.insight = Object.assign({ why: why, rel: rel }, TONES.none);
        continue;
      }

      const brand = brandOf(x), seller = sellerOf(x);
      const brandItems = b.brands.get(brand) || 1;
      const follow = num(x.followCount);
      const reviews = num(x.reviews);
      const age = ageDays(x.listedAt);
      const fat = brandItems >= b.fatThreshold;

      rel.rev = rev !== null ? Math.round(rev * 100) / 100 : null;
      rel.revPct = rev !== null ? Math.round(pctRank(b.revs, rev) * 100) : null;
      rel.msPct = ms !== null ? Math.round(pctRank(b.mss, ms) * 100) : null;
      rel.rankPct = basis === 'rank' ? Math.round(demandPct * 100) : null;
      rel.demandPct = Math.round(demandPct * 100);
      rel.basis = basis;
      rel.brandItems = brandItems;
      rel.sellerItems = b.sellers.get(seller) || 1;
      rel.fatThreshold = b.fatThreshold;
      rel.follow = follow;
      rel.reviews = reviews;
      rel.ageDays = age;

      const dLabel = basis === 'sales'
        ? ('销售额处类目 P' + rel.revPct)
        : ('排名处类目前 ' + Math.max(1, 100 - rel.rankPct) + '%');

      let tone;
      if (demandPct >= 0.75 && brandItems <= 3) {
        tone = 'hot';
        why.push(dLabel);
        why.push('该品牌在本类目只有 ' + brandItems + ' 个品');
        if (follow !== null) why.push('跟卖 ' + follow + ' 个');
      } else if (demandPct >= 0.75 && fat) {
        tone = 'wide';
        why.push(dLabel);
        why.push('该品牌在本类目铺了 ' + brandItems + ' 个品(铺货线 ' + b.fatThreshold + ')');
      } else if (demandPct < 0.50 && fat) {
        tone = 'junk';
        why.push(dLabel);
        why.push('该品牌却铺了 ' + brandItems + ' 个品');
      } else if (age !== null && age <= 365 && demandPct >= 0.50
                 && (follow === null || follow <= 3) && (reviews === null || reviews <= 100)) {
        tone = 'chance';
        why.push('上架 ' + age + ' 天');
        why.push(dLabel);
        if (follow !== null) why.push('跟卖 ' + follow + ' 个');
        if (reviews !== null) why.push('评论 ' + reviews);
      } else {
        tone = 'normal';
        why.push(dLabel + (rel.msPct !== null ? ' · 月销 P' + rel.msPct : ''));
      }

      x.insight = Object.assign({ why: why, rel: rel }, TONES[tone]);
    } catch (e) {
      try { x.insight = Object.assign({ why: ['计算异常: ' + String(e && e.message || e)] }, TONES.nodata); } catch (e2) {}
    }
  }
  return items;
}

module.exports = {
  annotate, bigCat, TONES, RULES, THRESHOLDS, RULES_META,
  _internals: { buildIndex, pctRank, quantile, brandOf, sellerOf, rankOf },
};

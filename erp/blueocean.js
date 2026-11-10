/**
 * 蓝海选品分析（blueocean）
 * =============================================================================
 * 输入：商品库（products 数组，见 ~/.zying-erp/data/products.json）
 * 输出：类目蓝海评分 + 单品候选 + 商标风险闸门
 *
 * 设计原则：
 *  1) 纯函数，不碰网络、不碰浏览器 —— 采集/补采由 server 侧已有链路负责，本模块只做判定
 *  2) 缺字段不冒充数据：价格/月销缺失的记录直接排除，其余指标标注覆盖率
 *  3) 评分可解释：每项权重写死并回传明细，便于复盘调整
 *  4) 排除类目：服装 / 美妆 / 药品 / 婴幼儿 —— 按类目路径关键词硬挡
 *
 * 蓝海分（0-100）：
 *   集中度 40（CR10 越低分越高，CR10=0 得满分）
 *   需求   25（类目中位月销 / 60，封顶 1）
 *   价带   20（中位价距离 25 的偏离，越近越高；适配 15-40 美金小件）
 *   商标   15（无商标占比）
 * 单品分（0-100）：
 *   小件 30（重量越轻越高，0.6kg 以上归零）
 *   低竞争 25（评论数越少越高，500 条归零）
 *   销量 25（月销 / 80，封顶 1）
 *   干净 20（商标数 0 且无专利风险）
 */
'use strict';

/** 排除：出现这些词就整类跳过 */
const EXCLUDE = [
  'apparel', 'clothing', 'fashion', 'beauty', 'cosmetic', 'personal care',
  'skin care', 'hair', 'makeup', 'drug', 'pharma', 'medicine', 'supplement',
  'baby', 'infant', 'toddler', 'jewel', 'watch', 'shoe', 'bag', 'handbag',
];

/** 目标分组：只在这些类目里找 */
const TARGETS = {
  五金工具: ['hardware', 'tools', 'diy', 'home improvement', 'baumarkt', 'garden',
    'automotive', 'industrial', 'fastener', 'abrasive', 'lighting'],
  户外运动: ['sport', 'outdoor', 'camping', 'fishing', 'hunting', 'hiking',
    'cycling', 'fitness', 'climbing', 'kayak'],
  百货家居: ['home', 'kitchen', 'household', 'storage', 'organizer', 'office',
    'stationery', 'pet', 'toys', 'cleaning'],
};

function num(v, d = 0) {
  if (v === null || v === undefined || v === '') return d;
  const m = String(v).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : d;
}

function catText(p) {
  const t = [p.cat1, p.cat2, p.cat3, p.category].filter(Boolean).join(' > ').toLowerCase();
  // ListPage 是采集来源标记，不是真实类目
  return t.replace(/listpage/g, '');
}

/** 命中目标分组；被排除类目优先返回 null */
function groupOf(p) {
  const t = catText(p);
  if (!t) return null;
  for (const k of EXCLUDE) if (t.includes(k)) return null;
  for (const [g, keys] of Object.entries(TARGETS)) {
    if (keys.some((k) => t.includes(k))) return g;
  }
  return null;
}

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * 主分析
 * @param {Array} products 商品库
 * @param {Object} opt { sites, groups, maxWeightKg, priceMin, priceMax, minSales, minSample, limit, requireTrademarkFree }
 */
function analyze(products, opt = {}) {
  const sites = opt.sites || ['de', 'uk', 'au', 'us'];
  const groups = opt.groups || Object.keys(TARGETS);
  const maxWeight = Number(opt.maxWeightKg ?? 0.6);
  const priceMin = Number(opt.priceMin ?? 10);
  const priceMax = Number(opt.priceMax ?? 60);
  const minSales = Number(opt.minSales ?? 10);
  const minSample = Number(opt.minSample ?? 8);
  const limit = Math.min(Number(opt.limit ?? 50), 300);
  const tmFreeOnly = opt.requireTrademarkFree !== false;

  const pool = [];
  const coverage = { total: products.length, bySite: {}, used: 0 };

  for (const p of products) {
    const site = String(p.site || '').toLowerCase();
    if (!sites.includes(site)) continue;
    const g = groupOf(p);
    if (!g || !groups.includes(g)) continue;
    coverage.bySite[site] = (coverage.bySite[site] || 0) + 1;

    const price = num(p.price) || num(p.buyBoxPrice);
    const sales = num(p.monthlySales) || num(p.sales30d);
    if (price <= 0 || sales <= 0) continue;          // 缺关键字段直接排除
    const weight = num(p.weight);
    const reviews = num(p.reviews);
    const tm = num(p.trademarkCount);
    if (tmFreeOnly && (tm > 0 || p.patentRisk)) continue;

    pool.push({
      asin: p.asin, site, group: g,
      cat: String(p.cat1 || ''), cat3: String(p.cat3 || ''),
      title: String(p.title || '').slice(0, 120),
      brand: p.brand || '', url: p.url || '',
      price, sales, reviews, weight,
      rating: num(p.rating), bsr: num(p.bsr), fba: num(p.fbaFee),
      tm, follow: num(p.followCount), amazon: Boolean(p.amazonSell),
    });
  }
  coverage.used = pool.length;

  // ── 类目聚合 ──
  const buckets = new Map();
  for (const k of pool) {
    const key = `${k.site}|${k.cat || k.group}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(k);
  }

  const markets = [];
  for (const [key, items] of buckets) {
    if (items.length < minSample) continue;
    const [site, cat] = key.split('|');
    const sales = items.map((x) => x.sales);
    const total = sales.reduce((a, b) => a + b, 0) || 1;
    const top10 = [...sales].sort((a, b) => b - a).slice(0, 10).reduce((a, b) => a + b, 0) / total;
    const hhi = [...sales].reduce((a, s) => a + (s / total) ** 2, 0) * 10000;
    const priceMed = median(items.map((x) => x.price));
    const revMed = median(items.map((x) => x.reviews));
    const tmFree = items.filter((x) => x.tm === 0).length / items.length;
    const amzShare = items.filter((x) => x.amazon).length / items.length;
    const wMed = median(items.map((x) => x.weight));

    const scoreParts = {
      concentration: (1 - Math.min(top10, 1)) * 40,
      demand: Math.min(median(sales) / 60, 1) * 25,
      priceBand: (1 - Math.min(Math.abs(priceMed - 25) / 45, 1)) * 20,
      trademark: tmFree * 15,
    };
    markets.push({
      site, category: cat, sample: items.length,
      medianPrice: Number(priceMed.toFixed(2)),
      medianSales: Number(median(sales).toFixed(1)),
      medianReviews: Number(revMed.toFixed(0)),
      medianWeightKg: Number(wMed.toFixed(2)),
      cr10: Number(top10.toFixed(3)),
      hhi: Math.round(hhi),
      trademarkFreeRatio: Number(tmFree.toFixed(2)),
      amazonShare: Number(amzShare.toFixed(2)),
      score: Number(Object.values(scoreParts).reduce((a, b) => a + b, 0).toFixed(1)),
      scoreParts: Object.fromEntries(Object.entries(scoreParts).map(([k, v]) => [k, Number(v.toFixed(1))])),
    });
  }
  markets.sort((a, b) => b.score - a.score);

  // ── 单品候选：只看类目分前 8 的类目，避免长尾干扰 ──
  const topCats = new Set(markets.slice(0, 8).map((m) => `${m.site}|${m.category}`));
  const candidates = [];
  for (const k of pool) {
    if (!topCats.has(`${k.site}|${k.cat || k.group}`)) continue;
    if (k.price < priceMin || k.price > priceMax) continue;
    if (k.sales < minSales) continue;
    if (k.weight <= 0) continue;                 // 没重量无法判断"小件"，不入选
    if (k.weight > maxWeight) continue;
    const parts = {
      small: Math.max(0, 1 - k.weight / maxWeight) * 30,
      // 评论数缺失（0）不冒充"零竞争"：不给分，并标记 reviewUnknown
      lowReview: k.reviews > 0 ? Math.max(0, 1 - k.reviews / 500) * 25 : 0,
      sales: Math.min(k.sales / 80, 1) * 25,
      clean: k.tm === 0 ? 20 : 0,
    };
    candidates.push({
      ...k,
      reviewUnknown: k.reviews <= 0,
      score: Number(Object.values(parts).reduce((a, b) => a + b, 0).toFixed(1)),
      scoreParts: Object.fromEntries(Object.entries(parts).map(([x, v]) => [x, Number(v.toFixed(1))])),
    });
  }
  candidates.sort((a, b) => b.score - a.score);

  return {
    ok: true,
    at: new Date().toISOString(),
    meta: {
      filters: { sites, groups, maxWeightKg: maxWeight, priceMin, priceMax, minSales, minSample, tmFreeOnly },
      coverage,
      note: '价格/月销缺失的记录已排除；评论与重量覆盖率低时，类目分仅供参考',
    },
    markets: markets.slice(0, 30),
    candidates: candidates.slice(0, limit),
  };
}

module.exports = { analyze, groupOf, TARGETS, EXCLUDE };

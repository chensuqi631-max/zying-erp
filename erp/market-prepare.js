#!/usr/bin/env node
/**
 * 市场分析 · 数据转换器 (P0)
 * ==================================================================
 * 作用: 把 ~/.zying-erp/data/products.json 转成 market_metrics.py 能吃的格式。
 *
 * 用法:
 *   node market-prepare.js --site au --cat Automotive
 *   node market-prepare.js --site au --cat Automotive --out ../out.json
 *   node market-prepare.js --list                 # 只列可分析的 站点×类目
 *
 * 为什么要这一层（而不是直接喂 products.json）:
 *   ① 字段名不一样      monthlySales → monthly_sales / mainSeller → seller /
 *                      listedAt(日期) → listing_age_days(天数)
 *   ② brand 带杂质      "Lorynix 1个已申请" → 不剥掉品牌集中度会算废
 *   ③ 类目要归类        bsrCatName 是四级末级类目, 样本太薄; bsr[0].category 是上级
 *   ④ 要剔除噪音        无月销量 / 无价格 / 采集模式名漏进类目字段
 *
 * 已知限制（如实标注, 不隐藏）:
 *   · 不抓数据 —— 只做格式转换
 *   · 不算税费
 *   · 月销量的覆盖取决于【采集方式】: 详情页采集有、列表页直采(cdp-list-direct)没有
 *   · 样本是【按品牌/卖家】采来的, 不是「类目 Top N」→ 代表性由 prepare 报告的 bsr 分布量化
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

/* ---------------- 参数 ---------------- */
const argv = process.argv.slice(2);
function arg(name, def) {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
}
const FLAG = (n) => argv.includes('--' + n);

const DATA_DIR = process.env.ZYING_DATA ||
  path.join(os.homedir(), '.zying-erp', 'data');
const PRODUCTS = path.join(DATA_DIR, 'products.json');

const SITE = arg('site', null);
const CAT = arg('cat', null);
const OUT = arg('out', null);
const LIST = FLAG('list');
const MIN_KEEP = Number(arg('min', '50'));      // SOP 门槛: Top 50

/* ---------------- 工具 ---------------- */
const nn = (v) => v !== null && v !== undefined && v !== '';
/* ★ 2026-10-18 修坑: 原来 `Number(String(v).replace(/[^\d.\-]/g,''))` 会把 null 变成 ''，
 *   而 Number('') === 0 —— 于是【缺月销量】的商品被当成"月销 0"保留进了样本，
 *   导致 row_count_kept 虚高、avg_monthly_sales_per_item 被稀释、价格带里全是 0 销量。
 *   这与 listCategories 的 usable 判定（用 nn）不一致。现在按原意把它们计入 dropped.noSales。 */
const num = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/[^\d.\-]/g, '');
  if (s === '' || s === '-' || s === '.' || s === '-.') return null;
  const n = Number(s);
  return isFinite(n) ? n : null;
};

/** 品牌清洗 —— 剥掉采集器混进来的标记, 否则同一个牌子会被拆成多个, 品牌集中度算废 */
function cleanBrand(b) {
  if (!nn(b)) return null;
  return String(b)
    .replace(/\s*\d*\s*个?\s*已?\s*(申请|注册|备案)\s*$/g, '')   // "Lorynix 1个已申请"
    .replace(/^Visit the\s+/i, '')                              // "Visit the XXX Store"
    .replace(/\s+Store$/i, '')
    .replace(/\s+/g, ' ')
    .trim() || null;
}

/** 采集模式名 —— 它们不是商品类目, 必须排除（否则"排除其他类目"会牵连全部无类目商品） */
const MODE_NAMES = new Set(['Links', 'FollowShop', 'ListDirect', 'ListFiltered', 'ListPage',
  'Search', 'Shop', 'CategorySearch', 'BrandBatch', 'SiteBulk', 'PanelShop', 'ShopList']);

/** 取上级类目: 优先 bsr[0].category（已验证是宽类目）, 退回 bsrShopCat / cat1 */
function bigCat(x) {
  if (Array.isArray(x.bsr) && x.bsr.length && x.bsr[0] && x.bsr[0].category) return x.bsr[0].category;
  if (nn(x.bsrShopCat) && !MODE_NAMES.has(x.bsrShopCat)) return x.bsrShopCat;
  if (nn(x.cat1) && !MODE_NAMES.has(x.cat1)) return x.cat1;
  return null;
}
/** 取末级类目 */
function leafCat(x) {
  if (nn(x.bsrCatName) && !MODE_NAMES.has(x.bsrCatName)) return x.bsrCatName;
  if (nn(x.cat2) && !MODE_NAMES.has(x.cat2)) return x.cat2;
  if (nn(x.category) && !MODE_NAMES.has(x.category)) return x.category;
  return null;
}
/** 上架天数 */
function ageDays(listedAt, now) {
  if (!nn(listedAt)) return null;
  const t = Date.parse(String(listedAt).trim());
  if (!isFinite(t)) return null;
  return Math.max(0, Math.round((now - t) / 86400000));
}

/* ---------------- 读库 ---------------- */
if (!fs.existsSync(PRODUCTS)) { console.error('✗ 找不到商品库: ' + PRODUCTS); process.exit(1) }
const raw = JSON.parse(fs.readFileSync(PRODUCTS, 'utf8'));
const all = Array.isArray(raw) ? raw : (raw.products || raw.items || []);
const NOW = Date.now();

/* ---------------- --list: 列出所有 站点×类目 及其可分析条数 ---------------- */
if (LIST) {
  const map = new Map();
  for (const x of all) {
    const site = x.site || '?';
    const big = bigCat(x);
    if (!big) continue;
    const k = site + '|' + big;
    if (!map.has(k)) map.set(k, { site, big, n: 0, withSales: 0, withPrice: 0, bsrTop100: 0 });
    const o = map.get(k);
    o.n++;
    if (nn(x.monthlySales)) o.withSales++;
    if (nn(x.price)) o.withPrice++;
    const r = num(x.bsrCat);
    if (r !== null && r > 0 && r <= 100) o.bsrTop100++;
  }
  const rows = [...map.values()]
    .map((o) => ({ ...o, usable: all.filter((x) => (x.site || '?') === o.site && bigCat(x) === o.big &&
      nn(x.monthlySales) && nn(x.price)).length }))
    .sort((a, b) => b.usable - a.usable);
  console.log('站点  上级类目                          商品数  有月销  可分析  够50?  前100名');
  for (const r of rows.slice(0, 40)) {
    console.log('  ' + r.site.padEnd(5) + r.big.padEnd(34).slice(0, 34) +
      String(r.n).padStart(6) + String(r.withSales).padStart(8) + String(r.usable).padStart(8) +
      (r.usable >= MIN_KEEP ? '    ✅' : '     ·') + String(r.bsrTop100).padStart(8));
  }
  console.log('\n共 ' + rows.length + ' 个 站点×类目；够 ' + MIN_KEEP + ' 条的有 ' +
    rows.filter((r) => r.usable >= MIN_KEEP).length + ' 个');
  process.exit(0);
}

/* ---------------- 转换 ---------------- */
if (!SITE || !CAT) {
  console.error('用法: node market-prepare.js --site au --cat Automotive');
  console.error('      node market-prepare.js --list');
  process.exit(1);
}

const pool = all.filter((x) => (x.site || '') === SITE && bigCat(x) === CAT);
if (!pool.length) { console.error('✗ 没找到 ' + SITE + ' / ' + CAT + ' 的商品'); process.exit(1) }

const dropped = { noSite: 0, noCat: 0, noSales: 0, noPrice: 0, modeName: 0 };
const items = [];
for (const x of pool) {
  /* ★ 修(2026-10-06): 原来这里 `continue` 掉了整条商品 —— 错。
   *   category 字段是【采集模式名】(FollowShop/ListDirect/…) 只说明"末级类目没采到",
   *   不代表商品本身不可分析（它可能有月销量、有价格、有 bsr[0] 上级类目）。
   *   误剔实测: AU Automotive 109 条里剔掉了 42 条 → 可分析只剩 67。
   *   正确做法: 只把该字段当"没有末级类目"，商品保留。归属已由 bigCat() 用 bsr[0] 决定。 */
  if (nn(x.category) && MODE_NAMES.has(String(x.category))) dropped.modeName++;
  const sales = num(x.monthlySales);
  const price = num(x.price);
  if (sales === null || sales < 0) { dropped.noSales++; continue }
  if (price === null || price <= 0) { dropped.noPrice++; continue }
  items.push({
    title: String(x.title || '').slice(0, 200),
    price,
    monthly_sales: sales,
    monthly_revenue: +(price * sales).toFixed(2),
    seller: nn(x.mainSeller) ? String(x.mainSeller) : null,
    brand: cleanBrand(x.brand),
    rating: num(x.rating),
    review_count: num(x.reviews),
    listing_age_days: ageDays(x.listedAt, NOW),
    url: 'https://www.amazon.' + ({ au: 'com.au', uk: 'co.uk', de: 'de', us: 'com' }[SITE] || SITE) + '/dp/' + x.asin,
    category: leafCat(x),
    /* ---- 以下为扩展字段, 脚本会忽略, 但下游(单品候选/偏差量化)要用 ---- */
    asin: x.asin,
    cat_big: CAT,
    follow_count: num(x.followCount),
    fulfill: x.fulfill || null,
    amazon_sell: x.amazonSell || null,
    patent_risk: !!x.patentRisk,
    tm_mark: !!x.tmMark,
    is_1688: !!x.is1688,
    bsr_cat: num(x.bsrCat),
    bsr_shop: num(x.bsrShop),
    currency: x.currency || null
  });
}

/* ---------------- 样本质量 ---------------- */
const withBsr = items.filter((i) => i.bsr_cat !== null && i.bsr_cat > 0);
const bsrBuck = [0, 0, 0, 0, 0];
for (const i of withBsr) {
  if (i.bsr_cat <= 100) bsrBuck[0]++;
  else if (i.bsr_cat <= 1000) bsrBuck[1]++;
  else if (i.bsr_cat <= 10000) bsrBuck[2]++;
  else bsrBuck[4]++;
}
const quality = {
  sample_ok: items.length >= MIN_KEEP,
  sales_coverage: pool.length ? +(items.length / pool.length * 100).toFixed(1) : 0,
  bsr_covered: withBsr.length,
  bsr_top100: bsrBuck[0],
  bsr_buckets: bsrBuck,
  /** 代表性自评 —— 供报告打标, 不隐藏 */
  caveat: bsrBuck[0] / (withBsr.length || 1) >= 0.8
    ? '样本内多数商品在各自细分品类前 100 名, 品类覆盖宽度够; 但仍是按品牌/卖家采集, 不是「类目 Top N」'
    : '前 100 名占比偏低, 尾巴较长 → 集中度指标可能有偏差, 建议优先看价格带'
};

const out = {
  meta: {
    site: SITE, category_raw: CAT, category_rollup: CAT,
    generated_at: new Date().toISOString(),
    source_file: PRODUCTS,
    row_count_raw: pool.length, row_count_kept: items.length,
    dropped, quality
  },
  items
};

/* ---------------- 写盘 ---------------- */
const outPath = OUT || path.join(DATA_DIR, 'market',
  SITE + '-' + CAT.replace(/[^\w\u4e00-\u9fa5]+/g, '_') + '.normalized.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(out, null, 1), 'utf8');

console.log('=== 转换完成 ===');
console.log('  站点/类目   : ' + SITE + ' / ' + CAT);
console.log('  原始        : ' + pool.length + ' 条');
console.log('  可分析      : ' + items.length + ' 条' + (items.length >= MIN_KEEP ? '  ✅ 够' : '  ⚠️ 不足 ' + MIN_KEEP));
console.log('  剔除        : 无月销量 ' + dropped.noSales + ' · 无价格 ' + dropped.noPrice +
  ' · 模式名 ' + dropped.modeName);
console.log('  月销量覆盖  : ' + quality.sales_coverage + '%');
console.log('  BSR 前100名 : ' + quality.bsr_top100 + ' / ' + quality.bsr_covered);
console.log('  样本自评    : ' + quality.caveat);
console.log('  输出        : ' + outPath);

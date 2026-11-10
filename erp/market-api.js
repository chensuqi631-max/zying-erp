/**
 * 市场分析 API · 最小可用版 (A)
 * ==================================================================
 * 设计取向: 不改 client.js, 直接返回自包含 HTML —— 打开 URL 就能用。
 *   GET /api/market/list                                  → 可分析类目列表(HTML)
 *   GET /api/market/list?format=json                      → JSON
 *   GET /api/market/analyze?site=au&cat=Automotive        → 分析报告(HTML)
 *   GET /api/market/analyze?...&format=json               → 原始 metrics JSON
 *   GET /api/market/analyze?...&format=md                 → Markdown 原文
 *
 * 数据链路: products.json → market-prepare.js → market_metrics.py → 报告
 * 依赖: Python 需可用(用 py launcher, 不用 PATH 里的 python —— 那可能指向别的 venv)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const DATA_DIR = process.env.ZYING_DATA || path.join(os.homedir(), '.zying-erp', 'data');
const PRODUCTS = path.join(DATA_DIR, 'products.json');
const MARKET_DIR = path.join(DATA_DIR, 'market');
const ERP_DIR = __dirname;
const PREPARE = path.join(ERP_DIR, 'market-prepare.js');
const METRICS_PY = process.env.ZYING_MARKET_PY ||
  'D:\\智赢erp\\_ref\\x\\AI-Cross-Border-Ecommerce-Agent-Toolkit-main\\Agents\\01_Market_Research_Agent\\scripts\\market_metrics.py';

const SITE_CCY = { au: 'AUD', uk: 'GBP', de: 'EUR', us: 'USD', fr: 'EUR', it: 'EUR', es: 'EUR', jp: 'JPY', ca: 'CAD' };
const SITE_HINT = { au: '澳洲', uk: '英国', de: '德国', us: '美国', fr: '法国', it: '意大利', es: '西班牙', jp: '日本', ca: '加拿大' };
const MODE_NAMES = new Set(['Links', 'FollowShop', 'ListDirect', 'ListFiltered', 'ListPage',
  'Search', 'Shop', 'CategorySearch', 'BrandBatch', 'SiteBulk', 'PanelShop', 'ShopList']);

const nn = (v) => v !== null && v !== undefined && v !== '';
function bigCat(x) {
  if (Array.isArray(x.bsr) && x.bsr.length && x.bsr[0] && x.bsr[0].category) return x.bsr[0].category;
  if (nn(x.bsrShopCat) && !MODE_NAMES.has(x.bsrShopCat)) return x.bsrShopCat;
  if (nn(x.cat1) && !MODE_NAMES.has(x.cat1)) return x.cat1;
  return null;
}
function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
}

/* ---------------- 列出可分析类目 ---------------- */
let _catCache = null, _catAt = 0;
function listCategories() {
  const now = Date.now();
  if (_catCache && now - _catAt < 60000) return _catCache;      // 60s 缓存
  const raw = JSON.parse(fs.readFileSync(PRODUCTS, 'utf8'));
  const all = Array.isArray(raw) ? raw : (raw.products || raw.items || []);
  const map = new Map();
  for (const x of all) {
    const site = x.site || '?';
    const big = bigCat(x);
    if (!big) continue;
    const k = site + '|' + big;
    if (!map.has(k)) map.set(k, { site, cat: big, n: 0, usable: 0, bsrTop100: 0 });
    const o = map.get(k);
    o.n++;
    if (nn(x.monthlySales) && nn(x.price)) o.usable++;
    const r = Number(String(x.bsrCat || '').replace(/[^\d.]/g, ''));
    if (isFinite(r) && r > 0 && r <= 100) o.bsrTop100++;
  }
  const rows = [...map.values()].sort((a, b) => b.usable - a.usable || a.site.localeCompare(b.site));
  _catCache = rows; _catAt = now;
  return rows;
}

/* ---------------- 跑分析 ---------------- */
function analyze(site, cat) {
  fs.mkdirSync(MARKET_DIR, { recursive: true });

  /* ① 转换 */
  const prep = spawnSync(process.execPath, [PREPARE, '--site', site, '--cat', cat], {
    encoding: 'utf8', timeout: 120000,
  });
  if (prep.status !== 0) {
    return { ok: false, step: 'prepare', err: (prep.stderr || prep.stdout || '').slice(0, 800) };
  }
  const normFile = path.join(MARKET_DIR,
    site + '-' + cat.replace(/[^\w\u4e00-\u9fa5]+/g, '_') + '.normalized.json');
  if (!fs.existsSync(normFile)) return { ok: false, step: 'prepare', err: '转换产物不存在: ' + normFile };

  /* ② 算指标（Python 原脚本） */
  const py = process.env.ZYING_PY || 'py';
  const run = spawnSync(py, [METRICS_PY, normFile, '--bins', '8'], { encoding: 'utf8', timeout: 120000 });
  const mdFile = normFile.replace(/\.normalized\.json$/, '.normalized.metrics.md');
  const jsFile = normFile.replace(/\.normalized\.json$/, '.normalized.metrics.json');
  if (!fs.existsSync(mdFile)) {
    return { ok: false, step: 'metrics', err: ((run.stderr || '') + (run.stdout || '')).slice(0, 800) };
  }

  const norm = JSON.parse(fs.readFileSync(normFile, 'utf8'));
  const metrics = fs.existsSync(jsFile) ? JSON.parse(fs.readFileSync(jsFile, 'utf8')) : null;
  let md = fs.readFileSync(mdFile, 'utf8');

  /* ③ 修 Python 脚本的币种硬编码 bug: 报告里写死 R$(巴西雷亚尔), 实际是站点币种 */
  const ccy = SITE_CCY[site] || '';
  if (ccy) md = md.replace(/R\$\s?/g, ccy + ' ');

  return { ok: true, site, cat, norm, metrics, md, ccy,
    files: { normalized: normFile, metrics_md: mdFile, metrics_json: jsFile } };
}

/* ---------------- 样式（与 demo 同一套视觉） ---------------- */
const CSS = `
:root{--bg:#0e1013;--panel:#161a1f;--panel2:#1b2027;--line:#262c34;--fg:#e6e9ee;--dim:#8b93a0;
--ok:#7ee2a8;--warn:#e0b25c;--bad:#f28b8b;--accent:#5b9bf5}
*{box-sizing:border-box}html,body{margin:0;padding:0;background:var(--bg);color:var(--fg);
font:13px/1.65 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
.wrap{max-width:940px;margin:0 auto;padding:16px 18px 60px}
.hd{display:flex;align-items:center;gap:10px;padding-bottom:12px;border-bottom:1px solid var(--line);margin-bottom:16px}
.hd h1{font-size:15px;margin:0;font-weight:600}.hd .r{margin-left:auto;font-size:11px;color:var(--dim)}
.card{background:var(--panel);border:1px solid var(--line);border-radius:9px;padding:14px 16px;margin-bottom:12px}
.card h2{font-size:13px;margin:0 0 10px;font-weight:600}
.note{font-size:11.5px;color:var(--dim);line-height:1.7}
.hr{height:1px;background:var(--line);margin:11px 0}
.mono{font-family:ui-monospace,Consolas,monospace;font-variant-numeric:tabular-nums}
.ok{color:var(--ok)}.warn{color:var(--warn)}.bad{color:var(--bad)}.dim{color:var(--dim)}
.kv{display:flex;justify-content:space-between;font-size:12.5px;padding:3px 0}
.kv .k{color:var(--dim)}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.box{background:var(--panel2);border:1px solid var(--line);border-radius:7px;padding:9px 11px}
.box .l{font-size:11px;color:var(--dim)}.box .v{font-size:16px;font-weight:600;margin-top:2px;font-variant-numeric:tabular-nums}
.alert{border-radius:7px;padding:9px 12px;font-size:11.5px;line-height:1.7;border:1px solid;margin-bottom:8px}
.alert.info{background:#121a26;border-color:#243b52;color:#b9cbe0}
.alert.warn{background:#241f16;border-color:#4a3f22;color:#e0cf9f}
.alert.okb{background:#16241d;border-color:#2c4a3a;color:#b7e6cb}
.alert.badb{background:#241616;border-color:#4a2f2f;color:#f0c0c0}
table{width:100%;border-collapse:collapse;font-size:12px}
th,td{text-align:left;padding:4px 6px;border-bottom:1px solid var(--line)}
th{color:var(--dim);font-weight:500;font-size:11px}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
.bar{height:11px;background:#12161b;border-radius:3px;overflow:hidden}
.bar > i{display:block;height:100%;background:var(--accent)}
a{color:#8fb8f0}button{font-family:inherit}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
input,select,button{padding:5px 9px;border-radius:7px;border:1px solid var(--line);
background:var(--panel2);color:var(--fg);font-size:12px}
button{cursor:pointer}button.pri{background:#1d3550;border-color:#2d5a80;color:#cfe2f7}
pre{background:#12161b;border:1px solid var(--line);border-radius:7px;padding:10px;overflow:auto;
font-size:11px;line-height:1.6;max-height:520px}
`;

/* ---------------- 页头 + 选类目表单 ---------------- */
function pageShell(title, body) {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">
<title>${esc(title)}</title><style>${CSS}</style></head><body><div class="wrap">
<div class="hd"><h1>📊 类目市场分析</h1>
<div class="r">数据源 <span class="mono">products.json</span> · 口径与商品管理一致</div></div>
${body}
</div></body></html>`;
}

function renderList(rows) {
  const ok = rows.filter((r) => r.usable >= 50);
  let h = `<div class="card"><h2>① 选择要分析的类目</h2>
  <div class="note" style="margin-bottom:9px">够 50 条（SOP 门槛）的类目 <b class="ok">${ok.length}</b> 个，
  共 ${rows.length} 个 站点×类目。点「分析」直接出报告。</div>
  <table><thead><tr><th>站点</th><th>上级类目</th><th class="num">商品数</th>
  <th class="num">有月销量</th><th class="num">可分析</th><th class="num">前100名</th><th></th></tr></thead><tbody>`;
  for (const r of rows.slice(0, 60)) {
    const enough = r.usable >= 50;
    h += `<tr><td class="mono">${esc(r.site)} ${esc(SITE_HINT[r.site] || '')}</td>
      <td>${esc(r.cat)}</td>
      <td class="num">${r.n}</td><td class="num">${r.usable}</td>
      <td class="num ${enough ? 'ok' : 'dim'}">${r.usable}</td>
      <td class="num dim">${r.bsrTop100}</td>
      <td>${enough
        ? `<a href="/api/market/analyze?site=${encodeURIComponent(r.site)}&cat=${encodeURIComponent(r.cat)}">分析 →</a>`
        : '<span class="dim">样本少</span>'}</td></tr>`;
  }
  h += '</tbody></table></div>';
  h += `<div class="alert info">ⓘ <b>「前100名」</b>指该批商品在<b>各自细分品类</b>的排名里，
  有多少进了前 100 —— 这个数字用来评估样本代表性，越高越可信。</div>`;
  return pageShell('类目市场分析 · 选择类目', h);
}

/* ---------------- 报告页 ---------------- */
function renderReport(res) {
  const n = res.norm, m = res.metrics, q = n.meta.quality, c = res.ccy;
  const cap = m && m.market_capacity, br = m && m.brand_concentration, se = m && m.seller_concentration;
  const bands = (m && m.price_bands) || [];
  const f = (v, d) => (v === null || v === undefined ? '—' : Number(v).toFixed(d === undefined ? 2 : d));
  const fm = (v, d) => c + ' ' + Number(v).toLocaleString('en-US', { maximumFractionDigits: d === undefined ? 2 : d });

  let h = '';

  /* 数据体检 */
  h += `<div class="card"><h2>② 数据体检</h2><div class="grid4">
    <div class="box"><div class="l">原始</div><div class="v">${n.meta.row_count_raw}</div></div>
    <div class="box"><div class="l">可分析</div><div class="v ${n.meta.row_count_kept >= 50 ? 'ok' : 'warn'}">${n.meta.row_count_kept}</div></div>
    <div class="box"><div class="l">月销量覆盖</div><div class="v">${q.sales_coverage}%</div></div>
    <div class="box"><div class="l">BSR 前100名</div><div class="v">${q.bsr_top100}<span class="dim" style="font-size:12px">/${q.bsr_covered}</span></div></div>
  </div><div class="hr"></div>
  <div class="kv"><span class="k">剔除</span><b>无月销量 ${n.meta.dropped.noSales} · 无价格 ${n.meta.dropped.noPrice}</b></div>
  <div class="kv"><span class="k">末级类目字段是采集模式名的</span><b class="dim">${n.meta.dropped.modeName} 条（不影响归属，已置空）</b></div>
  <div class="hr"></div>
  <div class="alert ${q.bsr_top100 / (q.bsr_covered || 1) >= 0.8 ? 'okb' : 'warn'}">
    <b>样本自评：</b>${esc(q.caveat)}<br>
    <span class="dim">⚠️ 这批按【品牌/卖家】采来，不是「类目 Top N」—— 集中度反映的是样本内分布，与类目全量可能有偏差。</span>
  </div></div>`;

  if (!cap) {
    h += `<div class="alert badb">⛔ 样本不足，指标未生成</div>`;
    return pageShell('分析报告 · ' + res.cat, h);
  }

  /* 容量 */
  h += `<div class="card"><h2>③ 市场容量</h2><div class="grid4">
    <div class="box"><div class="l">月总销量</div><div class="v">${cap.total_monthly_sales.toLocaleString()}</div></div>
    <div class="box"><div class="l">月总销售额</div><div class="v" style="font-size:14px">${fm(cap.total_monthly_revenue, 0)}</div></div>
    <div class="box"><div class="l">均价</div><div class="v" style="font-size:14px">${fm(cap.avg_price)}</div></div>
    <div class="box"><div class="l">中位价</div><div class="v" style="font-size:14px">${fm(cap.median_price)}</div></div>
  </div><div class="hr"></div>
  <div class="kv"><span class="k">单商品平均月销量</span><b class="mono">${f(cap.avg_monthly_sales_per_item, 1)}</b></div>
  <div class="kv"><span class="k">价格范围</span><b class="mono">${fm(cap.price_min)} – ${fm(cap.price_max)}</b></div>
  </div>`;

  /* 集中度 */
  function conc(t, o) {
    if (!o) return '';
    const verdict = o.cr3 * 100 < 50
      ? '<span class="ok">✅ CR3 &lt; 50% → 白牌仍有机会</span>'
      : '<span class="warn">⚠️ CR3 &gt; 50% → 头部集中，谨慎进入</span>';
    let s = `<div class="box"><div class="l">${t}（${o.subject_count} 个）</div>
      <div class="kv"><span class="k">CR3（销售额）</span><b class="mono">${f(o.cr3 * 100, 1)}%</b></div>
      <div class="kv"><span class="k">CR10（销售额）</span><b class="mono">${o.cr10 !== undefined ? f(o.cr10 * 100, 1) + '%' : '—'}</b></div>
      <div class="kv"><span class="k">HHI</span><b class="mono">${f(o.hhi, 1)}</b></div>
      <div class="hr" style="margin:7px 0"></div><div class="note">${verdict}</div></div>`;
    return s;
  }
  h += `<div class="card"><h2>④ 集中度</h2><div class="grid2">
    ${conc('品牌', br)}${conc('卖家', se)}</div>`;
  if (br && br.top_list) {
    h += `<div class="hr"></div><div class="note" style="margin-bottom:5px"><b>Top 品牌</b>（销售额占比）</div>
    <table><thead><tr><th>#</th><th>品牌</th><th class="num">销售额</th>
    <th class="num">销售额占比</th><th class="num">销量占比</th><th class="num">商品数</th></tr></thead><tbody>`;
    for (const t of br.top_list.slice(0, 10)) {
      h += `<tr><td class="dim">${t.rank}</td><td>${esc(t.name)}</td>
        <td class="num mono">${fm(t.revenue, 0)}</td>
        <td class="num mono">${f(t.revenue_share * 100, 1)}%</td>
        <td class="num mono dim">${f(t.sales_share * 100, 1)}%</td>
        <td class="num dim">${t.item_count}</td></tr>`;
    }
    h += '</tbody></table>';
  }
  h += '</div>';

  /* 价格带 */
  if (bands.length) {
    const mx = Math.max(...bands.map((b) => b.sales || 0)) || 1;
    let lo = Infinity, hi = -Infinity;
    for (const b of bands) {
      if ((b.sales || 0) < mx * 0.05) { if (b.lo < lo) { /* 找断崖起点 */ } }
    }
    h += `<div class="card"><h2>⑤ 价格带（★ 本样本最可信）</h2>
    <table><thead><tr><th>价格段</th><th class="num">商品数</th><th class="num">总销量</th>
    <th>曲线</th><th class="num">总销售额</th><th class="num">单商品均销</th></tr></thead><tbody>`;
    for (const b of bands) {
      const pct = Math.round((b.sales || 0) / mx * 100);
      h += `<tr><td class="mono">${fm(b.lo)} – ${fm(b.hi)}</td>
        <td class="num">${b.item_count}</td><td class="num mono">${(b.sales || 0).toLocaleString()}</td>
        <td><div class="bar"><i style="width:${pct}%"></i></div></td>
        <td class="num mono">${fm(b.revenue || 0, 0)}</td>
        <td class="num mono dim">${f(b.avg_sales_per_item, 1)}</td></tr>`;
    }
    h += '</tbody></table></div>';
  }

  /* 操作 */
  h += `<div class="card"><h2>⑥ 导出</h2>
    <div class="row">
      <a href="?site=${encodeURIComponent(res.site)}&cat=${encodeURIComponent(res.cat)}&format=md">📄 Markdown 原文</a>
      <a href="?site=${encodeURIComponent(res.site)}&cat=${encodeURIComponent(res.cat)}&format=json">🧾 原始 JSON</a>
      <a href="/api/market/list">← 换个类目</a>
    </div>
    <div class="hr"></div>
    <div class="note">产物落盘位置：<br>
      <span class="mono">${esc(res.files.normalized)}</span><br>
      <span class="mono">${esc(res.files.metrics_md)}</span></div>
  </div>`;

  h += `<div class="alert info">ⓘ 本页是<b>最小可用版</b>：出「体检 + 容量 + 集中度 + 价格带」。
  价格带 SVG 图、配置机会、单品候选、结论卡在后续版本补上。</div>`;

  return pageShell('分析报告 · ' + res.cat, h);
}

module.exports = { listCategories, analyze, renderList, renderReport, SITE_CCY };

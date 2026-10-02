/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  多链接采集 —— 完整实现（自包含，可直接接入）
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * 【这套采集方式做什么】
 *   用户给多条亚马逊链接 → 只跳这些链接 → 采两类商品数据:
 *     ① 跟卖商家的【店铺商品】
 *     ② 这些商品去重后的【品牌商品】（含品牌跳转链接）
 *   全部适用「采集筛选」: 不通过的商品直接跳过、不入库
 *
 * 【支持的链接形态】
 *   · 店铺列表页   /s?me=A21HVBR9S9KTYG&marketplaceID=A1F83G8C2ARO7P       → 直接当店铺采
 *   · 卖家主页     /sp?ie=UTF8&seller=A3KDD2QGUB03SO&asin=B0DJ84VHQX        → 规范化成 /s?me= 再采
 *   · 商品详情页   /dp/B0DJ84VHQX                                          → 取跟卖卖家，逐个进店铺
 *
 * 【可配置】
 *   concurrency   并行标签页数(1-6, 默认 4): 每个 worker 一张独立标签页 + 独立 CDP 会话
 *   shopPages     每店铺页数（每页约 16 个商品）
 *   brandPages    每品牌页数（每页约 48 个商品）
 *   maxShops      最多进几个店铺（0=不限）
 *   maxItems      每店铺/每品牌商品数上限（0=不限）
 *   collectBrands 是否采品牌商品（false=只采店铺）
 *   filter        采集筛选（与商品管理同一套语义）
 *
 * 【文件结构】
 *   第 1 部分  采集器模块        → 存成 links-collector.js，独立可用
 *   第 2 部分  后端接入          → 抄进 server.js
 *   第 3 部分  前端采集面板字段   → 抄进采集方式配置数组
 *   第 4 部分  依赖接口清单 + 接入步骤 + 自测清单
 *   第 5 部分  实测踩过的坑（21 条关键项）
 *
 * 【必须先有的能力】
 *   · CDP 连本机 Edge（http://127.0.0.1:9222/json/list）
 *   · 采集筛选 applyCollectFilter(item, filter) → boolean
 *   · 入库函数 ingestLinksProducts()（第 2.2 给了完整实现）
 *   · 进度 bumpCollectProgress / collectStopRequested
 *
 * 生成时间: 2026-09-12T17:39:15.274Z
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/* ═══════════════════════════════════════════════════════════════════════════════
 * 【第 1 部分】采集器模块 —— 原样存成 links-collector.js
 *   完整的 Node 模块（CommonJS），不 import 你的项目，依赖通过 opts 注入，
 *   所以复制过去即可用，只要按第 4 部分传入那些函数。
 * ═══════════════════════════════════════════════════════════════════════════════ */

'use strict';
/**
 * 多链接采集器（第五步编排 + 采集筛选）
 *
 * 采集链路（用户给多条链接 → 只跳这些链接 → 采两类数据）:
 *   ① 用户给的链接
 *        · 店铺列表页 /s?me=XXX        → 直接当店铺采
 *        · 卖家主页   /sp?seller=XXX   → 规范化成 /s?me=XXX 再采
 *        · 商品详情页 /dp/ASIN          → 取该商品的【跟卖卖家】→ 逐个进卖家店铺
 *   ② 【跟卖商家的店铺商品】   ← 采第 ① 步得到的店铺
 *   ③ 【店铺商品的品牌】去重 → 逐个采【品牌商品】
 *
 * 可配置:
 *   shopPages  每店铺页数（每页 16 个商品）
 *   brandPages 每品牌页数（每页 48 个商品）
 *   maxShops   最多进几个店铺（0=不限）
 *   filter     采集筛选（与商品管理同一套语义，不通过的跳过不入库）
 *
 * 依赖通过 opts 注入（避免与 server.js 循环依赖）:
 *   cdpGetTabs / cdpConnect / siteToHostSuffix / resolveCollectSite /
 *   classifySellerLink / applyCollectFilter / ingestShopProducts /
 *   bumpCollectProgress / collectStopRequested / log
 *   cdpCreateTab / cdpCloseTab (并行: 每个 worker 一张独立标签页) / concurrency (1-6, 默认 4)
 */
const path = require('path');
// 任务存储(纯函数 + JobStore): 断点续跑的落盘与状态机都在那边, 这里只负责编排。
// ★ 打包/分发时的文件白名单必须带上 link-jobs.js —— 漏了会"装上了但模块找不到"。
const linkJobs = require('./link-jobs.js');

/** 站点 → marketplaceID */
const SITE_MARKETPLACE = {
  uk: 'A1F83G8C2ARO7P', us: 'ATVPDKIKX0DER', de: 'A1PA6795UKMFR9', fr: 'A13V1IB3VIYZZH',
  it: 'APJ6JRA9NG5V4', es: 'A1RKKUPIHCS9HS', jp: 'A1VC38T7YXB528', ca: 'A2EUQ1WTGCTBG2',
  in: 'A21TJRUUN4KGV', au: 'ANEGB3WVEVKZB', mx: 'AVDBXBAVVSXLQ', br: 'A2Q3Y263D00KWC',
  nl: 'A1805IZSGTT6HS', se: 'A2NODRKZP88ZB9', pl: 'A1C3SOZRARQ6R3', sg: 'A19VAU5U5O7RUS',
  tr: 'A33AVAJ2PDY3EV', ae: 'A2VIGQ35RCS4UG', sa: 'A17E79C6D8DWNP',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** 页面等待倍率: 只作用于「等页面/等插件」这类等待, 不动 pace 限速与重试退避。
 *  waitScale=1 实测默认; 1.5 慢网络; 0.02 自测(整套编排 2 分钟内跑完)。 */
const wait = (opts, ms) => sleep(Math.max(0, Math.round(ms * (Number(opts && opts.waitScale) > 0 ? Number(opts.waitScale) : 1))));

// ══════════════════════════════════════════════════════════════════
// 一、页面读取表达式（全部来自实测验证）
// ══════════════════════════════════════════════════════════════════

/** 穿透 shadow DOM 收集文本（跳过 style/script，避免把 CSS 读进来） */
const COLLECT_FN = `
  const collect = (root, depth) => {
    let t = '';
    if (!root || depth > 10) return t;
    root.childNodes && root.childNodes.forEach((n) => {
      if (n.nodeType === 3) t += n.textContent + ' ';
      else if (n.nodeType === 1) {
        if (n.tagName === 'STYLE' || n.tagName === 'SCRIPT') return;
        t += n.shadowRoot ? collect(n.shadowRoot, depth + 1) : collect(n, depth + 1);
      }
    });
    if (!t && root.shadowRoot) t = collect(root.shadowRoot, depth + 1);
    return t;
  };`;

/**
 * ★ 2026-09-25 读插件面板的【排名行】—— 按 DOM 结构读, 不按文本正则。
 *
 * 为什么必须改(真机实测):
 *   · 标签与数字的先后顺序会变(同一商品两次采样, 一次 "店铺选品#152,443Mobile..." 一次 "...卖家:8 店铺选品 #152443 ..."),
 *     所以 /店铺选品[^#]{0,80}?#(\d+)/ 这种"位置+跨度"正则会【跨行抓错】——
 *     实测卡片面板 "卖家:3 店铺选品" 后面紧跟下一行的 "#1 Mobile Phone Basic Cases 榜单选品",
 *     正则把子类目的 #1 当成大排名写进了 bsrShop。
 *   · 一行排名在 DOM 里是固定的三件套: span.ranktag(数字) + a[href*=bestsellers](类目名, 带层级) + span(标签)
 *   · "店铺选品" 这种【只有标签、没有 ranktag】的行 = 插件这个来源没给排名(未上榜的证据)
 *
 * 读出来的每行: { rank, cat, href, label } + bare(只有标签没数字的行) + ready(面板是否已分析完)
 */
const READ_RANKS_FN = `
  const readRanks = (root) => {
    const out = { rows: [], bare: [], ready: false };
    if (!root) return out;
    const tt = (n) => (n ? (n.textContent || '').replace(/\\s+/g, ' ').trim() : '');
    const full = tt(root);
    out.ready = /卖家\\s*[:：]\\s*\\d+|上架\\s*[:：]|近30天销量\\s*[:：]|尺寸\\s*[:：]|重量\\s*[:：]|FBA费用/.test(full)
      && !/正在分析|正在加载/.test(full);
    const isLabel = (x) => /^(店铺选品|榜单选品)$/.test(x);
    root.querySelectorAll('span.ranktag, [class*="ranktag"]').forEach((tagEl) => {
      const rowEl = tagEl.parentElement || tagEl;
      const a = rowEl.querySelector('a[href*="bestsellers"]');
      let label = null;
      rowEl.querySelectorAll('span,div').forEach((n) => { if (!label && isLabel(tt(n))) label = tt(n) });
      out.rows.push({
        rank: (tt(tagEl).replace(/[^0-9]/g, '') || null),
        cat: a ? tt(a).slice(0, 60) : null,
        href: a ? (a.getAttribute('href') || '') : null,
        label: label,
      });
    });
    root.querySelectorAll('span,div').forEach((el) => {
      const t = tt(el);
      if (!isLabel(t)) return;
      if (el.children && el.children.length) return;                 // 只看叶子标签
      const rowEl = el.parentElement; if (!rowEl) return;
      if (rowEl.querySelector('span.ranktag, [class*="ranktag"]')) return;   // 这行有数字, 不算裸标签
      const rowText = tt(rowEl).slice(0, 80);
      if (!out.bare.some((b) => b.label === t && b.rowText === rowText)) out.bare.push({ label: t, rowText: rowText });
    });
    return out;
  };`;

/** 类目链接层级: /gp/bestsellers/<根> = 宽类目(大) ; /gp/bestsellers/<根>/<id> = 细类目(小)
 *  注意 href 尾巴常带 /ref=pd_zg_hrsr_xxx —— 那一段不算层级 */
function rankCatOf(href) {
  const m = String(href || '').match(/\/gp\/bestsellers\/([^/?#]+)(?:\/([^/?#]+))?/);
  if (!m) return { isRoot: false, slug: null };
  const seg2 = (m[2] && !/^ref=/i.test(m[2])) ? m[2] : null;
  return { isRoot: !seg2, slug: m[1] + (seg2 ? '/' + seg2 : '') };
}

/**
 * 把读回来的排名行归类成 大/小 排名 + 三态判定。
 * 口径(2026-09-25 起): 大排名 = 【根类目】那一行(与标签文字无关, 只看类目链接层级);
 *                        小排名 = 【子类目】里数值最小的那一行。
 * 三态: 'ok' 有 / 'not_listed' 插件明确没有(未上榜) / 'unknown' 没采到(面板未就绪或压根没渲染)
 * 铁律: 没有根类目行时, **绝不拿子类目数值顶替大排名**(那正是旧正则的脏数据成因)。
 */
function classifyRanks(info) {
  const out = {
    bsrShop: null, bsrShopCat: null, bsrCat: null, bsrCatName: null,
    rankParentState: null, rankChildState: null, rankRows: null, rankBare: null,
  };
  if (!info || !Array.isArray(info.rows)) return out;
  const rows = info.rows.map((r) => {
    const n = Number(String(r && r.rank == null ? '' : r.rank).replace(/[^0-9]/g, '')) || null;
    const c = rankCatOf(r && r.href);
    return { rank: n, cat: (r && r.cat) || null, label: (r && r.label) || null, isRoot: c.isRoot, slug: c.slug };
  }).filter((r) => r.rank);
  const bare = Array.isArray(info.bare) ? info.bare.map((b) => b && b.label).filter(Boolean) : [];
  const ready = !!(info && info.ready);
  const rootRows = rows.filter((r) => r.isRoot);
  const subRows = rows.filter((r) => !r.isRoot);
  const wide = rootRows.length ? rootRows.reduce((a, b) => (b.rank > a.rank ? b : a)) : null;
  const narrow = subRows.length ? subRows.reduce((a, b) => (b.rank < a.rank ? b : a)) : null;
  if (wide) { out.bsrShop = String(wide.rank); out.bsrShopCat = wide.cat }
  if (narrow) { out.bsrCat = String(narrow.rank); out.bsrCatName = narrow.cat }
  // 大排名三态: 有根类目行 → ok; 面板已就绪且确实读到了排名行但没有根类目行 → not_listed(未上榜); 否则 unknown
  out.rankParentState = wide ? 'ok' : (ready && rows.length ? 'not_listed' : 'unknown');
  // 小排名: 只判"有/没有"; 没有时一律 unknown(不轻易说"未上榜")
  out.rankChildState = narrow ? 'ok' : 'unknown';
  out.rankRows = rows.map((r) => ({ rank: r.rank, category: r.cat, label: r.label, root: r.isRoot }));
  out.rankBare = bare;
  return out;
}

/** 插件面板的字段名表（断句用，少一个就会串句）
 *  ★ 2026-09-24 补 '上架','Size','Colour','Color' —— 实测面板里有 "Size： normal Colour： b" 与
 *    "上架：2024-12-17(645天)" 这种写法, 旧表只有 'Size Name'/'Colour Name' → 那两个字段不当终止符,
 *    于是 weight / productType 会把后面的 color/size 文案吃进来:
 *      weight="0.44 pounds ( 199.99 g) color ： B size ： normal"
 *      productType="HOME Size： normal Colour： b"   (全库实测 weight 污染 6314 条) */
const PANEL_LABELS = ['ASIN','品牌','卖家','店铺选品','榜单选品','尺寸','重量','包装尺寸','包装重量',
  'FBA费用','商品类型','Colour Name','Color Name','Size Name','Size','Colour','Color','上架',
  '变体','近30天销量','卖点','概要','产品',
  '找货-1688','找货-淘宝','找货-Amazon','找货-Alibaba','运费预估','复制子ASIN','关键词','采集到智赢'];

/** 字段名表的正则片段（预编译用，避免每个字段、每张卡片都重新拼一次） */
const PANEL_LABEL_ALT = PANEL_LABELS.join('|');

/**
 * ★ 2026-09-24 配送方式判定 (采集准确性): 面板 token + 页面短语 两张证据表。
 *
 * 背景(真机实测): 面板「卖家」字段的格式是 `卖家：<名> <FBA|FBM|AMZ>`, 那个 token 是**真值**。
 *   · 原来只认 FBA/FBM → **AMZ 自营被落成 null**(实测 64 张真机卡片里 9 张是 AMZ);
 *     而 AMZ 自营恰恰是最不该跟卖的对象, 必须能识别。
 *   · 页面短语原来只认英/德文, 而全库 57% 是 FR 站 → 这些商品**永远判不出配送方式**。
 * 铁律: 面板 token 优先 → 页面短语次之 → 都没有写 null。**绝不猜, 更绝不默认成 FBM**
 *   (库里 90,129 条 FBM 就是旧代码 `fulfill || 'FBM'` 造出来的假值)。
 */
function sellTokOf(sellerRaw) {
  const s = String(sellerRaw == null ? '' : sellerRaw).trim();
  const m = /\b(FBM|FBA|AMZ)\s*$/i.exec(s) || /\s(FBM|FBA|AMZ)(?:\s|$)/i.exec(s);
  return m ? m[1].toUpperCase() : null;
}
/** FBA = 亚马逊配送 (强证据, 必须先判): 英/德/法/西/意/中文 */
const FBA_PAGE_RE = /Fulfilled by Amazon|Dispatched from Amazon|Ships from Amazon|Versand durch Amazon|Exp[ée]di[ée] par Amazon|Vendido por Amazon|Enviado por Amazon|Venduto e spedito da Amazon|Spedito da Amazon|亚马逊配送|亚马逊物流/i;
/** FBM = 卖家自发货 (排除 Amazon 的写法, 否则 "Verkauf und Versand durch Amazon" 会被误判) */
const FBM_PAGE_RE = /Dispatched from and sold by|Fulfilled by Merchant|Versand durch den Verk|Versand durch Verk|Exp[ée]di[ée] (?:et vendu )?par(?!\s*Amazon)|Vendu et exp[ée]di[ée] par(?!\s*Amazon)|Vendido y enviado por(?!\s*Amazon)|Venduto e spedito da(?!\s*Amazon)|由卖家发货|卖家发货/i;
const PANEL_RE_CACHE = new Map();
/** ★优化: 原实现每次取字段都 new RegExp 一次 —— 一张卡片 14 个字段、上百张卡片就是上千次编译。
 *  这里按字段名缓存正则（字段名是有限集合），实测可省掉绝大部分编译开销。 */
function panelLabelRe(name) {
  let re = PANEL_RE_CACHE.get(name);
  if (!re) {
    re = new RegExp(name + '\\s*[:：]\\s*(.*?)\\s*(?=' + PANEL_LABEL_ALT + '\\s*[:：|]|$)');
    PANEL_RE_CACHE.set(name, re);
  }
  return re;
}

/** 解析插件面板文本 → 结构化字段 */
function parsePanelText(txt, flagInfo) {
  const f = (name) => {
    const m = txt.match(panelLabelRe(name));
    if (!m) return null;
    const v = m[1].trim();
    if (!v || /^正在加载|^正在分析|^--?$|^无$/.test(v)) return null;
    return v.slice(0, 60);
  };
  const num = (re) => { const m = txt.match(re); return m ? String(m[1]).replace(/[,\s#]/g, '') : null };
  const sellerRaw = f('卖家') || '';
  // 配送方式: 必须先剥掉"FBA费用"再判断（否则 FBM 会被误判成 FBA）
  const noFee = txt.replace(/FBA费用[^|]*/g, '');
  const tm = txt.match(/(\d+)\s*个(注册商标|已申请)/);
  return {
    // ★优化: 原写法是 `\s*\d+\s*个(?:已申请|注册商标)\s*$` —— 锚定了字符串结尾, 只要商标子句
    //   后面还有别的内容(实测面板里 品牌 值后面常跟其他片段)就完全剥不掉, 品牌名会带着一串杂质。
    //   改成「从商标子句开始一直切到结尾」, 品牌名只保留子句之前的部分。
    brand: (f('品牌') || '').replace(/未查到.*$/, '').replace(/\s*\d+\s*个(?:已申请|注册商标)[\s\S]*$/, '').trim() || null,
    seller: sellerRaw.replace(/\s*\b(FBM|FBA|AMZ)\b\s*$/i, '').trim() || null,
    // ★ 2026-09-24 (见 sellTokOf/FBA_PAGE_RE 注释): 面板 token(含 AMZ 自营) → 页面短语(五语种) → null
    fulfill: sellTokOf(sellerRaw) || (FBA_PAGE_RE.test(noFee) ? 'FBA' : (FBM_PAGE_RE.test(noFee) ? 'FBM' : null)),
    amazonSell: sellTokOf(sellerRaw) === 'AMZ' ? true : null,
    sellerCount: num(/卖家\s*[:：]\s*(\d+)/),
    // ★ 2026-09 修复(CDP 实测): 面板里「店铺选品」后面跟的不是 #, 而是「上架：2024-12-17(645天)」这类行,
    //   排行数字在更后面 —— 原文: "卖家:8 店铺选品 上架：2024-12-17(645天) #96,905 Automotive 榜单选品 #127 …"。
    //   旧式 /店铺选品\s*#/ 要求标签后紧跟 # → 永远不匹配 → bsrShop 恒 null → 父类(大)排名全空。
    //   允许标签与 # 之间最多 80 个【非 #】字符, 既容错又不跨到下一个排名字段。
    bsrShop: num(/店铺选品[^#]{0,80}?#\s*([\d,]+)/),
    // ★优化: 类目名的终止符原来只写了「榜单选品|尺寸|$」—— 但实测面板里 #数字 后面常直接跟
    //   「近30天销量」等其他字段 → 抓不到类目名(返回 null)。改用完整字段名表做终止符。
    //   注意: 必须用【裸标签】做终止(不能要求后面跟冒号) —— 因为「榜单选品 #」后面是 # 不是冒号,
    //   要求冒号会导致跨字段过度捕获(实测会吃成 "Automotive 榜单选品 # 5,678 Car Care")。
    bsrShopCat: (txt.match(new RegExp('店铺选品[^#]{0,80}?#\\s*[\\d,]+\\s*([^|:：]{0,40}?)\\s*(?=(?:' + PANEL_LABEL_ALT + ')|$)')) || [])[1] || null,
    bsrCat: num(/榜单选品\s*#\s*([\d,]+)/),
    bsrCatName: (txt.match(new RegExp('榜单选品\\s*#\\s*[\\d,]+\\s*([^|:：]{0,40}?)\\s*(?=(?:' + PANEL_LABEL_ALT + ')|$)')) || [])[1] || null,
    sales30d: f('近30天销量'),
    productType: f('商品类型'),
    variants: f('变体'),
    size: f('尺寸'),
    weight: f('重量'),
    fbaFee: (txt.match(/FBA费用\s*[:：]\s*([^\s|]+)/) || [])[1] || null,
    tmStatus: tm ? { count: Number(tm[1]), status: tm[2] } : null,
    /* ★ 2026-10-02 卖家国家 —— 数据来自【国旗图标】(DOM), 不是面板文本, 所以由调用方把
     * readSellerFlag() 的结果当第二个参数传进来(卡片链路走 __flag, 详情页链路走 EXPR_DETAIL_PANEL.flag)。
     * 三态很重要, 别把"没读到"当成"非中国":
     *   chinaSeller === true   → 大中华区(CN/HK/TW/MO, 与插件国旗分组一致) → 中国卖家
     *   chinaSeller === false  → 读到了国旗, 但不是大中华区 → 明确非中国卖家
     *   chinaSeller === null   → 没读到国旗(插件未登录 / 面板没渲染完) → 未知
     * 采集筛选用严格模式: 勾了「中国卖家」时未知不满足 —— 否则会把非中国卖家一起采回来。 */
    sellerCountryCode: (flagInfo && flagInfo.code) ? String(flagInfo.code).toUpperCase() : null,
    sellerFlagCode: (flagInfo && flagInfo.flagCode) ? String(flagInfo.flagCode).toUpperCase() : null,
    chinaSeller: (flagInfo && flagInfo.code) ? isChinaRegionCode(flagInfo.code) : null,
  };
}

/* ===== ★ 2026-10-02 卖家国家（国旗图标）=================================================
 * 需求来源: 用户要按「中国卖家」筛商品。智赢插件面板在【卖家】那一行画了一面国旗:
 *     <div class="zying-flag-conmp-wrap">
 *       <img src="chrome-extension://<扩展id>/assets/flag/XX.svg"/>
 *       <span>  </span>
 *     </div>
 * 从插件源码(assets/js/content.js 模块 84614)反推 + 实测确认:
 *     const t = { HK:"CN", TW:"CN", MO:"CN" }        // 港澳台也画 CN 旗
 *     <img src={SI(t[code] || code)} />               // 图上用的是"映射后"的代码
 *     <span>{ t[code] ? code : "" }</span>            // 只有港澳台才在 span 里写出真实代码
 * 所以判定规则(实测样本 amazon.de/dp/B0FPBX31HQ → code=CN, span 为空 → 中国大陆):
 *     img 末段 = XX, span 为空        → 真实代码就是 XX
 *     img 末段 = CN, span = HK/TW/MO  → 真实代码是 span 里的那个(港澳台)
 * ⚠️ 位置纪律: 国旗是【卖家行】的子节点(实测父链: wrap → span → div"卖家：xxx" → 行容器)。
 *    页面别处(如 icp-nav-flag-de)也有 flag 类名, 但那是亚马逊自己的站点选择器, 必须排除 ——
 *    所以只认 `.zying-flag-conmp-wrap` 这个插件专属类名。
 * ====================================================================================== */
const READ_FLAGS_FN = `
  /**
   * 读卖家国家国旗。root 可以是卡片元素、面板根节点或 shadowRoot。
   * @returns {{code:string, flagCode:string, spanCode:string, src:string}|null}
   *   code     = 归一后的真实国家代码 (CN / HK / TW / MO / 其他国家)
   *   flagCode = 图标文件里的代码 (港澳台会显示 CN)
   */
  function readSellerFlag(root) {
    if (!root || !root.querySelectorAll) return null;
    let wraps = [];
    try { wraps = root.querySelectorAll('.zying-flag-conmp-wrap'); } catch (e) { return null; }
    for (const w of wraps) {
      const img = w.querySelector('img');
      if (!img) continue;
      const src = img.getAttribute('src') || img.src || '';
      const m = src.match(/\\/flag\\/([A-Za-z]{2})\\.svg/);
      if (!m) continue;
      const flagCode = m[1].toUpperCase();
      const sp = w.querySelector('span');
      const spanCode = sp ? (sp.textContent || '').trim().toUpperCase() : '';
      const code = /^(HK|TW|MO)$/.test(spanCode) ? spanCode : flagCode;
      return { code: code, flagCode: flagCode, spanCode: spanCode || null, src: src };
    }
    return null;
  }
`;
/** 大中华区口径: 与插件国旗的分组一致(港澳台也画 CN 旗) —— 它们都算「中国卖家」。
 *  想细分就自己看 item.sellerCountryCode。 */
const CHINA_REGION_CODES = ['CN', 'HK', 'TW', 'MO'];
function isChinaRegionCode(c) { return CHINA_REGION_CODES.indexOf(String(c || '').toUpperCase()) >= 0; }

/** 读商品详情页的插件面板（含加载完成判定：既无"正在分析"也无"正在加载"） */
const EXPR_DETAIL_PANEL = `(() => {
  ${COLLECT_FN}
  ${READ_FLAGS_FN}
  const HOSTS = ['#zying-amazon-float', '#zying-global-react-host', '.zy-tool-detail', '.zying-shadow-root'];
  const parts = [];
  let flagRoot = null, flagLen = 0;
  for (const sel of HOSTS) document.querySelectorAll(sel).forEach((h) => {
    const r = h.shadowRoot || h;
    const t = collect(r, 0).replace(/\\s+/g,' ').trim();
    if (t) parts.push(t);
    // ★ 卖家国旗: 在同一个面板根里找, 取文本最长的那个面板(与排名读取同一套"最大即主面板"约定)
    const tl = (r.textContent || '').length;
    if (/ASIN\\s*[:：]/.test(r.textContent || '') && tl > flagLen) { flagLen = tl; flagRoot = r }
  });
  const txt = parts.join(' || ').trim();
  const flag = flagRoot ? readSellerFlag(flagRoot) : null;
  if (!txt) return JSON.stringify({ ok: false, flag: flag });
  return JSON.stringify({ ok: true, analyzing: /正在分析|正在加载/.test(txt), loading: (txt.match(/正在加载/g)||[]).length, txt, flag: flag });
})()`;

/** ★ 详情页读【结构化排名行】(标签位置会变, 必须按 DOM 读; 见 READ_RANKS_FN 注释) */
const EXPR_DETAIL_RANKS = `(() => {
  ${READ_RANKS_FN}
  ${READ_FLAGS_FN}
  const HOSTS = ['#zying-amazon-float', '#zying-global-react-host', '.zy-tool-detail', '.zying-shadow-root'];
  let root = null, len = 0;
  for (const sel of HOSTS) document.querySelectorAll(sel).forEach((h) => {
    const r = h.shadowRoot || h;
    const t = (r.textContent || '');
    if (/ASIN\\s*[:：]/.test(t) && t.length > len) { len = t.length; root = r }
  });
  if (!root) return JSON.stringify({ ok: false });
  const info = readRanks(root);
  info.flag = readSellerFlag(root);          // ★ 顺手把卖家国旗一起带回来(同一次 evaluate, 不额外开销)
  info.ok = true;
  return JSON.stringify(info);
})()`;

/** 读当前页面 ASIN（用于防串页校验） */
const EXPR_PAGE_ASIN = `(location.pathname.match(/\\/dp\\/([A-Z0-9]{10})/)||[])[1]||null`;

/** 点「卖家:N」按钮的定位（点击必须用 CDP 真实鼠标事件） */
const EXPR_FIND_SELLER_BTN = `(() => {
  const host = document.querySelector('.zy-tool-detail');
  if (!host) return JSON.stringify({ ok: false, err: '插件面板不在页面上' });
  const all = []; const walk = (r, d) => { if (!r || d > 14) return; r.querySelectorAll && r.querySelectorAll('*').forEach((e) => { all.push(e); if (e.shadowRoot) walk(e.shadowRoot, d + 1) }); if (r.shadowRoot) walk(r.shadowRoot, d + 1) };
  walk(host, 0);
  const btn = all.find((e) => /^卖家\\s*[:：]\\s*\\d+$/.test((e.textContent || '').trim()));
  if (!btn) return JSON.stringify({ ok: false, err: '没找到「卖家:N」按钮' });
  btn.scrollIntoView({ block: 'center', inline: 'center' });
  const r = btn.getBoundingClientRect();
  return JSON.stringify({ ok: true, text: btn.textContent.trim(), x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) });
})()`;

/** 滚动 AOD 弹窗到底（触发懒加载，不然只有 10 个卖家） */
const EXPR_SCROLL_AOD = `(() => {
  document.querySelectorAll('.a-scroller.a-scroller-vertical, #aod-offer-list, [class*="a-scroller"], [id^="aod"]').forEach((s) => { try { if (s.scrollHeight > s.clientHeight) s.scrollTop = s.scrollHeight } catch {} });
  const o = document.querySelectorAll('#aod-offer'); if (o.length) { try { o[o.length-1].scrollIntoView({ block: 'end' }) } catch {} }
  window.scrollTo(0, document.body.scrollHeight);
  return 'ok';
})()`;

/** 读 AOD 卖家列表（按 sellerId 去重，保留价格最低那条） */
const EXPR_READ_AOD = `(() => {
  const out = { count: 0, uniq: 0, sellers: [] };
  const offers = [...document.querySelectorAll('#aod-offer')];
  out.count = offers.length;
  if (!offers.length) return JSON.stringify(out);
  const map = new Map();
  offers.forEach((o, i) => {
    const html = String(o.innerHTML);
    const txt = (o.textContent || '').replace(/\\s+/g, ' ').trim();
    let shopLink = null, detailsLink = null, name = null;
    o.querySelectorAll('a[href]').forEach((a) => {
      const raw = a.getAttribute('href') || '';
      const full = raw.startsWith('http') ? raw : 'https://' + location.hostname + raw;
      if (!shopLink && /\\/gp\\/aag\\/main/.test(raw)) shopLink = full;
      if (!detailsLink && /\\/gp\\/aag\\/details/.test(raw)) detailsLink = full;
      if (!name && /\\/gp\\/aag\\/main|\\/sp\\?/.test(raw)) {
        const t = (a.textContent || '').replace(/^(Visit the|Visit)\\s*/i, '').replace(/\\s*Store$/i, '').replace(/\\s*(FBA|FBM|Amazon)\\s*$/i, '').trim();
        if (t && !/^Details$/i.test(t) && t.length >= 2 && t.length < 60) name = t;
      }
    });
    const sellerId = (String(shopLink || detailsLink || html).match(/[?&]seller=([A-Z0-9]{8,})/) || [])[1] || null;
    if (!sellerId) return;
    if (!name) { const m = txt.match(/(?:Dispatched from and sold by|Sold by)\\s+([^|]{2,45}?)(?:\\s+(?:New seller|Seller rating|Learn more|\\d)|$)/i); if (m) name = m[1].trim() }
    let price = null;
    const pe = o.querySelector('.a-price .a-offscreen');
    if (pe && pe.textContent.trim()) price = pe.textContent.trim();
    if (!price) { const m = txt.match(/(?:CNY|£|€|\\$|¥)\\s?[\\d.,]+/); if (m) price = m[0] }
    const noFee = txt.replace(/FBA费用[^|]*/g, '');
    // ★ 2026-09-24: 之前只认英/德文 → FR/ES/IT 站的跟卖卖家配送方式永远为 null; 且 "Sold by" 单独出现就判 FBM 过宽
    const fulfill = FBA_PAGE_RE.test(noFee) ? 'FBA' : (FBM_PAGE_RE.test(noFee) ? 'FBM' : null);
    const eta = (txt.match(/(\\d{1,2}\\s*-\\s*\\d{1,2}\\s+\\w+|\\w+\\s+\\d{1,2}\\s*-\\s*\\d{1,2})/) || [])[1] || null;
    // ★ 2026-10-02 价格比较用 parseMoneyText 的口径(见 opts.parseMoneyText 注入)。
    //   旧写法 replace(/[^0-9.]/g,'') 在 de 站会把 "29,99 €" 读成 2999 —— 拿它比价会选错卖家。
    const money = (typeof opts.parseMoneyText === 'function') ? opts.parseMoneyText : (v) => { const x = parseFloat(String(v == null ? '' : v).replace(/[^0-9.]/g, '').replace(',', '.')); return isFinite(x) ? x : null; };
    const n = money(price) || Infinity;
    const prev = map.get(sellerId);
    const pn = prev ? (money(prev.price) || Infinity) : Infinity;
    if (!prev || n < pn) map.set(sellerId, { idx: i, sellerId, name, price, fulfill, eta, shopLink, detailsLink, offers: (prev ? prev.offers : 0) + 1 });
    else prev.offers++;
  });
  out.sellers = [...map.values()];
  out.uniq = out.sellers.length;
  return JSON.stringify(out);
})()`;

/**
 * 读店铺/搜索页的商品列表
 * ★ 必须限定 data-component-type="s-search-result" —— 否则会混进重复的 "Add to basket" 小卡和无关推荐
 *   （实测 95 个 data-asin 里只有 48 个真商品）
 */
const EXPR_READ_SHOP = `(() => {
  ${COLLECT_FN}
  ${READ_RANKS_FN}
  ${READ_FLAGS_FN}
  const out = { cards: [], total: null, range: null, mixed: 0, brandFilter: null };
  const body = document.body ? document.body.textContent : '';
  out.total = (body.match(/of\\s+(?:over\\s+)?([\\d,]+)\\s+results/i) || [])[1] || null;
  out.range = (body.match(/([\\d,]+\\s*-\\s*[\\d,]+\\s+(?:of|over)[^\\n]{0,14}?[\\d,]+)/i) || [])[0] || null;
  const kw = (location.href.match(/[?&]k=([^&]+)/) || [])[1];
  out.brandFilter = kw ? decodeURIComponent(kw.replace(/\\+/g, ' ')) : null;

  document.querySelectorAll('div[data-asin][data-component-type="s-search-result"]').forEach((el) => {
    const asin = el.getAttribute('data-asin');
    if (!asin || !/^[A-Z0-9]{10}$/.test(asin)) return;
    const dpEl = el.querySelector('a[href*="/dp/"]');
    if (!dpEl) return;

    // 品牌：从品牌链接元素取（干净），不要从面板文本正则抠（会粘商标状态）
    let brandEl = null;
    el.querySelectorAll('a[href*="field-keywords="]').forEach((a) => {
      if (brandEl) return;
      const h = a.getAttribute('href') || '';
      const t = (a.textContent || '').trim();
      if (t && /\\/(s|stores)\\//.test(h)) brandEl = { text: t, href: h };
    });
    const brand = brandEl ? brandEl.text : null;
    const brandLink = brandEl ? (brandEl.href.startsWith('http') ? brandEl.href : 'https://' + location.hostname + brandEl.href) : null;

    // 卡片内插件数据 (文本 + ★ 结构化排名行)
    /* ★★ 2026-10-02 【卡片↔面板一致性校验】—— 修"类目/排名串到别的商品"的根因。
     * 症状(用户实测): 库里有商品的 cat1/rankSubCat 与标题完全矛盾 ——
     *   例 B0D1CG2T6G 标题是 "Women's Scoop Wedding Dresses"(婚纱), 真机面包屑是
     *   Fashion > … > T-Shirts, 但库里存的是 cat1="Automotive" / rankSubCat="Car Air Mass Sensors"。
     *   卖家 PSFVHHQI 这类店铺同时卖汽车配件和服装, 品牌页上两类商品混排 →
     *   卡片与插件面板一旦错位, 面板里的类目/排名/卖家就写到了别的商品上。
     * 判据: 插件面板文本里【自带 ASIN】(形如 "ASIN：B0FPBX31HQ"), 它才是面板真正描述的商品。
     *   与卡片自身的 data-asin 不一致 → 这份面板数据不属于这张卡 → 整份丢弃(不写类目/排名/卖家/国旗)。
     * 为什么要丢而不是"挑一个对的": 卡片内只有一个插件面板容器, 找不到匹配的说明 DOM 已经错位,
     *   继续用只会把错误数据写进库 —— 宁可这个商品这次少字段, 也不要错字段。
     * 计数返回在 cards[].panelMismatch 与 out.panelMismatch, 便于观察发生率。 */
    let panelTxt = '';
    let panelRoot = null, panelLen = 0, panelAsin = '', panelMismatch = false;
    el.querySelectorAll('[class*="zying"], [class*="zy-"], [id*="zying"]').forEach((n) => {
      const t = collect(n.shadowRoot || n, 0).replace(/\\s+/g, ' ').trim();
      if (/ASIN\\s*[:：]/.test(t) && t.length > panelTxt.length) {
        panelTxt = t; panelRoot = n.shadowRoot || n; panelLen = t.length;
        panelAsin = (t.match(/ASIN\\s*[:：]\\s*([A-Z0-9]{10})/) || [])[1] || '';
      }
    });
    if (panelTxt && panelAsin && panelAsin !== String(asin).toUpperCase()) {
      panelMismatch = true;
      panelTxt = ''; panelRoot = null; panelLen = 0; panelAsin = '';
    }
    const rankInfo = panelRoot ? readRanks(panelRoot) : null;
    // ★ 2026-10-02 卖家国家: 国旗挂在【卖家行】上, 不一定在面板根里 —— 所以先在卡片整体里找,
    //   找不到再退回面板根找(兼容不同版本的 DOM 结构)。面板错位时同样不能用(国旗会串卖家)。
    const flagInfo = panelMismatch ? null : (readSellerFlag(el) || (panelRoot ? readSellerFlag(panelRoot) : null));

    const titleEl = el.querySelector('h2 span, h2');
    const priceEl = el.querySelector('.a-price .a-offscreen, .a-price-whole');
    const ratingEl = el.querySelector('.a-icon-alt, [aria-label*="out of 5"]');
    const reviewEl = el.querySelector('a[aria-label*="ratings"], .a-size-base.s-underline-text');
    const imgEl = el.querySelector('img.s-image');

    const rec = {
      asin,
      title: titleEl ? titleEl.textContent.trim().slice(0, 90) : null,
      price: priceEl ? priceEl.textContent.trim() : null,
      rating: ratingEl ? (ratingEl.getAttribute('aria-label') || ratingEl.textContent || '').trim().slice(0, 30) : null,
      reviews: reviewEl ? reviewEl.textContent.trim().slice(0, 20) : null,
      image: imgEl ? imgEl.getAttribute('src') : null,
      productUrl: 'https://' + location.hostname + '/dp/' + asin,
      brand, brandLink, brandLinkIndex: brandEl ? (String(brandEl.href).match(/index=([^&]+)/) || [])[1] || null : null,
      hasPanel: !!panelTxt,
      panelMismatch: panelMismatch,          // ★ 面板 ASIN 与卡片不符 → 整份面板已丢弃(供统计/排查)
      __panelTxt: panelTxt,
      __rank: rankInfo,
      __flag: flagInfo,          // ★ 卖家国家国旗(采集结束后由 parsePanelText 消费, 不进商品字段)
    };
    out.cards.push(rec);
  });
  // 品牌页过滤：与目标品牌比对（无品牌链接的广告位/无关商品一律剔除）
  if (out.brandFilter) {
    const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const c of out.cards) {
      c.sameBrand = c.brand ? norm(c.brand) === norm(out.brandFilter) : false;
      if (!c.sameBrand) out.mixed++;
    }
  }
  // ★ 2026-10-02 面板错位统计: 有多少张卡的插件面板 ASIN 与卡片不符(已丢弃)。
  //   这个数长期非 0 就说明页面 DOM 变了 / 插件渲染方式变了, 需要重新对一遍选择器。
  out.panelMismatch = out.cards.filter(function (c) { return c.panelMismatch; }).length;
  return JSON.stringify(out);
})()`;

/** 找进店入口（卖家简介页 → 店铺列表页） */
const EXPR_FIND_STORE_ENTRY = `(() => {
  const as = [...document.querySelectorAll('a[href]')];
  const el = as.find((a) => /See all products|Visit the .* storefront/i.test((a.textContent || '').trim()))
          || as.find((a) => /\\/s\\?.*me=/.test(a.getAttribute('href') || ''));
  if (!el) return JSON.stringify({ ok: false, err: '没找到进店入口' });
  el.scrollIntoView({ block: 'center' });
  const r = el.getBoundingClientRect();
  return JSON.stringify({ ok: true, text: (el.textContent || '').trim().slice(0, 50), href: el.getAttribute('href'), x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) });
})()`;

/**
 * ══════════════════════════════════════════════════════════════════
 * 二、CDP 会话封装（带超时 + 断线重连兜底）
 * ══════════════════════════════════════════════════════════════════
 *
 * 【WS 重连机制】原来的实现有一个硬伤: `ws.onclose` 从来没被处理 ——
 * Edge 把标签页、或 CDP 通道因为异常断开时, 所有挂着的 `send()` 会一直等到
 * 30 秒超时才返回 `{ __timeout: true }`, 调用方拿到的 `undefined` 会被当成
 * "插件没数据", 于是采到空值还可能入库 —— 这就是需要防的"污染数据"。
 *
 * 现在: 连接一关, 立刻把所有挂起请求以 `__closed` 返回(不空等), 并置 closed 标志。
 *       调用方(evalExpr / 步骤函数)看到 __closed 就知道"是断线, 不是没数据",
 *       可以走重连而不是把空值当结果。
 */
function openSession(wsUrl, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    let WebSocketImpl = globalThis.WebSocket;
    if (!WebSocketImpl) throw new Error('需要 Node 18+ 的 WebSocket');
    const ws = new WebSocketImpl(wsUrl);
    const to = setTimeout(() => { try { ws.close() } catch {} reject(new Error('CDP 连接超时')) }, 8000);
    ws.onopen = () => {
      clearTimeout(to);
      let id = 0; const pend = new Map();
      let closed = false;
      // 断线: 立刻叫醒所有挂起请求, 别让它们空等到超时(空等出来的 undefined 会被误读成"没数据")
      const bail = (why) => {
        if (closed) return;
        closed = true;
        for (const [, p] of pend) {
          clearTimeout(p.timer);
          try { p.res({ __closed: true, err: why }); } catch (e) { /* 忽略 */ }
        }
        pend.clear();
      };
      ws.onmessage = (e) => {
        let m = null;
        try { m = JSON.parse(e.data) } catch (err) { return }
        if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); clearTimeout(p.timer); p.res(m) }
      };
      ws.onclose = () => { bail('CDP 连接已断开 (WebSocket closed)') };
      ws.onerror = () => { bail('CDP 连接异常 (WebSocket error)') };
      const send = (method, params) => new Promise((res) => {
        if (closed) { res({ __closed: true, err: 'CDP 连接已断开' }); return; }
        const i = ++id;
        const timer = setTimeout(() => { pend.delete(i); res({ __timeout: true }) }, timeoutMs);
        pend.set(i, { res, timer });
        try { ws.send(JSON.stringify({ id: i, method, params })) } catch (e) { clearTimeout(timer); pend.delete(i); res({ __err: String(e.message) }) }
      });
      resolve({
        ws, send,
        get closed() { return closed; },
        close: () => { try { ws.close() } catch {} },
      });
    };
    ws.onerror = () => { clearTimeout(to); reject(new Error('无法连接该标签页')) };
  });
}

/** 重连参数(可由 opts 覆盖): 单次重连的等待、尝试次数 */
const WS_RECONNECT_WAIT_MS = 1500;
const WS_RECONNECT_TRIES = 2;

/**
 * 取一个标签页的 CDP 会话（优先亚马逊页，避免把用户正在看的页面导航走）。
 * @param opts 采集参数
 * @param opts.onReconnect (info) => void 每次重连回调(供任务日志记录)
 * @param opts.wsReconnectTries 重连尝试次数(默认 2)
 * @param opts.openSession 注入的会话工厂(假 CDP 离线测试用; 缺省走真实 openSession)
 */
function attachPage(opts) {
  return attachPageInner(opts);
}

/** 真正实现: 连不上/建会话失败时按次数重试 (Edge 刚启动、标签页正在切换时很常见) */
async function attachPageInner(opts) {
  const tries = Math.max(1, Number(opts.wsReconnectTries) || WS_RECONNECT_TRIES + 1);
  // 假 CDP 测试台靠这个注入口把 WebSocket 换掉; 生产走真实 openSession
  const open = typeof opts.openSession === 'function' ? opts.openSession : openSession;
  let lastErr = null;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const tabs = await opts.cdpGetTabs();
      const page = tabs.find((t) => t.type === 'page' && /amazon\./.test(t.url))
        || tabs.find((t) => t.type === 'page' && !String(t.url).includes('3088') && !String(t.url).startsWith('data:'))
        || tabs.find((t) => t.type === 'page');
      if (!page) throw new Error('Edge 无可用页面标签, 请确认 Edge 以 --remote-debugging-port=9222 启动');
      const s = await open(page.webSocketDebuggerUrl, opts.evalTimeoutMs || 30000);
      if (!s) throw new Error('openSession 未返回会话');
      // WS 重连钩子: 通道断了之后, 只要标签页还在 /json 里, 就重开一个通道继续用同一个标签页。
      // 返回 true = 已重连(调用方可重试刚才那次求值); false = 标签页没了, 交给上层判断。
      s.reopen = async () => {
        try {
          const list = await opts.cdpGetTabs();
          const again = (list || []).find((t) => t.id === page.id && t.webSocketDebuggerUrl)
            || (list || []).find((t) => t.type === 'page' && /amazon\./.test(t.url));
          if (!again || !again.webSocketDebuggerUrl) return false;
          const fresh = await open(again.webSocketDebuggerUrl, opts.evalTimeoutMs || 30000);
          fresh.reopen = s.reopen;
          s.ws = fresh.ws; s.send = fresh.send;
          opts.log && opts.log('[多链接采集] CDP 通道已重连 (标签页 ' + (again.id || '?') + ')');
          if (typeof opts.onReconnect === 'function') { try { opts.onReconnect({ stage: 'eval', tabId: again.id || null }) } catch (e) { /* 忽略 */ } }
          return true;
        } catch (e) { return false; }
      };
      return s;
    } catch (e) {
      lastErr = e;
      if (attempt < tries) {
        opts.log && opts.log('[多链接采集] 建立 CDP 会话失败(' + attempt + '/' + tries + '): ' + ((e && e.message) || e) + ' → ' + WS_RECONNECT_WAIT_MS + 'ms 后重连');
        if (typeof opts.onReconnect === 'function') { try { opts.onReconnect({ stage: 'attach', attempt, err: (e && e.message) || String(e) }) } catch (e2) { /* 忽略 */ } }
        await sleep(WS_RECONNECT_WAIT_MS);
      }
    }
  }
  throw lastErr || new Error('无法建立 CDP 会话');
}

/** 协作停止的统一判定（用户点「停止」或任务编排层的批次超时）。
 *  注意: 各步骤循环里用的是这个, 而不是直接调 collectStopRequested ——
 *  否则批次超时只在最外层生效, 内层循环会继续翻页/滚动, 尾部拖很久。 */
function stopWanted(opts) {
  if (typeof opts.shouldStop === 'function' && opts.shouldStop()) return true;
  return typeof opts.collectStopRequested === 'function' && opts.collectStopRequested();
}

/**
 * Runtime.evaluate 并解析结果（字符串能被 JSON.parse 就解析，否则原样返回）。
 *
 * ★ WS 重连兜底: 连接断了(sess.closed / __closed)或超时, 在同一个标签页上重开一次
 *   CDP 通道再试。关键区别在于"断线"和"页面没数据"必须分开 —— 断线时返回的
 *   `{ __closed: true }` 不会被任何步骤函数当成"插件没数据"而写入空值。
 */
async function evalExpr(sess, expr, tries = 2) {
  let last = null;
  for (let attempt = 1; attempt <= Math.max(1, tries); attempt++) {
    const r = await sess.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.__closed) {
      last = { __closed: true, err: r.err || 'CDP 连接已断开' };
      // 会话自带的重连钩子(如果标签页还活着): 重开通道后再试
      if (typeof sess.reopen === 'function') {
        const ok = await sess.reopen();
        if (ok) continue;
      }
      return last;
    }
    if (r && r.__timeout) return { __timeout: true };
    if (r && r.__err) return { err: r.__err };
    if (r && r.exceptionDetails) return { err: String(r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 200) };
    const v = r && r.result && r.result.result ? r.result.result.value : undefined;
    if (typeof v === 'string') { try { return JSON.parse(v) } catch { return v } }
    return v === undefined ? { err: 'no-value' } : v;
  }
  return last || { err: 'no-value' };
}

/** CDP 真实鼠标点击（插件的按钮用 .click() 点不动） */
async function realClick(sess, x, y) {
  await sess.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
  await sleep(250);
  await sess.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await sleep(90);
  await sess.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

// ══════════════════════════════════════════════════════════════════
// 三、采集步骤
// ══════════════════════════════════════════════════════════════════

/** 并行执行 + 并发上限（输出保持输入顺序；单个任务抛错只影响它自己） */
async function parallelMap(items, limit, fn) {
  const out = new Array(items.length);
  const n = Math.max(1, Math.min(Number(limit) || 1, items.length));
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      try { out[i] = await fn(items[i], i); }
      catch (e) { out[i] = { __err: (e && e.message) || String(e) }; }
    }
  }));
  return out;
}

/**
 * 开一个新标签页, 并返回它的 CDP 会话。
 * ★ 实测结论: **页面级会话就能发 `Target.createTarget`**（无需额外的浏览器级端点），
 *   新标签页随后会出现在 /json 列表里（带自己的 webSocketDebuggerUrl）。
 * 对应文档坑 #10：有几个链接就开几个网页, 全程不关, 跑完统一关。
 */
async function openTab(ctrlSess, opts) {
  const r = await ctrlSess.send('Target.createTarget', { url: 'about:blank' });
  const targetId = r && r.result && r.result.targetId;
  if (!targetId) throw new Error('Target.createTarget 未返回 targetId: ' + JSON.stringify(r).slice(0, 150));
  for (let i = 0; i < 25; i++) {                       // 新标签页出现在 /json 需要一点时间
    const tabs = await opts.cdpGetTabs();
    const t = (tabs || []).find((x) => x.id === targetId);
    if (t && t.webSocketDebuggerUrl) {
      return { targetId, sess: await openSession(t.webSocketDebuggerUrl, opts.evalTimeoutMs || 30000) };
    }
    await sleep(300);
  }
  throw new Error('新标签页未出现在 /json 列表中 (targetId=' + targetId + ')');
}

/** 关掉本模块开出来的标签页（失败不抛，收尾用） */
async function closeTab(ctrlSess, targetId) {
  try { await ctrlSess.send('Target.closeTarget', { targetId }); } catch (e) { /* 忽略 */ }
}

/**
 * 阶段 1：商品详情页 → 插件数据（含"插件没出来就刷新重试"）
 */
async function readProductPanel(sess, asin, site, opts) {
  const host = 'www.amazon.' + opts.siteToHostSuffix(site);
  const url = 'https://' + host + '/dp/' + asin;
  for (let round = 1; round <= 2; round++) {
    if (round === 2) {
      opts.log && opts.log('[多链接采集] 插件没加载出来 → 刷新重试: ' + asin);
      await sess.send('Page.reload', { ignoreCache: true });
      await wait(opts, 9000);
    } else {
      await sess.send('Page.navigate', { url });
      await wait(opts, 10000);
      for (let i = 1; i <= 3; i++) { await sess.send('Runtime.evaluate', { expression: `window.scrollTo(0, ${i * 1500})` }); await wait(opts, 800) }
    }
    // 防串页校验
    const check = await evalExpr(sess, EXPR_PAGE_ASIN);
    if (check !== asin) {
      // ★优化: 原来第二轮即使串页也照读 —— 会把「别的商品的面板数据」当成目标商品写进库。
      //   串页说明导航没到位, 必须判失败, 不能静默接受错误数据。
      if (round === 1) continue;
      return { ok: false, asin, err: '页面 ASIN 不匹配(实际为 ' + (check || 'null') + '), 放弃读取以免写入错误数据' };
    }
    for (let k = 1; k <= 16; k++) {
      const p = await evalExpr(sess, EXPR_DETAIL_PANEL);
      if (p && p.ok && !p.analyzing) {
        return { ok: true, asin, url, panelText: p.txt, fields: parsePanelText(p.txt, p.flag || null), flag: p.flag || null, retried: round === 2 };
      }
      if (stopWanted(opts)) return { ok: false, err: '用户已停止' };
      await wait(opts, 3000);
    }
  }
  return { ok: false, asin, err: '插件数据始终没加载出来（已刷新重试）' };
}

/**
 * 阶段 2：点「卖家:N」+ 滚动加载 → 全部跟卖卖家
 * @returns {{ok:boolean, panelText:string|null, sellers:Array}}
 */
async function readFollowSellers(sess, opts) {
  const loc = await evalExpr(sess, EXPR_FIND_SELLER_BTN);
  if (!loc || !loc.ok) return { ok: false, err: (loc && loc.err) || '找不到卖家按钮', sellers: [] };
  await realClick(sess, loc.x, loc.y);
  await wait(opts, 8000);
  let sellers = [], prev = -1, stable = 0;
  for (let round = 1; round <= 14; round++) {
    if (stopWanted(opts)) break;
    await evalExpr(sess, EXPR_SCROLL_AOD);
    await wait(opts, 3500);
    const res = await evalExpr(sess, EXPR_READ_AOD);
    if (res && res.err) break;
    const u = (res && res.uniq) || 0;
    if (u > prev) stable = 0; else stable++;
    sellers = (res && res.sellers) || [];
    opts.log && opts.log('[多链接采集]   卖家滚动第 ' + round + ' 轮: ' + u + ' 个');
    prev = u;
    if (stable >= 3 && round >= 4) break;      // 连续 3 轮无新增 = 加载完
  }
  return { ok: sellers.length > 0, panelText: loc.text, sellers };
}

/**
 * 阶段 3a：进店铺
 *
 * 两条路径，别混用：
 *   ① 手上已经是"店铺列表页 URL"（用户给的 /s?me=XXX，或 /sp 规范化来的）→ 直接导航过去即可
 *      ★ 不要再去点"进店入口"：/s?me= 本身就是商品列表页，多绕一步反而会失败
 *   ② 手上只有 sellerId（从跟卖弹窗拿到的）→ 先开卖家简介页 /sp，再点「Visit the XXX storefront」
 */
async function gotoShop(sess, sellerId, site, opts, directShopUrl) {
  const suffix = opts.siteToHostSuffix(site);
  if (directShopUrl && /\/s[/?]/.test(directShopUrl)) {
    await sess.send('Page.navigate', { url: directShopUrl });
    await wait(opts, 12000);
    return { ok: true, direct: true, landingUrl: await evalExpr(sess, 'location.href') };
  }
  const profile = 'https://www.amazon.' + suffix + '/gp/aag/main?ie=UTF8&seller=' + sellerId + '&isAmazonFulfilled=0';
  await sess.send('Page.navigate', { url: profile });
  await wait(opts, 11000);
  const entry = await evalExpr(sess, EXPR_FIND_STORE_ENTRY);
  if (!entry || !entry.ok) {
    // 兜底：直接从 sellerId 构造店铺列表页
    const mk = SITE_MARKETPLACE[site];
    const fallback = 'https://www.amazon.' + suffix + '/s?ie=UTF8&marketplaceID=' + (mk || '') + '&me=' + sellerId;
    await sess.send('Page.navigate', { url: fallback });
    await wait(opts, 12000);
    return { ok: true, fallback: true, landingUrl: await evalExpr(sess, 'location.href') };
  }
  await realClick(sess, entry.x, entry.y);
  await wait(opts, 13000);
  return { ok: true, entryHref: entry.href, landingUrl: await evalExpr(sess, 'location.href') };
}

/**
 * 等这一页的插件数据渲染完
 *
 * 判定标准：卡片的插件文本里出现"卖家 : N"（这是插件分析完成后才有的字段）。
 * 只等"品牌"是不够的 —— 品牌先出来，但 店铺BSR/卖家数/月销 还在加载，
 * 那时读取会得到一堆空字段。
 * @returns {{cards:number, withPanel:number, withBrand:number, withCount:number}|null}
 */
async function waitCardsReady(sess, opts) {
  // ★ 插件未登录提示(只提示, 绝不影响放行): 放行时若还有一半以上卡片是「登录壳」就说一声
  let warnedLogin = false;
  const finish = (s) => {
    if (s && s.cards > 0 && s.notLogged >= Math.ceil(s.cards / 2) && !warnedLogin) {
      warnedLogin = true;
      opts.log && opts.log('[多链接采集]     ⚠ 插件面板显示「登录」: ' + s.notLogged + '/' + s.cards
        + ' 张卡只有登录壳(品牌/排名 也缺) —— 请到采集浏览器里登录「智赢」插件; 采集继续, 不中断');
    }
    return s;
  };
  // ★ 修复 (2026-09): 原实现有两个致命缺陷, 导致批量采到的商品大面积没有排名 ——
  //   ① cards===0 时 `if (k > 5) return stat` 立刻返回: 滚动会触发亚马逊懒加载【重渲染】,
  //      页面瞬时变成 0 卡片, 命中就整页丢排名(实测某批 308 个商品仅 21% 拿到店铺选品/父类排名)。
  //   ② 合格线写死"8 个卡片"(`Math.min(8, cards)`): 一页 34~48 个卡片时只要 8 个渲染完就放行,
  //      其余卡片读到的插件面板还是空的。
  //   现在: 空白页先等恢复; 合格线按【≥90% 比例 + 地板8】; 额外等待只看【增长是否停滞】;
  //   ★ 2026-09-25 实测(对照实验): 列表页滚动对插件数据的增量是 0 —— 不滚 15 秒也能补齐 48/48 品牌+卖家,
  //     滚一遍反而让亚马逊懒加载出新内容(文档高 11490→15323)引起重渲染。所以这里【不再滚动】, 只等数据自己到齐。
  const need = (cards) => (cards > 0 ? Math.max(8, Math.ceil(cards * 0.9)) : 1);
  const MEASURE = `(() => {
    ${COLLECT_FN}
    const cards = [...document.querySelectorAll('div[data-asin][data-component-type="s-search-result"]')]
      .filter((e) => /^[A-Z0-9]{10}$/.test(e.getAttribute('data-asin') || '') && e.querySelector('a[href*="/dp/"]'));
    let withPanel = 0, withBrand = 0, withCount = 0, withShopRank = 0, full = 0, notLogged = 0, mismatched = 0;
    for (const c of cards) {
      let t = '';
      c.querySelectorAll('[class*="zying"], [class*="zy-"], [id*="zying"]').forEach((n) => {
        const s = collect(n.shadowRoot || n, 0).replace(/\\s+/g, ' ').trim();
        if (/ASIN\\s*[:：]/.test(s) && s.length > t.length) t = s;
      });
      // ★ 2026-10-02 与 EXPR_READ_SHOP 同一口径: 面板里的 ASIN 与卡片不符 → 这份面板不算数,
      //   否则"错位的面板"会被当成"已经渲染好了", 提前放行 → 读到一堆错数据。
      if (t) {
        const pa = (t.match(/ASIN\\s*[:：]\\s*([A-Z0-9]{10})/) || [])[1] || '';
        if (pa && pa !== String(c.getAttribute('data-asin') || '').toUpperCase()) { t = ''; mismatched++; }
      }
      if (t) withPanel++;
      if (/品牌\\s*[:：]\\s*\\S/.test(t) && !/正在加载/.test(t)) withBrand++;
      if (/卖家\\s*[:：]\\s*\\d+/.test(t)) withCount++;              // 插件主体分析完成
      if (/店铺选品[^#]{0,80}#/.test(t)) withShopRank++;                // ★ 父类排名(最晚渲染; 2026-09 修正: 标签后未必紧跟 #)
      if (/卖家\\s*[:：]\\s*\\d+/.test(t) && /近30天销量\\s*[:：]\\s*\\S/.test(t) && /榜单选品\\s*#/.test(t) && /店铺选品[^#]{0,80}#/.test(t)) full++;
      // ★ 「登录壳」: 面板里只有「登录」字样, 既没有品牌、也没有店铺选品排名 —— 这种卡是登录才有的数据, 不是"还没滚到"
      if (/[:：]\\s*登录/.test(t) && !/品牌\\s*[:：]\\s*\\S/.test(t) && !/店铺选品[^#]{0,80}#/.test(t)) notLogged++;
    }
    return JSON.stringify({ cards: cards.length, withPanel, withBrand, withCount, withShopRank, full, notLogged, mismatched });
  })()`;

  let stat = null;
  let blankStreak = 0;                 // 连续空白(重渲染中)次数
  let bestShopRank = -1, stall = 0;    // 「店铺选品(父类)」增长停滞计数
  let extraPasses = 0;                 // 覆盖率不足时的额外等待轮数(实测滚动无用, 所以只等不滚)
  const MAX_ROUNDS = 40, MAX_BLANK = 3, MAX_STALL = 6, MAX_EXTRA_PASS = 2, MAX_MS = 90000;   // 上限不变(只等不滚)
  const t0 = Date.now();
  for (let k = 1; k <= MAX_ROUNDS; k++) {
    if (stopWanted(opts)) break;
    if (Date.now() - t0 > MAX_MS) break;              // 硬上限, 防止单页无限等
    await wait(opts, 2500);
    const r = await evalExpr(sess, MEASURE);
    if (!r || r.err) continue;
    if (r.cards === 0) {
      blankStreak++;
      opts.log && opts.log('[多链接采集]     插件渲染 ' + k + '/' + MAX_ROUNDS + ': 页面空白(重渲染中) ' + blankStreak + '/' + MAX_BLANK);
      if (blankStreak >= MAX_BLANK) return finish(stat);       // 连续多次仍空白 → 才放弃
      continue;
    }
    blankStreak = 0;
    stat = r;
    const nd = need(r.cards);
    opts.log && opts.log('[多链接采集]     插件渲染 ' + k + '/' + MAX_ROUNDS + ': ' + JSON.stringify(r) + ' 需>=' + nd);
    // 主体(卖家数)就绪后, 专等最晚渲染的「店铺选品(父类/大排名)」: 只看增长是否停滞
    if (r.withCount >= Math.min(8, r.cards)) {
      if (r.full >= nd) return finish(stat);
      if (r.withShopRank > bestShopRank) { bestShopRank = r.withShopRank; stall = 0; }
      else { stall++; }
      if (stall >= MAX_STALL) {
        // 父类排名覆盖不足时再多等一轮(实测滚动不会带来新数据, 所以这里只等不滚), 最多 MAX_EXTRA_PASS 次
        if (r.withShopRank < Math.ceil(r.cards * 0.5) && extraPasses < MAX_EXTRA_PASS) {
          extraPasses++;
          stall = 0;
          bestShopRank = -1;
          opts.log && opts.log('[多链接采集]     父类排名覆盖不足(' + r.withShopRank + '/' + r.cards + '), 再等一轮(不滚动)');
          continue;
        }
        return finish(stat);
      }
    }
  }
  return finish(stat);
}

/**
 * 阶段 3b：采一个店铺的商品（翻 shopPages 页）
 * @returns {{ok:boolean, products:Array, pages:number, total:string|null}}
 */
/**
 * 进详情页把某个商品的排名读回来。
 * 背景(实测 2026-09): 插件在**列表页**基本不给排名 —— 店铺页 16 张卡只有 1 张有「店铺选品」,
 * 品牌页 0 张, 而且等 54 秒也不会变多; 但**进详情页等约 12~15 秒**能拿到完整面板
 * (店铺选品 #N 宽类目 + 榜单选品 #N 细分类目 都有)。所以「缺排名就进详情页补」是唯一有效手段。
 * 返回 parsePanelText 的结果, 且**必须等到排名出现**才返回(除非面板已分析完确实没有排名)。
 */
async function readDetailRank(sess, asin, site, opts) {
  const url = 'https://www.amazon.' + opts.siteToHostSuffix(site) + '/dp/' + asin;
  await sess.send('Page.navigate', { url });
  const waitMs = Math.max(8000, Number(opts.rankWaitMs) || 20000);
  const rounds = Math.max(2, Math.min(12, Math.round(waitMs / 4000)));
  let last = null;
  for (let k = 1; k <= rounds; k++) {
    await wait(opts, k === 1 ? 9000 : 4000);
    if (stopWanted(opts)) break;
    const check = await evalExpr(sess, EXPR_PAGE_ASIN);
    if (String(check || '') !== String(asin)) continue;          // 防串页: 导航没到位就不读
    const p = await evalExpr(sess, EXPR_DETAIL_PANEL);
    if (!p || !p.ok) continue;
    // ★ 2026-10-02 卖家国旗: 详情页面板里也读一次(排名闸门进详情页时顺手把卖家国家补上)
    last = parsePanelText(p.txt, p.flag || null);
    // ★ 结构化排名行(权威): 覆盖文本正则, 并给出"未上榜/没采到"三态
    const rr = await evalExpr(sess, EXPR_DETAIL_RANKS);
    if (rr && rr.ok) {
      const rk = classifyRanks(rr);
      if (rr.flag && last.chinaSeller == null) {                 // 面板那里没读到 → 用排名读取那一次的结果兜底
        last.sellerCountryCode = String(rr.flag.code || '').toUpperCase() || null;
        last.sellerFlagCode = String(rr.flag.flagCode || '').toUpperCase() || null;
        last.chinaSeller = rr.flag.code ? isChinaRegionCode(rr.flag.code) : null;
      }
      if (rk.rankRows && rk.rankRows.length) {
        last.bsrShop = rk.bsrShop; last.bsrShopCat = rk.bsrShopCat;
        last.bsrCat = rk.bsrCat; last.bsrCatName = rk.bsrCatName;
        last.rankRows = rk.rankRows; last.rankBare = rk.rankBare;
        last.rankParentState = rk.rankParentState; last.rankChildState = rk.rankChildState;
        last.rankSrc = 'detail-dom';
        if (rk.bsrShop || rk.bsrCat) return last;                // ★ 拿到排名才收工
        // 面板已就绪、确实读了行、但没有根类目行 → 这就是"未上榜", 不必再等
        if (rk.rankParentState === 'not_listed' && !p.analyzing) return last;
      }
    }
    if (last.bsrShop || last.bsrCat) return last;                // 文本正则兜底
    if (!p.analyzing && k >= 3) return last;                     // 面板已分析完仍无排名 → 这商品确实没有, 不白等
  }
  return last;
}

/**
 * 排名闸门: 列表页没给排名的商品, **逐个进详情页把排名读回来再继续下一个单元**。
 * opts.rankGate=false 关闭; opts.rankGateLimit=0 表示不限(每个缺排名的商品都去补, 每个约 12~15 秒)。
 * 只补排名字段 —— 品牌名不覆盖列表页从品牌链接取到的干净值(坑 33)。
 */
async function gateRanksByDetail(sess, cards, site, opts) {
  const stat = { candidates: 0, tried: 0, got: 0, still: 0 };
  if (!opts.rankGate) return stat;
  const missing = (cards || []).filter((c) => c && c.asin && !c.bsrShop && !c.bsrCat && !(Array.isArray(c.bsr) && c.bsr.length));
  stat.candidates = missing.length;
  if (!missing.length) return stat;
  const limit = Math.max(0, Number(opts.rankGateLimit) || 0) || missing.length;
  for (const c of missing.slice(0, limit)) {
    if (stopWanted(opts)) break;
    stat.tried++;
    opts.bumpCollectProgress && opts.bumpCollectProgress({ step: '进详情页补排名 ' + c.asin + ' (' + stat.tried + '/' + Math.min(limit, missing.length) + ')' });
    const r = await readDetailRank(sess, c.asin, site, opts);
    // ★ 三态一起带回来: 详情页面板"明确没有大排名"→ 标未上榜(不是没采到)
    if (r && r.rankParentState) {
      c.rankParentState = r.rankParentState;
      c.rankChildState = r.rankChildState || c.rankChildState || 'unknown';
      if (r.rankRows) c.rankRows = r.rankRows;
      if (r.rankParentState === 'not_listed') { c.bsrShop = null; c.bsrShopCat = null }
    }
    if (r && (r.bsrShop || r.bsrCat)) {
      c.bsrShop = c.bsrShop || r.bsrShop || null;
      c.bsrShopCat = c.bsrShopCat || r.bsrShopCat || null;
      c.bsrCat = c.bsrCat || r.bsrCat || null;
      c.bsrCatName = c.bsrCatName || r.bsrCatName || null;
      if (r.rankSrc) c.rankSrc = r.rankSrc;
      c.rankFromDetail = true;
      stat.got++;
      opts.log && opts.log('[多链接采集]     ⤵ 详情页补到排名 ' + c.asin + ': 大(根类目)=' + (r.bsrShop || '-') + ' 小(子类目)=' + (r.bsrCat || '-'));
    } else if (r && r.rankParentState === 'not_listed') {
      stat.still++;
      opts.log && opts.log('[多链接采集]     ⤵ 详情页确认【未上榜】' + c.asin + ' (面板已分析完, 没有根类目排名行)' + (r.bsrCat ? ', 小排名=' + r.bsrCat : ''));
    } else {
      stat.still++;
      opts.log && opts.log('[多链接采集]     ⤵ 详情页也没读到排名(未采集到, 不等同未上榜) ' + c.asin);
    }
  }
  // 统计由调用方(编排)汇总到 report.rankGate —— 不能再往 opts 上挂对象:
  // 编排层给各阶段传的是 opts 的副本, 挂上去的那份报告里看不到(实测 report.rankGate 恒为 0)。
  return stat;
}

async function collectShopProducts(sess, sellerId, site, opts) {
  const mk = SITE_MARKETPLACE[site];
  const base = 'https://www.amazon.' + opts.siteToHostSuffix(site) + '/s?ie=UTF8&marketplaceID=' + (mk || '') + '&me=' + sellerId;
  const products = [];
  const seen = new Set();
  const gateSum = { candidates: 0, tried: 0, got: 0, still: 0 };   // 排名闸门统计(按页累加, 由编排汇总到报告)
  const loginWarn = { cards: 0, notLogged: 0, pages: 0 };          // ★ 插件未登录(面板只有"登录"壳)统计: 只提示, 不停
  let totalText = null, rangeText = null, pagesDone = 0;

  for (let page = 1; page <= opts.shopPages; page++) {
    if (stopWanted(opts)) break;
    const url = page === 1 ? base : base + '&page=' + page;
    await sess.send('Page.navigate', { url });
    await wait(opts, 12000);
    // ★ 等插件把这一页的卡片渲染完（否则品牌/转换价读不到）
    const ready = await waitCardsReady(sess, opts);
    opts.log && opts.log('[多链接采集]   店铺 ' + sellerId + ' 第 ' + page + ' 页插件就绪: ' + JSON.stringify(ready));
    // ★ 插件未登录: 只累计 + 记日志(在 waitCardsReady 里已打), 绝不停采集
    // ★ 只有「一半以上卡片是登录壳」的页才算一次未登录提示(单张卡偶发登录壳不算, 避免误报)
    if (ready && ready.notLogged >= Math.ceil((ready.cards || 0) / 2)) { loginWarn.cards += ready.cards || 0; loginWarn.notLogged += ready.notLogged; loginWarn.pages++; }

    const d = await evalExpr(sess, EXPR_READ_SHOP);
    if (!d || d.err) break;
    if (!totalText) { totalText = d.total; rangeText = d.range; }
    pagesDone++;
    let n = 0;
    const pageCards = [];
    for (const c of d.cards) {
      if (seen.has(c.asin)) continue;
      seen.add(c.asin);
      if (c.__panelTxt) Object.assign(c, parsePanelText(c.__panelTxt, c.__flag || null));
      delete c.__panelTxt; delete c.__flag;
      // ★ 结构化排名行优先于文本正则(旧正则会跨行把子类目数字写成大排名)
      if (c.__rank) {
        const rk = classifyRanks(c.__rank);
        if (rk.rankRows && rk.rankRows.length) {
          c.bsrShop = rk.bsrShop; c.bsrShopCat = rk.bsrShopCat;
          c.bsrCat = rk.bsrCat; c.bsrCatName = rk.bsrCatName;
          c.rankRows = rk.rankRows; c.rankBare = rk.rankBare;
          c.rankParentState = rk.rankParentState; c.rankChildState = rk.rankChildState;
          c.rankSrc = 'card-dom';
        }
        delete c.__rank;
      }
      products.push(c);
      pageCards.push(c);
      n++;
    }
    // ★ 排名闸门: 这一页里没拿到排名的商品, 逐个进详情页把排名读回来, 然后再继续下一页
    const gs = await gateRanksByDetail(sess, pageCards, site, opts);
    gateSum.candidates += gs.candidates; gateSum.tried += gs.tried; gateSum.got += gs.got; gateSum.still += gs.still;
    if (gs.tried) opts.log && opts.log('[多链接采集]   店铺 ' + sellerId + ' 第 ' + page + ' 页排名闸门: 缺 ' + gs.candidates + ' → 进详情页 ' + gs.tried + ' 个, 补到排名 ' + gs.got + ', 仍无排名 ' + gs.still);
    opts.log && opts.log('[多链接采集]   店铺 ' + sellerId + ' 第 ' + page + ' 页: ' + d.cards.length + ' 个, 新增 ' + n);
    opts.bumpCollectProgress && opts.bumpCollectProgress({ step: '店铺商品 ' + sellerId, page, pages: opts.shopPages, items: products.length });
    if (d.cards.length < 10) break;                    // 不足一页 = 最后一页
    if (opts.maxItems && products.length >= opts.maxItems) break;
  }
  if (opts.maxItems) products.splice(opts.maxItems);
  return { ok: products.length > 0, products, pages: pagesDone, total: totalText, range: rangeText, rankGate: gateSum, loginWarn: loginWarn };
}

/**
 * 阶段 4：采一个品牌的商品（翻 brandPages 页，按品牌过滤混入的他牌）
 */
/**
 * 每个品牌最多留存多少条「剔除他牌」明细到报告里(带亚马逊直达链接)。
 * 明细只用于报告展示, 不参与入库; 上限是防止报告文件被超大品牌页撑爆 ——
 * 超出部分仍然计数(mixed), 界面会显示"只留存最近 N 条"。
 */
const MIXED_ITEM_MAX = 200;
/** 一份报告里最多留存多少条剔除明细(所有品牌合计) */
const MIXED_TOTAL_MAX = 800;

async function collectBrandProducts(sess, brand, brandLink, site, opts) {
  const u = (() => { try { return new URL(brandLink) } catch { return null } })();
  const kw = (u && u.searchParams.get('field-keywords')) || brand;
  const base = 'https://www.amazon.' + opts.siteToHostSuffix(site) + '/s?k=' + encodeURIComponent(kw);
  const host = 'https://www.amazon.' + opts.siteToHostSuffix(site);
  const products = [];
  const seen = new Set();
  const gateSum = { candidates: 0, tried: 0, got: 0, still: 0 };   // 排名闸门统计(按页累加)
  const mixedItems = [];                                          // ★ 剔除他牌明细(带直达链接)
  const loginWarn = { cards: 0, notLogged: 0, pages: 0 };          // ★ 插件未登录统计: 只提示, 不停
  let mixed = 0, pagesDone = 0;

  for (let page = 1; page <= opts.brandPages; page++) {
    if (stopWanted(opts)) break;
    await sess.send('Page.navigate', { url: page === 1 ? base : base + '&page=' + page });
    await wait(opts, 13000);
    // 品牌页同样要等插件渲染（品牌页的插件数据也在卡片里）
    const ready = await waitCardsReady(sess, opts);
    opts.log && opts.log('[多链接采集]   品牌 ' + brand + ' 第 ' + page + ' 页插件就绪: ' + JSON.stringify(ready));
    // ★ 只有「一半以上卡片是登录壳」的页才算一次未登录提示(单张卡偶发登录壳不算, 避免误报)
    if (ready && ready.notLogged >= Math.ceil((ready.cards || 0) / 2)) { loginWarn.cards += ready.cards || 0; loginWarn.notLogged += ready.notLogged; loginWarn.pages++; }

    const d = await evalExpr(sess, EXPR_READ_SHOP);
    if (!d || d.err) break;
    pagesDone++;
    // ★ 2026-09 「剔除他牌」改为采集过滤开关: 默认剔除(原行为); filter.dropOtherBrand==='0' 时把他牌也收下
    const keepOther = !!(opts.filter && (opts.filter.dropOtherBrand === '0' || opts.filter.dropOtherBrand === 0 || opts.filter.dropOtherBrand === false));
    const same = keepOther ? d.cards.slice() : d.cards.filter((c) => c.sameBrand !== false);
    mixed += (d.cards.length - same.length);
    // ★ 剔除他牌的明细(带亚马逊直达链接, 供采集报告里逐条跳转): 上限 MIXED_ITEM_MAX 条/品牌
    for (const c of d.cards) {
      if (c.sameBrand !== false) continue;
      if (mixedItems.length >= MIXED_ITEM_MAX) break;
      if (mixedItems.some((x) => x.asin === c.asin)) continue;
      mixedItems.push({
        asin: c.asin,
        title: c.title ? String(c.title).slice(0, 90) : null,
        brand: c.brand || null,                                  // 卡片上实际看到的品牌
        target: brand,                                           // 目标品牌(不是我方)
        url: c.productUrl || (host + '/dp/' + c.asin),           // ★ 亚马逊商品页直达链接
        page,
      });
    }
    let n = 0;
    const pageCards = [];
    for (const c of same) {
      if (seen.has(c.asin)) continue;
      seen.add(c.asin);
      if (c.__panelTxt) Object.assign(c, parsePanelText(c.__panelTxt, c.__flag || null));
      delete c.__panelTxt; delete c.__flag;
      // ★ 结构化排名行优先于文本正则(旧正则会跨行把子类目数字写成大排名)
      if (c.__rank) {
        const rk = classifyRanks(c.__rank);
        if (rk.rankRows && rk.rankRows.length) {
          c.bsrShop = rk.bsrShop; c.bsrShopCat = rk.bsrShopCat;
          c.bsrCat = rk.bsrCat; c.bsrCatName = rk.bsrCatName;
          c.rankRows = rk.rankRows; c.rankBare = rk.rankBare;
          c.rankParentState = rk.rankParentState; c.rankChildState = rk.rankChildState;
          c.rankSrc = 'card-dom';
        }
        delete c.__rank;
      }
      products.push(c);
      pageCards.push(c);
      n++;
    }
    // ★ 排名闸门: 品牌页缺排名的商品同样进详情页补到排名再继续(品牌页插件给排名的比例比店铺页还低)
    const gs = await gateRanksByDetail(sess, pageCards, site, opts);
    gateSum.candidates += gs.candidates; gateSum.tried += gs.tried; gateSum.got += gs.got; gateSum.still += gs.still;
    if (gs.tried) opts.log && opts.log('[多链接采集]   品牌 ' + brand + ' 第 ' + page + ' 页排名闸门: 缺 ' + gs.candidates + ' → 进详情页 ' + gs.tried + ' 个, 补到排名 ' + gs.got + ', 仍无排名 ' + gs.still);
    opts.log && opts.log('[多链接采集]   品牌 ' + brand + ' 第 ' + page + ' 页: 真商品 ' + d.cards.length + ', 同品牌 ' + same.length + ', 混入 ' + (d.cards.length - same.length) + ', 新增 ' + n);
    opts.bumpCollectProgress && opts.bumpCollectProgress({ step: '品牌商品 ' + brand, page, pages: opts.brandPages, items: products.length });
    if (d.cards.length < 10) break;
    if (opts.maxItems && products.length >= opts.maxItems) break;
  }
  if (opts.maxItems) products.splice(opts.maxItems);
  return { ok: products.length > 0, products, pages: pagesDone, mixed, mixedItems, rankGate: gateSum, loginWarn: loginWarn };
}

// ══════════════════════════════════════════════════════════════════
// 四、长跑基础设施：会话管家 / 探活 / 验证码 / 重试 / 限速
// ══════════════════════════════════════════════════════════════════

/** 页面健康检查表达式(验证码 / 登录墙 / 白页) —— 实测: 中招后必须立刻停, 否则一路空转到结束 */
const EXPR_PAGE_HEALTH = `(() => {
  const tx = (document.title || '') + ' ' + (document.body ? (document.body.innerText || '').slice(0, 4000) : '');
  const captcha = /Enter the characters you see below|Robot Check|Type the characters you see|are you a robot|not a robot|api-services-support@amazon|验证您不是机器人|输入您看到的字符|Zeichen, die Sie sehen|Saisissez les caract/i.test(tx);
  return JSON.stringify({ ok: true, url: location.href, title: document.title, captcha, blank: !document.body || (document.body.innerText || '').trim().length < 20 });
})()`;

/** 限速: 单元之间随机 1~2 倍基准(默认 1500ms → 实际 1.5~3s), 降低被反爬的概率 */
async function pace(P, mult = 1) {
  const base = Number(P && P.delayMs) || 0;
  if (base <= 0) return;
  await sleep(base * mult * (1 + Math.random()));
}

/**
 * 退避重试: 3s → 6s → 12s → 24s(封顶 30s)。
 *
 * ★ attempts 的语义是「本次尝试次数」, 调用方要【累加】到单元上
 *   (s.attempts = (s.attempts||0) + (out.attempts||1)), 否则每次续跑都从 1 开始,
 *   反复失败的单元在排障时看不出来。
 */
async function withRetry(P, label, fn) {
  const max = Math.max(0, Number(P.retry) || 0);
  let lastErr = null, attempts = 0;
  for (let attempt = 0; attempt <= max; attempt++) {
    attempts = attempt + 1;
    if (stopWanted(P)) return { ok: false, err: '用户已停止', stopped: true, attempts };
    try {
      const out = await fn(attempt);
      if (out && out.captcha) return Object.assign({}, out, { attempts });
      if (out && out.ok === false && out.err) lastErr = out.err;
      else return Object.assign({}, out, { attempts });
    } catch (e) { lastErr = (e && e.message) || '异常' }
    if (attempt < max) {
      const waitMs = Math.min(30000, 3000 * Math.pow(2, attempt));   // 3s → 6s → 12s → 24s
      P.log && P.log('[多链接采集] ↻ ' + label + ' 失败(' + lastErr + ') → ' + Math.round(waitMs / 1000) + 's 后重试 ' + (attempt + 1) + '/' + max);
      if (typeof P.onCheckpoint === 'function' && P.job) P.onCheckpoint(P.job, 'retry');
      await sleep(waitMs);
    }
  }
  return { ok: false, err: lastErr || '失败', attempts };
}

/**
 * 会话管家: 探活 + 自动重连。
 *
 * 用一个代理对象把「当前会话」藏起来 —— 这样所有 helper(readProductPanel/gotoShop/
 * collectShopProducts/...) 都不用改: 它们拿到的 sess.send 每次都指向当前那个会话;
 * 需要底层 ws 的地方(极少)通过 getter 取。
 *
 * 探活失败会重连最多 3 次; 仍失败抛错, 由调用方把任务标成 paused(cdp-down) 后收尾 ——
 * 比让异常冒泡更好: 前端看到的是「接着跑」而不是一句 error。
 */
async function createKeeper(P) {
  let sess = await attachPage(P);
  const keeper = {
    get sess() { return sess },
    /** true=活着; 失联则自动重连(重连 3 次仍失败才抛错) */
    async ensure(label) {
      const r = await sess.send('Runtime.evaluate', { expression: '1', returnByValue: true });
      if (r && !r.__timeout && !r.__err && !r.__closed) return true;
      P.log && P.log('[多链接采集] ⚠ CDP 会话失联 (' + (label || '') + ') → 重新连接标签页');
      try { sess.close() } catch (e) { /* 忽略 */ }
      let lastErr = null;
      for (let k = 1; k <= 3; k++) {
        try {
          sess = await attachPage(P);
          P.log && P.log('[多链接采集] ✔ 已重连标签页 (第 ' + k + ' 次尝试)');
          return true;
        } catch (e) { lastErr = e; await sleep(3000) }
      }
      const err = new Error('CDP 会话失联且重连失败: ' + ((lastErr && lastErr.message) || '') + '(Edge 是否还开着 9222 调试端口?)');
      err.cdpDown = true;
      throw err;
    },
    /** 探活之外还要看页面有没有中招(验证码) */
    async healthy(label) {
      const h = await evalExpr(sess, EXPR_PAGE_HEALTH);
      if (h && h.captcha) {
        P.log && P.log('[多链接采集] ⛔ 遇到机器人验证/登录墙 (' + (label || '') + ') → 任务暂停: ' + (h.url || ''));
        return false;
      }
      return true;
    },
    close() { try { sess.close() } catch (e) { /* 忽略 */ } },
  };
  return keeper;
}

// ══════════════════════════════════════════════════════════════════
// 五、主编排：单元驱动 + 逐单元落盘（任务化 / 断点续跑）
// ══════════════════════════════════════════════════════════════════
/**
 * 采集链路(按任务的三张待办清单逐个单元处理):
 *   阶段 1 链接 → 卖家      每处理一条链接   → checkpoint('link')
 *   阶段 2 店铺 → 店铺商品  每个店铺采完     → checkpoint('shop')  + 顺手登记品牌
 *   阶段 3 品牌 → 品牌商品  每个品牌采完     → checkpoint('brand')
 *   每批链接结束 → checkpoint('batch'); 收尾 → checkpoint('finish'); 暂停 → checkpoint('paused')
 *
 * @param {string[]} urls 用户给的链接(只跳这些)
 * @param {object} opts
 *   job          任务对象(不传则内部新建一个)
 *   onCheckpoint (job, reason) => void   每完成一个单元调用; reason=link|shop|brand|batch|retry|paused|finish
 *   batchSize    每批链接数(默认 20)
 *   retry        单单元失败重试次数(默认 2)
 *   delayMs      单元之间限速基准毫秒(默认 1500)
 *   pauseOnCaptcha 中招验证码时暂停整个任务(默认 true)
 *   waitScale    页面等待倍率(1=实测默认; <1 快跑自测)
 *   shopPages / brandPages / maxShops / maxItems / collectBrands / zip / filter
 *   注入: cdpGetTabs / siteToHostSuffix / resolveCollectSite / classifySellerLink /
 *         applyCollectFilter / ingestShopProducts / bumpCollectProgress /
 *         collectStopRequested / log / openSession(测试注入假 CDP)
 *         cdpCreateTab / cdpCloseTab (并行: 给每个 worker 开/关它自己的标签页)
 */
async function collectByLinks(urls, opts = {}) {
  const P = Object.assign({
    shopPages: 1, brandPages: 1, maxShops: 0, maxItems: 0,
    collectBrands: true, filter: {},
    cdpGetTabs: null, siteToHostSuffix: null, resolveCollectSite: null,
    classifySellerLink: null, applyCollectFilter: null, ingestShopProducts: null,
    bumpCollectProgress: null, collectStopRequested: null, log: null,
    job: null, onCheckpoint: null, batchSize: null, retry: null, delayMs: null,
    pauseOnCaptcha: true, waitScale: 1, openSession: null, jobId: null,
    // ★ 并行: concurrency=并行标签页数(1-6, 默认 4); cdpCreateTab/cdpCloseTab 由 server.js 注入
    //   (PUT /json/new · GET /json/close/<id>) —— 没注入就退回单标签页串行, 见下面的校验。
    concurrency: 4, cdpCreateTab: null, cdpCloseTab: null,
    // ★ 排名闸门(默认开): 列表页没给排名的商品, 进它的详情页把排名读回来再继续下一个单元。
    //   实测: 列表页 16 张卡只有 0~1 张有「店铺选品」, 等 54 秒也不变; 详情页等 12~15 秒能拿到。
    //   rankGateLimit=0 → 不限(每个都补, 每个约 12~15 秒; 想快就设成 3~8); rankWaitMs 单个商品的等待上限。
    rankGate: true, rankGateLimit: 0, rankWaitMs: 20000,
  }, opts);

  for (const need of ['cdpGetTabs', 'siteToHostSuffix', 'classifySellerLink']) {
    if (typeof P[need] !== 'function') throw new Error('collectByLinks 缺少依赖: ' + need);
  }
  P.shopPages = Math.min(20, Math.max(1, Number(P.shopPages) || 1));
  P.brandPages = Math.min(20, Math.max(1, Number(P.brandPages) || 1));
  P.maxShops = Math.max(0, Number(P.maxShops) || 0);
  P.maxItems = Math.max(0, Number(P.maxItems) || 0);
  P.batchSize = Math.min(100, Math.max(1, Number(P.batchSize) || 20));
  P.delayMs = Math.max(0, Number(P.delayMs == null ? 1500 : P.delayMs) || 0);
  P.retry = Math.max(0, Number(P.retry == null ? 2 : P.retry) || 0);
  // 布尔参数要显式判真值：0 / '0' / false / '' 都是关闭
  // （坑：直接写了 `!== false && !== '0'`，结果数值 0 被当成真值，关了开关还是照采）
  P.collectBrands = !(P.collectBrands === false || P.collectBrands === 'false' || P.collectBrands === 0 || P.collectBrands === '0' || P.collectBrands === '');

  // ★ 并行标签页数: clamp 到 1..6(与跟卖并行族同一个上限); 缺省 4。
  P.concurrency = Math.min(6, Math.max(1, Number(P.concurrency) || 4));
  if (P.concurrency > 1 && typeof P.cdpCreateTab !== 'function') {
    // 独立使用本模块时没注入"开标签页"的能力 → 退回单标签页串行, 但必须说清楚为什么:
    // 静默退化(用户设了 4 却按 1 跑)是最难查的那类问题。
    P.log && P.log('[多链接采集] ⚠ 未注入 cdpCreateTab → 并行不可用, 退回单标签页串行 (concurrency=' + P.concurrency + ' 不生效)');
    P.concurrency = 1;
  }

  // 任务对象: 没传就内部建一个(保持"不传 job 也能直接用"的老行为)
  const L = linkJobs;
  const job = P.job || L.newJob(urls, {
    shopPages: P.shopPages, brandPages: P.brandPages, maxShops: P.maxShops, maxItems: P.maxItems,
    collectBrands: P.collectBrands, zip: P.zip, filter: P.filter,
  }, { batchSize: P.batchSize, retry: P.retry, delayMs: P.delayMs }, P.jobId);
  job.batchSize = P.batchSize;
  job.retry = P.retry;
  job.delayMs = P.delayMs;
  // ★ 并行度也记进任务(坑 28 的续跑沿用): 续跑请求通常不带 concurrency,
  //   任务里没存就会掉回默认 4 —— 用户设的 2 或 6 会"悄悄变掉"。
  job.opts = Object.assign({}, job.opts, { concurrency: P.concurrency });
  if (P.batchSize) L.buildBatches(job);
  L.upsertLinks(job, urls);              // 续跑时: 已存在的链接保留原状态
  if (urls.length) L.buildBatches(job);
  job.status = 'running';
  job.pauseReason = null;

  // ★ 并行改造(坑 36): ck 变成"排队串行" —— 多个 worker 同时完成单元时, onCheckpoint 里的
  //   节流写盘 + prune + 进度上报不再是单线程时序, 必须串起来才不会互相覆盖/丢日志。
  //   调用方照旧不 await(行为不变), 收尾时用 ckDone() 把队列排空。
  let ckChain = Promise.resolve();
  const ck = (reason) => {
    if (typeof P.onCheckpoint !== 'function') return ckChain;
    ckChain = ckChain.then(() => {
      try { return P.onCheckpoint(job, reason) }
      catch (e) { P.log && P.log('[多链接采集] onCheckpoint 异常: ' + ((e && e.message) || e)) }
    }).catch(() => {});
    return ckChain;
  };
  const ckDone = () => ckChain.catch(() => {});
  const stopped = () => stopWanted(P);

  const t0 = Date.now();
  const report = {
    // ★ 排名闸门统计: 店铺/品牌阶段各自返回自己的统计, 在这里统一汇总(不能靠改 opts —— 各阶段拿到的是副本)
    rankGate: { candidates: 0, tried: 0, got: 0, still: 0 },
    // ★ 插件未登录统计(面板只画"登录"壳): 只提示, 绝不停采集
    pluginLogin: { cards: 0, notLogged: 0, pages: 0 },
    jobId: job.id,
    resumed: (job.round || 0) > 0,
    links: job.links.length,
    shopPages: P.shopPages,
    brandPages: P.brandPages,
    startedAt: new Date().toISOString(),
    steps: {},
    shopProducts: [],          // ① 跟卖商家的店铺商品(含被过滤的, 供品牌登记)
    brandProducts: [],         // ② 品牌商品
    mixedByBrand: [],          // ③ ★ 剔除他牌明细(按品牌分组, 供报告逐条跳转)
    errors: [],
    paused: false,
    pauseReason: null,
  };
  const filter = P.filter || {};
  const pass = (item) => (typeof P.applyCollectFilter === 'function' ? P.applyCollectFilter(item, filter) : true);
  // ★优化: 用户配了「采集筛选」却没注入 applyCollectFilter 时, 原来会静默全部放行 ——
  //   筛选看起来生效、实际一个都没过滤, 是最难发现的那类问题。这里明确告警。
  if (typeof P.applyCollectFilter !== 'function' && filter && Object.keys(filter).length) {
    P.log && P.log('[多链接采集] ⚠ 传入了采集筛选(共 ' + Object.keys(filter).length + ' 项)但未注入 applyCollectFilter → 筛选不会生效!');
  }
  const siteOf = (cls) => cls.site || (P.resolveCollectSite ? P.resolveCollectSite(P) : 'de');

  // 单元级别的通用收尾: CDP 断了 → 暂停任务而不是让异常冒泡
  const pauseFor = (reason, label, err) => {
    job.status = 'paused';
    job.pauseReason = reason;
    report.paused = true;
    report.pauseReason = reason;
    // ★ 正在跑的那个批次要一起收尾: 否则它会永远停在 running,
    //   界面上显示成「批次 1/1 running」+ 任务已暂停, 自相矛盾(也看不出该不该重跑这一批)。
    //   标成 interrupted 后: 任务卡显示「中断 N 批」, 续跑时这一批会被重跑(里面 done 的条目仍会跳过)。
    for (const b of job.batches || []) {
      if (b.status === 'running') { b.status = 'interrupted'; b.finishedAt = b.finishedAt || new Date().toISOString(); }
    }
    L.addLog(job, '暂停(' + reason + '): ' + (label || '') + ((err && err.message) ? ' — ' + err.message : ''));
    P.log && P.log('[多链接采集] ⏸ 任务暂停 reason=' + reason + ' @ ' + (label || ''));
    ck('paused');
  };

  // ── 开跑前先探一次 Edge 调试端口 ─────────────────────────────────
  // 价值: 让「Edge 没开 / 没带 9222 / 调试实例被普通 Edge 抢走」这几种最常见的现场失败,
  // 在日志里留下人话 + 排查步骤, 而不是只留一句 connect ECONNREFUSED。
  try {
    const tabs0 = await P.cdpGetTabs();
    const pages0 = (tabs0 || []).filter((t) => t.type === 'page');
    const amz0 = pages0.filter((t) => /amazon\./.test(String(t.url)));
    if (!pages0.length) {
      P.log && P.log('[多链接采集] ⚠ 调试版 Edge 里没有任何页面标签 —— 采集会失败, 请在该窗口里打开一个 Amazon 页面');
    } else {
      P.log && P.log('[多链接采集] 前置检查: Edge 调试端口正常, 页面标签 ' + pages0.length + ' 个(其中 amazon 页面 ' + amz0.length + ' 个)');
    }
  } catch (e) {
    P.log && P.log('[多链接采集] ⚠ Edge 调试端口探测失败: ' + ((e && e.message) || e));
    P.log && P.log('[多链接采集]    排查: ① 先完全退出所有 msedge.exe ② 再运行「启动采集浏览器.bat」 ③ 浏览器打开 http://127.0.0.1:9222/json/version 能返回 JSON 才算就绪');
  }

  // ══════════════════════════════════════════════════════════════════
  // 并行工作池: concurrency 个 worker, 每个 worker = 独立标签页 + 独立 CDP 会话
  // ══════════════════════════════════════════════════════════════════
  // ★ 为什么必须"一个 worker 一张标签页、一个会话"(坑 35): 一个 CDP 会话背后就是一张
  //   网页 —— 两个 worker 共用它会互相踩踏(我导航你去读), 采到的数据会张冠李戴, 甚至把
  //   别人的商品写进库。所以 会话 / 探活 / 重连 / 导航计数 全部按 worker 隔离。
  const pool = {
    size: P.concurrency,
    workers: [],
    aborted: false,           // 全局熔断: 任一 worker 中招验证码/异常暂停 → 其余立刻收工
    abortReason: null,
    /** 记下第一次熔断的原因; 返回 true 表示"是我触发的"(只打一次日志用) */
    abort(reason) {
      if (this.aborted) return false;
      this.aborted = true;
      this.abortReason = reason || 'aborted';
      return true;
    },
    /** 所有循环的统一判定: 全局熔断(验证码/暂停) 或 用户点了停止 */
    abortedNow() { return this.aborted || stopped(); },
    /** 收尾: 关掉本模块建的会话与标签页 —— 用户自己开着的标签页绝不关 */
    async close() {
      for (const w of this.workers) {
        try { w.keeper.close() } catch (e) { /* 忽略 */ }
        if (w.created && w.tab && typeof P.cdpCloseTab === 'function') {
          try {
            await P.cdpCloseTab(w.tab.targetId);
            P.log && P.log('[多链接采集] 已关闭 worker ' + w.id + ' 的标签页 ' + w.tab.targetId);
          } catch (e) { /* 忽略 */ }
        }
      }
    },
  };

  /** 单元级日志: 带 worker 号 + 毫秒时钟 —— 并行时"谁在什么时候跑了哪个单元"一目了然 */
  const clock = () => { const d = new Date(); return d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0') };
  const wlog = (w, msg) => { P.log && P.log('[多链接采集] ' + msg + ' [w' + w.id + ' @' + clock() + ']') };

  /** 给 worker 的会话挂上"同一张标签页重开通道"的钩子(思路同 attachPage, 但按 worker 隔离) */
  function bindWorkerReopen(tab, sess) {
    sess.reopen = async () => {
      try {
        const open = typeof P.openSession === 'function' ? P.openSession : openSession;
        let url = tab.wsUrl;
        try {
          const list = await P.cdpGetTabs();
          const again = (list || []).find((t) => t.id === tab.targetId && t.webSocketDebuggerUrl);
          if (again) url = again.webSocketDebuggerUrl;
        } catch (e) { /* 拿不到列表就用缓存的 wsUrl */ }
        const fresh = await open(url, P.evalTimeoutMs || 30000);
        if (!fresh) return false;
        fresh.reopen = sess.reopen;
        sess.ws = fresh.ws; sess.send = fresh.send;
        P.log && P.log('[多链接采集] CDP 通道已重连 (worker 标签页 ' + tab.targetId + ')');
        if (typeof P.onReconnect === 'function') { try { P.onReconnect({ stage: 'eval', tabId: tab.targetId }) } catch (e) { /* 忽略 */ } }
        return true;
      } catch (e) { return false; }
    };
    return sess;
  }

  /**
   * 建一个 worker。
   *   concurrency=1 → 走 attachPage: 复用浏览器里已有的标签页(通常就是用户开着亚马逊的那个),
   *     不新建、收尾也不关它 —— 这是旧版行为, 必须一模一样。
   *   concurrency>1 → 用注入的 cdpCreateTab(server.js 的 PUT /json/new) 给每个 worker 开自己的标签页。
   */
  async function createWorker(id) {
    const open = typeof P.openSession === 'function' ? P.openSession : openSession;
    if (pool.size === 1) {
      const sess = await attachPage(P);
      return { id, sess, tab: null, created: false, navCount: 0 };
    }
    const raw = await P.cdpCreateTab('about:blank');
    const targetId = raw && (raw.targetId || raw.id);
    const wsUrl = raw && (raw.wsUrl || raw.webSocketDebuggerUrl);
    if (!targetId || !wsUrl) throw new Error('cdpCreateTab 未返回 targetId/wsUrl: ' + JSON.stringify(raw).slice(0, 150));
    const tab = { targetId, wsUrl };
    // ★ 会话建不起来(标签页开出来了但连不上)不能把这张标签页留在浏览器里:
    //   否则每失败一次就漏一张空白标签页, 长跑下来会把采集浏览器塞满。
    let sess = null;
    try { sess = await open(wsUrl, P.evalTimeoutMs || 30000) }
    catch (e) {
      try { if (typeof P.cdpCloseTab === 'function') await P.cdpCloseTab(targetId) } catch (e2) { /* 忽略 */ }
      throw e;
    }
    if (!sess) {
      try { if (typeof P.cdpCloseTab === 'function') await P.cdpCloseTab(targetId) } catch (e) { /* 忽略 */ }
      throw new Error('openSession 未返回会话');
    }
    return { id, sess: bindWorkerReopen(tab, sess), tab, created: true, navCount: 0 };
  }

  /** worker 的会话管家: 探活 + 只重连自己那张标签页(找不回就给自己重开一张, 池子大小不变) */
  function createWorkerKeeper(w) {
    return {
      get sess() { return w.sess },
      async ensure(label) {
        const r = await w.sess.send('Runtime.evaluate', { expression: '1', returnByValue: true });
        if (r && !r.__timeout && !r.__err && !r.__closed) return true;
        wlog(w, '⚠ CDP 会话失联 (' + (label || '') + ') → 重连');
        try { w.sess.close() } catch (e) { /* 忽略 */ }
        if (typeof w.sess.reopen === 'function') { try { if (await w.sess.reopen()) return true } catch (e) { /* 落到重开标签页 */ } }
        let lastErr = null;
        for (let k = 1; k <= 3; k++) {
          try {
            if (w.created && w.tab && typeof P.cdpCloseTab === 'function') { try { await P.cdpCloseTab(w.tab.targetId) } catch (e) { /* 忽略 */ } }
            const fresh = await createWorker(w.id);
            w.sess = fresh.sess; w.tab = fresh.tab; w.created = fresh.created;
            wlog(w, '✔ 已重连标签页 (' + ((w.tab && w.tab.targetId) || '复用已有标签页') + ')');
            return true;
          } catch (e) { lastErr = e; await sleep(WS_RECONNECT_WAIT_MS) }
        }
        const err = new Error('CDP 会话失联且重连失败: ' + ((lastErr && lastErr.message) || '') + '(Edge 是否还开着 9222 调试端口?)');
        err.cdpDown = true;
        throw err;
      },
      /** 探活之外还要看页面有没有中招(验证码 / 登录墙) */
      async healthy(label) {
        const h = await evalExpr(w.sess, EXPR_PAGE_HEALTH);
        if (h && h.captcha) {
          P.log && P.log('[多链接采集] ⛔ 遇到机器人验证/登录墙 (' + (label || '') + ') → 任务暂停: ' + (h.url || ''));
          return false;
        }
        return true;
      },
      close() { try { w.sess.close() } catch (e) { /* 忽略 */ } },
    };
  }

  // ★ 开局建池: 连不上(Edge 没开 / 调试端口没起)不能抛出去 —— 任务已经落盘了, 要标成
  //   paused(cdp-down) 让用户修好 Edge 后点「继续上次任务」, 而不是让接口 500 掉。
  //   并行时任何一张标签页建不出来都按同一口径处理: 浏览器状态不对, 先停下来。
  try {
    for (let i = 1; i <= pool.size; i++) {
      const w = await createWorker(i);
      w.keeper = createWorkerKeeper(w);
      w.P = Object.assign({}, P, {
        // ★ 让每个单元内部的循环(翻页/滚动/等插件)都能看到"全局熔断" —— 中招验证码后,
        //   正在跑的单元也会在下一个检查点立刻收手, 不再产生新的导航(要求 4)。
        shouldStop: () => pool.aborted || (typeof P.shouldStop === 'function' && P.shouldStop()),
      });
      pool.workers.push(w);
    }
    if (pool.size > 1) P.log && P.log('[多链接采集] 并行工作池就绪: ' + pool.size + ' 个独立标签页 (每个 worker 独立 CDP 会话/探活/重连)');
  } catch (e) {
    pauseFor('cdp-down', '建立 CDP 会话', e);
    L.addLog(job, '初始 CDP 会话建立失败(Edge 是否开着 9222 调试端口?): ' + ((e && e.message) || e));
    try { await pool.close() } catch (e2) { /* 忽略 */ }
  }

  /** 单元开始前: 探活 + 验证码检查。返回 false = 这个 worker 该收工了 */
  const ensureWorkerUnit = async (w, label) => {
    try { await w.keeper.ensure(label) }
    catch (e) { pauseFor('cdp-down', label, e); return false }
    const ok = await w.keeper.healthy(label);
    if (!ok) { pauseFor('captcha', label, null); return false }
    return true;
  };

  /**
   * 单元结束后: 再探活一次 + (这个单元确实导航过页面才)查验证码。
   * ★ 单元结束后必须查: 否则中招验证码会"白跑完一个单元", 甚至把后续单元都记成失败。
   * ★ 看 navCount: 没跳页面的单元留在上一次的页面上, 此时查标题/验证码是误判。
   */
  const afterWorkerUnit = async (w, label, navBefore) => {
    try { await w.keeper.ensure(label + ' 后') }
    catch (e) { P.log && P.log('[多链接采集] afterUnit catch: ' + ((e && e.message) || e)); pauseFor('cdp-down', label, e); return false }
    if (w.navCount > navBefore) {
      const ok = await w.keeper.healthy(label + ' 后');
      if (!ok) { pauseFor('captcha', label, null); return false }
    }
    return true;
  };

  /**
   * 并行跑一组单元: pool.size 个 worker 抢同一个游标(动态负载均衡 —— 慢单元不会拖住别人)。
   * ★ 传进来的 units 只包含【本轮需要跑的】: done/skipped 由调用方先过滤 → 续跑"零导航跳过"。
   * @param label    阶段名(日志/暂停原因用)
   * @param units    单元数组
   * @param labelOf  单元 → 人话标识
   * @param runOne   (worker, unit) => 'done' | 'failed' | 'stop'
   * @param paceMult 单元之间的限速倍率(链接更轻: 0.5; 店铺/品牌: 1)
   * @returns {number} 本次真正跑掉的单元数
   */
  const runUnits = async (label, units, labelOf, runOne, paceMult) => {
    let next = 0, handled = 0;
    await Promise.all(pool.workers.map(async (w) => {
      for (;;) {
        if (pool.abortedNow()) return;
        const i = next++;
        if (i >= units.length) return;
        const u = units[i];
        const lab = label + ' ' + labelOf(u);
        if (!(await ensureWorkerUnit(w, lab))) return;                 // 探活失败 → 本 worker 收工
        const navBefore = w.navCount;
        const t1 = Date.now();
        wlog(w, '▶ ' + lab + ' 开始');
        let r = 'failed';
        try { r = await runOne(w, u) }
        catch (e) { P.log && P.log('[多链接采集] 单元异常收尾 ' + lab + ': ' + ((e && e.message) || e)) }
        handled++;
        wlog(w, (r === 'done' ? '✔' : r === 'stop' ? '⏸' : '✘') + ' ' + lab + ' 结束 ' + ((Date.now() - t1) / 1000).toFixed(1) + 's');
        if (r === 'stop') return;
        if (!(await afterWorkerUnit(w, lab, navBefore))) return;      // 中招验证码 → 已全局暂停
        if (pool.abortedNow()) return;
        await pace(w.P, paceMult);                                    // ★ 单 worker 单元之间限速(不变)
      }
    }));
    return handled;
  };

  /** 阶段 1 单元: 一条链接 → 卖家(店铺链接直接登记; 商品链接读插件面板 + 跟卖卖家) */
  const runOneLink = async (w, Lk) => {
    const cls = P.classifySellerLink(Lk.url);
    const site = siteOf(cls);
    Lk.kind = cls.kind; Lk.sellerId = cls.shopId || null; Lk.asin = cls.asin || null; Lk.site = site;
    P.bumpCollectProgress && P.bumpCollectProgress({ step: '链接 ' + (Lk.kind || '?') + ' ' + (cls.shopId || cls.asin || ''), links: job.links.length, round: job.round });

    const out = await withRetry(w.P, '链接 ' + String(Lk.url).slice(0, 60), async () => {
      if (cls.kind === 'shop' || cls.kind === 'seller') {
        if (!cls.shopId) return { ok: false, err: '店铺链接里没解析出卖家ID' };
        L.upsertSeller(job, { sellerId: cls.shopId, site, shopLink: cls.url, via: '用户给的店铺链接' });
        return { ok: true };
      }
      if (cls.kind === 'product') {
        const pr = await readProductPanel(w.sess, cls.asin, site, w.P);
        if (!pr.ok) return { ok: false, err: pr.err, captcha: /验证|robot|captcha/i.test(String(pr.err || '')) };
        const fs2 = await readFollowSellers(w.sess, w.P);
        for (const s of fs2.sellers) {
          if (!s.sellerId) continue;
          L.upsertSeller(job, { sellerId: s.sellerId, name: s.name, site, shopLink: s.shopLink, via: '商品页→跟卖卖家', asin: cls.asin, price: s.price, fulfill: s.fulfill });
        }
        return { ok: true, followSellerCount: fs2.sellers.length, product: { brand: pr.fields.brand, seller: pr.fields.seller, fulfill: pr.fields.fulfill, sales30d: pr.fields.sales30d } };
      }
      return { ok: false, err: '无法识别的链接（既不是店铺/卖家链接, 也没有 ASIN）' };
    });

    // ★ 验证码 = 全局熔断(要求 4): 不再当成"这条链接失败"就继续往下跑
    if (out.captcha) { pauseFor('captcha', '链接 ' + L.shortLink(Lk.url), null); return 'stop'; }
    if (out.stopped) { pool.abort('stopped'); return 'stop'; }
    if (out.ok) { L.mark(job, 'link', 'done', { url: Lk.url, err: null, product: out.product || null, followSellerCount: out.followSellerCount || 0 }, out.attempts || 1); }
    else {
      L.mark(job, 'link', 'failed', { url: Lk.url, err: out.err || '失败' }, out.attempts || 1);
      report.errors.push({ stage: '链接', url: Lk.url, err: out.err || '失败' });
      L.addLog(job, '链接失败: ' + String(Lk.url).slice(0, 80) + ' — ' + (out.err || '失败'));
    }
    ck('link');                                         // ★ 每处理完一条链接就落盘
    return out.ok ? 'done' : 'failed';
  };

  /** 排名闸门统计累加(店铺/品牌阶段各自返回, 这里汇总进报告) */
  const addGateStat = (g) => { if (!g) return; report.rankGate.candidates += g.candidates || 0; report.rankGate.tried += g.tried || 0; report.rankGate.got += g.got || 0; report.rankGate.still += g.still || 0; };
  // ★ 插件未登录: 汇总(店铺/品牌阶段各自统计) → report.pluginLogin → 报告与提示
  const addLoginStat = (w) => {
    if (!w || !w.notLogged) return;
    report.pluginLogin.cards += w.cards || 0;
    report.pluginLogin.notLogged += w.notLogged || 0;
    report.pluginLogin.pages += w.pages || 0;
  };

  /** 阶段 2 单元: 一个店铺 → 店铺商品(入库 + 顺手登记品牌, 供阶段 3 用) */
  const runOneShop = async (w, s, ensureAddr) => {
    const site = s.site || 'de';
    P.bumpCollectProgress && P.bumpCollectProgress({ step: '店铺 ' + (s.name || s.sellerId), shopsDone: job.sellers.filter((x) => x.status === 'done').length, shopsTotal: job.sellers.length });

    const out = await withRetry(w.P, '店铺 ' + s.sellerId, async () => {
      if (typeof P.ensureDeliveryAddress === 'function') await ensureAddr(w, site);   // 每站点只校准一次(并行共用同一个 promise)
      const got = await gotoShop(w.sess, s.sellerId, site, w.P, s.shopLink || s.shopUrl || null);
      if (!got.ok) return { ok: false, err: got.err };
      const d = await collectShopProducts(w.sess, s.sellerId, site, w.P);
      if (!d.ok) return { ok: false, err: '店铺页没读到商品' };
      const kept = [];
      for (const pr of d.products) {
        const item = Object.assign({ site, source: 'shop-links' }, pr);
        if (!pass(item)) continue;
        kept.push(item);
      }
      let added = 0, addedAsins = [];
      if (typeof P.ingestShopProducts === 'function') {
        const r = P.ingestShopProducts(kept, site, 'shop-links');
        added = Number(r && r.added != null ? r.added : r) || 0;
        addedAsins = (r && Array.isArray(r.addedAsins)) ? r.addedAsins : [];
      }
      return { ok: true, landingUrl: got.landingUrl, total: d.total, pages: d.pages, collected: d.products.length, kept, skipped: d.products.length - kept.length, added, addedAsins, rankGate: d.rankGate, loginWarn: d.loginWarn };
    });

    if (out.captcha) { pauseFor('captcha', '店铺 ' + s.sellerId, null); return 'stop'; }
    if (out.stopped) { pool.abort('stopped'); return 'stop'; }
    if (out.ok) {
      L.mark(job, 'shop', 'done', {
        sellerId: s.sellerId, err: null, landingUrl: out.landingUrl || null,
        collected: out.collected || 0, kept: (out.kept || []).length, added: out.added || 0,
        addedAsins: out.addedAsins || [], skipped: out.skipped || 0,
      }, out.attempts || 1);
      report.shopProducts.push(...(out.kept || []));
      addGateStat(out.rankGate);                          // ★ 排名闸门: 店铺阶段统计汇总到整轮
      addLoginStat(out.loginWarn);                        // ★ 插件未登录: 店铺阶段汇总(只提示, 不停采集)
      L.addLog(job, '✔ 店铺 ' + (s.name || s.sellerId) + ': 商品 ' + (out.collected || 0) + ' → 通过 ' + ((out.kept || []).length) + ' → 入库 ' + (out.added || 0)
        + (out.rankGate && out.rankGate.got ? ' (详情页补排名 ' + out.rankGate.got + ')' : ''));
      // ★ 店铺一采完就把品牌登记进任务 —— 续跑时阶段 2 全部命中 done 被跳过,
      //   report.shopProducts 会是空的, 老代码"从本轮店铺商品里去重出品牌"会得到 0 个品牌,
      //   任务永远跑不完(坑 26)。
      if (P.collectBrands) {
        for (const pr of (out.kept || [])) {
          if (!pr.brand || !pr.brandLink) continue;
          const b = L.upsertBrand(job, { brand: pr.brand, brandLink: pr.brandLink, site, fromAsin: pr.asin });
          if (b) b.shopCount = (b.shopCount || 0) + 1;
        }
      }
    } else {
      L.mark(job, 'shop', 'failed', { sellerId: s.sellerId, err: out.err || '失败' }, out.attempts || 1);
      report.errors.push({ stage: '店铺', sellerId: s.sellerId, err: out.err || '失败' });
      L.addLog(job, '店铺失败 ' + s.sellerId + ': ' + (out.err || '失败'));
    }
    ck('shop');                                         // ★ 每个店铺采完就落盘
    return out.ok ? 'done' : 'failed';
  };

  /** 阶段 3 单元: 一个品牌 → 品牌商品 */
  const runOneBrand = async (w, b) => {
    P.bumpCollectProgress && P.bumpCollectProgress({ step: '品牌 ' + b.brand, brandsDone: job.brands.filter((x) => x.status === 'done').length, brandsTotal: job.brands.length });

    const out = await withRetry(w.P, '品牌 ' + b.brand, async () => {
      const d = await collectBrandProducts(w.sess, b.brand, b.brandLink, b.site || 'de', w.P);
      const kept = d.products.filter((pr) => pass(Object.assign({ site: b.site, source: 'brand-links' }, pr)));
      const rows = kept.map((pr) => Object.assign(pr, { sourceBrand: b.brand, site: b.site }));
      let added = 0, addedAsins = [];
      if (rows.length && typeof P.ingestShopProducts === 'function') {
        const r = P.ingestShopProducts(rows, b.site || 'de', 'brand-links');
        added = Number(r && r.added != null ? r.added : r) || 0;
        addedAsins = (r && Array.isArray(r.addedAsins)) ? r.addedAsins : [];
      }
      return { ok: true, collected: d.products.length, mixed: d.mixed || 0, mixedItems: d.mixedItems || [], rows, added, addedAsins, rankGate: d.rankGate, loginWarn: d.loginWarn };
    });

    if (out.captcha) { pauseFor('captcha', '品牌 ' + b.brand, null); return 'stop'; }
    if (out.stopped) { pool.abort('stopped'); return 'stop'; }
    if (out.ok) {
      L.mark(job, 'brand', 'done', { brand: b.brand, err: null, collected: out.collected || 0, mixed: out.mixed || 0, added: out.added || 0, addedAsins: out.addedAsins || [] }, out.attempts || 1);
      report.brandProducts.push(...(out.rows || []));
      // ★ 剔除他牌: 明细进报告(带直达链接), 让「采集报告」里能逐条点开核对为什么被剔除。
      //   总量再设一道上限(MIXED_TOTAL_MAX), 避免品牌很多时报告文件过大; 计数始终是完整的。
      if (out.mixed || (out.mixedItems || []).length) {
        const room = Math.max(0, MIXED_TOTAL_MAX - report.mixedByBrand.reduce((n, g) => n + g.items.length, 0));
        report.mixedByBrand.push({
          brand: b.brand, site: b.site || null, target: b.brand,
          count: out.mixed || 0,
          items: (out.mixedItems || []).slice(0, room),
        });
      }
      addGateStat(out.rankGate);                          // ★ 排名闸门: 品牌阶段统计汇总
      addLoginStat(out.loginWarn);                        // ★ 插件未登录: 品牌阶段汇总(只提示, 不停采集)
      L.addLog(job, '✔ 品牌 ' + b.brand + ': 同品牌 ' + (out.collected || 0) + ' 个 (混入他牌 ' + (out.mixed || 0) + ') → 入库 ' + (out.added || 0)
        + (out.rankGate && out.rankGate.got ? ' (详情页补排名 ' + out.rankGate.got + ')' : ''));
    } else {
      L.mark(job, 'brand', 'failed', { brand: b.brand, err: out.err || '失败' }, out.attempts || 1);
      report.errors.push({ stage: '品牌', brand: b.brand, err: out.err || '失败' });
      L.addLog(job, '品牌失败 ' + b.brand + ': ' + (out.err || '失败'));
    }
    ck('brand');                                        // ★ 每个品牌采完就落盘
    return out.ok ? 'done' : 'failed';
  };

  try {
    // ── 阶段 1: 链接 → 卖家(按批推进; 批内 pool.size 个 worker 并行) ─────────
    const full = L.buildBatches(job);
    const batches = full && full.length ? full : job.batches;
    for (let bi = 0; bi < batches.length; bi++) {
      const batch = batches[bi];
      if (pool.abortedNow()) break;
      if (batch.status === 'done') continue;                 // 续跑: 已完成的批直接跳过
      batch.status = 'running';
      if (!batch.startedAt) batch.startedAt = new Date().toISOString();
      job.round = batch.index;
      const slice = job.links.slice(batch.from - 1, batch.to);
      // ★ 断点续跑的核心过滤: 只把还没做完的链接交给 worker(已完成的一条都不导航)
      const todo = slice.filter((l) => l.status !== 'done' && l.status !== 'skipped');
      if (todo.length) {
        P.log && P.log('[多链接采集] 批 ' + batch.index + '/' + batches.length + ': 待跑 ' + todo.length + ' 条链接, 并行 ' + pool.size + ' 个标签页');
        await runUnits('链接', todo, (Lk) => String(Lk.url).slice(0, 60), runOneLink, 0.5);
      }
      if (batch.status === 'running') { batch.status = 'done'; batch.finishedAt = new Date().toISOString(); }
      ck('batch');                                           // ★ 每批结束强制落盘 + 刷进度
      if (job.status === 'paused' || pool.abortedNow()) break;
      // ★ 批间隔(要求 6): 跟卖并行族就是"每批跑完留 3s"(见 cdpFollowShopBatchParallel 注释
      //   "并行数量控制: 每批之间留间隔, 避免触发风控")。并行 worker 已经把瞬时请求抬高了
      //   N 倍, 这个间隔必须补回来 —— 不要为了快把它去掉。
      const moreBatches = batches.slice(bi + 1).some((b) => b.status !== 'done');
      if (moreBatches) {
        const gapMs = 2000 + Math.round(Math.random() * 1000);
        P.log && P.log('[多链接采集] 批间隔 ' + gapMs + 'ms (避免触发风控)');
        await sleep(gapMs);
      }
    }

    // ── 阶段 2: 店铺(并行; done/skipped 零导航跳过) ──────────────────────
    if (!pool.abortedNow()) {
      const all = job.sellers;
      const limited = P.maxShops > 0 ? all.slice(0, P.maxShops) : all;
      if (P.maxShops > 0) for (const s of all.slice(P.maxShops)) {
        if (s.status === 'pending') { s.status = 'skipped'; s.err = '超过 maxShops 上限, 本轮不采'; }
      }
      // 配送地址校准: 每个站点只需一次(坑 #3); 并行时用同一个 promise 去重,
      // 避免 N 个 worker 同时去改地址(那既浪费又容易互相打断)。
      const addrProm = new Map();
      const ensureAddr = (w, site) => {
        if (!addrProm.has(site)) {
          addrProm.set(site, Promise.resolve().then(() => P.ensureDeliveryAddress(w.sess, site, P.zip)).catch(() => null));
        }
        return addrProm.get(site);
      };
      const todoShops = limited.filter((s) => s.status !== 'done' && s.status !== 'skipped');
      if (todoShops.length) P.log && P.log('[多链接采集] 阶段 2: 待采店铺 ' + todoShops.length + ' 个, 并行 ' + pool.size + ' 个标签页');
      await runUnits('店铺', todoShops, (s) => s.sellerId, (w, s) => runOneShop(w, s, ensureAddr), 1);
    }

    // ── 阶段 3: 品牌(并行; 品牌清单在阶段 2 里登记完毕才会开跑) ────────────
    if (!pool.abortedNow() && P.collectBrands) {
      const todoBrands = job.brands.filter((b) => b.status !== 'done' && b.status !== 'skipped');
      if (todoBrands.length) P.log && P.log('[多链接采集] 阶段 3: 待采品牌 ' + todoBrands.length + ' 个, 并行 ' + pool.size + ' 个标签页');
      await runUnits('品牌', todoBrands, (b) => b.brand, runOneBrand, 1);
    }
  } finally {
    await pool.close();                                      // 收尾: 关掉本模块建的会话/标签页
  }

  // ── 收尾判定 ──────────────────────────────────────────────────────────
  // 关掉品牌采集时, 阶段 2 登记的品牌本轮不采 → 标 skipped,
  // 否则这些品牌永远停在 pending, 任务被误判成「没跑完」(坑 27)
  if (!P.collectBrands) for (const b of job.brands) if (b.status === 'pending') { b.status = 'skipped'; b.err = '未开启品牌采集' }
  // 阶段 1 没跑到的链接(比如中途暂停): 保持 pending, remaining() 能报出来
  const rem = L.remaining(job);
  const anyStop = stopped();
  const hasWork = rem.links > 0 || rem.sellers > 0 || rem.brands > 0;
  let finalStatus;
  if (job.status === 'paused') finalStatus = 'paused';
  else if (anyStop) finalStatus = 'stopped';
  else if (hasWork) finalStatus = 'partial';
  else finalStatus = 'done';
  L.finalize(job, { status: finalStatus, elapsedSec: Math.round((Date.now() - t0) / 1000) });
  if (job.status === 'paused') { job.pauseReason = job.pauseReason || 'error'; }   // 收尾时兜个原因, 前端好提示
  await ckDone();                                            // 排空: 让排队的单元级落盘先写完
  ck('finish');                                              // ★ 收尾强制落盘

  report.finishedAt = new Date().toISOString();
  report.elapsedSec = Math.round((Date.now() - t0) / 1000);
  report.shopProductCount = report.shopProducts.length;  report.brandProductCount = report.brandProducts.length;
  // ★ 排名闸门效果(缺排名 → 进详情页补到几个): 报告/通知里直接可见
  // (排名闸门统计已在采集过程中累加进 report.rankGate —— 见 addGateStat)
  { const withRank = (arr) => (arr || []).filter((x) => x.bsrShop || x.bsrCat || (Array.isArray(x.bsr) && x.bsr.length)).length;
    report.rankStats = {
      shopWithRank: withRank(report.shopProducts), shopTotal: report.shopProducts.length,
      brandWithRank: withRank(report.brandProducts), brandTotal: report.brandProducts.length,
      fromDetail: (report.shopProducts.concat(report.brandProducts)).filter((x) => x.rankFromDetail).length,
    }; }
  // ★ 插件未登录: 只提示, 不停采集(不影响任何阶段流转/状态判定)
  if (report.pluginLogin.notLogged > 0) {
    L.addLog(job, '⚠ 插件未登录: ' + report.pluginLogin.notLogged + '/' + report.pluginLogin.cards
      + ' 张卡缺少 卖家/品牌/排名 等字段 (涉及 ' + report.pluginLogin.pages + ' 个列表页) —— 请到采集浏览器里登录「智赢」插件; 采集已继续完成, 未中断');
  }
  report.steps.links = job.links.map((x) => ({ url: x.url, kind: x.kind, ok: x.status === 'done', err: x.err, sellerId: x.sellerId, asin: x.asin }));
  report.steps.sellers = { count: job.sellers.length, list: job.sellers };
  report.steps.shops = job.sellers;
  report.steps.brands = { unique: job.brands.length, list: job.brands };
  report.steps.totalAdded = job.totals.added || 0;
  report.steps.brandAdded = job.totals.brandAdded || 0;
  report.jobSummary = L.summary(job);
  report.remaining = rem;
  report.totals = job.totals;
  report.status = job.status;
  report.pauseReason = job.pauseReason || null;
  await ckDone();                                            // 排空: 保证 finish 的 force 落盘已完成(调用方马上要读任务文件)
  return report;
}
module.exports = {
  collectByLinks,
  // 直接按"品牌链接"采品牌商品 —— 供「批量品牌采集」复用:
  // 有品牌链接时跳过"找线索商品 → 打开详情页 → 读品牌跳转链接"这三步, 直接采
  collectBrandProducts,
  attachPage,
  openSession,
  evalExpr,
  // 便于单测
  parsePanelText,
  SITE_MARKETPLACE,
  EXPR_READ_SHOP,
  EXPR_DETAIL_RANKS,
  READ_RANKS_FN,
  READ_FLAGS_FN,              // ★ 卖家国家(国旗图标)读取片段 —— 采集表达式里插值用
  isChinaRegionCode,          // ★ 大中华区代码判定(CN/HK/TW/MO)
  classifyRanks,
  rankCatOf,
  EXPR_READ_AOD,
  // 假 CDP 离线测试台按表达式做精确路由, 这些常量必须导出(否则只能靠子串猜)
  EXPR_PAGE_HEALTH,
  EXPR_PAGE_ASIN,
  EXPR_DETAIL_PANEL,
  EXPR_FIND_SELLER_BTN,
  EXPR_SCROLL_AOD,
  EXPR_FIND_STORE_ENTRY,
  // 编排基础设施(便于单测与复用)
  withRetry, pace, wait, createKeeper,
  // 并行改造: 单元间隔上限(批间隔)与并行度上限, 便于测试/文档引用
  MAX_CONCURRENCY: 6, BATCH_GAP_MIN_MS: 2000, BATCH_GAP_MAX_MS: 3000,
};

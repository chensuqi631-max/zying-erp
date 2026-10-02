// 智赢ERP · 搞薯条 (采集 + 商品管理) — 持久 dsh.client bundle
// 由 _build-persistent.js 从 zywb-client-combined.txt 生成; 手动改动请改源再生成
//
// ⚠️ 模块 id 必须能被 DSH 的加载器找到。加载器按【包名】注册/查找模块
// （官方插件同样如此，例如 id: "@deepseek-ai/dsh-client-hmr"），
// 名字对不上就会报：加载时未通过 __ModuleLoader__.load 注册 "<包名>"。
var __mod = { exports: {}, ready: false };
window.__ModuleLoader__.load({
	id: "zying-erp",
	factory: (require) => {
		Object.defineProperty(__mod.exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		react = react && react.__esModule && react.default ? react.default : react;
		const React = react;
		const styles = {
			insert(css) {
				try {
					if (typeof document === "undefined") return;
					let el = document.querySelector("style[data-zying-gaoshu]");
					if (!el) {
						el = document.createElement("style");
						el.setAttribute("data-zying-gaoshu", "1");
						document.head.appendChild(el);
					}
					el.textContent += String(css || "");
				} catch (e) {}
			}
		};
		const host = {
			async call(method, args) {
				const a = args || {};
				try {
					const opt = { method: a.method || (a.body !== undefined && a.body !== null ? "POST" : "GET"), headers: { "Content-Type": "text/plain;charset=UTF-8" } };
					if (a.body !== undefined && a.body !== null && opt.method !== "GET") opt.body = typeof a.body === "string" ? a.body : JSON.stringify(a.body);
					const r = await fetch("http://127.0.0.1:3088" + a.path, opt);
					const t = await r.text();
					let json = null, jsonError = null;
					try { json = t ? JSON.parse(t) : null; } catch (e) { jsonError = String(e && e.message || e); }
					return { ok: r.ok, status: r.status, json, text: t, jsonError };
				} catch (e) {
					return { ok: false, error: String(e && e.message || e) };
				}
			}
		};
		const __plugin = (() => {
const h = React.createElement;
function fmtNum(n) { return n == null ? '-' : Number(n).toLocaleString(); }
const SITE_GROUPS = [
  { region: '欧洲', sites: [['de','🇩🇪德国'],['uk','🇬🇧英国'],['fr','🇫🇷法国'],['it','🇮🇹意大利'],['es','🇪🇸西班牙'],['nl','🇳🇱荷兰'],['se','🇸🇪瑞典'],['pl','🇵🇱波兰']] },
  { region: '美洲', sites: [['us','🇺🇸美国'],['ca','🇨🇦加拿大'],['mx','🇲🇽墨西哥'],['br','🇧🇷巴西']] },
  { region: '亚太', sites: [['jp','🇯🇵日本'],['au','🇦🇺澳大利亚'],['in','🇮🇳印度'],['sg','🇸🇬新加坡']] },
  { region: '中东', sites: [['ae','🇦🇪阿联酋'],['sa','🇸🇦沙特']] }
];
const ALL_SITES = [].concat(...SITE_GROUPS.map(function (g) { return g.sites.map(function (s) { return s[0]; }); }));
const SITE_SHORT = { de: '德', uk: '英', us: '美', fr: '法', it: '意', es: '西', nl: '荷', se: '瑞典', pl: '波兰', jp: '日', ca: '加', mx: '墨', br: '巴西', au: '澳', in: '印度', sg: '新', ae: '阿联酋', sa: '沙特' };
const CATEGORY_TREE = [
  { v: 'Electronics', l: '电子', children: [['Cell Phones & Accessories','手机及配件'],['Computers & Accessories','电脑及配件'],['TV','电视影音'],['Camera & Photo','相机摄影'],['Headphones','耳机音响'],['Wearable Technology','智能穿戴'],['Video Games','游戏主机']] },
  { v: 'Automotive', l: '汽车', children: [['Automotive Parts','汽车配件'],['Car Electronics','车载电子'],['Car Care','汽车护理'],['Tires & Wheels','轮胎轮毂'],['Motorcycle','摩托车配件']] },
  { v: 'Home & Kitchen', l: '家居厨房', children: [['Kitchen','厨房用品'],['Storage & Organization','收纳整理'],['Furniture','家具'],['Cleaning','清洁用品'],['Bedding','床上用品'],['Home Décor','家居装饰']] },
  { v: 'Toys & Games', l: '玩具游戏', children: [['Toys','儿童玩具'],['Board Games','桌游卡牌'],['Action Figures','模型手办'],['Outdoor Toys','户外玩具'],['Puzzles','拼图积木']] },
  { v: 'Sports & Outdoors', l: '运动户外', children: [['Fitness','健身器材'],['Camping & Hiking','露营野餐'],['Cycling','骑行装备'],['Water Sports','水上运动'],['Sports & Outdoors','户外运动']] },
  { v: 'Garden', l: '花园', children: [['Garden Tools','园艺工具'],['Lawn Care','草坪护理'],['Patio','户外装饰'],['Plants','植物盆栽']] },
  { v: 'Beauty', l: '美妆个护', children: [['Skin Care','护肤'],['Makeup','彩妆'],['Hair Care','美发'],['Fragrance','香水'],['Personal Care','个人护理']] },
  { v: 'Clothing', l: '服装鞋靴', children: [['Men','男装'],['Women','女装'],['Kids','童装'],['Shoes','鞋靴'],['Accessories','服饰配件']] },
  { v: 'Tools', l: '工具五金', children: [['Hand Tools','手动工具'],['Power Tools','电动工具'],['Hardware','五金配件'],['Safety','安全防护']] },
  { v: 'Office Products', l: '办公用品', children: [['Office Supplies','办公文具'],['Ink & Toner','打印耗材'],['Office Furniture','办公家具']] },
  { v: 'Pet Supplies', l: '宠物用品', children: [['Dog Supplies','狗狗用品'],['Cat Supplies','猫咪用品'],['Pet Food','宠物食品']] }
];
// ★ 2026-09 二级类目中文显示名: 复用采集面板那张中文类目树的标签(覆盖常见值), 查不到的显示原名。
//   为什么这里敢查不到就显原名: 服务端面板给的"榜单选品"类目名是多语言细类目(3,273 个取值),
//   不可能全译; 但大类目(cat1)已由服务端 catCnOf 归并成中文, 所以一级 chips 能保证全中文。
const CAT_CN_CHILD = (function () {
  const m = {};
  CATEGORY_TREE.forEach(function (c) { (c.children || []).forEach(function (ch) { if (ch && ch[0]) m[String(ch[0]).toLowerCase()] = ch[1]; }); });
  return m;
})();
const cnOfChild = function (name) { return CAT_CN_CHILD[String(name || '').toLowerCase()] || name; };
const BADGE_SUGGEST = ['aplus','choice','bestseller','bestseller1','newrelease','deal','dealday','overallpick','editorspick','toprated','climate','smallbusiness'];
const Q_SUGGEST = ['anker','usb','phone','case','holder','adapter','charger','cable','watch','gaming'];
const BRAND_SUGGEST = ['Anker','Samsung','Apple','Xiaomi','Sony','Philips','Bosch','Logitech','! 排除所有品牌店链接'];
const TM_COUNTRY_SUGGEST = ['欧盟','英国','美国','德国','日本','中国','法国','意大利','西班牙','马德里'];
const MODES = [
  /* ★ 2026-09-27: 面板原来只有 类目/批量跟卖/品牌/多链接 四种; 当天先补了「列表页直采」「列表页筛选采集」
   *   「商品跟卖采集」三张卡, 随后用户要求【把两张列表页卡片从面板撤掉】——
   *   所以现在面板 5 种, 「列表页直采 / 列表页筛选采集」只保留在底层:
   *     · 后端路由  /api/collect/list-direct · /api/collect/list-filtered (照旧可用, 一行没删)
   *     · DSH 工具  zying_list_direct · zying_list_filtered
   *     · 网页端工作台(/工作台对话)与插件单页直采那条链路也还在用
   *   以后要放回面板: 把下面被删的两条 MODES 定义贴回来即可(doCollect 里针对这两个 mode 的
   *   校验/布尔转换/站点剔除逻辑【故意保留】, 就是为这一步留的)。 */
  { mode: 'category', icon: '🔎', name: '类目搜索采集', desc: '选一级/二级类目浏览 或 关键词搜索, 抓取结果商品', path: '/api/collect/category', fields: [
    { f: 'keyword', label: '自定义关键词 (可选: 选类目后可不填; 未选类目则必填)', ph: '如: car phone holder' },
    { f: 'category', label: '类目 (通过上方一级/二级选择)', ph: '如: Automotive' },
    { f: 'maxPages', label: '翻页数 (每页约16个商品)', type: 'number', def: '2' }
  ], hint: '类目与关键词至少选一: 已选类目时关键词可留空; 一个类目都不选则必须填关键词 · 全程CDP无API · 过滤条件不满足的商品直接跳过, 不入库' },
  { mode: 'followaod', icon: '🏪', name: '商品跟卖采集 (全部卖家店铺)', desc: '给商品链接/ASIN → aod 实时提取全部跟卖卖家 → 并行进各卖家店铺采商品', path: '/api/collect/follow-shop-aod', fields: [
    { f: 'urls', label: '商品 (ASIN / 商品链接 / aod 报价链接, 每行一个)', ph: '如:\nhttps://www.amazon.co.uk/dp/B0D8XSNPP3\nB0CCD88N2Y' },
    { f: 'maxItems', label: '每店铺商品数上限 (1-50, 0=不限)', type: 'number', def: '10' },
    { f: 'maxPages', label: '每店铺翻页数 (1-10, 0=不限)', type: 'number', def: '2' },
    { f: 'concurrency', label: '并行网页数 (1-6)', type: 'number', def: '4' },
    { f: 'excludeSellers', label: '排除卖家 (名称/ID, 逗号分隔)', ph: '如: jianjun, A21HVBR9S9KTYG' },
    { f: 'zip', label: '配送邮编 (可选, 留空用站点默认)', ph: '如 SW1A1AA (英国) / 1000 (德国)' }
  ], hint: '链路: 商品 aod → 列出该商品【全部】跟卖卖家 → 每个卖家店铺并行采商品并入库 · 上方「采集筛选」照常生效, 不通过的商品直接跳过(不进店铺商品库) · 一个店铺一张独立标签页, 所以耗时较长: 提交后进度见上方进度条, 随时可「⏹ 停止」(已采数据保留入库) · 只跟一个卖家店铺时用「🔄 批量跟卖店铺采集」更省事' },
  { mode: 'batch', icon: '🔄', name: '批量跟卖店铺采集', desc: '遍历已入库商品的跟卖卖家, 逐个跳转店铺采集', path: '/api/collect/follow-shop-batch', fields: [
    { f: 'asins', label: '商品 (ASIN 或 amazon 链接, 逗号分隔)', ph: '如: B0CCD88N2Y,B0H11NJ91L' },
    { f: 'excludeSellers', label: '排除卖家 (名称/ID, 逗号分隔)', ph: '如: jianjun' },
    { f: 'amazonWords', label: '排除亚马逊词汇', def: 'amazon,亚马逊' },
    { f: 'rounds', label: '循环轮次 (0=无限; 1-30=固定轮数)', type: 'number', def: '1' },
    { f: 'concurrency', label: '并行网页数 (1-6)', type: 'number', def: '4' },
    { f: 'maxItems', label: '每店铺商品数上限 (0=无限制)', type: 'number', def: '10' },
    { f: 'maxPages', label: '每店铺翻页数上限 (0=无限制)', type: 'number', def: '2' }
  ], hint: '遍历跟卖卖家店铺采集, 支持循环轮次' },
  { mode: 'brand-batch', icon: '🏷️', name: '批量品牌采集', desc: '取商品库商品的品牌 → 跳转品牌页 → 抓该品牌商品, 适用采集筛选', path: '/api/collect/brand-batch', fields: [
    /* ★ 2026-10-02 新增站点字段: 后端原来只有 `j.site || 'au'`, 而表单里没有 site →
     *   界面上用「批量品牌采集」永远按【澳洲站】找线索品牌, 采美国/德国站必定报
     *   "站点 au 的商品库里没有这些品牌的商品"。现在显式可填, 留空则跟随过滤面板勾的站点。 */
    { f: 'site', label: '站点 (必填! 线索品牌必须属于该站点)', def: 'de', ph: 'de / uk / us / fr / it / es / au / jp / ca … (留空则用过滤面板勾的站点)' },
    { f: 'brandsLimit', label: '自动挑品牌数 (从商品库品牌去重, 按商品数从多到少)', type: 'number', def: '2' },
    { f: 'brands', label: '指定品牌 (可选, 逗号分隔; 填了就只采这些品牌)', ph: '如: Lamicall,UGREEN (留空 = 从商品库自动挑)' },
    { f: 'maxPerBrand', label: '每品牌入库数量上限', type: 'number', def: '5' },
    { f: 'maxPages', label: '每品牌翻页数 (每页约16个商品)', type: 'number', def: '2' },
    { f: 'panel', label: '插件面板补全 商标/月销/尺寸 (填 1 开启 · 慢: 每商品约 +8 秒)', ph: '留空 = 关闭; 过滤条件用到 商标/月销 时自动开启' }
  ], hint: '品牌线索来自商品库: 每个品牌取 1 个代表商品 → 打开它的详情页读「品牌跳转链接」→ 跳品牌页抓商品 (不是跟卖卖家店铺) · 每个候选商品读完整详情页 (主图/价格/评分/评论/A+/配送/自营/类目层级/币种) · 下方统一过滤面板 = 采集筛选, 不通过的直接跳过不入库 · 品牌页混入的他牌商品按品牌名比对丢弃' },
  { mode: 'shoplinks', icon: '🔗', name: '多链接采集', desc: '给多条链接 → 采跟卖商家的店铺商品 + 这些商品去重后的品牌商品', path: '/api/collect/shop-links', fields: [
    { f: 'urls', label: '链接 (每行一条, 只跳这些链接)', ph: '店铺列表页: https://www.amazon.co.uk/s?me=A21HVBR9S9KTYG&marketplaceID=A1F83G8C2ARO7P\n卖家主页:   https://www.amazon.co.uk/sp?ie=UTF8&seller=A3KDD2QGUB03SO\n商品详情页: https://www.amazon.co.uk/dp/B0DJ84VHQX' },
    { f: 'shopPages', label: '跟卖店铺商品页数 (每页约 16 个)', type: 'number', def: '1' },
    { f: 'brandPages', label: '品牌商品页数 (每页约 48 个)', type: 'number', def: '1' },
    { f: 'maxShops', label: '最多进几个店铺 (0=不限, 只有商品页链接才会用到)', type: 'number', def: '0' },
    { f: 'maxItems', label: '每店铺 / 每品牌商品数上限 (0=无限制)', type: 'number', def: '0' },
    { f: 'collectBrands', label: '是否采品牌商品 (1=采, 0=只采店铺)', def: '1' },
    { f: 'concurrency', label: '并行网页数 (1-6, 默认 4; 阶段1/2/3 都并行, 每个 worker 一张独立标签页)', type: 'number', def: '4' },
    { f: 'batchSize', label: '每批链接数 (大批量用: 每批结束强制存盘, 默认 20)', type: 'number', def: '20' },
    { f: 'retry', label: '失败重试次数 (单个链接/店铺/品牌失败后自动重试, 默认 2)', type: 'number', def: '2' },
    { f: 'delayMs', label: '限速: 每个单元之间等待毫秒 (默认 1500; 5000=更稳更慢)', type: 'number', def: '1500' },
    /* ★ 2026-10-01 修: rankGate 默认值从 '1' 改成 '0'。
     * 背景: 后端 2026-09「统一不跳转」改造已把排名闸门默认改成【关】(见 server.js 里
     *   "★ 2026-09 改造(统一不跳转): 默认改为【关】……排名改为由「补采」按需补齐")，
     *   但前端这个字段一直 def='1'，而 onSubmit 会把【所有字段(含默认值)】原样提交
     *   (见下方 out[fd.f] = fval(fd)) → 后端收到 rankGate='1'，新默认从未生效。
     * 后果: 多链接采集每遇到一个列表页读不到排名的商品，就 Page.navigate 进 /dp/ASIN
     *   等 12~20 秒；rankGateLimit 默认 '0' 又是【不限】→ 每个都跳、不封顶，
     *   阶段1(跟卖店铺商品) 和 阶段3(品牌商品) 各来一遍。
     *   表现就是"我明明选了多链接采集，却在疯狂开商品详情页"。
     * 现在默认关(= 后端设计的口径)；确实想要排名时把这里填 1，或用商品管理页的
     *   「勾选后补采」(按需、只看你选的那几个)。 */
    { f: 'rankGate', label: '缺排名时进详情页补 (1=补 / 0=不补 · 默认不补, 改由商品管理「补采」按需补)', def: '0' },
    { f: 'rankGateLimit', label: '每页最多补几个 (0=全部; 每个约 12~15 秒, 设 3~8 可兼顾速度)', type: 'number', def: '0' },
    { f: 'waitScale', label: '页面等待倍率 (1=默认; 网络慢调 1.5; 调试可 0.3)', def: '1' },
    { f: 'jobId', label: '断点续跑 (可选): 填 last = 继续最近未跑完的任务, 或填具体任务号', ph: '一般不用手填 —— 用下方「🔗 多链接采集任务」卡片上的「继续上次任务 / 重跑失败」按钮' },
    { f: 'zip', label: '配送邮编 (可选, 留空用该站点默认)', ph: '如 2000 (澳洲) / SW1A1AA (英国) / 10001 (美国)' }
  ], hint: '三种链接都认: 店铺列表页 /s?me=XXXX · 卖家主页 /sp?seller=XXXX (自动规范化) · 商品页 /dp/ASIN (取其跟卖卖家 → 逐个进卖家店铺) · 【一次最多 100 条】按「每批链接数」分片执行, 每完成一条链接/一个店铺/一个品牌都会落盘(data/link-jobs/job-*.json) · 中断/崩溃/断电后点下方「⏯ 继续上次任务」接着跑, 已完成的单元零导航跳过、不重复入库 · 失败的单元可「↻ 重跑失败」 · 单单元失败会自动退避重试 3s→6s→12s · 遇到机器人验证会立刻暂停任务(不会继续跑出垃圾数据) · 链接是哪个站的域名就按哪个站采 · 【并行】按「并行网页数」同时跑多个单元(阶段1/2/3 都并行), 每个 worker 一张独立标签页 + 独立 CDP 会话; 每批之间仍留 2-3 秒间隔防风控 · 属【异步采集】: 提交后立即返回, 进度见上方, 跑完自动弹出结果' },
];
function fmtMoney(n, cur) {
  if (n == null) return '-';
  const sym = { GBP: '£', USD: '$', EUR: '€', JPY: '¥', CAD: 'C$', INR: '₹', MXN: 'MX$', AUD: 'A$', PLN: 'zł', SEK: 'kr', SAR: 'SAR', SGD: 'S$', BRL: 'R$', TRY: '₺' }[cur] || (cur ? cur + ' ' : '£');
  return sym + Number(n).toFixed(2);
}
function F0() {
  return { sites: ['de'], customSites: '', fulfill: '', shopAplus: '', brandShop: '', brandStore: '', rankRange: '', priceRange: '', ratingRange: '', reviewsRange: '', salesRange: '', tmRange: '', newDaysRange: '', is1688: '', brandStatus: '', tmCountries: '', badges: '', q: '', cat1: '', cat2: '', famFilter: '', famAny: false, famKey: '', dropOtherBrand: '' };
}function FmtMoney(n, cur) {
  if (n == null) return '-';
  const sym = { GBP: '£', USD: '$', EUR: '€', JPY: '¥', CAD: 'C$', INR: '₹', MXN: 'MX$', AUD: 'A$', PLN: 'zł', SEK: 'kr', SAR: 'SAR', SGD: 'S$', BRL: 'R$', TRY: '₺' }[cur] || (cur ? cur + ' ' : '£');
  return sym + Number(n).toFixed(2);
}
/**
 * 商品卡片缩放（商品管理页可放大/缩小卡片）。
 * 一个倍数同时缩放卡片高度、列宽和里面所有字号 —— 只缩放容器会让字看起来更小, 所以一起缩放。
 * 范围 0.7 ~ 1.6 倍, 步进 0.1; 存在 localStorage, 刷新/重开面板都保留。
 */
const CARD_SCALE_KEY = 'zying.products.cardScale.v1';
const CARD_SCALE_MIN = 0.7;
const CARD_SCALE_MAX = 1.6;
const CARD_SCALE_STEP = 0.1;
function clampCardScale(v) {
  const n = Number(v);
  if (!isFinite(n)) return 1;
  const rounded = Math.round(n * 100) / 100;
  return Math.min(CARD_SCALE_MAX, Math.max(CARD_SCALE_MIN, rounded));
}
function readCardScale() {
  try {
    const v = (typeof window !== 'undefined' && window.localStorage) ? window.localStorage.getItem(CARD_SCALE_KEY) : null;
    return v ? clampCardScale(v) : 1;
  } catch (e) { return 1 }
}
function writeCardScale(v) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) window.localStorage.setItem(CARD_SCALE_KEY, String(clampCardScale(v)));
  } catch (e) { /* 隐私模式 → 不记忆 */ }
}

/**
 * 排名数字的底色规则（可自定义）。
 * 按"排名区间"配色: 排名越小(越靠前)越醒目。用户在卡片上点排名数字、或点工具条的「🎨 排名底色」
 * 即可改 4 档区间的上界与底色，配置存 localStorage（刷新/重开面板都还在）。
 */
const RANK_CFG_KEY = 'zying.products.rankColors.v1';
const RANK_TIERS_DEFAULT = [
  { max: 100, color: '#f0b253' },      // ≤100
  { max: 1000, color: '#5fd08a' },     // ≤1000
  { max: 10000, color: '#4f8cff' },    // ≤10000
  { max: null, color: '#4a4a55' },     // 其余(null = 兜底, 永远是最后一档)
];
function readRankCfg() {
  try {
    const s = JSON.parse((typeof window !== 'undefined' && window.localStorage ? window.localStorage.getItem(RANK_CFG_KEY) : '') || 'null');
    if (Array.isArray(s) && s.length) {
      // 规范化: 数字上界按升序, 兜底档(null)排最后
      const fixed = s.map((x) => ({ max: (x && x.max != null && isFinite(Number(x.max))) ? Number(x.max) : null, color: String((x && x.color) || '#4a4a55') }));
      const withMax = fixed.filter((x) => x.max != null).sort((a, b) => a.max - b.max);
      const tail = fixed.filter((x) => x.max == null);
      return withMax.concat(tail.length ? tail : [{ max: null, color: '#4a4a55' }]);
    }
  } catch (e) { /* 忽略 */ }
  return RANK_TIERS_DEFAULT.map((x) => Object.assign({}, x));
}
function writeRankCfg(tiers) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) window.localStorage.setItem(RANK_CFG_KEY, JSON.stringify(tiers));
  } catch (e) { /* 隐私模式 → 不记忆 */ }
}
/**
 * 商品卡片底色(可自定义)。与排名底色同一套思路: 配置存 localStorage, 工具条「🎨 卡片底色」里改,
 * 刷新/重开面板都保留。默认是"近乎透明"(跟系统面板底色走), 也可以选浅色底 —— 选浅色底时
 * 卡片内的文字/描边会自动切成深色(cardInkOf), 不然浅底配浅字看不见。
 *
 * 2026-09-20 起支持【按配送方式分档配色】: 默认底色 + FBA / FBM / AMZ 各一个颜色。
 *   卡片实际底色 = 该商品所属档位的颜色, 若该档位留空("跟默认")就回落到默认底色。
 *   档位判定沿用系统既有口径(与利润测算一致): amazonSell → AMZ; fulfill=FBA → FBA;
 *   fulfill=FBM → FBM; 没采到配送方式 → 默认底色。
 */
const CARD_BG_KEY = 'zying.products.cardBg.v1';
const CARD_BG_DEFAULT = 'rgba(255,255,255,.02)';
const CARD_BG_GROUPS = [
  { k: 'base', name: '默认底色', hint: '没采到配送方式 / 未单独配色的档位都走这里' },
  { k: 'FBA', name: 'FBA', hint: '亚马逊物流(fulfill = FBA)' },
  { k: 'FBM', name: 'FBM', hint: '卖家自配送(fulfill = FBM)' },
  { k: 'AMZ', name: 'AMZ', hint: '亚马逊自营(amazonSell = true)' },
];
const CARD_BG_PRESETS = [
  { name: '默认(跟面板)', color: CARD_BG_DEFAULT },
  { name: '墨黑', color: '#131317' },
  { name: '深灰', color: '#24242b' },
  { name: '石板蓝', color: '#1d2634' },
  { name: '深绿', color: '#16241c' },
  { name: '酒红', color: '#2a1b1f' },
  { name: '米白', color: '#f6f2e9' },
  { name: '浅蓝', color: '#e9f1ff' },
  { name: '淡绿', color: '#e9f8ef' },
  { name: '浅粉', color: '#fdeef2' },
];
/** 颜色解析: #rgb / #rrggbb / rgb() / rgba() → {r,g,b,a}(解析不了返回 null) */
function parseColor(c) {
  const s = String(c == null ? '' : c).trim();
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (m) {
    const h = m[1].length === 3 ? m[1].split('').map((x) => x + x).join('') : m[1];
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
  }
  m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(s);
  if (m) return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: m[4] == null ? 1 : Number(m[4]) };
  return null;
}
/** 底色是不是浅色(半透明色按"叠在深色面板上"折算) */
function bgIsLight(color) {
  const c = parseColor(color);
  if (!c) return false;
  const a = isFinite(c.a) ? Math.min(1, Math.max(0, c.a)) : 1;
  const base = 27;                                        // 深色面板底 ≈ #1b1b1f
  const r = c.r * a + base * (1 - a), g = c.g * a + base * (1 - a), b = c.b * a + base * (1 - a);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55;
}
/** 浅色底时卡片内的文字/描边颜色; 深色底返回 null(= 跟系统主题, 不干预) */
function cardInkOf(color) {
  if (!bgIsLight(color)) return null;
  return { primary: '#1c2024', secondary: '#5c636b', border: 'rgba(0,0,0,.22)' };
}
/** 把任意来源的值规范化成 {base,FBA,FBM,AMZ} 四个颜色(空串 = 该档"跟默认") */
function normCardBgCfg(v) {
  const out = { base: CARD_BG_DEFAULT, FBA: '', FBM: '', AMZ: '' };
  const take = (k, val) => { const s = String(val == null ? '' : val).trim(); if (s && parseColor(s)) out[k] = s };
  if (typeof v === 'string') { take('base', v); return out }                       // 旧版(单色字符串)兼容
  if (v && typeof v === 'object') {
    take('base', v.base);
    CARD_BG_GROUPS.forEach((g) => { if (g.k !== 'base') take(g.k, v[g.k]) });
  }
  return out;
}
/** 商品属于哪个配色档位 */
function cardFillKey(p) {
  if (!p) return 'base';
  if (p.amazonSell) return 'AMZ';
  const f = String(p.fulfill || '').trim().toUpperCase();
  if (f === 'FBA') return 'FBA';
  if (f === 'FBM') return 'FBM';
  return 'base';                                          // 没采到配送方式 → 默认底色
}
/** 该商品最终生效的卡片底色 */
function resolveCardBg(cfg, p) {
  const c = normCardBgCfg(cfg);
  const k = cardFillKey(p);
  const own = (k !== 'base' && c[k]) ? c[k] : '';
  return own || c.base || CARD_BG_DEFAULT;
}
/** 是否做过自定义(工具条按钮高亮用) */
function cardBgCustomized(cfg) {
  const c = normCardBgCfg(cfg);
  return c.base !== CARD_BG_DEFAULT || CARD_BG_GROUPS.some((g) => g.k !== 'base' && !!c[g.k]);
}
function readCardBg() {
  try {
    const raw = (typeof window !== 'undefined' && window.localStorage ? window.localStorage.getItem(CARD_BG_KEY) : '') || '';
    if (!raw.trim()) return normCardBgCfg(null);
    if (raw.trim().charAt(0) === '{') return normCardBgCfg(JSON.parse(raw));       // 新版(分档对象)
    return normCardBgCfg(raw);                                                    // 旧版(单色字符串)
  } catch (e) { /* 解析失败/隐私模式 → 默认 */ }
  return normCardBgCfg(null);
}
function writeCardBg(cfg) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) window.localStorage.setItem(CARD_BG_KEY, JSON.stringify(normCardBgCfg(cfg)));
  } catch (e) { /* 隐私模式 → 不记忆 */ }
}
/** 排名落在哪一档 */
/* ★ 2026-09-25 未上榜 vs 未采到 (两者必须分开显示)
 *   not_listed: 插件面板已分析完、也确实读到了排名行, 就是没有【根类目】这一侧的排名 → 未上榜
 *   unknown(或字段缺失): 这一轮没采到 → 未采到(还能靠补采救)
 *   旧数据没有 rankParentState 字段 → 一律按"未采到"显示, 不冒充未上榜 */
function rankParentIsNotListed(p) { return !!(p && p.rankParent == null && p.rankParentState === 'not_listed'); }
function rankParentCellText(p) {
  if (!p) return '-';
  if (p.rankParent != null) return null;                 // 有排名 → 交给调用方按原样式显示
  return rankParentIsNotListed(p) ? '未上榜' : '-';
}
function rankParentNote(p) {
  if (!p) return '未采到';
  if (p.rankParent != null) return null;
  return rankParentIsNotListed(p)
    ? '未上榜（插件面板已分析完, 该商品没有根类目排名行 —— 不是没采到）'
    : '未采到（面板没给出, 可以补采再试）';
}

function rankTierOf(val, tiers) {
  const t = (tiers && tiers.length) ? tiers : RANK_TIERS_DEFAULT;
  const n = Number(String(val == null ? '' : val).replace(/[^\d]/g, ''));
  if (!n) return null;
  for (const x of t) if (x.max == null || n <= x.max) return x;
  return t[t.length - 1];
}
/** 按底色亮度自动选黑字/白字(不然浅色底配白字看不见) */
function rankTextColor(bg) {
  const s = String(bg || '').replace('#', '');
  const hex = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
  if (![r, g, b].every((v) => isFinite(v))) return '#fff';
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.62 ? '#15161a' : '#fff';
}

/**
 * 商品管理列表状态记忆（页码 / 每页条数）。
 * 为什么需要: load() 原来每次刷新都 setPage(1) —— 保存、删除、批量同步、看详情返回、换页后
 * 触发任何一次 load 都会跳回第 1 页, 翻到第 8 页看货时点一下收藏就回顶部, 完全没法用。
 * 面板本身跑在浏览器页面里, localStorage 也可能被策略禁用 → 全部 try/catch, 失败就退化成"不记忆"。
 */
const PM_STATE_KEY = 'zying.products.list.v1';
function readPmState() {
  try { return JSON.parse((typeof window !== 'undefined' && window.localStorage ? window.localStorage.getItem(PM_STATE_KEY) : '') || '{}') || {} }
  catch (e) { return {} }
}
function writePmState(patch) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    const s = readPmState();
    Object.keys(patch || {}).forEach(function (k) { s[k] = patch[k]; });
    window.localStorage.setItem(PM_STATE_KEY, JSON.stringify(s));
  } catch (e) { /* 隐私模式/策略禁用 → 不记忆即可, 不能影响列表 */ }
}

/**
 * 亚马逊主图取高清版: 缩略图 URL 里那段修饰符(`._AC_UY218_.jpg`)决定了尺寸,
 * 换成 `._AC_SL1500_.jpg` 就是 1500px 原图 —— 悬停预览/放大镜必须用它,
 * 直接放大缩略图只会得到一张糊图(原来是 maxHeight:70vh 硬拉 218px 图)。
 * 拿不到修饰符(非亚马逊图床)时原样返回。
 */
function hiResImg(url, px) {
  const u = String(url == null ? '' : url).trim();
  if (!u) return '';
  // 只对亚马逊图床做转换 —— 别的域名没有这套尺寸修饰符, 硬加会 404
  if (!/amazon\.com\/images\//i.test(u)) return u;
  const size = px || 1500;
  if (/\._[^./]*_\.(jpg|jpeg|png|webp|gif)$/i.test(u)) return u.replace(/\._[^./]*_\.(jpg|jpeg|png|webp|gif)$/i, '._AC_SL' + size + '_.$1');
  if (/\.(jpg|jpeg|png|webp|gif)$/i.test(u)) return u.replace(/\.(jpg|jpeg|png|webp|gif)$/i, '._AC_SL' + size + '_.$1');
  return u;
}
function FmtNum(n) { return n == null ? '-' : Number(n).toLocaleString(); }
function Fq() { return { q: '', fba: '', sell: '', aplus: '', badge: '', open: true, priceRange: '', salesRange: '', rankMax: '', rating: '', fAplus: '', tmMax: '', china: '', sites: [], catNot: [], catKw: '', collectedFrom: '', collectedTo: '' }; }
return {
  inject: ['slots', 'timer'],
  apply(ctx) {
    const slots = ctx.get('slots');
    if (slots === undefined) return;
    styles.insert('.zyp{font-size:13px;color:var(--dsw-alias-label-primary,#e6e6e6)}' +
          '.zyp-toolbar{display:flex;gap:6px;flex-wrap:wrap;align-items:center;padding:10px 14px;margin-bottom:10px;background:var(--dsw-alias-bg-layer-1,#1b1b1f);border:1px solid var(--dsw-alias-border-l2,#2a2a2f);border-radius:10px}' +
          '.zyp-card{background:var(--dsw-alias-bg-layer-1,#1b1b1f);border:1px solid var(--dsw-alias-border-l2,#2a2a2f);border-radius:10px;padding:12px 14px;margin-bottom:12px}' +
          '.zyp-h{font-weight:600;margin:0 0 8px;font-size:13px}' +
          '.zyp-note{color:var(--dsw-alias-label-secondary,#9a9a9a);font-size:12px;line-height:1.6}' +
          '.zyp-lbl{color:var(--dsw-alias-label-secondary,#8a8a8a);font-size:11px;margin-bottom:3px}' +
          '.zyp-input{background:var(--dsw-alias-bg-layer-2,#1b1b1f);color:var(--dsw-alias-label-primary,#eee);border:1px solid var(--dsw-alias-border-l2,#333);border-radius:7px;padding:5px 8px;font-size:12px;box-sizing:border-box}' +
          '.zyp-btn{border:1px solid var(--dsw-alias-border-l2,#3a3a44);background:var(--dsw-alias-bg-layer-2,#23232a);color:var(--dsw-alias-label-primary,#eee);border-radius:7px;padding:4px 10px;font-size:12px;cursor:pointer;white-space:nowrap}' +
          '.zyp-btn:hover:not([disabled]){border-color:#4f8cff}.zyp-btn[disabled]{opacity:.5;cursor:default}' +
          '.zyp-ok{color:#5fd08a}.zyp-warn{color:#f0b253}.zyp-err{color:#f28b8b}' +
          '.zyp-tbl{width:100%;border-collapse:collapse;font-size:12px;min-width:1300px}' +
          '.zyp-tbl th{text-align:left;padding:6px 8px;font-size:11.5px;white-space:nowrap;color:#aaa;border-bottom:1px solid #333;position:sticky;top:0;background:var(--dsw-alias-bg-layer-1,#1b1b1f);z-index:2}' +
          '.zyp-tbl td{padding:5px 8px;border-bottom:1px solid #26262c;vertical-align:top}' +
          '.zyp-badge{display:inline-block;font-size:10.5px;padding:1px 6px;border-radius:999px;line-height:1.5}' +
          '.zyp-bz{background:rgba(240,178,83,.14);color:#f0b253}.zyp-br{background:rgba(242,139,139,.14);color:#f28b8b}.zyp-bg{background:rgba(95,208,138,.14);color:#5fd08a}.zyp-bb{background:rgba(79,140,255,.16);color:#8ab4ff}.zyp-bm{background:rgba(200,150,255,.14);color:#c78}' +
          '.zyp-mask{position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:9999;padding:20px}' +
          '.zyp-modal{background:var(--dsw-alias-bg-layer-1,#202027);border:1px solid #3a3a44;border-radius:12px;max-width:900px;width:100%;max-height:88vh;display:flex;flex-direction:column}' +
          '.zyp-mhead{padding:12px 16px;font-weight:700;border-bottom:1px solid #333;display:flex;justify-content:space-between;align-items:center}' +
          '.zyp-mbody{padding:14px 16px;overflow:auto;line-height:1.7;font-size:12.5px}' +
          '.zyp-mfoot{padding:12px 16px;border-top:1px solid #333;display:flex;justify-content:flex-end;gap:8px}' +
          '.zyp-pill{border:1px solid #3a3a44;border-radius:999px;padding:1px 8px;font-size:11px;cursor:pointer;background:transparent;color:inherit;white-space:nowrap}' +
          '.zyp-pill.on{background:rgba(79,140,255,.15)}' +
          '.zyp-lnk{color:#8ab4ff;cursor:pointer;text-decoration:none}' +
          '.zyp-sel{outline:1px solid #4f8cff;outline-offset:-1px}');
styles.insert('.zywb{display:flex;flex-direction:column;height:100%;min-height:0;font-size:13px;color:var(--dsw-alias-label-primary,#e6e6e6)}' +
      '.zywb-top{display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid var(--dsw-alias-border-l2,#2a2a2a);flex-wrap:wrap}' +
      '.zywb-title{font-weight:700;font-size:15px}' +
      '.zywb-tabs{display:flex;gap:6px;padding:8px 16px 0;border-bottom:1px solid var(--dsw-alias-border-l2,#222)}' +
      '.zywb-tab{border:none;background:transparent;color:var(--dsw-alias-label-secondary,#aaa);padding:7px 14px;border-radius:8px 8px 0 0;cursor:pointer;font-size:13px;border-bottom:2px solid transparent}' +
      '.zywb-tab:hover{color:#eee}.zywb-tab.on{color:#fff;border-bottom-color:#4f8cff;background:rgba(79,140,255,.07)}' +
      '.zywb-body{flex:1;overflow:auto;padding:14px 16px;min-height:0}' +
      '.zywb-card{background:var(--dsw-alias-bg-layer-1,#1b1b1f);border:1px solid var(--dsw-alias-border-l2,#2a2a2f);border-radius:10px;padding:12px 14px;margin-bottom:12px}' +
      '.zywb-h{font-weight:600;margin:0 0 8px;font-size:13px}' +
      '.zywb-note{color:var(--dsw-alias-label-secondary,#9a9a9a);font-size:12px;line-height:1.7}' +
      '.zywb-lbl{color:var(--dsw-alias-label-secondary,#8a8a8a);font-size:11px;margin-bottom:3px}' +
      '.zywb-input{background:var(--dsw-alias-bg-layer-2,#1b1b1f);color:var(--dsw-alias-label-primary,#eee);border:1px solid var(--dsw-alias-border-l2,#333);border-radius:7px;padding:6px 8px;font-size:12px;box-sizing:border-box}' +
      '.zywb-input:focus{outline:none;border-color:#4f8cff}' +
      '.zywb-btn{border:1px solid var(--dsw-alias-border-l2,#3a3a44);background:var(--dsw-alias-bg-layer-2,#23232a);color:var(--dsw-alias-label-primary,#eee);border-radius:8px;padding:5px 11px;font-size:12px;cursor:pointer}' +
      '.zywb-btn:hover:not([disabled]){border-color:#4f8cff}.zywb-btn[disabled]{opacity:.5;cursor:default}' +
      '.zywb-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(205px,1fr));gap:8px}' +
      '.zywb-ok{color:#5fd08a}.zywb-warn{color:#f0b253}.zywb-err{color:#f28b8b}' +
      '.zywb-table{width:100%;border-collapse:collapse;font-size:12px;min-width:1100px}' +
      '.zywb-table th{text-align:left;padding:6px 8px;font-size:11.5px;white-space:nowrap;color:#aaa;border-bottom:1px solid #333}' +
      '.zywb-table td{padding:6px 6px;border-bottom:1px solid #26262c;vertical-align:top}' +
      '.zywb-mask{position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:9999;padding:20px}' +
      '.zywb-modal{background:var(--dsw-alias-bg-layer-1,#202027);border:1px solid #3a3a44;border-radius:12px;max-width:820px;width:100%;max-height:86vh;display:flex;flex-direction:column}' +
      '.zywb-mhead{padding:12px 16px;font-weight:700;border-bottom:1px solid #333;display:flex;justify-content:space-between;align-items:center}' +
      '.zywb-mbody{padding:14px 16px;overflow:auto;line-height:1.8;font-size:12.5px}' +
      '.zywb-mfoot{padding:12px 16px;border-top:1px solid #333;display:flex;justify-content:flex-end;gap:8px}' +
      '.zywb-pill{border:1px solid #3a3a44;border-radius:999px;padding:2px 10px;font-size:11.5px;cursor:pointer;background:transparent;color:inherit}' +
      '.zywb-pill.on{background:rgba(79,140,255,.15)}' +
      '.zywb-lnk{text-decoration:none;color:#8ab4ff}');
    const api = function (path, method, body) {
      return host.call('zying/api', { path: path, method: method, body: body === undefined ? null : body }).then(function (r) {
        if (r && r.ok === false) { const e = new Error(r.error || ('HTTP ' + r.status)); throw e; }
        return r;
      });
    };
      /* ===== 本地无头浏览器状态条(第四期) =====
       * 放在采集面板标签行右侧: 一眼看到"采集跑在哪台浏览器上", 并能起/停/切换。
       * 为什么需要: 采集链路现在优先用本地无头浏览器(不弹窗、不占前台), 但要能看见它的状态。 */
    /* ===== 「服务器」页 = 插件里的一个浏览器(2026-09-26 重做) =====
     * 标签栏 / 地址栏 / 前进后退刷新主页 / 缩放 / 帧率 + 画面可点可滚可打字。
     * 输入与标签管理都走"隐藏 iframe 改 src"发 GET(直连 ERP, 绕开 DSH 网关, 不需要响应);
     * 状态与流水走 api()(已验证可用)。画面用 <img> 直接拉 raw=1 的 JPEG。
     */
    /** 桌面浏览器壳(Electron) 的动作链接 —— 走 /api/browser/shell, 不是 status */
    const SHELL_ACT = function (q, label, title) {
      return h('a', {
        className: 'zywb-btn', href: 'http://127.0.0.1:3088/api/browser/shell?' + q + '&ui=1',
        target: '_blank', rel: 'noopener', title: title || '',
        style: { padding: '3px 10px', fontSize: 12, textDecoration: 'none', display: 'inline-block' },
      }, label);
    };
    /* ===== 「浏览器壳」页 (2026-09-26) =====
     * 插件里不再显示浏览器画面 —— 只留一个入口去开「智赢浏览器壳」(Electron 桌面窗口)。
     * 为什么把画面搬走: 面板画面走 Chrome 的 Page.startScreencast, 实测硬上限 ~14fps
     *   (换分辨率/显卡/窗口模式都没用); 桌面壳里的浏览器是原生控件, 实测滚动 89fps。
     * 无头/离屏浏览器照旧在后台跑采集 —— 只是插件里不再展示它的界面。
     */
    function ShellPage(props) {
      const api = props.api;
      const [shell, setShell] = React.useState(null);
      const [act, setAct] = React.useState([]);
      const [logs, setLogs] = React.useState([]);

      const pullShell = function () {
        api('/api/browser/shell', 'GET', null).then(function (r) {
          if (r && r.ok && r.json) setShell(r.json);
        }).catch(function () {});
      };
      const pullLogs = function () {
        api('/api/browser/activity?limit=40', 'GET', null).then(function (r) {
          if (r && r.ok && r.json && r.json.items) setAct(r.json.items);
        }).catch(function () {});
        api('/api/collect/logs?limit=12', 'GET', null).then(function (r) {
          if (r && r.ok && r.json) setLogs((r.json.logs || r.json.items || []).slice(0, 12));
        }).catch(function () {});
      };
      React.useEffect(function () { pullShell(); pullLogs(); }, []);
      React.useEffect(function () { const t = setInterval(pullShell, 4000); return function () { clearInterval(t) }; }, []);
      React.useEffect(function () { const t = setInterval(pullLogs, 12000); return function () { clearInterval(t) }; }, []);

      const running = !!(shell && shell.running);

      return h('div', { style: { padding: 12 } },
        h('div', { className: 'zyp-card' },
          h('div', { className: 'zyp-h' }, '🖥 智赢浏览器壳',
            h('span', { className: 'zyp-note', style: { float: 'right', fontSize: 11 } },
              shell ? (running ? ('● 运行中 · ' + String(shell.browser || '').slice(0, 14) + ' · CDP ' + shell.port) : '○ 没在运行') : '查询中…')),
          h('div', { style: { fontSize: 12.5, marginTop: 4, lineHeight: 1.75 } },
            '浏览器就在这个桌面壳里：左边控制台，右边是真浏览器（原生渲染，不串流）。',
            h('br'),
            '实测滚动 ', h('b', { style: { color: '#7ee2a8' } }, '89 fps'), ' / 静止 100 fps；面板串流那条路硬上限 ~14fps。'),
          /* ★ 2026-09-27: 用户问「为什么我在浏览器壳里没有看到运行采集工作」——
           *   壳(9334, Electron)与采集浏览器(9333, 无头 Edge)是【两个不同的浏览器进程】,
           *   采集从来不在壳里跑。原来只有一行小字提示, 太容易漏看 → 写明 + 给一个直达按钮。 */
          h('div', { style: { fontSize: 12.5, marginTop: 8, padding: '6px 8px', border: '1px solid #3a3a44', borderRadius: 6, background: 'rgba(240,178,83,.07)' } },
            '⚠ ', h('b', null, '这里不是采集跑的地方'), '：采集跑在另一个浏览器里 ——「🌐 采集浏览器」那条上的',
            h('b', null, '本地无头 Edge'), '（CDP 9333，屏幕上没有窗口）。这个壳是 Electron（CDP ', String((shell && shell.port) || 9334), '），',
            '是给你人工接手用的（验证码 / 登录 / 手动逛）。两个是不同进程、不同 profile，所以壳里看不到采集开的标签页。',
            h('div', { style: { marginTop: 6, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
              props.onOpenCollect ? h('button', { className: 'zywb-btn', style: { padding: '3px 10px', background: '#2f6feb', borderColor: '#2f6feb', color: '#fff' }, onClick: props.onOpenCollect }, '→ 去采集面板点「📷 看画面」') : null,
              h('span', { className: 'zyp-note', style: { fontSize: 11 } },
                '（也能把采集切到壳里跑: POST /api/browser/switch {"target":"' + String((shell && shell.port) || 9334) + '"}，但会和你手动操作抢标签页，不推荐）'))),
          h('div', { style: { marginTop: 10 } },
            running
              ? h('span', null, SHELL_ACT('action=stop', '停止浏览器壳', '关掉这个桌面浏览器壳'))
              : h('span', null, SHELL_ACT('action=start', '启动浏览器壳', '打开一个桌面窗口: 左边控制台, 右边真浏览器'),
                ' ', h('span', { className: 'zyp-note', style: { fontSize: 11 } }, (shell && shell.hasExe) ? '' : '（没找到 Electron, 先去 zying-browser-shell 目录 npm install）'))),
          h('div', { className: 'zyp-note', style: { fontSize: 11, marginTop: 8 } },
            '⚠ 壳有它自己独立的 profile：采集插件已经内置（本地加载），但 ',
            h('b', null, 'Amazon / ifast 的登录态要在壳里重新登一次'), '。'),
          h('div', { className: 'zyp-note', style: { fontSize: 11, marginTop: 4 } },
            '采集照旧跑在本机无头/离屏浏览器里（后台、不弹窗），插件里不再显示它的画面。遇到验证码要人工接手时，开壳处理。')),

        // ── 活动流水
        h('div', { className: 'zyp-card', style: { marginTop: 10 } },
          h('div', { className: 'zyp-h' }, '📋 活动流水',
            h('button', { className: 'zywb-btn', style: { float: 'right', padding: '2px 8px', fontSize: 11.5 }, onClick: function () { pullShell(); pullLogs() } }, '刷新')),
          act.length
            ? h('div', { style: { fontSize: 12, fontFamily: 'ui-monospace,monospace', maxHeight: 200, overflow: 'auto' } }, act.map(function (x, k) {
                return h('div', { key: k, style: { padding: '3px 0', borderBottom: '1px dashed #2a2a30' } },
                  h('span', { style: { color: '#9a9a9a', marginRight: 8 } }, String(x.at || '').slice(11)),
                  h('span', { style: { color: x.kind === 'collect' ? '#8ab4ff' : (x.kind === 'browser' ? '#e0b25c' : '#7ee2a8'), marginRight: 6 } }, '[' + (x.kind || 'info') + ']'),
                  x.text);
              }))
            : h('div', { className: 'zyp-note' }, '还没有活动记录。'),
          logs.length ? h('div', { style: { marginTop: 10 } },
            h('div', { className: 'zyp-note', style: { marginBottom: 4 } }, '最近采集记录:'),
            h('div', { style: { fontSize: 11.5, fontFamily: 'ui-monospace,monospace', maxHeight: 120, overflow: 'auto' } }, logs.map(function (g, k) {
              return h('div', { key: k, style: { padding: '2px 0' } },
                String((g.atLocal || g.at || '')).slice(0, 16) + ' · ' + (g.name || '') + ' · 新增 ' + (g.added != null ? g.added : '?') + ' / 采到 ' + (g.count != null ? g.count : '?'));
            }))) : null));
    }

    function Modal(props) {
      const btns = props.buttons || [{ label: '关闭', primary: true, onClick: props.onClose }];
      return h('div', { className: 'zywb-mask', onClick: function (e) { if (e.target === e.currentTarget && props.onClose) props.onClose(); } },
        h('div', { className: 'zywb-modal' },
          h('div', { className: 'zywb-mhead' }, h('span', null, props.title), h('button', { onClick: props.onClose, style: { background: 'none', border: 'none', color: '#aaa', fontSize: 16, cursor: 'pointer' } }, '✕')),
          h('div', { className: 'zywb-mbody' }, props.children != null ? props.children : (props.rows || []).map(function (t, i) { return h('div', { key: i }, t); })),
          h('div', { className: 'zywb-mfoot' }, btns.map(function (b, i) { return h('button', { key: i, onClick: b.onClick, className: 'zywb-btn', style: b.primary ? { background: '#2f6feb', borderColor: '#2f6feb', color: '#fff' } : undefined }, b.label); }))));
    }
    function fmtResRows(r) {
      const rows = [];
      if (!r || typeof r !== 'object') return ['(无数据)'];
      if (r.error) return ['✗ ' + r.error];
      if (Array.isArray(r.results)) r.results.forEach(function (res) {
        /* ★ 带上"找到几个卖家": 用户原来看到 `✗ 第1轮 · B0D8XSNPP3 — ...` 时根本判断不出
         *   是"没找到卖家"还是"找到但店铺都失败了"(接口里其实有 sellerCount, 只是没显示) */
        const head = '第' + (res.round != null ? res.round : '?') + '轮 · ' + (res.asin || '')
          + (res.sellerCount != null ? ' · 找到卖家 ' + res.sellerCount + ' 个' : '') + (res.note ? ' (' + res.note + ')' : '');
        if (res.error) rows.push('✗ ' + head + ' — ' + res.error);
        else rows.push('✓ ' + head);   // head 里已经带了 note, 不重复拼
        (res.sellers || []).forEach(function (s) { rows.push((s.error ? '✗ ' : '✓ ') + (s.seller || s.sellerId || '?') + (s.error ? ': ' + s.error : ' — 店铺商品 ' + (s.productCount || 0) + ' 个' + (s.skipped ? ' (跳过 ' + s.skipped + ')' : ''))); });
      });
      if (Array.isArray(r.roundResults)) r.roundResults.forEach(function (res) {
        const head = '第' + (res.round != null ? res.round : '?') + '轮 · ' + (res.asin || '') + (res.note ? ' (' + res.note + ')' : '');
        if (res.error) rows.push('✗ ' + head + ' — ' + res.error);
        else rows.push('✓ ' + head + (res.sellerFrom === 'aod' ? ' [aod实时]' : res.sellerFrom === 'history' ? ' [历史兜底]' : '') + (res.sellerCount != null ? ' · ' + res.sellerCount + ' 个卖家' : ''));
        (res.sellers || []).forEach(function (s) { rows.push((s.error ? '✗ ' : '✓ ') + (s.seller || s.sellerId || '?') + (s.error ? ': ' + s.error : ' — 店铺商品 ' + (s.productCount || 0) + ' 个' + (s.skipped ? ' (跳过 ' + s.skipped + ')' : ''))); });
      });
      // 批量品牌采集: 每个品牌一行 (列表/候选/详情已读/入库/筛选跳过/品牌不符)
      if (Array.isArray(r.brands) && r.brands[0] && r.brands[0].candidates != null) r.brands.forEach(function (b) {
        rows.push((b.error ? '⚠ ' : '✓ ') + '品牌 ' + (b.brand || b.lead || '?') + ' — 列表 ' + (b.listCount || 0) + ' 个 · 候选 ' + (b.candidates || 0)
          + ' · 详情已读 ' + (b.read || 0) + ' · 入库 ' + (b.added || 0)
          + (b.skipped ? ' · 筛选跳过 ' + b.skipped : '') + (b.mismatch ? ' · 品牌不符 ' + b.mismatch : '') + (b.error ? ' — ' + b.error : ''));
        if (b.brandUrl) rows.push('   ↳ 品牌跳转 (' + (b.brandSource || '?') + '): ' + String(b.brandUrl).slice(0, 120));
      });
      if (Array.isArray(r.steps)) r.steps.forEach(function (s) { rows.push('· ' + s); });
      let summary = '';
      if (r.seller) summary += '出售单位: ' + r.seller + '; ';
      if (r.shopOk != null) summary += '卖家店铺成功 ' + r.shopOk + ' / 失败 ' + (r.shopFail || 0) + '; ';
      if (r.autoJumps != null) summary += '自动跳转 ' + r.autoJumps + ' 次; ';
      /* ★ 2026-09-27 列表页直采/筛选采集的分段数字(以前这些字段没人显示, 结果弹窗只说"抓取 N 个", 看不出筛掉了多少) */
      if (r.pagesDone != null) summary += '采了 ' + r.pagesDone + ' 页; ';
      if (r.skippedByList != null && r.skippedByList) summary += '列表阶段筛掉 ' + r.skippedByList + ' 个; ';
      if (r.preFiltered != null) summary += '插件前置筛选通过 ' + r.preFiltered + ' 个; ';
      if (r.enriched != null) summary += '完整筛选通过 ' + r.enriched + ' 个; ';
      if (r.productCount != null) summary += '抓取 ' + r.productCount + ' 个' + (r.skipped ? ' (过滤跳过 ' + r.skipped + ')' : '') + '; ';
      if (r.withPlugin != null) summary += '插件信息(FBA/排名/卖家数)覆盖 ' + r.withPlugin + '/' + (r.productCount || 0) + ' 个; ';
      if (r.shopAplusSkip) summary += 'A+ 店铺过滤跳过 ' + r.shopAplusSkip + ' 个; ';
      if (r.brandShopSkip) summary += '品牌店铺筛选跳过 ' + r.brandShopSkip + ' 个; ';
      if (r.brandSkip) summary += '指定品牌筛选跳过 ' + r.brandSkip + ' 个; ';
      if (r.added != null) summary += '新增入库 ' + r.added + '; ';
      if (r.total != null) summary += '当前共 ' + r.total + ' 条; ';
      if (r.okRounds != null) summary += '成功 ' + r.okRounds + ' 轮; ';
      if (summary) rows.push(summary.replace(/; $/, ''));
      if (r.stopped) rows.push('⏹ 本次采集已被您手动停止 — 已采集数据已保存入库');
      if (!rows.length) rows.push('✓ 采集完成');
      return rows;
    }
    function NameModal(props) {
      const [v, setV] = React.useState(props.def || '');
      return h(Modal, { title: '保存过滤为规则', onClose: props.onClose, buttons: [{ label: '取消', onClick: props.onClose }, { label: '保存', primary: true, onClick: function () { const nm = v.trim(); if (!nm) return; props.onSave(nm); } }],
        children: h('div', null,
          h('div', { style: { marginBottom: 6 } }, '规则名称 (必填)'),
          h('input', { className: 'zywb-input', value: v, onChange: function (e) { setV(e.target.value); }, style: { width: '100%' } }),
          h('div', { className: 'zywb-note', style: { marginTop: 8 } }, props.hint)) });
    }
    function ModeModal(props) {
      const m = props.modeObj;
      const [vals, setVals] = React.useState({});
      const isCatMode = m.mode === 'category';
      const [cat1, setCat1] = React.useState('');
      const [cat2, setCat2] = React.useState('');
      const fval = function (fd) { return vals[fd.f] != null ? vals[fd.f] : (fd.def != null ? fd.def : ''); };
      const chg = function (fd) { return function (e) { setVals(function (o) { const n = Object.assign({}, o); delete n.__err; n[fd.f] = e.target.value; return n; }); }; };
      const rows = m.fields.map(function (fd) { return h('div', { key: fd.f, style: { marginBottom: 10 } },
        h('div', { className: 'zywb-lbl' }, fd.label),
        h('textarea', { className: 'zywb-input', value: fval(fd), onChange: chg(fd), placeholder: fd.ph || '', rows: (fd.f === 'urls' || fd.f === 'asins') ? 3 : 1, style: { width: '100%', resize: 'vertical' } })); });
      const cat1Opts = CATEGORY_TREE.map(function (c) { return h('option', { key: c.v, value: c.v }, c.l + ' (' + c.v + ')'); });
      const cat1Node = CATEGORY_TREE.find(function (c) { return c.v === cat1; });
      const cat2Arr = (cat1Node && cat1Node.children) || [];
      const cat2Opts = cat2Arr.map(function (c) { return h('option', { key: c[0], value: c[0] }, c[1] + ' (' + c[0] + ')'); });
      const catFields = h('div', null,
        h('div', { className: 'zywb-note', style: { marginBottom: 8 } }, '类目搜索采集: 选 一级类目 + (可选)二级类目 → 在该类目里浏览采集; 或只填自定义关键词搜索采集。'),
        h('div', { style: { marginBottom: 10 } },
          h('div', { className: 'zywb-lbl' }, '一级类目'),
          h('select', { className: 'zywb-input', value: cat1, onChange: function (e) { setCat1(e.target.value); setCat2(''); }, style: { width: '100%' } }, h('option', { value: '' }, '— 不选 (用关键词搜索) —'), cat1Opts)),
        cat1 ? h('div', { style: { marginBottom: 10 } },
          h('div', { className: 'zywb-lbl' }, '二级类目 (可选)'),
          h('select', { className: 'zywb-input', value: cat2, onChange: function (e) { setCat2(e.target.value); }, style: { width: '100%' } }, h('option', { value: '' }, '— 整个 ' + cat1Node.l + ' —'), cat2Opts)) : null,
        h('div', { style: { marginBottom: 10 } },
          h('div', { className: 'zywb-lbl' }, '自定义关键词 (可选)'),
          h('input', { className: 'zywb-input', value: fval({ f: 'keyword' }), onChange: chg({ f: 'keyword' }), placeholder: '如: car phone holder', style: { width: '100%' } })),
        h('div', { style: { marginBottom: 10 } },
          h('div', { className: 'zywb-lbl' }, '翻页数 (每页约16个商品)'),
          h('input', { className: 'zywb-input', type: 'number', value: fval({ f: 'maxPages' }), onChange: chg({ f: 'maxPages' }), style: { width: '100%' } })),
        h('div', { className: 'zywb-note', style: { color: '#8a8a8a', marginTop: 6 } }, '⚠ 选了类目 → 关键词可留空; 一个类目都不选 → 关键词必填。'));
      const onSubmit = function () {
        if (isCatMode) {
          const keyword = String(fval({ f: 'keyword' }) || '').trim();
          const category = cat2 || cat1 || '';
          if (!keyword && !category) {
            setVals(function (o) { return Object.assign({}, o, { __err: '请选择一级/二级类目, 或填写自定义关键词' }); });
            return;
          }
          props.onSubmit({ keyword: keyword, category: category, maxPages: fval({ f: 'maxPages' }) });
          return;
        }
        const out = {}; m.fields.forEach(function (fd) { out[fd.f] = fval(fd); }); props.onSubmit(out);
      };
      const errRow = vals.__err ? h('div', { className: 'zywb-note zywb-err', style: { marginBottom: 8 } }, '⚠ ' + vals.__err) : null;
      return h(Modal, { title: m.icon + ' ' + m.name, onClose: props.onClose, buttons: [{ label: '取消', onClick: props.onClose }, { label: '🚀 开始采集', primary: true, onClick: onSubmit }],
        children: h('div', null, isCatMode ? h('div', null, errRow, catFields) : h('div', null, rows), h('div', { className: 'zywb-note', style: { marginTop: 6 } }, '💡 ' + m.hint)) });
    }
    function CollectPage(props) {
      const [f, setF] = React.useState(F0());
      const [siteOpen, setSiteOpen] = React.useState(false);
      // 统一过滤条件 (与商品管理同一 schema/同一组件): 唯一数据源, 提交时整体作为 filter 传给后端
      const [filt, setFilt] = React.useState(NF());
      const [catTree, setCatTree] = React.useState(null);
      const [tmCountryOpts, setTmCountryOpts] = React.useState([]);   // ★ 「排除商标国家」多选下拉的选项
      React.useEffect(function () { loadFilterSpecOnce(props.api, function (j) { setTmCountryOpts(j.tmCountryOptions || []); }); }, []);
      const [fdesc, setFdesc] = React.useState('无过滤');
      const loadCatTree = function () { props.api('/api/products/cat-tree', 'GET', null).then(function (r) { if (r && r.ok && r.json && r.json.tree) setCatTree(r.json); }).catch(function () {}); };
      const [cat2List, setCat2List] = React.useState([]);
      const [rules, setRules] = React.useState([]);
      const [ruleSel, setRuleSel] = React.useState('');
      const [ruleInfo, setRuleInfo] = React.useState('');
      const [modal, setModal] = React.useState(null);
      const [run, setRun] = React.useState(null);
      const [srvRunning, setSrvRunning] = React.useState(false);
      const [prog, setProg] = React.useState('');
      /* 「🌐 采集浏览器」状态条(见下面 brBar): 采集必须有浏览器, 但面板以前没有启停入口 */
      const [br, setBr] = React.useState(null);
      const [brMsg, setBrMsg] = React.useState('');
      /* 窗口形态(无头/离屏/可见窗口): 初始值取后端记住的偏好, 没读到就先按"可见窗口"——用户点「🪟 打开采集窗口」就是这个意图 */
      const [brMode, setBrMode] = React.useState('visible');
      React.useEffect(function () {
        props.api('/api/browser/mode', 'GET', null).then(function (r) {
          const m = (r && r.json && r.json.mode) || '';
          if (m === 'headless' || m === 'offscreen' || m === 'visible') setBrMode(m);
        }).catch(function () {});
      }, []);
      const pullBr = function () { return props.api('/api/browser/status', 'GET', null).then(function (r) { if (r && r.ok && r.json) { setBr(r.json); return r.json } return null; }).catch(function () { return null }); };
      /** 启停是异步的(后端立即回 starting) → 轮询 status 直到成真, 不猜时间 */
      const pollBr = function (tries, gap) {
        const n = tries || 1;
        return pullBr().then(function (st) {
          if (n <= 1 || (st && st.running)) return st;
          return new Promise(function (res) { setTimeout(res, gap || 1500) }).then(function () { return pollBr(n - 1, gap) });
        });
      };
      React.useEffect(function () { pullBr(); const t = setInterval(pullBr, 6000); return function () { clearInterval(t) }; }, []);
      /* 「📷 看画面」: 采集跑在无头浏览器里(屏幕上没有窗口), 这里按需拉一张当前标签的截图。
       *   后端 /api/browser/shot 返回的是 { data: "data:image/jpeg;base64,..." } —— 直接塞给 <img> 即可。 */
      const [shot, setShot] = React.useState(null);
      const shotIdx = React.useRef(0);
      const pullShot = function (i) {
        const idx = (i == null) ? shotIdx.current : i;
        shotIdx.current = idx;
        return props.api('/api/browser/shot?i=' + idx + '&scale=0.5&q=55', 'GET', null).then(function (r) {
          const j = (r && r.json) || {};
          if (!j.ok || !j.data) { setShot({ err: j.error || '取不到画面(采集浏览器可能没在跑)' }); return null }
          setShot({ i: j.i, total: j.total, url: j.url, title: j.title, data: j.data, at: j.at });
          return j;
        }).catch(function (e) { setShot({ err: String((e && e.message) || e) }); return null });
      };
      React.useEffect(function () {
        if (!modal || modal.kind !== 'shot') return undefined;
        setShot(null); pullShot(0);
        const t = setInterval(function () { pullShot() }, 3000);
        return function () { clearInterval(t) };
      }, [modal && modal.kind]);
      const [logs, setLogs] = React.useState([]);
      const [collectLogs, setCollectLogs] = React.useState([]);   // 采集日志: [{at,to,mode,name,added,count}] 点击跳商品管理
      // 加载历史采集记录 (后端按商品 collectedAt 聚合的批次), 与本次会话记录合并
      const reloadCollectLogs = function () {
        return props.api('/api/collect/logs?limit=80', 'GET', null).then(function (r) {
          const hist = (r && r.ok && r.json && Array.isArray(r.json.logs)) ? r.json.logs : [];
          setCollectLogs(function (cur) {
            // 会话内记录(带新增数)优先保留; 历史部分每次以接口为准重建, 只补会话记录未覆盖的批次
            const sessionLogs = cur.filter(function (g) { return !g.history; });
            const overlap = function (a1, a2, b1, b2) { return a1 <= b2 && b1 <= a2; };
            const toLocal = function (s) {
              const d = new Date(String(s).replace(' ', 'T') + ':00Z');
              if (isNaN(d.getTime())) return s;
              const p2 = function (n) { return (n < 10 ? '0' : '') + n; };
              return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
            };
            const histLogs = hist.filter(function (lg) {
              return !sessionLogs.some(function (g) { return overlap(g.fromUtc, g.toUtc, lg.from, lg.to); });
            }).map(function (lg) {
              return { fromUtc: lg.from, toUtc: lg.to, atLocal: toLocal(lg.from), mode: lg.source, name: lg.name, added: null, count: lg.count, productCount: lg.count, history: true };
            });
            return sessionLogs.concat(histLogs).sort(function (a, b) { return (a.fromUtc < b.fromUtc ? 1 : -1); }).slice(0, 80);
          });
          return hist.length;
        }).catch(function () { return 0; });
      };
      // ── 采集报告: 「采集记录」里按批次时间窗从后端取明细 ─────────────────────
      // 明细(店铺谁成功/每个品牌页剔除多少他牌/过滤条件/错误)由后端在采集结束时落盘到
      // data/collect-reports.json, 所以重启后端、刷新页面都还在 —— 不再只是内存里的一次性弹窗。
      const openReport = function (g) {
        const q = '/api/collect/report?from=' + encodeURIComponent(g.fromUtc || '') + '&to=' + encodeURIComponent(g.toUtc || '');
        setModal({ kind: 'report', loading: true, title: '采集报告 · ' + (g.atLocal || ''), g: g, reports: [] });
        return props.api(q, 'GET', null).then(function (r) {
          const reps = (r && r.ok && r.json && Array.isArray(r.json.reports)) ? r.json.reports : [];
          setModal({ kind: 'report', loading: false, title: '采集报告 · ' + (g.atLocal || ''), g: g, reports: reps });
          return reps.length;
        }).catch(function (e) {
          setModal({ kind: 'report', loading: false, error: String((e && e.message) || e), title: '采集报告 · ' + (g.atLocal || ''), g: g, reports: [] });
          return 0;
        });
      };
      const repChip = function (n, label, color) {
        return h('span', { style: { background: '#26262e', border: '1px solid #3a3a44', borderRadius: 7, padding: '3px 9px', marginRight: 6, marginBottom: 5, display: 'inline-block', fontSize: 12 } },
          h('b', { style: { color: color || '#8ab4ff' } }, String(n == null ? 0 : n)), ' ',
          h('span', { style: { color: '#9aa4b2' } }, label));
      };
      const repTbl = function (head, rows) {
        const th = { textAlign: 'left', padding: '4px 8px', color: '#9aa4b2', fontWeight: 600, borderBottom: '1px solid #3a3a44', whiteSpace: 'nowrap' };
        const td = { padding: '4px 8px', borderBottom: '1px dashed #2a2a30', whiteSpace: 'nowrap', fontSize: 12 };
        return h('table', { style: { width: '100%', borderCollapse: 'collapse', marginTop: 5 } },
          h('thead', null, h('tr', null, head.map(function (x, i) { return h('th', { key: i, style: th }, x); }))),
          h('tbody', null, rows.map(function (r, i) { return h('tr', { key: i }, r.map(function (c, j) { return h('td', { key: j, style: td }, c); })); })));
      };
      // 报告正文: 汇总 → 店铺明细 → 品牌明细(含剔除他牌) → 过滤条件 → 错误
      const reportChildren = function (md) {
        const out = [];
        if (md.loading) return [h('div', { className: 'zywb-note' }, '⏳ 正在读取采集报告…')];
        if (md.error) out.push(h('div', { style: { color: '#f28b8b', marginBottom: 8 } }, '✗ 读取失败: ' + md.error));
        const g = md.g || {};
        const reps = md.reports || [];
        if (!reps.length) {
          out.push(h('div', { style: { marginBottom: 6 } }, '这次采集没有留存的明细报告（报告落盘是从本版本开始的，之前的批次没有）。'));
          out.push(h('div', { className: 'zywb-note' }, '采集记录聚合到的商品数: ' + (g.productCount || g.count || 0) + ' 个 · ' + (g.name || '') + (g.added != null ? ' · 新增 ' + g.added : '')));
          out.push(h('div', { className: 'zywb-note', style: { marginTop: 8 } }, '从现在起每次采集都会自动留报告, 下次采集完再回这里看即可。'));
          return out;
        }
        reps.forEach(function (rep, idx) {
          const s = rep.summary || {};
          const brands = rep.brands || [];
          const shops = rep.shops || [];
          const mixedTotal = brands.reduce(function (n, b) { return n + (b.mixed || 0); }, 0);
          if (idx) out.push(h('div', { style: { borderTop: '1px solid #3a3a44', margin: '16px 0 12px' } }));
          out.push(h('div', { style: { fontWeight: 700, fontSize: 13.5, marginBottom: 6 } },
            '● ' + (rep.name || rep.mode || '采集')
            + ' · ' + (rep.fromUtc || rep.at || '') + ' → ' + String(rep.toUtc || '').slice(11) + ' UTC'
            + (rep.failed ? ' · ✗ 失败' : '')
            + (rep.rebuilt ? ' · (重建)' : '')));
          // 汇总
          const chips = [];
          if (s.links != null) chips.push(repChip(s.links, '条链接'));
          if (s.sellers != null) chips.push(repChip(s.sellers, '个卖家'));
          if (s.shopProducts != null) chips.push(repChip(s.shopProducts, '店铺商品'));
          if (s.candidates != null) chips.push(repChip(s.candidates, '候选商品'));
          if (s.brands != null) chips.push(repChip(s.brands, '个品牌'));
          if (s.brandProducts != null) chips.push(repChip(s.brandProducts, '品牌商品'));
          if (s.added != null) chips.push(repChip(s.added, '新增入库', '#5fd08a'));
          if (s.skipped != null && s.skipped) chips.push(repChip(s.skipped, '筛选跳过', '#e0b25c'));
          if (mixedTotal) chips.push(repChip(mixedTotal, '剔除他牌', '#e0b25c'));
          if (s.mismatch != null && s.mismatch && !mixedTotal) chips.push(repChip(s.mismatch, '品牌不符', '#e0b25c'));
          // ★ 插件未登录(只提示, 采集没停)
          const pLogin = rep.pluginLogin || null;
          if (pLogin && pLogin.notLogged > 0) chips.push(repChip(pLogin.notLogged, '插件未登录·卡片缺字段', '#e0b25c'));
          if (s.elapsedSec != null) chips.push(repChip(s.elapsedSec + 's', '耗时'));
          out.push(h('div', null, chips));
          out.push(h('div', { className: 'zywb-note', style: { marginBottom: 4 } }, '过滤条件: ' + (rep.filters || '无过滤') + (s.site ? ' · 站点 ' + String(s.site).toUpperCase() : '')));
          if (rep.notify && rep.notify.body) out.push(h('div', { className: 'zywb-note', style: { marginBottom: 6 } }, rep.notify.body));
          // ★ 插件未登录: 采集面板/报告里提示, 但采集没有因此中断(字段缺失, 商品照样入库)
          if (pLogin && pLogin.notLogged > 0) {
            out.push(h('div', {
              style: { marginBottom: 6, padding: '6px 8px', borderRadius: 4, background: 'rgba(224,178,92,.12)', border: '1px solid rgba(224,178,92,.45)', color: '#e0b25c', fontSize: 12.5 },
            }, '⚠ 采集浏览器里的「智赢」插件未登录: ' + pLogin.notLogged + '/' + (pLogin.cards || 0)
              + ' 张商品卡缺少 卖家 / 品牌 / 排名 等字段（涉及 ' + (pLogin.pages || 0) + ' 个列表页）。'
              + '采集没有中断、商品已按可见字段入库；登录插件后重跑即可补齐这些字段。'));
          }
          // ★ 剔除他牌明细: 必须在「品牌明细」之前算出来(表格里的剔除数列要用它做成链接)
          const mixedGroups = Array.isArray(rep.mixed) ? rep.mixed : [];
          const mixedItemsAll = mixedGroups.reduce(function (n, g) { return n + ((g.items || []).length); }, 0);
          const mixedCountAll = mixedGroups.reduce(function (n, g) { return n + (g.count || (g.items || []).length); }, 0);
          // 店铺明细
          if (shops.length) {
            out.push(h('div', { style: { fontWeight: 600, marginTop: 8 } }, '🏬 店铺明细 (' + shops.length + ')'));
            out.push(repTbl(['', '店铺', '站点', '商品', '入库', '过滤跳过', '页/总', '备注'], shops.map(function (x) {
              return [x.ok === false ? '✗' : '✓',
                x.name || x.sellerId || '-', String(x.site || '').toUpperCase(),
                String(x.collected == null ? '-' : x.collected), String(x.added == null ? '-' : x.added),
                String(x.skipped || 0), (x.pages || 0) + '/' + (x.total || '-'),
                h('span', { style: { color: x.err ? '#f28b8b' : '#9aa4b2' } }, x.err || x.addressNote || x.err_none || '')];
            })));
          }
          // 品牌明细 (剔除他牌在这里)
          if (brands.length) {
            out.push(h('div', { style: { fontWeight: 600, marginTop: 10 } }, '🏷 品牌明细 (' + brands.length + ') — 剔除他牌 = 品牌页上判定不是该品牌而丢弃的商品数'));
            out.push(repTbl(['品牌', '保留', '剔除他牌', '入库', '品牌页', '备注'], brands.map(function (b) {
              const warn = (b.mixed != null && b.mixed > 0 && b.collected != null && b.mixed >= b.collected);
              // 剔除他牌: 有明细就做成可点的链接(直接打开该品牌第一个被剔除的商品)
              const grp = mixedGroups.filter(function (g) { return String(g.brand) === String(b.brand) })[0];
              const firstItem = grp && (grp.items || [])[0];
              return [b.brand || '-',
                String(b.collected == null ? (b.kept == null ? '-' : b.kept) : b.collected),
                firstItem ? h('span', {
                  className: 'zyp-lnk', 'data-mixed-first': String(b.brand || ''), style: { cursor: 'pointer', fontWeight: 600 },
                  title: '打开该品牌被剔除的第一个商品 (' + firstItem.asin + ') · 完整列表见下方「🚫 剔除的他牌商品」',
                  onClick: function () { openExternal(firstItem.url || (amzHostOf(grp.site) + '/dp/' + firstItem.asin), firstItem.asin); },
                }, String(b.mixed == null ? '-' : b.mixed) + ' ↗') : String(b.mixed == null ? '-' : b.mixed),
                String(b.added == null ? '-' : b.added),
                b.cards != null ? (b.cards + ' 张卡片') : (b.listCount != null ? (b.listCount + ' 个') : '-'),
                h('span', { style: { color: b.error ? '#f28b8b' : (warn ? '#e0b25c' : '#9aa4b2') } },
                  b.error ? String(b.error).slice(0, 60) : (warn ? '⚠ 剔除 ≥ 保留（品牌名太通用 / 链接可能不是该品牌页）' : (b.brandSource ? '来源 ' + b.brandSource : '')))];
            })));
          }
          // ★ 剔除他牌的商品: 逐条给出亚马逊直达链接(点 ASIN / 标题 / ⧉ 都能跳)
          if (mixedItemsAll || mixedCountAll) {
            out.push(h('div', { style: { fontWeight: 600, marginTop: 10 } }, '🚫 剔除的他牌商品 (' + Math.max(mixedCountAll, mixedItemsAll) + ') — 点 ASIN/标题直达亚马逊商品页'));
            out.push(h('div', { className: 'zywb-note', style: { marginBottom: 2 } },
              '品牌页上品牌名与目标品牌不一致而被丢弃的商品（不计入入库）。'
              + (mixedItemsAll < mixedCountAll ? '报告里留存了 ' + mixedItemsAll + ' 条明细，其余只计数。' : '')
              + '剔除明细从本版本开始记录, 续跑前的批次只有计数。'));
            mixedGroups.forEach(function (g) {
              const items = g.items || [];
              const host = amzHostOf(g.site);
              out.push(h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, marginBottom: 2 } },
                h('span', { style: { fontWeight: 600, fontSize: 12.5 } }, '🏷 ' + (g.brand || '-') + (g.site ? ' · ' + String(g.site).toUpperCase() : '')),
                h('span', { className: 'zywb-note' }, '剔除 ' + (g.count || items.length) + ' 个' + (items.length < (g.count || items.length) ? ' (列出前 ' + items.length + ' 条)' : '')),
                items.length ? h('button', {
                  className: 'zywb-btn', style: { padding: '2px 8px', fontSize: 11.5 }, title: '把该品牌被剔除的商品全部在浏览器里打开(最多 10 个)',
                  onClick: function () {
                    items.slice(0, 10).forEach(function (it, k) {
                      setTimeout(function () { openExternal(it.url || (host + '/dp/' + it.asin), it.asin + ' ' + String(it.title || '').slice(0, 16)); }, k * 350);
                    });
                  },
                }, '↗ 打开前 10 个') : null));
              if (!items.length) {
                out.push(h('div', { className: 'zywb-note' }, '(这一批没有留存明细 —— 报告记录是从本版本开始的；数量以「剔除他牌」计数为准)'));
                return;
              }
              out.push(repTbl(['ASIN', '实际品牌', '目标品牌', '标题', '链接'], items.map(function (it) {
                const url = it.url || (host + '/dp/' + it.asin);
                const go = function (e) { if (e && e.stopPropagation) e.stopPropagation(); openExternal(url, it.asin + ' ' + String(it.title || '').slice(0, 24)); };
                return [
                  h('span', { className: 'zyp-lnk', 'data-mixed-asin': String(it.asin || ''), style: { cursor: 'pointer', fontWeight: 600 }, title: '在亚马逊打开 ' + it.asin, onClick: go }, String(it.asin || '-') + ' ↗'),
                  it.brand || '(未读到)',
                  g.target || g.brand || '-',
                  h('span', { style: { cursor: 'pointer', color: '#8ab4ff', display: 'inline-block', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', verticalAlign: 'bottom' }, title: String(it.title || ''), onClick: go }, String(it.title || '(无标题)').slice(0, 60)),
                  h('span', { className: 'zyp-lnk', 'data-mixed-open': String(it.asin || ''), style: { cursor: 'pointer' }, title: url, onClick: go }, '⧉ 打开 ↗'),
                ];
              })));
            });
          }
          // 错误
          const errs = rep.errors || [];
          if (errs.length) {
            out.push(h('div', { style: { fontWeight: 600, marginTop: 10, color: '#f28b8b' } }, '⚠ 错误 (' + errs.length + ')'));
            out.push(h('div', { style: { fontSize: 12, lineHeight: 1.7 } }, errs.slice(0, 12).map(function (e, i) {
              return h('div', { key: i }, '· ' + (e.url || e.brand || e.sellerId || e.stage || '') + ': ' + (e.err || e.rawError || ''));
            })));
          }
        });
        out.push(h('div', { className: 'zywb-note', style: { marginTop: 12, borderTop: '1px solid #3a3a44', paddingTop: 8 } },
          '报告落盘在 data/collect-reports.json · 接口 GET /api/collect/report?from=&to= · 列表 GET /api/collect/reports'));
        return out;
      };
      const upd = function (k) { return function (e) { setF(function (o) { return Object.assign({}, o, { [k]: e.target.value }); }); }; };
      // 采集过滤条件 = 统一 filter 对象 (后端 buildCollectFilter 直接读 j.filter)
      const cfValues = function () {
        const custom = f.customSites ? f.customSites.split(/[,， ]+/).filter(Boolean).map(function (x) { return x.toLowerCase(); }) : [];
        const sites = f.sites.concat(custom).filter(function (v, i, a) { return a.indexOf(v) === i; });
        const filt2 = Object.assign({}, filt);
        if (sites.length && !filt2.sites.length) filt2.sites = sites;   // 过滤未指定站点时沿用采集目标站点
        return { filter: filt2 };
      };
      // 过滤条件描述: 由后端 /api/filter/desc 统一生成 (与通知/结果弹窗同一份文案)
      React.useEffect(function () {
        props.api('/api/filter/desc?filter=' + encodeURIComponent(JSON.stringify(filt)), 'GET', null).then(function (r) {
          if (r && r.ok && r.json) setFdesc(r.json.desc || '无过滤');
        }).catch(function () { setFdesc('无过滤'); });
      }, [JSON.stringify(filt)]);
      const activeDesc = function () { return fdesc; };
      const toggleSite = function (s) { setF(function (o) { const arr = o.sites.indexOf(s) >= 0 ? o.sites.filter(function (x) { return x !== s; }) : o.sites.concat([s]); return Object.assign({}, o, { sites: arr }); }); };
      const clearAll = function () { setF(F0()); setCat2List([]); };
      const reloadRules = function () { return props.api('/api/collect-rules', 'GET', null).then(function (r) { if (r && r.ok && r.json && Array.isArray(r.json.rules)) { setRules(r.json.rules); return r.json.rules; } return []; }).catch(function () { return []; }); };
      const loadRuleToUI = function (rule) {
        if (!rule) return;
        // 规则里的过滤条件: 优先用后端已换算好的 canonical (旧规则自动兼容), 否则直接读 filter
        const canon = rule.canonical || (rule.filter && rule.filter.fulfill !== undefined ? rule.filter : null);
        if (canon) { setFilt(Object.assign(NF(), canon)); }
        else { setFilt(NF()); }
        const fl = rule.filter || {};
        // 采集目标站点 (不是过滤条件: 决定去哪里采) 仍走旧字段
        let sites = Array.isArray(fl.filterSites) ? fl.filterSites.slice() : (rule.site ? [rule.site] : ['de']);
        const known = sites.filter(function (s) { return ALL_SITES.indexOf(s) >= 0; });
        const custom = sites.filter(function (s) { return ALL_SITES.indexOf(s) < 0; }).join(',');
        let cat1 = '', cat2 = '', cat2arr = [];
        const nf = F0();
        nf.sites = known.length ? known : ['de'];
        nf.customSites = custom;
        setF(nf); setCat2List(cat2arr);
        setRuleInfo('已加载规则「' + rule.name + '」' + (canon ? '' : ' (旧规则无过滤条件)'));
      };
      // ★ 2026-09: 采集面板原来只定义 loadCatTree 却从不调用 → 统一过滤面板的「类目(排除法)」chips
      //   一直显示"暂无一级类目数据"(等于没有类目排除)。这里与商品管理一致, 挂载时就拉一次类目树。
      React.useEffect(function () { reloadRules(); reloadCollectLogs(); loadCatTree(); }, []);
      // 常驻轮询服务端真实进度: 采集可能由别处发起(API/工具/另一标签页), 停止按钮必须按服务端状态启用
      React.useEffect(function () {
        const poll = function () { props.api('/api/collect/progress', 'GET', null).then(function (r) {
          if (r && r.ok && r.json && r.json.running) {
            const g = r.json; const p = [];
            setSrvRunning(true);
            if (g.step) p.push(g.step);
            if (g.startedAt) p.push(Math.round((Date.now() - g.startedAt) / 1000) + 's');
            if (g.items != null) p.push('采集 ' + g.items);
            if (g.added != null) p.push('新增 ' + g.added);
            if (g.page != null && g.pages != null) p.push('第 ' + g.page + '/' + g.pages + ' 页');
            if (g.detailDone != null && g.detailTotal != null) p.push('详情 ' + g.detailDone + '/' + g.detailTotal);
            if (g.round != null && g.rounds != null) p.push('第 ' + g.round + '/' + g.rounds + ' 轮');
            if (g.batch != null && g.batches != null) p.push('批次 ' + g.batch + '/' + g.batches + (g.batchesFailed ? ' (失败 ' + g.batchesFailed + ')' : ''));
            if (g.shopsDone != null && g.shopsTotal != null) p.push('店铺 ' + g.shopsDone + '/' + g.shopsTotal);
            if (g.taskId) p.push('任务 ' + g.taskId);
            if (g.mode) p.push('[' + g.mode + ']');
            setProg('⏳ ' + p.join(' · '));
          } else { setSrvRunning(false); setProg(''); }
        }).catch(function () {}); };
        poll();
        const off = ctx.interval(poll, 2000);
        return function () { if (typeof off === 'function') { try { off(); } catch (e) {} } };
      }, []);
      // ── 多链接采集任务（断点续跑）: 任务卡的状态与操作 ──────────────────────
      const [linkJobs, setLinkJobs] = React.useState({ list: [], resumable: null, dir: '' });
      const reloadLinkJobs = function () {
        return props.api('/api/collect/link-jobs?limit=6', 'GET', null).then(function (r) {
          if (r && r.ok && r.json) setLinkJobs({ list: r.json.jobs || [], resumable: r.json.resumable || null, dir: r.json.dir || '' });
          return r && r.json;
        }).catch(function () { return null; });
      };
      const pauseHint = function (reason) {
        return ({
          captcha: '上次卡在机器人验证: 请在采集用的 Edge 里手动过验证(输入验证码)',
          'cdp-down': '上次 CDP/Edge 断了: 请确认采集用 Edge 还开着 9222 调试端口',
          'user-stop': '上次是手动停止',
          error: '上次异常中断(原因见采集日志)',
        })[reason] || ('上次暂停: ' + reason);
      };
      /**
       * 续跑 / 重跑失败 / 重跑跳过: 只发 jobId + filterKeep=1, 页数与筛选沿用任务里存的原参数(坑 28/29)
       * @param mode 'resume' 继续未跑完 | 'failed' 只重跑失败 | 'skipped' 把 skipped 也捞回一起跑
       *   'skipped' 用两步: 先 /retry {includeSkipped:true} 把单元重置成 pending, 再 resume
       *   (中途停止时没跑的单元会被静默标成 skipped, 老版本捞不回来 → 任务永远显示 1/15)
       */
      const doResumeTask = function (mode) {
        if (mode === true) mode = 'failed';                     // 兼容旧调用 doResumeTask(true)
        if (!mode) mode = 'resume';
        const res = linkJobs.resumable;
        const onlyFailed = mode === 'failed';
        const withSkipped = mode === 'skipped';
        if (!res) { setModal({ kind: 'alert', title: '没有可续跑的任务', rows: ['当前没有「未跑完」或「有失败/跳过单元」的多链接采集任务。'] }); return; }
        if (run || srvRunning) { setModal({ kind: 'alert', title: '已有采集在跑', rows: ['请先点「⏹ 停止」或等当前采集结束。'] }); return; }
        const jobId = res.id;
        const cf = cfValues();                                  // 服务端因 filterKeep 会忽略筛选, 但字段仍要带上
        const label = withSkipped ? '重跑跳过单元' : (onlyFailed ? '重跑失败单元' : '继续上次任务');
        const kick = function () {
          const body = { jobId: jobId, filterKeep: 1 };
          if (onlyFailed) body.onlyFailed = 1;
          Object.keys(cf).forEach(function (k) { body[k] = cf[k]; });
          setRun({ mode: 'shoplinks' }); setProg('⏳ ' + label + ' ' + jobId + '…');
          setLogs(function (ls) { return ls.concat(['▶ ' + new Date().toLocaleTimeString('zh-CN') + ' ' + label + ' ' + jobId + ' · 待办 ' + (res.pending || 0) + ' / 失败 ' + (res.failed || 0) + (withSkipped ? ' / 跳过 ' + (res.skipped || 0) : '')]); });
          props.api('/api/collect/shop-links', 'POST', body).then(function (r) {
            setRun(null); setProg('');
            if (!(r && r.ok && r.json && r.json.started)) {
              const msg = (r && r.json && r.json.error) || (r && r.error) || '未知错误';
              setModal({ kind: 'alert', title: '续跑失败', rows: ['✗ ' + msg] });
              return;
            }
            reloadLinkJobs();
            waitLinksDone({ name: '多链接采集' });
          }).catch(function (e) { setRun(null); setProg(''); setModal({ kind: 'alert', title: '续跑失败', rows: ['✗ ' + String(e && e.message || e)] }); });
        };
        if (!withSkipped) { kick(); return; }
        // 重跑跳过 = 两步: ① 把 skipped 重置回 pending ② 再发一次续跑
        setProg('⏳ 正在把 ' + (res.skipped || 0) + ' 个跳过单元放回待办…');
        props.api('/api/collect/link-job/retry', 'POST', { jobId: jobId, includeSkipped: true }).then(function (r) {
          const n = (r && r.json && r.json.reset) || 0;
          setLogs(function (ls) { return ls.concat(['↻ 重跑跳过: 已把 ' + n + ' 个单元放回待办 (' + jobId + ')']); });
          reloadLinkJobs();
          kick();
        }).catch(function (e) { setRun(null); setProg(''); setModal({ kind: 'alert', title: '重跑跳过失败', rows: ['✗ ' + String(e && e.message || e)] }); });
      };
      const doRemoveTask = function () {
        const res = linkJobs.resumable;
        if (!res) return;
        setModal({ kind: 'alert', title: '删除任务', rows: ['确定删除任务 ' + res.id + ' 吗? (已入库的商品不受影响)'],
          buttons: [{ label: '取消', onClick: function () { setModal(null); } }, { label: '确定删除', primary: true, onClick: function () {
            setModal(null);
            props.api('/api/collect/link-job/remove', 'POST', { jobId: res.id }).then(function () {
              setLogs(function (ls) { return ls.concat(['🗑 已删除任务 ' + res.id]); });
              reloadLinkJobs();
            }).catch(function (e) { setModal({ kind: 'alert', title: '删除失败', rows: [String((e && e.message) || e)] }); });
          } }] });
      };
      // 多链接采集(异步)收尾: 轮询进度 → 取 links-result → 弹结果 + 写采集日志 + 刷任务卡
      const waitLinksDone = function (meta) {
        meta = meta || {};
        const nm = meta.name || '多链接采集';
        const waitDone = function () {
          props.api('/api/collect/progress', 'GET', null).then(function (p) {
            if (p && p.ok && p.json && p.json.running) { setTimeout(waitDone, 3000); return; }
            props.api('/api/collect/links-result', 'GET', null).then(function (rr) {
              const g = (rr && rr.ok && rr.json) || {};
              const st = g.steps || {};
              const rows = [];
              rows.push('链接 ' + (g.links || meta.links || 0) + ' 条 → 卖家 ' + ((st.sellers && st.sellers.count) || 0) + ' 个');
              if (g.taskId) rows.push('任务 ' + g.taskId + (g.taskStatus ? ' (' + g.taskStatus + ')' : '') + (g.pending ? ' · 未完成 ' + g.pending + ' 条' : ''));
              // 暂停原因优先显示 —— 用户最需要先知道"为什么停了、我该做什么"
              if (g.pauseReason) {
                rows.push('⏸ 暂停原因: ' + ({ 'cdp-down': 'Edge 调试端口连不上 (先完全退出所有 msedge.exe, 再运行「启动采集浏览器.bat」, 浏览器打开 http://127.0.0.1:9222/json/version 能返回 JSON 才算就绪)', captcha: '遇到机器人验证/登录墙 (在采集用的 Edge 里手动过验证后再继续)', error: '任务异常中断 (任务已落盘, 可继续)' }[g.pauseReason] || g.pauseReason));
              }
              if (g.batches && g.batches.length) {
                let okB = 0, badB = 0;
                var stName = { done: '成功', failed: '失败', interrupted: '中断(可续跑)', running: '运行中', pending: '未开始', skipped: '跳过' };
                g.batches.forEach(function (b) { if (b.status === 'done') okB++; else badB++; });
                rows.push('批次 ' + okB + '/' + g.batches.length + ' 成功' + (badB ? ' · 失败/中断 ' + badB + ' 批' : ''));
                g.batches.filter(function (b) { return b.status !== 'done'; }).slice(0, 6).forEach(function (b) {
                  rows.push('⚠ 批次 ' + b.index + '/' + g.batches.length + ' ' + (stName[b.status] || b.status) +
                    (b.from != null ? ' (第 ' + b.from + '-' + b.to + ' 条)' : '') + (b.error ? ' — ' + b.error : ''));
                });
              }
              rows.push('新增入库 ' + (st.totalAdded != null ? st.totalAdded : '-') + ' · 耗时 ' + (g.elapsedSec || 0) + 's');
              if (g.error) rows.push('✗ ' + g.error);
              (st.shops || []).forEach(function (s) {
                rows.push((s.ok ? '✓ ' : '✗ ') + (s.name || s.sellerId) + ' — 商品 ' + (s.collected || 0) + ' / 入库 ' + (s.added || 0) + (s.skipped ? ' / 过滤跳过 ' + s.skipped : '') + (s.err ? ' — ' + s.err : ''));
              });
              (g.errors || []).slice(0, 8).forEach(function (e) { rows.push('⚠ ' + (e.url || e.brand || e.sellerId || e.stage || '') + ': ' + e.err); });
              if (rows.length <= 3) rows.push('(无店铺明细 — 可能未提取到跟卖卖家, 或全部被过滤条件跳过)');
              if (g.pending) rows.push('▶ 未跑完: 用任务卡上的「⏯ 继续上次任务」接着跑(已完成的会跳过)');
              if (g.failed) rows.push('▶ 有 ' + g.failed + ' 个失败单元: 用「↻ 重跑失败」单独重试');
              setModal({ kind: 'alert', title: nm + ' 结果', rows: rows });
              setLogs(function (ls) { return ls.concat(['✔ ' + new Date().toLocaleTimeString('zh-CN') + ' ' + nm + ' 完成 · 新增 ' + (st.totalAdded != null ? st.totalAdded : 0) + (g.pending ? ' · 未完成 ' + g.pending + ' 条(可续跑)' : '')]); });
              reloadLinkJobs();
              reloadCollectLogs();
            }).catch(function (e) { setModal({ kind: 'alert', title: nm + ' 结果', rows: ['✗ 取结果失败: ' + ((e && e.message) || e)] }); });
          }).catch(function () { setTimeout(waitDone, 3000); });
        };
        setTimeout(waitDone, 2000);
      };
      // 任务卡: 进页面加载一次; 采集进行中每 8 秒刷一次
      React.useEffect(function () {
        reloadLinkJobs();
        const off = ctx.interval(function () { if (run || srvRunning) reloadLinkJobs(); }, 8000);
        return function () { if (typeof off === 'function') { try { off(); } catch (e) {} } };
      }, [run, srvRunning]);
      const doCollect = function (modeObj, vals) {
        const body = {};
        modeObj.fields.forEach(function (fd) {
          let v = vals[fd.f];
          if (fd.type === 'number') { const pv = parseInt(v, 10); v = (v === '' || isNaN(pv)) ? '' : pv; }
          body[fd.f] = v;
        });
        if (body.asins != null && typeof body.asins === 'string') { const NL = String.fromCharCode(10); body.asins = body.asins.split(NL).join(',').split(/[,， ]+/).filter(Boolean); }
        if (body.urls != null && typeof body.urls === 'string') { const NL2 = String.fromCharCode(10); body.urls = body.urls.split(NL2).join(',').split(/[,， ]+/).map(function (x) { return x.trim(); }).filter(Boolean); }
        const isAmazon = function (u) { return /^https:/.test(u) && u.indexOf('amazon.') > 0; };
        const warn = function (msg) { setModal({ kind: 'alert', title: '⚠️ 校验失败', rows: [msg] }); };
        if (modeObj.mode === 'shop' && !isAmazon(String(body.url || ''))) { warn('无效链接 — 请输入 amazon 商品链接'); return; }
        /* ★ 2026-09-27 新增三种模式的校验 —— 必须在发请求前拦住, 否则后端只会给一句 400/500
         *   【保留】列表页这两条已从面板撤掉(用户要求), 但这两个 mode 的校验/下面的站点剔除与布尔转换
         *   故意留着: 底层路由与工具还在用, 哪天要把卡片放回面板, 贴回 MODES 定义即可直接生效。 */
        if ((modeObj.mode === 'list-direct' || modeObj.mode === 'list-filtered') && !/^https:\/\/(www\.)?amazon\./.test(String(body.url || ''))) {
          warn('无效链接 — 请填 amazon 列表页链接 (搜索页 https://www.amazon.xx/s?k=… 或类目页 …/b?node=…)'); return;
        }
        if (modeObj.mode === 'followaod') {
          const bad = (body.urls || []).filter(function (u) { return !(/^B0[A-Z0-9]{8}$/.test(u) || /^https:\/\/(www\.)?amazon\./.test(u)); });
          if (!body.urls || !body.urls.length) { warn('请输入商品 (ASIN 或 amazon 商品链接, 每行一个)'); return; }
          if (bad.length) { warn('这些不像 ASIN 也不是 amazon 链接: ' + bad.slice(0, 3).join(' / ')); return; }
        }
        if (modeObj.mode === 'parallel' && (body.urls || []).some(function (u) { return !isAmazon(String(u)); })) { warn('存在非 amazon 链接'); return; }
        if ((modeObj.mode === 'category' || modeObj.mode === 'bulk') && !String(body.keyword || '').trim() && !String(body.category || '').trim()) { warn('请输入关键词或类目'); return; }
        if (modeObj.mode === 'catmenu' && !String(body.category || '').trim()) { warn('请输入大类目名'); return; }
        if (modeObj.mode === 'batch' && (!body.asins || !body.asins.length)) { warn('请输入商品 ASIN 或链接'); return; }
        if (modeObj.mode === 'parallel' && (!body.urls || !body.urls.length)) { warn('请输入商品 ASIN 或链接'); return; }
        if (modeObj.mode === 'shoplinks' && (!body.urls || !body.urls.length)) { warn('请输入链接（每行一条）。支持店铺列表页 /s?me= · 卖家主页 /sp?seller= · 商品页 /dp/ASIN'); return; }
        const cf = cfValues();
        const payload = Object.assign({}, cf);
        // payload.filter = 统一过滤条件; 采集目标站点由 body.site 决定 (不是过滤条件)
        const targetSites = (payload.filter && payload.filter.sites && payload.filter.sites.length) ? payload.filter.sites : f.sites.concat(f.customSites ? f.customSites.split(/[,， ]+/).filter(Boolean) : []);
        if (modeObj.mode === 'category' || modeObj.mode === 'bulk' || modeObj.mode === 'catmenu' || modeObj.mode === 'brand-batch') body.site = targetSites[0] || 'de';
        /* ★ 列表页筛选采集: 站点由【链接域名】决定 → 必须把 filter.sites 去掉。【保留】—— 该模式已从面板撤掉, 见上方说明。
         *   否则"链接是 amazon.co.uk、采集目标站点还停在德国"时, 站点过滤会把英国商品全筛掉(命中 0 且看不出原因)。
         *   顺序要紧: 必须在这个合并【之后】做(合并会拿 payload.filter 覆盖), 而且要克隆再删 ——
         *   body.filter 与 React state 是同一个对象, 直接 delete 会把用户界面上的站点筛选也清掉。 */
        Object.keys(payload).forEach(function (k) { body[k] = payload[k]; });
        if (modeObj.mode === 'list-filtered' && body.filter) {
          const f2 = Object.assign({}, body.filter); delete f2.sites; delete f2.site; body.filter = f2;
        }
        /* ★ aod/panel/jumpDetail 这类开关后端判的是 `!== false` / `=== true||1||'1'`,
         *   字符串 '0' 会被前者当成真 → 必须转成真布尔, 否则"关"不掉。【保留】同上。 */
        if (modeObj.mode === 'list-filtered') {
          body.aod = String(body.aod) !== '0';
          body.panel = String(body.panel) !== '0';
          body.jumpDetail = String(body.jumpDetail) === '1';   // 后端: opts.jumpDetail === true || 1 || '1'
        }
        setModal(null); setRun({ mode: modeObj.mode }); setProg('⏳ 启动…');
        const startedAtLocal = new Date();   // 本次采集开始时间 (本地), 用于采集日志
        setLogs(function (ls) { return ls.concat(['▶ ' + startedAtLocal.toLocaleTimeString('zh-CN') + ' 启动 ' + modeObj.name + ' · 过滤: ' + activeDesc()]); });
        props.api(modeObj.path, 'POST', body).then(function (r) {
          setRun(null); setProg('');
          // 异步采集（多链接采集）：接口立即返回 {started:true}, 真正结果要等跑完再取 links-result。
          // 进度条不用管 —— 上面那个 2 秒常驻轮询已经在显示 step/采集数/新增/店铺 x/y 了。
          if (r && r.ok && r.json && r.json.started) {
            var lk = r.json.links || 0;
            var bs = r.json.batchSize || 20;
            setLogs(function (ls) { return ls.concat(['▶ 已提交, 后台采集中 (' + lk + ' 条链接 · 每批 ' + bs + ' 条 → ' + Math.ceil(lk / bs) + ' 批' + (r.json.resume ? ' · 断点续跑' : '') + ') · 每店 ' + (r.json.shopPages || 1) + ' 页 / 每品牌 ' + (r.json.brandPages || 1) + ' 页 · 采品牌商品: ' + (r.json.collectBrands ? '是' : '否') + (r.json.jobId ? ' · 任务 ' + r.json.jobId : '')]); });
            reloadLinkJobs();                       // 任务卡立刻显示新任务
            waitLinksDone({ name: modeObj.name, links: lk });
            return;
          }
          const rows = r && r.ok ? fmtResRows(r.json) : ['✗ ' + ((r && r.error) || '采集失败, 请确认 Edge 9222 已开启')];
          /* ★ 浏览器没跑时后端只会给一句「CDP 连不上 9222」——用户实测直接卡在这里不知道点哪。
           *   这里补一句"去哪修", 并且顺手刷一下状态条。 */
          if (/CDP 连不上|9222|无可用页面标签/.test(rows.join(' '))) {
            rows.push('→ 采集浏览器没在跑: 回到本页最上面「🌐 采集浏览器」点「▶ 启动本地无头」(约 3~10 秒), 然后重跑这次采集');
            pollBr(1, 0);
          }
          setModal({ kind: 'alert', title: modeObj.name + ' 结果', rows: rows });
          setLogs(function (ls) { return ls.concat(['✔ ' + new Date().toLocaleTimeString('zh-CN') + ' ' + modeObj.name + ' 完成']); });
          // 采集日志: 记录起止时间(UTC, 与商品 collectedAt 同基准) + 采集数量, 供跳转商品管理过滤
          if (r && r.ok && r.json) {
            const g = r.json;
            const endedAtLocal = new Date();
            const toUtcMin = function (d) { return d.toISOString().slice(0, 16).replace('T', ' '); };
            const count = (g.added != null ? g.added : 0) || (g.productCount != null ? g.productCount : 0);
            setCollectLogs(function (ls) {
              return [{
                fromUtc: toUtcMin(startedAtLocal), toUtc: toUtcMin(endedAtLocal),
                atLocal: startedAtLocal.toLocaleString('zh-CN', { hour12: false }).slice(0, 16),
                mode: modeObj.mode, name: modeObj.name,
                added: g.added || 0, count: count, productCount: g.productCount || 0,
              }].concat(ls).slice(0, 50);
            });
          }
        }).catch(function (e) {
          setRun(null); setProg('');
          const msg = String(e && e.message || e);
          const rows = [msg];
          if (/CDP 连不上|9222|无可用页面标签/.test(msg)) {
            rows.push('→ 采集浏览器没在跑: 回到本页最上面「🌐 采集浏览器」点「▶ 启动本地无头」(约 3~10 秒), 然后重跑这次采集');
            pollBr(1, 0);
          }
          setModal({ kind: 'alert', title: '❌ ' + modeObj.name + '失败', rows: rows });
        });
      };
      const doStop = function () { props.api('/api/collect/stop', 'POST', {}).then(function () { setProg('⏹ 已请求停止, 当前步骤完成后退出'); }).catch(function (e) { setProg('✗ 停止失败: ' + String(e && e.message || e)); }); };
      // 采集过滤 = 统一过滤面板 (与商品管理完全相同的一个组件)
      const filterCard = h('div', { className: 'zywb-card' },
        // ★ 2026-10-02: 采集侧显式传 mode='collect' —— 面板据此显示店铺维度条件(A+店铺/品牌店铺/他牌商品/品牌店筛选);
        //   商品管理侧传 mode='product' 时这些条件不渲染(用户要求: 剔除他牌不要出现在商品管理里)。
        h(ZypFilterPanel, { value: filt, onChange: setFilt, catTree: catTree, onReloadCat: loadCatTree, mode: 'collect', tmCountryOpts: tmCountryOpts }),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, flexWrap: 'wrap' } },
          h('button', { className: 'zywb-btn', onClick: function () { setFilt(NF()); } }, '✕ 清空过滤'),
          h('span', { className: 'zywb-note' }, '当前过滤: ' + activeDesc()),
          h('span', { className: 'zywb-note', style: { marginLeft: 'auto' } }, '与商品管理筛选同一逻辑 · 被筛除的商品直接跳过(不跳详情/不入库)')));
      const ruleButtons = h('div', { style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 } },
        h('select', { className: 'zywb-input', value: ruleSel, onChange: function (e) { setRuleSel(e.target.value); }, style: { maxWidth: 240 } }, h('option', { value: '' }, '— 选择规则 —'), rules.map(function (r) { return h('option', { key: r.name, value: r.name }, r.name); })),
        h('button', { className: 'zywb-btn', onClick: function () { const def = 'FBA筛选' + new Date().toLocaleDateString('zh-CN'); setModal({ kind: 'name', def: def, hint: '将保存: 采集站点 ' + f.sites.join(',') + ' · 过滤 ' + activeDesc() }); } }, '保存当前为规则'),
        h('button', { className: 'zywb-btn', onClick: function () { if (!ruleSel) { setRuleInfo('请先选择规则'); return; } props.api('/api/collect-rules', 'GET', null).then(function (r) { if (r && r.ok && r.json) { const rule = r.json.rules.find(function (x) { return x.name === ruleSel; }); if (rule) loadRuleToUI(rule); else setRuleInfo('规则不存在'); } }); } }, '加载选中'),
        h('button', { className: 'zywb-btn', onClick: function () { if (!ruleSel) { setRuleInfo('请先选择规则'); return; } setModal({ kind: 'confirmDel', name: ruleSel }); } }, '删除选中'),
        h('span', { className: 'zywb-note zywb-ok' }, ruleInfo));
      const rulePills = h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 5 } }, rules.map(function (r) { return h('button', { key: r.name, className: 'zywb-pill' + (r.name === ruleSel ? ' on' : ''), onClick: function () { setRuleSel(r.name); loadRuleToUI(r); } }, r.name); }));
      const modeCards = MODES.map(function (m) { return h('button', { key: m.mode, onClick: function () { setModal({ kind: 'mode', mode: m }); }, disabled: !!run, style: { textAlign: 'left', display: 'block', border: '1px solid #333', background: run ? 'transparent' : 'var(--dsw-alias-bg-layer-2,#24242b)', borderRadius: 10, padding: 10, cursor: run ? 'not-allowed' : 'pointer', opacity: run ? .55 : 1 } },
        h('div', { style: { fontSize: 14, fontWeight: 600, marginBottom: 3 } }, m.icon + ' ' + m.name),
        h('div', { className: 'zywb-note' }, m.desc),
        run && run.mode === m.mode ? h('div', { className: 'zywb-note zywb-warn', style: { marginTop: 5 } }, prog) : null); });

      /* ★ 2026-09-27 「🌐 采集浏览器」状态条 —— 用户实测: 点「批量跟卖店铺采集」直接报
       *   「CDP 连不上 127.0.0.1:9222」, 而面板里【根本没有启动采集浏览器的入口】(只在网页端有),
       *   于是只能干看着报错。这里把状态+启停放到采集面板最上面一条:
       *   采集链路优先用本地无头浏览器(9333), 没跑就回落到用户的采集浏览器(9222), 两个都没有就必然报这个错。 */
      const brBar = h('div', { className: 'zywb-card', style: { padding: '8px 10px' } },
        h('div', { style: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' } },
          h('div', { className: 'zywb-h', style: { margin: 0, fontSize: 13.5 } }, '🌐 采集浏览器'),
          br ? h('span', { style: { color: br.running ? '#5fd08a' : '#f28b8b', fontWeight: 600, fontSize: 12.5 } },
            br.running
              ? ('● 运行中 · ' + (br.usingLocal
                  ? ('本地' + (br.mode === 'visible' ? '可见窗口' : (br.mode === 'offscreen' ? '离屏窗口' : '无头')))
                  : (br.activePort === br.userPort ? '你的采集浏览器' : (br.activePort === 9334 ? '浏览器壳' : 'CDP')))
                + ' ' + br.activePort + (br.browser ? ' · ' + String(br.browser).slice(0, 16) : '')
                + ((br.pages || []).length ? ' · ' + br.pages.length + ' 个标签' : ''))
              : '○ 没在跑 —— 采集会直接报「CDP 连不上」')
            : h('span', { className: 'zywb-note' }, '查询中…'),
          /* 🪟 打开采集窗口: 按记住的形态(默认可见窗口)启动, 跑着就调到前台 —— "点开就是采集在跑" */
          h('button', {
            className: 'zywb-btn', style: { padding: '3px 10px', background: '#2f6feb', borderColor: '#2f6feb', color: '#fff' },
            title: '开一个专属的采集浏览器窗口(独立 profile, 和你的日常浏览器互不影响): 没跑就按下面的"窗口形态"启动它, 已经在跑就把它调到最前面',
            onClick: function () {
              setBrMsg('⏳ 正在打开采集窗口…');
              const want = brMode || 'visible';
              props.api('/api/browser/mode', 'POST', { mode: want })
                .then(function (r) {
                  const j = (r && r.json) || {};
                  if (j.ok === false) setBrMsg('⚠ ' + (j.error || '暂时不能切窗口形态') + '(不影响: 采集窗口本身照旧可用)');
                  return props.api('/api/browser/start', 'POST', {});
                })
                .then(function () { return pollBr(15, 1500); })
                .then(function (st) {
                  if (!st || !st.running) { setBrMsg('✗ 没起来 —— 看下面的提示'); return null }
                  return props.api('/api/browser/focus', 'POST', {}).then(function (r) {
                    const j = (r && r.json) || {};
                    setBrMsg(j.ok ? ('✓ 采集窗口已打开并置顶 (' + (st.mode === 'visible' ? '可见窗口' : st.mode) + ' · CDP ' + st.activePort + ')') : ('窗口已就绪, 但没能置顶: ' + (j.error || '')));
                    return j;
                  });
                })
                .catch(function (e) { setBrMsg('✗ ' + ((e && e.message) || e)); });
            },
          }, '🪟 打开采集窗口'),
            /* ★ 2026-09-28 用户要求: 「打开本地无头」可以直接改成【直接打开浏览器壳】——
             *   点它 = 打开桌面壳(Electron 真窗口) 并让采集立刻跑在壳里(CDP 9334, 原生渲染不串流)。 */
            h('button', { className: 'zywb-btn', style: { padding: '3px 10px', background: '#2f6feb', borderColor: '#2f6feb', color: '#fff' }, title: '打开桌面浏览器壳(真窗口·原生渲染), 并让采集直接跑在它里面(CDP 9334)。和你手动操作会抢标签页, 采集时别在同一标签里操作', onClick: function () { setBrMsg('⏳ 正在打开浏览器壳并把采集切过去…(约 3~15 秒)'); (function () {
              /* 隐藏 iframe 发 GET 直连 ERP: 绕开 DSH 网关, 也不需要跨域授权(和地址栏那套同一招) */
              var fire = function (u) { try { var f = document.createElement('iframe'); f.style.display = 'none'; f.src = u; document.body.appendChild(f); setTimeout(function () { try { f.remove() } catch (e) {} }, 12000); } catch (e) {} };
              var fallback = function () {
                /* 后端还是旧代码(不认 action=shell) → 兼容做法: 先开壳, 等它就绪, 再把采集切到 9334 */
                fire('http://127.0.0.1:3088/api/browser/shell?action=start');
                setTimeout(function () { fire('http://127.0.0.1:3088/api/browser/switch?target=9334'); }, 8000);
                setBrMsg('⏳ 后端还没重启(旧代码) → 已用兼容方式: 正在打开浏览器壳并切到 9334…');
                setTimeout(function () { pollBr(24, 1500).then(function (st) { setBrMsg(st && st.activePort === 9334 ? ('✓ 采集已跑在浏览器壳里 (CDP ' + st.activePort + ')') : '⚠ 壳开了但采集目标还没切过去, 稍等一下或看下面提示'); }); }, 10000);
              };
              return props.api('/api/browser/status?action=shell', 'GET', null).then(function (r) {
                if (r && r.json && r.json.ok === false) throw new Error(String(r.json.error || 'action 不被接受'));
                return pollBr(24, 1500);
              }).then(function (st) {
                setBrMsg(st && st.running ? ('✓ 采集已跑在浏览器壳里 (CDP ' + (st.activePort || 9334) + ')') : '✗ 壳还没起来 —— 看下面的提示');
              }).catch(function (e) {
                var m = String((e && e.message) || e);
                if (/400|action|HTTP/i.test(m)) { fallback(); return; }
                setBrMsg('✗ ' + m);
              });
            })(); }, }, '🖥 打开浏览器壳(用它采集)'),
            br && br.running && br.activePort === 9334 ? h('button', { className: 'zywb-btn', style: { padding: '3px 10px' }, title: '关掉浏览器壳, 采集回落到本地无头 Edge', onClick: function () { setBrMsg('⏳ 正在停止浏览器壳…'); props.api('/api/browser/status?action=shellstop', 'GET', null).then(function () { setBrMsg('✓ 已停止浏览器壳, 采集回落本地无头'); return pollBr(6, 1000); }).catch(function (e) { setBrMsg('✗ ' + ((e && e.message) || e)); }); }, }, '⏹ 关壳·回本地无头') : null,
          /* 窗口形态三选(记住): 无头 / 离屏 / 可见窗口 —— 换形态会自动重启采集浏览器 */
          h('span', { style: { display: 'inline-flex', gap: 4, alignItems: 'center' } },
            h('span', { className: 'zywb-note', style: { fontSize: 11.5 } }, '窗口形态'),
            h('select', {
              className: 'zywb-input', style: { width: 116, fontSize: 11.5 }, value: brMode,
              title: '无头=屏幕上没有窗口(默认最安静) · 离屏=有头但窗口在屏幕外(风控更友好) · 可见窗口=摆在桌面上, 采集就在你眼前跑',
              onChange: function (e) {
                const m = e.target.value;
                setBrMode(m);
                setBrMsg('⏳ 正在切换窗口形态为「' + (m === 'visible' ? '可见窗口' : (m === 'offscreen' ? '离屏窗口' : '无头')) + '」…');
                props.api('/api/browser/mode', 'POST', { mode: m }).then(function (r) { return { r: r, st: null } })
                  .then(function (o) {
                    const j = (o.r && o.r.json) || {};
                    if (j.ok === false) { setBrMsg('⚠ ' + (j.error || '暂时不能换窗口形态')); return null }   // 比如正有采集在跑
                    return pollBr(15, 1500);
                  })
                  .then(function (st) { if (st) setBrMsg(st.running ? ('✓ 现在是「' + (st.mode === 'visible' ? '可见窗口' : (st.mode === 'offscreen' ? '离屏窗口' : '无头')) + '」') : '✗ 没起来'); })
                  .catch(function (e) { setBrMsg('✗ ' + ((e && e.message) || e)); });
              },
            }, [['headless', '无头(不弹窗)'], ['offscreen', '离屏窗口'], ['visible', '可见窗口']].map(function (o) { return h('option', { key: o[0], value: o[0] }, o[1]); }))),
          /* 📷 看画面: 采集跑在无头浏览器里(屏幕上没窗口), 这个按钮让你"亲眼看到它在翻页" */
          br && br.running ? h('button', {
            className: 'zywb-btn', style: { padding: '3px 10px' },
            title: '看一眼采集浏览器当前那个标签的画面(每 3 秒自动刷新) —— 采集跑在无头浏览器里, 屏幕上本来没有窗口',
            onClick: function () { setModal({ kind: 'shot' }); },
          }, '📷 看画面') : null,
          br && br.running && br.usingLocal && br.mode === 'visible' ? h('button', {
            className: 'zywb-btn', style: { padding: '3px 10px' }, title: '把采集窗口调到最前面(被别的窗口盖住了就点它)',
            onClick: function () {
              props.api('/api/browser/focus', 'POST', {}).then(function (r) {
                const j = (r && r.json) || {};
                setBrMsg(j.ok ? '✓ 已把采集窗口调到前台' : ('✗ ' + (j.error || '没能置顶')));
              }).catch(function (e) { setBrMsg('✗ ' + ((e && e.message) || e)); });
            },
          }, '⬆ 调到前台') : null,
          br && !br.running ? h('button', {
            className: 'zywb-btn', style: { padding: '3px 10px', background: '#2f6feb', borderColor: '#2f6feb', color: '#fff' },
            title: '启动本地无头浏览器(不弹窗、不占前台), 采集会优先用它; 约 3~10 秒',
            onClick: function () {
              setBrMsg('⏳ 正在启动本地无头浏览器…(约 3~10 秒)');
              props.api('/api/browser/start', 'POST', { mode: 'headless' }).then(function () {
                return pollBr(12, 1500);
              }).then(function (st) {
                setBrMsg(st && st.running ? '✓ 已启动 (' + st.activePort + '), 可以开始采集了' : '✗ 还没起来 —— 看下面的提示, 或去网页端「服务器」页看日志');
              }).catch(function (e) { setBrMsg('✗ 启动失败: ' + ((e && e.message) || e)); });
            },
          }, '▶ 启动本地无头') : null,
          br && br.running && br.usingLocal ? h('button', {
            className: 'zywb-btn', style: { padding: '3px 10px' },
            onClick: function () { setBrMsg('⏳ 正在停止…'); props.api('/api/browser/stop', 'POST', {}).then(function () { setBrMsg('已停止'); return pollBr(6, 1000); }).catch(function (e) { setBrMsg('✗ ' + ((e && e.message) || e)); }); },
          }, '⏹ 停止') : null,
          br && !br.usingLocal && br.running ? h('button', {
            className: 'zywb-btn', style: { padding: '3px 10px' }, title: '切回本地无头浏览器(没启动时点它没用, 先点「▶ 启动本地无头」)',
            onClick: function () { props.api('/api/browser/switch', 'POST', { target: 'local' }).then(function () { return pollBr(3, 800); }).catch(function () {}); },
          }, '↺ 优先用本地无头') : null,
          h('button', { className: 'zywb-btn', style: { padding: '3px 10px' }, onClick: function () { pollBr(1, 0); } }, '⟳ 刷新'),
          brMsg ? h('span', { className: 'zywb-note', style: { fontSize: 11.5 } }, brMsg) : null),
        h('div', { className: 'zywb-note', style: { fontSize: 11, marginTop: 4 } },
          br && br.running
            ? ('页面 ' + (br.pages || []).length + ' 个' + ((br.pages || [])[0] ? ' · ' + String(br.pages[0].url || '').slice(0, 60) : '') + ' · 采集跑在它上面, 不弹窗不抢前台')
            : ('采集全程走 CDP 驱动浏览器: 优先本地无头(' + ((br && br.port) || 9333) + '), 没有就回落到你手动开的采集浏览器(' + ((br && br.userPort) || 9222) + ')。'
              + '两边都没有 → 任何采集都会报「CDP 连不上」。点左边「▶ 启动本地无头」即可(约 3~10 秒)。')),
        br && br.lastError ? h('div', { className: 'zywb-note', style: { fontSize: 11, color: '#f28b8b', marginTop: 2 } }, '上次启动错误: ' + br.lastError) : null);

      return h('div', null,
        brBar,
        filterCard,
        h('div', { className: 'zywb-card' }, h('div', { className: 'zywb-h' }, '💾 过滤规则 (保存/加载/删除)'), ruleButtons, rulePills),
        h('div', { className: 'zywb-card' },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
            h('div', { className: 'zywb-h', style: { flex: 1, margin: 0 } }, '🚀 采集方式 (点击卡片开始, 全程CDP无API)'),
            (run || srvRunning) ? h('span', { className: 'zywb-note zywb-warn' }, prog) : null,
            h('button', { className: 'zywb-btn', onClick: doStop, disabled: !(run || srvRunning), style: { color: '#f28b8b' } }, '⏹ 停止')),
          h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(250px,1fr))', gap: 8, marginTop: 10 } }, modeCards)),
        collectLogs.length ? h('div', { className: 'zywb-card' },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            h('div', { className: 'zywb-h', style: { flex: 1, margin: 0 } }, '🗂 采集记录 (' + collectLogs.length + ') — 点击行跳转商品管理, 或点「报告」看这次采集的明细'),
            h('button', { className: 'zywb-btn', onClick: function () { reloadCollectLogs(); } }, '⟳ 刷新')),
          h('div', { style: { maxHeight: 260, overflow: 'auto', marginTop: 6 } }, collectLogs.map(function (g, i) {
            return h('div', { key: i, onClick: function () { if (props.onOpenProducts) props.onOpenProducts(g); }, title: '点击查看该次采集的商品 (' + g.fromUtc + ' ~ ' + g.toUtc + ' UTC)', style: { display: 'flex', gap: 10, alignItems: 'center', padding: '6px 8px', borderBottom: '1px dashed #2a2a30', fontSize: 12, cursor: 'pointer', borderRadius: 6 } },
              h('span', { style: { color: '#8ab4ff', fontWeight: 600, whiteSpace: 'nowrap' } }, g.atLocal),
              h('span', { className: 'zywb-note', style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, g.name + ' · 采集 ' + (g.productCount || g.count || 0) + ' 个'),
              g.added != null ? h('span', { style: { color: '#5fd08a', fontWeight: 600, whiteSpace: 'nowrap' } }, '新增 ' + g.added) : h('span', { className: 'zywb-note', style: { whiteSpace: 'nowrap' } }, '历史批次'),
              // 采集报告: 独立按钮, 阻止冒泡以免触发整行「跳商品管理」
              h('button', { className: 'zywb-btn', style: { padding: '2px 8px', fontSize: 11.5, whiteSpace: 'nowrap' }, title: '查看这次采集的明细报告 (店铺/品牌/剔除他牌/过滤条件/错误)',
                onClick: function (e) { e.stopPropagation(); openReport(g); } }, '📋 报告'),
              h('span', { className: 'zywb-note', style: { color: '#8ab4ff', whiteSpace: 'nowrap' } }, '查看商品 →'));
          }))) : null,
        (linkJobs.list && linkJobs.list.length) ? h('div', { className: 'zywb-card' },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
            h('div', { className: 'zywb-h', style: { flex: 1, margin: 0 } }, '🔗 多链接采集任务 (断点续跑)' + (linkJobs.resumable ? ' — 有未跑完的任务' : '')),
            h('button', { className: 'zywb-btn', onClick: function () { reloadLinkJobs(); } }, '⟳ 刷新'),
            linkJobs.resumable ? h('button', { className: 'zywb-btn', disabled: !!(run || srvRunning), onClick: function () { doResumeTask('resume'); } }, '⏯ 继续上次任务') : null,
            (linkJobs.resumable && linkJobs.resumable.failed) ? h('button', { className: 'zywb-btn', disabled: !!(run || srvRunning), onClick: function () { doResumeTask('failed'); } }, '↻ 重跑失败(' + linkJobs.resumable.failed + ')') : null,
            // ★ 中途停止时没跑的单元会被标成 skipped(无日志), 任务会显示成"1/15 就该结束"→ 用这个捞回来重跑
            (linkJobs.resumable && linkJobs.resumable.skipped) ? h('button', { className: 'zywb-btn', disabled: !!(run || srvRunning), title: '把"本轮跳过"的店铺/品牌放回待办并继续跑(中途停止会留下这类单元)', onClick: function () { doResumeTask('skipped'); } }, '↻ 重跑跳过(' + linkJobs.resumable.skipped + ')') : null,
            linkJobs.resumable ? h('button', { className: 'zywb-btn', onClick: doRemoveTask }, '🗑 删除该任务') : null),
          h('div', { className: 'zywb-note', style: { marginTop: 4 } }, '每完成一条链接 / 一个店铺 / 一个品牌都会落盘 —— 后端重启、Edge 崩、断电都不作废; 已完成的单元续跑时零导航跳过。'),
          h('div', { style: { maxHeight: 210, overflow: 'auto', marginTop: 6 } }, linkJobs.list.map(function (t, i) {
            const stColor = t.status === 'done' ? '#5fd08a' : (t.status === 'partial' ? '#e0b25c' : (t.status === 'running' ? '#8ab4ff' : '#9aa4b2'));
            return h('div', { key: t.id || i, style: { padding: '5px 2px', borderBottom: '1px dashed #2a2a30', fontSize: 12, lineHeight: 1.6 } },
              h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' } },
                h('span', { style: { color: stColor, fontWeight: 600 } }, '● ' + t.status),
                h('span', { className: 'zywb-note' }, t.id),
                h('span', { className: 'zywb-note' }, '链接 ' + t.linksDone + '/' + t.links + ' · 店铺 ' + t.sellersDone + '/' + t.sellers + ' · 品牌 ' + t.brandsDone + '/' + t.brands + ' · 批次 ' + t.batchesDone + '/' + t.batches),
                h('span', { style: { color: '#5fd08a' } }, '累计入库 ' + t.added),
                t.pending ? h('span', { style: { color: '#e0b25c' } }, '待办 ' + t.pending) : null,
                t.failed ? h('span', { style: { color: '#f28b8b' } }, '失败 ' + t.failed) : null,
                t.elapsedSec ? h('span', { className: 'zywb-note' }, t.elapsedSec + 's') : null),
              t.pauseReason ? h('div', { style: { color: '#e0b25c' } }, '⚠ ' + pauseHint(t.pauseReason) + ' → 处理完后点「⏯ 继续上次任务」接着跑') : null,
              t.lastLog ? h('div', { className: 'zywb-note', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, '最后一步: ' + t.lastLog) : null);
          }))) : null,
        logs.length ? h('div', { className: 'zywb-card' }, h('div', { className: 'zywb-h' }, '📄 采集日志'), h('div', { style: { maxHeight: 150, overflow: 'auto', fontSize: 12, lineHeight: 1.7 } }, logs.map(function (t, i) { return h('div', { key: i }, t); }))) : null,
        modal && modal.kind === 'report' ? h(Modal, { title: modal.title || '采集报告', children: reportChildren(modal), onClose: function () { setModal(null); } }) : null,
        modal && modal.kind === 'alert' ? h(Modal, { title: modal.title, rows: modal.rows, onClose: function () { setModal(null); } }) : null,
        modal && modal.kind === 'confirmDel' ? h(Modal, { title: '删除规则', rows: ['确定删除规则「' + modal.name + '」吗?'], onClose: function () { setModal(null); }, buttons: [{ label: '取消', onClick: function () { setModal(null); } }, { label: '确定删除', primary: true, onClick: function () { props.api('/api/collect-rules/delete', 'POST', { name: modal.name }).then(function () { setRuleInfo('🗑 已删除「' + modal.name + '」'); setModal(null); setRuleSel(''); reloadRules(); }).catch(function (e) { setRuleInfo('删除失败: ' + String(e && e.message || e)); }); } }] }) : null,
        modal && modal.kind === 'name' ? h(NameModal, { def: modal.def, hint: modal.hint, onClose: function () { setModal(null); }, onSave: function (nm) { props.api('/api/collect-rules', 'POST', { name: nm, site: (filt.sites && filt.sites[0]) || f.sites[0] || 'de', filter: filt }).then(function (r) { setRuleInfo('✔ 已保存规则「' + nm + '」'); setModal(null); reloadRules(); }).catch(function (e) { setRuleInfo('保存失败: ' + String(e && e.message || e)); }); } }) : null,
        modal && modal.kind === 'mode' ? h(ModeModal, { modeObj: modal.mode, onClose: function () { setModal(null); }, onSubmit: function (vals) { doCollect(modal.mode, vals); } }) : null,
        /* 📷 看画面: 当前标签的实时截图(3 秒刷新), 多标签时可切换 */
        modal && modal.kind === 'shot' ? h(Modal, {
          title: '📷 采集浏览器画面 (每 3 秒自动刷新)', onClose: function () { setModal(null); },
          buttons: [{ label: '关闭', onClick: function () { setModal(null); } },
            { label: '⟳ 立即刷新', primary: true, onClick: function () { pullShot(); } }]
            .concat((shot && shot.total > 1) ? [{ label: '下一个标签 ›', onClick: function () { pullShot(((shot.i || 0) + 1) % shot.total); } }] : []),
          children: h('div', null,
            shot && shot.err ? h('div', { className: 'zywb-note', style: { color: '#f28b8b' } }, '✗ ' + shot.err) : null,
            shot && shot.data ? h('img', { src: shot.data, style: { maxWidth: '100%', border: '1px solid #333', borderRadius: 6, display: 'block' } })
              : h('div', { className: 'zywb-note' }, '⏳ 正在截图…'),
            shot && shot.url ? h('div', { className: 'zywb-note', style: { marginTop: 6, wordBreak: 'break-all' } },
              '标签 ' + ((shot.i || 0) + 1) + '/' + shot.total + ' · ' + String(shot.title || '').slice(0, 70)) : null,
            shot && shot.url ? h('div', { className: 'zywb-note', style: { fontSize: 11, wordBreak: 'break-all' } }, shot.url) : null,
            h('div', { className: 'zywb-note', style: { marginTop: 6, fontSize: 11 } },
              '这是采集浏览器里"正在干活的那个标签" —— 采集默认跑在本地无头浏览器里(屏幕上没有窗口), 所以要用这个看。想看整个窗口就点上面「👁 换成可见窗口」。')),
        }) : null);
    }
/** 站点 → 亚马逊域名后缀(与商品页的 domOf 同表; 报告弹窗在采集面板里, 需要模块级版本) */
/**
 * 商品链接的「分类管理」(打开所选链接时按类型勾选, 选择记在 localStorage)。
 * 需求(2026-09-20): 打开所选链接时不要把品牌店铺链接一起打开 —— 所以默认**只开商品页**,
 * 品牌店/卖家页/1688 同款要显式勾选才会开, 选过之后会被记住。
 */
const LINK_KINDS_KEY = 'zying.products.linkKinds.v1';
const LINK_KIND_DEFS = [
  { k: 'product', name: '商品页', hint: 'amazon.<站点>/dp/<ASIN> —— 每个商品一条, 最常用' },
  { k: 'brand', name: '品牌店 / 品牌页', hint: '品牌跳转链接(品牌店铺页) —— 默认不开, 避免和商品页混在一起' },
  { k: 'seller', name: '卖家页 / 店铺', hint: '卖家简介页 /sp?seller=<卖家ID>、卖家店铺页' },
  { k: 's1688', name: '1688 同款', hint: '同款货源链接(用于比价/找货)' },
];
const LINK_KINDS_DEFAULT = { product: true, brand: false, seller: false, s1688: false };
/** 规范化: 只认已知分类, 缺的按默认; 非法输入 → 全默认 */
function normLinkKinds(v) {
  const out = Object.assign({}, LINK_KINDS_DEFAULT);
  if (v && typeof v === 'object') {
    LINK_KIND_DEFS.forEach(function (d) { if (typeof v[d.k] === 'boolean') out[d.k] = v[d.k] });
  }
  return out;
}
function readLinkKinds() {
  try {
    const raw = (typeof window !== 'undefined' && window.localStorage ? window.localStorage.getItem(LINK_KINDS_KEY) : '') || '';
    if (raw.trim()) return normLinkKinds(JSON.parse(raw));
  } catch (e) { /* 坏值 → 默认 */ }
  return normLinkKinds(null);
}
function writeLinkKinds(cfg) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) window.localStorage.setItem(LINK_KINDS_KEY, JSON.stringify(normLinkKinds(cfg)));
  } catch (e) { /* 隐私模式 → 不记忆 */ }
}
/**
 * 纯函数: 统计每个分类各有多少条链接(不做勾选过滤, 供弹窗显示"商品页 93 / 品牌店 50 …")。
 * linksOf(p) 返回 [{kind, label, url}]; 同一 URL 在**所有商品之间**全局去重(seenAll)。
 */
function countLinksByKind(rows, linksOf) {
  const byKind = {}, seenAll = {};
  (rows || []).forEach(function (p) {
    (linksOf(p) || []).forEach(function (l) {
      const k = l.kind || 'product';
      const u = String(l.url || '').trim();
      if (!u || !/^https?:/i.test(u) || seenAll[u]) return;
      seenAll[u] = 1;
      byKind[k] = (byKind[k] || 0) + 1;
    });
  });
  return { byKind: byKind, total: Object.keys(byKind).reduce(function (n, k) { return n + byKind[k] }, 0) };
}
/** 纯函数: 按勾选的分类收集链接(跨商品全局去重), 返回打开队列 + 各分类条数 */
function collectLinksByKind(rows, kinds, linksOf) {
  const use = normLinkKinds(kinds);
  const items = [], byKind = {}, seenAll = {};
  (rows || []).forEach(function (p) {
    (linksOf(p) || []).forEach(function (l) {
      const k = l.kind || 'product';
      if (!use[k]) return;
      const u = String(l.url || '').trim();
      if (!u || !/^https?:/i.test(u) || seenAll[u]) return;
      seenAll[u] = 1;
      items.push({ asin: p.asin, kind: k, label: l.label, url: u });
      byKind[k] = (byKind[k] || 0) + 1;
    });
  });
  return { items: items, byKind: byKind };
}
function amzHostOf(site) {
  const s = String(site || '').toLowerCase().trim();
  const suf = { uk: 'co.uk', us: 'com', jp: 'co.jp', au: 'com.au', mx: 'com.mx', br: 'com.br', sg: 'com.sg', tr: 'com.tr', ae: 'ae', sa: 'sa', nl: 'nl', se: 'se', pl: 'pl', de: 'de', fr: 'fr', it: 'it', es: 'es', ca: 'ca', in: 'in' }[s] || s || 'de';
  return 'https://www.amazon.' + suf;
}
function openExternal(url, title) {      if (!url) return;
      const u = String(url);
      // ① 首选: 交给本机服务用系统默认浏览器打开 (真·本地浏览器)
      try {
        if (typeof fetch === 'function') {
          fetch('http://127.0.0.1:3088/api/open?url=' + encodeURIComponent(u), { method: 'GET', cache: 'no-store' })
            .then(function (r) { if (!r || !r.ok) throw new Error('open api ' + (r && r.status)); })
            .catch(function () { openExternalFallback(u); });
          return;
        }
      } catch (e) { /* 同步异常 → 兜底 */ }
      openExternalFallback(u);
    }
    // 兜底: ERP 服务不可用时, 在当前浏览器开新标签 (仍不使用任何侧边栏/内嵌浏览)
    function openExternalFallback(url) {
      try {
        const w = (typeof window !== 'undefined' && window.open) ? window.open(url, '_blank', 'noopener,noreferrer') : null;
        if (w) return;
      } catch (e) { /* ignore */ }
      try {
        const a = document.createElement('a');
        a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
        document.body.appendChild(a); a.click(); a.remove();
      } catch (e) { /* ignore */ }
    }

const SITES9 = [['de', '🇩🇪德国'], ['uk', '🇬🇧英国'], ['us', '🇺🇸美国'], ['fr', '🇫🇷法国'], ['it', '🇮🇹意大利'], ['es', '🇪🇸西班牙'], ['jp', '🇯🇵日本'], ['ca', '🇨🇦加拿大'], ['au', '🇦🇺澳大利亚'], ['in', '🇮🇳印度']];
    const CAT9 = [
      { v: 'Electronics', l: '电子', children: [['Cell Phones & Accessories', '手机及配件'], ['Computers & Accessories', '电脑及配件'], ['Headphones', '耳机音响'], ['Camera & Photo', '相机摄影'], ['TV', '电视影音'], ['Video Games', '游戏主机']] },
      { v: 'Automotive', l: '汽车', children: [['Automotive Parts', '汽车配件'], ['Car Electronics', '车载电子'], ['Car Care', '汽车护理'], ['Tires & Wheels', '轮胎轮毂']] },
      { v: 'Home & Kitchen', l: '家居厨房', children: [['Kitchen', '厨房用品'], ['Storage & Organization', '收纳整理'], ['Furniture', '家具'], ['Cleaning', '清洁用品'], ['Bedding', '床上用品']] },
      { v: 'Toys & Games', l: '玩具游戏', children: [['Toys', '儿童玩具'], ['Board Games', '桌游卡牌'], ['Action Figures', '模型手办'], ['Puzzles', '拼图积木']] },
      { v: 'Sports & Outdoors', l: '运动户外', children: [['Fitness', '健身器材'], ['Camping & Hiking', '露营野餐'], ['Cycling', '骑行装备'], ['Water Sports', '水上运动']] },
      { v: 'Beauty', l: '美妆个护', children: [['Skin Care', '护肤'], ['Makeup', '彩妆'], ['Hair Care', '美发'], ['Fragrance', '香水']] },
      { v: 'Clothing', l: '服装鞋靴', children: [['Men', '男装'], ['Women', '女装'], ['Shoes', '鞋靴'], ['Accessories', '服饰配件']] },
      { v: 'Tools', l: '工具五金', children: [['Hand Tools', '手动工具'], ['Power Tools', '电动工具'], ['Hardware', '五金配件']] },
      { v: 'Office Products', l: '办公用品', children: [['Office Supplies', '办公文具'], ['Ink & Toner', '打印耗材']] },
      { v: 'Garden', l: '花园', children: [['Garden Tools', '园艺工具'], ['Lawn Care', '草坪护理'], ['Patio', '户外装饰']] },
      { v: 'Pet Supplies', l: '宠物用品', children: [['Dog Supplies', '狗狗用品'], ['Cat Supplies', '猫咪用品'], ['Pet Food', '宠物食品']] }
    ];
    // 导出可勾选列 (与后端 EXPORT_FIELDS 对应; 第三项 true=默认"重要信息"列)
    const EXPORT_COLS = [
      ['asin', 'ASIN', true], ['site', '站点', true], ['title', '标题', true], ['price', '价格', true], ['currency', '币种', true],
      ['fulfill', '配送', true], ['amz', '自营', true], ['aplus', 'A+', true], ['choice', 'AC', true], ['url', '跳转链接', true],
      ['brand', '品牌', false], ['rating', '评分', false], ['reviews', '评论数', false], ['follow', '跟卖数', false],
      ['monthlySales', '月销', false], ['rank', '大排名', false], ['category', '类目', false], ['badge', '标签', false],
      ['image', '主图', false], ['collectedAt', '采集时间', false], ['source', '采集方式', false]
    ];
    const EXPORT_BASE = 'http://127.0.0.1:3088/api/products/export';
    const UI_BUILD = 'built-20261002-tmdd';   // 界面构建标记: 排名口径统一(大排名=父类排名) + 采集专有条件不在商品管理显示 + 排除商标国家改真·多选下拉(点击展开)
    // ===== 统一过滤面板 (商品管理 + 采集过滤 共用同一组件 / 同一 schema) =====
    // 后端适配: canonical → GET /api/products?filter=<json> (查库) / POST /api/collect/* {filter} (采集判定)
    // 语义差异(有意): 采集时未知字段放行(详情页读到再判); 商品库里未知字段视为不满足。
    function NF() {
      // ★ 2026-09-24 语义调整: 页面标识改【排除法】(面板写 badgeNot) / 无排名改【只看有排名】(面板写 hasRankOnly)。
      //   旧字段 badges(含任一) / noRank(只看无排名) 仍留在 schema 里 —— 服务端继续兼容老规则与老 API 调用。
      return { sites: [], fulfill: '', sell: '', aplus: '', badges: [], badgeNot: [], china: '',
        noRank: false, hasRankOnly: '',
        rankState: '',                                     // ★ 大排名三态: '' 不限 / ok 有 / not_listed 未上榜 / unknown 未采集到
        priceRange: '', salesRange: '', rankRange: '', ratingRange: '', reviewsRange: '', followRange: '',
        tmRange: '', newDaysRange: '', tmCountries: '', is1688: '', brandStatus: '', q: '',
        catNot: [], catKw: '', cat1: '', cat2: '', cat1Cn: '',
        famFilter: '', famKey: '', famAny: false, dropOtherBrand: '',   // ★ 补齐 normFilter 里 NF() 原先漏掉的键
        collectedFrom: '', collectedTo: '',
        shopAplus: '', brandShop: '', brandStore: '' };
    }
    const BADGE_OPTS = [['bestseller', 'Best Seller'], ['choice', "AC"], ['deal', '限时优惠'], ['newrelease', '新品'], ['A+', 'A+']];
    const BRAND_STATUS_OPTS = [['', '不限'], ['registered', '排除已备案'], ['tm', '排除 TM'], ['notfound', '仅未查到']];
    const FILTER_SITES = [['de', '🇩🇪德国'], ['uk', '🇬🇧英国'], ['us', '🇺🇸美国'], ['fr', '🇫🇷法国'], ['it', '🇮🇹意大利'], ['es', '🇪🇸西班牙'], ['jp', '🇯🇵日本'], ['ca', '🇨🇦加拿大'], ['au', '🇦🇺澳大利亚'], ['in', '🇮🇳印度'], ['mx', '🇲🇽墨西哥'], ['br', '🇧🇷巴西'], ['nl', '🇳🇱荷兰'], ['se', '🇸🇪瑞典'], ['pl', '🇵🇱波兰'], ['sg', '🇸🇬新加坡'], ['tr', '🇹🇷土耳其'], ['ae', '🇦🇪阿联酋'], ['sa', '🇸🇦沙特']];
    /* ★ 2026-10-02 过滤条件规格(字段分组 + 商标国家下拉选项) —— 商品管理/采集两处面板共用, 进程内只拉一次。
     * 后端 /api/filter/spec 给的 tmCountryOptions = 常用商标局 ∪ 库内实际出现过的国家,
     * 所以「排除商标国家」下拉能勾到的都是真有数据的(库里一条都没有时会提示去跑知产查重)。 */
    let __filterSpecCache = null;
    function loadFilterSpecOnce(apiFn, cb) {
      if (__filterSpecCache) { cb(__filterSpecCache); return; }
      apiFn('/api/filter/spec', 'GET', null).then(function (r) {
        if (r && r.ok && r.json) { __filterSpecCache = r.json; cb(r.json); }
      }).catch(function () { });
    }
    function ZypFilterPanel(props) {
      const v = props.value || NF();
      const mode = props.mode || 'product';
      const tree = props.catTree || null;
      /* ★ 2026-09-27 二级类目改折叠: 用户「把筛选项的大类目筛选完出来的小类目做成折叠形式」——
       *   原先是勾了几个大类目就把它们的全部二级 chip 一次性铺出来(勾 5 个大类目能排出上百个),
       *   面板被淹、下面别的筛选项全被顶走。现在每个大类目一行可点的标题, 默认收起, 点开才列二级;
       *   openL2 只记"哪些大类目是展开的"(键 = 大类目名)。 */
      const [openL2, setOpenL2] = React.useState({});
      const ch = function (patch) { props.onChange(Object.assign({}, v, patch)); };
      const sete = function (k) { return function (e) { const x = {}; x[k] = e.target.value; ch(x); }; };
      const toggle = function (k, val) { const arr = v[k] || []; const nx = {}; nx[k] = arr.indexOf(val) >= 0 ? arr.filter(function (z) { return z !== val; }) : arr.concat([val]); ch(nx); };
      const chip = function (k, val, label) {
        const on = (v[k] || []).indexOf(val) >= 0;
        const excl = (k === 'catNot' || k === 'badgeNot');   // 排除语义的 chip 用红色 (类目排除 / 页面标识排除)
        return h('label', { key: k + '|' + val, style: { display: 'inline-flex', gap: 4, alignItems: 'center', fontSize: 12, border: '1px solid ' + (on ? (excl ? '#a33' : '#4f8cff') : '#333'), borderRadius: 6, padding: '1px 7px', cursor: 'pointer', background: on ? (excl ? 'rgba(255,120,120,.16)' : 'rgba(79,140,255,.14)') : 'transparent' } },
          h('input', { type: 'checkbox', checked: on, onChange: function () { toggle(k, val); } }), label);
      };
      const inp = function (k, ph) { return h('input', { className: 'zyp-input', value: v[k] || '', onChange: sete(k), placeholder: ph, style: { width: '100%' } }); };
      const sel = function (k, opts) { return h('select', { className: 'zyp-input', value: v[k] || '', onChange: sete(k), style: { width: '100%' } }, opts.map(function (o) { return h('option', { key: o[0], value: o[0] }, o[1]); })); };
      const fld = function (label, node) { return h('div', null, h('div', { className: 'zyp-lbl' }, label), node); };
      /* ★ 2026-10-02 采集专有字段在商品管理里不显示。
       * 背景(用户实测反馈): 「A+ 店铺」「品牌店铺」「他牌商品(剔除他牌)」在商品管理里点了没反应 ——
       *   因为它们是【采集时】的店铺维度判断, /api/products 的查询链路根本不认这些键
       *   (后端 /api/filter/spec 的 groups.collectOnly 已经登记了它们, 只是前端一直没按 mode 过滤)。
       * 用户明确要求: 「品牌店铺的剔除他牌这个选项不需要在商品管理里呈现，删掉」。
       * 所以这里按 mode 收口: 商品管理(product)不渲染采集专有字段; 采集(collect)照常显示。 */
      const COLLECT_ONLY = { shopAplus: 1, brandShop: 1, brandStore: 1, dropOtherBrand: 1 };
      const fldC = function (label, node) { return mode === 'product' ? null : fld(label + ' *', node); };
      /* ★ 2026-10-02 「排除商标国家」= 真·多选下拉框 (用户要求: "点击后才会出现我勾选的国家, 不是直接显示")。
       * 值仍以逗号分隔存进 tmCountries, 后端 /api/products 与 applyCollectFilter 都不用改。
       * 选项 = 常用商标局 ∪ 库内实际出现过的国家(由 props.tmCountryOpts 传入), 保证能勾的都真有数据。
       *
       * 为什么用 position:fixed 而不是 absolute(踩过的坑):
       *   筛选面板在商品管理页里是放在可滚动容器里的, absolute 浮层会被滚动容器的边界裁掉
       *   (尤其面板靠页面下方时, 展开的下拉只剩一条缝)。fixed 用的是视口坐标, 不受任何祖先
       *   overflow 影响 —— 所以打开时实测按钮的 getBoundingClientRect, 用视口坐标定位;
       *   下方空间不够就往上弹(up)。面板带 zoom 时 rect 已经是缩放后的视觉坐标, 与 fixed 一致。 */
      const [tmOpen, setTmOpen] = React.useState(false);
      const [tmPos, setTmPos] = React.useState(null);
      const tmBtnRef = React.useRef(null);
      const tmPanelRef = React.useRef(null);
      React.useEffect(function () {
        if (!tmOpen) return undefined;
        const onDown = function (ev) {
          const inBtn = tmBtnRef.current && tmBtnRef.current.contains && tmBtnRef.current.contains(ev.target);
          const inPanel = tmPanelRef.current && tmPanelRef.current.contains && tmPanelRef.current.contains(ev.target);
          if (!inBtn && !inPanel) setTmOpen(false);
        };
        const onKey = function (ev) { if (ev.key === 'Escape') setTmOpen(false); };
        document.addEventListener('mousedown', onDown, true);
        document.addEventListener('keydown', onKey, true);
        return function () {
          document.removeEventListener('mousedown', onDown, true);
          document.removeEventListener('keydown', onKey, true);
        };
      }, [tmOpen]);
      const openTm = function () {
        const el = tmBtnRef.current;
        if (el && el.getBoundingClientRect) {
          const r = el.getBoundingClientRect();
          const H = 300;                                   // 下拉面板估高(含最大高度)
          const up = (window.innerHeight - r.bottom) < H && r.top > H;
          setTmPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - 272)), top: up ? null : r.bottom + 4, bottom: up ? (window.innerHeight - r.top + 4) : null, width: Math.max(244, Math.min(r.width, 360)) });
        }
        setTmOpen(function (o) { return !o; });
      };
      const tmSel = (function () {
        const cur = String(v.tmCountries || '').split(/[,，]/).map(function (s) { return s.trim(); }).filter(Boolean);
        const opts = (props.tmCountryOpts && props.tmCountryOpts.length) ? props.tmCountryOpts : [];
        const all = opts.slice();
        cur.forEach(function (c) { if (all.indexOf(c) < 0) all.push(c); });
        const setTm = function (c, on) {
          const next = on ? cur.filter(function (z) { return z !== c; }) : cur.concat([c]);
          ch({ tmCountries: next.join(',') });
        };
        const summary = cur.length
          ? (cur.length <= 3 ? cur.join('、') : cur.slice(0, 3).join('、') + ' 等 ' + cur.length + ' 个')
          : '不限 (点这里选择要排除的国家)';
        const trig = h('button', {
          ref: tmBtnRef, type: 'button', className: 'zyp-input',
          title: '点击展开多选: 勾中的国家 = 排除「在该国有商标」的商品',
          onClick: openTm,
          style: { width: '100%', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', textAlign: 'left', padding: '5px 8px' },
        },
          h('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: cur.length ? '#ff9d9d' : undefined } }, summary),
          cur.length ? h('span', { className: 'zyp-note', style: { fontSize: 10.5 } }, cur.length) : null,
          h('span', { className: 'zyp-note', style: { fontSize: 10 } }, tmOpen ? '▲' : '▼'));
        const panel = (tmOpen && tmPos) ? h('div', {
          ref: tmPanelRef,
          style: {
            position: 'fixed', zIndex: 9999,
            left: tmPos.left + 'px', width: tmPos.width + 'px',
            top: tmPos.top != null ? tmPos.top + 'px' : 'auto',
            bottom: tmPos.bottom != null ? tmPos.bottom + 'px' : 'auto',
            background: 'var(--dsw-alias-bg-layer-1,#1b1b1f)', border: '1px solid #4a4a55', borderRadius: 9,
            boxShadow: '0 10px 30px rgba(0,0,0,.55)', padding: 8,
          },
        },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 } },
            h('span', { className: 'zyp-note', style: { fontSize: 11, flex: 1 } }, '勾中 = 排除「在该国有商标」的商品'),
            cur.length ? h('button', { className: 'zyp-btn', style: { padding: '1px 7px', fontSize: 11 }, onClick: function () { ch({ tmCountries: '' }); } }, '清空') : null),
          all.length ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 4, maxHeight: 196, overflow: 'auto' } },
            all.map(function (c) {
              const on = cur.indexOf(c) >= 0;
              return h('label', {
                key: c, style: { display: 'inline-flex', gap: 4, alignItems: 'center', fontSize: 12, border: '1px solid ' + (on ? '#a33' : '#333'), borderRadius: 6, padding: '1px 7px', cursor: 'pointer', background: on ? 'rgba(255,120,120,.16)' : 'transparent' },
              }, h('input', { type: 'checkbox', checked: on, onChange: function () { setTm(c, on); } }), c);
            }))
            : h('div', { className: 'zyp-note', style: { fontSize: 11.5, maxWidth: 300, lineHeight: 1.6 } }, '库里还没有商标国家数据 —— 去「⚖️ 知产查重」跑一次批量查重, 结果里的商标国家会自动回填到这里。也可以先在下面手填。'),
          h('div', { style: { marginTop: 6, display: 'flex', gap: 6, alignItems: 'center', borderTop: '1px solid #333', paddingTop: 6 } },
            h('input', { className: 'zyp-input', value: v.tmCountries || '', onChange: sete('tmCountries'), placeholder: '手填, 逗号分隔', style: { flex: 1, fontSize: 11.5 } })),
          h('div', { style: { marginTop: 4 } },
            h('button', { className: 'zyp-btn', style: { fontSize: 11, padding: '2px 8px' }, onClick: function () { setTmOpen(false); } }, '完成')))
          : null;
        return h('div', null, trig, panel);
      })();
      const wide = function (label, node) { return h('div', { style: { gridColumn: '1/-1' } }, h('div', { className: 'zyp-lbl' }, label), node); };
      // ★ 2026-09-24 修复「类目排除」chips 被重复项淹没 (用户: "我只需要大类目的排除就可以"):
      //   原来 l1 取 tree = 按【原始类目名】分组 (库内 cat1 有 2700+ 种取值, 插件给的是站点本地化名),
      //   于是同一个中文大类目重复几百次 (汽车用品 (5733) / 汽车用品 (4306) / 汽车用品 (607) …)。
      //   现取 treeCn = 服务端 catCnOf() 归并出的【中文大类目】(约 25 条), chip 值即大类目名;
      //   后端 categoryNot 判定已同步支持大类目名(server.js catMatchText), 勾中即"整枝排除"。
      //   二级 chips 仍按【原始 cat2 值】排除(服务端按子串匹配原值), 只是显示成中文。
      const cnTree = (tree && Array.isArray(tree.treeCn) && tree.treeCn.length) ? tree.treeCn : null;
      const l1 = cnTree ? cnTree.filter(function (n) { return n.cat1 !== '未分类'; })
        : ((tree && tree.tree) || []).filter(function (n) { return n.cat1 !== '(未分类)'; });   // 兜底: 响应无 treeCn → 退回原始一级(旧行为, 会重复)
      const unc = cnTree ? cnTree.filter(function (n) { return n.cat1 === '未分类'; })[0]
        : ((tree && tree.tree) || []).filter(function (n) { return n.cat1 === '(未分类)'; })[0];
      // 取一个一级节点下的二级类目列表 (原始 cat2 值 + 计数)。
      // 注意: treeCn 节点自带的 children 是【按中文二级归并】的(多个原始 cat2 并成一个, 只留首个原始值),
      // 直接拿来当排除项会漏掉被并掉的那些 → 用 raws(该大类目下所有原始一级类目名) 回查 tree 聚合, 原始值不丢。
      const kidsOf = function (n) {
        if (!n.raws) return n.children || [];                                   // 原始树: children 已是 [{cat2,count}]
        const raws = {};
        (n.raws || []).forEach(function (r) { raws[r.name] = true; });
        const agg = {};
        ((tree && tree.tree) || []).forEach(function (t1) {
          if (!raws[t1.cat1]) return;
          (t1.children || []).forEach(function (c) { if (c.cat2) agg[c.cat2] = (agg[c.cat2] || 0) + c.count; });
        });
        return Object.keys(agg).map(function (k) { return { cat2: k, count: agg[k] }; }).sort(function (a, b) { return b.count - a.count; });
      };
      const l2groups = l1.filter(function (n) { return (v.catNot || []).indexOf(n.cat1) >= 0; })
        .map(function (n) { return { cat1: n.cat1, children: kidsOf(n) }; })
        .filter(function (n) { return n.children.length; });
      return h('div', { className: 'zyp-card', style: props.open === false ? { display: 'none' } : {} },
        h('div', { className: 'zyp-h' }, props.title || '🎛 过滤条件'),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(168px,1fr))', gap: 8 } },
          wide('站点 (多选, 不选=全部)', h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 4 } }, FILTER_SITES.map(function (s) { return chip('sites', s[0], s[1]); }))),
          fld('配送方式', sel('fulfill', [['', '不限'], ['FBA', 'FBA'], ['FBM', 'FBM'], ['AMZ', 'AMZ 自营']])),
          fld('卖家', sel('sell', [['', '不限'], ['amz', '仅 AMZ 自营'], ['third', '仅第三方卖家']])),
          // ★ 2026-09-24 删除「A+ 页面」独立字段: 它与「页面标识」里的 A+ 重复 (A+ / 排除 A+ 两个选项也重复)。
          //   现在统一用「页面标识(排除法)」勾 A+ 表达「排除 A+」—— 勾中即剔除带 A+ 的商品。
          fld('中国卖家', sel('china', [['', '不限'], ['1', '中国卖家'], ['0', '非中国卖家']])),
          fld('价格区间', inp('priceRange', '如 10-100')),
          fld('月销区间', inp('salesRange', '如 100-5000')),
          fld('大排名区间', inp('rankRange', '如 1000-200000（= 卡片上的「父类排名」, 与筛选/导出同一口径）')),
          fld('评分区间', inp('ratingRange', '如 3.5-4.8')),
          fld('评论数区间', inp('reviewsRange', '如 50-5000')),
          fld('跟卖数区间', inp('followRange', '如 1-20')),
          fld('排除商标数区间', inp('tmRange', '如 50- (排除≥50)')),
          fld('上架天数区间', inp('newDaysRange', '如 30-180')),
          fld('排除商标国家 (可多选)', tmSel),
          fld('1688 同款', sel('is1688', [['', '不限'], ['1', '仅有 1688 同款'], ['0', '排除 1688 同款']])),
          fld('品牌状态', sel('brandStatus', BRAND_STATUS_OPTS)),
          fld('标题含关键词', inp('q', '如 anker')),
          fld('有排名', h('label', { style: { display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12, paddingTop: 6 } }, h('input', { type: 'checkbox', checked: v.hasRankOnly === '1', onChange: function () { ch({ hasRankOnly: v.hasRankOnly === '1' ? '' : '1' }); } }), '排除没有排名的商品 (只看有排名)')),
          // ★ 2026-09-25 大排名三态: 未上榜(插件确认没有根类目排名) 与 未采集到(还没采到) 是两回事
          fld('大排名状态', h('select', {
            value: v.rankState || '', title: '未上榜 = 插件面板已分析完、确实没有根类目排名行; 未采集到 = 还没采到(可以补采)',
            onChange: function (e) { ch({ rankState: e.target.value }); },
            style: { width: '100%', fontSize: 12 },
          }, [['', '不限'], ['ok', '有大排名'], ['not_listed', '未上榜'], ['unknown', '未采集到']].map(function (o) { return h('option', { key: o[0], value: o[0] }, o[1]); }))),
          // ★ 2026-10-02 「A+ 店铺 / 品牌店铺 / 他牌商品 / 品牌店筛选」= 采集专有的店铺维度判断,
          //   商品管理查询链路不认 → 商品管理里不再渲染 (fldC 内部按 mode 返回 null)。
          fldC('A+ 店铺', sel('shopAplus', [['', '不限'], ['1', '仅有 A+ 店铺'], ['0', '排除 A+ 店铺']])),
          fldC('品牌店铺', sel('brandShop', [['', '不限'], ['0', '排除品牌店铺'], ['1', '仅品牌店铺']])),
          // ★ 2026-09: 原为写死的"品牌页混入他牌一律丢弃", 现改为开关(默认仍是剔除)
          fldC('他牌商品', sel('dropOtherBrand', [['', '剔除 (默认)'], ['0', '保留 (不剔除)']])),
          fldC('品牌店筛选', inp('brandStore', '品牌名 或 !排除')),
          fld('采集时间 起 *', h('input', { className: 'zyp-input', type: 'datetime-local', value: v.collectedFrom || '', onChange: sete('collectedFrom'), style: { width: '100%' } })),
          fld('采集时间 止 *', h('input', { className: 'zyp-input', type: 'datetime-local', value: v.collectedTo || '', onChange: sete('collectedTo'), style: { width: '100%' } })),
          wide('页面标识 (排除法: 勾中任一项 → 命中即剔除)', h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 4 } }, BADGE_OPTS.map(function (b) { return chip('badgeNot', b[0], b[1]); }))),
          wide('类目 (排除法: 一级=中文大类目, 勾中即整枝剔除; 勾了大类目后下方出现它的二级, 默认收起、点标题展开)', h('div', null,
            h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 4, maxHeight: 150, overflow: 'auto', border: '1px solid #333', borderRadius: 8, padding: 6 } },
              l1.length ? l1.map(function (n) { return chip('catNot', n.cat1, (n.cat1Cn || n.cat1) + ' (' + n.count + ')'); })
                : h('span', { className: 'zyp-note' }, props.catHint || '暂无一级类目数据 (可去商品管理点「用榜单类目即时推算」)')),
            l2groups.length ? h('div', { style: { marginTop: 6 } }, [
              h('div', { key: '__hd', style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 } },
                h('span', { className: 'zyp-note' }, '二级细分 (默认收起)'),
                l2groups.length > 1 ? h('button', {
                  className: 'zyp-btn', style: { padding: '1px 8px', fontSize: 11 },
                  onClick: function () {
                    const allOpen = l2groups.every(function (n) { return !!openL2[n.cat1]; });
                    const next = {};
                    l2groups.forEach(function (n) { next[n.cat1] = !allOpen; });
                    setOpenL2(next);
                  },
                }, l2groups.every(function (n) { return !!openL2[n.cat1]; }) ? '全部收起' : '全部展开') : null),
            ].concat(l2groups.map(function (n) {
              const op = !!openL2[n.cat1];
              /* 收起时也要看得见"这个大类目下有哪几个二级已被排除" —— 否则收起后勾选状态就"消失"了 */
              const picked = n.children.filter(function (c) { return (v.catNot || []).indexOf(c.cat2) >= 0; }).length;
              return h('div', { key: n.cat1 },
                h('button', {
                  className: 'zyp-btn', 'data-l2-head': n.cat1, title: op ? '收起这个大类目的二级' : '展开这个大类目的二级 (勾中即排除该二级)',
                  onClick: function () { setOpenL2(function (o) { const nx = Object.assign({}, o); nx[n.cat1] = !o[n.cat1]; return nx; }); },
                  style: { padding: '2px 8px', fontSize: 11.5, width: '100%', textAlign: 'left', marginBottom: 2 },
                }, (op ? '▾ ' : '▸ ') + (n.cat1Cn || n.cat1) + ' 的二级 (' + n.children.length + ' 个' + (picked ? ' · 已排除 ' + picked : '') + ')'),
                op ? h('div', { 'data-l2-chips': n.cat1, style: { display: 'flex', flexWrap: 'wrap', gap: 4, margin: '0 0 6px 12px', maxHeight: 180, overflow: 'auto', border: '1px solid #333', borderRadius: 6, padding: 6 } },
                  n.children.map(function (c) { return chip('catNot', c.cat2, cnOfChild(c.cat2) + ' (' + c.count + ')'); })) : null);
            }))) : null,
            h('div', { style: { marginTop: 6, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' } },
              h('input', { className: 'zyp-input', value: v.catKw || '', onChange: sete('catKw'), placeholder: '也可手填关键词, 逗号分隔 (如 Books, Cable)', style: { flex: 1, minWidth: 240 } }),
              unc ? h('button', { className: 'zyp-btn', onClick: function () { toggle('catNot', '(未分类)'); } }, ((v.catNot || []).indexOf('(未分类)') >= 0 ? '☑' : '☐') + ' 排除未采集类目 (' + unc.count + ')') : null,
              props.onReloadCat ? h('button', { className: 'zyp-btn', onClick: props.onReloadCat }, '⟳ 刷新类目') : null)))),
      h('div', { className: 'zyp-note', style: { marginTop: 6, fontSize: 10.5 } },
        '区间格式: 最小-最大 (单个数字=≥; 如 1000-500000, -5000 表示 ≤5000)。'
        + (mode === 'product'
          ? '【商品库】采集时间 看的是入库时间; 「大排名」= 卡片上的「父类排名」(同一口径, 所见即所得); 「只看有排名」= 父类排名有值。'
          : '【采集时】带 * 的是店铺维度条件(A+店铺/品牌店铺/品牌店筛选/他牌商品), 只在采集时判定; 未知字段放行, 等详情页读到再判。')
        + ' 其余条件两处完全同义。'));
    }

    function DetailPane(props) {
      const p = props.p || {};
      const api = props.api;
      const openExternal = props.openExternal;
      const notify = props.notify || function () {};
      const [md, setMd] = React.useState(null); // {kind:'img'|'quote'|'confirm'|'add', ...}
      const [big, setBig] = React.useState(false);
      const [claimed, setClaimed] = React.useState(!!(p.claimedAt || p.claimed));
      const [msg, setMsg] = React.useState('');
      const [prof, setProf] = React.useState(null); // 利润测算结果 (后端 /api/profit/calc 逐项返回)
      const [busy, setBusy] = React.useState('');
      // 利润测算输入 (全部可改; 默认值由后端按站点/类目/采集数据带出)
      const [wKg, setWKg] = React.useState('');
      const [dims, setDims] = React.useState('');
      const [supply, setSupply] = React.useState('');       // 货源成本 (¥)
      const [logi, setLogi] = React.useState('');           // 头程/FBM国际运费 (¥)
      const [duty, setDuty] = React.useState('');           // 关税/进口VAT (¥, 无法自动获取)
      const [storage, setStorage] = React.useState('');     // 仓储/其他 (¥)
      const [other, setOther] = React.useState('');         // 其他成本 (¥)
      const [fmode, setFmode] = React.useState(p.amazonSell ? 'AMZ' : (p.fulfill === 'FBA' ? 'FBA' : 'FBM'));
      const [pBasis, setPBasis] = React.useState('buybox'); // 售价口径: buybox|min|manual
      const [pManual, setPManual] = React.useState('');
      const [acos, setAcos] = React.useState('12');
      const [returnRate, setReturnRate] = React.useState('3');
      const [payRate, setPayRate] = React.useState('0.5');
      const [fxLoss, setFxLoss] = React.useState('0.5');
      const [targetMargin, setTargetMargin] = React.useState('20');
      const [rate, setRate] = React.useState(null);
      const [ratesTxt, setRatesTxt] = React.useState('');
      const [fxAll, setFxAll] = React.useState(null);        // /api/rates 的整张表 (货源比价换算要用到非站点币种)
      const [taxInfo, setTaxInfo] = React.useState(null);   // 税率表 (来源/含税口径)
      const [ovaVat, setOvaVat] = React.useState('');       // 手改 VAT 率
      const [ovaComm, setOvaComm] = React.useState('');     // 手改 佣金率
      const [ovaFba, setOvaFba] = React.useState('');       // 手改 FBA 配送费
      // 1688 图搜
      const [g1688, setG1688] = React.useState(null);
      const [gBusy, setGBusy] = React.useState(false);
      // 货源
      const [goods, setGoods] = React.useState(Array.isArray(p.sourceGoods) ? p.sourceGoods.slice() : []);
      const [gPlat, setGPlat] = React.useState('1688');
      const [gUrl, setGUrl] = React.useState('');
      const [fetchBusy, setFetchBusy] = React.useState(false);
      const cur = p.currency || 'EUR';
      const siteU = String(p.site || 'de').toUpperCase();
      const CURR_SYM2 = { GBP: '£', USD: '$', EUR: '€', JPY: '¥', CAD: 'C$', INR: '₹', MXN: 'MX$', AUD: 'A$', PLN: 'zł', SEK: 'kr', SAR: 'SAR', SGD: 'S$', BRL: 'R$', TRY: '₺' };
      const fmt = function (n) { return n == null ? '-' : (CURR_SYM2[cur] || cur + ' ') + Number(n).toFixed(2); };
      const fmtN = function (n) { return n == null ? '-' : Number(n).toLocaleString(); };
      // 外链地址 (站点后缀必须与后端 siteToHostSuffix 一致, 否则小站点会拼出 amazon.tr 这类错误域名)
      const DOM = { uk: 'co.uk', us: 'com', jp: 'co.jp', au: 'com.au', mx: 'com.mx', br: 'com.br', sg: 'com.sg', tr: 'com.tr', ae: 'ae', sa: 'sa', nl: 'nl', se: 'se', pl: 'pl', de: 'de', fr: 'fr', it: 'it', es: 'es', ca: 'ca', in: 'in' };
      const amzDom = DOM[p.site] || p.site || 'de';
      const amzUrl = 'https://www.amazon.' + amzDom + '/dp/' + p.asin;
      const enc = function (s) { return encodeURIComponent(String(s == null ? '' : s)); };
      const kw = enc((p.title || '').slice(0, 40));
      const mainImg = p.mainImage || '';
      const siteCountry = { de: 'DE', uk: 'GB', us: 'US', fr: 'FR', it: 'IT', es: 'ES', nl: 'NL', jp: 'JP', ca: 'CA', in: 'IN', au: 'AU' }[p.site] || 'GB';
      const parseKg = function (s) {
        const str = String(s || '');
        const m = str.match(/[0-9.]+/);
        if (!m) return null;
        const v = parseFloat(m[0]);
        if (str.indexOf('pound') >= 0) return Math.round(v * 0.4536 * 1000) / 1000;
        if (/(^|[^a-zA-Z])g([^a-zA-Z]|$)/.test(str) && str.toLowerCase().indexOf('kg') < 0) return Math.round(v / 1000 * 1000) / 1000;
        return v;
      };
      const firstNums = function (s) { const arr = String(s || '').match(/[0-9.]+/g); return arr ? arr.slice(0, 3).map(parseFloat) : []; };
      const wG = parseKg(p.weight) != null ? parseKg(p.weight) : (parseKg(p.packWeight) || 0);
      const dimArr = firstNums(p.size || p.packSize);
      // ---- 行渲染辅助 ----
      const Row = function (k, v, wide) { return h('div', { key: k, style: { fontSize: 12, padding: '2px 0' } }, h('span', { style: { color: '#8a8a8a', marginRight: 6 } }, k + ':'), h('span', { style: { wordBreak: 'break-word' } }, v == null || v === '' ? '-' : String(v))); };
      const gridRows = [];
      gridRows.push(Row('ASIN', p.asin)); gridRows.push(Row('品牌', p.brand));
      gridRows.push(Row('商标记录', p.trademarkCount != null ? (p.trademarkCount + ' 条' + (p.tmText ? ' (' + p.tmText + ')' : '')) : null));
      if (Array.isArray(p.tmCountries) && p.tmCountries.length) gridRows.push(Row('商标注册国家', p.tmCountries.join('、')));
      gridRows.push(Row('父类排名(大)', (p.rankParent != null ? '#' + fmtN(p.rankParent) + (p.rankParentCat ? '  ' + p.rankParentCat : '') : (rankParentIsNotListed(p) ? '未上榜（没有根类目排名行, 不是没采到）' : '未采到（可以补采再试）'))));
      gridRows.push(Row('子类排名(小)', (p.rankChild != null ? '#' + fmtN(p.rankChild) + (p.rankChildCat ? '  ' + p.rankChildCat : '') : '未采到（与"未上榜"无关: 未上榜说的是大排名）')));
      gridRows.push(Row('类目', p.category));
      gridRows.push(Row('站点', p.site)); gridRows.push(Row('当前价格', fmt(p.minPrice != null ? p.minPrice : p.price)));
      if (p.buyBoxPrice != null && p.buyBoxPrice !== (p.minPrice != null ? p.minPrice : p.price)) gridRows.push(Row('BuyBox 价', fmt(p.buyBoxPrice)));
      gridRows.push(Row('全部跟卖', Array.isArray(p.offerPrices) ? p.offerPrices.length + ' 个' : null));
      gridRows.push(Row('月销量', fmtN(p.monthlySales)));
      gridRows.push(Row('评分 / 评论', p.rating ? p.rating + '★ / ' + fmtN(p.reviews) : null));
      gridRows.push(Row('库存', fmtN(p.stock))); gridRows.push(Row('跟卖数量', p.followCount != null ? p.followCount + ' 个' : null));
      gridRows.push(Row('中国卖家', p.chinaSeller ? '是' : (p.chinaSeller === false ? '否' : null)));
      gridRows.push(Row('Amazon自营', p.amazonSell ? '是' : null)); gridRows.push(Row('配送', p.fulfill));
      gridRows.push(Row('FBA 配送费', p.fbaFee != null ? fmt(p.fbaFee) : null));
      gridRows.push(Row('佣金 (按类目费率表估)', p.referralFee != null ? fmt(p.referralFee) : null));
      // 「净收益(估)」已移除: 旧字段是 price×0.55−3.2 的硬编码产物, 与下方利润测算口径冲突 → 利润只在利润测算面板出现一次
      gridRows.push(Row('重量', p.weight)); gridRows.push(Row('尺寸', p.size));
      gridRows.push(Row('包装尺寸', p.packSize)); gridRows.push(Row('包装重量', p.packWeight));
      gridRows.push(Row('当前主卖家', p.mainSeller)); gridRows.push(Row('卖家ID', p.sellerId));
      gridRows.push(Row('来源店铺', p.shopSeller)); gridRows.push(Row('产品类型', p.productType));
      gridRows.push(Row('上架时间', p.listedAt)); gridRows.push(Row('首发', p.firstAvailable)); gridRows.push(Row('采集时间', p.collectedAt));
      gridRows.push(Row('来源', p.source)); gridRows.push(Row('保存', p.saved ? '已保存' : '否')); gridRows.push(Row('真实', p.real ? '是' : null));
      if (p.aiScore != null) gridRows.push(Row('AI 评分', p.aiScore)); 
      if (p.aiRiskLevel) gridRows.push(Row('AI 风险', p.aiRiskLevel));
      if (p.aiSuggestPrice != null) gridRows.push(Row('AI 建议价', fmt(p.aiSuggestPrice)));
        // 原始 BSR 明细保留展示, 但明确标注为「页面原生 BSR」, 避免与父类/子类排名混淆
        if (Array.isArray(p.bsr) && p.bsr.length) gridRows.push(Row('页面原生BSR', p.bsr.map(function (b) { return '#' + b.rank + ' ' + (b.category || b.name || ''); }).join('；')));
      const badges = [];
      const bdg = function (t, c) { return h('span', { key: t, style: { marginRight: 6 } }, h('span', { className: 'zyp-badge ' + (c || 'zyp-bg') }, t)); };
      if (p.brandStatus === 'registered') badges.push(bdg('已备案', 'zyp-br'));
      else if (p.brandStatus === 'unchecked') badges.push(bdg('未核查', 'zyp-bm'));
      else if (p.brandStatus === 'notfound') badges.push(bdg('未查到', 'zyp-bg'));
      else badges.push(bdg('未查到', 'zyp-bg'));
      if (p.bgMark) badges.push(bdg('BG标', 'zyp-br'));
      if (p.tmMark) badges.push(bdg('TM标', 'zyp-bm'));
      if (p.patentRisk) badges.push(bdg('专利风险', 'zyp-br'));
      if (p.amazonSell) badges.push(bdg('AMZ 自营', 'zyp-bz'));
      else if (p.fulfill) badges.push(bdg(p.fulfill, p.fulfill === 'FBA' ? 'zyp-bb' : 'zyp-warn'));
      if (p.aplus) badges.push(bdg('A+', 'zyp-bm'));
      if (p.is1688) badges.push(bdg('1688', 'zyp-bz'));
      if (p.badge) badges.push(bdg(String(p.badge), 'zyp-bz'));
      // ---- 概要表 / 卖点 ----
      const ovArr = (Array.isArray(p.productOverview) ? p.productOverview : (p.productInfo && typeof p.productInfo === 'object' ? Object.keys(p.productInfo).map(function (k) { return { k: k, v: p.productInfo[k] }; }) : []));
      const spArr = Array.isArray(p.sellingPoint) ? p.sellingPoint : (Array.isArray(p.sellingPoints) ? p.sellingPoints : []);
      // ---- 商标局 ----
      const offices = [];
      const siteTMO = {
        de: ['德国 DPMA', 'https://register.dpma.de/DPMAregister/marke/partiell?query=' + enc(p.brand) + '&lang=en'],
        uk: ['英国 UKIPO', 'https://trademarks.ipo.gov.uk/ipo-tmtext'],
        fr: ['法国 INPI', 'https://data.inpi.fr/marques?q=' + enc(p.brand)],
        it: ['意大利 UIBM', 'https://www.uibm.gov.it/bancadati/'],
        es: ['西班牙 OEPM', 'https://consultas2.oepm.es/gestor/faces/rest/verPublicaciones.jsp?tipo=Marcas'],
        nl: ['比荷卢 BOIP', 'https://www.boip.int/nl/merken/merkenregister'],
        se: ['瑞典 PRV', 'https://tc.prv.se/'],
        pl: ['波兰 PUP', 'https://ewyszukiwarka.pue.uprp.gov.pl/search/simple'],
        us: ['美国 USPTO', 'https://tmsearch.uspto.gov/search/search-information'],
        ca: ['加拿大 CIPO', 'https://ised-isde.canada.ca/cipo/trademarks/search/quick?q=' + enc(p.brand)],
        mx: ['墨西哥 IMPI', 'https://siga.impi.gob.mx/'],
        br: ['巴西 INPI', 'https://busca.inpi.gov.br/pePI/jsp/marcas/MarcaSearchBasico.jsp'],
        jp: ['日本 JPO', 'https://www.j-platpat.inpit.go.jp/'],
        au: ['澳洲 IP Australia', 'https://search.ipaustralia.gov.au/trademarks/search/quick?q=' + enc(p.brand)],
        in: ['印度 IP India', 'https://iprsearch.ipindia.gov.in/trademarksearch/'],
        sg: ['新加坡 IPOS', 'https://gobusiness.ipos.gov.sg/trademarksearch/'],
        ae: ['阿联酋 MOEC', 'https://www.moec.gov.ae/'],
        sa: ['沙特 SAIP', 'https://saip.gov.sa/']
      };
      if (siteTMO[p.site]) offices.push(siteTMO[p.site]);
      if (['de', 'fr', 'it', 'es', 'nl', 'se', 'pl'].indexOf(p.site) >= 0) offices.push(['欧盟 EUIPO', 'https://euipo.europa.eu/eSearch/#basic/1+1+1+1/30+30+30+30/' + enc(p.brand).replace(/%20/g, '+')]);
      // ---- 找货平台 ----
      const kwNo = enc((p.title || '').slice(0, 40));
      const imgUrl = p.mainImage || '';
      // 找货源平台清单由后端 /api/sources 提供 (单一来源: URL 直通图搜 / CDP 自动上传 / 关键词兜底)
      const [srcList, setSrcList] = React.useState(null);
      const [cdpOut, setCdpOut] = React.useState(null);
      const loadSources = function () {
        return api('/api/sources?asin=' + encodeURIComponent(p.asin), 'GET', null).then(function (r) {
          const j = r && r.json ? r.json : null;
          if (j && j.group) { setSrcList(j); return j; }
          return null;
        }).catch(function () { return null; });
      };
      // 一键去某平台以图搜图: img-url 类直接跳(已带图) / cdp 类交后端自动上传
      const goImageSearch = function (site) {
        if (site.kind === 'keyword') { openExternal(site.url, site.name + ' 关键词搜'); return; }
        if (site.kind === 'cdp') {
          setCdpOut({ loading: true, site: site.name });
          notify('⏳ ' + site.name + ' 自动上传图搜中 (后端执行, 无需操作)…');
          api('/api/sources/cdp-search', 'POST', { asin: p.asin, site: site.k }).then(function (r) {
            const j = r && r.json ? r.json : {};
            if (j && j.pageUrl) { setCdpOut({ site: site.name, pageUrl: j.pageUrl, results: j.results || [], err: null }); notify('✔ ' + site.name + ' 图搜完成, 已在浏览器打开结果页 (' + (j.results || []).length + ' 条已解析)'); }
            else setCdpOut({ site: site.name, err: (j && j.error) || '未取到结果' });
          }).catch(function (e) { setCdpOut({ site: site.name, err: String(e && e.message || e) }); notify('✗ ' + site.name + ' 图搜失败: ' + String(e && e.message || e)); });
          return;
        }
        if (!site.url) { notify('✗ ' + (site.note || '无可跳转链接')); return; }
        openExternal(site.url, site.name + ' 以图搜图');
        notify('✔ 已在浏览器新标签打开 ' + site.name + ' 图搜结果页 (已自动带上本商品主图, 无需手动上传)');
      };
      // ---- 认领 ----
      const doClaim = function () { setBusy('claim'); api('/api/claims', 'POST', { asin: p.asin }).then(function () { setClaimed(true); setBusy(''); notify('✔ 已认领 (' + (p.brand || '').slice(0, 20) + '-' + String(p.asin).slice(0, 4) + ')'); }).catch(function (e) { setBusy(''); notify('⚠ ' + String(e && e.message || e)); }); };
      // ---- 利润测算 (算法在后端 /api/profit/calc, 前端只渲染, 保证一个数字一个来源) ----
      const loadTax = function () {
        if (taxInfo) return Promise.resolve(taxInfo);
        return api('/api/tax/rates', 'GET', null).then(function (r) {
          const j = r && r.json ? r.json : null;
          if (j && j.sites) { setTaxInfo(j); return j; }
          return null;
        }).catch(function () { return null; });
      };
      const ensureRate = function () {
        if (rate != null) return Promise.resolve(rate);
        setMsg('正在获取汇率…');
        return api('/api/rates', 'GET', null).then(function (r) {
          const j = r && r.json ? r.json : null;
          if (j && j.rates) setFxAll(j.rates);
          const rv = j && j.rates ? (j.rates[cur] || null) : null;
          if (rv != null) { setRate(rv); setRatesTxt('1 ' + cur + ' = ' + Number(rv).toFixed(4) + ' CNY (' + (j.date || '') + ')'); return rv; }
          setRatesTxt('汇率接口无 ' + cur + ', 请手填'); return null;
        }).catch(function () { setRatesTxt('汇率获取失败, 请手填'); return null; });
      };
      const saveTaxOverride = function (site, val, includesTax) {
        if (val === '' || val == null) return Promise.resolve();
        return api('/api/tax/rates', 'POST', { site: site, rate: val, includesTax: includesTax }).catch(function () {});
      };
      const doCalc = function () {
        setBusy('calc'); setMsg('测算中…');
        return loadTax().then(function (tx) {
          return ensureRate().then(function () {
            const body = {
              asin: p.asin, mode: fmode,
              supplyCny: supply, shipCny: logi, dutyCny: duty, storageCny: storage, otherCny: other,
              priceBasis: pBasis, priceOverride: pBasis === 'manual' ? pManual : '',
              acos: acos, returnRate: returnRate, payRate: payRate, fxLoss: fxLoss,
              targetMargin: targetMargin,
              vatRate: ovaVat, commRate: ovaComm, fbaFee: ovaFba,
            };
            return api('/api/profit/calc', 'POST', body).then(function (r) {
              setBusy(''); setMsg('');
              if (r && r.json && r.json.items) { setProf(r.json); return r.json; }
              setMsg('✗ ' + ((r && r.json && r.json.error) || '测算失败')); return null;
            });
          });
        }).catch(function (e) { setBusy(''); setMsg('✗ 测算失败: ' + String(e && e.message || e)); return null; });
      };
      // 一键: 补汇率 + 税率 → FBM 用**本地物流报价表**回填运费 → 测算
      // (2026-09-20: 云途试算(CDP 驱动 yunexpress.cn)已删除 —— 后续物流价格改从「智赢客户端 UI」读取)
      const oneClick = function () {
        setBusy('one'); setMsg('一键计算: 汇率 → 税率 → 物流报价…');
        loadTax().then(function () { return ensureRate(); }).then(function () {
          if (fmode !== 'FBM') { setMsg(''); setBusy(''); return doCalc(); }
          const wK = parseFloat(wKg) || (wG > 0 ? wG / 1000 : 1);
          return api('/api/logistics/rates?country=' + siteCountry + '&weight=' + wK, 'GET', null).then(function (r) {
            const j = r && r.json ? r.json : null;
            if (j && Array.isArray(j.quotes) && j.quotes.length) {
              const best = j.quotes.filter(function (q) { return q.total != null; }).sort(function (a, b) { return a.total - b.total; })[0];
              if (best) { setLogi(String(best.total)); setMsg('✔ 物流成本: ' + best.channel + ' ¥' + best.total); return; }
            }
            setMsg('⚠ 报价表里没有该站点价格, 请手填物流成本 (或用「物流工具」维护报价表)');
          }).catch(function () { setMsg('⚠ 报价表读取失败, 请手填物流成本'); });
        }).then(function () { setBusy(''); setTimeout(function () { doCalc(); }, 0); }).catch(function (e) { setBusy(''); setMsg('✗ 一键计算失败: ' + String(e && e.message || e)); });
      };
      const loadRates = function () { loadTax(); ensureRate().then(function () { setMsg(ratesTxt || '汇率已加载'); }); };
      // ---- 1688 图搜 ----
      const do1688 = function () {
        setGBusy(true); setG1688(null); notify('正在 1688 以图搜图 (约 20-30 秒)…');
        api('/api/products/1688-search-upload', 'POST', { asin: p.asin }).then(function (r) {
          setGBusy(false);
          const j = r && r.json ? r.json : {};
          if (!j.items || !j.items.length) { setG1688({ err: '未找到同款 (请确认已登录 1688)' }); return; }
          setG1688({ items: j.items });
          const g0 = j.items[0];
          const now = new Date(); const pad = function (n) { return n < 10 ? '0' + n : String(n); };
          const addT = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) + ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());
          const newG = { platform: '1688', url: g0.url, title: g0.title, price: g0.priceRaw || g0.price, addedAt: addT };
          const list = goods.concat([newG]);
          api('/api/products/goods', 'POST', { asin: p.asin, goods: list }).then(function () { setGoods(list); notify('✔ 已自动加入第一个 1688 货源'); }).catch(function () {});
        }).catch(function (e) { setGBusy(false); setG1688({ err: String(e && e.message || e) }); });
      };
      // 货源列表: 每次变更后从服务端重读 (服务端已按 URL 去重并补 id/结构化价格)
      const reloadGoods = function () {
        return api('/api/products/goods?asin=' + encodeURIComponent(p.asin), 'GET', null).then(function (r) {
          const j = r && r.json ? r.json : null;
          if (j && Array.isArray(j.goods)) { setGoods(j.goods); return j.goods; }
          return null;
        }).catch(function () { return null; });
      };
      // 单条新增 (服务端去重: 同链接已存在则更新标题/价格, 变价记入 priceHistory)
      const addGood = function (good, label) {
        return api('/api/products/goods/add', 'POST', { asin: p.asin, good: good }).then(function (r) {
          const j = r && r.json ? r.json : {};
          reloadGoods();
          if (j.updated) notify('✔ 该货源已存在, 已更新' + (j.priceChanged ? ' (价格有变动, 已记入价格历史)' : '') + (label ? ' · ' + label : ''));
          else notify('✔ 已保存货源' + (label ? ' · ' + label : ''));
          return j;
        }).catch(function (e) { notify('✗ 保存货源失败: ' + String(e && e.message || e)); return null; });
      };
      const add1688Item = function (it) {
        addGood({ platform: '1688', url: it.url, title: it.title, priceRaw: it.priceRaw || it.price, img: it.img, supplier: it.company || null }, String(it.title || '').slice(0, 40));
      };
      const delGood = function (g) {
        api('/api/products/goods/delete', 'POST', { asin: p.asin, id: g.id, urlKey: g.urlKey }).then(function () { reloadGoods(); notify('🗑 已删除该货源'); })
          .catch(function (e) { notify('✗ ' + String(e && e.message || e)); });
      };
      // 抓取货源信息: 抓到后直接落库 (旧实现只弹提示, 数据没存 —— 这是 bug)
      const fetchGood = function () {
        if (!gUrl.trim()) { notify('请先粘贴货源链接'); return; }
        setFetchBusy(true); notify('抓取中 (~9 秒)…');
        api('/api/products/goods/fetch', 'POST', { url: gUrl.trim() }).then(function (r) {
          const j = r && r.json ? r.json : null;
          if (j && (j.title || j.priceRaw || j.price)) {
            return addGood({ platform: gPlat, url: gUrl.trim(), title: j.title, priceRaw: j.priceRaw || j.price, supplier: j.supplier, img: j.img }, String(j.title || '').slice(0, 40)).then(function () { setGUrl(''); setFetchBusy(false); });
          }
          setFetchBusy(false);
          notify('⚠ 未抓到标题/价格 — 已按纯链接保存, 价格可稍后手动补');
          return addGood({ platform: gPlat, url: gUrl.trim(), title: gUrl.trim().slice(0, 60) }, null).then(function () { setGUrl(''); });
        }).catch(function (e) { setFetchBusy(false); notify('✗ ' + String(e && e.message || e)); });
      };
      const addManual = function () {
        if (!gUrl.trim()) { notify('请粘贴货源链接'); return; }
        addGood({ platform: gPlat, url: gUrl.trim(), title: gUrl.trim().slice(0, 60) }, null).then(function () { setGUrl(''); });
      };
      // 比价: 货源价(¥) 换算成售价币种 → 占售价比例 (旧实现直接拿人民币减澳元, 结论是错的)
      // 比价: 到货成本 = 货源价 + 运费(手填); 基准价可选 BuyBox 或 最低跟卖价
      const goodRatio = function (g) {
        if (g.priceMin == null) return null;
        const sellPrice = (gRatioBasis === 'min' ? p.minPrice : p.buyBoxPrice) != null
          ? (gRatioBasis === 'min' ? p.minPrice : p.buyBoxPrice)
          : (p.minPrice != null ? p.minPrice : p.price);
        // 汇率口径必须与后端利润测算一致: 实时表(fxAll) → 内置兜底表; 绝不写死 7.8 (对 USD 货源会差 5%~16%)
        const FX_FALLBACK = { CNY: 1, EUR: 7.8, USD: 7.1, GBP: 9.1, JPY: 0.048, AUD: 4.85, CAD: 5.2, INR: 0.085, MXN: 0.4, BRL: 1.3, AED: 1.93, SAR: 1.89, SGD: 5.3, PLN: 1.85, SEK: 0.68, TRY: 0.2 };
        const fxFor = function (c) { if (!c) return null; if (c === 'CNY') return 1; if (fxAll && fxAll[c] != null) return Number(fxAll[c]); return FX_FALLBACK[c] != null ? FX_FALLBACK[c] : null; };
        const rt = rate || fxFor(cur) || 7.1;                    // 1 售价币种 = rt 人民币
        const gRate = fxFor(g.currency) || 7.1;                  // 货源币种 → 人民币 (1688 的 CNY 直接 1)
        const cny0 = (g.currency && g.currency !== 'CNY') ? g.priceMin * gRate : g.priceMin;
        const cny = cny0 + (Number(g.shipFee) || 0);
        if (!(sellPrice > 0) || !(rt > 0)) return null;
        const inSell = cny / rt;
        return { cny: cny, goodsCny: cny0, fee: Number(g.shipFee) || 0, inSell: inSell, ratioPct: inSell / sellPrice * 100, sellPrice: sellPrice };
      };
      // 货源变更 (运费/备注/角色) 统一走 patch / set-role
      const patchGood = function (g, patch) {
        return api('/api/products/goods/patch', 'POST', { asin: p.asin, id: g.id, urlKey: g.urlKey, patch: patch })
          .then(function () { reloadGoods(); }).catch(function (e) { notify('✗ 保存失败: ' + String(e && e.message || e)); });
      };
      const setRole = function (g, role) {
        return api('/api/products/goods/set-role', 'POST', { asin: p.asin, id: g.id, urlKey: g.urlKey, role: role })
          .then(function (r) {
            const j = (r && r.json) || {};
            reloadGoods();
            notify(j.role === 'primary' ? '⭐ 已设为现阶段最优供货' : j.role === 'backup' ? '已设为备选' : '已取消标记');
          }).catch(function (e) { notify('✗ ' + String(e && e.message || e)); });
      };
      const diffBadge = function (g) {
        const r = goodRatio(g);
        if (!r) return g.priceRaw ? h('span', { className: 'zyp-note', style: { fontSize: 10.5 } }, g.priceRaw) : null;
        const pct = r.ratioPct;
        const cls = pct <= 15 ? 'zyp-bg' : pct <= 30 ? 'zyp-bm' : 'zyp-br';
        return h('span', { className: 'zyp-badge ' + cls, title: '货源 ¥' + r.cny + ' ÷ 汇率 ' + (rate || '?') + ' = ' + (Math.round(r.inSell * 100) / 100) + ' ' + cur + ', 占售价 ' + (Math.round(pct * 10) / 10) + '%' },
          '货源占售价 ' + (Math.round(pct * 10) / 10) + '%  (¥' + r.cny + ' ≈ ' + CURR_SYM2[cur] + (Math.round(r.inSell * 100) / 100) + ')');
      };
      // 打开详情时重读一次货源 (补齐 id/结构化价格)
      React.useEffect(function () { if (!goods.length) reloadGoods(); }, []);
      // 把该货源(含运费)带入利润测算的货源成本
      const useGoodForProfit = function (g) {
        const v = (g.priceMin || 0) + (Number(g.shipFee) || 0);
        setSupply(String(v));
        notify('✔ 已带入利润测算: 货源成本 ¥' + v.toFixed(2) + (g.shipFee ? ' · 含运费 ¥' + g.shipFee : ''));
      };
      // 去货源页下单 (本地浏览器直接打开)
      const orderGood = function (g) {
        if (!g.url) { notify('该货源没有链接'); return; }
        openExternal(g.url, '下单: ' + String(g.title || '').slice(0, 30));
        notify('已在浏览器打开货源页, 可直接下单');
      };
      const onEnterBlur = function (e) { if (e.key === 'Enter') e.target.blur(); };
      const onShipFeeBlur = function (g, e) {
        const v = e.target.value.trim();
        const old = g.shipFee != null ? String(g.shipFee) : '';
        if (v !== old) patchGood(g, { shipFee: v === '' ? null : Number(v) });
      };
      const onNoteBlur = function (g, e) {
        const v = e.target.value.trim();
        if (v !== (g.note || '')) patchGood(g, { note: v || null });
      };
      const ratioCls = function (pct) { return pct <= 15 ? 'zyp-bg' : pct <= 30 ? 'zyp-bm' : 'zyp-br'; };
      // 单条货源行 (用子元素数组构建, 避免超长嵌套导致的括号错误)
      const renderGood = function (g, i) {
        const r = goodRatio(g);
        const isPrim = g.role === 'primary';
        const isBk = g.role === 'backup';
        const kids = [];
        kids.push(isPrim ? h('span', { className: 'zyp-badge zyp-bg' }, '⭐ 最优')
          : isBk ? h('span', { className: 'zyp-badge zyp-bm' }, '备选')
          : h('span', { className: 'zyp-badge zyp-bz' }, g.platform || '其他'));
        kids.push(h('span', { style: { flex: 1, minWidth: 140, cursor: 'pointer' }, title: g.title || g.url, onClick: function () { if (g.url) openExternal(g.url, String(g.title || '货源').slice(0, 40)); } }, String(g.title || g.url || '').slice(0, 42) + (g.url ? ' ↗' : '')));
        if (g.priceRaw) kids.push(h('span', null, g.priceRaw));
        if (g.moq) kids.push(h('span', { className: 'zyp-note' }, g.moq + '件起'));
        kids.push(h('span', { className: 'zyp-note', title: '供应商到货代/到仓的运费, 人民币手填' }, '运费¥'));
        kids.push(h('input', { className: 'zyp-input', defaultValue: g.shipFee != null ? String(g.shipFee) : '', placeholder: '0', style: { width: 46, padding: '0 3px' }, onBlur: function (e) { onShipFeeBlur(g, e); }, onKeyDown: onEnterBlur }));
        if (r) kids.push(h('span', { className: 'zyp-badge ' + ratioCls(r.ratioPct), title: '到货成本 ¥' + r.cny + ' = 货源 ¥' + r.goodsCny + ' + 运费 ¥' + r.fee + '; ÷ 汇率 ' + (rate || '?') + ' = ' + (Math.round(r.inSell * 100) / 100) + ' ' + cur }, '占售价 ' + (Math.round(r.ratioPct * 10) / 10) + '% (¥' + r.cny + ')'));
        kids.push(h('input', { className: 'zyp-input', defaultValue: g.note || '', placeholder: '备注', title: g.note || '填写备注: 时效/可否代发/账期…', style: { width: 118, padding: '0 4px' }, onBlur: function (e) { onNoteBlur(g, e); }, onKeyDown: onEnterBlur }));
        kids.push(h('button', { className: 'zyp-btn', title: '设为现阶段最优供货', onClick: function () { setRole(g, 'primary'); } }, isPrim ? '⭐ 取消最优' : '⭐ 设为最优'));
        kids.push(h('button', { className: 'zyp-btn', onClick: function () { setRole(g, 'backup'); } }, isBk ? '✓ 备选' : '设为备选'));
        if (g.priceMin != null) kids.push(h('button', { className: 'zyp-btn', title: '到货成本带入利润测算', onClick: function () { useGoodForProfit(g); } }, '→利润'));
        if (g.url) kids.push(h('button', { className: 'zyp-btn', style: { background: '#1e7a3c', borderColor: '#1e7a3c', color: '#fff' }, title: '打开货源商品页去下单 · 本地浏览器', onClick: function () { orderGood(g); } }, '🛒 去下单'));
        if (g.checkedAt) kids.push(h('span', { className: 'zyp-note' }, '核价 ' + String(g.checkedAt).slice(0, 10)));
        kids.push(h('button', { className: 'zyp-btn', onClick: function () { delGood(g); } }, '✕'));
        return h('div', { key: g.id || i, style: { display: 'flex', gap: 6, alignItems: 'center', padding: '5px 0', borderBottom: '1px dashed #26262c', fontSize: 12, flexWrap: 'wrap', background: isPrim ? 'rgba(95,208,138,.07)' : 'transparent' } }, kids);
      };
      // ---- compliance ----
      const comp = p.compliance;
      const offers = Array.isArray(p.offerPrices) ? p.offerPrices : [];
      const variants = (p.variants && Array.isArray(p.variants)) ? p.variants : (Array.isArray(p.variationAsins) ? [] : []);
      const btn = function (t, fn, opts) { return h('button', Object.assign({ className: 'zyp-btn', onClick: fn, disabled: !!busy && !opts }, opts || {}), t); };
          const kindColor = { fact: '#8ab4ff', auto: '#5fd08a', assume: '#f0b253', input: '#c9c9d1' };
          const profitCard = h('div', { className: 'zyp-card' },
            h('div', { className: 'zyp-h' }, '💰 利润测算 (与店铺/来源无关 · 单一算法) · ' + siteU + ' · ' + cur),
            h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 8, marginBottom: 8 } },
              h('div', null, h('div', { className: 'zyp-lbl' }, '配送方式 (决定成本结构)'),
                h('select', { className: 'zyp-input', value: fmode, onChange: function (e) { setFmode(e.target.value); }, style: { width: '100%' } },
                  h('option', { value: 'FBA' }, 'FBA (亚马逊配送)'), h('option', { value: 'FBM' }, 'FBM (自发货)'), h('option', { value: 'AMZ' }, 'AMZ (亚马逊自营占BuyBox)'))),
              h('div', null, h('div', { className: 'zyp-lbl' }, '售价口径'),
                h('select', { className: 'zyp-input', value: pBasis, onChange: function (e) { setPBasis(e.target.value); }, style: { width: '100%' } },
                  h('option', { value: 'buybox' }, 'BuyBox 价 ' + fmt(p.buyBoxPrice != null ? p.buyBoxPrice : p.price)), h('option', { value: 'min' }, '最低价 ' + fmt(p.minPrice != null ? p.minPrice : p.price)), h('option', { value: 'manual' }, '手填'))),
              pBasis === 'manual' ? h('div', null, h('div', { className: 'zyp-lbl' }, '手填售价 (' + cur + ')'), h('input', { className: 'zyp-input', type: 'number', step: 0.01, value: pManual, onChange: function (e) { setPManual(e.target.value); }, style: { width: '100%' } })) : null,
              h('div', null, h('div', { className: 'zyp-lbl' }, '货源成本 (¥)'), h('input', { className: 'zyp-input', type: 'number', step: 0.01, value: supply, onChange: function (e) { setSupply(e.target.value); }, placeholder: '1688 采购价', style: { width: '100%' } })),
              h('div', null, h('div', { className: 'zyp-lbl' }, fmode === 'FBM' ? '国际运费 (¥, 可一键按报价表算)' : '头程运费 中国→FBA仓 (¥)'), h('input', { className: 'zyp-input', type: 'number', step: 0.01, value: logi, onChange: function (e) { setLogi(e.target.value); }, placeholder: fmode === 'FBM' ? '报价表/手填' : '按 kg 摊到单件', style: { width: '100%' } })),
            h('div', null, h('div', { className: 'zyp-lbl' }, '重量 kg (一键算运费/FBA费用)'), h('input', { className: 'zyp-input', type: 'number', step: 0.01, value: wKg, onChange: function (e) { setWKg(e.target.value); }, placeholder: wG > 0 ? String(Math.round(wG / 10) / 100) : '商品未采到, 请填', style: { width: '100%' } })),
            h('div', null, h('div', { className: 'zyp-lbl' }, '尺寸 长x宽x高 cm'), h('input', { className: 'zyp-input', value: dims, onChange: function (e) { setDims(e.target.value); }, placeholder: dimArr[0] ? dimArr.join('x') : '如 30x20x10', style: { width: '100%' } })),
              h('div', null, h('div', { className: 'zyp-lbl' }, '关税/进口VAT (¥) ⚠需手填'), h('input', { className: 'zyp-input', type: 'number', step: 0.01, value: duty, onChange: function (e) { setDuty(e.target.value); }, placeholder: '需 HS 编码/货代报价', style: { width: '100%' } })),
              h('div', null, h('div', { className: 'zyp-lbl' }, '仓储/其他 (¥)'), h('input', { className: 'zyp-input', type: 'number', step: 0.01, value: storage, onChange: function (e) { setStorage(e.target.value); }, style: { width: '100%' } })),
              h('div', null, h('div', { className: 'zyp-lbl' }, 'ACOS (%)'), h('input', { className: 'zyp-input', type: 'number', step: 0.5, value: acos, onChange: function (e) { setAcos(e.target.value); }, style: { width: '100%' } })),
              h('div', null, h('div', { className: 'zyp-lbl' }, '退货率 (%)'), h('input', { className: 'zyp-input', type: 'number', step: 0.5, value: returnRate, onChange: function (e) { setReturnRate(e.target.value); }, style: { width: '100%' } })),
              h('div', null, h('div', { className: 'zyp-lbl' }, '收款手续费 (%)'), h('input', { className: 'zyp-input', type: 'number', step: 0.1, value: payRate, onChange: function (e) { setPayRate(e.target.value); }, style: { width: '100%' } })),
              h('div', null, h('div', { className: 'zyp-lbl' }, '汇损 (%)'), h('input', { className: 'zyp-input', type: 'number', step: 0.1, value: fxLoss, onChange: function (e) { setFxLoss(e.target.value); }, style: { width: '100%' } })),
              h('div', null, h('div', { className: 'zyp-lbl' }, '手改 VAT 率 (%)'), h('input', { className: 'zyp-input', type: 'number', step: 0.5, value: ovaVat, onChange: function (e) { setOvaVat(e.target.value); }, placeholder: '留空=按站点', style: { width: '100%' } })),
              h('div', null, h('div', { className: 'zyp-lbl' }, '手改 佣金率 (%)'), h('input', { className: 'zyp-input', type: 'number', step: 0.5, value: ovaComm, onChange: function (e) { setOvaComm(e.target.value); }, placeholder: '留空=按类目', style: { width: '100%' } })),
              h('div', null, h('div', { className: 'zyp-lbl' }, '手改 FBA 配送费 (' + cur + ')'), h('input', { className: 'zyp-input', type: 'number', step: 0.01, value: ovaFba, onChange: function (e) { setOvaFba(e.target.value); }, placeholder: p.fbaFee != null ? ('采集 ' + p.fbaFee) : '未采集, 需填', style: { width: '100%' } }))),
            h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 } },
              h('button', { className: 'zyp-btn', style: { background: '#2f6feb', borderColor: '#2f6feb', color: '#fff' }, onClick: doCalc, disabled: !!busy }, busy === 'calc' ? '测算中…' : '🧮 计算利润'),
              h('button', { className: 'zyp-btn', onClick: oneClick, disabled: !!busy }, busy === 'one' ? '计算中…' : '⚡ 一键计算'),
              h('button', { className: 'zyp-btn', onClick: loadRates }, '🔄 刷新汇率/税率'),
              h('span', { className: 'zyp-note' }, ratesTxt || '汇率读取中…'),
              h('span', { className: 'zyp-note', style: { marginLeft: 'auto' } }, '费用来源: ' + (taxInfo && taxInfo.eu ? taxInfo.eu.source : '税表') + ' · 欧盟VAT自动 / 非欧盟内置表')),
            prof ? h('div', null,
              h('table', { className: 'zyp-tbl', style: { fontSize: 12 } },
                h('thead', null, h('tr', null, h('th', null, '项目'), h('th', null, '金额 (¥)'), h('th', null, '算式'), h('th', null, '来源/类型'))),
                h('tbody', null, prof.items.map(function (it, i) {
                  return h('tr', { key: i },
                    h('td', null, it.label),
                    h('td', { style: { textAlign: 'right', fontWeight: 600, color: it.valueCny < 0 ? '#e08a8a' : '#7fe0a0' } }, (it.valueCny >= 0 ? '' : '') + it.valueCny.toFixed(2)),
                    h('td', { className: 'zyp-note', style: { fontSize: 11 } }, it.formula),
                    h('td', { className: 'zyp-note', style: { fontSize: 10.5, color: kindColor[it.kind] || undefined } }, it.source));
                }),
                h('tr', { style: { borderTop: '2px solid #444' } },
                  h('td', null, h('b', null, '净利 (¥)')),
                  h('td', { style: { textAlign: 'right', fontWeight: 700, color: prof.netCny >= 0 ? '#5fd08a' : '#f28b8b' } }, prof.netCny.toFixed(2)),
                  h('td', { className: 'zyp-note', colSpan: 2 }, '利润率 ' + prof.marginPct.toFixed(1) + '% · 收入 ¥' + prof.revenueCny.toFixed(2) + ' − 平台扣费 ¥' + prof.platformCny.toFixed(2) + ' − 采购物流 ¥' + prof.costCny.toFixed(2))))),
              h('div', { className: 'zyp-note', style: { marginTop: 6 } },
                '盈亏平衡价: ' + (prof.breakEvenPrice != null ? (S2(prof.breakEvenPrice) + ' (' + cur + ')') : '-') + ' · 目标利润率 ' + prof.targetMarginPct + '% → 需卖 ' + (prof.targetPrice != null ? (S2(prof.targetPrice) + ' (' + cur + ')') : '-')),
              prof.warnings && prof.warnings.length ? h('div', { className: 'zyp-note', style: { marginTop: 4, color: '#f0b253' } }, '⚠ ' + prof.warnings.join(' · ')) : null,
              h('div', { className: 'zyp-note', style: { marginTop: 4, fontSize: 10.5, opacity: .75 } }, '颜色: 蓝=已采集事实 · 绿=按表自动(类目/站点) · 黄=假设值(可改) · 灰=需你填写。关税/关税进口VAT 无法自动获取, 留 0 会高估利润。')) : h('div', { className: 'zyp-note' }, '填好货源成本/运费后点「🧮 计算利润」; 没有 FBA 配送费或重量数据时会明确提示需手填, 不会当 0 算。'));

      return h('div', null,
        // ===== 顶栏 =====
        h('div', { className: 'zyp-toolbar', style: { justifyContent: 'space-between' } },
          h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
            btn('← 返回列表', props.onBack),
            h('span', { className: 'zyp-h', style: { margin: 0 } }, '🔍 商品详情'),
            h('code', { style: { fontSize: 12 } }, p.asin),
            badges),
          h('div', null,
            h('span', { className: 'zyp-lnk', onClick: function () { openExternal(amzUrl, (p.title || p.asin).slice(0, 40)); } }, '⧉ Amazon 商品 ↗ '),
            p.shopUrl ? h('span', { className: 'zyp-lnk', onClick: function () { openExternal(p.shopUrl, '店铺'); } }, '🏪 店铺 ↗ ') : null,
            p.sellerPageUrl ? h('span', { className: 'zyp-lnk', onClick: function () { openExternal(p.sellerPageUrl, '卖家页'); } }, '👤 卖家页 ↗') : null)),
        // ===== 主图 + 标题 =====
        h('div', { className: 'zyp-card', style: { display: 'flex', gap: 14, alignItems: 'flex-start' } },
          mainImg ? h('img', { src: mainImg, onClick: function () { setBig(true); }, title: '点击放大', style: { width: 150, height: 150, objectFit: 'cover', borderRadius: 10, border: '1px solid #333', cursor: 'zoom-in', flex: '0 0 auto' } }) : null,
          h('div', { style: { flex: 1 } },
            h('div', { style: { fontSize: 15, fontWeight: 600, lineHeight: 1.5 } }, p.title || p.asin),
            h('div', { className: 'zyp-note', style: { marginTop: 6 } }, '「商品详情」完整视图 · 数据来自 /api/products/detail (含 compliance)')),
          h('div', null,
            claimed ? h('span', { className: 'zyp-badge zyp-bg' }, '✔ 已认领') : btn('📌 认领到草稿箱', doClaim, { style: { background: '#2f6feb', borderColor: '#2f6feb', color: '#fff' } }))),
        // ===== 概要字段 =====
        h('div', { className: 'zyp-card' },
          h('div', { className: 'zyp-h' }, '📋 商品概要 (' + p.asin + ')'),
          h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: '1px 18px' } }, gridRows)),
        // ===== 概要表 / 卖点 =====
        (ovArr.length || spArr.length) ? h('div', { className: 'zyp-card' },
          h('div', { className: 'zyp-h' }, '📄 产品概要 / 卖点'),
          ovArr.length ? h('table', { className: 'zyp-tbl', style: { minWidth: 0, width: '100%' } }, h('tbody', null, ovArr.map(function (o, i) { return h('tr', { key: i }, h('td', { style: { color: '#8a8a8a', width: 160 } }, String(o.k || o.label || '')), h('td', null, String(o.v == null ? '' : (typeof o.v === 'object' ? JSON.stringify(o.v) : o.v)))); }))) : null,
          spArr.length ? h('div', { style: { marginTop: 8 } }, spArr.map(function (s, i) { return h('div', { key: i, style: { fontSize: 12, padding: '2px 0' } }, '• ' + String(s)); })) : null) : null,
        // ===== 全部跟卖 =====
        h('div', { className: 'zyp-card' },
          h('div', { className: 'zyp-h' }, '🛒 全部跟卖 (' + offers.length + ')'),
          offers.length ? offers.map(function (o, i) { return h('div', { key: i, style: { display: 'flex', gap: 10, alignItems: 'flex-start', padding: '5px 0', borderBottom: '1px dashed #26262c', fontSize: 12, flexWrap: 'wrap' } },
            h('span', { className: 'zyp-lnk', onClick: function () { if (o.sellerUrl) openExternal(o.sellerUrl, String(o.seller || o.sellerId || '')); else if (o.sellerId) openExternal('https://www.amazon.' + amzDom + '/sp?seller=' + o.sellerId, String(o.sellerId)); } }, (o.chinaSeller ? '🇨🇳 ' : '') + String(o.seller || o.sellerId || '-') + ' ↗'),
            o.price != null ? h('b', null, fmt(o.price)) : null,
            h('span', { className: 'zyp-note' }, (o.fulfillment || o.fulfill || '') + (o.shipFee != null ? ' +运费' + o.shipFee : '') + (o.shipDates ? ' · ' + o.shipDates : '') + (o.condition ? ' · ' + o.condition : '') + (o.quantity != null ? ' · 数量' + o.quantity : ''))); }) : h('div', { className: 'zyp-note' }, '无跟卖数据')),
        // ===== 变体 =====
        (function () {
          if (!(variants.length || (p.variations != null))) return null;
          const groupEls = variants.map(function (g, gi) {
            const opts = Array.isArray(g.options) ? g.options : (Array.isArray(g) ? g : []);
            const chipEls = opts.map(function (o, oi) { return h('button', { key: oi, className: 'zyp-btn', style: { fontSize: 11.5 } }, String(o.text || o.label || o.asin || o) + (o.price != null ? ' ' + fmt(o.price) : '')); });
            return h('div', { key: gi, style: { marginBottom: 6 } },
              h('div', { className: 'zyp-lbl' }, String(g.dim || g.name || ('分组' + (gi + 1)))),
              h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 4 } }, chipEls));
          });
          return h('div', { className: 'zyp-card' },
            h('div', { className: 'zyp-h' }, '🧩 变体 (' + (p.variations != null ? p.variations : variants.length) + ')'),
            groupEls);
        })(),
            profitCard,
        // ===== 查商标 =====
        h('div', { className: 'zyp-card' },
          h('div', { className: 'zyp-h' }, '🏛 查商标 · 品牌 ' + (p.brand || '') + (p.tmMark ? ' (TM标)' : '') + (p.bgMark ? ' (BG标)' : '') + (p.trademarkCount ? ' · 已记录 ' + p.trademarkCount + ' 条' : '')),
          h('div', { className: 'zyp-note', style: { marginBottom: 6 } }, '打开对应国家/地区官方商标局 (点击在浏览器新标签打开)。查到已注册商标 = 侵权风险, 请谨慎使用该品牌。'),
          h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 5 } }, offices.map(function (o, i) { return h('button', { key: i, className: 'zyp-btn', style: { fontSize: 11.5 }, onClick: function () { openExternal(o[1], o[0]); } }, o[0] + ' ↗'); }))),
        // ===== 找货 / 图搜 =====
        h('div', { className: 'zyp-card' },
          h('div', { className: 'zyp-h' }, '🛍 找货源 · 以图搜图 (点一下即在浏览器新标签打开结果页, 无需手动上传/粘贴)'),
          h('div', { className: 'zyp-note', style: { marginBottom: 6 } }, srcList ? (srcList.hasImage ? '主图: ' + String(srcList.image).slice(0, 60) + '… (可被外部抓取, 已实测)' : '⚠ 该商品无主图 → 只能用关键词搜') : '平台清单加载中…'),
          // 图片 URL 直通图搜 (零人工)
          h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 } },
            h('span', { className: 'zyp-note', style: { minWidth: 96 } }, '以图搜图 (直接开浏览器):'),
            (srcList && srcList.group.imgUrl ? srcList.group.imgUrl : []).map(function (x) {
              return h('button', { key: x.k, className: 'zyp-btn', style: { fontSize: 11.5, opacity: x.ready ? 1 : .45 }, title: x.verified + (x.note ? ' · ' + x.note : ''), onClick: function () { goImageSearch(x); } }, x.name + ' 图搜 ↗');
            }),
            h('button', { className: 'zyp-btn', style: { fontSize: 11.5 }, onClick: loadSources }, '⟳')),
          // CDP 自动上传 (后端执行, 依然零人工)
          h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 } },
            h('span', { className: 'zyp-note', style: { minWidth: 96 } }, '其他方式 (后端执行/关键词):'),
            btn(gBusy ? '1688 找货中…' : '1688 (解析结果入库)', do1688, gBusy ? { disabled: true } : {}),
            (srcList && srcList.group.cdp ? srcList.group.cdp : []).map(function (x) {
              return h('button', { key: x.k, className: 'zyp-btn', style: { fontSize: 11.5 }, title: x.verified, onClick: function () { goImageSearch(x); } }, x.name + ' 自动图搜');
            }),
            (srcList && srcList.group.keyword ? srcList.group.keyword : []).map(function (x) {
              return h('button', { key: x.k, className: 'zyp-btn', style: { fontSize: 11.5, opacity: .6 }, title: '该平台网页端无图搜, 只能用关键词', onClick: function () { goImageSearch(x); } }, x.name + ' (关键词) ↗');
            })),
          cdpOut ? h('div', { className: 'zyp-note', style: { marginBottom: 6 } },
            cdpOut.loading ? '⏳ ' + cdpOut.site + ' 自动上传中…'
              : cdpOut.err ? h('span', { style: { color: '#f28b8b' } }, '✗ ' + cdpOut.site + ': ' + cdpOut.err)
                : h('span', null, '✔ ' + cdpOut.site + ' 已自动完成图搜 → ' + (cdpOut.pageUrl ? h('span', { className: 'zyp-lnk', onClick: function () { openExternal(cdpOut.pageUrl, cdpOut.site + ' 图搜结果'); } }, '打开结果页 ↗') : '') + ' (解析到 ' + (cdpOut.results || []).length + ' 条)')) : null),
        // ===== 货源记录 =====
        h('div', { className: 'zyp-card' },
          h('div', { className: 'zyp-h' }, '📦 货源记录 (' + goods.length + ')'),
          (function () {
            if (!goods.length) return h('div', { className: 'zyp-note' }, '暂无货源记录 — 用上方「找货」图搜或粘贴链接添加。');
            const sorted = goods.slice().sort(function (a, b) {
              const w = function (x) { return x.role === 'primary' ? 0 : x.role === 'backup' ? 1 : 2; };
              return w(a) - w(b) || ((a.priceMin || 1e9) - (b.priceMin || 1e9));
            });
            const prim = sorted.find(function (x) { return x.role === 'primary'; });
            const bkCount = sorted.filter(function (x) { return x.role === 'backup'; }).length;
            const primCost = prim ? ((prim.priceMin || 0) + (Number(prim.shipFee) || 0)).toFixed(2) : null;
            const headerKids = [];
            headerKids.push(prim
              ? h('span', null, '⭐ 现阶段最优: ' + String(prim.title || prim.url || '').slice(0, 36) + ' · 到货 ¥' + primCost)
              : h('span', { style: { color: '#f0b253' } }, '⚠ 还没选定「现阶段最优供货」— 点某行的「⭐ 设为最优」'));
            headerKids.push(h('span', null, ' · 备选 ' + bkCount + ' 个 · 比价基准 '));
            headerKids.push(h('select', { className: 'zyp-input', value: gRatioBasis, onChange: function (e) { setGRatioBasis(e.target.value); }, style: { fontSize: 11, padding: '0 2px' } },
              h('option', { value: 'buybox' }, 'BuyBox 价'), h('option', { value: 'min' }, '最低跟卖价')));
            return h('div', null, h('div', { className: 'zyp-note', style: { marginBottom: 4 } }, headerKids), sorted.map(renderGood));
          })(),
          h('div', { style: { marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' } },
            h('select', { className: 'zyp-input', value: gPlat, onChange: function (e) { setGPlat(e.target.value); } }, ['1688', '淘宝', '拼多多', 'Amazon', 'Alibaba', '其他'].map(function (x) { return h('option', { key: x, value: x }, x); })),
            h('input', { className: 'zyp-input', value: gUrl, onChange: function (e) { setGUrl(e.target.value); }, placeholder: '粘贴 1688/淘宝/拼多多 商品链接…', style: { flex: 1, minWidth: 180 } }),
            btn(fetchBusy ? '抓取中…' : '🔍 抓取并保存', fetchGood, fetchBusy ? { disabled: true } : {}),
            btn('➕ 添加', addManual))),
        // ===== 合规 =====
        comp ? h('div', { className: 'zyp-card' },
          h('div', { className: 'zyp-h' }, '🛡 合规检测' + (comp.level ? (' · ' + ({ high: '高风险', medium: '中风险', low: '低风险' }[comp.level] || comp.level)) : '')),
          comp.score != null ? h('div', { className: 'zyp-note' }, '合规评分: ' + comp.score + '/100' + (comp.checkedAt ? ' · ' + comp.checkedAt : '')) : null,
          comp.brandHit ? h('div', { className: 'zyp-note' }, '品牌库命中: ' + String(comp.brandHit)) : null,
          Array.isArray(comp.reasons) && comp.reasons.length ? h('div', { style: { marginTop: 4 } }, comp.reasons.map(function (r, i) { return h('div', { key: i, style: { fontSize: 12, color: '#f0b253' } }, '⚠ ' + String(r)); })) : null) : null,
        // ===== 弹窗 =====
        big ? h(Modal, { title: (p.title || p.asin).slice(0, 80), onClose: function () { setBig(false); }, children: h('div', { style: { textAlign: 'center' } }, h('img', { src: mainImg, style: { maxWidth: '100%', maxHeight: '75vh', borderRadius: 8 } })) }) : null
      );
    }


    function ProductPage(props) {
      const seed = props && props.seed ? props.seed : null;
      // seed 的 from/to 为 UTC ("YYYY-MM-DD HH:MM") → 转本地 datetime-local 值 (YYYY-MM-DDTHH:MM)
      const utcToLocalInput = function (s) {
        if (!s) return '';
        const d = new Date(String(s).replace(' ', 'T') + ':00Z');
        if (isNaN(d.getTime())) return String(s).replace(' ', 'T').slice(0, 16);
        const p2 = function (n) { return (n < 10 ? '0' : '') + n; };
        return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + 'T' + p2(d.getHours()) + ':' + p2(d.getMinutes());
      };
      // flt = 统一过滤条件 (NF 模板; 与采集过滤同一 schema) —— 唯一数据源
      const [flt, setFlt] = React.useState(function () { const b = NF(); if (seed) { b.collectedFrom = utcToLocalInput(seed.collectedFrom); b.collectedTo = utcToLocalInput(seed.collectedTo); } return b; });
      const [fopen, setFopen] = React.useState(true);   // 默认展开 (与采集面板一致, 打开就能看到筛选)
      // ★ 2026-09-25: 「上次真正发出查询用的筛选 JSON」——用来判断"条件改了但还没查"
      const [appliedJson, setAppliedJson] = React.useState(null);
      // ★ 2026-09-25 反馈条: 每次应用筛选后写清楚「多少条 → 多少条」, 没变就直说没变
      const [fltNote, setFltNote] = React.useState(null);   // null | { warn, text }
      // ★ 2026-09-25 根治"旧闭包"问题: 「✕ 清除」「大类目下拉」等 6 处都是 setTimeout(load) 调 load,
      //   而 load 里读的是闭包里的 flt —— 那一刻 React 可能还没把 setFlt 的新值渲染出来,
      //   于是"清掉了条件却仍按旧条件查询"(实测: 界面显示 0 项条件, 列表却没变)。
      //   改成 render 时同步到 ref, load 一律读 ref, 任何调用点都拿最新条件。
      const fltRef = React.useRef(flt); fltRef.current = flt;
      const appliedRef = React.useRef(null);   // 上次真正查询用的 filter JSON
      const totalRef = React.useRef(null);     // 上次查询的结果条数(用于"变了没变")
      const [items, setItems] = React.useState(null);
      const [total, setTotal] = React.useState(0);
      // 页码/每页条数: 初值取上次记忆(面板关掉再打开、切走再切回都还在当前页)
      const [page, setPage] = React.useState(function () { return Math.max(1, Number(readPmState().page) || 1); });
      const [size, setSize] = React.useState(function () { const s = Number(readPmState().size); return [20, 50, 100, 200].indexOf(s) >= 0 ? s : 50; });
      const [sel, setSel] = React.useState({});
      // ── 常驻视口联动品牌汇总（贴在列表下方, 随滚动窗口实时统计当前可见的品牌）────────────
      const [vpBrands, setVpBrands] = React.useState([]);      // 视口内品牌聚合 [{brand,n,min,max,avg,rankP,rankC,follow,asins}]
      const [vpVisible, setVpVisible] = React.useState(0);     // 视口内可见行数
      const [vpAsins, setVpAsins] = React.useState([]);        // 视口内商品的 ASIN 顺序 (按商品视图用)
      const [famFold, setFamFold] = React.useState(true);      // ★ 变体族折叠 (默认开): 同族只显示一行
      const [bfRepOnly, setBfRepOnly] = React.useState(false); // ★ 补采: 族内只补代表(实测省 68% 补采量)
      const [famModal, setFamModal] = React.useState(null);    // 展开的族: { key, kind, members }
      const [vpMode, setVpMode] = React.useState('product');   // ★ 默认按【商品】排序展示 (2026-09); 'brand'=按品牌聚合
      const [vpSel, setVpSel] = React.useState({});            // 勾选的品牌
      const [vpSort, setVpSort] = React.useState('price-asc'); // 价格↑/价格↓/父类排名/子类排名/跟卖/商品数
      const [vpOnly, setVpOnly] = React.useState(false);       // 只看勾选品牌
      const [vpOpen, setVpOpen] = React.useState(true);        // 面板折叠
      // 排名数字底色(可自定义): 配置存 localStorage, 卡片上点排名数字 / 工具条「🎨 排名底色」都能改
      const [rankCfg, setRankCfg] = React.useState(function () { return readRankCfg(); });
      const [rankCfgOpen, setRankCfgOpen] = React.useState(false);
      React.useEffect(function () { writeRankCfg(rankCfg); }, [rankCfg]);
      // 商品卡片底色(可自定义): 分档配色(默认/FBA/FBM/AMZ), 同样存 localStorage
      const [cardBg, setCardBg] = React.useState(function () { return readCardBg(); });
      const [cardBgOpen, setCardBgOpen] = React.useState(false);
      // (老版的"当前配色档位"状态已去掉: 现在每档一行各改各的, 不需要先选目标)
      React.useEffect(function () { writeCardBg(cardBg); }, [cardBg]);
      // 卡片大小(放大/缩小): 一个倍数同时缩放卡片与字号, 存 localStorage
      const [cardScale, setCardScale] = React.useState(function () { return readCardScale(); });
      React.useEffect(function () { writeCardScale(cardScale); }, [cardScale]);
      const stepScale = function (d) { setCardScale(function (v) { return clampCardScale((Number(v) || 1) + d); }); };
      const vpScrollRef = React.useRef(null);                  // 普通模式的滚动容器
      const vpFullRef = React.useRef(null);                    // 全屏模式的滚动容器
      const [msg, setMsg] = React.useState(null);
      const [task, setTask] = React.useState('');
      const [busy, setBusy] = React.useState('');
      // ★ 打开链接的进度/续开面板: {busy, batch, done, opened, total, restQ, kinds, cur, stopped}
      const [openMore, setOpenMore] = React.useState(null);
      // ★ 链接分类管理: 勾选要打开哪几类(默认只开商品页), 选择记在 localStorage
      const [linkKinds, setLinkKinds] = React.useState(function () { return readLinkKinds(); });
      const [linkPick, setLinkPick] = React.useState(null);    // {rows, byKind, total} = 分类弹窗
      React.useEffect(function () { writeLinkKinds(linkKinds); }, [linkKinds]);
      const [expOpen, setExpOpen] = React.useState(false);
      const [full, setFull] = React.useState(false);          // 全屏框: 商品列表整体铺满屏幕
      const [zoom, setZoom] = React.useState(1.3);            // 全屏时的整体放大倍数 (整个列表 UI 等比放大)
      React.useEffect(function () {
        if (!full) return;
        const onKey = function (e) { if (e.key === 'Escape') setFull(false); };
        window.addEventListener('keydown', onKey);
        return function () { window.removeEventListener('keydown', onKey); };
      }, [full]);
      const [catTree, setCatTree] = React.useState(null);      // {sources:{bc,bsr,none}, tree:[{cat1,count,children:[{cat2,count}]}]}
      const [tmCountryOpts, setTmCountryOpts] = React.useState([]);   // ★ 「排除商标国家」多选下拉的选项
      React.useEffect(function () { loadFilterSpecOnce(api, function (j) { setTmCountryOpts(j.tmCountryOptions || []); }); }, []);
      const [govOpen, setGovOpen] = React.useState(false);
      const [gov, setGov] = React.useState(null);          // 货源总览 /api/goods/overview
      const loadGoodsOverview = function () {
        api('/api/goods/overview', 'GET', null).then(function (r) {
          const j = r && r.json ? r.json : null;
          if (j && j.totalGoods != null) setGov(j);
        }).catch(function () {});
      };
      // 统一过滤条件 → 查询串 (本地时间→UTC 后交给后端 /api/products?filter=)
      const localToUtcMin2 = function (val) {
        const s = String(val || '').trim();
        if (!s) return '';
        const d = new Date(s);
        if (isNaN(d.getTime())) return s.replace('T', ' ').slice(0, 16);
        return d.toISOString().slice(0, 16).replace('T', ' ');
      };
      const filterJson = function (f) {
        const o = Object.assign({}, f);
        /* ★ 2026-10-02: 查商品库时把【采集专有条件】剔干净。
         * 为什么必须剔: 这些键服务端 /api/products 不认, 但会原样进 filter JSON ——
         *   · 面板里已经按 mode 不显示了, 可是旧的已保存筛选/浏览器缓存里可能还留着值
         *   · 留着就会造成"以为生效了其实没生效"的错觉(用户实测反馈: 点了没反应)
         * 剔除后: 商品库查询只带真正生效的条件, 与面板所见一致, 也就不会再出现
         * "填了 A+店铺/品牌店铺/他牌商品 结果一条没变"的现象。 */
        ['shopAplus', 'brandShop', 'brandStore', 'dropOtherBrand'].forEach(function (k) { delete o[k]; });
        if (o.collectedFrom) o.collectedFrom = localToUtcMin2(o.collectedFrom);
        if (o.collectedTo) o.collectedTo = localToUtcMin2(o.collectedTo);
        return JSON.stringify(o);
      };
      const loadCatTree = function () {
        api('/api/products/cat-tree', 'GET', null).then(function (r) {
          if (r && r.ok && r.json && r.json.tree) setCatTree(r.json);
        }).catch(function () {});
      };
      const deriveCat = function () {
        setTask('推算类目中…');
        api('/api/products/derive-cat', 'POST', {}).then(function (r) {
          setTask('');
          const j = (r && r.json) || {};
          setMsg('🧭 已用榜单类目推算出 ' + (j.derived || 0) + ' 个商品的一级/二级类目 (跳过 ' + (j.noBsr || 0) + ' 个无榜单数据的)');
          loadCatTree();
        }).catch(function (e) { setTask(''); setMsg('✗ 推算失败: ' + String(e && e.message || e)); });
      };
      /**
       * 拉列表。keepPage=false 才回到第 1 页（用于「应用筛选/搜索/清除」这类结果集变了的动作）；
       * 默认保留当前页 —— 保存、删除、批量操作、看详情返回、刷新按钮都不该把人踢回顶部。
       * 越界自动回收: 删了商品或改了每页条数后当前页可能超范围 → 收到最后一页, 不留空白页。
       */
      const load = function (keepPage) {
        setTask('加载中…');
        const fjUse = filterJson(fltRef.current);          // ★ 读 ref: 永远是最新条件(不被旧闭包坑)
        const prevJson = appliedRef.current, prevTotal = totalRef.current;   // 用来算"这次到底变没变"
        // ★ 条件数从"实际发出去的那份 filter"里数(不要数闭包里的 flt: 「✕ 清除」是在 setTimeout 里调 load,
        //   那一刻闭包的 flt 还是旧值 → 实测会把"清除筛选"错报成"1 项条件生效")
        const nCond = (function () { try { const o = JSON.parse(fjUse); return Object.keys(o).filter(function (k) { const val = o[k]; return Array.isArray(val) ? val.length > 0 : (typeof val === 'boolean' ? val : (val !== '' && val != null)); }).length } catch (e) { return 0 } })();
        const isApply = prevJson != null && fjUse !== prevJson;   // 只有"条件真改了"才算应用筛选(单纯刷新不提示)
        appliedRef.current = fjUse; setAppliedJson(fjUse);
        if (isApply) setFltNote({ warn: false, text: '⏳ 正在按 ' + nCond + ' 项条件查询…' });
        api('/api/products?filter=' + encodeURIComponent(fjUse), 'GET', null).then(function (r) {
          if (r && r.ok && r.json) {
            const n = r.json.items || [];
            const nowTotal = r.json.total || 0;
            totalRef.current = nowTotal;
            setItems(n); setTotal(nowTotal);
            // ★ 结果反馈: 没有反馈, 用户只能靠"看列表眼熟不眼熟"判断, 于是就有了"点了没变"这个疑问
            if (isApply) {
              if (nCond === 0) setFltNote({ warn: false, text: '✓ 已清除筛选: 共 ' + nowTotal + ' 条' });
              else if (prevTotal != null && nowTotal === prevTotal) setFltNote({ warn: true, text: '⚠ ' + nCond + ' 项条件已提交, 但结果还是 ' + nowTotal + ' 条(一条没少) —— 说明这些条件对现有数据没有区分度: ① 「排除类」条件遇到没有该项数据的商品会放行(如排除商标国家/排除商标数, 库里多为空); ② 带 * 的店铺维度条件只在采集时判定。换个正条件(如价格区间/月销/大排名状态/关键词)就能看出效果。' });
              else setFltNote({ warn: false, text: '✓ ' + nCond + ' 项条件生效: ' + (prevTotal != null ? prevTotal + ' → ' : '') + nowTotal + ' 条' });
            }
            const lastPage = Math.max(1, Math.ceil(n.length / size));
            setPage(function (p0) {
              // ★ 只有真拿到数据才做越界回收: 空列表(还没加载/筛选后确实没商品)时 lastPage=1,
              //   照收会把记忆里的页码冲成 1 —— 刷新一次「保持当前页」就失效了。
              if (!n.length) return p0 || 1;
              const want = (keepPage === false) ? 1 : (p0 || 1);
              return Math.min(Math.max(1, want), lastPage);
            });
          }
          setTask('');
        }).catch(function (e) { setTask(''); setMsg('加载失败: ' + String(e && e.message || e)); });
      };
      // 页码/每页条数落盘: 用 effect 统一兜住所有改动路径(翻页按钮、筛选归位、越界回收…)
      React.useEffect(function () { writePmState({ page: page, size: size }); }, [page, size]);
      React.useEffect(function () { loadCatTree(); load(true); }, []);
      // 「只看勾选品牌」= 直接筛整个结果集(不是只筛当前页), 这样翻页看到的也都是勾选品牌
      const brandKeyOf = function (p) { return String((p && p.brand) || '(无品牌)').trim() || '(无品牌)'; };
      const shownItems = !vpOnly ? (items || []) : (items || []).filter(function (p) { return !!vpSel[brandKeyOf(p)]; });
      const pages = items ? Math.max(1, Math.ceil(shownItems.length / size)) : 1;
      // 显示用页码: 空列表/暂时越界时只影响这一屏的显示, 不改记忆里的 page(改了就等于把"保持当前页"冲掉)
      const shownPage = Math.min(page, pages) || 1;
      const cur = items ? shownItems.slice((shownPage - 1) * size, shownPage * size) : [];
      // ★ 变体族折叠 (2026-09): 族键 = parentAsin(代表 ASIN); 族成员/大小按【全量 items】统计(不只当前页)。
      //   折叠时同族只留一行, 优先显示族代表(采集时已按"跟卖数最多"等规则选好)。
      const famKeyOf = function (x) { return (x && (x.parentAsin || x.asin)) || null; };
      const famSize = {}, famMembers = {};
      (items || []).forEach(function (x) {
        const k = famKeyOf(x);
        if (!k) return;
        famSize[k] = (famSize[k] || 0) + 1;
        if (!famMembers[k]) famMembers[k] = [];
        famMembers[k].push(x);
      });
      const foldedCur = (function () {
        if (!famFold) return cur;
        const seen = {}; const out = [];
        cur.forEach(function (x) {
          const k = famKeyOf(x);
          if (!k) { out.push(x); return; }
          if (seen[k]) return;
          seen[k] = 1;
          // 族代表优先显示(代表可能不在本页 → 退回本页第一条)
          out.push(cur.filter(function (y) { return famKeyOf(y) === k && (y.variantRole === 'parent' || y.asin === k); })[0] || x);
        });
        return out;
      })();
      const foldHidden = cur.length - foldedCur.length;
      const selArr = function () { return Object.keys(sel).filter(function (k) { return sel[k]; }); };
      const byAsin = {};
      (items || []).forEach(function (p) { byAsin[p.asin] = p; });
      /**
       * 视口联动: 统计"当前滚动窗口里可见的行"的品牌聚合。
       * 用行的 getBoundingClientRect 跟滚动容器的框做相交判断(比 IntersectionObserver 更直观,
       * 而且翻页/筛选/全屏切换都不用重建观察器)。
       */
      const computeVp = function () {
        const box = (full ? vpFullRef.current : vpScrollRef.current);
        if (!box) { setVpBrands([]); setVpVisible(0); return }
        const br = box.getBoundingClientRect();
        const trs = box.querySelectorAll('.zyp-pcard[data-asin]');   // 卡片流: 每个商品一张卡
        const vis = [];
        for (let i = 0; i < trs.length; i++) {
          const r = trs[i].getBoundingClientRect();
          if (r.bottom > br.top && r.top < br.bottom) vis.push(trs[i].getAttribute('data-asin'));
        }
        const g = {};
        vis.forEach(function (asin) {
          const p = byAsin[asin];
          if (!p) return;
          const k = brandKeyOf(p);
          if (!g[k]) g[k] = { brand: k, n: 0, min: null, max: null, sum: 0, cnt: 0, rankP: null, rankC: null, follow: 0, asins: [], cur: null };
          const o = g[k];
          o.n++; o.asins.push(asin);
          if (!o.cur && p.currency) o.cur = p.currency;     // 币种按品牌自己那条商品走(多站混采时价格不能混着看)
          const v = (p.minPrice != null ? p.minPrice : p.price);
          if (v != null && isFinite(Number(v))) {
            const nv = Number(v);
            o.min = (o.min == null) ? nv : Math.min(o.min, nv);
            o.max = (o.max == null) ? nv : Math.max(o.max, nv);
            o.sum += nv; o.cnt++;
          }
          if (p.rankParent != null && (o.rankP == null || p.rankParent < o.rankP)) o.rankP = p.rankParent;
          if (p.rankChild != null && (o.rankC == null || p.rankChild < o.rankC)) o.rankC = p.rankChild;
          if (p.followCount != null) o.follow = Math.max(o.follow, Number(p.followCount) || 0);
        });
        const list = Object.keys(g).map(function (k) { const o = g[k]; o.avg = o.cnt ? o.sum / o.cnt : null; return o; });
        setVpBrands(list);
        setVpVisible(vis.length);
        setVpAsins(vis);
      };
      // 滚动/翻页/筛选/全屏切换后重算(用 rAF 合并滚动事件, 避免每像素都算一次)
      React.useEffect(function () {
        const box = (full ? vpFullRef.current : vpScrollRef.current);
        let raf = 0;
        const kick = function () { if (raf) return; raf = requestAnimationFrame(function () { raf = 0; computeVp(); }); };
        const t = setTimeout(computeVp, 0);                 // 首次渲染后先算一次
        if (box) box.addEventListener('scroll', kick, { passive: true });
        window.addEventListener('resize', kick);
        return function () { clearTimeout(t); if (box) box.removeEventListener('scroll', kick); window.removeEventListener('resize', kick); if (raf) cancelAnimationFrame(raf); };
      }, [items, size, shownPage, full, vpOnly, vpSel]);
      const vpSorted = vpBrands.slice().sort(function (a, b) {
        // ★ 缺失值(该品牌在当前窗口内的商品没价格 / 没排名)一律排最后; 两个都缺时判相等。
        //   老写法 `v == null ? Infinity : v` 有两个坑(实测):
        //     ① 降序时 Infinity 被当最大值 → 缺价格的品牌反而顶到第一行;
        //     ② 两个都缺时 Infinity - Infinity = NaN, 而 NaN 的比较结果在规范里是未定义的
        //        → 同一批数据每次渲染顺序会抖(实测 30 次乱序输入出两种顺序)。
        //   注意: 缺值判断必须用**原始参数**, 不能靠"交换参数"来降序 —— 那样会把缺失值也一起换到前面。
        const num = function (v) { const n = Number(v); return (v == null || v === '' || !isFinite(n)) ? null : n };
        const cmp = function (x, y, dir) {                  // dir=1 升序 / -1 降序, 缺值永远垫底
          const x1 = num(x), y1 = num(y);
          if (x1 == null && y1 == null) return 0;
          if (x1 == null) return 1;
          if (y1 == null) return -1;
          return dir * (x1 - y1);
        };
        if (vpSort === 'price-desc') return cmp(a.min, b.min, -1);
        if (vpSort === 'rank-parent') return cmp(a.rankP, b.rankP, 1);
        if (vpSort === 'rank-child') return cmp(a.rankC, b.rankC, 1);
        if (vpSort === 'follow') return cmp(a.follow, b.follow, -1);
        if (vpSort === 'count') return cmp(a.n, b.n, -1);
        if (vpSort === 'brand') return String(a.brand || '').localeCompare(String(b.brand || ''));
        if (vpSort === 'avg') return cmp(a.avg, b.avg, -1);
        return cmp(a.min, b.min, 1);                        // 默认: 最低价升序
      });
      // ★ 按【商品】排序 (2026-09): 视口内每个商品一行, 用商品自己的字段排 —— 不是品牌聚合值。
      //   口径与品牌级一致: 缺值一律垫底, 两个都缺判相等(避免 NaN 导致每次渲染顺序抖动)。
      const vpProdSorted = (vpAsins || []).map(function (a) { return byAsin[a]; }).filter(Boolean).sort(function (a, b) {
        const num2 = function (v) { const n = Number(v); return (v == null || v === '' || !isFinite(n)) ? null : n };
        const cmp2 = function (x, y, dir) {
          const x1 = num2(x), y1 = num2(y);
          if (x1 == null && y1 == null) return 0;
          if (x1 == null) return 1;
          if (y1 == null) return -1;
          return dir * (x1 - y1);
        };
        const pv = function (p) { return (p.minPrice != null ? p.minPrice : p.price) };
        if (vpSort === 'brand') return String(a.brand || '').localeCompare(String(b.brand || ''));
        if (vpSort === 'rank-parent') return cmp2(a.rankParent, b.rankParent, 1);
        if (vpSort === 'rank-child') return cmp2(a.rankChild, b.rankChild, 1);
        if (vpSort === 'follow') return cmp2(a.followCount, b.followCount, -1);
        if (vpSort === 'price-desc') return cmp2(pv(a), pv(b), -1);
        // 'count'/'avg' 是品牌口径的键 —— 商品视图下退回价格升序 (表头也不会给出这两个键)
        return cmp2(pv(a), pv(b), 1);
      });
      const vpSelBrands = Object.keys(vpSel).filter(function (k) { return vpSel[k]; });
      const vpSelAsins = (items || []).filter(function (p) { return !!vpSel[brandKeyOf(p)]; }).map(function (p) { return p.asin; });
      const toggle = function (id) { setSel(function (o) { const n = Object.assign({}, o); n[id] = !n[id]; return n; }); };
      const allOn = cur.length && cur.every(function (x) { return sel[x.asin]; });
      const someOn = cur.some(function (x) { return sel[x.asin]; });
      const toggleAll = function (e) { const v = e.target.checked; const n = Object.assign({}, sel); cur.forEach(function (x) { n[x.asin] = v; }); setSel(n); };
      const needSel = function () { const a = selArr(); if (!a.length) { setMsg('请先勾选商品'); return null; } return a; };
      const after = function () { setSel({}); load(); };
      const batchSave = function () { const a = needSel(); if (!a) return; api('/api/products/save', 'POST', { asins: a, saved: true }).then(function (r) { setMsg('✔ 已保存 ' + a.length + ' 个商品到产品库'); load(); }).catch(function (e) { setMsg('✗ ' + String(e && e.message || e)); }); };
      const batchClaim = function () { const a = needSel(); if (!a) return; let ok = 0; const next = function (i) { if (i >= a.length) { setMsg('✔ 已认领 ' + ok + '/' + a.length + ' 个到草稿箱'); return; } api('/api/claims', 'POST', { asin: a[i] }).then(function () { ok++; next(i + 1); }).catch(function () { next(i + 1); }); }; next(0); };
      const batchSync = function () { const a = needSel(); if (!a) return; api('/api/products/sync', 'POST', { asins: a }).then(function () { setMsg('🔄 已同步刷新 ' + a.length + ' 个商品'); load(); }).catch(function (e) { setMsg('✗ ' + String(e && e.message || e)); }); };
      const batchDelete = function () { const a = needSel(); if (!a) return; setMsg(null); setModal2({ title: '删除商品', rows: ['确定删除选中的 ' + a.length + ' 个商品吗?'], onOk: function () { api('/api/products/delete', 'POST', { asins: a }).then(function (r) { setMsg('🗑 已删除 ' + a.length + ' 个商品'); after(); }).catch(function (e) { setMsg('✗ ' + String(e && e.message || e)); }); } }); };
      const clearAll = function () { setModal2({ title: '一键清空', rows: ['⚠️ 确定清空全部商品吗? 清空后可点「↩ 重置」恢复种子数据。', '再次确认: 此操作不可撤销。'], onOk: function () { api('/api/products/clear', 'POST', {}).then(function (r) { setMsg('🧹 已清空'); after(); }).catch(function (e) { setMsg('✗ ' + String(e && e.message || e)); }); } }); };
      const resetAll = function () { setModal2({ title: '重置种子', rows: ['恢复初始种子数据?'], onOk: function () { api('/api/products/reset', 'POST', {}).then(function () { setMsg('↩ 已重置'); after(); }).catch(function (e) { setMsg('✗ ' + String(e && e.message || e)); }); } }); };
      const [modal2, setModal2] = React.useState(null);
      // ===== 导出表格: 勾选列 + 真实下载 (xlsx/csv 由后端生成, 浏览器直接落盘) =====
      // (expOpen 已在上面状态区声明)
      const [expCols, setExpCols] = React.useState(function () { const m = {}; EXPORT_COLS.forEach(function (c) { m[c[0]] = !!c[2]; }); return m; });
      const expChosen = function () { return Object.keys(expCols).filter(function (k) { return expCols[k]; }); };
      const expToggle = function (k) { setExpCols(function (o) { const n = Object.assign({}, o); n[k] = !n[k]; return n; }); };
      const expUrl = function (fmt) {
        const cols = expChosen();
        const a = selArr();
        const qs = ['format=' + fmt, 'fields=' + cols.join(',')];
        if (a.length) qs.push('asins=' + a.join(','));
        return EXPORT_BASE + '?' + qs.join('&');
      };
      // 用 <a> 触发下载: 响应带 Content-Disposition: attachment → 浏览器直接存文件 (不经 api 代理, 避免二进制被当文本解码)
      const doExport = function (fmt) {
        const cols = expChosen();
        if (!cols.length) { setMsg('✗ 请至少勾选一列'); return; }
        const a = selArr();
        const url = expUrl(fmt);
        try {
          const el = document.createElement('a');
          el.href = url; el.rel = 'noopener';
          document.body.appendChild(el); el.click(); el.remove();
          setMsg('⬇ 已开始下载 ' + (fmt === 'xlsx' ? 'Excel(.xlsx)' : fmt.toUpperCase()) + ' — ' + cols.length + ' 列 · ' + (a.length ? '选中 ' + a.length + ' 个商品' : '全部 ' + total + ' 个商品') + ' (若浏览器拦截下载, 点「🔗 浏览器打开」)');
        } catch (e) { setMsg('✗ 导出失败: ' + String(e && e.message || e)); }
      };
      const refreshRank = function () {
        // ★ 2026-09: 后端判据已改为"无大排名(rankParent)" —— 全库有 8000+ 条这种商品, 每个约 8 秒,
        //   不限量点下去要跑十几个小时。所以: 勾选了就只补勾选的, 没勾选必须把规模说清楚。
        const only = selArr();
        const rows = only.length
          ? ['将对【勾选】的 ' + only.length + ' 个商品逐个打开详情页补采大排名(店铺选品) (每个约 8 秒, 可在采集面板点停止中断)。确定开始?']
          : ['⚠ 未勾选商品 → 将对【全库所有无大排名】的商品逐个补采 (实测 8000+ 条, 每个约 8 秒, 可能要跑十几小时)。',
             'ℹ 已判为【未上榜】的商品(插件面板已分析完、确实没有根类目排名行)不必补采 —— 补也补不到; 列表里它们显示为橙色的「未上榜」。',
             '建议: 先在商品管理里勾选目标商品再点这个按钮; 或对少量商品用「🔄 一键补采」。',
             '确定开始?'];
        setModal2({ title: '补采排名' + (only.length ? ' (' + only.length + ' 个)' : ' (全库)'), rows: rows, onOk: function () {
          setModal2(null); setBusy('rank'); setTask('补采排名中…');
          api('/api/products/refresh-ranks', 'POST', only.length ? { asins: only } : {}).then(function (r) {
            setBusy(''); setTask('');
            const j = r && r.json ? r.json : {};
            const rows = ['✅ 补采排名完成 共处理 ' + (j.done || 0) + ' / 补到 ' + (j.addedRank || 0) + ' / 失败 ' + (j.fail || 0)];
            if (j.stopped) rows.push('⏹ 已手动停止');
            setMsg2(rows); load();
          }).catch(function (e) { setBusy(''); setTask(''); setMsg('✗ 补采失败: ' + String(e && e.message || e)); });
        } });
      };
      React.useEffect(function () {
        if (busy !== 'rank') return undefined;
        const poll = function () { api('/api/collect/progress', 'GET', null).then(function (r) { if (r && r.ok && r.json && r.json.running) { const g = r.json; setTask('补采排名中: ' + (g.items != null ? g.items : 0) + ' 个, 已补 ' + (g.added != null ? g.added : 0)); } else { setTask(''); } }).catch(function () {}); };
        poll();
        const off = ctx.interval(poll, 3000);
        return function () { if (typeof off === 'function') { try { off(); } catch (e) {} } };
      }, [busy]);
      const [msg2, setMsg2] = React.useState(null);
      // ── 一键补采: 只作用于【勾选】的商品 ────────────────────────────────────
      // 为什么需要: 采集链路已统一"不跳详情页"(见 server.js 各处 jumpDetail/detail/fixDetail 默认),
      // 详情页专属字段(价格/主图/评分/评论/类目/BSR/A+)与插件面板字段(商标/月销/尺寸重量/FBA费用)
      // 改由这里按需补 —— 所以它是详情数据的唯一入口。
      // 两步都是串行 CDP: 详情约 8s/个, 面板约 15~40s/个; 可在采集面板点「停止」中断, 已补字段都已入库。
      // 手工拆/合族: 写标记(variantSolo/variantManualKey) → 接着调 rebuild 重算族 → 刷新。
      // 人工判定优先于自动识别, 且 rebuild 不会冲掉它(标记存在商品字段上, 随 products.json 持久化)。
      const variantOverride = function (asin, action) {
        const body = { asin: asin, action: action };
        if (action === 'merge') {
          const members = (famModal && famModal.members) || [];
          const parent = members.filter(function (x) { return x.variantRole === 'parent'; })[0] || members[0];
          if (!parent || !parent.asin) { setMsg('✗ 找不到目标族代表'); return; }
          if (parent.asin === asin) { setMsg('它就是族代表, 无需并入'); return; }
          body.into = parent.asin;
        }
        setBusy('ovr'); setTask(action === 'split' ? '拆族中…' : action === 'merge' ? '并族中…' : '还原中…');
        api('/api/products/variant-override', 'POST', body).then(function (r) {
          const j = (r && r.json) || {};
          if (j.error) throw new Error(j.error);
          return api('/api/products/rebuild-variant-groups', 'POST', { repBy: 'follow' });
        }).then(function (r) {
          setBusy(''); setTask('');
          const j = (r && r.json) || {};
          setMsg((action === 'split' ? '✂ 已拆出 ' : action === 'merge' ? '🔗 已并入代表 ' : '↩ 已还原 ') + asin
            + ' · 重建后: ' + j.families + ' 族 / 多变体族 ' + j.multiFamilies);
          setFamModal(null); load();
        }).catch(function (e) { setBusy(''); setTask(''); setMsg('✗ 操作失败: ' + String(e && e.message || e)); });
      };
      const backfill = function (onlyAsins) {
        let list = (onlyAsins && onlyAsins.length) ? onlyAsins.slice() : selArr();
        let collapsed = 0;
        if (bfRepOnly && list.length) {
          // ★ 族内只补代表 (2026-09): 详情页的 twister 一次就会带回全族兄弟 ASIN,
          //   所以同族只需补代表一次 —— 实测全库 21,523 个族成员可折叠为 6,841 个代表, 省 68% 时间。
          const seenKey = {}; const dedup = [];
          list.forEach(function (a) {
            const it = (items || []).filter(function (x) { return x.asin === a; })[0];
            const k = it ? (it.parentAsin || it.asin) : a;
            if (k && seenKey[k]) return;
            if (k) seenKey[k] = 1;
            dedup.push(a);
          });
          collapsed = list.length - dedup.length;
          list = dedup;
        }
        if (!list.length) {
          setMsg2(['⚠ 请先勾选商品',
            '「一键补采」只作用于【勾选】的商品, 不会自动补全库。',
            '也可以直接点某张卡片上的「补采」按钮, 只补那一个。']);
          return;
        }
        setModal2({ title: '补采 ' + list.length + ' 个商品' + (collapsed ? ' (族内折叠 ' + collapsed + ' 个)' : ''), rows: [
          '将对 ' + list.length + ' 个商品依次补采:' + (collapsed ? ' — 同族 ' + collapsed + ' 个已跳过(只补代表)' : ''),
          '① 详情页字段 (价格/主图/评分/评论/类目/BSR/A+) — 约 8 秒/个',
          '② 插件面板 (商标/月销/尺寸重量/FBA费用) — 约 15~40 秒/个',
          '串行执行, 可随时在采集面板点「停止」中断; 已补到的字段都会入库。',
        ], onOk: function () {
          setModal2(null); setBusy('backfill'); setTask('补采中…');
          const out = [];
          api('/api/products/refresh-detail', 'POST', { asins: list }).then(function (r) {
            const j = r && r.json ? r.json : {};
            if (j.error) throw new Error('详情补采失败: ' + j.error);
            out.push('① 详情字段: 处理 ' + (j.total || 0) + ' 个 / 成功 ' + (j.fixed || 0) + ' / 失败 ' + (j.failed || 0));
            return api('/api/products/panel-refresh', 'POST', { asins: list });
          }).then(function (r) {
            const j = r && r.json ? r.json : {};
            if (j.error) throw new Error('面板补采失败: ' + j.error);
            out.push('② 插件面板: 更新 ' + (j.updated || 0) + ' 个 / 失败 ' + (j.failed || 0) + (j.note ? ' (' + j.note + ')' : ''));
            setBusy(''); setTask('');
            setMsg2(['✅ 补采完成 (共 ' + list.length + ' 个商品)'].concat(out));
            load();
          }).catch(function (e) {
            setBusy(''); setTask('');
            setMsg2(['✗ 补采失败: ' + String(e && e.message || e)].concat(out.length ? ['', '已完成:'].concat(out) : []));
          });
        } });
      };
      React.useEffect(function () {
        if (busy !== 'backfill') return undefined;
        const poll = function () { api('/api/collect/progress', 'GET', null).then(function (r) { if (r && r.ok && r.json && r.json.running) { const g = r.json; setTask('补采中: ' + (g.step || '') + ' · ' + (g.items != null ? g.items : 0) + ' 个'); } else { setTask('补采中…'); } }).catch(function () {}); };
        poll();
        const off = ctx.interval(poll, 3000);
        return function () { if (typeof off === 'function') { try { off(); } catch (e) {} } };
      }, [busy]);
      const search1688 = function () {
        const targets = selArr().length ? items.filter(function (x) { return selArr().indexOf(x.asin) >= 0; }) : (items || []).filter(function (x) { return x.mainImage; }).slice(0, 10);
        if (!targets.length) { setMsg('请先勾选商品 (或库中无主图商品)'); return; }
        setModal2({ title: '1688 图搜找货', rows: ['将对 ' + targets.length + ' 个商品逐个上传主图到 1688 以图搜图 (每个约 30 秒, 可停止)。确定开始?'], onOk: function () {
          setModal2(null); setBusy('g1688'); setTask('');
          const res = [];
          const next = function (i) {
            if (i >= targets.length) { setBusy(''); setTask(''); setMsg2(['✅ 1688 批量图搜完成 共处理 ' + targets.length + ' / 找到同款 ' + res.filter(function (x) { return x.count > 0; }).length + ' 个 (已自动存入第一个货源)'].concat(res.map(function (x) { return x.count > 0 ? '✓ ' + x.asin + ': ' + x.count + ' 个同款' : '✗ ' + x.asin + ': 未找到'; }))); load(); return; }
            const p = targets[i];
            setTask('1688 图搜 ' + (i + 1) + '/' + targets.length + ': ' + p.asin);
            api('/api/products/1688-search-upload', 'POST', { asin: p.asin }).then(function (r) {
              const j = r && r.json ? r.json : {};
              const cnt = j.count || 0;
              if (cnt && j.items && j.items[0]) {
                const g0 = j.items[0];
                const goods = (p.sourceGoods || []).slice();
                const now = new Date();
                const pad = function (n) { return n < 10 ? '0' + n : String(n); };
                goods.push({ platform: '1688', url: g0.url, title: g0.title, price: g0.priceRaw || g0.price, addedAt: now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) + ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds()) });
                api('/api/products/goods', 'POST', { asin: p.asin, goods: goods }).then(function () { res.push({ asin: p.asin, count: cnt }); next(i + 1); }).catch(function () { res.push({ asin: p.asin, count: 0 }); next(i + 1); });
              } else { res.push({ asin: p.asin, count: 0 }); next(i + 1); }
            }).catch(function () { res.push({ asin: p.asin, count: 0 }); next(i + 1); });
          };
          next(0);
        } });
      };
      // 站点 → amazon 域名后缀 (必须与后端 siteToHostSuffix 完全一致, 否则小站点会拼出 amazon.tr 这种错误域名)
      const domOf = function (site) { return ({ uk: 'co.uk', us: 'com', jp: 'co.jp', au: 'com.au', mx: 'com.mx', br: 'com.br', sg: 'com.sg', tr: 'com.tr', ae: 'ae', sa: 'sa', nl: 'nl', se: 'se', pl: 'pl', de: 'de', fr: 'fr', it: 'it', es: 'es', ca: 'ca', in: 'in' }[site] || site || 'de'); };
      const amazonOf = function (p) { return 'https://www.amazon.' + domOf(p.site) + '/dp/' + p.asin; };
      /**
       * 一个商品身上所有可打开的链接(去重), 每条带 kind 分类(供「打开所选链接」按分类勾选)。
       * 覆盖: 商品页 / 品牌页 / 品牌店 / 卖家页 / 卖家店铺 / 1688 同款 —— 字段名在不同采集方式下不完全一致
       * (brandLink·brandUrl / sellerLink·sellerUrl / seller / is1688Url), 所以都兜一遍。
       */
      const productLinks = function (p) {
        const out = [], seen = {};
        const add = function (kind, label, url) {
          const u = String(url == null ? '' : url).trim();
          if (!u || !/^https?:/i.test(u) || seen[u]) return;
          seen[u] = 1;
          out.push({ kind: kind, label: label, url: u });
        };
        add('product', '商品页', amazonOf(p));
        add('brand', '品牌店', p.brandLink || p.brandUrl);           // ★ 品牌店铺链接: 默认不开(避免和商品页混着开)
        add('seller', '卖家页', p.sellerLink || p.sellerUrl || p.shopUrl || (p.sellerId ? 'https://www.amazon.' + domOf(p.site) + '/sp?seller=' + p.sellerId : ''));
        add('s1688', '1688 同款', p.is1688Url);
        return out;
      };
      /**
       * 「🔗 打开所选链接」: 把所选商品的全部链接逐个交给系统默认浏览器。
       * 2026-09-20 增加「继续打开」: 一批最多 LIMIT 个(防手滑把浏览器打死), 但超出的**不再丢弃** ——
       * 存进 openMore, 弹窗上直接点「继续打开剩下 N 个」接着开(可反复点), 也能中途「⏹ 停止」。
       */
      const LIMIT = 60;                                   // 每批最多打开多少个(防手滑: 50 商品 × 4 链接 = 200 标签页会把浏览器打死)
      const openStopRef = React.useRef(false);
      /** 打开一批; cap 省略时按 LIMIT, 传 Infinity 表示"剩余全开" */
      const runOpen = function (queue, meta, cap) {
        const n = Math.max(0, Math.min(queue.length, cap == null ? LIMIT : cap));
        const batch = queue.slice(0, n);
        const rest = queue.slice(n);
        const openedBefore = meta.opened || 0;
        let i = 0;
        openStopRef.current = false;
        setBusy('openLinks');
        setMsg(null);
        setOpenMore({ busy: true, batch: batch.length, done: 0, opened: openedBefore, total: meta.total, restQ: batch, kinds: meta.kinds, cur: '' });
        const next = function () {
          const stopped = openStopRef.current;
          if (stopped || i >= batch.length) {
            setBusy('');
            setOpenMore({
              busy: false, batch: batch.length, done: i, opened: openedBefore + i, total: meta.total,
              restQ: batch.slice(i).concat(rest), kinds: meta.kinds, stopped: stopped,
            });
            return;
          }
          const l = batch[i++];
          setOpenMore(function (cur) { return Object.assign({}, cur, { done: i, cur: l.asin + ' ' + l.label }) });
          openExternal(l.url, l.asin + ' ' + l.label);
          setTimeout(next, 220);                          // 稍微错开, 避免浏览器把连续弹窗当垃圾拦截
        };
        next();
      };
      const continueOpen = function () { if (openMore && !openMore.busy) runOpen(openMore.restQ, { opened: openMore.opened, total: openMore.total, kinds: openMore.kinds }); };
      const openAllRest = function () { if (openMore && !openMore.busy) runOpen(openMore.restQ, { opened: openMore.opened, total: openMore.total, kinds: openMore.kinds }, Infinity); };
      /** 分类弹窗里点「开始打开」: 按勾选的分类收集链接 → 进打开队列 */
      const startPicked = function () {
        const pick = linkPick;
        if (!pick) return;
        const got = collectLinksByKind(pick.rows, linkKinds, productLinks);
        writeLinkKinds(linkKinds);
        if (!got.items.length) { setMsg('勾选的分类里没有链接 —— 请至少勾选一类(比如「商品页」)'); return; }
        const kinds = LINK_KIND_DEFS.filter(function (d) { return got.byKind[d.k] }).map(function (d) { return d.name + ' ' + got.byKind[d.k] }).join(' · ');
        setLinkPick(null);
        runOpen(got.items, { opened: 0, total: got.items.length, kinds: kinds });
      };
      const openSelLinks = function () {
        const a = needSel();
        if (!a) return;
        const rows = (items || []).filter(function (x) { return a.indexOf(x.asin) >= 0; });
        const cnt = countLinksByKind(rows, productLinks);
        if (!cnt.total) { setMsg('所选商品没有可打开的链接'); return; }
        // ★ 先弹「链接分类」: 每类多少条 + 勾选要开哪几类(默认只开商品页, 选择会被记住)
        setLinkPick({ rows: rows, byKind: cnt.byKind, total: cnt.total });
      };
      const th = function (t, k) { return h('th', { key: k }, t); };
      const badge = function (t, cls) { return h('span', { className: 'zyp-badge ' + (cls || 'zyp-bg') }, t); };
      const tmBadge = function (p) {
        if (p.brandStatus === 'registered') return badge('已备案', 'zyp-br');
        if (p.brandStatus === 'unchecked') return badge('有商标', 'zyp-bm');
        if (p.trademarkCount > 0) return badge(p.trademarkCount + '商标', 'zyp-bm');
        return badge('未查到', 'zyp-bg');
      };
      const openTm = function (p) {
        api('/api/products/detail?asin=' + encodeURIComponent(p.asin), 'GET', null).then(function (r) {
          const d = r && r.json ? (r.json.product || r.json) : null;
          if (!d) return;
          const cs = Array.isArray(d.tmCountries) ? d.tmCountries : [];
          setMsg2([(d.brand || p.brand || '') + ' 商标注册国家:', cs.length ? cs.join('、') : '无记录', d.tmText ? ('原文: ' + d.tmText) : ''].concat(cs.length ? [] : []));
        }).catch(function () {});
      };
      /**
       * 商品卡片 (2026-09 改版: 表格 → 卡片流)。
       * 卡片上只放【主图 + 7 项主要数据 + 勾选框】:
       *   主图占卡片高度 70%; 主图下方依次是 品牌 / 价格 / 父类排名 / 子类排名 / 跟卖数 / 销量 / 配送 / 站点。
       * 交互(2026-09 改版):
       *   · 单击卡片 = 勾选/取消勾选该商品
       *   · 双击卡片 = 进商品详情页(其余字段都在那里)
       *   · 主图右上角 🔍 = 放大镜; 卡片上的按钮/勾选框/排名色块各自独立, 不会误触发勾选
       *   (原"悬停弹出大图预览"已按需求删除)
       */
      const productCard = function (p) {
        /* ★ 2026-09-27 修复「点缩小只有数据缩小了界面没缩小」:
         *   原来这里 px(n) = n × cardScale, 只把【卡片内部字号】缩了 —— 工具条/筛选/分页原样不动,
         *   满屏空白, 看着就像"没缩"。现在缩放统一交给外层整块视图的 CSS zoom(见 listInner),
         *   卡片内部不再自己乘倍数, 否则会被缩两次(0.7 × 0.7)。 */
        const px = function (n) { return n };
        const mainV = p.minPrice != null ? p.minPrice : p.price;
        // ★ 卡片底色按配送方式分档: AMZ / FBA / FBM 各有自定义色, 留空则回落默认底色
        const fillKey = cardFillKey(p);
        const effBg = resolveCardBg(cardBg, p);
        const cardInk = cardInkOf(effBg);                      // 选了浅色底 → 深色字; 默认底 → null(跟主题)
        const cell = function (label, value, opts) {
          const st = Object.assign({ fontSize: px(15), fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, cardInk ? { color: cardInk.primary } : {}, (opts && opts.style) || {});
          const title = (typeof value === 'string' || typeof value === 'number') ? String(value) : undefined;   // 值为元素(排名色块)时不设 title
          return h('div', { style: Object.assign({ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }, (opts && opts.boxStyle) || {}) },
            h('span', { className: 'zyp-note', style: Object.assign({ fontSize: px(12), opacity: 0.7, lineHeight: 1.3 }, cardInk ? { color: cardInk.secondary } : {}) }, label),
            h('span', { style: st, title: title }, value));
        };
        // 排名数字: 带可自定义底色的色块(点它改配色; 越靠前越醒目)
        const rankChip = function (val, notListed) {
          if (val == null) {
            if (notListed) return h('span', { className: 'zyp-note', style: { fontSize: px(13), color: '#e0b25c', fontWeight: 600 }, title: '未上榜: 插件面板已分析完, 该商品没有根类目排名行(不是没采到)' }, '未上榜');
            return h('span', { className: 'zyp-note', style: Object.assign({ fontSize: px(13), opacity: 0.45 }, cardInk ? { color: cardInk.secondary } : {}) }, '未采到');
          }
          const tier = rankTierOf(val, rankCfg);
          const bg = (tier && tier.color) || '#4a4a55';
          return h('span', {
            title: '排名 #' + val + ' · 点这里自定义排名底色',
            style: { display: 'inline-block', padding: '0 ' + px(8) + 'px', borderRadius: 6, background: bg, color: rankTextColor(bg), fontWeight: 700, cursor: 'pointer', lineHeight: px(21) + 'px' },
            onClick: function (e) { e.stopPropagation(); setRankCfgOpen(true); },
          }, '#' + FmtNum(val));
        };
        const img = p.mainImage ? h('img', {
          src: p.mainImage,
          style: { width: '100%', height: '100%', objectFit: 'contain', cursor: 'pointer' },
          alt: '',
        }) : h('div', { className: 'zyp-note', style: { fontSize: 11 } }, '无主图');
        return h('div', {
          key: p.asin, 'data-asin': p.asin, 'data-brand': String((p.brand || '(无品牌)').trim() || '(无品牌)'),
          'data-fulfill': fillKey, 'data-cardbg': effBg,
          className: 'zyp-pcard',
          title: '单击 = 勾选/取消该商品 · 双击 = 打开详情页',
          onClick: function (e) { onCardClick(p, e); },            // ★ 单击勾选
          onDoubleClick: function (e) { onCardDblClick(p, e); },   // ★ 双击进详情
          style: {
            // ★ 高度自适应: 原来写死 height: px(430) + overflow:hidden, 实测内容需要 556px →
            //   下半截(排名/跟卖/销量/配送/站点/按钮)被整片裁掉。现在: 主图保持基准 70% 的高度(px(301)),
            //   数据区按内容撑开, 卡片用 minHeight 保底 → 所有字段都完整显示。
            position: 'relative', display: 'flex', flexDirection: 'column', minHeight: px(430), borderRadius: 12, overflow: 'hidden',
            // ★ 底色可自定义(🎨 卡片底色): 勾选态不再改底色, 改用蓝色描边+内描边环, 这样自定义底色一直可见
            border: '1px solid ' + (sel[p.asin] ? '#4f8cff' : (cardInk ? cardInk.border : 'var(--dsw-alias-border-l2,#333)')),
            background: effBg,
            boxShadow: sel[p.asin] ? 'inset 0 0 0 2px rgba(79,140,255,.55)' : 'none',
            color: cardInk ? cardInk.primary : undefined,
            cursor: 'pointer',
          },
        },
          // ── 主图区: 高度 = 基准卡片高度的 70%(px(301)); 底色统一白色 ──────────
          h('div', { style: { flex: '0 0 auto', height: px(301), minHeight: 0, position: 'relative', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: px(4) } },
            img,
            // 勾选框: 左上角浮层; 自己处理点击并 stopPropagation, 免得被卡片再切一次
            h('label', { title: '勾选该商品', onClick: function (e) { e.stopPropagation(); }, onDoubleClick: function (e) { e.stopPropagation(); }, style: { position: 'absolute', left: px(7), top: px(7), display: 'inline-flex', alignItems: 'center', background: 'rgba(0,0,0,.6)', borderRadius: 7, padding: px(2) + 'px ' + px(7) + 'px', cursor: 'pointer' } },
              h('input', { type: 'checkbox', checked: !!sel[p.asin], onClick: function (e) { e.stopPropagation(); }, onChange: function () { toggle(p.asin); }, style: { width: px(16), height: px(16), cursor: 'pointer' } })),
            // 🔍 放大镜: 悬停预览删掉后, 放大镜改挂这个按钮(点它不会勾选/不会进详情)
            p.mainImage ? h('span', {
              title: '放大镜(可滚轮换倍率)', 'data-act': 'mag',
              onClick: function (e) { e.stopPropagation(); setMsg2(null); setMag({ p: p, z: 2.5, lens: { x: 50, y: 50, on: false } }); },
              onDoubleClick: function (e) { e.stopPropagation(); },
              style: { position: 'absolute', right: px(7), top: px(7), background: 'rgba(0,0,0,.6)', borderRadius: 7, padding: px(2) + 'px ' + px(8) + 'px', color: '#fff', fontSize: px(15), cursor: 'zoom-in' },
            }, '🔍') : null,
            p.saved ? h('span', { title: '已收藏', style: { position: 'absolute', right: px(7), top: px(38), background: 'rgba(0,0,0,.6)', borderRadius: 7, padding: px(2) + 'px ' + px(8) + 'px', color: '#f0b253', fontSize: px(15) } }, '★') : null),
          // ── 主图下方: 主要数据 ─────────────────────────────────────────────
          h('div', { style: { flex: '0 0 auto', padding: px(7) + 'px ' + px(10) + 'px ' + px(8) + 'px', display: 'flex', flexDirection: 'column', gap: px(6) } },
            h('div', { style: { display: 'flex', alignItems: 'baseline', gap: px(8) } },
              // ★ 价格字号再加大: 21 → 28 (卡片上最该被一眼看到的数字)
              h('b', { style: { fontSize: px(28), lineHeight: 1.15 } }, FmtMoney(mainV, p.currency)),
              (p.buyBoxPrice != null && p.buyBoxPrice !== mainV) ? h('span', { className: 'zyp-note', style: Object.assign({ fontSize: px(13) }, cardInk ? { color: cardInk.secondary } : {}) }, 'BB ' + FmtMoney(p.buyBoxPrice, p.currency)) : null),
            // ★ 列数自适应卡片实际宽度(窄卡 2 列、宽卡 4 列), 品牌占满一行 —— 保证每个字段都完整可见
            h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(' + px(96) + 'px,1fr))', gap: px(5) + 'px ' + px(10) + 'px' } },
              // 品牌: 占满一行
              cell('品牌', p.brand || '(无品牌)', { boxStyle: { gridColumn: '1 / -1' }, style: { fontSize: px(17) } }),
              cell('父类排名', rankChip(p.rankParent, rankParentIsNotListed(p))),
              cell('子类排名', rankChip(p.rankChild)),
              cell('跟卖数', p.followCount != null ? p.followCount : '-'),
              cell('销量(30天)', FmtNum(p.monthlySales)),
              cell('配送', p.amazonSell ? 'AMZ自营' : (p.fulfill || '-')),
              cell('站点', String(p.site || '').toUpperCase())),
            h('div', { style: { display: 'flex', gap: px(8) } },
              h('button', { className: 'zyp-btn', style: { flex: 1, padding: px(5) + 'px ' + px(10) + 'px', fontSize: px(13.5) }, title: '打开详情页(其余字段都在那里)', onClick: function (e) { e.stopPropagation(); openDetail(p); } }, '详情 ▸'),
              h('button', { className: 'zyp-btn', style: { padding: px(5) + 'px ' + px(12) + 'px', fontSize: px(13.5) }, title: '补采这一个商品: 重读详情页字段 + 插件面板(商标/月销), 只作用于本卡片', onClick: function (e) { e.stopPropagation(); backfill([p.asin]); } }, '补采'),
              (function () {
                const k = famKeyOf(p); const n = k ? (famSize[k] || 0) : 0;
                if (!k || n <= 1) return null;
                const isVar = p.familyKind === 'variant';
                const conf = p.variantSrc === 'twister' ? '已确认' : (p.variantSrc === 'card' ? '较可信' : '推测');
                return h('button', {
                  className: 'zyp-btn', style: { padding: px(5) + 'px ' + px(10) + 'px', fontSize: px(13.5), borderColor: isVar ? '#4f8cff' : '#8a6d3b', color: isVar ? '#8ab4ff' : '#d8b36a' },
                  title: (isVar ? '真变体族(差异在颜色/尺寸/数量)' : '同款多型号族(差异在车型/适配等)') + ' · 识别置信度: ' + conf + ' · 点击看全族对比',
                  onClick: function (e) { e.stopPropagation(); setFamModal({ key: k, kind: p.familyKind, src: p.variantSrc, members: (famMembers[k] || []).slice().sort(function (a, b) { return (Number(b.followCount) || 0) - (Number(a.followCount) || 0); }) }); },
                }, (isVar ? '变体 ×' : '同款 ×') + n + (p.variantSrc === 'title' ? '≈' : ''));
              })(),
              h('button', { className: 'zyp-btn', style: { padding: px(5) + 'px ' + px(12) + 'px', fontSize: px(13.5) }, title: '在亚马逊打开', onClick: function (e) { e.stopPropagation(); openExternal(amazonOf(p), p.asin + ' ' + String(p.title || '').slice(0, 20)); } }, '⧉'))));
      };
      /**
       * 卡片的「单击勾选 / 双击进详情」分离。
       * 难点: 双击时浏览器会先发两次 click —— 如果 click 立刻切换勾选, 双击就会把勾选状态翻两次
       * (等于没变, 但会闪一下; 而且本来已勾选的商品会被顺手取消勾选)。
       * 做法: 单击延迟 200ms 结算; 期间
       *   · 同一张卡再次点击 → 交给 dblclick(不勾选)
       *   · 点了别的卡 → 立即结算上一张(保证快速连续勾选不漏勾)
       */
      const pendClick = React.useRef(null);
      const flushPendClick = function () {
        const q = pendClick.current;
        if (!q) return;
        clearTimeout(q.timer);
        pendClick.current = null;
        toggle(q.asin);
      };
      /** 点在按钮/勾选框/排名色块/链接上时不参与"卡片级"的单击与双击 */
      const isCardWidget = function (el) {
        try { return !!(el && el.closest && el.closest('button, input, label, a, [data-act="mag"]')) } catch (e) { return false }
      };
      const onCardClick = function (p, e) {
        if (isCardWidget(e.target)) return;
        if (pendClick.current && pendClick.current.asin === p.asin) return;   // 同一张卡的第二次 click → 交给 dblclick
        flushPendClick();
        const timer = setTimeout(function () { pendClick.current = null; toggle(p.asin); }, 200);
        pendClick.current = { asin: p.asin, timer: timer };
      };
      const onCardDblClick = function (p, e) {
        if (isCardWidget(e.target)) return;
        const q = pendClick.current;
        if (q && q.asin === p.asin) { clearTimeout(q.timer); pendClick.current = null; }   // 取消这次单击的勾选
        openDetail(p);                                                                     // 双击 = 进详情
      };
      const rowCells = productCard;                          // 兼容旧引用名
      const openDetail = function (p) {
        api('/api/products/detail?asin=' + encodeURIComponent(p.asin), 'GET', null).then(function (r) {
          const d = r && r.json ? (r.json.product || r.json) : null;
          if (!d) { setMsg('未取到详情'); return; }
          setDtl(d);
        }).catch(function () { setMsg('详情加载失败'); });
      };
      // ── 放大镜 ───────────────────────────────────────────────────────────
      // mag: 放大镜 { p, z, lens:{x,y,on} } —— z 是倍率, lens 是取样框在主图上的百分比位置
      // (2026-09 改版: 悬停弹出的大图预览已按需求删除; 放大镜改由主图右上角的 🔍 按钮打开,
      //  这样"单击卡片=勾选、双击=进详情"不会和放大镜抢点击)
      const [mag, setMag] = React.useState(null);
      // 放大镜浮层: 主图 + 取样框 + 跟随鼠标的镜片
      const setLens = function (e) {
        const el = e.currentTarget;
        const r = el.getBoundingClientRect();
        const x = Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100));
        const y = Math.min(100, Math.max(0, ((e.clientY - r.top) / r.height) * 100));
        setMag(function (z) { return z ? Object.assign({}, z, { lens: { x: x, y: y, on: true } }) : z; });
      };
      const LENS = 190;                                  // 镜片边长(px)
      const magLayer = !mag ? null : (function () {
        const z = mag.z || 2.5, L = mag.lens || { x: 50, y: 50, on: false };
        const src = hiResImg(mag.p.mainImage, 1500);
        return h('div', {
          className: 'zyp-mask', style: { zIndex: 10000 },
          onClick: function (e) { if (e.target === e.currentTarget) setMag(null); },
        },
          h('div', { className: 'zyp-modal', style: { maxWidth: 860, width: 'auto' } },
            h('div', { className: 'zyp-mhead' },
              h('span', null, '🔍 ' + String(mag.p.title || mag.p.asin || '主图').slice(0, 46) + ' — 放大镜 ' + z + 'x'),
              h('button', { onClick: function () { setMag(null); }, style: { background: 'none', border: 'none', color: '#aaa', fontSize: 16, cursor: 'pointer' } }, '✕')),
            h('div', { className: 'zyp-mbody', style: { display: 'flex', gap: 12, alignItems: 'flex-start' } },
              h('div', { style: { position: 'relative', width: 560, height: 460, background: '#fff', borderRadius: 8, overflow: 'hidden', cursor: 'crosshair', flexShrink: 0 },
                  onMouseMove: setLens, onMouseLeave: function () { setMag(function (zz) { return zz ? Object.assign({}, zz, { lens: { x: 50, y: 50, on: false } }) : zz; }); },
                  onWheel: function (e) {
                    e.preventDefault && e.preventDefault();
                    setMag(function (zz) { if (!zz) return zz; const nz = Math.min(6, Math.max(1.5, Math.round((zz.z + (e.deltaY < 0 ? 0.5 : -0.5)) * 2) / 2)); return Object.assign({}, zz, { z: nz }); });
                  } },
                h('img', { src: src, style: { width: '100%', height: '100%', objectFit: 'contain' }, alt: '' }),
                h('div', { style: {
                  position: 'absolute', width: (100 / z) + '%', height: (100 / z) + '%',
                  left: 'calc(' + L.x + '% - ' + (100 / z / 2) + '%)', top: 'calc(' + L.y + '% - ' + (100 / z / 2) + '%)',
                  border: '1px solid rgba(120,170,255,.9)', background: 'rgba(120,170,255,.12)', borderRadius: 4, pointerEvents: 'none',
                  display: L.on ? 'block' : 'none',
                } }),
                L.on ? h('div', {
                  style: {
                    position: 'absolute', width: LENS, height: LENS, borderRadius: LENS / 2, pointerEvents: 'none',
                    border: '2px solid #4f8cff', boxShadow: '0 6px 20px rgba(0,0,0,.6)',
                    backgroundImage: 'url(' + src + ')', backgroundRepeat: 'no-repeat',
                    backgroundSize: (z * 100) + '% auto',
                    backgroundPosition: L.x + '% ' + L.y + '%',
                    left: 'calc(' + L.x + '% - ' + (LENS / 2) + 'px)', top: 'calc(' + L.y + '% - ' + (LENS / 2) + 'px)',
                  } }) : null),
              h('div', { style: { minWidth: 230, fontSize: 12, lineHeight: 1.8 } },
                h('div', { style: { fontWeight: 600, marginBottom: 4 } }, String(mag.p.title || '-').slice(0, 60)),
                h('div', { className: 'zyp-note' }, 'ASIN ' + (mag.p.asin || '-') + (mag.p.brand ? ' · ' + mag.p.brand : '')),
                h('div', { className: 'zyp-note' }, '价格 ' + FmtMoney(mag.p.minPrice != null ? mag.p.minPrice : mag.p.price, mag.p.currency)
                  + (mag.p.rankParent != null ? ' · 大排名 #' + mag.p.rankParent : '')
                  + (mag.p.rankChild != null ? ' · 小排名 #' + mag.p.rankChild : '')),
                h('div', { style: { marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' } },
                  [1.5, 2, 3, 4, 6].map(function (v) { return h('button', { key: v, className: 'zyp-btn', style: v === z ? { background: '#2f6feb', borderColor: '#2f6feb', color: '#fff' } : undefined, onClick: function () { setMag(function (zz) { return Object.assign({}, zz, { z: v }); }); } }, v + 'x'); })),
                h('div', { className: 'zyp-note', style: { marginTop: 8 } }, '鼠标移到图上 → 圆形镜片跟随放大; 滚轮改倍率; 点空白/✕ 关闭。用的是 1500px 原图, 不是 218px 缩略图。'),
                h('div', { style: { marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' } },
                  h('button', { className: 'zyp-btn', onClick: function () { openExternal(hiResImg(mag.p.mainImage, 1500), '主图原图'); } }, '↗ 打开原图'),
                  h('button', { className: 'zyp-btn', onClick: function () { openExternal('https://www.amazon.' + (mag.p.site === 'us' ? 'com' : (mag.p.site === 'uk' ? 'co.uk' : (mag.p.site || 'de'))) + '/dp/' + mag.p.asin, '商品页'); } }, '↗ 商品页'))))));
      })();
        // 🎨 排名数字底色配置弹窗(卡片上点排名数字 / 工具条按钮都能打开)
      const rankCfgModal = !rankCfgOpen ? null : h(Modal, {
        title: '🎨 排名数字底色', onClose: function () { setRankCfgOpen(false); },
        buttons: [
          { label: '恢复默认', onClick: function () { setRankCfg(RANK_TIERS_DEFAULT.map(function (x) { return Object.assign({}, x); })); } },
          { label: '完成', primary: true, onClick: function () { setRankCfgOpen(false); } },
        ],
        children: h('div', null,
          h('div', { className: 'zyp-note', style: { marginBottom: 8, lineHeight: 1.6 } }, '按排名区间配色: 排名 ≤ 上界就用该底色(越靠前越醒目)。改完即时生效并记住(刷新/重开面板都保留)。'),
          rankCfg.map(function (t, i) {
            const setTier = function (patch) { setRankCfg(function (c) { const n = c.slice(); n[i] = Object.assign({}, n[i], patch); return n; }); };
            return h('div', { key: i, style: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px dashed #2a2a30' } },
              h('span', { style: { width: 78, fontSize: 12 } }, t.max == null ? '其余(兜底)' : '排名 ≤'),
              t.max == null ? null : h('input', {
                className: 'zyp-input', type: 'number', value: String(t.max), style: { width: 96 },
                onChange: function (e) { const v = e.target.value; setTier({ max: v === '' ? null : Number(v) }); },
              }),
              h('input', {
                type: 'color', value: /^#[0-9a-f]{6}$/i.test(String(t.color)) ? t.color : '#4a4a55',
                title: '点这里改底色', style: { width: 42, height: 24, padding: 0, border: '1px solid #3a3a44', borderRadius: 4, background: 'none', cursor: 'pointer' },
                onChange: function (e) { setTier({ color: e.target.value }); },
              }),
              h('span', { style: { padding: '0 6px', borderRadius: 5, background: t.color, color: rankTextColor(t.color), fontWeight: 700, fontSize: 12 } }, '#1,234'),
              h('span', { className: 'zyp-note', style: { fontSize: 11 } }, String(t.color)));
          }),
          h('div', { className: 'zyp-note', style: { marginTop: 8, lineHeight: 1.6 } }, '提示: 把某一档的「上界」清空 → 它变成兜底档(自动排到最后, 接住所有更大的排名); 文字颜色会按底色亮度自动取黑/白。'))});
      // 🎨 商品卡片底色配置弹窗: 每档一行、各改各的(不需要先选"当前档位"再点色块)
      //   2026-09-20 改版原因: 老版是"先点档位 → 再点色块", 很多人直接点色块 → 颜色落到了默认底色上,
      //   看着像"FBA/FBM 改了没生效"。现在每行自带取色器/预设色/跟默认, 并显示当前页各档卡数。
      const normBg = normCardBgCfg(cardBg);
      const curOf = function (k) { return String(normBg[k] || '') };
      const setGroupColor = function (k, color) {
        const s = String(color || '').trim();
        const good = (s && parseColor(s)) ? s : '';
        setCardBg(function (c) {
          const n = Object.assign({}, normCardBgCfg(c));
          if (k === 'base') n.base = good || CARD_BG_DEFAULT; else n[k] = good;   // 非默认档留空 = 跟默认
          return n;
        });
      };
      const colorInputVal = function (color) {
        if (/^#[0-9a-f]{6}$/i.test(color)) return color;
        const c = parseColor(color);
        return c ? '#' + [c.r, c.g, c.b].map(function (v) { return ('0' + Math.round(v).toString(16)).slice(-2) }).join('') : '#24242b';
      };
      // 当前页各档卡数 —— 让用户马上知道"我的商品属于哪一档"
      const tierCount = (function () {
        const c = { base: 0, FBA: 0, FBM: 0, AMZ: 0 };
        (cur || []).forEach(function (p) { const k = cardFillKey(p); c[k] = (c[k] || 0) + 1 });
        return c;
      })();
      const cardBgModal = !cardBgOpen ? null : h(Modal, {
        title: '🎨 商品卡片底色', onClose: function () { setCardBgOpen(false); },
        buttons: [
          { label: '恢复默认', onClick: function () { setCardBg(normCardBgCfg(null)); } },
          { label: '完成', primary: true, onClick: function () { setCardBgOpen(false); } },
        ],
        children: h('div', null,
          h('span', { 'data-bg-status': JSON.stringify(normBg), style: { display: 'none' } }),
          h('span', { 'data-bg-tiercount': JSON.stringify(tierCount), style: { display: 'none' } }),
          h('div', { className: 'zywb-note', style: { marginBottom: 6, lineHeight: 1.7 } },
            '每档一行, 各改各的 —— 点该行的取色器或色点, 即时生效并记住。「跟默认」= 这一档不单独配色, 直接用「默认底色」'
            + '(没采到配送方式的商品也走默认底色)。选浅色底时卡片文字会自动转深色。'),
          h('div', { className: 'zywb-note', style: { marginBottom: 8, fontSize: 11 } },
            '本页卡片的配送分档: FBM ' + tierCount.FBM + ' 张 · FBA ' + tierCount.FBA + ' 张 · AMZ 自营 ' + tierCount.AMZ + ' 张 · 未分类 ' + tierCount.base + ' 张'
            + '（只有卡片属于哪一档, 改那一档才会变色）'),
          CARD_BG_GROUPS.map(function (g) {
            const own = g.k === 'base' ? normBg.base : curOf(g.k);
            const eff = (g.k === 'base' || own) ? (own || normBg.base) : normBg.base;   // 该档实际生效的底色
            const ink = cardInkOf(eff);
            const nCard = tierCount[g.k] || 0;
            return h('div', {
              key: g.k, 'data-bg-row': g.k, 'data-bg-own': own || '', 'data-bg-count': String(nCard),
              style: { display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px', borderBottom: '1px dashed #2a2a30', flexWrap: 'wrap' },
            },
              // 该档的颜色(取色器直接改这一档)
              h('input', {
                type: 'color', 'data-bg-input': g.k, value: colorInputVal(own || eff),
                title: '改「' + g.name + '」这一档的底色',
                style: { width: 40, height: 26, padding: 0, border: '1px solid #3a3a44', borderRadius: 4, background: 'none', cursor: 'pointer', flex: '0 0 auto' },
                onChange: function (e) { setGroupColor(g.k, e.target.value); },
              }),
              h('span', { style: { flex: '1 1 190px', minWidth: 170 } },
                h('div', { style: { fontSize: 12.5, fontWeight: 600 } }, g.name
                  + (g.k === 'base' ? '' : (own ? '' : ' · 跟默认'))
                  + (nCard ? ' · 本页 ' + nCard + ' 张' : ' · 本页 0 张')),
                h('div', { className: 'zywb-note', style: { fontSize: 10.5 } }, g.hint)),
              // 预设色点: 只作用于本行这一档
              h('span', { style: { display: 'inline-flex', gap: 4, flexWrap: 'wrap', flex: '0 0 auto' } },
                CARD_BG_PRESETS.map(function (ps) {
                  const on = own === ps.color || (g.k === 'base' && eff === ps.color);
                  return h('button', {
                    key: ps.name, 'data-bg-for': g.k, 'data-bg': ps.color, title: ps.name + ' → ' + g.name,
                    style: { width: 18, height: 18, padding: 0, borderRadius: 4, cursor: 'pointer', background: ps.color, border: on ? '2px solid #4f8cff' : '1px solid ' + (cardInkOf(ps.color) ? 'rgba(0,0,0,.35)' : '#4a4a55') },
                    onClick: function () { setGroupColor(g.k, ps.color); },
                  });
                })),
              g.k !== 'base' ? h('button', {
                className: 'zyp-btn', 'data-bg-inherit': g.k, style: { padding: '2px 9px', fontSize: 11.5, flex: '0 0 auto' },
                title: '「' + g.name + '」不单独配色, 用默认底色', onClick: function () { setGroupColor(g.k, ''); },
              }, '跟默认') : null,
              h('span', { className: 'zyp-note', style: { fontSize: 10.5, flex: '0 0 100%', paddingLeft: 48 } },
                '当前: ' + (g.k === 'base' ? normBg.base : (own || ('跟默认(' + normBg.base + ')')))
                + (ink ? ' · 浅色底 → 自动深色字' : ' · 深色底 → 跟随系统主题')));
          }),
          // 实时预览: 用"默认底色"档的样子(其它档除了颜色完全一样)
          (function () {
            const eff = normBg.base || CARD_BG_DEFAULT;
            const ink = cardInkOf(eff);
            return h('div', { style: { marginTop: 10, padding: 10, borderRadius: 10, border: '1px solid ' + (ink ? ink.border : '#333'), background: eff, color: ink ? ink.primary : undefined } },
              h('div', { style: { fontSize: 11, opacity: .7, color: ink ? ink.secondary : undefined } }, '预览 · 卡片长这样(颜色跟着各档走)'),
              h('b', { style: { fontSize: 28 } }, '£21.00'),
              h('div', { style: { fontSize: 11, opacity: .7, marginTop: 4, color: ink ? ink.secondary : undefined } }, '父类排名 / 品牌'),
              h('span', { style: { display: 'inline-block', marginTop: 2, padding: '0 8px', borderRadius: 6, background: '#4f8cff', color: '#fff', fontWeight: 700 } }, '#349,058'));
          })())});
      const [dtl, setDtl] = React.useState(null);
      // 统一过滤面板: 与采集面板是同一个组件、同一组字段 (不按场景裁剪)
      // ===== 货源总览 (全局视图: 覆盖率/平台分布/最划算/久未核价) =====
      const govCard = h('div', { className: 'zyp-card', style: govOpen ? { borderColor: '#4f8cff' } : {} },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h('div', { className: 'zyp-h', style: { flex: 1, margin: 0 } }, '📦 货源总览' + (gov ? ' · 已找货源 ' + gov.withGoods + '/' + gov.products + ' 个商品 · 共 ' + gov.totalGoods + ' 条' : '')),
          h('button', { className: 'zyp-btn', onClick: function () { if (!govOpen && !gov) loadGoodsOverview(); setGovOpen(!govOpen); } }, govOpen ? '收起' : '展开'),
          h('button', { className: 'zyp-btn', onClick: loadGoodsOverview }, '⟳')),
        !govOpen ? null : (!gov ? h('div', { className: 'zyp-note' }, '加载中…') : h('div', null,
          h('div', { className: 'zyp-note', style: { marginBottom: 6 } },
            '未找货源: ' + gov.missing + ' 个商品' + (gov.missing ? ' ← 这些还没定过供应商' : '') + ' · 平台分布: ' + Object.keys(gov.byPlatform).map(function (k) { return k + ' ' + gov.byPlatform[k]; }).join(' / ')),
          gov.bestDeals && gov.bestDeals.length ? h('div', { style: { marginBottom: 6 } },
            h('div', { className: 'zyp-lbl' }, '货源成本占售价最低 (最划算 30 个)'),
            h('div', { style: { maxHeight: 160, overflow: 'auto' } }, gov.bestDeals.slice(0, 30).map(function (b, i) {
              return h('div', { key: i, style: { display: 'flex', gap: 8, fontSize: 12, padding: '2px 0', borderBottom: '1px dashed #26262c' } },
                h('span', { style: { color: '#5fd08a', width: 52 } }, b.ratioPct + '%'),
                h('span', { className: 'zyp-note', style: { width: 92 } }, String(b.site || '').toUpperCase() + ' ¥' + b.priceCny),
                h('code', { style: { fontSize: 11 } }, b.asin),
                h('span', { style: { flex: 1, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, onClick: function () { openExternal(b.url, b.asin + ' 货源'); } }, String(b.title || '').slice(0, 40) + ' ↗'));
            }))) : null,
          gov.stale && gov.stale.length ? h('div', null,
            h('div', { className: 'zyp-lbl' }, '⚠ 超过 30 天未核价 (' + gov.stale.length + ' 条) — 采购价会变, 旧价决策会翻车'),
            h('div', { className: 'zyp-note', style: { fontSize: 11, maxHeight: 80, overflow: 'auto' } }, gov.stale.slice(0, 20).map(function (x) { return x.asin + '(' + (x.checkedAt || '').slice(0, 10) + ')'; }).join(' · '))) : null)));
      const filterPanel = h(ZypFilterPanel, {
        value: flt, open: fopen, catTree: catTree, onReloadCat: loadCatTree,
        // ★ 2026-10-02: 商品管理显式声明 mode='product' —— 采集专有字段(店铺维度)不再渲染;
        //   tmCountryOpts 由 /api/filter/spec 提供(常用商标局 ∪ 库内实际出现过的国家)。
        mode: 'product', tmCountryOpts: tmCountryOpts,
        onChange: function (nf) { setFlt(nf); }
      });
      // ★ 2026-09-25 「填了筛选数据为什么不生效」两处根因, 这里当场说清楚:
      //   ① 文本类条件不是打一个字就查一次(全库 10 万条, 每次查询都很重) → 必须点「✓ 应用筛选」
      //   ② 面板里带 * 的店铺维度条件(品牌店筛选/品牌店铺/A+ 店铺/他牌商品)服务端【商品库】根本不看,
      //      它们只在采集时判定 → 填了结果也不会变, 必须点名提示, 否则用户只会觉得"筛选坏了"
      const curJson = filterJson(flt);
      const dirty = appliedJson != null && curJson !== appliedJson;
      const DB_IGNORED = [['shopAplus', 'A+ 店铺'], ['brandShop', '品牌店铺'], ['brandStore', '品牌店筛选'], ['dropOtherBrand', '他牌商品']];
      const ignoredSet = DB_IGNORED.filter(function (x) { return flt[x[0]] !== '' && flt[x[0]] != null; }).map(function (x) { return x[1]; });
      const filterActions = h('div', { style: { marginTop: 8 } },
        h('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
        h('button', {
          className: 'zyp-btn', title: dirty ? '筛选条件改了但还没查询 —— 点这里生效' : '按当前条件重新查询商品库',
          style: { background: dirty ? '#e0b25c' : '#2f6feb', borderColor: dirty ? '#e0b25c' : '#2f6feb', color: dirty ? '#1a1a1a' : '#fff', fontWeight: dirty ? 700 : 400 },
          onClick: function () { setPage(1); load(false); }
        }, dirty ? '✓ 应用筛选 (条件已改动!)' : '✓ 应用筛选'),
        h('button', { className: 'zyp-btn', onClick: function () { setFlt(NF()); setPage(1); setTimeout(function () { load(false); }, 0); } }, '✕ 清除'),
        h('span', { className: 'zyp-note', style: { marginLeft: 'auto' } }, '已启用 ' + Object.keys(NF()).filter(function (k) { const val = flt[k]; return Array.isArray(val) ? val.length > 0 : (typeof val === 'boolean' ? val : (val !== '' && val != null)); }).length + ' 项条件')),
        dirty ? h('div', { className: 'zyp-note', style: { marginTop: 4, color: '#e0b25c', fontWeight: 600 } },
          '⚠ 筛选条件已改动但【还没生效】—— 输入框里打字不会自动查询(全库 10 万条, 每次查询很重), 点上面的「✓ 应用筛选」才生效。') : null,
        fltNote ? h('div', { className: 'zyp-note', style: { marginTop: 4, color: fltNote.warn ? '#e0b25c' : '#7ee2a8', fontWeight: fltNote.warn ? 600 : 400, lineHeight: 1.5 } }, fltNote.text) : null,
        ignoredSet.length ? h('div', { className: 'zyp-note', style: { marginTop: 4, color: '#e0b25c' } },
          '⚠ 「' + ignoredSet.join(' / ') + '」是店铺维度条件, 只在【采集】时判定, 对商品库筛选无效 → 结果不会变。'
          + '要按店铺/品牌看商品库, 请用面板里的「卖家」「品牌状态」或工具栏的「品牌」列。') : null);
      const expPanel = !expOpen ? null : h('div', { className: 'zyp-card', style: { borderColor: '#4f8cff' } },
        h('div', { className: 'zyp-h' }, '📊 导出表格 (勾选要导出的列)'),
        h('div', { className: 'zyp-note', style: { marginBottom: 6 } }, '默认已勾选「重要信息」10 列: ASIN / 站点 / 标题 / 价格 / 币种 / 配送 / 自营 / A+ / AC / 跳转链接。表格第一行冻结, 价格等为数值列。'),
        h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 4, border: '1px solid #333', borderRadius: 8, padding: 6 } },
          EXPORT_COLS.map(function (c) {
            const on = !!expCols[c[0]];
            return h('label', { key: c[0], style: { display: 'inline-flex', gap: 4, alignItems: 'center', fontSize: 12, border: '1px solid #333', borderRadius: 6, padding: '1px 7px', cursor: 'pointer', background: on ? 'rgba(79,140,255,.14)' : 'transparent' } },
              h('input', { type: 'checkbox', checked: on, onChange: function () { expToggle(c[0]); } }), c[1]);
          })),
        h('div', { style: { marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' } },
          h('button', { className: 'zyp-btn', style: { background: '#1e7a3c', borderColor: '#1e7a3c', color: '#fff' }, onClick: function () { doExport('xlsx'); } }, '⬇ 下载 Excel (.xlsx)'),
          h('button', { className: 'zyp-btn', onClick: function () { doExport('csv'); } }, '⬇ 下载 CSV'),
          h('button', { className: 'zyp-btn', onClick: function () { doExport('txt'); } }, '⬇ 下载 TXT'),
          h('button', { className: 'zyp-btn', onClick: function () { const m = {}; EXPORT_COLS.forEach(function (c) { m[c[0]] = !!c[2]; }); setExpCols(m); } }, '↺ 只选重要信息'),
          h('button', { className: 'zyp-btn', onClick: function () { const m = {}; EXPORT_COLS.forEach(function (c) { m[c[0]] = true; }); setExpCols(m); } }, '全选'),
          h('button', { className: 'zyp-btn', onClick: function () { const m = {}; EXPORT_COLS.forEach(function (c) { m[c[0]] = false; }); setExpCols(m); } }, '全不选'),
          h('button', { className: 'zyp-btn', onClick: function () { const u = expUrl('xlsx'); if (typeof openExternal === 'function') openExternal(u, '导出 Excel'); else window.open(u, '_blank'); } }, '🔗 浏览器打开'),
          h('span', { className: 'zyp-note', style: { marginLeft: 'auto' } }, '已勾选 ' + expChosen().length + ' 列 · ' + (selArr().length ? '将导出选中 ' + selArr().length + ' 个' : '将导出全部 ' + total + ' 个')),
          h('button', { className: 'zyp-btn', onClick: function () { setExpOpen(false); } }, '✕ 收起')));
      const seedBar = seed ? h('div', { className: 'zyp-toolbar', style: { background: 'rgba(79,140,255,.10)', borderColor: '#4f8cff' } },
        h('span', { style: { fontWeight: 600, color: '#8ab4ff' } }, '🗂 正在查看单次采集结果: ' + (seed.label || '')),
        h('span', { className: 'zyp-note' }, '仅显示该次采集入库的商品'),
        h('button', { className: 'zyp-btn', style: { marginLeft: 'auto' }, onClick: function () { setFlt(NF()); setPage(1); setTimeout(function () { load(false); }, 0); } }, '✕ 显示全部商品')) : null;
      // 工具栏: 搜索框 + 面板开关 + 动作按钮
      // ★ 2026-09-24 去重: 原「配送(含第三方卖家 等5项) / A+ / 全部标签 / 全部卖家地区」4 个快捷下拉已从此处删除 ——
      //   它们与 🎛 过滤条件 面板的「配送方式」「卖家」「A+」「中国卖家」「页面标识」完全同义(共用同一个 flt 状态), 统一只保留在面板里。
      const toolbar = h('div', { className: 'zyp-toolbar' },
        h('input', {
          className: 'zyp-input', value: flt.q, placeholder: '🔍 搜索 ASIN/标题 (回车即查)', style: { width: 190 },
          onChange: function (e) { setFlt(Object.assign({}, flt, { q: e.target.value })); },
          onKeyDown: function (e) { if (e.key === 'Enter') { setPage(1); load(false); } },   // ★ 搜索框回车直接查
        }),
        // ★ 2026-09 新增: 大类目 / 二级类目 正向筛选, 【显示中文】。
        //   为什么中文在服务端算: 插件面板给的类目名按站点语言本地化(法语 Auto et Moto / 德语 Auto & Motorrad),
        //   且"榜单选品"给的是细类目 → 库内 cat1 有 2679 个不同取值, 前端没法翻。服务端 catCnOf() 把它们
        //   归并成中文大类(汽车用品/家居厨房/…), /api/products/cat-tree 额外返回 treeCn 供这里显示。
        //   筛选按 cat1Cn(中文大类) 精确匹配; 二级类目仍按原始 cat2 值精确匹配。
        h('select', {
          className: 'zyp-input', value: flt.cat1Cn || '', title: '只看某个大类目 (中文归并: 汽车用品/家居厨房/…)。(N) 是该大类目下商品数',
          onChange: function (e) { const v = e.target.value; setFlt(Object.assign({}, flt, { cat1Cn: v, cat1: '', cat2: '' })); setPage(1); setTimeout(function () { load(false); }, 0); },
        },
          h('option', { value: '' }, '全部大类目'),
          (((catTree && catTree.treeCn) || []).filter(function (n) { return n.cat1 !== '未分类'; })
            .map(function (n) { return h('option', { key: n.cat1, value: n.cat1 }, n.cat1 + ' (' + n.count + ')'); })),
          h('option', { value: '未分类' }, '未分类 (无类目数据)')),
        (flt.cat1Cn ? h('select', {
          className: 'zyp-input', value: flt.cat2 || '', title: '二级类目 (该大类目下的具体类目名, 原样显示)',
          onChange: function (e) { setFlt(Object.assign({}, flt, { cat2: e.target.value })); setPage(1); setTimeout(function () { load(false); }, 0); },
        },
          h('option', { value: '' }, '全部二级类目'),
          (function () {
            const grp = ((catTree && catTree.treeCn) || []).filter(function (n) { return n.cat1 === flt.cat1Cn; })[0];
            if (!grp) return [];
            const raws = {};
            (grp.raws || []).forEach(function (r) { raws[r.name] = true; });
            const agg = {};
            ((catTree && catTree.tree) || []).forEach(function (n) {
              if (!raws[n.cat1]) return;
              (n.children || []).forEach(function (c) { agg[c.cat2] = (agg[c.cat2] || 0) + c.count; });
            });
            return Object.keys(agg).sort(function (a, b) { return agg[b] - agg[a]; })
              .map(function (k) { return h('option', { key: k, value: k }, k + ' (' + agg[k] + ')'); });
          })()) : null),
        h('button', { className: 'zyp-btn', onClick: function () { setPage(1); load(false); } }, '🔍 搜索'),
        h('button', { className: 'zyp-btn', style: fopen ? { borderColor: '#4f8cff', color: '#8ab4ff' } : undefined, onClick: function () { if (!fopen && !catTree) loadCatTree(); setFopen(!fopen); } }, '🎛 过滤条件' + (function () { const n = Object.keys(NF()).filter(function (k) { const val = flt[k]; return Array.isArray(val) ? val.length > 0 : (typeof val === 'boolean' ? val : (val !== '' && val != null)); }).length; return n ? ' (' + n + ')' : ''; })()),
        h('button', { className: 'zyp-btn', style: full ? { borderColor: '#4f8cff', color: '#8ab4ff' } : undefined, onClick: function () { setFull(!full); } }, full ? '⛶ 退出全屏' : '⛶ 全屏'),
        h('button', { className: 'zyp-btn', onClick: refreshRank, disabled: !!busy }, busy === 'rank' ? '补采中…' : '📡 补采排名'),
        h('button', { className: 'zyp-btn', onClick: search1688, disabled: !!busy }, busy === 'g1688' ? '图搜中…' : '🖼 1688 图搜找货'),
        // ★ 变体族: 折叠开关 (默认开) + 重建按钮 (纯计算, 秒级, 幂等)
        h('button', {
          className: 'zyp-btn', style: famFold ? { borderColor: '#4f8cff', color: '#8ab4ff' } : undefined,
          title: '同族商品只显示一行(优先显示族代表)。族键来自采集时的变体识别(twister/卡片面板/标题推测)',
          onClick: function () { setFamFold(!famFold); },
        }, famFold ? ('⊟ 已折叠变体族' + (foldHidden ? ' (-' + foldHidden + ')' : '')) : '⊞ 不折叠'),
        // 族级筛选(服务端): 只看多变体族/真变体/同款多型号/已确认/隐藏推测/只看代表
        h('select', {
          className: 'zyp-input', style: { fontSize: 12 }, value: flt.famFilter || '', title: '按变体族筛选(服务端)',
          onChange: function (e) { setFlt(Object.assign({}, flt, { famFilter: e.target.value })); setPage(1); setTimeout(function () { load(false); }, 0); },
        },
          h('option', { value: '' }, '全部族'),
          h('option', { value: 'multi' }, '只看多变体族'),
          h('option', { value: 'variant' }, '只看真变体族'),
          h('option', { value: 'sibling' }, '只看同款多型号'),
          h('option', { value: 'confirmed' }, '只看已确认族'),
          h('option', { value: 'hideGuess' }, '隐藏推测族'),
          h('option', { value: 'repOnly' }, '只看族代表'),
          h('option', { value: 'manual' }, '只看手工族')),
        h('label', { style: { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }, title: '族内任一成员符合筛选条件 → 整族都保留(选品直觉)' },
          h('input', { type: 'checkbox', checked: !!flt.famAny, onChange: function (e) { setFlt(Object.assign({}, flt, { famAny: e.target.checked })); setPage(1); setTimeout(function () { load(false); }, 0); } }),
          '族内任一满足'),
        // 族代表规则(重建时生效)
        h('select', {
          className: 'zyp-input', style: { fontSize: 12 }, value: 'follow', title: '族代表规则: 重建变体族时按此挑代表(★标记的那一行)',
          onChange: function (e) {
            const repBy = e.target.value;
            setBusy('fam'); setTask('按「' + e.target.selectedOptions[0].text + '」重建中…');
            api('/api/products/rebuild-variant-groups', 'POST', { repBy: repBy }).then(function (r) {
              setBusy(''); setTask('');
              const j = (r && r.json) || {};
              if (j.error) { setMsg('✗ 重建失败: ' + j.error); return; }
              setMsg('🧩 已按规则重建族代表: ' + e.target.selectedOptions[0].text + ' · ' + j.families + ' 族 / 多变体族 ' + j.multiFamilies + ' · ' + j.ms + 'ms');
              load();
            }).catch(function (er) { setBusy(''); setTask(''); setMsg('✗ 重建失败: ' + String(er && er.message || er)); });
          },
        },
          h('option', { value: 'follow' }, '代表: 跟卖数最多'),
          h('option', { value: 'rank' }, '代表: 大排名最好'),
          h('option', { value: 'sales' }, '代表: 月销最高'),
          h('option', { value: 'price' }, '代表: 价格最低')),
        h('button', {
          className: 'zyp-btn', title: '全库重算变体族: 重新识别族键、划分族、按规则选族代表(纯计算, 不读页面, 秒级, 幂等)',
          onClick: function () {
            setBusy('fam'); setTask('重建变体族中…');
            api('/api/products/rebuild-variant-groups', 'POST', { repBy: 'follow' }).then(function (r) {
              setBusy(''); setTask('');
              const j = (r && r.json) || {};
              if (j.error) { setMsg('✗ 重建失败: ' + j.error); return; }
              setMsg('🧩 变体族重建完成: 共 ' + j.families + ' 族, 其中多变体族 ' + j.multiFamilies + ' 族(涉及 ' + j.itemsInFamilies + ' 个商品)'
                + ' · 真变体 ' + ((j.familyKind || {}).variant || 0) + ' / 同款多型号 ' + ((j.familyKind || {}).sibling || 0)
                + ' · 低质行(不聚类) ' + j.lowQualityRows + ' · ' + j.ms + 'ms');
              load();
            }).catch(function (e) { setBusy(''); setTask(''); setMsg('✗ 重建失败: ' + String(e && e.message || e)); });
          },
        }, busy === 'fam' ? '重建中…' : '🧩 重建变体族'),
        h('span', { className: 'zyp-note', style: { marginLeft: 'auto' } }, task || ('共 ' + total + ' 条')),
        h('span', { className: 'zyp-note', style: { fontSize: 10, opacity: .6 } }, UI_BUILD));
      const batchBar = h('div', { className: 'zyp-toolbar' },
        h('span', { className: 'zyp-note' }, '已选 ' + selArr().length + ' 项'),
        h('button', { className: 'zyp-btn', onClick: batchSave }, '💾 保存选中'),
        h('button', { className: 'zyp-btn', onClick: openSelLinks, title: '打开所选商品的所有链接: 商品页 / 品牌页 / 卖家页 / 1688 同款 (逐个在新标签页打开)' }, '🔗 打开所选链接'),
        h('button', { className: 'zyp-btn', onClick: function () { backfill(); }, disabled: !!busy, title: '只对【勾选】的商品补采: 详情页字段 + 插件面板(商标/月销)。未勾选会提示。' }, busy === 'backfill' ? '补采中…' : '🔄 一键补采'),
        h('label', { style: { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }, title: '同名同款的族只补代表一个(详情页 twister 会带回全族兄弟 ASIN) —— 实测省 68% 补采时间' },
          h('input', { type: 'checkbox', checked: bfRepOnly, onChange: function (e) { setBfRepOnly(e.target.checked); } }),
          '族内只补代表'),
        h('button', { className: 'zyp-btn', onClick: batchSync }, '🔄 同步选中'),
        h('button', { className: 'zyp-btn', onClick: batchDelete }, '🗑 批量删除'),
        h('button', { className: 'zyp-btn', onClick: clearAll }, '🧹 一键清空'),
        h('button', { className: 'zyp-btn', style: expOpen ? { borderColor: '#4f8cff', color: '#8ab4ff' } : undefined, onClick: function () { setExpOpen(!expOpen); } }, '📊 导出表格'),
        h('button', { className: 'zyp-btn', onClick: resetAll }, '↩ 重置'));
      // ── 常驻视口联动品牌汇总面板 (贴在商品列表下方, 随滚动窗口实时统计) ──────────────
      // ★ 2026-09 修复: 表头原本是 th(label, key) = h('th', { key: k }, t) —— 那个 k 只当 React key,
      //   没有任何点击行为; 可表头写着「跟卖↑」这类带箭头的字样, 看起来就是可点排序, 点了却没反应。
      //   现在表头可点, 与下拉共用同一个 vpSort 状态; 带方向的列(价格)再点一下切换升/降。
      const VP_ARROW = { 'price-asc': ' ▲', 'price-desc': ' ▼', 'rank-parent': ' ▲', 'rank-child': ' ▲', brand: ' ▲', avg: ' ▼', follow: ' ▼', count: ' ▼' };
      const vpTh = function (label, key, toggles) {
        const idx = toggles ? toggles.indexOf(vpSort) : -1;
        const active = idx >= 0 || vpSort === key;
        const next = idx >= 0 ? toggles[(idx + 1) % toggles.length] : key;
        return h('th', {
          key: key,
          title: '点击按「' + label + '」排序' + (toggles ? ' (再点切换升/降)' : ''),
          onClick: function () { setVpSort(next); },
          style: { cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', color: active ? '#8ab4ff' : undefined, fontWeight: active ? 700 : undefined },
        }, (idx >= 0 ? (label + (vpSort === 'price-asc' ? ' ↑' : ' ↓')) : label) + (active ? ' ●' : ''));
      };
      const vpBodyRef = React.useRef(null);
      // 排序变了 → 面板内部滚回顶部, 否则停在列表中间时"顺序变了也看不出来"(会被误判成排序没用)
      React.useEffect(function () { const el = vpBodyRef.current; if (el) el.scrollTop = 0; }, [vpSort]);
      // 商品视图表格: 每个商品一行; 勾选框直接写商品选中集合(sel), 所以批量操作栏可直接用。
      const vpProdTable = h('table', { className: 'zyp-tbl', style: { fontSize: 11.5, minWidth: 0 } },
        h('thead', null, h('tr', null,
          h('th', { style: { width: 28 } }, ''),
          vpTh('品牌', 'brand'), h('th', { style: { whiteSpace: 'nowrap' } }, 'ASIN'),
          vpTh('价格', 'price-asc', ['price-asc', 'price-desc']),
          vpTh('父类排名(最好)', 'rank-parent'), vpTh('子类排名(最好)', 'rank-child'), vpTh('跟卖', 'follow'),
          h('th', { style: { whiteSpace: 'nowrap' } }, '站点'))),
        h('tbody', null, vpProdSorted.map(function (p) {
          const pv = (p.minPrice != null ? p.minPrice : p.price);
          return h('tr', { key: p.asin },
            h('td', null, h('input', { type: 'checkbox', checked: !!sel[p.asin], title: '勾选该商品(可直接用上方批量操作)', onChange: function () { toggle(p.asin); } })),
            h('td', null, h('b', { title: '点击只看该品牌', style: { cursor: 'pointer' }, onClick: function () { setVpSel({ [brandKeyOf(p)]: true }); setVpOnly(true); setPage(1); } }, brandKeyOf(p))),
            h('td', { style: { fontFamily: 'ui-monospace,monospace', cursor: 'pointer' }, title: '双击进详情', onDoubleClick: function () { openDetail(p); } }, p.asin),
            h('td', null, pv == null ? '-' : FmtMoney(pv, p.currency)),
            h('td', { style: { color: (p.rankParent != null && p.rankParent < 100) ? '#f0b253' : undefined } },
              p.rankParent != null ? FmtNum(p.rankParent)
                : (rankParentIsNotListed(p) ? h('span', { className: 'zyp-note', style: { color: '#e0b25c', cursor: 'help' }, title: rankParentNote(p) }, '未上榜') : '-')),
            h('td', null, p.rankChild == null ? '-' : FmtNum(p.rankChild)),
            h('td', null, p.followCount == null ? '-' : FmtNum(p.followCount)),
            h('td', null, String(p.site || '').toUpperCase()));
        })));
      const vpPanel = (items && items.length) ? h('div', {
        style: {
          position: 'sticky', bottom: 0, zIndex: 6, marginTop: 6,
          background: 'rgba(24,24,29,.97)', border: '1px solid #3a3a44', borderRadius: 10,
          padding: '7px 10px', boxShadow: '0 -6px 18px rgba(0,0,0,.35)',
        },
      },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12 } },
          h('b', null, '📊 视口汇总'),
          h('button', { className: 'zyp-btn', style: { padding: '2px 8px', fontSize: 11.5, borderColor: vpMode === 'product' ? '#4f8cff' : undefined, color: vpMode === 'product' ? '#8ab4ff' : undefined }, title: '按商品排序列出视口内每一张卡', onClick: function () { setVpMode('product'); if (vpSort === 'count' || vpSort === 'avg') setVpSort('price-asc'); } }, '按商品'),
          h('button', { className: 'zyp-btn', style: { padding: '2px 8px', fontSize: 11.5, borderColor: vpMode === 'brand' ? '#4f8cff' : undefined, color: vpMode === 'brand' ? '#8ab4ff' : undefined }, title: '按品牌聚合并排序(原视图)', onClick: function () { setVpMode('brand'); } }, '按品牌'),
          h('span', { className: 'zyp-note' }, '当前窗口可见 ' + vpVisible + ' 行 · ' + (vpMode === 'product' ? vpProdSorted.length + ' 个商品' : vpSorted.length + ' 个品牌')
            + (vpSelBrands.length ? ' · 已勾选 ' + vpSelBrands.length + ' 个品牌(' + vpSelAsins.length + ' 个商品)' : '')),
          h('span', { className: 'zyp-note' }, '排序'),
          h('select', { className: 'zyp-input', style: { fontSize: 12, padding: '2px 6px' }, value: vpSort, onChange: function (e) { setVpSort(e.target.value); } },
            (vpMode === 'product'
              ? [['price-asc', '价格 ↑ (最低价)'], ['price-desc', '价格 ↓ (最低价)'], ['rank-parent', '父类排名 ↑ (最好)'], ['rank-child', '子类排名 ↑ (最好)'], ['follow', '跟卖数 ↓'], ['brand', '品牌 A→Z']]
              : [['price-asc', '价格 ↑ (最低价)'], ['price-desc', '价格 ↓ (最低价)'], ['rank-parent', '父类排名 ↑ (最好)'], ['rank-child', '子类排名 ↑ (最好)'], ['follow', '跟卖数 ↓'], ['count', '商品数 ↓'], ['brand', '品牌 A→Z'], ['avg', '均价 ↓']])
              .map(function (o) { return h('option', { key: o[0], value: o[0] }, o[1]); })),
          h('button', { className: 'zyp-btn', style: { padding: '2px 8px', fontSize: 11.5 }, onClick: function () {
            const n = {}; vpSorted.forEach(function (o) { n[o.brand] = true; }); setVpSel(n);
          } }, '全选可见品牌'),
          h('button', { className: 'zyp-btn', style: { padding: '2px 8px', fontSize: 11.5 }, onClick: function () { setVpSel({}); } }, '清空勾选'),
          h('button', { className: 'zyp-btn', style: { padding: '2px 8px', fontSize: 11.5 }, disabled: !vpSelBrands.length, onClick: function () {
            if (!vpSelAsins.length) return;
            setSel(function (o) { const n = Object.assign({}, o); vpSelAsins.forEach(function (a) { n[a] = true; }); return n; });
            setMsg('✔ 已选中勾选品牌的 ' + vpSelAsins.length + ' 个商品 (可用上方批量操作)');
          } }, '选中这些品牌的商品' + (vpSelAsins.length ? '(' + vpSelAsins.length + ')' : '')),
          h('label', { style: { display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' } },
            h('input', { type: 'checkbox', checked: vpOnly, disabled: !vpSelBrands.length, onChange: function () { setVpOnly(!vpOnly); setPage(1); } }),
            '只看勾选品牌'),
          h('button', { className: 'zyp-btn', style: { marginLeft: 'auto', padding: '2px 8px', fontSize: 11.5 }, onClick: function () { setVpOpen(!vpOpen); } }, vpOpen ? '收起 ▾' : '展开 ▴')),
        !vpOpen ? null : h('div', { ref: vpBodyRef, style: { maxHeight: 148, overflow: 'auto', marginTop: 6 } },
          vpMode === 'product'
            ? (!vpProdSorted.length ? h('div', { className: 'zyp-note', style: { padding: '6px 2px' } }, '当前滚动窗口内没有商品行（把列表滚一下或换一页再看）') : vpProdTable)
            :
          !vpSorted.length ? h('div', { className: 'zyp-note', style: { padding: '6px 2px' } }, '当前滚动窗口内没有商品行（把列表滚一下或换一页再看）') :
          h('table', { className: 'zyp-tbl', style: { fontSize: 11.5, minWidth: 0 } },
            h('thead', null, h('tr', null,
              h('th', { style: { width: 28 } }, ''),
              vpTh('品牌', 'brand'), vpTh('商品数', 'count'), vpTh('价格区间', 'price-asc', ['price-asc', 'price-desc']), vpTh('均价', 'avg'), vpTh('父类排名(最好)', 'rank-parent'), vpTh('子类排名(最好)', 'rank-child'), vpTh('跟卖', 'follow'))),
            h('tbody', null, vpSorted.map(function (o) {
              return h('tr', { key: o.brand },
                h('td', null, h('input', { type: 'checkbox', checked: !!vpSel[o.brand], onChange: function () { setVpSel(function (s) { const n = Object.assign({}, s); if (n[o.brand]) delete n[o.brand]; else n[o.brand] = true; return n; }); } })),
                h('td', null, h('b', { title: '点击只看该品牌', style: { cursor: 'pointer' }, onClick: function () { setVpSel({ [o.brand]: true }); setVpOnly(true); setPage(1); } }, o.brand)),
                h('td', null, o.n),
                h('td', null, o.min == null ? '-' : (FmtMoney(o.min, o.cur) + (o.max != null && o.max !== o.min ? ' ~ ' + FmtMoney(o.max, o.cur) : ''))),
                h('td', null, o.avg == null ? '-' : FmtMoney(o.avg, o.cur)),
                h('td', { style: { color: (o.rankP != null && o.rankP < 100) ? '#f0b253' : undefined } }, o.rankP == null ? '-' : FmtNum(o.rankP)),
                h('td', null, o.rankC == null ? '-' : FmtNum(o.rankC)),
                h('td', null, o.follow || 0));
            }))))) : null;
      // ===== 商品卡片流 (2026-09 改版) =====
      // 原表格 16 列 → 卡片: 主图上占 70%, 主图下方只留 7 项主要数据 + 勾选框; 其余全部进「详情」页。
      const selBar = h('div', { style: { display: 'flex', alignItems: 'center', gap: 12, padding: '2px 2px 10px', flexWrap: 'wrap', fontSize: 13 } },
        h('label', { style: { display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer' }, title: '勾选/取消本页全部商品' },
          h('input', { type: 'checkbox', checked: !!allOn, ref: function (el) { if (el) el.indeterminate = someOn && !allOn; }, onChange: toggleAll }),
          '全选本页'),
        h('span', { className: 'zyp-note' }, '本页 ' + cur.length + ' 个 · 已选 ' + selArr().length + ' 个'),
        h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px solid #3a3a44', borderRadius: 7, padding: '1px 6px' }, title: '放大/缩小整个商品界面(工具栏/筛选/卡片/分页一起等比缩放, 与浏览器缩放同感); 也可以按住 Ctrl 在卡片区滚轮' },
          h('span', { className: 'zyp-note', style: { fontSize: 12 } }, '界面'),
          h('button', { className: 'zyp-btn', style: { padding: '0 8px', fontSize: 13 }, disabled: cardScale <= CARD_SCALE_MIN + 1e-9, onClick: function () { stepScale(-CARD_SCALE_STEP); }, title: '缩小' }, '－'),
          h('span', { style: { minWidth: 46, textAlign: 'center', fontVariantNumeric: 'tabular-nums', cursor: 'pointer' }, title: '点一下恢复 100%', onClick: function () { setCardScale(1); } }, Math.round(cardScale * 100) + '%'),
          h('button', { className: 'zyp-btn', style: { padding: '0 8px', fontSize: 13 }, disabled: cardScale >= CARD_SCALE_MAX - 1e-9, onClick: function () { stepScale(CARD_SCALE_STEP); }, title: '放大' }, '＋')),
        h('button', { className: 'zyp-btn', style: { padding: '2px 10px', fontSize: 12.5 }, title: '自定义排名数字的底色(按排名区间配色)', onClick: function () { setRankCfgOpen(true); } }, '🎨 排名底色'),
        h('button', { className: 'zyp-btn', style: { padding: '2px 10px', fontSize: 12.5, borderColor: cardBgCustomized(cardBg) ? '#4f8cff' : undefined }, title: '自定义商品卡片底色(默认 / FBA / FBM / AMZ 各一个颜色)', onClick: function () { setCardBgOpen(true); } }, '🎨 卡片底色'),
        h('span', { className: 'zyp-note', style: { marginLeft: 'auto' } }, '单击卡片勾选 · 双击进详情 · 主图右上角 🔍 放大镜'));
      // 列表高度: 尽量占满屏幕(减去上方 tab/工具栏/筛选面板的大致高度), 但至少留 560px, 避免面板折叠时被压扁
      /* ★ 缩放补偿: 滚动区的 max-height 在被 zoom 的子树里会被一起缩小(视口单位不除 zoom),
       *   所以这里先按倍数除回去 → 缩放到 70% 时列表仍然占满屏幕高度, 不会剩一大片空白。 */
      const zvS = Number(cardScale) || 1;
  /* ★ 2026-09-28 把倍数广播给 ZyRoot, 让顶部标签栏同步缩放(见 ZyRoot 里的监听) */
  React.useEffect(function () { try { window.dispatchEvent(new CustomEvent('zying-card-scale', { detail: zvS })) } catch (e) {} }, [zvS]);
      const listMaxH = 'max(' + Math.round(560 / zvS) + 'px, calc((100vh - 250px) / ' + zvS + '))';
      // 族内对比弹窗: 一屏看齐同族的全部成员(价格/跟卖/排名/月销/类目), 用来挑主推规格
      const famModalEl = !famModal ? null : h(Modal, { title: (famModal.kind === 'variant' ? '变体族' : '同款多型号族') + ' · ' + famModal.members.length + ' 个成员', onClose: function () { setFamModal(null); } }, h('div', { style: { maxHeight: '60vh', overflow: 'auto' } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' } },
          h('span', { className: 'zyp-note' }, '识别置信度: ' + (famModal.src === 'twister' ? '已确认(详情页 twister)' : famModal.src === 'card' ? '较可信(卡片面板给了变体数)' : famModal.src === 'manual' ? '手工' : '推测(仅标题主干相同)')),
          h('button', {
            className: 'zyp-btn', style: { padding: '1px 8px', fontSize: 11.5 }, title: '只显示这一族的商品(服务端按族键筛)',
            onClick: function () { setFlt(Object.assign({}, flt, { famKey: famModal.key, famFilter: '' })); setPage(1); setFamModal(null); setTimeout(function () { load(false); }, 0); },
          }, '只看这一族')),
        h('table', { className: 'zyp-tbl', style: { fontSize: 12, minWidth: 640 } },
          h('thead', null, h('tr', null, ['代表', 'ASIN', '价格', '跟卖', '大排名', '小排名', '月销', '类目', '标题', '操作'].map(function (t) { return h('th', { key: t }, t); }))),
          h('tbody', null, famModal.members.map(function (m) {
            const pv = (m.minPrice != null ? m.minPrice : m.price);
            return h('tr', { key: m.asin, style: m.variantRole === 'parent' ? { background: 'rgba(79,140,255,.10)' } : undefined },
              h('td', null, m.variantRole === 'parent' ? '★' : ''),
              h('td', { style: { fontFamily: 'ui-monospace,monospace' } }, m.asin),
              h('td', null, pv == null ? '-' : FmtMoney(pv, m.currency)),
              h('td', null, m.followCount == null ? '-' : m.followCount),
              h('td', null, m.rankParent == null ? (rankParentIsNotListed(m) ? h('span', { className: 'zyp-note', style: { color: '#e0b25c', cursor: 'help' }, title: rankParentNote(m) }, '未上榜') : '-') : FmtNum(m.rankParent)),
              h('td', null, m.rankChild == null ? '-' : FmtNum(m.rankChild)),
              h('td', null, FmtNum(m.monthlySales)),
              h('td', null, String(m.cat1 || '-').slice(0, 14)),
              h('td', { title: m.title, style: { maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, String(m.title || '').slice(0, 34)),
              h('td', { style: { whiteSpace: 'nowrap' } },
                h('button', {
                  className: 'zyp-btn', style: { padding: '1px 6px', fontSize: 11 }, title: '把这一个拆成独立一族(人工判定优先, 重建时不会被冲掉)',
                  onClick: function (e) { e.stopPropagation(); variantOverride(m.asin, 'split'); },
                }, '拆出'),
                h('button', {
                  className: 'zyp-btn', style: { padding: '1px 6px', fontSize: 11, marginLeft: 4 }, title: '把这一个并入本族代表所在的族',
                  onClick: function (e) { e.stopPropagation(); variantOverride(m.asin, 'merge', famModal.key); },
                }, '并入代表'),
                m.variantSolo || m.variantManualKey ? h('button', {
                  className: 'zyp-btn', style: { padding: '1px 6px', fontSize: 11, marginLeft: 4 }, title: '还原为自动识别',
                  onClick: function (e) { e.stopPropagation(); variantOverride(m.asin, 'reset'); },
                }, '还原') : null));
          })))));
      const tableEl = h('div', { ref: vpScrollRef, style: full ? { overflow: 'visible' } : { overflow: 'auto', maxHeight: listMaxH } },
        items === null ? h('div', { className: 'zyp-note', style: { padding: 14 } }, '加载中…') :
        h('div', null,
          selBar,
          cur.length
            ? h('div', {
                className: 'zyp-pgrid',
                /* 列宽固定 300 —— 缩放交给外层 zoom: 容器坐标系变大, auto-fill 自动排更多列(与浏览器缩放同感) */
                style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 14 },
                // Ctrl + 滚轮 = 缩放界面(普通滚轮仍是滚动, 不抢)
                onWheel: function (e) { if (!e.ctrlKey) return; e.preventDefault(); stepScale(e.deltaY < 0 ? CARD_SCALE_STEP : -CARD_SCALE_STEP); },
                title: '按住 Ctrl 滚轮 = 放大/缩小界面',
              }, foldedCur.map(productCard))
            : h('div', { className: 'zyp-note', style: { textAlign: 'center', padding: 24 } }, '无匹配商品 (可去采集面板采集)')),
          vpPanel);                                   // ★ 视口汇总面板(famModalEl 已挪到缩放容器外面, 免被 zoom 拉变形)
      const pager = h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', flexWrap: 'wrap' } },
        h('button', { className: 'zyp-btn', disabled: shownPage <= 1, onClick: function () { setPage(shownPage - 1); } }, '◀ 上一页'),
        h('span', { className: 'zyp-note' }, '第 ' + shownPage + '/' + pages + ' 页 · 共 ' + total + ' 条' + (page !== shownPage ? '（已记住第 ' + page + ' 页）' : '')),
        h('button', { className: 'zyp-btn', disabled: shownPage >= pages, onClick: function () { setPage(shownPage + 1); } }, '下一页 ▶'),
        h('select', { className: 'zyp-input', value: String(size), onChange: function (e) { setSize(Number(e.target.value)); setPage(1); } }, [20, 50, 100, 200].map(function (n) { return h('option', { key: n, value: String(n) }, '每页 ' + n); })));
      // ===== 全屏框 (2026-09-15) =====
      // 需求: 给整个商品列表加一个全屏框, 并且【放大列表整体 UI】。
      // 做法: 用 CSS zoom 让 工具栏 + 表格 + 分页 整体等比放大 (行高/字号/控件一起变大),
      // 而不是只把容器拉大 —— 只拉容器的话行还是原来那么小, 屏幕上一大半是空白。
      // 表头 sticky 仍然生效: 全屏时表格容器不再自带滚动条, 由外层滚动容器承接。
      /* ★ 2026-09-27 修复「点缩小只有数据缩小了界面没缩小」(用户反馈):
       *   之前 cardScale 只乘在【卡片内部字号】和网格列宽上 —— 工具条/筛选/分页/全选条原样不动,
       *   缩完满屏空白, 看着就像"没缩"。现在把缩放提到【整块列表视图】上(CSS zoom):
       *   工具栏 + 卡片/表格 + 分页 一起等比缩放, 与浏览器 Ctrl+滚轮同感(全屏框里那套 zoom 也是这个道理)。
       *   ★ 卡片内部不再自己乘倍数(见 productCard 的 px), 否则会被缩两次。 */
      const listUI = h('div', { style: { zoom: String(zvS) } }, toolbar, tableEl, pager);
      const listBlock = !full ? null : h('div', { style: { position: 'fixed', inset: 0, zIndex: 9000, background: 'var(--dsw-alias-bg-layer-1,#1b1b1f)', display: 'flex', flexDirection: 'column' } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid #333', flexWrap: 'wrap' } },
          h('b', null, '📦 商品列表 (全屏)'),
          h('span', { className: 'zyp-note' }, '共 ' + total + ' 条 · 第 ' + page + '/' + pages + ' 页'),
          h('span', { className: 'zyp-note', style: { marginLeft: 'auto' } }, '整体放大'),
          h('select', { className: 'zyp-input', value: String(zoom), onChange: function (e) { setZoom(Number(e.target.value)); } },
            [1, 1.15, 1.3, 1.5, 1.75, 2].map(function (z) { return h('option', { key: z, value: String(z) }, Math.round(z * 100) + '%'); })),
          h('button', { className: 'zyp-btn', onClick: function () { setFull(false); } }, '✕ 退出全屏 (Esc)')),
        h('div', { ref: vpFullRef, style: { flex: '1 1 auto', minHeight: 0, overflow: 'auto', padding: '8px 12px 14px' } },
          h('div', { style: { zoom: String(zoom) } }, listUI)));
      /* 非全屏: 把这一屏的所有块装进【同一个缩放容器】—— 这样 －/＋ 缩的是整块界面
       * (工具栏/筛选/全选条/卡片/分页一起), 而不只是卡片字号。 */
      const normalView = h('div', { style: { zoom: String(zvS) } },
        seedBar, toolbar, govCard, filterPanel, filterActions, expPanel, batchBar, tableEl, pager);
      // 全屏时原位置让位给 listBlock (否则同一个列表会同时渲染两份)
      return h('div', null,
        full ? null : normalView,
        listBlock,
        magLayer,                        // ★ 放大镜(点主图右上角 🔍 打开: 圆形镜片跟随放大 / 滚轮换倍率)
        famModalEl,                      // ★ 变体族对比弹窗(固定定位, 放在缩放容器【外面】才不会被 zoom 拉变形)
        rankCfgModal,                    // ★ 排名数字底色配置
        cardBgModal,                     // ★ 商品卡片底色配置
      // 详情页操作条: 卡片上不再放快捷操作(卡片只留主图 + 7 项数据 + 勾选框), 全部收进详情页
        dtl ? h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', padding: '8px 16px', borderBottom: '1px solid #2a2a30' } },
          h('button', { className: 'zyp-btn', onClick: function () { api('/api/products/save', 'POST', { asins: [dtl.asin], saved: !dtl.saved }).then(function () { load(); setDtl(function (d) { return Object.assign({}, d, { saved: !d.saved }); }); }).catch(function () {}); } }, dtl.saved ? '★ 已收藏' : '☆ 收藏'),
          h('button', { className: 'zyp-btn', title: '认领到草稿箱', onClick: function () { api('/api/claims', 'POST', { asin: dtl.asin }).then(function () { setMsg('✔ 已认领: ' + dtl.asin); }).catch(function (e) { setMsg('⚠ ' + String(e && e.message || e)); }); } }, '📌 认领到草稿箱'),
          h('button', { className: 'zyp-btn', onClick: function () { openExternal(amazonOf(dtl), dtl.asin); } }, '⧉ 亚马逊'),
          dtl.is1688Url ? h('button', { className: 'zyp-btn', onClick: function () { openExternal(dtl.is1688Url, '1688 同款'); } }, '1688 同款 ↗') : null,
          (function () { try { const b = productLinks(dtl).find(function (x) { return x.label === '品牌页' }); return b ? h('button', { className: 'zyp-btn', onClick: function () { openExternal(b.url, '品牌页'); } }, '🏷 品牌页 ↗') : null } catch (e) { return null } })(),
          h('button', { className: 'zyp-btn', style: { marginLeft: 'auto', color: '#f28b8b' }, onClick: function () { setModal2({ title: '删除', rows: ['确定删除 ' + dtl.asin + ' 吗?'], onOk: function () { setModal2(null); api('/api/products/delete', 'POST', { asins: [dtl.asin] }).then(function () { setSel(function (o) { const n = Object.assign({}, o); delete n[dtl.asin]; return n; }); setDtl(null); load(); }).catch(function (e) { setMsg('✗ ' + String(e && e.message || e)); }); } }); } }, '🗑 删除')) : null,
        dtl ? h('div', { style: { position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,.62)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '18px', overflow: 'auto' }, onClick: function (e) { if (e.target === e.currentTarget) { setDtl(null); load(); } } },  h('div', { style: { background: 'var(--dsw-alias-bg-layer-1,#1b1b1f)', border: '1px solid #3a3a44', borderRadius: 12, maxWidth: 1080, width: '100%' } },    h('div', { style: { padding: '10px 16px', borderBottom: '1px solid #333', display: 'flex', alignItems: 'center', gap: 8, position: 'sticky', top: 0, background: 'var(--dsw-alias-bg-layer-1,#1b1b1f)', zIndex: 2 } },      h('b', null, '📋 商品详情'), h('span', { className: 'zyp-note' }, String(dtl.asin || '') + ' · ' + String(dtl.site || '').toUpperCase()),      h('button', { className: 'zyp-btn', style: { marginLeft: 'auto' }, onClick: function () { setDtl(null); load(); } }, '✕ 关闭')),    h('div', { style: { padding: '4px 16px 16px', maxHeight: '86vh', overflowY: 'auto' } }, h(DetailPane, { p: dtl, api: api, openExternal: openExternal, notify: setMsg })))) : null,
        msg2 ? h(Modal, { title: '提示', rows: msg2, onClose: function () { setMsg2(null); } }) : null,
        // ★ 打开链接: 进度 + 「继续打开剩下 N 个 / 全部打开剩余 / 完成」, 一批 60 个不再丢弃剩下的
        // ★ 打开链接前的「链接分类」弹窗: 每类多少条 + 勾选要开哪几类(品牌店默认不勾, 不混着开)
        linkPick ? h(Modal, {
          title: '🔗 打开所选商品的所有链接 · 分类',
          onClose: function () { setLinkPick(null); },
          buttons: [
            { label: '取消', onClick: function () { setLinkPick(null); } },
            { label: '只留商品页', onClick: function () { setLinkKinds(normLinkKinds({ product: true })); } },
            { label: '开始打开', primary: true, onClick: startPicked },
          ],
          children: (function () {
            const sel = collectLinksByKind(linkPick.rows, linkKinds, productLinks);
            return h('div', null,
              h('div', { className: 'zywb-note', style: { marginBottom: 8, lineHeight: 1.7 } },
                '所选 ' + linkPick.rows.length + ' 个商品共 ' + linkPick.total + ' 条链接 —— 按类型勾选要打开哪几类(选择会被记住)。'
                + '默认只开「商品页」: 品牌店铺链接不再和商品页混在一起打开。'),
              LINK_KIND_DEFS.map(function (d) {
                const n = linkPick.byKind[d.k] || 0;
                const on = !!linkKinds[d.k];
                return h('label', {
                  key: d.k, 'data-link-kind': d.k, 'data-link-count': String(n),
                  style: { display: 'flex', alignItems: 'flex-start', gap: 8, padding: '7px 8px', borderBottom: '1px dashed #2a2a30', cursor: n ? 'pointer' : 'not-allowed', opacity: n ? 1 : 0.45 },
                },
                  h('input', {
                    type: 'checkbox', checked: on, disabled: !n,
                    onChange: function () { setLinkKinds(function (c) { const nn = normLinkKinds(c); nn[d.k] = !nn[d.k]; return nn; }); },
                  }),
                  h('span', { style: { flex: 1 } },
                    h('div', { style: { fontWeight: 600, fontSize: 12.5 } }, d.name + ' · ' + n + ' 条' + (d.k === 'brand' ? ' 🏷' : '')),
                    h('div', { className: 'zywb-note', style: { fontSize: 11 } }, d.hint)));
              }),
              h('div', { style: { marginTop: 8, fontWeight: 600, fontSize: 13 } },
                '将打开 ' + sel.items.length + ' 条'
                + (sel.items.length > LIMIT ? '（每批最多 ' + LIMIT + ' 条, 其余会保留, 可点「继续打开」接着开）' : ''),
                sel.items.length ? '' : h('span', { style: { color: '#e0b25c', fontWeight: 400 } }, ' —— 请至少勾选一类'),
                sel.byKind.brand ? h('span', { className: 'zywb-note', style: { fontWeight: 400 } }, '（含品牌店 ' + sel.byKind.brand + ' 条）') : null),
              h('div', { className: 'zywb-note', style: { marginTop: 4, fontSize: 11 } }, '浏览器会逐个新开标签页 —— 请确认允许弹出窗口。'));
          })()}): null,
        openMore ? h(Modal, {
          title: '🔗 打开所选商品的链接',
          onClose: openMore.busy ? null : function () { setOpenMore(null); },
          buttons: openMore.busy
            ? [{ label: '⏹ 停止', onClick: function () { openStopRef.current = true; } }]
            : [{ label: '完成', onClick: function () { setOpenMore(null); } }]
              .concat(openMore.restQ.length ? [{ label: '继续打开剩下 ' + openMore.restQ.length + ' 个', primary: true, onClick: continueOpen }] : [])
              .concat(openMore.restQ.length > LIMIT ? [{ label: '全部打开剩余 ' + openMore.restQ.length + ' 个', onClick: openAllRest }] : []),
          children: h('div', null,
            h('div', { style: { fontSize: 13, fontWeight: 600 }, 'data-openmore': openMore.busy ? 'busy' : 'done' },
              openMore.busy
                ? '⏳ 正在打开 ' + openMore.done + '/' + openMore.batch + ' …'
                : '✔ 已打开 ' + openMore.done + ' 个链接（累计 ' + openMore.opened + '/' + openMore.total + '）'
                  + (openMore.restQ.length ? '；还剩 ' + openMore.restQ.length + ' 个未打开' : '；已全部打开')),
            h('div', { className: 'zywb-note', style: { marginTop: 6, lineHeight: 1.7 } },
              openMore.busy
                ? '正在打开: ' + (openMore.cur || '…') + ' —— 点「⏹ 停止」可以立刻中断, 没开的仍然留着, 之后还能继续。'
                : (openMore.restQ.length
                  ? '每批最多 ' + LIMIT + ' 个(避免一次开太多把浏览器打死)。点「继续打开剩下 ' + openMore.restQ.length + ' 个」接着开, 可以反复点。'
                    + (openMore.restQ.length > LIMIT ? ' 也可以点「全部打开剩余」一次性开完(会新开 ' + openMore.restQ.length + ' 个标签页)。' : '')
                  : '所选商品的链接都打开了。若浏览器提示拦截弹窗, 请允许后重试。')
                + (openMore.stopped ? ' （本次是手动停止的）' : '')),
            h('div', { className: 'zywb-note', style: { marginTop: 4, fontSize: 11 } }, '链接构成: ' + (openMore.kinds || '-')))})
          : null,
        msg ? h(Modal, { title: '操作结果', rows: [msg], onClose: function () { setMsg(null); } }) : null,
        modal2 ? h(Modal, { title: modal2.title, rows: modal2.rows, onClose: function () { setModal2(null); }, buttons: [{ label: '取消', onClick: function () { setModal2(null); } }, { label: '确定', primary: true, onClick: function () { modal2.onOk(); } }] }) : null
      );
    }
    /* ===== ★ 「选品归档」页 (2026-09-27) =====
     * 用户要求原话: 「上架器只负责记录和显示信息，导出信息等，加上一个导出当前所有商品信息到…
     *   里存起来这种，因为这些都是我们最终选出来的品，具有模板或者借鉴意义，方便后续根据这些品来找相应的品」。
     * 后端在 ERP (selection-archive.json) —— 与网页端 3088 的「选品归档」是同一份数据, 两边共用接口, 不会打架。
     * 本页只做三件事: 归档(存快照) / 检索 / 导出文件 —— 不采集、不上架、不改商品库。
     */
    function ArchivePage(props) {
      const api = props.api;
      const pad2 = function (n) { return (n < 10 ? '0' : '') + n; };
      const d0 = new Date();
      const dstr = d0.getFullYear() + '-' + pad2(d0.getMonth() + 1) + '-' + pad2(d0.getDate());
      const [stats, setStats] = React.useState(null);
      const [batches, setBatches] = React.useState([]);
      const [rows, setRows] = React.useState([]);
      const [rowTotal, setRowTotal] = React.useState(0);
      const [name, setName] = React.useState(dstr + ' 选品归档');
      const [source, setSource] = React.useState('listing');
      const [site, setSite] = React.useState('');
      const [onlySaved, setOnlySaved] = React.useState(false);
      const [limit, setLimit] = React.useState('3000');
      const [q, setQ] = React.useState('');
      const [dedup, setDedup] = React.useState(true);
      const [curBatch, setCurBatch] = React.useState('');
      const [msg, setMsg] = React.useState('');
      const [busy, setBusy] = React.useState(false);
      const [modal, setModal] = React.useState(null);

      /* ===== ★ 分布统计 / 区间筛选 / 标签 / 自动归档 (2026-09-27) =====
       * 用户要求「先以搞薯条插件为主」—— 网页端做过的那三件事, 面板里也要有, 且共用同一套接口:
       *   /api/archive/stats(聚合) · /api/archive/items(筛选) · /api/archive/tag(标签) · /api/archive/auto(自动归档) */
      const [dist, setDist] = React.useState(null);
      const [cat1, setCat1] = React.useState('');
      const [catOpts, setCatOpts] = React.useState([]);       // 类目下拉选项(见过的并集, 不随筛选缩水)
      const [marginMin, setMarginMin] = React.useState('');
      const [salesMin, setSalesMin] = React.useState('');
      const [rankMax, setRankMax] = React.useState('');
      const [priceMin, setPriceMin] = React.useState('');
      const [priceMax, setPriceMax] = React.useState('');
      const [tag, setTag] = React.useState('');
      const [autoCfg, setAutoCfg] = React.useState(null);
      const TAGS = ['爆款', '试销', '放弃', '季节品'];
      const pairs = function (obj) { return Object.keys(obj || {}).filter(function (k) { return obj[k] > 0 }).map(function (k) { return [k, obj[k]] }) };
      /** 列表/统计/导出共用同一套筛选; ov 用于"刚 setState 还没生效"时先把新值传进来 */
      const qs = function (ov) {
        const o = { dedup: dedup ? '1' : '0', q: q, batchId: curBatch, cat1: cat1, tag: tag,
          marginMin: marginMin, salesMin: salesMin, rankMax: rankMax, priceMin: priceMin, priceMax: priceMax };
        Object.keys(ov || {}).forEach(function (k) { o[k] = ov[k] });
        return Object.keys(o).filter(function (k) { return o[k] !== '' && o[k] != null })
          .map(function (k) { return k + '=' + encodeURIComponent(String(o[k])) }).join('&');
      };
      const pullItems = function (ov) {
        return api('/api/archive/items?limit=300&' + qs(ov), 'GET', null).then(function (r) {
          if (r && r.ok && r.json) { setRows(r.json.items || []); setRowTotal(r.json.total || 0); }
        }).catch(function () {});
      };
      const pullDist = function (ov) {
        return api('/api/archive/stats?' + qs(ov), 'GET', null).then(function (r) {
          if (!r || !r.ok || !r.json) return;
          setDist(r.json);
          /* ★ 类目下拉的选项要用【见过的类目并集】: 分布是跟着筛选走的, 筛了"Automotive"之后
           *   byCategory1 只剩它一个 —— 若直接拿它当选项, 下拉就退化成只有一个类目, 想换类目
           *   必须先点「重置」(实测这么设计的网页端是靠"列表没变就不重建"绕过去的)。 */
          const cats = (r.json.byCategory1 || []).map(function (p) { return p[0] }).filter(Boolean);
          if (cats.length) setCatOpts(function (prev) {
            const out = prev.slice();
            cats.forEach(function (c) { if (out.indexOf(c) < 0) out.push(c) });
            return out.length === prev.length ? prev : out;
          });
        }).catch(function () {});
      };
      const pull = function (ov) {
        return api('/api/archive/list', 'GET', null).then(function (r) {
          if (r && r.ok && r.json) { setStats(r.json.stats || null); setBatches(r.json.batches || []); }
        }).catch(function () {}).then(function () { return Promise.all([pullItems(ov), pullDist(ov)]); });
      };
      const pullAuto = function () {
        return api('/api/archive/auto', 'GET', null).then(function (r) {
          if (r && r.ok && r.json) setAutoCfg(r.json.auto || null);
        }).catch(function () {});
      };
      React.useEffect(function () { pull(); pullAuto(); }, []);

      /** 横向条形图(纯 div, 不引图表库) */
      const barsEl = function (title, list, opts) {
        const o = opts || {};
        const arr = (list || []).filter(function (p) { return p && p[0] });
        if (!arr.length) return null;
        const max = Math.max.apply(null, arr.map(function (p) { return Number(p[1]) || 0 })) || 1;
        return h('div', { style: { minWidth: 208, flex: '1 1 240px' } },
          h('div', { className: 'zywb-note', style: { marginBottom: 3 } }, title),
          arr.slice(0, o.top || 8).map(function (p, i) {
            const n = Number(p[1]) || 0, w = Math.max(2, Math.round(n / max * 100));
            return h('div', { key: i, style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2, fontSize: 11.5 } },
              h('span', { style: { width: o.labelW || 88, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: String(p[0]) }, String(p[0])),
              h('span', { style: { flex: 1, background: 'rgba(255,255,255,.07)', borderRadius: 3, height: 12 } },
                h('span', { style: { display: 'block', width: w + '%', height: 12, borderRadius: 3, background: o.color || '#4f8cff' } })),
              h('span', { className: 'zywb-note', style: { width: 34, textAlign: 'right' } }, String(n)));
          }));
      };
      /** 四象限散点: 横=月销(log) 纵=利润率; 颜色按利润率; 点大小=变体数 */
      const scatterEl = function (pts) {
        if (!pts || !pts.length) return h('div', { className: 'zywb-note' }, '没有同时带「月销 + 利润率」的商品, 画不了散点');
        const W = 620, H = 240, L = 44, B = 26, T = 10, R = 10;
        const xs = pts.map(function (p) { return Number(p.sales30d) || 0 });
        const ys = pts.map(function (p) { return Number(p.marginPct) || 0 });
        const xMax = Math.max.apply(null, xs) || 1;
        const yMax = Math.max(0.5, Math.max.apply(null, ys) + 0.05), yMin = Math.min(0, Math.min.apply(null, ys) - 0.05);
        const lx = function (v) { return L + (Math.log10(1 + Math.max(0, v)) / Math.log10(1 + xMax)) * (W - L - R) };
        const ly = function (v) { return T + (1 - (v - yMin) / (yMax - yMin || 1)) * (H - T - B) };
        const med = xs.slice().sort(function (a, b) { return a - b })[Math.floor(xs.length / 2)] || 0;
        const col = function (m) { return m >= 0.3 ? '#5fd08a' : (m >= 0 ? '#f0b253' : '#f28b8b') };
        const kids = [];
        [yMin, 0, (yMin + yMax) / 2, yMax].forEach(function (v, i) {
          kids.push(h('line', { key: 'gy' + i, x1: L, y1: ly(v), x2: W - R, y2: ly(v), stroke: 'rgba(255,255,255,.10)' }));
          kids.push(h('text', { key: 'ty' + i, x: 4, y: ly(v) + 4, fill: '#8b93a3', fontSize: 10 }, Math.round(v * 100) + '%'));
        });
        kids.push(h('line', { key: 'vx', x1: lx(med), y1: T, x2: lx(med), y2: H - B, stroke: 'rgba(255,255,255,.10)', strokeDasharray: '3 3' }));
        pts.forEach(function (p, i) {
          kids.push(h('circle', {
            key: 'c' + i, cx: lx(Number(p.sales30d) || 0), cy: ly(Number(p.marginPct) || 0),
            r: 2.6 + Math.min(5, (Number(p.variantCount) || 0) / 2), fill: col(Number(p.marginPct) || 0), fillOpacity: 0.78,
          }, h('title', null, p.asin + '@' + String(p.site || '').toUpperCase() + ' · 月销 ' + (p.sales30d || 0) +
            ' · 利润率 ' + Math.round((p.marginPct || 0) * 100) + '%' + (p.bearPrice != null ? ' · 承受价 ' + p.bearPrice : '') +
            ' · 变体 ' + (p.variantCount || 0) + (p.cat1 ? ' · ' + p.cat1 : ''))));
        });
        kids.push(h('text', { key: 'ax', x: (L + W - R) / 2, y: H - 4, fill: '#8b93a3', fontSize: 10, textAnchor: 'middle' }, '月销(对数轴) → 越靠右越好卖'));
        return h('div', { style: { overflowX: 'auto' } }, h('svg', { viewBox: '0 0 ' + W + ' ' + H, style: { width: '100%', maxWidth: 760, height: 240 } }, kids));
      };
      const setTagOn = function (key, tg, on) {
        return api('/api/archive/tag', 'POST', { keys: [key], tag: tg, on: on }).then(function () {
          setMsg('✓ ' + (on ? '已标记' : '已取消') + '「' + tg + '」 ' + key);
          return pull();
        }).catch(function (e) { setMsg('✗ ' + ((e && e.message) || e)); });
      };

      /** 导出文件: CSV 带 BOM(Excel 双击直接开), JSON 不带(带 BOM 的 JSON 会被解析器嫌弃) */
      const download = function (filename, text, mime, bom) {
        try {
          const blob = new Blob([(bom === false ? '' : '\ufeff') + text], { type: mime || 'text/plain;charset=utf-8' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          setTimeout(function () { try { document.body.removeChild(a); URL.revokeObjectURL(a.href); } catch (e) {} }, 1500);
          return true;
        } catch (e) { setMsg('✗ 导出失败: ' + ((e && e.message) || e)); return false; }
      };
      const doExport = function (fmt) {
        const url = '/api/archive/export?format=' + fmt + '&dedup=' + (dedup ? '1' : '0') + (curBatch ? '&batchId=' + encodeURIComponent(curBatch) : '');
        setMsg('⏳ 正在导出 ' + fmt.toUpperCase() + '…');
        api(url, 'GET', null).then(function (r) {
          const j = (r && r.json) || {};
          if (!j.total) { setMsg('✗ 归档库还是空的, 先归档再导出'); return; }
          if (fmt === 'json') {
            if (download('选品归档-' + dstr + '.json', JSON.stringify({ exportedAt: new Date().toISOString(), total: j.total, items: j.items }, null, 2), 'application/json', false))
              setMsg('✓ 已导出 ' + j.total + ' 条到 选品归档-' + dstr + '.json');
          } else if (download('选品归档-' + dstr + '.csv', j.csv || '', 'text/csv;charset=utf-8'))
            setMsg('✓ 已导出 ' + j.total + ' 条到 选品归档-' + dstr + '.csv (Excel 可直接打开)');
        }).catch(function (e) { setMsg('✗ ' + ((e && e.message) || e)); });
      };
      const doArchive = function () {
        setBusy(true);
        setMsg('⏳ 正在归档…');
        api('/api/archive/save', 'POST', {
          source: source, name: name, site: site, onlySaved: onlySaved,
          limit: parseInt(limit, 10) || undefined,
        }).then(function (r) {
          const j = (r && r.json) || {};
          if (!j.ok) { setMsg('✗ ' + (j.error || '归档失败')); return; }
          setMsg('✓ 已归档 ' + j.count + ' 个品到「' + j.name + '」'
            + (j.dupCount ? ' · 其中 ' + j.dupCount + ' 个以前归档过' : '')
            + (j.overflow ? ' · 另有 ' + j.overflow + ' 个超出上限未存' : ''));
          return pull();
        }).catch(function (e) { setMsg('✗ ' + ((e && e.message) || e)); })
          .then(function () { setBusy(false); });
      };
      const delBatch = function (b) {
        setModal({
          title: '删除归档批次', rows: ['删除「' + b.name + '」(' + b.count + ' 个品)?', '只删归档, 不动商品库和上架记录。'],
          buttons: [
            { label: '取消', onClick: function () { setModal(null); } },
            { label: '删除', primary: true, onClick: function () {
              setModal(null);
              api('/api/archive/batch/delete', 'POST', { batchId: b.batchId }).then(function () {
                if (curBatch === b.batchId) { setCurBatch(''); return pull({ batchId: '' }); }
                return pull();
              }).catch(function (e) { setMsg('✗ ' + ((e && e.message) || e)); });
            } },
          ],
        });
      };

      const statCard = function (label, val) {
        return h('div', { style: { minWidth: 92 } },
          h('div', { className: 'zywb-lbl' }, label),
          h('div', { style: { fontSize: 18, fontWeight: 700 } }, String(val)));
      };
      const pickBatch = function (id) {
        const next = curBatch === id ? '' : id;
        setCurBatch(next);
        pull({ batchId: next });
      };
      const cell = { padding: '5px 6px', borderBottom: '1px solid #26262c', whiteSpace: 'nowrap' };
      const siteOpts = [].concat.apply([], SITE_GROUPS.map(function (g) { return g.sites.map(function (s) { return { v: s[0], l: s[1] }; }); }));

      return h('div', { style: { padding: 12 } },
        // ── 概览
        h('div', { className: 'zywb-card' },
          h('div', { className: 'zywb-h' }, '📦 选品归档 —— 把最终选出来的品存成模板库'),
          h('div', { className: 'zywb-note' },
            '商品库(10万+)是「采过的池子」, 上架记录是「这轮要上的清单」, 归档库是「我们最终看中的品」—— ',
            '存成快照后不受源数据增删影响, 以后照它找相似的品。可导出 CSV(Excel 直接打开)/JSON, 与网页端 3088 共用同一份数据。'),
          stats ? h('div', { style: { display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 10 } },
            statCard('批次数', stats.batches), statCard('归档条目', stats.items), statCard('去重后唯一品', stats.unique),
            statCard('最近归档', stats.lastArchivedAt ? String(stats.lastArchivedAt).slice(5, 16) : '—'),
            statCard('站点', Object.keys(stats.bySite || {}).join('/') || '—')) : h('div', { className: 'zywb-note' }, '查询中…')),

        // ── 归档表单
        h('div', { className: 'zywb-card' },
          h('div', { className: 'zywb-h' }, '🗄 归档当前商品'),
          h('div', { style: { display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' } },
            h('div', null, h('div', { className: 'zywb-lbl' }, '批次名'),
              h('input', { className: 'zywb-input', style: { width: 230 }, value: name, onChange: function (e) { setName(e.target.value); } })),
            h('div', null, h('div', { className: 'zywb-lbl' }, '来源'),
              h('select', { className: 'zywb-input', style: { width: 240 }, value: source, onChange: function (e) { setSource(e.target.value); } },
                h('option', { value: 'listing' }, '上架记录 (最终要上的, 带承受价)'),
                h('option', { value: 'products' }, '商品库 (全池子)'))),
            h('div', null, h('div', { className: 'zywb-lbl' }, '站点'),
              h('select', { className: 'zywb-input', style: { width: 120 }, value: site, onChange: function (e) { setSite(e.target.value); } },
                h('option', { value: '' }, '全部站点'),
                siteOpts.map(function (s) { return h('option', { key: s.v, value: s.v }, s.l); }))),
            source === 'products' ? h('div', null, h('div', { className: 'zywb-lbl' }, '最多条数'),
              h('input', { className: 'zywb-input', style: { width: 96 }, value: limit, onChange: function (e) { setLimit(e.target.value); } })) : null,
            source === 'products' ? h('button', { className: 'zywb-btn', style: { padding: '5px 10px' }, onClick: function () { setOnlySaved(!onlySaved); } },
              (onlySaved ? '☑' : '☐') + ' 只要我收藏的') : null,
            h('button', { className: 'zywb-btn', style: { background: '#2f6feb', borderColor: '#2f6feb', color: '#fff' }, disabled: busy, onClick: doArchive }, busy ? '归档中…' : '🗄 现在归档')),
          h('div', { className: 'zywb-note', style: { marginTop: 6 } },
            source === 'products'
              ? '⚠ 商品库有 10 万+ 条 —— 直接归档会很大也很慢。建议先用「站点」收窄, 或勾「只要我收藏的」, 最多条数默认 3000。'
              : '上架记录里的品都带承受价/利润率 —— 这是「最终选出来的品」最完整的形态, 建议默认用它。'),
          msg ? h('div', { style: { marginTop: 8, fontSize: 12.5 } }, msg) : null),

        // ── 批次列表
        h('div', { className: 'zywb-card' },
          h('div', { className: 'zywb-h' }, '📚 归档批次',
            h('button', { className: 'zywb-btn', style: { float: 'right', padding: '2px 8px', fontSize: 11.5 }, onClick: function () { pull(); } }, '刷新')),
          batches.length
            ? h('div', { style: { maxHeight: 260, overflow: 'auto' } },
                h('table', { className: 'zywb-table', style: { minWidth: 760 } },
                  h('thead', null, h('tr', null,
                    ['归档时间', '批次名', '来源', '条数', '其中重复', '站点', '操作'].map(function (t, i) { return h('th', { key: i }, t); }))),
                  h('tbody', null, batches.map(function (b, i) {
                    return h('tr', { key: i },
                      h('td', { style: cell }, String(b.createdAt || '').slice(0, 16)),
                      h('td', { style: Object.assign({}, cell, { whiteSpace: 'normal', maxWidth: 260 }) }, b.name),
                      h('td', { style: cell }, b.source === 'products' ? '商品库' : '上架记录'),
                      h('td', { style: cell }, h('b', null, String(b.count))),
                      h('td', { style: cell }, String(b.dupCount || 0)),
                      h('td', { style: cell }, Object.keys(b.bySite || {}).join('/')),
                      h('td', { style: cell },
                        h('button', { className: 'zywb-btn', style: { padding: '2px 8px', fontSize: 11.5, marginRight: 4 }, onClick: function () { pickBatch(b.batchId); } },
                          curBatch === b.batchId ? '取消只看' : '只看这批'),
                        h('button', { className: 'zywb-btn', style: { padding: '2px 8px', fontSize: 11.5, marginRight: 4 }, onClick: function () {
                          const bn = String(b.name || '选品归档').replace(/[\\/:*?"<>|]/g, '_');
                          api('/api/archive/export?format=csv&dedup=0&batchId=' + encodeURIComponent(b.batchId), 'GET', null).then(function (r) {
                            const j = (r && r.json) || {};
                            if (download(bn + '.csv', j.csv || '', 'text/csv;charset=utf-8')) setMsg('✓ 已导出这批 ' + j.total + ' 条 → ' + bn + '.csv');
                          }).catch(function (e) { setMsg('✗ ' + ((e && e.message) || e)); });
                        } }, '导这批'),
                        h('button', { className: 'zywb-btn', style: { padding: '2px 8px', fontSize: 11.5 }, onClick: function () { delBatch(b); } }, '删')));
                  }))))
            : h('div', { className: 'zywb-note' }, '还没有归档 —— 上面点「🗄 现在归档」把当前选出来的品存一份')),

        // ── 归档商品
        h('div', { className: 'zywb-card' },
          h('div', { className: 'zywb-h' }, '🔍 归档商品',
            h('span', { style: { float: 'right', display: 'inline-flex', gap: 6, alignItems: 'center' } },
              h('input', {
                className: 'zywb-input', style: { width: 190 }, placeholder: 'ASIN / 标题 / 品牌 / 类目', value: q,
                onChange: function (e) { setQ(e.target.value); },
                onKeyDown: function (e) { if (e.key === 'Enter') { const v = e.target.value; setQ(v); pull({ q: v }); } },
              }),
              h('button', { className: 'zywb-pill' + (dedup ? ' on' : ''), onClick: function () { const d = !dedup; setDedup(d); pull({ dedup: d ? '1' : '0' }); } },
                dedup ? '去重 (按 ASIN@站点)' : '含重复 (全部批次)'),
              h('button', { className: 'zywb-btn', style: { padding: '2px 8px', fontSize: 11.5 }, onClick: function () { pull(); } }, '搜索'),
              h('button', { className: 'zywb-btn', style: { padding: '2px 8px', fontSize: 11.5 }, onClick: function () { doExport('csv'); } }, '⤓ CSV'),
              h('button', { className: 'zywb-btn', style: { padding: '2px 8px', fontSize: 11.5 }, onClick: function () { doExport('json'); } }, '⤓ JSON'))),
          /* ★ 区间/类目/标签筛选(与网页端同一套接口参数) */
          h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 8 } },
            h('div', null, h('div', { className: 'zywb-lbl' }, '类目'),
              h('select', { className: 'zywb-input', style: { width: 148 }, value: cat1,
                onChange: function (e) { setCat1(e.target.value); pull({ cat1: e.target.value }); } },
                h('option', { value: '' }, '全部类目'),
                catOpts.map(function (c) { return h('option', { key: c, value: c }, c); }))),
            [['利润 ≥', marginMin, setMarginMin, 'marginMin', '0.3'], ['月销 ≥', salesMin, setSalesMin, 'salesMin', '300'],
             ['排名 ≤', rankMax, setRankMax, 'rankMax', '50000'], ['价格 min', priceMin, setPriceMin, 'priceMin', ''],
             ['价格 max', priceMax, setPriceMax, 'priceMax', '']].map(function (f) {
              return h('div', { key: f[3] }, h('div', { className: 'zywb-lbl' }, f[0]),
                h('input', { className: 'zywb-input', style: { width: 78 }, value: f[1], placeholder: f[4],
                  onChange: function (e) { f[2](e.target.value); },
                  onKeyDown: function (e) { if (e.key === 'Enter') { const o = {}; o[f[3]] = e.target.value; pull(o) } } }));
            }),
            h('div', null, h('div', { className: 'zywb-lbl' }, '标签'),
              h('select', { className: 'zywb-input', style: { width: 104 }, value: tag,
                onChange: function (e) { setTag(e.target.value); pull({ tag: e.target.value }); } },
                h('option', { value: '' }, '全部标签'),
                TAGS.map(function (t) { return h('option', { key: t, value: t }, t); }))),
            h('button', { className: 'zywb-btn', style: { padding: '5px 10px' }, onClick: function () { pull(); } }, '应用筛选'),
            h('button', { className: 'zywb-btn', style: { padding: '5px 10px' }, onClick: function () {
              setCat1(''); setTag(''); setMarginMin(''); setSalesMin(''); setRankMax(''); setPriceMin(''); setPriceMax(''); setQ('');
              pull({ cat1: '', tag: '', marginMin: '', salesMin: '', rankMax: '', priceMin: '', priceMax: '', q: '' });
            } }, '重置'),
            h('span', { className: 'zywb-note' }, (function () {
              const parts = [];
              if (cat1) parts.push('类目=' + cat1);
              if (marginMin) parts.push('利润≥' + marginMin);
              if (salesMin) parts.push('月销≥' + salesMin);
              if (rankMax) parts.push('排名≤' + rankMax);
              if (priceMin || priceMax) parts.push('价格 ' + (priceMin || '0') + '~' + (priceMax || '∞'));
              if (tag) parts.push('标签=' + tag);
              if (q) parts.push('搜索=' + q);
              return parts.length ? ('当前筛选: ' + parts.join(' · ')) : '未加筛选';
            })())),
          rows.length
            ? h('div', { style: { maxHeight: 520, overflow: 'auto' } },
                h('table', { className: 'zywb-table' },
                  h('thead', null, h('tr', null,
                    ['站点', 'ASIN', '品牌', '标题', '售价', '承受价', '利润率', '月销', '大排名', '变体', '标签', '状态', '归档时间', '链接'].map(function (t, i) { return h('th', { key: i }, t); }))),
                  h('tbody', null, rows.map(function (it, i) {
                    return h('tr', { key: i },
                      h('td', { style: cell }, String(it.site || '').toUpperCase()),
                      h('td', { style: cell }, h('b', null, it.asin),
                        it.dup ? h('span', { className: 'zywb-note', style: { marginLeft: 4 }, title: '以前也归档过 ' + (it.firstArchivedAt || '') }, '重') : null),
                      h('td', { style: cell }, it.brand || ''),
                      h('td', { style: Object.assign({}, cell, { whiteSpace: 'normal', maxWidth: 260 }) }, String(it.title || '').slice(0, 60)),
                      h('td', { style: cell }, it.price != null ? fmtMoney(it.price, it.currency) : ''),
                      h('td', { style: cell }, it.bearPrice != null ? h('b', null, fmtMoney(it.bearPrice, it.currency)) : '—'),
                      h('td', { style: cell }, it.marginPct != null ? (Math.round(it.marginPct * 1000) / 10) + '%' : (it.bearMargin != null ? '设定 ' + Math.round(it.bearMargin * 100) + '%' : '—')),
                      h('td', { style: cell }, it.sales30d != null ? String(it.sales30d) : ''),
                      h('td', { style: cell }, it.bsrShop != null ? '#' + it.bsrShop : ''),
                      h('td', { style: cell }, it.variantCount ? String(it.variantCount) + ((it.variantDims || []).length ? ' (' + it.variantDims.join('×') + ')' : '') : '—'),
                      /* ★ 行内标签: 4 个可点胶囊, 点一下即打上/取消(直接落库), 标签按 asin@site 存, 重新归档不丢 */
                      h('td', { style: Object.assign({}, cell, { whiteSpace: 'nowrap' }) }, TAGS.map(function (tg) {
                        const on = (it.tags || []).indexOf(tg) >= 0;
                        const key = it.key || (it.asin + '@' + it.site);
                        return h('span', {
                          key: tg, title: on ? ('点一下取消「' + tg + '」') : ('点一下标记为「' + tg + '」'),
                          onClick: function () { setTagOn(key, tg, !on); },
                          style: { cursor: 'pointer', fontSize: 11, padding: '0 5px', borderRadius: 9, marginRight: 3,
                            border: '1px solid ' + (on ? '#4f8cff' : 'rgba(255,255,255,.18)'),
                            background: on ? 'rgba(79,140,255,.22)' : 'transparent', color: on ? '#cfe0ff' : '#8b93a3' },
                        }, tg);
                      })),
                      h('td', { style: cell }, it.status === 'listed' ? '已上架' : it.status === 'saved' ? '收藏' : it.status === 'pool' ? '池子' : it.status === 'failed' ? '失败' : '待上架'),
                      h('td', { style: cell }, String(it.archivedAt || '').slice(5, 16)),
                      h('td', { style: cell }, it.url ? h('a', { className: 'zywb-lnk', href: it.url, target: '_blank', rel: 'noopener' }, '打开') : ''));
                  }))))
            : h('div', { className: 'zywb-note' }, curBatch ? '这批没有匹配的商品 —— 再点一次「取消只看」回到全部' : '归档库还是空的, 先在上面归档'),
          h('div', { className: 'zywb-note', style: { marginTop: 6 } },
            '命中 ' + rowTotal + ' 条' + (rowTotal > rows.length ? ' (只显示前 ' + rows.length + ' 条, 导出是全部)' : '') + (curBatch ? ' · 只看批次 ' + curBatch : '')),

          /* ★ 自动归档(每日快照): 与上次完全一样时会跳过, 不产生空批次 */
          h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 10, paddingTop: 8, borderTop: '1px solid #2a2a2f' } },
            h('span', { className: 'zywb-note' }, '自动归档:'),
            h('label', { style: { display: 'inline-flex', gap: 5, alignItems: 'center', cursor: 'pointer', fontSize: 12 },
              title: '每天到点自动把「当前上架记录」快照一批 —— 与上次完全一样时会跳过' },
              h('input', { type: 'checkbox', checked: !!(autoCfg && autoCfg.enabled),
                onChange: function (e) {
                  const on = e.target.checked;
                  api('/api/archive/auto', 'POST', { enabled: on }).then(function () { pullAuto(); if (on) setMsg('✓ 已开启每日自动归档'); }).catch(function (er) { setMsg('✗ ' + ((er && er.message) || er)); });
                } }),
              '每天自动存一次'),
            h('select', { className: 'zywb-input', style: { width: 84 }, value: String(autoCfg && autoCfg.hour != null ? autoCfg.hour : 3),
              onChange: function (e) {
                const hr = parseInt(e.target.value, 10);
                api('/api/archive/auto', 'POST', { hour: hr }).then(function () { pullAuto(); setMsg('✓ 自动归档时间改为 ' + hr + ':00'); }).catch(function () {});
              } },
              Array.from({ length: 24 }, function (_, i) { return h('option', { key: i, value: String(i) }, (i < 10 ? '0' + i : i) + ':00'); })),
            h('button', { className: 'zywb-btn', style: { padding: '2px 8px', fontSize: 11.5 }, title: '不等定时, 现在就快照一批(内容没变会自动跳过)',
              onClick: function () {
                setMsg('⏳ 正在归档…');
                api('/api/archive/auto/run', 'POST', {}).then(function (r) {
                  const j = (r && r.json) || {};
                  setMsg(j.created ? ('✓ 已存「' + j.name + '」 ' + j.count + ' 条' + (j.dupCount ? ' (其中重复 ' + j.dupCount + ')' : '')) : ('[--] ' + (j.reason || '没有新东西要存')));
                  return pull(); }).then(function () { return pullAuto(); }).catch(function (er) { setMsg('✗ ' + ((er && er.message) || er)); });
              } }, '立即归档一次'),
            h('span', { className: 'zywb-note' }, autoCfg && autoCfg.lastRunAt ? ('上次运行 ' + String(autoCfg.lastRunAt).slice(5, 16)) : '还没跑过'))),

        /* ── 📊 分布(可视化) —— 用户要求「优先展示功能模块」, 所以把看板挪到最下面:
         *    上面是干活的地方(归档/批次/筛选商品), 下面才是"看看这批品长什么样"的分析。
         *    它是纯只读视图, 挪位置不影响任何接口; 只是右上角那句"与下面列表同一筛选"现在得改成"上面"。 */
        h('div', { className: 'zywb-card' },
          h('div', { className: 'zywb-h' }, '📊 分布 (看这批归档长什么样)',
            h('span', { className: 'zywb-note', style: { float: 'right' } },
              dist ? ('命中 ' + dist.total + ' 条' + (dedup ? ' (去重后)' : '') + ' · 与上面列表同一筛选') : '查询中…')),
          dist ? h('div', null,
            h('div', { style: { display: 'flex', gap: 14, flexWrap: 'wrap' } },
              barsEl('一级类目 (哪个类最多)', dist.byCategory1),
              barsEl('品牌 Top', dist.byBrand, { color: '#8a6dff' }),
              barsEl('站点', dist.bySite, { color: '#5fd08a', labelW: 56 }),
              barsEl('配送方式', dist.byFulfill, { color: '#e0b25c', labelW: 56 })),
            h('div', { style: { display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 8 } },
              barsEl('售价带 (站点本币)', pairs(dist.priceBuckets), { labelW: 60 }),
              barsEl('利润率', pairs(dist.marginBuckets), { color: '#5fd08a', labelW: 60 }),
              barsEl('月销', pairs(dist.salesBuckets), { color: '#e0b25c', labelW: 60 }),
              barsEl('大排名', pairs(dist.rankBuckets), { color: '#f28b8b', labelW: 60 }),
              barsEl('变体数', pairs(dist.variantBuckets), { color: '#8ab4ff', labelW: 60 })),
            h('div', { style: { marginTop: 10 } },
              h('div', { className: 'zywb-note', style: { marginBottom: 3 } }, '月销 × 利润率（找又高销又高利的品）'),
              scatterEl(dist.scatter),
              h('div', { className: 'zywb-note', style: { marginTop: 3 } }, '绿=达标利润率 · 琥珀=低于目标 · 红=亏 · 点越大变体越多（悬停看 ASIN）')),
            (dist.byCategoryDetail || []).length ? h('div', { style: { marginTop: 10 } },
              h('div', { className: 'zywb-note', style: { marginBottom: 3 } }, '类目明细: 哪类又赚又好卖'),
              h('div', { style: { maxHeight: 190, overflow: 'auto' } },
                h('table', { className: 'zywb-table', style: { minWidth: 520 } },
                  h('thead', null, h('tr', null, ['一级类目', '数量', '平均利润率', '平均月销', '平均承受价'].map(function (t, i) { return h('th', { key: i }, t); }))),
                  h('tbody', null, dist.byCategoryDetail.map(function (c, i) {
                    return h('tr', { key: i },
                      h('td', null, c.cat), h('td', null, String(c.n)),
                      h('td', null, c.marginAvg != null ? (Math.round(c.marginAvg * 1000) / 10) + '%' : '—'),
                      h('td', null, c.salesAvg != null ? String(c.salesAvg) : '—'),
                      h('td', null, c.bearAvg != null ? String(c.bearAvg) : '—'));
                  }))))) : null,
            /* 批次趋势: 与网页端一致(不受筛选影响, 看"归档这件事有没有在持续") */
            (dist.batchSeries || []).length ? h('div', { style: { marginTop: 10 } },
              barsEl('批次趋势: 每批存了多少 (看归档有没有在持续)', (dist.batchSeries || []).map(function (b) {
                return [String(b.createdAt || '').slice(5, 16) + ' ' + String(b.name || '').slice(0, 12), b.count];
              }), { color: '#8a6dff', labelW: 118, top: 12 })) : null)
            : h('div', { className: 'zywb-note' }, '查询中…')),

        modal ? h(Modal, { title: modal.title, rows: modal.rows, buttons: modal.buttons, onClose: function () { setModal(null); } }) : null);
    }

    /* ===== 「知产查重」页 (上架风控) =====
     * 目的: 上架前先查"这个品牌名 / 这个外观有没有被人注册过", 避免侵权下架。
     *
     * ★★ 核心业务口径(用户明确要求) —— 按站点判定, 不是全球判定 ★★
     *   我上德国站, 就只看"在德国有效的商标"; 上英国站就该只看"在英国有效的商标"。
     *   别的国家有商标 ≠ 我不能上这个站。所以页面第一步是选目标站点, 不是填关键词。
     *
     *   这里最容易被搞错的三层权利范围(后端 ip-check.js 已按此实现):
     *     · 单一国家商标: DE 只保护德国、GB 只保护英国
     *     · 区域商标:     EM 欧盟商标一次性覆盖 27 个成员国 —— 德国站必须连 EUIPO 一起查
     *     · 国际注册:     WO 保护范围=指定国清单, 指定了 DE 才算, 只指定 AU/US 就跟德国无关
     *     · 英国脱欧:     欧盟商标不再覆盖英国 —— 英国站只查 GB, 不能把 EM 算进去
     *
     * 数据全部来自官方库直连(不走浏览器):
     *   ✅ TMview 全球商标库  —— 全球聚合, 带"保护范围"字段, 按站判定的主力
     *   ✅ USPTO 美国商标     —— 只在选美国站时才查
     *   ✅ EUIPO 欧盟商标     —— 只在目标国是欧盟成员国时才查
     *   ✅ EUIPO 共同体外观设计 —— 同上(英国站会自动跳过)
     *   ⚠️ WIPO 品牌库/外观库、中国商标网 —— 有验证码/风控, 需要浏览器自动化, 暂未接入
     */
    const IP_LEVEL_COLOR = { high: '#ff6b6b', medium: '#f0b253', low: '#5fd08a', none: '#5fd08a', unknown: '#9a9a9a' };
    const IP_LEVEL_ICON = { high: '❌', medium: '⚠️', low: '✅', none: '✅', unknown: '❓' };
    const IP_ST_CN = { alive: '有效', pending: '审查中', dead: '已失效', unknown: '未知' };
    const IP_ST_COLOR = { alive: '#ff6b6b', pending: '#f0b253', dead: '#7a7a7a', unknown: '#9a9a9a' };
    const IP_KIND_CN = { trademark: '商标', design: '外观设计' };
    const IP_STATUS_CN = { registered: '已被他人注册', notfound: '未查到', unchecked: '待确认' };
    /* 尼斯分类高频项(亚马逊卖家常卖的) —— 下拉里给个提示, 也可以手填数字 */
    const IP_NICE_HINT = [
      [9, '电子产品/软件'], [11, '灯具/厨电/空调'], [14, '珠宝钟表'], [18, '箱包/皮具'], [20, '家具/相框'],
      [21, '家用器具/清洁'], [24, '纺织品/床上用品'], [25, '服装/鞋'], [28, '玩具/健身器材'], [3, '化妆品/洗护'],
      [5, '保健品/药品'], [8, '手工具/刀具'], [16, '文具/纸品'], [30, '咖啡茶/调味品'], [35, '广告/电商服务'],
    ];
    const IP_LOCARNO_HINT = [
      ['07-01', '炊具/餐具'], ['14-01', '影音设备'], ['14-02', '电脑周边'], ['14-03', '通讯设备'],
      ['26-05', '灯具'], ['02-04', '鞋'], ['23-04', '空调/加湿'], ['13-03', '电动工具'],
    ];
    /* 常用站点置顶(其余收起, 免得一屏全是按钮) */
    const IP_SITE_TOP = ['amazon.de', 'amazon.co.uk', 'amazon.com', 'amazon.fr', 'amazon.it', 'amazon.es', 'amazon.co.jp', 'amazon.ca'];

    function IpPage(props) {
      const api = props.api;
      const [prov, setProv] = React.useState(null);
      const [sites, setSites] = React.useState(['amazon.de']);   // ★ 目标站点(可多选, 取并集)
      const [moreSites, setMoreSites] = React.useState(false);
      const [q, setQ] = React.useState('');
      const [src, setSrc] = React.useState(['tmview', 'uspto', 'euipo-tm', 'euipo-rcd']);
      const [nice, setNice] = React.useState('');
      const [loc, setLoc] = React.useState('');
      const [limit, setLimit] = React.useState('30');
      const [busy, setBusy] = React.useState(false);
      const [err, setErr] = React.useState('');
      const [res, setRes] = React.useState(null);
      const [open, setOpen] = React.useState({});          // 明细折叠
      const [showOther, setShowOther] = React.useState(false);   // 是否展开"只在别国有效"的记录
      const [ov, setOv] = React.useState(null);            // 商品库总览
      const [batch, setBatch] = React.useState(null);
      const [bMsg, setBMsg] = React.useState('');

      const loadOv = function () {
        api('/api/ip/overview', 'GET', null).then(function (r) { if (r && r.ok && r.json) setOv(r.json); }).catch(function () { });
      };
      React.useEffect(function () {
        api('/api/ip/providers', 'GET', null).then(function (r) {
          if (r && r.ok && r.json) {
            setProv(r.json);
            const ready = (r.json.providers || []).filter(function (p) { return p.ready; }).map(function (p) { return p.id; });
            if (ready.length) setSrc(ready);
          }
        }).catch(function (e) { setErr('加载数据源失败: ' + e.message); });
        loadOv();
      }, []);

      /* 批量查重: 后台跑, 这里轮询进度 */
      React.useEffect(function () {
        api('/api/ip/batch', 'GET', null).then(function (r) { if (r && r.ok && r.json && r.json.total) setBatch(r.json); }).catch(function () { });
      }, []);
      React.useEffect(function () {
        if (!batch || !batch.running) return;
        const t = setInterval(function () {
          api('/api/ip/batch', 'GET', null).then(function (r) {
            if (r && r.ok && r.json) { setBatch(r.json); if (!r.json.running) loadOv(); }
          }).catch(function () { });
        }, 2500);
        return function () { clearInterval(t); };
      }, [batch && batch.running]);

      const toggle = function (arr, setArr, v) {
        setArr(arr.indexOf(v) >= 0 ? arr.filter(function (x) { return x !== v; }) : arr.concat([v]));
      };
      const doSearch = function () {
        const term = q.trim();
        if (!term) { setErr('先输入要查的品牌名或关键词'); return; }
        if (!sites.length) { setErr('先选目标站点 —— 决定只看哪个国家的商标'); return; }
        if (!src.length) { setErr('至少选一个数据源'); return; }
        setBusy(true); setErr(''); setRes(null); setShowOther(false);
        api('/api/ip/search', 'POST', {
          q: term, sites: sites, sources: src,
          nice: nice.trim(), locarno: loc.trim(),
          limit: parseInt(limit, 10) || 30,
        }).then(function (r) { if (r && r.ok) setRes(r.json); else setErr((r && r.error) || '查询失败'); })
          .catch(function (e) { setErr('查询失败: ' + e.message); })
          .then(function () { setBusy(false); });
      };
      const startBatch = function (opt) {
        if (!sites.length) { setBMsg('先选目标站点'); return; }
        setBMsg('正在启动…');
        api('/api/ip/batch', 'POST', Object.assign({ sites: sites, sources: ['tmview'], field: 'brand', apply: true, limit: opt.limit || 30 }, opt))
          .then(function (r) {
            if (r && r.ok) {
              setBMsg('已启动: ' + (r.json.market ? r.json.market.name + ' · ' : '') + '共 ' + r.json.total + ' 个关键词, 后台跑, 可以关掉这个页面');
              setBatch(r.json.batch || { running: true, total: r.json.total, done: 0, progress: 0 });
            } else setBMsg('启动失败: ' + ((r && r.error) || '未知'));
          }).catch(function (e) { setBMsg('启动失败: ' + e.message); });
      };

      if (!prov) return h('div', { className: 'zywb-card' }, h('div', { className: 'zywb-note' }, err || '加载数据源中…'));

      const providers = prov.providers || [];
      const allSites = prov.sites || [];
      const siteMap = {};
      allSites.forEach(function (s) { siteMap[s.id] = s; });
      const srcState = (res && res.sources) || [];
      const skipped = (res && res.skipped) || [];

      /* ---- 目标站点选择器 ---- */
      const siteBtn = function (s) {
        const on = sites.indexOf(s.id) >= 0;
        return h('button', {
          key: s.id, className: 'zywb-pill' + (on ? ' on' : ''),
          title: s.name + ' → 只看在 ' + (s.requires || []).join('/') + ' 有效的商标',
          style: { marginRight: 6, marginTop: 5, borderColor: on ? '#4f8cff' : '#3a3a44', background: on ? 'rgba(79,140,255,.18)' : 'transparent', fontWeight: on ? 600 : 400 },
          onClick: function () { toggle(sites, setSites, s.id); },
        }, s.flag + ' ' + s.name);
      };
      const topSites = IP_SITE_TOP.filter(function (id) { return siteMap[id]; }).map(function (id) { return siteMap[id]; }).concat(
        sites.filter(function (id) { return IP_SITE_TOP.indexOf(id) < 0 && siteMap[id]; }).map(function (id) { return siteMap[id]; }));
      const restSites = allSites.filter(function (s) { return IP_SITE_TOP.indexOf(s.id) < 0 && sites.indexOf(s.id) < 0; });

      /* 当前选择对应的检索口径提示 */
      const reqSet = (function () {
        const r = [];
        sites.forEach(function (id) { (siteMap[id] ? siteMap[id].requires : []).forEach(function (c) { if (r.indexOf(c) < 0) r.push(c); }); });
        return r;
      })();
      const offSet = (function () {
        const o = [];
        sites.forEach(function (id) { (siteMap[id] ? siteMap[id].offices : []).forEach(function (c) { if (o.indexOf(c) < 0) o.push(c); }); });
        return o;
      })();

      const topCard = h('div', { className: 'zywb-card' },
        h('div', { className: 'zywb-h' }, '⚖️ 知识产权查重 (按站点判定)'),
        h('div', { className: 'zywb-note' }, '先选你要上架的站点 —— 只查那个站所在国家/地区有效的商标。别的国家有商标不影响你上这个站。数据直连官方接口，不用开浏览器、不用 API Key。'),

        h('div', { style: { marginTop: 10 } },
          h('div', { className: 'zywb-note', style: { marginBottom: 2, color: '#8ab4ff' } }, '① 目标站点 (可多选，取并集)'),
          h('div', null, topSites.map(siteBtn)),
          restSites.length ? h('div', { style: { marginTop: 4 } },
            h('button', { className: 'zywb-btn', style: { fontSize: 11, padding: '2px 8px' }, onClick: function () { setMoreSites(!moreSites); } },
              moreSites ? '收起其他站点 ▲' : '更多站点 (' + restSites.length + ') ▼'),
            moreSites ? h('div', { style: { marginTop: 4 } }, restSites.map(siteBtn)) : null) : null,
          sites.length ? h('div', { className: 'zywb-note', style: { marginTop: 5, fontSize: 11.5 } },
            h('div', null, '只看在 ' + reqSet.join(' / ') + ' 有效的商标' +
              (offSet.indexOf('EM') >= 0 ? ' —— 含欧盟商标（它一次覆盖全部 27 个成员国）' : '') +
              (offSet.indexOf('EM') < 0 && offSet.indexOf('GB') >= 0 ? ' —— 欧盟商标不覆盖英国，已排除' : '')),
            h('div', { style: { opacity: .85 } }, '各站检索的注册局: ' + sites.map(function (id) {
              const s = siteMap[id];
              return s.flag + s.name + '=' + (s.offices || []).join('/');
            }).join('  ·  '))) : null),

        h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 12 } },
          h('div', null, h('div', { className: 'zywb-note', style: { color: '#8ab4ff' } }, '② 品牌名 / 关键词'),
            h('input', { className: 'zywb-input', style: { width: 260 }, value: q, placeholder: '例: air fryer / CPARTS / 折叠水壶', onChange: function (e) { setQ(e.target.value); }, onKeyDown: function (e) { if (e.key === 'Enter') doSearch(); } })),
          h('div', null, h('div', { className: 'zywb-note' }, '尼斯分类 (可选)'),
            h('input', { className: 'zywb-input', style: { width: 110 }, value: nice, placeholder: '如 11 或 9,25', onChange: function (e) { setNice(e.target.value); } })),
          h('div', null, h('div', { className: 'zywb-note' }, '洛迦诺分类 (外观, 可选)'),
            h('input', { className: 'zywb-input', style: { width: 120 }, value: loc, placeholder: '如 07-01', onChange: function (e) { setLoc(e.target.value); } })),
          h('div', null, h('div', { className: 'zywb-note' }, '每源条数'),
            h('input', { className: 'zywb-input', style: { width: 68 }, value: limit, onChange: function (e) { setLimit(e.target.value); } })),
          h('button', { className: 'zywb-btn', style: { background: '#2f6feb', borderColor: '#2f6feb', color: '#fff', padding: '7px 18px' }, disabled: busy, onClick: doSearch }, busy ? '⏳ 查询中…' : '🔍 查这个站有没有商标')),

        h('div', { style: { marginTop: 10 } },
          h('div', { className: 'zywb-note' }, '数据源 (会按站点自动跳过无关的): ',
            providers.map(function (p) {
              const on = src.indexOf(p.id) >= 0;
              return h('button', {
                key: p.id, className: 'zywb-pill' + (on ? ' on' : ''), title: p.note,
                style: { marginRight: 6, marginTop: 4, opacity: p.ready ? 1 : .55, borderColor: on ? '#4f8cff' : '#3a3a44' },
                onClick: function () { if (p.ready) toggle(src, setSrc, p.id); },
              }, (p.ready ? '✅ ' : '⚠️ ') + p.name + ' · ' + p.scope);
            }))),

        h('div', { className: 'zywb-note', style: { marginTop: 8, fontSize: 11.5, opacity: .85 } },
          '尼斯参考: ' + IP_NICE_HINT.map(function (x) { return x[0] + '=' + x[1]; }).join(' · ')),
        h('div', { className: 'zywb-note', style: { fontSize: 11.5, opacity: .85 } },
          '洛迦诺参考: ' + IP_LOCARNO_HINT.map(function (x) { return x[0] + '=' + x[1]; }).join(' · ')));

      /* ---------- 查重结论 ---------- */
      const conclusion = res ? (function () {
        const rk = res.risk || {};
        const col = IP_LEVEL_COLOR[rk.level] || '#9a9a9a';
        return h('div', { className: 'zywb-card', style: { borderColor: col, borderWidth: 1.5 } },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
            h('div', { className: 'zywb-h', style: { color: col, fontSize: 15, margin: 0 } }, (IP_LEVEL_ICON[rk.level] || '') + ' ' + (rk.advice || '')),
            res.market ? h('span', { className: 'zywb-pill', style: { borderColor: '#4f8cff', color: '#8ab4ff' } }, '目标: ' + res.market.name) : null,
            h('span', { className: 'zywb-pill', style: { borderColor: col, color: col } }, '风险分 ' + rk.score),
            h('span', { className: 'zywb-pill' }, '查询词: ' + res.term),
            h('span', { className: 'zywb-pill' }, '耗时 ' + res.tookMs + 'ms'),
            h('span', { className: 'zywb-pill' }, '本市场命中 ' + ((rk.counts && rk.counts.scoped) || 0))),
          res.market ? h('div', { className: 'zywb-note', style: { marginTop: 6, fontSize: 11.5, color: '#8ab4ff' } }, '检索范围: ' + (res.market.offices || []).map(function (c) { return c; }).join(' / ') + ' · ' + res.market.label) : null,
          h('div', { style: { display: 'flex', gap: 16, marginTop: 8, flexWrap: 'wrap' } },
            h('div', null, h('span', { className: 'zywb-note' }, '商标风险: '),
              h('b', { style: { color: IP_LEVEL_COLOR[rk.trademark && rk.trademark.level] || '#9a9a9a' } }, (rk.trademark && rk.trademark.level) || '-'),
              h('span', { className: 'zywb-note' }, '  (本市场有效 ' + ((rk.trademark && rk.trademark.alive) || 0) + ' / 同名有效 ' + ((rk.trademark && rk.trademark.exactAlive) || 0) + ')')),
            h('div', null, h('span', { className: 'zywb-note' }, '外观风险: '),
              h('b', { style: { color: IP_LEVEL_COLOR[rk.design && rk.design.level] || '#9a9a9a' } }, (rk.design && rk.design.level) || '-'),
              h('span', { className: 'zywb-note' }, '  (本市场有效 ' + ((rk.design && rk.design.alive) || 0) + ')')),
            (rk.counts && rk.counts.otherMarkets) ? h('div', null, h('span', { className: 'zywb-note' }, '别国记录 ' + rk.counts.otherMarkets + ' 条 (不影响)')) : null),
          h('div', { style: { marginTop: 8 } }, (rk.reasons || []).map(function (t, i) { return h('div', { key: i, className: 'zywb-note' }, '· ' + t); })),
          /* 数据源落地状态 */
          h('div', { className: 'zywb-note', style: { marginTop: 8, fontSize: 11.5 } },
            '已查: ' + srcState.map(function (s) {
              return (s.ok ? '✅ ' : '❌ ') + s.sourceName + '=' + (s.ok ? (s.returned + '/' + s.total + (s.cached ? '(缓存)' : '')) : (s.error || '失败'));
            }).join('   ')),
          skipped.length ? h('div', { className: 'zywb-note', style: { fontSize: 11.5, opacity: .75 } },
            '已跳过: ' + skipped.map(function (s) { return s.sourceName; }).join(' / ') + ' —— 与所选站点无关，查了也是白查。') : null,
          h('div', { style: { marginTop: 8 } },
            h('button', { className: 'zywb-btn', onClick: function () { setOpen({}); } }, '折叠全部'),
            h('button', { className: 'zywb-btn', style: { marginLeft: 6 }, onClick: function () { const o = {}; (res.items || []).forEach(function (it, i) { if (it.inMarket) o[i] = true; }); setOpen(o); } }, '展开本市场命中')));
      })() : null;

      /* ---------- 命中明细 ---------- */
      const mkRow = function (it, i) {
        const isOpen = !!open[i];
        const stc = IP_ST_COLOR[it.statusGroup] || '#9a9a9a';
        return h('div', { key: i, style: { borderTop: i ? '1px solid var(--dsw-alias-border-l2,#2a2a2f)' : 'none', padding: '7px 0', opacity: it.inMarket ? 1 : .45 } },
          h('div', { style: { display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', cursor: 'pointer' }, onClick: function () { const o = Object.assign({}, open); o[i] = !o[i]; setOpen(o); } },
            h('span', { title: it.inMarket ? '在你选的站点有效' : '只在别的市场有效', style: { color: it.inMarket ? '#ff6b6b' : '#666', fontWeight: 700 } }, it.inMarket ? '★' : '○'),
            h('span', { className: 'zywb-pill', style: { borderColor: stc, color: stc, minWidth: 52, textAlign: 'center' } }, IP_ST_CN[it.statusGroup] || '?'),
            h('span', { className: 'zywb-pill' }, IP_KIND_CN[it.kind] || '商标'),
            h('span', { className: 'zywb-pill', title: '注册局: ' + it.office + ' · 保护范围: ' + (it.protection || []).join(',') }, it.officeName || it.office),
            h('b', { style: { fontSize: 12.5, color: it.statusGroup === 'alive' ? '#ff9d9d' : '#ddd' } }, it.title || '(无名称)'),
            h('span', { className: 'zywb-note', style: { fontSize: 11.5 } }, it.owner || ''),
            h('span', { className: 'zywb-note', style: { fontSize: 11.5 } }, it.nice && it.nice.length ? '尼斯 ' + it.nice.join(',') : (it.locarno ? '洛迦诺 ' + it.locarno : '')),
            h('span', { className: 'zywb-note', style: { fontSize: 11.5 } }, it.filed ? '申请 ' + it.filed : ''),
            it.id ? h('span', { className: 'zywb-note', style: { fontSize: 11.5, fontFamily: 'monospace' } }, it.id) : null,
            h('span', { className: 'zywb-note', style: { marginLeft: 'auto', fontSize: 11 } }, isOpen ? '收起 ▲' : '详情 ▼')),
          isOpen ? h('div', { style: { margin: '6px 0 2px 60px' } },
            h('div', { className: 'zywb-note' }, '注册局: ' + (it.officeName || it.office) + ' (' + it.office + ')'),
            h('div', { className: 'zywb-note' }, '保护范围: ' + ((it.protection || []).length ? it.protection.join(', ') : '未知')),
            h('div', { className: 'zywb-note', style: { color: it.inMarket ? '#ff9d9d' : '#8a8a8a' } },
              it.inMarket ? '→ 该注册覆盖你选的站点，构成风险' : '→ 该注册不覆盖你选的站点，不影响上架'),
            h('div', { className: 'zywb-note' }, '状态原文: ' + (it.status || '—')),
            it.registeredAt ? h('div', { className: 'zywb-note' }, '注册日: ' + it.registeredAt) : null,
            it.expiry ? h('div', { className: 'zywb-note' }, '到期日: ' + it.expiry) : null,
            it.goods && it.goods.length ? h('div', { className: 'zywb-note' }, '商品/服务: ' + it.goods.join(' | ')) : null,
            it.indication ? h('div', { className: 'zywb-note' }, '洛迦诺说明: ' + it.indication) : null,
            (it.images && it.images.length) ? h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 } },
              it.images.map(function (u, k) {
                return h('a', { key: k, href: u, target: '_blank', rel: 'noopener' },
                  h('img', { src: u, style: { width: 92, height: 92, objectFit: 'contain', background: '#fff', borderRadius: 6, border: '1px solid #3a3a44' } }));
              })) : null,
            it.detailUrl ? h('div', { style: { marginTop: 6 } }, h('a', { className: 'zywb-lnk', href: it.detailUrl, target: '_blank', rel: 'noopener' }, '→ 去官方库看原始记录')) : null) : null);
      };

      const detailCard = res ? (function () {
        const items = res.items || [];
        const inMk = [], outMk = [];
        items.forEach(function (it, i) { (it.inMarket ? inMk : outMk).push([it, i]); });
        return h('div', { className: 'zywb-card' },
          h('div', { className: 'zywb-h' }, '📋 命中明细 — 本市场 ' + inMk.length + ' 条 / 别国 ' + outMk.length + ' 条'),
          h('div', { className: 'zywb-note', style: { marginBottom: 6 } }, '★ = 该注册覆盖你选的站点（有风险，排在最前） · ○ = 只在别的市场有效（不影响上架）'),
          inMk.length ? h('div', null, inMk.map(function (p) { return mkRow(p[0], p[1]); }))
            : h('div', { className: 'zywb-note', style: { color: '#5fd08a' } }, '✅ 本市场没有任何命中 —— 这个名字在你选的站点是干净的。'),
          outMk.length ? h('div', { style: { marginTop: 10 } },
            h('button', { className: 'zywb-btn', style: { fontSize: 11.5 }, onClick: function () { setShowOther(!showOther); } },
              (showOther ? '收起' : '展开') + ' 只在别国有效的 ' + outMk.length + ' 条（不影响你上架，仅供参考）'),
            showOther ? h('div', { style: { marginTop: 6 } }, outMk.map(function (p) { return mkRow(p[0], p[1]); })) : null) : null,
          h('div', { className: 'zywb-note', style: { marginTop: 10, fontSize: 11.5 } },
            '说明: 官方库只能查"文字"。图形商标 (Logo/图案) 需要图形近似检索，不在覆盖范围内；外观设计请点开图片和你的商品图做视觉比对。'));
      })() : null;

      /* ---------- 批量查重 ---------- */
      const bProg = batch && batch.total ? Math.round(100 * (batch.done || 0) / batch.total) : 0;
      const batchCard = h('div', { className: 'zywb-card' },
        h('div', { className: 'zywb-h' }, '🗂 批量查重 (整个商品库)'),
        h('div', { className: 'zywb-note' }, '按商品库里的「品牌」字段去重后逐个查（用当前选的目标站点），结果写回商品的 品牌备案状态/商标数/查重结论。一个关键词只查一次，后台串行跑，不会并发轰炸官方站点。'),
        !sites.length ? h('div', { className: 'zywb-note', style: { color: '#f0b253', marginTop: 6 } }, '⚠️ 先在上面选目标站点，批量查重才知道该看哪个国家。') : null,
        h('div', { style: { marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' } },
          h('button', { className: 'zywb-btn', disabled: (batch && batch.running) || !sites.length, onClick: function () { startBatch({ limit: 20, onlyUnchecked: false }); } }, '▶ 查前 20 个品牌'),
          h('button', { className: 'zywb-btn', disabled: (batch && batch.running) || !sites.length, onClick: function () { startBatch({ limit: 50, onlyUnchecked: true }); } }, '▶ 查 50 个 (仅未查过的)'),
          h('button', { className: 'zywb-btn', disabled: !(batch && batch.running), onClick: function () { api('/api/ip/batch/stop', 'POST', {}).then(function () { setBMsg('已请求停止'); }); } }, '⏹ 停止'),
          h('button', { className: 'zywb-btn', disabled: batch && batch.running, onClick: function () { api('/api/ip/batch/clear', 'POST', {}).then(function () { setBatch(null); setBMsg(''); }); } }, '⨯ 清空结果')),
        bMsg ? h('div', { className: 'zywb-note', style: { marginTop: 8, color: '#8ab4ff' } }, bMsg) : null,
        batch && batch.total ? h('div', { style: { marginTop: 10 } },
          h('div', { className: 'zywb-note' }, (batch.running ? '⏳ 运行中' : '✔ 已完成') + '  ' + (batch.done || 0) + '/' + batch.total + '  (' + bProg + '%)' + (batch.current ? '  当前: ' + batch.current : '')),
          h('div', { style: { height: 6, background: '#2a2a2f', borderRadius: 3, marginTop: 4, overflow: 'hidden' } },
            h('div', { style: { width: bProg + '%', height: '100%', background: batch.running ? '#4f8cff' : '#5fd08a', transition: 'width .3s' } })),
          h('div', { style: { display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap' } },
            ['high', 'medium', 'low', 'none'].map(function (k) {
              return h('span', { key: k, className: 'zywb-pill', style: { borderColor: IP_LEVEL_COLOR[k], color: IP_LEVEL_COLOR[k] } },
                IP_LEVEL_ICON[k] + ' ' + ({ high: '高危', medium: '中风险', low: '低风险', none: '无冲突' }[k]) + ' ' + ((batch.summary && batch.summary[k]) || 0));
            }),
            h('span', { className: 'zywb-pill' }, '商标已注册 ' + ((batch.summary && batch.summary.registered) || 0)),
            h('span', { className: 'zywb-pill' }, '完全没查到 ' + ((batch.summary && batch.summary.notfound) || 0))),
          h('div', { style: { marginTop: 8, maxHeight: 260, overflow: 'auto' } },
            (batch.batch && batch.batch.results ? batch.batch.results : []).slice().reverse().map(function (r, i) {
              const c = IP_LEVEL_COLOR[r.risk.level] || '#9a9a9a';
              return h('div', { key: i, className: 'zywb-note', style: { padding: '3px 0' } },
                h('span', { style: { color: c, fontWeight: 600 } }, (IP_LEVEL_ICON[r.risk.level] || '') + ' ' + r.term),
                ' · ' + r.risk.level + '(' + r.risk.score + ') · 商品 ' + (r.asins || []).length + ' 个 · ' + (IP_STATUS_CN[r.verdict.brandStatus] || r.verdict.brandStatus));
            })),
          (batch.errors && batch.errors.length) ? h('div', { className: 'zywb-note', style: { marginTop: 6, color: '#f0b253' } }, '失败 ' + batch.errors.length + ' 个: ' + batch.errors.map(function (e) { return e.term; }).join(', ')) : null) : null,
        (batch && batch.batch && batch.batch.results && batch.batch.results.length) ? null : h('div', { className: 'zywb-note', style: { marginTop: 8, opacity: .8 } }, '还没有批量查重结果。'));

      /* ---------- 商品库风险总览 ---------- */
      const ovCard = ov ? h('div', { className: 'zywb-card' },
        h('div', { className: 'zywb-h' }, '📊 商品库知产风险总览'),
        h('div', { className: 'zywb-note' }, '商品总数 ' + ov.total + ' · 已查 ' + ov.checked + ' · 未查 ' + ov.unchecked + '（注意: 结论是"按当时所选站点"算的，换站点要重查）'),
        h('div', { style: { display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap' } },
          ['high', 'medium', 'low', 'none', 'unknown'].map(function (k) {
            return h('span', { key: k, className: 'zywb-pill', style: { borderColor: IP_LEVEL_COLOR[k], color: IP_LEVEL_COLOR[k] } },
              (IP_LEVEL_ICON[k] || '') + ' ' + k + ' ' + ((ov.byLevel && ov.byLevel[k]) || 0));
          })),
        h('div', { style: { display: 'flex', gap: 12, marginTop: 6, flexWrap: 'wrap' } },
          Object.keys(ov.byStatus || {}).map(function (k) {
            return h('span', { key: k, className: 'zywb-pill' }, (IP_STATUS_CN[k] || k) + ' ' + ov.byStatus[k]);
          })),
        h('div', { className: 'zywb-note', style: { marginTop: 8, fontSize: 11.5 } },
          '本地缓存: ' + ((ov.cache && ov.cache.total) || 0) + ' 条 (有效期 ' + ((ov.cache && ov.cache.ttlDays) || 7) + ' 天) —— 命中缓存不重复请求官方站点。  ',
          h('a', { className: 'zywb-lnk', href: '#', onClick: function (e) { e.preventDefault(); api('/api/ip/cache/clear', 'POST', {}).then(function () { loadOv(); }); } }, '清空缓存'))) : null;

      return h('div', null,
        topCard,
        err ? h('div', { className: 'zywb-card', style: { borderColor: '#ff6b6b' } }, h('div', { className: 'zywb-note', style: { color: '#ff9d9d' } }, '⚠️ ' + err)) : null,
        busy ? h('div', { className: 'zywb-card' }, h('div', { className: 'zywb-note' }, '⏳ 正在查询官方库 (按站点串行请求, 每个源之间留了间隔, 通常 3-15 秒)…')) : null,
        conclusion,
        detailCard,
        batchCard,
        ovCard);
    }

    function ZyRoot() {
      const [tp, setTp] = React.useState('collect');
      /* ★ 2026-09-28 整页缩放联动: 商品管理页的 －/＋ 只缩了列表视图(工具栏+卡片+分页), 顶部标签栏在缩放容器外面、原来不跟着缩 —— 看着就像"只缩了数据、界面没缩"。这里订阅商品管理页广播的倍数, 把标签栏也一起 zoom。 */
      const [uiScale, setUiScale] = React.useState(function () { try { return readCardScale() } catch (e) { return 1 } });
      React.useEffect(function () { const onScale = function (e) { const v = Number(e && e.detail); if (isFinite(v) && v > 0) setUiScale(v) }; window.addEventListener('zying-card-scale', onScale); return function () { try { window.removeEventListener('zying-card-scale', onScale) } catch (e) {} }; }, []);
      const [prodSeed, setProdSeed] = React.useState(null);   // 从采集日志跳转带入的商品管理初始过滤 {collectedFrom,collectedTo,label}
      const [lic, setLic] = React.useState(null);             // 后端授权状态 (enforce/valid/fingerprint/到期)
      React.useEffect(function () { api('/api/license/status', 'GET', null).then(function (r) { if (r && r.ok && r.json) setLic(r.json); }).catch(function () {}); }, []);
      const btn = function (id, icon, label) { return h('button', { className: 'zywb-tab' + (tp === id ? ' on ' : '') , onClick: function () { setTp(id); } }, icon + ' ' + label); };
      const openProducts = function (g) { setProdSeed({ collectedFrom: g.fromUtc, collectedTo: g.toUtc, label: (g.atLocal || '') + ' · ' + (g.name || '') }); setTp('product'); };
      if (lic && lic.enforce && !lic.valid) {
        return h('div', { className: 'zywb' }, h('div', { className: 'zywb-body' },
          h('div', { className: 'zywb-card', style: { maxWidth: 720, margin: '48px auto' } },
            h('div', { className: 'zywb-h', style: { color: '#f0b253', fontSize: 15 } }, '🔒 本机未授权'),
            h('div', { className: 'zywb-note' }, '原因: ' + (lic.message || lic.reason || '无有效授权')),
            h('div', { className: 'zywb-note', style: { marginTop: 10 } }, '本机设备指纹 (发给授权方换取授权文件):'),
            h('div', { style: { fontFamily: 'monospace', fontSize: 16, letterSpacing: 1, padding: '8px 10px', marginTop: 4, background: 'var(--dsw-alias-bg-layer-2,#24242b)', border: '1px solid #3a3a44', borderRadius: 6, display: 'inline-block', userSelect: 'text' } }, String(lic.fingerprint || '')),
            h('div', { className: 'zywb-note', style: { marginTop: 12, color: '#8ab4ff' } }, '联系授权方' + (lic.contact ? ': ' + lic.contact : '') + ' → 把上面这串指纹发给他'),
            h('div', { className: 'zywb-note', style: { marginTop: 6 } }, '激活步骤: ① 把指纹发给授权方 ② 收到 license.key 后放到 ' + (lic.licensePath || lic.dataDir || '数据目录') + ' ③ 刷新本页'),
            h('div', { className: 'zywb-note', style: { marginTop: 8, opacity: .8 } }, '授权客户: ' + (lic.customer || '-') + ' · 期限: ' + (lic.expiresAt || '永久') + ' · 机器绑定: ' + ((lic.licenseId ? '是' : '否'))))));
      }
      const licChip = lic ? (lic.enforce
        ? (lic.valid ? h('span', { className: 'zywb-note', style: { marginLeft: 'auto', fontSize: 11 } }, '✅ ' + (lic.customer || '已授权') + ' · ' + (lic.expiresAt ? '到期 ' + lic.expiresAt : '永久')) : null)
        : null) : null;   // 免授权版(enforce=false)不显示任何提示, 界面干净
      return h('div', { className: 'zywb' },
        h('div', { className: 'zywb-tabs', style: { zoom: String(uiScale) } }, btn('collect', '🛰', '采集面板'), btn('product', '📦', '商品管理'), btn('ip', '⚖️', '知产查重'), btn('server', '🖥', '浏览器壳'), btn('archive', '🗄', '选品归档'), licChip),
        tp === 'server'
          ? h('div', { className: 'zywb-body' }, h(ShellPage, { api: api, onOpenCollect: function () { setTp('collect'); } }))
          : (tp === 'archive'
            ? h('div', { className: 'zywb-body' }, h(ArchivePage, { api: api }))
            : (tp === 'ip'
              ? h('div', { className: 'zywb-body' }, h(IpPage, { api: api }))
              : (tp === 'collect'
                ? h('div', { className: 'zywb-body' }, h(CollectPage, { api: api, onOpenProducts: openProducts }))
                : h('div', { className: 'zywb-body' }, h(ProductPage, { seed: prodSeed, key: prodSeed ? (prodSeed.collectedFrom + '_' + prodSeed.collectedTo) : 'all' }))))));
    }
    slots.inject('conversation.view', function () { return slots.register(
      { name: 'conversation.view', id: 'zying-all', order: 5, label: '搞薯条' },
      function () { return h(ZyRoot, null); }
    ); });
  }
}

		})();
		__mod.exports.inject = __plugin.inject || ["slots", "timer"];
		__mod.exports.apply = __plugin.apply;
		__mod.ready = true;
		return __mod.exports;
	}
});
// ── 兜底：同一个包再挂几个历史上用过的 id ──
// 某些 DSH 版本的加载器按"登记用的名字"查找模块，只认一个 id 时会报
// "加载时未通过 __ModuleLoader__.load 注册 <名字>"。多注册几个名字就都不会找不到。
// 用的是同一个 __mod，所以即使被加载两次也不会挂出两个页签。
(function () {
	var alias = ["zying-collect-dsh-plugin"];
	for (var i = 0; i < alias.length; i++) {
		if (alias[i] === "zying-erp") continue;
		window.__ModuleLoader__.load({ id: alias[i], factory: function () { return __mod.exports; } });
	}
})();

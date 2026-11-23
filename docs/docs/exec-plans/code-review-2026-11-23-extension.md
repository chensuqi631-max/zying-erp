# 搞薯条浏览器扩展 v2.11.16 代码审查（MV3）

- 审查对象：`$PKG\02-browser-extension\`
  （`zy-panel.js` 1783 行 / `zy-list.js` 285 行 / `bridge.js` 2963 行 / `background-3.js` 781 行 / `settings.js` 685 行 / `manifest.json` 123 行）
- 口径：行号 = `read` / `grep` 工具口径（LF）。**未修改任何扩展文件**，本文件是唯一产出。
- 已知事实（直连 3088、不走 proxy、初始价按 ASIN 锁定等）不重复报告；已知遗留（iframe 设置死代码 / `SETTINGS_CHANGED` 对 Amazon 页无效 / `FREIGHT_QUOTE_CHANGED` 无处理 / colors 键名不一致）在 R4 中已逐条确认并补充证据。
- 计数：**已确认 Bug 12 条**（高 2 / 中 6 / 中低 2 / 低 2）、**冗余 10 条**、**可疑 8 条**。

---

## 已确认 Bug

### B1 切商品/切变体后，异步数据没有和"当前 ASIN"绑定：旧响应覆盖新数据、重量沿用上一个商品（severity: 高）
- 位置: `zy-panel.js:390-400`（listing / asin-sites 响应无 asin 校验）、`zy-panel.js:474-483`（loadFreight 无请求令牌）、`zy-panel.js:448-449`（weight 不重置）、`zy-panel.js:1763`（上架直接用 S.weightG）
- 触发: 在商品页点变体（Amazon 变体切换常是 AJAX 改 URL，`zy-panel.js:1780` 的 1.5s 轮询会发起第二次 `loadAll`）；或加载中点「刷新」再切商品。两个 `loadFreight` / listing 请求同时在飞。
- 证据:
```js
// zy-panel.js:390-400 —— 回调只判断 j.ok，不判断这个响应是否仍属于当前 ASIN
S.listing = {};
siteList0.forEach(function (st) {
  erp('GET', '/api/listing/check?asin=' + encodeURIComponent(asin) + '&site=' + encodeURIComponent(st)).then(function (j) {
    if (j && j.ok) { S.listing[st] = { duplicated: !!j.duplicated, where: j.where || [] }; render(); }
  }).catch(function () {});
});
// zy-panel.js:476-483 —— 请求发起时读 S.weightG，写回时不再校验；失败分支也不清 S.freight
if (!(S.weightG > 0)) { S.freight = null; S.freightCh = ''; S.freightErr = '页面未读到重量'; render(); return Promise.resolve(); }
return erp('GET', '/api/zy/freight/quote?country=' + ... + '&weight=' + Math.max(1, Math.round(S.weightG)) ...).then(function (j) {
  if (j && j.picked) { S.freight = Number(j.picked.price); ... }
  else if (j && j.cheapest) { S.freight = Number(j.cheapest.price); ... }
  else { S.freightErr = (j && j.error) || '运价不可用'; }      // ← S.freight 保留上一个商品的值
// zy-panel.js:448-449 —— loadAll 不重置 S.weightG：新商品读不到重量时沿用上一个商品的 450g/旧值
if (pf.weightG) { S.weightG = pf.weightG; S.weightSrc = '页面'; }
else if (!S.weightG) { S.weightSrc = '页面未读到'; }
```
- 影响/建议: ② 的「运费/承受价/现价」、`upload()` 提交的 `lowerPrice`、`logisticsCost`、`weightKg`（`:1761-1763`）都可能用上一个商品或晚到响应的数字 → **上架价直接错**；④ 的「✅已上架」徽章同理可能是别的 ASIN 的记录。建议：`loadAll` 生成 `loadToken`（或记录 `S.loadAsin`），每个异步回调写 `S` 前校验 token/asin；`loadAll` 开头显式重置 `weightG/freight/freightCh/freightErr/listing/siteStats/bg`；`loadFreight` 只接受"发起时的 weight 与当前一致"的响应。

### B2 URL 变化在 `S.busy` 时被静默丢弃；BG 店铺可售只在启动查一次（severity: 中）
- 位置: `zy-panel.js:338-341`、`zy-panel.js:1779-1783`、`zy-panel.js:1778`、`zy-panel.js:487-498`
- 触发: 面板正在加载（正常一次 2~8 秒：5 个并发请求 + 变体 + 运费）时切商品/点变体；或任何一次 URL 变化发生在 busy 窗口内。
- 证据:
```js
// zy-panel.js:338-341
function loadAll(manual) {
  if (S.busy) return;              // ← 直接丢弃，没有排队重试
  S.busy = true;
// zy-panel.js:1779-1783 — lastUrl 在调用 loadAll 之前就已更新 → 这次丢弃后永远不会再触发
var lastUrl = location.href;
setInterval(function () {
  if (location.href !== lastUrl) { lastUrl = location.href; if (asinOf()) loadAll(false); }
}, 1500);
// zy-panel.js:1778 — loadBg（多店 BG）只在页面启动时跑一次；loadAll 里没有重跑，也不清 S.bg
loadSettings(function () { loadAll(false); loadBg(); });
```
- 影响/建议: 新商品**永远不加载**（面板停留在旧商品，直到手工点「刷新」）；即便加载成功，① 的「BG 店铺可售」和 ④ 的 BG 徽章仍是上一个 ASIN 的结果（`S.bg` 只在 `:492` 赋值一次，`loadAll` 从不重置）。建议：busy 时置 `S.pendingReload`，busy 释放后补跑一次；`loadAll` 里（或 `loadBg` 用当前 `S.asin`）重查 BG。

### B3 面板 ↔ 后台 ↔ ERP 全链路零超时，`S.busy` 没有兜底释放 → 面板永久"加载中…"（severity: 中）
- 位置: `zy-panel.js:72-88`（send 无超时）、`zy-panel.js:90-94`（erp）、`background-3.js:33-50`（fetch 无 AbortSignal）
- 触发: ERP 单线程被长任务占住、或 fetch 连接挂起（服务端 accept 后不返回、也不 RST）；后台 SW 卡在 `api()` 里。
- 证据:
```js
// zy-panel.js:72-88 —— 只处理 lastError，没有"多久没回就当失败"
function send(type, payload, cb) {
  try {
    chrome.runtime.sendMessage(Object.assign({ type: type }, payload || {}), function (res) {
      if (chrome.runtime.lastError) { ... if (cb) cb({ ok: false, error: lm }); return; }
      if (cb) cb(res);
// background-3.js:36-44 —— fetch 没有 AbortSignal/timeout
r = await fetch(base + path, { method, headers: ..., body: ... });
} catch (e) { throw new Error('连不上本地智赢ERP (' + base + ') — 请确认 ERP 后端已启动'); }
```
- 影响/建议: `loadAll` 的 `Promise.all`（`:348-353`）永不 settle → `S.busy` 永远 true → 「刷新」按钮、1.5s 路由轮询、所有 `loadAll` 全部静默 return，面板死在"加载中…"，只能 F5。同一仓库已有范式（`settings.js:364/466` 用 `AbortSignal.timeout`、`background-3.js:130-149` sendToTab 有 5s 超时），面板这条链反而没有。建议：`erp()/send()` 加 8~10s 超时并把 `S.busy` 用 try/finally 收口。

### B4 `zyp_v3_settings` 整对象读改写 + 只读一次内存缓存：多标签互相覆盖锁定值（severity: 中）
- 位置: `zy-panel.js:107-132`（loadSettings 只读一次、saveSettings 写整份 SET）、锁定价写点 `:1507 / :1516 / :1566 / :1602`、修正开关 `:1468`
- 触发: 同一浏览器同时开两个商品页（商品 A 页、商品 B 页）各改各的「初始价/承受价/±」；后保存的一方用自己启动时读到的旧 `SET` 覆盖对方刚写的 `initPriceByAsin` / `manualBearByAsin` / `adjBySite`。
- 证据:
```js
// zy-panel.js:107-111 —— 整个 SET 只在启动时读一次，之后没有任何 storage.onChanged 同步
function loadSettings(cb) {
  chrome.storage.local.get(STORE_KEY, function (o) {
    var v = (o && o[STORE_KEY]) || null;
    if (v) SET = Object.assign(SET, v);
// zy-panel.js:132 —— 每次保存都写整份 SET（含其他标签页可能已改过的字段的旧值）
function saveSettings() { try { var o = {}; o[STORE_KEY] = SET; chrome.storage.local.set(o); } catch (e) {} }
// zy-panel.js:1564-1567 —— 锁定值写在内存 SET 上，随后整份刷盘
if (!SET.initPriceByAsin) SET.initPriceByAsin = {};
if (el.value === '') delete SET.initPriceByAsin[String(v.asin)];
else if (isFinite(Number(el.value))) SET.initPriceByAsin[String(v.asin)] = r2(Number(el.value));
saveSettings();
```
- 影响/建议: 用户刚锁定的初始价/手填承受价会在另一个标签页保存时无声丢失（刷新后回到数据源重算值），随后按错的承受价上架。建议：`*_ByAsin` 改成"读-合并-写"（每次 save 前先 `get` 再 merge 当前 tab 自己改过的键），或按 ASIN 单键存储；同时监听 `chrome.storage.onChanged` 合并其他标签页的改动。gz 全文件 grep：`zy-panel.js` 没有任何 `storage.onChanged`（只有 `zy-list.js:262` 有）。

### B5 面板「🚀 上架」不做必填校验：空初始价/空承受价会直接提交（severity: 中）
- 位置: `zy-panel.js:1724-1774`（upload）、`:1732-1752`（取值）、`:1759-1765`（提交 job）
- 触发: 数据源没价（`S.variantSrc==='page'` 且页面取不到价）或用户把某行「初始价」清空后直接点 🚀。
- 证据:
```js
// zy-panel.js:1732-1735 —— price 为 null 时返回空串，没有任何拦截
function uploadInitPrice(v) {
  var adjIp = (v.ipAdj != null && isFinite(Number(v.ipAdj))) ? Number(v.ipAdj) : (Number(S.initAdj) || 0);
  return v.price != null ? r2(Number(v.price) + adjIp) : '';
// zy-panel.js:1750-1752 —— 空串原样进 items
var items = sel.map(function (v) {
  return { asin: v.asin, initPrice: uploadInitPrice(v), lowerPrice: uploadBearPrice(v), ... };
// 对照 bridge.js:2259-2263 —— 同一产品的另一条上传路径会拒绝空值
} else {
  if (!/^[A-Z0-9]{10}$/.test(body.asin)) bad.push('asin 不合法(' + body.asin + ')');
  if (!body.price) bad.push('初始价');
  if (!body.lowerPrice) bad.push('承受价');
```
- 影响/建议: 空串经 `/api/ifast/add` → `ifast-client.js:284` 依然是 `''` → 向 ifast `product_add.json` 提交一条初始价为空的 listing；而 bridge 的 API 通道会明确拒绝（`bad.push('初始价')`），两条上传路径口径不一致。建议：`upload()` 过滤/拦截空价格，confirm 文案里标出哪些变体缺价。

### B6 `loadFreight` 失败分支不清空旧运费、数值不校验（severity: 中）
- 位置: `zy-panel.js:474-483`
- 触发: 运价接口失败/该站点无渠道（返回既无 `picked` 也无 `cheapest`），或 `picked.price` 为 null。
- 证据:
```js
return erp('GET', '/api/zy/freight/quote?...').then(function (j) {
  S.dbg = Object.assign(S.dbg || {}, { freight: JSON.stringify(j).slice(0, 300) });
  if (j && j.picked) { S.freight = Number(j.picked.price); S.freightCh = j.picked.channel; S.freightErr = ''; }
  else if (j && j.cheapest) { S.freight = Number(j.cheapest.price); S.freightCh = j.cheapest.channel; S.freightErr = ''; }
  else { S.freightErr = (j && j.error) || '运价不可用'; }   // ← 没清 S.freight / S.freightCh
  render();
```
- 影响/建议: 失败时 `S.freight` 仍保留上一次（上一个商品/上一次查询）的运费，② 继续用它算承受价并写进上架记录；`picked.price` 为 null 时 `Number(null)=0`、缺字段时 `Number(undefined)=NaN`，面板会显示 `¥NaN` 并把 NaN 传进算价。建议：进入函数先 `S.freight=null; S.freightCh=''; S.freightErr=''`；`isFinite` 校验后再采用。

### B7 `bridge.js` 的 `IFAPI.options()` 把失败结果永久缓存（severity: 中）
- 位置: `bridge.js:2002-2010`、`:2152-2157`
- 触发: 页面刚打开/ifast 会话抖动时第一次 `apiTryTask` 调 `options()`，两个 GET（site/enable、selling.json）任一失败或返回空 data。
- 证据:
```js
async options() {
  if (IFAPI._opt) return IFAPI._opt;                         // ← 空结果也会被命中
  const [s, g] = await Promise.all([IFAPI.get('/amazon/site/enable'), IFAPI.get('/amazon/selling//user/selling.json')]);
  IFAPI._opt = {
    sites: ((s && s.data) || []).map(...),
    sells: ((g && g.data) || []).map(...),
  };
  return IFAPI._opt;
// bridge.js:2152-2155 —— 一旦缓存为空，后续全部走这条失败分支
const opt = await IFAPI.options();
if (!opt.sites.length) return { done: false, why: 'API 取不到站点列表' };
```
- 影响/建议: 整页生命周期内所有 API 直连都报"API 取不到站点列表"→ 静默回退 DOM 流程（12s+/条、还有确认层/翻页风险），只有 F5 才能恢复；错误原因也被掩盖成"取不到站点列表"。建议：只在 `sites.length && sells.length` 时写缓存；失败不缓存并保留原始错误。

### B8 `refreshShop` 瞬时失败即把 `currentShop` 写 null（多写者竞态）（severity: 中）
- 位置: `bridge.js:2882-2892`、`:2810-2830`
- 触发: ifast 页面刚重载/网络抖动，`detectShop` 三次重试仍失败；或同浏览器开着多个 ifast 页，某页处在"未登录判定"窗口。
- 证据:
```js
// bridge.js:2820-2826 —— 重试到头仍可能拿不到结论
for (let i = 0; i < 3; i++) { ... await new Promise((res) => setTimeout(res, 1200 * (i + 1))); }
if (!r) return { loggedIn: false, reason: '读店铺信息失败(网络/页面还没就绪): ' + (lastErr || '无响应') };
// bridge.js:2884-2887 —— 只要"没判断出已登录"就无条件清空本机店铺
if (!info.loggedIn) {
  curShop = null;
  try { chrome.storage.local.set({ currentShop: null }); } catch (e) {}
// bridge.js:2864 —— 另一条路径同时写 currentShop（read-modify-write）
chrome.storage.local.set({ shops: shops, currentShop: key }, () => {
```
- 影响/建议: `LISTING_FILL_TASKS` 会带 `currentShop` 去过滤、面板 `load()` 直接判"未登录/0 条"，用户看到"上架记录全没了"；多标签 ifast 会互相把 `currentShop` 改成 null 或改成自己的店铺名。建议：只有明确 `code===403` 才写 null；"网络/页面未就绪"只提示、不动 storage；`recordShop` 与清空操作加时间戳/版本号做 CAS。

### B9 自动提交时"确认层"点击没有一次性保护，而且查的是顶层文档（severity: 中低）
- 位置: `bridge.js:882-888`（20 轮循环里每轮都能点确认）、`:884`（`document.querySelector` 而不是 iframe doc）
- 触发: ifast 保存后弹出二次确认层。
- 证据:
```js
for (let i = 0; i < 20; i++) {
  ...
  const conf = document.querySelector('.layui-layer-btn0');          // ← 顶层 document
  if (conf && /确定|确认|是/.test(t2(conf)) && conf.offsetParent !== null) {
    const near = (document.querySelector('.layui-layer-content') || {}).innerText || '';
    say('   [提交] 出现确认层(...) → 点确定');
    try { clickReal(conf) } catch (e) {}
  }
```
- 影响/建议: 两种坏情况二选一：① 确认层在顶层文档且点完不立刻消失 → 每 800ms 再点一次、最多 20 次 → 重复提交（同仓库的"回退纪律"只防 API/DOM 两条通道重复，不防同一通道内重点）；② ifast 的提示层实际在 `item_add.html` iframe 内（同文件 `:903-915` 正是因为"顶层找不到"才去扫 iframe），顶层 querySelector 永远找不到 → 确认层从不被点 → 16s 后判"提交未确认"，ERP 状态与实际相反。建议：用 `docW`/iframe document 查层，并加 `confClicked` 标志只点一次。

### B10 多变体 DOM 流程仍用硬编码旧站点 id（severity: 中低）
- 位置: `bridge.js:1430`、`:1071`、对照 `:1093-1114`（siteIdOf 已改成"实时站点表优先"）
- 触发: `apiDirect=false`，或 API 直连回退 DOM 流程时走多变体添加。
- 证据:
```js
// bridge.js:1430
const siteId = f.siteId || SITE_ID[String(f.site || task.site || '').toLowerCase()];
// bridge.js:1071
const SITE_ID = { uk: '69131', gb: '69131', au: '69136', de: '69132', fr: '69133', it: '69134', es: '69135' };
// bridge.js:1096-1102 —— 同一个文件里已经承认旧 id 过期（真实是 69181/69182…），改为实时表优先
/* ★ 2026-10-07 修【站点 id 来源】: 原来【优先用硬编码 SITE_ID】(uk=69131), 而 ifast 现在的站点 id 是
 *   69181=GB / 69182=DE ... 改为: 【优先实时站点表】... */
```
- 影响/建议: 6 国用过期 id，其它站点（US/CA/JP/NL/SE/PL/MX/BR/SG/AE/SA）`SITE_ID[...]` 为 `undefined` → `MV.setSelect` 直接失败（"选项里没有 undefined"），站点填不上；与同文件 `siteIdOf` 口径自相矛盾。建议：`siteIdOf(f.site, pane.querySelector('select[name=siteId]'))`，删掉 SITE_ID 表。

### B11 「初始± ↓填充」不落盘 → 刷新后价格回退（severity: 低）
- 位置: `zy-panel.js:1635-1647`，对照 `:1598-1604`（单行编辑会写锁定值）
- 触发: 点「初始±」列的 `↓填充` 把某行 ± 铺到所有变体，然后刷新/切页。
- 证据:
```js
// zy-panel.js:1635-1647 —— 只改内存 v.ipAdj 后 render，不写 SET.initPriceByAsin
bd.querySelectorAll('[data-fill-ipadj]').forEach(function (el) {
  el.addEventListener('click', function (e) {
    ...
    S.variants.forEach(function (v) { v.ipAdj = src; });
    render();
// 对照 zy-panel.js:1601-1602 —— 单行 input 事件里才会同步锁定值
/* ★ 2026-11-22 初始± 改变了实际初始价 → 同步更新锁定值(落盘交给 change 事件...) */
try { if (!SET.initPriceByAsin) SET.initPriceByAsin = {}; SET.initPriceByAsin[String(v.asin)] = disp; } catch (eL) {}
```
- 影响/建议: `v.ipAdj` 只存在内存（未持久化），填充后显示的初始价整体变了，但刷新即回到数据源价；用户以为"已锁定"（`title="已锁定…"`）实际没有，刷新后上传价与填充时不同。建议：填充后按每行 `v.price` 重算并写 `SET.initPriceByAsin`（照 `fillall` 的 `:1502-1509` 写法）。

### B12 面板/上架器 innerHTML 拼接未转义的外部数据（severity: 低，安全）
- 位置: `zy-panel.js:1141`（openZoom 直接拼 URL）、`zy-panel.js:997`（已保存 ifast 账号 username/note）、`bridge.js:2896`（店铺名）
- 触发: 上述字符串含 `"` / `<`（商品主图 URL 来自 ERP 采集结果、账号名/备注/店铺名来自 ifast 服务端数据）。
- 证据:
```js
// zy-panel.js:1141 —— url 来自 data-zoom（浏览器已把属性实体解码回原文），再裸拼进 innerHTML
box.innerHTML = '<img src="' + url + '" style="max-width:92vw;...">';
// zy-panel.js:997 —— username / note 未转义
return '<option value="' + a.username + '"' + (a.username === ACC.active ? ' selected' : '') + '>' + a.username + (a.note ? ('（' + a.note + '）') : '') + ...
// bridge.js:2896 —— shop.name 未转义
if (m) m.innerHTML = '店铺: <b>' + shop.name + '</b>' + (shop.countries.length ? (' · ' + shop.countries.join('/')) : '') + ...
```
- 影响/建议: 在 Amazon / ifast 页面上下文注入 HTML/属性（可构造 `<img src=x onerror=...>`），属于 XSS 面；同文件其它 90% 位置都走了 `esc`，这三处是漏点。建议：统一 `esc`；`openZoom` 用 `img.src = url` 赋值而不是拼 innerHTML。

---

## 冗余/重复

### R1 `zy-list.js` 两套并行的"扫描调度" + 永不清理的 2s 定时器（同时是性能问题）
- 位置: `zy-list.js:180-195` 与 `zy-list.js:271-284`
- 证据:
```js
// 第一套：scroll + DOMContentLoaded + 2s setInterval + MutationObserver
window.addEventListener('scroll', scheduleRun, { passive: true });
document.addEventListener('DOMContentLoaded', scheduleRun);          // document_idle 注入，此事件早已过去 → 死监听
(function () {
  setInterval(function () { if (isListPage()) scheduleRun(); }, 2000);   // 永不 clear
  try { var mo = new MutationObserver(scheduleRun); mo.observe(document.body, { childList: true, subtree: true }); } catch (e) {}
})();
// 第二套：又一个 MutationObserver + 又一个 scroll
var obs = new MutationObserver(function (muts) { ... throttledRun(); ... });
obs.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener('scroll', throttledRun, { passive: true });
```
- 说明: 列表页每次 DOM 变动触发两套调度（600ms debounce + 2.5s 节流），再加一个永不清理的 2s 兜底轮询；每轮 `run()` 都用 4 个选择器对全页 `querySelectorAll`（`:155-178`）。Amazon 列表页 DOM 变动频繁（懒加载/轮播/广告），等于常驻全页扫描、重复请求。建议删掉其中一套（保留 `throttledRun` + 一个 MO）。

### R2 死函数/死分支：端口与设备面板整链 + 5 个无调用点函数 + 1 个空实现
- 位置: `bridge.js:1563-1831`（`zvPortsApi/zvPortsRowsHtml/zvPortsRefresh/zvPortsHide/zvPortsPaintCurrent/zvPeerApi/zvPeerPaint/zvPeerRefresh/zvPeerConnectByInput/zvPortsOpen`，唯一入口 `zvPortsOpen` 在 `:1741`，**无任何调用点**）、`bridge.js:1840-1848`（`zvIfastGet` 无调用）、`zy-panel.js:292-299`（`bearRow`）、`zy-panel.js:501-504`（`bgTag`）、`zy-panel.js:703-706`（`chOpts`）、`bridge.js:517`（`syncFillBtn` 空实现，仍被 `:2406/:2644/:2694/:2725` 调用）
- 证据: 逐符号 grep：`zvPortsOpen` / `zvIfastGet` / `bearRow` / `bgTag` / `chOpts` 全仓库均只有定义行一处。
```js
// bridge.js:1810-1811 —— zvPortsOpen 内引用了未定义的 say（say 只在 doFillFlowInner:2451 内声明）
try { say('   新地址已复制到剪贴板: ' + full); } catch (e) { }
// zy-panel.js:292-299 —— bearRow 是算价公式的第三份副本，无调用
function bearRow(v) { ... return r2(bearBase() + (Number(S.adj) || 0)); }
```
- 说明: 端口/设备面板 A 链（含 `.zv2-*` CSS `:170-191`）约 270 行不可达，消息类型 `PORTS`/`PEERS` 也因此永远不会被发（见 R8）；`zvIfastGet` 是为"item_list.json 的 `code:""`"写的兼容函数，但同步已改走 ERP 直连（`:1849-1881`）。合计约 300 行死代码。若 `zvPortsOpen` 将来被接回，`say` 会立刻 ReferenceError（被 try/catch 吞掉，表现为"点了没反应"）。

### R3 四套设置 UI + 10 个没有任何消费方的设置项 + `pricing` 键只写不读
- 位置: `settings.js:15-31`（DEF）、`settings.js:406/513-519`（写 `settings`+`pricing`）、`bridge.js:687-739`（第二套内嵌设置，DEF2 又重复一遍）、`zy-panel.js:668-804`（第三套面板内设置）
- 证据:
```js
// settings.js:15-31 —— 这些键里只有 autoSubmit/apiDirect/erpBase/zylColors 被运行时代码读取
const DEF = { autoVariantFetch: true, rankFreshMin: 30, maxRows: 200, logisticsPick: 'lowest',
  defaultWeightKg: 0, defaultScope: 'one', defaultFillMode: 'auto', defaultStock: 0,
  defaultLeadDays: 15, defaultFollowPreset: 'allday', autoSubmit: true, apiDirect: true, erpBase: ..., zylColors: {...} };
// settings.js:406 —— pricing 键：全仓库只有 settings.js 自己读（load:43），没有任何消费者
chrome.storage.local.set({ settings: S, pricing: P }, () => { ... });
```
- 说明: `pricing`（利润率/各站到手比例/汇率/本币调整/useLiveFx）写入后无任何脚本读取——面板算价用的是自己的 `zyp_v3_settings`（`zy-panel.js:97-132`）；`autoVariantFetch/rankFreshMin/maxRows/defaultWeightKg/logisticsPick/defaultScope/defaultFillMode/defaultStock/defaultLeadDays/defaultFollowPreset` 同样只在"渲染/保存"之间循环，运行时无人读（bridge 只读 `autoSubmit/apiDirect/erpBase`，background 只读 `erpBase`，zy-list 只读 `zylColors`）。用户改这些开关**完全无效**。建议删除或真正接线。

### R4 面板内嵌设置 iframe 是死代码；`SETTINGS_CHANGED` 对 Amazon 页无效且"通知数"虚高（确认已知遗留）
- 位置: `zy-panel.js:230-241`（`setWrap` + iframe）、`:189-194`（`.setwrap/.sethd/.setframe/.setfallback` CSS）、`:258-261`（点击处理）；`background-3.js:673-685`；`zy-panel.js` 全文无 `chrome.runtime.onMessage`
- 证据:
```js
// zy-panel.js:231-241 —— setWrap 构造后 display:none，全文件再没有任何地方把它显示出来
var setWrap = document.createElement('div');
setWrap.className = 'setwrap';
setWrap.style.display = 'none';
...
wrap.appendChild(hd); wrap.appendChild(bd); wrap.appendChild(ft); wrap.appendChild(setWrap);
// zy-panel.js:254 —— 设置按钮实际走 openSettings() → 内嵌 settingsHtml()（:668-686），与 setWrap 无关
else if (a === 'settings') { openSettings(); }
// background-3.js:680 —— 失败（lastError，页面没有监听器）也被计成"已通知"
try { const r = await sendToTab(tb.id, { type: 'SETTINGS_CHANGED' }, 3000); if (!r.timeout) notified++; } catch (e) {}
```
- 说明: `setWrap`/iframe/`.setwrap` 系列 CSS/点击处理约 20 行死代码。后台把 `SETTINGS_CHANGED` 广播给所有 Amazon/ifast 页，但 `zy-panel.js`/`zy-list.js` 都没有 `onMessage` 监听器（grep 为 0）→ 每个 Amazon 标签都返回 "Receiving end does not exist"，而 `!r.timeout` 把它算成已通知，`notified` 数字无意义；`settings.js:286/330/499` 的 `FREIGHT_QUOTE_CHANGED` 也没有任何处理方（background 只回"未知消息类型"）。

### R5 站点/货币/汇率/税 常量表 8 份，且互相缺项、大小写不统一
- 位置: `zy-panel.js:21-30`（SITES/CC/CUR/FX_DEF）、`:524-526`（SITE_ZIP/SITE_CUR/CUR_SITE）、`zy-list.js:10-16`（第二份 SITES，值是小写）、`bridge.js:624`（ZV_CURCODE）、`:1068`（SITE_COUNTRY）、`:1071`（SITE_ID）、`:1073`（SELL_ID）、`settings.js:97-100`（FQ_SITE）、`:337`（SITE）
- 证据:
```js
// zy-panel.js:525-526 —— 两行逐字相同
var SITE_CUR = { de: 'EUR', uk: 'GBP', fr: 'EUR', it: 'EUR', es: 'EUR', au: 'AUD', us: 'USD', ca: 'CAD', jp: 'JPY' };
var CUR_SITE = { de: 'EUR', uk: 'GBP', fr: 'EUR', it: 'EUR', es: 'EUR', au: 'AUD', us: 'USD', ca: 'CAD', jp: 'JPY' };
// zy-panel.js:29 CUR 只覆盖 9 个站点（SITES 是 18 个）→ 其余站点走默认 '€'
var CUR = { US: '$', DE: '€', UK: '£', FR: '€', IT: '€', ES: '€', JP: '¥', CA: 'C$', AU: 'A$' };
// zy-panel.js:54 —— 未覆盖站点（NL/SE/PL/MX/BR/SG/AE/SA）货币符号一律显示 €
function curSym(site) { return CUR[site] || '€'; }
```
- 说明: 改一个站点要改 8 处；`CUR/FX_DEF/SITE_ZIP/SITE_CUR` 都缺 NL/SE/PL/MX/BR/SG/AE/SA（面板支持 18 站点），这些站点的货币符号/汇率/切站邮编全部落到默认值。建议收敛到一张 `SITE_INFO` 表（至少 zy-panel 内合并 CC/CUR/FX/SITE_*）。

### R6 "站点→Amazon 域名"拼接重复 4 处，`siteOf()` 两份且大小写不同
- 位置: `zy-panel.js:1164`、`:1213`、`:1214`、`:1296`、`:1475`；`zy-panel.js:39-42` 与 `zy-list.js:70-73`
- 证据:
```js
// zy-panel.js:1164 / 1213 / 1214 / 1296 —— 同一段表达式抄了 4 遍
'https://www.amazon.' + (S.site === 'UK' ? 'co.uk' : S.site.toLowerCase()) + '/dp/' + S.asin
// zy-panel.js:41 return SITES[h] || 'US';   ← 大写
// zy-list.js:72  return SITES[h] || 'de';    ← 小写（同名字段两套语义，靠调用方自己记得转）
```
- 说明: 建议 `slugOf(site)` 单点实现；18 站点里 AU/JP 等域名规则（`com.au`/`co.jp`）目前靠 `toLowerCase()` 碰巧拼对，新增站点极易拼错。

### R7 算价公式 3 份副本（含 1 份死函数），已经出现漂移
- 位置: `zy-panel.js:284-299`（bearBase/bearRow）、`:1226-1241`（rowCalc）、`:1736-1749`（uploadBearPrice）
- 证据:
```js
// zy-panel.js:1233（rowCalc）        —— 用行内 ship/cost/margin/tax/fx + 行内 adj
var base = r2(r2(ship + cost) * (1 + margin) / k / fx);
// zy-panel.js:1746（uploadBearPrice）—— 同一公式再写一遍
var base = r2(r2(ship + cost) * (1 + margin) / k / fx);
// zy-panel.js:289-290（bearBase）    —— 第三份，只用全局 S.freight/S.cost/S.margin
var cnyPrice = r2(cnyCost * (1 + (Number(S.margin) || 0)));
var k = kOf(effTaxPct(null));
```
- 说明: 改口径（或加税/取整规则）必须同步 3 处；`bearRow`（`:292`）是无调用点副本且**不读行内值**，与 `rowCalc` 已经不一致，一旦有人接回就会算出不同的承受价。

### R8 `background-3.js` 约 290 行消息分支在本包内没有任何发送方（无 popup 后的遗留）
- 位置: `background-3.js:194-200`(PING)、`214-218`(ZY_STATUS)、`219-254`(ZY_LOGIN/SMS/TOKENS/TOKEN_SWITCH/TOKEN_ADD/TOKEN_REMOVE)、`273-284`(ZY_BG/ZY_EXPIRY)、`291-311`(STATUS/PUSH)、`315-341`(LISTING_UPLOAD)、`342-347`(CLAIMS_CHECK)、`349-375`(PORTS/PEERS)、`377-384`(LISTING_INGEST)、`395-403`(LISTING_EXPORT)、`523-527`(SHOP_CURRENT)、`547-553`(SHOP_LIST)、`554-559`(LISTING_FILL_RESET)、`593-642`(FILL_TASK_NOW)、`644-654`(REVIVE_IFAST_TABS)、`656-667`(RATES)、`724-773`(LOGISTICS_QUOTE)
- 证据: 逐 type 在 4 个脚本里 grep 发送方，上述 22 个 type 均无；`manifest.json:104-106` 也没有 `default_popup`（v2.11 删 popup 后遗留）。组合示例：`FILL_TASK_NOW`（50 行）只依赖"采集器点上传"的旧链路，而当前面板上架走的是 `/api/ifast/add`（`zy-panel.js:1760`）。
- 说明: 约 290 行不可达（含 `LISTING_UPLOAD` 的 27 行、`LOGISTICS_QUOTE` 的 50 行、`FILL_TASK_NOW` 的 50 行）。若确实要保留"对外接口"，建议注释标明并在文档里列 type 清单，否则删除。

### R9 `settings.js` 顶层调用作用域错误（每次开设置页必抛一次）+ 空定时器
- 位置: `settings.js:547`（`initShops` 定义在 `bind()` 内）、`:662`（bind 内正确调用）、`:685`（顶层再调一次）、`:86-87`（dirty 的空 setTimeout）
- 证据:
```js
// settings.js:682-685 —— initShops 是 bind() 的局部函数，顶层不可见 → ReferenceError 被 try/catch 吞掉
load(() => { bind(); render(); });
/* 店铺管理初始化 */
setTimeout(() => { try { initShops(); } catch (e) {} }, 600);
// settings.js:86-87 —— clearTimeout 后 setTimeout 一个空函数，dirtyT 也不再清空，纯冗余
function dirty() { msg('有未保存的改动', 'warn'); clearTimeout(dirtyT); dirtyT = setTimeout(() => { /* 提示常驻到保存 */ }, 100); }
```
- 说明: L685 是死代码（永远无声失败），可删；`dirty()` 的定时器没有任何作用。

### R10 只写不读的状态字段 + 不可达的分类/颜色分支
- 位置: `zy-panel.js:205-217`（`S.price/S.bgStat/S.dbg/S.pageFacts/S.pageVariantTotal/S.pagePriceCur/S.weightSrc/S.panelBox` 均只有赋值行）、`:443`（`v.priceLocked`）、`:461`（`S.dims`/`S.colors` 只被重置为 `{}`，从未填充）、`:648-664`（specChips 的 dims/颜色分支）、`:1491-1492` / `:1526` / `:1535`（`adj-`/`adj+`/`acctAdd`/`acctAuto` 分支无对应按钮）、`:1461-1469`（`data-f` 的 `cost/margin/net/fx/initAdj/adj` 分支无对应输入）
- 证据:
```js
// zy-panel.js:648-664 —— S.dims/S.colors 永远是空对象（唯一赋值是 :461 的 {}）→ 整段分支不可达
function specChips(v) {
  var dims = S.dims[v.asin] || [];
  if (!Array.isArray(dims) || !dims.length) { ... return v.attrs.map(...) }   // ← 永远走这里
// zy-panel.js:1491-1492 —— main 视图里没有任何 data-act="adj-"/"adj+" 按钮（grep 为 0 处渲染）
if (a === 'adj-') { S.adj = r2(S.adj - 1); ... }
else if (a === 'adj+') { S.adj = r2(S.adj + 1); ... }
```
- 说明: 约 80 行不可达分支 + 9 个无效状态字段；其中 `S.initAdj` 因为没有任何输入控件而恒为 0，使 `:1498` 的 `first.price + (Number(S.initAdj)||0)` 实际上一直按 0 处理（干扰阅读）。建议清理或补齐控件。

---

## 可疑但未确认

### S1 `bridge.js` 的 XHR 钩子可能拦不到页面主世界的请求
- 位置: `bridge.js:1014-1042`（`zvWatchIframeAjax` 在 `doc.defaultView` 上包 `XMLHttpRequest.prototype.open/send`）
- 疑点: 内容脚本运行在隔离世界，`iframe.contentWindow` 里取到的 `XMLHttpRequest` 是本世界的内建，改写它对 iframe 页面主世界的 XHR 是否生效需要实测（Chrome 常规做法是注入 `<script>` 到主世界才能 hook `window.fetch/XHR`）。若无效，`zvJudgeAjax` 的"保存接口应答"判据（`:1047-1051`）永远拿不到数据，成功/失败只能靠提示文案与"弹窗是否关闭"猜。
- 验证: 打开 ifast、点保存，执行 `__zvBridge.submit()` 看 `ajaxWatched` / `ajax` 是否非空。

### S2 `clickReal` + `requestSubmit` 可能造成同一通道二次提交
- 位置: `bridge.js:826-855`
- 疑点: 先 `clickReal(f.btns[0])`（合成 mousedown/up/click，`:1134-1143`），600ms 后若 iframe 还在就 `form.requestSubmit(btn0)`。如果 ifast 的「保存」同时挂了 click 处理器（layui 常见两种写法之一），第一次合成 click 已触发保存，随后 requestSubmit 又触发一次。注释只说明"合成 click 不触发默认动作"，没有排除 click 监听器路径。
- 验证: 实测保存请求在 Network 里出现几次。

### S3 SW 生命周期：内存缓存基本无效，`reviveIfastTabs` 后半段可能被回收
- 位置: `background-3.js:16-31`（`__ratesCache` 1h / `__apiBase` 5s 都在 SW 内存）、`:656-667`、`:158-185`
- 疑点: SW 空闲 30s 即被回收，1h 汇率缓存几乎不可能命中（只多打接口）；`reviveIfastTabs` 先 `await 3000ms`，再对每个 ifast 页 `sendToTab`(2.5s)、每个 Amazon 页 `sendToTab`(1.5s)，标签页多时耗时可能超过 SW 空闲窗口，导致后半段刷新/日志不执行（onInstalled 的 handler 返回 undefined，不构成 keepalive）。

### S4 `manifest.json` 权限过宽（安全）
- 位置: `manifest.json:10-36`、`:112-122`
- 疑点: `"http://*/*"`（L35）让 L11-14 的 `127.0.0.1/localhost` 白名单和全部 http 主机条目沦为冗余，同时允许对任意明文 HTTP 站点发请求（后台 `api()` 的 base 可被 `settings.erpBase` 改成任意 http 地址，响应可被中间人替换）；`web_accessible_resources` 用 `<all_urls>` 把 `settings.html/settings.js` 暴露给任意网页（可被任意站点 iframe 探测扩展是否安装）。建议收窄到 amazon/ifast/127.0.0.1。

### S5 `settings.js` 汇率对象被写入非汇率键
- 位置: `settings.js:355-357`、`:367-368`
- 疑点: `rates._source = ...` 把 `_source` 挂进 `j.rates`，随后 `pricingRates: {..., rates: j.rates}` 落库；下次 `renderFx` 用 `Object.keys(rates).length` 显示"共 N 个币种"会多算 1，且 `rates` 里混入 `_source` 字段。低危，但会让设置页数字长期偏差 1。

### S6 `zy-list.js` 失败后不再重试 / 永久隐藏
- 位置: `zy-list.js:203-211`、`:220-234`
- 疑点: `processed[c.asin] = true` 在发请求**之前**置位，`ZY_CARDS` 失败后不会再试，卡片永久停在"✗ 取数失败"；`res.items[c.asin]` 缺失时 `b0.style.display='none'`（`:229`）也是永久隐藏，滚动回来也不会恢复。

### S7 `background-3.js` 的 `api()` 同样没有超时
- 位置: `background-3.js:33-50`
- 疑点: 与 B3 同源，但在 SW 侧：ERP 不响应时 `fetch` 一直挂着，`sendResponse` 不发出；`sendToTab` 的超时只覆盖"页面不响应"，覆盖不到"ERP 不响应"。多个消息并发时会累积挂起的 Promise。

### S8 `zy-panel.js` 的 `esc()` 不转义单引号，与其它文件不一致
- 位置: `zy-panel.js:47-51`（只转 `& < > "`），对照 `settings.js:39` / `zy-list.js:76-79`（转 `'` 为 `&#39;`）
- 疑点: 当前所有属性都用双引号、暂未发现注入点，但一旦有人改成单引号属性（`<option value='...'>`）即成 XSS；属于容易复发的隐患。

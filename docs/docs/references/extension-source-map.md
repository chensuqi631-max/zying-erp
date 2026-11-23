# 浏览器扩展（搞薯条面板）源码地图

> 面向 AI Agent 的事实索引：**每个文件负责什么、关键函数在哪一行、消息/存储键、注入规则、调了哪些 ERP 接口、改 X 该动哪里**。
> 核对时间 2026-11-22。源码目录 = **Edge 当前实际加载的目录**：
> `$PKG\02-browser-extension\`
> 行号均为该目录当前文件实测值；拿不准时用 `文件:行号` 现场复核。

---

## 0. 30 秒速查

| 我想… | 去改 |
|---|---|
| 改 Amazon 商品页面板（分区/按钮/表格/算价） | `zy-panel.js`：渲染 `render()` 1146-1434、事件 `bind()` 1436-1692 |
| 改列表页卡片下方那行信息（BG/品牌/价格/排名） | `zy-list.js`：`renderBlock()` 127-149、取数 `run()` 197-238、样式 90-101 |
| 改 ifast 上架器 / 自动填表 / API 直连 | `bridge.js`：面板 331-409、记录渲染 553-616、填表 2418-2740、API 1883-2400 |
| 加/改后台消息类型 | `background-3.js` 主监听器 189-781（43 个类型） |
| 加/改 ERP 接口调用 | 面板直接 `erp(method, '/api/...')`（90-94），**不用改 background**（`ZY_API` 只校验 `/api/` 前缀，570-579） |
| 改完整设置页（税率/运费/汇率/ERP 地址） | `settings.html` + `settings.js`（默认值唯一权威 = `settings.js:15-31`） |
| 查「按钮调哪个接口 / 数据从哪来」 | 本文 §2、§6 |

---

## 1. 加载方式与注入规则

### 1.1 文件清单（实测行数）

| 文件 | 行数 | 角色 | 注入到 |
|---|---|---|---|
| `manifest.json` | 123 | MV3 清单，`name=智赢采集器 v2`、`version=2.11.16` | — |
| `zy-panel.js` | 1783 | Amazon **商品详情页**右侧 🍟 面板（核心） | 18 个 Amazon 站点 |
| `zy-list.js` | 285 | Amazon **列表/搜索页**卡片下方信息条 | 18 个 Amazon 站点 |
| `bridge.js` | 2963 | **ifast.top** 上架器面板 + 设置覆盖层 + 自动填表 | ifast.top / www.ifast.top |
| `background-3.js` | 781 | MV3 service worker：消息转发、跨域请求、storage、实例自愈 | 后台常驻 |
| `settings.js` / `settings.html` | 685 / 341 | 完整设置页（行为/物流/上传默认值/连接/配色） | 扩展页（`web_accessible_resources`） |

> ⚠️ 早期 `AGENTS.md` 里的行数（1725 / 265 / 2695 / 686）**已过期**（`zy-panel.js` 最近改动 2026-11-22 23:38）。以本表为准，引用行号前先 `read`。

### 1.2 注入规则（manifest.json）

| content_script | matches | run_at | 行号 |
|---|---|---|---|
| `bridge.js` | `https://www.ifast.top/*`、`https://ifast.top/*` | `document_idle` | 41-50 |
| `zy-panel.js` | Amazon 18 站点（com/de/co.uk/fr/it/es/co.jp/ca/in/com.au/nl/se/pl/com.mx/com.br/sg/ae/sa） | `document_idle` | 51-76 |
| `zy-list.js` | 同上 18 站点 | `document_idle` | 77-102 |
| background | `service_worker: background-3.js` | 常驻 | 37-39 |

- 权限 `tabs`/`storage`（6-9）；`host_permissions` 含 `127.0.0.1`/`localhost`/`:3088`、18 个 Amazon、ifast，以及宽泛的 `http://*/*`（10-36）。
- `web_accessible_resources`：`settings.html`、`settings.js`（112-122）。
- `action` **只有 `default_title`（104-106），没有 popup，后台也没有 `chrome.action.onClicked`** → 点扩展图标不会打开任何界面（已 grep 核实）。
- 防重复注入标志：`__ZYP_INJECTED__`（zy-panel:11）、`__ZYL_INJECTED__`（zy-list:7）、`__zyingBridgeV2`（bridge:55-56，版本 `v2.1.0`）。

### 1.3 页面级前置判断

- 面板只在详情页生效：pathname 匹配 `/(dp|gp\/product|gp\/aw\/d)/<10位ASIN>`（zy-panel:15-19），`asinOf()` 43-46、`siteOf()` 39-42。
- 列表页判断：`/\/s(\?|\/|$)|\?k=|\/stores\/|\/b\?|\/gp\/bestsellers/`（zy-list:74）。

---

## 2. 数据流（谁把数据给谁）

```
Amazon 商品详情页 zy-panel.js（隔离世界）
  ├ {type:'ZY_API', method, path, body}        …… 通用 ERP 调用（erp() 90-94）
  ├ {type:'ZY_PANEL'} / ZY_ACCOUNTS / ZY_BG_MULTI
  ▼
background-3.js（service worker，有 host_permissions，可绕页面 CORS/PNA）
  └ fetch http://127.0.0.1:3088/api/...        base 可由 settings.erpBase 覆盖（20-31）
       ▼
ERP（erp/server.js, 3088）
  ├ /api/zy/panel → zy-standalone.js 直连智赢数据源（标题/图/品牌/BSR/尺寸重量/BuyBox/卖家/月销/备案）
  ├ /api/zy/variants → 变体族（页面 HTML 逆向 + 数据源补价）
  ├ /api/ifast/* → ifast-client.js
  └ 本地商品库 / BG 缓存 / 运费表

Amazon 列表页：zy-list.js → {ZY_CARDS} → POST /api/zy/cards（background:257-260）
ifast 页：bridge.js
  ├ 直接 fetch ifast.top 同源接口（必须带 X-Requested-With，bridge:1883-1926）
  └ 经 background 的 LISTING_* / PORTS / PEERS / IFAST_SYNC_PUSH 等消息读写 ERP
设置页：settings.html/js → chrome.storage.local（settings/pricing/…）+ 直接 fetch /api/rates、/api/health
```

**为什么必须绕 service worker**：内容脚本 fetch `127.0.0.1:3088` 受页面 CORS / Private Network Access 限制会超时（background:1-6、zy-panel:5、settings.js:90-91 注释均有实测记录）。`ZY_API` 只转发 `/api/*`、不做其它校验（background:570-579）。

> **与任务简报不一致的核实结果**：扩展里**没有任何地方**调用 ERP 的 `/api/zying-proxy`（5 个 js 全量 grep 零命中）。`/api/zying-proxy` 是 **DSH 插件**的同源代理（`$PKG\01-dsh-plugin\index.js:68、103`），给 DSH 界面（`dsh-app://`）用；浏览器扩展走 **service worker + host_permissions 直连 3088**。不要把代理当扩展链路。

---

## 3. 各文件职责与关键区块

### 3.1 `zy-panel.js`（商品详情页面板，1783 行）

| 区块 | 行号 | 说明 |
|---|---|---|
| 设计注释 / 常量 / BG 字典 | 1-8、21-37 | 分区 ①②④⑤⑦、数据来源；`SITES/CC/CUR/FX_DEF`（US 7.1、DE 7.38、UK 8.83）；BG 5 态 |
| `send()` / `erp()` / 失效自愈 | 56-94 | `erp()` = 面板唯一 ERP 入口；`Extension context invalidated` → 提示并 1.5s 后自动 reload |
| 设置存取 | 97-136 | `STORE_KEY='zyp_v3_settings'`、`loadSettings/saveSettings/adjOf` |
| Shadow DOM / 状态 / 头部 | 138-262 | host `top:88px;right:16px`；`S.collapsed:true`（默认 🍟 圆球）；刷新/⚙/–/✕；`setWrap` iframe 是**未被显示的遗留代码** |
| 算价函数 | 264-299 | `taxPctOf/effTaxPct/kOf/bearBase/bearRow` |
| 底部状态 / 进站体检 | 303-336、508-521 | `footSet` 两行状态；`localeAutoCheck` 不符就 `localeFixLocal`（直接 POST 亚马逊 `address-change` + 写 `i18n-prefs` cookie）后 reload |
| `loadAll()` | 338-472 | **加载总编排**：商品/ifast/账号/tokens/汇率 → 上架记录 → 站点数据 → 变体 → BG 列 |
| 初始价锁定 / 变体 BG | 434-460 | `applyInitPriceLocks()`（详见 `amazon-panel.md`）；`/api/bg/lookup` 最多 60 个 |
| `loadFreight()` / `loadBg()` | 474-498 | 按重量查运价（固定渠道「云途普货」）；全部授权店铺 BG（`ZY_BG_MULTI`） |
| `pageFacts()` / `pageVariants()` | 546-645 | 页面 DOM 抓重量/尺寸/价格；脚本 JSON `dimensionValuesDisplayData` 兜底变体 |
| 面板内置设置视图 | 668-1042 | `openSettings/settingsHtml/bindSettings`（写 `zyp_v3_settings`） |
| 拖动/缩放/记忆 | 1045-1132 | `SET.panelBox`；双击标题复位 |
| `render()` | 1146-1434 | ① 商品信息 → ② 变体/算价表 → ④ 上架店铺 → 🏪 店铺管理 → ⑦ ifast；`rowCalc()` 行级算价 1226-1241 |
| 变体表格 / `bind()` | 1281-1331、1436-1692 | 表头/行模板（当前变体蓝色标在 1295）；交互绑定（初始价锁定 1555-1571、初始± 联动 1584-1617） |
| `loginZyAccount()` / `upload()` | 1695-1774 | 智赢账号登录（含短信）；按选中变体 × 选中店铺站点 POST `/api/ifast/add` |
| 启动 | 1776-1783 | `loadSettings → loadAll+loadBg`；每 1.5s 检测 URL 变化重载 |

### 3.2 `zy-list.js`（列表页条，285 行）

| 区块 | 行号 | 说明 |
|---|---|---|
| 头注释/防重 | 1-8 | 每张卡片下一行「BG + 品牌/BuyBox/类目排名/大类/上架天数/月销」 |
| 站点 / BG 字典 | 10-23 | BG 语义同上（错误文案为「失败」） |
| 卡片配色 | 26-68 | AMZ 蓝 `#1677ff` / FBA 红 `#cf1322` / FBM 绿 `#237804`，可被 `settings.zylColors` 覆盖 |
| 缓存 | 111-124 | `sessionStorage['zyl2_<site>_<asin>']`，TTL 10 分钟 |
| `renderBlock()` | 127-149 | 一行 chips：BG 状态/配送类型/品牌/价格/排名/上架天数/月销/备案 |
| `cardRoots()` / 触发 | 155-195 | 4 组选择器找卡片；scroll + DOMContentLoaded + 2s 轮询 + MutationObserver |
| `run()` | 197-238 | 最多 200 张（154）；未缓存**每批 12 个**发 `ZY_CARDS`，批间隔 250ms |
| `blockOf()` | 240-251 | 在标题/价格行后插入 `.zyl-b`，先显示「检测中…」 |
| 启动 | 259-285 | 读配色 + 订阅 `chrome.storage.onChanged`（改色立即生效，不用刷新） |

### 3.3 `bridge.js`（ifast 上架器，2963 行）

| 区块 | 行号 | 说明 |
|---|---|---|
| 头注释 / ifast 登录页自动填表 | 1-12、15-41 | 三种数据暴露方式；读 `sessionStorage.zyp_ifast_switch`（换账号用，3 分钟过期） |
| `load()` / `publish()` / 页面索取 | 66-128 | 拉 `/api/listing/records`（经 `LISTING_RECORDS`），发布 `#zying-listing-records` + `postMessage`；`zying-get-records`/`zying-mark-listed` 回写 |
| 面板 + 浮标 | 131-409 | `build()` 331-409：刷新/同步商品/设置/切换账号/搜 ASIN；**默认收起成浮标**（402）；1.5s/9s/20s/45s 四次 `refreshShop()` |
| 消息锁 / 位置 / 渲染 | 410-616 | `setMsg/setMsgLock`（防结果被进度行冲掉）；`bridgeGeom` 记忆；`render()` 记录列表 |
| 设置覆盖层 / 切换 ifast 账号 | 637-793 | 面板内设置（`autoSubmit`/`apiDirect`/ERP 地址/默认库存备货…）写 `settings`；「打开完整设置页」走 `OPEN_SETTINGS`；账号密码 → 退出 → `/login` 自动登录 |
| 自动提交·提示·填表·API 契约 | 794-1562 | 找「保存」等响应、抓 layui 提示与 XHR；`MV`/`checkVariantsAcrossPages` 1311/`fillMultiForm` 1365/`fillForm` 1479；API 直连字段契约（注释即权威）1540-1562 |
| 局域网端口 / 同步商品 | 1563-1882 | `PORTS`/`PEERS`（端口由 ERP 真正监听）；`IFAST_SYNC_PUSH` 优先，失败刷新 cookie 再试 |
| `IFAPI` | 1883-2030 | ifast 同源 fetch：**必须带 `X-Requested-With: XMLHttpRequest`**（1895）；`listingOf` 1941、`probeSession` 1991 |
| 提交回读 / `doFillFlow` | 2031-2740 | `apiReport` 2039、`apiTryTask` 2070、提交前探活 2307、提交后回读 2337-2383；取任务 → `LISTING_CHECK` 跨店预检 2459-2517 → API 优先 2521-2533 → 回退 DOM |
| onMessage 监听器 | 2745-2798 | `SETTINGS_CHANGED`/`RUN_FILL`/`PING_PAGE`/`IFAST_LISTING`/`SHOP_REFRESH_NOW`；注释明确「一个上下文只允许一个监听器」 |
| 店铺识别 | 2809-2903 | `detectShop`（`item_list.json` 的 `createUserName/userId`）→ `recordShop`（写 `shops/currentShop` + `SHOP_REGISTER`）→ `refreshShop` |
| 调试出口 | 2919-2962 | `window.__zvBridge`：`ver='2.7.5'`、`fill/ifastListing/sessionProbe/state/submit` |

### 3.4 `background-3.js`（service worker，781 行）

| 区块 | 行号 | 说明 |
|---|---|---|
| `API_BASE` / `apiBase` / `api` | 10、20-50 | 默认 `http://127.0.0.1:3088`；读 `settings.erpBase`（5s 缓存）；统一 JSON fetch |
| `currentFilter()` / 多店铺 `currentShop` | 53-94 | 读 `filter`（采集过滤条件）；读 `currentShop/shops`，上传/取任务/查重带店铺 |
| `blockInfo()` | 96-123 | 后端拦截结构 → 一句人话（三处界面共用） |
| `sendToTab()` | 125-149 | **带超时**的 `tabs.sendMessage`（实例失活会永久挂住，实测坑） |
| `reviveIfastTabs()` | 151-187 | 安装/更新/启动后 `PING_PAGE`，只刷新真正失效的 `item_list.html` |
| 主 `onMessage` | 189-781 | 43 个消息类型（见 §4） |
| ZY_* 面板族 | 202-289 | `ZY_PANEL/ZY_STATUS/ZY_LOGIN/ZY_SMS/ZY_TOKENS*/ZY_CARDS/ZY_BG_MULTI/ZY_BG/ZY_EXPIRY/ZY_ACCOUNTS` |
| 采集/上架记录 | 291-486 | `STATUS/PUSH/LISTING_UPLOAD/CLAIMS_CHECK/LISTING_*/LISTING_CHECK/LISTING_BLOCKING` |
| ifast 桥接 | 488-642 | `IFAST_LISTING/SHOP_*/IFAST_COOKIE_REFRESH/ZY_API/IFAST_SYNC_PUSH/LISTING_FILL_RESULT/FILL_TASK_NOW`（失活自动刷新后重试 8 次） |
| 汇率/广播/设置页/物流报价 | 656-773 | `RATES`（1h 缓存）、`SETTINGS_CHANGED`、`OPEN_SETTINGS`（复用或新开标签）、`SHOP_REFRESH`；`LOGISTICS_QUOTE` 先用导入的 `freightQuote` 表（100g 向上取档、UK→GB 别名），没有再回落 `/api/zy/freight/quote` |

### 3.5 `settings.html` / `settings.js`（完整设置页）

| 分区（settings.html） | 行号 | 对应 `settings.js` |
|---|---|---|
| 💰 算价（利润率/实时汇率） | 95-134 | `DEF` 15-31、`render` 54-74、`save` 384-416 |
| 🚚 物流成本（导入报价表） | 135-174 | FQ 解析 89-335（xlsx/zip 解压 177-255） |
| 📥 采集行为 | 175-199 | `autoVariantFetch/rankFreshMin/maxRows` |
| 📤 上传/上架默认值 | 200-265 | `defaultStock/defaultLeadDays/autoSubmit/apiDirect/…` |
| 🔌 连接与维护 | 266-304 | `fetchRates` 360-375、`save` 384-416；原文注明设置存 `settings`/`pricing` 两键（300-301） |
| 🎨 列表页配色 | 305-337 | `renderColors` 417-434（写 `settings.zylColors`，列表页实时变色） |

> **设置页与面板是两套设置**：设置页读写 `settings`/`pricing`（bridge、background、zy-list 消费）；面板 ⚙ 打开的是面板内置设置，写 `zyp_v3_settings`（zy-panel:97、668-1042），两者互不同步。

---

## 4. 消息协议

### 4.1 `chrome.runtime` 消息（background 共处理 43 种，189-781）

| 方向 | 类型 | 发送处 | 处理处 | 作用 |
|---|---|---|---|---|
| 面板→后台 | `ZY_PANEL` / `ZY_API` / `ZY_ACCOUNTS` / `ZY_BG_MULTI` | zy-panel:348 / 92 / 350,488 / 491 | bg:204-213 / 570-579 / 285-289 / 262-271 | 商品主体 / 通用 `/api/*` 转发 / 店铺列表 / 多店铺 BG |
| 列表页→后台 | `ZY_CARDS` | zy-list:219 | bg:257-260 | 卡片批量数据 |
| 后台→ifast 页 | `SETTINGS_CHANGED` / `RUN_FILL` / `PING_PAGE` / `IFAST_LISTING` / `SHOP_REFRESH_NOW` | bg:680 / 624 / 165 / 508 / 714 | bridge:2747 / 2752 / 2778 / 2785 / 2791 | 设置刷新 / 驱动填表（立即回执）/ 存活探针 / 回读 ifast / 识别店铺 |
| ifast 页→后台 | `LISTING_RECORDS` `LISTING_STATUS` `LISTING_FILL_TASKS` `LISTING_CHECK` `LISTING_FILL_RESULT` `LISTING_BLOCKING` `LISTING_UPLOAD` | bridge:79/124/2437/2460/2041,2630,2679/2716 | bg:387-486、415-472、586-591 | 上架记录/任务/查重/结果回写 |
| ifast 页→后台 | `PORTS` `PEERS` `IFAST_SYNC_PUSH` `IFAST_COOKIE_REFRESH` `SHOP_REGISTER` `OPEN_SETTINGS` | bridge:1570/1642/1859/1865/2870/678 | bg:350-375、580-585、531-545、689-702 | 局域网端口/设备、同步商品、店铺注册、开设置页 |
| 设置页→后台 | `SETTINGS_CHANGED` `SHOP_REFRESH` `LISTING_BLOCKING` | settings.js:409,442,517 / 574 / 627,630 | bg:673-685、708-722、476-486 | 广播设置、检测登录、拦截总开关 |
| 其它（本目录外调用方） | `FILL_TASK_NOW` `REVIVE_IFAST_TABS` `RATES` `LOGISTICS_QUOTE` `PING` `STATUS` `PUSH` | 采集器/弹窗/设置页 | bg:598-642、647-654、657-667、724-773、194-200、291-297、299-311 | 派发填表、刷 ifast 页、汇率、物流报价、健康、采集入库 |

**已核实的遗留/无效路径**（别误以为在工作）：
- `settings.js` 发的 `FREIGHT_QUOTE_CHANGED`（286、330、499）在 background **没有处理分支**，落到「未知消息类型」。
- background 把 `SETTINGS_CHANGED` 转发给 Amazon 标签页（676-681），但 `zy-panel.js`/`zy-list.js` **都没有 `chrome.runtime.onMessage` 监听器** → 只有 ifast 页 bridge 响应。

### 4.2 `window.postMessage`（bridge 暴露给 ifast 页面本身）

| 消息 | 方向 | 行号 |
|---|---|---|
| `{source:'zying-collector-v2', type:'listing-records', records, stats}` | bridge → 页面 | 110 |
| `{type:'zying-get-records'}` / `{type:'zying-mark-listed', ids}` | 页面 → bridge | 115-120 / 119,122-128 |
| DOM 数据块 `#zying-listing-records`（`<script type="application/json">`） | bridge → 页面 | 87-108 |

---

## 5. `chrome.storage.local` 键

| 键 | 写入 / 读取 | 内容 |
|---|---|---|
| `zyp_v3_settings` | zy-panel:132 / 109 | **面板设置**：`shopId, stock, leadDays, autoUpload, adjBySite, taxBySite, taxKMode, taxLock, taxSite, manualBearByAsin, initPriceByAsin, initAdj, panelBox, localeBySite, colors, site, channel, useLiveFx` |
| `settings` | settings.js:406,440,515；bridge:733 / settings.js:43、bridge:639、bg:25、zy-list:30 | 行为默认值（`DEF`，settings.js:15-31）：`autoVariantFetch, rankFreshMin, maxRows, logisticsPick, defaultWeightKg, defaultScope, defaultFillMode, defaultStock, defaultLeadDays, defaultFollowPreset, autoSubmit, apiDirect, erpBase, zylColors` |
| `pricing` | settings.js:406,515 / 43-46 | 算价：`margin, net{}, fx{}, adj{}, useLiveFx` |
| `pricingRates` | settings.js:368 / 47-48 | `/api/rates` 快照 `{at, base, date, source, rates}` |
| `freightQuote` | settings.js:284,328,497 / 49、bg:739 | 导入的物流报价表 `{source, importedAt, channel, rates:{GB:{'200':价,…}}}` |
| `filter` | （本目录外） / bg:55 | 采集过滤条件 canonical JSON |
| `currentShop` / `shops` | bridge:2864,2886；settings.js:586,600,644 / bridge:2834,settings.js:596,bg:77 | ifast 店铺识别（`shops` 键=账号名，值 `{userId,alias,countries,sellingGroups,firstSeen,lastSeen,listedCount}`） |
| `rowdata` / `pendingUploads` / `bench` | settings.js:530,537,674 / 377,527,534,664 | 采集器本地填写数据/待上传队列/基准数据（清空用） |
| `bridgePoopPos` / `bridgeGeom` | bridge:233,465 / 310,468 | ifast 上架器浮标位置 / 面板几何 |
| `sessionStorage` / `localStorage` 杂项 | zy-list:123、zy-panel:330,1030 / 115、330、1021 | 列表卡片缓存 `zyl2_<site>_<asin>`（TTL 10 分钟）、站点切换去重 `zyp_locfix_*`、ifast 账号名回填 `zyp_ifast_user` |
| `sessionStorage.zyp_ifast_switch` | 切换账号处 / bridge:19-24 | ifast `/login` 自动填表凭据，3 分钟过期、用完即删 |

---

## 6. 面板 → ERP 接口对照表（从代码 grep，非猜测）

面板有两种调用方式：`erp(method, path)`（zy-panel:90-94）与专用消息。「调用处」为面板代码行号。

| # | 方法 + 路径 | 调用处 | 触发/用途 |
|---|---|---|---|
| 1 | `POST /api/zy/panel` | 348（经 `ZY_PANEL`） | 商品主体：标题/主图/品牌/BSR/尺寸重量/BuyBox/FBA/卖家/跟卖数/月销/备案 |
| 2 | `GET /api/ifast/status` | 349 | ifast 登录态、跟卖方案、站点列表 |
| 3 | `GET /api/zy/tokens` | 351 | 智赢多账号列表 + 当前账号 |
| 4 | `GET /api/rates` | 352、685、883 | 实时汇率（`useLiveFx` 时同步到行汇率） |
| 5 | `GET /api/listing/check?asin=&site=` | 392 | ④ 店铺「✅已上架/未上架」 |
| 6 | `GET /api/zy/asin-sites?asin=&sites=` | 397 | ④ 每店铺大类排名 / AMZ-FBA-FBM / 价格 |
| 7 | `POST /api/zy/variants` | 406 | 变体族（优先；失败回退页面解析 613-645） |
| 8 | `GET /api/bg/lookup?site=&asins=` | 456 | 变体表格 BG 列（最多 60 个） |
| 9 | `GET /api/zy/freight/quote?country=&weight=&channel=` | 477、813、965 | 运费（渠道固定「云途普货」） |
| 10 | `GET /api/zy/freight/channels[?refresh=1]` | 682、897 | 物流渠道列表（设置视图） |
| 11 | `POST /api/zy/locale/fix` | 871、1482 | 切站点后同步 ERP 侧邮编/货币 |
| 12 | `GET /api/zy/accounts` | 350、488（经 `ZY_ACCOUNTS`） | 授权亚马逊店铺（abbr 决定站点） |
| 13 | `POST /api/bg/probe-multi` | 491（经 `ZY_BG_MULTI`） | 多店铺 BG 可售状态 |
| 14 | `POST /api/zy/tokens` | 915、923、1530、1537 | 保存智赢账号/token（含「浏览器插件」自动获取） |
| 15 | `POST /api/ifast/open-login` | 931 | 在采集浏览器(9222)打开 ifast 登录页 |
| 16 | `POST /api/ifast/cookie` | 939 | 从浏览器同步 ifast 登录态 |
| 17 | `GET /api/ifast/accounts` | 1002 | 已保存的 ifast 账号 |
| 18 | `POST /api/ifast/accounts/login` | 1009 | 用已存账号切换 ifast 登录 |
| 19 | `POST /api/ifast/accounts/delete` | 1019 | 删除已保存 ifast 账号 |
| 20 | `POST /api/ifast/login` | 1027 | ifast 账号密码登录 |
| 21 | `POST /api/zy/tokens/active` | 1441 | 切智赢账号 |
| 22 | `POST /api/zy/tokens/remove` | 1451 | 删智赢账号 |
| 23 | `GET /api/zy/freight/prices?country=&channel=&weights=` | 1656 | 行内重量改了 → 批量取各重量运费 |
| 24 | `POST /api/zy/login` | 1699、1712 | 智赢账号登录（含短信 code 二次提交） |
| 25 | `POST /api/zy/sms` | 1707 | 发短信验证码 |
| 26 | `POST /api/ifast/add` | 1760 | **上架**：`{site, sellingId, stock, leadDays, onOff, autoUpload, items[{asin,initPrice,lowerPrice,title,brand,image}], purchaseCost, logisticsCost, weightKg, margin, net, fx}` |

**数量口径**：`erp(` 直接命中 **22 个路径 / 23 个方法+路径**；加上经消息转发的 3 个（`/api/zy/panel`、`/api/zy/accounts`、`/api/bg/probe-multi`）→ **面板共触达 26 个方法+路径（25 个路径）**。
其它脚本：`background-3.js` 出现 38 个独有 `/api/*` 路径；`settings.js` 直接 fetch 仅 `/api/rates`（364）与 `/api/health`（466）；`bridge.js` 的 4 个 `/api/*` 只在注释里（真请求走消息）。**5 个 js 全量 grep 并集 = 52 个路径**。

ERP 侧实现（排障用，`erp/server.js`）：`/api/zy/panel` 16831、`/api/zy/variants` 12938、`/api/zy/asin-sites` 14257、`/api/bg/lookup` 16916、`/api/listing/check` 18587、`/api/ifast/add` 16401、`/api/zy/cards` 16589、`/api/rates` 13230。`/api/zy/panel` 返回的 `missing` 明确列出拿不到的字段：`rating/reviews/aplus/imageSet/fullCategoryPath`（server.js:16901）。

---

## 7. 改代码指南（常见改动落点）

| 需求 | 落点 | 注意 |
|---|---|---|
| 面板加一个分区 | `render()` 1146-1434，插在 1431 `bd.innerHTML=html` 之前；事件加在 `bind()` 1436 | 渲染是整块 `innerHTML` 替换 + 重绑，别持有旧 DOM 引用 |
| 改承受价公式 | **三处必须同步**：`bearBase()` 284-291、`rowCalc()` 1226-1241、`uploadBearPrice()` 1736-1749 | 上架数值必须与面板显示一致（1724-1734 注释） |
| 改初始价口径 | 显示 `v.price + ipAdj`（1291-1292、1732-1735）；锁定 434-445、1555-1571 | 锁的是「显示值」，恢复时要减 `ipAdj`（442） |
| 改税率/K/汇率 | `taxPctOf` 266-271、`effTaxPct` 272-276、`kOf` 278-283、`SET.taxBySite/taxLock` 100、设置视图 721-730 | UI 文案叫「税率%」，实际是**到手比例 K**（0.68/0.85；>1 按旧百分比兼容） |
| 改 BG 语义/颜色 | `BG` 31-37、`bgTag` 501-504、表格 BG 1320-1325、④ 店铺 BG 1338-1379 | 列表页有第二套 `BG` 文案（zy-list:17-23） |
| 改上架 payload/加字段 | `upload()` 1750-1774；后端 `/api/ifast/add`（server.js:16401） | 站点来自**选中店铺的 abbr**（1753），不是设置里的默认站点 |
| 加/改自动填表流程 | `doFillFlowInner` 2425-2740；DOM 填表 1154-1560；API 直连 1883-2400 | **回退纪律**：只有「提交请求还没发出」的失败才允许回退 DOM（1558-1560） |
| 加 ifast 接口调用 | `IFAPI.get/post` 1883-1926，必须带 `X-Requested-With` | 不带会被服务端当页面请求 → HTTP200 返回 404 HTML（1885-1894） |
| 加后台消息 | `background-3.js` 主监听器 189-781 内加分支 | 一个上下文只允许一个 `onMessage` 监听器（bridge:2772-2777、2905-2910） |
| 新增 ERP 调用 | 面板 `erp(method, path, body)`（90-94） | 走 `ZY_API`，无需改 background；路径必须以 `/api/` 开头 |
| 改列表页卡片 | `renderBlock()` 127-149；新字段先确认 `/api/zy/cards` 返回（server.js:16589-16680） | 缓存 10 分钟后才重取；`processed` 防重复（152、207） |
| 新增设置项 | 面板：`SET` 98-106 + `settingsHtml` 696-804 + `bindSettings` 806-1042 + `saveSettings` 132；设置页：`DEF` 15-31 + `render` 54-74 + `save` 384-416 | 两套键不同，别写错 |

---

## 8. 生效步骤与排障（必须照做）

1. **改了扩展任何文件**：`edge://extensions` → 本扩展「重新加载」→ **刷新已打开的 Amazon / ifast 页面**。
   - 不刷新会撞 `Extension context invalidated`（面板 56-71 自动 reload；bridge 只提示按 F5，42-54）。
   - 后台会自愈：`reviveIfastTabs` 先 `PING_PAGE`，只刷新真正失活的 `item_list.html`（151-187）。
2. **改了 ERP（`erp/*.js`）**：重启 3088 进程，不需要动扩展（AGENTS.md §4）。
3. **改了 `settings.html/js`**：重新加载扩展；设置页标签重新打开或强刷（`OPEN_SETTINGS` 复用已存在标签，bg:689-702）。
4. **无构建步骤**：全部原生 JS；改完用 `ELECTRON_RUN_AS_NODE=1` + DSH 可执行文件跑 `--check` 做语法校验（AGENTS.md §2）。
5. **确认加载的是哪个实例**：商品页 `window.__ZYP_INJECTED__`；列表页 `window.__ZYL_INJECTED__`；ifast 页 `window.__zyingBridgeV2` / `window.__zvBridge.ver`（应为 `2.7.5`，bridge:2921）。
6. **面板加载不动/报错**：看底部状态（`footSet` 303-310）与 `chrome.storage.local.zyp_v3_settings`；ERP 没起时 `erp()` 返回 `{ok:false,error:'连不上本地智赢ERP…'}`（bg:33-50）。改了 `settings.erpBase` 要等 background 的 5 秒缓存（20-31）或重载扩展。

---

## 9. 未核实 / 易错点（别当真）

1. 文件行数与早期文档/任务简报里的旧数字不一致（本表按实测）；`zy-panel.js` 2026-11-22 23:38 仍在改，行号可能再漂移。
2. **`/api/zying-proxy` 不是扩展的调用链**（扩展零引用；它是 DSH 插件 index.js:68 的同源代理，服务 DSH 界面）。
3. **面板设置覆盖层 iframe（zy-panel:231-238）是死代码**：创建后没有任何地方显示；⚙ 实际打开面板内置设置视图（668）。
4. **`SETTINGS_CHANGED` 对 Amazon 页无效**：面板/列表页都没有 `onMessage` 监听器（bg:676-681 的转发只对 ifast 生效）。
5. `settings.js` 的 `FREIGHT_QUOTE_CHANGED` 无后台处理分支（已核实为空操作）。
6. `bridge.js` 的 API 直连字段契约来自代码注释（1544-1556）与真机抓包记录；**未逐条对 ifast 现行接口做回归验证**。
7. 面板「原价/现价」**不是亚马逊价**：原价 = 公式基准承受价 `c.base`，现价 = 加 ±/手填后的最终承受价 `c.now`（1313-1319），别与「初始价」列混淆（详见 `amazon-panel.md`）。
8. 税率字段是「到手比例 K」而非百分比：`taxBySite` 默认 UK/DE/ES/IT/FR `0.68`、AU `0.85`（zy-panel:100、122），UI 文案与内部语义不一致（100、729 注释）。

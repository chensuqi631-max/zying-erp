# 搞薯条（Zying ERP）数据字典 / 库表结构

> **面向**：需要读写这些数据的 AI Agent。**只写核实过的内容**；没核到的在 §14 明说。
> **核实方式**：① `GET /api/products?limit=1` 取真实商品；② Node（`ELECTRON_RUN_AS_NODE=1` + `--max-old-space-size=4096`）解析 `products.json` 统计字段覆盖；③ 在 `erp/server.js` 里逐字段搜写入点。
> **核实时间**：2026-11-22 23:55–23:59，数据目录 `C:\Users\www\.zying-erp\data\`（`ZYING_DATA` 指向，`server.js:21`）。
> **数据现状**：`products.json` 4106 条（uk 3659 / de 443 / fr 4；`source` = `http-links` 4103 + `direct-collect` 3）。
> **行号约定**：`server.js:1234` = `$PKG\01-dsh-plugin\erp\server.js`；`ifast-client.js:80` 等同目录模块。

## 0. 实体总览

没有数据库，全是 JSON/文本；**单个 Node 进程（3088）独占写入**，内存为权威、磁盘最多落后 5 秒（`server.js:39`、`:41`）。

| # | 文件 / 目录 | 实测大小 | 一句话用途 | 写入方 |
|---|---|---|---|---|
| 1 | `products.json` | 18.9 MB | 商品库（采集池），主键 `asin@site` | 各采集链路 / 补采 / BG / 可售分类 / ifast 回写 |
| 2 | `listing-records.json` | 32 KB | 上架台账（一条 = 一次上架任务，含定价与上传流水） | 插件上报、ifast 直连、ifast 同步 |
| 3 | `listing-claims.json` | 7.9 KB | 跨店占位凭证（防重复上架判决证据） | `/api/claims/commit`、ifast 同步、从台账重建 |
| 4 | `selection-archive.json` | 21 KB | 选品归档（批次 + 条目快照 + 标签） | 上架成功自动归档、手动归档、ifast 同步 |
| 5 | `collect-reports.json` | 181 KB | 采集报告（明细/失败/字段完整度） | `saveCollectReport()` |
| 6 | `notify.json` | 6 KB | 站内通知（飞书/企微模拟） | `pushNotify()` |
| 7 | `zy-tokens.json` | 575 B | 智赢数据源多账号 token 仓库 | `zy-standalone.js`、`/api/zy/token*` |
| 8 | `zy-token.json` | 206 B | 旧版单 token 文件（迁移源 + 兼容镜像） | `zy-standalone.js` |
| 9 | `ifast-accounts.json` | 244 B | ifast.top 账号清单（密码 AES-256-GCM 密文） | `ifast-client.js` |
| 10 | `.ifast-acct.key` | 32 B | 上述密文的 AES 密钥（裸二进制） | 首次使用时自动生成 |
| 11 | `ifast-cookie.json` | 4.8 KB | ifast 登录 Cookie（`shiroCookie`） | `saveCookie()` / 浏览器同步 |
| 12 | `shops.json` | 845 B | 店铺登记 + 当前店铺 + 重复上架拦截开关 | `/api/shop/*` |
| 13 | `rates.json` | 11 KB | 汇率缓存（1 外币 = X CNY，含 90 天历史） | `/api/rates` GET/POST |
| 14 | `zy-freight-surcharge.json` | 98 B | 运费渠道附加费（元/票，可细分到国家） | `/api/zy/freight/surcharge` |
| 15 | `machine.json` | 99 B | 本机设备 ID/名（跨设备台账同步用） | 首次启动自动生成 |
| 16 | `license.key` | 279 B | 授权凭证（Ed25519 签名，绑定机器指纹） | 授权方签发、人工放置 |
| 17 | `requests.log` | 250 KB | 商品接口请求追踪（JSON Lines，>2 MB 清空） | 请求中间件 |
| 18 | `server.log` | 1.3 KB | 进程生死记录（START/EXIT/SIGNAL） | `__lifeLog()` |
| 19 | `crash.log` | 906 B | 未捕获异常 / 未处理拒绝（含栈） | `__logCrash()` |
| 20 | `link-jobs/` | 空（0 文件） | 多链接采集断点任务 `job-*.json` | `link-jobs.js` JobStore |
| 21 | `backups/` | 约 220 MB | 写盘前轮转备份 `原名.时间戳.bak` | `writeFileNow()` / `rotateBackups()` |

同源但本次不展开（字段**未核实**）：`claims.json`（草稿箱）、`ifast-items.json`（ifast 在架快照）、`peer-data.json`（跨设备同步缓存）、`tax-rates.json`、`zy-logins.json`+`.zy-logins.key`（智赢账号密码，机制同 ifast 账号）。

## 1. 落盘机制（读之前必须知道）

- `load(name, def)`：读之前先 `flushProducts()` 把攒批写掉，避免读到旧文件（`server.js:344-348`、`:355-361`）。
- `save(name, data, force)`：**只有 `products.json` 攒批 5 秒**（`SAVE_DEBOUNCE_MS`，`:41`、`:388-400`）；其它小文件立即写（`:388-391`）。
- 每次写盘都是**整份快照**：`JSON.stringify` 整个数组/对象 → tmp + rename 原子替换（`:110-114`），覆盖前备份（大文件按 10 分钟最小间隔、最多留 2 份；小文件最近 3 份 + 14 天每天 1 份，`:57-117`）。
- `products.json` 禁止被意外写空，`save()` 里硬拦（`:379-386`），只有显式 `force=true`（一键清空）才允许。
- 退出/收到 SIGINT 时强刷（`:404-408`、`:21148-21158`）。

## 2. `products.json` —— 商品库（核心）

**用途**：采集到的商品池；一条 = 一个 `ASIN @ 站点`（主键 `asin@site`，不是 ASIN 单键，`server.js:4283-4286`、`:629`）。
**由谁写**：`hcSaveAsins()`（HTTP 直采/多链接/品牌）、各 CDP 链路、`mergeZyApiRecord()`（智赢 API）、`applyRankFields()`（排名/类目/变体唯一收口，22 个入库入口共用，`:3920-3924`）、`runPostCollect()`（BG→分类→站点数据，`:4477+`）、`/api/zy/enrich-filtered`、`/api/ifast/sync`。
**注意**：字段覆盖**不均匀**（同快照内 `siteStats` 3714 条、`sellState` 459 条、`ifastListed` 0 条），必须按"字段可能不存在"处理。

### 2.1 标识 / 站点 / 来源

| 字段 | 类型 | 含义 / 写入点 |
|---|---|---|
| `asin` / `site` | string(10) / string | ASIN / 站点小写（`uk/de/fr/it/es/au`）；入库 `:4297`；GB→uk 映射 `siteOfAbbrCode()` `:4426-4430` |
| `source` | string | 采集方式：`http-collect`/`http-shop`/`http-brand`/`http-links`/`direct-collect`/`real-collect`/`cdp-shop-list`/`cdp-list-direct`/`cdp-list-filtered`/`cdp-follow-shop`/`cdp-panel`/`category-search`/`site-bulk`/`category-menu`/`dp-brand`/`cdp-brand`/`brand-batch`（`:2913,4801,4836,4948,7021,7373,10668,11171,15421,15526,15580,15638,15688,15757,17244,17634`） |
| `createdAt` | string | 首次入库（**UTC** `YYYY-MM-DD HH:mm:ss`，`now()` 基于 `toISOString()`，`:2347`），`:4297` |
| `collectedAt` / `lastSeenAt` | string | 最近采集到 / 最近在结果里出现：`:4315-4316`、`:15376` |
| `lastRunId` | string | 本轮采集 `run-xxx`，供"查看本轮商品"：`:4317-4318`、`:14820` |

### 2.2 标题 / 品牌 / 类目

| 字段 | 类型 | 含义 / 写入点 |
|---|---|---|
| `title` / `mainImage`(`image`) / `url` | string | 标题/主图/商品页：`:4308`、`:4332-4335`、`productUrl()` `:11729` |
| `brand` / `manufacturer` | string | 品牌 / 制造商：API `:3976-3977`，面板 `:2809` |
| `brandHasRecord` / `brandStatus` | bool / string | 品牌备案：true→`brandStatus='registered'`：`:4070-4076` |
| `brandSources` / `trademarkCount` | string[]≤10 / number | 商标来源（`ISTM`、`CATM`…）/ 商标数：`:4074`、`:4103`、`:2817` |
| `cat1` / `cat2` / `catPath` / `catSrc` | string | 大类 / 二级类目 / 路径文本 / 来源（`panel` 面板兜底、`bc` 面包屑）：`fillCatFromPanel()` `:3938-3951` |
| `bulletPoints` / `color` / `variantSize` | string[]≤8 / string | 五点 / 颜色 / 尺寸（变体分族原料）：`:4062-4065`、`:4055-4056`、`:3056-3090` |

### 2.3 价格 / 配送 / 卖家 / 跟卖（三态最集中）

| 字段 | 类型 | 含义 / 写入点 |
|---|---|---|
| `price` / `currency` | number\|null / string | 站点本币价（取 BuyBox 卖家 Listing）/ ISO 币种：`:4304-4307`（HTTP）、`:4454-4455`、`:4468` |
| `fulfill` / `shipByAmazon` | `FBA`\|`FBM`\|null / bool\|null | 配送方式 / 是否亚马逊配送：`:4024`、`:4448`、`:4465`、`:4029` |
| `amazonSell` | bool\|null | 是否有亚马逊自营跟卖（`offers[].shipsFrom` 含 amazon）：`:4449`、`:4470`、`:14688` |
| `sellerId` / `mainSeller` / `sellerCount` | string\|null / string\|null / number\|null | 主卖家 ID（`A2Q3...`）/ 卖家名 / 跟卖数：`:4007-4008`、`:4013`、`:4450-4451`、`:14686` |
| `followCount` | number\|null | **卡片展示用跟卖数**，与 `sellerCount`/`offers.length` 强制对齐：`:14684-14686` |
| `offers` | object[] | 全部报价：`{sellerId,currency,listing,shipping,isFba,buyBox,shipsFrom,prime,feedbackCount,positiveRate}`，子字段都可能 null：`:4014-4020` |
| `offersAt` | string | offers 抓取时间：`:4021` |
| `sellerCountryCode` / `sellerCountrySrc` / `chinaSeller` | string(2)\|null / string / **true\|false\|null** | 卖家国家/来源/是否大中华区；`null`=没读到国旗，**不能当"非中国"**：`:3998-4004`、三态注释 `:2810-2816`、`:5457-5463` |

### 2.4 排名（父/子严格分离，本库最容易读错）

唯一口径 `applyRankFields()`（`:3853-3924`）：父类 = 面板「店铺选品」`bsrShop`（权威）或原生 BSR ≥2 条取最大；子类 = 面板「榜单选品」`bsrCat` 或原生 BSR 中不等于父类的最小值。**父类来源缺失时 `rankParent` 一律 `null`，绝不拿子类顶**（`:3662`、`:3865-3873`）——所以约 1176 条"父类排名未采到"是设计行为。

| 字段 | 类型 | 含义 / 写入点 |
|---|---|---|
| `rankParent` / `rankParentCat` / `rankParentSrc` | number\|null / string\|null / `bsrShop`\|`bsr` | 父类（大类目）排名：`:3881-3883` |
| `rankChild` / `rankChildCat` / `rankChildSrc` | number\|null / string\|null / `bsrCat`\|`bsr` | 子类（细分类目）排名：`:3884-3886` |
| `rank` / `rankMain` / `rankMainText` | string\|null / number\|null / string\|null | 兼容旧字段，恒等于父类排名（`'#'+rankParent`）：`:3895-3897` |
| `rankParentState` / `rankChildState` | `ok`/`not_listed`/`unknown`/null | 三态：有排名 / 确实未上榜 / 没采到：`:3898-3909` |
| `bsr` | object[] | 原生排名行 `{rank,category,level:'main'\|'sub'}`：`:3986-3987`、`:2830-2833` |
| `bsrShop` / `bsrShopCat` / `bsrShopLink` | number/string | 面板店铺选品（父类原始值）：`:3988-3989` |
| `bsrCat` / `bsrCatName` / `bsrCatLink` | number/string | 面板榜单选品（子类原始值）：`:3990-3992` |
| `rankSrc` / `rankAt` | string | `zying-api` / 排名时间：`:3993-3994` |
| `rankRows` | object[]≤4 | 面板排名行审计 `{rank,category,root}`：`:3911-3918` |

`dropContaminatedBsr()`（`:3697-3720`）会把"跨页串读"的脏 BSR 整组清空（宁可 null 也不留假数据）。

### 2.5 BG（Brand Gating，按店铺分别判定）

| 字段 | 类型 | 含义 / 写入点 |
|---|---|---|
| `bgByAccount` | object | `{ "DE":{status,at,name,aid}, "GB":{...} }` —— **原始二维结果**，key 为店铺国别缩写：`:4369-4380`、`:4566-4586` |
| `bgStatus` / `bgAbbr` | string\|null | 本站点店铺优先的结论 / 对应店铺缩写；无本店数据时可能为 null：`:4574-4585`、`:14661-14681` |
| `bgAccount` / `bgAid` / `bgCheckedAt` | string/number/string | 结论店铺名 / aid / BG 检测时间（24h 缓存判据之一）：`:4379-4380`、`:4586` |
| `bgNoOwn` | bool | true = 没有本站点店铺数据（**不再借别店状态**）：`:14674-14681` |
| `bgNoShop` | bool | true = 当前账号没有该站点店铺 → 状态只是历史快照：`:14689-14694` |

`bgByAccount[x].status`：`OK` 可售 / `APPROVAL_REQUIRED` 需批准 / `NOT_ELIGIBLE` 不可售 / `ASIN_NOT_FOUND` / `ERROR`（排序权重 `:4356`、`:4418`）。实测：OK 1278、APPROVAL_REQUIRED 2542、NOT_ELIGIBLE 202、ERROR 82、ASIN_NOT_FOUND 2。

### 2.6 多站点

| 字段 | 类型 | 含义 / 写入点 |
|---|---|---|
| `siteStats` | object | `{site:{asin,site,rankParent,rankChild,bsr[],fulfill,amazonSell,sellers,sellerId,chinaSeller,brand,price,currency,at,src}}`：`applySiteStatFromRaw()` `:4434-4473`、`:14508-14513` |
| `siteStatsAt` | string | 最近写 siteStats 时间：`:4471` |
| `siteScope` / `siteScopeMode` / `siteScopeAt` | string[]≤10 / `post-collect`\|`bg-only`\|`bg+sites` / string | 卡片要渲染的站点范围：`:4664-4677`、`:14518-14526` |

⚠ 顶层 `bsr[]` 是 `{rank,category,level}`；`siteStats[x].bsr[]` 是 `{rank,cat}`（`:4447`）——**不同构**。

### 2.7 可售分类（采集后流水线产物）

流程：BG（全部可用店铺）→ 按店铺分别分类 → 只对可售店铺对应站点取数据（`:4394-4415`、`:4604-4685`）。

| 字段 | 类型 | 含义 / 写入点 |
|---|---|---|
| `sellableStoreAbbrs` | string[] | 可售店铺缩写 `['DE','ES','FR','IT','GB']`：`:4623` |
| `sellableSites` / `sellableStoreCount` | string[] / number | 可售站点 `['de','es','fr','it','uk']` / 数量：`:4624-4625` |
| `sellState` | `sellable`/`unsellable`/`unknown` | 有 OK 店铺=sellable；有 BG 但都不 OK=unsellable；无 BG 结果=unknown：`:4626` |
| `postAt` | string | 分类完成时间（**不是发布时间**）：`:4627` |

### 2.8 变体族

| 字段 | 类型 | 含义 / 写入点 |
|---|---|---|
| `variantKey` | string\|null | 族键：父 ASIN（twister 权威）/ `c:site\|brand\|标题核心` / `c2:site\|brand\|品牌主导前缀`：`computeVariantKey()` `:5246-5279` |
| `variantSrc` | string | 置信度：`twister` / `card` / `title` / `manual` / `none`：`:5256-5278` |
| `variantAttrs` / `ownVariants` | object\|null / number | 族内对比 `{color,size}`（由 `color`/`variantSize` 重算）/ 自身变体数：`:5249-5253`、`:5233-5240` |
| `variants` | number\|array\|null | 面板「变体：N 个」原始值（**非规范字段**，规范用 `variantCount`）：`:2822` |
| `variantSolo` / `variantManualKey` | bool / string | 人工拆族 / 人工并族，**优先于任何自动识别**：`:5256-5257` |
| `parentAsin` / `variantRole` / `variantCount` / `familyKind` | string / `parent`\|`child`\|`standalone`\|`none` / number / `variant`\|`sibling` | 族代表 / 角色 / 族大小 / 真变体族或同款兄弟：`rebuild-variant-groups` `:15306,15323,15333` |
| `famKey` / `famCount` | string / number | **只在 API 响应里算，不落盘**；族键 = `parentAsin \|\| asin`：`:15092-15096` |

### 2.9 上架回写（ifast 同步）

| 字段 | 类型 | 含义 / 写入点 |
|---|---|---|
| `ifastListed` | bool | 该 `asin@site` 在 ifast 在架：`:20486`（仅 `final` 且 ASIN+site 命中） |
| `ifastStoreId` / `ifastSku` / `ifastAt` | string\|null / string / string | 跟卖组 ID / SKU / 回写时间：`:20484-20488` |
| `shop` / `listedAt` | string\|null / string | 归属店铺名（ifast 账号名，null=未分类）/ 上架时间：`:20483`、`:20487` |
| `claimed*` | — | **products.json 里没有 claimed 字段**（4106 条字段清单 + 全文件无 `\.claim\w* =`）。占位凭证在 `listing-claims.json` |

### 2.10 尺寸重量 / 月销 / 详情页

| 字段 | 类型 | 含义 / 写入点 |
|---|---|---|
| `weightG` / `weight` / `weightSrc` | number / string / string | 克重 / 展示串（`1kg`、`80g`）/ 来源：`:4090-4093` |
| `dims` / `dimsUnit` / `dimsSrc` | number[3] / string / string | 包裹尺寸（数值+单位原样）：`:4094-4100` |
| `apiDimensions` / `apiDimensionsUnit` / `apiPackageDimensions` | number[] | 接口原始尺寸（**不硬塞 dims**，等人工核对）：`:4106-4115` |
| `apiAt` / `apiSrc` / `firstAvailable` / `firstAvailableSrc` | string | API 合并时间 / `zying-api` / 真实上架日期 / 来源：`:4116-4117`、`:4031-4039` |
| `monthlySales` / `salesSrc` | number\|null / string | 月销 / 来源：`:4067-4068`；面板 `:2818`（见 §13 的 0 值坑） |
| `detailOk` / `detailAt` / `detailVer` | bool / string / string | 详情页提取成功 / 时间 / 提取器版本（导出据此标"未核实"）：`:5980`、`:7989`、`:9315`、`:10493`、`:11738` |
| `aplus` / `rating` / `reviews` / `badge` / `size` / `stock` | bool/number/number/string | A+ / 评分 / 评论数 / 角标（`choice`、`bestseller`、`deal`…）/ 尺寸原文 / 库存：`:10493`、`:5967-5968`、`:2910` |

### 2.11 只在 API 响应里出现、不落盘

`GET /api/products` 返回前加工（**别去 products.json 找**）：`famKey`/`famCount`（`:15092-15096`）、`insight`（`product-insight.js` 的 `annotate()`，`:15125-15126`、`:19593`）、`bgView`（传 `shop` 时的单店视图，`:15127-15131`）、`compliance`（传 `compliance=1` 实时检测，`:15082-15085`）。`slim=1` 会裁掉 `bulletPoints/offers/insight/offerPrices/variants/images/description` 等（`:15114-15123`）。

### 2.12 真实样例（`GET /api/products?limit=1`，截断）

```json
{ "asin": "B0CM2W2QKZ", "site": "uk", "source": "direct-collect", "createdAt": "2026-11-21 17:00:53",
  "title": "UEMATU 4 Pcs Car Mud Flaps for Hyundai Tucson 2015-2020…", "brand": "UEMATU", "manufacturer": "UEMATU",
  "price": 15.08, "currency": "GBP", "fulfill": "FBM", "amazonSell": false, "sellerId": "A2Q3IK5GV9MMJI",
  "followCount": 9, "sellerCount": 9,
  "offers": [{ "sellerId": "A2Q3IK5GV9MMJI", "listing": 15.08, "isFba": false, "buyBox": true, "shipsFrom": "CN", "shipping": null }],
  "bsr": [{ "rank": 300340, "category": "Automotive", "level": "main" }, { "rank": 793, "category": "Car Mud Flaps", "level": "sub" }],
  "rankParent": 300340, "rankParentSrc": "bsrShop", "rankChild": 793, "rankChildSrc": "bsrCat",
  "rank": "#300340", "rankParentState": "ok", "rankChildState": "ok",
  "bgByAccount": { "GB": { "status": "OK", "at": "2026-11-21 17:11:11", "name": "侯凯龙-小烧包", "aid": 759142 } },
  "bgStatus": "OK", "bgAbbr": "GB", "bgCheckedAt": "2026-11-21 17:11:11",
  "sellableStoreAbbrs": ["DE","ES","FR","IT","GB"], "sellableSites": ["de","es","fr","it","uk"],
  "sellableStoreCount": 5, "sellState": "sellable", "postAt": "2026-11-21 17:00:55",
  "siteStats": { "uk": { "rankParent": 300340, "sellers": 9, "chinaSeller": null, "price": 15.08, "src": "post-collect" } },
  "siteScope": ["de","es","fr","it"], "siteScopeMode": "post-collect", "famKey": "B0CM2W2QKZ", "famCount": 1,
  "variantKey": "c:uk|uematu|uematu car mud flaps for hyundai tucson", "variantSrc": "title" }
```

## 3. `listing-records.json` —— 上架台账

**用途**：一条 = 一次上架任务（插件面板确认上传 / ifast 直连上架 / ifast 在架同步），含定价参数、上传流水、失败状态。**主键 `id = ASIN@site`**（`server.js:629`）。
**由谁写**：`POST /api/listing/records` 插件上报（`:18524-18528`）、ifast 直连上架（`:16468-16496`）、ifast 同步（`:20500-20519`）、填表/上传结果回写（`:18482`、`:18794`、`:18966`、`:19085-19116`）。

| 字段 | 类型 | 含义 |
|---|---|---|
| `id` / `asin` / `site` / `parentAsin` | string | `ASIN@site`（站点小写）/ ASIN / 站点 / 父 ASIN |
| `title` / `brand` / `mainImage` / `url` / `price` / `currency` | string\|null / number\|null | 提交时的商品快照与最终价 |
| `catPath` / `cat1` / `cat2` / `cat3` | string\|null | 类目 |
| `variant` | object | `{parentAsin,dims[],childCount,children[{asin,options,price,image,selected,url}]}`（`:641-664`） |
| `panel` | object | 面板原始值：`rank,bsrShop,bsrShopCat,bsrCat,bsrCatName,sales30d,listedAt,fulfill,seller,sellerCount,trademark,variantsCount,size,weight,productType,sizeName,colourName,rating,reviews`（`:665-675`） |
| `fill` | object | 填表参数：`initPrice`（初始价）/`bearPrice`（承受价，站点本币）/`bearBase`+`bearAdjRow`（加减前基准 + 行级加减）/`bearCny,bearCur,bearFx,bearNet,bearMargin,bearFxSrc`（算式留痕）/`purchaseCost,logisticsCost,logisticsChannel,weightKg,weightRaw,stock,leadDays,followPreset,followPresetText,followWindow,allDay,fillMode,variantParent,variantItems[],bearHand,initHand`（`:676-719`） |
| `status` / `blockedBy` / `blockedAt` / `blockCount` / `blocks[]` | `pending`/`listed`/`failed`/`blocked` + object | 上架状态；`blocked`=被重复上架拦截（**不算上架**）：`:733`、`:1050-1076` |
| `uploads` / `uploadsTotal` / `failCount` / `failReason` / `failAt` / `failFields` | object[]≤30 / number / string | 上传流水（时间/结果/原因/填失败字段），`uploadResultOf()` 以"真提交过"的那次定结果（`:723-727`、`:753-768`） |
| `fillStatus` / `fillAt` / `fillResult` / `refillAt` | — | 兼容/旧字段：`fillStatus=uploaded` 用于老数据兜底；`refillAt`=退回重填标记（`:720-722`、`:764-766`） |
| `shop` / `shopUserId` / `sellingId` | string\|null | 归属店铺（ifast 账号名，null=未分类）；**绝不由 ASIN/站点反推**（`:729-732`） |
| `source` / `collectedAt` / `savedAt` / `listedAt` / `note` | string | `amazon-panel`/`ifast-direct`/`ifast-sync`/`ext-v2`/`import` + 时间 + 备注 |

```json
[{ "id": "B0BJDNCVH4@uk", "asin": "B0BJDNCVH4", "site": "uk", "status": "listed", "brand": "Moontogo",
   "currency": "GBP", "price": null,
   "fill": { "initPrice": 14.1, "bearPrice": 13.42, "purchaseCost": 30, "logisticsCost": 20.98,
             "bearFx": 8.76, "bearNet": 0.65, "bearMargin": 0.3, "stock": 100, "leadDays": 5,
             "fillMode": "single", "variantItems": [] },
   "uploads": [], "shop": "张鑫雨", "source": "amazon-panel", "savedAt": "2026-11-22 15:10:32", "listedAt": "2026-11-22 15:10:32" }]
```

当前 13 条，全部 `listed`。

## 4. `listing-claims.json` —— 跨店占位凭证

**用途**：防重复上架判决证据（同 ASIN+同站点+同店铺已上架 → `block`；跨站点/同族 → `warn`，逻辑 `server.js:1080-1096`）。
**由谁写**：`/api/claims/commit`（`claimUpsert()`+`claimSave()`，`:20600-20618`）、ifast 同步 `claimsFromIfastRows()`（`:1440-1454`）、首次启动/重建从台账推导 `claimsFromListingRecords()`（`:1190-1220`，触发 `:1648-1652`）、`/api/claims/rebuild`、`/api/claims/override`。**保留窗口默认 180 天**（`claimFresh()` `:1130-1135`）。

| 字段 | 类型 | 含义 |
|---|---|---|
| `key` | string | `ASIN@site@storeId`（`claimKeyOf()` `:1127-1128`），唯一键 |
| `asin` / `parentAsin` / `site` / `siteId` | string\|null | 大写 ASIN / 变体族父 ASIN（同族跨店 warn 用）/ 站点 / ifast 站点 ID |
| `storeId` / `storeName` / `shop` | string\|null | ifast 店铺 ID / 店名（来自回读 `selling`，`:1117-1126`）/ 本地店铺名 |
| `machineId` / `machineName` | string | 哪台设备写的（`machine.json` 的 id/name，`:20613`） |
| `at` / `status` / `source` | string | 凭证时间（参与 180 天窗口）/ `listed`\|`failed`\|`pending` / `ext`\|`import`\|`ifast-sync` |
| `title` / `brand` / `image` | string\|null | 展示快照 |
| `overrides` | object[] | 强行上架审计 `{at,machineId,machineName,operator,reason,storeId}`：`:20622-20634` |

```json
[{ "key": "B0BJDNCVH4@uk@?", "asin": "B0BJDNCVH4", "parentAsin": null, "site": "uk", "siteId": null,
   "storeId": null, "storeName": null, "shop": "张鑫雨", "machineId": "legacy", "machineName": null,
   "at": "2026-11-22 15:10:32", "status": "listed", "source": "import",
   "title": "Moontogo Vis…", "brand": "Moontogo", "image": "https://m.media-amazon.com/images/I/41nD5cUrjWL.jpg",
   "overrides": [] }]
```

当前 13 条，全部 `listed`（与台账一一对应）。

## 5. `selection-archive.json` —— 选品归档

**用途**：只做三件事——存快照 / 检索 / 导出（`server.js:1655-1658`）。上架成功自动归档，另可手动归档商品库子集。**条目键带店铺**：`店铺|ASIN@site`，无店铺退回 `ASIN@site`（`archiveKeyOf()` `:1665`）。

| 字段 | 类型 | 含义 |
|---|---|---|
| `version` | number | 结构版本（当前 2，`:617`） |
| `batches[]` | object[] | `{batchId,name,source,live,note,createdAt,count,bySite{},byShop{},dupCount,keys[]}`；`live=true` 是常驻批次「上架归档(自动)」`listing-live`（`:1820-1834`）；最多 200 批（`:1674-1681`） |
| `items` | object | 条目 map，key=归档键；同品重复归档只 `times/listCount +1`（`:1812-1819`） |
| `tags` | object | `{ 归档键: ["标签1",…] }`，单标签 ≤12 字（`:19332-19346`） |
| `auto` / `lastArchivedAt` / `syncLog[]≤50` | object/string/object[] | 每日自动快照设置 `{enabled,hour,source,lastRunAt}`（`:588`、`:1984`）/ 最近归档时间（`:20459`）/ ifast 同步日志（`:20460-20468`） |

条目字段（`archiveItemFromListing()` `:1684-1735`）：`key,src('listing'|'products'),site,asin,shop,shopUserId,parentAsin,brand,title,catPath,url,mainImage,price,currency,sales30d,bsrShop,bsrCat,bsrCatName,rank,fulfill,rating,reviews,trademark,productType,variantCount,variantDims[],variantText,bearPrice,bearBase,bearAdjRow,bearMargin,purchaseCost,logisticsCost,weightKg,weightText,stock,leadDays,status,fillStatus,listedAt,source,collectedAt,savedAt,marginPct,firstArchivedAt,lastArchivedAt,times,firstListedAt,listCount`。商品库来源条目 `shop=null`（归「未分类」）、定价字段为 null（`:1711-1736`）。

```json
{ "batches": [{ "batchId": "listing-live", "name": "上架归档(自动)", "source": "listing", "live": true,
                "createdAt": "2026-11-22 12:57:51", "count": 13, "bySite": { "uk": 13 },
                "keys": ["全天跟卖|B0DMN5W8B4@uk", "…"] }],
  "tags": {}, "auto": { "enabled": false, "hour": 3, "source": "listing", "lastRunAt": null },
  "items": { "全天跟卖|B0DMN5W8B4@uk": { "key": "全天跟卖|B0DMN5W8B4@uk", "src": "listing", "site": "uk",
      "asin": "B0DMN5W8B4", "shop": "全天跟卖", "brand": "VETJMUA", "price": 86.16, "currency": "GBP",
      "bearPrice": 86.16, "purchaseCost": 30, "logisticsCost": 127.68, "weightKg": 1.5,
      "status": "listed", "source": "ifast-direct", "times": 1, "listCount": 1,
      "firstArchivedAt": "2026-11-22 12:57:51", "lastArchivedAt": "2026-11-22 12:57:51" } }, "version": 2 }
```

当前 1 批 / 13 条目 / 0 标签。

## 6. `collect-reports.json` —— 采集报告

**用途**：每次采集结束落一条，供「采集记录 → 查看报告」回看（`server.js:119-124`）。**只留最近 300 条**（`REPORT_MAX` `:127`），新→旧；同一次采集的摘要可合并（`saveCollectReport()` `:256-292`）。

| 字段 | 类型 | 含义 |
|---|---|---|
| `id` / `at` / `updatedAt` | string | `R-<base36时间>-<rand>` / 写入 / 合并时间（UTC，`utcNow()` `:249`） |
| `mode` / `name` / `filters` | string | `links`（多链接）/`shoplinks`/`direct` 等 / 展示名 / 过滤条件 |
| `fromUtc` / `toUtc` / `runId` | string | 采集时间窗（聚合"采集记录"用）/ 与商品 `lastRunId` 对应 |
| `summary` | object | `{links,sellers,shopProducts,brandProducts,productCount,added,updated,elapsedSec}` |
| `shops[]` / `brands[]` / `errors[]` | object[]/string[] | 每店 `{ok,name,collected,…}` / 每品牌 `{…,mixed,mismatch}`（他牌/品牌不符计数）/ 错误摘要 |
| `mixed[]` | object[] | 他牌明细分组 `{…,items[]}`（`reportBrief` 统计条数 `:328-329`） |
| `locale` / `completeness` | object\|null / object | 站点一致性快照（`:276-278`）/ 字段完整度 `{at,total,caps{list,detail,panel},fields[{k,label,grp,req,applies,have,miss,noCollector,rate,missing[]}],ok,level,softLimitPct,severe[],bad[],soft[],notWired[],text}`（`:279-283`） |
| `live` / `rebuilt` / `url` / `pluginLogin` | bool/string | 是否实时报告 / 重建过 / 入口 URL / 插件未登录提示 |

```json
[{ "id": "R-mwqqt8h2-0lok", "at": "2026-11-21 18:29:59", "mode": "links",
   "name": "多链接采集 · HTTP 直连", "filters": "站点:uk",
   "fromUtc": "2026-11-21 18:07:05", "toUtc": "2026-11-21 18:29:59",
   "summary": { "links": 24, "shopProducts": 3030, "brandProducts": 617, "productCount": 3647,
                "added": 3647, "updated": 3030, "elapsedSec": 1374 },
   "shops": [{ "ok": true, "name": "(HTTP UK)", "collected": 160 }], "errors": [],
   "brands": [], "completeness": { "level": "ok", "fields": ["…17 项…"] } }]
```

当前 25 条（links 20 / shoplinks 1 / direct 4）。

## 7. `notify.json` —— 站内通知

**用途**：飞书/企微通知的本地镜像（`pushNotify()` `server.js:11719-11725`），新→旧，**只留 50 条**。

| 字段 | 类型 | 含义 |
|---|---|---|
| `id` / `type` | string | `N-001` 递增 / 通知类型（`采集后处理完成`、`按筛选获取数据完成`、`上架记录入账`…） |
| `title` / `body` | string | 标题 / 正文 |
| `channel` / `at` / `read` | string | `wecom`（默认）/ `feishu`（type 含"调价"时）/ 时间 / 是否已读 |

```json
[{ "id": "N-021", "type": "按筛选获取数据完成", "title": "共 3647 个商品 · BG 3647 · 多站点 3645 · 失败 0",
   "body": "站点: uk", "channel": "wecom", "at": "2026-11-22 12:12:44", "read": false }]
```

当前 21 条。

## 8. 凭证类文件（只描述机制，不抄内容）

### 8.1 `zy-tokens.json` + `zy-token.json`（智赢数据源 token）

**用途**：智赢多账号 token 仓库，BG 检测可跨账号批量查（`zy-standalone.js:77-191`）。**由谁写**：`saveToken/addToken/switchToken/removeToken/markTokenResult()`（`:122-191`）、`/api/zy/token*`。

| 字段 | 类型 | 含义 |
|---|---|---|
| `activeId` / `accounts[].id` / `label` | string | 当前生效账号 / `acc1`、`acc<base36>` / 展示名 |
| `accounts[].token` | string | 智赢 token（**明文，勿外泄/勿写日志**） |
| `accounts[].savedAt` / `source` | string | 保存时间 / `manual`、`saved-login`、`password-login`、`migrated` |
| `accounts[].lastOkAt` / `lastErr` | string\|null | 最近调用成功/失败留痕 |

`zy-token.json` = 旧版单 token 文件，首次读取自动迁移成 `accounts[0]`，之后每次 `saveToken()` 仍镜像写入（`:94-104`、`:137-138`）。

```json
// zy-tokens.json（token 已打码）
{ "activeId": "accmwqn71zs", "accounts": [{ "id": "acc1", "label": "账号1",
  "token": "<已打码，长度≈200>", "savedAt": "2026-11-21T16:48:10.165Z", "source": "manual" }] }
// zy-token.json
{ "token": "<已打码>", "savedAt": "2026-11-21T16:48:10.165Z", "source": "manual" }
```

### 8.2 `ifast-accounts.json` + `.ifast-acct.key`（ifast 账号密码）

**用途**：ifast.top 账号清单，密码只存密文、登录时才解密（`ifast-client.js:79-141`）。
**机制**：AES-256-GCM，每条独立 12B IV + 16B 认证标签，密文前缀 `v1:`，格式 `v1: base64(iv|tag|ciphertext)`（`:88-102`）；密钥 = `.ifast-acct.key`（32B 随机、权限 0600、首次使用自动生成，`:82-87`）。**密钥丢失=密文无法恢复；密钥更换=旧密文全部失效。**

| 字段 | 类型 | 含义 |
|---|---|---|
| `accounts[].username` / `p` / `note` | string | ifast 账号（如 `zxy111`）/ `v1:<AES-256-GCM 密文>` / 备注 |
| `accounts[].savedAt` / `lastLoginAt` | string | 保存 / 最近登录 |
| `active` | string | 当前账号 username |

```json
{ "accounts": [{ "username": "zxy111", "p": "v1:<已打码 AES-256-GCM 密文>", "note": "",
  "savedAt": "2026-11-21T16:49:23.018Z", "lastLoginAt": "2026-11-21T16:49:23.019Z" }], "active": "zxy111" }
```

### 8.3 `ifast-cookie.json` / `license.key`

- `ifast-cookie.json`：单 Cookie `shiroCookie`（httpOnly）本地缓存，所有 ifast 直连接口靠它（`ifast-client.js:4-11`、`:26-40`）；从采集浏览器 CDP 抓取，**先验证登录态再落盘**（`:43-77`），写盘后 `chmod 0600`。字段 `cookie`（整串 `k=v; k=v`，**敏感**）、`at`（ISO）。
  ```json
  { "cookie": "<已打码，长度≈4.6KB>", "at": "2026-11-21T16:49:22.934Z" }
  ```
- `license.key`：Ed25519 签名授权，绑定机器指纹；无它则 `enforce:true` 时所有 `/api/*` 403（`license.js:4-13`、`:23-35`；`license.config.json` = `{"enforce": true, "contact": "QQ ..."}`）。格式 `base64url(payload) + '.' + base64url(签名)`，签名用随包公钥 `tools/license-pub.pem` 校验；机器指纹主用 `mg:<MachineGuid>`、保留旧 MAC 指纹作别名（`license.js:37-82`）。查找顺序 `ZYING_LICENSE` → `DATA/license.key` → 程序目录 → 上级目录（`:26-33`）。**279 字节；内容未查看（按设计不读），payload 具体字段见 §14。**

## 9. 配置 / 环境类文件

**`shops.json`**（店铺登记）：插件在上架器里登录 ifast 后上报账号名 → 后端记住"当前店铺"，台账/填表/归档按它隔离（`server.js:877-902`、`:18538-18580`）；重复上架拦截总开关也在这（跟数据走）。

| 字段 | 类型 | 含义 |
|---|---|---|
| `current` / `currentUserId` / `currentAt` | string/number/string | 当前店铺名 / ifast userId / 切换时间 |
| `items[]` | object[] | `{name,userId,sites[],groups[{id,name}],firstAt,at,atMs,seen}`；`seen`=上报次数 |
| `blocking` | object | `{enabled,at,note}`；`enabled=true` → 同 ASIN+站点已上架则拦截（默认开，`:889-901`） |

**`rates.json`**（汇率）：`/api/rates` 当日起缓存；**方向是「1 外币 = X CNY」**（源码拉 `open.er-api.com/v6/latest/CNY` 后取倒数，`:13250-13260`），供利润测算/货源比价共用（`:13189-13195`、`:13810-13818`）。
字段：`base` 恒 `CNY`、`date`（UTC 日期）、`rates{USD:6.6933,EUR:7.3376,GBP:8.7581,…}`、`source`（`open.er-api.com`/`frankfurter.app`/`内置兜底`/`manual`/`cache (过期缓存)`）、`history[]≤90`（每日 `{date,rates}`，`:13271-13273`）、`updatedAt`（ISO）。

**`zy-freight-surcharge.json`**（运费附加费）：单位**元/票**；`surchargeOf(channel,country)` 先查 `渠道@国家`，再退回 `渠道`，都没有=0（`zy-freight.js:34-48`）。默认种子 `云途普货@DE/FR/IT/ES = 40`，GB/AU 不加（`:18-29`）。

**`machine.json`**（本机设备 ID）：跨设备台账同步身份，首次启动生成（`server.js:1105-1115`），`id` 用于 claims 的 `machineId`（`:20613`），`name` 默认取 `COMPUTERNAME`；`/api/machine` 原样返回（`:20589`）。

```json
// shops.json
{ "current": "张鑫雨", "currentUserId": 50023112287472, "currentAt": "2026-11-22 12:50:57",
  "items": [{ "name": "张鑫雨", "userId": 50023112287472, "sites": ["de","fr"],
              "groups": [{ "id": "2503132426739", "name": "午夜" }],
              "firstAt": "2026-11-22 08:10:34", "at": "2026-11-22 12:50:57", "atMs": 1795351857081, "seen": 2 }],
  "blocking": { "enabled": true, "at": null, "note": "默认开启: 同 ASIN + 同站点已上架则拦截" } }
// machine.json
{ "id": "7b18544c-…-ade6e484dbc9", "name": "WANG", "at": "2026-11-21 16:13:38" }
```

## 10. 日志类文件

| 文件 | 用途 | 格式 | 写入点 |
|---|---|---|---|
| `requests.log` | 排查"前端 Failed to fetch"是否到达后端；**只记 `/api/products*` 与 `/api/debug*`** | 每行一个 JSON `{at,method,path,q,origin,ua,rid}`；>**2 MB 直接清空** | `server.js:12288-12300` |
| `server.log` | 进程生死记录 | `[UTC 时间] TAG pid=… rss=…MB heap=…MB [extra]`；TAG=`START/EXIT/SIGNAL/UNCAUGHT/UNHANDLED-REJECTION` | `__lifeLog()` `:21131-21141` |
| `crash.log` | 未捕获异常/未处理拒绝（含前 4 行栈）；EPIPE 等良性只进内存缓冲 | `[时间] TAG [code] message` + 缩进栈 | `__logCrash()` `:21108-21129` |

```
{"at":"2026-11-22 23:54:30","method":"GET","path":"/api/products","q":"?limit=1","origin":"http://127.0.0.1:3088","ua":"…","rid":"__reqTrace"}
[2026-11-22 15:28:38] START pid=15088 rss=147MB heap=33MB
[2026-11-21 17:30:18] uncaughtException EADDRINUSE listen EADDRINUSE: address already in use 127.0.0.1:3088
```

## 11. `link-jobs/` —— 多链接采集断点任务

**用途**：把"哪些单元做完了"落到 `job-*.json`，重启后继续跑、已完成店铺/品牌零导航跳过、失败单元可单独重跑（`server.js:129-137`；`link-jobs.js:3-26`）。**当前目录为空（0 文件）**——没有未完成/未清理任务；完成且被 prune 的会被清（保留最近 50 个 + 30 天内，待办/失败绝不删，`link-jobs.js:424-446`）。
**写入**：`JobStore.save()` 节流 1.2s、tmp+rename 原子写（`link-jobs.js:337-391`）；退出时 `flushAll()`（`server.js:406`）。
任务顶层字段（`newJob()` `link-jobs.js:70-103`）：`id,createdAt,updatedAt,finishedAt,status(pending|running|done|partial|failed|stopped|paused|interrupted),pauseReason(captcha|cdp-down|error),elapsedSec,round,batchSize,retry,delayMs,seq,opts{shopPages,brandPages,maxShops,maxItems,collectBrands,zip,filter},links[],sellers[],brands[],batches[],totals{links,sellers,shopsDone,brandsDone,shopProducts,brandProducts,added,brandAdded,failed},log[{t,msg}]`。
真实样例：**未核实**（目录为空，未拿到真实 job 文件）。

## 12. `backups/` —— 轮转备份

**用途**：每次覆盖前拷贝旧文件，避免坏写/误清空无法回滚；命名 `原名.YYYY-MM-DD-HH-mm-ss.bak`。策略（`server.js:29-117`）：小文件最近 3 份 + 14 天每天 1 份；>64 MB 大文件（当前即 `products.json`）备份最小间隔 10 分钟、只留 2 份。实测目录约 220 MB。

## 13. 读数据的注意事项（重要）

1. **`products.json` 很大（19 MB，历史规模 40 MB+）**：不要整读进 PowerShell；优先 `GET /api/products?limit=N&offset=M`（单页最多 **500**，`:15100-15111`），列表加 `slim=1` 裁详情字段（`:15114-15123`）；必须解析文件时用 Node + `--max-old-space-size=4096`。
2. **整份快照写盘**：每次保存都 `JSON.stringify` 整个数组（`:113`），没有增量/分片。读取拿到的是"某个完整时间点的库"，但**写入期间不要并发读同一个文件**（tmp+rename 保证不读到半截，但可能读到上一版）。
3. **磁盘最多落后内存 5 秒**：products 攒批（`SAVE_DEBOUNCE_MS=5000`，`:41`、`:395-399`）。**要权威数据走 API**（内存）；外部脚本直接读文件可能读到 5 秒前版本。
4. **并发写风险**：只有 3088 这一个 Node 进程该写这些文件。外部脚本/第二个 ERP 实例同时写 = **最后写者赢、静默丢数据**（`crash.log` 里的 `EADDRINUSE` 就是重复起服务的现场）。多设备请走 claim 的 peer 同步，不要两个实例共用一个数据目录。
5. **不要手改**：`machine.json`（设备 ID 变→跨设备台账/授权异常）、`.ifast-acct.key`（变→密码全解不开）、`license.key`（变→403）、`products.json`（整份快照，手改必坏）、`zy-tokens.json`/`ifast-cookie.json`（有时效，手改易失效）。`rates.json` 可改但走 `POST /api/rates`（会顺带更新 `date/source/updatedAt`）。
6. **"空值 vs 0 vs 未采到"三态约定**（项目硬规则）：
   - `null` / 字段不存在 = **没采到**，不是 0。典型：`rankParent=null`（无父类来源）、`chinaSeller=null`（没读到国旗，不代表"非中国"）、`offers[].shipping=null`、`bgStatus=null`（无本店数据）、`weightG` 缺失。
   - `0` = 真的是 0（如 `ownVariants:0`）。**例外坑**：`monthlySales` 在面板链路用 `parseInt(...)||0`（`:2818`），"有销量文本但解析失败"会写成 0，不能当真实销量；接口链路是"没给就不写"（`:4067-4068`）。
   - 优先读三态字段：`rankParentState`/`rankChildState`（`ok`/`not_listed`/`unknown`，`:3898-3909`）、`chinaSeller`（true/false/null，`:5457-5463`）。
   - "大排名"请用 `rankParent`（或 `rankParentOf()`），**不要**用 `max(bsr)`；父类缺失不许用 `rank`/子类排名补（`:3865-3873`）。
   - **不同构**：顶层 `bsr[]`=`{rank,category,level}`，`siteStats[x].bsr[]`=`{rank,cat}`，别写一个通用解析器假定同形。
   - **覆盖不均匀**：`siteStats` 3714 / `sellState` 459 / `ifastListed` 0 条；不能因为缺字段就判 false/0。
7. **来源优先级**：面板/智赢 API > 页面 DOM。判断可信度先看 `*Src` 字段（`rankSrc/apiSrc/weightSrc/dimsSrc/sellerCountrySrc/salesSrc/catSrc/variantSrc`）；`detailVer` 不匹配当前提取器的旧值在导出里标"(未核实)"（`:11736-11740`）。
8. **写回限制是硬编码**：`collect-reports` 300 条、`notify` 50 条、归档批次 200 / 一次归档上限 2 万条、`link-jobs` prune 50 个/30 天、`requests.log` 2 MB 清空。
9. **时间口径**：`server.js` 的 `now()` 与 `utcNow()` 都基于 `toISOString()` → **UTC**（`:2347`、`:249`），所以由 `now()` 写的 `createdAt/collectedAt/apiAt/rankAt/offersAt/bgCheckedAt/postAt/siteScopeAt` 等、`collect-reports.at`、`server.log`/`crash.log` 时间戳全是 UTC（`/api/health` 返回的时间也比本地慢 8 小时，可现场自证）；而 `link-jobs.js` 的 `stamp()` 用本地 getter（`link-jobs.js:41-46`）是**本地时间**（与其注释"同口径"不符，已核实）。`rates.updatedAt`/`zy-tokens.savedAt` 是带 Z 的 ISO；`listing-records.listedAt` 可能来自 ifast 返回值，口径未核实。混用会差 8 小时。

## 14. 未核实 / 核实到但拿不到真实样例的点

1. **products 的 ifast 回写字段**（`ifastListed/ifastStoreId/ifastSku/ifastAt`）：当前 4106 条**全部没有**（`ifastListed` 统计 0）。写入代码已核实（`server.js:20473-20491`），实际落盘样例**未核实**。
2. **详情页字段**（`rating/reviews/aplus/detailVer/detailOk/badge/size/stock/variants/images/description/searchTerms/aplusRaw`）：写入点已核实（`:5980,7989,9315,10493,2822`），但当前快照 0 条有值 → 真实值形态**未核实**。
3. **`bgNoOwn`/`bgNoShop`**：只有 `/api/zy/refresh-library` 写（`:14674-14694`），当前快照 0 条 → **现场未核实**。
4. **`insight`**：只核实到由 `product-insight.js` 的 `annotate()` 注入（`:15125-15126`、`:19593`），具体阈值/规则未逐条核实（可看 `/api/products/insight-rules`，`:14119-14125`）。
5. **归档 `batches[].byShop`**：现存批次只有 `bySite`，`byShop` 只在 `archiveNormalizeLegacy()` 重算时写（`:1792-1798`）→ 是否稳定存在**未核实**。
6. **`link-jobs/job-*.json`**：目录为空，结构按 `link-jobs.js:70-103` 给出，实际落盘**未核实**。
7. **`license.key` / `.ifast-acct.key` 内容**：按设计不读，只核实文件大小与读写代码；授权 payload 具体字段（到期日/features/aliases）**未核实**。
8. **products 的 `claimed*`**：核实结论是**不存在**（字段清单 + 全文件无赋值）；任务里的"claimed*"应理解为 `listing-claims.json` 凭证机制。
9. **旧 Demo 遗留字段**（`result/saved/real/category/tags` 等）：当前快照不存在，代码中仅少数入口仍写 `saved/real`（`:2913`、`:7021`），实际用途**未核实**。

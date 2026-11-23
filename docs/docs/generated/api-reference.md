# 搞薯条（Zying ERP）后端 API 参考 · Agent 版

> **源码**：`$PKG\01-dsh-plugin\erp\server.js`（按 LF 切分 **21,190 行**；**258 个唯一 `/api/*` 路由**，对应 273 行 `p === '/api/…'` 判定）。
> **实测环境**：2026-11-22，ERP 运行于 `http://127.0.0.1:3088`（授权有效、智赢 token 有效、5 店铺可用）。标「实测」的响应样例来自该实例；其余为读码结论。
> **行号口径**：文件工具（read/grep）行号。⚠ PowerShell `Get-Content` 因文件有孤立 `\r` 会读成 20,191 行、行号整体偏小约 1000，**不要用它的行号对代码**（实测偏差）。
> 本文覆盖 **258/258** 路由（15 组）；未逐行读到的行为在 §5 末尾标「未核实」。

## 0. 怎么自己找路由
没有框架、没有路由表：全部接口是 `opHandler`（`server.js:12258`）里 `req.on('end')` 内一条巨大 if 链。

```powershell
Select-String -Path $PKG\01-dsh-plugin\erp\server.js -Pattern "p === '/api/"
```

命中后判定顺序：静态文件（12324-12350）→ 授权闸门（12357-12378）→ 各路由 → 兜底 404 `{ error: '未知接口: <path>' }`（20961）。同一路径的 GET/POST 常分两行（如 `/api/products/goods` 13099/13106）。

## 1. 通用约定

### 1.1 地址与进程
- `const PORT = parseInt(process.argv[2] || '3088', 10)`（`server.js:23`）；启动 `node server.js 3088`。
- `HOST = process.env.ZYING_HOST || '127.0.0.1'`（27）+ `server.listen(PORT, HOST)`（21161）→ **默认只有本机能连**。
- 「局域网共享端口」复用同一 handler 监听 `0.0.0.0`（20969-21043），危险接口仍按客户端 IP 校验（20975）。

### 1.2 请求
- GET 读 query（`URL.searchParams`，12259-12260）；POST body 必须 JSON：`JSON.parse(body)` 失败**静默变 `{}`**（12264-12265）→ 缺参会报 400，而不是「JSON 语法错误」。
- 响应头恒为 `application/json; charset=utf-8`（12266）。CORS 只对白名单 Origin 回 `Access-Control-Allow-Origin`：回环 http(s)、`dsh-app://`、`file://`、`amazon.*`（12275-12285）；`OPTIONS` 直接 204（12320）。
- **GET 接口一律从 searchParams 取参**，读 body 的 `j` 恒为 `{}`（18332 注释称之为「坑 31」）。

### 1.3 返回与错误形状
- 统一 `send(code, data)` = 设 statusCode 后 `JSON.stringify`（12302-12309），**没有 envelope**，直接是 payload。
- 成功主要 200；**不少业务失败也是 200 + `{ok:false,error}`**（让前端展示原因）：`/api/bg/check` 无可用账号（15943-15946）、`/api/ifast/*`（16348 等）、`/api/bg/probe`（16030-16042 注释）。
- 参数错 400 `{error}`；不存在 404 `{error}`；忙/互斥 **409** `{error, job?}`；未授权/非本机 **403**；未捕获异常 500 `{error}`（20962-20965）。
- ⚠ `send()` 特例：`POST /api/collect/*` 且 code≥400 会顺手清「运行中」进度（12302-12306）。这解释了 `/api/collect/ingest-push` 忙时为何回 **200 `ok:false,busy`** 而非 409（19447-19451）。
- ⚠ **时间戳是 UTC**：`now()` = `new Date().toISOString().slice(0,19)`（2347），`/api/health.time`、`collectedAt/bgCheckedAt/listedAt` 等都是 UTC（实测北京时间 23:56 返回 `15:56`）。例外：`link-jobs.js:41-45` 的 `stamp()` 用 `getHours()`=本地时间（该行注释说「与 server.js 同口径」是过时的，别信）。

### 1.4 鉴权（license / 403 / 本机限制）
- 白名单只有 `/api/health`、`/api/license/status`、`/api/license/verify`（12358）。注：**`/api/license/verify` 没有处理器**（258 条里无）→ 实际调用落到 404（12358 vs 20961）。
- 其余 `/api/*`：`enforce && !valid` → **403**，body 带 `error`/`license`（enforce、reason、fingerprint、customer、expiresAt、contact、licensePath）/`howto`（12359-12367）。
- 功能位：缺 feature 时 `/api/collect/`→collect、`/api/products/export`→export、`/api/sources`→search、`/api/profit/`→profit 均 403 `本授权不含「X」功能`（12368-12376）。
- 本机限制：非回环来源访问 `/api/ports*`、`/api/browser/*`、`/api/collect/*`、`/api/claims/settings|rebuild` → 403 `该操作仅允许在 ERP 所在的那台机器上执行`（12311-12315）；另有逐接口校验（15212、18661、18671、19091、19101、19171、19353、19443）。
- 实测 `/api/license/status`：`{"enforce":true,"valid":true,"reason":"ok","customer":"客户","fingerprint":"7454E54F7EF49D70","expiresAt":null,"summary":"已授权: 客户 · 永久",…}`；字段组装见 `license.js:140-164`。

### 1.5 分页
- **`/api/products` 用 `offset`，不是 `page`**（15090-15111）。`limit` 上限 **500**（15101）；显式传 limit → `{total, returned, offset, truncated, items}`（15132）；**不传 limit** → 最多 500 条且 `truncated:true`（15105-15111）。实测：`limit=1000` → `returned=500, truncated=false`；`offset=2&limit=1` → `offset=2`。
- 其它：`/api/listing/records` limit≤1000+offset（19033-19034）；`/api/archive/items` limit≤1000+offset（19311-19312）；`/api/listing/uploads` limit≤500（18986）；`/api/collect/link-jobs` limit≤100（18329）；`/api/ifast/items` GET limit≤5000（20573）。
- 内部翻页同样要 offset：`/api/zy/enrich-filtered` 注释写明「本接口分页参数是 offset（不是 page）」（14398-14408）。

### 1.6 长任务与并发
- 采集全局忙守卫：`POST /api/collect/*`（白名单例外）在已有采集时 → 409 `已有采集正在运行 (mode=…)`（12834-12844）；`GUARD_SKIP` 见 12830-12833。守卫还会先确保 CDP 采集浏览器可用，不可用回 **503**（12847-12856）。
- 任务状态轮询：`/api/collect/direct/status`（17452）、`/api/collect/api-status`（15880）、`/api/bg/status`（16025）、`/api/bg/scan/status`（17139）、`/api/zy/enrich-status`（14705）、`/api/collect/progress`（12919）、`/api/collect/post-status`（12914）。
- 一批「HTTP 通道」采集**立即返回** `{ok:true,started:true,async:true}`，结果去 `/api/collect/async-result` 或 `/api/collect/links-result`（17499-17500、17763、17866、18048、18375、18382）。

## 2. 分组总览（258 = 15 组）

| 分组 | 范围 | 条数 | 一句话 |
|---|---|---|---|
| 健康/授权/调试/合规 | health · license · debug · ai · branddb · rules · compliance · machine · open | 12 | 体检与排障、鉴权边界 |
| 商品库 | `/api/products/*` + goods/variants | 43 | 列表/详情/导出/修复/货源 |
| 筛选 | `/api/filter/*` | 3 | 过滤 schema、计数、描述 |
| 采集 | `/api/collect/*` + collect-rules | 47 | 页面采集、直连、API 通道、进度 |
| BG 检测 | `/api/bg/*` | 12 | 按店铺判可售（Brand Gating） |
| 智赢直连 | `/api/zy/*`（不含 freight） | 26 | token/账号/取数/批量补全 |
| 货运 | `/api/zy/freight/*` | 7 | 运价、渠道、附加费 |
| ifast 上架 | `/api/ifast/*` | 13 | 登录、在架、上架、提交 |
| 上架台账 | `/api/listing/*` | 15 | 查重、填表任务、记录、导出 |
| 知产查重 | `/api/ip/*` | 13 | 商标库查询、批量、列表查重 |
| 市场/选品 | market · blueocean · select · flywheel | 9 | 只读分析 |
| 利润费率 | profit · rates · tax | 3 | 算价与汇率税率 |
| 归档 | `/api/archive/*` | 13 | 选品快照/检索/标签 |
| 浏览器 | `/api/browser/*` | 11 | 本地无头浏览器控制 |
| 店铺/认领/端口/同步/其它 | shop · claims · ports · peers · sync · notify · publish · reprice · agent · sources | 31 | 多机与运营杂项 |

## 3. 分域参考

### 3.1 健康 / 授权 / 调试 / 合规（12）
| 路由 | 方法 | 参数 · 返回要点 | 行号 |
|---|---|---|---|
| `/api/health` | GET | `{ok,time}`；实测 `{"ok":true,"time":"2026-11-22 15:56:00"}` | 12404 |
| `/api/license/status` | GET | 授权状态/指纹/功能位/summary（§1.4） | 12379 |
| `/api/debug/log` | GET / POST | POST 落 `data/client-errors.log`；GET 回最近 120 行 | 12381 / 12395 |
| `/api/debug/hc` · `/api/machine` · `/api/open` | GET · GET · GET/POST | 数据源连通性；本机 ID（实测 `{ok,id,name,at}`）；用系统浏览器开 http(s) | 16231 / 20589 / 13706 |
| `/api/ai/config` · `/api/ai/chat` | GET/POST · POST | AI 配置；`{messages:[…]}`→`{content}`，45s 超时、重连 ≤4 次（12807-12808） | 12793 / 12805 |
| `/api/branddb` · `/api/rules` | GET | `{total,items}` 全量 | 19633 / 19634 |
| `/api/compliance/check` · `/api/compliance/correct` | POST | 传 `asin`（或商品对象）→ 等级/原因（level≠low 会推通知）；按判定修正 | 19636 / 19643 |

```powershell
Invoke-RestMethod http://127.0.0.1:3088/api/health
Invoke-RestMethod http://127.0.0.1:3088/api/license/status
```

### 3.2 商品库（43）
| 路由 | 方法 | 参数 · 返回要点 | 行号 |
|---|---|---|---|
| `/api/products` | GET | 主列表：`filter=<JSON>`、`limit/offset/slim`、`site`（逗号多选）、`q`、`listed=0\|1`、`shop`、`conflict=1`、`sellState`、`sellableSite`、`cat1/cat2/cat1Cn`、`runId`、`shopAbbr` → `{total,returned,offset,truncated,items}` | 14804 |
| `/api/products/detail` | GET | `?asin=` → 单品全字段 + `insight` + `compliance`；404 不存在 | 19587 |
| `/api/products/export` · `/export-fields` | GET/HEAD · GET | `format=xlsx(默认)\|csv\|txt\|json`、`fields`、`asins`；非法 format→400（19577）、csv 带 BOM（19580）；export-fields 实测 default 10 列 / fields 25 个（11731/11759） | 19553 / 19583 |
| `/api/products/save` · `/sync` | POST | `{asins,saved}` 标记已保存；⚠ `sync` 是**假同步**（随机改价/月销/跟卖数，15371-15385） | 15362 / 15371 |
| `/api/products/analyze` | GET | 全库分布：站点/配送/类目/品牌/价格带 + 销量·跟卖·商标 TOP + 风险清单 | 13071 |
| `/api/products/cat-tree` · `/api/products/categories` · `/api/products/rank-stats` · `/api/products/insight-rules` | GET | 类目树（含中文大类目树）/类目/大排名三态统计/洞察规则 | 13841/14066/14100/14120 |
| `/api/products/suspects` · `/api/products/shop-names` · `/api/products/listed-set` | GET | 可疑品/店铺名去重/已上架 ASIN（实测 `{count,asins,bySite}`） | 14130/14221/14233 |
| `/api/products/goods` | GET / POST | GET `?asin=` 取货源明细；**POST 是整组覆盖写（兼容旧接口）** | 13099 / 13106 |
| `/api/products/goods/add` · `/api/products/goods/delete` · `/api/products/goods/patch` · `/api/products/goods/set-role` | POST | 货源增删改/主货源设置 | 13116-13173 |
| `/api/products/goods/fetch` · `/api/products/1688-search` · `/api/products/1688-search-upload` | POST | CDP 抓货源链接；1688 图搜；上传图搜 | 13295/13331/13523 |
| `/api/products/panel-refresh` | POST | `{asins}` 重读插件面板补品牌/商标/排名/销量；采集忙 409（15144） | 15136 |
| `/api/products/refresh-detail` · `/api/products/backfill-image` · `/api/products/refresh-ranks` | POST | `{asins\|since\|all\|needsDetail\|catOnly}` 重读详情页（采集忙 409，14087）/补主图/刷排名 | 14083 / 13402 |
| `/api/products/recalc-fees` | POST | 按类目费率重算 `referralFee`，清空旧公式 `netProfit` | 13825 |
| `/api/products/normalize-fields` · `/api/products/normalize-weight` · `/api/products/fix-derived` · `/api/products/derive-cat` · `/api/products/fix-cat-nosource` · `/api/products/rebuild-rank-fields` · `/api/products/rebuild-variant-groups` · `/api/products/variant-override` · `/api/maintenance/normalize-products` | POST | 批量数据修复/重建，**会全库落盘** | 14157/14184/13889/14029/14010/15347/15284/15256/13379 |
| `/api/products/seller-country` | POST | `{map:{卖家:国家码}}` 批量回填 `sellerCountryCode/chinaSeller` | 19604 |
| `/api/products/delete` · `/api/products/clear` · `/api/products/reset` | POST | 危险操作，仅本机（15212/15222/15231） | 15211/15221/15230 |
| `/api/goods/overview` · `/api/variant-dims` · `/api/variants/colors` | GET · POST · POST | 货源总览/变体尺寸/颜色名 | 13188 / 16167 / 16206 |

```powershell
Invoke-RestMethod 'http://127.0.0.1:3088/api/products?limit=20&offset=0&slim=1'
Invoke-RestMethod 'http://127.0.0.1:3088/api/products?limit=20&sellState=sellable&sellableSite=uk'
Invoke-RestMethod 'http://127.0.0.1:3088/api/products/detail?asin=B0CM2W2QKZ'
Invoke-RestMethod 'http://127.0.0.1:3088/api/products/export?format=json&asins=B0CM2W2QKZ'
```

### 3.3 筛选（3）
| 路由 | 方法 | 参数 · 返回要点 | 行号 |
|---|---|---|---|
| `/api/filter/spec` | GET | `{empty,keys,groups:{productOnly,collectOnly},tmCountryOptions,tmCountryCounts}`；`keys` = `normFilter` 的键（5566-5598） | 13652 |
| `/api/filter/count` | GET | `?filter=<JSON>` → `{total,active,query}`；内部转打 `/api/products?limit=1` 取 total（13677-13692） | 13679 |
| `/api/filter/desc` | GET | `?filter=<JSON>` → `{desc,active}` 中文描述 | 13695 |

```powershell
$f = @{ sites=@('uk'); priceRange='10-50' } | ConvertTo-Json -Compress
Invoke-RestMethod "http://127.0.0.1:3088/api/filter/count?filter=$([uri]::EscapeDataString($f))"
```

### 3.4 采集（47）
| 路由 | 方法 | 参数 · 返回要点 | 行号 |
|---|---|---|---|
| `/api/collect/list-direct` | POST 同步 | `{url,maxItems≤200,maxPages≤10,waitPluginMs≤30000}` → `{site,pagesDone,total,productCount,added,withPlugin,products}` | 15440 |
| `/api/collect/list-filtered` | POST 同步 | `{url,maxItems,maxPages,waitPluginMs,filter,aod?,panel?}` → `{total,preFiltered,skippedByList,enriched,productCount,added}` | 15463 |
| `/api/collect/category` · `/api/collect/site-bulk` · `/api/collect/category-menu` | POST 同步 | 关键词/类目搜索（`maxPages≤10`）；并行多页（`pages≤10,maxItems≤100,detail?`）；类目菜单导航 | 15486/15543/15601 |
| `/api/collect/shop-list` · `/api/collect/shop` | POST 同步 | 店铺列表页（`maxItems≤100,maxPages≤10`）/ 店铺页（`count≤30`） | 18388 / 18408 |
| `/api/collect/panel` | POST 同步 | 详情页插件面板采集 `{url,count≤20}`（FBM/商标/排名来自插件） | 15388 |
| `/api/collect/brand` · `/api/collect/dp-brand` | POST 同步 | 品牌采集 / 品牌店铺采集 | 15711 / 15659 |
| `/api/collect/follow-shop` | POST 同步 | `{url,maxItems≤100,maxPages≤20,filter…}` 单 ASIN 跟卖链（aod→店铺） | 17688 |
| `/api/collect/follow-shop-parallel` | POST 同步 | `{asins[],maxItems≤50,maxPages≤10,concurrency≤6}` → `results/shopOk/shopFail` | 17798 |
| `/api/collect/brand-batch` | POST 异步 | 默认 `transport:'http'` → `{started:true,async:true,mode:'brand'}`；`transport:'cdp'` 回退同步 | 17458 |
| `/api/collect/follow-shop-batch` · `/api/collect/follow-shop-aod` | POST 异步 | mode=`batch` / `aod`，立即返回；结果去 `/api/collect/async-result` | 17722(17763)/17825(17866) |
| `/api/collect/follow-shop-rounds` | POST 同步 | `{urls[],rounds≤30,maxItems≤50,maxPages≤10,concurrency≤6,excludeSellers,amazonWords,filter…}` 多轮并行汇总 | 17903 |
| `/api/collect/shop-links` · `/api/collect/links` | POST 异步 | 多链接采集，立即返回；结果去 `/links-result`，任务可续跑 | 17948(18048) |
| `/api/collect/ingest-push` | POST | 扩展推送入库：仅本机、单次 ≤2000 条、`site` 绝不默认（19455-19464）、忙时 200 `ok:false,busy` | 19440 |
| `/api/collect/direct` | POST 异步 | `{url\|asins[],site,mode:'given'\|'missing',needs[],limit,since,withTitle,withBG,post}`；无 token→400（17150）；立即回 `{started,job,found}` | 17146 |
| `/api/collect/direct/status` · `/api/collect/direct/stop` | GET · POST | 进度 / 停止 | 17452 / 17453 |
| `/api/collect/api-run` | POST 异步 | `{site,mode:'given'\|'missing-country'\|'missing-rank',asins,limit,batch,gapMs,retries,skipFreshHours=24,dryRun,post,withBG}` → `{started,job}` | 15796 |
| `/api/collect/api-status` · `/api/collect/api-stop` · `/api/collect/api-selftest` | GET · POST · GET | 进度/停止/会话自检（不耗配额） | 15880/15883/15887 |
| `/api/collect/status` · `/api/collect/stop` | GET · POST | `{stopRequested,post}` / 置停止标志（当前步骤后停） | 12884 / 12880 |
| `/api/collect/progress` · `/api/collect/post-status` · `/api/collect/post-stop` | GET/GET/POST | 实时进度（无任务 `{running:false}`）/采集后流水线进度/停止 | 12919/12914/12915 |
| `/api/collect/completeness` · `/api/collect/locale` | GET | 数据完整度（`?from=`/`?minutes=` 重算）/站点一致性校验结果 | 12925 / 12955 |
| `/api/collect/hc-probe` | GET | `?site=&url=` → `{ok,status,bytes,asinCount,challenge,cookieCount,title}`；**抓 0 商品先跑它** | 12890 |
| `/api/collect/logs` · `/api/collect/reports` · `/api/collect/report` | GET | 采集批次+任务记录（`?gap=&limit=`）/报告列表/报告明细 | 12960/13014/13018 |
| `/api/collect/async-result` · `/api/collect/links-result` | GET | 取 HTTP 异步结果（`?mode=`）/多链接结果 | 18375 / 18382 |
| `/api/collect/link-jobs` · `/api/collect/link-job` · `/api/collect/link-job/retry` · `/api/collect/link-job/remove` | GET/GET/POST/POST | 断点续跑（`jobId=last` 取最近可续跑，`full=1` 取全量） | 18328/18333/18355/18367 |
| `/api/collect-rules` · `/api/collect-rules/delete` | GET/POST · POST | 采集规则存取/删除 | 13036/13043/13061 |
| `/api/collect/real` · `/api/collect/run` | POST | `real` 走 realCollect；⚠ **`run` 是假采集，随机造商品入库**（19509-19549） | 19503 / 19509 |

```powershell
# 直连采集（异步）：URL 先无头找 ASIN，再走签名接口取数；入库后自动跑 BG→分类→可售站点
$b = @{ url='https://www.amazon.co.uk/s?k=phone+case'; maxItems=60; maxPages=2; site='uk' } | ConvertTo-Json
Invoke-RestMethod http://127.0.0.1:3088/api/collect/direct -Method POST -Body $b -ContentType application/json
Invoke-RestMethod http://127.0.0.1:3088/api/collect/direct/status
Invoke-RestMethod http://127.0.0.1:3088/api/collect/post-status
# 列表页筛选采集（同步，可能几十秒~几分钟；DSH 代理会超时，脚本直连可用）
$b = @{ url='https://www.amazon.co.uk/s?k=dog+bed'; maxItems=40; maxPages=2; filter=@{ sites=@('uk'); priceRange='10-60' } } | ConvertTo-Json -Depth 5
Invoke-RestMethod http://127.0.0.1:3088/api/collect/list-filtered -Method POST -Body $b -ContentType application/json
```

### 3.5 BG 检测（12）
| 路由 | 方法 | 参数 · 返回要点 | 行号 |
|---|---|---|---|
| `/api/bg/accounts` | GET | `?force=1` 绕过 60s 缓存；`{accounts,total,usable,note}`；`flag=9`=账号被禁用 | 15920 |
| `/api/bg/check` | POST 异步 | `{asins\|mode:'given'\|'unchecked'\|'blocked',aid,site,limit,freshHours=72,gapMs=250}` → `{started,job}`；无可用账号 → **200 `ok:false`** | 15933 |
| `/api/bg/status` · `/api/bg/stop` | GET · POST | 进度 / 停止 | 16025 / 16026 |
| `/api/bg/probe` | POST | `{aid,asin}` 单条探测、**不写库**，返回 `raw`；失败 200 `ok:false` | 16033 |
| `/api/bg/probe-multi` | POST | `{asin, aids\|sites}` → `{ok,results,stat,aidsUsed}`；写回同 ASIN 所有记录 `bgByAccount`，本站点店铺优先定 `bgStatus` | 16704 |
| `/api/bg/by-asin` · `/api/bg/lookup` | POST · GET | `{asin,abbrs}` 指定店铺写回；`?asins=a,b&site=&shopAbbr=` 只读本地 | 14709 / 16916 |
| `/api/bg/auto` | GET | `{asins,site,limit≤40}` 本地优先，缺失的**现场探测**（2 worker）并落库 | 16945 |
| `/api/bg/scan` · `/api/bg/scan/status` · `/api/bg/scan/stop` | POST/GET/POST | 店铺体检（`aid`/`aids[]`/`allAccounts:true`），异步 job | 17019/17139/17140 |

```powershell
$b = @{ asin='B0CM2W2QKZ'; sites=@('de','uk') } | ConvertTo-Json
Invoke-RestMethod http://127.0.0.1:3088/api/bg/probe-multi -Method POST -Body $b -ContentType application/json
Invoke-RestMethod 'http://127.0.0.1:3088/api/bg/lookup?asins=B0CM2W2QKZ&site=uk'
```

### 3.6 智赢直连（26）
| 路由 | 方法 | 参数 · 返回要点 | 行号 |
|---|---|---|---|
| `/api/zy/status` | GET | `{hasToken,tokenValid,tokenAgeMin,accounts,usable,quota,…}`；实测 5 店铺可用 | 16070 |
| `/api/zy/token` | POST | `{token}` 手工写入，或 `{bootstrap:true}` 从本机采集浏览器插件抓 | 16074 |
| `/api/zy/accounts` | GET | 店铺列表（id/abbr/name/flag/usable） | 16113 |
| `/api/zy/expiry` | GET | 逐账号查授权到期天数（150ms 间隔）→ `{needReauth,soon,accounts}` | 16085 |
| `/api/zy/login` · `/api/zy/sms` | POST | 账号密码登录 / 短信码 | 16538 / 16556 |
| `/api/zy/logins` · `/api/zy/logins/login` · `/api/zy/logins/rename` · `/api/zy/logins/remove` | GET/POST · POST | 本地加密账号簿（密码永不回传，16119-16120） | 16121-16157 |
| `/api/zy/tokens` · `/api/zy/tokens/active` · `/api/zy/tokens/remove` | GET/POST · POST | 多 token 管理/切换/删除 | 16563-16582 |
| `/api/zy/cards` · `/api/zy/product` · `/api/zy/panel` | POST | 卡密激活 / `{site,asins[],withTitleImage,apply}` 直连取商品（`apply:true` 才写库）/面板数据 | 16589/16754/16831 |
| `/api/zy/asin-sites` | GET | `?asin=&sites=de,uk,…`（≤12）→ 各站点 `{rankParent,rankChild,fulfill,price,sellers,chinaSeller,links}`；**30 分钟内存缓存**（14265-14273） | 14257 |
| `/api/zy/raw-fields` | GET | `?asin=&site=` 原始字段清单（排障） | 14541 |
| `/api/zy/product-enrich` | POST | `{asin,sites[],bgOnly}` 单条 BG+多站点补全 | 14560 |
| `/api/zy/refresh-library` | POST | 全库重算排名收口/BG 归属/跟卖数/自营，打 `bgNoShop` | 14649 |
| `/api/zy/enrich-filtered` | POST 异步 | 按筛选批量 BG+站点取数：`{filter,sites,abbrs,bgOnly,dryRun,limit≤3000}`；语义见 §5 | 14367 |
| `/api/zy/enrich-status` · `/api/zy/enrich-stop` | GET · POST | 进度 / 停止 | 14705 / 14706 |
| `/api/zy/batch-enrich` | POST 同步 | `{asins[],abbrs[],limit≤300}` → `{total,bgFilled,enriched,failed}` | 14745 |
| `/api/zy/variants` · `/api/zy/locale/fix` | POST | `{asin,site}` 变体抓取 / 站点货币·地址修正 | 12938 / 12948 |

```powershell
Invoke-RestMethod http://127.0.0.1:3088/api/zy/status
Invoke-RestMethod 'http://127.0.0.1:3088/api/zy/asin-sites?asin=B0CM2W2QKZ&sites=de,uk,fr'
# 先 dryRun 看这次会处理哪些 ASIN / 站点 / 店铺，再真跑
$b = @{ filter=@{ sites=@('uk') }; limit=50; bgOnly=$true; dryRun=$true } | ConvertTo-Json -Depth 4
Invoke-RestMethod http://127.0.0.1:3088/api/zy/enrich-filtered -Method POST -Body $b -ContentType application/json
```

### 3.7 货运（7）
| 路由 | 方法 | 参数 · 返回要点 | 行号 |
|---|---|---|---|
| `/api/zy/freight/status` · `/api/zy/freight/channels` | GET | 运费服务状态 / 渠道清单（factor、国家） | 16227 / 16282 |
| `/api/zy/freight/prices` | GET | `?country=DE&channel=云途普货&weights=100,200`（≤80 个）→ `{prices:{重量:价\|null}}` | 16241 |
| `/api/zy/freight/quote` | GET | `?country&weight(克)&channel(缺省=云途普货)&refresh=1` → `{cheapest,picked,channelMissing,channels}` | 16261 |
| `/api/zy/freight/calibrate` | POST | `{country,weightG,channel,clientPrice,scope:'channel'\|'country'}` 反推附加费并落表 | 16291 |
| `/api/zy/freight/surcharge` · `/api/zy/freight/frame` | GET/POST · POST | 附加费表读写 / 运费框架 | 16318 / 16335 |

```powershell
$ch = [uri]::EscapeDataString('云途普货')
Invoke-RestMethod "http://127.0.0.1:3088/api/zy/freight/quote?country=DE&weight=200&channel=$ch"
Invoke-RestMethod 'http://127.0.0.1:3088/api/zy/freight/prices?country=DE&weights=100,200'
```

### 3.8 ifast 上架（13）
| 路由 | 方法 | 参数 · 返回要点 | 行号 |
|---|---|---|---|
| `/api/ifast/status` | GET | 登录态/站点/跟卖方案（`ifast-client.js`） | 16346 |
| `/api/ifast/accounts` · `/api/ifast/accounts/save` · `/api/ifast/accounts/delete` · `/api/ifast/accounts/login` | GET/POST | 多账号簿与切换登录 | 16351-16365 |
| `/api/ifast/login` · `/api/ifast/cookie` | POST | `{username,password,save?,remember?,note?}` / `{cookie}` 或 `{browser:true}` 抓 | 16373 / 16381 |
| `/api/ifast/items` | POST / GET | POST `{page,limit,asinSearch,searchName,siteId,sellingId}`→`{total,items}`；GET 本地+peer 在架清单 `?q=&storeId=&site=&limit≤5000` | 16393 / 20569 |
| `/api/ifast/add` | POST | `{site\|siteId, sellingId\|sellingName, stock, leadDays, onOff, autoUpload, items:[{asin,initPrice,lowerPrice,title,brand,image}]}`；**同站点已存在自动跳过（幂等）**；自动写归档+上架记录 | 16401 |
| `/api/ifast/upload` | POST | `{ids[]}` 提交亚马逊 | 16509 |
| `/api/ifast/remove` · `/api/ifast/on-off` | POST | 删除 / 上下架（`{ids[],status:0\|1}`） | 16518 / 16527 |
| `/api/ifast/sync` | POST | 传 `{rows}` 直接导入，或空 → 直连 ifast 翻页拉全量在架（5000/页） | 20390 |

```powershell
Invoke-RestMethod http://127.0.0.1:3088/api/ifast/status
$b = @{ site='DE'; sellingName='全天跟卖'; stock=100; leadDays=5; autoUpload=$false
        items=@(@{ asin='B0CM2W2QKZ'; initPrice=19.99; lowerPrice=17.99; brand='XXX'; title='（可选）标题' }) } | ConvertTo-Json -Depth 6
Invoke-RestMethod http://127.0.0.1:3088/api/ifast/add -Method POST -Body $b -ContentType application/json
```

### 3.9 上架台账（15）
| 路由 | 方法 | 参数 · 返回要点 | 行号 |
|---|---|---|---|
| `/api/listing/check` | GET | `?asin=&site=[&shop=]` → `{duplicated,enforce,blocked,scope,reason,message,where,claims}`；规则原文 18640-18641 | 18587 |
| `/api/listing/blocking` | GET / POST | 重复上架拦截总开关；POST `{enabled,note}` 仅本机 | 18649 / 18659 |
| `/api/listing/upload` | POST | 插件「确认上传」落库并生成填表任务；仅本机；`{items[],shop,force}`；`variantItems` 缺省沿用旧值（18681-18699） | 18669 |
| `/api/listing/ingest` · `/api/listing/fill-child-prices` | POST | 上架记录导入（仅本机）/ 变体子体价格填充 | 18496 / 18464 |
| `/api/listing/fill-tasks` | GET | `?status=todo\|all\|…&shop=&asin=&limit≤50` 给 bridge 的待填任务（被拦截的不算任务） | 18819 |
| `/api/listing/fill-reset` · `/api/listing/fill-result` | POST | 退回待填 / 回写填表结果 | 18847 / 18878 |
| `/api/listing/records` | GET | `?q=&site=&status=&upload=ok\|failed\|none\|everfailed&blocked=&shop=&limit≤1000&offset`；**默认只看当前店铺**，`shop=*` 看全部（19014-19016） | 19007 |
| `/api/listing/record` · `/api/listing/records/status` | GET · POST | `?id=`/`?asin=` 单条；`{ids[]\|shop/site, status:pending\|listed\|failed\|blocked, note}`，改 listed 自动进归档 | 19046 / 19061 |
| `/api/listing/records/delete` · `/api/listing/records/clear` | POST | 仅本机；clear 必须 `confirm:"CLEAR"`（19106） | 19090 / 19100 |
| `/api/listing/uploads` · `/api/listing/export` | GET | 上传日志（`result=ok\|failed&site=&shop=&limit≤500`）/导出 `format=json(默认)\|csv\|txt&ids=&asinOnly=1&shop=&site=&status=` | 18981 / 19124 |

```powershell
Invoke-RestMethod 'http://127.0.0.1:3088/api/listing/check?asin=B0CM2W2QKZ&site=uk'
Invoke-RestMethod 'http://127.0.0.1:3088/api/listing/records?limit=20&status=listed'
Invoke-RestMethod 'http://127.0.0.1:3088/api/listing/export?format=txt&site=uk'
```

### 3.10 知产查重（13）
| 路由 | 方法 | 参数 · 返回要点 | 行号 |
|---|---|---|---|
| `/api/ip/providers` | GET | `{providers,defaultSources,sites,offices,cache,euMembers}`；实测 7 providers、25 站点 | 19658 |
| `/api/ip/search` | GET / POST | GET `?q=&sites=&sources=&offices=&nice=&locarno=&limit=30`；POST 同名字段 + `aliveOnly/registeredOnly` | 19921 / 19936 |
| `/api/ip/risk` | GET / POST | 只回结论 `{term,market,risk,verdict,sources,total}` | 19952 |
| `/api/ip/batch` | POST 异步 | `{asins[]\|all:true, sites, field:'brand'\|'title', sources, nice, apply, limit≤200}`；按归一化关键词去重 | 19968 |
| `/api/ip/batch` · `/api/ip/batch/stop` · `/api/ip/batch/clear` | GET · POST | 进度（含最近 40 条结果）/停止/清空 | 20057/20062/20068 |
| `/api/ip/overview` · `/api/ip/cache/clear` | GET · GET/POST | 商品库风险总览 / 清查重缓存 | 20075 / 19712 |
| `/api/ip/list-check` | POST 异步 | `{urls[]≤20, pages≤60, sources, limit, apply, maxBrands≤500, deep, deepCap≤40}` 列表页→品牌批量查重；采集忙 409 | 20092 |
| `/api/ip/list-job` · `/api/ip/list-stop` · `/api/ip/list-clear` | GET/POST | 任务进度/停止/清空 | 20269/20274/20280 |
| `/api/ip/link` | POST | `{urls[]≤50,maxLinks≤50,sources,limit,cdp,apply}` 商品链接→品牌查重 | 20290 |

```powershell
Invoke-RestMethod 'http://127.0.0.1:3088/api/ip/risk?q=Anker&sites=uk'
$b = @{ asins=@('B0CM2W2QKZ'); sites=@('uk'); field='brand'; limit=20; apply=$false } | ConvertTo-Json
Invoke-RestMethod http://127.0.0.1:3088/api/ip/batch -Method POST -Body $b -ContentType application/json
Invoke-RestMethod http://127.0.0.1:3088/api/ip/batch
```

### 3.11 市场 / 选品 / 蓝海 / flywheel（9）
| 路由 | 方法 | 参数 · 返回要点 | 行号 |
|---|---|---|---|
| `/api/market/list` · `/api/market/analyze` | GET | 类目市场列表（默认 HTML，`format=json` 回 `{rows}`）/ `?site=&cat=&format=html\|json\|md` | 19672 / 19683 |
| `/api/blueocean/analyze` | GET | `?site=de,uk&group=&maxWeightKg=&priceMin=&priceMax=&minSales=&minSample=&limit=&tmFree=0`；**纯读商品库，不触发采集**（19719） | 19720 |
| `/api/select/scan` | POST 同步 | `{url,maxPages≤10,waitPluginMs≤40000,priceMin=10,priceMax=45}` → `{groups,byType,candidates,items,coverage,health,cache}` | 19749 |
| `/api/select/last` · `/api/select/export` | GET | 最近一次结果（无则 `{ok:false,empty:true}`，实测）/ `?type=candidates\|all` CSV（未扫描 404） | 19813 / 19821 |
| `/api/select/ip-check` · `/api/select/to-products` | POST | 候选品牌批量查重（≤12）/ `{asins[]}` 入库供补采 | 19844 / 19874 |
| `/api/flywheel` | GET | 飞轮数据 | 20794 |

```powershell
$g = [uri]::EscapeDataString('五金工具')
Invoke-RestMethod "http://127.0.0.1:3088/api/blueocean/analyze?site=de,uk&group=$g&maxWeightKg=0.6&limit=50"
$b = @{ url='https://www.amazon.co.uk/gp/bestsellers/kitchen'; maxPages=1 } | ConvertTo-Json
Invoke-RestMethod http://127.0.0.1:3088/api/select/scan -Method POST -Body $b -ContentType application/json
```

### 3.12 利润与费率（3）
| 路由 | 方法 | 参数 · 返回要点 | 行号 |
|---|---|---|---|
| `/api/profit/calc` | POST | `{asin,mode,supplyCny,shipCny,dutyCny,storageCny,otherCny,priceOverride,priceBasis,acos,returnRate,payRate,fxLoss,vatRate,commRate,fbaFee,targetMargin}` → `{items,netCny,marginPct,breakEvenPrice,targetPrice,warnings}`；商品不存在 404 | 13800（body 注释 13799） |
| `/api/rates` | GET / POST | GET 汇率（CNY 基准、当日缓存、失败用过期缓存/内置兜底）；POST `{rates:{EUR:7.8}}` 手工覆盖 | 13230 / 13279 |
| `/api/tax/rates` | GET / POST | GET 各站点税率+欧盟 VAT（每日刷新）；POST `{site,rate,includesTax}`，税率必须 0-100 | 13761 / 13778 |

```powershell
$b = @{ asin='B0CM2W2QKZ'; mode='FBA'; supplyCny=20; shipCny=12; targetMargin=0.15 } | ConvertTo-Json
Invoke-RestMethod http://127.0.0.1:3088/api/profit/calc -Method POST -Body $b -ContentType application/json
```

### 3.13 归档（13）
| 路由 | 方法 | 参数 · 返回要点 | 行号 |
|---|---|---|---|
| `/api/archive/save` | POST | `{source:'products'\|'listing', ids, q, site, shop, limit, skipExisting}` 仅本机；无匹配 → 200 `ok:false`+`matched` | 19169 |
| `/api/archive/list` · `/api/archive/grouped` | GET | `{batches,stats,byShop,byShopSite,grouped}`（`grouped=0` 关闭）/ 店铺→站点分组（带条目） | 19249 / 19283 |
| `/api/archive/items` | GET | `dedup`（默认 1）、`batchId`（指定批次**强制不跨批去重**）、`site/q/shop/cat1/tag/价格·利润·月销·排名区间`、`limit≤1000&offset` | 19300 |
| `/api/archive/stats` · `/api/archive/export` | GET | 分布统计+四象限+批次趋势 / `format=csv(默认)\|json` + 同 items 过滤 | 19319 / 19380 |
| `/api/archive/tag` | POST | `{keys[],tag(≤12字),on}` 打/去标签 | 19330 |
| `/api/archive/item/delete` · `/api/archive/batch/delete` · `/api/archive/clear` · `/api/archive/remove` | POST | 删条目（仅本机）/删批次/清空/移除 | 19351/19395/19409/20554 |
| `/api/archive/auto` · `/api/archive/auto/run` | GET/POST · POST | 每日自动归档设置（`enabled/hour/source`）/立即跑一次 | 19418/19424/19432 |

```powershell
Invoke-RestMethod http://127.0.0.1:3088/api/archive/list
Invoke-RestMethod 'http://127.0.0.1:3088/api/archive/items?site=uk&limit=50&offset=0'
Invoke-RestMethod 'http://127.0.0.1:3088/api/archive/export?format=json&site=uk'
```

### 3.14 浏览器（11，全部仅本机）
| 路由 | 方法 | 要点 | 行号 |
|---|---|---|---|
| `/api/browser/shot` · `/api/browser/live` · `/api/browser/tab` · `/api/browser/input` · `/api/browser/activity` | GET | 截屏 / 实时画面（JPEG base64）/标签页/输入/操作记录（`?limit≤200`） | 12408/12462/12538/12587/12659 |
| `/api/browser/status` | GET | 状态+`pages`+`activePort`；**也支持 `?action=start\|stop\|user\|auto&mode=&args=`**（12664-12693） | 12663 |
| `/api/browser/start` · `/api/browser/mode` · `/api/browser/focus` · `/api/browser/stop` · `/api/browser/switch` | GET/POST | 启动（立即回 starting，后台启动，12711-12712）/形态/聚焦/停止/切换 | 12707-12783 |

```powershell
Invoke-RestMethod http://127.0.0.1:3088/api/browser/status
```

### 3.15 店铺 / 认领 / 端口 / 同步 / 其它（31）
| 路由 | 方法 | 参数 · 返回要点 | 行号 |
|---|---|---|---|
| `/api/shop/register` · `/api/shop/list` · `/api/shop/current` · `/api/shop/delete` | POST/GET/POST/POST | 登记/列表（实测 `{current,items,byShop,byShopSite,total}`）/切当前/删除 | 18538-18569 |
| `/api/claims/check` · `/api/claims/commit` · `/api/claims/override` · `/api/claims/rebuild` | POST | 跨店上架归属校验：block 判定、override 审计；30 分钟内 override 视为用户已确认放行（18612-18638） | 20591-20647 |
| `/api/claims/settings` · `/api/claims/ledger` · `/api/claims/mark-batch` · `/api/claims/platform` | GET/POST | 设置（仅本机）/台账/批量标记/ifast 平台行（含 `inLedger`） | 20652-20751 |
| `/api/claims` | GET / POST | 认领列表 / 认领到草稿箱 `{asin,opts}` | 20772 / 20773 |
| `/api/ports` · `/api/ports/stop` · `/api/ports/start` · `/api/ports/delete` | GET/POST · POST | 局域网共享端口（≤8、0.0.0.0）；仅本机 | 20808-20860 |
| `/api/peers` · `/api/peers/sync` · `/api/peers/sync-all` · `/api/peers/delete` | GET/POST · POST | 多机对端与数据同步 | 20874-20940 |
| `/api/sync/export` · `/api/sync/import` | GET · POST | 同步载荷导出/导入 | 20951 / 20956 |
| `/api/notify` · `/api/notify/read` | GET · POST | 通知列表 / 已读 | 20800 / 20801 |
| `/api/publish` · `/api/reprice/run` · `/api/reprice` | POST · POST · GET | 刊登 / 调价（回最近 30 条） | 20780/20786/20792 |
| `/api/agent/assess` · `/api/sources` · `/api/sources/cdp-search` | POST · GET · POST | 选品评估 `{asin}` / 找货源站点清单 / CDP 图搜（采集忙 409） | 20796 / 13732 / 13746 |

```powershell
Invoke-RestMethod http://127.0.0.1:3088/api/shop/list
$b = @{ asin='B0CM2W2QKZ' } | ConvertTo-Json
Invoke-RestMethod http://127.0.0.1:3088/api/agent/assess -Method POST -Body $b -ContentType application/json
```

## 4. Agent 常用配方

### 4.1 健康检查（每次动手前）
```powershell
Invoke-RestMethod http://127.0.0.1:3088/api/health              # ok=True
Invoke-RestMethod http://127.0.0.1:3088/api/license/status      # valid=True
Invoke-RestMethod http://127.0.0.1:3088/api/zy/status           # hasToken/tokenValid
Invoke-RestMethod http://127.0.0.1:3088/api/collect/progress    # 有没有采集在跑
```

### 4.2 采集一个列表页（异步直连，推荐）
```powershell
$b = @{ url='https://www.amazon.co.uk/s?k=phone+case'; maxItems=60; maxPages=2 } | ConvertTo-Json
$job = Invoke-RestMethod http://127.0.0.1:3088/api/collect/direct -Method POST -Body $b -ContentType application/json
# 轮询到 running=false，再等采集后流水线
Invoke-RestMethod http://127.0.0.1:3088/api/collect/direct/status
Invoke-RestMethod http://127.0.0.1:3088/api/collect/post-status
Invoke-RestMethod 'http://127.0.0.1:3088/api/products?limit=50&sellState=sellable&sellableSite=uk'
```

### 4.3 BG 单条 / 批量
```powershell
$b = @{ asin='B0CM2W2QKZ'; sites=@('de','uk','fr') } | ConvertTo-Json        # 单条多店
Invoke-RestMethod http://127.0.0.1:3088/api/bg/probe-multi -Method POST -Body $b -ContentType application/json
$b = @{ mode='unchecked'; site='uk'; limit=100 } | ConvertTo-Json             # 批量（异步 job）
Invoke-RestMethod http://127.0.0.1:3088/api/bg/check -Method POST -Body $b -ContentType application/json
Invoke-RestMethod http://127.0.0.1:3088/api/bg/status
```

### 4.4 取可售站点数据
```powershell
Invoke-RestMethod 'http://127.0.0.1:3088/api/products?limit=50&sellState=sellable'
Invoke-RestMethod 'http://127.0.0.1:3088/api/zy/asin-sites?asin=B0CM2W2QKZ&sites=de,uk,fr,it,es'
```

### 4.5 查上架台账（能不能上 / 上过没）
```powershell
Invoke-RestMethod 'http://127.0.0.1:3088/api/listing/check?asin=B0CM2W2QKZ&site=uk'
Invoke-RestMethod 'http://127.0.0.1:3088/api/listing/records?limit=50&shop=*'   # 全部店铺
Invoke-RestMethod 'http://127.0.0.1:3088/api/listing/export?format=txt&site=uk' # 纯 ASIN 清单
```

### 4.6 ifast 上架（价格用绿色承受价 `lowerPrice`）
```powershell
Invoke-RestMethod http://127.0.0.1:3088/api/ifast/status
$b = @{ site='DE'; sellingName='全天跟卖'; stock=100; leadDays=5
        items=@(@{ asin='B0CM2W2QKZ'; initPrice=19.99; lowerPrice=17.99 }) } | ConvertTo-Json -Depth 6
Invoke-RestMethod http://127.0.0.1:3088/api/ifast/add -Method POST -Body $b -ContentType application/json
# 确认无误再提交亚马逊：加 autoUpload=$true，或拿返回的 ids 调 /api/ifast/upload
```

### 4.7 导出
```powershell
Invoke-RestMethod 'http://127.0.0.1:3088/api/products/export?format=json&fields=asin,site,price,currency'
Invoke-RestMethod 'http://127.0.0.1:3088/api/products/export?format=xlsx' -OutFile "$env:TEMP\zying.xlsx"  # 二进制必须 OutFile
Invoke-RestMethod 'http://127.0.0.1:3088/api/products/export-fields'   # 先看可导哪些列
```

## 5. 坑（均来自代码注释/实现）

1. **采集忙守卫 + `send()` 自动清进度**：`POST /api/collect/*`（白名单除外）在采集运行时 409（12834-12844）；`send()` 在 code≥400 时会清 `collectProgress`（12302-12306）。所以报错后先看 `/api/collect/progress` 再重试；`ingest-push` 忙时故意回 200（19447-19451）。
2. **`/api/zy/enrich-filtered` 的 `bgOnly`/`sites` 语义**（14379-14391）：`bgOnly:true` = 只调 `/api/bg/probe-multi`、跳过 6 站点 raw；但**显式传了 `sites` 仍会取这些站点的 raw**（`__rawSites = bgOnly ? 显式sites : sites`），不传才真跳过。默认站点 `de,fr,it,es,uk,au`，`limit` 上限 3000（14392）。
3. **`enrich-filtered` 分页是 offset 不是 page**（14398-14408）：传 page 永远拿第一页；内部按 `limit=500&offset=` 翻页，最多 200 轮。
4. **`/api/products` 的 `slim=1` 裁掉**（15114-15123）：`bulletPoints, offers, insight, offerPrices, apiPackageDimensions, apiDimensions, apiDimensionsUnit, variants, variantAttrs, brandSources, suggestMarket, brandLink, catPath, searchTerms, description, aplusRaw, images`。**保留** `siteStats/bgByAccount/sellableSites/famKey/famCount`；`insight` 是裁剪后由 `productInsight.annotate` 又加回来的（15125-15126；实测响应有 `insight` 无 `offers`）。
5. **`/api/products` 两套分页语义**：不传 limit → 最多 500 且 `truncated:true`；传 limit → 截 500 但 `truncated:false`（15100-15111，实测）。总数读 `total`（过滤后、分页前），不是 items.length。
6. **`filter=` JSON 有白名单**：只认 `normFilter` 的键（5566-5598）。`sellState`/`sellableSite` **不在**其中 → 必须用顶层 query 参数（实测：`filter={"sellState":"sellable"}` 返回全库 4106；`sellState=sellable` 返回 69）。同理 `hasRankOnly/rankState/brandStatus/noRank` 虽被 `filterToQuery` 读取（5631-5634、5649），但 `normFilter` 不产出这些键 → 经 `filter=` 传等于没传（读码结论，未逐项实测）。
7. **异步采集要另取结果**：`/api/collect/brand-batch`、`/follow-shop-batch`、`/follow-shop-aod`、`/shop-links|links` 默认走 HTTP 通道，**立即返回** `{started:true,async:true}`；结果去 `/api/collect/async-result?mode=…` 或 `/links-result`（17499、17763、17866、18048）。同步长请求会撞代理超时（17462、17829 注释：客户端只看到 proxy-unavailable）。
8. **直连采集的熔断**：分片 20 条、`gapMs=250/retries=2/timeout=25s`；**连续 3 个分片失败 → 判为限流/token 失效并停止**（17220-17234）。排查先 `GET /api/zy/status`。
9. **BG 与 API 采集互斥**：两者共用同一插件会话/请求层，并发会触发「请求过于频繁」（15936-15938、15797-15799；bg/check 对采集也 409）。
10. **别调假数据接口**：`POST /api/products/sync` 随机改价格/月销/跟卖数（15371-15385）；`POST /api/collect/run` 随机造商品入库（19509-19549）。要刷新走 `/api/zy/batch-enrich`、`/api/products/panel-refresh` 或采集接口。
11. **清空/删除要显式确认**：`/api/listing/records/clear` 必须 `confirm:"CLEAR"`（19106）；`products/delete|clear|reset`、`records/delete`、`archive/item/delete` 等仅本机，否则 403（15212、19091、19353）。
12. **上架查重规则与 override**：同 ASIN + 同站点，**不论店铺（含本店）只要上架过就拦**，站点不同不拦；受「重复上架拦截」总开关控制（18640-18642、18649-18657）。`claims` 的 block 若 **30 分钟内**有 override 审计则放行；时间按 UTC 解析（18622-18626，注释说差 8 小时会永不成立）。
13. **`ifast/add` 幂等**：同站点已存在直接跳过并回 `duplicated`（16416-16421）；失败多以 **200 `ok:false`** 返回（16348/16507）；只有 `autoUpload:true` 才提交亚马逊（16500-16503），并自动写归档+上架记录（16435-16497）。
14. **列表页采集 0 商品**：先 `GET /api/collect/hc-probe?site=uk&url=…` 看 `status/bytes/asinCount/challenge/cookieCount`（12890-12911）；`challenge=true` 即被风控。
15. **`/api/zy/asin-sites` 有 30 分钟内存缓存**（14265-14273），刚改的数据不会立刻反映。
16. **GET 不读 body**：18332 注释「GET 接口一律从 searchParams 取参（读 j.jobId 会恒为 undefined）」。别把参数塞进 GET 的 body。
17. **非回环 IP 会被拦**：`/api/collect/*`、`/api/browser/*`、`/api/ports*`、`/api/claims/settings|rebuild` 从局域网访问直接 403（12311-12315）——多机只能用 `sync/*`、`peers/*` 这类接口。
18. **未核实**：`/api/ifast/sync` 的 `rows/groups` 载荷细节只读了入口分支（20390-20401）；`/api/browser/shot|live|tab|input` 的 query 参数名未逐个核对；`/api/claims/commit|ledger|mark-batch` 的返回字段未展开。用前回看对应行号。

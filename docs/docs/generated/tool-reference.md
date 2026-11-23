# DSH 工具参考（zying_*）

> 插件 `index.js` 在 Host 侧注册的 11 个工具，Agent 可直接调用。所有工具最终都打本地 `http://127.0.0.1:3088`。

| 工具 | 一句话 | 底层接口 |
|---|---|---|
| `zying_health` | 体检：后端在线 + 商品数 + 授权 | `GET /api/health`（+ license） |
| `zying_collect_url` | 给列表页 URL → 无头找品 → 接口取数入库 | `POST /api/collect/direct`（url） |
| `zying_collect_direct` | 按 ASIN 批量取/补商品数据 | `POST /api/collect/direct`（asins） |
| `zying_collect_status` | 采集进度 + 后端开关 + 库统计 + 最新入库 | `GET /api/collect/progress` 等 |
| `zying_list_direct` | 列表页直采（CDP，含插件面板信息） | `POST /api/collect/list-direct` |
| `zying_list_filtered` | 列表页筛选采集（不跳详情） | `POST /api/collect/list-filtered` |
| `zying_follow_shop` | 商品 → 跟卖卖家 → 并行采各店铺 | `POST /api/collect/follow-shop-parallel` |
| `zying_stop` | 停止当前采集 | `POST /api/collect/stop` |
| `zying_ifast_status` | ifast 登录态 + 跟卖方案 + 站点 | `GET /api/ifast/status` |
| `zying_ifast_add` | 上架（多店铺/多变体，可选提交亚马逊） | `POST /api/ifast/add` |
| `zying_ifast_list` | ifast 在架商品查询 | `POST /api/ifast/items` |

---

## 1. `zying_health`

无参数。返回 `{online, total, time, license:{valid, customer, expiresAt, perpetual, fingerprint, needLicense}}`。

用途：任何操作前先跑，确认 `online=true` 且 `license.valid=true`；`total` 为商品库条数。

---

## 2. `zying_collect_url`

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `url` | string（必填） | — | Amazon 列表/搜索/品牌店铺页 |
| `maxPages` | number | 2 | 无头浏览器翻页找品 1~10 |
| `maxItems` | number | 120 | 最多取多少 ASIN |
| `limit` | number | =maxItems | 实际入库上限 |
| `withTitle` | boolean | true | 补标题/主图（只补缺） |
| `wait` | boolean | false | 等采完再返回（否则立即返回任务信息） |

流程：无头浏览器翻页拿 `data-asin` → 智赢 `MoreAboutAsinRaw` 批量取数 → 入库 → 采集后流水线（BG→分类→站点数据）。

注意：评分/评论/A+/图集**接口没有**，需事后「补采」。

---

## 3. `zying_collect_direct`

| 参数 | 类型 | 说明 |
|---|---|---|
| `asins` | string[] | 10 位 ASIN；不传则按 `mode` 从库里挑 |
| `mode` | `given`/`missing`/`all` | 只采给定 / 补缺字段 / 该站点全部 |
| `needs` | string[] | `mode=missing` 时缺哪些采哪些：`brand/bsr/firstAvailable/title/price/bullets` |
| `site` | string | 站点，默认 `de` |
| `limit` | number | 本次最多处理（0=不限） |
| `withTitle` | boolean | 顺带补标题/主图（默认 true，只补缺） |
| `wait` | boolean | 等跑完再返回（默认 false） |

速度约 150~500ms/条（限流会慢），长任务后台跑。

---

## 4. `zying_collect_status`

无参数。返回后端采集开关、商品库总量、最近 5 分钟新增、站点货币构成、最新 5 条入库记录。

用途：长任务期间确认后台还在跑，避免把 HTTP 超时误当失败。

---

## 5. `zying_list_direct`

| 参数 | 说明 |
|---|---|
| `url` | 列表页 URL（必填） |
| `maxPages` | 翻页 1~10（默认 1） |
| `maxItems` | 入库上限（默认 100） |
| `waitPluginMs` | 等智赢插件分析毫秒（默认 15000，越大覆盖越多） |

需要采集浏览器（CDP 9222）+ 智赢插件已登录。

---

## 6. `zying_list_filtered`

| 参数 | 说明 |
|---|---|
| `url` | 列表页 URL（必填） |
| `maxPages` / `maxItems` | 翻页 / 上限 |
| `filterFulfill` | `FBA` / `FBM` |
| `filterRankMax` / `filterRatingMin` / `filterReviewsMin` | 排名/评分/评论下限 |
| `filterQ` | 标题关键词 |
| `aod` | 是否采 aod 跟卖卖家（默认 true） |

不跳详情页；详情页专有字段（价格/评论/类目/A+）之后用「补采」。

---

## 7. `zying_follow_shop`

| 参数 | 说明 |
|---|---|
| `url` | 商品 URL 或 ASIN（必填） |
| `maxItems` | 每店铺商品数上限（默认 10） |
| `maxPages` | 每店铺翻页数（默认 2） |
| `concurrency` | 并行网页数 1~6（默认 4） |
| `excludeSellers` | 排除卖家（名称/ID 逗号分隔） |

耗时较长（CDP 全程），返回店铺成功/失败数/采集商品数。

---

## 8. `zying_stop`

无参数。让采集循环在当前步骤后退出，已采数据保留入库。

---

## 9. `zying_ifast_status`

无参数。返回登录态是否有效、跟卖方案（sellingId）列表、站点（siteId）列表。**上架前必跑**。

注意：`siteId` 每个账号不同，不要缓存写死。

---

## 10. `zying_ifast_add`

| 参数 | 说明 |
|---|---|
| `site` / `siteId` | 站点字母或 id（id 优先） |
| `sellingName` / `sellingId` | 跟卖方案名或 id |
| `stock` | 库存（默认 100） |
| `leadDays` | 备货周期（默认 5） |
| `onOff` | 上架开关 1/0（默认 1） |
| `autoUpload` | true = 立即提交亚马逊（默认只写 ifast） |
| `items` | `[{asin, initPrice, lowerPrice, title?, brand?, image?}]`（必填） |

同站点已存在会自动跳过（按台账查重）。

---

## 11. `zying_ifast_list`

| 参数 | 说明 |
|---|---|
| `asinSearch` | 按 ASIN 精确查 |
| `siteId` / `sellingId` | 按站点/跟卖方案筛 |
| `page` / `limit` | 分页（默认 1 / 20） |

返回 `itemStatus`：0 待上传 / 10 检查 / 20 成功 / 30 失败 / 40 暂停。

---

## 通用注意

- 工具调用会**自动确保 ERP 在跑**（插件启动时 `ensureErp()`；若已停，先调 `zying_health` 或手动拉起）。
- 工具不负责登录智赢/ifast；token 过期先按 [install.md](../operations/install.md) 第 3 节处理。
- 长任务（`wait:false`）用 `zying_collect_status` 或对应 `/api/collect/*/status` 跟踪。
- 工具返回的是**后端原始 JSON**，字段含义见 [db-schema.md](db-schema.md)。

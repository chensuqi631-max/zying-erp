# 规格：采集（Collection）

> 从 Amazon 列表/店铺/商品页，或从智赢数据源，把商品数据取回商品库。

---

## 1. 六类采集入口

| 入口 | 界面位置 | 接口 | 通道 | 适用 |
|---|---|---|---|---|
| 列表页直采 | 采集面板卡片 | `POST /api/collect/list-direct` | CDP | 搜索/类目页，含插件面板信息 |
| 列表页筛选采集 | 采集面板卡片 | `POST /api/collect/list-filtered` | CDP | 列表页先筛，再跳详情 |
| 列表页直采（无头找品） | 采集面板「直采」 | `POST /api/collect/direct`（带 `url`） | HTTP | 快，不依赖插件面板 |
| 直连采集（按 ASIN） | 采集面板 | `POST /api/collect/direct`（带 `asins`） | HTTP（智赢） | 150~500ms/条，补数据 |
| 类目/整站/类目菜单/品牌 | 采集面板 | `POST /api/collect/category` / `site-bulk` / `category-menu` / `brand` / `dp-brand` / `brand-batch` | CDP | 批量找品 |
| 多链接 | 采集面板 | `POST /api/collect/shop-links` | HTTP | 店铺/卖家/商品链接混合 |
| 跟卖店铺 | 采集面板 | `POST /api/collect/follow-shop*` | CDP | 按卖家店铺捞货 |
| API 采集 | 商品管理/采集 | `POST /api/collect/api-run` | HTTP（智赢） | 回填缺字段 |

> 所有入口共用一个「统一过滤面板」（fulfill/排名/价格/评分/评论/品牌/中国卖家/A+ 等），提交时作为 `filter` 传后端。

---

## 2. 采集过程（以列表页为例）

```
① 取列表页 HTML/CDP 页面 → 解析 data-asin（最多 maxPages 页 / maxItems 条）
② 去重（与商品库比对）
③ 逐条/批量补数据（智赢 MoreAboutAsinRaw：品牌/BSR/价格/卖家/尺寸/上架日/月销）
④ applyRankFields 统一收口 → 入库
⑤ 采集记录 + 通知
⑥ 采集后流水线（默认）：BG → 按店铺分类 → 可售站点取数
```

---

## 3. 采集后流水线（默认开启）

见 [../design-docs/collection-pipeline.md](../design-docs/collection-pipeline.md)。要点：

- BG 检测：全部可用店铺，24h 缓存
- 分类：`sellState` / `sellableSites`（按店铺分别）
- 只对可售站点取 `siteStats`（排名/配送/价格/跟卖/中国卖家）
- 关闭：`post:false`

---

## 4. 参数速查（常用）

| 参数 | 默认 | 说明 |
|---|---|---|
| `url` / `urls` | — | 列表/店铺/商品链接 |
| `asins` | — | 指定 ASIN 数组 |
| `site` | 由链接域名推导（多链接）/ `de`（类目） | 站点；多链接里显式传会**强制**该站点并改写链接域名 |
| `currency` | 站点默认 | 采集浏览器币种（不改变入库币种） |
| `maxPages` / `shopPages` | 1~2 | 翻页数 |
| `maxItems` | 100/50/0 | 条数上限（0=不限，注意耗时） |
| `filter` | — | 统一过滤条件 JSON |
| `post` / `withBG` | 开 | 关掉采集后流水线 |
| `bgConcurrency` / `siteConcurrency` | 3 / 2 | 并发（别调大） |

---

## 5. 进度与结果

| 任务 | 进度 | 结果 |
|---|---|---|
| 直连采集 | `/api/collect/direct/status` | 同左（`created/updated/failed/samples`） |
| 采集后流水线 | `/api/collect/post-status` | 同左（`sellable/unsellable/siteReq/siteHit`） |
| 多链接 | `/api/collect/progress` | `/api/collect/links-result` |
| API 采集 | `/api/collect/api-status` | 同左 |
| 采集记录 | — | `/api/collect/reports` |

---

## 6. 验收标准

1. 抓到的条数 = 去重后入库条数（差值要有"跳过/重复"说明）。
2. 0 条时必须给出可诊断原因（`hc-probe` 现场）。
3. 每条商品至少有：`asin/site/title/mainImage/collectedAt/source`。
4. 有排名的商品 `rankParent` 与 `bsrShop` 一致（口径见 DESIGN §1）。
5. 采集后 `post-status` 显示 `sellable + unsellable + unknown = total`。
6. 采集记录写入 `collect-reports.json`，界面「采集日志」可见。

---

## 7. 已知边界

- 品牌店铺页（`/stores/`）多段是 JS 渲染，HTTP 抓不到 ASIN → 用 CDP 入口或换列表页。
- 亚马逊会风控：同一 IP 高频抓取 → 202/挑战页；换 headed 浏览器、降频、刷新 cookie。
- 非商品站点（如商品在 UK 但查 DE）常无排名，属数据源事实。
- 单次 `maxItems=0`（不限）可能跑很久；长任务要能停（`/api/collect/stop`）。

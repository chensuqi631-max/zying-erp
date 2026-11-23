# 采集后流水线（Collection → BG → Sellable → Site Data）

> 2026-11-22 按用户口径实现的默认链路。改采集相关代码前必读。

---

## 1. 用户口径（原始需求）

> 采集逻辑改为：在网页采集完成后**先对商品进行 BG 检测**，然后**将可售商品数据进行分类**，再将可售商品进行**二次获取配送、排名等基础数据**，这些数据可以通过智赢数据库获取。

确认过的三条细则：
1. **按店铺分别分类**（DE 可售、GB 可售是两个独立结论）
2. **只取 BG 可售的站点**：两个站点可售就取两个站点；不可售的站点一条都不取
3. **所有采集入口默认开启**

---

## 2. 数据流

```
采集入口（12 个）
   ↓ 入库 products[]
   ↓ save('products.json')
   ↓ postAfterCollect(list, {label, mode, site})     // 默认开；post:false / withBG:false 关闭
   ↓ enqueuePostCollect → postQueue（Promise 串行）
runPostCollect(asins)
   ├─ ① BG：bgProbeMulti(asin, 全部 usable 店铺)
   │      · 24h 缓存跳过（同商品同店铺覆盖全部当前店铺）
   │      · 单店 ERROR → 隔 400ms 重试一次
   │      · 写 bgByAccount / bgStatus(本站点店铺优先) / bgCheckedAt
   ├─ ② 分类：sellableStoreAbbrs / sellableSites / sellableStoreCount / sellState / postAt
   │      · 有任一 OK → sellable；有店铺结果但无 OK → unsellable；无任何结果 → unknown
   └─ ③ 站点数据：只对 sellableSites 逐站 MoreAboutAsinRaw
          · applySiteStatFromRaw → siteStats[站点] + 同站点记录字段
          · siteScope / siteScopeMode='post-collect'
   ↓
save('products.json') + pushNotify + links-result.bg 回填
```

---

## 3. 字段契约

| 字段 | 类型 | 含义 | 写入点 |
|---|---|---|---|
| `bgByAccount` | `{ABBR:{status,at,aid,name}}` | 店铺维度原始 BG | 流水线 / `/api/bg/probe-multi` / 商品管理「获取BG」 |
| `bgStatus` / `bgAbbr` / `bgAccount` / `bgAid` | 兼容字段 | 本站点店铺优先、否则最优 | 同上 |
| `bgCheckedAt` | 时间串 | 最近一次 BG 时间（缓存依据） | 同上 |
| `sellableStoreAbbrs` | `['DE','GB']` | 可售店铺 | 流水线 |
| `sellableSites` | `['de','uk']` | 可售店铺对应站点 | 流水线 |
| `sellableStoreCount` | number | 可售站点数 | 流水线 |
| `sellState` | `sellable`/`unsellable`/`unknown` | 分类结论 | 流水线 |
| `postAt` | 时间串 | 分类时间 | 流水线 |
| `siteStats[站点]` | 对象 | `rankParent/rankChild/bsr/fulfill/amazonSell/sellers/sellerId/chinaSeller/brand/price/currency/at/src` | 流水线 / `/api/zy/enrich-filtered` |
| `siteScope` / `siteScopeMode` / `siteScopeAt` | 数组/字符串 | 卡片要渲染哪些站点行 | 流水线 |

同站点记录会同步主字段：`rank/rankChild/fulfill/sellerCount/followCount/chinaSeller/price/currency/amazonSell`。

---

## 4. 进度与停止

```powershell
Invoke-RestMethod http://127.0.0.1:3088/api/collect/post-status
# {running, label, mode, total, done, bgDone, bgTotal, bgFilled, bgCached,
#  sellable, unsellable, unknown, sellableStores, siteReq, siteHit, siteDone, siteTotal,
#  step, error, missing, bgRetried}

Invoke-RestMethod -Method POST http://127.0.0.1:3088/api/collect/post-stop
```

- `collectStopRequested()` 为真时流水线也会停（用户点了「停止采集」）。
- 流水线自己会占一个 `collectProgress`（`mode:'post'`），结束清理。

---

## 5. 可调参数（请求体）

| 参数 | 默认 | 说明 |
|---|---|---|
| `post` | 开 | `false` 关闭本次流水线 |
| `withBG` | 开 | `false` 同时关闭 BG 与流水线（直连采集里是"BG 快路径"开关） |
| `bgConcurrency` | 3 | BG 并发 |
| `bgCacheH` | 24 | BG 缓存小时数，0=关缓存 |
| `siteConcurrency` | 2 | 站点数据并发 |
| `maxSitesPerItem` | 6 | 单商品最多取几个站点 |

---

## 6. 已知边界

1. **非商品所在站点经常没有排名** → `siteStats[该站].rankParent=null`，这是数据源事实，不是 bug。
2. **`bgStatus` 与 `sellState` 可能不一致**（例如本站点店铺 NOT_ELIGIBLE 但别的店 OK）：`sellState` 按"任一店铺 OK"；`bgStatus` 按"本站点店铺优先"。
3. 流水线是**串行队列**：连续触发多次采集时，后一次排队等前一次跑完。
4. `ERROR` 只重试一次：连续限流时仍可能留 `ERROR`，重新跑一次采集即可（24h 缓存会跳过已覆盖的）。

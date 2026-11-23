# DESIGN.md — 设计原则与关键取舍

> 这份文档解释「为什么代码长这样」。改代码前先读，能避免把已踩过的坑再踩一遍。
> 每条都来自代码注释里的实测记录（`erp/server.js`、`lib/client.js`、`erp/*.js`）。

---

## 1. 第一原则：不编造数据

| 规则 | 实现 | 代价 |
|---|---|---|
| 没采到就是 `null`，绝不写 `0` / 随机值 | `applyRankFields()`、各处 `price == null ? null : …` | 界面会显示 `-`/`未采到`，看起来"数据少" |
| 价格只认 BuyBox，未知就 `null` | `dcText` / `mergeZyApiRecord` 注释「接口根本不返回价格」 | 有的商品没价 |
| 父类排名缺失 = `null`，**绝不拿子类顶** | `applyRankFields()` 里有专门注释与 1518 条历史数据案例 | 部分商品父类排名变成"未采到" |
| 数据源对非商品站点常无数据 → 记 `null`，不猜 | `siteStats[站点]` 可能只有价格没有排名 | 卡片会显示 `未上榜` / `-` |

> 界面上「未采到」「未上榜」「0」是**三种不同事实**，不许合并。

---

## 2. 单一收口（Single Funnel）

排名字段只在 `applyRankFields(item)` 里算。全库 **22 个入库路径**都调它：店铺页、多链接、品牌、跟卖、整站、类目、直连、补采……

- 为什么：父/子排名混算曾导致 1518 条脏数据；`dropContaminatedBsr` / `sanitizeProductFields` / `computeVariantKey` 也都挂在这个收口点。
- 改排名规则 → 只改 `applyRankFields`，别在采集端各写一份。

同类收口还有：
- `mergeZyApiRecord(it, rec)`：智赢 API 记录 → 商品库字段（只覆盖，不臆造）
- `applySiteStatFromRaw()`：一次 Raw 记录 → `siteStats[站点]` + 同站点记录字段
- `endCollectProgress()`：采集结束统一收尾（完整度校验 + 采集记录兜底 + 关浏览器）

---

## 3. BG 是二维的，不能压成一维

事实结构：

```
bgByAccount = { DE:{status,at,aid,name}, GB:{status,...}, ... }   // 账号 × ASIN
bgStatus    = 本站点对应店铺优先，否则最优                            // 兼容字段，供旧界面/筛选
```

- 卡片标签按 `bgByAccount` 逐店铺显示（`DE 可售 · GB 需批准`），**不要**只显示一个状态。
- 只测了部分店铺时，其它店铺状态只进 `bgByAccount`，**不覆盖**本站点 `bgStatus`（避免"串店"）。
- 状态枚举：`OK` / `APPROVAL_REQUIRED` / `NOT_ELIGIBLE` / `ASIN_NOT_FOUND` / `ERROR`。
- `ERROR` 是请求失败，不是业务结论 —— 采集后流水线里对 `ERROR` 的店铺会**重试一次**（2026-11-22 加）。

---

## 4. 采集后流水线：先分类，再花钱取数

用户口径（2026-11-22 确认）：

```
采集完成 → ① BG 全部可用店铺 → ② 按店铺分别分类 → ③ 只对"可售店铺对应的站点"取数据
```

- 分类字段：`sellState` / `sellableSites` / `sellableStoreAbbrs` / `sellableStoreCount` / `postAt`
- 为什么先分类：智赢接口有额度，站点数据每站 1~3 秒；不可售的站点一条都不取。
- 两个站点可售就取两个站点（不是取全部 6 站）。
- 缓存：同商品同店铺 24h 内测过且覆盖全部当前店铺 → 跳过 BG（`bgCacheH`，0=关闭）。
- 实现：`runPostCollect()` + `enqueuePostCollect()`（Promise 队列串行）+ `postJob` 进度。
- 关闭方式：请求体 `post:false` 或 `withBG:false`。

---

## 5. 长任务一律「立即返回 + 进度接口」

踩过的坑：同步等采集跑完 → DSH 同源代理先超时 → 前端只看到 `proxy-unavailable`，其实后台已经跑起来了。

| 任务 | 启动接口 | 进度 | 结果 |
|---|---|---|---|
| 直连采集 | `POST /api/collect/direct` | `/api/collect/direct/status` | 同左（含 samples） |
| 筛选批量补数 | `POST /api/zy/enrich-filtered` | `/api/zy/enrich-status` | 同左 |
| 采集后流水线 | 自动 | `/api/collect/post-status` | 同左 |
| API 采集 | `POST /api/collect/api-run` | `/api/collect/api-status` | 同左 |
| 多链接 | `POST /api/collect/shop-links` | `/api/collect/progress` | `/api/collect/links-result` |
| BG 批量 | `POST /api/bg/scan` | `/api/bg/scan/status` | 同左 |

同时只允许一个同类任务（第二个返回 409 + 当前 job 快照）。

---

## 6. 缓存分层（都是为了省额度/省时间）

| 缓存 | TTL | 位置 |
|---|---|---|
| Amazon cookie（`COOKIE_CACHE`） | 30 分钟 | 内存；取不到/挑战页会**强制刷新重试** |
| 站点多站数据（`__zypSiteStats`） | 30 分钟 | 内存（`/api/zy/asin-sites`） |
| BG 检测（`bgCheckedAt` + `bgByAccount` 覆盖度） | 24 小时 | 商品库字段 |
| 已上架集合（`listedAsinSet`） | 60 秒 | 内存 |
| 选品洞察 | 60 秒 | 内存 |
| 知产查重 | 7 天 | 本地缓存文件 |
| 智赢 token | 自动续期 | `zy-tokens.json` |

改缓存策略时注意：**缓存命中率低会打爆接口，缓存太长会让用户看到旧数据**，默认值都是实测调过的。

---

## 7. 失败可诊断，不要吞掉

- 采集抓 0 个商品时，报错必须带现场：`product@DE 0个 · 最近一次 HTTP: 200 / 1462157B / cookie 12 条`。
- `/api/collect/hc-probe` 专门用来定位「为什么 HTTP 抓不到」：CDP 端口 / cookie 数 / 状态码 / 字节 / ASIN 数 / 是否挑战页。
- 采集记录（`collect-reports.json`）保留每次采集的 links/products/added/updated/errors/耗时。
- `requests.log` 记录所有 API 请求（审计 + 排障）。

---

## 8. 授权与密钥

| 机制 | 做法 | 注意 |
|---|---|---|
| 软件授权 | Ed25519 签名（payload.signature）+ 机器指纹绑定 + 到期日 + 功能位 | 公钥随包（`erp/tools/license-pub.pem`），私钥在作者手里 |
| 无授权时 | 所有 `/api/*` 返回 403（白名单：health/license/static） | 界面顶部显示设备指纹引导换 key |
| 机器指纹 | Windows `MachineGuid` 为主 + 旧 MAC 指纹为别名（换 WiFi 不掉授权） | `machine.json` 别删 |
| ifast 账号 | 密码 AES-256-GCM 加密存 `ifast-accounts.json`，密钥 `.ifast-acct.key` | 密钥丢了账号就解不开 |
| 智赢 token | 明文存 `zy-tokens.json`（本机），过期自动 refresh | 别提交到代码库 |

---

## 9. 兼容性：老数据/老接口不炸

代码里大量 `★ 兼容` 注释，改东西时别把它们"清理"掉：

- `normFilter` 同时认 canonical filter 与 legacy `filter*` 扁平字段。
- `zy-token.json`（单 token）首次读取自动迁移到 `zy-tokens.json`（多账号）。
- `bgStatus` 保留给旧筛选/旧卡片；新字段 `sellState/sellableSites` 并存。
- 商品字段 `rank`（`#123` 字符串）与 `rankParent`（数字）保持同步（`applyRankFields` 里对齐）。
- 清理死代码前，先确认它真的没被别的链路引用（作者曾删过卡片数据区导致整套 UI 空白）。

---

## 10. 性能与资源

- `products.json` 4k+ 条、18MB+：**整份快照写盘**，所以每 100 条才落一次盘；脚本读它要 `--max-old-space-size=4096`。
- 采集并发：BG 默认 3、站点数据默认 2、变体 2、跟卖网页 4 —— 都是防风控/防限流的实测值。
- 列表接口 `limit` 上限 500（不传则最多 500 条 + `truncated:true`），防止一次回 40MB 把宿主 RPC 压垮。
- `slim=1` 裁掉详情大字段（`bulletPoints/offers/variants/images/…`），列表页从数十 MB 降到几百 KB。

---

## 11. 前端设计约束（详见 FRONTEND.md）

- DSH 客户端插件走 `conversation.view` 槽位，四个页签；商品卡片用固定列宽 grid，保证 300px 下不裁字。
- **DSH 界面**跑在 `dsh-app://` 下，直连 `http://127.0.0.1:3088` 会被混合内容拦掉 → 必须走 Host 插件注册的同源代理 `/api/zying-proxy`。
- **浏览器扩展**是 `chrome-extension://` 页面，有 `host_permissions`，可以**直连** 3088（不经代理）。两者链路不同，别混。
- 卡片/面板的字段读取优先级：**商品库字段 > 实时接口**；实时接口只在详情页按需点"获取BG结果"时调。

---

## 12. 做决策时的检查清单

1. 这条数据是「没采到」还是「真的没有」？能不能区分？
2. 这个字段有几个写入点？能不能收敛到一个函数？
3. 这个接口会不会被并发调用？要不要缓存/去重？
4. 失败时用户/Agent 能看懂原因吗？（报错带现场）
5. 改动会不会破坏旧数据/旧界面？（兼容层）
6. 改完怎么验证？有没有可跑的 `--check` / 接口 / 页面？

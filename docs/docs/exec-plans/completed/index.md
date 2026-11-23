# 已完成的计划（Completed）

> 只留"做了什么、为什么、影响哪些文件"，方便回溯。倒序排列。

---

## C-2026-11-22-a 采集后流水线（BG → 分类 → 可售站点取数）

- **背景**：用户要求「采集完先 BG，再把可售分类，然后只对可售的取配送/排名（智赢库）」。
- **口径**：按店铺分别分类；两个站点可售就取两个；所有采集入口默认开启。
- **实现**：`runPostCollect()` / `enqueuePostCollect()` / `postAfterCollect()`；`postJob` + Promise 队列；`/api/collect/post-status`、`/api/collect/post-stop`。
- **字段**：`sellState/sellableSites/sellableStoreAbbrs/sellableStoreCount/postAt` + `siteStats[站点]`。
- **入口**：12 个采集入口全部挂上（含 `hcCollectMode` 的 aod/batch/brand/links 分支）。
- **文件**：`erp/server.js`。
- **验证**：sellable 商品 5 店 → 5 次站点请求；unsellable → 0 次；缓存命中跳过；`post:false` 生效。

## C-2026-11-22-b BG 单店 ERROR 重试 + 结果回填

- **问题**：5 个店铺里偶发 1 个 `ERROR`（限流/超时），按店铺分类会漏判可售站点。
- **修复**：`ERROR` 店铺隔 400ms 重试一次并覆盖；`links-result.bg` 在流水线结束后回填真实统计（原来恒 `0/0`）。
- **文件**：`erp/server.js`。

## C-2026-11-22-c 多链接采集可靠性

- **问题**：DE 连续 4 次「抓 0 个商品」，报错只说"0 个商品"。
- **根因**：`getAmazonCookieHeader` 30 分钟缓存里存了不完整会话 cookie → 一直拿到风控页。
- **修复**：非 200 / 挑战页 / 0 cookie / 无 `data-asin` → 强制刷新 cookie 重试一次；新增 `/api/collect/hc-probe`；失败报错带 `类型@站点 数量 · 最近一次 HTTP 状态/字节/cookie`。
- **文件**：`erp/server.js`。

## C-2026-11-22-d 多链接采集表单加「站点 / 货币」

- 站点选了就强制该站点（并把链接域名一起改写到该站点），不选保持按域名自动；货币用于切换采集浏览器币种。
- 表单渲染器支持 `options` 下拉；`j.__siteGiven` 区分"用户显式选"与"自动推导"。
- **文件**：`lib/client.js`、`erp/server.js`。

## C-2026-11-22-e 商品卡数据区恢复 + 站点表格改版

- **问题**：包内 `productCard` 的数据区被整段删除，卡片只剩主图+按钮（用户反馈"数据不全/UI 错位"）；操作栏还被误嵌在主图容器里被裁切。
- **修复**：操作栏独立一行；数据区改为**按站点表格**（站点/BG/大类排名/配送/价格/上架），去掉店铺名/子类排名/跟卖数；列宽按 300px 实测调过。
- **文件**：`lib/client.js`。

## C-2026-11-22-f 浏览器面板：初始价锁定 + 当前变体高亮

- 初始价按 ASIN 持久化（`SET.initPriceByAsin`），切网页/重载变体不丢，清空输入框解除锁定；锁定态描边蓝色。
- 变体表里当前页 ASIN 显示蓝色 `#4c9aff`。
- **文件**：`02-browser-extension/zy-panel.js`。

## C-2026-11-22-g 环境打通

- 安装插件（junction 进 profile）、装授权、注入智赢 token、修复 DE/UK 采集链路、确认 CDP 与扩展加载路径。
- **文件**：无代码改动（数据目录 + profile）。

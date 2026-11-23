# 产品规格索引（Product Specs）

> 每个功能一份规格：**用户看到什么 / 怎么操作 / 数据从哪来 / 验收标准**。

| 规格 | 覆盖 | 主要代码 |
|---|---|---|
| [collection.md](collection.md) | 采集（6 类入口 + 采集后流水线） | `erp/server.js` 的 `/api/collect/*`、`lib/client.js` CollectPage |
| [product-management.md](product-management.md) | 商品管理（卡片/筛选/补采/导出/详情） | `lib/client.js` ProductPage、`erp/server.js` `/api/products/*` |
| [amazon-panel.md](amazon-panel.md) | 浏览器商品页面板 + 列表页采集条 + ifast 上架器 | `02-browser-extension/*` |
| [ifast-listing.md](ifast-listing.md) | ifast 登录/站点/上架/台账/防重 | `erp/ifast-client.js`、`/api/ifast/*`、`/api/listing/*` |

相关设计：[采集后流水线](../design-docs/collection-pipeline.md) · [算价口径](../design-docs/pricing-model.md) · [授权](../design-docs/licensing-auth.md)

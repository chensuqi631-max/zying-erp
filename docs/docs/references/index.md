# 参考资料索引（References）

> 只放"原始材料"：原厂文档、作者踩坑记录、外部规范。**摘要写在别处，这里保持原样。**

---

## 1. 原厂 / 作者材料

| 文件 | 大小 | 内容 | 什么时候查 |
|---|---|---|---|
| [原厂安装说明-AGENT-INSTALL.md](原厂安装说明-AGENT-INSTALL.md) | 14KB | 作者写的完整安装/复刻说明（含功能地图、验收流程、接口清单） | 换机器安装、想知道作者原意 |
| [协议与数据字典.md](协议与数据字典.md) | 13KB | 内部协议、字段字典、接口出入参 | 对字段含义拿不准 |
| [开发纪律与已知坑.md](开发纪律与已知坑.md) | 149KB | **作者累计的踩坑记录**（排名/品牌/变体/BG/采集/上架/风控…） | 改任何数据/采集/上架逻辑前，先搜关键词 |
| [extension-source-map.md](extension-source-map.md) | — | 浏览器扩展源码地图（文件/函数/存储键/接口） | 改面板、排查注入问题 |

> `开发纪律与已知坑.md` 是最高密度的信息源。搜索技巧：`grep "关键词" 开发纪律与已知坑.md`，关键词用「排名」「品牌」「变体」「BG」「采集」「上架」「风控」「脏数据」。

---

## 2. 项目内规范（本套文档）

| 文档 | 内容 |
|---|---|
| [../AGENTS.md](../../AGENTS.md) | Agent 入口（先读） |
| [../ARCHITECTURE.md](../../ARCHITECTURE.md) | 架构与模块边界 |
| [../DESIGN.md](../../DESIGN.md) | 设计原则与取舍 |
| [../FRONTEND.md](../../FRONTEND.md) | 三个前端结构 |
| [../PRODUCT_SENSE.md](../../PRODUCT_SENSE.md) | 产品定位与验收 |
| [../docs/generated/api-reference.md](../generated/api-reference.md) | 258 接口 |
| [../docs/generated/db-schema.md](../generated/db-schema.md) | 数据字典 |

---

## 3. 外部服务（排障时看）

| 服务 | 用途 | 关键点 |
|---|---|---|
| `seller.zying.net`（智赢） | 商品数据 / BG / 账号 / 运费 | 签名请求（token+timestamp+signature）；有配额；会员到期会拒 |
| `www.ifast.top` | 上架系统 | cookie 登录；`siteId` 按账号实时取 |
| Amazon 各站点 | 采集源 | 会风控；必须 headed 浏览器；cookie 从 CDP 取 |
| UKIPO / EUIPO / USPTO / WIPO | 知产查重 | Cloudflare；`ip-check.js` 用 CDP 过 Turnstile |

---

## 4. 技术参考（当前实现依赖）

| 主题 | 本项目用法 | 备注 |
|---|---|---|
| Chrome Extension MV3 | `manifest.json` v3，service worker `background-3.js` | 面板是 content script 注入 |
| Chrome DevTools Protocol | `CDP 9222`：读 cookie、开标签页、读 DOM、截屏 | 无第三方库，手写 `WebSocket` 调用 |
| Cordis（DSH 插件框架） | `ctx.tools.register` / `ctx.effect` / `slots.inject` | 见 `index.js`、`lib/client.js` 头部 |
| Ed25519 | 授权签名 | Node `crypto.verify(null, …)` |
| AES-256-GCM | ifast 账号密码 | 密钥 `.ifast-acct.key` |

---

## 5. 待补充

- 亚马逊 BG（Brand Gating）接口逆向说明（目前在 `zy-standalone.js` 注释里，尚未单独成文）
- ifast 接口字段字典（散落在 `ifast-client.js`，未成文）

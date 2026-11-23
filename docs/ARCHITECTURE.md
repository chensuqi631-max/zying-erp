# ARCHITECTURE.md — 系统架构

> 读完后你应能回答：有几个进程、谁调谁、数据从哪来到哪去、改一个功能会牵动哪些文件。

---

## 1. 总览

```
┌──────────────────────────── DeepSeek Harness 桌面端（Electron）────────────────────────────┐
│                                                                                          │
│  ┌── Host 插件 zying-erp ─────────────┐        ┌── Client 插件 zying-erp ────────────┐   │
│  │ index.js                          │        │ lib/client.js                       │   │
│  │  · 注册 11 个 zying_* 工具         │        │  · conversation.view 槽位「搞薯条」  │   │
│  │  · 注册 /api/zying-proxy 同源代理  │        │  · 采集面板 / 商品管理 / 知产 / 归档 │   │
│  │  · 启动时 ensureErp()              │        │  · 调用同源代理 → 3088               │   │
│  └───────────────┬───────────────────┘        └──────────────┬─────────────────────┘   │
│                  │ spawn(ELECTRON_RUN_AS_NODE)               │ fetch /api/zying-proxy    │
└──────────────────┼───────────────────────────────────────────┼──────────────────────────┘
                   ▼                                           ▼
        ┌──────────────────────── ERP 后端 127.0.0.1:3088 ────────────────────────┐
        │ erp/server.js（单体，258 路由）                                          │
        │  ├─ 商品库 products.json（内存数组 + 整份快照落盘）                       │
        │  ├─ 采集编排（CDP / HTTP / 智赢接口）                                     │
        │  ├─ BG 检测、算价、上架、导出、知产查重                                    │
        │  └─ 子模块：zy-standalone / links-collector / ip-check / ifast-client …   │
        └───────┬──────────────────────┬──────────────────────┬────────────────────┘
                │ CDP 9222             │ HTTPS                │ HTTPS
                ▼                      ▼                      ▼
      ┌──────────────────┐   ┌────────────────────┐   ┌──────────────────┐
      │ 采集浏览器 Edge   │   │ seller.zying.net   │   │ www.ifast.top    │
      │ （headed，独立    │   │ 智赢数据源（签名   │   │ 上架系统         │
      │ profile，装扩展） │   │ 接口 + BG 探测）   │   │ （cookie/token） │
      └────────┬─────────┘   └────────────────────┘   └──────────────────┘
               │ 注入
               ▼
      ┌─────────────────────────────────────────────┐
      │ 浏览器扩展 v2.11.16                          │
      │ zy-panel.js（商品页） zy-list.js（列表页）    │
      │ bridge.js（ifast 页） background-3.js（SW）  │
      └─────────────────────────────────────────────┘
```

---

## 2. 进程与端口

| 进程 | 谁拉起 | 端口 | 说明 |
|---|---|---|---|
| DSH 桌面端 | 用户 | UI `http://127.0.0.1:54092` 等 | Electron；同时是插件宿主 |
| ERP 后端 | 插件 `ensureErp()` 或手动 | 3088 | 单进程 Node（以 Electron 的 Node 模式跑）；**独立进程**，关 DSH 后仍存活 |
| 采集浏览器 | 用户手动 / `startUserCollectBrowser()` | CDP 9222 | 专用 Edge profile：`%LOCALAPPDATA%\Microsoft\Edge\User` |
| ERP 本地无头浏览器服务 | `/api/browser/start` | 动态（`browserSvc.status().port`） | 「服务器」页截屏/操作，与 9222 分开 |
| 浏览器扩展 SW | Edge | — | Chrome MV3 service worker |

**端口选择逻辑**：`activeCdpPort()` → `ZYING_CDP_PORT` 环境变量 → 用户指定 → 本地浏览器服务 → 回落 `CDP_PORT_USER = 9222`。

---

## 3. 数据流（四条主链）

### 3.1 采集链（最重要）

```
采集入口（/api/collect/*）
   ├─ HTTP 通道：fetch 列表页 HTML → 解析 data-asin（hcFetch/hcListAsins）
   │    └─ cookie 从 CDP 9222 取（getAmazonCookieHeader，30 分钟缓存，失败自动刷新重试）
   ├─ CDP 通道：开标签页读 DOM（cdpListDirectCollect / cdpCategoryCollect …）
   ├─ 智赢通道：zy-standalone.moreAboutAsinRaw（签名 HTTP，无需浏览器，150~500ms/条）
   └─ 单条详情：无头浏览器 headless-finder.js 翻页找 ASIN
        │
        ▼
   入库 products[]（applyRankFields 统一收口）
        │
        ▼
   采集后流水线 runPostCollect（默认开启，排队串行）
        ① BG 检测：bgProbeMulti(asin, all usable accounts)，24h 缓存
        ② 按店铺分类：sellableSites = 可售店铺对应站点，sellState = sellable/unsellable/unknown
        ③ 二次取数：只对可售站点调 MoreAboutAsinRaw → siteStats[站点]
        │
        ▼
   save('products.json')（整份快照）+ 采集记录 collect-reports.json
```

> 详细设计见 [docs/design-docs/collection-pipeline.md](docs/design-docs/collection-pipeline.md)。

### 3.2 BG（Brand Gating）链

```
/api/bg/probe-multi {asin}
   → zy-standalone.bgProbeMulti(asin, aids)   // 每个授权店铺各查一次
   → [{abbr:'GB', status:'OK'|'APPROVAL_REQUIRED'|'NOT_ELIGIBLE'|'ASIN_NOT_FOUND'|'ERROR', aid, name}]
   → 写入 products[].bgByAccount{店铺: {status,at,aid,name}} + bgStatus/bgAbbr/bgCheckedAt
```

`bgStatus` 是**本站点对应店铺优先、否则最优**的兼容字段；真正的事实是二维的 `bgByAccount`。

### 3.3 上架链（ifast）

```
界面/工具 zying_ifast_add  → POST /api/ifast/add
   → ifast-client.js：登录态（cookie.json / accounts.json）
   → 站点 id 实时取 /amazon/site/enable（不同账号 siteId 会变，禁止写死）
   → 写入 ifast 记录（状态 0 待上传）→ 可选 item_upload 提交亚马逊
   → 本地台账 listing-records.json（status=listed）+ 跨店占位 listing-claims.json
```

### 3.4 面板链（浏览器扩展）

```
Amazon 商品页 → 扩展 zy-panel.js 注入 🍟 面板
   → erp(method, '/api/...')  → service worker（background-3.js）转发 / 直接 fetch
   → http://127.0.0.1:3088（靠 manifest 的 host_permissions 直连）
```

两个容易搞错的点（已核实）：

1. **扩展不走 `/api/zying-proxy`**。代理是给 **DSH 界面**用的：Client 插件跑在 `dsh-app://` 安全协议下，直接 fetch `http://127.0.0.1:3088` 会被混合内容拦掉，所以 `index.js` 注册了同源代理 `/api/zying-proxy` 并转发给 3088。
2. 扩展是 `chrome-extension://` 页面 + `host_permissions` 包含 `http://127.0.0.1:3088/*`，因此**可以直连**；实际路径由 `background-3.js` 的消息分发决定。

证据：`docs/references/extension-source-map.md` §2/§6（5 个扩展 js 里 grep `zying-proxy` 零命中）。

---

## 4. 模块边界

| 层 | 可以依赖 | 禁止依赖 |
|---|---|---|
| `index.js`（Host） | `lib/erp-launcher.js`、Cordis ctx | 直接读 `erp/` 内部模块 |
| `lib/client.js`（Client） | 只能走 HTTP（`/api/zying-proxy` / 3088） | 不能 import 后端模块 |
| `erp/server.js` | 所有 `erp/*.js` 子模块、Node 内置、第三方（见 package.json） | 不能依赖 DSH |
| `erp/*.js` 子模块 | 其它子模块、Node 内置 | 不应反依赖 `server.js`（server.js 是编排层） |
| 浏览器扩展 | `chrome.*` API、HTTP（经代理或直连 ifast） | 不能访问本地文件 |

**`server.js` 是唯一的编排层**：258 个路由、商品库内存态、任务状态（`directJob/enrichJob/postJob/bgJob/zyApiJob/collectProgress`）都在这里。子模块只做纯功能。

---

## 5. 状态与并发

| 状态 | 位置 | 并发约束 |
|---|---|---|
| 商品库 | `products[]`（内存）+ `products.json` | 整份快照写盘（`save()`），采集/流水线/界面修改都改同一数组 |
| 采集进度 | `collectProgress`（内存） | 一次只允许一个采集在跑；`endCollectProgress()` 必调 |
| 采集后流水线 | `postJob` + `postQueue`（Promise 队列） | **串行**排队，避免打爆智赢接口 |
| BG 批量 | `bgJob` | 与 `zyApiJob` 互斥（共用插件会话额度） |
| 筛选后批量补数 | `enrichJob` | 单实例（409 拒绝） |
| 直连采集 | `directJob` | 单实例 |
| 多链接断点 | `data/link-jobs/job-*.json` | 任务级串行 + 单元级重试退避 |

> 经验法则：**一切长任务都要「立即返回 + 另一个接口查进度」**，否则 DSH 同源代理会先超时（`proxy-unavailable`）。

---

## 6. 存储布局

```
C:\Users\www\.zying-erp\data\
├─ products.json            商品库（整份快照，当前 ~18MB / 4k+ 条）
├─ listing-records.json     上架台账
├─ listing-claims.json      跨店占位
├─ selection-archive.json   选品归档
├─ collect-reports.json     采集记录
├─ notify.json              通知
├─ shops.json               店铺注册
├─ rates.json               汇率/费率
├─ zy-tokens.json           智赢 token（多账号，activeId）
├─ zy-token.json            旧版单 token（兼容）
├─ ifast-accounts.json      ifast 账号（密码 AES-256-GCM）
├─ ifast-cookie.json        ifast 登录态
├─ .ifast-acct.key          账号加密密钥（32B，别删）
├─ license.key              授权
├─ machine.json             机器 ID
├─ zy-freight-surcharge.json 燃油附加
├─ link-jobs\               多链接任务断点（按需创建）
├─ requests.log             请求审计（会涨，~240KB+）
├─ server.log               启动日志
└─ crash.log                崩溃日志
```

字段级字典见 [docs/generated/db-schema.md](docs/generated/db-schema.md)。

---

## 7. 外部依赖与失败模式

| 依赖 | 用途 | 失败表现 | 应对 |
|---|---|---|---|
| `seller.zying.net`（智赢） | 商品数据、BG、账号、运费 | `还没有 token` / `会员到期请续费` / 限流 500 | 刷新 token、降并发、等几分钟 |
| `www.ifast.top` | 上架 | 未登录 / cookie 过期 / siteId 变化 | 重新登录、`/api/ifast/status` 查站点 |
| Amazon 各站点 | 页面/列表/店铺 | 202/挑战页、空 `data-asin` | 见 `/api/collect/hc-probe`；换 headed 浏览器、刷新 cookie |
| Amazon 官方商标库（UKIPO/EUIPO/USPTO…） | 知产查重 | Cloudflare 拦截 | `ip-check.js` 用 CDP 过一次 Turnstile 拿 `cf_clearance` |
| DSH 本身 | 宿主 | 客户端插件未注册/重复注册 | 见 `client.js` 尾部「重复执行保护」 |

---

## 8. 为什么是这种形态（关键取舍）

1. **单文件约 2.1 万行 server.js**：历史演进结果，优点是"改一处不用跨文件找"，缺点是语法风险高 → 必须在改前备份、改后 `--check`。
2. **JSON 文件当数据库**：零部署、可直接拷走备份；代价是整份快照写盘、大库要 4GB 堆。
3. **插件 + 独立后端**：DSH 插件只做 UI/工具/代理，所有能力在 3088，这样浏览器扩展、curl、脚本、Agent 都能复用同一套 API。
4. **浏览器为旁路、接口为主**：能走签名的智赢接口就不开页面；只有必须看页面的（列表、跟卖卖家、UKIPO）才用 CDP。

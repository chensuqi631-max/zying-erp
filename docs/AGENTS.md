# AGENTS.md — 搞薯条（Zying ERP）Agent 入口

> **这是本项目的第一个文件。读完它你应该能：① 知道代码在哪、② 跑起环境、③ 找到任意功能的实现位置、④ 按规矩改代码并验证。**
>
> 约定：**`$PKG` = 本包解压后的根目录**（例：`D:\搞薯条`）。安装步骤见 [INSTALL-AGENT.md](INSTALL-AGENT.md)。
> 详细内容按需跳转，目录见文末 [文档索引](#文档索引)。

---

## 1. 这个项目是什么

「搞薯条」是一套**亚马逊选品 / 跟卖（follow-sell）ERP**，由三块组成：

| 组成 | 说明 | 代码位置 |
|---|---|---|
| **DSH 插件**（`zying-erp` v1.2.4） | 挂进 DeepSeek Harness，提供 11 个 `zying_*` 工具 + 「搞薯条」界面 | `$PKG\01-dsh-plugin\` |
| **ERP 后端**（本地 Node 服务，端口 3088） | 采集、商品库、BG 检测、算价、ifast 上架、知产查重… | `$PKG\01-dsh-plugin\erp\` |
| **浏览器扩展**（v2.11.16） | Amazon 商品页面板 + 列表页采集条 + ifast 上架器 | `$PKG\02-browser-extension\` |

**重要**：`02-browser-extension` 是 Edge 用「加载解压缩的扩展」加载的目录。
**装好后不要重命名/移动这个目录**，否则扩展会失效（需在 `edge://extensions` 重新加载）。

---

## 2. 运行环境（当前这台机器实测状态）

| 项 | 值 |
|---|---|
| ERP 后端 | `http://127.0.0.1:3088`（由插件自动拉起，`node server.js 3088`，以 DSH 自带 Electron 当 Node 跑） |
| 数据目录 | `%USERPROFILE%\.zying-erp\data`（可用环境变量 `ZYING_DATA` 覆盖） |
| 采集浏览器 | Edge + CDP `127.0.0.1:9222`（**必须是 headed + 独立 profile**，headless 会触发 Amazon 风控） |
| 授权文件 | `%USERPROFILE%\.zying-erp\data\license.key`（Ed25519 签名，绑定机器指纹） |
| 智赢 token | `%USERPROFILE%\.zying-erp\data\zy-tokens.json`（多账号，可自动续期） |
| DSH 安装目录 | `<DSH 安装目录>\`（含 `DeepSeek Harness.exe`；下面命令里按实际路径改） |
| profile | `%USERPROFILE%\.dsh\profiles\desktop\node_modules\zying-erp` → junction 指向 `$PKG\01-dsh-plugin` |

> 没有独立 Node.js：所有 JS 校验都用 `$env:ELECTRON_RUN_AS_NODE='1'; & '<DSH 安装目录>\DeepSeek Harness.exe' --check <file>`。

---

## 3. 30 秒自检（任何时候先跑这个）

```powershell
# 1) 后端活着吗 + 授权
Invoke-RestMethod http://127.0.0.1:3088/api/health            # 期望 ok=True
Invoke-RestMethod http://127.0.0.1:3088/api/license/status    # 期望 valid=True
# 2) 智赢数据源 token
Invoke-RestMethod http://127.0.0.1:3088/api/zy/status         # 期望 hasToken=True / tokenValid=True
Invoke-RestMethod http://127.0.0.1:3088/api/zy/accounts       # 期望 5 个店铺 usable
# 3) 采集浏览器
Invoke-RestMethod http://127.0.0.1:9222/json/version          # 期望 Browser: Edg/...
# 4) 商品库
Invoke-RestMethod 'http://127.0.0.1:3088/api/products?limit=1' # 期望 total 有数
```

后端没起来时手动拉起（等价于插件 `lib/erp-launcher.js` 的行为）：

```powershell
$env:ELECTRON_RUN_AS_NODE='1'; $env:ZYING_DATA="$env:USERPROFILE\.zying-erp\data"
Start-Process -FilePath '<DSH 安装目录>\DeepSeek Harness.exe' -ArgumentList 'server.js','3088' `
  -WorkingDirectory '$PKG\01-dsh-plugin\erp' -WindowStyle Hidden
```

---

## 4. 改完代码必须怎么重启（最容易踩）

| 你改的文件 | 必须做什么 |
|---|---|
| `erp/server.js`、`erp/*.js` | **重启 ERP**（杀 3088 进程再拉起）；不需要重启 DSH |
| `lib/client.js`（DSH 界面） | **完全退出 DSH 桌面端再启动**（只按 F5 不生效） |
| `index.js`（工具/代理注册） | 重启 DSH |
| `02-browser-extension/*` | `edge://extensions` → 重新加载 → **刷新商品页**（F5） |

改前先备份：`Copy-Item x.js x.js.bak-before-<日期>-<标签>`；改后必跑 `--check`。

---

## 5. 代码地图（先看这张表再动手）

### 5.1 DSH 插件

| 文件 | 职责 |
|---|---|
| `index.js` | Host 插件：注册 `/api/zying-proxy` 同源代理（浏览器→ERP，绕混合内容）、注册 11 个 `zying_*` 工具、启动时 `ensureErp()` |
| `lib/client.js` | Client 插件：`conversation.view` 槽位（标签「搞薯条」），四个页签：**采集面板 / 商品管理 / 知产查重 / 选品归档** |
| `lib/erp-launcher.js` | 用 `process.execPath + ELECTRON_RUN_AS_NODE=1` 拉起 `erp/server.js 3088`；已在跑则跳过 |

> 行数会随改动变化，不写进文档；按**符号名**搜（`grep "function ProductPage" lib/client.js`）。

### 5.2 ERP 后端（`erp/`）

| 文件 | 职责 |
|---|---|
| `server.js` | **单体主服务**（约 2 万行）：258 个 `/api/*` 路由、商品库读写、采集编排、BG、算价、上架、导出… |
| `zy-standalone.js` | 智赢数据源直连：签名、token 管理/续期、`MoreAboutAsin`、BG 探测、账号列表 |
| `links-collector.js` | 多链接/店铺/品牌 CDP 采集器 |
| `ip-check.js` | 知产查重（UKIPO/EUIPO/USPTO/WIPO 等官方源） |
| `ifast-client.js` | ifast.top 直连（登录/站点/跟卖方案/上架） |
| `link-jobs.js` | 多链接断点续跑任务存储（`data/link-jobs/`） |
| `zy-freight.js` | 运费报价/渠道/燃油附加 |
| `browser-service.js` | 本地无头浏览器服务（服务器页截屏/操作） |
| `headless-finder.js` | 无头浏览器翻列表页找 ASIN |
| `product-insight.js` | 选品洞察（需求强度/风险规则） |
| `selection-score.js` / `selection-cache.js` | 选品打分与缓存 |
| `market-api.js` / `market-prepare.js` / `market-serve.js` | 类目市场分析（准备/查询/服务） |
| `license.js` | 授权校验（Ed25519 + 机器指纹） |
| `zy-accounts.js` / `zying-api.js` | 智赢账号与 API 封装 |
| `blueocean.js` | 蓝海词分析 |
| `wipo-brand.js` | WIPO 品牌查询 |
| `variant-color.js` / `site-links.js` | 变体颜色名、站点链接工具 |

### 5.3 浏览器扩展

| 文件 | 职责 |
|---|---|
| `zy-panel.js` | Amazon **商品详情页**右侧 🍟 面板（信息/算价/变体/上架/BG） |
| `zy-list.js` | Amazon **列表/搜索页**浮层采集条 |
| `bridge.js` | **ifast.top** 页面上架器 + 面板内嵌设置 |
| `background-3.js` | Service worker：消息转发、`chrome.storage`、跨域请求 |
| `settings.js` / `settings.html` | 完整设置页（税率/运费/汇率等高级项） |

> 扩展的文件级函数索引见 [docs/references/extension-source-map.md](docs/references/extension-source-map.md)（含行号，按它现场复核）。

---

## 6. 功能 → 入口 速查

| 你要做的事 | DSH 工具 | 后端接口 | 界面位置 |
|---|---|---|---|
| 体检（后端/授权/商品数） | `zying_health` | `/api/health`、`/api/license/status` | — |
| 按 URL 采集列表页 | `zying_collect_url` | `POST /api/collect/direct` | 采集面板「列表页直采」 |
| 按 ASIN 批量补数据 | `zying_collect_direct` | `POST /api/collect/direct` | 采集面板 |
| 列表页筛选采集 | `zying_list_filtered` | `POST /api/collect/list-filtered` | 采集面板 |
| 列表页直采（CDP） | `zying_list_direct` | `POST /api/collect/list-direct` | 采集面板 |
| 跟卖店铺并行采集 | `zying_follow_shop` | `POST /api/collect/follow-shop-parallel` | 采集面板 |
| 看采集进度 | `zying_collect_status` | `/api/collect/progress`、`/api/collect/direct/status` | 采集面板进度条 |
| 停止采集 | `zying_stop` | `POST /api/collect/stop` | 采集面板「停止」 |
| BG 检测（单/批量） | —（用接口） | `POST /api/bg/probe-multi`、`POST /api/zy/enrich-filtered` | 商品管理「📥 获取BG」 |
| 采集后自动 BG→分类→取站点数据 | 自动 | 见 `docs/design-docs/collection-pipeline.md` | 采集完成后自动跑 |
| ifast 状态/上架/查在架 | `zying_ifast_status` / `zying_ifast_add` / `zying_ifast_list` | `/api/ifast/*` | 扩展面板 / 商品管理上架 |
| 算价（承受价/净利） | —（用接口） | `POST /api/profit/calc` | 商品管理详情页 |
| 导出商品 | —（用接口） | `GET /api/products/export` | 商品管理工具栏 |
| 知产查重 | —（用接口） | `POST /api/ip/search` | 知产查重页签 |

（完整 258 路由见 [docs/generated/api-reference.md](docs/generated/api-reference.md)，11 个工具见 [docs/generated/tool-reference.md](docs/generated/tool-reference.md)。）

---

## 7. 硬规则（违反会出事）

1. **不要编造数据**。库里 `null` = 没采到，`0` = 真的是 0，两者不能混。代码里有大量「宁可 null 也不写 0」的注释，照做。
2. **不要动这些文件**：`data/machine.json`（设备 ID）、`data/.ifast-acct.key`（账号加密密钥）、`data/license.key`、`data/products.json`（19MB 整份快照，手改必坏）。
3. **`products.json` 很大**：任何脚本读它要 `--max-old-space-size=4096`；优先走 `/api/products?limit=N` 而不是直接读文件。
4. **采集浏览器必须 headed**：`--headless` 会触发 Amazon 风控（见 `erp/server.js` 里 `startUserCollectBrowser` 注释）。
5. **ERP 与 BG/站点数据共享同一套接口额度**：并发默认 BG=3、站点=2；不要随便调大。
6. **改 `server.js` 是高风险操作**（约 2.1 万行单文件）：改前备份、改后 `--check`、只做最小改动、优先复用现有函数。
7. **不要用 `node -e` 跑中文/多层引号**（PowerShell 会吃引号），写 `.cjs` 文件再跑。
8. `.ps1` 写中文要 UTF-8 BOM + CRLF；JSON 不要用 `Set-Content -Encoding UTF8`（会带 BOM）。
9. **有两个"造假数据"的接口，除非用户明确要演示，禁止调用**：
   - `POST /api/products/sync` —— 随机改价/月销
   - `POST /api/collect/run` —— 随机生成商品
10. **`/api/products?filter={…}` 只认 `normFilter` 白名单**：`sellState` / `sellableSite` 不在白名单里，必须用**顶层参数**（`?sellState=sellable&sellableSite=uk`）。用 filter 传会被静默忽略（返回全库）。

---

## 8. 典型工作流

### 8.1 「采集一个 Amazon 列表页，并要可跟卖的商品」
```powershell
# 1) 确认环境（第 3 节）
# 2) 采集（异步，立即返回）
$body = @{ url='https://www.amazon.co.uk/s?k=phone+case'; maxItems=50; maxPages=2 } | ConvertTo-Json
Invoke-RestMethod http://127.0.0.1:3088/api/collect/direct -Method POST -Body $body -ContentType application/json
# 3) 等采集 + 采集后流水线（BG→分类→可售站点取数）
Invoke-RestMethod http://127.0.0.1:3088/api/collect/direct/status
Invoke-RestMethod http://127.0.0.1:3088/api/collect/post-status
# 4) 只看可售
Invoke-RestMethod 'http://127.0.0.1:3088/api/products?limit=20&sellState=sellable&sellableSite=uk'
```

### 8.2 「排查采集抓到 0 个商品」
```powershell
Invoke-RestMethod 'http://127.0.0.1:3088/api/collect/hc-probe?site=uk&url=https://www.amazon.co.uk/s%3Fk%3Dtest'
# 看 status / bytes / asinCount / challenge / cookieCount
```

### 8.3 「改 UI 后验证」
1. `client.js` 跑 `--check` → 重启 DSH → 打开「搞薯条」页签 → 看 4 个页签是否正常。
2. 商品卡片应有：品牌/价格 + 「站点·BG·大类排名·配送·价格·上架」6 行表格 + BG 标签 + 标题。

---

## 9. 已知坑（完整版见 references）

- `docs/references/开发纪律与已知坑.md` —— 149KB，作者积累的全部踩坑记录，**改代码前搜一下关键词**（排名/品牌/变体/BG/采集/上架）。
- `docs/references/协议与数据字典.md` —— 内部协议与字段字典（13KB）。

高频几条：

1. 改 `server.js` 必须重启 ERP；改 `client.js` 必须重启 DSH。
2. `applyRankFields()` 是排名字段的唯一收口（父子排名严格分离，父类缺失一律 `null`，绝不拿子类顶）。
3. BG 语义：`OK` 可售 / `APPROVAL_REQUIRED` 需批准 / `NOT_ELIGIBLE` 不可售 / `ASIN_NOT_FOUND` / `ERROR`；**按店铺分别判定**，`bgByAccount` 是原始二维结果。
4. 采集后流水线：采集完成 → BG(全部可用店铺) → 按店铺分类 `sellState/sellableSites` → 只对可售店铺对应站点取 `siteStats`（详见设计文档）。
5. `/api/products` 分页参数是 **offset**，不是 page；`slim=1` 会裁掉 `bulletPoints/offers/variants/images` 等详情字段（但保留 `siteStats/bgByAccount/sellableSites`）。
6. **时间口径**：后端 `now()` 存的是 **UTC**（`/api/health` 的 time 就是 UTC）；`link-jobs.js` 的 `stamp()` 例外（本地时间）。别假设北京时间。
7. **行号口径**：`server.js` 里有孤立 `\r`，PowerShell `Get-Content` 计行会比真实少约 1000 行。引用行号以 `read` 工具 / `grep` 工具为准（`docs/generated/api-reference.md` 用的是 LF 口径）。

---

## 10. 文档索引

| 文档 | 内容 |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | 进程/端口/数据流/模块边界 |
| [DESIGN.md](DESIGN.md) | 设计原则与关键取舍（为什么这么写） |
| [FRONTEND.md](FRONTEND.md) | DSH 界面 + ERP 页面 + 扩展面板的前端结构 |
| [PRODUCT_SENSE.md](PRODUCT_SENSE.md) | 产品定位、用户流程、验收点 |
| [PLANS.md](PLANS.md) | 路线图 + 计划索引 |
| [docs/operations/install.md](docs/operations/install.md) | 从零安装（插件/授权/token/扩展） |
| [docs/operations/runbook.md](docs/operations/runbook.md) | 日常操作手册 + 故障排查 |
| [docs/generated/api-reference.md](docs/generated/api-reference.md) | 258 个后端接口分组说明 |
| [docs/generated/db-schema.md](docs/generated/db-schema.md) | 数据文件/字段字典 |
| [docs/generated/tool-reference.md](docs/generated/tool-reference.md) | 11 个 DSH 工具 |
| [docs/generated/source-map.md](docs/generated/source-map.md) | **源码分类地图（文件级）** |
| [docs/product-specs/](docs/product-specs/index.md) | 功能规格（采集/商品管理/面板/上架） |
| [docs/design-docs/core-beliefs.md](docs/design-docs/core-beliefs.md) | 核心信念（数据真实性等） |
| [docs/exec-plans/](docs/exec-plans/active/index.md) | 进行中/已完成计划、技术债 |
| [docs/references/](docs/references/index.md) | 原厂文档、扩展源码地图 |

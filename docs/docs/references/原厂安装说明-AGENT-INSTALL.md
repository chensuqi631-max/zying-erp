# 搞薯条（Zying）完整安装与复刻说明 — 给 Agent 用

> 本包是「搞薯条」的**完整可运行源码**，包含两部分：
> 1. `01-dsh-plugin/` — DeepSeek Harness（DSH）客户端插件（含本地 ERP 后端）
> 2. `02-browser-extension/` — 浏览器扩展（Amazon 商品页面板 + 采集 + ifast 上架器面板）
>
> 目标：按本文装好后，功能与生产环境**完全一致**。文中每个「✅ 验证」都可以直接跑。

---

## 0. 环境要求

| 项 | 要求 |
|---|---|
| 操作系统 | Windows（生产环境 Win10/Win11） |
| DSH | DeepSeek Harness **桌面端**（Not Web 版），已登录可用 |
| 浏览器 | Microsoft Edge（生产用 Edge 157+）或任意 Chromium 内核 |
| Node.js | 不需要单独装：DSH 自带 Electron，用 `ELECTRON_RUN_AS_NODE=1` 跑后端 |
| 端口 | ERP 后端 **3088**；采集浏览器 CDP **9222**（可选 9333/9334 为其它用途） |
| 网络 | 需要能访问：`https://seller.zying.net`（智赢数据源）、`https://www.ifast.top`（上架系统）、Amazon 各站点 |

---

## 1. 安装 DSH 插件（01-dsh-plugin）

### 1.1 复制到 profile

DSH 的插件按「包名」从 profile 的 node_modules 加载。把 `01-dsh-plugin` 整个目录复制为：

```
C:\Users\<用户名>\.dsh\profiles\desktop\node_modules\zying-erp\
```

或者用目录联接（推荐，方便改代码）：

```powershell
New-Item -ItemType Junction `
  -Path "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\zying-erp" `
  -Target "<本包解压路径>\01-dsh-plugin"
```

### 1.2 数据目录

默认 `C:\Users\<用户名>\.zying-erp\data\`（可用环境变量 `ZYING_DATA` 覆盖）。

首次启动会自动创建，包含：
```
products.json          商品库（很大，几十~几百 MB）
listing-records.json   上架记录
ifast-cookie.json      ifast 登录态（cookie，明文，权限 600）
ifast-accounts.json    已保存的 ifast 账号（密码 AES-256-GCM 加密）
.ifast-acct.key        账号加密密钥（不要丢）
collect-reports.json   采集报告
```

> ⚠ 迁移/备份时，`data/` 整个目录才是完整数据；只拷代码等于空库。

### 1.3 重启 DSH

保存后**完全退出 DSH 桌面端再启动**（客户端插件改动必须重启）。

启动后插件 `index.js` 会自动把本地 ERP 拉起来（端口 3088）。

✅ **验证 1（后端活着）**
```powershell
Invoke-RestMethod http://127.0.0.1:3088/api/health
# 期望: ok=True
```

如果没起来，手动启动（开发调试用）：

```powershell
$env:ELECTRON_RUN_AS_NODE='1'
$env:ZYING_DATA="$env:USERPROFILE\.zying-erp\data"
Start-Process -FilePath "<DSH安装目录>\新建文件夹\DeepSeek Harness.exe" `
  -ArgumentList 'server.js','3088' `
  -WorkingDirectory "<本包>\01-dsh-plugin\erp" `
  -RedirectStandardOutput "$env:USERPROFILE\.zying-erp\erp.log" `
  -RedirectStandardError  "$env:USERPROFILE\.zying-erp\erp.err.log" -WindowStyle Hidden
```

> 常见坑：`EADDRINUSE` 说明已有实例在跑 —— 先找占用 3088 的进程杀掉再启动：
> `Get-NetTCPConnection -LocalPort 3088 -State Listen | % { Stop-Process -Id $_.OwningProcess -Force }`

---

## 2. 安装浏览器扩展（02-browser-extension）

### 2.1 加载扩展

Edge → `edge://extensions` → 打开「开发人员模式」→「加载解压缩的扩展」→ 选 `02-browser-extension` 目录。

扩展会注入：
- `https://www.amazon.*/*`（含 amazon.co.uk/de/fr/it/es/com.au 等）→ 商品详情页面板 `zy-panel.js`、列表页 `zy-list.js`
- `https://www.ifast.top/*` → 上架器面板 `bridge.js`

### 2.2 采集浏览器（推荐专用 profile + CDP）

生产用独立 Edge profile 并开 CDP 9222（智赢/ifast/Amazon 共用一个已登录浏览器）：

```powershell
$edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
Start-Process $edge -ArgumentList @(
  '--remote-debugging-port=9222',
  "--user-data-dir=$env:LOCALAPPDATA\Microsoft\Edge\User",
  '--no-first-run','--no-default-browser-check',
  '--disable-features=DisableLoadExtensionCommandLineSwitch',
  "--load-extension=<本包>\02-browser-extension",
  'https://www.amazon.co.uk/'
)
```

✅ **验证 2（CDP 可用）**
```powershell
Invoke-RestMethod http://127.0.0.1:9222/json/version
# 期望: Browser: Edg/...
```

> 扩展文件改动后：`edge://extensions` 点「重新加载」，然后**刷新页面**。
> 面板内已内置「Extension context invalidated → 自动刷新页面」处理。

---

## 3. 功能地图（复刻验收点）

| # | 功能 | 位置 | 验证方法 |
|---|---|---|---|
| 1 | Amazon 商品页面板（BG/排名/价格/上架店铺/变体/算价） | 浏览器商品页右侧 🍟 圆球（默认收起，点开） | 打开任意商品页，看圆球与面板数据 |
| 2 | 列表页采集 | Amazon 搜索/类目页浮层 | 列表页右上出现采集工具条 |
| 3 | 商品管理（筛选/卡片多站点/批量操作） | DSH GUI → 商品管理 | 打开任意商品看卡片多站点行 |
| 4 | **BG 获取（含店铺/站点选择弹窗）** | 商品管理工具栏「📥 获取BG」 | 见 §4.1 |
| 5 | **仅BG（勾选站点时也取站点数据）** | 商品管理工具栏「⚡ 仅BG(快)」 | 见 §4.1 |
| 6 | 多站点数据（排名/配送/跟卖/中国卖家/价格/链接） | 卡片底部 + 商品详情页多站点卡 | 见 §4.2 |
| 7 | 定价表口径算价（K=0.68/0.85 + 德国 −3） | 商品页面板「承受价」 | 见 §4.3 |
| 8 | 承受价可手填并持久化 | 面板表格「承受价」列 | 填值→刷新页面仍在 |
| 9 | 初始± / 采购¥ / ± 列的「↓填充」 | 面板表格表头 | 点按钮，整列填充 |
| 10 | 采集入库（页面 + 数据源，不再自动 BG） | 商品页面板/采集器 | 采一个商品：基础数据入库、BG 为空 |
| 11 | ifast 直连：登录/多账号保存/切换 | 面板设置 → 🔗 ifast 直连 | 见 §4.4 |
| 12 | ifast 上架（创建记录，可选提交亚马逊） | 面板「🚀 上架到 ifast」 | 见 §4.5 |
| 13 | 商品库本地重算刷新 | 商品管理「⟳ 刷新库数据」 | 秒级返回统计 |
| 14 | ifast 面板内嵌设置（不再开独立设置页） | ifast 页面板「设置」 | 点开是面板内覆盖层 |

---

## 4. 核心验收流程（可直接照做）

### 4.1 BG 多选（全量 / 仅BG）

前置：已登录智赢（面板【账号管理】或已有 token）与 ifast（§4.4）。

1. 商品管理 → 设置筛选条件 → 点「✓ 应用筛选」
2. 点「📥 获取BG（全部筛选）」→ 弹窗勾选：店铺（BG 用哪些亚马逊账号）+ 站点
3. 开始，进度显示：`done/total · BG · 多站点 · 站点请求 N/命中 M · 失败`
4. 完成后看卡片：每个勾选站点一行（无数据的站点显示 `-`）

**仅BG**：同弹窗；勾了站点 = 一并把站点数据拉下来；不勾站点 = 纯 BG（站点请求 0）。

✅ **验证 3（接口级，无需 UI）**
```powershell
# dryRun：只返回“这个筛选会取到哪些 ASIN/站点/店铺”，不跑检测
$body = @{
  filter = @{ sites = @('uk') }
  limit = 5; dryRun = $true
  abbrs = @('DE','GB'); sites = @('uk','de')
} | ConvertTo-Json -Depth 5
Invoke-RestMethod http://127.0.0.1:3088/api/zy/enrich-filtered -Method POST -Body $body -ContentType application/json

# 实际跑（小批量）
$body2 = @{ filter=@{sites=@('uk')}; limit=2; abbrs=@('GB'); sites=@('uk') } | ConvertTo-Json -Depth 5
Invoke-RestMethod http://127.0.0.1:3088/api/zy/enrich-filtered -Method POST -Body $body2 -ContentType application/json
Invoke-RestMethod http://127.0.0.1:3088/api/zy/enrich-status
# 期望: running -> false, bgFilled>0, siteReq = 商品数×站点数
```

### 4.2 多站点数据接口

```powershell
Invoke-RestMethod "http://127.0.0.1:3088/api/zy/asin-sites?asin=B0CM2W2QKZ&sites=de,uk,fr,it,es,au"
# 返回 items.<站点> = {rankParent,rankChild,fulfill(AMZ/FBA/FBM),sellers,chinaSeller,price,currency,links{brand,seller},bsr[]}
# 以及 bg{站点→店铺状态}、shops[]
```

### 4.3 算价公式（定价表口径）

```
承受价 = (采购 + 运费) × (1 + 利润率) ÷ K ÷ 汇率 + 行内±        （手填承受价优先）
K：UK 0.68 / DE 0.68 / AU 0.85，其它站点默认 0.68；
设置里「税率%」一栏实际存 K（填 0.68=到手比例；填 20 会按 1-20% 兼容）；
德国默认 ± = -3（沿用原面板的站点默认）。
```

示例（与定价表一致）：`(34 × 1.3) ÷ 0.68 ÷ 7.8 − 3 = 5.33 EUR`。

### 4.4 ifast 登录（两种方式）

```powershell
# 方式 A：面板里填账号密码（推荐，可保存多账号）
$b = @{ username='账号'; password='密码'; save=$true } | ConvertTo-Json
Invoke-RestMethod http://127.0.0.1:3088/api/ifast/login -Method POST -Body $b -ContentType application/json

# 方式 B：浏览器里登录 ifast 后，从采集浏览器(9222)同步 cookie
Invoke-RestMethod http://127.0.0.1:3088/api/ifast/cookie -Method POST -Body '{"browser":true}' -ContentType application/json

# 状态 / 店铺 / 站点
Invoke-RestMethod http://127.0.0.1:3088/api/ifast/status
```

多账号：
```powershell
Invoke-RestMethod http://127.0.0.1:3088/api/ifast/accounts                       # 列表（含 active）
Invoke-RestMethod http://127.0.0.1:3088/api/ifast/accounts/login -Method POST -Body '{"username":"账号A"}' -ContentType application/json
Invoke-RestMethod http://127.0.0.1:3088/api/ifast/accounts/delete -Method POST -Body '{"username":"账号A"}' -ContentType application/json
```

### 4.5 ifast 上架（端到端）

面板：勾选变体 + 上架店铺 + 跟卖方案 → 点「🚀 上架到 ifast」→ 确认（显示「初始价/承受价」）→ 成功后 ifast 生成记录（状态 0 待上传）。
勾「提交亚马逊」才会真的提交亚马逊（`item_upload`），默认只写入 ifast。

```powershell
# 直接调接口上架（数值务必来自面板/确认框）
$add = @{ site='uk'; sellingName='全天跟卖'; stock=5; leadDays=5; onOff=1; autoUpload=$false
  items=@(@{ asin='B0XXXXXXXX'; initPrice=15.99; lowerPrice=14.99 }) } | ConvertTo-Json -Depth 5
Invoke-RestMethod http://127.0.0.1:3088/api/ifast/add -Method POST -Body $add -ContentType application/json
# 回查/删除
Invoke-RestMethod http://127.0.0.1:3088/api/ifast/items -Method POST -Body '{"asinSearch":"B0XXXXXXXX"}' -ContentType application/json
Invoke-RestMethod http://127.0.0.1:3088/api/ifast/remove -Method POST -Body '{"ids":[记录id]}' -ContentType application/json
```

> ⚠ 不同 ifast 账号的 siteId 不同（同一国家 id 会变），代码按账号实时读取 `/amazon/site/enable`，不要写死。
> ⚠ 会员到期账号调用商品/上架接口会返回「会员到期,请续费」。

---

## 5. 关键接口清单（后端）

| 接口 | 说明 |
|---|---|
| `GET /api/health` | 健康检查 |
| `GET /api/products?limit=&offset=&slim=1&filter=<JSON>` | 商品列表（注意：分页参数是 **offset**，不是 page） |
| `POST /api/zy/variants {asin, site}` | 商品变体（页面数据源） |
| `GET /api/zy/asin-sites?asin=&sites=` | 多站点数据 + BG + 店铺列表 |
| `POST /api/zy/product-enrich {asin, sites?/bgOnly?}` | 单商品：全店铺 BG + 站点数据 |
| `POST /api/zy/enrich-filtered {filter, sites, abbrs, limit, bgOnly, dryRun}` | 商品管理批量：筛选→批量 BG/站点 |
| `GET /api/zy/enrich-status` | 批量任务进度（含 siteReq/siteHit/sites/abbrs/mode） |
| `POST /api/bg/by-asin {asin, abbrs[]}` | 单商品 BG |
| `POST /api/bg/probe-multi {asin, aids?, sites?}` | 多店铺 BG（店铺级并发 3） |
| `GET /api/bg/lookup?site=&asins=` | 读库 BG（最多 60 个） |
| `POST /api/zy/refresh-library` | 本地重算：排名/BG/跟卖数/自营 |
| `GET /api/ifast/status` | ifast 登录态 + 店铺/站点 |
| `POST /api/ifast/login` / `accounts/*` / `cookie` | ifast 登录/多账号/浏览器同步 |
| `POST /api/ifast/add` / `items` / `upload` / `remove` / `on-off` | 上架相关 |
| `GET /api/products/export` | 导出（xlsx/csv） |

---

## 6. 已知坑（务必遵守）

1. **改 `server.js` → 必须重启 ERP**；改 `lib/client.js` 或其它客户端文件 → **必须重启 DSH 桌面端**；改扩展 → 重载扩展 + 刷新页面。
2. 改代码前先备份 `xxx.js.bak-before-<日期><标签>`，改完 `node --check`。
3. 不要用 `node -e` 处理中文/多层引号（PowerShell 会吃引号）；写 `.cjs` 文件执行。
4. `.ps1` 写中文需 UTF-8 BOM + CRLF；JSON 别用 `Set-Content -Encoding UTF8`（会带 BOM）。
5. 采集浏览器必须 **headed + CDP 9222 + 专用 profile**；`--headless` 会触发 Amazon 风控。
6. 采集入库默认**不再自动查 BG**（BG 只在商品管理按钮/面板按钮触发）。
7. 数据源对「非商品所在站点」经常没有记录 → 多站点写入为 0 是数据源无数据，不是代码问题；界面会显示 `站点请求 N/命中 M`。
8. `Extension context invalidated`：扩展重载后旧页面脚本失效 → 刷新页面（面板已自动刷新）。
9. 高并发/大库操作慢：BG 每商品约 2 秒；站点 raw 每站点 1~3 秒；批量任务有 `limit/limit=0(全部)`。
10. `products.json` 很大，脚本读它要 `--max-old-space-size=4096` 以上。

---

## 7. 本包已做的清理（相比开发目录）

- 移除全部 `*.bak-*` 备份文件
- 移除未使用的 `popup.html` / `popup.js`（工具栏图标不再弹出 popup，设置只在面板内）
- 删除 `lib/client.js` 中两段已禁用（`return null`）的不可达死代码（上架店铺标签块、选品标签块）
- 删除 `zy-panel.js` 中已无按钮对应的 `data-net-lock` 死处理
- 全部 JS 通过 `node --check`；`manifest.json` 通过 JSON 解析校验（见 `VERIFY.ps1`）

> 说明：`02-browser-extension/settings.html` 仍保留 —— 面板里的「新标签打开 / 打开完整设置页」入口还在用（高级项：税率/运费/汇率）。

---

## 8. 自检脚本

本包根目录带 `VERIFY.ps1`：跑语法检查、manifest 校验、关键文件存在性、ERP 健康检查。

```powershell
pwsh -File .\VERIFY.ps1
```

期望输出全为 `[OK]`，最后 `ALL CHECKS PASSED`。

---

## 9. 版本

- DSH 插件：`zying-erp`（package.json 内 version）
- 浏览器扩展：`manifest.json` version（2.11.16）
- 本包生成时间：2026-11-22

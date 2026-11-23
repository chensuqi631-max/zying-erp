# INSTALL-AGENT.md — 搞薯条（zying-erp）安装与验收（AI 可执行）

> 目标读者：AI Agent 或工程师。目标：在 Windows 机器上把「DSH 插件 + ERP 后端 + 浏览器扩展」装起来并通过第 7 节全部验收。
> 本仓库是**完整源码**（插件 / ERP / 扩展 / 文档），不需要额外下载别的包。

---

## 0. 安全禁忌（先读）

| 禁止 | 原因 |
|---|---|
| 删除/重命名本仓库根目录 | DSH profile 依赖它（或 npm 安装目录）|
| 手改 `%USERPROFILE%\.zying-erp\data` 下的 `products.json` / `machine.json` / `license.key` / `.ifast-acct.key` | 整库快照 / 设备指纹 / 授权 / 加密密钥，改坏不可恢复 |
| 把采集浏览器开成 `--headless` | Amazon 立刻风控，采集返回 0 |
| 未确认调用 `POST /api/ifast/add`、`/api/ifast/upload` | 会真的上架到 ifast / 亚马逊 |
| 调用 `POST /api/products/sync`、`POST /api/collect/run` | 这两个接口会写演示/随机数据 |
| 用 `node -e` 跑中文脚本 | PowerShell 会吃引号；写 `.cjs` 再执行 |

本机若无独立 Node.js，可用 DSH 自带 Electron：
`$env:ELECTRON_RUN_AS_NODE='1'; & '<DSH 安装目录>\DeepSeek Harness.exe' --check <file>`

---

## 1. 前置条件

| 项 | 要求 | 自检 |
|---|---|---|
| OS | Windows 10/11 x64 | `[Environment]::OSVersion.VersionString` |
| DSH | 桌面端 ≥ 0.2.1 | 能打开 DSH 并看到「插件」页 |
| Edge | 已安装 | `Test-Path 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'` |
| 授权 | `license.key`（向作者申请，绑定设备指纹）| 见 4.1 |
| 智赢账号 | 可登录、有可用店铺 | 见 5 |

---

## 2. 安装插件（三选一）

### 2.A 插件市场（推荐）

DSH → **插件 → 插件市场** → 搜索「搞薯条」或「智赢ERP」→ 安装 → 重启 DSH。

### 2.B 命令行安装（GitHub Release tarball）

```powershell
dsh plugin --profile web add "https://github.com/chensuqi631-max/zying-erp/releases/download/v1.3.0/zying-erp-1.3.0.tgz"
# 桌面端用户：在 DSH「设置 → 插件」里安装/启用，不要和运行中的应用抢 profile
```

### 2.C 源码本地安装（开发者）

```powershell
$PKG = 'D:\搞薯条'          # 改成你 clone/解压后的仓库根目录
$PROFILE_DIR = Join-Path $env:USERPROFILE '.dsh\profiles\desktop'
$MODS = Join-Path $PROFILE_DIR 'node_modules'
New-Item -ItemType Directory -Path $MODS -Force | Out-Null
$target = Join-Path $MODS 'zying-erp'
if (Test-Path $target) { (Get-Item $target -Force).Delete() }
New-Item -ItemType Junction -Path $target -Target $PKG
```

再改 `$PROFILE_DIR\package.json`（保留原内容，只加/改两处）：

```json
{
  "dependencies": { "zying-erp": "link:D:/搞薯条" },
  "dsh": { "profile": { "bundles": [ /* 原有项 */, "zying-erp" ] } }
}
```

### 2.D 重启 DSH

完全退出 DSH（托盘也退出）再启动。启动后插件会：
- 注册 11 个 `zying_*` 工具与 `/api/zying-proxy` 代理
- 用 `ELECTRON_RUN_AS_NODE` 自动拉起 `erp/server.js 3088`

```powershell
Invoke-RestMethod http://127.0.0.1:3088/api/health    # 期望 ok=True
```

没起来时手动拉：

```powershell
$env:ELECTRON_RUN_AS_NODE='1'
$env:ZYING_DATA = "$env:USERPROFILE\.zying-erp\data"
Start-Process -FilePath '<DSH 安装目录>\DeepSeek Harness.exe' -ArgumentList 'server.js','3088' `
  -WorkingDirectory '<仓库根>\erp' -WindowStyle Hidden
```

---

## 3. 采集浏览器（必需）

```powershell
& 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe' `
  --remote-debugging-port=9222 --user-data-dir="$env:LOCALAPPDATA\Microsoft\Edge\User" `
  --no-first-run --no-default-browser-check `
  --disable-features=DisableLoadExtensionCommandLineSwitch `
  --load-extension="<仓库根>\extension" https://www.amazon.co.uk/
```

自检：`Invoke-RestMethod http://127.0.0.1:9222/json/version` 返回 `Browser: Edg/...`。

---

## 4. 授权与账号

### 4.1 授权

```powershell
Invoke-RestMethod http://127.0.0.1:3088/api/license/status
# 期望 valid=true；未授权时把作者给的 license.key 放到：
# %USERPROFILE%\.zying-erp\data\license.key
```

### 4.2 智赢账号

面板 ⚙ → 👤 智赢账号管理 → 填账号/密码 → 登录并保存（或 `POST /api/zy/login {"name":"...","pwd":"..."}`）。

```powershell
Invoke-RestMethod http://127.0.0.1:3088/api/zy/status   # tokenValid=true, usable>0
```

### 4.3 ifast（上架用，可选）

面板 ⚙ → 🔗 ifast 直连 → 登录（或「从浏览器同步登录态」）。
> 注意：ifast 的**商品列表接口**对会员到期账号返回「会员到期,请续费」；登录本身仍成功，此时面板上架状态退回本机上次同步的 ifast 快照。

---

## 5. 安装浏览器扩展

1. 解压/定位到仓库 `extension/`（有 `manifest.json` 那一层）
2. `edge://extensions` → 开发人员模式 → **加载解压缩的扩展** → 选 `extension/`
3. 版本应为 **2.11.26**（或更新）
4. 刷新亚马逊商品页（F5），右侧出现 🍟 圆球，点开是面板

扩展内部设置：**只有面板右上 ⚙ 一个入口**（设置网页已删除）。

---

## 6. 首次配置

面板 ⚙ 面板设置内：

| 项 | 说明 |
|---|---|
| 🧾 税率 | 分国家税率（0.68 = 到手比例，20 = 旧百分比兼容），可锁定 |
| 💰 算价 | 利润率、实时汇率开关 |
| 🚚 物流 | 固定「云途普货」，运费实时取 ERP |
| 📤 上架默认值 | 跟卖方案 / 库存 / 备货天数 / 默认站点 |
| 🌐 站点与货币 | 邮编与币种（切站时自动应用）|

---

## 7. 验收（必须全部通过）

```powershell
# 7.1 后端
Invoke-RestMethod http://127.0.0.1:3088/api/health                 # ok=True
Invoke-RestMethod http://127.0.0.1:3088/api/license/status         # valid=True
Invoke-RestMethod http://127.0.0.1:3088/api/zy/status              # hasToken/tokenValid=True
Invoke-RestMethod 'http://127.0.0.1:3088/api/products?limit=1'     # total>0

# 7.2 采集浏览器
Invoke-RestMethod http://127.0.0.1:9222/json/version

# 7.3 多站点数据
Invoke-RestMethod 'http://127.0.0.1:3088/api/zy/asin-sites?asin=B0C65WT53G&sites=uk,de'   # ok=True, items.uk

# 7.4 上架状态（ifast）
Invoke-RestMethod 'http://127.0.0.1:3088/api/ifast/asin-status?asin=B0CM2W2QKZ'           # ok=True

# 7.5 全流程采集（小样本，注意会真的入库）
$body = '{"urls":["https://www.amazon.co.uk/s?me=A15PJQ8QYXNRZR"],"site":"uk","shopPages":1,"maxItems":5,"collectBrands":"0","withBG":false,"post":false,"fullFlow":true,"keepSellableOnly":true}' 
Invoke-RestMethod http://127.0.0.1:3088/api/collect/shop-links -Method POST -Body $body -ContentType application/json
# 轮询 /api/collect/progress 直到 running=false，再 GET /api/collect/links-result
# 期望 fullFlow 里含 collected/filteredOut/bgFilled/sellable/trashed/kept
```

界面验收：

- DSH → 搞薯条：4 个页签正常（采集面板 / 商品管理 / 知产查重 / 选品归档）
- 商品页面板：① 商品信息 + **BG 多站点表**（站点/BG/配送/排名/价格/上架状态/检测时间）
- 点「⟳ 重新检测」表格会刷新
- 面板 ⚙ 打开设置（不再有设置网页）

---

## 8. 重启矩阵

| 改了什么 | 要做什么 |
|---|---|
| `erp/*.js` | 重启 ERP（杀 3088 进程再拉起）|
| `lib/client.js`、`index.js` | 完全退出 DSH 再启动 |
| `extension/*` | `edge://extensions` 重新加载 + 刷新商品页 |

---

## 9. 故障排查

| 现象 | 处理 |
|---|---|
| `/api` 全 403 | 没有有效 license.key（`/api/license/status` 看原因）|
| BG 检测失败「还没有 token」| 面板 ⚙ 登录智赢账号 |
| 采集 0 个商品 | 链接站点与采集站点不一致 / 风控 / 未登录 Edge；看 `/api/collect/hc-probe` |
| 面板连不上 ERP | 3088 未启动；DSH 未重启；`/api/health` 检查 |
| 扩展面板不出现 | 确认是 `/dp/` 详情页；扩展重载后 F5 |
| ifast 上架状态全「未上架」| 本机 ifast 快照为空或 ASIN 未通过本系统上架；会员到期时无法实时查 |

---

## 10. 数据与备份

| 文件 | 内容 |
|---|---|
| `%USERPROFILE%\.zying-erp\data\products.json` | 商品库（整库快照，备份就拷它）|
| `...\listing-records.json` | 上架台账 |
| `...\collect-rules.json` | 采集过滤规则 |
| `...\trash.json` | 全流程回收站（非可售，默认 7 天自动删除）|
| `...\zy-tokens.json` | 智赢登录态 |
| `...\license.key` | 授权 |

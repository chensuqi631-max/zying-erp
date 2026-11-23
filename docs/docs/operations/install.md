# 安装说明（从零到可用）

> 适用：Windows 10/11 + DeepSeek Harness 桌面端 + Microsoft Edge。
> 本机已验证的完整路径都在文中；换机器按同样步骤走。

---

## 0. 前置

| 项 | 要求 |
|---|---|
| 操作系统 | Windows 10/11 x64 |
| DSH | 桌面端（**不是** Web 版），能正常登录 |
| 浏览器 | Microsoft Edge（Chromium 内核即可），用于采集 |
| 网络 | 能访问 `seller.zying.net`、`www.ifast.top`、Amazon 各站点 |
| Node.js | **不需要单独装**：用 DSH 自带的 Electron 以 `ELECTRON_RUN_AS_NODE=1` 跑 |
| 端口 | ERP `3088`、采集浏览器 CDP `9222` 必须空闲 |

---

## 1. 安装 DSH 插件

插件包目录：`01-dsh-plugin/`（= `$PKG\zying-erp`），包名 `zying-erp`。

### 方式 A：本地目录安装（推荐）

在 DSH 里对该目录执行 bundle 安装（插件管理 → Add plugin，或让 Agent 用 `plugin_manager install_bundle`，target 填绝对路径）。
安装后 profile 里会生成 junction：

```
C:\Users\<你>\.dsh\profiles\desktop\node_modules\zying-erp  →  $PKG\zying-erp
```

### 方式 B：手工 junction

```powershell
New-Item -ItemType Junction `
  -Path "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\zying-erp" `
  -Target "$PKG\zying-erp"
```

并在 `~/.dsh/profiles/desktop/package.json` 的 `dependencies` 里加 `"zying-erp": "link:D:/deepseekharness/zying-erp"`，`dsh.profile.bundles` 里加 `"zying-erp"`。

> ⚠️ **junction 目标目录不能删/改名**，否则插件失效。

### 重启 DSH

装完 **完全退出 DSH 再启动**。启动后插件会自动把 ERP 拉起来（端口 3088）。

---

## 2. 授权（license.key）

1. 打开「搞薯条」页签（或直接访问接口）看设备指纹：
   ```powershell
   Invoke-RestMethod http://127.0.0.1:3088/api/license/status
   # 取 fingerprint，例如 7454E54F7EF49D70
   ```
2. 把指纹发给授权方，拿到 `license.key`。
3. 放到数据目录：
   ```
   C:\Users\<你>\.zying-erp\data\license.key
   ```
4. **不用重启**，刷新页面即可（后端每次请求都重新读授权）：
   ```powershell
   Invoke-RestMethod http://127.0.0.1:3088/api/license/status   # 期望 valid=True
   ```

未授权时所有 `/api/*` 会返回 403，界面上只显示"未授权 + 指纹"页。

---

## 3. 智赢数据源 token（必须，否则采集/BG 全失败）

三种方式，任选：

```powershell
# ① 从浏览器插件取（需 CDP 9222 + 智赢选品插件已登录）
Invoke-RestMethod http://127.0.0.1:3088/api/zy/token -Method POST -Body '{"bootstrap":true}' -ContentType application/json

# ② 手动贴 token
$b = @{ token = '<你的 token>' } | ConvertTo-Json
Invoke-RestMethod http://127.0.0.1:3088/api/zy/token -Method POST -Body $b -ContentType application/json

# ③ 账号密码登录（可能要短信验证码）
$b = @{ name='账号'; pwd='密码' } | ConvertTo-Json
Invoke-RestMethod http://127.0.0.1:3088/api/zy/login -Method POST -Body $b -ContentType application/json
```

验证：
```powershell
Invoke-RestMethod http://127.0.0.1:3088/api/zy/status    # hasToken / tokenValid / accounts / usable
```

---

## 4. 采集浏览器（CDP 9222）

```powershell
$edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
Start-Process $edge -ArgumentList @(
  '--remote-debugging-port=9222',
  "--user-data-dir=$env:LOCALAPPDATA\Microsoft\Edge\User",
  '--no-first-run','--no-default-browser-check',
  '--disable-features=DisableLoadExtensionCommandLineSwitch',
  '--load-extension=$PKG\02-browser-extension',
  'https://www.amazon.co.uk/'
)
```

验证：
```powershell
Invoke-RestMethod http://127.0.0.1:9222/json/version     # Browser: Edg/...
```

要点：
- 必须 **headed**（headless 触发 Amazon 风控）
- 用**独立 profile**，且在里面登录 Amazon / 智赢 插件
- 扩展目录变了要同步改 `--load-extension` 路径

---

## 5. 安装浏览器扩展（如果不随浏览器启动）

`edge://extensions` → 打开「开发人员模式」→「加载解压缩的扩展」→ 选：

```
$PKG\02-browser-extension
```

扩展会注入：
- `https://www.amazon.*/*` → 商品页 🍟 面板（`zy-panel.js`）、列表页采集条（`zy-list.js`）
- `https://www.ifast.top/*` → 上架器面板（`bridge.js`）

> 扩展目录名带 `_unpack\…` 是历史原因；**要迁到稳定目录**：复制整个目录 → `edge://extensions` 移除旧的 → 加载新目录 → 刷新页面。迁移后同步改第 4 节的 `--load-extension`。

---

## 6. 数据目录与备份

```
C:\Users\<你>\.zying-erp\data\
```

- **完整备份 = 整个 data 目录**（只拷代码 = 空库）
- 关键不可丢：`license.key`、`.ifast-acct.key`、`products.json`、`listing-records.json`、`zy-tokens.json`、`ifast-accounts.json`
- 迁移到新机器：拷 data 目录 + 重新申请授权（指纹会变）+ 重新登录 ifast

---

## 7. 安装后验收清单

```powershell
# 1 后端
Invoke-RestMethod http://127.0.0.1:3088/api/health            # ok=True
# 2 授权
Invoke-RestMethod http://127.0.0.1:3088/api/license/status    # valid=True
# 3 数据源
Invoke-RestMethod http://127.0.0.1:3088/api/zy/status         # tokenValid=True, usable=5
# 4 采集浏览器
Invoke-RestMethod http://127.0.0.1:9222/json/version
# 5 HTTP 抓取链路
Invoke-RestMethod 'http://127.0.0.1:3088/api/collect/hc-probe?site=uk&url=https://www.amazon.co.uk/s%3Fk%3Dtest'
#    ok=True / status=200 / asinCount>0
# 6 界面：DSH 打开「搞薯条」→ 四个页签可点 → 商品管理能出卡片
```

六项全过 = 可用。

---

## 8. 卸载

1. DSH 插件管理里移除 `zying-erp`（或删 profile 里的 junction + `package.json` 依赖）
2. 停 ERP：`Get-NetTCPConnection -LocalPort 3088 -State Listen | % { Stop-Process -Id $_.OwningProcess -Force }`
3. `edge://extensions` 移除「搞薯条」
4. 数据目录 `~/.zying-erp` 自行决定是否保留（含授权与账号密钥）

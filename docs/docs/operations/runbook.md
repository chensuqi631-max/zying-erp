# 操作手册 / 故障排查（Runbook）

> 日常怎么用、坏了怎么修。命令都是 PowerShell，直接可跑。

---

## 1. 每日自检（30 秒）

```powershell
Invoke-RestMethod http://127.0.0.1:3088/api/health                       # ok=True
Invoke-RestMethod http://127.0.0.1:3088/api/license/status               # valid=True
Invoke-RestMethod http://127.0.0.1:3088/api/zy/status                    # tokenValid=True
Invoke-RestMethod http://127.0.0.1:9222/json/version                     # 采集浏览器在
(Invoke-RestMethod 'http://127.0.0.1:3088/api/products?limit=1').total    # 库里有数
```

---

## 2. 采集

### 2.1 列表页直采（最常用，异步）

```powershell
$b = @{ url='https://www.amazon.co.uk/s?k=phone+case'; maxItems=50; maxPages=2 } | ConvertTo-Json
Invoke-RestMethod http://127.0.0.1:3088/api/collect/direct -Method POST -Body $b -ContentType application/json

# 看进度
Invoke-RestMethod http://127.0.0.1:3088/api/collect/direct/status
# 看采集后流水线（BG→分类→站点数据）
Invoke-RestMethod http://127.0.0.1:3088/api/collect/post-status
```

### 2.2 列表页筛选采集（采集时先筛掉一部分）

```powershell
$b = @{ url='https://www.amazon.co.uk/s?k=phone+case'; maxItems=100; maxPages=2
        filter=@{ fulfill='FBA'; rankMax=100000 } } | ConvertTo-Json -Depth 5
Invoke-RestMethod http://127.0.0.1:3088/api/collect/list-filtered -Method POST -Body $b -ContentType application/json
```

### 2.3 多链接采集（店铺/卖家/商品链接混着贴）

```powershell
$b = @{ urls=@('https://www.amazon.co.uk/s?k=phone+case')
        site=''; currency=''      # 留空=按链接域名；选了站点会强制按该站点
        shopPages=1; maxItems=20; collectBrands='0' } | ConvertTo-Json
Invoke-RestMethod http://127.0.0.1:3088/api/collect/shop-links -Method POST -Body $b -ContentType application/json
Invoke-RestMethod http://127.0.0.1:3088/api/collect/links-result
```

### 2.4 跟卖店铺采集

```powershell
$b = @{ asins=@('B0CM2W2QKZ'); maxItems=10; maxPages=1; concurrency=4 } | ConvertTo-Json
Invoke-RestMethod http://127.0.0.1:3088/api/collect/follow-shop-parallel -Method POST -Body $b -ContentType application/json
```

### 2.5 停止

```powershell
Invoke-RestMethod http://127.0.0.1:3088/api/collect/stop -Method POST
Invoke-RestMethod http://127.0.0.1:3088/api/collect/post-stop -Method POST
```

---

## 3. BG 与可售分类

```powershell
# 单条（全部店铺）
$b = @{ asin='B0CM2W2QKZ' } | ConvertTo-Json
Invoke-RestMethod http://127.0.0.1:3088/api/bg/probe-multi -Method POST -Body $b -ContentType application/json

# 按筛选批量：BG + 多站点数据（dryRun 先看会跑多少）
$b = @{ filter=@{ sites=@('uk') }; limit=5; dryRun=$true; abbrs=@('GB'); sites=@('uk') } | ConvertTo-Json -Depth 5
Invoke-RestMethod http://127.0.0.1:3088/api/zy/enrich-filtered -Method POST -Body $b -ContentType application/json
```

只看可售：
```powershell
Invoke-RestMethod 'http://127.0.0.1:3088/api/products?limit=20&sellState=sellable&sellableSite=uk'
```

---

## 4. 商品管理与导出

```powershell
# 分页是 offset 不是 page
Invoke-RestMethod 'http://127.0.0.1:3088/api/products?limit=50&offset=0&slim=1'
# 详情
Invoke-RestMethod 'http://127.0.0.1:3088/api/products/detail?asin=B0CM2W2QKZ'
# 导出
Invoke-WebRequest 'http://127.0.0.1:3088/api/products/export?format=xlsx' -OutFile .\products.xlsx
```

「补采」：`POST /api/products/refresh-detail {asins:[…]}`（CDP 读详情页）、`POST /api/products/panel-refresh`（读插件面板）。

---

## 5. 算价与上架

```powershell
# 算价
$b = @{ asin='B0CM2W2QKZ'; site='uk'; cost=34; weightG=1000; margin=0.3 } | ConvertTo-Json
Invoke-RestMethod http://127.0.0.1:3088/api/profit/calc -Method POST -Body $b -ContentType application/json

# ifast 状态（登录态/跟卖方案/站点）
Invoke-RestMethod http://127.0.0.1:3088/api/ifast/status

# 上架（数值必须来自面板/确认框）
$add = @{ site='uk'; sellingName='全天跟卖'; stock=5; leadDays=5; onOff=1; autoUpload=$false
          items=@(@{ asin='B0CM2W2QKZ'; initPrice=15.99; lowerPrice=14.99 }) } | ConvertTo-Json -Depth 5
Invoke-RestMethod http://127.0.0.1:3088/api/ifast/add -Method POST -Body $add -ContentType application/json
```

上架前查重：`GET /api/listing/check?asin=&site=`（`duplicated=true` 表示已上架过）。

---

## 6. 浏览器面板（Amazon）

1. 打开商品页 → 右侧 🍟 圆球 → 点开面板
2. ② 变体区：改「初始价」→ 自动锁定（描边变蓝），切网页不丢；清空输入框解除锁定
3. 当前打开的那个变体，ASIN 显示**蓝色**
4. 面板数据异常先看底部状态栏：`ERP 直连 · 时间` / `ifast 直连 · 已连接`

---

## 7. 故障排查

| 症状 | 先查 | 处理 |
|---|---|---|
| 界面「系统未启动」/ 全部接口 403 | `GET /api/health`、`/api/license/status` | 后端没起→第 9 节手动拉起；授权无效→按 install.md 第 2 节换 key |
| 采集报「还没有 token」 | `GET /api/zy/status` | `POST /api/zy/token {bootstrap:true}` 或账号登录解 |
| 采集抓 0 个商品 | `GET /api/collect/hc-probe?site=uk&url=…` | `challenge=true`/`cookieCount=0` → 刷新采集浏览器登录；`asinCount=0` 且 200 → 链接类型问题（品牌店铺 JS 渲染） |
| `EADDRINUSE` 3088 | 谁占着：`Get-NetTCPConnection -LocalPort 3088 -State Listen` | 杀掉旧进程再起 |
| CDP 9222 连不上 | `GET /api/browser/status` | 用 install.md 第 4 节命令重开采集浏览器 |
| BG 某店 `ERROR` | 通常是限流 | 流水线会自动重试一次；仍失败就稍后重跑该商品 |
| 上架报「已在…上架过」 | `GET /api/listing/check?asin=&site=` | 正常防重；确认要上再走 override |
| 面板「Extension context invalidated」 | — | 扩展重载后必须刷新页面（F5） |
| DSH 界面空白 / 重复注册告警 | DSH 控制台 | 客户端插件改了必须**完全重启 DSH**；不要重复注册同一 bundle id |
| 商品卡显示 `未上榜` 但站点有排名 | `siteStats[站点].rankParent` | 该站点数据没采过 → 重新跑采集/「获取BG」 |
| `products.json` 读爆内存 | — | 用接口分页取，脚本读文件要 `--max-old-space-size=4096` |

---

## 8. 日志与备份

```powershell
Get-Content "$env:USERPROFILE\.zying-erp\data\server.log" -Tail 30
Get-Content "$env:USERPROFILE\.zying-erp\data\requests.log" -Tail 50
Get-Content "$env:USERPROFILE\.zying-erp\data\crash.log" -Tail 30

# 备份（建议每天）
$ts = Get-Date -Format yyyyMMdd-HHmm
Copy-Item "$env:USERPROFILE\.zying-erp\data" "D:\backup\zying-data-$ts" -Recurse
```

---

## 9. ERP 手动起停

```powershell
# 停
$c = Get-NetTCPConnection -LocalPort 3088 -State Listen -ErrorAction SilentlyContinue
if ($c) { $c.OwningProcess | Select-Object -Unique | % { Stop-Process -Id $_ -Force } }

# 起
$env:ELECTRON_RUN_AS_NODE='1'; $env:ZYING_DATA="$env:USERPROFILE\.zying-erp\data"
Start-Process -FilePath 'D:\新建文件夹\DeepSeek Harness.exe' -ArgumentList 'server.js','3088' `
  -WorkingDirectory '$PKG\01-dsh-plugin\erp' -WindowStyle Hidden
```

---

## 10. 改代码后的验证清单

| 改了什么 | 必做 | 验证 |
|---|---|---|
| `erp/server.js` | 备份 → `--check` → 重启 ERP | 第 1 节自检 + 相关接口 |
| `lib/client.js` | `--check` → 完全重启 DSH | 四个页签 + 商品卡片 |
| `02-browser-extension/*` | `edge://extensions` 重新加载 → F5 | 面板能开、数据能刷 |
| 任何 UI 改动 | 300px 卡片宽度下截图确认不裁字 | 见 FRONTEND.md §1.5 |

语法检查（无需装 Node）：
```powershell
$env:ELECTRON_RUN_AS_NODE='1'
& 'D:\新建文件夹\DeepSeek Harness.exe' --check '$PKG\01-dsh-plugin\erp\server.js'
```

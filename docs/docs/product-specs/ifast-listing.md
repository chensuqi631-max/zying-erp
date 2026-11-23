# 规格：ifast 上架（Listing）

> 把商品推到 `www.ifast.top`，可选提交亚马逊；本地留台账防重复。

---

## 1. 链路

```
面板/工具 zying_ifast_add ──► POST /api/ifast/add
   │
   ├─ 登录态：ifast-cookie.json（或 accounts.json + 自动登录）
   ├─ 站点：实时读 /amazon/site/enable（不同账号 siteId 不同，禁止写死）
   ├─ 跟卖方案：/api/ifast/status → shops[]
   ├─ 写入 ifast：状态 0=待上传
   ├─ 可选 autoUpload → item_upload 提交亚马逊（默认只写 ifast）
   └─ 本地台账：data/listing-records.json（status=listed）
              + data/listing-claims.json（跨店占位）
```

---

## 2. 登录与站点

```powershell
# 状态：登录态 / 跟卖方案(sellingId) / 站点(siteId)
Invoke-RestMethod http://127.0.0.1:3088/api/ifast/status

# 方式 A：账号密码（可多账号保存，密码 AES-256-GCM）
$b = @{ username='账号'; password='密码'; save=$true } | ConvertTo-Json
Invoke-RestMethod http://127.0.0.1:3088/api/ifast/login -Method POST -Body $b -ContentType application/json

# 方式 B：从采集浏览器同步 cookie
Invoke-RestMethod http://127.0.0.1:3088/api/ifast/cookie -Method POST -Body '{"browser":true}' -ContentType application/json

# 多账号
Invoke-RestMethod http://127.0.0.1:3088/api/ifast/accounts
Invoke-RestMethod http://127.0.0.1:3088/api/ifast/accounts/login -Method POST -Body '{"username":"账号A"}' -ContentType application/json
```

**注意**：会员到期账号调商品/上架接口会返回「会员到期,请续费」。

---

## 3. 上架

```powershell
$add = @{
  site='uk'; sellingName='全天跟卖'; stock=5; leadDays=5; onOff=1; autoUpload=$false
  items=@(@{ asin='B0CM2W2QKZ'; initPrice=15.99; lowerPrice=14.99 })
} | ConvertTo-Json -Depth 5
Invoke-RestMethod http://127.0.0.1:3088/api/ifast/add -Method POST -Body $add -ContentType application/json
```

- `site` 可传字母（DE/UK/FR/IT/ES/AU）或 `siteId`
- `sellingName` 可传名称或 `sellingId`
- **数值必须来自面板/确认框**（初始价含「初始±」，承受价含逐行采购/利润率/税率/汇率/±/手填）
- 同站点已存在会自动跳过（按台账查重）

查在架 / 删除 / 上下架：

```powershell
Invoke-RestMethod http://127.0.0.1:3088/api/ifast/items -Method POST -Body '{"asinSearch":"B0CM2W2QKZ"}' -ContentType application/json
Invoke-RestMethod http://127.0.0.1:3088/api/ifast/remove -Method POST -Body '{"ids":[记录id]}' -ContentType application/json
Invoke-RestMethod http://127.0.0.1:3088/api/ifast/on-off -Method POST -Body '{"ids":[…],"onOff":0}' -ContentType application/json
```

`itemStatus`：`0` 待上传 / `10` 检查 / `20` 成功 / `30` 失败 / `40` 暂停。

---

## 4. 台账与防重

| 接口 | 用途 |
|---|---|
| `GET /api/listing/check?asin=&site=` | 查重（`duplicated/enforce/blocked/where`） |
| `POST /api/listing/record` | 写一条台账 |
| `POST /api/listing/records` | 列表 |
| `POST /api/listing/records/delete` | 删 |
| `POST /api/listing/ingest` | 外部导入 |
| `POST /api/claims/check` / `commit` | 跨店占位（防两个店上同一个品） |

规则：同 ASIN + 同站点已有 `status=listed` → 默认拦截；别家店铺也有 → `scope=cross-shop`。

---

## 5. 验收标准

1. 上架成功后在 ifast 后台能看到记录，本地 `listing-records.json` 同时有 `listed` 条目。
2. 重复提交同 ASIN 同站点被拦，提示原记录时间/店铺/价格。
3. 面板显示的价格 = 提交的 `initPrice/lowerPrice`（同口径）。
4. `siteId` 换账号后仍能上架（实时读取）。
5. 失败要有 ifast 原始错误信息（会员到期、验证码、站点不支持等）。

---

## 6. 已知边界

- ifast 要求登录态；cookie 过期需重新登录或从浏览器同步。
- 亚马逊提交（`autoUpload`）失败不代表 ifast 记录失败（状态会走到 30）。
- 跨店占位是"提醒 + 可配置拦截"，不是强一致锁；两人同时提交仍可能撞。

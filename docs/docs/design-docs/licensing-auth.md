# 授权与鉴权（Licensing & Auth）

> 四套"身份"别混：**软件授权**（你能不能跑）、**智赢 token**（数据源）、**ifast 登录态**（上架）、**Amazon 浏览器会话**（页面）。

---

## 1. 软件授权（license.key）

**机制**：Ed25519 非对称签名。

```
license.key = base64url(payload) + "." + base64url(signature)
payload = { v, id, name, iat, exp?, devices?, features?, sites?, note }
```

| 项 | 说明 |
|---|---|
| 公钥 | `erp/tools/license-pub.pem`（随包分发） |
| 私钥 | 只在作者手里（`tools/gen-license.js`，不随包） |
| 设备绑定 | `payload.devices[]` 与机器指纹求交集；空数组 = 不绑定 |
| 机器指纹 | 主指纹 = 哈希(hostname/platform/arch/cpu/totalmem/**Windows MachineGuid**)；别名 = 旧的 MAC 指纹（换 WiFi/VPN 不掉授权） |
| 到期 | `payload.exp`；不填 = 永久 |
| 功能位 | `payload.features`；缺省 = 全功能 |

**三种运行模式**（`erp/license.js`）：

| 模式 | 条件 | 行为 |
|---|---|---|
| 开发模式 | `license.config.json` 里 `enforce:false` | 全放行 |
| 已授权 | 验签通过 + 未过期 + 设备匹配 | 按 features 放行 |
| 未授权 | 缺文件/过期/设备不符/被篡改 | 所有 `/api/*` 403（白名单除外） |

**查找顺序**：`ZYING_LICENSE` 环境变量 → `data/license.key` → `erp/license.key` → `插件根/license.key`。

**排障**：
```powershell
Invoke-RestMethod http://127.0.0.1:3088/api/license/status
# valid / reason / fingerprint / licensePath / summary
```
未授权时界面顶部会显示设备指纹与联系方式（`license.config.json` 的 `contact`）。

---

## 2. 智赢数据源 token（seller.zying.net）

- 存 `data/zy-tokens.json`：`{activeId, accounts:[{id,label,token,savedAt,source,lastOkAt,lastErr}]}`（多账号可切换）
- 旧单 token 文件 `zy-token.json` 首次读取自动迁移
- 获取方式：① `POST /api/zy/token {bootstrap:true}`（从浏览器插件 `chrome.storage` 取，需 CDP）② `{token:"..."}` 手动 ③ 账号密码登录 `/api/zy/login`（可能要短信）
- 过期：`callAuto` 收到 401 会调续期并把新 token 写回；失败则 `tokenValid=false`
- 状态：`GET /api/zy/status` → `hasToken/tokenValid/accounts/usable/quota`

**签名**：每个请求带 `token`、`timestamp`、`signature`（`appclient:3`、`version:v1.1`），由 `zy-standalone.js` 的 `sign()` 生成。

---

## 3. ifast.top 登录态

| 文件 | 内容 | 说明 |
|---|---|---|
| `data/ifast-accounts.json` | 账号列表（密码 **AES-256-GCM** 加密） | 只在登录时解密，不回传 |
| `data/.ifast-acct.key` | 32 字节加密密钥 | **丢了账号就解不开** |
| `data/ifast-cookie.json` | 登录 cookie（明文，权限 600） | 可从采集浏览器同步（`POST /api/ifast/cookie {browser:true}`） |

接口：`/api/ifast/login`、`/api/ifast/status`、`/api/ifast/cookie`、`/api/ifast/accounts*`。

注意：`siteId` 每个账号不同，代码实时读 `/amazon/site/enable`，**不要写死**。

---

## 4. Amazon 会话（采集浏览器）

- 走 CDP `9222` 从浏览器读 cookie（`getAmazonCookieHeader`，30 分钟缓存）
- 失败自愈：非 200 / 挑战页 / 0 cookie / 页面无 `data-asin` → 强制刷新 cookie 重试一次
- 地址/币种：`localeFixHttp(site, {zip, currency})` 写 cookie（如德国 Berlin 10115 / EUR）
- 必须 **headed + 独立 profile**；headless 会触发风控

---

## 5. API 层的鉴权边界

- 3088 只监听 `127.0.0.1`，不做认证（本地单机工具）。
- 授权未通过时，除白名单外全部 403。
- DSH 里的界面通过 `/api/zying-proxy`（同源）访问，避免混合内容。
- 浏览器扩展同理只走代理。

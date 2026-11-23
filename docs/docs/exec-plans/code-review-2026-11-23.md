# 代码审查报告 · 2026-11-23

> 范围：DSH 插件（`index.js` / `lib/client.js` / `lib/erp-launcher.js`）、ERP 后端（`erp/server.js` + 23 个模块）、浏览器扩展（5 个 js + manifest）。
> 方法：① 30 个 JS 文件全量 `--check`；② 静态扫描（重复函数体、同作用域同名、只定义未使用、死分支标记）；③ 定向代码阅读；④ 只读接口印证；⑤ 扩展部分由子代理产出 395 行专项报告（本文件已抽样复核关键条）。
> **诚实边界**：`server.js` 21,190 行未逐行通读，只做了结构扫描 + 高风险区定向审查；`client.js` 以结构与热点为主，未覆盖每个交互分支。

---

## A. 已确认 Bug

### A1（高）面板切商品时，旧异步响应覆盖新数据；重量/运费沿用上一个商品
- `zy-panel.js:390-400`（listing 响应不校验 ASIN）、`:474-483`（loadFreight 无请求令牌、失败不清 `S.freight`）、`:448-449`（loadAll 不重置 `S.weightG`）
- 触发：加载中切变体/切商品（1.5s 路由轮询会再发 `loadAll`），或连续点刷新。
- 影响：**上架提交的 `initPrice/lowerPrice/weightKg` 可能来自上一个商品或晚到响应**；④ 的"已上架"徽章同理。
- 复核：`zy-panel.js:448-449` 确认 `else if (!S.weightG)` 只改 `weightSrc`、不重置重量。

### A2（高）加载中（`S.busy`）URL 变化被永久丢弃，BG 只在启动查一次
- `zy-panel.js:339`（`if (S.busy) return;`）+ `:1779-1781`（`lastUrl` 先更新再调 `loadAll`）
- 影响：面板停在旧商品直到手动刷新；`S.bg` 不随商品重置。
- 复核：两处代码与描述一致。

### A3（中）面板→后台→ERP 全链路零超时，`S.busy` 无兜底
- `zy-panel.js:72-94`（send/erp 无超时）、`background-3.js:33-50`（fetch 无 AbortSignal）
- 影响：ERP 挂起时 `Promise.all` 永不 settle → 面板永久"加载中…"，只能 F5。
- 复核：面板文件内无 `AbortSignal`。

### A4（中）`zyp_v3_settings` 整对象读改写 + 无 `storage.onChanged`
- `zy-panel.js:107-132`（启动读一次、保存写整份）、锁定价写点 `:1507/:1516/:1566/:1602`
- 影响：**多标签同时开商品页时，后保存的一方用旧 `SET` 覆盖对方的 `initPriceByAsin`/`manualBearByAsin`** → 刚锁定的初始价无声丢失（正是 2026-11-22 新增的锁定功能）。
- 复核：grep 全文件无 `storage.onChanged`。

### A5（中）面板「🚀 上架」不校验空价格
- `zy-panel.js:1732-1752`：`price==null` → `initPrice:''` 原样进 items；而 `bridge.js:2259-2263` 的 API 通道会 `bad.push('初始价')` 拒绝。
- 影响：两条上传路径口径不一致，可能向 ifast 提交空价 listing。

### A6（中）`loadFreight` 失败分支不清旧运费，数值不校验
- `zy-panel.js:474-483`：失败只设 `S.freightErr`，`S.freight` 保留上一次；`Number(null)=0` / `Number(undefined)=NaN` 会进算价。

### A7（中）`bridge.js` 的 `IFAPI.options()` 把空结果永久缓存
- `bridge.js:2002-2010`、`:2152-2157`：首调失败时 `_opt={sites:[],sells:[]}` 仍写缓存 → 整页生命周期内 API 直连全废，静默回退 DOM 流程。

### A8（中）`refreshShop` 瞬时失败就把 `currentShop` 写 null
- `bridge.js:2882-2892`：只在明确未登录时才该清；网络抖动/页面未就绪也会清 → 上架记录看似"全没了"。

### A9（中低）`bridge.js` 确认层点击无一次性保护，且查顶层 document
- `bridge.js:882-888`（20 轮循环每轮都能点）、`:884` 用 `document.querySelector` 而非 iframe doc。
- 影响：要么重复提交，要么永远点不到确认层。

### A10（中低）`bridge.js` 多变体 DOM 流程仍用硬编码旧 siteId
- `bridge.js:1430` 用 `SITE_ID`（`uk=69131…`），同文件 `:1093-1114` 已承认过期并改实时表；非 6 国直接 `undefined`。

### A11（低）「初始± ↓填充」不落盘
- `zy-panel.js:1635-1647` 只改内存 `v.ipAdj`；刷新后回退（单行编辑会写锁定值，填充不会）。

### A12（低）3 处 `innerHTML` 未转义
- `zy-panel.js:1141`（主图 URL）、`:997`（ifast 账号名/备注）、`bridge.js:2896`（店铺名）。

### A13（低）client.js BG「已 N 天」用 `+08:00` 解析 UTC 字符串
- `client.js:2672`：后端 `bgCheckedAt` 是 UTC，拼 `+08:00` 解析 → 最多偏 8 小时（"已 N 天"提前/延后）。

### A14（低）client.js `listedMap` 只挂载时拉一次
- `client.js:2503-2509`：详情页上架成功后卡片「上架」列不更新，需刷新页面。

### A15（低）`links-result.bg` 回填可能张冠李戴
- `server.js:4705`：流水线结束无条件回填最近 10 分钟内的 `lastLinksResult.bg`；若是其它采集入口触发的流水线，统计会被写到多链接结果上。

### A16（信息）`siteScope / siteScopeMode / siteScopeAt` 写了没人读
- `server.js:4674-4676`、`:14522-14524` 写入；`lib/client.js` 与 `erp/public/app.js` 均无读取 → 死字段。
- 附带逻辑瑕疵：own 站点可售时 `scope` 反而漏掉 own（因 `if (own && own !== 'uk' && t.sites.indexOf(own) < 0)` 与循环里 `s !== own` 同时排除）。

---

## B. 冗余代码

### B1 `client.js`：`fmtMoney` 与 `FmtMoney` 函数体完全相同
- `client.js:210-214` 与 `:217-221`，且 `:216-217` 出现 `}function FmtMoney` 粘连格式（历史误编辑）。
- `fmtNum`（`:99`）无调用，`FmtNum`（`:437`）才是在用的那份。

### B2 `client.js` 20 个"只定义未使用"标识符
`rankChip`(3320) `rowCells`(3494) `foldHidden`(3043) `rankParentCellText`(387) `upd`(923) `toggleSite`(939) `SITES9`(1451) `CAT9`(1452) `COLLECT_ONLY`(1542) `fldC`(1543) `badgePickedTxt`(1740) `kwNo`(2055) `saveTaxOverride`(2106) `add1688Item`(2180) `diffBadge`(2236) `deriveCat`(2926) `brandKeyOf`(3011) `batchClaim`(3054) `tmBadge`(3277) `fmtNum`(99)

> 其中 `rankChip`/`rowCells` 是 2026-11-22 卡片改版后留下的（原表格布局的残余）。

### B3 `siteScope*` 死字段（见 A16）

### B4 扩展侧（子代理报告 R1-R10，已复核抽样）
- **约 300 行不可达**：`bridge.js:1563-1831` 端口/设备面板整链（唯一入口 `zvPortsOpen` 无调用点）、`zvIfastGet`、`zy-panel.js` 的 `bearRow`/`bgTag`/`chOpts`。
- **4 套设置 UI**（settings.html / bridge 内嵌 / 面板内 / panel setWrap 死 iframe），10 个设置项只写不读，`pricing` 键无消费者。
- **8 份站点/货币/税率常量表**，互有缺项（18 站点只覆盖 9 个），`SITE_CUR===CUR_SITE` 逐字重复。
- **3 份算价公式副本**（`bearBase` / `rowCalc` / `uploadBearPrice`），`bearRow` 是第 4 份且已漂移。
- **22 个消息类型无发送方**（约 290 行），`zy-list` 双调度器 + 永不清理的 2s 定时器，`settings.js:685` 顶层调 `initShops()` 作用域错误（每次静默 ReferenceError）。

### B5 `server.js` 结构扫描结论
- 顶层 82 个函数**无同名重复**；`initArchive` 是 IIFE（误报，非死代码）。
- 但 `applySiteStatFromRaw`（`server.js:4434-4473`）对每个 `(asin, site)` 都全表扫 `products`（O(n×站点)），大批量采集时可优化为一次性索引。

---

## C. 建议修复顺序

| 顺序 | 项 | 理由 |
|---|---|---|
| 1 | A1 + A2 | 直接影响上架价与"看到的是不是当前商品" |
| 2 | A3 | 面板卡死是体验硬伤，且已有现成范式（settings.js 用了 AbortSignal.timeout） |
| 3 | A4 | 锁定价多标签互覆盖，会让用户"锁了又没了" |
| 4 | A5 | 空价上架会产生无效 listing |
| 5 | B4 的算价三副本合并 | 口径漂移风险，改动小收益大 |

---

## D. 本次实际执行的检查（可复现）

| 检查 | 命令/方法 | 结果 |
|---|---|---|
| 全量语法 | 30 个 JS 逐个 `--check` | ✅ 全通过 |
| 重复函数体 | `tools/scan-dup-bodies.cjs` | `fmtMoney==FmtMoney`；zy-panel `mm/mu` 同体（不同闭包，属复制粘贴） |
| 未使用标识符 | `tools/count-identifiers.cjs` | client.js 20 个；zy-panel 3 个；bridge 2 个 |
| 顶层同名函数 | `tools/scan-server-fns.cjs` | server.js 无重复 |
| 关键词法 | grep `S.busy` / `AbortSignal` / `siteScope` / `setListedMap` / `lastLinksResult.bg` | 见 A2/A3/A14/A15/A16 |
| 只读接口 | `/api/health`、`/api/products`、`/api/license/status` | 仅印证，不改数据 |

> 审查脚本随包附在 `docs/exec-plans/tools/`（`scan-*.cjs`、`count-identifiers.cjs`），可重跑；`code-review-2026-11-23-extension.md` 是扩展专项全文。

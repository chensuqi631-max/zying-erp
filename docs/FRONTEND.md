# FRONTEND.md — 前端结构

> 三个前端，别搞混：**DSH 客户端插件（主界面）**、**ERP 自带 Web UI（备用）**、**浏览器扩展（Amazon/ifast 页）**。

---

## 1. DSH 客户端插件 `lib/client.js`（约 5.7k 行，主界面）

### 1.1 加载方式（不是普通 ESM）

文件是一个**自注册 bundle**：

```js
window.__ModuleLoader__.load({ id: "zying-erp", factory: (require) => { … } });
```

- `id` 必须与包名 `zying-erp` 一致，否则 DSH 报「加载时未通过 `__ModuleLoader__.load` 注册」。
- 尾部有**重复执行保护**：二次注册会抛 `duplicate factory registration` 并可能把 renderer 内存吃爆（历史 OOM 事故），所以千万别改名/重复注册。

### 1.2 挂载点

```js
slots.inject('conversation.view', …)          // 约 L5745
  → slots.register({ name:'conversation.view', id:'zying-all', order:5, label:'搞薯条' }, …)
```

即：DSH 对话页的一个视图标签「搞薯条」。

### 1.3 组件地图

> 行号是 2026-11-22 的快照，会随改动漂移；**以符号名为准**（`grep "function ProductPage" lib/client.js`）。

| 组件 | 行号（参考） | 职责 |
|---|---|---|
| `ZyRoot` | L5673 | 根：4 个页签 + 授权门禁（未授权显示指纹引导页）+ 全页缩放 |
| `CollectPage` | L646 | 采集面板：采集方式卡片、统一过滤面板、进度、采集日志、多链接任务卡片 |
| `ProductPage` | L2475 | 商品管理：筛选、卡片网格、批量操作、分页、详情弹窗 |
| `DetailPane` | L1829 | 商品详情：字段表、利润测算、多站点数据（实时 `/api/zy/asin-sites`）、上架 |
| `IpPage` | L5161 | 知产查重（UKIPO/EUIPO/USPTO/WIPO…，按站点） |
| `ArchivePage` | L4400 | 选品归档 |
| `ModeModal` | L591 | 采集方式的参数弹窗（字段渲染器，支持 `options` 下拉） |
| `productCard` | L3301 | **商品卡片**（见 1.5） |
| `bgChipOf` | L2626 | BG 徽标（`bgByAccount` 多店铺标签） |
| `MODES` | L134 | 采集方式注册表（新增采集方式改这里） |

### 1.4 页签与样式约定

- 四个页签：`采集面板 / 商品管理 / 知产查重 / 选品归档`。
- 类名前缀：`zywb-*`（工作台基础组件）、`zyp-*`（商品管理/面板）。
- 缩放：整块视图用 CSS `zoom`（`cardScale`），`zying-card-scale` 自定义事件广播；**卡片内部不要再乘倍数**（会缩两次）。
- 金额格式：`FmtMoney(n, cur)` / `FmtNum(n)`（模块顶部，L201/L437）。
- 时间：后端 `now()` 返回的是 **UTC** 字符串（`YYYY-MM-DD HH:mm:ss`，`/api/health` 的 time 就是 UTC）。展示成本地时间要自己 +8 或按 `+08:00` 解析；**不要**默认它已是北京时间。
  - 例外：`link-jobs.js` 的 `stamp()` 用本地 getter，是本地时间（与主库口径不一致，已在 db-schema 里标注）。

### 1.5 商品卡片（当前设计）

```
[主图 301px + 勾选框 + 放大镜 + 收藏]
[操作栏：详情 ▸ | 变体商品 | 补采 | ⧉]
[品牌 ……………………………………… 价格]
[站点 | BG | 大类排名 | 配送 | 价格 | 上架]   ← 6 行站点表格（表头一行）
[● 可售] [可售站点 DE/ES/FR/IT/UK] [月销 n]
[标题（两行截断）]
```

关键实现点：
- 列宽 `26px 46px minmax(46px,1fr) 32px minmax(52px,1fr) 48px`（300px 卡片实测不裁字）。
- 数据来源：`p.siteStats[站点]`（流水线写入）+ `p.bgByAccount[店铺]` + `listedMap[p.asin]`（上架台账，整页只拉一次 `/api/products/listed-set`）。
- 没有多站点数据的商品不渲染这段表格（保持紧凑）。
- 表格里**不显示**店铺名 / 子类排名 / 跟卖数（2026-11-22 产品决定，界面太窄）。

### 1.6 加一个采集方式（配方）

1. 在 `MODES`（L134）里加一项：
   ```js
   { mode:'xxx', icon:'🆕', name:'某某采集', desc:'…', path:'/api/collect/xxx',
     fields:[ { f:'url', label:'链接', ph:'…' }, { f:'site', def:'de', options:[['de','DE'],['uk','UK']] } ],
     hint:'…' }
   ```
2. 字段类型：无 `type` = 文本框；`type:'number'` = 数字；`options:[[值,文案]]` = 下拉（2026-11-22 新增）。
3. 提交逻辑在 `doCollect()`（L1141 附近）：自动把字段塞 body、合并过滤条件 `filter`、校验、POST。
4. 后端在 `erp/server.js` 加对应路由；异步任务记得「立即返回 + 进度接口」。

### 1.7 加一个商品卡字段（配方）

1. 后端确保字段在 `/api/products?slim=1` 里**没被 `DROP` 掉**（`server.js` 的 slim 分支）。
2. 前端 `productCard`（L3301）渲染；需要跨卡片数据就在 `ProductPage` 里统一拉一次（例：`listedMap`）。
3. `--check` → 重启 DSH → 刷新页面验证 300px 卡片不换行。

---

## 2. ERP 自带 Web UI `erp/public/`（备用，非主界面）

| 文件 | 说明 |
|---|---|
| `index.html` + `app.js`（321KB） | 独立网页版工作台（采集/商品/详情/导出），`http://127.0.0.1:3088/` 打开 |
| `products.html` | 商品页（采集结束后面板会 `hcWatchOpen` 打开它并带站点过滤） |
| `style.css` | 样式 |

用途：**不装 DSH 也能用**、给脚本/嵌入用、排障时对照。DSH 里的「搞薯条」页签**不是**它（是 `lib/client.js`）。

---

## 3. 浏览器扩展（Amazon / ifast 页面）

源码：`$PKG\02-browser-extension\`
详细源码地图：[docs/references/extension-source-map.md](docs/references/extension-source-map.md)

### 3.1 三个注入点

| 文件 | 注入页面 | 形态 |
|---|---|---|
| `zy-panel.js` | `https://www.amazon.*/*`（商品详情页） | 右下/右上 🍟 圆球 → 展开面板；**默认收起** |
| `zy-list.js` | Amazon 列表/搜索/类目页 | 右上角浮层采集工具条 + 卡片下信息条 |
| `bridge.js` | `https://www.ifast.top/*` | 上架器面板（含上架记录、设置覆盖层） |

### 3.2 与后端通信

```js
erp('POST', '/api/zy/…', body)   // → background-3.js 消息分发 → http://127.0.0.1:3088
```

- 扩展**直连 3088**（manifest 的 `host_permissions` 含 `http://127.0.0.1:3088/*`），不是走 `/api/zying-proxy`。
- `/api/zying-proxy` 是 **DSH 界面**（`dsh-app://`）专用的同源代理，扩展里零引用（已 grep 核实，见 [docs/references/extension-source-map.md](docs/references/extension-source-map.md)）。
- 不要把"扩展必须走代理"当成事实写进代码或文档。

### 3.3 面板特有交互（2026-11-22 新增）

- **初始价锁定**：每行「初始价」输入框改动后写入 `chrome.storage.local → zyp_v3_settings.initPriceByAsin[ASIN]`，切网页/重载变体后回填；清空输入框 = 解除锁定。锁定态输入框描边蓝色。
- **当前变体高亮**：变体表「变体 / ASIN」列里，页面当前 ASIN（`S.asin`）显示为蓝色 `#4c9aff`。

### 3.4 改动后的生效方式

`edge://extensions` → 找「搞薯条」→ **重新加载** → 回到 Amazon 页面 **F5**。
（扩展热更新不可靠；`Extension context invalidated` 就是没刷新页面。）

---

## 4. 前端通用规范

| 项 | 规范 |
|---|---|
| 语言 | 界面全中文；代码注释中文，保留 `★ 日期` 标记 | 
| 空值 | 显示 `-` / `未采到` / `未上榜`，不要显示 0 冒充 |
| 颜色 | BG：可售 `#237804`、需批准 `#d46b08`、不可售 `#cf1322`；已上架 `#237804`；链接蓝 `#7aa2ff`/`#4c9aff` |
| 按钮 | `zywb-btn` / `zyp-btn`；主操作 `zyp-btn-primary` / `.pri` |
| 表格 | 固定列宽 grid 或 `table.tbl.wtab`，保证窄卡片不换行 |
| 交互 | 单击卡片=勾选、双击=详情（有 200ms 延迟结算逻辑，别乱改） |
| 提示 | 所有异步操作必须有进度/结果文案，不能点了没反应 |

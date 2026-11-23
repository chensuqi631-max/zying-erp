# PLANS.md — 路线图与计划索引

> 计划分三类：**active**（在做）、**completed**（做完留档）、**tech-debt**（欠账）。
> 目录：[docs/exec-plans/active/](docs/exec-plans/active/index.md) · [completed/](docs/exec-plans/completed/index.md) · [tech-debt-tracker.md](docs/exec-plans/tech-debt-tracker.md)

---

## 1. 当前阶段（2026-11 下旬）

目标：**把"采集 → 可售 → 算价 → 上架"这条链跑顺，并且让 Agent 能独立操作**。

已具备：
- 采集：列表页/类目/整站/跟卖/多链接/直连 六类入口，HTTP + CDP 双通道
- 采集后流水线：BG → 按店铺分类 → 只对可售站点取数（默认开启）
- 商品管理：卡片（含 6 行站点表格）、统一筛选、批量 BG/补采/导出
- 上架：ifast 直连、多店铺、台账防重
- 面板：Amazon 商品页 + 列表页 + ifast 页
- Agent 化：11 个 DSH 工具 + 258 个 API

---

## 2. 近期路线（按优先级）

| 优先级 | 事项 | 说明 | 关联文档 |
|---|---|---|---|
| P0 | 商品管理「可售」筛选项接入 UI | 后端已有 `sellState` / `sellableSite` 参数，界面还没暴露 | [docs/product-specs/product-management.md](docs/product-specs/product-management.md) |
| P0 | 站点数据缺失的可解释性 | 非商品站点常无排名，界面需区分「数据源没有」vs「没采到」 | DESIGN.md §1 |
| P1 | 货币选择落到入库口径 | 现在只切采集浏览器币种；若要统一换算需加汇率换算与标记 | docs/design-docs/pricing-model.md |
| P1 | 跟卖采集（follow-shop 全链路）压测 | CDP 路径耗时长，需给出耗时/失败率基线 | docs/product-specs/collection.md |
| P1 | 采集任务可视化 | 多任务并发时只有单份 `collectProgress`，需要任务列表 | ARCHITECTURE.md §5 |
| P2 | 面板与商品库字段对齐检查 | 面板算价 vs 详情页算价，口径要一致 | docs/product-specs/amazon-panel.md |
| P2 | 文档自动化 | `docs/generated/*` 由脚本从代码生成（路由/字段） | 本文 §4 |

---

## 3. 最近完成（本项目改动记录，2026-11-22）

| 日期 | 事项 | 影响文件 |
|---|---|---|
| 2026-11-22 | **采集后流水线**：采集 → BG(全店铺) → 按店铺分类 → 只对可售站点取 配送/排名/跟卖/价格；所有采集入口默认开启，`post:false` 可关 | `erp/server.js` |
| 2026-11-22 | 新增 `post-status` / `post-stop` 接口；BG 单店 `ERROR` 自动重试；`links-result.bg` 回填真实统计 | `erp/server.js` |
| 2026-11-22 | 新增 `/api/products?sellState=&sellableSite=` 筛选；`/api/products/listed-set` 增加 `bySite` 映射 | `erp/server.js` |
| 2026-11-22 | 多链接采集：cookie 失效自愈（挑战页/0 cookie 强制刷新重试）、`/api/collect/hc-probe` 诊断接口、失败报错带 HTTP 现场 | `erp/server.js` |
| 2026-11-22 | 多链接采集表单增加**站点 / 货币**下拉（强制站点会连同链接域名一起改写） | `lib/client.js`、`erp/server.js` |
| 2026-11-22 | 商品卡：补回被删的数据区 → 再改为**站点表格**（站点/BG/大类排名/配送/价格/上架），去掉店铺名/子排名/跟卖数 | `lib/client.js` |
| 2026-11-22 | 浏览器面板：**初始价按 ASIN 锁定**（切页不丢）、**当前变体 ASIN 蓝色** | `02-browser-extension/zy-panel.js` |
| 2026-11-22 | 授权安装、智赢 token 注入、DE/UK 采集链路修复 | 数据目录 / 无需改码 |
| 2026-11-23 | **代码审查**：16 条确认 Bug（面板切页串数据/无超时/锁定价被覆盖/空价上架…）+ 冗余清单（client.js 20 个死标识符、扩展 ~300 行不可达、3 份算价公式） | 报告：[code-review-2026-11-23.md](docs/exec-plans/code-review-2026-11-23.md) |

---

## 4. 文档维护规则
1. **代码改了，文档同批改**：至少改 AGENTS.md 的相关表 + 对应设计/规格文档。
2. `docs/generated/` 下的三份（api-reference / db-schema / tool-reference）**可以重新生成**，手改要留 `<!-- manual -->` 标记。
3. `docs/references/` 里是原厂/作者原始材料（含 149KB 踩坑记录），**只读不改**，要摘要在别处写。
4. 新增功能 → 在 [docs/product-specs/index.md](docs/product-specs/index.md) 挂一条规格；跨模块改动 → 在 [docs/exec-plans/active/](docs/exec-plans/active/index.md) 建计划。

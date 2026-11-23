# 规格：商品管理（Product Management）

> DSH「搞薯条」→ 商品管理页签：看、筛、补、算、上、导。

---

## 1. 页面结构

```
┌ 工具栏：筛选按钮 │ 获取BG(全部筛选) │ 仅BG(快) │ 刷新库数据 │ 导出 │ 卡片缩放 ┐
├ 筛选面板（可折叠）：站点/店铺/配送/卖家/中国卖家/A+/排名/价格/评分/评论/品牌/类目/时间… ┤
├ 选中条：已选 N 个 → 批量BG / 批量补采 / 收藏 / 删除 / 清空 ┤
├ 卡片网格（每页 20/50/100/200） ┤
└ 分页 ┘
```

关键组件：`ProductPage`（`lib/client.js` L2475）、`productCard`（L3301）、`DetailPane`（L1829）。

---

## 2. 商品卡片（当前设计，2026-11-22）

```
[主图 301px + ☑ 勾选 + 🔍 放大镜 + ★ 收藏]
[详情 ▸ | 🔀 变体商品 | 补采 | ⧉]
[品牌 …………………………………………… 价格]
[站点 | BG | 大类排名 | 配送 | 价格 | 上架]  ← 表头 + 6 行（de/fr/it/es/uk/au）
[● 可售] [可售站点 DE/ES/FR/IT/UK] [月销 n]
[标题（2 行截断）]
```

- 每行：`站点 · BG状态(●可售/需批准/不可售) · 大类排名 · 配送(FBA/FBM/AMZ) · 价格+币种 · 上架状态`
- 没数据的站点整行灰显 `—`（明确"没采到"，不是 0）
- 数据来源：`siteStats`（流水线）+ `bgByAccount`（BG）+ `listedMap`（上架台账，整页一次 `/api/products/listed-set`）
- 交互：单击=勾选，双击=详情（200ms 延迟结算）

---

## 3. 筛选

- 统一过滤 schema，前后端同一套（`normFilter` / `filterToQuery` / `/api/filter/desc`）
- 覆盖：站点、店铺、配送方式、卖家维度、中国卖家、A+、页面标识、大排名三态、价格/评分/评论/跟卖/商标/新品区间、类目（含排除法）、品牌、时间窗、变体族
- **可售筛选**（后端已支持，界面待接，见 exec-plans A-001）：
  ```powershell
  GET /api/products?limit=20&sellState=sellable&sellableSite=uk
  ```

---

## 4. 批量操作

| 操作 | 接口 | 说明 |
|---|---|---|
| 获取BG（全部筛选） | `POST /api/zy/enrich-filtered` | BG + 全部站点排名/配送/跟卖（可选 dryRun） |
| 仅BG（快） | 同上 `bgOnly:true` | 只测 BG；勾了站点才取站点数据 |
| 刷新库数据 | `POST /api/zy/refresh-library` | 纯本地重算，秒级 |
| 批量补采 | `POST /api/products/refresh-detail` | CDP 读详情页（慢，每条约 9s） |
| 插件面板补采 | `POST /api/products/panel-refresh` | 读智赢插件面板（商标/月销/尺寸） |
| 收藏/删除/清空 | `/api/products/save` `/delete` `/clear` | — |
| 导出 | `GET /api/products/export?format=xlsx|csv` | 列可配置（`/api/products/export-fields`） |

---

## 5. 商品详情页

分区：基础字段表（含父类/子类排名、跟卖、配送、价格、评分、评论、类目、尺寸重量、上架日）、利润测算、多站点数据（实时 `/api/zy/asin-sites`，含店铺/BG/排名/跟卖/上架/链接）、货源（1688 图搜）、合规。

字段口径见 [../generated/db-schema.md](../generated/db-schema.md)。

---

## 6. 验收标准

1. 卡片 6 行站点表格在 300px 宽下不裁字、不换行。
2. 筛选条件变化后条数正确，清空能恢复。
3. 卡片显示的价格 = 详情页价格 = 导出价格（同口径）。
4. 没有多站点数据的商品不渲染空表格（保持紧凑）。
5. 上架状态与 `/api/listing/check` 一致。

---

## 7. 已知问题

- 「可售」筛选未接入 UI（后端已支持）。
- 站点数据缺失时卡片显示 `—`，但还不能区分"数据源没有"与"没请求过"（TD-07 / A-002）。
- 卡片里不显示店铺名/子类排名/跟卖数（产品决定，空间不足；详情页仍有）。

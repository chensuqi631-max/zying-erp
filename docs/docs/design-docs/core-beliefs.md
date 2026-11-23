# 核心信念（Core Beliefs）

> 这五条决定了这个项目里绝大多数代码为什么长那样。**违反它们的改动一律不合并**。

---

## 1. 数据必须是真的 —— `null` ≠ `0`

- 没采到 → `null` → 界面显示 `-` / `未采到`
- 真的没有（如"未上榜"）→ `rankParentState='not_listed'` → 显示 `未上榜`
- 真的是 0 → `0`

代码里的表现：`price == null ? null : …`、`rankParent == null`、`applyRankFields` 里「父类缺失一律 null」的注释、`aiScore = null`（"无输入不要编 40 分"）。

**反例（已踩过）**：早期把 `price` 写成随机值、把 `followCount` 写死 0、把配送方式写死 FBM —— 全部在注释里被标为事故并清理。

---

## 2. 单一收口（Single Funnel）

同一个语义只能有一个计算入口：

| 语义 | 唯一入口 |
|---|---|
| 排名/父子分类/清洗/变体族键 | `applyRankFields(item)` |
| 智赢 API 记录 → 商品字段 | `mergeZyApiRecord(it, rec)` |
| 一次站点 Raw → `siteStats` | `applySiteStatFromRaw(asin, site, rec)` |
| 采集收尾 | `endCollectProgress()` |
| 过滤条件归一 | `normFilter()` |

**为什么**：曾经 22 个入库路径各算一遍排名，导致 1518 条脏数据；收敛后改一次规则全库生效。

---

## 3. BG 是二维事实

"这个 ASIN 我能不能卖"的答案是 **账号 × ASIN**，不是一个是/否。

- 原始：`bgByAccount = {DE:{status}, GB:{status}, …}`
- 兼容：`bgStatus`（本站点店铺优先）
- 分类：`sellableSites`（可售店铺对应站点）

**禁止**把多个店铺状态合成一个"可售"标签而不说明是哪个店铺。

---

## 4. 只对可售的站点花钱

智赢接口有额度、每站点 1~3 秒。所以：

```
BG 全店铺 → 分类 → 只对 sellableSites 取 siteStats
```

不可售站点**一条都不取**；这也是「站点请求 N / 命中 M」这类指标存在的原因。

---

## 5. 失败必须可诊断

- 每个长任务：**立即返回 + 独立进度接口**
- 每个失败：带现场（HTTP 状态 / cookie 数 / 链接类型 / 站点 / 混淆点）
- 每个批量：`站点请求 N/命中 M/失败 K` 三项一起给，别只说"失败"

「抓 0 个商品」的旧报错被用户投诉过 N 次，现在必须能区分：cookie / 风控挑战 / 链接类型（品牌店铺 JS 渲染）/ 站点不匹配 / 真的没商品。

---

## 附带约定

- **向后兼容优先**：老字段、老文件、老接口参数一律保留（`bgStatus`、`zy-token.json`、legacy filter）。
- **改代码先备份**：`*.bak-before-<日期>-<标签>`；改后 `--check`。
- **注释即历史**：代码里 `★ 2026-xx-xx` 注释记录的是事故与修复，别当废话删掉。

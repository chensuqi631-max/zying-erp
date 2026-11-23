# 源码地图（分类整理）

> 项目由两个可独立部署的部分组成：**DSH 插件**（含 ERP 后端）与**浏览器扩展**。
> 文件保持原位（移动会破坏 DSH 的 junction 和 Edge 的扩展加载路径），这里给出分类索引。

---

## A. DSH 插件 `$PKG\01-dsh-plugin\`

```
zying-erp/
├─ package.json                 # 包名 zying-erp v1.2.4；exports: . / ./client；dsh.bundle/client 声明
├─ cordis.patch.yml             # bundle 补丁：insert id=zying-collect name=zying-erp
├─ index.js                     # 【Host】11 个工具 + /api/zying-proxy + ensureErp
├─ README.md / LICENSE
├─ lib/
│  ├─ client.js                 # 【Client】搞薯条界面（4 页签，5.6k 行，自注册 bundle）
│  └─ erp-launcher.js           # 拉起/探测 ERP（ELECTRON_RUN_AS_NODE）
└─ erp/                         # 【后端】本地 Node 服务（3088）
   ├─ server.js                 # 单体主服务：258 路由 / 商品库 / 采集编排 / 算价 / 上架
   ├─ package.json
   ├─ license.js / license.config.json / tools/license-pub.pem   # 授权
   ├─ tools/zy-security.wasm    # 签名/校验用 wasm
   ├─ vendor/crypto-js.js       # 第三方（智赢签名）
   │
   ├─ 【数据源通道】
   ├─ zy-standalone.js          # 智赢直连：签名/token/MoreAboutAsin/BG/账号
   ├─ zying-api.js              # 智赢 API 封装（批量/重试）
   ├─ zy-accounts.js            # 智赢账号
   ├─ zy-freight.js             # 运费报价/渠道/燃油
   │
   ├─ 【采集】
   ├─ links-collector.js        # 多链接/店铺/品牌 CDP 采集器
   ├─ headless-finder.js        # 无头浏览器翻页找 ASIN
   ├─ browser-service.js        # 本地无头浏览器服务（截屏/操作）
   ├─ link-jobs.js              # 多链接断点任务存储
   ├─ site-links.js             # 链接分类（店铺/卖家/商品/列表）
   │
   ├─ 【上架与台账】
   ├─ ifast-client.js           # ifast.top 直连
   │
   ├─ 【知产 / 选品】
   ├─ ip-check.js               # 知产查重（官方商标库 + CDP 过 Cloudflare）
   ├─ wipo-brand.js             # WIPO 品牌查询
   ├─ blueocean.js              # 蓝海词
   ├─ product-insight.js        # 选品洞察/风险规则
   ├─ selection-score.js        # 选品打分
   ├─ selection-cache.js        # 选品缓存
   ├─ market-api.js             # 类目市场 API
   ├─ market-prepare.js         # 市场数据准备
   ├─ market-serve.js           # 市场数据服务
   ├─ variant-color.js          # 变体颜色名归一
   │
   └─ public/                   # 备用 Web UI（不装 DSH 也能用）
      ├─ index.html / app.js    # 独立工作台（采集/商品/详情/导出）
      ├─ products.html          # 商品页（采集结束会打开它并带站点过滤）
      └─ style.css
```

**分类原则**：`server.js` 只做编排与状态，能力都落在上面那些单职责模块里；`erp/public/` 是备用前端，不参与 DSH 界面。

---

## B. 浏览器扩展 `$PKG\02-browser-extension\`

```
02-browser-extension/
├─ manifest.json      # MV3；v2.11.16；注入 amazon.* / ifast.top；权限 storage/tabs + host
├─ zy-panel.js        # Amazon 商品详情页右侧 🍟 面板（1.7k 行）
├─ zy-list.js         # Amazon 列表/搜索/类目页浮层采集条
├─ bridge.js          # ifast.top 上架器面板 + 设置覆盖层（2.7k 行）
├─ background-3.js    # service worker：消息转发 / storage / 跨域
├─ settings.html      # 完整设置页（独立标签打开）
├─ settings.js        # 设置逻辑（税率/运费/汇率/高级项）
└─ icons/             # 16/48/128 图标
```

详细函数级索引见 [../references/extension-source-map.md](../references/extension-source-map.md)。

---

## C. 文档（本套）

```
$PKG\
├─ AGENTS.md / ARCHITECTURE.md / DESIGN.md / FRONTEND.md / PLANS.md / PRODUCT_SENSE.md
└─ docs/
   ├─ design-docs/     # 为什么这样做（core-beliefs / collection-pipeline / pricing-model / licensing-auth）
   ├─ exec-plans/      # 计划（active / completed / tech-debt）
   ├─ generated/       # 从代码整理出的参考（api-reference / db-schema / tool-reference / 本文件）
   ├─ product-specs/   # 功能规格（采集 / 商品管理 / 面板 / 上架）
   ├─ operations/      # 安装 / 操作与排障
   └─ references/      # 原厂文档与作者踩坑记录（只读）
```

---

## D. 运行时产物（不在代码库里，别提交）

| 路径 | 内容 |
|---|---|
| `C:\Users\<你>\.zying-erp\data\` | 全部业务数据（商品库/台账/token/授权…） |
| `edge://extensions` 加载的扩展目录 | 就是 B 段那个目录（不是拷贝） |
| `C:\Users\<你>\.dsh\profiles\desktop\node_modules\zying-erp` | junction → `A` 段根目录 |
| `erp\server.js.bak-before-20261122-postcollect` | 2026-11-22 采集后流水线改动前的备份（可删） |

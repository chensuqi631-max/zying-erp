// 智赢ERP 采集 — DeepSeek Harness 插件 (Cordis Host 插件)
// 注册采集工具到 harness: 模型可在对话中直接调用 (列表直采/筛选采集/跟卖并行/停止/系统状态)
// 所有工具通过 fetch 调用本地智赢ERP后端 (http://127.0.0.1:3088; 插件启动时会自动把它拉起来)
import { ensureErp, isUp, license } from './lib/erp-launcher.js';

const API = 'http://127.0.0.1:3088';
/** 调 3088 系统接口 (GET/POST JSON), 带超时 —— 采集类长请求可以传更长 timeoutMs */
async function sys(path, body, timeoutMs = 30000) {
  const ctl = timeoutMs > 0 ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
  try {
    const r = await fetch(API + path, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctl ? ctl.signal : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((j && j.error) || ('系统请求失败 (HTTP ' + r.status + ')'));
    return j;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 构建工具对象 (等效 defineTool 返回结构: name/description/parameters(output schema)/output/render/execute) */
function tool(name, description, parameters, execute) {
  const required = Object.keys(parameters).filter((k) => parameters[k].required);
  const properties = {};
  Object.keys(parameters).forEach((k) => {
    const p = parameters[k];
    const prop = { type: p.type, description: p.description || '' };
    if (p.enum) prop.enum = p.enum;
    properties[k] = prop;
  });
  return {
    name,
    description,
    parameters: { type: 'object', properties, ...(required.length ? { required } : {}) },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args) {
      return execute(args);
    },
  };
}

export const name = 'zying-collect';

export const inject = ['tools'];

export function apply(ctx) {
  // 自动拉起本地后端: 市场一键安装的用户装完插件、重启 DSH 就能直接用
  // (已在运行则什么都不做, 不会干扰手动启动的开发环境)
  ensureErp(ctx).catch((e) => console.log('[zying-erp] 自动启动失败: ' + (e && e.message)));

  ctx.effect(() => ctx.tools.register(tool('zying_health',
    '检查智赢ERP系统是否在线及商品库数量 (调用本地 127.0.0.1:3088)。采集相关操作前可先调用确认系统可用。授权状态也在这里返回。',
    {},
    async () => {
      const up = await isUp(1500);
      if (!up) return { online: false, note: '本地后端没在运行。插件启动时已尝试自动拉起; 若仍不在, 可在插件目录手动执行: node erp/server.js 3088' };
      const p = await sys('/api/products');
      const lic = await license();
      return {
        online: true, total: p.total, time: new Date().toISOString(),
        license: lic ? {
          valid: lic.valid, customer: lic.customer,
          // 期限: expiresAt 为 null = 永久授权（签发时不传 --days/--exp）
          expiresAt: lic.expiresAt, perpetual: !lic.expiresAt,
          message: lic.message || null,
          // 未授权时把指纹给模型, 方便直接告诉用户"把这串发给授权方"
          // 注意: 这里必须是 null 而不是 undefined —— 带 undefined 值的属性不是 lossless JSON,
          // 会让 zying_health 工具直接报 "returned invalid output"。已授权时本来也不需要指纹。
          fingerprint: lic.valid ? null : lic.fingerprint,
          needLicense: !lic.valid,
        } : null,
      };
    })),
    'zying health');

  ctx.effect(() => ctx.tools.register(tool('zying_list_direct',
    '列表页直采: 直接读取 Amazon 列表页所有商品 + 智赢插件信息 (FBA/排名/1688/人民币价), 不跳详情页, 支持自动翻页多页采集。返回商品数量/新增入库数。',
    {
      url: { type: 'string', required: true, description: 'Amazon 列表页 URL (搜索/类目页, 如 https://www.amazon.co.uk/s?k=Car+Accessories)' },
      maxPages: { type: 'number', description: '翻页数 (1-10, 默认1, 自动采多页免手动跳转)' },
      maxItems: { type: 'number', description: '入库上限 (默认100)' },
      waitPluginMs: { type: 'number', description: '等待智赢插件分析毫秒数 (默认15000, 插件信息覆盖更多可加大)' },
    },
    async (a) => {
      const r = await sys('/api/collect/list-direct', { url: a.url, maxPages: a.maxPages || 1, maxItems: a.maxItems || 100, waitPluginMs: a.waitPluginMs });
      return { site: r.site, pages: r.pagesDone, total: r.total, productCount: r.productCount, added: r.added, withPlugin: r.withPlugin };
    })),
    'zying list-direct');

  ctx.effect(() => ctx.tools.register(tool('zying_list_filtered',
    '列表页筛选采集: 列表页直采 → 用筛选条件前置过滤 (FBA/FBM/排名/评分/关键词) → 直接入库, 【不跳转详情页】。详情页专属字段 (价格/评论/类目/A+) 与插件面板字段 (商标/月销) 之后在「商品管理」里勾选商品用「一键补采」补。返回各阶段数量。',
    {
      url: { type: 'string', required: true, description: 'Amazon 列表页 URL' },
      maxPages: { type: 'number', description: '翻页数 (1-10, 默认1)' },
      filterFulfill: { type: 'string', enum: ['FBA', 'FBM'], description: '配送方式筛选 (仅采 FBA 或 FBM)' },
      filterRankMax: { type: 'number', description: '大排名 ≤ 上限 (大排名 = 所有排名里的最大值)' },
      filterRatingMin: { type: 'number', description: '评分 ≥ 下限 (0-5)' },
      filterReviewsMin: { type: 'number', description: '评论数 ≥ 下限' },
      filterQ: { type: 'string', description: '标题含关键词' },
      aod: { type: 'boolean', description: '是否采 aod 跟卖卖家 (默认 true)' },
    },
    async (a) => {
      const r = await sys('/api/collect/list-filtered', {
        url: a.url, maxPages: a.maxPages || 1, maxItems: 100,
        filterFulfill: a.filterFulfill || '', filterRankMax: a.filterRankMax, filterRatingMin: a.filterRatingMin,
        filterReviewsMin: a.filterReviewsMin, filterQ: a.filterQ || '', aod: a.aod !== false,
      });
      return { site: r.site, total: r.total, preFiltered: r.preFiltered, skippedByList: r.skippedByList, enriched: r.enriched, productCount: r.productCount, added: r.added };
    })),
    'zying list-filtered');

  ctx.effect(() => ctx.tools.register(tool('zying_follow_shop',
    '商品跟卖并行采集: 输入商品 URL/ASIN, 从 aod 实时提取全部跟卖卖家, 并行采集各卖家店铺商品入库 (全程 CDP, 耗时较长)。返回店铺成功/失败数/采集商品数。',
    {
      url: { type: 'string', required: true, description: 'Amazon 商品页 URL 或 ASIN' },
      maxItems: { type: 'number', description: '每店铺商品数上限 (默认10)' },
      maxPages: { type: 'number', description: '每店铺翻页数 (默认2)' },
      concurrency: { type: 'number', description: '并行网页数 (1-6, 默认4)' },
      excludeSellers: { type: 'string', description: '排除卖家 (名称/ID, 逗号分隔)' },
    },
    async (a) => {
      const r = await sys('/api/collect/follow-shop-aod', {
        urls: [a.url], maxItems: a.maxItems || 10, maxPages: a.maxPages || 2, concurrency: a.concurrency || 4,
        excludeSellers: a.excludeSellers || '', amazonWords: 'amazon,亚马逊',
      });
      return { shopOk: r.shopOk, shopFail: r.shopFail, productCount: r.productCount, added: r.added, stopped: r.stopped || false };
    })),
    'zying follow-shop');

  ctx.effect(() => ctx.tools.register(tool('zying_collect_status',
    '查看采集进度与现场: 后端采集开关状态、商品库总量、最近 5 分钟新增数量与站点货币构成、最新 5 条入库记录。长耗时采集(跟卖并行)期间用它确认后台是否仍在继续, 避免把 HTTP 超时误当成"没采到"。',
    {},
    async () => {
      const st = await sys('/api/collect/status', undefined, 8000);
      const h = await sys('/api/health', undefined, 8000);
      const p = await sys('/api/products?limit=500', undefined, 20000);
      const items = p.items || [];
      // 后端时间是 'YYYY-MM-DD HH:MM:SS' 本地时钟, 直接用字符串比较算 5 分钟窗口, 避开时区换算
      const pad = (n) => String(n).padStart(2, '0');
      const since = (() => {
        const m = /(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String((h && h.time) || ''));
        if (!m) return null;
        const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) - 5 * 60 * 1000);
        return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) +
          ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds());
      })();
      const recent = since ? items.filter((it) => it.collectedAt && String(it.collectedAt) >= since) : [];
      const mix = {};
      recent.forEach((it) => { const k = String(it.site) + '/' + String(it.currency); mix[k] = (mix[k] || 0) + 1; });
      const latest = items.slice()
        .sort((a, b) => String(b.collectedAt).localeCompare(String(a.collectedAt)))
        .slice(0, 5)
        .map((it) => ({ asin: it.asin, site: it.site, currency: it.currency, collectedAt: it.collectedAt, source: it.source }));
      return {
        stopRequested: !!(st && st.stopRequested),
        total: p.total,
        backendTime: (h && h.time) || null,
        recentSince: since,
        recent5min: recent.length,
        recentSiteMix: mix,
        latest,
      };
    })),
    'zying collect-status');

  ctx.effect(() => ctx.tools.register(tool('zying_stop',
    '停止当前采集: 系统采集循环在当前步骤完成后提前退出, 已采数据保留入库。',
    {},
    async () => sys('/api/collect/stop', {}).then(() => ({ stopped: true, note: '已请求停止, 当前步骤完成后退出 (已采数据已保存)' })))),
    'zying stop');
}


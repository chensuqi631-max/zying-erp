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
  /* ─── 同源代理：浏览器 → /api/zying-proxy → 本机 ERP(3088) ───
   * 为什么必须这样：DSH 的 Web 页面以 dsh-app:// 安全协议加载，
   * 页面里直接 fetch('http://127.0.0.1:3088') 会被浏览器按【混合内容】拦掉
   * （报 Failed to fetch，请求根本到不了 3088 —— 实测服务端请求日志为空）。
   * 官方插件同样用 connection.fetch.register 走同源，这里照做。
   */
  /* ★ 2026-11-15 修 proxy-unavailable：DSH 桌面端页面在 dsh-app:// 下无法直连 127.0.0.1:3088，
 *   必须靠 connection.fetch.register 把 /api/zying-proxy 挂到 DSH 自己的 web 服务上。
 *   实测 0.2.1-rc.5 已支持该 API（内置插件就在用），所以这里：
 *     ① 优先直接注册（ctx.get('connection')），成功打日志；
 *     ② 不成功则用规范 Cordis 子插件（inject:['connection']）再注册一次；
 *     ③ 仍不成功则退回 ctx.inject 写法。
 *   三条路任一成功，客户端就不会再报 proxy-unavailable。 */
  const proxyRoute = {
    path: '/api/zying-proxy',
    methods: ['POST'],
    requestBody: 'buffered',
    async fetch(request) {
      const json = (status, payload) => new Response(JSON.stringify(payload), {
        status, headers: { 'content-type': 'application/json' },
      });
      if (request.method !== 'POST') return json(405, { ok: false, error: '只支持 POST' });
      let body;
      try { body = await request.json(); } catch (e) { return json(400, { ok: false, error: '请求体不是合法 JSON' }); }
      const p = String((body && body.path) || '');
      if (!p.startsWith('/api/')) return json(400, { ok: false, error: 'path 必须以 /api/ 开头' });
      const method = String((body && body.method) || 'GET').toUpperCase();
      try {
        if (!(await isUp(1200))) await ensureErp().catch(() => null);
        const opt = { method, headers: {} };
        if (body && body.body !== undefined && body.body !== null && method !== 'GET') {
          opt.headers['content-type'] = 'application/json';
          opt.body = typeof body.body === 'string' ? body.body : JSON.stringify(body.body);
        }
        const r = await fetch(API + p, opt);
        const t2 = await r.text();
        let js = null, jsonError = null;
        try { js = t2 ? JSON.parse(t2) : null; } catch (e) { jsonError = String((e && e.message) || e); }
        return json(200, { ok: r.ok, status: r.status, json: js, text: t2, jsonError });
      } catch (e) {
        return json(200, { ok: false, error: String((e && e.message) || e).slice(0, 300) });
      }
    },
  };
  let proxyRegistered = false;
  const regDirect = () => {
    const c = (typeof ctx.get === 'function') ? ctx.get('connection') : null;
    if (!c || !c.fetch || typeof c.fetch.register !== 'function') return false;
    ctx.effect(() => c.fetch.register(proxyRoute), 'zying-erp: /api/zying-proxy');
    console.log('[zying-erp] 同源代理已注册(direct): /api/zying-proxy');
    return true;
  };
  try { proxyRegistered = regDirect(); } catch (e) { console.log('[zying-erp] 代理 direct 注册失败: ' + ((e && e.message) || e)); }
  if (!proxyRegistered && typeof ctx.plugin === 'function') {
    try {
      ctx.plugin({
        name: 'zying-proxy', inject: ['connection'],
        apply(ctx2) {
          ctx2.effect(() => ctx2.connection.fetch.register(proxyRoute), 'zying-erp: /api/zying-proxy');
          console.log('[zying-erp] 同源代理已注册(child): /api/zying-proxy');
        },
      });
      proxyRegistered = true;
    } catch (e) { console.log('[zying-erp] 代理 child 注册失败: ' + ((e && e.message) || e)); }
  }
  if (!proxyRegistered && typeof ctx.inject === 'function') {
    try {
      ctx.inject(['connection'], (scope) => {
        const c = scope.get && scope.get('connection');
        if (!c || !c.fetch || typeof c.fetch.register !== 'function') {
          console.log('[zying-erp] 代理未注册：当前 DSH 没有 connection.fetch.register');
          return;
        }
        scope.effect(() => c.fetch.register(proxyRoute), 'zying-erp: /api/zying-proxy');
        console.log('[zying-erp] 同源代理已注册(inject): /api/zying-proxy');
      });
      proxyRegistered = true;
    } catch (e) { console.log('[zying-erp] 代理 inject 注册失败: ' + ((e && e.message) || e)); }
  }
  if (!proxyRegistered) console.log('[zying-erp] ⚠ 同源代理未注册：客户端会报 proxy-unavailable');

  // 自动拉起本地后端: 市场一键安装的用户装完插件、重启 DSH 就能直接用
  // (已在运行则什么都不做, 不会干扰手动启动的开发环境)
  ensureErp(ctx).catch((e) => console.log('[zying-erp] 自动启动失败: ' + (e && e.message)));

  ctx.effect(() => ctx.tools.register(tool('zying_health',
    '检查智赢ERP系统是否在线及商品库数量 (调用本地 127.0.0.1:3088)。采集相关操作前可先调用确认系统可用。授权状态也在这里返回。',
    {},
    async () => {
      const up = await isUp(1500);
      if (!up) return { online: false, note: '本地后端没在运行。插件启动时已尝试自动拉起; 若仍不在, 可在插件目录手动执行: node erp/server.js 3088' };
      const p = await sys('/api/products?limit=1&slim=1');   // ★ 只要 total, 别拉全库(40MB 会压垮宿主 RPC)
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

  ctx.effect(() => ctx.tools.register(tool('zying_collect_url',
    '【默认采集方式】给一个 Amazon 列表页/品牌页 URL：先用本地无头浏览器翻页读出全部 ASIN（不依赖智赢插件、不弹窗），' +
    '再用本地签名的数据接口批量取数入库（品牌·BSR·价格·上架日·月销·卖点·尺寸·备案等）。' +
    '比页面采集快 3~8 倍且可后台跑；评分/评论/A+/图集接口没有，需另用商品管理「补采」。',
    {
      url: { type: 'string', required: true, description: 'Amazon 列表页 URL（搜索/类目/品牌店铺页）' },
      maxPages: { type: 'number', description: '无头浏览器翻几页找品（1-10，默认 2）' },
      maxItems: { type: 'number', description: '最多取多少个 ASIN（默认 120）' },
      limit: { type: 'number', description: '实际采集入库上限（默认与 maxItems 相同）' },
      withTitle: { type: 'boolean', description: '是否补标题/主图（默认 true，只补缺）' },
      wait: { type: 'boolean', description: '是否等采完再返回（默认 false）' },
    },
    async (a) => {
      const started = await sys('/api/collect/direct', {
        url: a.url, maxPages: a.maxPages || 2, maxItems: a.maxItems || 120,
        mode: 'given', limit: a.limit || 0, withTitle: a.withTitle !== false,
      }, 180000);
      if (!started || !started.ok) return started;
      if (!a.wait) return { started: true, found: started.found, job: started.job, tip: '用 GET /api/collect/direct/status 看进度' };
      for (;;) {
        await new Promise((r) => setTimeout(r, 1500));
        const st = await sys('/api/collect/direct/status', undefined, 20000);
        if (!st || !st.running) return { found: started.found, result: st };
      }
    })),
    'zying collect-url');

  ctx.effect(() => ctx.tools.register(tool('zying_collect_direct',
    '直连采集(推荐): 不经过浏览器/智赢插件, 直接用本地签名的数据接口按 ASIN 批量取商品数据并写库。' +
    '可补/更新 品牌·制造商·BSR(两级)·BuyBox价·运费·FBA·卖家·跟卖数·上架日·月销·变体·五点·品牌备案·尺寸重量。' +
    '速度约 150~500ms/条(接口限流时会慢), 长任务后台跑; 用 zying_collect_status 看进度。' +
    '不返回 评分/评论/A+/图集(接口没有, 需页面补采)。',
    {
      asins: { type: 'array', description: 'ASIN 数组 (10位)。不传则按 mode 从库里挑' },
      mode: { type: 'string', enum: ['given', 'missing', 'all'], description: 'given=只采给定 ASIN; missing=按 needs 挑库里缺字段的; all=该站点全部' },
      needs: { type: 'array', description: 'mode=missing 时缺哪些就采: brand / bsr / firstAvailable / title / price / bullets' },
      site: { type: 'string', description: '站点 (de/uk/us/fr/es/it/jp/ca/au…), 默认 de' },
      limit: { type: 'number', description: '本次最多处理多少条 (0=不限)' },
      withTitle: { type: 'boolean', description: '是否顺便补标题/主图 (默认 true, 只补缺)' },
      wait: { type: 'boolean', description: '是否等跑完再返回 (默认 false, 立即返回任务信息)' },
    },
    async (a) => {
      const started = await sys('/api/collect/direct', {
        asins: a.asins || undefined,
        mode: a.mode || (a.asins && a.asins.length ? 'given' : 'missing'),
        needs: a.needs || undefined,
        site: a.site || 'de',
        limit: a.limit || 0,
        withTitle: a.withTitle !== false,
      }, 60000);
      if (!started || !started.ok) return started;
      if (!a.wait) return { started: true, job: started.job, tip: '用 zying_collect_status 或 GET /api/collect/direct/status 看进度' };
      const t0 = Date.now();
      for (;;) {
        await new Promise((r) => setTimeout(r, 1500));
        const st = await sys('/api/collect/direct/status', undefined, 20000);
        if (!st || !st.running) return st;
        if (Date.now() - t0 > 30 * 60 * 1000) return { timeout: true, last: st };
      }
    })),
    'zying collect-direct');

  ctx.effect(() => ctx.tools.register(tool('zying_ifast_status',
    'ifast.top 直连状态：返回登录态是否有效、跟卖方案（sellingId）列表、站点（siteId）列表。上架前先跑这个确认。',
    {},
    async () => {
      const r = await sys('/api/ifast/status', undefined, 40000);
      return { ok: r.ok, cookieSet: r.cookieSet, shops: r.shops, sites: r.sites, error: r.error || null };
    })),
    'zying ifast-status');

  ctx.effect(() => ctx.tools.register(tool('zying_ifast_list',
    'ifast 在架商品查询：可按 ASIN / 站点 / 跟卖方案筛，返回 itemStatus（0待上传 10检查 20成功 30失败 40暂停）。用于查重与上架结果回查。',
    {
      asinSearch: { type: 'string', description: '按 ASIN 精确查' },
      siteId: { type: 'string', description: '站点 id（如 69132=DE，来自 zying_ifast_status）' },
      sellingId: { type: 'string', description: '跟卖方案 id' },
      page: { type: 'number', description: '页码，默认 1' },
      limit: { type: 'number', description: '每页条数，默认 20' },
    },
    async (a) => {
      const r = await sys('/api/ifast/items', { asinSearch: a.asinSearch || '', siteId: a.siteId || '', sellingId: a.sellingId || '', page: a.page || 1, limit: a.limit || 20 }, 60000);
      return { ok: r.ok, total: r.total, items: (r.items || []).map((x) => ({ id: x.id, asin: x.asin, country: x.country, siteId: x.siteId, sellingId: x.sellingId, itemStatus: x.itemStatus, initPrice: x.initPrice, lowerPrice: x.lowerPrice, onOff: x.onOff })), error: r.error || null };
    })),
    'zying ifast-list');

  ctx.effect(() => ctx.tools.register(tool('zying_ifast_add',
    '上架到 ifast.top：批量/多变体一次提交（同站点已存在会自动跳过），可选 autoUpload=true 立即提交到亚马逊。' +
    '站点/跟卖方案先用 zying_ifast_status 查 id。',
    {
      site: { type: 'string', description: '站点字母 DE/UK/FR/IT/ES/AU（也可传 siteId）' },
      siteId: { type: 'string', description: '站点 id（优先于 site）' },
      sellingName: { type: 'string', description: '跟卖方案名，如 全天跟卖 / 午夜（也可传 sellingId）' },
      sellingId: { type: 'string', description: '跟卖方案 id' },
      stock: { type: 'number', description: '库存，默认 100' },
      leadDays: { type: 'number', description: '备货周期天数，默认 5' },
      onOff: { type: 'number', description: '上架开关 1/0，默认 1' },
      autoUpload: { type: 'boolean', description: '提交后立即 item_upload.json 提交亚马逊' },
      items: { type: 'array', description: '[{asin, initPrice, lowerPrice, title?, brand?, image?}]' },
    },
    async (a) => {
      const r = await sys('/api/ifast/add', {
        site: a.site || '', siteId: a.siteId || '', sellingName: a.sellingName || '', sellingId: a.sellingId || '',
        stock: a.stock == null ? 100 : a.stock, leadDays: a.leadDays == null ? 5 : a.leadDays,
        onOff: a.onOff == null ? 1 : a.onOff, autoUpload: a.autoUpload === true, items: a.items || [],
      }, 180000);
      return r;
    })),
    'zying ifast-add');

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


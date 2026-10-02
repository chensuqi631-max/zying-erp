/* 智赢插件 API 通道 (逆向成果落地)
 *
 * 原理: 不抓 DOM, 而是复用插件自己的请求层拿结构化 JSON。
 *   CDP 挂到 Edge(9222) 里任一【亚马逊页面】→ 找到插件的内容脚本【隔离世界】("智赢选品")
 *   → 钩出 __webpack_require__ → 运行时按模块源码定位 API 模块/请求层
 *   → 调 POST /zbig/MoreAboutAsin/v2/{site}, data=[{asin}]
 * 插件自带的 TOKEN/FINGERID/WASM 签名全部由它自己带上, 我们不复制签名算法。
 *
 * 详见: D:\智赢erp\_dev-tools\ZYING-API-逆向成果.md
 *       skill: chrome-ext-api-reverse
 *
 * 实测: 20 个/请求 (上限; 30 报 code:500), 20 条约 1.0–2.7s
 * ⚠️ 有配额/限流: 连打多轮后会统一返回"网络连接失败"字样, 数分钟后自行恢复 → 必须限速+退避
 */
const CDP_PORT = Number(process.env.ZYING_CDP_PORT || 9222);
const BASE = 'https://amazon.zying.net/api';

/** 列 CDP 标签页 */
async function listTabs() {
  const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
  return await r.json();
}

/* CDP 连接: 必须支持事件订阅 —— 找插件隔离世界依赖 Runtime.executionContextCreated 事件,
 * 而 /json/list 里看不出哪个 context 属于插件, 只能靠事件推来再逐个探测。
 * (踩过: 只 resolve 响应、不订阅事件的简版连接拿不到任何 context。) */
function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0; const pend = new Map(); const handlers = {};
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
      if (m.method && handlers[m.method]) handlers[m.method].forEach((fn) => { try { fn(m.params) } catch (x) {} });
    };
    ws.onopen = () => resolve({
      ws,
      on: (ev, fn) => { (handlers[ev] = handlers[ev] || []).push(fn); },
      send: (method, params = {}) => new Promise((res, rej) => {
        const i = ++id;
        const timer = setTimeout(() => { pend.delete(i); rej(new Error('CDP ' + method + ' 超时')); }, 60000);
        pend.set(i, (m) => { clearTimeout(timer); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); });
        try { ws.send(JSON.stringify({ id: i, method, params })); } catch (e) { clearTimeout(timer); rej(e); }
      }),
      close: () => { try { ws.close() } catch (e) {} },
    });
    ws.onerror = () => reject(new Error('CDP WebSocket 连接失败'));
  });
}

/** 建立/复用会话: 找到插件隔离世界并钩出 __webpack_require__  (整进程复用一条连接) */
let _sess = null;
async function session(opts = {}) {
  if (_sess && _sess.ok) return _sess;
  const tabs = await listTabs();
  const pages = tabs.filter((t) => t.type === 'page' && t.url && !/^chrome-extension:/.test(t.url));
  const amz = pages.filter((t) => /amazon\./.test(t.url));
  const page = amz[0] || pages[0];
  if (!page) throw new Error(`Edge(端口 ${CDP_PORT}) 没有可用页面 —— 请确认浏览器以 --remote-debugging-port=${CDP_PORT} 启动并打开一个亚马逊页面`);

  const cdp = await connect(page.webSocketDebuggerUrl);
  const ctxs = [];
  cdp.on('Runtime.executionContextCreated', (p) => { if (p && p.context) ctxs.push(p.context); });
  await cdp.send('Runtime.enable', {});
  await new Promise((r) => setTimeout(r, opts.waitMs || 1500));

  let ctxId = null, extId = null;
  for (const c of ctxs) {
    if (!c.origin || !/^chrome-extension:\/\//.test(String(c.origin))) continue;
    const r = await cdp.send('Runtime.evaluate', { expression: 'String((typeof chrome!=="undefined"&&chrome.runtime&&chrome.runtime.id)||"")', contextId: c.id, returnByValue: true });
    const id = r && r.result ? r.result.value : '';
    if (id) { ctxId = c.id; extId = id; break; }
  }
  if (!ctxId) { cdp.close(); throw new Error('没找到智赢插件的隔离世界 —— 请确认插件已启用、且当前页面已注入内容脚本(刷新页面一次)'); }

  const sess = { ok: true, cdp, ctxId, extId, pageUrl: page.url, reqMod: null, apiMod: null };
  sess.eval = async (expr, awaitPromise = true) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, contextId: sess.ctxId, returnByValue: true, awaitPromise });
    if (r && r.exceptionDetails) throw new Error('隔离世界异常: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
    const v = r && r.result ? r.result.value : undefined;
    if (typeof v !== 'string') return v;
    try { return JSON.parse(v); } catch (e) { return v; }
  };

  // 钩 __webpack_require__
  const boot = await sess.eval(`(() => {
    if (globalThis.__ZYAPI) return JSON.stringify({ ok:true, cached:true, modules:Object.keys(globalThis.__ZYAPI.req.m).length });
    const ks = Object.keys(globalThis).filter((k) => /^webpackChunk/.test(k));
    if (!ks.length) return JSON.stringify({ ok:false, why:'没有 webpackChunk 全局(插件未注入?)' });
    let req = null;
    globalThis[ks[0]].push([[Symbol('p')], {}, (r) => { req = r; }]);
    if (!req) return JSON.stringify({ ok:false, why:'未能钩出 __webpack_require__' });
    globalThis.__ZYAPI = { req, chunks: ks };
    return JSON.stringify({ ok:true, cached:false, modules:Object.keys(req.m).length, chunks:ks });
  })()`);
  if (!boot || !boot.ok) { cdp.close(); throw new Error('插件模块初始化失败: ' + JSON.stringify(boot)); }
  sess.modules = boot.modules;

  // 运行时按模块源码定位 API 模块 与 请求层(不硬编码模块号, 抗插件升级)
  const located = await sess.eval(`(() => {
    const z = globalThis.__ZYAPI;
    let api = null, requester = null;
    for (const mid of Object.keys(z.req.m)) {
      let src = ''; try { src = String(z.req.m[mid]); } catch (e) { continue; }
      if (!api && src.indexOf('MoreAboutAsin') !== -1) api = mid;
      if (!requester && src.indexOf('/Auth/Logout') !== -1 && src.indexOf('登录超时') !== -1) requester = mid;
      if (api && requester) break;
    }
    z.apiMod = api; z.reqMod = requester;
    let reqKeys = null;
    try { reqKeys = requester ? Object.keys(z.req(requester)) : null } catch (e) {}
    return JSON.stringify({ api: api, requester: requester, reqKeys: reqKeys });
  })()`);
  if (!located || !located.requester) { cdp.close(); throw new Error('未能定位插件请求层: ' + JSON.stringify(located)); }
  sess.reqMod = located.requester; sess.apiMod = located.api;
  sess.reqKeys = located.reqKeys;
  _sess = sess;
  return sess;
}

/** 调任意端点 (走插件请求层, 自带 token/签名)
 *  ★ 自愈: 缓存的隔离世界 contextId 会在【页面导航/刷新】后失效, CDP 报
 *    {"code":-32000,"message":"Cannot find context with specified id"}。
 *    实测的坑: 单测时没事, 一旦采集链路边导航边调 API 就整批失败。
 *    这里识别到该错误就丢掉会话、重新找隔离世界, 再重试一次。 */
async function call(path, data, method = 'POST', base = BASE) {
  const once = async () => {
    const s = await session();
    const M = (method || 'POST').toUpperCase();
    const noBody = M === 'GET' || M === 'HEAD';           // ★ GET/HEAD 绝不能带 data
    const expr = `(async () => {
      const z = globalThis.__ZYAPI;
      const A = z.req(z.reqMod);
      const fn = (typeof A.m === 'function' && A.m) || (typeof A.tN === 'function' && A.tN) || (typeof A.o === 'function' && A.o);
      if (!fn) return JSON.stringify({ __ok:false, __err:'请求层无可用导出: ' + Object.keys(A||{}).join(',') });
      const c = { baseUrl: ${JSON.stringify(base)}, url: ${JSON.stringify(path)}, method: ${JSON.stringify(M)} };
      ${noBody ? '' : `c.data = ${JSON.stringify(data === undefined ? null : data)};`}
      try {
        const r = await fn(c);
        return JSON.stringify({ __ok:true, data:r });
      } catch (e) {
        let msg='';
        try {
          const tag = Object.prototype.toString.call(e);
          if (e instanceof Error) msg = e.message;
          else if (typeof e === 'string') msg = e;
          else if (tag === '[object String]') msg = String(e);
          else if (e && typeof e === 'object') {
            const ks = Object.keys(e);
            msg = (ks.length && ks.every((k)=>/^\\d+$/.test(k))) ? ks.sort((a,b)=>Number(a)-Number(b)).map((k)=>e[k]).join('') : (e.message||e.error||JSON.stringify(e));
          } else msg = String(e);
        } catch (x) { msg = '(无法序列化的错误)'; }
        return JSON.stringify({ __ok:false, __err:String(msg) });
      }
    })()`;
    const r = await s.eval(expr);
    if (r && r.__ok) {
      const d = r.data;
      if (d && typeof d === 'object' && !Array.isArray(d) && typeof d.code === 'number' && 'data' in d) return d.data;
      return d;
    }
    let err = (r && r.__err) || JSON.stringify(r).slice(0, 300);
    // 兜底: 报错字符串被打散成 {"0":"{","1":"\""...} → 拼回来 (服务端 400/500 正文是定位入参的线索)
    if (/^\{"0":/.test(err)) {
      try {
        const o = JSON.parse(err); const ks = Object.keys(o);
        if (ks.length && ks.every((k) => /^\d+$/.test(k))) err = ks.sort((a, b) => Number(a) - Number(b)).map((k) => o[k]).join('');
      } catch (e) {}
    }
    const e2 = new Error(err); e2.apiError = true;
    if (/网络连接失败|Failed to fetch/i.test(err)) e2.rateLimited = true;   // 实测: 限流被插件映射成这句
    throw e2;
  };

  try {
    return await once();
  } catch (e) {
    const stale = /Cannot find context|Execution context was destroyed|No context with|Inspected target navigated/i.test(String(e.message));
    if (!stale) throw e;
    closeSession();                 // 上下文失效 → 重连并重新定位隔离世界
    await new Promise((r) => setTimeout(r, 400));
    return await once();
  }
}

/** 配额状态 (插件里定义了但从未调用, 语义未公开; 记下实测值备查) */
const apiLimit = () => call('/zbig/APILimitStatus', null, 'GET');
/** 插件版本 */
const pluginVersion = () => call('/zbig/Version', null, 'GET');

/**
 * ★ 批量取商品详情 (自动分批 + 限速 + 退避)
 * @param {string[]} asins
 * @param {string} site  站点代码 (de/uk/us/...)
 * @param {{batch?:number, gapMs?:number, retries?:number, onProgress?:Function, log?:Function}} opts
 * @returns {Promise<{data:Object, stats:Object}>}
 */
async function moreAboutAsin(asins, site = 'de', opts = {}) {
  const list = (Array.isArray(asins) ? asins : [asins]).filter(Boolean);
  const batch = Math.min(opts.batch || 20, 20);          // 实测硬上限
  const gapMs = opts.gapMs == null ? 900 : opts.gapMs;   // ★ 限速: 批间隔, 防触发配额
  const retries = opts.retries == null ? 3 : opts.retries;
  const log = opts.log || (() => {});

  const data = {};
  const stats = { requested: list.length, batches: 0, ok: 0, got: 0, failedBatches: 0, rateLimited: 0, ms: 0, apiCalls: 0 };
  const t0 = Date.now();

  for (let i = 0; i < list.length; i += batch) {
    const chunk = list.slice(i, i + batch);
    stats.batches++;
    let attempt = 0;
    for (;;) {
      attempt++;
      try {
        const r = await call(`/zbig/MoreAboutAsin/v2/${site}`, chunk.map((a) => ({ asin: a })));
        stats.apiCalls++;
        if (r && typeof r === 'object') { Object.assign(data, r); stats.ok++; }
        break;
      } catch (e) {
        if (e.rateLimited) stats.rateLimited++;
        if (attempt >= retries) {
          stats.failedBatches++;
          log(`[API] 批次失败(${attempt}次): ${chunk.length}个 → ${String(e.message).slice(0, 120)}`);
          break;
        }
        const back = e.rateLimited ? 4000 * attempt : 700 * attempt;   // 限流退避更狠
        await new Promise((r) => setTimeout(r, back));
      }
    }
    stats.got = Object.keys(data).length;
    if (opts.onProgress) opts.onProgress({ done: Math.min(i + batch, list.length), total: list.length, got: stats.got, stats });
    if (i + batch < list.length && gapMs) await new Promise((r) => setTimeout(r, gapMs));
  }
  stats.ms = Date.now() - t0;
  stats.perItemMs = stats.got ? Math.round(stats.ms / stats.got) : null;
  // 会话失效时清掉, 下次重连
  if (stats.failedBatches && stats.failedBatches === stats.batches) _sess = null;
  return { data, stats };
}

function closeSession() { if (_sess && _sess.cdp) _sess.cdp.close(); _sess = null; }

module.exports = { session, call, apiLimit, pluginVersion, moreAboutAsin, listTabs, closeSession, BASE,
  get sessionInfo() { return _sess ? { extId: _sess.extId, pageUrl: _sess.pageUrl, reqMod: _sess.reqMod, apiMod: _sess.apiMod, modules: _sess.modules } : null; } };

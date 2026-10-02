/**
 * 亚马逊跟卖ERP Demo — 后端服务 (零依赖 Node.js)
 * 提供: 静态文件 + REST API (商品/合规/认领/调价/飞轮/Agent/通知)
 * 用法: node zying-demo/server.js [port]   (默认 3088)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
// 多链接采集（《多链接采集-完整代码.js》第 1 部分：自包含 CDP 实现，依赖通过 opts 注入）
const linksCollector = require('./links-collector.js');
// 站点 / 链接解析纯函数（单独成模块 → 可单测；本后端原有 siteToHostSuffix，此处补齐分类与站点优先级）
const siteLinks = require('./site-links.js');
let lastLinksResult = null;      // 多链接采集的异步结果（供 GET /api/collect/links-result 取）

const ROOT = __dirname;
// 数据目录可用环境变量覆盖: 插件市场安装时程序在 node_modules 里 (pnpm 升级会整体替换),
// 数据必须放到 node_modules 之外 —— 由插件启动器设置 ZYING_DATA 指向 ~/.zying-erp/data
const DATA = process.env.ZYING_DATA ? path.resolve(process.env.ZYING_DATA) : path.join(ROOT, 'data');
const PUBLIC = path.join(ROOT, 'public');
const PORT = parseInt(process.argv[2] || '3088', 10);

/* ===== 落盘策略: 攒批次 + 去抖 + 轮转备份 =====================================
 * 原来 save() 是"写一次盘 = 拷贝一份整库备份 + 写一次全量 JSON":
 * 多链接采集一个店铺入库一次, 100 个链接就是 110 次全量写 + 110 份全量备份副本
 * (备份目录实测堆到 502 个文件 / 691 MB), 写盘压力也全压在采集循环上。
 * 现在(按《多链接采集-稳定性优化文档》第 3 层):
 *   · 攒批次: 只对 products.json(`data === products` 时)攒批, 5 秒窗口内多次 save 合并成 1 次
 *   · 别的文件立即写: 小文件没有攒批收益, 但"save 后马上 load"的流程会读到旧数据(坑 23)
 *   · 轮转: 每个文件留【最近 3 份】+【14 天内每天 1 份】, 写完立刻轮转 + 启动时清理历史堆积
 *   · 原子写: tmp + rename, 断电/被杀不会留半截 JSON
 *   · 三处强刷: 批次边界 / 采集结束(endCollectProgress) / 进程退出
 * 口径: 内存里的 products 数组永远是权威, 界面读的是内存; 磁盘最多落后一个去抖窗口。
 * ==========================================================================*/
const SAVE_DEBOUNCE_MS   = Number(process.env.ZY_SAVE_DEBOUNCE_MS || 5000);   // 攒批窗口
const BACKUP_KEEP_RECENT = Number(process.env.ZY_BACKUP_KEEP || 3);           // 每个文件留最近几份
const BACKUP_KEEP_DAYS   = Number(process.env.ZY_BACKUP_KEEP_DAYS || 14);     // 每天再留 1 份
// ★ 2026-09 大库保护: 8.9 万条时 products.json 已 168MB, 原实现"每次保存都复制一份备份"会
//   在采集期间每 5 秒复制 169MB, 且单次写盘内存峰值近 1GB(实测) —— 低内存机器上会崩。
//   这里对大文件单独限流: 备份最小间隔 + 只留少数几份 + 紧凑输出。
const BACKUP_MIN_GAP_MS  = Number(process.env.ZY_BACKUP_MIN_GAP_MS || 10 * 60 * 1000);  // 大文件备份最小间隔(默认10分钟)
const BIG_FILE_MB        = Number(process.env.ZY_BIG_FILE_MB || 64);                    // 超过此体积视为大文件
const BACKUP_KEEP_BIG    = Number(process.env.ZY_BACKUP_KEEP_BIG || 2);                 // 大文件保留份数
const PRETTY_MAX_ITEMS   = Number(process.env.ZY_PRETTY_MAX_ITEMS || 2000);             // 数组超过此条数改用紧凑输出
let productsSaveTimer = null;
let productsReady = false;       // ★ TDZ: 首次 load 完成前不能碰 products
let productsSaves = 0;           // 统计: 攒批合并了多少次 save
let writesFlushed = 0;           // 统计: 实际落盘次数

/** 轮转备份: 只留最近 N 份 + 最近 M 天每天 1 份, 返回删除数量 */
function rotateBackups(name, isBig = false) {
  try {
    const bk = path.join(DATA, 'backups');
    if (!fs.existsSync(bk)) return 0;
    const prefix = name + '.';
    const files = fs.readdirSync(bk)
      .filter((f) => f.startsWith(prefix) && f.endsWith('.bak') && !f.endsWith('.tmp.bak'))
      .map((f) => ({ f, p: path.join(bk, f), m: fs.statSync(path.join(bk, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m);                       // 新的在前
    const keep = new Set();
    const keepRecent = isBig ? BACKUP_KEEP_BIG : BACKUP_KEEP_RECENT;   // 大文件只留少数几份(每份上百 MB)
    files.slice(0, keepRecent).forEach((x) => keep.add(x.f));
    // 每天再留最新一份(同一天里最先遍历到的最新)
    const days = new Set();
    for (const x of files) {
      const day = new Date(x.m).toISOString().slice(0, 10);
      if (days.has(day)) continue;
      if (isBig || days.size >= BACKUP_KEEP_DAYS) break;      // 大文件不按"每天留一份"堆积
      days.add(day);
      keep.add(x.f);
    }
    let removed = 0;
    for (const x of files) { if (!keep.has(x.f)) { try { fs.unlinkSync(x.p); removed++ } catch (e) { /* 占用则跳过 */ } } }
    return removed;
  } catch (e) { return 0 }
}

/** 真正落盘: 备份 + 轮转 + 原子写(tmp + rename) */
function writeFileNow(entry) {
  const name = entry.name;
  const data = entry.data;
  const f = path.join(DATA, name);
  let isBig = false;
  try { isBig = fs.existsSync(f) && fs.statSync(f).size > BIG_FILE_MB * 1048576; } catch (e) { isBig = false; }
  try {                                                 // 覆盖前保留一份备份(大文件按最小间隔节流)
    if (fs.existsSync(f)) {
      const bk = path.join(DATA, 'backups');
      fs.mkdirSync(bk, { recursive: true });
      let skip = false;
      if (isBig && BACKUP_MIN_GAP_MS > 0) {
        const prefix = name + '.';
        const newest = fs.readdirSync(bk)
          .filter((x) => x.startsWith(prefix) && x.endsWith('.bak'))
          .map((x) => { try { return fs.statSync(path.join(bk, x)).mtimeMs; } catch (e) { return 0; } })
          .sort((a, b) => b - a)[0] || 0;
        if (newest && (Date.now() - newest) < BACKUP_MIN_GAP_MS) skip = true;   // 距上一份太近 → 不复制
      }
      if (!skip) {
        const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        fs.copyFileSync(f, path.join(bk, name + '.' + ts + '.bak'));
      }
    }
  } catch (e) { /* 备份失败不阻断主流程 */ }
  const tmp = f + '.tmp';
  // 大数组用紧凑输出: 省约 20% 体积与 70MB 内存峰值; 小文件仍美化便于人工查看
  const pretty = !(Array.isArray(data) && data.length > PRETTY_MAX_ITEMS);
  fs.writeFileSync(tmp, pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data), 'utf8');
  fs.renameSync(tmp, f);
  writesFlushed++;
  rotateBackups(name, isBig);                           // ★ 写完立刻轮转(大文件只留少数几份)
}

/* ===== 采集报告 (持久化) =====================================================
 * 为什么要有它: 采集明细原来只存在内存(lastLinksResult / 各接口返回值)与前端弹窗里,
 * 后端一重启、页面一刷新就没了 —— 「采集记录」里只能看到商品数, 看不到那次采集究竟发生了什么
 * (店铺谁成功谁失败 / 每个品牌页混入多少他牌被剔除 / 过滤条件 / 错误)。
 * 现在每次采集结束都落一条报告到 data/collect-reports.json, 「采集记录 → 查看报告」按时间窗取回。
 * ==========================================================================*/
let collectReports = load('collect-reports.json', []);
if (!Array.isArray(collectReports)) collectReports = [];
const REPORT_MAX = 300;                 // 只留最近 300 条, 防止文件无限增长

/* ===== 多链接采集任务 (任务化 / 断点续跑) =====================================
 * 一次给几十上百条链接 → 每批 batchSize 条 → 单批崩了不影响其它批次;
 * 每完成一条链接 / 一个店铺 / 一个品牌就落盘, 重启后点「继续上次任务」接着跑,
 * 已采过的店铺/品牌零导航跳过, 失败清单可以单独「重跑失败」。
 * 断点文件在 data/link-jobs/job-*.json。实现见 link-jobs.js(纯函数 + JobStore)。
 * ★ 打包/分发时文件白名单必须带上 link-jobs.js —— 漏了会"装上了但模块找不到"。
 * ==========================================================================*/
const linkJobs = require('./link-jobs.js');
const linkJobStore = new linkJobs.JobStore(path.join(DATA, 'link-jobs'));

/* 知识产权查重 (上架风控) —— 直连官方商标/外观设计库, 见 ip-check.js 顶部说明。
 * ★ 打包/分发时文件白名单必须带上 ip-check.js。 */
const ipCheck = require('./ip-check.js');

/* 批量知产查重的作业状态(内存态, 重启即清) —— 查重是"一串串行外部请求",
 * 一次批量几十分钟, 不能让 HTTP 连接挂着等, 所以学采集那样做成"后台跑 + 轮询进度"。 */
let ipBatch = null;

/** 批量知产查重的进度快照(不含明细, 给轮询用) */
function ipBatchSummary() {
  if (!ipBatch) return { running: false, batch: null };
  return {
    id: ipBatch.id, running: !!ipBatch.running, startedAt: ipBatch.startedAt, finishedAt: ipBatch.finishedAt || null,
    total: ipBatch.total, done: ipBatch.done, current: ipBatch.current,
    matchedProducts: ipBatch.matched, apply: ipBatch.apply, field: ipBatch.field,
    summary: ipBatch.summary, errors: ipBatch.errors.slice(-20),
    progress: ipBatch.total ? Math.round((ipBatch.done / ipBatch.total) * 100) : 0,
  };
}

/* 离线集成测试口子: ZY_TEST_FAKE_CDP=1 时用假 CDP 端点, 让「多链接采集」的整条 HTTP 链路
 * (守卫 → 建任务 → 逐单元落盘 → 续跑 → 重跑失败 → 删除) 可以离线跑完整。
 * 生产/正常使用时不设这个变量, 这里恒为 null, 行为完全不变。 */
let fakeCdpDeps = null;
if (process.env.ZY_TEST_FAKE_CDP === '1') {
  try {
    const { createFakeEnv } = require(path.join(process.env.ZY_TEST_FAKE_CDP_DIR || '', 'fake-cdp.cjs'));
    // 可选的用例配置(店铺页/品牌页返回哪些卡片): 只有测试台放了 fake-cdp.cfg.cjs 才加载
    let fakeCfg = {};
    try {
      const cfgPath = path.join(process.env.ZY_TEST_FAKE_CDP_DIR || '', 'fake-cdp.cfg.cjs');
      if (fs.existsSync(cfgPath)) fakeCfg = require(cfgPath);
    } catch (e) { console.log('  假 CDP 用例配置加载失败(忽略): ' + ((e && e.message) || e)); }
    const env = createFakeEnv(fakeCfg);
    fakeCdpDeps = {
      openSession: env.fakeOpenSession,
      cdpCreateTab: env.cdpCreateTab,
      cdpCloseTab: env.cdpCloseTab,
      // ★ 测试台自己维护"标签页表"时就用它的(并行改造后每个 worker 一张标签页, 一张写死的
      //   假标签页不够用了); 老测试台没提供 cdpGetTabs 就退回原来那张单标签页的桩。
      cdpGetTabs: (typeof env.cdpGetTabs === 'function')
        ? env.cdpGetTabs
        : async () => [{ id: 'fake-tab', type: 'page', url: 'https://www.amazon.co.uk/', webSocketDebuggerUrl: 'ws://fake' }],
      env,
    };
    console.log('  ⚠ 多链接采集已启用【假 CDP】(仅测试用, ZY_TEST_FAKE_CDP=1)');
  } catch (e) {
    console.log('  假 CDP 加载失败(忽略, 继续用真 Edge): ' + ((e && e.message) || e));
  }
}

/** utcNow: 与 products.collectedAt 同一格式 (UTC, 'YYYY-MM-DD HH:mm:ss'), 采集记录按它聚合 */
function utcNow() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }

/**
 * 存一条采集报告。
 * mergeWindowMs>0 时, 若最近一条报告是这么多毫秒内刚存的, 就**合并**它而不是新增
 * —— 同一次采集里结构化报告(多链接)与摘要通知(pushNotify)会先后到达, 不合并就会出现两条。
 */
function saveCollectReport(rep, mergeWindowMs = 0) {
  try {
    const at = utcNow();
    const prev = collectReports[0];
    const canMerge = mergeWindowMs > 0 && prev && prev.at && (Date.now() - new Date(prev.at.replace(' ', 'T') + 'Z').getTime() < mergeWindowMs);
    if (canMerge) {
      collectReports[0] = Object.assign({}, prev, rep, { at: prev.at, updatedAt: at, id: prev.id });
      save('collect-reports.json', collectReports);
      return collectReports[0];
    }
    const r = Object.assign({
      id: 'R-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
      at, mode: '', name: '采集', filters: '无过滤',
      fromUtc: utcNow(), toUtc: utcNow(),
      summary: {}, shops: [], brands: [], errors: [],
    }, rep);
    if (!r.fromUtc) r.fromUtc = r.at;
    if (!r.toUtc) r.toUtc = r.at;
    collectReports.unshift(r);
    collectReports = collectReports.slice(0, REPORT_MAX);
    save('collect-reports.json', collectReports);
    return r;
  } catch (e) {
    console.warn('[采集报告] 落盘失败:', e && e.message);
    return null;
  }
}

const toMs = (s) => {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) : NaN;
};

/**
 * 按「采集记录」批次的时间窗取报告: 与批次有重叠的都算 (一次采集可能被聚合成一批, 一批也可能含多次采集)。
 * 没有重叠时退一步: 取 30 分钟内最近的一条 (边界/时区造成的几分钟错位不该让报告找不到)。
 */
function findCollectReports(fromUtc, toUtc) {
  const a = toMs(fromUtc), b = toMs(toUtc);
  if (!isFinite(a) || !isFinite(b)) return [];
  const lo = Math.min(a, b), hi = Math.max(a, b);
  const hit = collectReports.filter((r) => {
    const s = toMs(r.fromUtc), e = toMs(r.toUtc);
    if (!isFinite(s) || !isFinite(e)) return false;
    return s <= hi && lo <= e;
  });
  if (hit.length) return hit.slice(0, 20);
  let best = null, bestD = Infinity;
  for (const r of collectReports) {
    const s = toMs(r.fromUtc);
    if (!isFinite(s)) continue;
    const d = Math.min(Math.abs(s - lo), Math.abs(s - hi));
    if (d < bestD) { bestD = d; best = r; }
  }
  return (best && bestD <= 30 * 60000) ? [best] : [];
}

/** 报告列表(轻量): 只给概览字段, 供界面列出 */
function reportBrief(r) {
  const s = r.summary || {};
  const mixed = (r.brands || []).reduce((n, b) => n + (b.mixed || 0), 0);
  const mismatch = (r.brands || []).reduce((n, b) => n + (b.mismatch || 0), 0);
  // ★ 剔除他牌明细条数(报告里能点开跳转的那个列表)
  const mixedItems = (r.mixed || []).reduce((n, g) => n + ((g.items || []).length), 0);
  return {
    id: r.id, at: r.at, mode: r.mode, name: r.name, fromUtc: r.fromUtc, toUtc: r.toUtc,
    links: s.links || 0, sellers: s.sellers || 0, shopProducts: s.shopProducts || 0,
    brands: s.brands || (r.brands || []).length, brandProducts: s.brandProducts || 0,
    added: s.added != null ? s.added : null, elapsedSec: s.elapsedSec || r.elapsedSec || null,
    mixed, mismatch, mixedItems, filters: r.filters || '',
    // ★ 插件未登录提示(只提示不停采集): notLogged>0 时界面显示「插件未登录, 字段缺失」
    pluginLogin: r.pluginLogin || null,
    live: r.live !== false, rebuilt: !!r.rebuilt, url: r.url || null,
  };
}


// ===== 数据读写 =====
function load(name, def) {
  if (name === 'products.json') flushProducts();        // ★ 保证读到的是最新(不会读到攒批中的旧文件, 坑 23)
  try { return JSON.parse(fs.readFileSync(path.join(DATA, name), 'utf8')); }
  catch { return def; }
}
/**
 * 把攒批中的 products.json 立刻写下去(读之前 / 采集结束 / 进程退出时调用)。
 * ★ productsReady 是必须的: flushProducts 里引用 products, 而 load('products.json')
 *   会在 `let products = ...` 初始化之前被调用一次 → 不判标志会直接
 *   ReferenceError: Cannot access 'products' before initialization (坑 22)。
 */
function flushProducts(force = false) {
  if (!productsReady) return;                           // 首次 load 时 products 还在 TDZ
  if (!productsSaveTimer && !force) return;
  if (productsSaveTimer) { clearTimeout(productsSaveTimer); productsSaveTimer = null; }
  try { writeFileNow({ name: 'products.json', data: products }); }
  catch (e) { console.error('[save] flush 失败: ' + ((e && e.message) || e)); }
}

/**
 * 存一个数据文件。
 *
 * 只对 products.json 攒批 —— 它是唯一的大文件且入库高频。别的文件立即写:
 * 小文件攒批没有收益, 而项目里存在「save 之后马上 load」的流程(清空/重建),
 * 攒批会让它读到上一版(坑 23)。
 * 另外必须确认写的就是模块级 products 本身: 传别的数组说明调用方有自己的语义,
 * 不能攒批 —— 否则会把别人的数组内容攒进商品库(坑 24)。
 *
 * @param name  文件名 (相对 DATA)
 * @param data  要写的数据
 * @param force 只有 products.json 用: 显式允许写空 (「一键清空」) 且立刻落盘
 */
function save(name, data, force = false) {
  // 防呆(硬): products.json 不允许被意外写空 — 只有显式 force=true (如「一键清空」接口) 才允许
  // 之前仅警告仍会写入, 导致商品库反复被清空为 [] (现场日志: [save] 警告 data.length= 0)
  if (name === 'products.json' && Array.isArray(data) && data.length === 0 && !force) {
    console.warn('[save] 阻止写空 products.json (data.length=0) — 已拒绝写入, 调用栈:\n' + new Error().stack);
    return;
  }
  // 防呆: 商品库被写空时记录警告 (排查误清空)
  if (name === 'products.json' && (!Array.isArray(data) || data.length === 0)) {
    console.warn('[save] 警告: products.json 将被写空/清空, data.length=', Array.isArray(data) ? data.length : typeof data);
  }
  // 只有商品库走攒批, 且必须就是那个数组本身
  if (name !== 'products.json' || force || data !== products) {
    try { writeFileNow({ name, data }); }
    catch (e) { console.error('[save] 落盘失败 ' + name + ': ' + ((e && e.message) || e)); }
    return;
  }
  productsSaves++;
  if (productsSaveTimer) return;                        // 已有排队写入 → 自动合并
  productsSaveTimer = setTimeout(() => {
    productsSaveTimer = null;
    try { writeFileNow({ name: 'products.json', data: products }); }
    catch (e) { console.error('[save] 攒批写盘失败: ' + ((e && e.message) || e)); }
  }, SAVE_DEBOUNCE_MS);
  if (productsSaveTimer.unref) productsSaveTimer.unref();
}

/** 退出兜底: 进程退出/被杀前把攒批中的数据写下去(坑 25) */
function flushAllOnExit(why) {
  try { flushProducts(true); } catch (e) { /* 忽略 */ }
  try { linkJobStore.flushAll(); } catch (e) { /* 忽略 */ }
  if (why) console.log('[exit] 已落盘待写数据 (' + why + ')');
}


let products = load('products.json', []);
productsReady = true;                                   // ★ 首次 load 之后再允许 flush
let branddb = load('branddb.json', []);
let rules = load('rules.json', []);
let claims = load('claims.json', []);            // 草稿箱
let repriceHistory = load('reprice.json', []);   // 调价历史
// AI 对话配置 (后端存储, 任何浏览器生效; apiKey 不回传给前端)
let aiConfig = load('ai-config.json', { name: 'DeepSeek', baseURL: 'https://api.deepseek.com', model: 'deepseek-v4-flash', apiKey: '' });

// ===== AI 调用封装 (断线自动重连): 网络错误/超时/5xx 自动重试 (指数退避) =====
// 重试条件: 连接失败/超时(AbortError)/429限流/5xx; 4xx 参数错误不重试 (重试无意义)
async function callAI(messages, opts = {}) {
  const base = String(aiConfig.baseURL || '').trim().replace(/\/+$/, '');
  const mdl = String(aiConfig.model || '').trim();
  const key = String(aiConfig.apiKey || '').trim();
  if (!base || !mdl || !key) throw new Error('请先在「工作台 → AI 设置」中填写 API Key');
  const maxRetries = Math.max(1, opts.maxRetries || 4);   // 最多重试次数 (默认4: 初始+4次重试)
  const perTimeout = opts.timeoutMs || 60000;             // 单次请求超时
  const temperature = opts.temperature != null ? opts.temperature : 0.7;
  const maxTokens = opts.maxTokens || 2000;
  let lastErr = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      // 指数退避: 1s → 2s → 4s → 8s (最多)
      const delay = Math.min(8000, 1000 * Math.pow(2, attempt - 1));
      await new Promise((r) => setTimeout(r, delay));
    }
    let ctrl = null, timer = null;
    try {
      ctrl = new AbortController();
      timer = setTimeout(() => ctrl.abort(), perTimeout);
      const resp = await fetch(base + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
        body: JSON.stringify({ model: mdl, messages, temperature, max_tokens: maxTokens }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      const text = await resp.text();
      // 可重试的状态码: 429(限流) / 5xx(服务端错误) / 网络层已在 catch 处理
      if (!resp.ok) {
        let detail = '';
        try { const e = JSON.parse(text); detail = ((e.error && (e.error.message || e.error.code)) || text.slice(0, 200)); } catch { detail = text.slice(0, 200); }
        const retriable = resp.status === 429 || resp.status >= 500;
        if (retriable && attempt < maxRetries) { lastErr = new Error('AI 服务暂时不可用 (HTTP ' + resp.status + '), 自动重连 ' + (attempt + 1) + '/' + maxRetries + ': ' + detail); continue; }
        throw new Error('AI 服务错误 (HTTP ' + resp.status + '): ' + detail);
      }
      let data = null;
      try { data = JSON.parse(text); } catch {}
      const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      if (content == null) {
        if (attempt < maxRetries) { lastErr = new Error('AI 返回格式异常, 自动重连 ' + (attempt + 1) + '/' + maxRetries); continue; }
        throw new Error('AI 返回格式异常: ' + text.slice(0, 200));
      }
      return content;
    } catch (e) {
      if (timer) clearTimeout(timer);
      const isTimeout = e && e.name === 'AbortError';
      const isNetwork = e && (e.cause === 'ECONNRESET' || /fetch failed|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|socket|network/i.test(String(e.message)));
      // 超时或网络断开 → 自动重连; 其他错误(参数等)直接抛
      if ((isTimeout || isNetwork) && attempt < maxRetries) {
        lastErr = new Error((isTimeout ? 'AI 请求超时 (' + perTimeout + 's)' : 'AI 连接断开') + ', 自动重连 ' + (attempt + 1) + '/' + maxRetries);
        continue;
      }
      throw e;
    }
  }
  throw lastErr || new Error('AI 调用失败');
}
let flywheel = load('flywheel.json', {
  compliance: { total: 0, corrected: 0, rulesSunk: 0, accuracy: 0.82 },
  pricing: { total: 0, buyBoxWin: 0, winRate: 0.6, suggestions: [] },
  selection: { total: 0, claimed: 0, hitRate: 0.5 },
  speech: { total: 0, adopted: 0, adoptRate: 0.7 },
});
let notifications = load('notify.json', []);
let collectRules = load('collect-rules.json', []);   // 采集过滤规则 (保存/加载)

/* ===== ★ 子体价格补全 (2026-09-24) ============================================
 * 背景: Amazon 商品详情页【只渲染当前选中子体】的价格; twister 的 sortedDimValuesForAllDims
 *       里每个子体节点没有价格字段 (实测 LI 的 hasPrice:false) → 子体价格只能逐个打开 /dp/<asin> 读。
 * 用法: 上架记录页点「补子体价格」→ 后台逐个导航读取 → 回填 variant.children[].price。
 * 安全: 页面实际 ASIN 与目标不一致时跳过 (Amazon 有变体跳转), 绝不写入错误价格。
 * ========================================================================== */
async function cdpReadChildPrice(send, host, asin) {
  await send('Page.navigate', { url: 'https://' + host + '/dp/' + asin });
  // ★ 修复(2026-09-24): 原实现只等固定 6.5 秒 → 页面渲染慢时读不到价就判失败且不重试。
  //   实测: 3 个"失败"的子体页面其实都有价 (B08YRLZ9LR=$41.49 / B0FCXPHGMY=$68.49, 均 In stock)。
  //   改为【轮询等待】: 首次等 5s, 之后每 1.2s 探测一次, 最多 20 次 (≈28s); 读到价立即返回。
  const EXPR = `(() => {
      let pageAsin = null;
      const c = document.querySelector('link[rel="canonical"]');
      if (c) { const m = (c.getAttribute('href') || '').match(/\\/dp\\/([A-Z0-9]{10})/i); if (m) pageAsin = m[1].toUpperCase(); }
      if (!pageAsin) { const m2 = location.href.match(/\\/dp\\/([A-Z0-9]{10})/i); if (m2) pageAsin = m2[1].toUpperCase(); }
      const sels = ['#corePrice_feature_div .a-offscreen', '#corePriceDisplay_desktop_feature_div .a-offscreen',
                    '.apex-pricetopay-value .a-offscreen', '#price_inside_buybox', '.a-price .a-offscreen'];
      for (const s of sels) {
        const el = document.querySelector(s);
        if (!el) continue;
        const t = (el.textContent || '').trim();
        const m = t.match(/([\\d][\\d.,]*)/);
        if (!m) continue;
        const v = parseFloat(m[1].replace(/,/g, ''));
        if (!isNaN(v) && v > 0) return JSON.stringify({ price: v, symbol: t.replace(/[\\d.,\\s]/g, '').trim(), pageAsin, url: location.href.slice(0, 120) });
      }
      const avail = document.querySelector('#availability');
      return JSON.stringify({ price: null, symbol: null, pageAsin, url: location.href.slice(0, 120), availability: avail ? avail.textContent.replace(/\\s+/g, ' ').trim().slice(0, 60) : null });
    })()`;
  let last = null;
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, i === 0 ? 5000 : 1200));
    let j = null;
    try {
      const r = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
      j = JSON.parse(r.result.value);
    } catch (e) { /* 页面切换中读取失败 → 继续等 */ }
    if (j) {
      last = j;
      // 变体跳转: 页面实际 ASIN 与目标不符 → 立刻放弃 (绝不写错价)
      if (j.pageAsin && j.pageAsin !== asin) return { price: null, mismatch: true, pageAsin: j.pageAsin };
      if (j.price != null) return { price: j.price, symbol: j.symbol || null, pageAsin: j.pageAsin || null, waited: i + 1 };
    }
    if (collectStopRequested()) break;
  }
  return { price: null, pageAsin: last && last.pageAsin || null, noPrice: true, availability: last && last.availability || null };
}

// 逐个子体补价 (limit 限制一次最多读几个, 避免误点一个按钮跑半小时)
async function fillChildPrices(recs, limit) {
  const tabs = await cdpGetTabs();
  const page = tabs.find((t) => t.type === 'page' && /amazon\./.test(t.url || '')) || tabs.find((t) => t.type === 'page');
  if (!page) throw new Error('Edge 无可用页面标签, 请确认「本地无头浏览器」在跑(POST /api/browser/start), 或用户的采集浏览器以 --remote-debugging-port=9222 启动');
  const { send } = await cdpConnect(page.webSocketDebuggerUrl);
  let total = 0, got = 0, mismatch = 0, failed = 0;
  for (const rec of recs) {
    const kids = (rec.variant && rec.variant.children) || [];
    if (collectStopRequested()) break;
    const host = 'www.amazon.' + siteToHostSuffix(rec.site || 'uk');
    for (const c of kids) {
      if (collectStopRequested() || total >= limit) break;
      // ★ 修复(2026-09-24): limit 只应统计【本次真正去读的】子体。
      //   旧写法对"已有价"的子体也 total++, 导致 limit=3 时前 3 个已带价的就把额度耗尽 → break,
      //   真正待补的 (排在末尾的颜色变体) 永远轮不到 —— 实测 23/26 与进度停在 19/22 就是这个原因。
      if (c.price != null) continue;
      total++;
      let lastErr = '';
      try {
        const r = await cdpReadChildPrice(send, host, c.asin);
        if (r.mismatch) mismatch++;
        else if (r.price != null) { c.price = r.price; c.priceSymbol = r.symbol || null; c.priceAt = now(); got++; }
        else { failed++; lastErr = '页面未读到价' + (r.availability ? (" (" + r.availability + ")") : ''); }
      } catch (e) { failed++; lastErr = String((e && e.message) || e); console.error('[fill-child-price]', c.asin, lastErr); }
      bumpCollectProgress({ step: '补子体价格 ' + got + '/' + total + (lastErr ? (' · ' + lastErr.slice(0, 70)) : ''), items: total, detailDone: total, detailTotal: kids.length, lastErr: lastErr || null });
    }
    rec.childPriceAt = now();
  }
  return { total, got, mismatch, failed, stopped: collectStopRequested() };
}

/* ===== ★ 上架记录 (2026-09-24) =================================================
 * 与商品管理库 products 完全隔离: 独立文件 + 独立 API 前缀, 只存"插件采集待上架"的商品。
 * 为什么要独立: 商品库是 8.9 万条的选品库(带筛选/变体族/补采), 上架记录是"本次要上架的清单",
 * 两者混在一起会互相污染 (筛选被上架数据干扰、上架数据被补采覆盖)。
 * 去重键: asin@site (同一 ASIN 在不同站点是两条记录)。
 * ============================================================================== */
let listingRecords = load('listing-records.json', []);
/* ★ 2026-09-27 选品归档库 —— 上架器改成"只记录/只显示/只导出"之后新增的落点。
 * 商品库(products.json, 10 万+)是"采过的池子", 上架记录是"这轮要上架的清单",
 * 归档库记的是"我们最终选中的品 + 当时的承受价/利润率" —— 以后照这些品找相似品用的模板。
 * 结构 { batches: [ { batchId, name, source, note, createdAt, count, bySite, dupCount, items:[...] } ] }
 * 快照式: 存完之后源数据被删/被改, 归档里那份不受影响。 */
let selectionArchive = load('selection-archive.json', { batches: [] });
if (!selectionArchive || !Array.isArray(selectionArchive.batches)) selectionArchive = { batches: [] };
/* ★ 2026-09-27 条目标签(爆款/试销/放弃/季节品): 按 asin@site 单独存一份 ——
 *   不放在批次条目里, 因为同一个品可能被多次归档, 放条目里一重新归档标签就没了。 */
if (!selectionArchive.tags || typeof selectionArchive.tags !== 'object') selectionArchive.tags = {};
/* ★ 自动归档设置(每日快照): 存在归档文件里, 跟着数据走 */
if (!selectionArchive.auto || typeof selectionArchive.auto !== 'object') selectionArchive.auto = { enabled: false, hour: 3, source: 'listing', lastRunAt: null };
/* ══════════════ ★ 存储结构 v2 (2026-09-27) ══════════════
 * v1(旧): { batches: [ { …, items: [完整条目] } ] } —— 同一个品被归档 3 次就在文件里存 3 份。
 * v2(新): { items: { "asin@site": 条目 }, batches: [ { …, keys: ["asin@site", …] } ] }
 *   为什么改: 批次快照全量冗余, 200 批 × 上万条会把文件撑爆(用户要长期用这个库)。
 *   条目里保留 firstArchivedAt / times(归档过几次), 所以"这个品存过几回"这条信息不丢。
 * 旧文件首次加载自动迁移(v1 字段 items 还在就转成 keys), 并立刻回写 —— 用户不用做任何事。 */
function archiveMigrate() {
  /* ★ 这里不能用后面的 archiveKey(): 迁移是【立即执行】的, 那时它还只在 TDZ 里(会 ReferenceError) */
  const keyOf = (site, asin) => String(asin || '').toUpperCase() + '@' + String(site || '').toLowerCase();
  let migrated = 0;
  const items = (selectionArchive.items && typeof selectionArchive.items === 'object') ? selectionArchive.items : {};
  selectionArchive.batches.forEach((b) => {
    if (!Array.isArray(b.items) || !b.items.length) return;
    const keys = [];
    b.items.forEach((it) => {
      const k = it.key || keyOf(it.site, it.asin);
      if (!k) return;
      keys.push(k);
      const prev = items[k];
      if (!prev) items[k] = Object.assign({}, it, { firstArchivedAt: b.createdAt, lastArchivedAt: b.createdAt, times: 1 });
      else items[k] = Object.assign({}, it, { firstArchivedAt: prev.firstArchivedAt || b.createdAt, lastArchivedAt: b.createdAt, times: (prev.times || 1) + 1 });
    });
    b.keys = keys;
    delete b.items;
    b.count = keys.length;
    migrated++;
  });
  selectionArchive.items = items;
  selectionArchive.version = 2;
  /* 补全: 老文件里 count/dupCount 可能缺 */
  selectionArchive.batches.forEach((b) => { if (!Array.isArray(b.keys)) b.keys = []; if (b.count == null) b.count = b.keys.length });
  return migrated;
}
(function initArchive() {
  const n = archiveMigrate();
  if (n) {
    console.log('[archive] 存储结构已迁移到 v2(条目去重): 处理 ' + n + ' 个批次, 条目 ' + Object.keys(selectionArchive.items).length + ' 个');
    try { save('selection-archive.json', selectionArchive, true) } catch (e) { console.error('[archive] 迁移回写失败: ' + ((e && e.message) || e)) }
  }
})();
const listingIdOf = (it) => String((it && it.asin) || '').toUpperCase() + '@' + String((it && it.site) || '');
function normalizeListingItem(raw, fallbackSite) {
  if (!raw || typeof raw !== 'object') return null;
  const asin = String(raw.asin || '').toUpperCase().trim();
  if (!/^[A-Z0-9]{10}$/.test(asin)) return null;
  const site = String(raw.site || fallbackSite || '').toLowerCase() || null;
  const num = (v) => { if (v == null || v === '') return null; const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^\d.]/g, '')); return isNaN(n) ? null : n; };
  const iv = raw.variant && typeof raw.variant === 'object' ? raw.variant : (raw.variants && typeof raw.variants === 'object' ? raw.variants : null);
  const children = iv && Array.isArray(iv.children) ? iv.children.filter((c) => c && /^[A-Z0-9]{10}$/.test(String(c.asin || '').toUpperCase())).map((c) => ({
    asin: String(c.asin).toUpperCase(),
    options: (c.options && typeof c.options === 'object') ? c.options : {},
    price: num(c.price),
    image: c.image || null,
    selected: c.selected === true,
    url: c.url || null,
  })) : [];
  return {
    id: listingIdOf({ asin, site }),
    asin, site,
    parentAsin: raw.parentAsin ? String(raw.parentAsin).toUpperCase() : (iv && iv.parentAsin ? String(iv.parentAsin).toUpperCase() : null),
    title: raw.title ? String(raw.title).slice(0, 500) : null,
    brand: raw.brand || null,
    price: num(raw.price), currency: raw.currency || (site ? siteCurrency(site) : null),
    mainImage: raw.mainImage || raw.image || null,
    url: raw.url || null,
    catPath: raw.catPath || null, cat1: raw.cat1 || null, cat2: raw.cat2 || null, cat3: raw.cat3 || null,
    variant: {
      parentAsin: (iv && iv.parentAsin) ? String(iv.parentAsin).toUpperCase() : null,
      dims: (iv && Array.isArray(iv.dims)) ? iv.dims.slice(0, 6) : [],
      childCount: children.length || ((iv && num(iv.count)) || 0),
      children,
    },
    panel: {
      rank: raw.rank != null ? raw.rank : null,
      bsrShop: num(raw.bsrShop), bsrShopCat: raw.bsrShopCat || null,
      bsrCat: num(raw.bsrCat), bsrCatName: raw.bsrCatName || null,
      sales30d: num(raw.sales30d), listedAt: raw.listedAt || null,
      fulfill: raw.fulfill || null, seller: raw.seller || null, sellerCount: num(raw.sellerCount),
      trademark: raw.trademark || null,
      variantsCount: num(raw.variants), size: raw.size || null, weight: raw.weight || null,
      productType: raw.productType || null, sizeName: raw.sizeName || null, colourName: raw.colourName || null,
      rating: num(raw.rating), reviews: num(raw.reviews),
    },
    /* ★ 2026-09-25 上品工具自动填表所需字段(插件「确认上传」时带上, bridge 在 ifast 页填表时用):
     *   initPrice=初始价格(Amazon 页面原价, 站点本币) 
     *   bearPrice=承受价 —— ★ 2026-09-26 起口径变了: 按用户「定价表.xlsx」的算法算出来,
     *     是【站点本币】价, 不再是「物流+采购」的人民币和:
     *       (采购成本 + 物流成本) × (1 + 利润率) ÷ 到手比例 ÷ 汇率 + 本币调整
     *     (定价表原值: 利润率 0.3；到手比例 英/德 0.68、澳 0.85；汇率 英 9.07、德 7.8、澳 4.73)
     *     为什么必须换算: ifast 的 input#lowerPrice(承受价) 与 input#price 同为站点本币框。
     *   服务端只存不重算 —— 算法参数在插件的商品页面板「⚙ 定价」里维护。
     *   followPreset/Text/Window=跟卖时间(对应 ifast 下拉) · stock=库存 · leadDays/Text=备货 */
    fill: {
      initPrice: num(raw.initPrice), initPriceRaw: raw.initPriceRaw || null,
      purchaseCost: num(raw.purchaseCost), logisticsCost: num(raw.logisticsCost), logisticsChannel: raw.logisticsChannel || null,
      bearPrice: num(raw.bearPrice),
      // ★ 2026-09-26 承受价的算式留痕(便于事后核对这个本币价是怎么来的)
      bearCny: num(raw.bearCny), bearCur: raw.bearCur || null,
      bearFx: num(raw.bearFx), bearFxSrc: raw.bearFxSrc || null, bearNet: num(raw.bearNet),
      bearMargin: num(raw.bearMargin), bearAdj: num(raw.bearAdj),
      /* ★ 2026-09-26 用户要求「承受价格后方加一个加减的数字」:
       *   bearBase   = 加减之前的基准值(手填优先, 否则定价表算法结果)
       *   bearAdjRow = 行级加减量(正=加 负数=减), 只影响这一行
       *   bearPrice(上面那个) = bearBase + bearAdjRow —— 这才是真正填进 ifast 的值 */
      bearBase: num(raw.bearBase), bearAdjRow: num(raw.bearAdjRow),
      /* ★ 上传范围: one=只上这一个变体(默认, 用户要求) / family=整族 */
      variantScope: raw.variantScope || null, variantScopeText: raw.variantScopeText || null,
      // ★ 2026-09-26 手填标记: 用户手改过的值要留痕(上品工具面板会显示"手填"), 以前这里没存 →
      //   插件报了 bearHand 但 ERP 丢掉, 面板永远不显示
      bearHand: num(raw.bearHand), initHand: num(raw.initHand),
      // ★ 2026-09-26 多变体任务: 父ASIN + 每个变体各自的 初始价/承受价
      //   (bridge 在 ifast「多变体添加」Tab 里按父ASIN查询→勾选变体→批量填)
      fillMode: (raw.fillMode === 'multi' || (Array.isArray(raw.variantItems) && raw.variantItems.length)) ? 'multi' : 'single',
      variantParent: raw.variantParent ? String(raw.variantParent).toUpperCase() : null,
      variantItems: Array.isArray(raw.variantItems)
        ? raw.variantItems.slice(0, 300).map((x) => ({
            asin: String((x && x.asin) || '').toUpperCase(),
            initPrice: num(x && x.initPrice), bearPrice: num(x && x.bearPrice),
            options: (x && x.options) || null,
          })).filter((x) => x.asin)
        : [],
      followMode: raw.followMode || null, followAt: raw.followAt || null,
      followPreset: raw.followPreset || null, followText: raw.followPresetText || null,
      followWindow: raw.followWindow || null, allDay: raw.allDay === true,
      stock: num(raw.stock), leadDays: num(raw.leadDays), leadText: raw.leadText || null,
      weightKg: num(raw.weightKg), weightRaw: raw.weightRaw || null,
    },
    /* ★ 2026-09-27 状态简化: fillStatus 不再由这里维护(读的时候按上传记录推导, 见 uploadResultOf/fillStateOf)。
     *   refillAt = "退回重填/再次上传"的时间戳, 比最近一次上传结果新就重新排队。 */
    fillStatus: null, fillAt: null, fillResult: null, refillAt: null,
    /* ★ 2026-09-27 上传记录(只记录, 不当操作台) —— 用户要求「记录商品的上传数据, 比如上传失败」。
     *   uploads: 追加式历史(新→旧, 每次填表/提交一条: 时间/结果/原因/填失败的字段), 最多 30 条
     *   status=failed + failReason/failAt/failCount: 失败是个【状态】, 采集器行上的红标「失败」读的就是它
     *   (采集器 content.js 的 zvErpTag 已经认 status=failed, 并把 note 显示在悬停提示里 —— 上层不用改) */
    uploads: [], uploadsTotal: 0, failCount: 0,
    failReason: null, failAt: null, failFields: [],
    status: 'pending',        // pending 待上架 / listed 已上架 / failed 上传失败
    note: null,
    source: raw.source || 'ext-v2',
    collectedAt: raw.collectedAt || now(),
    savedAt: now(),
    listedAt: null,
  };
}
/* ★ 2026-09-27 状态模型简化 —— 状态数据只有【上传结果】一种:
 *   用户要求:「填表的待填入能不能删掉，相当于只有上传失败一个状态数据」。
 *   所以: uploadResult = 'ok' | 'failed' | null 是唯一的"状态数据";
 *        "待填" 不再是一个存下来的状态, 而是由"有没有成功上传记录"推导出来的【队列位置】(fillStateOf)。
 *   为什么不直接把 fillStatus 字段删掉: 它是 bridge(跑在 ifast 页)取填表任务的依据,
 *     直接删会把"填表 → 保存"整条链弄断(实测过: 拿不到任务就什么都不填)。
 *     改成"读的时候推导" → 队列照旧可用, 而记录里只留上传结果; 旧数据靠 status/fillStatus 兜底。
 *   注意 uploadResult 对"填了表但没提交"返回 null —— 那不是上传结果, 只是流水里的一条尝试。
 */
function uploadResultOf(r) {
  const last = (r.uploads || [])[0] || null;
  if (last && last.ok === false) return 'failed';
  if (last && last.submitted === true) return 'ok';
  if ((r.status || '') === 'failed') return 'failed';                       // 旧数据兜底
  if ((r.status || '') === 'listed' || (r.fillStatus || '') === 'uploaded') return 'ok';   // 旧数据兜底
  return null;
}
/** 有没有"要填的数据"(插件点上传时落下来的 fill) —— 判断能不能当填表任务 */
function listingHasFill(r) {
  return !!(r.fill && (r.fill.bearPrice != null || r.fill.initPrice != null || r.fill.purchaseCost != null));
}
/** 内部队列位置(给 bridge 用, 不是"状态数据"): done 已完成 / failed 可重传 / pending 待填 / null 不是任务 */
function fillStateOf(r) {
  /* "退回重填"(fill-reset) / "再次上传"会打一个 refillAt 标记 → 在下一次上传结果回来之前一律算排队中。
   * ★ 早先版本拿 refillAt 去和上一次结果的时间戳比大小 —— 同一秒内操作会比不出来(实测踩到:
   *   重置后 fillState 还是 done), 所以改成"标记"语义: fill-result 一落库就清掉它。 */
  if (r.refillAt) return listingHasFill(r) ? 'pending' : null;
  const res = uploadResultOf(r);
  if (res === 'ok') return 'done';
  if (res === 'failed') return 'failed';
  return listingHasFill(r) ? 'pending' : null;
}
/** 只对外兼容用: 老前端/扩展还在读 fillStatus, 这里按推导结果给出等价取值(不落库) */
function legacyFillStatusOf(r) {
  const res = uploadResultOf(r);
  if (res === 'ok') return 'uploaded';
  if (res === 'failed') return 'todo';                                      // 失败 → 可重传
  if ((r.uploads || []).length) return 'filled';
  return r.fill && (r.fill.bearPrice != null || r.fill.purchaseCost != null) ? 'todo' : null;
}
/** 接口出口统一带上推导出的状态(存储里不再维护 fillStatus) */
function decorateListing(r) {
  return Object.assign({}, r, {
    uploadResult: uploadResultOf(r),
    fillState: fillStateOf(r),
    fillStatus: legacyFillStatusOf(r),
  });
}
function listingStats() {
  const by = {};
  listingRecords.forEach((r) => { by[r.status || 'pending'] = (by[r.status || 'pending'] || 0) + 1; });
  /* ★ 上传情况统计(2026-09-27): 上架记录只做记录 —— 那"记录了什么"要能一眼看到 */
  const ups = [];
  listingRecords.forEach((r) => (r.uploads || []).forEach((u) => ups.push(u)));
  const failReasons = {};
  ups.forEach((u) => { if (u.ok === false) { const k = String(u.reason || '(没给原因)').slice(0, 80); failReasons[k] = (failReasons[k] || 0) + 1; } });
  const topFailReasons = Object.keys(failReasons).map((k) => ({ reason: k, count: failReasons[k] }))
    .sort((a, b) => b.count - a.count).slice(0, 5);
  const sortedAt = ups.map((u) => String(u.at || '')).filter(Boolean).sort();
  const failAts = ups.filter((u) => u.ok === false).map((u) => String(u.at || '')).filter(Boolean).sort();
  /* ★ 状态简化后的口径: 记录只有"上传结果"一种状态数据 —— byResult 就是它 */
  const byResult = { ok: 0, failed: 0, none: 0 };
  listingRecords.forEach((r) => { const k = uploadResultOf(r); byResult[k === null ? 'none' : k] = (byResult[k === null ? 'none' : k] || 0) + 1; });
  return {
    total: listingRecords.length,
    byStatus: by,
    withVariants: listingRecords.filter((r) => r.variant && ((r.variant.children || []).length || r.variant.childCount)).length,
    bySite: listingRecords.reduce((m, r) => { const k = r.site || '?'; m[k] = (m[k] || 0) + 1; return m; }, {}),
    lastSavedAt: listingRecords.length ? listingRecords[listingRecords.length - 1].savedAt : null,
    byResult,
    uploads: {
      attempts: ups.length,
      ok: ups.filter((u) => u.ok !== false).length,
      failed: ups.filter((u) => u.ok === false).length,
      submitted: ups.filter((u) => u.submitted === true).length,
      recordsTried: listingRecords.filter((r) => (r.uploads || []).length).length,
      neverTried: listingRecords.filter((r) => !(r.uploads || []).length).length,
      failedNow: listingRecords.filter((r) => (r.status || '') === 'failed').length,
      everFailed: listingRecords.filter((r) => (r.failCount || 0) > 0).length,
      retried: listingRecords.filter((r) => (r.uploads || []).length > 1).length,
      lastAttemptAt: sortedAt.length ? sortedAt[sortedAt.length - 1] : null,
      lastFailAt: failAts.length ? failAts[failAts.length - 1] : null,
      topFailReasons,
    },
  };
}

/* ===== ★ 选品归档库 (2026-09-27) =====
 * 需求原话: 「上架器只负责记录和显示信息，导出信息等，加上一个导出当前所有商品信息…存起来，
 *   因为这些都是我们最终选出来的品，具有模板或者借鉴意义，方便后续根据这些品来找相应的品」。
 * 所以这里只做三件事: 存快照 / 检索 / 导出。不参与采集、不参与上架、不改商品库。
 */
const ARCHIVE_LIMIT_HARD = 20000;               // 商品库一次最多归档 2 万条(10 万条全量快照 ≈150MB, 不允许)
const ARCHIVE_LIMIT_DEFAULT = 3000;
const archiveKey = (site, asin) => String(asin || '').toUpperCase() + '@' + String(site || '').toLowerCase();
const aNum = (v) => { if (v == null || v === '') return null; const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^\d.\-]/g, '')); return isNaN(n) ? null : n; };
/** 归档条目统一形状 —— 两个来源(上架记录 / 商品库)都收敛成这一份, 导出表头才不会一半空一半有 */
function archiveItemFromListing(r) {
  const f = r.fill || {}, p = r.panel || {}, v = r.variant || {};
  const kids = Array.isArray(v.children) ? v.children : [];
  const it = {
    key: archiveKey(r.site, r.asin), src: 'listing', site: r.site || null, asin: r.asin || null,
    parentAsin: r.parentAsin || v.parentAsin || null,
    brand: r.brand || null, title: r.title || null, catPath: r.catPath || null,
    url: r.url || null, mainImage: r.mainImage || null,
    price: aNum(r.price), currency: r.currency || null,
    sales30d: aNum(p.sales30d), bsrShop: aNum(p.bsrShop), bsrCat: aNum(p.bsrCat), bsrCatName: p.bsrCatName || null,
    rank: aNum(p.rank), fulfill: p.fulfill || null, rating: aNum(p.rating), reviews: aNum(p.reviews),
    trademark: p.trademark || null, productType: p.productType || null,
    variantCount: (v.childCount != null ? aNum(v.childCount) : kids.length) || 0,
    variantDims: (Array.isArray(v.dims) ? v.dims : []).map((d) => d.nameCn || d.name).filter(Boolean),
    variantText: kids.length ? kids.map((c) => c.asin + (c.options && Object.keys(c.options).length ? '(' + Object.values(c.options).join('/') + ')' : '')).slice(0, 30).join(' | ') : null,
    /* 定价留痕: 这几个字段是"这个品当时是怎么定价的", 以后照它找相似品时最有用 */
    bearPrice: aNum(f.bearPrice), bearBase: aNum(f.bearBase), bearAdjRow: aNum(f.bearAdjRow),
    bearMargin: aNum(f.bearMargin), purchaseCost: aNum(f.purchaseCost), logisticsCost: aNum(f.logisticsCost),
    weightKg: aNum(f.weightKg), weightText: f.weightRaw || null, stock: aNum(f.stock), leadDays: aNum(f.leadDays),
    status: r.status || 'pending', fillStatus: r.fillStatus || null, listedAt: r.listedAt || null,
    source: r.source || 'ext-v2', collectedAt: r.collectedAt || null, savedAt: r.savedAt || null,
  };
  it.marginPct = archiveMarginPct({ bear: it.bearPrice, adj: it.bearAdjRow, p: it.purchaseCost, l: it.logisticsCost, net: aNum(f.bearNet), fx: aNum(f.bearFx) });
  return it;
}
function archiveItemFromProduct(x) {
  const it = {
    key: archiveKey(x.site, x.asin), src: 'products', site: x.site || null, asin: String(x.asin || '').toUpperCase() || null,
    /* ★ 商品库里【没有】父 ASIN 字段 —— 别拿 rankParent 顶: 那是"父类目排名"(和 rankChild 一对),
     *   拿它当父ASIN 会往导出表里写一串排名数字(实测字段核对时发现)。宁可为空, 也不编。 */
    parentAsin: null,
    brand: x.brand || null, title: x.title || null, catPath: x.catPath || null,
    url: x.url || null, mainImage: x.mainImage || null,
    price: aNum(x.price), currency: x.currency || null,
    sales30d: aNum(x.monthlySales), bsrShop: aNum(x.bsrShop), bsrCat: aNum(x.bsrCat), bsrCatName: x.bsrCatName || null,
    rank: aNum(x.rank), fulfill: x.fulfill || null, rating: aNum(x.rating), reviews: aNum(x.reviews),
    trademark: x.tmStatus || null, productType: x.productType || null,
    variantCount: aNum(x.variants) || 0, variantDims: [], variantText: null,
    bearPrice: null, bearBase: null, bearAdjRow: null, bearMargin: null,
    /* ★ 商品库的 weight 是原文串(如 "80 grams ( 80 g)") —— 不能当 kg 数值存, 单独放 weightText。
     *   重量kg 这一列只放上架记录里插件算出来的数值, 混着放会让导出表一半是数字一半是文字。 */
    purchaseCost: null, logisticsCost: null, weightKg: null, weightText: x.weight || null,
    stock: aNum(x.stock), leadDays: null,
    status: x.saved === true ? 'saved' : 'pool', fillStatus: null, listedAt: x.listedAt || null,
    source: x.source || null, collectedAt: x.collectedAt || null, savedAt: x.collectedAt || null,
    aplus: x.aplus === true, size: x.size || null, seller: x.seller || null, sellerCount: aNum(x.sellerCount),
  };
  it.marginPct = null;
  return it;
}
/** 反算利润率 —— 口径与插件一致: (承受价 − 本币调整) × 到手比例 × 汇率 ÷ (采购+物流) − 1
 *  输入缺一个就不算(不猜), 返回 null。 */
function archiveMarginPct(o) {
  const { bear, adj, p, l, net, fx } = o || {};
  if (bear == null || p == null || l == null || !net || !fx || (p + l) <= 0) return null;
  return Math.round((((bear - (adj || 0)) * net * fx) / (p + l) - 1) * 1000) / 1000;
}
/** 展平所有批次; dedup=true 时按 asin@site 去重(留最近一次归档的那份) */
function archiveFlatten(dedup) {
  const out = [];
  const tags = selectionArchive.tags || {};
  const items = selectionArchive.items || {};
  const list = selectionArchive.batches.slice().reverse();      // 老 → 新, 去重时新的覆盖旧的
  for (const b of list) {
    for (const k of (b.keys || [])) {
      const it = items[k];
      if (!it) continue;                                       // 条目被清理过(批次删掉的孤儿) → 跳过
      out.push(Object.assign({}, it, { key: k, batchId: b.batchId, batchName: b.name, archivedAt: b.createdAt, tags: tags[k] || [] }));
    }
  }
  if (!dedup) return out.reverse();
  const map = new Map();
  for (const it of out) {
    const prev = map.get(it.key);
    map.set(it.key, Object.assign({}, it, { firstArchivedAt: prev ? prev.firstArchivedAt || prev.archivedAt : it.archivedAt, times: (prev ? (prev.times || 1) : 0) + 1 }));
  }
  return [...map.values()].reverse();
}
function archiveStats() {
  const all = archiveFlatten(false), uniq = archiveFlatten(true);
  const bySite = {};
  uniq.forEach((it) => { const k = it.site || '?'; bySite[k] = (bySite[k] || 0) + 1; });
  return {
    batches: selectionArchive.batches.length,
    items: all.length, unique: uniq.length, bySite,
    lastArchivedAt: selectionArchive.batches.length ? selectionArchive.batches[0].createdAt : null,
  };
}

/* ===== ★ 选品归档 · 分布统计 (2026-09-27) =====
 * 用户问「能不能做到数据可视化（比如哪类品最多等等）」—— 这里出聚合数据, 前端画图。
 * 口径直接对齐商品库那边的 /api/products/analyze (byCategory/byBrand/byFulfill/priceBuckets),
 * 免得同一个词在两个页面给出两个数。
 * 全部按【当前筛选】(去重/批次/站点/关键词)算, 与列表看到的完全一致。 */
function archiveQuery(params) {
  const dedup = params.dedup !== '0' && params.dedup !== false;
  const batchId = String(params.batchId || '').trim();
  const site = String(params.site || '').trim().toLowerCase();
  const q = String(params.q || '').trim().toLowerCase();
  /* ★ 2026-09-27 区间/类目/标签筛选(用户要求"找相似品更顺"):
   *   类目按 catPath 一级匹配(与分布图同一个口径), 价格/利润率/月销/大排名都是区间条件,
   *   空值一律视为"不限" —— 数字解析不出来也当不限, 不让一个手滑的空格把结果清空。 */
  const cat1 = String(params.cat1 || '').trim().toLowerCase();
  const tag = String(params.tag || '').trim();
  const n = (v) => { const x = Number(v); return (v == null || v === '' || isNaN(x)) ? null : x };
  const priceMin = n(params.priceMin), priceMax = n(params.priceMax);
  const marginMin = n(params.marginMin), marginMax = n(params.marginMax);
  const salesMin = n(params.salesMin), rankMax = n(params.rankMax);
  const catOf1 = (it) => { const p = String(it.catPath || '').split('>').map((s) => s.trim()).filter(Boolean); return (p[0] || '').toLowerCase() };
  let list = archiveFlatten(dedup && !batchId);      // 指定批次时不去重(同列表接口)
  if (batchId) list = list.filter((it) => it.batchId === batchId);
  if (site) list = list.filter((it) => String(it.site || '').toLowerCase() === site);
  if (cat1) list = list.filter((it) => catOf1(it) === cat1);
  if (tag) list = list.filter((it) => (it.tags || []).indexOf(tag) >= 0);
  if (priceMin != null) list = list.filter((it) => it.price != null && Number(it.price) >= priceMin);
  if (priceMax != null) list = list.filter((it) => it.price != null && Number(it.price) <= priceMax);
  if (marginMin != null) list = list.filter((it) => it.marginPct != null && Number(it.marginPct) >= marginMin);
  if (marginMax != null) list = list.filter((it) => it.marginPct != null && Number(it.marginPct) <= marginMax);
  if (salesMin != null) list = list.filter((it) => it.sales30d != null && Number(it.sales30d) >= salesMin);
  if (rankMax != null) list = list.filter((it) => it.bsrShop != null && Number(it.bsrShop) <= rankMax);
  if (q) list = list.filter((it) => (String(it.asin || '') + ' ' + String(it.title || '') + ' ' + String(it.brand || '') + ' ' + String(it.parentAsin || '') + ' ' + String(it.catPath || '')).toLowerCase().includes(q));
  return list;
}
/* ===== ★ 自动归档(每日快照) (2026-09-27) =====
 * 用户要「长期用这份库」—— 手动点容易忘, 而价值就在"持续记录选品决策"。
 *   · 与上次归档【完全一样】时跳过 → 不产生一堆空批次
 *   · 只支持来源=上架记录: 商品库 10 万条不该每天整份快照
 *   · 批次名带时间 + auto 标记, 页面上与手工批次可区分 */
function archiveAutoRun(opts) {
  const a = selectionArchive.auto || (selectionArchive.auto = { enabled: false, hour: 3, source: 'listing', lastRunAt: null });
  const force = !!(opts && opts.force);
  if (String(a.source || 'listing') === 'products') {
    return { skipped: true, reason: '自动归档只支持来源=上架记录(商品库太大), 请在设置里改成 上架记录' };
  }
  const seen = new Set();
  const items = [];
  listingRecords.forEach((r) => {
    const it = archiveItemFromListing(r);
    if (!it || !it.key || seen.has(it.key)) return;
    seen.add(it.key); items.push(it);
  });
  if (!items.length) {
    a.lastRunAt = now(); save('selection-archive.json', selectionArchive, true);
    return { skipped: true, reason: '上架记录是空的, 没什么可归档' };
  }
  const prev = selectionArchive.batches[0];
  if (!force && prev && Array.isArray(prev.keys) && prev.keys.length === items.length && prev.keys.every((k) => seen.has(k))) {
    a.lastRunAt = now(); save('selection-archive.json', selectionArchive, true);
    return { skipped: true, reason: '和上次归档完全一样(' + items.length + ' 个品), 没有新东西要存' };
  }
  const seenAt = new Map();
  selectionArchive.batches.slice().reverse().forEach((b) => (b.keys || []).forEach((k) => { if (!seenAt.has(k)) seenAt.set(k, b.createdAt) }));
  let dupCount = 0;
  items.forEach((it) => { if (seenAt.has(it.key)) { it.dup = true; it.firstArchivedAt = seenAt.get(it.key); dupCount++ } });
  const bySite = {};
  items.forEach((it) => { const k = it.site || '?'; bySite[k] = (bySite[k] || 0) + 1 });
  const at = now();
  if (!selectionArchive.items) selectionArchive.items = {};
  items.forEach((it) => {
    const p = selectionArchive.items[it.key];
    selectionArchive.items[it.key] = Object.assign({}, it, {
      firstArchivedAt: (p && p.firstArchivedAt) || at, lastArchivedAt: at, times: ((p && p.times) || 0) + 1,
    });
  });
  const batch = {
    batchId: 'BA' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    name: '自动归档 ' + at.slice(0, 16), source: 'listing', note: force ? '手动触发' : '每日自动快照',
    createdAt: at, count: items.length, bySite, dupCount, keys: items.map((x) => x.key), auto: true,
  };
  selectionArchive.batches.unshift(batch);
  while (selectionArchive.batches.length > 200) selectionArchive.batches.pop();
  a.lastRunAt = at;
  save('selection-archive.json', selectionArchive, true);
  pushNotify('自动归档', '批次「' + batch.name + '」存了 ' + items.length + ' 个品' + (dupCount ? ' (其中 ' + dupCount + ' 个以前归档过)' : ''), '来源: 上架记录');
  return { created: true, batchId: batch.batchId, name: batch.name, count: items.length, dupCount };
}
/** 每 10 分钟看一眼: 到点且今天还没跑过 → 跑一次(只快照"没变过就不存") */
function archiveAutoTick() {
  try {
    const a = selectionArchive.auto;
    if (!a || a.enabled !== true) return;
    const d = new Date();
    if (d.getHours() < Number(a.hour != null ? a.hour : 3)) return;
    const today = d.toISOString().slice(0, 10);
    if (a.lastRunAt && String(a.lastRunAt).slice(0, 10) === today) return;
    const r = archiveAutoRun({ force: false });
    console.log('[archive] 自动归档: ' + JSON.stringify(r));
  } catch (e) { console.error('[archive] 自动归档失败: ' + ((e && e.message) || e)) }
}
const archiveAutoTimer = setInterval(archiveAutoTick, 10 * 60 * 1000);
if (archiveAutoTimer.unref) archiveAutoTimer.unref();          // 别让这个定时器吊住进程退出

const ARCHIVE_TAG_DEF = ['爆款', '试销', '放弃', '季节品'];
function archiveDistribution(params) {
  const list = archiveQuery(params);
  const top = (m, n) => Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n || 15);
  const tally = (fn) => { const m = {}; list.forEach((it) => { const k = fn(it); if (k) m[k] = (m[k] || 0) + 1; }); return m; };
  const catOf = (it, lv) => {
    const p = String(it.catPath || '').split('>').map((s) => s.trim()).filter(Boolean);
    return p.length ? (p[lv - 1] || p[p.length - 1]) : null;
  };
  /* 分档: 价格/承受价都是【站点本币】, 混站点没有可比性 → 站点筛选选上再看得更准(前端有提示) */
  const bucket = (defs, get) => {
    const out = {};
    defs.forEach((d) => { out[d.label] = 0 });
    list.forEach((it) => {
      const v = get(it);
      if (v == null) { out['未采到'] = (out['未采到'] || 0) + 1; return; }
      for (const d of defs) { if (d.test(v)) { out[d.label]++; return } }
      out['其它'] = (out['其它'] || 0) + 1;
    });
    return out;
  };
  const priceBuckets = bucket([
    { label: '<10', test: (v) => v < 10 }, { label: '10-30', test: (v) => v < 30 },
    { label: '30-100', test: (v) => v < 100 }, { label: '≥100', test: () => true },
  ], (it) => (it.price == null ? null : Number(it.price)));
  const marginBuckets = bucket([
    { label: '亏(<0)', test: (v) => v < 0 }, { label: '0-10%', test: (v) => v < 0.10 },
    { label: '10-20%', test: (v) => v < 0.20 }, { label: '20-30%', test: (v) => v < 0.30 },
    { label: '≥30%', test: () => true },
  ], (it) => (it.marginPct == null ? null : Number(it.marginPct)));
  const salesBuckets = bucket([
    { label: '0', test: (v) => v <= 0 }, { label: '1-100', test: (v) => v <= 100 },
    { label: '100-500', test: (v) => v <= 500 }, { label: '500-2000', test: (v) => v <= 2000 },
    { label: '>2000', test: () => true },
  ], (it) => (it.sales30d == null ? null : Number(it.sales30d)));
  const rankBuckets = bucket([
    { label: '≤1千', test: (v) => v <= 1000 }, { label: '1千-1万', test: (v) => v <= 10000 },
    { label: '1万-10万', test: (v) => v <= 100000 }, { label: '>10万', test: () => true },
  ], (it) => (it.bsrShop == null ? null : Number(it.bsrShop)));
  const variantBuckets = {};
  list.forEach((it) => {
    const n = Number(it.variantCount) || 0;
    const k = n <= 1 ? '单变体' : (n <= 5 ? '2-5 个' : (n <= 10 ? '6-10 个' : '>10 个'));
    variantBuckets[k] = (variantBuckets[k] || 0) + 1;
  });
  /* 四象限散点: 横=月销, 纵=利润率, 点大小=变体数(前端按这个画) */
  const scatter = list.filter((it) => it.sales30d != null && it.marginPct != null)
    .sort((a, b) => (b.sales30d || 0) - (a.sales30d || 0)).slice(0, 300)
    .map((it) => ({ asin: it.asin, site: it.site, brand: it.brand, cat1: catOf(it, 1), title: String(it.title || '').slice(0, 40),
      sales30d: Number(it.sales30d) || 0, marginPct: Number(it.marginPct) || 0, bearPrice: it.bearPrice, currency: it.currency,
      variantCount: Number(it.variantCount) || 0, tags: it.tags || [] }));
  /* 类目 × 平均利润率/平均月销: 一眼看出"哪类品又赚又好卖" */
  const catAgg = {};
  list.forEach((it) => {
    const c = catOf(it, 1) || '未归类';
    const a = catAgg[c] || (catAgg[c] = { cat: c, n: 0, marginSum: 0, marginN: 0, salesSum: 0, salesN: 0, bearSum: 0, bearN: 0 });
    a.n++;
    if (it.marginPct != null) { a.marginSum += Number(it.marginPct); a.marginN++ }
    if (it.sales30d != null) { a.salesSum += Number(it.sales30d); a.salesN++ }
    if (it.bearPrice != null) { a.bearSum += Number(it.bearPrice); a.bearN++ }
  });
  const byCategoryDetail = Object.values(catAgg).sort((a, b) => b.n - a.n).slice(0, 20).map((a) => ({
    cat: a.cat, n: a.n,
    marginAvg: a.marginN ? Math.round(a.marginSum / a.marginN * 1000) / 1000 : null,
    salesAvg: a.salesN ? Math.round(a.salesSum / a.salesN) : null,
    bearAvg: a.bearN ? Math.round(a.bearSum / a.bearN * 100) / 100 : null,
  }));
  /* 批次趋势(全部批次, 不受筛选影响): 每批存了多少、重复率 */
  const batchSeries = selectionArchive.batches.slice().map((b) => ({
    name: b.name, createdAt: b.createdAt, source: b.source, count: b.count || (b.keys || []).length, dupCount: b.dupCount || 0,
  })).reverse();
  return {
    total: list.length,
    byCategory1: top(tally((it) => catOf(it, 1))),
    byCategory2: top(tally((it) => catOf(it, 2)), 15),
    byBrand: top(tally((it) => it.brand), 15),
    bySite: top(tally((it) => String(it.site || '').toUpperCase())),
    byFulfill: top(tally((it) => it.fulfill), 6),
    byTag: top(tally((it) => (it.tags || []).join('+')), 10),
    priceBuckets, marginBuckets, salesBuckets, rankBuckets, variantBuckets,
    byCategoryDetail, scatter, batchSeries,
    tagDefs: ARCHIVE_TAG_DEF,
  };
}
const ARCHIVE_CSV_HEAD = ['站点', 'ASIN', '父ASIN', '品牌', '标题', '类目', '售价', '币种', '月销', '大排名', '小排名', '评分', '评论数',
  '配送', '变体数', '变体明细', '承受价', '反算利润率', '设定利润率', '采购成本', '物流成本', '重量kg', '重量原文', '库存', '备货天数',
  '上架状态', '上架时间', '商品链接', '主图', '标签', '来源', '归档批次', '归档时间'];
function archiveCsv(items) {
  const q = (v) => { if (v == null) return ''; const s = String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const asPct = (v) => (v == null || v === '' ? '' : Math.round(aNum(v) * 1000) / 10 + '%');
  const rows = items.map((it) => [it.site, it.asin, it.parentAsin, it.brand, it.title, it.catPath, it.price, it.currency,
    it.sales30d, it.bsrShop, it.bsrCat, it.rating, it.reviews, it.fulfill, it.variantCount, it.variantText,
    it.bearPrice, asPct(it.marginPct), asPct(it.bearMargin),
    it.purchaseCost, it.logisticsCost, it.weightKg, it.weightText, it.stock, it.leadDays,
    it.status, it.listedAt, it.url, it.mainImage, (it.tags || []).join('|'), it.src, it.batchName, it.archivedAt].map(q).join(','));
  return ARCHIVE_CSV_HEAD.join(',') + '\n' + rows.join('\n');
}

// ===== 采集停止机制 =====
// collectStop: 全局停止标志。任何采集接口收到 /api/collect/stop 后置 true,
// 所有采集循环(商品/轮次/卖家/翻页)在检查点读到 true 即提前退出, 保存已采集部分并返回。
let collectStop = false;
function collectStopRequested() { return collectStop === true; }
// 每次采集开始前调用, 清空上次停止标志
function resetCollectStop() { collectStop = false; }

// ===== 采集进度 (实时上报, 前端轮询显示在采集方式卡片上) =====
// collectProgress: { running, mode, label, startedAt, updatedAt, items, added, rounds, round, step, shopsDone, shopsTotal, error }
let collectProgress = null;
const setCollectProgress = (p) => { collectProgress = p; };
const bumpCollectProgress = (partial) => { if (collectProgress) Object.assign(collectProgress, partial, { updatedAt: Date.now() }); };
const clearCollectProgress = () => { collectProgress = null; };
// 采集接口入口统一注册进度 (mode 对应前端采集方式卡片 data-mode)
function beginCollectProgress(mode, label, extra = {}) {
  resetCollectStop();
  setCollectProgress({ running: true, mode, label, startedAt: Date.now(), updatedAt: Date.now(), items: 0, added: 0, rounds: 0, round: 0, step: '启动', ...extra });
}
// 采集结束一定 flush —— 否则用户切到「商品管理」看到的是攒批前的旧数据
function endCollectProgress() {
  clearCollectProgress();
  try { flushProducts(); } catch (e) { /* 忽略 */ }
}

function now() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }

// ===== 业务逻辑 =====

// RAG 合规检测 (模拟检索: 品牌库精确 + 关键词命中 + 规则库)
function complianceCheck(product) {
  const brand = branddb.find((b) => String(b.name || '').toLowerCase() === (product.brand || '').toLowerCase());
  const hits = rules.filter((r) => r.type === 'compliance' && r.enabled);
  const reasons = [];
  let level = 'low';
  let score = 100;

  if (brand && brand.status === 'registered') { level = 'high'; score -= 45; reasons.push(`品牌库命中: ${brand.name} 已备案 (依据: 品牌数据库 #${branddb.indexOf(brand) + 1})`); }
  if (product.bgMark) { level = 'high'; score -= 30; reasons.push('检测到 BG标 (蓝色品牌标), 规则 R-002 命中'); }
  if (product.patentRisk) { level = 'high'; score -= 30; reasons.push('专利库风险匹配 (依据: 专利库交叉验证)'); }
  if (product.tmMark) { if (level !== 'high') level = 'medium'; score -= 15; reasons.push('检测到 TM标 (商标申请中), 规则 R-003 命中'); }
  if (brand && brand.trademarkCount > 60) { if (level !== 'high') level = 'medium'; score -= 12; reasons.push(`商标记录 ${brand.trademarkCount} 条 (>60 阈值), 品牌保护强度高`); }
  if (!reasons.length) reasons.push('品牌库/专利库/规则库均未命中风险项');
  // 规则库动态沉淀的规则也参与
  hits.forEach((r) => {
    if (r.desc && (product.brand || '').toLowerCase().includes((r.title.match(/[A-Za-z0-9\-]+/g) || [''])[0].toLowerCase())) {
      reasons.push(`动态规则 ${r.id} 命中: ${r.title}`);
    }
  });

  flywheel.compliance.total++;
  return { asin: product.asin, level, score: Math.max(5, score), reasons, brandHit: !!brand, checkedAt: now() };
}

// 人工纠错 → 飞轮沉淀 (同错≥3次自动入库)
const corrCounts = {};
function correctCompliance(product, userVerdict) {
  const prev = flywheel.compliance;
  prev.corrected++;
  // 模拟: 纠错计数, 达到阈值3次沉淀新规则
  const key = `${product.asin}:${userVerdict}`;
  corrCounts[key] = (corrCounts[key] || 0) + 1;
  let newRule = null;
  if (corrCounts[key] >= 3 && !rules.some((r) => r.title.includes(product.brand))) {
    newRule = {
      id: 'R-' + String(100 + rules.length).padStart(3, '0'),
      type: 'compliance',
      title: `${product.brand} 判定修正 (人工纠错沉淀)`,
      desc: `用户将 ${product.brand} (${product.asin}) 的检测结果纠正为「${userVerdict}」, 累计${corrCounts[key]}次, 自动沉淀`,
      source: 'flywheel',
      createdAt: now(),
      hits: 0,
      enabled: true,
    };
    rules.push(newRule);
    prev.rulesSunk++;
    save('rules.json', rules);
  }
  // 更新品牌库 (人工纠错回流)
  const b = branddb.find((x) => x.name.toLowerCase() === (product.brand || '').toLowerCase());
  if (b) {
    b.status = userVerdict === '已备案' ? 'registered' : userVerdict === '未备案' ? 'notfound' : b.status;
    save('branddb.json', branddb);
  }
  prev.accuracy = Math.min(0.99, prev.accuracy + 0.005);
  save('flywheel.json', flywheel);
  return { corrected: true, newRule, counts: corrCounts[key], accuracy: prev.accuracy };
}

// ===== 真实采集 (fetch 抓 amazon 页面 + 智赢 API 补全, 失败降级历史数据) =====
const ZYING_TOKEN = process.env.ZYING_TOKEN || 'MM8bsEamq2WZsswHw5Hgx3hbr8Kjhn0Kr3sHhf1Uf0hjInRhF18EKMkvONK0xrczk5WneCMCSZ6FtjfzNbrE0dfnpc1588PW6nn3LN8odtpzbl1AGa9eHJ5tVtwJYJ6Gi';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const SITE_DOMAIN = { uk: 'co.uk', us: 'com', de: 'de', fr: 'fr', it: 'it', es: 'es', jp: 'co.jp', ca: 'ca', in: 'in', mx: 'com.mx', au: 'com.au', nl: 'nl', pl: 'pl', se: 'se', sa: 'sa', sg: 'sg', br: 'com.br', tr: 'com.tr' };

function fetchGet(url, timeout = 25) {
  return fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-GB,en;q=0.9' }, signal: AbortSignal.timeout(timeout * 1000) })
    .then((r) => r.text())
    .catch((e) => { throw new Error('fetch失败: ' + e.message); });
}

function fetchPostJson(url, body, headers = {}) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  }).then(async (r) => {
    if (r.status === 404 || r.status === 401) throw new Error('智赢API(' + r.status + ')');
    return r.json();
  }).catch((e) => { if (e.message.startsWith('智赢API')) throw e; throw new Error('fetch失败: ' + e.message); });
}

// 解析榜单页: ASIN/排名/标题
function parseBestsellersHtml(html) {
  const items = [];
  const re = /<div data-asin="([A-Z0-9]{10})"[\s\S]*?zg-bdg-text">#(\d+)<[\s\S]*?p13n-sc-css-line-clamp[^>]*>([^<]+)/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    items.push({ asin: m[1], rank: parseInt(m[2], 10), title: m[3].trim() });
  }
  return items;
}

// 历史真实数据 (此前智赢插件采集验证过的), 用于 API 降级补全
const HIST_FILE = path.join(ROOT, '_tools', '_bestsellers_50_full.json');
function loadHistory() {
  try { return JSON.parse(fs.readFileSync(HIST_FILE, 'utf8')); } catch { return []; }
}
const HISTORY = loadHistory();

// ===== CDP 驱动 (浏览器: 本地无头服务 或 用户的采集浏览器) =====
// ★ 2026-09-26 第四期: 采集不再绑死"用户那个采集浏览器"。
//   规则: 本地浏览器服务(browser-service)在跑 → 自动用它(默认 9333);
//         没跑 → 退回 9222(用户手动开的采集浏览器, 带智赢插件那个)。
//   也可运行时用 POST /api/browser/switch 强制指定。
const browserSvc = require('./browser-service.js');
const CDP_PORT_USER = 9222;                 // 用户的采集浏览器
const SHELL_CDP_PORT = 9334;                  // ★ 2026-09-28 桌面浏览器壳(Electron)的 CDP 端口 —— 采集可以直接跑在它里面
let cdpPortOverride = null;                 // 'user' | 具体端口号 | null(自动)
let browserSvcLastErr = null;               // 本地浏览器最近一次启动/停止的错误(给界面看)
/* 「服务器」页用的活动流水(环形缓冲, 最多 300 条): 浏览器起停/切换、采集起止都记一条 */
const browserActivity = [];
function pushActivity(kind, text, extra) {
  try {
    browserActivity.push(Object.assign({ at: now(), kind: kind, text: String(text).slice(0, 200) }, extra || {}));
    while (browserActivity.length > 300) browserActivity.shift();
  } catch (e) {}
}
let CDP_PORT = Number(process.env.ZYING_CDP_PORT || 0) || CDP_PORT_USER;   // 兼容旧代码里的引用
/* ★ 2026-09-27 采集浏览器「窗口形态」偏好 —— 用户要一个"专属、点开就是采集在跑、和日常浏览器隔离"的窗口。
 *   三种形态(browser-service 都支持):
 *     headless  = 真无头, 屏幕上没有窗口(默认, 最快最安静)
 *     offscreen = 有头窗口但移到屏幕外(风控更友好, 也看不见)
 *     visible   = 有头窗口摆在桌面上, 采集就在你眼前翻页
 *   存在 data/browser-prefs.json, 重启后端还记得; /api/browser/start 不指定 mode 时用它。 */
function browserPrefs() { try { return load('browser-prefs.json', {}) || {} } catch (e) { return {} } }
function browserPrefMode() { const m = browserPrefs().mode; return (m === 'offscreen' || m === 'visible') ? m : 'headless' }
function setBrowserPrefMode(m) {
  const mm = (m === 'offscreen' || m === 'visible') ? m : 'headless';
  try { const o = browserPrefs(); o.mode = mm; save('browser-prefs.json', o, true); } catch (e) {}
  return mm;
}
/** 当前该用哪个 CDP 端口(自动 = 本地服务优先) */
async function activeCdpPort() {
  if (process.env.ZYING_CDP_PORT) return Number(process.env.ZYING_CDP_PORT);
  if (cdpPortOverride === 'user') return CDP_PORT_USER;
  if (cdpPortOverride === 'shell') return SHELL_CDP_PORT;   // ★ 采集跑在桌面浏览器壳里
  if (typeof cdpPortOverride === 'number') return cdpPortOverride;
  try {
    const st = await browserSvc.status();
    if (st && st.running && st.port) return st.port;
  } catch (e) {}
  return CDP_PORT_USER;
}
/* ★ 2026-09-28 桌面浏览器壳的启停(给 status?action=shell 复用; /api/browser/shell 那套逻辑不变)
 *   注意必须清掉 ELECTRON_RUN_AS_NODE: DSH 环境里带着它, 不清掉 electron.exe 会被当普通 node 跑,
 *   不报错但窗口永远不出来(实测踩过)。 */
/* ★ 2026-09-28 换机器友好: 壳目录可配置 —— 环境变量 ZYING_SHELL_DIR > 数据目录 paths.json 的 shellDir > 默认值 */
function shellDirOf() {
  const fromEnv = String(process.env.ZYING_SHELL_DIR || '').trim();
  if (fromEnv) return fromEnv;
  try { const cfg = load('paths.json', {}) || {}; if (cfg.shellDir) return String(cfg.shellDir); } catch (e) {}
  return 'D:\\智赢erp\\zying-browser-shell';
}
function shellProbe() {
  return new Promise((resolve) => {
    const rq = http.request({ host: '127.0.0.1', port: SHELL_CDP_PORT, path: '/json/version', method: 'GET', timeout: 2000 }, (rs) => {
      let d = ''; rs.on('data', (c) => d += c);
      rs.on('end', () => { try { resolve(JSON.parse(d)) } catch (e) { resolve(null) } });
    });
    rq.on('error', () => resolve(null));
    rq.on('timeout', () => { rq.destroy(); resolve(null) });
    rq.end();
  });
}
async function shellEnsureStart() {
  const dir = shellDirOf();
  const exe = path.join(dir, 'node_modules', 'electron', 'dist', 'electron.exe');
  if (!fs.existsSync(exe)) { browserSvcLastErr = '没找到 Electron: ' + exe; return null; }
  if (await shellProbe()) return SHELL_CDP_PORT;
  const ps = 'Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue;' +
    ' Start-Process -FilePath ' + JSON.stringify(exe) + ' -ArgumentList @(' + JSON.stringify(dir) + ')' +
    ' -WorkingDirectory ' + JSON.stringify(dir) + ' -PassThru | Select-Object -ExpandProperty Id';
  await new Promise((resolve) => {
    require('child_process').execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, timeout: 25000 }, () => resolve());
  });
  for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 500)); if (await shellProbe()) return SHELL_CDP_PORT; }
  browserSvcLastErr = '浏览器壳起来了但 CDP 9334 没响应';
  return null;
}
function shellEnsureStop() {
  const ps = "$p = Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\" | Where-Object { $_.CommandLine -like '*zying-browser-shell*' };" +
    ' foreach ($x in $p) { taskkill /PID $($x.ProcessId) /T /F | Out-Null }; ($p | Measure-Object).Count';
  return new Promise((resolve) => {
    require('child_process').execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, timeout: 20000 }, (e, out) => resolve(e ? -1 : parseInt(String(out).trim(), 10) || 0));
  });
}
const CDP_SITE_CODE = { 'co.uk': 'uk', com: 'us', de: 'de', fr: 'fr', it: 'it', es: 'es', 'co.jp': 'jp', ca: 'ca', in: 'in', 'com.au': 'au', 'com.mx': 'mx', 'com.br': 'br', nl: 'nl', se: 'se', pl: 'pl' };
// 站点代码 → amazon 域名后缀 (含自定义站点: au/mx/br/nl/se/pl/tr/ae/sa/sg 等)
function siteToHostSuffix(site) {
  const map = { uk: 'co.uk', us: 'com', jp: 'co.jp', au: 'com.au', mx: 'com.mx', br: 'com.br', sg: 'com.sg', tr: 'com.tr', ae: 'ae', sa: 'sa', nl: 'nl', se: 'se', pl: 'pl', de: 'de', fr: 'fr', it: 'it', es: 'es', ca: 'ca', in: 'in' };
  return map[site] || site;
}
/* ★ 2026-09-26 「服务器」页专用: 只认本地浏览器服务 —— 本地没跑就报错, 绝不回落到用户的采集浏览器
 *   (踩过: 本地挂了 → activeCdpPort() 回落 9222 → 页面上的点击打进了用户的浏览器) */
async function localBrowserPages(autoOpen) {
  const st = await browserSvc.status();
  if (!st || !st.running || !st.port) return { ok: false, error: '本地浏览器没在跑(先点「启动无头」)' };
  let all = await browserSvc.listPages(st.port);
  // ★ 没有可用标签时自动开一个(否则服务器页没画面、也没法操作)
  const usable = all.filter((x) => x.type === 'page' && !/^(about:blank|devtools:|chrome:|edge:)/.test(x.url || ''));
  if (!usable.length && autoOpen !== false) {
    try { await browserSvc.openPage('https://www.amazon.co.uk/', st.port); await new Promise((r) => setTimeout(r, 4000)); all = await browserSvc.listPages(st.port) } catch (e) {}
  }
  const pages = all
    .filter((x) => x.type === 'page' && !/^(about:blank|devtools:|chrome:|edge:)/.test(x.url || ''))
    .sort((a, b) => (pageRank(a.url) - pageRank(b.url)) || (String(a.url).length - String(b.url).length));
  return { ok: true, port: st.port, pages: pages };
}

/* ★ 2026-09-26 「服务器」页统一标签列表: 状态/截图/输入三处必须同一份顺序 */
function pageRank(u) {
  u = String(u || '');
  if (/amazon\./i.test(u)) return 0;
  if (/ifast\.top/i.test(u)) return 1;
  if (/^http:\/\/127\.0\.0\.1:3088/.test(u)) return 3;
  if (/^http:\/\/127\.0\.0\.1:5\d{4}/.test(u)) return 4;
  return 2;
}
async function browserPages(port) {
  const p = port || (await activeCdpPort());
  const all = await browserSvc.listPages(p);
  return all
    .filter((x) => x.type === 'page' && !/^(about:blank|devtools:|chrome:|edge:)/.test(x.url || ''))
    .sort((a, b) => (pageRank(a.url) - pageRank(b.url)) || (String(a.url).length - String(b.url).length));
}

function cdpGetTabs() {
  return new Promise((resolve, reject) => {
    activeCdpPort().then((port) => {
    http.get({ host: '127.0.0.1', port: port, path: '/json' }, (res) => {
      let d = '';
      res.on('data', (c) => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', (e) => reject(new Error('CDP 连不上 127.0.0.1:' + port + ' —— ' + (e && e.message || e) + '（本地无头浏览器可能在重启, 或用户的采集浏览器没开）')));
    }).catch(reject);
  });
}
/* ★ CDP 连接复用: 服务器页每秒要截好几帧, 每帧重新握手太慢(实测画面卡顿主因之一) */
const cdpCache = {};
async function cdpGet(wsUrl) {
  const c = cdpCache[wsUrl];
  if (c && c.ws && c.ws.readyState === 1 && (Date.now() - c.at) < 120000) { c.at = Date.now(); return c.send }
  const h = await cdpConnect(wsUrl);
  cdpCache[wsUrl] = { send: h.send, ws: h.ws, at: Date.now() };
  try { h.ws.onclose = () => { delete cdpCache[wsUrl] } } catch (e) {}
  return h.send;
}

function cdpConnect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let msgId = 0;
    const pending = {};
    const evHandlers = {};        // ★ 事件订阅(Page.screencastFrame 这类推送要用)
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending[msg.id]) { pending[msg.id](msg.result); delete pending[msg.id]; return; }
      if (msg.method) {
        const hs = evHandlers[msg.method];
        if (hs) hs.slice().forEach((fn) => { try { fn(msg.params || {}) } catch (e) {} });
      }
    };
    ws.onopen = () => {
      const send = (method, params = {}) => new Promise((r, rej) => {
        const id = ++msgId;
        const timer = setTimeout(() => { delete pending[id]; rej(new Error('CDP ' + method + ' 超时')); }, 30000);
        pending[id] = (res) => { clearTimeout(timer); r(res); };
        try { ws.send(JSON.stringify({ id, method, params })); } catch (e) { clearTimeout(timer); delete pending[id]; rej(e); }
      });
      const on = (method, fn) => {
        (evHandlers[method] = evHandlers[method] || []).push(fn);
        return () => { evHandlers[method] = (evHandlers[method] || []).filter((x) => x !== fn) };
      };
      resolve({ ws, send, on });
    };
    ws.onerror = (e) => reject(new Error('WebSocket 连接失败: ' + e.message));
  });
}

// 店铺页 CDP 采集 (复用 zying-shop-collect.js 逻辑)
async function cdpShopCollect(url, maxItems = 10) {
  const tabs = await cdpGetTabs();
  const page = tabs.find((t) => t.type === 'page');
  if (!page) throw new Error('Edge 无可用页面标签, 请确认 Edge 以 --remote-debugging-port=9222 启动');
  const { send } = await cdpConnect(page.webSocketDebuggerUrl);

  await send('Page.navigate', { url });
  await new Promise((r) => setTimeout(r, 8000));
  const st = await send('Runtime.evaluate', {
    expression: `(() => {
      const t = document.body ? document.body.textContent.slice(0, 2000) : '';
      const cap = /captcha|Robot Check|Enter the characters|验证码|api-services-support@amazon/i.test(t);
      return JSON.stringify({ cap, title: document.title });
    })()`, returnByValue: true,
  });
  const state = JSON.parse(st.result.value);
  if (state.cap) throw new Error('触发验证码/风控, 请手动过验证后重试');

  for (let i = 0; i < 8; i++) {
    await send('Runtime.evaluate', { expression: `window.scrollTo(0, ${(i + 1) * 4000})` });
    await new Promise((r) => setTimeout(r, 1200));
  }
  await new Promise((r) => setTimeout(r, 2000));

  const r = await send('Runtime.evaluate', {
    expression: `(() => {
      ${linksCollector.READ_RANKS_FN}
      const cards = [];
      document.querySelectorAll('div[data-asin]').forEach(el => {
        const asin = el.getAttribute('data-asin');
        if (!asin || !/^[A-Z0-9]{10}$/.test(asin)) return;
        const titleEl = el.querySelector('h2 span, h2, .a-color-base.a-text-normal');
        const title = titleEl ? titleEl.textContent.trim() : '';
        const priceEl = el.querySelector('.a-price .a-offscreen, .a-price-whole');
        const price = priceEl ? priceEl.textContent.trim() : '';
        const ratingEl = el.querySelector('.a-icon-alt, [aria-label*="star"], [aria-label*="Stern"]');
        const rating = ratingEl ? ratingEl.getAttribute('aria-label') || ratingEl.textContent.trim() : '';
        const reviewEl = el.querySelector('a[aria-label*="ratings"], a[aria-label*="Bewertungen"], .a-size-base.s-underline-text');
        const reviews = reviewEl ? reviewEl.textContent.trim() : '';
        const linkEl = el.querySelector('a.a-link-normal[href*="/dp/"], a[href*="/dp/"]');
        const link = linkEl ? linkEl.href : '';
        cards.push({ asin, title: title.slice(0, 250), price, rating: rating.slice(0, 60), reviews: reviews.slice(0, 40), link });
      });
      const seen = new Set();
      return JSON.stringify(cards.filter(c => { if (seen.has(c.asin)) return false; seen.add(c.asin); return true; }));
    })()`, returnByValue: true,
  });
  let items;
  try { items = JSON.parse(r.result.value); } catch { items = []; }
  return items.slice(0, maxItems);
}

// ===== 店铺列表页采集 (翻页取全部商品 → 详情补全 → 过滤 → 入库) =====
// 输入: 店铺列表页 URL (如 /s?me=XXXX&language=en&marketplaceID=...)
// 流程: 翻页采集商品 → 逐个跳详情页(详情修正: 价格/品牌/排名/主图/配送FBA-FBM) → 按过滤条件(FBA/FBM等)筛选 → 入库
async function cdpShopListCollect(url, opts = {}) {
  const siteMatch = url.match(/amazon\.(com\.au|co\.uk|com|com\.mx|com\.br|de|fr|it|es|co\.jp|ca|in|nl|se|pl)/);
  const site = siteMatch && CDP_SITE_CODE[siteMatch[1]] ? CDP_SITE_CODE[siteMatch[1]] : 'de';
  const host = 'www.amazon.' + siteToHostSuffix(site);
  const maxPages = Math.min(10, Math.max(1, opts.maxPages || 3));
  const maxItems = Math.min(100, Math.max(1, opts.maxItems || 50));
  const filter = opts.filter || {};
  // ★ 2026-09 改造(统一不跳转): 默认【不逐个商品跳详情页】。
  //   旧行为每个商品要 2 次导航 (cdpReadOnePanel 一次 + cdpEnrichOne 一次), 是"进入店铺采集商品"
  //   这一步最慢的地方。现在字段由店铺卡片 DOM + 卡片插件面板就地给出, 缺的由「补采」按需补。
  //   需要旧行为时显式传 jumpDetail=1。
  const jumpDetail = opts.jumpDetail === true || opts.jumpDetail === 1 || opts.jumpDetail === '1';
  const tabs = await cdpGetTabs();
  const page = tabs.find((t) => t.type === 'page' && /amazon\.(com\.au|co\.uk|com|com\.mx|com\.br|de|fr|it|es|co\.jp|ca|in|nl|se|pl)/.test(t.url))
    || tabs.find((t) => t.type === 'page' && !t.url.includes('3088') && !t.url.startsWith('data:'))
    || tabs.find((t) => t.type === 'page');
  if (!page) throw new Error('Edge 无可用页面标签, 请确认 Edge 以 --remote-debugging-port=9222 启动');
  const { send } = await cdpConnect(page.webSocketDebuggerUrl);
  // ① 翻页采集商品列表
  const items = [];
  const seen = new Set();
  for (let pg = 1; pg <= maxPages && items.length < maxItems * 2; pg++) {
    if (collectStopRequested()) { items.push({ asin: '停止', title: '用户已停止采集' }); break; }
    const pgUrl = pg === 1 ? url : url + (url.includes('?') ? '&' : '?') + 'page=' + pg;
    await send('Page.navigate', { url: pgUrl });
    await new Promise((r) => setTimeout(r, 8000));
    for (let i = 0; i < 5; i++) { await send('Runtime.evaluate', { expression: `window.scrollTo(0, ${(i + 1) * 4000})` }); await new Promise((r) => setTimeout(r, 1000)); }
    await new Promise((r) => setTimeout(r, 1500));
    const r = await send('Runtime.evaluate', {
      expression: `(() => {
        ${linksCollector.READ_RANKS_FN}
        const cards = [];
        document.querySelectorAll('div[data-asin]').forEach(el => {
          const asin = el.getAttribute('data-asin');
          if (!asin || !/^[A-Z0-9]{10}$/.test(asin)) return;
          // 商品判定: 有 /dp/ 链接即可 (不放宽图片条件 — 商品图懒加载, 滚动后常未就绪, 按图过滤会漏采; 详情页会补全)
          if (!el.querySelector('a[href*="/dp/"]')) return;
          const t = el.querySelector('h2 span, h2');
          const pr = el.querySelector('.a-price .a-offscreen, .a-price-whole');
          // 卡片配送标志: Fulfilled by Amazon / Versand durch Amazon → FBA; 其他 → null(需详情确认)
          const cardTxt = (el.textContent || '');
          let fulfill = null;
          // ★ 2026-09-24: 卡片文本判配送也补 法/西/意 (原只认英/德 → FR 站卡片判不出); 拿不到一律 null, 不默认 FBM
          if (/Fulfilled by Amazon|Versand durch Amazon|Dispatches from Amazon|Ships from Amazon|Exp[ée]di[ée] par Amazon|Vendido por Amazon|Enviado por Amazon|Venduto e spedito da Amazon|亚马逊配送/i.test(cardTxt)) fulfill = 'FBA';
          else if (/Verkauf und Versand durch Amazon|Sold by Amazon|Vendu par Amazon|Vendido por Amazon/i.test(cardTxt)) fulfill = 'FBA';
          else if (/Verkauf und Versand durch|Dispatched from and sold by|Exp[ée]di[ée] (?:et vendu )?par(?!\\s*Amazon)|Vendu et exp[ée]di[ée] par(?!\\s*Amazon)|Vendido y enviado por(?!\\s*Amazon)|Venduto e spedito da(?!\\s*Amazon)/i.test(cardTxt)) fulfill = 'FBM';
          // ★ 2026-09 统一不跳转: 详情补全默认关闭, 所以评分/评论/主图/品牌必须在这里就地取到 ——
          //   这些本来就在店铺卡片 DOM 上 (旧实现只取 asin/标题/价格/配送, 其余全靠跳详情页补)。
          const ratingEl = el.querySelector('.a-icon-alt, [aria-label*="out of 5"]');
          const reviewEl = el.querySelector('a[aria-label*="ratings"], .a-size-base.s-underline-text');
          const imgEl = el.querySelector('img.s-image');
          let brand = null;
          el.querySelectorAll('a[href*="field-keywords="]').forEach((a) => {
            if (brand) return;
            const bt = (a.textContent || '').trim();
            if (bt && bt.length < 60) brand = bt;
          });
          // 卡片内智赢插件面板文本 (与 links-collector 同一套选择器) → 后端交给 parsePanelText 解析
          let panelTxt = '';
          let panelRoot = null;
          el.querySelectorAll('[class*="zying"], [class*="zy-"], [id*="zying"]').forEach((n) => {
            const nt = (n.innerText || n.textContent || '').replace(/\\s+/g, ' ').trim();
            if (/ASIN\\s*[:：]/.test(nt) && nt.length > panelTxt.length) { panelTxt = nt; panelRoot = n.shadowRoot || n }
          });
          // ★ 2026-09-25 结构化排名行(按 DOM: ranktag + 榜单链接层级 + 标签), 文本正则会把子类目数字当大排名
          const rankInfo = panelRoot ? readRanks(panelRoot) : null;
          cards.push({
            asin, title: t ? t.textContent.trim().slice(0, 200) : '', price: pr ? pr.textContent.trim() : '', fulfill,
            rating: ratingEl ? (ratingEl.getAttribute('aria-label') || ratingEl.textContent || '').trim().slice(0, 40) : null,
            reviews: reviewEl ? (reviewEl.textContent || '').trim().slice(0, 20) : null,
            mainImage: imgEl ? imgEl.getAttribute('src') : null,
            brand, panelTxt: panelTxt || null, rankInfo: rankInfo,
          });
        });
        return JSON.stringify(cards);
      })()`, returnByValue: true,
    });
    let pageItems = [];
    try { pageItems = JSON.parse(r.result.value); } catch {}
    // ★ 2026-09 统一不跳转: 卡片字段就地归一化 + 卡片插件面板就地解析。
    //   这两步原本发生在"逐个商品跳详情页"阶段 (cdpReadOnePanel / cdpEnrichOne), 现在提前到列表页做。
    pageItems.forEach((x) => {
      if (typeof x.rating === 'string') { const m = x.rating.match(/([\d.,]+)/); x.rating = m ? parseFloat(m[1].replace(',', '.')) : null; }
      if (typeof x.reviews === 'string') { const m = String(x.reviews).replace(/[.,]/g, '').match(/(\d+)/); x.reviews = m ? parseInt(m[1], 10) : null; }
      if (x.panelTxt) {
        let pd = null;
        try { pd = linksCollector.parsePanelText(x.panelTxt, x.__flag || null); } catch (e) { pd = null; }   // 面板文案变化不应中断采集
        if (pd) {
          if (pd.fulfill) x.fulfill = pd.fulfill;                        // 插件面板配送标签比卡片启发式可靠
          if (pd.brand && !x.brand) x.brand = pd.brand;
          /* ★ 2026-10-02 卖家国家(国旗图标) 落地 —— 用户要按「中国卖家」筛商品。
           * 三态必须保留(见 links-collector.parsePanelText 注释):
           *   true/false = 读到了国旗; null = 没读到(插件未登录/面板没渲染完), 不能当成"非中国"。 */
          if (pd.sellerCountryCode) x.sellerCountryCode = pd.sellerCountryCode;
          if (pd.sellerFlagCode) x.sellerFlagCode = pd.sellerFlagCode;
          if (pd.chinaSeller != null) x.chinaSeller = pd.chinaSeller;
          else if (!Object.prototype.hasOwnProperty.call(x, 'chinaSeller')) x.chinaSeller = null;
          if (pd.tmStatus && pd.tmStatus.count != null) { x.trademarkCount = pd.tmStatus.count; x.tmText = pd.tmStatus.count + '个' + pd.tmStatus.status; }
          if (pd.sales30d) x.monthlySales = parseInt(String(pd.sales30d).replace(/[^\d]/g, ''), 10) || 0;
          if (pd.sellerCount != null) x.followCount = parseInt(String(pd.sellerCount).replace(/[^\d]/g, ''), 10) || 0;
          // ★ 2026-09 变体族: 面板「变体：N个」= card 级证据(不跳详情也能拿到) → 供 computeVariantKey 判置信度
          // 判据: 数组要非空, 标量要 >0 —— 存量为 0/空数组时都算"还没有信息"(否则 0 == null 为 false 会把写入挡掉)
          if (pd.variants != null && !(Array.isArray(x.variants) ? x.variants.length : (Number(x.variants) > 0))) x.variants = pd.variants;
          // 面板排名走既有约定: 店铺选品→bsrShop(父类), 榜单选品→bsrCat(子类), 不混进 bsr 数组
          mergePanelRanks(x, x.panelTxt);
          // ★ 2026-09-25 结构化排名行覆盖文本正则(并给出"未上榜/未采到"三态)
          if (x.rankInfo) {
            try {
              const rk = linksCollector.classifyRanks(x.rankInfo);
              if (rk.rankRows && rk.rankRows.length) {
                x.bsrShop = rk.bsrShop; x.bsrShopCat = rk.bsrShopCat;
                x.bsrCat = rk.bsrCat; x.bsrCatName = rk.bsrCatName;
                x.rankParentState = rk.rankParentState; x.rankChildState = rk.rankChildState;
                x.rankRows = rk.rankRows;
              }
            } catch (e) { /* 结构化读失败 → 保留文本解析结果, 不中断采集 */ }
          }
          delete x.rankInfo;
        }
      }
      delete x.panelTxt; delete x.rankInfo;
      if (seen.has(x.asin)) return;
      seen.add(x.asin);
      items.push(x);
    });
    bumpCollectProgress({ step: '店铺翻页采集', items: items.length, page: pg, pages: maxPages });
    if (pageItems.length < 16) break; // 无更多页
  }
  if (!items.length) throw new Error('店铺页未提取到商品 (可能需登录或页面结构变化)');
  // ② 列表页初筛: 卡片已标记配送 (FBA/FBM), 与过滤条件不符的直接跳过, 不跳详情页
  //    (卡片无配送标志 → 保留待详情确认)
  let preSkipped = 0;
  const list = items.slice(0, maxItems);
  for (const it of list) {
    if (filter.fulfill && it.fulfill && it.fulfill !== filter.fulfill) { it.__skip = true; preSkipped++; }
  }
  // ③ 逐个商品: 跳详情页 → 等插件面板加载完成获取全部插件信息(品牌/商标/配送/排名/销量) → 过滤判定 → 再跳下一个
  let detailDone = 0;
  for (const it of list) {
    if (collectStopRequested()) break;
    if (it.__skip) continue;
    // ★ 统一不跳转 (默认): 不再逐个商品导航详情页。
    //   旧行为每个商品 2 次导航 (cdpReadOnePanel 一次 + cdpEnrichOne 一次) —— 这就是"进入店铺采集商品"
    //   这一步慢的主因。字段改由卡片 DOM + 卡片插件面板就地给出(见 ① 的卡片解析), 缺的由「补采」按需补。
    if (!jumpDetail) {
      it.__skip = !applyCollectFilter(it, filter);
      continue;
    }
    detailDone++;
    bumpCollectProgress({ step: '详情补全', items: items.length, detailDone, detailTotal: list.length });
    try {
      // ① 插件面板 (等加载完成, 含商标hover): 配送FBA/FBM/品牌/商标/排名/销量 以插件为准
      let pd = null;
      try { pd = await cdpReadOnePanel(send, it.asin, host.replace('www.amazon.', '')); } catch {}
      if (pd && !pd.error) {
        if (pd.fulfill) it.fulfill = pd.fulfill;
        if (pd.brand) it.brand = pd.brand;
        if (pd.tmText) it.tmText = pd.tmText;
        if (pd.trademarkCount != null) it.trademarkCount = pd.trademarkCount;
        if (pd.tmCountries && pd.tmCountries.length) it.tmCountries = pd.tmCountries;
        if (pd.bsr && pd.bsr.length) it.bsr = pd.bsr;
        if (pd.sales30d) it.monthlySales = parseInt(String(pd.sales30d).replace(/[^\d]/g, ''), 10) || 0;
      }
      // ② 网页数据 (价格/主图/评分/评论等) — cdpEnrichOne 会导航详情页并做过滤判定
      await cdpEnrichOne(send, host, it, filter);
      // ③ 配送: 插件面板优先 (网页可能读不到, 如 FBA 商品网页无标志)
      if (pd && pd.fulfill) it.fulfill = pd.fulfill;
      it.__skip = !applyCollectFilter(it, filter);
    } catch (e) { console.error('[shop-list-detail]', it.asin, '异常:', e && e.message); it.__skip = true; }
  }
  const kept = list.filter((x) => !x.__skip);
  // ④ 入库
  const currency = siteCurrency(site);   // 按站点真实币种 (旧实现把非 uk/us 一律写成 EUR)
  const used = new Set(products.map((x) => x.asin));
  let added = 0;
  for (const p of kept) {
    if (used.has(p.asin)) continue;
    used.add(p.asin);
    const price = (p.price != null && !isNaN(Number(p.price))) ? Number(p.price) : parseMoneyText(p.price, p.site || site);   // ★ 站点感知   // 价格读不到 → null (绝不随机伪造)
    const maxRank = Array.isArray(p.bsr) && p.bsr.length ? Math.max(...p.bsr.map((b) => b.rank)) : null;
    const item = {
      id: p.asin, asin: p.asin, rank: maxRank != null ? '#' + maxRank : null, title: p.title, brand: p.brand || null,
      // ★ 2026-09: 这 3 个字段旧实现写死 0 (全靠跳详情页补), 现在直接取卡片插件面板的解析结果
      brandStatus: 'unchecked', bgMark: false, tmMark: /TM|注册商标/.test(p.tmText || ''), patentRisk: false, trademarkCount: p.trademarkCount || 0,
      followCount: p.followCount || 0, chinaSeller: chinaSellerOf(p), sellerCountryCode: sellerCountryCodeOf(p), fulfill: p.fulfill || null, amazonSell: p.amazonSell != null ? !!p.amazonSell : null,
      mainImage: p.mainImage || null,
      price, currency, monthlySales: p.monthlySales || 0, reviews: p.reviews != null ? p.reviews : null, rating: (typeof p.rating === 'number' ? p.rating : (parseFloat(String(p.rating || '').match(/[\d.]+/)?.[0]) || null)), stock: 0,
      listedAt: null, size: null, weight: null, variations: 0,   // 卡片刻表读不到上架日期 → null (不写"今天")
      tmCountries: p.tmCountries || [], tmText: p.tmText || null,
      bsrShop: p.bsrShop || null, bsrCat: p.bsrCat || null, bsrShopCat: p.bsrShopCat || null, bsrCatName: p.bsrCatName || null,
      badge: p.badge || null, aplus: p.aplus || false,
      bsr: p.bsr || [],
      referralFee: 0, netProfit: 0,
      site, category: p.category || 'Shop', collectedAt: now(), source: 'cdp-shop-list', saved: false, real: true,
    };
    if (item.price != null) {
      item.referralFee = Math.round(item.price * 0.15 * 100) / 100;
      item.netProfit = Math.round((item.price - item.referralFee - 3.2 - item.price * 0.3) * 100) / 100;
      item.aiSuggestPrice = Math.round((item.price - 0.5) * 100) / 100;
    } else {
      // 价格读不到 → 派生字段一律 null (不写 0, 更不写负数)
      item.referralFee = null; item.netProfit = null; item.aiSuggestPrice = null;
    }
    item.aiScore = Math.round(Math.min(96, Math.max(30, 80 - item.trademarkCount * 0.5)));
    item.aiRiskLevel = 'low';
    products.unshift(applyRankFields(item));
    added++;
  }
  if (added > 0) save('products.json', products);
  return { site, host, url, pages: maxPages, productCount: kept.length, skipped: list.length - kept.length, preSkipped, total: items.length, added, stopped: collectStopRequested(), products: kept.map((x) => ({ asin: x.asin, title: (x.title || '').slice(0, 60), price: x.price, fulfill: x.fulfill })) };
}

// 店铺 ASIN → 详情页插件面板采集 (复用 cdp 连接, 逐条导航详情页读面板)
async function cdpPanelCollect(url, maxItems = 5) {
  const tabs = await cdpGetTabs();
  const page = tabs.find((t) => t.type === 'page');
  if (!page) throw new Error('Edge 无可用页面标签, 请确认 Edge 以 --remote-debugging-port=9222 启动');
  const { send } = await cdpConnect(page.webSocketDebuggerUrl);
  const siteMatch = url.match(/amazon\.(com\.au|co\.uk|com|com\.mx|com\.br|de|fr|it|es|co\.jp|ca|in|nl|se|pl)/);
  const site = siteMatch && CDP_SITE_CODE[siteMatch[1]] ? CDP_SITE_CODE[siteMatch[1]] : 'uk';
  const domain = site === 'uk' ? 'co.uk' : site === 'us' ? 'com' : site;

  // 1. 店铺页提取 ASIN
  await send('Page.navigate', { url });
  await new Promise((r) => setTimeout(r, 8000));
  for (let i = 0; i < 6; i++) {
    await send('Runtime.evaluate', { expression: `window.scrollTo(0, ${(i + 1) * 4000})` });
    await new Promise((r) => setTimeout(r, 1000));
  }
  await new Promise((r) => setTimeout(r, 1500));
  const r1 = await send('Runtime.evaluate', {
    expression: `(() => {
      const seen = new Set(); const out = [];
      document.querySelectorAll('div[data-asin]').forEach(el => {
        const asin = el.getAttribute('data-asin');
        if (!asin || !/^[A-Z0-9]{10}$/.test(asin) || seen.has(asin)) return;
        seen.add(asin);
        const t = el.querySelector('h2 span, h2, .a-color-base.a-text-normal');
        out.push({ asin, title: t ? t.textContent.trim().slice(0, 150) : '' });
      });
      return JSON.stringify(out);
    })()`, returnByValue: true,
  });
  let asins = [];
  try { asins = JSON.parse(r1.result.value); } catch {}
  asins = asins.slice(0, maxItems);
  if (!asins.length) throw new Error('店铺页未提取到 ASIN');

  // 2. 逐条导航详情页读面板
  const results = [];
  for (const it of asins) {
    if (collectStopRequested()) break;
    await send('Page.navigate', { url: `https://www.amazon.${domain}/dp/${it.asin}` });
    await new Promise((r) => setTimeout(r, 9000));
    for (let i = 0; i < 3; i++) {
      await send('Runtime.evaluate', { expression: `window.scrollTo(0, ${(i + 1) * 2000})` });
      await new Promise((r) => setTimeout(r, 800));
    }
    await new Promise((r) => setTimeout(r, 1200));
    // 面板加载重试
    let panelTxt = null, analyzing = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      const r2 = await send('Runtime.evaluate', {
        expression: `(() => {
          const p = document.querySelector('.zy-tool-detail') || document.querySelector('.zying-shadow-root');
          if (!p) return JSON.stringify({ ok: false });
          const txt = (p.textContent || '').replace(/\\s+/g, ' ').trim();
          return JSON.stringify({ ok: true, analyzing: /正在分析/.test(txt), txt: txt.slice(0, 3000) });
        })()`, returnByValue: true,
      });
      const st = JSON.parse(r2.result.value);
      if (st.ok && !st.analyzing) { panelTxt = st.txt; break; }
      analyzing = st.ok && st.analyzing;
      await new Promise((r) => setTimeout(r, 2500));
    }
    if (!panelTxt) { results.push({ ...it, error: analyzing ? '插件仍在分析中' : '插件面板未加载' }); continue; }
    results.push(parsePanelText(panelTxt, it.asin, it.title));
  }
  return { site, results };
}

// 面板文本 → 结构化字段 (与 zying-panel-collect.js 相同逻辑)
function parsePanelText(t, asinFallback, title, flagInfo) {
  const nextKey = (start) => {
    const keys = ['品牌', '卖家', '尺寸', '包装尺寸', '重量', '包装重量', 'FBA费用', '商品类型', '上架', '近30天销量', 'ASIN', '榜单选品', '变体', 'color', 'colour', 'size'];
    let best = -1;
    keys.forEach((k) => {
      const i = t.indexOf(k + '：', start), i2 = t.indexOf(k + ':', start);
      const pos = i >= 0 && i2 >= 0 ? Math.min(i, i2) : Math.max(i, i2);
      if (pos >= 0 && (best < 0 || pos < best)) best = pos;
    });
    return best;
  };
  const grab = (key) => {
    const kPos = t.indexOf(key + '：') >= 0 ? t.indexOf(key + '：') : t.indexOf(key + ':');
    if (kPos < 0) return null;
    const start = kPos + key.length + 1, end = nextKey(start);
    const val = end > start ? t.slice(start, end) : t.slice(start);
    return val.trim().replace(/\s+/g, ' ') || null;
  };
  const brandRaw = grab('品牌') || '';
  const sellerRaw = grab('卖家') || '';
  // 品牌 + 商标状态分离: "MORICHS1个已注册" / "SANSHAOS未查到(仅供参考)" / "Generic50个注册商标"
  const tmM = brandRaw.match(/^(.+?)(\d+\s*个已注册|已注册|\d+\s*个注册商标|已备案|未查到|有风险|TM标|R标|\(仅供参考\))(.*)$/);
  const brand = tmM ? tmM[1].trim() : (brandRaw.replace(/(\(仅供参考\))/g, '').trim() || null);
  const tmText = tmM ? (tmM[2] + (tmM[3] || '')).trim() : null;
  const tmNum = tmText ? (tmText.match(/\d+/) ? parseInt(tmText.match(/\d+/)[0], 10) : (tmText.includes('已注册') || tmText.includes('已备案') || tmText.includes('注册商标') ? 1 : 0)) : 0;
  const ranks = [];
  // 面板排名格式: "#15,157PC & Video Games榜单选品" (数字含逗号千分位)
  const rankRe = /#([\d.,]+)\s*([^#]{2,40}?)\s*榜单选品/g;
  let rm;
  while ((rm = rankRe.exec(t)) !== null) {
    const rv = parseInt(rm[1].replace(/[.,]/g, ''), 10);
    const cat = rm[2].trim();
    if (rv > 0 && cat.length >= 2) ranks.push({ rank: rv, category: cat.slice(0, 40) });
  }
  // 卖家: 清理 FBM/FBA/卖家:N/店铺选品 杂质
  const seller = sellerRaw ? sellerRaw.replace(/FBA|FBM|卖家[:：]\s*\d+|店铺选品/g, '').replace(/\s+/g, ' ').trim() || null : null;
  const sellerCountM = t.match(/卖家[:：]\s*(\d+)/);
  // FBM/FBA/AMZ: 只认面板「卖家：<名> <token>」里的 token。
  // ★ 2026-09-24 修正(采集准确性): 原写法把 /FBA/ 拿去匹配【整段面板文本】, 而面板必定含「FBA费用」
  //   → 会误判(所以才需要 (?!费用) 这种补丁); 且 token 里的 AMZ 自营原来两边都不认 → 落成 null。
  //   现在直接取 token(真值), 补上 AMZ; 拿不到就 null —— 绝不猜, 更绝不默认成 FBM。
  //   限制: token 必须在 卖家 字段内(≤40 字符), 且不能是「FBA费用」里的 FBA —— 否则 (.*?) 会一路
  //   吃到后面的 FBA费用 把整库判成 FBA (实测单元测试就复现了这一点)。
  const sellTokM = t.match(/卖家\s*[:：]\s*([^#]{0,40}?)\s*(FBA|FBM|AMZ)\b(?!\s*费用)/);
  const fulfill = sellTokM ? sellTokM[2].toUpperCase() : null;
  const salesRaw = grab('近30天销量');
  const fbaFee = grab('FBA费用');
  const sizeRaw = grab('尺寸');
  const variantSize = grab('size') || grab('Size');
  const color = grab('color') || grab('colour') || grab('Color');
  // ===== 商标国家解析: 扫描面板文本中的国家/地区商标标记 =====
  const tmCountries = [];
  const TM_COUNTRY_MAP = [
    { names: ['欧盟', 'EUIPO', 'EU 商标', 'European Union'], label: '欧盟' },
    { names: ['英国', 'UKIPO', 'UK 商标', 'United Kingdom'], label: '英国' },
    { names: ['美国', 'USPTO', 'US 商标', '美国专利'], label: '美国' },
    { names: ['德国', 'DPMA', 'DE 商标', '德国专利'], label: '德国' },
    { names: ['日本', 'JPO', 'JP 商标'], label: '日本' },
    { names: ['中国', 'CNIPA', 'CN 商标', '中国商标'], label: '中国' },
    { names: ['法国', 'INPI', 'FR 商标'], label: '法国' },
    { names: ['意大利', 'UIBM', 'IT 商标'], label: '意大利' },
    { names: ['西班牙', 'OEPM', 'ES 商标'], label: '西班牙' },
    { names: ['马德里', 'WIPO', 'Madrid'], label: '马德里' },
  ];
  TM_COUNTRY_MAP.forEach((c) => {
    if (c.names.some((n) => t.includes(n))) tmCountries.push(c.label);
  });
  return {
    asin: grab('ASIN') || asinFallback,
    title,
    brand,
    tmText,                             // 商标状态原文: "1个已注册" / "未查到" / "50个注册商标"
    trademarkCount: tmNum,              // 商标数
    tmCountries,                        // 商标国家/地区 (欧盟/英国/美国/德国/日本/马德里...)
    seller,
    fulfill,
    sellerCount: sellerCountM ? parseInt(sellerCountM[1], 10) : null,
    size: sizeRaw, weight: grab('重量'), packSize: grab('包装尺寸'), packWeight: grab('包装重量'),
    fbaFee: fbaFee ? fbaFee.replace(/(color|colour|size)：.*/i, '').trim() : null,
    productType: grab('商品类型'),
    listedAt: grab('上架'),
    color: color ? color.replace(/\s+/g, ' ').trim() : null,
    variantSize,
    sales30d: salesRaw ? (salesRaw.match(/^<*\s*[\d.,]+/) ? salesRaw.match(/^<*\s*[\d.,]+/)[0] : null) : null,
    bsr: ranks,
    /* ★ 2026-10-02 卖家国家(国旗图标) —— 这个解析器只拿到文本, 国旗是 DOM 里的 <img>,
     * 所以必须由调用方把 readSellerFlag() 的结果当第 4 个参数传进来。
     * 三态: true=大中华区 / false=明确非中国 / null=没读到(不能当成"非中国")。 */
    sellerCountryCode: (flagInfo && flagInfo.code) ? String(flagInfo.code).toUpperCase() : null,
    sellerFlagCode: (flagInfo && flagInfo.flagCode) ? String(flagInfo.flagCode).toUpperCase() : null,
    chinaSeller: (flagInfo && flagInfo.code) ? linksCollector.isChinaRegionCode(flagInfo.code) : null,
  };
}

// 详情页品牌跳转采集: 商品详情页 → 品牌链接(field-keywords) → 品牌全部商品 (全程 CDP)
async function cdpDpBrand(url, maxPages = 5) {
  const tabs = await cdpGetTabs();
  const page = tabs.find((t) => t.type === 'page');
  if (!page) throw new Error('Edge 无可用页面标签, 请确认 Edge 以 --remote-debugging-port=9222 启动');
  const { send } = await cdpConnect(page.webSocketDebuggerUrl);
  const siteMatch = url.match(/amazon\.(com\.au|co\.uk|com|com\.mx|com\.br|de|fr|it|es|co\.jp|ca|in|nl|se|pl)/);
  const site = siteMatch && CDP_SITE_CODE[siteMatch[1]] ? CDP_SITE_CODE[siteMatch[1]] : 'uk';
  const host = 'www.amazon.' + siteToHostSuffix(site);

  // 1. 详情页提取品牌链接
  await send('Page.navigate', { url });
  await new Promise((r) => setTimeout(r, 10000));
  const r1 = await send('Runtime.evaluate', {
    expression: `(() => {
      let brandLink = null, brandName = null;
      document.querySelectorAll('#bylineInfo a, #bylineInfo_feature_div a, a[href*="field-keywords"]').forEach(a => {
        const h = a.getAttribute('href') || '';
        const t = (a.textContent || '').trim().replace(/\\s+/g, ' ');
        if (h.includes('field-keywords') && t && !brandLink) {
          brandLink = h;
          const m = t.match(/Brand:?\s*(.+)/i);
          brandName = m ? m[1].trim() : t;
        }
      });
      return JSON.stringify({ brandLink, brandName });
    })()`, returnByValue: true,
  });
  const br = JSON.parse(r1.result.value);
  if (!br.brandLink) throw new Error('详情页未找到品牌链接 (Brand: XXX → field-keywords)');
  const listUrl = br.brandLink.startsWith('http') ? br.brandLink : `https://${host}` + br.brandLink;

  // 2. 品牌搜索页翻页采集
  const products = [];
  const seen = new Set();
  for (let pg = 1; pg <= maxPages; pg++) {
    if (collectStopRequested()) break;
    const pgUrl = pg === 1 ? listUrl : listUrl.includes('page=') ? listUrl.replace(/page=\d+/, 'page=' + pg) : listUrl + (listUrl.includes('?') ? '&' : '?') + 'page=' + pg;
    await send('Page.navigate', { url: pgUrl });
    await new Promise((r) => setTimeout(r, 8000));
    for (let i = 0; i < 4; i++) { await send('Runtime.evaluate', { expression: `window.scrollTo(0, ${(i + 1) * 4000})` }); await new Promise((r) => setTimeout(r, 900)); }
    await new Promise((r) => setTimeout(r, 1200));
    const r2 = await send('Runtime.evaluate', {
      expression: `(() => {
        const out = [];
        document.querySelectorAll('div[data-asin]').forEach(el => {
          const asin = el.getAttribute('data-asin');
          if (!asin || !/^[A-Z0-9]{10}$/.test(asin) || !el.querySelector('a[href*="/dp/"]')) return;
          const t = el.querySelector('h2 span, h2');
          const pr = el.querySelector('.a-price .a-offscreen');
          const lk = el.querySelector('a[href*="/dp/"]');
          out.push({ asin, title: t ? t.textContent.trim().slice(0, 150) : '', price: pr ? pr.textContent.trim() : '', link: lk ? lk.href : '' });
        });
        return JSON.stringify(out);
      })()`, returnByValue: true,
    });
    let items = [];
    try { items = JSON.parse(r2.result.value); } catch {}
    const fresh = items.filter((x) => !seen.has(x.asin));
    fresh.forEach((x) => seen.add(x.asin));
    products.push(...fresh.map(applyRankFields));
    if (items.length < 16) break;
  }
  return { brandName: br.brandName, brandLink: listUrl, detailUrl: url, site, products };
}

// 解析商品上架日期 (firstAvailable: "2023年5月12日" / "2023-05-12" / "12 May 2023" / "May 12, 2023" 等)
function parseFirstAvailable(s) {
  if (!s) return null;
  const str = String(s);
  const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  // 中文/数字格式: 2023年5月12日 / 2023-05-12 / 2023/5/12
  const m1 = str.match(/(\d{4})[年\-/.](\d{1,2})(?:[月\-/.](\d{1,2}))?/);
  if (m1) {
    const d = new Date(+m1[1], (+m1[2] || 1) - 1, m1[3] ? +m1[3] : 1);
    if (!isNaN(d.getTime())) return d;
  }
  // 英文格式: 12 May 2023 / 12 May, 2023 / 21 Mar. 2025 / 18 Mar. 20 (缩写带点、两位年份都要认)
  const m2 = str.match(/(\d{1,2})\s+([A-Za-z]{3,9})\.?[,]?\s+(\d{2,4})/);
  if (m2) {
    const mn = months[String(m2[2]).toLowerCase().slice(0, 3)];
    if (mn != null) {
      const y = +m2[3] < 100 ? 2000 + +m2[3] : +m2[3];
      const d = new Date(y, mn, +m2[1]);
      if (!isNaN(d.getTime())) return d;
    }
  }
  // 英文格式: May 12, 2023 / May. 12, 23
  const m3 = str.match(/([A-Za-z]{3,9})\.?[,]?\s+(\d{1,2})[,]?\s+(\d{2,4})/);
  if (m3) {
    const mn = months[String(m3[1]).toLowerCase().slice(0, 3)];
    if (mn != null) {
      const y3 = +m3[3] < 100 ? 2000 + +m3[3] : +m3[3];
      const d = new Date(y3, mn, +m3[2]);
      if (!isNaN(d.getTime())) return d;
    }
  }
  return null;
}

// 商品是否命中指定页面标识 (A+/AC/BestSeller/NewRelease/Deal/...) — 纯函数可测试
// 支持: 标准 key (aplus/choice/...) 及中英文别名 (A+/AC/新品/畅销/限时优惠/亚马逊精选...)
function itemMatchesBadge(item, badge) {
  const std = {
    aplus: () => !!item.aplus,
    choice: () => item.badge === 'choice',
    bestseller: () => item.badge === 'bestseller',
    bestseller1: () => item.badge === 'bestseller1' || item.badge === '#1bestseller',
    deal: () => item.badge === 'deal',
    dealday: () => item.badge === 'dealday' || item.badge === 'deal-of-the-day',
    newrelease: () => item.badge === 'newrelease' || item.badge === 'new-release',
    overallpick: () => item.badge === 'overallpick' || item.badge === 'overall-pick',
    editorspick: () => item.badge === 'editorspick' || item.badge === "editor's-pick",
    toprated: () => item.badge === 'toprated' || item.badge === 'top-rated',
    climate: () => item.badge === 'climate' || item.badge === 'climate-pledge-friendly',
    smallbusiness: () => item.badge === 'smallbusiness' || item.badge === 'small-business',
  };
  const key = String(badge || '').toLowerCase().trim();
  if (std[key]) return std[key]();
  // 中英文别名匹配 (用户手写: A+/AC/畅销/新品/限时优惠/今日特惠/亚马逊精选...)
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5#]/g, '');
  const b = norm(badge);
  const hits = [
    ['aplus', ['a+', 'aplus', 'a+内容', 'a+页面', 'enhancedbrandcontent', '增强内容'], () => !!item.aplus],
    ['choice', ['ac', 'amazonschoice', '亚马逊精选', '亚马逊之选'], () => item.badge === 'choice'],
    ['bestseller', ['bestseller', 'best seller', '畅销', '热卖', '热销'], () => item.badge === 'bestseller' || item.badge === 'bestseller1'],
    ['bestseller1', ['#1bestseller', 'no1bestseller', '第一名', '榜首', '类目第一'], () => item.badge === 'bestseller1' || item.badge === '#1bestseller'],
    ['newrelease', ['newrelease', 'new release', '新品', '新发布'], () => item.badge === 'newrelease' || item.badge === 'new-release'],
    ['deal', ['limitedtimedeal', '限时优惠', '限时', '优惠'], () => item.badge === 'deal'],
    ['dealday', ['dealoftheday', '今日特惠', '今日优惠'], () => item.badge === 'dealday' || item.badge === 'deal-of-the-day'],
    ['overallpick', ['overallpick', '综合首选'], () => item.badge === 'overallpick' || item.badge === 'overall-pick'],
    ['editorspick', ['editorspick', 'editor\'spick', '编辑精选'], () => item.badge === 'editorspick' || item.badge === "editor's-pick"],
    ['toprated', ['toprated', 'toprated', '最高评分', '高分'], () => item.badge === 'toprated' || item.badge === 'top-rated'],
    ['climate', ['climatepledgefriendly', '气候友好', '环保'], () => item.badge === 'climate' || item.badge === 'climate-pledge-friendly'],
    ['smallbusiness', ['smallbusiness', '小企业', '中小企业'], () => item.badge === 'smallbusiness' || item.badge === 'small-business'],
  ];
  for (const [, words, test] of hits) {
    if (words.some((w) => { const wn = norm(w); return b === wn || (wn.length >= b.length && wn.includes(b)); })) return test();
  }
  return false;
}

// 类目搜索采集: 导航类目搜索页(关键词/类目) → 翻页提取商品 (全程 CDP)
// ===== 采集过滤: 与列表自定义筛选同条件, 被筛除的商品直接跳过不采集 =====
// item: 采集到的商品 (字段: price/rating/reviews/fulfill/aplus/bsr/badge/category/title/asin/site)
/* ===== 排名口径 (全局唯一) =====================================================
 * 大排名 = 该商品【所有可用排名里的最大值】 = 父类排名。
 * ★ 字段分离 (2026-09 修正): 父类排名与子类排名各自独立成字段, 绝不混用 ——
 *   rankParent/rankParentCat (父类) 与 rankChild/rankChildCat (子类)。
 *   父类来源(面板店铺选品 / 页面原生BSR≥2条的最大项)缺失时 rankParent=null, 不用子类顶替。
 * 智赢插件面板一次给两个排名, 千万别混:
 *   · 店铺选品 (宽类目, 数字大, 如 #349058 Automotive)  → 入库写进 rank / bsrShop   ← 大排名
 *   · 榜单选品 (细分类目, 数字小, 如 #1129 Car Armrests) → 入库写进 bsr / bsrCatName  ← 小排名
 * 历史坑: bsr 数组早先只装「榜单选品」(小排名), 于是各处拿 max(bsr) 当排名用 → 与界面上显示的
 * rank(大排名) 不是一个数: 商品管理排名筛选按小排名过, 采集筛选更是直接读 item.bsr (面板链路的商品
 * 根本没有 bsr 数组) → 一设排名区间就整批跳过。
 * ★ 2026-10-02 再次纠正: 排名的"唯一口径"是 rankParentOf()(父类排名), 不是 bigRankOf ——
 *   bigRankOf 会把"只有一条页面原生BSR"(按设计属子类)也算进来, 与界面卡片显示对不上。
 *   采集筛选 / 商品管理筛选 / 列表预筛 / 界面显示 / 导出 现在全部走 rankParentOf()。
 *   bigRankOf 仅保留给"排名明细汇总"这类确实需要看全部排名的场景。
 * ==========================================================================*/
function itemRankNums(item) {
  if (!item) return [];
  const out = [];
  const push = (v) => {
    const m = String(v == null ? '' : v).replace(/[^\d]/g, '');   // '#1,234' / '#1234' / 1234 都能吃
    const n = m ? Number(m) : 0;
    if (n > 0) out.push(n);
  };
  push(item.rank);        // 已算好的大排名
  push(item.maxRank);     // 兼容字段
  push(item.bsrShop);     // 店铺选品(大)
  push(item.bsrCat);      // 榜单选品(小)
  if (Array.isArray(item.bsr)) for (const b of item.bsr) push(b && b.rank);
  return out;
}
/**
 * ★ 2026-09-25 大排名三态 (未上榜 / 未采到 / 有) —— 库里存 rankParentState, 这里兼容旧数据:
 *   · 有 rankParentState 字段 → 直接用它
 *   · 没有字段(旧数据): 有 rankParent → 'ok'; 否则 → 'unknown'(未采集到, 不是未上榜)
 * 铁律: 旧数据绝不当成"未上榜" —— 那会把"没采到"误报成"确实没上榜单"。
 */
function rankParentStateOf(item) {
  if (!item) return 'unknown';
  const st = item.rankParentState;
  if (st === 'ok' || st === 'not_listed' || st === 'unknown') return st;
  return item.rankParent != null ? 'ok' : 'unknown';
}
/** 大排名: 取不到任何排名 → null (null 的语义由各筛选自己决定: 严格筛掉 / 保留待确认) */
function bigRankOf(item) {
  const a = itemRankNums(item);
  return a.length ? Math.max.apply(null, a) : null;
}
/* ===== 卖家国家(中国卖家)三态归一 ==================================================
 * 背景(2026-10-02 用户实测): 全库 9526 条 chinaSeller 100% 是 false —— 因为 11 个入库
 *   路径里都写死了 `chinaSeller: false`(见各处注释), 界面上「中国卖家」自然一条都筛不出来。
 *   真实数据来源有且只有一个: 插件面板【卖家】行上的国旗图标
 *   (links-collector.readSellerFlag → item.chinaSeller / sellerCountryCode)。
 * 三态(必须保住, 别把"没读到"当成"非中国"):
 *   true  = 读到了国旗且是大中华区(CN/HK/TW/MO, 与插件国旗分组一致)
 *   false = 读到了国旗但不是大中华区
 *   null  = 没读到(插件未登录 / 面板没渲染完 / 该链路不读面板) → 未知
 * 想细分港澳台 vs 大陆: 看 sellerCountryCode(CN / HK / TW / MO)。
 * ================================================================================= */
function chinaSellerOf(src) {
  if (!src) return null;
  if (src.chinaSeller === true || src.chinaSeller === false) return src.chinaSeller;
  return null;
}
function sellerCountryCodeOf(src) {
  if (!src) return null;
  return src.sellerCountryCode || null;
}

/* ===== ★ 2026-10-02 金额文本解析（站点感知）==========================================
 * 为什么必须单独立这个函数(实测代价):
 *   全库德国站 7196 条有效价格里, 末两位是 99/00 的占 22.8%(uk 只有 3.8%), 中位数 4460 ——
 *   因为解析用的是 `String(price).replace(/[^0-9.]/g,'')`, 把德语的【小数点逗号】当杂质删了:
 *        "29,99 €"    → "2999"    → 2999      (真实 29.99, 虚高 100 倍)
 *        "1.234,56 €" → "1.23456" → 1.23456   (真实 1234.56, 缩水 1 万倍)
 *   连带 netProfit / aiSuggestPrice / referralFee 全错, 「价格区间」筛选也跟着错。
 * 规则(按站点决定分隔符含义, 不靠猜):
 *   · 逗号和点同时出现 → 后出现的那个是小数点 ("1.234,56" / "1,234.56" 都无歧义)
 *   · 只有逗号 → 逗号小数点站点(de/fr/it/es/nl/be/se/pl/tr/br) = 小数点; 其余(uk/us/au/ca…)= 千分位
 *   · 只有点   → 逗号小数点站点且恰 3 位小数且整数部分 1~3 位 → 千分位("1.234" = 1234); 其余 = 小数点
 * 拿不准就返回 null(未知), 不编数 —— 与全文件"读不到就 null"的口径一致。
 * ================================================================================= */
const COMMA_DECIMAL_SITES = ['de', 'fr', 'it', 'es', 'nl', 'be', 'se', 'pl', 'tr', 'br'];
function isCommaDecimalSite(site) { return COMMA_DECIMAL_SITES.indexOf(String(site || '').toLowerCase()) >= 0; }
function parseMoneyText(raw, site) {
  let t = String(raw == null ? '' : raw).replace(/[^\d.,]/g, '').replace(/[.,]+$/, '');
  if (!t || !/\d/.test(t)) return null;
  const c = t.lastIndexOf(',');
  const d = t.lastIndexOf('.');
  if (c >= 0 && d >= 0) {
    t = (c > d) ? t.replace(/\./g, '').replace(/,/g, '.')     // 1.234,56 → 1234.56
      : t.replace(/,/g, '');                                  // 1,234.56 → 1234.56
  } else if (c >= 0) {
    t = isCommaDecimalSite(site) ? t.replace(/,/g, '.')       // de: "29,99" → 29.99
      : t.replace(/,/g, '');                                  // uk: "1,234" → 1234
  } else if (d >= 0 && isCommaDecimalSite(site)) {
    const parts = t.split('.');
    if (parts.length === 2 && parts[1].length === 3 && parts[0].length >= 1 && parts[0].length <= 3) {
      t = t.replace(/\./g, '');                               // de: "1.234" → 1234 (千分位)
    }
  }
  const n = parseFloat(t);
  return isFinite(n) && n > 0 ? n : null;
}
/* ===== ★ 2026-10-02 「父类排名(大)」唯一口径 ==========================================
 * 背景(用户实测反馈): 卡片上「父类排名」显示"未采到", 但勾了「排除没有排名的商品」
 * 它却还在 —— 因为两处用了不同的字段:
 *   · 界面卡片显示的是 rankParent          (1239 条)
 *   · 筛选判的是 bigRankOf(=所有排名取最大) (2757 条) ← 多了 1518 条
 * 那 1518 条只有**一条页面原生 BSR**: 按 §排名字段分离的设计, 单条原生 BSR 归【子类】,
 * 父类位置一律 null(绝不拿子类顶替)。所以 bigRankOf 把它们当"有排名"是错的 ——
 * bigRankOf 是"所有排名里的最大值", 不等于"有父类排名"。
 *
 * 现在起:**「大排名」只有一个定义 = rankParentOf()**, 界面 / 筛选 / 导出全部用它，
 * 用户所见即所得。bigRankOf 只保留给"排名明细汇总"这类需要看所有排名的场景。
 *
 * 规则与 applyRankFields() 完全一致(必须一致, 否则又会分叉):
 *   ① 面板「店铺选品」 bsrShop      → 父类(权威)
 *   ② 页面原生 BSR 有 >=2 条时取最大 → 父类(宽类目在前)
 * 已入库的商品直接读字段; 还没入库的原始卡片(采集筛选场景)按同一规则现算。
 * ★ 不再有"历史大排名(legacy rank)兜底": legacy rank 是旧代码写的 max(bsr), 本身混了子类排名,
 *   拿它当父类就是脏数据成因(详见 applyRankFields 里的说明)。
 * ============================================================================== */
function rankParentOf(item) {
  if (!item) return null;
  // 已入库: 字段是权威(applyRankFields 写的), 有键就用键(哪怕是 null —— 表示确实没有)
  if (Object.prototype.hasOwnProperty.call(item, 'rankParent')) {
    return item.rankParent == null ? null : Number(item.rankParent);
  }
  // 原始卡片(采集筛选): 现算(与 applyRankFields 同一规则)
  const e = itemRankEntries(item);
  const pickMax = (arr) => (arr.length ? arr.reduce((a, b) => (b.rank > a.rank ? b : a)) : null);
  const par = e.filter((x) => x.src === 'bsrShop');
  const bar = e.filter((x) => x.src === 'bsr');
  let P = pickMax(par);
  if (!P && bar.length >= 2) P = pickMax(bar);
  return P ? P.rank : null;
}
/* ===== 排名字段分离: 父类排名 / 子类排名 (两个字段严格分开, 绝不互相顶替) ==============
 * 口径 (唯一): 排名数值【最大】的是父类排名(宽类目), 数值【最小】的是子类排名(细分类目)。
 * 来源归属 (插件面板一次给两个排名, 千万别混):
 *   · bsrShop = 插件「店铺选品」 → 父类 / 宽类目 (数字大, 如 #349058 Automotive)
 *   · bsrCat  = 插件「榜单选品」 → 子类 / 细分   (数字小, 如 #1129 Car Armrests)
 *   · bsr[]   = Amazon 商品页【原生】BSR → 细分 / 子类目 (页面自身 BSR 多为细分排名)
 * 产出字段 (互相独立, 都有则都填):
 *   rankParent / rankParentCat / rankParentSrc    父类排名
 *   rankChild  / rankChildCat  / rankChildSrc     子类排名
 * 铁律: 父类来源缺失时 rankParent 一律 null —— 绝不拿子类数值顶替父类 (这正是此前的脏数据成因)。
 * 兼容: rank(仍=父类排名) / maxRank / bsrShop / bsrCat / bsr 数组 全部保留不改。
 * ================================================================================== */
function itemRankEntries(item) {
  if (!item) return [];
  const out = [];
  const num = (v) => { const m = String(v == null ? '' : v).replace(/[^\d]/g, ''); const n = m ? Number(m) : 0; return n > 0 ? n : null; };
  const add = (v, cat, src) => { const n = num(v); if (n) out.push({ rank: n, category: cat || null, src }); };
  add(item.rank, item.rankCategory, 'rank');           // 历史字段: 已算好的大排名(=父类口径)
  add(item.maxRank, item.maxRankCategory, 'maxRank');  // 兼容字段
  add(item.bsrShop, item.bsrShopCat, 'bsrShop');       // 面板「店铺选品」= 父类来源 (权威)
  add(item.bsrCat, item.bsrCatName, 'bsrCat');         // 面板「榜单选品」= 子类来源
  if (Array.isArray(item.bsr)) for (const b of item.bsr) add(b && b.rank, b && (b.category || b.name), 'bsr');
  return out;
}
/* ⚠️ 2026-10-02 弃用警告: parentRankOf / childRankOf 是"所有排名取最大/最小"的旧口径, * 它们把【子类排名】(单条页面原生BSR、榜单选品)也算进父类 —— 正是"卡片显示未采到、
 * 筛选却认为有排名"的成因。现在没有任何地方在用它们(仅保留定义, 防止外部误用)。
 * 要取父类排名请一律用 rankParentOf(); 要"看所有排名汇总"用 bigRankOf()。 */
/** 父类排名 = 所有排名里的最大值 (取不到 → null) —— ⚠️ 已弃用, 见上方警告 */
function parentRankOf(item) {
  const a = itemRankEntries(item).map((x) => x.rank);
  return a.length ? Math.max.apply(null, a) : null;
}
/** 子类排名 = 所有排名里的最小值 (取不到 → null) —— ⚠️ 已弃用, 见上方警告 */
function childRankOf(item) {
  const a = itemRankEntries(item).map((x) => x.rank);
  return a.length ? Math.min.apply(null, a) : null;
}
/**
 * ★ 2026-09-24 数据清洗收口 (幂等): 所有入库路径共用, 一处生效。
 *
 * 为什么必须收口: 实测全库(9.1万条)存在以下脏值, 每一条规则此前都散落在各采集链路里,
 * 修一条链路别的链路还漏 —— 所以统一放到 applyRankFields 这个 22 个入库入口的公共收口点。
 *   · brand 混入商标文案      9,125 条 (如 "Xylarnoveth 1个已注册")
 *   · brand 是占位词            617 条 (如 "QINSHU 正在加载" / "登录")
 *   · followCount 溢出           65 条 (如 5230850000458488 = 多个数字被拼在一起)
 *   · bsrCat 键缺失          91,288 条 (该为 null 却没这个键, 前端读 undefined)
 *   · url 为空                1,585 条 (导出链接/多链接采集都靠它)
 *   · bsr 元素非法            2,312 条 (rank 非正数 / 缺 category)
 *   · 大排名有值但类目名缺失    1,030 条 (无法判断宽类目/细分)
 * 铁律: 只做"清洗与归一", 绝不编造数据 —— 拿不到就置 null。
 */
function sanitizeProductFields(item) {
  if (!item || typeof item !== 'object') return item;
  // ① brand: 剥离商标文案 / 占位词 / "Brand:" 前缀 (占位词一律置 null, 不留假值)
  if (typeof item.brand === 'string') {
    let b = item.brand.replace(/\s+/g, ' ').trim();
    b = b.replace(/^Brand:\s*/i, '');
    // ★ 实测真实脏值形态: "HANBAOLIMIN 正在加载 ..." / "Tikhell 1个已注册 color ： blanc 上架 ： 2023-10"
    //   —— 真品牌名在前半段, 后面是别的字段(商标/颜色/上架日期)漏进了 brand。
    //   做法: 在【第一个污染标记】处截断, 保留前半段真品牌名; 截不出东西才置 null。
    const CUT = /(正在加载|加载中|正在分析|正在刷新|请登录|未登录|登录|\d+\s*个\s*已注册|已注册|注册商标|申请中|未查到|上架\s*[:：]|color\s*[:：]|size\s*[:：]|变体\s*[:：]|卖家\s*[:：]|品牌\s*[:：]|商品类型\s*[:：]|近30天销量|店铺选品|榜单选品)/i;
    const cut = b.search(CUT);
    if (cut >= 0) b = b.slice(0, cut);
    b = b.replace(/[\s.·。‧・…\-—|,，;；:：]+$/, '');   // 去掉截断后残留的尾巴符号
    if (/^(unknown|n\/a|无|-|—)*$/i.test(b)) b = '';
    item.brand = b ? b.slice(0, 40) : null;
  }
  // ② followCount: 超范围 (溢出脏值) → null
  if (item.followCount != null) {
    const n = Number(item.followCount);
    if (!Number.isFinite(n) || n < 0 || n > 1000) item.followCount = null;
  }
  // ③ bsrCat 键缺失 → 归一为 null (前端读 undefined 会显示异常)
  if (item.bsrCat === undefined) item.bsrCat = null;
  if (item.bsrCatName === undefined) item.bsrCatName = null;
  if (item.rankParentCat === undefined) item.rankParentCat = null;
  // ④ bsr: 剔除非法项 (rank 非正数)
  if (Array.isArray(item.bsr)) {
    item.bsr = item.bsr.filter((b) => b && Number(String(b.rank).replace(/[^\d]/g, '')) > 0);
  }
  // ⑤ url 为空 → 按站点补全 (不编造商品信息, 只补商品自身的规范链接)
  if ((!item.url || !/^https?:\/\//.test(String(item.url))) && item.asin && item.site) {
    try { item.url = 'https://www.amazon.' + siteToHostSuffix(item.site) + '/dp/' + item.asin; } catch (e) { /* 站点未知则不补 */ }
  }
  // ⑥ 大排名有值但类目名缺失 → 用面板类目名回填 (同源, 不编造)
  if (item.rankParent != null && !item.rankParentCat) {
    item.rankParentCat = item.bsrShopCat || item.bsrCatName || null;
  }
  /* ⑦ ★ 2026-10-02 「上架日期」不能等于【这一条的采集日期】。
   * 实测(全库 9526 条): listedAt 与 collectedAt 同一天的有 2909 条 = 92.3%。
   *   一个采集批次里成百上千个来自几百个不同店铺的商品"恰好全都在采集当天上架"是不可能的 ——
   *   那是插件面板把"数据时间/抓取时间"当成了"上架时间"(或解析落到了别的字段)。
   * 后果(用户实测反馈): 「上架天数区间」筛 1~3650 天只出来 2 条 —— 真正可靠的上架日期来源是
   *   firstAvailable(详情页 Date First Available, 全库仅 3 条); 而 listedAt 这个被污染的字段
   *   又被上架天数筛选忽略, 于是两边都不可用。
   * 处置: 与既有口径一致(本文件多处写着"读不到上架日期 → null (不写今天)") —— 等于采集当天的置 null,
   *   宁可"未知", 不留假值。真实日期(明显早于采集日的, 如 "8 Sep 2023")照常保留。
   * ⚠️ 必须跟 item.collectedAt 比, 不能跟"今天"比 —— 采集是几周前做的, 拿今天比一条都抓不到(踩过这个坑)。
   * 注意: 只清 listedAt, 不动 firstAvailable; 上架天数筛选优先用 firstAvailable, 其次退回 listedAt。 */
  if (item.listedAt) {
    const d = parseFirstAvailable(String(item.listedAt));
    const c = parseFirstAvailable(String(item.collectedAt || ''));
    const base = c || new Date();                     // 没有采集时间就退回"今天"
    if (d && d.getFullYear() === base.getFullYear() && d.getMonth() === base.getMonth() && d.getDate() === base.getDate()) {
      item.listedAt = null; listedAtSameAsCollectDropped++;
    }
  }
  return item;
}

/** 统计: 被判定为"面板把采集当天当上架日期"而丢弃的条数 (排查用, 不参与业务) */
let listedAtSameAsCollectDropped = 0;

/**
 * 上架日期(取最可靠的那个) —— 「上架天数区间」筛选用。
 * 来源优先级:
 *   ① firstAvailable = 商品详情页的 "Date First Available" ← 唯一权威来源
 *   ② listedAt       = 插件面板的「上架」(已被 sanitizeProductFields 剔掉"等于今天"的假值)
 * 两个都没有 → null(严格模式: 不满足, 会被筛掉; 这是"没采到"不是"不符合")。
 */
function listedDateOf(item) {
  if (!item) return null;
  const a = parseFirstAvailable(item.firstAvailable);
  if (a) return a;
  return parseFirstAvailable(item.listedAt);
}

/** 统一写入父类/子类排名字段 (所有入库入口调用; 幂等, 可重复执行) */
function applyRankFields(item) {
  if (!item || typeof item !== 'object') return item;
  const e = itemRankEntries(item);
  const pickMax = (arr) => (arr.length ? arr.reduce((a, b) => (b.rank > a.rank ? b : a)) : null);
  const pickMin = (arr) => (arr.length ? arr.reduce((a, b) => (b.rank < a.rank ? b : a)) : null);
  const par = e.filter((x) => x.src === 'bsrShop');                        // 面板店铺选品 = 父类(权威)
  const chi = e.filter((x) => x.src === 'bsrCat');                         // 面板榜单选品 = 子类
  const bar = e.filter((x) => x.src === 'bsr');                            // 页面原生 BSR
  /* ★ 2026-10-02 去掉"历史大排名(rank/maxRank)兜底"这条父类来源。
   * 为什么必须去掉(实测): 旧代码写 rank 时用的是 `max(bsr)` —— 而 bsr 数组里装的是
   *   【榜单选品/小排名】(见本文件上方"历史坑"注释)。所以 legacy rank 本身就混了子类排名,
   *   拿它当父类排名正是这批脏数据的成因 —— 也正是文件里那条铁律禁止的事:
   *   "父类来源缺失时 rankParent 一律 null, 绝不拿子类数值顶替父类"。
   * 代价(要如实告知): 全库约 1518 条"只有一条页面原生BSR/只有 legacy rank"的商品,
   *   父类排名会变成"未采到" —— 但它们的【子类排名】照常保留(那才是它们真正的排名),
   *   而且界面卡片与筛选从此完全一致(所见即所得)。需要父类排名就补采。
   * 唯一合法的父类来源(两条): ① 面板「店铺选品」bsrShop ② 页面原生 BSR 有 >=2 条时取最大。 */
  let P = pickMax(par);
  if (!P && bar.length >= 2) P = pickMax(bar);
  // 子类: 面板榜单选品 + 页面原生 BSR 中【不等于父类值】的那些里取最小
  const childPool = chi.concat(bar).filter((x) => !(P && x.rank === P.rank));
  let C = pickMin(childPool);
  if (!C && P && bar.length === 1 && bar[0].rank !== P.rank) C = bar[0];    // 单条 BSR 且不等于父类 → 就是子类
  if (P && C && P.rank < C.rank) { const t = P; P = C; C = t; }             // 交叉校验: 父类必须 >= 子类
  item.rankParent = P ? P.rank : null;
  item.rankParentCat = P ? P.category : null;
  item.rankParentSrc = P ? P.src : null;
  item.rankChild = C ? C.rank : null;
  item.rankChildCat = C ? C.category : null;
  item.rankChildSrc = C ? C.src : null;
  /* ★ 2026-10-02 同步历史字段 rank (= 大排名): 必须与权威字段 rankParent 一致。
   * 为什么必须同步(实测代价): 父/子排名分离之前, 旧代码把"所有排名取最大"写进了 rank,
   *   分离之后 rankParent 只认父类来源 → 两者的差是 1518 条(只有一条页面原生BSR的商品,
   *   按设计归子类)。rank 不同步就会留下矛盾:
   *     · 导出列「大排名」取的是 rank  → 导出看着有排名、界面卡片却显示"未采到"
   *     · itemRankEntries() 会把 rank 当成一条排名参与 max 计算 → 反过来污染父类判定
   *   所以在这里一次性对齐(幂等: 下次读到的 rank 已经等于 rankParent)。
   *   rank 仍是字符串形式("#191727"), 保持与历史数据的兼容。 */
  item.rank = item.rankParent == null ? null : ('#' + item.rankParent);
  item.rankMain = item.rankParent;              // 数值形态, 供导出/统计用
  item.rankMainText = item.rankParent == null ? null : ('#' + item.rankParent);
  /* ★ 2026-09-25 未上榜三态 (铁律: 只做"有/没有/没采到"的记录, 绝不编造数字)
   *   'ok'         有这一侧的排名
   *   'not_listed' 插件面板【已分析完】且确实读到了排名行, 就是没有这一侧的排名 → 未上榜
   *   'unknown'    没采到(面板没渲染/没分析完/这条链路根本不带排名) → 还要补采, 别当成未上榜
   * 归一化: 采到了 → ok; 采集端说未上榜 → 保留; 其它一律 unknown。
   * (旧数据没有这两个字段 → 置 null, 不冒充"未上榜") */
  item.rankParentState = P ? 'ok'
    : (item.rankParentState === 'not_listed' ? 'not_listed'
      : (item.rankParentState === 'ok' ? 'unknown' : (item.rankParentState || null)));
  item.rankChildState = C ? 'ok'
    : (item.rankChildState === 'not_listed' ? 'not_listed'
      : (item.rankChildState === 'ok' ? 'unknown' : (item.rankChildState || null)));
  // 排名行明细只留审计需要的字段(rank/category/root), 别把整段 DOM 信息塞进库
  if (Array.isArray(item.rankRows)) {
    item.rankRows = item.rankRows.slice(0, 4).map((r) => ({
      rank: r && r.rank != null ? Number(r.rank) : null,
      category: (r && r.category) ? String(r.category).slice(0, 40) : null,
      root: !!(r && r.root),
    })).filter((r) => r.rank);
    if (!item.rankRows.length) delete item.rankRows;
  } else if (item.rankRows !== undefined) delete item.rankRows;
  // ★ 2026-09 新增: 大类目兜底 (见下方 fillCatFromPanel 注释)。放在这里是因为 applyRankFields 是
  //   全库入库路径的统一收口(22 个调用点), 一处生效即覆盖 店铺页/多链接/品牌/跟卖/整站/类目 所有采集。
  sanitizeProductFields(item);  // ★ 2026-09-24 脏值清洗收口 (品牌/跟卖数/url/bsr/排名类目)
  fillCatFromPanel(item);
  computeVariantKey(item);      // ★ 2026-09: 变体族键 —— 与类目兜底同一个收口点, 22 个入库路径一处生效
  return item;
}

/**
 * 用插件面板的类目名兜底填 cat1(大类目)/cat2(二级类目)。
 *
 * 背景: cat1 原本只有"详情页面包屑"一个来源(catSrc='bc'), 但店铺页/多链接/品牌这条主采集链路
 *      只读卡片 + 卡片插件面板, 从不读面包屑 → 实测全库 81333 条里只有 34 条有类目, 大类目筛选等于不可用。
 *      而卡片插件面板本来就带类目名, 只是没被当类目用: 店铺选品→bsrShopCat(宽类目)、榜单选品→bsrCatName(细类目)。
 *      所以就地兜底 → 不跳详情页也能有大类目, 零额外耗时(面板数据本来就已采到)。
 *
 * 规则: ① 已有 cat1(面包屑更权威) 一律不覆盖; ② 只在有面板类目名时才写;
 *      ③ 标记 catSrc='panel' 便于日后区分"面板兜底"与"面包屑提取"。
 */
function fillCatFromPanel(item) {
  if (!item || typeof item !== 'object') return item;
  if (item.cat1 && String(item.cat1).trim()) return item;
  const shop = item.bsrShopCat && String(item.bsrShopCat).trim();
  const cat = item.bsrCatName && String(item.bsrCatName).trim();
  const bsrCat = Array.isArray(item.bsr) ? (item.bsr.find((b) => b && b.category && String(b.category).trim()) || null) : null;
  const broad = shop || (bsrCat ? String(bsrCat.category).trim() : null) || null;
  if (!broad) return item;
  const narrow = (cat && cat !== broad) ? cat : null;
  item.cat1 = broad;
  if (narrow && !item.cat2) item.cat2 = narrow;
  item.catSrc = 'panel';
  if (!item.catPath) item.catPath = narrow ? (broad + ' > ' + narrow) : broad;
  return item;
}

// ===== 变体族(SPU)识别 (2026-09) =====
// 背景(实测): 8.9 万条里约 41% 的商品其实是"同一商品的变体"(颜色/尺寸/数量不同, ASIN 不同),
//   在商品管理里各占一行 → 重复评估、重复补采、族级销量/跟卖看不出来。
//   而插件面板的"变体：N个"与详情页 twister 都能给出变体信息, 只是从未被用于归类。
// 三级置信度(不混用, 界面按此打标):
//   twister = 详情页 #twister_feature_div 给的真变体关系(含父 ASIN) —— 权威
//   card    = 列表页卡片面板给了"变体：N个"(N>0) —— 强(不跳详情也能拿到)
//   title   = 品牌 + 标题主干(去颜色/尺寸/数量/数字) 推测 —— 启发式, 界面标"推测"
// 低质行过滤: 标题=品牌、过短、无正常单词的行不参与聚类(实测这类行会形成 100+ 成员的假族)。
const VARIANT_WORDS = new Set(('black white red blue green pink grey gray silver gold brown purple orange yellow beige clear ' +
  'large small medium xl xxl xxxl xs s m l left right front rear top bottom inner outer upper lower ' +
  'pack pcs pc set sets cm mm inch inches in ml l g kg oz lb ' +
  'color colour size style type model number_of_items count ' +
  'a b c d e f 1 2 3 4 5 6 7 8 9 10 11 12 15 16 20 24 25 30 40 50 60 100 120 200 500').split(/\s+/));

/** 标题主干: 去掉颜色/尺寸/数量/纯数字等"变体维度词", 取前 7 个词做族键 */
function titleCoreOf(title) {
  return String(title || '').toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !VARIANT_WORDS.has(w) && !/^\d+$/.test(w))
    .slice(0, 7)
    .join(' ');
}

/** 低质行判定: 这类行的标题不足以支撑聚类 */
function titleLooksSuspect(item) {
  const t = String(item.title || '').trim();
  const b = String(item.brand || '').trim();
  if (t.length < 10) return true;                                   // 过短
  if (b && t.toLowerCase() === b.toLowerCase()) return true;        // 标题=品牌(解析失败行)
  if (!/[a-z]{3}/i.test(t)) return true;                            // 没有正常单词
  return false;
}

/** 该条目自己声明的变体数量(面板"变体：N个" / twister 选项数 / variations) */
function ownVariantCount(item) {
  const v = item && item.variants;
  if (typeof v === 'string') { const m = v.match(/(\d+)/); return m ? Number(m[1]) : 0; }
  if (typeof v === 'number') return v;
  if (Array.isArray(v)) return v.reduce((n, g) => n + ((g && g.options) ? g.options.length : 0), 0);
  const n = Number(item && item.variations);
  return n > 0 ? n : 0;
}

/**
 * 算出条目所属的变体族键 + 置信度 + 族内对比用的属性。
 * 只依赖条目自身字段(可随每次入库即时计算); 族代表/族大小需要全库视角, 由 rebuild-variant-groups 统一写。
 */
function computeVariantKey(item) {
  if (!item || typeof item !== 'object' || !item.asin) return item;
  // 族内对比属性(有则带上, 用于展开对比表显示颜色/尺寸)
  const attrs = {};
  if (item.color) attrs.color = String(item.color).slice(0, 40);
  if (item.variantSize) attrs.size = String(item.variantSize).slice(0, 40);
  item.variantAttrs = Object.keys(attrs).length ? attrs : null;
  item.ownVariants = ownVariantCount(item);
  // ★ 手工覆盖优先(2026-09): 人工判断高于任何自动识别 —— 拆族=variantSolo, 并族=variantManualKey。
  //   存在商品字段上, 随 products.json 一起持久化/备份; rebuild 只重算键, 不会冲掉人工结论。
  if (item.variantSolo === true) { item.variantKey = null; item.variantSrc = 'manual'; return item; }
  if (item.variantManualKey) { item.variantKey = String(item.variantManualKey); item.variantSrc = 'manual'; return item; }
  // 低质行 → 不聚类
  if (titleLooksSuspect(item)) { item.variantKey = null; item.variantSrc = 'none'; return item; }
  // 权威: twister 给的父 ASIN
  if (item.parentAsin && String(item.parentAsin).trim() && item.variantSrc === 'twister') {
    item.variantKey = String(item.parentAsin).trim(); return item;
  }
  const site = String(item.site || '').toLowerCase();
  const brand = String(item.brand || '').toLowerCase().trim();
  const core = titleCoreOf(item.title);
  if (!core) { item.variantKey = null; item.variantSrc = 'none'; return item; }
  item.variantKey = 'c:' + site + '|' + brand + '|' + core;
  item.variantSrc = item.ownVariants > 0 ? 'card' : 'title';
  return item;
}

// ===== 类目名 → 中文大类 归并 (2026-09) =====
// 为什么需要: 插件面板给的类目名按【站点语言】本地化, 而且面板的"榜单选品"给的是细类目 ——
//   实测库内 cat1 有 2679 个不同取值 (Auto et Moto / Cuisine et Maison / Auto & Motorrad / Bricolage …),
//   下拉框根本没法用, 也不可能逐个人工翻译。做法: ① 显式表覆盖常见大类(多语言) ② 关键词兜底归并细类目
//   ③ 归不进的一律「其他类目」。归并只影响【显示与筛选菜单】, 不改数据库里的原始 cat1。
const CAT_CN_MAP = (function () {
  const groups = {
    '汽车用品': ['automotive', 'auto et moto', 'auto & motorrad', 'auto e moto', 'coche y moto', 'automotive parts', 'car & vehicle electronics', 'automotive tools & equipment', 'fahrzeug', 'automobile', 'motors'],
    '家居厨房': ['home & kitchen', 'home', 'cuisine et maison', 'küche, haushalt & wohnen', 'küche haushalt & wohnen', 'casa y cocina', 'casa e cucina', 'kitchen & dining', 'furniture', 'home décor', 'home decor', 'bedding', 'haus & garten', 'maison', 'möbel'],
    '电子产品': ['electronics', 'high-tech', 'elektronik', 'électronique', 'electrónica', 'elettronica', 'tv & audio', 'camera & photo', 'headphones'],
    '电脑办公': ['computers', 'informatique', 'computer & zubehör', 'informática', 'computers & accessories', 'office products', 'office supplies', 'stationery & office supplies', 'bürobedarf', 'papeterie'],
    '工具五金': ['diy & tools', 'bricolage', 'baumarkt', 'tools', 'tools & home improvement', 'home improvement', 'hand & power tools', 'hardware', 'outillage', 'werkzeug'],
    '花园户外': ['garden', 'jardin', 'garten', 'jardín', 'giardino', 'garden & outdoors', 'gardening', 'garden tools'],
    '运动户外': ['sports & outdoors', 'sports et loisirs', 'sport & freizeit', 'deportes y aire libre', 'sport e tempo libero', 'sports', 'fitness & outdoors', 'cycling', 'camping & hiking', 'sports, fitness & outdoors'],
    '玩具游戏': ['toys & games', 'jeux et jouets', 'spielzeug & spiele', 'juguetes y juegos', 'giochi e giocattoli', 'toys'],
    '美妆个护': ['beauty', 'beauté', 'beauty & personal care', 'drogerie & körperpflege', 'belleza', 'bellezza e cura della persona', 'make-up', 'cosmetics'],
    '服装鞋包': ['fashion', 'mode', 'kleidung, schuhe & schmuck', 'moda', 'clothing, shoes & accessories', 'clothing', 'shoes & bags', 'watchbands', "men's watchbands", "women's watchbands", 'jewelry'],
    '宠物用品': ['pet supplies', 'animalerie', 'haustier', 'mascotas', 'animali domestici', 'pet food'],
    '健康护理': ['health & personal care', 'health, household & personal care', 'hygiène et santé', 'salud y cuidado personal', 'cura della persona', 'personal care', 'medical supplies'],
    '工业科研': ['industrial & scientific', 'commerce, industrie et science', 'gewerbe, industrie & wissenschaft', 'business, industry & science', 'industria y ciencia', 'industria e scienza'],
    '照明': ['lighting', 'luminaires et éclairage', 'beleuchtung', 'iluminación', 'illuminazione', 'lamps', 'light bulbs'],
    '家电配件': ['appliance parts & accessories', 'vacuum replacement parts', 'small appliances', 'large appliances', 'haushaltsgeräte', 'electrodomésticos'],
    '母婴': ['baby', 'bébé', 'babyprodukte', 'bebé productos', 'baby & toddler toys'],
    '食品': ['grocery', 'épicerie', 'lebensmittel', 'alimentación', 'alimenti', 'gourmet'],
  };
  const m = new Map();
  Object.keys(groups).forEach(function (cn) { groups[cn].forEach(function (v) { m.set(v, cn); }); });
  return m;
})();

/** 把任意(多语言)类目名归并成中文大类。归并只用于显示与筛选, 不改原始字段。 */
const CAT_CN_CACHE = new Map();   // catCnOf 是纯函数; 但商品库逐条判定(9 万条)时正则开销可观 → 按原始名缓存
function catCnOf(name) {
  const raw = String(name == null ? '' : name).trim();
  const memo = CAT_CN_CACHE.get(raw);
  if (memo !== undefined) return memo;
  const out = catCnOfRaw(raw);
  CAT_CN_CACHE.set(raw, out);
  return out;
}
/** catCnOf 的实际实现 (入参已 trim; 只由上面的缓存包装调用) */
function catCnOfRaw(raw) {
  if (!raw) return '其他类目';
  if (raw === '(未分类)') return '未分类';
  const hit = CAT_CN_MAP.get(raw.toLowerCase());
  if (hit) return hit;
  const t = raw.toLowerCase();
  // 关键词兜底: 面板"榜单选品"给的细类目名 (Car Boot Mats / Men's Watchbands / Mouse Pads …)
  if (/(car|auto|moto|vehicle|tyre|tire|wiper|mirror|bumper|engine|brake|pedal|grille|sunshade|mud flap|gear shift|door handle|spoiler|exhaust|dashb|tableau de bord|carburett|carburetor|turn signal|indicator|window ?& ?door seal|foot ?rest|helmet visor|antitheft|locking device|seat cover|harness|gps|motorcycle)/.test(t)) return '汽车用品';
  if (/(vacuum|appliance|kitchen|haushalt|cuisine|home|möbel|furniture|cookware|dining|housse|\bmat\b|\bcovers?\b|electrom|électrom|großgerät|replacement blades)/.test(t)) return '家居厨房';
  if (/(watchband|clothing|shoe|fashion|mode|jewel|apparel|\bbag\b|bracelet)/.test(t)) return '服装鞋包';
  if (/(computer|informatique|software|printer|mouse|keyboard|laptop|tablet|monitor)/.test(t)) return '电脑办公';
  if (/(garden|jardin|garten|plant|lawn|patio|seeds)/.test(t)) return '花园户外';
  if (/(sport|fitness|outdoor|loisirs|cycling|camp|hiking)/.test(t)) return '运动户外';
  if (/(\btoy|\bgame|jouet|spielzeug|puzzle)/.test(t)) return '玩具游戏';
  if (/(beauty|cosmetic|skin|hair|make-?up|beauté|parfum)/.test(t)) return '美妆个护';
  if (/(\bpet|animal|\bdog\b|\bcat\b|aquarium)/.test(t)) return '宠物用品';
  if (/(health|hygiène|sanit|medical|personal care|santé)/.test(t)) return '健康护理';
  if (/(industrial|scientific|business, industry|commerce, industrie|gewerbe, industrie|lab)/.test(t)) return '工业科研';
  if (/(light|lamp|luminaire|beleuchtung|illumin|led)/.test(t)) return '照明';
  if (/(electronic|elektronik|high-tech|électronique|audio|headphone|camera|charger|cable)/.test(t)) return '电子产品';
  if (/(tool|bricolage|hardware|diy|outillage|werkzeug|screw|drill)/.test(t)) return '工具五金';
  if (/(office|stationery|papeterie|büro|fourniture de bureau|mobile phone|phone basic case|fixation pour gps|adaptateur)/.test(t)) return '电脑办公';
  if (/(musique|sono|music|instrument)/.test(t)) return '电子产品';
  if (/(bébé|puericulture|puériculture|baby)/.test(t)) return '母婴';
  if (/(\bbelt|\bring\b|earring|necklace|bracelet|jewel|\bwatch|sunglass|handbag|toiletry bag|\bdress|scarf|\bglove|\bhat\b|wallet)/.test(t)) return '服装鞋包';
  if (/(shaver|trimmer|toothbrush|shampoo|perfume|\bnail|hair removal)/.test(t)) return '美妆个护';
  if (/(jeux vid|video game|console|\bdoll|lego|action figure)/.test(t)) return '玩具游戏';
  if (/(3d printing|filament|fastener|bearing|adhesive|measuring|\blab\b)/.test(t)) return '工业科研';
  if (/(place mat|tablecloth|\bspoon|cookware|utensil|napkin|\bmug\b|\bplate|\bpot\b|\bpan\b)/.test(t)) return '家居厨房';
  if (/(key shell|internal component|spare part|\bkit\b)/.test(t)) return '工具五金';
  return '其他类目';
}

/** 类目排除(categoryNot) 的统一匹配串 —— 「排除类目」chips 与后端判定必须同一口径。
 *  历史问题: 匹配串只有 catPath|category(站点本地化原名), 而前端 chips 现在给的是【中文大类目】
 *  (汽车用品/家居厨房/…, 服务端 catCnOf 归并得到) → 勾了大类目一条都排不掉。
 *  所以这里把 原始一级 / 原始二级 / 中文大类目 / 全路径 / category 全部拼进匹配串:
 *    - 原始名  → 老规则(手填关键词、保存过的规则)继续生效
 *    - 中文大类目 → 勾大类目即"整枝排除"生效
 *  只放 catCnOf(cat1) 而不放 catCnOf(cat2): 二级归并名会把别的枝误伤
 *  (例: 家居类商品的二级 "Car Freshener" 会被归成"汽车用品"), 排除一级会连带砍掉它。 */
function catMatchText(x) {
  const c1 = String(x.cat1 || '(未分类)');
  /* ★ 2026-10-02 修(用户实测反馈「排除了类目还在商品库里显示」):
   * 全库 70.2% 的商品 cat1/cat2/catPath 都是空的, 只有 category 有值
   *   (实测 283 条 category = "Boot Mats" / "Front & Radiator Grilles" / "Steering Wheel Covers" …,
   *    全是 Amazon 给的叶子类目名, 但明显是汽车配件)。
   * 旧匹配串里 category 是【原样】拼进去的 → 里面只有英文 "boot mats",
   *   没有中文大类名 → 排除「汽车用品」匹配不到 → 它们留在结果里,
   *   可用户看到的类目列就是 "Boot Mats" —— 于是反馈"排除了还在显示"。
   * 修法: cat1 为空时, 把 category 也过一遍 catCnOf 归并, 让中文大类名出现在匹配串里。
   * 只在 cat1 为空时加 —— 有 cat1 的商品(29.8%)行为完全不变, 零误伤。
   * ⚠️ 必须排除【采集模式名】(Links/FollowShop/ListDirect/Search/Shop…): 它们不是商品类目,
   *   归并只会落到「其他类目」兜底桶 —— 实测不加这个护栏, "排除其他类目" 会从 310 条
   *   暴涨到 6953 条(把 6690 条没类目的商品全牵连进来), 语义就乱了。 */
  const CAT_MODE_NAMES = /^(Links|FollowShop|ListDirect|ListFiltered|Search|Shop|Category|Brand|Asin|ListPage|List|其他)$/i;
  const extra = (c1 === '(未分类)' && x.category && !CAT_MODE_NAMES.test(String(x.category).trim()))
    ? catCnOf(String(x.category)) : '';
  return [
    c1,
    String(x.cat2 || ''),
    catCnOf(c1),
    extra,
    String(x.catPath || ''),
    String(x.category || ''),
  ].join(' | ').toLowerCase();
}

// filter: { fulfill, rankMin/Max, priceMin/Max, ratingMin/Max, reviewsMin/Max, salesMin/Max, q, badges(含任一), badgeNot(页面标识·排除), tmMin/Max, tmCountries, category, sites, is1688, brandStatus, newDaysMin/Max, noRank, hasRankOnly(只看有排名) }
// 严格模式: 字段未知(该采集器未抓到)视为不满足 → 跳过 (只采被过滤出的商品)
function applyCollectFilter(item, filter) {
  if (!filter || !Object.keys(filter).length) return true;
  const f = filter;
  if (f.fulfill === 'AMZ') {                                                      // 只采亚马逊自营
    if (!item.amazonSell) return false;
  } else if (f.fulfill && item.fulfill && item.fulfill !== f.fulfill) return false; // 只采 FBA/FBM: 排除明确不匹配的; 未知(null)视为可采
  if (f.aplus === true && !item.aplus) return false;                          // 旧字段兼容: 仅有 A+
  else if (f.aplus === false && item.aplus) return false;                     // 旧字段兼容: 排除 A+
  if (f.rankMin != null || f.rankMax != null) {                                    // 大排名区间
    // ★ 2026-10-02: 统一用 rankParentOf()(= 界面卡片「父类排名」的同一口径)。
    //   旧写法用 bigRankOf(所有排名取最大) → 会把"只有一条页面原生BSR"(属子类)的商品
    //   也算成有父类排名, 造成"卡片显示未采到、却被排名区间筛出来"。
    const bigR = rankParentOf(item);
    if (bigR == null) return false;                                                // 严格模式: 没有排名 = 不满足
    if (f.rankMin != null && bigR < f.rankMin) return false;
    if (f.rankMax != null && bigR > f.rankMax) return false;
  }
  const pr = (typeof item.price === 'number') ? item.price : parseMoneyText(item.price, item.site);   // ★ 站点感知
  if (f.priceMin != null && !(pr != null && pr >= f.priceMin)) return false;       // 价格 ≥ 下限
  if (f.priceMax != null && !(pr != null && pr <= f.priceMax)) return false;       // 价格 ≤ 上限
  const rt = (typeof item.rating === 'number') ? item.rating : parseFloat(String(item.rating || '').match(/[\d.]+/)?.[0]);
  if (f.ratingMin != null && !(rt != null && rt >= f.ratingMin)) return false;     // 评分 ≥ 下限
  if (f.ratingMax != null && !(rt != null && rt <= f.ratingMax)) return false;     // 评分 ≤ 上限
  if (f.reviewsMin != null && !((item.reviews || 0) >= f.reviewsMin)) return false; // 评论数 ≥ 下限
  if (f.reviewsMax != null && !((item.reviews || 0) <= f.reviewsMax)) return false; // 评论数 ≤ 上限
  if (f.q) {                                                                       // 标题/ASIN 含关键词
    const s = String(f.q).toLowerCase();
    if (!String(item.title || '').toLowerCase().includes(s) && !String(item.asin || '').toLowerCase().includes(s)) return false;
  }
  if (f.badges && f.badges.length) {                                               // 页面标识(旧·含任一): 商品含任一勾选标识
    if (!f.badges.some((b) => itemMatchesBadge(item, b))) return false;
  }
  // ★ 2026-09-24 页面标识【排除法】: 命中任一项即剔除 —— 判据同为 itemMatchesBadge,
  //   与商品库筛选 badgeNot 完全同一语义 (A+ 也走这里, 不再有独立 A+ 字段)。
  if (f.badgeNot && f.badgeNot.length) {
    if (f.badgeNot.some((b) => itemMatchesBadge(item, b))) return false;
  }
  const tc = item.trademarkCount || 0;
  if (f.tmMin != null && f.tmMax != null) { if (tc >= f.tmMin && tc <= f.tmMax) return false; }  // 商标数在区间内 → 排除
  else if (f.tmMin != null && tc >= f.tmMin) return false;                                        // 商标数 ≥ N 排除
  else if (f.tmMax != null && tc <= f.tmMax) return false;                                        // 商标数 ≤ N 排除
  if (f.tmCountries) {                                                             // 商标国家排除 (欧盟/英国/美国/德国/日本...)
    const list = String(f.tmCountries).split(/[,，]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
    const itemC = String((item.tmCountries || []).join(' ')).toLowerCase();
    if (list.some((c) => itemC.includes(c))) return false;
  }
  if (f.category) {                                                                // 类目含关键词
    if (!String(item.category || '').toLowerCase().includes(String(f.category).toLowerCase())) return false;
  }
  // 类目排除法 (与商品管理同一语义): 命中匹配串任一关键词即跳过
  // ★ 2026-09-24: 匹配串改为 catMatchText() (含【中文大类目】), 前端「类目排除」chips 给的就是大类目
  if (f.categoryNot && f.categoryNot.length) {
    const c = catMatchText(item);
    if (f.categoryNot.some((k) => c.includes(String(k).toLowerCase()))) return false;
  }
  // 跟卖数区间 (与商品管理同一语义)
  if (f.followMin != null && !((item.followCount || 0) >= f.followMin)) return false;
  if (f.followMax != null && !((item.followCount || 0) <= f.followMax)) return false;
  // 卖家维度: 排除亚马逊自营
  if (f.noAmz === true && item.amazonSell) return false;
  /* ★ 2026-10-02 卖家国家(中国卖家) —— 补上这条判定。
   * 背景(用户实测): 面板里能选「中国卖家」, canonicalToCollectFilter 也把 china 映射进来了,
   *   但 applyCollectFilter 从头到尾没读 f.china → 勾了等于没勾, 静默失效。
   * 数据来源: 插件面板【卖家】行上的国旗图标 (links-collector.readSellerFlag → item.chinaSeller)。
   * 三态语义(重要):
   *   item.chinaSeller === true/false  读到了国旗, 明确是/不是大中华区
   *   item.chinaSeller === null/undefined  没读到国旗(插件未登录/面板没渲染完) → 未知
   * 严格模式: 未知视为【不满足】。理由: 用户勾「只要中国卖家」是硬要求, 放行未知
   *   等于把非中国卖家也采回来, 筛选就白设了 —— 宁可少采, 不要采错。
   * (代价: 插件没登录时这条筛选会一条都采不到 —— 这是正确行为, 界面上会明确提示。) */
  if (f.china === true && item.chinaSeller !== true) return false;
  if (f.china === false && item.chinaSeller === true) return false;
  // 无排名 (旧字段, 与商品管理同一口径: rankParentOf == null 才算无排名)
  // ★ 2026-09-25 大排名三态筛选: 'ok' 有大排名 / 'not_listed' 未上榜 / 'unknown' 未采集到
  //   注意: 未上榜 = 插件面板已分析完、确实没有根类目排名行 —— 与"没采到"是两回事, 必须能分开筛
  if (f.rankState) {
    const st = rankParentStateOf(item);
    if (st !== f.rankState) return false;
  }
  if (f.noRank === true && rankParentOf(item) != null) return false;
  // ★ 2026-09-24 只看有排名 (= 排除没有排名的商品); ★ 2026-10-02 口径统一为 rankParentOf()
  //   —— 必须与界面卡片「父类排名」完全一致, 否则用户会看到"勾了排除无排名、结果里还有未采到的"。
  if (f.hasRankOnly === true && rankParentOf(item) == null) return false;
  // ★ 2026-09-25 大排名三态(列表页卡片就能判: 面板已就绪但没有根类目行 = 未上榜)
  if (f.rankState && rankParentStateOf(item) !== f.rankState) return false;
  if (f.sites && f.sites.length && item.site && !f.sites.includes(item.site)) return false; // 站点多选 (勾选之外跳过)
  else if (f.site && item.site && item.site !== f.site) return false;              // 旧字段兼容: 单站点
  if (f.salesMin != null) {                                                        // 月销量 ≥ N (未采到销量=0 → 跳过)
    if (!((item.monthlySales || 0) >= f.salesMin)) return false;
  }
  if (f.salesMax != null && !((item.monthlySales || 0) <= f.salesMax)) return false; // 月销量 ≤ N
  if (f.is1688 === '1' && !item.is1688) return false;                              // 1688 同款: 仅有 (未知视为无 → 跳过)
  if (f.is1688 === '0' && item.is1688) return false;                               // 1688 同款: 排除
  if (f.brandStatus === 'registered' && item.brandStatus === 'registered') return false; // 品牌状态: 排除已备案
  if (f.brandStatus === 'notfound' && item.brandStatus !== 'notfound') return false;      // 品牌状态: 仅未查到
  if (f.brandStatus === 'tm' && (item.tmMark || /TM|注册商标/.test(item.brandStatus || ''))) return false; // 品牌状态: 排除TM申请中
  if (f.newDaysMin != null || f.newDaysMax != null) {                              // 上架天数区间 (新品)
    // ★ 2026-10-02: 与商品库同一口径 listedDateOf() (firstAvailable 优先, 退回 listedAt)
    const d = listedDateOf(item);
    if (!d) return false;
    const days = (Date.now() - d.getTime()) / 86400000;
    if (f.newDaysMin != null && days < f.newDaysMin) return false;
    if (f.newDaysMax != null && days > f.newDaysMax) return false;
  } else if (f.newDays != null) {                                                  // 旧字段兼容: 上架 ≤ N 天
    const d = listedDateOf(item);
    if (!d || (Date.now() - d.getTime()) > f.newDays * 86400000) return false;
  }
  return true;
}

// 过滤条件是否需要读详情页才能判断 (配送/A+/排名/评分/评论/销量/商标/上架/标识/类目)
// 列表页可判的只有: 价格/关键词/1688/站点 (及 bulk/catmenu 提取的 badge)
function filterNeedsDetail(filter) {
  if (!filter) return false;
  return !!(filter.fulfill || filter.aplus || filter.rankMin != null || filter.rankMax != null
    || filter.ratingMin != null || filter.ratingMax != null || filter.reviewsMin != null || filter.reviewsMax != null
    || filter.salesMin != null || filter.salesMax != null || filter.tmMin != null || filter.tmMax != null
    || filter.newDaysMin != null || filter.newDaysMax != null || filter.newDays != null
    || (filter.badges && filter.badges.length) || filter.category
    || (filter.badgeNot && filter.badgeNot.length)                     // ★ 页面标识排除: 需要徽章/A+ 数据
    || filter.hasRankOnly === true);                                   // ★ 只看有排名: 需要排名数据
}

// ===== 统一过滤条件 (单一 schema) =====
// 商品管理筛选 与 采集过滤 共用这一套字段: 一个面板、一份序列化、两个后端适配器。
//   canonical → /api/products?filter=<json>   (查商品库)
//   canonical → canonicalToCollectFilter()    (采集时逐商品判定, 复用 applyCollectFilter)
// 语义差异(有意保留): 采集时"未知字段"放行(详情页读到后再判), 商品库里未知字段视为不满足。
function normFilter(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const s = (v) => (v == null ? '' : String(v).trim());
  const arr = (v) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : (v ? String(v).split(/[,，\s]+/).filter(Boolean) : []));
  return {
    sites: arr(r.sites).map((x) => x.toLowerCase()),
    fulfill: s(r.fulfill),                                   // '' | FBA | FBM | AMZ
    sell: s(r.sell),                                         // '' | amz(自营) | third(第三方) — 与 fulfill=AMZ 等价, 保留工具栏兼容
    aplus: s(r.aplus),                                       // '' | 1(仅有) | 0(排除)
    badges: arr(r.badges),
    // ★ 2026-09-24 面板新语义字段 (旧字段 badges/noRank 语义不变, 老规则/老 API 调用继续可用):
    //   badgeNot    = 页面标识【排除法】列表: 命中任一项即剔除 (A+ 也走这里)
    //   hasRankOnly = '1' 只看有排名 (= 排除没有排名的商品); 判据与 noRank 相同 (bigRankOf)
    badgeNot: arr(r.badgeNot),
    hasRankOnly: (r.hasRankOnly === true || r.hasRankOnly === '1' || r.hasRankOnly === 1) ? '1' : '',
    china: s(r.china),                                       // '' | 1 | 0
    noRank: r.noRank === true || r.noRank === '1' || r.noRank === 1,
    // ★ 2026-09-25 大排名三态: '' 不限 / 'ok' 有大排名 / 'not_listed' 未上榜 / 'unknown' 未采集到
    rankState: (r.rankState == null ? '' : String(r.rankState).trim()),
    priceRange: s(r.priceRange), salesRange: s(r.salesRange), rankRange: s(r.rankRange),
    ratingRange: s(r.ratingRange), reviewsRange: s(r.reviewsRange), followRange: s(r.followRange),
    tmRange: s(r.tmRange), newDaysRange: s(r.newDaysRange),
    tmCountries: s(r.tmCountries), is1688: s(r.is1688), brandStatus: s(r.brandStatus),
    q: s(r.q), catNot: arr(r.catNot), catKw: s(r.catKw),
    // ★ 2026-09: 正向类目筛选 (大类目/二级类目)。前端 schema 里本来就有 cat1/cat2 键, 但 normFilter 不认,
    //   于是前端传了也会被丢掉 —— 表现为"加了类目筛选但不起作用"。
    cat1: s(r.cat1), cat2: s(r.cat2),
    cat1Cn: s(r.cat1Cn),                                     // ★ 中文大类目 (归并后的中文名)
    famFilter: s(r.famFilter), famKey: s(r.famKey), famAny: s(r.famAny),   // ★ 变体族筛选
    dropOtherBrand: s(r.dropOtherBrand),                                   // ★ 他牌剔除开关: '' = 剔除(默认) / '0' = 保留他牌
    collectedFrom: s(r.collectedFrom), collectedTo: s(r.collectedTo),
    shopAplus: s(r.shopAplus), brandShop: s(r.brandShop), brandStore: s(r.brandStore),   // 仅采集(店铺维度)
  };
}
const FILTER_KEYS = Object.keys(normFilter({}));
// 该过滤条件里"实际生效"的字段数 (用于前端显示"已启用 N 项")
function filterActiveCount(raw) {
  const f = normFilter(raw);
  let n = 0;
  for (const k of FILTER_KEYS) {
    const v = f[k];
    if (Array.isArray(v)) { if (v.length) n++; }
    else if (typeof v === 'boolean') { if (v) n++; }
    else if (v !== '') n++;
  }
  return n;
}
// 区间字符串 "10-100" / "10-" / "-100" / "50" → {min,max} (与采集侧 rng 完全同一实现)
function rngRange(v) {
  const s = String(v == null ? '' : v).trim().replace(/[，。\s]/g, '');
  if (!s) return { min: null, max: null };
  const m = s.match(/^(-?\d*\.?\d*)-(-?\d*\.?\d*)$/);
  if (m) return { min: m[1] === '' || m[1] === '-' ? null : parseFloat(m[1]), max: m[2] === '' ? null : parseFloat(m[2]) };
  const n = parseFloat(s);
  return isNaN(n) ? { min: null, max: null } : { min: n, max: null };
}
// 统一过滤条件 → 商品库查询参数 (沿用 /api/products 既有参数名, 复用其全部解析逻辑)
function filterToQuery(f) {
  const p = new URLSearchParams();
  if (f.q) p.set('q', f.q);
  if (f.sites.length) p.set('site', f.sites.join(','));
  if (f.fulfill === 'AMZ') p.set('sell', 'amz');
  else if (f.fulfill === 'FBA' || f.fulfill === 'FBM') p.set('fba', f.fulfill);
  else if (f.sell === 'amz' || f.sell === 'third') p.set('sell', f.sell);   // 卖家维度 (自营/第三方)
  if (f.aplus) p.set('aplus', f.aplus);
  if (f.badges.length) p.set('badges', f.badges.join(','));
  if (f.badgeNot.length) p.set('badgeNot', f.badgeNot.join(','));       // ★ 页面标识(排除法)
  if (f.hasRankOnly === '1') p.set('hasRankOnly', '1');                 // ★ 只看有排名 (排除没有排名)
  if (f.china !== '') p.set('china', f.china);
  if (f.noRank) p.set('noRank', '1');
  if (f.rankState) p.set('rankState', f.rankState);                       // ★ 大排名三态
  if (f.priceRange) p.set('priceRange', f.priceRange);
  if (f.salesRange) p.set('salesRange', f.salesRange);
  if (f.rankRange) p.set('rankRange', f.rankRange);
  if (f.ratingRange) p.set('ratingRange', f.ratingRange);
  if (f.reviewsRange) p.set('reviewsRange', f.reviewsRange);
  if (f.followRange) p.set('followRange', f.followRange);
  if (f.tmRange) p.set('tmRange', f.tmRange);
  if (f.newDaysRange) p.set('newDaysRange', f.newDaysRange);
  if (f.tmCountries) p.set('tmCountries', f.tmCountries);
  if (f.is1688 !== '') p.set('is1688', f.is1688);
  if (f.brandStatus) p.set('brandStatus', f.brandStatus);
  const catNot = f.catNot.concat(String(f.catKw || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean));
  if (catNot.length) p.set('categoryNot', catNot.join(','));
  if (f.cat1Cn) p.set('cat1Cn', f.cat1Cn);                   // ★ 2026-09 中文大类目 (归并)
  if (f.famFilter) p.set('famFilter', f.famFilter);          // ★ 2026-09 变体族筛选
  if (f.famKey) p.set('famKey', f.famKey);
  if (f.famAny === true || f.famAny === '1' || f.famAny === 1) p.set('famAny', '1');
  if (f.cat1) p.set('cat1', f.cat1);                         // ★ 2026-09 正向大类目
  if (f.cat2) p.set('cat2', f.cat2);                         // ★ 2026-09 正向二级类目
  if (f.collectedFrom) p.set('collectedFrom', f.collectedFrom);
  if (f.collectedTo) p.set('collectedTo', f.collectedTo);
  return p;
}
// 判断一个 filter 对象是【canonical 统一 schema】还是【legacy 扁平 filter* 字段】。
// ★ extpush5: 旧判据是 hasOwnProperty('sites') || hasOwnProperty('fulfill'), 会把【部分 canonical】
//   (例如只给了 {q} 的规则) 误判成 legacy → legacyToCanonical 读的是 filterQ 而不是 q → 过滤条件被静默丢弃。
//   新判据: legacy 键一定以 `filter` 开头, canonical 键一个都不以 filter 开头。
//   空对象按 canonical 处理 (等价于无过滤), 与旧行为一致。
function looksCanonical(filt) {
  if (!filt || typeof filt !== 'object') return false;
  const ks = Object.keys(filt);
  if (!ks.length) return true;
  return !ks.some((k) => /^filter/.test(k));
}
// 统一过滤条件 → 采集过滤对象 (字段名与 applyCollectFilter 期望一致)
function canonicalToCollectFilter(raw) {
  const f = normFilter(raw);
  const filter = {};
  const put = (r, kmin, kmax) => { const x = rngRange(r); if (x.min != null) filter[kmin] = x.min; if (x.max != null) filter[kmax] = x.max; };
  if (f.rankState) filter.rankState = f.rankState;                         // ★ 大排名三态 (未上榜/未采到/有)
  put(f.rankRange, 'rankMin', 'rankMax');
  put(f.priceRange, 'priceMin', 'priceMax');
  put(f.ratingRange, 'ratingMin', 'ratingMax');
  put(f.reviewsRange, 'reviewsMin', 'reviewsMax');
  put(f.salesRange, 'salesMin', 'salesMax');
  put(f.tmRange, 'tmMin', 'tmMax');
  put(f.followRange, 'followMin', 'followMax');
  put(f.newDaysRange, 'newDaysMin', 'newDaysMax');
  if (f.fulfill) filter.fulfill = f.fulfill;
  else if (f.sell === 'amz') filter.fulfill = 'AMZ';
  else if (f.sell === 'third') filter.noAmz = true;      // 排除亚马逊自营
  if (f.aplus === '1') filter.aplus = true;
  else if (f.aplus === '0') filter.aplus = false;
  if (f.q) filter.q = f.q;
  const badges = f.badges.slice();
  if (f.aplus === '1' && badges.indexOf('A+') < 0) badges.push('A+');
  if (badges.length) filter.badges = badges;
  // ★ 2026-09-24 接上页面标识(排除法): 原先这里没有任何 badgeNot 通路 → 面板设了采集端静默丢弃
  if (f.badgeNot.length) filter.badgeNot = f.badgeNot;
  const catNot = f.catNot.concat(String(f.catKw || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean));
  if (catNot.length) filter.categoryNot = catNot;
  // ★ 2026-09 他牌剔除开关: 原为写死"品牌页/搜索页混入他牌一律丢弃", 现改为采集过滤里的开关
  if (f.dropOtherBrand != null && f.dropOtherBrand !== '') filter.dropOtherBrand = String(f.dropOtherBrand);
  if (f.tmCountries) filter.tmCountries = f.tmCountries;
  if (f.sites.length) filter.sites = f.sites;
  if (f.is1688 === '1' || f.is1688 === '0') filter.is1688 = f.is1688;
  if (f.brandStatus) filter.brandStatus = f.brandStatus;
  if (f.noRank) filter.noRank = true;
  if (f.hasRankOnly === '1') filter.hasRankOnly = true;   // ★ 只看有排名 (排除没有排名) —— 原先同样没有通路
  if (f.china === '1') filter.china = true;
  else if (f.china === '0') filter.china = false;
  return filter;
}
// 旧规则(legacy filter* 字段) → 统一过滤条件 (兼容已保存的采集规则)
function legacyToCanonical(j) {
  const s = (v) => (v == null ? '' : String(v));
  const badges = Array.isArray(j.filterBadges) ? j.filterBadges.slice() : (j.filterBadge ? [j.filterBadge] : []);
  let aplus = s(j.filterAplus);
  const bi = badges.findIndex((b) => String(b).toLowerCase() === 'a+');
  if (bi >= 0) { aplus = '1'; badges.splice(bi, 1); }
  return normFilter({
    sites: j.filterSites || (j.filterSite ? [j.filterSite] : []),
    fulfill: s(j.filterFulfill), aplus, badges,
    badgeNot: Array.isArray(j.filterBadgesNot) ? j.filterBadgesNot : (j.filterBadgeNot ? [j.filterBadgeNot] : []),
    hasRankOnly: (j.filterHasRankOnly === '1' || j.filterHasRankOnly === true || j.filterHasRankOnly === 1) ? '1' : '',
    priceRange: s(j.filterPriceRange), salesRange: s(j.filterSalesRange), rankRange: s(j.filterRankRange),
    ratingRange: s(j.filterRatingRange), reviewsRange: s(j.filterReviewsRange), tmRange: s(j.filterTmRange),
    newDaysRange: s(j.filterNewDaysRange), tmCountries: s(j.filterTmCountries), is1688: s(j.filterIs1688),
    brandStatus: s(j.filterBrandStatus), q: s(j.filterQ),
    catKw: s(j.filterCategory), shopAplus: s(j.filterShopAplus), brandShop: s(j.filterBrandShop), brandStore: s(j.filterBrandStore),
  });
}

// 从请求体构建采集过滤条件 (字段名与前端采集弹窗一致)
function buildCollectFilter(j) {
  // 统一入口: 请求体带 canonical `filter` → 直接用它; 否则走旧 filter* 字段 (兼容旧前端/旧规则)
  if (j && j.filter && typeof j.filter === 'object' && (j.filter.sites || j.filter.fulfill || j.filter.priceRange || j.filter.q || j.filter.catNot || Object.keys(j.filter).length >= 2)) {
    return canonicalToCollectFilter(j.filter);
  }
  const filter = {};
  // 区间解析: "10-100" / "10-" / "-100" → {min,max}
  const rng = (v) => {
    const s = String(v == null ? '' : v).trim().replace(/[，。\s]/g, '');
    if (!s) return { min: null, max: null };
    const m = s.match(/^(-?\d*\.?\d*)-(-?\d*\.?\d*)$/);
    if (m) return { min: m[1] === '' || m[1] === '-' ? null : parseFloat(m[1]), max: m[2] === '' ? null : parseFloat(m[2]) };
    const n = parseFloat(s);
    return isNaN(n) ? { min: null, max: null } : { min: n, max: null };
  };
  const r1 = rng(j.filterRankRange), r2 = rng(j.filterPriceRange), r3 = rng(j.filterRatingRange), r4 = rng(j.filterReviewsRange), r5 = rng(j.filterSalesRange), r6 = rng(j.filterTmRange), r7 = rng(j.filterNewDaysRange);
  if (r1.min != null) filter.rankMin = r1.min;
  if (r1.max != null) filter.rankMax = r1.max;
  if (r2.min != null) filter.priceMin = r2.min;
  if (r2.max != null) filter.priceMax = r2.max;
  if (r3.min != null) filter.ratingMin = r3.min;
  if (r3.max != null) filter.ratingMax = r3.max;
  if (r4.min != null) filter.reviewsMin = r4.min;
  if (r4.max != null) filter.reviewsMax = r4.max;
  if (r5.min != null) filter.salesMin = r5.min;
  if (r5.max != null) filter.salesMax = r5.max;
  if (r6.min != null) filter.tmMin = r6.min;
  if (r6.max != null) filter.tmMax = r6.max;
  if (r7.min != null) filter.newDaysMin = r7.min;
  if (r7.max != null) filter.newDaysMax = r7.max;
  // 兼容旧字段 (旧规则/旧调用: filterRankMax/filterPriceMin 等单边)
  if (j.filterRankMax != null && j.filterRankMax !== '' && r1.min == null && r1.max == null) filter.rankMax = parseInt(j.filterRankMax, 10);
  if (j.filterPriceMin != null && j.filterPriceMin !== '' && r2.min == null && r2.max == null) filter.priceMin = parseFloat(j.filterPriceMin);
  if (j.filterPriceMax != null && j.filterPriceMax !== '' && r2.min == null && r2.max == null) filter.priceMax = parseFloat(j.filterPriceMax);
  if (j.filterRatingMin != null && j.filterRatingMin !== '' && r3.min == null && r3.max == null) filter.ratingMin = parseFloat(j.filterRatingMin);
  if (j.filterReviewsMin != null && j.filterReviewsMin !== '' && r4.min == null && r4.max == null) filter.reviewsMin = parseInt(j.filterReviewsMin, 10);
  if (j.filterSalesMin != null && j.filterSalesMin !== '' && r5.min == null && r5.max == null) filter.salesMin = parseInt(j.filterSalesMin, 10);
  if (j.filterTmMin != null && j.filterTmMin !== '' && r6.min == null && r6.max == null) filter.tmMin = parseInt(j.filterTmMin, 10);
  if (j.filterNewDays != null && j.filterNewDays !== '' && r7.min == null && r7.max == null) filter.newDays = parseInt(j.filterNewDays, 10);
  if (j.filterFulfill === 'FBA' || j.filterFulfill === 'FBM' || j.filterFulfill === 'AMZ') filter.fulfill = j.filterFulfill;
  if (j.filterAplus === '1') filter.aplus = true;      // 旧字段兼容 (现并入 badges.aplus)
  else if (j.filterAplus === '0') filter.aplus = false;
  if (j.filterQ) filter.q = String(j.filterQ).trim();
  if (j.filterRankState) filter.rankState = String(j.filterRankState).trim();      // ★ 大排名三态(兼容旧式入参)
  // 页面标识多选 (badges): 商品含任一勾选标识即可 (A+/AC/BestSeller/NewRelease/Deal/...)
  if (Array.isArray(j.filterBadges) && j.filterBadges.length) filter.badges = j.filterBadges.filter((b) => typeof b === 'string' && b);
  else if (j.filterBadge) filter.badges = [j.filterBadge];  // 旧字段兼容
  // ★ 2026-09-24 页面标识(排除法): 新前端(独立网页版)写 filterBadgesNot → 命中任一即剔除
  if (Array.isArray(j.filterBadgesNot) && j.filterBadgesNot.length) filter.badgeNot = j.filterBadgesNot.filter((b) => typeof b === 'string' && b);
  else if (j.filterBadgeNot) filter.badgeNot = [j.filterBadgeNot];
  // ★ 2026-09-24 只看有排名 (排除没有排名)
  if (j.filterHasRankOnly === '1' || j.filterHasRankOnly === true || j.filterHasRankOnly === 1) filter.hasRankOnly = true;
  if (j.filterTmCountries) filter.tmCountries = String(j.filterTmCountries).trim();
  if (j.filterCategory) filter.category = String(j.filterCategory).trim();
  // 站点多选: 勾选全部站点 (列表类采集取第一个为主站点; 跟卖店铺采集用于跨站回退)
  if (Array.isArray(j.filterSites) && j.filterSites.length) filter.sites = j.filterSites.map((s) => String(s).trim().toLowerCase()).filter(Boolean);
  else if (j.filterSite) filter.site = j.filterSite;  // 旧字段兼容
  if (j.filterIs1688 === '1' || j.filterIs1688 === '0') filter.is1688 = j.filterIs1688;
  if (j.filterBrandStatus) filter.brandStatus = j.filterBrandStatus;
  return filter;
}

// 统一过滤条件的中文描述 (单一实现, 前端两个页面共用同一文案)
function filterDescCanonical(raw) {
  const f = normFilter(raw);
  const parts = [];
  const rf = (v, unit = '') => { const r = rngRange(v); return r.min != null && r.max != null ? `${r.min}-${r.max}${unit}` : r.min != null ? `≥${r.min}${unit}` : r.max != null ? `≤${r.max}${unit}` : ''; };
  if (f.sites.length) parts.push('站点:' + f.sites.join(','));
  if (f.fulfill) parts.push('配送=' + f.fulfill);
  else if (f.sell === 'amz') parts.push('仅AMZ自营');
  else if (f.sell === 'third') parts.push('仅第三方卖家');
  if (f.aplus === '1') parts.push('仅有A+');
  else if (f.aplus === '0') parts.push('排除A+');
  if (f.badges.length) parts.push('标识:' + f.badges.join('/'));
  if (f.badgeNot.length) parts.push('排除标识:' + f.badgeNot.join('/'));   // ★ 页面标识(排除法)
  if (f.china === '1') parts.push('中国卖家');
  else if (f.china === '0') parts.push('非中国卖家');
  if (f.noRank) parts.push('无排名');
  if (f.hasRankOnly === '1') parts.push('仅看有排名(排除没有排名)');   // ★ 无排名语义反转后的新字段
  if (f.priceRange) parts.push('价:' + rf(f.priceRange));
  if (f.salesRange) parts.push('月销:' + rf(f.salesRange));
  if (f.rankRange) parts.push('大排名:' + rf(f.rankRange));
  if (f.ratingRange) parts.push('评分:' + rf(f.ratingRange));
  if (f.reviewsRange) parts.push('评论:' + rf(f.reviewsRange));
  if (f.followRange) parts.push('跟卖:' + rf(f.followRange));
  if (f.tmRange) parts.push('排除商标数:' + rf(f.tmRange));
  if (f.tmCountries) parts.push('排除商标国:' + f.tmCountries);
  if (f.newDaysRange) parts.push('上架:' + rf(f.newDaysRange) + '天');
  if (f.is1688 === '1') parts.push('有1688同款');
  else if (f.is1688 === '0') parts.push('排除1688同款');
  if (f.brandStatus) parts.push('品牌:' + ({ registered: '排除已备案', tm: '排除TM', notfound: '仅未查到' }[f.brandStatus] || f.brandStatus));
  if (f.q) parts.push('标题含「' + f.q + '」');
  const catNot = f.catNot.concat(String(f.catKw || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean));
  if (catNot.length) parts.push('排除类目:' + catNot.join('/'));
  if (raw && (raw.dropOtherBrand === '0' || raw.dropOtherBrand === 0)) parts.push('保留他牌');
  if (f.collectedFrom || f.collectedTo) parts.push('采集时间:' + (f.collectedFrom || '…') + '~' + (f.collectedTo || '…'));
  if (f.shopAplus === '1') parts.push('仅有A+店铺');
  else if (f.shopAplus === '0') parts.push('排除A+店铺');
  if (f.brandShop === '1') parts.push('仅品牌店铺');
  else if (f.brandShop === '0') parts.push('排除品牌店铺');
  if (f.brandStore) parts.push('品牌店=' + f.brandStore);
  return parts.length ? parts.join(' + ') : '无过滤';
}

// 过滤条件中文描述 (通知/结果弹窗)
function filterDesc(filter) {
  if (!filter || !Object.keys(filter).length) return '无过滤';
  const parts = [];
  const fmt = (min, max, unit = '') => (min != null && max != null ? `${min}-${max}${unit}` : min != null ? `≥${min}${unit}` : max != null ? `≤${max}${unit}` : '');
  if (filter.fulfill) parts.push('配送=' + filter.fulfill);
  if (filter.aplus) parts.push('A+页面');
  if (filter.rankMin != null || filter.rankMax != null) parts.push('大排名:' + fmt(filter.rankMin, filter.rankMax));
  if (filter.rankState) parts.push('大排名状态:' + ({ ok: '有大排名', not_listed: '未上榜', unknown: '未采集到' }[filter.rankState] || filter.rankState));
  if (filter.priceMin != null || filter.priceMax != null) parts.push('价:' + fmt(filter.priceMin, filter.priceMax));
  if (filter.ratingMin != null || filter.ratingMax != null) parts.push('评分:' + fmt(filter.ratingMin, filter.ratingMax));
  if (filter.reviewsMin != null || filter.reviewsMax != null) parts.push('评论:' + fmt(filter.reviewsMin, filter.reviewsMax));
  if (filter.q) parts.push('关键词=' + filter.q);
  if (filter.badges && filter.badges.length) parts.push('标识:' + filter.badges.join(','));
  if (filter.badgeNot && filter.badgeNot.length) parts.push('排除标识:' + filter.badgeNot.join(','));   // ★ 页面标识(排除法)
  if (filter.hasRankOnly === true) parts.push('仅看有排名');                                            // ★ 只看有排名
  if (filter.tmMin != null || filter.tmMax != null) parts.push('排除商标:' + fmt(filter.tmMin, filter.tmMax));
  if (filter.tmCountries) parts.push('商标国家=' + filter.tmCountries + '排除');
  if (filter.salesMin != null || filter.salesMax != null) parts.push('月销:' + fmt(filter.salesMin, filter.salesMax));
  if (filter.is1688 === '1') parts.push('有1688同款');
  else if (filter.is1688 === '0') parts.push('排除1688同款');
  if (filter.brandStatus === 'registered') parts.push('排除已备案品牌');
  else if (filter.brandStatus === 'notfound') parts.push('仅未查到品牌');
  else if (filter.brandStatus === 'tm') parts.push('排除TM申请中');
  if (filter.newDaysMin != null || filter.newDaysMax != null) parts.push('上架:' + fmt(filter.newDaysMin, filter.newDaysMax) + '天');
  else if (filter.newDays != null) parts.push('上架≤' + filter.newDays + '天');
  if (filter.category) parts.push('类目=' + filter.category);
  if (filter.sites && filter.sites.length) parts.push('站点:' + filter.sites.join(','));
  else if (filter.site) parts.push('站点=' + filter.site);
  return parts.join(' + ');
}

// 列表页前置筛选 (宽松): 仅用列表页已有的字段判断 (插件 FBA/FBM 标签、插件排名、标题关键词、站点)
// 列表页无数据的字段 (评分/评论/A+/商标/类目/原生价格) 不在此判断 — 保留到详情页补全后再用 applyCollectFilter 完整筛
// 与 applyCollectFilter 的区别: 字段未知(null)视为"保留待详情确认", 不误杀
function preFilterByList(item, filter) {
  if (!filter || !Object.keys(filter).length) return true;
  const f = filter;
  if (f.fulfill === 'AMZ') { if (!item.amazonSell) return false; }
  else if (f.fulfill && item.fulfill && item.fulfill !== f.fulfill) return false;   // 插件标签明确不匹配 → 筛掉; 无标签 → 保留
  if (f.rankMax != null || f.rankMin != null) {
    const bigR = rankParentOf(item);                                               // ★ 大排名唯一口径(与界面卡片一致)
    if (bigR != null) {                                                            // 未知 → 保留待详情确认
      if (f.rankMin != null && bigR < f.rankMin) return false;
      if (f.rankMax != null && bigR > f.rankMax) return false;
    }
  }
  if (f.is1688 === '1' && !item.is1688) return false;                              // 1688 同款: 列表页标签已知, 无标签直接筛掉
  if (f.q) {
    const s = String(f.q).toLowerCase();
    if (!String(item.title || '').toLowerCase().includes(s) && !String(item.asin || '').toLowerCase().includes(s)) return false;
  }
  if (f.sites && f.sites.length && item.site && !f.sites.includes(item.site)) return false;
  if (f.site && item.site && item.site !== f.site) return false;
  return true;
}

// 单个商品详情补全 (价格/品牌/评分/评论/A+/配送/BSR/类目) + 采集过滤标记 (供列表类采集复用)
async function cdpEnrichOne(send, host, it, filter) {
  try {
    await send('Page.navigate', { url: 'https://' + host + '/dp/' + it.asin });
    await new Promise((r) => setTimeout(r, 7000));
    for (let s = 0; s < 2; s++) { await send('Runtime.evaluate', { expression: `window.scrollTo(0, ${(s + 1) * 2000})` }); await new Promise((r) => setTimeout(r, 500)); }
    const r = await send('Runtime.evaluate', {
      expression: `(() => {
        const out = { price: null, brand: null, rating: null, reviews: null, aplus: false, fulfill: null, bsr: [], category: null, amazonSell: false, mainImage: null };
        const sels = ['#corePrice_feature_div .a-offscreen', '.apex-pricetopay-value', '#price_inside_buybox', '.a-price .a-offscreen'];
        for (const sel of sels) {
          const el = document.querySelector(sel);
          if (el) {
            const t = (el.textContent || '').trim().replace(/\\s+/g, ' ');
            const m = t.match(/(?:€|£|\\$|¥|EUR|GBP|USD)\\s*([\\d.,]+)/);
            if (m) { out.price = parseFloat(m[1].replace(/,/g, '')); break; }
          }
        }
        const b = document.querySelector('#bylineInfo a, #bylineInfo_feature_div a');
        if (b) { let bt = b.textContent.trim().replace(/\\s+/g, ' ').replace(/^Brand:\\s*/i, '').trim(); if (bt && bt.length > 1 && bt.length < 60) out.brand = bt; }
        const rEl = document.querySelector('#acrPopover .a-icon-alt, [data-hook="rating-out-of-text"]');
        if (rEl) { const m = rEl.textContent.match(/([\\d.,]+)\\s*out of/); if (m) out.rating = parseFloat(m[1].replace(',', '.')); }
        const revEl = document.querySelector('#acrCustomerReviewText, [data-hook="total-review-count"]');
        if (revEl) { const m = revEl.textContent.match(/([\\d.,]+)/); if (m) out.reviews = parseInt(m[1].replace(/[.,]/g, ''), 10); }
        // 卖家/配送/自营/A+/主图/币种/类目/BSR: 共用单一实现 (见 DETAIL_CORE_JS), 与跟卖店铺链/详情修复/品牌采集保持一致
        ${DETAIL_CORE_JS}
        // BSR: 已由 DETAIL_CORE_JS 的统一解析器写入 out.bsr (旧的"单元格正则 + 全文兜底"两段实现已删除 —
        //      它会把第 2 条 BSR 之后的所有行吞进类目名并丢掉后续条目, 实测造成 599 条脏数据)
        // 类目层级 (面包屑) 已由 DETAIL_CORE_JS 统一提取 → out.cat1/cat2/cat3/catPath/category
        // 卖点: 商品描述要点 (#feature-bullets 或 #productDescription)
        out.sellingPoint = [];
        const bullets = document.querySelector('#feature-bullets ul, #feature-bullets');
        if (bullets) {
          bullets.querySelectorAll('li span.a-list-item, li').forEach((li) => {
            const t = (li.textContent || '').replace(/\\s+/g, ' ').trim();
            if (t && t.length > 3 && t.length < 300) out.sellingPoint.push(t);
          });
        }
        if (!out.sellingPoint.length) {
          const pd = document.querySelector('#productDescription');
          if (pd) { const t = (pd.textContent || '').replace(/\\s+/g, ' ').trim(); if (t) out.sellingPoint.push(t.slice(0, 500)); }
        }
        out.sellingPoint = out.sellingPoint.slice(0, 12);
        // 概要: 商品信息表 (productDetails 标签值对)
        out.productOverview = [];
        document.querySelectorAll('#productDetails_techSpec_section_1 tr, #productDetails_techSpec_section_2 tr, table.prodDetTable tr').forEach((tr) => {
          const th = tr.querySelector('th');
          const td = tr.querySelector('td');
          if (!th || !td) return;
          const k = th.textContent.replace(/\\s+/g, ' ').trim();
          const v = td.textContent.replace(/\\s+/g, ' ').trim();
          if (k && v && !/best sellers rank/i.test(k) && !/customer reviews/i.test(k)) out.productOverview.push({ k: k.slice(0, 40), v: v.slice(0, 120) });
        });
        out.productOverview = out.productOverview.slice(0, 30);
        return JSON.stringify(out);
      })()`, returnByValue: true,
    });
    const d = JSON.parse(r.result.value);
    if (d.price != null) it.price = d.price;
    if (d.brand) it.brand = d.brand;
    if (d.rating != null) it.rating = d.rating;
    if (d.reviews != null) it.reviews = d.reviews;
    if (d.aplus) it.aplus = true;
    if (d.fulfill) it.fulfill = d.fulfill;
    if (d.bsr && d.bsr.length) it.bsr = d.bsr;
    if (d.category) it.category = d.category;
    if (d.amazonSell) it.amazonSell = true;
    if (d.mainImage) it.mainImage = d.mainImage;
    if (d.sellingPoint && d.sellingPoint.length) it.sellingPoint = d.sellingPoint;
    if (d.productOverview && d.productOverview.length) it.productOverview = d.productOverview;
    // ===== 详情页读到即判定 (与「详情修复」「批量品牌采集」同一套字段, 否则入库缺 detailOk/类目层级/主卖家) =====
    // 缺这段会导致: 详情页明明读到了, 入库却没有 detailOk(详情未核实) / cat1-3(无法按一级二级类目筛选) / 主卖家
    if (d.detailOk) {
      it.detailOk = true; it.detailAt = now(); it.detailVer = DETAIL_VER;
      it.aplus = !!d.aplus;                                   // 读到页面即可判定 true/false (不再是"只写 true")
      if (d.regionText) {
        it.amazonSell = !!d.amazonSell;
        if (d.fulfill) it.fulfill = d.fulfill;                 // 未读到配送证据 → 保持 null (未知, 不猜 FBM)
        // ★ 2026-09-30 修复: 这里原来写 it.sellerRegion = d.regionText.slice(0,200)。
        //   regionText 是「BuyBox 主报价区已渲染」的**诊断信号串**(= 主信息/配送/表格/BuyBox 四段页面文本拼接,
        //   见本文件 out.regionText 的构造), 不是产地 —— 存进去的是 "£331.20… In stock Quantity: 1 2 3…" 这种整段页面文本。
        //   且全项目【没有任何地方读 sellerRegion】(只写/只合并/只透传), 属于污染数据的死字段 → 停止写入。
        //   将来若真要产地, 应从卖家简介页/卖家名反查, 不要拿诊断串充数。
      }
      if (d.mainSeller) it.mainSeller = d.mainSeller;
      if (siteSymbolOk(d.curSymbol, it.site || host)) it.priceSymbol = d.curSymbol;
      if (d.catPath) { it.catPath = d.catPath; it.cat1 = d.cat1; it.cat2 = d.cat2; it.cat3 = d.cat3; it.catNodes = d.catNodes || null; it.catSrc = 'bc'; it.catAt = now(); }
      it.currency = siteCurrency(it.site || 'uk');
    }
  } catch (e) {
    console.error('[enrich]', it.asin, '详情补全异常:', e && e.message);
  }
  it.__skip = !applyCollectFilter(it, filter);
}

// ===== 列表页公共工具: glow 地址设置 + 卡片提取 JS (list-direct / list-filtered 共用) =====
const SITE_ZIP = { uk: ['GB', 'SW1A1AA'], us: ['US', '10001'], de: ['DE', '10115'], fr: ['FR', '75001'], it: ['IT', '00100'], es: ['ES', '28001'], jp: ['JP', '100-0001'], ca: ['CA', 'M5V2T6'], in: ['IN', '110001'], au: ['AU', '2000'], mx: ['MX', '06600'], br: ['BR', '01310-100'], nl: ['NL', '1011'], se: ['SE', '11157'], pl: ['PL', '00-001'] };
// 自动设置目标国家配送地址 (Amazon glow API): 确保 FBA 配送/税费/可配送判断正确
// 注: 智赢插件的人民币价格不随配送地址变化 (插件有独立币种设置), 设置地址是为采集数据准确性
async function cdpSetGlowAddress(send, url, site, customZip) {
  try {
    const z = SITE_ZIP[site];
    if (!z) return false;
    // customZip: 用户输入邮编 (任意国家/地区), 覆盖站点默认邮编 — 采集"任何邮编的商品网页"
    const zip = String(customZip || '').trim() || z[1];
    const glowRes = await send('Runtime.evaluate', {
      expression: `(async () => {
        try {
          const r = await fetch('/portal-migration/hz/glow/address-change', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
            body: 'locationType=LOCATION_INPUT&zipCode=${zip}&deviceType=web&storeContext=generic&pageType=Gateway&actionSource=glow',
            credentials: 'include'
          });
          const j = await r.json();
          return JSON.stringify({ ok: r.ok, valid: j.isValidAddress, updated: j.isAddressUpdated, country: j.address && j.address.countryCode, zip: j.address && j.address.zipCode });
        } catch (e) { return JSON.stringify({ error: e.message }); }
      })()`, returnByValue: true, awaitPromise: true,
    });
    const g = JSON.parse(glowRes.result.value);
    if (g.updated) {
      // 地址变更生效: 重载站点首页落地国家/配送地址 (直接导航 aod 页可能触发 icp 国家落地重定向),
      // 首页落地后再由调用方导航目标页
      const home = 'https://www.amazon.' + siteToHostSuffix(site) + '/';
      await send('Page.navigate', { url: home });
      await new Promise((r) => setTimeout(r, 9000));
      return true;
    }
    return false;
  } catch (e) { console.error('[glow]', '设置配送地址失败:', e && e.message); return false; }
}

// 列表卡片提取 JS: 原生字段 (ASIN/标题/图片/评分/链接) + 智赢插件字段 (FBA/卖家数/排名/1688/人民币价)
// 模板字符串常量 (内部无反引号), 供列表页直采/筛选采集在浏览器上下文执行
const LIST_CARD_EXPR = `(() => {
  ${linksCollector.READ_RANKS_FN}
  const out = [];
  const seen = new Set();
  document.querySelectorAll('div[data-asin]').forEach(el => {
    const asin = el.getAttribute('data-asin');
    if (!asin || !/^[A-Z0-9]{10}$/.test(asin) || seen.has(asin)) return;
    seen.add(asin);
    // 过滤 Sponsored 广告卡片: aax 跳转/sspa/sparkle 特征 (插件不分析广告, 价格/标题结构也不同)
    if (el.querySelector('a[href*="aax-"], a[href*="sspa"], a[href*="sparkle"]')) return;
    // 真实商品链接: /dp/ 须在域名路径中 (aax 广告长 URL 也可能含 /dp/ 子串)
    const lk = [...el.querySelectorAll('a')].find((a) => {
      const h = a.getAttribute('href') || '';
      return /\\/dp\\/[A-Z0-9]{10}/.test(h) && !/aax-|sspa|sparkle/.test(h);
    });
    if (!lk) return;
    // 标题: h2 优先, 变体卡片等特殊结构用 .a-color-base.a-text-normal, 再兜底 /dp/ 链接文本
    let title = '';
    const t = el.querySelector('h2 span, h2, .a-color-base.a-text-normal');
    if (t) title = t.textContent.trim();
    if (!title) title = (lk.getAttribute('title') || lk.textContent || '').trim();
    const img = el.querySelector('.s-image, img');
    const ratingEl = el.querySelector('.a-icon-alt');
    // 插件: 配送标签 (FBA/FBM/卖家:N)
    const ship = [...el.querySelectorAll('.zying-tag-ship')].map(x => (x.textContent || '').trim()).filter(Boolean);
    const shipTxt = ship.join(' ');
    const fulfill = /FBM/.test(shipTxt) ? 'FBM' : /FBA/.test(shipTxt) ? 'FBA' : null;
    const sellerM = shipTxt.match(/卖家[:：]\\s*(\\d+)/);
    // ★ 2026-09-25 结构化排名行: 每行 = ranktag(数字) + a[href*=bestsellers](类目, 带层级) + span(标签)
    //   大排名只认【根类目】行 —— 旧写法按 .ranktag 抓数字取最大, 会把子类目的 #1 当大排名
    const rankInfo = readRanks(el);
    // 插件: 排名标签 (#5397 #38)
    const rankList = [...el.querySelectorAll('.ranktag')]
      .map(x => (x.textContent || '').trim())
      .map(x => { const m = x.match(/#?([\\d.,]+)/); return m ? parseInt(m[1].replace(/[.,]/g, ''), 10) : null; })
      .filter(x => x != null);
    // 插件: 1688 同款标记 (shadow 容器文本) + 跳转链接 (优先标签静态链接, 无则构造 1688 搜索链接)
    let is1688 = false;
    let is1688Url = null;
    const zy1688 = el.querySelector('.zying-1688tag-wrap, .zying-shadow-root');
    if (zy1688) {
      is1688 = (zy1688.textContent || '').includes('1688同款');
      if (is1688) {
        const lk1688 = zy1688.querySelector('a[href]');
        if (lk1688) is1688Url = lk1688.getAttribute('href') || null;
        if (!is1688Url) {
          // 兜底: 标签包裹容器上的 data-* 链接属性
          const wrap = el.querySelector('.zying-1688tag-wrap') || zy1688;
          if (wrap) { const d = wrap.getAttribute('data-url') || wrap.getAttribute('data-href') || wrap.getAttribute('href'); if (d) is1688Url = d; }
        }
      }
    }
    // 页面标识: Best Seller / Amazon's Choice / New Release / Deal / Overall Pick / Editor's Pick / Top Rated / 气候友好 / 小企业 / #1 Best Seller
    let badge = null;
    const detectBadge = (t) => {
      if (/Amazon's Choice/i.test(t)) return 'choice';
      if (/#1 Best Seller/i.test(t)) return 'bestseller1';
      if (/^Best Seller/i.test(t) || /Best Seller in/i.test(t)) return 'bestseller';
      if (/New Release/i.test(t)) return 'newrelease';
      if (/Deal of the Day/i.test(t)) return 'dealday';
      if (/Limited time deal/i.test(t)) return 'deal';
      if (/Overall Pick/i.test(t)) return 'overallpick';
      if (/Editor'?s Pick/i.test(t)) return 'editorspick';
      if (/Top Rated/i.test(t)) return 'toprated';
      if (/Climate Pledge Friendly/i.test(t)) return 'climate';
      if (/Small Business/i.test(t)) return 'smallbusiness';
      return null;
    };
    const bEl = el.querySelector('[id*="acBadge"], .ac-badge, [class*="badge"], img[alt*="Choice"], img[alt*="Bestseller"], [id*="bestseller"]');
    if (bEl) badge = detectBadge((bEl.textContent || bEl.getAttribute('alt') || '').trim().replace(/\\s+/g, ' '));
    if (!badge) badge = detectBadge((el.textContent || '').slice(0, 800));
    // ★ 修复(2026-09-24): 原生币种价格【列表页其实拿得到】—— 实测 .a-price .a-offscreen 就是 "$62.00"。
    //   原实现只匹配 人民币/CNY/¥, 而插件并没把列表价换成人民币 → price 与 priceCny 双 null, 白丢。
    //   现在: 是人民币就记 priceCny, 否则把数字当原生价记 price。
    let price = null, priceCny = null;
    const prEl = el.querySelector('.a-price .a-offscreen');
    if (prEl) {
      const pt = (prEl.textContent || '').trim();
      const mRmb = pt.match(/(?:人民币|CNY|¥)\\s*([\\d.,]+)/);
      if (mRmb) priceCny = parseFloat(mRmb[1].replace(/,/g, ''));
      else {
        const mNum = pt.match(/([\\d][\\d.,]*)/);
        if (mNum) { const n = parseFloat(mNum[1].replace(/,/g, '')); if (!isNaN(n) && n > 0) price = n; }
      }
    }
    // ★ 修复(2026-09-24): 卡片插件面板原文 —— 【类目名】和【品牌】只在这里。
    //   .ranktag 里只有数字(#4,856), 类目名在旁边的文本里; 面板排版:
    //   「... 品牌：LIFEBEA 登录 卖家： LIFEBEA FBA 店铺选品 #4,856 Home 榜单选品 #37 Sofa Slipcovers 榜单选品 ...」
    let panelTxt = '';
    (function () {
      const host = el.querySelector('[data-zying-main-append]') || el.querySelector('.zying-shadow-root');
      if (!host) return;
      // ★ 性能: innerText 会强制重排, 绝不能对每个节点调用 (曾因此让 60 张卡的提取超时 40s+)。
      //   先用轻量遍历只收集 shadowRoot, 读文本时只碰「宿主 + 各 shadowRoot」, 每张卡 ≤8 次。
      const roots = [];
      let budget = 400;
      const scan = function (n, d) {
        if (!n || d > 4 || budget <= 0 || roots.length > 6) return;
        budget--;
        let sr = null;
        try { sr = n.shadowRoot; } catch (e) {}
        if (sr) roots.push(sr);
        const ks = n.children || [];
        for (let i = 0; i < ks.length && i < 15; i++) scan(ks[i], d + 1);
      };
      scan(host, 0);
      const parts = [];
      try { if (host.innerText) parts.push(host.innerText); } catch (e) {}
      for (let i = 0; i < roots.length; i++) { try { if (roots[i].innerText) parts.push(roots[i].innerText); } catch (e) {} }
      panelTxt = parts.join(' ').replace(/\\s+/g, ' ').trim();
    })();
    let mShop = panelTxt.match(/店铺选品\\s*#\\s*([\\d,]+)\\s+(.+?)\\s*(?:榜单选品|店铺选品|$)/);
    // ★ 兜底: 部分卡片面板没有「店铺选品」标签, 排版是「卖家:4 #8,714 Home 榜单选品 #59 Sofa Slipcovers」
    //   实测 B0D2QVJ5S8 → 取「榜单选品」之前那个 #N 类目当宽类目 (否则宽类目覆盖只有 93%)
    if (!mShop) mShop = panelTxt.match(/#\\s*([\\d,]+)\\s+([A-Za-z][^#]{0,44}?)\\s*榜单选品/);
    const mCat = panelTxt.match(/榜单选品\\s*#\\s*([\\d,]+)\\s+(.+?)\\s*(?:榜单选品|店铺选品|$)/);
    const dg = function (s) { const v = parseInt(String(s).replace(/[.,]/g, ''), 10); return isNaN(v) ? null : v; };
    const nBsrShop = mShop ? dg(mShop[1]) : null;
    const nBsrShopCat = mShop ? String(mShop[2]).trim().slice(0, 45) : null;
    const nBsrCat = mCat ? dg(mCat[1]) : null;
    const nBsrCatName = mCat ? String(mCat[2]).trim().slice(0, 45) : null;
    const nRanks = [];
    if (nBsrShop != null) nRanks.push({ rank: nBsrShop, category: nBsrShopCat });
    if (nBsrCat != null && nBsrCat !== nBsrShop) nRanks.push({ rank: nBsrCat, category: nBsrCatName });
    // ★ 实测: 未登录时占位是「登录」, 登录后【同一个位置变成「正在加载...」】→ 正则终结符必须都覆盖,
    //   并且取值后再统一清洗一次 (曾把 brand 读成 "Smarcute 正在加载...")。
    const PH = '正在加载|正在分析|加载中|请登录|未登录|登录';
    const cleanVal = function (s) {
      return String(s == null ? '' : s)
        .replace(new RegExp('(' + PH + ')[.。…]*', 'g'), ' ')
        .replace(/\\s+/g, ' ').trim();
    };
    // ★ 登录后实测: 商标状态紧跟在品牌后面 → 「品牌：Smarcute 1个已注册 卖家： ...」。
    //   旧写法把品牌读成 "Smarcute 1个已注册" —— 改为先切【品牌段】(到 卖家/商品类型 为止),
    //   从中摘出商标数与状态, 剩下的才是品牌名。商标数/状态正好驱动「排除已备案 / 排除TM」筛选。
    const mBrandSeg = panelTxt.match(new RegExp('品牌[:：]\\\\s*([\\\\s\\\\S]*?)(?=卖家[:：]|商品类型|Size Name|Colour Name|$)'));
    const brandSeg = mBrandSeg ? mBrandSeg[1] : '';
    const TM_RE = '(\\\\d+)\\\\s*个\\\\s*(已注册|注册商标|TM|申请中|未查到)';
    const mTm = brandSeg.match(new RegExp(TM_RE));
    const panelTmCount = mTm ? parseInt(mTm[1], 10) : null;
    const panelTmStatus = mTm ? mTm[2] : null;
    const mPanelSeller = panelTxt.match(new RegExp('卖家[:：]\\\\s*([^\\\\s#][^#]{0,58}?)\\\\s*(?:FBA|FBM|AMZ|' + PH + '|卖家[:：]\\\\s*\\\\d|店铺选品|榜单选品|商品类型|Size Name|$)'));
    const mSellerCnt = panelTxt.match(/卖家[:：]\\s*(\\d+)/);
    const panelBrandV = cleanVal(brandSeg.replace(new RegExp(TM_RE, 'g'), ' ')).slice(0, 60);
    const panelSellerV = mPanelSeller ? cleanVal(mPanelSeller[1]).slice(0, 60) : '';
    const panelBrand = panelBrandV || null;
    const panelSeller = panelSellerV || null;
    // ★ 2026-09-24: 同上 —— 只认 token(含 AMZ 自营), 不再拿整段面板文本判 /FBA/ (会被「FBA费用」误判)
    const panelFulfill = (function () { const m = panelTxt.match(/卖家\\s*[:：]\\s*([^#]{0,40}?)\\s*(FBA|FBM|AMZ)\\b(?!\\s*费用)/); return m ? m[2].toUpperCase() : null; })();
    // ★ 登录后才渲染的两个字段 (未登录时显示"登录"): 月销 / 上架
    const mSales = panelTxt.match(/近30天销量[:：]\\s*([\\d,]+)/);
    const panelSales30d = (mSales && !new RegExp('^(' + PH + ')').test(mSales[1])) ? parseInt(mSales[1].replace(/[.,]/g, ''), 10) : null;
    const mUp = panelTxt.match(/上架[:：]\\s*(\\d{4}-\\d{2}-\\d{2})/);
    const panelListedAt = mUp ? mUp[1] : null;
    out.push({
      asin, title: title.slice(0, 250),
      link: lk.href,
      img: img ? (img.getAttribute('src') || img.getAttribute('data-src') || '') : null,
      rating: ratingEl ? (() => { const m = (ratingEl.textContent || '').match(/([\\d.,]+)\\s*out of/); return m ? parseFloat(m[1].replace(',', '.')) : null; })() : null,
      fulfill, sellerCount: sellerM ? parseInt(sellerM[1], 10) : null,
      bsr: rankList, ranks: nRanks,
      rankInfo: rankInfo,
      bsrShop: nBsrShop, bsrShopCat: nBsrShopCat, bsrCat: nBsrCat, bsrCatName: nBsrCatName,
      brand: panelBrand, seller: panelSeller, price: price, panelFulfill: panelFulfill,
      panelSellerCount: mSellerCnt ? parseInt(mSellerCnt[1], 10) : null,
      sales30d: (panelSales30d != null && !isNaN(panelSales30d)) ? panelSales30d : null,
      listedAt: panelListedAt,
      trademark: (panelTmCount != null ? { count: panelTmCount, status: panelTmStatus } : null),
      tmText: brandSeg ? brandSeg.trim().slice(0, 80) : null,
      is1688, is1688Url: is1688Url || (is1688 ? 'https://s.1688.com/selloffer/offer_search.htm?keywords=' + encodeURIComponent((title || '').slice(0, 60)) : null), priceCny, badge,
    });
  });
  return JSON.stringify(out);
})()`;

// ===== 列表页直采: 不跳详情页, 直接读列表页所有商品 + 智赢插件注入信息 (FBA/排名/卖家数/1688同款) =====
// 输入: 任意 amazon 列表页 URL (搜索 / 类目 / 店铺, 如 /s?k=Car+Accessories&i=automotive...)
// 插件数据说明: 智赢插件会把列表页价格替换为人民币并注入 FBA/排名/卖家数/1688 标签;
// 原生币种价格在列表页 DOM 中不可得 → price 入库为 null, 人民币价存 priceCny 仅作参考
async function cdpListDirectCollect(url, opts = {}) {
  const maxItems = Math.min(200, Math.max(1, opts.maxItems || 100));
  const maxPages = Math.min(10, Math.max(1, opts.maxPages || 1));   // 列表页翻页 (免手动跳转, 一次采多页)
  const waitPluginMs = Math.min(30000, Math.max(0, opts.waitPluginMs != null ? opts.waitPluginMs : 15000)); // 等插件分析渲染
  const siteMatch = url.match(/amazon\.(com\.au|co\.uk|com|com\.mx|com\.br|de|fr|it|es|co\.jp|ca|in|nl|se|pl)/);
  const site = siteMatch && CDP_SITE_CODE[siteMatch[1]] ? CDP_SITE_CODE[siteMatch[1]] : 'uk';
  const tabs = await cdpGetTabs();
  const page = tabs.find((t) => t.type === 'page' && t.url.includes('amazon')) || tabs.find((t) => t.type === 'page');
  if (!page) throw new Error('Edge 无可用页面标签, 请确认 Edge 以 --remote-debugging-port=9222 启动');
  const { send } = await cdpConnect(page.webSocketDebuggerUrl);

  // ① 导航到列表页 (首页) + 自动设置目标国家配送地址 (glow API)
  await send('Page.navigate', { url });
  await new Promise((r) => setTimeout(r, 9000));
  // ★ 修复(2026-09-24): cdpSetGlowAddress 在【地址真的变更生效】时会把页面导去站点首页
  //   (它注释里写"首页落地后再由调用方导航目标页", 但原代码 pg===1 时不再导航)
  //   → 结果在首页上跑 LIST_CARD_EXPR → div[data-asin]=0 → 误报"列表页未提取到商品"。
  //   实测触发: Edge 重启后配送地址丢失, 首次 list-direct 采集 42s 后 500。
  //   只在真的改了地址时才导航回来, 避免常态多等 9 秒。
  const glowChanged = await cdpSetGlowAddress(send, url, site);
  if (glowChanged) {
    console.log('[list-direct] glow 地址已变更, 重新导航回目标列表页');
    await send('Page.navigate', { url });
    await new Promise((r) => setTimeout(r, 9000));
  }

  // ② 翻页提取: 商品 DOM 服务端渲染 (当前页所有商品不滚动即存在), 完全无需滚动
  // 智赢插件数据 (FBA/排名/卖家数) 随时间自动分析 (约 12-15s), 滚动不增加覆盖 → 不滚动直接提取
  // 每页: 等待插件分析 → LIST_CARD_EXPR 提取 → 跨页去重
  const all = [];
  const seenAsin = new Set();
  for (let pg = 1; pg <= maxPages && all.length < maxItems; pg++) {
    if (collectStopRequested()) break;
    const pgUrl = pg === 1 ? url : (/\bpage=\d+/.test(url) ? url.replace(/\bpage=\d+/, 'page=' + pg) : url + (url.includes('?') ? '&' : '?') + 'page=' + pg);
    if (pg > 1) {
      await send('Page.navigate', { url: pgUrl });
      await new Promise((r) => setTimeout(r, 8000));
    }
    // 等待插件渲染数据 (分析商品需要时间, 默认 15s, 可调)
    await new Promise((r) => setTimeout(r, waitPluginMs));
    const r = await send('Runtime.evaluate', { expression: LIST_CARD_EXPR, returnByValue: true });
    let items = [];
    try { items = JSON.parse(r.result.value); } catch (e) { throw new Error('列表页解析失败: ' + e.message); }
    const fresh = items.filter((x) => !seenAsin.has(x.asin));
    fresh.forEach((x) => seenAsin.add(x.asin));
    all.push(...fresh);
    bumpCollectProgress({ step: '翻页采集', items: all.length, page: pg, pages: maxPages, rounds: pg });
    if (items.length < 16) break; // 无更多页
  }
  if (!all.length) throw new Error('列表页未提取到商品 (可能需登录或页面结构变化)');
  const list = all.slice(0, maxItems);
  const pagesDone = Math.min(maxPages, Math.max(1, Math.ceil(all.length / 16)));

  // ⑤ 入库: 新增 (source=cdp-list-direct); 已存在 → 仅更新插件字段, 不覆盖已有真实价格
  const used = new Set(products.map((x) => x.asin));
  let added = 0;
  let updatedCount = 0;
  const imported = [];
  for (const p of list) {
    // ★ 2026-09-25 结构化排名行覆盖(文本/.ranktag 的旧结果) + 未上榜三态
    if (p.rankInfo) {
      try {
        const rk = linksCollector.classifyRanks(p.rankInfo);
        if (rk.rankRows && rk.rankRows.length) {
          p.bsrShop = rk.bsrShop; p.bsrShopCat = rk.bsrShopCat;
          p.bsrCat = rk.bsrCat; p.bsrCatName = rk.bsrCatName;
          p.rankParentState = rk.rankParentState; p.rankChildState = rk.rankChildState;
          p.bsr = rk.rankRows.map((r) => r.rank).filter((n) => n != null);
          p.ranks = rk.rankRows.map((r) => ({ rank: r.rank, category: r.category || null }));
        }
      } catch (e) { /* 结构化读失败 → 保留旧字段, 不中断采集 */ }
    }
    delete p.rankInfo;
    const existing = products.find((x) => x.asin === p.asin);
    const summary = { asin: p.asin, title: (p.title || '').slice(0, 80), priceCny: p.priceCny, fulfill: p.fulfill, sellerCount: p.sellerCount, bsr: p.bsr, is1688: p.is1688, rating: p.rating };
    if (existing) {
      updatedCount++;
      if (p.fulfill) existing.fulfill = p.fulfill;
      if (p.sellerCount != null) existing.followCount = p.sellerCount;
      if (p.bsr && p.bsr.length) {
        existing.bsr = (p.ranks && p.ranks.length) ? p.ranks : p.bsr.map((rank) => ({ rank: rank, category: null }));
        if (p.bsrShop != null) existing.bsrShop = p.bsrShop;
        if (p.bsrShopCat) existing.bsrShopCat = p.bsrShopCat;
        if (p.bsrCat != null) existing.bsrCat = p.bsrCat;
        if (p.bsrCatName) existing.bsrCatName = p.bsrCatName;
        // ★ 结构化读法给出的三态: 有大排名→ok; 面板就绪但没有根类目行→not_listed(未上榜)
        if (p.rankParentState) { existing.rankParentState = p.rankParentState; if (p.rankParentState === 'not_listed') { existing.bsrShop = null; existing.bsrShopCat = null } }
        if (p.rankChildState) existing.rankChildState = p.rankChildState;
        // ★ 旧写法 Math.max(...p.bsr) 在数组为空时会写 '#-Infinity'/NaN —— 这里按"有值才算"处理
        const bs = (p.bsr || []).filter((v) => Number(v) > 0);
        existing.rank = bs.length ? '#' + Math.max.apply(null, bs) : (p.rankParentState === 'not_listed' ? null : existing.rank);
      }
      if (p.is1688) existing.is1688 = true;
      if (p.is1688Url && !existing.is1688Url) existing.is1688Url = p.is1688Url;
      if (!existing.mainImage && p.img) existing.mainImage = p.img;
      if (existing.priceCny == null && p.priceCny != null) existing.priceCny = p.priceCny;
      // ★ 自愈(2026-09-24): 旧代码写坏的数据在"已存在"分支永远不会被修 —— 因为原逻辑在这里就 continue 了。
      //   仅修【确实缺失/明显是占位值】的字段, 不覆盖用户/详情页采到的真实值。
      if (p.price != null && existing.price == null) existing.price = p.price;
      if (p.sales30d != null && existing.monthlySales == null) existing.monthlySales = p.sales30d;
      if (p.listedAt && !existing.listedAt) existing.listedAt = p.listedAt;
      // ★ 商标 (登录后才有): 只在库里还没有商标信息时补, 不覆盖已采到的
      if (p.trademark && !(existing.trademarkCount > 0)) {
        existing.trademarkCount = p.trademark.count || 0;
        existing.tmMark = /注册商标|TM/.test(String(p.trademark.status || ''));
        if (/已注册|已备案/.test(String(p.trademark.status || ''))) existing.brandStatus = 'registered';
        else if (/未查到/.test(String(p.trademark.status || ''))) existing.brandStatus = 'notfound';
      }
      if (p.brand && (!existing.brand || existing.brand === 'Unknown')) existing.brand = p.brand;
      if (p.seller && !existing.mainSeller) existing.mainSeller = p.seller;
      if (p.panelSellerCount != null && !(existing.followCount > 0)) existing.followCount = p.panelSellerCount;
      if (p.fulfill && !existing.fulfill) existing.fulfill = p.fulfill;
      // 占位类目 (历史脏数据) → 清空, 让下面的 applyRankFields/fillCatFromPanel 用真类目重填
      if (existing.cat1 === 'ListPage' || existing.cat1 === 'ListDirect' || existing.cat1 === 'ListFiltered') {
        existing.cat1 = null; existing.cat2 = null; existing.catPath = null; existing.catSrc = null;
      }
      if (existing.price != null && existing.referralFee == null) {
        existing.referralFee = Math.round(existing.price * (referralRateFor(existing.cat1).rate / 100) * 100) / 100;
      }
      products[products.indexOf(existing)] = applyRankFields(existing);   // 让类目兜底/变体键重算
      imported.push({ ...summary, status: 'updated' });
      continue;
    }
    used.add(p.asin);
    const item = {
      id: p.asin, asin: p.asin,
      rank: (function () { const rs = (p.ranks && p.ranks.length) ? p.ranks.map((r) => r.rank) : (p.bsr || []); return rs.length ? '#' + Math.max.apply(null, rs) : null; })(),
      title: p.title, brand: p.brand || null,
      // ★ 商标状态来自面板 (登录后才有): 驱动「排除已备案 / 排除TM」筛选 —— 以前这里恒为 unchecked/false/0, 等于筛不了
      brandStatus: (p.trademark ? (/已注册|已备案/.test(p.trademark.status) ? 'registered' : /未查到/.test(p.trademark.status) ? 'notfound' : 'unchecked') : 'unchecked'),
      bgMark: false,
      tmMark: p.trademark ? /注册商标|TM/.test(p.trademark.status) : false,
      patentRisk: false,
      trademarkCount: p.trademark ? (p.trademark.count || 0) : 0,
      followCount: p.sellerCount || 0, chinaSeller: chinaSellerOf(p), sellerCountryCode: sellerCountryCodeOf(p),
      // ★ 2026-09-24 P0-3c: 列表页读不到的一律 null —— 原为 fulfill||'FBM' / rating||4 / stock:0 /
      //   上架写"今天" (会让商品在新品筛选里假装今天上架) / 佣金净利写 0
      fulfill: p.fulfill || p.panelFulfill || null,
      // ★ 2026-09-24: AMZ 自营要落成 amazonSell=true —— 原为写死 null, 导致「仅 AMZ 自营/排除自营」筛选对面板判出的自营商品失效
      amazonSell: ((p.fulfill === 'AMZ') || (p.panelFulfill === 'AMZ')) ? true : null,
      mainSeller: p.seller || null,
      mainImage: p.img || null, offerPrices: null,
      price: p.price != null ? p.price : null, currency: siteCurrency(site),
      priceCny: p.priceCny || null,      // 人民币参考价 (插件把列表价换成人民币时才用)
      monthlySales: p.sales30d != null ? p.sales30d : null,
      reviews: null, rating: p.rating || null, stock: null,
      listedAt: p.listedAt || null,
      // ★ 类目: 用面板给的真类目名 (店铺选品→宽类目, 榜单选品→细类目); 拿不到就不写, 绝不写 'ListPage' 这种占位
      bsr: (p.ranks && p.ranks.length) ? p.ranks : (p.bsr || []).map((rank) => ({ rank: rank, category: null })),
      bsrShop: p.bsrShop != null ? p.bsrShop : null,
      bsrShopCat: p.bsrShopCat || null,
      bsrCat: p.bsrCat != null ? p.bsrCat : null,
      bsrCatName: p.bsrCatName || null,
      variations: 0, variants: null, referralFee: null, netProfit: null,
      site, category: 'ListDirect', collectedAt: now(), source: 'cdp-list-direct',
      saved: false, real: true, is1688: p.is1688 || false, is1688Url: p.is1688Url || null, badge: p.badge || null,
    };
    // ★ 价格拿到了 → 佣金按类目费率算 (netProfit 保持 null: 硬编码公式产物不可信)
    if (item.price != null) item.referralFee = Math.round(item.price * (referralRateFor(item.cat1).rate / 100) * 100) / 100;
    products.unshift(applyRankFields(item));
    added++;
    imported.push({ ...summary, status: 'added' });
  }
  if (added > 0 || updatedCount > 0) save('products.json', products);
  return { site, url, maxPages, pagesDone, total: all.length, productCount: list.length, added, products: imported };
}

// ===== 列表页筛选采集: 列表页直采(含插件信息) → 采集筛选前置过滤 → 只跳转通过筛选的商品取详情页数据 =====
// 流程: 列表页翻页提取(插件 FBA/排名/卖家数/1688) → preFilterByList 前置筛(可用字段) →
//       只对通过者跳详情页: cdpEnrichOne(价格/品牌/评分/评论/A+/配送/BSR/类目/主图) + 需要时 cdpReadOnePanel(商标/销量) + aod 跟卖 →
//       详情页 applyCollectFilter 完整筛(评分/评论/A+/商标/类目/价格) → 入库
async function cdpListFilteredCollect(url, opts = {}) {
  const maxItems = Math.min(200, Math.max(1, opts.maxItems || 100));
  const maxPages = Math.min(10, Math.max(1, opts.maxPages || 1));   // 列表页翻页上限
  const waitPluginMs = Math.min(30000, Math.max(0, opts.waitPluginMs != null ? opts.waitPluginMs : 15000));
  const filter = opts.filter || {};
  // 商标信息 (商标数/商标国家: "品牌已在如下国家注册") 来自详情页插件面板, 列表页无此数据
  // → 详情补全时默认读取插件面板 (panel=false 可关闭, 节省耗时); 设置了商标筛选时强制读取
  const needPanel = opts.panel !== false || !!((filter.tmMin != null) || (filter.tmMax != null) || filter.tmCountries);
  const withAod = opts.aod !== false;                               // 详情后采 aod 跟卖 (默认开)
  // ★ 2026-09 改造(统一不跳转): 默认【不跳详情页】。
  //   旧行为: 只对通过前置筛选的商品跳详情页(每个 8~15s) + 需要时再跳一次插件面板 + 再跳一次 aod 页 ——
  //   一个商品最多 3 次导航, 采集慢的主因。现在列表页能判的字段照旧筛, 详情页专属字段
  //   (价格/品牌/评分/评论/A+/类目/BSR) 与商标/月销改由商品管理页「补采」按需补齐。
  //   需要旧行为时显式传 jumpDetail=1。
  const jumpDetail = opts.jumpDetail === true || opts.jumpDetail === 1 || opts.jumpDetail === '1';
  const siteMatch = url.match(/amazon\.(com\.au|co\.uk|com|com\.mx|com\.br|de|fr|it|es|co\.jp|ca|in|nl|se|pl)/);
  const site = siteMatch && CDP_SITE_CODE[siteMatch[1]] ? CDP_SITE_CODE[siteMatch[1]] : 'uk';
  const host = 'www.amazon.' + siteToHostSuffix(site);
  const tabs = await cdpGetTabs();
  const page = tabs.find((t) => t.type === 'page' && t.url.includes('amazon')) || tabs.find((t) => t.type === 'page');
  if (!page) throw new Error('Edge 无可用页面标签, 请确认 Edge 以 --remote-debugging-port=9222 启动');
  const { send } = await cdpConnect(page.webSocketDebuggerUrl);

  // ① 列表页翻页提取 (全部商品 + 插件信息)
  const all = [];
  const seenAsin = new Set();
  await send('Page.navigate', { url });
  await new Promise((r) => setTimeout(r, 9000));
  await cdpSetGlowAddress(send, url, site);
  for (let pg = 1; pg <= maxPages && all.length < maxItems; pg++) {
    if (collectStopRequested()) break;
    const pgUrl = pg === 1 ? url : (/\bpage=\d+/.test(url) ? url.replace(/\bpage=\d+/, 'page=' + pg) : url + (url.includes('?') ? '&' : '?') + 'page=' + pg);
    await send('Page.navigate', { url: pgUrl });
    await new Promise((r) => setTimeout(r, 8000));
    // 商品 DOM 服务端渲染 (无需滚动), 等待插件分析后直接提取
    await new Promise((r) => setTimeout(r, waitPluginMs));
    const r = await send('Runtime.evaluate', { expression: LIST_CARD_EXPR, returnByValue: true });
    let items = [];
    try { items = JSON.parse(r.result.value); } catch (e) { throw new Error('列表页解析失败: ' + e.message); }
    const fresh = items.filter((x) => !seenAsin.has(x.asin));
    fresh.forEach((x) => seenAsin.add(x.asin));
    all.push(...fresh);
    bumpCollectProgress({ step: '列表页采集', items: all.length, page: pg, pages: maxPages, rounds: pg });
    if (items.length < 16) break; // 无更多页
  }
  if (!all.length) throw new Error('列表页未提取到商品 (可能需登录或页面结构变化)');
  const listAll = all.slice(0, maxItems);
  // 等插件分析 (翻页后最后一批卡片)
  await new Promise((r) => setTimeout(r, waitPluginMs));

  // ② 前置筛选: 只用列表页已有字段 (插件 FBA/排名/标题/站点), 无数据字段留给详情页
  const preKept = [];
  for (const it of listAll) {
    it.site = site;
    if (preFilterByList(it, filter)) preKept.push(it);
  }

  // ③ 只对通过前置筛选的商品跳详情页补全 (价格/品牌/评分/评论/A+/配送/BSR/类目/主图 [+商标 +aod跟卖])
  const enriched = [];
  for (const it of preKept) {
    if (collectStopRequested()) break;
    // ★ 统一不跳转 (默认): 用列表页已有字段判定后直接入队, 一次导航都不做。
    //   applyCollectFilter 对"未知字段"是放行语义(见上方 1201 行注释), 所以
    //   详情页专属条件(评分/评论/A+/商标/类目)不会把列表页筛不出数据的商品误杀。
    if (!jumpDetail) {
      it.__skip = !applyCollectFilter(it, filter);
      if (!it.__skip) enriched.push(it);
      continue;
    }
    try {
      // 插件配送标签 (智赢 API ShipByAmazon) 比 DOM 启发式判断可靠 — 详情补全后以插件标签为准
      const listFulfill = it.fulfill;
      await cdpEnrichOne(send, host, it, filter);   // 导航详情 + 原生字段 + __skip 完整筛选
      it.fulfill = listFulfill || it.fulfill;       // 插件标签优先; 仅当列表页无标签时采用详情页判断
      it.__skip = !applyCollectFilter(it, filter);  // fulfill 修正后重算筛选
      if (it.__skip) continue;
      if (needPanel) {
        const pd = await cdpReadOnePanel(send, it.asin, host.replace('www.amazon.', ''));
        if (pd && pd.error) console.warn('[list-filtered panel]', it.asin, '商标面板读取失败:', pd.error);
        if (pd && !pd.error) {
          if (pd.trademarkCount != null) it.trademarkCount = pd.trademarkCount;
          if (pd.tmCountries && pd.tmCountries.length) it.tmCountries = pd.tmCountries;
          if (pd.brand && !it.brand) it.brand = pd.brand;
          if (pd.tmText) it.tmText = pd.tmText;
          if (pd.fulfill) it.fulfill = pd.fulfill;
          if (pd.sellerCount != null) it.sellerCount = pd.sellerCount;
          if (pd.sales30d) it.sales30d = pd.sales30d;
          it.__skip = !applyCollectFilter(it, filter);   // 商标等补全后重新完整筛
          if (it.__skip) continue;
        }
      }
      if (withAod) {
        // aod 跟卖: 导航 aod 页读全部跟卖卖家 (价格/名称/ID/跳转链接/运费)
        try {
          await send('Page.navigate', { url: 'https://' + host + '/dp/' + it.asin + '/ref=olp-opf-redir?aod=1&ie=UTF8&condition=new' });
          await new Promise((r) => setTimeout(r, 8000));
          let offers = [];
          for (let k = 0; k < 8; k++) {
            await new Promise((r) => setTimeout(r, 2000));
            const ra = await send('Runtime.evaluate', {
              expression: `(() => {
                const list = document.querySelector('#aod-offer-list');
                if (!list) return JSON.stringify({ ready: false });
                const out = [];
                list.querySelectorAll('#aod-offer').forEach(o => {
                  let price = null;
                  const fullEl = o.querySelector('.apex-pricetopay-accessibility-label, .aod-offer-price .a-offscreen');
                  if (fullEl) { const m = fullEl.textContent.trim().match(/(?:€|£|\\$|¥|EUR|GBP|USD)\\s*([\\d.,]+)/); if (m) price = parseFloat(m[1].replace(/,/g, '')); }
                  if (price == null) { const w = o.querySelector('.a-price-whole'); if (w) { const v = parseFloat((w.textContent || '').replace(/[^\\d]/g, '')); if (!isNaN(v)) price = v; } }
                  let seller = null, sellerId = null, sellerUrl = null;
                  let sel = o.querySelector('a[href*="/gp/aag/main"], a[href*="aag/main?"]');
                  if (!sel) { const all = o.querySelectorAll('a[href*="seller="]'); for (const a of all) { const t = (a.textContent || '').trim(); if (t && !/^Details/i.test(t) && !/^More/i.test(t)) { sel = a; break; } } }
                  if (sel) {
                    const aria = sel.getAttribute('aria-label') || '';
                    const m2 = aria.match(/^([^.]+)/);
                    const raw = (m2 ? m2[1] : sel.textContent.trim()).trim();
                    if (raw && !/^Details/i.test(raw) && !/^More/i.test(raw)) seller = raw;
                    const hm = (sel.getAttribute('href') || '').match(/seller=([A-Z0-9]+)/);
                    if (hm) sellerId = hm[1];
                    const href = sel.getAttribute('href') || '';
                    if (href.includes('aag/main')) sellerUrl = href.startsWith('http') ? href : 'https://' + location.hostname + href;
                  }
                  let shipFee = null, shipDates = null;
                  const shipEl = o.querySelector('.aod-delivery-promise, #unified-delivery-message');
                  if (shipEl) { const ship = shipEl.textContent.trim().replace(/\\s+/g, ' ').slice(0, 80); const fm = ship.match(/(?:€|£|\\$)\\s*([\\d.,]+)/); if (fm) shipFee = parseFloat(fm[1].replace(/,/g, '')); const dm = ship.match(/(\\d{1,2})\\s*[-–]\\s*(\\d{1,2})\\s+([A-Za-zäöüß]+)/i); if (dm) shipDates = dm[1] + ' - ' + dm[2] + ' ' + dm[3]; }
                  out.push({ price, seller, sellerId, sellerUrl, shipFee, shipDates });
                });
                return JSON.stringify({ ready: out.length > 0, offers: out });
              })()`, returnByValue: true,
            });
            const da = JSON.parse(ra.result.value);
            if (da.ready) { offers = da.offers; break; }
          }
          if (offers.length) {
            const dedup = new Map();
            offers.forEach((o) => { const k = o.sellerId ? 'id:' + o.sellerId : 'n:' + (o.seller || '') + '|' + (o.price != null ? o.price : ''); if (!dedup.has(k) || (o.price != null && (dedup.get(k).price == null || o.price < dedup.get(k).price))) dedup.set(k, o); });
            const uniq = [...dedup.values()];
            const nums = uniq.map((o) => o.price).filter((x) => x != null);
            it.offerPrices = uniq;
            it.followCount = uniq.length;
            const minP = nums.length ? Math.min(...nums) : null;
            if (minP != null && (it.minPrice == null || minP < it.minPrice)) it.minPrice = minP;
          }
        } catch (e) { console.error('[list-filtered aod]', it.asin, '跟卖采集失败:', e && e.message); }
      }
      enriched.push(it);
    } catch (e) {
      console.error('[list-filtered enrich]', it.asin, '详情补全异常:', e && e.message);
    }
  }

  // ④ 入库: 新增 (source=cdp-list-filtered); 已存在 → 更新详情字段 (保留列表页插件字段)
  const used = new Set(products.map((x) => x.asin));
  let added = 0;
  let updatedCount = 0;
  const imported = [];
  for (const p of enriched) {
    // ★ 2026-09-25 结构化排名行覆盖(文本/.ranktag 旧结果会把子类目数字当大排名) + 未上榜三态
    if (p.rankInfo) {
      try {
        const rk = linksCollector.classifyRanks(p.rankInfo);
        if (rk.rankRows && rk.rankRows.length) {
          p.bsrShop = rk.bsrShop; p.bsrShopCat = rk.bsrShopCat;
          p.bsrCat = rk.bsrCat; p.bsrCatName = rk.bsrCatName;
          p.rankParentState = rk.rankParentState; p.rankChildState = rk.rankChildState;
          p.bsr = rk.rankRows.map((r) => ({ rank: r.rank, category: r.category || null }));
        }
      } catch (e) { /* 结构化读失败 → 保留旧字段, 不中断采集 */ }
    }
    delete p.rankInfo;
    const existing = products.find((x) => x.asin === p.asin);
    const summary = { asin: p.asin, title: (p.title || '').slice(0, 80), price: p.price, fulfill: p.fulfill, sellerCount: p.sellerCount || p.followCount, bsr: p.bsr ? p.bsr.map((b) => b.rank) : null, is1688: p.is1688, rating: p.rating, reviews: p.reviews, followCount: p.followCount, priceCny: p.priceCny, trademarkCount: p.trademarkCount, tmText: p.tmText || null, tmCountries: p.tmCountries || [] };
    if (existing) {
      updatedCount++;
      if (p.price != null) existing.price = p.price;
      if (p.brand) existing.brand = p.brand;
      if (p.rating != null) existing.rating = p.rating;
      if (p.reviews != null) existing.reviews = p.reviews;
      if (p.fulfill) existing.fulfill = p.fulfill;
      if (p.bsr && p.bsr.length) { existing.bsr = p.bsr; existing.rank = '#' + Math.max(...p.bsr.map((b) => b.rank)); }
      // ★ 结构化读法的三态: 有大排名→ok; 面板就绪却没有根类目行→not_listed(未上榜, 不是没采到)
      if (p.rankParentState) { existing.rankParentState = p.rankParentState; if (p.rankParentState === 'not_listed') { existing.bsrShop = null; existing.bsrShopCat = null } }
      if (p.rankChildState) existing.rankChildState = p.rankChildState;
      if (p.bsrShop != null) existing.bsrShop = p.bsrShop;
      if (p.bsrShopCat) existing.bsrShopCat = p.bsrShopCat;
      if (p.bsrCat != null) existing.bsrCat = p.bsrCat;
      if (p.bsrCatName) existing.bsrCatName = p.bsrCatName;
      if (p.category) existing.category = p.category;
      if (p.aplus) existing.aplus = true;
      if (p.mainImage) existing.mainImage = p.mainImage;
      if (p.trademarkCount != null && p.trademarkCount > 0) existing.trademarkCount = p.trademarkCount;
      if (p.tmCountries && p.tmCountries.length) existing.tmCountries = p.tmCountries;
      if (p.offerPrices && p.offerPrices.length) { existing.offerPrices = p.offerPrices; existing.followCount = p.followCount || p.offerPrices.length; if (p.minPrice != null) existing.minPrice = p.minPrice; }
      if (p.is1688) existing.is1688 = true;
      if (p.is1688Url && !existing.is1688Url) existing.is1688Url = p.is1688Url;
      // ★ 2026-09-25 必须重算: 否则 rankParent/rankChild 会留着上一轮的旧值(实测 bsrShop 已清成 null,
      //   但界面上的"父类排名"还显示旧数字)。applyRankFields 会把三态一起归一化。
      products[products.indexOf(existing)] = applyRankFields(existing);
      imported.push({ ...summary, status: 'updated' });
      continue;
    }
    used.add(p.asin);
    const price = p.price != null ? p.price : null;
    const item = {
      id: p.asin, asin: p.asin,
      // ★ 原写法 p.bsr.map((b) => b.rank) 把【数字数组】当对象数组 → Math.max(undefined) = NaN; 一并修正
      rank: (function () { const rs = (p.ranks && p.ranks.length) ? p.ranks.map((r) => r.rank) : (p.bsr || []).map((b) => (b && b.rank != null ? b.rank : b)).filter((v) => typeof v === 'number'); return rs.length ? '#' + Math.max.apply(null, rs) : null; })(),
      title: p.title, brand: p.brand || null, brandStatus: 'unchecked',
      bgMark: false, tmMark: false, patentRisk: false,
      trademarkCount: p.trademarkCount || 0, tmCountries: p.tmCountries || [], tmText: p.tmText || null,
      followCount: p.followCount || p.sellerCount || 0, chinaSeller: chinaSellerOf(p), sellerCountryCode: sellerCountryCodeOf(p),
      // ★ 2026-09-24 P0-3c: 未知一律 null (原为 fulfill||'FBM' / rating||4 / 上架写"今天" / 佣金净利写 0)
      fulfill: p.fulfill || null, amazonSell: p.amazonSell != null ? !!p.amazonSell : null, mainSeller: p.mainSeller || null,
      mainImage: p.mainImage || p.img || null,
      offerPrices: p.offerPrices || null, minPrice: p.minPrice != null ? p.minPrice : price,
      price, currency: siteCurrency(site),
      priceCny: p.priceCny || null,
      monthlySales: p.sales30d ? (parseInt(String(p.sales30d).replace(/[<>\s]/g, ''), 10) || null) : null,
      reviews: p.reviews != null ? p.reviews : null, rating: p.rating || null, stock: null,
      listedAt: p.listedAt || null,
      bsr: (p.ranks && p.ranks.length) ? p.ranks : (p.bsr || []).map((rank) => ({ rank: rank, category: null })),
      bsrShop: p.bsrShop != null ? p.bsrShop : null, bsrShopCat: p.bsrShopCat || null,
      bsrCat: p.bsrCat != null ? p.bsrCat : null, bsrCatName: p.bsrCatName || null,
      variations: 0, variants: null,
      referralFee: price != null ? Math.round(price * 0.15 * 100) / 100 : null,
      netProfit: price != null ? Math.round((price - price * 0.15 - 3.2 - price * 0.3) * 100) / 100 : null,
      site, category: p.category || 'ListFiltered', collectedAt: now(), source: 'cdp-list-filtered',
      saved: false, real: true, is1688: p.is1688 || false, is1688Url: p.is1688Url || null, badge: p.badge || null,
    };
    // ★ 价格拿到了 → 佣金按类目费率算 (netProfit 保持 null: 硬编码公式产物不可信)
    if (item.price != null) item.referralFee = Math.round(item.price * (referralRateFor(item.cat1).rate / 100) * 100) / 100;
    products.unshift(applyRankFields(item));
    added++;
    imported.push({ ...summary, status: 'added' });
  }
  if (added > 0 || updatedCount > 0) save('products.json', products);
  const enrichedCount = enriched.length;
  return {
    site, url, total: listAll.length, preFiltered: preKept.length, enriched: enrichedCount,
    finalKept: enrichedCount, added, productCount: enrichedCount,
    skippedByList: listAll.length - preKept.length,
    products: imported,
  };
}

async function cdpCategoryCollect(opts) {
  const site = opts.site || 'de';
  const keyword = (opts.keyword || '').trim();
  const category = (opts.category || '').trim();
  const maxPages = Math.min(10, Math.max(1, opts.maxPages || 2));
  const host = 'www.amazon.' + siteToHostSuffix(site);
  // 搜索 URL: 关键词搜索 或 类目浏览
  let url;
  if (keyword) {
    url = `https://${host}/s?k=${encodeURIComponent(keyword)}&i=${encodeURIComponent(category)}`;
  } else if (category) {
    const slug = category.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    url = `https://${host}/s?k=${encodeURIComponent(slug)}`;
  } else {
    throw new Error('请输入关键词或类目');
  }
  const tabs = await cdpGetTabs();
  const page = tabs.find((t) => t.type === 'page' && t.url.includes('amazon')) || tabs.find((t) => t.type === 'page');
  if (!page) throw new Error('Edge 无可用页面标签, 请确认 Edge 以 --remote-debugging-port=9222 启动');
  const { send } = await cdpConnect(page.webSocketDebuggerUrl);
  await send('Runtime.enable');

  const products = [];
  const seen = new Set();
  for (let pg = 1; pg <= maxPages; pg++) {
    if (collectStopRequested()) break;
    const pgUrl = pg === 1 ? url : url + (url.includes('?') ? '&' : '?') + 'page=' + pg;
    await send('Page.navigate', { url: pgUrl });
    await new Promise((r) => setTimeout(r, 8000));
    for (let i = 0; i < 4; i++) { await send('Runtime.evaluate', { expression: `window.scrollTo(0, ${(i + 1) * 4000})` }); await new Promise((r) => setTimeout(r, 900)); }
    await new Promise((r) => setTimeout(r, 1200));
    const r = await send('Runtime.evaluate', {
      expression: `(() => {
        const out = [];
        document.querySelectorAll('div[data-asin]').forEach(el => {
          const asin = el.getAttribute('data-asin');
          if (!asin || !/^[A-Z0-9]{10}$/.test(asin) || !el.querySelector('a[href*="/dp/"]')) return;
          const t = el.querySelector('h2 span, h2');
          const pr = el.querySelector('.a-price .a-offscreen');
          const lk = el.querySelector('a[href*="/dp/"]');
          let badge = null;
          const detectBadge = (tb) => {
            if (/Amazon's Choice/i.test(tb)) return 'choice';
            if (/#1 Best Seller/i.test(tb)) return 'bestseller1';
            if (/^Best Seller/i.test(tb) || /Best Seller in/i.test(tb)) return 'bestseller';
            if (/New Release/i.test(tb)) return 'newrelease';
            if (/Deal of the Day/i.test(tb)) return 'dealday';
            if (/Limited time deal/i.test(tb)) return 'deal';
            if (/Overall Pick/i.test(tb)) return 'overallpick';
            if (/Editor'?s Pick/i.test(tb)) return 'editorspick';
            if (/Top Rated/i.test(tb)) return 'toprated';
            if (/Climate Pledge Friendly/i.test(tb)) return 'climate';
            if (/Small Business/i.test(tb)) return 'smallbusiness';
            return null;
          };
          const bEl = el.querySelector('[id*="acBadge"], .ac-badge, [class*="badge"], img[alt*="Choice"], img[alt*="Bestseller"], [id*="bestseller"]');
          if (bEl) badge = detectBadge((bEl.textContent || bEl.getAttribute('alt') || '').trim().replace(/\\s+/g, ' '));
          if (!badge) badge = detectBadge((el.textContent || '').slice(0, 800));
          // 插件排名标签 (#13 / #1 / #28 ...)
          const rankList = [...el.querySelectorAll('.ranktag')]
            .map(x => (x.textContent || '').trim())
            .map(x => { const rm = x.match(/#?([\\d.,]+)/); return rm ? parseInt(rm[1].replace(/[.,]/g, ''), 10) : null; })
            .filter(x => x != null);
          out.push({ asin, title: t ? t.textContent.trim().slice(0, 150) : '', price: pr ? pr.textContent.trim() : '', link: lk ? lk.href : '', badge, bsr: rankList });
        });
        return JSON.stringify(out);
      })()`, returnByValue: true,
    });
    let items = [];
    try { items = JSON.parse(r.result.value); } catch {}
    normalizeListCards(items);   // ★ 统一不跳转: 评分/评论归一化 + 卡片插件面板就地解析 (商标/月销/排名)
    const fresh = items.filter((x) => !seen.has(x.asin));
    fresh.forEach((x) => seen.add(x.asin));
    products.push(...fresh.map(applyRankFields));
    bumpCollectProgress({ step: '翻页采集', items: products.length, page: pg, pages: maxPages });
    if (items.length < 16) break;
  }
  // ===== 采集过滤: 与自定义筛选同条件, 被筛除的商品直接跳过不采集 =====
  const filter = opts.filter || {};
  const before = products.length;
  const hasFilter = Object.keys(filter).length > 0;
  // 关键: 没有过滤条件时也要读详情页 —— 否则主图/真实类目/配送/自营/评分/币种全缺 (旧逻辑只在有过滤条件时才补全)
  // ★ 2026-09 改造(统一不跳转): 旧行为 `filterNeedsDetail(filter) || !hasFilter` 里那个 `!hasFilter`
  //   意味着"没设筛选条件时也要逐个商品跳详情页", 是最容易被忽略的一条跳转路径。
  //   现在这些字段由「补采」按需补, 所以默认不跳; 需要旧行为时显式传 detail=1。
  if (products.length) {
    const needDetail = opts.detail === true && (filterNeedsDetail(filter) || !hasFilter);
    if (needDetail) {
      // 预筛: 先判不需要详情的条件 (价格/关键词/标签/1688), 只对幸存者读详情, 减少耗时
      const pre = {};
      if (filter.q) pre.q = filter.q;
      if (filter.badges && filter.badges.length) pre.badges = filter.badges;
      if (filter.is1688 != null) pre.is1688 = filter.is1688;
      if (filter.priceMin != null) pre.priceMin = filter.priceMin;
      if (filter.priceMax != null) pre.priceMax = filter.priceMax;
      products.forEach((it) => { it.__skip = !applyCollectFilter(it, pre); });
      const ENRICH_CAP = 80;                       // 单次上限: 详情页约 8 秒/个, 防止一轮跑太久
      let enriched = 0;
      for (const it of products) {
        if (it.__skip) continue;
        if (collectStopRequested()) break;
        if (enriched >= ENRICH_CAP) break;
        bumpCollectProgress({ step: '详情页补全 ' + it.asin + ' (' + (enriched + 1) + '/' + Math.min(products.length, ENRICH_CAP) + ')', items: products.length });
        await cdpEnrichOne(send, host, it, filter);
        enriched++;
      }
      // 详情补全后按完整条件重新判定 (列表页缺字段时无法判的条件此时才有数据)
      if (hasFilter) products.forEach((it) => { if (!it.__skip) it.__skip = !applyCollectFilter(it, filter); });
    } else {
      products.forEach((it) => { it.__skip = !applyCollectFilter(it, filter); });
    }
    const kept = products.filter((x) => !x.__skip);
    products.length = 0;
    products.push(...kept.map(applyRankFields));
  }
  return { site, url, products, skipped: before - products.length };
}

// ===== 并行整站采集: 一次并行打开 N 个搜索页, 每页抓一页, 聚合去重 (不翻页, 耗时≈单页加载) =====
// 输入: keyword 关键词 或 category 类目; pages 并行页数 (每页约16-48个); 可对每个商品快速读详情价/品牌
async function cdpSiteBulkCollect(opts = {}) {
  const site = opts.site || 'de';
  const keyword = (opts.keyword || '').trim();
  const category = (opts.category || '').trim();
  const pages = Math.min(10, Math.max(1, opts.pages || 5));     // 并行打开页数 (第1页 ~ 第N页)
  const maxItems = Math.min(100, Math.max(1, opts.maxItems || 50));
  const filter = opts.filter || {};                             // 采集过滤: 与自定义筛选同条件
  // 过滤条件需要详情字段(配送/A+/排名/评分/类目等)时强制开详情, 否则无法判断是否满足
  const needDetail = filterNeedsDetail(filter);
  // ★ 2026-09 改造(统一不跳转): 旧写法 `opts.detail !== false || needDetail` 默认开, 且筛选含详情字段时强制开。
  //   现在默认关(含详情字段的筛选改由「补采」后判定), 需要旧行为时显式传 detail=1。
  const withDetail = opts.detail === true;
  const host = 'www.amazon.' + siteToHostSuffix(site);
  let base;
  if (keyword) base = 'https://' + host + '/s?k=' + encodeURIComponent(keyword) + (category ? '&i=' + encodeURIComponent(category) : '');
  else if (category) base = 'https://' + host + '/s?k=' + encodeURIComponent(category.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
  else throw new Error('请输入关键词或类目');

  // 并行开 N 个标签页, 每页抓一页搜索结果
  const tabs = [];
  const jobs = [];
  for (let pg = 1; pg <= pages; pg++) {
    if (collectStopRequested()) break;
    jobs.push((async () => {
      let tab = null;
      try {
        tab = await cdpCreateTab('https://' + host + '/');
        const { send } = await cdpConnect(tab.wsUrl);
        const pgUrl = pg === 1 ? base : base + (base.includes('?') ? '&' : '?') + 'page=' + pg;
        await send('Page.navigate', { url: pgUrl });
        await new Promise((r) => setTimeout(r, 9000));
        for (let i = 0; i < 4; i++) { await send('Runtime.evaluate', { expression: `window.scrollTo(0, ${(i + 1) * 4000})` }); await new Promise((r) => setTimeout(r, 800)); }
        await new Promise((r) => setTimeout(r, 1000));
        const r = await send('Runtime.evaluate', {
          expression: `(() => {
            const out = [];
            document.querySelectorAll('div[data-asin]').forEach(el => {
              const asin = el.getAttribute('data-asin');
              if (!asin || !/^[A-Z0-9]{10}$/.test(asin) || !el.querySelector('a[href*="/dp/"]')) return;
              const t = el.querySelector('h2 span, h2');
              const pr = el.querySelector('.a-price .a-offscreen, .a-price-whole');
              const lk = el.querySelector('a[href*="/dp/"]');
              const rt = el.querySelector('.a-icon-alt');
              // 标签: A+/Best Seller/Amazon's Choice/New Release/Deal/Overall Pick/Editor's Pick/Top Rated/气候友好/小企业/#1 Best Seller
              let badge = null;
              const b = el.querySelector('[id*="acBadge"], .ac-badge, [class*="badge"], img[alt*="Choice"], img[alt*="Bestseller"], [id*="bestseller"]');
              const detectBadge = (t) => {
                if (/Amazon's Choice/i.test(t)) return 'choice';
                if (/#1 Best Seller/i.test(t)) return 'bestseller1';
                if (/^Best Seller/i.test(t) || /Best Seller in/i.test(t)) return 'bestseller';
                if (/New Release/i.test(t)) return 'newrelease';
                if (/Deal of the Day/i.test(t)) return 'dealday';
                if (/Limited time deal/i.test(t)) return 'deal';
                if (/Overall Pick/i.test(t)) return 'overallpick';
                if (/Editor'?s Pick/i.test(t)) return 'editorspick';
                if (/Top Rated/i.test(t)) return 'toprated';
                if (/Climate Pledge Friendly/i.test(t)) return 'climate';
                if (/Small Business/i.test(t)) return 'smallbusiness';
                return null;
              };
              if (b) {
                const bt = (b.textContent || b.getAttribute('alt') || '').trim().replace(/\\s+/g, ' ');
                badge = detectBadge(bt);
              }
              if (!badge) {
                const txt = (el.textContent || '').slice(0, 800);
                badge = detectBadge(txt);
              }
              // 插件排名标签
              const rankList = [...el.querySelectorAll('.ranktag')]
                .map(x => (x.textContent || '').trim())
                .map(x => { const rm = x.match(/#?([\\d.,]+)/); return rm ? parseInt(rm[1].replace(/[.,]/g, ''), 10) : null; })
                .filter(x => x != null);
              // ★ 2026-09 统一不跳转: 详情补全默认关 → 卡片上本来就有的字段必须就地取全
              const _cfReviews2 = el.querySelector('a[aria-label*="ratings"], .a-size-base.s-underline-text');
              const _cfImg2 = el.querySelector('img.s-image');
              let _cfBrand2 = null;
              el.querySelectorAll('a[href*="field-keywords="]').forEach((a) => { if (_cfBrand2) return; const _t3 = (a.textContent || '').trim(); if (_t3 && _t3.length < 60) _cfBrand2 = _t3; });
              let _cfPanel2 = '';
              el.querySelectorAll('[class*="zying"], [class*="zy-"], [id*="zying"]').forEach((n) => {
                const _p3 = (n.innerText || n.textContent || '').replace(/\\s+/g, ' ').trim();
                if (/ASIN\\s*[:：]/.test(_p3) && _p3.length > _cfPanel2.length) _cfPanel2 = _p3;
              });
              out.push({ asin, title: t ? t.textContent.trim().slice(0, 200) : '', price: pr ? pr.textContent.trim() : '', link: lk ? lk.href : '', rating: rt ? rt.textContent.trim().slice(0, 20) : '', badge, bsr: rankList,
                reviews: _cfReviews2 ? (_cfReviews2.textContent || '').trim().slice(0, 20) : null,
                mainImage: _cfImg2 ? _cfImg2.getAttribute('src') : null, brand: _cfBrand2, panelTxt: _cfPanel2 || null });
            });
            return JSON.stringify(out);
          })()`, returnByValue: true,
        });
        let items = [];
        try { items = JSON.parse(r.result.value); } catch {}
        normalizeListCards(items);   // ★ 统一不跳转: 卡片字段归一化 + 插件面板就地解析 (商标/月销/排名)
        return { pg, items };
      } catch (e) {
        return { pg, items: [], error: e.message };
      } finally {
        if (tab) { try { await cdpCloseTab(tab.targetId); } catch {} }
      }
    })());
  }
  const settled = await Promise.allSettled(jobs);
  const seen = new Set();
  const products = [];
  settled.forEach((st) => {
    if (st.status !== 'fulfilled' || !st.value) return;
    (st.value.items || []).forEach((x) => {
      if (!x.asin || seen.has(x.asin)) return;
      seen.add(x.asin);
      products.push(applyRankFields(x));
    });
  });
  bumpCollectProgress({ step: '并行抓取完成', items: products.length });
  // 可选: 对前 maxItems 个商品读详情 (价格/品牌) — 串行, 每个约8秒; 同时做采集过滤
  if (withDetail && products.length) {
    const detail = await cdpGetTabs().then((tabs2) => {
      const page = tabs2.find((t) => t.type === 'page' && /amazon\.(com\.au|co\.uk|com|com\.mx|com\.br|de|fr|it|es|co\.jp|ca|in|nl|se|pl)/.test(t.url)) || tabs2.find((t) => t.type === 'page');
      return page ? cdpConnect(page.webSocketDebuggerUrl) : null;
    });
    if (detail) {
      const { send } = detail;
      for (let i = 0; i < Math.min(maxItems, products.length); i++) {
        await cdpEnrichOne(send, host, products[i], filter);
        bumpCollectProgress({ step: '读详情', items: products.length, detailDone: i + 1 });
      }
    } else if (Object.keys(filter).length) {
      // 无可用标签连接: 仅按列表字段过滤 (价格/关键词/标签)
      products.slice(0, maxItems).forEach((it) => { it.__skip = !applyCollectFilter(it, filter); });
    }
  } else if (Object.keys(filter).length) {
    // 未开详情: 仅按列表字段过滤 (价格/关键词/标签)
    products.slice(0, maxItems).forEach((it) => { it.__skip = !applyCollectFilter(it, filter); });
  }
  // 采集过滤: 被筛除的商品直接跳过 (不采集/不入库)
  const processed = products.slice(0, maxItems);
  const kept = processed.filter((x) => !x.__skip);
  return { site, host, url: base, pages, productCount: kept.length, products: kept, skipped: processed.length - kept.length };
}

// ===== 详情页核心字段提取 (单一实现: 卖家/配送/自营/A+/主图/币种符号) =====
// 提取器版本号: 提取逻辑变更时 +1 → 旧版本写入的字段视为"未验证", 详情修复会整体重判 (含清空猜值)
const DETAIL_VER = 2;
// 所有读取商品详情页的路径 (采集补全 cdpEnrichOne / 跟卖店铺链 fixDetail / 详情修复) 共用此段,
// 避免多份实现各写一套正则导致同一商品读出不同结果。
// 要点:
//   ① 卖家/配送只看 BuyBox 主报价区 (#merchant-info / #tabular-buybox / #buybox) — 全文含其他卖家报价区文案, 会误判
//   ② Amazon 家族卖家 (Amazon / Amazon AU / Amazon.com.au / Amazon Resale / Amazon Warehouse / Amazon Renewed) = 自营
//   ③ 配送: 发货方 Amazon → FBA; 主报价区已渲染且非 Amazon 发货 → FBM; 区域缺失 → null (未知, 绝不猜)
//   ④ 主图: 优先 Amazon 官方 data-old-hires, 否则按图片 ID 重建 _AC_SL1500_ (列表页缩略图后缀链不可靠)
// 约定: 局部变量一律 _ 前缀; 结果写入调用方已声明的 out 对象
const DETAIL_CORE_JS = `
      const _norm = (s) => String(s || '').replace(/[\\u00a0\\u2007\\u202f]/g, ' ').replace(/\\s+/g, ' ').trim();
      const _q = (s) => document.querySelector(s);
      // 取文本时剔除 script/style 内容 (BuyBox 区含 Amazon 内联脚本, 直接 textContent 会污染判定文本)
      const _txtOf = (el) => {
        if (!el) return '';
        try { const c = el.cloneNode(true); c.querySelectorAll('script,style,noscript').forEach((n) => n.remove()); return _norm(c.textContent); }
        catch (e) { return _norm(el.textContent); }
      };
      const _mi = _q('#merchant-info');
      const _ff = _q('#fulfillerInfoFeature_feature_div');
      const _tb = _q('#tabular-buybox');
      const _bb = _q('#buybox, #desktop_buybox, #addToCart_feature_div');
      // 条件性退换货文案含 "when fulfilled by Amazon AU" 不等于"当前是 FBA" — 必须剔除, 否则误判 FBA
      const _stripBoiler = (s) => String(s || '').split(/(?<=[.!?])\\s+/).filter((x) => !/when fulfilled by|qualifies for|in accordance with|if (?:the )?item is (?:sold|fulfilled)/i.test(x)).join(' ');
      const _region = _stripBoiler([_mi, _ff, _tb, _bb].map(_txtOf).filter(Boolean).join(' | '));
      // 句子级卖家/配送信号: AU 等站点把 "Ships from and sold by Amazon AU." 放在无 id 的 span 里
      const _sentSel = '#merchant-info span, #tabular-buybox .tabular-buybox-text, #buybox span, #desktop_buybox span, #addToCart_feature_div span, #fulfillerInfoFeature_feature_div span, span.a-size-base.a-color-secondary, span.a-color-secondary';
      const _shipsent = [];
      try {
        [...document.querySelectorAll(_sentSel)].forEach((e) => {
          if (e.children.length > 1) return;
          const _t = _stripBoiler(_norm(e.textContent));
          if (!_t || _t.length > 120) return;
          if (/(?:Ships from and sold by|Dispatched from and sold by|Sold by|Verkauf und Versand durch)\\s/i.test(_t)) _shipsent.push(_t);
        });
      } catch (e) { /* 选择器异常忽略 */ }
      out.shipSent = _shipsent.slice(0, 3).join(' ~ ').slice(0, 200);
      // 句子 → { seller, fulfill, amazonSell } (最高置信度, 优先于区域文本)
      const _amzRe = /^(?:amazon|亚马逊)(?:[\\s.]|$)|amazon\\.(?:com|co\\.uk|de|fr|it|es|nl|se|pl|co\\.jp|ca|in|com\\.au|com\\.mx|com\\.br|sg|com\\.tr|ae|sa)/i;
      const _isAmz = (n) => !!n && _amzRe.test(n);
      // 卖家名清洗 (去掉标题词/退货文案/附加说明, 限长) — 句子解析也复用它
      const _cleanSeller = (s) => {
        let v = _norm(s).replace(/^(?:Sold by|Verkauf und Versand durch|出售方|卖家)\\s*:?\\s*/i, '');
        v = v.split(/\\s+(?:Sold by|Returns|Returnable|Dispatched|Ships|Fulfilled|Verkauf|Versand|R\\u00fcckgabe|FREE|Amazon Prime)\\b/i)[0];
        v = v.split(/\\s+and\\s+(?:sent from|shipped|dispatched|delivered|Fulfilled by|sold by)|\\s+und\\s+(?:Versand|Lieferung)/i)[0];
        v = v.replace(/[.,;:]+$/, '').trim();
        return (v && v.length >= 2 && v.length <= 40) ? v : null;
      };
      let _fromSent = null;
      for (const _s of _shipsent) {
        let _m = _s.match(/Ships from and sold by\\s+(.+?)\\.?$/i);
        if (_m) { const n = _cleanSeller(_m[1]) || _norm(_m[1]).slice(0, 40); _fromSent = { seller: n, fulfill: _isAmz(n) ? 'FBA' : 'FBM', amazonSell: _isAmz(n) }; break; }
        _m = _s.match(/Sold by\\s+(.+?)\\s+and\\s+Fulfilled by Amazon/i);
        if (_m) { const n = _cleanSeller(_m[1]) || _norm(_m[1]).slice(0, 40); _fromSent = { seller: n, fulfill: 'FBA', amazonSell: _isAmz(n) }; break; }
        _m = _s.match(/Dispatched from and sold by\\s+(.+?)\\.?$/i);
        if (_m) { const n = _cleanSeller(_m[1]) || _norm(_m[1]).slice(0, 40); _fromSent = { seller: n, fulfill: _isAmz(n) ? 'FBA' : 'FBM', amazonSell: _isAmz(n) }; break; }
        _m = _s.match(/Verkauf und Versand durch\\s+(.+?)\\.?$/i);
        if (_m) { const n = _cleanSeller(_m[1]) || _norm(_m[1]).slice(0, 40); _fromSent = { seller: n, fulfill: _isAmz(n) ? 'FBA' : 'FBM', amazonSell: _isAmz(n) }; break; }
        _m = _s.match(/Sold by\\s*:?\\s+(.+?)\\.?$/i);
        if (_m) { const n = _cleanSeller(_m[1]); if (!n) continue; _fromSent = { seller: n, fulfill: null, amazonSell: _isAmz(n) }; break; }
      }
      out.regionText = (_fromSent ? ('[句] ' + JSON.stringify(_fromSent) + ' | ') : '') + _region.slice(0, 240);
      let _seller = _fromSent && _fromSent.seller ? _fromSent.seller : null;
      if (!_seller && _q('#sellerProfileTriggerId')) _seller = _cleanSeller(_txtOf(_q('#sellerProfileTriggerId')));
      if (!_seller && _q('#merchant-info a')) _seller = _cleanSeller(_txtOf(_q('#merchant-info a')));
      if (!_seller && _mi) {
        const _m = _txtOf(_mi).match(/(?:Sold by|Verkauf und Versand durch|出售方|卖家)\\s*:?\\s*(.+?)(?:\\s+and\\s+(?:Fulfilled|Dispatched|Ships)|(?:\\s+und\\s+)?Versand|\\s*$)/i);
        if (_m) _seller = _cleanSeller(_m[1]);
      }
      if (!_seller) {
        const _lbl = [...document.querySelectorAll('#tabular-buybox .tabular-buybox-label')].find((e) => /sold by|verkauf und versand/i.test(_txtOf(e)));
        if (_lbl) {
          const _row = _lbl.closest('tr, div') || _lbl.parentElement;
          const _vals = _row ? [..._row.querySelectorAll('.tabular-buybox-text')].map(_txtOf).filter(Boolean) : [];
          if (_vals.length) _seller = _cleanSeller(_vals[_vals.length - 1]);
        }
      }
      out.mainSeller = _seller || null;
      // 自营: 句子判定优先, 其次 BuyBox 区文本
      out.amazonSell = _fromSent ? !!_fromSent.amazonSell : (!!(_seller && _isAmz(_seller))
        || /(?:Sold by|Ships from and sold by|Dispatched from and sold by|Verkauf und Versand durch)\\s*:?\\s*Amazon\\b/i.test(_region));
      // 配送方式: 句子判定优先; 区域文本需要明确证据; 都无证据 → null (未知, 绝不猜成 FBM)
      if (_fromSent && _fromSent.fulfill) out.fulfill = _fromSent.fulfill;
      else if (/Fulfilled by Amazon|Dispatches? from Amazon|Ships from Amazon|Versand durch Amazon|Exp[ée]di[ée] par Amazon|Vendido por Amazon|Enviado por Amazon|Venduto e spedito da Amazon|Spedito da Amazon|亚马逊配送|亚马逊物流|(?:Dispatched from|Ships from|Versendet von)\\s*:?\\s*Amazon\\b/i.test(_region)) out.fulfill = 'FBA';
      else if (/Dispatched from and sold by|Fulfilled by Merchant|Versand durch den Verk|Versand durch Verk|Exp[ée]di[ée] (?:et vendu )?par(?!\\s*Amazon)|Vendu et exp[ée]di[ée] par(?!\\s*Amazon)|Vendido y enviado por(?!\\s*Amazon)|Venduto e spedito da(?!\\s*Amazon)|由卖家发货|卖家发货/i.test(_region)
        || /Verkauf und Versand durch\\s+(?!Amazon)/i.test(_region)) out.fulfill = 'FBM';
      else out.fulfill = null;
      // ★ 2026-09-24: 记录判定来源, 让"这个 FBA/FBM 是页面实证还是推的"可追溯(未知一律 null, 绝不默认 FBM)
      out.fulfillSrc = out.fulfill ? 'page' : null;
      // A+ : 容器存在但为空是常态 (#aplus_feature_div 空占位) — 必须有真实模块内容才算 A+
      const _apContent = ['#aplus_feature_div', '#aplus', '#aplus3p_feature_div', '#aplusBrandStory_feature_div'].some((sel) => {
        const el = _q(sel);
        return !!(el && el.children.length > 0 && (_txtOf(el).length > 30 || el.querySelectorAll('img').length > 0));
      }) || !!document.querySelector('.aplus-v2, .aplus-module');
      out.aplus = !!_apContent;
      // 主图 (官方高清优先, 否则按图片 ID 重建)
      const _imgId = (u) => { const _m3 = String(u || '').match(/\\/images\\/I\\/([A-Za-z0-9%+_-]{5,})/); return _m3 ? _m3[1] : null; };
      const _hi = (u) => { const _id = _imgId(u); return _id ? 'https://m.media-amazon.com/images/I/' + _id + '._AC_SL1500_.jpg' : null; };
      const _img = _q('#landingImage') || _q('#main-image-container img') || _q('#imgTagWrapperId img') || _q('#imageBlock img');
      let _src = null;
      if (_img) {
        const _h = _img.getAttribute('data-old-hires') || '';
        const _s = _img.getAttribute('src') || '';
        if (/^https?:/.test(_h)) _src = _hi(_h) || _h;
        else _src = _hi(_s);
      }
      if (!_src) {
        const _list = [...document.querySelectorAll('img[src*="media-amazon.com/images/I/"]')].map((im) => im.getAttribute('src') || '');
        for (const _c of _list) { if (!/_(?:US|SS|SR|AC_UL|QL)\\d*_/.test(_c)) { _src = _hi(_c); if (_src) break; } }
      }
      out.mainImage = _src || null;
      // ---- 类目层级 (面包屑: 一级 > 二级 > 三级 + Amazon 类目节点ID) ----
      // 注: 旧实现只取最后一级叶子类目 (.replace(/^.*›/,'')), 无法做一级/二级筛选 → 改为保留全路径
      const _bc = _q('#wayfinding-breadcrumbs_feature_div');
      const _lv = [];
      const _nodes = [];
      if (_bc) {
        _bc.querySelectorAll('li').forEach((li) => {
          if (li.classList && li.classList.contains('a-breadcrumb-divider')) return;
          const _t = _norm(li.textContent).replace(/^[›>\\s]+|[›>\\s]+$/g, '').trim();
          if (!_t || _t.length > 60) return;
          const _a = li.querySelector('a');
          _lv.push(_t);
          const _m = _a ? (_a.getAttribute('href') || '').match(/node=(\\d+)/) : null;
          _nodes.push(_m ? _m[1] : null);
        });
        if (!_lv.length) {   // 兜底: 无 li 结构 → 按分隔符拆文本
          _norm(_bc.textContent).split(/[›>]/).map((s) => s.trim()).filter(Boolean).forEach((s) => _lv.push(s));
        }
      }
      out.catPath = _lv.length ? _lv.join(' > ').slice(0, 200) : null;
      out.cat1 = _lv[0] ? _lv[0].slice(0, 60) : null;
      out.cat2 = _lv[1] ? _lv[1].slice(0, 60) : null;
      out.cat3 = _lv[2] ? _lv[2].slice(0, 60) : null;
      out.catNodes = _nodes.some(Boolean) ? _nodes : null;
      out.catSrc = _lv.length ? 'bc' : null;                        // bc = 面包屑(真实层级)
      out.category = _lv.length ? _lv[_lv.length - 1].slice(0, 60) : null;   // 叶子类目 (兼容旧字段)
      // ---- BSR (Best Sellers Rank) ----
      // 单元格原文形如: "213 in Automotive (See Top 100 in Automotive) 12 in Dash-Mounted Holders 40 in Automotive Electronics & Accessories 937 in ..."
      // 坑 (已实测): 旧实现用 /([\d.,]+)\s+in\s+([^(]+)/ 取类目 —— 类目名会一路吞掉后面的所有 BSR 行,
      //   第 2 条被写成 "Dash-Mounted Holders 40 in Automotive El", 第 3/4 条直接丢失。
      // 正确做法: ① 整块删掉 "(See Top 100 in X)" ② 类目名必须在"下一个 <数字> in "处截断。
      const _bsrParse = (txt) => {
        const _res = [];
        const _seen = {};
        const _s0 = String(txt || '')
          .replace(/[\\u00a0\\u2007\\u202f]/g, ' ')
          .replace(/\\(\\s*(?:See\\s+)?Top\\s+[\\d.,]+\\s+in\\s+[^)]{0,60}\\)/gi, ' ')
          .replace(/\\s+/g, ' ').trim();
        const _re = /([\\d.,]+)\\s+in\\s+(.+?)(?=\\s*(?:(?:#|Nr\\.?)\\s*)?[\\d.,]+\\s+in\\s+|$)/g;
        let _m;
        while ((_m = _re.exec(_s0)) !== null) {
          const _rank = parseInt(String(_m[1]).replace(/[.,]/g, ''), 10);
          let _cat = String(_m[2] || '').replace(/[()]/g, ' ').replace(/^(?:#|Nr\\.?)\\s*/i, '').replace(/\\s+/g, ' ').trim();
          _cat = _cat.replace(/(?:See\\s+)?Top\\s+[\\d.,]+\\s+in\\s*/gi, ' ').replace(/\\s*(?:#|Nr\\.?)\\s*$/i, '').replace(/\\s+/g, ' ').trim();
          if (!_rank || isNaN(_rank) || !_cat || _cat.length < 2) continue;
          const _key = _rank + '|' + _cat.toLowerCase();
          if (_seen[_key]) continue;
          _seen[_key] = 1;
          _res.push({ rank: _rank, category: _cat.slice(0, 40) });
          if (_res.length >= 6) break;
        }
        return _res;
      };
      const _bsrTxt = [];
      document.querySelectorAll('table.a-keyvalue.prodDetTable tr').forEach((_tr) => {
        const _th = _tr.querySelector('th');
        const _td = _tr.querySelector('td');
        if (_th && _td && /best sellers rank|bestseller-rang|classement des meilleures ventes/i.test(_norm(_th.textContent))) _bsrTxt.push(_norm(_td.textContent));
      });
      if (!_bsrTxt.length) {
        const _bsrBox = _q('#detailBullets_feature_div, #detailBulletsWrapper_feature_div, #productDetails_detailBullets_sections1');
        if (_bsrBox) {
          let _bt = _txtOf(_bsrBox);
          const _bi = _bt.search(/Best Sellers Rank|Bestseller-Rang/i);
          if (_bi >= 0) {
            _bt = _bt.slice(_bi + 10);
            const _cut = _bt.search(/Date First Available|Customer Reviews|ASIN\\b|Item Weight|Product Dimensions|Manufacturer|Item model number|Date de mise en ligne|Erstverf/i);
            if (_cut > 0) _bt = _bt.slice(0, _cut);
            _bsrTxt.push(_bt);
          }
        }
      }
      out.bsr = _bsrParse(_bsrTxt.join(' '));
      // 币种符号 (与站点币种交叉校验)
      const _sym = _q('.a-price-symbol');
      const _off = _q('#corePrice_feature_div .a-offscreen, .a-price .a-offscreen');
      const _offT = _norm((_off && _off.textContent) || '');
      const _offSym = (_offT.match(/^[^\\d\\s]+/) || [''])[0];
      out.curSymbol = (_norm((_sym && _sym.textContent) || '') || _offSym).slice(0, 4);
      out.detailOk = !!document.querySelector('#productTitle');
`;

// ===== 详情页完整读取表达式 (单一实现) =====
// DETAIL_CORE_JS (卖家/配送/自营/A+/主图/类目层级/币种) + 价格/起价/评分/评论/品牌/BSR/上架日期
// 使用者: 详情修复 (cdpBackfillMainImage) 与 批量品牌采集 (cdpReadDetail) —— 同一提取器, 数据口径一致
const DETAIL_READ_EXPR = `(() => {
    const out = { mainImage: null, title: null, rating: null, reviews: null, category: null, price: null, newFrom: null, brand: null, firstAvailable: null, bsr: [], fulfill: null, amazonSell: null, mainSeller: null, aplus: null, curSymbol: null, detailOk: false };
    ${DETAIL_CORE_JS}
    // <<<EXT:title>>> 详情标题 (品牌店/店铺列表只有卡片文本, 详情页标题最准)
    const _ttl = document.querySelector('#productTitle');
    if (_ttl) out.title = _norm(_ttl.textContent).slice(0, 300);
    // <<<END:title>>>
    const rEl = document.querySelector('#acrPopover .a-icon-alt, [data-hook="rating-out-of-text"]');
    if (rEl) { const m = rEl.textContent.match(/([\\d.,]+)\\s*out of/); if (m) out.rating = parseFloat(m[1].replace(',', '.')); }
    const revEl = document.querySelector('#acrCustomerReviewText, [data-hook="total-review-count"]');
    if (revEl) { const m = revEl.textContent.match(/([\\d.,]+)/); if (m) out.reviews = parseInt(m[1].replace(/[.,]/g, ''), 10); }
    // 类目层级已由 DETAIL_CORE_JS 统一提取
    const b = document.querySelector('#bylineInfo a, #bylineInfo_feature_div a');
    if (b) { const bt = b.textContent.trim().replace(/\\s+/g, ' ').replace(/^Brand:\\s*/i, '').trim(); if (bt && bt.length > 1 && bt.length < 60) out.brand = bt; }
    const sels = ['#corePrice_feature_div .a-offscreen', '.apex-pricetopayvalue', '#price_inside_buybox', '.a-price .a-offscreen'];
    /* ★ 2026-10-02 价格: 这里【只取原始文本】, 不在浏览器里 parseFloat。
     * 旧写法 parseFloat(m[1].replace(/,/g,'')) 把德国站的 "29,99 €" 读成 2999 (虚高 100 倍),
     * 把 "1.234,56 €" 读成 1.23456 (缩水 1 万倍) —— 因为德语的小数点是逗号。
     * 现在把原始串带回 Node, 用 parseMoneyText(raw, site) 按站点格式解析。 */
    for (const sel of sels) {
      const el = document.querySelector(sel);
      if (el) { const m = (el.textContent || '').match(/([\\d.,]+)/); if (m) { out.priceRaw = m[1]; break; } }
    }
    if (out.priceRaw == null) {
      const w = document.querySelector('.a-price-whole');
      const f = document.querySelector('.a-price-fraction');
      // whole/fraction 是 Amazon 拆好的整数/小数两段, 无歧义 → 直接拼 (不经过千分位判断)
      if (w) { const v = parseFloat((w.textContent || '').replace(/[^\\d]/g, '') + '.' + ((f ? (f.textContent || '').replace(/[^\\d]/g, '') : '') || '00')); if (!isNaN(v)) out.price = v; }
    }
    const olp = document.body ? document.body.textContent : '';
    let fm = olp.match(/New\\s*\\(\\d+\\)\\s*from\\s*(?:€|£|A\\$|AU\\$|US\\$|C\\$|\\$)?\\s*([\\d.,]+)/i);
    if (!fm) fm = olp.match(/Neu\\s*\\(\\d+\\)\\s*ab\\s*(?:EUR|€)?\\s*([\\d.,]+)/i);
    if (fm) out.newFromRaw = fm[1];   // ★ 同上: 原始串带回 Node 解析
    document.querySelectorAll('table.a-keyvalue.prodDetTable tr').forEach((tr) => {
      const th = tr.querySelector('th'); const td = tr.querySelector('td');
      if (!th || !td) return;
      const k = th.textContent.replace(/\\s+/g, ' ').trim().toLowerCase();
      const v = td.textContent.replace(/\\s+/g, ' ').trim();
      // BSR 已由 DETAIL_CORE_JS 的统一解析器负责 (out.bsr), 这里只管上架日期
      if (/date first available|first available/i.test(k)) out.firstAvailable = v.slice(0, 30);
    });
    // <<<EXT:firstAvailable>>> 上架日期兜底: 多数站点 (AU/UK/DE…) 不在 prodDetTable 里, 而在 #detailBullets_feature_div 的 li 中
    //   例: "Date First Available: 12 May 2023" / "Erstverfügungsdatum: 3. Januar 2023" / "2023-05-12"
    //   只按"日期形状"取值 (不吞后面的标签文本), 读不到 → 保持 null (绝不写成"今天": 那是采集时间不是上架时间)
    if (!out.firstAvailable) {
      const _db = document.querySelector('#detailBullets_feature_div, #detailBulletsWrapper_feature_div, #productDetails_detailBullets_sections1');
      if (_db) {
        const _m2 = _norm(_db.textContent).match(/(?:Date First Available|First Available|Erstverf\\u00fcgungsdatum|Im Angebot von Amazon\\.de seit|Date de mise en ligne|Data di disponibilit\\u00e0|Fecha de disponibilidad en Amazon)\\s*[:\\uff1a]?\\s*(\\d{1,2}[\\s.]\\s*[A-Za-z\\u00c0-\\u00ff]{3,12}[\\s.]\\s*\\d{2,4}|\\d{4}-\\d{1,2}-\\d{1,2}|[A-Za-z]{3,12}\\s+\\d{1,2},?\\s+\\d{4})/i);
        if (_m2) out.firstAvailable = _norm(_m2[1]).slice(0, 30);
      }
    }
    // <<<END:firstAvailable>>>
    return JSON.stringify(out);
  })()`;

// 页面风控守卫: 命中验证码/登录墙 → 返回原因字符串 ('captcha' | 'login'), 正常返回 null
// 命中验证码必须立刻中止, 否则会把"验证码页"当成"商品页无数据" → 写入垃圾数据
async function cdpPageGuard(send) {
  try {
    const r = await send('Runtime.evaluate', {
      expression: `(() => {
        const u = location.href || '';
        const t = (document.body ? document.body.textContent : '').slice(0, 3000);
        if (/\\/errors\\/validateCaptcha|\\/gp\\/captcha|\\/sorry\\//i.test(u)) return 'captcha';
        if (/captcha|Robot Check|Enter the characters|api-services-support@amazon|机器人验证/i.test(t)) return 'captcha';
        if (/\\/ap\\/signin|\\/gp\\/signin/i.test(u)) return 'login';
        return null;
      })()`, returnByValue: true,
    });
    return (r && r.result && r.result.value) || null;
  } catch (e) { return null; }
}

// 详情页完整读取 (与「详情修复」同一表达式/同一字段映射): 主图/真实价格/起价/评分/评论/品牌/A+/配送/自营/主卖家/类目层级/BSR/上架/币种
// 写入 it (原地), 返回原始 d (含 regionText, 便于诊断)
async function cdpReadDetail(send, host, it) {
  await send('Page.navigate', { url: 'https://' + host + '/dp/' + it.asin });
  await new Promise((r) => setTimeout(r, 2500));
  // 等详情页渲染 (标题 + 主图), 最多 15s — 与采集链路同一就绪判定, 避免读到未渲染的空页
  for (let w = 0; w < 15; w++) {
    try {
      const rr = await send('Runtime.evaluate', {
        expression: `(() => { const t = document.querySelector('#productTitle'); const i = document.querySelector('#landingImage, #imgTagWrapperId img, #main-image-container img, #imageBlock img'); return JSON.stringify({ t: !!t, i: !!i }); })()`,
        returnByValue: true,
      });
      const st = JSON.parse(rr.result.value);
      if (st.t && st.i) break;
    } catch (e) { /* 继续等 */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  for (let s = 0; s < 2; s++) { await send('Runtime.evaluate', { expression: `window.scrollTo(0, ${(s + 1) * 3000})` }); await new Promise((r) => setTimeout(r, 600)); }
  await new Promise((r) => setTimeout(r, 800));
  const rf = await send('Runtime.evaluate', { expression: DETAIL_READ_EXPR, returnByValue: true });
  let d = {};
  try { d = JSON.parse(rf.result.value || '{}'); } catch (e) { d = {}; }
  if (d.mainImage) it.mainImage = d.mainImage;
  if (d.title) it.title = d.title;                 // 详情页标题最准 (品牌店/店铺页列表只有卡片文本)
  if (d.rating != null) it.rating = d.rating;
  if (d.reviews != null) it.reviews = d.reviews;
  if (d.brand) it.brand = d.brand;
  if (d.category) it.category = d.category;
  // 价格: 优先 "New from X" 起价 (最低跟卖参考价), 否则 BuyBox; minPrice/buyBoxPrice 同步, 避免派生字段残留旧价
  // ★ 2026-10-02: 原始价串改在 Node 侧用 parseMoneyText(站点感知)解析 —— de 站 "29,99 €" → 29.99
  //   (浏览器表达式里旧写法 replace(/,/g,'') 会把它读成 2999)
  const _siteForPrice = it.site || (String(host || '').match(/amazon\.([a-z.]+)/) || [])[1] || '';
  const dPrice = (d.price != null) ? d.price : parseMoneyText(d.priceRaw, _siteForPrice);
  const dNewFrom = (d.newFrom != null) ? d.newFrom : parseMoneyText(d.newFromRaw, _siteForPrice);
  if (dNewFrom != null) { it.price = dNewFrom; it.minPrice = dNewFrom; it.buyBoxPrice = dPrice != null ? dPrice : null; }
  else if (dPrice != null) { it.price = dPrice; it.buyBoxPrice = dPrice; it.minPrice = dPrice; }
  if (d.bsr && d.bsr.length) { it.bsr = d.bsr; it.rank = '#' + Math.max.apply(null, d.bsr.map((b) => b.rank)); }
  if (d.firstAvailable) it.firstAvailable = d.firstAvailable;
  if (d.detailOk) {
    it.detailOk = true; it.detailAt = now(); it.detailVer = DETAIL_VER;
    it.aplus = !!d.aplus;
    if (d.regionText) {
      it.amazonSell = !!d.amazonSell;
      it.fulfill = d.fulfill || null;          // 未读到配送证据 → null (未知, 绝不猜成 FBM)
      // sellerRegion 已停写: 这里原来写 d.regionText(诊断串, 非产地) —— 见本文件 2800 行处的完整说明
    }
    if (d.mainSeller) it.mainSeller = d.mainSeller;
    if (siteSymbolOk(d.curSymbol, it.site || host)) it.priceSymbol = d.curSymbol;
    if (d.catPath) { it.catPath = d.catPath; it.cat1 = d.cat1; it.cat2 = d.cat2; it.cat3 = d.cat3; it.catNodes = d.catNodes || null; it.catSrc = 'bc'; it.catAt = now(); }
  }
  it.currency = siteCurrency(it.site || 'au');
  return d;
}

// 从被切碎的 BSR 类目串里挖回真实条目 (旧解析器留下的脏数据修复用)
// 例: "Automotive) 12 in Dash-Mounted Holders 4" → [{rank:12, category:'Dash-Mounted Holders'}]
//     ("4" 是下一条 "40 in …" 被截断的残渣, 必须去掉; 残渣本身不够成一条, 直接丢弃)
function salvageBsrFragment(cat) {
  const s = String(cat || '');
  const out = [];
  const re = /(?:^|[)\s])(\d{1,3}(?:[.,]\d{3})*)\s+in\s+([A-Za-z][A-Za-z0-9 &'’\-]{2,45}?)(?=\s+\d{1,3}(?:[.,]\d{3})*\s+in\s+|$)/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    const name = m[2].replace(/\s+\d{1,3}$/, '').replace(/\s+/g, ' ').trim();
    if (name.length < 3) continue;
    out.push({ rank: parseInt(m[1].replace(/[.,]/g, ''), 10), category: name.slice(0, 40) });
  }
  return out;
}
// 品牌名归一化 + 同品牌判定 (品牌页/品牌搜索页可能混入他牌商品, 需按品牌名校验)
function normBrandName(s) {
  return String(s || '').toLowerCase()
    .replace(/^\s*(visit the|shop the|shop|brand|品牌)\s*[:：]?\s*/i, '')
    .replace(/\b(flagship|official|stores?|shops?|brand)\b/gi, '')
    .replace(/[^a-z0-9\u4e00-\u9fa5]/g, '')
    .trim();
}
function sameBrand(a, b) {
  const x = normBrandName(a), y = normBrandName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  return x.length >= 4 && y.length >= 4 && (x.includes(y) || y.includes(x));
}
// 品牌名显示清洗: 去掉 Amazon 的 "Visit the XXX Store" 包装 → 只留品牌名 (入库用, 便于聚合/筛选)
// 例: "Visit the Lamicall Store" → "Lamicall"; "Brand: Anker" → "Anker"; "Nintendo" → "Nintendo"
function cleanBrandDisplay(s) {
  let t = String(s || '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const m = t.match(/^(?:Visit the|Shop the|Brand|品牌)\s*[:：]?\s+(.+?)(?:\s+(?:Store|Shop|Official Store|旗舰店|官方旗舰店))?$/i);
  if (m && m[1]) t = m[1].trim();
  t = t.replace(/\s+(?:Store|Shop|旗舰店|官方旗舰店)$/i, '').trim();
  return t || null;
}
// 亚马逊"随机店铺名"识别 (如 PQWYEWHD / TRNLBSTO / CFUNMNVBVZ)
// 背景: 旧「跟卖店铺采集」把卖家店铺名写进过 brand 字段, 这些值不是品牌名, 不能当品牌线索用
// 判定: 无空格 + 连续 4 个以上辅音 (品牌名如 UGREEN/LISEN/ANKER/ESR 都不会命中)
function looksLikeSellerHandle(s) {
  const t = String(s || '').trim();
  if (!t || /\s/.test(t) || /^Visit the/i.test(t)) return false;
  if (/\d{3,}/.test(t)) return true;                       // 连续 3 位数字 → 编号/店铺名
  const core = t.replace(/[^A-Za-z]/g, '');
  if (core.length < 6) return false;                       // 短名不判 (ESR/ANKER/LISEN/Coolpow 之外都保留)
  const runs = core.toUpperCase().match(/[^AEIOU]+/g) || [];
  const longest = runs.reduce((m, x) => Math.max(m, x.length), 0);
  return longest >= 4;
}
// 品牌线索是否可用: 非通用词 且 不像随机店铺名
function isBrandLike(b) {
  const t = String(b || '').trim();
  if (!t) return false;
  const GENERIC = ['generic', 'unknown', 'unbranded', 'no brand', 'none', 'n/a', 'na', 'various', 'other', '通用', '无品牌', '其他', '-'];
  if (GENERIC.indexOf(t.toLowerCase()) >= 0) return false;
  if (looksLikeSellerHandle(t)) return false;
  return normBrandName(t).length >= 2;
}

// 插件面板文本 → 商品字段合并 (商标/月销/尺寸/重量/配送/FBA费)
// ★ 2026-09-24 口径修正(采集准确性): 原实现是"只补空、绝不覆盖" → 面板读到的新值永远盖不掉旧值,
//   于是补采/重采对 配送方式(FBA/FBM)/尺寸/重量/上架日期/商品类型 完全无效
//   (实测: 11 天前的 FBA/FBM 与尺寸补采后仍是旧值; bsrShop 375182 永不更新)。
//   现改为【面板读到就覆盖】—— 这些字段面板是唯一权威来源, 不覆盖就等于永远采不到新数据。
//   但"这次没读到"绝不清空旧值(避免临时读不到把好数据洗掉)。
//   同时落盘 panelOk/panelFields/panelAt/fulfillSrc, 让"到底采到没有、依据是什么"可验证。
/**
 * 商标数 + 状态串 → 品牌备案状态 (brandStatus)
 *
 * 语义 (与筛选面板「品牌状态」一一对应):
 *   registered = 已备案/已注册   → 筛选里「排除已备案」用它
 *   notfound   = 查过了确实没有   → 筛选里「仅未查到」用它
 *   unchecked  = 有商标记录但未达备案门槛 (或还没核实)
 *   null       = 面板没给商标信息 → 【不覆盖】原值, 别拿"未知"冒充"已核查"
 *
 * ★ 2026-09-30 修复: 以前各入库路径一律写死 'unchecked', 导致「排除已备案 / 仅未查到 / 排除TM」
 *   三个筛选形同虚设 (实测全库 3160 条 unchecked / 2 notfound / 1 registered)。
 *   另外旧的 count>60 阈值不可达 (实测库内最大 29) → 改以【状态串】为准, 数值仅兜底。
 */
function brandStatusFromTm(count, statusStr) {
  const st = String(statusStr || '');
  // ★ 面板 only 给得到商标信息 (形如「28个注册商标」/「28个已申请」), 拿不到亚马逊 Brand Registry 的备案状态。
  //   对筛选用途而言两者等价 —— 「排除已备案」就是要避开"已被保护、抢不动"的品牌, 所以把
  //   「注册商标」也归入 registered。(原始串仍完整保留在 tmText 里, 要看原文随时能看)
  if (/已注册|已备案|已登记|注册商标/.test(st)) return 'registered';
  if (/未查到|查无|无记录|不存在/.test(st)) return 'notfound';
  const c = (count != null && count !== '' && !isNaN(Number(count))) ? Number(count) : null;
  if (c != null && c > 0) return 'unchecked';     // 有商标记录但没说"已注册/已备案" → 保守判未核查
  return null;                                     // 面板没给 → 不覆盖
}

function mergePanelInto(it, pd) {
  if (!pd || typeof pd !== 'object') return it;
  let n = 0;
  /** 面板字段写入: 读到就覆盖; 值统一过 cleanPanelVal 防串句污染 */
  const put = (k, v) => {
    const val = cleanPanelVal(v);
    if (val == null || val === '') return;
    if (it[k] !== val) n++;
    it[k] = val;
  };
  if (pd.brand && !it.brand) { it.brand = pd.brand; n++; }   // 品牌仍只补空: 卡片/面包屑品牌比面板干净(面板会带"未查到")
  if (pd.fulfill) { if (it.fulfill !== pd.fulfill) n++; it.fulfill = pd.fulfill; it.fulfillSrc = 'panel'; }
  // ★★ 2026-09-30 关键修复: 面板解析(links-collector.parsePanelText)产出的是
  //    tmStatus = { count, status }  ← 例如 { count:28, status:'已申请' }
  //    而下面几行原来只读 tmText / trademarkCount / tmCountries —— 字段名对不上,
  //    pd.tmStatus 【没有任何一行代码读它】→ 商标信息整段丢弃。
  //    实测代价: 全库 3163 条 tmText 全空、tmMark 恒 false、brandStatus 3160 条 unchecked。
  //    这里先把 tmStatus 正规化, 并顺手推导 brandStatus / tmMark。
  const _tms = (pd.tmStatus && typeof pd.tmStatus === 'object') ? pd.tmStatus
    : ((pd.trademark && typeof pd.trademark === 'object') ? pd.trademark : null);
  if (_tms && (_tms.count != null || _tms.status)) {
    const _cnt = (_tms.count != null && !isNaN(Number(_tms.count))) ? Number(_tms.count) : null;
    const _st = String(_tms.status || '').trim();
    const _txt = ((_cnt != null ? _cnt + '个' : '') + _st).trim();
    if (_txt && it.tmText !== _txt) { it.tmText = _txt; n++; }
    if (_cnt != null && it.trademarkCount !== _cnt) { it.trademarkCount = _cnt; n++; }
    const _bs = brandStatusFromTm(_cnt, _st);
    if (_bs && it.brandStatus !== _bs) { it.brandStatus = _bs; n++; }
    const _isTm = /注册商标|TM|已申请/.test(_st);
    if (_isTm !== !!it.tmMark) { it.tmMark = _isTm; n++; }
  }
  if (pd.tmText) { it.tmText = pd.tmText; n++; }
  if (pd.trademarkCount != null) { it.trademarkCount = pd.trademarkCount; n++; }
  if (pd.tmCountries && pd.tmCountries.length) { it.tmCountries = pd.tmCountries; n++; }
  if (pd.sellerCount != null) { it.sellerCount = pd.sellerCount; n++; }
  if (pd.sales30d) { it.sales30d = pd.sales30d; n++; }
  /* ★ 2026-10-02 卖家国家(国旗图标) —— 原来这里【没有任何一行】写 chinaSeller,
   *   于是即便国旗读到了也落不到商品上, 采集筛选的 china 判定永远"未知" → 全被拒。
   *   三态保留: true/false 是读到的结论; null 表示没读到, 绝不写 false(那会谎报"非中国")。 */
  if (pd.sellerCountryCode) { it.sellerCountryCode = pd.sellerCountryCode; n++; }
  if (pd.sellerFlagCode) { it.sellerFlagCode = pd.sellerFlagCode; n++; }
  if (pd.chinaSeller === true || pd.chinaSeller === false) { it.chinaSeller = pd.chinaSeller; n++; }
  if (pd.fbaFee) { put('fbaFee', pd.fbaFee); }
  put('size', pd.size);
  put('weight', pd.weight);
  put('packSize', pd.packSize);
  put('packWeight', pd.packWeight);
  put('productType', pd.productType);
  // 上架日期: 只接受面板的 YYYY-MM-DD 格式(面板可能带 "(645天)"), 读到就覆盖
  const la = pd.listedAt && String(pd.listedAt).match(/(\d{4}-\d{2}-\d{2})/);
  if (la) { if (it.listedAt !== la[1]) n++; it.listedAt = la[1]; }
  // bsr 数组 = Amazon 页面【原生】BSR, 面板不覆盖它(面板排名走 bsrShop/bsrCat, 见 mergePanelRanks)
  if ((!it.bsr || !it.bsr.length) && pd.bsr && pd.bsr.length) { it.bsr = pd.bsr; n++; }
  if (pd.brandStatus) { it.brandStatus = pd.brandStatus; n++; }
  it.panelOk = true;          // ★ 显式标记: 本商品的面板确实读到了(据此可区分"真没排名"与"没采到")
  it.panelFields = n;
  it.panelAt = now();
  return it;
}

// ===== 详情页插件面板: 就地等待分析完成并读取 (不重新导航) =====
// 用途: 详情页流程 "先取插件信息 + 商品主信息(主图/价格/类目), 再取跟卖" 的第一步
// 两段式: ① 最多 probeMs 等插件面板出现 (站点无插件 → 快速跳过, 不浪费时间)
//         ② 面板已出现 → 最多 maxMs 等 "正在分析" 结束 (插件分析约 12-15s)
// 兜底熔断: 同站点连续 failLimit 次分析未完成 (如 amazon.com.au 实测插件长期停在"正在分析")
//          → 该站点短时间内直接跳过等待, 避免每个商品白等 maxMs
const panelFailSites = {};          // site -> { fails, until }
const PANEL_FAIL_LIMIT = 2;
const PANEL_SKIP_MS = 30 * 60 * 1000;
async function waitPanelInline(send, site, probeMs = 6000, maxMs = 15000) {
  const key = site || '';
  const cached = panelFailSites[key];
  if (cached && cached.until > Date.now()) {
    // ★ 2026-09-24 采集准确性修复: 熔断期原来【直接 return null】→ 该站点接下来 30 分钟内所有商品的
    //   配送(FBA/FBM)/尺寸/重量/上架/FBA费用 全部静默采不到, 而且没有任何标记(排查时看不出来)。
    //   改为仍做一次【不等待】的读取: 面板已渲染好就直接用, 没渲染才放弃 —— 成本只有一次 evaluate。
    //   实测正是它导致补采时 pluginTxt=null → 面板新值永远写不进去(脏 weight 永久留存)。
    const quick = await cdpReadZyPanel(send).catch(() => null);
    if (quick && !/正在分析|正在加载/.test(quick) && /(ASIN\s*[:：]|店铺选品|榜单选品|卖家)/.test(quick)) return { txt: quick, flag: null };
    return null;
  }
  const read = async () => {
    try {
      const r = await send('Runtime.evaluate', {
        expression: `(() => {
          ${linksCollector.READ_FLAGS_FN}
          const p = document.querySelector('.zy-tool-detail') || document.querySelector('.zying-shadow-root');
          if (!p) return JSON.stringify({ ok: false });
          const t = (p.textContent || '').replace(/\\s+/g, ' ').trim();
          // ★ 2026-10-02 卖家国家国旗: 与文本同一次 evaluate 读回来(零额外开销)
          return JSON.stringify({ ok: true, analyzing: /正在分析/.test(t), txt: t.slice(0, 3000), flag: readSellerFlag(p) });
        })()`, returnByValue: true,
      });
      return JSON.parse(r.result.value);
    } catch (e) { return null; }
  };
  const markFail = () => {
    const cur = panelFailSites[key] || { fails: 0, until: 0 };
    cur.fails++;
    if (cur.fails >= PANEL_FAIL_LIMIT) { cur.until = Date.now() + PANEL_SKIP_MS; cur.fails = 0; }
    panelFailSites[key] = cur;
  };
  // ① 等面板出现
  const probeEnd = Date.now() + Math.max(0, probeMs);
  let appeared = false;
  for (;;) {
    const st = await read();
    if (st && st.ok) { appeared = true; break; }
    if (Date.now() >= probeEnd) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!appeared) return null;   // 该站点/页面无智赢插件 → 跳过, 不拖慢采集
  // ② 等分析完成 (仍在"正在分析"时视为失败 → 返回 null, 绝不把"正在分析"当数据解析)
  // ★ 2026-10-02 返回值从 `string` 改成 `{ txt, flag }` —— 因为卖家国家只在 DOM 的国旗图标里,
  //   纯文本拿不到。调用方要一起拿到 flag, 否则 applyCollectFilter 的 china 判定会全判"未知"。
  const end = Date.now() + Math.max(0, maxMs);
  for (;;) {
    const st = await read();
    if (st && st.ok && !st.analyzing && st.txt) { panelFailSites[key] = { fails: 0, until: 0 }; return { txt: st.txt, flag: st.flag || null }; }
    if (Date.now() >= end) { markFail(); return null; }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

// 读取单个商品详情页的插件面板 (复用: 导航→滚动→重试→解析)
async function cdpReadOnePanel(send, asin, domain) {
  await send('Page.navigate', { url: `https://www.amazon.${domain}/dp/${asin}` });
  await new Promise((r) => setTimeout(r, 9000));
  for (let i = 0; i < 3; i++) {
    await send('Runtime.evaluate', { expression: `window.scrollTo(0, ${(i + 1) * 2000})` });
    await new Promise((r) => setTimeout(r, 800));
  }
  await new Promise((r) => setTimeout(r, 1200));
  let panelTxt = null, analyzing = false;
  // 等待数据加载完成: 轮询直到面板出现且非"正在分析" (最多 ~36s)
  // 注: UK 等站点插件分析商标可能耗时 40s+, 超时会导致商标信息采不到, 故上限放宽
  for (let attempt = 0; attempt < 12; attempt++) {
    const r = await send('Runtime.evaluate', {
      expression: `(() => {
        const p = document.querySelector('.zy-tool-detail') || document.querySelector('.zying-shadow-root');
        if (!p) return JSON.stringify({ ok: false });
        const txt = (p.textContent || '').replace(/\\s+/g, ' ').trim();
        return JSON.stringify({ ok: true, analyzing: /正在分析/.test(txt), txt: txt.slice(0, 3000) });
      })()`, returnByValue: true,
    });
    const st = JSON.parse(r.result.value);
    if (st.ok && !st.analyzing) { panelTxt = st.txt; break; }
    analyzing = st.ok && st.analyzing;
    await new Promise((r) => setTimeout(r, 3000));
  }
  // 若面板已出现但仍在分析, 再多等一轮 (数据加载完成后再获取, 最多再加 ~45s)
  if (!panelTxt && analyzing) {
    for (let attempt = 0; attempt < 15; attempt++) {
      await new Promise((r) => setTimeout(r, 3000));
      const r = await send('Runtime.evaluate', {
        expression: `(() => {
          const p = document.querySelector('.zy-tool-detail') || document.querySelector('.zying-shadow-root');
          if (!p) return JSON.stringify({ ok: false });
          const txt = (p.textContent || '').replace(/\\s+/g, ' ').trim();
          return JSON.stringify({ ok: true, analyzing: /正在分析/.test(txt), txt: txt.slice(0, 3000) });
        })()`, returnByValue: true,
      });
      const st = JSON.parse(r.result.value);
      if (st.ok && !st.analyzing) { panelTxt = st.txt; break; }
    }
  }
  if (!panelTxt) return { error: analyzing ? '插件仍在分析中' : '插件面板未加载' };
  const parsed = parsePanelText(panelTxt, asin, '');
  // ===== 商标国家弹窗: 点击 "xxx个注册商标" 元素 → 打开弹窗 → 解析 "品牌已在如下国家注册" =====
  try {
    const elInfo = await send('Runtime.evaluate', {
      expression: `(() => {
        const walk = (root, depth) => {
          if (!root || depth > 8) return null;
          let f = null;
          root.querySelectorAll ? root.querySelectorAll('*').forEach((el) => {
            if (f) return;
            const t = (el.textContent || '').trim();
            if (/^\\d+个注册商标$/.test(t)) { f = el; return; }
            if (el.shadowRoot) { const r = walk(el.shadowRoot, depth + 1); if (r) f = r; }
          }) : null;
          if (!f && root.shadowRoot) f = walk(root.shadowRoot, depth + 1);
          return f;
        };
        const el = walk(document, 0);
        if (!el) return JSON.stringify({ found: false });
        el.scrollIntoView({ block: 'center', inline: 'center' });
        return JSON.stringify({ found: true });
      })()`, returnByValue: true,
    });
    const elInfoD = JSON.parse(elInfo.result.value);
    if (elInfoD.found) {
      await new Promise((r) => setTimeout(r, 1000));
      const posR = await send('Runtime.evaluate', {
        expression: `(() => {
          const walk = (root, depth) => {
            if (!root || depth > 8) return null;
            let f = null;
            root.querySelectorAll ? root.querySelectorAll('*').forEach((el) => {
              if (f) return;
              const t = (el.textContent || '').trim();
              if (/^\\d+个注册商标$/.test(t)) { f = el; return; }
              if (el.shadowRoot) { const r = walk(el.shadowRoot, depth + 1); if (r) f = r; }
            }) : null;
            if (!f && root.shadowRoot) f = walk(root.shadowRoot, depth + 1);
            return f;
          };
          const el = walk(document, 0);
          if (!el) return JSON.stringify({ found: false });
          const r = el.getBoundingClientRect();
          return JSON.stringify({ found: true, x: r.x + r.width / 2, y: r.y + r.height / 2 });
        })()`, returnByValue: true,
      });
      const pos = JSON.parse(posR.result.value);
      if (pos.found) {
        // hover 触发: 鼠标滑到商标元素上, 弹窗自动出现 (停留等待)
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pos.x, y: pos.y });
        await new Promise((r) => setTimeout(r, 2500));
        // 扫描弹窗文本 (穿透 shadowRoot/iframe)
        const popR = await send('Runtime.evaluate', {
          expression: `(() => {
            const scan = (doc, depth) => {
              if (!doc || depth > 8) return null;
              const t = (doc.body ? doc.body.textContent : doc.textContent || '').replace(/\\s+/g, ' ');
              const idx = t.indexOf('已在如下国家注册');
              if (idx >= 0) return t.slice(idx, idx + 9000);
              let res = null;
              const collected = [];
              doc.querySelectorAll ? doc.querySelectorAll('*').forEach((el) => {
                if (res) return;
                // 收集 国家-已注册/已申请 叶子文本 (新版插件弹窗无标题, 直接是国家列表)
                if (el.children.length === 0) {
                  const tt = (el.textContent || '').trim();
                  if (tt.length < 60 && /^[\\u4e00-\\u9fa5A-Za-z（）()]+-已(?:注册|申请)/.test(tt)) collected.push(tt);
                }
                if (el.shadowRoot) { const r = scan(el.shadowRoot, depth + 1); if (r) res = r; }
                if (!res && el.tagName === 'IFRAME') { try { if (el.contentDocument) { const r2 = scan(el.contentDocument, depth + 1); if (r2) res = r2; } } catch (e) {} }
              }) : null;
              if (!res && doc.shadowRoot) res = scan(doc.shadowRoot, depth + 1);
              if (!res && collected.length) res = collected.join(' ');
              return res;
            };
            return JSON.stringify(scan(document, 0));
          })()`, returnByValue: true,
        });
        const popTxt = JSON.parse(popR.result.value);
        if (popTxt) parsed.tmCountries = parseTmCountries(popTxt);
        // 移开鼠标关闭弹窗
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 10, y: 10 });
        await new Promise((r) => setTimeout(r, 400));
      }
    }
  } catch (e) { console.error('[tm-popup]', asin, '商标国家解析失败:', e && e.message); }
  // ===== Amazon 原生详情表提取物流字段 (面板缺尺寸/重量时兜底; uk 等站点面板无物流字段) =====
  // 数据源: #productDetails_techSpec_section_1 / #detailBullets_feature_div (Item Weight / Product Dimensions 等)
  try {
    const dt = await send('Runtime.evaluate', {
      expression: `(() => {
        const scan = (root, depth) => {
          if (!root || depth > 6) return null;
          let best = null;
          root.querySelectorAll ? root.querySelectorAll('*').forEach((el) => {
            if (best) return;
            const t = (el.innerText || el.textContent || '').trim();
            if (/Item Weight|Product Dimensions|Package Weight|Package Dimensions|Gewicht|Abmessungen|Produktmaße|Artikelgewicht|Produktabmessungen/i.test(t) && t.length < 600) { best = t; return; }
            if (el.shadowRoot) { const r = scan(el.shadowRoot, depth + 1); if (r) best = r; }
          }) : null;
          if (!best && root.shadowRoot) best = scan(root.shadowRoot, depth + 1);
          return best;
        };
        const bodyTxt = (document.body.innerText || '');
        const grabKv = (re) => { const m = bodyTxt.match(re); return m ? m[0].split(/\\t|\\n|:/).slice(1).join(' ').trim().slice(0, 80) : null; };
        return JSON.stringify({
          spec: (() => { const s = document.querySelector('#productDetails_techSpec_section_1, #productDetails_db_sections'); return s ? s.innerText.replace(/\\n+/g, ' ').slice(0, 900) : null; })(),
          itemWeight: grabKv(/Item Weight[\\t\\n:][^\\n]{0,60}/i) || grabKv(/Gewicht[\\t\\n:][^\\n]{0,60}/i) || grabKv(/Artikelgewicht[\\t\\n:][^\\n]{0,60}/i),
          dims: grabKv(/Product Dimensions[\\t\\n:][^\\n]{0,60}/i) || grabKv(/Produktmaße[\\t\\n:][^\\n]{0,60}/i) || grabKv(/Produktabmessungen[\\t\\n:][^\\n]{0,60}/i) || grabKv(/Abmessungen[\\t\\n:][^\\n]{0,60}/i),
          pkgW: grabKv(/Package Weight[\\t\\n:][^\\n]{0,60}/i),
          pkgD: grabKv(/Package Dimensions[\\t\\n:][^\\n]{0,60}/i),
        });
      })()`, returnByValue: true,
    });
    const d = JSON.parse(dt.result.value);
    // 面板缺字段时用原生数据兜底 (面板有则以面板为准)
    if (!parsed.weight && (d.itemWeight || d.pkgW)) parsed.weight = d.itemWeight || d.pkgW;
    if (!parsed.size && d.dims) parsed.size = d.dims;
    if (!parsed.packSize && d.pkgD) parsed.packSize = d.pkgD;
    if (!parsed.packWeight && d.pkgW) parsed.packWeight = d.pkgW;
    if (!parsed.fbaFee && d.spec && /Item Weight|Gewicht/.test(d.spec)) {
      // spec 表里没有 FBA 费用 (那是插件数据), 保持 parsed.fbaFee 不变
    }
  } catch (e) { console.error('[native-detail]', asin, '原生详情表提取失败:', e && e.message); }
  return parsed;
}

// ===== 解析 "品牌已在如下国家注册：国家-已注册 国家-已申请 ..." =====
// 兼容两种格式: ① 有标题 "已在如下国家注册：" ② 无标题直接是国家列表 (如新版插件弹窗 "英国-已注册(当前站点)")
function parseTmCountries(txt) {
  const out = [];
  if (!txt) return out;
  const s = String(txt);
  let body = s;
  const m = s.match(/已在如下国家注册[：:]([\s\S]*)/);
  if (m) body = m[1];
  // 清理 "(当前站点)" 后缀残渣: "英国-已注册(当前站点)" 中 "(当前站点)" 会在下一轮匹配成国家名
  body = body.replace(/[（(]当前站点[）)]/g, '');
  const re = /([\u4e00-\u9fa5A-Za-z（）()]+?)-已(?:注册|申请)/g;
  const CN_MAP = { '欧洲联盟': '欧盟', '大韩民国': '韩国', '比荷卢知识产权局': '比荷卢', '俄罗斯联邦': '俄罗斯', '阿拉伯联合酋长国': '阿联酋', '非洲知识产权组织': '非洲知识产权', '朝鲜民主主义人民共和国': '朝鲜', '前南斯拉夫的马其顿共和国': '马其顿', '德国': '德国', '英国': '英国', '美国': '美国', '日本': '日本', '中国': '中国', '法国': '法国', '意大利': '意大利', '西班牙': '西班牙', '印度': '印度', '加拿大': '加拿大', '澳大利亚': '澳大利亚' };
  let mm;
  const seen = new Set();
  while ((mm = re.exec(body)) !== null) {
    const name = mm[1].trim();
    if (!name) continue;
    const label = CN_MAP[name] || name;
    if (!seen.has(label)) { seen.add(label); out.push(label); }
  }
  return out;
}

// ===== 类目菜单导航采集: 首页 → 大类目 → 二级类目 → See all results → 并行采集商品 =====
// 流程: 进入 amazon.de → 类目链接(等效"按部门购买") → 二级类目 → 查看所有结果 → 商品数据
async function cdpCategoryMenuCollect(opts = {}) {
  const site = opts.site || 'de';
  const host = 'www.amazon.' + siteToHostSuffix(site);
  const maxItems = Math.min(100, Math.max(1, opts.maxItems || 50));
  const pages = Math.min(10, Math.max(1, opts.pages || 3));
  // ★ 2026-09 改造(统一不跳转): 旧写法 `opts.detail !== false` 默认开 → 每个商品跳详情页读价格/品牌。
  //   现在默认关, 详情字段由「补采」按需补; 需要旧行为时显式传 detail=1。
  const withDetail = opts.detail === true;
  // 用首页标签连接 (复用 amazon 标签页)
  const tabs = await cdpGetTabs();
  const page = tabs.find((t) => t.type === 'page' && /amazon\.(com\.au|co\.uk|com|com\.mx|com\.br|de|fr|it|es|co\.jp|ca|in|nl|se|pl)/.test(t.url))
    || tabs.find((t) => t.type === 'page' && !t.url.includes('3088') && !t.url.startsWith('data:'))
    || tabs.find((t) => t.type === 'page');
  if (!page) throw new Error('Edge 无可用页面标签, 请确认 Edge 以 --remote-debugging-port=9222 启动');
  const { send } = await cdpConnect(page.webSocketDebuggerUrl);
  const steps = [];
  // ① 首页
  await send('Page.navigate', { url: 'https://' + host + '/' });
  await new Promise((r) => setTimeout(r, 9000));
  steps.push('① 进入 ' + host);
  // ② 大类目: 从首页 nav_cs_* 链接中找目标类目 (模糊匹配类目名)
  const catName = (opts.category || '').toLowerCase();
  let mainUrl = null;
  if (catName) {
    const r1 = await send('Runtime.evaluate', {
      expression: `(() => {
        var out = [];
        document.querySelectorAll('a[href*="/b/"], a[href*="node="]').forEach(function(a) {
          var t = (a.textContent || '').trim().replace(/\\s+/g, ' ');
          var h = (a.getAttribute('href') || '');
          if (t && t.length > 2 && h) out.push({ t: t, h: h });
        });
        return JSON.stringify(out);
      })()`, returnByValue: true,
    });
    let links = [];
    try { links = JSON.parse(r1.result.value); } catch {}
    const hit = links.find((l) => l.t.toLowerCase().includes(catName));
    if (hit) {
      mainUrl = hit.h.startsWith('http') ? hit.h : 'https://' + host + hit.h;
      steps.push('② 大类目: ' + hit.t);
    }
  }
  if (!mainUrl) {
    // 无类目名 → 用第一个 nav_cs 链接或报错
    const r1 = await send('Runtime.evaluate', {
      expression: `(() => {
        var a = document.querySelector('a[href*="node="][ref*="nav_cs"], a[href*="/b/"]');
        return a ? a.getAttribute('href') : null;
      })()`, returnByValue: true,
    });
    if (!r1.result.value) throw new Error('未找到类目链接');
    mainUrl = 'https://' + host + r1.result.value;
    steps.push('② 大类目(默认): ' + mainUrl.slice(0, 60));
  }
  // ③ 大类目页 → 二级类目 (sv_* 或 node 链接)
  await send('Page.navigate', { url: mainUrl });
  await new Promise((r) => setTimeout(r, 9000));
  let subUrl = null;
  if (catName) {
    const r2 = await send('Runtime.evaluate', {
      expression: `(() => {
        var out = [];
        document.querySelectorAll('a[href*="node="]').forEach(function(a) {
          var t = (a.textContent || '').trim().replace(/\\s+/g, ' ');
          var h = (a.getAttribute('href') || '');
          if (t && t.length > 2 && h && h.includes('node=')) out.push({ t: t, h: h });
        });
        return JSON.stringify(out);
      })()`, returnByValue: true,
    });
    let links2 = [];
    try { links2 = JSON.parse(r2.result.value); } catch {}
    // 找二级类目: 优先含目标关键词, 否则第一个 sv_ 类目
    const subHit = links2.find((l) => l.t.toLowerCase().includes(catName) && !l.h.includes('nav_cs'));
    const sub = subHit || links2.find((l) => l.h.includes('sv_'));
    if (sub) {
      subUrl = sub.h.startsWith('http') ? sub.h : 'https://' + host + sub.h;
      steps.push('③ 二级类目: ' + sub.t);
    }
  }
  if (!subUrl) {
    // 直接在大类目页找 See all results
    const r3 = await send('Runtime.evaluate', {
      expression: `(() => {
        var out = null;
        document.querySelectorAll('a').forEach(function(a) {
          var t = (a.textContent || '').trim().replace(/\\s+/g, ' ');
          if (/See all results|Alle Ergebnisse|View all|查看所有结果/i.test(t)) {
            var h = a.getAttribute('href');
            if (h && !out) out = h;
          }
        });
        return out;
      })()`, returnByValue: true,
    });
    if (r3.result.value) {
      subUrl = r3.result.value.startsWith('http') ? r3.result.value : 'https://' + host + r3.result.value;
      steps.push('③ 直接 See all results');
    }
  }
  if (!subUrl) throw new Error('未找到二级类目或 See all results 链接');
  // ④ 打开 See all results 链接 → 商品搜索页 (找该页的 See all results 跳转)
  let resultsUrl = subUrl;
  await send('Page.navigate', { url: resultsUrl });
  await new Promise((r) => setTimeout(r, 9000));
  const r4 = await send('Runtime.evaluate', {
    expression: `(() => {
      var out = null;
      document.querySelectorAll('a').forEach(function(a) {
        var t = (a.textContent || '').trim().replace(/\\s+/g, ' ');
        if (/See all results|Alle Ergebnisse|View all|查看所有结果/i.test(t)) {
          var h = a.getAttribute('href');
          if (h && !out) out = h;
        }
      });
      return out;
    })()`, returnByValue: true,
  });
  if (r4.result.value) {
    resultsUrl = r4.result.value.startsWith('http') ? r4.result.value : 'https://' + host + r4.result.value;
    steps.push('④ 查看所有结果');
  } else {
    // 已是搜索结果页则直接用
    const isSearch = await send('Runtime.evaluate', { expression: 'location.href.includes("/s?")', returnByValue: true });
    if (!isSearch.result.value) {
      // 找 "See all N results" 或第一个 /s? 链接
      const r5 = await send('Runtime.evaluate', {
        expression: `(() => {
          var a = document.querySelector('a[href*="/s?"]');
          return a ? a.getAttribute('href') : null;
        })()`, returnByValue: true,
      });
      if (r5.result.value) resultsUrl = 'https://' + host + r5.result.value;
    }
    steps.push('④ 商品列表页');
  }
  // ⑤ 并行打开 N 页采集 (复用 cdpSiteBulkCollect 的列表提取逻辑)
  const productsOut = [];
  const seen = new Set();
  const jobs = [];
  for (let pg = 1; pg <= pages; pg++) {
    if (collectStopRequested()) break;
    jobs.push((async () => {
      let tab = null;
      try {
        tab = await cdpCreateTab('https://' + host + '/');
        const { send: s2 } = await cdpConnect(tab.wsUrl);
        const pgUrl = pg === 1 ? resultsUrl : resultsUrl + (resultsUrl.includes('?') ? '&' : '?') + 'page=' + pg;
        await s2('Page.navigate', { url: pgUrl });
        await new Promise((r) => setTimeout(r, 9000));
        for (let i = 0; i < 4; i++) { await s2('Runtime.evaluate', { expression: `window.scrollTo(0, ${(i + 1) * 4000})` }); await new Promise((r) => setTimeout(r, 800)); }
        const r = await s2('Runtime.evaluate', {
          expression: `(() => {
            const out = [];
            document.querySelectorAll('div[data-asin]').forEach(el => {
              const asin = el.getAttribute('data-asin');
              if (!asin || !/^[A-Z0-9]{10}$/.test(asin) || !el.querySelector('a[href*="/dp/"]')) return;
              const t = el.querySelector('h2 span, h2');
              const pr = el.querySelector('.a-price .a-offscreen, .a-price-whole');
              const lk = el.querySelector('a[href*="/dp/"]');
              // 标题清理: 去掉 " | " 后面的变体/颜色文本, 只保留主标题
              let title = t ? t.textContent.trim() : '';
              const barIdx = title.indexOf(' | ');
              if (barIdx > 10) title = title.slice(0, barIdx);
              const rt = el.querySelector('.a-icon-alt');
              let badge = null;
              const detectBadge = (t) => {
                if (/Amazon's Choice/i.test(t)) return 'choice';
                if (/#1 Best Seller/i.test(t)) return 'bestseller1';
                if (/^Best Seller/i.test(t) || /Best Seller in/i.test(t)) return 'bestseller';
                if (/New Release/i.test(t)) return 'newrelease';
                if (/Deal of the Day/i.test(t)) return 'dealday';
                if (/Limited time deal/i.test(t)) return 'deal';
                if (/Overall Pick/i.test(t)) return 'overallpick';
                if (/Editor'?s Pick/i.test(t)) return 'editorspick';
                if (/Top Rated/i.test(t)) return 'toprated';
                if (/Climate Pledge Friendly/i.test(t)) return 'climate';
                if (/Small Business/i.test(t)) return 'smallbusiness';
                return null;
              };
              const bEl = el.querySelector('[id*="acBadge"], .ac-badge, [class*="badge"], img[alt*="Choice"], img[alt*="Bestseller"], [id*="bestseller"]');
              if (bEl) badge = detectBadge((bEl.textContent || bEl.getAttribute('alt') || '').trim().replace(/\\s+/g, ' '));
              if (!badge) badge = detectBadge((el.textContent || '').slice(0, 800));
              // 插件排名标签
              const rankList = [...el.querySelectorAll('.ranktag')]
                .map(x => (x.textContent || '').trim())
                .map(x => { const rm = x.match(/#?([\\d.,]+)/); return rm ? parseInt(rm[1].replace(/[.,]/g, ''), 10) : null; })
                .filter(x => x != null);
              // ★ 2026-09 统一不跳转: 详情补全默认关 → 卡片上本来就有的字段必须就地取全
              const _cfReviews3 = el.querySelector('a[aria-label*="ratings"], .a-size-base.s-underline-text');
              const _cfImg3 = el.querySelector('img.s-image');
              let _cfBrand3 = null;
              el.querySelectorAll('a[href*="field-keywords="]').forEach((a) => { if (_cfBrand3) return; const _t4 = (a.textContent || '').trim(); if (_t4 && _t4.length < 60) _cfBrand3 = _t4; });
              let _cfPanel3 = '';
              el.querySelectorAll('[class*="zying"], [class*="zy-"], [id*="zying"]').forEach((n) => {
                const _p4 = (n.innerText || n.textContent || '').replace(/\\s+/g, ' ').trim();
                if (/ASIN\\s*[:：]/.test(_p4) && _p4.length > _cfPanel3.length) _cfPanel3 = _p4;
              });
              out.push({ asin, title: title.slice(0, 200), price: pr ? pr.textContent.trim() : '', link: lk ? lk.href : '', rating: rt ? rt.textContent.trim().match(/([\\d.,]+)\\s*out of/) : null, badge, bsr: rankList,
                reviews: _cfReviews3 ? (_cfReviews3.textContent || '').trim().slice(0, 20) : null,
                mainImage: _cfImg3 ? _cfImg3.getAttribute('src') : null, brand: _cfBrand3, panelTxt: _cfPanel3 || null });
            });
            return JSON.stringify(out);
          })()`, returnByValue: true,
        });
        let items = [];
        try { items = JSON.parse(r.result.value); } catch {}
        normalizeListCards(items);   // ★ 统一不跳转: 卡片字段归一化 + 插件面板就地解析 (商标/月销/排名)
        return { pg, items };
      } catch (e) {
        return { pg, items: [], error: e.message };
      } finally {
        if (tab) { try { await cdpCloseTab(tab.targetId); } catch {} }
      }
    })());
  }
  const settled = await Promise.allSettled(jobs);
  settled.forEach((st) => {
    if (st.status !== 'fulfilled' || !st.value) return;
    (st.value.items || []).forEach((x) => {
      if (!x.asin || seen.has(x.asin)) return;
      seen.add(x.asin);
      productsOut.push(x);
    });
  });
  bumpCollectProgress({ step: '类目翻页采集', items: productsOut.length, page: pages, pages });
  if (!productsOut.length) throw new Error('未提取到商品');
  const list = productsOut.slice(0, maxItems);
  // ⑥ 可选详情读取 (价格/品牌)
  if (withDetail && list.length) {
    for (const it of list) {
      bumpCollectProgress({ step: '读详情', items: productsOut.length, detailDone: list.indexOf(it) + 1, detailTotal: list.length });
      try {
        await send('Page.navigate', { url: 'https://' + host + '/dp/' + it.asin });
        await new Promise((r) => setTimeout(r, 7000));
        const r = await send('Runtime.evaluate', {
          expression: `(() => {
            const out = { price: null, brand: null, rating: null, reviews: null };
            const sels = ['#corePrice_feature_div .a-offscreen', '.apex-pricetopay-value', '#price_inside_buybox', '.a-price .a-offscreen'];
            for (const sel of sels) {
              const el = document.querySelector(sel);
              if (el) {
                const t = (el.textContent || '').trim().replace(/\\s+/g, ' ');
                const m = t.match(/(?:€|£|A\\$|AU\\$|US\\$|C\\$|CA\\$|\\$|EUR|GBP|USD|AUD)\\s*([\\d.,]+)/);
                if (m) { out.price = parseFloat(m[1].replace(/,/g, '')); break; }
              }
            }
            const b = document.querySelector('#bylineInfo a, #bylineInfo_feature_div a');
            if (b) { let bt = b.textContent.trim().replace(/\\s+/g, ' ').replace(/^Brand:\\s*/i, '').trim(); if (bt && bt.length > 1 && bt.length < 60) out.brand = bt; }
            const rEl = document.querySelector('#acrPopover .a-icon-alt, [data-hook="rating-out-of-text"]');
            if (rEl) { const m = rEl.textContent.match(/([\\d.,]+)\\s*out of/); if (m) out.rating = parseFloat(m[1].replace(',', '.')); }
            const revEl = document.querySelector('#acrCustomerReviewText, [data-hook="total-review-count"]');
            if (revEl) { const m = revEl.textContent.match(/([\\d.,]+)/); if (m) out.reviews = parseInt(m[1].replace(/[.,]/g, ''), 10); }
            // A+ 页面标记 (只认品牌 A+ 内容区 #aplus_feature_div / #aplus, 不用宽泛的 [id*=aplus] 避免误匹配)
            out.aplus = !!document.querySelector('#aplus_feature_div, #aplus');
            // 配送方式: FBA / FBM
            out.fulfill = null;
            const mi = document.querySelector('#merchant-info, #fulfillerInfoFeature_feature_div');
            const pageTxt = document.body ? document.body.textContent : '';
            // 配送方式: FBA 标志 → FBA; 明确 FBM 标志(卖家自发货) → FBM; 有配送区域但无 FBA 词 → FBM; 否则 null
            const FBA_RE = /Dispatches? from Amazon|Fulfilled by Amazon|Versand durch Amazon|Ships from Amazon|Exp[ée]di[ée] par Amazon|Vendido por Amazon|Enviado por Amazon|Venduto e spedito da Amazon|Spedito da Amazon|亚马逊配送|亚马逊物流|Verkauf und Versand durch Amazon/i;
            const FBM_RE = /Dispatched from and sold by|Verkauf und Versand durch(?! Amazon)|Exp[ée]di[ée] (?:et vendu )?par(?!\\s*Amazon)|Vendu et exp[ée]di[ée] par(?!\\s*Amazon)|Vendido y enviado por(?!\\s*Amazon)|Venduto e spedito da(?!\\s*Amazon)|发货方和销售方/i;
            if (mi) {
              const mt = (mi.textContent || '');
              if (FBA_RE.test(mt)) out.fulfill = 'FBA';
              else if (mt.trim().length > 3) out.fulfill = 'FBM';
            }
            if (!out.fulfill) {
              if (FBA_RE.test(pageTxt)) out.fulfill = 'FBA';
              else if (FBM_RE.test(pageTxt)) out.fulfill = 'FBM';
            }
            // BSR 排名 (详情表)
            out.bsr = [];
            document.querySelectorAll('table.a-keyvalue.prodDetTable tr').forEach(function(tr) {
              var th = tr.querySelector('th');
              var td = tr.querySelector('td');
              if (!th || !td) return;
              var k = th.textContent.replace(/\\s+/g, ' ').trim().toLowerCase();
              var v = td.textContent.replace(/\\s+/g, ' ').trim();
              if (/best sellers rank/i.test(k)) {
                // 新版页面无 # 前缀 ("164,986 in Automotive"); 德语页 "Nr. 187.250 in"; 数字支持 , 和 . 千分位
                // 排除 "See Top 100 in" 里的 Top N (误抓为排名)
                var clean = v.replace(/See Top\s+[\d.,]+\s+in\s+/gi, '').replace(/Top\s+[\d.,]+\s+in\s+/gi, '');
                var re = /(?:#\\s*|Nr\\.?\\s*)?([\\d.,]+)\\s+in\\s+([^(]+)/g;
                var m;
                while ((m = re.exec(clean)) !== null) out.bsr.push({ rank: parseInt(m[1].replace(/[.,]/g, ''), 10), category: m[2].trim().slice(0, 40) });
              }
            });
            return JSON.stringify(out);
          })()`, returnByValue: true,
        });
        const d = JSON.parse(r.result.value);
        if (d.price != null) it.price = d.price;
        if (d.brand) it.brand = d.brand;
        if (d.rating != null) it.rating = d.rating;
        if (d.reviews != null) it.reviews = d.reviews;
        if (d.aplus) it.aplus = true;
        if (d.fulfill) it.fulfill = d.fulfill;
        if (d.bsr && d.bsr.length) it.bsr = d.bsr;
        // ===== 采集过滤: 与自定义筛选同条件, 不符合的商品标记跳过 (不采集) =====
        it.__skip = !applyCollectFilter(it, opts.filter);
      } catch (e) { console.error('[catmenu-detail]', it.asin, '异常:', e && e.message); }
    }
  }
  // 过滤掉不符合采集条件的商品 (只保留被过滤出的)
  const filtered = list.filter((x) => !x.__skip);
  list.forEach((x) => delete x.__skip);
  return { site, host, url: resultsUrl, pages, steps, productCount: filtered.length, products: filtered, skipped: list.length - filtered.length };
}

// ===== 跟卖店铺采集 (完整链路, 全程 CDP) =====
// 流程: 商品信息(详情页 aod 面板) → 出售单位跳转链接(sellerUrl/aag) → 出售单位详情页(/sp)
//       → 参观出售单位链接(storefront) → 该出售单位店铺全部商品 (商品数/页数双限制)
// 输入: 商品详情 URL (如 https://www.amazon.de/dp/B0XXXX) 或直接出售单位链接 (aag/main 或 /sp)
async function cdpFollowShopChain(url, opts = {}) {
  // 0 = 无限制 (商品数/翻页)
  const maxItems = opts.maxItems === 0 ? Infinity : Math.min(100, Math.max(1, opts.maxItems || 30));   // 商品数上限
  const maxPages = opts.maxPages === 0 ? Infinity : Math.min(20, Math.max(1, opts.maxPages || 3));     // 翻页上限
  // 滚动到底部触发懒加载 (排名/详情表)
  async function evScrollBottom(send) {
    try {
      for (let i = 0; i < 5; i++) {
        await send('Runtime.evaluate', { expression: 'window.scrollTo(0, document.body.scrollHeight)' });
        await new Promise((r) => setTimeout(r, 700));
      }
    } catch {}
  }
  let send;
  if (opts.wsUrl) {
    // 并行模式: 使用外部传入的独立标签页连接
    const c = await cdpConnect(opts.wsUrl);
    send = c.send;
  } else {
    const tabs = await cdpGetTabs();
    // 优先用 amazon 标签页 (避免把用户正在看的 demo 页导航走); 没有则用任意 page
    const page = tabs.find((t) => t.type === 'page' && /amazon\.(com\.au|co\.uk|com|com\.mx|com\.br|de|fr|it|es|co\.jp|ca|in|nl|se|pl)/.test(t.url))
      || tabs.find((t) => t.type === 'page' && !t.url.includes('3088') && !t.url.startsWith('data:'))
      || tabs.find((t) => t.type === 'page');
    if (!page) throw new Error('Edge 无可用页面标签, 请确认 Edge 以 --remote-debugging-port=9222 启动');
    const c = await cdpConnect(page.webSocketDebuggerUrl);
    send = c.send;
  }
  const siteMatch = url.match(/amazon\.(com\.au|co\.uk|com|com\.mx|com\.br|de|fr|it|es|co\.jp|ca|in|nl|se|pl)/);
  let site = siteMatch && CDP_SITE_CODE[siteMatch[1]] ? CDP_SITE_CODE[siteMatch[1]] : 'de';
  let host = 'www.amazon.' + siteToHostSuffix(site);

  const steps = [];
  // ===== ① 输入商品详情 URL → aod 面板提取出售单位链接 =====
  let sellerUrl = null, sellerId = null, sellerName = null;
  const dpM = url.match(/\/dp\/([A-Z0-9]{10})/);
  if (dpM) {
    const asin = dpM[1];
    steps.push('商品 ' + asin + ' → aod 跟卖面板 (找出售单位跳转链接)');
    await send('Page.navigate', { url: 'https://' + host + '/dp/' + asin + '/ref=olp-opf-redir?aod=1&ie=UTF8&condition=new' });
    await new Promise((r) => setTimeout(r, 9000));
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 2500));
      const r = await send('Runtime.evaluate', {
        expression: `(() => {
          const list = document.querySelector('#aod-offer-list');
          if (!list) return JSON.stringify({ ready: false });
          let found = null;
          list.querySelectorAll('#aod-offer').forEach(o => {
            if (found) return;
            let el = o.querySelector('a[href*="/gp/aag/main"], a[href*="aag/main?"]');
            if (!el) { const all = o.querySelectorAll('a[href*="seller="]'); for (const a of all) { const t = (a.textContent || '').trim(); if (t && !/^Details/i.test(t) && !/^More/i.test(t)) { el = a; break; } } }
            if (el) {
              const aria = el.getAttribute('aria-label') || '';
              const m = aria.match(/^([^.]+)/);
              const raw = (m ? m[1] : el.textContent.trim()).trim();
              const hm = (el.getAttribute('href') || '').match(/seller=([A-Z0-9]+)/);
              const href = el.getAttribute('href') || '';
              const isAag = href.includes('aag/main');
              found = {
                seller: raw && !/^Details/i.test(raw) && !/^More/i.test(raw) ? raw : null,
                sellerId: hm ? hm[1] : null,
                sellerUrl: isAag ? (href.startsWith('http') ? href : 'https://' + location.hostname + href) : null,
              };
            }
          });
          return JSON.stringify({ ready: !!found, ...(found || {}) });
        })()`, returnByValue: true,
      });
      const d = JSON.parse(r.result.value);
      if (d.ready) { sellerUrl = d.sellerUrl; sellerId = d.sellerId; sellerName = d.seller; break; }
    }
    if (!sellerUrl) {
      // aod 未给出售单位链接 → 详情页 byline 兜底
      await send('Page.navigate', { url: 'https://' + host + '/dp/' + asin });
      await new Promise((r) => setTimeout(r, 9000));
      const r2 = await send('Runtime.evaluate', {
        expression: `(() => {
          let el = document.querySelector('#sellerProfileTriggerId, a[href*="/gp/aag/main"], #bylineInfo a[href*="seller="]');
          if (!el) return JSON.stringify({ found: false });
          const href = el.getAttribute('href') || '';
          const hm = href.match(/seller=([A-Z0-9]+)/);
          return JSON.stringify({ found: true, sellerUrl: href.startsWith('http') ? href : 'https://' + location.hostname + href, sellerId: hm ? hm[1] : null });
        })()`, returnByValue: true,
      });
      const d2 = JSON.parse(r2.result.value);
      if (d2.found) { sellerUrl = d2.sellerUrl; sellerId = d2.sellerId; }
    }
    if (!sellerUrl) {
      // aod 面板 + byline 兜底均未找到出售单位 → 诊断页面状态给出明确原因 (复用 aod 失败诊断)
      let code = 'structure';
      try {
        const dg = await send('Runtime.evaluate', {
          expression: `(() => { const bt = (document.body && document.body.innerText ? document.body.innerText : (document.body ? document.body.textContent : '')).slice(0, 20000); return bt; })()`, returnByValue: true,
        });
        code = classifyAodFailure(dg.result.value);
      } catch {}
      const reason = aodFailReason(code);
      throw new Error('aod 面板未找到出售单位链接: ' + reason + (code === 'no-offers' ? ' (可用「多商品并行采集」自动复用商品库历史卖家继续采集)' : ''));
    }
    steps.push('→ 出售单位: ' + (sellerName || sellerId || sellerUrl.slice(0, 60)));
  } else if (/aag\/main|\/sp\?/.test(url)) {
    // ② 直接给出售单位链接 (aag/main 或 /sp)
    sellerUrl = url;
    const sm = url.match(/seller=([A-Z0-9]+)/);
    if (sm) sellerId = sm[1];
    steps.push('直接使用出售单位链接');
  } else {
    throw new Error('请输入商品详情 URL (dp/B0XXXX) 或出售单位链接 (aag/main, /sp)');
  }

  // ===== ② 跳转出售单位详情页 (aag/main 会自动重定向到 /sp 卖家资料页) =====
  await send('Page.navigate', { url: sellerUrl });
  await new Promise((r) => setTimeout(r, 10000));
  const spUrl = await send('Runtime.evaluate', { expression: 'location.href', returnByValue: true }).then((r) => r.result.value);
  steps.push('→ 出售单位详情页: ' + (spUrl || sellerUrl).slice(0, 90));
  // 从 /sp 页读取出售单位名称 (Seller Profile 标题, 如 "Amazon.de Seller Profile: xiaomatongxue")
  if (!sellerName) {
    const rName = await send('Runtime.evaluate', {
      expression: `(() => {
        const h1 = document.querySelector('#aag-main-content h1, .aag-profile-name, h1, #seller-page-content h1');
        if (h1) { const t = h1.textContent.trim().replace(/\\s+/g, ' '); const m = t.match(/Profile:\\s*(.+)$/i); if (m) return m[1].trim(); return t; }
        const title = document.title || '';
        const tm = title.match(/Profile:\\s*(.+)$/i);
        return tm ? tm[1].trim() : null;
      })()`, returnByValue: true,
    });
    const nm = rName.result && rName.result.value;
    if (nm && nm.length < 60) sellerName = nm;
    steps.push('→ 出售单位名称: ' + (sellerName || '?'));
  }

  // ===== ③ 找「参观出售单位」链接 (Visit the X Store 品牌店 / See all products / storefront) =====
  const r3 = await send('Runtime.evaluate', {
    expression: `(() => {
      let storeUrl = null;
      let brandName = null;
      let visitStoreLink = false;   // 链接文本是否为 "Visit the X Store / storefront" 品牌店字样
      // ① 优先: "Visit the Anker Store" 品牌店链接 (/stores/...), 同时提取品牌名
      document.querySelectorAll('a[href*="/stores/"]').forEach(a => {
        if (storeUrl) return;
        const h = a.getAttribute('href') || '';
        const t = (a.textContent || '').trim();
        if (/Visit the |Visit |Besuchen Sie den |Store|Shop/i.test(t) && (h.includes('/stores/') || h.includes('me='))) {
          storeUrl = h;
          if (/Visit the |Visit |Besuchen Sie den /i.test(t)) visitStoreLink = true;
          const m = t.match(/(?:Visit the|Visit|Besuchen Sie den)\\s+([A-Za-z0-9 .\\-&']+?)\\s+Store/i);
          if (m) brandName = m[1].trim();
        }
      });
      // ② "See all products" / storefront 链接
      if (!storeUrl) {
        document.querySelectorAll('a[href*="/s?"], a[href*="s?ie=UTF8"]').forEach(a => {
          if (storeUrl) return;
          const h = a.getAttribute('href') || '';
          const t = (a.textContent || '').trim();
          if (h.includes('me=') && (/storefront|See all|products|Store|Shop/i.test(t) || /storefront|See all/i.test(h))) {
            storeUrl = h;
            // "Visit the AnkerDirect DE storefront" 等品牌店字样
            if (/Visit the |Visit |Besuchen Sie den /i.test(t) && /storefront|Store/i.test(t)) visitStoreLink = true;
          }
        });
      }
      // ③ 兜底: 任何 me= 链接
      if (!storeUrl) {
        document.querySelectorAll('a[href*="me="]').forEach(a => {
          if (storeUrl) return;
          const h = a.getAttribute('href') || '';
          if (h.includes('/s?') || h.includes('merchant-items') || h.includes('/stores/')) storeUrl = h;
        });
      }
      return JSON.stringify({ storeUrl, brandName, visitStoreLink });
    })()`, returnByValue: true,
  });
  const storeInfo = JSON.parse(r3.result.value);
  if (!storeInfo.storeUrl) throw new Error('出售单位详情页未找到「Visit the Store/See all products」链接');
  let storeUrl = storeInfo.storeUrl.startsWith('http') ? storeInfo.storeUrl : 'https://' + host + storeInfo.storeUrl;
  const storeBrand = storeInfo.brandName || null;
  const hasVisitStoreLink = !!storeInfo.visitStoreLink;   // 店铺带 "Visit the X Store/storefront" 品牌店链接
  steps.push('→ 参观出售单位 → 店铺全部商品页: ' + storeUrl.slice(0, 80) + (storeBrand ? ' (品牌店: ' + storeBrand + ')' : '') + (hasVisitStoreLink ? ' (Visit Store 链接)' : ''));

  // ===== ③.3 邮编/配送地址: 用户输入邮编 → 进店前用 glow 设置 (报价/可配送判断正确) =====
  if (opts.zip && !collectStopRequested()) {
    try {
      const zSet = await cdpSetGlowAddress(send, storeUrl, site, opts.zip);
      steps.push('→ 配送邮编设置: ' + opts.zip + (zSet ? ' 已生效' : ' (可能未更新, 继续)'));
    } catch (e) { console.error('[glow]', '进店前设邮编失败:', e && e.message); }
  }

  // ===== ③.4 品牌店筛选 (可选): ① 品牌店铺类型 (仅采/排除) ② 指定品牌 (如 "Anker") =====
  // 品牌店铺识别 (启发式):
  //   a) /sp 页有 "Visit the X Store" 品牌店链接 (storeBrand 非空, 来自 /stores/ 品牌页)
  //   b) 卖家名/品牌名含官方直营特征: Direct / Official / 官方 / 旗舰 (如 AnkerDirect DE)
  const hasBrandStoreLink = !!storeBrand;
  const sellerRawName = String(sellerName || '') + ' ' + String(storeBrand || '');
  const directMark = /direct|official|官方|旗舰/i.test(sellerRawName);
  const isBrandShop = hasBrandStoreLink || directMark;
  // ② 品牌店铺类型: opts.brandShop '1'=仅采品牌店铺 / '0'=排除品牌店铺 (只采普通第三方店) / 空=不限
  if (opts.brandShop === '1' || opts.brandShop === '0') {
    if (opts.brandShop === '1' && !isBrandShop) {
      steps.push('→ 品牌店铺筛选: 非品牌店铺(普通第三方店) → 跳过不采集');
      return { site, host, sellerUrl, sellerId, sellerName, spUrl, storeUrl, products: [], skipped: 0, shopSkipped: true, brandShopSkip: true, isBrandShop: false, brandShop: opts.brandShop, steps, send };
    }
    if (opts.brandShop === '0' && isBrandShop) {
      steps.push('→ 品牌店铺筛选: 品牌店铺「' + (storeBrand || sellerName || '?') + '」→ 排除不采集');
      return { site, host, sellerUrl, sellerId, sellerName, spUrl, storeUrl, products: [], skipped: 0, shopSkipped: true, brandShopSkip: true, isBrandShop: true, brandName: storeBrand, brandShop: opts.brandShop, steps, send };
    }
    steps.push('→ 品牌店铺筛选: ' + (isBrandShop ? '品牌店铺「' + (storeBrand || sellerName) + '」' : '普通第三方店铺'));
  }
  // ① 指定品牌: opts.brandStore
  //    - 以 "!" 开头 → 排除模式: 排除所有带 "Visit the X Store/storefront" 品牌店链接的店铺
  //    - 品牌名 (如 "Anker") → 只采该品牌, 过滤掉不是该品牌的店铺
  if (opts.brandStore) {
    const raw = String(opts.brandStore).trim();
    if (raw.startsWith('!')) {
      if (hasVisitStoreLink) {
        steps.push('→ 品牌店筛选(排除): 店铺带 "Visit the X Store/storefront" 链接 → 跳过不采集');
        return { site, host, sellerUrl, sellerId, sellerName, spUrl, storeUrl, products: [], skipped: 0, shopSkipped: true, brandShopSkip: true, brandName: storeBrand, brandStore: opts.brandStore, steps, send };
      }
      steps.push('→ 品牌店筛选(排除): 无品牌店链接, 保留');
    } else {
      const target = raw.toLowerCase();
      const brand = String(storeBrand || '').trim().toLowerCase();
      const hit = brand && (brand.includes(target) || target.includes(brand));
      if (!hit) {
        steps.push(`→ 品牌店筛选: 店铺品牌「${storeBrand || '非品牌店'}」≠ ${raw} → 跳过不采集`);
        return { site, host, sellerUrl, sellerId, sellerName, spUrl, storeUrl, products: [], skipped: 0, shopSkipped: true, brandSkip: true, brandName: storeBrand, brandStore: opts.brandStore, steps, send };
      }
      steps.push(`→ 品牌店筛选: 命中品牌店「${storeBrand}」`);
    }
  }

  // ===== ③.5 店铺 A+ 过滤 (可选): 打开店铺页检测是否品牌店/A+ 店铺 =====
  // opts.shopAplus: '1'=仅采有A+的店铺 / '0'=排除有A+的店铺 / 空=不限
  if (opts.shopAplus === '1' || opts.shopAplus === '0') {
    try {
      await send('Page.navigate', { url: storeUrl });
      await new Promise((r) => setTimeout(r, 8000));
      const rA = await send('Runtime.evaluate', {
        expression: `(() => {
          const url = location.href;
          const bt = (document.body ? document.body.textContent : '').slice(0, 120000);
          // 品牌旗舰店: URL 含 /stores/ 或页面标记 Brand Store
          const isBrandStore = /\\/stores\\//i.test(url) || /Brand Store|Marken-Store|品牌旗舰店/i.test(bt);
          // A+ 内容: 页面 A+ 区域或 A+ 徽标
          const hasAplus = !!document.querySelector('#aplus_feature_div, #aplus, [id*="aplus"]')
            || /A\\+ Content|A\\+ 页面|A\\+ Produktseite/i.test(bt);
          return JSON.stringify({ aplusShop: !!(isBrandStore || hasAplus), isBrandStore });
        })()`, returnByValue: true,
      });
      const shopA = JSON.parse(rA.result.value);
      const aplusShop = !!shopA.aplusShop;
      const wantAplus = opts.shopAplus === '1';   // 仅采有 A+ 的店铺
      if (wantAplus && !aplusShop) {
        steps.push('→ 店铺 A+ 过滤: 该店铺无 A+ → 跳过不采集');
        return { site, host, sellerUrl, sellerId, sellerName, spUrl, storeUrl, products: [], skipped: 0, shopSkipped: true, aplusShop: false, shopAplus: opts.shopAplus, steps, send };
      }
      if (!wantAplus && opts.shopAplus === '0' && aplusShop) {
        steps.push('→ 店铺 A+ 过滤: 该店铺有 A+ → 跳过不采集');
        return { site, host, sellerUrl, sellerId, sellerName, spUrl, storeUrl, products: [], skipped: 0, shopSkipped: true, aplusShop: true, shopAplus: opts.shopAplus, steps, send };
      }
      steps.push('→ 店铺 A+ 检测: ' + (aplusShop ? '有 A+ (品牌店)' : '无 A+'));
    } catch (e) {
      console.error('[shop-aplus]', '店铺 A+ 检测失败:', e && e.message);
    }
  }

  // ===== ④ 店铺页翻页采集全部商品 (商品数/页数双限制) =====
  const products = [];
  const seen = new Set();
  // 翻页采集一轮 (返回是否采到商品)
  async function collectShopPages() {
    for (let pg = 1; pg <= maxPages && products.length < maxItems; pg++) {
      if (collectStopRequested()) break;
      const pgUrl = pg === 1 ? storeUrl : storeUrl + (storeUrl.includes('?') ? '&' : '?') + 'page=' + pg;
      await send('Page.navigate', { url: pgUrl });
      await new Promise((r) => setTimeout(r, 8000));
      for (let i = 0; i < 5; i++) { await send('Runtime.evaluate', { expression: `window.scrollTo(0, ${(i + 1) * 4000})` }); await new Promise((r) => setTimeout(r, 1000)); }
      await new Promise((r) => setTimeout(r, 1500));
      const r4 = await send('Runtime.evaluate', {
        expression: `(() => {
          const out = [];
          document.querySelectorAll('div[data-asin]').forEach(el => {
            const asin = el.getAttribute('data-asin');
            if (!asin || !/^[A-Z0-9]{10}$/.test(asin)) return;
            const lk = el.querySelector('a[href*="/dp/"]');
            // 商品判定: 有 /dp/ 链接即可 (不放宽图片条件 — 店铺页商品图懒加载,
            // 8s+滚动后图片常未就绪, 按图过滤会把有商品误判为空; 详情页修正阶段会补全标题/价格/主图)
            if (!lk) return;
            const t = el.querySelector('h2 span, h2');
            const pr = el.querySelector('.a-price .a-offscreen, .a-price-whole');
            // 插件排名标签 (de 等站点店铺页插件渲染 ranktag; uk 站不渲染 → 详情修正兜底)
            const rankList = [...el.querySelectorAll('.ranktag')]
              .map(x => (x.textContent || '').trim())
              .map(x => { const rm = x.match(/#?([\\d.,]+)/); return rm ? parseInt(rm[1].replace(/[.,]/g, ''), 10) : null; })
              .filter(x => x != null);
            // ★ 2026-09 统一不跳转: 跟卖链进入店铺后不再逐个跳详情页, 卡片上的字段必须就地取全
            const _cfRating4 = el.querySelector('.a-icon-alt, [aria-label*="out of 5"]');
            const _cfReviews4 = el.querySelector('a[aria-label*="ratings"], .a-size-base.s-underline-text');
            const _cfImg4 = el.querySelector('img.s-image');
            let _cfBrand4 = null;
            el.querySelectorAll('a[href*="field-keywords="]').forEach((a) => { if (_cfBrand4) return; const _t5 = (a.textContent || '').trim(); if (_t5 && _t5.length < 60) _cfBrand4 = _t5; });
            let _cfPanel4 = '';
            el.querySelectorAll('[class*="zying"], [class*="zy-"], [id*="zying"]').forEach((n) => {
              const _p5 = (n.innerText || n.textContent || '').replace(/\\s+/g, ' ').trim();
              if (/ASIN\\s*[:：]/.test(_p5) && _p5.length > _cfPanel4.length) _cfPanel4 = _p5;
            });
            out.push({ asin, title: t ? t.textContent.trim().slice(0, 200) : '', price: pr ? pr.textContent.trim() : '', link: lk.href || '', bsr: rankList,
              rating: _cfRating4 ? (_cfRating4.getAttribute('aria-label') || _cfRating4.textContent || '').trim().slice(0, 40) : null,
              reviews: _cfReviews4 ? (_cfReviews4.textContent || '').trim().slice(0, 20) : null,
              mainImage: _cfImg4 ? _cfImg4.getAttribute('src') : null, brand: _cfBrand4, panelTxt: _cfPanel4 || null });
          });
          return JSON.stringify(out);
        })()`, returnByValue: true,
      });
      let items = [];
      try { items = JSON.parse(r4.result.value); } catch {}
      normalizeListCards(items);   // ★ 统一不跳转: 跟卖链店铺卡片字段归一化 + 插件面板就地解析
      const fresh = items.filter((x) => !seen.has(x.asin));
      fresh.forEach((x) => seen.add(x.asin));
      products.push(...fresh.map(applyRankFields));
      // 第一页采到商品但全无插件排名 → 翻到第二页触发插件加载, 回读第一页补排名
      // (插件对部分店铺页第一页不渲染 ranktag, 翻页后才激活; 实测 uk/de 均可能)
      if (pg === 1 && products.length && !products.some((x) => x.bsr && x.bsr.length)) {
        const page2 = storeUrl + (storeUrl.includes('?') ? '&' : '?') + 'page=2';
        await send('Page.navigate', { url: page2 });
        await new Promise((r) => setTimeout(r, 9000));
        for (let s = 0; s < 3; s++) { await send('Runtime.evaluate', { expression: `window.scrollTo(0, ${(s + 1) * 4000})` }); await new Promise((r) => setTimeout(r, 800)); }
        // 回第一页重采 (插件已激活, 给第一页商品补排名)
        await send('Page.navigate', { url: pgUrl });
        await new Promise((r) => setTimeout(r, 9000));
        for (let s = 0; s < 3; s++) { await send('Runtime.evaluate', { expression: `window.scrollTo(0, ${(s + 1) * 4000})` }); await new Promise((r) => setTimeout(r, 800)); }
        const r5 = await send('Runtime.evaluate', {
          expression: `(() => {
            const out = [];
            document.querySelectorAll('div[data-asin]').forEach(el => {
              const asin = el.getAttribute('data-asin');
              if (!asin || !/^[A-Z0-9]{10}$/.test(asin) || !el.querySelector('a[href*="/dp/"]')) return;
              const rankList = [...el.querySelectorAll('.ranktag')]
                .map(x => (x.textContent || '').trim())
                .map(x => { const rm = x.match(/#?([\\d.,]+)/); return rm ? parseInt(rm[1].replace(/[.,]/g, ''), 10) : null; })
                .filter(x => x != null);
              out.push({ asin, bsr: rankList });
            });
            return JSON.stringify(out);
          })()`, returnByValue: true,
        });
        try {
          const items2 = JSON.parse(r5.result.value);
          const rankMap = {};
          items2.forEach((y) => { if (y.bsr && y.bsr.length) rankMap[y.asin] = y.bsr; });
          let fixed = 0;
          products.forEach((x) => { if (!(x.bsr && x.bsr.length) && rankMap[x.asin]) { x.bsr = rankMap[x.asin]; fixed++; } });
          if (fixed > 0) steps.push('→ 店铺页翻页触发插件后, 补采到 ' + fixed + ' 个商品排名');
        } catch {}
      }
      if (items.length < 16) break; // 无更多页
    }
    return products.length > 0;
  }
  // 首次采集; 失败自动刷新重试一次 (店铺页异步渲染慢/网络波动常见, 重试显著降低"结构未识别"误报)
  let gotShop = await collectShopPages();
  if (!gotShop && !collectStopRequested()) {
    steps.push('→ 店铺页首次未提取到商品, 刷新重试一次');
    await send('Page.reload', {});
    await new Promise((r) => setTimeout(r, 10000));
    gotShop = await collectShopPages();
  }
  if (!gotShop) {
    // 店铺页失败诊断: 区分 店铺关闭/验证码/登录墙/店铺无商品/结构异常 (与 aod 诊断对称)
    // 注意: div[data-asin] 可能含空 asin 占位(无结果提示/帮助链接), 须统计有效 ASIN 数避免误导
    let code = 'structure';
    let detail = '';
    try {
      const dg = await send('Runtime.evaluate', {
        expression: `(() => {
          // innerText 仅可见文本 (不含 script/json), No results 提示不会被超长 JS 挤出截断
          const bt = (document.body && document.body.innerText ? document.body.innerText : (document.body ? document.body.textContent : '')).slice(0, 20000);
          const validAsins = [...document.querySelectorAll('div[data-asin]')].filter((el) => /^[A-Z0-9]{10}$/.test(el.getAttribute('data-asin') || '')).length;
          return JSON.stringify({ url: location.href, title: document.title, validAsins, txt: bt });
        })()`, returnByValue: true,
      });
      const info = JSON.parse(dg.result.value);
      code = classifyShopPageFailure(info.txt);
      if (code === 'structure') detail = ` (URL=${info.url}, 有效ASIN=${info.validAsins}, 标题=${info.title || '?'}, 文本: ${info.txt.slice(0, 150)})`;
    } catch {}
    // ===== 跨站回退: 当前站点店铺无商品 → 尝试勾选的其他站点 (filter.sites) 同卖家店铺 =====
    // 背景: 同一卖家可能只在部分站点有在售商品 (如 de 站店铺 No results, 但 uk 站有完整店铺);
    // 站点多选后勾选的站点即回退目标 (自动排除当前站点)
    const fbSites = ((opts.filter && opts.filter.sites) || []).filter((s) => s !== site);
    if (code === 'no-products' && fbSites.length && !collectStopRequested()) {
      const me = (storeUrl.match(/[?&]me=([A-Z0-9]+)/) || [])[1] || (String(spUrl || '').match(/[?&]seller=([A-Z0-9]+)/) || [])[1];
      if (me) {
        for (const fs of fbSites) {
          if (collectStopRequested()) break;
          if (fs === site) continue;
          const fbHost = 'www.amazon.' + siteToHostSuffix(fs);
          const fbUrl = 'https://' + fbHost + '/s?me=' + me;
          steps.push('→ 店铺页当前站点(' + site + ')无商品, 跨站回退尝试: ' + fs);
          products.length = 0; seen.clear();
          await send('Page.navigate', { url: fbUrl });
          await new Promise((r) => setTimeout(r, 9000));
          storeUrl = fbUrl; host = fbHost; site = fs;
          gotShop = await collectShopPages();
          if (gotShop) { steps.push('→ 跨站回退成功: ' + fs + ' 站点采到 ' + products.length + ' 个商品'); break; }
        }
      }
    }
    if (!gotShop) {
      throw new Error(shopFailReason(code) + detail + (code === 'no-products' && !fbSites.length ? ' (可在「采集站点」多选其他站点, 店铺无商品时自动尝试跨站采集)' : ''));
    }
  }
  const listAll = products.slice(0, maxItems);
  // ===== ④.5 列表页前置拦截: 被排除商品不跳详情 (价格/排名/关键词/站点 用店铺列表已有字段先判) =====
  // 原则: 仅当列表字段明确不满足时才剔除 (未知字段留待详情修正后完整筛), 与 preFilterByList 同宽松语义
  const pf = opts.filter || {};
  const parseListPrice = (s) => {
    const t = String(s || '').trim();
    if (!t) return null;
    const m = t.match(/([\d.,]+)/);
    if (!m) return null;
    return parseFloat(m[1].replace(/[.,]/g, (x) => (x === ',' ? '' : '')) || m[1].replace(/,/g, ''));
  };
  const list = listAll.filter((it) => {
    if (pf.fulfill === 'AMZ') { if (!it.amazonSell) return false; }
    else if (pf.fulfill && it.fulfill && it.fulfill !== pf.fulfill) return false;   // 列表已知 FBA/FBM 且不符 → 前置剔除
    // 价格区间 (店铺卡片价可解析时判; 解析失败留待详情)
    const lp = parseListPrice(it.price);
    if (lp != null) {
      if (pf.priceMin != null && lp < pf.priceMin) return false;
      if (pf.priceMax != null && lp > pf.priceMax) return false;
    }
    // 排名 (大排名唯一口径 rankParentOf; 未知留待详情)
    if (pf.rankMax != null || pf.rankMin != null) {
      const bigR = rankParentOf(it);
      if (bigR != null) {
        if (pf.rankMin != null && bigR < pf.rankMin) return false;
        if (pf.rankMax != null && bigR > pf.rankMax) return false;
      }
    }
    if (pf.q) {
      const s = String(pf.q).toLowerCase();
      if (!String(it.title || '').toLowerCase().includes(s) && !String(it.asin || '').toLowerCase().includes(s)) return false;
    }
    if (pf.sites && pf.sites.length && it.site && !pf.sites.includes(it.site)) return false;
    if (pf.site && it.site && it.site !== pf.site) return false;
    return true;
  });
  const preSkippedCount = listAll.length - list.length;
  // ===== ⑤ 详情页修正: 逐个打开详情页读真实 BuyBox 价 + 品牌 (店铺页价是变体/展示价, 不可靠) =====
  // ★ 2026-09 改造(统一不跳转): 默认【关】—— 这就是"进入店铺采集商品这一步不要再一个一个跳详情页"。
  //   旧默认对店铺里的每个商品都导航一次 /dp/ASIN 并等插件面板 (15s+)。店铺卡片 + 卡片插件面板
  //   已经能给到价格/品牌/评分/配送, 不足的改由商品管理页「补采」按需补。需要旧行为时显式传 fixDetail=1。
  const fixDetail = opts.fixDetail === true || opts.fixDetail === 1 || opts.fixDetail === '1';
  if (fixDetail) {
    for (let i = 0; i < list.length; i++) {
      if (collectStopRequested()) break;
      const it = list[i];
      try {
        await send('Page.navigate', { url: 'https://' + host + '/dp/' + it.asin });
        await new Promise((r) => setTimeout(r, 3000));
        // 等待详情页关键元素就绪 (标题 + 主图), 最多 15 秒 — 修复"页面未渲染完就读"导致主图/评分/类目为空
        for (let w = 0; w < 15; w++) {
          try {
            const rdy = await send('Runtime.evaluate', {
              expression: `(() => { const t = document.querySelector('#productTitle'); const i = document.querySelector('#landingImage, #imgTagWrapperId img, #main-image-container img, #imageBlock img'); return JSON.stringify({ t: !!t, i: !!i }); })()`,
              returnByValue: true,
            });
            const st = JSON.parse(rdy.result.value);
            if (st.t && st.i) break;
          } catch (e) { /* 读取失败继续等 */ }
          await new Promise((r) => setTimeout(r, 1000));
        }
        // ===== 插件信息: 页面已打开 → 先等智赢插件分析完成并读取 (配送FBA/FBM、排名、销量、商标、FBA费用) =====
        // 顺序要求: 插件信息 + 商品主信息(主图/价格/类目/评分/BSR) 全部取完, 再去取 aod 跟卖卖家
        const pluginPa = await waitPanelInline(send, site, 6000, 15000).catch(() => null);
        for (let s = 0; s < 2; s++) { await send('Runtime.evaluate', { expression: `window.scrollTo(0, ${(s + 1) * 3000})` }); await new Promise((r) => setTimeout(r, 600)); }
        await evScrollBottom(send);
        await new Promise((r) => setTimeout(r, 1000));
        const rf = await send('Runtime.evaluate', {
          expression: `(() => {
            const out = { price: null, newFrom: null, brand: null, rating: null, reviews: null, bsr: [], category: null, firstAvailable: null, fulfill: null, mainSeller: null, aplus: false, amazonSell: false, mainImage: null };
            // BuyBox 价格
            const sels = ['#corePrice_feature_div .a-offscreen', '.apex-pricetopay-value', '#price_inside_buybox', '.a-price .a-offscreen'];
            for (const sel of sels) {
              const el = document.querySelector(sel);
              if (el) {
                const t = (el.textContent || '').trim().replace(/\\s+/g, ' ');
                const m = t.match(/(?:€|£|A\\$|AU\\$|US\\$|C\\$|CA\\$|\\$|EUR|GBP|USD|AUD)\\s*([\\d.,]+)/);
                if (m) { out.price = parseFloat(m[1].replace(/,/g, '')); break; }
              }
            }
            if (out.price == null) {
              const w = document.querySelector('.a-price-whole');
              const f = document.querySelector('.a-price-fraction');
              if (w) { const whole = (w.textContent || '').replace(/[^\\d]/g, ''); const frac = f ? (f.textContent || '').replace(/[^\\d]/g, '') : ''; const v = parseFloat(whole + '.' + (frac || '00')); if (!isNaN(v)) out.price = v; }
            }
            // 详情页 "New (N) from €X.XX" — 其他卖家最低起价 (商品页原价, 最低跟卖价以此为准)
            // 支持德语页: "Neu (N) ab EUR X" (amazon.de 无语言参数时可能渲染德语)
            const olpTxt = document.body ? document.body.textContent : '';
            let fm = olpTxt.match(/New\\s*\\(\\d+\\)\\s*from\\s*(?:€|£|A\\$|AU\\$|US\\$|C\\$|\\$)?\\s*([\\d.,]+)/i);
            if (!fm) fm = olpTxt.match(/Neu\\s*\\(\\d+\\)\\s*ab\\s*(?:EUR|€)?\\s*([\\d.,]+)/i);
            if (fm) out.newFrom = parseFloat(fm[1].replace(/,/g, ''));
            // 品牌 (byline)
            const b = document.querySelector('#bylineInfo a, #bylineInfo_feature_div a');
            if (b) {
              let bt = b.textContent.trim().replace(/\\s+/g, ' ').replace(/^Brand:\\s*/i, '').trim();
              if (bt && bt.length > 1 && bt.length < 60) out.brand = bt;
            }
            // 评分 / 评论数
            const rEl = document.querySelector('#acrPopover .a-icon-alt, [data-hook="rating-out-of-text"]');
            if (rEl) { const m = rEl.textContent.match(/([\\d.,]+)\\s*out of/); if (m) out.rating = parseFloat(m[1].replace(',', '.')); }
            const revEl = document.querySelector('#acrCustomerReviewText, [data-hook="total-review-count"]');
            if (revEl) { const m = revEl.textContent.match(/([\\d.,]+)/); if (m) out.reviews = parseInt(m[1].replace(/[.,]/g, ''), 10); }
            // ===== 卖家/配送/自营/A+/主图/类目层级 (共用单一实现, 见 DETAIL_CORE_JS) =====
            ${DETAIL_CORE_JS}
            // 详情表 (品牌表 + 排名 + ASIN + 上架) — 遍历所有 prodDetTable, 排名行 TD 可能懒加载
            document.querySelectorAll('table.a-keyvalue.prodDetTable tr').forEach(tr => {
              const th = tr.querySelector('th');
              const td = tr.querySelector('td');
              if (!th || !td) return;
              const k = th.textContent.replace(/\\s+/g, ' ').trim().toLowerCase();
              const v = td.textContent.replace(/\\s+/g, ' ').trim();
              if (/brand name/i.test(k) && !out.brand) { const m = v.match(/^([^=]+)/); if (m) out.brand = m[1].trim().slice(0, 40); }
              if (/best sellers rank/i.test(k)) {
                // 新版页面无 # 前缀 ("164,986 in Automotive"); 德语页 "Nr. 187.250 in"; 数字支持 , 和 . 千分位
                // 排除 "See Top 100 in" 里的 Top N (误抓为排名)
                const clean = v.replace(/See Top\s+[\d.,]+\s+in\s+/gi, '').replace(/Top\s+[\d.,]+\s+in\s+/gi, '');
                const re = /(?:#\\s*|Nr\\.?\\s*)?([\\d.,]+)\\s+in\\s+([^(]+)/g;
                let m;
                while ((m = re.exec(clean)) !== null) out.bsr.push({ rank: parseInt(m[1].replace(/[.,]/g, ''), 10), category: m[2].trim().slice(0, 40) });
              }
              if (/date first available|first available/i.test(k)) out.firstAvailable = v.slice(0, 30);
            });
            // 兜底: 排名可能在整个页面文本 (不在 prodDetTable 行内)
            if (!out.bsr.length) {
              const allTxt = (document.body.textContent || '').replace(/See Top\s+[\d.,]+\s+in\s+/gi, '').replace(/Top\s+[\d.,]+\s+in\s+/gi, '');
              const re = /(?:#\\s*|Nr\\.?\\s*)?([\\d.,]+)\\s+in\\s+([A-Za-z& ]{3,40}?)\\s*\\(/g;
              let m;
              const seen = new Set();
              while ((m = re.exec(allTxt)) !== null) {
                const cat = m[2].trim();
                if (cat.length > 2 && cat.length < 40 && !seen.has(cat)) {
                  seen.add(cat);
                  out.bsr.push({ rank: parseInt(m[1].replace(/[.,]/g, ''), 10), category: cat });
                  if (out.bsr.length >= 5) break;
                }
              }
            }
            return JSON.stringify(out);
          })()`, returnByValue: true,
        });
        let d;
        try {
          d = JSON.parse(rf.result.value);
        } catch (e) {
          console.error('[fix-detail]', it.asin, 'JSON解析失败:', e.message, '| desc:', String(rf.result && rf.result.description).slice(0, 300), '| value:', String(rf.result && rf.result.value).slice(0, 80));
          d = { price: null };
        }
        // price 优先用详情页 "New from €X" 起价 (原价/最低跟卖参考价), 否则用 BuyBox
        if (d.newFrom != null) {
          it.price = d.newFrom;
          it.minPrice = d.newFrom;
          it.buyBoxPrice = d.price != null ? d.price : it.buyBoxPrice;
        } else if (d.price != null) it.price = d.price;
        if (d.brand) it.brand = d.brand;
        if (d.rating != null) it.rating = d.rating;
        if (d.reviews != null) it.reviews = d.reviews;
        if (d.bsr && d.bsr.length) it.bsr = d.bsr;
        if (d.category) it.category = d.category;
        if (d.firstAvailable) it.firstAvailable = d.firstAvailable;
        // 配送方式/主报价卖家/A+/亚马逊自营/主图 (商品数据阶段获取; aod 阶段仅兜底)
        // 三态写入: detailOk=详情页已渲染(可判定), regionText=BuyBox 主报价区已渲染
        //   - aplus / amazonSell: 成功读到页面即可判定 true/false (不再只写 true)
        //   - fulfill: 只有读到配送信息才覆盖, 读不到保持原值 (未知不猜)
        //   - mainSeller: 读到卖家名才覆盖
        if (d.detailOk) {
          it.detailOk = true;
          it.detailAt = now();
          it.detailVer = DETAIL_VER;      // 标记"由当前版本提取器核实过" (缺这个标记会被当成旧版未核实数据)
          it.aplus = !!d.aplus;
          if (d.regionText) {
            it.amazonSell = !!d.amazonSell;
            if (d.fulfill) it.fulfill = d.fulfill;
            // sellerRegion 已停写: 这里原来写 d.regionText(诊断串, 非产地) —— 见本文件 2800 行处的完整说明
          }
          if (d.mainSeller) it.mainSeller = d.mainSeller;
          if (siteSymbolOk(d.curSymbol, it.site || host)) it.priceSymbol = d.curSymbol;
          // 类目层级 (面包屑全路径, 供一级/二级筛选)
          if (d.catPath) {
            it.catPath = d.catPath; it.cat1 = d.cat1; it.cat2 = d.cat2; it.cat3 = d.cat3;
            it.catNodes = d.catNodes || null; it.catSrc = 'bc'; it.catAt = now();
          }
        }
        if (d.mainImage) it.mainImage = d.mainImage;
        // ===== 插件信息合并 (步骤①已取): 商品主信息就绪后合并, 然后才进 ⑥ aod 跟卖 =====
        if (pluginPa && pluginPa.txt) {
          try {
            const pd = parsePanelText(pluginPa.txt, it.asin, it.title || '', pluginPa.flag || null);
            let pn = 0;
            // ★ 2026-09-24 采集准确性: 面板读到的值一律【覆盖】旧值。
            //   原实现里 size/weight/packSize/packWeight/productType/listedAt 是"只补空"(&& !it.x) →
            //   补采永远改不掉旧值/脏值(实测 weight 脏值就是这样永久留存的); 且值没过 cleanPanelVal 防串句。
            const put = (k, v) => { const val = cleanPanelVal(v); if (val == null || val === '') return; if (it[k] !== val) pn++; it[k] = val; };
            if (pd.brand && !it.brand) { it.brand = pd.brand; pn++; }   // 品牌仍只补空(卡片/面包屑品牌更干净)
            if (pd.fulfill) { if (it.fulfill !== pd.fulfill) pn++; it.fulfill = pd.fulfill; it.fulfillSrc = 'panel'; }
            if (pd.tmText) { it.tmText = pd.tmText; pn++; }
            if (pd.trademarkCount != null) { it.trademarkCount = pd.trademarkCount; pn++; }
            if (pd.tmCountries && pd.tmCountries.length) { it.tmCountries = pd.tmCountries; pn++; }
            if (pd.sellerCount != null) { it.sellerCount = pd.sellerCount; pn++; }
            if (pd.sales30d) { it.sales30d = pd.sales30d; pn++; }
            put('fbaFee', pd.fbaFee);
            put('size', pd.size);
            put('weight', pd.weight);
            put('packSize', pd.packSize);
            put('packWeight', pd.packWeight);
            put('productType', pd.productType);
            const la = pd.listedAt && String(pd.listedAt).match(/(\d{4}-\d{2}-\d{2})/);
            if (la) { if (it.listedAt !== la[1]) pn++; it.listedAt = la[1]; }
            if ((!it.bsr || !it.bsr.length) && pd.bsr && pd.bsr.length) { it.bsr = pd.bsr; pn++; }
            it.panelOk = true;
            it.panelFields = pn;      // ★ 面板贡献了几个字段(0 = 面板读到了但没给新值)
            it.panelAt = now();       // ★ 面板读取时间(用于判断"是否采到"与新鲜度)
          } catch (e) { console.error('[fix-detail]', it.asin, '插件面板解析失败:', e && e.message); }
        }
        if (d.price == null && d.newFrom == null) console.error('[fix-detail]', it.asin, '详情页未读到价格, URL=' + 'https://' + host + '/dp/' + it.asin);
        const rv = await send('Runtime.evaluate', {
          expression: `(() => {
            const dims = [];
            document.querySelectorAll('#twister_feature_div script[type="a-state"]').forEach(s => {
              const raw = s.textContent.trim();
              if (!raw) return;
              try {
                const data = JSON.parse(raw);
                if (data.sortedDimValuesForAllDims) {
                  Object.keys(data.sortedDimValuesForAllDims).forEach(dim => {
                    const vals = data.sortedDimValuesForAllDims[dim] || [];
                    if (!vals.length) return;
                    dims.push({
                      dim,
                      options: vals.map(v => ({
                        text: v.dimensionValueDisplayText || null,
                        asin: v.defaultAsin || null,
                        selected: v.dimensionValueState === 'SELECTED',
                      })).filter(v => v.text && v.asin),
                    });
                  });
                }
              } catch(e) {}
            });
            return JSON.stringify(dims);
          })()`, returnByValue: true,
        });
        const dims = JSON.parse(rv.result.value);
        if (dims.length) {
          // ===== 变体采集 (不跳转): 从 twister 渲染的 li 直接读 变体名(alt) + 价格(from €X) + ASIN =====
          const rv2 = await send('Runtime.evaluate', {
            expression: `(() => {
              const out = [];
              document.querySelectorAll('#twister_feature_div li[data-asin]').forEach(li => {
                const asin = li.getAttribute('data-asin');
                if (!asin) return;
                const img = li.querySelector('img');
                const name = img ? (img.getAttribute('alt') || '').trim() : (li.textContent || '').trim();
                // 价格: "1 option from €25.99" / "6 options from €11.97" / "€12.76"
                let price = null;
                const priceTxt = (li.textContent || '').replace(/\\s+/g, ' ').trim();
                const CUR = '(?:€|£|A\\\\$|AU\\\\$|US\\\\$|C\\\\$|CA\\\\$|\\\\$|EUR|GBP|USD|AUD)';
                const fm = priceTxt.match(new RegExp('from\\\\s*' + CUR + '\\\\s*([\\\\d.,]+)'));
                if (fm) price = parseFloat(fm[1].replace(/,/g, ''));
                else {
                  const dm = priceTxt.match(new RegExp(CUR + '\\\\s*([\\\\d.,]+)'));
                  if (dm) price = parseFloat(dm[1].replace(/,/g, ''));
                }
                out.push({ asin, name: (name || '').slice(0, 60), price, selected: li.getAttribute('data-initiallyselected') === 'true' || !!li.querySelector('.a-button-selected, .swatchSelect') });
              });
              return JSON.stringify(out);
            })()`, returnByValue: true,
          });
          let liVariants = [];
          try { liVariants = JSON.parse(rv2.result.value); } catch {}
          if (liVariants.length) {
            // 用 li 数据重建变体 (含名称/价格/ASIN, 不跳转)
            const grouped = {};
            liVariants.forEach((v) => {
              if (!grouped.color) grouped.color = [];
              grouped.color.push({ text: v.name, asin: v.asin, price: v.price, priceType: v.price != null ? 'buybox' : null, selected: !!v.selected });
            });
            it.variants = Object.keys(grouped).map((dim) => ({ dim, options: grouped[dim] }));
            it.variations = liVariants.length;
            // BuyBox 价 = 所有变体最低价
            const prices = liVariants.map((v) => v.price).filter((x) => x != null);
            if (prices.length) {
              const minV = Math.min(...prices);
              it.price = minV;
              it.minPrice = minV;
              if (d.price == null) d.price = minV;
            }
          } else {
            // 兜底: 用 a-state 数据 (无价格)
            it.variants = dims.map((g) => ({
              dim: g.dim.replace(/_name$/, ''),
              options: g.options.map((o) => ({ text: o.text.replace(/\.$/, '').trim(), asin: o.asin, selected: !!o.selected })),
            }));
          }
        }
        // ===== 采集过滤: 与自定义筛选同条件, 被筛除的商品直接跳过 (不采 aod 跟卖, 不入库) =====
        // 商标数据补全: 过滤含商标条件(商标数≥N / 商标国家)时, 从插件面板读取商标数+国家
        if (opts.filter && (opts.filter.tmMin != null || opts.filter.tmMax != null || opts.filter.tmCountries)) {
          try {
            const pd = await cdpReadOnePanel(send, it.asin, host.replace('www.amazon.', ''));
            if (pd && !pd.error) {
              if (pd.trademarkCount != null) it.trademarkCount = pd.trademarkCount;
              if (pd.tmCountries && pd.tmCountries.length) it.tmCountries = pd.tmCountries;
              if (pd.brand && !it.brand) it.brand = pd.brand;
              if (pd.tmText) it.tmText = pd.tmText;
            }
          } catch (e) { console.error('[tm-panel]', it.asin, '商标读取异常:', e && e.message); }
        }
        it.__skip = !applyCollectFilter(it, opts.filter);
        if (it.__skip) continue;
        // ===== ⑥ aod 跟卖采集: 导航 aod 报价页, 读取全部跟卖卖家 (价格/名称/ID/跳转链接/运费) =====
        // 采集顺序: 详情页信息(价格/品牌/评分/配送/变体) 已完成 → 现在采跟卖卖家数据
        // 兜底: 详情页未取到配送方式时, 从 aod 页顶部主报价区 (Add to Basket 区域) 补充
        if (!it.fulfill || !it.mainSeller) {
          try {
            const rq = await send('Runtime.evaluate', {
              expression: `(() => {
                const bt = (document.body ? document.body.textContent : '').replace(/\\s+/g, ' ');
                const out = { fulfill: null, mainSeller: null };
                if (/Dispatches? from Amazon|Fulfilled by Amazon|Versand durch Amazon|亚马逊配送|亚马逊物流|Ships from Amazon/i.test(bt)) out.fulfill = 'FBA';
                const sm1 = bt.match(/Sold by\\s+([^.|]{2,40}?)\\s*(?:\\.| Opens|\\s+\\|| Seller)/i);
                const sm2 = bt.match(/Verkauf und Versand durch\\s+([^.|]{2,40}?)\\s*(?:\\.|\\s+\\|)/i);
                if (sm1 && !/^amazon([\\s.]|$)/i.test(sm1[1])) out.mainSeller = sm1[1].trim().replace(/\\.$/, '').slice(0, 40);
                else if (sm2 && !/^amazon([\\s.]|$)/i.test(sm2[1])) out.mainSeller = sm2[1].trim().replace(/\\.$/, '').slice(0, 40);
                return JSON.stringify(out);
              })()`, returnByValue: true,
            });
            const qq = JSON.parse(rq.result.value);
            if (qq.fulfill && !it.fulfill) it.fulfill = qq.fulfill;
            if (qq.mainSeller && !it.mainSeller) it.mainSeller = qq.mainSeller;
          } catch (e) { /* 兜底失败不阻塞 */ }
        }
        it.offerPrices = null;
        it.followCount = 0;
        const aodOn = opts.aod !== false;
        if (aodOn) {
          try {
            await send('Page.navigate', { url: 'https://' + host + '/dp/' + it.asin + '/ref=olp-opf-redir?aod=1&ie=UTF8&condition=new' });
            await new Promise((r) => setTimeout(r, 8000));
            // ===== ⑥.1 滚动 + 翻页, 加载全部跟卖 offer =====
            // aod 弹窗是懒加载: 不滚动只显示前 ~10 个, 需滚动到底触发加载, 有"下一页"再点, 直到总数不再增长
            for (let load = 0; load < 12 && !collectStopRequested(); load++) {
              await send('Runtime.evaluate', {
                expression: `(() => {
                  // 滚动 aod 列表到底 (触发懒加载)
                  const list = document.querySelector('#aod-offer-list');
                  if (list) list.scrollIntoView({ block: 'end' });
                  window.scrollTo(0, document.body.scrollHeight);
                  // 若有"下一页"分页按钮则点击 (Amazon aod 每页约 10 个 offer)
                  const nxt = document.querySelector('#aod-pagination-next-page-button, .aod-pagination .a-last a, [id*="aod"][id*="next"], [class*="aod"][class*="next"]');
                  if (nxt) { try { nxt.click(); } catch (e) {} }
                  return true;
                })()`, returnByValue: true,
              });
              await new Promise((r) => setTimeout(r, 2000));
            }
            let offers = [], total = null;
            for (let k = 0; k < 10; k++) {
              await new Promise((r) => setTimeout(r, 2000));
              const ra = await send('Runtime.evaluate', {
                expression: `(() => {
                  const list = document.querySelector('#aod-offer-list');
                  if (!list) return JSON.stringify({ ready: false });
                  const out = [];
                  list.querySelectorAll('#aod-offer').forEach(o => {
                    let price = null;
                    const fullEl = o.querySelector('.apex-pricetopay-accessibility-label, .aod-offer-price .a-offscreen');
                    if (fullEl) { const m = fullEl.textContent.trim().match(/(?:€|£|\\$|A\\$|EUR|GBP|USD|AUD)\\s*([\\d.,]+)/); if (m) price = parseFloat(m[1].replace(/,/g, '')); }
                    if (price == null) {
                      const w = o.querySelector('.a-price-whole');
                      const f = o.querySelector('.a-price-fraction');
                      if (w) { const whole = (w.textContent || '').replace(/[^\\d]/g, ''); const frac = f ? (f.textContent || '').replace(/[^\\d]/g, '') : ''; const v = parseFloat(whole + '.' + (frac || '00')); if (!isNaN(v)) price = v; }
                    }
                    let seller = null, sellerId = null, sellerUrl = null;
                    let sel = o.querySelector('a[href*="/gp/aag/main"], a[href*="aag/main?"]');
                    if (!sel) { const all = o.querySelectorAll('a[href*="seller="]'); for (const a of all) { const t = (a.textContent || '').trim(); if (t && !/^Details/i.test(t) && !/^More/i.test(t)) { sel = a; break; } } }
                    if (sel) {
                      const aria = sel.getAttribute('aria-label') || '';
                      const m = aria.match(/^([^.]+)/);
                      const raw = (m ? m[1] : sel.textContent.trim()).trim();
                      if (raw && !/^Details/i.test(raw) && !/^More/i.test(raw)) seller = raw;
                      const hm = (sel.getAttribute('href') || '').match(/seller=([A-Z0-9]+)/);
                      if (hm) sellerId = hm[1];
                      const href = sel.getAttribute('href') || '';
                      if (href.includes('aag/main')) sellerUrl = href.startsWith('http') ? href : 'https://' + location.hostname + href;
                    }
                    let shipFee = null, shipDates = null;
                    const shipEl = o.querySelector('.aod-delivery-promise, #unified-delivery-message');
                    if (shipEl) {
                      const ship = shipEl.textContent.trim().replace(/\\s+/g, ' ').slice(0, 80);
                      const fm = ship.match(/(?:€|£|\\$|A\\$|EUR|GBP|USD|AUD)\\s*([\\d.,]+)/);
                      if (fm) shipFee = parseFloat(fm[1].replace(/,/g, ''));
                      const dm = ship.match(/(\\d{1,2})\\s*[-–]\\s*(\\d{1,2})\\s+([A-Za-zäöüß]+)/i);
                      if (dm) shipDates = dm[1] + ' - ' + dm[2] + ' ' + dm[3];
                    }
                    out.push({ price, seller, sellerId, sellerUrl, shipFee, shipDates });
                  });
                  const cEl = list.querySelector('#aod-total-offer-count');
                  return JSON.stringify({ ready: out.length > 0, total: cEl ? cEl.value : null, offers: out });
                })()`, returnByValue: true,
              });
              const da = JSON.parse(ra.result.value);
              if (da.ready) { offers = da.offers; total = da.total; break; }
            }
            if (offers.length) {
              // 按 sellerId 去重 (保最低价)
              const dedup = new Map();
              offers.forEach((o) => {
                const k = o.sellerId ? 'id:' + o.sellerId : 'n:' + (o.seller || '') + '|' + (o.price != null ? o.price : '');
                if (!dedup.has(k) || (o.price != null && (dedup.get(k).price == null || o.price < dedup.get(k).price))) dedup.set(k, o);
              });
              const uniq = [...dedup.values()];
              const nums = uniq.map((o) => o.price).filter((x) => x != null);
              it.offerPrices = uniq;
              it.followCount = uniq.length;
              it.aodTotal = total;
              const minP = nums.length ? Math.min(...nums) : null;
              if (minP != null && (it.minPrice == null || minP < it.minPrice)) it.minPrice = minP;
            }
          } catch (e) {
            console.error('[aod]', it.asin, '跟卖采集失败:', e && e.message);
          }
        }
      } catch (e) {
        console.error('[fix-detail]', it.asin, '修正失败:', e && e.message);
      }
    }
  }
  // 过滤掉不符合采集条件的商品 (只保留被过滤出的, 被筛除的直接跳过不采集)
  const kept = list.filter((x) => !x.__skip);
  steps.push('→ 店铺商品 ' + kept.length + ' 个 (页数 ' + maxPages + ' 上限 / 商品数 ' + maxItems + ' 上限' + (fixDetail ? ', 已详情页修正价格/品牌' : '') + (opts.aod !== false ? ', 已采 aod 跟卖' : '') + (list.length > kept.length ? ', 采集过滤跳过 ' + (list.length - kept.length) + ' 个' : '') + ')');
  return { site, host, sellerUrl, sellerId, sellerName, spUrl, storeUrl, products: kept, skipped: (listAll.length - kept.length) + (preSkippedCount || 0), shopAplus: opts.shopAplus, steps, send };
}

// ===== aod 提取失败诊断 (纯函数, 可测试) =====
// classifyAodFailure: 根据页面文本判断失败类型 (no-offers/captcha/login/structure)
// aodFailReason: 失败类型 → 用户可读的中文提示
function classifyAodFailure(pageText) {
  const bt = String(pageText || '');
  // 无可用报价 (英文/德文 aod 页, 如 "No featured offers available" / "Keine Angebote verfügbar")
  if (/No featured offers available|Keine Angebote verfügbar|Currently unavailable|not available to purchase|Derzeit nicht verfügbar|There are no offers/i.test(bt)) return 'no-offers';
  // 验证码 / 机器人验证
  if (/captcha|CAPTCHA|Robot Check|机器人验证|请输入验证码|验证码/i.test(bt)) return 'captcha';
  // 需要登录
  if (/Sign in to see|Anmelden, um|Please sign in|Bitte melden Sie sich an|登录后才能查看/i.test(bt)) return 'login';
  return 'structure';
}
function aodFailReason(code) {
  const map = {
    'no-offers': '商品当前无可用跟卖报价 (No featured offers available)',
    'captcha': '触发验证码 (CAPTCHA), 请在 Edge 中手动完成验证后重试',
    'login': '页面要求登录, 请在 Edge 中登录 Amazon 后重试',
    'structure': 'aod 页面结构未识别到卖家 (可能页面加载慢或结构变化)',
  };
  return map[code] || 'aod 页面未提取到跟卖卖家';
}

// 从商品库商品提取历史跟卖卖家 (去重 sellerId, 仅保留带 sellerUrl 的) — 纯函数可测试
// 用于 aod 实时提取失败时兜底: 商品当前无报价但历史卖家店铺仍有采集价值
function sellersFromProduct(prod) {
  const map = new Map();
  ((prod && prod.offerPrices) || []).forEach((o) => {
    if (!o.sellerUrl) return;
    const k = o.sellerId || o.seller || o.sellerUrl;
    if (!map.has(k)) map.set(k, o);
  });
  return [...map.values()];
}

// ===== 店铺页提取失败诊断 (纯函数, 可测试) — 与 aodFailReason 对称 =====
// classifyShopPageFailure: 根据店铺页文本判断失败类型 (store-gone/captcha/login/no-products/structure)
// shopFailReason: 失败类型 → 用户可读的中文提示
function classifyShopPageFailure(pageText) {
  const bt = String(pageText || '');
  // 店铺不存在 / 已关闭 (英文/德文 404 页)
  if (/Sorry, we could not find that page|Page Not Found|Seite nicht gefunden|Seite nicht gefunden|does not exist|existiert nicht/i.test(bt)) return 'store-gone';
  // 验证码 / 机器人验证
  if (/captcha|CAPTCHA|Robot Check|机器人验证|请输入验证码|验证码/i.test(bt)) return 'captcha';
  // 需要登录 (页面主体要求登录; 导航栏 "Hello, sign in" 不算 — 用精确短语匹配)
  if (/Sign in to see|Sign in for|Please sign in|Anmelden, um|Bitte melden Sie sich an|登录后才能查看/i.test(bt) && !/data-asin|s-result-item|s-main-slot/i.test(bt)) return 'login';
  // 店铺无商品 (页面正常但无结果)
  if (/No results|Keine Ergebnisse|no products|There are no|Keine Artikel|Keine Produkte/i.test(bt)) return 'no-products';
  return 'structure';
}
function shopFailReason(code) {
  const map = {
    'store-gone': '店铺不存在或已关闭 (Page Not Found)',
    'captcha': '触发验证码 (CAPTCHA), 请在 Edge 中手动完成验证后重试',
    'login': '页面要求登录, 请在 Edge 中登录 Amazon 后重试',
    'no-products': '店铺无在售商品 (No results, 可能已停业或全部下架)',
    'structure': '店铺页结构未识别到商品 (可能页面加载慢或结构变化)',
  };
  return map[code] || '店铺页未提取到商品';
}

// ===== 从 aod 页面提取全部跟卖卖家 (出售单位链接) =====
// 输入: 商品 aod 报价页 URL (如 /dp/XXX/ref=olp-opf-redir?aod=1&condition=new)
// 返回: [{ seller, sellerId, sellerUrl }] 去重后的全部跟卖卖家
async function cdpExtractAodSellers(aodUrl, opts = {}) {
  // 亚马逊词汇筛选: 卖家名称/ID 含这些词汇的直接排除 (默认 amazon/亚马逊, 用户可扩展)
  const amazonWords = (opts.amazonWords || 'amazon,亚马逊').split(/[,，]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  // 目标站点域名 (com.au / de / co.uk ...) — 选同域标签执行 glow + aod, 避免跨站设地址/提取
  const siteMatch = aodUrl.match(/amazon\.(com\.au|co\.uk|com|com\.mx|com\.br|de|fr|it|es|co\.jp|ca|in|nl|se|pl)/);
  const aodSite = siteMatch && CDP_SITE_CODE[siteMatch[1]] ? CDP_SITE_CODE[siteMatch[1]] : (opts.site || 'de');
  const aodHost = 'www.amazon.' + siteToHostSuffix(aodSite);
  const tabs = await cdpGetTabs();
  let page = tabs.find((t) => t.type === 'page' && t.url.indexOf(aodHost) >= 0)
    || tabs.find((t) => t.type === 'page' && /amazon\.(com\.au|co\.uk|com|com\.mx|com\.br|de|fr|it|es|co\.jp|ca|in|nl|se|pl)/.test(t.url))
    || tabs.find((t) => t.type === 'page' && !t.url.includes('3088') && !t.url.startsWith('data:'))
    || tabs.find((t) => t.type === 'page');
  if (!page) {
    // 无 amazon 标签 → 新建目标站点标签
    const created = await cdpCreateTab('https://' + aodHost + '/');
    page = { webSocketDebuggerUrl: created.wsUrl };
  }
  const { send } = await cdpConnect(page.webSocketDebuggerUrl);
  /* ★ 2026-09-27: 导航后必须确认【真的到了目标商品页】。
   *   实测踩到: 浏览器标签页停在别的商品/别的站点(比如上一轮留下的 amazon.de 页面)时,
   *   读回来的卖家是那个商品的, 而且它的链接常常不是店铺链接 → 后续店铺采集直接报「请输入商品详情 URL」。
   *   所以这里校验 href 同时含【目标 ASIN】和【目标站点域名】, 不对就再导航一次。 */
  const wantAsin = (aodUrl.match(/\/dp\/([A-Z0-9]{10})/) || [])[1] || null;
  const onTargetPage = async () => {
    try {
      const rr = await send('Runtime.evaluate', { expression: 'location.href', returnByValue: true });
      const href = String((rr && rr.result && rr.result.value) || '');
      if (aodHost && href.indexOf(aodHost) < 0) return false;
      if (wantAsin && href.indexOf(wantAsin) < 0) return false;
      return true;
    } catch (e) { return false }
  };
  // 邮编/配送地址: 用户输入邮编时先设地址 (任何邮编的商品网页), 默认用站点内置邮编
  if (opts.zip || SITE_ZIP[aodSite]) {
    // glow 设置成功后已重载首页落地国家; 再导航目标 aod 页提取卖家
    await cdpSetGlowAddress(send, aodUrl, aodSite, opts.zip);
    await send('Page.navigate', { url: aodUrl });
    await new Promise((r) => setTimeout(r, 9000));
  } else {
    await send('Page.navigate', { url: aodUrl });
    await new Promise((r) => setTimeout(r, 9000));
  }
  if (!(await onTargetPage())) {
    console.warn('[aod] 页面没停在目标商品上, 重新导航: ' + aodUrl);
    await send('Page.navigate', { url: aodUrl });
    await new Promise((r) => setTimeout(r, 10000));
    if (!(await onTargetPage())) console.warn('[aod] 二次导航后仍不在目标页(可能被验证码/跳转拦截)');
  }
  let sellers = [];
  /* ★ 2026-09-27: 把「滚动 + 读取」收成一个函数 —— 首次读不到时要重设配送地址再读一遍(见下方 no-offers 处理) */
  const readOffers = async function () {
  // ===== aod 懒加载: 滚动到底 + 翻页, 让全部跟卖 offer/卖家出现 =====
  // 不滚动只显示前 ~10 个卖家; 滚动触发加载, 有"下一页"再点, 多次循环直到全部暴露
  for (let load = 0; load < 12 && !collectStopRequested(); load++) {
    await send('Runtime.evaluate', {
      expression: `(() => {
        const list = document.querySelector('#aod-offer-list');
        if (list) list.scrollIntoView({ block: 'end' });
        window.scrollTo(0, document.body.scrollHeight);
        const nxt = document.querySelector('#aod-pagination-next-page-button, .aod-pagination .a-last a, [id*="aod"][id*="next"], [class*="aod"][class*="next"]');
        if (nxt) { try { nxt.click(); } catch (e) {} }
        return true;
      })()`, returnByValue: true,
    });
    await new Promise((r) => setTimeout(r, 2000));
  }
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    const r = await send('Runtime.evaluate', {
      expression: `(() => {
        const out = [];
        const seen = new Set();
        /* ★ 2026-09-27: 什么才算【能当店铺链接用】(aag/main 或 /sp?seller=)。
         *   用 indexOf 而不是正则 —— 这段代码本身是写在模板字符串里的, 正则里的 \\/ 会被转义搞坏(踩过)。 */
        const isShopLink = (u) => { const s = String(u || ''); if (!s) return false; return s.indexOf('aag/main') >= 0 || s.indexOf('/sp?seller') >= 0 || s.indexOf('/sp?ie') >= 0; };
        // 判断是否为亚马逊自营/亚马逊发货 (筛掉不采集)
        const isAmazon = (txt, href, o) => {
          const t = String(txt || '').toLowerCase();
          const h = String(href || '').toLowerCase();
          // 卖家名是 Amazon 官方 (Amazon / Amazon UK / Amazon US / Amazon EU / Amazon.co.uk 等)
          if (/^amazon([\s.]|$)|^amazon\.(com|de|co\.uk|fr|it|es|co\.jp|ca|in|com\.au)/i.test(t)) return true;
          // aod-offer 内: 明确标记 Sold by Amazon / 亚马逊销售 / Ships from Amazon / 发货方亚马逊
          if (o) {
            const oTxt = (o.textContent || '').toLowerCase();
            if (/sold by amazon(?!\.com)|verkauft von amazon|亚马逊销售|来自的报道亚马逊|发货方亚马逊|ships from amazon|versand durch amazon|dispatches? from amazon/i.test(oTxt)) return true;
          }
          return false;
        };
        // ① 从 aod-offer 提取
        const list = document.querySelector('#aod-offer-list');
        if (list) {
          list.querySelectorAll('#aod-offer').forEach(o => {
            let el = o.querySelector('a[href*="/gp/aag/main"], a[href*="aag/main?"]');
            if (!el) { const all = o.querySelectorAll('a[href*="seller="]'); for (const a of all) { const t = (a.textContent || '').trim(); if (t && !/^Details/i.test(t) && !/^More/i.test(t)) { el = a; break; } } }
            if (el) {
              const aria = el.getAttribute('aria-label') || '';
              const m = aria.match(/^([^.]+)/);
              const raw = (m ? m[1] : el.textContent.trim()).trim();
              const hm = (el.getAttribute('href') || '').match(/seller=([A-Z0-9]+)/);
              const href = el.getAttribute('href') || '';
              const isAag = href.includes('aag/main');
              const sellerId = hm ? hm[1] : null;
              // 筛掉亚马逊自营/亚马逊发货
              if (isAmazon(raw, href, o)) return;
              const key = sellerId || raw || href;
              if (!seen.has(key)) {
                seen.add(key);
                out.push({
                  seller: raw && !/^Details/i.test(raw) && !/^More/i.test(raw) ? raw : null,
                  sellerId,
                  /* ★ 不再只看 isAag: 有的 offer 行只给 /sp?seller= 链接; 而且不是店铺链接的地址
                   *   一律存 null(②会再扫全页补一个能用的), 免得把废链接传下去。 */
                  sellerUrl: isShopLink(href.startsWith('http') ? href : 'https://' + location.hostname + href)
                    ? (href.startsWith('http') ? href : 'https://' + location.hostname + href) : null,
                });
              }
            }
          });
        }
        // ② 补充: 扫描整个页面所有 aag/main + seller= 链接 (按 sellerId 归组, 优先 aag/main 或 /sp 链接)
        const pageSellers = new Map();  // sellerId → 最佳链接
        document.querySelectorAll('a[href*="/gp/aag/main"], a[href*="aag/main?"], a[href*="seller="]').forEach(a => {
          const aria = a.getAttribute('aria-label') || '';
          const m = aria.match(/^([^.]+)/);
          const raw = (m ? m[1] : a.textContent.trim()).trim();
          const hm = (a.getAttribute('href') || '').match(/seller=([A-Z0-9]+)/);
          const href = a.getAttribute('href') || '';
          const sellerId = hm ? hm[1] : null;
          if (!sellerId || !raw) return;
          // 跳过辅助链接 (details/at-a-glance/return policy/delivery)
          if (/Details/i.test(raw) || /More/i.test(raw) || /Return policy/i.test(raw) || /Delivery/i.test(raw)) return;
          const isGood = href.includes('aag/main') || href.includes('/sp?seller');
          const existing = pageSellers.get(sellerId);
          if (!existing || (isGood && !existing.good)) {
            pageSellers.set(sellerId, { raw, sellerId, href, good: isGood });
          }
        });
        pageSellers.forEach((s) => {
          const key = s.sellerId;
          // 筛掉亚马逊自营
          if (isAmazon(s.raw, s.href, null)) return;
          const url = s.href.startsWith('http') ? s.href : 'https://' + location.hostname + s.href;
          const good = isShopLink(url);
          const prev = out.find((o) => o.sellerId === key);
          /* ★ 2026-09-27 修复: 这个卖家如果在①里(offer 行内)已经被收过, 原来这里是
           *   "if (seen.has(key)) return;" 直接跳过 —— 于是①给的那个【不是店铺链接】的地址
           *   (/gp/aag/details/... 或 # 锚点)被留下, ②找到的好链接被丢掉;
           *   卖家带着废链接走到店铺采集那步 → 报「请输入商品详情 URL (dp/B0XXXX) 或出售单位链接」。
           *   实测: 同一个 aod 页上 3 个卖家全中招 → 整轮白跑。现在改成"就地补链接"。 */
          if (prev) {
            const prevGood = isShopLink(prev.sellerUrl);
            if (good && !prevGood) prev.sellerUrl = url;
            if (!prev.seller) prev.seller = s.raw.slice(0, 40);
            return;
          }
          seen.add(key);
          out.push({
            seller: s.raw.slice(0, 40),
            sellerId: s.sellerId,
            sellerUrl: good ? url : null,
          });
        });
        return JSON.stringify({ ready: out.length > 0, sellers: out });
      })()`, returnByValue: true,
    });
    const d = JSON.parse(r.result.value);
    if (d.ready) return d.sellers;
  }
  return [];
  };
  /** 读不到卖家时判是哪一类失败(无可用报价/验证码/登录/结构异常) —— 用户提示与上层兜底都靠它 */
  const aodFailCode = async function () {
    try {
      const dg = await send('Runtime.evaluate', {
        expression: `(() => { const bt = (document.body && document.body.innerText ? document.body.innerText : (document.body ? document.body.textContent : '')).slice(0, 20000); return bt; })()`, returnByValue: true,
      });
      return classifyAodFailure(dg.result.value);
    } catch (e) { return 'structure' }
  };
  sellers = await readOffers();
  if (!sellers.length) {
    const code = await aodFailCode();
    /* ★ 2026-09-27 实测修复(用户报「批量跟卖店铺采集直接报 ✗ aod 提取失败: 商品当前无可用跟卖报价」):
     *   全新浏览器 profile 第一次跑时, 配送地址可能还是出厂值(实测抓到页面显示 Deliver to: China),
     *   而在这个地址下 aod 页【真的】写着 "No featured offers available ... there are no other sellers"
     *   (页面原文已抓下来); 同一个商品在地址设成站点邮编之后有 2 个卖家、采集正常。
     *   所以这里: 判成"无报价/结构未识别"时, 重设一次配送地址 + 重新导航 + 再读一遍, 不行才判失败。 */
    if (code === 'no-offers' || code === 'structure') {
      try {
        await cdpSetGlowAddress(send, aodUrl, aodSite, opts.zip);
        await send('Page.navigate', { url: aodUrl });
        await new Promise((r) => setTimeout(r, 12000));
        sellers = await readOffers();
      } catch (e) { console.error('[aod retry] 重设地址后重读失败:', e && e.message) }
    }
    /* 重读后仍为空 → 按【最新】页面状态给出原因(别再拿第一次的旧判断去报错) */
    if (!sellers.length) throw new Error(aodFailReason(await aodFailCode()));
  }
  // 后端再过滤一次亚马逊自营/发货 + 亚马逊词汇筛选 (双保险), 然后按 sellerId 去重
  const map = new Map();
  sellers.forEach((s) => {
    /* ★ 只留【能当店铺链接用】的 URL: 实测 aod 页里有些卖家链接是 /gp/aag/details/... 或 # 锚点,
     *   这种传下去到店铺采集那步会被判「请输入商品详情 URL」直接报错 —— 宁可不采这个卖家, 也不要抛错整轮作废。 */
    if (!s.sellerUrl || !/aag\/main|\/sp\?/.test(s.sellerUrl)) return;
    const nm = String(s.seller || '').toLowerCase();
    const sid = String(s.sellerId || '').toLowerCase();
    // 卖家名是亚马逊官方 → 跳过
    if (/^amazon([\s.]|$)|^amazon\.(com|de|co\.uk|fr|it|es|co\.jp|ca|in|com\.au)/i.test(nm)) return;
    // 亚马逊词汇筛选 (默认 amazon/亚马逊, 可自定义扩展词汇)
    if (amazonWords.some((w) => nm.includes(w) || sid.includes(w))) return;
    const k = s.sellerId || s.seller || s.sellerUrl;
    if (!map.has(k)) map.set(k, s);
  });
  return [...map.values()];
}

// ===== 并行标签页管理 (多开网页) =====
// 创建独立标签页 (http PUT /json/new?<url>), 返回 { targetId, wsUrl }
/* ★ 2026-09-27 修复(用户报「批量跟卖店铺采集直接报错」):
 *   这两个函数原来用的是【旧的全局 CDP_PORT】—— 它在启动时就固定成 9222(用户的采集浏览器),
 *   而采集现在优先跑在本地无头浏览器(9333)上, activeCdpPort() 会返回 9333, 旧的 CDP_PORT 却永远是 9222。
 *   结果: aod 提卖家(走 activeCdpPort, 正常) → 一到"每个卖家开一张标签页采店铺"就 connect ECONNREFUSED 127.0.0.1:9222。
 *   实测复现: 第1轮 ✓ 卖家 1 个, 然后该卖家 ✗ connect ECONNREFUSED 127.0.0.1:9222。
 *   现在两个函数都按【当前活动端口】走, 本地无头/用户浏览器切换都能跟上。 */
async function cdpCreateTab(url) {
  const port = await activeCdpPort();
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: port, path: '/json/new?' + encodeURIComponent(url), method: 'PUT' }, (res) => {
      let d = '';
      res.on('data', (c) => d += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(d);
          resolve({ targetId: j.id, wsUrl: j.webSocketDebuggerUrl });
        } catch (e) { reject(new Error('创建标签页失败: ' + e.message)); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}
// 关闭标签页 (http GET /json/close/<id>)
async function cdpCloseTab(targetId) {
  const port = await activeCdpPort();
  return new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port: port, path: '/json/close/' + targetId }, (res) => {
      res.resume();
      res.on('end', () => resolve(true));
    }).on('error', () => resolve(false));
  });
}

// ===== 跟卖店铺并行批量采集 (多开网页, 全程 CDP) =====
// 流程: 对每个商品 → 其 N 个跟卖卖家 → 开 N 个独立标签页并行采集各自店铺商品
//       → 全部完成后关闭标签页 → 下一个商品, 以此类推
async function cdpFollowShopBatchParallel(asins, opts = {}) {
  const maxItems = opts.maxItems === 0 ? Infinity : Math.min(50, Math.max(1, opts.maxItems || 10));    // 每店铺商品数上限 (0=无限制)
  const maxPages = opts.maxPages === 0 ? Infinity : Math.min(10, Math.max(1, opts.maxPages || 2));     // 每店铺翻页上限 (0=无限制)
  const concurrency = Math.min(6, Math.max(1, opts.concurrency || 4)); // 并行标签页上限
  const results = [];
  let totalAdded = 0;
  for (const asin of asins) {
    if (collectStopRequested()) { results.push({ asin: '(停止)', note: '用户已停止采集, 提前结束' }); break; }
    const prod = products.find((x) => x.asin === asin);
    if (!prod) { results.push({ asin, error: '商品库中不存在' }); continue; }
    // 该商品的跟卖卖家 (去重 sellerId, 保留 sellerUrl)
    const sellers = sellersFromProduct(prod);
    if (!sellers.length) { results.push({ asin, error: '无带跳转链接的跟卖卖家' }); continue; }
    const sellersOut = [];
    // 分批并行 (每批 ≤ concurrency 个标签页)
    for (let i = 0; i < sellers.length; i += concurrency) {
      if (collectStopRequested()) { sellersOut.push({ seller: '(停止)', note: '用户已停止, 本批跳过' }); break; }
      const chunk = sellers.slice(i, i + concurrency);
      const jobs = chunk.map(async (s) => {
        let tab = null;
        try {
          // 每个卖家开一个独立标签页
          tab = await cdpCreateTab('about:blank');
          const out = await cdpFollowShopChain(s.sellerUrl, { maxItems, maxPages, wsUrl: tab.wsUrl, filter: opts.filter, shopAplus: opts.shopAplus, brandStore: opts.brandStore, brandShop: opts.brandShop, zip: opts.zip });
          // 导入商品库 (开启详情页插件面板补全: 重量/尺寸/包装/FBA费用等物流字段, 只对通过筛选入库的商品读)
          const added = ingestFollowShopProducts(out, true, 0);
          return { seller: out.sellerName || s.seller || out.sellerId, sellerId: out.sellerId || s.sellerId, spUrl: out.spUrl, storeUrl: out.storeUrl, productCount: out.products.length, skipped: out.skipped || 0, shopSkipped: out.shopSkipped || 0, brandShopSkip: out.brandShopSkip || 0, brandSkip: out.brandSkip || 0, added, products: out.products.map((p) => ({ asin: p.asin, title: p.title.slice(0, 100), price: p.price })), steps: out.steps, tab };
        } catch (e) {
          return { seller: s.seller || s.sellerId, sellerId: s.sellerId, error: e.message, tab };
        }
      });
      const settled = await Promise.allSettled(jobs);
      for (const st of settled) {
        const r = st.status === 'fulfilled' ? st.value : { seller: '?', error: st.reason && st.reason.message || '未知错误' };
        // 关闭该任务使用的独立标签页
        if (r.tab && r.tab.targetId) { try { await cdpCloseTab(r.tab.targetId); } catch {} }
        sellersOut.push(r);
        if (r.error) continue;
        totalAdded += r.added || 0;
      }
    }
    results.push({ asin, title: prod.title.slice(0, 80), sellerCount: sellers.length, sellers: sellersOut });
    // 并行数量控制: 每批之间留间隔, 避免触发风控
    await new Promise((r) => setTimeout(r, 3000));
  }
  // 采集到商品(新增或更新)即保存入库, 避免 upsert 更新丢失
  const totalCollected = results.reduce((n, r) => n + (r.sellers || []).reduce((m, s) => m + (s.productCount || 0), 0), 0);
  if (totalAdded > 0 || totalCollected > 0) save('products.json', products);
  return { results, added: totalAdded };
}

// ===== 多商品 aod URL → 逐商品提取全部跟卖卖家 → 并行开标签页采集各自店铺 (全程 CDP) =====
// 流程: 商品1 → 提取跟卖卖家 → 并行采集各卖家店铺 → 入库 → 商品2 → 提取卖家 → 并行采集 → ... 以此类推
// 输入: 商品 aod 报价页 URL 数组 (如 [/dp/B0XXX/ref=olp-opf-redir?aod=1&condition=new, ...])
async function cdpAodParallelCollectAll(aodUrls, opts = {}) {
  const maxItems = opts.maxItems === 0 ? Infinity : Math.min(50, Math.max(1, opts.maxItems || 10));    // 每店铺商品数上限 (0=无限制)
  const maxPages = opts.maxPages === 0 ? Infinity : Math.min(10, Math.max(1, opts.maxPages || 2));     // 每店铺翻页上限 (0=无限制)
  const concurrency = Math.min(6, Math.max(1, opts.concurrency || 4)); // 并行标签页上限
  // 排除指定卖家 (名称/ID, 逗号分隔)
  const exclude = (opts.excludeSellers || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const productsOut = [];
  let totalAdded = 0;
  // 输入统一转 aod 链接 (支持 ASIN/普通链接) —— 只填 ASIN 时按商品库站点拼域名(见 toAodUrlSmart)
  const normUrls = (aodUrls || []).map((u) => toAodUrlSmart(u));
  for (const aodUrl of normUrls) {
    if (collectStopRequested()) { productsOut.push({ asin: '停止', note: '用户已停止采集, 提前结束' }); break; }
    const asin = (aodUrl.match(/\/dp\/([A-Z0-9]{10})/) || [])[1] || aodUrl.slice(0, 20);
    // ① 从 aod 提取全部跟卖卖家 (内置亚马逊官方过滤 + 亚马逊词汇筛选)
    let sellers = [];
    let aodErr = null;
    try {
      sellers = await cdpExtractAodSellers(aodUrl, { amazonWords: opts.amazonWords, zip: opts.zip });
    } catch (e) {
      aodErr = e.message;
    }
    // 兜底: aod 实时提取失败 (如商品当前无可用报价) → 复用商品库历史跟卖卖家继续采集
    // (历史卖家店铺仍可能有大量同类跟卖商品, 采集价值不减; 标记 sellerFrom=history 供前端展示)
    let sellerFrom = 'aod';
    if (!sellers.length) {
      const hist = sellersFromProduct(products.find((x) => x.asin === asin));
      if (hist.length) { sellers = hist; sellerFrom = 'history'; }
    }
    if (!sellers.length) {
      productsOut.push({ asin, error: aodErr ? 'aod 提取失败: ' + aodErr : '无跟卖卖家', sellerFrom });
      continue;
    }
    // 排除指定卖家 (jianjun 等)
    if (exclude.length) {
      sellers = sellers.filter((s) => {
        const nm = String(s.seller || '').toLowerCase();
        const sid = String(s.sellerId || '').toLowerCase();
        return !exclude.some((x) => nm.includes(x) || sid.includes(x));
      });
    }
    if (!sellers.length) { productsOut.push({ asin, error: '排除指定卖家后无剩余卖家' }); continue; }
    const sellersOut = [];
    // ② 分批并行开标签页采集 (每批 ≤ concurrency)
    for (let i = 0; i < sellers.length; i += concurrency) {
      if (collectStopRequested()) { sellersOut.push({ seller: '(停止)', note: '用户已停止, 本批跳过' }); break; }
      const chunk = sellers.slice(i, i + concurrency);
      const jobs = chunk.map(async (s) => {
        let tab = null;
        try {
          tab = await cdpCreateTab('about:blank');
          const out = await cdpFollowShopChain(s.sellerUrl, { maxItems, maxPages, wsUrl: tab.wsUrl, filter: opts.filter, shopAplus: opts.shopAplus, brandStore: opts.brandStore, brandShop: opts.brandShop, zip: opts.zip });
          const added = ingestFollowShopProducts(out, true, 0);
          return { seller: out.sellerName || s.seller || out.sellerId, sellerId: out.sellerId || s.sellerId, spUrl: out.spUrl, storeUrl: out.storeUrl, productCount: out.products.length, skipped: out.skipped || 0, shopSkipped: out.shopSkipped || 0, brandShopSkip: out.brandShopSkip || 0, brandSkip: out.brandSkip || 0, added, products: out.products.map((p) => ({ asin: p.asin, title: p.title.slice(0, 100), price: p.price })), steps: out.steps, tab };
        } catch (e) {
          return { seller: s.seller || s.sellerId, sellerId: s.sellerId, error: e.message, tab };
        }
      });
      const settled = await Promise.allSettled(jobs);
      for (const st of settled) {
        const r = st.status === 'fulfilled' ? st.value : { seller: '?', error: st.reason && st.reason.message || '未知错误' };
        if (r.tab && r.tab.targetId) { try { await cdpCloseTab(r.tab.targetId); } catch {} }
        sellersOut.push(r);
        if (r.error) continue;
        totalAdded += r.added || 0;
        // 实时进度: 已处理卖家数 / 已采商品数
        const doneSellers = sellersOut.filter((s) => !s.error && !s.note).length;
        const collectedItems = sellersOut.reduce((n, s) => n + (s.productCount || 0), 0);
        bumpCollectProgress({ step: '采集卖家店铺', shopsDone: doneSellers, shopsTotal: sellers.length, items: collectedItems, added: totalAdded });
      }
    }
    productsOut.push({ asin, sellerCount: sellers.length, sellerFrom, sellers: sellersOut });
    // 每个商品之间留间隔, 避免触发风控
    await new Promise((r) => setTimeout(r, 3000));
  }
  // 采集到商品(新增或更新)即保存入库
  const totalCollected = productsOut.reduce((n, p) => n + (p.sellers || []).reduce((m, s) => m + (s.productCount || 0), 0), 0);
  if (totalAdded > 0 || totalCollected > 0) save('products.json', products);
  return { products: productsOut, added: totalAdded, stopped: collectStopRequested() };
}

// 兼容单商品调用 (旧接口名保留)
async function cdpAodParallelCollect(aodUrl, opts = {}) {
  const r = await cdpAodParallelCollectAll([aodUrl], opts);
  const first = r.products[0] || {};
  return { sellers: first.sellers || [], sellerCount: first.sellerCount || 0, added: r.added };
}

// ===== 商品输入规范化: ASIN / 普通商品链接 / aod 链接 → aod 报价链接 =====
// 从输入 URL 推导域名 (amazon.com.au / de / co.uk ...), 保留原站点; 纯 ASIN 时用传入 host 或默认 de
// 站点代码 → 域名 (CDP_SITE_CODE 的反向表); 未知返回空字符串 —— 由调用方跳过, 绝不擅自默认某个国家
const SITE_HOST_OF = { uk: 'www.amazon.co.uk', us: 'www.amazon.com', de: 'www.amazon.de', fr: 'www.amazon.fr', it: 'www.amazon.it', es: 'www.amazon.es', jp: 'www.amazon.co.jp', ca: 'www.amazon.ca', in: 'www.amazon.in', au: 'www.amazon.com.au', mx: 'www.amazon.com.mx', br: 'www.amazon.com.br', nl: 'www.amazon.nl', se: 'www.amazon.se', pl: 'www.amazon.pl' };
function siteHostOf(site) { return SITE_HOST_OF[String(site || '').toLowerCase()] || ''; }
// 从输入链接推导站点 host (与 toAodUrl 同一套域名表); 推不出返回空 —— 用于强制"跟随用户给出的链接站点"
function hostFromUrl(u) {
  const dm = String(u || '').match(/^https:\/\/(www\.)?amazon\.(com\.au|co\.uk|com|com\.mx|com\.br|de|fr|it|es|co\.jp|ca|in|nl|se|pl)/);
  return dm ? 'www.amazon.' + dm[2] : '';
}
function toAodUrl(input, host) {
  const u = String(input || '').trim();
  if (!u) return u;
  const m = u.match(/\/dp\/([A-Z0-9]{10})/);
  const dm = u.match(/^https:\/\/(www\.)?amazon\.(com\.au|co\.uk|com|com\.mx|com\.br|de|fr|it|es|co\.jp|ca|in|nl|se|pl)/);
  const h = dm ? 'www.amazon.' + dm[2] : (host || 'www.amazon.de');
  if (m && !/aod|olp/.test(u)) return `https://${h}/dp/${m[1]}/ref=olp-opf-redir?aod=1&ie=UTF8&condition=new`;
  if (/^[A-Z0-9]{10}$/.test(u) && u.startsWith('B0')) return `https://${h}/dp/${u}/ref=olp-opf-redir?aod=1&ie=UTF8&condition=new`;
  return u;
}
/** ASIN → 它在【商品库】里的站点域名。只填 ASIN 时必须靠它拼对 marketplace, 否则会默认 .de。 */
function hostOfAsinInLibrary(asin) {
  try {
    const a = String(asin || '').toUpperCase();
    const p = (products || []).find((x) => String(x.asin || '').toUpperCase() === a);
    const s = p && p.site ? String(p.site).toLowerCase() : '';
    return s ? 'www.amazon.' + siteToHostSuffix(s) : null;
  } catch (e) { return null }
}
/* ★ 2026-09-27 修复(用户实测: 点「批量跟卖店铺采集」填了个 ASIN 就报错/找不到卖家):
 *   toAodUrl 在输入里没有域名时默认 www.amazon.de —— 于是【英国/美国的 ASIN 被拿到德国站去查】,
 *   页面当然是"无可用报价/无卖家"。实测: 英国 ASIN B0D8XSNPP3 → 到 .de 查 = 0 个卖家;
 *   同一 ASIN 用 .co.uk 查 = 3 个卖家(MangSeng / GHFGHDH / linanshangdianpu)。
 *   这里统一走"先按商品库站点拼域名, 库里查不到才退回默认"。 */
function toAodUrlSmart(input) {
  const s = String(input || '').trim();
  const bare = (/^[A-Z0-9]{10}$/.test(s) && s.startsWith('B0')) ? s : null;
  const dp = (!/^https?:/i.test(s) && /\/dp\/([A-Z0-9]{10})/.test(s)) ? s.match(/\/dp\/([A-Z0-9]{10})/)[1] : null;
  const asin = bare || dp;
  const h = asin ? hostOfAsinInLibrary(asin) : null;
  return toAodUrl(s, h || undefined);
}

// ===== 多商品并行跟卖店铺采集 + 自定义重复轮次 =====
// 流程: 每轮处理一个商品(先用户填的链接/ASIN, 用完后自动从新增店铺商品中挑下一个) → 提取跟卖卖家 → 并行采集各店铺 → 入库
//       → 下一轮自动找新商品继续 (含无卖家兜底跳转), 直到完成 rounds 轮
async function cdpAodParallelCollectRounds(aodUrls, opts = {}) {
  const rounds = opts.rounds === 0 ? Infinity : Math.min(30, Math.max(1, opts.rounds || 1));  // 自定义重复轮次 (0=无限)
  const maxItems = opts.maxItems === 0 ? Infinity : Math.min(50, Math.max(1, opts.maxItems || 10));
  const maxPages = opts.maxPages === 0 ? Infinity : Math.min(10, Math.max(1, opts.maxPages || 2));
  const concurrency = Math.min(6, Math.max(1, opts.concurrency || 4));
  // 排除指定卖家 (名称/ID, 逗号分隔)
  const exclude = (opts.excludeSellers || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  // 初始队列: 用户填的商品 (ASIN/普通链接/aod 链接 统一转 aod) —— 只填 ASIN 时按商品库站点拼域名(见 toAodUrlSmart)
  const queue = (aodUrls || []).map((u) => toAodUrlSmart(u));
  // 本次采集站点: 严格取自用户输入的链接 (推不出则不做任何默认国家假设)
  const runHost = hostFromUrl((aodUrls || [])[0]) || hostFromUrl(queue[0]);
  const roundsOut = [];
  let totalAdded = 0;
  for (let r = 1; r <= rounds; r++) {
    if (collectStopRequested()) { roundsOut.push({ round: r, note: '用户已停止采集, 提前结束' }); break; }
    if (!queue.length) { roundsOut.push({ round: r, note: '无更多商品可处理, 提前结束' }); break; }
    bumpCollectProgress({ step: '第 ' + r + '/' + rounds + ' 轮 · 提取卖家', round: r, rounds });
    const aodUrl = queue.shift();
    const asin = (aodUrl.match(/\/dp\/([A-Z0-9]{10})/) || [])[1] || aodUrl.slice(0, 20);
    // ① 从 aod 提取全部跟卖卖家 (内置亚马逊官方过滤 + 亚马逊词汇筛选)
    let sellers = [];
    let aodErr = null;
    try {
      sellers = await cdpExtractAodSellers(aodUrl, { amazonWords: opts.amazonWords, zip: opts.zip });
    } catch (e) {
      aodErr = e.message;
    }
    // 兜底: aod 实时提取失败 (如商品当前无可用报价) → 复用商品库历史跟卖卖家继续采集
    let sellerFrom = 'aod';
    if (!sellers.length) {
      const hist = sellersFromProduct(products.find((x) => x.asin === asin));
      if (hist.length) { sellers = hist; sellerFrom = 'history'; }
    }
    if (!sellers.length) {
      const res = { round: r, asin, error: aodErr ? 'aod 提取失败: ' + aodErr : '无跟卖卖家', sellerFrom };
      // 兜底自动跳转: 从商品库挑下一个有跟卖链接且未处理的商品 (构造 aod 链接继续)
      if (!queue.length) {
        const newOnes = products.filter((x) => !x.__roundDone && x.asin !== asin && x.offerPrices && x.offerPrices.length && applyCollectFilter(x, opts.filter));
        if (newOnes.length) {
          const next = newOnes[0];
          next.__roundDone = true;
          // 严格跟随输入链接站点; 站点未知宁可不跳转, 也不切到别的国家
          const host = runHost || siteHostOf(next.site);
          if (host) {
            queue.push(`https://${host}/dp/${next.asin}/ref=olp-opf-redir?aod=1&ie=UTF8&condition=new`);
            res.autoJump = true;
            res.nextAsin = next.asin;
          } else {
            res.autoJumpSkipped = '输入未含可识别站点且该商品站点未知 → 已跳过自动跳转, 避免切到其他国家站点';
          }
        }
      }
      roundsOut.push(res);
      continue;
    }
    // 排除指定卖家 (jianjun 等)
    if (exclude.length) {
      sellers = sellers.filter((s) => {
        const nm = String(s.seller || '').toLowerCase();
        const sid = String(s.sellerId || '').toLowerCase();
        return !exclude.some((x) => nm.includes(x) || sid.includes(x));
      });
    }
    if (!sellers.length) { roundsOut.push({ round: r, asin, error: '排除指定卖家后无剩余卖家' }); continue; }
    const sellersOut = [];
    // ② 分批并行开标签页采集 (每批 ≤ concurrency)
    for (let i = 0; i < sellers.length; i += concurrency) {
      if (collectStopRequested()) { sellersOut.push({ seller: '(停止)', note: '用户已停止, 本批跳过' }); break; }
      const chunk = sellers.slice(i, i + concurrency);
      const jobs = chunk.map(async (s) => {
        let tab = null;
        try {
          tab = await cdpCreateTab('about:blank');
          const out = await cdpFollowShopChain(s.sellerUrl, { maxItems, maxPages, wsUrl: tab.wsUrl, filter: opts.filter, shopAplus: opts.shopAplus, brandStore: opts.brandStore, brandShop: opts.brandShop, zip: opts.zip });
          const added = ingestFollowShopProducts(out, true, 0);
          return { seller: out.sellerName || s.seller || out.sellerId, sellerId: out.sellerId || s.sellerId, spUrl: out.spUrl, storeUrl: out.storeUrl, productCount: out.products.length, skipped: out.skipped || 0, shopSkipped: out.shopSkipped || 0, brandShopSkip: out.brandShopSkip || 0, brandSkip: out.brandSkip || 0, added, products: out.products.map((p) => ({ asin: p.asin, title: p.title.slice(0, 100), price: p.price })), steps: out.steps, tab };
        } catch (e) {
          return { seller: s.seller || s.sellerId, sellerId: s.sellerId, error: e.message, tab };
        }
      });
      const settled = await Promise.allSettled(jobs);
      for (const st of settled) {
        const r2 = st.status === 'fulfilled' ? st.value : { seller: '?', error: st.reason && st.reason.message || '未知错误' };
        if (r2.tab && r2.tab.targetId) { try { await cdpCloseTab(r2.tab.targetId); } catch {} }
        sellersOut.push(r2);
        if (r2.error) continue;
        totalAdded += r2.added || 0;
      }
      const doneShops = sellersOut.filter((x) => !x.error).length;
      const gotItems = sellersOut.reduce((n, x) => n + (x.productCount || 0), 0);
      bumpCollectProgress({ step: '第 ' + r + '/' + rounds + ' 轮 · 采店铺', round: r, rounds, shopsDone: doneShops, shopsTotal: sellers.length, items: gotItems, added: totalAdded });
    }
    roundsOut.push({ round: r, asin, sellerCount: sellers.length, sellerFrom, sellers: sellersOut });
    // ③ 自动补充下一个商品: 从本轮新增入库的店铺商品中挑一个未处理过且带跟卖链接(aod已采)的, 构造 aod 链接入队
    // (必须要求 offerPrices 有值 — 否则跳到无跟卖的商品, 下一轮 aod 提取必然失败浪费轮次)
    const newOnes = products.filter((x) => x.source === 'cdp-follow-shop' && !x.__roundDone && x.offerPrices && x.offerPrices.length);
    if (!queue.length && newOnes.length) {
      const next = newOnes[0];
      next.__roundDone = true;
      const nextAsin = next.asin;
      const host = runHost || siteHostOf(next.site);
      if (host) {
        queue.push(`https://${host}/dp/${nextAsin}/ref=olp-opf-redir?aod=1&ie=UTF8&condition=new`);
        roundsOut[roundsOut.length - 1].autoJump = true;
        roundsOut[roundsOut.length - 1].nextAsin = nextAsin;
      } else {
        roundsOut[roundsOut.length - 1].autoJumpSkipped = '输入未含可识别站点且该商品站点未知 → 已跳过自动跳转, 避免切到其他国家站点';
      }
    }
    // 每个商品之间留间隔, 避免触发风控
    await new Promise((r) => setTimeout(r, 3000));
  }
  // 清理 __roundDone 标记
  products.forEach((x) => delete x.__roundDone);
  // 采集到商品(新增或更新)即保存入库
  const totalCollected = roundsOut.reduce((n, r) => n + (r.sellers || []).reduce((m, s) => m + (s.productCount || 0), 0), 0);
  if (totalAdded > 0 || totalCollected > 0) save('products.json', products);
  return { rounds: roundsOut, added: totalAdded, okRounds: roundsOut.filter((x) => !x.error && !x.note).length, autoJumps: roundsOut.filter((x) => x.autoJump).length, stopped: collectStopRequested() };
}

// ===== 跟卖店铺批量采集 (全程 CDP) + 循环跳转 =====
// 流程: 每轮处理一个商品 → 遍历其全部跟卖卖家(出售单位) → 逐个跳转卖家详情页(/sp) → 参观出售单位链接
//       → 卖家店铺全部商品采集 → 下一个卖家 → 该商品所有卖家采集完成后 → 根据采集到的商品信息(新ASIN)跳转循环
// 输入: asins 商品 ASIN/链接数组 (优先取商品库 offerPrices[].sellerUrl; 不在库/无跟卖链接时自动转 aod 实时提取卖家, 真正去采集)
// rounds 循环轮次 (自动从新采集商品挑下一个)
async function cdpFollowShopBatch(asins, opts = {}) {
  // 0 = 无限制
  const maxItems = opts.maxItems === 0 ? Infinity : Math.min(100, Math.max(1, opts.maxItems || 10));   // 每店铺商品数上限
  const maxPages = opts.maxPages === 0 ? Infinity : Math.min(20, Math.max(1, opts.maxPages || 2));     // 每店铺翻页上限
  const rounds = opts.rounds === 0 ? Infinity : Math.min(30, Math.max(1, opts.rounds || 1));           // 循环轮次: 每轮一个商品, 自动跳转
  const concurrency = Math.min(6, Math.max(1, opts.concurrency || 4)); // 并行卖家店铺数
  const exclude = (opts.excludeSellers || '').split(/[,，]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  const amazonWords = String(opts.amazonWords || 'amazon,亚马逊');
  const results = [];
  let totalAdded = 0;
  // 队列: 先用户指定商品, 用完自动从新采集的店铺商品中挑下一个
  const queue = [...asins];
  const processed = new Set();
  for (let r = 1; r <= rounds; r++) {
    if (collectStopRequested()) { results.push({ round: r, note: '用户已停止采集, 提前结束' }); break; }
    if (!queue.length) { results.push({ round: r, note: '无更多商品可处理, 提前结束' }); break; }
    const input = queue.shift();
    const asin = (String(input).match(/\/dp\/([A-Z0-9]{10})/) || [])[1] || String(input).trim();
    if (processed.has(asin)) { results.push({ round: r, asin, note: '已处理过, 跳过' }); continue; }
    processed.add(asin);
    const prod = products.find((x) => x.asin === asin);
    // 卖家来源: ① 商品库 offerPrices 已采跟卖链接 (快路径) ② 不在库/无链接 → 转 aod 实时提取 (真正去采集)
    let sellers = [];
    let sellerFrom = '库';
    if (prod && (prod.offerPrices || []).some((o) => o.sellerUrl)) {
      sellers = sellersFromProduct(prod);
    } else {
      sellerFrom = 'aod';
      try {
        sellers = await cdpExtractAodSellers(toAodUrlSmart(input), { amazonWords, zip: opts.zip });
      } catch (e) {
        const res = { round: r, asin, error: 'aod 提取失败: ' + e.message };
        // 兜底自动跳转: 从商品库挑下一个有跟卖链接且未处理的商品继续 (不浪费轮次)
        if (!queue.length) {
          const next = products.find((x) => !processed.has(x.asin) && x.asin !== asin && x.offerPrices && x.offerPrices.some((o) => o.sellerUrl) && applyCollectFilter(x, opts.filter));
          if (next) { queue.push(next.asin); res.autoJump = true; res.nextAsin = next.asin; }
        }
        results.push(res);
        continue;
      }
      // 排除指定卖家 (名称/ID, 逗号分隔)
      if (exclude.length) {
        sellers = sellers.filter((s) => {
          const nm = String(s.seller || '').toLowerCase();
          const sid = String(s.sellerId || '').toLowerCase();
          return !exclude.some((x) => nm.includes(x) || sid.includes(x));
        });
      }
    }
    if (!sellers.length) {
      const res = { round: r, asin, error: sellerFrom === '库' ? '无带跳转链接的跟卖卖家' : 'aod 无跟卖卖家' };
      // 兜底自动跳转: 从商品库挑下一个有跟卖链接且未处理的商品继续 (不浪费轮次)
      if (!queue.length) {
        const next = products.find((x) => !processed.has(x.asin) && x.asin !== asin && x.offerPrices && x.offerPrices.some((o) => o.sellerUrl) && applyCollectFilter(x, opts.filter));
        if (next) { queue.push(next.asin); res.autoJump = true; res.nextAsin = next.asin; }
      }
      results.push(res);
      continue;
    }
    const sellersOut = [];
    // 并行采集: 分批开标签页 (每批 ≤ concurrency), 提升速度
    for (let i = 0; i < sellers.length; i += concurrency) {
      if (collectStopRequested()) { sellersOut.push({ seller: '(停止)', note: '用户已停止, 本批跳过' }); break; }
      const chunk = sellers.slice(i, i + concurrency);
      const jobs = chunk.map(async (s) => {
        let tab = null;
        try {
          tab = await cdpCreateTab('about:blank');
          const out = await cdpFollowShopChain(s.sellerUrl, { maxItems, maxPages, wsUrl: tab.wsUrl, filter: opts.filter, shopAplus: opts.shopAplus, brandStore: opts.brandStore, brandShop: opts.brandShop, zip: opts.zip });
          const added = ingestFollowShopProducts(out, true, 0);
          return { seller: out.sellerName || s.seller || out.sellerId, sellerId: out.sellerId || s.sellerId, spUrl: out.spUrl, storeUrl: out.storeUrl, productCount: out.products.length, skipped: out.skipped || 0, shopSkipped: out.shopSkipped || 0, brandShopSkip: out.brandShopSkip || 0, brandSkip: out.brandSkip || 0, added, products: out.products.map((p) => ({ asin: p.asin, title: p.title.slice(0, 100), price: p.price })), steps: out.steps, tab };
        } catch (e) {
          return { seller: s.seller || s.sellerId, sellerId: s.sellerId, error: e.message, tab };
        }
      });
      const settled = await Promise.allSettled(jobs);
      for (const st of settled) {
        const r2 = st.status === 'fulfilled' ? st.value : { seller: '?', error: st.reason && st.reason.message || '未知错误' };
        if (r2.tab && r2.tab.targetId) { try { await cdpCloseTab(r2.tab.targetId); } catch {} }
        sellersOut.push(r2);
        if (r2.error) continue;
        totalAdded += r2.added || 0;
      }
    }
    results.push({ round: r, asin, title: ((prod && prod.title) || asin).slice(0, 80), sellerCount: sellers.length, sellerFrom, sellers: sellersOut, autoJump: false });
    bumpCollectProgress({ step: '第 ' + r + ' 轮采集完成', round: r, rounds, items: results.reduce((n, x) => n + (x.sellers || []).reduce((m, s) => m + (s.productCount || 0), 0), 0), added: totalAdded });
    // ===== 循环跳转: 该商品所有卖家店铺采集完成 → 根据采集到的商品信息挑下一个 =====
    if (!queue.length) {
      // 优先挑带跟卖链接(aod 已采)的新入库店铺商品, 未处理过的
      const newOnes = products.filter((x) => x.source === 'cdp-follow-shop' && !processed.has(x.asin) && x.offerPrices && x.offerPrices.length);
      if (newOnes.length) {
        const next = newOnes[0];
        queue.push(next.asin);
        results[results.length - 1].autoJump = true;
        results[results.length - 1].nextAsin = next.asin;
      }
    }
    // 每个商品之间留间隔, 避免触发风控
    await new Promise((r2) => setTimeout(r2, 3000));
  }
  // 采集到商品(新增或更新)即保存入库
  const totalCollected = results.reduce((n, r) => n + (r.sellers || []).reduce((m, s) => m + (s.productCount || 0), 0), 0);
  if (totalAdded > 0 || totalCollected > 0) save('products.json', products);
  const okRounds = results.filter((x) => !x.error && !x.note).length;
  const autoJumps = results.filter((x) => x.autoJump).length;
  const stopped = collectStopRequested();
  return { results, added: totalAdded, okRounds, autoJumps, stopped };
}

// ===== 详情修复 (存量数据修复): 重新打开商品详情页, 用与采集链路同一套提取逻辑刷新全部详情字段 =====
// 修复内容: 主图(高清) / 真实价格 / 配送FBA-FBM / 亚马逊自营 / A+ / 主卖家 / 评分评论 / 类目 / BSR / 站点币种
// 目标筛选: asins 指定 / since 采集时间 / needsDetail=true 只修"详情页从未读成功过"的 / all=true 全库
// 可被「停止」中断
async function cdpBackfillMainImage(opts = {}) {
  const asinList = Array.isArray(opts.asins) && opts.asins.length ? opts.asins.map((x) => String(x).trim().toUpperCase()) : null;
  const since = opts.since ? String(opts.since) : null;
  const limit = opts.limit > 0 ? parseInt(opts.limit, 10) : 0;
  const catOnly = !!opts.catOnly;                       // 仅补类目层级: 不滚动(面包屑在页首) → 明显更快
  let targets = products.filter((x) => x && x.asin);
  if (catOnly) targets = targets.filter((x) => !x.catSrc);                    // 只补"没类目层级"的
  else if (opts.needsDetail) targets = targets.filter((x) => !x.detailOk);     // 详情页从未读成功
  else if (!asinList) targets = targets.filter((x) => !x.mainImage || !x.detailOk);
  if (asinList) targets = targets.filter((x) => asinList.includes(String(x.asin).toUpperCase()));
  if (since) targets = targets.filter((x) => String(x.collectedAt || '') >= since);
  targets.sort((a, b) => String(b.collectedAt || '').localeCompare(String(a.collectedAt || '')));
  if (limit) targets = targets.slice(0, limit);
  if (!targets.length) return { total: 0, fixed: 0, failed: 0, results: [] };

  const tabs = await cdpGetTabs();
  const page = tabs.find((t) => t.type === 'page' && /amazon\./.test(t.url || '')) || tabs.find((t) => t.type === 'page');
  if (!page) throw new Error('Edge 无可用页面标签, 请确认 Edge 以 --remote-debugging-port=9222 启动');
  const { send } = await cdpConnect(page.webSocketDebuggerUrl);

  // 提取表达式 = 共用 DETAIL_READ_EXPR (与批量品牌采集同一实现, 见 DETAIL_CORE_JS 注释)
  const IMG_EXPR = DETAIL_READ_EXPR;

  const results = [];
  let fixed = 0, failed = 0;
  for (let i = 0; i < targets.length; i++) {
    if (collectStopRequested()) { results.push({ error: '用户已停止 (处理到第 ' + (i + 1) + ' 个)', stopped: true }); break; }
    const it = targets[i];
    const host = 'www.amazon.' + siteToHostSuffix(it.site || 'uk');
    bumpCollectProgress({ items: i + 1, added: fixed, step: '补主图 ' + it.asin + ' (' + (i + 1) + '/' + targets.length + ')' });
    try {
      await send('Page.navigate', { url: 'https://' + host + '/dp/' + it.asin });
      await new Promise((r) => setTimeout(r, 2500));
      // 等详情页渲染 (标题 + 主图), 最多 15s — 与采集链路同一就绪判定
      for (let w = 0; w < 15; w++) {
        try {
          const rr = await send('Runtime.evaluate', {
            expression: `(() => { const t = document.querySelector('#productTitle'); const i = document.querySelector('#landingImage, #imgTagWrapperId img, #main-image-container img, #imageBlock img'); return JSON.stringify({ t: !!t, i: !!i }); })()`,
            returnByValue: true,
          });
          const st = JSON.parse(rr.result.value);
          if (st.t && st.i) break;
        } catch (e) { /* 继续等 */ }
        await new Promise((r) => setTimeout(r, 1000));
      }
      for (let s = 0; s < 2 && !catOnly; s++) { await send('Runtime.evaluate', { expression: `window.scrollTo(0, ${(s + 1) * 3000})` }); await new Promise((r) => setTimeout(r, 600)); }
      await new Promise((r) => setTimeout(r, catOnly ? 300 : 800));
      const rf = await send('Runtime.evaluate', { expression: IMG_EXPR, returnByValue: true });
      let d = {};
      try { d = JSON.parse(rf.result.value || '{}'); } catch (e) { d = {}; }
      // 详情修复: 读成功(detailOk)才判定 配送/自营/A+; 价格取详情页真实价 (店铺卡片价不可靠)
      if (d.mainImage) { it.mainImage = d.mainImage; fixed++; } else failed++;
      if (d.rating != null) it.rating = d.rating;
      if (d.reviews != null) it.reviews = d.reviews;
      if (d.category) it.category = d.category;
      if (d.brand && (!it.brand || it.brand === 'Unknown')) it.brand = d.brand;
      if (d.newFrom != null) { it.price = d.newFrom; it.minPrice = d.newFrom; if (d.price != null) it.buyBoxPrice = d.price; }
      else if (d.price != null) { it.price = d.price; it.buyBoxPrice = d.price; it.minPrice = d.price; }   // 价格修正 → minPrice/buyBoxPrice 同步, 否则会残留旧价
      // 报价里的最低价若存在, minPrice 取 自身价 与 报价最低价 的较小值
      if (Array.isArray(it.offerPrices) && it.offerPrices.length) {
        const nums = [it.price, ...it.offerPrices.map((o) => o.price)].filter((v) => v != null);
        if (nums.length) it.minPrice = Math.min(...nums);
      }
      if (d.bsr && d.bsr.length) { it.bsr = d.bsr; it.rank = '#' + Math.max(...d.bsr.map((b) => b.rank)); }
      if (d.firstAvailable) it.firstAvailable = d.firstAvailable;
      const wasVerified = it.detailVer === DETAIL_VER;    // 旧值是否由"当前版本"提取器验证过
      if (d.detailOk) {
        it.detailOk = true; it.detailAt = now(); it.detailVer = DETAIL_VER;        it.aplus = !!d.aplus;
        if (d.regionText) {
          it.amazonSell = !!d.amazonSell;
          if (d.fulfill) it.fulfill = d.fulfill;
          else if (!wasVerified) it.fulfill = null;       // 旧值是默认猜的 → 清成"未知", 不留假数据
          // sellerRegion 已停写: 这里原来写 d.regionText(诊断串, 非产地) —— 见本文件 2800 行处的完整说明
        }
        if (d.mainSeller) it.mainSeller = d.mainSeller;
        if (siteSymbolOk(d.curSymbol, it.site || host)) it.priceSymbol = d.curSymbol;
        if (d.catPath) { it.catPath = d.catPath; it.cat1 = d.cat1; it.cat2 = d.cat2; it.cat3 = d.cat3; it.catNodes = d.catNodes || null; it.catSrc = 'bc'; it.catAt = now(); }
        it.currency = siteCurrency(it.site || 'uk');
      }
      results.push({ asin: it.asin, site: it.site, mainImage: !!d.mainImage, rating: d.rating, category: d.category, fulfill: it.fulfill, amazonSell: it.amazonSell, aplus: it.aplus, mainSeller: it.mainSeller, price: it.price, currency: it.currency, region: (d.regionText || '').slice(0, 160) });
    } catch (e) {
      failed++;
      results.push({ asin: it.asin, site: it.site, error: e && e.message });
    }
    save('products.json', products);
    await new Promise((r) => setTimeout(r, 700));
  }
  return { total: targets.length, fixed, failed, results };
}

// 站点 → 币种 (缺失会导致 AU 商品被写为 EUR 等错误数据)
const SITE_CURRENCY = {
  uk: 'GBP', us: 'USD', au: 'AUD', ca: 'CAD', jp: 'JPY', in: 'INR', mx: 'MXN', br: 'BRL',
  sg: 'SGD', tr: 'TRY', ae: 'AED', sa: 'SAR', se: 'SEK', pl: 'PLN', nl: 'EUR', de: 'EUR',
  fr: 'EUR', it: 'EUR', es: 'EUR', be: 'EUR', ie: 'EUR',
};
const siteCurrency = (site) => SITE_CURRENCY[site] || 'EUR';
// 币种符号校验: 只接受与站点币种匹配的符号
// 为什么需要: 页面里会注入智赢插件自己的价格块(常按 CNY 显示), 而 .a-price-symbol/.a-offscreen 是通用 class →
// 详情提取会把插件的 "CNY" 当成亚马逊价格符号读进来 (实测存量里出现过 de/EUR 行却带 CNY 符号)
function siteSymbolOk(sym, siteOrHost) {
  if (!sym) return false;
  const raw = String(siteOrHost || '');
  let site = raw;
  const m = raw.match(/amazon\.([a-z.]+)$/);
  if (m) site = CDP_SITE_CODE[m[1]] || m[1];
  const cur = SITE_CURRENCY[site];
  const allow = { AUD: ['$', 'A$'], USD: ['$', 'US$'], GBP: ['£'], EUR: ['€'], JPY: ['¥'], CAD: ['$', 'C$'], INR: ['₹'], MXN: ['$', 'MX$'], BRL: ['R$'], SGD: ['S$'], PLN: ['zł'], SEK: ['kr'], TRY: ['₺'], AED: ['AED'], SAR: ['SAR'] }[cur];
  if (!cur || !allow) return true;                      // 未知站点 → 不拦
  return allow.indexOf(String(sym).trim()) >= 0;
}

// 跟卖店铺采集结果 → 导入商品库 (新增 + 已存在更新变体/价格/品牌, 返回新增数)
function ingestFollowShopProducts(out, withPanel = false, panelLimit = 0) {
  const site = out.site;
  const currency = siteCurrency(site);
  const used = new Set(products.map((x) => x.asin));
  let added = 0;
  for (let i = 0; i < out.products.length; i++) {
    const p = out.products[i];
    let pd = null;
    if (withPanel && i < panelLimit && out.send) {
      try { pd = cdpReadOnePanel(out.send, p.asin, out.host.replace('www.amazon.', '')); }
      catch { pd = null; }
    }
    const price = parseMoneyText(p.price, p.site || site) || null;   // ★ 站点感知
    // bsr 规范化: 店铺页 ranktag 是纯数字数组, 详情修正后是 {rank,category} 对象数组 → 统一对象
    const pBsr = (Array.isArray(p.bsr) ? p.bsr : []).map((b) => typeof b === 'number' ? { rank: b, category: null } : (b && typeof b === 'object' && b.rank != null ? b : null)).filter(Boolean);
    const tm = pd && pd.tmText || '';
    // 插件字段取值: 详情页内联插件读取 (p.*, 详情阶段已取) 优先于旧的面板补全 (pd) — 两者同源, p 更新
    const pfv = (k) => (p[k] != null && p[k] !== '' ? p[k] : (pd ? pd[k] : null)) || null;
    const sales30dNum = parseInt(String(pfv('sales30d') || '').replace(/[^\d]/g, ''), 10) || 0;
    // 品牌: 详情页修正的品牌 > 插件面板品牌 > Unknown
    let brandName = (pd && pd.brand) || null;
    if (!brandName && p.brand) brandName = String(p.brand).replace(/\s+/g, ' ').trim();
    if (!brandName) brandName = 'Unknown';
    brandName = brandName.replace(/^Brand:\s*/i, '').slice(0, 40) || 'Unknown';
    // ★ 2026-09-24 修复: 跟卖链路的 p.variants 可能是【字符串/数字】(面板"变体:N个"), 不是分组数组。
    //   旧代码直接 p.variants.length + .reduce → 抛 "variants.reduce is not a function",
    //   导致跟卖店铺采集【每个卖家都失败】(实测 2/2 失败, 采集 0 条)。此处与其他 22 处统一口径。
    const variants = Array.isArray(p.variants) ? p.variants : null;
    if (p.variants != null && !Array.isArray(p.variants)) {
      console.warn('[跟卖采集] variants 非数组 (类型=' + typeof p.variants + ', 值=' + JSON.stringify(p.variants).slice(0, 60) + ') asin=' + p.asin);
    }
    const variations = variants && variants.length
      ? variants.reduce((n, g) => n + (g && Array.isArray(g.options) ? g.options.length : 0), 0)
      : (Number(p.variations) || 0);
    // minPrice 兜底: 自身价格 与 offerPrices 最低价 取最小 (商品页 "from €X" 含自身报价)
    const minPriceVal = p.minPrice != null ? p.minPrice : (() => {
      const nums = [price, ...(p.offerPrices || []).map((o) => o.price)].filter((v) => v != null);
      return nums.length ? Math.min(...nums) : null;
    })();
    // 已存在 → 更新价格/品牌/变体/跟卖/配送
    const existing = products.find((x) => x.asin === p.asin);
    if (existing) {
      if (price != null) {
        existing.price = price;
        // 价格变了 → 佣金按类目费率表重算 (旧值是按旧价×15% 存的, 不更新会导致佣金率算错)
        const nr = referralRateFor(existing.cat1).rate / 100;
        existing.referralFee = Math.round(price * nr * 100) / 100;
        existing.netProfit = null;   // 旧净利是硬编码公式产物, 已不可信 → 由利润测算产生
      }
      existing.brand = brandName;
      if (variants && variants.length) { existing.variants = variants; existing.variations = variations; }
      if (p.title) existing.title = p.title;
      if (p.bsr && p.bsr.length) { existing.bsr = pBsr; existing.rank = pBsr.length ? '#' + Math.max(...pBsr.map((b) => b.rank)) : existing.rank; }
      if (p.rating != null) existing.rating = p.rating;
      if (p.reviews != null) existing.reviews = p.reviews;
      if (p.category) existing.category = p.category;
      if (p.firstAvailable) existing.firstAvailable = p.firstAvailable;
      // 物流字段 (详情页内联插件读取优先, 面板补全兜底: 重量/尺寸/包装/FBA费用/商品类型)
      if (pfv('size')) existing.size = pfv('size');
      if (pfv('weight')) existing.weight = pfv('weight');
      if (pfv('packSize')) existing.packSize = pfv('packSize');
      if (pfv('packWeight')) existing.packWeight = pfv('packWeight');
      if (pfv('fbaFee')) existing.fbaFee = pfv('fbaFee');
      if (pfv('productType')) existing.productType = pfv('productType');
      if (sales30dNum > 0) existing.monthlySales = sales30dNum;
      // 配送方式/主报价卖家/A+/亚马逊自营/主图/商标 — 三态更新 (详情页读成功才判定 true/false)
      if (p.fulfill) existing.fulfill = p.fulfill;
      if (p.mainSeller) existing.mainSeller = p.mainSeller;
      if (p.detailOk) {
        const wasVerified = existing.detailVer === DETAIL_VER;
        existing.aplus = !!p.aplus;
        existing.detailOk = true;
        existing.detailAt = p.detailAt || now();
        existing.detailVer = DETAIL_VER;
        if (p.sellerRegion) {
          existing.amazonSell = !!p.amazonSell;
          existing.sellerRegion = p.sellerRegion;
          if (!p.fulfill && !wasVerified) existing.fulfill = null;   // 旧值是猜的 → 清成未知
        }
        if (siteSymbolOk(p.priceSymbol, existing.site)) existing.priceSymbol = p.priceSymbol;
        if (p.catPath) { existing.catPath = p.catPath; existing.cat1 = p.cat1; existing.cat2 = p.cat2; existing.cat3 = p.cat3; existing.catNodes = p.catNodes || null; existing.catSrc = 'bc'; existing.catAt = p.catAt || now(); }
        existing.currency = currency;                 // 站点币种纠正 (AU→AUD 等)
      }
      if (p.mainImage) existing.mainImage = p.mainImage;
      if (p.trademarkCount != null && p.trademarkCount > 0) existing.trademarkCount = p.trademarkCount;
      if (p.tmCountries && p.tmCountries.length) existing.tmCountries = p.tmCountries;
      if (p.tmText) existing.tmText = p.tmText;
      // 跟卖 (aod): 有则更新
      if (p.offerPrices && p.offerPrices.length) {
        existing.offerPrices = p.offerPrices;
        existing.followCount = p.followCount || p.offerPrices.length;
        existing.aodTotal = p.aodTotal;
        // minPrice: 优先采集值, 否则取 自身价格 与 offerPrices 最低价 的最小值
        // (商品页 "New from €X" 含自身报价; 只取 offerPrices 会把 minPrice 错误抬高于自身价)
        if (p.minPrice != null) existing.minPrice = p.minPrice;
        else {
          const nums = [existing.price, ...p.offerPrices.map((o) => o.price)].filter((v) => v != null);
          if (nums.length) existing.minPrice = Math.min(...nums);
        }
      }
      continue;
    }
    used.add(p.asin);
    const bsr = pBsr;
    const maxRank = bsr.length ? Math.max(...bsr.map((b) => b.rank)) : null;
    const item = {
      id: p.asin, asin: p.asin, rank: maxRank != null ? '#' + maxRank : null, title: p.title, brand: brandName,
      brandStatus: 'unchecked', bgMark: false, tmMark: false, patentRisk: false, trademarkCount: 0,
      followCount: p.followCount || 0, chinaSeller: chinaSellerOf(p), sellerCountryCode: sellerCountryCodeOf(p),
      // 未知一律 null (绝不伪造成 FBM/4分等); 详情页读成功(detailOk)才有 true/false 判定
      fulfill: p.fulfill || null, amazonSell: p.detailOk ? !!p.amazonSell : null,
      mainSeller: p.mainSeller || null, mainImage: p.mainImage || null,
      aplus: p.detailOk ? !!p.aplus : null, detailOk: !!p.detailOk, detailAt: p.detailAt || null, detailVer: p.detailVer || null,
      sellerRegion: p.sellerRegion || null, priceSymbol: p.priceSymbol || null,
      trademarkCount: p.trademarkCount || 0, tmCountries: p.tmCountries || [], tmText: p.tmText || null,
      price, currency,
      offerPrices: p.offerPrices || null,
      minPrice: minPriceVal,
      monthlySales: sales30dNum,
      reviews: p.reviews != null ? p.reviews : null, rating: p.rating != null ? p.rating : null, stock: 0,
      listedAt: (p.firstAvailable || pfv('listedAt') || '').slice(0, 10) || null,   // 读不到上架日期 → null (不写"今天")
      size: pfv('size'), weight: pfv('weight'), packSize: pfv('packSize'), packWeight: pfv('packWeight'),
      color: (pd && pd.color) || p.color || null, variantSize: (pd && pd.variantSize) || p.variantSize || null, fbaFee: pfv('fbaFee'),
      productType: pfv('productType'), sellerId: out.sellerId || null,
      bsr, variations: (Array.isArray(p.variants) && p.variants.length ? p.variants.reduce((n, g) => n + (g && Array.isArray(g.options) ? g.options.length : 0), 0) : (Number(p.variations) || 0)),
      variants: p.variants || null,
      referralFee: price != null ? Math.round(price * 0.15 * 100) / 100 : null, netProfit: null,   // 价格未知 → null (不写 0)
      site, category: p.category || 'FollowShop', collectedAt: now(), source: 'cdp-follow-shop', saved: false, real: true,
      // 类目层级 (面包屑): 一级/二级/三级 + 全路径 + Amazon 节点ID
      catPath: p.catPath || null, cat1: p.cat1 || null, cat2: p.cat2 || null, cat3: p.cat3 || null,
      catNodes: p.catNodes || null, catSrc: p.catPath ? 'bc' : null, catAt: p.catPath ? (p.catAt || now()) : null,
      shopSeller: out.sellerName || out.sellerId || null, shopUrl: (out.storeUrl || '').slice(0, 160), sellerPageUrl: (out.spUrl || '').slice(0, 160),
    };
    // ★ 2026-09-24: 价格未知 → 派生字段一律 null (原写法会产出 netProfit=-3.2 / aiSuggestPrice=-0.5)
    if (item.price != null) {
      item.netProfit = Math.round((item.price - item.referralFee - 3.2 - item.price * 0.3) * 100) / 100;
      item.aiSuggestPrice = Math.round((item.price - 0.5) * 100) / 100;
    } else {
      item.netProfit = null; item.aiSuggestPrice = null;
    }
    item.aiScore = Math.round(Math.min(96, Math.max(30, 80 - item.trademarkCount * 0.5)));
    item.aiRiskLevel = 'low';
    products.unshift(applyRankFields(item));
    added++;
  }
  return added;
}

// 品牌链采集: 店铺页 → 品牌店 → 品牌全部商品 (多页) + 插件面板补全 (全程 CDP)
async function cdpBrandChain(url, maxBrands = 2, maxPages = 3, withPanel = true, panelLimit = 0) {
  const tabs = await cdpGetTabs();
  const page = tabs.find((t) => t.type === 'page');
  if (!page) throw new Error('Edge 无可用页面标签, 请确认 Edge 以 --remote-debugging-port=9222 启动');
  const { send } = await cdpConnect(page.webSocketDebuggerUrl);
  const siteMatch = url.match(/amazon\.(com\.au|co\.uk|com|com\.mx|com\.br|de|fr|it|es|co\.jp|ca|in|nl|se|pl)/);
  const site = siteMatch && CDP_SITE_CODE[siteMatch[1]] ? CDP_SITE_CODE[siteMatch[1]] : 'uk';
  const host = 'www.amazon.' + siteToHostSuffix(site);

  // 1. 店铺页商品 + 品牌链接
  await send('Page.navigate', { url });
  await new Promise((r) => setTimeout(r, 9000));
  for (let i = 0; i < 5; i++) { await send('Runtime.evaluate', { expression: `window.scrollTo(0, ${(i + 1) * 4000})` }); await new Promise((r) => setTimeout(r, 1000)); }
  await new Promise((r) => setTimeout(r, 1500));
  const r1 = await send('Runtime.evaluate', {
    expression: `(() => {
      const out = [];
      document.querySelectorAll('div[data-asin]').forEach(el => {
        const asin = el.getAttribute('data-asin');
        if (!asin || !/^[A-Z0-9]{10}$/.test(asin) || !el.querySelector('a[href*="/dp/"]')) return;
        const titleEl = el.querySelector('h2 span, h2');
        const priceEl = el.querySelector('.a-price .a-offscreen');
        let brandLink = null, brandName = null;
        el.querySelectorAll('a[href*="/sp?seller="]').forEach(a => { if (!brandLink) { brandLink = a.getAttribute('href'); brandName = (a.textContent || '').trim().replace(/\\s+/g, ' '); } });
        out.push({ asin, title: titleEl ? titleEl.textContent.trim().slice(0, 150) : '', price: priceEl ? priceEl.textContent.trim() : '', brandLink, brandName: brandName || null });
      });
      const seen = new Set();
      return JSON.stringify(out.filter(c => { if (seen.has(c.asin)) return false; seen.add(c.asin); return true; }));
    })()`, returnByValue: true,
  });
  let shopCards = [];
  try { shopCards = JSON.parse(r1.result.value); } catch {}
  const brandMap = new Map();
  shopCards.forEach((c) => {
    if (c.brandLink && !brandMap.has(c.brandName || c.brandLink)) {
      const spUrl = c.brandLink.startsWith('http') ? c.brandLink : `https://${host}` + c.brandLink;
      brandMap.set(c.brandName || c.brandLink, { name: c.brandName || '未知品牌', spUrl });
    }
  });
  const brands = [...brandMap.values()].slice(0, maxBrands);

  // 2. 逐个品牌: 跳品牌店 → 找商品列表 → 翻页采集
  const results = [];
  for (const brand of brands) {
    if (collectStopRequested()) break;
    await send('Page.navigate', { url: brand.spUrl });
    await new Promise((r) => setTimeout(r, 8000));
    for (let i = 0; i < 3; i++) { await send('Runtime.evaluate', { expression: `window.scrollTo(0, ${(i + 1) * 3000})` }); await new Promise((r) => setTimeout(r, 800)); }
    await new Promise((r) => setTimeout(r, 1200));
    const r2 = await send('Runtime.evaluate', {
      expression: `(() => {
        let link = null;
        document.querySelectorAll('a[href*="seller="], a[href*="me="]').forEach(a => {
          const h = a.getAttribute('href') || '';
          if (h.includes('s?') && !link) link = h;
        });
        return JSON.stringify(link);
      })()`, returnByValue: true,
    });
    let listUrl = r2.result.value;
    try { listUrl = JSON.parse(listUrl); } catch {}
    if (!listUrl) continue;
    if (!listUrl.startsWith('http')) listUrl = `https://${host}` + listUrl;
    const products = [];
    const seenAsin = new Set();
    for (let pg = 1; pg <= maxPages; pg++) {
      if (collectStopRequested()) break;
      const pgUrl = pg === 1 ? listUrl : listUrl.includes('page=') ? listUrl.replace(/page=\d+/, 'page=' + pg) : listUrl + (listUrl.includes('?') ? '&' : '?') + 'page=' + pg;
      await send('Page.navigate', { url: pgUrl });
      await new Promise((r) => setTimeout(r, 8000));
      for (let i = 0; i < 4; i++) { await send('Runtime.evaluate', { expression: `window.scrollTo(0, ${(i + 1) * 4000})` }); await new Promise((r) => setTimeout(r, 900)); }
      await new Promise((r) => setTimeout(r, 1200));
      const r3 = await send('Runtime.evaluate', {
        expression: `(() => {
          const out = [];
          document.querySelectorAll('div[data-asin]').forEach(el => {
            const asin = el.getAttribute('data-asin');
            if (!asin || !/^[A-Z0-9]{10}$/.test(asin) || !el.querySelector('a[href*="/dp/"]')) return;
            const t = el.querySelector('h2 span, h2');
            const pr = el.querySelector('.a-price .a-offscreen');
            const lk = el.querySelector('a[href*="/dp/"]');
            out.push({ asin, title: t ? t.textContent.trim().slice(0, 150) : '', price: pr ? pr.textContent.trim() : '', link: lk ? lk.href : '' });
          });
          return JSON.stringify(out);
        })()`, returnByValue: true,
      });
      let items = [];
      try { items = JSON.parse(r3.result.value); } catch {}
      const fresh = items.filter((x) => !seenAsin.has(x.asin));
      fresh.forEach((x) => seenAsin.add(x.asin));
      products.push(...fresh.map(applyRankFields));
      if (items.length < 16) break;
    }
    // 插件面板补全 (全程 CDP, 无 API): 品牌/商标/排名/销量/FBA/尺寸
    if (withPanel && products.length) {
      const toPanel = panelLimit > 0 ? products.slice(0, panelLimit) : products;
      console.log(`  [面板补全] ${toPanel.length}/${products.length} 个商品 (每个约15秒)...`);
      for (let i = 0; i < toPanel.length; i++) {
        let pd;
        try { pd = await cdpReadOnePanel(send, toPanel[i].asin, site === 'uk' ? 'co.uk' : site === 'us' ? 'com' : site); }
        catch (e) { pd = { error: 'CDP异常: ' + e.message }; }
        toPanel[i] = { ...toPanel[i], panel: pd };
        if (i % 2 === 0) console.log(`    [${i + 1}/${toPanel.length}] ${toPanel[i].asin} ${pd.error ? '✗' + pd.error : '✓ 品牌:' + (pd.brand || '-') + ' ' + (pd.tmText || '-') + ' ' + (pd.fulfill || '-') + ' 销量:' + (pd.sales30d || '-') + ' 榜单:' + (pd.bsr || []).length + '条'}`);
      }
    }
    results.push({ name: brand.name, spUrl: brand.spUrl, listUrl, products });
  }
  return { shopCount: shopCards.length, brands: results, totalProducts: results.reduce((s, x) => s + x.products.length, 0) };
}

// ===== 批量品牌采集: 商品库品牌 → 品牌跳转链接 → 品牌全部商品 → 采集筛选 → 详情补全 =====
// 与「跟卖店铺采集」的区别: 跳转的是"商品品牌"的链接 (品牌店/品牌页), 不是跟卖卖家的店铺
// 与「类目搜索采集」的关系: 完全共用 ①采集筛选(applyCollectFilter) ②详情提取器(DETAIL_READ_EXPR) ③入库字段
//
// leads (由路由从商品库品牌去重得到, 零成本不额外请求网页): [{ asin, brand }]
// 每个品牌线索:
//   ① 打开线索商品的详情页 → 读品牌名 + 品牌跳转链接 (bylineInfo / field-keywords / 品牌店 /stores/)
//   ② 品牌页抓列表 (+翻页) — 列表页就能判的条件先预筛 (关键词/价格/页面标识), 减少详情页访问
//   ③ 通过预筛的候选逐个读完整详情页 (与「详情修复」同一提取器)
//   ④ 品牌名校验: 详情页品牌 ≠ 目标品牌 → 丢弃 (品牌页/搜索页常混入他牌商品)
//   ⑤ 统一采集筛选: applyCollectFilter (与类目搜索采集同一条判定, 不通过则不入库)
//   ⑥ 每品牌保留 maxPerBrand 个 (采集筛选把候选筛掉的会继续往后补, 保证"够数")
// 可选插件面板补全: 商标/月销/尺寸/重量 — 筛选条件需要这些字段时自动开 (每商品约 +8s)
async function cdpBrandBatch(opts = {}) {
  const leads = (Array.isArray(opts.leads) ? opts.leads : [])
    .map((x) => ({ asin: String((x && x.asin) || '').trim().toUpperCase(), brand: (x && x.brand) ? String(x.brand).trim() : null }))
    .filter((x) => /^[A-Z0-9]{10}$/.test(x.asin));
  if (!leads.length) throw new Error('没有可用的品牌线索 (商品库里这些商品缺少品牌)');
  const site = opts.site || 'au';
  const maxPerBrand = Math.min(50, Math.max(1, opts.maxPerBrand || 5));
  const maxPages = Math.min(10, Math.max(1, opts.maxPages || 2));
  const filter = opts.filter && typeof opts.filter === 'object' ? opts.filter : {};
  const host = 'www.amazon.' + siteToHostSuffix(site);
  // 插件面板补全: 显式开启 或 筛选条件需要面板独有字段 (商标数量/月销/品牌状态/卖家国家)
  // ★ 2026-10-02: 加上 filter.china —— 卖家国家只存在于面板的国旗图标里, 不读面板就永远判"未知",
  //   勾了「中国卖家」时一条都保留不下来(实测: 品牌批量采集 已保留 0/10)。
  const needPanel = opts.panel === true || filter.tmMin != null || filter.tmMax != null
    || filter.salesMin != null || filter.salesMax != null || !!filter.brandStatus
    || filter.china === true || filter.china === false;

  const tabs = await cdpGetTabs();
  const page = tabs.find((t) => t.type === 'page' && /amazon\./.test(t.url || '')) || tabs.find((t) => t.type === 'page');
  if (!page) throw new Error('Edge 无可用页面标签, 请确认 Edge 以 --remote-debugging-port=9222 启动');
  const { send } = await cdpConnect(page.webSocketDebuggerUrl);
  await send('Runtime.enable');

  const known = new Set(products.map((x) => String(x.asin || '').toUpperCase()));   // 库内已有 → 不重复采
  const brands = [];
  for (let li = 0; li < leads.length; li++) {
    if (collectStopRequested()) break;
    const lead = leads[li];
    const label = lead.brand || lead.asin;
    const rec = {
      asin: lead.asin, brand: lead.brand, brandName: null, brandUrl: null, brandSource: null, listUrl: null,
      pages: 0, listCount: 0, candidates: 0, preSkipped: 0, read: 0, kept: 0, skipped: 0, mismatch: 0, panel: 0, error: null, products: [],
    };
    try {
      // ---- ① 线索商品详情页 → 品牌名 + 品牌跳转链接 ----
      bumpCollectProgress({ step: `品牌 ${li + 1}/${leads.length}: ${label} — 读品牌跳转链接`, brandsDone: li, brandsTotal: leads.length });
      await send('Page.navigate', { url: `https://${host}/dp/${lead.asin}` });
      await new Promise((r) => setTimeout(r, 7000));
      const guard = await cdpPageGuard(send);
      if (guard === 'captcha') { rec.error = '触发验证码/风控, 已中止 (请人工过验证后重试)'; brands.push(rec); break; }
      const rb = await send('Runtime.evaluate', { expression: BRAND_LINK_JS, returnByValue: true });
      let bl = {};
      try { bl = JSON.parse(rb.result.value || '{}'); } catch (e) { bl = {}; }
      if (bl.brandName) rec.brandName = bl.brandName;
      const target = rec.brandName || rec.brand || '';
      const abs = (h) => (!h ? null : (h.startsWith('http') ? h : 'https://' + host + h));
      // 品牌跳转链接优先级: 详情页品牌署名链接 (bylineInfo) → 页面品牌链接 (field-keywords) → 品牌店 → 品牌名搜索兜底
      for (const cand of [bl.bylineHref, bl.fieldLink, bl.storeLink]) {
        if (!cand) continue;
        if (/field-keywords|\/stores\/|\/shops\/|[?&]seller=/.test(cand)) {
          rec.brandUrl = abs(cand);
          rec.brandSource = /\/stores\/|\/shops\//.test(cand) ? 'store' : 'brandlink';
          break;
        }
      }
      if (!rec.brandUrl && target && looksLikeSellerHandle(target)) {
        throw new Error('详情页没读到品牌跳转链接, 且线索品牌「' + target + '」像亚马逊随机店铺名而非品牌名 → 已跳过 (否则会去搜杂货商品)');
      }
      if (!rec.brandUrl && target) { rec.brandUrl = `https://${host}/s?k=${encodeURIComponent(target)}`; rec.brandSource = 'search'; }
      if (!rec.brandUrl) throw new Error('未找到品牌跳转链接, 且品牌名为空无法搜索');
      rec.listUrl = rec.brandUrl;

      // ---- ② 品牌页商品列表 (+翻页) ----
      const cands = [];
      const seenA = new Set();
      const candCap = Math.min(120, maxPerBrand * 6);
      for (let pg = 1; pg <= maxPages; pg++) {
        if (collectStopRequested()) break;
        const pgUrl = pg === 1 ? rec.brandUrl
          : (/[?&]page=\d+/.test(rec.brandUrl) ? rec.brandUrl.replace(/page=\d+/, 'page=' + pg) : rec.brandUrl + (rec.brandUrl.includes('?') ? '&' : '?') + 'page=' + pg);
        await send('Page.navigate', { url: pgUrl });
        await new Promise((r) => setTimeout(r, 8000));
        const guard2 = await cdpPageGuard(send);
        if (guard2 === 'captcha') { rec.error = '品牌页触发验证码/风控'; break; }
        /* ★ 2026-10-02 删掉原来的「滚动 4×4000px」—— 实测证明它对读商品【零增量】:
         *   对照实验(amazon.de/s?k=NaNMiBHd): 不滚动 9s 读到 16 条, 21s 仍 16 条;
         *   滚 4 次后还是 16 条, 只有文档高变了(10255→10384, 那是懒加载图片不是新商品卡)。
         *   代价却是每页 ~4.8 秒。而且 links-collector.waitCardsReady 里早就记录过同一结论
         *   ("列表页滚动对插件数据的增量是 0... 滚一遍反而引起重渲染"), 那套已经不滚了,
         *   这里是漏改的遗留。
         *   改成【轮询到卡片数稳定】: 卡片数连续 3 轮不变就认为渲染完, 既不用死等, 也不会
         *   在亚马逊重渲染(瞬时 0 卡)时把整页读成空。 */
        {
          let prev = -1, stable = 0;
          const countCards = async () => {
            const c = await send('Runtime.evaluate', {
              expression: `document.querySelectorAll('div[data-asin][data-component-type="s-search-result"]').length`,
              returnByValue: true,
            });
            return Number(c.result.value) || 0;
          };
          for (let k = 0; k < 10; k++) {
            const n = await countCards();
            if (n > 0 && n === prev) { stable++; if (stable >= 3) break; }
            else { stable = 0; }
            prev = n;
            await new Promise((r) => setTimeout(r, 900));
          }
        }
        const rl = await send('Runtime.evaluate', { expression: BRAND_LIST_JS, returnByValue: true });
        let items = [];
        try { items = JSON.parse(rl.result.value || '[]'); } catch (e) { items = []; }
        rec.pages = pg;
        rec.listCount += items.length;
        let fresh = 0;
        for (const x of items) {
          if (seenA.has(x.asin) || known.has(x.asin)) continue;
          seenA.add(x.asin); cands.push(x); fresh++;
        }
        bumpCollectProgress({ step: `品牌 ${li + 1}/${leads.length}: ${label} — 第 ${pg} 页列表, 候选 ${cands.length}` });
        if (!items.length) break;
        if (fresh === 0) break;                       // 该页全是重复/库内已有 → 没必要继续翻
        if (cands.length >= candCap) break;
      }
      rec.candidates = cands.length;
      if (!cands.length) {
        if (!rec.error) rec.error = '品牌页未抓到新商品 (可能无商品 / 全部已在库内 / 页面结构变化)';
        brands.push(rec); continue;
      }

      // ---- ③ 列表页可判条件先预筛 (关键词/价格区间/页面标识/1688) ----
      // 关键: 列表页没读到价格时, 价格条件视为"未知"放行 (统一采集筛选的语义: 未知不淘汰) —
      //       品牌店 (/stores/) 卡片结构与搜索页不同, 价格可能整页读不到, 否则会整批被误筛成 0
      const pre = {};
      if (filter.q) pre.q = filter.q;
      if (filter.badges && filter.badges.length) pre.badges = filter.badges;
      if (filter.is1688 != null) pre.is1688 = filter.is1688;
      const pool = cands.filter((x) => {
        const pn = parseMoneyText(x.price, x.site);   // ★ 站点感知
        const hasPrice = pn !== '' && !isNaN(parseFloat(pn));
        const f2 = Object.assign({}, pre);
        if (!hasPrice) { delete f2.priceMin; delete f2.priceMax; }
        else { if (filter.priceMin != null) f2.priceMin = filter.priceMin; if (filter.priceMax != null) f2.priceMax = filter.priceMax; }
        return applyCollectFilter({ asin: x.asin, title: x.title, badge: x.badge, price: hasPrice ? x.price : null }, f2);
      });
      rec.preSkipped = cands.length - pool.length;
      // 详情页访问上限: 目标数的 2 倍 (筛选会筛掉一部分, 留出补位空间, 但不无限读详情)
      const cap = Math.min(pool.length, maxPerBrand * 2);

      // ---- ④⑤⑥ 详情补全 → 品牌名校验 → 采集筛选 → 保留 maxPerBrand 个 ----
      const kept = [];
      for (let i = 0; i < cap && kept.length < maxPerBrand; i++) {
        if (collectStopRequested()) break;
        const c = pool[i];
        bumpCollectProgress({ step: `品牌 ${li + 1}/${leads.length}: ${label} — 详情补全 ${c.asin} (已读 ${rec.read + 1}/${cap}, 已保留 ${kept.length}/${maxPerBrand})` });
        const it = { asin: c.asin, title: c.title, site };
        await cdpReadDetail(send, host, it);
        rec.read++;
        // 品牌名校验 (详情页品牌为权威值): 与目标品牌不一致 → 丢弃, 防止品牌页/搜索页混入他牌
        // ★ 2026-09 「剔除他牌」改为采集过滤开关: 默认剔除(保持原行为); filter.dropOtherBrand==='0' 时保留他牌商品
        const keepOtherBrand = filter.dropOtherBrand === '0' || filter.dropOtherBrand === 0;
        if (!keepOtherBrand && target && it.brand && !sameBrand(it.brand, target)) {
          rec.mismatch++;
          // ★ 剔除他牌明细(供采集报告逐条给出亚马逊直达链接); 只留前 200 条, 计数仍然完整
          if (!rec.mismatchItems) rec.mismatchItems = [];
          if (rec.mismatchItems.length < 200) rec.mismatchItems.push({
            asin: it.asin, title: it.title ? String(it.title).slice(0, 90) : null,
            brand: it.brand || null, target,
            url: 'https://www.amazon.' + siteToHostSuffix(site) + '/dp/' + it.asin,
          });
          continue;
        }
        // 插件面板补全 (就地读, 不重新导航)
        if (needPanel) {
          const pa = await waitPanelInline(send, site, 6000, 15000);
          if (pa && pa.txt) {
            try { mergePanelInto(it, parsePanelText(pa.txt, it.asin, it.title || '', pa.flag || null)); rec.panel++; } catch (e) { /* 面板解析失败忽略 */ }
          }
        }
        // 统一采集筛选 (与类目搜索采集同一判定: 不通过则不入库)
        if (!applyCollectFilter(it, filter)) { rec.skipped++; continue; }
        it.brand = it.brand || target || 'Unknown';
        it.brandStore = target || null;
        it.brandUrl = rec.brandUrl;
        it.brandSource = rec.brandSource;
        it.fromAsin = lead.asin;
        kept.push(it);
      }
      rec.kept = kept.length;
      rec.products = kept;
    } catch (e) {
      rec.error = (e && e.message) || String(e);
    }
    brands.push(rec);
  }
  return {
    site, leadCount: leads.length, brands,
    kept: brands.reduce((s, b) => s + b.kept, 0),
    candidates: brands.reduce((s, b) => s + b.candidates, 0),
    skipped: brands.reduce((s, b) => s + b.skipped, 0),
    mismatch: brands.reduce((s, b) => s + b.mismatch, 0),
    panel: brands.reduce((s, b) => s + b.panel, 0),
    panelEnabled: needPanel,
    stopped: collectStopRequested(),
  };
}

// 品牌跳转链接提取 (详情页): 品牌名 + 3 个候选链接 (品牌署名 / field-keywords 品牌搜索 / 品牌店)
const BRAND_LINK_JS = `(() => {
  const clean = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
  let brandName = null, bylineHref = null;
  const byEl = document.querySelector('#bylineInfo, #bylineInfo_feature_div');
  if (byEl) {
    const a = byEl.querySelector('a');
    if (a) {
      bylineHref = a.getAttribute('href') || null;
      let t = clean(a.textContent).replace(/^(?:Visit the|Brand:|品牌[:：]?)\\s*/i, '');
      t = t.replace(/\\s+(?:Store|旗舰店|官方旗舰店)$/i, '').trim();
      if (t && t.length > 1 && t.length < 60 && !/^brand$/i.test(t)) brandName = t;
    } else {
      const t = clean(byEl.textContent).replace(/^(?:Brand:|品牌[:：]?)\\s*/i, '');
      if (t && t.length > 1 && t.length < 60) brandName = t;
    }
  }
  if (!brandName) {
    const el = document.querySelector('#productTitle');
    if (el) brandName = null;   // 标题不是品牌, 宁缺勿猜
  }
  let fieldLink = null, storeLink = null;
  document.querySelectorAll('a[href]').forEach((a) => {
    const h = a.getAttribute('href') || '';
    if (!fieldLink && h.includes('field-keywords')) fieldLink = h;
    if (!storeLink && /\\/stores\\//.test(h)) storeLink = h;
  });
  return JSON.stringify({ brandName: brandName, bylineHref: bylineHref, fieldLink: fieldLink, storeLink: storeLink });
})()`;

// 品牌页/搜索页商品列表提取: ① 标准搜索结果卡片 (div[data-asin]) ② 品牌店 (/stores/) 按 /dp/ 链接兜底
const BRAND_LIST_JS = `(() => {
  const clean = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
  const out = [];
  const seen = {};
  const push = (asin, title, price, link) => {
    if (!asin || !/^[A-Z0-9]{10}$/.test(asin) || seen[asin]) return;
    seen[asin] = 1;
    out.push({ asin: asin, title: clean(title).slice(0, 150), price: clean(price), link: link || '' });
  };
  const detectBadge = (tb) => {
    if (/Amazon's Choice/i.test(tb)) return 'choice';
    if (/#1 Best Seller/i.test(tb)) return 'bestseller1';
    if (/Best Seller/i.test(tb)) return 'bestseller';
    if (/New Release/i.test(tb)) return 'newrelease';
    if (/Deal of the Day/i.test(tb)) return 'dealday';
    if (/Limited time deal/i.test(tb)) return 'deal';
    if (/Overall Pick/i.test(tb)) return 'overallpick';
    if (/Editor'?s Pick/i.test(tb)) return 'editorspick';
    if (/Top Rated/i.test(tb)) return 'toprated';
    return null;
  };
  // ① 标准搜索/品牌搜索结果卡片
  document.querySelectorAll('div[data-asin]').forEach((el) => {
    const asin = el.getAttribute('data-asin');
    if (!asin || !/^[A-Z0-9]{10}$/.test(asin)) return;
    const lk = el.querySelector('a[href*="/dp/"]');
    if (!lk) return;
    const t = el.querySelector('h2 span, h2');
    const pr = el.querySelector('.a-price .a-offscreen');
    let priceTxt = pr ? pr.textContent : '';
    if (!clean(priceTxt)) { const pw = el.querySelector('.a-price-whole'); if (pw) priceTxt = pw.textContent; }
    const badge = detectBadge((el.textContent || '').slice(0, 800));
    const one = out.length;
    push(asin, t ? t.textContent : '', priceTxt, lk.href);
    if (out.length > one) out[out.length - 1].badge = badge;
  });
  // ② 品牌店 (/stores/) 兜底: 卡片结构与搜索页不同 → 按 /dp/ 链接回溯定位卡片文本
  if (!out.length) {
    document.querySelectorAll('a[href*="/dp/"]').forEach((a) => {
      const m = (a.getAttribute('href') || '').match(/\\/dp\\/([A-Z0-9]{10})/);
      if (!m) return;
      let box = a;
      for (let i = 0; i < 4 && box && box.parentElement; i++) box = box.parentElement;
      const boxTxt = box ? box.textContent : '';
      let priceTxt = '';
      if (box) {
        const pe = box.querySelector('.a-price .a-offscreen, .a-price-whole, [data-a-color="price"], .a-color-price');
        if (pe) priceTxt = pe.textContent;
      }
      if (!clean(priceTxt)) priceTxt = (boxTxt.match(/(?:A\\$|AU\\$|US\\$|C\\$|[$£€¥]|AUD|USD|GBP|EUR)\\s*[\\d.,]+/) || [''])[0];
      push(m[1], clean(a.textContent) || boxTxt.slice(0, 150), priceTxt, a.href);
    });
  }
  return JSON.stringify(out);
})()`;

// 真实采集主流程
async function realCollect(opts = {}) {
  const site = opts.site || 'uk';
  const category = (opts.category || 'Automotive').trim();
  const limit = Math.min(30, Math.max(1, opts.count || 10));
  const domain = SITE_DOMAIN[site] || 'co.uk';
  const slug = category.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const url = `https://www.amazon.${domain}/gp/bestsellers/${slug ? slug + '/' : ''}?ref_=zg_bs_nav_0`;
  const used = new Set(products.map((x) => x.asin));
  const added = [];

  // 1. 抓页面
  const html = await fetchGet(url);
  if (!html || html.length < 2000) throw new Error('页面抓取失败(长度 ' + (html || '').length + '), 可能被风控, 请稍后重试');
  const parsed = parseBestsellersHtml(html);
  if (!parsed.length) throw new Error('页面解析失败, 未能提取商品 (可能触发验证码)');

  // 2. 逐个补全
  for (const it of parsed.slice(0, limit)) {
    if (collectStopRequested()) break;
    if (used.has(it.asin)) continue;
    used.add(it.asin);
    const brand = (it.title.split(/[ ,|–—/•]/)[0] || '').replace(/[^A-Za-z0-9&'.\-]/g, '').trim() || 'Unknown';
    const hist = HISTORY.find((h) => h.asin === it.asin) || {};
    let sales = null, trademarkCount = hist.trademarkCount != null ? hist.trademarkCount : 0, shipByAmazon = hist.fba === 'FBA' ? true : hist.fba === 'FBM' ? false : null;

    // 尝试智赢 API (限流 1.2s), 失败静默降级
    try {
      await new Promise((r) => setTimeout(r, 1200));
      const d = await fetchPostJson(`https://amazon.zying.net/api/zbig/MoreAboutAsin/${site}`, [{ Asin: it.asin, Brand: brand, Categories: [category], FirstCategory: category, BSR: String(it.rank) }], { 'ext_version': '5.1.6', 'token': ZYING_TOKEN, 'timestamp': String(Math.floor(Date.now() / 1000)), 'appclient': '3', 'version': 'v1.1', 'signature': '' });
      const dd = d && d.data ? d.data : d;
      const rec = dd[it.asin] || {};
      sales = rec.Sales != null ? rec.Sales : sales;
      trademarkCount = rec.BrandSourceDetails ? rec.BrandSourceDetails.length : trademarkCount;
    } catch {}

    try {
      await new Promise((r) => setTimeout(r, 1200));
      const d = await fetchPostJson(`https://amazon.zying.net/api/zbig/MoreAboutAsin/v3/${site}`, [{ Asin: it.asin, Brand: brand, Categories: [category], FirstCategory: category, BSR: String(it.rank) }], { 'ext_version': '5.1.6', 'token': ZYING_TOKEN, 'timestamp': String(Math.floor(Date.now() / 1000)), 'appclient': '3', 'version': 'v1.1', 'signature': '' });
      const dd = d && d.data ? d.data : d;
      const rec = dd[it.asin] || {};
      if (rec.ShipByAmazon != null) shipByAmazon = rec.ShipByAmazon;
    } catch {}

    // 榜单页只真实读到 asin/rank/title (+ 可选的智赢 API sales/商标/FBA) → 其余一律未知 (绝不随机伪造)
    const price = null;   // 该页面无价格来源 → 未知, 不随机编价
    const tm = false, patent = false;
    const item = {
      id: it.asin, asin: it.asin, rank: '#' + it.rank, title: it.title, brand,
      brandStatus: trademarkCount > 60 ? 'registered' : trademarkCount > 0 ? 'unchecked' : 'notfound',
      bgMark: trademarkCount > 80, tmMark: tm, patentRisk: patent, trademarkCount,
      followCount: null, chinaSeller: null,
      fulfill: shipByAmazon === true ? 'FBA' : shipByAmazon === false ? 'FBM' : null,
      amazonSell: null, price, currency: siteCurrency(site),
      monthlySales: (sales == null) ? null : (typeof sales === 'number' ? sales : (parseInt(String(sales).replace(/[^\d]/g, ''), 10) || null)),
      reviews: null,
      rating: null, stock: null,
      listedAt: null, size: null, weight: null, variations: null,
      referralFee: null, netProfit: null,
      site, category, collectedAt: now(), source: 'real-collect', saved: false, real: true,
    };
    item.aiScore = Math.round(Math.min(96, Math.max(30, 80 - item.trademarkCount * 0.5 - (item.patentRisk ? 25 : 0))));
    item.aiRiskLevel = item.patentRisk ? 'high' : item.trademarkCount > 50 || item.tmMark ? 'medium' : 'low';
    item.aiSuggestPrice = null;   // 价格未知 → 派生字段一律 null
    products.unshift(applyRankFields(item));
    added.push(item);
  }
  save('products.json', products);
  pushNotify('真实采集完成', `从 amazon.${domain} 榜单抓取 ${added.length} 个真实商品`, `类目: ${category} | 站点: ${site} | 当前共 ${products.length} 条`);
  return { added: added.length, total: products.length, site, category, url, items: added.map((x) => ({ asin: x.asin, rank: x.rank, title: x.title, brand: x.brand })) };
}

// 认领 → 草稿箱
function claim(asin, opts = {}) {
  const p = products.find((x) => x.asin === asin);
  if (!p) return { error: '商品不存在' };
  if (claims.some((c) => c.asin === asin && c.status === 'draft')) return { error: '已在草稿箱' };
  const c = {
    id: 'C-' + String(claims.length + 1).padStart(3, '0'),
    asin, title: p.title, brand: p.brand,
    price: opts.price || p.aiSuggestPrice || p.price,
    sku: opts.sku || `${p.brand}-${p.asin.slice(0, 4)}`,
    site: p.site, status: 'draft',
    claimedAt: now(),
  };
  claims.push(c);
  save('claims.json', claims);
  flywheel.selection.claimed++;
  save('flywheel.json', flywheel);
  return c;
}

// 批量刊登 (模拟发布)
function publish(ids) {
  const done = [];
  claims.forEach((c) => {
    if (ids.includes(c.id) && c.status === 'draft') {
      c.status = 'published';
      c.publishedAt = now();
      done.push(c.id);
    }
  });
  save('claims.json', claims);
  return { published: done.length, ids: done };
}

// 智能调价: 目标价 = 最低价 - 差额, ≥ 保底价
function runReprice() {
  const runs = [];
  const published = claims.filter((c) => c.status === 'published').slice(0, 8);
  const targets = published.length ? published : claims.slice(0, 8);
  targets.forEach((c) => {
    const p = products.find((x) => x.asin === c.asin);
    if (!p) return;
    const diff = 0.5;                                   // 差额 (默认0.5)
    const floor = Math.round(p.netProfit * 1.15 * 100) / 100 + 3; // 保底价 = 成本*1.15
    const lowest = Math.round((p.price * (0.9 + Math.random() * 0.05)) * 100) / 100;
    const target = Math.max(Math.round((lowest - diff) * 100) / 100, floor);
    const win = Math.random() < 0.78;
    if (win) flywheel.pricing.buyBoxWin++;
    flywheel.pricing.total++;
    const rec = {
      asin: c.asin, lowest, diff, floor, target, win, at: now(),
    };
    repriceHistory.unshift(rec);
    runs.push(rec);
  });
  flywheel.pricing.winRate = Math.round(flywheel.pricing.buyBoxWin / Math.max(1, flywheel.pricing.total) * 100) / 100;
  // 策略自优化: 每7天聚合 (demo: 每次生成建议)
  const s = { date: now().slice(0, 10), avgWinRate: flywheel.pricing.winRate, suggestion: flywheel.pricing.winRate < 0.7 ? '购物车获取率偏低, 建议差额提升至 1.0' : '差额 0.5 表现良好, 维持现状' };
  flywheel.pricing.suggestions.push(s);
  save('reprice.json', repriceHistory);
  save('flywheel.json', flywheel);
  return { runs, stats: { total: flywheel.pricing.total, winRate: flywheel.pricing.winRate, suggestion: s } };
}

// AI Agent 选品评估 (模板化生成)
function agentAssess(asin) {
  const p = products.find((x) => x.asin === asin);
  if (!p) return { error: '商品不存在' };
  const comp = complianceCheck(p);
  // ★ 2026-09-24 P0-3d: aiScore / aiSuggestPrice 现在可能是 null (价格或商标数未采到)。
  //   旧写法两处后果: ① priceRange 会算出 "-0.8 ~ 0.3" 这种负价;
  //   ② verdict 里 `null >= 55` 为 false → 静默落成「谨慎跟卖」, 把"没数据"说成"评估过但不推荐"。
  const hasScore = p.aiScore != null && !isNaN(p.aiScore);
  const hasPrice = p.aiSuggestPrice != null && !isNaN(p.aiSuggestPrice);
  const priceLow = hasPrice ? Math.round((p.aiSuggestPrice - 0.8) * 100) / 100 : null;
  const priceHigh = hasPrice ? Math.round((p.aiSuggestPrice + 0.3) * 100) / 100 : null;
  const na = (v) => (v == null ? '未采到' : v);
  const verdict = comp.level === 'high' ? '不建议跟卖'
    : !hasScore ? '数据不足, 需先补采 (无评分/价格)'
    : p.aiScore >= 75 ? '强烈建议跟卖' : p.aiScore >= 55 ? '建议跟卖' : '谨慎跟卖';
  return {
    asin: p.asin, brand: p.brand, title: p.title,
    feasibility: hasScore ? p.aiScore : null, risk: comp.level, verdict,
    priceRange: hasPrice ? `${priceLow} ~ ${priceHigh} ${p.currency}` : null,
    reason: `合规检测: ${comp.level === 'high' ? '高风险, 命中品牌/专利库' : '低风险, 未命中敏感项'}; 商标记录 ${na(p.trademarkCount)} 条; 月销 ${na(p.monthlySales)}; 跟卖数 ${na(p.followCount)}; 中国卖家: ${p.chinaSeller === true ? '是' : p.chinaSeller === false ? '否' : '未知'}`,
    suggestions: [
      p.chinaSeller === true ? '注意: 原卖家为中国卖家, 价格战风险高, 建议差额加大' : '原卖家非中国卖家, 价格相对稳定',
      p.monthlySales != null && p.monthlySales > 3000 ? '月销高, 抢购物车收益大, 优先调价' : '月销一般, 建议先观察再跟',
      hasPrice ? `建议定价 ${priceLow} ~ ${priceHigh} ${p.currency}, 保底价不低于成本+15%` : '价格未采到, 暂无法给出定价建议 (先补采)',
    ],
    sources: comp.reasons,
  };
}

// 通知 (飞书/企微模拟)
/* ===== 多链接采集入库（《多链接采集-完整代码.js》第 2.2 部分）=====
 * 同时供「多链接采集」与「品牌链接采集」使用。已存在的 ASIN 不覆盖（只统计跳过）。
 * 相比原版的一处优化: 币种按【每条商品自己的站点】取（原版整批用第一个站点, 多站混采会标错币种）。
 *
 * ★ 返回 { added, addedAsins, skipped } 而不是裸数字:
 *   任务化断点续跑需要「本次真正新入库的 ASIN 清单」来记账(幂等), 光有数量对不上是哪几个。
 *   调用方若只想要数量, 用 Number(r) || r.added 兼容 (见 links-collector 的调用点)。
 */
/* ===== 路线 B: 扩展推送数据的字段映射 =========================================
 * 输入 = 浏览器扩展(智赢跟卖采集助手)从页面里组装的条目:
 *   { asin, title, price, rating, reviews, mainImage, url, site, aplus, amazonSell,
 *     catPath, cat1, cat2, cat3, sellerLink, sourceBrand, badge, is1688, is1688Url,
 *     panel: <panel-export.js 的 fields 对象>  }
 * 输出 = ingestLinksProducts() 期望的扁平 p 对象。
 * 原则同 P0-3: 读不到就是 null, 不猜、不伪造。
 */
function pushToLinksItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const asin = String(raw.asin || '').toUpperCase().trim();
  if (!asin) return null;
  const f = (raw.panel && typeof raw.panel === 'object') ? raw.panel
    : ((raw.fields && typeof raw.fields === 'object') ? raw.fields : {});
  const num = (v) => { const m = String(v == null ? '' : v).replace(/[^\d.]/g, ''); const n = parseFloat(m); return isNaN(n) ? null : n; };

  // 排名: 导出给 ranks[] (带 kind: 'shop'|'category'|null) + rankShop/rankCategory/rankMax
  let bsrShop = null, bsrShopCat = null, bsrCat = null, bsrCatName = null;
  const bsr = [];
  const ranks = Array.isArray(f.ranks) ? f.ranks : [];
  for (const r of ranks) {
    const n = num(r && r.rank);
    if (!n) continue;
    const cat = (r && r.category) || null;
    if (r && r.kind === 'shop' && bsrShop == null) { bsrShop = n; bsrShopCat = cat; }
    else if (r && r.kind === 'category' && bsrCat == null) { bsrCat = n; bsrCatName = cat; }
    bsr.push({ rank: n, category: cat });
  }
  if (bsrShop == null && f.rankShop) { bsrShop = num(f.rankShop.rank); bsrShopCat = f.rankShop.category || null; }
  if (bsrCat == null && f.rankCategory) { bsrCat = num(f.rankCategory.rank); bsrCatName = f.rankCategory.category || null; }
  // 没有任何 kind 标记时, 兜底: 最大的是店铺选品, 最小的是榜单选品 (与既有口径一致)
  if (bsr.length && bsrShop == null && bsrCat == null) {
    const sorted = bsr.slice().sort((a, b) => b.rank - a.rank);
    bsrShop = sorted[0].rank; bsrShopCat = sorted[0].category;
    if (sorted.length > 1) { bsrCat = sorted[sorted.length - 1].rank; bsrCatName = sorted[sorted.length - 1].category; }
  }

  // 上架: 导出给 {date:'YYYY-MM-DD', daysOld} | null; 也兼容字符串
  let listedAt = null;
  const L = f.listedAt != null ? f.listedAt : raw.listedAt;
  if (L && typeof L === 'object') listedAt = L.date || null;
  else if (typeof L === 'string' && L.trim()) listedAt = L.trim().slice(0, 10);

  // 商标: 导出给 {count, status}
  const tm = (f.trademark && typeof f.trademark === 'object') ? f.trademark : null;
  const tmStatus = tm ? { count: num(tm.count) || 0, status: String(tm.status || '') }
    : (raw.tmStatus || null);

  // 尺寸/重量: 导出给 {raw,dims,unit}; 旧格式是字符串
  const rawOf = (v) => (v && typeof v === 'object') ? (v.raw || null) : (typeof v === 'string' ? v : null);

  return {
    asin,
    site: raw.site || null,
    title: raw.title || null,
    brand: f.brand || raw.brand || null,
    brandLink: f.brandLink || null,
    tmStatus,
    seller: f.seller || raw.seller || null,
    sellerLink: raw.sellerLink || null,
    sellerCount: (f.sellerCount != null ? f.sellerCount : raw.sellerCount),
    fulfill: f.fulfill || raw.fulfill || null,
    fbaFee: f.fbaFee || null,
    listedAt,
    sales30d: (f.sales30d != null ? f.sales30d : raw.sales30d),
    variants: (f.variants != null ? f.variants : raw.variants),
    productType: f.productType || null,
    size: rawOf(f.size), weight: rawOf(f.weight),
    packSize: rawOf(f.packSize), packWeight: rawOf(f.packWeight),
    color: f.colourName || f.colorName || raw.color || null,
    variantSize: f.sizeName || null,
    price: (raw.price != null ? raw.price : null),
    rating: (raw.rating != null ? raw.rating : null),
    reviews: (raw.reviews != null ? raw.reviews : null),
    image: raw.mainImage || raw.image || null,
    productUrl: raw.url || null,
    bsr, bsrShop, bsrShopCat, bsrCat, bsrCatName,
    aplus: (raw.aplus != null ? raw.aplus : null),
    amazonSell: (raw.amazonSell != null ? raw.amazonSell : null),
    catPath: raw.catPath || null,
    cat1: raw.cat1 || null, cat2: raw.cat2 || null, cat3: raw.cat3 || null,
    sourceBrand: raw.sourceBrand || null,
    badge: raw.badge || null,
    is1688: raw.is1688, is1688Url: raw.is1688Url,
  };
}

function ingestLinksProducts(items, site, source) {
  if (!Array.isArray(items) || !items.length) return { added: 0, addedAsins: [], skipped: 0 };
  const used = new Set(products.map((x) => x.asin));
  let added = 0, skipped = 0;
  const addedAsins = [];
  for (const p of items) {
    if (!p || !p.asin || used.has(p.asin)) { if (p && p.asin) skipped++; continue; }
    used.add(p.asin);
    addedAsins.push(p.asin);
    const itemSite = p.site || site;
    const currency = siteLinks.siteCurrency(itemSite);
    const num = (v) => { const m = String(v == null ? '' : v).match(/[\d.]+/); return m ? Number(m[0]) : null; };
    const digits = (v) => { const m = String(v == null ? '' : v).replace(/[^\d]/g, ''); return m ? Number(m) : null; };
    const price = parseMoneyText(p.price, itemSite);   // ★ 站点感知: de 的 "29,99 €" → 29.99 (旧写法会变 2999)
    // 大排名 = 所有可用排名里的【最大值】（口径：所有商品只采最大排名）。
    // 面板给两个排名: 店铺选品(大/宽类目, 如 #349058 Automotive) 与 榜单选品(小/细分类目, 如 #1129 Car Armrests)。
    // 老的跟卖链路(cdp-follow-shop)也是取 max(bsr 各项)，这里统一成同一口径。
    const rankNums = [];
    const rankEntries = [];
    const rShop = digits(p.bsrShop);
    const rCat = digits(p.bsrCat);
    if (rShop) { rankNums.push(rShop); rankEntries.push({ rank: rShop, category: p.bsrShopCat || '' }); }
    if (rCat) { rankNums.push(rCat); rankEntries.push({ rank: rCat, category: p.bsrCatName || '' }); }
    if (Array.isArray(p.bsr)) {
      for (const b of p.bsr) {
        const n = digits(b && b.rank);
        if (!n) continue;
        rankNums.push(n);
        rankEntries.push({ rank: n, category: (b && (b.category || b.name)) || '' });
      }
    }
    const maxRank = rankNums.length ? Math.max.apply(null, rankNums) : null;
    // 去重：同一排名可能同时来自 店铺选品/榜单选品 与 bsr 列表（面板字段有重叠）
    const seenRank = new Set();
    const bsrList = rankEntries.filter((e) => (seenRank.has(e.rank) ? false : (seenRank.add(e.rank), true)));
    const sellerCount = digits(p.sellerCount);
    const item = {
      id: p.asin, asin: p.asin,
      rank: maxRank ? '#' + maxRank : null,
      title: p.title || '(无标题)',
      brand: p.brand || null,
      brandLink: p.brandLink || null,
      brandLinkIndex: p.brandLinkIndex || null,
      tmStatus: p.tmStatus || null,
      seller: p.seller || null,
      sellerLink: p.sellerLink || null,
      sellerCount,
      // ★ 2026-09-30 修复: 原来这里【完全不写 tmText】, 且「注册商标」被判成 unchecked。
      //   实测后果: 全库 3163 条 tmText 全空 → tmMark 恒 false →「排除 TM」筛选失效;
      //             brandStatus 几乎全 unchecked →「排除已备案/仅未查到」也失效。
      //   现改用共享的 brandStatusFromTm (与 mergePanelInto 同一口径), 并补上 tmText 原文。
      brandStatus: (function () {
        const st = p.tmStatus && p.tmStatus.status ? String(p.tmStatus.status) : '';
        const c = (typeof p.tmStatus === 'number') ? p.tmStatus : (p.tmStatus ? digits(p.tmStatus.count) : null);
        return brandStatusFromTm(c, st) || 'unchecked';
      })(),
      bgMark: false,
      tmMark: /TM|注册商标|已申请/.test(String((p.tmStatus && p.tmStatus.status) || '')),
      patentRisk: false,
      // 商标原文: "28个注册商标" / "28个已申请" —— 保留原文, 便于人工核对与以后重新判定
      tmText: (function () {
        if (!p.tmStatus) return null;
        if (typeof p.tmStatus === 'number') return p.tmStatus + '个';
        const c = digits(p.tmStatus.count);
        const st = String(p.tmStatus.status || '').trim();
        return (((c != null ? c + '个' : '') + st).trim()) || null;
      })(),
      trademarkCount: (typeof p.tmStatus === 'number') ? p.tmStatus : (p.tmStatus ? (digits(p.tmStatus.count) || 0) : 0),
      followCount: sellerCount || 0,
      /* ★ 2026-10-02 卖家国家(中国卖家) —— 从硬编码 false 改成读国旗图标的真实结果。
       * 原写法就是这一行 `chinaSeller: false` 让全库 9526 条 100% 是 false,
       * 界面上「中国卖家」筛选自然一条都筛不出来(不是"没实现", 是被写死了)。
       * 数据来源: 插件面板【卖家】行上的国旗 (links-collector.readSellerFlag → p.chinaSeller)。
       * 三态: true/false = 读到国旗; null = 没读到(插件未登录/面板没渲染完) —— 不能当成"非中国"。
       * 同样把原始国家代码留下来, 便于以后细分(港澳台 vs 大陆)。 */
      chinaSeller: (p.chinaSeller === true || p.chinaSeller === false) ? p.chinaSeller : null,
      sellerCountryCode: p.sellerCountryCode || null,
      sellerFlagCode: p.sellerFlagCode || null,
      // ★ 2026-09-24 P0-3c: 未知一律 null (原为 fulfill||'FBM' / rating||4 / stock:0 / 上架写"今天")
      fulfill: p.fulfill || null,
      amazonSell: p.amazonSell != null ? !!p.amazonSell : null,   // ★ 路线 B: 页面读到才判定, 否则未知
      mainImage: p.image || null,
      price, currency,
      monthlySales: p.sales30d ? (String(p.sales30d).includes('<') ? null : (digits(p.sales30d) || null)) : null,
      reviews: num(p.reviews) || null,
      rating: num(p.rating) || null,
      stock: null,
      listedAt: p.listedAt || null,   // ★ 路线 B: 面板给的上架日期 (原先写死 null, 采到也被丢掉)
      size: p.size || null,
      weight: p.weight || null,
      packSize: p.packSize || null,
      packWeight: p.packWeight || null,
      color: p.color || null,
      variantSize: p.variantSize || null,
      productType: p.productType || null,
      variants: digits(p.variants) || 0,
      badge: p.badge || null,
      aplus: p.aplus != null ? !!p.aplus : null,   // ★ 路线 B: 原先写死 false = 断言"没有A+", 属伪造
      bsr: bsrList,
      bsrShop: rShop || null,
      bsrShopCat: p.bsrShopCat || null,
      bsrCat: rCat || null,   // ★ extpush3: 原先漏存小排名(榜单选品) → 读回永远是 undefined, 小排名筛选取不到值
      bsrCatName: p.bsrCatName || null,
      fbaFee: p.fbaFee || null,
      referralFee: null, netProfit: null,   // ★ P0-3c: 占位 0 → null (下面按真实价格重算)
      // ★ 路线 B: 类目层级 (扩展从面包屑读) —— 与详情页链路同字段, 好让大类目筛选也适用于本链路
      catPath: p.catPath || null, cat1: p.cat1 || null, cat2: p.cat2 || null, cat3: p.cat3 || null,
      catSrc: p.catPath ? 'bc' : null, catAt: p.catPath ? now() : null,
      site: itemSite,
      category: p.cat1 || p.bsrShopCat || p.bsrCatName || 'Links',
      collectedAt: now(),
      source,
      sourceBrand: p.sourceBrand || null,
      url: p.productUrl || null,
      saved: false, real: true,
    };
    if (item.price) {
      item.referralFee = Math.round(item.price * 0.15 * 100) / 100;
      item.netProfit = Math.round((item.price - item.referralFee - 3.2 - item.price * 0.3) * 100) / 100;
    }
    item.aiScore = Math.round(Math.min(96, Math.max(30, 80 - item.trademarkCount * 0.5)));
    item.aiRiskLevel = 'low';
    item.aiSuggestPrice = item.price ? Math.round((item.price - 0.5) * 100) / 100 : null;
    products.unshift(applyRankFields(item));
    added++;
  }
  if (added > 0) save('products.json', products);
  return { added, addedAsins, skipped };
}

/**
 * 读当前详情页的【智赢插件面板】原文（穿 shadow DOM）。
 * 大排名来自面板的「店铺选品」(宽类目, 数字大)，Amazon 页面自身的 BSR 只是细分类目(小排名)，
 * 所以补采排名时必须把面板一起读进来 —— 否则补出来的还是小排名。
 */
async function cdpReadZyPanel(send) {
  const expr = `(() => {
    const collect = (root, depth) => {
      let t = '';
      if (!root || depth > 10) return t;
      root.childNodes && root.childNodes.forEach((n) => {
        if (n.nodeType === 3) t += n.textContent + ' ';
        else if (n.nodeType === 1) {
          if (n.tagName === 'STYLE' || n.tagName === 'SCRIPT') return;
          t += n.shadowRoot ? collect(n.shadowRoot, depth + 1) : collect(n, depth + 1);
        }
      });
      if (!t && root.shadowRoot) t = collect(root.shadowRoot, depth + 1);
      return t;
    };
    const HOSTS = ['#zying-amazon-float', '#zying-global-react-host', '.zy-tool-detail', '.zying-shadow-root'];
    const parts = [];
    for (const sel of HOSTS) document.querySelectorAll(sel).forEach((h) => { const t = collect(h.shadowRoot || h, 0).replace(/\\s+/g, ' ').trim(); if (t) parts.push(t) });
    return parts.join(' || ').trim();
  })()`;
  let r = null;
  try { r = await send('Runtime.evaluate', { expression: expr, returnByValue: true }); } catch (e) { return null }
  // 本项目 cdpConnect 的 send 直接 resolve(msg.result) → Runtime.evaluate 的形状是 { result: { value } }
  const v = r && r.result ? r.result.value : null;
  return typeof v === 'string' && v ? v : null;
}

/**
 * 等面板渲染完成再读 —— 面板由扩展注入, **详情页 DOM 就绪 ≠ 面板就绪**。
 *
 * 为什么必须等(实测证据 2026-09-24):
 *   · 补采链路(导航到详情页 → 立刻 cdpReadZyPanel)读到 null → 走 bsr 兜底 →
 *     面板排名「店铺选品/榜单选品」永远补不上, 而 applyRankFields 仍拿【上次采集的旧面板值】
 *     当 rankParent(优先级高于新抓的页面 BSR) → 界面显示的大排名陈旧虚高。
 *     实例: B0GH82GC7D 补采后 bsr←84974 已刷新, 但 rankParent 仍是旧的 375182(真实 ~84974, 面板 #72899)。
 *   · 对照: 同一页面稳定后, 同选择器能读到 389 字符(含「店铺选品 # 84974 Auto et Moto」)。
 *
 * 判定"面板就绪": 文本里出现 ASIN/店铺选品/榜单选品 任一, 且不含"正在分析/正在加载"。
 * 超时策略: 有文本就返回(尽力而为, 交给调用方决定兜底), 一个字都没有才返回 null。
 */
async function cdpReadZyPanelWait(send, opts = {}) {
  const maxMs = Math.max(1000, Number(opts.maxMs) || 20000);
  const end = Date.now() + maxMs;
  let best = null;
  for (;;) {
    const txt = await cdpReadZyPanel(send);
    if (txt) {
      best = txt;
      const analyzing = /正在分析|正在加载/.test(txt);
      if (!analyzing && /(ASIN\s*[:：]|店铺选品|榜单选品)/.test(txt)) return txt;
    }
    if (Date.now() >= end) return best;
    await new Promise((r) => setTimeout(r, 1200));
  }
}

/** 面板字段值清洗: 值尾部混入的下一个字段名一律切掉
 *  实测脏值: weight="0.44 pounds ( 199.99 g) color ： B size ： normal"
 *  (断句表漏字导致串句; 这里是二次防护 —— 即使断句表将来又漏, 也不会把别的字段写进值里) */
function cleanPanelVal(v) {
  if (v == null) return null;
  const t = String(v).replace(/\s+/g, ' ').trim()
    .split(/\s*(?:color|colour|size|变体|近30天销量|fba费用|上架|包装尺寸|包装重量|商品类型|卖家|店铺选品|榜单选品)\s*[:：]/i)[0]
    .trim();
  return t || null;
}

/** 把面板里的 店铺选品 / 榜单选品 并进 bsr, 并返回其中的最大排名（大排名口径） */
function mergePanelRanks(it, panelTxt) {
  if (!panelTxt) return null;
  let pz = null;
  try { pz = linksCollector.parsePanelText(panelTxt); } catch (e) { return null }
  if (!pz) return null;
  const digits = (v) => { const m = String(v == null ? '' : v).replace(/[^\d]/g, ''); return m ? Number(m) : null };
  const rShop = digits(pz.bsrShop), rCat = digits(pz.bsrCat);
  if (!rShop && !rCat) return null;
  // ★ 字段分离 (核心修正): 面板排名不再 push 进 bsr 数组 —— bsr 保持 = Amazon 页面【原生】BSR(细分);
  //   面板的「店铺选品(父类)」写入 bsrShop, 「榜单选品(子类)」写入 bsrCat, 各自独立, 不互相串列。
  it.bsr = Array.isArray(it.bsr) ? it.bsr : [];
  if (rShop) { it.bsrShop = rShop; it.bsrShopCat = pz.bsrShopCat || it.bsrShopCat || null; }
  if (rCat) { it.bsrCat = rCat; it.bsrCatName = pz.bsrCatName || it.bsrCatName || null; }
  applyRankFields(it);   // 同步刷新 父类排名/子类排名 两个独立字段
  const nums = itemRankEntries(it).map((b) => b.rank).filter(Boolean);
  return nums.length ? Math.max.apply(null, nums) : null;
}

/**
 * 列表页卡片 → 字段归一化 + 插件面板就地解析 (2026-09「统一不跳转」改造)
 * 背景: 详情补全默认关闭后, 原本在详情页补的字段必须在这里补齐, 否则商品库会缺商标/月销。
 * 处理: ① 评分/评论字符串 → 数字; ② 卡片插件面板文本 → linksCollector.parsePanelText
 *       (商标数/月销/配送/卖家数); 排名走 mergePanelRanks 的字段分离约定。
 * 就地修改并返回同一数组, 调用点后续流程不用改。
 */
function normalizeListCards(cards) {
  if (!Array.isArray(cards)) return cards;
  cards.forEach((x) => {
    if (typeof x.rating === 'string') { const m = x.rating.match(/([\d.,]+)/); x.rating = m ? parseFloat(m[1].replace(',', '.')) : null; }
    if (typeof x.reviews === 'string') { const m = String(x.reviews).replace(/[.,]/g, '').match(/(\d+)/); x.reviews = m ? parseInt(m[1], 10) : null; }
    if (x.panelTxt) {
      let pd = null;
      try { pd = linksCollector.parsePanelText(x.panelTxt, x.__flag || null); } catch (e) { pd = null; }   // 面板文案变化不应中断采集
      if (pd) {
        if (pd.fulfill) x.fulfill = pd.fulfill;
        if (pd.brand && !x.brand) x.brand = pd.brand;
        if (pd.tmStatus && pd.tmStatus.count != null) { x.trademarkCount = pd.tmStatus.count; x.tmText = pd.tmStatus.count + '个' + pd.tmStatus.status; }
        if (pd.sales30d) x.monthlySales = parseInt(String(pd.sales30d).replace(/[^\d]/g, ''), 10) || 0;
        if (pd.sellerCount != null) x.followCount = parseInt(String(pd.sellerCount).replace(/[^\d]/g, ''), 10) || 0;
        /* ★ 2026-10-02 卖家国家(国旗图标) —— 与上面 ingestLinksProducts 同一套三态语义:
         * true/false = 读到了国旗; null = 没读到(不能当成"非中国")。 */
        if (pd.sellerCountryCode) x.sellerCountryCode = pd.sellerCountryCode;
        if (pd.sellerFlagCode) x.sellerFlagCode = pd.sellerFlagCode;
        if (pd.chinaSeller != null) x.chinaSeller = pd.chinaSeller;
        // ★ 2026-09 变体族: 面板「变体：N个」→ card 级证据(仅当还没 twister 结构时写入, 不覆盖数组)
        if (pd.variants != null && !(Array.isArray(x.variants) ? x.variants.length : (Number(x.variants) > 0))) x.variants = pd.variants;
        mergePanelRanks(x, x.panelTxt);
      }
    }
    delete x.panelTxt; delete x.__flag;
  });
  return cards;
}

function pushNotify(type, title, body) {
  const n = { id: 'N-' + String(notifications.length + 1).padStart(3, '0'), type, title, body, channel: type.includes('调价') ? 'feishu' : 'wecom', at: now(), read: false };
  notifications.unshift(n);
  notifications = notifications.slice(0, 50);
  save('notify.json', notifications);
  return n;
}

// ===== 商品导出: 字段注册表 (前端可勾选; 默认只导"重要信息") =====
// v(x) 取值, h 表头中文, num=true 表示为数值列 (xlsx 里写数字而非文本)
function productUrl(x) { return 'https://www.amazon.' + siteToHostSuffix(x.site || 'uk') + '/dp/' + (x.asin || ''); }
const BADGE_NAME = { bestseller: 'Best Seller', choice: "Amazon's Choice", deal: '限时优惠', newrelease: '新品' };
const EXPORT_FIELDS = [
  { k: 'asin', h: 'ASIN', v: (x) => x.asin || '' },
  { k: 'site', h: '站点', v: (x) => String(x.site || '').toUpperCase() },
  { k: 'title', h: '标题', v: (x) => x.title || '' },
  { k: 'price', h: '价格', v: (x) => (x.price != null ? x.price : ''), num: true },
  { k: 'currency', h: '币种', v: (x) => x.currency || '' },
  // 配送: 自营直接显示 AMZ; 由当前版提取器验证过才写 FBA/FBM; 否则标注"(未核实)"—— 不把旧数据当已核实
  { k: 'fulfill', h: '配送', v: (x) => (x.amazonSell === true ? 'AMZ' : (x.detailVer === DETAIL_VER ? (x.fulfill || '未知') : (x.fulfill ? x.fulfill + '(未核实)' : '未核实'))) },
  { k: 'amz', h: '自营', v: (x) => (x.amazonSell === true ? '是' : (x.detailVer === DETAIL_VER ? '否' : '未核实')) },
  { k: 'aplus', h: 'A+', v: (x) => (x.aplus === true ? '是' : (x.detailVer === DETAIL_VER ? '否' : '未核实')) },
  { k: 'choice', h: 'AC', v: (x) => (x.badge === 'choice' ? '是' : '') },
  { k: 'badge', h: '标签', v: (x) => BADGE_NAME[x.badge] || '' },
  { k: 'url', h: '跳转链接', v: (x) => productUrl(x) },
  { k: 'brand', h: '品牌', v: (x) => x.brand || '' },
  { k: 'rating', h: '评分', v: (x) => (x.rating != null ? x.rating : ''), num: true },
  { k: 'reviews', h: '评论数', v: (x) => (x.reviews != null ? x.reviews : ''), num: true },
  { k: 'follow', h: '跟卖数', v: (x) => x.followCount || 0, num: true },
  { k: 'monthlySales', h: '月销', v: (x) => x.monthlySales || 0, num: true },
  { k: 'rankParent', h: '父类排名', v: (x) => (x.rankParent != null ? '#' + x.rankParent : ''), num: true },
  { k: 'rankParentCat', h: '父类目', v: (x) => x.rankParentCat || '' },
  { k: 'rankChild', h: '子类排名', v: (x) => (x.rankChild != null ? '#' + x.rankChild : ''), num: true },
  { k: 'rankChildCat', h: '子类目', v: (x) => x.rankChildCat || '' },
  { k: 'rank', h: '大排名(=父类排名)', v: (x) => x.rank || '' },
  { k: 'category', h: '类目', v: (x) => x.category || '' },
  { k: 'image', h: '主图', v: (x) => x.mainImage || '' },
  { k: 'collectedAt', h: '采集时间', v: (x) => x.collectedAt || '' },
  { k: 'source', h: '采集方式', v: (x) => ({ 'cdp-follow-shop': '跟卖店铺采集', 'cdp-list-direct': '列表页直采', 'cdp-list-filtered': '列表页筛选采集', 'category-search': '类目搜索采集', 'brand-batch': '批量品牌采集' }[x.source] || x.source || '') },
];
const EXPORT_DEFAULT = ['asin', 'site', 'title', 'price', 'currency', 'fulfill', 'amz', 'aplus', 'choice', 'url'];
const exportFields = (keys) => {
  const list = keys && keys.length ? EXPORT_FIELDS.filter((f) => keys.includes(f.k)) : EXPORT_FIELDS.filter((f) => EXPORT_DEFAULT.includes(f.k));
  return list.length ? list : [EXPORT_FIELDS[0]];
};
// CSV 单元格: 含逗号/引号/换行 → 加引号并转义
function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function xmlEsc(s) {
  return String(s == null ? '' : s)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
// 列号 → Excel 列名 (0→A, 25→Z, 26→AA)
function colName(i) {
  let s = '';
  let n = i;
  while (n >= 0) { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; }
  return s;
}
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[i] = c; }
  return t;
})();
function crc32(buf) { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ -1) >>> 0; }
// 极简 ZIP (deflate), 供 xlsx 打包
function zipFiles(files) {
  const parts = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const raw = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf8');
    const comp = zlib.deflateRawSync(raw);
    const crc = crc32(raw);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(name.length, 26);
    parts.push(lh, name, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += lh.length + name.length + comp.length;
  }
  const cdSize = central.reduce((n, b) => n + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdSize, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, ...central, eocd]);
}
// 生成 xlsx (OOXML: inlineStr 文本 + 数值单元格, 首行冻结)
function xlsxBuffer(sheetName, head, rows, numFlags) {
  const sheetRows = [];
  sheetRows.push('<row r="1">' + head.map((h, i) => `<c r="${colName(i)}1" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(h)}</t></is></c>`).join('') + '</row>');
  rows.forEach((r, ri) => {
    const rn = ri + 2;
    sheetRows.push(`<row r="${rn}">` + r.map((v, ci) => {
      const ref = colName(ci) + rn;
      const isNum = numFlags && numFlags[ci] && v !== '' && v != null && !isNaN(Number(v));
      if (isNum) return `<c r="${ref}"><v>${Number(v)}</v></c>`;
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
    }).join('') + '</row>');
  });
  const sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    + '<sheetData>' + sheetRows.join('') + '</sheetData></worksheet>';
  const ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
    + '</Types>';
  const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
    + '</Relationships>';
  const wb = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + '<sheets><sheet name="' + xmlEsc(sheetName || 'Sheet1') + '" sheetId="1" r:id="rId1"/></sheets></workbook>';
  const wbRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
    + '</Relationships>';
  return zipFiles([
    { name: '[Content_Types].xml', data: ct },
    { name: '_rels/.rels', data: rels },
    { name: 'xl/workbook.xml', data: wb },
    { name: 'xl/_rels/workbook.xml.rels', data: wbRels },
    { name: 'xl/worksheets/sheet1.xml', data: sheet },
  ]);
}

// ===== 找货源: 以图搜图入口注册表 (单一来源, 前端只渲染不做拼接) =====
// kind: 'img-url' = 图片 URL 直通(点开即已用该图搜索, 零人工)
//       'cdp'     = 平台无 URL 图搜接口 → 后端 CDP 自动上传图片并搜索(依然零人工)
//       'keyword' = 该平台网页端无图搜, 只能关键词(明确标注, 不假装是图搜)
// verified 说明 (2026-09-11 用真实主图实测, 请求不带登录态; 字段含义 = "无登录态的服务端探测结果"):
//   直通类链接最终由"你本地浏览器(带你自己的登录态)"打开, 所以服务端被风控 ≠ 你打不开;
//   但下面标注"A 可用"的平台是服务端就能返回真实图搜结果页的, 最有把握。
const SOURCE_SITES = [
  { k: '1688', name: '1688', kind: 'img-url', verified: '服务端探测: 200 但是风控页(x5secdata/punish), 需登录态; 本地浏览器打开通常可用',
    url: (img) => 'https://s.1688.com/youyuan/index.htm?tab=imageSearch&imageAddress=' + encodeURIComponent(img) },
  { k: 'bing', name: 'Bing 视觉搜索', kind: 'img-url', verified: '服务端探测: 302→cn.bing.com 后 301 丢弃图搜参数, 落到 Bing 热门图库(非本次图片)',
    url: (img) => 'https://www.bing.com/images/search?view=detailv2&iss=sbi&q=imgurl:' + encodeURIComponent(img) },
  { k: 'yandex', name: 'Yandex', kind: 'img-url', verified: '服务端探测: 200 但正文 "The service is under construction" (地区限制)',
    url: (img) => 'https://yandex.com/images/search?rpt=imageview&url=' + encodeURIComponent(img) },
  { k: 'alibaba', name: 'Alibaba 国际站', kind: 'img-url', verified: '✓ 服务端实测可用: 200 / 106KB / 真实图搜结果页(Product image search)',
    url: (img) => 'https://www.alibaba.com/picture/search.htm?imageAddress=' + encodeURIComponent(img) + '&imageType=url' },
  { k: 'aliexpress', name: 'AliExpress', kind: 'img-url', verified: '服务端探测: 200 但脚本跳登录墙(login.aliexpress.com)',
    url: (img) => 'https://www.aliexpress.com/w/wholesale-image.html?imageUrl=' + encodeURIComponent(img) },
  { k: 'google', name: 'Google Lens', kind: 'img-url', verified: '本机不可达(连接超时, 需科学上网)',
    url: (img) => 'https://lens.google.com/uploadbyurl?url=' + encodeURIComponent(img) },
  // 无 URL 图搜接口 → 后端 CDP 自动上传 (仍零人工: 后端下载图片并塞进上传框)
  { k: 'stylesnap', name: 'Amazon Shop the Look (原StyleSnap)', kind: 'cdp',
    verified: '页面存活, 初始 HTML 无上传框(需 JS 注入); 且仅时尚服饰类目有效',
    page: 'https://www.amazon.com/stylesnap', inputSel: 'input[type="file"]', resultSel: 'a[href*="/dp/"], a[href*="/gp/product/"]' },
  { k: 'taobao', name: '淘宝拍立淘', kind: 'cdp', verified: 'URL 接口已失效, 走 CDP 自动上传(初始 HTML 无上传框, 需 JS 注入)',
    page: 'https://s.taobao.com/', inputSel: 'input[type="file"]', resultSel: 'a[href*="item.taobao.com"], a[href*="detail.tmall.com"]' },
  { k: 'pdd', name: '拼多多', kind: 'keyword', verified: '网页端无图搜入口(只能关键词)', keywordUrl: (kw) => 'https://mobile.yangkeduo.com/search_result.html?search_key=' + encodeURIComponent(kw) },
];
// 通用 CDP 图搜: 下载主图 → 打开平台图搜页 → 自动把文件塞进上传框 → 返回当前页(已带图搜结果)+尽力解析
async function cdpImageSearch(siteKey, imageUrl, opts = {}) {
  const site = SOURCE_SITES.find((s) => s.k === siteKey);
  if (!site) throw new Error('未知平台: ' + siteKey);
  if (site.kind !== 'cdp') throw new Error('该平台不需要 CDP 上传 (kind=' + site.kind + ')');
  const tmpDir = path.join(DATA, 'tmp');
  fs.mkdirSync(tmpDir, { recursive: true });
  const tmpFile = path.join(tmpDir, 'imgsearch_' + siteKey + '_' + Date.now() + '.jpg');
  const resp = await fetch(imageUrl, { signal: AbortSignal.timeout(30000) });
  if (!resp.ok) throw new Error('主图下载失败 (HTTP ' + resp.status + ')');
  fs.writeFileSync(tmpFile, Buffer.from(await resp.arrayBuffer()));
  const tabs = await cdpGetTabs();
  const page = tabs.find((t) => t.type === 'page' && !t.url.includes('3088') && !t.url.startsWith('data:')) || tabs.find((t) => t.type === 'page');
  if (!page) throw new Error('Edge 无可用页面标签');
  const { send } = await cdpConnect(page.webSocketDebuggerUrl);
  await send('Page.navigate', { url: site.page });
  await new Promise((r) => setTimeout(r, 3000));
  const findInput = async () => {
    try {
      for (const sel of [site.inputSel, 'input[type="file"]'].filter(Boolean)) {
        const doc = await send('DOM.getDocument', {});
        const q = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: sel });
        if (q && q.nodeId) return q.nodeId;
      }
    } catch (e) { /* ignore */ }
    return null;
  };
  let nodeId = null;
  for (let i = 0; i < 10 && !nodeId; i++) { await new Promise((r) => setTimeout(r, 1000)); nodeId = await findInput(); }
  if (!nodeId) {
    // 尝试点开相机/图搜按钮再找
    for (let retry = 0; retry < 3 && !nodeId; retry++) {
      await send('Runtime.evaluate', { expression: `(() => { const b=[...document.querySelectorAll('[class*=camera],[class*=image],[class*=photo],[title*=图],[aria-label*=图]')].find(e=>e.offsetParent); if(b) b.click(); return !!b; })()` });
      await new Promise((r) => setTimeout(r, 2000));
      for (let i = 0; i < 6 && !nodeId; i++) { await new Promise((r) => setTimeout(r, 1000)); nodeId = await findInput(); }
    }
  }
  if (!nodeId) throw new Error(site.name + ' 未找到图片上传入口 (可能需先登录该平台)');
  await send('DOM.setFileInputFiles', { nodeId, files: [tmpFile] });
  // 等结果页/结果块出现
  let curUrl = '';
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 1200));
    try { const t = await send('Runtime.evaluate', { expression: 'location.href', returnByValue: true }); curUrl = (t && t.result && t.result.value) || curUrl; } catch (e) { /* ignore */ }
    if (curUrl && curUrl !== site.page && !/^https?:\/\/s\.taobao\.com\/?$/.test(curUrl)) break;
  }
  let results = [];
  try {
    const rr = await send('Runtime.evaluate', {
      expression: `(() => { const out=[]; document.querySelectorAll(${JSON.stringify(site.resultSel || 'a[href*="item"]')}).forEach(a=>{ const t=(a.textContent||'').replace(/\\s+/g,' ').trim().slice(0,80); const h=a.getAttribute('href')||''; if(t&&h) out.push({ title:t, url: h.startsWith('http')?h:location.origin+h }); }); return JSON.stringify(out.slice(0,40)); })()`,
      returnByValue: true,
    });
    results = JSON.parse((rr.result && rr.result.value) || '[]');
  } catch (e) { /* 解析失败不影响流程 */ }
  return { ok: true, site: siteKey, siteName: site.name, pageUrl: curUrl, results, image: tmpFile };
}

// ===== 货源记录: 结构化与去重 (价格是阶梯/区间文本, 必须解析成 min/max/币种/MOQ) =====
const FX_RATES = { CNY: 1, EUR: 7.8, USD: 7.1, GBP: 9.1, JPY: 0.048, AUD: 4.85, CAD: 5.2, INR: 0.085, MXN: 0.4, BRL: 1.3, AED: 1.93, SAR: 1.89, SGD: 5.3, PLN: 1.85, SEK: 0.68, TRY: 0.2 };
// "¥12.80-15.60" / "5-99件 ¥9.5" / "US$3.20" / "￥9.5/件" → { priceMin, priceMax, currency, moq }
function parseGoodPrice(raw) {
  const s = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
  if (!s) return { priceRaw: null, priceMin: null, priceMax: null, currency: null, moq: null };
  // 币种判断 (1688/淘宝/拼多多 默认人民币)
  let currency = null;
  if (/US\$|USD/i.test(s)) currency = 'USD';
  else if (/€|EUR/i.test(s)) currency = 'EUR';
  else if (/£|GBP/i.test(s)) currency = 'GBP';
  else if (/￥|¥|CNY|RMB|元/.test(s)) currency = 'CNY';
  else if (/\$/.test(s)) currency = 'USD';
  // 去掉"起订量/阶梯量"数字, 避免被当成价格 ("5-99件"、"100件起")
  let t = s.replace(/\d+\s*[-~至]\s*\d+\s*(件|个|套|只|双|pcs|PCS)/g, ' ')
    .replace(/\d+\s*(件|个|套|只|双|pcs|PCS)\s*(起|以上)?/g, ' ')
    .replace(/每\s*(件|个|套|只|双)/g, ' ');
  const nums = (t.match(/\d+(?:[.,]\d+)?/g) || []).map((x) => parseFloat(String(x).replace(',', ''))).filter((n) => !isNaN(n) && n > 0);
  const moqM = s.match(/(\d+)\s*(件|个|套|只|双|pcs|PCS)\s*(起|以上)/);
  const moq = moqM ? parseInt(moqM[1], 10) : null;
  if (!nums.length) return { priceRaw: s.slice(0, 60), priceMin: null, priceMax: null, currency, moq };
  const mn = Math.min.apply(null, nums);
  const mx = Math.max.apply(null, nums);
  return { priceRaw: s.slice(0, 60), priceMin: mn, priceMax: mx > mn ? mx : null, currency, moq };
}
// URL 规范化去重键: 去协议/参数/末尾斜杠, 提取商品 id (1688 offer/xxx.htm、taobao id=、amazon /dp/ASIN)
function goodUrlKey(u) {
  const s = String(u || '').trim();
  if (!s) return '';
  try {
    const u2 = new URL(s);
    const host = u2.host.replace(/^www\./, '');
    // ① 查询参数里的商品 id (淘宝/天猫 item.htm?id=98765 → 不提取的话所有淘宝商品会撞成一个键)
    const qid = u2.searchParams.get('id') || u2.searchParams.get('offerId') || u2.searchParams.get('itemId');
    if (qid) return (host + '/' + qid).toLowerCase();
    // ② 路径里的 id: 1688 /offer/123456.html、Amazon /dp/B0XXXXXXXX、AliExpress /item/123.html
    const m1 = u2.pathname.match(/(?:offer|item|detail|dp|product)[\/-]([A-Za-z0-9_-]{4,})/i);
    if (m1) return (host + '/' + m1[1]).toLowerCase();
    return (host + u2.pathname.replace(/\/+$/, '')).toLowerCase();
  } catch (e) { return s.toLowerCase().slice(0, 120); }
}
// 补齐字段 (id/urlKey/结构化价格/核价时间) — 兼容历史无 id 的记录
function ensureGoodShape(g) {
  const o = Object.assign({}, g || {});
  const p = parseGoodPrice(o.priceRaw || o.price);
  o.priceRaw = o.priceRaw || p.priceRaw || (o.price || null);
  if (o.priceMin == null) o.priceMin = p.priceMin;
  if (o.priceMax == null) o.priceMax = p.priceMax;
  if (!o.currency) o.currency = p.currency || (['1688', '淘宝', '拼多多', '天猫'].includes(o.platform) ? 'CNY' : null);
  if (o.moq == null) o.moq = p.moq;
  if (o.price != null && o.priceRaw == null) o.priceRaw = String(o.price);
  // 货源角色: 'primary' 现阶段最优供货 / 'backup' 备选 / '' 普通
  if (o.role !== 'primary' && o.role !== 'backup') o.role = o.role === 'backup' ? 'backup' : '';
  // 运费 (从供应商到货代/到仓, 人民币, 手填) + 备注
  if (o.shipFee != null && o.shipFee !== '' && !isNaN(Number(o.shipFee))) o.shipFee = Number(o.shipFee);
  else o.shipFee = null;
  if (o.note == null) o.note = null;
  o.urlKey = o.urlKey || goodUrlKey(o.url);
  o.id = o.id || ('G' + Math.abs(hashStr(o.urlKey || (o.title || '') + (o.addedAt || ''))).toString(36)).slice(0, 12);
  o.checkedAt = o.checkedAt || o.addedAt || null;
  if (!Array.isArray(o.priceHistory)) o.priceHistory = [];
  return o;
}
function hashStr(s) { let h = 0; for (let i = 0; i < String(s).length; i++) { h = (h * 31 + String(s).charCodeAt(i)) | 0; } return h; }
// 货源价(¥) → 售价币种; 返回占售价比例 (比价必须换算币种, 否则结论无意义)
// 到货成本 = 货源价 + 运费(手填) —— 只看货源价会低估真实采购成本
// 货源成本 vs 售价 (比价): rateMap 可传入"实时汇率"表 (与利润测算同源), 不传则用内置表
// 为什么不直接用内置表: 内置 FX_RATES 是静态兜底 (USD 7.1), 实时是 ~6.7 → 两处口径不同会让
//   货源比价显示的百分比和利润测算算出来的对不上 (同一个商品两个数字)
function goodCostVsPrice(good, prodPrice, prodCurrency, rateMap) {
  const R = rateMap && Object.keys(rateMap).length ? rateMap : FX_RATES;
  const rate = R[prodCurrency] || null;
  if (good.priceMin == null || !rate || !(prodPrice > 0)) return null;
  const cny0 = good.currency && good.currency !== 'CNY' ? good.priceMin * (R[good.currency] || 1) : good.priceMin;
  const cny = cny0 + (good.shipFee || 0);
  const inSellCur = cny / rate;
  return { costCny: Math.round(cny * 100) / 100, goodsCny: Math.round(cny0 * 100) / 100, shipFee: good.shipFee || 0, inSellCur: Math.round(inSellCur * 100) / 100, ratioPct: Math.round((inSellCur / prodPrice) * 1000) / 10, rateSource: rateMap && Object.keys(rateMap).length ? '实时汇率' : '内置兜底表' };
}
// 该商品的最优/备选供货
const primaryOf = (prod) => ((prod && prod.sourceGoods) || []).map(ensureGoodShape).find((g) => g.role === 'primary') || null;
const backupsOf = (prod) => ((prod && prod.sourceGoods) || []).map(ensureGoodShape).filter((g) => g.role === 'backup');

// ===== 税费与费率表 (利润测算用) =====
// 设计原则: ① 能自动获取的自动获取 (欧盟 VAT 走联网 API) ② 拿不到的用内置表但标注来源与生效日期
//          ③ 每项都可在界面手改 (手改值优先, 存 data/tax-rates.json) ④ 绝不当 0 静默参与计算
const TAX_TABLE = {
  uk: { country: 'United Kingdom', name: 'VAT', rate: 20, includesTax: true },
  de: { country: 'Germany', name: 'VAT', rate: 19, includesTax: true },
  fr: { country: 'France', name: 'VAT', rate: 20, includesTax: true },
  it: { country: 'Italy', name: 'VAT', rate: 22, includesTax: true },
  es: { country: 'Spain', name: 'VAT', rate: 21, includesTax: true },
  nl: { country: 'Netherlands', name: 'VAT', rate: 21, includesTax: true },
  be: { country: 'Belgium', name: 'VAT', rate: 21, includesTax: true },
  ie: { country: 'Ireland', name: 'VAT', rate: 23, includesTax: true },
  se: { country: 'Sweden', name: 'VAT', rate: 25, includesTax: true },
  pl: { country: 'Poland', name: 'VAT', rate: 23, includesTax: true },
  au: { country: 'Australia', name: 'GST', rate: 10, includesTax: true },
  jp: { country: 'Japan', name: 'JCT', rate: 10, includesTax: true },
  ca: { country: 'Canada', name: 'GST', rate: 5, includesTax: true, note: '联邦 GST 5%, 另加省税 (HST/PST 合计约 5~15%)' },
  us: { country: 'United States', name: 'Sales Tax', rate: 0, includesTax: false, note: '美国售价不含税, 平台代收代缴, 不参与利润扣减; 各州 0~10.25%' },
  in: { country: 'India', name: 'GST', rate: 18, includesTax: true, note: '多数类目 18%' },
  mx: { country: 'Mexico', name: 'IVA', rate: 16, includesTax: true },
  br: { country: 'Brazil', name: 'ICMS', rate: 17, includesTax: true, note: '州际差异 17~25%' },
  sg: { country: 'Singapore', name: 'GST', rate: 9, includesTax: true },
  ae: { country: 'UAE', name: 'VAT', rate: 5, includesTax: true },
  sa: { country: 'Saudi Arabia', name: 'VAT', rate: 15, includesTax: true },
  tr: { country: 'Turkey', name: 'KDV', rate: 20, includesTax: true },
};
const TAX_BUILTIN_NOTE = '内置表 (官方公布标准税率, 2026-01 核对)';
// 亚马逊类目佣金率 (参考值: 各站点略有差异, 以卖家后台/SP-API Fee Preview 为准) — 可界面手改
const REFERRAL_FEES = {
  'Amazon Device Accessories': 45, '亚马逊设备配件': 45,
  // 别名 (实测漏配的写法都补上; 只做正向匹配, 键长≥4)
  'Computer & Accessories': 8, 'Computers & Accessories': 8, 'Computers & Accessories & Peripherals': 8,
  'Mobile Phone & Accessories': 8, 'Mobile Phones': 8, 'Mobile Phones & Communication': 8,
  'Cell Phone & Accessories': 8, 'Cell Phones': 8,
  'Auto & Motorrad': 12, 'Automotive & Motorcycle': 12,
  'Consumer Electronics': 8, 'Electronics & Photo': 8, 'Electronics': 8, 'Computers': 8,
  'PC & Video Games': 8, 'Cell Phones & Accessories': 8, 'Camera & Photo': 8, 'Video Games': 8, 'Video Games & Consoles': 8,
  'Automotive': 12, 'Industrial & Scientific': 12, 'Musical Instruments': 12,
  'Business, Industry & Science': 15, 'Books': 15, 'Books & Audible': 15, 'Kindle Store': 15,
  'Music': 15, 'DVD & Blu-ray': 15, 'Movies & TV': 15,
  'Clothing, Shoes & Accessories': 17, 'Fashion': 17, 'Clothing': 17,
  'Jewellery': 20, 'Jewelry': 20, 'Watches': 16,
  'Home & Kitchen': 15, 'Home': 15, 'Kitchen & Dining': 15, 'Furniture': 15, 'Lighting': 15,
  'Garden': 15, 'Garden & Outdoors': 15, 'Tools & Home Improvement': 15, 'DIY & Tools': 15, 'Tools': 15,
  'Toys & Games': 15, 'Sports & Outdoors': 15, 'Outdoors': 15, 'Pet Supplies': 15,
  'Health & Personal Care': 15, 'Health': 15, 'Beauty': 15, 'Beauty & Personal Care': 15,
  'Baby': 15, 'Baby Products': 15, 'Office Products': 15, 'Stationery & Office Products': 15, 'Office Supplies': 15,
  'Grocery': 8, 'Grocery & Gourmet Food': 8,
};
const DEFAULT_REFERRAL = 15;
const REFERRAL_NOTE = 'Amazon 公开费率表参考值 (多为美站口径: 同一类目在英国/德国等站点常低 1-2 个点; 以卖家后台 Fee Preview / SP-API 为准)';const referralRateFor = (cat1) => {
  if (!cat1) return { rate: DEFAULT_REFERRAL, hit: false };
  if (REFERRAL_FEES[cat1] != null) return { rate: REFERRAL_FEES[cat1], hit: true };
  const c = String(cat1).toLowerCase();
  // 只做"类目名包含费率表键"的正向匹配 (键长≥4)。
  // 旧实现还做反向包含 (键包含类目名) → "Games" 被 "PC & Video Games" 反向命中成 8% 这类误配
  const k = Object.keys(REFERRAL_FEES).find((x) => x.length >= 4 && c.includes(x.toLowerCase()));
  return k ? { rate: REFERRAL_FEES[k], hit: true, matchedKey: k } : { rate: DEFAULT_REFERRAL, hit: false };
};
// 税率: 手改 > 已联网缓存的欧盟值 > 内置表; 返回 {rate,name,includesTax,source,note}
// euDate: 欧盟数据的抓取日期 (调用方传 eu.date) —— 旧实现从 sites 对象里读 date, 永远是空的 → 来源显示 "api.vatcomply.com ()"
function taxForSite(site, overrides, euData, euDate) {
  const s = String(site || 'uk').toLowerCase();
  const base = TAX_TABLE[s] || null;
  const ov = overrides && overrides[s];
  if (ov && ov.rate != null) return { rate: Number(ov.rate), name: (base && base.name) || 'VAT', includesTax: ov.includesTax != null ? !!ov.includesTax : (base ? base.includesTax : true), source: '手动设置', note: '' };
  if (euData && euData[s] && euData[s].rate != null) return { rate: Number(euData[s].rate), name: 'VAT', includesTax: true, source: 'api.vatcomply.com' + (euDate ? ' (' + euDate + ')' : ''), note: '' };
  if (base) return { rate: base.rate, name: base.name, includesTax: base.includesTax, source: TAX_BUILTIN_NOTE, note: base.note || '' };
  return { rate: 0, name: 'VAT', includesTax: true, source: '未知站点', note: '该站点税率未收录, 请手填' };
}
// 欧盟 VAT 联网获取 (27 国; 非欧盟不在该数据集内 → 用内置表)
const EU_SITE_BY_CC = { AT: null, BE: 'be', BG: null, CY: null, CZ: null, DE: 'de', DK: null, EE: null, ES: 'es', FI: null, FR: 'fr', GR: null, HR: null, HU: null, IE: 'ie', IT: 'it', LT: null, LU: null, LV: null, MT: null, NL: 'nl', PL: 'pl', PT: null, RO: null, SE: 'se', SI: null, SK: null };
async function fetchEuVat() {
  try {
    const r = await fetch('https://api.vatcomply.com/vat_rates', { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    const arr = await r.json();
    if (!Array.isArray(arr)) return null;
    const out = {};
    for (const it of arr) {
      const site = EU_SITE_BY_CC[it.country_code];
      if (site && it.standard_rate != null) out[site] = { rate: it.standard_rate, country: it.country_name };
    }
    return { date: new Date().toISOString().slice(0, 10), source: 'api.vatcomply.com (欧盟委员会 TEDB)', sites: out };
  } catch (e) { return null; }
}

// 带币种符号的金额解析: "$6.08" / "€1.87" / "A$12.30" / "6.08" → {value:6.08, currency:'USD'|'EUR'|null, symbol}
// 用途: 插件面板采集来的 fbaFee 是字符串, 直接 Number() 会得 NaN → 被误判成"没采到"
function parseMoneyValue(v) {
  if (v == null) return null;
  if (typeof v === 'number') return isFinite(v) ? { value: v, currency: null, symbol: null } : null;
  const s = String(v).trim();
  const m = s.match(/(A\$|AU\$|US\$|C\$|HK\$|S\$|R\$|[$£€¥₺₹]|zł|kr|AED|SAR|CNY|USD|EUR|GBP|JPY|AUD|CAD|SGD|MXN|BRL|TRY|INR|PLN|SEK)\s*([\d.,]+)/i);
  if (!m) {
    const n = parseMoneyText(s, site);   // ★ 站点感知
    return isFinite(n) ? { value: n, currency: null, symbol: null } : null;
  }
  const sym = m[1];
  const value = parseFloat(String(m[2]).replace(/,/g, ''));
  if (!isFinite(value)) return null;
  const CUR = { 'A$': 'AUD', 'AU$': 'AUD', US$: 'USD', 'C$': 'CAD', 'HK$': 'HKD', 'S$': 'SGD', 'R$': 'BRL', $: null, '£': 'GBP', '€': 'EUR', '¥': 'JPY', '₺': 'TRY', '₹': 'INR', zł: 'PLN', kr: 'SEK', AED: 'AED', SAR: 'SAR' };
  const up = sym.toUpperCase();
  const currency = CUR[sym] !== undefined ? CUR[sym] : (['CNY', 'USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'SGD', 'MXN', 'BRL', 'TRY', 'INR', 'PLN', 'SEK'].indexOf(up) >= 0 ? up : null);
  return { value: value, currency: currency, symbol: sym };
}
// FBA 配送费 / 站点币种换算用: 返回数值 (解析失败 → 0)
function feeToNumber(v) { const p = parseMoneyValue(v); return p ? p.value : 0; }

// ===== 利润测算 (单一实现: 明细逐项返回, 前端只渲染不重算) =====
// 口径:
//   ① 售价默认 BuyBox 价 (回退 price), 不再用"最低价"当收入
//   ② VAT/GST: 售价含税的站点扣 售价×r/(100+r) (反算); 美国不含税 → 不扣
//   ③ 佣金: 按类目费率表 (不再用那个硬编码 15% 的存储值)
//   ④ FBA/AMZ: 扣 FBA 配送费 (本币, 优先用插件采集的 fbaFee) ⑤ FBM: 扣国际运费 (人民币, 报价表/手填)
//   ⑥ 缺数据的项一律"需手填", 绝不当 0 静默参与计算
function computeProfit(p, req, taxOverrides, euData, rateInfo, euDate) {
  const site = String(p.site || 'uk').toLowerCase();
  const cur = p.currency || siteCurrency(site);
  // 售价口径: BuyBox 优先, 回退 price; 只有明确选"最低价"才用 minPrice
  // (旧实现默认拿 minPrice → 价格修正后 minPrice 未同步会算出错误收入)
  const priceBuyBox = p.buyBoxPrice != null ? p.buyBoxPrice : p.price;
  const priceMin = p.minPrice != null ? p.minPrice : p.price;
  const num = (v, d) => (v == null || v === '' || isNaN(Number(v)) ? d : Number(v));
  const priceBasis = req.priceBasis || 'buybox';
  const sellPrice = num(req.priceOverride, priceBasis === 'min' ? priceMin : priceBuyBox);
  const fx = num(req.fx, rateInfo && rateInfo.rate);
  const fxLoss = num(req.fxLoss, 0.5) / 100;                 // 汇损 %
  const payRate = num(req.payRate, 0.5) / 100;               // 收款手续费 %
  const acos = num(req.acos, 12) / 100;
  const returnRate = num(req.returnRate, 3) / 100;
  const targetMargin = num(req.targetMargin, 20) / 100;
  const mode = ['FBA', 'FBM', 'AMZ'].includes(req.mode) ? req.mode : (p.amazonSell ? 'AMZ' : (p.fulfill === 'FBA' ? 'FBA' : 'FBM'));
  const tax = taxForSite(site, taxOverrides, euData, euDate);
  const vatRate = num(req.vatRate, tax.rate) / 100;
  const ref = referralRateFor(p.cat1);
  const commRate = num(req.commRate, ref.rate) / 100;
  const items = [];
  const warnings = [];
  const add = (k, label, valueCny, formula, source, kind) => items.push({ k, label, valueCny: Math.round(valueCny * 100) / 100, formula, source, kind });

  if (!(sellPrice > 0)) warnings.push('售价缺失, 无法测算');
  if (!(fx > 0)) warnings.push('汇率缺失 (可点「刷新汇率」)');
  const revenue = sellPrice * fx;
  add('revenue', '收入 售价 ' + sellPrice + ' ' + cur + ' × 汇率 ' + fx, revenue, sellPrice + ' × ' + fx, (req.fx != null && req.fx !== '' ? '手动填写汇率' : (rateInfo && rateInfo.source ? rateInfo.source + ' ' + (rateInfo.date || '') : '汇率待获取')), 'fact');
  // VAT / GST (含税站点才扣, 且是反算)
  const vatCny = tax.includesTax && vatRate > 0 ? revenue * (vatRate / (1 + vatRate)) : 0;
  add('vat', (tax.name || 'VAT') + ' ' + (vatRate * 100).toFixed(1) + '%' + (tax.includesTax ? ' (含税价反算)' : ' (该站售价不含税, 不扣)'), -vatCny, tax.includesTax ? '收入 × ' + (vatRate * 100).toFixed(1) + '/(' + (100 + vatRate * 100).toFixed(0) + ')' : '该站点售价不含税 (如美国)', tax.source + (tax.note ? ' · ' + tax.note : ''), tax.source === '手动设置' ? 'input' : 'auto');
  // 佣金
  const commCny = sellPrice * commRate * fx;
  add('commission', '亚马逊佣金 ' + (commRate * 100).toFixed(1) + '%', -commCny, sellPrice + ' × ' + (commRate * 100).toFixed(1) + '% × ' + fx, (p.cat1 ? '类目 ' + p.cat1 + ' · ' : '') + REFERRAL_NOTE + (ref.hit ? '' : ' (未匹配类目, 用默认值)'), 'auto');
  // FBA 配送费 (FBA/AMZ) 或 国际运费 (FBM)
  let fulfillCny = 0;
  if (mode === 'FBA' || mode === 'AMZ') {
    // fbaFee 可能来自插件面板, 带币种符号 (实测存量里是 "$6.08" / "€1.87" 这类字符串)
    // 旧实现直接 Number("$6.08") → NaN → 判定"缺失" → 配送费恒 0 且提示"未采集到"(其实采到了)
    const rawFee = req.fbaFee != null && req.fbaFee !== '' ? req.fbaFee : p.fbaFee;
    const pm = parseMoneyValue(rawFee);
    const fee = req.fbaFee != null && req.fbaFee !== '' ? num(req.fbaFee, 0) : (pm ? pm.value : 0);
    if (fee > 0) {
      const symCur = pm && pm.currency ? pm.currency : null;
      const ambiguous = pm && !pm.currency && pm.symbol ? pm.symbol + ' 未标明币种→按站点币种 ' + cur : null;
      const mismatch = symCur && symCur !== cur;
      fulfillCny = fee * fx;
      add('fbaFee', 'FBA 配送费 ' + fee + ' ' + (symCur || cur), -fulfillCny, fee + ' × ' + fx,
        (p.fbaFee != null ? '插件面板采集' + (symCur ? ' (' + symCur + ')' : (ambiguous ? ' (' + ambiguous + ')' : '')) + (p.detailAt ? ' ' + p.detailAt : '') : '手动填写'),
        p.fbaFee != null ? 'fact' : 'input');
      if (mismatch) warnings.push('FBA 配送费采集值是 ' + symCur + ', 站点币种是 ' + cur + ' — 已按同一汇率换算, 请核对');
    } else { warnings.push('FBA 配送费缺失 → 需手填 (按尺寸/重量查亚马逊费率表, 或补采插件面板)'); add('fbaFee', 'FBA 配送费 (缺, 需手填)', 0, '—', '未采集到 fbaFee/重量', 'input'); }
  } else {
    const logi = num(req.shipCny, null);
    if (logi != null && logi > 0) { fulfillCny = 0; add('shipCny', '国际运费 (自发货) ¥' + logi, 0, '已在成本侧计入', '报价表/手填', 'input'); }
    else { warnings.push('FBM 需填国际运费 (点「一键计算」按报价表算, 或手填)'); add('shipCny', '国际运费 (缺, 需手填/报价表)', 0, '—', '未填', 'input'); }
  }
  const adCny = revenue * acos;
  add('ad', '广告 ACOS ' + (acos * 100).toFixed(1) + '%', -adCny, '收入 × ' + (acos * 100).toFixed(1) + '%', '假设值 (可改)', 'assume');
  // 货款/物流/关税/仓储 (人民币成本)
  const supply = num(req.supplyCny, 0);
  const ship = num(req.shipCny, 0);
  const duty = num(req.dutyCny, 0);
  const storage = num(req.storageCny, 0);
  const other = num(req.otherCny, 0);
  const costBase = supply + ship + duty + storage + other;
  const retLoss = costBase * returnRate;
  add('return', '退货损失 退货率 ' + (returnRate * 100).toFixed(1) + '%', -retLoss, '(' + costBase.toFixed(2) + ') × ' + (returnRate * 100).toFixed(1) + '%', '假设值 (FBM 弃货损失更高)', 'assume');
  const payCny = revenue * (payRate + fxLoss);
  add('pay', '收款手续费+汇损 ' + ((payRate + fxLoss) * 100).toFixed(1) + '%', -payCny, '收入 × ' + ((payRate + fxLoss) * 100).toFixed(1) + '%', '假设值 (连连/PingPong 提现费率)', 'assume');
  add('supply', '货源成本 (¥)', -supply, '手填', '你的采购价', 'input');
  add('ship', mode === 'FBM' ? '头程/物流 (¥, 已在成本侧)' : '头程运费 中国→FBA仓 (¥)', -ship, '手填/报价表', '你的实际运费', 'input');
  add('duty', '关税/进口VAT (¥)', -duty, '手填 (需 HS 编码 + 货代报价, 无法自动获取)', '未填', 'input');
  add('storage', '仓储/其他 (¥)', -storage, '手填', '未填', 'input');
  // 其他成本: 前端有输入框而明细漏列 → Σ明细 ≠ 净利润 (已实测差 49.99), 必须单列
  if (other !== 0) add('other', '其他成本 (¥)', -other, '手填', '未填', 'input');
  const platformCny = vatCny + commCny + (mode === 'FBM' ? 0 : fulfillCny) + adCny + retLoss + payCny;
  const netCny = revenue - platformCny - costBase;
  const marginPct = revenue > 0 ? (netCny / revenue) * 100 : 0;
  // 展示口径: 明细逐项四舍五入后求和, 保证"Σ明细 = 净利"完全对得上
  // (旧实现总量用未舍入值、明细用舍入值 → 用户自己加总会看到差 1 分, 像 bug)
  const r2 = (v) => Math.round(v * 100) / 100;
  const PLATFORM_KEYS = ['vat', 'commission', 'fbaFee', 'ad', 'return', 'pay'];
  const COST_KEYS = ['supply', 'ship', 'duty', 'storage', 'other'];
  const sumKeys = (keys) => r2(items.filter((i) => keys.indexOf(i.k) >= 0).reduce((s, i) => s + i.valueCny, 0));
  const revShown = r2((items.find((i) => i.k === 'revenue') || { valueCny: revenue }).valueCny);
  const netShown = r2(items.reduce((s, i) => s + i.valueCny, 0));
  const platformShown = r2(-sumKeys(PLATFORM_KEYS));
  const costShown = r2(-sumKeys(COST_KEYS));
  const marginShown = revShown > 0 ? r2((netShown / revShown) * 100) : 0;
  // 盈亏平衡价 / 目标利润率价 (闭式解: 比例项随价变, 固定项为人民币)
  const K = 1 - (tax.includesTax ? vatRate / (1 + vatRate) : 0) - commRate - acos - (payRate + fxLoss);
  const fixedCny = costBase * (1 + returnRate) * 1 + 0;   // 成本 + 退货损失(按成本比例)
  const fbaFixCny = (mode === 'FBM' ? 0 : fulfillCny);
  const breakEven = (fx > 0 && K > 0) ? (fbaFixCny + fixedCny) / (fx * K) : null;
  const targetPrice = (fx > 0 && K - targetMargin > 0) ? (fbaFixCny + fixedCny) / (fx * (K - targetMargin)) : null;
  return {
    ok: true, asin: p.asin, site, currency: cur, mode,
    price: { buybox: priceBuyBox, min: priceMin, used: sellPrice, basis: req.priceOverride != null && req.priceOverride !== '' ? 'override' : priceBasis },
    fx: { rate: fx, source: rateInfo ? rateInfo.source : null, date: rateInfo ? rateInfo.date : null },
    tax: { name: tax.name, rate: vatRate * 100, includesTax: tax.includesTax, source: tax.source, note: tax.note || '' },
    commission: { rate: commRate * 100, category: p.cat1 || null, matched: ref.hit, source: REFERRAL_NOTE },
    items, revenueCny: revShown,
    platformCny: platformShown,
    costCny: costShown,
    netCny: netShown, marginPct: marginShown,
    breakEvenPrice: breakEven != null ? Math.round(breakEven * 100) / 100 : null,
    targetPrice: targetPrice != null ? Math.round(targetPrice * 100) / 100 : null,
    targetMarginPct: targetMargin * 100,
    warnings,
  };
}

// ===== 授权模块 (Ed25519 离线授权 + 设备绑定 + 功能位) =====
const { licenseStatus, hasFeature, deviceFingerprint, enforceEnabled, verifyLicenseText } = require('./license');

// ===== HTTP 处理 =====
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;
  let body = '';
  req.on('data', (c) => body += c);
  req.on('end', async () => {
    let j = {};
    try { if (body) j = JSON.parse(body); } catch {}
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    const send = (code, data) => {
      // 采集接口若在校验阶段就失败 (400/404/409), 必须清掉刚注册的"运行中"进度,
      // 否则进度会永远停在 running → 后续采集一律被 409 拒绝 ("已有采集正在运行")
      if (code >= 400 && req.method === 'POST' && String(p).startsWith('/api/collect/')
        && p !== '/api/collect/stop' && collectProgress && collectProgress.running) clearCollectProgress();
      res.statusCode = code;
      res.end(JSON.stringify(data));
    };

    try {
      // ★ 路线 B: 跨源 POST JSON 会先发 OPTIONS 预检。原先只设了 Allow-Origin,
      //   没有 Methods/Headers 也没有 OPTIONS 应答 → 浏览器预检失败, 扩展/外部页面一律发不进来。
      if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }

      // ---- 静态文件 ----
      if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.end(fs.readFileSync(path.join(PUBLIC, 'index.html')));
      }
      if (req.method === 'GET' && p.startsWith('/assets/')) {
        const f = path.join(PUBLIC, p.replace('/assets/', ''));
        if (fs.existsSync(f)) {
          const ext = path.extname(f);
          const ct = { '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' }[ext] || 'text/plain';
          res.setHeader('Content-Type', ct);
          return res.end(fs.readFileSync(f));
        }
        return send(404, { error: 'not found' });
      }

      // ---- API ----
      // ---- 授权闸门 (license gate) ----
      // 设计: 白名单只放 health / license 状态; 其余 /api/* 在"启用授权"时必须有有效授权。
      //      强校验必须放在后端 —— 前端(client.js)是明文 JS, 改了也没用, 拿不到数据与采集能力。
      //      未启用授权(enforce=false)时全部放行, 但状态接口会明确写"开发模式", 避免误以为已受保护。
      if (p.startsWith('/api/')) {
        const WHITELIST = ['/api/health', '/api/license/status', '/api/license/verify'];
        if (WHITELIST.indexOf(p) < 0) {
          const st = licenseStatus();
          if (st.enforce && !st.valid) {
            return send(403, {
              error: '未授权: ' + (st.message || st.reason),
              license: { enforce: st.enforce, reason: st.reason, fingerprint: st.fingerprint, customer: st.customer, expiresAt: st.expiresAt, contact: st.contact || null, licensePath: st.licensePath || null },
              howto: '把 license.key 放到 zying-demo\\ 目录后重启服务; 若已到期或换了机器, 请把本机指纹 ' + st.fingerprint + ' 发给授权方换新授权',
            });
          }
          // 功能位: 采集/导出/图搜/利润 可按授权逐项开关
          const FEATURE_OF = [
            ['collect', '/api/collect/'], ['export', '/api/products/export'], ['search', '/api/sources'], ['profit', '/api/profit/'],
          ];
          for (const [feat, prefix] of FEATURE_OF) {
            if (p.startsWith(prefix) && st.enforce && !hasFeature(feat)) {
              return send(403, { error: '本授权不含「' + feat + '」功能', license: { features: st.features, customer: st.customer } });
            }
          }
        }
      }
      if (p === '/api/license/status' && req.method === 'GET') return send(200, licenseStatus());
      if (p === '/api/health') return send(200, { ok: true, time: now() });

  /* ===== 本地浏览器服务(第四期) ===== */
  /* 「服务器」页: 无头浏览器实时画面(JPEG base64, 用 clip.scale 缩小, 不动页面视口) */
  if (p === '/api/browser/shot' && req.method === 'GET') {
    return (async () => {
      const L = await localBrowserPages(true);
      if (!L.ok) return send(200, { ok: false, error: L.error });
      const port = L.port;
      const pages = L.pages;
      if (!pages.length) return send(200, { ok: false, error: '本地浏览器没有可用标签(先启动, 或跑一次采集)' });
      const tid = String(url.searchParams.get('tid') || '');
      const idx = tid
        ? Math.max(0, pages.findIndex((p) => p.id === tid))
        : Math.max(0, Math.min(pages.length - 1, parseInt(url.searchParams.get('i') || '0', 10) || 0));
      const scale = Math.max(0.2, Math.min(1, Number(url.searchParams.get('scale') || 0.5)));
      const q = Math.max(20, Math.min(90, parseInt(url.searchParams.get('q') || '55', 10) || 55));
      const pg = pages[idx];
      const cdp = await cdpGet(pg.webSocketDebuggerUrl);
      // ★ 2026-09-26: 按【真实视口】裁剪, 并把 vw/vh 带回去 —— 远程点击要靠它换算坐标
      let vw = 1440, vh = 900;
      const readViewport = async () => {
        try {
          const lm = await cdp('Page.getLayoutMetrics', {});
          const v = (lm && (lm.cssLayoutViewport || lm.layoutViewport)) || {};
          if (v.clientWidth) { vw = v.clientWidth; vh = v.clientHeight }
        } catch (e) {}
      };
      await readViewport();
      // ★ 2026-09-26 兜底: 视口被弄成 1×1(实测 Start-Process -WindowStyle Hidden 会这样) → 强制一个正常桌面视口
      if (vw < 200 || vh < 200) {
        try {
          await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
          vw = 1440; vh = 900;
          await readViewport();
        } catch (e) {}
      }
      let shot = null;
      try {
        const r = await cdp('Page.captureScreenshot', { format: 'jpeg', quality: q, captureBeyondViewport: false, clip: { x: 0, y: 0, width: vw, height: vh, scale: scale } });
        shot = r && r.data;
      } catch (e) {
        // 有些页面不支持 clip, 退回全尺寸
        const r2 = await cdp('Page.captureScreenshot', { format: 'jpeg', quality: q }).catch(() => null);
        shot = r2 && r2.data;
      }
      if (!shot) return send(200, { ok: false, error: '截图失败' });
      // ★ 2026-09-26 raw=1: 直接回 JPEG 字节 —— 服务器页的 <img src> 要的是图片, 不是 JSON
      //   (以前回 JSON 导致 naturalWidth=0, 画面被压成一条 19px)
      if (url.searchParams.get('raw') === '1') {
        const buf = Buffer.from(shot, 'base64');
        res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': buf.length, 'Cache-Control': 'no-store' });
        return res.end(buf);
      }
      return send(200, { ok: true, at: now(), i: idx, id: pg.id, total: pages.length, scale: scale, vw: vw, vh: vh, url: pg.url, title: (pg.title || '').slice(0, 80), data: 'data:image/jpeg;base64,' + shot });
    })().catch((e) => send(500, { error: String((e && e.message) || e) }));
  }
  /* 「服务器」页: MJPEG 连续流(顺滑的关键) —— 一个长连接持续推帧, <img> 直接显示 */
  if (p === '/api/browser/live' && req.method === 'GET') {
    return (async () => {
      const L = await localBrowserPages(false);
      if (!L.ok || !L.pages.length) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end(L.error || '没有可用标签') }
      const tid = String(url.searchParams.get('tid') || '');
      const pg = L.pages.filter((x) => x.id === tid)[0] || L.pages[0];
      const fps = Math.max(1, Math.min(15, parseInt(url.searchParams.get('fps') || '6', 10) || 6));
      const scale = Math.max(0.2, Math.min(1, Number(url.searchParams.get('scale') || 0.5)));
      const q = Math.max(20, Math.min(80, parseInt(url.searchParams.get('q') || '45', 10) || 45));
      // ★ 用【独立连接 + 事件推送】而不是复用连接轮询: screencast 只在页面变化时推帧, 顺得多
      const h = await cdpConnect(pg.webSocketDebuggerUrl);
      const send = h.send;
      let vw = 1440, vh = 900;
      const readVP = async () => { try { const lm = await send('Page.getLayoutMetrics', {}); const v = (lm && (lm.cssLayoutViewport || lm.layoutViewport)) || {}; if (v.clientWidth) { vw = v.clientWidth; vh = v.clientHeight } } catch (e) {} };
      await readVP();
      if (vw < 200 || vh < 200) { try { await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }); vw = 1440; vh = 900; await readVP() } catch (e) {} }
      req.setTimeout(0); res.setTimeout(0);
      res.writeHead(200, { 'Content-Type': 'multipart/x-mixed-replace; boundary=frame', 'Cache-Control': 'no-store, no-cache', 'Connection': 'close' });
      let alive = true;
      const stop = () => { alive = false };
      res.on('close', stop); res.on('error', stop); req.on('aborted', stop);
      const w = (chunk) => new Promise((resolve) => {
        // ★ 客户端可能在任意一刻断开: 这里必须自己吞掉 EPIPE(否则进程直接退出, 之前就是这么挂的)
        try {
          if (res.destroyed || res.writableEnded) return resolve(false);
          if (res.write(chunk)) return resolve(true);
          let done = false;
          res.once('drain', () => { if (!done) { done = true; resolve(true) } });
          setTimeout(() => { if (!done) { done = true; resolve(false) } }, 3000);
        } catch (e) { resolve(false) }
      });
      // 帧队列: screencast 推一帧 → 排一帧 → 按 fps 上限节流发出(避免把浏览器压死)
      let queue = null, lastSent = 0, sending = false;
      const pump = async () => {
        if (sending) return;
        sending = true;
        while (alive) {
          if (!queue) { sending = false; return }
          const wait = Math.max(0, Math.round(1000 / fps) - (Date.now() - lastSent));
          if (wait) await new Promise((r2) => setTimeout(r2, wait));
          if (!alive) break;
          const buf = queue; queue = null; lastSent = Date.now();
          let ok = await w('--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ' + buf.length + '\r\n\r\n');
          if (ok) ok = await w(buf);
          if (ok) ok = await w('\r\n');
          if (!ok) break;
        }
        sending = false;
      };
      h.on('Page.screencastFrame', (p) => {
        if (!alive) return;
        try { queue = Buffer.from(p.data, 'base64') } catch (e) { return }
        // 立刻 ack, 浏览器才会继续推下一帧
        try { send('Page.screencastFrameAck', { sessionId: p.sessionId }) } catch (e) {}
        pump();
      });
      const maxW = Math.max(320, Math.round(vw * scale)), maxH = Math.max(240, Math.round(vh * scale));
      await send('Page.startScreencast', { format: 'jpeg', quality: q, maxWidth: maxW, maxHeight: maxH, everyNthFrame: 1 });
      // 兜底: 浏览器长时间不推帧(静止页面)时, 每 2 秒补一帧, 保证画面不"死"
      while (alive) {
        await new Promise((r2) => setTimeout(r2, 2000));
        if (!alive) break;
        if (Date.now() - lastSent > 2500) {
          try {
            const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: q, captureBeyondViewport: false, clip: { x: 0, y: 0, width: vw, height: vh, scale: scale } });
            if (r && r.data) { queue = Buffer.from(r.data, 'base64'); lastSent = Date.now() - 500; pump() }
          } catch (e) {}
        }
      }
      try { await send('Page.stopScreencast', {}) } catch (e) {}
      try { h.ws.close() } catch (e) {}
      try { res.end() } catch (e) {}
    })().catch(() => { try { res.end() } catch (e) {} });
  }

  /* 「服务器」页: 标签管理(新建/关闭/前置/复制) —— 让它像个真浏览器 */
  if (p === '/api/browser/tab' && req.method === 'GET') {
    return (async () => {
      const st = await browserSvc.status();
      if (!st || !st.running || !st.port) return send(200, { ok: false, error: '本地浏览器没在跑(先点「启动无头」)' });
      const op = String(url.searchParams.get('op') || '');
      const tid = String(url.searchParams.get('tid') || '');
      const port = st.port;
      const nice = async () => {
        const L = await localBrowserPages(false);
        return (L.ok ? L.pages : []).map((x) => ({ id: x.id, title: (x.title || '').slice(0, 80), url: x.url }));
      };
      if (op === 'new') {
        const u = String(url.searchParams.get('url') || 'about:blank');
        await browserSvc.openPage(u, port);
        await new Promise((r) => setTimeout(r, 2500));
        pushActivity('browser', '新开标签: ' + u.slice(0, 80));
        return send(200, { ok: true, op: op, pages: await nice() });
      }
      if (op === 'dup') {
        const cur = (await browserSvc.listPages(port)).find((x) => x.id === tid);
        const u = (cur && cur.url) || 'about:blank';
        await browserSvc.openPage(u, port);
        await new Promise((r) => setTimeout(r, 2500));
        pushActivity('browser', '复制标签: ' + String(u).slice(0, 80));
        return send(200, { ok: true, op: op, pages: await nice() });
      }
      if (op === 'close') {
        if (!tid) return send(400, { error: 'close 需要 tid' });
        const cur = (await browserSvc.listPages(port)).find((x) => x.id === tid);
        await new Promise((resolve) => {
          const req2 = http.request({ host: '127.0.0.1', port: port, path: '/json/close/' + encodeURIComponent(tid), method: 'GET', timeout: 5000 }, (r2) => { r2.resume(); r2.on('end', resolve) });
          req2.on('error', resolve); req2.on('timeout', () => { req2.destroy(); resolve() }); req2.end();
        });
        pushActivity('browser', '关闭标签: ' + String((cur && cur.url) || tid).slice(0, 80));
        await new Promise((r) => setTimeout(r, 900));   // ★ 关标签是异步的, 等一下再列(否则列表是旧快照)
        return send(200, { ok: true, op: op, pages: await nice() });
      }
      if (op === 'activate') {
        if (!tid) return send(400, { error: 'activate 需要 tid' });
        const cur = (await browserSvc.listPages(port)).find((x) => x.id === tid);
        if (cur) { try { const { send: cdp } = await cdpConnect(cur.webSocketDebuggerUrl); await cdp('Page.bringToFront', {}) } catch (e) {} }
        return send(200, { ok: true, op: op, pages: await nice() });
      }
      if (op === 'list') return send(200, { ok: true, op: op, pages: await nice() });
      return send(400, { error: 'op 只能是 new/close/activate/dup/list' });
    })().catch((e) => send(500, { error: String((e && e.message) || e) }));
  }

  /* 「服务器」页: 远程操作无头浏览器(CDP 真实输入事件) */
  if (p === '/api/browser/input' && req.method === 'GET') {
    return (async () => {
      const L = await localBrowserPages();
      if (!L.ok) return send(200, { ok: false, error: L.error });
      const port = L.port;
      const pages = L.pages;
      if (!pages.length) return send(200, { ok: false, error: '没有可用标签' });
      const tid = String(url.searchParams.get('tid') || '');
      const i = tid
        ? Math.max(0, pages.findIndex((p) => p.id === tid))
        : Math.max(0, Math.min(pages.length - 1, parseInt(url.searchParams.get('i') || '0', 10) || 0));
      const type = String(url.searchParams.get('type') || '');
      const pg = pages[i];
      const { send: cdp } = await cdpConnect(pg.webSocketDebuggerUrl);
      let out = { ok: true, type: type, i: i };
      try { await cdp('Page.bringToFront', {}) } catch (e) {}     // 让输入进到正确标签
      if (type === 'click') {
        const x = Number(url.searchParams.get('x') || 0), y = Number(url.searchParams.get('y') || 0);
        const btn = String(url.searchParams.get('button') || 'left');
        await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x, y: y, button: 'none' });
        await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: x, y: y, button: btn, clickCount: 1 });
        await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x, y: y, button: btn, clickCount: 1 });
        out.x = x; out.y = y;
      } else if (type === 'move') {
        await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Number(url.searchParams.get('x') || 0), y: Number(url.searchParams.get('y') || 0), button: 'none' });
      } else if (type === 'wheel') {
        const x = Number(url.searchParams.get('x') || 0), y = Number(url.searchParams.get('y') || 0);
        const dy = Math.max(-3000, Math.min(3000, Number(url.searchParams.get('dy') || 0)));
        await cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x: x, y: y, deltaX: 0, deltaY: dy, button: 'none' });
        out.dy = dy;
      } else if (type === 'text') {
        const text = String(url.searchParams.get('text') || '').slice(0, 800);
        if (!text) return send(400, { error: 'text 为空' });
        await cdp('Input.insertText', { text: text });
        out.text = text;
      } else if (type === 'key') {
        const key = String(url.searchParams.get('key') || '');
        const M = {
          Enter: [13, 'Enter'], Tab: [9, 'Tab'], Escape: [27, 'Escape'], Backspace: [8, 'Backspace'], Delete: [46, 'Delete'],
          ArrowUp: [38, 'ArrowUp'], ArrowDown: [40, 'ArrowDown'], ArrowLeft: [37, 'ArrowLeft'], ArrowRight: [39, 'ArrowRight'],
          Home: [36, 'Home'], End: [35, 'End'], PageDown: [34, 'PageDown'], PageUp: [33, 'PageUp'], ' ': [32, 'Space'],
        };
        if (!M[key]) return send(400, { error: '不支持的按键: ' + key });
        const [kc, code] = M[key];
        const base = { key: key, code: code, windowsVirtualKeyCode: kc, nativeVirtualKeyCode: kc };
        await cdp('Input.dispatchKeyEvent', Object.assign({ type: 'rawKeyDown' }, base));
        if (key === 'Enter' || key === 'Tab' || key === ' ') {
          await cdp('Input.dispatchKeyEvent', Object.assign({ type: 'char', text: (key === 'Enter' ? '\r' : (key === 'Tab' ? '\t' : ' ')) }, base));
        }
        await cdp('Input.dispatchKeyEvent', Object.assign({ type: 'keyUp' }, base));
        out.key = key;
      } else if (type === 'nav') {
        const u = String(url.searchParams.get('url') || '').trim();
        if (!/^https?:\/\//.test(u)) return send(400, { error: 'url 必须以 http(s):// 开头' });
        await cdp('Page.navigate', { url: u });
        out.url = u;
      } else if (type === 'back' || type === 'forward') {
        await cdp('Runtime.evaluate', { expression: type === 'back' ? 'history.back()' : 'history.forward()' });
      } else if (type === 'reload') {
        await cdp('Page.reload', { ignoreCache: false });
      } else {
        return send(400, { error: 'type 只能是 click/move/wheel/text/key/nav/back/forward/reload' });
      }
      if (type === 'nav' || type === 'text' || type === 'key' || type === 'click') {
        pushActivity('input', ({ nav: '打开 ' + out.url, text: '输入文本(' + String(out.text || '').length + ' 字)', key: '按键 ' + out.key, click: '点击 (' + out.x + ',' + out.y + ')' })[type] || type,
          { page: (pg.title || '').slice(0, 60) });
      }
      return send(200, out);
    })().catch((e) => send(500, { error: String((e && e.message) || e) }));
  }

  /* 「服务器」页: 活动流水 */
  if (p === '/api/browser/activity' && req.method === 'GET') {
    const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') || '60', 10) || 60));
    return send(200, { ok: true, total: browserActivity.length, items: browserActivity.slice(-limit).reverse() });
  }
  /* 「服务器」页: 桌面浏览器壳(Electron) —— 真窗口, 不串流
   * 为什么要它: 面板流走 Chrome 的 Page.startScreencast, 实测硬上限 ~14fps(换分辨率/显卡/窗口模式都没用)。
   *   想要"像自己用浏览器一样"顺滑, 只有不串流 —— 那个壳里的浏览器是原生控件, 实测滚动 89fps。
   * 注意: 壳有自己的 profile, 登录态要在壳里重登一次; 自研采集插件是壳里本地加载的。
   */
  if (p === '/api/browser/shell') {
    const SHELL_DIR = shellDirOf();
    const SHELL_PORT = 9334;
    const shellExe = path.join(SHELL_DIR, 'node_modules', 'electron', 'dist', 'electron.exe');
    const probeShell = () => new Promise((resolve) => {
      const rq = http.request({ host: '127.0.0.1', port: SHELL_PORT, path: '/json/version', method: 'GET', timeout: 2500 }, (rs) => {
        let d = ''; rs.on('data', (c) => d += c);
        rs.on('end', () => { try { resolve(JSON.parse(d)) } catch (e) { resolve(null) } });
      });
      rq.on('error', () => resolve(null)); rq.on('timeout', () => { rq.destroy(); resolve(null) }); rq.end();
    });
    const action = String(url.searchParams.get('action') || '');
    return (async () => {
      if (action === 'start') {
        if (!fs.existsSync(shellExe)) return send(200, { ok: false, error: '没找到 Electron: ' + shellExe + ' (先在 zying-browser-shell 目录跑 npm.cmd install)' });
        if (await probeShell()) return send(200, { ok: true, already: true, port: SHELL_PORT });
        // ★ 必须清掉 ELECTRON_RUN_AS_NODE: DSH 环境里带着它, 不清掉 electron.exe 会被当普通 node 跑,
        //   不报错但窗口永远不出来(实测踩过)。用 Remove-Item 真删掉, 置空字符串不算(原生层看的是"变量在不在")。
        const ps = "Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue;"
          + " Start-Process -FilePath " + JSON.stringify(shellExe) + " -ArgumentList @(" + JSON.stringify(SHELL_DIR) + ")"
          + " -WorkingDirectory " + JSON.stringify(SHELL_DIR) + " -PassThru | Select-Object -ExpandProperty Id";
        const pid = await new Promise((resolve) => {
          require('child_process').execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, timeout: 25000 }, (e, out) => {
            if (e) return resolve(null);
            const n = parseInt(String(out).trim(), 10);
            resolve(isNaN(n) ? null : n);
          });
        });
        pushActivity('browser', '启动桌面浏览器壳 (Electron)');
        for (let i = 0; i < 30; i++) { await new Promise((r) => setTimeout(r, 500)); if (await probeShell()) break }
        const v = await probeShell();
        return send(200, { ok: !!v, started: !!v, pid: pid, port: SHELL_PORT, browser: v && v.Browser, error: v ? null : '起来了但 CDP 没应(可能 Electron 没装好)' });
      }
      if (action === 'stop') {
        // 只杀【命令行里带这个壳目录】的 electron.exe —— 别误伤别的 Electron 应用(和之前那个 PID 教训同理)
        const ps = "$p = Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\" | Where-Object { $_.CommandLine -like '*zying-browser-shell*' };"
          + " foreach ($x in $p) { taskkill /PID $($x.ProcessId) /T /F | Out-Null };"
          + " ($p | Measure-Object).Count";
        const killed = await new Promise((resolve) => {
          require('child_process').execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, timeout: 20000 }, (e, out) => resolve(e ? -1 : parseInt(String(out).trim(), 10) || 0));
        });
        pushActivity('browser', '停止桌面浏览器壳 (关了 ' + killed + ' 个进程)');
        await new Promise((r) => setTimeout(r, 1500));
        return send(200, { ok: true, killed: killed, running: !!(await probeShell()) });
      }
      const v = await probeShell();
      const st = { ok: true, running: !!v, port: SHELL_PORT, browser: v ? v.Browser : null, dir: SHELL_DIR, hasExe: fs.existsSync(shellExe) };
      if (url.searchParams.get('ui') === '1' || String(req.headers.accept || '').indexOf('text/html') >= 0) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.end('<!doctype html><meta charset="utf-8"><title>智赢浏览器壳</title>'
          + '<body style="font:14px/1.6 system-ui;background:#16181d;color:#e8e8ea;padding:40px;text-align:center">'
          + '<div style="font-size:34px">' + (st.running ? '🖥' : '⏹') + '</div>'
          + '<div style="margin-top:8px">桌面浏览器壳: ' + (st.running ? '正在运行' : '没在运行') + '</div>'
          + '<div style="color:#9a9a9a;font-size:12px;margin-top:6px">关闭本页即可</div></body>');
      }
      return send(200, st);
    })().catch((e) => send(500, { error: String((e && e.message) || e) }));
  }

  if (p === '/api/browser/status' && req.method === 'GET') {
    // ★ 2026-09-26: 插件侧经 DSH 网关只能调通这个路径(专用的 /start /stop /switch 到不了 ERP, 实测),
    //   所以 启动/停止/切换 也挂在这里: /api/browser/status?action=start|stop|user|auto&mode=headless
    const action = String(url.searchParams.get('action') || '');
    if (action) {
      if (action === 'start') {
        const mode = url.searchParams.get('mode') || 'headless';
        // ★ 2026-09-26: 允许带额外启动参数(空格分隔), 用来试 GPU 加速等开关
        //   实测本机无头默认是 SwANGLE 软件渲染(Microsoft Basic Render Driver), screencast 只有 ~13.5fps;
        //   带上 --use-angle=d3d11 之类才有机会用上真显卡。
        const extra = String(url.searchParams.get('args') || '').split(/\s+/).filter(Boolean);
        browserSvc.start({ mode: mode, extraArgs: extra.length ? extra : undefined })
          .then((r) => { browserSvcLastErr = r && r.ok ? null : ((r && r.error) || '启动失败') })
          .catch((e) => { browserSvcLastErr = String((e && e.message) || e); });
        pushActivity('browser', '启动本地浏览器 (' + mode + (extra.length ? (' + ' + extra.join(' ')) : '') + ')');
      } else if (action === 'stop') {
        browserSvc.stop().then(() => { browserSvcLastErr = null }).catch((e) => { browserSvcLastErr = String((e && e.message) || e) });
        pushActivity('browser', '停止本地浏览器');
      } else if (action === 'user') { cdpPortOverride = 'user'; pushActivity('browser', '切到用户的采集浏览器 (9222)'); }
      else if (action === 'shell') {
        /* ★ 2026-09-28 用户要求: 采集面板里的「打开本地无头」可以直接改成【打开浏览器壳】——
         *   壳 = Electron 桌面窗口(CDP 9334, 原生渲染不串流), 采集直接跑在它里面:
         *   你能看见它在翻页, 验证码/登录也能人工接手; 代价是和你手动操作抢标签页。
         *   为什么挂在 status?action 上: 插件侧经 DSH 网关只有这个路径能到 ERP(实测)。 */
        cdpPortOverride = 'shell';
        shellEnsureStart();
        pushActivity('browser', '采集浏览器 → 桌面浏览器壳 (CDP ' + SHELL_CDP_PORT + ')');
      }
      else if (action === 'shellstop') {
        cdpPortOverride = null;
        shellEnsureStop();
        pushActivity('browser', '停止桌面浏览器壳, 采集回落到本地无头');
      }
      else if (action === 'auto' || action === 'local') { cdpPortOverride = null; pushActivity('browser', '切回本地无头浏览器'); }
      else return send(400, { error: 'action 只能是 start / stop / user / auto / shell / shellstop' });
    }
    // ui=1(新标签页直连过来) 就回一个小页面并自动关闭 —— 绕开 DSH 网关的限制
    if (action && (url.searchParams.get('ui') === '1' || String(req.headers.accept || '').indexOf('text/html') >= 0)) {
      const label = { start: '启动本地浏览器', stop: '停止本地浏览器', user: '改用你的采集浏览器', auto: '切回本地无头浏览器', local: '切回本地无头浏览器' }[action] || action;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.end('<!doctype html><meta charset="utf-8"><title>智赢ERP · ' + label + '</title>' +
        '<body style="font:14px/1.6 system-ui;background:#16181d;color:#e8e8ea;padding:40px;text-align:center">' +
        '<div style="font-size:34px">✅</div><div style="margin-top:8px">已请求「' + label + '」</div>' +
        '<div style="color:#9a9a9a;font-size:12px;margin-top:6px">这个标签页会自动关闭 · 结果看采集面板右上角的状态条</div>' +
        '<script>setTimeout(function(){ try{ window.close() }catch(e){} }, 1200)</script></body>');
    }
    return browserSvc.status().then(async (st) => {
      const port = await activeCdpPort();
      try {
        const L = await localBrowserPages();          // ★ 服务器页只看本地浏览器自己的标签
        st.pages = L.ok ? L.pages.map((p) => ({ id: p.id, title: (p.title || '').slice(0, 80), url: p.url })) : [];
        st.pagesError = L.ok ? null : L.error;
      } catch (e) { st.pages = []; }
      send(200, Object.assign({}, st, { activePort: port, usingLocal: !!(st.running && st.port === port), userPort: CDP_PORT_USER, override: cdpPortOverride, lastError: browserSvcLastErr }));
    }).catch((e) => send(500, { error: String(e && e.message || e) }));
  }
  // ★ 2026-09-26: 同时支持 GET —— 插件侧的 POST 经 DSH 网关会卡住(实测), GET 正常。
  //   这几个是本地控制接口, 幂等, 用 GET 没有副作用问题。
  if (p === '/api/browser/start' && (req.method === 'POST' || req.method === 'GET')) {
    /* 不指定 mode → 用记住的窗口形态(见 browserPrefMode): 用户把形态设成"可见窗口"后, 以后启动就是这个窗口 */
    const mode = j.mode || url.searchParams.get('mode') || browserPrefMode();
    const portQ = j.port || url.searchParams.get('port') || undefined;
    // ★ 启动要 5~15 秒, 而插件侧经网关的请求等不了那么久(实测会卡住) →
    //   这里立即回 starting:true, 真正启动在后台跑; 界面靠 /api/browser/status 轮询看到结果。
    browserSvc.start({ mode: mode, port: portQ ? Number(portQ) : undefined })
      .then((r) => { browserSvcLastErr = r && r.ok ? null : ((r && r.error) || '启动失败'); })
      .catch((e) => { browserSvcLastErr = String((e && e.message) || e); });
    return send(200, { ok: true, starting: true, mode: mode, port: portQ ? Number(portQ) : browserSvc.DEFAULT_PORT });
  }
  /* 切换采集浏览器的窗口形态(无头 / 离屏 / 可见窗口) —— 会记住, 正在跑就自动重启换形态。
   *   ★ GET(不带 mode) 只是【读】, 绝不能顺手把偏好写成默认值(实测踩过: 面板每次读一次就把 visible 冲回 headless)。 */
  if (p === '/api/browser/mode' && (req.method === 'POST' || req.method === 'GET')) {
    const want = String(j.mode || url.searchParams.get('mode') || '').trim();
    if (!want) return send(200, { ok: true, mode: browserPrefMode(), restarting: false, readOnly: true });
    const mode = (want === 'offscreen' || want === 'visible') ? want : 'headless';
    const force = j.force === true || url.searchParams.get('force') === '1';
    return browserSvc.status().then(function (st) {
      const needRestart = !!(st && st.running && st.mode !== mode);
      if (needRestart) {
        /* ★ 2026-09-27 护栏: 换形态要【重启浏览器】, 正在采集时这么做会把这一轮打断(实测踩过:
         *   我自己重启后端+换形态, 把用户跑了半小时的批量跟卖打断了, 未落盘的新商品全丢)。
         *   所以正有采集在跑时一律拒绝, 除非显式 force=1。
         *   ★ 拒绝时【绝不能】把偏好也改掉 —— 实测踩过: 先落偏好再判断, 结果"被拒绝"却把记忆改成了被拒的那个值。 */
        if (collectProgress && collectProgress.running && !force) {
          return send(200, { ok: false, busy: true, mode: browserPrefMode(), prevMode: st.mode,
            error: '正有采集在跑(' + (collectProgress.label || collectProgress.mode || '采集') + (collectProgress.added != null ? (', 已入库 ' + collectProgress.added + ' 个') : '') + ') —— 换窗口形态会重启浏览器并打断它。请先点「⏹ 停止」, 或等它跑完再换。' });
        }
        pushActivity('browser', '采集浏览器窗口形态改为 ' + mode + ' (重启中)');
      }
      setBrowserPrefMode(mode);                      // 真的要走这一步了才落偏好
      if (needRestart) {
        browserSvc.stop()
          .then(() => browserSvc.start({ mode: mode }))
          .then((r) => { browserSvcLastErr = r && r.ok ? null : ((r && r.error) || '启动失败') })
          .catch((e) => { browserSvcLastErr = String((e && e.message) || e) });
        return send(200, { ok: true, mode: mode, restarting: true, prevMode: st.mode });
      }
      pushActivity('browser', '采集浏览器窗口形态 = ' + mode);
      return send(200, { ok: true, mode: mode, restarting: false });
    }).catch((e) => send(500, { error: String(e && e.message || e) }));
  }
  /* 把采集浏览器窗口调到前台 —— "点开就能看到采集在跑"。无头模式没有窗口, 会明确告知。 */
  if (p === '/api/browser/focus' && (req.method === 'POST' || req.method === 'GET')) {
    return (async () => {
      try {
        const st = await browserSvc.status();
        if (!st || !st.running) return send(200, { ok: false, error: '采集浏览器没在跑 —— 先点「🪟 打开采集窗口」' });
        if (st.mode === 'headless') return send(200, { ok: false, error: '当前是【无头】形态(屏幕上没有窗口) —— 把窗口形态改成「可见窗口」再打开' });
        let cdpOk = false, winOk = false;
        try {
          const L = await localBrowserPages();
          const pg = (L.pages || [])[0];
          if (pg && pg.webSocketDebuggerUrl) {
            const { send: cdpSend } = await cdpConnect(pg.webSocketDebuggerUrl);
            await cdpSend('Page.bringToFront', {});
            cdpOk = true;
          }
        } catch (e) {}
        /* 窗口被最小化时 CDP 提不上来 → 再用 PowerShell 把那个 msedge 主窗口激活一次 */
        try {
          const ps = '$p=Get-Process -Id ' + Number(st.pid) + ' -ErrorAction SilentlyContinue; ' +
            'if($p -and $p.MainWindowHandle -ne 0){ (New-Object -ComObject WScript.Shell).AppActivate(' + Number(st.pid) + ') | Out-Null; "ok" } else { "nowin" }';
          winOk = await new Promise((resolve) => {
            require('child_process').execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 8000, windowsHide: true },
              (e, out) => resolve(!e && String(out || '').trim() === 'ok'));
          });
        } catch (e) {}
        return send(200, { ok: cdpOk || winOk, cdp: cdpOk, window: winOk, mode: st.mode, pid: st.pid, port: st.port });
      } catch (e) { return send(500, { error: String(e && e.message || e) }) }
    })();
  }
  if (p === '/api/browser/stop' && (req.method === 'POST' || req.method === 'GET')) {
    return browserSvc.stop().then((r) => send(200, r)).catch((e) => send(500, { error: String(e && e.message || e) }));
  }
  if (p === '/api/browser/switch' && (req.method === 'POST' || req.method === 'GET')) {
    const t = String(j.target || url.searchParams.get('target') || '');
    if (t === 'user') cdpPortOverride = 'user';
    else if (t === 'local' || t === 'auto') cdpPortOverride = null;
    else if (/^\d+$/.test(t)) cdpPortOverride = Number(t);
    else return send(400, { error: "target 只能是 user / local / auto / 端口号" });
    return activeCdpPort().then((port) => send(200, { ok: true, target: t, activePort: port }));
  }

      // ---- AI 对话 (工作台): 代理到 OpenAI 兼容 Chat Completions (DeepSeek/OpenAI/自建), 配置存后端 ----
      if (p === '/api/ai/config' && req.method === 'GET') {
        return send(200, { name: aiConfig.name || '', baseURL: aiConfig.baseURL || '', model: aiConfig.model || '', configured: !!(aiConfig.apiKey), apiKeyMasked: aiConfig.apiKey ? 'sk-' + String(aiConfig.apiKey).slice(-4) : '' });
      }
      if (p === '/api/ai/config' && req.method === 'POST') {
        if (j.name != null) aiConfig.name = String(j.name).trim();
        if (j.baseURL != null) aiConfig.baseURL = String(j.baseURL).trim().replace(/\/+$/, '');
        if (j.model != null) aiConfig.model = String(j.model).trim();
        if (j.apiKey != null && j.apiKey !== '') aiConfig.apiKey = String(j.apiKey).trim();
        if (j.clearKey === true) aiConfig.apiKey = '';
        save('ai-config.json', aiConfig);
        return send(200, { ok: true, configured: !!(aiConfig.apiKey), apiKeyMasked: aiConfig.apiKey ? 'sk-' + String(aiConfig.apiKey).slice(-4) : '' });
      }
      if (p === '/api/ai/chat' && req.method === 'POST') {
        try {
          // 断线/超时自动重连 (最多4次尝试, 指数退避); 单次45s
          const content = await callAI(Array.isArray(j.messages) ? j.messages : [], { timeoutMs: 45000 });
          return send(200, { content });
        } catch (e) {
          return send(500, { error: 'AI 调用失败: ' + (e && e.message || String(e)) });
        }
      }

      // ---- 采集停止控制 ----
      // 任何采集接口(除 stop 外)开始前清空上次停止标志 → 停止后下一次采集正常开始
      // 注意: 仅当当前没有采集在运行时才重置, 否则排队/晚到的请求会清掉用户刚按下的停止标志,
      // 导致"按了停止但采集仍在跑" (stop 请求设置 collectStop=true 后被后续请求 reset)
      // 并注册实时进度 (mode 对应前端采集方式卡片)
      // ★ 守卫放行名单(坑 30): 下面这几个 POST 不是"开始采集" —— 它们只是改任务状态。
      //   不加进来会被守卫自己的 409 拦掉, 表现为"采集忙的时候连「重跑失败」都点不了"。
      //   ★ 路线 B: ingest-push 也在此列 —— 它是「扩展推数据进来」, 不驱动 CDP、瞬间完成,
      //     若让守卫给它注册 running 进度, 它返回 200 后无人清理 → 下一次真实采集被自己的守卫 409 拦掉 (实测)。
      const GUARD_SKIP = new Set(['/api/collect/stop', '/api/collect/link-job/retry', '/api/collect/link-job/remove', '/api/collect/ingest-push']);
      if (req.method === 'POST' && p.startsWith('/api/collect/') && !GUARD_SKIP.has(p)) {
        const busy = !!(collectProgress && collectProgress.running);
        if (busy) {
          // 已有采集在运行: 拒绝新请求, 避免叠加任务或清掉用户刚按下的停止标志
          return send(409, { error: '已有采集正在运行 (mode=' + (collectProgress.mode || '?') + '), 请先点「停止」等当前步骤结束后再开始' });
        }
        // 无采集在运行 → 清空上次停止标志, 正常开始新采集
        resetCollectStop();
        const MAP = {
          '/api/collect/category': ['category', '类目搜索采集'],
          '/api/collect/shop-list': ['shop-list', '店铺列表采集'],
          '/api/collect/brand-batch': ['brand-batch', '批量品牌采集'],
          '/api/collect/site-bulk': ['bulk', '并行整站采集'],
          '/api/collect/category-menu': ['catmenu', '类目菜单采集'],
          '/api/collect/follow-shop-batch': ['batch', '批量跟卖店铺采集'],
          '/api/collect/follow-shop-aod': ['aod', '商品跟卖并行采集'],
          '/api/collect/follow-shop-rounds': ['parallel', '多商品并行采集'],
          '/api/collect/list-direct': ['list-direct', '列表页直采'],
          '/api/collect/list-filtered': ['list-filtered', '列表页筛选采集'],
          // 多链接采集（坑 #29：新路由必须加进守卫 MAP，否则守卫不会注册进度）
          '/api/collect/shop-links': ['shoplinks', '多链接采集'],
          '/api/collect/links': ['shoplinks', '多链接采集'],
        };
        const [mode, label] = MAP[p] || ['collect', '采集'];
        beginCollectProgress(mode, label);
      }
      if (p === '/api/collect/stop' && req.method === 'POST') {
        collectStop = true;
        return send(200, { ok: true, stopped: true, msg: '已请求停止采集, 当前步骤完成后将停止' });
      }
      if (p === '/api/collect/status' && req.method === 'GET') {
        return send(200, { stopRequested: collectStopRequested() });
      }
      if (p === '/api/collect/progress' && req.method === 'GET') {
        return send(200, collectProgress || { running: false });
      }
      // 采集记录 (历史批次): 按商品 collectedAt 聚合 — 相邻入库间隔 < 30 分钟视为同一次采集
      // 返回每次采集的起止时间(UTC, 精确到分钟) + 商品数量, 供采集面板"采集记录"加载历史并可点击跳转商品管理
      if (p === '/api/collect/logs' && req.method === 'GET') {
        const gapMin = Math.max(1, parseInt(url.searchParams.get('gap') || '30', 10) || 30);
        const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10) || 50));
        const stamped = products
          .map((x) => ({ t: String(x.collectedAt || ''), site: x.site, source: x.source, asin: x.asin }))
          .filter((x) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(x.t))
          .map((x) => { const p2 = x.t.split(/[- :]/); return { ...x, ms: Date.UTC(+p2[0], +p2[1] - 1, +p2[2], +p2[3], +p2[4], +p2[5]) }; })
          .filter((x) => isFinite(x.ms))
          .sort((a, b) => a.ms - b.ms);
        const batches = [];
        let cur = null;
        for (const x of stamped) {
          if (!cur || x.ms - cur.lastMs > gapMin * 60000) {
            cur = { from: x.t, to: x.t, lastMs: x.ms, items: [] };
            batches.push(cur);
          }
          cur.lastMs = x.ms; cur.to = x.t; cur.items.push(x);
        }
        const logs = batches.map((b) => {
          const sites = {}; const sources = {};
          b.items.forEach((x) => { if (x.site) sites[x.site] = (sites[x.site] || 0) + 1; if (x.source) sources[x.source] = (sources[x.source] || 0) + 1; });
          const topSource = Object.keys(sources).sort((a, z) => sources[z] - sources[a])[0] || '';
          const SRC_NAME = { 'cdp-follow-shop': '跟卖店铺采集', 'cdp-list-direct': '列表页直采', 'cdp-list-filtered': '列表页筛选采集', 'category-search': '类目搜索采集', 'brand-batch': '批量品牌采集', 'site-bulk': '并行整站采集', 'category-menu': '类目菜单采集', 'cdp-shop-list': '店铺列表采集', 'cdp-panel': '店铺面板采集', search: '搜索采集' };
          return {
            from: b.from.slice(0, 16), to: b.to.slice(0, 16), count: b.items.length,
            sites, source: topSource, name: (SRC_NAME[topSource] || topSource || '历史采集') + (Object.keys(sites).length ? ' · ' + Object.keys(sites).join('/') : ''),
            asins: b.items.slice(0, 5).map((x) => x.asin),
          };
        }).sort((a, z) => (a.from < z.from ? 1 : -1));
        return send(200, { total: logs.length, gapMinutes: gapMin, logs: logs.slice(0, limit) });
      }

      // ---- 采集报告 (持久化明细: 店铺/品牌/剔除他牌/过滤条件/错误) ----
      // 列表: 只给概览, 供界面列出; 明细: 按 id, 或按「采集记录」批次的时间窗 from/to 反查
      if (p === '/api/collect/reports' && req.method === 'GET') {
        const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10) || 50));
        return send(200, { total: collectReports.length, file: 'collect-reports.json', reports: collectReports.slice(0, limit).map(reportBrief) });
      }
      if (p === '/api/collect/report' && req.method === 'GET') {
        const id = url.searchParams.get('id');
        if (id) {
          const r = collectReports.find((x) => x.id === id);
          return r ? send(200, { ok: true, count: 1, reports: [r] }) : send(404, { ok: false, error: '没有这条采集报告: ' + id });
        }
        const from = url.searchParams.get('from') || url.searchParams.get('fromUtc');
        const to = url.searchParams.get('to') || url.searchParams.get('toUtc');
        if (!from || !to) {
          const latest = collectReports[0] || null;
          return send(200, { ok: true, count: latest ? 1 : 0, reports: latest ? [latest] : [], note: '未给 from/to, 返回最近一条报告' });
        }
        const hit = findCollectReports(from, to);
        return send(200, { ok: true, count: hit.length, reports: hit, from, to });
      }

      // ---- 采集过滤规则 (保存/加载/删除) ----
      // 过滤规则: 返回时附带 canonical (统一过滤条件) — 旧规则(legacy filter* 字段)自动换算, 前端只认 canonical
      if (p === '/api/collect-rules' && req.method === 'GET') {
        const rules = collectRules.map((r) => {
          const filt = r.filter || {};
          return Object.assign({}, r, { canonical: looksCanonical(filt) ? normFilter(filt) : legacyToCanonical(filt) });
        });
        return send(200, { total: rules.length, rules });
      }
      if (p === '/api/collect-rules' && req.method === 'POST') {
        const name = String(j.name || '').trim();
        if (!name) return send(400, { error: '规则名称不能为空' });
        // 统一存储 canonical 形态 (前端面板直接读写同一 schema)
        const filt = j.filter && typeof j.filter === 'object' ? j.filter : {};
        const isCanonical = looksCanonical(filt);   // ★ extpush5: 见 looksCanonical 注释
        const rule = {
          name,
          site: String(j.site || 'de'),
          filter: isCanonical ? normFilter(filt) : legacyToCanonical(filt),
          params: j.params && typeof j.params === 'object' ? j.params : {},
          updatedAt: now(),
        };
        const idx = collectRules.findIndex((r) => r.name === name);
        if (idx >= 0) collectRules[idx] = rule; else collectRules.unshift(rule);
        save('collect-rules.json', collectRules);
        return send(200, { ok: true, total: collectRules.length, rule });
      }
      if (p === '/api/collect-rules/delete' && req.method === 'POST') {
        const name = String(j.name || '').trim();
        const before = collectRules.length;
        collectRules = collectRules.filter((r) => r.name !== name);
        if (collectRules.length === before) return send(404, { error: '规则不存在: ' + name });
        save('collect-rules.json', collectRules);
        return send(200, { ok: true, total: collectRules.length });
      }

      // ---- 商品库数据分析 (AI 分析/排行用) ----
      if (p === '/api/products/analyze' && req.method === 'GET') {
        const total = products.length;
        const countBy = (fn) => { const m = {}; products.forEach((x) => { const k = fn(x); if (k) m[k] = (m[k] || 0) + 1; }); return Object.entries(m).sort((a, b) => b[1] - a[1]); };
        const bySite = countBy((x) => x.site);
        const byFulfill = countBy((x) => x.amazonSell ? 'AMZ' : x.fulfill);
        const byCategory = countBy((x) => (x.category || '').split('>').pop().trim()).slice(0, 15);
        const byBrand = countBy((x) => x.brand && x.brand !== 'Unknown' ? x.brand : null).slice(0, 15);
        const priceBuckets = { '<10': 0, '10-30': 0, '30-100': 0, '>100': 0 };
        products.forEach((x) => { const p = x.minPrice != null ? x.minPrice : x.price; if (p == null) return; if (p < 10) priceBuckets['<10']++; else if (p < 30) priceBuckets['10-30']++; else if (p < 100) priceBuckets['30-100']++; else priceBuckets['>100']++; });
        const ratingAvg = products.length ? (products.reduce((s, x) => s + (x.rating || 0), 0) / products.length).toFixed(2) : 0;
        const salesTotal = products.reduce((s, x) => s + (x.monthlySales || 0), 0);
        const fbaCount = products.filter((x) => x.fulfill === 'FBA' || x.amazonSell).length;
        const registered = products.filter((x) => x.brandStatus === 'registered' || x.tmMark).length;
        const withFollow = products.filter((x) => (x.followCount || 0) > 0).length;
        const pick = (arr, n, fn) => [...arr].sort(fn).slice(0, n).map((x) => ({ asin: x.asin, title: (x.title || '').slice(0, 50), price: x.minPrice != null ? x.minPrice : x.price, currency: x.currency || '', site: x.site || '', monthlySales: x.monthlySales || 0, followCount: x.followCount || 0, trademarkCount: x.trademarkCount || 0, brandStatus: x.brandStatus || '', fulfill: x.fulfill || '', brand: x.brand || '' }));
        return send(200, {
          total,
          bySite, byFulfill, byCategory, byBrand, priceBuckets,
          ratingAvg, salesTotal, fbaCount, registered, withFollow,
          salesTop: pick(products, 10, (a, b) => (b.monthlySales || 0) - (a.monthlySales || 0)),
          followTop: pick(products, 10, (a, b) => (b.followCount || 0) - (a.followCount || 0)),
          tmTop: pick(products, 10, (a, b) => (b.trademarkCount || 0) - (a.trademarkCount || 0)),
          riskList: products.filter((x) => x.brandStatus === 'registered' || x.tmMark).slice(0, 10).map((x) => ({ asin: x.asin, title: (x.title || '').slice(0, 50), brand: x.brand, brandStatus: x.brandStatus, tmMark: !!x.tmMark, trademarkCount: x.trademarkCount || 0 })),
          lowSales: products.filter((x) => (x.monthlySales || 0) === 0).length,
        });
      }

      // ---- 货源管理: 记录/读取/抓取 1688/淘宝/拼多多/Amazon 货源 (找货后价格对比入库) ----
      if (p === '/api/products/goods' && req.method === 'GET') {
        const asin = url.searchParams.get('asin') || '';
        const prod = products.find((x) => x.asin === asin);
        const goods = ((prod && prod.sourceGoods) || []).map(ensureGoodShape);
        return send(200, { goods });
      }
      // 兼容旧接口: 整数组覆盖写 (新代码请用 /goods/add | /goods/delete | /goods/patch)
      if (p === '/api/products/goods' && req.method === 'POST') {
        const { asin, goods } = j;
        if (!asin) return send(400, { error: '缺少 ASIN' });
        const prod = products.find((x) => x.asin === asin);
        if (!prod) return send(404, { error: '商品不存在' });
        prod.sourceGoods = Array.isArray(goods) ? goods.map(ensureGoodShape) : (prod.sourceGoods || []);
        save('products.json', products);
        return send(200, { ok: true, count: prod.sourceGoods.length });
      }
      // 单条新增: 按规范化 URL 去重; 已存在则更新标题/价格(变价记入 priceHistory)
      if (p === '/api/products/goods/add' && req.method === 'POST') {
        const asin = String(j.asin || '').trim();
        const prod = products.find((x) => x.asin === asin);
        if (!prod) return send(404, { error: '商品不存在: ' + asin });
        const g = j.good && typeof j.good === 'object' ? j.good : {};
        if (!g.url && !g.title) return send(400, { error: '需提供 url 或 title' });
        prod.sourceGoods = Array.isArray(prod.sourceGoods) ? prod.sourceGoods : [];
        const norm = ensureGoodShape(g);
        const idx = prod.sourceGoods.findIndex((x) => ensureGoodShape(x).urlKey && ensureGoodShape(x).urlKey === norm.urlKey);
        if (idx >= 0) {
          const old = ensureGoodShape(prod.sourceGoods[idx]);
          const changed = old.priceMin !== norm.priceMin || old.priceMax !== norm.priceMax;
          const merged = Object.assign({}, old, {
            title: norm.title || old.title, priceRaw: norm.priceRaw || old.priceRaw,
            priceMin: norm.priceMin != null ? norm.priceMin : old.priceMin,
            priceMax: norm.priceMax != null ? norm.priceMax : old.priceMax,
            currency: norm.currency || old.currency, moq: norm.moq || old.moq,
            supplier: norm.supplier || old.supplier, img: norm.img || old.img,
            checkedAt: now(),
            priceHistory: changed ? (old.priceHistory || []).concat([{ at: now(), priceRaw: old.priceRaw, priceMin: old.priceMin, priceMax: old.priceMax }]).slice(-20) : (old.priceHistory || []),
          });
          prod.sourceGoods[idx] = merged;
          save('products.json', products);
          return send(200, { ok: true, updated: true, id: merged.id, priceChanged: changed, count: prod.sourceGoods.length, good: merged });
        }
        prod.sourceGoods.unshift(Object.assign({}, norm, { addedAt: norm.addedAt || now(), checkedAt: norm.checkedAt || now() }));
        save('products.json', products);
        return send(200, { ok: true, updated: false, id: norm.id, count: prod.sourceGoods.length, good: norm });
      }
      // 单条删除 (按 id 或 urlKey)
      if (p === '/api/products/goods/delete' && req.method === 'POST') {
        const asin = String(j.asin || '').trim();
        const prod = products.find((x) => x.asin === asin);
        if (!prod) return send(404, { error: '商品不存在: ' + asin });
        const list = (prod.sourceGoods || []).map(ensureGoodShape);
        const keep = list.filter((x) => !(x.id === j.id || (j.urlKey && x.urlKey === j.urlKey)));
        prod.sourceGoods = keep;
        save('products.json', products);
        return send(200, { ok: true, removed: list.length - keep.length, count: keep.length });
      }
      // 单条修改 (手动改价/MOQ/供应商/备注)
      if (p === '/api/products/goods/patch' && req.method === 'POST') {
        const asin = String(j.asin || '').trim();
        const prod = products.find((x) => x.asin === asin);
        if (!prod) return send(404, { error: '商品不存在: ' + asin });
        const list = (prod.sourceGoods || []).map(ensureGoodShape);
        const it = list.find((x) => x.id === j.id || (j.urlKey && x.urlKey === j.urlKey));
        if (!it) return send(404, { error: '货源记录不存在' });
        const patch = j.patch && typeof j.patch === 'object' ? j.patch : {};
        Object.assign(it, patch);
        if (patch.priceRaw != null) Object.assign(it, parseGoodPrice(patch.priceRaw), { checkedAt: now() });
        prod.sourceGoods = list;
        save('products.json', products);
        return send(200, { ok: true, good: it });
      }
      // 设定货源角色: primary(现阶段最优) / backup(备选) / ''(普通)
      // 一个商品同时只能有一个 primary (设新的会自动把旧的降为普通)
      if (p === '/api/products/goods/set-role' && req.method === 'POST') {
        const asin = String(j.asin || '').trim();
        const prod = products.find((x) => x.asin === asin);
        if (!prod) return send(404, { error: '商品不存在: ' + asin });
        const role = j.role === 'primary' || j.role === 'backup' ? j.role : '';
        const list = (prod.sourceGoods || []).map(ensureGoodShape);
        const it = list.find((x) => x.id === j.id || (j.urlKey && x.urlKey === j.urlKey));
        if (!it) return send(404, { error: '货源记录不存在' });
        if (role === 'primary') list.forEach((x) => { if (x.role === 'primary' && x.id !== it.id) x.role = ''; });
        it.role = it.role === role ? '' : role;                 // 再点一次 = 取消
        prod.sourceGoods = list;
        save('products.json', products);
        return send(200, { ok: true, id: it.id, role: it.role, primary: primaryOf(prod), backups: backupsOf(prod).map((x) => x.id) });
      }
      // 货源总览 (全局视图): 覆盖率 + 平台分布 + 最划算/最贵 + 久未核价
      if (p === '/api/goods/overview' && req.method === 'GET') {
        // 汇率与利润测算同源: 优先用 /api/rates 的实时缓存 (data/rates.json), 没有才退回内置表
        // (否则同一个商品在"货源比价"和"利润测算"里会显示两个不同的百分比)
        let liveR = null;
        try {
          const rc = JSON.parse(fs.readFileSync(path.join(DATA, 'rates.json'), 'utf8'));
          if (rc && rc.rates && Object.keys(rc.rates).length) liveR = rc.rates;
        } catch (e) { /* 无缓存 → 用内置兜底表 */ }
        const rows = [];
        for (const x of products) {
          const gs = (x.sourceGoods || []).map(ensureGoodShape);
          if (gs.length) rows.push({ asin: x.asin, title: x.title, site: x.site, price: x.price, currency: x.currency, cat1: x.cat1, goods: gs });
        }
        const byPlatform = {};
        let totalGoods = 0, best = [], stale = [], noPrimary = [], backupCount = 0;
        const nowMs = Date.now();
        for (const r of rows) {
          const prim = r.goods.find((g) => g.role === 'primary');
          const bks = r.goods.filter((g) => g.role === 'backup');
          backupCount += bks.length;
          if (!prim) noPrimary.push({ asin: r.asin, title: String(r.title || '').slice(0, 50), goodsCount: r.goods.length, site: r.site });
          for (const g of r.goods) {
            totalGoods++;
            byPlatform[g.platform || '其他'] = (byPlatform[g.platform || '其他'] || 0) + 1;
            const c = goodCostVsPrice(g, r.buyBoxPrice != null ? r.buyBoxPrice : r.price, r.currency, liveR);
            if (c) best.push({ asin: r.asin, title: String(r.title || '').slice(0, 50), platform: g.platform, url: g.url, priceCny: g.priceMin, shipFee: g.shipFee || 0, costCny: c.costCny, ratioPct: c.ratioPct, role: g.role || '', site: r.site });
            if (g.checkedAt && (nowMs - new Date(String(g.checkedAt).replace(' ', 'T') + 'Z').getTime()) > 30 * 86400000) stale.push({ asin: r.asin, platform: g.platform, checkedAt: g.checkedAt, priceCny: g.priceMin, url: g.url });
          }
        }
        best.sort((a, b) => a.ratioPct - b.ratioPct);
        return send(200, {
          products: products.length, withGoods: rows.length, missing: products.length - rows.length,
          totalGoods, byPlatform, backups: backupCount,
          withPrimary: rows.length - noPrimary.length,
          noPrimary: noPrimary.slice(0, 100),
          bestDeals: best.slice(0, 30), worstDeals: best.slice(-20).reverse(),
          stale: stale.slice(0, 50),
          staleNote: '超过 30 天未核价 (采购价会变, 旧价决策会翻车)',
        });
      }

      // ---- 物流配置 (云途 sourcekey / AppToken) ----
      if (p === '/api/logistics/config' && req.method === 'GET') {
        let cfg = {};
        try { cfg = JSON.parse(fs.readFileSync(path.join(DATA, 'logistics-config.json'), 'utf8')); } catch {}
        return send(200, { ok: true, sourcekey: cfg.sourcekey || '', appToken: cfg.appToken || '', EBusinessID: cfg.EBusinessID || '', kdAppKey: cfg.AppKey || '' });
      }
      if (p === '/api/logistics/config' && req.method === 'POST') {
        try {
          const file = path.join(DATA, 'logistics-config.json');
          let cfg = {};
          try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
          if (j.sourcekey !== undefined) cfg.sourcekey = String(j.sourcekey).trim();
          if (j.appToken !== undefined) cfg.appToken = String(j.appToken).trim();
          fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
          return send(200, { ok: true, sourcekey: cfg.sourcekey || '', appToken: cfg.appToken || '' });
        } catch (e) {
          return send(500, { error: '保存配置失败: ' + (e && e.message || e) });
        }
      }
      // ---- 物流报价表 (本地维护, 按国家×渠道, 每日/手动更新) ----
      // 数据模型: { version, updatedAt, countries: { "GB": [ { channel, type, firstWeight, firstPrice, contWeight, contPrice, minKg, maxKg, eta, note } ] } }
      const RATES_FILE = path.join(DATA, 'logistics-rates.json');
      const loadRates = () => { try { return JSON.parse(fs.readFileSync(RATES_FILE, 'utf8')); } catch { return { version: 1, updatedAt: null, countries: {} }; } };
      // 本地运费试算: 按国家 + 重量(kg) 计算各渠道费用 (首重+续重)
      const calcRate = (country, weightKg, rates) => {
        const list = (rates.countries && rates.countries[country]) || [];
        return list.map((c) => {
          const w = Math.max(0.001, weightKg);
          let total = null;
          if (c.firstWeight != null && c.firstPrice != null) {
            const firstW = parseFloat(c.firstWeight) || 0.5;
            const contW = parseFloat(c.contWeight) || 0.5;
            const contP = parseFloat(c.contPrice) || 0;
            if (w <= firstW) total = parseFloat(c.firstPrice);
            else total = parseFloat(c.firstPrice) + Math.ceil((w - firstW) / contW) * contP;
          }
          return { channel: c.channel, type: c.type || '', eta: c.eta || '', firstWeight: c.firstWeight, firstPrice: c.firstPrice, contWeight: c.contWeight, contPrice: c.contPrice, total: total != null ? Math.round(total * 100) / 100 : null, note: c.note || '' };
        }).filter((q) => q.total != null);
      };
      if (p === '/api/logistics/rates' && req.method === 'GET') {
        const rates = loadRates();
        const country = String(url.searchParams.get('country') || '').toUpperCase();
        const weightKg = parseFloat(url.searchParams.get('weight')) || 0;
        if (country && weightKg > 0) {
          // 试算模式: 返回该国家各渠道报价
          const quotes = calcRate(country, weightKg, rates);
          return send(200, { ok: true, country, weightKg, updatedAt: rates.updatedAt, count: quotes.length, quotes, note: '本地报价表试算, 价格为录入值, 请定期更新' });
        }
        return send(200, { ok: true, updatedAt: rates.updatedAt, countryCount: Object.keys(rates.countries || {}).length, countries: rates.countries || {} });
      }
      if (p === '/api/logistics/rates' && req.method === 'POST') {
        try {
          const rates = loadRates();
          // 两种模式: 单条保存 { country, channel, ... } | 整表覆盖 { countries } | 刷新时间 { _touch }
          if (j._touch) {
            // 仅刷新 updatedAt (标记已更新)
          } else if (j.countries) {
            rates.countries = j.countries;
          } else if (j.country && j.channel) {
            const cc = String(j.country).toUpperCase();
            if (!rates.countries[cc]) rates.countries[cc] = [];
            const item = { channel: String(j.channel), type: j.type || '', firstWeight: parseFloat(j.firstWeight) || 0.5, firstPrice: parseFloat(j.firstPrice) || 0, contWeight: parseFloat(j.contWeight) || 0.5, contPrice: parseFloat(j.contPrice) || 0, eta: j.eta || '', note: j.note || '' };
            if (j.remove) rates.countries[cc] = rates.countries[cc].filter((c) => c.channel !== item.channel);
            else {
              const idx = rates.countries[cc].findIndex((c) => c.channel === item.channel);
              if (idx >= 0) rates.countries[cc][idx] = { ...rates.countries[cc][idx], ...item };
              else rates.countries[cc].push(item);
            }
          }
          rates.updatedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
          rates.version = (rates.version || 1) + 1;
          fs.writeFileSync(RATES_FILE, JSON.stringify(rates, null, 2));
          return send(200, { ok: true, updatedAt: rates.updatedAt, countryCount: Object.keys(rates.countries || {}).length });
        } catch (e) {
          return send(500, { error: '保存报价表失败: ' + (e && e.message || e) });
        }
      }
      // ---- 实时汇率 (免费 API 每日快照, 可手动覆盖; 基准 CNY) ----
      if (p === '/api/rates' && req.method === 'GET') {
        const ratesFile = path.join(DATA, 'rates.json');
        let cache = {};
        try { cache = JSON.parse(fs.readFileSync(ratesFile, 'utf8')); } catch {}
        const today = new Date().toISOString().slice(0, 10);
        // 有当日缓存且非强制刷新 → 直接返回
        if (cache.date === today && cache.rates && Object.keys(cache.rates).length) {
          return send(200, { ok: true, base: 'CNY', date: cache.date, rates: cache.rates, source: cache.source || 'cache', history: cache.history || [] });
        }
        // 无缓存 → 拉取免费汇率 API
        const sources = [
          'https://open.er-api.com/v6/latest/CNY',
          'https://api.frankfurter.app/latest?from=CNY',
        ];
        let rates = null, source = '';
        for (const u of sources) {
          try {
            const resp = await fetch(u, { signal: AbortSignal.timeout(15000) });
            if (!resp.ok) continue;
            const d = await resp.json();
            if (u.includes('er-api') && d.result === 'success' && d.rates) {
              // er-api latest/CNY 返回 "1 CNY = X 外币" → 取倒数得 "1 外币 = X CNY"
              rates = {};
              for (const [k, v] of Object.entries(d.rates)) { if (v > 0) rates[k] = +(1 / v).toFixed(4); }
              source = 'open.er-api.com';
            }
            else if (u.includes('frankfurter') && d.rates) {
              // frankfurter latest?from=CNY 也是 "1 CNY = X 外币"
              rates = {};
              for (const [k, v] of Object.entries(d.rates)) { if (v > 0) rates[k] = +(1 / v).toFixed(4); }
              source = 'frankfurter.app';
            }
            if (rates && Object.keys(rates).length) break;
          } catch {}
        }
        if (!rates) {
          // API 全失败 → 用上次缓存或内置兜底
          if (cache.rates && Object.keys(cache.rates).length) return send(200, { ok: true, base: 'CNY', date: cache.date, rates: cache.rates, source: cache.source + ' (过期缓存)', history: cache.history || [], stale: true });
          rates = { EUR: 7.8, USD: 7.1, GBP: 9.1, JPY: 0.048, AUD: 4.7, CAD: 5.2, INR: 0.085, MXN: 0.4, BRL: 1.3, AED: 1.93, SAR: 1.89, SGD: 5.3 };
          source = '内置兜底';
        }
        const history = Array.isArray(cache.history) ? cache.history : [];
        history.unshift({ date: today, rates });
        if (history.length > 90) history.length = 90;
        const out = { base: 'CNY', date: today, rates, source, history, updatedAt: new Date().toISOString() };
        try { fs.writeFileSync(ratesFile, JSON.stringify(out, null, 2)); } catch {}
        return send(200, { ok: true, ...out });
      }
      // 手动覆盖汇率 (便于无外网时维护)
      if (p === '/api/rates' && req.method === 'POST') {
        try {
          const ratesFile = path.join(DATA, 'rates.json');
          let cache = {};
          try { cache = JSON.parse(fs.readFileSync(ratesFile, 'utf8')); } catch {}
          const today = new Date().toISOString().slice(0, 10);
          cache.rates = { ...(cache.rates || {}), ...(j.rates || {}) };
          cache.date = today;
          cache.source = 'manual';
          cache.updatedAt = new Date().toISOString();
          fs.writeFileSync(ratesFile, JSON.stringify(cache, null, 2));
          return send(200, { ok: true, rates: cache.rates });
        } catch (e) {
          return send(500, { error: '保存汇率失败: ' + (e && e.message || e) });
        }
      }
      if (p === '/api/products/goods/fetch' && req.method === 'POST') {
        // CDP 打开货源链接, 抓标题/价格 (1688/淘宝/拼多多/Amazon 详情页)
        const url = String(j.url || '').trim();
        if (!/^https?:\/\//.test(url)) return send(400, { error: '无效链接' });
        try {
          const tabs = await cdpGetTabs();
          const page = tabs.find((t) => t.type === 'page' && !t.url.includes('3088') && !t.url.startsWith('data:')) || tabs.find((t) => t.type === 'page');
          if (!page) return send(500, { error: 'Edge 无可用页面标签' });
          const { send: gs } = await cdpConnect(page.webSocketDebuggerUrl);
          await gs('Page.navigate', { url });
          await new Promise((r) => setTimeout(r, 9000));
          for (let s = 0; s < 2; s++) { await gs('Runtime.evaluate', { expression: `window.scrollTo(0, ${(s + 1) * 2500})` }); await new Promise((r) => setTimeout(r, 600)); }
          const rr = await gs('Runtime.evaluate', {
            expression: `(() => {
              const out = { title: null, price: null };
              const t = document.title || '';
              if (t) out.title = t.replace(/[-|_].*$/, '').trim().slice(0, 120) || t.slice(0, 120);
              // 通用价格选择器 (1688/淘宝/拼多多/Amazon 常见)
              const sels = [
                '#price .price, .priceText, .price-current, .tb-rmb-num, .price--mainText, [class*="price"] .price-text, [class*="Price"] span[class*="price"], .a-price .a-offscreen, [data-testid="price"]'
              ];
              for (const sel of sels) {
                const el = document.querySelector(sel);
                if (el) { const m = (el.textContent || '').match(/[\\d.,]+/); if (m) { out.price = m[0]; break; } }
              }
              if (!out.price) { const m2 = (document.body.textContent || '').match(/(?:¥|￥|\\$|€|£)\\s*([\\d.,]+)/); if (m2) out.price = m2[1]; }
              return JSON.stringify(out);
            })()`, returnByValue: true,
          });
          const info = JSON.parse(rr.result.value);
          return send(200, { title: info.title, price: info.price, url });
        } catch (e) {
          return send(500, { error: '抓取货源信息失败: ' + (e && e.message || e) });
        }
      }
      // ---- 1688 找货: 商品主图 → 1688 以图搜图 → 抓取同款货源列表 (需 1688 已登录) ----
      if (p === '/api/products/1688-search' && req.method === 'POST') {
        let imageUrl = String(j.imageUrl || '').trim();
        let asin = String(j.asin || '').trim();
        if (!imageUrl && asin) {
          const prod = products.find((x) => x.asin === asin);
          imageUrl = (prod && prod.mainImage) || '';
        }
        if (!imageUrl) return send(400, { error: '缺少商品主图 (该商品无主图)' });
        try {
          const tabs = await cdpGetTabs();
          const page = tabs.find((t) => t.type === 'page' && !t.url.includes('3088') && !t.url.startsWith('data:')) || tabs.find((t) => t.type === 'page');
          if (!page) return send(500, { error: 'Edge 无可用页面标签' });
          const { send: gs } = await cdpConnect(page.webSocketDebuggerUrl);
          const searchUrl = 'https://s.1688.com/selloffer/offer_search.htm?imageUrl=' + encodeURIComponent(imageUrl);
          await gs('Page.navigate', { url: searchUrl });
          await new Promise((r) => setTimeout(r, 18000));
          for (let s = 0; s < 3; s++) { await gs('Runtime.evaluate', { expression: `window.scrollTo(0, ${(s + 1) * 3000})` }); await new Promise((r) => setTimeout(r, 800)); }
          const rr = await gs('Runtime.evaluate', {
            expression: `(() => {
              const out = [];
              document.querySelectorAll('[class*="offerCard"]').forEach(card => {
                const href = card.getAttribute('href') || '';
                const offerId = (href.match(/offerId=(\\d+)/) || [])[1];
                const url = offerId ? 'https://detail.1688.com/offer/' + offerId + '.html' : (href.startsWith('http') ? href : 'https:' + href);
                const titleEl = card.querySelector('[class*="title" i], [class*="Title"]');
                const priceEl = card.querySelector('[class*="price" i], [class*="Price"], [class*="money" i]');
                const imgEl = card.querySelector('img');
                const priceTxt = priceEl ? priceEl.textContent.trim().replace(/\\s+/g, ' ') : '';
                out.push({
                  url,
                  offerId,
                  title: titleEl ? titleEl.textContent.trim().replace(/\\s+/g, ' ').slice(0, 80) : '',
                  price: (priceTxt.match(/¥?[\\d.]+/) || [''])[0],
                  priceRaw: priceTxt.slice(0, 30),
                  img: imgEl ? (imgEl.getAttribute('src') || '') : '',
                });
              });
              return JSON.stringify(out);
            })()`, returnByValue: true,
          });
          const items = JSON.parse(rr.result.value);
          return send(200, { ok: true, count: items.length, items: items.slice(0, 20), searchUrl });
        } catch (e) {
          return send(500, { error: '1688 找货失败: ' + (e && e.message || e) + ' (请确认已登录 1688)' });
        }
      }

      // ---- 数据体检/修复: 全库用真实收口函数重算排名字段 + 清洗脏值 (幂等, 纯本地, 不联网) ----
      if (p === '/api/maintenance/normalize-products' && req.method === 'POST') {
        let cBrand = 0, cFollow = 0, cUrl = 0, cBsrCat = 0, cRank = 0, cRankCat = 0, cBsr = 0, cCat = 0;
        for (const it of products) {
          const b = { brand: it.brand, followCount: it.followCount, url: it.url, bsrCat: it.bsrCat,
                      rp: it.rankParent, rc: it.rankChild, rps: it.rankParentSrc, rpc: it.rankParentCat,
                      cat1: it.cat1, catSrc: it.catSrc,
                      bsr: Array.isArray(it.bsr) ? it.bsr.length : -1 };
          sanitizeProductFields(it);
          applyRankFields(it);
          if (it.brand !== b.brand) cBrand++;
          if (it.followCount !== b.followCount) cFollow++;
          if (it.url !== b.url) cUrl++;
          if (it.bsrCat !== b.bsrCat) cBsrCat++;
          if (it.rankParent !== b.rp || it.rankChild !== b.rc || it.rankParentSrc !== b.rps) cRank++;
          if (it.rankParentCat !== b.rpc) cRankCat++;
          if ((Array.isArray(it.bsr) ? it.bsr.length : -1) !== b.bsr) cBsr++;
          if (it.cat1 !== b.cat1 || it.catSrc !== b.catSrc) cCat++;
        }
        try { save('products.json', products); } catch (e) { return send(500, { error: '落盘失败: ' + e.message }); }
        return send(200, { ok: true, total: products.length, cBrand, cFollow, cUrl, cBsrCat, cRank, cRankCat, cBsr, cCat });
      }

      // ---- 补采排名: 对无排名商品批量读详情页 BSR (可指定 asins 或自动取无排名商品, 可停止) ----
      if (p === '/api/products/refresh-ranks' && req.method === 'POST') {
        const asins = Array.isArray(j.asins) ? j.asins : [];
        // ★ 2026-09-25: 自动候选必须排除【已确认未上榜】的商品 —— 面板已分析完、确实没有根类目
        //   排名行, 补也补不到。旧判据 rankParent == null 会把它们一起选进去, 白跑十几小时。
        //   includeNotListed=true 可强制带上(用于复核); state=unknown 只补"还没采到"的。
        const includeNotListed = j.includeNotListed === true || j.includeNotListed === '1';
        const wantState = String(j.state || '').trim();
        let list = asins.length
          ? products.filter((x) => asins.includes(x.asin))
          : products.filter((x) => {
              if (!x.site || x.rankParent != null) return false;
              const st = rankParentStateOf(x);
              if (wantState) return st === wantState;
              return includeNotListed ? true : st !== 'not_listed';
            });
        const skippedNotListed = asins.length ? 0 : products.filter((x) => x.site && x.rankParent == null && rankParentStateOf(x) === 'not_listed').length;
        // ★ 2026-09-25 dryRun: 只报"打算跑多少条", 不导航不写库 —— 用户先看规模再决定, 也避免误触
        if (j.dryRun === true || j.dryRun === '1') {
          const st = { ok: 0, not_listed: 0, unknown: 0 };
          for (const x of products) { const k = rankParentStateOf(x); st[k] = (st[k] || 0) + 1 }
          // ★ 预演要如实反映"真跑会跑多少": 封顶逻辑在下面, 这里按同样规则算一遍
          const cap = Math.max(0, Number(j.limit) || 0) || (asins.length ? 0 : 200);
          const wouldRun = cap ? Math.min(list.length, cap) : list.length;
          return send(200, {
            ok: true, dryRun: true,
            candidates: list.length,                       // 库里"没有大排名"的总数
            wouldRun: wouldRun,                            // 真跑会处理多少条(已按封顶算)
            capped: wouldRun < list.length,
            defaultBatch: 200, skippedNotListed, states: st,
            msg: '预演: 候选 ' + list.length + ' 条, 本次会跑 ' + wouldRun + ' 条'
              + (wouldRun < list.length ? '(防误触封顶, 想跑更多请传 limit=N 或用 asins 勾选)' : '')
              + '; 自动跳过 ' + skippedNotListed + ' 个【未上榜】; 真正执行请去掉 dryRun。',
          });
        }
        if (!list.length) return send(200, { ok: true, total: 0, addedRank: 0, msg: '没有需要补排名的商品' });
        // ★ 2026-09: 加 limit 上限 —— 无大排名的商品可能上万(实测 8686), 每个约 8 秒, 不限量会跑十几个小时。
        //   传 limit=N 分批跑, 或先用 asins 精确指定(勾选后补)。
        // ★ 2026-09-25 误触保护: 没给 limit 也没指定 asins 时默认只跑 200 条。
        //   实测全库"无大排名"有 78,725 条, 每个 8~20 秒 —— 不封顶一次误点就是十几个小时。
        const DEFAULT_RANK_BATCH = 200;
        const rankLimit = Math.max(0, Number(j.limit) || 0);
        let capped = false;
        if (rankLimit) list = list.slice(0, rankLimit);
        else if (!asins.length && list.length > DEFAULT_RANK_BATCH) { list = list.slice(0, DEFAULT_RANK_BATCH); capped = true }
        try {
          const tabs = await cdpGetTabs();
          const page = tabs.find((t) => t.type === 'page' && /amazon\./.test(t.url)) || tabs.find((t) => t.type === 'page' && !t.url.includes('3088')) || tabs.find((t) => t.type === 'page');
          if (!page) return send(500, { error: 'Edge 无可用页面标签' });
          const { send: rs } = await cdpConnect(page.webSocketDebuggerUrl);
          let done = 0, addedRank = 0, fail = 0;
          for (const it of list) {
            if (collectStopRequested()) break;
            try {
              await cdpEnrichOne(rs, 'www.amazon.' + siteToHostSuffix(it.site), it, {});
              // ★大排名: 面板的「店铺选品」是宽类目排名(数字比榜单大), 必须并进来一起取最大值,
              //   否则补出来的还是小排名(榜单)。取不到面板就退回原来的 bsr 口径。
              // ★ 2026-09-24 修复: 原为 cdpReadZyPanel(读一次就走) —— 刚导航完面板还没渲染 → 读到 null
              //   → 面板排名永远补不上, rankParent 继续保留上次采集的旧值(陈旧虚高)。改为等面板就绪再读。
              const panelTxt = await cdpReadZyPanelWait(rs, { maxMs: 20000 });
              const maxAll = mergePanelRanks(it, panelTxt);
              const nums = (Array.isArray(it.bsr) ? it.bsr : []).map((b) => Number(b && b.rank)).filter(Boolean);
              if (maxAll != null) {
                it.rank = '#' + maxAll;
                it.bsrShopSrc = 'panel';
                addedRank++;
              } else if (nums.length) {
                // 面板读不到(未装插件/分析超时) → 用【本次刚抓到的页面 BSR】顶替宽类目排名。
                //   依据(实测同商品比对): 页面 BSR 最大值 = 面板「店铺选品」的值(两边都是 84974),
                //   语义相同(宽类目排名), 所以可以顶替。不顶替的话 rankParent 会一直保留旧面板值 = 补采无效。
                const mx = Math.max.apply(null, nums);
                const wide = it.bsr.find((b) => Number(b && b.rank) === mx);
                it.bsrShop = mx;                                   // 覆盖旧值(含陈旧的面板值)
                if (wide && wide.category) it.bsrShopCat = wide.category;
                it.bsrShopSrc = 'page-bsr';                        // 来源可追溯: panel / page-bsr
                it.rank = '#' + mx;
                applyRankFields(it);                               // 重算 rankParent/rankChild
                addedRank++;
              }
              // ★ 2026-09-25 结构化排名行(按 DOM 读) —— 必须放在上面两个兜底分支【之后】:
              //   否则页面 BSR 兜底会把 bsrShop 又填回去, 把"未上榜"覆盖成"有大排名"(实测踩过)。
              //   大排名 = 【根类目】行; 面板已就绪却没有根类目行 → not_listed(未上榜)。
              try {
                // ★ 排名行比面板主体晚渲染 → 最多重试 3 次(实测一次读常拿到 0 行, 导致状态判不出来)
                let info = null;
                for (let attempt = 0; attempt < 3; attempt++) {
                  const rr = await rs('Runtime.evaluate', { expression: linksCollector.EXPR_DETAIL_RANKS, returnByValue: true });
                  info = rr && rr.result && rr.result.value ? JSON.parse(rr.result.value) : null;
                  if (info && info.ok && Array.isArray(info.rows) && info.rows.length) break;
                  await new Promise((r2) => setTimeout(r2, 3500));
                }
                if (info && info.ok && Array.isArray(info.rows) && info.rows.length) {
                  const rk = linksCollector.classifyRanks(info);
                  it.bsrShop = rk.bsrShop; it.bsrShopCat = rk.bsrShopCat;
                  it.bsrCat = rk.bsrCat; it.bsrCatName = rk.bsrCatName;
                  it.rankParentState = rk.rankParentState; it.rankChildState = rk.rankChildState;
                  it.bsrShopSrc = rk.rankParentState === 'ok' ? 'panel' : 'none';
                  if (rk.rankParentState === 'not_listed') { it.rank = null; it.bsrShop = null; it.bsrShopCat = null }
                  applyRankFields(it);                             // 用最终字段重算 rankParent/rankChild
                  console.log('[rank-struct] ' + it.asin + ' 行数=' + info.rows.length + ' ready=' + info.ready
                    + ' → 大排名=' + (it.rankParent == null ? (rk.rankParentState === 'not_listed' ? '未上榜' : 'null') : '#' + it.rankParent)
                    + ' 小排名=' + (it.rankChild == null ? '-' : '#' + it.rankChild));
                } else {
                  console.log('[rank-struct] ' + it.asin + ' 结构化读失败或没有排名行(ok=' + (info ? info.ok : 'null') + ') → 保留旧口径, 不判未上榜');
                }
              } catch (e) { console.log('[rank-struct] ' + it.asin + ' 异常: ' + (e && e.message || e)) }
              if (panelTxt) { it.panelOk = true; it.panelAt = now(); }
            } catch (e) { fail++; }
            done++;
            bumpCollectProgress({ step: '补采排名', items: done, added: addedRank });
          }
          if (addedRank > 0) save('products.json', products);
          return send(200, { ok: true, total: list.length, done, addedRank, fail, skippedNotListed, stopped: collectStopRequested(),
            capped, defaultBatch: DEFAULT_RANK_BATCH, skippedNotListed,
            msg: (capped ? ('本次只跑了前 ' + DEFAULT_RANK_BATCH + ' 条(防误触封顶); 继续跑请传 limit=N 或先用 asins 勾选。') : '')
              + (skippedNotListed ? (' 已跳过 ' + skippedNotListed + ' 个【未上榜】商品(插件确认没有根类目排名, 补也补不到); 想复核请传 includeNotListed=1') : '') || undefined });
        } catch (e) {
          return send(500, { error: '补采排名失败: ' + (e && e.message || e) });
        }
      }

      // ---- 1688 找货 (上传主图版): 下载主图 → 上传 1688 以图搜图 → 抓同款货源 ----
      if (p === '/api/products/1688-search-upload' && req.method === 'POST') {
        let imageUrl = String(j.imageUrl || '').trim();
        let asin = String(j.asin || '').trim();
        if (!imageUrl && asin) {
          const prod = products.find((x) => x.asin === asin);
          imageUrl = (prod && prod.mainImage) || '';
        }
        if (!imageUrl) return send(400, { error: '缺少商品主图 (该商品无主图)' });
        let tmpFile = null;
        try {
          // ① 下载主图到临时文件
          const tmpDir = path.join(DATA, 'tmp');
          fs.mkdirSync(tmpDir, { recursive: true });
          tmpFile = path.join(tmpDir, (asin || 'img') + '_' + Date.now() + '.jpg');
          const imgResp = await fetch(imageUrl, { signal: AbortSignal.timeout(30000) });
          if (!imgResp.ok) return send(500, { error: '主图下载失败 (HTTP ' + imgResp.status + ')' });
          fs.writeFileSync(tmpFile, Buffer.from(await imgResp.arrayBuffer()));
          // ② CDP: 打开 1688 搜索页 → 上传图片到以图搜图
          const tabs = await cdpGetTabs();
          const page = tabs.find((t) => t.type === 'page' && t.url.includes('1688'))
            || tabs.find((t) => t.type === 'page' && !t.url.includes('3088') && !t.url.startsWith('data:'))
            || tabs.find((t) => t.type === 'page');
          if (!page) return send(500, { error: 'Edge 无可用页面标签' });
          const { send: us } = await cdpConnect(page.webSocketDebuggerUrl);
          await us('Page.navigate', { url: 'https://s.1688.com/selloffer/offer_search.htm' });
          // 等页面加载 + "以图搜款"按钮出现 (React 挂载, 通常 3s 内)
          let btnReady = false;
          for (let i = 0; i < 10; i++) {
            await new Promise((r) => setTimeout(r, 1000));
            try {
              const ck = await us('Runtime.evaluate', { expression: `(() => !!document.querySelector('[class*="image-upload-button-container"]'))()` });
              if (ck && ck.result && ck.result.value) { btnReady = true; break; }
            } catch {}
          }
          if (!btnReady) return send(500, { error: '1688 页面加载超时 (请确认已登录 1688)' });
          // 定位"以图搜款"上传 input: 页面直带 (navigate 后即存在, 类 image-file-reader-wrapper) 优先, 找不到再点按钮开弹层
          const INPUT_SEL = 'input[type="file"][class*="image-file-reader-wrapper"], input[type="file"]';
          const findInput = async () => {
            try {
              const doc = await us('DOM.getDocument', {});
              const q = await us('DOM.querySelector', { nodeId: doc.root.nodeId, selector: INPUT_SEL });
              return (q && q.nodeId) ? q.nodeId : null;
            } catch { return null; }
          };
          let nodeId = null;
          // 阶段 1: 直接轮询页面自带 file input (navigate 后通常 1-3s 就绪)
          for (let i = 0; i < 12 && !nodeId; i++) {
            await new Promise((r) => setTimeout(r, 1000));
            nodeId = await findInput();
          }
          // 阶段 2: 仍未找到 → 点击"以图搜款"按钮打开上传弹层 (最多 3 次, 每次重查)
          for (let retry = 0; retry < 3 && !nodeId; retry++) {
            await us('Runtime.evaluate', { expression: `(() => { const btn = document.querySelector('[class*="image-upload-button-container"]'); if (btn) btn.click(); return true; })()` });
            await new Promise((r) => setTimeout(r, 2000));
            for (let i = 0; i < 8 && !nodeId; i++) {
              await new Promise((r) => setTimeout(r, 1000));
              nodeId = await findInput();
            }
          }
          if (!nodeId) {
            let diag = '';
            try {
              const dd = await us('Runtime.evaluate', { expression: `(() => { const t = (document.body.innerText || '').replace(/\\n+/g, ' ').slice(0, 120); const inputs = [...document.querySelectorAll('input[type="file"]')].map(el => (el.className || '').slice(0, 50)); return JSON.stringify({ fileInputs: inputs, hasBtn: !!document.querySelector('[class*="image-upload-button-container"]'), txt: t }); })()` });
              diag = ' ' + JSON.stringify(dd && dd.result && dd.result.value);
            } catch {}
            return send(500, { error: '未找到 1688 图搜上传控件 (请确认已登录 1688)' + diag });
          }
          // ② 用 nodeId 设置文件到上传 input (objectId 方式 React 不识别, 必须 nodeId)
          await us('DOM.setFileInputFiles', { files: [tmpFile], nodeId });
          // 派发 change 触发 React 上传 → 等"搜索图片"按钮出现 (上传完成标志, 通常 2-4s)
          await us('Runtime.evaluate', { expression: `(() => { const els = [...document.querySelectorAll('input[type="file"]')]; const el = els.find(e => /image-file-reader|upload/i.test(e.className || '')) || els[0]; if (el) el.dispatchEvent(new Event('change', { bubbles: true })); return true; })()` });
          let uploaded = false;
          for (let i = 0; i < 12; i++) {
            await new Promise((r) => setTimeout(r, 1000));
            try {
              const ck = await us('Runtime.evaluate', { expression: `(() => { const sb = document.querySelector('.search-btn'); return !!(sb && (sb.offsetWidth || sb.offsetHeight)); })()` });
              if (ck && ck.result && ck.result.value) { uploaded = true; break; }
            } catch {}
          }
          if (!uploaded) return send(500, { error: '图片上传超时 (请确认已登录 1688)' });
          // ③ 点击"搜索图片"按钮触发以图搜图
          await us('Runtime.evaluate', { expression: `(() => { const btns = [...document.querySelectorAll('.search-btn, button, [role="button"]')]; const sb = btns.find(b => /搜索图片|开始搜索/.test(b.textContent || '') && (b.offsetWidth || b.offsetHeight)); if (sb) { sb.click(); return true; } return false; })()` });
          // ④ 等待图搜结果页跳转 + 结果卡片出现 (通常 5-10s)
          let gotResults = false;
          for (let i = 0; i < 15; i++) {
            await new Promise((r) => setTimeout(r, 1000));
            try {
              const ck = await us('Runtime.evaluate', { expression: `(() => { const n = document.querySelectorAll('[class*="searchOfferWrapper"]').length; return n > 0; })()` });
              if (ck && ck.result && ck.result.value) { gotResults = true; break; }
            } catch {}
          }
          if (!gotResults) await new Promise((r) => setTimeout(r, 4000)); // 兜底等待
          for (let s = 0; s < 3; s++) { await us('Runtime.evaluate', { expression: `window.scrollTo(0, ${(s + 1) * 3000})` }); await new Promise((r) => setTimeout(r, 600)); }
          // ④ 提取同款货源 (图搜结果页: air.1688.com/kapp/1688-search/pc-image-search)
          const rr = await us('Runtime.evaluate', {
            expression: `(() => {
              const out = [];
              document.querySelectorAll('[class*="searchOfferWrapper"], [class*="searchOfferItem"]').forEach(card => {
                const aplus = card.getAttribute('data-aplus-report') || '';
                const rkey = card.getAttribute('data-renderkey') || '';
                const aid = aplus.match(/object_id@(\\d+)/);
                const rid = rkey.match(/_(\\d{10,})$/);
                const offerId = aid ? aid[1] : (rid ? rid[1] : null);
                const url = offerId ? 'https://detail.1688.com/offer/' + offerId + '.html' : null;
                const titleEl = card.querySelector('[class*="title" i], [class*="Title"], [class*="name" i]');
                const priceEl = card.querySelector('[class*="price" i], [class*="Price"], [class*="money" i]');
                const imgEl = card.querySelector('img');
                const priceTxt = priceEl ? priceEl.textContent.trim().replace(/\\s+/g, ' ') : '';
                out.push({
                  url, offerId,
                  title: titleEl ? titleEl.textContent.trim().replace(/\\s+/g, ' ').slice(0, 80) : '',
                  price: (priceTxt.match(/¥?[\\d.]+/) || [''])[0],
                  priceRaw: priceTxt.slice(0, 30),
                  img: imgEl ? (imgEl.getAttribute('src') || '') : '',
                });
              });
              return JSON.stringify(out);
            })()`, returnByValue: true,
          });
          const items = JSON.parse(rr.result.value);
          return send(200, { ok: true, count: items.length, items: items.slice(0, 20), method: 'upload' });
        } catch (e) {
          return send(500, { error: '1688 图搜上传失败: ' + (e && e.message || e) + ' (请确认已登录 1688)' });
        } finally {
          if (tmpFile) { try { fs.unlinkSync(tmpFile); } catch {} }
        }
      }

      // 统一过滤条件: 空模板 + 字段清单 (前端面板与后端同一份定义; 两个页面共用)
      if (p === '/api/filter/spec' && req.method === 'GET') {
        /* ★ 2026-10-02 「排除商标国家」多选下拉的选项来源(用户要求把这个条件做成多选下拉框)。
         * = 常用商标局(固定前置) ∪ 库内实际出现过的国家 —— 保证"能勾的都真有数据"。
         * 库里没有时(cur 为空)下拉只显示常用项 + 一句提示, 不会给一堆点了 0 条的选项。 */
        const TM_COMMON = ['欧盟', '英国', '美国', '德国', '法国', '意大利', '西班牙', '荷兰', '瑞典', '波兰',
          '日本', '中国', '韩国', '澳大利亚', '加拿大', '墨西哥', '巴西', '印度', '新加坡', '阿联酋', '土耳其', '马德里'];
        const tmSeen = new Map();
        for (const x of products) {
          if (!Array.isArray(x.tmCountries)) continue;
          for (const c of x.tmCountries) { const k = String(c || '').trim(); if (k) tmSeen.set(k, (tmSeen.get(k) || 0) + 1); }
        }
        const tmOpts = TM_COMMON.slice();
        [...tmSeen.keys()].sort((a, b) => tmSeen.get(b) - tmSeen.get(a)).forEach((c) => { if (tmOpts.indexOf(c) < 0) tmOpts.push(c); });
        return send(200, {
          empty: normFilter({}),
          keys: FILTER_KEYS,
          groups: {
            productOnly: ['noRank', 'collectedFrom', 'collectedTo', 'cat1', 'cat2', 'cat1Cn', 'famFilter', 'famKey', 'famAny'],   // ★ 补登记: 这些条件采集侧无对应判定 (badgeNot/hasRankOnly 两处同义, 故不在此列)
            /* ★ 2026-10-02 修: dropOtherBrand(他牌商品/剔除他牌) 原来不在 collectOnly,
             *   于是商品管理面板里也画了它 —— 但 /api/products 的查询链路根本不认这个键,
             *   用户点了"没反应"(实测 dropOtherBrand=0 → 返回全库 9526 条, 一个都没筛)。
             *   它是采集侧概念(采集时要不要把非目标品牌的商品也收下), 商品库里没有这个维度,
             *   所以登记成 collectOnly: 采集面板照常显示, 商品管理面板不再显示。 */
            collectOnly: ['shopAplus', 'brandShop', 'brandStore', 'dropOtherBrand'],
          },
          tmCountryOptions: tmOpts,
          tmCountryCounts: [...tmSeen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([c, n]) => ({ country: c, count: n })),
        });
      }
      // 过滤条件 → 命中数 (采集前预估 / 商品管理实时计数共用)
      // 实现: 直接复用 /api/products 的判定 —— 把同一个 filter 请求打到本机 /api/products 取 total,
      // 避免"计数"和"列表"两套判定各写一遍导致数字对不上 (原来这里只回了一句 hint, 是占位实现)
      if (p === '/api/filter/count' && req.method === 'GET') {
        const fraw = url.searchParams.get('filter');
        let f = null;
        try { f = normFilter(JSON.parse(fraw || '{}')); } catch (e) { f = null; }
        if (!f) return send(400, { error: 'filter 需为 JSON' });
        const qs = filterToQuery(f);
        qs.set('limit', '1');                       // 只需 total, 不传数据
        const got = await new Promise((resolve) => {
          http.get({ host: '127.0.0.1', port: PORT, path: '/api/products?' + qs.toString() }, (r) => {
            let d = ''; r.on('data', (c) => d += c); r.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve(null); } });
          }).on('error', () => resolve(null));
        });
        if (!got) return send(500, { error: '计数失败' });
        return send(200, { total: got.total, active: filterActiveCount(f), query: qs.toString() });
      }
      // 过滤条件中文描述 (前端显示"当前过滤"; 与 filterDesc 同一份文案)
      if (p === '/api/filter/desc' && req.method === 'GET') {
        const fraw = url.searchParams.get('filter');
        let f = null;
        try { f = normFilter(JSON.parse(fraw || '{}')); } catch (e) { f = null; }
        if (!f) return send(400, { error: 'filter 需为 JSON' });
        return send(200, { desc: filterDescCanonical(f), active: filterActiveCount(f) });
      }

      // 用操作系统默认浏览器打开链接 (本机服务, 仅 http/https; 前端"外链/找货源"统一走这里)
      // 为什么需要: 网页里的 window.open 只会在 DSH 界面所在的浏览器/外壳里开标签,
      // 不一定是你本地的默认浏览器 → 由本机 Node 进程调用系统命令打开才叫"真·本地浏览器"
      if (p === '/api/open' && (req.method === 'GET' || req.method === 'POST')) {
        const target = String((req.method === 'GET' ? url.searchParams.get('url') : (j && j.url)) || '').trim();
        if (!/^https?:\/\//i.test(target)) return send(400, { error: '仅允许 http/https 链接' });
        try {
          const { spawn } = require('child_process');
          const isWin = process.platform === 'win32';
          // ⚠ Windows 坑 (已验证): spawn('cmd', ['/c','start','',url]) 时 Node 只给含空格/引号的参数加引号,
          //   URL 里的 & 不会被转义 → cmd.exe 把 & 当命令分隔符 →
          //   链接被"截断后照常打开"(用户看到开了页面, 其实查询参数全丢了), 且接口仍返回 200 → 静默失败。
          //   正确做法: windowsVerbatimArguments + 自己给整条命令加引号 (只加引号不够, Node 会转成 \" 反而更糟)。
          const args = isWin
            ? ['/c', 'start "" "' + target.replace(/"/g, '') + '"']
            : [target];
          const child = isWin
            ? spawn('cmd', args, { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true })
            : spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', args, { detached: true, stdio: 'ignore' });
          child.on('error', () => {});
          child.unref();
          console.log('[open] 用系统默认浏览器打开:', target.slice(0, 120));
          return send(200, { ok: true, opened: target, via: isWin ? 'cmd start (verbatim)' : (process.platform === 'darwin' ? 'open' : 'xdg-open') });
        } catch (e) {
          return send(500, { error: e.message });
        }
      }

      // 找货源: 各平台以图搜图入口 (图片 URL 直通 / CDP 自动上传 / 关键词兜底)
      if (p === '/api/sources' && req.method === 'GET') {
        const asin = String(url.searchParams.get('asin') || '').trim();
        const prod = products.find((x) => x.asin === asin);
        const img = (prod && prod.mainImage) || '';
        const kw = prod ? String(prod.title || '').split(/[,，|—\-–]/)[0].trim().slice(0, 40) : '';
        const sites = SOURCE_SITES.map((s) => ({
          k: s.k, name: s.name, kind: s.kind, verified: s.verified || '',
          ready: s.kind === 'img-url' ? !!img : true,
          url: s.kind === 'img-url' && img ? s.url(img) : (s.kind === 'keyword' && kw ? s.keywordUrl(kw) : null),
          note: s.kind === 'img-url' ? (img ? '' : '该商品无主图 → 无法以图搜图') : (s.kind === 'keyword' ? '网页端无图搜, 用关键词' : '后端自动上传图片后搜索 (零人工)'),
        }));
        return send(200, { asin, hasImage: !!img, image: img, keyword: kw, group: { imgUrl: sites.filter((x) => x.kind === 'img-url'), cdp: sites.filter((x) => x.kind === 'cdp'), keyword: sites.filter((x) => x.kind === 'keyword') }, sites });
      }
      // 后端 CDP 自动上传图搜 (淘宝拍立淘等无 URL 接口的平台)
      if (p === '/api/sources/cdp-search' && req.method === 'POST') {
        const asin = String(j.asin || '').trim();
        const prod = products.find((x) => x.asin === asin);
        const img = String(j.imageUrl || (prod && prod.mainImage) || '');
        if (!img) return send(400, { error: '该商品无主图, 无法以图搜图' });
        if (collectProgress && collectProgress.running) return send(409, { error: '采集运行中, CDP 标签页被占用, 请稍后再试' });
        try {
          const out = await cdpImageSearch(String(j.site || 'taobao'), img, {});
          return send(200, out);
        } catch (e) {
          return send(500, { error: e.message });
        }
      }

      // 税率表: 手改 > 欧盟联网 > 内置表 (每项带来源与生效日期)
      if (p === '/api/tax/rates' && req.method === 'GET') {
        const f = path.join(DATA, 'tax-rates.json');
        let cache = {};
        try { cache = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}
        const today = new Date().toISOString().slice(0, 10);
        let eu = cache.eu || null;
        if (!eu || eu.date !== today) {                  // 每日刷新一次欧盟 VAT
          const got = await fetchEuVat();
          if (got) { eu = got; cache.eu = eu; try { fs.writeFileSync(f, JSON.stringify(cache, null, 2)); } catch {} }
          else if (!eu) eu = null;
        }
        const overrides = cache.overrides || {};
        const sites = {};
        for (const k of Object.keys(TAX_TABLE)) sites[k] = taxForSite(k, overrides, eu && eu.sites, eu && eu.date);
        return send(200, { sites, eu: eu ? { date: eu.date, source: eu.source } : null, overrides, builtinNote: TAX_BUILTIN_NOTE, referralNote: REFERRAL_NOTE });
      }
      // 手动覆盖税率/币种含税口径
      if (p === '/api/tax/rates' && req.method === 'POST') {
        const f = path.join(DATA, 'tax-rates.json');
        let cache = {};
        try { cache = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}
        cache.overrides = cache.overrides || {};
        const site = String(j.site || '').toLowerCase();
        if (!site) return send(400, { error: '需 site' });
        if (j.rate === '' || j.rate == null) delete cache.overrides[site];
        else {
          // 校验: 税率必须是 0-100 的数字 (旧实现把 "abc" 静默写成 null 还回 200 ok —— 会让用户以为设置成功了)
          const rate = Number(j.rate);
          if (!isFinite(rate) || rate < 0 || rate > 100) return send(400, { error: '税率必须是 0-100 之间的数字 (收到: ' + JSON.stringify(j.rate) + ')' });
          if (j.includesTax !== undefined && typeof j.includesTax !== 'boolean' && j.includesTax !== 1 && j.includesTax !== 0 && j.includesTax !== '1' && j.includesTax !== '0') {
            return send(400, { error: 'includesTax 需为 true/false' });
          }
          cache.overrides[site] = { rate: rate, includesTax: j.includesTax !== undefined ? !!j.includesTax : undefined, at: now() };
        }
        try { fs.writeFileSync(f, JSON.stringify(cache, null, 2)); } catch {}
        return send(200, { ok: true, site, override: cache.overrides[site] || null });
      }

      // 利润测算 (单一实现): body { asin, mode, supplyCny, shipCny, dutyCny, storageCny, otherCny, priceOverride, priceBasis, acos, returnRate, payRate, fxLoss, vatRate, commRate, fbaFee, targetMargin }
      if (p === '/api/profit/calc' && req.method === 'POST') {
        const prod = products.find((x) => x.asin === String(j.asin || ''));
        if (!prod) return send(404, { error: '商品不存在: ' + j.asin });
        const f = path.join(DATA, 'tax-rates.json');
        let cache = {};
        try { cache = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}
        if (!cache.eu) { const got = await fetchEuVat(); if (got) { cache.eu = got; try { fs.writeFileSync(f, JSON.stringify(cache, null, 2)); } catch {} } }
        // 汇率: 复用 /api/rates 的逻辑 (取当日缓存/联网/兜底)
        let rateInfo = null;
        try {
          const rf = path.join(DATA, 'rates.json');
          let rc = {};
          try { rc = JSON.parse(fs.readFileSync(rf, 'utf8')); } catch {}
          const cur = prod.currency || siteCurrency(String(prod.site || 'uk'));
          if (rc.rates && rc.rates[cur] != null) rateInfo = { rate: rc.rates[cur], source: rc.source || 'cache', date: rc.date };
          else {
            const r2 = await fetch('https://open.er-api.com/v6/latest/CNY', { signal: AbortSignal.timeout(12000) });
            const d2 = await r2.json();
            if (d2 && d2.rates && d2.rates[cur] > 0) rateInfo = { rate: +(1 / d2.rates[cur]).toFixed(4), source: 'open.er-api.com', date: new Date().toISOString().slice(0, 10) };
          }
        } catch (e) { /* 汇率缺失 → computeProfit 会给 warning */ }
        const out = computeProfit(prod, j, cache.overrides || {}, cache.eu && cache.eu.sites, rateInfo, cache.eu && cache.eu.date);
        return send(200, out);
      }
      // 商品库批量重算佣金 (把硬编码 15% 换成按类目费率表; 返回改动数)
      if (p === '/api/products/recalc-fees' && req.method === 'POST') {
        let changed = 0;
        for (const x of products) {
          if (!(x.price > 0)) continue;
          const r = referralRateFor(x.cat1).rate / 100;
          const fee = Math.round(x.price * r * 100) / 100;
          if (x.referralFee !== fee) { x.referralFee = fee; changed++; }
          const stale = x.netProfit != null && x.netProfitOld !== true;   // 旧 netProfit 是硬编码公式产物, 标记为不可信
          if (stale) { x.netProfit = null; x.netProfitNote = '旧公式产物已清空; 用利润测算得到真实净利'; }
        }
        save('products.json', products);
        return send(200, { ok: true, changed, total: products.length });
      }

      // 类目层级树 (一级 → 二级 + 计数): 供"排除一级/二级类目"筛选使用
      // 数据来源: catSrc='bc' 面包屑真实层级 / 'bsr' 榜单类目推算 / 空 = 未采集
      if (p === '/api/products/cat-tree' && req.method === 'GET') {
        const map = new Map();
        const mapCn = new Map();       // ★ 2026-09: 按中文大类归并的第二棵树 (供"大类目"下拉)
        for (const x of products) {
          const k = x.cat1 || '(未分类)';
          if (!map.has(k)) map.set(k, { cat1: k, count: 0, bc: 0, bsr: 0, children: new Map() });
          const node = map.get(k);
          node.count++;
          if (x.catSrc === 'bc') node.bc++;
          else if (x.catSrc === 'bsr' || x.catSrc === 'panel') node.bsr++;
          if (x.cat2) node.children.set(x.cat2, (node.children.get(x.cat2) || 0) + 1);
          // 中文归并树: 大类目=catCnOf(cat1), 二级=catCnOf(cat2) 但保留原始 cat2 值供精确筛选
          const cn = catCnOf(k);
          if (!mapCn.has(cn)) mapCn.set(cn, { cat1: cn, count: 0, raws: new Map(), children: new Map() });
          const n2 = mapCn.get(cn);
          n2.count++;
          n2.raws.set(k, (n2.raws.get(k) || 0) + 1);
          if (x.cat2) {
            const c2cn = catCnOf(x.cat2);
            // 归不出中文时退回原始名, 否则二级下拉会全变成「其他类目」而无法细分
            const c2key = (c2cn === '其他类目') ? String(x.cat2) : c2cn;
            if (!n2.children.has(c2key)) n2.children.set(c2key, { cat2Cn: c2cn, cat2: x.cat2, count: 0 });
            n2.children.get(c2key).count++;
          }
        }
        const tree = [...map.values()]
          .map((n) => ({ cat1: n.cat1, cat1Cn: catCnOf(n.cat1), count: n.count, bc: n.bc, bsr: n.bsr, children: [...n.children.entries()].map(([cat2, count]) => ({ cat2, count })).sort((a, b) => b.count - a.count) }))
          .sort((a, b) => b.count - a.count);
        const treeCn = [...mapCn.values()]
          .map((n) => ({
            cat1: n.cat1, count: n.count,
            raws: [...n.raws.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
            children: [...n.children.values()].sort((a, b) => b.count - a.count),
          }))
          .sort((a, b) => b.count - a.count);
        const bc = products.filter((x) => x.catSrc === 'bc').length;
        const bsr = products.filter((x) => x.catSrc === 'bsr' || x.catSrc === 'panel').length;
        return send(200, { total: products.length, sources: { bc, bsr, none: products.length - bc - bsr }, tree, treeCn });
      }
      // ===== 存量数据派生字段修复 (纯计算, 不读页面, 秒级; 幂等可重复执行) =====
      // 背景: 早期采集器的几个已知缺陷在存量数据里留下了错值, 这里按"可判定的规则"修正, 判不了一律置空(不猜):
      //   R1 币种: 早期把非 uk/us 站点一律写成 EUR → 按站点真实币种纠正 (au→AUD, de→EUR…)
      //            priceSymbol 与新币种不符时置空 (不能出现"AU 站商品带着 € 符号")
      //   R2 主图: 早期存的是列表页缩略图 (_AC_SY300_/_SX342_ 等) → 按图片 ID 重建官方高清 _AC_SL1500_
      //   R3 最低价: minPrice > price 属自相矛盾 (多为早期插件面板的另一种币种) → 有报价明细就取最小值, 否则置空
      //   R4 A+: 早期把"空的 A+ 占位容器"判成有 A+ → 未核实(detailOk=false)的行一律置空(未核实), 不保留可能是假的 true
      //   R5 排名: rank 必须等于 BSR 里的最大排名 → 按 bsr 重算
      //   R6 假月销/假库存/假评分: 早期类目搜索采集模板写的是随机数 (标记: stock>0, 新模板恒为0) → 置空
      if (p === '/api/products/fix-derived' && req.method === 'POST') {
        const dryRun = j.dryRun !== false;                       // 默认只预演, 必须显式 dryRun:false 才落盘
        const stats = {};
        const samples = {};
        const bump = (rule, before, after) => {
          stats[rule] = stats[rule] || { n: 0, samples: [] };
          stats[rule].n++;
          if (stats[rule].samples.length < 6) stats[rule].samples.push({ asin: null, before: before, after: after });
        };
        const SYM_OF = { AUD: ['$', 'A$'], USD: ['$', 'US$'], GBP: ['£'], EUR: ['€'], JPY: ['¥'], CAD: ['$', 'C$'], INR: ['₹'], MXN: ['$', 'MX$'], BRL: ['R$'], SGD: ['S$'], PLN: ['zł'], SEK: ['kr'], TRY: ['₺'], AED: ['AED'], SAR: ['SAR'] };
        for (const x of products) {
          // R1 币种 + R7 币种符号
          const wantCur = SITE_CURRENCY[x.site];
          if (wantCur && x.currency && x.currency !== wantCur) {
            bump('R1币种', x.asin + ' site=' + x.site + ' ' + x.currency + '(' + x.price + ')', wantCur);
            if (!dryRun) x.currency = wantCur;
          }
          const cur2 = dryRun ? (wantCur || x.currency) : x.currency;
          if (x.priceSymbol && SYM_OF[cur2] && SYM_OF[cur2].indexOf(x.priceSymbol) < 0) {
            bump('R7币种符号', x.asin + ' cur=' + cur2 + ' 符号=' + x.priceSymbol, '(置空)');
            if (!dryRun) x.priceSymbol = null;
          }
          // R2 主图 (缩略图 → 官方高清)
          if (x.mainImage && !/_AC_SL1500_\.jpg/.test(x.mainImage)) {
            const m = String(x.mainImage).match(/\/images\/I\/([A-Za-z0-9%+_-]{5,})/);
            if (m) {
              const hi = 'https://m.media-amazon.com/images/I/' + m[1] + '._AC_SL1500_.jpg';
              bump('R2主图高清', x.asin + ' ' + String(x.mainImage).slice(-40), hi.slice(-40));
              if (!dryRun) x.mainImage = hi;
            }
          }
          // R3 最低价
          if (x.minPrice != null && x.price != null && x.minPrice > x.price + 0.01) {
            const vals = [x.price].concat((Array.isArray(x.offerPrices) ? x.offerPrices : []).map((o) => o && o.price).filter((v) => typeof v === 'number'));
            const next = vals.length > 1 ? Math.min.apply(null, vals) : null;
            bump('R3最低价', x.asin + ' minPrice ' + x.minPrice + ' > price ' + x.price, next == null ? '(置空)' : next);
            if (!dryRun) x.minPrice = next;
          }
          // R4 A+ 未核实
          if (x.aplus === true && x.detailOk !== true) {
            bump('R4A+置空', x.asin + ' aplus=true 但未核实', '(未核实 null)');
            if (!dryRun) x.aplus = null;
          }
          // R8 BSR 脏条目: 旧解析器把第 2 条之后的 BSR 行吞进类目名 (如 "Automotive) 12 in Dash-Mounted Holders 4")
          //    能把真实子条目挖回来的就挖回来, 挖不回来的一律丢弃 (绝不留假类目); 顺带丢掉 rank 不是有限正数的条目 (修 #NaN)
          if (Array.isArray(x.bsr) && x.bsr.length) {
            const fixed2 = [];
            const seen2 = {};
            for (const e of x.bsr) {
              const rk = Number(e && e.rank);
              const cat = String((e && e.category) || '').trim();
              if (!isFinite(rk) || rk <= 0) { bump('R8脏BSR', x.asin + ' rank=' + (e && e.rank) + ' 类目=' + cat, '(丢弃)'); continue; }
              const dirty = /\d+\s+in\s+[A-Za-z]/.test(cat) || /\)/.test(cat);
              if (dirty) {
                const subs = salvageBsrFragment(cat);
                if (subs.length) bump('R8脏BSR', x.asin + ' ' + cat, subs.map((s) => s.rank + ' ' + s.category).join(' + '));
                else bump('R8脏BSR', x.asin + ' rank=' + rk + ' 类目=' + cat, '(丢弃)');
                if (!dryRun) subs.forEach((s) => { const k = s.rank + '|' + s.category.toLowerCase(); if (!seen2[k]) { seen2[k] = 1; fixed2.push(s); } });
                continue;
              }
              const k = rk + '|' + cat.toLowerCase();
              if (seen2[k]) { bump('R8脏BSR', x.asin + ' 重复条目 ' + cat, '(去重)'); continue; }
              seen2[k] = 1;
              fixed2.push(isFinite(rk) ? { rank: rk, category: cat } : e);
            }
            // 截断残渣清理 (dryRun 也要能报告): 同一排名下短名是长名的前缀 → 短名是截断产物
            //   例: {"rank":1,"category":"Cell Phone Han"} vs {"rank":1,"category":"Cell Phone Handlebar Mounts"}
            const _dropped = {};
            for (const a of fixed2) {
              for (const b of fixed2) {
                if (a === b || a.rank !== b.rank) continue;
                const la = String(a.category).toLowerCase(), lb = String(b.category).toLowerCase();
                if (la !== lb && lb.indexOf(la) === 0) { _dropped[a.category] = 1; break; }
              }
            }
            const _cleaned = fixed2.filter((e) => !_dropped[e.category]);
            if (_cleaned.length !== fixed2.length) bump('R8截断残渣', x.asin + ' ' + Object.keys(_dropped).join('/'), '(丢弃)');
            if (!dryRun) { x.bsr = _cleaned; if (!_cleaned.length) x.rank = null; }
          }
          // R5 排名
          if (Array.isArray(x.bsr) && x.bsr.length) {
            const want = '#' + Math.max.apply(null, x.bsr.map((b) => b.rank));
            if (x.rank !== want) { bump('R5排名', x.asin + ' ' + x.rank, want); if (!dryRun) x.rank = want; }
          }
          // R6 早期类目搜索采集的随机月销/库存/评分 (标记 stock>0)
          if (x.stock > 0) {
            bump('R6假月销库存', x.asin + ' source=' + x.source + ' 月销' + x.monthlySales + ' 库存' + x.stock + ' 评分' + x.rating + '/' + x.reviews, '(月销/库存/评分置空)');
            if (!dryRun) {
              x.monthlySales = null; x.stock = 0;
              if (x.detailOk !== true && (x.reviews === 0 || x.reviews == null) && x.rating === 4) { x.rating = null; x.reviews = null; }
            }
          }
        }
        if (!dryRun) save('products.json', products);
        const out = Object.entries(stats).map(([k, v]) => ({ rule: k, count: v.n, samples: v.samples.map((s) => s.before + '  →  ' + s.after) }));
        return send(200, { dryRun, total: products.length, rules: out, totalFixed: out.reduce((s, r) => s + r.count, 0) });
      }

      // 用 BSR 榜单类目就地推出一级/二级类目 (不读页面, 秒级完成; 结果标记 catSrc='bsr')
      // 规则: 排名最大的 BSR 类目 = 最宽泛的一级; 排名最小的 = 最细的二级
      // 关键: 旧数据里部分 BSR 类目是列表页整句片段 ("Automotive) 328 in Car Headlight Assemblies"),
      //       这种必须丢弃 — 宁可标"未分类"也不写一个假类目
      if (p === '/api/products/derive-cat' && req.method === 'POST') {
        const force = !!(j && j.overwrite === true);
        const cleanCat = (s) => {
          const v = String(s || '').replace(/\s+/g, ' ').trim();
          if (!v || v.length > 45) return null;
          if (v === 'ListPage') return null;
          if (/[()]/.test(v)) return null;                 // 含括号 → 句子片段
          if (/\s+in\s+/i.test(v)) return null;            // "328 in Car Headlight" → 片段
          if (/\d/.test(v)) return null;                   // 含数字 → 排名残留
          if (/^(see|top|best|#)/i.test(v)) return null;
          if (!/[A-Za-z]/.test(v)) return null;
          return v.slice(0, 45);
        };
        let derived = 0, keptBc = 0, noBsr = 0;
        for (const x of products) {
          if (x.catSrc === 'bc' && !force) { keptBc++; continue; }
          const bs = (Array.isArray(x.bsr) ? x.bsr : [])
            .map((b) => (b && b.rank != null ? { rank: b.rank, category: cleanCat(b.category) } : null))
            .filter((b) => b && b.category);
          if (!bs.length) { noBsr++; continue; }
          const broad = bs.reduce((a, b) => (b.rank > a.rank ? b : a));
          const narrow = bs.reduce((a, b) => (b.rank < a.rank ? b : a));
          x.cat1 = broad.category;
          x.cat2 = narrow.category !== broad.category ? narrow.category : null;
          const parts = [broad.category];
          if (x.cat2) parts.push(x.cat2);
          if (x.category && x.category !== x.cat2 && x.category !== broad.category && x.category !== 'FollowShop') parts.push(x.category);
          x.catPath = parts.join(' > ').slice(0, 200);
          x.catSrc = 'bsr';
          x.catAt = now();
          derived++;
        }
        save('products.json', products);
        return send(200, { derived, keptBc, noBsr, total: products.length });
      }

      // 类目清单 (排除法筛选的数据源): 按商品库真实类目聚合 + 计数, 供前端勾选"要排除的类目"
      if (p === '/api/products/categories' && req.method === 'GET') {
        const q = url.searchParams;
        const limit = Math.min(500, Math.max(1, parseInt(q.get('limit') || '120', 10) || 120));
        const kw = String(q.get('q') || '').trim().toLowerCase();
        const cnt = new Map();
        for (const x of products) {
          const c = String(x.category || '').trim();
          if (!c) continue;
          if (kw && !c.toLowerCase().includes(kw)) continue;
          cnt.set(c, (cnt.get(c) || 0) + 1);
        }
        const items = [...cnt.entries()].map(([cat, count]) => ({ cat, count })).sort((a, b) => b.count - a.count || a.cat.localeCompare(b.cat));
        return send(200, { total: items.length, limit, items: items.slice(0, limit) });
      }

      // 详情修复 / 类目补采 (存量修复): 重新打开详情页刷新 主图/价格/配送/自营/A+/主卖家/评分/类目层级/BSR/币种
      // body: { asins?, since?, limit?, needsDetail?, catOnly?, all? }
      if ((p === '/api/products/backfill-image' || p === '/api/products/refresh-detail') && req.method === 'POST') {
        // 注: body 已由顶层 req.on('end') 解析为 j, 这里直接用 j (不可再次监听 req)
        const catOnly = !!j.catOnly;
        if (!j.asins && !j.since && !j.all && !j.needsDetail && !catOnly) return send(400, { error: '需指定 asins 数组 / since 时间 / needsDetail=true / catOnly=true / all=true' });
        if (collectProgress && collectProgress.running) return send(409, { error: '已有采集正在运行 (mode=' + collectProgress.mode + '), 请先点「停止」等当前步骤结束后再开始' });
        beginCollectProgress(catOnly ? 'cat-backfill' : 'refresh-detail', catOnly ? '类目补采 (只读面包屑层级)' : '详情修复 (重读商品详情页)');
        try {
          const out = await cdpBackfillMainImage({ asins: j.asins, since: j.since, limit: j.limit, all: j.all, needsDetail: j.needsDetail, catOnly });
          endCollectProgress();
          pushNotify(catOnly ? '类目补采完成' : '详情修复完成', catOnly ? `补齐 ${out.fixed} 个商品的一级/二级/三级类目 (失败 ${out.failed} 个)` : `刷新 ${out.fixed} 个商品 (失败 ${out.failed} 个)`, `共处理 ${out.total} 个商品`);
          return send(200, { site: null, total: out.total, fixed: out.fixed, failed: out.failed, productCount: out.total, added: 0, products: out.results });
        } catch (e) {
          endCollectProgress();
          return send(500, { error: e.message });
        }
      }
      // ★ 2026-09-25 大排名三态统计: 全库有多少"有大排名 / 未上榜 / 未采集到"(旧数据算未采集到)
      if (p === '/api/products/rank-stats' && req.method === 'GET') {
        const states = { ok: 0, not_listed: 0, unknown: 0 };
        const bySite = {};
        let withParent = 0, noParentButChild = 0;
        for (const x of products) {
          const s = rankParentStateOf(x);
          states[s] = (states[s] || 0) + 1;
          if (x.rankParent != null) withParent++;
          else if (x.rankChild != null) noParentButChild++;
          const site = String(x.site || '(未知)');
          bySite[site] = bySite[site] || { ok: 0, not_listed: 0, unknown: 0 };
          bySite[site][s] = (bySite[site][s] || 0) + 1;
        }
        return send(200, {
          ok: true, total: products.length, states, withParent, noParentButChild, bySite,
          note: '未上榜 = 插件面板已分析完且确实没有根类目排名行; 未采集到 = 还没采到(可补采); 旧数据没有状态字段 → 算未采集到',
        });
      }

      if (p === '/api/products' && req.method === 'GET') {
        // 支持两种入参: ① filter=<JSON>(统一过滤条件, 与采集过滤同一 schema) ② 传统散参数(兼容)
        const fraw = url.searchParams.get('filter');
        let fcanon = null;
        if (fraw) {
          try { fcanon = normFilter(JSON.parse(fraw)); } catch (e) { fcanon = null; }
        }
        const q = fcanon ? filterToQuery(fcanon) : url.searchParams;
        let list = [...products];
        if (q.get('risk')) list = list.filter((x) => x.aiRiskLevel === q.get('risk'));
        if (q.get('fba')) list = list.filter((x) => x.fulfill === q.get('fba'));
        /* ★ 2026-10-02 修正「仅第三方」的口径不严(用户实测反馈) ——
         * 原写法: 仅自营 = x.amazonSell(严格) / 仅第三方 = !x.amazonSell(宽松)
         *   → 两侧不对称: 全库 amazonSell=true 41 条、false 3127 条、null 6360 条,
         *     「仅第三方」返回 9487(把 6360 条"没采到自营标记"的也算成第三方了)。
         * 语义定位: 「仅第三方」「非中国卖家」是【正向选择】, 按本文件既定约定
         *   "商品库里未知字段视为不满足" → 必须用 === false 严格判定。
         *   (而「排除 A+」「排除已备案」「排除 1688」是【排除语义】, 未知不该被排除 → 保持宽松, 不动。)
         * 修后: 仅自营 41 + 仅第三方 3127 + 未知 6360 = 9528, 三块互斥不重叠。 */
        if (q.get('sell') === 'amz') list = list.filter((x) => x.amazonSell === true);
        if (q.get('sell') === 'third') list = list.filter((x) => x.amazonSell === false);
        if (q.get('saved') === '1') list = list.filter((x) => x.saved);          // 只看已保存
        if (q.get('real') === '1') list = list.filter((x) => x.real);            // 只看真实采集
        // 自定义筛选: 区间(支持 "100-200" / "100-"(≥100) / "-200"(≤200)) + 阈值
        const parseRange = (v) => {
          if (!v || v.trim() === '') return null;
          const m = String(v).match(/([\d.]+)\s*[-~至]\s*([\d.]+)/); // "100-200" / "100~200" / "100至200"
          if (m) {
            const a = parseFloat(m[1]), b = parseFloat(m[2]);
            // 写反了 (如 "200000-1") 就自动纠正 —— 之前反向区间静默返回 0 条, 用户只会以为"没有商品"
            return a <= b ? { min: a, max: b } : { min: b, max: a };
          }
          const om = String(v).match(/^\s*([\d.]+)\s*[-~至]\s*$/);   // "5000-" → 仅下限
          if (om) return { min: parseFloat(om[1]), max: Infinity };
          const um = String(v).match(/^\s*[-~至]\s*([\d.]+)\s*$/);   // "-5000" → 仅上限
          if (um) return { min: -Infinity, max: parseFloat(um[1]) };
          return null;
        };
        // 价格区间: priceRange="100-200" (单框) 或兼容 priceMin/priceMax (取 minPrice 优先)
        const pv = (x) => (x.minPrice != null ? x.minPrice : x.price);
        const pr = parseRange(q.get('priceRange'));
        if (pr) { list = list.filter((x) => { const v = pv(x); return v != null && v >= pr.min && v <= pr.max; }); }
        else {
          if (q.get('priceMin') !== null && q.get('priceMin') !== '') list = list.filter((x) => pv(x) != null && pv(x) >= parseFloat(q.get('priceMin')));
          if (q.get('priceMax') !== null && q.get('priceMax') !== '') list = list.filter((x) => pv(x) != null && pv(x) <= parseFloat(q.get('priceMax')));
        }
        // 月销区间: salesRange="1000-5000" (单框) 或兼容 salesMin/salesMax
        const sr = parseRange(q.get('salesRange'));
        if (sr) { list = list.filter((x) => (x.monthlySales || 0) >= sr.min && (x.monthlySales || 0) <= sr.max); }
        else {
          if (q.get('salesMin') !== null && q.get('salesMin') !== '') list = list.filter((x) => x.monthlySales >= parseInt(q.get('salesMin'), 10));
          if (q.get('salesMax') !== null && q.get('salesMax') !== '') list = list.filter((x) => x.monthlySales <= parseInt(q.get('salesMax'), 10));
        }
        // 大排名区间: rankRange="1-200000" (统一 schema) 或 rankMax/rankMin (兼容)
        // ★ 这里曾经用 max(bsr) 当排名 —— 那是「榜单选品/小排名」, 与界面上显示的 rank(大排名, 店铺选品)
        //   不是一个数, 导致「界面显示 #363439 超区间, 却被小排名 12473 筛进 1-200000」。现统一用 bigRankOf()。
        const rr = parseRange(q.get('rankRange'));
        // ★ 2026-10-02 口径统一(修用户实测反馈): 界面卡片「父类排名」显示的、筛选判定的、
        //   导出用的, 现在全部是同一个 rankParentOf()。
        //   历史教训(这段注释别删): 曾经界面读 rankParent、筛选读 bigRankOf(=所有排名取最大),
        //   两者差 1518 条(只有一条页面原生BSR的商品) → 用户看到"卡片明明显示未采到, 
        //   勾了「排除没有排名的商品」却还在" / "排名区间筛不到它"。
        //   单条页面原生BSR 按设计归【子类】, 父类位置必须 null —— 所以 bigRankOf 不能当大排名用。
        const rankOf = (x) => rankParentOf(x);
        if (rr) list = list.filter((x) => { const r = rankOf(x); return r != null && r >= rr.min && r <= rr.max; });
        else {
          if (q.get('rankMax') !== null && q.get('rankMax') !== '') { const rl = parseInt(q.get('rankMax'), 10); list = list.filter((x) => { const r = rankOf(x); return r != null && r <= rl; }); }
          if (q.get('rankMin') !== null && q.get('rankMin') !== '') { const rl = parseInt(q.get('rankMin'), 10); list = list.filter((x) => { const r = rankOf(x); return r != null && r >= rl; }); }
        }
        // 评分区间 / 评论数区间 / 跟卖数区间 (统一 schema 的 *Range; 兼容单边参数)
        const numRanges = [
          ['ratingRange', (x) => x.rating, 'ratingMin', 'ratingMax'],
          ['reviewsRange', (x) => x.reviews, 'reviewsMin', 'reviewsMax'],
          ['followRange', (x) => (x.followCount || 0), 'followMin', 'followMax'],
        ];
        for (const [rkey, get, kmin, kmax] of numRanges) {
          const r = parseRange(q.get(rkey));
          if (r) { list = list.filter((x) => { const v = get(x); return v != null && v >= r.min && v <= r.max; }); continue; }
          if (q.get(kmin) !== null && q.get(kmin) !== '') { const v0 = parseFloat(q.get(kmin)); list = list.filter((x) => { const v = get(x); return v != null && v >= v0; }); }
          if (q.get(kmax) !== null && q.get(kmax) !== '') { const v0 = parseFloat(q.get(kmax)); list = list.filter((x) => { const v = get(x); return v != null && v <= v0; }); }
        }
        // 商标数量: 必须用"排除"语义 (与面板文案/采集侧 applyCollectFilter 完全一致)
        //   坑: 旧实现把它当成"保留区间内" → 面板选"排除 ≥50"时, 商品库返回 0 条 (语义正好相反)
        {
          const r = parseRange(q.get('tmRange'));
          const tmin = r ? r.min : (q.get('tmMin') !== null && q.get('tmMin') !== '' ? parseFloat(q.get('tmMin')) : null);
          const tmax = r ? r.max : (q.get('tmMax') !== null && q.get('tmMax') !== '' ? parseFloat(q.get('tmMax')) : null);
          if (tmin != null || tmax != null) {
            list = list.filter((x) => {
              const v = x.trademarkCount || 0;
              if (tmin != null && tmax != null) return !(v >= tmin && v <= tmax);
              if (tmin != null) return !(v >= tmin);
              return !(v <= tmax);
            });
          }
        }
        // 上架天数区间 (新品): ★ 2026-10-02 改用 listedDateOf() —— 优先详情页 firstAvailable,
        //   退回面板 listedAt(已剔除"等于采集当天"的假值)。
        //   旧写法只认 firstAvailable(全库仅 3 条) → 用户筛 1~3650 天只出来 2 条, 看着像筛选坏了。
        const nd = parseRange(q.get('newDaysRange'));
        if (nd) list = list.filter((x) => {
          const d = listedDateOf(x);
          if (!d) return false;
          const days = (Date.now() - d.getTime()) / 86400000;
          return days >= nd.min && days <= nd.max;
        });
        // 页面标识多选 (badges, 旧·含任一): 命中任一即可
        const badgesQ = String(q.get('badges') || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean);
        if (badgesQ.length) list = list.filter((x) => badgesQ.some((b) => (b === 'A+' ? x.aplus === true : x.badge === b)));
        // ★ 页面标识(排除法) badgeNot=… : 命中任一即剔除 —— 判据与采集侧 applyCollectFilter 的 itemMatchesBadge 完全一致
        //   (用 itemMatchesBadge 而不是 x.badge===b, 是为了"同一条件两处同义": 采集侧认 A+/AC/新品 等别名)
        const badgeNotQ = String(q.get('badgeNot') || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean);
        if (badgeNotQ.length) list = list.filter((x) => !badgeNotQ.some((b) => itemMatchesBadge(x, b)));
        // 1688 同款 / 品牌状态 (与采集过滤同一语义)
        if (q.get('is1688') === '1') list = list.filter((x) => x.is1688 === true);
        else if (q.get('is1688') === '0') list = list.filter((x) => x.is1688 !== true);
        if (q.get('brandStatus') === 'registered') list = list.filter((x) => x.brandStatus !== 'registered');
        else if (q.get('brandStatus') === 'notfound') list = list.filter((x) => x.brandStatus === 'notfound');
        else if (q.get('brandStatus') === 'tm') list = list.filter((x) => !(x.tmMark || /TM|注册商标/.test(x.brandStatus || '')));
        // 商标国家排除: tmCountries=欧盟,美国 → 命中任一国家即剔除
        const tmCq = String(q.get('tmCountries') || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean);
        if (tmCq.length) list = list.filter((x) => !(Array.isArray(x.tmCountries) && x.tmCountries.some((c) => tmCq.includes(c))));
        if (q.get('ratingMin') !== null && q.get('ratingMin') !== '') list = list.filter((x) => (x.rating || 0) >= parseFloat(q.get('ratingMin')));
        if (q.get('tmMax') !== null && q.get('tmMax') !== '') list = list.filter((x) => (x.trademarkCount || 0) <= parseInt(q.get('tmMax'), 10));
        if (q.get('followMin') !== null && q.get('followMin') !== '') list = list.filter((x) => (x.followCount || 0) >= parseInt(q.get('followMin'), 10)); // 跟卖数 ≥ N
        if (q.get('followMax') !== null && q.get('followMax') !== '') list = list.filter((x) => (x.followCount || 0) <= parseInt(q.get('followMax'), 10)); // 跟卖数 ≤ N
        // 无排名: noRank=1 —— ★ 2026-10-02 与 rankParentOf 同一口径(界面卡片「父类排名」)
        if (q.get('noRank') === '1') list = list.filter((x) => rankParentOf(x) == null);
        // ★ 只看有排名 (排除没有排名的商品) hasRankOnly=1 —— 同一口径(rankParentOf), 语义相反
        if (q.get('hasRankOnly') === '1') list = list.filter((x) => rankParentOf(x) != null);
        // ★ 2026-09-25 大排名三态(未上榜 / 未采集到 / 有大排名) —— 三态互斥, 旧数据算"未采集到"
        const rankStateQ = q.get('rankState');
        if (rankStateQ === 'ok' || rankStateQ === 'not_listed' || rankStateQ === 'unknown') {
          list = list.filter((x) => rankParentStateOf(x) === rankStateQ);
        } else if (rankStateQ === 'not_listed_or_unknown') {
          list = list.filter((x) => rankParentStateOf(x) !== 'ok');           // 所有"没有大排名"的
        }
        // ★ 2026-10-02 同上: 「中国卖家 / 非中国卖家」是正向选择, 未知(没读到国旗)视为不满足。
        if (q.get('china') === '1') list = list.filter((x) => x.chinaSeller === true);
        if (q.get('china') === '0') list = list.filter((x) => x.chinaSeller === false);
        // 站点: 支持多选 (逗号分隔, 如 "uk,us,de")
        if (q.get('site')) {
          const sites = q.get('site').split(',').map((s) => s.trim()).filter(Boolean);
          if (sites.length) list = list.filter((x) => sites.includes(x.site));
        }
        // 采集时间过滤 (精确到分钟): collectedFrom / collectedTo, 格式 "YYYY-MM-DD HH:MM"
        // collectedAt 存储为 "YYYY-MM-DD HH:MM:SS" → 字符串前缀比较即可 (同格式, 字典序=时间序)
        const collectedFrom = String(q.get('collectedFrom') || '').trim();
        const collectedTo = String(q.get('collectedTo') || '').trim();
        if (collectedFrom) list = list.filter((x) => String(x.collectedAt || '') >= collectedFrom);
        if (collectedTo) list = list.filter((x) => String(x.collectedAt || '') <= (collectedTo.length <= 16 ? collectedTo + ':59' : collectedTo));
        // 类目筛选 (排除法): categoryNot=关键词1,关键词2 → 命中即剔除 (大小写不敏感)
        // 匹配串见 catMatchText(): 原始一级/二级 + 【中文大类目归并名】 + 全路径(catPath 一级>二级>三级)
        // ★ 2026-09-24: 加入中文大类目, 因为「类目排除」chips 现在给的是大类目(汽车用品/家居厨房…),
        //   而库内 cat1 是站点本地化原名(Automotive/Auto et Moto…), 不加归并名则勾大类目排不掉任何商品。
        if (q.get('categoryNot')) {
          const nv = String(q.get('categoryNot')).split(/[,，\n]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
          if (nv.length) list = list.filter((x) => {
            const c = catMatchText(x);
            return !nv.some((k) => c.includes(k));
          });
        }
        // 类目: 包含匹配 (正选, 兼容保留)
        if (q.get('category')) {
          const cv = q.get('category').toLowerCase();
          list = list.filter((x) => String(x.category || '').toLowerCase().includes(cv));
        }
        // ★ 2026-09 大类目 / 二级类目筛选: 对 cat1/cat2 字段【精确匹配】。
        //   为什么不用上面的 category 包含匹配: 那是拿整条面包屑字符串做子串匹配,
        //   既会把二级类目名误当大类目命中, 也没法用类目树里的准确值。类目树(/api/products/cat-tree)给的
        //   就是 cat1/cat2 原值, 所以这里精确判等。
        // ★ 2026-10-02 修: 分类树里有一个大类目叫「(未分类)」(全库 78.9% 的商品没有 cat1)。
        //   旧写法 String(x.cat1||'') === '(未分类)' → 数据侧是空串, 永远不相等 →
        //   用户点这个大类目必然 0 条(实测 7517 条计数、0 条结果), 看着像"分类筛选不准"。
        //   现在两边统一: 空 / null / '(未分类)' 三种写法都归到「(未分类)」这一个桶。
        const cat1Key = (x) => { const v = String(x.cat1 == null ? '' : x.cat1).trim(); return v || '(未分类)'; };
        if (q.get('cat1')) { const c1 = String(q.get('cat1')); list = list.filter((x) => cat1Key(x) === c1); }
        if (q.get('cat2')) { const c2 = String(q.get('cat2')); list = list.filter((x) => String(x.cat2 || '') === c2); }
        // ★ 2026-09 中文大类目: 按【归并后的中文大类】筛 (库内 cat1 是多语言细类目名, 无法直接给用户选)
        //   ★ 2026-10-02: catCnOf('(未分类)') 返回的是「未分类」(少一对括号), 与树里的「(未分类)」
        //   对不上 → 点它也是 0 条。这里做一次别名归一, 两种写法都能命中。
        if (q.get('cat1Cn')) {
          const cn = String(q.get('cat1Cn'));
          const cnAlias = (v) => (v === '(未分类)' || v === '未分类' ? '未分类' : v);
          list = list.filter((x) => cnAlias(catCnOf(cat1Key(x))) === cnAlias(cn));
        }
        // ★ 2026-09 变体族筛选 (字段由 rebuild-variant-groups 写入)
        const famKeyOfX = (x) => (x && (x.parentAsin || x.asin)) || null;
        const isMultiFam = (x) => Number(x.variantCount || 0) >= 2;
        if (q.get('famKey')) { const fk = String(q.get('famKey')); list = list.filter((x) => famKeyOfX(x) === fk); }
        const famFilter = q.get('famFilter');
        if (famFilter === 'multi') list = list.filter(isMultiFam);
        else if (famFilter === 'variant') list = list.filter((x) => isMultiFam(x) && x.familyKind === 'variant');
        else if (famFilter === 'sibling') list = list.filter((x) => isMultiFam(x) && x.familyKind === 'sibling');
        else if (famFilter === 'confirmed') list = list.filter((x) => isMultiFam(x) && (x.variantSrc === 'twister' || x.variantSrc === 'card'));
        else if (famFilter === 'manual') list = list.filter((x) => isMultiFam(x) && x.variantSrc === 'manual');
        else if (famFilter === 'hideGuess') list = list.filter((x) => !(isMultiFam(x) && x.variantSrc === 'title'));   // 隐藏标题推测族
        else if (famFilter === 'repOnly') list = list.filter((x) => !(isMultiFam(x) && x.variantRole === 'child'));     // 只看族代表(服务端折叠)
        // ★ 族内任一满足 → 整族保留: 把同族未被筛中的成员补回来(选品直觉: 这个族里有符合条件的就是目标)
        if (q.get('famAny') === '1') {
          const keepFams = new Set();
          list.forEach((x) => { const k = famKeyOfX(x); if (k) keepFams.add(k); });
          const hit = new Set(list.map((x) => x.asin));
          list = products.filter((x) => hit.has(x.asin) || (famKeyOfX(x) && keepFams.has(famKeyOfX(x))));
        }
        if (q.get('badge')) list = list.filter((x) => x.badge === q.get('badge'));          // bestseller / choice / deal
        // A+ 页面筛选: aplus=1 仅有 A+ / aplus=0 排除 A+ (与采集过滤同语义)
        if (q.get('aplus') === '1') list = list.filter((x) => x.aplus);
        else if (q.get('aplus') === '0') list = list.filter((x) => !x.aplus);
        if (q.get('q')) { const s = q.get('q').toLowerCase(); list = list.filter((x) => x.title.toLowerCase().includes(s) || x.asin.toLowerCase().includes(s)); }
        if (q.get('compliance')) {
          // 模拟采集时实时合规检测结果
          list = list.map((x) => ({ ...x, compliance: complianceCheck(x) }));
        }
        // 分页: 以前 limit / offset 被完全忽略 (传 limit=60 也会返回全库 4MB) —— 对接方会以为拿到了前 60 条
        // 现在: 不传 limit → 仍返回全部 (插件就是靠这个拿全量做本地筛选, 保持兼容);
        //       传了 limit → 按 limit/offset 切片, 并把 total(符合条件总数)/returned(本次返回数) 都回给调用方
        // 分页: 必须从原始 URL 参数读 (q 在带 filter= 时是过滤条件换算出来的查询串, 里面没有 limit)
        const limitRaw = url.searchParams.get('limit');
        const offsetRaw = url.searchParams.get('offset');
        const totalAll = list.length;
        let returned = totalAll, offUsed = 0;
        if (limitRaw !== null && limitRaw !== '' && !isNaN(parseInt(limitRaw, 10))) {
          const lim = Math.min(5000, Math.max(1, parseInt(limitRaw, 10)));
          offUsed = (offsetRaw !== null && offsetRaw !== '' && !isNaN(parseInt(offsetRaw, 10))) ? Math.max(0, parseInt(offsetRaw, 10)) : 0;
          list = list.slice(offUsed, offUsed + lim);
          returned = list.length;
        }
        return send(200, { total: totalAll, returned, offset: offUsed, items: list });
      }

      // 面板补全更新 (对已入库商品重新读插件面板, 全程 CDP, 修正品牌/商标/排名/销量)
      if (p === '/api/products/panel-refresh' && req.method === 'POST') {
        let asins = (j.asins || []);
        // 未指定时默认处理品牌链采集的 cdp-brand 商品
        if (!asins.length) asins = products.filter((x) => x.source === 'cdp-brand').map((x) => x.asin);
        if (!asins.length) return send(200, { updated: 0, note: '没有需要补全的商品' });
        // ★ 2026-09 改造: 注册采集进度 + 忙碌守卫。
        //   为什么必须加: 「补采」按钮会把它和 refresh-detail 串起来跑, 没有进度前端只能干等
        //   (每个商品 9s 起, 面板分析还要再等 12~36s)。守卫与 refresh-detail 同一套, 防止并发跑两个 CDP 循环。
        if (collectProgress && collectProgress.running) return send(409, { error: '已有采集正在运行 (mode=' + collectProgress.mode + '), 请先点「停止」等当前步骤结束后再开始' });
        beginCollectProgress('panel-refresh', '插件面板补采 (商标/月销/尺寸重量)');
        let updated = 0, failed = 0;
        try {
          const tabs = await cdpGetTabs();
          const page = tabs.find((t) => t.type === 'page');
          // ★ 提前返回前必须 endCollectProgress(), 否则进度永远停在 running → 后续采集全被 409 拒绝
          if (!page) { endCollectProgress(); return send(500, { error: 'Edge 无页面标签, 请确认 9222 已开' }); }
          const { send } = await cdpConnect(page.webSocketDebuggerUrl);
          for (let i = 0; i < asins.length; i++) {
            const asin = asins[i];
            const prod = products.find((x) => x.asin === asin);
            if (!prod) continue;
            // ★ 逐商品用自己的站点算域名: 旧实现把 asins[0] 的站点给所有商品用 —— 一次补采混了多站点商品时,
            //   会把 de 的 ASIN 拼到 co.uk 上, 面板读不到, 整批记失败。
            const domain = siteToHostSuffix(prod.site || 'uk');
            bumpCollectProgress({ items: asins.length, added: updated, step: '面板补采 ' + asin + ' (' + (i + 1) + '/' + asins.length + ')' });
            const pd = await cdpReadOnePanel(send, asin, domain).catch((e) => ({ error: 'CDP异常: ' + e.message }));
            if (pd.error) { failed++; continue; }
            // 更新商品字段 (以插件面板为准)
            const tm = pd.tmText || '';
            prod.brand = pd.brand || prod.brand;
            prod.brandStatus = /已注册|已备案/.test(tm) ? 'registered' : /未查到/.test(tm) ? 'notfound' : /注册商标/.test(tm) ? 'unchecked' : prod.brandStatus;
            prod.trademarkCount = pd.trademarkCount || prod.trademarkCount;
            prod.tmMark = /TM|注册商标/.test(tm);
            prod.fulfill = pd.fulfill || prod.fulfill;
            prod.followCount = pd.sellerCount != null ? pd.sellerCount : prod.followCount;
            prod.sellerId = pd.seller || prod.sellerId;
            prod.monthlySales = pd.sales30d ? parseInt(String(pd.sales30d).replace(/[<>\s]/g, ''), 10) || prod.monthlySales : prod.monthlySales;
            prod.size = pd.size || prod.size;
            prod.weight = pd.weight || prod.weight;
            prod.packSize = pd.packSize || prod.packSize;
            prod.packWeight = pd.packWeight || prod.packWeight;
            prod.color = pd.color || prod.color;
            prod.variantSize = pd.variantSize || prod.variantSize;
            prod.fbaFee = pd.fbaFee || prod.fbaFee;
            prod.productType = pd.productType || prod.productType;
            // ★ 2026-09 变体族: 面板「变体：N个」→ card 级证据(仅当还没有 twister 结构时写, 不覆盖数组)
            if (pd.variants != null && !(Array.isArray(prod.variants) ? prod.variants.length : (Number(prod.variants) > 0))) prod.variants = pd.variants;
            prod.listedAt = (pd.listedAt || '').slice(0, 10) || prod.listedAt;
            prod.bsr = pd.bsr && pd.bsr.length ? pd.bsr : prod.bsr;
            // ★ 2026-09 修复: 面板里的「店铺选品 #N」(宽类目) 才是大排名(rankParent)。
            //   旧实现只写 bsr(小排名口径) → 「一键补采」补不到大排名; 只有「补采排名」那条路会 mergePanelRanks。
            //   这里把面板排名按既有"字段分离"约定并入: 店铺选品→bsrShop, 榜单选品→bsrCat, 再 applyRankFields 同步 rankParent/rankChild。
            {
              const digitsOf = (v) => { const m = String(v == null ? '' : v).replace(/[^\d]/g, ''); return m ? Number(m) : null };
              const rShop = digitsOf(pd.bsrShop), rCat = digitsOf(pd.bsrCat);
              if (rShop != null) { prod.bsrShop = rShop; if (pd.bsrShopCat) prod.bsrShopCat = pd.bsrShopCat; }
              if (rCat != null) { prod.bsrCat = rCat; if (pd.bsrCatName) prod.bsrCatName = pd.bsrCatName; }
              if (rShop != null || rCat != null) applyRankFields(prod);
            }
            prod.aiRiskLevel = prod.brandStatus === 'registered' ? 'high' : prod.trademarkCount > 0 ? 'medium' : 'low';
            prod.aiScore = Math.round(Math.min(96, Math.max(25, 80 - prod.trademarkCount * 0.8 - (prod.brandStatus === 'registered' ? 20 : 0))));
            prod.panelRefreshedAt = now();
            updated++;
          }
          save('products.json', products);
          endCollectProgress();
          pushNotify('面板补全完成', `修正 ${updated} 个商品插件数据 (全程CDP)`, `品牌/商标/排名/销量已更新, 失败 ${failed} 个`);
          return send(200, { updated, failed, total: products.length });
        } catch (e) {
          endCollectProgress();
          return send(500, { error: e.message });
        }
      }

      // 批量删除商品
      if (p === '/api/products/delete' && req.method === 'POST') {
        const asins = j.asins || [];
        const before = products.length;
        products = products.filter((x) => !asins.includes(x.asin));
        save('products.json', products);
        return send(200, { deleted: before - products.length, remain: products.length });
      }

      // 一键清空商品库 (显式用户操作, 允许写空 force=true)
      if (p === '/api/products/clear' && req.method === 'POST') {
        const before = products.length;
        products = [];
        save('products.json', products, true);
        return send(200, { cleared: before, remain: 0 });
      }

      // 重置商品库 (恢复种子数据)
      if (p === '/api/products/reset' && req.method === 'POST') {
        try {
          const seedFile = path.join(ROOT, '_tools', '_build_demo_data.js');
          const code = fs.readFileSync(seedFile, 'utf8');
          // 在子进程中执行生成器 (独立 require 缓存, 避免污染)
          const { execFileSync } = require('child_process');
          execFileSync(process.execPath, [seedFile], { stdio: 'ignore', windowsHide: true });
          products = load('products.json', []);
          return send(200, { reset: true, total: products.length });
        } catch (e) {
          // 子进程被沙箱拦截时, 直接内联执行生成逻辑
          try {
            const seedFile = path.join(ROOT, '_tools', '_build_demo_data.js');
            delete require.cache[require.resolve(seedFile)];
            require(seedFile);
            products = load('products.json', []);
            return send(200, { reset: true, total: products.length, mode: 'inline' });
          } catch (e2) {
            return send(500, { error: '重置失败: ' + e2.message });
          }
        }
      }

      // 手工拆/合变体族: 只写标记(variantSolo / variantManualKey), 不动统计 —— 客户端接着调 rebuild-variant-groups 重算。
      // 为什么需要: 标题推测(C级)会有误判; 人工结论必须能覆盖, 且能在后续 rebuild 中保留。
      if (p === '/api/products/variant-override' && req.method === 'POST') {
        const asin = String(j.asin || '').trim();
        const action = String(j.action || '').trim();
        if (!asin || !action) return send(400, { error: '需要 asin 与 action(split|merge|reset)' });
        const it = products.find((x) => x && x.asin === asin);
        if (!it) return send(404, { error: '库里没有这个 ASIN: ' + asin });
        let touched = 0;
        if (action === 'split') {
          // 拆出: 该商品自成一家(不再参与自动聚类)
          it.variantSolo = true; delete it.variantManualKey; touched = 1;
        } else if (action === 'merge') {
          // 并入: 把该商品并到 into 那一族。为了下次 rebuild 仍归在一起, 需要给【目标族现有全部成员】也打上同一个族键。
          const into = String(j.into || '').trim();
          if (!into) return send(400, { error: 'merge 需要 into=<目标族代表 ASIN>' });
          const famKey = 'm:' + into;
          const members = products.filter((x) => x && (x.asin === into || x.parentAsin === into));
          members.forEach((x) => { x.variantManualKey = famKey; x.variantSolo = false; touched++; });
          if (!members.some((x) => x.asin === asin)) { it.variantManualKey = famKey; it.variantSolo = false; touched++; }
        } else if (action === 'reset') {
          // 还原为自动识别
          delete it.variantSolo; delete it.variantManualKey; touched = 1;
        } else return send(400, { error: '未知 action: ' + action });
        save('products.json', products);
        return send(200, { ok: true, asin, action, touched, note: '标记已写入; 请接着调用 /api/products/rebuild-variant-groups 重算族' });
      }

      // 重建变体族: 纯计算(不读页面, 秒级, 幂等可重复执行) —— 重算 variantKey, 划分族, 选族代表, 写角色/族大小。
      // 为什么需要: 族代表与族大小要全库视角, 单条入库时算不出来(新采集的商品先有 key, 跑一次本接口即归位)。
      if (p === '/api/products/rebuild-variant-groups' && req.method === 'POST') {
        const t0 = Date.now();
        for (const x of products) { if (x && x.asin) computeVariantKey(x); }     // ① 逐条算键
        const fam = new Map();                                                  // ② 按键分族
        for (const x of products) {
          if (!x || !x.asin || !x.variantKey) continue;
          if (!fam.has(x.variantKey)) fam.set(x.variantKey, []);
          fam.get(x.variantKey).push(x);
        }
        const repBy = String(j.repBy || 'follow');                              // 族代表规则(默认跟卖数最多)
        const scoreOf = (x) => {
          if (repBy === 'rank') { const r = x.rankParent; return r == null ? -Infinity : -r; }   // 排名数字越小越好
          if (repBy === 'sales') return Number(x.monthlySales) || 0;
          if (repBy === 'price') { const v = (x.minPrice != null ? x.minPrice : x.price); return v == null ? -Infinity : v; }  // 价低优先
          return Number(x.followCount) || 0;                                    // 默认: 跟卖数最多
        };
        let famTotal = 0, famMulti = 0, itemsInMulti = 0, kindVariant = 0, kindSibling = 0;
        const bigFams = [];
        for (const [, list] of fam.entries()) {
          famTotal++;
          if (list.length === 1) {
            const x = list[0];
            x.variantRole = 'standalone'; x.parentAsin = x.asin; x.variantCount = 1;
            continue;
          }
          famMulti++; itemsInMulti += list.length;
          // 有 twister 权威父 → 直接用; 否则按规则挑代表(tie-break: ASIN 升序, 保证结果稳定)
          const twister = list.filter((x) => x.variantSrc === 'twister' && String(x.parentAsin || '') === String(x.asin));
          const rep = twister[0] || list.slice().sort((a, b) => (scoreOf(b) - scoreOf(a)) || String(a.asin).localeCompare(String(b.asin)))[0];
          // ★ 族类型: 'variant' = 成员差异只在颜色/尺寸/数量等变体维度(真变体);
          //          'sibling' = 差异在型号/适配等其他词(同款多型号铺货)。
          //   为什么必须区分(实测): 最大的族是「同一款贴纸铺给 124 个不同摩托车车型」—— 那是铺货行为, 不是颜色变体,
          //   管理动作完全不同(变体要合并看规格, 铺货要看铺了多少型号/是否值得跟)。界面按此打标。
          const diffWords = new Set();
          const tokenSets = list.map((x) => new Set(String(x.title || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean)));
          tokenSets.forEach((ts) => ts.forEach((w) => { if (!tokenSets.every((o) => o.has(w))) diffWords.add(w); }));
          const diffArr = [...diffWords];
          const variantish = (w) => VARIANT_WORDS.has(w) || /^\d+$/.test(w);
          const kind = diffArr.length && diffArr.every(variantish) ? 'variant' : 'sibling';
          list.forEach((x) => { x.parentAsin = rep.asin; x.variantRole = (x === rep) ? 'parent' : 'child'; x.variantCount = list.length; x.familyKind = kind; });
          if (kind === 'variant') kindVariant++; else kindSibling++;
          if (bigFams.length < 12 || list.length > bigFams[bigFams.length - 1].n) {
            bigFams.push({ n: list.length, key: list[0].variantKey, sample: String(list[0].title || '').slice(0, 50), brand: list[0].brand || null });
            bigFams.sort((a, b) => b.n - a.n); if (bigFams.length > 12) bigFams.pop();
          }
        }
        let lowQuality = 0;
        for (const x of products) {
          if (!x || !x.asin) continue;
          if (!x.variantKey) { x.parentAsin = x.asin; x.variantRole = 'none'; x.variantCount = 1; lowQuality++; }
        }
        save('products.json', products);
        const srcHist = {};
        for (const x of products) { const k = (x && x.variantSrc) || 'none'; srcHist[k] = (srcHist[k] || 0) + 1; }
        return send(200, {
          ok: true, total: products.length, families: famTotal, multiFamilies: famMulti,
          itemsInFamilies: itemsInMulti, standaloneFamilies: famTotal - famMulti, lowQualityRows: lowQuality,
          src: srcHist, repBy, familyKind: { variant: kindVariant, sibling: kindSibling }, biggest: bigFams, ms: Date.now() - t0,
        });
      }

      // 重建排名字段: 为存量商品按新口径重算 父类排名/子类排名 (不新增商品, 只补字段)
      if (p === '/api/products/rebuild-rank-fields' && req.method === 'POST') {
        let done = 0, withParent = 0, withChild = 0;
        products.forEach((x) => {
          applyRankFields(x);
          done++;
          if (x.rankParent != null) withParent++;
          if (x.rankChild != null) withChild++;
        });
        save('products.json', products);   // 覆盖前自动备份
        return send(200, { ok: true, total: done, withParent, withChild, withoutParent: done - withParent });
      }

      // 保存/取消保存商品 (产品库收藏)
      if (p === '/api/products/save' && req.method === 'POST') {
        const asins = j.asins || [];
        let n = 0;
        products.forEach((x) => { if (asins.includes(x.asin)) { x.saved = j.saved !== false; n++; } });
        save('products.json', products);
        return send(200, { saved: n, state: j.saved !== false });
      }

      // 批量同步 (模拟重新采集刷新: 更新采集时间/价格/月销)
      if (p === '/api/products/sync' && req.method === 'POST') {
        const asins = j.asins || products.map((x) => x.asin);
        let n = 0;
        products.forEach((x) => {
          if (asins.includes(x.asin)) {
            x.collectedAt = now();
            x.price = Math.round((x.price * (0.95 + Math.random() * 0.1)) * 100) / 100;
            x.monthlySales = Math.round(x.monthlySales * (0.9 + Math.random() * 0.2));
            x.followCount = Math.max(0, x.followCount + (Math.random() < 0.4 ? 1 : 0));
            n++;
          }
        });
        save('products.json', products);
        return send(200, { synced: n });
      }

      // 店铺 → 详情页插件面板采集 (核心: FBM/商标/排名 来自插件内部信息)
      if (p === '/api/collect/panel' && req.method === 'POST') {
        const url = j.url || '';
        if (!/^https:\/\/www\.amazon\./.test(url)) return send(400, { error: '无效的 amazon 店铺 URL' });
        const count = Math.min(20, Math.max(1, j.count || 5));
        let out;
        try {
          out = await cdpPanelCollect(url, count);
          endCollectProgress();
        } catch (e) {
          endCollectProgress();
          return send(500, { error: e.message });
        }
        const site = out.site;
        const currency = siteCurrency(site);   // 按站点真实币种 (旧实现把非 uk/us 一律写成 EUR)
        const used = new Set(products.map((x) => x.asin));
        let added = 0;
        const imported = [];
        for (const it of out.results) {
          if (it.error || used.has(it.asin)) continue;
          used.add(it.asin);
          const price = null;   // 插件面板不含价格 → 未知 (绝不随机编价)
          const item = {
            id: it.asin, asin: it.asin, rank: null, title: it.title || '', brand: it.brand || 'Unknown',
            brandStatus: it.brandStatus === '已备案' ? 'registered' : it.brandStatus && it.brandStatus !== '未查到' ? 'unchecked' : 'notfound',
            bgMark: false, tmMark: /TM/.test(it.brandStatus || ''), patentRisk: false,
            trademarkCount: (it.brandStatus || '').match(/(\d+)/) ? parseInt((it.brandStatus || '').match(/(\d+)/)[1], 10) : 0,
            followCount: it.sellerCount || 0, chinaSeller: chinaSellerOf(it), sellerCountryCode: sellerCountryCodeOf(it),
            fulfill: it.fulfill || null, amazonSell: null,   // 未核实的配送/自营 → null (不伪造成 FBM)
            price, currency, monthlySales: parseInt(String(it.sales30d || '').replace(/[<>\s]/g, ''), 10) || null,
            reviews: null, rating: null, stock: null,   // 面板读不到 → null (不写死 0 分 / 4 分)
            listedAt: (it.listedAt || '').slice(0, 10) || null,   // 读不到上架日期 → null (不写"今天")
            size: it.size, weight: it.weight, variations: 0,
            referralFee: null, netProfit: null,
            site, category: 'Shop', collectedAt: now(), source: 'cdp-panel', saved: false, real: true,
            sellerId: it.seller, bsr: it.bsr || [], fbaFee: it.fbaFee || null, productType: it.productType || null,
          };
          item.aiScore = Math.round(Math.min(96, Math.max(30, 80 - item.trademarkCount * 0.5)));
          item.aiRiskLevel = it.brandStatus === '已备案' ? 'high' : it.brandStatus && it.brandStatus !== '未查到' ? 'medium' : 'low';
          item.aiSuggestPrice = null;   // 价格未知 → 派生字段一律 null
          products.unshift(applyRankFields(item));
          added++;
          imported.push(item);
        }
        save('products.json', products);
        pushNotify('插件面板采集完成', `读取 ${out.results.length} 个商品插件面板, 新增 ${added} 个`, `来源: 智赢插件内部信息 (FBM/商标/排名)`);
        return send(200, { added, total: products.length, site, results: out.results, imported: imported.map((x) => ({ asin: x.asin, brand: x.brand, brandStatus: x.brandStatus, fulfill: x.fulfill, sales30d: x.monthlySales, bsr: x.bsr })) });
      }

      // 列表页直采 (不跳详情页): 直接读列表页所有商品 + 智赢插件注入信息 (FBA/卖家数/排名/1688同款)
      if (p === '/api/collect/list-direct' && req.method === 'POST') {
        const url = String(j.url || '').trim();
        if (!/^https:\/\/(www\.)?amazon\./.test(url)) return send(400, { error: '无效的 amazon 列表页 URL' });
        const maxItems = Math.min(200, Math.max(1, j.maxItems || 100));
        const maxPages = Math.min(10, Math.max(1, j.maxPages || 1));   // 列表页翻页 (一次采多页)
        const waitPluginMs = Math.min(30000, Math.max(0, j.waitPluginMs != null ? j.waitPluginMs : 15000));
        let out;
        try {
          out = await cdpListDirectCollect(url, { maxItems, maxPages, waitPluginMs });
          endCollectProgress();
        } catch (e) {
          endCollectProgress();
          return send(500, { error: e.message });
        }
        // 通知
        const withPlugin = out.products.filter((x) => x.fulfill || x.sellerCount != null || (x.bsr && x.bsr.length)).length;
        pushActivity('collect', '列表页直采: ' + (out.pagesDone || 1) + ' 页 / 采到 ' + out.total + ' / 入库 ' + out.added, { site: out.site, url: url });
        pushNotify('列表页直采完成', `${out.pagesDone || 1} 页共 ${out.total} 个商品, 新增 ${out.added} 个`, `插件信息(FBA/卖家数/排名)覆盖 ${withPlugin}/${out.productCount} 个 | 价格被插件替换为人民币, 未入库原生价`);
        return send(200, { site: out.site, url, maxPages, pagesDone: out.pagesDone, total: out.total, productCount: out.productCount, added: out.added, withPlugin, products: out.products });
      }

      // 列表页筛选采集: 列表页直采(含插件信息) → 采集筛选前置过滤 → 只跳转通过筛选的商品取详情页数据
      if (p === '/api/collect/list-filtered' && req.method === 'POST') {
        const url = String(j.url || '').trim();
        if (!/^https:\/\/(www\.)?amazon\./.test(url)) return send(400, { error: '无效的 amazon 列表页 URL' });
        const maxItems = Math.min(200, Math.max(1, j.maxItems || 100));
        const maxPages = Math.min(10, Math.max(1, j.maxPages || 1));
        const waitPluginMs = Math.min(30000, Math.max(0, j.waitPluginMs != null ? j.waitPluginMs : 15000));
        const filter = buildCollectFilter(j);
        const withAod = j.aod !== false;
        const withPanel = j.panel !== false;   // 详情补全默认读插件面板 (商标数/商标国家), panel=false 关闭
        let out;
        try {
          out = await cdpListFilteredCollect(url, { maxItems, maxPages, waitPluginMs, filter, aod: withAod, panel: withPanel });
          endCollectProgress();
        } catch (e) {
          endCollectProgress();
          return send(500, { error: e.message });
        }
        pushNotify('列表页筛选采集完成', `${out.total} 个 → 前置筛掉 ${out.skippedByList} 个 → 跳详情 ${out.enriched} 个 → 入库 ${out.added} 个`, `过滤: ${filterDesc(filter)}${out.preFiltered ? ', 前置筛选(插件FBA/排名/关键词)通过 ' + out.preFiltered + ' 个' : ''}${withAod ? ', 已采 aod 跟卖' : ''}`);
        return send(200, { site: out.site, url, maxPages, total: out.total, preFiltered: out.preFiltered, skippedByList: out.skippedByList, enriched: out.enriched, productCount: out.productCount, added: out.added, filter, aod: withAod, products: out.products });
      }

      // 类目搜索采集 (关键词/类目搜索页 → 商品列表, 全程 CDP)
      if (p === '/api/collect/category' && req.method === 'POST') {
        const site = j.site || 'de';
        const keyword = (j.keyword || '').trim();
        const category = (j.category || '').trim();
        if (!keyword && !category) return send(400, { error: '请输入关键词或类目' });
        const maxPages = Math.min(10, Math.max(1, j.maxPages || 2));
        const filter = buildCollectFilter(j);
        let out;
        try {
          out = await cdpCategoryCollect({ site, keyword, category, maxPages, filter });
          endCollectProgress();
        } catch (e) {
          endCollectProgress();
          return send(500, { error: e.message });
        }
        const currency = siteCurrency(site);   // 按站点币种 (AU→AUD, MX→MXN…), 不再一律 EUR
        const used = new Set(products.map((x) => x.asin));
        let added = 0;
        for (const p of out.products) {
          if (used.has(p.asin)) continue;
          used.add(p.asin);
          const price = parseMoneyText(p.price, p.site || site) || null;   // ★ 站点感知   // 价格读不到 → null (绝不随机伪造)
          const pBsr2 = (Array.isArray(p.bsr) ? p.bsr : []).map((b) => (typeof b === 'number' ? { rank: b, category: null } : (b && b.rank != null ? b : null))).filter(Boolean);
          const maxR = pBsr2.length ? Math.max.apply(null, pBsr2.map((b) => b.rank)) : null;
          const item = {
            id: p.asin, asin: p.asin, rank: maxR != null ? '#' + maxR : null, title: p.title, brand: p.brand || null,
            brandStatus: 'unchecked', bgMark: false, tmMark: !!p.tmMark, patentRisk: false, trademarkCount: p.trademarkCount || 0,
            followCount: 0, chinaSeller: chinaSellerOf(p), sellerCountryCode: sellerCountryCodeOf(p),
            // 详情页补全后的真实值 (未读到一律 null, 不再写死 FBM / 4 分 / 随机月销)
            fulfill: p.fulfill || null, amazonSell: p.detailOk ? !!p.amazonSell : null, mainSeller: p.mainSeller || null,
            mainImage: p.mainImage || null, aplus: p.detailOk ? !!p.aplus : null,
            detailOk: !!p.detailOk, detailAt: p.detailAt || null, priceSymbol: p.priceSymbol || null,
            cat1: p.cat1 || null, cat2: p.cat2 || null, cat3: p.cat3 || null, catPath: p.catPath || null,
            catNodes: p.catNodes || null, catSrc: p.catPath ? 'bc' : null,
            tmCountries: p.tmCountries || [], tmText: p.tmText || null,
            price, currency, monthlySales: p.monthlySales || 0,
            reviews: p.reviews != null ? p.reviews : null, rating: p.rating != null ? p.rating : null, stock: 0,
            listedAt: (p.firstAvailable || '').slice(0, 10) || null, size: p.size || null, weight: p.weight || null, variations: 0,
            bsr: pBsr2,
            referralFee: price != null ? Math.round(price * (referralRateFor(p.cat1).rate / 100) * 100) / 100 : null, netProfit: null,
            site, category: p.category || category || 'Search', collectedAt: now(), source: 'category-search', saved: false, real: true, badge: p.badge || null,
          };
          // 价格未知 → 派生字段一律 null (不写 0, 更不写负数)
          item.netProfit = price != null ? Math.round((item.price - item.referralFee - 3.2 - item.price * 0.3) * 100) / 100 : null;
          item.aiScore = null;   // ★ P0-3d: 无任何真实输入 → null (常量 40 会被 agentAssess 当成"谨慎跟卖"的评分)
          item.aiRiskLevel = 'low';
          item.aiSuggestPrice = price != null ? Math.round((item.price - 0.5) * 100) / 100 : null;
          products.unshift(applyRankFields(item));
          added++;
        }
        save('products.json', products);
        pushNotify('类目搜索采集完成', `「${keyword || category}」搜索页抓取 ${out.products.length} 个${out.skipped ? ', 过滤跳过 ' + out.skipped + ' 个' : ''}`, `新增 ${added} 个 (站点: ${site}, 全程CDP, 过滤: ${filterDesc(filter)})`);
        return send(200, { added, total: products.length, site, productCount: out.products.length, skipped: out.skipped || 0, filter, keyword, category });
      }

      // 并行整站采集: 一次并行打开 N 个搜索页, 聚合大量商品 (不翻页, 耗时≈单页加载)
      if (p === '/api/collect/site-bulk' && req.method === 'POST') {
        const site = j.site || 'de';
        const keyword = (j.keyword || '').trim();
        const category = (j.category || '').trim();
        if (!keyword && !category) return send(400, { error: '请输入关键词或类目' });
        const pages = Math.min(10, Math.max(1, j.pages || 5));
        const maxItems = Math.min(100, Math.max(1, j.maxItems || 50));
        // ★ 2026-09 统一不跳转: 默认不再逐个商品跳详情页读详情 (旧默认 true)。需要旧行为时传 detail=1。
        const withDetail = j.detail === true;
        const filter = buildCollectFilter(j);
        let out;
        try {
          out = await cdpSiteBulkCollect({ site, keyword, category, pages, maxItems, detail: withDetail, filter });
          endCollectProgress();
        } catch (e) {
          endCollectProgress();
          return send(500, { error: e.message });
        }
        if (!out.products.length) return send(404, { error: '未提取到商品 (可能需登录或页面结构变化)' });
        // 入库
        const currency = siteCurrency(site);   // 按站点真实币种 (旧实现把非 uk/us 一律写成 EUR)
        const used = new Set(products.map((x) => x.asin));
        let added = 0;
        for (const p of out.products) {
          if (used.has(p.asin)) continue;
          used.add(p.asin);
          const price = (p.price != null && !isNaN(Number(p.price))) ? Number(p.price) : parseMoneyText(p.price, p.site || site);   // ★ 站点感知
          const item = {
            id: p.asin, asin: p.asin, rank: null, title: p.title, brand: p.brand || null,
            brandStatus: 'unchecked', bgMark: false, tmMark: false, patentRisk: false, trademarkCount: 0,
            followCount: 0, chinaSeller: chinaSellerOf(p), sellerCountryCode: sellerCountryCodeOf(p), fulfill: p.fulfill || null, amazonSell: null,
            price, currency,
            monthlySales: 0, reviews: null, rating: (typeof p.rating === 'number' ? p.rating : (parseFloat(String(p.rating || '').match(/[\d.]+/)?.[0]) || null)), stock: 0,
            listedAt: null, size: null, weight: null, variations: 0,
            badge: p.badge || null, aplus: p.aplus || false, bsr: (p.bsr || []).map((r) => ({ rank: r, category: null })),
            rank: p.bsr && p.bsr.length ? '#' + Math.max(...p.bsr) : null,
            referralFee: null, netProfit: null,
            site, category: category || keyword || 'Search', collectedAt: now(), source: 'site-bulk', saved: false, real: true,
          };
          if (price != null) {
            item.referralFee = Math.round(price * 0.15 * 100) / 100;
            item.netProfit = Math.round((item.price - item.referralFee - 3.2 - item.price * 0.3) * 100) / 100;
            item.aiSuggestPrice = Math.round((item.price - 0.5) * 100) / 100;
          } else {
            item.referralFee = null; item.netProfit = null; item.aiSuggestPrice = null;   // 价格未知 → 派生字段一律 null
          }
          item.aiScore = Math.round(Math.min(96, Math.max(30, 80 - item.trademarkCount * 0.5)));
          item.aiRiskLevel = 'low';
          products.unshift(applyRankFields(item));
          added++;
        }
        save('products.json', products);
        pushNotify('并行整站采集完成', `「${keyword || category}」${pages} 页并行, 抓取 ${out.products.length} 个${out.skipped ? ', 过滤跳过 ' + out.skipped + ' 个' : ''}`, `新增 ${added} 个 (站点: ${site}, 耗时≈单页, 全程CDP, 过滤: ${filterDesc(filter)})`);
        return send(200, { added, total: products.length, site, pages, productCount: out.products.length, skipped: out.skipped || 0, filter, keyword, category, withDetail });
      }

      // 类目菜单导航采集: 首页 → 大类目 → 二级类目 → See all results → 商品 (全程 CDP)
      if (p === '/api/collect/category-menu' && req.method === 'POST') {
        const site = j.site || 'de';
        const category = (j.category || '').trim();
        const pages = Math.min(10, Math.max(1, j.pages || 3));
        const maxItems = Math.min(100, Math.max(1, j.maxItems || 50));
        // ★ 2026-09 统一不跳转: 默认不再逐个商品跳详情页 (旧默认 true)。需要旧行为时传 detail=1。
        const withDetail = j.detail === true;
        // 采集过滤: 与列表自定义筛选同条件 (配送/A+/排名/价格/评分/评论/关键词/标签/类目/站点)
        const filter = buildCollectFilter(j);
        let out;
        try {
          out = await cdpCategoryMenuCollect({ site, category, pages, maxItems, detail: withDetail, filter });
          endCollectProgress();
        } catch (e) {
          endCollectProgress();
          return send(500, { error: e.message });
        }
        if (!out.products.length) return send(404, { error: '未提取到商品 (或过滤后无符合条件的商品)' });
        // 入库
        const currency = siteCurrency(site);   // 按站点真实币种 (旧实现把非 uk/us 一律写成 EUR)
        const used = new Set(products.map((x) => x.asin));
        let added = 0;
        for (const p of out.products) {
          if (used.has(p.asin)) continue;
          used.add(p.asin);
          const price = (p.price != null && !isNaN(Number(p.price))) ? Number(p.price) : parseMoneyText(p.price, p.site || site);   // ★ 站点感知
          const item = {
            id: p.asin, asin: p.asin, rank: null, title: p.title, brand: p.brand || null,
            brandStatus: 'unchecked', bgMark: false, tmMark: false, patentRisk: false, trademarkCount: 0,
            followCount: 0, chinaSeller: chinaSellerOf(p), sellerCountryCode: sellerCountryCodeOf(p), fulfill: p.fulfill || null, amazonSell: null,
            price, currency,
            monthlySales: 0, reviews: p.reviews != null ? p.reviews : null, rating: (typeof p.rating === 'number' ? p.rating : (parseFloat(String(p.rating || '').match(/[\d.]+/)?.[0]) || null)), stock: 0,
            listedAt: null, size: null, weight: null, variations: 0,
            badge: null, aplus: p.aplus || false,
            bsr: (p.bsr || []).map((r) => ({ rank: r, category: null })),
            rank: p.bsr && p.bsr.length ? '#' + Math.max(...p.bsr) : null,
            referralFee: null, netProfit: null,
            site, category: category || 'Browse', collectedAt: now(), source: 'category-menu', saved: false, real: true,
          };
          if (price != null) {
            item.referralFee = Math.round(price * 0.15 * 100) / 100;
            item.netProfit = Math.round((item.price - item.referralFee - 3.2 - item.price * 0.3) * 100) / 100;
            item.aiSuggestPrice = Math.round((item.price - 0.5) * 100) / 100;
          } else {
            item.referralFee = null; item.netProfit = null; item.aiSuggestPrice = null;   // 价格未知 → 派生字段一律 null
          }
          item.aiScore = Math.round(Math.min(96, Math.max(30, 80 - item.trademarkCount * 0.5)));
          item.aiRiskLevel = 'low';
          products.unshift(applyRankFields(item));
          added++;
        }
        save('products.json', products);
        pushNotify('类目菜单采集完成', `${(out.steps || []).join(' → ')}`, `抓取 ${out.products.length} 个, 过滤跳过 ${out.skipped || 0} 个, 新增 ${added} 个 (站点: ${site}, 全程CDP)`);
        return send(200, { added, total: products.length, site, pages, productCount: out.products.length, skipped: out.skipped || 0, category, steps: out.steps, filter });
      }

      // 详情页品牌跳转采集 (商品详情页 → 品牌链接 → 品牌全部商品, 全程 CDP)
      if (p === '/api/collect/dp-brand' && req.method === 'POST') {
        const url = j.url || '';
        if (!/^https:\/\/www\.amazon\./.test(url)) return send(400, { error: '无效的 amazon 商品详情页 URL' });
        const maxPages = Math.min(20, Math.max(1, j.maxPages || 5));
        let out;
        try {
          out = await cdpDpBrand(url, maxPages);
          endCollectProgress();
        } catch (e) {
          endCollectProgress();
          return send(500, { error: e.message });
        }
        const site = out.site;
        const currency = siteCurrency(site);   // 按站点真实币种 (旧实现把非 uk/us 一律写成 EUR)
        const used = new Set(products.map((x) => x.asin));
        let added = 0;
        const imported = [];
        for (const p of out.products) {
          if (used.has(p.asin)) continue;
          used.add(p.asin);
          const price = parseMoneyText(p.price, p.site || site) || null;   // ★ 站点感知   // 价格读不到 → null (绝不随机伪造)
          const item = {
            id: p.asin, asin: p.asin, rank: null, title: p.title, brand: out.brandName || null,
            brandStatus: 'unchecked', bgMark: false, tmMark: false, patentRisk: false, trademarkCount: 0,
            followCount: 0, chinaSeller: chinaSellerOf(p), sellerCountryCode: sellerCountryCodeOf(p), fulfill: null, amazonSell: null,   // 品牌页列表无配送/自营信息 → null (不写死 FBM)
            price, currency, monthlySales: null,   // 品牌页列表不提供月销 → null (原为随机值)
            reviews: null, rating: null, stock: null,   // 不写死 0 评论 / 4 分
            listedAt: null, size: null, weight: null, variations: 0,   // 读不到上架日期 → null (不写"今天")
            referralFee: null, netProfit: null,
            site, category: 'Shop', collectedAt: now(), source: 'dp-brand', saved: false, real: true,
            brandStore: out.brandName, brandLink: out.brandLink,
          };
          if (price != null) {
            item.referralFee = Math.round(price * 0.15 * 100) / 100;
            item.netProfit = Math.round((item.price - item.referralFee - 3.2 - item.price * 0.3) * 100) / 100;
            item.aiSuggestPrice = Math.round((item.price - 0.5) * 100) / 100;
          } else {
            item.referralFee = null; item.netProfit = null; item.aiSuggestPrice = null;   // 价格未知 → 派生字段一律 null
          }
          item.aiScore = null;   // ★ P0-3d: 无任何真实输入 → null (常量 40 会被 agentAssess 当成"谨慎跟卖"的评分)
          item.aiRiskLevel = 'low';
          products.unshift(applyRankFields(item));
          added++;
          imported.push(item);
        }
        save('products.json', products);
        pushNotify('详情页品牌采集完成', `「${out.brandName}」品牌页抓取 ${out.products.length} 个商品`, `新增 ${added} 个 (全程CDP)`);
        return send(200, { added, total: products.length, site, brandName: out.brandName, productCount: out.products.length, brandLink: out.brandLink, items: imported.map((x) => ({ asin: x.asin, title: x.title.slice(0, 60), price: x.price })) });
      }

      // 品牌链采集 (店铺 → 品牌店 → 品牌全部商品, 全程 CDP + 插件面板)
      if (p === '/api/collect/brand' && req.method === 'POST') {
        const url = j.url || '';
        if (!/^https:\/\/www\.amazon\./.test(url)) return send(400, { error: '无效的 amazon 店铺 URL' });
        const maxBrands = Math.min(10, Math.max(1, j.maxBrands || 2));
        const maxPages = Math.min(20, Math.max(1, j.maxPages || 3));
        const withPanel = j.panel !== false;              // 默认开启插件面板补全 (全程 CDP)
        const panelLimit = Math.min(30, Math.max(0, j.panelLimit || 5)); // 每品牌面板补全数量
        let out;
        try {
          out = await cdpBrandChain(url, maxBrands, maxPages, withPanel, panelLimit);
          endCollectProgress();
        } catch (e) {
          endCollectProgress();
          return send(500, { error: e.message });
        }
        const siteMatch = url.match(/amazon\.(com\.au|co\.uk|com|com\.mx|com\.br|de|fr|it|es|co\.jp|ca|in|nl|se|pl)/);
        const site = siteMatch && CDP_SITE_CODE[siteMatch[1]] ? CDP_SITE_CODE[siteMatch[1]] : 'uk';
        const currency = siteCurrency(site);   // 按站点真实币种 (旧实现把非 uk/us 一律写成 EUR)
        const used = new Set(products.map((x) => x.asin));
        let added = 0;
        let panelOk = 0, panelFail = 0;
        const perBrand = [];
        for (const br of out.brands) {
          let brandAdded = 0;
          for (const p of br.products) {
            if (used.has(p.asin)) continue;
            used.add(p.asin);
            const pd = p.panel || {};
            const price = parseMoneyText(p.price, p.site || site) || null;   // ★ 站点感知   // 价格读不到 → null (绝不随机伪造)
            // 品牌优先用插件面板的真实品牌
            const brandName = pd.brand || br.name.replace(/ (flagship store|store)$/i, '') || 'Unknown';
            const tm = pd.tmText || '';
            const brandStatus = /已注册|已备案/.test(tm) ? 'registered' : /未查到/.test(tm) ? 'notfound' : /注册商标/.test(tm) ? 'unchecked' : null;
            const item = {
              id: p.asin, asin: p.asin, rank: null, title: p.title, brand: brandName,
              brandStatus: brandStatus || 'unchecked', bgMark: false, tmMark: /TM|注册商标/.test(tm), patentRisk: false,
              trademarkCount: pd.trademarkCount || 0,
              followCount: pd.sellerCount || 0, chinaSeller: chinaSellerOf(pd), sellerCountryCode: sellerCountryCodeOf(pd), fulfill: pd.fulfill || null, amazonSell: null,
              price, currency, monthlySales: pd.sales30d ? (parseInt(String(pd.sales30d).replace(/[<>\s]/g, ''), 10) || null) : null,
              reviews: null, rating: null, stock: null,   // 面板/列表读不到 → null (不写死 0 评论 / 4 分 / 随机库存)
              listedAt: (pd.listedAt || '').slice(0, 10) || null,   // 读不到上架日期 → null (不写"今天")
              size: pd.size || null, weight: pd.weight || null, packSize: pd.packSize || null, packWeight: pd.packWeight || null,
              color: pd.color || null, variantSize: pd.variantSize || null,
              fbaFee: pd.fbaFee || null, productType: pd.productType || null, sellerId: pd.seller || null,
              bsr: pd.bsr || [], variations: 0,
              referralFee: null, netProfit: null,
              site, category: 'Shop', collectedAt: now(), source: 'cdp-brand', saved: false, real: true,
              brandStore: br.name, brandStoreUrl: br.spUrl, panelSource: withPanel,
            };
            if (price != null) {
              item.referralFee = Math.round(price * 0.15 * 100) / 100;
              item.netProfit = Math.round((item.price - item.referralFee - 3.2 - item.price * 0.3) * 100) / 100;
              item.aiSuggestPrice = Math.round((item.price - 0.5) * 100) / 100;
            } else {
              item.referralFee = null; item.netProfit = null; item.aiSuggestPrice = null;   // 价格未知 → 派生字段一律 null
            }
            item.aiScore = Math.round(Math.min(96, Math.max(25, 80 - item.trademarkCount * 0.8 - (brandStatus === 'registered' ? 20 : 0))));
            item.aiRiskLevel = brandStatus === 'registered' ? 'high' : item.trademarkCount > 0 ? 'medium' : 'low';
            products.unshift(applyRankFields(item));
            added++;
            brandAdded++;
            if (pd.error) panelFail++; else if (pd.brand || pd.bsr) panelOk++;
          }
          perBrand.push({ brand: br.name, spUrl: br.spUrl, productCount: br.products.length, added: brandAdded, panelOk, panelFail });
        }
        save('products.json', products);
        pushNotify('品牌链采集完成', `店铺 ${out.shopCount} 个商品 → ${out.brands.length} 个品牌`, `品牌商品 ${out.totalProducts} 个, 新增 ${added} 个, 插件面板 ${panelOk} 成功/${panelFail} 失败 (全程CDP)`);
        return send(200, { added, total: products.length, site, shopCount: out.shopCount, brands: perBrand, totalBrandProducts: out.totalProducts, panelOk, panelFail, panel: withPanel });
      }

      // 批量品牌采集: 从商品库商品的品牌出发 → 品牌跳转链接 → 品牌全部商品 → 采集筛选 → 详情补全 → 入库
      // 阶段1 (零成本, 不请求网页): 按品牌把商品库去重成一串品牌线索 (每品牌 1 个代表商品)
      // 阶段2 (CDP): 代表商品详情页 → 品牌跳转链接 → 品牌页列表 (+翻页, 列表可判条件先预筛)
      // 阶段3 (CDP): 通过预筛的候选逐个读完整详情页 → 品牌名校验 → 统一采集筛选 → 每品牌保留 maxPerBrand 个
      // 采集筛选与「类目搜索采集」完全同一套 (canonical filter → canonicalToCollectFilter → applyCollectFilter)
      if (p === '/api/collect/brand-batch' && req.method === 'POST') {
        /* ★ 2026-10-02 修: 站点原来只认 j.site, 缺省写死 'au' —— 而前端「批量品牌采集」表单里
         * 根本没有 site 字段 → 界面上用这个功能永远只按【澳洲站】找线索品牌, 别的站点一律报
         * "站点 au 的商品库里没有这些品牌的商品"。现在按优先级取:
         *   ① 显式 j.site ② 统一过滤条件里的 filter.sites[0](用户在过滤面板勾了站点)
         *   ③ filter.site ④ 兜底 'au'(保持历史行为)
         * 线索品牌必须属于目标站点, 否则详情页打不开、读不到品牌跳转链接。 */
        const site = String(j.site
          || (j.filter && Array.isArray(j.filter.sites) && j.filter.sites[0])
          || (j.filter && j.filter.site)
          || 'au').toLowerCase();
        const filter = buildCollectFilter(j);
        const brandsLimit = Math.min(20, Math.max(1, j.brandsLimit || 2));       // 自动挑品牌时的品牌数
        const maxPerBrand = Math.min(50, Math.max(1, j.maxPerBrand || 5));      // 每个品牌入库数量上限
        const maxPages = Math.min(10, Math.max(1, j.maxPages || 2));            // 每个品牌翻页数
        const withPanel = j.panel === true || j.panel === 1 || j.panel === '1' || j.panel === 'true';
        // 品牌名 → 分组键 (把 "Visit the Lamicall Store" / "Lamicall" 归到同一品牌)
        const brandKey = (b) => normBrandName(b);
        // 阶段1: 选线索 — ① 显式 asins ② 显式 brands ③ 自动: 按品牌分组取前 N 个品牌
        // 线索质量是这一步的关键: 线索商品必须属于目标站点 (否则详情页打不开 → 读不到品牌跳转链接),
        // 并且品牌值必须"像品牌名" (旧数据里混入过亚马逊随机店铺名, 如 PQWYEWHD)
        const pool = products.filter((x) => x && x.asin);
        // 「详情页核实过品牌」的采集方式: brand 字段是详情页品牌署名读到的真实值
        // (cdp-follow-shop 老数据把卖家店铺名写进过 brand → 不作为自动挑选的首选)
        const TRUSTED_SRC = ['category-search', 'brand-batch', 'list-direct', 'list-filtered', 'dp-brand', 'cdp-brand'];
        const leads = [];
        const pickedBrands = [];
        if (Array.isArray(j.asins) && j.asins.length) {
          for (const a of j.asins.map((x) => String(x).trim().toUpperCase()).filter(Boolean)) {
            const row = pool.find((x) => String(x.asin).toUpperCase() === a) || null;
            leads.push({ asin: a, brand: row ? (row.brand || null) : null, fromLibrary: !!row });
            if (row && row.brand) pickedBrands.push({ brand: row.brand, lead: a, rows: 1, trusted: TRUSTED_SRC.indexOf(String(row.source || '')) >= 0 });
          }
        } else {
          // 指定品牌: 数组 或 逗号/空格分隔的字符串 (前端输入框) — 填了就用这些品牌, 否则从商品库自动挑
          const wantRaw = Array.isArray(j.brands) ? j.brands
            : (typeof j.brands === 'string' && j.brands.trim() ? j.brands.split(/[,，\s]+/) : []);
          const wantBrands = wantRaw.map((b) => String(b).trim()).filter(Boolean).length ? wantRaw.map((b) => String(b).trim()).filter(Boolean) : null;
          // 线索商品打分: 详情页读成功(detailOk)优先 → 主图/价格完整优先 → 目标站点商品已在硬条件里保证
          const scoreOf = (x) => (x.detailOk ? 4 : 0) + (x.mainImage ? 2 : 0) + (x.price ? 1 : 0);
          // 品牌分组 (硬条件: 目标站点 + 品牌像品牌名)
          const groups = new Map();
          let skippedSite = 0, skippedJunk = 0;
          for (const x of pool) {
            if (String(x.site || '') !== site) { skippedSite++; continue; }   // 线索必须是目标站点商品
            const b = String(x.brand || '').trim();
            if (!b || !isBrandLike(b)) { skippedJunk++; continue; }           // 通用词/店铺名 → 不是品牌线索
            const k = brandKey(b);
            if (!k || k.length < 2) { skippedJunk++; continue; }
            if (!groups.has(k)) groups.set(k, { brand: b, rows: [], trusted: 0 });
            const g = groups.get(k);
            g.rows.push(x);
            if (TRUSTED_SRC.indexOf(String(x.source || '')) >= 0) g.trusted++;
          }
          let list;
          if (wantBrands) {
            // 指定品牌: 匹配时同时看品牌键与显示名 (Lamicall = Visit the Lamicall Store)
            const findGroup = (b) => groups.get(brandKey(b)) || groups.get(brandKey(String(b).replace(/^visit the\s+/i, '')));
            list = wantBrands.map((b) => {
              const g = findGroup(b);
              return { brand: b, rows: g ? g.rows : [], trusted: g ? g.trusted : 0 };
            });
            const missing = wantBrands.filter((b) => { const g = findGroup(b); return !g || !g.rows.length; });
            list = list.filter((g) => g.rows.length);
            if (!list.length) {
              const pool2 = [...groups.values()].sort((a, z) => (z.trusted - a.trusted) || (z.rows.length - a.rows.length)).slice(0, 12).map((g) => g.brand);
              return send(404, {
                error: '站点 ' + site + ' 的商品库里没有这些品牌的商品: ' + missing.join(', ')
                  + ' (品牌采集的线索来自商品库, 且必须是该站点商品的品牌). 该站点现有可用品牌: ' + (pool2.join(', ') || '暂无'),
              });
            }
          } else {
            // 自动挑选: 详情页核实过品牌的采集方式优先, 再按商品数多的品牌优先
            list = [...groups.values()]
              .sort((a, z) => (z.trusted - a.trusted) || (z.rows.length - a.rows.length))
              .slice(0, brandsLimit);
          }
          for (const g of list) {
            const best = g.rows.slice().sort((a, z) => scoreOf(z) - scoreOf(a))[0];
            leads.push({ asin: best.asin, brand: g.brand, fromLibrary: true });
            pickedBrands.push({ brand: g.brand, lead: best.asin, rows: g.rows.length, trusted: g.trusted });
          }
          if (!leads.length) {
            const hint = skippedSite && !skippedJunk
              ? '站点 ' + site + ' 没有商品 (线索必须是目标站点的商品, 请先在该站点采集)'
              : '站点 ' + site + ' 的商品里没有可用的品牌 (品牌为空或是通用词/店铺名, 可先采集一批带品牌的商品, 或直接指定品牌名)';
            return send(404, { error: '没有可用的品牌线索: ' + hint });
          }
        }
        if (!leads.length) return send(404, { error: '没有可用的品牌线索 (商品库里这些商品缺少品牌, 可先用其他采集方式补品牌)' });
        let out;
        try {
          out = await cdpBrandBatch({ leads, site, maxPerBrand, maxPages, filter, panel: withPanel });
          endCollectProgress();
        } catch (e) {
          endCollectProgress();
          return send(500, { error: e.message });
        }
        // 阶段3: 入库 (字段与「类目搜索采集」一致: 详情页读到的真实值, 未读到一律 null 不写死)
        const currency = siteCurrency(site);
        const used = new Set(products.map((x) => String(x.asin || '').toUpperCase()));
        let added = 0;
        const perBrand = [];
        const imported = [];
        for (const br of out.brands) {
          let brandAdded = 0;
          for (const p of br.products) {
            const asin = String(p.asin || '').toUpperCase();
            if (!asin || used.has(asin)) continue;
            used.add(asin);
            const price = p.price != null ? p.price : null;
            const pBsr = (Array.isArray(p.bsr) ? p.bsr : []).map((b) => (b && b.rank != null ? b : null)).filter(Boolean);
            const maxR = pBsr.length ? Math.max.apply(null, pBsr.map((b) => b.rank)) : null;
            const item = {
              id: asin, asin, rank: maxR != null ? '#' + maxR : null, title: p.title || '', brand: cleanBrandDisplay(p.brand) || cleanBrandDisplay(br.brandName) || br.brand || null,
              brandRaw: p.brand || null,
              brandStatus: p.brandStatus || 'unchecked', bgMark: false, tmMark: !!p.tmMark, patentRisk: false, trademarkCount: p.trademarkCount || 0,
              followCount: p.sellerCount || 0, chinaSeller: chinaSellerOf(p), sellerCountryCode: sellerCountryCodeOf(p),
              fulfill: p.fulfill || null, amazonSell: p.detailOk ? !!p.amazonSell : null, mainSeller: p.mainSeller || null,
              mainImage: p.mainImage || null, aplus: p.detailOk ? !!p.aplus : null,
              detailOk: !!p.detailOk, detailAt: p.detailAt || null, detailVer: p.detailOk ? DETAIL_VER : null,
              priceSymbol: p.priceSymbol || null, sellerRegion: p.sellerRegion || null,
              buyBoxPrice: p.buyBoxPrice != null ? p.buyBoxPrice : null, minPrice: p.minPrice != null ? p.minPrice : null,
              cat1: p.cat1 || null, cat2: p.cat2 || null, cat3: p.cat3 || null, catPath: p.catPath || null,
              catNodes: p.catNodes || null, catSrc: p.catPath ? 'bc' : null,
              tmCountries: p.tmCountries || [], tmText: p.tmText || null, sales30d: p.sales30d || null,
              price, currency, monthlySales: p.sales30d ? (parseInt(String(p.sales30d).replace(/[<>\s,]/g, ''), 10) || 0) : 0,
              reviews: p.reviews != null ? p.reviews : null, rating: p.rating != null ? p.rating : null, stock: 0,
              listedAt: (p.firstAvailable || '').slice(0, 10) || null,   // 详情页没读到上架日期 → null (不写"今天")
              size: p.size || null, weight: p.weight || null, packSize: p.packSize || null, packWeight: p.packWeight || null,
              color: p.color || null, variantSize: p.variantSize || null, fbaFee: p.fbaFee || null, productType: p.productType || null,
              variations: 0, bsr: pBsr, badge: p.badge || null,
              referralFee: price != null ? Math.round(price * (referralRateFor(p.cat1).rate / 100) * 100) / 100 : null, netProfit: null,
              site, category: p.category || 'Brand', collectedAt: now(), source: 'brand-batch', saved: false, real: true,
              brandStore: p.brandStore || null, brandUrl: p.brandUrl || null, brandSource: p.brandSource || null, fromAsin: p.fromAsin || null,
              panelOk: !!p.panelOk,
            };
            item.aiScore = Math.round(Math.min(96, Math.max(30, 80 - item.trademarkCount * 0.5)));
            item.aiRiskLevel = item.brandStatus === 'registered' ? 'high' : item.trademarkCount > 0 ? 'medium' : 'low';
            item.aiSuggestPrice = price != null ? Math.round((price - 0.5) * 100) / 100 : null;
            products.unshift(applyRankFields(item));
            added++;
            brandAdded++;
            imported.push(item);
          }
          perBrand.push({
            brand: br.brandName || br.brand, lead: br.asin, brandUrl: br.brandUrl, brandSource: br.brandSource,
            listCount: br.listCount, pages: br.pages, candidates: br.candidates, preSkipped: br.preSkipped, read: br.read, kept: br.kept, added: brandAdded,
            skipped: br.skipped, mismatch: br.mismatch, panel: br.panel, error: br.error,
          });
        }
        save('products.json', products);
        // ★ 采集报告落盘 (品牌明细里带「品牌不符」= 剔除他牌)
        saveCollectReport({
          mode: 'brand-batch', name: '批量品牌采集', live: true,
          fromUtc: utcNow(), toUtc: utcNow(),
          filters: filterDesc(filter),
          summary: {
            links: (pickedBrands || []).length, brands: out.brands.length,
            brandProducts: out.kept || 0, added,
            candidates: out.candidates, skipped: out.skipped, mismatch: out.mismatch,
            site,
          },
          shops: [],
          brands: (perBrand || []).map((b) => ({
            brand: b.brand, site, brandLink: b.brandUrl || null, brandSource: b.brandSource,
            collected: b.kept, mixed: b.mismatch || 0, read: b.read, listCount: b.listCount,
            skipped: b.skipped, added: b.added, error: b.error || null,
          })),
          // ★ 剔除他牌明细(带亚马逊直达链接): 报告里逐条可点开核对
          mixed: (perBrand || []).filter((b) => (b.mismatchItems || []).length).map((b) => ({
            brand: b.brand, site, target: b.brand, count: b.mismatch || 0, items: b.mismatchItems,
          })),
          errors: (perBrand || []).filter((b) => b.error).map((b) => ({ brand: b.brand, err: b.error })),
          notify: { title: '批量品牌采集完成', body: `候选 ${out.candidates} 个, 采集筛选跳过 ${out.skipped} 个, 品牌不符丢弃 ${out.mismatch} 个 (站点: ${site}, 全程CDP)` },
        });
        pushNotify('批量品牌采集完成', `品牌 ${out.brands.length} 个 / 入库 ${added} 个`, `候选 ${out.candidates} 个, 采集筛选跳过 ${out.skipped} 个, 品牌不符丢弃 ${out.mismatch} 个 (站点: ${site}, 全程CDP)`);
        return send(200, {
          added, total: products.length, site, brands: perBrand, pickedBrands,
          candidates: out.candidates, kept: out.kept, skipped: out.skipped, mismatch: out.mismatch,
          preSkipped: out.brands.reduce((s, b) => s + (b.preSkipped || 0), 0),
          panel: out.panelEnabled, panelOk: out.panel, filter, stopped: out.stopped,
          items: imported.map((x) => ({ asin: x.asin, brand: x.brand, price: x.price, currency: x.currency, fulfill: x.fulfill, aplus: x.aplus, mainImage: !!x.mainImage, rating: x.rating, reviews: x.reviews, cat1: x.cat1, cat2: x.cat2 })),
        });
      }

      // 跟卖店铺采集 (完整链路: 商品 → 出售单位链接 → 出售单位详情页 → 参观出售单位 → 店铺全部商品, 全程 CDP)
      if (p === '/api/collect/follow-shop' && req.method === 'POST') {
        const url = (j.url || '').trim();
        if (!/^https:\/\/www\.amazon\./.test(url) && !/^https:\/\/amazon\./.test(url)) return send(400, { error: '无效的 amazon 链接' });
        const maxItems = Math.min(100, Math.max(1, j.maxItems || 30));
        const maxPages = Math.min(20, Math.max(1, j.maxPages || 3));
        const filter = buildCollectFilter(j);
        // 店铺 A+ 过滤: '1'=仅采有A+店铺 / '0'=排除有A+店铺 (仅跟卖店铺类采集生效)
        const shopAplus = j.filterShopAplus === '1' || j.filterShopAplus === '0' ? j.filterShopAplus : '';
        // 品牌店筛选: 只采指定品牌 (如 "Anker"), 过滤掉不是该品牌的店铺
        const brandStore = String(j.filterBrandStore || '').trim();
        // 品牌店铺类型: '1'=仅采品牌店铺 / '0'=排除品牌店铺 (只采普通第三方店)
        const brandShop = j.filterBrandShop === '1' || j.filterBrandShop === '0' ? j.filterBrandShop : '';
        let out;
        try {
          out = await cdpFollowShopChain(url, { maxItems, maxPages, filter, shopAplus, brandStore, brandShop });
          endCollectProgress();
        } catch (e) {
          endCollectProgress();
          return send(500, { error: e.message });
        }
        // 首次采集即读全: 价格/品牌/排名/评分/评论/变体 + 详情页插件面板补全(重量/尺寸/FBA费用等物流字段)
        const site = out.site;
        const added = ingestFollowShopProducts(out, true, 0);
        save('products.json', products);
        pushNotify('跟卖店铺采集完成', `出售单位「${out.sellerName || out.sellerId || '?'}」店铺抓取 ${out.products.length} 个${out.skipped ? ', 过滤跳过 ' + out.skipped + ' 个' : ''}${out.shopAplus ? (out.aplusShop ? ', 店铺有A+' : ', 店铺无A+') : ''}${out.brandShopSkip ? ', 品牌店铺筛选跳过' : ''}${out.brandSkip ? ', 指定品牌筛选跳过' : ''}`, `新增 ${added} 个 (链路: 商品aod → 出售单位详情 → 参观店铺, 首次采集读全信息, 全程CDP, 过滤: ${filterDesc(filter)})`);
        return send(200, {
          added, total: products.length, site, seller: out.sellerName, sellerId: out.sellerId,
          sellerUrl: out.sellerUrl, spUrl: out.spUrl, storeUrl: out.storeUrl,
          productCount: out.products.length, skipped: out.skipped || 0, filter, shopAplus, aplusShop: out.aplusShop, brandStore, brandName: out.brandName, brandSkip: out.brandSkip || false, brandShop, brandShopSkip: out.brandShopSkip || false, isBrandShop: out.isBrandShop, steps: out.steps,
          items: out.products.map((x) => ({ asin: x.asin, title: x.title.slice(0, 60), price: x.price })),
        });
      }

      // 跟卖店铺批量采集: 对每个商品 → 遍历其全部跟卖卖家 → 逐个跳转店铺采集 (全程 CDP)
      if (p === '/api/collect/follow-shop-batch' && req.method === 'POST') {
        const asins = (j.asins || []).map((x) => String(x).trim()).filter((x) => x);
        if (!asins.length) return send(400, { error: '请输入商品 ASIN 列表 (如 ["B0XXXXXXX","B0YYYYYYY"])' });
        // 0 = 无限制 (循环轮次/每店商品数/每店翻页)
        const maxItems = j.maxItems === 0 || j.maxItems === '0' ? 0 : Math.min(50, Math.max(1, j.maxItems || 10));
        const maxPages = j.maxPages === 0 || j.maxPages === '0' ? 0 : Math.min(10, Math.max(1, j.maxPages || 2));
        const rounds = j.rounds === 0 || j.rounds === '0' ? 0 : Math.min(30, Math.max(1, j.rounds || 1));
        const concurrency = Math.min(6, Math.max(1, j.concurrency || 4));
        const filter = buildCollectFilter(j);
        const shopAplus = j.filterShopAplus === '1' || j.filterShopAplus === '0' ? j.filterShopAplus : '';
        const brandStore = String(j.filterBrandStore || '').trim();
        const brandShop = j.filterBrandShop === '1' || j.filterBrandShop === '0' ? j.filterBrandShop : '';
        const excludeSellers = String(j.excludeSellers || '');
        const amazonWords = String(j.amazonWords || 'amazon,亚马逊');
        const zip = String(j.zip || '').trim() || undefined;   // 用户输入邮编 (配送地址), 影响报价可见性
        let out;
        try {
          out = await cdpFollowShopBatch(asins, { maxItems, maxPages, rounds, concurrency, filter, shopAplus, brandStore, brandShop, excludeSellers, amazonWords, zip });
          endCollectProgress();
        } catch (e) {
          endCollectProgress();
          return send(500, { error: e.message });
        }
        // 汇总统计
        let shopOk = 0, shopFail = 0, prodCount = 0, skipCount = 0, shopAplusSkip = 0, brandShopSkip = 0, brandSkip = 0;
        out.results.forEach((r) => (r.sellers || []).forEach((s) => { if (s.error) shopFail++; else { shopOk++; prodCount += s.productCount || 0; skipCount += s.skipped || 0; if (s.shopSkipped) { if (s.brandShopSkip) brandShopSkip++; else if (s.brandSkip) brandSkip++; else shopAplusSkip++; } } }));
        pushNotify('跟卖店铺批量采集完成', `${out.stopped ? '⏹ 用户停止 | ' : ''}${rounds === 0 ? '无限循环' : rounds + ' 轮循环'}, 成功 ${out.okRounds} 轮, 自动跳转 ${out.autoJumps} 次 → 卖家店铺 ${shopOk} 成功/${shopFail} 失败${brandShopSkip ? ', 品牌店铺筛选跳过 ' + brandShopSkip + ' 个' : ''}${brandSkip ? ', 指定品牌筛选跳过 ' + brandSkip + ' 个' : ''}${shopAplusSkip ? ', A+店铺过滤跳过 ' + shopAplusSkip + ' 个' : ''}${skipCount ? ', 商品过滤跳过 ' + skipCount + ' 个' : ''}`, `共采集店铺商品 ${prodCount} 个 (全程CDP, 过滤: ${filterDesc(filter)})`);
        return send(200, { asins, rounds, okRounds: out.okRounds, autoJumps: out.autoJumps, added: out.added, shopOk, shopFail, productCount: prodCount, skipped: skipCount, shopAplusSkip, brandShopSkip, brandSkip, filter, shopAplus, brandStore, brandShop, stopped: out.stopped || false, results: out.results });
      }

      // 跟卖店铺并行批量采集: 一个商品多个跟卖卖家 → 多开标签页并行采集各自店铺 (全程 CDP)
      if (p === '/api/collect/follow-shop-parallel' && req.method === 'POST') {
        const asins = (j.asins || []).filter((x) => /^B0[A-Z0-9]{8}$/.test(x));
        if (!asins.length) return send(400, { error: '请输入商品 ASIN 列表 (如 ["B0XXXXXXX","B0YYYYYYY"])' });
        const maxItems = j.maxItems === 0 || j.maxItems === '0' ? 0 : Math.min(50, Math.max(1, j.maxItems || 10));
        const maxPages = j.maxPages === 0 || j.maxPages === '0' ? 0 : Math.min(10, Math.max(1, j.maxPages || 2));
        const concurrency = Math.min(6, Math.max(1, j.concurrency || 4));
        const filter = buildCollectFilter(j);
        const shopAplus = j.filterShopAplus === '1' || j.filterShopAplus === '0' ? j.filterShopAplus : '';
        const brandStore = String(j.filterBrandStore || '').trim();
        const brandShop = j.filterBrandShop === '1' || j.filterBrandShop === '0' ? j.filterBrandShop : '';
        let out;
        try {
          out = await cdpFollowShopBatchParallel(asins, { maxItems, maxPages, concurrency, filter, shopAplus, brandStore, brandShop });
          endCollectProgress();
        } catch (e) {
          endCollectProgress();
          return send(500, { error: e.message });
        }
        // 汇总统计
        let shopOk = 0, shopFail = 0, prodCount = 0, skipCount = 0, shopAplusSkip = 0, brandShopSkip = 0, brandSkip = 0;
        out.results.forEach((r) => (r.sellers || []).forEach((s) => { if (s.error) shopFail++; else { shopOk++; prodCount += s.productCount || 0; skipCount += s.skipped || 0; if (s.shopSkipped) { if (s.brandShopSkip) brandShopSkip++; else if (s.brandSkip) brandSkip++; else shopAplusSkip++; } } }));
        pushNotify('跟卖店铺并行采集完成', `${out.stopped ? '⏹ 用户停止 | ' : ''}商品 ${asins.length} 个 → ${concurrency} 网页并行, 卖家店铺 ${shopOk} 成功/${shopFail} 失败${brandShopSkip ? ', 品牌店铺筛选跳过 ' + brandShopSkip + ' 个' : ''}${brandSkip ? ', 指定品牌筛选跳过 ' + brandSkip + ' 个' : ''}${shopAplusSkip ? ', A+店铺过滤跳过 ' + shopAplusSkip + ' 个' : ''}${skipCount ? ', 商品过滤跳过 ' + skipCount + ' 个' : ''}`, `共采集店铺商品 ${prodCount} 个 (全程CDP, 过滤: ${filterDesc(filter)})`);
        return send(200, { asins, concurrency, shopOk, shopFail, productCount: prodCount, skipped: skipCount, shopAplusSkip, brandShopSkip, brandSkip, filter, shopAplus, brandStore, brandShop, added: out.added, stopped: out.stopped || false, results: out.results });
      }

      // 商品 aod URL → 提取全部跟卖卖家 → 并行开标签页采集各自店铺 (全程 CDP)
      if (p === '/api/collect/follow-shop-aod' && req.method === 'POST') {
        // 支持多商品: urls 数组 (ASIN / 普通商品链接 / aod 报价链接) 或单 url
        const urls = Array.isArray(j.urls) ? j.urls.map((u) => String(u).trim()).filter(Boolean) : (j.url ? [String(j.url).trim()] : []);
        if (!urls.length) return send(400, { error: '请输入商品 (ASIN / 商品链接 / aod 报价链接, 每行一个)' });
        for (const u of urls) {
          const okAsin = /^[A-Z0-9]{10}$/.test(u) && u.startsWith('B0');
          if (okAsin) continue;
          if (!/^https:\/\/(www\.)?amazon\./.test(u)) return send(400, { error: '无效的 amazon 链接或 ASIN: ' + u.slice(0, 40) });
          if (!/aod|olp-opf-redir|\/dp\//.test(u)) return send(400, { error: '需 aod 报价页 URL: ' + u.slice(0, 40) });
        }
        const maxItems = j.maxItems === 0 || j.maxItems === '0' ? 0 : Math.min(50, Math.max(1, j.maxItems || 10));
        const maxPages = j.maxPages === 0 || j.maxPages === '0' ? 0 : Math.min(10, Math.max(1, j.maxPages || 2));
        const concurrency = Math.min(6, Math.max(1, j.concurrency || 4));
        const excludeSellers = String(j.excludeSellers || '');
        const amazonWords = String(j.amazonWords || 'amazon,亚马逊');
        const filter = buildCollectFilter(j);
        const shopAplus = j.filterShopAplus === '1' || j.filterShopAplus === '0' ? j.filterShopAplus : '';
        const brandStore = String(j.filterBrandStore || '').trim();
        const brandShop = j.filterBrandShop === '1' || j.filterBrandShop === '0' ? j.filterBrandShop : '';
        let out;
        try {
          out = await cdpAodParallelCollectAll(urls, { maxItems, maxPages, concurrency, excludeSellers, amazonWords, filter, shopAplus, brandStore, brandShop, zip: j.zip || undefined });
          endCollectProgress();
        } catch (e) {
          endCollectProgress();
          return send(500, { error: e.message });
        }
        // 汇总统计
        let shopOk = 0, shopFail = 0, prodCount = 0, skipCount = 0, shopAplusSkip = 0, brandShopSkip = 0, brandSkip = 0;
        out.products.forEach((pr) => (pr.sellers || []).forEach((s) => { if (s.error) shopFail++; else { shopOk++; prodCount += s.productCount || 0; skipCount += s.skipped || 0; if (s.shopSkipped) { if (s.brandShopSkip) brandShopSkip++; else if (s.brandSkip) brandSkip++; else shopAplusSkip++; } } }));
        pushNotify('跟卖卖家并行采集完成', `${out.stopped ? '⏹ 用户停止 | ' : ''}${urls.length} 个商品 → 逐商品提取跟卖卖家 → ${concurrency} 网页并行, 店铺 ${shopOk} 成功/${shopFail} 失败${brandShopSkip ? ', 品牌店铺筛选跳过 ' + brandShopSkip + ' 个' : ''}${brandSkip ? ', 指定品牌筛选跳过 ' + brandSkip + ' 个' : ''}${shopAplusSkip ? ', A+店铺过滤跳过 ' + shopAplusSkip + ' 个' : ''}${skipCount ? ', 商品过滤跳过 ' + skipCount + ' 个' : ''}`, `共采集店铺商品 ${prodCount} 个, 新增 ${out.added} (全程CDP, 过滤: ${filterDesc(filter)}${amazonWords ? ', 亚马逊词汇: ' + amazonWords : ''})`);
        return send(200, { urls, concurrency, productCount: prodCount, skipped: skipCount, shopAplusSkip, brandShopSkip, brandSkip, filter, shopAplus, brandStore, brandShop, amazonWords, added: out.added, stopped: out.stopped || false, shopOk, shopFail, products: out.products });
      }

      // 多商品并行跟卖店铺采集 + 自定义重复轮次: 每轮自动找新商品继续, 直到 rounds 轮
      if (p === '/api/collect/follow-shop-rounds' && req.method === 'POST') {
        const urls = Array.isArray(j.urls) ? j.urls.map((u) => String(u).trim()).filter(Boolean) : (j.url ? [String(j.url).trim()] : []);
        if (!urls.length) return send(400, { error: '请输入商品 (ASIN / 商品链接 / aod 报价链接, 每行一个)' });
        for (const u of urls) {
          const okAsin = /^[A-Z0-9]{10}$/.test(u) && u.startsWith('B0');
          if (okAsin) continue;
          if (!/^https:\/\/(www\.)?amazon\./.test(u)) return send(400, { error: '无效的 amazon 链接或 ASIN: ' + u.slice(0, 40) });
          if (!/aod|olp-opf-redir|\/dp\//.test(u)) return send(400, { error: '需 aod 报价页 URL: ' + u.slice(0, 40) });
        }
        const rounds = j.rounds === 0 || j.rounds === '0' ? 0 : Math.min(30, Math.max(1, j.rounds || 1));
        const maxItems = j.maxItems === 0 || j.maxItems === '0' ? 0 : Math.min(50, Math.max(1, j.maxItems || 10));
        const maxPages = j.maxPages === 0 || j.maxPages === '0' ? 0 : Math.min(10, Math.max(1, j.maxPages || 2));
        const concurrency = Math.min(6, Math.max(1, j.concurrency || 4));
        const excludeSellers = String(j.excludeSellers || '');
        const amazonWords = String(j.amazonWords || 'amazon,亚马逊');
        const filter = buildCollectFilter(j);
        const shopAplus = j.filterShopAplus === '1' || j.filterShopAplus === '0' ? j.filterShopAplus : '';
        const brandStore = String(j.filterBrandStore || '').trim();
        const brandShop = j.filterBrandShop === '1' || j.filterBrandShop === '0' ? j.filterBrandShop : '';
        let out;
        try {
          out = await cdpAodParallelCollectRounds(urls, { rounds, maxItems, maxPages, concurrency, excludeSellers, amazonWords, filter, shopAplus, brandStore, brandShop, zip: j.zip || undefined });
          endCollectProgress();
        } catch (e) {
          endCollectProgress();
          return send(500, { error: e.message });
        }
        // 汇总统计
        let shopOk = 0, shopFail = 0, prodCount = 0, okRounds = 0, skipCount = 0, shopAplusSkip = 0, brandShopSkip = 0, brandSkip = 0;
        out.rounds.forEach((rd) => {
          if (rd.error || rd.note) return;
          okRounds++;
          (rd.sellers || []).forEach((s) => { if (s.error) shopFail++; else { shopOk++; prodCount += s.productCount || 0; skipCount += s.skipped || 0; if (s.shopSkipped) { if (s.brandShopSkip) brandShopSkip++; else if (s.brandSkip) brandSkip++; else shopAplusSkip++; } } });
        });
        pushNotify('多商品并行采集完成', `${out.stopped ? '⏹ 用户停止 | ' : ''}${rounds === 0 ? '无限循环' : rounds + ' 轮'}, 成功 ${okRounds} 轮 → 卖家店铺 ${shopOk} 成功/${shopFail} 失败${brandShopSkip ? ', 品牌店铺筛选跳过 ' + brandShopSkip + ' 个' : ''}${brandSkip ? ', 指定品牌筛选跳过 ' + brandSkip + ' 个' : ''}${shopAplusSkip ? ', A+店铺过滤跳过 ' + shopAplusSkip + ' 个' : ''}${excludeSellers ? ', 排除: ' + excludeSellers : ''}${skipCount ? ', 商品过滤跳过 ' + skipCount + ' 个' : ''}`, `共采集店铺商品 ${prodCount} 个, 新增 ${out.added} (全程CDP, 过滤: ${filterDesc(filter)}${amazonWords ? ', 亚马逊词汇: ' + amazonWords : ''})`);
        return send(200, { rounds, concurrency, okRounds, autoJumps: out.autoJumps, shopOk, shopFail, productCount: prodCount, skipped: skipCount, shopAplusSkip, brandShopSkip, brandSkip, filter, shopAplus, brandStore, brandShop, amazonWords, added: out.added, stopped: out.stopped || false, excludeSellers, roundResults: out.rounds });
      }

      // 店铺列表页采集 (翻页取全部商品 → 详情补全 → 过滤FBA/FBM等 → 入库)
      // ===== 多链接采集（《多链接采集-完整代码.js》第 2.3 / 2.4 部分）=====
      // 三种链接形态: /s?me= 店铺列表页 · /sp?seller= 卖家主页(自动规范化) · /dp/ASIN 商品页(取跟卖卖家)
      // 采两类商品: ① 跟卖商家的店铺商品  ② 这些商品去重后的品牌商品
      // 默认【异步】: 立即返回 {started:true}; 进度 GET /api/collect/progress; 结果 GET /api/collect/links-result
      //   · wait=1 同步等结果(仅调试用, 真实采集几十分钟会 HTTP 超时)
      //   · 进度由顶层守卫注册(路由已加进守卫 MAP, 坑 #29) —— 这里不要再调 beginCollectProgress
      if ((p === '/api/collect/shop-links' || p === '/api/collect/links') && req.method === 'POST') {
        let list = siteLinks.parseLinkList(j.urls != null ? j.urls : j.links);
        // ── 续跑: jobId='last' 取最近一个还有待办/失败的任务, 或指定 job-xxx ──
        const wantJob = String(j.jobId || j.resume || j.resumeTaskId || '').trim();
        let existingJob = null;
        if (wantJob) {
          if (wantJob === 'last') {
            const lr = linkJobStore.latestResumable();
            existingJob = lr ? linkJobStore.get(lr.id) : null;
            if (!existingJob) return send(404, { error: '没有可续跑的任务（都跑完了或已被清理）' });
          } else {
            existingJob = linkJobStore.get(wantJob);
            if (!existingJob) return send(404, { error: '找不到任务 ' + wantJob + '（可能已被清理）, 请重新提交链接' });
          }
        }
        // 只给任务号不给链接 → 链接从断点文件里取, 不用再贴一遍那 100 条
        if (!list.length && existingJob) list = (existingJob.links || []).map((x) => x.url);
        if (!list.length) return send(400, { error: '请提供链接列表（每行一条）。支持: 店铺列表页 /s?me=XXXX · 卖家主页 /sp?seller=XXXX · 商品页 /dp/ASIN' });
        // 只重跑失败单元(配合 jobId 用)
        let resetCount = 0;
        const onlyFailed = j.onlyFailed === 1 || j.onlyFailed === '1' || j.retryFailed === 1 || j.retryFailed === '1';
        if (existingJob && onlyFailed) {
          resetCount = linkJobs.resetFailed(existingJob, j.what || null);
          linkJobs.addLog(existingJob, '本次提交只重跑失败单元: 重置 ' + resetCount + ' 个');
        }
        const taskJobId = existingJob ? existingJob.id : linkJobs.newJobId();
        const taskOpts = (() => {
          const jo = (existingJob && existingJob.opts) || {};
          const pick = (k, def) => {
            const a = j[k];
            if (a != null && a !== '') return a;
            const b = jo[k];
            return (b != null && b !== '') ? b : def;
          };
          return {
            shopPages: Math.min(20, Math.max(1, Number(pick('shopPages', j.maxPages != null ? j.maxPages : 1)) || 1)),
            brandPages: Math.min(20, Math.max(1, Number(pick('brandPages', 1)) || 1)),
            maxShops: Math.max(0, Number(pick('maxShops', 0)) || 0),
            maxItems: Math.max(0, Number(pick('maxItems', 0)) || 0),
            collectBrands: pick('collectBrands', true),
            zip: String(pick('zip', '') || '').trim() || undefined,
            // ★ 并行标签页数(1-6, 默认 4)。走 pick → 续跑时自动沿用任务里存的值(坑 28):
            //   续跑请求一般不带 concurrency, 不沿用就会掉回默认 4。
            concurrency: Math.min(6, Math.max(1, Number(pick('concurrency', 4)) || 4)),
          };
        })();
        // 筛选口径(坑 29): 续跑默认沿用任务里存的原筛选 —— 续跑请求往往不带筛选字段,
        // 重新 build 会得到宽松筛选, 该被过滤的商品会全部入库。filterKeep=0 才用本次的覆盖。
        const keepFilter = !!existingJob && String(j.filterKeep) !== '0';
        const filter = (keepFilter && existingJob.opts && existingJob.opts.filter) ? existingJob.opts.filter : buildCollectFilter(j);
        // 站点口径: 「链接是哪个站就按哪个站采」(坑 #34)。但过滤面板里的「站点」会作为 filter.sites 传进来,
        // 例如面板默认勾了 de 而链接是 uk → applyCollectFilter 会把 uk 商品整批筛掉, 表现为"一条都采不到"。
        // 这里用链接自身的站点覆盖 filter.sites, 让站点由链接决定。
        const linkSites = [...new Set(list.map((u) => siteLinks.siteFromUrl(u)).filter(Boolean))];
        if (linkSites.length) filter.sites = linkSites;
        taskOpts.filter = filter;             // 存进任务: 续跑时沿用(坑 28/29)
        lastLinksResult = null;              // 新一轮: 清旧结果, 避免 /links-result 拿到上一轮数据
        // 任务化: 一次最多 100 条链接, 超过直接拒绝 —— 防止误贴 500 条把 Edge 拖死
        const MAX_LINKS = 100;
        if (list.length > MAX_LINKS) {
          return send(400, { error: '一次最多 ' + MAX_LINKS + ' 条链接 (收到 ' + list.length + ' 条)。请分几次提交, 或用 jobId 续跑未完成的任务。' });
        }
        // 续跑沿用(坑 28): batchSize/retry/delayMs/waitScale 也要沿用任务里的 —— 任务里存了它们。
        // 之前只沿用了 shopPages 那一组, 续跑不带这些字段时会掉回默认值(例如 retry 从 1 变 2,
        // 表现为同一个失败单元的 attempts 一次涨 3 而不是 2, 排障时对不上账)。
        const pickTask = (k, def) => {
          const a = j[k];
          if (a != null && a !== '') return a;
          const b = existingJob ? existingJob[k] : null;
          return (b != null && b !== '') ? b : def;
        };
        const batchSize = Math.max(1, Math.min(50, Number(pickTask('batchSize', linkJobs.DEFAULT_BATCH_SIZE)) || linkJobs.DEFAULT_BATCH_SIZE));
        const retry = Math.max(0, Math.min(10, Number(pickTask('retry', linkJobs.DEFAULT_RETRY)) || 0));
        const delayMs = Math.max(0, Math.min(60000, Number(pickTask('delayMs', linkJobs.DEFAULT_DELAY_MS)) || 0));
        const waitScale = Number(pickTask('waitScale', 1)) > 0 ? Number(pickTask('waitScale', 1)) : 1;
        // ★ 排名闸门: 列表页插件基本不给排名(实测店铺页 16 张卡只有 1 张有「店铺选品」, 品牌页 0 张,
        //   等 54 秒也不变), 但进详情页等 12~15 秒能拿到。
        // ★ 2026-09 改造(统一不跳转): 默认改为【关】。这个"缺排名就逐个进详情页补"是采集链路里最隐蔽的
        //   逐商品跳详情来源 —— 店铺页/品牌页每个商品都要 12~15 秒, 表面上看起来"采集很慢"却找不到原因。
        //   排名改为由「补采」按需补齐(商品管理页勾选后补采)。需要旧行为时显式传 rankGate=1。
        //   rankGateLimit=0 表示不限(每个都补)。
        const rankGate = (j.rankGate === 1 || j.rankGate === '1' || j.rankGate === true || j.rankGate === 'true');
        const rankGateLimit = Math.max(0, Math.min(200, Number(j.rankGateLimit) || 0));
        const rankWaitMs = Math.max(8000, Math.min(60000, Number(j.rankWaitMs) || 20000));

        const opts = {
          // ★ 必须把任务参数带上: 之前这里漏了 shopPages/brandPages/maxShops/maxItems/collectBrands/zip/filter
          //   —— 采集器只能用自己的默认值, 表现为「筛选条件完全不生效 + 页数恒为 1 + 品牌恒开」,
          //   而且续跑沿用(坑 28/29)也一起失效。taskOpts 里已经含 filter(续跑时=任务里的原筛选)。
          ...taskOpts,
          cdpGetTabs, cdpConnect,
          // ★ 并行改造: 采集器的每个 worker 都要有自己的标签页 —— 开/关都走这两个
          //   (与跟卖并行族 cdpFollowShopBatchParallel 用的是同一套 /json/new · /json/close)。
          cdpCreateTab, cdpCloseTab,
          siteToHostSuffix,                          // 本后端已有
          resolveCollectSite: siteLinks.resolveCollectSite,
          classifySellerLink: siteLinks.classifySellerLink,
          applyCollectFilter, bumpCollectProgress, collectStopRequested,
          parseMoneyText,                            // ★ 站点感知的金额解析(采集器比价/排序用)
          // 离线集成测试口子: 只有显式设置 ZY_TEST_FAKE_CDP=1 才会走假 CDP。
          // 生产环境这个变量不存在 → 下面这几个字段一个都不会出现, 真实现不被覆盖。
          ...(fakeCdpDeps ? {
            openSession: fakeCdpDeps.openSession,
            cdpGetTabs: fakeCdpDeps.cdpGetTabs,
            // ★ 假 CDP 模式下"开标签页"也必须交给测试台: 否则并行的 worker 会跑到真实
            //   9222 上开标签页(离线测试污染用户浏览器)。测试台没提供 → 采集器自动退回串行。
            cdpCreateTab: fakeCdpDeps.cdpCreateTab,
            cdpCloseTab: fakeCdpDeps.cdpCloseTab,
            waitScale: 0.01,
          } : {}),
          // 配送地址校准（文档步骤 1：必须先导航到目标站点再改地址 —— 坑 #3；改地址需登录）
          ensureDeliveryAddress: async (sess, site, zip) => {
            const url = 'https://www.amazon.' + siteToHostSuffix(site) + '/';
            await sess.send('Page.navigate', { url });
            await new Promise((r) => setTimeout(r, 6000));
            let ok = false;
            try { ok = await cdpSetGlowAddress(sess.send, url, site, zip); } catch (e) { ok = false; }
            return { ok: !!ok, note: ok ? ('配送地址已校准 ' + String(site).toUpperCase() + (zip ? ' (' + zip + ')' : '')) : '地址未校准(改配送地址需登录, 继续采集)' };
          },
          ingestShopProducts: (items, site, source) => ingestLinksProducts(items, site, source),
          log: (m) => console.log(m),
        };

        const task = (async () => {
          try {
            const report = await linksCollector.collectByLinks(list, Object.assign({}, opts, {
              job: existingJob,
              jobId: taskJobId,                 // 新任务时用后端预生成的 id, 这样任务文件一定能落盘
              batchSize, retry, delayMs,
              rankGate, rankGateLimit, rankWaitMs,
              // 假 CDP 自测时强制 0.01 (离线跑完整编排用); 生产走用户给的 waitScale
              waitScale: fakeCdpDeps ? 0.01 : waitScale,
              onCheckpoint: (jj, reason) => {
                // 单元级节流写; 批次边界/收尾/暂停必须立刻可见
                const force = reason === 'batch' || reason === 'finish' || reason === 'paused';
                linkJobStore.save(jj, force);
                // 顺手清理一次(保留最近 50 个 + 30 天内的; 还有待办/失败的任务绝不删):
                // 一个上百条链接的任务文件能到 1 MB 级, 只靠启动时 prune 会越堆越大
                if (force) { try { linkJobStore.prune(); } catch (e) { /* 忽略 */ } }
                const s = linkJobs.summary(jj);
                bumpCollectProgress({
                  jobId: jj.id, step: jj.log && jj.log.length ? jj.log[jj.log.length - 1].msg : '采集中',
                  round: jj.round, batches: s.batches,
                  links: s.links, linksDone: s.linksDone,
                  sellersDone: s.sellersDone, sellersTotal: s.sellers,
                  brandsDone: s.brandsDone, brandsTotal: s.brands,
                  added: s.added, items: s.shopProducts + s.brandProducts,
                  pending: s.pending, failed: s.failed,
                });
              },
            }));
            const jj = existingJob || linkJobStore.get(report.jobId) || { id: report.jobId, status: 'partial' };
            const brief = linkJobs.summary(jj);
            const batches = (jj.batches || []).map((b) => ({ index: b.index, from: b.from, to: b.to, status: b.status }));
            // 兼容老前端/老接口的字段口径(report 里带 jobId/jobSummary/remaining/totals)
            const out = Object.assign({}, report, {
              taskId: report.jobId, taskStatus: jj.status, jobId: report.jobId,
              batches,
              failed: brief.failed, pending: brief.pending,
              steps: Object.assign({}, report.steps, {
                sellers: { count: (jj.sellers || []).length, list: (jj.sellers || []).map((x) => ({ sellerId: x.sellerId, name: x.name, added: x.added })) },
                brands: { unique: (jj.brands || []).length, list: (jj.brands || []).map((x) => ({ brand: x.brand, collected: x.collected, mixed: x.mixed, added: x.added })) },
                brandAdded: jj.totals ? jj.totals.brandAdded : 0,
                totalAdded: jj.totals ? jj.totals.added : 0,
              }),
            });
            lastLinksResult = out;
            const totalAdded = out.steps.totalAdded || 0;
            const nSellers = (jj.sellers || []).length;
            const nBrands = (jj.brands || []).length;
            const failedBatches = batches.filter((b) => b.status !== 'done').length;
            const retriable = (brief.pending || 0) + (brief.failed || 0);
            const pLogin = out.pluginLogin || null;
            const loginTip = (pLogin && pLogin.notLogged > 0)
              ? ` · ⚠ 插件未登录: ${pLogin.notLogged}/${pLogin.cards} 张卡缺字段(采集已继续完成, 到采集浏览器登录「智赢」插件即可)`
              : '';
            const notifyBody = `新增入库 ${totalAdded} · 店铺 ${brief.sellersDone}/${nSellers} · 品牌 ${brief.brandsDone}/${nBrands}` +
              ` · 过滤: ${filterDesc(filter)} · 耗时 ${out.elapsedSec}s` +
              (out.rankGate && out.rankGate.got ? ` · 详情页补排名 ${out.rankGate.got}/${out.rankGate.tried}` : '') +
              loginTip +
              (retriable ? ` · 待办 ${brief.pending || 0} / 失败 ${brief.failed || 0} → 任务 ${jj.id} 可继续跑` : '');
            // ★ 采集报告落盘: 「采集记录 → 查看报告」靠它取回店铺/品牌明细(含剔除他牌), 不再随重启丢失
            saveCollectReport({
              mode: 'shoplinks', name: '多链接采集 · 任务 ' + jj.id, url: (jj.links || []).map((x) => x.url).join('\n'),
              live: true,
              fromUtc: out.startedAt ? String(out.startedAt).slice(0, 19).replace('T', ' ') : utcNow(),
              toUtc: out.finishedAt ? String(out.finishedAt).slice(0, 19).replace('T', ' ') : utcNow(),
              filters: filterDesc(filter),
              summary: {
                links: out.links, sellers: nSellers,
                shopProducts: out.shopProductCount || 0, brands: nBrands,
                brandProducts: out.brandProductCount || 0, added: totalAdded,
                elapsedSec: out.elapsedSec || 0,
                shopPages: out.shopPages, brandPages: out.brandPages,
              },
              shops: out.steps.shops || [],
              brands: out.steps.brands.list || [],
              // ★ 剔除他牌明细(按品牌分组, 每条带亚马逊直达链接) —— 采集报告里可逐条跳转核对
              mixed: Array.isArray(out.mixedByBrand) ? out.mixedByBrand.slice(0, 40).map((g) => ({
                brand: g.brand || null, site: g.site || null, target: g.target || g.brand || null,
                count: g.count || (g.items || []).length,
                items: (g.items || []).slice(0, 200).map((it) => ({
                  asin: it.asin, title: it.title ? String(it.title).slice(0, 90) : null,
                  brand: it.brand || null, url: it.url || null, page: it.page || null,
                })),
              })) : [],
              errors: out.errors || [],
              taskId: jj.id, batches,
              rankGate: out.rankGate || null, rankStats: out.rankStats || null,
              pluginLogin: pLogin,
              notify: { title: '多链接采集完成', body: notifyBody },
            });
            pushNotify('多链接采集' + (jj.status === 'done' ? '完成' : '暂停/未跑完'),
              `${out.links} 条链接 → 卖家 ${nSellers} 个, 店铺商品 ${out.shopProductCount} 个, 品牌 ${nBrands} 个` +
                ((pLogin && pLogin.notLogged > 0) ? ` ⚠ 插件未登录(${pLogin.notLogged} 张卡缺字段)` : ''),
              notifyBody);
            return out;
          } catch (e) {
            // 把最常见的前置条件错误翻译成可操作的提示 —— 原始错误(如 connect ECONNREFUSED 127.0.0.1:9222)对用户没有意义
            let msg = (e && e.message) || '采集失败';
            if (/ECONNREFUSED[\s\S]*9222|127\.0\.0\.1:9222/.test(msg)) {
              msg = 'Edge 未以调试端口启动 —— 请先运行「启动采集浏览器.bat」(或 msedge.exe --remote-debugging-port=9222 --user-data-dir=<独立目录>), 等 9222 就绪后再重试';
            } else if (/无可用页面标签/.test(msg)) {
              msg = '调试版 Edge 里没有可用的页面标签 —— 请在采集用的 Edge 窗口里打开一个 Amazon 页面后重试';
            } else if (/缺少依赖/.test(msg)) {
              msg = msg + '（采集器依赖注入不完整，属部署问题）';
            }
            // ★ 崩了也要保住已完成的部分: 把任务标成 paused(可继续), 而不是丢掉
            let jobId = taskJobId;
            try {
              const jj = existingJob || linkJobStore.get(taskJobId);
              if (jj) {
                linkJobs.addLog(jj, '任务异常中断: ' + msg);
                jj.status = 'paused';
                jj.pauseReason = 'error';
                linkJobStore.save(jj, true);
              }
            } catch (e2) { /* 忽略 */ }
            lastLinksResult = { error: msg, rawError: (e && e.message) || String(e), finishedAt: new Date().toISOString(), taskId: jobId };
            // 失败的采集也留一条报告 —— 「采集记录」里能看到失败原因, 而不是只有一条通知
            saveCollectReport({
              mode: 'shoplinks', name: '多链接采集', url: list.join('\n'), live: true, failed: true,
              fromUtc: utcNow(), toUtc: utcNow(), filters: filterDesc(filter),
              summary: { links: list.length, added: 0 },
              errors: [{ stage: '采集失败', err: msg, rawError: (e && e.message) || String(e) }],
              taskId: jobId,
              notify: { title: '多链接采集失败', body: msg },
            });
            pushNotify('多链接采集失败', msg, jobId ? ('任务 ' + jobId + ' 已落盘, 修好后点「继续上次任务」可接着跑') : '');
            return lastLinksResult;
          } finally {
            try { if (existingJob) linkJobStore.save(existingJob, true); } catch (e) { /* 忽略 */ }
            endCollectProgress();
          }
        })();

        if (j.wait === 1 || j.wait === '1') {
          const out = await task;
          return out.error ? send(500, out) : send(200, out);
        }
        return send(200, {
          started: true, jobId: taskJobId, taskId: taskJobId, links: list.length,
          resume: !!existingJob, resetFailed: resetCount,
          pendingLinks: existingJob ? linkJobs.remaining(existingJob).links : list.length,
          batchSize, retry, delayMs, waitScale,
          shopPages: Math.min(20, Math.max(1, Number(taskOpts.shopPages) || 1)),
          brandPages: Math.min(20, Math.max(1, Number(taskOpts.brandPages) || 1)),
          collectBrands: taskOpts.collectBrands !== false,
          note: '已在后台开始采集（任务 ' + taskJobId + '）。每完成一条链接/一个店铺/一个品牌都会落盘; ' +
            '随时可用 jobId=' + taskJobId + ' 续跑, 或 jobId=' + taskJobId + ' + onlyFailed=1 只重跑失败单元。' +
            '进度 GET /api/collect/progress, 结果 GET /api/collect/links-result, 任务列表 GET /api/collect/link-jobs。',
        });
      }

      // ── 多链接采集任务接口（断点续跑）──────────────────────────────────
      if (p === '/api/collect/link-jobs' && req.method === 'GET') {
        const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '20', 10) || 20));
        return send(200, { dir: linkJobStore.dir, jobs: linkJobStore.list(limit), resumable: linkJobStore.latestResumable() });
      }
      // GET 接口一律从 searchParams 取参(没有请求体, 读 j.jobId 会恒为 undefined —— 坑 31)
      if (p === '/api/collect/link-job' && req.method === 'GET') {
        const want = String(url.searchParams.get('jobId') || '').trim();
        if (!want) return send(400, { error: '缺少 jobId' });
        const job = want === 'last' ? (linkJobStore.latestResumable() && linkJobStore.get(linkJobStore.latestResumable().id)) : linkJobStore.get(want);
        if (!job) return send(404, { error: '找不到任务 ' + want + '（可能已被清理, 或还没有任何可续跑任务）' });
        const full = url.searchParams.get('full') === '1';
        return send(200, {
          ready: true,
          summary: linkJobs.summary(job),
          remaining: linkJobs.remaining(job),
          full: full ? job : {
            id: job.id, status: job.status, pauseReason: job.pauseReason,
            links: job.links.map((x) => ({ url: x.url, status: x.status, err: x.err, kind: x.kind, attempts: x.attempts })),
            sellers: job.sellers.map((x) => ({ sellerId: x.sellerId, name: x.name, status: x.status, added: x.added, err: x.err })),
            brands: job.brands.map((x) => ({ brand: x.brand, status: x.status, added: x.added, mixed: x.mixed, err: x.err })),
            log: (job.log || []).slice(-40),
          },
        });
      }
      // 重跑失败/跳过: 把 failed(以及 includeSkipped 时的 skipped)重置成 pending
      // (不立刻跑, 由前端再发一次 shop-links 带 jobId)
      // ★ includeSkipped: 中途停止时没跑的单元会被静默标成 skipped, 老版本捞不回来 → 任务永远补不齐
      if (p === '/api/collect/link-job/retry' && req.method === 'POST') {
        const want = String(j.jobId || 'last').trim();
        const job = want === 'last' ? (linkJobStore.latestResumable() && linkJobStore.get(linkJobStore.latestResumable().id)) : linkJobStore.get(want);
        if (!job) return send(404, { error: '找不到任务 ' + want });
        const withSkipped = j.includeSkipped === true || j.skipped === true;
        // ★ since: 把该时刻之后"完成"的单元也退回待办 —— 采集器有 bug 的窗口采出来的结果不算数时必须重采
        const since = (typeof j.since === 'string' && j.since.trim()) ? j.since.trim() : null;
        const reset = linkJobs.resetFailed(job, j.what || null, { skipped: withSkipped, since: since });
        linkJobs.addLog(job, (since ? '重跑 ' + since + ' 之后完成的单元' : (withSkipped ? '重跑失败+跳过' : '重跑失败')) + ': 重置 ' + reset + ' 个单元为待办');
        linkJobStore.save(job, true);
        return send(200, { ok: true, reset, includeSkipped: withSkipped, since: since, remaining: linkJobs.remaining(job), summary: linkJobs.summary(job) });
      }
      if (p === '/api/collect/link-job/remove' && req.method === 'POST') {
        const want = String(j.jobId || '').trim();
        if (!want) return send(400, { error: '缺少 jobId' });
        return send(200, { ok: linkJobStore.remove(want), jobId: want });
      }

      // 多链接采集结果（跑完后取一次）
      if (p === '/api/collect/links-result' && req.method === 'GET') {
        if (!lastLinksResult) return send(200, { ready: false, running: !!(collectProgress && collectProgress.running) });
        return send(200, Object.assign({ ready: true }, lastLinksResult));
      }

      // 店铺列表页采集 (翻页取全部商品 → 详情补全 → 过滤FBA/FBM等 → 入库)
      if (p === '/api/collect/shop-list' && req.method === 'POST') {
        const url = String(j.url || '').trim();
        if (!/^https:\/\/www\.amazon\./.test(url)) return send(400, { error: '无效的 amazon 店铺列表页 URL' });
        const maxItems = Math.min(100, Math.max(1, j.maxItems || 50));
        const maxPages = Math.min(10, Math.max(1, j.maxPages || 3));
        const filter = buildCollectFilter(j);
        const shopAplus = j.filterShopAplus === '1' || j.filterShopAplus === '0' ? j.filterShopAplus : '';
        let out;
        try {
          out = await cdpShopListCollect(url, { maxItems, maxPages, filter, shopAplus });
          endCollectProgress();
        } catch (e) {
          endCollectProgress();
          return send(500, { error: e.message });
        }
        pushNotify('店铺列表采集完成', `${out.stopped ? '⏹ 用户停止 | ' : ''}${out.total} 个商品, 筛选后 ${out.productCount} 个, 跳过 ${out.skipped} 个${out.preSkipped ? ' (其中列表页初筛跳过 ' + out.preSkipped + ' 个未跳详情)' : ''}`, `新增 ${out.added} 个 (站点: ${out.site}, 过滤: ${filterDesc(filter)}, 全程CDP)`);
        return send(200, { added: out.added, total: out.total, productCount: out.productCount, skipped: out.skipped, preSkipped: out.preSkipped || 0, site: out.site, url, filter, stopped: out.stopped || false, products: out.products });
      }

      // 店铺页 CDP 采集 (Edge 9222 + 智赢插件)
      if (p === '/api/collect/shop' && req.method === 'POST') {
        const url = j.url || '';
        if (!/^https:\/\/www\.amazon\./.test(url)) return send(400, { error: '无效的 amazon 店铺 URL' });
        const count = Math.min(30, Math.max(1, j.count || 10));
        let items;
        try {
          items = await cdpShopCollect(url, count);
        } catch (e) {
          endCollectProgress();
          return send(500, { error: e.message });
        }
        if (!items.length) return send(404, { error: '未能提取到商品 (页面结构变化或需要登录)' });
        // 导入商品库
        const siteMatch = url.match(/amazon\.(com\.au|co\.uk|com|com\.mx|com\.br|de|fr|it|es|co\.jp|ca|in|nl|se|pl)/);
        const site = siteMatch && CDP_SITE_CODE[siteMatch[1]] ? CDP_SITE_CODE[siteMatch[1]] : 'uk';
        const currency = siteCurrency(site);   // 按站点真实币种 (旧实现把非 uk/us 一律写成 EUR)
        const used = new Set(products.map((x) => x.asin));
        let added = 0;
        for (const it of items) {
          if (used.has(it.asin)) continue;
          used.add(it.asin);
          const brand = (it.title.split(/[ ,|–—/•]/)[0] || '').replace(/[^A-Za-z0-9&'.\-]/g, '').trim() || 'Unknown';
          const price = it.priceNum || parseMoneyText(it.price, it.site || site) || null;   // ★ 站点感知
          const tm = false, patent = false;                                  // 店铺卡片读不到商标/专利信息 → 不伪造
          const item = {
            id: it.asin, asin: it.asin, rank: null, title: it.title, brand,
            brandStatus: 'unchecked', bgMark: false, tmMark: tm, patentRisk: patent, trademarkCount: 0,
            followCount: null, chinaSeller: null,
            fulfill: null, amazonSell: null,
            price, currency,
            monthlySales: null, reviews: null,
            rating: it.rating ? (parseFloat(String(it.rating).match(/[\d.]+/)?.[0]) || null) : null,   // 有真值用真值, 否则 null (不写死 4 分)
            stock: null, listedAt: null,
            size: null, weight: null, variations: null,
            referralFee: null, netProfit: null, site, category: 'Shop', collectedAt: now(),
            source: 'cdp-shop', saved: false, real: true, shopUrl: url.slice(0, 120),
          };
          if (item.price != null) {
            item.referralFee = Math.round(item.price * 0.15 * 100) / 100;
            item.netProfit = Math.round((item.price - item.referralFee - 3.2 - item.price * 0.3) * 100) / 100;
            item.aiSuggestPrice = Math.round((item.price - 0.5) * 100) / 100;
          } else {
            item.referralFee = null; item.netProfit = null; item.aiSuggestPrice = null;   // 价格未知 → 派生字段一律 null
          }
          item.aiScore = Math.round(Math.min(96, Math.max(30, 80 - item.trademarkCount * 0.5 - (item.patentRisk ? 25 : 0))));
          item.aiRiskLevel = item.patentRisk ? 'high' : item.tmMark ? 'medium' : 'low';
          products.unshift(applyRankFields(item));
          added++;
        }
        save('products.json', products);
        pushNotify('CDP店铺采集完成', `从店铺页提取 ${items.length} 个, 新增 ${added} 个`, `URL: ${url.slice(0, 100)}`);
        return send(200, { added, total: products.length, site, url, items: items.map((x) => ({ asin: x.asin, title: x.title.slice(0, 80), price: x.price, rating: x.rating, reviews: x.reviews })) });
      }

      // 真实采集 (curl 抓 amazon + 智赢 API)
      // ★ 补子体价格: 后台逐个开子体页读价回填 (立即返回, 进度看 /api/collect/progress)
      if (p === '/api/listing/fill-child-prices' && req.method === 'POST') {
        const ra = String((req.socket && req.socket.remoteAddress) || '');
        if (!/^(::1|::ffff:127\.0\.0\.1|127\.0\.0\.1)$/.test(ra)) return send(403, { error: '仅允许本机调用' });
        if (collectProgress && collectProgress.running) {
          return send(200, { ok: false, busy: true, error: '正有一个任务在运行 (mode=' + (collectProgress.mode || '?') + '), 请等它结束后再补价' });
        }
        const ids = Array.isArray(j.ids) ? j.ids : (j.id ? [j.id] : []);
        if (!ids.length) return send(400, { error: '请传 ids (上架记录 id, 形如 B07F3MYF5L@au)' });
        const recs = listingRecords.filter((r) => ids.includes(r.id));
        if (!recs.length) return send(404, { error: '找不到记录: ' + ids.join(',') });
        const pending = recs.reduce((n, r) => n + (((r.variant && r.variant.children) || []).filter((c) => c.price == null).length), 0);
        if (!pending) return send(200, { ok: true, total: 0, got: 0, msg: '这些记录的子体都已有价格, 无需补' });
        const limit = Math.min(300, Math.max(1, parseInt(j.limit || pending, 10) || pending));
        // 后台执行: 26 个子体约 3~4 分钟, 不能把 HTTP 请求挂那么久
        beginCollectProgress('fillchildprice', '补子体价格', { step: '启动', detailTotal: limit });
        (async () => {
          try {
            const r = await fillChildPrices(recs, limit);
            save('listing-records.json', listingRecords);
            pushNotify('子体价格补全完成', '读了 ' + r.total + ' 个子体, 成功 ' + r.got + ' 个' +
              (r.mismatch ? ', ASIN 不符跳过 ' + r.mismatch : '') + (r.failed ? ', 读不到 ' + r.failed : '') + (r.stopped ? ' (被停止)' : ''),
              '记录: ' + recs.map((x) => x.id).join(', '));
          } catch (e) {
            console.error('[fill-child-price]', e && e.message);
          } finally { endCollectProgress(); }
        })();
        return send(200, { ok: true, started: true, records: recs.length, pending, limit, note: '后台执行中, 进度见 /api/collect/progress; 完成后刷新列表' });
      }

      /* ===== ★ 上架记录 API (与商品库隔离) ===== */

      // 插件推送采集结果 → 入上架记录. 已存在(同 asin@site)则更新商品字段, 但【保留 status/note/listedAt】
      if (p === '/api/listing/ingest' && req.method === 'POST') {
        const ra = String((req.socket && req.socket.remoteAddress) || '');
        if (!/^(::1|::ffff:127\.0\.0\.1|127\.0\.0\.1)$/.test(ra)) return send(403, { error: '仅允许本机调用' });
        const rawItems = Array.isArray(j.items) ? j.items : (j.item ? [j.item] : []);
        if (!rawItems.length) return send(400, { error: 'items 为空' });
        if (rawItems.length > 500) return send(400, { error: '单次最多 500 条, 收到 ' + rawItems.length });
        let added = 0, updated = 0; const bad = []; const ids = [];
        for (const raw of rawItems) {
          const it = normalizeListingItem(raw, j.site);
          if (!it) { bad.push(raw && raw.asin ? raw.asin : '(无ASIN)'); continue; }
          const idx = listingRecords.findIndex((r) => r.id === it.id);
          if (idx >= 0) {
            const keep = {
              status: listingRecords[idx].status, note: listingRecords[idx].note, listedAt: listingRecords[idx].listedAt, savedAt: listingRecords[idx].savedAt,
              /* ★ 上传记录必须原样留下 —— 重新采集一次商品信息不该把"上传失败过几次"抹掉 */
              uploads: listingRecords[idx].uploads, uploadsTotal: listingRecords[idx].uploadsTotal,
              failCount: listingRecords[idx].failCount, failReason: listingRecords[idx].failReason,
              failAt: listingRecords[idx].failAt, failFields: listingRecords[idx].failFields,
              fillResult: listingRecords[idx].fillResult, fillAt: listingRecords[idx].fillAt,
            };
            listingRecords[idx] = Object.assign({}, listingRecords[idx], it, keep);
            updated++;
          } else { listingRecords.unshift(it); added++; }
          ids.push(it.id);
        }
        save('listing-records.json', listingRecords);
        pushNotify('上架记录入账', '新增 ' + added + ' 条, 更新 ' + updated + ' 条' + (bad.length ? ', 非法 ' + bad.length + ' 条' : ''), '来源: 插件详情页采集');
        return send(200, { ok: true, added, updated, invalid: bad.length, invalidAsins: bad.slice(0, 20), ids, stats: listingStats() });
      }

      // 列表 (默认按 savedAt 倒序; 支持关键词/站点/状态过滤)
      /* ★ 2026-09-25 插件「确认上传」→ 落库 + 标记待填(供 bridge 在 ifast 页自动填表) */
      if (p === '/api/listing/upload' && req.method === 'POST') {
        const ra = String((req.socket && req.socket.remoteAddress) || '');
        if (!/^(::1|::ffff:127\.0\.0\.1|127\.0\.0\.1)$/.test(ra)) return send(403, { error: '仅允许本机调用' });
        const rawItems = Array.isArray(j.items) ? j.items : (j.item ? [j.item] : []);
        if (!rawItems.length) return send(400, { error: 'items 为空' });
        let added = 0, updated = 0; const ids = []; const bad = [];
        for (const raw of rawItems) {
          /* ★ 2026-09-26 防"半截更新把多变体名单清空":
           *   normalizeListingItem 写的是 `Array.isArray(raw.variantItems) ? … : []` ——
           *   也就是【请求里没带 variantItems 就会把已有记录的名单清成 0】。
           *   走插件正常上传时一定带, 所以平时不发作; 但任何"只改几个字段"的调用
           *   (外部工具/手写脚本/以后的部分更新) 都会静默清空名单, 而名单是 ifast 勾选变体的
           *   唯一依据 —— 清空后 bridge 会拒绝填表(我加的防线)或全选。
           *   实测: 我自己用嵌套 fill 发了一次, 名单就被清成 0 了(已还原)。
           *   改为: 请求没带 variantItems 就沿用已有的(想真清空请显式传 [])。
           */
          if (raw && raw.variantItems === undefined) {
            const k = String(raw.asin || '').toUpperCase().trim() + '@' + String(raw.site || j.site || '').toLowerCase();
            const old = listingRecords.find((r) => r.id === k);
            if (old && old.fill && Array.isArray(old.fill.variantItems) && old.fill.variantItems.length) {
              raw.variantItems = JSON.parse(JSON.stringify(old.fill.variantItems));
              if (raw.variantParent === undefined) raw.variantParent = old.fill.variantParent || null;
              if (raw.fillMode === undefined) raw.fillMode = old.fill.fillMode || null;
            }
          }
          const it = normalizeListingItem(raw, j.site);
          if (!it) { bad.push(raw && raw.asin ? raw.asin : '(无ASIN)'); continue }
          /* ★ 再次上传 = 用户要重新走一遍填表 → 打一个"重填"时间戳;
           *   状态本身不再存, 由上传记录推导(见 uploadResultOf/fillStateOf) */
          it.refillAt = now();
          const idx = listingRecords.findIndex((r) => r.id === it.id);
          if (idx >= 0) {
            const keep = {
              status: listingRecords[idx].status, note: listingRecords[idx].note, listedAt: listingRecords[idx].listedAt, fillAt: listingRecords[idx].fillAt, fillResult: listingRecords[idx].fillResult,
              /* ★ 同 ingest: 重新入队不清上传记录 */
              uploads: listingRecords[idx].uploads, uploadsTotal: listingRecords[idx].uploadsTotal,
              failCount: listingRecords[idx].failCount, failReason: listingRecords[idx].failReason,
              failAt: listingRecords[idx].failAt, failFields: listingRecords[idx].failFields,
            };
            listingRecords[idx] = Object.assign({}, listingRecords[idx], it, keep);
            updated++;
          } else { listingRecords.unshift(it); added++ }
          ids.push(it.id);
        }
        save('listing-records.json', listingRecords);
        pushNotify('上传任务入账', '新增 ' + added + ' 条, 更新 ' + updated + ' 条' + (bad.length ? (', 非法 ' + bad.length) : ''), '到 ifast 的「导入导出 → 添加跟卖」里填入');
        const todo = listingRecords.filter((r) => { const s = fillStateOf(r); return s === 'pending' || s === 'failed' }).length;
        return send(200, { ok: true, added, updated, invalid: bad.length, ids, todo, stats: listingStats() });
      }

      /* ★ bridge(跑在 ifast.top) 取要填的任务。
       * 2026-09-27 起"待填"是推导出来的(见 fillStateOf), 不再是存储状态:
       *   only=todo(默认) = 还没成功上传过的(含上次失败的 → 天然支持"重传")
       *   only=done / failed / pending = 按推导出的队列位置过滤
       *   only=all = 全部(带 fill 数据的) */
      if (p === '/api/listing/fill-tasks' && req.method === 'GET') {
        const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') || '5', 10) || 5));
        const only = String(url.searchParams.get('status') || 'todo');
        const wantAsin = String(url.searchParams.get('asin') || '').toUpperCase().trim();
        // ★ 只有真的带 fill 数据(插件「确认上传」落下来的)才算任务:
        //   历史记录(旧采集入库生成的)没有 fill 对象, 却曾被默认成 todo, 会让 bridge 去填一堆空值。
        const hasFill = listingHasFill;
        let list = listingRecords.filter((r) => {
          if (wantAsin && String(r.asin || '').toUpperCase() !== wantAsin) return false;
          if (only === 'all') return hasFill(r) || (r.uploads || []).length > 0;
          const st = fillStateOf(r);
          if (only === 'todo') return st === 'pending' || st === 'failed';       // 还没成功过的都要(失败的可重传)
          return st === only;
        });
        const noFill = listingRecords.filter((r) => !hasFill(r)).length;
        return send(200, { ok: true, total: list.length, skippedNoFill: noFill, items: list.slice(0, limit).map(decorateListing) });
      }

      /* ★ 把已填/已上传的记录退回「待填」—— 重新填一遍或填错了重来 */
      if (p === '/api/listing/fill-reset' && req.method === 'POST') {
        const ids = []
          .concat(Array.isArray(j.ids) ? j.ids : [])
          .concat(j.id ? [j.id] : [])
          .concat(j.asin ? [String(j.asin).toUpperCase()] : [])
          .map((x) => String(x));
        if (!ids.length) return send(400, { error: '要给 id / asin / ids' });
        const hit = [];
        for (const r of listingRecords) {
          if (ids.indexOf(r.id) < 0 && ids.indexOf(String(r.asin || '').toUpperCase()) < 0) continue;
          if (!r.fill) continue;                       // 没有 fill 数据的本来就不是任务
          /* ★ 只打一个"重填"时间戳, 【不清上传记录】——
           *   上架记录的职责就是"记录": 退回去重填是操作, 历史不该因此消失。
           *   (原来这里既清 fillResult、又写 fillStatus, 等于把上一次的失败原因也抹掉了) */
          r.refillAt = now(); r.fillAt = null;
          hit.push(r.id);
        }
        if (hit.length) save('listing-records.json', listingRecords);
        const todo = listingRecords.filter((r) => { const s = fillStateOf(r); return s === 'pending' || s === 'failed' }).length;
        return send(200, { ok: true, reset: hit, todo: todo });
      }

      /* ★ bridge 回报"每个框填了什么 / 提交结果" —— 这里同时是【上传记录】的落点。
       * 2026-09-27 用户要求:「上架记录只做记录，记录商品的上传数据，比如上传失败」。
       *   旧行为的问题(实测确认):
       *     · fillResult 是覆盖式的 → 上一次的失败原因被下一次尝试冲掉
       *     · 失败时只把 fillStatus 退回 todo, status 永远停在 pending → 界面上看不出"失败过"
       *     · fill-reset 直接把 fillResult 清空 → 失败连痕迹都不留
       *   现在: ① uploads[] 追加式历史(新→旧, 最多 30 条, 每次含时间/结果/原因/填失败的字段)
       *        ② 失败落 status=failed + failReason/failAt/failCount(采集器行上的「失败」红标就靠它)
       *        ③ 成功落 status=listed, 但 failCount/uploads 保留 → "第 2 次才成功"也看得见 */
      if (p === '/api/listing/fill-result' && req.method === 'POST') {
        const id = String(j.id || '');
        const r = listingRecords.find((x) => x.id === id) || (j.asin ? listingRecords.find((x) => x.asin === String(j.asin).toUpperCase()) : null);
        if (!r) return send(404, { error: '找不到记录: ' + id });
        const at = now();
        const dry = j.dryRun !== false;                        // 默认按"验证(未提交)"处理
        const failed = j.ok === false;
        const submitted = j.submitted === true;                // 真点过保存的才为 true
        const fields = Array.isArray(j.fields) ? j.fields.slice(0, 30) : [];
        const badFields = fields.filter((x) => x && x.ok === false)
          .map((x) => String(x.label || '?') + (x.note ? '(' + String(x.note).slice(0, 60) + ')' : ''))
          .slice(0, 8);
        const reason = j.note ? String(j.note).slice(0, 300) : (failed ? '(扩展没给失败原因)' : null);
        r.fillResult = { at, dryRun: dry, ok: !failed, submitted, fields, readBack: j.readBack || null, note: reason };
        r.fillAt = at;
        r.refillAt = null;              // ★ 新结果回来了 → 清掉"重填"标记(队列位置改由结果决定)
        r.uploadsTotal = (r.uploadsTotal || 0) + 1;
        if (!Array.isArray(r.uploads)) r.uploads = [];
        r.uploads.unshift({
          at, attempt: r.uploadsTotal, ok: !failed, submitted, dryRun: dry,
          reason,
          fieldsOk: fields.filter((x) => x && x.ok !== false).length,
          fieldsBad: badFields.length, badFields,
          variantScope: (r.fill && r.fill.variantScopeText) || null,
          fillMode: (r.fill && r.fill.fillMode) || null,
          from: j.from ? String(j.from).slice(0, 40) : null,
        });
        if (r.uploads.length > 30) r.uploads.length = 30;      // 只留最近 30 次, 别让记录文件无限长
        if (failed) {
          r.status = 'failed'; r.failReason = reason; r.failAt = at; r.failCount = (r.failCount || 0) + 1;
          r.failFields = badFields;
        } else {
          if (submitted) { r.status = 'listed'; r.listedAt = at; }
        }
        save('listing-records.json', listingRecords);
        return send(200, {
          ok: true, id: r.id, status: r.status,
          uploadResult: uploadResultOf(r), fillState: fillStateOf(r), fillStatus: legacyFillStatusOf(r),
          attempts: r.uploadsTotal, failCount: r.failCount || 0,
          fillResult: r.fillResult, uploads: r.uploads.slice(0, 10), stats: listingStats(),
        });
      }

      /* ★ 上传记录(全部商品的尝试流水) —— 上架记录只做记录, 这一页就是"上传日志" */
      if (p === '/api/listing/uploads' && req.method === 'GET') {
        const result = String(url.searchParams.get('result') || '').trim();     // ok | failed | 空=全部
        const site = String(url.searchParams.get('site') || '').trim().toLowerCase();
        const limit = Math.min(500, Math.max(1, parseInt(url.searchParams.get('limit') || '100', 10) || 100));
        const rows = [];
        for (const r of listingRecords) {
          if (site && String(r.site || '').toLowerCase() !== site) continue;
          for (const u of (r.uploads || [])) {
            if (result === 'failed' && u.ok !== false) continue;
            if (result === 'ok' && u.ok === false) continue;
            rows.push(Object.assign({
              id: r.id, asin: r.asin, site: r.site, parentAsin: r.parentAsin,
              title: r.title ? String(r.title).slice(0, 80) : null,
              nowStatus: r.status || 'pending', nowFillStatus: legacyFillStatusOf(r),
              nowResult: uploadResultOf(r),
              failCount: r.failCount || 0,
            }, u));
          }
        }
        rows.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
        return send(200, { ok: true, total: rows.length, items: rows.slice(0, limit), stats: listingStats() });
      }

      if (p === '/api/listing/records' && req.method === 'GET') {
        const q = String(url.searchParams.get('q') || '').trim().toLowerCase();
        const site = String(url.searchParams.get('site') || '').trim().toLowerCase();
        const status = String(url.searchParams.get('status') || '').trim();
        /* ★ 上传记录筛选 —— 按【上传结果】这一种状态数据筛(状态简化后口径):
         *   ok 成功 / failed 失败 / none 还没有结果 / everfailed 历史上失败过(含后来成功的) */
        const upload = String(url.searchParams.get('upload') || '').trim();
        let list = listingRecords.slice();
        if (site) list = list.filter((r) => String(r.site || '') === site);
        if (status) list = list.filter((r) => (r.status || 'pending') === status);
        if (upload === 'failed') list = list.filter((r) => uploadResultOf(r) === 'failed');
        else if (upload === 'ok') list = list.filter((r) => uploadResultOf(r) === 'ok');
        else if (upload === 'none') list = list.filter((r) => uploadResultOf(r) === null);
        else if (upload === 'everfailed') list = list.filter((r) => (r.failCount || 0) > 0);
        if (q) list = list.filter((r) => (String(r.asin) + ' ' + String(r.title || '') + ' ' + String(r.brand || '') + ' ' + String(r.parentAsin || '')).toLowerCase().includes(q));
        const limit = Math.min(1000, Math.max(1, parseInt(url.searchParams.get('limit') || '200', 10) || 200));
        const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);
        return send(200, { total: list.length, offset, limit, items: list.slice(offset, offset + limit).map(decorateListing), stats: listingStats() });
      }

      // 单条详情
      if (p === '/api/listing/record' && req.method === 'GET') {
        const id = String(url.searchParams.get('id') || '');
        const r = listingRecords.find((x) => x.id === id) || listingRecords.find((x) => x.asin === String(url.searchParams.get('asin') || '').toUpperCase());
        if (!r) return send(404, { error: '找不到记录: ' + id });
        return send(200, decorateListing(r));
      }

      // 改状态/备注 (上架工具回写"已上架"用)
      if (p === '/api/listing/records/status' && req.method === 'POST') {
        const ids = Array.isArray(j.ids) ? j.ids : (j.id ? [j.id] : []);
        const st = String(j.status || '').trim();
        if (!ids.length) return send(400, { error: 'ids 为空' });
        if (!['pending', 'listed', 'failed'].includes(st)) return send(400, { error: 'status 需为 pending/listed/failed' });
        let n = 0;
        listingRecords.forEach((r) => {
          if (!ids.includes(r.id)) return;
          r.status = st; n++;
          if (j.note != null) r.note = String(j.note).slice(0, 300);
          if (st === 'listed') r.listedAt = r.listedAt || now();
        });
        save('listing-records.json', listingRecords);
        return send(200, { ok: true, updated: n, stats: listingStats() });
      }

      // 删除
      if (p === '/api/listing/records/delete' && req.method === 'POST') {
        const ids = Array.isArray(j.ids) ? j.ids : (j.id ? [j.id] : []);
        const before = listingRecords.length;
        listingRecords = listingRecords.filter((r) => !ids.includes(r.id));
        save('listing-records.json', listingRecords);
        return send(200, { ok: true, deleted: before - listingRecords.length, stats: listingStats() });
      }

      // 清空 (显式操作)
      if (p === '/api/listing/records/clear' && req.method === 'POST') {
        const n = listingRecords.length;
        listingRecords = [];
        save('listing-records.json', listingRecords, true);
        return send(200, { ok: true, cleared: n, stats: listingStats() });
      }

      // 导出 (给上品工具/手工粘贴用): json | csv | txt(逗号分隔 ASIN)
      if (p === '/api/listing/export' && req.method === 'GET') {
        const fmt = String(url.searchParams.get('format') || 'json').toLowerCase();
        const ids = String(url.searchParams.get('ids') || '').split(',').map((s) => s.trim()).filter(Boolean);
        const onlyAsin = url.searchParams.get('asinOnly') === '1';
        let list = ids.length ? listingRecords.filter((r) => ids.includes(r.id)) : listingRecords.slice();
        if (url.searchParams.get('status')) list = list.filter((r) => (r.status || 'pending') === url.searchParams.get('status'));
        if (fmt === 'txt' || onlyAsin) {
          return send(200, { ok: true, total: list.length, text: list.map((r) => r.asin).join(',') });
        }
        if (fmt === 'csv') {
          const head = ['asin', 'parentAsin', 'site', 'title', 'brand', 'price', 'currency', 'bsrShop', 'bsrCat', 'sales30d', 'listedAt', 'fulfill', 'childCount', 'childAsins', 'status',
            /* ★ 2026-09-27 上传记录也导出去(上架记录只做记录 → 记录要能带走) */
            'uploadResult', 'uploadAttempts', 'failCount', 'lastUploadAt', 'lastFailAt', 'failReason'];
          const rows = list.map((r) => {
            const kids = (r.variant && r.variant.children) ? r.variant.children.map((c) => c.asin).join('|') : '';
            const p2 = r.panel || {};
            const us = r.uploads || [];
            const last = us[0] || null;
            /* ★ 状态简化后: 导出的是"上传结果"(成功/失败/空), 不再写「未上传/已填未传」这类中间态 */
            const resNow = uploadResultOf(r);
            const upResult = resNow === 'ok' ? '成功' : (resNow === 'failed' ? '失败' : '');
            return [r.asin, r.parentAsin || '', r.site || '', '"' + String(r.title || '').replace(/"/g, '""') + '"', '"' + String(r.brand || '') + '"',
              r.price != null ? r.price : '', r.currency || '', p2.bsrShop != null ? p2.bsrShop : '', p2.bsrCat != null ? p2.bsrCat : '',
              p2.sales30d != null ? p2.sales30d : '', p2.listedAt || '', p2.fulfill || '',
              (r.variant && r.variant.childCount) || 0, '"' + kids + '"', r.status || 'pending',
              upResult, r.uploadsTotal || us.length || 0, r.failCount || 0,
              last ? last.at : '', r.failAt || '',
              '"' + String(r.failReason || '').replace(/"/g, '""') + '"'].join(',');
          });
          return send(200, { ok: true, total: list.length, csv: head.join(',') + '\n' + rows.join('\n') });
        }
        return send(200, { ok: true, total: list.length, items: list, stats: listingStats() });
      }

      /* ===== ★ 选品归档库 API (2026-09-27) —— 存快照 / 检索 / 导出, 不碰采集与上架 ===== */

      // 归档: 把"当前这批选出来的品"存成一批快照 (source=listing 上架记录 / products 商品库)
      if (p === '/api/archive/save' && req.method === 'POST') {
        const ra = String((req.socket && req.socket.remoteAddress) || '');
        if (!/^(::1|::ffff:127\.0\.0\.1|127\.0\.0\.1)$/.test(ra)) return send(403, { error: '仅允许本机调用' });
        const source = String(j.source || 'listing').toLowerCase() === 'products' ? 'products' : 'listing';
        const ids = (Array.isArray(j.ids) ? j.ids : (j.id ? [j.id] : [])).map((x) => String(x));
        const q = String(j.q || '').trim().toLowerCase();
        const site = String(j.site || '').trim().toLowerCase();
        const limit = Math.min(ARCHIVE_LIMIT_HARD, Math.max(1,
          parseInt(j.limit || (source === 'products' ? ARCHIVE_LIMIT_DEFAULT : 5000), 10) || ARCHIVE_LIMIT_DEFAULT));
        let items = [], matched = 0;
        if (source === 'products') {
          let list = products;
          if (site) list = list.filter((x) => String(x.site || '').toLowerCase() === site);
          if (j.onlySaved === true) list = list.filter((x) => x.saved === true);
          if (q) list = list.filter((x) => (String(x.asin || '') + ' ' + String(x.title || '') + ' ' + String(x.brand || '')).toLowerCase().includes(q));
          if (ids.length) list = list.filter((x) => ids.includes(String(x.asin || '').toUpperCase()));
          matched = list.length;
          items = list.slice(0, limit).map(archiveItemFromProduct).filter((x) => x && x.asin);
        } else {
          let list = listingRecords.slice();
          if (ids.length) list = list.filter((r) => ids.includes(r.id) || ids.includes(String(r.asin || '').toUpperCase()));
          if (site) list = list.filter((r) => String(r.site || '').toLowerCase() === site);
          const st = String(j.status || '').trim();
          if (st) list = list.filter((r) => (r.status || 'pending') === st);
          if (q) list = list.filter((r) => (String(r.asin || '') + ' ' + String(r.title || '') + ' ' + String(r.brand || '') + ' ' + String(r.parentAsin || '')).toLowerCase().includes(q));
          matched = list.length;
          items = list.slice(0, limit).map(archiveItemFromListing).filter((x) => x && x.asin);
        }
        if (!items.length) return send(200, { ok: false, error: '没有匹配到商品, 未归档', matched: 0 });
        // 与历史批次比一遍: 标出"以前归档过"的 —— 既是重复选品的提醒, 也是去重视图的依据
        const seenAt = new Map();
        for (const b of selectionArchive.batches.slice().reverse()) for (const k of (b.keys || [])) if (!seenAt.has(k)) seenAt.set(k, b.createdAt);
        let dupCount = 0;
        for (const it of items) if (seenAt.has(it.key)) { it.dup = true; it.firstArchivedAt = seenAt.get(it.key); dupCount++; }
        const skipExisting = j.skipExisting === true;
        const droppedDup = skipExisting ? items.filter((x) => x.dup).length : 0;
        if (skipExisting) items = items.filter((x) => !x.dup);
        if (!items.length) return send(200, { ok: false, error: '这些品以前都归档过了(这次开了"跳过重复")', matched, dupCount });
        const bySite = {};
        items.forEach((it) => { const k = it.site || '?'; bySite[k] = (bySite[k] || 0) + 1; });
        /* ★ v2: 条目进【去重表】(同一个品只存一份, 记 firstArchivedAt/times), 批次只存 key 列表 */
        if (!selectionArchive.items || typeof selectionArchive.items !== 'object') selectionArchive.items = {};
        const keys = items.map((it) => it.key).filter(Boolean);
        const at = now();
        items.forEach((it) => {
          const prev = selectionArchive.items[it.key];
          selectionArchive.items[it.key] = Object.assign({}, it, {
            firstArchivedAt: (prev && prev.firstArchivedAt) || at,
            lastArchivedAt: at,
            times: ((prev && prev.times) || 0) + 1,
          });
        });
        const batch = {
          batchId: 'B' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          name: String(j.name || '').trim().slice(0, 80) || ('选品归档 ' + now().slice(0, 16)),
          source, note: j.note ? String(j.note).slice(0, 300) : null,
          createdAt: at, count: items.length, bySite, dupCount, keys,
        };
        selectionArchive.batches.unshift(batch);
        while (selectionArchive.batches.length > 200) selectionArchive.batches.pop();   // 兜底: 别让这个文件无限膨胀
        save('selection-archive.json', selectionArchive, true);
        const overflow = matched - items.length - droppedDup;
        pushNotify('选品归档', '批次「' + batch.name + '」存了 ' + items.length + ' 个品' +
          (dupCount ? ' (其中 ' + dupCount + ' 个以前归档过)' : '') + (overflow > 0 ? ', 另有 ' + overflow + ' 个超出上限未存' : ''),
          '来源: ' + (source === 'products' ? '商品库' : '上架记录'));
        return send(200, { ok: true, batchId: batch.batchId, name: batch.name, count: batch.count, matched, dupCount, droppedDup, overflow, bySite, stats: archiveStats() });
      }

      // 批次列表 (不带 items, 页面展开时再单独取)
      if (p === '/api/archive/list' && req.method === 'GET') {
        return send(200, {
          ok: true,
          batches: selectionArchive.batches.map((b) => ({
            batchId: b.batchId, name: b.name, source: b.source, note: b.note || null, createdAt: b.createdAt,
            count: b.count || (b.keys || []).length, bySite: b.bySite || {}, dupCount: b.dupCount || 0,
          })),
          stats: archiveStats(),
        });
      }

      // 归档条目 (展平; dedup=1 按 asin@site 去重留最新; 支持关键词/站点/批次/类目/区间/标签过滤)
      if (p === '/api/archive/items' && req.method === 'GET') {
        const dedup = url.searchParams.get('dedup') !== '0';
        const batchId = String(url.searchParams.get('batchId') || '').trim();
        /* ★ 指定批次时【强制不跨批去重】: "只看这批"就该看到这批实际存了什么(详见导出路由的注释)。
         *   实测: 老批次里的品后来又被归档过 → 去重把它们算到新批次头上 → 点老批次返回 0 条。 */
        const sp = (k, d) => url.searchParams.get(k) || d || '';
        const list = archiveQuery({
          dedup: batchId ? '0' : (dedup ? '1' : '0'), batchId: batchId, site: sp('site'), q: sp('q'),
          cat1: sp('cat1'), tag: sp('tag'), priceMin: sp('priceMin'), priceMax: sp('priceMax'),
          marginMin: sp('marginMin'), marginMax: sp('marginMax'), salesMin: sp('salesMin'), rankMax: sp('rankMax'),
        });
        const limit = Math.min(1000, Math.max(1, parseInt(url.searchParams.get('limit') || '200', 10) || 200));
        const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);
        return send(200, { ok: true, total: list.length, offset, limit, dedup, items: list.slice(offset, offset + limit), stats: archiveStats() });
      }

      /* ===== ★ 选品归档 · 分布统计 与 标签 (2026-09-27) ===== */

      // 分布统计: 类目/品牌/站点/配送/价格带/利润率/月销/排名/变体 + 四象限散点 + 批次趋势
      if (p === '/api/archive/stats' && req.method === 'GET') {
        const sp = (k, d) => url.searchParams.get(k) || d || '';
        const dist = archiveDistribution({
          dedup: sp('dedup', '1'), batchId: sp('batchId'), site: sp('site'), q: sp('q'),
          cat1: sp('cat1'), tag: sp('tag'), priceMin: sp('priceMin'), priceMax: sp('priceMax'),
          marginMin: sp('marginMin'), marginMax: sp('marginMax'), salesMin: sp('salesMin'), rankMax: sp('rankMax'),
        });
        return send(200, Object.assign({ ok: true, query: { dedup: url.searchParams.get('dedup') !== '0', batchId: sp('batchId'), site: sp('site') } }, dist, { stats: archiveStats() }));
      }

      // 打标签 / 去标签 (爆款/试销/放弃/季节品) —— 标签按 asin@site 存, 重新归档不会丢
      if (p === '/api/archive/tag' && req.method === 'POST') {
        const keys = (Array.isArray(j.keys) ? j.keys : (j.key ? [j.key] : [])).map((x) => String(x));
        const tag = String(j.tag || '').trim();
        if (!keys.length) return send(400, { error: '要给 keys (asin@site 或 [asin,site])' });
        if (!tag) return send(400, { error: '要给 tag' });
        if (tag.length > 12) return send(400, { error: '标签太长(≤12 字)' });
        if (!selectionArchive.tags) selectionArchive.tags = {};
        const on = j.on !== false;                       // 默认 = 打上
        let n = 0;
        keys.forEach((k) => {
          const cur = Array.isArray(selectionArchive.tags[k]) ? selectionArchive.tags[k].slice() : [];
          const has = cur.indexOf(tag) >= 0;
          if (on && !has) { cur.push(tag); n++ } else if (!on && has) { cur.splice(cur.indexOf(tag), 1); n++ }
          if (cur.length) selectionArchive.tags[k] = cur; else delete selectionArchive.tags[k];
        });
        save('selection-archive.json', selectionArchive, true);
        return send(200, { ok: true, changed: n, tags: selectionArchive.tags });
      }

      // 导出文件: csv(Excel 直接开, 前端加 BOM) | json
      if (p === '/api/archive/export' && req.method === 'GET') {
        const fmt = String(url.searchParams.get('format') || 'csv').toLowerCase();
        const batchId = String(url.searchParams.get('batchId') || '').trim();
        const sp = (k, d) => url.searchParams.get(k) || d || '';
        const list = archiveQuery({
          dedup: batchId ? '0' : (url.searchParams.get('dedup') !== '0' ? '1' : '0'), batchId: batchId,
          site: sp('site'), q: sp('q'), cat1: sp('cat1'), tag: sp('tag'),
          priceMin: sp('priceMin'), priceMax: sp('priceMax'), marginMin: sp('marginMin'), marginMax: sp('marginMax'),
          salesMin: sp('salesMin'), rankMax: sp('rankMax'),
        });
        if (fmt === 'json') return send(200, { ok: true, total: list.length, items: list, stats: archiveStats() });
        return send(200, { ok: true, total: list.length, csv: archiveCsv(list), stats: archiveStats() });
      }

      // 删批次 / 清空归档库 (只动归档, 不碰商品库与上架记录)
      if (p === '/api/archive/batch/delete' && req.method === 'POST') {
        const batchId = String(j.batchId || '');
        const before = selectionArchive.batches.length;
        selectionArchive.batches = selectionArchive.batches.filter((b) => b.batchId !== batchId);
        if (selectionArchive.batches.length === before) return send(404, { error: '找不到批次: ' + batchId });
        /* ★ v2: 条目是共享的 → 删批次后把【没有任何批次再引用】的条目清掉。
         *   否则删掉的批次里的品会继续出现在去重视图里(旧行为是跟着批次走的)。 */
        const used = new Set();
        selectionArchive.batches.forEach((b) => (b.keys || []).forEach((k) => used.add(k)));
        let orphan = 0;
        Object.keys(selectionArchive.items || {}).forEach((k) => { if (!used.has(k)) { delete selectionArchive.items[k]; delete (selectionArchive.tags || {})[k]; orphan++ } });
        save('selection-archive.json', selectionArchive, true);
        return send(200, { ok: true, deleted: before - selectionArchive.batches.length, orphanRemoved: orphan, stats: archiveStats() });
      }
      if (p === '/api/archive/clear' && req.method === 'POST') {
        const n = selectionArchive.batches.length;
        selectionArchive.batches = [];
        selectionArchive.items = {};                    // v2: 条目表也清(与"清空归档库"语义一致)
        save('selection-archive.json', selectionArchive, true);
        return send(200, { ok: true, cleared: n, stats: archiveStats() });
      }

      /* ===== ★ 自动归档(每日快照)设置与手动触发 (2026-09-27) ===== */
      if (p === '/api/archive/auto' && req.method === 'GET') {
        const a = selectionArchive.auto || {};
        const last = selectionArchive.batches[0];
        return send(200, { ok: true, auto: { enabled: a.enabled === true, hour: Number(a.hour != null ? a.hour : 3), source: a.source || 'listing', lastRunAt: a.lastRunAt || null },
          lastBatch: last ? { name: last.name, createdAt: last.createdAt, count: last.count } : null });
      }
      if (p === '/api/archive/auto' && req.method === 'POST') {
        const a = selectionArchive.auto || (selectionArchive.auto = {});
        if (j.enabled !== undefined) a.enabled = j.enabled === true;
        if (j.hour !== undefined) a.hour = Math.max(0, Math.min(23, parseInt(j.hour, 10) || 0));
        if (j.source !== undefined) a.source = String(j.source) === 'products' ? 'products' : 'listing';
        save('selection-archive.json', selectionArchive, true);
        return send(200, { ok: true, auto: a });
      }
      if (p === '/api/archive/auto/run' && req.method === 'POST') {
        const r = archiveAutoRun({ force: j.force === true });
        return send(200, Object.assign({ ok: true }, r, { stats: archiveStats() }));
      }

      // ===== 路线 B: 扩展主动推送采集 (不依赖 CDP / 9222 / 标签页跳转) =====
      // 由浏览器扩展在页面里读 Amazon DOM + 插件面板导出(zying-data-*), 组装后 POST 到这里入库。
      // 语义与其它采集路径保持一致: 统一过滤条件 → 逐条判定(未知字段放行) → 已存在 ASIN 只跳过 → 一次保存。
      if (p === '/api/collect/ingest-push' && req.method === 'POST') {
        // 只允许本机 (与插件"仅监听回环"的既有安全取向一致; 不走 CDP 就没有标签页劫持风险, 但没理由对外开口)
        const ra = String((req.socket && req.socket.remoteAddress) || '');
        if (!/^(::1|::ffff:127\.0\.0\.1|127\.0\.0\.1)$/.test(ra)) return send(403, { error: '仅允许本机调用' });
        const rawItems = Array.isArray(j.items) ? j.items : [];
        if (!rawItems.length) return send(400, { error: 'items 为空 (需传扩展采集到的商品数组)' });
        if (rawItems.length > 2000) return send(400, { error: '单次最多 2000 条, 收到 ' + rawItems.length });
        // 正有 CDP 采集在跑时不要并发写库。★ 这里故意用 200 + ok:false 而不是 409:
        //   send() 对 /api/collect/* 的任何 >=400 都会 clearCollectProgress(), 会误清掉正在运行的那个采集。
        if (collectProgress && collectProgress.running) {
          return send(200, { ok: false, busy: true, error: '正有一个采集在运行 (mode=' + (collectProgress.mode || '?') + '), 请等它结束后再推送' });
        }
        // 过滤条件: 扩展发的是 canonical 26 键 schema → 直接走 canonical 通路。
        //   (buildCollectFilter 的启发式对"只有 1 个键"的 filter 会整体丢弃, 实测会在采集侧静默变成"无过滤")
        const filter = (j.filter && typeof j.filter === 'object') ? canonicalToCollectFilter(j.filter) : buildCollectFilter(j);
        // ★ extpush4: 站点绝不默认 —— 实测未传 site 时 amazon.com.au 的商品被存成 site=uk/currency=GBP。
        //   依次尝试: 显式 site → url 的站点后缀 → 过滤条件里的站点; 全都拿不到就报错, 不猜。
        let site = String(j.site || '').toLowerCase().trim();
        if (site && !CDP_SITE_CODE[SITE_DOMAIN[site]]) site = '';        // 只接受已知站点码
        if (!site) {
          const um = String(j.url || '').match(/amazon\.([a-z.]+?)(?:\/|$)/i);
          if (um && CDP_SITE_CODE[um[1].toLowerCase()]) site = CDP_SITE_CODE[um[1].toLowerCase()];
        }
        if (!site && filter.sites && filter.sites.length) site = String(filter.sites[0]).toLowerCase();
        if (!site) return send(400, { error: '无法确定站点: 请传 site (如 au/uk/us), 或让 url 是 https://www.amazon.<站点>/... 形式' });
        const pageType = String(j.pageType || 'list');
        const norm = [];
        let bad = 0;
        for (const r of rawItems) {
          const x = pushToLinksItem(r);
          if (!x || !/^[A-Z0-9]{10}$/.test(x.asin)) { bad++; continue; }
          if (!x.site) x.site = site;
          norm.push(x);
        }
        if (!norm.length) return send(400, { error: '没有合法条目 (需 asin 为 10 位字母数字)', received: rawItems.length, invalid: bad });
        // 过滤判定: 采集侧语义 = 未知字段放行 (与 applyCollectFilter 一致)
        const passed = [];
        for (const x of norm) { if (applyCollectFilter(x, filter)) passed.push(x); }
        const filteredOut = norm.length - passed.length;
        const r = ingestLinksProducts(passed, site, 'ext-push');
        if (r.added > 0) save('products.json', products);
        pushNotify('插件采集完成', '扩展推送 ' + rawItems.length + ' 条 → 新增 ' + r.added + ' 个' + (filteredOut ? ', 过滤掉 ' + filteredOut + ' 个' : '') + (r.skipped ? ', 已存在跳过 ' + r.skipped + ' 个' : ''),
          '页面类型: ' + pageType + ' | 站点: ' + site + ' | 过滤: ' + filterDesc(filter));
        return send(200, {
          ok: true, pageType, site,
          received: rawItems.length, invalid: bad, valid: norm.length,
          passed: passed.length, filteredOut, added: r.added, skipped: r.skipped,
          total: products.length, addedAsins: r.addedAsins,
          filterDesc: filterDesc(filter),
        });
      }

      if (p === '/api/collect/real' && req.method === 'POST') {
        const r = await realCollect({ site: j.site || 'uk', category: j.category || 'Automotive', count: j.count || 10 });
        return send(200, r);
      }

      // 模拟采集任务 (生成新商品入库)
      if (p === '/api/collect/run' && req.method === 'POST') {
        const count = Math.min(20, Math.max(1, j.count || 5));
        const category = j.category || 'Automotive';
        const method = j.method || '关键词采集';
        const NEW_BRANDS = ['NOVIC', 'AutoSoul', 'TopGearPro', 'CleanDrive', 'MegaPower', 'SwiftFix', 'DriveMax', 'EcoWash'];
        const NEW_WORDS = ['Car Wash Kit', 'Wireless Charger Holder', 'Alloy Wheel Cleaner', 'Dash Cam 4K', 'Tyre Pressure Gauge', 'Air Freshener Set', 'Microfibre Cloth Pack', 'Jump Starter'];
        let added = 0;
        const used = new Set(products.map((x) => x.asin));
        for (let i = 0; i < count; i++) {
          let asin;
          do { asin = 'B0' + Math.random().toString(36).slice(2, 10).toUpperCase(); } while (used.has(asin));
          used.add(asin);
          const brand = NEW_BRANDS[Math.floor(Math.random() * NEW_BRANDS.length)];
          const word = NEW_WORDS[Math.floor(Math.random() * NEW_WORDS.length)];
          const price = Math.round((799 + Math.random() * 5000)) / 100;
          const tm = Math.random() < 0.15;
          const patent = Math.random() < 0.05;
          const item = {
            id: asin, asin, rank: null, title: `${brand} ${word}, Premium Quality ${category} Accessory`, brand,
            brandStatus: Math.random() < 0.2 ? 'registered' : 'notfound',
            bgMark: false, tmMark: tm, patentRisk: patent,
            trademarkCount: Math.floor(Math.random() * 30),
            followCount: Math.floor(Math.random() * 15), chinaSeller: Math.random() < 0.6,
            fulfill: Math.random() < 0.4 ? 'FBA' : 'FBM', amazonSell: false,
            price, currency: 'GBP', monthlySales: Math.floor(100 + Math.random() * 5000),
            reviews: Math.floor(Math.random() * 800), rating: Math.round((3.5 + Math.random() * 1.3) * 10) / 10,
            stock: Math.floor(Math.random() * 600), listedAt: new Date().toISOString().slice(0, 10),
            size: null, weight: null, variations: Math.floor(Math.random() * 4),
            referralFee: Math.round(price * 0.15 * 100) / 100, netProfit: 0,
            site: 'uk', category, collectedAt: now(), source: 'collect-task', saved: false,
          };
          item.netProfit = Math.round((item.price - item.referralFee - 3.2 - item.price * 0.3) * 100) / 100;
          item.aiScore = Math.round(Math.min(96, Math.max(30, 80 - item.trademarkCount * 0.5 - (item.patentRisk ? 25 : 0) + Math.random() * 10)));
          item.aiRiskLevel = item.patentRisk ? 'high' : item.trademarkCount > 40 || item.tmMark ? 'medium' : 'low';
          item.aiSuggestPrice = Math.round((item.price - 0.5) * 100) / 100;
          products.unshift(applyRankFields(item));
          added++;
        }
        save('products.json', products);
        pushNotify('采集完成', `「${method}」新增 ${added} 个商品`, `类目: ${category} | 当前商品库共 ${products.length} 条`);
        return send(200, { added, total: products.length, method, category });
      }

      // 导出 (txt / csv) — 返回文本内容, 前端下载
      if (p === '/api/products/export' && (req.method === 'GET' || req.method === 'HEAD')) {
        // format: xlsx(默认) | csv | txt | json ;  fields: 逗号分隔字段键 (默认"重要信息"精简列)
        // asins: 逗号分隔 → 只导选中商品; 不传 → 导全部
        const fmt = (url.searchParams.get('format') || 'xlsx').toLowerCase();
        const asins = (url.searchParams.get('asins') || '').split(',').map((s) => s.trim()).filter(Boolean);
        const list = asins.length ? products.filter((x) => asins.includes(x.asin)) : products;
        const use = exportFields((url.searchParams.get('fields') || '').split(',').map((s) => s.trim()).filter(Boolean));
        const head = use.map((f) => f.h);
        const rows = list.map((x) => use.map((f) => f.v(x)));
        const stamp = now().slice(0, 16).replace(/[-: ]/g, '');
        const fname = `zying_products_${stamp}`;
        if (fmt === 'json') return send(200, { total: list.length, fields: use.map((f) => ({ k: f.k, h: f.h })), head, rows });
        if (fmt === 'xlsx') {
          const buf = xlsxBuffer('商品', head, rows, use.map((f) => !!f.num));
          res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
          res.setHeader('Content-Disposition', `attachment; filename="${fname}.xlsx"`);
          return res.end(buf);
        }
        if (fmt === 'txt') {
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.setHeader('Content-Disposition', `attachment; filename="${fname}.txt"`);
          return res.end([head.join('\t'), ...rows.map((r) => r.map((v) => (v == null ? '' : String(v))).join('\t'))].join('\n'));
        }
        // 未知 format 以前会静默按 CSV 返回 (调用方以为拿到了 xlsx) → 明确拒绝
        if (fmt !== 'csv') return send(400, { error: '不支持的 format: ' + fmt + ' (可用: xlsx / csv / txt / json)' });
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${fname}.csv"`);
        return res.end('\uFEFF' + [head.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\r\n'));
      }
      // 导出字段清单 (前端勾选列用)
      if (p === '/api/products/export-fields' && req.method === 'GET') {
        return send(200, { default: EXPORT_DEFAULT, fields: EXPORT_FIELDS.map((f) => ({ k: f.k, h: f.h })) });
      }

      if (p === '/api/products/detail' && req.method === 'GET') {
        const asin = url.searchParams.get('asin');
        const prod = products.find((x) => x.asin === asin);
        if (!prod) return send(404, { error: '商品不存在' });
        return send(200, { ...prod, compliance: complianceCheck(prod) });
      }

      /* ★ 2026-10-02 按「卖家」批量回填卖家国家(中国卖家) —— 供国旗采集脚本用。
       * 背景: 存量 9526 条的 chinaSeller 是旧代码硬编码的 false, 从没真采过。
       *   重采全部商品代价太大(每个详情页 8~13 秒), 但【卖家国家只取决于卖家】——
       *   799 个唯一卖家就覆盖了 7693 条商品, 所以只要拿到「卖家→国家」映射就能一次回填。
       * 入参: { map: { "卖家名": "CN" | "US" | "GB" | ... } }  (显式 false 也接受, 表示"明确非中国")
       * 语义与采集侧一致(三态): 给了国家代码 → 按大中华区判定 true/false; 没给的卖家不动(保持未知)。
       * 返回: 命中并更新的商品数 + 覆盖到的卖家数。 */
      if (p === '/api/products/seller-country' && req.method === 'POST') {
        const map = (j && j.map && typeof j.map === 'object') ? j.map : null;
        if (!map) return send(400, { error: '缺少 map 参数: { map: { "卖家名": "CN" } }' });
        const keys = Object.keys(map);
        if (!keys.length) return send(400, { error: 'map 为空' });
        let updated = 0;
        const hitSellers = new Set();
        const applied = {};
        products.forEach((x) => {
          const s = x.seller || x.mainSeller;
          if (!s) return;
          const code = map[s];
          if (code == null || code === '') return;
          const cc = String(code).toUpperCase();
          const china = linksCollector.isChinaRegionCode(cc);
          if (x.sellerCountryCode !== cc) { x.sellerCountryCode = cc; updated++; }
          if (x.chinaSeller !== china) { x.chinaSeller = china; }
          hitSellers.add(s);
          applied[cc] = (applied[cc] || 0) + 1;
        });
        if (updated) save('products.json', products, true);
        return send(200, {
          ok: true, updated, matchedSellers: hitSellers.size, inputSellers: keys.length,
          byCountry: Object.keys(applied).sort((a, b) => applied[b] - applied[a]).slice(0, 20).map((c) => c + '×' + applied[c]),
          chinaTrue: products.filter((x) => x.chinaSeller === true).length,
          chinaFalse: products.filter((x) => x.chinaSeller === false).length,
        });
      }

      if (p === '/api/branddb') return send(200, { total: branddb.length, items: branddb });
      if (p === '/api/rules') return send(200, { total: rules.length, items: rules });

      if (p === '/api/compliance/check' && req.method === 'POST') {
        const prod = products.find((x) => x.asin === j.asin) || j;
        const r = complianceCheck(prod);
        if (r.level !== 'low') pushNotify('合规预警', `${r.asin} 风险等级: ${r.level}`, r.reasons.join(' | '));
        return send(200, r);
      }

      if (p === '/api/compliance/correct' && req.method === 'POST') {
        const prod = products.find((x) => x.asin === j.asin) || j;
        const r = correctCompliance(prod, j.verdict || '未备案');
        return send(200, r);
      }

      /* ================= 知识产权查重 (上架风控) =================
       * 直连官方库, 不需要浏览器:
       *   tmview     TMview 全球商标库 (70+ 局, 含中国)      ← 主力
       *   uspto      USPTO 美国商标 (状态码/商品服务项最全)
       *   euipo-tm   EUIPO 欧盟商标
       *   euipo-rcd  EUIPO 共同体外观设计 (★ 带设计图)
       * 需要浏览器自动化的(未接入): WIPO 品牌库/外观库、中国商标网
       * ========================================================= */

      if (p === '/api/ip/providers' && req.method === 'GET') {
        return send(200, {
          ok: true, providers: ipCheck.providerList(), defaultSources: ipCheck.DEFAULT_SOURCES,
          sites: ipCheck.siteList(), offices: ipCheck.OFFICES, cache: ipCheck.cacheStats(),
          euMembers: ipCheck.EU_MEMBERS,
        });
      }

      if (p === '/api/ip/cache/clear' && (req.method === 'POST' || req.method === 'GET')) {
        return send(200, { ...ipCheck.cacheClear(), ...ipCheck.cacheStats() });
      }

      // 单个关键词查重: GET /api/ip/search?q=xxx&sites=amazon.de&sources=tmview&nice=11&limit=30
      // ★ sites 是核心参数: 决定"只看哪个市场有效的商标" —— 上德国站就只看在德国有效的。
      if (p === '/api/ip/search' && req.method === 'GET') {
        const q = url.searchParams.get('q') || url.searchParams.get('term') || '';
        const opt = {
          sites: (url.searchParams.get('sites') || url.searchParams.get('site') || '').split(',').map((s) => s.trim()).filter(Boolean),
          sources: (url.searchParams.get('sources') || '').split(',').map((s) => s.trim()).filter(Boolean),
          offices: (url.searchParams.get('offices') || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean),
          nice: ipCheck.parseNiceList(url.searchParams.get('nice')),
          locarno: (url.searchParams.get('locarno') || '').split(',').map((s) => s.trim()).filter(Boolean),
          limit: parseInt(url.searchParams.get('limit') || '30', 10),
        };
        const r = await ipCheck.search(q, opt);
        if (r.error) return send(400, r);
        return send(200, r);
      }

      if (p === '/api/ip/search' && req.method === 'POST') {
        const opt = {
          sites: Array.isArray(j.sites) ? j.sites : (j.sites ? String(j.sites).split(',').filter(Boolean) : []),
          sources: Array.isArray(j.sources) ? j.sources : String(j.sources || '').split(',').filter(Boolean),
          offices: Array.isArray(j.offices) ? j.offices : [],
          nice: j.nice, locarno: j.locarno,
          limit: j.limit || 30,
          aliveOnly: j.aliveOnly !== false,
          registeredOnly: !!j.registeredOnly,
        };
        const r = await ipCheck.search(j.q || j.term, opt);
        if (r.error) return send(400, r);
        return send(200, r);
      }

      // 只出结论(不返回命中明细), 供前端列表/徽章用
      if (p === '/api/ip/risk' && (req.method === 'GET' || req.method === 'POST')) {
        const src = req.method === 'GET'
          ? {
            q: url.searchParams.get('q'),
            sites: (url.searchParams.get('sites') || url.searchParams.get('site') || '').split(',').filter(Boolean),
            sources: (url.searchParams.get('sources') || '').split(',').filter(Boolean),
            nice: url.searchParams.get('nice'), locarno: url.searchParams.get('locarno'),
          }
          : j;
        const r = await ipCheck.search(src.q || src.term, { sites: src.sites, sources: src.sources, nice: src.nice, locarno: src.locarno, limit: src.limit || 30 });
        if (r.error) return send(400, r);
        const v = ipCheck.brandVerdict(r.risk);
        return send(200, { ok: true, term: r.term, market: r.market, risk: r.risk, verdict: v, sources: r.sources, skipped: r.skipped, total: r.total });
      }

      // 批量查重(后台跑): POST { asins:[...] | all:true, sites:['amazon.de'], field:'brand'|'title', sources, nice, apply:true, limit }
      if (p === '/api/ip/batch' && req.method === 'POST') {
        if (ipBatch && ipBatch.running) return send(409, { error: '已有批量查重正在运行', batch: ipBatchSummary() });
        const field = j.field === 'title' ? 'title' : 'brand';
        let list = [];
        if (Array.isArray(j.asins) && j.asins.length) {
          const set = new Set(j.asins);
          list = products.filter((x) => set.has(x.asin));
        } else if (j.all) {
          list = products.slice();
        } else {
          // 默认: 从筛选结果里取前 N 条有品牌名、且没查过的
          list = products.filter((x) => (x[field] || '').trim());
          if (j.onlyUnchecked) list = list.filter((x) => x.ipCheck == null);
        }
        const skip = String(j.skip || '').split(',').map((s) => s.trim()).filter(Boolean);
        if (skip.length) list = list.filter((x) => !skip.some((s) => String(x[field] || '').toLowerCase().includes(s.toLowerCase())));
        const cap = Math.max(1, Math.min(200, parseInt(j.limit || '30', 10) || 30));
        // 同一个关键词只查一次: 按归一化关键词去重
        const byTerm = new Map();
        list.forEach((x) => {
          const t = String(x[field] || '').trim();
          if (!t) return;
          const k = ipCheck.normTerm(t);
          if (!k || byTerm.has(k)) return;
          byTerm.set(k, { term: t, asins: [] });
        });
        list.forEach((x) => {
          const k = ipCheck.normTerm(String(x[field] || '').trim());
          if (k && byTerm.has(k)) byTerm.get(k).asins.push(x.asin);
        });
        const terms = [...byTerm.values()].slice(0, cap);

        const sites = Array.isArray(j.sites) ? j.sites : (j.sites ? String(j.sites).split(',').filter(Boolean) : []);
        ipBatch = {
          id: 'ipb-' + Date.now().toString(36), running: true, startedAt: now(),
          field, apply: j.apply !== false, sites,
          market: ipCheck.marketFromSites(sites),
          opts: { sites, sources: j.sources, nice: j.nice, locarno: j.locarno, limit: j.limit || 30 },
          total: terms.length, done: 0, current: '', results: [], summary: { high: 0, medium: 0, low: 0, none: 0, unknown: 0, registered: 0, notfound: 0 },
          matched: list.length, errors: [],
        };
        const batchRef = ipBatch;

        (async () => {
          for (const t of terms) {
            if (!batchRef.running) break;
            batchRef.current = t.term;
            try {
              const r = await ipCheck.search(t.term, batchRef.opts);
              const v = ipCheck.brandVerdict(r.risk);
              batchRef.results.push({ term: t.term, asins: t.asins, risk: r.risk, verdict: v, total: r.total, market: r.market });
              batchRef.summary[r.risk.level] = (batchRef.summary[r.risk.level] || 0) + 1;
              batchRef.summary[v.brandStatus] = (batchRef.summary[v.brandStatus] || 0) + 1;
              if (batchRef.apply) {
                t.asins.forEach((a) => {
                  const prod = products.find((x) => x.asin === a);
                  if (!prod) return;
                  prod.ipCheck = {
                    at: now(), term: t.term, level: r.risk.level, score: r.risk.score,
                    market: r.market ? r.market.name : null,
                    tmAlive: r.risk.trademark.alive, tmExactAlive: r.risk.trademark.exactAlive,
                    dzAlive: r.risk.design.alive, advice: r.risk.advice, text: v.text,
                  };
                  prod.brandStatus = v.brandStatus;
                  prod.trademarkCount = v.trademarkCount;
                  prod.tmText = v.text;
                  const offices = [...new Set(r.items.filter((h) => h.inMarket && h.statusGroup === 'alive').map((h) => h.office).filter(Boolean))];
                  prod.tmCountries = offices;
                });
              }
            } catch (e) {
              batchRef.errors.push({ term: t.term, error: String((e && e.message) || e) });
            }
            batchRef.done++;
          }
          batchRef.running = false;
          batchRef.current = '';
          batchRef.finishedAt = now();
          if (batchRef.apply) { save('products.json', products, true); }
          try { pushNotify('知产查重完成', `批量查重 ${batchRef.done}/${batchRef.total} 个关键词${batchRef.market ? ' · ' + batchRef.market.name : ''}`, `高危 ${batchRef.summary.high || 0} · 中风险 ${batchRef.summary.medium || 0} · 低风险 ${batchRef.summary.low || 0} · 无冲突 ${batchRef.summary.none || 0}`); } catch (e) { }
        })();

        return send(200, {
          ok: true, id: ipBatch.id, total: ipBatch.total, matchedProducts: ipBatch.matched,
          field, market: ipBatch.market ? { name: ipBatch.market.name, label: ipBatch.market.label } : null,
          batch: ipBatchSummary(),
        });
      }

      if (p === '/api/ip/batch' && req.method === 'GET') {
        if (!ipBatch) return send(200, { ok: true, running: false, batch: null });
        return send(200, { ok: true, ...ipBatchSummary(), batch: { ...ipBatch, results: ipBatch.results.slice(-40) } });
      }

      if (p === '/api/ip/batch/stop' && req.method === 'POST') {
        if (!ipBatch) return send(200, { ok: true, running: false });
        ipBatch.running = false;
        return send(200, { ok: true, stopped: true, ...ipBatchSummary() });
      }

      if (p === '/api/ip/batch/clear' && req.method === 'POST') {
        if (ipBatch && ipBatch.running) return send(409, { error: '正在运行, 先停止再清空' });
        ipBatch = null;
        return send(200, { ok: true });
      }

      // 商品库知产风险总览
      if (p === '/api/ip/overview' && req.method === 'GET') {
        const checked = products.filter((x) => x.ipCheck);
        const byLevel = {}; const byStatus = {};
        checked.forEach((x) => {
          byLevel[x.ipCheck.level] = (byLevel[x.ipCheck.level] || 0) + 1;
          const s = x.brandStatus || 'unchecked';
          byStatus[s] = (byStatus[s] || 0) + 1;
        });
        return send(200, {
          ok: true, total: products.length, checked: checked.length, unchecked: products.length - checked.length,
          byLevel, byStatus, cache: ipCheck.cacheStats(),
        });
      }

      if (p === '/api/claims' && req.method === 'GET') return send(200, { total: claims.length, items: claims });
      if (p === '/api/claims' && req.method === 'POST') {
        const r = claim(j.asin, j.opts || {});
        if (r.error) return send(400, r);
        pushNotify('认领成功', `${r.asin} 已认领至草稿箱`, `SKU: ${r.sku} | 建议价: ${r.price}`);
        return send(200, r);
      }

      if (p === '/api/publish' && req.method === 'POST') {
        const r = publish(j.ids || []);
        pushNotify('刊登完成', `批量刊登 ${r.published} 条`, r.ids.join(', '));
        return send(200, r);
      }

      if (p === '/api/reprice/run' && req.method === 'POST') {
        const r = runReprice();
        const wins = r.runs.filter((x) => x.win).length;
        pushNotify('调价完成', `本轮调价 ${r.runs.length} 条, 预测抢到购物车 ${wins} 条`, `建议: ${r.stats.suggestion.suggestion}`);
        return send(200, r);
      }
      if (p === '/api/reprice') return send(200, { total: repriceHistory.length, items: repriceHistory.slice(0, 30) });

      if (p === '/api/flywheel') return send(200, flywheel);

      if (p === '/api/agent/assess' && req.method === 'POST') {
        return send(200, agentAssess(j.asin));
      }

      if (p === '/api/notify' && req.method === 'GET') return send(200, { total: notifications.length, items: notifications });
      if (p === '/api/notify/read' && req.method === 'POST') {
        notifications.forEach((n) => { if (n.id === j.id) n.read = true; });
        save('notify.json', notifications);
        return send(200, { ok: true });
      }

      return send(404, { error: '未知接口: ' + p });
    } catch (e) {
      console.error('[API ERROR]', p, e.stack);
      return send(500, { error: e.message });
    }
  });
});

/* ★ 2026-09-26 崩溃兜底(重要):
 * 症状: 一关「服务器」页 / 刷新页面 / 网络抖动, 整个 ERP 后端直接死掉, 前端全部接口 502/ECONNREFUSED。
 * 根因: MJPEG 长连接(`/api/browser/live`)在客户端断开后仍有一次 res.write, 抛 EPIPE/ERR_STREAM_DESTROYED;
 *       Node 里这类异常未捕获 = 进程直接退出, 而 server.js 只有 exit/SIGINT 处理, 没有 uncaughtException。
 * 处理: 进程级兜底 —— 只记录、不退出(本地常驻服务, 活着比"干净地死"重要)。
 *       把最后 20 条错误写到 DATA/crash.log, 便于事后定位, 前端不暴露。
 */
const __crashLog = [];
function __logCrash(tag, err) {
  try {
    const e = err || {};
    const line = '[' + now() + '] ' + tag + ' ' + (e.code || '') + ' ' + (e.message || String(e)) +
      (e.stack ? ('\n' + String(e.stack).split('\n').slice(0, 4).join('\n')) : '');
    __crashLog.push(line);
    if (__crashLog.length > 20) __crashLog.shift();
    console.error('[未捕获] ' + line);
    try { fs.appendFileSync(path.join(DATA, 'crash.log'), line + '\n'); } catch (e2) { /* 磁盘写不了也不能再抛 */ }
  } catch (e3) { /* 兜底里绝不能再抛 */ }
}
// 这些是"客户端断开/网络抖动"类, 属于正常现象, 完全静默(只进内存环形缓冲)
const __BENIGN = ['EPIPE', 'ECONNRESET', 'ERR_STREAM_DESTROYED', 'ERR_HTTP_HEADERS_SENT', 'ECONNABORTED', 'ERR_STREAM_WRITE_AFTER_END'];
function __isBenign(e) { return !!e && __BENIGN.indexOf(String(e.code || '')) >= 0 }

/* ★ 2026-09-26 生死记录:
 * 之前 ERP 后端在压测期间整个死掉过一次, 却没留下任何痕迹(进程被谁杀的 / OOM / 未捕获异常都查不出来)。
 * 这里在启动/退出/未捕获时各写一行到 DATA/server.log —— 下次再出问题至少有据可查。 */
function __lifeLog(tag, extra) {
  try {
    const mu = process.memoryUsage();
    const line = '[' + now() + '] ' + tag + ' pid=' + process.pid + ' rss=' + Math.round(mu.rss / 1048576) + 'MB heap=' + Math.round(mu.heapUsed / 1048576) + 'MB' + (extra ? (' ' + extra) : '');
    try { fs.appendFileSync(path.join(DATA, 'server.log'), line + '\n') } catch (e1) {}
    console.log(line);
  } catch (e2) { /* 记录本身绝不能再抛 */ }
}

if (require.main === module) {
  process.on('uncaughtException', (e) => { if (!__isBenign(e)) { __logCrash('uncaughtException', e); __lifeLog('UNCAUGHT', (e && e.code) || '') } });
  process.on('unhandledRejection', (e) => { if (!__isBenign(e)) { __logCrash('unhandledRejection', e); __lifeLog('UNHANDLED-REJECTION', (e && e.code) || '') } });
  __lifeLog('START');
  // 退出兜底: 攒批中的数据不会丢(正常退出 / Ctrl+C / 被 taskkill 前)
  process.on('exit', (code) => { try { __lifeLog('EXIT', 'code=' + code) } catch (e) {} flushAllOnExit(null); });
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    // ★ 2026-09-26: 记下到底是哪个信号 —— 之前 ERP 曾"干净地退出(code=0)", 但不知道谁发的信号。
    //   Windows 上关控制台窗口/父进程退出都可能送来 SIGHUP/SIGINT, 一送就走, 太脆。
    //   除了 Ctrl+C(SIGINT, 人工操作)之外, 其余信号只记日志 + 落盘, 不退出 —— 这是个常驻服务, 活着优先。
    try {
      process.on(sig, () => {
        __lifeLog('SIGNAL', sig + (sig === 'SIGINT' ? ' (Ctrl+C, 按约定退出)' : ' (忽略, 保持服务在线)'));
        try { flushAllOnExit(sig) } catch (e) {}
        if (sig === 'SIGINT') process.exit(0);
      });
    } catch (e) { /* Windows 部分信号不支持 */ }
  }
  server.listen(PORT, () => {
    console.log(`✔ 亚马逊跟卖ERP Demo 已启动`);
    console.log(`  浏览器访问: http://127.0.0.1:${PORT}`);
    console.log(`  商品: ${products.length} | 品牌: ${branddb.length} | 规则: ${rules.length}`);
    // 授权状态开机必打: 让"到底有没有受保护"一眼可见 (开发模式会明确警告)
    try {
      const ls = licenseStatus();
      console.log('  授权: ' + ls.summary);
      if (!ls.enforce && ls.reason !== 'free') console.log('  ⚠ 当前未启用授权校验 (license.config.json 里 enforce=false) —— 分发给客户前必须改成 true');   // free = 免费版构建, 不提示
      else console.log('  本机指纹: ' + ls.fingerprint);
    } catch (e) { console.log('  授权: 状态读取失败 - ' + e.message); }
    // 启动时清理历史堆积的备份(一次性把几百 MB 收回来) + 清理过期任务文件
    try {
      const bk = path.join(DATA, 'backups');
      if (fs.existsSync(bk)) {
        const names = new Set(fs.readdirSync(bk).filter((f) => /\.bak$/.test(f)).map((f) => f.split('.')[0]));
        let removed = 0;
        for (const n of names) removed += rotateBackups(n);
        if (removed) console.log(`  备份轮转: 清理 ${removed} 份历史备份 (保留最近 ${BACKUP_KEEP_RECENT} 份 + ${BACKUP_KEEP_DAYS} 天内每天 1 份)`);
      }
    } catch (e) { console.log('  备份轮转失败: ' + e.message); }
    try { linkJobStore.prune(); } catch (e) { console.log('  任务清理失败: ' + e.message); }
  });
} else {
  // 被测试 require 时: 不启动服务器, 仅导出纯函数供 node:test 使用
  module.exports = { classifyAodFailure, aodFailReason, classifyShopPageFailure, shopFailReason, sellersFromProduct, toAodUrl, preFilterByList, parseTmCountries, parseFirstAvailable, applyCollectFilter, buildCollectFilter, itemMatchesBadge, siteToHostSuffix, normFilter, filterToQuery, canonicalToCollectFilter, legacyToCanonical, filterActiveCount, filterDescCanonical, rngRange, parseGoodPrice, goodUrlKey, ensureGoodShape, goodCostVsPrice, computeProfit, referralRateFor, taxForSite, normBrandName, sameBrand, mergePanelInto, cdpBrandBatch };
}

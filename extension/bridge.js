// 智赢采集器 v2 — 上品工具数据桥 (只注入到 ifast.top)
//
// 作用: 把 ERP「上架记录」里【插件刚入库的商品】暴露给上品工具页面, 供其上架工作读取。
// 三种暴露方式 (工具方按能力任选, 也方便你手工搬运):
//   ① DOM 数据块: <script type="application/json" id="zying-listing-records">…</script>
//      → 工具页面的 JS 直接 document.getElementById('zying-listing-records') 读
//      (用 script 而非变量: 内容脚本在隔离世界, 页面主世界读不到它的 JS 变量)
//   ② window.postMessage 广播: { source:'zying-collector-v2', type:'listing-records', records, stats }
//      → 页面脚本 addEventListener('message') 收; 页面也可 postMessage({type:'zying-get-records'}) 主动要
//   ③ 页面右下角浮层: 显示条数 + 一键复制 (ASIN 列表 / 变体 JSON / CSV) + 标记已上架
//
// 数据来源: background 转发 GET /api/listing/records?status=pending (内容脚本不能直连 127.0.0.1)

(() => {
  /* ★ 2026-11-21 ifast 切换账号：在 /login 页自动填表并提交（凭据只暂存 sessionStorage，用完即删） */
  (function () {
    try {
      if (!/^\/login(\.html)?$/.test(location.pathname)) return;
      var raw = sessionStorage.getItem('zyp_ifast_switch');
      if (!raw) return;
      sessionStorage.removeItem('zyp_ifast_switch');
      var o = JSON.parse(decodeURIComponent(atob(raw)));
      if (!o || !o.u || !o.p || (Date.now() - (o.at || 0) > 180000)) return;
      var tries = 0;
      var iv = setInterval(function () {
        tries++;
        var f = document.querySelector('form[action="/login"]') || document.querySelector('form');
        var un = document.querySelector('input[name="username"]');
        var pw = document.querySelector('input[name="password"]');
        if (!f || !un || !pw) { if (tries > 60) clearInterval(iv); return; }
        clearInterval(iv);
        try {
          un.value = o.u; pw.value = o.p;
          un.dispatchEvent(new Event('input', { bubbles: true }));
          pw.dispatchEvent(new Event('input', { bubbles: true }));
          if (o.r) { var rd = f.querySelector('input[name="remember"][value="on"]'); if (rd) rd.click(); }
          setTimeout(function () { try { f.submit(); } catch (e) { var b = f.querySelector('button[lay-filter="login-submit"]'); if (b) b.click(); } }, 300);
        } catch (e) {}
      }, 250);
    } catch (e) {}
  })();
  /* ★ 2026-09-26 报错翻译(与 content.js 的 zvHumanErr 同一套):
   *   扩展被重新加载/更新后, 页面上【已注入的旧脚本】就和扩展失联了 —— 之后任何
   *   chrome.storage / chrome.runtime 调用都会抛 "Extension context invalidated"。
   *   不翻译的话, 面板上就甩一句英文, 用户完全不知道该怎么办(实测反馈)。
   *   注意: bridge.js / popup.js 各是一份独立脚本, 没法共享模块, 所以各写一份同样的实现。
   */
  function zvHumanErr(x) {
    const s = String(typeof x === 'string' ? x : ((x && x.message) || x || ''));
    if (/Extension context invalidated|message port closed|Receiving end does not exist|Could not establish connection|Cannot read propert.*chrome/i.test(s)) {
      return '插件刚被重新加载/更新过, 这个页面上的旧插件已失效 —— 按 F5 刷新页面即可恢复（数据没丢）。';
    }
    return s;
  }
  if (window.__zyingBridgeV2) return;
  window.__zyingBridgeV2 = { v: '2.1.0' };

  const DATA_ID = 'zying-listing-records';
  const MSG_SRC = 'zying-collector-v2';
  let records = [];
  let stats = null;

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ---------- 数据 ---------- */
  async function load(status) {
    /* ★ 2026-10-06 用户要求「未登录不显示数据, 只提示登录」:
     *   没登录(读不到账号名 / code 403)时【不拉记录、不渲染】, 面板只显示登录提示。
     *   curShop 由 refreshShop() 在页面打开后异步写入(1.5s/9s 各一次), 所以在它到位之前也按未登录处理。 */
    if (!curShop) {
      records = []; stats = null;
      try { setMsg('未登录 ifast —— 请先登录后再使用上架器（未登录时不显示任何上架数据）', false); } catch (e) {}
      return { records: [], stats: null, needLogin: true };
    }
    /* ★ 2026-10-07: 显式带上本店铺 —— 后端默认按"它记的当前店铺"筛, 万一别的浏览器后登录过,
     *   上架器就会看不到自己店铺的记录(NULL 店铺的旧数据也会被默认筛掉)。这里以本机登录态为准。 */
    const q = { limit: 500, shop: curShop.name };
    if (status) q.status = status;
    const r = await chrome.runtime.sendMessage({ type: 'LISTING_RECORDS', query: q });
    if (!r || !r.ok) throw new Error((r && r.error) || '后台无响应');
    records = (r.records && r.records.items) || [];
    stats = (r.records && r.records.stats) || null;
    return { records, stats };
  }

  /* ---------- 暴露给页面 ---------- */
  function publish() {
    // ① DOM 数据块 (覆盖式写入)
    const old = document.getElementById(DATA_ID);
    if (old) old.remove();
    const el = document.createElement('script');
    el.type = 'application/json';
    el.id = DATA_ID;
    el.textContent = JSON.stringify({
      v: 1, at: new Date().toISOString(), source: 'zying-collector-v2',
      total: records.length, stats,
      records: records.map((r) => ({
        id: r.id, asin: r.asin, parentAsin: r.parentAsin, site: r.site, title: r.title, brand: r.brand,
        price: r.price, currency: r.currency, mainImage: r.mainImage, url: r.url,
        cat1: r.cat1, cat2: r.cat2, cat3: r.cat3, catPath: r.catPath,
        childCount: (r.variant && r.variant.childCount) || 0,
        childAsins: ((r.variant && r.variant.children) || []).map((c) => c.asin),
        variant: r.variant || null,
        panel: r.panel || null,
        status: r.status || 'pending',
      })),
    });
    document.documentElement.appendChild(el);
    // ② postMessage 广播
    try { window.postMessage({ source: MSG_SRC, type: 'listing-records', total: records.length, stats, records }, '*'); } catch (e) {}
    // 数据块也挂到 documentElement 上, 便于工具用 document.getElementById 立刻拿到
  }

  /* ---------- 页面主动索取 ---------- */
  window.addEventListener('message', (ev) => {
    const d = ev && ev.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === 'zying-get-records') { publish(); }
    if (d.type === 'zying-mark-listed' && Array.isArray(d.ids) && d.ids.length) { markListed(d.ids); }
  });

  async function markListed(ids) {
    try {
      const r = await chrome.runtime.sendMessage({ type: 'LISTING_STATUS', ids, status: 'listed', note: '上品工具回写' });
      setMsg(r && r.ok ? ('✓ 已标记 ' + ids.length + ' 条为已上架') : ('✗ ' + zvHumanErr((r && r.error) || '失败')), r && r.ok);
      await refresh();
    } catch (e) { setMsg('✗ ' + zvHumanErr(e), false); }
  }

  /* ---------- 浮层 (风格对齐「搞薯条」: 纯黑底/白描边反色按钮/胶囊 badge/细线表格) ---------- */
  const ZV = {
    bg: '#0f1114', fg: '#e7eaf0', muted: '#8b929b', line: 'rgba(255,255,255,.10)',
    card: '#15181d', card2: '#1a1e24', red: '#e06c72', green: '#5aa877',
    font: '13px/1.5 Inter,"SF Pro Text","PingFang SC","Microsoft YaHei",-apple-system,sans-serif',
  };
  const CSS = {
    wrap: 'position:fixed;right:14px;bottom:14px;z-index:2147483647;width:620px;max-width:93vw;display:flex;flex-direction:column;overflow:hidden;background:' + ZV.bg + ';color:' + ZV.fg + ';border:1px solid ' + ZV.line + ';border-radius:10px;box-shadow:0 18px 48px rgba(0,0,0,.65);font:' + ZV.font,
    head: 'display:flex;align-items:center;gap:8px;padding:9px 12px;background:' + ZV.card + ';border-bottom:1px solid ' + ZV.line + ';border-radius:10px 10px 0 0;flex-wrap:nowrap',
    tools: 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:6px 10px;background:' + ZV.card + ';border-bottom:1px solid ' + ZV.line,
    logo: 'display:flex;flex-direction:column;line-height:1.2;min-width:0;flex:0 1 auto',
    logoName: 'font-weight:600;font-size:13.5px;letter-spacing:.4px;white-space:nowrap',
    logoSub: 'font-size:10.5px;color:' + ZV.muted + ';letter-spacing:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:190px',
    body: 'overflow:auto;max-height:46vh;padding:0;flex:0 1 auto;min-height:0;background:' + ZV.bg,
    btn: 'background:#e7eaf0;color:#14161a;border:1px solid #e7eaf0;border-radius:6px;padding:6px 13px;font-weight:500;letter-spacing:.2px;cursor:pointer;font-family:inherit;font-size:12px;white-space:nowrap',
    btn2: 'background:transparent;color:#c9cfd8;border:1px solid #2b3038;border-radius:6px;padding:6px 11px;font-weight:500;letter-spacing:.2px;cursor:pointer;font-family:inherit;font-size:12px;white-space:nowrap',
    tbl: 'width:100%;border-collapse:collapse;font-size:13px;background:' + ZV.bg,
    th: 'text-align:left;padding:9px 10px;color:' + ZV.muted + ';font-weight:500;font-size:12px;border-bottom:1px solid ' + ZV.line + ';white-space:nowrap;position:sticky;top:0;background:' + ZV.bg,
    td: 'padding:9px 10px;border-bottom:1px solid ' + ZV.line + ';vertical-align:middle;background:' + ZV.bg,
    msg: 'padding:9px 12px;border-top:1px solid ' + ZV.line + ';color:' + ZV.green + ';font-size:12px;white-space:pre-line',
  };
  function zvBadge(kind, text) {
    const C = { fba: ['#1d6fd6', '#fff'], fbm: ['#d97b1e', '#fff'], gold: ['#b7791f', '#fff'], medium: ['#565c66', '#fff'], low: ['#9aa0a8', '#111'], danger: [ZV.red, '#fff'], green: ['#1a9e5c', '#fff'] }[kind] || ['#565c66', '#fff'];
    return '<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;line-height:1.5;background:' + C[0] + ';color:' + C[1] + '">' + esc(text) + '</span>';
  }
  // 悬停反色 / 滚动条 —— CSSOM 注入 (不受页面 CSP style-src 限制)
  function injectZvStyle() {
    if (document.getElementById('zying-br-style')) return;
    try {
      const st = document.createElement('style');
      st.id = 'zying-br-style';
      (document.head || document.documentElement).appendChild(st);
      const sh = st.sheet; if (!sh) return;
      [
        '#zying-bridge-panel ::-webkit-scrollbar{width:9px;height:9px}',
        '#zying-bridge-panel ::-webkit-scrollbar-track{background:transparent}',
        '#zying-bridge-panel ::-webkit-scrollbar-thumb{background:rgba(255,255,255,.14);border-radius:5px;border:2px solid transparent;background-clip:content-box}',
        '#zying-bridge-panel button:hover{background:rgba(255,255,255,.07);border-color:#3a4048}',
      '#zying-bridge-panel button:active{transform:translateY(1px)}',
      '#zying-bridge-panel button[disabled]{opacity:.45;cursor:not-allowed}',
      '.zv2-card{background:#15181d;border:1px solid #23272e;border-radius:8px;padding:14px 16px}',
      '.zv2-title{font-weight:600;font-size:13.5px;letter-spacing:.3px;color:#e7eaf0}',
      '.zv2-sub{font-size:11.5px;line-height:1.75;color:#8b929b}',
      '.zv2-sec{border:1px solid #23272e;border-radius:8px;padding:11px 13px;margin-bottom:10px;background:#12151a}',
      '.zv2-sec-h{display:flex;align-items:center;gap:8px;margin-bottom:9px}',
      '.zv2-sec-t{font-weight:600;font-size:12px;letter-spacing:.6px;color:#9fb0c5;text-transform:none}',
      '.zv2-sec-bar{width:3px;height:12px;border-radius:2px;background:#3f7fd0}',
      '.zv2-btn{appearance:none;border:1px solid #2b3038;background:#1b1f25;color:#d3d8e0;font:500 12px/1.2 inherit;padding:7px 13px;border-radius:6px;cursor:pointer;transition:background .15s,border-color .15s}',
      '.zv2-btn:hover{background:#23282f;border-color:#39414b}',
      '.zv2-btn--primary{background:#e7eaf0;border-color:#e7eaf0;color:#14161a}',
      '.zv2-btn--primary:hover{background:#f2f5f9;border-color:#f2f5f9}',
      '.zv2-btn--quiet{background:transparent}',
      '.zv2-btn--danger{background:transparent;color:#d98b8b;border-color:#3a2f2f}',
      '.zv2-btn--danger:hover{background:rgba(217,139,139,.10);border-color:#59403f}',
      '.zv2-btn--sm{padding:4px 9px;font-size:11.5px}',
      '.zv2-input{background:#0c0e11;border:1px solid #2a2f37;color:#e7eaf0;border-radius:6px;padding:7px 9px;font:12.5px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace;box-sizing:border-box}',
      '.zv2-input:focus{outline:none;border-color:#3f7fd0}',
      '.zv2-label{font-size:11px;color:#8b929b;margin-bottom:5px}',
      '.zv2-row{display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid #1e2228}',
      '.zv2-mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}',
      '.zv2-hr{height:1px;background:#1e2228;margin:12px 0}',
      '.zv2-dot{width:6px;height:6px;border-radius:50%;display:inline-block}',
        '#zying-bridge-panel tr:hover td{background:rgba(255,255,255,.05)}',
      ].forEach((r) => { try { sh.insertRule(r, sh.cssRules.length); } catch (e) {} });
    } catch (e) {}
  }
  let box = null, bodyEl = null, msgEl = null, metaEl = null;
  /* ★ 2026-10-03 结果消息锁 + 填表进行中标志(声明必须在这里: setMsg/refresh 会用到, 放到后面会 TDZ) */
  let msgLockUntil = 0;
  let fillBusy = false;
  let msgLastLogged = '';   // log2 最后打过的内容 —— 给 setMsg 的"锁内补充日志"去重, 免得同一行出现两次
  let brSearch = '';   // ASIN 搜索关键字
let todoN = 0, lastFilledId = null;    // 待填任务数 / 最近一次填过的记录(供「退回待填」用)
  let blockingOn = null;                 // ★ 2026-10-07「重复上架拦截」开关状态: true/false, null=还没读到

  /* ══ 📤 最小化浮标(2026-10-05, 用户要求「上架器最小化形式改成和采集器一样」) ══
   *   交互与采集器 💩 完全一致: 最小化 → 整个面板收成一个可拖动浮标; 单击 → 跳动 + 260ms 后展开;
   *   按住拖动; 右键复位右下角; 位置记 bridgePoopPos; 用户拖过后不再自动避让。
   *   图标用 📤(与面板标题同图标) —— 采集器是 💩, 一眼区分。 */
  const BR_POOP_ID = 'zying-bridge-poop';
  const BR_POOP_SIZE = 44;
  let brPoop = null;
  function brPoopStyle() {
    if (document.getElementById('zying-br-poop-style')) return;
    const st = document.createElement('style');
    st.id = 'zying-br-poop-style';
    st.textContent =
      '@keyframes zyb-poop-bounce{0%{transform:translateY(0) scale(1)}26%{transform:translateY(-18px) scale(1.2)}50%{transform:translateY(0) scale(.92)}72%{transform:translateY(-8px) scale(1.08)}100%{transform:translateY(0) scale(1)}}' +
      '#' + BR_POOP_ID + '{position:fixed;right:14px;bottom:14px;width:' + BR_POOP_SIZE + 'px;height:' + BR_POOP_SIZE + 'px;border-radius:50%;' +
      'background:' + ZV.card2 + ';border:1px solid ' + ZV.line + ';box-shadow:0 8px 22px rgba(0,0,0,.6);' +
      'display:none;align-items:center;justify-content:center;font-size:24px;line-height:1;cursor:grab;user-select:none;-webkit-user-select:none;touch-action:none;z-index:2147483647}' +
      '#' + BR_POOP_ID + '.zyb-bounce{animation:zyb-poop-bounce .62s cubic-bezier(.28,.84,.42,1)}' +
      '#' + BR_POOP_ID + ':hover{transform:scale(1.1)}' +
      '#' + BR_POOP_ID + ':active{cursor:grabbing;transform:scale(.96)}';
    (document.head || document.documentElement).appendChild(st);
  }
  function brPoopBounce() { if (!brPoop) return; brPoop.classList.remove('zyb-bounce'); void brPoop.offsetWidth; brPoop.classList.add('zyb-bounce'); }
  function brPoopPlace(l, t, save) {
    if (!brPoop) return;
    const maxX = Math.max(0, window.innerWidth - BR_POOP_SIZE - 2), maxY = Math.max(0, window.innerHeight - BR_POOP_SIZE - 2);
    const x = Math.min(Math.max(0, Math.round(l)), maxX), y = Math.min(Math.max(0, Math.round(t)), maxY);
    brPoop.style.left = x + 'px'; brPoop.style.top = y + 'px'; brPoop.style.right = 'auto'; brPoop.style.bottom = 'auto';
    try { brPoop.dataset.zybMoved = '1'; } catch (e) {}
    if (save) { try { chrome.storage.local.set({ bridgePoopPos: { left: x, top: y } }); } catch (e) {} }
  }
  function brPoopAvoid() {
    if (!brPoop || brPoop.style.display === 'none') return;
    if (brPoop.dataset && brPoop.dataset.zybMoved === '1') return;
    /* ★ 2026-10-08: 默认位改用【px 定位】(原来 right/bottom 锚定) —— 滚动条一出现/消失,
     *   right 锚定会被浏览器自动重新贴边, 用户看到浮标跳几像素(实测 861→853)。 */
    brPoopPlace(Math.max(0, window.innerWidth - BR_POOP_SIZE - 14), Math.max(0, window.innerHeight - BR_POOP_SIZE - 14), false);
    try { delete brPoop.dataset.zybMoved; } catch (e) {}       // 默认位不算"用户拖过"(还要允许避让)
    const vw = window.innerWidth, vh = window.innerHeight; let topMost = null;
    document.querySelectorAll('body *').forEach((e) => {
      if (e === brPoop || e.id === BR_POOP_ID || (box && (e === box || (box.contains && box.contains(e))))) return;
      const st = getComputedStyle(e);
      if (st.position !== 'fixed' || st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return;
      const r = e.getBoundingClientRect();
      if (r.width < 24 || r.height < 24) return;
      if (r.left >= vw || r.top >= vh || r.right <= 0 || r.bottom <= 0) return;
      if (r.right < vw - 170 || r.bottom < vh - 170) return;
      if (topMost == null || r.top < topMost) topMost = r.top;
    });
    if (topMost == null) return;
    const y = Math.max(0, Math.round(topMost - BR_POOP_SIZE - 10));
    const curY = Math.round(brPoop.getBoundingClientRect().top);
    if (y < curY) { brPoop.style.top = y + 'px'; brPoop.style.bottom = 'auto' }
  }
  function brPoopReset() {
    if (!brPoop) return;
    try { delete brPoop.dataset.zybMoved; } catch (e) {}
    brPoopPlace(Math.max(0, window.innerWidth - BR_POOP_SIZE - 14), Math.max(0, window.innerHeight - BR_POOP_SIZE - 14), false);
    try { delete brPoop.dataset.zybMoved; } catch (e) {}
    try { chrome.storage.local.remove('bridgePoopPos'); } catch (e) {}
    setTimeout(brPoopAvoid, 50);
  }
  function buildBrPoop() {
    if (brPoop) return brPoop;
    brPoopStyle();
    const el = document.createElement('div');
    el.id = BR_POOP_ID; el.textContent = '上架';
    el.title = '智赢上架器已最小化 —— 单击展开 · 按住拖动 · 右键复位到右下角';
    (document.body || document.documentElement).appendChild(el);
    brPoop = el;
    let drag = null;
    const onMove = (e) => {
      if (!drag) return;
      if (!drag.moved && Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) < 3) return;
      drag.moved = true; brPoopPlace(e.clientX - drag.dx, e.clientY - drag.dy, false);
      if (e.cancelable) e.preventDefault();
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerup', onUp, true);
      document.removeEventListener('pointercancel', onUp, true);
      if (!drag) return;
      const moved = drag.moved; drag = null;
      if (moved) { const r = brPoop.getBoundingClientRect(); brPoopPlace(r.left, r.top, true); return; }
      brPoopBounce(); setTimeout(() => brCollapse(false), 260);
    };
    el.addEventListener('pointerdown', (e) => {
      if (e.button) return;
      const r = el.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, sx: e.clientX, sy: e.clientY, moved: false };
      document.addEventListener('pointermove', onMove, true);
      document.addEventListener('pointerup', onUp, true);
      document.addEventListener('pointercancel', onUp, true);
      if (e.cancelable) e.preventDefault();
    });
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); brPoopReset(); });
    window.addEventListener('resize', () => { if (brPoop && brPoop.style.display !== 'none' && brPoop.style.left !== 'auto') { const r = brPoop.getBoundingClientRect(); brPoopPlace(r.left, r.top, false); } });
    /* ★★ 2026-10-08 修【浮标位置跳变】(与采集器同一处问题): 先创建但不可见 → 位置定下来再显示。
     *   原来顺序: 同步画到默认右下角 → storage 回调才跳到记忆位置 → 之后 brPoopAvoid 还可能再挪一次。 */
    el.style.visibility = 'hidden';
    const brPoopShow = () => {
      if (!brPoop) return;
      if (brPoop.style.visibility === 'hidden') brPoop.style.visibility = '';
      if (!brPoop.dataset.zybMoved) brPoopAvoid();     // 只有"没记忆位置"时才做避让探测
    };
    try {
      chrome.storage.local.get(['bridgePoopPos'], (o) => {
        const p = o && o.bridgePoopPos;
        if (p && typeof p.left === 'number' && typeof p.top === 'number') brPoopPlace(p.left, p.top, false);
        brPoopShow();
      });
    } catch (e) { brPoopShow() }
    setTimeout(() => { if (brPoop && brPoop.style.visibility === 'hidden') brPoopShow() }, 300);   // 兜底: 别一直隐身
    return el;
  }
  /** 收起/展开唯一入口: true → 面板藏起 + 浮标出现(并跳动); false → 反之 */
  function brCollapse(hide, silent) {
    if (!box) return;
    if (!brPoop) buildBrPoop();
    box.style.display = hide ? 'none' : 'flex';     // ★ 必须 flex(写 '' 会删掉 CSS.wrap 的 inline flex)
    brPoop.style.display = hide ? 'flex' : 'none';
    if (hide && !silent) brPoopBounce();
    const t = document.getElementById('zying-br-toggle');
    if (t) { t.textContent = hide ? '+' : '–'; t.title = hide ? '展开上架器' : '最小化(整个上架器收成一个浮标)'; }
    if (hide) [400, 1200, 3000].forEach((ms) => setTimeout(brPoopAvoid, ms));
  }

  function build() {
    if (box) return;
    injectZvStyle();
    box = document.createElement('div');
    box.id = 'zying-bridge-panel';
    box.setAttribute('style', CSS.wrap);
    box.innerHTML =
      '<div style="' + CSS.head + '">' +
      '<span style="' + CSS.logo + '" title="搞薯条面板 · 上架记录">' +
      '<span style="width:3px;height:14px;border-radius:2px;background:#3f7fd0;margin-right:2px;flex:none"></span>' +
      '<span style="' + CSS.logoName + '">搞薯条面板</span>' +
      '<span id="zying-br-meta" style="' + CSS.logoSub + '">—</span>' +
      '</span>' +
      '<span style="flex:1;min-width:6px"></span>' +
      '<button id="zying-br-reload" style="' + CSS.btn2 + ';flex:none" title="重新读 ERP 数据">刷新</button>' +
      '<button id="zying-br-toggle" style="' + CSS.btn2 + ';flex:none" title="最小化(整个上架器收成一个浮标)">–</button>' +
      '</div>' +
      // ★ 2026-09-26 按钮单独一行: 原来 7 个按钮全塞在头部一行里, 实测被挤成 620x462px 的怪头
      '<div id="zying-br-tools" style="' + CSS.tools + '">' +
    /* ★ 2026-10-07 新增: 商品在 ifast 已存在时, "添加"必然被拒 → 用这个按钮走【编辑】更新价格/跟卖组 */
      /* ★ 2026-10-24 用户要求: 「上架器插件加一个同步按钮, 登录完 ifast 后同步店铺内所有商品数据」 */
    '<button id="zying-br-sync" style="' + CSS.btn2 + ';flex:none" title="登录 ifast 后点一下: 把整个账号下的商品(跟卖组/站点/在架状态/价格/库存/创建人)全部同步进 ERP, 并写进跨店台账">同步商品</button>' +
    /* ★ 2026-10-24 用户要求: 「上架器加端口创建按钮和端口填空框」——其他内网设备通过该端口取数据 */
    '<button id="zying-br-set" style="' + CSS.btn2 + ';flex:none" title="打开设置页: 「自动填表并保存」总开关、物流/采集/上传默认值、ERP 地址等">设置</button>' +
    '<button id="zying-br-switch" style="' + CSS.btn2 + ';flex:none" title="切换 ifast 登录账号（填账号密码）">切换账号</button>' +
      '<span style="flex:1;min-width:6px"></span>' +
      '<input id="zying-br-search" placeholder="搜 ASIN" style="flex:none;width:110px;padding:2px 6px;font-size:11px;border-radius:6px;border:1px solid #3a4048;background:#1b1f26;color:#e8eaee;outline:none">' +
      '</div>' +
      '<div id="zying-br-body" style="' + CSS.body + '"></div>' +
      '<div id="zying-br-msg" style="' + CSS.msg + '">就绪</div>' +
      // ★ 2026-09-26 缩放手柄(右下角): 拖动它改面板大小; 双击标题栏复位
      '<div id="zying-br-grip" title="拖动这里调整面板大小 · 双击标题栏复位" style="position:absolute;right:0;bottom:0;width:18px;height:18px;cursor:nwse-resize;background:linear-gradient(135deg,transparent 46%,' + ZV.muted + ' 47%,' + ZV.muted + ' 56%,transparent 57%,transparent 70%,' + ZV.muted + ' 71%,' + ZV.muted + ' 80%,transparent 81%);border-bottom-right-radius:10px"></div>';
    document.body.appendChild(box);
    metaEl = box.querySelector('#zying-br-meta');
    bodyEl = box.querySelector('#zying-br-body');
    msgEl = box.querySelector('#zying-br-msg');
    // ★ 拖动/缩放/复位
    const headEl = box.children[0];
    headEl.style.cursor = 'move';
    headEl.title = (headEl.title ? headEl.title + ' · ' : '') + '按住可拖动面板; 双击复位';
    headEl.addEventListener('mousedown', (e) => {
      if (e.target && e.target.closest && e.target.closest('button')) return;   // 点按钮不算拖动
      startDrag(e, 'move');
    });
    headEl.addEventListener('dblclick', () => {
      geom = null; applyGeom(); saveGeom();
      setMsg('面板位置/大小已复位', true);
    });
    const grip = box.querySelector('#zying-br-grip');
    if (grip) grip.addEventListener('mousedown', (e) => startDrag(e, 'resize'));
    loadGeom();
    box.querySelector('#zying-br-reload').onclick = () => refresh();
    /* ★ 2026-10-24 同步店铺商品 */
    const syncBtn = box.querySelector('#zying-br-sync');
    if (syncBtn) syncBtn.onclick = () => { zvSyncIfastGoods(); };
    /* ★ 2026-10-24 共享端口面板 */
    const setBtn = box.querySelector('#zying-br-set');
    if (setBtn) setBtn.onclick = () => openSettings();
    /* ★ 2026-11-21 切换 ifast 账号 */
    const switchBtn = box.querySelector('#zying-br-switch');
    if (switchBtn) switchBtn.onclick = () => openSwitchAccount();
    /* ASIN 搜索：输入即时过滤记录 */
    const searchEl = box.querySelector('#zying-br-search');
    if (searchEl) {
      searchEl.addEventListener('input', function () { brSearch = String(searchEl.value || '').trim().toUpperCase(); render(); });
    }
    /* ★ 2026-10-05 用户要求「上架器的最小化形式改成和采集器一样」: 「–」不再是"折叠列表",
     *   而是把【整个上架器】收成一个可拖动的 📤 浮标(展开时里面原样回来)。 */
    box.querySelector('#zying-br-toggle').onclick = () => brCollapse(box.style.display !== 'none');
    buildBrPoop();
    /* ★ 2026-10-05 用户要求「打开就是最小化」: 面板一构建好就收起成 📤 浮标(静默收起, 不跳动效) */
    brCollapse(true, true);
    setTimeout(() => { refreshShop().catch(() => {}); }, 1500);
    setTimeout(() => { refreshShop().catch(() => {}); }, 9000);
    /* ★ 2026-10-07: 再补两次(20s / 45s) —— 实测偶发情况: 页面刚重载时前两次请求都失败 →
     *   面板停在"未登录/0 条", 而用户其实登录着。多给两次机会, 用户不用手动刷。 */
    setTimeout(() => { if (!curShop) refreshShop().catch(() => {}); }, 20000);
    setTimeout(() => { if (!curShop) refreshShop().catch(() => {}); }, 45000);
  }
  /* ★ 2026-10-03 修: setMsg 原来是【无条件覆盖】。而 log2() 内部也调 setMsg(进度行也显示在面板上),
   *   于是"结果消息"会被随后的进度行、以及定时 refresh() 一行行冲掉。
   *   实测踩到: 干跑完成后面板停在 "[API] 本条总耗时 2.4s（未走 DOM）",
   *   而真正的结论 "✅ API 干跑完成(未提交)…" 已经不见了 —— 用户看不到结果。
   *   现在: 锁定期间只有 setMsgLock / force=true 能写; 被挡下的内容仍进 console(信息不丢)。 */
  /* ★ 2026-10-24 极简商务风: 面板消息统一去掉花哨 emoji, 只留克制符号
   *   ✓ 成功 / × 失败 / ! 提醒 / … 进行中 / → 指向; 其余装饰性符号一律剔除。 */
  function zvPlainMsg(t) {
    if (t == null) return '';
    let x = String(t);
    x = x.replace(/[\u2705\u2714\u2611]/g, '✓');
    x = x.replace(/[\u274C\u2716\u2717\u2718\u26D4]/g, '×');
    x = x.replace(/[\u26A0\u2757]/g, '!');
    x = x.replace(/[\u23F3\u231B]/g, '…');
    x = x.replace(/[\u2192\u27A1]/g, '→');
    x = x.replace(/\uFE0F|\u200D/g, '');
    try { x = x.replace(/[\u{1F000}-\u{1FAFF}]/gu, ''); } catch (e) {}
    x = x.replace(/[\u2600-\u27BF\u2B00-\u2BFF]/g, '');
    x = x.replace(/[ \t]{2,}/g, ' ').replace(/^\s+/, '').replace(/\s+$/, '');
    return x;
  }
  function setMsg(t, ok, force) {
    if (!msgEl) return;
    t = zvPlainMsg(t);
    if (!force && Date.now() < msgLockUntil && t !== msgEl.textContent) {
      /* log2() 自己已经打过 console 了(见下面的 msgLastLogged), 这里只补它没打的那些, 避免同一行出现两次 */
      if (t !== msgLastLogged) { try { console.log('[zying-br] (锁内, 未上屏)', t) } catch (e) {} }
      return;
    }
    msgEl.textContent = t; msgEl.style.color = ok ? ZV.green : ZV.red;
  }
  /* 动作开始时解除消息锁: 否则上一次 setMsgLock(例如「已连上…」30 秒)会把这次的进度/失败提示挡住 */
  function zvMsgUnlock() { msgLockUntil = 0; }
  function setMsgLock(t, ok, ms) { msgLockUntil = Date.now() + (ms || 15000); setMsg(t, ok, true); }

  /* ══════════════ 面板位置/大小(可拖动 · 可缩放 · 记忆) ══════════════
   * 为什么记在 chrome.storage: 用户调一次就该一直有效(刷新/换标签/换站点都不用再调)。
   * 只动 left/top/width/height, 不动 right —— 否则会和 CSS 里的 right:14px 打架。
   */
  const GEOM_DEF = { left: null, top: 90, width: 620, height: null };   // left=null 表示贴右边默认位
  let geom = null;
  function applyGeom() {
    if (!box) return;
    const g = Object.assign({}, GEOM_DEF, geom || {});
    if (g.left == null) { box.style.right = '14px'; box.style.left = 'auto' } else { box.style.left = Math.round(g.left) + 'px'; box.style.right = 'auto' }
    box.style.top = Math.round(g.top) + 'px';
    box.style.width = Math.round(g.width) + 'px';
    if (g.height) {
      box.style.height = Math.round(g.height) + 'px';
      if (bodyEl) { bodyEl.style.maxHeight = 'none'; bodyEl.style.flex = '1 1 auto'; bodyEl.style.minHeight = '60px' }
    } else {
      box.style.height = '';
      if (bodyEl) { bodyEl.style.maxHeight = ''; bodyEl.style.flex = ''; bodyEl.style.minHeight = '' }
    }
  }
  function saveGeom() { try { chrome.storage.local.set({ bridgeGeom: geom || null }) } catch (e) {} }
  function loadGeom(cb) {
    try {
      chrome.storage.local.get('bridgeGeom', (o) => {
        geom = (o && o.bridgeGeom) || null;
        if (geom && typeof geom.width !== 'number') geom = null;
        applyGeom();
        if (cb) cb();
      });
    } catch (e) { if (cb) cb() }
  }
  /** 拖拽通用: mousedown 后跟 document 上的 move/up */
  function startDrag(e, kind) {
    const r = box.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY;
    const base = { left: r.left, top: r.top, width: r.width, height: (geom && geom.height) ? r.height : null, fixedH: !!(geom && geom.height) };
    const move = (ev) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (kind === 'move') {
        const maxL = Math.max(0, window.innerWidth - 80), maxT = Math.max(0, window.innerHeight - 40);
        geom = {
          left: Math.min(maxL, Math.max(-base.width + 80, base.left + dx)),
          top: Math.min(maxT, Math.max(0, base.top + dy)),
          width: Math.round(base.width),
          height: base.height ? Math.round(base.height) : null,
        };
      } else {
        geom = {
          left: Math.round(box.getBoundingClientRect().left), top: Math.round(box.getBoundingClientRect().top),
          width: Math.max(360, Math.round(base.width + dx)),
          height: Math.max(200, Math.round((base.height || box.getBoundingClientRect().height) + dy)),
        };
      }
      applyGeom();
      ev.preventDefault();
    };
    const up = () => {
      document.removeEventListener('mousemove', move, true);
      document.removeEventListener('mouseup', up, true);
      document.body.style.userSelect = '';
      saveGeom();
    };
    document.addEventListener('mousemove', move, true);
    document.addEventListener('mouseup', up, true);
    document.body.style.userSelect = 'none';
    e.preventDefault();
    e.stopPropagation();
  }
  // ★ 2026-09-26 面板每 20 秒自动刷新一次, 会把"填表完成/退回成功"这类重要提示冲掉(实测: 填完 15 秒后提示没了)。
  //   重要提示加 15 秒锁, 锁内 refresh 不覆盖 msg。
  // ★ 2026-10-03: msgLockUntil / setMsgLock 已上移到 setMsg 旁边(那里要用它做判断)。
  /** 按钮已移除（用户要求删掉「填入跟卖」）：保留空实现，调用点无需改动 */
  function syncFillBtn() {}

  async function copy(text, what) {
    try {
      await navigator.clipboard.writeText(text);
      setMsg('✓ 已复制' + what + ' (' + text.length + ' 字符) — 可直接粘贴到上品工具', true);
    } catch (e) {
      setMsg('⚠ 无法写剪贴板 (' + e.message + '), 请改用页面里的 #zying-listing-records 数据块', false);
    }
  }
  /** 填表徽标 —— 2026-09-27 状态简化: 只按【上传结果】显示(已上架 / 失败)。
   *  后端不再存 fillStatus, 改由上传记录推导(fillState: pending 待填 / failed 可重传 / done 完成)。
   *  这里的"待填"只是本面板的队列提示(哪些还没填), 不再是记录的状态。 */
  function zvFillBadge(r) {
    /* ★ 只表示「填表队列」状态 —— 上架结果在右边「状态」列，两列不再重复显示「已上架」 */
    const fs = r.fillState || null;
    if (fs === 'pending') return zvBadge('medium', '待填');
    if (fs === 'failed') return zvBadge('danger', '待重填');
    if (!r.fill) return '<span style="color:' + ZV.muted + '">—</span>';
    return '<span style="color:' + ZV.muted + '">—</span>';
  }

  /** 跟卖时段短标签: 面板宽度紧张, 把「午夜(01:00--08:00)」压成「午夜 01-08」 */
  function zvFollowShort(f) {
    f = f || {};
    const win = String(f.followWindow || '');
    const m = win.match(/(\d{1,2}):(\d{2})[^\d]+(\d{1,2}):(\d{2})/);
    const hm = m ? (m[1] + '-' + m[3]) : '';
    if (f.followPreset === 'allday' || f.allDay) return '全天';
    if (f.followPreset === 'midnight') return '午夜 ' + (hm || '01-08');
    if (f.followPreset === 'midnight-sharp') return '午夜正 ' + (hm || '23-07');
    const t = String(f.followText || '');
    if (t) return t.replace(/[（(].*?[)）]/g, '').replace(/跟卖/g, '').trim().slice(0, 8) || '自定义';
    return hm || '—';
  }

  function render() {
    if (!metaEl) return;
    /* ★ 2026-10-07 修: 未登录时这行原来会被下面的计数覆盖成 "0 条 · 待填 0 · 已上架 0 · 失败 0",
     *   把 refreshShop() 写的「🔒 未登录 ifast」提示冲掉了 —— 用户看到"0 条"会以为登录正常、只是没数据,
     *   与口径「未登录不显示数据, 只做提醒登录」矛盾。这里让它以登录态为准。 */
    if (!curShop) {
      metaEl.innerHTML = '<span style="color:#c8a86a">未登录 ifast —— 请先登录</span>';
      metaEl.title = '未登录(读不到 ifast 账号名 / code 403)时不显示任何上架数据';
      if (bodyEl) bodyEl.innerHTML = '<div style="padding:14px 4px;color:#c8a86a;line-height:1.8">未登录 ifast —— 请先登录后再使用上架器<br><span style="color:#8b93a3;font-size:11.5px">未登录时不显示任何上架数据（按店铺隔离）</span></div>';
      return;
    }
    const view = brSearch ? records.filter((r) => String(r.asin || '').toUpperCase().indexOf(brSearch) >= 0) : records;
    const pend = records.filter((r) => (r.status || 'pending') === 'pending').length;
    const withV = records.filter((r) => r.variant && ((r.variant.children || []).length || r.variant.childCount)).length;
    const withP = records.filter((r) => r.variant && (r.variant.children || []).some((c) => c.price != null)).length;
    /* ★ 2026-09-27 状态简化: 记录只有"上传结果"(成功/失败); "待填"是本面板的队列提示 */
    const todo = records.filter((r) => (r.fillState || null) === 'pending').length;
    const done = records.filter((r) => (r.uploadResult || null) === 'ok').length;
    const failed = records.filter((r) => (r.uploadResult || null) === 'failed').length;
    // ★ 2026-09-26 精简: 一行太长会把面板撑大 → 只留关键数字, 完整信息放悬停提示
    metaEl.textContent = (brSearch ? (view.length + '/' + records.length + ' 条') : (records.length + ' 条')) + ' · 待填 ' + todo + ' · 已上架 ' + done + ' · 失败 ' + failed
      + (blockingOn === false ? ' · 拦截关' : '');
    metaEl.title = '共 ' + records.length + ' 条 · 待填 ' + todo + ' · 已上架 ' + done + ' · 失败 ' + failed +
      ' · 含变体 ' + withV + ' · 有子体价 ' + withP +
      (blockingOn === false ? '　｜　「重复上架拦截」当前【关闭】: 已上架的商品重复上传也会照常提交' : '　｜　重复上架拦截: 开启');
    bodyEl.innerHTML = view.length
      ? '<table style="' + CSS.tbl + '"><thead><tr>' +
        // ★ 2026-09-26 瘦身: 11 列 → 7 列(父ASIN/品牌/变体数 并进 ASIN 格的小字; 成本+承受价 合成一列)
        ['ASIN', '价格', '成本→承受', '月销', '跟卖', '填表', '状态'].map((h) => '<th style="' + CSS.th + '">' + h + '</th>').join('') +
        '</tr></thead><tbody>' + view.slice(0, 200).map((r) => {
          const cc = (r.variant && r.variant.childCount) || 0;
          const kids = (r.variant && r.variant.children) || [];
          const np = kids.filter((c) => c.price != null).length;
          const st = r.status || 'pending';
          /* ★ 2026-10-07: 被查重拦下的记录也要有自己的徽章 —— 原来它会落到"待上架"(黄), 看起来像还没处理,
           *   实际是"这个品已经上架过、这次重复被拦"（blocked 单列, 不算上架）。 */
          const stBadge = st === 'listed' ? zvBadge('green', '已上架')
            : st === 'failed' ? zvBadge('danger', '失败')
            : st === 'blocked' ? zvBadge('danger', '已拦截')
            : zvBadge('medium', '待上架');
          // ASIN 格里的小字: 品牌 · 父ASIN · 变体数(原来各占一列, 太占地)
          const sub = [
            r.brand ? esc(String(r.brand).slice(0, 14)) : '',
            r.parentAsin ? ('↳' + esc(r.parentAsin)) : '',
            cc ? (cc + '变体' + (np ? '(' + np + '价)' : '')) : '',
          ].filter(Boolean).join(' · ');
          const cost = (r.fill && r.fill.purchaseCost != null) ? r.fill.purchaseCost : null;
          const bear = (r.fill && r.fill.bearPrice != null) ? r.fill.bearPrice : null;
          return '<tr>' +
            '<td style="' + CSS.td + ';max-width:150px">' +
              '<a href="' + esc(r.url || ('https://www.amazon.' + (r.site === 'uk' ? 'co.uk' : r.site) + '/dp/' + r.asin)) + '" target="_blank" rel="noopener" style="font-family:monospace;color:inherit">' + esc(r.asin) + '</a>' +
              '<span style="color:' + ZV.muted + ';font-size:10px"> ' + esc((r.site || '').toUpperCase()) + '</span>' +
              (sub ? '<div style="color:' + ZV.muted + ';font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="' + esc(sub) + '">' + sub + '</div>' : '') +
            '</td>' +
            '<td style="' + CSS.td + ';white-space:nowrap">' + (r.price != null ? esc(r.price) + ' <span style="color:' + ZV.muted + ';font-size:10px">' + esc(r.currency || '') + '</span>' : '<span style="color:' + ZV.muted + '">—</span>') + '</td>' +
            '<td style="' + CSS.td + ';white-space:nowrap">' + (cost != null ? ('¥' + esc(cost)) : '<span style="color:' + ZV.muted + '">—</span>') + ' → <b>' + (bear != null ? esc(bear) : '<span style="color:' + ZV.muted + '">—</span>') + '</b> <span style="color:' + ZV.muted + ';font-size:10px">' + esc(r.currency || curOfSite(r.site)) + '</span>' + (r.fill && r.fill.bearHand ? ' <span style="color:#ffd79a;font-size:10px">手填</span>' : '') + '</td>' +
            '<td style="' + CSS.td + '">' + ((r.panel && r.panel.sales30d != null) ? esc(r.panel.sales30d) : '') + '</td>' +
            '<td style="' + CSS.td + ';white-space:nowrap" title="' + esc((r.fill && (r.fill.followText || '')) || '') + '">' + esc(zvFollowShort(r.fill)) + '</td>' +
            '<td style="' + CSS.td + '">' + zvFillBadge(r) + '</td>' +
            '<td style="' + CSS.td + '">' + stBadge + '</td>' +
            '</tr>';
        }).join('') + '</tbody></table>'
      : '<div style="text-align:center;color:' + ZV.muted + ';padding:28px 0;font-size:13px">上架记录为空 —— 请先在 Amazon 商品详情页用插件「采集」再「入库」</div>';
  }
  /* ══════════════ ★ 2026-09-25 「填入添加跟卖」(验证阶段: 只填不提交) ══════════════
   * 为什么放在这里: ifast 的表单必须在【已登录的浏览器】里操作, 只有扩展能做;
   *   ERP 侧只负责存任务与收回报(/api/listing/fill-tasks, /api/listing/fill-result)。
   * 铁律: 绝不点保存 —— 任何含 保存/提交/上传/确定 的按钮一律拒绝点击。
   */
  const NO_CLICK = ['保存', '提交', '上传', '确定', '发布', '确认导入', '开始导入', '开始上传', '保存并'];
  /** ★ 站点 → 币种: 承受价/初始价都是【站点本币】(定价表算法算出来的), 提示里别再写成 ¥ 了 */
  const ZV_CURCODE = { de: 'EUR', fr: 'EUR', it: 'EUR', es: 'EUR', nl: 'EUR', uk: 'GBP', us: 'USD', jp: 'JPY', ca: 'CAD', au: 'AUD', in: 'INR', mx: 'MXN', br: 'BRL', se: 'SEK', pl: 'PLN', sg: 'SGD', tr: 'TRY', ae: 'AED', sa: 'SAR' };
  const curOfSite = (s) => ZV_CURCODE[String(s || '').toLowerCase()] || '';
  /* ★ 2026-09-26 用户要求: 填完就直接在 ifast 保存 —— 原来那道"保存锁"(zvAllowSave 白名单)已删除。
   *   说明: 那道锁其实只拦 safeClick(用于点「导入导出」「添加跟卖」等), 保存本身走的是 clickReal 裸点击,
   *   所以真正决定"能不能保存"的是下面三件事: autoSubmit / 保存按钮是否唯一 / 填表校验是否通过。
   *   现在的口径: 默认就提交; 保存按钮按【可见性】收敛而不是一票否决; 校验只拦"必填"。
   *   NO_CLICK 仍然保留给 safeClick —— 那是为了保护"取消/删除/分页确定"这类危险按钮不被误点。 */
  const sleep2 = (ms) => new Promise((r) => setTimeout(r, ms));
  const t2 = (e) => (e ? String(e.innerText || e.textContent || '').replace(/\s+/g, ' ').trim() : '');

  /* ★ 2026-09-26 行为设置(面板内置设置): bridge 这边用到 autoSubmit / apiDirect。
   *   默认值必须与 settings.js 里的 DEF 一致 —— 设置页还没保存过时要保证行为等于默认。 */
  let ZV_SET = { autoSubmit: true, apiDirect: true, erpBase: 'http://127.0.0.1:3088' };
  function loadSettings(cb) {
    try {
      chrome.storage.local.get(['settings'], (o) => {
        ZV_SET = Object.assign({ autoSubmit: true, apiDirect: true }, (o && o.settings) || {});
        if (cb) cb();
      });
    } catch (e) { if (cb) cb(); }
  }
  /** 打开设置页(与采集器面板同一入口: 交给 background 开标签页) */
  /* ★ 2026-11-21 需求：设置不再开独立网页，直接在 ifast 面板内打开（与商品详情页面板一致的内嵌设置） */
  function openSettings() {
    try {
      var old = document.getElementById('zying-br-setlayer');
      if (old) { old.remove(); return; }
      var host = document.getElementById('zying-bridge-panel') || document.body;
      if (host !== document.body) host.style.position = 'relative';
      var st = {
        wrap: 'position:absolute;inset:0;z-index:60;background:' + ZV.bg + ';display:flex;flex-direction:column;border-radius:10px;overflow:hidden;font:' + ZV.font,
        head: 'display:flex;align-items:center;gap:8px;padding:9px 12px;background:' + ZV.card + ';border-bottom:1px solid ' + ZV.line + ';flex:0 0 auto',
        body: 'overflow:auto;padding:8px 12px;flex:1 1 auto;min-height:0',
        row: 'display:flex;align-items:flex-start;gap:10px;padding:6px 0;border-bottom:1px dashed ' + ZV.line,
        lab: 'flex:0 0 132px;color:' + ZV.muted + ';font-size:12px;line-height:24px',
        ctl: 'flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:8px;flex-wrap:wrap',
        inp: 'background:#111318;color:' + ZV.fg + ';border:1px solid ' + ZV.line + ';border-radius:6px;padding:3px 7px;font-size:12px;font-family:inherit;width:110px',
        sel: 'background:#111318;color:' + ZV.fg + ';border:1px solid ' + ZV.line + ';border-radius:6px;padding:3px 7px;font-size:12px;font-family:inherit',
        sub: 'color:' + ZV.muted + ';font-size:11px',
        foot: 'display:flex;gap:8px;justify-content:flex-end;padding:8px 12px;border-top:1px solid ' + ZV.line + ';background:' + ZV.card + ';flex:0 0 auto'
      };
      var layer = document.createElement('div');
      layer.id = 'zying-br-setlayer';
      layer.style.cssText = st.wrap;
      layer.innerHTML = '<div style="' + st.head + '"><b style="font-size:13px">⚙ 面板设置</b><span style="' + st.sub + ';flex:1">改完点「保存」立即生效</span><button id="zying-br-setclose" style="' + CSS.btn2 + '">✕</button></div>'
        + '<div id="zying-br-setbody" style="' + st.body + '"><div style="' + st.sub + '">读取中…</div></div>'
        + '<div style="' + st.foot + '"><button id="zying-br-setsave" style="' + CSS.btn + '">✔ 保存</button><button id="zying-br-setopen" style="' + CSS.btn2 + '">打开完整设置页</button><button id="zying-br-setcancel" style="' + CSS.btn2 + '">取消</button></div>';
      host.appendChild(layer);
      var bodyEl = layer.querySelector('#zying-br-setbody');
      var close = function () { try { layer.remove(); } catch (e) {} };
      layer.querySelector('#zying-br-setclose').onclick = close;
      layer.querySelector('#zying-br-setcancel').onclick = close;
      layer.querySelector('#zying-br-setopen').onclick = function () {
        try {
          chrome.runtime.sendMessage({ type: 'OPEN_SETTINGS' }, function (r) {
            var le = chrome.runtime.lastError;
            if (le) { setMsg('✗ 打开完整设置页失败: ' + (le.message || '后台无响应'), false); return; }
            setMsg(r && r.ok ? '✓ 已在新标签打开完整设置页' : '✗ 打开失败', !!(r && r.ok));
          });
        } catch (e) {}
      };

      /* 默认值对齐 settings.js 的 DEF */
      var DEF2 = {
        autoSubmit: true, apiDirect: true, erpBase: 'http://127.0.0.1:3088',
        defaultStock: 0, defaultLeadDays: 15, defaultWeightKg: 0,
        rankFreshMin: 30, maxRows: 200, autoVariantFetch: true,
        logisticsPick: 'lowest', defaultFollowPreset: 'allday', defaultScope: 'one', defaultFillMode: 'auto'
      };
      function row(lab, ctlHtml, subHtml) {
        return '<div style="' + st.row + '"><div style="' + st.lab + '">' + lab + '</div><div style="' + st.ctl + '">' + ctlHtml + (subHtml ? '<span style="' + st.sub + '">' + subHtml + '</span>' : '') + '</div></div>';
      }
      function selHtml(id, opts, cur) {
        return '<select id="' + id + '" style="' + st.sel + '">' + opts.map(function (o) { return '<option value="' + o[0] + '"' + (String(cur) === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>';
      }
      chrome.storage.local.get(['settings'], function (o) {
        var S0 = Object.assign({}, DEF2, (o && o.settings) || {});
        bodyEl.innerHTML = ''
          + row('自动填表并保存', '<label style="display:inline-flex;gap:6px;align-items:center;font-size:12px"><input type="checkbox" id="s-autoSubmit"' + (S0.autoSubmit ? ' checked' : '') + '>点上传后到 ifast 自动填表并保存</label>')
          + row('优先 API 直连', '<label style="display:inline-flex;gap:6px;align-items:center;font-size:12px"><input type="checkbox" id="s-apiDirect"' + (S0.apiDirect ? ' checked' : '') + '>直连 ifast 接口提交（失败回退页面）</label>')
          + row('ERP 地址', '<input id="s-erpBase" type="text" style="' + st.inp + ';width:230px" value="' + String(S0.erpBase || '') + '">', '默认 127.0.0.1:3088')
          + row('默认库存', '<input id="s-defaultStock" type="number" style="' + st.inp + '" value="' + Number(S0.defaultStock || 0) + '">')
          + row('备货周期（天）', '<input id="s-defaultLeadDays" type="number" style="' + st.inp + '" value="' + Number(S0.defaultLeadDays || 0) + '">')
          + row('默认重量（kg）', '<input id="s-defaultWeightKg" type="number" step="0.01" style="' + st.inp + '" value="' + Number(S0.defaultWeightKg || 0) + '">', '采不到重量时使用')
          + row('排名新鲜度（分钟）', '<input id="s-rankFreshMin" type="number" style="' + st.inp + '" value="' + Number(S0.rankFreshMin || 0) + '">')
          + row('面板最多行数', '<input id="s-maxRows" type="number" style="' + st.inp + '" value="' + Number(S0.maxRows || 0) + '">')
          + row('详情页自动直采变体', '<label style="display:inline-flex;gap:6px;align-items:center;font-size:12px"><input type="checkbox" id="s-autoVariantFetch"' + (S0.autoVariantFetch ? ' checked' : '') + '>详情页自动逐个直采变体</label>')
          + row('物流报价', selHtml('s-logisticsPick', [['lowest', '取最低价'], ['second', '取次低价']], S0.logisticsPick))
          + row('默认跟卖时间', selHtml('s-defaultFollowPreset', [['allday', '全天跟卖（00:00-24:00）'], ['midnight', '午夜（01:00-08:00）'], ['midnight-sharp', '午夜正根（23:00-07:00）']], S0.defaultFollowPreset))
          + row('上传范围', selHtml('s-defaultScope', [['one', '单个商品'], ['family', '整个变体族']], S0.defaultScope))
          + row('上传方式', selHtml('s-defaultFillMode', [['auto', '自动'], ['single', '单个添加'], ['multi', '多变体添加']], S0.defaultFillMode));
        layer.querySelector('#zying-br-setsave').onclick = function () {
          var get = function (id) { var e = layer.querySelector('#' + id); return e ? e.value : ''; };
          var chk = function (id) { var e = layer.querySelector('#' + id); return !!(e && e.checked); };
          chrome.storage.local.get(['settings'], function (o2) {
            var S1 = Object.assign({}, DEF2, (o2 && o2.settings) || {});
            S1.autoSubmit = chk('s-autoSubmit');
            S1.apiDirect = chk('s-apiDirect');
            S1.autoVariantFetch = chk('s-autoVariantFetch');
            S1.erpBase = String(get('s-erpBase') || 'http://127.0.0.1:3088').trim();
            S1.defaultStock = Number(get('s-defaultStock')) || 0;
            S1.defaultLeadDays = Number(get('s-defaultLeadDays')) || 0;
            S1.defaultWeightKg = Number(get('s-defaultWeightKg')) || 0;
            S1.rankFreshMin = Number(get('s-rankFreshMin')) || 0;
            S1.maxRows = Number(get('s-maxRows')) || 0;
            S1.logisticsPick = get('s-logisticsPick') || 'lowest';
            S1.defaultFollowPreset = get('s-defaultFollowPreset') || 'allday';
            S1.defaultScope = get('s-defaultScope') || 'one';
            S1.defaultFillMode = get('s-defaultFillMode') || 'auto';
            chrome.storage.local.set({ settings: S1 }, function () {
              try { loadSettings(function () {}); } catch (e) {}
              setMsg('✓ 设置已保存', true);
              close();
            });
          });
        };
      });
    } catch (e) {
      try { setMsg('✗ 打开设置失败: ' + ((e && e.message) || e), false); } catch (e2) {}
    }
  }

  /* ★ 2026-11-21 切换 ifast 账号：面板内填账号/密码 → 退出当前账号 → /login 自动登录 */
  function openSwitchAccount() {
    try {
      var old = document.getElementById('zying-br-acclayer');
      if (old) { old.remove(); return; }
      var host = document.getElementById('zying-bridge-panel') || document.body;
      if (host !== document.body) host.style.position = 'relative';
      var st = {
        wrap: 'position:absolute;inset:0;z-index:60;background:' + ZV.bg + ';display:flex;flex-direction:column;border-radius:10px;overflow:hidden;font:' + ZV.font,
        head: 'display:flex;align-items:center;gap:8px;padding:9px 12px;background:' + ZV.card + ';border-bottom:1px solid ' + ZV.line + ';flex:0 0 auto',
        body: 'overflow:auto;padding:12px 14px;flex:1 1 auto;min-height:0',
        row: 'display:flex;align-items:center;gap:10px;padding:7px 0',
        lab: 'flex:0 0 72px;color:' + ZV.muted + ';font-size:12px',
        inp: 'flex:1 1 auto;background:#111318;color:' + ZV.fg + ';border:1px solid ' + ZV.line + ';border-radius:6px;padding:6px 9px;font-size:13px;font-family:inherit',
        sub: 'color:' + ZV.muted + ';font-size:11px;line-height:1.5',
        foot: 'display:flex;gap:8px;justify-content:flex-end;padding:8px 12px;border-top:1px solid ' + ZV.line + ';background:' + ZV.card + ';flex:0 0 auto'
      };
      var layer = document.createElement('div');
      layer.id = 'zying-br-acclayer';
      layer.style.cssText = st.wrap;
      layer.innerHTML = '<div style="' + st.head + '"><b style="font-size:13px">🔁 切换 ifast 账号</b><span style="' + st.sub + ';flex:1"></span><button id="zying-ac-close" style="' + CSS.btn2 + '">✕</button></div>'
        + '<div style="' + st.body + '">'
        + '<div style="' + st.row + '"><div style="' + st.lab + '">账号</div><input id="zying-ac-u" type="text" autocomplete="username" style="' + st.inp + '" placeholder="ifast 登录账号"></div>'
        + '<div style="' + st.row + '"><div style="' + st.lab + '">密码</div><input id="zying-ac-p" type="password" autocomplete="current-password" style="' + st.inp + '" placeholder="ifast 登录密码"></div>'
        + '<div style="' + st.row + '"><div style="' + st.lab + '"></div><label style="display:inline-flex;gap:6px;align-items:center;font-size:12px"><input type="checkbox" id="zying-ac-r">记住我（7 天免登录）</label></div>'
        + '<div style="' + st.sub + ';margin-top:6px">点「切换」会先退出当前账号，再用这里的账号密码登录。密码只临时存在本页会话里，登录后立即清除。</div>'
        + '</div>'
        + '<div style="' + st.foot + '"><button id="zying-ac-go" style="' + CSS.btn + '">切换</button><button id="zying-ac-cancel" style="' + CSS.btn2 + '">取消</button></div>';
      host.appendChild(layer);
      var close = function () { try { layer.remove(); } catch (e) {} };
      layer.querySelector('#zying-ac-close').onclick = close;
      layer.querySelector('#zying-ac-cancel').onclick = close;
      var uEl = layer.querySelector('#zying-ac-u');
      try { var last = localStorage.getItem('zyp_ifast_last_user'); if (last) uEl.value = last; } catch (e) {}
      layer.querySelector('#zying-ac-go').onclick = function () {
        var u = String(uEl.value || '').trim();
        var p = String(layer.querySelector('#zying-ac-p').value || '');
        var r = !!layer.querySelector('#zying-ac-r').checked;
        if (!u || !p) { try { setMsg('✗ 请填写账号和密码', false); } catch (e) {} return; }
        try { localStorage.setItem('zyp_ifast_last_user', u); } catch (e) {}
        try { sessionStorage.setItem('zyp_ifast_switch', btoa(encodeURIComponent(JSON.stringify({ u: u, p: p, r: r, at: Date.now() })))); } catch (e) {}
        try { setMsg('正在退出当前账号并切换到 ' + u + ' …', true); } catch (e) {}
        setTimeout(function () { location.href = '/logout'; }, 250);
      };
    } catch (e) {
      try { setMsg('✗ 打开切换账号失败: ' + ((e && e.message) || e), false); } catch (e2) {}
    }
  }
  /* ══════════ ★ 2026-09-26 自动提交(点保存) ══════════
   * 流程: 采集器点「上传」→ 到 ifast 填好信息 → 点保存。
   * 仍然守住的底线(只针对"点错会出大事"的动作, 不再限制保存本身):
   *   · 只点文案【正好是"保存"】的按钮 —— 「取消/删除/分页确定/保存并…」一律不点
   *   · 只点【可见】的; 多个可见时收敛到"当前可见 Tab 里的那个"
   *   · 必填(ASIN/站点/初始价/承受价)没填上就不提交(否则等于提一条残品), 次要字段缺失只警告
   */
  function zvFindSaveButton(doc) {
    try {
      const visible = (b) => b.offsetParent !== null;
      const all = [...doc.querySelectorAll('button, a, input[type=button], input[type=submit]')].filter((b) => t2(b) === '保存');
      let btns = all.filter(visible);
      /* 弹窗里有两个 Tab(单个添加 / 多变体添加), 各有一套表单各自带一个「保存」。
       * 隐藏 Tab 里的那个 offsetParent 是 null, 上面已经滤掉; 万一还有多个可见,
       * 再按"位于可见的 .layui-tab-item 里"收敛一层 —— 不再一票否决(用户要求把锁去掉)。 */
      if (btns.length > 1) {
        const inPane = btns.filter((b) => { const p = b.closest && b.closest('.layui-tab-item'); return !p || p.offsetParent !== null; });
        if (inPane.length) btns = inPane;
      }
      return { btns: btns, n: btns.length, all: all.length };
    } catch (e) { return { btns: [], n: -1, all: -1 } }
  }
  /** 点保存 + 等结果. 返回 { ok, note, layerText } */
  async function zvClickSaveAndWait(doc, say) {
    const f = zvFindSaveButton(doc);
    if (f.n === 0) {
      return { ok: false, note: '弹窗里找不到【可见】的「保存」按钮(全文里共 ' + f.all + ' 个) —— 请确认弹窗停在哪个 Tab / 表单是否已加载' };
    }
    if (f.n !== 1) {
      const where = f.btns.map((b) => { const p = b.closest && b.closest('.layui-tab-item'); const t = b.closest && b.closest('.layui-form'); return (p ? 'Tab内' : (t ? '表单内' : '其它')) }).join(', ');
      return { ok: false, note: '可见的「保存」有 ' + f.n + ' 个(' + where + ') —— 拒绝盲点, 请人工确认' };
    }
    try {
      clickReal(f.btns[0]);
      say('   [提交] 已点「保存」, 等结果…');
    } catch (e) {
      return { ok: false, note: '点保存异常: ' + ((e && e.message) || e) };
    }
    /* ★★ 2026-09-26 实测踩到的关键坑(这就是"点了保存没反应"的真因):
     *   ifast 的「保存」是 layui 的提交按钮:
     *     <button class="layui-btn" lay-filter="itemAddSubmit" lay-submit="" type="submit">保存</button>
     *   layui 是在【表单的原生 submit 事件】上派发 form.on('submit(itemAddSubmit)') 的。
     *   而 clickReal 用的是 dispatchEvent(new MouseEvent('click')) —— 合成事件 isTrusted=false,
     *   浏览器【不执行默认动作】(不会提交表单) → 点了等于没点: 页面无提示、弹窗不关、表单值也不变。
     *   (顺带说明: 之所以 Tab 切换、打开"添加跟卖"那些点击都正常, 是因为它们只是普通的事件监听,
     *    不依赖默认动作。)
     *   补一手原生提交: requestSubmit(btn) 会跑校验并真的触发 submit 事件(layui 等的就是它);
     *   不支持 requestSubmit 就退回 btn.click() —— click() 与 dispatchEvent 不同, 它带默认动作。 */
    await sleep2(600);
    const stillOpen0 = [...document.querySelectorAll('iframe')].some((x) => /item_add\.html/.test(x.getAttribute('src') || ''));
    const btn0 = f.btns[0];
    let extra = '未补(第一次点击似已生效)';
    if (stillOpen0 && btn0 && btn0.isConnected) {
      const form = btn0.closest ? btn0.closest('form') : null;
      let done = false;
      if (form && typeof form.requestSubmit === 'function') {
        try { form.requestSubmit(btn0); extra = 'requestSubmit(' + (btn0.getAttribute('lay-filter') || btn0.type) + ')'; done = true; }
        catch (e) { extra = 'requestSubmit 抛错: ' + ((e && e.message) || e); }
      }
      if (!done) { try { btn0.click(); extra = (extra ? extra + ' → ' : '') + 'btn.click()'; } catch (e) {} }
    }
    say('   [提交] 原生提交: ' + extra);
    // 可能弹"确认保存?"的二次确认层 → 只在这种层里点它的"确定"
    const docW = (() => { try { return f.btns[0] && f.btns[0].ownerDocument } catch (e) { return null } })();
    if (docW) zvWatchIframeAjax(docW);
    for (let i = 0; i < 20; i++) {
      await sleep2(800);
      let ajax = null;
      try { ajax = (docW && docW.defaultView && docW.defaultView.__zvAjaxResult) || null } catch (e) {}
      const stillOpen = [...document.querySelectorAll('iframe')].some((x) => /item_add\.html/.test(x.getAttribute('src') || ''));
      /* ★ 主判据: 提示记录器攒下来的文本(不受"提示只闪一下 / 弹窗被重建"影响) */
      const logged = zvReadIframeMsgs();
      const nowMsgs = zvCollectMsgs();
      const all = logged.concat(nowMsgs);
      const successMsg = all.find((m) => /成功|已保存|保存完成/.test(m));
      /* 文案兜底: 除固定的按钮/标题字样外, 任何一句提示都当成 ifast 给的结论报出来。
       *   不能再靠固定关键词表 —— 实测 ifast 的拒绝文案是「站点已经存在此ASIN」, 一个都不命中(实测踩过)。 */
      const anyMsg = all.find((m) => m.length >= 4 && !/^(确定|取消|是|否|关闭|信息|提示)$/.test(m));
      if (successMsg) return { ok: true, note: '页面提示: ' + successMsg.slice(0, 120), layerText: successMsg };
      if (ajax) {
        const judged = zvJudgeAjax(ajax);
        say('   [提交] 保存接口: ' + ajax.url + ' → HTTP ' + ajax.status + ' ' + (ajax.msg || ('code=' + ajax.code)));
        if (judged.ok) {
          if (anyMsg) return { ok: false, note: '页面提示: ' + anyMsg.slice(0, 120), layerText: anyMsg };
          return judged;
        }
        return judged;
      }
      const conf = document.querySelector('.layui-layer-btn0');
      if (conf && /确定|确认|是/.test(t2(conf)) && conf.offsetParent !== null) {
        const near = (document.querySelector('.layui-layer-content') || {}).innerText || '';
        say('   [提交] 出现确认层(' + String(near).replace(/\s+/g, ' ').slice(0, 40) + ') → 点确定');
        try { clickReal(conf) } catch (e) {}
      }
      if (anyMsg) return { ok: false, note: '页面提示: ' + anyMsg.slice(0, 120), layerText: anyMsg };
      /* 记录器里已经有东西但都不是提示类文案 → 也报出来, 不静默 */
      if (logged.length) say('   [提交] ifast 弹过的文字: ' + logged.slice(0, 4).join(' / '));
      if (!stillOpen) return { ok: true, note: '保存后弹窗已关闭(视为提交成功)' };
    }
    const leftover = zvReadIframeMsgs();
    return { ok: false, note: '点了保存但 16 秒内没看到 ifast 的回应' + (leftover.length ? ('(只记录到: ' + leftover.slice(0, 3).join(' / ') + ')') : '(接口/提示/弹窗关闭都没有)') + ' —— 请人工确认 ifast 里到底有没有上架' };
  }

  /** 收集页面与所有同源 iframe 里的提示文本
   *  ★★ 2026-09-26 实测踩到的第二个坑: ifast 的「添加跟卖」是个 iframe, 它自己的
   *     layui 提示(校验失败 / 保存结果)都渲染在【iframe 内部】的文档里。
   *     只在父文档 document.querySelectorAll('.layui-layer-msg') 里找的话永远找不到 ——
   *     表现就是"点了保存什么都没发生"(实测: iframe 里其实弹了「必填项不能为空」)。
   */
  function zvCollectMsgs() {
    const out = [];
    const scan = (d) => {
      if (!d) return;
      try {
        d.querySelectorAll('.layui-layer-msg, .layui-layer-content, .layui-layer-title, .layui-layer-btn0, .layui-form-danger')
          .forEach((e) => { const t = t2(e); if (t && t.length <= 160) out.push(t) });
      } catch (e) {}
    };
    scan(document);
    [...document.querySelectorAll('iframe')].forEach((fr) => { try { scan(fr.contentDocument) } catch (e) {} });
    return out;
  }

  /* ══════════ ★ 提示记录器: 解决"点了保存什么回应都没看到" ══════════
   * 为什么需要"记录"而不是"轮询当前有没有提示":
   *   实测 ifast 保存后会把整个弹窗 iframe 【销毁重建】(表单值在空↔有值之间跳、
   *   iframe 里的节点(包括我插的)全部消失), 提示层只闪一下 ——
   *   每 800ms 轮询一次的写法经常整段错过, 表现就是"点了保存但 16 秒内没看到任何回应"(实测反复踩到)。
   * 怎么做: 在弹窗 iframe 里挂 MutationObserver, 把出现的提示文本写进【父文档】里的一个隐藏节点
   *   (id=zying-msg-log) —— 放在父文档才不会随 iframe 一起被销毁; 节点是 DOM, 隔离世界读得到。
   *   iframe 重建时由父文档那层的观察者自动给新 iframe 重装观察者(见 zvInstallMsgWatch)。
   */
  const MSG_LOG_ID = 'zying-msg-log';
  function zvMsgLogBox() {
    let box = document.getElementById(MSG_LOG_ID);
    if (!box) {
      box = document.createElement('div');
      box.id = MSG_LOG_ID;
      box.style.display = 'none';
      box.setAttribute('data-log', '');
      (document.body || document.documentElement).appendChild(box);
    }
    return box;
  }
  function zvLogMsg(t) {
    try {
      t = String(t || '').replace(/\s+/g, ' ').trim();
      if (!t || t.length > 160) return;
      const box = zvMsgLogBox();
      const cur = box.getAttribute('data-log') || '';
      if (cur.indexOf('|' + t + '|') >= 0) return;              // 去重
      box.setAttribute('data-log', (cur + '|' + t).slice(-3000));
    } catch (e) {}
  }
  function zvWatchIframeMsgs(doc) {
    try {
      if (!doc) return false;
      /* ★ 用 iframe 自己的 document 存"是否已装过"的标记(存在 iframe 上是每世界一份, 不可靠);
       *   这里用 doc 上的一个隐藏节点做标记, DOM 是共享的。 */
      if (doc.getElementById('zying-msg-watching')) return false;
      const root = doc.body || doc.documentElement;
      if (!root) return false;
      const flag = doc.createElement('div');
      flag.id = 'zying-msg-watching';
      flag.style.display = 'none';
      root.appendChild(flag);
      doc.querySelectorAll('.layui-layer-msg, .layui-layer-content').forEach((e) => zvLogMsg(e.innerText));
      const W = doc.defaultView;
      const MO = W && W.MutationObserver;
      if (MO) {
        new MO((muts) => {
          muts.forEach((m) => {
            /* 只记"层"里的文字, 免得把表单渲染的每个节点都记一遍。
             * 优先取 .layui-layer-content/.layui-layer-msg 里的正文 —— 直接取整层的 innerText
             * 会把标题(「信息」)和按钮(「确定」)也带上, 报出去不干净(实测: "信息 站点已经存在此ASIN 确定")。 */
            [...(m.addedNodes || [])].forEach((n) => {
              if (!n || n.nodeType !== 1) return;
              const cls = String(n.className || '');
              if (!/layui-layer/.test(cls) && !(n.querySelector && n.querySelector('.layui-layer-content, .layui-layer-msg'))) return;
              let txt = '';
              try {
                const inner = n.querySelector && n.querySelector('.layui-layer-content, .layui-layer-msg');
                txt = inner ? inner.innerText : n.innerText;
              } catch (e) { txt = n.innerText }
              zvLogMsg(txt);
            });
          });
        }).observe(doc.documentElement, { childList: true, subtree: true });
      }
      return true;
    } catch (e) { return false }
  }
  /** 读记录器攒下的所有提示 */
  function zvReadIframeMsgs() {
    try {
      const box = document.getElementById(MSG_LOG_ID);
      return box ? String(box.getAttribute('data-log') || '').split('|').filter(Boolean) : [];
    } catch (e) { return [] }
  }
  /** 父文档这层盯着: 出现 item_add 弹窗就给它装记录器(弹窗被销毁重建也能自动重装) */
  let zvMsgWatchOn = false;
  function zvInstallMsgWatch() {
    const hookAll = () => {
      [...document.querySelectorAll('iframe')].forEach((fr) => {
        try { if (/item_add\.html/.test(fr.getAttribute('src') || '')) zvWatchIframeMsgs(fr.contentDocument) } catch (e) {}
      });
    };
    hookAll();
    if (zvMsgWatchOn) return;
    zvMsgWatchOn = true;
    try { new MutationObserver(hookAll).observe(document.documentElement, { childList: true, subtree: true }) } catch (e) {}
  }

  /* ★★ 2026-09-26 实测踩到的第三个坑: 判断成功/失败不能只看提示文案的关键词。
   *   实测点保存后 ifast 的真实回应是:
   *     POST /amazon/selling/item/item_add.json → 200 {"code":500,"msg":"站点已经存在此ASIN"}
   *   弹的提示文案是「站点已经存在此ASIN」—— 我原来的关键词表(失败|错误|不能|请选择|请填写)
   *   一个都没命中, 于是被当成"没看到任何提示"。反过来说, 保存【成功】时如果文案也认不出,
   *   就会被误判成失败 → ERP 状态不更新, 用户以为没上架。所以这里直接监听那次保存请求的返回。
   *   同源 iframe 可以直接包装它自己的 XMLHttpRequest(原样透传, 只记录响应)。 */
  function zvWatchIframeAjax(doc) {
    try {
      const W = doc && (doc.defaultView || doc.parentWindow);
      if (!W || W.__zvAjaxWatched) return false;
      const XO = W.XMLHttpRequest && W.XMLHttpRequest.prototype.open;
      const XS = W.XMLHttpRequest && W.XMLHttpRequest.prototype.send;
      if (!XO || !XS) return false;
      W.__zvAjaxWatched = true;
      W.__zvAjaxResult = null;
      W.XMLHttpRequest.prototype.open = function (m, u) { try { this.__zvUrl = String(u || '') } catch (e) {} return XO.apply(this, arguments) };
      W.XMLHttpRequest.prototype.send = function () {
        const self = this;
        if (/item_add|item_save|item_update|item_list/i.test(self.__zvUrl || '')) {
          try {
            self.addEventListener('load', function () {
              let j = null; try { j = JSON.parse(self.responseText) } catch (e) {}
              W.__zvAjaxResult = {
                url: String(self.__zvUrl || '').slice(0, 90), status: self.status,
                code: (j && j.code != null) ? j.code : null,
                msg: (j && (j.msg || j.message)) || null, at: Date.now(),
              };
            });
          } catch (e) {}
        }
        return XS.apply(this, arguments);
      };
      return true;
    } catch (e) { return false }
  }
  /** 保存接口的返回怎么判(与 DOM 提示配合使用):
   *  · 实测失败长这样: {"code":500,"msg":"站点已经存在此ASIN"} —— 有 msg
   *  · 成功时通常没有 msg(只有 code/data); 所以【有 msg 就是拒绝】, 没有 msg 就是成功。
   *    不用固定 code 白名单: ifast 的成功 code 我没实测到, 猜错了会把成功判成失败(那更糟)。 */
  function zvJudgeAjax(r) {
    if (!r) return null;
    if (!r.msg) return { ok: true, note: '保存接口返回成功 (HTTP ' + r.status + (r.code != null ? ', code=' + r.code : '') + ')' };
    return { ok: false, note: 'ifast 拒绝: ' + r.msg + ' (HTTP ' + r.status + ')' };
  }

  function log2(t) { msgLastLogged = String(t == null ? '' : t); setMsg(t, true); try { console.log('[zying-br]', t) } catch (e) {} }
  function findClickable(text) {
    const all = [...document.querySelectorAll('button, a, li, span, [role=button]')];
    return all.find((e) => t2(e) === text || t2(e).indexOf(text) === 0);
  }
  function safeClick(el, why) {
    const tx = t2(el);
    for (const f of NO_CLICK) {
      if (tx.indexOf(f) < 0) continue;
      throw new Error('拒绝点击含「' + f + '」的元素: ' + tx);
    }
    el.click();
    log2('  · 已点「' + tx.slice(0, 12) + '」' + (why ? (' (' + why + ')') : ''));
  }
  /* 多变体面板的「国家」下拉用的是国家代码, 跟站点代码不完全一样(uk → GB) */
  const SITE_COUNTRY = { uk: 'GB', gb: 'GB', de: 'DE', fr: 'FR', it: 'IT', es: 'ES', au: 'AU', us: 'US', ca: 'CA', jp: 'JP', nl: 'NL', se: 'SE', pl: 'PL', mx: 'MX', br: 'BR', sg: 'SG', in: 'IN', ae: 'AE', sa: 'SA', tr: 'TR', be: 'BE', ie: 'IE', cn: 'CN', eg: 'EG' };

  /* 站点: 插件 site 代码 → ifast 站点 id (2026-09-25 实测) */
  const SITE_ID = { uk: '69131', gb: '69131', au: '69136', de: '69132', fr: '69133', it: '69134', es: '69135' };
  /* 跟卖时间: 时间窗数字 → ifast id (2026-09-25 实测) */
  const SELL_ID = { '01000800': '2503132426739', '23000700': '2408082239226' };
  const digits = (x) => String(x == null ? '' : x).replace(/\D/g, '');
  /** 跟卖时间怎么选: 时间窗数字比对 > 显式 id > 关键词 */
  function sellingIdOf(f, sel) {
    f = f || {};
    const win = digits(f.followWindow);
    // ① ifast 选项文案里的数字串 == 插件时间窗的数字串(与文案/顺序无关, 抗改版)
    if (win && sel) {
      const o = [...sel.options].find((x) => digits(x.text) === win && x.value);
      if (o) return { id: o.value, how: '选项文案数字=' + win };
    }
    if (win && SELL_ID[win]) return { id: SELL_ID[win], how: '时间窗' + win };
    if (f.allDay) return { id: '2411190735976', how: '全天' };
    const t = String(f.followText || '') + ' ' + String(f.followPreset || '');
    if (/正/.test(t) || /23:00/.test(t)) return { id: '2408082239226', how: '关键词午夜正' };
    if (/午夜/.test(t) || /01:00/.test(t)) return { id: '2503132426739', how: '关键词午夜' };
    if (/全天/.test(t)) return { id: '2411190735976', how: '关键词全天' };
    return { id: null, how: '认不出' };
  }
  /** 站点怎么选: 显式表 > 选项文案里含站点代码 */
  function siteIdOf(site, sel) {
    const k = String(site || '').toLowerCase().trim();
    const cc = SITE_COUNTRY[k] || k.toUpperCase();
    /* ★ 2026-10-07 修【站点 id 来源】: 原来【优先用硬编码 SITE_ID】(uk=69131), 而 ifast 现在的站点 id 是
     *   69181=GB / 69182=DE / 69183=FR / 69184=ES / 69185=IT（实测 /amazon/site/enable）。
     *   实测结论: 旧 id 目前仍被 ifast 接受(提交 69131 → 列表里落成 siteId 69181@GB, DE 那两条也正确落在 DE),
     *   所以**没有造成错站点**; 但这是"能用"不等于"对":
     *     · 上游哪天不认旧 id, 就会静默提交一个垃圾值, 而旧代码还把来源标成"站点表", 排查时会被误导;
     *     · 账号的站点是动态的(名字里带店铺名, 如"王祖杰-英国"), 硬编码表根本追不上。
     *   改为: 【优先实时站点表】(按国家码匹配), 匹配不到才退回内置旧表, 并**如实标注来源**。 */
    if (sel && Array.isArray(sel.options) && cc) {
      const o = sel.options.find((x) => new RegExp('【\\s*' + cc + '\\s*】', 'i').test(String(x.text || '')));
      if (o) return { id: o.value, how: '实时站点表 ' + cc };
    }
    if (SITE_ID[k]) return { id: SITE_ID[k], how: '内置旧表 ' + k };
    if (sel && Array.isArray(sel.options) && k) {
      const up = k.toUpperCase();
      const o2 = sel.options.find((x) => String(x.text || '').toUpperCase().indexOf(up) >= 0);
      if (o2) return { id: o2.value, how: '文案含' + up };
    }
    return { id: null, how: '认不出' };
  }

  /** ★ layui 的 select 是"套壳"的: 原生 select 被隐藏, 用户看的是 div.layui-form-select 里的 input。
   *  只设 select.value 界面不会变(实测 layui.form.render('select') 也不刷) → 必须手动同步显示层。 */
  function syncLayuiSelect(sel) {
    const box = sel.closest('.layui-form-select') ||
      ((sel.nextElementSibling && sel.nextElementSibling.classList && sel.nextElementSibling.classList.contains('layui-form-select')) ? sel.nextElementSibling : null);
    if (!box) return false;
    const opt = sel.options[sel.selectedIndex];
    const txt = opt ? opt.text : '';
    const ipt = box.querySelector('.layui-select-title input');
    if (ipt) { ipt.value = txt; ipt.setAttribute('value', txt); }
    [...box.querySelectorAll('dd')].forEach((dd) => {
      const on = String(dd.getAttribute('lay-value')) === String(sel.value);
      if (on) dd.classList.add('layui-this'); else dd.classList.remove('layui-this');
    });
    return !!ipt;
  }

  /** 真鼠标事件式点击: layui 的 Tab 用合成 click() 切不过去, 必须 mousedown+mouseup+click */
  function clickReal(el) {
    try {
      const d = el.ownerDocument;
      const r = el.getBoundingClientRect();
      const o = { bubbles: true, cancelable: true, view: d.defaultView, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
      el.dispatchEvent(new d.defaultView.MouseEvent('mousedown', o));
      el.dispatchEvent(new d.defaultView.MouseEvent('mouseup', o));
      el.dispatchEvent(new d.defaultView.MouseEvent('click', o));
    } catch (e) { try { el.click() } catch (e2) {} }
  }

  /** 当前【看得见】的那个 tab 面板(layui 用 .layui-show 标记激活项) */
  function activePane(doc) {
    const items = [...doc.querySelectorAll('.layui-tab-item')];
    if (!items.length) return doc;
    const shown = items.filter((el) => /layui-show/.test(el.className) || el.offsetParent !== null);
    return shown[0] || doc;
  }
  const paneHasFields = (root) => !!(root && root.querySelector('input[name=asin]') && root.querySelector('select#siteId'));

  /* ══════════ ★ 多变体流程(用户描述的真实步骤, 已真机验证) ══════════
   *   ① 切到「多变体添加」Tab
   *   ② 在「请输入要查询的asin」里填 父ASIN
   *   ③ 点国家框 → 选国家(uk→GB)
   *   ④ 点查询(搜索图标) → 结果表出现变体行
   *   ⑤ 勾选要上架的变体 → 它们进「待提交 ASIN 表」(asin/属性/sku/初始价/承受价/操作)
   *   ⑥ 填 站点 / 跟卖时间 / 库存 / 发货天数 / 备注
   *   ⑦ 每个变体各自的 初始价 / 承受价
   *   ⑧ 读回 → 回报 ERP(不点保存)
   */
  const MV = {
    bodyTable: (pane) => [...pane.querySelectorAll('table')].find((t) => /^B0[A-Z0-9]{8}/.test((t.querySelector('tbody tr') || {}).textContent || '')),
    rows: (pane) => { const t = MV.bodyTable(pane); return t ? [...t.querySelectorAll('tbody tr')] : [] },
    setInput: (doc, el, v) => {
      if (!el) return false;
      const str = v == null ? '' : String(v);
      try {
        const setter = Object.getOwnPropertyDescriptor(doc.defaultView.HTMLInputElement.prototype, 'value').set;
        setter.call(el, str);
      } catch (e) {
        // 兜底: 少数情况下(实测出现过一次 Illegal invocation)直接赋值也要能填上
        try { el.value = str } catch (e2) { return false }
      }
      try {
        el.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));
        el.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
      } catch (e) {}
      return el.value === str || el.value === String(str);
    },
    setSelect: (doc, sel, value, label) => {
      if (!sel) return { label: label, ok: false, note: '找不到下拉' };
      const hit = [...sel.options].find((o) => String(o.value) === String(value));
      if (!hit) return { label: label, ok: false, note: '选项里没有 ' + value, opts: [...sel.options].map((o) => o.text).slice(0, 10) };
      const before = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : '';
      sel.value = hit.value;
      sel.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
      try { if (doc.defaultView.layui && doc.defaultView.layui.form) doc.defaultView.layui.form.render('select') } catch (e) {}
      syncLayuiSelect(sel);
      return { label: label, ok: true, before: before, set: hit.text + ' (' + hit.value + ')' };
    },
    /** 点国家下拉: 先点开显示框, 再点对应 dd(必须真鼠标事件) */
    pickCountry: (doc, pane, cc) => {
      const sel = pane.querySelector('select#country');
      if (!sel) return { ok: false, note: '找不到国家下拉' };
      const box = sel.closest('.layui-form-select') || sel.nextElementSibling;
      const disp = box && box.querySelector && box.querySelector('.layui-select-title input');
      if (disp) clickReal(disp);
      const dd = box && [...box.querySelectorAll('dd')].find((x) => x.getAttribute('lay-value') === cc);
      if (dd) clickReal(dd);
      if (sel.value !== cc) {                                  // 兜底: 直接设值 + 同步显示层
        const hit = [...sel.options].find((o) => String(o.value) === cc);
        if (!hit) return { ok: false, note: '国家下拉里没有 ' + cc, opts: [...sel.options].map((o) => o.text).slice(0, 12) };
        sel.value = cc;
        sel.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
        syncLayuiSelect(sel);
      }
      return { ok: sel.value === cc, value: sel.value, shown: MV.shownText(sel) };
    },
    shownText: (sel) => {
      const b = sel && (sel.closest('.layui-form-select') || sel.nextElementSibling);
      const i = b && b.querySelector && b.querySelector('.layui-select-title input');
      return i ? i.value : null;
    },
    /** 勾选变体: 传 asins 就只勾那几个, 否则全勾 */
    checkVariants: (doc, pane, asins) => {
      const rows = MV.rows(pane);
      const want = (asins || []).map((x) => String(x).toUpperCase());
      let n = 0, hit = [];
      rows.forEach((tr) => {
        const asin = String(((tr.querySelector('td:nth-child(2)') || {}).textContent || '').trim().split(/\s+/)[0] || '').toUpperCase();
        if (want.length && want.indexOf(asin) < 0) return;
        const input = tr.querySelector('input[name=layTableCheckbox]');
        const styled = tr.querySelector('.layui-form-checkbox');
        if (styled) clickReal(styled); else if (input) input.click();
        if (input && input.checked) { n++; hit.push(asin) }
      });
      return { checked: n, asins: hit, rows: rows.length };
    },

    /* ══════════ ★ 2026-10-03 分页支持(修「变体多了就漏」的 bug) ══════════
     * 为什么必须做: 实测 amazon.de/dp/B0B2QG6T1Z 查询返回【共 28 条】, 但结果表默认每页 10 条
     *   → 上面那个 checkVariants 只遍历【当前页可见的行】, 第 2 页起的变体一个都勾不到,
     *     而且它不报错、照常"成功" → 静默漏上架。实测 A组(现状) 只勾到 1/3, 漏 2 个。
     *
     * ifast 侧的机制(读 item_add.js 确认, 不是猜的):
     *   · 勾选事件: table.on('checkbox(asinSearchTable)') → 只处理 obj.checked===true,
     *     然后 table.checkStatus(id).data 拿【全量已勾】(layui 的勾选状态是全局的, 不分页)
     *     → 把还没进「待提交表」的补进去。所以「第1页勾的不会因为跳页被取消」。
     *   · 取消勾选【不会】把行移出待提交表(handler 直接 return) → 只有 .asinDelete 单行删
     *     和 #clearExistAsinBtn 清全部能移出。★ 所以我们【绝不能】点到名单外的行。
     *   · 提交时 createProductFormData() 读的是【整个】$('#asinFormTable > tbody > tr')
     *     → 待提交表里有什么就提交什么, 与当前停在第几页无关。
     *   · 分页上限: page:{limit:10, limits:[10,20,50]} —— 最多只有 50, 没有"全部"。
     */
    pagerOf: (pane) => pane.querySelector('.layui-laypage'),

    /** 分页现状。★ 页数用「共 N 条 ÷ 每页 M」算 —— 不要靠页码链接去猜:
     *   跳到不存在的页 ifast 是【静默失败】(什么都不做也不报错), 靠链接猜会算出比真实页数大的值。 */
    pageInfo: (pane) => {
      const lp = MV.pagerOf(pane);
      if (!lp) return { hasPager: false, cur: 1, total: 0, limit: 0, pages: 1 };
      const curEl = lp.querySelector('.layui-laypage-curr em:last-child');
      const cntEl = lp.querySelector('.layui-laypage-count');
      const limEl = lp.querySelector('.layui-laypage-limits select');
      const cur = parseInt((curEl && curEl.textContent) || '1', 10) || 1;
      const total = parseInt((((cntEl && cntEl.textContent) || '').match(/(\d+)/) || [])[1] || '0', 10) || 0;
      const limit = parseInt((limEl && limEl.value) || '0', 10) || 0;
      const linkMax = [cur, 1].concat([...lp.querySelectorAll('a[data-page]')]
        .map((a) => parseInt(a.getAttribute('data-page'), 10) || 0)).reduce((m, x) => Math.max(m, x), 1);
      return {
        hasPager: true, cur: cur, total: total, limit: limit,
        pages: (total && limit) ? Math.max(1, Math.ceil(total / limit)) : linkMax,
        countText: (cntEl && cntEl.textContent) ? String(cntEl.textContent).trim() : null,
      };
    },

    /** 改「每页条数」(只有 10/20/50) —— 先改 50 能让绝大多数商品一屏装下, 省掉翻页 */
    setPageSize: (doc, pane, n) => {
      const lp = MV.pagerOf(pane); if (!lp) return false;
      const sel = lp.querySelector('.layui-laypage-limits select'); if (!sel) return false;
      if (![...sel.options].some((o) => String(o.value) === String(n))) return false;
      sel.value = String(n);
      sel.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
      return true;
    },

    /** 跳页: 优先点页码链接, 退到「到第 X 页 + 确定」。
     *  ★ 返回 true 只代表"点了", 不代表翻过去了 —— 调用方必须回读 pageInfo().cur 校验。 */
    gotoPage: (doc, pane, n) => {
      const lp = MV.pagerOf(pane); if (!lp) return false;
      const a = [...lp.querySelectorAll('a[data-page]')].find((x) =>
        String(x.getAttribute('data-page')) === String(n) && !/layui-disabled/.test(x.className) && !/next|prev/.test(x.className));
      if (a) { clickReal(a); return true }
      const skip = lp.querySelector('.layui-laypage-skip');
      const inp = skip && skip.querySelector('input'), btn = skip && skip.querySelector('button');
      if (inp && btn) { inp.value = String(n); clickReal(btn); return true }
      return false;
    },

    /** ★ 待提交表里已经有的 ASIN —— 这是【唯一可信口径】: 提交时读的就是它。
     *  ASIN 在 tr[data-asin] 属性上, 不在 td 文本里(td[0] 里是个 input) —— 按 td 文本读会读到空。 */
    pendingAsins: (pane) => {
      const t = pane.querySelector('#asinFormTable');
      if (!t) return [];
      return [...t.querySelectorAll('tbody tr[data-asin]')]
        .map((tr) => String(tr.getAttribute('data-asin') || '').toUpperCase()).filter(Boolean);
    },
  };

  /** ★ 2026-10-03 把"名单里的变体"全部勾上 —— 跨页也要勾到。
   *   思路(已实测 A/B/C 三组对照):
   *     ① 先把「每页条数」改成最大 50 → 大多数商品(≤50 变体)一屏装下, 一次勾完, 不翻页
   *     ② 名单里还有没进「待提交表」的 → 逐页跳(每跳都回读 .layui-laypage-curr 校验),
   *        每页只勾名单里的行, 直到名单齐了或页数用尽
   *     ③ 判据一律用 #asinFormTable(提交时真正被读的表), 不用"当前页可见了几行"
   *   返回 { want, checked, missing, pages, pageSize, passes, notes } —— missing 非空就是没勾全,
   *   调用方【必须】据此拦下自动提交(宁可不上, 也不能少上变体)。 */
  async function checkVariantsAcrossPages(doc, pane, want, say) {
    const out = { want: want.slice(), checked: [], missing: want.slice(), pages: 1, pageSize: null, passes: 0, notes: [] };
    const MAXLIM = 50;

    // ① 每页条数改到最大
    const before = MV.pageInfo(pane);
    if (before.hasPager && before.limit && before.limit < MAXLIM) {
      if (MV.setPageSize(doc, pane, MAXLIM)) {
        out.pageSize = MAXLIM;
        say('   [多变体] ④a 每页条数 ' + before.limit + ' → ' + MAXLIM + '（少翻页）');
        await sleep2(1800);
        for (let i = 0; i < 10; i++) { await sleep2(700); if (MV.rows(pane).length) break }
      }
    }

    // ② 逐页勾。页数在改完每页条数之后重算(改 50 之后 28 个变体就只有 1 页)
    const info = MV.pageInfo(pane);
    const pages = info.pages || 1;
    out.pages = pages;
    say('   [多变体] ④b 结果共 ' + (info.total || '?') + ' 条 / 每页 ' + (info.limit || '?') + ' → ' + pages + ' 页');

    for (let pg = 1; pg <= pages; pg++) {
      // 确保真的停在第 pg 页(不校验的话: 跳到不存在的页会静默失败, 于是死循环读同一页)
      const cur = (MV.pageInfo(pane) || {}).cur;
      if (String(cur) !== String(pg)) {
        if (!MV.gotoPage(doc, pane, pg)) { out.notes.push('第 ' + pg + ' 页跳不过去(找不到页码/跳页框)'); break }
        await sleep2(1500);
        let arrived = false;
        for (let i = 0; i < 8; i++) { await sleep2(700); if (String((MV.pageInfo(pane) || {}).cur) === String(pg)) { arrived = true; break } }
        if (!arrived) {
          out.notes.push('第 ' + pg + ' 页跳页校验失败(页面停在 ' + ((MV.pageInfo(pane) || {}).cur) + ' 页), 提前停止翻页');
          break;
        }
      }
      out.passes++;
      const r = MV.checkVariants(doc, pane, out.want);   // ★ 只勾名单里的(点错的行移不出去!)
      await sleep2(1000);
      const pend = MV.pendingAsins(pane);
      const remain = out.want.filter((a) => pend.indexOf(a) < 0);
      say('   [多变体] ④c 第 ' + pg + '/' + pages + ' 页: 本页 ' + r.rows + ' 行, 新勾 ' + r.checked +
          ' → 待提交表 ' + pend.length + ' 个' + (remain.length ? ('（还差 ' + remain.join(',') + '）') : '（名单齐了）'));
      if (!remain.length) break;
    }

    const pend = MV.pendingAsins(pane);
    out.checked = pend;
    out.missing = out.want.filter((a) => pend.indexOf(a) < 0);
    /* ★ 多出来的行(不在名单里): ifast 取消勾选【不会】把行移出待提交表, 而提交读的是整张表
     *   → 有杂行就会被一起提交上去。这里显式报出来, 让上层拦下自动提交。 */
    out.extra = pend.filter((a) => out.want.indexOf(a) < 0);
    return out;
  }

  /** 多变体: 走完整条流程(只填不提交) */
  async function fillMultiForm(doc, pane, task, say) {
    const f = task.fill || {};
    const cc = SITE_COUNTRY[String(f.site || task.site || '').toLowerCase()] || String(task.site || '').toUpperCase();
    const queryAsin = f.variantParent || f.asin || task.asin;
    const out = { fields: [], readBack: null };

    say('   [多变体] ① 填要查询的 ASIN: ' + queryAsin);
    MV.setInput(doc, pane.querySelector('input[name=asin]'), queryAsin);

    say('   [多变体] ② 选国家: ' + cc);
    const cp = MV.pickCountry(doc, pane, cc);
    out.fields.push({ label: '国家', ok: cp.ok, set: cp.value + ' / 界面=' + cp.shown, note: cp.ok ? null : cp.note });
    if (!cp.ok) return out;
    await sleep2(500);

    say('   [多变体] ③ 点查询…');
    const qb = pane.querySelector('#productQuerySubmit');
    if (!qb) { out.fields.push({ label: '查询按钮', ok: false, note: '找不到 #productQuerySubmit' }); return out }
    clickReal(qb);
    let rows = [];
    for (let i = 0; i < 14; i++) { await sleep2(1200); rows = MV.rows(pane); if (rows.length) break }
    const found = rows.map((tr) => String(((tr.querySelector('td:nth-child(2)') || {}).textContent || '').trim().split(/\s+/)[0] || '').toUpperCase()).filter(Boolean);
    /* ★ 2026-10-03: found 只含【当前页】的行(默认每页 10) —— 变体多的商品这里会看着"查到 10 个",
     *   但真实总数在分页控件里。把总数一起报出来, 免得看日志的人以为只查到 10 个变体。 */
    const pInfo0 = MV.pageInfo(pane);
    const totalTxt = (pInfo0.total && pInfo0.total > found.length) ? ('（本页 ' + found.length + ' 个 · 共 ' + pInfo0.total + ' 条）') : '';
    say('   [多变体] ④ 查到 ' + found.length + ' 个变体' + totalTxt + ': ' + found.join(', '));
    out.fields.push({ label: '查询结果', ok: found.length > 0, set: (found.length ? (found.join(', ') + totalTxt) : '(空)'), note: found.length ? null : '查询没有返回变体(ASIN/国家对不对?)' });
    if (!found.length) return out;

    const want = (f.variantItems || []).map((x) => x.asin).filter(Boolean).map((x) => String(x).toUpperCase());
    /* ★ 2026-09-26 防呆: checkVariants 的判据是 `if (want.length && want.indexOf(asin) < 0) return;`
     *   —— want 为空时 length 是 0(falsy) → 一行都不跳过 → **变成全选**!
     *   名单为空是可能发生的: content.js 的 zvFamilyItems 只收 /^B0[A-Z0-9]{8}$/ 形式的 ASIN,
     *   老 ASIN(如 140 开头的书号)会被滤掉; 极端情况下整族都滤光 → 名单空 → ifast 上把
     *   查询返回的【全部】变体都勾上, 而用户只想要其中一部分 → 静默上架一堆不需要的变体。
     *   所以: 名单为空就明确拒绝, 让用户回 Amazon 页重新上传, 绝不"猜着全选"。
     */
    if (!want.length) {
      say('   [多变体] ✗ 任务里没有变体名单(variantItems 为空) —— 拒绝"全选", 请回 Amazon 商品页重新上传');
      out.fields.push({ label: '勾选变体', ok: false, note: '任务名单为空, 已拒绝全选(避免误上架整族)' });
      return out;
    }
    say('   [多变体] ④ ifast 查到 ' + found.length + ' 个变体, 任务名单 ' + want.length + ' 个(只勾名单里的)');
    /* ★ 2026-10-03 改成跨页勾选: 原来只遍历当前页 → 变体超过一页就静默漏(实测 28 个变体漏了 2/3)。
     *   现在: 先改每页 50 条, 还不够就逐页跳着勾, 判据用「待提交表」(= 提交时真正读的那张表)。 */
    const sel = await checkVariantsAcrossPages(doc, pane, want, say);
    await sleep2(800);
    say('   [多变体] ⑤ 待提交表共 ' + sel.checked.length + ' 个; 名单命中 ' + (want.length - sel.missing.length) + '/' + want.length +
        ' · 翻页 ' + sel.passes + ' 次' + (sel.pageSize ? (' · 每页改 ' + sel.pageSize) : '') +
        (sel.missing.length ? (' ❌ 漏: ' + sel.missing.join(', ')) : ' ✅'));
    sel.notes.forEach((n) => say('   [多变体] ⚠ ' + n));
    if (sel.extra.length) say('   [多变体] ⚠ 待提交表里有 ' + sel.extra.length + ' 个【不属于本次名单】的行: ' + sel.extra.join(', ') + '（会被一起提交, 请核对）');
    out.fields.push({
      label: '勾选变体',
      ok: sel.checked.length > 0 && sel.missing.length === 0,
      set: (want.length - sel.missing.length) + '/' + want.length + ' 命中 · 待提交表 ' + sel.checked.length + ' 个 · 翻页 ' + sel.passes + ' 次',
      note: sel.missing.length ? ('这些变体没勾到: ' + sel.missing.join(', ') + (sel.notes.length ? ('；' + sel.notes.join('；')) : '')) : null,
    });

    const ft = pane.querySelector('#asinFormTable');
    const items = ft ? [...ft.querySelectorAll('tbody tr')] : [];
    say('   [多变体] ⑥ 待提交表里 ' + items.length + ' 行');

    // ⑦ 公共字段
    const siteId = f.siteId || SITE_ID[String(f.site || task.site || '').toLowerCase()];
    const sellPick = f.sellingId ? { id: f.sellingId, how: '任务自带' } : sellingIdOf(f, pane.querySelector('select[name=sellingId]'));
    out.fields.push(MV.setSelect(doc, pane.querySelector('select[name=siteId]'), siteId, '站点'));
    out.fields.push(MV.setSelect(doc, pane.querySelector('select[name=sellingId]'), sellPick.id, '跟卖时间'));
    if (f.stock != null) MV.setInput(doc, pane.querySelector('input[name=stock]'), f.stock);
    if (f.leadDays != null) MV.setInput(doc, pane.querySelector('input[name=fulfillmentLatency]'), f.leadDays);
    // ★ 2026-09-26 用户要求: 不填写备注(以前会往 textarea[name=remark] 写"备货 15")
    say('   [多变体] ⑦ 站点=' + siteId + ' 跟卖时间=' + (sellPick.id || '—') + ' 库存=' + (f.stock == null ? '—' : f.stock) + ' 发货天数=' + (f.leadDays == null ? '—' : f.leadDays) + ' (备注不填)');

    // ⑧ 每个变体各自的初始价/承受价
    const byAsin = {};
    (f.variantItems || []).forEach((x) => { byAsin[String(x.asin).toUpperCase()] = x });
    let priced = 0;
    items.forEach((tr) => {
      const asin = String(((tr.querySelector('input[name=item-asin]') || {}).value) || '').toUpperCase();
      const it = byAsin[asin] || {};
      const init = (it.initPrice != null) ? it.initPrice : (it.initPriceHand != null ? it.initPriceHand : f.initPrice);
      const lower = (it.bearPrice != null) ? it.bearPrice : f.bearPrice;
      MV.setInput(doc, tr.querySelector('input[name=item-initPrice]'), init == null ? '' : init);
      MV.setInput(doc, tr.querySelector('input[name=item-lowerPrice]'), lower == null ? '' : lower);
      if (init != null || lower != null) priced++;
    });
    say('   [多变体] ⑧ 已给 ' + priced + '/' + items.length + ' 个变体填入价格');

    out.readBack = {
      mode: 'multi',
      country: MV.shownText(pane.querySelector('select#country')),
      queried: queryAsin,
      foundAsins: found,
      foundTotal: pInfo0.total || null,
      checkedAsins: sel.checked,
      checkedMissing: sel.missing,
      checkedPages: sel.passes,
      checkedPageSize: sel.pageSize,
      site: (function () { const e = pane.querySelector('select[name=siteId]'); return e ? (e.value + '=' + MV.shownText(e)) : null })(),
      selling: (function () { const e = pane.querySelector('select[name=sellingId]'); return e ? (e.value + '=' + MV.shownText(e)) : null })(),
      stock: (pane.querySelector('input[name=stock]') || {}).value || null,
      leadDays: (pane.querySelector('input[name=fulfillmentLatency]') || {}).value || null,
      items: items.map((tr) => ({
        asin: (tr.querySelector('input[name=item-asin]') || {}).value || null,
        initPrice: (tr.querySelector('input[name=item-initPrice]') || {}).value || null,
        bearPrice: (tr.querySelector('input[name=item-lowerPrice]') || {}).value || null,
      })),
      visible: !!(pane.querySelector('input[name=stock]') && pane.querySelector('input[name=stock]').offsetParent !== null),
    };
    return out;
  }

  /** 在弹窗 iframe(item_add.html) 里填表 —— 只赋值 + 读回, 不提交 */
  function fillForm(doc, task, root) {
    const R = root || doc;
    const q = (sel) => R.querySelector(sel) || doc.querySelector(sel);   // 先在目标面板找, 再退回整个文档
    const f = task.fill || {};
    const setVal = (el, v, label) => {
      if (!el) return { label: label, ok: false, note: '找不到控件' };
      const before = el.value;
      el.value = (v == null ? '' : String(v));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { label: label, ok: true, before: before, set: el.value };
    };
    const setSel = (sel, value, byText, label) => {
      if (!sel) return { label: label, ok: false, note: '找不到下拉' };
      const opt = [...sel.options];
      if (value == null || value === '') {
        return { label: label, ok: false, note: '没有可填的值(插件里没选项/认不出 ifast 选项)', opts: opt.map((o) => o.text).slice(0, 8) };
      }
      let hit = value != null ? opt.find((o) => String(o.value) === String(value)) : null;
      if (!hit && byText) hit = opt.find((o) => o.text.indexOf(byText) >= 0);
      if (!hit) return { label: label, ok: false, note: '选项里没有 ' + value + '/' + byText, opts: opt.map((o) => o.text).slice(0, 8) };
      const before = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : '';
      sel.value = hit.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      try { if (doc.defaultView && doc.defaultView.layui && doc.defaultView.layui.form) doc.defaultView.layui.form.render('select'); } catch (e) {}
      const shown = syncLayuiSelect(sel);        // ★ 关键: 让"用户看得见"的那层也跟着变
      return { label: label, ok: true, before: before, set: hit.text + ' (' + hit.value + ')', shown: shown };
    };
    const res = [];
    res.push(setVal(q('input[name=asin]'), f.asin || task.asin, 'ASIN'));
    const selSite = q('select#siteId');
    const selSell = q('select[name=sellingId]');
    const sitePick = f.siteId ? { id: f.siteId, how: '任务自带' } : siteIdOf(f.site || task.site, selSite);
    const sellPick = f.sellingId ? { id: f.sellingId, how: '任务自带' } : sellingIdOf(f, selSell);
    const rSite = setSel(selSite, sitePick.id, null, '站点'); rSite.how = sitePick.how; res.push(rSite);
    const rSell = setSel(selSell, sellPick.id, null, '跟卖时间'); rSell.how = sellPick.how; res.push(rSell);
    res.push(setVal(q('input#price'), f.initPrice, '初始价格'));
    res.push(setVal(q('input#lowerPrice'), f.bearPrice, '承受价'));
    if (f.stock != null) res.push(setVal(q('input#stock'), f.stock, '库存'));
    /* ★ 2026-09-26 补: 单个添加这条路径原来【没有】填备货周期(发货天数) ——
     *   采集器的上传弹窗里「库存填写」和「备货周期」是分开两格, 用户填了却传不到 ifast,
     *   页面上一直是默认的 2 天(实测干跑时抓到)。多变体那条本来就填了, 这里补齐。 */
    if (f.leadDays != null) res.push(setVal(q('input[name=fulfillmentLatency]'), f.leadDays, '备货周期'));
    // ★ 2026-09-26 用户要求: 不填写备注(单个添加这条路径原来也会写 textarea[name=remark])
    // 读回(以页面实际值为准)
    const readBack = {
      asin: (q('input[name=asin]') || {}).value || null,
      site: (function () { const s = q('select#siteId'); return s && s.options[s.selectedIndex] ? (s.value + '=' + s.options[s.selectedIndex].text) : null })(),
      selling: (function () { const s = q('select[name=sellingId]'); return s && s.options[s.selectedIndex] ? (s.value + '=' + s.options[s.selectedIndex].text) : null })(),
      // ★ 界面上真正显示的文字(layui 套壳那层) —— 以前只验底层 select, 结果界面是空的也判"成功"
      siteShown: (function () { const s = q('select#siteId'); const b = s && (s.closest('.layui-form-select') || s.nextElementSibling); const i = b && b.querySelector && b.querySelector('.layui-select-title input'); return i ? i.value : null })(),
      sellingShown: (function () { const s = q('select[name=sellingId]'); const b = s && (s.closest('.layui-form-select') || s.nextElementSibling); const i = b && b.querySelector && b.querySelector('.layui-select-title input'); return i ? i.value : null })(),
      price: (q('input#price') || {}).value || null,
      lowerPrice: (q('input#lowerPrice') || {}).value || null,
      stock: (q('input#stock') || {}).value || null,
      remark: (q('textarea[name=remark]') || {}).value || null,
      // ★ 关键: 这些值"用户看不看得见"(以前填到了隐藏 Tab, 底层有值但界面空白)
      visible: (function () { const a = q('input[name=asin]'); return !!a && a.offsetParent !== null })(),
    };
    return { fields: res, readBack: readBack };
  }
  /* ══════════════ ★ 2026-10-03 API 直连(效率优化) ══════════════
   * 动机: 走 DOM 全流程 ≈ 12s/条(开弹窗 2.5s → 切 Tab 1.2s → 查询 → 翻页 → 逐个点勾 → 逐格填 → 点保存等响应),
   *   而且每一步都有 DOM 竞态。直连 API 只要 2 个请求, 没有点击、没有翻页、没有等待。
   *
   * 接口(真机抓包 + 用「$.ajax 桩捕获即丢弃」逐字段核对过, 与站点表单提交一致):
   *   查变体  POST /amazon/tool/asin_search.json  form-urlencoded: asin, country
   *           → {code:0, data:[{asin,summaries,images,productTypes,attributes,…}]}
   *           ★ 一次返回【全部】变体(实测 28 个 325KB), 没有分页 —— 翻页问题从根上消失
   *   多变体  POST /amazon/selling/item/product_add.json  application/json:
   *           {siteId,sellingId,stock,fulfillmentLatency,remark,
   *            items:[{asin,sku,initPrice,lowerPrice,title,brand,image,type}]}
   *   单个    POST /amazon/selling/item/item_add.json     form-urlencoded:
   *           {id:'',asin,sku,siteId,sellingId,stock,fulfillmentLatency,price,lowerPrice,remark:''}
   *   选项    GET  /amazon/site/enable                   → {data:[{country,id,name,…}]}
   *           GET  /amazon/selling//user/selling.json     → {data:[{id,name,onSaleDesc,offSaleDesc,…}]}
   *   返回    code===0 成功(data=添加条数) | code===403 登录超时 | 其它 code → msg
   *   ★ 两个提交接口都【不发 onOff】—— 站点未勾「立即在售」时本来就不发, 保持一致。
   *
   * ★★ 回退纪律(防重复上架): 只有【提交请求还没发出去】的失败才允许回退 DOM 流程。
   *     一旦 POST 发出, 无论返回什么(超时/非0/看不懂)都【不回退】, 只如实报告 ——
   *     否则同一批变体可能提交两次, 生成两个 listing。
   */
  const FORM_DEF = { stock: '10', lead: '2' };   // item_add.html 里 stock / fulfillmentLatency 的默认 value
  /* ══════════ ★ 2026-10-24 局域网共享端口 (用户要求) ══════════
   * 「上架器加端口创建按钮和端口填空框 —— 创建后其他内网设备通过该端口实现数据传输;
   *   每个端口可以停止使用; 删除端口后端口彻底关闭, 防止端口进程过多导致拥堵。」
   * 真正监听由 ERP 做(复用同一个请求处理器), 这里只负责建/停/启/删 + 显示访问地址。
   */
  const ZV_PORT_MAX_HINT = 8;
  function zvPortsApi(payload) {
    return chrome.runtime.sendMessage({ type: 'PORTS', payload: payload }).then((r) => {
      if (!r || !r.ok) throw new Error((r && (r.error || (r.result && r.result.error))) || '端口操作失败');
      return r.result || {};
    });
  }
  function zvPortsHide() {
    try { const m = document.getElementById('zyv-ports-mask'); if (m) m.remove(); } catch (e) {}
  }
  function zvPortsRowsHtml(d) {
    const list = (d.ports || []);
    const ip = (d.ips || [])[0] || '127.0.0.1';
    if (!list.length) return '<div class="zv2-sub" style="padding:6px 0">暂无端口</div>';
    return list.map((p) => {
      const running = p.running === true;
      const url = p.url || ('http://' + ip + ':' + p.port);
      return '<div class="zv2-row">'
        + '<span class="zv2-mono" style="font-size:13px;min-width:50px">' + p.port + '</span>'
        + '<span class="zv2-dot" style="background:' + (running ? '#5aa877' : '#4a4f57') + '"></span>'
        + '<span class="zv2-sub" style="min-width:52px">' + (running ? '运行中' : '已停止') + '</span>'
        + '<span class="zv2-mono zv2-sub" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + url + '">' + (running ? url : '-') + '</span>'
        + (running ? '<button class="zv2-btn zv2-btn--sm zv2-btn--quiet" data-port-copy="' + url + '">复制</button>' : '')
        + (running ? '<button class="zv2-btn zv2-btn--sm" data-port-act="stop" data-port="' + p.port + '">停止</button>'
          : '<button class="zv2-btn zv2-btn--sm" data-port-act="start" data-port="' + p.port + '">启用</button>')
        + '<button class="zv2-btn zv2-btn--sm zv2-btn--danger" data-port-act="delete" data-port="' + p.port + '">删除</button>'
        + '</div>';
    }).join('');
  }

  async function zvPortsRefresh(mask, preData) {
    const box = mask.querySelector('#zyv-ports-list');
    const tip = mask.querySelector('#zyv-ports-tip');
    if (!box) return;
    try {
      /* ★ 2026-10-24: 允许外部直接传入数据(创建端口后就用创建接口返回的 ports 立刻重绘,
       *   不再多跑一次 list —— 实测那次 list 偶尔拿到空列表, 会让人以为"没建成") */
      const d = preData || await zvPortsApi({ action: 'list' });
      box.innerHTML = zvPortsRowsHtml(d);
      try { zvPortsPaintCurrent(mask, d.ports || [], d.ips || []); } catch (e) {}
      const ips = (d.ips || []);
      if (tip) tip.textContent = '本机内网 IP: ' + (ips.length ? ips.join(' / ') : '(没有网卡?)')
        + ' · 已建 ' + (d.ports || []).length + '/' + (d.max || ZV_PORT_MAX_HINT) + ' 个'
        + ' · ERP 主端口 ' + (d.base || 3088);
      /* 行内按钮 */
      box.querySelectorAll('button[data-port-copy]').forEach((b) => {
        b.onclick = () => {
          const u = b.getAttribute('data-port-copy') || '';
          copy(u, '端口地址');
        };
      });
      box.querySelectorAll('button[data-port-act]').forEach((b) => {
        b.onclick = async () => {
          const act = b.getAttribute('data-port-act');
          const port = Number(b.getAttribute('data-port'));
          if (act === 'delete' && !confirm('彻底关闭并删除端口 ' + port + ' ?\n\n删除后其他设备就连不上这个端口了(端口记录也不再恢复)。')) return;
          b.disabled = true;
          try {
            await zvPortsApi({ action: act, port: port });
            await zvPortsRefresh(mask);
            setMsg(act === 'delete' ? ('🔌 端口 ' + port + ' 已删除并彻底关闭') : (act === 'stop' ? ('🔌 端口 ' + port + ' 已停止') : ('🔌 端口 ' + port + ' 已启用')), true, 8000);
          } catch (e) {
            b.disabled = false;
            setMsg('✗ 端口操作失败: ' + zvHumanErr(e), false);
            await zvPortsRefresh(mask);
          }
        };
      });
    } catch (e) {
      box.innerHTML = '<div style="font-size:12px;color:#ff9a9a">✗ ' + String(zvHumanErr(e)) + '</div>';
    }
  }
  /* ★ 2026-10-24 用户要求: 端口弹窗里要能看到端口数据 + 复制按钮, 还要能「输入端口→点连接」 */
  function zvPeerApi(payload) {
    return chrome.runtime.sendMessage({ type: 'PEERS', payload: payload }).then((r) => {
      if (!r || !r.ok) throw new Error((r && (r.error || (r.result && r.result.error))) || '连接操作失败');
      return r.result || {};
    });
  }
  function zvPortsPaintCurrent(mask, ports, ips) {
    const box = mask.querySelector('#zyv-port-current');
    if (!box) return;
    const cur = (ports || [])[0] || null;
    if (!cur) { box.innerHTML = '<div class="zv2-sub">暂无端口</div>'; return }
    const url = cur.url || ('http://' + ((ips || [])[0] || '127.0.0.1') + ':' + cur.port);
    box.innerHTML = '<div style="display:flex;align-items:baseline;gap:10px">'
      + '<span class="zv2-mono" style="font-size:24px;font-weight:600;letter-spacing:.5px">' + cur.port + '</span>'
      + '<span class="zv2-dot" style="background:' + (cur.running ? '#5aa877' : '#4a4f57') + '"></span>'
      + '<span class="zv2-sub">' + (cur.running ? '运行中' : '已停止') + '</span></div>'
      + '<div class="zv2-mono" style="margin-top:8px;font-size:12.5px;color:#b9c6d6;word-break:break-all">' + url + '</div>'
      + '<div style="margin-top:10px;display:flex;gap:9px;align-items:center">'
      + '<button class="zv2-btn zv2-btn--primary zv2-btn--sm" data-copy-cur="1">复制地址</button>'
      + '<span class="zv2-sub">粘贴到其他设备的「设置 → ERP 地址」</span></div>';
    const b = box.querySelector('button[data-copy-cur]');
    if (b) b.onclick = () => { copy(url, '端口地址'); setMsg('已复制端口地址', true, 12000); };
  }
  function zvPeerPaint(mask, d) {
    const box = mask.querySelector('#zyv-peer-list');
    if (!box) return;
    const peers = (d && d.peers) || [];
    if (!peers.length) { box.innerHTML = '<div class="zv2-sub">尚未连接其他设备</div>'; return }
    box.innerHTML = peers.map((p) => '<div class="zv2-row">'
      + '<span class="zv2-dot" style="background:' + (p.online ? '#5aa877' : '#4a4f57') + '"></span>'
      + '<span class="zv2-sub" style="min-width:48px">' + (p.online ? '在线' : '离线') + '</span>'
      + '<span style="font-size:12.5px;min-width:84px;color:#e7eaf0">' + p.name + '</span>'
      + '<span class="zv2-sub" style="flex:1">凭证 ' + (p.claims || 0) + ' · 商品 ' + (p.items || 0) + (p.lastSyncAt ? (' · ' + String(p.lastSyncAt).slice(5, 16)) : '') + '</span>'
      + '<button class="zv2-btn zv2-btn--sm" data-peer-act="sync" data-peer-id="' + p.id + '">同步</button>'
      + '<button class="zv2-btn zv2-btn--sm zv2-btn--danger" data-peer-act="delete" data-peer-id="' + p.id + '" data-peer-name="' + p.name + '">断开</button>'
      + '</div>').join('');
    box.querySelectorAll('button[data-peer-act]').forEach((b2) => {
      b2.onclick = async () => {
        const act = b2.getAttribute('data-peer-act'), id = b2.getAttribute('data-peer-id');
        if (act === 'delete' && !confirm('断开「' + b2.getAttribute('data-peer-name') + '」?\n断开后本机就看不到对方的数据了。')) return;
        b2.disabled = true;
        try {
          const r = await zvPeerApi({ action: act === 'delete' ? 'delete' : 'sync', id: id });
          if (act === 'delete') setMsg('已断开设备', true, 10000);
          else setMsg('已同步: 拉回凭证 ' + ((r.pulled || {}).claims || 0) + ' / 商品 ' + ((r.pulled || {}).items || 0), true, 12000);
          await zvPeerRefresh(mask);
        } catch (e) { setMsg('同步失败: ' + zvHumanErr(e), false) } finally { b2.disabled = false }
      };
    });
  }
  async function zvPeerRefresh(mask) {
    try {
      const d = await zvPeerApi({ action: 'list' });
      zvPeerPaint(mask, d);
      const tip = mask.querySelector('#zyv-peer-tip');
      if (tip) tip.textContent = '已连接 ' + ((d.peers || []).length) + ' 台 · 合并后凭证 ' + (d.claimsMerged || 0) + ' 条 / 商品 ' + (d.itemsMerged || 0) + ' 条';
    } catch (e) {
      const box = mask.querySelector('#zyv-peer-list');
      if (box) box.innerHTML = '<span style="color:#ff9a9a;font-size:11.5px">✗ ' + zvHumanErr(e) + '</span>';
    }
  }
  /** 输入端口号 / IP:端口 / 完整地址 → 连接 */
  async function zvPeerConnectByInput(mask) {
    const inp = mask.querySelector('#zyv-peer-input');
    let v = String((inp && inp.value) || '').trim();
    if (!v) { setMsg('✗ 先填对方的端口(或完整地址)', false); if (inp) inp.focus(); return }
    let url = v;
    if (/^\d+$/.test(v)) {
      /* 只给了端口号: 用本机内网 IP 拼(若对方就是本机, 后端会提示"不用连自己") */
      let ip = '127.0.0.1';
      try {
        const d = await zvPortsApi({ action: 'list' });
        ip = ((d.ips || [])[0]) || '127.0.0.1';
        /* 若这个端口就是本机的, 直接带上本机口令 */
        const hit = (d.ports || []).find((x) => Number(x.port) === Number(v));
        if (hit && hit.url) url = hit.url;
        else url = 'http://' + ip + ':' + v;
      } catch (e) { url = 'http://' + ip + ':' + v }
    } else if (!/^https?:\/\//i.test(url)) {
      url = 'http://' + url;
    }
    zvMsgUnlock();
    const btn = mask.querySelector('#zyv-peer-connect');
    if (btn) { btn.disabled = true; btn.textContent = '连接中…' }
    setMsg('⏳ 正在连接 ' + url + ' …', true, 20000);
    try {
      const r = await zvPeerApi({ action: 'connect', url: url });
      const sy = (r.sync || {});
      setMsgLock('✓ 已连上「' + ((r.peer || {}).name || '') + '」 · 拉回凭证 ' + ((sy.pulled || {}).claims || 0)
        + ' / 商品 ' + ((sy.pulled || {}).items || 0) + ' · 推给对方凭证 ' + ((sy.pushed || {}).claims || 0)
        + ' / 商品 ' + ((sy.pushed || {}).items || 0), true, 30000);
      if (inp) inp.value = '';
      await zvPeerRefresh(mask);
    } catch (e) {
      setMsgLock('× 连接失败: ' + zvHumanErr(e), false, 15000);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '🔗 连接' }
    }
  }

  function zvPortsOpen() {
    zvPortsHide();
    const mask = document.createElement('div');
    mask.id = 'zyv-ports-mask';
    mask.setAttribute('style', 'position:fixed;left:0;top:0;right:0;bottom:0;background:rgba(0,0,0,.6);z-index:2147483002;display:flex;align-items:center;justify-content:center');
    mask.innerHTML =
      '<div class="zv2-card" style="width:560px;max-width:94vw;max-height:88vh;overflow:auto">'
      + '<div class="zv2-title" style="margin-bottom:4px">局域网共享端口</div>'
      + '<div class="zv2-sub" style="margin-bottom:12px">建立端口供其他设备接入；每次创建会自动分配空闲端口并关闭旧端口。'
      + '若对方已开端口，也可在此直接连接，把对方数据同步过来。</div>'

      + '<div class="zv2-sec">'
      + '<div class="zv2-sec-h"><span class="zv2-sec-bar"></span><span class="zv2-sec-t">本机端口</span>'
      + '<span id="zyv-ports-tip" class="zv2-sub" style="margin-left:auto"></span></div>'
      + '<div style="display:flex;gap:9px;align-items:flex-end">'
      + '<div><div class="zv2-label">端口号（留空自动分配）</div>'
      + '<input id="zyv-port-input" class="zv2-input" inputmode="numeric" placeholder="自动" style="width:110px"></div>'
      + '<button id="zyv-port-create" class="zv2-btn zv2-btn--primary">创建端口</button>'
      + '</div>'
      + '<div id="zyv-port-current" style="margin-top:12px;padding-top:12px;border-top:1px solid #1e2228"></div>'
      + '<div id="zyv-ports-list" style="max-height:140px;overflow:auto;margin-top:6px"></div>'
      + '</div>'

      + '<div class="zv2-sec">'
      + '<div class="zv2-sec-h"><span class="zv2-sec-bar" style="background:#5aa877"></span><span class="zv2-sec-t">连接其他设备</span>'
      + '<span id="zyv-peer-tip" class="zv2-sub" style="margin-left:auto"></span></div>'
      + '<div style="display:flex;gap:9px;align-items:flex-end">'
      + '<div><div class="zv2-label">对方端口 / IP:端口 / 完整地址</div>'
      + '<input id="zyv-peer-input" class="zv2-input" placeholder="3090 或 192.168.86.13:3090" style="width:240px"></div>'
      + '<button id="zyv-peer-connect" class="zv2-btn">连接</button>'
      + '</div>'
      + '<div id="zyv-peer-list" style="max-height:130px;overflow:auto;margin-top:6px"></div>'
      + '</div>'

      + '<div class="zv2-sub" style="margin-bottom:10px">连不上时请放行防火墙入站端口；对方端口若设了口令，请填入完整地址 '
      + '<span class="zv2-mono" style="color:#9fb0c5">http://IP:端口/zy/口令</span>。</div>'
      + '<div style="display:flex;justify-content:flex-end"><button class="zv2-btn zv2-btn--quiet" id="zyv-ports-close">关闭</button></div>'
      + '</div>';
    document.body.appendChild(mask);
    const close = mask.querySelector('#zyv-ports-close');
    if (close) close.onclick = zvPortsHide;
    mask.addEventListener('click', (e) => { if (e.target === mask) zvPortsHide() });
    const inp = mask.querySelector('#zyv-port-input');
    const doCreate = async () => {
      const v = String((inp && inp.value) || '').trim();
      const payload = { action: 'create' };
      if (v) {
        const port = Number(v);
        if (!Number.isInteger(port) || port < 1024 || port > 65535) { setMsg('✗ 端口号要么留空(自动), 要么填 1024~65535 的整数', false); if (inp) inp.focus(); return }
        payload.port = port;
      }
      zvMsgUnlock();
      const btn = mask.querySelector('#zyv-port-create');
      if (btn) { btn.disabled = true; btn.textContent = '创建中…' }
      try {
        const r = await zvPortsApi(payload);
        const port = r.port;
        const ip = ((r.ips || [])[0]) || '127.0.0.1';
        const full = r.url || ('http://' + ip + ':' + port);
        const oldClosed = (r.closedOld || []);
        /* ★ 2026-10-24 修【创建成功但界面不更新】: 先重绘, 再做提示/复制/日志等"装饰性"动作 ——
         *   原来重绘排在 say() 之后, say 一旦抛错就整段跳过(又被 setMsgLock 挡住报错), 表现就是"点了没反应"。 */
        try { await zvPortsRefresh(mask, { ports: r.ports || [], ips: r.ips || [], max: (r.max || ZV_PORT_MAX_HINT), base: (r.base || 3088) }); } catch (e) { }
        try { zvPortsPaintCurrent(mask, r.ports || [], r.ips || []); } catch (e) { }
        try {
          setMsgLock('🔌 新端口 ' + port + (r.autoChosen ? '(自动分配)' : '') + ' 已开启'
            + (oldClosed.length ? (' · 已自动关闭旧端口 ' + oldClosed.join(',')) : '')
            + ' —— 其他设备的「ERP 地址」请填: ' + full, true, 40000);
        } catch (e) { }
        try { copy(full, '新端口地址'); } catch (e) { }
        try { say('   新地址已复制到剪贴板: ' + full); } catch (e) { }
        if (inp) inp.value = '';
        /* 兜底: 900ms 后再拉一次真实清单(以防创建接口返回的列表是旧的) */
        setTimeout(function () { try { zvPortsRefresh(mask).catch(function () { }); } catch (e) { } }, 900);
      } catch (e) {
        setMsgLock('× 建端口失败: ' + zvHumanErr(e), false, 15000);
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = '⚡ 创建新端口' }
      }
    };
    const cbtn = mask.querySelector('#zyv-port-create');
    if (cbtn) cbtn.onclick = doCreate;
    if (inp) inp.onkeydown = (e) => { if (e.key === 'Enter') doCreate() };
    /* ★ 连接其他设备 */
    const cbtn2 = mask.querySelector('#zyv-peer-connect');
    if (cbtn2) cbtn2.onclick = () => { zvPeerConnectByInput(mask); };
    const pinp = mask.querySelector('#zyv-peer-input');
    if (pinp) pinp.onkeydown = (e) => { if (e.key === 'Enter') zvPeerConnectByInput(mask) };
    zvPeerRefresh(mask);
    zvPortsRefresh(mask);
  }

  /* ══════════ ★ 2026-10-24 同步店铺商品 (用户要求) ══════════
   * 登录 ifast 后点一下, 把整个账号下的商品全拉下来推进 ERP:
   *   跟卖组 /amazon/selling//user/selling.json  → 站点 /amazon/site/enable
   *   → 商品 /amazon/selling/item/item_list.json 分页(limit=100, 实测 count=2218 / 23 页)
   * 每 200 条推一次(推给 background 再转 127.0.0.1:3088, 绕开页面 CORS), 最后 final:true 出概要。
   */
  let zvSyncBusy = false;
  async function zvIfastGet(path) {
    try {
      const res = await fetch(path, { credentials: 'include', headers: IFAPI.XRW });
      const j = await res.json();
      /* ★ 注意: item_list.json 返回的 code 是 ""(空串) 而不是 0, 不能只按 code===0 判成功 */
      const okLike = !!(j && (j.code === 0 || j.code === '' || j.code == null));
      return { ok: okLike && !!(j && (j.data || j.count != null)), code: j && j.code, msg: j && j.msg, count: j && j.count, data: (j && j.data) || [] };
    } catch (e) { return { ok: false, err: String((e && e.message) || e), data: [] } }
  }
  async function zvSyncIfastGoods() {
    if (zvSyncBusy) { setMsg('· 同步正在跑, 等它结束就好', false); return { ok: false, why: 'busy' } }
    zvSyncBusy = true;
    try {
      /* ★ 默认走 ERP 直连 ifast 数据源（逆向客户端 + 本机 cookie）：1 次请求取全量。
       *   失败时先刷新一次登录态(cookie)再重试；仍失败才提示用户去 ifast 登录。 */
      const t0 = Date.now();
      setMsgLock('⏳ 同步: ERP 直连 ifast 数据源…', true, 30000);
      let res = null, err = null;
      try {
        const dr = await chrome.runtime.sendMessage({ type: 'IFAST_SYNC_PUSH', payload: {} });
        res = (dr && dr.ok && dr.result) || null;
        if (!res || res.ok === false) err = (dr && dr.error) || (res && res.error) || '无数据';
      } catch (e) { err = zvHumanErr(e); }
      if (!res || res.ok === false || !res.total) {
        setMsgLock('⏳ 直连失败，尝试刷新 ifast 登录态…', true, 20000);
        try { await chrome.runtime.sendMessage({ type: 'IFAST_COOKIE_REFRESH' }); } catch (e) {}
        try {
          const dr2 = await chrome.runtime.sendMessage({ type: 'IFAST_SYNC_PUSH', payload: {} });
          res = (dr2 && dr2.ok && dr2.result) || null;
        } catch (e) { err = zvHumanErr(e); }
      }
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      if (res && res.ok !== false && res.total) {
        /* 先刷新列表/计数，再写最终提示（否则会被 refresh 的「已从 ERP 读到 N 条」冲掉） */
        try { await refresh(); } catch (e) {}
        setMsgLock('✔ 同步完成(ERP 直连): ' + res.total + ' 条在架 · 归档 ' + (res.archived || 0)
          + ' 条 · 台账 ' + (res.claimsWrote || 0) + ' 条 · 耗时 ' + secs + 's', true, 60000);
        return { ok: true, direct: true, total: res.total, archived: res.archived, claims: res.claimsWrote };
      }
      setMsgLock('✗ 同步失败(ERP 直连): ' + (err || '无数据') + ' —— 请在 ifast 页面登录一次后重试', false, 60000);
      return { ok: false, why: err };
    } finally { zvSyncBusy = false }
  }
  const IFAPI = {
    _opt: null,
    /* ★★ 2026-10-07 找到并修复【HTTP 200 且不是 JSON】的真正原因(用户报障连续踩坑):
     *   ifast 的前端用 jQuery $.ajax 调这些接口, 而 jQuery 会自动带上请求头
     *   `X-Requested-With: XMLHttpRequest`; 服务端(Shiro/Spring)按"是不是 AJAX 请求"分流:
     *     · 不带该头的 POST → 被当成【页面请求】→ 返回 **404 错误页(HTTP 200 + text/html)**
     *       → 我们看到的就是 `HTTP 200 且不是 JSON（多半是登录页/被拦）`, 于是误判成登录/被拦;
     *     · 带上该头     → 正常返回 JSON。
     *   实测对照(空 body 探测, 不会建出任何记录):
     *     不带 → `<!DOCTYPE html>…<h1>404</h1>…啊哦，你访问的页面不存在`
     *     带上 → `{"code":500,"msg":"错误的站点"}`  ← 接口正常应答
     *   所以: **所有对 ifast 的请求都必须带这个头**, 与真实前端保持一致。 */
    XRW: { 'X-Requested-With': 'XMLHttpRequest' },
    async post(url, body, isJson) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          credentials: 'include',
          headers: Object.assign({
            'Content-Type': isJson ? 'application/json' : 'application/x-www-form-urlencoded;charset=UTF-8',
          }, IFAPI.XRW),
          body: isJson ? JSON.stringify(body) : new URLSearchParams(body).toString(),
        });
        const txt = await res.text();
        let j = null; try { j = JSON.parse(txt) } catch (e) {}
        if (!j) {
          const is404 = /页面不存在|error-page/i.test(txt);
          return {
            ok: false, code: null,
            err: 'HTTP ' + res.status + ' 且不是 JSON'
              + (is404 ? '（服务端把它当成"页面请求"了 —— 通常是没有带 X-Requested-With 头; 已在新版本里带上, 若仍出现请反馈）'
                : '（多半是登录页/被拦）') + ': ' + String(txt).replace(/\s+/g, ' ').slice(0, 120),
          };
        }
        return { ok: j.code === 0, code: j.code, msg: j.msg || null, data: j.data };
      } catch (e) { return { ok: false, code: null, err: String((e && e.message) || e) } }
    },
    async get(url) {
      try {
        const res = await fetch(url, { credentials: 'include', headers: IFAPI.XRW });
        const j = await res.json();
        return { ok: j.code === 0, code: j.code, msg: j.msg || null, data: j.data };
      } catch (e) { return { ok: false, err: String((e && e.message) || e) } }
    },
    /** ★ 2026-10-07 新增: 回读 ifast 侧"这个 ASIN 在本账号下到底有没有、什么时候建的、谁建的"。
     *   为什么必须回读: **ifast 对【已存在】的商品提交 item_add 同样返回 code:0(空操作)**。
     *   实测(用户报障): B0GYF76ZJX 我们 2026-10-07 13:15 提交返回成功(625ms, data=true),
     *     但 ifast 那一行的 createTime = 2026-09-24 12:53:54、createUserName = "xiaotang"
     *     —— 这个品 9 月 24 日就被别人上过了, 我们那次提交【没有新增任何东西】,
     *     而我们的记录却写成"13:15 上架成功", 于是用户第二次上传被拦时看到的是
     *     "已在 2026-10-07 13:15 上架过" —— 与事实不符(用户: "我没上过这个品!")。
     *   结论: 提交成功【不等于】我们创建了它, 必须回读列表确认。 */
    /* ★★ 2026-10-07 修【站点串味】(实测抓到的真隐患):
     *   `item_list.json?asin=X` **会把这个 ASIN 在所有站点的行都返回**(实测 B0GZN85FRQ 一次返回
     *   IT/69185/id53755209 与 ES/69184/id53754614 两行), 而老代码取的是 `data[0]` ——
     *   于是: ① 往 ES 传的品可能因为【IT 那条】被判成"已存在" → **拦掉本该成功的新增**;
     *         ② 自动更新时会把【另一个站点的记录 id】发出去 → 有可能改错那一条。
     *   现在: 必须按站点收窄 —— 传了 siteId 就交给服务端收窄(实测有效), 同时再按 country 兜一层。 */
    async listingOf(asin, site) {
      const a = String(asin || '').toUpperCase().trim();
      if (!/^[A-Z0-9]{10}$/.test(a)) return null;
      const s = String(site || '').toLowerCase().trim();
      const want = s ? (SITE_COUNTRY[s] || s.toUpperCase()) : null;
      /* ★ 只信【实时站点表】。为什么不退回内置旧表(SITE_ID): 实测旧 id 已过期 ——
       *   旧表 uk=69131, 而账号真实是 69181(GB); 用 69131 查 ifast 会**返回 0 行**(不是报错!),
       *   于是"存在性判定"会得出"不存在"的结论 → 又去走注定失败的新增(或反过来误报)。
       *   实时表拿不到时**宁可不带 siteId**: 那时接口会返回该 ASIN 在所有站点的行, 我们再按 country 过滤,
       *   语义依然正确(多花不了多少, limit=50 足够)。 */
      let sid = null;
      if (s) {
        try {
          const opt = await IFAPI.options();
          const cc = SITE_COUNTRY[s] || s.toUpperCase();
          const live = (opt.sites || []).find((x) => new RegExp('【\\s*' + cc + '\\s*】', 'i').test(String(x.text || '')));
          if (live && live.value) sid = live.value;
        } catch (e) { sid = null }
      }
      try {
        const r = await fetch('/amazon/selling/item/item_list.json?page=1&limit=50&asin=' + encodeURIComponent(a)
          + (sid ? ('&siteId=' + encodeURIComponent(sid)) : ''), { credentials: 'include', headers: IFAPI.XRW });
        const j = await r.json();
        const rows = (j && j.data) || [];
        /* 站点过滤: 有 siteId 时服务端已收窄(row 应唯一); 没拿到 siteId 时按 country 兜底。
         * ★ 绝不能退回 rows[0] —— 那正是"串味"的来源。 */
        const row = want ? (rows.find((x) => String(x.country || '').toUpperCase() === want) || null) : (rows[0] || null);
        if (!row) {
          return { exists: false, at: new Date().toISOString(), site: s || null, rowsAll: rows.length,
            otherSites: rows.map((x) => x.country).filter(Boolean) };
        }
        return {
          exists: true, at: new Date().toISOString(), site: s || null,
          id: row.id, sku: row.sku, siteId: row.siteId, country: row.country, sellingId: row.sellingId,
          /* ★ 更新是【整表单覆盖式】的 → 我们要能回填"不打算改"的字段, 所以这里必须把这些也读出来 */
          remark: row.remark == null ? '' : row.remark,
          price: row.price, initPrice: row.initPrice, lowerPrice: row.lowerPrice,
          stock: row.stock, fulfillmentLatency: row.fulfillmentLatency, onOff: row.onOff, itemStatus: row.itemStatus,
          createTime: row.createTime || null, updateTime: row.updateTime || null,
          createUserName: row.createUserName || null, createUserId: row.createUserId || null,
          rowsAll: rows.length,
        };
      } catch (e) { return { exists: null, err: String((e && e.message) || e) } }
    },
    /** ★ 2026-10-07 新增: 提交前探活 —— 判断 ifast 会话/页面是否处于"能正常应答 API"的状态。
     *   为什么需要: 实测(用户报障)有一次 POST item_add.json 收到的是 **HTTP 200 + HTML 外壳页**
     *   (`<!DOCTYPE html>...<title>IFAST业务系统</title>`) 而不是 JSON —— 那一刻请求已经发出去,
     *   但**结果无法判定**(可能成功了、也可能没被处理), 只能人工去 ifast 搜 ASIN 核对。
     *   有了探活就能在【发请求之前】发现这种状态, 直接报"未提交 + 可安全重试", 不留悬案。
     *   注意: item_list.json 的 code 是空串(不是 0), 所以不能用 IFAPI.get 的 ok 判定 —— 必须看"是不是 JSON"。 */
    async probeSession() {
      try {
        const r = await fetch('/amazon/selling/item/item_list.json?page=1&limit=1', { credentials: 'include', headers: IFAPI.XRW });
        const txt = await r.text();
        let j = null; try { j = JSON.parse(txt) } catch (e) {}
        if (!j) return { ok: false, why: 'ifast 返回的不是 JSON(HTML 外壳页/登录页) —— 会话可能已失效' };
        if (!Array.isArray(j.data)) return { ok: false, why: 'ifast 响应异常(没有 data 数组)' };
        return { ok: true, count: j.count != null ? j.count : null };
      } catch (e) { return { ok: false, why: '探活请求失败: ' + String((e && e.message) || e) } }
    },
    /** 站点 / 跟卖时间选项 —— 用接口取, 覆盖【全部已启用站点】(不再依赖硬编码的 6 个 id), 抗改版 */
    async options() {
      if (IFAPI._opt) return IFAPI._opt;
      const [s, g] = await Promise.all([IFAPI.get('/amazon/site/enable'), IFAPI.get('/amazon/selling//user/selling.json')]);
      IFAPI._opt = {
        sites: ((s && s.data) || []).map((x) => ({ value: String(x.id), text: '【' + String(x.country || '').toUpperCase() + '】' + (x.name || '') })),
        sells: ((g && g.data) || []).map((x) => ({ value: String(x.id), text: (x.name || '') + '(' + (x.onSaleDesc || '') + '--' + (x.offSaleDesc || '') + ')' })),
      };
      return IFAPI._opt;
    },
    /** 变体主图。站点用的是 images[0].images[0], 但那个数组顺序【两次请求之间会变】
     *   (实测 15 条 = MAIN/PT01..PT04 共 5 组 × 3 种尺寸 2000/500/75px, 站点有时拿到 500px 那张)。
     *   这里取 MAIN 组里分辨率最大的 → 比站点更稳定。 */
    image(row) {
      try {
        const inner = (((row || {}).images || [])[0] || {}).images || [];
        const main = inner.filter((x) => String(x.variant || '').toUpperCase() === 'MAIN');
        const pool = main.length ? main : inner;
        let best = null;
        pool.forEach((x) => {
          const a = (Number(x.width) || 0) * (Number(x.height) || 0);
          if (!best || a > best.a) best = { a: a, link: x.link };
        });
        return best ? best.link : null;
      } catch (e) { return null }
    },
  };

  /** ifast 的 createTime 是【服务器本地时间】(UTC+8), 浏览器按本地时间解析 → 可直接和 Date.now() 比。
   *  返回: 毫秒时间戳(确实早就存在) / false(是这次建的吗不确定/不早于本次提交) / null(读不到) */
  function ifastPreExisted(ifast, submitAtMs) {
    if (!ifast || !ifast.exists || !ifast.createTime) return null;
    const t = Date.parse(String(ifast.createTime).replace(/-/g, '/'));
    if (isNaN(t)) return null;
    return (t < (submitAtMs - 60000)) ? t : false;
  }

  /** 回报 ERP(与 DOM 流程同一个接口/同一个形状, 只是 fields 为空、readBack.channel='api') */
  async function apiReport(task, p) {
    try {
      const rr = await chrome.runtime.sendMessage({
        type: 'LISTING_FILL_RESULT',
        payload: {
          id: task.id, asin: task.asin,
          dryRun: !!p.dryRun, submitted: !!p.submitted, ok: !!p.ok,
          /* ★ 2026-10-07 用户要求「店铺内已上架 → 返回信息写已上架」:
           *   alreadyListed = 这次判定出"本店铺已上架该商品"; noChange = 线上与本次要写的一致, 没产生写入。
           *   必须透传给 ERP —— ERP 侧据此把结果落成【已上架】而不是"没有结果"。 */
          alreadyListed: p.alreadyListed === true ? true : undefined,
          noChange: p.noChange === true ? true : undefined,
          fields: p.fields || [], readBack: p.readBack || null, note: p.note || null,
        },
      });
      log2(rr && rr.ok ? '⑥ 已回报 ERP ✓ (' + (rr.fillStatus || '') + ')' : ('⑥ 回报 ERP 失败: ' + ((rr && rr.error) || '?')));
    } catch (e) { log2('⑥ 回报异常: ' + e.message) }
  }

  /** 当前店铺名(本机 chrome.storage 里的 currentShop) —— 给"本店铺已上架"这类文案用。
   *  拿不到就返回 null, 文案回退成「本店铺」, 绝不编造店铺名。 */
  function currentShopName() {
    return new Promise((res) => {
      try { chrome.storage.local.get(['currentShop'], (o) => res((o && o.currentShop) || null)); }
      catch (e) { res(null) }
    });
  }

  /** 用 API 直连处理一条任务。
   *   返回 { done:true }        = 已处理完(成功 / 业务性失败), 上层别再走 DOM
   *        { done:false, why }   = 【提交前】就失败, 上层可安全回退 DOM 流程 */
  async function apiTryTask(task, autoSubmit, say, opts) {
    opts = opts || {};
    const updateExisting = opts.updateExisting === true;   // ★ 走"编辑现有记录"而不是"新增"
    /* ★ 2026-10-07 调试留痕: 记录每次进入的参数与判定 —— 排查"参数没传到/走错分支"用 */
    try { window.__zyLastTry = { at: new Date().toISOString(), taskId: task && task.id, autoSubmit: !!autoSubmit, updateExisting, optsKeys: Object.keys(opts) }; } catch (e) {}
    const f = task.fill || {};
    const site = String(f.site || task.site || '').toLowerCase();
    const cc = SITE_COUNTRY[site] || site.toUpperCase();
    const want = (Array.isArray(f.variantItems) ? f.variantItems : []).filter((x) => x && x.asin);
    const isMulti = String(f.fillMode || '') === 'multi' || want.length > 1;
    const label = isMulti ? '多变体' : '单个';

    /* ★ 2026-10-07 优化: 【存在性判定提到最前面】。
     *   理由: 命中"已存在"时根本不需要站点/跟卖组选项(那两个请求要 2 个来回, 实测整条判定要 11.5 秒),
     *   提前判定 → 立刻告诉用户"未提交, 该商品已有", 不做任何无用请求。
     *   普通模式遇到"已存在"→ 直接返回; 编辑模式(opts.updateExisting)→ 继续往下走构造更新载荷。 */
    const taskAsin = isMulti
      ? (String(f.variantParent || f.asin || task.asin || '').toUpperCase())
      : String(f.asin || task.asin || '').toUpperCase();
    let existing = null;
    try { existing = await IFAPI.listingOf(taskAsin, site) } catch (e) { existing = null }
    /* ★★ 2026-10-07 用户要求「把该死上架拦截关掉」——
     *   旧行为: 发现 ifast 里已有这条 → 【不提交】, 让用户再去点面板「✎ 更新现有记录」。
     *   为什么改成自动: ① 同一件事要用户点两次, 中间还看不懂为什么被拦(用户连续报障);
     *     ② 实测依据(今天 3 次): 同账号同站点**不允许重复"添加"** —— `item_add.json` 对已存在商品
     *        必被上游拒(code=500 站点已经存在此ASIN / 或 HTML 错误页), 所以"硬提交"是**保证失败**的路,
     *        把它当"关掉拦截"只会让用户再失败一次;
     *     ③ 真正能让这次上传生效的唯一路径就是【更新那条现有记录】(item_edit, 今天已跑通: 价格真写进去了)。
     *   所以: 已存在 → **自动改走更新**(不新增记录、不打断), 只在备注里如实说明发生了什么。
     *   例外: 多变体(整族)暂不支持更新接口 → 那种情况仍然不提交, 并如实说明原因。 */
    const autoUpdate = !!(existing && existing.exists === true) && !updateExisting && !isMulti;
    let autoUpdateHint = '';                          // ★ "列表默认最近7天"这类提醒, 拼进成功备注里
    if (existing && existing.exists === true && !updateExisting && isMulti) {
      const note = '⛔ 未提交: 该商品在 ifast【已存在】(记录 id ' + (existing.id || '?') + ', 创建于 '
        + (existing.createTime || '?') + ', 操作人 ' + (existing.createUserName || '?') + ', 站点 ' + (existing.country || '?')
        + ')；本次是【多变体/整族】提交, 而 ifast 的"更新现有记录"接口目前只支持单条, 多变体更新暂未支持 —— '
        + '请改成「只上这一个变体」再传, 或到 ifast 里手工编辑那条';
      say('   [API] ⛔ ' + note);
      await apiReport(task, { dryRun: true, submitted: false, ok: false, readBack: { channel: 'api', ifast: existing }, note: note });
      setMsgLock('⛔ 未提交(多变体需要更新) · ' + task.asin + ' —— ifast 里已有这条(记录 id ' + (existing.id || '?')
        + ', ' + (existing.createTime || '?') + ' ' + (existing.createUserName || '?') + ')；当前接口不支持多变体更新', false, 90000);
      return { done: true, existsInIfast: true, recordId: existing.id || null };
    }
    /* ★★ 2026-10-07 用户要求:「给上架加上 —— 如果在店铺内已经上架了该商品, 返回信息写【已上架】」。
     *   口径: 本次会话登录的就是这个店铺的 ifast 账号, 所以在这里查到的那条记录 = **本店铺**已上架;
     *         创建人(操作人)可能是同账号下的另一个人(实测 xiaotang), 所以一并报出来 —— 用户要的就是
     *         "在哪个店铺 / 什么时候 / 谁上的"。
     *   同时: 若本次要写的内容与线上完全一致 → 【不写】(无谓的写入会覆盖上游字段, 见 A42 的 sku 事故),
     *         直接判「已上架 · 无需改动」。 */
    const shopLabel = (await currentShopName()) || '本店铺';
    let alreadyListedInfo = null;
    if (existing && existing.exists === true) {
      alreadyListedInfo = {
        shop: shopLabel, rowId: existing.id || null, createTime: existing.createTime || null,
        createUserName: existing.createUserName || null, country: existing.country || null,
        siteId: existing.siteId || null,
      };
    }
    function alreadyListedLine(extra) {
      return '已上架 · 本店铺（' + shopLabel + '）已上架该商品(记录 id ' + (existing.id || '?')
        + ', 创建于 ' + (existing.createTime || '?') + ', 操作人 ' + (existing.createUserName || '?')
        + ', 站点 ' + (existing.country || '?') + ')' + (extra ? (' · ' + extra) : '');
    }
    if (autoUpdate) {
      /* ★ 拦截取消后, 这条提醒仍然有用: 用户可能去 ifast 列表里找这条、却因为
       *   列表默认筛「创建时间=最近7天」而看不到(实测被问过一次"上架系统里没有这个记录")。 */
      const ageDays = (() => {
        const t = Date.parse(String(existing.createTime || '').replace(/-/g, '/'));
        return isNaN(t) ? null : Math.floor((Date.now() - t) / 86400000);
      })();
      const ageHint = (ageDays != null && ageDays >= 7)
        ? (' · ⚠ ifast 列表默认只显示「最近7天创建的」, 这条已 ' + ageDays + ' 天 → 在列表里要用「ASIN 搜索」直接搜 ' + taskAsin + ' 才看得到')
        : '';
      say('   [API] ✅ ' + alreadyListedLine('自动按「更新现有记录」提交(不新增)') + ageHint);
      autoUpdateHint = ageHint;
    }
    /* ★ 2026-10-07: 「更新现有记录」的正确接口是 **item_edit.json**(不是 item_add.json 带 id —— 实测
     *   后者仍按"新增"校验并报 `code=500 站点已经存在此ASIN`)。前端编辑入口是 item_edit.html?id=<行id>,
     *   它提交到 /amazon/selling/item/item_edit.json(表单字段 + hidden id), 从 item_edit.js 里读到的。
     *   ★ autoUpdate=true 表示"用户点的是普通上传, 但商品已存在 → 我们自动改走更新"(见上面的说明)。 */
    const wantUpdate = (updateExisting || autoUpdate) && !!(existing && existing.exists === true) && !isMulti;

    const opt = await IFAPI.options();
    if (!opt.sites.length) return { done: false, why: 'API 取不到站点列表' };
    const siteHit = f.siteId ? { id: f.siteId, how: '任务自带' } : siteIdOf(site, { options: opt.sites });
    if (!siteHit.id) return { done: false, why: 'API 认不出站点「' + site + '」(可用站点 ' + opt.sites.map((x) => x.value).join('/') + ')' };
    const sellHit = f.sellingId ? { id: f.sellingId, how: '任务自带' } : sellingIdOf(f, { options: opt.sells });
    if (!sellHit.id) return { done: false, why: 'API 认不出跟卖时间(时间窗 ' + (f.followWindow || '—') + ')' };

    /* stock / 备货周期: 与 DOM 流一致 —— 任务没给就用页面输入框的默认 value('10' / '2') */
    const stock = (f.stock == null || f.stock === '') ? FORM_DEF.stock : String(f.stock);
    const lead = (f.leadDays == null || f.leadDays === '') ? FORM_DEF.lead : String(f.leadDays);
    /* ★★ 2026-10-07 修【更新把"我们不管的字段"清空】—— 实测证据:
     *   B0GYF76ZJX 那行 13:07 时 sku 还是 "260821442-10-4622535932", 我们做了几次 item_edit 之后变成了空串。
     *   原因: item_edit.json 是【整表单覆盖式更新】, 而我们的载荷里写死了 sku:'' / remark:'' ——
     *   等于替上游把它原有的值抹掉(这不是"没改", 这是"改坏了")。
     *   修法: 更新模式下, 这些字段一律【回填 ifast 现状值】(listingOf 已取到), 绝不无条件写空。 */
    const keepSku = (wantUpdate && existing) ? String(existing.sku == null ? '' : existing.sku) : '';
    const keepRemark = (wantUpdate && existing) ? String(existing.remark == null ? '' : existing.remark) : '';
    const common = { siteId: siteHit.id, sellingId: sellHit.id, stock: stock, fulfillmentLatency: lead, remark: keepRemark };

    let url, body, isJson, items = [], rbItems = [], queryTotal = null, queried = null;

    if (isMulti) {
      if (!want.length) return { done: false, why: '任务没有变体名单(variantItems 为空)' };
      queried = String(f.variantParent || f.asin || task.asin).toUpperCase();
      say('   [API] 查变体: ' + queried + ' / ' + cc);
      const q = await IFAPI.post('/amazon/tool/asin_search.json', { asin: queried, country: cc }, false);
      if (!q.ok) return { done: false, why: '查变体失败: ' + (q.err || (q.code === 403 ? '登录超时(403)' : ('code=' + q.code + ' ' + (q.msg || '')))) };
      queryTotal = (q.data || []).length;
      const byAsin = {};
      (q.data || []).forEach((x) => { byAsin[String(x.asin).toUpperCase()] = x });
      const miss = [];
      want.forEach((w) => {
        const a = String(w.asin).toUpperCase();
        const src = byAsin[a];
        if (!src) { miss.push(a); return }
        const s0 = (src.summaries || [])[0] || {};
        items.push({
          asin: a, sku: '',
          initPrice: (w.initPrice == null ? '' : String(w.initPrice)),
          lowerPrice: (w.bearPrice == null ? '' : String(w.bearPrice)),
          title: (s0.itemName == null ? null : s0.itemName),
          brand: (s0.brand == null ? null : s0.brand),
          image: IFAPI.image(src),
          type: (((src.productTypes || [])[0] || {}).productType == null ? null : src.productTypes[0].productType),
        });
        rbItems.push({ asin: a, initPrice: (w.initPrice == null ? '' : String(w.initPrice)), bearPrice: (w.bearPrice == null ? '' : String(w.bearPrice)) });
      });
      if (miss.length) return { done: false, why: 'API 查到 ' + queryTotal + ' 个变体, 但名单里 ' + miss.length + ' 个不在里面: ' + miss.join(',') };
      say('   [API] 查到 ' + queryTotal + ' 个变体（一次全量, 无需翻页）; 名单 ' + items.length + ' 个全命中');
      url = '/amazon/selling/item/product_add.json'; isJson = true;
      body = Object.assign({}, common, { items: items });
    } else {
      const asin = String(f.asin || task.asin || '').toUpperCase();
      /* ★ 更新模式走 item_edit.json(编辑现有记录); 普通模式走 item_add.json(新增) */
      url = wantUpdate ? '/amazon/selling/item/item_edit.json' : '/amazon/selling/item/item_add.json';
      isJson = false;
      body = Object.assign({ id: wantUpdate ? String(existing.id || '') : '', asin: asin, sku: keepSku }, common, {
        price: (f.initPrice == null ? '' : String(f.initPrice)),
        lowerPrice: (f.bearPrice == null ? '' : String(f.bearPrice)),
      });
      rbItems = [{ asin: asin, initPrice: body.price, bearPrice: body.lowerPrice }];
    }

    /* ★ 本次任务的"主 ASIN"(单个=它的 asin; 多变体=父 ASIN) —— 必须在下面所有回读/存在性判断之前定义。
     *   ★★ 2026-10-07 踩坑记录: 这个变量原来只在"提交之后"才声明(const → TDZ), 而我在提交前新增的
     *   "存在性判定"里就用到了它 → ReferenceError → 被上层 catch 成"API 通道异常" →
     *   **静默回退到 DOM 流程**(卡在弹窗上, 表现为"点上传没反应")。声明必须提到最前面。 */
    const mainAsin = isMulti
      ? (queried || String(f.variantParent || f.asin || task.asin || '').toUpperCase())
      : String(body.asin || f.asin || task.asin || '').toUpperCase();

    const readBack = {
      mode: isMulti ? 'multi' : 'single', channel: 'api', country: isMulti ? cc : null,
      queried: queried, foundAsins: null, foundTotal: queryTotal,
      checkedAsins: rbItems.map((x) => x.asin), checkedMissing: [], checkedPages: 0, checkedPageSize: null,
      site: siteHit.id + '=' + (siteHit.how || ''), selling: sellHit.id + '=' + (sellHit.how || ''),
      stock: stock, leadDays: lead, items: rbItems, visible: true,
    };

    /* ══════════ ★ 2026-10-07 针对性解决【对已存在商品反复"添加"必然失败】 ══════════
     * 实测(用户 6 次尝试 / 5 次失败): 某品在 ifast 已存在(2026-09-24 由另一个操作人创建),
     *   我们对它反复 POST item_add.json「新增」→ ifast 用 **HTML 错误页**拒绝(HTTP 200 但非 JSON),
     *   旧逻辑把它当普通失败并提示"可点上传重传" → 用户照做 → 再失败 → 死循环。
     * 事实: **同账号 + 同站点 + 同 ASIN 不允许重复"添加"**, 重试永远不可能成功。
     * 正确做法只有两条: ① 走【编辑】更新现有记录(带记录 id 提交同一接口 = 编辑语义);
     *                    ② 或先去 ifast 删掉那条再添加。
     * 所以这里: **提交前先查存在性** ——
     *   · 普通模式(opts.updateExisting 非真)遇到"已存在" → **不提交**, 直接告诉用户该怎么走;
     *   · 编辑模式(opts.updateExisting, 用户点「✎ 更新现有记录」) → 把现有记录的 id 放进 body → 更新。 */
    /* ★ 存在性判定已在函数【开头】完成(普通模式的"已存在"在那里就 return 了) ——
     *   这里只剩【编辑模式】要做的事: 把现有记录的 id 放进 body。 */
    if (existing) readBack.ifast = existing;
    if (wantUpdate) {
      say('   [API] ✎ 更新模式: POST item_edit.json · 记录 id=' + body.id + ' (不新增)');
    } else if (updateExisting) {
      say('   [API] ✎ 更新模式但 ifast 查不到该商品(或多变体任务) → 按新增处理');
    }

    /* 必填校验 —— 与 DOM 那条同一口径, 免得换了通道反而把坏数据放过去 */
    const bad = [];
    if (isMulti) {
      items.forEach((x) => {
        const m = [];
        if (!x.initPrice) m.push('初始价');
        if (!x.lowerPrice) m.push('承受价');
        if (m.length) bad.push(x.asin + ' 缺 ' + m.join('+'));
      });
    } else {
      if (!/^[A-Z0-9]{10}$/.test(body.asin)) bad.push('asin 不合法(' + body.asin + ')');
      if (!body.price) bad.push('初始价');
      if (!body.lowerPrice) bad.push('承受价');
    }
    if (bad.length) {
      const note = '必填没过 → 未提交: ' + bad.slice(0, 6).join(' · ') + (bad.length > 6 ? ' …' : '');
      say('   [API] ✗ ' + note);
      await apiReport(task, { dryRun: true, submitted: false, ok: false, readBack: readBack, note: note });
      setMsgLock('✗ ' + label + ' 必填没过(API) · ' + task.asin + ' —— ' + note, false, 30000);
      return { done: true };
    }

    if (!autoSubmit) {
      const note = 'API 干跑(只填未提交) · 将 POST ' + url + ' · ' + rbItems.length + ' 条';
      /* ★ 调试探针: 留下这次构造的完整 body(与 content.js 的 __zyWatch 同思路) —— 干跑时用来核对载荷 */
      try {
        window.__zyLastApi = { at: new Date().toISOString(), url: url, isJson: isJson, autoSubmit: false, body: body };
      } catch (e) {}
      say('   [API] ✓ 干跑完成, 未提交。body=' + JSON.stringify(body).slice(0, 4000));
      await apiReport(task, { dryRun: true, submitted: false, ok: true, readBack: readBack, note: note });
      setMsgLock('✅ API 干跑完成(未提交) · ' + task.asin + ' · ' + rbItems.length + ' 条 —— 数据已备好, 去掉「只填不提交」即真提交', true, 30000);
      return { done: true };
    }

    /* ══════════ ★ 2026-10-07 用户要求: 店铺内已上架 → 返回信息写【已上架】 ══════════
     *   已存在(本店铺已上架)时: 若本次要写的 价格/承受价/库存/备货/跟卖组 与线上【完全一致】,
     *   就【不写】—— 直接判「已上架 · 无需改动」。
     *   为什么不写: item_edit 是整表单覆盖式更新, 每次写入都有覆盖上游字段的风险
     *   (实测事故: 载荷里的 sku:'' 把上游原有 sku 抹成了空); 没变化就不该产生写入。
     *   ★ 注意这里必须放在"干跑"之后: 干跑要给人看载荷, 不能因为"无变化"就跳过。 */
    let alreadyListed = wantUpdate && !!existing;
    if (alreadyListed) {
      const eq = (a, b) => String(a == null ? '' : a) === String(b == null ? '' : b);
      const same = eq(existing.price, body.price) && eq(existing.lowerPrice, body.lowerPrice)
        && eq(existing.stock, body.stock) && eq(existing.fulfillmentLatency, body.fulfillmentLatency)
        && eq(existing.sellingId, body.sellingId);
      if (same) {
        const note = alreadyListedLine('本次要写的内容与线上完全一致 → 无需改动(未产生任何写入)') + autoUpdateHint;
        say('   [API] ✅ ' + note);
        await apiReport(task, { dryRun: false, submitted: false, ok: true, alreadyListed: true, noChange: true, readBack: readBack, note: note });
        setMsgLock('✅ 已上架 · ' + task.asin + ' —— 本店铺（' + shopLabel + '）已上架该商品(记录 id ' + (existing.id || '?')
          + ', ' + (existing.createTime || '?') + ' ' + (existing.createUserName || '?') + ')；价格/承受价/库存/跟卖组与线上一致, 无需改动', true, 30000);
        return { done: true, alreadyListed: true, noChange: true, recordId: existing.id || null };
      }
    }

    /* ★★ 到这里才是真提交 —— 之后无论结果都不再回退 DOM(防重复上架) */
    /* ★ 2026-10-07 新增: 真提交【之前】先探活(见 IFAPI.probeSession 说明)。
     *   探活不过 → 一个字节都不发出去, 直接如实报"未提交, 可安全重试" —— 避免出现
     *   "请求发出了但结果判不出来"的悬案(实测踩到过一次, 只能人工核对)。 */
    const pre = await IFAPI.probeSession();
    if (!pre.ok) {
      const note = '提交前探活没通过 → 【未提交任何请求】: ' + pre.why + '（刷新/重新登录 ifast 后可安全重传）';
      say('   [API] ✗ ' + note);
      await apiReport(task, { dryRun: true, submitted: false, ok: false, readBack: readBack, note: note });
      setMsgLock('✗ 未提交 · ' + task.asin + ' —— ' + pre.why + '（请刷新/重新登录 ifast 页再传）', false, 45000);
      return { done: true };
    }
    say('   [API] 提交 ' + url + ' · ' + rbItems.length + ' 条…');
    try {
      window.__zyLastApi = { at: new Date().toISOString(), url: url, isJson: isJson, autoSubmit: true, body: body };
    } catch (e) {}
    const t0 = Date.now();
    const r = await IFAPI.post(url, body, isJson);
    const ms = Date.now() - t0;
    /* ★ 2026-10-07: 把 ifast 的【应答】也留在痕迹里 —— 排查"到底有没有被接受"必须有硬证据。
     *   实测发现: 用完全相同的值重复提交, ifast 的 updateTime 不会变(MySQL 的 ON UPDATE 语义:
     *   没有任何列真正变化就不更新时间戳) → 只看 updateTime 会误判成"没提交成功"。
     *   所以判据必须是"应答 code/msg", 而不是"时间戳变没变"。 */
    try {
      window.__zyLastApi = Object.assign(window.__zyLastApi || {}, {
        ms: ms, respOk: r.ok, code: (r.code == null ? null : r.code), msg: r.msg || null, err: r.err || null,
        dataType: Array.isArray(r.data) ? ('array[' + r.data.length + ']') : typeof r.data,
      });
    } catch (e) {}
    const respLine = (r.code == null && !r.msg) ? '' : (' · ifast 应答 code=' + r.code + (r.msg ? (' "' + r.msg + '"') : ''));
    const cnt = Array.isArray(r.data) ? r.data.length : r.data;
    /* ★ 2026-10-07: 提交成功后【回读 ifast】确认这条到底是不是我们建的 —— 见 IFAPI.listingOf 的说明。
     *   同时修掉 "true 条" 这种丑陋输出(data 是布尔时不该当条数用)。 */
    /* ★ mainAsin 已在上面(readBack 之前)声明 —— 这里不再重复声明(否则 SyntaxError: 重复 const) */
    let ifast = null, preExisted = null;
    if (r.ok) {
      try { ifast = await IFAPI.listingOf(mainAsin, site); } catch (e) { ifast = null }
      preExisted = ifastPreExisted(ifast, t0);
    }
    const ifLine = !ifast ? ''
      : (ifast.exists === true
        ? (' · ifast 侧: ' + (preExisted
          ? ('该商品【早已存在】(创建于 ' + ifast.createTime + ', 操作人 ' + (ifast.createUserName || '?') + ') —— 本次提交未新增商品')
          /* ★ 2026-10-07 文案修正: 这里原来的措辞是"已存在 创建于…", 但这是【刚新建成功】的情况 ——
           *   用户(实测)会读成"又是个空操作"。新建就说"本次新建", 并用创建时间自证。 */
          : ('✅ 本次新建 · 创建于 ' + (ifast.createTime || '?') + ' · 操作人 ' + (ifast.createUserName || '?') + ' · 记录 id ' + (ifast.id || '?'))))
        : (ifast.exists === false ? ' · ⚠ ifast 侧查不到该商品(提交返回成功但列表里没有) —— 请人工核对' : ''));
    if (r.ok) {
      /* ★ 2026-10-07 用户要求「店铺内已上架 → 返回信息写【已上架】」:
       *   走更新通道时, 备注以【已上架 · 本店铺（X）已上架该商品(...)】开头 —— 让人一眼看出
       *   "这个品在本店铺早就上架过", 然后再说明"这次按你的数据更新了哪几项(未新增)"。 */
      const note = wantUpdate
        ? (alreadyListed
          ? (alreadyListedLine(updateExisting ? '已按本次数据更新(未新增)' : '自动按本次数据更新(未新增)') + ' · item_edit.json · ' + ms + 'ms' + respLine + autoUpdateHint)
          : ('已上架(更新现有记录) · item_edit.json · 记录 id=' + body.id + ' · ' + ms + 'ms' + respLine))
        : ('API 直连提交成功' + (typeof cnt === 'number' ? (' · ' + cnt + ' 条') : '') + ' · ' + ms + 'ms' + respLine + ifLine);
      if (readBack) readBack.ifast = ifast;
      if (readBack) readBack.alreadyListed = alreadyListed || undefined;
      say('   [API] ✅ ' + note);
      await apiReport(task, { dryRun: false, submitted: true, ok: true, alreadyListed: alreadyListed || undefined, readBack: readBack, note: note });
      setMsgLock(wantUpdate
        ? ('✅ 已上架 · ' + task.asin + ' —— 本店铺（' + shopLabel + '）已上架该商品(记录 id ' + (existing && existing.id || body.id)
          + ', ' + ((existing && existing.createTime) || '?') + ')；已按本次 价格 ' + body.price + ' / 承受价 ' + body.lowerPrice + ' 更新, 未新增')
        : ('✅ 已提交(API 直连) · ' + task.asin + ' · ' + rbItems.length + ' 条 · ' + ms + 'ms'
          + (preExisted ? '（注意: ifast 早有此商品, 本次未新增）' : '')), true, 30000);
    } else {
      const why = r.err || (r.code === 403 || r.code === '403' ? '登录超时(403) —— 请重新登录 ifast' : ('code=' + r.code + ' ' + (r.msg || '')));
      /* ★ 2026-10-07 新增【非 JSON 响应定真伪】:
       *   实测用户遇到过一次: POST item_add.json 收到 HTTP 200 + HTML 外壳页(不是 JSON) ——
       *   那一刻请求已经发出, 但结果无法判定(可能成功也可能没被处理), 只能人工核对。
       *   现在用 ifast 回读把话说死:
       *     · 商品存在, 且创建时间就是刚才 → 【其实提交成功了】(别冤枉它, 也别让用户重传)
       *     · 商品存在, 但创建时间很早   → 早就有了, 不是这次建的
       *     · 商品不存在                 → 这次确实没提交成功 → **可以安全重传**
       *     · 回读也失败                 → 明确告诉用户"结果未确认, 请人工核对"(不假装知道) */
      let verdict = '', reallySubmitted = false;
      if (/不是 JSON/.test(String(why))) {
        const inf = await IFAPI.listingOf(mainAsin, site).catch(() => null);
        const early = ifastPreExisted(inf, t0);
        if (inf && inf.exists === true && early === false) {
          reallySubmitted = true;
          verdict = ' · 【回读判定: 本次提交其实成功】ifast 已有该商品, 创建于 ' + (inf.createTime || '?')
            + ', 操作人 ' + (inf.createUserName || '?');
        } else if (inf && inf.exists === true) {
          verdict = ' · 回读: 该商品早已存在(创建于 ' + (inf.createTime || '?') + ', 操作人 ' + (inf.createUserName || '?') + '), 不是这次建的';
        } else if (inf && inf.exists === false) {
          verdict = ' · 【回读确认: ifast 里没有这个商品 → 本次确实没提交成功, 可以安全重传】';
        } else {
          verdict = ' · 回读也失败了, 结果【未确认】—— 请到 ifast 搜 ' + mainAsin + ' 核对后再决定是否重传';
        }
        if (inf) readBack.ifast = inf;
      }
      const note = 'API 直连提交失败 · ' + why + ' · ' + ms + 'ms（请求已发出, 不自动回退, 免得上两次）' + verdict;
      say('   [API] ' + (reallySubmitted ? '⚠' : '✗') + ' ' + note);
      await apiReport(task, { dryRun: false, submitted: reallySubmitted, ok: reallySubmitted, readBack: readBack, note: note });
      setMsgLock((reallySubmitted ? '⚠ 接口返回异常, 但回读确认已上架 · ' : '❌ API 提交失败 · ') + task.asin + ' —— ' + why
        + (reallySubmitted ? '（无需重传）' : (verdict.indexOf('安全重传') >= 0 ? '（确认未提交, 可以点「上传」重传）' : '（结果未确认, 请到 ifast 核对）')), false, 45000);
    }
    try {
      const t = await chrome.runtime.sendMessage({ type: 'LISTING_FILL_TASKS', status: 'todo', limit: 1 });
      if (t && t.ok && t.result) syncFillBtn();
    } catch (e) {}
    return { done: true };
  }

  /** 整条流程: 导入导出 → 添加跟卖 → 填表 → 点保存提交 → 回报 ERP
   *  ★ 2026-09-26 用户要求: 默认就提交(填完直接在 ifast 保存)。
   *    · 不传 opts / opts.autoSubmit 未指定 → 【提交】
   *    · 想只看填得对不对不提交 → 传 { autoSubmit: false }(面板上那个「只填」按钮)
   *  opts.taskId 指定要填哪一条(从采集器点上传直接触发时用, 避免抢到别的任务) */
  /** ★ 2026-10-03 包一层: 跑的时候置 fillBusy —— 挡掉"重复点击"和"定时 refresh 插进来抢消息"。
   *   真正的实现是下面的 doFillFlowInner。 */
  async function doFillFlow(opts) {
    if (fillBusy) { setMsg('⏳ 上一次填表还在进行中, 请等它跑完…', false); return }
    fillBusy = true;
    try { return await doFillFlowInner(opts) }
    finally { fillBusy = false }
  }

  async function doFillFlowInner(opts) {
    opts = opts || {};
    /* ★ 是否提交: 显式传了就用传的(面板两个按钮各传 true/false);
     *   没传(比如采集器发来的 RUN_FILL 没带) → 用设置页里的「自动填表并保存」总开关(默认开)。 */
    const autoSubmit = (opts.autoSubmit != null) ? !!opts.autoSubmit : (ZV_SET.autoSubmit !== false);
    if (!/item_list\.html/.test(location.pathname)) {
      setMsg('✗ 请在「亚马逊 → ASIN管理」列表页上点这个按钮（添加跟卖弹窗是从那页打开的）', false);
      return;
    }
    setMsg('⏳ 取 ERP 待填任务…', true);
    let tasks = null;
    try {
      const r = await chrome.runtime.sendMessage({ type: 'LISTING_FILL_TASKS', limit: opts.taskId ? 50 : 1 });
      if (!r || !r.ok) throw new Error((r && r.error) || '后台无响应');
      tasks = (r.result && r.result.items) || [];
    } catch (e) { setMsg('✗ 取任务失败: ' + zvHumanErr(e), false); return }
    if (opts.taskId) tasks = tasks.filter((t) => t.id === opts.taskId);   // 只填指定的那条
    if (!tasks.length) { setMsg('· 没有待填任务（先去 Amazon 页面上传一条）', false); return }
    const task = tasks[0];
    try {
      log2('任务: ' + task.site.toUpperCase() + ' ' + task.asin + ' · 承受价 ' + (curOfSite(task.site) || '¥') + ' ' + ((task.fill || {}).bearPrice) + ' · 初始价 ' + (curOfSite(task.site) || '') + ' ' + ((task.fill || {}).initPrice));
      /* ★ 2026-09-26 用户要求: 不再把这一大段填表明细显示在页面上(太吵)。
       *   现在只写到浏览器控制台(排查时按 F12 看), 页面上只保留 panel 里那一行结论。
       *   失败信息仍然会经 setMsg / setMsgLock 显示在面板上, 不会静默。 */
      const lg = document.querySelector('#zying-fill-log');
      if (lg) lg.remove();                                   // 清掉旧版本可能残留的日志块
      const say = (t) => { log2(t) };                        // 只进 console

      /* ══ ★ 多店铺隔离 (2026-10-06): 提交前的查重预检 ══
       * 问一次 ERP: 这条(asin + 站点)是不是【已经被哪个店铺上架过了】? 命中就【不填表、不点保存】。
       * 为什么必须在这里拦: 一旦点了保存, 请求就发出去了 —— 按回退纪律, 只有"请求还没发出"才允许拦。
       * 后端在上传时也会拦(不给重复商品入队), 这道预检兜的是"入队之后别家先上架了"的时序。
       * 提示里带【哪个店铺 + 什么时候上架】，直接显示在面板上(最小化时会自动弹开 + 抖一下)。
       * 老后端(没重启)没有 /api/listing/check → supported=false, 静默跳过, 绝不影响正常填表。 */
      try {
        const ck = await chrome.runtime.sendMessage({ type: 'LISTING_CHECK', payload: { asin: task.asin, site: task.site } });
        /* ★ 2026-10-07: 拦截受「重复上架拦截」总开关控制 —— 只有 duplicated 且 enforce !== false 才跳过。
         *   开关关闭时 enforce=false: 照实提示"这个品已在…上架过", 但**不阻断**, 继续填表提交。 */
        /* ★ 2026-10-24 PRD F3(提交前最后一道): 跨店台账判决 —— 与旧「重复上架拦截」开关无关,
         *   由后端 claimSettings.enabled 控制; 用户近期点过「我确认，强制上架」则 blocked=false(放行)。
         *   这道是兜底: 万一前端弹窗被绕过(换机器/旧版插件/手写脚本), 请求也发不出去。 */
        const claimsInfo = (ck && ck.claims) || null;
        if (claimsInfo && claimsInfo.blocked) {
          const cmsg = claimsInfo.message || '该品已在其他店铺上过';
          say('⛔ 跨店预检拦截: ' + cmsg + ' —— 未提交 ifast');
          brPoopBounce();
          try { brCollapse(false, true); } catch (e) {}
          setMsgLock('⛔ 跨店预检拦截: ' + cmsg + '（未提交）。要多店同款: 在采集器「确认上传」弹窗点「我确认，强制上架」, 会留审计。', false, 120000);
          await apiReport(task, {
            dryRun: false, submitted: false, ok: true,
            note: '⛔ 跨店预检拦截(未提交): ' + cmsg,
          });
          const h = claimsInfo.hit || {};
          return { done: true, blocked: true, block: { shop: h.storeName || h.storeId || null, site: task.site, at: h.at || null, scope: 'claims', text: cmsg } };
        }
        if (claimsInfo && claimsInfo.overridden) {
          say('· 跨店预检: 该品已在其他店铺上过, 但你已确认强制上架(' + (claimsInfo.overrideAt || '') + ') → 继续提交');
        }
        const reallyBlocked = !!(ck && ck.supported && ck.duplicated && ck.enforce !== false);
        if (ck && ck.supported && ck.duplicated && !reallyBlocked) {
          say('⚠ 预检: ' + (ck.message || '该商品已存在') + '（拦截开关关闭 → 继续提交）');
        }
        if (reallyBlocked) {
          const b = ck.block || {};
          /* ★ 2026-10-07: 拦截提示必须说【真话】—— ERP 记录说的是"我们提交成功的时间",
           *   而 ifast 行里的 createTime/createUserName 才是"这个品什么时候被谁上架的"。
           *   实测: ERP 说"已于 2026-10-07 13:15 上架过", 但 ifast 显示创建于 2026-09-24(操作人 xiaotang)
           *   —— 用户看到"我没上过这个品却被拦"就是因为提示只报了我们的提交时间。 */
          let ifLine = '';
          try {
            const inf = await IFAPI.listingOf(task.asin, task.site);
            if (inf && inf.exists === true) {
              ifLine = ' · ifast 侧实际: 创建于 ' + (inf.createTime || '?') + ', 操作人 ' + (inf.createUserName || '?')
                + ', 站点 ' + (inf.country || '?') + (inf.sellingId ? (', 跟卖组 ' + inf.sellingId) : '');
            } else if (inf && inf.exists === false) {
              ifLine = ' · ⚠ ifast 侧【查不到】这个商品 —— ERP 记录与 ifast 不一致, 请人工核对后再决定';
            }
          } catch (e) {}
          const line = (b.text || ck.message || ('⛔ 该商品已在其他店铺上架过 —— 已跳过, 未提交 ifast')) + ifLine;
          say('⛔ 预检拦截: ' + line);
          brPoopBounce();
          try { brCollapse(false, true); } catch (e) {}
          setMsgLock(line, false, 120000);
          /* 回报 ERP: 明确写"没提交", 并把是哪个店铺/什么时候写进备注 —— 上架记录里看得到 */
          await apiReport(task, {
            dryRun: false, submitted: false, ok: true,
            note: '⛔ 预检拦截(未提交): 已在「' + (b.shop || '未分类店铺') + '」'
              + (b.site ? ('(' + String(b.site).toUpperCase() + ')') : '') + ' 于 ' + (b.at || '时间未知') + ' 上架过' + ifLine,
          });
          return { done: true, blocked: true, block: b };
        }
        if (ck && ck.supported === false) say('· 预检跳过(后端还没有 /api/listing/check, 重启 ERP 后生效)');
      } catch (e) { say('· 预检跳过: ' + zvHumanErr(e)); }

      /* ★ 2026-10-03 先试 API 直连 —— 成功就完全跳过下面的 DOM 流程(不开弹窗、不翻页、不点勾选)。
       *   只有【提交前就失败】才回退; 已经在提交环节失败的不回退(见 apiTryTask 的纪律说明)。 */
      if (ZV_SET.apiDirect !== false) {
        const t0 = Date.now();
        let ar = null;
        try { ar = await apiTryTask(task, autoSubmit, say, { updateExisting: opts.updateExisting === true }); }
        catch (e) { ar = { done: false, why: 'API 通道异常: ' + String((e && e.message) || e) } }
        if (ar && ar.done) {
          /* ★ 这行必须在结果消息【之前】say —— log2 也写面板, 放后面会把结论冲掉 */
          say('   [API] 本条总耗时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's（未走 DOM）');
          return;
        }
        say('   [API] ✗ 直连不可用 → 回退 DOM 流程（' + ((ar && ar.why) || '未知') + '）');
        setMsg('⏳ API 直连不可用, 改用页面流程…', true);
      }

      const findAdd = () => [...document.querySelectorAll('iframe')].find((f) => /item_add\.html/.test(f.getAttribute('src') || '') && f.contentDocument && f.contentDocument.querySelector('input[name=asin]'));
      let opened = findAdd();
      if (opened) say('· 检测到「添加跟卖」弹窗已经开着, 直接复用(不再点一遍, 免得叠弹窗)');
      if (!opened) {
        say('① 点「导入导出」');
        const btnIE = document.querySelector('#btnImportExport') || findClickable('导入导出');
        if (!btnIE) throw new Error('没找到「导入导出」按钮');
        safeClick(btnIE, '打开下拉');
        await sleep2(600);
        say('② 点「添加跟卖」');
        const btnAdd = document.querySelector('a#btnAdd') || findClickable('添加跟卖');
        if (!btnAdd) throw new Error('没找到「添加跟卖」');
        safeClick(btnAdd, '打开弹窗');
        await sleep2(2500);
      }
      say('③ 找弹窗 iframe');
      let ifr = opened || null;
      for (let i = 0; i < 12 && !ifr; i++) {
        ifr = findAdd();
        if (ifr) break;
        await sleep2(700);
      }
      if (!ifr || !ifr.contentDocument) throw new Error('弹窗 iframe 没就绪');
      const doc = ifr.contentDocument;
      zvWatchIframeAjax(doc);   // ★ 提前装钩子: 保存请求的返回是判断成功/失败最可靠的依据
      zvInstallMsgWatch();      // ★ 提示记录器: ifast 的提示只闪一下 / 弹窗会被重建, 必须"记录"而不是"轮询"
      say('   弹窗已就绪: ' + (doc.title || 'item_add'));
      // ★ 实测: select 的选项是弹窗打开后 AJAX 灌进去的, 只有占位项时选不中 → 先等
      let nSite = 0, nSell = 0;
      for (let i = 0; i < 25; i++) {
        const a = doc.querySelector('select#siteId'), b = doc.querySelector('select[name=sellingId]');
        nSite = a ? a.options.length : 0; nSell = b ? b.options.length : 0;
        if (nSite > 1 && nSell > 1) break;
        await sleep2(600);
      }
      say('   下拉选项已加载: 站点 ' + nSite + ' 项 / 跟卖时间 ' + nSell + ' 项');
      // ★ 2026-09-26 关键修复: 弹窗有两个 Tab(单个添加 / 多变体添加), 各有一套表单。
      //   弹窗默认停在「多变体添加」→ 按文档顺序取第一个会填到【隐藏的】那套, 用户看到的是空白表单。
      let pane = activePane(doc);
      const tabName = () => {
        const i = [...doc.querySelectorAll('.layui-tab-item')].indexOf(pane);
        const li = [...doc.querySelectorAll('.layui-tab-title li')][i];
        return li ? li.textContent.trim() : '?';
      };
      if (!paneHasFields(pane)) {
        const li = [...doc.querySelectorAll('.layui-tab-title li')].find((x) => /单个添加|单\s*个/.test(x.textContent || ''));
        if (li) {
          say('   · 当前停在「' + tabName() + '」Tab(缺 asin/站点 字段) → 切到「单个添加」');
          clickReal(li);                       // ★ 合成 click() 切不动, 必须真鼠标事件
          await sleep2(1200);
          pane = activePane(doc);
          say('   · 切 Tab 结果: 现在在「' + tabName() + '」' + (paneHasFields(pane) ? ' ✅' : ' ⚠ 还是没切过去'));
        }
      }
      // ★ 多变体任务 → 切到「多变体添加」Tab 走另一条流程(查询→勾选→批量填)
      const isMulti = !!((task.fill && (task.fill.fillMode === 'multi' || (task.fill.variantItems || []).length)));
      if (isMulti) {
        const mvLi = [...doc.querySelectorAll('.layui-tab-title li')].find((x) => /多变体/.test(x.textContent || ''));
        if (mvLi && !/多变体/.test(tabName())) { say('   · 多变体任务 → 切到「多变体添加」Tab'); clickReal(mvLi); await sleep2(1200); pane = activePane(doc) }
        say('④ 多变体流程(只填不提交) · 目标 Tab: ' + tabName());
        const outM = await fillMultiForm(doc, pane, task, say);
        outM.fields.forEach((x) => say('   ' + x.label + (x.how ? '[' + x.how + ']' : '') + ': ' + (x.ok ? ('"' + (x.before || '') + '" → "' + x.set + '"') : ('✗ ' + x.note))));
        say('⑤ 读回页面实际值:');
        Object.keys(outM.readBack || {}).forEach((k) => {
          const v = outM.readBack[k];
          say('   ' + k + ' = ' + (typeof v === 'object' ? JSON.stringify(v) : v));
        });
        lastFilledId = task.id;
        /* ★ 必填 / 次要分档(与单个添加同一口径):
         *   必填 = 国家 + 查询结果 + 勾选变体(勾到 0 个等于没东西可上) + 每个变体都有两个价;
         *   次要 = 站点/跟卖时间下拉没匹配上 → 只警告, 不拦提交。 */
        const REQM = ['国家', '查询结果', '勾选变体'];
        const missReqM = (outM.fields || []).filter((x) => !x.ok && REQM.indexOf(x.label) >= 0);
        const warnOptM = (outM.fields || []).filter((x) => !x.ok && REQM.indexOf(x.label) < 0);
        const itemsM = (outM.readBack && outM.readBack.items) || [];
        const unpriced = itemsM.filter((it) => !it.initPrice || !it.bearPrice);
        const fillOkM = missReqM.length === 0 && itemsM.length > 0 && unpriced.length === 0;
        if (warnOptM.length) say('   ⚠ 次要字段没填上(不影响提交): ' + warnOptM.map((x) => x.label).join(' · '));
        if (missReqM.length) say('   ✗ 必填没过: ' + missReqM.map((x) => x.label + '(' + (x.note || '') + ')').join(' · '));
        if (itemsM.length && unpriced.length) say('   ✗ 有 ' + unpriced.length + ' 个变体的价格是空的: ' + unpriced.map((x) => x.asin).join(', '));
        const warnNoteM = (warnOptM.length ? ('；次要未填: ' + warnOptM.map((x) => x.label).join('/')) : '') +
          (unpriced.length ? ('；空价变体 ' + unpriced.length + ' 个') : '');
        let submittedM = false, submitNoteM = '多变体: 只填未提交(验证)';
        if (autoSubmit) {
          if (!fillOkM) { submitNoteM = '必填没过 → 未提交' + warnNoteM; say('   [提交] 必填没过, 不点保存'); }
          else {
            const sv = await zvClickSaveAndWait(doc, say);
            submittedM = sv.ok; submitNoteM = '多变体提交: ' + sv.note + warnNoteM;
            say('   [提交] ' + (sv.ok ? '成功' : '未确认') + ' · ' + sv.note);
          }
        }
        lastFilledId = task.id;
        const payloadM = { id: task.id, asin: task.asin, dryRun: !submittedM, submitted: submittedM,
          ok: fillOkM && (!autoSubmit || submittedM), fields: outM.fields, readBack: outM.readBack, note: submitNoteM };
        try {
          const rr = await chrome.runtime.sendMessage({ type: 'LISTING_FILL_RESULT', payload: payloadM });
          say(rr && rr.ok ? '⑥ 已回报 ERP ✓ (' + (rr.fillStatus || '') + ')' : ('⑥ 回报 ERP 失败: ' + ((rr && rr.error) || '?')));
        } catch (e) { say('⑥ 回报异常: ' + e.message) }
        if (autoSubmit && submittedM) {
          say('✅ 多变体已提交(点过保存)');
          setMsgLock('✅ 已提交多变体 · ' + task.asin + ' (' + ((outM.readBack && (outM.readBack.items || []).length) || 0) + ' 个变体) · ' + submitNoteM, true, 30000);
        } else {
          say(autoSubmit ? '⚠ 多变体已填但提交未确认 —— 请人工核对' : '✅ 多变体完成(未点保存)。请人工核对上面每个框的值。');
          setMsgLock(autoSubmit
            ? ('⚠ 已填入多变体但提交未确认 · ' + task.asin + ' —— ' + submitNoteM + '；请人工核对或点「↺ 退回」重来')
            : ('✅ 已填入多变体(未提交) · ' + task.asin + ' (' + ((outM.readBack && (outM.readBack.items || []).length) || 0) + ' 个变体) —— 核对无误就手动点「保存」; 要重来点「↺ 退回」'), true, 30000);
        }
        try {
          const t = await chrome.runtime.sendMessage({ type: 'LISTING_FILL_TASKS', status: 'todo', limit: 1 });
          todoN = (t && t.ok && t.result && t.result.total) || 0; syncFillBtn();
        } catch (e) {}
        return;
      }
      say('④ 填表(只赋值, 不提交) · 目标 Tab: ' + tabName() + (paneHasFields(pane) ? '' : ' ⚠ 这个 Tab 里没有 asin/站点字段'));
      const out = fillForm(doc, task, pane);
      out.fields.forEach((x) => say('   ' + x.label + (x.how ? '[' + x.how + ']' : '') + ': ' + (x.ok ? ('"' + (x.before || '') + '" → "' + x.set + '"') : ('✗ ' + x.note + ' 可选: ' + JSON.stringify((x.opts || []).slice(0, 6))))));
      if (out.readBack && out.readBack.visible === false) say('   ⚠⚠ 警告: 这些值在【隐藏的 Tab】里, 用户看不到 —— 请检查 Tab 选择逻辑');
      say('⑤ 读回页面实际值' + (out.readBack && out.readBack.visible ? '(可见 ✅)' : '') + ':');
      Object.keys(out.readBack).forEach((k) => say('   ' + k + ' = ' + out.readBack[k]));

      // 填表校验 → (默认)点保存提交 → 回报 ERP
      /* ★ 必填 / 次要分档(用户要求把"保存锁"去掉):
       *   必填 = ASIN + 站点 + 初始价格 + 承受价 —— 这些填不上就不提交(否则等于提一条残品);
       *   次要 = 跟卖时间下拉没匹配上 / 库存 / 发货天数 → 只警告, 不再一刀切拦住保存。
       *   以前是 every(ok) 全过才点保存, 只要"跟卖时间"文案对不上就永远提交不了(实测踩过)。 */
      const REQ = ['ASIN', '站点', '初始价格', '承受价'];
      const missReq = out.fields.filter((x) => !x.ok && REQ.indexOf(x.label) >= 0);
      const warnOpt = out.fields.filter((x) => !x.ok && REQ.indexOf(x.label) < 0);
      const fillOk = missReq.length === 0;
      if (warnOpt.length) say('   ⚠ 次要字段没填上(不影响提交): ' + warnOpt.map((x) => x.label + '(' + (x.note || '') + ')').join(' · '));
      if (missReq.length) say('   ✗ 必填没过: ' + missReq.map((x) => x.label + '(' + (x.note || '') + ')').join(' · '));
      const warnNote = warnOpt.length ? ('；次要未填: ' + warnOpt.map((x) => x.label).join('/')) : '';
      let submitted = false, submitNote = '只填未提交(验证)';
      if (autoSubmit) {
        if (!fillOk) { submitNote = '必填没过 → 未提交' + warnNote; say('   [提交] 必填没过, 不点保存'); }
        else {
          const sv = await zvClickSaveAndWait(doc, say);
          submitted = sv.ok; submitNote = '提交: ' + sv.note + warnNote;
          say('   [提交] ' + (sv.ok ? '成功' : '未确认') + ' · ' + sv.note);
        }
      }
      const payload = { id: task.id, asin: task.asin, dryRun: !submitted, submitted: submitted,
        ok: fillOk && (!autoSubmit || submitted), fields: out.fields, readBack: out.readBack, note: submitNote };
      try {
        const rr = await chrome.runtime.sendMessage({ type: 'LISTING_FILL_RESULT', payload: payload });
        say(rr && rr.ok ? '⑥ 已回报 ERP ✓ (' + (rr.fillStatus || '') + ')' : ('⑥ 回报 ERP 失败: ' + ((rr && rr.error) || '?')));
      } catch (e) { say('⑥ 回报异常: ' + e.message) }
      lastFilledId = task.id;
      if (autoSubmit && submitted) {
        say('✅ 已提交(点过保存)');
        setMsgLock('✅ 已提交 · ' + task.asin + ' · ' + submitNote, true, 30000);
      } else {
        say(autoSubmit ? '⚠ 已填但提交未确认 —— 请人工核对' : '✅ 完成(未点保存)。请人工核对上面每个框的值。');
        setMsgLock(autoSubmit
          ? ('⚠ 已填入但提交未确认 · ' + task.asin + ' —— ' + submitNote + '；请人工核对或点「↺ 退回」重来')
          : ('✅ 已填入(未提交) · ' + task.asin + ' —— 核对无误就手动点「保存」; 要重来点「↺ 退回」'), true, 30000);
      }
      try {
        const t = await chrome.runtime.sendMessage({ type: 'LISTING_FILL_TASKS', status: 'todo', limit: 1 });
        todoN = (t && t.ok && t.result && t.result.total) || 0; syncFillBtn();
      } catch (e) {}
    } catch (e) {
      const emsg = (e && e.message) || e;
      const estack = (e && e.stack) ? String(e.stack).split('\n').slice(1, 4).map((x) => x.trim()).join(' ← ') : '';
      setMsgLock('✗ 填表失败: ' + emsg, false, 30000);
      log2('✗ ' + emsg + (estack ? ('\n   @ ' + estack) : ''));   // 明细只进 console
    }
  }

  async function refresh() {
    try {
      /* ★ 2026-10-07 修【上架器面板永远 0 条】: 原来这里调 load('pending') —— 只查 ERP 里 status=pending 的记录。
       *   而"待上架"只是记录的中间态: 一旦上架成功(status=listed)或失败(failed)或被查重拦下(blocked),
       *   就从面板上消失了 —— 用户看到"0 条", 会以为【根本没执行上架】。
       *   实测: 该店铺 ERP 里 5 条记录, status=pending 查出来 0 条, 面板就一直是 "0 条 · 待填 0 · 已上架 0 · 失败 0"
       *        (连 meta 里那两个"已上架/失败"计数也恒为 0 —— 自己跟自己矛盾)。
       *   面板是【上架记录视图】(有 ASIN/价格/月份/跟卖/填表/状态 列), 就应该显示全部记录;
       *   "待填任务数"另有 LISTING_FILL_TASKS(status=todo) 单独取, 不受这里影响。 */
      await load(); publish(); render();
      /* ★ 2026-10-07: 顺便读一次「重复上架拦截」开关状态, 关闭时在 meta 上标出来(见 render()) */
      try {
        const bk = await chrome.runtime.sendMessage({ type: 'LISTING_BLOCKING' });
        const on = (bk && bk.ok && bk.result) ? (bk.result.enabled !== false) : null;
        if (on !== blockingOn) { blockingOn = on; render(); }
      } catch (e) {}
      // 顺手取一下"待填任务数"(上品那条线的待办), 直接标在按钮上
      try {
        const t = await chrome.runtime.sendMessage({ type: 'LISTING_FILL_TASKS', status: 'todo', limit: 1 });
        todoN = (t && t.ok && t.result && t.result.total) || 0;
      } catch (e) { todoN = 0 }
      syncFillBtn();
      /* ★ 2026-10-03: 填表进行中也不覆盖 —— 否则每 20s 的自动刷新会插进正在跑的流程里抢消息。
       *   (实测: API 通道跑到第 2 秒时被 refresh 插了一条"已读到 N 条", 进度断掉) */
      if (!fillBusy && Date.now() > msgLockUntil) setMsg('已从 ERP 读到 ' + records.length + ' 条上架记录' + (todoN ? (' · 待填 ' + todoN + ' 条') : ''), true);
    } catch (e) { setMsg('✗ ' + zvHumanErr(e), false); }
  }

  /* ---------- 启动 ---------- */
  const boot = () => { build(); refresh(); };
  if (document.readyState === 'complete') setTimeout(boot, 1200);
  else window.addEventListener('load', () => setTimeout(boot, 1200));
  // 每 20s 拉一次, 保证刚在 Amazon 采完的品能自动出现在这里
  setInterval(() => { if (box) refresh(); }, 20000);

  /* ---------- ★ 被采集器/后台唤起: 直接填 + 提交 ----------
   * 采集器点「上传」后, background 会找到这个 ifast 页面并 postMessage 进来。
   * ★ 立刻回执(不能让 background 等整个填表流程 30~90 秒 —— MV3 的 service worker
   *   在等待响应期间容易被打断); 真正的进度和结果由 bridge 自己回报给 ERP,
   *   采集器那边靠轮询 ERP 记录状态看进度。
   */
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    try {
      if (msg && msg.type === 'SETTINGS_CHANGED') {
        loadSettings(() => setMsg('✓ 设置已更新（自动填表并保存 = ' + (ZV_SET.autoSubmit !== false ? '开' : '关') + '）', true));
        sendResponse({ ok: true });
        return true;
      }
      if (msg && msg.type === 'RUN_FILL') {
        if (!/item_list\.html/.test(location.pathname)) {
          sendResponse({ ok: false, error: '当前不是「亚马逊 → ASIN管理」列表页: ' + location.pathname });
          return true;
        }
        /* ★ 默认提交: 显式传 autoSubmit:false 才只填; 没传就用设置页的总开关(默认开)。 */
        const autoSubmit = (msg.autoSubmit != null) ? !!msg.autoSubmit : (ZV_SET.autoSubmit !== false);
        const taskId = msg.taskId || null;
        setMsgLock('⏳ 收到采集器的指令: ' + (autoSubmit ? '填表并提交' : '只填表') + (taskId ? (' · ' + taskId) : '') + ' …', true, 60000);
        // 立刻回执, 不等流程跑完
        sendResponse({ ok: true, started: true, autoSubmit: autoSubmit, taskId: taskId });
        // 异步跑; 同时把结果也 emit 出去, 便于采集器实时看到(它也可能在看 ERP 状态)
        /* ★ 2026-10-07: RUN_FILL 支持更新模式(updateExisting) —— 让"更新现有记录"也能被
         *   后台/采集器派发(不只是面板按钮), 便于自动化验证与后续"上架后自动改价"之类的用法。 */
        doFillFlow({ autoSubmit: autoSubmit, taskId: taskId, updateExisting: msg.updateExisting === true }).catch((e) => {
          log2('RUN_FILL 异常: ' + ((e && e.message) || e));
          setMsgLock('✗ 填表异常: ' + zvHumanErr(e), false, 30000);
        });
        return true;
      }
      /* ★★ 2026-10-07 重要: 这两个处理器【必须放在这个监听器里】。
       *   原因: bridge.js 里有两个 onMessage 监听器, 而本监听器在末尾对未知 type 直接
       *   `sendResponse({ok:false, error:'未知消息: X'})` —— Chrome 只认【第一个】响应,
       *   于是注册在第二个监听器上的处理器永远收不到消息(实测: 从后台发 IFAST_LISTING 得到
       *   "未知消息: IFAST_LISTING"; 同一个坑也让设置页的「立即检测登录」一直无效)。
       *   规范: 所有"能被后台/其它页请求"的能力都注册在这个监听器里。 */
      if (msg && msg.type === 'PING_PAGE') {
        /* ★ 2026-10-08: 极轻的"这个内容脚本实例还活着吗"探针 —— 给 background 的 reviveIfastTabs 用:
         *   只要它答得上来, 就说明这页的实例是【新的】, 不该被无谓刷新(否则页面会自己跳一下)。
         *   答不上来(端口已销毁/Extension context invalidated)才是真的失效, 那时刷新才有意义。 */
        sendResponse({ ok: true, ver: (window.__zvBridge && window.__zvBridge.ver) || null });
        return;
      }
      if (msg && msg.type === 'IFAST_LISTING') {
        const a = ((msg.payload || {}).asin) || msg.asin;
        const st = ((msg.payload || {}).site) || msg.site || '';
        IFAPI.listingOf(a, st).then((r) => sendResponse({ ok: true, listing: r })).catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
        return true;
      }
      if (msg && msg.type === 'SHOP_REFRESH_NOW') {
        refreshShop().then((r) => sendResponse({ ok: true, loggedIn: r && r.loggedIn, shop: r && r.shop, reason: r && r.reason }))
          .catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
        return true;
      }
      sendResponse({ ok: false, error: '未知消息: ' + (msg && msg.type) });    } catch (e) { sendResponse({ ok: false, error: zvHumanErr(e) }) }
    return true;
  });

  /* ══════════════════════════════════════════════════════════════════════
   * 店铺识别与记录(2026-10-06, 按《上架器-多店铺隔离-实施方案.md》)
   *   用户口径: 不编号 —— 登录后【发现新店铺就记一条】; 未登录只提示登录、不显示数据;
   *   设置页可删除店铺记录。
   *   账号名来源(已逆向实测): 上架记录 /amazon/selling/item/item_list.json 里的 createUserName(=账号名)
   *     与 userId; 跟卖组来自 /amazon/selling//user/selling.json(id/name/onSaleDesc)。
   *   登录判定: 接口返回 code===403 或全失败 → 未登录(不写库)。
   * ══════════════════════════════════════════════════════════════════════ */
  let curShop = null;                       // { name, userId, countries, sellingGroups, lastSeen }
  async function detectShop() {
    try {
      /* ★ 2026-10-07 加固【偶发误判未登录】—— 实测踩到: 页面刚重载后第一次请求可能 "Failed to fetch"
       *   (页面还在建立连接), 旧代码直接 -> return {loggedIn:false} -> 面板显示「🔒 未登录」+ 0 条记录,
       *   而实际上用户是登录着的(同一个会话, 别的接口都能读)。
       *   现在: ① 失败时**重试 3 次**(间隔 1.2s / 2.4s); ② 只有明确 http 拿到响应才判"未登录";
       *   ③ 403 仍然立即判定未登录(真过期)。 */
      let r = null, lastErr = null;
      for (let i = 0; i < 3; i++) {
        try { r = await IFAPI.get('/amazon/selling/item/item_list.json?page=1&limit=1'); lastErr = r && r.err ? r.err : null; } catch (e) { r = null; lastErr = String((e && e.message) || e) }
        if (r && (r.code === 403 || Array.isArray(r.data))) break;      // 有明确结论(登录失效 / 拿到了数据) → 不再重试
        await new Promise((res) => setTimeout(res, 1200 * (i + 1)));
      }
      if (!r) return { loggedIn: false, reason: '读店铺信息失败(网络/页面还没就绪): ' + (lastErr || '无响应') };
      if (r.code === 403) return { loggedIn: false, reason: '未登录(code 403)' };
      const row = ((r && r.data) || [])[0] || null;
      const name = row && row.createUserName ? String(row.createUserName) : null;
      if (!name) return { loggedIn: false, reason: '读不到账号名(可能这个账号还没有上架记录)' + (lastErr ? (' · ' + lastErr) : '') };
      const g = await IFAPI.get('/amazon/selling//user/selling.json').catch(() => null);
      const groups = (((g && g.data) || [])).map((x) => ({ id: x.id, name: x.name || '', onSale: x.onSaleDesc || '', offSale: x.offSaleDesc || '' }));
      return { loggedIn: true, name, userId: row.userId || null, countries: [row.country || null].filter(Boolean), sellingGroups: groups, listedCount: r.count || null };
    } catch (e) { return { loggedIn: false, reason: String((e && e.message) || e) }; }
  }
  function recordShop(info, cb) {
    try {
      chrome.storage.local.get(['shops'], (o) => {
        const shops = (o && o.shops && typeof o.shops === 'object') ? o.shops : {};
        const now = new Date().toISOString().slice(0, 16).replace('T', ' ');
        /* ★ 2026-10-07 修【同一账号被拆成两个"店铺"】:
         *   createUserName 是【操作人名字】, 不是账号名 —— 实测同一个账号(userId=50023112287472)下,
         *   有的记录 createUserName="王祖杰", 有的="xiaotang"(换人/换子账号操作)。
         *   而店铺标识原来直接用 createUserName → 一旦 detectShop 读到的第一条恰好是别人创建的,
         *   店铺名就会翻成 "xiaotang", 上架器/记录筛选立刻切到另一个"店铺", 用户看到的是【记录全没了】。
         *   改为: 先用 userId 在本机已记录的店铺里找同名账号 → 沿用已记录的名字(名字只在首次确定, 后续不跟着变)。
         *   userId 拿不到时才回退到 createUserName。 */
        const byUser = (info.userId != null)
          ? Object.keys(shops).find((k) => String(shops[k].userId == null ? '' : shops[k].userId) === String(info.userId))
          : null;
        const key = byUser || info.name;
        if (byUser && byUser !== info.name) {
          try { log2('· 同一账号(userId ' + info.userId + ')的操作人名是「' + info.name + '」, 沿用已记录的店铺名「' + byUser + '」(避免被拆成两个店铺)'); } catch (e) {}
        }
        const prev = shops[key] || null;
        const countries = Array.from(new Set([].concat((prev && prev.countries) || [], info.countries || []).filter(Boolean)));
        const gm = new Map();
        ((prev && prev.sellingGroups) || []).concat(info.sellingGroups || []).forEach((x) => gm.set(String(x.name || x.id), x));
        const alias = Array.from(new Set([].concat((prev && prev.alias) || [], info.name ? [info.name] : []).filter((x) => x && x !== key)));
        shops[key] = {
          name: key, userId: info.userId || (prev && prev.userId) || null,
          alias: alias,
          countries: countries, sellingGroups: Array.from(gm.values()),
          firstSeen: (prev && prev.firstSeen) || now, lastSeen: now,
          listedCount: info.listedCount != null ? info.listedCount : ((prev && prev.listedCount) || null),
        };
        const isNew = !prev;
        chrome.storage.local.set({ shops: shops, currentShop: key }, () => {
          if (isNew) { try { setMsg('🆕 发现新店铺「' + key + '」，已记录到本机(设置页可删除)', true); } catch (e) {} }
          /* ★ 多店铺隔离 (2026-10-06): 顺带把店铺报给 ERP(后端 shops.json) —— ERP 侧据此知道
           *   "当前是哪个店铺", 上架记录/上传日志/归档的默认筛选都用它。老后端没有这个路由 → 404,
           *   静默忽略(本机 chrome.storage 已经记了, 功能不受影响)。 */
          try {
            chrome.runtime.sendMessage({ type: 'SHOP_REGISTER' }, (rr) => {
              const le = chrome.runtime.lastError;      // ★ 必须读: 否则"后台没回"会变成 Unchecked runtime.lastError
              if (le) { try { log2('· 店铺同步 ERP 未响应: ' + (le.message || '端口已关') + '（刷新本页可恢复）') } catch (e) {} return }
              if (rr && rr.ok) { if (isNew || rr.changed) { try { log2('🏬 店铺「' + key + '」已同步给 ERP' + (rr.throttled ? '(节流)' : '')); } catch (e) {} } }
              else if (rr && !rr.soft) { try { log2('· 店铺同步 ERP 失败: ' + (rr.error || '?')); } catch (e) {} }
            });
          } catch (e) {}
          if (cb) cb(shops[key], isNew);
        });
      });
    } catch (e) {}
  }
  async function refreshShop() {
    const info = await detectShop();
    if (!info.loggedIn) {
      curShop = null;
      try { chrome.storage.local.set({ currentShop: null }); } catch (e) {}
      const m = document.getElementById('zying-br-meta');
      if (m) m.innerHTML = '<span style="color:#e0b25c">未登录 ifast —— 请先登录后再使用上架器</span>';
      /* ★ 2026-10-07: 同时让表体也显示登录提示(而不是停留在上一次的记录/空表) */
      try { render(); } catch (e) {}
      return { loggedIn: false, reason: info.reason };
    }
    recordShop(info, (shop) => {
      curShop = shop;
      const m = document.getElementById('zying-br-meta');
      if (m) m.innerHTML = '店铺: <b>' + shop.name + '</b>' + (shop.countries.length ? (' · ' + shop.countries.join('/')) : '') + (shop.listedCount != null ? (' · 已上架 ' + shop.listedCount) : '');
      /* ★ 2026-10-07: 登录态到位后【立刻】拉一次记录。
       *   原来只有 20 秒的定时刷新, 所以刚打开页面时会看到"0 条 · 待填 0 · 已上架 0 · 失败 0",
       *   用户会以为【上架器根本没有记录 / 上架任务没执行】(实测踩到)。 */
      setTimeout(() => { refresh().catch(() => {}); }, 60);
    });
    return { loggedIn: true, shop: info };
  }

  /* ★ 2026-10-07 清理: 删掉这里的"第二个 onMessage 监听器"空壳(里面只有一个 `__NEVER__` 分支,
   *   永远走不到)。它正是 A15 记的那个坑: 同一上下文有两个监听器时 Chrome 只认第一个响应 ——
   *   任何注册在第二个上的能力都会静默失效(实测 IFAST_LISTING / 设置页「立即检测登录」都栽过)。
   *   规范保持: 一个上下文只允许一个 onMessage 监听器(能力都注册在上面那个主监听器里)。
   *   同时删掉 window.__zyingBridge(load/publish/refresh 的调试出口) —— 全仓库零引用;
   *   面板按钮走的就是同一批函数, 需要时直接在隔离世界调 __zvBridge。 */
  loadSettings();   // ★ 启动就读一次行为设置(自动提交总开关)

  /* ★ 2026-09-26 自测入口(与 content.js 的 window.__zyWatch / popup 的 window.__zy 同类):
   *   为什么要它: 面板按钮取的是"第一条待填任务", 验证时没法精确指定要用哪一条虚拟数据、
   *   也没法只填不提交。这里把 doFillFlow 原样暴露出来, 参数与内部完全一致:
   *     __zvBridge.fill({ autoSubmit:false, taskId:'B0TESTFILL@uk' })   ← 只填不上架
   *     __zvBridge.fill({ autoSubmit:true,  taskId:'B0TESTFILL@uk' })   ← 填完点保存
   *   不影响正常功能(不调用它就什么都不会发生)。 */
  window.__zvBridge = {
    /** ★ 构建标记: 用来确认"我连的是哪个实例"(扩展重载后老页面里的实例可能还在) */
    ver: '2.7.5',
    fill: (o) => doFillFlow(o || {}),
    /** ★ 2026-10-07 回读 ifast 真相: __zvBridge.ifastListing('B0GYF76ZJX')
     *  → {exists, createTime, createUserName, siteId, country, sellingId, id, sku} */
    ifastListing: (asin, site) => IFAPI.listingOf(asin, site),
    /** ★ 提交前探活(调试用): __zvBridge.sessionProbe() → {ok, why, count} */
    sessionProbe: () => IFAPI.probeSession(),
    /** 当前弹窗(ifast item_add.html)的 document, 没有就 null */
    addDoc: () => {
      const f = [...document.querySelectorAll('iframe')].find((x) => /item_add\.html/.test(x.getAttribute('src') || '') && x.contentDocument);
      return f ? f.contentDocument : null;
    },
    /** 保存按钮的可视性判定结果(验证"点保存"这道关时用) */
    saveButtons: () => {
      const f = [...document.querySelectorAll('iframe')].find((x) => /item_add\.html/.test(x.getAttribute('src') || '') && x.contentDocument);
      const d = f ? f.contentDocument : document;
      const r = zvFindSaveButton(d);
      return { visible: r.n, totalInDoc: r.all, texts: (r.btns || []).map((b) => t2(b)) };
    },
    /** 面板上现在显示什么 + 还有几条待填 */
    state: () => ({
      msg: (document.getElementById('zying-br-msg') || {}).textContent || null,
      todoN: todoN, lastFilledId: lastFilledId,
      addDialogOpen: !!window.__zvBridge.addDoc(),
    }),
    /** 提交结果判定用到的三个信号(排障用): 收集到的提示文本 / 弹窗还在不在 / 抓到的接口返回 */
    submit: () => {
      const d = window.__zvBridge.addDoc();
      let ajax = null, watched = null, ajaxErr = null;
      try {
        if (d && d.defaultView) { watched = !!d.defaultView.__zvAjaxWatched; ajax = d.defaultView.__zvAjaxResult || null; }
      } catch (e) { ajaxErr = String((e && e.message) || e) }
      return {
        msgs: zvCollectMsgs(),
        logged: zvReadIframeMsgs(),                       // ★ 提示记录器攒下的(判定的主依据)
        hasLogNode: (function () { try { return !!document.getElementById('zying-msg-log') } catch (e) { return 'ERR' } })(),
        stillOpen: [...document.querySelectorAll('iframe')].some((x) => /item_add\.html/.test(x.getAttribute('src') || '')),
        ajaxWatched: watched, ajax: ajax, ajaxErr: ajaxErr,
        iframeCount: document.querySelectorAll('iframe').length,
      };
    },
  };
})();

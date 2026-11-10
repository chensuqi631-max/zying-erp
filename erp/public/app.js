/* ===== 亚马逊跟卖ERP Demo — 前端逻辑 ===== */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const API = async (path, opts = {}) => {
  const r = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const j = await r.json();
  // 非 2xx → 抛错, 前端 catch 显示真实错误 (避免出现 ✅ + undefined)
  if (!r.ok) throw new Error(j.error || ('请求失败 (' + r.status + ')'));
  return j;
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtMoney = (n, cur) => {
  if (n == null) return '-';
  const sym = { GBP: '£', USD: '$', EUR: '€', JPY: '¥', CAD: 'C$', INR: '₹', MXN: 'MX$', AUD: 'A$', PLN: 'zł', SEK: 'kr', SAR: 'SAR', SGD: 'S$', BRL: 'R$', TRY: '₺' }[cur] || (cur ? cur + ' ' : '£');
  return sym + Number(n).toFixed(2);
};
const fmtNum = (n) => (n == null ? '-' : Number(n).toLocaleString());

/* ===== 系统内部弹窗 (替代 alert/prompt/confirm) ===== */
let modalSeq = 0;
function showModal({ title = '提示', body = '', buttons = [{ label: '确定', primary: true, value: 'ok' }], onResult = () => {} }) {
  const id = 'zyModal' + (++modalSeq);
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  mask.id = id;
  mask.innerHTML = `
    <div class="modal" style="max-width:${buttons.some((b) => b.form) ? '520px' : '420px'}">
      <div class="modal-head">
        <h2>${esc(title)}</h2>
        <button class="modal-close" data-act="close">✕</button>
      </div>
      <div class="modal-body">
        <div class="zy-modal-content">${body}</div>
        <div class="toolbar" style="justify-content:flex-end;margin:16px 0 0">
          ${buttons.map((b) => `<button class="btn ${b.primary ? 'primary' : ''}" data-act="${esc(b.value)}" data-form="${b.form ? '1' : ''}">${esc(b.label)}</button>`).join('')}
        </div>
      </div>
    </div>`;
  document.body.appendChild(mask);
  const close = (result) => {
    const inputs = {};
    mask.querySelectorAll('[data-field]').forEach((el) => { inputs[el.dataset.field] = el.value; });
    mask.remove();
    onResult(result === 'close' ? null : result, inputs);
  };
  mask.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (btn) { close(btn.dataset.act); return; }
    if (e.target === mask) close('close');
  });
  // 表单输入框回车确认
  mask.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('[data-field]')) {
      const ok = mask.querySelector('[data-act][data-form]');
      if (ok) ok.click();
    }
  });
  return id;
}
// 大图灯箱: 点击主图放大查看
/** 商品列表状态记忆（页码 / 每页条数）—— 刷新页面、切走再回来都停在当前页 */
const PM_LIST_KEY = 'zying.products.list.v1';
function readPmList() {
  try { return JSON.parse(window.localStorage.getItem(PM_LIST_KEY) || '{}') || {} } catch (e) { return {} }
}
function writePmList(patch) {
  try {
    const s = readPmList();
    Object.keys(patch || {}).forEach((k) => { s[k] = patch[k]; });
    window.localStorage.setItem(PM_LIST_KEY, JSON.stringify(s));
  } catch (e) { /* 隐私模式/策略禁用 → 不记忆, 不影响列表 */ }
}

/**
 * 亚马逊主图取高清版: 缩略图 URL 里的尺寸修饰符(`._AC_UY218_.jpg`)换成 `._AC_SL1500_.jpg`。
 * 悬停预览 / 放大镜都必须用它 —— 直接放大 218px 缩略图只会得到一张糊图。
 * 非亚马逊图床原样返回(没有这套修饰符, 硬加会 404)。
 */
function hiResImg(url, px) {
  const u = String(url == null ? '' : url).trim();
  if (!u || !/amazon\.com\/images\//i.test(u)) return u;
  const size = px || 1500;
  if (/\._[^./]*_\.(jpg|jpeg|png|webp|gif)$/i.test(u)) return u.replace(/\._[^./]*_\.(jpg|jpeg|png|webp|gif)$/i, '._AC_SL' + size + '_.$1');
  if (/\.(jpg|jpeg|png|webp|gif)$/i.test(u)) return u.replace(/\.(jpg|jpeg|png|webp|gif)$/i, '._AC_SL' + size + '_.$1');
  return u;
}

/** 主图放大镜灯箱: 高清原图 + 圆形镜片跟随放大 + 滚轮/按钮换倍率 */
function openImageLightbox(src, title = '') {
  const big = hiResImg(src, 1500);
  const mask = document.createElement('div');
  mask.className = 'modal-mask img-lightbox';
  mask.innerHTML = `
    <div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:99999;background:rgba(0,0,0,.86)" data-act="bg">
      <div style="background:#1b1b1f;border:1px solid #3a3a44;border-radius:12px;padding:12px;max-width:94vw">
        <div style="color:#e8e8ee;font-size:13px;font-weight:600;margin-bottom:8px;display:flex;gap:10px;align-items:center">
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">🔍 ${esc(title || '主图')}</span>
          <span data-act="zoom" style="display:flex;gap:4px"></span>
          <button data-act="close" style="background:none;border:1px solid #3a3a44;color:#aaa;border-radius:6px;cursor:pointer;padding:2px 8px">✕</button>
        </div>
        <div style="position:relative;width:min(760px,90vw);height:min(560px,72vh);background:#fff;border-radius:8px;overflow:hidden;cursor:crosshair" data-act="stage">
          <img src="${esc(big)}" alt="${esc(title)}" style="width:100%;height:100%;object-fit:contain" draggable="false">
          <div data-act="box" style="position:absolute;border:1px solid rgba(120,170,255,.9);background:rgba(120,170,255,.12);border-radius:4px;pointer-events:none;display:none"></div>
          <div data-act="lens" style="position:absolute;width:190px;height:190px;border-radius:50%;border:2px solid #4f8cff;box-shadow:0 6px 20px rgba(0,0,0,.6);background-repeat:no-repeat;pointer-events:none;display:none"></div>
        </div>
        <div style="color:#8b93a3;font-size:12px;margin-top:8px">鼠标移到图上 → 镜片跟随放大 · 滚轮 / 点上方倍率换档 · 点背景或 ✕ 关闭 · 用 1500px 原图</div>
      </div>
    </div>`;
  document.body.appendChild(mask);
  const stage = mask.querySelector('[data-act="stage"]');
  const box = mask.querySelector('[data-act="box"]');
  const lens = mask.querySelector('[data-act="lens"]');
  const zWrap = mask.querySelector('[data-act="zoom"]');
  let z = 2.5;
  const paintZoom = () => {
    zWrap.innerHTML = [1.5, 2, 2.5, 3, 4, 6].map((v) => `<button data-z="${v}" style="background:${v === z ? '#2f6feb' : 'none'};border:1px solid ${v === z ? '#2f6feb' : '#3a3a44'};color:${v === z ? '#fff' : '#aaa'};border-radius:6px;cursor:pointer;padding:2px 7px">${v}x</button>`).join('');
    zWrap.querySelectorAll('[data-z]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); z = Number(b.dataset.z); paintZoom(); move(lastEv); }));
  };
  let lastEv = null;
  const move = (e) => {
    if (!e) return;
    lastEv = e;
    const r = stage.getBoundingClientRect();
    const x = Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100));
    const y = Math.min(100, Math.max(0, ((e.clientY - r.top) / r.height) * 100));
    const w = 100 / z;
    box.style.display = 'block'; lens.style.display = 'block';
    box.style.width = w + '%'; box.style.height = w + '%';
    box.style.left = 'calc(' + x + '% - ' + w / 2 + '%)'; box.style.top = 'calc(' + y + '% - ' + w / 2 + '%)';
    lens.style.left = 'calc(' + x + '% - 95px)'; lens.style.top = 'calc(' + y + '% - 95px)';
    lens.style.backgroundImage = 'url(' + big + ')';
    lens.style.backgroundSize = (z * 100) + '% auto';
    lens.style.backgroundPosition = x + '% ' + y + '%';
  };
  stage.addEventListener('mousemove', move);
  stage.addEventListener('mouseleave', () => { box.style.display = 'none'; lens.style.display = 'none'; });
  stage.addEventListener('wheel', (e) => { e.preventDefault(); z = Math.min(6, Math.max(1.5, Math.round((z + (e.deltaY < 0 ? 0.5 : -0.5)) * 2) / 2)); paintZoom(); move(e); }, { passive: false });
  const close = () => { mask.remove(); document.removeEventListener('keydown', escKey); };
  const escKey = (e) => { if (e.key === 'Escape') close(); };
  mask.addEventListener('click', (e) => { if (e.target.dataset.act === 'bg' || e.target.dataset.act === 'close') close(); });
  document.addEventListener('keydown', escKey);
  paintZoom();
}

/** 站点 → amazon 域名(与后端 siteToHostSuffix 同表) */
function amzHostOf(site) {
  return 'www.amazon.' + ({ uk: 'co.uk', us: 'com', jp: 'co.jp', au: 'com.au', mx: 'com.mx', br: 'com.br', sg: 'com.sg', tr: 'com.tr', ae: 'ae', sa: 'sa', nl: 'nl', se: 'se', pl: 'pl', de: 'de', fr: 'fr', it: 'it', es: 'es', ca: 'ca', in: 'in' }[site] || site || 'de');
}
/**
 * 一个商品身上所有可打开的链接(去重)。
 * 覆盖: 商品页 / 品牌页 / 品牌店 / 卖家页 / 卖家店铺 / 1688 同款 ——
 * 不同采集方式写入的字段名不完全一致(brandLink·brandUrl、sellerLink·sellerUrl、is1688Url), 都兜一遍。
 */
function productLinksOf(p) {
  const out = [], seen = {};
  const add = (label, url) => {
    const u = String(url == null ? '' : url).trim();
    if (!u || !/^https?:/i.test(u) || seen[u]) return;
    seen[u] = 1;
    out.push({ label, url: u });
  };
  add('商品页', 'https://' + amzHostOf(p.site) + '/dp/' + p.asin);
  add('品牌页', p.brandLink || p.brandUrl);
  add('卖家页', p.sellerLink || p.sellerUrl || (p.sellerId ? 'https://' + amzHostOf(p.site) + '/sp?seller=' + p.sellerId : ''));
  add('1688 同款', p.is1688Url);
  return out;
}
/**
 * 打开一批商品的所有链接(逐个交给系统默认浏览器; 用 /api/open 而不是 window.open,
 * 因为连续 window.open 会被浏览器当弹窗拦截)。
 */
async function openProductsLinks(products) {
  const all = [];
  const seen = {};                          // ★ 跨商品全局去重: 多个商品共用同一品牌页/卖家页时只开一次
  products.forEach((p) => productLinksOf(p).forEach((l) => {
    if (seen[l.url]) return;
    seen[l.url] = 1;
    all.push(Object.assign({ asin: p.asin }, l));
  }));
  if (!all.length) { await zyAlert('没有可打开的链接', '所选商品没有商品页/品牌页/卖家页/1688 链接'); return 0 }
  const LIMIT = 60;                       // 防手滑: 50 商品 × 4 链接 = 200 标签页会把浏览器打死
  const willOpen = all.slice(0, LIMIT);
  const byKind = {};
  all.forEach((l) => { byKind[l.label] = (byKind[l.label] || 0) + 1; });
  const kinds = Object.keys(byKind).map((k) => k + ' ' + byKind[k]).join(' · ');
  const okGo = await zyConfirm('🔗 打开所选商品的所有链接',
    `将打开 <b>${willOpen.length}</b> 个链接（${products.length} 个商品：${kinds}）`
    + (all.length > LIMIT ? `<br><span style="color:#b00020">另有 ${all.length - LIMIT} 个超出上限(${LIMIT})未打开</span>` : '')
    + '<br>系统默认浏览器会逐个新开标签页。');
  if (!okGo) return 0;
  let opened = 0;
  for (const l of willOpen) {
    try {
      await API('/api/open?url=' + encodeURIComponent(l.url));
      opened++;
    } catch (e) { /* 单个失败不影响其余 */ }
    await new Promise((r) => setTimeout(r, 220));   // 稍微错开, 别让浏览器把连续弹窗当垃圾
  }
  await zyAlert('✔ 已打开链接', `共打开 <b>${opened}</b> 个链接`
    + (all.length > LIMIT ? `<br><span class="muted">超出上限的 ${all.length - LIMIT} 个未打开</span>` : ''));
  return opened;
}

/* 主图悬停预览已按需求删除(2026-09): 悬停弹出浮层容易误挡视线, 商品图现在只保留
   「点击 → 放大镜灯箱」这一种交互。原 bindMainImageHover() 整段移除。 */

// 消息框 (替代 alert)
function zyAlert(title, message = '') {
  return new Promise((resolve) => {
    showModal({
      title: title || '提示',
      body: message ? `<div style="line-height:1.7">${message}</div>` : '',
      buttons: [{ label: '确定', primary: true, value: 'ok' }],
      onResult: (r) => resolve(r === 'ok'),
    });
  });
}
// 确认框 (替代 confirm)
function zyConfirm(title, message = '') {
  return new Promise((resolve) => {
    showModal({
      title: title || '确认',
      body: message ? `<div style="line-height:1.7">${message}</div>` : '',
      buttons: [
        { label: '取消', value: 'no' },
        { label: '确定', primary: true, value: 'yes' },
      ],
      onResult: (r) => resolve(r === 'yes'),
    });
  });
}
// 表单输入框 (替代 prompt): fields = [{field,label,placeholder,default,type,options}]
function zyPromptForm(title, fields, opts = {}) {
  return new Promise((resolve) => {
    const rows = fields.map((f) => {
      if (f.divider) return `<div style="margin:14px 0 10px;padding-top:10px;border-top:1px solid #e5e5e5;font-weight:600;color:var(--muted)">${esc(f.divider)}</div>`;
      const label = f.label ? `<div class="muted" style="margin-bottom:4px">${esc(f.label)}</div>` : '';
      let input;
      if (f.type === 'select' && f.options) {
        input = `<select class="select" data-field="${esc(f.field)}" style="width:100%">${f.options.map((o) => `<option value="${esc(o.value)}" ${o.value == f.default ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
      } else if (f.type === 'number') {
        input = `<input class="input" type="number" data-field="${esc(f.field)}" placeholder="${esc(f.placeholder || '')}" value="${esc(f.default != null ? f.default : '')}" style="width:100%">`;
      } else {
        input = `<input class="input" type="text" data-field="${esc(f.field)}" placeholder="${esc(f.placeholder || '')}" value="${esc(f.default != null ? f.default : '')}" style="width:100%">`;
      }
      return `<div style="margin-bottom:12px">${label}${input}</div>`;
    }).join('');
    showModal({
      title: title || '输入',
      body: `<div class="zy-modal-form">${rows}${opts.hint ? `<div class="muted" style="margin-top:4px">${esc(opts.hint)}</div>` : ''}</div>`,
      buttons: [
        { label: '取消', value: 'no' },
        { label: '确定', primary: true, value: 'ok', form: true },
      ],
      onResult: (r, inputs) => {
        if (r === 'ok') {
          const vals = {};
          fields.forEach((f) => { if (f.divider) return; vals[f.field] = inputs[f.field] ?? f.default; });
          resolve(vals);
        } else {
          resolve(null);
        }
      },
    });
  });
}

/* ===== 主题切换 ===== */
function initTheme() {
  const btn = $('#themeToggle');
  const apply = () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    $('#themeIcon').textContent = dark ? '🌙' : '☀️';
    $('#themeLabel').textContent = dark ? '暗色' : '亮色';
  };
  btn.addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme;
    document.documentElement.dataset.theme = cur === 'dark' ? 'light' : 'dark';
    localStorage.setItem('zying-theme', document.documentElement.dataset.theme);
    apply();
  });
  const saved = localStorage.getItem('zying-theme');
  if (saved) { document.documentElement.dataset.theme = saved; }
  apply();
}

/* ===== 悬浮气泡 ===== */
const tooltip = $('#tooltip');
function showTooltip(e, title, desc) {
  tooltip.innerHTML = `<div class="tt-title">${esc(title)}</div>${desc ? `<div>${esc(desc)}</div>` : ''}`;
  tooltip.classList.remove('hidden');
  const pad = 14;
  let x = e.clientX + pad, y = e.clientY + pad;
  const tw = tooltip.offsetWidth, th = tooltip.offsetHeight;
  if (x + tw > window.innerWidth - 8) x = e.clientX - tw - pad;
  if (y + th > window.innerHeight - 8) y = e.clientY - th - pad;
  tooltip.style.left = x + 'px';
  tooltip.style.top = y + 'px';
}
function hideTooltip() { tooltip.classList.add('hidden'); }

/* ===== 导航 ===== */
/* ===== 线性 SVG 图标系统 (Apple SF Symbols 风格: 细描边/圆角端点/当前色) ===== */
const ICONS = {
  workbench: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  collect: '<path d="M12 3v12"/><path d="m7 8 5-5 5 5"/><path d="M4 13v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/>',
  product: '<path d="M21 8.5 12 3 3 8.5v7L12 21l9-5.5z"/><path d="M3 8.5 12 14l9-5.5"/><path d="M12 14v7"/>',
  compliance: '<path d="M12 3 5 6v5c0 4.5 3 8.5 7 10 4-1.5 7-5.5 7-10V6z"/><path d="m9 12 2 2 4-4"/>',
  ipcheck: '<path d="M12 3 5 6v5c0 4.5 3 8.5 7 10 4-1.5 7-5.5 7-10V6z"/><circle cx="12" cy="10.5" r="2.6"/><path d="m14 12.5 2.2 2.2"/>',
  claims: '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/>',
  reprice: '<path d="M12 2v20"/><path d="M5 6h10a3 3 0 0 1 0 6H9a3 3 0 0 0 0 6h10"/>',
  flywheel: '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/>',
  agent: '<path d="M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15.5l-1.9-4.6L5.5 9l4.6-1.4z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z"/><path d="M5 16l.7 1.6L7.3 18l-1.6.7L5 20.3l-.7-1.6L2.7 18l1.6-.4z"/>',
  knowledge: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 0 4 4.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>',
  notify: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  send: '<path d="m22 2-11 11"/><path d="M22 2 15 22l-4-9-9-4z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6M14 11v6"/>',
  setting: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 1 1.5h0a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.5 1z"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/>',
  chevronLeft: '<path d="m15 18-6-6 6-6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  bolt: '<path d="M13 2 3 14h7l-1 8 10-12h-7z"/>',
  store: '<path d="M3 9 4.5 4h15L21 9"/><path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0"/><path d="M5 12v8h14v-8"/>',
  layers: '<path d="m12 3 9 5.5L12 14 3 8.5z"/><path d="m3 13 9 5.5 9-5.5"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  logistics: '<path d="M3 7h11v10H3z"/><path d="M14 10h4l3 3v4h-7z"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/><path d="M9 17h6"/>',
};
const ic = (name, size = 16) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px">${ICONS[name] || ''}</svg>`;

const PAGES = {
  workbench: { title: '工作台', desc: '对话式操作系统: 通过对话调取数据、找商品、执行任务', icon: 'workbench' },
  collect: { title: '商品采集', desc: '6 种采集方式小模块 + 采集过滤(与自定义筛选同条件, 可保存规则), 全程CDP', icon: 'collect' },
  product: { title: '商品管理', desc: '采集到的商品数据: 列表/筛选/详情/批量操作', icon: 'product' },
  compliance: { title: '合规检测', desc: 'RAG 合规检测: 品牌库/专利库/规则库检索, 品牌监控与风险预警', icon: 'compliance' },
  ipcheck: { title: '知产查重', desc: '上架风控: 品牌名/商品链接 → 按目标站点辖区查官方商标库(WIPO·EUIPO·USPTO), 判能不能上', icon: 'ipcheck' },
  claims: { title: '批量刊登', desc: '批量认领与刊登: 草稿箱编辑, 多店铺批量发布, 失败重发', icon: 'claims' },
  reprice: { title: '智能调价', desc: '15分钟自动跟价抢购物车, 保底价+差额, 策略自优化', icon: 'reprice' },
  flywheel: { title: '数据飞轮', desc: '合规/定价/选品/话术四轮驱动, 系统越用越聪明', icon: 'flywheel' },
  agent: { title: 'AI Agent', desc: '选品评估/合规审查/调价策略, 人工采纳或拒绝', icon: 'agent' },
  knowledge: { title: '知识库', desc: '品牌库/合规规则/定价策略/话术库统一管理', icon: 'knowledge' },
  logistics: { title: '物流工具', desc: '报价表维护与试算 (首重/续重), 集货发货', icon: 'logistics' },
  notify: { title: '消息通知', desc: '飞书/企微集成: 异常通知, 日报推送, 远程指令', icon: 'notify' },
  listing: { title: '上架记录', desc: '插件从 Amazon 详情页采集的上架清单 (与商品管理库物理隔离); 上品工具 ifast.top 可直接读取', icon: 'claims' },
  archive: { title: '选品归档', desc: '把最终选出来的品连同当时的承受价/利润率存成快照: 可检索 / 可去重 / 可导出文件', icon: 'file' },
  selection: { title: '蓝海选品', desc: '榜单/搜索页 → 一次读出评论·品牌·重量·自营 → 五维评分 + 候选品 → 导出/入库', icon: 'grid' },
};

function navigate(page) {
  $$('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.page === page));
  const meta = PAGES[page];
  $('#pageTitle').innerHTML = (meta.icon ? ic(meta.icon, 17) + ' ' : '') + meta.title;
  $('#pageDesc').textContent = meta.desc;
  const render = { workbench: renderWorkbench, collect: renderCollect, product: renderProduct, compliance: renderCompliance, ipcheck: renderIpCheck, claims: renderClaims, reprice: renderReprice, flywheel: renderFlywheel, agent: renderAgent, knowledge: renderKnowledge, logistics: renderLogistics, notify: renderNotify, listing: renderListing, archive: renderArchive, selection: renderSelection }[page];
  render();
}

/* ===== 工作台 ===== */
const WORKBENCH_DEFAULT = [
  { id: 'collect', emoji: '📡', name: '商品采集', desc: '双通道多维度采集: 类目/店铺/ASIN反查/关键词/僵尸采集, 后台自动执行', meta: 'P0 · 采集效率10x', page: 'collect' },
  { id: 'compliance', emoji: '🛡️', name: '品牌监控与风险预警', desc: 'RAG 合规检测: 品牌备案/BG标/TM标/专利风险, 带引用依据, 规则自动沉淀', meta: 'P0 · 准确率≥95%', page: 'compliance' },
  { id: 'claims', emoji: '📦', name: '批量刊登/认领', desc: '批量认领、ASIN裂变、草稿箱批量编辑、多店铺批量发布、状态监控', meta: 'P0 · ≥100店铺并发', page: 'claims' },
  { id: 'reprice', emoji: '🏷️', name: '智能调价', desc: '目标价=最低价-差额, 15分钟自动调价抢占购物车, 策略自优化', meta: 'P0 · 成功率≥98%', page: 'reprice' },
  { id: 'agent', emoji: '🤖', name: 'AI Agent 助手', desc: '选品评估师/合规审查员/调价策略师/运营分析师/智能客服', meta: 'P0 · 响应<10s', page: 'agent' },
  { id: 'flywheel', emoji: '🔄', name: '数据飞轮自学习', desc: '反馈回流+规则自动进化: 合规/定价/选品/话术四轮驱动', meta: 'P1 · 规则沉淀<24h', page: 'flywheel' },
  { id: 'edit', emoji: '✏️', name: '批量编辑与商品处理', desc: '批量翻译/抠白底图/一键拉伸/敏感词检测/SKU生成/模板套用', meta: 'P1', page: 'workbench' },
  { id: 'order', emoji: '🚚', name: '订单管理与物流跟踪', desc: '订单同步/三仓发货/物流追踪/订单拦截/错漏发补偿', meta: 'P1 · 72h时效', page: 'workbench' },
  { id: 'pricing', emoji: '🧮', name: '定价模板与利润预估', desc: '净收益自动计算/利润计算器/多站点多币种/防亏本定价', meta: 'P1', page: 'workbench' },
  { id: 'product', emoji: '🗃️', name: '产品库管理', desc: 'SKU生成/SPU管理/UPC豁免/变体管理/属性模板', meta: 'P1', page: 'workbench' },
  { id: 'knowledge', emoji: '📚', name: '知识库与规则库', desc: '品牌库/合规规则/运营SOP/话术库/定价策略库统一管理', meta: 'P1 · 版本回滚', page: 'knowledge' },
  { id: 'feishu', emoji: '💬', name: '飞书/企微集成', desc: '异常通知/日报推送/远程指令/远程审批, 人在外面店铺照管', meta: 'P2 · 延迟<1min', page: 'notify' },
  { id: 'schedule', emoji: '⏰', name: '定时上下架', desc: '单上单下/多上多下/定时策略/后台监控/多时区', meta: 'P2', page: 'workbench' },
  { id: 'multi', emoji: '🌐', name: '多平台多店铺管理', desc: '亚马逊/美客多/TK/Ozon/沃尔玛, 店铺绑定不限数量', meta: 'P2', page: 'workbench' },
  { id: 'finance', emoji: '💰', name: '财务自动核算', desc: '订单成本汇总/利润自动计算/多币种/报表导出', meta: 'P2', page: 'workbench' },
  { id: 'wms', emoji: '🏭', name: '仓库管理 WMS', desc: '出入库/库存/备货/退货/拦截/多仓库/库存同步', meta: 'P3', page: 'workbench' },
];
let cardOrder = JSON.parse(localStorage.getItem('zying-cards') || 'null') || WORKBENCH_DEFAULT.map((c) => c.id);

/* ===== Agent 工作台: 对话式操作系统 (类似 DSH 界面) ===== */
const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');   // 本地时间戳 (会话/消息)
// 数据 (localStorage): zying-models 模型配置 | zying-curModel 当前模型 | zying-convs 会话
const DEFAULT_MODELS = [
  { id: 'm1', name: 'DeepSeek', baseURL: 'https://api.deepseek.com', model: 'deepseek-chat', apiKey: '' },
  { id: 'm2', name: 'OpenAI', baseURL: 'https://api.openai.com/v1', model: 'gpt-4o-mini', apiKey: '' },
];
function loadModels() {
  const raw = localStorage.getItem('zying-models');
  if (raw) { try { return JSON.parse(raw); } catch {} }
  // 首次访问: 持久化默认模型 (DeepSeek/OpenAI), 便于在「配置模型」中填写 API Key
  const defs = DEFAULT_MODELS.map((m) => ({ ...m }));
  localStorage.setItem('zying-models', JSON.stringify(defs));
  return defs;
}
function saveModels(models) { localStorage.setItem('zying-models', JSON.stringify(models)); }
function loadConvs() { return JSON.parse(localStorage.getItem('zying-convs') || 'null') || []; }
function saveConvs(convs) { localStorage.setItem('zying-convs', JSON.stringify(convs)); }
const escAgent = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// 工作台 AI 系统提示词: 描述系统能力 + 工具指令格式 (LLM 决定何时调用系统动作)
const AGENT_SYSTEM_PROMPT = `你是「智赢 ERP 跨境电商采集管理助手」。你拥有系统全部数据与操作能力, 可分析、筛选、执行采集。可用动作 (回复第一行输出 [[TOOL:动作参数]] 即会真实执行):
- 查看统计 / 系统状态 / 商品库数量 → [[TOOL:查看统计]]
- 找 / 搜索商品, 如"找 手机支架" → [[TOOL:找 手机支架]]
- 筛选商品 (支持组合条件: 配送FBA/FBM/AMZ、A+、价格区间、评分、月销、跟卖数、站点、关键词、无排名), 如"筛选 FBA 价格10-50 评分4以上 月销>500 的汽车配件" "筛选无排名的商品" "找出所有A+的商品" → [[TOOL:筛选 <条件>]]
- 商品详情, 如"详情 B0XXXXXXX" → [[TOOL:详情 B0XXXXXXX]]
- 数据分析/排行, 如"分析商品库" "销量前十" "跟卖最多的商品" "商标最多的品牌" → [[TOOL:分析 <问题>]]
- 风险检查, 如"哪些商品有商标风险" "已备案的品牌" → [[TOOL:风险]]
- 采集 Amazon 列表页, 如"采集 https://www.amazon.co.uk/s?k=Car+Accessories" → [[TOOL:采集 <完整URL>]]
- 筛选采集列表页, 如"筛选采集 <URL>" → [[TOOL:筛选采集 <URL>]]
- 合规检测, 如"合规检测 B0XXXXXXX" → [[TOOL:合规检测 B0XXXXXXX]]
- 调价, 如"调价" → [[TOOL:调价]]
- 认领商品, 如"认领 B0XXXXXXX" → [[TOOL:认领 B0XXXXXXX]]
- 删除商品 (单个或逗号分隔多个), 如"删除 B0XXXXXXX" "把月销为0的删掉" (可先筛选拿到列表再删) → [[TOOL:删除 <ASIN列表>]]
- 保存商品到产品库, 如"保存 B0XXXXXXX" → [[TOOL:保存 B0XXXXXXX]]
- 同步刷新商品数据 (价格/月销/跟卖数), 如"同步 B0XXXXXXX" → [[TOOL:同步 B0XXXXXXX]]
- 清空商品库 (⚠ 不可逆, 仅在用户明确要求"清空商品库/清空全部"时使用) → [[TOOL:清空商品库]]
规则:
1. 用户指令可由上述动作完成时, **回复第一行必须是 [[TOOL:动作参数]]** (不加 markdown 代码块, 不加其他格式), 后续可加简短说明。若第一行不是工具标记, 系统不会执行任何操作, 任务将失败。
2. 批量删除类任务分两步: 先 [[TOOL:筛选 <条件>]] 拿到返回中的「全部 N 个 ASIN」列表, 再用 [[TOOL:删除 ASIN1,ASIN2,...]] 删除 (ASIN 直接取自筛选结果, 逗号分隔, 不要编造)。工具结果会回传给你, 可多步调用 (最多 5 步) 直到完成目标再给最终回复。
3. 分析/筛选类动作执行后, 你可以基于返回的数据再给用户解读、建议 (如选品方向、定价、风险提醒)。
4. 无法用动作完成时, 用自然语言正常回答 (可提供亚马逊选品/跟卖/合规/运营建议等), 中文简洁。
5. 采集类动作必须带上完整的 https:// 链接, 不得编造。

完整示例 (批量删除):
用户: 把所有A+的商品删掉
助手: [[TOOL:筛选 A+的商品]] 我先筛出所有 A+ 商品
(工具返回含「全部 N 个 ASIN」列表)
助手: [[TOOL:删除 B0AAA12345,B0BBB23456,...]] 已拿到列表, 现在批量删除
助手: 已删除 N 个 A+ 商品, 商品库剩余 M 条。`;

// AI 对话: 调用后端代理 → DeepSeek/OpenAI 兼容接口; 回复含 [[TOOL:...]] 时执行系统动作
// (aiChat 定义在 renderWorkbench 内, 依赖其 agentExec 闭包; 此处仅保留系统提示词常量)
const AGENT_SYSTEM_PROMPT_FULL = AGENT_SYSTEM_PROMPT;

async function renderWorkbench() {
  const content = $('#content');
  let convs = loadConvs();
  if (!convs.length) convs = [{ id: 'c' + Date.now(), title: '新会话', createdAt: now(), messages: [], active: true }];
  let curModelId = localStorage.getItem('zying-curModel') || loadModels()[0].id;

  content.innerHTML = `
    <div class="agent-shell">
      <aside class="agent-sidebar" id="asSidebar">
        <div class="as-model">
          <div id="asAiStatus" class="as-ai-status" title="AI 对话模式状态">加载中…</div>
          <div class="as-mode" title="切换助手工作模式">
            <button class="mode-btn" data-mode="ai">AI 智能</button>
            <button class="mode-btn" data-mode="local">本地规则</button>
          </div>
          <div class="as-btn-row">
            <button id="asModelManage">AI 设置</button>
            <button id="asModelRefresh">检测系统</button>
          </div>
        </div>
        <button class="as-new" id="asNewConv" title="新会话">新会话</button>
        <div class="as-conv-list" id="asConvList"></div>
        <button class="as-collapse" id="asCollapse">« 折叠侧栏</button>
      </aside>
      <main class="agent-main">
        <div class="am-tabs">
          <button class="active" data-tab="chat">对话</button>
          <button data-tab="trace">轨迹</button>
        </div>
        <div class="am-chat" id="amChat"></div>
        <div class="am-trace" id="amTrace"></div>
        <div class="am-input">
          <textarea id="amInput" placeholder="输入指令: 查看统计 / 找商品 xxx / 采集 https://... / 合规检测 ASIN / 调价 / 帮助… (Enter 发送, Shift+Enter 换行)"></textarea>
          <button id="amSend">发送</button>
        </div>
      </main>
    </div>
  `;

  // ===== 会话工具 =====
  const curConv = () => convs.find((c) => c.active) || convs[0];
  const saveAll = () => saveConvs(convs);
  const renderConvList = () => {
    const box = $('#asConvList');
    box.innerHTML = convs.slice().reverse().map((c) => `
      <div class="as-conv ${c.active ? 'active' : ''}" data-cid="${c.id}">
        <span class="cv-title">${escAgent(c.title)}</span>
        <span class="cv-time">${(c.createdAt || '').slice(5, 16)}</span>
        <button class="cv-del" data-cid="${c.id}" title="删除会话">✕</button>
      </div>`).join('') || '<div style="padding:12px;color:var(--muted);font-size:12px">暂无会话</div>';
    box.querySelectorAll('.as-conv[data-cid]').forEach((el) => el.addEventListener('click', (e) => {
      if (e.target.closest('.cv-del')) return;
      convs.forEach((c) => (c.active = c.id === el.dataset.cid));
      saveAll(); renderChat(); renderConvList();
    }));
    box.querySelectorAll('.cv-del').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      convs = convs.filter((c) => c.id !== b.dataset.cid);
      if (!convs.length) convs = [{ id: 'c' + Date.now(), title: '新会话', createdAt: now(), messages: [], active: true }];
      saveAll(); renderChat(); renderConvList();
    }));
  };
  // 显示后端 AI 配置状态 (任何浏览器生效) + 当前工作模式
  const renderAiStatus = async () => {
    const el = $('#asAiStatus');
    if (!el) return;
    const mode = localStorage.getItem('zying-ai-mode') || 'ai';
    $$('.as-mode .mode-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    try {
      const cfg = await API('/api/ai/config');
      el.innerHTML = mode === 'ai'
        ? (cfg && cfg.configured
          ? `<span class="ai-dot on"></span> AI 智能 · ${escAgent(cfg.name || 'AI')} ${escAgent(cfg.model || '')}`
          : `<span class="ai-dot"></span> AI 模式未配置 Key`)
        : `<span class="ai-dot"></span> 本地规则模式`;
      el.classList.toggle('off', mode !== 'ai' || !(cfg && cfg.configured));
    } catch (e) {
      el.textContent = '状态读取失败';
    }
  };
  // 模式切换
  $$('.as-mode .mode-btn').forEach((b) => b.addEventListener('click', () => {
    localStorage.setItem('zying-ai-mode', b.dataset.mode);
    renderAiStatus();
  }));

  // ===== 消息渲染 (轻量 markdown: 表格/粗体) =====
  const renderBubble = (content) => {
    // 表格
    let h = escAgent(content);
    h = h.replace(/```([\s\S]*?)```/g, (m, code) => `<pre style="background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:10px;font-size:12px;overflow-x:auto">${code}</pre>`);
    // | a | b | 表格
    h = h.replace(/((?:\|.*\|(?:\r?\n|$))+)/g, (m) => {
      const rows = m.trim().split(/\r?\n/).map((r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
      const head = rows[0] || [];
      const body = rows.slice(1).filter((r) => r.some((c) => c && !/^[-:]+$/.test(c)));
      return '<table><thead><tr>' + head.map((c) => '<th>' + c + '</th>').join('') + '</tr></thead><tbody>' +
        body.map((r) => '<tr>' + r.map((c) => '<td>' + c + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
    });
    h = h.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    return h;
  };
  const renderChat = () => {
    const box = $('#amChat');
    if (!box) return;
    const c = curConv();
    const inputBar = document.querySelector('#amInput') ? document.querySelector('#amInput').closest('.am-input') : null;
    if (!c.messages.length) {
      if (inputBar) inputBar.style.display = 'none';
      box.innerHTML = `<div class="am-new">
        <div class="am-new-title">今天想让我帮你做什么？</div>
        <div class="am-new-input"><textarea id="amNewInput" placeholder="查看统计 · 找商品 · 采集列表页 · 合规检测 · 调价 · 认领…"></textarea></div>
        <div class="am-new-hint">Enter 发送 · Shift+Enter 换行</div>
      </div>`;
      const ni = document.querySelector('#amNewInput');
      if (ni) {
        ni.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
        setTimeout(() => ni.focus(), 60);
      }
      return;
    }
    if (inputBar) inputBar.style.display = 'flex';
    box.innerHTML = c.messages.map((m) => `
      <div class="msg ${m.role}">
        <div class="msg-avatar">${m.role === 'user' ? '我' : 'AI'}</div>
        <div class="msg-body">
          <div class="msg-bubble">${m.role === 'user' ? escAgent(m.content) : renderBubble(m.content)}</div>
          ${m.tools && m.tools.length ? `<div class="msg-tools">${m.tools.map((t) => `<span class="tool-chip">${t.ok ? '<span class="tc-ok">✓</span>' : '<span class="tc-err">✗</span>'} ${escAgent(t.name)} ${t.ms ? `(${t.ms}ms)` : ''}</span>`).join('')}</div>` : ''}
          <div class="msg-time">${(m.ts || '').slice(5, 19)}</div>
        </div>
      </div>`).join('');
    box.scrollTop = box.scrollHeight;
  };
  const renderTrace = () => {
    const box = $('#amTrace');
    if (!box) return;
    const c = curConv();
    const traces = [];
    c.messages.forEach((m) => (m.tools || []).forEach((t) => traces.push({ ...t, ts: m.ts })));
    if (!traces.length) { box.innerHTML = '<div class="trace-empty">暂无工具调用记录。发送对话后, 每次调取数据/执行任务都会记录在这里 (接口/参数/结果/耗时)。</div>'; return; }
    box.innerHTML = traces.slice().reverse().map((t) => `
      <div class="trace-item">
        <div class="tr-head"><span class="tr-name">${escAgent(t.name)}</span><span class="tr-status ${t.ok ? 'ok' : 'err'}">${t.ok ? '成功' : '失败'}</span><span style="flex:1"></span><span class="tr-time">${(t.ts || '').slice(5, 19)} · ${t.ms}ms</span></div>
        <div class="tr-args">参数: ${escAgent(t.args)}</div>
        <div class="tr-summary">${escAgent(t.summary).slice(0, 500)}</div>
      </div>`).join('');
  };
  const switchTab = (tab) => {
    $$('.am-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    $('#amChat').style.display = tab === 'chat' ? 'flex' : 'none';
    $('#amTrace').style.display = tab === 'trace' ? 'block' : 'none';
    if (tab === 'trace') renderTrace();
  };

  // ===== 本地 Agent: 意图解析 → 调系统接口 → 记录轨迹 =====
  const agentExec = async (text) => {
    const t = text.trim();
    const tools = [];
    const call = async (name, args, fn) => {
      const st = Date.now();
      try {
        const data = await fn();
        tools.push({ name, args: JSON.stringify(args), summary: JSON.stringify(data).slice(0, 600), ms: Date.now() - st, ok: true });
        return data;
      } catch (e) {
        tools.push({ name, args: JSON.stringify(args), summary: '失败: ' + (e && e.message || e), ms: Date.now() - st, ok: false });
        throw e;
      }
    };

    try {
      // ① 系统状态 / 统计概览
      if (/状态|健康|统计|概览|库存数|多少.*商品/.test(t)) {
        const [h, p] = await Promise.all([
          call('health', {}, () => API('/api/health')),
          call('products', {}, () => API('/api/products')),
        ]);
        return { content: `**系统状态**: ${h.ok ? '🟢 在线' : '🔴 离线'}\n**商品库**: ${p.total} 条\n\n可继续操作: 找商品 / 采集列表页 / 合规检测 / 调价 (输入"帮助"看全部能力)`, tools };
      }
      // ② 找 / 搜索商品 (排除 "查看" 等词, 避免误判; "所有/全部"归筛选)
      if ((/找|搜索|查找|查询|列出|查一查|有没有.*商品|商品.*有哪些/.test(t)) && !/所有|全部/.test(t)) {
        const qm = t.match(/(?:找|搜索|查|查一查|列出|查询)\s*[:：]?\s*([\u4e00-\u9fa5A-Za-z0-9\- ]{1,40})/);
        const q = qm ? qm[1].trim() : '';
        const data = await call('products', { q }, () => API('/api/products' + (q ? '?q=' + encodeURIComponent(q) : '')));
        const items = (data.items || []).slice(0, 8);
        if (!items.length) return { content: q ? '未找到标题含「' + q + '」的商品。' : '商品库为空, 先采集一些商品吧 (告诉我列表页 URL 即可采集)。', tools };
        const rows = items.map((x) => `| ${x.asin} | ${(x.title || '').slice(0, 34)} | ${x.fulfill || '-'} | ${x.price != null ? x.price + ' ' + (x.currency || '') : '-'} |`).join('\n');
        return { content: `找到 **${data.total}** 条${q ? ` (含「${q}」)` : ''}, 前 ${items.length} 条:\n\n| ASIN | 标题 | 配送 | 价格 |\n|---|---|---|---|\n${rows}\n\n输入 ASIN 可查看详情 / 合规检测 / 认领。`, tools };
      }
      // ②.5 筛选商品 (组合条件: FBA/FBM/AMZ 配送、A+、价格、评分、月销、跟卖数、站点、关键词、无排名)
      if ((/筛选|过滤|所有.*商品|全部.*商品/.test(t) || /找.*(FBA|FBM)|配送.*(FBA|FBM)|A\+/.test(t)) && !/采集/.test(t)) {
        const qs = [];
        // 无排名
        if (/无排名|没排名|没有排名|无榜单/.test(t)) qs.push('noRank=1');
        // A+ 商品
        if (/A\+/.test(t)) {
          if (/排除.*A\+|无A\+|没有A\+/.test(t)) qs.push('aplus=0');
          else qs.push('aplus=1');
        }
        // 配送
        if (/FBA/.test(t) && !/FBM/.test(t)) qs.push('fba=FBA');
        else if (/FBM/.test(t)) qs.push('fba=FBM');
        // 价格区间 如 "10-50"
        const pm = t.match(/(\d+(?:\.\d+)?)\s*[-到至]\s*(\d+(?:\.\d+)?)/);
        if (pm) qs.push('priceRange=' + encodeURIComponent(pm[1] + '-' + pm[2]));
        // 评分 "4以上/4+" / "评分4"
        const rm = t.match(/评分\s*[≥>]?\s*(\d(?:\.\d)?)/);
        if (rm) qs.push('ratingMin=' + rm[1]);
        // 月销 "月销>500" / "销量500以上"
        const sm = t.match(/(?:月销|销量)\s*[>≥]\s*(\d+)/);
        if (sm) qs.push('salesMin=' + sm[1]);
        // 跟卖数 "跟卖5个以上"
        const fm = t.match(/跟卖\s*(\d+)\s*(?:个)?\s*以上/);
        if (fm) qs.push('followMin=' + fm[1]);
        // 站点
        const st = t.match(/站点[:：]?\s*([a-z]{2})/i);
        if (st) qs.push('site=' + st[1]);
        // 关键词 (剔除条件词后的剩余中文/英文词)
        const qm = t.match(/(?:筛选|过滤|找)\s*(.+)/);
        let kw = '';
        if (qm) {
          const raw = qm[1]
            .replace(/FBA|FBM|AMZ|自营/g, '')
            .replace(/A\+|a\+|A\+页面|A\+商品/g, '')
            .replace(/无排名|没排名|没有排名|无榜单|没有榜单/g, '')
            .replace(/\d+(?:\.\d+)?\s*[-到至]\s*\d+(?:\.\d+)?/g, '')
            .replace(/评分\s*[≥>]?\s*\d(?:\.\d)?/g, '')
            .replace(/(?:月销|销量)\s*[>≥]\s*\d+/g, '')
            .replace(/跟卖\s*\d+\s*(?:个)?\s*以上/g, '')
            .replace(/站点[:：]?\s*[a-z]{2}/gi, '')
            .replace(/以上|以内|的|商品|条件/g, '').trim();
          if (raw) kw = raw;
        }
        if (kw) qs.push('q=' + encodeURIComponent(kw));
        const data = await call('products', qs.join('&'), () => API('/api/products?' + qs.join('&')));
        const items = (data.items || []).slice(0, 10);
        if (!items.length) return { content: '没有符合条件的商品 (试试放宽条件)。', tools };
        const rows = items.map((x) => `| ${x.asin} | ${(x.title || '').slice(0, 32)} | ${x.fulfill || '-'} | ${x.price != null ? x.price + ' ' + (x.currency || '') : '-'} | 月销${x.monthlySales || 0} | 跟卖${x.followCount || 0} |`).join('\n');
        const allAsins = (data.items || []).map((x) => x.asin);
        const asinList = allAsins.length ? `\n\n**全部 ${allAsins.length} 个 ASIN**: ${allAsins.join(',')}` : '';
        return { content: `筛选出 **${data.total}** 个商品 (条件: ${qs.join(' ') || '全部'}), 前 ${items.length} 个:\n\n| ASIN | 标题 | 配送 | 价格 | 月销 | 跟卖 |\n|---|---|---|---|---|---|\n${rows}${asinList}`, tools };
      }
      // ②.6 商品详情
      if (/详情|查看.*(商品|详情)|这个商品|它.*(情况|数据)/.test(t)) {
        const am = t.match(/B0[A-Z0-9]{8}/);
        if (!am) return { content: '请提供 ASIN, 例如: 详情 B0XXXXXXX', tools };
        const d = await call('detail', { asin: am[0] }, () => API('/api/products/detail?asin=' + am[0]));
        if (d.error) return { content: '⚠ ' + d.error, tools };
        return { content: `**${d.title}**\nASIN: ${d.asin} | 站点: ${d.site} | 品牌: ${d.brand}${d.brandStatus ? ' (' + d.brandStatus + ')' : ''}\n价格: ${fmtMoney(d.minPrice != null ? d.minPrice : d.price, d.currency)} | 月销: ${d.monthlySales} | 评分: ${d.rating || '-'} (${d.reviews} 评论)\n跟卖: ${d.followCount} 个${d.offerPrices && d.offerPrices.length ? ` | 跟卖报价: ${d.offerPrices.length} 条` : ''} | 商标: ${d.trademarkCount} 条${d.tmCountries && d.tmCountries.length ? ` (${d.tmCountries.join(',')})` : ''}\n上架: ${d.listedAt || '-'} | 净收益(估): ${fmtMoney(d.netProfit, d.currency)}`, tools };
      }
      // ②.7 数据分析 / 排行
      if (/分析|排行|top|最多|最热|分布|占比|前十|情况如何/.test(t)) {
        const a = await call('analyze', {}, () => API('/api/products/analyze'));
        if (!a || !a.total) return { content: '商品库为空, 先采集一些商品 (告诉我列表页 URL)。', tools };
        const siteS = (a.bySite || []).map(([k, v]) => `${k}${v}`).join(' ');
        const catS = (a.byCategory || []).slice(0, 5).map(([k, v]) => `${k}${v}`).join(' ');
        const fulfillS = (a.byFulfill || []).map(([k, v]) => `${k}${v}`).join(' ');
        const priceS = Object.entries(a.priceBuckets || {}).map(([k, v]) => `${k}€:${v}`).join(' ');
        let extra = '';
        if (/销量/.test(t)) extra = '\n\n**月销 Top5**:\n' + (a.salesTop || []).slice(0, 5).map((x) => `· ${x.asin} ${(x.title || '').slice(0, 26)} — 月销${x.monthlySales} ${x.price != null ? x.price + x.currency : ''}`).join('\n');
        if (/跟卖/.test(t)) extra = '\n\n**跟卖最多 Top5**:\n' + (a.followTop || []).slice(0, 5).map((x) => `· ${x.asin} ${(x.title || '').slice(0, 26)} — 跟卖${x.followCount}个`).join('\n');
        if (/商标|风险/.test(t)) extra = '\n\n**商标风险 Top5**:\n' + (a.tmTop || []).slice(0, 5).map((x) => `· ${x.asin} ${(x.title || '').slice(0, 26)} — 商标${x.trademarkCount}条`).join('\n');
        return { content: `**商品库分析** (共 ${a.total} 个):\n· 站点: ${siteS}\n· 类目: ${catS}\n· 配送: ${fulfillS}\n· 价格带: ${priceS}\n· 平均评分 ${a.ratingAvg} | 总月销 ${a.salesTotal} | FBA ${a.fbaCount}个 | 有跟卖 ${a.withFollow}个 | 商标/已备案 ${a.registered}个${extra}`, tools };
      }
      // ②.8 风险检查
      if (/风险|危险|商标多|已备案|不安全/.test(t)) {
        const a = await call('analyze', {}, () => API('/api/products/analyze'));
        if (!a || !a.riskList || !a.riskList.length) return { content: '商品库无已备案/TM 商标风险商品。', tools };
        const rows = (a.riskList || []).map((x) => `· ${x.asin} ${(x.title || '').slice(0, 30)} — ${x.brand} ${x.brandStatus === 'registered' ? '已备案' : 'TM'} (商标${x.trademarkCount}条)`).join('\n');
        return { content: `**商标/备案风险商品** (${a.riskList.length} 个, 建议谨慎跟卖):\n${rows}`, tools };
      }
      // ②.9 跟卖分析
      if (/跟卖/.test(t) && !/采集/.test(t)) {
        const a = await call('analyze', {}, () => API('/api/products/analyze'));
        if (!a || !a.followTop || !a.followTop.length) return { content: '商品库暂无跟卖数据 (采集 aod 跟卖后可见)。', tools };
        const rows = (a.followTop || []).slice(0, 8).map((x) => `· ${x.asin} ${(x.title || '').slice(0, 30)} — 跟卖 ${x.followCount} 个, ${x.price != null ? x.price + (x.currency || '') : '-'}`).join('\n');
        return { content: `**跟卖最多的商品** (共 ${a.total} 个商品, ${a.withFollow} 个有跟卖):\n${rows}`, tools };
      }
      // ③ 采集列表页
      if (/采集|抓取|抓|直采|爬|筛选取/.test(t)) {
        const um = t.match(/https?:\/\/[^\s]+/);
        if (!um) return { content: '请提供要采集的 Amazon 列表页 URL, 例如: 采集 https://www.amazon.co.uk/s?k=Car+Accessories', tools };
        const url = um[0];
        const isFilter = /筛选/.test(t);
        const data = isFilter
          ? await call('list-filtered', { url }, () => API('/api/collect/list-filtered', { method: 'POST', body: JSON.stringify({ url, maxPages: 1 }) }))
          : await call('list-direct', { url }, () => API('/api/collect/list-direct', { method: 'POST', body: JSON.stringify({ url, maxPages: 1 }) }));
        return { content: `**采集完成** (${isFilter ? '筛选采集' : '列表直采'})\n- 列表页: ${data.total || data.productCount || 0} 个商品\n- 前置筛掉: ${data.skippedByList || 0} / 跳详情: ${data.enriched || '-'}\n- 新增入库: **${data.added || 0}** 个\n\n去「商品管理」查看, 或继续: 找商品 / 合规检测。`, tools };
      }
      // ④ 合规检测
      if (/合规|检测|风险/.test(t)) {
        const am = t.match(/B0[A-Z0-9]{8}/);
        if (!am) return { content: '请提供要检测的 ASIN, 例如: 合规检测 B0XXXXXXX', tools };
        const data = await call('compliance', { asin: am[0] }, () => API('/api/compliance/check', { method: 'POST', body: JSON.stringify({ asin: am[0] }) }));
        const lv = data.level === 'high' ? '🔴 高风险' : data.level === 'medium' ? '🟡 中风险' : '🟢 低风险';
        return { content: `**合规检测 ${data.asin}**: ${lv} (评分 ${data.score})\n\n${(data.reasons || []).map((r) => '· ' + r).join('\n')}`, tools };
      }
      // ⑤ 调价
      if (/调价|价格.*更新|抢购物车/.test(t)) {
        const data = await call('reprice', {}, () => API('/api/reprice/run', { method: 'POST' }));
        const wins = (data.runs || []).filter((x) => x.win).length;
        return { content: `**调价完成**: ${data.runs.length} 条, 预计抢到购物车 ${wins} 条 (胜率 ${Math.round(data.stats.winRate * 100)}%)\n建议: ${data.stats.suggestion.suggestion}`, tools };
      }
      // ⑥ 认领
      if (/认领|草稿/.test(t)) {
        const am = t.match(/B0[A-Z0-9]{8}/);
        if (!am) return { content: '请提供要认领的 ASIN, 例如: 认领 B0XXXXXXX', tools };
        const data = await call('claim', { asin: am[0] }, () => API('/api/claims', { method: 'POST', body: JSON.stringify({ asin: am[0] }) }));
        return { content: data.error ? `⚠ ${data.error}` : `**已认领** ${am[0]} 到草稿箱 (SKU: ${data.sku}, 建议价 ${data.price})`, tools };
      }
      // ⑥.5 删除商品 (单个/多个逗号分隔) 与 清空商品库
      if (/删除|删掉|移除|清空/.test(t)) {
        if (/清空全部|清空商品库/.test(t)) {
          const r = await call('clear', {}, () => API('/api/products/clear', { method: 'POST' }));
          return { content: `🧹 已清空 ${r.cleared || 0} 个商品 (如误操作, 可在「商品管理 → 重置」恢复种子数据)`, tools };
        }
        const asins = t.match(/B0[A-Z0-9]{8}/g);
        if (!asins || !asins.length) return { content: '请提供要删除的 ASIN, 例如: 删除 B0XXXXXXX 或 删除 B0AAA1,B0BBB2', tools };
        const uniq = [...new Set(asins)];
        const r = await call('delete', { asins: uniq }, () => API('/api/products/delete', { method: 'POST', body: JSON.stringify({ asins: uniq }) }));
        return { content: `🗑 已删除 **${r.deleted}** 个商品 (${uniq.join(', ')}), 剩余 ${r.remain} 条`, tools };
      }
      // ⑥.6 保存商品到产品库
      if (/保存/.test(t)) {
        const am = t.match(/B0[A-Z0-9]{8}/);
        if (!am) return { content: '请提供 ASIN, 例如: 保存 B0XXXXXXX', tools };
        const r = await call('save', { asin: am[0] }, () => API('/api/products/save', { method: 'POST', body: JSON.stringify({ asins: [am[0]], saved: true }) }));
        return { content: `★ 已保存 **${am[0]}** 到产品库 (可在商品管理筛选「已保存」查看)`, tools };
      }
      // ⑥.7 同步刷新商品数据 (价格/月销/跟卖数)
      if (/同步|刷新.*商品|更新.*数据/.test(t)) {
        const am = t.match(/B0[A-Z0-9]{8}/);
        if (!am) return { content: '请提供 ASIN, 例如: 同步 B0XXXXXXX', tools };
        const r = await call('sync', { asin: am[0] }, () => API('/api/products/sync', { method: 'POST', body: JSON.stringify({ asins: [am[0]] }) }));
        return { content: `🔄 已同步刷新 **${r.synced}** 个商品 (价格/月销/跟卖数已更新)`, tools };
      }
      // ⑦ 帮助
      if (/帮助|help|能做什么|指令|操作/.test(t)) {
        return { content: `**我能帮你做什么**\n\n· **查看统计** — 系统状态 / 商品库数量\n· **找商品** — 如: 找 手机支架\n· **筛选商品** — 如: 筛选 FBA 价格10-50 评分4以上 月销>500 的汽车配件 (支持配送/价格/评分/月销/跟卖数/站点/关键词)\n· **商品详情** — 如: 详情 B0XXXXXXX\n· **数据分析** — 如: 分析商品库 / 销量前十 / 跟卖最多的商品 / 商标最多的品牌\n· **风险检查** — 如: 哪些商品有商标风险\n· **采集列表页** — 如: 采集 https://www.amazon.co.uk/s?k=...\n· **筛选采集** — 如: 筛选采集 https://...\n· **合规检测** — 如: 合规检测 B0XXXXXXX\n· **调价** — 执行一轮智能调价\n· **认领** — 如: 认领 B0XXXXXXX\n· **删除商品** — 如: 删除 B0XXXXXXX 或 删除 B0AAA,B0BBB (可先筛选再批量删)\n· **保存商品** — 如: 保存 B0XXXXXXX\n· **同步刷新** — 如: 同步 B0XXXXXXX (更新价格/月销/跟卖数)\n· **清空商品库** — 如: 清空商品库 (⚠ 慎用)\n\nAI 智能模式下可自然语言提问, 自动调用以上能力并解读结果。`, tools };
      }
      return { content: `这个指令我暂时不会执行。你可以:\n\n· **查看统计** · **找商品 xxx** · **筛选/分析** · **采集 [列表页URL]** · **合规检测 [ASIN]** · **调价** · **认领/删除/保存/同步 [ASIN]**\n\n输入"帮助"查看全部能力。`, tools };
    } catch (e) {
      return { content: '⚠ 执行失败: ' + (e && e.message || e) + '\n\n轨迹面板可查看详细调用记录。', tools };
    }
  };

  // ===== AI 对话 (后端已配置模型时走真实 LLM; 回复含 [[TOOL:...]] 则执行系统动作) =====
  // AI 多轮工具调用: LLM 可连续输出 [[TOOL:...]] (先筛选拿列表 → 再删除等), 每轮把工具结果回传, 直到 LLM 给出最终回复
  const aiChat = async (text, history) => {
    const sys = { role: 'system', content: AGENT_SYSTEM_PROMPT };
    const hist = (history || []).filter((m) => m.role === 'user' || m.role === 'assistant').slice(-8).map((m) => ({ role: m.role, content: m.content }));
    let messages = [sys, ...hist, { role: 'user', content: text }];
    let toolsAll = [];
    let lastNote = '';
    for (let round = 0; round < 5; round++) {
      const res = await API('/api/ai/chat', { method: 'POST', body: JSON.stringify({ messages }) });
      const reply = (res && res.content) || '';
      const tm = reply.match(/\[\[TOOL:([^\]]+)\]\]/);
      if (!tm) {
        // 最终回复: 把前面工具执行的说明 + LLM 回复合并
        const final = lastNote ? lastNote + '\n\n' + reply : reply;
        return { content: final, tools: toolsAll };
      }
      const cmd = tm[1].trim();
      let r;
      try {
        r = await agentExec(cmd);
      } catch (e) {
        r = { content: '⚠ 工具执行失败: ' + (e && e.message || e), tools: [] };
      }
      toolsAll = toolsAll.concat(r.tools || []);
      lastNote = reply.replace(/\[\[TOOL:[^\]]+\]\]\s*/, '').trim();
      // 回传工具结果, 让 LLM 决定继续操作或给出最终回复
      messages.push({ role: 'assistant', content: reply });
      messages.push({ role: 'user', content: '【工具执行结果】\n' + r.content + '\n\n请根据结果继续: 如果需要进一步操作 (如删除列表中的商品), 用 [[TOOL:...]]; 否则直接给用户最终回复 (中文, 简洁)。' });
    }
    return { content: '已达到最大工具调用轮数, 请刷新会话重试。', tools: toolsAll };
  };

  // ===== 发送消息 =====
  const send = async () => {
    const input = $('#amInput');
    const newInput = $('#amNewInput');
    // 空态用居中大输入框, 正常用底部输入框
    const text = ((newInput && newInput.value) || (input && input.value) || '').trim();
    if (!text) return;
    if (input) input.value = '';
    if (newInput) newInput.value = '';
    const c = curConv();
    if (!c.messages.length) c.title = text.slice(0, 18) + (text.length > 18 ? '…' : '');
    c.messages.push({ role: 'user', content: text, ts: now(), tools: [] });
    saveAll(); renderChat(); renderConvList();
    // 助手思考占位
    const thinkIdx = c.messages.push({ role: 'assistant', content: '思考中…', ts: now(), tools: [] }) - 1;
    renderChat();
    const mode = localStorage.getItem('zying-ai-mode') || 'ai';
    let r;
    try {
      if (mode === 'ai') {
        const cfg = await API('/api/ai/config');
        if (cfg && cfg.configured) {
          r = await aiChat(text, c.messages.slice(0, -1));
        } else {
          const local = await agentExec(text);
          r = { content: '**AI 智能模式未配置 API Key** (在「AI 设置」填写后启用)。已用本地规则执行:\n\n' + local.content, tools: local.tools || [] };
        }
      } else {
        const local = await agentExec(text);
        r = { content: '**【本地规则模式】**\n\n' + local.content, tools: local.tools || [] };
      }
    } catch (e) {
      const local = await agentExec(text);
      r = { content: '⚠ AI 调用失败: ' + (e && e.message || e) + '\n\n已回退本地规则助手执行。\n\n--- 本地结果 ---\n' + local.content, tools: local.tools || [] };
    }
    c.messages[thinkIdx] = { role: 'assistant', content: r.content, ts: now(), tools: r.tools || [] };
    saveAll(); renderChat(); renderTrace();
    const ib = $('#amInput');
    if (ib) setTimeout(() => ib.focus(), 60);
  };

  // ===== AI 设置弹窗 (后端存储, 全局生效) =====
  const openAiModal = async () => {
    const cfg = await API('/api/ai/config').catch(() => ({}));
    const mask = document.createElement('div');
    mask.className = 'agent-modal-mask';
    mask.innerHTML = `
      <div class="agent-modal">
        <h3>AI 设置</h3>
        <div class="muted" style="font-size:12px;margin-bottom:10px;line-height:1.6">配置保存在系统后端 (data/ai-config.json), <b>任何浏览器访问都生效</b>。API Key 仅显示后 4 位, 不回传前端, 不会泄露。</div>
        <div class="am-row"><label>名称</label><input id="aiName" placeholder="如: DeepSeek" value="${escAgent(cfg.name || 'DeepSeek')}"></div>
        <div class="am-row"><label>请求 URL (Base URL)</label><input id="aiBase" placeholder="如: https://api.deepseek.com" value="${escAgent(cfg.baseURL || 'https://api.deepseek.com')}"></div>
        <div class="am-row"><label>模型名</label><input id="aiModel" placeholder="如: deepseek-chat" value="${escAgent(cfg.model || '')}"></div>
        <div class="am-row"><label>API Key <span class="muted" id="aiKeyHint">${cfg.configured ? `已配置 (${escAgent(cfg.apiKeyMasked || '')})` : '未配置'}</span></label><input id="aiKey" type="password" placeholder="sk-... (留空保持当前 Key)"></div>
        <div class="am-actions">
          <button class="btn-primary" id="aiSave">保存</button>
          <button class="btn-plain" id="aiTest">测试连接</button>
          <button class="btn-plain" id="aiClear">清除 Key</button>
          <button class="btn-plain" id="aiClose">关闭</button>
        </div>
        <div class="muted" id="aiMsg" style="font-size:12px;margin-top:8px"></div>
      </div>`;
    document.body.appendChild(mask);
    mask.addEventListener('click', (e) => { if (e.target === mask) mask.remove(); });
    mask.querySelector('#aiClose').onclick = () => mask.remove();
    mask.querySelector('#aiSave').onclick = async () => {
      const body = {
        name: mask.querySelector('#aiName').value.trim(),
        baseURL: mask.querySelector('#aiBase').value.trim(),
        model: mask.querySelector('#aiModel').value.trim(),
      };
      const k = mask.querySelector('#aiKey').value.trim();
      if (k) body.apiKey = k;
      if (!body.name || !body.baseURL || !body.model) { mask.querySelector('#aiMsg').textContent = '⚠ 请填写名称 / 请求 URL / 模型名'; return; }
      try {
        const r = await API('/api/ai/config', { method: 'POST', body: JSON.stringify(body) });
        mask.querySelector('#aiMsg').textContent = r.ok ? '✔ 已保存, 全局生效' : ('✗ ' + (r.error || '保存失败'));
        mask.querySelector('#aiKeyHint').textContent = r.configured ? `已配置 (${r.apiKeyMasked})` : '未配置';
        mask.querySelector('#aiKey').value = '';
        renderAiStatus();
      } catch (e) { mask.querySelector('#aiMsg').textContent = '✗ ' + (e && e.message || e); }
    };
    mask.querySelector('#aiTest').onclick = async () => {
      const msg = mask.querySelector('#aiMsg');
      msg.textContent = '测试中…';
      try {
        const r = await API('/api/ai/chat', { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'ping' }] }) });
        msg.textContent = r && r.content ? '✔ 连接成功: ' + String(r.content).slice(0, 60) : ('✗ ' + ((r && r.error) || '无响应'));
      } catch (e) { msg.textContent = '✗ ' + (e && e.message || e); }
    };
    mask.querySelector('#aiClear').onclick = async () => {
      try {
        const r = await API('/api/ai/config', { method: 'POST', body: JSON.stringify({ clearKey: true }) });
        mask.querySelector('#aiMsg').textContent = '✔ 已清除 API Key';
        mask.querySelector('#aiKeyHint').textContent = '未配置';
        renderAiStatus();
      } catch (e) { mask.querySelector('#aiMsg').textContent = '✗ ' + (e && e.message || e); }
    };
  };

  // ===== 事件绑定 =====
  $('#asModelManage').addEventListener('click', () => openAiModal());
  $('#asModelRefresh').addEventListener('click', async () => {
    try { const h = await API('/api/health'); alert('系统在线'); } catch (e) { alert('系统离线: ' + (e && e.message || e)); }
  });
  $('#asNewConv').addEventListener('click', () => {
    convs.forEach((c) => (c.active = false));
    convs.push({ id: 'c' + Date.now(), title: '新会话', createdAt: now(), messages: [], active: true });
    saveAll(); renderChat(); renderConvList(); switchTab('chat');
  });
  $('#asCollapse').addEventListener('click', () => $('#asSidebar').classList.toggle('collapsed'));
  $('#amSend').addEventListener('click', send);
  $('#amInput').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  $$('.am-tabs button').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));

  // ===== 初始渲染 =====
  renderAiStatus();
  renderConvList();
  renderChat();
  switchTab('chat');
  $('#amInput').focus();
}

/* ===== 全局: 站点选项 + 采集过滤辅助 (采集页/商品管理页共享) ===== */
const SITE_OPTIONS = [
  { value: 'de', label: '🇩🇪 德国' }, { value: 'uk', label: '🇬🇧 英国' }, { value: 'us', label: '🇺🇸 美国' },
  { value: 'fr', label: '🇫🇷 法国' }, { value: 'it', label: '🇮🇹 意大利' }, { value: 'es', label: '🇪🇸 西班牙' },
  { value: 'jp', label: '🇯🇵 日本' }, { value: 'ca', label: '🇨🇦 加拿大' }, { value: 'in', label: '🇮🇳 印度' },
];
// 级联站点选择: 按区域分组的全量 Amazon 站点 (采集页站点级联选择器用)
const SITE_GROUPS = [
  { region: '欧洲', sites: [
    { value: 'de', label: '🇩🇪 德国' }, { value: 'uk', label: '🇬🇧 英国' }, { value: 'fr', label: '🇫🇷 法国' },
    { value: 'it', label: '🇮🇹 意大利' }, { value: 'es', label: '🇪🇸 西班牙' }, { value: 'nl', label: '🇳🇱 荷兰' },
    { value: 'se', label: '🇸🇪 瑞典' }, { value: 'pl', label: '🇵🇱 波兰' },
  ]},
  { region: '美洲', sites: [
    { value: 'us', label: '🇺🇸 美国' }, { value: 'ca', label: '🇨🇦 加拿大' }, { value: 'mx', label: '🇲🇽 墨西哥' }, { value: 'br', label: '🇧🇷 巴西' },
  ]},
  { region: '亚太', sites: [
    { value: 'jp', label: '🇯🇵 日本' }, { value: 'au', label: '🇦🇺 澳大利亚' }, { value: 'in', label: '🇮🇳 印度' }, { value: 'sg', label: '🇸🇬 新加坡' },
  ]},
  { region: '中东', sites: [
    { value: 'ae', label: '🇦🇪 阿联酋' }, { value: 'sa', label: '🇸🇦 沙特' },
  ]},
];
// 中文二级类目树: value 为英文匹配词 (匹配商品详情页面包屑), label 为中文显示
const CATEGORY_TREE = [
  { value: 'Electronics', label: '电子', children: [
    { value: 'Cell Phones & Accessories', label: '手机及配件' }, { value: 'Computers & Accessories', label: '电脑及配件' },
    { value: 'TV', label: '电视影音' }, { value: 'Camera & Photo', label: '相机摄影' },
    { value: 'Headphones', label: '耳机音响' }, { value: 'Wearable Technology', label: '智能穿戴' },
    { value: 'Video Games', label: '游戏主机' },
  ] },
  { value: 'Automotive', label: '汽车', children: [
    { value: 'Automotive Parts', label: '汽车配件' }, { value: 'Car Electronics', label: '车载电子' },
    { value: 'Car Care', label: '汽车护理' }, { value: 'Tires & Wheels', label: '轮胎轮毂' },
    { value: 'Motorcycle', label: '摩托车配件' },
  ] },
  { value: 'Home & Kitchen', label: '家居厨房', children: [
    { value: 'Kitchen', label: '厨房用品' }, { value: 'Storage & Organization', label: '收纳整理' },
    { value: 'Furniture', label: '家具' }, { value: 'Cleaning', label: '清洁用品' },
    { value: 'Bedding', label: '床上用品' }, { value: 'Home Décor', label: '家居装饰' },
  ] },
  { value: 'Toys & Games', label: '玩具游戏', children: [
    { value: 'Toys', label: '儿童玩具' }, { value: 'Board Games', label: '桌游卡牌' },
    { value: 'Action Figures', label: '模型手办' }, { value: 'Outdoor Toys', label: '户外玩具' },
    { value: 'Puzzles', label: '拼图积木' },
  ] },
  { value: 'Sports & Outdoors', label: '运动户外', children: [
    { value: 'Fitness', label: '健身器材' }, { value: 'Camping & Hiking', label: '露营野餐' },
    { value: 'Cycling', label: '骑行装备' }, { value: 'Water Sports', label: '水上运动' },
    { value: 'Sports & Outdoors', label: '户外运动' },
  ] },
  { value: 'Garden', label: '花园', children: [
    { value: 'Garden Tools', label: '园艺工具' }, { value: 'Lawn Care', label: '草坪护理' },
    { value: 'Patio', label: '户外装饰' }, { value: 'Plants', label: '植物盆栽' },
  ] },
  { value: 'Beauty', label: '美妆个护', children: [
    { value: 'Skin Care', label: '护肤' }, { value: 'Makeup', label: '彩妆' },
    { value: 'Hair Care', label: '美发' }, { value: 'Fragrance', label: '香水' },
    { value: 'Personal Care', label: '个人护理' },
  ] },
  { value: 'Clothing', label: '服装鞋靴', children: [
    { value: 'Men', label: '男装' }, { value: 'Women', label: '女装' },
    { value: 'Kids', label: '童装' }, { value: 'Shoes', label: '鞋靴' },
    { value: 'Accessories', label: '服饰配件' },
  ] },
  { value: 'Tools', label: '工具五金', children: [
    { value: 'Hand Tools', label: '手动工具' }, { value: 'Power Tools', label: '电动工具' },
    { value: 'Hardware', label: '五金配件' }, { value: 'Safety', label: '安全防护' },
  ] },
  { value: 'Office Products', label: '办公用品', children: [
    { value: 'Office Supplies', label: '办公文具' }, { value: 'Ink & Toner', label: '打印耗材' },
    { value: 'Office Furniture', label: '办公家具' },
  ] },
  { value: 'Pet Supplies', label: '宠物用品', children: [
    { value: 'Dog Supplies', label: '狗狗用品' }, { value: 'Cat Supplies', label: '猫咪用品' },
    { value: 'Pet Food', label: '宠物食品' },
  ] },
];
// 类目联动: 一级 → 二级 select 重填 (cfCat1/cfCat2 用于采集页; fCat1/fCat2 用于商品管理页)
function bindCategoryTree(cat1Id, cat2Id, onUpdate) {
  const c1 = $('#' + cat1Id), c2 = $('#' + cat2Id);
  if (!c1 || !c2) return;
  const fillCat2 = () => {
    const node = CATEGORY_TREE.find((c) => c.value === c1.value);
    c2.innerHTML = '<option value="">全部二级</option>' + (node ? node.children.map((s) => `<option value="${esc(s.value)}">${esc(s.label)}</option>`).join('') : '');
    if (onUpdate) onUpdate();
  };
  c1.innerHTML = '<option value="">全部一级</option>' + CATEGORY_TREE.map((c) => `<option value="${esc(c.value)}">${esc(c.label)}</option>`).join('');
  c1.addEventListener('change', fillCat2);
  fillCat2();
}
// 按英文匹配词反查中文二级类目 (规则加载回填用)
function categoryLabelOf(v) {
  if (!v) return '';
  for (const c of CATEGORY_TREE) {
    if (c.value === v) return c.label;
    for (const s of c.children) if (s.value === v) return `${c.label} / ${s.label}`;
  }
  return v;
}

// 表单值 → 接口过滤参数
// 解析区间输入 "min-max" / "min-" / "-max" / 空 → {min,max} (供 coDesc/cfValues 使用)
const parseRange = (v) => {
  const s = String(v || '').trim().replace(/[，。\s]/g, '');
  if (!s) return { min: null, max: null };
  const m = s.match(/^(-?\d*\.?\d*)-(-?\d*\.?\d*)$/);
  if (m) {
    const min = m[1] === '' || m[1] === '-' ? null : parseFloat(m[1]);
    const max = m[2] === '' ? null : parseFloat(m[2]);
    return { min, max };
  }
  const n = parseFloat(s);
  return isNaN(n) ? { min: null, max: null } : { min: n, max: null };
};
const coPayload = (f) => ({
  filterSites: Array.isArray(f.filterSites) ? f.filterSites : [],
  filterFulfill: f.filterFulfill || '',
  filterShopAplus: f.filterShopAplus || '',
  filterBrandShop: f.filterBrandShop || '',
  filterBrandStore: f.filterBrandStore || '',
  filterRankRange: f.filterRankRange || '',
  filterPriceRange: f.filterPriceRange || '',
  filterRatingRange: f.filterRatingRange || '',
  filterReviewsRange: f.filterReviewsRange || '',
  filterQ: f.filterQ,
  filterBadgesNot: Array.isArray(f.filterBadgesNot) ? f.filterBadgesNot : [],   // ★ 页面标识改为【排除法】(旧 filterBadges 含任一仍由服务端兼容)
  filterHasRankOnly: f.filterHasRankOnly || '',                                 // ★ 只看有排名 (排除没有排名的商品)
  filterTmRange: f.filterTmRange || '',
  filterTmCountries: f.filterTmCountries,
  filterCategory: f.filterCategory,
  filterSalesRange: f.filterSalesRange || '',
  filterIs1688: f.filterIs1688,
  filterBrandStatus: f.filterBrandStatus,
  filterNewDaysRange: f.filterNewDaysRange || '',
});
// 过滤条件中文描述 (区间显示为 min-max, 单边显示 ≥/≤)
const fmtRange = (min, max, unit = '') => (min != null && max != null ? `${min}-${max}${unit}` : min != null ? `≥${min}${unit}` : max != null ? `≤${max}${unit}` : '');
const BADGE_LABELS = { aplus: 'A+', choice: 'AC', bestseller: 'BestSeller', bestseller1: '#1BestSeller', newrelease: 'NewRelease', deal: '限时优惠', dealday: '今日特惠', overallpick: 'OverallPick', editorspick: '编辑精选', toprated: 'TopRated', climate: '气候友好', smallbusiness: '小企业' };
const coDesc = (f) => {
  const r1 = parseRange(f.filterRankRange), r2 = parseRange(f.filterPriceRange), r3 = parseRange(f.filterRatingRange), r4 = parseRange(f.filterReviewsRange), r5 = parseRange(f.filterSalesRange), r6 = parseRange(f.filterTmRange), r7 = parseRange(f.filterNewDaysRange);
  return [
    (Array.isArray(f.filterSites) && f.filterSites.length) ? `站点:${f.filterSites.join(',')}` : '',
    f.filterFulfill ? `配送=${f.filterFulfill}` : '',
    f.filterShopAplus === '1' ? '仅A+店铺' : (f.filterShopAplus === '0' ? '排除A+店铺' : ''),
    f.filterBrandShop === '0' ? '排除品牌店铺' : (f.filterBrandShop === '1' ? '仅品牌店铺' : ''),
    (f.filterBrandStore || '').startsWith('!') ? '排除品牌店链接' : (f.filterBrandStore ? `品牌店=${f.filterBrandStore}` : ''),
    fmtRange(r1.min, r1.max) ? `大排名:${fmtRange(r1.min, r1.max)}` : '',
    f.filterHasRankOnly === '1' ? '仅看有排名(排除没有排名)' : '',
    fmtRange(r2.min, r2.max) ? `价:${fmtRange(r2.min, r2.max)}` : '',
    fmtRange(r3.min, r3.max) ? `评分:${fmtRange(r3.min, r3.max)}` : '',
    fmtRange(r4.min, r4.max) ? `评论:${fmtRange(r4.min, r4.max)}` : '',
    (Array.isArray(f.filterBadgesNot) && f.filterBadgesNot.length) ? `排除标识:${f.filterBadgesNot.map((b) => BADGE_LABELS[b] || b).join(',')}` : '',
    f.filterQ ? `标题含「${f.filterQ}」` : '',
    fmtRange(r6.min, r6.max) ? `排除商标:${fmtRange(r6.min, r6.max)}` : '',
    f.filterTmCountries ? `排除商标国家:${f.filterTmCountries}` : '',
    fmtRange(r5.min, r5.max) ? `月销:${fmtRange(r5.min, r5.max)}` : '',
    f.filterIs1688 === '1' ? '有1688同款' : (f.filterIs1688 === '0' ? '排除1688同款' : ''),
    f.filterBrandStatus === 'registered' ? '排除已备案品牌' : (f.filterBrandStatus === 'tm' ? '排除TM申请中' : (f.filterBrandStatus === 'notfound' ? '仅未查到品牌' : '')),
    fmtRange(r7.min, r7.max) ? `上架:${fmtRange(r7.min, r7.max)}天` : '',
    f.filterCategory ? `类目: ${categoryLabelOf(f.filterCategory)}` : '',
  ].filter(Boolean).join(' + ') || '无过滤';
};
const coSkippedHtml = (r, f) => (r.skipped ? `<br>采集过滤 <b>${esc(coDesc(f))}</b> — 被筛除直接跳过 <b>${r.skipped}</b> 个 (不入库)` : '');
// 采集过滤面板读取 (采集页面板存在; 商品管理页返回默认值) — 站点=选中chips+自定义输入, 主站点取第一个
const cfSite = () => {
  const chips = [...document.querySelectorAll('#cfSitePanel .cfSiteCb:checked')].map((c) => c.value);
  const custom = String($('#cfCustomSites') ? $('#cfCustomSites').value : '').split(/[,，\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  const all = [...chips, ...custom];
  return all.length ? all : ['de'];
};
const cfValues = () => ({
  filterSites: cfSite(),
  filterFulfill: $('#cfFulfill') ? $('#cfFulfill').value : '',
  filterShopAplus: $('#cfShopAplus') ? $('#cfShopAplus').value : '',
  filterBrandShop: $('#cfBrandShop') ? $('#cfBrandShop').value : '',
  filterBrandStore: $('#cfBrandStore') ? $('#cfBrandStore').value : '',
  filterRankRange: $('#cfRankRange') ? $('#cfRankRange').value : '',
  filterPriceRange: $('#cfPriceRange') ? $('#cfPriceRange').value : '',
  filterRatingRange: $('#cfRatingRange') ? $('#cfRatingRange').value : '',
  filterReviewsRange: $('#cfReviewsRange') ? $('#cfReviewsRange').value : '',
  filterQ: $('#cfQ') ? $('#cfQ').value : '',
  filterBadgesNot: String($('#cfBadgesNot') ? $('#cfBadgesNot').value : '').split(/[,，]/).map((s) => s.trim()).filter(Boolean),
  filterHasRankOnly: ($('#cfHasRankOnly') && $('#cfHasRankOnly').checked) ? '1' : '',
  filterTmRange: $('#cfTmRange') ? $('#cfTmRange').value : '',
  filterTmCountries: $('#cfTmCountries') ? $('#cfTmCountries').value : '',
  filterSalesRange: $('#cfSalesRange') ? $('#cfSalesRange').value : '',
  filterIs1688: $('#cfIs1688') ? $('#cfIs1688').value : '',
  filterBrandStatus: $('#cfBrandStatus') ? $('#cfBrandStatus').value : '',
  filterNewDaysRange: $('#cfNewDaysRange') ? $('#cfNewDaysRange').value : '',
  filterCategory: ($('#cfCat2') && $('#cfCat2').value) ? $('#cfCat2').value : (($('#cfCat1') && $('#cfCat1').value) || ''),
});
const refreshStats = () => { if (window.__collectRefresh) try { window.__collectRefresh(); } catch {} };

/* ===== 采集进度轮询 (运行中的采集方式卡片显示实时进度 + 停止按钮) ===== */
let cfPollTimer = null;
const cfPoll = async (mode) => {
  try {
    const pg = await API('/api/collect/progress');
    const card = document.querySelector(`.collect-mode[data-mode="${mode}"]`);
    if (card && pg && pg.running) {
      const txt = card.querySelector('.cm-prog-text');
      const secs = Math.round((Date.now() - pg.startedAt) / 1000);
      let s = `⏳ ${pg.step || '采集中'} · ${secs}s`;
      if (pg.items != null) s += ` · 采集 ${pg.items} 个`;
      if (pg.added != null) s += ` · 新增 ${pg.added}`;
      if (pg.page) s += ` · 第 ${pg.page}${pg.pages ? '/' + pg.pages : ''} 页`;
      if (pg.detailDone != null) s += ` · 详情 ${pg.detailDone}${pg.detailTotal ? '/' + pg.detailTotal : ''}`;
      if (pg.round) s += ` · 第 ${pg.round}/${pg.rounds || '?'} 轮`;
      if (pg.shopsDone != null) s += ` · 店铺 ${pg.shopsDone}/${pg.shopsTotal}`;
      txt.textContent = s;
    }
  } catch (e) {}
};
const startCfPoll = (mode) => { if (!cfPollTimer) cfPollTimer = setInterval(() => cfPoll(mode), 2000); };
const stopCfPoll = () => { if (cfPollTimer) { clearInterval(cfPollTimer); cfPollTimer = null; } };

/* ===== 商品管理 (采集到的商品数据: 列表/筛选/详情/批量操作) ===== */

// 采集流程: mode 由采集页模式卡片传入; btn 为触发按钮 (无则忽略); 过滤条件从采集页面板读取
async function openCollectFlow(mode, btn) {
  const setBusy = (txt) => {
    const isCard = !!(btn && btn.classList && btn.classList.contains('collect-mode'));
    if (btn && !isCard) { btn.disabled = !!txt; if (txt) { if (!btn.dataset.orig) btn.dataset.orig = btn.textContent; btn.textContent = txt; } else { btn.textContent = btn.dataset.orig || '🚀 采集'; } }
    const sb = $('#cfStopBtn'); if (sb) sb.classList.toggle('acting', !!txt);
    // 采集方式卡片: 运行态 + 进度轮询 (卡片是 div 结构, 不能覆盖 textContent)
    const bmode = (btn && btn.dataset && btn.dataset.mode) || mode;
    const card = bmode ? document.querySelector(`.collect-mode[data-mode="${bmode}"]`) : null;
    if (txt) { if (card) { card.classList.add('running'); const pt = card.querySelector('.cm-prog-text'); if (pt) pt.textContent = '⏳ 启动…'; } startCfPoll(bmode); }
    else { stopCfPoll(); $$('.collect-mode.running').forEach((c) => c.classList.remove('running')); }
  };


  if (mode === 'category') {
    // ① 类目搜索采集
    const f = await zyPromptForm('📚 类目搜索采集', [
      { field: 'keyword', label: '搜索关键词', placeholder: '如: car phone holder', default: '' },
      { field: 'category', label: '类目 (可选)', placeholder: '如: Automotive', default: '' },
      { field: 'maxPages', label: '翻页数 (每页约16个商品)', type: 'number', default: '2' },
    ], { hint: '关键词或类目必填其一 · 全程CDP无API · 过滤条件不满足的商品直接跳过, 不入库' });
    if (!f) return;
    setBusy(`⏳ 类目采集中(${f.maxPages}页)...`);
    try {
      const r = await API('/api/collect/category', { method: 'POST', body: JSON.stringify({ site: cfSite()[0] || 'de', keyword: f.keyword, category: f.category, maxPages: parseInt(f.maxPages, 10), ...coPayload(cfValues()) }) });
      await zyAlert('✅ 类目搜索采集完成', `搜索「${f.keyword || f.category}」抓取 <b>${r.productCount}</b> 个商品<br>新增入库 <b>${r.added}</b> 个 | 站点: ${cfSite()}<br>当前共 <b>${r.total}</b> 条${coSkippedHtml(r, cfValues())}`);
    } catch (e) {
      await zyAlert('❌ 类目采集失败', e.message || '请确认 Edge 9222 已开启');
    }
    setBusy(null);
    refreshStats();
  } else if (mode === 'batch') {
    // ③ 批量跟卖店铺采集: 对输入商品遍历全部跟卖卖家店铺 + 循环跳转 (不在库自动转 aod 实时提取, 真正去采集)
    const f = await zyPromptForm('🔁 批量跟卖店铺采集', [
      { field: 'asins', label: '商品 (ASIN 或 amazon 链接, 逗号分隔; 在商品库优先用已采跟卖链接, 不在库自动转 aod 实时提取)', placeholder: '如: B0CCD88N2Y,B0H11NJ91L', default: '' },
      { field: 'excludeSellers', label: '排除卖家 (名称/ID, 逗号分隔, 留空=全部采集)', placeholder: '如: jianjun', default: '' },
      { field: 'amazonWords', label: '排除亚马逊词汇 (卖家名/ID 含这些词自动排除, 逗号分隔, 可自定义)', placeholder: '如: amazon,亚马逊', default: 'amazon,亚马逊' },
      { field: 'rounds', label: '循环轮次 (0=无限循环, 一直采到商品队列耗尽或手动停止; 1-30=固定轮数)', type: 'number', default: '1' },
      { field: 'concurrency', label: '并行网页数 (1-6, 并行采集卖家店铺提升速度)', type: 'number', default: '4' },
      { field: 'maxItems', label: '每店铺商品数上限 (0=无限制)', type: 'number', default: '10' },
      { field: 'maxPages', label: '每店铺翻页数上限 (0=无限制, 一直翻到店铺无更多商品)', type: 'number', default: '2' },
    ], { hint: '自动流程: 商品(ASIN/链接自动转aod) → 提取全部跟卖卖家(自动排除亚马逊官方+自定义词汇) → 排除指定卖家 → 并行采集各卖家店铺 → 每轮采完自动从新采集商品跳转循环(无卖家自动兜底跳转) → 汇总入库 · 填 0 表示无限制 · 全程CDP无API' });
    if (!f) return;
    const asins = (f.asins || '').split(/[,，\s]+/).filter(Boolean);
    if (!asins.length) { await zyAlert('⚠️ 请输入商品 ASIN 或链接'); return; }
    const roundsN = f.rounds === '0' || f.rounds === '' ? 0 : (parseInt(f.rounds, 10) || 1);
    setBusy(`${roundsN === 0 ? '♾ 无限循环' : `⏳ ${roundsN}轮循环`}批量店铺采集中...`);
    try {
      const r = await API('/api/collect/follow-shop-batch', { method: 'POST', body: JSON.stringify({ asins, rounds: roundsN, concurrency: parseInt(f.concurrency, 10) || 4, maxItems: parseInt(f.maxItems, 10) || 0, maxPages: parseInt(f.maxPages, 10) || 0, excludeSellers: f.excludeSellers, amazonWords: f.amazonWords, ...coPayload(cfValues()) }) });
      const rows = (r.results || []).map((res) => {
        if (res.note) return `<div style="margin:4px 0">🔁 <b>第${res.round}轮</b> — ${esc(res.note)}</div>`;
        const srcBadge = res.sellerFrom === 'aod' ? ' <span class="badge gray">aod实时提取</span>' : ' <span class="badge blue">商品库</span>';
        const sellersHtml = (res.sellers || []).map((s) => s.error
          ? `<div style="padding:1px 0 1px 12px">✗ ${esc(s.seller || s.sellerId || '?')}: ${esc(s.error)}</div>`
          : `<div style="padding:1px 0 1px 12px">✓ ${esc(s.seller || s.sellerId)} — 店铺商品 <b>${s.productCount}</b> 个${s.skipped ? ` (跳过 ${s.skipped})` : ''}</div>`).join('');
        return `<div style="margin:4px 0"><b>第${res.round}轮 · ${esc(res.asin)}</b>${srcBadge} (${esc(res.title || '')}) — ${res.sellers ? res.sellers.length : 0} 个跟卖卖家${res.autoJump ? ` <span class="badge gold">→ 自动跳转 ${esc(res.nextAsin || '')}</span>` : ''}<br>${sellersHtml}</div>`;
      }).join('');
      const nothingCollected = !(r.shopOk || 0) && !(r.productCount || 0) && !(r.added || 0);
      const stopBadge = r.stopped ? '<div style="margin-top:4px;color:#b00020;font-weight:700">⏹ 本次采集已被您手动停止 — 已采集的数据已保存入库</div>' : '';
      await zyAlert(nothingCollected ? '⚠️ 批量跟卖店铺采集未获取到数据' : '✅ 批量跟卖店铺采集完成', `
        ${r.rounds === 0 ? '♾ 无限循环' : r.rounds + ' 轮循环'}, 成功 <b>${r.okRounds}</b> 轮, 自动跳转 <b>${r.autoJumps}</b> 次 → 跟卖卖家店铺成功 <b>${r.shopOk}</b> / 失败 <b>${r.shopFail}</b><br>
        共采集店铺商品 <b>${r.productCount}</b> 个, 新增入库 <b>${r.added || 0}</b> 个${coSkippedHtml(r, cfValues())}<br>
        ${stopBadge}
        ${nothingCollected ? '<div style="margin-top:4px;color:#c77d1a">⚠️ 本次未获取到任何数据: 所有商品均未提取到跟卖卖家或卖家店铺全部失败。<b>采集过滤条件</b>会筛除不合格商品直接跳过(不入库), 请检查下方每轮明细后再试。</div>' : ''}
        <div style="margin-top:6px;background:#f6f6f6;border-radius:6px;padding:8px;font-size:12px;max-height:240px;overflow-y:auto">${rows}</div>`);
    } catch (e) {
      await zyAlert('❌ 批量店铺采集失败', e.message || '请确认 Edge 9222 已开启、商品库有带跟卖链接的商品');
    }
    setBusy(null);
    refreshStats();
  } else if (mode === 'parallel') {
    // ④ 多商品并行跟卖店铺采集 (完整工作流): 输入商品 → 验证商品 → 提取卖家 → 排除指定 → 并行采集各店铺 → 循环跳转 → 汇总入库
    const f = await zyPromptForm('⚡ 多商品并行跟卖店铺采集', [
      { field: 'urls', label: '商品 (ASIN / 商品链接 / aod 链接, 每行一个)', placeholder: 'B0XXXXXXX\nhttps://www.amazon.de/dp/B0YYYYYYY\nhttps://www.amazon.de/dp/B0ZZZZZ/ref=olp-opf-redir?aod=1', default: '' },
      { field: 'excludeSellers', label: '排除卖家 (名称/ID, 逗号分隔, 留空=全部采集)', placeholder: '如: jianjun', default: '' },
      { field: 'amazonWords', label: '亚马逊词汇筛选 (卖家名/ID 含这些词自动排除, 逗号分隔)', placeholder: '如: amazon, 亚马逊, amazon.de', default: 'amazon,亚马逊' },
      { field: 'rounds', label: '循环轮次 (0=无限循环; 1-30=固定轮数, 采完一个商品自动从新采集商品跳转继续)', type: 'number', default: '1' },
      { field: 'concurrency', label: '并行网页数 (1-6, 建议=卖家数)', type: 'number', default: '4' },
      { field: 'maxItems', label: '每店铺商品数上限 (0=无限制)', type: 'number', default: '10' },
      { field: 'maxPages', label: '每店铺翻页数上限 (0=无限制)', type: 'number', default: '2' },
    ], { hint: '完整工作流: 商品(ASIN/链接自动转aod) → 验证商品信息 → 提取全部跟卖卖家(自动排除亚马逊官方+词汇) → 排除指定卖家 → 并行采集各卖家店铺 → 采完自动从新采集商品跳转循环(无卖家自动兜底跳转) → 汇总入库 · 填 0 表示无限制 · 全程CDP无API' });
    if (!f) return;
    const urls = (f.urls || '').split(/[\n,，]+/).map((u) => u.trim()).filter(Boolean);
    if (!urls.length) { await zyAlert('⚠️ 请输入商品 aod 链接'); return; }
    for (const u of urls) { if (!/^https:\/\/(www\.)?amazon\./.test(u)) { await zyAlert('⚠️ 无效链接', u.slice(0, 50) + ' 不是 amazon 链接'); return; } }
    const rounds = f.rounds === '0' || f.rounds === '' ? 0 : (parseInt(f.rounds, 10) || 1);
    setBusy(`${rounds === 0 ? '♾ 无限循环' : `⏳ ${rounds}轮`}多商品并行采集中...`);
    try {
      const r = await API('/api/collect/follow-shop-rounds', { method: 'POST', body: JSON.stringify({ urls, rounds, concurrency: parseInt(f.concurrency, 10) || 4, maxItems: parseInt(f.maxItems, 10) || 0, maxPages: parseInt(f.maxPages, 10) || 0, excludeSellers: f.excludeSellers, amazonWords: f.amazonWords, ...coPayload(cfValues()) }) });
      const rows = (r.roundResults || []).map((res) => {
        if (res.note) return `<div style="margin:4px 0"><b>第${res.round}轮</b> — ${esc(res.note)}</div>`;
        const fromBadge = res.sellerFrom === 'history' ? ' <span class="badge gold" title="aod 实时提取失败(如商品当前无报价), 自动复用商品库历史跟卖卖家继续采集">历史卖家兜底</span>' : '';
        const head = res.error
          ? `<b>第${res.round}轮</b> — ${esc(res.asin)} — ✗ ${esc(res.error)}${fromBadge}`
          : `<b>第${res.round}轮</b> — ${esc(res.asin)} — 提取 ${res.sellerCount || 0} 个跟卖卖家${fromBadge}`;
        const sellersHtml = (res.sellers || []).map((s) => s.error
          ? `<div style="padding:1px 0 1px 12px">✗ ${esc(s.seller || s.sellerId || '?')}: ${esc(s.error)}</div>`
          : `<div style="padding:1px 0 1px 12px">✓ ${esc(s.seller || s.sellerId)} — 店铺商品 <b>${s.productCount}</b> 个${s.skipped ? ` (跳过 ${s.skipped})` : ''}</div>`).join('');
        return `<div style="margin:4px 0">${head}<br>${sellersHtml}</div>`;
      }).join('');
      const nothingCollected = !(r.shopOk || 0) && !(r.productCount || 0) && !(r.added || 0);
      const stopBadge = r.stopped ? '<div style="margin-top:4px;color:#b00020;font-weight:700">⏹ 本次采集已被您手动停止 — 已采集的数据已保存入库</div>' : '';
      await zyAlert(nothingCollected ? '⚠️ 多商品并行跟卖采集未获取到数据' : '✅ 多商品并行跟卖采集完成', `
        <b>工作流:</b> 商品aod → 验证商品 → 提取卖家${r.excludeSellers ? ` → 排除 <b>${esc(r.excludeSellers)}</b>` : ''} → 并行采集各店铺<br><br>
        ${r.rounds === 0 ? '♾ 无限循环' : r.rounds + ' 轮'} (成功 ${r.okRounds} 轮) | ${r.concurrency} 网页并行 → 卖家店铺成功 <b>${r.shopOk}</b> / 失败 <b>${r.shopFail}</b><br>
        共采集店铺商品 <b>${r.productCount}</b> 个, 新增入库 <b>${r.added}</b> 个${coSkippedHtml(r, cfValues())}<br>
        ${stopBadge}
        ${nothingCollected ? '<div style="margin-top:4px;color:#c77d1a">⚠️ 本次未获取到任何数据: 所有商品均未提取到跟卖卖家或卖家店铺全部失败。<b>采集过滤条件</b>会筛除不合格商品直接跳过(不入库), 请检查下方每轮明细后再试。</div>' : ''}
        <div style="margin-top:6px;background:#f6f6f6;border-radius:6px;padding:8px;font-size:12px;max-height:260px;overflow-y:auto">${rows}</div>`);
    } catch (e) {
      await zyAlert('❌ 多商品并行采集失败', e.message || '请确认 Edge 9222 已开启');
    }
    setBusy(null);
    refreshStats();
  } else if (mode === 'bulk') {
    // ⑤ 并行整站采集: 关键词/类目 → 并行打开N个搜索页 → 批量聚合
    const f = await zyPromptForm('🗂️ 并行整站采集', [
      { field: 'keyword', label: '搜索关键词', placeholder: '如: car phone holder', default: '' },
      { field: 'category', label: '类目 (可选)', placeholder: '如: Automotive', default: '' },
      { field: 'pages', label: '并行打开页数 (1-10, 每页约16-48个)', type: 'number', default: '5' },
      { field: 'maxItems', label: '入库数量上限 (1-100)', type: 'number', default: '50' },
    ], { hint: '一次并行打开N个搜索页同时抓取, 不翻页, 耗时≈单页加载(约15秒) · 可选读详情价格/品牌 · 全程CDP · 过滤条件不满足的商品直接跳过' });
    if (!f) return;
    if (!f.keyword && !f.category) { await zyAlert('⚠️ 请输入关键词或类目'); return; }
    setBusy(`⏳ 整站采集中(${f.pages}页并行)...`);
    try {
      const r = await API('/api/collect/site-bulk', { method: 'POST', body: JSON.stringify({ site: cfSite()[0] || 'de', keyword: f.keyword, category: f.category, pages: parseInt(f.pages, 10), maxItems: parseInt(f.maxItems, 10), ...coPayload(cfValues()) }) });
      await zyAlert('✅ 并行整站采集完成', `
        「${esc(f.keyword || f.category)}」${r.pages} 页并行 → 抓取 <b>${r.productCount}</b> 个商品<br>
        新增入库 <b>${r.added}</b> 个 | 当前共 <b>${r.total}</b> 条${coSkippedHtml(r, cfValues())}<br>
        <div class="muted" style="font-size:12px">全程CDP · 耗时约15秒 · 无需翻页</div>`);
    } catch (e) {
      await zyAlert('❌ 整站采集失败', e.message || '请确认 Edge 9222 已开启');
    }
    setBusy(null);
    refreshStats();
  } else if (mode === 'catmenu') {
    // ⑥ 类目菜单采集: 首页 → 大类目 → 二级类目 → 查看所有结果 → 商品 (可过滤)
    const f = await zyPromptForm('🗺️ 类目菜单采集', [
      { field: 'category', label: '大类目名 (模糊匹配, 如 Electronics / Automotive / Home)', placeholder: '如: Electronics', default: '' },
      { field: 'pages', label: '并行打开页数 (1-10)', type: 'number', default: '3' },
      { field: 'maxItems', label: '入库数量上限 (1-100)', type: 'number', default: '50' },
    ], { hint: '自动导航: 首页 → 大类目 → 二级类目 → 查看所有结果 → 采集商品 · 不符合过滤条件(配送/A+/排名/价格/评分等)的商品直接跳过不采集' });
    if (!f) return;
    if (!f.category) { await zyAlert('⚠️ 请输入大类目名'); return; }
    setBusy(`⏳ 类目菜单采集中(${f.category} × ${f.pages}页)...`);
    try {
      const r = await API('/api/collect/category-menu', { method: 'POST', body: JSON.stringify({ site: cfSite()[0] || 'de', category: f.category, pages: parseInt(f.pages, 10), maxItems: parseInt(f.maxItems, 10), ...coPayload(cfValues()) }) });
      const stepsHtml = (r.steps || []).map((s) => `<div style="padding:2px 0">· ${esc(s)}</div>`).join('');
      await zyAlert('✅ 类目菜单采集完成', `
        「${esc(f.category)}」导航链路:<br>
        <div style="margin:6px 0;background:#f6f6f6;border-radius:6px;padding:8px;font-size:12px">${stepsHtml}</div>
        过滤条件: <b>${esc(coDesc(cfValues()))}</b><br>
        抓取 <b>${r.productCount}</b> 个 (过滤跳过 <b>${r.skipped || 0}</b> 个), 新增入库 <b>${r.added}</b> 个 | 当前共 <b>${r.total}</b> 条`);
    } catch (e) {
      await zyAlert('❌ 类目菜单采集失败', e.message || '请确认 Edge 9222 已开启');
    }
    setBusy(null);
    refreshStats();
  } else {
    // ② 跟卖店铺采集 (完整链路: 商品 → 出售单位 → 参观店铺 → 店铺全部商品)
    const f = await zyPromptForm('🏪 跟卖店铺采集', [
      { field: 'url', label: '商品详情 URL 或出售单位链接', placeholder: 'https://www.amazon.de/dp/B0XXXXXXX 或 aag/main、/sp 链接', default: '' },
      { field: 'maxItems', label: '商品数上限 (1-100)', type: 'number', default: '20' },
      { field: 'maxPages', label: '翻页数上限 (1-20, 每页约16个)', type: 'number', default: '2' },
    ], { hint: '自动链路: 商品aod → 出售单位跳转链接 → 出售单位详情页 → 参观出售单位 (支持 Visit the Anker Store 品牌店链接) → 店铺全部商品 · 每个商品: 先详情页(价格/品牌/评分/变体) → 再aod跟卖(卖家/价格/链接) · 全程CDP · 不符合过滤条件(A+/配送/排名等)的商品直接跳过 · 采集页可配 A+ 店铺过滤(仅采/排除品牌店)' });
    if (!f) return;
    if (!/^https:\/\/(www\.)?amazon\./.test(f.url || '')) { await zyAlert('⚠️ 无效链接', '请输入 amazon 商品详情 URL 或出售单位链接'); return; }
    setBusy(`⏳ 跟卖店铺采集中(${f.maxItems}个)...`);
    try {
      const r = await API('/api/collect/follow-shop', { method: 'POST', body: JSON.stringify({ url: f.url, maxItems: parseInt(f.maxItems, 10), maxPages: parseInt(f.maxPages, 10), ...coPayload(cfValues()) }) });
      const stepsHtml = (r.steps || []).map((s) => `<div style="padding:2px 0">· ${esc(s)}</div>`).join('');
      await zyAlert('✅ 跟卖店铺采集完成', `
        出售单位: <b>${esc(r.seller || r.sellerId || '?')}</b><br>
        店铺抓取 <b>${r.productCount}</b> 个商品, 新增入库 <b>${r.added}</b> 个${coSkippedHtml(r, cfValues())}<br>
        每个商品: 先采详情页(价格/品牌/评分/变体) → 再采 aod 跟卖(卖家/价格/链接/运费)<br>
        当前共 <b>${r.total}</b> 条<br>
        <div style="margin-top:6px;background:#f6f6f6;border-radius:6px;padding:8px;font-size:12px">${stepsHtml}</div>
        <a href="${esc(r.storeUrl)}" target="_blank" style="font-size:12px">打开该出售单位店铺 ↗</a>`);
    } catch (e) {
      await zyAlert('❌ 跟卖店铺采集失败', e.message || '请确认 Edge 9222 已开启、智赢插件已加载');
    }
    setBusy(null);
    refreshStats();
  }
}
window.__openCollectFlow = openCollectFlow;

async function renderProduct() {
  const content = $('#content');
  content.innerHTML = `
    <div class="toolbar filter-toolbar">
      <button id="goCollect" class="btn primary" style="flex-shrink:0">去采集</button>
      <input id="cSearch" class="input" placeholder="🔍 搜索 ASIN / 标题" style="width:200px;flex-shrink:0">
      <select id="cFba" class="select" style="flex-shrink:0"><option value="">全部配送</option><option value="FBA">FBA</option><option value="FBM">FBM</option></select>
      <select id="cSell" class="select" style="flex-shrink:0"><option value="">全部卖家</option><option value="amz">AMZ 自营</option><option value="third">第三方卖家</option></select>
      <select id="cBadge" class="select" style="flex-shrink:0"><option value="">全部标签</option><option value="bestseller">Best Seller</option><option value="choice">⭐ A (Amazon's Choice)</option><option value="deal">限时优惠</option><option value="newrelease">新品</option></select>
      <button id="cFilter" class="btn" style="flex-shrink:0">自定义筛选</button>
      <button id="cRefreshRank" class="btn" style="flex-shrink:0" title="对无大排名商品批量补采大排名 (读详情页+插件面板, 可中途停止)">补采排名</button>
      <button id="cBackfill" class="btn primary" style="flex-shrink:0" title="只对【勾选】的商品补采: 详情页字段 + 插件面板(商标/月销), 可选 aod 跟卖。未勾选时会提示。">一键补采</button>
      <button id="c1688Search" class="btn" style="flex-shrink:0" title="对选中商品批量上传主图到 1688 以图搜图, 找同款货源并存入">1688 图搜找货</button>
      <span class="muted" id="cCount" style="flex-shrink:0"></span>
    </div>
    <!-- 自定义筛选面板 (默认展开, 全部设置直接列出) -->
    <div id="cFilterPanel" class="card" style="display:block;margin-bottom:12px">
      <div class="card-title"> 自定义筛选</div>
      <div class="filter-grid">
        <div class="filter-item"><label>价格 (€, 格式 最小-最大)</label><input id="fPriceRange" class="input" placeholder="如 100-200"></div>
        <div class="filter-item"><label>月销量 (格式 最小-最大)</label><input id="fSalesRange" class="input" placeholder="如 1000-5000"></div>
        <div class="filter-item"><label>大排名 ≤ (空=不限)</label><input id="fRankMax" class="input" type="number" min="0" placeholder="如 200000"></div>
        <div class="filter-item"><label>评分 ≥ (空=不限)</label><input id="fRating" class="input" type="number" min="0" max="5" step="0.1" placeholder="如 4.0"></div>
        <div class="filter-item"><label>页面标识 (排除法, 逗号分隔, 命中任一即剔除)</label><input id="fBadgeNot" class="input" list="fBadgeNotList" placeholder="如: A+,AC,BestSeller,新品 (空=不限)"><datalist id="fBadgeNotList"><option value="A+"></option><option value="AC"></option><option value="BestSeller"></option><option value="NewRelease"></option><option value="限时优惠"></option><option value="新品"></option></datalist></div>
        <div class="filter-item"><label>排名 (空=不限)</label><div style="font-size:12px"><label style="display:inline-flex;gap:6px;align-items:center"><input type="checkbox" id="fHasRankOnly"> 排除没有排名的商品 (只看有排名)</label></div></div>
        <div class="filter-item"><label>商标数 ≤ (空=不限)</label><input id="fTmMax" class="input" type="number" min="0" placeholder="如 50"></div>
        <div class="filter-item"><label>卖家地区</label><select id="fChina" class="select"><option value="">全部</option><option value="1">中国卖家</option><option value="0">非中国卖家</option></select></div>
        <div class="filter-item">
          <label>站点 (可多选)</label>
          <div class="multi-select" id="fSiteWrap">
            <button type="button" class="select multi-select-trigger" id="fSiteTrigger">全部站点 ▾</button>
            <div class="multi-select-panel" id="fSitePanel">
              <label class="multi-opt"><input type="checkbox" value="de"> 🇩🇪 德国</label>
              <label class="multi-opt"><input type="checkbox" value="uk"> 🇬🇧 英国</label>
              <label class="multi-opt"><input type="checkbox" value="us"> 🇺🇸 美国</label>
              <label class="multi-opt"><input type="checkbox" value="fr"> 🇫🇷 法国</label>
              <label class="multi-opt"><input type="checkbox" value="it"> 🇮🇹 意大利</label>
              <label class="multi-opt"><input type="checkbox" value="es"> 🇪🇸 西班牙</label>
              <label class="multi-opt"><input type="checkbox" value="jp"> 🇯🇵 日本</label>
              <label class="multi-opt"><input type="checkbox" value="ca"> 🇨🇦 加拿大</label>
              <label class="multi-opt"><input type="checkbox" value="in"> 🇮🇳 印度</label>
              <div class="multi-actions"><button type="button" class="btn small" id="fSiteClear">✕ 清除</button><button type="button" class="btn small primary" id="fSiteApply">✓ 确定</button></div>
            </div>
          </div>
        </div>
        <div class="filter-item"><label>类目 (一级)</label><select id="fCat1" class="select"></select></div>
        <div class="filter-item"><label>类目 (二级)</label><select id="fCat2" class="select"></select></div>
      </div>
      <div class="toolbar" style="margin:10px 0 0">
        <button id="fApply" class="btn primary">✓ 应用筛选</button>
        <button id="fReset" class="btn">✕ 清除</button>
        <span class="muted">价格/月销用「最小值-最大值」格式; 站点按住 Ctrl/Shift 多选</span>
      </div>
    </div>
    <div class="toolbar filter-toolbar" style="margin-bottom:12px">
      <span class="muted" id="cSelInfo" style="flex-shrink:0">已选 0 项</span>
      <button id="cSave" class="btn small" style="flex-shrink:0">💾 保存选中</button>
      <button id="cClaim" class="btn small" style="flex-shrink:0">批量认领</button>
      <button id="cSync" class="btn small" style="flex-shrink:0">批量同步</button>
      <button id="cDelete" class="btn small danger-btn" style="flex-shrink:0">批量删除</button>
      <button id="cClear" class="btn small danger-btn" style="flex-shrink:0">一键清空</button>
      <span style="flex:1"></span>
      <button id="cExportTxt" class="btn small" style="flex-shrink:0">导出文本</button>
      <button id="cExportCsv" class="btn small" style="flex-shrink:0">导出表格</button>
      <button id="cReset" class="btn small" style="flex-shrink:0" title="恢复初始 50 条种子数据">↩ 重置</button>
    </div>
    <div class="card table-card" style="padding:0"><div id="cTableWrap" style="overflow-x:auto">
      <table id="cTable" style="min-width:1400px">
      <thead><tr>
        <th style="width:34px"><input type="checkbox" id="cAll"></th>
        <th title="父类排名 (宽类目). 采不到时显示「未采到」, 不再用子类排名顶替">父类排名</th><th>跟卖数</th><th>价格</th><th>操作</th><th>商品</th><th>品牌</th><th>备案/商标</th><th>配送</th><th>30天销量</th><th>ASIN</th><th>细分排名</th><th>标签</th><th>卖家</th><th>站点</th><th>上架时间</th>
      </tr></thead><tbody></tbody></table>
      </div>
      <!-- 粘性横向滚动条 (跟随视口) -->
      <div class="h-scroll-track" id="cHScroll"><div class="h-scroll-spacer"></div></div>
      <!-- 分页 -->
      <div class="pagination" style="padding:10px 14px;display:flex;align-items:center;gap:10px;justify-content:flex-end">
        <span class="muted" id="cPageInfo"></span>
        <button id="cPagePrev" class="btn small" disabled>◀ 上一页</button>
        <button id="cPageNext" class="btn small">下一页 ▶</button>
        <select id="cPageSize" class="select" style="width:90px"><option value="20">20/页</option><option value="50" selected>50/页</option><option value="100">100/页</option><option value="200">200/页</option></select>
      </div>
    </div>
  `;
  const tbody = $('#cTable tbody');

  const selected = new Set();
  // 页码/每页条数初值取上次记忆: 刷新页面、切走再回来都还在当前页(不再是每次回第 1 页)
  let page = Math.max(1, Number(readPmList().page) || 1);
  let pageSize = [20, 50, 100, 200].indexOf(Number(readPmList().size)) >= 0 ? Number(readPmList().size) : 50;

  // ===== 粘性横向滚动条: 与表格容器双向同步 =====
  const tableWrap = $('#cTableWrap');
  const hScroll = $('#cHScroll');
  let syncing = false;
  const syncScroll = () => {
    if (!tableWrap || !hScroll) return;
    const spacer = hScroll.querySelector('.h-scroll-spacer');
    spacer.style.width = tableWrap.scrollWidth + 'px';  // 撑开轨道滚动范围
    // 表格滚动 → 轨道跟随
    tableWrap.addEventListener('scroll', () => {
      if (syncing) return;
      syncing = true;
      hScroll.scrollLeft = tableWrap.scrollLeft;
      syncing = false;
    });
    // 轨道滚动 → 表格跟随
    hScroll.addEventListener('scroll', () => {
      if (syncing) return;
      syncing = true;
      tableWrap.scrollLeft = hScroll.scrollLeft;
      syncing = false;
    });
  };
  syncScroll();

  const renderList = (items, withCompliance) => {
    // 分页切片
    const total = items.length;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const hasData = items.length > 0;
    // ★ 越界回收只在「真有数据」时做: 首次渲染/刷新后数据还没回来的那一刻 items 是空的,
    //   pages 会是 1 —— 那时回收会把记忆里的页码冲成 1(刷新一次记忆就没了, 实测踩到)。
    if (hasData && page > pages) page = pages;         // 删了商品/换了每页条数 → 收到最后一页
    // 注意: 页码**不在这里落盘** —— 只有用户真的点了翻页/改了每页条数/改了筛选才写。
    // (renderList 会被很多程序化路径调用, 在里面写盘会把记忆值冲成 1 —— 这正是"刷新后回第 1 页"的根因)
    const start = (page - 1) * pageSize;
    const pageItems = items.slice(start, start + pageSize);
    // 更新分页信息
    $('#cPageInfo').textContent = `第 ${hasData ? page : 1}/${pages} 页 · 共 ${total} 条`;
    $('#cPagePrev').disabled = page <= 1;
    $('#cPageNext').disabled = page >= pages;
    tbody.innerHTML = pageItems.map((p) => {
      const fulfill = p.amazonSell
        ? '<span class="badge amz">AMZ 自营</span>'
        : `<span class="badge ${p.fulfill === 'FBA' ? 'fba' : 'fbm'}">${p.fulfill}</span>`;
      const saved = p.saved ? ' <span class="badge low" title="已保存到产品库">已保存</span>' : '';
      // 备案/商标 (悬停显示注册国家, 点击弹窗查看详情)
      const tmCountries = Array.isArray(p.tmCountries) ? p.tmCountries : [];
      const tmTitle = tmCountries.length ? '商标注册国家: ' + tmCountries.join('、') : (p.trademarkCount ? `商标记录 ${p.trademarkCount} 条${p.tmText ? ' · ' + p.tmText : ''}` : '');
      const tmHint = (tmTitle ? ` title="${esc(tmTitle)}"` : '') + ' style="cursor:help" data-tmasin="' + esc(p.asin) + '"';
      const tmCountBadge = tmCountries.length ? `<span class="tm-count">${tmCountries.length}国</span>` : '';
      const bs = p.brandStatus === 'registered' ? `<span class="badge danger"${tmHint}>已备案${tmCountBadge}</span>`
        : p.brandStatus === 'unchecked' ? `<span class="badge medium"${tmHint}>有商标${tmCountBadge}</span>`
        : p.trademarkCount > 0 ? `<span class="badge medium"${tmHint}>${p.trademarkCount}商标${tmCountBadge}</span>`
        : p.brandStatus === 'notfound' || (p.brandStatus == null && p.source === 'cdp-panel') ? '<span class="badge low">未查到</span>'
        : '<span class="badge low">未查到</span>';
      // ★ 父类 / 子类排名严格分离 (2026-09-14 修正): 只认后端独立字段 rankParent / rankChild, 绝不从 rank / bsr 里猜。
      //   原因: rank 是"所有可用排名里的最大值"(供筛选用), 当商品只有子类排名时它装的就是子类数值 ——
      //   此前用它当父类排名显示, 于是"父类排名"和"子类排名"看起来永远是同一个数字(即"没有分隔开")。
      const bsrTxt = (p.rankChild != null)
        ? `<span class="pill">#${esc(p.rankChild)} ${esc(String(p.rankChildCat || '').slice(0, 18))}</span>`
        : (Array.isArray(p.bsr) && p.bsr.length ? p.bsr.map((b) => `<span class="pill">#${esc(b.rank)} ${esc(String(b.category || '').slice(0, 18))}</span>`).join('') : '-');
      const bigRank = (p.rankParent != null) ? '#' + p.rankParent : '';
      const smallRank = (p.rankChild != null) ? p.rankChild : null;
      // 商品亚马逊链接 (按站点生成跳转链接)
      const amzHost = 'www.amazon.' + ({ uk: 'co.uk', us: 'com', jp: 'co.jp', au: 'com.au', mx: 'com.mx', br: 'com.br', de: 'de', fr: 'fr', it: 'it', es: 'es', ca: 'ca', in: 'in' }[p.site] || p.site || 'de');
      return `<tr>
        <td><input type="checkbox" class="row-cb" value="${esc(p.asin)}" ${selected.has(p.asin) ? 'checked' : ''}></td>
        <td class="muted" title="父类排名 (宽类目). 未采到 = 采集时没拿到插件面板的「店铺选品」排名, 可用「补采排名」补; 这不是子类排名">${p.rankParent != null ? esc('#' + p.rankParent) : '<span style="opacity:.55">未采到</span>'}</td>
        <td>${p.followCount ?? '-'}</td>
        <td>${p.minPrice != null ? '<b>' + fmtMoney(p.minPrice, p.currency) + '</b>' + (p.buyBoxPrice != null && p.buyBoxPrice !== p.minPrice ? `<br><span class="muted" title="BuyBox价">${fmtMoney(p.buyBoxPrice, p.currency)}</span>` : '') : fmtMoney(p.price, p.currency)}</td>
        <td style="white-space:nowrap">
          <a class="btn small" href="${esc('https://' + amzHost + '/dp/' + p.asin)}" target="_blank" rel="noopener" title="在亚马逊打开商品">⧉ 链接</a>
          <button class="btn small row-backfill" data-asin="${esc(p.asin)}" title="补采这一个商品: 重读详情页字段 + 插件面板(商标/月销), 只作用于本行, 无需勾选">补采</button>
          <button class="btn small row-save" data-asin="${esc(p.asin)}" title="${p.saved ? '取消保存' : '保存到产品库'}">${p.saved ? '★' : '☆'}</button>
          <button class="btn small row-claim" data-asin="${esc(p.asin)}" title="认领到草稿箱"></button>
          <button class="btn small row-del" data-asin="${esc(p.asin)}" title="删除"></button>
        </td>
        <td style="max-width:400px"><div style="display:flex;align-items:center;gap:8px">${bigRank ? `<span class="big-rank" title="父类排名 (宽类目)">${esc(bigRank)}</span>` : ''}${p.mainImage ? `<img src="${esc(p.mainImage)}" alt="" title="点击查看详情" class="p-main-img" data-asin="${esc(p.asin)}" loading="lazy">` : `<span class="p-main-img ph" data-asin="${esc(p.asin)}" title="点击查看详情"></span>`}<a class="title-link" data-asin="${esc(p.asin)}" title="点击查看详情">${esc(p.title.slice(0, 55))}${p.title.length > 55 ? '…' : ''}</a></div></td>
        <td><b>${esc(p.brand)}</b></td>
        <td>${bs}</td>
        <td>${fulfill}</td>
        <td>${fmtNum(p.monthlySales)}</td>
        <td class="mono">${esc(p.asin)}</td>
        <td style="max-width:190px">${bsrTxt}${smallRank != null ? `<div class="small-rank" title="子类排名 (细分类目)">小 ${fmtNum(smallRank)}</div>` : ''}</td>
        <td style="white-space:nowrap">${(p.badge === 'bestseller' ? '<span class="badge gold">Best</span>' : p.badge === 'choice' ? '<span class="badge blue">⭐ A</span>' : p.badge === 'deal' ? '<span class="badge danger">Deal</span>' : p.badge === 'newrelease' ? '<span class="badge newrelease">新品</span>' : '')}${p.aplus ? '<span class="badge aplus">A+</span>' : ''}${p.is1688 ? (p.is1688Url ? `<a class="badge b1688" href="${esc(p.is1688Url)}" target="_blank" rel="noopener" title="打开 1688 同款商品">1688</a>` : '<span class="badge b1688" title="有 1688 同款 (可找货源)">1688</span>') : ''}${p.bgMark ? '<span class="badge danger" title="BG标 (蓝色品牌标, 已备案品牌)">BG</span>' : ''}${p.tmMark ? '<span class="badge medium" title="TM标 (商标申请中)">TM</span>' : ''}${p.patentRisk ? '<span class="badge danger" title="专利库风险匹配">专利</span>' : ''}</td>
        <td>${esc(p.sellerId || '')}${p.chinaSeller ? '<br><span class="badge danger">中国卖家</span>' : ''}</td>
        <td class="muted">${esc(p.site || '-')}</td>
        <td class="muted" style="white-space:nowrap">${esc(p.listedAt || '-')}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="16" class="empty">无匹配商品 (可点击「📡 去采集」添加)</td></tr>';

    // 事件绑定
    $$('.title-link', tbody).forEach((a) => a.addEventListener('click', () => openProductDetail(a.dataset.asin)));
    // 备案/商标 badge 点击 → 弹窗查看商标注册国家
    $$('.badge[data-tmasin]', tbody).forEach((el) => el.addEventListener('click', async (e) => {
      e.stopPropagation();
      const d = await API('/api/products/detail?asin=' + encodeURIComponent(el.dataset.tmasin));
      if (d.error) { await zyAlert(d.error); return; }
      const cs = Array.isArray(d.tmCountries) ? d.tmCountries : [];
      showModal({
        title: '商标注册国家',
        body: `<div style="font-size:13px">
          <div class="muted" style="margin-bottom:8px">${esc(d.asin)} · ${esc(d.brand)} ${d.brandStatus === 'registered' ? '<span class="badge danger">已备案</span>' : `<span class="badge medium">${d.trademarkCount}条商标</span>`}</div>
          ${cs.length ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px">${cs.map((c) => `<span class="tm-country-chip">${esc(c)}</span>`).join('')}</div>` : '<div class="muted">未采集到商标注册国家数据 (详情页插件面板可采集)</div>'}
          ${d.tmText ? `<div class="muted" style="font-size:12px">商标原文: ${esc(d.tmText)}</div>` : ''}
        </div>`,
        buttons: [{ label: '关闭', value: 'ok' }],
      });
    }));
    $$('.p-main-img', tbody).forEach((im) => im.addEventListener('click', () => {
      // 有主图 → 大图灯箱(带放大镜); 占位 → 打开详情
      if (im.tagName === 'IMG') openImageLightbox(im.src, im.closest('tr') ? im.closest('tr').querySelector('.title-link')?.textContent || '' : '');
      else openProductDetail(im.dataset.asin);
    }));
    // 主图: 悬停预览已删(2026-09), 只保留点击打开放大镜灯箱
    $$('.row-cb', tbody).forEach((cb) => cb.addEventListener('change', () => {
      if (cb.checked) selected.add(cb.value); else selected.delete(cb.value);
      updateSel();
    }));
    $$('.row-save', tbody).forEach((b) => b.addEventListener('click', async () => {
      await API('/api/products/save', { method: 'POST', body: JSON.stringify({ asins: [b.dataset.asin], saved: b.textContent === '☆' }) });
      reload();
    }));
    $$('.row-claim', tbody).forEach((b) => b.addEventListener('click', async () => {
      const r = await API('/api/claims', { method: 'POST', body: JSON.stringify({ asin: b.dataset.asin }) });
      await zyAlert(r.error || `✔ 已认领: ${b.dataset.asin}`);
    }));
    $$('.row-del', tbody).forEach((b) => b.addEventListener('click', async () => {
      if (!await zyConfirm(`确定删除 ${b.dataset.asin} 吗?`)) return;
      await API('/api/products/delete', { method: 'POST', body: JSON.stringify({ asins: [b.dataset.asin] }) });
      selected.delete(b.dataset.asin);
      reload();
    }));
    // 行内「补采」: 只补这一行 (无需勾选)。绑在 renderList 内 —— 表格每次重绘都会重建这些按钮节点。
    $$('.row-backfill', tbody).forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      runBackfill([b.dataset.asin]);
    }));

    // 渲染后更新粘性滚动条轨道宽度
    if (hScroll && tableWrap) {
      const spacer = hScroll.querySelector('.h-scroll-spacer');
      if (spacer) spacer.style.width = Math.max(tableWrap.scrollWidth, tableWrap.clientWidth + 1) + 'px';
    }
  };

  const updateSel = () => { $('#cSelInfo').textContent = `已选 ${selected.size} 项`; };

  let items = (await API('/api/products')).items;
  $('#cCount').textContent = `共 ${items.length} 条`;
  renderList(items, false);

  const reload = async () => {
    const q = new URLSearchParams();
    if ($('#cFba').value) q.set('fba', $('#cFba').value);
    if ($('#cSell').value) q.set('sell', $('#cSell').value);
    if ($('#cBadge').value) q.set('badge', $('#cBadge').value);
    if ($('#cSearch').value) q.set('q', $('#cSearch').value);
    // 自定义筛选
    if ($('#fPriceRange').value) q.set('priceRange', $('#fPriceRange').value);
    if ($('#fSalesRange').value) q.set('salesRange', $('#fSalesRange').value);
    if ($('#fRankMax').value) q.set('rankMax', $('#fRankMax').value);
    if ($('#fRating').value) q.set('ratingMin', $('#fRating').value);
    if ($('#fBadgeNot').value) q.set('badgeNot', $('#fBadgeNot').value);      // ★ 页面标识(排除法)
    if ($('#fHasRankOnly').checked) q.set('hasRankOnly', '1');                // ★ 排除没有排名的商品 (只看有排名)
    if ($('#fTmMax').value) q.set('tmMax', $('#fTmMax').value);
    if ($('#fChina').value !== '') q.set('china', $('#fChina').value);
    // 站点多选 (checkbox 面板)
    const sites = [...document.querySelectorAll('#fSitePanel input[type="checkbox"]:checked')].map((c) => c.value);
    if (sites.length) q.set('site', sites.join(','));
    const catV = $('#fCat2') && $('#fCat2').value ? $('#fCat2').value : (($('#fCat1') && $('#fCat1').value) || '');
    if (catV) q.set('category', catV);
    const data = await API('/api/products?' + q.toString());
    items = data.items;
    $('#cCount').textContent = `共 ${items.length} 条`;
    renderList(items, false);
  };
  const getSelAsins = () => [...selected];
  // 搜索/筛选变更 → 回到第一页。
  // ★ 必须判断"值真的变了": 初始化/程序化触发的 change(值没变)如果也重置页码,
  //   就会出现「刷新后明明记住了第 3 页, 一进页面又被顶回第 1 页」(实测踩到)。
  const filterSnap = () => [$('#cFba').value, $('#cSell').value, $('#cBadge').value, $('#cSearch').value].join('\u0001');
  let lastFilterSnap = filterSnap();
  const reloadFromTop = () => {
    const snap = filterSnap();
    if (snap === lastFilterSnap) { reload(); return }     // 值没变 → 只刷新数据, 不动页码
    lastFilterSnap = snap;
    page = 1; writePmList({ page: 1, size: pageSize });   // 用户真的改了筛选 → 回第 1 页并记下来
    reload();
  };

  $('#cSearch').addEventListener('input', reloadFromTop);
  $('#cFba').addEventListener('change', reloadFromTop);
  $('#cSell').addEventListener('change', reloadFromTop);
  $('#cBadge').addEventListener('change', reloadFromTop);
  // 自定义筛选面板开关
  $('#cFilter').addEventListener('click', () => {
    const panel = $('#cFilterPanel');
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    $('#cFilter').textContent = panel.style.display === 'none' ? '🎛 自定义筛选' : '🎛 收起筛选';
  });
  // 补采排名: 对无排名商品批量读详情 BSR (耗时较长, 可停止)
  $('#cRefreshRank').addEventListener('click', async () => {
    if (!await zyConfirm('将对所有无排名商品逐个打开详情页补采 BSR 排名 (每个约 8 秒, 可在「商品采集」页点停止中断)。确定开始?')) return;
    const btn = $('#cRefreshRank');
    btn.textContent = '补采中…'; btn.disabled = true;
    const poll = setInterval(async () => {
      try { const pg = await API('/api/collect/progress'); if (pg && pg.running) $('#cCount').textContent = `补采排名中: ${pg.items} 个, 已补 ${pg.added}`; } catch {}
    }, 3000);
    try {
      const r = await API('/api/products/refresh-ranks', { method: 'POST', body: JSON.stringify({}) });
      clearInterval(poll);
      await zyAlert('✅ 补采排名完成', `共处理 <b>${r.done}</b> 个商品, 补到排名 <b>${r.addedRank}</b> 个, 失败 ${r.fail} 个${r.stopped ? '<br><span style="color:#b00020">⏹ 已手动停止</span>' : ''}`);
    } catch (e) {
      clearInterval(poll);
      await zyAlert('❌ 补采失败', e && e.message || e);
    }
    btn.textContent = '补采排名'; btn.disabled = false;
    reload();
  });

  // ===== 补采 (只针对指定商品): 详情页字段 + 插件面板 + 可选 aod 跟卖 =====
  // 为什么需要它: 采集链路已统一"不跳详情页", 详情页专属字段(价格/主图/评分/评论/类目/BSR/A+)
  // 和插件面板字段(商标/月销/尺寸重量/FBA费用)改由这里按需补 —— 所以它是详情数据的唯一入口。
  // 两步都是串行 CDP: 详情约 8s/个, 面板约 15~40s/个; 全程可点「停止」中断, 已采数据都会入库。
  const runBackfill = async (asins) => {
    const list = [...new Set((asins || []).filter(Boolean))];
    // ★ 未勾选就提示 (不默认跑全库 —— 那是几小时的事)
    if (!list.length) {
      await zyAlert('⚠️ 请先勾选商品', '「一键补采」只作用于<b>勾选</b>的商品, 不会自动补全库。<br>请先勾选商品前面的方框, 或直接点某一行的「补采」按钮。');
      return;
    }
    const f = await zyPromptForm(`🔄 补采 ${list.length} 个商品`, [
      { field: 'depth', label: '补采内容', type: 'select', default: 'both', options: [
        { value: 'both', label: '详情字段 + 插件面板 (推荐)' },
        { value: 'detail', label: '只补详情字段 (价格/主图/评分/评论/类目/BSR/A+)' },
        { value: 'panel', label: '只补插件面板 (商标/月销/尺寸重量/FBA费用)' },
        { value: 'both_aod', label: '详情 + 面板 + aod 跟卖卖家 (最慢)' },
      ] },
    ], { hint: '详情约 8 秒/个, 插件面板约 15~40 秒/个, 串行执行; 可随时在「商品采集」页点「停止」中断 (已采数据已入库)。' });
    if (!f) return;
    const depth = f.depth || 'both';
    const doDetail = depth === 'both' || depth === 'detail' || depth === 'both_aod';
    const doPanel = depth === 'both' || depth === 'panel' || depth === 'both_aod';
    const doAod = depth === 'both_aod';
    const btn = $('#cBackfill');
    if (btn) { btn.disabled = true; btn.textContent = '补采中…'; }
    const poll = setInterval(async () => {
      try { const pg = await API('/api/collect/progress'); if (pg && pg.running) $('#cCount').textContent = `补采中: ${pg.items || 0} 个, 已补 ${pg.added || 0}`; } catch {}
    }, 2000);
    const lines = [];
    try {
      if (doDetail) {
        const r = await API('/api/products/refresh-detail', { method: 'POST', body: JSON.stringify({ asins: list }) });
        if (r.error) throw new Error('详情补采失败: ' + r.error);
        lines.push(`详情字段: 处理 <b>${r.total || 0}</b> 个, 成功 <b>${r.fixed || 0}</b>, 失败 ${r.failed || 0}`);
      }
      if (doPanel) {
        const r = await API('/api/products/panel-refresh', { method: 'POST', body: JSON.stringify({ asins: list }) });
        if (r.error) throw new Error('面板补采失败: ' + r.error);
        lines.push(`插件面板: 更新 <b>${r.updated || 0}</b> 个, 失败 ${r.failed || 0}${r.note ? ' (' + esc(r.note) + ')' : ''}`);
      }
      if (doAod) {
        const r = await API('/api/collect/follow-shop-aod', { method: 'POST', body: JSON.stringify({ urls: list, maxItems: 10, maxPages: 1, concurrency: 4, excludeSellers: '', amazonWords: 'amazon,亚马逊' }) });
        if (r.error) throw new Error('aod 跟卖补采失败: ' + r.error);
        lines.push(`aod 跟卖: 店铺成功 <b>${r.shopOk || 0}</b>, 失败 ${r.shopFail || 0}, 采到商品 <b>${r.productCount || 0}</b> 个, 新增 ${r.added || 0}`);
      }
      clearInterval(poll);
      await zyAlert('✅ 补采完成', lines.join('<br>') + `<div class="muted" style="margin-top:6px">共 ${list.length} 个商品</div>`);
    } catch (e) {
      clearInterval(poll);
      await zyAlert('❌ 补采失败', ((e && e.message) || e) + (lines.length ? '<br><br>已完成:<br>' + lines.join('<br>') : ''));
    }
    if (btn) { btn.disabled = false; btn.textContent = '一键补采'; }
    reload();
  };
  // 一键补采: 只作用于勾选商品 (未勾选 → runBackfill 内部提示)
  $('#cBackfill').addEventListener('click', () => runBackfill(getSelAsins()));

  // 批量 1688 图搜找货: 选中商品 → 逐个上传主图到 1688 以图搜图 → 自动存第一个同款货源
  $('#c1688Search').addEventListener('click', async () => {
    const sel = getSelAsins();
    const targets = sel.length ? sel : (items.filter((x) => x.mainImage).slice(0, 10).map((x) => x.asin));
    if (!targets.length) return await zyAlert('请先勾选商品 (或库中无主图商品)');
    if (!await zyConfirm(`将对 ${targets.length} 个商品逐个上传主图到 1688 以图搜图 (每个约 30 秒, 可停止)。确定开始?`)) return;
    const btn = $('#c1688Search');
    btn.textContent = '图搜中…'; btn.disabled = true;
    const results = [];
    for (let i = 0; i < targets.length; i++) {
      const asin = targets[i];
      $('#cCount').textContent = `1688 图搜 ${i + 1}/${targets.length}: ${asin}`;
      try {
        const r = await API('/api/products/1688-search-upload', { method: 'POST', body: JSON.stringify({ asin }) });
        let stored = 0;
        if (r.ok && r.items && r.items.length) {
          const g0 = r.items[0];
          const prod = items.find((x) => x.asin === asin);
          const list = (prod && prod.sourceGoods) ? prod.sourceGoods.slice() : [];
          list.push({ platform: '1688', url: g0.url, title: g0.title, price: g0.priceRaw || g0.price, addedAt: new Date().toISOString().slice(0, 19).replace('T', ' ') });
          await API('/api/products/goods', { method: 'POST', body: JSON.stringify({ asin, goods: list }) });
          stored = 1;
        }
        results.push({ asin, count: r.count || 0, stored, error: r.error });
      } catch (e) {
        results.push({ asin, count: 0, stored: 0, error: e && e.message || e });
      }
    }
    btn.textContent = '1688 图搜找货'; btn.disabled = false;
    reload();
    const ok = results.filter((x) => x.count > 0).length;
    const rows = results.map((x) => `<div style="padding:2px 0">${x.asin}: ${x.error ? '✗ ' + x.error : '找到 ' + x.count + ' 个同款, 已存 ' + x.stored + ' 个'}</div>`).join('');
    await zyAlert('✅ 1688 批量图搜完成', `共处理 <b>${results.length}</b> 个商品, <b>${ok}</b> 个找到同款货源 (已自动存入第一个货源到商品)<div style="margin-top:6px;background:#f6f6f6;border-radius:6px;padding:8px;font-size:12px;max-height:240px;overflow-y:auto">${rows}</div>`);
  });
  $('#fApply').addEventListener('click', () => { page = 1; writePmList({ page: 1, size: pageSize }); reload(); });
  // 商品管理页类目联动 (一级 → 二级), 切换后自动刷新列表
  // 类目树选择同样只在"值真的变了"时回第 1 页 —— 初始化/恢复筛选时派发的 change 不该重置页码
  const catSnap = () => (($('#fCat1') || {}).value || '') + '\u0001' + (($('#fCat2') || {}).value || '');
  let lastCatSnap = catSnap();
  bindCategoryTree('fCat1', 'fCat2', () => {
    const snap = catSnap();
    if (snap === lastCatSnap) { reload(); return }
    lastCatSnap = snap;
    page = 1; writePmList({ page: 1, size: pageSize });
    reload();
  });
  $('#fReset').addEventListener('click', () => {
    ['fPriceRange', 'fSalesRange', 'fRankMax', 'fRating', 'fTmMax'].forEach((id) => { $('#' + id).value = ''; });
    $('#fBadgeNot').value = '';
    $('#fHasRankOnly').checked = false;
    $('#fChina').value = '';
    $('#fCat1').value = ''; $('#fCat1').dispatchEvent(new Event('change'));
    $('#fCat2').value = '';
    document.querySelectorAll('#fSitePanel input[type="checkbox"]').forEach((c) => { c.checked = false; });
    updateSiteTrigger();
    page = 1; writePmList({ page: 1, size: pageSize });     // 用户点了"清除筛选" → 回第 1 页并记住
    reload();
  });
  // 站点多选下拉: 展开/收起 + 状态更新
  const SITE_LABELS = { de: '🇩🇪 德国', uk: '🇬🇧 英国', us: '🇺🇸 美国', fr: '🇫🇷 法国', it: '🇮🇹 意大利', es: '🇪🇸 西班牙', jp: '🇯🇵 日本', ca: '🇨🇦 加拿大', in: '🇮🇳 印度' };
  const updateSiteTrigger = () => {
    const checked = [...document.querySelectorAll('#fSitePanel input[type="checkbox"]:checked')].map((c) => c.value);
    $('#fSiteTrigger').textContent = checked.length ? `🌍 ${checked.map((v) => SITE_LABELS[v]).join(' ')} ▾` : '🌍 全部站点 ▾';
  };
  $('#fSiteTrigger').addEventListener('click', (e) => {
    e.stopPropagation();
    $('#fSitePanel').classList.toggle('open');
  });
  $('#fSitePanel').addEventListener('click', (e) => e.stopPropagation());
  $$('#fSitePanel input[type="checkbox"]').forEach((c) => c.addEventListener('change', updateSiteTrigger));
  $('#fSiteClear').addEventListener('click', () => {
    document.querySelectorAll('#fSitePanel input[type="checkbox"]').forEach((c) => { c.checked = false; });
    updateSiteTrigger();
  });
  $('#fSiteApply').addEventListener('click', () => {
    $('#fSitePanel').classList.remove('open');
    page = 1; writePmList({ page: 1, size: pageSize });    // 用户改了站点筛选 → 回第 1 页并记住
    reload();
  });
  /* ★ 2026-11-10 修复: 这里原来每次渲染都往 document 挂一个新的 click 监听, 且回调里直接
   *   $('#fSitePanel').classList.remove('open') —— 离开商品管理后该节点已不存在,
   *   于是之后【每次点击任意位置】都抛 "Cannot read properties of null (reading 'classList')",
   *   而且回访商品管理还会不断叠加监听器。改成全局只挂一次 + 空值保护。 */
  if (!window.__zySitePanelCloser) {
    window.__zySitePanelCloser = true;
    document.addEventListener('click', () => {
      ['fSitePanel', 'cfSitePanel'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('open');
      });
    });
  }
  // 翻页（★ 用户操作 → 立刻落盘, 这是"保持当前页"的落盘点)
  $('#cPagePrev').addEventListener('click', () => { if (page > 1) { page--; writePmList({ page, size: pageSize }); renderList(items, false); } });
  $('#cPageNext').addEventListener('click', () => {
    const pages = Math.max(1, Math.ceil(items.length / pageSize));
    if (page < pages) { page++; writePmList({ page, size: pageSize }); renderList(items, false); }
  });
  $('#cPageSize').addEventListener('change', (e) => { pageSize = parseInt(e.target.value, 10); page = 1; writePmList({ page: 1, size: pageSize }); renderList(items, false); });
  $('#cAll').addEventListener('change', (e) => {
    const checked = e.target.checked;
    $$('.row-cb', tbody).forEach((cb) => { cb.checked = checked; if (checked) selected.add(cb.value); else selected.delete(cb.value); });
    updateSel();
  });



  $('#goCollect').addEventListener('click', () => navigate('collect'));

  // 批量保存
  $('#cSave').addEventListener('click', async () => {
    if (!getSelAsins().length) return await zyAlert('请先勾选商品');
    await API('/api/products/save', { method: 'POST', body: JSON.stringify({ asins: getSelAsins(), saved: true }) });
    await zyAlert(`✔ 已保存 ${getSelAsins().length} 个商品到产品库`);
    reload();
  });

  // 批量认领
  $('#cClaim').addEventListener('click', async () => {
    if (!getSelAsins().length) return await zyAlert('请先勾选商品');
    let ok = 0;
    for (const asin of getSelAsins()) {
      const r = await API('/api/claims', { method: 'POST', body: JSON.stringify({ asin }) });
      if (!r.error) ok++;
    }
    await zyAlert(`✔ 已认领 ${ok}/${getSelAsins().length} 个到草稿箱`);
  });

  // 批量同步
  $('#cSync').addEventListener('click', async () => {
    if (!getSelAsins().length) return await zyAlert('请先勾选商品');
    const r = await API('/api/products/sync', { method: 'POST', body: JSON.stringify({ asins: getSelAsins() }) });
    await zyAlert(`🔄 已同步刷新 ${r.synced} 个商品 (价格/月销/跟卖数已更新)`);
    reload();
  });

  // 批量删除
  $('#cDelete').addEventListener('click', async () => {
    if (!getSelAsins().length) return await zyAlert('请先勾选商品');
    if (!await zyConfirm(`确定删除选中的 ${getSelAsins().length} 个商品吗?`)) return;
    const r = await API('/api/products/delete', { method: 'POST', body: JSON.stringify({ asins: getSelAsins() }) });
    await zyAlert(`🗑 已删除 ${r.deleted} 个商品, 剩余 ${r.remain} 条`);
    selected.clear();
    updateSel();
    reload();
  });

  // 一键清空
  $('#cClear').addEventListener('click', async () => {
    if (!await zyConfirm('⚠️ 确定清空全部商品吗? 清空后可点「↩ 重置」恢复种子数据。')) return;
    if (!await zyConfirm('再次确认: 真的要一键清空商品库?')) return;
    const r = await API('/api/products/clear', { method: 'POST' });
    await zyAlert(`🧹 已清空 ${r.cleared} 个商品`);
    selected.clear();
    updateSel();
    reload();
  });

  // 重置
  $('#cReset').addEventListener('click', async () => {
    if (!await zyConfirm('恢复初始 50 条种子数据?')) return;
    const r = await API('/api/products/reset', { method: 'POST' });
    await zyAlert(`↩ 已重置, 当前 ${r.total} 条`);
    reload();
  });

  // 导出文本 / 表格 (下载选中或全部)
  const doExport = (fmt) => {
    const asins = getSelAsins();
    const q = new URLSearchParams({ format: fmt });
    if (asins.length) q.set('asins', asins.join(','));
    window.open('/api/products/export?' + q.toString(), '_blank');
  };
  $('#cExportTxt').addEventListener('click', () => doExport('txt'));
  $('#cExportCsv').addEventListener('click', () => doExport('csv'));
}

/* ===== 商品采集 (6 种采集方式小模块 + 采集过滤面板 + 规则保存/加载) ===== */
async function renderCollect() {
  const content = $('#content');
  const [prod, rulesRes] = await Promise.all([API('/api/products'), API('/api/collect-rules')]);
  const ruleList = rulesRes.rules || [];
  const MODES = [
    { mode: 'category', icon: 'search', name: '类目搜索采集', desc: '关键词/类目搜索 amazon, 抓取搜索结果商品' },
    { mode: 'shop', icon: 'store', name: '跟卖店铺采集', desc: '商品aod → 出售单位 → 参观店铺 → 店铺全部商品' },
    { mode: 'batch', icon: 'refresh', name: '批量跟卖店铺采集', desc: '遍历已入库商品的跟卖卖家, 逐个跳转店铺采集' },
    { mode: 'parallel', icon: 'bolt', name: '多商品并行采集', desc: '商品aod → 验证 → 提取卖家 → 排除指定 → 并行采店铺' },
    { mode: 'bulk', icon: 'layers', name: '并行整站采集', desc: '一次并行打开N个搜索页, 批量聚合大量商品' },
    { mode: 'catmenu', icon: 'list', name: '类目菜单采集', desc: '首页 → 大类目 → 二级类目 → 查看所有结果 → 商品' },
  ];
  // Amazon 页面标识标签 (商品卡/详情页徽章) —— 面板已改为【排除法】: 填进去的标识命中即剔除
  const BADGE_OPTIONS = [
    { value: 'aplus', label: 'A+ 内容' },
    { value: 'choice', label: "Amazon's Choice (AC)" },
    { value: 'bestseller', label: 'Best Seller' },
    { value: 'bestseller1', label: '#1 Best Seller' },
    { value: 'newrelease', label: 'New Release 新品' },
    { value: 'deal', label: '限时优惠 (Limited time deal)' },
    { value: 'dealday', label: '今日特惠 (Deal of the Day)' },
    { value: 'overallpick', label: 'Overall Pick 综合首选' },
    { value: 'editorspick', label: "Editor's Pick 编辑精选" },
    { value: 'toprated', label: 'Top Rated 最高评分' },
    { value: 'climate', label: '气候友好承诺 (Climate Pledge Friendly)' },
    { value: 'smallbusiness', label: '小企业 (Small Business)' },
  ];
  // 解析区间输入 "min-max" / "min-" / "-max" / 空 → {min,max}
  content.innerHTML = `
    <!-- ① 采集过滤 (含规则) -->
    <div class="card" style="margin-bottom:12px">
      <div class="card-title">${ic('list', 16)} 采集过滤 <span class="muted" style="font-weight:400">(与商品管理自定义筛选同条件 · 被筛除的商品直接跳过不采集 · 区间格式: 最小值-最大值, 只填一边表示 ≥ 或 ≤)</span></div>
      <div class="filter-grid">
        <div class="filter-item site-multi"><label>采集站点 (多选, 按区域分组; 跟卖店铺当前站点无商品时自动尝试其他选中站点)</label>
          <div class="multi-select" id="cfSiteWrap">
            <button type="button" class="select multi-select-trigger" id="cfSiteTrigger">全部站点 ▾</button>
            <div class="multi-select-panel casc-panel" id="cfSitePanel">
              ${SITE_GROUPS.map((g) => `<div class="casc-group"><div class="casc-title">${g.region}</div>${g.sites.map((s) => `<label class="multi-opt"><input type="checkbox" class="cfSiteCb" value="${s.value}" ${s.value === 'de' ? 'checked' : ''}> ${s.label}</label>`).join('')}</div>`).join('')}
              <div class="multi-actions"><button type="button" class="btn small" id="cfSiteClear">✕ 清除</button><button type="button" class="btn small primary" id="cfSiteApply">✓ 确定</button></div>
            </div>
          </div>
          <input id="cfCustomSites" class="input" placeholder="自定义站点 (逗号分隔, 如: au,mx,br)" style="margin-top:4px">
        </div>
        <div class="filter-item"><label>配送方式</label><select id="cfFulfill" class="select"><option value="">全部</option><option value="FBA">仅 FBA</option><option value="FBM">仅 FBM</option><option value="AMZ">仅 AMZ 自营</option></select></div>
        <div class="filter-item"><label>A+ 店铺 (仅跟卖店铺采集)</label><select id="cfShopAplus" class="select"><option value="">不限</option><option value="1">仅有 A+ 店铺</option><option value="0">排除 A+ 店铺</option></select></div>
        <div class="filter-item"><label>品牌店铺 (仅跟卖店铺采集)</label><select id="cfBrandShop" class="select"><option value="">不限</option><option value="0">排除品牌店铺</option><option value="1">仅品牌店铺</option></select></div>
        <div class="filter-item"><label>品牌店筛选 (仅跟卖店铺采集, 空=不限)</label><input id="cfBrandStore" class="input" list="cfBrandList" placeholder="品牌名如 Anker 只采该品牌; 填 ! 排除所有带 Visit the X Store 链接的店铺"><datalist id="cfBrandList"><option value="Anker"></option><option value="Samsung"></option><option value="Apple"></option><option value="Xiaomi"></option><option value="Sony"></option><option value="Philips"></option><option value="Bosch"></option><option value="Logitech"></option><option value="! 排除所有品牌店链接"></option></datalist></div>
        <div class="filter-item"><label>大排名区间 (空=不限)</label><input id="cfRankRange" class="input" placeholder="如 1-200000 (大排名 = 店铺选品/所有排名取最大)"></div>
        <div class="filter-item"><label>排名 (空=不限)</label><div style="font-size:12px;padding-top:6px"><label style="display:inline-flex;gap:6px;align-items:center"><input type="checkbox" id="cfHasRankOnly"> 排除没有排名的商品 (只看有排名)</label></div></div>
        <div class="filter-item"><label>价格区间 (€/£/$, 空=不限)</label><input id="cfPriceRange" class="input" placeholder="如 10-100"></div>
        <div class="filter-item"><label>评分区间 (空=不限)</label><input id="cfRatingRange" class="input" placeholder="如 3.5-4.8"></div>
        <div class="filter-item"><label>评论数区间 (空=不限)</label><input id="cfReviewsRange" class="input" placeholder="如 50-5000"></div>
        <div class="filter-item"><label>月销量区间 (空=不限)</label><input id="cfSalesRange" class="input" placeholder="如 100-5000"></div>
        <div class="filter-item"><label>商标数区间排除 (空=不限)</label><input id="cfTmRange" class="input" placeholder="如 10-100 (排除商标数在此区间的商品)"></div>
        <div class="filter-item"><label>上架天数区间 (新品, 空=不限)</label><input id="cfNewDaysRange" class="input" placeholder="如 30-180 (上架天数在此区间)"></div>
        <div class="filter-item"><label>1688 同款</label><select id="cfIs1688" class="select"><option value="">不限</option><option value="1">仅有 1688 同款</option><option value="0">排除 1688 同款</option></select></div>
        <div class="filter-item"><label>品牌状态</label><select id="cfBrandStatus" class="select"><option value="">不限</option><option value="registered">排除已备案品牌</option><option value="tm">排除 TM 申请中</option><option value="notfound">仅未查到品牌</option></select></div>
        <div class="filter-item"><label>商标国家排除 (逗号分隔, 空=不限)</label><input id="cfTmCountries" class="input" list="cfTmCountryList" placeholder="如: 欧盟,英国,美国"><datalist id="cfTmCountryList"><option value="欧盟"></option><option value="英国"></option><option value="美国"></option><option value="德国"></option><option value="日本"></option><option value="中国"></option><option value="法国"></option><option value="意大利"></option><option value="西班牙"></option><option value="马德里"></option></datalist></div>
        <div class="filter-item badge-multi"><label>页面标识 (排除法: 逗号分隔, 命中任一即剔除; 可手写如: A+,AC,BestSeller,新品,限时)</label>
          <input id="cfBadgesNot" class="input" list="cfBadgeList" placeholder="如: A+,AC,BestSeller 或 新品,畅销 (空=不限)">
          <datalist id="cfBadgeList">${BADGE_OPTIONS.map((b) => `<option value="${b.label}">`).join('')}</datalist>
        </div>
        <div class="filter-item"><label>标题含关键词 (可输可选)</label><input id="cfQ" class="input" list="cfQList" placeholder="如: anker"><datalist id="cfQList"><option value="anker"></option><option value="usb"></option><option value="phone"></option><option value="case"></option><option value="holder"></option><option value="adapter"></option><option value="charger"></option><option value="cable"></option><option value="watch"></option><option value="gaming"></option></datalist></div>
        <div class="filter-item"><label>类目 (一级)</label><select id="cfCat1" class="select"></select></div>
        <div class="filter-item"><label>类目 (二级)</label><select id="cfCat2" class="select"></select></div>
      </div>
      <div class="toolbar" style="margin:10px 0 0">
        <button id="cfClear" class="btn">✕ 清空过滤</button>
        <span style="flex:1"></span>
        <span class="muted" id="cfActive" style="flex-shrink:0"></span>
      </div>
      <!-- 过滤规则 (整合进采集过滤) -->
      <div class="cf-rule-box">
        <div class="cf-rule-title">${ic('save', 14)} 过滤规则 <span class="muted" style="font-weight:400;font-size:12px">(保存/加载/删除过滤条件, 一键复用)</span></div>
        <div class="toolbar" style="margin-top:2px">
          <select id="cfRuleSelect" class="select" style="min-width:180px;flex-shrink:0"><option value="">— 选择规则 —</option></select>
          <button id="cfRuleSave" class="btn primary" style="flex-shrink:0">保存当前为规则</button>
          <button id="cfRuleLoad" class="btn" style="flex-shrink:0">加载选中</button>
          <button id="cfRuleDelete" class="btn danger-btn" style="flex-shrink:0">删除选中</button>
          <span class="muted" id="cfRuleInfo" style="flex-shrink:0"></span>
        </div>
        <div id="cfRuleList" style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px"></div>
      </div>
    </div>

    <!-- ② 采集方式 (停止按钮低调置于标题右侧) -->
    <div class="card" style="margin-bottom:12px">
      <div class="card-title" style="align-items:center">
        ${ic('grid', 16)} 采集方式 <span class="muted" style="font-weight:400">(点击卡片开始采集, 全程CDP无API)</span>
        <span style="flex:1"></span>
        <span class="muted" id="cfStopInfo" style="font-size:12px"></span>
        <button id="cfStopBtn" class="btn-stop" title="停止当前正在运行的采集 (已采集数据会保存入库)">${ic('stop', 14)} 停止</button>
      </div>
      <div class="collect-modes">
        ${MODES.map((m) => `<div class="collect-mode" data-mode="${m.mode}" role="button" tabindex="0"><span class="cm-emoji">${ic(m.icon, 22)}</span><span class="cm-name">${m.name}</span><span class="cm-desc">${m.desc}</span><span class="cm-progress"><span class="cm-prog-text">⏳ 启动…</span><button class="cm-stop" data-mode="${m.mode}" title="停止当前采集 (已采集数据会保存入库)">${ic('stop', 12)} 停止</button></span></div>`).join('')}
      </div>
    </div>
    <div class="card" id="cfLogCard" style="display:none">
      <div class="card-title">${ic('file', 16)} 采集结果</div>
      <div id="cfLog" style="max-height:240px;overflow-y:auto;font-size:13px"></div>
    </div>
  `;

  // 过滤面板状态显示
  const updateCfActive = () => {
    const v = cfValues();
    const parts = [];
    if (v.filterSites && v.filterSites.length) parts.push('站点:' + v.filterSites.join(','));
    if (v.filterFulfill) parts.push('配送=' + v.filterFulfill);
    if (v.filterShopAplus === '1') parts.push('仅A+店铺');
    else if (v.filterShopAplus === '0') parts.push('排除A+店铺');
    if (v.filterBrandShop === '0') parts.push('排除品牌店铺');
    else if (v.filterBrandShop === '1') parts.push('仅品牌店铺');
    if ((v.filterBrandStore || '').startsWith('!')) parts.push('排除品牌店链接');
    else if (v.filterBrandStore) parts.push('品牌店=' + v.filterBrandStore);
    const r1 = parseRange(v.filterRankRange), r2 = parseRange(v.filterPriceRange), r3 = parseRange(v.filterRatingRange), r4 = parseRange(v.filterReviewsRange), r5 = parseRange(v.filterSalesRange), r6 = parseRange(v.filterTmRange), r7 = parseRange(v.filterNewDaysRange);
    if (fmtRange(r1.min, r1.max)) parts.push('大排名:' + fmtRange(r1.min, r1.max));
    if (v.filterHasRankOnly === '1') parts.push('仅看有排名(排除没有排名)');
    if (fmtRange(r2.min, r2.max)) parts.push('价:' + fmtRange(r2.min, r2.max));
    if (fmtRange(r3.min, r3.max)) parts.push('评分:' + fmtRange(r3.min, r3.max));
    if (fmtRange(r4.min, r4.max)) parts.push('评论:' + fmtRange(r4.min, r4.max));
    if (v.filterBadgesNot && v.filterBadgesNot.length) parts.push('排除标识:' + v.filterBadgesNot.map((b) => BADGE_LABELS[b] || b).join(','));
    if (v.filterQ) parts.push('标题含「' + v.filterQ + '」');
    if (fmtRange(r6.min, r6.max)) parts.push('排除商标:' + fmtRange(r6.min, r6.max));
    if (v.filterTmCountries) parts.push('排除商标国家:' + v.filterTmCountries);
    if (fmtRange(r5.min, r5.max)) parts.push('月销:' + fmtRange(r5.min, r5.max));
    if (v.filterIs1688 === '1') parts.push('有1688同款');
    else if (v.filterIs1688 === '0') parts.push('排除1688同款');
    if (v.filterBrandStatus === 'registered') parts.push('排除已备案品牌');
    else if (v.filterBrandStatus === 'tm') parts.push('排除TM申请中');
    else if (v.filterBrandStatus === 'notfound') parts.push('仅未查到品牌');
    if (fmtRange(r7.min, r7.max)) parts.push('上架:' + fmtRange(r7.min, r7.max) + '天');
    if (v.filterCategory) parts.push('类目: ' + categoryLabelOf(v.filterCategory));
    $('#cfActive').textContent = parts.length ? `当前过滤: ${parts.join(' + ')}` : '';
  };
  // 类目联动 (一级 → 二级)
  bindCategoryTree('cfCat1', 'cfCat2', updateCfActive);
  $$('#cfSitePanel .cfSiteCb').forEach((el) => el.addEventListener('change', updateCfActive));
  // 站点级联下拉: 开关 + 状态 + 清除/确定 + 外部点击关闭
  const CF_SITE_LABELS = {}; SITE_GROUPS.forEach((g) => g.sites.forEach((s) => { CF_SITE_LABELS[s.value] = s.label; }));
  const updateCfSiteTrigger = () => {
    const checked = [...document.querySelectorAll('#cfSitePanel .cfSiteCb:checked')].map((c) => c.value);
    const custom = String($('#cfCustomSites') ? $('#cfCustomSites').value : '').split(/[,，\s]+/).filter(Boolean);
    const all = [...checked, ...custom];
    $('#cfSiteTrigger').textContent = all.length ? `${all.map((v) => CF_SITE_LABELS[v] || v.toUpperCase()).join(' ')} ▾` : '全部站点 ▾';
  };
  $('#cfSiteTrigger').addEventListener('click', (e) => { e.stopPropagation(); $('#cfSitePanel').classList.toggle('open'); });
  $('#cfSitePanel').addEventListener('click', (e) => e.stopPropagation());
  $$('#cfSitePanel .cfSiteCb').forEach((c) => c.addEventListener('change', updateCfSiteTrigger));
  $('#cfCustomSites').addEventListener('input', () => { updateCfActive(); updateCfSiteTrigger(); });
  $('#cfSiteClear').addEventListener('click', () => { document.querySelectorAll('#cfSitePanel .cfSiteCb').forEach((c) => { c.checked = false; }); updateCfSiteTrigger(); updateCfActive(); });
  $('#cfSiteApply').addEventListener('click', () => { $('#cfSitePanel').classList.remove('open'); updateCfActive(); });
  // (站点筛选面板的全局关闭监听已在上方统一挂载一次, 这里不再重复注册)
  $('#cfBadgesNot').addEventListener('input', updateCfActive);
  $('#cfHasRankOnly').addEventListener('change', updateCfActive);
  ['cfFulfill', 'cfShopAplus', 'cfBrandShop', 'cfBrandStore', 'cfRankRange', 'cfPriceRange', 'cfRatingRange', 'cfReviewsRange', 'cfSalesRange', 'cfTmRange', 'cfNewDaysRange', 'cfIs1688', 'cfBrandStatus', 'cfTmCountries', 'cfQ', 'cfCat1', 'cfCat2'].forEach((id) => {
    const el = $('#' + id);
    if (el) el.addEventListener('input', updateCfActive);
    if (el && el.tagName === 'SELECT') el.addEventListener('change', updateCfActive);
  });
  $('#cfClear').addEventListener('click', () => {
    ['cfFulfill', 'cfShopAplus', 'cfBrandShop', 'cfBrandStore', 'cfRankRange', 'cfPriceRange', 'cfRatingRange', 'cfReviewsRange', 'cfSalesRange', 'cfTmRange', 'cfNewDaysRange', 'cfIs1688', 'cfBrandStatus', 'cfTmCountries', 'cfQ', 'cfCat1', 'cfCat2'].forEach((id) => { const el = $('#' + id); if (el) el.value = ''; });
    $$('.site-chip').forEach((el) => { el.classList.toggle('active', el.dataset.site === 'de'); });
    document.querySelectorAll('#cfSitePanel .cfSiteCb').forEach((el) => { el.checked = el.value === 'de'; });
    $('#cfCustomSites').value = '';
    $('#cfBadgesNot').value = '';
    $('#cfHasRankOnly').checked = false;
    updateCfSiteTrigger();
    // 重置一级类目后二级联动刷新
    const c1 = $('#cfCat1');
    if (c1) { c1.value = ''; c1.dispatchEvent(new Event('change')); }
    updateCfActive();
  });

  // 采集方式卡片 (仅 .collect-mode, 排除卡片内停止按钮)
  $$('.collect-mode').forEach((b) => b.addEventListener('click', () => window.__openCollectFlow(b.dataset.mode, b)));
  // 卡片内停止按钮: 点击停止当前采集 (不触发采集卡片)
  $$('.cm-stop').forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    const card = b.closest('.collect-mode');
    const txt = card.querySelector('.cm-prog-text');
    txt.textContent = '⏹ 停止中…';
    try {
      await API('/api/collect/stop', { method: 'POST' });
      txt.textContent = '⏹ 已请求停止, 当前步骤完成后退出 (已采数据已保存)';
    } catch (err) { txt.textContent = '✗ 停止失败: ' + (err && err.message || err); }
  }));

  // ⏹ 停止采集: 请求后端停止标志, 各采集循环检查后提前退出 (已采集数据保留入库)
  $('#cfStopBtn').addEventListener('click', async () => {
    const info = $('#cfStopInfo');
    try {
      const r = await API('/api/collect/stop', { method: 'POST' });
      info.textContent = '⏹ 已请求停止, 当前步骤完成后将停止 (已采集数据已保存)';
      info.style.color = '#b00020';
      setTimeout(() => { info.textContent = ''; }, 8000);
    } catch (e) {
      info.textContent = '✗ ' + (e.message || '停止请求失败');
      info.style.color = '#b00020';
    }
  });

  // ===== 过滤规则: 保存/加载/删除 =====
  const fillRuleSelect = (rules) => {
    $('#cfRuleSelect').innerHTML = '<option value="">— 选择规则 —</option>' + rules.map((r) => `<option value="${esc(r.name)}">${esc(r.name)}</option>`).join('');
    $('#cfRuleList').innerHTML = rules.map((r) => `<span class="pill" data-rule="${esc(r.name)}" title="点击加载: ${esc(coDescFromRule(r))}">${esc(r.name)} <span class="muted">${esc(coDescFromRule(r))}</span></span>`).join('');
    $$('#cfRuleList .pill').forEach((p) => p.addEventListener('click', () => { loadRuleByName(rules, p.dataset.rule); }));
  };
  const coDescFromRule = (r) => {
    const f = { ...r.filter };
    const sites = (Array.isArray(f.filterSites) && f.filterSites.length) ? f.filterSites : (r.site ? [r.site] : []);
    return coDesc({ ...f, filterSites: sites }) + (sites.length ? ` | 站点:${sites.join(',')}` : '');
  };
  const loadRuleByName = (rules, name) => {
    const r = rules.find((x) => x.name === name);
    if (!r) return;
    const m = { ...r.filter };
    // select 赋值: 值不在预设选项中时动态补一个选项, 保证旧规则/自定义值可回填
    const setSel = (id, v) => {
      const el = $('#' + id);
      if (!el) return;
      if (v && ![...el.options].some((o) => o.value === String(v))) {
        el.add(new Option(String(v), String(v)));
      }
      el.value = v || '';
    };
    setSel('cfFulfill', m.filterFulfill);
    setSel('cfShopAplus', m.filterShopAplus);
    setSel('cfBrandShop', m.filterBrandShop);
    $('#cfBrandStore').value = m.filterBrandStore || '';
    setSel('cfRankRange', m.filterRankRange);
    setSel('cfPriceRange', m.filterPriceRange);
    setSel('cfRatingRange', m.filterRatingRange);
    setSel('cfReviewsRange', m.filterReviewsRange);
    $('#cfQ').value = m.filterQ || '';
    $('#cfTmRange').value = m.filterTmRange || '';
    $('#cfTmCountries').value = m.filterTmCountries || '';
    $('#cfSalesRange').value = m.filterSalesRange || '';
    setSel('cfIs1688', m.filterIs1688);
    setSel('cfBrandStatus', m.filterBrandStatus);
    $('#cfNewDaysRange').value = m.filterNewDaysRange || '';
    // 站点多选回填 (旧规则 r.site 单站点兼容; 预设之外的进自定义输入框)
    const siteList = (Array.isArray(m.filterSites) && m.filterSites.length) ? m.filterSites : (r.site ? [r.site] : ['de']);
    const presetSites = SITE_GROUPS.flatMap((g) => g.sites.map((s) => s.value));
    document.querySelectorAll('#cfSitePanel .cfSiteCb').forEach((el) => { el.checked = siteList.includes(el.value); });
    $('#cfCustomSites').value = siteList.filter((s) => !presetSites.includes(s)).join(',');
    // 页面标识回填 (排除法): 新字段 filterBadgesNot 优先; 旧规则的 filterBadges(含任一) 只能按排除法载入 → 在下方规则信息里明确提示
    const legacyBadges = (Array.isArray(m.filterBadges) && m.filterBadges.length) ? m.filterBadges : (m.filterBadge ? [m.filterBadge] : []);
    const badgeNotList = Array.isArray(m.filterBadgesNot) ? m.filterBadgesNot.filter(Boolean) : [];
    const badgeLegacyOnly = !badgeNotList.length && legacyBadges.length > 0;
    $('#cfBadgesNot').value = (badgeNotList.length ? badgeNotList : legacyBadges).join(',');
    $('#cfHasRankOnly').checked = (m.filterHasRankOnly === '1' || m.filterHasRankOnly === true);
    // 类目回填: 英文匹配词 → 反查一级/二级下拉 (不匹配则动态补二级选项)
    const catV = m.filterCategory || '';
    const catNode = CATEGORY_TREE.find((c) => c.value === catV);
    const catSub = CATEGORY_TREE.flatMap((c) => c.children.map((s) => ({ c, s }))).find((x) => x.s.value === catV);
    if (catSub) {
      $('#cfCat1').value = catSub.c.value;
      $('#cfCat1').dispatchEvent(new Event('change'));
      $('#cfCat2').value = catSub.s.value;
    } else if (catNode) {
      $('#cfCat1').value = catNode.value;
      $('#cfCat1').dispatchEvent(new Event('change'));
    } else if (catV) {
      const c2 = $('#cfCat2');
      if (c2 && ![...c2.options].some((o) => o.value === catV)) c2.add(new Option(catV, catV));
      c2.value = catV;
    }
    $('#cfRuleSelect').value = name;
    $('#cfRuleInfo').textContent = `已加载规则「${name}」`
      + (badgeLegacyOnly ? ' · ⚠ 旧规则的「页面标识(含任一)」已按新的排除法载入 (语义已变, 如需"仅有"请换其它条件)' : '')
      + ((m.filterAplus === '1' || m.filterAplus === true) ? ' · ⚠ 旧规则的 A+ 字段已废弃 (A+ 现由「页面标识(排除法)」表达)' : '');
    updateCfActive();
  };
  fillRuleSelect(ruleList);
  updateCfActive();
  updateCfSiteTrigger();

  $('#cfRuleSave').addEventListener('click', async () => {
    const name = await new Promise((resolve) => {
      showModal({
        title: '💾 保存采集过滤规则',
        body: `<div class="zy-modal-form"><div style="margin-bottom:12px"><div class="muted" style="margin-bottom:4px">规则名称</div><input class="input" id="crName" data-field="crName" placeholder="如: FBA高评分精选" value="FBA筛选${new Date().toLocaleDateString()}"></div><div class="muted">将保存: 站点 ${esc(cfSite().join(','))} + ${esc(coDesc(cfValues()))}</div></div>`,
        buttons: [{ label: '取消', value: 'no' }, { label: '保存', primary: true, value: 'ok', form: true }],
        onResult: (r, inputs) => resolve(r === 'ok' ? (inputs.crName || '').trim() : null),
      });
    });
    if (!name) return;
    const r = await API('/api/collect-rules', { method: 'POST', body: JSON.stringify({ name, site: cfSite()[0] || 'de', filter: cfValues() }) });
    $('#cfRuleInfo').textContent = r.ok ? `✔ 已保存规则「${name}」(${r.total} 条)` : r.error || '保存失败';
    await reloadRules();
  });
  $('#cfRuleLoad').addEventListener('click', async () => {
    const name = $('#cfRuleSelect').value;
    if (!name) { await zyAlert('请先在规则列表选择要加载的规则'); return; }
    const rules = await API('/api/collect-rules');
    loadRuleByName(rules.rules || [], name);
  });
  $('#cfRuleDelete').addEventListener('click', async () => {
    const name = $('#cfRuleSelect').value;
    if (!name) { await zyAlert('请先选择要删除的规则'); return; }
    if (!await zyConfirm(`确定删除规则「${name}」吗?`)) return;
    const r = await API('/api/collect-rules/delete', { method: 'POST', body: JSON.stringify({ name }) });
    $('#cfRuleInfo').textContent = r.ok ? `🗑 已删除「${name}」` : r.error || '删除失败';
    await reloadRules();
  });

  async function reloadRules() {
    const rr = await API('/api/collect-rules');
    fillRuleSelect(rr.rules || []);
  }

  // 采集页统计刷新 (openCollectFlow 完成后调用)
  window.__collectRefresh = async () => {
    try {
      const pp = await API('/api/products');
      const st = content.querySelectorAll('.stat-value')[0];
      if (st) st.textContent = pp.total;
    } catch {}
  };

  // 采集结果日志
  const logCollect = (html) => {
    const card = $('#cfLogCard');
    const log = $('#cfLog');
    if (!card || !log) return;
    card.style.display = 'block';
    log.innerHTML = html;
  };
  window.__collectLog = logCollect;
}

/* ===== 商品详情弹窗 ===== */
// 找货图搜链接: 用商品主图在 1688/淘宝/拼多多/Amazon/Alibaba 以图搜图 (无图时用标题搜索兜底)
function sourceSearchUrls(p) {
  const img = p.mainImage || '';
  const enc = encodeURIComponent(img);
  const kw = encodeURIComponent((p.title || '').slice(0, 40));
  const hostSuf = ({ uk: 'co.uk', us: 'com', jp: 'co.jp', de: 'de', fr: 'fr', it: 'it', es: 'es', ca: 'ca', in: 'in' }[p.site] || p.site || 'de');
  let alibaba = 'https://www.alibaba.com/trade/search?SearchText=' + kw;
  try { if (img) { const u = new URL(img); alibaba = 'https://www.alibaba.com/picture/search.htm?imageType=' + encodeURIComponent(u.origin + '/') + '&imageAddress=' + encodeURIComponent(u.pathname.replace(/^\//, '')); } } catch {}
  return [
    { name: '淘宝', url: img ? 'https://s.taobao.com/image?imageUrl=' + enc : 'https://s.taobao.com/search?q=' + kw },
    { name: '拼多多', url: 'https://mobile.yangkeduo.com/search_result.html?search_key=' + kw },
    { name: 'Amazon', url: img ? 'https://www.amazon.' + hostSuf + '/stylesnap/search?imageUrl=' + enc : 'https://www.amazon.' + hostSuf + '/s?k=' + kw },
    { name: 'Alibaba', url: alibaba },
  ];
}
// 各站点官方商标局查询 (品牌名自动拼入可直查的官方检索 URL, 欧盟站点额外提供 EUIPO)
function tmOffices(p) {
  const brand = (p.brand || '').trim();
  const kw = encodeURIComponent(brand);
  const kwP = encodeURIComponent(brand).replace(/%20/g, '+');
  const EU_SITES = ['de', 'fr', 'it', 'es', 'nl', 'se', 'pl'];
  const base = {
    de: { name: '德国专利商标局 DPMA', url: `https://register.dpma.de/DPMAregister/marke/partiell?query=${kw}&lang=en`, tip: '德国官方商标数据库' },
    uk: { name: '英国知识产权局 UKIPO', url: 'https://trademarks.ipo.gov.uk/ipo-tmtext', tip: '英国官方商标检索' },
    fr: { name: '法国工业产权局 INPI', url: `https://data.inpi.fr/marques?q=${kw}`, tip: '法国官方商标检索' },
    it: { name: '意大利专利商标局 UIBM', url: 'https://www.uibm.gov.it/bancadati/', tip: '意大利官方商标检索' },
    es: { name: '西班牙专利商标局 OEPM', url: 'https://consultas2.oepm.es/gestor/faces/rest/verPublicaciones.jsp?tipo=Marcas', tip: '西班牙官方商标检索' },
    nl: { name: '比荷卢知识产权局 BOIP', url: 'https://www.boip.int/nl/merken/merkenregister', tip: '荷兰/比利时/卢森堡官方商标检索' },
    se: { name: '瑞典知识产权局 PRV', url: 'https://tc.prv.se/', tip: '瑞典官方商标检索' },
    pl: { name: '波兰专利局 PUP', url: 'https://ewyszukiwarka.pue.uprp.gov.pl/search/simple', tip: '波兰官方商标检索' },
    us: { name: '美国专利商标局 USPTO', url: 'https://tmsearch.uspto.gov/search/search-information', tip: '美国官方商标检索 (TESS)' },
    ca: { name: '加拿大知识产权局 CIPO', url: `https://ised-isde.canada.ca/cipo/trademarks/search/quick?q=${kw}`, tip: '加拿大官方商标检索' },
    mx: { name: '墨西哥工业产权局 IMPI', url: 'https://siga.impi.gob.mx/', tip: '墨西哥官方商标检索' },
    br: { name: '巴西工业产权局 INPI', url: 'https://busca.inpi.gov.br/pePI/jsp/marcas/MarcaSearchBasico.jsp', tip: '巴西官方商标检索' },
    jp: { name: '日本特许厅 JPO', url: 'https://www.j-platpat.inpit.go.jp/', tip: '日本官方商标检索 (J-PlatPat)' },
    au: { name: '澳大利亚知识产权局 IP Australia', url: `https://search.ipaustralia.gov.au/trademarks/search/quick?q=${kw}`, tip: '澳大利亚官方商标检索' },
    in: { name: '印度知识产权局 IP India', url: 'https://iprsearch.ipindia.gov.in/trademarksearch/', tip: '印度官方商标检索' },
    sg: { name: '新加坡知识产权局 IPOS', url: 'https://gobusiness.ipos.gov.sg/trademarksearch/', tip: '新加坡官方商标检索' },
    ae: { name: '阿联酋经济部 MOEC', url: 'https://www.moec.gov.ae/', tip: '阿联酋商标注册与检索' },
    sa: { name: '沙特知识产权局 SAIP', url: 'https://saip.gov.sa/', tip: '沙特官方商标检索' },
  };
  const list = [];
  const o = base[p.site];
  if (o) list.push(o);
  if (EU_SITES.includes(p.site)) list.push({ name: '欧盟知识产权局 EUIPO', url: `https://euipo.europa.eu/eSearch/#basic/1+1+1+1/30+30+30+30/${kwP}`, tip: '欧盟官方商标检索 (一次覆盖全部欧盟国家)' });
  return list;
}
async function openProductDetail(asin) {
  const data = await API('/api/products/detail?asin=' + encodeURIComponent(asin));
  if (data.error) { await zyAlert(data.error); return; }
  const p = data;
  const fulfill = p.amazonSell ? '<span class="badge amz">AMZ 自营</span>' : `<span class="badge ${p.fulfill === 'FBA' ? 'fba' : 'fbm'}">${p.fulfill}</span>`;
  // 商品亚马逊链接 (按站点)
  const amzHost = 'www.amazon.' + ({ uk: 'co.uk', us: 'com', jp: 'co.jp', au: 'com.au', mx: 'com.mx', br: 'com.br', de: 'de', fr: 'fr', it: 'it', es: 'es', ca: 'ca', in: 'in' }[p.site] || p.site || 'de');

  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  mask.innerHTML = `
    <div class="modal">
      <div class="modal-head">
        <h2>${esc(p.title)}</h2>
        <button class="modal-close">✕</button>
      </div>
      <div class="modal-body">
        ${p.mainImage ? `<div style="text-align:center;margin-bottom:10px"><img src="${esc(p.mainImage)}" alt="商品主图" title="点击放大" style="max-width:220px;max-height:220px;border-radius:8px;border:1px solid #e5e5e5;object-fit:contain;cursor:zoom-in" class="det-main-img"></div>` : ''}
        <div class="toolbar" style="margin-bottom:6px">
          <span class="mono">${esc(p.asin)}</span>
          <a class="btn small" href="${esc('https://' + amzHost + '/dp/' + p.asin)}" target="_blank" rel="noopener" title="在亚马逊打开商品">⧉ 亚马逊链接</a>
          ${p.brandStatus === 'registered' ? '<span class="badge danger">已备案</span>' : p.brandStatus === 'unchecked' ? '<span class="badge medium">未核查</span>' : '<span class="badge low">未查到</span>'}
          ${p.bgMark ? '<span class="badge danger">BG标</span>' : ''}
          ${p.tmMark ? '<span class="badge medium">TM标</span>' : ''}
          ${p.patentRisk ? '<span class="badge danger">专利风险</span>' : ''}
          ${fulfill}
        </div>
        <div class="detail-grid">
          <div class="detail-item"><span class="k">品牌</span><span class="v"><b>${esc(p.brand)}</b></span></div>
          <div class="detail-item"><span class="k">商标记录</span><span class="v">${p.trademarkCount} 条${p.tmText ? ` <span class="muted" title="插件商标状态原文">(${esc(p.tmText)})</span>` : ''}</span></div>
          ${p.tmCountries && p.tmCountries.length ? `<div class="detail-item" style="flex-direction:column;align-items:flex-start;border-bottom:none">
            <span class="k">商标注册国家 (${p.tmCountries.length})</span>
            <span class="v" style="text-align:left;width:100%">
              <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px">${p.tmCountries.map((c) => `<span class="tm-country-chip">${esc(c)}</span>`).join('')}</div>
              <div class="muted" style="font-size:11px;margin-top:5px">商标已在如下国家注册</div>
            </span>
          </div>` : ''}
          <div class="detail-item"><span class="k">父类排名</span><span class="v">${p.rankParent != null ? esc('#' + p.rankParent + (p.rankParentCat ? '  ' + p.rankParentCat : '')) : '<span class="muted">未采到</span>'}</span></div>
          <div class="detail-item"><span class="k">子类排名</span><span class="v">${p.rankChild != null ? esc('#' + p.rankChild + (p.rankChildCat ? '  ' + p.rankChildCat : '')) : '<span class="muted">未采到</span>'}</span></div>
          <div class="detail-item"><span class="k">类目</span><span class="v">${esc(p.category || '-')}</span></div>
          <div class="detail-item"><span class="k">站点</span><span class="v">${esc(p.site || '-')}</span></div>
          <div class="detail-item"><span class="k">当前价格(最低跟卖)</span><span class="v"><b>${fmtMoney(p.minPrice != null ? p.minPrice : p.price, p.currency)}</b></span></div>
          ${p.buyBoxPrice != null && p.buyBoxPrice !== (p.minPrice != null ? p.minPrice : p.price) ? `<div class="detail-item"><span class="k">BuyBox 价</span><span class="v">${fmtMoney(p.buyBoxPrice, p.currency)}</span></div>` : ''}
          ${p.offerPrices && p.offerPrices.length ? `<div class="detail-item" style="flex-direction:column;align-items:flex-start;border-bottom:none">
            <span class="k">全部跟卖 (${p.offerPrices.length}个):</span>
            <span class="v" style="text-align:left;width:100%">
              ${p.offerPrices.map((o) => `<div style="padding:3px 0;border-bottom:1px dashed var(--line);display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap">
                <span><b>${fmtMoney(o.price, p.currency)}</b>${o.seller ? ` · ${o.sellerUrl ? `<a class="seller-link" href="${esc(o.sellerUrl)}" target="_blank" rel="noopener" title="点击跳转卖家店铺">${esc(o.seller)}</a>` : esc(o.seller)}` : ''}</span>
                <span class="muted" style="white-space:nowrap">${o.shipFee != null ? `运费${fmtMoney(o.shipFee, p.currency)}` : '免运费'}${o.shipDates ? ` · ${esc(o.shipDates)}` : ''}</span>
              </div>`).join('')}
            </span>
          </div>` : ''}
          <div class="detail-item"><span class="k">月销量</span><span class="v">${fmtNum(p.monthlySales)}</span></div>
          <div class="detail-item"><span class="k">评分 / 评论</span><span class="v">${p.rating ? p.rating + '★' : '-'} / ${fmtNum(p.reviews)}</span></div>
          <div class="detail-item"><span class="k">库存</span><span class="v">${fmtNum(p.stock)}</span></div>
          <div class="detail-item"><span class="k">跟卖数量</span><span class="v">${p.followCount} 个</span></div>
          <div class="detail-item"><span class="k">中国卖家</span><span class="v">${p.chinaSeller ? '是' : '否'}</span></div>
          <div class="detail-item"><span class="k">上架时间</span><span class="v">${esc(p.listedAt || '-')}</span></div>
          ${p.variants && p.variants.length ? `<div class="detail-item" style="flex-direction:column;align-items:flex-start;border-bottom:none">
            <span class="k">型号/颜色变体 (${p.variations} 个, 按变体分类价格):</span>
            <span class="v" style="text-align:left;width:100%">
              ${p.variants.map((g) => `
                <div style="margin:4px 0 2px"><b>${esc(g.dim)}</b></div>
                <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:4px">
                  ${g.options.map((o) => `<button class="btn small variant-chip ${o.selected ? 'primary' : ''}" data-vasin="${esc(o.asin)}" title="查看该变体: ${esc(o.asin)}">${esc(o.text)}${o.price != null ? ' <span class="chip-price">' + fmtMoney(o.price, p.currency) + '</span>' : ''}</button>`).join('')}
                </div>`).join('')}
              <div class="muted" style="font-size:11px">点击变体查看对应商品 · 价格为该变体 BuyBox 价</div>
            </span>
          </div>` : ''}
          <div class="detail-item"><span class="k">变体数</span><span class="v">${p.variations ?? '-'}</span></div>
          <div class="detail-item"><span class="k">重量</span><span class="v">${esc(p.weight || '-')}</span></div>
          <div class="detail-item"><span class="k">尺寸</span><span class="v">${esc(p.size || '-')}</span></div>
          <div class="detail-item"><span class="k">佣金</span><span class="v">${fmtMoney(p.referralFee, p.currency)}</span></div>
          <div class="detail-item"><span class="k">净收益(估)</span><span class="v">${fmtMoney(p.netProfit, p.currency)}</span></div>
          ${p.fbaFee != null ? `<div class="detail-item"><span class="k">FBA 配送费</span><span class="v">${fmtMoney(p.fbaFee, p.currency)}</span></div>` : ''}
          ${p.sellingPoint && p.sellingPoint.length ? `<div class="detail-item" style="flex-direction:column;align-items:flex-start;border-bottom:none">
            <span class="k">产品卖点 (${p.sellingPoint.length})</span>
            <span class="v" style="text-align:left;width:100%"><ul class="source-list" style="margin-top:2px">${p.sellingPoint.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></span>
          </div>` : ''}
          ${p.productOverview && p.productOverview.length ? `<div class="detail-item" style="flex-direction:column;align-items:flex-start;border-bottom:none">
            <span class="k">产品概要 (${p.productOverview.length} 项)</span>
            <span class="v" style="text-align:left;width:100%"><table class="ov-table"><tbody>${p.productOverview.map((o) => `<tr><td class="ov-k">${esc(o.k)}</td><td>${esc(o.v)}</td></tr>`).join('')}</tbody></table></span>
          </div>` : ''}
          ${p.packSize ? `<div class="detail-item"><span class="k">包装尺寸</span><span class="v">${esc(p.packSize)}</span></div>` : ''}
          ${p.packWeight ? `<div class="detail-item"><span class="k">包装重量</span><span class="v">${esc(p.packWeight)}</span></div>` : ''}
          ${p.mainSeller ? `<div class="detail-item"><span class="k">当前主卖家</span><span class="v">${esc(p.mainSeller)}</span></div>` : ''}
          ${p.productType ? `<div class="detail-item"><span class="k">产品类型</span><span class="v">${esc(p.productType)}</span></div>` : ''}
          ${p.shopSeller ? `<div class="detail-item"><span class="k">来源店铺</span><span class="v">${p.shopUrl ? `<a class="seller-link" href="${esc(p.shopUrl)}" target="_blank" rel="noopener" title="打开来源店铺">${esc(p.shopSeller)}</a>` : esc(p.shopSeller)}</span></div>` : ''}
          ${p.sellerPageUrl ? `<div class="detail-item"><span class="k">卖家资料页</span><span class="v"><a class="seller-link" href="${esc(p.sellerPageUrl)}" target="_blank" rel="noopener" title="打开卖家资料页">查看卖家页</a></span></div>` : ''}
          ${p.is1688Url ? `<div class="detail-item"><span class="k">1688 同款</span><span class="v"><a class="seller-link" href="${esc(p.is1688Url)}" target="_blank" rel="noopener" title="打开 1688 同款商品">打开 1688 同款</a></span></div>` : ''}
          <div class="detail-item"><span class="k">采集时间</span><span class="v">${esc(p.collectedAt || '-')}</span></div>
        </div>
        <!-- 利润测算: 站点/汇率/重量尺寸/货源成本/物流成本 → 利润与利润率 -->
        <div class="card" style="margin-top:10px;background:var(--card-bg)">
          <div class="card-title">${ic('reprice', 14)} 利润测算 <span class="muted" style="font-weight:400;font-size:12px">(售价×汇率 − 货源成本 − 物流成本 − 佣金)</span>
            <button id="dlProfitOneClick" class="btn small primary" style="margin-left:auto" title="自动获取汇率+重量尺寸+货源成本, 并自动试算物流成本后计算利润">一键计算</button>
            <button id="dlProfitCalc" class="btn small" title="按当前填写值重新计算">手动计算</button>
          </div>
          <div class="filter-grid" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr))">
            <div class="filter-item"><label>站点</label><div class="v" id="dlProfitSite" style="font-weight:600"></div></div>
            <div class="filter-item"><label>汇率 (1${esc(p.currency || '')}=? CNY)</label><div class="v" id="dlProfitRate" style="font-weight:600"></div></div>
            <div class="filter-item"><label>重量 (kg, 可改)</label><input id="dlProfitWeight" class="input" type="number" step="0.01" value=""></div>
            <div class="filter-item"><label>尺寸 (cm, 长×宽×高)</label><input id="dlProfitDims" class="input" placeholder="如 20x15x10"></div>
            <div class="filter-item"><label>货源成本 (¥, 采购价)</label><input id="dlProfitSupply" class="input" type="number" step="0.01" placeholder="1688 采购价 ¥"></div>
            <div class="filter-item"><label>物流成本 (¥, 可手动填或按报价表算)</label><input id="dlProfitLogi" class="input" type="number" step="0.01" placeholder="物流运费 ¥"></div>
          </div>
          <div id="dlProfitStatus" class="muted" style="font-size:11px;margin-top:6px"></div>
          <div id="dlProfitResult" style="margin-top:8px;font-size:13px"></div>
          <div class="muted" style="font-size:11px;margin-top:4px">「一键计算」自动获取汇率 + 重量尺寸 + 货源成本, 并按报价表取物流最低价; 也可手动填写后点「手动计算」。售价取最低跟卖价 ${esc(p.currency || '')}</div>
        </div>
        <div class="toolbar">
          <button id="dlClaim" class="btn primary">认领到草稿箱</button>
          <a id="dlAmazon" class="btn" href="${esc('https://' + amzHost + '/dp/' + p.asin)}" target="_blank" rel="noopener" title="在亚马逊打开该商品">打开亚马逊商品</a>
          <div class="tm-wrap" style="position:relative;display:inline-block">
            <button class="btn small tm-btn" id="dlTmBtn" title="在官方商标局查询该品牌是否已注册商标, 避免侵权">查商标 ▾</button>
            <div class="tm-panel" id="dlTmPanel" style="display:none">
              <div class="tm-panel-head">品牌 <b>${esc(p.brand || '-')}</b> 官方商标查询${p.tmMark ? ' <span class="badge medium">TM标</span>' : ''}${p.bgMark ? ' <span class="badge danger">BG标</span>' : ''}${p.trademarkCount ? ` <span class="badge low">已记录 ${p.trademarkCount} 条</span>` : ''}</div>
              <div class="muted" style="font-size:11px;padding:2px 12px 6px">打开对应国家/地区官方商标局, 查询品牌是否已被注册 (点击新窗口打开):</div>
              ${tmOffices(p).map((o) => `<a class="tm-link" href="${esc(o.url)}" target="_blank" rel="noopener" title="${esc(o.tip)}">${esc(o.name)}</a>`).join('')}
              <div class="tm-panel-foot muted">查询到已注册商标 = 侵权风险, 请谨慎使用该品牌</div>
            </div>
          </div>
          <span style="flex:1"></span>
          <span class="muted" style="font-size:12px;align-self:center">找货:</span>
          <button class="btn small primary src-btn" id="dl1688Find" title="点击后自动上传商品主图到 1688 以图搜图, 抓取同款货源并显示下方 (需已登录 1688)">1688 找货</button>
          ${sourceSearchUrls(p).map((s) => `<a class="btn small src-btn" href="${esc(s.url)}" target="_blank" rel="noopener" title="在${s.name}以图搜图找货源">${esc(s.name)}</a>`).join('')}
          <button class="btn small" id="dlLogistics" title="按商品重量/尺寸 + 站点从本地报价表查运费 (报价表在「物流工具」里维护)">运费试算</button>
          <button id="dlClose" class="btn">关闭</button>
          <span class="muted" id="dlMsg"></span>
        </div>
        <!-- 货源区: 记录 1688/淘宝/拼多多 货源链接 → 抓取信息 → 价格对比 -->
        <div class="goods-box">
          <div class="goods-head">${ic('search', 13)} 货源记录 <span class="muted" style="font-weight:400;font-size:12px">(1688 找货 / 粘贴链接 → 抓取 → 与主商品价格对比)</span></div>
          <div id="dl1688Results" class="goods-1688" style="display:none"></div>
          <div class="goods-add">
            <select id="dlGoodsPlatform" class="select" style="width:90px"><option>1688</option><option>淘宝</option><option>拼多多</option><option>Amazon</option><option>Alibaba</option><option>其他</option></select>
            <input id="dlGoodsUrl" class="input" placeholder="粘贴 1688/淘宝/拼多多 商品链接…" style="flex:1;min-width:180px">
            <button id="dlGoodsFetch" class="btn small" title="打开链接抓取标题/价格">抓取</button>
            <button id="dlGoodsAdd" class="btn small primary">添加</button>
          </div>
          <div id="dlGoodsList" class="goods-list"></div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(mask);
  mask.addEventListener('click', (e) => { if (e.target === mask) mask.remove(); });
  // 变体芯片点击 → 打开对应变体 ASIN (库内有则弹详情, 无则跳亚马逊)
  mask.addEventListener('click', (e) => {
    const chip = e.target.closest('.variant-chip');
    if (chip && chip.dataset.vasin) {
      const vasin = chip.dataset.vasin;
      mask.remove();
      API('/api/products/detail?asin=' + encodeURIComponent(vasin)).then((d) => {
        if (d && !d.error) openProductDetail(vasin);
        else window.open('https://www.amazon.de/dp/' + vasin, '_blank', 'noopener');
      });
    }
  });
  $('#dlClose', mask).addEventListener('click', () => mask.remove());
  $('.modal-close', mask).addEventListener('click', () => mask.remove());
  // 查商标下拉: 点击切换, 点击外部关闭
  const tmBtn = $('#dlTmBtn', mask), tmPanel = $('#dlTmPanel', mask);
  tmBtn.addEventListener('click', (e) => { e.stopPropagation(); tmPanel.style.display = tmPanel.style.display === 'block' ? 'none' : 'block'; });
  mask.addEventListener('click', (e) => { if (!e.target.closest('.tm-wrap')) tmPanel.style.display = 'none'; });
  // 详情主图点击 → 大图灯箱
  const detImg = $('.det-main-img', mask);
  if (detImg) detImg.addEventListener('click', () => openImageLightbox(detImg.src, p.title));
  $('#dlClaim', mask).addEventListener('click', async () => {
    const r = await API('/api/claims', { method: 'POST', body: JSON.stringify({ asin }) });
    $('#dlMsg', mask).textContent = r.error ? `⚠ ${r.error}` : `✔ 已认领 (${r.sku})`;
  });
  // ===== 货源管理: 渲染列表 + 抓取 + 添加 =====
  const renderGoods = (goods) => {
    const box = $('#dlGoodsList', mask);
    const mainPrice = p.minPrice != null ? p.minPrice : p.price;
    if (!goods || !goods.length) { box.innerHTML = '<div class="muted" style="font-size:12px;padding:4px 0">暂无货源记录 — 用上方「找货」跳转平台图搜, 选中货源后把链接粘贴回来即可对比。</div>'; return; }
    box.innerHTML = goods.map((g, i) => {
      const gp = parseFloat(String(g.price || '').replace(/[^0-9.]/g, ''));
      let diff = '';
      if (gp != null && mainPrice != null) {
        const d = ((mainPrice - gp) / mainPrice * 100).toFixed(1);
        diff = `<span class="badge ${d > 15 ? 'newrelease' : d > 0 ? 'medium' : 'danger'}" title="与主商品价差">主商品${d > 0 ? '贵' : '便宜'} ${Math.abs(d)}%</span>`;
      }
      return `<div class="goods-item">
        <span class="pill">${esc(g.platform || '其他')}</span>
        <span class="g-title" title="${esc(g.title || '')}">${esc((g.title || g.url || '').slice(0, 46))}</span>
        <b class="g-price">${esc(g.price || '')}</b>
        ${diff}
        ${g.url ? `<a class="btn small" href="${esc(g.url)}" target="_blank" rel="noopener" title="打开货源">打开</a>` : ''}
        <button class="btn small goods-del" data-i="${i}" title="删除货源">✕</button>
      </div>`;
    }).join('');
    box.querySelectorAll('.goods-del').forEach((b) => b.addEventListener('click', async () => {
      const list = (p.sourceGoods || []).slice();
      list.splice(parseInt(b.dataset.i, 10), 1);
      await API('/api/products/goods', { method: 'POST', body: JSON.stringify({ asin, goods: list }) });
      p.sourceGoods = list; renderGoods(list);
    }));
  };
  renderGoods(p.sourceGoods);
  // ===== 1688 找货: 主图图搜 → 抓取同款货源列表 → 一键添加 =====
  $('#dl1688Find', mask).addEventListener('click', async () => {
    const btn = $('#dl1688Find', mask);
    const box = $('#dl1688Results', mask);
    btn.textContent = '1688 找货中…'; btn.disabled = true;
    box.style.display = 'block';
    box.innerHTML = '<div class="muted" style="font-size:12px;padding:6px 0">正在 1688 以图搜图 (约 20 秒)…</div>';
    try {
      const r = await API('/api/products/1688-search-upload', { method: 'POST', body: JSON.stringify({ asin }) });
      if (!r.ok || !r.items || !r.items.length) {
        box.innerHTML = `<div class="muted" style="font-size:12px;padding:6px 0">${esc((r && r.error) || '未找到同款货源 (可检查 1688 登录状态)')}</div>`;
        btn.textContent = '1688 找货'; btn.disabled = false;
        return;
      }
      box.innerHTML = `<div class="g1688-head">1688 同款货源 (${r.count} 个):</div>` + r.items.map((g, i) => {
        const gp = parseFloat(String(g.price || '').replace(/[^0-9.]/g, ''));
        const mainPrice = p.minPrice != null ? p.minPrice : p.price;
        let diff = '';
        if (gp != null && mainPrice != null) {
          const d = ((mainPrice - gp) / mainPrice * 100).toFixed(1);
          diff = `<span class="badge ${d > 15 ? 'newrelease' : d > 0 ? 'medium' : 'danger'}" title="与主商品价差">主商品${d > 0 ? '贵' : '便宜'} ${Math.abs(d)}%</span>`;
        }
        return `<div class="goods-item">
          ${g.img ? `<img src="${esc(g.img)}" class="g-img" alt="">` : ''}
          <span class="g-title" title="${esc(g.title)}">${esc((g.title || '').slice(0, 40))}</span>
          <b class="g-price">${esc(g.priceRaw || g.price || '')}</b>
          ${diff}
          <button class="btn small goods-add1688" data-i="${i}" title="添加此货源到记录">添加</button>
        </div>`;
      }).join('');
      box.querySelectorAll('.goods-add1688').forEach((b) => b.addEventListener('click', async () => {
        const g = r.items[parseInt(b.dataset.i, 10)];
        const list = (p.sourceGoods || []).slice();
        list.push({ platform: '1688', url: g.url, title: g.title, price: g.priceRaw || g.price, addedAt: new Date().toISOString().slice(0, 19).replace('T', ' ') });
        const rr = await API('/api/products/goods', { method: 'POST', body: JSON.stringify({ asin, goods: list }) });
        if (rr.ok) { p.sourceGoods = list; renderGoods(list); b.textContent = '✓ 已添加'; b.disabled = true; $('#dlMsg', mask).textContent = `✔ 已添加 1688 货源 (共 ${list.length} 条)`; }
      }));
    } catch (e) {
      box.innerHTML = `<div class="muted" style="font-size:12px;padding:6px 0">✗ ${esc(e && e.message || e)}</div>`;
    }
    btn.textContent = '1688 找货'; btn.disabled = false;
  });
  // ===== 运费试算: 按商品重量 + 站点, 查本地报价表(「物流工具」里维护首重/续重) =====
  // (2026-09-20: 原「云途官网 CDP 免费试算」已删除 —— 后续物流价格改从智赢客户端「国际运费预估」UI 读取)
  $('#dlLogistics', mask).addEventListener('click', async () => {
    const btn = $('#dlLogistics', mask);
    const parseNum = (s) => { const m = String(s || '').match(/[\d.]+/); return m ? parseFloat(m[0]) : null; };
    const weightG = parseNum(p.weight) || parseNum(p.packWeight) || 0;   // 克
    const country = ({ uk: 'GB', de: 'DE', us: 'US', fr: 'FR', it: 'IT', es: 'ES', nl: 'NL', jp: 'JP', ca: 'CA', in: 'IN', au: 'AU' }[p.site] || 'GB');
    const weightKg = weightG > 0 ? weightG / 1000 : 1;
    const f = await zyPromptForm('📦 物流运费试算 (本地报价表)', [
      { field: 'weight', label: `重量 (kg)${weightG ? `, 商品 ${weightG}g=${(weightG / 1000).toFixed(2)}kg` : ', 商品无重量数据, 请填写'}`, type: 'number', default: String(weightKg) },
      { field: 'country', label: '目的国 (ISO2 代码)', default: country },
    ], { hint: `按「物流工具 → 报价表」维护的首重/续重费率试算。商品站点 ${p.site} → ${country}, 重量 ${weightKg}kg` });
    if (!f) return;
    btn.textContent = '试算中…'; btn.disabled = true;
    try {
      const cc = String(f.country || '').toUpperCase();
      const r = await API('/api/logistics/rates?country=' + encodeURIComponent(cc) + '&weight=' + encodeURIComponent(f.weight));
      const quotes = (r && r.quotes) || [];
      if (!quotes.length) {
        await zyAlert('⚠️ 报价表里没有该目的国', `目的国 ${cc} 在报价表里没有费率。请到「物流工具 → 报价表」添加该国各渠道的首重/续重价格。`);
        return;
      }
      const rows = quotes.map((q) => `<tr>
        <td>${esc(q.channel)}</td><td>${esc(q.type)}</td><td>${esc(q.eta)}</td>
        <td>首重 ${esc(String(q.firstWeight))}kg ¥${esc(String(q.firstPrice))}</td>
        <td>续重 ${esc(String(q.contWeight))}kg ¥${esc(String(q.contPrice))}</td>
        <td><b>¥${q.total}</b></td>
      </tr>`).join('');
      await zyAlert('✅ 运费试算结果 (本地报价表)', `
        <div class="muted" style="margin-bottom:6px">目的国 ${cc} · ${esc(String(f.weight))}kg · 报价表更新于 ${esc(r.updatedAt || '未记录')}</div>
        <table class="ov-table" style="width:100%"><thead><tr><th>渠道</th><th>类型</th><th>时效</th><th>首重</th><th>续重</th><th>总费用</th></tr></thead><tbody>${rows}</tbody></table>
        <div class="muted" style="font-size:11px;margin-top:6px">价格为报价表录入值, 请定期核对; 需要实时价可在智赢客户端「国际运费预估」里查。</div>`);
      const best = quotes.filter((q) => q.total != null).sort((a, b) => a.total - b.total)[0];
      if (best) {
        window.__lastQuote = { min: best.total, channel: best.channel };
        const lgLogi = $('#dlProfitLogi', mask);
        if (lgLogi) { lgLogi.value = best.total; lgLogi.dispatchEvent(new Event('input', { bubbles: true })); }
      }
    } catch (e) {
      await zyAlert('❌ 运费试算失败', (e && e.message) || '请检查后端是否在运行');
    }
    btn.textContent = '运费试算'; btn.disabled = false;
  });
  // ===== 利润测算: 站点/汇率/重量尺寸/货源成本/物流成本 → 利润与利润率 =====
  (async () => {
    const siteTxt = ({ uk: '英国', de: '德国', us: '美国', fr: '法国', it: '意大利', es: '西班牙', nl: '荷兰', jp: '日本', ca: '加拿大', in: '印度', au: '澳大利亚', mx: '墨西哥', br: '巴西', sg: '新加坡', ae: '阿联酋', sa: '沙特' }[p.site] || p.site || '-');
    $('#dlProfitSite', mask).textContent = `${siteTxt} (${esc(p.site)}) · ${esc(p.currency || '')}`;
    // 汇率
    const rates = await API('/api/rates').catch(() => ({}));
    const cur = p.currency || 'EUR';
    const rate = (rates.rates && rates.rates[cur]) || 0;
    $('#dlProfitRate', mask).textContent = rate ? `${rate} (${esc(rates.date || '')})` : '未获取到';
    if (rate) $('#dlProfitRate', mask).dataset.rate = rate;
    // 重量/尺寸预填 (从商品数据解析)
    const parseKg = (s) => { const m = String(s || '').match(/[\d.]+/); if (!m) return 0; const g = parseFloat(m[0]); return String(s).toLowerCase().includes('pound') ? +(g * 0.4536).toFixed(3) : (String(s).toLowerCase().includes('g') && !/kg/.test(s.toLowerCase()) ? +(g / 1000).toFixed(3) : g); };
    const wKg = parseKg(p.weight) || parseKg(p.packWeight) || 0;
    $('#dlProfitWeight', mask).value = wKg || '';
    const dims = (p.size || p.packSize || '').match(/[\d.]+/g) || [];
    if (dims.length >= 3) $('#dlProfitDims', mask).value = `${dims[0]}x${dims[1]}x${dims[2]}`;
    // 货源成本 (取 sourceGoods 第一个有价格的)
    const g0 = (p.sourceGoods || []).find((g) => g && g.price);
    if (g0) { const gp = parseFloat(String(g0.price).replace(/[^0-9.]/g, '')); if (gp > 0) $('#dlProfitSupply', mask).value = gp; }
    // 计算逻辑
    const doCalc = (extra) => {
      const rate2 = parseFloat($('#dlProfitRate', mask).dataset.rate) || 0;
      const sellPrice = p.minPrice != null ? p.minPrice : p.price;
      const sellCny = sellPrice * rate2;
      const supply = parseFloat($('#dlProfitSupply', mask).value) || 0;
      const logi = parseFloat($('#dlProfitLogi', mask).value) || 0;
      const totalCost = supply + logi;
      const commission = sellPrice * (p.referralFee != null && p.price > 0 ? (p.referralFee / p.price) : 0.15) * rate2; // 佣金按售价比例换算
      const profit = sellCny - totalCost - commission;
      const margin = sellCny > 0 ? (profit / sellCny * 100) : 0;
      const color = profit >= 0 ? 'var(--green)' : 'var(--red)';
      const logiChannel = extra && extra.channel ? `<span class="muted" style="font-size:11px">(${esc(extra.channel.slice(0, 20))})</span>` : '';
      $('#dlProfitResult', mask).innerHTML = `
        <table class="ov-table" style="width:100%">
          <tbody>
            <tr><td class="ov-k">售价 (${esc(p.currency)})</td><td>${fmtMoney(sellPrice, p.currency)}</td><td class="ov-k">售价 (¥)</td><td>¥${sellCny.toFixed(2)}</td></tr>
            <tr><td class="ov-k">货源成本 (¥)</td><td>¥${supply.toFixed(2)}</td><td class="ov-k">物流成本 (¥) ${logiChannel}</td><td>¥${logi.toFixed(2)}</td></tr>
            <tr><td class="ov-k">总成本 (¥)</td><td colspan="3"><b>¥${totalCost.toFixed(2)}</b> (货源+物流)</td></tr>
            <tr><td class="ov-k">佣金 (¥)</td><td>¥${commission.toFixed(2)}</td><td class="ov-k">净利 (¥)</td><td style="color:${color};font-weight:700">¥${profit.toFixed(2)}</td></tr>
            <tr><td class="ov-k">利润率</td><td colspan="3" style="color:${color};font-weight:700">${margin.toFixed(1)}%</td></tr>
          </tbody>
        </table>`;
    };
    $('#dlProfitCalc', mask).addEventListener('click', () => doCalc());
    // 一键计算: 自动获取汇率(已有) + 重量尺寸(已有) + 货源成本(已有) + 自动试算物流 → 计算
    $('#dlProfitOneClick', mask).addEventListener('click', async () => {
      const btn = $('#dlProfitOneClick', mask);
      const status = $('#dlProfitStatus', mask);
      btn.disabled = true;
      try {
        // 1. 确保汇率 (未获取到时重新拉)
        if (!parseFloat($('#dlProfitRate', mask).dataset.rate)) {
          status.textContent = '正在获取汇率…';
          const rates2 = await API('/api/rates').catch(() => ({}));
          const rate2 = (rates2.rates && rates2.rates[cur]) || 0;
          if (rate2) { $('#dlProfitRate', mask).dataset.rate = rate2; $('#dlProfitRate', mask).textContent = `${rate2} (${esc(rates2.date || '')})`; }
        }
        // 2. 重量/尺寸 (优先输入框, 空则商品数据)
        let wKg2 = parseFloat($('#dlProfitWeight', mask).value) || wKg || 1;
        if (!wKg2) wKg2 = 1;
        const dimsStr = $('#dlProfitDims', mask).value || '';
        const d2 = dimsStr.match(/[\d.]+/g) || [];
        const len = d2[0] ? parseFloat(d2[0]) : 0;
        const wid = d2[1] ? parseFloat(d2[1]) : 0;
        const hgt = d2[2] ? parseFloat(d2[2]) : 0;
        // 3. 货源成本 (空则提示)
        if (!parseFloat($('#dlProfitSupply', mask).value)) {
          status.textContent = '⚠ 未填写货源成本, 请在"货源成本"输入 1688 采购价 (¥)';
        }
        // 4. 自动算物流: 用本地报价表(「物流工具」里维护)。
        //    (2026-09-20: 原来"报价表没有就退回云途官网 CDP 试算"已删除 —— 后续实时物流价格改从智赢客户端「国际运费预估」UI 读取)
        const country = ({ uk: 'GB', de: 'DE', us: 'US', fr: 'FR', it: 'IT', es: 'ES', nl: 'NL', jp: 'JP', ca: 'CA', in: 'IN', au: 'AU' }[p.site] || 'GB');
        let best = null, source = '';
        status.textContent = '正在用报价表计算物流成本…';
        const rt = await API('/api/logistics/rates?country=' + country + '&weight=' + wKg2).catch(() => ({}));
        if (rt && rt.quotes && rt.quotes.length) {
          best = rt.quotes.filter((x) => x.total != null).sort((a, b) => a.total - b.total)[0];
          source = '报价表';
          if (best) {
            $('#dlProfitLogi', mask).value = best.total;
            status.textContent = `✔ 物流成本 (${esc(source)}, 更新于 ${esc(rt.updatedAt || '-')}): ${esc(best.channel.slice(0, 22))} ¥${best.total} (${esc(best.eta)})`;
            doCalc({ channel: best.channel });
          }
        }
        if (!best) {
          status.textContent = '⚠ 报价表里没有该目的国的费率 — 可到「物流工具 → 报价表」补录, 或手动填物流成本后点"手动计算"';
          doCalc();
        }
      } catch (e) {
        status.textContent = '⚠ 一键计算失败: ' + esc((e && e.message) || e) + ' — 可手动填写后点"手动计算"';
        doCalc();
      } finally {
        btn.disabled = false;
      }
    });
    $('#dlProfitSupply', mask).addEventListener('input', () => doCalc());
    $('#dlProfitLogi', mask).addEventListener('input', () => doCalc());
    // 初始计算一次 (若重量/货源有值)
    if (rate && (wKg || g0)) doCalc();
    // 暴露给运费试算 handler: 试算成功后自动填入最低物流成本
    window.__lastQuote = null;
  })();
  $('#dlGoodsFetch', mask).addEventListener('click', async () => {
    const url = $('#dlGoodsUrl', mask).value.trim();
    const btn = $('#dlGoodsFetch', mask);
    if (!url) { $('#dlGoodsUrl', mask).focus(); return; }
    btn.textContent = '抓取中…'; btn.disabled = true;
    try {
      const r = await API('/api/products/goods/fetch', { method: 'POST', body: JSON.stringify({ url }) });
      $('#dlMsg', mask).textContent = r.title ? `✔ 抓到: ${r.title.slice(0, 40)}${r.price ? ' · ' + r.price : ''}` : '⚠ 未抓到信息, 可手动填写';
      $('#dlGoodsUrl', mask).dataset.title = r.title || '';
      $('#dlGoodsUrl', mask).dataset.price = r.price || '';
    } catch (e) { $('#dlMsg', mask).textContent = '✗ ' + (e && e.message || e); }
    btn.textContent = '抓取'; btn.disabled = false;
  });
  $('#dlGoodsAdd', mask).addEventListener('click', async () => {
    const url = $('#dlGoodsUrl', mask).value.trim();
    if (!url) { $('#dlGoodsUrl', mask).focus(); return; }
    const platform = $('#dlGoodsPlatform', mask).value;
    const title = $('#dlGoodsUrl', mask).dataset.title || '';
    const price = $('#dlGoodsUrl', mask).dataset.price || '';
    const list = (p.sourceGoods || []).slice();
    list.push({ platform, url, title, price, addedAt: new Date().toISOString().slice(0, 19).replace('T', ' ') });
    const r = await API('/api/products/goods', { method: 'POST', body: JSON.stringify({ asin, goods: list }) });
    if (r.ok) { p.sourceGoods = list; renderGoods(list); $('#dlGoodsUrl', mask).value = ''; delete $('#dlGoodsUrl', mask).dataset.title; delete $('#dlGoodsUrl', mask).dataset.price; $('#dlMsg', mask).textContent = `✔ 已添加货源 (共 ${list.length} 条)`; }
    else $('#dlMsg', mask).textContent = '✗ ' + (r.error || '添加失败');
  });
}

/* ===== 合规检测 ===== */
let complianceProduct = null;
async function renderCompliance() {
  const content = $('#content');
  const prod = await API('/api/products');
  const branddb = await API('/api/branddb');
  content.innerHTML = `
    <div class="grid cols-2">
      <div>
        <div class="card">
          <div class="card-title"> RAG 合规检测</div>
          <div class="card-sub">品牌数据库 ${branddb.total} 条 · 专利库 · 平台规则库 → 混合检索 → 风险结论(带引用)</div>
          <div class="toolbar">
            <input id="compKw" class="input" style="width:170px" placeholder="筛选 ASIN/品牌/标题">
            <select id="compAsin" class="select" style="flex:1"></select>
            <span id="compKwHint" class="muted" style="font-size:11px"></span>
            <button id="compCheck" class="btn primary">🔍 开始检测</button>
          </div>
          <div id="compResult" class="section-gap"></div>
        </div>
        <div class="card section-gap">
          <div class="card-title"> 人工纠错 → 飞轮沉淀</div>
          <div class="card-sub">同一商品同一结论累计纠错 ≥3 次, 自动沉淀规则到「合规规则库」, 下次检测自动带出</div>
          <div class="toolbar">
            <button id="corrRegistered" class="btn">此商品实为「已备案」</button>
            <button id="corrNot" class="btn">此商品实为「未备案」</button>
            <span class="muted" id="corrMsg"></span>
          </div>
        </div>
      </div>
      <div>
        <div class="card">
          <div class="card-title"> 品牌数据库</div>
          <div class="card-sub">每日自动更新 + 人工纠正回流</div>
          <div style="max-height:520px;overflow-y:auto"><table style="min-width:640px">
            <thead><tr><th>品牌</th><th>状态</th><th>BG标</th><th>TM标</th><th>专利</th><th>商标数</th><th>备注</th></tr></thead>
            <tbody>${branddb.items.map((b) => `<tr>
              <td><b>${esc(b.name)}</b></td>
              <td>${b.status === 'registered' ? '<span class="badge danger">已备案</span>' : b.status === 'unchecked' ? '<span class="badge medium">未核查</span>' : '<span class="badge low">未查到</span>'}</td>
              <td>${b.bg ? '✓' : '—'}</td><td>${b.tm ? '✓' : '—'}</td><td>${b.patent ? '<span class="badge danger">有</span>' : '—'}</td>
              <td>${b.trademarkCount || 0}</td><td class="muted" style="max-width:200px">${esc(b.note || '')}</td>
            </tr>`).join('')}</tbody>
          </table></div>
        </div>
      </div>
    </div>
  `;
  const sel = $('#compAsin');
  /* ★ 2026-11-10 修复: 原来把全部商品 (实测 8802 个) 全塞进一个原生 select —— 每个 option 带标题,
   *   一页就是 62 万字符的选项文本, 下拉框卡到没法用。改成"关键词筛选 + 最多 200 个候选"。 */
  const fillCompAsin = (kw) => {
    const q = String(kw || '').trim().toLowerCase();
    const list = q
      ? prod.items.filter((p) => (String(p.asin) + ' ' + String(p.brand || '') + ' ' + String(p.title || '')).toLowerCase().includes(q))
      : prod.items;
    const top = list.slice(0, 200);
    sel.innerHTML = '';
    for (const p of top) {
      const o = document.createElement('option');
      o.value = p.asin;
      o.textContent = `${p.asin} · ${p.brand || '-'} · ${String(p.title || '').slice(0, 40)}`;
      sel.appendChild(o);
    }
    const hint = document.getElementById('compKwHint');
    if (hint) hint.textContent = q ? `匹配 ${list.length} 条, 显示前 ${top.length}` : `共 ${prod.items.length} 条, 显示前 ${top.length} (可输入关键词缩小)`;
  };
  fillCompAsin('');
  const kwEl = $('#compKw');
  if (kwEl) {
    let t = null;
    kwEl.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => fillCompAsin(kwEl.value), 200); });
  }
  complianceProduct = prod.items[0];

  const showResult = (r) => {
    const lv = r.level;
    $('#compResult').innerHTML = `
      <div class="card" style="border-color:${lv === 'high' ? 'var(--red)' : lv === 'medium' ? 'var(--yellow)' : 'var(--green)'}">
        <div class="card-title"> 检测结果: <span class="badge ${lv}">${lv === 'high' ? '高风险' : lv === 'medium' ? '中风险' : '低风险'}</span> 合规评分 ${r.score}/100</div>
        <div class="card-sub">检测时间 ${r.checkedAt} · 品牌库命中: ${r.brandHit ? '是' : '否'}</div>
        <ul class="source-list">${r.reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      </div>`;
  };

  $('#compCheck').addEventListener('click', async () => {
    complianceProduct = prod.items.find((p) => p.asin === sel.value);
    const r = await API('/api/compliance/check', { method: 'POST', body: JSON.stringify({ asin: sel.value }) });
    showResult(r);
    $('#corrMsg').textContent = '';
  });

  const correct = async (verdict) => {
    if (!complianceProduct) return;
    const r = await API('/api/compliance/correct', { method: 'POST', body: JSON.stringify({ asin: complianceProduct.asin, brand: complianceProduct.brand, verdict }) });
    $('#corrMsg').textContent = `✔ 已记录 (累计${r.counts}次) | 检测准确率 ${Math.round(r.accuracy * 100)}%` + (r.newRule ? ` | 新规则已沉淀: ${r.newRule.id}` : '');
    if (r.newRule) await zyAlert(`🔄 数据飞轮: 已自动沉淀新规则 ${r.newRule.id}「${r.newRule.title}」`);
  };
  $('#corrRegistered').addEventListener('click', () => correct('已备案'));
  $('#corrNot').addEventListener('click', () => correct('未备案'));
}

/* ===== 知产查重 (上架风控: 商标 / 外观设计) ===== */
/* 数据源: WIPO 全球品牌库(含 GB/AU/马德里) · EUIPO 欧盟商标 · EUIPO 共同体外观 · USPTO 美国 */
let ipMeta = null;          // /api/ip/providers 结果
let ipBatchTimer = null;    // 批量查重轮询
const IP_LEVEL_BADGE = {
  high: ['danger', '❌ 高危'], medium: ['medium', '⚠️ 中风险'], low: ['low', 'ℹ️ 低风险'],
  none: ['blue', '✅ 无冲突'], unknown: ['unknown', '⚠️ 无法判定'],
};
const ipLevelBadge = (lv) => {
  const [cls, text] = IP_LEVEL_BADGE[lv] || ['gray', lv || '—'];
  return `<span class="badge ${cls}">${text}</span>`;
};

async function renderIpCheck() {
  const content = $('#content');
  if (ipBatchTimer) { clearInterval(ipBatchTimer); ipBatchTimer = null; }

  let meta, ov;
  try {
    meta = await API('/api/ip/providers');
    ipMeta = meta;
  } catch (e) {
    content.innerHTML = `<div class="card"><div class="card-title">知产查重</div>
      <div class="card-sub">读取数据源失败: ${esc(e.message)}</div></div>`;
    return;
  }
  ov = await API('/api/ip/overview').catch(() => null);

  const sites = meta.sites || [];
  const providers = meta.providers || [];
  const defaults = meta.defaultSources || [];
  const siteOptions = (sel) => sites.map((s) =>
    `<option value="${s.id}"${s.id === sel ? ' selected' : ''}>${s.flag} ${s.name}</option>`).join('');
  const srcChecks = (onlyKinds) => providers
    .filter((p) => onlyKinds.indexOf(p.kind) >= 0)
    .map((p) => `<label class="ip-src${p.ready ? '' : ' off'}" title="${esc(p.note || '')}">
        <input type="checkbox" class="ip-src-cb" value="${p.id}"${defaults.indexOf(p.id) >= 0 ? ' checked' : ''}${p.ready ? '' : ' disabled'}>
        ${esc(p.short)}${p.ready ? '' : ' (未接入)'}
      </label>`).join('');

  content.innerHTML = `
    <div class="card">
      <div class="card-title">🛡 知产查重 · 上架风控</div>
      <div class="card-sub">
        用「品牌名」去官方商标库查有没有人在你要上的那个站点注册过 —— 有就先别上。
        判定口径: 只看<b>目标站点所在辖区</b>的商标（上德国站看 DE+欧盟，上英国站只看 GB，别国有商标不影响你）。
      </div>
      <div class="toolbar">
        <span class="pill">商品库 ${ov ? ov.total.toLocaleString() : '—'} 个</span>
        <span class="pill">已查 ${ov ? ov.checked.toLocaleString() : '—'}</span>
        <span class="pill">未查 ${ov ? ov.unchecked.toLocaleString() : '—'}</span>
        ${ov && ov.byLevel && Object.keys(ov.byLevel).length ? Object.keys(ov.byLevel).map((k) => `<span class="badge ${(IP_LEVEL_BADGE[k] || ['gray'])[0]}">${k} ${ov.byLevel[k]}</span>`).join('') : ''}
        <span class="muted">缓存 ${ov && ov.cache ? ov.cache.total : 0} 条 · TTL ${ov && ov.cache ? ov.cache.ttlDays : 7} 天</span>
        <button id="ipClearCache" class="btn small" style="margin-left:auto">清缓存</button>
      </div>
    </div>

    <div class="grid cols-2 section-gap">
      <div>
        <div class="card">
          <div class="card-title">🏬 店铺/列表链接查重 <span class="muted" style="font-weight:400">列表页 → 采站点+品牌 → 逐个查商标</span></div>
          <div class="card-sub">
            每行一个 Amazon 店铺/商品列表链接（如 <code>amazon.de/s?me=A5WKWV7CFW0MZ&amp;marketplaceID=A1PA6795UKMFR9</code>），也支持单个商品链接 <code>/dp/ASIN</code>。
            站点从域名自动识别；品牌取自列表卡片与智赢插件面板，拿不到的先查商品库，仍没有的再开临时标签页读详情页。
          </div>
          <textarea id="ipLinks" class="input" rows="5" placeholder="https://www.amazon.de/s?me=A5WKWV7CFW0MZ&amp;marketplaceID=A1PA6795UKMFR9&#10;https://www.amazon.co.uk/s?me=A21HVBR9S9KTYG&amp;marketplaceID=A1F83G8C2ARO7P" style="width:100%;font-family:ui-monospace,Consolas,monospace;resize:vertical"></textarea>
          <div class="toolbar" style="margin-top:12px">
            <label class="muted" style="display:inline-flex;gap:6px;align-items:center">页数
              <input id="ipListPages" class="input" type="number" min="0" max="60" placeholder="留空=全部" title="采集前 N 页；留空或 0 = 一直翻到最后一页" style="width:110px">
            </label>
            <span class="muted">数据源</span>
            <span class="ip-srcs" id="ipLinkSrcs">${srcChecks(['trademark', 'design'])}</span>
            <button id="ipLinkRun" class="btn primary">开始采集并查商标</button>
            <button id="ipLinkStop" class="btn" disabled>停止</button>
            <button id="ipLinkApply" class="btn" title="把结论写回商品库里对应的商品">同时写回商品库</button>
          </div>
          <div id="ipLinkMsg" class="muted"></div>
          <div id="ipLinkResult" class="section-gap"></div>
        </div>

        <div class="card section-gap">
          <div class="card-title">🔍 关键词 / 品牌直接查</div>
          <div class="card-sub">不采集商品，只拿一个名字查商标 —— 选品前先探路用。</div>
          <div class="toolbar">
            <input id="ipTerm" class="input" placeholder="品牌名 / 关键词，如 Anker" style="flex:1;min-width:180px">
            <select id="ipTermSite" class="select">${siteOptions('amazon.co.uk')}</select>
            <button id="ipTermRun" class="btn primary">查</button>
          </div>
          <div class="toolbar">
            <span class="muted">数据源</span>
            <span class="ip-srcs" id="ipTermSrcs">${srcChecks(['trademark', 'design'])}</span>
          </div>
          <div id="ipTermResult" class="section-gap"></div>
        </div>
      </div>

      <div>
        <div class="card">
          <div class="card-title">📦 商品库批量查重</div>
          <div class="card-sub">按品牌名去重后逐个查（同一个品牌只查一次），结论可写回商品库。串行执行，别急着关页面。</div>
          <div class="toolbar">
            <select id="ipBatchSite" class="select">${siteOptions('amazon.co.uk')}</select>
            <select id="ipBatchField" class="select">
              <option value="brand">按品牌名查</option>
              <option value="title">按标题查</option>
            </select>
            <input id="ipBatchLimit" class="input" type="number" min="1" max="200" value="30" style="width:90px" title="最多查多少个关键词">
            <label class="ip-src"><input type="checkbox" id="ipBatchOnlyUnchecked" checked> 只查没查过的</label>
            <button id="ipBatchRun" class="btn primary">开始</button>
            <button id="ipBatchStop" class="btn">停止</button>
          </div>
          <div id="ipBatchProgress" class="section-gap"></div>
        </div>

        <div class="card section-gap">
          <div class="card-title">🔌 数据源状态</div>
          <div class="card-sub">点「测试」现查一个已知有商标的词，确认真能返回数据（不要只看配置里写着 ready）。</div>
          <div class="toolbar">
            <input id="ipTestTerm" class="input" value="Anker" style="width:150px">
            <select id="ipTestSite" class="select">${siteOptions('amazon.co.uk')}</select>
            <button id="ipTestRun" class="btn small">测试</button>
          </div>
          <div id="ipTestResult" class="muted"></div>
          <table style="margin-top:12px">
            <thead><tr><th>数据源</th><th>范围</th><th>状态</th><th>说明</th></tr></thead>
            <tbody>${providers.map((p) => `<tr>
              <td><b>${esc(p.short)}</b><div class="muted">${esc(p.name)}</div></td>
              <td class="muted">${esc(p.scope)}</td>
              <td>${p.ready ? '<span class="badge blue">已接入</span>' : '<span class="badge gray">未接入</span>'}</td>
              <td class="muted" style="max-width:280px">${esc(p.note || '')}</td>
            </tr>`).join('')}</tbody>
          </table>
          <div class="muted" style="margin-top:8px">
            欧盟 27 国: ${(meta.euMembers || []).join(' ')} —— 欧盟商标(EUTM)一次性覆盖这些国家；
            英国脱欧后欧盟商标不再覆盖 GB，所以英国站只查 GB + 马德里指定 GB。
          </div>
        </div>
      </div>
    </div>
  `;

  const getSources = (sel) => $$('#' + sel + ' .ip-src-cb').filter((c) => c.checked).map((c) => c.value);

  /* ---------- 结论渲染 ---------- */
  const renderRisk = (r) => {
    const items = (r.items || []).filter((h) => h.inMarket !== false);
    const alive = items.filter((h) => h.statusGroup === 'alive').slice(0, 12);
    const others = items.filter((h) => h.statusGroup !== 'alive');
    const srcLine = (r.sources || []).map((s) => s.ok
      ? `<span class="pill">${esc(s.sourceName)} ${s.returned}/${s.total}${s.cached ? ' 缓存' : ''}</span>`
      : `<span class="badge danger" title="${esc(s.error || '')}">${esc(s.sourceName)} 失败</span>`).join(' ');
    return `
      <div class="card" style="border-color:${r.risk.level === 'high' ? 'var(--red)' : r.risk.level === 'medium' ? 'var(--yellow)' : r.risk.level === 'unknown' ? '#8a6d3b' : 'var(--card-border)'}">
        <div class="card-title">${ipLevelBadge(r.risk.level)} <span class="muted" style="font-weight:400">风险分 ${r.risk.score} · ${r.total} 条命中 · ${r.tookMs}ms</span></div>
        <div class="card-sub">${r.market ? esc(r.market.label) : '未指定站点（按全球口径）'}</div>
        <ul class="source-list">${(r.risk.reasons || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
        <div style="margin-top:8px">${srcLine}</div>
        ${alive.length ? `<table style="margin-top:10px">
          <thead><tr><th>状态</th><th>商标</th><th>局</th><th>权利人</th><th>尼斯类</th><th>注册日</th></tr></thead>
          <tbody>${alive.map((h) => `<tr>
            <td>${h.statusGroup === 'alive' ? '<span class="badge danger">有效</span>' : h.statusGroup === 'pending' ? '<span class="badge medium">审查中</span>' : '<span class="badge gray">失效</span>'}</td>
            <td><b>${esc(h.title || '(图形)')}</b>${h.images && h.images[0] ? ` <a href="${esc(h.detailUrl || h.images[0])}" target="_blank"><img src="${esc(h.images[0])}" style="height:26px;vertical-align:middle;border-radius:4px"></a>` : ''}</td>
            <td class="muted">${esc(h.officeName || h.office)}</td>
            <td class="muted" style="max-width:200px">${esc(h.owner || '')}</td>
            <td class="muted">${(h.nice || []).join('/') || '—'}</td>
            <td class="muted">${esc(h.registeredAt || h.filed || '')}</td>
          </tr>`).join('')}</tbody></table>` : ''}
        ${others.length ? `<details style="margin-top:8px"><summary class="muted">另有 ${others.length} 条失效/审查中记录</summary>
          <ul class="source-list">${others.slice(0, 20).map((h) => `<li>${esc(h.title || '(图形)')} · ${esc(h.officeName || h.office)} · ${esc(h.status || '')}</li>`).join('')}</ul></details>` : ''}
      </div>`;
  };

  /* ---------- 店铺/列表链接查重 (后台任务 + 轮询) ---------- */
  const renderListJob = (job) => {
    if (!job) { $('#ipLinkResult').innerHTML = ''; return; }
    const stage = { collect: '① 采集列表', check: '② 查商标', done: '✔ 完成' }[job.stage] || job.stage || '';
    const lists = (job.lists || []).map((L) => `<div class="muted" style="font-size:12px">${esc(L.site || '?')} · ${L.pages || 0} 页 · 商品 ${L.products || 0} · 品牌 ${L.brands || 0}${L.noBrand ? ` · 无品牌 ${L.noBrand}` : ''}${L.filledFromLib ? ` · 库补 ${L.filledFromLib}` : ''}${L.filledFromDetail ? ` · 详情补 ${L.filledFromDetail}` : ''}${L.note ? ' · ' + esc(L.note) : ''}${L.stopped ? ' · 已停止' : ''}</div>`).join('');
    const rows = (job.results || []).slice().reverse().map((x) => `
      <tr>
        <td>${ipLevelBadge(x.level)}</td>
        <td><b>${esc(x.brand)}</b><div class="muted">${esc(x.siteName || x.site || '')}</div></td>
        <td class="muted">${(x.asins || []).length}</td>
        <td class="muted">${x.total || 0} 命中 / ${x.trademarkCount || 0} 有效</td>
        <td class="muted" style="max-width:320px">${esc(x.advice || '')}${(x.items || []).length ? '<div class="muted" style="font-size:11.5px">' + x.items.slice(0, 3).map((h) => '· ' + esc(h.title || '(无名称)') + ' · ' + esc(h.officeName || h.office || '') + (h.owner ? ' · ' + esc(h.owner) : '')).join('<br>') + '</div>' : ''}</td>
      </tr>`).join('');
    $('#ipLinkMsg').innerHTML = `${job.running ? '⏳ ' : '✔ '}${esc(stage)} · 商品 ${job.productCount || 0} · 品牌 ${job.brandCount || 0} · 已查 ${(job.results || []).length}/${job.brandCount || 0} · 页数 ${job.pages || 0}` +
      `<br><span class="muted" style="font-size:12px">${job.current ? '当前: ' + esc(job.current) : ''}</span>` +
      `<br>${['high', 'medium', 'low', 'none', 'unknown'].map((k) => `${ipLevelBadge(k)} ${(job.summary && job.summary[k]) || 0}`).join(' · ')}` +
      (job.summary && job.summary.failed ? ` · <span class="badge gray">失败 ${job.summary.failed}</span>` : '');
    $('#ipLinkStop').disabled = !job.running;
    $('#ipLinkResult').innerHTML = `
      <div class="card">
        <div class="card-title">${job.running ? '⏳ 运行中' : '✔ 已结束'} <span class="muted" style="font-weight:400">${esc(job.id || '')}${job.apply ? ' · 已写回商品库' : ''}</span></div>
        ${lists}
        ${rows ? `<table style="margin-top:10px"><thead><tr><th>结论</th><th>品牌 / 站点</th><th>商品</th><th>命中</th><th>说明</th></tr></thead><tbody>${rows}</tbody></table>` : '<div class="muted">还没有品牌结论。</div>'}
        ${(job.errors && job.errors.length) ? `<div class="muted" style="margin-top:8px;color:var(--yellow)">失败 ${job.errors.length} 条: ${job.errors.slice(0, 6).map((e) => esc((e.brand || e.asin || e.url || '?') + ' → ' + (e.error || ''))).join(' · ')}</div>` : ''}
      </div>`;
  };
  let ipListTimer = null;
  const pollListJob = async () => {
    try {
      const r = await API('/api/ip/list-job');
      if (!r.job) { if (ipListTimer) { clearInterval(ipListTimer); ipListTimer = null; } return; }
      renderListJob(r.job);
      if (!r.job.running) { if (ipListTimer) { clearInterval(ipListTimer); ipListTimer = null; } $('#ipLinkRun').disabled = false; }
    } catch (e) { /* 轮询失败不打断 */ }
  };
  $('#ipLinkRun').addEventListener('click', async () => {
    const urls = $('#ipLinks').value.split(/[\r\n]+/).map((s) => s.trim()).filter(Boolean);
    if (!urls.length) return zyAlert('请先填写至少一个店铺/商品列表链接');
    const btn = $('#ipLinkRun');
    const apply = btn.dataset.apply === '1';
    btn.disabled = true;
    $('#ipLinkMsg').textContent = '已提交，正在采集列表…';
    $('#ipLinkResult').innerHTML = '';
    try {
      const r = await API('/api/ip/list-check', {
        method: 'POST',
        body: JSON.stringify({
          urls,
          pages: ($('#ipListPages').value || '').trim(),
          sources: getSources('ipLinkSrcs'),
          apply,
          limit: 30,
        }),
      });
      renderListJob(r.job);
      if (ipListTimer) clearInterval(ipListTimer);
      ipListTimer = setInterval(pollListJob, 2500);
    } catch (e) {
      btn.disabled = false;
      $('#ipLinkMsg').innerHTML = `<span class="badge danger">启动失败</span> ${esc(e.message)}`;
    }
  });
  $('#ipLinkStop').addEventListener('click', async () => {
    try { await API('/api/ip/list-stop', { method: 'POST' }); $('#ipLinkMsg').textContent = '已请求停止（当前页/当前品牌查完就停）'; }
    catch (e) { zyAlert(e.message); }
  });
  $('#ipLinkApply').addEventListener('click', () => {
    const b = $('#ipLinkRun');
    const on = b.dataset.apply === '1';
    b.dataset.apply = on ? '0' : '1';
    $('#ipLinkApply').classList.toggle('primary', !on);
    $('#ipLinkApply').textContent = on ? '同时写回商品库' : '✔ 会写回商品库';
  });
  // 进页面时若后台已有任务, 直接显示
  pollListJob();
  if (!ipListTimer) ipListTimer = setInterval(pollListJob, 5000);
  /* ---------- 关键词查重 ---------- */
  $('#ipTermRun').addEventListener('click', async () => {
    const term = $('#ipTerm').value.trim();
    if (!term) return zyAlert('请填写品牌名或关键词');
    const btn = $('#ipTermRun');
    btn.disabled = true;
    $('#ipTermResult').innerHTML = '<div class="muted">查询中…</div>';
    try {
      const q = new URLSearchParams({ q: term, sites: $('#ipTermSite').value, sources: getSources('ipTermSrcs').join(','), limit: '30' });
      const r = await API('/api/ip/search?' + q.toString());
      $('#ipTermResult').innerHTML = renderRisk(r);
    } catch (e) {
      $('#ipTermResult').innerHTML = `<div class="card"><div class="card-title"><span class="badge danger">查询失败</span></div><div class="card-sub">${esc(e.message)}</div></div>`;
    } finally {
      btn.disabled = false;
    }
  });

  /* ---------- 商品库批量 ---------- */
  const pollBatch = async () => {
    try {
      const b = await API('/api/ip/batch');
      const el = $('#ipBatchProgress');
      if (!b || !b.batch) { el.innerHTML = '<div class="muted">还没有批量任务。</div>'; if (ipBatchTimer) { clearInterval(ipBatchTimer); ipBatchTimer = null; } return; }
      const t = b.batch;
      const pct = t.total ? Math.round((t.done / t.total) * 100) : 0;
      el.innerHTML = `
        <div class="card">
          <div class="card-title">${t.running ? '⏳ 进行中' : '✔ 已结束'} <span class="muted" style="font-weight:400">${t.done}/${t.total} · ${t.market || ''} · ${esc(t.field === 'title' ? '按标题' : '按品牌')}</span></div>
          <div class="card-sub">${t.current ? '正在查: ' + esc(t.current) : (t.finishedAt ? '完成于 ' + esc(t.finishedAt) : '')}</div>
          <div style="height:6px;background:var(--card-hover);border-radius:999px;overflow:hidden"><div style="height:100%;width:${pct}%;background:var(--accent);transition:width .3s"></div></div>
          <div class="toolbar" style="margin-top:10px">
            <span class="badge danger">高危 ${t.summary.high || 0}</span>
            <span class="badge medium">中风险 ${t.summary.medium || 0}</span>
            <span class="badge low">低风险 ${t.summary.low || 0}</span>
            <span class="badge blue">无冲突 ${t.summary.none || 0}</span>
            ${t.summary.unknown ? `<span class="badge unknown">无法判定 ${t.summary.unknown}</span>` : ''}
            ${t.errors && t.errors.length ? `<span class="badge gray">出错 ${t.errors.length}</span>` : ''}
          </div>
          ${(t.results || []).length ? `<table style="margin-top:8px">
            <thead><tr><th>关键词</th><th>结论</th><th>命中</th><th>受影响 ASIN</th></tr></thead>
            <tbody>${t.results.slice().reverse().slice(0, 25).map((x) => `<tr>
              <td><b>${esc(x.term)}</b></td>
              <td>${ipLevelBadge(x.risk.level)}</td>
              <td class="muted">${x.total || 0}</td>
              <td class="muted" style="max-width:240px">${(x.asins || []).slice(0, 6).join(', ')}${(x.asins || []).length > 6 ? ` …+${x.asins.length - 6}` : ''}</td>
            </tr>`).join('')}</tbody></table>` : ''}
        </div>`;
      if (!t.running && ipBatchTimer) { clearInterval(ipBatchTimer); ipBatchTimer = null; }
    } catch (e) {
      if (ipBatchTimer) { clearInterval(ipBatchTimer); ipBatchTimer = null; }
    }
  };
  $('#ipBatchRun').addEventListener('click', async () => {
    const btn = $('#ipBatchRun');
    btn.disabled = true;
    try {
      const r = await API('/api/ip/batch', {
        method: 'POST',
        body: JSON.stringify({
          sites: [$('#ipBatchSite').value],
          sources: defaults.length ? undefined : undefined,
          field: $('#ipBatchField').value,
          limit: Number($('#ipBatchLimit').value) || 30,
          onlyUnchecked: $('#ipBatchOnlyUnchecked').checked,
          apply: true,
        }),
      });
      await pollBatch();
      if (ipBatchTimer) clearInterval(ipBatchTimer);
      ipBatchTimer = setInterval(pollBatch, 2500);
    } catch (e) {
      $('#ipBatchProgress').innerHTML = `<div class="card"><div class="card-title"><span class="badge danger">启动失败</span></div><div class="card-sub">${esc(e.message)}</div></div>`;
    } finally {
      btn.disabled = false;
    }
  });
  $('#ipBatchStop').addEventListener('click', async () => {
    try { await API('/api/ip/batch/stop', { method: 'POST' }); await pollBatch(); } catch (e) { zyAlert(e.message); }
  });

  /* ---------- 数据源自测 / 清缓存 ---------- */
  $('#ipTestRun').addEventListener('click', async () => {
    const term = $('#ipTestTerm').value.trim() || 'Anker';
    $('#ipTestResult').innerHTML = '测试中…（每个源约 2~4 秒）';
    try {
      const q = new URLSearchParams({ q: term, sites: $('#ipTestSite').value, limit: '10' });
      const t0 = Date.now();
      const r = await API('/api/ip/risk?' + q.toString());
      const lines = (r.sources || []).map((s) => s.ok
        ? `✅ ${esc(s.sourceName)}: ${s.returned}/${s.total}${s.cached ? ' (缓存)' : ''}`
        : `❌ ${esc(s.sourceName)}: ${esc(s.error || '失败')}`).join(' &nbsp;·&nbsp; ');
      $('#ipTestResult').innerHTML = `${lines}<br>结论 ${ipLevelBadge(r.risk.level)} · 耗时 ${Date.now() - t0}ms`;
    } catch (e) {
      $('#ipTestResult').innerHTML = `<span class="badge danger">测试失败</span> ${esc(e.message)}`;
    }
  });
  $('#ipClearCache').addEventListener('click', async () => {
    try { const r = await API('/api/ip/cache/clear', { method: 'POST' }); renderIpCheck(); }
    catch (e) { zyAlert(e.message); }
  });

  // 进页面就把当前批量任务状态拉出来（可能正在后台跑）
  pollBatch();
  if (!ipBatchTimer) ipBatchTimer = setInterval(pollBatch, 4000);
}

/* ===== 批量刊登 ===== */
async function renderClaims() {
  const content = $('#content');
  const prod = await API('/api/products');
  const lowRisk = prod.items.filter((p) => p.aiRiskLevel === 'low' && p.fulfill === 'FBM');
  /* ★ 2026-11-10 修复: 原来把 lowRisk 全量渲染成表格 (实测 8802 行 / 76 万字符 innerText),
   *   打开这一页等于让浏览器造 8800 行 DOM —— 卡顿且没有必要。改成先渲染 200 行 + 按需加载。 */
  let shown = 200;
  content.innerHTML = `
    <div class="notice">流程: 采集列表 → 一键筛选(FBM+未查到备案+BG标=无) → 批量认领 → 草稿箱编辑 → 批量发布</div>
    <div class="grid cols-2">
      <div>
        <div class="card">
          <div class="card-title"> 可认领商品 <span class="badge low">低风险 · FBM</span></div>
          <div class="card-sub">已按「未查到备案 + FBM + 无BG标」自动筛选, 共 ${lowRisk.length} 条</div>
          <div style="max-height:380px;overflow-y:auto"><table style="min-width:700px">
            <thead><tr><th></th><th>ASIN</th><th>品牌</th><th>商品</th><th>价格</th><th>建议价</th><th>月销</th></tr></thead>
            <tbody id="claimRows"></tbody>
          </table></div>
          <div class="section-gap" id="claimMoreWrap"></div>
          <div class="toolbar section-gap">
            <button id="claimSel" class="btn primary" title="打开所选商品的所有链接: 商品页 / 品牌页 / 卖家页 / 1688 同款 (逐个在新标签页打开)">🔗 打开所选链接</button>
            <button id="claimAll" class="btn">认领全部</button>
          </div>
        </div>
      </div>
      <div>
        <div class="card">
          <div class="card-title"> 草稿箱 <span id="claimCount" class="muted"></span></div>
          <div class="card-sub">批量编辑价格/SKU → 发布预览 → 批量发布 → 状态监控</div>
          <div id="claimList"></div>
          <div class="toolbar section-gap">
            <button id="pubSel" class="btn primary">发布选中</button>
            <button id="pubAll" class="btn">发布全部草稿</button>
            <span class="muted" id="pubMsg"></span>
          </div>
        </div>
      </div>
    </div>
  `;

  /* 分批渲染可认领商品 (首屏 200 条, 每次 +300) */
  const renderClaimRows = () => {
    const rows = lowRisk.slice(0, shown);
    $('#claimRows').innerHTML = rows.map((p) => `<tr>
      <td><input type="checkbox" class="claim-cb" value="${esc(p.asin)}"></td>
      <td class="mono">${esc(p.asin)}</td><td>${esc(p.brand)}</td>
      <td style="max-width:200px">${esc(String(p.title || '').slice(0, 50))}</td>
      <td>${fmtMoney(p.price, p.currency)}</td><td class="muted">${fmtMoney(p.aiSuggestPrice, p.currency)}</td><td>${fmtNum(p.monthlySales)}</td>
    </tr>`).join('') || '<tr><td colspan="7" class="empty">无可认领商品</td></tr>';
    const wrap = $('#claimMoreWrap');
    if (!wrap) return;
    if (shown < lowRisk.length) {
      wrap.innerHTML = `<button id="claimMore" class="btn">显示更多 (+300) — 已显示 ${Math.min(shown, lowRisk.length)}/${lowRisk.length}</button>`;
      const more = $('#claimMore');
      if (more) more.addEventListener('click', () => { shown += 300; renderClaimRows(); });
    } else {
      wrap.innerHTML = lowRisk.length > 200 ? `<span class="muted">已显示全部 ${lowRisk.length} 条</span>` : '';
    }
  };
  renderClaimRows();

  const loadClaims = async () => {
    const data = await API('/api/claims');
    $('#claimCount').textContent = `共 ${data.total} 条`;
    $('#claimList').innerHTML = data.items.length ? `<div style="max-height:380px;overflow-y:auto"><table style="min-width:640px">
      <thead><tr><th></th><th>单号</th><th>ASIN</th><th>品牌</th><th>SKU</th><th>价格</th><th>状态</th></tr></thead>
      <tbody>${data.items.map((c) => `<tr>
        <td>${c.status === 'draft' ? `<input type="checkbox" class="pub-cb" value="${esc(c.id)}">` : ''}</td>
        <td class="mono">${esc(c.id)}</td><td class="mono">${esc(c.asin)}</td><td>${esc(c.brand)}</td>
        <td class="mono">${esc(c.sku)}</td><td>${fmtMoney(c.price, 'GBP')}</td>
        <td>${c.status === 'draft' ? '<span class="badge draft">草稿</span>' : `<span class="badge published">已发布 ${esc(c.publishedAt || '')}</span>`}</td>
      </tr>`).join('')}</tbody></table></div>` : '<div class="empty">草稿箱为空, 从左侧认领商品</div>';
    return data;
  };
  await loadClaims();

  const claimAsins = async (asins) => {
    let n = 0;
    for (const asin of asins) {
      const r = await API('/api/claims', { method: 'POST', body: JSON.stringify({ asin }) });
      if (!r.error) n++;
    }
    await loadClaims();
    await zyAlert(`✔ 已认领 ${n} 个商品到草稿箱`);
  };
  // ★ 「认领选中」已改为「打开所选商品的所有链接」: 勾选商品 → 逐个打开它的商品页/品牌页/卖家页/1688
  $('#claimSel').addEventListener('click', async () => {
    const asins = $$('.claim-cb:checked').map((x) => x.value);
    if (!asins.length) return await zyAlert('请先勾选商品', '勾选左侧列表里的商品后再点「打开所选链接」');
    const picked = lowRisk.filter((p) => asins.indexOf(p.asin) >= 0);
    // 列表里没有的(理论上不会)用 ASIN 兜一条商品页链接, 免得点了没反应
    const rows = picked.length ? picked : asins.map((a) => ({ asin: a, site: '' }));
    await openProductsLinks(rows);
  });
  $('#claimAll').addEventListener('click', () => claimAsins(lowRisk.map((p) => p.asin)));
  $('#pubSel').addEventListener('click', async () => {
    const r = await API('/api/publish', { method: 'POST', body: JSON.stringify({ ids: $$('.pub-cb:checked').map((x) => x.value) }) });
    $('#pubMsg').textContent = `✔ 已发布 ${r.published} 条`; await loadClaims();
  });
  $('#pubAll').addEventListener('click', async () => {
    const data = await API('/api/claims');
    const ids = data.items.filter((c) => c.status === 'draft').map((c) => c.id);
    const r = await API('/api/publish', { method: 'POST', body: JSON.stringify({ ids }) });
    $('#pubMsg').textContent = `✔ 已发布 ${r.published} 条`; await loadClaims();
  });
}

/* ===== 智能调价 ===== */
async function renderReprice() {
  const content = $('#content');
  content.innerHTML = `
    <div class="grid cols-2">
      <div>
        <div class="card">
          <div class="card-title"> 智能调价 (模拟)</div>
          <div class="card-sub">目标价 = 平台最低价 − 差额(0.5), 且 ≥ 保底价(成本×1.15); 生产环境每15分钟自动执行</div>
          <div class="toolbar">
            <button id="rpRun" class="btn primary">▶ 执行一轮调价</button>
            <span class="muted" id="rpStats"></span>
          </div>
          <div id="rpResult" class="section-gap"></div>
        </div>
      </div>
      <div>
        <div class="card">
          <div class="card-title"> 调价历史</div>
          <div class="card-sub">调价效果 → 每7天聚合 → 自动优化策略 → 沉淀到「定价策略库」</div>
          <div id="rpHistory" style="max-height:480px;overflow-y:auto"></div>
        </div>
      </div>
    </div>
  `;
  const loadHistory = async () => {
    const data = await API('/api/reprice');
    $('#rpHistory').innerHTML = data.items.length ? `<table style="min-width:560px">
      <thead><tr><th>时间</th><th>ASIN</th><th>最低价</th><th>差额</th><th>保底</th><th>目标价</th><th>结果</th></tr></thead>
      <tbody>${data.items.map((r) => `<tr>
        <td class="muted mono">${esc(r.at)}</td><td class="mono">${esc(r.asin)}</td>
        <td>${fmtMoney(r.lowest, 'GBP')}</td><td>${r.diff}</td><td>${fmtMoney(r.floor, 'GBP')}</td>
        <td><b>${fmtMoney(r.target, 'GBP')}</b></td>
        <td>${r.win ? '<span class="badge low">抢到车</span>' : '<span class="badge gray">未抢到</span>'}</td>
      </tr>`).join('')}</tbody></table>` : '<div class="empty">暂无调价记录</div>';
  };
  await loadHistory();

  $('#rpRun').addEventListener('click', async () => {
    $('#rpRun').disabled = true;
    const r = await API('/api/reprice/run', { method: 'POST' });
    const wins = r.runs.filter((x) => x.win).length;
    $('#rpStats').textContent = `本轮 ${r.runs.length} 条, 预测抢到 ${wins} 条 | 累计获取率 ${r.stats.winRate * 100}%`;
    $('#rpResult').innerHTML = `
      <div class="notice">💡 <b>飞轮建议:</b> ${r.stats.suggestion.suggestion}</div>
      <table><thead><tr><th>ASIN</th><th>最低价</th><th>目标价</th><th>结果</th></tr></thead>
      <tbody>${r.runs.map((x) => `<tr><td class="mono">${esc(x.asin)}</td><td>${fmtMoney(x.lowest, 'GBP')}</td><td><b>${fmtMoney(x.target, 'GBP')}</b></td><td>${x.win ? '🏆 抢到购物车' : '✖ 未抢到'}</td></tr>`).join('')}</tbody></table>`;
    $('#rpRun').disabled = false;
    await loadHistory();
  });
}

/* ===== 数据飞轮 ===== */
async function renderFlywheel() {
  const content = $('#content');
  const f = await API('/api/flywheel');
  const rules = await API('/api/rules');
  const wheels = [
    { key: 'compliance', name: '🛡️ 合规飞轮', desc: '人工纠正品牌/专利检测结果 → 合规规则库(同错≥3次自动入库)', value: f.compliance.accuracy || 0, display: `${Math.round((f.compliance.accuracy || 0) * 100)}%`, color: 'var(--red)', stats: `纠正 ${f.compliance.corrected} 次 · 沉淀规则 ${f.compliance.rulesSunk} 条` },
    { key: 'pricing', name: '🏷️ 定价飞轮', desc: '调价→购物车获取率→出单→实际利润 → 定价策略库(差额/保底建议)', value: f.pricing.winRate || 0, display: `${Math.round((f.pricing.winRate || 0) * 100)}%`, color: 'var(--green)', stats: `调价 ${f.pricing.total} 次 · 抢到车 ${f.pricing.buyBoxWin} 次` },
    { key: 'selection', name: '📦 选品飞轮', desc: '认领→上架→出单→退货→利润 → 选品规则库(类目/价格带偏好)', value: Math.min(1, (f.selection.hitRate || 0.5) + 0.1), display: `${Math.round(((f.selection.hitRate || 0.5) + 0.1) * 100)}%`, color: 'var(--blue)', stats: `认领 ${f.selection.claimed} 条 · 命中率 ${Math.round((f.selection.hitRate || 0.5) * 100)}%` },
    { key: 'speech', name: '💬 话术飞轮', desc: '客服回复→客户反馈→成交 → 客服话术库(优质回复自动沉淀)', value: f.speech.adoptRate || 0.7, display: `${Math.round((f.speech.adoptRate || 0.7) * 100)}%`, color: 'var(--yellow)', stats: `采纳 ${f.speech.adopted} 次 · 采纳率 ${Math.round((f.speech.adoptRate || 0.7) * 100)}%` },
  ];
  content.innerHTML = `
    <div class="notice">🔄 <b>数据飞轮:</b> 反馈采集 → 同模式错误/成功累计≥阈值(默认3次) → 生成规则 → 写入规则库(带版本历史) → 下次任务自动加载。所有沉淀可追溯、可回滚、人工可删除。</div>
    <div class="grid cols-2" style="margin-bottom:20px">
      ${wheels.map((w) => `<div class="wheel">
        <div class="wheel-name">${w.name}</div>
        <div class="muted" style="line-height:1.5">${w.desc}</div>
        <div class="wheel-bar"><div class="wheel-fill" style="width:${Math.round(w.value * 100)}%;background:${w.color}"></div></div>
        <div style="display:flex;justify-content:space-between"><b style="font-size:18px">${w.display}</b><span class="muted">${w.stats}</span></div>
      </div>`).join('')}
    </div>
    <div class="card">
      <div class="card-title"> 规则库 (飞轮沉淀产物)</div>
      <div class="card-sub">文件化存储 + 版本管理, 规则生效无需发版, 支持回滚</div>
      <table style="min-width:720px">
        <thead><tr><th>编号</th><th>类型</th><th>规则</th><th>来源</th><th>命中</th><th>创建时间</th><th>状态</th></tr></thead>
        <tbody>${rules.items.map((r) => `<tr>
          <td class="mono">${esc(r.id)}</td>
          <td>${r.type === 'compliance' ? '🛡️ 合规' : r.type === 'pricing' ? '🏷️ 定价' : '📦 选品'}</td>
          <td><b>${esc(r.title)}</b><br><span class="muted">${esc(r.desc)}</span></td>
          <td>${r.source === 'flywheel' ? '<span class="badge danger">飞轮沉淀</span>' : '<span class="badge gray">人工</span>'}</td>
          <td>${r.hits}</td><td class="muted">${esc(r.createdAt)}</td>
          <td>${r.enabled ? '<span class="badge low">启用</span>' : '<span class="badge gray">停用</span>'}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>
  `;
}

/* ===== AI Agent ===== */
async function renderAgent() {
  const content = $('#content');
  const prod = await API('/api/products');
  const AGENTS = [
    { role: '选品评估师', emoji: '🎯', duty: '评估跟卖可行性, 输出评分/风险/建议定价区间' },
    { role: '合规审查员', emoji: '🛡️', duty: '深度审查品牌/专利风险, 输出风险等级+检测依据(带引用)' },
    { role: '调价策略师', emoji: '📊', duty: '根据跟卖价历史+购物车数据, 输出差额/保底价建议' },
    { role: '运营分析师', emoji: '📈', duty: '店铺绩效解读, 输出周报/异常预警/优化建议' },
    { role: '智能客服', emoji: '💬', duty: '买家消息回复建议(话术库RAG), 人工确认后发送' },
  ];
  content.innerHTML = `
    <div class="notice">🤖 <b>AI Agent 团队:</b> 人类作为「团队Leader」审核介入 — Agent 输出带引用来源, 可一键采纳/拒绝, 采纳/拒绝即反馈喂给数据飞轮。</div>
    <div class="grid cols-3" style="margin-bottom:20px">
      ${AGENTS.map((a) => `<div class="card"><div class="card-title">${a.emoji} ${a.role}</div><div class="card-sub">${a.duty}</div></div>`).join('')}
    </div>
    <div class="card">
      <div class="card-title"> 选品评估 (Agent 演示)</div>
      <div class="card-sub">输入 ASIN → 选品评估师结合合规检测结果输出可行性评估</div>
      <div class="toolbar">
        <input id="agKw" class="input" style="width:170px" placeholder="筛选 ASIN/品牌/标题">
        <select id="agAsin" class="select" style="flex:1"></select>
        <span id="agKwHint" class="muted" style="font-size:11px"></span>
        <button id="agAssess" class="btn primary">评估</button>
      </div>
      <div id="agResult" class="section-gap"></div>
    </div>
  `;
  const sel = $('#agAsin');
  /* ★ 2026-11-10 修复: 同合规页 —— 8802 个商品全塞进原生 select (62 万字符选项文本)。
   *   改成关键词筛选 + 最多 200 个候选。 */
  const fillAgAsin = (kw) => {
    const q = String(kw || '').trim().toLowerCase();
    const list = q
      ? prod.items.filter((p) => (String(p.asin) + ' ' + String(p.brand || '') + ' ' + String(p.title || '')).toLowerCase().includes(q))
      : prod.items;
    const top = list.slice(0, 200);
    sel.innerHTML = '';
    for (const p of top) {
      const o = document.createElement('option');
      o.value = p.asin;
      o.textContent = `${p.asin} · ${p.brand || '-'} · ${String(p.title || '').slice(0, 40)}`;
      sel.appendChild(o);
    }
    const hint = document.getElementById('agKwHint');
    if (hint) hint.textContent = q ? `匹配 ${list.length} 条, 显示 ${top.length}` : `共 ${prod.items.length} 条, 显示前 ${top.length}`;
  };
  fillAgAsin('');
  const agKwEl = $('#agKw');
  if (agKwEl) {
    let t2 = null;
    agKwEl.addEventListener('input', () => { clearTimeout(t2); t2 = setTimeout(() => fillAgAsin(agKwEl.value), 200); });
  }
  $('#agAssess').addEventListener('click', async () => {
    const r = await API('/api/agent/assess', { method: 'POST', body: JSON.stringify({ asin: sel.value }) });
    const color = r.risk === 'high' ? 'var(--red)' : r.risk === 'medium' ? 'var(--yellow)' : 'var(--green)';
    $('#agResult').innerHTML = `
      <div class="agent-bubble" style="border-color:${color}">
        <div class="agent-verdict">${r.verdict} <span class="badge ${r.risk}">风险: ${r.risk}</span> <span class="muted">可行性 ${r.feasibility}/100</span></div>
        <div class="muted" style="line-height:1.6">${esc(r.reason)}</div>
        <div style="margin-top:8px"><b>建议:</b></div>
        <ul class="source-list">${r.suggestions.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
        <div style="margin-top:8px"><b>依据来源:</b></div>
        <ul class="source-list">${r.sources.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
        <div class="toolbar" style="margin-top:12px">
          <button class="btn primary small" onclick="zyAlert('✔ 已采纳建议', '反馈已进入数据飞轮')">✓ 采纳</button>
          <button class="btn small" onclick="zyAlert('✖ 已拒绝建议', '反馈已进入数据飞轮')">✕ 拒绝</button>
        </div>
      </div>`;
  });
}

/* ===== 知识库 ===== */
async function renderKnowledge() {
  const content = $('#content');
  const branddb = await API('/api/branddb');
  const rules = await API('/api/rules');
  const complianceRules = rules.items.filter((r) => r.type === 'compliance');
  const pricingRules = rules.items.filter((r) => r.type === 'pricing');
  const selectionRules = rules.items.filter((r) => r.type === 'selection');
  content.innerHTML = `
    <div class="grid cols-3" style="margin-bottom:20px">
      <div class="stat"><div class="stat-value">${branddb.total}</div><div class="stat-label"> 品牌数据库</div></div>
      <div class="stat"><div class="stat-value">${rules.total}</div><div class="stat-label"> 规则库条目</div></div>
      <div class="stat"><div class="stat-value">5</div><div class="stat-label"> 知识库分类</div></div>
    </div>
    <div class="grid cols-2">
      <div class="card">
        <div class="card-title"> 品牌数据库</div>
        <div class="card-sub">每日自动更新 + 人工纠正回流 · 检索响应 <1s</div>
        <div style="max-height:400px;overflow-y:auto"><table style="min-width:520px">
          <thead><tr><th>品牌</th><th>备案</th><th>BG</th><th>TM</th><th>专利</th><th>商标</th></tr></thead>
          <tbody>${branddb.items.slice(0, 30).map((b) => `<tr>
            <td><b>${esc(b.name)}</b></td>
            <td>${b.status === 'registered' ? '<span class="badge danger">已备案</span>' : b.status === 'unchecked' ? '<span class="badge medium">未核查</span>' : '<span class="badge low">未查到</span>'}</td>
            <td>${b.bg ? '✓' : '—'}</td><td>${b.tm ? '✓' : '—'}</td><td>${b.patent ? '<span class="badge danger">有</span>' : '—'}</td><td>${b.trademarkCount || 0}</td>
          </tr>`).join('')}</tbody></table></div>
      </div>
      <div>
        <div class="card" style="margin-bottom:16px">
          <div class="card-title"> 合规规则库 <span class="muted">(${complianceRules.length})</span></div>
          <div class="card-sub">飞轮自动沉淀 + 人工编辑 · 规则生效无需发版</div>
          <ul class="source-list">${complianceRules.map((r) => `<li><b>${esc(r.title)}</b> — ${esc(r.desc)} <span class="pill">${esc(r.source)}</span><span class="pill">命中${r.hits}</span></li>`).join('')}</ul>
        </div>
        <div class="card">
          <div class="card-title"> 定价 / 选品 规则库 <span class="muted">(${pricingRules.length + selectionRules.length})</span></div>
          <ul class="source-list">${[...pricingRules, ...selectionRules].map((r) => `<li><b>${esc(r.title)}</b> — ${esc(r.desc)} <span class="pill">${esc(r.source)}</span></li>`).join('')}</ul>
        </div>
      </div>
    </div>
  `;
}

/* ===== ★ 上架记录 (2026-09-24) =====
 * 与「商品管理」的 products 库【物理隔离】的独立存储 (listing-records.json)。
 * 数据来源: 自研采集器 v2 在 Amazon 商品详情页「📥 采集 → ✅ 入库」(含父ASIN/子体ASIN/选项/子体主图)。
 * 上品工具 (ifast.top) 页面由扩展注入 #zying-listing-records 数据块可直接读取本页数据。
 * 本页只做: 查看 / 改状态 / 删除 / 导出 —— 不写入 products, 也不参与商品库筛选。
 */
async function renderListing() {
  const content = $('#content');
  content.innerHTML = `
    <div class="notice">📤 <b>上架记录</b> —— 与「商品管理」数据库<b>物理隔离</b>的独立清单。
      由自研采集器 v2 在 Amazon <b>商品详情页</b>点「📥 采集 → ✅ 入库」写入(含 <b>父ASIN / 子体ASIN / 变体选项 / 子体主图</b>)。
      上品工具 <code>ifast.top</code> 页面可直接读取扩展注入的 <code>#zying-listing-records</code> 数据块。<br>
      <b>本页只负责"记录"</b> —— 而且状态数据只有一种: <b>上传结果</b>(成功 / <b>失败</b> / 还没有结果)。
      "待填 / 待上传 / 已填未传"这类中间态已经删掉, 不再作为状态显示(排不排队由"有没有成功记录"推出来, 不占状态)。
      上传与填表都在采集器 → ifast 那条链路上完成, 这里不放上传类按钮。</div>

    <div class="card">
      <div class="card-title">${ic ? ic('product', 15) + ' ' : ''}概览</div>
      <div id="lsStats" class="section-gap"></div>
    </div>

    <div class="card">
      <div class="card-title">📋 记录列表
        <span style="margin-left:auto;display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          <input id="lsQ" class="input" placeholder="🔍 ASIN / 标题 / 品牌 / 父ASIN" style="width:220px">
          <select id="lsShop" class="input" style="width:168px" title="按店铺筛选 —— 多店铺隔离: 每个店铺的记录分开存。默认「当前店铺」= 上架器最近登录的那个店铺(插件登录什么店铺就用什么数据)"></select>
          <select id="lsResult" class="input" style="width:142px" title="按上传结果筛选(只有这一种状态数据)">
            <option value="">全部上传结果</option>
            <option value="ok">✅ 成功</option>
            <option value="failed">❌ 失败</option>
            <option value="none">— 还没有结果</option>
            <option value="everfailed">历史上失败过</option>
          </select>
          <button id="lsReload" class="btn small">刷新</button>
        </span>
      </div>
      <div id="lsList" class="section-gap"></div>
      <div class="section-gap" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
        <button id="lsCsv" class="btn small">⤓ 导出 CSV</button>
        <button id="lsLogBtn" class="btn small">🕘 上传记录</button>
        <button id="lsArchive" class="btn small">🗄 归档到选品库</button>
        <button id="lsCopy" class="btn small">📋 复制选中 ASIN</button>
        <button id="lsMoreBtn" class="btn small" title="标记状态/补子体价格/删除 —— 按需求收起来了, 需要时再展开">⋯ 更多操作</button>
        <span id="lsMore" style="display:none;gap:6px;flex-wrap:wrap;align-items:center">
          <button id="lsMarkListed" class="btn small">✓ 标记选中为已上架</button>
          <button id="lsMarkPending" class="btn small">↺ 改回待上架</button>
          <button id="lsFillPrices" class="btn small">💰 补子体价格</button>
          <button id="lsDel" class="btn small">🗑 删除选中</button>
          <button id="lsClear" class="btn small">清空全部</button>
        </span>
        <span id="lsSelInfo" class="muted"></span>
      </div>
    </div>

    <div class="card" id="lsLogCard" style="display:none">
      <div class="card-title">🕘 上传记录 —— 每次填表/提交的流水
        <span style="margin-left:auto;display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          <select id="lsLogFilter" class="input" style="width:126px">
            <option value="">全部</option>
            <option value="failed">只看失败</option>
            <option value="ok">只看成功</option>
          </select>
          <button id="lsLogReload" class="btn small">刷新</button>
          <button id="lsLogCsv" class="btn small">⤓ 导出流水 CSV</button>
        </span>
      </div>
      <div id="lsLog" class="section-gap"></div>
      <div id="lsLogInfo" class="muted"></div>
    </div>`;

  const sel = new Set();
  let rows = [];

  const badgeOf = (st) => st === 'listed'
    ? '<span class="badge low">已上架</span>'
    : st === 'failed' ? '<span class="badge danger">失败</span>' : '<span class="muted">—</span>';   // 旧调用点保留: 现在没有"待上架"这种中间态了

  /* ★ 2026-09-27 状态简化: 记录里只有【上传结果】一种状态数据 —— 成功 / 失败 / 还没有结果。
   *   "待填 / 待上传 / 已填未传"不再作为状态显示(排不排队由后端按"有没有成功记录"推导)。 */
  const resOf = (x) => x.uploadResult || null;
  const resBadge = (res) => res === 'ok'
    ? '<span class="badge low">成功</span>'
    : res === 'failed' ? '<span class="badge danger">失败</span>' : '<span class="muted">—</span>';
  const lastOf = (x) => (x.uploads || [])[0] || null;
  const upCell = (x) => {
    const last = lastOf(x), us = x.uploads || [], res = resOf(x);
    return resBadge(res) +
      (last ? ' <span class="muted">' + esc(String(last.at || '').slice(5, 16)) + '</span>' : '') +
      (res === 'failed' && (x.failReason || last.reason) ? ' <span class="muted" title="' + esc(x.failReason || last.reason) + '">ⓘ</span>' : '') +
      (us.length ? ' <a href="javascript:void(0)" class="ls-up" data-i="' + esc(x._i) + '" title="展开每次尝试的明细">🕘' + us.length + '</a>' : '');
  };
  /** 单次尝试的结果: 成功(真提交过) / 已上架(商品在本店铺已上架) / 失败 / 被拦下 / 未提交 */
  const attemptBadge = (u) => u.preflight === true
    ? '<span class="badge medium" title="提交前就被拦下(商品已存在/探活没过) —— 一个字节都没发出去, 不是上传结果, 状态不受影响">被拦下</span>'
    : (u.alreadyListed === true
      ? '<span class="badge low" title="该商品在本店铺已上架' + (u.noChange ? '(本次要写的内容与线上一致 → 未产生写入)' : '(本次按你的数据更新了这条)') + '">已上架</span>'
      : (u.ok === false
        ? '<span class="badge danger">失败</span>'
        : (u.submitted === true ? '<span class="badge low">成功</span>' : '<span class="badge" title="填了表但没提交 —— 不是上传结果">未提交</span>')));
  /** 展开的"每次尝试"明细(上架记录只做记录 → 这里就是把记录摊开看) */
  const uploadHistoryHtml = (x) => {
    const us = x.uploads || [];
    return '<div style="max-height:240px;overflow:auto"><table style="min-width:880px"><thead><tr>' +
      '<th>第几次</th><th>时间</th><th>结果</th><th>填表</th><th>失败字段</th><th>原因(ifast 原话)</th></tr></thead><tbody>' +
      us.map((u) => '<tr>' +
        '<td>#' + esc(u.attempt || '') + '</td>' +
        '<td style="white-space:nowrap">' + esc(String(u.at || '')) + '</td>' +
        '<td>' + attemptBadge(u) + '</td>' +
        '<td>' + esc(u.fieldsOk != null ? (u.fieldsOk + ' 项成功') : '') + (u.fieldsBad ? (' / <span class="badge danger">' + esc(u.fieldsBad) + ' 项失败</span>') : '') + '</td>' +
        '<td style="max-width:240px">' + esc((u.badFields || []).join('; ').slice(0, 120)) + '</td>' +
        '<td style="max-width:420px">' + esc(String(u.reason || '').slice(0, 200)) + '</td>' +
        '</tr>').join('') + '</tbody></table></div>' +
      (x.failReason && resOf(x) === 'failed' ? '<div class="muted" style="margin-top:4px">最近一次失败原因: <b style="color:#ff8080">' + esc(x.failReason) + '</b></div>' : '') +
      '<div class="muted" style="margin-top:4px">共尝试 ' + esc(x.uploadsTotal || us.length) + ' 次' + (x.failCount ? ' · 其中失败 ' + esc(x.failCount) + ' 次' : '') + '</div>';
  };

  const load = async () => {
    const q = $('#lsQ').value.trim(), res = $('#lsResult').value, shop = $('#lsShop').value;
    /* ★ 2026-10-07 多店铺隔离(网页端补齐): 传 shop → 后端按店铺隔离返回。
     *   shop 为空 = 后端默认(当前店铺) —— 与上架器"登录什么店铺就用什么数据"同一口径;
     *   shop=* 看全部(总览/排障), shop=none 看未分类(老数据/商品库来源)。 */
    const r = await API('/api/listing/records?limit=500' + (q ? '&q=' + encodeURIComponent(q) : '') + (res ? '&upload=' + encodeURIComponent(res) : '') + (shop ? '&shop=' + encodeURIComponent(shop) : ''));
    /* 店铺下拉的选项来自后端【全局】统计(byShop, 不受当前筛选影响); 用户已选的值要保住,
     * 否则每次刷新都跳回默认(实测踩过: 选了"全部店铺"一刷新就只剩当前店铺的)。 */
    const shopEl = $('#lsShop');
    if (shopEl) {
      const keep = shopEl.value, byShop = r.byShop || {}, un = byShop['未分类'] || 0;
      const names = Object.keys(byShop).filter((s) => s !== '未分类').sort();
      const sig = String(r.currentShop || '') + '|' + names.join(',') + '|' + un;
      if (shopEl.dataset.sig !== sig) {
        shopEl.dataset.sig = sig;
        shopEl.innerHTML = '<option value="">当前店铺' + (r.currentShop ? ('（' + esc(r.currentShop) + '）') : '（未识别）') + '</option>' +
          '<option value="*">全部店铺</option>' +
          names.map((s) => '<option value="' + esc(s) + '">🏪 ' + esc(s) + '（' + esc(byShop[s] || 0) + '）</option>').join('') +
          (un ? '<option value="none">未分类（' + esc(un) + '）</option>' : '');
        if (keep === '*' || keep === 'none' || names.indexOf(keep) >= 0) shopEl.value = keep;
      }
    }
    rows = r.items || [];
    const s = r.stats || {}, up = s.uploads || {}, br = s.byResult || {};
    $('#lsStats').innerHTML = '<div style="display:flex;gap:12px;flex-wrap:wrap">' +
      [['总数', s.total || 0], ['✅ 成功', br.ok || 0], ['❌ 失败', br.failed || 0], ['— 还没有结果', br.none || 0],
       ['上传尝试', up.attempts || 0], ['其中失败', up.failed || 0], ['重传过的品', up.retried || 0],
       ['最近失败', up.lastFailAt ? String(up.lastFailAt).slice(5, 16) : '—'],
       ['含变体', s.withVariants || 0], ['站点', Object.keys(s.bySite || {}).join('/') || '-']]
        .map((kv) => '<div class="filter-item" style="min-width:104px"><label>' + kv[0] + '</label>' +
          '<div style="font-size:19px;font-weight:700">' + esc(kv[1]) + '</div></div>').join('') + '</div>' +
      ((up.topFailReasons || []).length
        ? '<div class="muted" style="margin-top:8px">失败原因 Top: ' +
          up.topFailReasons.map((f) => '<b style="color:#ff8080">' + esc(f.count) + '×</b> ' + esc(f.reason)).join(' · ') + '</div>'
        : '') +
      /* ★ 2026-10-07 多店铺隔离: 上面那些统计是【全部店铺】的口径(后端 listingStats 是全量),
       *   而列表按店铺筛选 —— 不说明白会出现"列表 6 条 / 概览总数 8"看起来像对不上。
       *   这里把店铺分布和"当前筛选"交代清楚, 口径不含糊。 */
      (Object.keys(r.byShop || {}).length
        ? '<div class="muted" style="margin-top:8px">店铺分布(全部): ' + Object.keys(r.byShop).sort((a, b) => r.byShop[b] - r.byShop[a])
          .map((x) => '<b>' + esc(x) + '</b> ' + esc(r.byShop[x]) + ' 条').join(' · ') +
          ' · 当前筛选 <b>' + esc(shop === '' ? ('当前店铺（' + (r.currentShop || '未识别') + '）') : (shop === '*' ? '全部店铺' : (shop === 'none' ? '未分类' : shop))) +
          '</b> → 命中 ' + esc((r.total != null ? r.total : rows.length)) + ' 条(上面的概览是全店铺口径)</div>'
        : '');

    if (!rows.length) {
      $('#lsList').innerHTML = '<div class="empty">' + ((q || res) ? '当前筛选没有匹配的上架记录' : '暂无上架记录 —— 请在 Amazon 商品详情页用采集器 v2 点「📥 采集」再「✅ 入库」') + '</div>';
      $('#lsSelInfo').textContent = '';
      return;
    }
    rows.forEach((x, i) => { x._i = i; });
    $('#lsList').innerHTML = '<div style="overflow:auto;max-height:520px"><table style="min-width:1440px">' +
      '<thead><tr><th style="width:30px"><input type="checkbox" id="lsAll"></th>' +
      '<th>ASIN</th><th>父ASIN</th><th>店铺</th><th>站点</th><th>品牌</th><th>标题</th><th>价格</th><th>子体</th>' +
      '<th>月销</th><th>大排名</th><th>小排名</th><th>配送</th><th>上传结果</th><th>次数</th><th>采集时间</th><th></th></tr></thead><tbody>' +
      rows.map((x, i) => {
        const p = x.panel || {}, v = x.variant || {}, kids = v.children || [];
        const cc = v.childCount || kids.length || 0;
        const us = x.uploads || [];
        return '<tr data-i="' + i + '">' +
          '<td><input type="checkbox" class="ls-cb" data-id="' + esc(x.id) + '"></td>' +
          '<td><b>' + esc(x.asin) + '</b></td>' +
          '<td>' + esc(x.parentAsin || '—') + '</td>' +
          /* ★ 店铺列(多店铺隔离): 记录没归属(老数据/商品库来源) → 显示「未分类」, 不编造 */
          '<td style="white-space:nowrap">' + (x.shop ? esc(x.shop) : '<span class="muted">未分类</span>') + '</td>' +
          '<td>' + esc((x.site || '').toUpperCase()) + '</td>' +
          '<td>' + esc(x.brand || '') + '</td>' +
          '<td style="max-width:260px">' + esc(String(x.title || '').slice(0, 60)) + '</td>' +
          '<td>' + (x.price != null ? esc(x.price) + ' ' + esc(x.currency || '') : '') + '</td>' +
          '<td>' + (cc ? '<a href="javascript:void(0)" class="ls-exp" data-i="' + i + '">' + cc + ' 个 ' + (v.dims || []).map((d) => esc(d.nameCn || d.name)).join('×') + '</a>' : '—') + '</td>' +
          '<td>' + (p.sales30d != null ? esc(p.sales30d) : '') + '</td>' +
          '<td>' + (p.bsrShop != null ? '#' + esc(p.bsrShop) : '') + '</td>' +
          '<td>' + (p.bsrCat != null ? '#' + esc(p.bsrCat) + (p.bsrCatName ? ' ' + esc(String(p.bsrCatName).slice(0, 16)) : '') : '') + '</td>' +
          '<td>' + esc(p.fulfill || '') + '</td>' +
          '<td style="white-space:nowrap">' + upCell(x) + '</td>' +
          '<td>' + esc(x.uploadsTotal || us.length || 0) + (x.failCount ? ' <span class="badge danger">败' + esc(x.failCount) + '</span>' : '') + '</td>' +
          '<td style="white-space:nowrap">' + esc(String(x.savedAt || '').slice(5, 16)) + '</td>' +
          '<td><button class="btn small ls-del" data-id="' + esc(x.id) + '">删</button></td>' +
          '</tr>' +
          (us.length ? '<tr class="ls-ups" id="lsUps' + i + '" style="display:none"><td></td><td colspan="16">' + uploadHistoryHtml(x) + '</td></tr>' : '') +
          '<tr class="ls-kids" id="lsKids' + i + '" style="display:none"><td></td><td colspan="16">' +
          (kids.length
            ? '<div style="max-height:260px;overflow:auto"><table style="min-width:720px"><thead><tr><th>子体 ASIN</th>' +
              (v.dims || []).map((d) => '<th>' + esc(d.nameCn || d.name) + '</th>').join('') +
              '<th>选中</th><th>价格</th><th>主图</th></tr></thead><tbody>' +
              kids.map((c) => '<tr><td>' + esc(c.asin) + '</td>' +
                (v.dims || []).map((d) => '<td>' + esc((c.options || {})[d.nameCn || d.name] || '') + '</td>').join('') +
                '<td>' + (c.selected ? '✓' : '') + '</td>' +
                '<td>' + (c.price != null ? esc(c.price) : '<span class="muted">—</span>') + '</td>' +
                '<td>' + (c.image ? '<a href="' + esc(c.image) + '" target="_blank" rel="noopener"><img src="' + esc(c.image) + '" style="height:34px;border-radius:3px"></a>' : '<span class="muted">—</span>') + '</td>' +
                '</tr>').join('') + '</tbody></table></div>' +
              '<div class="muted" style="margin-top:4px">子体价格说明: Amazon 详情页只渲染<b>当前选中</b>子体的价格, 其余拿不到 → 留空(不编造)</div>'
            : '<span class="muted">该商品无变体子体数据</span>') +
          '</td></tr>';
      }).join('') + '</tbody></table></div>';

    $('#lsSelInfo').textContent = '共 ' + rows.length + ' 条';
    $('#lsAll').addEventListener('change', (e) => {
      $$('.ls-cb').forEach((cb) => { cb.checked = e.target.checked; if (e.target.checked) sel.add(cb.dataset.id); else sel.delete(cb.dataset.id); });
      info();
    });
    $$('.ls-cb').forEach((cb) => cb.addEventListener('change', () => { if (cb.checked) sel.add(cb.dataset.id); else sel.delete(cb.dataset.id); info(); }));
    $$('.ls-exp').forEach((a) => a.addEventListener('click', () => {
      const r = $('#lsKids' + a.dataset.i);
      if (r) r.style.display = r.style.display === 'none' ? '' : 'none';
    }));
    /* 🕘 展开这件商品的每次上传尝试(时间/结果/失败字段/ifast 原话) */
    $$('.ls-up').forEach((a) => a.addEventListener('click', () => {
      const r = $('#lsUps' + a.dataset.i);
      if (r) r.style.display = r.style.display === 'none' ? '' : 'none';
    }));
    $$('.ls-del').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('删除这条上架记录? (只删上架记录, 不动商品库)')) return;
      await API('/api/listing/records/delete', { method: 'POST', body: JSON.stringify({ ids: [b.dataset.id] }) });
      sel.delete(b.dataset.id); load();
    }));
    info();
  };
  const info = () => { $('#lsSelInfo').textContent = '共 ' + rows.length + ' 条' + (sel.size ? (' · 已选 ' + sel.size) : ''); };

  const act = async (status) => {
    if (!sel.size) { alert('请先勾选记录'); return; }
    await API('/api/listing/records/status', { method: 'POST', body: JSON.stringify({ ids: [...sel], status }) });
    load();
  };

  $('#lsReload').addEventListener('click', load);
  $('#lsQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') load(); });
  $('#lsResult').addEventListener('change', load);
  /* ★ 2026-10-07 店铺筛选: 换店铺 → 清空勾选(跨店铺的勾选没有意义) + 重载列表; 上传记录卡片开着就一起刷新 */
  $('#lsShop').addEventListener('change', () => {
    sel.clear();
    load();
    if ($('#lsLogCard') && $('#lsLogCard').style.display !== 'none') loadLog();
  });
  /* ★ 2026-09-27 上架器只做记录/显示/导出 —— 动作类按钮默认收起, 需要时展开 */
  $('#lsMoreBtn').addEventListener('click', () => {
    const box = $('#lsMore'), on = box.style.display === 'none';
    box.style.display = on ? 'flex' : 'none';
    $('#lsMoreBtn').textContent = on ? '⋯ 收起操作' : '⋯ 更多操作';
  });
  /* ★ 归档到选品库: 勾了就归档勾选的, 没勾就归档当前列表(含筛选结果) */
  $('#lsArchive').addEventListener('click', async () => {
    const picked = sel.size ? rows.filter((x) => sel.has(x.id)) : rows;
    if (!picked.length) { $('#lsSelInfo').textContent = '✗ 没有可归档的记录'; return; }
    const today = new Date().toISOString().slice(0, 10);
    $('#lsSelInfo').textContent = '⏳ 正在归档 ' + picked.length + ' 条…';
    try {
      const r = await API('/api/archive/save', { method: 'POST', body: JSON.stringify({
        source: 'listing', ids: picked.map((x) => x.id),
        name: today + ' 上架记录 ' + picked.length + ' 个' + (sel.size ? ' (选中)' : ''),
      }) });
      if (!r.ok) { $('#lsSelInfo').textContent = '✗ ' + (r.error || '归档失败'); return; }
      $('#lsSelInfo').innerHTML = '✓ 已归档 ' + r.count + ' 个品到「' + esc(r.name) + '」' +
        (r.dupCount ? ' · 其中 ' + r.dupCount + ' 个以前归档过' : '') +
        ' —— 去 <a href="javascript:void(0)" id="lsGoArchive">选品归档</a> 检索/导出';
      const go = $('#lsGoArchive');
      if (go) go.addEventListener('click', () => navigate('archive'));
    } catch (e) { $('#lsSelInfo').textContent = '✗ ' + e.message; }
  });
  $('#lsMarkListed').addEventListener('click', () => act('listed'));
  $('#lsMarkPending').addEventListener('click', () => act('pending'));
  $('#lsCopy').addEventListener('click', async () => {
    const ids = sel.size ? rows.filter((x) => sel.has(x.id)).map((x) => x.asin) : rows.map((x) => x.asin);
    if (!ids.length) { alert('没有可复制的 ASIN'); return; }
    try { await navigator.clipboard.writeText(ids.join(',')); $('#lsSelInfo').textContent = '✓ 已复制 ' + ids.length + ' 个 ASIN'; }
    catch (e) { $('#lsSelInfo').textContent = '复制失败: ' + e.message; }
  });
  $('#lsCsv').addEventListener('click', async () => {
    const r = await API('/api/listing/export?format=csv');
    const blob = new Blob(['\ufeff' + (r.csv || '')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'listing-records-' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
  });
  $('#lsDel').addEventListener('click', async () => {
    if (!sel.size) { alert('请先勾选记录'); return; }
    if (!confirm('删除选中的 ' + sel.size + ' 条上架记录? (只删上架记录, 不动商品库)')) return;
    await API('/api/listing/records/delete', { method: 'POST', body: JSON.stringify({ ids: [...sel] }) });
    sel.clear(); load();
  });
  $('#lsClear').addEventListener('click', async () => {
    if (!confirm('清空【全部】上架记录? 此操作只影响上架记录(独立存储), 商品库不受影响。')) return;
    await API('/api/listing/records/clear', { method: 'POST', body: '{}' });
    sel.clear(); load();
  });

  // ★ 补子体价格: Amazon 详情页只渲染选中子体的价格, 其余只能逐个开子体页读 (显式按需动作)
  $('#lsFillPrices').addEventListener('click', async () => {
    const picked = sel.size ? rows.filter((x) => sel.has(x.id)) : rows;
    if (!picked.length) { alert('没有可补价的记录'); return; }
    const ids = picked.map((x) => x.id);
    const pending = picked.reduce((n, x) => n + (((x.variant && x.variant.children) || []).filter((c) => c.price == null).length), 0);
    if (!pending) { alert('这些记录的子体都已有价格, 无需补'); return; }
    const mins = Math.max(1, Math.ceil(pending * 7 / 60));
    if (!confirm('将逐个打开 ' + pending + ' 个子体商品页读价 (约 ' + mins + ' 分钟, 会占用采集用的 Edge 标签页, 期间请不要手动操作那个窗口)。\n\n继续?')) return;
    $('#lsSelInfo').textContent = '⏳ 正在补价 (' + pending + ' 个子体)…';
    let r;
    try { r = await API('/api/listing/fill-child-prices', { method: 'POST', body: JSON.stringify({ ids }) }); }
    catch (e) { $('#lsSelInfo').textContent = '✗ ' + e.message; return; }
    if (r && r.busy) { $('#lsSelInfo').textContent = '✗ ' + r.error; return; }
    if (r && r.ok && r.total === 0) { $('#lsSelInfo').textContent = '✓ ' + (r.msg || '无需补'); return; }
    const t0 = Date.now();
    const timer = setInterval(async () => {
      try {
        const pg = await API('/api/collect/progress');
        const secs = Math.round((Date.now() - t0) / 1000);
        if (pg && pg.running) $('#lsSelInfo').textContent = '⏳ ' + (pg.step || '补价中') + ' · ' + secs + 's';
        else { clearInterval(timer); $('#lsSelInfo').textContent = '✓ 补价完成, 正在刷新…'; load(); }
      } catch (e) { /* 忽略单次轮询失败 */ }
    }, 3000);
  });

  await load();

  /* ★ 2026-09-27 「上传记录」流水 —— 上架记录只做记录, 这一块就是把每次上传摊开:
   *   时间 / 哪件商品 / 第几次 / 结果 / 填了几项 / 失败字段 / ifast 的原话。
   *   用户要的"记录商品的上传数据, 比如上传失败"就是这里。 */
  let logRows = [];
  const loadLog = async () => {
    const f = $('#lsLogFilter').value;
    /* ★ 上传流水跟「店铺」筛选走同一口径 —— 否则上面按店铺筛、下面流水还是当前店铺, 两处对不上。
     *   不传 shop = 后端默认(当前店铺), 与上架器"登录什么店铺就用什么数据"一致。 */
    const lshop = $('#lsShop') ? $('#lsShop').value : '';
    $('#lsLogInfo').textContent = '⏳ 读取中…';
    let r;
    try { r = await API('/api/listing/uploads?limit=300' + (f ? '&result=' + encodeURIComponent(f) : '') + (lshop ? '&shop=' + encodeURIComponent(lshop) : '')); }
    catch (e) { $('#lsLogInfo').textContent = '✗ ' + e.message; return; }
    logRows = r.items || [];
    const st = (r.stats && r.stats.uploads) || {};
    $('#lsLog').innerHTML = logRows.length
      ? '<div style="overflow:auto;max-height:420px"><table style="min-width:1180px"><thead><tr>' +
        '<th>时间</th><th>商品</th><th>店铺</th><th>站点</th><th>第几次</th><th>结果</th><th>填表</th><th>失败字段</th><th>原因(ifast 原话)</th><th>当前状态</th></tr></thead><tbody>' +
        logRows.map((u) => '<tr>' +
          '<td style="white-space:nowrap">' + esc(String(u.at || '')) + '</td>' +
          '<td><b>' + esc(u.asin) + '</b><div class="muted" style="max-width:220px">' + esc(String(u.title || '').slice(0, 34)) + '</div></td>' +
          '<td style="white-space:nowrap">' + (u.shop ? esc(u.shop) : '<span class="muted">未分类</span>') + '</td>' +
          '<td>' + esc(String(u.site || '').toUpperCase()) + '</td>' +
          '<td>#' + esc(u.attempt || '') + '</td>' +
          '<td>' + attemptBadge(u) + '</td>' +
          '<td>' + esc(u.fieldsOk != null ? u.fieldsOk : '') + (u.fieldsBad ? ' / <span class="badge danger">' + esc(u.fieldsBad) + ' 失败</span>' : '') + '</td>' +
          '<td style="max-width:200px">' + esc((u.badFields || []).join('; ').slice(0, 100)) + '</td>' +
          '<td style="max-width:360px">' + esc(String(u.reason || '').slice(0, 180)) + '</td>' +
          '<td>' + resBadge(u.nowResult != null ? u.nowResult : null) + (u.failCount ? ' <span class="muted">败' + esc(u.failCount) + '</span>' : '') + '</td>' +
          '</tr>').join('') + '</tbody></table></div>'
      : '<div class="empty">还没有上传记录 —— 采集器点「上传」后, ifast 那边的每次填表/提交结果都会记到这里</div>';
    $('#lsLogInfo').textContent = '共 ' + (r.total || 0) + ' 条流水' +
      ' · 尝试 ' + (st.attempts || 0) + ' 次, 成功 ' + (st.ok || 0) + ', 失败 ' + (st.failed || 0) +
      ' · 有 ' + (st.neverTried || 0) + ' 件还没有上传结果' +
      (st.lastFailAt ? ' · 最近失败 ' + String(st.lastFailAt).slice(5, 16) : '');
  };
  $('#lsLogBtn').addEventListener('click', () => {
    const card = $('#lsLogCard'), on = card.style.display === 'none';
    card.style.display = on ? '' : 'none';
    $('#lsLogBtn').textContent = on ? '🕘 收起上传记录' : '🕘 上传记录';
    if (on) loadLog();
  });
  $('#lsLogFilter').addEventListener('change', loadLog);
  $('#lsLogReload').addEventListener('click', loadLog);
  $('#lsLogCsv').addEventListener('click', async () => {
    if (!logRows.length) { await loadLog(); }
    if (!logRows.length) { $('#lsLogInfo').textContent = '✗ 没有可导出的上传记录'; return; }
    const head = ['时间', 'ASIN', '店铺', '站点', '标题', '第几次', '结果', '填表成功项', '填表失败项', '失败字段', '原因', '当前状态', '累计失败次数'];
    const q = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s };
    const csv = [head.join(',')].concat(logRows.map((u) => [u.at, u.asin, u.shop || '未分类', u.site, u.title, u.attempt,
      u.preflight === true ? '被拦下' : (u.alreadyListed === true ? '已上架' : (u.ok === false ? '失败' : (u.submitted === true ? '成功' : '未提交'))),
      u.fieldsOk, u.fieldsBad, (u.badFields || []).join('; '), u.reason,
      u.nowStatus, u.failCount].map(q).join(','))).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '上传记录-' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    $('#lsLogInfo').textContent = '✓ 已导出 ' + logRows.length + ' 条上传记录';
  });
}


/* ===== ★ 选品归档 (2026-09-27) =====
 * 用户原话: 「上架器只负责记录和显示信息，导出信息等，加上一个导出当前所有商品信息…存起来，
 *   因为这些都是我们最终选出来的品，具有模板或者借鉴意义，方便后续根据这些品来找相应的品」。
 * 本页只做三件事: 归档(存快照) / 检索 / 导出文件 —— 不采集、不上架、不改商品库。
 */
/* ===== 蓝海选品 (selection): 贴榜单/搜索页 URL → 一键扫描评分 ===== */
const SEL_KEY = 'zying-selection-url';
let SEL_STATE = { groups: [], byType: [], candidates: [], items: [], coverage: null, catName: '', site: '', at: '', sort: 'pick', kw: '', minPick: 0, sel: new Set(), ip: {}, cache: null, panel: null };

async function renderSelection() {
  const content = $('#content');
  const lastUrl = localStorage.getItem(SEL_KEY) || 'https://www.amazon.co.uk/gp/bestsellers/sports/';
  content.innerHTML = `
    <div class="notice">🎯 <b>蓝海选品</b> —— 贴一个 Amazon <b>榜单页/搜索页</b> URL, 一次扫描同时读出:
      标题·价格·评分·<b>评论数</b>·<b>品牌</b>·<b>重量</b>·变体·卖家(含 Amazon 自营)·跟卖数·A+, 然后按
      <b>五维(市场/增长/竞争/壁垒/利润)</b> 给类目打分, 并挑出「上榜但评论少 / 卖得动但评分低」的候选。
      只读不写商品库 —— 看中的勾上再「加入商品库」, 之后去商品管理走「一键补采」补详情。</div>

    <div class="card">
      <div class="card-title">① 扫描</div>
      <div class="section-gap" style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
        <div class="filter-item" style="flex:1;min-width:420px"><label>Amazon 列表/榜单 URL</label>
          <input id="selUrl" class="input" style="width:100%" value="${esc(lastUrl)}"
            placeholder="https://www.amazon.co.uk/gp/bestsellers/sports/ 或 /s?k=flashlight"></div>
        <div class="filter-item"><label>翻页</label>
          <select id="selPages" class="input" style="width:80px">
            <option value="1">1 页</option><option value="2" selected>2 页</option>
            <option value="3">3 页</option><option value="5">5 页</option>
          </select></div>
        <div class="filter-item"><label>等插件(毫秒)</label>
          <input id="selWait" class="input" type="number" style="width:96px" value="12000" min="3000" max="40000" step="1000"
            title="智赢插件要时间分析面板(品牌/重量/卖家); 榜单页第一次可给 15000"></div>
        <div class="filter-item"><label>候选价带</label>
          <input id="selPmin" class="input" type="number" style="width:70px" value="10" title="价带下限(站点本币)">
          <span class="muted">–</span>
          <input id="selPmax" class="input" type="number" style="width:70px" value="45" title="价带上限"></div>
        <button id="selRun" class="btn btn-primary">🚀 开始扫描</button>
        <span id="selMsg" class="muted"></span>
      </div>
      <div class="muted" style="margin-top:6px">扫描会占用 ERP 那个浏览器标签页约 20–60 秒 (翻页越多越久); 期间别手动操作那个标签。</div>
    </div>

    <div id="selResult"></div>`;

  $('#selUrl').addEventListener('change', (e) => localStorage.setItem(SEL_KEY, e.target.value.trim()));
  $('#selRun').addEventListener('click', runSelectionScan);

  // 已有结果 → 直接回显 (刷新/切页不丢)
  try {
    const r = await API('/api/select/last');
    if (r && r.ok) {
      Object.assign(SEL_STATE, {
        groups: r.groups || [], byType: r.byType || [], candidates: r.candidates || [],
        coverage: r.coverage, catName: r.catName || '', site: r.site || '', at: r.at || '',
        sort: 'pick', kw: '', minPick: 0, sel: new Set(),
      });
      $('#selUrl').value = r.url || $('#selUrl').value;
      renderSelectionResult();
      $('#selMsg').textContent = '已回显最近一次扫描 (' + (r.at || '') + ')';
    }
  } catch (e) { /* 没有历史结果, 正常 */ }
}

async function runSelectionScan() {
  const url = $('#selUrl').value.trim();
  if (!/^https:\/\/(www\.)?amazon\./.test(url)) { showModal({ title: 'URL 不对', body: '请填完整 https://www.amazon.xxx/... 列表页或榜单页地址' }); return; }
  localStorage.setItem(SEL_KEY, url);
  const btn = $('#selRun'), msg = $('#selMsg');
  btn.disabled = true;
  const t0 = Date.now();
  const tick = setInterval(() => { msg.textContent = '扫描中… ' + Math.round((Date.now() - t0) / 1000) + 's (翻页 + 等插件分析)'; }, 1000);
  msg.textContent = '扫描中…';
  try {
    const r = await API('/api/select/scan', {
      method: 'POST',
      body: JSON.stringify({
        url: url,
        maxPages: Number($('#selPages').value) || 1,
        waitPluginMs: Number($('#selWait').value) || 12000,
        priceMin: Number($('#selPmin').value) || 10,
        priceMax: Number($('#selPmax').value) || 45,
      }),
    });
    Object.assign(SEL_STATE, {
      groups: r.groups || [], byType: r.byType || [], candidates: r.candidates || [], items: r.items || [],
      coverage: r.coverage, catName: r.catName || '', site: r.site || '', at: r.at || '',
      sort: 'pick', kw: '', minPick: 0, sel: new Set(), ip: {}, cache: r.cache || null, panel: r.panel || null,
    });
    renderSelectionResult();
    msg.textContent = '完成: ' + (r.items || []).length + ' 条, 候选 ' + (r.candidates || []).length + ' 个, 用时 ' + Math.round((Date.now() - t0) / 1000) + 's';
  } catch (e) {
    msg.textContent = '';
    showModal({ title: '扫描失败', body: String(e.message || e) + '<br><br><span class="muted">常见原因: ① ERP 浏览器没切到本机 Edge (浏览器面板 → 切到用户浏览器) ② 那个标签页被验证码拦了 ③ 插件没注入(未登录)</span>' });
  } finally {
    clearInterval(tick);
    btn.disabled = false;
  }
}

function renderSelectionResult() {
  const box = $('#selResult');
  const S = SEL_STATE;
  const cov = S.coverage;
  if (!cov) { box.innerHTML = ''; return; }
  const covRow = [
    ['价格', cov.price], ['评分', cov.rating], ['评论', cov.reviews], ['品牌', cov.brand],
    ['重量', cov.weight], ['细分类', cov.ptype],
  ].map(([k, v]) => {
    const pctv = cov.total ? Math.round(v / cov.total * 100) : 0;
    const cls = pctv >= 80 ? 'ok' : pctv >= 40 ? 'warn' : 'bad';
    return `<span class="muted" style="margin-right:10px">${k} <b class="${cls}">${v}/${cov.total}</b> (${pctv}%)</span>`;
  }).join('');

  const grpRows = S.groups.map((g) => `<tr>
    <td><b>${esc(g.label)}</b></td><td class="num">${g.n}</td><td class="num">${fmtMoney(g.medPrice, 'GBP')}</td>
    <td class="num">${fmtNum(g.medRev)}</td><td class="num ${g.light >= 0.15 ? 'ok' : ''}">${g.light == null ? '-' : Math.round(g.light * 100) + '%'}</td>
    <td class="num ${g.amazonShare >= 0.4 ? 'bad' : ''}">${g.amazonShare == null ? '-' : Math.round(g.amazonShare * 100) + '%'}</td>
    <td class="num">${g.top3Share == null ? '-' : Math.round(g.top3Share * 100) + '%'}</td>
    <td class="num">${g.medWeightG == null ? '-' : g.medWeightG + 'g'}</td>
    <td class="num"><b>${g.score == null ? '-' : g.score}</b></td>
    <td class="muted" style="font-size:11px">${g.parts ? Object.entries(g.parts).map(([k, v]) => k + ':' + (v == null ? '—' : v)).join(' ') : ''}</td>
  </tr>`).join('');

  const typeRows = (S.byType || []).slice(0, 8).map((g) => `<tr>
    <td>${esc(g.label)}</td><td class="num">${g.n}</td><td class="num">${fmtMoney(g.medPrice, 'GBP')}</td>
    <td class="num">${fmtNum(g.medRev)}</td><td class="num">${g.light == null ? '-' : Math.round(g.light * 100) + '%'}</td>
    <td class="num">${g.top3Share == null ? '-' : Math.round(g.top3Share * 100) + '%'}</td>
    <td class="num"><b>${g.score == null ? '-' : g.score}</b></td></tr>`).join('');

  box.innerHTML = `
    <div class="card">
      <div class="card-title">② 数据体检 <span class="muted" style="margin-left:auto;font-weight:400">${esc(S.catName)} · ${esc(S.site)} · ${esc(S.at)}</span></div>
      <div class="section-gap">${covRow}</div>
      <div class="muted" style="margin-top:4px">覆盖度决定结论能不能用: 评论/品牌低于 60% 时, 五维里的「竞争/增长」只能算参考。
        榜单页没面板的商品会缺品牌/重量 —— 想补全就勾上它们「加入商品库」后走「一键补采」。</div>
      ${(S.panel || S.cache) ? `<div class="muted" style="margin-top:6px">
        插件面板: 就绪 <b>${S.panel ? (S.panel.filled + '/' + S.panel.panels) : '?'}</b>${S.panel && S.panel.waitedMs ? ' (等待 ' + Math.round(S.panel.waitedMs / 1000) + 's)' : ''}
        · 面板缓存复用 <b>${S.cache ? (S.cache.usedForThisScan || 0) : 0}</b> 条 / 本次新存 <b>${S.cache ? (S.cache.rememberedNow || 0) : 0}</b> 条 (缓存共 ${S.cache ? (S.cache.totalAsins || 0) : 0} 个 ASIN)
        —— 同一个品扫过第二次就不用再等面板</div>` : ''}
    </div>

    <div class="card">
      <div class="card-title">③ 类目五维 <span class="muted" style="margin-left:auto;font-weight:400">市场20 增长25 竞争20 壁垒20 利润15 · 缺项按已得满分折成百分制</span></div>
      <table class="table"><thead><tr>
        <th>类目</th><th class="num">样本</th><th class="num">中位价</th><th class="num">评论中位</th>
        <th class="num" title="评论<200 的商品占比 —— 越高说明新品越能挤进榜">新品可挤</th>
        <th class="num" title="Amazon 自营占比 —— 越高越难抢">自营</th>
        <th class="num" title="Top3 品牌占样本比例 —— 越低越分散">Top3品牌</th>
        <th class="num">中位重量</th><th class="num">五维分</th><th>分项</th>
      </tr></thead><tbody>${grpRows || '<tr><td colspan="10" class="muted">样本不足 8 条, 不给结论</td></tr>'}</tbody></table>
      ${typeRows ? `<div class="muted" style="margin:10px 0 4px"><b>细分类</b> (插件「商品类型」, 样本≥8)</div>
        <table class="table"><thead><tr><th>细分类</th><th class="num">样本</th><th class="num">中位价</th>
        <th class="num">评论中位</th><th class="num">新品可挤</th><th class="num">Top3品牌</th><th class="num">五维分</th></tr></thead>
        <tbody>${typeRows}</tbody></table>` : ''}
    </div>

    <div class="card">
      <div class="card-title">④ 候选品
        <span style="margin-left:auto;display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-weight:400">
          <input id="selKw" class="input" style="width:150px" placeholder="过滤标题/品牌" value="${esc(S.kw)}">
          <select id="selSort" class="input" style="width:132px">
            <option value="pick" ${S.sort === 'pick' ? 'selected' : ''}>按候选分</option>
            <option value="reviews" ${S.sort === 'reviews' ? 'selected' : ''}>按评论数↑</option>
            <option value="price" ${S.sort === 'price' ? 'selected' : ''}>按价格↑</option>
            <option value="weight" ${S.sort === 'weight' ? 'selected' : ''}>按重量↑</option>
            <option value="rank" ${S.sort === 'rank' ? 'selected' : ''}>按榜单排名↑</option>
          </select>
          <button id="selIp" class="btn">🔎 商标查重 (选中)</button>
          <button id="selToProd" class="btn">＋ 加入商品库 (选中)</button>
          <a class="btn" href="/api/select/export?type=candidates" style="text-decoration:none">⬇ 候选CSV</a>
          <a class="btn" href="/api/select/export?type=all" style="text-decoration:none">⬇ 全部CSV</a>
        </span></div>
      <div id="selCandTable" class="section-gap"></div>
    </div>`;

  const refresh = () => { renderSelectionCandTable(); };
  $('#selKw').addEventListener('input', (e) => { S.kw = e.target.value.trim().toLowerCase(); refresh(); });
  $('#selSort').addEventListener('change', (e) => { S.sort = e.target.value; refresh(); });
  $('#selIp').addEventListener('click', async () => {
    let asins = [...S.sel];
    if (!asins.length) asins = (S.candidates || []).slice(0, 12).map((c) => c.asin);
    if (!asins.length) { showModal({ title: '没有可查的', body: '先勾选候选品 (不勾就查当前前 12 个)' }); return; }
    const btn = $('#selIp'); btn.disabled = true; btn.textContent = '查询中…';
    try {
      const r = await API('/api/select/ip-check', { method: 'POST', body: JSON.stringify({ asins, site: S.site }) });
      const map = {};
      for (const x of r.results || []) map[x.asin] = x;
      S.ip = { ...S.ip, ...map };
      const hi = (r.results || []).filter((x) => x.risk === 'high').length;
      refresh();
      showModal({ title: '商标查重完成', body: `查了 ${asins.length} 个品牌: <b class="bad">高风险 ${hi}</b> / 中 ${(r.results || []).filter((x) => x.risk === 'medium').length} / 低 ${(r.results || []).filter((x) => x.risk === 'low').length}` + ((r.results || []).some((x) => x.error) ? '<br><span class="muted">部分查不了: ' + (r.results || []).filter((x) => x.error).map((x) => x.asin.slice(-4) + ' ' + x.error).slice(0, 3).join('; ') + '</span>' : '') });
    } catch (e) { showModal({ title: '查重失败', body: String(e.message || e) }); }
    finally { btn.disabled = false; btn.textContent = '🔎 商标查重 (选中)'; }
  });
  $('#selToProd').addEventListener('click', async () => {
    const asins = [...S.sel];
    if (!asins.length) { showModal({ title: '没选品', body: '先在候选表里勾选要入库的商品' }); return; }
    try {
      const r = await API('/api/select/to-products', { method: 'POST', body: JSON.stringify({ asins }) });
      showModal({ title: '已入库', body: '新增 <b>' + r.added + '</b> 个 (商品库共 ' + r.total + ' 条)。<br><br>下一步: 去「商品管理」勾选这些品 → 「一键补采」补详情页(价格/月销/BSR/A+)。' });
      S.sel = new Set(); refresh();
    } catch (e) { showModal({ title: '入库失败', body: String(e.message || e) }); }
  });
  refresh();
}

function renderSelectionCandTable() {
  const S = SEL_STATE;
  let rows = (S.candidates || []).slice();
  if (S.kw) rows = rows.filter((c) => (String(c.title || '') + ' ' + String(c.brand || '')).toLowerCase().includes(S.kw));
  const sorters = {
    pick: (a, b) => b.pick - a.pick,
    reviews: (a, b) => (a.reviews || 0) - (b.reviews || 0),
    price: (a, b) => (a.price || 0) - (b.price || 0),
    weight: (a, b) => (a.weightG || 9e9) - (b.weightG || 9e9),
    rank: (a, b) => (a.rank || 9e9) - (b.rank || 9e9),
  };
  rows.sort(sorters[S.sort] || sorters.pick);
  const head = `<thead><tr><th style="width:26px"></th><th class="num">分</th><th>类目/细分类</th><th class="num">排名</th>
    <th class="num">价</th><th class="num">评分</th><th class="num">评论</th><th class="num">重量</th>
    <th>品牌</th><th>商标</th><th>命中卡片</th><th>标题</th></tr></thead>`;
  const ipBadge = (c) => {
    const r = S.ip[c.asin];
    if (!r) return '<span class="muted">-</span>';
    if (r.error) return `<span class="muted" title="${esc(r.error)}">?</span>`;
    if (r.risk === 'high') return `<span class="bad" title="命中 ${r.hits} 条, 其中有效 ${r.alive} 条">高${r.alive || ''}</span>`;
    if (r.risk === 'medium') return `<span class="warn" title="命中 ${r.hits} 条 (未见有效注册)">中</span>`;
    return '<span class="ok">低</span>';
  };
  if (!rows.length) {
    $('#selCandTable').innerHTML = `<table class="table">${head}<tbody><tr><td colspan="12" class="muted">没有候选。
      候选只留「评论<300 且上榜前60」或「评分≤4.2 且上榜前30」的品 —— 这个页面本身可能太成熟(老品盘踞), 换榜单或加页数再试。</td></tr></tbody></table>`;
    return;
  }
  const body = rows.map((c) => `<tr>
    <td><input type="checkbox" class="sel-ck" data-asin="${esc(c.asin)}" ${S.sel.has(c.asin) ? 'checked' : ''}></td>
    <td class="num"><b>${c.pick}</b></td>
    <td>${esc(c.catName || '')}${c.ptype ? '<br><span class="muted" style="font-size:11px">' + esc(c.ptype) + '</span>' : ''}</td>
    <td class="num">${c.rank ? '#' + c.rank : '-'}</td>
    <td class="num">${fmtMoney(c.price, 'GBP')}</td>
    <td class="num ${c.rating && c.rating <= 4.2 ? 'warn' : ''}">${c.rating == null ? '-' : c.rating}</td>
    <td class="num">${fmtNum(c.reviews)}</td>
    <td class="num">${c.weightG == null ? '-' : c.weightG + 'g'}</td>
    <td>${esc(c.brand || '-')}${c.amazonSeller ? ' <span class="bad">AMZ</span>' : ''}</td>
    <td>${ipBadge(c)}</td>
    <td style="font-size:11px">${(c.cards || []).map((x) => '<span class="tag">' + esc(x) + '</span>').join(' ')}</td>
    <td style="max-width:320px;font-size:11.5px">${esc(String(c.title || '').slice(0, 90))}
      <a href="https://www.amazon.${c.site === 'uk' ? 'co.uk' : (c.site || 'com')}/dp/${esc(c.asin)}" target="_blank" rel="noopener" style="margin-left:4px">↗</a></td>
  </tr>`).join('');
  $('#selCandTable').innerHTML = `<table class="table">${head}<tbody>${body}</tbody></table>
    <div class="muted" style="margin-top:6px">共 ${rows.length} 个候选 · 卡片含义:
      低竞争上榜=排名靠前但评论<300 / 热销低评分=卖得动但评分≤4.2 / 价带合适 / 轻小件≤500g / 无自营 / 冷启动=评论<10(已扣10分, 需人工核)</div>`;
  $$('.sel-ck').forEach((ck) => ck.addEventListener('change', (e) => {
    const a = e.target.dataset.asin;
    if (e.target.checked) SEL_STATE.sel.add(a); else SEL_STATE.sel.delete(a);
  }));
}

async function renderArchive() {
  const content = $('#content');
  const d = new Date(), p2 = (n) => String(n).padStart(2, '0');
  const dstr = d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
  content.innerHTML = `
    <div class="notice">📦 <b>选品归档</b> —— 把<b>最终选出来的品</b>(连同当时的承受价 / 利润率 / 排名 / 月销 / 变体)存成<b>快照</b>。
      <b>商品库(10万+)是"采过的池子", 上架记录是"这轮要上的清单", 归档库是"我们最终看中的品"</b> ——
      存下来的这份不受源数据增删影响, 以后照它找相似的品。可导出 CSV(Excel 直接打开) / JSON。</div>

    <div class="card">
      <div class="card-title">${ic ? ic('file', 15) + ' ' : ''}概览</div>
      <div id="arStats" class="section-gap"></div>
    </div>

    <div class="card">
      <div class="card-title">📊 分布
        <span style="margin-left:auto;display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          <select id="arStatSite" class="input" style="width:118px" title="按站点看分布 —— 价格与承受价都是【站点本币】, 混站点没有可比性">
            <option value="">全部站点</option>
            <option value="uk">英国 uk</option><option value="de">德国 de</option><option value="au">澳洲 au</option>
            <option value="us">美国 us</option><option value="fr">法国 fr</option><option value="it">意大利 it</option>
            <option value="es">西班牙 es</option><option value="ca">加拿大 ca</option>
          </select>
          <span class="muted" id="arStatInfo"></span>
        </span>
      </div>
      <div id="arDist" class="section-gap">加载中…</div>
    </div>

    <div class="card">
      <div class="card-title">🗄 归档当前商品</div>
      <div class="section-gap" style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
        <div class="filter-item"><label>批次名</label><input id="arName" class="input" style="width:240px" value="${esc(dstr)} 选品归档"></div>
        <div class="filter-item"><label>来源</label>
          <select id="arSource" class="input" style="width:230px">
            <option value="listing">上架记录 (最终要上的, 带承受价)</option>
            <option value="products">商品库 (全池子)</option>
          </select></div>
        <div class="filter-item"><label>站点</label>
          <select id="arSite" class="input" style="width:126px">
            <option value="">全部站点</option>
            <option value="uk">英国 uk</option><option value="de">德国 de</option><option value="au">澳洲 au</option>
            <option value="us">美国 us</option><option value="fr">法国 fr</option><option value="it">意大利 it</option>
            <option value="es">西班牙 es</option><option value="ca">加拿大 ca</option>
          </select></div>
        <div class="filter-item" id="arSavedWrap" style="display:none"><label>只要收藏的</label>
          <select id="arSaved" class="input" style="width:96px"><option value="">否</option><option value="1">是</option></select></div>
        <div class="filter-item" id="arLimitWrap" style="display:none"><label>最多条数</label>
          <input id="arLimit" class="input" type="number" style="width:104px" value="3000" min="1" max="20000"></div>
        <button id="arSave" class="btn">🗄 现在归档</button>
        <span id="arMsg" class="muted"></span>
      </div>
      <div class="muted" id="arHint" style="margin-top:6px"></div>
    </div>

    <div class="card">
      <div class="card-title">📚 归档批次</div>
      <div id="arBatches" class="section-gap"></div>
    </div>

    <div class="card">
      <div class="card-title">🔍 归档商品
        <span style="margin-left:auto;display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          <input id="arQ" class="input" placeholder="🔍 ASIN / 标题 / 品牌 / 类目" style="width:210px">
          <select id="arDedup" class="input" style="width:158px">
            <option value="1">去重 (按 ASIN@站点)</option>
            <option value="0">含重复 (全部批次)</option>
          </select>
          <button id="arCsv" class="btn small">⤓ 导出 CSV</button>
          <button id="arJson" class="btn small">⤓ 导出 JSON</button>
          <button id="arReload" class="btn small">刷新</button>
        </span>
      </div>
      <div class="section-gap" id="arFilters" style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
        <div class="filter-item"><label>店铺</label><select id="arShop" class="input" style="width:168px" title="按店铺筛归档 —— 多店铺隔离: 归档条目带店铺, 店铺之间不会互相覆盖(同 ASIN 在不同店铺是两条)"></select></div>
        <div class="filter-item"><label>类目</label><select id="arCat1" class="input" style="width:150px"><option value="">全部类目</option></select></div>
        <div class="filter-item"><label>利润 ≥</label><input id="arMarginMin" class="input" type="number" step="0.05" style="width:80px" placeholder="如 0.3"></div>
        <div class="filter-item"><label>月销 ≥</label><input id="arSalesMin" class="input" type="number" style="width:80px" placeholder="如 300"></div>
        <div class="filter-item"><label>大排名 ≤</label><input id="arRankMax" class="input" type="number" style="width:92px" placeholder="如 50000"></div>
        <div class="filter-item"><label>价格区间</label><span style="display:flex;gap:4px"><input id="arPriceMin" class="input" type="number" step="0.01" style="width:72px" placeholder="min"><input id="arPriceMax" class="input" type="number" step="0.01" style="width:72px" placeholder="max"></span></div>
        <div class="filter-item"><label>标签</label><select id="arTag" class="input" style="width:112px">
          <option value="">全部标签</option><option value="爆款">爆款</option><option value="试销">试销</option><option value="放弃">放弃</option><option value="季节品">季节品</option>
        </select></div>
        <button id="arApply" class="btn small">应用筛选</button>
        <button id="arResetFilter" class="btn small">重置</button>
        <span class="muted" id="arFilterInfo"></span>
      </div>
      <div id="arList" class="section-gap"></div>
      <div class="section-gap" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <span class="muted">自动归档:</span>
        <label style="display:inline-flex;gap:5px;align-items:center;cursor:pointer" title="每天到点自动把「当前上架记录」快照一批 —— 与上次完全一样时会跳过, 不产生空批次">
          <input type="checkbox" id="arAutoOn"> 每天自动存一次</label>
        <span class="muted">时间</span>
        <select id="arAutoHour" class="input" style="width:86px"></select>
        <button id="arAutoRun" class="btn small" title="不等定时, 现在就快照一批(内容没变会自动跳过)">立即归档一次</button>
        <span class="muted" id="arAutoInfo"></span>
      </div>
      <div id="arFilterInfo" class="section-gap muted"></div>
      <div class="section-gap muted" id="arSelInfo"></div>
    </div>`;

  let curBatch = '';               // 空=全部批次

  /** 查询串组装: 列表/统计/导出三处共用同一份筛选(口径必须一致, 否则"看到的"和"导出的"不一样) */
  const Q = (o) => Object.keys(o).filter((k) => o[k] !== '' && o[k] != null).map((k) => k + '=' + encodeURIComponent(String(o[k]))).join('&');
  const fv = (id) => { const el = $('#' + id); return el && String(el.value).trim() ? String(el.value).trim() : '' };
  const filterQs = () => Q({
    dedup: $('#arDedup').value, q: fv('arQ'), site: fv('arStatSite'), shop: fv('arShop'), cat1: fv('arCat1'), tag: fv('arTag'),
    marginMin: fv('arMarginMin'), salesMin: fv('arSalesMin'), rankMax: fv('arRankMax'),
    priceMin: fv('arPriceMin'), priceMax: fv('arPriceMax'), batchId: curBatch,
  });
  const filterText = () => {
    const parts = [];
    const add = (label, v) => { if (v) parts.push(label + '=' + v) };
    add('类目', fv('arCat1')); add('利润≥', fv('arMarginMin')); add('月销≥', fv('arSalesMin'));
    add('排名≤', fv('arRankMax'));
    if (fv('arPriceMin') || fv('arPriceMax')) parts.push('价格 ' + (fv('arPriceMin') || '0') + '~' + (fv('arPriceMax') || '∞'));
    add('标签', fv('arTag')); add('站点', String(fv('arStatSite')).toUpperCase()); add('搜索', fv('arQ'));
    /* ★ 店铺筛选的文案要说人话: * = 全部, none = 未分类, 其余就是店铺名 */
    const sh = fv('arShop');
    if (sh) add('店铺', sh === '*' ? '全部店铺' : (sh === 'none' ? '未分类' : sh));
    return parts.length ? '当前筛选: ' + parts.join(' · ') : '未加筛选';
  };

  const dl = (name, text, mime) => {
    const blob = new Blob(['\ufeff' + text], { type: mime || 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
  };
  const pct = (it) => it.marginPct != null ? (it.marginPct * 100).toFixed(1) + '%'
    : (it.bearMargin != null ? '<span class="muted">设定 ' + (it.bearMargin * 100).toFixed(0) + '%</span>' : '<span class="muted">—</span>');

  const loadHead = async () => {
    /* ★ 2026-10-07 多店铺隔离(网页端补齐): 归档默认看【全部店铺】(归档是"库", 不是"这轮要上的清单"),
     *   但必须能按店铺看/筛 —— 选项来自后端 byShop(全局统计), 并保住用户已选的值。 */
    const r = await API('/api/archive/list');
    const s = r.stats || {};
    const byShop = r.byShop || {};
    const shopEl = $('#arShop');
    if (shopEl) {
      const keep = shopEl.value;
      const names = Object.keys(byShop).filter((x) => x !== '未分类').sort();
      const un = byShop['未分类'] || 0;
      const sig = names.join(',') + '|' + un;
      if (shopEl.dataset.sig !== sig) {
        shopEl.dataset.sig = sig;
        shopEl.innerHTML = '<option value="*">全部店铺</option>' +
          names.map((x) => '<option value="' + esc(x) + '">🏪 ' + esc(x) + '（' + esc(byShop[x] || 0) + '）</option>').join('') +
          (un ? '<option value="none">未分类（' + esc(un) + '）</option>' : '');
        if (keep && (keep === 'none' || keep === '*' || names.indexOf(keep) >= 0)) shopEl.value = keep;
      }
    }
    const shopLine = Object.keys(byShop).length
      ? '<div class="muted" style="margin-top:8px">店铺分布: ' + Object.keys(byShop).sort((a, b) => byShop[b] - byShop[a])
        .map((x) => '<b>' + esc(x) + '</b> ' + esc(byShop[x]) + ' 条').join(' · ') + '</div>'
      : '';
    $('#arStats').innerHTML = '<div style="display:flex;gap:12px;flex-wrap:wrap">' +
      [['批次数', s.batches || 0], ['归档条目', s.items || 0], ['去重后唯一品', s.unique || 0],
       ['最近归档', s.lastArchivedAt ? String(s.lastArchivedAt).slice(5, 16) : '—'],
       ['站点', Object.keys(s.bySite || {}).join('/') || '—']]
        .map((kv) => '<div class="filter-item" style="min-width:118px"><label>' + kv[0] + '</label>' +
          '<div style="font-size:19px;font-weight:700">' + esc(kv[1]) + '</div></div>').join('') + '</div>' + shopLine;

    const bs = r.batches || [];
    $('#arBatches').innerHTML = bs.length
      ? '<div style="overflow:auto;max-height:320px"><table style="min-width:940px"><thead><tr>' +
        '<th>归档时间</th><th>批次名</th><th>来源</th><th>条数</th><th>其中重复</th><th>站点</th><th>操作</th></tr></thead><tbody>' +
        bs.map((b) => '<tr><td style="white-space:nowrap">' + esc(String(b.createdAt || '').slice(0, 16)) + '</td>' +
          '<td>' + esc(b.name) + '</td>' +
          '<td>' + esc(b.source === 'products' ? '商品库' : '上架记录') + '</td>' +
          '<td><b>' + esc(b.count) + '</b></td>' +
          '<td>' + (b.dupCount ? esc(b.dupCount) : '<span class="muted">0</span>') + '</td>' +
          '<td>' + esc(Object.keys(b.bySite || {}).join('/')) + '</td>' +
          '<td style="white-space:nowrap">' +
            '<button class="btn small ar-view" data-id="' + esc(b.batchId) + '">只看这批</button> ' +
            '<button class="btn small ar-exp" data-id="' + esc(b.batchId) + '" data-name="' + esc(b.name) + '">导这批</button> ' +
            '<button class="btn small ar-del" data-id="' + esc(b.batchId) + '">删</button>' +
          '</td></tr>').join('') + '</tbody></table></div>'
      : '<div class="empty">还没有归档 —— 上面点「🗄 现在归档」把当前选出来的品存一份</div>';

    $$('.ar-view').forEach((btn) => btn.addEventListener('click', () => {
      curBatch = curBatch === btn.dataset.id ? '' : btn.dataset.id;
      $('#arSelInfo').textContent = curBatch ? '只看批次 ' + curBatch : '';
      loadItems();
    }));
    $$('.ar-exp').forEach((btn) => btn.addEventListener('click', async () => {
      const rr = await API('/api/archive/export?format=csv&dedup=0&batchId=' + encodeURIComponent(btn.dataset.id));
      dl((btn.dataset.name || '选品归档').replace(/[\\/:*?"<>|]/g, '_') + '.csv', rr.csv || '', 'text/csv;charset=utf-8');
    }));
    $$('.ar-del').forEach((btn) => btn.addEventListener('click', async () => {
      if (!confirm('删除这个归档批次? (只删归档, 不动商品库和上架记录)')) return;
      await API('/api/archive/batch/delete', { method: 'POST', body: JSON.stringify({ batchId: btn.dataset.id }) });
      if (curBatch === btn.dataset.id) curBatch = '';
      loadHead(); loadItems(); loadStats();
    }));
  };

  /* ===== ★ 分布可视化 (2026-09-27) =====
   * 数据来自 /api/archive/stats(与列表用同一套筛选口径), 图用纯 CSS 条形 + 一个 SVG 散点,
   * 不引三方图表库(离线可用, 也不给这个页面再加依赖)。
   * 用途: 一眼看出「哪类品最多 / 哪个价格带利润高 / 哪些品又高销又高利」。 */
  const barsHtml = (title, pairs, opts) => {
    const arr = (pairs || []).filter((p) => p && p[0]);
    if (!arr.length) return '';
    const max = Math.max.apply(null, arr.map((p) => Number(p[1]) || 0)) || 1;
    const o = opts || {};
    return '<div style="min-width:240px;flex:1 1 280px">' +
      '<div class="muted" style="margin-bottom:4px">' + esc(title) + '</div>' +
      arr.slice(0, o.top || 8).map((p) => {
        const n = Number(p[1]) || 0, w = Math.max(2, Math.round(n / max * 100));
        return '<div style="display:flex;align-items:center;gap:6px;margin-bottom:2px">' +
          '<span style="width:' + (o.labelW || 96) + 'px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(p[0]) + '">' + esc(String(p[0])) + '</span>' +
          '<span style="flex:1;background:rgba(255,255,255,.07);border-radius:3px;height:13px"><span style="display:block;width:' + w + '%;height:13px;border-radius:3px;background:' + (o.color || '#4f8cff') + '"></span></span>' +
          '<span style="width:38px;text-align:right" class="muted">' + n + '</span></div>';
      }).join('') + '</div>';
  };
  const bucketPairs = (obj) => Object.keys(obj || {}).filter((k) => obj[k] > 0).map((k) => [k, obj[k]]);
  /** 四象限散点: 横=月销(log)、纵=利润率; 颜色按利润率(绿≥目标/琥珀/红亏); 点大小=变体数 */
  const scatterSvg = (pts, targetMargin) => {
    if (!pts || !pts.length) return '<div class="muted">没有同时带「月销 + 利润率」的商品, 画不了散点(先去归档带上这两项的数据)</div>';
    const W = 620, H = 260, L = 46, B = 28, T = 12, R = 12;
    const xs = pts.map((p) => Number(p.sales30d) || 0);
    const ys = pts.map((p) => Number(p.marginPct) || 0);
    const xMax = Math.max.apply(null, xs) || 1, xMin = 0;
    const yMax = Math.max(0.5, Math.max.apply(null, ys.map((y) => y + 0.05))), yMin = Math.min(0, Math.min.apply(null, ys) - 0.05);
    const lx = (v) => L + (Math.log10(1 + Math.max(0, v - xMin)) / Math.log10(1 + Math.max(1, xMax - xMin))) * (W - L - R);
    const ly = (v) => T + (1 - (v - yMin) / (yMax - yMin || 1)) * (H - T - B);
    const medSales = xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)] || 0;
    const col = (m) => (m >= (targetMargin || 0.3) ? '#5fd08a' : (m >= 0 ? '#f0b253' : '#f28b8b'));
    const gridY = [yMin, 0, (yMin + yMax) / 2, yMax].filter((v) => v >= yMin - 1e-9 && v <= yMax + 1e-9);
    const tgtY = (targetMargin != null && targetMargin > yMin && targetMargin < yMax) ? ly(targetMargin) : null;
    return '<div style="overflow-x:auto"><svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;max-width:760px;height:260px">' +
      gridY.map((v) => '<line x1="' + L + '" y1="' + ly(v).toFixed(1) + '" x2="' + (W - R) + '" y2="' + ly(v).toFixed(1) + '" stroke="rgba(255,255,255,.10)"/>' +
        '<text x="4" y="' + (ly(v) + 4).toFixed(1) + '" fill="#8b93a3" font-size="10">' + Math.round(v * 100) + '%</text>').join('') +
      (tgtY != null ? '<line x1="' + L + '" y1="' + tgtY.toFixed(1) + '" x2="' + (W - R) + '" y2="' + tgtY.toFixed(1) + '" stroke="rgba(95,208,138,.5)" stroke-dasharray="4 3"/>' +
        '<text x="' + (W - R - 92) + '" y="' + (tgtY - 4).toFixed(1) + '" fill="#5fd08a" font-size="10">目标利润率 ' + Math.round(targetMargin * 100) + '%</text>' : '') +
      '<line x1="' + lx(medSales).toFixed(1) + '" y1="' + T + '" x2="' + lx(medSales).toFixed(1) + '" y2="' + (H - B) + '" stroke="rgba(255,255,255,.10)" stroke-dasharray="3 3"/>' +
      pts.map((p) => {
        const cx = lx(Number(p.sales30d) || 0), cy = ly(Number(p.marginPct) || 0);
        const rr = 2.6 + Math.min(5, (Number(p.variantCount) || 0) / 2);
        return '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="' + rr.toFixed(1) + '" fill="' + col(Number(p.marginPct) || 0) + '" fill-opacity=".75" stroke="rgba(0,0,0,.35)">' +
          '<title>' + esc(p.asin + '@' + String(p.site || '').toUpperCase() + ' · 月销 ' + (p.sales30d || 0) + ' · 利润率 ' + Math.round((p.marginPct || 0) * 100) + '%' +
            (p.bearPrice != null ? ' · 承受价 ' + p.bearPrice + ' ' + (p.currency || '') : '') + ' · 变体 ' + (p.variantCount || 0) +
            (p.cat1 ? ' · ' + p.cat1 : '') + (p.brand ? ' · ' + p.brand : '')) + '</title></circle>';
      }).join('') +
      '<text x="' + ((L + W - R) / 2) + '" y="' + (H - 6) + '" fill="#8b93a3" font-size="10" text-anchor="middle">月销 (对数轴) → 越靠右越好卖</text>' +
      '<text x="4" y="' + (T + 8) + '" fill="#8b93a3" font-size="10">利润率 ↑</text>' +
      '<text x="' + (lx(medSales) + 4).toFixed(1) + '" y="' + (T + 10) + '" fill="#6f7684" font-size="9">中位月销</text>' +
    '</svg></div>' +
    '<div class="muted" style="margin-top:4px">绿=达标利润率 · 琥珀=有利润但低于目标 · 红=亏 · 点越大变体越多（悬停看 ASIN）</div>';
  };
  const loadStats = async () => {
    let r;
    try {
      r = await API('/api/archive/stats?' + filterQs());
    } catch (e) { $('#arDist').innerHTML = '<div class="muted">✗ ' + esc(e.message) + '</div>'; return }
    /* ★ 类目下拉用分布里的真实类目填充(而不是写死几个), 并保住当前选择 */
    const sel = $('#arCat1');
    if (sel) {
      const cur = sel.value;
      const cats = (r.byCategory1 || []).map((p) => p[0]).filter(Boolean);
      const have = $$('#arCat1 option').map((o) => o.value).filter(Boolean);
      if (cats.join('|') !== have.join('|')) {
        sel.innerHTML = '<option value="">全部类目</option>' + cats.map((c) => '<option value="' + esc(c) + '">' + esc(c) + '</option>').join('');
        if (cats.indexOf(cur) >= 0) sel.value = cur;
      }
    }
    const num = (v) => (v == null ? '—' : v);
    const catRows = (r.byCategoryDetail || []).map((c) => '<tr><td>' + esc(c.cat) + '</td><td>' + esc(c.n) + '</td>' +
      '<td>' + (c.marginAvg != null ? (Math.round(c.marginAvg * 1000) / 10) + '%' : '—') + '</td>' +
      '<td>' + num(c.salesAvg) + '</td><td>' + num(c.bearAvg) + '</td></tr>').join('');
    $('#arDist').innerHTML =
      '<div style="display:flex;gap:16px;flex-wrap:wrap">' +
        barsHtml('一级类目 (哪个类最多)', r.byCategory1, { color: '#4f8cff' }) +
        barsHtml('品牌 Top', r.byBrand, { color: '#8a6dff' }) +
        barsHtml('站点', r.bySite, { color: '#5fd08a', labelW: 70 }) +
        barsHtml('配送方式', r.byFulfill, { color: '#e0b25c', labelW: 70 }) +
      '</div>' +
      '<div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:10px">' +
        barsHtml('售价带 (站点本币)', bucketPairs(r.priceBuckets), { color: '#4f8cff', labelW: 70 }) +
        barsHtml('利润率', bucketPairs(r.marginBuckets), { color: '#5fd08a', labelW: 70 }) +
        barsHtml('月销', bucketPairs(r.salesBuckets), { color: '#e0b25c', labelW: 70 }) +
        barsHtml('大排名', bucketPairs(r.rankBuckets), { color: '#f28b8b', labelW: 70 }) +
        barsHtml('变体数', bucketPairs(r.variantBuckets), { color: '#8ab4ff', labelW: 70 }) +
      '</div>' +
      '<div style="margin-top:14px"><div class="muted" style="margin-bottom:4px">月销 × 利润率（找又高销又高利的品）</div>' + scatterSvg(r.scatter, 0.3) + '</div>' +
      (catRows ? '<div style="margin-top:12px"><div class="muted" style="margin-bottom:4px">类目明细：一眼看哪类「又赚又好卖」</div>' +
        '<div style="overflow:auto;max-height:260px"><table style="min-width:520px"><thead><tr>' +
        '<th>一级类目</th><th>数量</th><th>平均利润率</th><th>平均月销</th><th>平均承受价</th></tr></thead><tbody>' + catRows + '</tbody></table></div></div>' : '') +
      ((r.batchSeries || []).length ? '<div style="margin-top:12px"><div class="muted" style="margin-bottom:4px">批次趋势（每批存了多少 / 其中重复）</div>' +
        barsHtml('', r.batchSeries.map((b) => [String(b.createdAt || '').slice(5, 16) + ' ' + String(b.name).slice(0, 14), b.count]), { color: '#4f8cff', labelW: 150, top: 12 }) + '</div>' : '');
    $('#arStatInfo').textContent = '命中 ' + r.total + ' 条' + (r.query && r.query.dedup ? ' (去重后)' : '') +
      ' · 数据源与左侧列表同一筛选口径';
  };

  const loadItems = async () => {
    const r = await API('/api/archive/items?limit=300&' + filterQs());
    const items = r.items || [];
    $('#arSelInfo').textContent = '命中 ' + r.total + ' 条' + (r.total > items.length ? ' (只显示前 ' + items.length + ' 条, 导出是全部)' : '') +
      (curBatch ? ' · 只看批次 ' + curBatch : '') + (curBatch ? ' —— 再点一次「只看这批」可取消' : '');
    if (!items.length) { $('#arList').innerHTML = '<div class="empty">没有匹配的归档商品</div>'; return; }
    $('#arList').innerHTML = '<div style="overflow:auto;max-height:560px"><table style="min-width:1520px"><thead><tr>' +
      '<th>店铺</th><th>站点</th><th>ASIN</th><th>品牌</th><th>标题</th><th>售价</th><th>承受价</th><th>利润率</th>' +
      '<th>月销</th><th>大排名</th><th>变体</th><th>标签</th><th>状态</th><th>归档时间</th><th>链接</th></tr></thead><tbody>' +
      items.map((it) => '<tr>' +
        /* ★ 店铺列(多店铺隔离): 归档条目带 shop; 商品库来源/老数据没有归属 → 「未分类」(不编造) */
        '<td style="white-space:nowrap">' + (it.shop ? esc(it.shop) : '<span class="muted">未分类</span>') + '</td>' +
        '<td>' + esc(String(it.site || '').toUpperCase()) + '</td>' +
        '<td><b>' + esc(it.asin) + '</b>' + (it.dup ? ' <span class="badge medium" title="以前也归档过' + esc(it.firstArchivedAt || '') + '">重</span>' : '') + '</td>' +
        '<td>' + esc(it.brand || '') + '</td>' +
        '<td style="max-width:280px">' + esc(String(it.title || '').slice(0, 62)) + '</td>' +
        '<td>' + (it.price != null ? esc(fmtMoney(it.price, it.currency)) : '') + '</td>' +
        '<td>' + (it.bearPrice != null ? '<b>' + esc(fmtMoney(it.bearPrice, it.currency)) + '</b>' : '<span class="muted">—</span>') + '</td>' +
        '<td>' + pct(it) + '</td>' +
        '<td>' + (it.sales30d != null ? esc(it.sales30d) : '') + '</td>' +
        '<td>' + (it.bsrShop != null ? '#' + esc(it.bsrShop) : '') + '</td>' +
        '<td>' + (it.variantCount ? esc(it.variantCount) + ((it.variantDims || []).length ? ' <span class="muted">' + esc(it.variantDims.join('×')) + '</span>' : '') : '—') + '</td>' +
        /* ★ 2026-09-27 行内标签: 4 个可点的小胶囊, 点一下即打上/取消(不用弹窗, 直接用)。
         *   标签按 asin@site 存在服务端, 重新归档不会丢。 */
        '<td style="white-space:nowrap">' + ['爆款', '试销', '放弃', '季节品'].map((tg) => {
          const on = (it.tags || []).indexOf(tg) >= 0;
          return '<span class="ar-tag" data-key="' + esc(it.key || (it.asin + '@' + it.site)) + '" data-tag="' + esc(tg) + '" data-on="' + (on ? '1' : '0') + '" ' +
            'title="' + (on ? '点一下取消「' + tg + '」' : '点一下标记为「' + tg + '」') + '" ' +
            'style="cursor:pointer;font-size:11px;padding:0 5px;border-radius:9px;margin-right:3px;border:1px solid ' + (on ? '#4f8cff' : 'rgba(255,255,255,.18)') +
            ';background:' + (on ? 'rgba(79,140,255,.22)' : 'transparent') + ';color:' + (on ? '#cfe0ff' : '#8b93a3') + '">' + esc(tg) + '</span>';
        }).join('') + '</td>' +
        '<td>' + esc(it.status === 'listed' ? '已上架' : it.status === 'saved' ? '收藏' : it.status === 'pool' ? '池子' : it.status === 'failed' ? '失败' : '待上架') + '</td>' +
        '<td style="white-space:nowrap">' + esc(String(it.archivedAt || '').slice(5, 16)) + '</td>' +
        '<td>' + (it.url ? '<a href="' + esc(it.url) + '" target="_blank" rel="noopener">打开</a>' : '') + '</td>' +
        '</tr>').join('') + '</tbody></table></div>';
    /* 行内标签: 点胶囊即打上/取消(直接落库, 然后刷新列表与分布) */
    $$('#arList .ar-tag').forEach((el) => el.addEventListener('click', async () => {
      const key = el.dataset.key, tg = el.dataset.tag, on = el.dataset.on !== '1';
      el.style.opacity = '.45';
      try {
        await API('/api/archive/tag', { method: 'POST', body: JSON.stringify({ keys: [key], tag: tg, on: on }) });
        $('#arFilterInfo').textContent = '✓ ' + (on ? '已标记' : '已取消') + '「' + tg + '」 ' + key;
        loadItems(); loadStats();
      } catch (e) { el.style.opacity = ''; $('#arFilterInfo').textContent = '✗ ' + e.message }
    }));
    $('#arFilterInfo').textContent = filterText();
  };

  $('#arSource').addEventListener('change', () => {
    const isP = $('#arSource').value === 'products';
    $('#arSavedWrap').style.display = isP ? '' : 'none';
    $('#arLimitWrap').style.display = isP ? '' : 'none';
    $('#arHint').textContent = isP
      ? '⚠ 商品库有 10 万+ 条 —— 直接归档会很大(也慢)。建议先用「站点」收窄, 或勾「只要收藏的」(你手工收藏过的那些), 最多条数默认 3000。'
      : '上架记录里的品都带承受价/利润率 —— 这是"最终选出来的品"最完整的形态, 建议默认用它。';
  });
  $('#arSource').dispatchEvent(new Event('change'));

  $('#arSave').addEventListener('click', async () => {
    const source = $('#arSource').value;
    $('#arMsg').textContent = '⏳ 正在归档…';
    try {
      const r = await API('/api/archive/save', { method: 'POST', body: JSON.stringify({
        source, name: $('#arName').value.trim(), site: $('#arSite').value,
        onlySaved: $('#arSaved').value === '1',
        limit: parseInt($('#arLimit').value, 10) || undefined,
      }) });
      if (!r.ok) { $('#arMsg').textContent = '✗ ' + (r.error || '归档失败'); return; }
      $('#arMsg').innerHTML = '✓ 已归档 <b>' + r.count + '</b> 个品到「' + esc(r.name) + '」' +
        (r.dupCount ? ' · 其中 ' + r.dupCount + ' 个以前归档过' : '') +
        (r.overflow ? ' · 另有 ' + r.overflow + ' 个超出上限未存' : '');
      loadHead(); loadItems(); loadStats();
    } catch (e) { $('#arMsg').textContent = '✗ ' + e.message; }
  });

  $('#arCsv').addEventListener('click', async () => {
    const r = await API('/api/archive/export?format=csv&' + filterQs());
    if (!r.total) { alert('归档库还是空的, 先归档再导出'); return; }
    dl('选品归档-' + dstr + '.csv', r.csv || '', 'text/csv;charset=utf-8');
    $('#arSelInfo').textContent = '✓ 已导出 ' + r.total + ' 条到 选品归档-' + dstr + '.csv';
  });
  $('#arJson').addEventListener('click', async () => {
    const r = await API('/api/archive/export?format=json&' + filterQs());
    if (!r.total) { alert('归档库还是空的, 先归档再导出'); return; }
    dl('选品归档-' + dstr + '.json', JSON.stringify({ exportedAt: new Date().toISOString(), total: r.total, items: r.items }, null, 2), 'application/json');
    $('#arSelInfo').textContent = '✓ 已导出 ' + r.total + ' 条到 选品归档-' + dstr + '.json';
  });
  $('#arQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') { loadItems(); loadStats(); } });
  $('#arDedup').addEventListener('change', () => { loadItems(); loadStats(); });
  $('#arStatSite').addEventListener('change', () => { loadItems(); loadStats(); });
  /* ★ 筛选条: 应用/重置 + 下拉即时生效(数字框回车或点「应用筛选」) */
  const applyFilters = () => { loadItems(); loadStats(); };
  $('#arApply').addEventListener('click', applyFilters);
  ['arCat1', 'arTag', 'arMarginMin', 'arSalesMin', 'arRankMax', 'arPriceMin', 'arPriceMax', 'arShop'].forEach((id) => {
    const el = $('#' + id);
    if (el) el.addEventListener('change', applyFilters);
    if (el) el.addEventListener('keydown', (e) => { if (e.key === 'Enter') applyFilters(); });
  });
  $('#arResetFilter').addEventListener('click', () => {
    ['arCat1', 'arTag', 'arMarginMin', 'arSalesMin', 'arRankMax', 'arPriceMin', 'arPriceMax', 'arStatSite'].forEach((id) => { const el = $('#' + id); if (el) el.value = ''; });
    const sh = $('#arShop'); if (sh) sh.value = '*';      // 店铺回到"全部店铺"(归档是库, 默认看全)
    const q = $('#arQ'); if (q) q.value = '';
    applyFilters();
  });
  $('#arReload').addEventListener('click', () => { loadHead(); loadItems(); loadStats(); });

  await loadHead();
  /* ===== ★ 自动归档(③) 的界面部分 ===== */
  const loadAuto = async () => {
    const hourSel = $('#arAutoHour');
    if (hourSel && !hourSel.options.length) {
      hourSel.innerHTML = Array.from({ length: 24 }, (_, i) => '<option value="' + i + '">' + (i < 10 ? '0' + i : i) + ':00</option>').join('');
    }
    if (!$('#arAutoOn')) return;
    let r;
    try { r = await API('/api/archive/auto'); } catch (e) { $('#arAutoInfo').textContent = '✗ ' + e.message; return }
    const a = (r && r.auto) || {};
    $('#arAutoOn').checked = a.enabled === true;
    if (hourSel) hourSel.value = String(a.hour != null ? a.hour : 3);
    $('#arAutoInfo').textContent = a.lastRunAt ? ('上次运行 ' + String(a.lastRunAt).slice(5, 16)) : '还没跑过';
  };
  const saveAuto = async (patch) => {
    try {
      await API('/api/archive/auto', { method: 'POST', body: JSON.stringify(patch) });
      await loadAuto();
    } catch (e) { $('#arAutoInfo').textContent = '✗ ' + e.message }
  };
  if ($('#arAutoOn')) $('#arAutoOn').addEventListener('change', () => saveAuto({ enabled: $('#arAutoOn').checked }));
  if ($('#arAutoHour')) $('#arAutoHour').addEventListener('change', () => saveAuto({ hour: parseInt($('#arAutoHour').value, 10) }));
  if ($('#arAutoRun')) $('#arAutoRun').addEventListener('click', async () => {
    $('#arAutoInfo').textContent = '⏳ 正在归档…';
    try {
      const r = await API('/api/archive/auto/run', { method: 'POST', body: JSON.stringify({}) });
      $('#arAutoInfo').textContent = r.created
        ? ('✓ 已存「' + r.name + '」 ' + r.count + ' 条' + (r.dupCount ? ' (其中重复 ' + r.dupCount + ')' : ''))
        : ('[--] ' + (r.reason || '没有新东西要存'));
      await loadHead(); await loadItems(); await loadStats();
    } catch (e) { $('#arAutoInfo').textContent = '✗ ' + e.message }
  });

  await loadHead();
  await loadItems();
  await loadStats();
  await loadAuto();
}


/* ===== 通知 ===== */
async function renderNotify() {
  const content = $('#content');
  content.innerHTML = `
    <div class="notice">💬 <b>飞书/企微集成:</b> 异常通知(调价失败/采集失败/订单拦截/品牌投诉) · 日报推送 · 远程指令(如「查库存」「暂停调价任务」) · 远程审批。指令鉴权, 操作留痕。</div>
    <div class="card">
      <div class="card-title"> 通知中心 <button id="nRefresh" class="btn small" style="margin-left:auto">刷新</button></div>
      <div id="nList" class="section-gap"></div>
    </div>
  `;
  const load = async () => {
    const data = await API('/api/notify');
    $('#nList').innerHTML = data.items.length ? data.items.map((n) => `
      <div class="notify-item ${n.read ? '' : 'unread'}">
        <div class="notify-emoji">${n.type.includes('合规') ? '🛡️' : n.type.includes('调价') ? '🏷️' : n.type.includes('认领') ? '📦' : n.type.includes('刊登') ? '🚀' : '🔔'}</div>
        <div style="flex:1">
          <div class="notify-title">${esc(n.title)} <span class="channel-pill">${esc(n.channel === 'feishu' ? '飞书' : '企微')}</span> ${n.read ? '' : '<span class="badge danger">未读</span>'}</div>
          <div class="notify-body">${esc(n.body)}</div>
          <div class="notify-meta">${esc(n.at)} · ${esc(n.id)} <button class="btn small" data-id="${esc(n.id)}">标记已读</button></div>
        </div>
      </div>`).join('') : '<div class="empty">暂无通知</div>';
    $$('#nList [data-id]').forEach((b) => b.addEventListener('click', async () => { await API('/api/notify/read', { method: 'POST', body: JSON.stringify({ id: b.dataset.id }) }); load(); }));
  };
  await load();
  $('#nRefresh').addEventListener('click', load);
}

/* ===== 物流工具: 报价表试算 (本地费率) + 报价表管理 ===== */
// (2026-09-20: 原「云途官网 CDP 免费试算」+「云途开放平台配置」已删除 ——
//  后续实时物流价格改从智赢客户端「国际运费预估」的 UI 读取)
async function renderLogistics() {
  const content = $('#content');
  const rates = await API('/api/logistics/rates').catch(() => ({}));
  const stale = rates.updatedAt ? ((Date.now() - new Date(String(rates.updatedAt).replace(' ', 'T')).getTime()) > 86400000) : true;
  content.innerHTML = `
    <div class="notice">📦 <b>物流工具:</b> 报价表 (本地维护首重/续重, 「一键计算」优先用它算物流成本) · 报价表试算。</div>
    <div class="card">
      <div class="card-title">${ic('logistics', 16)} 报价表试算 <button id="lgQuote" class="btn primary" style="margin-left:auto">开始试算</button></div>
      <div class="filter-grid" style="margin-top:8px">
        <div class="filter-item"><label>目的国 (ISO2 代码)</label><input id="lgCountry" class="input" value="GB" placeholder="如 GB / DE / US / FR"></div>
        <div class="filter-item"><label>重量 (kg)</label><input id="lgWeight" class="input" type="number" step="0.1" value="1" placeholder="如 0.5 / 1 / 2"></div>
      </div>
      <div id="lgResult" style="margin-top:12px"></div>
    </div>
    <div class="card" style="margin-top:12px">
      <div class="card-title">${ic('save', 14)} 报价表 (一键计算用) <span class="muted" style="font-weight:400;font-size:12px">${stale ? '<span class="badge danger">超过24小时未更新</span>' : '<span class="badge low">更新于 ' + esc(rates.updatedAt || '-') + '</span>'}</span>
        <button id="lgRateAdd" class="btn small" style="margin-left:auto">新增渠道</button>
        <button id="lgRateRefresh" class="btn small" title="标记已更新 (录入/核对完价格后点)">已更新</button>
      </div>
      <div class="muted" style="font-size:11px;margin:4px 0">共 ${rates.countryCount || 0} 个国家有报价 · 请根据物流商最新价目表每日核对更新 · 更新后点「已更新」</div>
      <div id="lgRateList" style="margin-top:6px"></div>
      <div id="lgRateForm" style="display:none;margin-top:8px;border:1px dashed var(--line);border-radius:8px;padding:10px">
        <div class="filter-grid" style="grid-template-columns:repeat(auto-fill,minmax(140px,1fr))">
          <div class="filter-item"><label>国家 (ISO2)</label><input id="lrCountry" class="input" value="GB" placeholder="GB"></div>
          <div class="filter-item"><label>渠道名称</label><input id="lrChannel" class="input" placeholder="如 全球专线挂号"></div>
          <div class="filter-item"><label>类型</label><input id="lrType" class="input" placeholder="专线/快速"></div>
          <div class="filter-item"><label>首重 (kg)</label><input id="lrFirstW" class="input" type="number" step="0.1" value="0.5"></div>
          <div class="filter-item"><label>首重价 (¥)</label><input id="lrFirstP" class="input" type="number" step="0.1" value="50"></div>
          <div class="filter-item"><label>续重 (kg)</label><input id="lrContW" class="input" type="number" step="0.1" value="0.5"></div>
          <div class="filter-item"><label>续重价 (¥)</label><input id="lrContP" class="input" type="number" step="0.1" value="15"></div>
          <div class="filter-item"><label>时效</label><input id="lrEta" class="input" placeholder="5-8天"></div>
        </div>
        <div class="toolbar" style="margin-top:6px"><button id="lrSave" class="btn primary">保存渠道</button><button id="lrCancel" class="btn">取消</button><span class="muted" id="lrMsg"></span></div>
      </div>
    </div>
  `;
  // 开始试算 (本地报价表)
  $('#lgQuote').addEventListener('click', async () => {
    const btn = $('#lgQuote');
    const box = $('#lgResult');
    const cc = $('#lgCountry').value.trim().toUpperCase();
    const wkg = parseFloat($('#lgWeight').value) || 1;
    btn.textContent = '试算中…'; btn.disabled = true;
    box.innerHTML = '<div class="muted" style="padding:8px 0">正在按报价表计算…</div>';
    try {
      const r = await API('/api/logistics/rates?country=' + encodeURIComponent(cc) + '&weight=' + encodeURIComponent(wkg));
      const quotes = (r && r.quotes) || [];
      if (!quotes.length) {
        box.innerHTML = `<div class="notice warn">⚠️ 报价表里没有 ${esc(cc)} 的费率 —— 请在下方「报价表」里新增该国各渠道的首重/续重价格</div>`;
        return;
      }
      const rows = quotes.map((q) => `<tr>
        <td>${esc(q.channel)}</td><td>${esc(q.type)}</td><td>${esc(q.eta)}</td>
        <td>首重 ${esc(String(q.firstWeight))}kg ¥${esc(String(q.firstPrice))}</td>
        <td>续重 ${esc(String(q.contWeight))}kg ¥${esc(String(q.contPrice))}</td>
        <td><b>¥${q.total}</b></td>
      </tr>`).join('');
      box.innerHTML = `<div class="muted" style="margin-bottom:6px">目的国 ${esc(cc)} · ${esc(String(wkg))}kg · 共 <b>${quotes.length}</b> 个渠道 · 报价表更新于 ${esc(r.updatedAt || '未记录')}</div>
        <table class="ov-table" style="width:100%"><thead><tr><th>渠道</th><th>类型</th><th>时效</th><th>首重</th><th>续重</th><th>总费用</th></tr></thead><tbody>${rows}</tbody></table>
        <div class="muted" style="font-size:11px;margin-top:6px">价格为报价表录入值, 请定期核对; 需要实时价可在智赢客户端「国际运费预估」里查。</div>`;
    } catch (e) {
      box.innerHTML = `<div class="notice warn">❌ 试算失败: ${esc((e && e.message) || e)}</div>`;
    }
    btn.textContent = '开始试算'; btn.disabled = false;
  });
  // ===== 报价表管理 =====
  const renderRateList = () => {
    const box = $('#lgRateList');
    const countries = rates.countries || {};
    const entries = Object.entries(countries);
    if (!entries.length) { box.innerHTML = '<div class="muted" style="font-size:12px;padding:6px 0">暂无报价 — 点击「新增渠道」录入 (需国家+渠道+首重/续重价)</div>'; return; }
    box.innerHTML = entries.map(([cc, list]) => `
      <div style="margin-bottom:8px">
        <div class="muted" style="font-size:12px;font-weight:600;margin-bottom:2px">${esc(cc)} (${list.length} 渠道)</div>
        <table class="ov-table" style="width:100%"><tbody>
          ${list.map((c, i) => `<tr>
            <td>${esc(c.channel)}</td><td class="muted" style="font-size:11px">${esc(c.type || '')}</td>
            <td>首${c.firstWeight}kg/¥${c.firstPrice}</td><td>续${c.contWeight}kg/¥${c.contPrice}</td>
            <td class="muted">${esc(c.eta || '')}</td>
            <td style="text-align:right"><button class="btn small" data-del="${esc(cc)}" data-i="${i}" title="删除渠道">✕</button></td>
          </tr>`).join('')}
        </tbody></table>
      </div>`).join('');
    box.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      const cc = b.dataset.del, idx = parseInt(b.dataset.i, 10);
      const ch = rates.countries[cc][idx].channel;
      const r = await API('/api/logistics/rates', { method: 'POST', body: JSON.stringify({ country: cc, channel: ch, remove: true }) });
      if (r.ok) { (rates.countries[cc] || []).splice(idx, 1); renderRateList(); }
    }));
  };
  renderRateList();
  $('#lgRateAdd').addEventListener('click', () => { $('#lgRateForm').style.display = $('#lgRateForm').style.display === 'none' ? 'block' : 'none'; });
  $('#lrCancel').addEventListener('click', () => { $('#lgRateForm').style.display = 'none'; });
  $('#lrSave').addEventListener('click', async () => {
    const body = {
      country: $('#lrCountry').value.trim().toUpperCase(),
      channel: $('#lrChannel').value.trim(),
      type: $('#lrType').value.trim(),
      firstWeight: parseFloat($('#lrFirstW').value) || 0.5,
      firstPrice: parseFloat($('#lrFirstP').value) || 0,
      contWeight: parseFloat($('#lrContW').value) || 0.5,
      contPrice: parseFloat($('#lrContP').value) || 0,
      eta: $('#lrEta').value.trim(),
    };
    if (!body.country || !body.channel) { $('#lrMsg').textContent = '⚠ 国家+渠道必填'; return; }
    const r = await API('/api/logistics/rates', { method: 'POST', body: JSON.stringify(body) });
    $('#lrMsg').textContent = r.ok ? '✔ 已保存' : ('✗ ' + (r.error || '保存失败'));
    if (r.ok) { $('#lgRateForm').style.display = 'none'; $('#lrMsg').textContent = ''; location.reload(); }
  });
  $('#lgRateRefresh').addEventListener('click', async () => {
    // 标记已更新: 更新 updatedAt (发一个空保存刷新时间)
    const r = await API('/api/logistics/rates', { method: 'POST', body: JSON.stringify({ _touch: true }) }).catch(() => ({}));
    if (r && r.ok) { location.reload(); }
  });
}

/* ===== 初始化 ===== */
document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  // 注入线性 SVG 图标 (导航 + logo)
  $$('[data-icon]').forEach((n) => {
    const box = n.querySelector('.nav-emoji');
    if (box) box.innerHTML = ic(n.dataset.icon, 17);
  });
  const logoIcon = $('#logoIcon');
  if (logoIcon) logoIcon.innerHTML = ic('bolt', 24);
  $$('.nav-item').forEach((n) => n.addEventListener('click', () => navigate(n.dataset.page)));
  try {
    await API('/api/health');
    $('#healthBadge').textContent = '● 服务在线';
  } catch { $('#healthBadge').textContent = '● 服务离线'; }
  navigate('workbench');
});




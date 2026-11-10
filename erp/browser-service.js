/**
 * 智赢ERP · 本地浏览器服务(第四期)
 * ------------------------------------------------------------------
 * 为什么要有它: 采集链路本来就是 CDP 驱动的(openSession + Runtime.evaluate), 所以
 *   "把采集搬进本地无头浏览器" = 起一个带 --remote-debugging-port 的本地 Chromium,
 *   把采集侧端口从用户的采集浏览器(9222)切成它(9333)。采集代码一行不用重写。
 *
 * 设计要点:
 *   · 独立 user-data-dir(默认 %USERPROFILE%\.zying-erp\browser-profile) → 与日常/采集浏览器隔离
 *   · 两种窗口形态: headless(--headless=new) / offscreen(有头但窗口移到屏幕外, 风控更友好)
 *   · 只做"起/停/查", 不做自动化本身 —— 自动化仍由 server.js 的 CDP 代码干
 *   · 启动后落一个 state 文件, 便于重启后找回进程
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn, execFile } = require('child_process');

const DATA_DIR = process.env.ZYING_DATA || path.join(os.homedir(), '.zying-erp', 'data');
const STATE_FILE = path.join(DATA_DIR, 'browser-service.json');
const DEFAULT_PROFILE = path.join(os.homedir(), '.zying-erp', 'browser-profile');
const DEFAULT_PORT = Number(process.env.ZYING_HEADLESS_PORT || 9333);

const BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
];

function findBrowser() {
  for (const p of BROWSERS) { try { if (fs.existsSync(p)) return p } catch (e) {} }
  return null;
}
function readState() { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) } catch (e) { return null } }
function writeState(s) { try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 1), 'utf8') } catch (e) {} }
function clearState() { try { fs.unlinkSync(STATE_FILE) } catch (e) {} }

/** 问一下某个端口上的 CDP 在不在, 返回 version 信息 */
function probe(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: port, path: '/json/version', timeout: 1500 }, (res) => {
      let d = ''; res.on('data', (c) => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)) } catch (e) { resolve(null) } });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null) });
  });
}
/** 列出页面标签 */
function listPages(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: port || DEFAULT_PORT, path: '/json', timeout: 2500 }, (res) => {
      let d = ''; res.on('data', (c) => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)) } catch (e) { resolve([]) } });
    });
    req.on('error', () => resolve([]));
    req.on('timeout', () => { req.destroy(); resolve([]) });
  });
}

function argsFor(opts) {
  const mode = (opts.mode === 'offscreen' || opts.mode === 'visible') ? opts.mode : 'headless';
  const a = [
    '--remote-debugging-port=' + (opts.port || DEFAULT_PORT),
    '--user-data-dir=' + (opts.profile || DEFAULT_PROFILE),
    '--no-first-run', '--no-default-browser-check', '--disable-popup-blocking',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--window-size=' + (opts.width || 1440) + ',' + (opts.height || 900),
    '--lang=en-GB',
  ];
  if (mode === 'headless') a.push('--headless=new', '--disable-gpu', '--hide-scrollbars');
  else if (mode === 'offscreen') a.push('--window-position=-32000,-32000');   // 有头但离屏(风控更友好)
  // mode === 'visible': 什么都不加 → 就是个正常可见窗口(想当普通浏览器用就选它)
  (opts.extraArgs || []).forEach((x) => a.push(x));
  // ★ 2026-09-26 起始页: 不能是 about:blank —— 服务器页会把它过滤掉, 结果"没有可用标签"
  a.push(opts.startUrl || 'https://www.amazon.co.uk/');
  return a;
}

/* ══════════ ★ 2026-10-20 身份校验(修"误杀采集浏览器") ══════════
 * 背景: 本服务靠【端口上的 PID】认领浏览器(recoverState)。Windows 会复用 PID,
 *   而原来的安全闸只校验"进程名是不是浏览器" —— 复用到【用户自己的采集浏览器(msedge, 9222)】
 *   时这道闸是放行的, 于是一次 stop() 就会把用户的采集浏览器 taskkill /T /F 掉:
 *   浏览器整个消失 → 采集看门狗立刻又拉起一个 → 用户看到"浏览器莫名其妙自己打开"。
 * 现在: 认领和停止都必须【命令行里带着本服务的 profile 或端口】才算自己的, 否则拒绝并记账。 */
function cmdlineOf(pid) {
  return new Promise((resolve) => {
    const ps = '(Get-CimInstance Win32_Process -Filter "ProcessId=' + Number(pid) + '" -ErrorAction SilentlyContinue).CommandLine';
    execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, timeout: 9000 }, (e, out) => {
      resolve(e ? '' : String(out || '').trim());
    });
  });
}
/** 这个 PID 是不是【本服务】的浏览器: 命令行必须带我们的 user-data-dir 或调试端口 */
async function isOurBrowser(pid, opts) {
  if (!pid) return false;
  const line = await cmdlineOf(pid);
  if (!line) return false;                       // 读不到命令行 → 一律当"不是我们的"
  const low = line.toLowerCase();
  const prof = String((opts && opts.profile) || DEFAULT_PROFILE).toLowerCase();
  const port = String((opts && opts.port) || DEFAULT_PORT);
  const hitProfile = prof && low.indexOf(prof) >= 0;
  const hitPort = low.indexOf('remote-debugging-port=' + port) >= 0;
  return !!(hitProfile || hitPort);
}
function logRefuse(msg) {
  try { fs.appendFileSync(path.join(DATA_DIR, 'crash.log'), '[' + new Date().toISOString() + '] ' + msg + '\n') } catch (e) {}
}

/** 从「谁在监听 port」反查 PID —— 状态文件丢了也能把浏览器找回来 */
function pidOnPort(port) {
  return new Promise((resolve) => {
    execFile('netstat', ['-ano', '-p', 'TCP'], { windowsHide: true, timeout: 8000, maxBuffer: 4 * 1024 * 1024 }, (e, out) => {
      if (e) return resolve(null);
      const lines = String(out || '').split(/\r?\n/);
      for (const ln of lines) {
        const m = ln.trim().match(/^TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)$/i);
        if (m && Number(m[1]) === Number(port)) return resolve(Number(m[2]));
      }
      resolve(null);
    });
  });
}

/** 状态文件丢了也能恢复: 从监听端口反查真实 PID 并补写状态文件 */
async function recoverState(port, modeHint) {
  const cur = readState();
  if (cur && cur.pid) return cur;
  const pid = await pidOnPort(port);
  if (!pid) return cur || null;
  /* ★ 2026-10-20: 端口上那个浏览器必须真是我们的(命令行带本服务 profile/端口)才认领。
   *   否则别人(用户手动开的调试浏览器/别的程序)占着这个端口时, 我们会把它当成自己的浏览器,
   *   后面一次 stop() 就把它杀掉。 */
  const mine = await isOurBrowser(pid, { port: port, profile: (cur && cur.profile) || DEFAULT_PROFILE });
  if (!mine) {
    logRefuse('拒绝认领: 端口 ' + port + ' 上的 PID ' + pid + ' 命令行不含本服务 profile/端口(不是我们的浏览器)');
    return cur || null;
  }
  const st = {
    pid: pid, port: Number(port),
    mode: (cur && cur.mode) || modeHint || 'headless',
    profile: (cur && cur.profile) || DEFAULT_PROFILE,
    exe: findBrowser(), at: new Date().toISOString(), recovered: true,
  };
  writeState(st);
  return st;
}

/** 启动本地浏览器(已在跑就直接复用) */
async function start(opts) {
  opts = opts || {};
  const port = Number(opts.port || DEFAULT_PORT);
  const cur = await probe(port);
  if (cur) {
    // ★ 2026-09-26: 状态文件丢了(被手动删/上次没写成)时, 这里必须把它补回来 ——
    //   否则 status() 报 pid=null/mode=null, 之后点「停止」会因为没有 PID 而停不掉, 浏览器就成了孤儿进程。
    const st = await recoverState(port, opts.mode);
    return { ok: true, already: true, port: port, pid: (st && st.pid) || null, mode: (st && st.mode) || '?', browser: cur.Browser, profile: (st && st.profile) || null };
  }
  const exe = findBrowser();
  if (!exe) return { ok: false, error: '找不到 Edge/Chrome 可执行文件' };
  const profile = opts.profile || DEFAULT_PROFILE;
  const mode = (opts.mode === 'offscreen' || opts.mode === 'visible') ? opts.mode : 'headless';
  try { fs.mkdirSync(profile, { recursive: true }) } catch (e) {}
  const args = argsFor({ mode: mode, port: port, profile: profile, extraArgs: opts.extraArgs, startUrl: opts.startUrl });
  // ★ 2026-09-26 用 PowerShell Start-Process 启动: spawn(detached) 起的子进程会跟着 ERP 一起被
  //   Windows 作业对象回收(实测: 重启 ERP 后无头浏览器没了) → 换成独立进程树, 重启 ERP 不影响它。
  let pid = null;
  try {
    // ★ 不要加 -WindowStyle Hidden: 实测会把无头窗口建成 1×1(innerWidth/Height=1) → 截图只有 1 像素
    const ps = 'Start-Process -FilePath ' + JSON.stringify(exe) + ' -ArgumentList @(' + args.map((a) => JSON.stringify(a)).join(',') + ') -PassThru | Select-Object -ExpandProperty Id';
    pid = await new Promise((resolve) => {
      execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, timeout: 20000 }, (e, out) => {
        if (e) return resolve(null);
        const n = parseInt(String(out).trim(), 10);
        resolve(isNaN(n) ? null : n);
      });
    });
  } catch (e) { pid = null }
  if (!pid) {   // 兜底: 还是用 spawn
    const child = spawn(exe, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    pid = child.pid;
  }
  writeState({ pid: pid, port: port, mode: mode, profile: profile, exe: exe, at: new Date().toISOString() });
  // 等它就绪(最多 ~20 秒)
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const v = await probe(port);
    if (v) return { ok: true, started: true, port: port, pid: pid, mode: mode, browser: v.Browser, profile: profile, args: args };
  }
  return { ok: false, error: '浏览器起来了但 CDP 端口没响应(可能被安全策略拦了)', pid: pid, port: port, args: args };
}

function killPid(pid, expect) {
  return new Promise((resolve) => {
    if (!pid) return resolve(false);
    // ★ 2026-09-26 安全闸: 这个 pid 是从磁盘上的 browser-service.json 读回来的, 可能是【过期 PID】。
    //   Windows 会回收 PID, 过期 PID 可能已经属于别的进程 —— 而 taskkill /T /F 会连它的整棵子树一起杀。
    //   实测踩过: ERP 后端在切换浏览器模式的窗口期整个死掉(前端全部 ECONNREFUSED)。
    //   所以杀之前必须先确认这个 PID 现在真的是浏览器。
    execFile('tasklist', ['/FI', 'PID eq ' + String(pid), '/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 8000 }, (e, out) => {
      if (e) return resolve(false);                       // 查不到 = 进程已经没了, 不用杀
      const line = String(out || '').trim();
      if (!line || /No tasks|没有运行的任务/i.test(line)) return resolve(false);
      const name = (line.split(',')[0] || '').replace(/"/g, '').trim().toLowerCase();
      const okName = /^(msedge|chrome|chromium|brave|vivaldi)\.exe$/.test(name);
      if (!okName) {
        // 过期 PID 被系统回收给了别的进程 —— 绝对不能杀, 记一笔
        try { fs.appendFileSync(path.join(DATA_DIR, 'crash.log'), '[' + new Date().toISOString() + '] 拒绝 kill: PID ' + pid + ' 现在是 ' + name + ' (不是浏览器, 疑似过期 PID 被回收)\n') } catch (e2) {}
        return resolve(false);
      }
      /* ★ 2026-10-20: 名字是 msedge 还远远不够 —— 必须是【本服务】的浏览器才允许杀。
       *   否则 PID 被回收给用户的采集浏览器(同是 msedge)时会把它连带子树杀掉。 */
      isOurBrowser(pid, expect).then((mine) => {
        if (!mine) {
          logRefuse('拒绝 kill: PID ' + pid + ' 命令行不含本服务 profile/端口(疑似 PID 被回收给了别的浏览器), 已跳过');
          return resolve(false);
        }
        execFile('taskkill', ['/PID', String(pid), '/T', '/F'], (e2) => resolve(!e2));
      }).catch(() => resolve(false));
    });
  });
}

async function stop() {
  const st = readState();
  const port = (st && st.port) || DEFAULT_PORT;
  if (st && st.pid) await killPid(st.pid, { port: port, profile: (st && st.profile) || DEFAULT_PROFILE });
  // 兜底: 有些子进程不是我们直接拉起的, 按 profile 再扫一遍
  await new Promise((resolve) => {
    execFile('wmic', ['process', 'where', "name='msedge.exe'", 'get', 'ProcessId,CommandLine'], () => resolve());
  });
  clearState();
  const gone = !(await probe(port));
  return { ok: true, stopped: gone, port: port };
}

async function status() {
  let st = readState() || {};
  const port = st.port || DEFAULT_PORT;
  const v = await probe(port);
  // ★ 状态文件丢了但浏览器还活着 → 自动把 PID 找回来(否则「停止」按钮会失效)
  if (v && !st.pid) { st = (await recoverState(port, st.mode)) || st }
  const pages = v ? (await listPages(port)).filter((x) => x.type === 'page') : [];
  return {
    ok: true,
    running: !!v,
    port: port,
    pid: st.pid || null,
    mode: st.mode || null,
    profile: st.profile || null,
    browser: v ? v.Browser : null,
    startedAt: st.at || null,
    pages: pages.map((p) => ({ title: (p.title || '').slice(0, 60), url: (p.url || '').slice(0, 100) })).slice(0, 10),
    exe: findBrowser(),
  };
}

/** 打开一个页面(用 /json/new; 新版 Chromium 需要 PUT) */
function openPage(url, port) {
  const p = port || DEFAULT_PORT;
  const call = (method) => new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: p, path: '/json/new?' + encodeURIComponent(url), method: method, timeout: 8000 }, (res) => {
      let d = ''; res.on('data', (c) => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)) } catch (e) { resolve(null) } });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null) });
    req.end();
  });
  return call('PUT').then((r) => r || call('GET'));
}

module.exports = { start, stop, status, probe, listPages, openPage, findBrowser, DEFAULT_PORT };

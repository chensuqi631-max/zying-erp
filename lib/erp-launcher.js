/**
 * 本地后端 (智赢ERP) 启动器 —— 让"市场一键安装"之后开箱即用
 *
 * 背景: 市场装的是 DSH 插件 (界面 + 工具), 但采集/商品库/利润测算都在本地 Node 后端 (127.0.0.1:3088)。
 *       用户装完插件、重启 DSH 后, 这里自动把后端拉起来, 否则界面上全是"系统未启动"。
 *
 * 设计要点:
 *   · 已在跑 (health 返回 ok) → 什么都不做 (你自己的开发环境就是这种, 绝不会被干扰)
 *   · 未在跑 → 用当前 DSH 的 Node (process.execPath) 启动 `<插件>/erp/server.js 3088`
 *   · 数据目录用 ZYING_DATA 指到用户主目录 (~/.zying-erp/data), 不放 node_modules (升级会被替换掉)
 *   · 绝不在失败时抛异常影响 DSH 启动; 只打日志
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(__dirname, '..');

export const ERP_PORT = Number(process.env.ZYING_PORT || 3088);
export const ERP_URL = `http://127.0.0.1:${ERP_PORT}`;

/** 后端程序所在目录: 优先插件内置的 erp/, 其次环境变量指定的外部目录 */
export function erpDir() {
  const bundled = path.join(PLUGIN_ROOT, 'erp');
  if (fs.existsSync(path.join(bundled, 'server.js'))) return bundled;
  if (process.env.ZYING_ERP_DIR && fs.existsSync(path.join(process.env.ZYING_ERP_DIR, 'server.js'))) return process.env.ZYING_ERP_DIR;
  // zip 交付布局: 插件目录旁边就是完整的 zying-demo 后端
  const sibling = path.resolve(PLUGIN_ROOT, '..', 'zying-demo');
  if (fs.existsSync(path.join(sibling, 'server.js'))) return sibling;
  return null;
}
/** 数据目录 (放用户主目录, 不随插件升级丢失) */
export function dataDir() {
  if (process.env.ZYING_DATA) return path.resolve(process.env.ZYING_DATA);
  return path.join(os.homedir(), '.zying-erp', 'data');
}

/** 后端是否在线 */
export async function isUp(timeoutMs = 2000) {
  try {
    const r = await fetch(ERP_URL + '/api/health', { signal: AbortSignal.timeout(timeoutMs) });
    return r.ok;
  } catch (e) { return false; }
}

/** 读授权状态 (未授权时返回含设备指纹的说明, 便于让用户转给授权方) */
export async function license() {
  try {
    const r = await fetch(ERP_URL + '/api/license/status', { signal: AbortSignal.timeout(3000) });
    return await r.json();
  } catch (e) { return null; }
}

/**
 * 确保后端在跑。返回 { started, dir, port, reason }
 * ctx 参数保留给 Cordis 用 (目前不需要), 传 null 也能工作。
 */
export async function ensureErp(ctx, opts = {}) {
  const port = opts.port || ERP_PORT;
  const timeoutMs = opts.timeoutMs || 25000;
  const log = (s) => console.log('[zying-erp] ' + s);
  if (await isUp(1500)) {
    log('本地后端已在运行: ' + `http://127.0.0.1:${port}`);
    return { started: false, reason: 'already-running', port };
  }
  const dir = opts.dir || erpDir();
  if (!dir) {
    log('未找到内置后端 (erp/server.js) —— 跳过自动启动; 请手动运行 node server.js 3088');
    return { started: false, reason: 'no-erp-dir', port };
  }
  const data = opts.data || dataDir();
  try { fs.mkdirSync(data, { recursive: true }); } catch (e) { /* ignore */ }
  log(`正在启动本地后端 (端口 ${port}, 数据目录 ${data})…`);
  try {
    const child = spawn(process.execPath, ['server.js', String(port)], {
      cwd: dir,
      /* ★ 2026-10-25 适配修复: DSH 桌面端是 Electron, process.execPath 指向 "DeepSeek Harness.exe"。
       *   不带 ELECTRON_RUN_AS_NODE=1 时, 它会被当成 Electron 应用再开一个窗口, 而不是跑 Node 脚本
       *   → 后端永远起不来(或弹出一个多余窗口)。带上这个变量后 Electron 以纯 Node 模式执行 server.js。
       *   在普通 node 环境下该变量无副作用(只有 Electron 会解释它)。 */
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ZYING_DATA: data },
      detached: true,          // 独立进程: DSH 关掉后后端继续跑 (与手动启动行为一致)
      stdio: 'ignore',
      windowsHide: true,
    });
    child.on('error', (e) => log('启动失败: ' + e.message));
    child.unref();
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      await new Promise((r) => setTimeout(r, 700));
      if (await isUp(1500)) {
        const lic = await license();
        log('后端已就绪: http://127.0.0.1:' + port + (lic ? ' | 授权: ' + (lic.summary || '') : ''));
        return { started: true, dir, data, port };
      }
    }
    log('后端启动超时 —— 可手动执行: cd "' + dir + '" && node server.js ' + port);
    return { started: false, reason: 'timeout', dir, port };
  } catch (e) {
    log('启动异常: ' + (e && e.message));
    return { started: false, reason: 'error', error: String(e && e.message) };
  }
}

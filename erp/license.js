/**
 * 授权 (License) 模块 —— 让"只有你授权的人能用"
 *
 * 原理: 非对称签名。你保管私钥(绝不外发), 发给客户的程序里只放公钥。
 *       授权文件 = base64url(payload) + '.' + base64url(Ed25519签名)
 *       → 客户改 payload(改到期日/加功能) 会验签失败; 改验签代码也没用, 因为强校验在后端。
 *
 * 三种运行模式:
 *   ① 未启用 (license.config.json 里 enforce=false)  → 开发模式, 全部放行, 状态里明确提示
 *   ② 启用 + 授权有效                              → 按 features 放行
 *   ③ 启用 + 缺授权/过期/设备不符/被篡改             → /api/* 一律 403 (白名单除外)
 *
 * 生成密钥与签发授权: node tools/gen-license.js --help
 */
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = __dirname;
// 数据目录: 允许用 ZYING_DATA 覆盖 (插件市场安装时程序在 node_modules 里, 数据必须放到外面)
const DATA = process.env.ZYING_DATA ? path.resolve(process.env.ZYING_DATA) : path.join(ROOT, 'data');
// 授权文件查找顺序 (第一个存在的生效):
//   ① 环境变量 ZYING_LICENSE 指定的文件 ② 数据目录下的 license.key (市场安装用户放这里最好找)
//   ③ 程序目录下的 license.key (手动部署时的传统位置) ④ 上级目录 (插件内嵌时用户在插件根放)
const LICENSE_CANDIDATES = [
  process.env.ZYING_LICENSE ? path.resolve(process.env.ZYING_LICENSE) : null,
  path.join(DATA, 'license.key'),
  path.join(ROOT, 'license.key'),
  path.join(ROOT, '..', 'license.key'),
].filter(Boolean);
const LICENSE_FILE = LICENSE_CANDIDATES[0];                     // 兼容旧引用 (首次查找项)
const existingLicenseFile = () => LICENSE_CANDIDATES.find((p) => { try { return fs.existsSync(p); } catch (e) { return false; } }) || null;
const CONFIG_FILE = path.join(ROOT, 'license.config.json');      // { enforce: true|false, pubKeyPath?: '...' }
const PUBKEY_FILE = path.join(ROOT, 'tools', 'license-pub.pem'); // 随产品分发的公钥

// ---------- 设备指纹 ----------
// 用"稳定但换机就变"的硬件信息做指纹: 主机名 + 平台 + CPU 型号 + 首个物理网卡 MAC
// 注意: 不做唯一性哈希则同一型号机器会撞; 加主机名与网卡即可区分
/* ★ 2026-11-13 修: 指纹原来取"第一个非内部网卡 MAC" —— 换 Wi-Fi/手机热点/VPN 就会变,
 *   实测本机从 B833D41F8D436EEF 变成 DC714B5C5E81066E(连手机热点后), 授权直接失效。
 *   现在主指纹改用【Windows MachineGuid】(跟网络无关), 并把旧的 MAC 指纹保留为"别名",
 *   这样历史授权仍能通过验证(verify 时对 aliases 取交集)。 */
let _fpCache = null;
function stableMachineId() {
  try {
    const { execSync } = require('child_process');
    const out = execSync('reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid', { encoding: 'utf8', timeout: 4000, windowsHide: true });
    const m = String(out).match(/MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]{20,})/);
    if (m) return 'mg:' + m[1].toLowerCase();
  } catch (e) {}
  try {
    const { execSync } = require('child_process');
    const out = execSync('wmic csproduct get uuid', { encoding: 'utf8', timeout: 4000, windowsHide: true });
    const m = String(out).match(/[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}/);
    if (m) return 'uuid:' + m[0].toLowerCase();
  } catch (e) {}
  return '';
}
function legacyMacFingerprint() {
  const nets = os.networkInterfaces();
  let mac = '';
  for (const k of Object.keys(nets)) {
    for (const ni of nets[k] || []) {
      if (!ni.internal && ni.mac && ni.mac !== '00:00:00:00:00:00') { mac = ni.mac; break; }
    }
    if (mac) break;
  }
  const raw = [os.hostname(), os.platform(), os.arch(), (os.cpus()[0] || {}).model || '', mac].join('|');
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16).toUpperCase();
}
/** 返回本机所有可接受的指纹: [主指纹(稳定), 旧 MAC 指纹(兼容历史授权)] */
function fingerprints() {
  if (_fpCache) return _fpCache.slice();
  const base = [os.hostname(), os.platform(), os.arch(), (os.cpus()[0] || {}).model || '', String(os.totalmem())].join('|');
  const mid = stableMachineId();
  const primary = crypto.createHash('sha256').update(base + '|' + mid).digest('hex').slice(0, 16).toUpperCase();
  const legacy = legacyMacFingerprint();
  _fpCache = primary === legacy ? [primary] : [primary, legacy];
  return _fpCache.slice();
}
function deviceFingerprint() { return fingerprints()[0]; }

// ---------- 工具 ----------
const b64 = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

function readJson(p, dflt) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return dflt; } }

function publicKey() {
  const cfg = readJson(CONFIG_FILE, {});
  const p = cfg.pubKeyPath ? path.resolve(ROOT, cfg.pubKeyPath) : PUBKEY_FILE;
  try { return { pem: fs.readFileSync(p, 'utf8'), path: p }; } catch (e) { return { pem: null, path: p }; }
}

function enforceEnabled() {
  const cfg = readJson(CONFIG_FILE, null);
  // 没有配置文件 → 默认启用 (分发给客户的包必须是"默认启用", 否则拷走就绕过了)
  if (!cfg || typeof cfg.enforce !== 'boolean') return true;
  return cfg.enforce;
}

// ---------- 验签与状态 ----------
// 返回 { ok, reason, payload } — 绝不因为异常而"放行"
function verifyLicenseText(text) {
  const s = String(text || '').trim();
  if (!s) return { ok: false, reason: 'no-license', msg: '未找到授权文件 license.key' };
  const parts = s.split('.');
  if (parts.length !== 2) return { ok: false, reason: 'malformed', msg: '授权文件格式不对 (应形如 payload.signature)' };
  const pk = publicKey();
  if (!pk.pem) return { ok: false, reason: 'no-pubkey', msg: '缺少公钥文件: ' + pk.path };
  let payload, sigOk = false;
  try { payload = JSON.parse(unb64(parts[0]).toString('utf8')); } catch (e) { return { ok: false, reason: 'bad-payload', msg: '授权内容解析失败' }; }
  try {
    sigOk = crypto.verify(null, Buffer.from(parts[0]), crypto.createPublicKey(pk.pem), unb64(parts[1]));
  } catch (e) { return { ok: false, reason: 'verify-error', msg: '验签异常: ' + e.message }; }
  if (!sigOk) return { ok: false, reason: 'bad-signature', msg: '授权签名无效 (文件被改动过, 或不是本产品签发的)' };
  // 到期
  if (payload.exp) {
    const exp = new Date(String(payload.exp) + (String(payload.exp).length <= 10 ? 'T23:59:59Z' : ''));
    if (isNaN(exp.getTime())) return { ok: false, reason: 'bad-exp', msg: '授权到期日格式不对: ' + payload.exp };
    if (Date.now() > exp.getTime()) return { ok: false, reason: 'expired', msg: '授权已到期 (' + payload.exp + ')', payload };
  }
  // 设备绑定 (payload.devices 为空/不存在 = 不绑定设备)
  const fps = fingerprints();
  const fp = fps[0];
  if (Array.isArray(payload.devices) && payload.devices.length && !payload.devices.some((d) => fps.indexOf(String(d).toUpperCase()) >= 0)) {
    return { ok: false, reason: 'device-mismatch', msg: '授权未包含本机 (本机指纹 ' + fps.join(' / ') + ', 授权机器数 ' + payload.devices.length + ')', payload, fingerprint: fp, fingerprints: fps };
  }
  return { ok: true, reason: 'ok', payload, fingerprint: fp };
}

function loadLicense() {
  const f = existingLicenseFile();
  if (!f) return '';
  try { return fs.readFileSync(f, 'utf8'); } catch (e) { return ''; }
}

// 给后端/前端用的状态
function licenseStatus() {
  const enforce = enforceEnabled();
  const v = verifyLicenseText(loadLicense());
  const fp = deviceFingerprint();
  return {
    enforce,
    valid: v.ok,
    reason: v.reason,
    message: v.msg || null,
    fingerprint: fp,
    customer: v.payload ? (v.payload.name || v.payload.id || null) : null,
    licenseId: v.payload ? (v.payload.id || null) : null,
    expiresAt: v.payload ? (v.payload.exp || null) : null,
    features: v.payload && Array.isArray(v.payload.features) ? v.payload.features : (v.payload ? null : null),
    sites: v.payload && Array.isArray(v.payload.sites) ? v.payload.sites : null,
    issuedAt: v.payload ? (v.payload.iat || null) : null,
    note: v.payload ? (v.payload.note || null) : null,
    // 联系方式 (license.config.json 的 contact): 未授权时界面显示"把指纹发给谁"
    contact: (readJson(CONFIG_FILE, {}).contact || null),
    licensePath: existingLicenseFile(),
    licenseCandidates: LICENSE_CANDIDATES,
    dataDir: DATA,
    // 一句话结论, 前端直接显示
    // ★ 期限: 没写 exp = 永久授权（签发时不传 --days/--exp 就是这种）
    summary: !enforce ? '未启用授权校验 (开发模式)'
      : (v.ok
        ? '已授权: ' + (v.payload.name || v.payload.id) + (v.payload.exp ? ' · 到期 ' + v.payload.exp : ' · 永久')
        : '未授权: ' + (v.msg || v.reason)),
  };
}

// 功能位判断: features 缺省 = 全功能; 否则按组放行
// 组→接口前缀的映射见 server.js 里的 FEATURE_OF
function hasFeature(name) {
  const v = verifyLicenseText(loadLicense());
  if (!v.ok) return false;
  if (!v.payload || !Array.isArray(v.payload.features) || !v.payload.features.length) return true;
  return v.payload.features.indexOf(name) >= 0 || v.payload.features.indexOf('all') >= 0;
}

module.exports = { deviceFingerprint, fingerprints, legacyMacFingerprint, verifyLicenseText, licenseStatus, hasFeature, enforceEnabled, LICENSE_FILE, LICENSE_CANDIDATES, existingLicenseFile, CONFIG_FILE, PUBKEY_FILE, DATA };

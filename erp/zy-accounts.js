'use strict';
/**
 * zy-accounts.js —— 智赢账号「账号密码」统一保管 + 一键登录
 *
 * 存储：~/.zying-erp/data/zy-logins.json        （账号清单，密码只存密文）
 * 密钥：~/.zying-erp/data/.zy-logins.key        （32 字节随机，首次自动生成，0600）
 * 加密：AES-256-GCM（每条独立 IV + 认证标签，防篡改）
 *
 * 设计原则：
 *   · 密码【永不】回传给前端/日志；只在"登录"这一刻解密使用
 *   · 登录成功后的产物是 token，交给 zy-standalone 的 token 仓库（zy-tokens.json），
 *     之后所有数据请求都用 token，不再碰密码
 *   · 智赢登录可能要短信验证码：这里把 needSms 原样返回给上层，由界面补验证码
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const DATA = process.env.ZYING_DATA || path.join(os.homedir(), '.zying-erp', 'data');
const FILE = path.join(DATA, 'zy-logins.json');
const KEY_FILE = path.join(DATA, '.zy-logins.key');

/* ---------- 密钥 ---------- */
function key() {
  try {
    const b = fs.readFileSync(KEY_FILE);
    if (b.length === 32) return b;
  } catch (e) {}
  fs.mkdirSync(DATA, { recursive: true });
  const k = crypto.randomBytes(32);
  fs.writeFileSync(KEY_FILE, k, { mode: 0o600 });
  try { fs.chmodSync(KEY_FILE, 0o600); } catch (e) {}
  return k;
}
function enc(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}
function dec(b64) {
  const b = Buffer.from(String(b64 || ''), 'base64');
  if (b.length < 29) throw new Error('密文损坏');
  const iv = b.subarray(0, 12);
  const tag = b.subarray(12, 28);
  const ct = b.subarray(28);
  const d = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}

/* ---------- 存储 ---------- */
function load() {
  try {
    const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (j && Array.isArray(j.accounts)) return j;
  } catch (e) {}
  return { accounts: [] };
}
function save(db) {
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(db, null, 1), 'utf8');
  try { fs.chmodSync(FILE, 0o600); } catch (e) {}
  return db;
}

/** 列表（绝不返回密码；name 只回显开头 3 位 + ***） */
function list() {
  const db = load();
  return {
    accounts: db.accounts.map((a) => ({
      id: a.id,
      label: a.label,
      name: String(a.name || '').replace(/^(...).*/, '$1***'),
      createdAt: a.createdAt || null,
      lastLoginAt: a.lastLoginAt || null,
      lastOkAt: a.lastOkAt || null,
      lastErr: a.lastErr || null,
      needSms: !!a.needSms,
      hasPwd: !!a.pwdEnc,
    })),
  };
}

/** 新增/更新账号（同名覆盖密码） */
function upsert(label, name, pwd) {
  const n = String(name || '').trim();
  if (!n) throw new Error('账号不能为空');
  if (!pwd) throw new Error('密码不能为空');
  const db = load();
  const hit = db.accounts.find((a) => String(a.name) === n);
  if (hit) {
    hit.label = String(label || hit.label || n);
    hit.pwdEnc = enc(pwd);
    hit.lastErr = null;
    save(db);
    return { id: hit.id, label: hit.label, updated: true };
  }
  const id = 'lg' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  db.accounts.push({ id: id, label: String(label || n), name: n, pwdEnc: enc(pwd), createdAt: new Date().toISOString(), lastLoginAt: null, lastOkAt: null, lastErr: null, needSms: false });
  save(db);
  return { id: id, label: String(label || n), updated: false };
}

function getRaw(id) {
  const db = load();
  const a = db.accounts.find((x) => x.id === id);
  if (!a) throw new Error('账号不存在: ' + id);
  return a;
}

/** 记录登录结果 */
function mark(id, ok, err, needSms) {
  const db = load();
  const a = db.accounts.find((x) => x.id === id);
  if (!a) return;
  a.lastLoginAt = new Date().toISOString();
  if (ok) { a.lastOkAt = a.lastLoginAt; a.lastErr = null; a.needSms = false; }
  else { a.lastErr = String(err || '').slice(0, 160); a.needSms = !!needSms; }
  save(db);
}

/** 改显示名字（只改 label，不动账号/密码） */
function rename(id, label) {
  const db = load();
  const x = db.accounts.find((t) => t.id === String(id));
  if (!x) throw new Error('账号不存在: ' + id);
  const l = String(label == null ? '' : label).trim();
  if (!l) throw new Error('名字不能为空');
  if (l.length > 40) throw new Error('名字最多 40 个字');
  x.label = l;
  save(db);
  return { id: x.id, label: x.label };
}
function remove(id) {
  const db = load();
  const i = db.accounts.findIndex((x) => x.id === id);
  if (i < 0) throw new Error('账号不存在: ' + id);
  const [a] = db.accounts.splice(i, 1);
  save(db);
  return { removed: a.label || a.name };
}

/** 取出明文密码（只给"登录"流程用，不要外传） */
function passwordOf(id) {
  const a = getRaw(id);
  return dec(a.pwdEnc);
}

module.exports = { list, upsert, getRaw, mark, rename, remove, passwordOf, FILE, KEY_FILE };

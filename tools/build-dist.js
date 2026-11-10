#!/usr/bin/env node
/**
 * 打包插件为"可上市场"的成品 (在 dsh-plugin 目录下执行)
 *
 * 做四件事:
 *   ① 把 ERP 后端 (server.js / license.js / public) 复制进 dsh-plugin/erp/
 *      —— 这样市场一键安装就能"装完即用", 不用再单独发后端
 *   ② 可选混淆 (--obfuscate): 用 esbuild + javascript-obfuscator 处理下载得到的构建产物
 *   ③ 写 package.json 的 files 白名单 (只发布构建产物, 不含源码)
 *   ④ 打印发布前的自检结果 (体积/文件清单/不含私钥与授权)
 *
 * 用法:
 *   node tools/build-dist.js                 # 只做 ①②③④ (不混淆)
 *   node tools/build-dist.js --obfuscate     # 额外混淆 (需先 npm i -D esbuild javascript-obfuscator)
 *   node tools/build-dist.js --erp D:\智赢erp\zying-demo    # 指定 ERP 源码目录
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const hasFlag = (f) => args.includes('--' + f);
const argVal = (f, d) => { const i = args.indexOf('--' + f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };

const ERP_SRC = argVal('erp', process.env.ZYING_ERP_DIR || path.resolve(PLUGIN, '..', 'zying-demo'));
const DEST = path.join(PLUGIN, 'erp');
const OBF = hasFlag('obfuscate');
// --no-license: 出免授权版 (谁拿到都能用; 给朋友/自用/免费发放用这个)
const NO_LICENSE = hasFlag('no-license');
const ENFORCE = !NO_LICENSE;
const CLEAN = hasFlag('clean');   // --clean: 连授权模块/公钥一起剥掉 (免费版, 包里看不到授权机制)
// 只带运行必需的东西: 源码/工具/数据都不进包 (数据在用户主目录, 授权文件由用户自己放)
/* ★ 2026-11-11 修复: 原来是一张写死的 6 个文件名白名单, 而后端早就拆成 16 个模块
 *   (blueocean/ip-check/market-api/selection-score/selection-cache/product-insight/browser-service/
 *    site-links/wipo-brand/zying-api/...)。用旧白名单打包, 客户装完必然 "Cannot find module"。
 *   改成按目录动态收集 *.js, 新增模块不需要再回来改这里。 */
const ERP_EXTRA = ['license.config.json', path.join('tools', 'license-pub.pem')];
const ERP_FILES = [
  ...fs.readdirSync(ERP_SRC).filter((f) => f.endsWith('.js')),
  ...ERP_EXTRA,
];
const ERP_DIRS = ['public', 'vendor'];
const NEVER = [/license-priv\.pem$/, /license\.key$/, /\.bak/i, /node_modules/, /_dev-tools/];

const log = (s) => console.log(s);

/* ★ 2026-11-11 新增护栏: 打包源(D:\智赢erp\zying-demo)与实际在跑的代码(dsh-plugin\erp)是两份,
 *   实测两者差了 2 个月、server.js 596KB vs 1098KB —— 直接用默认源打包等于把旧代码发给客户。
 *   这里比较修改时间, 源更旧就拒绝打包 (除非 --force)。 */
(() => {
  const live = path.join(PLUGIN, 'erp', 'server.js');
  const srcSrv = path.join(ERP_SRC, 'server.js');
  if (!fs.existsSync(live) || !fs.existsSync(srcSrv)) return;
  const a = fs.statSync(srcSrv).mtimeMs, b = fs.statSync(live).mtimeMs;
  if (a < b && !hasFlag('force')) {
    log('XX 拒绝打包: 打包源比 dsh-plugin/erp 里的实际代码旧');
    log('   打包源   : ' + srcSrv + '  (' + new Date(a).toLocaleString() + ', ' + Math.round(fs.statSync(srcSrv).size / 1024) + 'KB)');
    log('   实际代码 : ' + live + '  (' + new Date(b).toLocaleString() + ', ' + Math.round(fs.statSync(live).size / 1024) + 'KB)');
    log('   直接用 dsh-plugin/erp 出包:  npm pack   (推荐)');
    log('   或同步一份到打包源后重跑; 确认要用旧源就加 --force');
    process.exit(3);
  }
})();
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (NEVER.some((re) => re.test(p))) continue;
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
function copyFileRel(src, dst) { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst); }

log('=== 打包插件成品 (可上 DSH 市场) ===\n');
if (!fs.existsSync(path.join(ERP_SRC, 'server.js'))) {
  log('XX 找不到 ERP 源码: ' + ERP_SRC);
  log('   用 --erp <zying-demo 目录> 指定, 或设置环境变量 ZYING_ERP_DIR');
  process.exit(2);
}
log('ERP 源码 : ' + ERP_SRC);
log('插件目录 : ' + PLUGIN);

// ---------- ① 复制 ERP ----------
fs.rmSync(DEST, { recursive: true, force: true });
let n = 0, bytes = 0;
for (const f of ERP_FILES) {
  const s = path.join(ERP_SRC, f);
  if (!fs.existsSync(s)) { log('   (跳过不存在的 ' + f + ')'); continue; }
  copyFileRel(s, path.join(DEST, f)); n++; bytes += fs.statSync(s).size;
}
for (const d of ERP_DIRS) {
  const s = path.join(ERP_SRC, d);
  if (!fs.existsSync(s)) continue;
  for (const f of walk(s)) {
    const rel = path.relative(ERP_SRC, f);
    copyFileRel(f, path.join(DEST, rel)); n++; bytes += fs.statSync(f).size;
  }
}
log(`\n① 已复制 ${n} 个后端文件到 erp/ (${(bytes / 1024).toFixed(0)} KB)`);
// 发布版强制启用授权校验 (绝不把开发机的 enforce=false 带出去)
let srcCfg = {};
try { srcCfg = JSON.parse(fs.readFileSync(path.join(ERP_SRC, 'license.config.json'), 'utf8')); } catch (e) { }
fs.writeFileSync(path.join(DEST, 'license.config.json'), JSON.stringify({
  enforce: ENFORCE,   // true=需要授权(默认) / false=免授权版
  contact: srcCfg.contact || null,   // 保留联系方式: 未授权提示里要显示"把指纹发给谁"
  _说明: '没有有效 license.key 的机器, 所有 /api 请求都会被 403',
}, null, 2));
log('   已写入 erp/license.config.json (enforce=' + ENFORCE + ')');
if (NO_LICENSE) log('   !! 免授权版: 任何人都能直接用, 别拿这个版本去卖');
// 划清模块边界: 插件包是 ESM ("type":"module"), 而后端是 CommonJS -> 必须给 erp/ 自己的 package.json
// 否则 Node 按 ESM 解析 server.js, 报 "require is not defined in ES module scope" 直接起不来 (实测踩过)
fs.writeFileSync(path.join(DEST, 'package.json'), JSON.stringify({ name: 'zying-erp-backend', private: true, type: 'commonjs' }, null, 2));
log('   已写入 erp/package.json (type=commonjs, 否则后端起不来)');

// ---------- ② 混淆 (可选) ----------
if (OBF) {
  log('\n② 混淆构建产物…');
  let esbuild, obfuscator;
  try { esbuild = await import('esbuild'); } catch (e) { log('   !! 没装 esbuild → 跳过 (npm i -D esbuild javascript-obfuscator)'); }
  try { obfuscator = (await import('javascript-obfuscator')).default; } catch (e) { log('   !! 没装 javascript-obfuscator → 跳过'); }
  const targets = [path.join(PLUGIN, 'lib', 'client.js'), path.join(DEST, 'server.js'), path.join(DEST, 'license.js')];
  for (const t of targets) {
    if (!fs.existsSync(t)) continue;
    try {
      let code = fs.readFileSync(t, 'utf8');
      if (esbuild) { const r = await esbuild.transform(code, { minify: true, legalComments: 'none' }); code = r.code; }
      if (obfuscator) {
        code = obfuscator.obfuscate(code, {
          compact: true, stringArray: true, stringArrayThreshold: 1,
          controlFlowFlattening: false, deadCodeInjection: false,   // 保持可调试性与体积
          identifierNamesGenerator: 'hexadecimal', renameGlobals: false,
          selfDefending: false,
        }).getObfuscatedCode();
      }
      fs.writeFileSync(t, code);
      log('   混淆 ' + path.relative(PLUGIN, t) + ' → ' + (code.length / 1024).toFixed(0) + ' KB');
    } catch (e) { log('   混淆失败 ' + path.basename(t) + ': ' + e.message); }
  }
} else log('\n② 未启用混淆 (加 --obfuscate 可开启; 建议正式发布时开启)');

// ---------- ③ package.json files 白名单 ----------
const pkgPath = path.join(PLUGIN, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const files = ['index.js', 'lib', 'erp', 'cordis.patch.yml', 'README.md', 'LICENSE'];   // 千万别漏 cordis.patch.yml: 少了它 DSH 认不到插件(实测)
if (JSON.stringify(pkg.files) !== JSON.stringify(files)) {
  pkg.files = files;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  log('\n③ 已更新 package.json 的 files 白名单: ' + files.join(', '));
}
if (pkg.license !== 'UNLICENSED') { pkg.license = 'UNLICENSED'; fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n'); log('   license 字段设为 UNLICENSED (专有, 非开源)'); }

// ---------- ③之二 免费版: 剥离授权模块 ----------
if (CLEAN) {
  log('\n③之二 剥离授权模块 (免费版)');
  // 1) 用桩替换 license.js: 恒返回"无授权校验", 使授权闸门永远放行
  fs.writeFileSync(path.join(DEST, 'license-stub.js'), [
    '// 免费版: 无授权校验 (此文件替代 license.js, 网关恒放行)',
    "const path = require('path'), os = require('os');",
    "const DATA_DIR = process.env.ZYING_DATA ? path.resolve(process.env.ZYING_DATA) : path.join(os.homedir(), '.zying-erp', 'data');",
    'const off = () => false;',
    'module.exports = {',
    "  licenseStatus: () => ({ enforce: false, valid: true, reason: 'free', summary: '免费版 (无需授权)', contact: null, fingerprint: '', licensePath: null, dataDir: DATA_DIR }),",
    '  hasFeature: () => true,',
    '  enforceEnabled: off,',
    "  deviceFingerprint: () => '',",
    "  verifyLicenseText: () => ({ ok: true, reason: 'free' }),",
    "  existingLicenseFile: () => null,",
    '};',
    '',
  ].join('\n'));
  // 2) server.js: 把 require('./license') 指向桩
  const srvFile = path.join(DEST, 'server.js');
  let srv = fs.readFileSync(srvFile, 'utf8');
  const before = srv;
  srv = srv.replace("require('./license')", "require('./license-stub')");
  if (srv === before) log('   !! 未能替换 license 引用 (server.js 结构变了?)');
  fs.writeFileSync(srvFile, srv);
  // 3) 删掉授权相关文件
  for (const f of ['license.js', 'license.config.json', path.join('tools', 'license-pub.pem')]) {
    const p = path.join(DEST, f);
    if (fs.existsSync(p)) { fs.rmSync(p, { force: true }); log('   已移除 ' + f); }
  }
  log('   授权闸门变为恒放行 (免费版)');
}
// ---------- ④ 发布前自检 ----------
log('\n④ 发布前自检');
const all = walk(PLUGIN).filter((f) => !f.includes(path.join(PLUGIN, '.git')));
const bad = all.filter((f) => /license-priv\.pem$/.test(f) || /license\.key$/.test(f));
const totalKB = all.reduce((s, f) => s + fs.statSync(f).size, 0) / 1024;
const e = (p, ok, extra = '') => log('   ' + (ok ? 'OK  ' : 'XX  ') + p + (extra ? '  ' + extra : ''));
e('包内不含私钥/授权文件', bad.length === 0, bad.join(', '));
e('自带 ERP 后端 (装完即用)', fs.existsSync(path.join(DEST, 'server.js')));
e('插件主入口存在', fs.existsSync(path.join(PLUGIN, 'index.js')));
e('界面 bundle 存在', fs.existsSync(path.join(PLUGIN, 'lib', 'client.js')));
e('package.json 声明了 dsh.client.platform', pkg.dsh && pkg.dsh.client && pkg.dsh.client.platform === 'web');
e('数据不会写进 node_modules (用 ZYING_DATA)', fs.readFileSync(path.join(DEST, 'server.js'), 'utf8').includes('ZYING_DATA'));
e('授权模式: ' + (ENFORCE ? '需要授权 (enforce=true)' : '免授权 (enforce=false, 谁都能用)'), true);
log(`   包体积约 ${totalKB.toFixed(0)} KB`);

log('\n下一步:');
log('   1) 本地试装:  dsh plugin --profile web add ' + PLUGIN.replace(/\\/g, '/'));
log('   2) 发布 npm:  cd ' + PLUGIN + ' && npm publish --access public');
log('   3) 上市场:    去 github.com/awesome-dsh-plugin/awesome-dsh-plugin 提 PR 加一条目录项 (见 README 里的示例)');

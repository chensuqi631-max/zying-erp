// server.js 专项：顶层同名重复 + 定义了但没有任何调用点的函数
const fs = require('fs');
const src = fs.readFileSync('D:/deepseekharness/zying-erp/erp/server.js', 'utf8');

// 1) 顶层（depth 0）函数 / const 声明
const fns = [];
let i = 0, depth = 0;
const n = src.length;
const lineOf = (pos) => src.slice(0, pos).split('\n').length;

while (i < n) {
  const c = src[i];
  if (c === '{') { depth++; i++; continue; }
  if (c === '}') { depth--; i++; continue; }
  if (c === '/' && src[i + 1] === '/') { const e = src.indexOf('\n', i); i = e < 0 ? n : e; continue; }
  if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
  if (c === '"' || c === "'" || c === '`') {
    const q = c; i++;
    while (i < n && src[i] !== q) { if (src[i] === '\\') i++; i++; }
    i++; continue;
  }
  if (depth === 0 && /^function\s+[A-Za-z0-9_$]+\s*\(/.test(src.slice(i, i + 80))) {
    const m = /^function\s+([A-Za-z0-9_$]+)\s*\(/.exec(src.slice(i, i + 80));
    if (m) fns.push({ name: m[1], line: lineOf(i), pos: i });
  }
  i++;
}

const byName = new Map();
for (const f of fns) { if (!byName.has(f.name)) byName.set(f.name, []); byName.get(f.name).push(f); }

console.log('顶层函数总数:', fns.length);
const dupNames = [...byName.entries()].filter(([, g]) => g.length > 1);
console.log('\n== 同名顶层函数（后者覆盖前者） ==');
if (!dupNames.length) console.log('  无');
dupNames.forEach(([nm, g]) => console.log(`  ${nm}: L${g.map((x) => x.line).join(', L')}`));

console.log('\n== 定义了但全文件只出现 1 次(仅声明处)的函数 ==');
const unused = [];
for (const [nm, g] of byName) {
  const re = new RegExp('\\b' + nm.replace(/\$/g, '\\$') + '\\b', 'g');
  const cnt = (src.match(re) || []).length;
  if (cnt <= 1) unused.push(`${nm}@L${g[0].line}`);
}
console.log(unused.length ? '  ' + unused.join('\n  ') : '  无');
console.log('\n（注意：只出现 2 次不代表被调用——可能是"声明+赋值"或仅在本函数内递归；下面给出 2 次的清单供人工判断）');
const twice = [];
for (const [nm, g] of byName) {
  const re = new RegExp('\\b' + nm.replace(/\$/g, '\\$') + '\\b', 'g');
  const cnt = (src.match(re) || []).length;
  if (cnt === 2) twice.push(`${nm}@L${g[0].line}`);
}
console.log('  2 次: ' + (twice.slice(0, 60).join(', ') || '无'));

// 找出「函数体完全相同」的重复实现（复制粘贴）与同作用域同名重复声明
const fs = require('fs');
const crypto = require('crypto');

const files = process.argv.slice(2);

function stripComments(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');
}
function norm(s) {
  return stripComments(s).replace(/\s+/g, ' ').trim();
}
function hash(s) {
  return crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
}

for (const f of files) {
  let src;
  try { src = fs.readFileSync(f, 'utf8'); } catch (e) { continue; }
  const fns = []; // {name, line, body}
  const re = /function\s+([A-Za-z0-9_$]+)\s*\(/g;
  let m;
  while ((m = re.exec(src))) {
    const name = m[1];
    // 找函数体起始 {
    let i = src.indexOf('{', m.index + m[0].length);
    // 处理参数里有默认对象值含 { 的情况：跳过括号匹配
    let paren = 0, j = m.index + m[0].length - 1;
    for (; j < src.length; j++) {
      const c = src[j];
      if (c === '(') paren++;
      else if (c === ')') { paren--; if (paren === 0) { j++; break; } }
    }
    i = src.indexOf('{', j);
    if (i < 0) continue;
    let depth = 0, k = i;
    for (; k < src.length; k++) {
      const c = src[k];
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) { k++; break; } }
    }
    const body = src.slice(i, k);
    const line = src.slice(0, m.index).split(/\r?\n/).length;
    fns.push({ name, line, body: norm(body), len: body.length });
  }

  const byHash = new Map();
  for (const fn of fns) {
    if (fn.len < 80) continue; // 太短的不算
    const h = hash(fn.body);
    if (!byHash.has(h)) byHash.set(h, []);
    byHash.get(h).push(fn);
  }
  const dupBodies = [...byHash.values()].filter((g) => g.length > 1);

  const byName = new Map();
  for (const fn of fns) {
    if (!byName.has(fn.name)) byName.set(fn.name, []);
    byName.get(fn.name).push(fn);
  }
  const dupNames = [...byName.entries()].filter(([, g]) => g.length > 1);

  console.log(`\n### ${f.split(/[\\/]/).pop()}  函数 ${fns.length} 个`);
  if (dupNames.length) {
    console.log('  同名函数定义多次:');
    dupNames.forEach(([n, g]) => console.log(`    ${n}  L${g.map((x) => x.line).join(', L')}`));
  }
  if (dupBodies.length) {
    console.log('  函数体完全相同（复制粘贴）:');
    dupBodies.forEach((g) => console.log(`    ${g.map((x) => `${x.name}@L${x.line}`).join('  ===  ')}  (${g[0].len} 字节)`));
  }
  if (!dupNames.length && !dupBodies.length) console.log('  （无）');
}

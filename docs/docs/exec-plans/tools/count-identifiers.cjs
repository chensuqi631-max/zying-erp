// 精确统计标识符出现次数（UTF-8 安全），找出"只定义未使用"
const fs = require('fs');

const targets = [
  { file: 'D:/deepseekharness/zying-erp/lib/client.js',
    names: ['fmtNum','FmtNum','fmtMoney','FmtMoney','rankChip','rowCells','foldHidden','rankParentCellText','upd','toggleSite','SITES9','CAT9','COLLECT_ONLY','fldC','badgePickedTxt','kwNo','saveTaxOverride','add1688Item','diffBadge','deriveCat','brandKeyOf','batchClaim','tmBadge','cell'] },
  { file: 'D:/deepseekharness/_unpack/搞薯条完整包-20261122/02-browser-extension/zy-panel.js',
    names: ['bearRow','bgTag','chOpts','specChips','pageVariants','applyInitPriceLocks','ipAdjOf','applyIpAdjLive'] },
  { file: 'D:/deepseekharness/_unpack/搞薯条完整包-20261122/02-browser-extension/bridge.js',
    names: ['zvPortsOpen','zvIfastGet'] },
];

for (const t of targets) {
  let src = '';
  try { src = fs.readFileSync(t.file, 'utf8'); } catch (e) { console.log('读不到 ' + t.file); continue; }
  console.log('\n### ' + t.file.split('/').pop());
  for (const n of t.names) {
    const re = new RegExp('\\b' + n + '\\b', 'g');
    const hits = src.match(re) || [];
    const lines = [];
    let m; const lre = new RegExp('\\b' + n + '\\b', 'g');
    const linesArr = src.split(/\r?\n/);
    linesArr.forEach((ln, i) => { lre.lastIndex = 0; if (lre.test(ln)) lines.push(i + 1); });
    const flag = hits.length <= 1 ? '  ← 只出现 1 次（疑似未使用）' : '';
    console.log(`  ${n.padEnd(22)} ${String(hits.length).padStart(3)} 次  行: ${lines.slice(0, 6).join(',')}${lines.length > 6 ? '…' : ''}${flag}`);
  }
}

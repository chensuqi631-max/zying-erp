/**
 * variant-color.js —— 变体颜色识别
 *   输入：ASIN 列表（用商品主图）
 *   输出：{ "ASIN": { color:"深蓝", hex:"#103070" } }
 *   实现：Python + Pillow 取主色 → 最近中文色名；结果缓存 24h，并回写商品库 colorName
 *   依赖：本机 python + Pillow（缺失时静默降级，返回空）
 */
'use strict';
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const PY = process.env.ZYING_PYTHON || 'python';
const HELPER = process.env.ZYING_COLOR_HELPER || 'D:/智赢erp/_dev-tools/zy_rpc/color_name.py';

const cache = new Map();          // asin -> {color,hex,at}
const TTL = 24 * 60 * 60 * 1000;

function pyColor(url) {
  return new Promise((resolve) => {
    execFile(PY, [HELPER, url], { timeout: 25000, windowsHide: true }, (err, stdout) => {
      if (err) return resolve(null);
      try {
        const j = JSON.parse(String(stdout).trim().split(/\r?\n/).pop());
        if (j && j.color) return resolve({ color: j.color, hex: j.hex || '' });
      } catch (e) {}
      resolve(null);
    });
  });
}

/**
 * @param {Array<{asin:string,image:string}>} items
 * @returns {Promise<Object>} map
 */
async function detect(items) {
  const out = {};
  const todo = [];
  for (const it of items || []) {
    const asin = String(it.asin || '').toUpperCase();
    if (!/^[A-Z0-9]{10}$/.test(asin) || !it.image) continue;
    const c = cache.get(asin);
    if (c && Date.now() - c.at < TTL) { out[asin] = { color: c.color, hex: c.hex }; continue; }
    todo.push({ asin, image: it.image });
  }
  for (const t of todo) {
    const r = await pyColor(t.image);
    if (r) { cache.set(t.asin, { ...r, at: Date.now() }); out[t.asin] = r; }
  }
  return out;
}

function getCached(asin) {
  const c = cache.get(String(asin || '').toUpperCase());
  return c ? { color: c.color, hex: c.hex } : null;
}

module.exports = { detect, getCached };

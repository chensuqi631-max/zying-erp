/**
 * 选品面板缓存 (P0-1)
 * ==================================================================
 * 为什么需要: 智赢插件的面板按 ASIN 逐个分析, 且只在"标签页前台 + 卡片进视口"时渲染,
 *   一次扫描往往只能拿到一部分商品的品牌/重量/商品类型 —— 而这些字段对同一个 ASIN 是稳定的,
 *   没有理由每次重新等。所以: 扫描时读到就存, 下次扫描直接用。
 *
 * 只存"面板/详情页给出的稳定事实", 不存价格(会变) —— 价格每次必须现读。
 * 与 products.json 完全隔离: 选品是"看"的动作, 不该写商品库。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.ZYING_DATA || path.join(require('os').homedir(), '.zying-erp', 'data');
const FILE = path.join(DATA_DIR, 'selection-panel-cache.json');
const TTL_DAYS = 30;                 // 30 天前的面板事实不再复用 (品牌/重量会变, 但很慢)

/** 只缓存稳定字段 */
const FIELDS = ['brand', 'weightG', 'weightRaw', 'sizeRaw', 'variants', 'aplus',
  'ptype', 'seller', 'panelFulfill', 'panelSellerCount', 'listedAt', 'trademark'];

let cache = null;

function load() {
  if (cache) return cache;
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    cache = (raw && typeof raw === 'object' && raw.items) ? raw : { version: 1, items: {} };
  } catch (e) {
    cache = { version: 1, items: {} };
  }
  if (!cache.items) cache.items = {};
  return cache;
}

function save() {
  if (!cache) return;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    // 顺手清理过期项, 避免文件无限增长
    const cutoff = Date.now() - TTL_DAYS * 86400000;
    for (const [asin, v] of Object.entries(cache.items)) {
      if (!v || !v.at || new Date(v.at).getTime() < cutoff) delete cache.items[asin];
    }
    cache.savedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
    fs.writeFileSync(FILE, JSON.stringify(cache), 'utf8');
  } catch (e) { console.warn('[selection-cache] 写盘失败:', e && e.message); }
}

/** 用缓存补全 items 里缺的字段; 返回补了几条 */
function enrich(items) {
  const c = load();
  let filled = 0;
  for (const it of items) {
    const v = it && it.asin ? c.items[it.asin] : null;
    if (!v) continue;
    let touched = false;
    for (const f of FIELDS) {
      if (v[f] == null || v[f] === '') continue;
      if (it[f] == null || it[f] === '') { it[f] = v[f]; touched = true; }
    }
    if (it.amazonSeller == null && v.panelFulfill) { it.amazonSeller = v.panelFulfill === 'AMZ'; touched = true; }
    if (touched) { it.cacheUsed = true; filled++; }
  }
  return filled;
}

/** 把这次读到的面板事实写进缓存; 返回写入条数 */
function remember(items) {
  const c = load();
  let n = 0;
  const at = new Date().toISOString();
  for (const it of items) {
    if (!it || !it.asin) continue;
    const rec = {};
    let has = false;
    for (const f of FIELDS) {
      if (it[f] != null && it[f] !== '') { rec[f] = it[f]; has = true; }
    }
    // 只有真正来自面板/详情页的才算 (hasPanel 或 有品牌/重量)
    if (!has) continue;
    const prev = c.items[it.asin] || {};
    c.items[it.asin] = { ...prev, ...rec, at: prev.at && !it.hasPanel ? prev.at : at };
    n++;
  }
  if (n) save();
  return n;
}

function stats() {
  const c = load();
  return { file: FILE, asins: Object.keys(c.items).length, savedAt: c.savedAt || null, ttlDays: TTL_DAYS };
}

module.exports = { enrich, remember, stats, FILE };

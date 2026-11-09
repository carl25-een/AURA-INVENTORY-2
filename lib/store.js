// lib/store.js — tiny JSON-file data store for AURA Inventory.
// State lives in data/store.json (git-ignored). Writes are atomic
// (temp file + rename) so a crash can't corrupt the store.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'store.json');

// SAMPLE stock only — placeholder demo products so the system can be seen
// working. They are labelled "Sample" and are meant to be replaced with
// AURA's real products in the app.
const SEED_PRODUCTS = [
  { id: 'p001', sku: 'AURA-001', name: 'Sample — Ribbed Knit Midi Dress', category: 'Dresses', price: 6500, cost: 3200, lowStockAt: 2, sizes: { XS: 2, S: 5, M: 6, L: 4, XL: 1 } },
  { id: 'p002', sku: 'AURA-002', name: 'Sample — Oversized Linen Blazer', category: 'Outerwear', price: 8900, cost: 4600, lowStockAt: 2, sizes: { S: 3, M: 4, L: 3 } },
  { id: 'p003', sku: 'AURA-003', name: 'Sample — Satin Slip Skirt', category: 'Bottoms', price: 4200, cost: 1900, lowStockAt: 2, sizes: { XS: 0, S: 2, M: 2, L: 0 } },
  { id: 'p004', sku: 'AURA-004', name: 'Sample — Essential White Tee', category: 'Tops', price: 1800, cost: 750, lowStockAt: 3, sizes: { XS: 10, S: 14, M: 16, L: 12, XL: 8 } },
  { id: 'p005', sku: 'AURA-005', name: 'Sample — Wide-Leg Tailored Trousers', category: 'Bottoms', price: 5400, cost: 2600, lowStockAt: 2, sizes: { S: 4, M: 5, L: 3 } },
  { id: 'p006', sku: 'AURA-006', name: 'Sample — Gold Hoop Earrings', category: 'Accessories', price: 2500, cost: 900, lowStockAt: 5, sizes: { 'One Size': 25 } },
];

let state = null;

function load() {
  if (state) return state;
  try {
    state = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (!Array.isArray(state.products) || !Array.isArray(state.movements)) throw new Error('bad store shape');
  } catch (e) {
    state = {
      products: SEED_PRODUCTS.map((p) => ({ ...p, sizes: { ...p.sizes }, createdAt: new Date().toISOString() })),
      movements: [],
      skuCounter: SEED_PRODUCTS.length,
    };
    save();
  }
  return state;
}

function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, FILE);
}

function uid(prefix) {
  return (prefix || '') + crypto.randomBytes(5).toString('hex');
}

function nextSku() {
  state.skuCounter = (state.skuCounter || 0) + 1;
  return 'AURA-' + String(state.skuCounter).padStart(3, '0');
}

module.exports = { load, save, uid, nextSku };

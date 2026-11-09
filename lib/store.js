// lib/store.js — data layer for AURA Inventory v2.
//
// The store is a single JSON document on disk (data/store.json, on the
// Railway volume in production). It implements the relational schema from
// ARCHITECTURE.md as collections with foreign-key ids. Writes are atomic
// (temp file + rename). A v1 store (products with an embedded sizes map)
// is migrated in place on first load.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'store.json');
const VERSION = 2;

function uid(prefix) {
  return (prefix || '') + crypto.randomBytes(6).toString('hex');
}

function now() {
  return new Date().toISOString();
}

// ---------------------------------------------------------------- seed data
// All seed content is SAMPLE data, labelled as such, to be replaced with
// AURA's real catalogue / suppliers / staff accounts.

const SEED_SUPPLIERS = [
  { id: 'sup1', code: 'SUP-001', name: 'Sample — Nairobi Textile Mills', contactPerson: 'Sample Contact', phone: '+254 700 000 001', email: 'orders@example.co.ke', address: 'Industrial Area, Nairobi', notes: 'Sample supplier — replace with AURA\'s real supplier.', createdAt: '2026-10-15T08:00:00.000Z' },
  { id: 'sup2', code: 'SUP-002', name: 'Sample — Coast Apparel Wholesalers', contactPerson: 'Sample Contact', phone: '+254 700 000 002', email: 'sales@example.co.ke', address: 'Mombasa Road, Nairobi', notes: 'Sample supplier — replace with AURA\'s real supplier.', createdAt: '2026-10-15T08:00:00.000Z' },
];

// Final shelf stock (same levels the v1 system launched with).
const SEED_PRODUCTS = [
  { id: 'p001', sku: 'AURA-001', name: 'Sample — Ribbed Knit Midi Dress', category: 'Dresses', description: 'Sample product — replace with AURA\'s real catalogue.', brand: 'AURA', unit: 'piece', costPrice: 3200, sellingPrice: 6500, supplierId: 'sup1', location: 'Main Store', expiryDate: null, reorderLevel: 2, active: true, createdAt: '2026-10-15T08:00:00.000Z', finalSizes: { XS: 2, S: 5, M: 6, L: 4, XL: 1 } },
  { id: 'p002', sku: 'AURA-002', name: 'Sample — Oversized Linen Blazer', category: 'Outerwear', description: 'Sample product — replace with AURA\'s real catalogue.', brand: 'AURA', unit: 'piece', costPrice: 4600, sellingPrice: 8900, supplierId: 'sup1', location: 'Main Store', expiryDate: null, reorderLevel: 2, active: true, createdAt: '2026-10-15T08:00:00.000Z', finalSizes: { S: 3, M: 4, L: 3 } },
  { id: 'p003', sku: 'AURA-003', name: 'Sample — Satin Slip Skirt', category: 'Bottoms', description: 'Sample product — replace with AURA\'s real catalogue.', brand: 'AURA', unit: 'piece', costPrice: 1900, sellingPrice: 4200, supplierId: 'sup2', location: 'Main Store', expiryDate: null, reorderLevel: 2, active: true, createdAt: '2026-10-15T08:00:00.000Z', finalSizes: { XS: 0, S: 2, M: 2, L: 0 } },
  { id: 'p004', sku: 'AURA-004', name: 'Sample — Essential White Tee', category: 'Tops', description: 'Sample product — replace with AURA\'s real catalogue.', brand: 'AURA', unit: 'piece', costPrice: 750, sellingPrice: 1800, supplierId: 'sup2', location: 'Main Store', expiryDate: null, reorderLevel: 3, active: true, createdAt: '2026-10-15T08:00:00.000Z', finalSizes: { XS: 10, S: 14, M: 16, L: 12, XL: 8 } },
  { id: 'p005', sku: 'AURA-005', name: 'Sample — Wide-Leg Tailored Trousers', category: 'Bottoms', description: 'Sample product — replace with AURA\'s real catalogue.', brand: 'AURA', unit: 'piece', costPrice: 2600, sellingPrice: 5400, supplierId: 'sup1', location: 'Main Store', expiryDate: null, reorderLevel: 2, active: true, createdAt: '2026-10-15T08:00:00.000Z', finalSizes: { S: 4, M: 5, L: 3 } },
  { id: 'p006', sku: 'AURA-006', name: 'Sample — Gold Hoop Earrings', category: 'Accessories', description: 'Sample product — replace with AURA\'s real catalogue.', brand: 'AURA', unit: 'pair', costPrice: 900, sellingPrice: 2500, supplierId: 'sup2', location: 'Main Store', expiryDate: null, reorderLevel: 5, active: true, createdAt: '2026-10-15T08:00:00.000Z', finalSizes: { 'One Size': 25 } },
];

// Sample transactions used to back into opening stock, so the dashboard and
// reports show realistic history. Opening = final − purchases + sales.
const SEED_PURCHASE_ITEMS = [ // 2026-10-28, from sup1
  { productId: 'p005', size: 'S', qty: 2, unitCost: 2600 },
  { productId: 'p005', size: 'M', qty: 2, unitCost: 2600 },
  { productId: 'p005', size: 'L', qty: 2, unitCost: 2600 },
  { productId: 'p003', size: 'S', qty: 2, unitCost: 1900 },
  { productId: 'p003', size: 'M', qty: 2, unitCost: 1900 },
];
const SEED_SALE_ITEMS = [ // split across two sample sales below
  { productId: 'p004', size: 'M', qty: 2 },
  { productId: 'p001', size: 'M', qty: 1 },
  { productId: 'p006', size: 'One Size', qty: 3 },
];

function emptyState() {
  return {
    version: VERSION,
    counters: { sku: 0, supplier: 0, purchase: 0, sale: 0 },
    users: [], suppliers: [], products: [], stock: [],
    purchases: [], purchaseItems: [], sales: [], saleItems: [],
    movements: [], audit: [], sessions: [],
  };
}

function seedState(hashPassword) {
  const s = emptyState();
  s.counters = { sku: SEED_PRODUCTS.length, supplier: SEED_SUPPLIERS.length, purchase: 1, sale: 2 };
  s.suppliers = SEED_SUPPLIERS.map((x) => ({ ...x }));
  s.users = [
    { id: 'u_admin', name: 'AURA Admin (sample)', email: 'admin@aura.local', passwordHash: hashPassword('aura-admin'), role: 'admin', active: true, createdAt: '2026-10-15T08:00:00.000Z' },
    { id: 'u_manager', name: 'AURA Manager (sample)', email: 'manager@aura.local', passwordHash: hashPassword('aura-manager'), role: 'manager', active: true, createdAt: '2026-10-15T08:00:00.000Z' },
    { id: 'u_staff', name: 'AURA Staff (sample)', email: 'staff@aura.local', passwordHash: hashPassword('aura-staff'), role: 'staff', active: true, createdAt: '2026-10-15T08:00:00.000Z' },
  ];

  // Opening stock per (product, size): final − purchased + sold.
  const key = (pid, size) => pid + '|' + size;
  const delta = {};
  SEED_PURCHASE_ITEMS.forEach((i) => { delta[key(i.productId, i.size)] = (delta[key(i.productId, i.size)] || 0) + i.qty; });
  SEED_SALE_ITEMS.forEach((i) => { delta[key(i.productId, i.size)] = (delta[key(i.productId, i.size)] || 0) - i.qty; });

  const balances = {}; // running balance while replaying history
  function applyMovement(date, productId, size, type, qtyDelta, refType, refId) {
    const k = key(productId, size);
    balances[k] = (balances[k] || 0) + qtyDelta;
    s.movements.push({ id: uid('m_'), date, productId, size, type, qtyDelta, balanceAfter: balances[k], refType: refType || null, refId: refId || null, userId: 'u_admin', note: 'Sample transaction' });
  }

  SEED_PRODUCTS.forEach((p) => {
    const { finalSizes, ...prod } = p;
    s.products.push(prod);
    Object.entries(finalSizes).forEach(([size, finalQty]) => {
      const opening = finalQty - (delta[key(p.id, size)] || 0);
      s.stock.push({ productId: p.id, size, qty: finalQty });
      balances[key(p.id, size)] = opening;
      s.movements.push({ id: uid('m_'), date: '2026-10-15T08:00:00.000Z', productId: p.id, size, type: 'initial', qtyDelta: opening, balanceAfter: opening, refType: null, refId: null, userId: 'u_admin', note: 'Opening stock (sample)' });
    });
  });

  // Sample purchase (2026-10-28).
  const poTotal = SEED_PURCHASE_ITEMS.reduce((t, i) => t + i.qty * i.unitCost, 0);
  s.purchases.push({ id: 'po1', ref: 'PO-0001', supplierId: 'sup1', date: '2026-10-28T10:00:00.000Z', paymentStatus: 'paid', total: poTotal, createdBy: 'u_admin', note: 'Sample purchase — restock' });
  SEED_PURCHASE_ITEMS.forEach((i) => {
    s.purchaseItems.push({ id: uid('pi_'), purchaseId: 'po1', ...i });
    applyMovement('2026-10-28T10:00:00.000Z', i.productId, i.size, 'purchase', i.qty, 'purchase', 'po1');
  });

  // Two sample sales (2026-11-02 and 2026-11-06).
  const priceOf = (pid) => SEED_PRODUCTS.find((p) => p.id === pid).sellingPrice;
  const costOf = (pid) => SEED_PRODUCTS.find((p) => p.id === pid).costPrice;
  const saleDefs = [
    { id: 'sa1', ref: 'SALE-0001', date: '2026-11-02T11:30:00.000Z', items: [SEED_SALE_ITEMS[0], SEED_SALE_ITEMS[2]], paymentMethod: 'mpesa', discount: 0, customer: 'Sample Customer' },
    { id: 'sa2', ref: 'SALE-0002', date: '2026-11-06T14:15:00.000Z', items: [SEED_SALE_ITEMS[1]], paymentMethod: 'cash', discount: 0, customer: 'Sample Customer' },
  ];
  saleDefs.forEach((sd) => {
    const total = sd.items.reduce((t, i) => t + i.qty * priceOf(i.productId), 0) - sd.discount;
    s.sales.push({ id: sd.id, ref: sd.ref, date: sd.date, customer: sd.customer, discount: sd.discount, total, paymentMethod: sd.paymentMethod, createdBy: 'u_staff' });
    sd.items.forEach((i) => {
      s.saleItems.push({ id: uid('si_'), saleId: sd.id, productId: i.productId, size: i.size, qty: i.qty, unitPrice: priceOf(i.productId), unitCost: costOf(i.productId) });
      applyMovement(sd.date, i.productId, i.size, 'sale', -i.qty, 'sale', sd.id);
    });
  });

  s.audit.push({ id: uid('a_'), date: now(), userId: 'system', action: 'seed', entity: 'system', entityId: null, detail: 'Sample data seeded (v2). Replace sample users, suppliers and products with AURA\'s real ones.' });
  return s;
}

// ------------------------------------------------------------- v1 migration
function migrateV1(old, hashPassword) {
  const s = seedState(hashPassword); // reuse seed users/suppliers; replace catalogue
  s.products = [];
  s.stock = [];
  s.movements = [];
  s.purchases = []; s.purchaseItems = []; s.sales = []; s.saleItems = [];
  s.counters = { sku: 0, supplier: SEED_SUPPLIERS.length, purchase: 0, sale: 0 };
  (old.products || []).forEach((p) => {
    const m = String(p.sku || '').match(/(\d+)$/);
    if (m) s.counters.sku = Math.max(s.counters.sku, Number(m[1]));
    s.products.push({
      id: p.id, sku: p.sku, name: p.name, category: p.category || 'General',
      description: p.description || '', brand: p.brand || 'AURA', unit: p.unit || 'piece',
      costPrice: p.cost != null ? p.cost : (p.costPrice || 0),
      sellingPrice: p.price != null ? p.price : (p.sellingPrice || 0),
      supplierId: p.supplierId || null, location: p.location || 'Main Store',
      expiryDate: p.expiryDate || null, reorderLevel: p.lowStockAt != null ? p.lowStockAt : 2,
      active: true, createdAt: p.createdAt || now(),
    });
    Object.entries(p.sizes || {}).forEach(([size, qty]) => {
      s.stock.push({ productId: p.id, size, qty: Number(qty) || 0 });
      s.movements.push({ id: uid('m_'), date: p.createdAt || now(), productId: p.id, size, type: 'initial', qtyDelta: Number(qty) || 0, balanceAfter: Number(qty) || 0, refType: null, refId: null, userId: 'u_admin', note: 'Migrated from v1 stock levels' });
    });
  });
  s.audit.push({ id: uid('a_'), date: now(), userId: 'system', action: 'migrate', entity: 'system', entityId: null, detail: 'Store migrated from v1 to v2; existing products and stock levels preserved.' });
  return s;
}

// ------------------------------------------------------------------- store
let state = null;
let hashPasswordFn = null;

function setHasher(fn) { hashPasswordFn = fn; }

function load() {
  if (state) return state;
  let raw = null;
  try { raw = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { raw = null; }
  if (raw && raw.version === VERSION && Array.isArray(raw.products)) {
    state = raw;
  } else if (raw && Array.isArray(raw.products) && raw.products.length && raw.products[0].sizes) {
    if (!hashPasswordFn) throw new Error('store: hasher not set before migration');
    state = migrateV1(raw, hashPasswordFn);
    save();
  } else {
    if (!hashPasswordFn) throw new Error('store: hasher not set before seed');
    state = seedState(hashPasswordFn);
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

function nextRef(kind) {
  state.counters[kind] = (state.counters[kind] || 0) + 1;
  const n = String(state.counters[kind]).padStart(4, '0');
  if (kind === 'sku') return 'AURA-' + String(state.counters.sku).padStart(3, '0');
  if (kind === 'supplier') return 'SUP-' + String(state.counters.supplier).padStart(3, '0');
  if (kind === 'purchase') return 'PO-' + n;
  if (kind === 'sale') return 'SALE-' + n;
  return n;
}

module.exports = { load, save, uid, nextRef, setHasher, DATA_DIR, FILE };

// lib/inventory.js — stock domain logic for AURA Inventory v2.
//
// Stock lives in state.stock rows (productId, size, qty). Every change goes
// through applyMovement(), which validates the no-negative-stock rule and
// appends to the append-only movements ledger with the acting user.

const store = require('./store');

const SIZES = ['XS', 'S', 'M', 'L', 'XL'];
const ONE_SIZE = 'One Size';
const CATEGORIES = ['Dresses', 'Tops', 'Bottoms', 'Outerwear', 'Accessories'];
const MOVEMENT_TYPES = ['initial', 'purchase', 'sale', 'return_in', 'return_out', 'damaged', 'adjustment'];

function stockRow(state, productId, size) {
  return state.stock.find((r) => r.productId === productId && r.size === size) || null;
}

function getQty(state, productId, size) {
  const r = stockRow(state, productId, size);
  return r ? r.qty : 0;
}

function stockMap(state, productId) {
  const out = {};
  state.stock.filter((r) => r.productId === productId).forEach((r) => { out[r.size] = r.qty; });
  return out;
}

function totalUnits(state, productId) {
  return state.stock.filter((r) => r.productId === productId).reduce((s, r) => s + r.qty, 0);
}

function supplierName(state, supplierId) {
  const s = state.suppliers.find((x) => x.id === supplierId);
  return s ? s.name : null;
}

function productView(state, p) {
  const sizes = stockMap(state, p.id);
  const units = Object.values(sizes).reduce((s, q) => s + q, 0);
  return {
    ...p,
    sizes,
    totalUnits: units,
    stockValueCost: units * (p.costPrice || 0),
    stockValueRetail: units * (p.sellingPrice || 0),
    supplierName: supplierName(state, p.supplierId),
  };
}

// Apply a signed stock change. Throws (with .status 400) if it would drive
// stock negative. Writes the movement ledger entry and returns it.
function applyMovement(state, { productId, size, delta, type, user, refType, refId, note, date }) {
  const product = state.products.find((p) => p.id === productId);
  if (!product) { const e = new Error('Product not found'); e.status = 404; throw e; }
  if (!MOVEMENT_TYPES.includes(type)) { const e = new Error('Unknown movement type: ' + type); e.status = 400; throw e; }
  let row = stockRow(state, productId, size);
  const current = row ? row.qty : 0;
  const next = current + delta;
  if (next < 0) {
    const e = new Error('Not enough stock: ' + product.name + ' (' + size + ') has ' + current + ' available.');
    e.status = 400;
    throw e;
  }
  if (!row) { row = { productId, size, qty: 0 }; state.stock.push(row); }
  row.qty = next;
  const movement = {
    id: store.uid('m_'),
    date: date || new Date().toISOString(),
    productId, size, type,
    qtyDelta: delta,
    balanceAfter: next,
    refType: refType || null,
    refId: refId || null,
    userId: user ? user.id : 'system',
    userName: user ? user.name : 'system',
    note: note || '',
  };
  state.movements.push(movement);
  return movement;
}

function movementView(state, m) {
  const p = state.products.find((x) => x.id === m.productId);
  return { ...m, productName: p ? p.name : '(deleted product)', sku: p ? p.sku : '' };
}

// ------------------------------------------------------------------ alerts
function computeAlerts(state, nowDate) {
  const nowMs = (nowDate || new Date()).getTime();
  const in30 = nowMs + 30 * 24 * 60 * 60 * 1000;
  const low = [];
  const out = [];
  state.products.filter((p) => p.active).forEach((p) => {
    const sizes = stockMap(state, p.id);
    Object.entries(sizes).forEach(([size, qty]) => {
      if (qty === 0) out.push({ productId: p.id, sku: p.sku, name: p.name, size, qty, threshold: p.reorderLevel });
      else if (qty <= p.reorderLevel) low.push({ productId: p.id, sku: p.sku, name: p.name, size, qty, threshold: p.reorderLevel });
    });
  });
  const expiringSoon = [];
  const expired = [];
  state.products.filter((p) => p.active && p.expiryDate).forEach((p) => {
    const t = new Date(p.expiryDate + 'T23:59:59').getTime();
    const entry = { productId: p.id, sku: p.sku, name: p.name, expiryDate: p.expiryDate };
    if (t < nowMs) expired.push(entry);
    else if (t <= in30) expiringSoon.push(entry);
  });
  // Unusual adjustments: one user adjusting >= 10 units (abs) of one
  // product-size in a single day.
  const buckets = {};
  state.movements.filter((m) => m.type === 'adjustment').forEach((m) => {
    const day = String(m.date).slice(0, 10);
    const k = day + '|' + m.userId + '|' + m.productId + '|' + m.size;
    buckets[k] = buckets[k] || { date: day, userId: m.userId, userName: m.userName || '', productId: m.productId, size: m.size, total: 0 };
    buckets[k].total += Math.abs(m.qtyDelta);
  });
  const unusual = Object.values(buckets).filter((b) => b.total >= 10).map((b) => {
    const p = state.products.find((x) => x.id === b.productId);
    return { ...b, name: p ? p.name : '', sku: p ? p.sku : '' };
  });
  return { low, out, expiringSoon, expired, unusual, counts: { low: low.length, out: out.length, expiringSoon: expiringSoon.length, expired: expired.length, unusual: unusual.length } };
}

// --------------------------------------------------------------- dashboard
function monthKey(iso) { return String(iso || '').slice(0, 7); }

function computeDashboard(state) {
  const views = state.products.filter((p) => p.active).map((p) => productView(state, p));
  const unitsTotal = views.reduce((s, v) => s + v.totalUnits, 0);
  const retailValue = views.reduce((s, v) => s + v.stockValueRetail, 0);
  const costValue = views.reduce((s, v) => s + v.stockValueCost, 0);
  const totalPurchases = state.purchases.reduce((s, x) => s + (x.total || 0), 0);
  const totalSales = state.sales.reduce((s, x) => s + (x.total || 0), 0);
  const alerts = computeAlerts(state);

  const byCategory = {};
  views.forEach((v) => {
    byCategory[v.category] = byCategory[v.category] || { category: v.category, units: 0, value: 0 };
    byCategory[v.category].units += v.totalUnits;
    byCategory[v.category].value += v.stockValueRetail;
  });

  // Last 6 months of purchases vs sales (by document date).
  const months = [];
  const cursor = new Date();
  cursor.setDate(1);
  for (let i = 5; i >= 0; i--) {
    const d = new Date(cursor.getFullYear(), cursor.getMonth() - i, 1);
    months.push(d.toISOString().slice(0, 7));
  }
  const flow = months.map((mk) => ({
    month: mk,
    purchases: state.purchases.filter((x) => monthKey(x.date) === mk).reduce((s, x) => s + x.total, 0),
    sales: state.sales.filter((x) => monthKey(x.date) === mk).reduce((s, x) => s + x.total, 0),
  }));

  const recentMovements = state.movements.slice(-10).reverse().map((m) => movementView(state, m));

  return {
    productCount: views.length,
    totalUnits: unitsTotal,
    retailValue,
    costValue,
    lowStock: alerts.low,
    outOfStock: alerts.out,
    outOfStockCount: state.products.filter((p) => p.active && totalUnits(state, p.id) === 0).length,
    totalPurchases,
    totalSales,
    purchaseCount: state.purchases.length,
    saleCount: state.sales.length,
    supplierCount: state.suppliers.length,
    recentMovements,
    charts: {
      valueByCategory: Object.values(byCategory).sort((a, b) => b.value - a.value),
      flow,
    },
    alertCounts: alerts.counts,
  };
}

// Supplier balance helpers -------------------------------------------------
function supplierStats(state, supplierId) {
  const list = state.purchases.filter((x) => x.supplierId === supplierId);
  const totalBought = list.reduce((s, x) => s + x.total, 0);
  const outstanding = list.filter((x) => x.paymentStatus !== 'paid').reduce((s, x) => s + x.total, 0);
  return { purchaseCount: list.length, totalBought, outstanding };
}

module.exports = {
  SIZES, ONE_SIZE, CATEGORIES, MOVEMENT_TYPES,
  stockRow, getQty, stockMap, totalUnits, productView,
  applyMovement, movementView, computeAlerts, computeDashboard, supplierStats,
};

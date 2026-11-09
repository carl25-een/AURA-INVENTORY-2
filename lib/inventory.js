// lib/inventory.js — stock maths for AURA Inventory.

const SIZES = ['XS', 'S', 'M', 'L', 'XL'];
const ONE_SIZE = 'One Size';
const CATEGORIES = ['Dresses', 'Tops', 'Bottoms', 'Outerwear', 'Accessories'];

function totalUnits(product) {
  return Object.values(product.sizes || {}).reduce((s, q) => s + (Number(q) || 0), 0);
}

function productView(p) {
  const units = totalUnits(p);
  return {
    ...p,
    totalUnits: units,
    retailValue: units * (p.price || 0),
    costValue: units * (p.cost || 0),
  };
}

// Sizes at or below the product's low-stock threshold (and any size at 0
// that the product normally carries).
function lowStockEntries(products) {
  const out = [];
  products.forEach((p) => {
    const threshold = p.lowStockAt != null ? p.lowStockAt : 2;
    Object.entries(p.sizes || {}).forEach(([size, qty]) => {
      if (qty <= threshold) out.push({ productId: p.id, sku: p.sku, name: p.name, size, qty, threshold });
    });
  });
  return out.sort((a, b) => a.qty - b.qty);
}

function computeStats(store) {
  const products = store.products || [];
  const views = products.map(productView);
  return {
    productCount: products.length,
    totalUnits: views.reduce((s, v) => s + v.totalUnits, 0),
    retailValue: views.reduce((s, v) => s + v.retailValue, 0),
    costValue: views.reduce((s, v) => s + v.costValue, 0),
    lowStock: lowStockEntries(products),
    outOfStockCount: products.filter((p) => totalUnits(p) === 0).length,
  };
}

module.exports = { SIZES, ONE_SIZE, CATEGORIES, totalUnits, productView, lowStockEntries, computeStats };

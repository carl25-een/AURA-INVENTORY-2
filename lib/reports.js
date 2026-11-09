// lib/reports.js — report builders for AURA Inventory v2.
//
// Every builder returns { title, columns, rows, summary } so the same data
// drives the on-screen table, the CSV export (Excel-compatible) and the
// print view (Save as PDF). Date filters compare the document date.

const inv = require('./inventory');

function inRange(iso, from, to) {
  const day = String(iso || '').slice(0, 10);
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

function money(n) { return Math.round((Number(n) || 0) * 100) / 100; }

function productName(state, id) {
  const p = state.products.find((x) => x.id === id);
  return p ? p.name : '(deleted product)';
}
function productSku(state, id) {
  const p = state.products.find((x) => x.id === id);
  return p ? p.sku : '';
}
function supplierName(state, id) {
  const s = state.suppliers.find((x) => x.id === id);
  return s ? s.name : '';
}
function userName(state, id) {
  const u = state.users.find((x) => x.id === id);
  return u ? u.name : (id || '');
}

const BUILDERS = {
  inventory(state) {
    const rows = state.products.map((p) => {
      const v = inv.productView(state, p);
      return [p.sku, p.name, p.category, p.brand || '', v.totalUnits, money(p.costPrice), money(p.sellingPrice), money(v.stockValueCost), money(v.stockValueRetail), v.supplierName || '', p.location || '', p.active ? 'Active' : 'Inactive'];
    }).sort((a, b) => String(a[1]).localeCompare(String(b[1])));
    return { title: 'Current Inventory', columns: ['SKU', 'Product', 'Category', 'Brand', 'Units', 'Cost Price', 'Selling Price', 'Stock Value (cost)', 'Stock Value (retail)', 'Supplier', 'Location', 'Status'], rows };
  },

  movements(state, { from, to }) {
    const rows = state.movements
      .filter((m) => inRange(m.date, from, to))
      .map((m) => [String(m.date).slice(0, 10), productSku(state, m.productId), productName(state, m.productId), m.size, m.type, m.qtyDelta, m.balanceAfter, m.userName || userName(state, m.userId), m.note || ''])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    return { title: 'Stock Movement Report', columns: ['Date', 'SKU', 'Product', 'Size', 'Type', 'Qty Δ', 'Balance After', 'User', 'Note'], rows };
  },

  purchases(state, { from, to }) {
    const rows = state.purchases
      .filter((x) => inRange(x.date, from, to))
      .map((x) => [x.ref, String(x.date).slice(0, 10), supplierName(state, x.supplierId), state.purchaseItems.filter((i) => i.purchaseId === x.id).reduce((s, i) => s + i.qty, 0), money(x.total), x.paymentStatus, userName(state, x.createdBy)])
      .sort((a, b) => String(a[1]).localeCompare(String(b[1])));
    const total = rows.reduce((s, r) => s + r[4], 0);
    return { title: 'Purchases Report', columns: ['Ref', 'Date', 'Supplier', 'Units', 'Total (KSh)', 'Payment', 'Recorded By'], rows, summary: [['Total purchases', money(total)]] };
  },

  sales(state, { from, to }) {
    const rows = state.sales
      .filter((x) => inRange(x.date, from, to))
      .map((x) => [x.ref, String(x.date).slice(0, 10), x.customer || 'Walk-in', state.saleItems.filter((i) => i.saleId === x.id).reduce((s, i) => s + i.qty, 0), money(x.discount || 0), money(x.total), x.paymentMethod, userName(state, x.createdBy)])
      .sort((a, b) => String(a[1]).localeCompare(String(b[1])));
    const total = rows.reduce((s, r) => s + r[5], 0);
    return { title: 'Sales Report', columns: ['Ref', 'Date', 'Customer', 'Units', 'Discount (KSh)', 'Total (KSh)', 'Payment', 'Recorded By'], rows, summary: [['Total sales', money(total)]] };
  },

  valuation(state) {
    const views = state.products.map((p) => inv.productView(state, p));
    const rows = views.map((v) => [v.sku, v.name, v.totalUnits, money(v.costPrice), money(v.stockValueCost), money(v.sellingPrice), money(v.stockValueRetail), money(v.stockValueRetail - v.stockValueCost)])
      .sort((a, b) => b[4] - a[4]);
    const cost = views.reduce((s, v) => s + v.stockValueCost, 0);
    const retail = views.reduce((s, v) => s + v.stockValueRetail, 0);
    return { title: 'Inventory Valuation', columns: ['SKU', 'Product', 'Units', 'Cost Price', 'Value at Cost', 'Selling Price', 'Value at Retail', 'Potential Margin'], rows, summary: [['Total value at cost', money(cost)], ['Total value at retail', money(retail)], ['Potential margin', money(retail - cost)]] };
  },

  profit(state, { from, to }) {
    const items = state.saleItems.filter((i) => {
      const sale = state.sales.find((x) => x.id === i.saleId);
      return sale && inRange(sale.date, from, to);
    });
    const revenue = items.reduce((s, i) => s + i.qty * i.unitPrice, 0);
    const discounts = state.sales.filter((x) => inRange(x.date, from, to)).reduce((s, x) => s + (x.discount || 0), 0);
    const cogs = items.reduce((s, i) => s + i.qty * i.unitCost, 0);
    const byProduct = {};
    items.forEach((i) => {
      byProduct[i.productId] = byProduct[i.productId] || { qty: 0, revenue: 0, cogs: 0 };
      byProduct[i.productId].qty += i.qty;
      byProduct[i.productId].revenue += i.qty * i.unitPrice;
      byProduct[i.productId].cogs += i.qty * i.unitCost;
    });
    const rows = Object.entries(byProduct).map(([pid, v]) => [productSku(state, pid), productName(state, pid), v.qty, money(v.revenue), money(v.cogs), money(v.revenue - v.cogs)])
      .sort((a, b) => b[5] - a[5]);
    const grossProfit = revenue - discounts - cogs;
    return {
      title: 'Cost of Goods Sold & Gross Profit', columns: ['SKU', 'Product', 'Units Sold', 'Revenue (KSh)', 'COGS (KSh)', 'Gross Profit (KSh)'], rows,
      summary: [['Revenue (before discounts)', money(revenue)], ['Discounts', money(discounts)], ['COGS', money(cogs)], ['Gross profit', money(grossProfit)]],
    };
  },

  damaged(state, { from, to }) {
    const rows = state.movements
      .filter((m) => (m.type === 'damaged') && inRange(m.date, from, to))
      .map((m) => {
        const p = state.products.find((x) => x.id === m.productId);
        return [String(m.date).slice(0, 10), productSku(state, m.productId), productName(state, m.productId), m.size, Math.abs(m.qtyDelta), money((p ? p.costPrice : 0) * Math.abs(m.qtyDelta)), m.userName || userName(state, m.userId), m.note || ''];
      });
    const expiredProducts = state.products.filter((p) => p.expiryDate && new Date(p.expiryDate + 'T23:59:59').getTime() < Date.now())
      .map((p) => ['—', p.sku, p.name, 'all', inv.totalUnits(state, p.id), money(p.costPrice * inv.totalUnits(state, p.id)), '', 'Expired ' + p.expiryDate]);
    return { title: 'Damaged & Expired Stock', columns: ['Date', 'SKU', 'Product', 'Size', 'Units Lost', 'Value Lost at Cost (KSh)', 'User', 'Note'], rows: rows.concat(expiredProducts) };
  },

  suppliers(state) {
    const rows = state.suppliers.map((s) => {
      const st = inv.supplierStats(state, s.id);
      const supplied = state.products.filter((p) => p.supplierId === s.id).length;
      return [s.code, s.name, s.contactPerson || '', s.phone || '', supplied, st.purchaseCount, money(st.totalBought), money(st.outstanding)];
    });
    return { title: 'Supplier Performance', columns: ['Code', 'Supplier', 'Contact', 'Phone', 'Products Supplied', 'Purchases', 'Total Bought (KSh)', 'Outstanding (KSh)'], rows };
  },
};

const REPORT_TYPES = Object.keys(BUILDERS);

function buildReport(state, type, filters) {
  const b = BUILDERS[type];
  if (!b) return null;
  const r = b(state, filters || {});
  return { type, title: r.title, columns: r.columns, rows: r.rows, summary: r.summary || [] };
}

function toCSV(report) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [report.title];
  lines.push(report.columns.map(esc).join(','));
  report.rows.forEach((r) => lines.push(r.map(esc).join(',')));
  (report.summary || []).forEach(([k, v]) => lines.push(esc(k) + ',' + esc(v)));
  return lines.join('\r\n');
}

module.exports = { buildReport, toCSV, REPORT_TYPES };

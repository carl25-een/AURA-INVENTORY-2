// server.js — AURA Inventory v2 server.
// Zero-dependency Node.js (built-in http module only). Run: node server.js
//
// API overview (all JSON, session-cookie auth):
//   POST /api/login · POST /api/logout · GET /api/me · POST /api/change-password
//   GET  /api/dashboard · GET /api/alerts · GET /api/stats (v1 compat)
//   CRUD /api/products (+ POST /api/products/:id/adjust)
//   CRUD /api/suppliers
//   GET/POST /api/purchases · GET /api/purchases/:id · POST /api/purchases/:id/payment
//   GET/POST /api/sales · GET /api/sales/:id
//   GET  /api/movements · GET /api/reports/:type · GET /api/reports/:type/csv
//   CRUD /api/users (admin) · GET /api/audit (admin/manager) · GET /api/backup (admin)

const http = require('http');
const fs = require('fs');
const path = require('path');
const storeLib = require('./lib/store');
const auth = require('./lib/auth');
const inv = require('./lib/inventory');
const reports = require('./lib/reports');

storeLib.setHasher(auth.hashPassword);
const state = storeLib.load();
const save = storeLib.save;

// ---- tiny .env loader (no dependency) ----
try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split('\n').forEach((line) => {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/i);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    });
  }
} catch (e) { /* .env is optional */ }

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------- helpers ----------
function send(res, code, body, type, headers) {
  if (res.headersSent) { try { res.end(); } catch (e) { /* already gone */ } return; }
  const isJson = !type || type === 'application/json';
  const data = isJson ? JSON.stringify(body) : body;
  res.writeHead(code, Object.assign({ 'Content-Type': type || 'application/json' }, headers || {}));
  res.end(data);
}
function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch (e) { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
const str = (v, d) => (typeof v === 'string' && v.trim() ? v.trim() : (d || ''));
const int = (v, d) => Math.floor(num(v, d));

function fail(res, code, msg) { return send(res, code, { error: msg }); }
function requireRole(res, user, roles) {
  if (roles.includes(user.role)) return true;
  fail(res, 403, 'Your role (' + user.role + ') cannot do this.');
  return false;
}

function setSessionCookie(req, res, token, expiresAt) {
  const secure = (req.headers['x-forwarded-proto'] || '').includes('https');
  const maxAge = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
  res.setHeader('Set-Cookie', 'aura_session=' + encodeURIComponent(token) + '; HttpOnly; Path=/; SameSite=Lax; Max-Age=' + maxAge + (secure ? '; Secure' : ''));
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'aura_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0');
}

function validDateOrNull(v) {
  if (!v) return null;
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}
function docDate(v) {
  const d = validDateOrNull(v);
  return d ? new Date(d + 'T12:00:00.000Z').toISOString() : new Date().toISOString();
}

// Product payload validation shared by create/update.
function readProductFields(body, base) {
  const out = Object.assign({}, base || {});
  if (body.name !== undefined) out.name = str(body.name);
  if (body.category !== undefined) out.category = str(body.category, out.category || 'General');
  if (body.description !== undefined) out.description = str(body.description);
  if (body.brand !== undefined) out.brand = str(body.brand);
  if (body.unit !== undefined) out.unit = str(body.unit, 'piece');
  if (body.costPrice !== undefined) out.costPrice = Math.max(0, num(body.costPrice, 0));
  if (body.sellingPrice !== undefined) out.sellingPrice = Math.max(0, num(body.sellingPrice, 0));
  if (body.supplierId !== undefined) out.supplierId = body.supplierId || null;
  if (body.location !== undefined) out.location = str(body.location);
  if (body.expiryDate !== undefined) out.expiryDate = validDateOrNull(body.expiryDate);
  if (body.reorderLevel !== undefined) out.reorderLevel = Math.max(0, int(body.reorderLevel, 2));
  if (body.active !== undefined) out.active = Boolean(body.active);
  return out;
}

// ---------- server ----------
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  const method = req.method;
  const q = Object.fromEntries(url.searchParams.entries());

  try {
    // ----- public -----
    if (p === '/api/config' && method === 'GET') {
      return send(res, 200, { name: 'AURA Inventory', version: 2, categories: inv.CATEGORIES, sizes: [...inv.SIZES, inv.ONE_SIZE] });
    }
    if (p === '/api/login' && method === 'POST') {
      const body = await readBody(req);
      const user = auth.findByEmail(state, body.email);
      if (!user || !user.active || !auth.verifyPassword(body.password || '', user.passwordHash)) {
        return fail(res, 401, 'Invalid email or password');
      }
      const s = auth.createSession(state, user.id);
      auth.audit(state, user, 'login', 'user', user.id, 'Signed in');
      save();
      setSessionCookie(req, res, s.token, s.expiresAt);
      return send(res, 200, { user: auth.publicUser(user) });
    }

    if (p.startsWith('/api/')) {
      const user = auth.currentUser(state, req);
      if (!user) return fail(res, 401, 'Please sign in');

      if (p === '/api/logout' && method === 'POST') {
        const cookies = req.headers.cookie || '';
        const m = cookies.match(/aura_session=([^;]+)/);
        if (m) auth.destroySession(state, decodeURIComponent(m[1]));
        auth.audit(state, user, 'logout', 'user', user.id, 'Signed out');
        save();
        clearSessionCookie(res);
        return send(res, 200, { ok: true });
      }
      if (p === '/api/me' && method === 'GET') return send(res, 200, { user: auth.publicUser(user) });
      if (p === '/api/change-password' && method === 'POST') {
        const body = await readBody(req);
        if (!auth.verifyPassword(body.currentPassword || '', user.passwordHash)) return fail(res, 400, 'Current password is wrong');
        if (!body.newPassword || String(body.newPassword).length < 6) return fail(res, 400, 'New password must be at least 6 characters');
        user.passwordHash = auth.hashPassword(body.newPassword);
        auth.audit(state, user, 'change_password', 'user', user.id, 'Password changed');
        save();
        return send(res, 200, { ok: true });
      }

      // ----- dashboard / alerts / stats -----
      if (p === '/api/dashboard' && method === 'GET') return send(res, 200, inv.computeDashboard(state));
      if (p === '/api/alerts' && method === 'GET') return send(res, 200, inv.computeAlerts(state));
      if (p === '/api/stats' && method === 'GET') {
        const d = inv.computeDashboard(state);
        return send(res, 200, { productCount: d.productCount, totalUnits: d.totalUnits, retailValue: d.retailValue, costValue: d.costValue, lowStock: d.lowStock, outOfStockCount: d.outOfStockCount });
      }

      // ----- products -----
      if (p === '/api/products' && method === 'GET') {
        let list = state.products.map((x) => inv.productView(state, x));
        if (q.q) {
          const needle = q.q.toLowerCase();
          list = list.filter((x) => x.name.toLowerCase().includes(needle) || x.sku.toLowerCase().includes(needle));
        }
        if (q.category) list = list.filter((x) => x.category === q.category);
        if (q.supplierId) list = list.filter((x) => x.supplierId === q.supplierId);
        if (q.stock === 'out') list = list.filter((x) => x.totalUnits === 0);
        if (q.stock === 'low') list = list.filter((x) => Object.entries(x.sizes).some(([s, qty]) => qty > 0 && qty <= x.reorderLevel));
        if (q.active === 'true') list = list.filter((x) => x.active);
        return send(res, 200, { products: list });
      }
      if (p === '/api/products' && method === 'POST') {
        const body = await readBody(req);
        const fields = readProductFields(body, { active: true });
        if (!fields.name) return fail(res, 400, 'Give the product a name');
        if (fields.supplierId && !state.suppliers.some((s) => s.id === fields.supplierId)) return fail(res, 400, 'Unknown supplier');
        const product = Object.assign({ id: storeLib.uid('p_'), sku: storeLib.nextRef('sku'), createdAt: new Date().toISOString() }, fields);
        state.products.push(product);
        const sizes = (body.sizes && typeof body.sizes === 'object') ? body.sizes : {};
        Object.entries(sizes).forEach(([size, qty]) => {
          const n = Math.max(0, int(qty, 0));
          state.stock.push({ productId: product.id, size, qty: 0 });
          if (n > 0) inv.applyMovement(state, { productId: product.id, size, delta: n, type: 'initial', user, note: 'Opening stock on product creation' });
          else { const row = inv.stockRow(state, product.id, size); if (row) row.qty = 0; }
        });
        auth.audit(state, user, 'create', 'product', product.id, product.sku + ' ' + product.name);
        save();
        return send(res, 201, inv.productView(state, product));
      }
      const prodMatch = p.match(/^\/api\/products\/([\w-]+)$/);
      if (prodMatch && method === 'GET') {
        const product = state.products.find((x) => x.id === prodMatch[1]);
        if (!product) return fail(res, 404, 'Product not found');
        return send(res, 200, inv.productView(state, product));
      }
      if (prodMatch && method === 'PUT') {
        const product = state.products.find((x) => x.id === prodMatch[1]);
        if (!product) return fail(res, 404, 'Product not found');
        const body = await readBody(req);
        const fields = readProductFields(body, product);
        if (!fields.name) return fail(res, 400, 'Give the product a name');
        if (fields.supplierId && !state.suppliers.some((s) => s.id === fields.supplierId)) return fail(res, 400, 'Unknown supplier');
        Object.assign(product, fields);
        auth.audit(state, user, 'update', 'product', product.id, product.sku + ' ' + product.name);
        save();
        return send(res, 200, inv.productView(state, product));
      }
      if (prodMatch && method === 'DELETE') {
        if (!requireRole(res, user, ['admin', 'manager'])) return;
        const idx = state.products.findIndex((x) => x.id === prodMatch[1]);
        if (idx < 0) return fail(res, 404, 'Product not found');
        const product = state.products[idx];
        if (inv.totalUnits(state, product.id) > 0) return fail(res, 400, 'This product still has stock. Deactivate it instead of deleting.');
        const hasHistory = state.purchaseItems.some((i) => i.productId === product.id) || state.saleItems.some((i) => i.productId === product.id);
        if (hasHistory) return fail(res, 400, 'This product appears in past purchases/sales. Deactivate it instead of deleting.');
        state.products.splice(idx, 1);
        state.stock = state.stock.filter((r) => r.productId !== product.id);
        auth.audit(state, user, 'delete', 'product', product.id, product.sku + ' ' + product.name);
        save();
        return send(res, 200, { ok: true });
      }
      const adjMatch = p.match(/^\/api\/products\/([\w-]+)\/adjust$/);
      if (adjMatch && method === 'POST') {
        const product = state.products.find((x) => x.id === adjMatch[1]);
        if (!product) return fail(res, 404, 'Product not found');
        const body = await readBody(req);
        const size = str(body.size);
        if (!size) return fail(res, 400, 'Choose a size');
        const kind = ['adjustment', 'damaged', 'return_in', 'return_out'].includes(body.kind) ? body.kind : 'adjustment';
        const delta = int(body.delta, 0);
        if (!delta) return fail(res, 400, 'Enter a quantity (positive or negative)');
        if (kind === 'damaged' || kind === 'return_out') { if (delta > 0) return fail(res, 400, 'Damaged / returned-out quantities remove stock — enter a negative amount or use the quick buttons.'); }
        if (kind === 'return_in' && delta < 0) return fail(res, 400, 'A return-in adds stock — enter a positive amount.');
        try {
          inv.applyMovement(state, { productId: product.id, size, delta, type: kind, user, note: str(body.note) });
        } catch (e) { return fail(res, e.status || 400, e.message); }
        auth.audit(state, user, 'stock_' + kind, 'product', product.id, product.sku + ' ' + size + ' ' + (delta > 0 ? '+' : '') + delta);
        save();
        return send(res, 200, inv.productView(state, product));
      }

      // ----- suppliers -----
      if (p === '/api/suppliers' && method === 'GET') {
        return send(res, 200, { suppliers: state.suppliers.map((s) => Object.assign({}, s, inv.supplierStats(state, s.id), { productsSupplied: state.products.filter((x) => x.supplierId === s.id).length })) });
      }
      if (p === '/api/suppliers' && method === 'POST') {
        const body = await readBody(req);
        const name = str(body.name);
        if (!name) return fail(res, 400, 'Give the supplier a name');
        const supplier = { id: storeLib.uid('sup_'), code: storeLib.nextRef('supplier'), name, contactPerson: str(body.contactPerson), phone: str(body.phone), email: str(body.email), address: str(body.address), notes: str(body.notes), createdAt: new Date().toISOString() };
        state.suppliers.push(supplier);
        auth.audit(state, user, 'create', 'supplier', supplier.id, supplier.code + ' ' + name);
        save();
        return send(res, 201, supplier);
      }
      const supMatch = p.match(/^\/api\/suppliers\/([\w-]+)$/);
      if (supMatch && method === 'PUT') {
        const supplier = state.suppliers.find((x) => x.id === supMatch[1]);
        if (!supplier) return fail(res, 404, 'Supplier not found');
        const body = await readBody(req);
        ['name', 'contactPerson', 'phone', 'email', 'address', 'notes'].forEach((k) => { if (body[k] !== undefined) supplier[k] = str(body[k]); });
        if (!supplier.name) return fail(res, 400, 'Give the supplier a name');
        auth.audit(state, user, 'update', 'supplier', supplier.id, supplier.code + ' ' + supplier.name);
        save();
        return send(res, 200, supplier);
      }
      if (supMatch && method === 'DELETE') {
        if (!requireRole(res, user, ['admin', 'manager'])) return;
        const idx = state.suppliers.findIndex((x) => x.id === supMatch[1]);
        if (idx < 0) return fail(res, 404, 'Supplier not found');
        if (state.purchases.some((x) => x.supplierId === supMatch[1])) return fail(res, 400, 'This supplier has purchase history and cannot be deleted.');
        state.products.forEach((x) => { if (x.supplierId === supMatch[1]) x.supplierId = null; });
        const removed = state.suppliers.splice(idx, 1)[0];
        auth.audit(state, user, 'delete', 'supplier', removed.id, removed.code + ' ' + removed.name);
        save();
        return send(res, 200, { ok: true });
      }

      // ----- purchases -----
      if (p === '/api/purchases' && method === 'GET') {
        const list = state.purchases.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).map((x) => Object.assign({}, x, { supplierName: (state.suppliers.find((s) => s.id === x.supplierId) || {}).name || '', units: state.purchaseItems.filter((i) => i.purchaseId === x.id).reduce((s, i) => s + i.qty, 0) }));
        return send(res, 200, { purchases: list });
      }
      if (p === '/api/purchases' && method === 'POST') {
        const body = await readBody(req);
        const supplier = state.suppliers.find((s) => s.id === body.supplierId);
        if (!supplier) return fail(res, 400, 'Choose a supplier');
        const items = Array.isArray(body.items) ? body.items : [];
        if (!items.length) return fail(res, 400, 'Add at least one product line');
        const checked = [];
        for (const it of items) {
          const product = state.products.find((x) => x.id === it.productId);
          if (!product) return fail(res, 400, 'One of the products no longer exists');
          const qty = int(it.qty, 0);
          if (qty <= 0) return fail(res, 400, 'Quantities must be at least 1 (' + product.name + ')');
          const size = str(it.size);
          if (!size) return fail(res, 400, 'Choose a size for ' + product.name);
          const unitCost = Math.max(0, num(it.unitCost, product.costPrice));
          checked.push({ product, size, qty, unitCost });
        }
        const purchase = { id: storeLib.uid('po_'), ref: storeLib.nextRef('purchase'), supplierId: supplier.id, date: docDate(body.date), paymentStatus: ['paid', 'partial', 'unpaid'].includes(body.paymentStatus) ? body.paymentStatus : 'unpaid', total: checked.reduce((s, i) => s + i.qty * i.unitCost, 0), createdBy: user.id, note: str(body.note) };
        state.purchases.push(purchase);
        checked.forEach((i) => {
          state.purchaseItems.push({ id: storeLib.uid('pi_'), purchaseId: purchase.id, productId: i.product.id, size: i.size, qty: i.qty, unitCost: i.unitCost });
          inv.applyMovement(state, { productId: i.product.id, size: i.size, delta: i.qty, type: 'purchase', user, refType: 'purchase', refId: purchase.id, note: 'Purchase ' + purchase.ref, date: purchase.date });
        });
        auth.audit(state, user, 'create', 'purchase', purchase.id, purchase.ref + ' · ' + supplier.name + ' · KSh ' + purchase.total);
        save();
        return send(res, 201, purchase);
      }
      const poMatch = p.match(/^\/api\/purchases\/([\w-]+)$/);
      if (poMatch && method === 'GET') {
        const purchase = state.purchases.find((x) => x.id === poMatch[1]);
        if (!purchase) return fail(res, 404, 'Purchase not found');
        const items = state.purchaseItems.filter((i) => i.purchaseId === purchase.id).map((i) => { const pr = state.products.find((x) => x.id === i.productId); return Object.assign({}, i, { productName: pr ? pr.name : '(deleted)', sku: pr ? pr.sku : '', lineTotal: i.qty * i.unitCost }); });
        return send(res, 200, Object.assign({}, purchase, { supplierName: (state.suppliers.find((s) => s.id === purchase.supplierId) || {}).name || '', items }));
      }
      const poPay = p.match(/^\/api\/purchases\/([\w-]+)\/payment$/);
      if (poPay && method === 'POST') {
        const purchase = state.purchases.find((x) => x.id === poPay[1]);
        if (!purchase) return fail(res, 404, 'Purchase not found');
        const body = await readBody(req);
        if (!['paid', 'partial', 'unpaid'].includes(body.paymentStatus)) return fail(res, 400, 'Payment status must be paid, partial or unpaid');
        purchase.paymentStatus = body.paymentStatus;
        auth.audit(state, user, 'payment', 'purchase', purchase.id, purchase.ref + ' → ' + body.paymentStatus);
        save();
        return send(res, 200, purchase);
      }

      // ----- sales -----
      if (p === '/api/sales' && method === 'GET') {
        const list = state.sales.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).map((x) => Object.assign({}, x, { units: state.saleItems.filter((i) => i.saleId === x.id).reduce((s, i) => s + i.qty, 0) }));
        return send(res, 200, { sales: list });
      }
      if (p === '/api/sales' && method === 'POST') {
        const body = await readBody(req);
        const items = Array.isArray(body.items) ? body.items : [];
        if (!items.length) return fail(res, 400, 'Add at least one product line');
        // Aggregate demand per product+size and validate stock BEFORE writing.
        const demand = {};
        const checked = [];
        for (const it of items) {
          const product = state.products.find((x) => x.id === it.productId);
          if (!product) return fail(res, 400, 'One of the products no longer exists');
          const qty = int(it.qty, 0);
          if (qty <= 0) return fail(res, 400, 'Quantities must be at least 1 (' + product.name + ')');
          const size = str(it.size);
          if (!size) return fail(res, 400, 'Choose a size for ' + product.name);
          const unitPrice = Math.max(0, num(it.unitPrice, product.sellingPrice));
          const k = product.id + '|' + size;
          demand[k] = (demand[k] || 0) + qty;
          if (demand[k] > inv.getQty(state, product.id, size)) return fail(res, 400, 'Not enough stock: ' + product.name + ' (' + size + ') has ' + inv.getQty(state, product.id, size) + ' available.');
          checked.push({ product, size, qty, unitPrice });
        }
        const subtotal = checked.reduce((s, i) => s + i.qty * i.unitPrice, 0);
        const discount = Math.min(Math.max(0, num(body.discount, 0)), subtotal);
        const sale = { id: storeLib.uid('sa_'), ref: storeLib.nextRef('sale'), date: docDate(body.date), customer: str(body.customer), discount, total: subtotal - discount, paymentMethod: ['cash', 'mpesa', 'card', 'bank'].includes(body.paymentMethod) ? body.paymentMethod : 'cash', createdBy: user.id };
        state.sales.push(sale);
        checked.forEach((i) => {
          state.saleItems.push({ id: storeLib.uid('si_'), saleId: sale.id, productId: i.product.id, size: i.size, qty: i.qty, unitPrice: i.unitPrice, unitCost: i.product.costPrice });
          inv.applyMovement(state, { productId: i.product.id, size: i.size, delta: -i.qty, type: 'sale', user, refType: 'sale', refId: sale.id, note: 'Sale ' + sale.ref, date: sale.date });
        });
        auth.audit(state, user, 'create', 'sale', sale.id, sale.ref + ' · KSh ' + sale.total);
        save();
        return send(res, 201, sale);
      }
      const saleMatch = p.match(/^\/api\/sales\/([\w-]+)$/);
      if (saleMatch && method === 'GET') {
        const sale = state.sales.find((x) => x.id === saleMatch[1]);
        if (!sale) return fail(res, 404, 'Sale not found');
        const items = state.saleItems.filter((i) => i.saleId === sale.id).map((i) => { const pr = state.products.find((x) => x.id === i.productId); return Object.assign({}, i, { productName: pr ? pr.name : '(deleted)', sku: pr ? pr.sku : '', lineTotal: i.qty * i.unitPrice }); });
        return send(res, 200, Object.assign({}, sale, { items }));
      }

      // ----- movements -----
      if (p === '/api/movements' && method === 'GET') {
        let list = state.movements.slice().reverse();
        if (q.productId) list = list.filter((m) => m.productId === q.productId);
        if (q.type) list = list.filter((m) => m.type === q.type);
        if (q.from) list = list.filter((m) => String(m.date).slice(0, 10) >= q.from);
        if (q.to) list = list.filter((m) => String(m.date).slice(0, 10) <= q.to);
        return send(res, 200, { movements: list.slice(0, 300).map((m) => inv.movementView(state, m)) });
      }

      // ----- reports -----
      const repCsv = p.match(/^\/api\/reports\/([\w-]+)\/csv$/);
      if (repCsv && method === 'GET') {
        if (['profit', 'valuation'].includes(repCsv[1]) && !requireRole(res, user, ['admin', 'manager'])) return;
        const report = reports.buildReport(state, repCsv[1], { from: q.from, to: q.to });
        if (!report) return fail(res, 404, 'Unknown report');
        return send(res, 200, reports.toCSV(report), 'text/csv', { 'Content-Disposition': 'attachment; filename="aura-' + repCsv[1] + '-report.csv"' });
      }
      const repMatch = p.match(/^\/api\/reports\/([\w-]+)$/);
      if (repMatch && method === 'GET') {
        if (['profit', 'valuation'].includes(repMatch[1]) && !requireRole(res, user, ['admin', 'manager'])) return;
        const report = reports.buildReport(state, repMatch[1], { from: q.from, to: q.to });
        if (!report) return fail(res, 404, 'Unknown report');
        return send(res, 200, report);
      }

      // ----- users (admin) -----
      if (p === '/api/users' && method === 'GET') {
        if (!requireRole(res, user, ['admin'])) return;
        return send(res, 200, { users: state.users.map(auth.publicUser) });
      }
      if (p === '/api/users' && method === 'POST') {
        if (!requireRole(res, user, ['admin'])) return;
        const body = await readBody(req);
        const name = str(body.name);
        const email = str(body.email).toLowerCase();
        if (!name || !email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail(res, 400, 'A name and a valid email are required');
        if (!body.password || String(body.password).length < 6) return fail(res, 400, 'Password must be at least 6 characters');
        if (auth.findByEmail(state, email)) return fail(res, 400, 'A user with that email already exists');
        const role = auth.ROLES.includes(body.role) ? body.role : 'staff';
        const created = { id: storeLib.uid('u_'), name, email, passwordHash: auth.hashPassword(body.password), role, active: true, createdAt: new Date().toISOString() };
        state.users.push(created);
        auth.audit(state, user, 'create', 'user', created.id, name + ' (' + role + ')');
        save();
        return send(res, 201, auth.publicUser(created));
      }
      const userMatch = p.match(/^\/api\/users\/([\w-]+)$/);
      if (userMatch && method === 'PUT') {
        if (!requireRole(res, user, ['admin'])) return;
        const target = state.users.find((x) => x.id === userMatch[1]);
        if (!target) return fail(res, 404, 'User not found');
        const body = await readBody(req);
        if (body.name !== undefined) target.name = str(body.name, target.name);
        if (body.role !== undefined && auth.ROLES.includes(body.role)) target.role = body.role;
        if (body.active !== undefined) {
          if (target.id === user.id && body.active === false) return fail(res, 400, 'You cannot deactivate your own account');
          target.active = Boolean(body.active);
        }
        if (body.password) {
          if (String(body.password).length < 6) return fail(res, 400, 'Password must be at least 6 characters');
          target.passwordHash = auth.hashPassword(body.password);
        }
        auth.audit(state, user, 'update', 'user', target.id, target.name + ' (' + target.role + ')');
        save();
        return send(res, 200, auth.publicUser(target));
      }

      // ----- audit + backup -----
      if (p === '/api/audit' && method === 'GET') {
        if (!requireRole(res, user, ['admin', 'manager'])) return;
        return send(res, 200, { audit: state.audit.slice(-300).reverse() });
      }
      if (p === '/api/backup' && method === 'GET') {
        if (!requireRole(res, user, ['admin'])) return;
        auth.audit(state, user, 'backup', 'system', null, 'Backup downloaded');
        save();
        return send(res, 200, state, 'application/json', { 'Content-Disposition': 'attachment; filename="aura-inventory-backup.json"' });
      }

      return fail(res, 404, 'Not found');
    }

    // ----- static (single-page app) -----
    let filePath = path.join(PUBLIC_DIR, p === '/' ? 'index.html' : p);
    if (!filePath.startsWith(PUBLIC_DIR)) return send(res, 403, 'Forbidden', 'text/plain');
    fs.readFile(filePath, (err, data) => {
      if (err) {
        fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, html) => {
          if (e2) return send(res, 500, 'Server error', 'text/plain');
          send(res, 200, html.toString(), 'text/html');
        });
        return;
      }
      send(res, 200, data.toString(), MIME[path.extname(filePath)] || 'application/octet-stream');
    });
  } catch (e) {
    if (e && e.status) return fail(res, e.status, e.message);
    console.error(e);
    send(res, 500, { error: 'Server error' });
  }
});

server.listen(PORT, () => {
  console.log('AURA Inventory v2 running at http://localhost:' + PORT);
});

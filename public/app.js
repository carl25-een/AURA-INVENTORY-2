// public/app.js — AURA Inventory v2 single-page app (vanilla JS, no build step).

const root = document.getElementById('root');
const modalRoot = document.getElementById('modalRoot');
const toastRoot = document.getElementById('toastRoot');
document.body.insertAdjacentHTML('beforeend', '<div id="printArea"></div>');
const printArea = document.getElementById('printArea');

let me = null;
let config = { categories: [], sizes: ['XS', 'S', 'M', 'L', 'XL', 'One Size'] };
let productsCache = [];
let suppliersCache = [];
let view = 'dashboard';
let alertTotal = 0;

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => 'KSh ' + Number(n || 0).toLocaleString('en-US');
const day = (iso) => String(iso || '').slice(0, 10);
const cap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* non-JSON */ }
  if (!res.ok) throw new Error((data && data.error) || ('Request failed (' + res.status + ')'));
  return data;
}

function toast(msg, isErr) {
  const t = document.createElement('div');
  t.className = 'toast' + (isErr ? ' err' : '');
  t.textContent = msg;
  toastRoot.appendChild(t);
  setTimeout(() => t.remove(), 4200);
}
function die(e) { toast(e.message || 'Something went wrong', true); }

function openModal(html, wide) {
  modalRoot.innerHTML = '<div class="modalback"><div class="modal' + (wide ? ' wide' : '') + '">' + html + '</div></div>';
  modalRoot.querySelector('.modalback').addEventListener('click', (ev) => { if (ev.target.classList.contains('modalback')) closeModal(); });
}
function closeModal() { modalRoot.innerHTML = ''; }
function confirmDialog(title, text, okLabel) {
  return new Promise((resolve) => {
    openModal('<h2>' + esc(title) + '</h2><p>' + esc(text) + '</p><div class="btnrow" style="margin-top:1rem"><button class="btn danger" id="cfOk">' + esc(okLabel || 'Confirm') + '</button><button class="btn secondary" id="cfCancel">Cancel</button></div>');
    document.getElementById('cfOk').onclick = () => { closeModal(); resolve(true); };
    document.getElementById('cfCancel').onclick = () => { closeModal(); resolve(false); };
  });
}

// --------------------------------------------------------------------- boot
async function boot() {
  try { config = await api('/api/config'); } catch (e) { /* defaults fine */ }
  try {
    const r = await api('/api/me');
    me = r.user;
    renderApp();
  } catch (e) {
    renderLogin();
  }
}

function renderLogin(errMsg) {
  root.innerHTML =
    '<div class="loginwrap"><form class="logincard" id="loginForm">' +
    '<p class="wordmark">AURA</p><p class="loginsub">Inventory Management</p>' +
    (errMsg ? '<p class="pill bad" style="display:block;text-align:center">' + esc(errMsg) + '</p>' : '') +
    '<label>Email</label><input type="email" id="liEmail" required autocomplete="username" placeholder="you@aura.local" />' +
    '<label>Password</label><input type="password" id="liPass" required autocomplete="current-password" />' +
    '<div style="margin-top:1.1rem"><button class="btn block" type="submit">Sign in</button></div>' +
    '<div class="demoaccounts"><strong>Sample accounts</strong> (change these passwords after signing in):<br/>' +
    'Admin — <code>admin@aura.local</code> / <code>aura-admin</code><br/>' +
    'Manager — <code>manager@aura.local</code> / <code>aura-manager</code><br/>' +
    'Staff — <code>staff@aura.local</code> / <code>aura-staff</code></div>' +
    '</form></div>';
  document.getElementById('loginForm').onsubmit = async (ev) => {
    ev.preventDefault();
    try {
      const r = await api('/api/login', { method: 'POST', body: { email: document.getElementById('liEmail').value, password: document.getElementById('liPass').value } });
      me = r.user;
      renderApp();
    } catch (e) { renderLogin(e.message); }
  };
}

const NAV = [
  ['dashboard', ' Dashboard'],
  ['products', ' Products'],
  ['stock', ' Stock'],
  ['purchases', ' Purchases'],
  ['sales', ' Sales'],
  ['suppliers', ' Suppliers'],
  ['alerts', ' Alerts'],
  ['reports', ' Reports'],
  ['users', ' Users'],
  ['audit', ' Audit Log'],
  ['account', '⚙️ Account'],
];
function navVisible(key) {
  if (key === 'users') return me && me.role === 'admin';
  if (key === 'audit') return me && (me.role === 'admin' || me.role === 'manager');
  return true;
}

function renderApp() {
  const navHtml = NAV.filter(([k]) => navVisible(k)).map(([k, label]) =>
    '<button class="navitem' + (view === k ? ' on' : '') + '" data-nav="' + k + '">' + label +
    (k === 'alerts' && alertTotal ? '<span class="badge">' + alertTotal + '</span>' : '') + '</button>').join('');
  root.innerHTML =
    '<div class="layout">' +
    '<aside class="sidebar" id="sidebar"><p class="wordmark">AURA</p><div class="sidebarsub">Inventory</div>' + navHtml +
    '<div class="spacer"></div><div class="userbox"><div>' + esc(me.name) + '</div><div class="role">' + esc(me.role) + ' · ' + esc(me.email) + '</div>' +
    '<div class="btnrow" style="margin-top:.5rem"><button class="btn small secondary" id="logoutBtn">Sign out</button></div></div></aside>' +
    '<div class="maincol"><div class="topbar"><button class="btn small secondary menubtn" id="menuBtn">☰</button><h1 id="viewTitle"></h1><div class="spacer"></div><span class="muted small" id="topDate"></span></div>' +
    '<div class="demobanner">Sample data — demo products, suppliers and accounts so you can see the system working. Replace them with AURA\'s real ones in the app.</div>' +
    '<main id="viewRoot"></main></div></div>';
  document.querySelectorAll('[data-nav]').forEach((b) => { b.onclick = () => { view = b.dataset.nav; document.getElementById('sidebar').classList.remove('open'); renderApp(); }; });
  document.getElementById('menuBtn').onclick = () => document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('logoutBtn').onclick = async () => { try { await api('/api/logout', { method: 'POST' }); } catch (e) { /* ignore */ } me = null; renderLogin(); };
  document.getElementById('topDate').textContent = new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const titles = Object.fromEntries(NAV);
  document.getElementById('viewTitle').textContent = titles[view] ? titles[view].replace(/^\S+\s/, '') : '';
  refreshAlertsBadge();
  const fn = VIEWS[view] || VIEWS.dashboard;
  fn(document.getElementById('viewRoot'));
}

async function refreshAlertsBadge() {
  try {
    const a = await api('/api/alerts');
    alertTotal = a.counts.low + a.counts.out + a.counts.expired + a.counts.expiringSoon + a.counts.unusual;
    const b = document.querySelector('[data-nav="alerts"]');
    if (b) {
      const existing = b.querySelector('.badge');
      if (alertTotal && !existing) b.insertAdjacentHTML('beforeend', '<span class="badge">' + alertTotal + '</span>');
      if (alertTotal && existing) existing.textContent = alertTotal;
      if (!alertTotal && existing) existing.remove();
    }
  } catch (e) { /* non-fatal */ }
}

async function loadCaches() {
  const [pr, sr] = await Promise.all([api('/api/products?active=true'), api('/api/suppliers')]);
  productsCache = pr.products;
  suppliersCache = sr.suppliers;
}
function productOptions(selected) {
  return productsCache.map((p) => '<option value="' + p.id + '"' + (p.id === selected ? ' selected' : '') + '>' + esc(p.sku + ' — ' + p.name) + '</option>').join('');
}
function sizeOptions(product, selected) {
  const sizes = product ? Object.keys(product.sizes || {}) : config.sizes;
  const list = sizes.length ? sizes : config.sizes;
  return list.map((s) => '<option value="' + esc(s) + '"' + (s === selected ? ' selected' : '') + '>' + esc(s) + '</option>').join('');
}
function sizePills(p) {
  return Object.entries(p.sizes || {}).map(([size, qty]) => {
    const cls = qty === 0 ? ' out' : (qty <= p.reorderLevel ? ' low' : '');
    return '<span class="sizepill' + cls + '"><span class="sz">' + esc(size) + '</span><span class="qt">' + qty + '</span></span>';
  }).join('') || '<span class="muted small">No sizes</span>';
}

// --------------------------------------------------------------------- charts
function barChartSVG(items, color) {
  // items: [{label, value}] — horizontal labelled bars
  const max = Math.max(1, ...items.map((i) => i.value));
  const rows = items.map((i) => {
    const w = Math.round((i.value / max) * 100);
    return '<div style="display:grid;grid-template-columns:110px 1fr 90px;gap:.5rem;align-items:center;margin:.3rem 0"><span class="small">' + esc(i.label) + '</span><span style="background:' + color + ';height:14px;border-radius:4px;width:' + w + '%"></span><span class="small right">' + fmt(i.value) + '</span></div>';
  }).join('');
  return rows || '<p class="muted">No data yet.</p>';
}
function flowChartSVG(flow) {
  const W = 640, H = 220, base = 190, max = Math.max(1, ...flow.flatMap((f) => [f.purchases, f.sales]));
  const bw = 22, gap = (W - 40) / flow.length;
  let bars = '';
  flow.forEach((f, i) => {
    const x = 30 + i * gap;
    const ph = Math.round((f.purchases / max) * 150);
    const sh = Math.round((f.sales / max) * 150);
    bars += '<rect x="' + x + '" y="' + (base - ph) + '" width="' + bw + '" height="' + ph + '" rx="3" fill="#b08d57"></rect>';
    bars += '<rect x="' + (x + bw + 4) + '" y="' + (base - sh) + '" width="' + bw + '" height="' + sh + '" rx="3" fill="#1c1b1a"></rect>';
    bars += '<text x="' + (x + bw) + '" y="' + (base + 16) + '" font-size="10" text-anchor="middle" fill="#8a8378">' + esc(f.month.slice(2)) + '</text>';
  });
  return '<div class="chartbox"><svg viewBox="0 0 ' + W + ' ' + H + '"><line x1="20" y1="' + base + '" x2="' + (W - 10) + '" y2="' + base + '" stroke="#e6dfd2"/>' + bars + '</svg></div>' +
    '<div class="legend"><span><span class="sw" style="background:#b08d57"></span>Purchases</span><span><span class="sw" style="background:#1c1b1a"></span>Sales</span></div>';
}

// --------------------------------------------------------------------- views
const VIEWS = {};

// ---- Dashboard ----
VIEWS.dashboard = async (el) => {
  el.innerHTML = '<p class="muted">Loading dashboard…</p>';
  try {
    const d = await api('/api/dashboard');
    const stat = (num, lbl, cls) => '<div class="stat' + (cls || '') + '"><div class="num">' + num + '</div><div class="lbl">' + lbl + '</div></div>';
    el.innerHTML =
      '<div class="stats">' +
      stat(d.productCount, 'Products') +
      stat(d.totalUnits.toLocaleString(), 'Units in stock') +
      stat(fmt(d.retailValue), 'Inventory value (retail)') +
      stat(fmt(d.costValue), 'Inventory value (cost)') +
      stat(d.lowStock.length, 'Low-stock sizes', d.lowStock.length ? ' alert' : '') +
      stat(d.outOfStock.length, 'Out-of-stock sizes', d.outOfStock.length ? ' alert' : '') +
      stat(fmt(d.totalPurchases), 'Total purchases') +
      stat(fmt(d.totalSales), 'Total sales') +
      '</div>' +
      '<div class="grid2"><div class="card"><h3>Stock value by category</h3>' + barChartSVG(d.charts.valueByCategory.map((c) => ({ label: c.category, value: c.value })), '#b08d57') + '</div>' +
      '<div class="card"><h3>Purchases vs sales — last 6 months</h3>' + flowChartSVG(d.charts.flow) + '</div></div>' +
      '<div class="grid2"><div class="card"><h3>⚠️ Needs attention</h3>' +
      (d.lowStock.concat(d.outOfStock).slice(0, 8).map((x) => '<div class="row" style="justify-content:space-between;padding:.3rem 0;border-bottom:1px solid var(--line)"><span>' + esc(x.name) + ' <span class="muted">(' + esc(x.size) + ')</span></span><span class="pill ' + (x.qty === 0 ? 'bad' : 'warn') + '">' + (x.qty === 0 ? 'Out of stock' : x.qty + ' left') + '</span></div>').join('') || '<p class="muted">Nothing low or out of stock. 🎉</p>') +
      '</div>' +
      '<div class="card"><h3>Recent stock movements</h3><div class="tablewrap"><table class="tbl"><tr><th>Date</th><th>Product</th><th>Type</th><th class="right">Change</th></tr>' +
      d.recentMovements.map((m) => '<tr><td class="nowrap">' + day(m.date) + '</td><td>' + esc(m.productName) + ' <span class="muted">(' + esc(m.size) + ')</span></td><td>' + esc(m.type) + '</td><td class="right ' + (m.qtyDelta >= 0 ? 'delta-pos' : 'delta-neg') + '">' + (m.qtyDelta > 0 ? '+' : '') + m.qtyDelta + '</td></tr>').join('') +
      '</table></div></div></div>';
  } catch (e) { el.innerHTML = '<p class="pill bad">' + esc(e.message) + '</p>'; }
};

// ---- Products ----
let prodFilters = { q: '', category: '', stock: '' };
VIEWS.products = async (el) => {
  el.innerHTML =
    '<div class="toolbar"><div class="grow"><label>Search</label><input id="pfQ" placeholder="Name or SKU…" value="' + esc(prodFilters.q) + '"/></div>' +
    '<div><label>Category</label><select id="pfCat"><option value="">All categories</option>' + config.categories.map((c) => '<option' + (prodFilters.category === c ? ' selected' : '') + '>' + c + '</option>').join('') + '</select></div>' +
    '<div><label>Stock</label><select id="pfStock"><option value="">Any</option><option value="low"' + (prodFilters.stock === 'low' ? ' selected' : '') + '>Low stock</option><option value="out"' + (prodFilters.stock === 'out' ? ' selected' : '') + '>Out of stock</option></select></div>' +
    '<button class="btn" id="pfNew">+ Add product</button></div>' +
    '<div id="prodList"><p class="muted">Loading…</p></div>';
  const reload = async () => {
    const qs = new URLSearchParams();
    if (prodFilters.q) qs.set('q', prodFilters.q);
    if (prodFilters.category) qs.set('category', prodFilters.category);
    if (prodFilters.stock) qs.set('stock', prodFilters.stock);
    try {
      const r = await api('/api/products?' + qs.toString());
      productsCache = r.products;
      document.getElementById('prodList').innerHTML = renderProductTable(r.products);
      wireProductButtons(el);
    } catch (e) { die(e); }
  };
  document.getElementById('pfQ').oninput = (ev) => { prodFilters.q = ev.target.value; reload(); };
  document.getElementById('pfCat').onchange = (ev) => { prodFilters.category = ev.target.value; reload(); };
  document.getElementById('pfStock').onchange = (ev) => { prodFilters.stock = ev.target.value; reload(); };
  document.getElementById('pfNew').onclick = () => productForm(null, reload);
  reload();
};

function renderProductTable(list) {
  if (!list.length) return '<div class="card"><p class="muted">No products match. Add one with “+ Add product”.</p></div>';
  return '<div class="card"><div class="tablewrap"><table class="tbl"><tr><th>Product</th><th>Category</th><th>Sizes in stock</th><th class="right">Units</th><th class="right">Cost</th><th class="right">Price</th><th class="right">Value (retail)</th><th></th></tr>' +
    list.map((p) => '<tr' + (p.active ? '' : ' style="opacity:.55"') + '><td><strong>' + esc(p.name) + '</strong><br/><span class="muted small">' + esc(p.sku) + (p.brand ? ' · ' + esc(p.brand) : '') + (p.supplierName ? ' · ' + esc(p.supplierName) : '') + (p.active ? '' : ' · inactive') + '</span></td>' +
      '<td>' + esc(p.category) + '</td><td>' + sizePills(p) + '</td><td class="right">' + p.totalUnits + '</td><td class="right">' + fmt(p.costPrice) + '</td><td class="right">' + fmt(p.sellingPrice) + '</td><td class="right">' + fmt(p.stockValueRetail) + '</td>' +
      '<td class="nowrap"><button class="btn small secondary" data-adjust="' + p.id + '">Adjust stock</button> <button class="btn small ghost" data-edit="' + p.id + '">Edit</button></td></tr>').join('') +
    '</table></div></div>';
}
function wireProductButtons(el) {
  el.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => { const p = productsCache.find((x) => x.id === b.dataset.edit); productForm(p, () => VIEWS.products(el)); }; });
  el.querySelectorAll('[data-adjust]').forEach((b) => { b.onclick = () => { const p = productsCache.find((x) => x.id === b.dataset.adjust); adjustForm(p, () => VIEWS.products(el)); }; });
}

function productForm(p, done) {
  const isNew = !p;
  p = p || { name: '', category: 'Dresses', description: '', brand: 'AURA', unit: 'piece', costPrice: '', sellingPrice: '', supplierId: '', location: 'Main Store', expiryDate: '', reorderLevel: 2, active: true, sizes: {} };
  const sizeInputs = isNew ? '<h3 style="margin-top:1rem">Opening stock by size</h3><div class="formgrid">' + config.sizes.map((s) => '<div><label>' + esc(s) + '</label><input type="number" min="0" step="1" data-size="' + esc(s) + '" value="0"/></div>').join('') + '</div>' : '';
  openModal(
    '<button class="btn small ghost x" onclick="void(0)" id="mClose">✕</button><h2>' + (isNew ? 'Add product' : 'Edit product') + '</h2>' +
    '<div class="formgrid">' +
    '<div><label>Product name *</label><input id="pName" value="' + esc(p.name) + '"/></div>' +
    '<div><label>Category</label><input id="pCat" list="catList" value="' + esc(p.category) + '"/><datalist id="catList">' + config.categories.map((c) => '<option value="' + c + '">').join('') + '</datalist></div>' +
    '<div><label>Brand</label><input id="pBrand" value="' + esc(p.brand || '') + '"/></div>' +
    '<div><label>Unit of measurement</label><input id="pUnit" value="' + esc(p.unit || 'piece') + '"/></div>' +
    '<div><label>Cost price (KSh)</label><input id="pCost" type="number" min="0" step="0.01" value="' + esc(p.costPrice) + '"/></div>' +
    '<div><label>Selling price (KSh)</label><input id="pPrice" type="number" min="0" step="0.01" value="' + esc(p.sellingPrice) + '"/></div>' +
    '<div><label>Supplier</label><select id="pSupplier"><option value="">— none —</option>' + suppliersCache.map((s) => '<option value="' + s.id + '"' + (p.supplierId === s.id ? ' selected' : '') + '>' + esc(s.name) + '</option>').join('') + '</select></div>' +
    '<div><label>Storage location</label><input id="pLoc" value="' + esc(p.location || '') + '"/></div>' +
    '<div><label>Expiry date (if applicable)</label><input id="pExpiry" type="date" value="' + esc(p.expiryDate || '') + '"/></div>' +
    '<div><label>Reorder level (per size)</label><input id="pReorder" type="number" min="0" step="1" value="' + esc(p.reorderLevel) + '"/></div>' +
    '</div>' +
    '<label>Description</label><textarea id="pDesc" rows="2">' + esc(p.description || '') + '</textarea>' +
    sizeInputs +
    (isNew ? '' : '<label style="margin-top:.8rem"><input type="checkbox" id="pActive" style="width:auto" ' + (p.active ? 'checked' : '') + ' /> Active (visible in sales &amp; stock)</label>') +
    '<div class="btnrow" style="margin-top:1.1rem"><button class="btn" id="pSave">' + (isNew ? 'Add product' : 'Save changes') + '</button>' +
    (isNew ? '' : '<button class="btn danger" id="pDelete">Delete</button>') +
    '<button class="btn secondary" id="pCancel">Cancel</button></div>'
  );
  if (!suppliersCache.length) { loadCaches().then(() => {}).catch(() => {}); }
  document.getElementById('mClose').onclick = closeModal;
  document.getElementById('pCancel').onclick = closeModal;
  document.getElementById('pSave').onclick = async () => {
    const body = {
      name: document.getElementById('pName').value, category: document.getElementById('pCat').value,
      brand: document.getElementById('pBrand').value, unit: document.getElementById('pUnit').value,
      costPrice: Number(document.getElementById('pCost').value || 0), sellingPrice: Number(document.getElementById('pPrice').value || 0),
      supplierId: document.getElementById('pSupplier').value || null, location: document.getElementById('pLoc').value,
      expiryDate: document.getElementById('pExpiry').value || null, reorderLevel: Number(document.getElementById('pReorder').value || 0),
      description: document.getElementById('pDesc').value,
    };
    if (!isNew) body.active = document.getElementById('pActive').checked;
    if (isNew) {
      body.sizes = {};
      document.querySelectorAll('[data-size]').forEach((inp) => { body.sizes[inp.dataset.size] = Number(inp.value || 0); });
    }
    try {
      await api(isNew ? '/api/products' : '/api/products/' + p.id, { method: isNew ? 'POST' : 'PUT', body });
      closeModal(); toast(isNew ? 'Product added' : 'Product saved'); done();
    } catch (e) { die(e); }
  };
  const del = document.getElementById('pDelete');
  if (del) del.onclick = async () => {
    if (!(await confirmDialog('Delete product?', 'Delete "' + p.name + '" permanently? Products with stock or sales/purchase history can\'t be deleted — deactivate instead.', 'Delete'))) return;
    try { await api('/api/products/' + p.id, { method: 'DELETE' }); closeModal(); toast('Product deleted'); done(); } catch (e) { die(e); }
  };
}

function adjustForm(p, done) {
  openModal(
    '<button class="btn small ghost x" id="mClose">✕</button><h2>Adjust stock</h2>' +
    '<p class="muted small">' + esc(p.sku) + ' — ' + esc(p.name) + '</p>' + sizePills(p) +
    '<div class="formgrid"><div><label>Size</label><select id="aSize">' + sizeOptions(p) + '</select></div>' +
    '<div><label>Type</label><select id="aKind"><option value="adjustment">Adjustment (correction)</option><option value="return_in">Return in (customer return)</option><option value="return_out">Return out (back to supplier)</option><option value="damaged">Damaged stock</option></select></div>' +
    '<div><label>Quantity change (+ adds, − removes)</label><input id="aDelta" type="number" step="1" value="1"/></div>' +
    '<div><label>Note</label><input id="aNote" placeholder="Reason for the change"/></div></div>' +
    '<div class="btnrow" style="margin-top:1rem"><button class="btn" id="aSave">Apply adjustment</button><button class="btn secondary" id="aCancel">Cancel</button></div>'
  );
  document.getElementById('mClose').onclick = closeModal;
  document.getElementById('aCancel').onclick = closeModal;
  document.getElementById('aSave').onclick = async () => {
    try {
      await api('/api/products/' + p.id + '/adjust', { method: 'POST', body: { size: document.getElementById('aSize').value, kind: document.getElementById('aKind').value, delta: Number(document.getElementById('aDelta').value || 0), note: document.getElementById('aNote').value } });
      closeModal(); toast('Stock updated'); refreshAlertsBadge(); done();
    } catch (e) { die(e); }
  };
}

// ---- Stock (movement ledger) ----
let mvFilters = { type: '', from: '', to: '' };
VIEWS.stock = async (el) => {
  el.innerHTML =
    '<div class="toolbar"><div><label>Movement type</label><select id="mvType"><option value="">All types</option>' +
    ['initial', 'purchase', 'sale', 'return_in', 'return_out', 'damaged', 'adjustment'].map((t) => '<option value="' + t + '"' + (mvFilters.type === t ? ' selected' : '') + '>' + t + '</option>').join('') + '</select></div>' +
    '<div><label>From</label><input type="date" id="mvFrom" value="' + mvFilters.from + '"/></div>' +
    '<div><label>To</label><input type="date" id="mvTo" value="' + mvFilters.to + '"/></div></div>' +
    '<div class="card"><h3>Stock movement history</h3><div id="mvList"><p class="muted">Loading…</p></div></div>';
  const reload = async () => {
    const qs = new URLSearchParams();
    if (mvFilters.type) qs.set('type', mvFilters.type);
    if (mvFilters.from) qs.set('from', mvFilters.from);
    if (mvFilters.to) qs.set('to', mvFilters.to);
    try {
      const r = await api('/api/movements?' + qs.toString());
      document.getElementById('mvList').innerHTML = r.movements.length ?
        '<div class="tablewrap"><table class="tbl"><tr><th>Date</th><th>Product</th><th>Size</th><th>Type</th><th class="right">Change</th><th class="right">Balance</th><th>User</th><th>Note</th></tr>' +
        r.movements.map((m) => '<tr><td class="nowrap">' + day(m.date) + '</td><td>' + esc(m.productName) + '<br/><span class="muted small">' + esc(m.sku) + '</span></td><td>' + esc(m.size) + '</td><td><span class="pill grey">' + esc(m.type) + '</span></td><td class="right ' + (m.qtyDelta >= 0 ? 'delta-pos' : 'delta-neg') + '">' + (m.qtyDelta > 0 ? '+' : '') + m.qtyDelta + '</td><td class="right">' + m.balanceAfter + '</td><td>' + esc(m.userName || '') + '</td><td class="small">' + esc(m.note || '') + '</td></tr>').join('') + '</table></div>'
        : '<p class="muted">No movements match.</p>';
    } catch (e) { die(e); }
  };
  document.getElementById('mvType').onchange = (ev) => { mvFilters.type = ev.target.value; reload(); };
  document.getElementById('mvFrom').onchange = (ev) => { mvFilters.from = ev.target.value; reload(); };
  document.getElementById('mvTo').onchange = (ev) => { mvFilters.to = ev.target.value; reload(); };
  reload();
};

// ---- Line-item builder (shared by purchases & sales) ----
function lineItemsBuilder(container, kind) {
  // kind: 'purchase' (unitCost) | 'sale' (unitPrice)
  const priceField = kind === 'purchase' ? 'unitCost' : 'unitPrice';
  function addRow() {
    const row = document.createElement('div');
    row.className = 'linerow';
    row.innerHTML =
      '<div><label>Product</label><select class="liProduct">' + productOptions() + '</select></div>' +
      '<div><label>Size</label><select class="liSize"></select></div>' +
      '<div><label>Qty</label><input class="liQty" type="number" min="1" step="1" value="1"/></div>' +
      '<div><label>' + (kind === 'purchase' ? 'Unit cost' : 'Unit price') + '</label><input class="liPrice" type="number" min="0" step="0.01"/></div>' +
      '<div><button class="btn small danger liRemove" type="button">✕</button></div>';
    container.appendChild(row);
    const prodSel = row.querySelector('.liProduct');
    const sizeSel = row.querySelector('.liSize');
    const priceInp = row.querySelector('.liPrice');
    function syncFromProduct() {
      const p = productsCache.find((x) => x.id === prodSel.value);
      sizeSel.innerHTML = sizeOptions(p);
      priceInp.value = p ? (kind === 'purchase' ? p.costPrice : p.sellingPrice) : 0;
      recalc();
    }
    prodSel.onchange = syncFromProduct;
    row.querySelector('.liQty').oninput = recalc;
    priceInp.oninput = recalc;
    row.querySelector('.liRemove').onclick = () => { row.remove(); recalc(); };
    syncFromProduct();
  }
  function recalc() {
    let total = 0;
    container.querySelectorAll('.linerow').forEach((r) => {
      total += (Number(r.querySelector('.liQty').value || 0)) * (Number(r.querySelector('.liPrice').value || 0));
    });
    const t = document.getElementById('liTotal');
    if (t) t.textContent = fmt(total);
    return total;
  }
  function collect() {
    const items = [];
    container.querySelectorAll('.linerow').forEach((r) => {
      const item = { productId: r.querySelector('.liProduct').value, size: r.querySelector('.liSize').value, qty: Number(r.querySelector('.liQty').value || 0) };
      item[priceField] = Number(r.querySelector('.liPrice').value || 0);
      items.push(item);
    });
    return items;
  }
  addRow();
  return { addRow, collect, recalc };
}

// ---- Purchases ----
VIEWS.purchases = async (el) => {
  el.innerHTML = '<div class="toolbar"><div class="grow"></div><button class="btn" id="poNew">+ New purchase</button></div><div id="poList"><p class="muted">Loading…</p></div>';
  const reload = async () => {
    try {
      const r = await api('/api/purchases');
      document.getElementById('poList').innerHTML = r.purchases.length ?
        '<div class="card"><div class="tablewrap"><table class="tbl"><tr><th>Ref</th><th>Date</th><th>Supplier</th><th class="right">Units</th><th class="right">Total</th><th>Payment</th><th></th></tr>' +
        r.purchases.map((x) => '<tr><td><strong>' + esc(x.ref) + '</strong></td><td class="nowrap">' + day(x.date) + '</td><td>' + esc(x.supplierName) + '</td><td class="right">' + x.units + '</td><td class="right">' + fmt(x.total) + '</td><td><span class="pill ' + (x.paymentStatus === 'paid' ? 'ok' : x.paymentStatus === 'partial' ? 'warn' : 'bad') + '">' + esc(x.paymentStatus) + '</span></td><td class="nowrap"><button class="btn small secondary" data-po="' + x.id + '">View / receipt</button> <button class="btn small ghost" data-popay="' + x.id + '">Payment</button></td></tr>').join('') + '</table></div></div>'
        : '<div class="card"><p class="muted">No purchases recorded yet.</p></div>';
      el.querySelectorAll('[data-po]').forEach((b) => { b.onclick = () => purchaseDetail(b.dataset.po); });
      el.querySelectorAll('[data-popay]').forEach((b) => { b.onclick = () => purchasePayment(b.dataset.popay, reload); });
    } catch (e) { die(e); }
  };
  document.getElementById('poNew').onclick = async () => { await loadCaches(); purchaseForm(reload); };
  reload();
};

function purchaseForm(done) {
  openModal(
    '<button class="btn small ghost x" id="mClose">✕</button><h2>New purchase</h2>' +
    '<div class="formgrid"><div><label>Supplier *</label><select id="poSupplier">' + suppliersCache.map((s) => '<option value="' + s.id + '">' + esc(s.name) + '</option>').join('') + '</select></div>' +
    '<div><label>Date</label><input id="poDate" type="date" value="' + day(new Date().toISOString()) + '"/></div>' +
    '<div><label>Payment status</label><select id="poPay"><option value="unpaid">Unpaid</option><option value="partial">Partial</option><option value="paid">Paid</option></select></div>' +
    '<div><label>Note</label><input id="poNote" placeholder="Optional"/></div></div>' +
    '<div class="lineitems" id="poLines"></div>' +
    '<button class="btn small secondary" id="poAddLine" type="button">+ Add line</button>' +
    '<div class="totalbar"><span>Total</span><span id="liTotal">' + fmt(0) + '</span></div>' +
    '<p class="small muted">Confirming a purchase adds the stock immediately and records the movements.</p>' +
    '<div class="btnrow" style="margin-top:.8rem"><button class="btn" id="poSave">Confirm purchase</button><button class="btn secondary" id="poCancel">Cancel</button></div>', true
  );
  const builder = lineItemsBuilder(document.getElementById('poLines'), 'purchase');
  document.getElementById('poAddLine').onclick = builder.addRow;
  document.getElementById('mClose').onclick = closeModal;
  document.getElementById('poCancel').onclick = closeModal;
  document.getElementById('poSave').onclick = async () => {
    try {
      const created = await api('/api/purchases', { method: 'POST', body: { supplierId: document.getElementById('poSupplier').value, date: document.getElementById('poDate').value, paymentStatus: document.getElementById('poPay').value, note: document.getElementById('poNote').value, items: builder.collect() } });
      closeModal(); toast('Purchase ' + created.ref + ' confirmed — stock updated'); refreshAlertsBadge(); done();
    } catch (e) { die(e); }
  };
}

async function purchaseDetail(id) {
  try {
    const x = await api('/api/purchases/' + id);
    openModal(
      '<button class="btn small ghost x" id="mClose">✕</button><h2>Purchase ' + esc(x.ref) + '</h2>' +
      '<p class="muted small">' + day(x.date) + ' · ' + esc(x.supplierName) + ' · payment: ' + esc(x.paymentStatus) + (x.note ? ' · ' + esc(x.note) : '') + '</p>' +
      '<div class="tablewrap"><table class="tbl"><tr><th>Product</th><th>Size</th><th class="right">Qty</th><th class="right">Unit cost</th><th class="right">Line total</th></tr>' +
      x.items.map((i) => '<tr><td>' + esc(i.productName) + '<br/><span class="muted small">' + esc(i.sku) + '</span></td><td>' + esc(i.size) + '</td><td class="right">' + i.qty + '</td><td class="right">' + fmt(i.unitCost) + '</td><td class="right">' + fmt(i.lineTotal) + '</td></tr>').join('') +
      '</table></div><div class="totalbar"><span>Total</span><span>' + fmt(x.total) + '</span></div>' +
      '<div class="btnrow" style="margin-top:1rem"><button class="btn" id="poPrint">🖨️ Print receipt</button><button class="btn secondary" id="poClose">Close</button></div>'
    );
    document.getElementById('mClose').onclick = closeModal;
    document.getElementById('poClose').onclick = closeModal;
    document.getElementById('poPrint').onclick = () => printReceipt('PURCHASE RECEIPT', x.ref, day(x.date), 'Supplier: ' + x.supplierName, x.items, x.total, 'Payment status: ' + x.paymentStatus);
  } catch (e) { die(e); }
}

function purchasePayment(id, done) {
  openModal('<button class="btn small ghost x" id="mClose">✕</button><h2>Update payment status</h2>' +
    '<label>Status</label><select id="ppStatus"><option value="unpaid">Unpaid</option><option value="partial">Partial</option><option value="paid">Paid</option></select>' +
    '<div class="btnrow" style="margin-top:1rem"><button class="btn" id="ppSave">Save</button><button class="btn secondary" id="ppCancel">Cancel</button></div>');
  document.getElementById('mClose').onclick = closeModal;
  document.getElementById('ppCancel').onclick = closeModal;
  document.getElementById('ppSave').onclick = async () => {
    try { await api('/api/purchases/' + id + '/payment', { method: 'POST', body: { paymentStatus: document.getElementById('ppStatus').value } }); closeModal(); toast('Payment status updated'); done(); } catch (e) { die(e); }
  };
}

// ---- Sales ----
VIEWS.sales = async (el) => {
  el.innerHTML = '<div class="toolbar"><div class="grow"></div><button class="btn" id="saNew">+ New sale</button></div><div id="saList"><p class="muted">Loading…</p></div>';
  const reload = async () => {
    try {
      const r = await api('/api/sales');
      document.getElementById('saList').innerHTML = r.sales.length ?
        '<div class="card"><div class="tablewrap"><table class="tbl"><tr><th>Ref</th><th>Date</th><th>Customer</th><th class="right">Units</th><th class="right">Discount</th><th class="right">Total</th><th>Payment</th><th></th></tr>' +
        r.sales.map((x) => '<tr><td><strong>' + esc(x.ref) + '</strong></td><td class="nowrap">' + day(x.date) + '</td><td>' + esc(x.customer || 'Walk-in') + '</td><td class="right">' + x.units + '</td><td class="right">' + fmt(x.discount || 0) + '</td><td class="right">' + fmt(x.total) + '</td><td>' + esc(x.paymentMethod) + '</td><td><button class="btn small secondary" data-sa="' + x.id + '">View / receipt</button></td></tr>').join('') + '</table></div></div>'
        : '<div class="card"><p class="muted">No sales recorded yet.</p></div>';
      el.querySelectorAll('[data-sa]').forEach((b) => { b.onclick = () => saleDetail(b.dataset.sa); });
    } catch (e) { die(e); }
  };
  document.getElementById('saNew').onclick = async () => { await loadCaches(); saleForm(reload); };
  reload();
};

function saleForm(done) {
  openModal(
    '<button class="btn small ghost x" id="mClose">✕</button><h2>New sale</h2>' +
    '<div class="formgrid"><div><label>Customer</label><input id="saCustomer" placeholder="Walk-in"/></div>' +
    '<div><label>Date</label><input id="saDate" type="date" value="' + day(new Date().toISOString()) + '"/></div>' +
    '<div><label>Payment method</label><select id="saPay"><option value="cash">Cash</option><option value="mpesa">M-Pesa</option><option value="card">Card</option><option value="bank">Bank transfer</option></select></div>' +
    '<div><label>Discount (KSh)</label><input id="saDiscount" type="number" min="0" step="0.01" value="0"/></div></div>' +
    '<div class="lineitems" id="saLines"></div>' +
    '<button class="btn small secondary" id="saAddLine" type="button">+ Add line</button>' +
    '<div class="totalbar"><span>Total before discount</span><span id="liTotal">' + fmt(0) + '</span></div>' +
    '<p class="small muted">Confirming a sale reduces stock immediately. The sale is rejected if any line exceeds available stock.</p>' +
    '<div class="btnrow" style="margin-top:.8rem"><button class="btn" id="saSave">Confirm sale</button><button class="btn secondary" id="saCancel">Cancel</button></div>', true
  );
  const builder = lineItemsBuilder(document.getElementById('saLines'), 'sale');
  document.getElementById('saAddLine').onclick = builder.addRow;
  document.getElementById('mClose').onclick = closeModal;
  document.getElementById('saCancel').onclick = closeModal;
  document.getElementById('saSave').onclick = async () => {
    try {
      const created = await api('/api/sales', { method: 'POST', body: { customer: document.getElementById('saCustomer').value, date: document.getElementById('saDate').value, paymentMethod: document.getElementById('saPay').value, discount: Number(document.getElementById('saDiscount').value || 0), items: builder.collect() } });
      closeModal(); toast('Sale ' + created.ref + ' confirmed — stock updated'); refreshAlertsBadge(); done();
    } catch (e) { die(e); }
  };
}

async function saleDetail(id) {
  try {
    const x = await api('/api/sales/' + id);
    openModal(
      '<button class="btn small ghost x" id="mClose">✕</button><h2>Sale ' + esc(x.ref) + '</h2>' +
      '<p class="muted small">' + day(x.date) + ' · ' + esc(x.customer || 'Walk-in') + ' · paid by ' + esc(x.paymentMethod) + '</p>' +
      '<div class="tablewrap"><table class="tbl"><tr><th>Product</th><th>Size</th><th class="right">Qty</th><th class="right">Unit price</th><th class="right">Line total</th></tr>' +
      x.items.map((i) => '<tr><td>' + esc(i.productName) + '<br/><span class="muted small">' + esc(i.sku) + '</span></td><td>' + esc(i.size) + '</td><td class="right">' + i.qty + '</td><td class="right">' + fmt(i.unitPrice) + '</td><td class="right">' + fmt(i.lineTotal) + '</td></tr>').join('') +
      '</table></div>' +
      (x.discount ? '<p class="right">Discount: −' + fmt(x.discount) + '</p>' : '') +
      '<div class="totalbar"><span>Total</span><span>' + fmt(x.total) + '</span></div>' +
      '<div class="btnrow" style="margin-top:1rem"><button class="btn" id="saPrint">🖨️ Print receipt</button><button class="btn secondary" id="saClose">Close</button></div>'
    );
    document.getElementById('mClose').onclick = closeModal;
    document.getElementById('saClose').onclick = closeModal;
    document.getElementById('saPrint').onclick = () => printReceipt('SALES RECEIPT', x.ref, day(x.date), 'Customer: ' + (x.customer || 'Walk-in'), x.items, x.total, (x.discount ? 'Discount: −' + fmt(x.discount) + ' · ' : '') + 'Paid by ' + x.paymentMethod);
  } catch (e) { die(e); }
}

// ---- Receipts / printing ----
function printReceipt(kind, ref, date, partyLine, items, total, footLine) {
  printArea.innerHTML =
    '<div class="receipt"><h2>AURA</h2><p class="rsub">' + esc(kind) + '</p>' +
    '<p><strong>' + esc(ref) + '</strong> · ' + esc(date) + '<br/>' + esc(partyLine) + '</p>' +
    '<table><tr><th>Item</th><th>Size</th><th>Qty</th><th style="text-align:right">Amount</th></tr>' +
    items.map((i) => '<tr><td>' + esc(i.productName) + '</td><td>' + esc(i.size) + '</td><td>' + i.qty + '</td><td style="text-align:right">' + fmt(i.lineTotal != null ? i.lineTotal : i.qty * (i.unitPrice || i.unitCost || 0)) + '</td></tr>').join('') +
    '</table><p style="text-align:right"><strong>Total: ' + fmt(total) + '</strong></p>' +
    '<p class="rsub">' + esc(footLine || '') + '</p><p class="rsub">Thank you.</p></div>';
  window.print();
}
function printHTML(title, inner) {
  printArea.innerHTML = '<h2>' + esc(title) + '</h2>' + inner;
  window.print();
}

// ---- Suppliers ----
VIEWS.suppliers = async (el) => {
  el.innerHTML = '<div class="toolbar"><div class="grow"></div><button class="btn" id="supNew">+ Add supplier</button></div><div id="supList"><p class="muted">Loading…</p></div>';
  const reload = async () => {
    try {
      const r = await api('/api/suppliers');
      suppliersCache = r.suppliers;
      document.getElementById('supList').innerHTML = r.suppliers.length ?
        '<div class="card"><div class="tablewrap"><table class="tbl"><tr><th>Supplier</th><th>Contact</th><th class="right">Products</th><th class="right">Purchases</th><th class="right">Total bought</th><th class="right">Outstanding</th><th></th></tr>' +
        r.suppliers.map((s) => '<tr><td><strong>' + esc(s.name) + '</strong><br/><span class="muted small">' + esc(s.code) + '</span></td><td>' + esc(s.contactPerson || '') + '<br/><span class="muted small">' + esc(s.phone || '') + ' ' + esc(s.email || '') + '</span></td><td class="right">' + s.productsSupplied + '</td><td class="right">' + s.purchaseCount + '</td><td class="right">' + fmt(s.totalBought) + '</td><td class="right">' + (s.outstanding ? '<span class="pill warn">' + fmt(s.outstanding) + '</span>' : fmt(0)) + '</td><td><button class="btn small ghost" data-sup="' + s.id + '">Edit</button></td></tr>').join('') + '</table></div></div>'
        : '<div class="card"><p class="muted">No suppliers yet.</p></div>';
      el.querySelectorAll('[data-sup]').forEach((b) => { b.onclick = () => supplierForm(suppliersCache.find((x) => x.id === b.dataset.sup), reload); });
    } catch (e) { die(e); }
  };
  document.getElementById('supNew').onclick = () => supplierForm(null, reload);
  reload();
};

function supplierForm(s, done) {
  const isNew = !s;
  s = s || { name: '', contactPerson: '', phone: '', email: '', address: '', notes: '' };
  openModal(
    '<button class="btn small ghost x" id="mClose">✕</button><h2>' + (isNew ? 'Add supplier' : 'Edit supplier') + '</h2>' +
    '<div class="formgrid"><div><label>Supplier name *</label><input id="sName" value="' + esc(s.name) + '"/></div>' +
    '<div><label>Contact person</label><input id="sContact" value="' + esc(s.contactPerson || '') + '"/></div>' +
    '<div><label>Phone</label><input id="sPhone" value="' + esc(s.phone || '') + '"/></div>' +
    '<div><label>Email</label><input id="sEmail" type="email" value="' + esc(s.email || '') + '"/></div></div>' +
    '<label>Physical address</label><input id="sAddress" value="' + esc(s.address || '') + '"/>' +
    '<label>Notes</label><textarea id="sNotes" rows="2">' + esc(s.notes || '') + '</textarea>' +
    '<div class="btnrow" style="margin-top:1rem"><button class="btn" id="sSave">' + (isNew ? 'Add supplier' : 'Save changes') + '</button>' +
    (isNew ? '' : '<button class="btn danger" id="sDelete">Delete</button>') + '<button class="btn secondary" id="sCancel">Cancel</button></div>'
  );
  document.getElementById('mClose').onclick = closeModal;
  document.getElementById('sCancel').onclick = closeModal;
  document.getElementById('sSave').onclick = async () => {
    const body = { name: document.getElementById('sName').value, contactPerson: document.getElementById('sContact').value, phone: document.getElementById('sPhone').value, email: document.getElementById('sEmail').value, address: document.getElementById('sAddress').value, notes: document.getElementById('sNotes').value };
    try { await api(isNew ? '/api/suppliers' : '/api/suppliers/' + s.id, { method: isNew ? 'POST' : 'PUT', body }); closeModal(); toast('Supplier saved'); done(); } catch (e) { die(e); }
  };
  const del = document.getElementById('sDelete');
  if (del) del.onclick = async () => {
    if (!(await confirmDialog('Delete supplier?', 'Delete "' + s.name + '"? Suppliers with purchase history can\'t be deleted.', 'Delete'))) return;
    try { await api('/api/suppliers/' + s.id, { method: 'DELETE' }); closeModal(); toast('Supplier deleted'); done(); } catch (e) { die(e); }
  };
}

// ---- Alerts ----
VIEWS.alerts = async (el) => {
  el.innerHTML = '<p class="muted">Loading alerts…</p>';
  try {
    const a = await api('/api/alerts');
    const section = (title, rows, render) => '<div class="card"><h3>' + title + ' (' + rows.length + ')</h3>' + (rows.length ? rows.map(render).join('') : '<p class="muted">None.</p>') + '</div>';
    const stockRow = (x) => '<div class="row" style="justify-content:space-between;padding:.3rem 0;border-bottom:1px solid var(--line)"><span>' + esc(x.name) + ' <span class="muted">(' + esc(x.size) + ')</span></span><span class="pill ' + (x.qty === 0 ? 'bad' : 'warn') + '">' + (x.qty === 0 ? 'Out of stock' : x.qty + ' left · reorder at ' + x.threshold) + '</span></div>';
    el.innerHTML =
      section('Out of stock', a.out, stockRow) +
      section('Low stock', a.low, stockRow) +
      section('Expired products', a.expired, (x) => '<div class="row" style="justify-content:space-between;padding:.3rem 0;border-bottom:1px solid var(--line)"><span>' + esc(x.name) + '</span><span class="pill bad">Expired ' + esc(x.expiryDate) + '</span></div>') +
      section('Expiring within 30 days', a.expiringSoon, (x) => '<div class="row" style="justify-content:space-between;padding:.3rem 0;border-bottom:1px solid var(--line)"><span>' + esc(x.name) + '</span><span class="pill warn">Expires ' + esc(x.expiryDate) + '</span></div>') +
      section('Unusual stock adjustments (≥10 units in a day)', a.unusual, (x) => '<div class="row" style="justify-content:space-between;padding:.3rem 0;border-bottom:1px solid var(--line)"><span>' + esc(x.name) + ' (' + esc(x.size) + ') — ' + esc(x.userName) + '</span><span class="pill warn">' + x.total + ' units on ' + esc(x.date) + '</span></div>');
  } catch (e) { el.innerHTML = '<p class="pill bad">' + esc(e.message) + '</p>'; }
};

// ---- Reports ----
const REPORT_TYPES = [
  ['inventory', 'Current inventory'], ['movements', 'Stock movement'], ['purchases', 'Purchases'],
  ['sales', 'Sales'], ['valuation', 'Inventory valuation'], ['profit', 'COGS & gross profit'],
  ['damaged', 'Damaged & expired stock'], ['suppliers', 'Supplier performance'],
];
let repState = { type: 'inventory', from: '', to: '' };
VIEWS.reports = async (el) => {
  const allowed = REPORT_TYPES.filter(([t]) => !(me.role === 'staff' && (t === 'profit' || t === 'valuation')));
  el.innerHTML =
    '<div class="toolbar"><div><label>Report</label><select id="repType">' + allowed.map(([v, l]) => '<option value="' + v + '"' + (repState.type === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></div>' +
    '<div><label>From</label><input type="date" id="repFrom" value="' + repState.from + '"/></div>' +
    '<div><label>To</label><input type="date" id="repTo" value="' + repState.to + '"/></div>' +
    '<button class="btn secondary" id="repCsv">⬇ Excel (CSV)</button><button class="btn secondary" id="repPrint">🖨️ Print / PDF</button></div>' +
    '<div class="card" id="repCard"><p class="muted">Loading…</p></div>';
  let current = null;
  const reload = async () => {
    const qs = new URLSearchParams();
    if (repState.from) qs.set('from', repState.from);
    if (repState.to) qs.set('to', repState.to);
    try {
      current = await api('/api/reports/' + repState.type + '?' + qs.toString());
      document.getElementById('repCard').innerHTML = '<h3>' + esc(current.title) + '</h3>' + reportTable(current);
    } catch (e) { die(e); }
  };
  document.getElementById('repType').onchange = (ev) => { repState.type = ev.target.value; reload(); };
  document.getElementById('repFrom').onchange = (ev) => { repState.from = ev.target.value; reload(); };
  document.getElementById('repTo').onchange = (ev) => { repState.to = ev.target.value; reload(); };
  document.getElementById('repCsv').onclick = () => {
    const qs = new URLSearchParams();
    if (repState.from) qs.set('from', repState.from);
    if (repState.to) qs.set('to', repState.to);
    window.location.href = '/api/reports/' + repState.type + '/csv?' + qs.toString();
  };
  document.getElementById('repPrint').onclick = () => { if (current) printHTML('AURA — ' + current.title, reportTable(current)); };
  reload();
};
function reportTable(r) {
  const head = '<tr>' + r.columns.map((c) => '<th>' + esc(c) + '</th>').join('') + '</tr>';
  const body = r.rows.map((row) => '<tr>' + row.map((v) => '<td>' + esc(typeof v === 'number' ? v.toLocaleString('en-US') : v) + '</td>').join('') + '</tr>').join('');
  const summary = (r.summary || []).map(([k, v]) => '<p style="margin:.3rem 0"><strong>' + esc(k) + ':</strong> ' + fmt(v) + '</p>').join('');
  return '<div class="tablewrap"><table class="tbl">' + head + body + '</table></div>' + (r.rows.length ? '' : '<p class="muted">No rows for this period.</p>') + summary;
}

// ---- Users (admin) ----
VIEWS.users = async (el) => {
  el.innerHTML = '<div class="toolbar"><div class="grow"></div><button class="btn" id="uNew">+ Add user</button></div><div id="uList"><p class="muted">Loading…</p></div>';
  const reload = async () => {
    try {
      const r = await api('/api/users');
      document.getElementById('uList').innerHTML =
        '<div class="card"><div class="tablewrap"><table class="tbl"><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th></th></tr>' +
        r.users.map((u) => '<tr><td>' + esc(u.name) + '</td><td>' + esc(u.email) + '</td><td><span class="pill grey">' + esc(u.role) + '</span></td><td>' + (u.active ? '<span class="pill ok">active</span>' : '<span class="pill bad">inactive</span>') + '</td><td><button class="btn small ghost" data-user="' + u.id + '">Edit</button></td></tr>').join('') + '</table></div></div>';
      el.querySelectorAll('[data-user]').forEach((b) => { b.onclick = () => userForm(r.users.find((x) => x.id === b.dataset.user), reload); });
    } catch (e) { die(e); }
  };
  document.getElementById('uNew').onclick = () => userForm(null, reload);
  reload();
};
function userForm(u, done) {
  const isNew = !u;
  u = u || { name: '', email: '', role: 'staff', active: true };
  openModal(
    '<button class="btn small ghost x" id="mClose">✕</button><h2>' + (isNew ? 'Add user' : 'Edit user') + '</h2>' +
    '<div class="formgrid"><div><label>Full name *</label><input id="uName" value="' + esc(u.name) + '"/></div>' +
    '<div><label>Email *</label><input id="uEmail" type="email" value="' + esc(u.email) + '"' + (isNew ? '' : ' disabled') + '/></div>' +
    '<div><label>Role</label><select id="uRole">' + ['admin', 'manager', 'staff'].map((r) => '<option value="' + r + '"' + (u.role === r ? ' selected' : '') + '>' + cap(r) + '</option>').join('') + '</select></div>' +
    '<div><label>' + (isNew ? 'Password *' : 'Reset password (optional)') + '</label><input id="uPass" type="password" placeholder="' + (isNew ? 'At least 6 characters' : 'Leave blank to keep') + '"/></div></div>' +
    (isNew ? '' : '<label style="margin-top:.7rem"><input type="checkbox" id="uActive" style="width:auto" ' + (u.active ? 'checked' : '') + ' /> Active (can sign in)</label>') +
    '<p class="small muted">Roles — Admin: full access · Manager: inventory, purchases, sales, reports · Staff: record transactions and view stock.</p>' +
    '<div class="btnrow" style="margin-top:1rem"><button class="btn" id="uSave">' + (isNew ? 'Add user' : 'Save changes') + '</button><button class="btn secondary" id="uCancel">Cancel</button></div>'
  );
  document.getElementById('mClose').onclick = closeModal;
  document.getElementById('uCancel').onclick = closeModal;
  document.getElementById('uSave').onclick = async () => {
    const body = { name: document.getElementById('uName').value, role: document.getElementById('uRole').value };
    const pw = document.getElementById('uPass').value;
    if (pw) body.password = pw;
    if (isNew) body.email = document.getElementById('uEmail').value;
    if (!isNew) body.active = document.getElementById('uActive').checked;
    try { await api(isNew ? '/api/users' : '/api/users/' + u.id, { method: isNew ? 'POST' : 'PUT', body }); closeModal(); toast('User saved'); done(); } catch (e) { die(e); }
  };
}

// ---- Audit ----
VIEWS.audit = async (el) => {
  el.innerHTML = '<div class="card"><h3>Audit log</h3><div id="auList"><p class="muted">Loading…</p></div></div>';
  try {
    const r = await api('/api/audit');
    document.getElementById('auList').innerHTML = r.audit.length ?
      '<div class="tablewrap"><table class="tbl"><tr><th>When</th><th>User</th><th>Action</th><th>Entity</th><th>Detail</th></tr>' +
      r.audit.map((a) => '<tr><td class="nowrap small">' + String(a.date).replace('T', ' ').slice(0, 16) + '</td><td>' + esc(a.userName || a.userId) + '</td><td><span class="pill grey">' + esc(a.action) + '</span></td><td>' + esc(a.entity) + '</td><td class="small">' + esc(a.detail || '') + '</td></tr>').join('') + '</table></div>'
      : '<p class="muted">No audit entries yet.</p>';
  } catch (e) { die(e); }
};

// ---- Account ----
VIEWS.account = async (el) => {
  el.innerHTML =
    '<div class="grid2"><div class="card"><h3>My account</h3>' +
    '<p><strong>' + esc(me.name) + '</strong><br/><span class="muted">' + esc(me.email) + ' · ' + esc(me.role) + '</span></p>' +
    '<h3 style="margin-top:1.2rem">Change password</h3>' +
    '<label>Current password</label><input type="password" id="acCurrent"/>' +
    '<label>New password</label><input type="password" id="acNew"/>' +
    '<div class="btnrow" style="margin-top:.8rem"><button class="btn" id="acSave">Change password</button></div></div>' +
    '<div class="card"><h3>Data &amp; backup</h3>' +
    '<p class="small muted">Download a full JSON backup of the inventory database (products, stock, purchases, sales, movements, users). Keep it somewhere safe — it can be used to restore the system.</p>' +
    (me.role === 'admin' ? '<button class="btn secondary" id="acBackup">⬇ Download backup</button>' : '<p class="small muted">Backups are available to Admin accounts.</p>') +
    '<h3 style="margin-top:1.2rem">About</h3><p class="small muted">AURA Inventory v2 — products, stock, purchases, sales, suppliers, alerts and reports in one system. Sample data is labelled and can be replaced with AURA\'s real catalogue at any time.</p></div></div>';
  document.getElementById('acSave').onclick = async () => {
    try {
      await api('/api/change-password', { method: 'POST', body: { currentPassword: document.getElementById('acCurrent').value, newPassword: document.getElementById('acNew').value } });
      toast('Password changed');
      document.getElementById('acCurrent').value = '';
      document.getElementById('acNew').value = '';
    } catch (e) { die(e); }
  };
  const bk = document.getElementById('acBackup');
  if (bk) bk.onclick = () => { window.location.href = '/api/backup'; };
};

boot();

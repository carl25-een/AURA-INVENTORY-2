// public/app.js — AURA Inventory single-page app (vanilla JS, no build step).

let staffPin = sessionStorage.getItem('staffPin') || '';
let config = { staffPinRequired: false, categories: [], sizes: ['XS', 'S', 'M', 'L', 'XL'] };
let products = [];
let stats = null;
let movements = [];
let view = 'dashboard';
let searchText = '';
let categoryFilter = 'All';
let editingId = null;
let adjustId = null;

const app = document.getElementById('app');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => 'KSh ' + Number(n || 0).toLocaleString('en-US');

async function api(path, opts = {}, retry = true) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(staffPin ? { 'X-Staff-Pin': staffPin } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401 && retry) {
    const pin = prompt('Staff PIN required for this action:');
    if (pin) {
      staffPin = pin;
      sessionStorage.setItem('staffPin', pin);
      return api(path, opts, false);
    }
    throw new Error('Staff PIN required');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

async function refresh() {
  const [p, s, m] = await Promise.all([api('/api/products'), api('/api/stats'), api('/api/movements')]);
  products = p.products;
  stats = s;
  movements = m.movements;
}

async function boot() {
  try { config = await api('/api/config'); } catch (e) { /* best effort */ }
  await refresh();
  render();
}

function showView(v) {
  view = v;
  editingId = null;
  adjustId = null;
  render();
}

function render() {
  document.querySelectorAll('.navbtn').forEach((b) => b.classList.toggle('on', b.dataset.nav === view));
  if (view === 'products') return renderProducts();
  if (view === 'movements') return renderMovements();
  return renderDashboard();
}

// ---------------- dashboard ----------------
function renderDashboard() {
  const s = stats || { productCount: 0, totalUnits: 0, retailValue: 0, costValue: 0, lowStock: [], outOfStockCount: 0 };
  app.innerHTML = `
    <div class="stats">
      <div class="stat"><div class="num">${s.productCount}</div><div class="lbl">Products</div></div>
      <div class="stat"><div class="num">${s.totalUnits}</div><div class="lbl">Units in stock</div></div>
      <div class="stat"><div class="num">${fmt(s.retailValue)}</div><div class="lbl">Stock value (selling)</div></div>
      <div class="stat"><div class="num">${fmt(s.costValue)}</div><div class="lbl">Stock value (cost)</div></div>
    </div>
    <div class="card">
      <h3>⚠ Low stock ${s.outOfStockCount ? `<span class="small" style="color:var(--danger)">· ${s.outOfStockCount} product(s) completely out</span>` : ''}</h3>
      ${s.lowStock.length ? s.lowStock.map((l) => `
        <div class="lowrow"><span>${esc(l.name)} <span class="muted">(${esc(l.sku)})</span> — size <strong>${esc(l.size)}</strong></span><strong>${l.qty === 0 ? 'OUT OF STOCK' : l.qty + ' left'}</strong></div>`).join('')
      : '<p class="muted">Nothing is running low. 🎉</p>'}
    </div>
    <div class="card">
      <h3>Recent movements</h3>
      ${movements.length ? movementRows(movements.slice(0, 6)) : '<p class="muted">No stock movements yet.</p>'}
    </div>`;
}

function movementRows(list) {
  return `<table class="mov"><tr><th>When</th><th>Product</th><th>Size</th><th>Change</th><th>Reason</th><th>Note</th></tr>
    ${list.map((m) => `<tr>
      <td class="small muted">${new Date(m.at).toLocaleString()}</td>
      <td>${esc(m.productName)} <span class="muted small">${esc(m.sku)}</span></td>
      <td>${esc(m.size)}</td>
      <td class="${m.delta >= 0 ? 'delta-pos' : 'delta-neg'}">${m.delta >= 0 ? '+' : ''}${m.delta}</td>
      <td>${esc(m.reason)}</td><td class="small muted">${esc(m.note || '')}</td>
    </tr>`).join('')}</table>`;
}

function renderMovements() {
  app.innerHTML = `
    <div class="card">
      <h2>Stock movements</h2>
      ${movements.length ? movementRows(movements) : '<p class="muted">No stock movements yet — they appear here whenever stock is added, sold or corrected.</p>'}
    </div>`;
}

// ---------------- products ----------------
function sizePills(p) {
  return Object.entries(p.sizes || {}).map(([size, qty]) => {
    const cls = qty === 0 ? 'out' : (qty <= (p.lowStockAt != null ? p.lowStockAt : 2) ? 'low' : '');
    return `<span class="sizepill ${cls}"><span class="sz">${esc(size)}</span><span class="qt">${qty}</span></span>`;
  }).join('');
}

function productForm(p) {
  const isEdit = Boolean(p);
  const cats = [...new Set([...(config.categories || []), ...products.map((x) => x.category)])];
  const sizes = isEdit ? {} : { XS: 0, S: 0, M: 0, L: 0, XL: 0 };
  return `
    <div class="card">
      <h3>${isEdit ? 'Edit product' : '＋ Add a product'}</h3>
      <div class="grid2">
        <div><label>Name</label><input id="pfName" value="${isEdit ? esc(p.name) : ''}" placeholder="e.g. Ribbed Knit Midi Dress" /></div>
        <div><label>Category</label>
          <select id="pfCategory">${cats.map((c) => `<option ${isEdit && p.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}<option value="__custom">Custom…</option></select>
          <input id="pfCategoryCustom" placeholder="Custom category" style="display:none;margin-top:.4rem" />
        </div>
      </div>
      <div class="grid2">
        <div><label>Selling price (KSh)</label><input id="pfPrice" type="number" min="0" step="any" value="${isEdit ? p.price : ''}" /></div>
        <div><label>Cost price (KSh)</label><input id="pfCost" type="number" min="0" step="any" value="${isEdit ? p.cost : ''}" /></div>
      </div>
      ${isEdit ? '<p class="small muted">Stock levels are not edited here — use <strong>Adjust stock</strong> on the product so every change is recorded in Movements.</p>' : `
      <label>Starting stock per size</label>
      <div class="grid5">${Object.keys(sizes).map((sz) => `<div><label>${sz}</label><input type="number" min="0" step="1" id="pfSize_${sz}" value="0" /></div>`).join('')}</div>
      <label style="margin-top:.5rem"><input type="checkbox" id="pfOneSize" style="width:auto" onchange="document.getElementById('pfOneSizeQty').style.display=this.checked?'':'none'" /> One size product (accessories etc.)</label>
      <div id="pfOneSizeQty" style="display:none"><label>One Size quantity</label><input type="number" min="0" step="1" id="pfSize_OneSize" value="0" /></div>`}
      <div><label>Low-stock alert at (per size)</label><input id="pfLow" type="number" min="0" step="1" value="${isEdit ? p.lowStockAt : 2}" style="max-width:140px" /></div>
      <p class="row" style="margin-top:.8rem">
        <button class="btn" onclick="saveProduct('${isEdit ? p.id : ''}')">${isEdit ? 'Save changes' : 'Add product'}</button>
        ${isEdit ? '<button class="btn secondary" onclick="cancelEdit()">Cancel</button>' : ''}
      </p>
    </div>`;
}

function renderProducts() {
  const cats = ['All', ...new Set(products.map((p) => p.category))];
  const list = products.filter((p) =>
    (categoryFilter === 'All' || p.category === categoryFilter) &&
    (!searchText || (p.name + ' ' + p.sku + ' ' + p.category).toLowerCase().includes(searchText.toLowerCase())));
  const editing = editingId ? products.find((p) => p.id === editingId) : null;
  app.innerHTML = `
    ${editing ? productForm(editing) : productForm(null)}
    <div class="card">
      <div class="row wrap" style="justify-content:space-between">
        <h3 style="margin:0">Products (${list.length})</h3>
        <input id="searchBox" placeholder="Search name, SKU, category…" value="${esc(searchText)}" oninput="searchText=this.value;renderProducts();document.getElementById('searchBox').focus()" style="max-width:260px" />
      </div>
      <p style="margin:.7rem 0 0">${cats.map((c) => `<span class="chip ${categoryFilter === c ? 'on' : ''}" onclick="categoryFilter='${esc(c)}';renderProducts()">${esc(c)}</span>`).join('')}</p>
    </div>
    ${list.length ? list.map((p) => `
    <div class="card">
      <div class="prodhead">
        <div>
          <strong>${esc(p.name)}</strong> <span class="muted small">${esc(p.sku)} · ${esc(p.category)}</span>
          <div style="margin-top:.45rem">${sizePills(p)}</div>
        </div>
        <div style="text-align:right">
          <div class="price">${fmt(p.price)}</div>
          <div class="small muted">cost ${fmt(p.cost)} · ${p.totalUnits} units · stock worth ${fmt(p.retailValue)}</div>
        </div>
      </div>
      <div class="row wrap" style="margin-top:.5rem">
        <button class="btn small" onclick="toggleAdjust('${p.id}')">Adjust stock</button>
        <button class="btn small secondary" onclick="startEdit('${p.id}')">Edit</button>
        <button class="btn small danger" onclick="deleteProduct('${p.id}')">Delete</button>
      </div>
      ${adjustId === p.id ? `
      <div class="adjustbox">
        <div class="grid2">
          <div><label>Size</label><select id="adjSize_${p.id}">${Object.keys(p.sizes).map((sz) => `<option>${esc(sz)}</option>`).join('')}</select></div>
          <div><label>Reason</label><select id="adjReason_${p.id}"><option value="restock">Restock (adding)</option><option value="sale">Sale (removing)</option><option value="correction">Correction</option><option value="damaged">Damaged / lost</option></select></div>
        </div>
        <div class="grid2">
          <div><label>Quantity (use − for removing, e.g. −1 for a sale)</label><input id="adjDelta_${p.id}" type="number" step="1" placeholder="e.g. 5 or −1" /></div>
          <div><label>Note (optional)</label><input id="adjNote_${p.id}" placeholder="e.g. Sold at Westlands" /></div>
        </div>
        <p style="margin-top:.7rem"><button class="btn small" onclick="applyAdjust('${p.id}')">Apply</button>
        <button class="btn small secondary" onclick="toggleAdjust(null)">Close</button></p>
      </div>` : ''}
    </div>`).join('') : '<div class="card"><p class="muted">No products match. Add one above, or clear the search.</p></div>'}`;
}

// ---------------- actions ----------------
async function saveProduct(id) {
  const name = document.getElementById('pfName').value.trim();
  if (!name) { alert('Give the product a name.'); return; }
  let category = document.getElementById('pfCategory').value;
  if (category === '__custom') {
    category = document.getElementById('pfCategoryCustom').value.trim() || 'Dresses';
  }
  const body = {
    name, category,
    price: Number(document.getElementById('pfPrice').value) || 0,
    cost: Number(document.getElementById('pfCost').value) || 0,
    lowStockAt: Number(document.getElementById('pfLow').value) || 0,
  };
  try {
    if (id) {
      await api('/api/products/' + id, { method: 'PUT', body });
    } else {
      const oneSize = document.getElementById('pfOneSize').checked;
      body.sizes = oneSize
        ? { 'One Size': Number(document.getElementById('pfSize_OneSize').value) || 0 }
        : Object.fromEntries(['XS', 'S', 'M', 'L', 'XL'].map((sz) => [sz, Number(document.getElementById('pfSize_' + sz).value) || 0]));
      await api('/api/products', { method: 'POST', body });
    }
    editingId = null;
    await refresh();
    render();
  } catch (e) { alert(e.message); }
}
function startEdit(id) { editingId = id; window.scrollTo({ top: 0, behavior: 'smooth' }); render(); }
function cancelEdit() { editingId = null; render(); }
async function deleteProduct(id) {
  const p = products.find((x) => x.id === id);
  if (!confirm(`Delete ${p ? p.name : 'this product'} permanently?`)) return;
  try {
    await api('/api/products/' + id, { method: 'DELETE' });
    if (editingId === id) editingId = null;
    await refresh();
    render();
  } catch (e) { alert(e.message); }
}
function toggleAdjust(id) { adjustId = adjustId === id ? null : id; render(); }
async function applyAdjust(id) {
  const delta = Math.floor(Number(document.getElementById('adjDelta_' + id).value));
  if (!delta) { alert('Enter a quantity — positive to add stock, negative to remove.'); return; }
  try {
    await api(`/api/products/${id}/adjust`, {
      method: 'POST',
      body: {
        size: document.getElementById('adjSize_' + id).value,
        delta,
        reason: document.getElementById('adjReason_' + id).value,
        note: document.getElementById('adjNote_' + id).value,
      },
    });
    adjustId = null;
    await refresh();
    render();
  } catch (e) { alert(e.message); }
}

// category custom toggle
document.addEventListener('change', (e) => {
  if (e.target && e.target.id === 'pfCategory') {
    const custom = document.getElementById('pfCategoryCustom');
    if (custom) custom.style.display = e.target.value === '__custom' ? '' : 'none';
  }
});

boot();

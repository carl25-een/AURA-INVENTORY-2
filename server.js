// server.js — AURA Inventory server.
// Zero-dependency Node.js (built-in http module only). Run: node server.js

const http = require('http');
const fs = require('fs');
const path = require('path');
const { load, save, uid, nextSku } = require('./lib/store');
const inv = require('./lib/inventory');

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
const STAFF_PIN = process.env.STAFF_PIN || ''; // when set, stock changes need it
const PUBLIC_DIR = path.join(__dirname, 'public');

const store = load();

// ---------- helpers ----------
function send(res, code, body, type) {
  if (res.headersSent) { try { res.end(); } catch (e) { /* already gone */ } return; }
  const isJson = !type || type === 'application/json';
  const data = isJson ? JSON.stringify(body) : body;
  res.writeHead(code, { 'Content-Type': type || 'application/json' });
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
function staffOnly(req, res) {
  if (!STAFF_PIN) return true;
  if (req.headers['x-staff-pin'] === STAFF_PIN) return true;
  send(res, 401, { error: 'Staff PIN required' });
  return false;
}
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
const str = (v, d) => (typeof v === 'string' && v.trim() ? v.trim() : (d || ''));

const REASONS = ['restock', 'sale', 'correction', 'damaged', 'initial'];

function sanitiseSizes(input) {
  const sizes = {};
  if (input && typeof input === 'object') {
    [...inv.SIZES, inv.ONE_SIZE].forEach((size) => {
      if (input[size] !== undefined) sizes[size] = Math.max(0, Math.floor(num(input[size], 0)));
    });
  }
  return sizes;
}

function logMovement(product, size, delta, reason, note) {
  store.movements.unshift({
    id: uid('mv'),
    productId: product.id, sku: product.sku, productName: product.name,
    size, delta, reason, note: note || '',
    at: new Date().toISOString(),
  });
  if (store.movements.length > 500) store.movements.length = 500;
}

// ---------- server ----------
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  const method = req.method;

  try {
    // ----- API -----
    if (p === '/api/config' && method === 'GET') {
      return send(res, 200, { staffPinRequired: Boolean(STAFF_PIN), categories: inv.CATEGORIES, sizes: inv.SIZES });
    }
    if (p === '/api/stats' && method === 'GET') {
      return send(res, 200, inv.computeStats(store));
    }
    if (p === '/api/products' && method === 'GET') {
      return send(res, 200, { products: store.products.map(inv.productView) });
    }
    if (p === '/api/products' && method === 'POST') {
      if (!staffOnly(req, res)) return;
      const body = await readBody(req);
      const name = str(body.name);
      if (!name) return send(res, 400, { error: 'Give the product a name' });
      const sizes = sanitiseSizes(body.sizes);
      if (!Object.keys(sizes).length) return send(res, 400, { error: 'Add stock for at least one size' });
      const product = {
        id: uid('p'),
        sku: nextSku(),
        name,
        category: str(body.category, 'Dresses'),
        price: Math.max(0, num(body.price, 0)),
        cost: Math.max(0, num(body.cost, 0)),
        lowStockAt: Math.max(0, Math.floor(num(body.lowStockAt, 2))),
        sizes,
        createdAt: new Date().toISOString(),
      };
      store.products.unshift(product);
      logMovement(product, '—', inv.totalUnits(product), 'initial', 'Product created');
      save();
      return send(res, 201, inv.productView(product));
    }
    const productMatch = p.match(/^\/api\/products\/([\w-]+)$/);
    if (productMatch && method === 'PUT') {
      if (!staffOnly(req, res)) return;
      const product = store.products.find((x) => x.id === productMatch[1]);
      if (!product) return send(res, 404, { error: 'Product not found' });
      const body = await readBody(req);
      if (body.name !== undefined) product.name = str(body.name, product.name);
      if (body.category !== undefined) product.category = str(body.category, product.category);
      if (body.price !== undefined) product.price = Math.max(0, num(body.price, product.price));
      if (body.cost !== undefined) product.cost = Math.max(0, num(body.cost, product.cost));
      if (body.lowStockAt !== undefined) product.lowStockAt = Math.max(0, Math.floor(num(body.lowStockAt, product.lowStockAt)));
      save();
      return send(res, 200, inv.productView(product));
    }
    if (productMatch && method === 'DELETE') {
      if (!staffOnly(req, res)) return;
      const i = store.products.findIndex((x) => x.id === productMatch[1]);
      if (i < 0) return send(res, 404, { error: 'Product not found' });
      store.products.splice(i, 1); save();
      return send(res, 200, { ok: true });
    }
    const adjustMatch = p.match(/^\/api\/products\/([\w-]+)\/adjust$/);
    if (adjustMatch && method === 'POST') {
      if (!staffOnly(req, res)) return;
      const product = store.products.find((x) => x.id === adjustMatch[1]);
      if (!product) return send(res, 404, { error: 'Product not found' });
      const body = await readBody(req);
      const size = str(body.size);
      if (![...inv.SIZES, inv.ONE_SIZE].includes(size)) return send(res, 400, { error: 'Unknown size' });
      const delta = Math.floor(num(body.delta, 0));
      if (!delta) return send(res, 400, { error: 'Enter how many to add or remove' });
      const reason = REASONS.includes(body.reason) ? body.reason : 'correction';
      const currentQty = product.sizes[size] || 0;
      if (currentQty + delta < 0) {
        return send(res, 400, { error: `Only ${currentQty} in stock for size ${size} — can't remove ${Math.abs(delta)}` });
      }
      product.sizes[size] = currentQty + delta;
      logMovement(product, size, delta, reason, str(body.note));
      save();
      return send(res, 200, inv.productView(product));
    }
    if (p === '/api/movements' && method === 'GET') {
      return send(res, 200, { movements: store.movements.slice(0, 100) });
    }
    if (p.startsWith('/api/')) return send(res, 404, { error: 'Not found' });

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
    send(res, 500, { error: 'Server error' });
  }
});

server.listen(PORT, () => {
  console.log(`AURA Inventory running at http://localhost:${PORT}`);
  console.log(STAFF_PIN ? 'Staff PIN protection: ON' : 'Staff PIN protection: OFF (set STAFF_PIN to enable)');
});

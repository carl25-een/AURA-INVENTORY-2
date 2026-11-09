// test/smoke.js — end-to-end workflow tests for AURA Inventory v2.
// Run against a freshly-seeded server:  node test/smoke.js [baseUrl]

const BASE = process.argv[2] || 'http://localhost:8831';
let passed = 0, failed = 0;
const failures = [];

function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ok  ' + name); }
  else { failed++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
}

function client() {
  let cookie = '';
  async function req(method, path, body) {
    const res = await fetch(BASE + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    let data = null;
    const text = await res.text();
    try { data = JSON.parse(text); } catch (e) { data = text; }
    return { status: res.status, data };
  }
  return {
    get: (p) => req('GET', p),
    post: (p, b) => req('POST', p, b),
    put: (p, b) => req('PUT', p, b),
    del: (p) => req('DELETE', p),
  };
}

(async () => {
  const admin = client(), staff = client(), anon = client();

  console.log('— auth —');
  let r = await anon.get('/api/products');
  check('unauthenticated request rejected (401)', r.status === 401);
  r = await admin.post('/api/login', { email: 'admin@aura.local', password: 'wrong' });
  check('wrong password rejected (401)', r.status === 401);
  r = await admin.post('/api/login', { email: 'admin@aura.local', password: 'aura-admin' });
  check('admin login works', r.status === 200 && r.data.user.role === 'admin');
  r = await staff.post('/api/login', { email: 'staff@aura.local', password: 'aura-staff' });
  check('staff login works', r.status === 200 && r.data.user.role === 'staff');
  r = await staff.get('/api/users');
  check('staff blocked from user list (403)', r.status === 403);
  r = await staff.get('/api/reports/profit');
  check('staff blocked from profit report (403)', r.status === 403);
  r = await staff.get('/api/backup');
  check('staff blocked from backup (403)', r.status === 403);

  console.log('— seed dashboard —');
  r = await admin.get('/api/dashboard');
  check('dashboard: 6 products', r.data.productCount === 6, JSON.stringify(r.data.productCount));
  check('dashboard: 129 units', r.data.totalUnits === 129, String(r.data.totalUnits));
  check('dashboard: retail 458100', r.data.retailValue === 458100, String(r.data.retailValue));
  check('dashboard: cost 209900', r.data.costValue === 209900, String(r.data.costValue));
  check('dashboard: purchases total 23200', r.data.totalPurchases === 23200, String(r.data.totalPurchases));
  check('dashboard: sales total 17600', r.data.totalSales === 17600, String(r.data.totalSales));
  r = await admin.get('/api/alerts');
  check('alerts: skirt XS out of stock', r.data.out.some((x) => x.productId === 'p003' && x.size === 'XS'));
  check('alerts: dress XL low', r.data.low.some((x) => x.productId === 'p001' && x.size === 'XL'));

  console.log('— profit report on seed —');
  r = await admin.get('/api/reports/profit');
  const sum = Object.fromEntries(r.data.summary);
  check('profit: revenue 17600', sum['Revenue (before discounts)'] === 17600, JSON.stringify(r.data.summary));
  check('profit: COGS 7400', sum['COGS'] === 7400, String(sum['COGS']));
  check('profit: gross 10200', sum['Gross profit'] === 10200, String(sum['Gross profit']));
  r = await admin.get('/api/reports/sales/csv');
  check('CSV export returns text with title', typeof r.data === 'string' && r.data.includes('Sales Report'));

  console.log('— suppliers —');
  r = await admin.post('/api/suppliers', { name: 'Test Supplier Ltd', contactPerson: 'Wanjiru', phone: '+254700111222', email: 't@example.ke' });
  check('supplier created with code SUP-003', r.status === 201 && r.data.code === 'SUP-003', JSON.stringify(r.data));
  const supId = r.data.id;
  r = await admin.put('/api/suppliers/' + supId, { phone: '+254700999888' });
  check('supplier edited', r.status === 200 && r.data.phone === '+254700999888');

  console.log('— products —');
  r = await admin.post('/api/products', { name: 'Test — Silk Scarf', category: 'Accessories', costPrice: 500, sellingPrice: 1200, supplierId: supId, reorderLevel: 2, sizes: { 'One Size': 10 } });
  check('product created with SKU AURA-007', r.status === 201 && r.data.sku === 'AURA-007', JSON.stringify(r.data && r.data.sku));
  const scarfId = r.data.id;
  check('product opening stock 10', r.data.totalUnits === 10);
  r = await admin.post('/api/products', { name: '' });
  check('product without name rejected (400)', r.status === 400);
  r = await admin.get('/api/products?q=silk');
  check('search finds the scarf', r.data.products.some((p) => p.id === scarfId));

  console.log('— purchases —');
  r = await admin.post('/api/purchases', { supplierId: supId, paymentStatus: 'unpaid', items: [{ productId: scarfId, size: 'One Size', qty: 5, unitCost: 480 }] });
  check('purchase created (PO-0002)', r.status === 201 && r.data.ref === 'PO-0002', JSON.stringify(r.data));
  check('purchase total 2400', r.data.total === 2400, String(r.data.total));
  const poId = r.data.id;
  r = await admin.get('/api/products/' + scarfId);
  check('stock increased to 15 after purchase', r.data.totalUnits === 15, String(r.data.totalUnits));
  r = await admin.get('/api/purchases/' + poId);
  check('purchase detail has items + supplier', r.data.items.length === 1 && r.data.supplierName === 'Test Supplier Ltd');
  r = await admin.post('/api/purchases/' + poId + '/payment', { paymentStatus: 'paid' });
  check('payment status updated', r.status === 200 && r.data.paymentStatus === 'paid');
  r = await admin.del('/api/suppliers/' + supId);
  check('supplier with purchase history cannot be deleted (400)', r.status === 400);

  console.log('— sales —');
  r = await staff.post('/api/sales', { customer: 'Test Buyer', paymentMethod: 'mpesa', discount: 100, items: [{ productId: scarfId, size: 'One Size', qty: 3 }] });
  check('staff can record a sale', r.status === 201, JSON.stringify(r.data));
  check('sale total = 3*1200 − 100 = 3500', r.data.total === 3500, String(r.data.total));
  const saleId = r.data.id;
  r = await admin.get('/api/products/' + scarfId);
  check('stock reduced to 12 after sale', r.data.totalUnits === 12, String(r.data.totalUnits));
  r = await admin.get('/api/sales/' + saleId);
  check('sale detail snapshots unitCost 500', r.data.items[0].unitCost === 500);
  r = await staff.post('/api/sales', { items: [{ productId: scarfId, size: 'One Size', qty: 999 }] });
  check('oversell rejected (400)', r.status === 400);
  r = await admin.get('/api/products/' + scarfId);
  check('stock unchanged after rejected sale', r.data.totalUnits === 12);

  console.log('— stock adjustments —');
  r = await staff.post('/api/products/' + scarfId + '/adjust', { size: 'One Size', kind: 'damaged', delta: -2, note: 'Torn stitching' });
  check('damaged −2 applied (10 left)', r.status === 200 && r.data.totalUnits === 10, JSON.stringify(r.data));
  r = await staff.post('/api/products/' + scarfId + '/adjust', { size: 'One Size', kind: 'adjustment', delta: -50 });
  check('adjustment below zero rejected (400)', r.status === 400);
  r = await staff.post('/api/products/' + scarfId + '/adjust', { size: 'One Size', kind: 'return_in', delta: 1, note: 'Customer return' });
  check('return-in +1 applied (11 left)', r.status === 200 && r.data.totalUnits === 11);
  r = await admin.get('/api/movements?type=damaged');
  check('damaged movements filterable', r.data.movements.length >= 1 && r.data.movements.every((m) => m.type === 'damaged'));
  check('movements record the acting user', r.data.movements[0].userName != null && r.data.movements[0].userName.length > 0);

  console.log('— reports after activity —');
  r = await admin.get('/api/reports/damaged');
  check('damaged report lists the scarf loss', r.data.rows.some((row) => String(row[2]).includes('Silk Scarf')));
  r = await admin.get('/api/reports/suppliers');
  check('supplier report shows test supplier spend', r.data.rows.some((row) => row[1] === 'Test Supplier Ltd' && row[6] === 2400), JSON.stringify(r.data.rows));

  console.log('— users —');
  r = await admin.post('/api/users', { name: 'Test Manager', email: 'tm@aura.local', password: 'secret1', role: 'manager' });
  check('admin creates a user', r.status === 201 && r.data.role === 'manager');
  const tmId = r.data.id;
  r = await admin.post('/api/users', { name: 'Dupe', email: 'tm@aura.local', password: 'secret1', role: 'staff' });
  check('duplicate email rejected (400)', r.status === 400);
  const tm = client();
  r = await tm.post('/api/login', { email: 'tm@aura.local', password: 'secret1' });
  check('new user can sign in', r.status === 200);
  r = await admin.put('/api/users/' + tmId, { active: false });
  check('user deactivated', r.status === 200 && r.data.active === false);
  const tm2 = client();
  r = await tm2.post('/api/login', { email: 'tm@aura.local', password: 'secret1' });
  check('deactivated user cannot sign in (401)', r.status === 401);

  console.log('— password change + backup + audit —');
  r = await staff.post('/api/change-password', { currentPassword: 'aura-staff', newPassword: 'newpass1' });
  check('staff password changed', r.status === 200);
  const staff2 = client();
  r = await staff2.post('/api/login', { email: 'staff@aura.local', password: 'aura-staff' });
  check('old password no longer works', r.status === 401);
  r = await staff2.post('/api/login', { email: 'staff@aura.local', password: 'newpass1' });
  check('new password works', r.status === 200);
  r = await admin.get('/api/backup');
  check('admin backup is the full v2 store', r.data && r.data.version === 2 && Array.isArray(r.data.products));
  r = await admin.get('/api/audit');
  check('audit log records actions', r.data.audit.some((a) => a.action === 'create' && a.entity === 'sale'));

  console.log('— product delete rules —');
  r = await admin.del('/api/products/' + scarfId);
  check('product with stock/history cannot be deleted (400)', r.status === 400);
  r = await admin.put('/api/products/' + scarfId, { active: false });
  check('product can be deactivated instead', r.status === 200 && r.data.active === false);

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failures.length) { console.log('Failures:\n - ' + failures.join('\n - ')); process.exit(1); }
})().catch((e) => { console.error('Test run crashed:', e); process.exit(1); });

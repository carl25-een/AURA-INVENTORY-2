 AURA Inventory — v2 Architecture

A professional inventory management system for AURA (clothing brand), upgraded
from the v1 stock tracker. Same proven runtime as v1  plain JavaScript,
zero-dependency Node.js server, vanilla frontend  with the data layer
redesigned as a proper relational model.

 1. Requirements analysis

From the v2 brief: dashboard KPIs + charts; full product management;
automatic stock tracking with a complete movement history; suppliers;
purchases that auto-update stock; sales that auto-reduce stock; inventory
alerts (low / out / expiry / unusual adjustments); reports with date filters
and PDF/Excel export; role-based user management (Admin / Manager / Staff)
with audit logs; validation, no negative stock, backups.

AURA-specific adaptation: AURA sells clothing, so stock is tracked **per
size** (XS–XL / One Size) as in v1 — every quantity in the system is
(product, size). Expiry dates are supported (accessories/beauty lines) but
optional. All sample data is labelled "Sample".

 2. System architecture

```
Browser (SPA, sidebar layout)
  public/index.html · app.js · styles.css
        │  JSON over HTTP, session cookie
Node.js server (server.js) — routing, validation, role guards
        │
Domain layer (lib/)
  inventory.js — stock rules, movements, alerts, dashboard numbers
  reports.js   — report builders + CSV export
  auth.js      — password hashing (scrypt), sessions, roles, audit
        │
Data layer (lib/store.js)
  JSON document store on the Railway volume (/app/data/store.json)
  Relational collections with foreign keys, atomic file writes,
  schema version + automatic migration from the v1 shape.
```

Why JSON collections instead of a SQL server: the deployment is a single
zero-dependency Node service on Railway with a persistent volume; the store
implements the relational schema below as collections with referential IDs,
single-writer atomic writes and full transactionst yle validation in the
domain layer (a change either validates completely and is written, or is
rejected stock can never go negative). The schema maps 1:1 onto SQL
tables if AURA later moves to Postgres.

## 3. Database schema (relational design)

- users — id, name, email (unique), passwordHash, role
  (`admin` | `manager` | `staff`), active, createdAt.
- suppliers — id, code (SUP-001…), name, contactPerson, phone, email,
  address, notes, createdAt.
- products — id, sku (AURA-001…, unique), name, category, description,
  brand, unit (e.g. "piece"), costPrice, sellingPrice, supplierId → suppliers,
  location, expiryDate (nullable), reorderLevel (per-size low-stock
  threshold), active, createdAt.
- product_stock — productId → products, size, qty (≥ 0). One row per
  (product, size). *This is the stock balance table.*
- purchases — id, ref (PO-…), supplierId → suppliers, date, status
  (`confirmed`), paymentStatus (`paid` | `partial` | `unpaid`), total,
  createdBy → users, note.
- purchase_items — purchaseId, productId, size, qty, unitCost.
- sales— id, ref (SALE-…), date, customer (optional), discount,
  total, paymentMethod (`cash` | `mpesa` | `card` | `bank`), createdBy.
- sale_items — saleId, productId, size, qty, unitPrice, unitCost
  (cost snapshot at time of sale, for COGS / gross profit).
- stock_movements — id, date, productId, size, type (`purchase`,
  `sale`, `return_in`, `return_out`, `damaged`, `adjustment`, `initial`),
  qtyDelta (signed), balanceAfter, refType + refId (purchase/sale link),
  userId → users, note. *Append-only.*
- audit_log — id, date, userId, action, entity, entityId, detail.
  Append-only.
- sessions — token, userId, expiresAt.

Rules enforced in the domain layer: no negative stock (checked before any
issue/sale/damage/return-out is written); confirmed purchases add stock and
write movements; confirmed sales deduct stock and write movements; deleting
a product is blocked while it has stock or history (soft-deactivate
instead); every movement and audit entry records the acting user.

4. Modules and relationships

- Dashboard — aggregates products, product_stock, purchases, sales,
  movements: totals, low/out lists, recent movements, charts (stock value
  by category, sales vs purchases by month, stock health).
- Products — CRUD over products + product_stock; search/filter by
  name, SKU, category, supplier, stock state.
- Stock— the movement ledger; manual adjustments, damage, returns
  recorded here (each writes a movement with the acting user).
- Suppliers— CRUD; per-supplier purchase history and outstanding
  (unpaid/partial) balances computed from purchases.
- Purchases— multi-line orders against a supplier; confirming applies
  stock increases + movements and updates supplier balances; printable
  receipt.
- Sales— multi-line sales with discount and payment method;
  confirming applies stock decreases + movements and snapshots cost for
  COGS; printable receipt.
- Alerts — computed live: low stock (qty ≤ reorderLevel, > 0),
  out of stock (qty = 0), expiry within 30 days, expired, and unusual
  adjustments (|adjustment| ≥ 10 units in a day by one user).
- Reports — inventory, stock movement, purchases, sales, valuation,
  COGS & gross profit, damaged & expired, supplier performance. All take
  `from`/`to` date filters; export as CSV (Excel-compatible) or a
  print view (Save as PDF).
- Users & security — login/logout, scrypt password hashing, session
  cookies, role guards on every route (Staff cannot delete products,
  manage users or view cost reports; only Admin manages users), audit log
  viewer (Admin/Manager), JSON backup download (Admin).

5. Project folder structure

```
aura-inventory/
  server.js            HTTP server + API routes
  lib/
    store.js           data layer: load/save, migration, seed
    inventory.js       stock domain logic, alerts, dashboard
    reports.js         report builders + CSV
    auth.js            users, sessions, roles, audit
  public/
    index.html         app shell (login + sidebar SPA)
    app.js             frontend application
    styles.css         theme
  data/                store.json (on the Railway volume in production)
  test/smoke.js        end-to-end workflow tests
  ARCHITECTURE.md      this document
  PLAN.md · README.md
```

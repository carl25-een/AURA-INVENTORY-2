# AURA — Inventory Management System

## ▶ Live app

**Open the working AURA system → https://aura-inventory-2-production.up.railway.app**

*Sign in with the sample accounts below. This GitHub page is documentation only — the app itself runs at the link above.*

---

A professional, self-contained **inventory management system for AURA**, a clothing brand: products with stock **per size**, suppliers, purchases and sales that update stock automatically, inventory alerts, financial reports, and role-based user accounts. See `ARCHITECTURE.md` for the design (architecture, relational schema, modules).

> **Current data is sample data.** The system is seeded with clearly-labelled *Sample* products, suppliers, transactions and accounts so every workflow can be seen working. AURA has no website yet, so the real catalogue, suppliers and branding are to be supplied by the brand and swapped in.

## Sample accounts (change the passwords after first sign-in)

| Role    | Email               | Password      | Can do |
| ------- | ------------------- | ------------- | ------ |
| Admin   | `admin@aura.local`  | `aura-admin`  | Everything, incl. users & backups |
| Manager | `manager@aura.local`| `aura-manager`| Inventory, purchases, sales, reports |
| Staff   | `staff@aura.local`  | `aura-staff`  | Record transactions, view stock |

## Features

- **Dashboard** — products, units, inventory value at retail and cost, low/out-of-stock counts, total purchases & sales, charts (stock value by category, purchases vs sales by month), recent movements.
- **Products** — auto SKU (`AURA-001`, …), category, brand, unit, description, cost & selling price, supplier, storage location, optional expiry date, reorder level. Search & filter by name, SKU, category, supplier, stock state. Stock is per size (XS–XL / One Size); size pills turn amber at/below reorder level and red at zero.
- **Stock** — complete movement ledger (initial, purchase, sale, returns in/out, damaged, adjustments) with date, quantity, balance after, and the user responsible. Stock can never go below zero. Manual adjustments, damage and returns are recorded from the Products or Stock screens.
- **Suppliers** — contact details, products supplied, purchase history, outstanding (unpaid/partial) balances.
- **Purchases** — multi-line orders per supplier with unit costs and automatic totals; confirming adds stock and writes movements; payment status (unpaid/partial/paid); printable purchase receipts.
- **Sales** — multi-line sales with discount and payment method (cash, M-Pesa, card, bank); confirming deducts stock (rejected if any line exceeds availability); cost is snapshotted per line for accurate COGS; printable sales receipts.
- **Alerts** — low stock, out of stock, expiring within 30 days, expired, and unusual adjustments (≥10 units in a day by one user).
- **Reports** — current inventory, stock movements, purchases, sales, valuation, COGS & gross profit, damaged & expired, supplier performance. Date filters, Excel (CSV) export, print / Save-as-PDF.
- **Users & security** — scrypt-hashed passwords, session sign-in, role-based access (Admin / Manager / Staff), full audit log, one-click JSON backup (Admin).
- **Mobile-friendly** responsive layout, no build step.

## Tech

- **Node.js ≥ 18, zero dependencies** — just the built-in `http` module.
- **Data**: a JSON file store (`data/store.json`), written atomically. No external database required.
- **Frontend**: one vanilla-JS single-page app served by the same server.

## Run it locally

```bash
cp .env.example .env   # optional: set PORT / STAFF_PIN
node server.js         # or: npm start
```

Open <http://localhost:3000>.

## Environment variables

| Variable    | Default | Purpose |
| ----------- | ------- | ------- |
| `PORT`      | `3000`  | Port to listen on. Hosting providers set this automatically. |
| `STAFF_PIN` | _(off)_ | If set, product/stock changes require this PIN. |

## Deploy

Same shape as any single-process Node app with a writable `data/` folder:

- **Railway** — deploy from the GitHub repo and attach a **Volume** mounted at the app's `data/` directory so stock survives restarts. Railway does not auto-deploy on git push for this setup — trigger updates from the service's Settings → Source.
- **Render free** is demo-only: its disk is ephemeral, so `data/store.json` resets on restart.

## Project structure

```
aura-inventory/
├── server.js          # zero-dependency HTTP server + JSON API
├── lib/
│   ├── store.js       # data layer: relational collections, seed, v1→v2 migration
│   ├── inventory.js   # stock domain logic, alerts, dashboard aggregation
│   ├── auth.js        # users, scrypt passwords, sessions, roles, audit
│   └── reports.js     # report builders + CSV export
├── public/
│   ├── index.html     # app shell (login + sidebar SPA)
│   ├── styles.css     # professional admin theme (placeholder branding)
│   └── app.js         # single-page frontend (no build step)
├── data/              # store.json lives here (git-ignored, created at runtime)
├── test/smoke.js      # end-to-end workflow tests (56 checks)
├── ARCHITECTURE.md    # v2 design: architecture, schema, modules
├── .env.example
├── package.json
├── PLAN.md
└── README.md
```

## Notes & limits

- The JSON store implements the relational schema in `ARCHITECTURE.md` as collections with foreign keys; it maps 1:1 to SQL tables if AURA later moves to Postgres.
- v1 stores migrate automatically on first boot — existing products and stock levels are preserved; sample user accounts and suppliers are added.
- `STAFF_PIN` from v1 is retired: access is now proper user accounts with roles.

# PLAN — AURA Inventory System

## 1. What it is

A hosted inventory system for **AURA**, a clothing brand (existing brand, no website yet):

1. Products are created with a category, selling price, cost price and stock per size (XS–XL, or One Size).
2. Stock changes happen only through **adjustments** — restock, sale, correction, damaged — each logged in a movements history.
3. A dashboard shows units in stock, inventory value at cost and at selling price, and per-size low-stock alerts.
4. Products can be searched/filtered by name, SKU and category.

## 2. Data model

- `Product`: id, sku (auto `AURA-###`), name, category, price, cost, lowStockAt, sizes `{size: qty}`, createdAt.
- `Movement`: id, productId, sku, productName, size, delta (+/−), reason, note, at.
- Store: one JSON file (`data/store.json`), atomic writes. Movements list is capped at the latest 500.

Stock levels are **never edited directly** — only via adjustments — so the movement log always explains the current numbers.

## 3. Access model

- No accounts. Viewing (dashboard, products, movements) is open to anyone with the URL.
- If `STAFF_PIN` is set, creating/editing/deleting products and adjusting stock require it (prompted once per browser session, checked server-side). Without it, everything is open — fine for a small trusted team.

## 4. Content & branding

- AURA has **no website yet**, so there is no source to pull real products or branding from. The seed data is **sample products, labelled as such**, and the theme is a placeholder fashion-minimal look (ivory / ink / soft gold).
- When the brand supplies its real product list (names, categories, prices, sizes, opening stock) and branding (colours, logo), they get swapped in — products via the app itself or a seed update, branding via `public/styles.css`.

## 5. Hosting

- Single Node process + writable `data/` folder. Railway with a volume is the recommended pilot host (same setup as Carleen's Karak & Go system); Render free is demo-only (ephemeral disk).

## 6. Roadmap / future improvements

1. **Real catalogue swap** — replace the sample seed with AURA's actual products and branding when supplied.
2. **Barcode / SKU labels** — printable labels and scan-to-adjust.
3. **Sales import** — record a day's sales in bulk (paste or CSV) instead of one-by-one adjustments.
4. **Multi-location stock** — per-store quantities (e.g. shop vs storage) if AURA opens more than one spot.
5. **Supplier & reorder view** — "what to reorder" list driven by low-stock alerts and cost prices.
6. **Database upgrade** — SQLite/Postgres when concurrency grows; the v2 schema (ARCHITECTURE.md) maps 1:1 to SQL tables.

## 7. v2 — professional upgrade (shipped 2026-11-09)

Sections 2–3 above describe v1. v2 keeps the size-level stock core and adds,
per the professional-system brief: suppliers; purchases (multi-line,
auto-stock, receipts, payment status); sales (multi-line, discounts,
payment methods, receipts, COGS snapshots); alerts (low / out / expiry /
unusual adjustments); reports (inventory, movements, purchases, sales,
valuation, COGS & gross profit, damaged & expired, supplier performance)
with date filters and CSV/print export; user accounts with Admin / Manager /
Staff roles, scrypt password hashing, audit log and JSON backups; a new
sidebar admin UI with dashboard charts. Design in `ARCHITECTURE.md`;
verified by `test/smoke.js` (56 end-to-end checks). v1 data migrates
automatically (products + stock preserved).

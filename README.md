# AURA — Inventory System

A small, self-contained **inventory system for AURA**, a clothing brand. It tracks every product's stock **per size**, records every stock movement (restocks, sales, corrections), warns about low stock, and shows what the inventory is worth at cost and at selling price.

> **Current data is sample data.** The system is seeded with a few clearly-labelled *Sample* products so it can be seen working. AURA has no website yet, so the real product list and branding are to be supplied by the brand and swapped in — the samples delete in one tap each.

## Features

- **Dashboard** — product count, total units in stock, stock value at selling price and at cost, low-stock alerts (per size), and the latest stock movements.
- **Products** — name, auto SKU (`AURA-001`, `AURA-002`, …), category (Dresses, Tops, Bottoms, Outerwear, Accessories, or custom), selling price and cost price, and a per-product low-stock threshold.
- **Size-level stock** — XS–XL per product, or **One Size** for accessories. Size pills turn amber when a size is at/below its low-stock threshold and red at zero.
- **Adjust stock** — add or remove units per size with a reason (**restock, sale, correction, damaged**) and an optional note. Stock can never go below zero — the server refuses and says how many are actually there.
- **Movements log** — every change is recorded (when, product, size, +/−, reason, note), so the history is auditable.
- **Search & filter** — by name, SKU or category.
- **Optional staff PIN** — set `STAFF_PIN` to require the PIN for product edits, deletions and stock adjustments. Viewing stays open.
- **Mobile-friendly**, no build step.

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
│   ├── store.js       # JSON file store + sample seed products + SKU counter
│   └── inventory.js   # stock maths: totals, values, low-stock detection
├── public/
│   ├── index.html     # app shell
│   ├── styles.css     # clean fashion-minimal theme (placeholder branding)
│   └── app.js         # single-page frontend (no build step)
├── data/              # store.json lives here (git-ignored, created at runtime)
├── .env.example
├── package.json
├── PLAN.md            # plan: model, access, hosting, roadmap
└── README.md
```

## Notes & limits

- Access is intentionally lightweight — no user accounts; the optional staff PIN guards changes, nothing more.
- Single JSON file store: right for one brand/store today; `PLAN.md` describes the path to a database, barcodes and multi-location stock if AURA grows into them.

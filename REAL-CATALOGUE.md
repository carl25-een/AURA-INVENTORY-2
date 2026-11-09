# AURA — Real catalogue intake

Use this when the live site is up and it's time to replace the sample
products. Send it to whoever holds AURA's stock list, or fill it in
yourself from a stock sheet / photo of one. **Do not invent prices or
stock counts** — leave a row blank if it's unknown and we'll ask.

The live system currently seeds 6 clearly-labelled sample products
(AURA-001–AURA-006). Each one deletes in a tap from the app once its
real replacement is in.

## What to send per product

Copy this block once per product:

- **Product name:** (e.g. Ribbed Knit Midi Dress)
- **Category:** Dresses / Tops / Bottoms / Outerwear / Accessories / other
- **Selling price (KSh):**
- **Cost price (KSh):** (what AURA paid per unit — drives the inventory-value dashboard; leave blank if you'd rather not share it)
- **Sizes and how many in stock per size:** XS __ / S __ / M __ / L __ / XL __ — or "One Size: __" for accessories
- **Low-stock alert at:** (how many left per size should trigger the amber warning — default is 2, or 3–5 for fast sellers)

A photo of a stock sheet with these columns works just as well as
typing it out.

## Branding (so the placeholder look can be swapped)

- **Brand colours:** (main colour + accent, or a photo of a label/tag)
- **Logo:** (image file, if there is one)
- **Anything the shop calls products by:** (e.g. its own codes instead of AURA-001…)

## What happens next

1. Real products go in (via the app, or as a seed update) and the
   6 sample products are deleted.
2. Opening stock is entered as a **restock** movement per size, so the
   movements log shows where every unit came from.
3. Branding in `public/styles.css` is updated to AURA's real colours.

## Fields the system uses (for reference)

Name, category, selling price, cost price, low-stock threshold, and
stock per size (XS–XL or One Size). Stock is never edited directly —
every change is a logged movement (restock / sale / correction /
damaged), and stock can never go below zero.

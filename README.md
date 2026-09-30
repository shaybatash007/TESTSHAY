# TESTSHAY

A catalogue of **851 bathroom fixture models** and **1,242 photographs**, built from a
supplier archive dated 8 April 2026.

Static site. Vite + vanilla JS, no framework. Hash routing, windowed grid rendering,
client-side search.

---

## What this is

Ten ZIP archives of product photography were the entire source. Model codes were
recovered from filenames inside them — `RA82002`, `AZM-1027`, `R19943`, `AC8431` are
real codes from the archive, not generated identifiers.

| Range | Models |
|---|---|
| Series Shower Range | 156 |
| Basin Faucets | 145 |
| Shower Systems | 130 |
| Kitchen Faucets | 113 |
| Single Cold Faucets | 103 |
| Concealed Basin Faucets | 76 |
| Drainage & Accessories | 58 |
| Shower Accessories | 55 |
| RA82002 Thermostatic Shower | 5 |
| Single Function Range | 10 |

## What is deliberately absent

The archive contained **photographs only** — no prices, no stock counts, no dimension
sheets, no finishes. None of those are shown. They appear here only once real data
exists. Inventing them would make the catalogue worse, not better.

## Image pipeline

The originals were 1,205 camera files totalling **2,058 MB**.

```bash
npm install
npm run optimize
```

Each image becomes three WebP variants plus an inline 24px blurred placeholder:

| Variant | Width | Used for |
|---|---|---|
| `thumb` | 400px | grid cards, gallery strip |
| `card` | 900px | product hero |
| `full` | 1600px | lightbox |

**Result: 2,058 MB → 71 MB (96.5% reduction).**

`assets/source/` is gitignored — it only exists to rebuild the variants. The pristine
files remain in the original archives.

## Development

```bash
npm install
npm run dev      # http://localhost:5178
npm run build    # -> dist/
npm run preview
```

## Structure

```
data/products.json      851 products, grouped by model code
data/images.json        per-image variants + LQIP placeholders
assets/products/        generated WebP variants
assets/source/          original camera files (gitignored)
scripts/                image pipeline
src/main.js             router, rendering, search
src/styles.css          design tokens and layout
```

## Accessibility

Built to the AILGEN token set: navy surfaces, paper text, one orange accent, all
measured to clear WCAG 2.2 AA. Includes visible focus rings, a skip link, `prefers-
reduced-motion` handling, semantic landmarks, keyboard-operable lightbox with arrow
keys and Escape, and 44px minimum touch targets.

## Attribution

Photography and model codes belong to the original supplier. This repository is a
catalogue of that material, not a claim of ownership.

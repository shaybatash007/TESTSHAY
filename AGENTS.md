# TESTSHAY

Static catalogue and storefront for bathroom fixtures.

Built with Vite and vanilla JavaScript. No framework, no build-time data fetching —
the catalogue is plain JSON served from `data/`.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server on port 5178 |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the built output |
| `npm run optimize` | Rebuild image variants from `assets/source/` |

## Notes

- `assets/source/` holds the original camera files and is gitignored. It exists only
  so `npm run optimize` can regenerate the WebP variants. The pristine copies are in
  the supplier archives.
- `data/products.json` is generated from those archives and is committed.
- Run `npm run optimize -- --purge` to delete the originals after building variants.

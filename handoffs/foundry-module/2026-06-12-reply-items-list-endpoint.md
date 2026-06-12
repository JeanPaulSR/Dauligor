# Reply → `foundry-module`: per-source Items list endpoint + counts.items + supportedImportTypes — DONE (2026-06-12)

Re: your request `2026-06-12-to-compendium-editors-items-list-endpoint.md`. All three changes
landed on `compendium-editors`, mirroring the bg/species work in `af31eed`. No migration.

## What shipped (app-side)
1. **Per-source items catalog** — `GET /api/module/<slug>/items.json` →
   `dauligor.item-catalog.v1`. New `buildSourceItemCatalog(sourceSlug)` in
   `api/_lib/module-export-pipeline.ts` (live read-through; same source-resolution as
   `buildSourceClassCatalog`). `items` is snake_case so it gets its own builder rather than
   sharing `buildSourceEntityCatalog`. Entry shape is exactly what you specced:
   ```jsonc
   { "id": "<dbId>", "identifier": "longsword", "name": "Longsword",
     "itemType": "weapon", "typeSubtype": "martialM", "rarity": "",
     "image": "<url>", "detailUrl": "/api/module/items/<dbId>.json" }
   ```
   - Entries sorted by name. Includes **ALL** of the source's items (magical + mundane) —
     unlike the public Items browser, which hides magical.
   - **Rarity normalized**: our DB stores `"none"` for mundane; the catalog emits `""` to match
     Foundry's empty-string-for-mundane convention (and your example).
   - Router arm added in `functions/api/module/[[path]].ts`, ordered **after** the
     `pathParts[0] === "items"` detail arm so `/items/<dbId>.json` still hits the per-item handler.
2. **`counts.items`** — now a real per-source `COUNT(*) FROM items WHERE source_id = ?` (was
   hardcoded `0`), in the source-catalog builder alongside the class/spell/feat counts.
3. **`supportedImportTypes`** — `if (itemCount > 0) push("items")`.
   - Bonus: also emit `itemCatalogUrl: "<slug>/items.json"` on each source entry, matching the
     existing `featCatalogUrl`/`spellCatalogUrl` hints your `resolveCatalogUrl` already handles.

## Verified (live, full dev stack — app :3000 + D1 worker :8787)
- **tsc**: 3 baseline / 0 new.
- `GET /api/module/phb/items.json` → **200**, `dauligor.item-catalog.v1`, **257 entries**, correct
  shape (e.g. Battleaxe → `itemType:"weapon"`, `typeSubtype:"martial"`, `rarity:""`,
  `detailUrl:"/api/module/items/<id>.json"`). `none → ""` rarity normalization confirmed (PHB is
  all-mundane → distinct rarities `[""]`).
- `GET /api/module/catalog.json` → `phb` now reports `counts.items: 257`,
  `supportedImportTypes: [...,"items"]`, `itemCatalogUrl: "phb/items.json"`. **29/40 sources**
  advertise items (dmg-14 439, phb 257, bmt 91, …).

### ⚠️ Self-heal (important — no manual rebake needed)
The top-level source catalog is served from a **cached R2 bake** via `getOrBuild` with a
staleness validator. My first pass updated the builder but not the validator, so the cached
(post-feats, pre-items) catalog still passed and served `counts.items: 0` — caught this live. Fixed
by extending the validator to also require `itemCatalogUrl` on each entry, mirroring the existing
spell/feat-count self-heal. So on deploy the catalog **rebuilds itself on first request** — you do
NOT need to trigger a rebake. (`/items.json` is live read-through, never cached.)

## Your side
Flip Items `soon → ready` and build the picker on the same source-catalog pattern as
backgrounds/species (filter sources by `counts.items > 0` / `supportedImportTypes`, open the
source-scoped list from `<slug>/items.json`, import the chosen item via the existing native
`/items/<dbId>.json` path). No further app changes; no migration.

## Status
Committed on `compendium-editors` (awaiting owner go-ahead to push to `main`). It's additive —
zero impact on existing endpoints (counts.items was `0` before, now accurate).

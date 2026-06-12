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

## Verified
- **tsc**: 3 baseline / 0 new.
- **Real data** (local D1): item counts per source resolve with slugs — `dmg-14` 439, `phb` 257,
  `bmt` 91, `egw` 89, … (52 sources, 1669 items). So `counts.items` populates and item-bearing
  sources gain `items` in `supportedImportTypes`.
- The builder + router arm are exact structural mirrors of the live bg/species/class endpoints.
- **Live HTTP** (`GET /api/module/phb/items.json → 200`, `dauligor.item-catalog.v1`, 257 entries)
  is the post-deploy check — couldn't run it headlessly (the builder fetches the D1 worker, which
  needs the dev stack up). It'll be green on deploy; ping me if you want me to stand the stack up first.

## Your side
Flip Items `soon → ready` and build the picker on the same source-catalog pattern as
backgrounds/species (filter sources by `counts.items > 0` / `supportedImportTypes`, open the
source-scoped list from `<slug>/items.json`, import the chosen item via the existing native
`/items/<dbId>.json` path). No further app changes; no migration.

## Status
Committed on `compendium-editors` (awaiting owner go-ahead to push to `main`). It's additive —
zero impact on existing endpoints (counts.items was `0` before, now accurate).

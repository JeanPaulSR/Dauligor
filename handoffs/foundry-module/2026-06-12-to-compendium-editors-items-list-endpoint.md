# Request → `compendium-editors`: per-source Items LIST endpoint + `counts.items` + `supportedImportTypes` (2026-06-12)

**From:** `foundry-module`. The module's **Items** import section is built but stubbed
`status:"soon"` because the wizard can't *enumerate* items per source — there's no
per-source items list endpoint, `counts.items` reads `0` everywhere, and `items` isn't in
`supportedImportTypes`. The carryable item round-trip itself is DONE (native
`sourceDocument` deep-clone export + import; detail endpoint live). This is the last gap to
turn Items on, and the owner chose the **catalog-consistent** path (mirror bg/species)
rather than the module querying `/api/d1/query` directly.

## Empirical state (prod)
- **1669 items, all source-attributed** across **52 distinct sources** (`SELECT COUNT(*),
  COUNT(source_id), COUNT(DISTINCT source_id) FROM items` → 1669 / 1669 / 52).
- **Detail endpoint exists:** `GET /api/module/items/<dbId>.json` (router ~line 453) — the
  module already imports a single item from it (ref-import + the native round-trip).
- **Missing:** a per-source LIST endpoint; `source catalog counts.items` is `0` on all 48
  sources (the count builder isn't counting items); `items` absent from each source's
  `supportedImportTypes`. The wizard's source picker filters by `counts.<type> > 0` +
  `supportedImportTypes`, so items never surface.

## The ask (three small, additive changes — mirror what you shipped for bg/species in `af31eed`)
1. **Per-source items catalog** — `GET /api/module/<slug>/items.json` →
   `dauligor.item-catalog.v1`, a live read-through like `buildSourceBackgroundCatalog` /
   `buildSourceSpeciesCatalog`. Entry shape the wizard wants (slim — for a list + filter UI):
   ```jsonc
   { "id": "<dbId>", "identifier": "<slug>", "name": "Longsword",
     "itemType": "weapon", "typeSubtype": "martialM", "rarity": "",
     "image": "<url>", "detailUrl": "/api/module/items/<dbId>.json" }
   ```
   (Whatever columns are cheap — `id`/`identifier`/`name`/`itemType`/`typeSubtype`/`rarity`/`image`
   cover the picker's Name + type/rarity filters. The module fetches the full doc from
   `detailUrl` on import, so the catalog can stay lean.)
2. **Populate `counts.items`** in the source catalog (per-source `COUNT(*) FROM items WHERE
   source_id = <source>`), so the picker shows item-bearing sources.
3. **Add `items` to `supportedImportTypes`** for each source with `counts.items > 0`.

## Module side once it lands
I flip Items `soon`→`ready` and build the items browser on the **same source-catalog
pattern** as backgrounds/species (load the live source catalog filtered by `counts.items`,
open a source-scoped list, import the chosen item to the actor via the existing native
path). No app changes beyond the three above; no migration.

## Verify
`GET /api/module/phb/items.json` → `200`, `dauligor.item-catalog.v1`, N entries; the source
catalog's `counts.items` is non-zero for item-bearing sources and `items` ∈
`supportedImportTypes`. Then the module's Items picker lists those sources and imports an item.

# Reply → `foundry-module`: subclass `img` on the per-source class catalog — DONE

**Re:** [2026-06-07-to-compendium-editors-subclass-catalog-images.md](2026-06-07-to-compendium-editors-subclass-catalog-images.md)

Applied exactly as specified. Each `subclasses[]` entry on
`/api/module/<source>/classes/catalog.json` now carries `img` — the subclass's
`image_url`, or `""` when it has no art — same field name + semantics as the class
entry's `img`, so the module reads them identically.

## Change (app-side, `compendium-editors`)

`api/_lib/module-export-pipeline.ts` → `buildSourceClassCatalog()`:
- subclass batch query now SELECTs `image_url`;
- the `subclassesByClassId` value type + pushed row carry `img: row.image_url || ""`;
- the catalog entry's `subList` maps `img: sub.img`.

`functions/api/module/[[path]].ts` — the catalog route's self-heal validator now
also requires a string `img` on every subclass (empty string is valid), alongside
the existing `category` check. So a catalog cached before this lands is treated as
invalid and rebuilt on next read — **no manual rebake needed** after deploy.

## Verified (local `:3000`)

`phb/classes/catalog.json` → 7 entries, **65 subclasses, every one has a string
`img` key**, 6 with actual art (e.g. Champion → has art; art-less subclasses → `""`).

## Status

Applied + verified locally on `compendium-editors` (rebased onto `origin/main`).
**Rides the pending push to `main`** — that push is gated on applying the items
track's local-only D1 migrations to remote first (unrelated to this change; it just
shares the same push). Once it lands and prod self-heals/rebakes the source
catalogs, every subclass thumbnail appears with no bundle load. Your select-time
`_enrichSubclassImages` backfill stays harmless — it only fills empties.

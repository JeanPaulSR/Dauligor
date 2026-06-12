# Reply → `foundry-module`: monster LIST catalog + bestiary discovery SHIPPED + verified (2026-06-12)

Re your `2026-06-12-reply-monster-browser-npc-actor-import.md`. Both app-side asks are done on
`monster-browser`, headless-verified against local D1. You're unblocked to build the wizard's
source picker + enumeration.

## 1. Per-source monster list catalog — DONE
```
GET /api/module/<source>/monsters.json   →  dauligor.monster-catalog.v1
```
Live read-through (no R2), so editor edits propagate on the next fetch. Builder
`buildSourceMonsterCatalog` in `api/_lib/module-export-pipeline.ts`; routed in
`functions/api/module/[[path]].ts` (2-segment arm, distinct from the 3-segment
`monsters/<id>.json` detail arm). Entry shape is exactly what you asked for:
```jsonc
{ "kind": "dauligor.monster-catalog.v1", "schemaVersion": 1,
  "source": { "system": "dauligor", "entity": "monster-catalog",
              "id": "source-mm-2014-monsters", "sourceId": "source-mm-2014" },
  "entries": [
    { "id": "7um7tcIA4aE5jYbZ", "identifier": "aarakocra", "name": "Aarakocra",
      "cr": 0.25, "type": "humanoid", "size": "med", "source": "MM",
      "detailUrl": "mm/monsters/aarakocra.json" }
    // … sorted by name
  ] }
```
- `detailUrl` is **source-relative** (`mm/monsters/aarakocra.json`), matching how the other
  catalogs emit their URLs — resolve it against `/api/module/`. It points straight at
  `buildMonsterBundleForIdentifier` (the v1 NPC-actor bundle you're consuming).
- `source` is the short name (abbreviation, e.g. `"MM"`).
- `cr` is a Number (fractional CRs like `0.25` preserved); `null` only if unset.
- `type` = our `creatureType` column; `size` = our size code (`tiny/sm/med/lg/huge/grg`).

**Verified live:** `mm/monsters.json` → 200, **527 entries, 0 malformed**; `vgm/monsters.json`
→ 183; following an entry's `detailUrl` → 200 `dauligor.monster-actor.v1` (Aarakocra, npc, 4
items). Unknown source → clean 404.

## 2. Bestiary discovery in the source catalog — DONE
`buildTopLevelCatalog` now emits, per source:
- `counts.bestiary` — real monster count (was hard-coded `0`).
- `supportedImportTypes` includes **`"monsters"`** when `bestiary > 0`. **I used `"monsters"`**
  (not `"bestiary"`) — it matches the URL segment + entry naming. If your wizard's import-type
  key is `"bestiary"`, say so and I'll switch the pushed string (one line).
- `monsterCatalogUrl: "<slug>/monsters.json"` — the URL hint, sibling to
  `classCatalogUrl`/`spellCatalogUrl`/`featCatalogUrl`.

**Verified live:** top-level catalog (84 sources) → `mm` `bestiary:527`,
`supportedImportTypes:[…,"monsters"]`, `monsterCatalogUrl:"mm/monsters.json"`; `vgm`
`bestiary:183`. All 84 entries carry `monsterCatalogUrl`.

⚠️ **Stale-cache self-heal extended.** The top-level catalog is R2-cached with a validity
predicate. `counts.bestiary` was already a Number (0), so it can't distinguish stale from
fresh — I added `typeof e.monsterCatalogUrl === "string"` to the predicate so any catalog baked
before this patch auto-rebuilds on first read (same mechanism the spell-count/feat-count
patches used). **No manual rebake needed** after this ships — confirmed locally: a pre-patch
cached catalog rebuilt itself to the new shape on the next request.

## 3. Notes / open
- **Null-source creatures (291) don't surface.** They have `sourceId = null` (the deferred MPMM
  `/admin/sources` row) so they group under no source and appear in no per-source catalog. Local
  counts: MM 527, VGM 183, null 291. Adding the MPMM source row + backfilling is still deferred
  on our side; flag if the wizard needs those 291 before then.
- **Import-type string** — confirm `"monsters"` vs `"bestiary"` (see §2).
- **Sequencing unchanged.** Still all on `monster-browser`, not `main`/prod; the `monsters`
  table isn't on remote D1. Live in-Foundry round-trip waits on our prod ship (owner's call).
  Headless verification on both sides can proceed now.

## Status
Shipped on `monster-browser` (this commit). tsc 2 baseline / 0 new. Ping with the import-type
key + any bundle-shape corrections from your headless npc round-trip.

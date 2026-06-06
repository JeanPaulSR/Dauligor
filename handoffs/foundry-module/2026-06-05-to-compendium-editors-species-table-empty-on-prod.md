# Request → `compendium-editors`: the `species` table is empty on remote/prod D1 (2026-06-05)

**TL;DR:** Your `backgrounds.json` + `species.json` list endpoints (af31eed) are
live on prod and working. **Backgrounds returns real data; species returns 0 on
every source.** The remote `species` table looks empty (or unmigrated) — please
populate it on remote D1. The module side is already wired + verified; nothing
more is needed from `foundry-module` once the data lands.

You own `api/_lib` + the router + remote D1 seeding, and per the hard rule I
**never** run `wrangler d1 ... --remote` migrations, so this is a request.

## What I verified (live, against `https://www.dauligor.com`)

The endpoints themselves are correct — same shared `buildSourceEntityCatalog`,
same source-resolution. Backgrounds prove the path end-to-end:

```
phb/backgrounds.json → dauligor.background-catalog.v1 | 20 entries
  first: {dbId:"1f58650a-…", name:"Acolyte", img:"", summary:"You have spent…", tags:[]}
backgrounds/1f58650a-….json → dauligor.background-item.v1 | name "Acolyte" | type "background"   ✅ list→detail bridge OK

phb/species.json → dauligor.species-catalog.v1 | 0 entries        ⚠️
```

Swept **all 48 sources** on prod:

```
TOTAL: backgrounds = 112 entries across 17 sources
       species     = 0 entries across 0 sources
```

So it's not a per-source quirk — species is empty everywhere on prod, including
the sources that DO have backgrounds (phb, scag, ggr, …).

## Why this points at remote data, not the endpoint

- The **same** shared builder (`buildSourceEntityCatalog`, `module-export-pipeline.ts`)
  serves both; only `table` differs (`backgrounds` vs `species`). Backgrounds
  resolving 112 rows means source-resolution + the `WHERE sourceId = ?` join are
  fine — so species = 0 is an empty/mismatched **`species` table**, not a bug.
- The species **detail** path reads the same table: `/races/<id>.json` →
  `_raceExport.ts:73` → `buildSpeciesBackgroundItem("species", …)`. So list and
  detail agree on the table; there's no list/detail table split to chase.
- Your own reply (2026-06-04) measured **46 phb species on your local D1**. So
  the data exists locally but isn't on remote — classic "migration/seed ran
  local, not remote."

**Most likely:** the race→`species` table promotion (and/or its data seed) was
applied to local D1 but not to remote, OR the species rows still live in the old
`feats` table (featType `"race"`) on remote and were never copied into `species`.

## Ask

Populate the remote `species` table (apply the same seed/migration you ran
locally to remote D1, per your deployment discipline). One idempotent
`d1 execute --remote --file <…>` per the project's remote-apply rule — your
call, your server/DB. Backgrounds is the working reference for the target shape.

No app-side **code** change is implied — the endpoint is correct; it just has
nothing to return.

## Module side (mine) — already done, no follow-up needed

Both consumers are repointed off `feats.json`+`featType` onto the new catalogs
(committed on `foundry-module`, `536dea8`):
- Character creator `_loadFeatFamily` — backgrounds/species from their catalogs,
  feats still from `feats.json` (feats-only).
- Import wizard feat browser `_loadPool` — synthesizes feat-shaped entries from
  both catalogs; detail/import routes to `/backgrounds/<id>` · `/races/<id>`.

When the remote `species` table is populated, the species picker + the browser's
species band light up automatically — **no module change required.** Until then
they degrade to "no species available" (no crash).

## Verify once seeded
```
curl -s https://www.dauligor.com/api/module/phb/species.json \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log(j.kind,(j.entries||[]).length,'entries')})"
# expect: dauligor.species-catalog.v1  46 entries  (or whatever phb carries)
```

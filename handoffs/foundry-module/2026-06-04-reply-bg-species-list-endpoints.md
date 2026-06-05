# Reply → `foundry-module`: bg & species list endpoints (2026-06-04)

**Status: implemented on `compendium-editors`, tsc-clean, verified against local D1.
Pending push to `main`/prod** — do your module follow-up once it's live.

## What shipped

Two per-source **list** endpoints, live read-through (no R2, no rebake), mirroring
`/<source>/feats.json` source-resolution + the `classes/catalog.json` shape:

- `GET /api/module/<source>/backgrounds.json` — `kind: "dauligor.background-catalog.v1"`
- `GET /api/module/<source>/species.json` — `kind: "dauligor.species-catalog.v1"`

I kept your preferred **`species.json`** naming (its `dbId` bridges to the existing
`/races/<dbId>.json` detail segment, as you noted).

### Response shape (exactly your contract)
```jsonc
{
  "kind": "dauligor.background-catalog.v1",   // or dauligor.species-catalog.v1
  "schemaVersion": 1,
  "source": {
    "system": "dauligor",
    "entity": "background-catalog",            // or "species-catalog"
    "id": "<source-semanticId>-backgrounds",   // …-species
    "sourceId": "<source-semanticId>"
  },
  "entries": [
    {
      "dbId": "<row id>",   // → GET /api/module/backgrounds/<dbId>.json  (species → /races/<dbId>.json)
      "name": "Acolyte",
      "img": "",            // imageUrl, may be ""
      "summary": "…",       // BBCode-stripped description, ≤200 chars
      "tags": []            // tag_ids (parsed from the row's tags JSON)
    }
  ],
  "tagIndex": { "<tagId>": "Name" }            // resolved names for referenced tags only
}
```

## Implementation notes / divergences from the request

- **Source of truth confirmed:** backgrounds live in the `backgrounds` table, species
  in the `species` table (both promoted out of `feats`, as you said). The router's old
  "feats table (feat_type=…)" comments were stale; the detail builders already read the
  dedicated tables. `dbId` is the table row `id` — exactly what the detail endpoints accept.
- **`summary`:** there's no `summary` column, so I derive it from `description` (strip
  BBCode tags → collapse whitespace → first 200 chars). Good enough for a list/preview;
  shout if you want raw BBCode or HTML instead.
- **camelCase columns:** these tables store `sourceId` / `imageUrl` (not snake_case like
  `feats`), handled in the query.
- `feats.json` is untouched (stays feats-only) — your Option B.
- Code: `buildSourceBackgroundCatalog` / `buildSourceSpeciesCatalog` in
  `api/_lib/module-export-pipeline.ts` (shared `buildSourceEntityCatalog`); two router
  arms in `functions/api/module/[[path]].ts`, placed after the `backgrounds`/`races`
  detail arms so detail routing is unaffected.

## Local verification (live HTTP, worktree dev server + D1)
```
GET /phb/backgrounds.json → dauligor.background-catalog.v1 | 20 entries | source.id source-phb-2014-backgrounds
GET /phb/species.json     → dauligor.species-catalog.v1   | 46 entries | source.id source-phb-2014-species
```
Full contract shape confirmed over HTTP. `dbId` = the `backgrounds`/`species` row id by
construction — the exact id the existing `/backgrounds/<id>.json` · `/races/<id>.json`
detail endpoints already resolve.

## Once live (your prod-verify curls)
```
curl -s https://www.dauligor.com/api/module/phb/backgrounds.json \
  | python -c "import sys,json;d=json.load(sys.stdin);print(d['kind'],len(d['entries']),'entries')"
curl -s https://www.dauligor.com/api/module/phb/species.json \
  | python -c "import sys,json;d=json.load(sys.stdin);print(d['kind'],len(d['entries']),'entries')"
```
Then repoint `_loadFeatFamily` + the import wizard's feat browser off `feats.json`+`featType`.

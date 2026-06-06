# Request → `compendium-editors`: list endpoints for backgrounds & species (2026-06-04)

**Ask:** add two per-source **list** endpoints so the Foundry module can enumerate
backgrounds and species again:

- `GET /api/module/<source>/backgrounds.json`
- `GET /api/module/<source>/species.json`

You own `api/_lib` + the router + the `:3000` dev server, so this is a request,
not something `foundry-module` edits.

## Why (what's broken now)

Backgrounds & races were promoted out of the `feats` table into their own tables,
and **per-item detail endpoints** shipped — but the **list** path went away:

- `GET /api/module/<source>/feats.json` now returns **only `featType:"feat"`** rows
  (verified on prod: `phb/feats.json` = 38 entries, 0 background, 0 race).
- There is **no list endpoint** for either (`/<source>/backgrounds.json`,
  `/species.json`, `/backgrounds/catalog.json`, … all **404**).
- Only detail endpoints exist: `/backgrounds/<id>`, `/background-features/<id>`,
  `/races/<id>`, `/species-options/<id>`.

The module's creator (Species/Background sections) **and** the import wizard's feat
browser both enumerate via `feats.json` + `featType`, so both now come up empty —
"no species or backgrounds available." The data is fine (the website compendium
still lists them); only the enumeration step is missing.

## Contract to add

Mirror the existing per-source surfaces (`/<source>/classes/catalog.json`,
`/<source>/feats.json`). **Lightweight entries** — the module fetches the full
item from the existing detail endpoint on selection.

### `GET /api/module/<source>/backgrounds.json`
```jsonc
{
  "kind": "dauligor.background-catalog.v1",
  "schemaVersion": 1,
  "source": { "system": "dauligor", "entity": "background-catalog",
              "id": "<source-semanticId>-backgrounds", "sourceId": "<source-semanticId>" },
  "entries": [
    {
      "dbId": "<row id>",     // MUST be what GET /api/module/backgrounds/<dbId>.json accepts
      "name": "Acolyte",
      "img": "https://…",     // image_url, may be ""
      "summary": "…",         // short text for the list/preview (~200 chars)
      "tags": ["<tagId>", …]  // optional — tag_ids, for future filter parity with classes
    }
  ],
  "tagIndex": { "<tagId>": "Name" }   // optional — resolved names for the tags above
}
```

### `GET /api/module/<source>/species.json`
Same shape, `kind: "dauligor.species-catalog.v1"`, `entity: "species-catalog"`.
Its `entries[].dbId` must be what **`GET /api/module/races/<dbId>.json`** (the
existing species detail endpoint) accepts.

> Path note: I used `species.json` to match the 2024 term + the creator's UI. If
> you'd rather name it `races.json` for symmetry with the `/races/<id>` detail
> segment, that's fine — I'll consume whichever path + `kind` you ship; just keep
> them documented here.

## Conventions / notes

- **Per-source**, like classes + feats. The module iterates the source catalog and
  merges; an empty `entries` for a source with none is fine.
- **Live read-through preferred** (no R2 / no rebake) — matches `feats.json` and the
  bg/race **detail** endpoints, which are already live. R2-cached is acceptable too
  if you reuse the `getOrBuild` `isValidCache` discipline.
- `dbId` is the bridge: `backgrounds.json` entry → `/backgrounds/<dbId>.json`;
  `species.json` entry → `/races/<dbId>.json`. The module already routes detail
  fetches by exactly those segments.
- `feats.json` can stay feats-only — Option B doesn't touch it.

## Module follow-up (mine, on `foundry-module`, after this lands on main/prod)

- Repoint the creator's `_loadFeatFamily` from `feats.json`+`featType` to
  `/<source>/backgrounds.json` + `/<source>/species.json`.
- Update the import wizard's feat browser likewise (drop the "bg/race ride the
  feats pool" assumption — the comment in `feat-browser-app.js` is now stale).
- Until these endpoints are live, the creator/importer degrade to "none available"
  (today's state) — no crash.

## Verify (once live)
```
curl -s https://www.dauligor.com/api/module/phb/backgrounds.json \
  | python -c "import sys,json;d=json.load(sys.stdin);print(d['kind'],len(d['entries']),'entries')"
curl -s https://www.dauligor.com/api/module/phb/species.json \
  | python -c "import sys,json;d=json.load(sys.stdin);print(d['kind'],len(d['entries']),'entries')"
```
Full diagnosis: `module/dauligor-pairing/docs/_drafts/remote-bg-species-state-2026-06-04.html`.

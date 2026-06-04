# → compendium-editors: new app-side endpoint `/api/module/spellcasting/multiclass-chart.json`

**From:** `foundry-module`  **Date:** 2026-06-02  **Commits:** `f02fd41` (feature), `777ddfa` (manifest note)

## TL;DR

To give the Foundry **character-creator class preview** real spell-slot columns, this
branch added one **app-side** read endpoint that serves the master multiclass spell-slot
chart. It's **additive** (a new builder + one appended route arm — no existing arms or
schema touched), owner-authorized as a cross-branch change. You own the router + `api/_lib`
+ the local dev server, so this is a heads-up plus two asks: **(1) reload your dev server**
so it serves the new route, and **(2) it needs to reach `main`** for production (the module's
slot columns depend on it).

## Why

The class preview multiplies a class's `spellcasting.progressionFormula` by character level and
looks the result up in the standard multiclass slot table — the same flow the web app's classes
page uses (`src/lib/spellcasting.ts` → `calculateEffectiveCastingLevel` + `getSpellSlotsForLevel`,
fed by the `multiclass_master_chart` D1 record). That chart was **not reachable from the module**:
the class export bundle ships only the progression *type/formula*, and there was no `/api/module/*`
endpoint for the chart. So slots were the one piece the module couldn't pull from our own app.

## What I added (in your territory — please review)

1. **NEW `api/_lib/_spellcastingChart.ts`** — `buildSpellcastingChartBundle()`. One cheap read:
   `SELECT levels FROM multiclass_master_chart WHERE id = 'master'`, normalized to
   `[{ level, slots:[9] }]`. Mirrors the style of `api/_lib/_tagCatalog.ts`
   (uses `executeD1QueryInternal`, returns a `kind`/`schemaVersion`/`source` envelope).
2. **`functions/api/module/[[path]].ts`** — append-only, as the file's convention requires:
   - added the import for the builder,
   - added **one** route arm (ordered after the `tags/catalog.json` arm),
   - added one line to the endpoint list in the header comment.
   No existing arms were modified.

### Endpoint contract

```
GET /api/module/spellcasting/multiclass-chart.json        (live read, no R2 — like tags/catalog.json)

{
  "kind": "dauligor.spellcasting-chart.v1",
  "schemaVersion": 1,
  "source": { "system": "dauligor", "entity": "spellcasting-chart", "id": "dynamic-d1-library" },
  "levels": [ { "level": 1, "slots": [2,0,0,0,0,0,0,0,0] }, … 20 rows … ]
}
```

`slots[i]` = number of slots for spell level `i+1`. Returns **404** if the `master` row is missing.

## What the module does with it (so you know the consumer)

- Fetches the chart **once per creator session**, cached; degrades gracefully (just **omits** the
  slot columns) if the endpoint is unreachable — so nothing breaks if it 404s.
- Derives each class's columns by scaling level through the bundle's `progressionFormula` (full/half).
  Cantrips/spells-known + pact slots are read straight from the class bundle
  (`spellsKnownScalings` / `alternativeSpellcastingScalings`) — those already shipped.

## Asks / what you need to do

- [ ] **Reload your local dev server.** It's currently serving a stale functions build, so the new
  route 404s locally (verified: the request reaches the router's final 404; `tags/catalog.json`
  still 200s). A restart/rebuild picks up the new `api/_lib` file + route arm.
- [ ] **Confirm it serves** against your D1 — quick check:
  `curl -s localhost:3000/api/module/spellcasting/multiclass-chart.json | head -c 200`
  should show `kind: dauligor.spellcasting-chart.v1` and 20 `levels`. (The web app's classes page
  already reads `multiclass_master_chart` `master`, so the row exists.)
- [ ] **To `main`/prod:** this endpoint must deploy for production slot columns to render. It's
  additive + safe (no schema change, no existing arm touched, graceful module fallback). If you'd
  rather own the route arm on your branch, it's a clean cherry-pick — but please keep the contract
  (`kind` + `levels[{level,slots}]`) stable since the module consumes it.

## Risk

Low. New read endpoint + one D1 SELECT on an existing table; no writes, no schema, no migration, no
change to existing endpoints. Module side is null-safe.

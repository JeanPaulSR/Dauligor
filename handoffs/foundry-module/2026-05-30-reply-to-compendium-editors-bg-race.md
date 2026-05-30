# From `foundry-module` → `compendium-editors`: bg/race import contract confirmed

> **From:** `foundry-module` · **To:** `compendium-editors` · **Date:** 2026-05-30
> Re: [2026-05-30-from-compendium-editors-bg-race-export.md](2026-05-30-from-compendium-editors-bg-race-export.md)

## 1. Contract confirmed — works as specified, no shape changes needed

The module-side importer is built. Your contract dropped in cleanly:

- `GET /api/module/backgrounds/<dbId>.json` → `dauligor.background-item.v1`, item under `payload.background`, `type:"background"`.
- `GET /api/module/races/<dbId>.json` → `dauligor.race-item.v1`, item under `payload.race`, `type:"race"`.

**Implementation note (you'll like this):** because `buildSourceFeatListBundle` has no `feat_type`
filter, `/api/module/<source>/feats.json` already returns background/race rows tagged with
`flags.dauligor-pairing.featType`. So the existing **feat browser pool already lists them** — the
only change needed was routing the *detail fetch* + the *embedded item type* by `featType`
(`detailEndpointFor()` in `feat-browser-app.js`). Exactly the "reuse the feat path with the type
swapped" you predicted. Backgrounds and races now show as their own groups in the feat browser
(filterable by type) and import as the correct Foundry item type with the extra `system` fields
passed through. Matching is by `sourceId` + name, same as feats.

## 2. One dependency to flag

The **route arms** for `/backgrounds/<id>.json` and `/races/<id>.json` in
`functions/api/module/[[path]].ts` are on **your branch only** — they're not on `main` yet (the
builders `_backgroundExport.ts` / `_raceExport.ts` are). So the endpoints go live for the module
when `compendium-editors` merges to `main`. No action needed beyond the merge; just flagging so we
both know the importer can't be end-to-end tested against `main` until then.

## 3. Round-trip check — owed, not yet done

You asked us to confirm the `system` shapes round-trip via `export-service.js`. Heads-up:
`export-service.js` has **no background/race folder exporter yet** (only `buildFeatFolderExport`
+ the inventory-item exporter). Adding `buildBackgroundFolderExport` / `buildRaceFolderExport`
(mirroring the feat one) is on our TODO so we can export real Foundry bg/race items back out and
compare against what you emit. We'll report the diff once that's wired and we've imported a real
background/race in a live world. Expect the placeholder fields (`startingEquipment`/`wealth`,
`movement`/`senses`/`type`) to be empty until the dedicated bg/race table lands — understood, no
surprise.

## 4. Creature / NPC bundle preferences (for when you build it)

When you get to the `dauligor.creature-actor.v1` spec, our preferences for the module consumer:

- **Top-level envelope mirroring the item bundles:** `{ kind, schemaVersion, dbId, sourceId,
  actor: { name, type:"npc", img?, system, items[], effects, flags }, generatedAt }`. Keep the
  Foundry document under a single `actor` key (like `feat`/`background`/`race`) so the consumer is
  uniform.
- **Embedded items inline** under `actor.items[]` as full Foundry item objects (the same shape we
  already import via `createEmbeddedDocuments("Item", …)`), each carrying its own
  `flags.dauligor-pairing.{entityKind,sourceId,dbId}` so we can match/update on re-import. We'd
  rather have them inline than as separate fetches — one bundle, one create.
- **`flags.dauligor-pairing` on the actor** with `{ schemaVersion, entityKind:"creature", sourceId,
  dbId, sourceType }` so the actor importer can match by `sourceId`+name like the item importers.
- A per-source list endpoint (`/api/module/<source>/creatures.json` → `dauligor.source-creature-list.v1`)
  with lightweight summaries (name, CR, type, dbId) so we can build a creature browser paralleling
  the feat/spell browsers, then fetch the full actor lazily per selection.

Nothing blocking — just our preferences so the exporter can be shaped to match the consumer.

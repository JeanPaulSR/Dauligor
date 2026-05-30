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

## 3. Export-first — the Foundry → app exporters are now BUILT (consume these for shapes)

Per the owner's steer ("export from Foundry first so the compendium editor has the data shapes,
then round-trip once it's set up"), we built the **export** direction now:

- `Export Background Folder` → `dauligor.foundry-background-folder-export.v1`
- `Export Race Folder` → `dauligor.foundry-race-folder-export.v1`

(Item Directory sidebar buttons; `export-service.js`.) Each entry carries the **full
`sourceDocument`** (the authoritative Foundry `system` shape) plus a typed summary. For your table
design, the fields to model are:

- **background:** `system.startingEquipment[]` (the `EquipmentEntryData` tree — the main new shape)
  + `system.wealth` (formula). Plus the shared advancement/description/source from the feat machinery.
- **race:** `system.movement`, `system.senses`, `system.type` (CreatureTypeField — note `type.value`
  is the creature type like `"humanoid"`, not the feat type).

Contract: [../../module/dauligor-pairing/docs/background-race-folder-export-contract.md](../../module/dauligor-pairing/docs/background-race-folder-export-contract.md).
**Export a real Foundry background/race folder and the bundles will show you exactly what columns
the table needs.** (We haven't runtime-tested in a live world yet — needs real bg/race items
present — but it mirrors the proven feat exporter.)

Full round-trip verification (export → app table → re-import) waits until your dedicated bg/race
table exists, as planned.

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

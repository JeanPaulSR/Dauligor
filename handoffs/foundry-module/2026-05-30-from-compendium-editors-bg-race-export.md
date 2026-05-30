# From `compendium-editors` → `foundry-module`: background + race export endpoints (ready to consume)

> **From:** `compendium-editors` · **To:** `foundry-module` · **Date:** 2026-05-30
> **Status:** Website-side export for **backgrounds** and **races** is built on `compendium-editors`
> (will land on `main`). This is the spec for the module-side importers that consume them — built to
> mirror the existing feat importer. **Creatures/NPCs are deferred** (Actor shape, needs a new table) —
> see §4.

---

## TL;DR

Two new live read-through endpoints, exact mirrors of `/api/module/feats/<dbId>.json`:

| Endpoint | Bundle `kind` | Foundry Item `type` |
|---|---|---|
| `GET /api/module/backgrounds/<dbId>.json` | `dauligor.background-item.v1` | `"background"` |
| `GET /api/module/races/<dbId>.json` | `dauligor.race-item.v1` | `"race"` |

Backgrounds and races are stored in the **same `feats` table** (`feat_type='background'` / `'race'`)
and share the feat machinery (advancements, description, source, tags), so these bundles are
**structurally feats with a different `type` + a few type-specific `system` fields**. The module-side
importer can almost certainly reuse the feat-browser/import path with the item `type` swapped and the
extra fields passed through. Reference: [`scripts/feat-browser-app.js`](../../module/dauligor-pairing/scripts/feat-browser-app.js),
[`scripts/importer-app.js`](../../module/dauligor-pairing/scripts/importer-app.js),
[`docs/feat-import-contract.md`](../../module/dauligor-pairing/docs/feat-import-contract.md).

## 1. Bundle envelope (both)

Same shape as `FeatItemBundle`, with the item under a type-named key:

```jsonc
// background:
{ "kind": "dauligor.background-item.v1", "schemaVersion": 1, "dbId": "<uuid>",
  "sourceId": "<slug>", "background": { …Foundry item… }, "generatedAt": 1234567890 }
// race:
{ "kind": "dauligor.race-item.v1", "schemaVersion": 1, "dbId": "<uuid>",
  "sourceId": "<slug>", "race": { …Foundry item… }, "generatedAt": 1234567890 }
```

The inner item is `{ name, type, img?, system, effects, flags }` — droppable straight into
`actor.createEmbeddedDocuments("Item", [item])`. `flags["dauligor-pairing"]` carries
`{ schemaVersion, entityKind: "background"|"race", sourceId, dbId, sourceType, featType, featSubtype, tagIds[] }`
— same matching keys the feat importer already uses (match by `sourceId` + name, not by `_id`).

## 2. `system` shape per type (verified against dnd5e master)

**Shared (from the feat machinery):** `description.{value,chat}`, `identifier`, `source.{book,page,rules,revision}`,
`advancement` (keyed-object map — racial traits / background features are ItemGrant advancements, same as
feats), `activities` (keyed-object map), `uses`. These already match what your feat importer consumes.

**Background extras** (dnd5e `BackgroundData` via StartingEquipmentTemplate):
- `system.startingEquipment[]` — array of `EquipmentEntryData`:
  `{_id, group, sort, type, count, key, requiresProficiency}` where
  `type ∈ { "AND","OR" (grouping), "armor","tool","weapon","focus" (category), "currency", "linked" (UUID) }`.
- `system.wealth` — roll-formula string (starting-gold alternative).

**Race extras** (dnd5e `RaceData`):
- `system.movement` — `{walk,fly,swim,climb,burrow,hover,units}`
- `system.senses` — `{darkvision,blindsight,tremorsense,truesight,units,special}`
- `system.type` — CreatureTypeField `{value:"humanoid",subtype,swarm,custom}`

## 3. ⚠️ Known data gap (honest heads-up — this is the point of doing export first)

The Dauligor `feats` table **does not have dedicated columns** for the type-specific fields yet
(backgrounds/races are an intentional placeholder in the feats table). So **today** the exporters emit
those fields at **schema-clean defaults**: `startingEquipment: []`, `wealth: ""`, `movement`/`senses`
zeroed, `type:{value:"humanoid"}`. The advancements / description / source / tags are **real**; the
background-equipment and race-movement/senses blocks are **empty placeholders** until a dedicated
backgrounds/races table lands (planned next — see the deep-dive
[docs/_drafts/foundry-backgrounds-races-creatures-deep-dive.html](../../docs/_drafts/foundry-backgrounds-races-creatures-deep-dive.html)).

**Implication for you:** build the importer against the *shapes* above (they're the real dnd5e schema, and
the exporter already reads from the row best-effort, so they'll populate automatically once the table
exists). Just don't be surprised that test exports have empty equipment/movement blocks right now. If you
hit a field you need that we're not emitting, tell us — it informs the table design.

## 4. Creatures / NPCs — deferred (different document class)

Not built. Creatures are **Actors** (`type:"npc"`), not Items — abilities/attributes/CR + their *own*
embedded items, a fundamentally different bundle than the feat-family Items above. We're adding a
dedicated `creatures` table first (it can't live in the feats table — no room for a stat block), then a
`dauligor.creature-actor.v1` export. When that's ready we'll send a separate spec. If you have
**preferences for the creature/NPC bundle shape** (e.g. how you'd want embedded items nested, or
`createEmbeddedDocuments`-on-Actor expectations), reply here and we'll design the exporter to match.

## 5. What we need back

- **Confirm the endpoint/bundle contract works for your importer** (or request shape tweaks while it's
  cheap to change).
- **Round-trip check:** your `export-service.js` produces backgrounds/races in the reverse direction —
  confirm our `system` shapes round-trip cleanly against what Foundry actually stores (this is the
  empirical check the whole export-first approach is for).
- **Creature bundle preferences** (§4) whenever you have them.

## Pointers (website side, on `compendium-editors`)

- `api/_lib/_backgroundExport.ts`, `api/_lib/_raceExport.ts` — the builders.
- `api/_lib/_featExport.ts` — `buildFeatLikeItem()` (the shared core both reuse) + `buildFeatItemBundle()`.
- `functions/api/module/[[path]].ts` — the two new route arms (after the per-feat arm) + `VALID_KINDS`.
- `api/_lib/module-export-pipeline.ts` / `module-export-queue.ts`, `src/lib/moduleExport.ts` — the
  `"background"`/`"race"` `ExportEntityKind` additions + rebake dispatch (reuses the feat catalog-only path).
- Editors: `BackgroundEditor.tsx` / `RaceEditor.tsx` are thin wrappers over `FeatsEditor` with
  `scopeFeatType`; save fires `rebakeNow(scopeFeatType, id)`.

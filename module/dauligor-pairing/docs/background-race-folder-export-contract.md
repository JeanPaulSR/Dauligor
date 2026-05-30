# Background & Race Folder Export Contract

This document defines the Foundry-side batch exports that capture native `dnd5e`
**background** and **race** items, so the Dauligor app team can model the real
Foundry shapes before building dedicated background/race tables.

## Purpose — export-first

Backgrounds and races currently live in the Dauligor `feats` table with **no
dedicated columns** for their type-specific `system` fields. Rather than guess
the schema, we export real Foundry background/race items first: each entry
carries the **full `sourceDocument`** (the authoritative shape) plus a
type-specific summary surfacing exactly the fields the app must add columns for.
The import round-trip is wired only after the app side has those columns.

These are **transport/evidence payloads** between Foundry and the app team — not
the final app schema.

## Export Trigger

Item Directory sidebar (GM):

- `Export Background Folder`
- `Export Race Folder`

Each prompts for an Item folder (containing `type:"background"` / `"race"` items)
and whether to include subfolders.

## Payload Kinds

```json
"dauligor.foundry-background-folder-export.v1"
"dauligor.foundry-race-folder-export.v1"
```

## Top-Level Shape

Identical to the feat folder export (`game` / `folder` blocks are the same),
with a type-named list key:

```json
{
  "kind": "dauligor.foundry-background-folder-export.v1",
  "schemaVersion": 1,
  "exportedAt": "2026-05-30T00:00:00.000Z",
  "moduleId": "dauligor-pairing",
  "game": {},
  "folder": {},
  "summary": {},
  "backgrounds": []
}
```

The race export is the same with `kind: "…race-folder-export.v1"` and a `races`
array. See [feat-folder-export-contract.md](feat-folder-export-contract.md) for
the shared `game` / `folder` / entry-context (`id`, `uuid`, `name`, `type`,
`folderId`, `folderPath`, `relativeFolderPath`, `source`) fields.

## Summary

**Background** (`summary`): `backgroundCount`, `withStartingEquipment`,
`withWealth`, `withAdvancements`.

**Race** (`summary`): `raceCount`, `byCreatureType` (map of
`system.type.value` → count), `withMovement`, `withSenses`, `withAdvancements`.

## Per-entry — the fields the app must model

Every entry includes the full `sourceDocument` (clean `toObject()`), plus:

### Background entry — `backgroundSummary`

dnd5e `BackgroundData` = AdvancementTemplate + ItemDescriptionTemplate +
StartingEquipmentTemplate. The two fields the feats table can't hold today:

| Field | Type | Notes |
|---|---|---|
| `identifier` | string | dnd5e slug. |
| `startingEquipment` | `EquipmentEntryData[]` | The full tree: each `{_id, group, sort, type, count, key, requiresProficiency}` where `type ∈ AND, OR` (grouping) `, armor, tool, weapon, focus` (category) `, currency, linked` (UUID). **This is the main new shape to model.** |
| `startingEquipmentCount` | number | Convenience length. |
| `wealth` | string | Starting-gold roll formula (FormulaField). |
| `advancementKeys` / `advancementTypes` | string[] | The keyed-object `system.advancement` map (racial-trait / feature ItemGrant rows, same as feats). |
| `hasDescription` | boolean | — |

### Race entry — `raceSummary`

dnd5e `RaceData` adds movement / senses / creature-type beyond the feat machinery:

| Field | Type | Notes |
|---|---|---|
| `identifier` | string | — |
| `movement` | object | `{walk, fly, swim, climb, burrow, hover, units}`. |
| `senses` | object | `{darkvision, blindsight, tremorsense, truesight, units, special}`. |
| `type` | object | CreatureTypeField `{value, subtype, swarm, custom}` — note `type.value` (e.g. `"humanoid"`) is the **creature type**, not the feat type. |
| `advancementKeys` / `advancementTypes` | string[] | `system.advancement` map. |
| `hasDescription` | boolean | — |

## Relationship to the import side

The reverse direction (importing `dauligor.background-item.v1` /
`dauligor.race-item.v1` onto actors) is already built in the feat browser
(routed by `featType`) — see [feat-import-contract.md](feat-import-contract.md).
Round-trip verification (export a Foundry bg/race, confirm it survives the app's
table + re-import) is the goal once the app's dedicated table exists.

# Feat Folder Export Contract

This document defines the Foundry-side batch export used to seed Dauligor feat imports from native `dnd5e` feat items.

## Purpose

This export is meant for:

- exporting all feats in a Foundry Item folder
- reviewing native `dnd5e` feat data in bulk (class features, race features, background features, general feats)
- driving future Dauligor feat batch import and single-feat import flows

It is not the final app-side feat schema.

It is the transport payload between Foundry and the Dauligor app team.

## Export Trigger

Current module UI:

- Item Directory sidebar
- `Export Feat Folder`

The export prompts for:

- an Item folder containing feat items
- whether subfolders should be included

## Payload Kind

```json
"dauligor.foundry-feat-folder-export.v1"
```

## Top-Level Shape

```json
{
  "kind": "dauligor.foundry-feat-folder-export.v1",
  "schemaVersion": 1,
  "exportedAt": "2026-05-24T00:00:00.000Z",
  "moduleId": "dauligor-pairing",
  "game": {},
  "folder": {},
  "summary": {},
  "feats": []
}
```

## Top-Level Fields

| Field | Type | Notes |
|---|---|---|
| `kind` | `string` | Always `dauligor.foundry-feat-folder-export.v1`. Routes downstream batch importers. |
| `schemaVersion` | `number` | `1` for the initial release. Bump when the entry shape changes incompatibly. |
| `exportedAt` | `string` | ISO 8601 timestamp at export time. |
| `moduleId` | `string` | Always `dauligor-pairing`. |
| `game` | `object` | World identity — `worldId`, `worldTitle`, `systemId`, `systemVersion`, `coreVersion`. Same shape as the spell folder export. |
| `folder` | `object` | Source folder context — see below. |
| `summary` | `object` | Aggregate counts — see below. |
| `feats` | `array` | One entry per feat. Sorted by `system.type.value` then name. |

## `folder`

```json
{
  "id": "abc123",
  "uuid": "Folder.abc123",
  "name": "Class Features",
  "type": "Item",
  "path": "Imported Bundles/PHB/Class Features",
  "includeSubfolders": true,
  "includedFolderIds": ["abc123", "child456"],
  "parentId": "parentXyz"
}
```

| Field | Notes |
|---|---|
| `path` | `/`-separated chain from the world root to the selected folder. |
| `includedFolderIds` | Every folder id whose feats appear in the `feats[]` array. Same folder type (`Item`); equals `[folder.id]` when `includeSubfolders: false`. |

## `summary`

```json
{
  "featCount": 84,
  "byType": { "feat": 32, "class": 48, "race": 4 },
  "bySubtype": { "fighting-style": 8, "metamagic": 7 },
  "flags": {
    "repeatable": 6,
    "hasUses": 41,
    "hasActivities": 53,
    "hasEffects": 28,
    "hasPrereqs": 17
  },
  "totalActivities": 67,
  "totalEffects": 42
}
```

| Field | Notes |
|---|---|
| `byType` | Histogram keyed by `system.type.value` (`feat` / `class` / `race` / `background`). |
| `bySubtype` | Histogram keyed by `system.type.subtype` (only feats with a non-empty subtype contribute). |
| `flags` | Counters for derived feat flags the app-side filter UI surfaces (matches `FeatPropertyFilter` on `/compendium/feats`). |
| `totalActivities` | Sum of `Object.keys(system.activities).length` across every entry. |
| `totalEffects` | Sum of `effects.length` across every entry. |

## `feats[]` entry

```json
{
  "id": "abc",
  "uuid": "Item.abc",
  "name": "Action Surge",
  "type": "feat",
  "folderId": "abc123",
  "folderPath": "Imported Bundles/PHB/Class Features",
  "relativeFolderPath": "",
  "source": {
    "book": "PHB",
    "page": 72,
    "rules": "2014"
  },
  "featSummary": {
    "featType": "class",
    "featSubtype": "",
    "identifier": "action-surge",
    "requirements": "Fighter 2nd level",
    "properties": [],
    "repeatable": false,
    "uses": { "max": "1", "spent": 0, "recovery": [{ "period": "sr", "type": "recoverAll" }] },
    "activation": { "type": "bonus", "value": 1 },
    "activityCount": 1,
    "effectCount": 0
  },
  "sourceDocument": { /* full Foundry item.toObject() */ }
}
```

| Field | Notes |
|---|---|
| `relativeFolderPath` | Path relative to the export root. `""` when the feat is in the root folder; nested feats get e.g. `"PHB/Class Features"`. |
| `source` | `system.source.{book, page, rules}` — the dnd5e v5 source block stamped at import time. |
| `featSummary.featType` | `system.type.value`. Routes feats into the app-side `/compendium/feats` Feat Type filter axis. |
| `featSummary.featSubtype` | `system.type.subtype`. Empty string for un-subtyped feats. |
| `featSummary.identifier` | `system.identifier` slug. Stable across re-imports — the app uses this as the entity key. |
| `featSummary.requirements` | Human-readable prereq text — never machine-parsed, just shown in the importer's detail pane. |
| `featSummary.properties` | `system.properties` array. The presence of `"repeatable"` mirrors the `repeatable` boolean for convenience. |
| `featSummary.uses` | Full `system.uses` object — `max`, `spent`, `recovery[]`. Drives the `hasUses` summary flag. |
| `featSummary.activation` | `system.activation` block (matches the spell export's shape). |
| `sourceDocument` | Complete `feat.toObject()`. Importers that want full fidelity (activities, effects, every flag) read from here; the `featSummary` is a fast-path projection for UI. |

## What's intentionally not in the entry

The `featSummary` is a slim projection for the importer's preview / filter UI. The full Foundry item lives on `sourceDocument`. Anything not in the summary (full description HTML, every activity, every active effect, every flag) is recoverable from `sourceDocument`. The summary is **not** a complete substitute — downstream importers that need fidelity should read `sourceDocument` and only consult the summary for the bits the slim projection actually carries.

## Relation to the spell export

`dauligor.foundry-spell-folder-export.v1` ([spell-folder-export-contract.md](./spell-folder-export-contract.md)) ships an identical envelope (`kind` / `schemaVersion` / `exportedAt` / `game` / `folder`) so a future app-side dispatcher can route by `kind` and reuse the per-folder traversal logic. The per-entry shape is the only difference between the two formats.

## Related Documents

- [spell-folder-export-contract.md](./spell-folder-export-contract.md) — sibling spell exporter
- [feat-import-contract.md](./feat-import-contract.md) — app-side feat import schema; downstream of this export
- [class-feature-activity-contract.md](./class-feature-activity-contract.md) — activity schema for class features (most common feat subtype)

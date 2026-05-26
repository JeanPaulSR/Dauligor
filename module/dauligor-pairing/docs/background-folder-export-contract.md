# Background Folder Export Contract

This document defines the Foundry-side batch export used to ship Dauligor research bundles for native `dnd5e` Background documents.

## Purpose

This export is meant for:

- exporting all background documents in a Foundry Item folder
- reviewing native `dnd5e` background data in bulk for research / migration planning
- seeding a future Dauligor consumer (dedicated `backgrounds` table, or extending the existing `feats` discriminator with background-specific columns — see app-team handoff for the architecture decision)

It is currently **research-only**. The Dauligor app does not have a dedicated backgrounds table today; the placeholder list page lives at `/compendium/backgrounds` and the editor is a thin wrapper around `FeatsEditor` with `scopeFeatType="background"`. When a downstream consumer lands, the schema decision drives the import; the exporter doesn't bake one in.

## Export Trigger

Current module UI:

- Item Directory sidebar
- `Export Background Folder`

The export prompts for:

- an Item folder containing background documents
- whether subfolders should be included

## Payload Kind

```json
"dauligor.foundry-background-folder-export.v1"
```

## Covered Foundry Item Types

The export filters `game.items` down to a single `item.type`:

| `item.type` | dnd5e v5 description | Notes |
|---|---|---|
| `background` | Singleton background documents (Acolyte, Soldier, Outlander, …) | Per `module/data/item/background.mjs` in `foundryvtt/dnd5e@5.x` |

Excluded:

- `feat` — child features granted by ItemGrant advancements travel with the parent via `grantedFeatures[]`; the standalone feat folder export handles bulk feat captures
- `race` — has its own contract (`species-folder-export-contract.md`)
- everything else — handled by other folder-export contracts (spell / item / class / facility)

## Foundry Data Model Reference

dnd5e v5 declares `BackgroundData` as:

```js
export default class BackgroundData extends ItemDataModel.mixin(
  AdvancementTemplate, ItemDescriptionTemplate, StartingEquipmentTemplate
)
```

The class adds no background-specific fields beyond what the three mixins contribute:

- `AdvancementTemplate` → `system.advancement: AdvancementField[]`
- `ItemDescriptionTemplate` → `system.description { value, chat }`, `system.identifier`, `system.source { revision, book, page, license, custom }`
- `StartingEquipmentTemplate` → `system.startingEquipment[]` (group / type / quantity / item refs)

The advancement chain carries the meaningful payload. The 2024-rules default chain is `AbilityScoreImprovement`, `Trait` (proficiencies), `Trait` (languages), `ItemGrant` (features). The 2014 legacy chain is `Trait`, `ItemGrant`.

## Top-Level Shape

```json
{
  "kind": "dauligor.foundry-background-folder-export.v1",
  "schemaVersion": 1,
  "exportedAt": "2026-05-26T00:00:00.000Z",
  "moduleId": "dauligor-pairing",
  "game": {},
  "folder": {},
  "summary": {},
  "backgrounds": []
}
```

## Top-Level Fields

| Field | Type | Notes |
|---|---|---|
| `kind` | `string` | Always `dauligor.foundry-background-folder-export.v1`. Routes downstream batch importers. |
| `schemaVersion` | `number` | `1` for the initial release. Bump when the entry shape changes incompatibly. |
| `exportedAt` | `string` | ISO 8601 timestamp at export time. |
| `moduleId` | `string` | Always `dauligor-pairing`. |
| `game` | `object` | World identity — `worldId`, `worldTitle`, `systemId`, `systemVersion`, `coreVersion`. Same shape as the spell / feat / item / actor folder exports. |
| `folder` | `object` | Source folder context — see below. |
| `summary` | `object` | Aggregate counts — see below. |
| `backgrounds` | `array` | One entry per background. Sorted by name. |

## `folder`

```json
{
  "id": "abc123",
  "uuid": "Folder.abc123",
  "name": "Backgrounds",
  "type": "Item",
  "path": "Imported Bundles/PHB/Backgrounds",
  "includeSubfolders": true,
  "includedFolderIds": ["abc123", "child456"],
  "parentId": "parentXyz"
}
```

`folder.type` is `"Item"` — Foundry stores backgrounds in the Item directory alongside spells / feats / inventory.

## `summary`

```json
{
  "backgroundCount": 13,
  "advancementsByType": {
    "AbilityScoreImprovement": 13,
    "Trait": 26,
    "ItemGrant": 13
  },
  "totalGrantedFeatures": 19,
  "backgroundsWithStartingEquipment": 13,
  "backgroundsWithIdentifier": 13
}
```

| Field | Notes |
|---|---|
| `backgroundCount` | Number of background documents in the export. |
| `advancementsByType` | Histogram keyed by `Advancement.type` (e.g. `Trait`, `ItemGrant`, `AbilityScoreImprovement`). |
| `totalGrantedFeatures` | Sum across every `ItemGrant.configuration.items[]` and `ItemChoice.configuration.{items,pool}[]` reference. Pre-resolution count — drift from `Σ entry.grantedFeatures.length` reveals unresolved UUIDs. |
| `backgroundsWithStartingEquipment` | Backgrounds with at least one `system.startingEquipment[]` entry. |
| `backgroundsWithIdentifier` | Backgrounds with a non-empty `system.identifier` (the slug used by reference syntax). |

## `backgrounds[]` entry

```json
{
  "id": "abc",
  "uuid": "Item.abc",
  "name": "Acolyte",
  "type": "background",
  "folderId": "abc123",
  "folderPath": "Imported Bundles/PHB/Backgrounds",
  "relativeFolderPath": "",
  "source": { "book": "PHB", "page": 127, "rules": "2024" },
  "backgroundSummary": { /* slim projection — see below */ },
  "grantedFeatures": [ /* resolved ItemGrant child documents */ ],
  "unresolvedReferences": [ /* UUIDs that failed to resolve */ ],
  "sourceDocument": { /* full Foundry item.toObject() */ }
}
```

| Field | Notes |
|---|---|
| `type` | Always `"background"` — the routing discriminator. |
| `relativeFolderPath` | Path relative to the export root. `""` when the background is in the root folder; nested entries get e.g. `"Setting A"`. |
| `backgroundSummary` | Slim projection — see below. |
| `grantedFeatures` | One entry per resolved ItemGrant / ItemChoice reference. See "Granted features" below. |
| `unresolvedReferences` | UUIDs the exporter couldn't resolve (typical cause: compendium not yet indexed). The importer should warn rather than fail. |
| `sourceDocument` | Complete `item.toObject()`. The authoritative payload — `backgroundSummary` is a UX hint, not a source of truth. |

## `backgroundSummary`

```json
{
  "identifier": "acolyte",
  "advancementCount": 4,
  "startingEquipmentCount": 5,
  "grantedFeatureCount": 1,
  "unresolvedReferenceCount": 0
}
```

| Field | Source | Notes |
|---|---|---|
| `identifier` | `system.identifier` | Reference-syntax slug. Empty string when unset. |
| `advancementCount` | `system.advancement.length` | Total advancement entries (not just ItemGrants). |
| `startingEquipmentCount` | `system.startingEquipment.length` | Number of starting-equipment entries. |
| `grantedFeatureCount` | derived | Equals `grantedFeatures.length`. |
| `unresolvedReferenceCount` | derived | Equals `unresolvedReferences.length`. |

## Granted features

For every `ItemGrant` advancement in `system.advancement[]` and every `ItemChoice` advancement (which uses `configuration.items[]` or `configuration.pool[]`), the exporter walks each reference's `uuid`, resolves it via `fromUuidSync`, and embeds the result alongside the parent:

```json
"grantedFeatures": [
  {
    "uuid": "Compendium.dnd5e.classfeatures.Item.abcdef",
    "advancementId": "advancementUuidHere",
    "advancementType": "ItemGrant",
    "document": { /* full Foundry item.toObject() of the resolved feat */ }
  }
]
```

| Field | Notes |
|---|---|
| `uuid` | The advancement reference's source UUID. Preserved verbatim. |
| `advancementId` | The owning advancement's `_id`. Pairs the granted feat back to the chain entry that referenced it. |
| `advancementType` | Either `ItemGrant` or `ItemChoice`. |
| `document` | The resolved item's `toObject()`. Almost always a `type: "feat"` document with `system.type.value === "background"`. |

When the UUID can't be resolved (compendium not loaded, deleted source, etc.), the entry lands in `unresolvedReferences` instead:

```json
"unresolvedReferences": [
  { "uuid": "Compendium.acme.homebrew.Item.missing", "advancementId": "...", "advancementType": "ItemGrant" }
]
```

The downstream importer should surface unresolved references as warnings rather than silently dropping them — the user can usually fix the issue by loading the missing compendium and re-exporting.

## Sort order

Entries are sorted by `name` ascending using `localeCompare`. This keeps two exports of the same folder byte-identical when the folder contents haven't changed.

## Roundtripping

This export is currently one-way. There's no Dauligor-side `backgroundImport.ts` yet; the file is intended for research and to gate the architecture decision (own table vs `feats` discriminator extension — see app-team handoff).

When ingestion lands, the importer should:

1. Read `kind` + `schemaVersion`, refuse on mismatch.
2. For each `backgrounds[]` entry, write the parent record using `backgroundSummary` for routing fields and `sourceDocument` for the full payload.
3. For each `grantedFeatures[]` child, upsert the feat via the existing `feat-import-contract.md` flow, treating the parent's `id`/`uuid` as the parent reference.
4. Surface every `unresolvedReferences[]` entry as a warning in the import workbench output.

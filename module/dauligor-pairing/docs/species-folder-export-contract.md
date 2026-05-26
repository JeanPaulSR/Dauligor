# Species Folder Export Contract

This document defines the Foundry-side batch export used to ship Dauligor research bundles for native `dnd5e` Species (race) documents.

> **Naming**: dnd5e v5 surfaces these as "Species" in the UI but the Foundry data-layer item type is still `race`. This contract uses "species" for the kind name and outer field names (matching the v5 UI label) while preserving `item.type === "race"` in the entries.

## Purpose

This export is meant for:

- exporting all species documents in a Foundry Item folder
- reviewing native `dnd5e` species data in bulk for research / migration planning
- seeding a future Dauligor consumer (dedicated `races` / `species` table, or extending the existing `feats` discriminator with movement/senses/creature-type columns — see app-team handoff for the architecture decision)

It is currently **research-only**. The Dauligor app does not have a dedicated species table today; the placeholder list page lives at `/compendium/races` and the editor is a thin wrapper around `FeatsEditor` with `scopeFeatType="race"`. When a downstream consumer lands, the schema decision drives the import; the exporter doesn't bake one in.

## Export Trigger

Current module UI:

- Item Directory sidebar
- `Export Species Folder`

The export prompts for:

- an Item folder containing species (race) documents
- whether subfolders should be included

## Payload Kind

```json
"dauligor.foundry-species-folder-export.v1"
```

## Covered Foundry Item Types

The export filters `game.items` down to a single `item.type`:

| `item.type` | dnd5e v5 description | Notes |
|---|---|---|
| `race` | Singleton species documents (Elf, Human, Dwarf, …) | Per `module/data/item/race.mjs` in `foundryvtt/dnd5e@5.x`. The data layer kept the `race` slug for back-compat after the UI relabel. |

Excluded:

- `feat` — child features granted by ItemGrant advancements travel with the parent via `grantedFeatures[]`; the standalone feat folder export handles bulk feat captures
- `background` — has its own contract (`background-folder-export-contract.md`)
- everything else — handled by other folder-export contracts (spell / item / class / facility)

## Foundry Data Model Reference

dnd5e v5 declares `RaceData` as:

```js
export default class RaceData extends ItemDataModel.mixin(
  AdvancementTemplate, ItemDescriptionTemplate
)

static defineSchema() {
  return this.mergeSchema(super.defineSchema(), {
    movement: new MovementField({ bonus: false, special: false }, { initialUnits: defaultUnits("length") }),
    senses:   new SensesField({}, { initialUnits: defaultUnits("length") }),
    type:     new CreatureTypeField({ swarm: false }, { initial: { value: "humanoid" } })
  });
}
```

The class adds three species-specific structured fields on top of the inherited identifier / description / advancement / source:

- `system.movement` — walk / burrow / climb / fly / swim values + units
- `system.senses` — darkvision / blindsight / tremorsense / truesight + special string
- `system.type` — creature type (humanoid by default, subtype, custom, swarm=false)

The advancement chain typically carries `Size`, `AbilityScoreImprovement`, `Trait`, and `ItemGrant` entries that grant racial feature feats.

## Top-Level Shape

```json
{
  "kind": "dauligor.foundry-species-folder-export.v1",
  "schemaVersion": 1,
  "exportedAt": "2026-05-26T00:00:00.000Z",
  "moduleId": "dauligor-pairing",
  "game": {},
  "folder": {},
  "summary": {},
  "species": []
}
```

## Top-Level Fields

| Field | Type | Notes |
|---|---|---|
| `kind` | `string` | Always `dauligor.foundry-species-folder-export.v1`. |
| `schemaVersion` | `number` | `1` for the initial release. Bump when the entry shape changes incompatibly. |
| `exportedAt` | `string` | ISO 8601 timestamp at export time. |
| `moduleId` | `string` | Always `dauligor-pairing`. |
| `game` | `object` | World identity — `worldId`, `worldTitle`, `systemId`, `systemVersion`, `coreVersion`. Same shape as the other folder exports. |
| `folder` | `object` | Source folder context — see below. |
| `summary` | `object` | Aggregate counts — see below. |
| `species` | `array` | One entry per species. Sorted by name. |

## `folder`

```json
{
  "id": "abc123",
  "uuid": "Folder.abc123",
  "name": "Species",
  "type": "Item",
  "path": "Imported Bundles/PHB/Species",
  "includeSubfolders": true,
  "includedFolderIds": ["abc123", "child456"],
  "parentId": "parentXyz"
}
```

`folder.type` is `"Item"` — Foundry stores species in the Item directory alongside spells / feats / backgrounds / inventory.

## `summary`

```json
{
  "speciesCount": 9,
  "advancementsByType": {
    "Size": 9,
    "AbilityScoreImprovement": 9,
    "Trait": 18,
    "ItemGrant": 6
  },
  "totalGrantedFeatures": 14,
  "speciesWithDarkvision": 6,
  "speciesWithFlySpeed": 1,
  "creatureTypes": { "humanoid": 9 }
}
```

| Field | Notes |
|---|---|
| `speciesCount` | Number of species documents in the export. |
| `advancementsByType` | Histogram keyed by `Advancement.type` (typically `Size`, `AbilityScoreImprovement`, `Trait`, `ItemGrant`). |
| `totalGrantedFeatures` | Sum across every `ItemGrant.configuration.items[]` and `ItemChoice.configuration.{items,pool}[]` reference. Pre-resolution count. |
| `speciesWithDarkvision` | Species with `system.senses.darkvision > 0`. The most common low-light signal. |
| `speciesWithFlySpeed` | Species with `system.movement.fly > 0`. Most species don't fly natively. |
| `creatureTypes` | Histogram of `system.type.value` (typically `humanoid`; non-humanoid species are rare). |

## `species[]` entry

```json
{
  "id": "abc",
  "uuid": "Item.abc",
  "name": "Mountain Dwarf",
  "type": "race",
  "folderId": "abc123",
  "folderPath": "Imported Bundles/PHB/Species",
  "relativeFolderPath": "",
  "source": { "book": "PHB", "page": 22, "rules": "2024" },
  "speciesSummary": { /* slim projection — see below */ },
  "grantedFeatures": [ /* resolved ItemGrant child documents */ ],
  "unresolvedReferences": [ /* UUIDs that failed to resolve */ ],
  "sourceDocument": { /* full Foundry item.toObject() */ }
}
```

| Field | Notes |
|---|---|
| `type` | Always `"race"` — the Foundry data-layer name. UI labels say "Species" but the routing discriminator stays `race`. |
| `relativeFolderPath` | Path relative to the export root. `""` when the species is in the root folder. |
| `speciesSummary` | Slim projection — see below. |
| `grantedFeatures` | One entry per resolved ItemGrant / ItemChoice reference. See "Granted features" below. |
| `unresolvedReferences` | UUIDs the exporter couldn't resolve. The importer should warn rather than fail. |
| `sourceDocument` | Complete `item.toObject()`. The authoritative payload — `speciesSummary` is a UX hint, not a source of truth. |

## `speciesSummary`

```json
{
  "identifier": "dwarf",
  "creatureType": "humanoid",
  "creatureSubtype": "dwarf",
  "movement": { "walk": 25, "burrow": 0, "climb": 0, "fly": 0, "swim": 0, "units": "ft", "hover": false },
  "senses": { "darkvision": 60, "blindsight": 0, "tremorsense": 0, "truesight": 0, "units": "ft", "special": "" },
  "advancementCount": 5,
  "grantedFeatureCount": 1,
  "unresolvedReferenceCount": 0
}
```

| Field | Source | Notes |
|---|---|---|
| `identifier` | `system.identifier` | Reference-syntax slug. Empty string when unset. |
| `creatureType` | `system.type.value` | The slug (`humanoid` by default). |
| `creatureSubtype` | `system.type.subtype` | Sub-category like `dwarf`, `elf`, `dragonborn`. May be empty. |
| `movement` | `system.movement` | Passed through verbatim as a `MovementField` object. |
| `senses` | `system.senses` | Passed through verbatim as a `SensesField` object. |
| `advancementCount` | `system.advancement.length` | Total advancement entries. |
| `grantedFeatureCount` | derived | Equals `grantedFeatures.length`. |
| `unresolvedReferenceCount` | derived | Equals `unresolvedReferences.length`. |

## Granted features

Same shape as the background folder export — for every `ItemGrant` and `ItemChoice` advancement in `system.advancement[]`, the exporter walks each reference's `uuid`, resolves it via `fromUuidSync`, and embeds the result alongside the parent:

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
| `document` | The resolved item's `toObject()`. Almost always a `type: "feat"` document with `system.type.value === "race"`. |

Unresolved references land in `unresolvedReferences[]` instead:

```json
"unresolvedReferences": [
  { "uuid": "Compendium.acme.homebrew.Item.missing", "advancementId": "...", "advancementType": "ItemGrant" }
]
```

## Sort order

Entries are sorted by `name` ascending using `localeCompare`. This keeps two exports of the same folder byte-identical when the folder contents haven't changed.

## Roundtripping

This export is currently one-way. There's no Dauligor-side `raceImport.ts` / `speciesImport.ts` yet; the file is intended for research and to gate the architecture decision (own table vs `feats` discriminator extension — see app-team handoff).

When ingestion lands, the importer should:

1. Read `kind` + `schemaVersion`, refuse on mismatch.
2. For each `species[]` entry, write the parent record using `speciesSummary` for routing fields (`creatureType`, `movement`, `senses`) and `sourceDocument` for the full payload.
3. For each `grantedFeatures[]` child, upsert the feat via the existing `feat-import-contract.md` flow, treating the parent's `id`/`uuid` as the parent reference.
4. Surface every `unresolvedReferences[]` entry as a warning in the import workbench output.

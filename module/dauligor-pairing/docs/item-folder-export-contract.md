# Item Folder Export Contract

This document defines the Foundry-side batch export used to seed Dauligor item imports from native `dnd5e` Item documents (weapons, armor, consumables, tools, loot, containers).

## Purpose

This export is meant for:

- exporting all physical-item documents in a Foundry Item folder
- reviewing native `dnd5e` item data in bulk across the seven Item document types Foundry treats as inventory
- driving future Dauligor item batch import and single-item import flows

It is not the final app-side item schema.

It is the transport payload between Foundry and the Dauligor app team.

## Export Trigger

Current module UI:

- Item Directory sidebar
- `Export Item Folder`

The export prompts for:

- an Item folder containing inventory items
- whether subfolders should be included

## Payload Kind

```json
"dauligor.foundry-item-folder-export.v1"
```

## Covered Foundry Item Types

The export filters `game.items` down to these seven `item.type` values:

| `item.type` | dnd5e v5 description | Typical Dauligor home |
|---|---|---|
| `weapon` | Physical weapons (swords, bows, ammunition delivery via separate `consumable`) | `weapons` table |
| `equipment` | Armor *and* generic worn gear (cloaks, boots, trinkets), sub-discriminated by `system.type.value` | `armor` table (when armor-shaped) or `items` table (when worn gear) |
| `consumable` | Potions, scrolls, ammunition, food, poison | `items` table |
| `tool` | Artisan tools, gaming sets, musical instruments | `tools` table |
| `loot` | Treasure, gems, art objects, trade goods | `items` table |
| `container` | Bags, chests, anything that can hold other items | `items` table |
| `backpack` | Legacy dnd5e v2-era alias for `container`; still in the manifest | `items` table |

Excluded (each has its own export path or no Dauligor home):

- `spell` — handled by `dauligor.foundry-spell-folder-export.v1`
- `feat` — handled by `dauligor.foundry-feat-folder-export.v1`
- `class` / `subclass` — handled by the per-class semantic exporter
- `race` / `background` — no editors surfaced in Dauligor yet
- `facility` — new dnd5e 2024 Bastion docs; no Dauligor table

## Top-Level Shape

```json
{
  "kind": "dauligor.foundry-item-folder-export.v1",
  "schemaVersion": 1,
  "exportedAt": "2026-05-24T00:00:00.000Z",
  "moduleId": "dauligor-pairing",
  "game": {},
  "folder": {},
  "summary": {},
  "items": []
}
```

## Top-Level Fields

| Field | Type | Notes |
|---|---|---|
| `kind` | `string` | Always `dauligor.foundry-item-folder-export.v1`. Routes downstream batch importers. |
| `schemaVersion` | `number` | `1` for the initial release. Bump when the entry shape changes incompatibly. |
| `exportedAt` | `string` | ISO 8601 timestamp at export time. |
| `moduleId` | `string` | Always `dauligor-pairing`. |
| `game` | `object` | World identity — `worldId`, `worldTitle`, `systemId`, `systemVersion`, `coreVersion`. Same shape as the spell + feat folder exports. |
| `folder` | `object` | Source folder context — see below. |
| `summary` | `object` | Aggregate counts — see below. |
| `items` | `array` | One entry per item. Sorted by `item.type` then name. |

## `folder`

```json
{
  "id": "abc123",
  "uuid": "Folder.abc123",
  "name": "Magic Items",
  "type": "Item",
  "path": "Imported Bundles/PHB/Magic Items",
  "includeSubfolders": true,
  "includedFolderIds": ["abc123", "child456"],
  "parentId": "parentXyz"
}
```

| Field | Notes |
|---|---|
| `path` | `/`-separated chain from the world root to the selected folder. |
| `includedFolderIds` | Every folder id whose items appear in the `items[]` array. Same folder type (`Item`); equals `[folder.id]` when `includeSubfolders: false`. |

## `summary`

```json
{
  "itemCount": 84,
  "byType": { "weapon": 23, "equipment": 14, "consumable": 18, "tool": 8, "loot": 15, "container": 6 },
  "bySubcategory": { "light": 4, "medium": 5, "heavy": 5, "shield": 3, "simpleM": 8, "martialM": 9, "potion": 12 },
  "byRarity": { "none": 41, "common": 12, "uncommon": 18, "rare": 9, "veryRare": 3, "legendary": 1 },
  "flags": {
    "magical": 43,
    "requiresAttunement": 17,
    "container": 6,
    "hasActivities": 28,
    "hasEffects": 12
  },
  "totalActivities": 45,
  "totalEffects": 18,
  "totalWeight": 187.5,
  "totalPriceGp": 12450
}
```

| Field | Notes |
|---|---|
| `byType` | Histogram keyed by `item.type` (Foundry document type). The routing key the downstream importer will switch on. |
| `bySubcategory` | Histogram keyed by `system.type.value` — the within-type discriminator (e.g. `equipment` items split by `light`/`medium`/`heavy`/`shield`/`clothing`/`trinket`). |
| `byRarity` | Histogram keyed by `system.rarity` (`none`/`common`/`uncommon`/`rare`/`veryRare`/`legendary`/`artifact`). |
| `flags.magical` | Items where `properties.includes("mgc")` OR `rarity !== "none"`. Matches how Plutonium tags magic items. |
| `flags.requiresAttunement` | Items where `system.attunement` is set to anything other than `""` / `"none"`. |
| `flags.container` | Items of type `container` or `backpack`. |
| `totalActivities` | Sum of `Object.keys(system.activities).length` across every entry. |
| `totalEffects` | Sum of `effects.length` across every entry. |
| `totalWeight` | Sum of `system.weight.value * system.quantity` (dnd5e v5 wraps weight as `{ value, units }` — older shapes treated as flat numbers). |
| `totalPriceGp` | Sum of `system.price.value * system.quantity`. Denomination is ignored — most compendium items list everything in gp. |

## `items[]` entry

```json
{
  "id": "abc",
  "uuid": "Item.abc",
  "name": "Longsword",
  "type": "weapon",
  "folderId": "abc123",
  "folderPath": "Imported Bundles/PHB/Weapons",
  "relativeFolderPath": "Weapons",
  "source": {
    "book": "PHB",
    "page": 149,
    "rules": "2014"
  },
  "itemSummary": {
    "itemType": "weapon",
    "itemCategory": "martialM",
    "itemSubcategory": "",
    "identifier": "longsword",
    "rarity": "none",
    "quantity": 1,
    "weight": 3,
    "price": { "value": 15, "denomination": "gp" },
    "attunement": "",
    "equipped": false,
    "identified": true,
    "magical": false,
    "properties": ["ver"],
    "uses": {},
    "activation": {},
    "activityCount": 1,
    "effectCount": 0,
    "weapon": {
      "damage": { "base": { "number": 1, "denomination": 8, "types": ["slashing"] } },
      "range": { "value": 5, "long": null, "units": "ft" },
      "mastery": "sap",
      "magicalBonus": 0,
      "ammunition": null,
      "proficient": null
    }
  },
  "sourceDocument": { /* full Foundry item.toObject() */ }
}
```

| Field | Notes |
|---|---|
| `type` | The Foundry `item.type` — one of `weapon`/`equipment`/`consumable`/`tool`/`loot`/`container`/`backpack`. The routing discriminator. |
| `relativeFolderPath` | Path relative to the export root. `""` when the item is in the root folder; nested items get e.g. `"Weapons"`. |
| `source` | `system.source.{book, page, rules}` — the dnd5e v5 source block stamped at import time. |
| `itemSummary` | Slim type-aware projection — see below. |
| `sourceDocument` | Complete `item.toObject()`. Importers that want full fidelity (activities, effects, every flag, advancement, etc.) read from here. |

## `itemSummary` — shared base fields

Present on every entry regardless of `itemType`:

| Field | Source | Notes |
|---|---|---|
| `itemType` | `item.type` | Same as the entry's top-level `type`. Duplicated into the summary so a downstream importer that only reads `itemSummary` still has the routing key. |
| `itemCategory` | `system.type.value` | Within-type discriminator: `light`/`medium`/`heavy`/`shield` for equipment; `simpleM`/`martialM` for weapons; `potion`/`scroll` for consumables; `art`/`game`/`music`/`vehicle` for tools; etc. Empty string when un-categorized. |
| `itemSubcategory` | `system.type.subtype` | Further refinement (rare). Mostly empty. |
| `identifier` | `system.identifier` | Stable slug. The app uses this as the entity key. |
| `rarity` | `system.rarity` | `none`/`common`/`uncommon`/`rare`/`veryRare`/`legendary`/`artifact`. |
| `quantity` | `system.quantity` | Defaults to 1. |
| `weight` | `system.weight.value` (or flat number on legacy items) | Per-unit weight; multiply by `quantity` for stack weight. |
| `price` | `system.price.{value, denomination}` | `denomination` ∈ `cp`/`sp`/`ep`/`gp`/`pp`. |
| `attunement` | `system.attunement` | `""`/`"required"`/`"optional"`. |
| `equipped` / `identified` | `system.equipped` / `system.identified` | Always present even on compendium-fresh items. |
| `magical` | derived | `true` if `properties.includes("mgc")` OR `rarity !== "none"`. |
| `properties` | `system.properties` | Array of property slugs: `mgc`, `ada`, `sil`, `ver`, `fin`, `lgt`, etc. |
| `uses` / `activation` | `system.uses` / `system.activation` | Same shapes spells + feats expose. |
| `activityCount` / `effectCount` | derived | Convenience counts for the import workbench. |

## `itemSummary` — type-specific extras

Each branch only emits when `itemType` matches.

### `weapon`

```json
"weapon": {
  "damage": { ... },        // system.damage (base + versatile dice)
  "range": { ... },         // system.range (value, long, units)
  "mastery": "sap",         // system.mastery
  "magicalBonus": 0,         // system.magicalBonus (+N enchant)
  "ammunition": null,        // system.ammunition (linked ammo type)
  "proficient": null         // system.proficient (null = inherit, bool = explicit)
}
```

### `equipment`

```json
"equipment": {
  "armor": { "value": 14, "dex": 2, "magicalBonus": 0 },
  "strength": null,        // STR prerequisite for heavy armor
  "stealth": false,        // disadvantage on Stealth checks
  "proficient": null
}
```

### `tool`

```json
"tool": {
  "ability": "int",        // default ability for the check
  "proficient": null,
  "bonus": ""              // flat bonus added to tool checks
}
```

### `consumable`

```json
"consumable": {
  "destroyOnEmpty": true   // system.uses.autoDestroy
}
```

Most consumable behavior is encoded in `activities` + `uses` (both already present on the base block); only the destroy-on-empty flag is hoisted as a previewable summary.

### `container` / `backpack`

```json
"container": {
  "capacity": { "type": "weight", "value": 30 }  // also "items" or "volume"
}
```

### `loot`

No type-specific extras. The base block (weight + price + properties) is sufficient.

## What's intentionally not in the entry

The `itemSummary` is a slim projection for the importer's preview / filter UI. The full Foundry item lives on `sourceDocument`. Anything not in the summary (full description HTML, every activity, every active effect, advancement entries, container contents) is recoverable from `sourceDocument`. The summary is **not** a complete substitute — downstream importers that need fidelity should read `sourceDocument` and only consult the summary for the bits the slim projection actually carries.

## Relation to the spell + feat exports

`dauligor.foundry-spell-folder-export.v1` and `dauligor.foundry-feat-folder-export.v1` ship the same envelope (`kind` / `schemaVersion` / `exportedAt` / `game` / `folder`) so a future app-side dispatcher can route by `kind` and reuse the per-folder traversal logic. The per-entry shape is the only difference between the three formats.

## Related Documents

- [spell-folder-export-contract.md](./spell-folder-export-contract.md) — sibling spell exporter
- [feat-folder-export-contract.md](./feat-folder-export-contract.md) — sibling feat exporter

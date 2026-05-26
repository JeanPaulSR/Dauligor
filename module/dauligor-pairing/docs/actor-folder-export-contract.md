# Actor Folder Export Contract

This document defines the Foundry-side batch export used to ship Dauligor research bundles for native `dnd5e` Actor documents (characters, npcs, vehicles, groups).

## Purpose

This export is meant for:

- exporting all actor documents in a Foundry Actor folder
- reviewing native `dnd5e` actor data in bulk for research / migration planning
- seeding a future Dauligor consumer (NPC bestiary, monster compendium, PC round-trip — none exist today)

It is currently **research-only**. Dauligor has no actor table — the payload ships the full `sourceDocument` per actor plus a slim type-aware `actorSummary` projection. When a downstream consumer lands, the schema decision drives the import; the exporter doesn't bake one in.

## Export Trigger

Current module UI:

- Actor Directory sidebar
- `Export Actor Folder`

The export prompts for:

- an Actor folder containing actor documents
- whether subfolders should be included

## Payload Kind

```json
"dauligor.foundry-actor-folder-export.v1"
```

## Covered Foundry Actor Types

The export filters `game.actors` down to these four `actor.type` values:

| `actor.type` | dnd5e v5 description | Notes |
|---|---|---|
| `character` | Player characters | Largest payload — class progression, race, background, full spellbook, advancement state |
| `npc` | Monsters, enemies, friendly NPCs | The most common research target. Includes CR, creature type, traits |
| `vehicle` | Carts, ships, war machines | Rare but supported. Includes dimensions + capacity |
| `group` | Party rosters / encounter groupings | Lightweight — essentially a list of member actor UUIDs |

Excluded:

- `encounter` — Foundry's org-tool scaffold for setting up encounters, not a creature

## Top-Level Shape

```json
{
  "kind": "dauligor.foundry-actor-folder-export.v1",
  "schemaVersion": 1,
  "exportedAt": "2026-05-24T00:00:00.000Z",
  "moduleId": "dauligor-pairing",
  "game": {},
  "folder": {},
  "summary": {},
  "actors": []
}
```

## Top-Level Fields

| Field | Type | Notes |
|---|---|---|
| `kind` | `string` | Always `dauligor.foundry-actor-folder-export.v1`. Routes downstream batch importers. |
| `schemaVersion` | `number` | `1` for the initial release. Bump when the entry shape changes incompatibly. |
| `exportedAt` | `string` | ISO 8601 timestamp at export time. |
| `moduleId` | `string` | Always `dauligor-pairing`. |
| `game` | `object` | World identity — `worldId`, `worldTitle`, `systemId`, `systemVersion`, `coreVersion`. Same shape as the spell / feat / item folder exports. |
| `folder` | `object` | Source folder context — see below. |
| `summary` | `object` | Aggregate counts — see below. |
| `actors` | `array` | One entry per actor. Sorted by `actor.type` then name. |

## `folder`

```json
{
  "id": "abc123",
  "uuid": "Folder.abc123",
  "name": "Bestiary",
  "type": "Actor",
  "path": "Imported Bundles/MM/Bestiary",
  "includeSubfolders": true,
  "includedFolderIds": ["abc123", "child456"],
  "parentId": "parentXyz"
}
```

`folder.type` is `"Actor"` (not `"Item"`) — Foundry types folders by the document class they contain.

## `summary`

```json
{
  "actorCount": 72,
  "byType": { "npc": 65, "character": 4, "vehicle": 2, "group": 1 },
  "byCr": { "0": 4, "0.125": 6, "0.25": 8, "1": 12, "2": 7, "5": 9, "10": 3, "15": 1 },
  "flags": {
    "hasInventory": 48,
    "hasSpellbook": 18,
    "hasClasses": 4,
    "hasEffects": 11
  },
  "totalEmbeddedItems": 487,
  "totalEffects": 23
}
```

| Field | Notes |
|---|---|
| `byType` | Histogram keyed by `actor.type` (character / npc / vehicle / group). The routing key the downstream importer will switch on. |
| `byCr` | NPC challenge-rating histogram (only fills from `npc` actors). Keys are sorted numerically so `0.125` < `0.25` < `1` in the serialized JSON. |
| `flags.hasInventory` | Actors with at least one embedded item. |
| `flags.hasSpellbook` | Actors with at least one embedded `spell`-type item. |
| `flags.hasClasses` | Actors with at least one embedded `class`-type item (typically only characters; some homebrew npcs have class items). |
| `flags.hasEffects` | Actors with at least one active effect. |
| `totalEmbeddedItems` | Sum of `actor.items.length` across every entry. |
| `totalEffects` | Sum of `actor.effects.length` across every entry. |

## `actors[]` entry

```json
{
  "id": "abc",
  "uuid": "Actor.abc",
  "name": "Ancient Red Dragon",
  "type": "npc",
  "folderId": "abc123",
  "folderPath": "Imported Bundles/MM/Bestiary/Dragons",
  "relativeFolderPath": "Dragons",
  "actorSummary": { /* see below */ },
  "sourceDocument": { /* full Foundry actor.toObject() */ }
}
```

| Field | Notes |
|---|---|
| `type` | The Foundry `actor.type` — one of `character` / `npc` / `vehicle` / `group`. The routing discriminator. |
| `relativeFolderPath` | Path relative to the export root. `""` when the actor is in the root folder; nested actors get e.g. `"Dragons"`. |
| `actorSummary` | Slim type-aware projection — see below. |
| `sourceDocument` | Complete `actor.toObject()`. Includes embedded `items` and `effects` arrays. Importers that want full fidelity read from here. |

## `actorSummary` — shared base fields

Present on every entry regardless of `actorType`:

| Field | Source | Notes |
|---|---|---|
| `actorType` | `actor.type` | Duplicated into the summary so a downstream importer that only reads `actorSummary` still has the routing key. |
| `portraitImg` | `actor.img` | Sheet portrait. |
| `tokenImg` | `actor.prototypeToken.texture.src` | Token texture (falls back to legacy `actor.token.img`). |
| `alignment` | `system.details.alignment` | Free-text or canonical alignment (`Lawful Good`, `CN`, etc.). |
| `hp` | `system.attributes.hp` | `{ value, max, temp }` — current / max / temporary. |
| `ac` | `system.attributes.ac` | `{ value, flat, formula, calc }`. `value` is the resolved AC; `flat` is an override; `formula` is the calculation string; `calc` is the calculation mode (`flat`/`natural`/`default`). |
| `abilities` | `system.abilities.{str,dex,con,int,wis,cha}.value` | Six ability scores. Modifiers can be derived (`Math.floor((score-10)/2)`). |
| `biography` | `system.details.biography.value` | First 200 chars, HTML stripped, whitespace collapsed. Full HTML stays on `sourceDocument`. |
| `itemCount` / `effectCount` | derived | Count of embedded items + effects. |
| `embeddedTypeCounts` | derived | Histogram of embedded `item.type` (e.g. `{ class: 1, spell: 12, weapon: 3 }`). Lets a preview line read "1 class, 12 spells, 3 weapons" without thawing the inventory. |

## `actorSummary` — type-specific extras

Each branch only emits when `actorType` matches.

### `character`

```json
"character": {
  "race": "Mountain Dwarf",
  "background": "Soldier",
  "classes": [
    {
      "identifier": "fighter",
      "name": "Fighter",
      "level": 5,
      "subclass": { "identifier": "battle-master", "name": "Battle Master" }
    }
  ],
  "totalLevel": 5,
  "xp": { "value": 6500, "max": 14000 },
  "currency": { "cp": 0, "sp": 0, "ep": 0, "gp": 250, "pp": 0 },
  "spellSlots": { "spell1": { "value": 3, "max": 4, "override": null } }
}
```

- `classes` is derived from embedded `class` items; each entry includes the matching `subclass` item when one exists.
- `totalLevel` is the sum across all classes.
- `spellSlots` only includes levels where `max > 0` or `value > 0` — keeps the payload compact for non-casters.

### `npc`

```json
"npc": {
  "creatureType": "dragon",
  "creatureSubtype": "",
  "cr": 24,
  "proficiencyBonus": 7,
  "source": { "book": "MM", "page": 97 },
  "traits": {
    "damageImmunities": ["fire"],
    "damageResistances": [],
    "damageVulnerabilities": [],
    "conditionImmunities": [],
    "languages": ["common", "draconic"]
  }
}
```

- `cr` is stored as a number (e.g. `0.125` for CR 1/8, `0.25` for CR 1/4, `1`, `24`). Keep the literal value so authors can see fractional CRs.
- `traits.*` are arrays of dnd5e v5 slugs.

### `vehicle`

```json
"vehicle": {
  "vehicleType": "water",
  "dimensions": "30 ft × 8 ft",
  "capacity": { "creature": "Up to 8", "cargo": 100 },
  "actions": { "stations": true, "value": 0, "threshold": 3 },
  "movement": { /* system.attributes.movement */ }
}
```

### `group`

```json
"group": {
  "groupType": "party",
  "memberCount": 4,
  "members": [
    { "uuid": "Actor.abc", "name": "Aragorn", "actorType": "character" },
    { "uuid": "Actor.def", "name": "Legolas", "actorType": "character" }
  ]
}
```

- Members are resolved via `fromUuidSync` when available; tolerates both the modern `[{ actor: ActorUUID, ... }]` shape and the legacy flat string array.

## What's intentionally not in the entry

The `actorSummary` is a slim projection for the importer's preview / filter UI. The full Foundry actor lives on `sourceDocument`, including:

- The complete `system` block (every nested field — `attributes.spellcasting`, `attributes.movement`, `attributes.senses`, `skills`, `traits.languages`, `traits.weaponProf`, etc.)
- Full embedded `items` array (inventory, classes, spells, feats — each with its own full `system` block)
- Full embedded `effects` array
- Prototype token data (`prototypeToken.*` — texture, sight, light, dimensions, disposition)
- Owner permissions (`ownership`)
- Flags (`flags.dnd5e.*`, `flags.midi-qol.*`, etc.)

Anything not in `actorSummary` is recoverable from `sourceDocument`. The summary is **not** a complete substitute — downstream importers that need fidelity should read `sourceDocument` and only consult the summary for the bits the slim projection actually carries.

## Relation to the other folder exports

`dauligor.foundry-{spell,feat,item}-folder-export.v1` ship the same envelope (`kind` / `schemaVersion` / `exportedAt` / `game` / `folder`) so a future app-side dispatcher can route by `kind` and reuse the per-folder traversal logic. The per-entry shape is the only difference between the four formats.

## Open questions for the future Dauligor consumer

Decisions deferred until the import workbench lands:

1. **Storage shape** — flat table per actor type (`npcs`, `characters`, `vehicles`)? One mixed `actors` table with an `actor_type` discriminator? Both have precedent (items is one table; weapons/armor/tools/items is fan-out).
2. **Embedded inventory handling** — denormalize embedded items into a `items` table FK'd back? Keep as JSON blobs? Foundry's design makes the second more faithful, but the first is more queryable.
3. **PC round-trip** — if characters round-trip Dauligor ↔ Foundry, the import must preserve more than the summary captures (advancement state, prepared spells, equipped status, currency). `sourceDocument` carries all of it.
4. **Group resolution** — `members[].uuid` references other actors that may not be in the same export. The import workbench needs a "resolve broken links" pass.

## Related Documents

- [spell-folder-export-contract.md](./spell-folder-export-contract.md) — sibling spell exporter
- [feat-folder-export-contract.md](./feat-folder-export-contract.md) — sibling feat exporter
- [item-folder-export-contract.md](./item-folder-export-contract.md) — sibling item exporter

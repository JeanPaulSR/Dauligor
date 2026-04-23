# Dauligor Class Import Contract

This document defines the class-focused payloads that `dauligor-pairing` should receive from the Dauligor app.

For the detailed behavior guide covering:

- world import versus actor import
- embedded class advancement persistence
- HP, skills, ItemGrant, and character-creator expectations

see:

- `docs/class-import-and-advancement-guide.md`

Scope for this version:

- classes
- class-specific features
- class advancement

Out of scope for this version:

- spell lists
- non-class feats
- inventory/items
- subclass bundles
- equipment and proficiency choice automation that has not yet been verified from a live export

The goal is simple:

1. Dauligor sends stable, semantic JSON.
2. The Foundry module resolves that JSON into `dnd5e` `5.3.x` world items.
3. The app never needs to know Foundry world UUIDs in advance.

## Accepted Detail Payload Families

The importer now understands two detail-payload styles for classes:

1. `dauligor.class-bundle.v1`
2. the semantic full-export shape documented in:
   - `docs/class-semantic-export-notes.md`

The normalized bundle is still the cleanest transport for a strict contract.

The semantic full export is now supported so the app can ship one richer class payload and let the Foundry module perform the final normalization step.

## Import Targets

The module now supports two distinct import targets for classes:

1. Sidebar import:
   - imports into the Foundry world item library
   - creates or updates the class item and bundled class-feature items in world items

2. Actor-sheet import:
   - never creates or updates world items
   - runs a sequenced Foundry-side import flow for the destination actor
   - prompts for the ending class level, HP handling, skill choices, subclass choices, and option-group choices only when those steps apply
   - embeds the class directly on the actor at that level
   - embeds only the class features granted at or below that level
   - removes previously imported higher-level class features for that same class when they are no longer needed

Actor-import note:

- importer-only choices like `hpMode` or a custom HP roll formula are local Foundry UI state
- Dauligor should not send those fields in the endpoint payload

## Identity Rule

Dauligor should always send stable, semantic ids.

Foundry-safe 16-character `_id` values are a module concern, not an app concern.

That means:

- class `flags.dauligor-pairing.sourceId` should be stable
- class feature `flags.dauligor-pairing.sourceId` should be stable
- advancement `_id` values should be stable semantic ids such as `sorcererHitPoints`
- Dauligor should not try to pre-generate random Foundry ids for advancements

On actor-sheet imports, the module will:

1. convert each semantic advancement id into a valid 16-character Foundry id
2. store that mapping on the embedded actor class item
3. reuse the same mapping on later reimports and level-based syncs

This prevents advancement identity from changing every time a class is re-imported.

## Module-Owned Sync Metadata

The module writes and maintains additional metadata under `flags.dauligor-pairing`.

Dauligor should treat these as importer-managed fields:

- `importedAt`
- `lastSyncedAt`
- `importMode`
- `moduleVersion`
- `payloadKind`
- `schemaVersion`
- `advancementIdMap`

Recommended class flag shape after import:

```json
{
  "flags": {
    "dauligor-pairing": {
      "sourceId": "class-sorcerer",
      "sourceType": "class",
      "sourceSystem": "dauligor",
      "sourceEntity": "class",
      "sourceRecordId": "class-sorcerer",
      "rules": "2014",
      "revision": 1,
      "payloadKind": "dauligor.class-bundle.v1",
      "schemaVersion": 1,
      "importMode": "actor",
      "importedAt": "2026-04-18T18:00:00.000Z",
      "lastSyncedAt": "2026-04-18T18:05:00.000Z",
      "moduleVersion": "0.4.1",
      "advancementIdMap": {
        "sorcererHitPoints": "AbCdEf123456GhIj",
        "sorcererSavingThrows": "KlMnOp789012QrSt"
      }
    }
  }
}
```

Important:

- `advancementIdMap` is only needed on embedded actor class items
- world items may keep semantic advancement ids directly
- actor feature items do not need `advancementIdMap`

### Embedded Advancement Metadata

When the module rewrites actor-side advancement ids, it also preserves the Dauligor-side semantic id on each advancement entry:

```json
{
  "_id": "AbCdEf123456GhIj",
  "type": "HitPoints",
  "flags": {
    "dauligor-pairing": {
      "sourceAdvancementId": "sorcererHitPoints"
    }
  }
}
```

That means the actor item can always map:

- semantic Dauligor advancement id
- Foundry-safe local advancement id

without depending on names or timestamps.

## Transport Model

The importer should fetch two payload families:

1. a catalog payload that lists importable classes
2. a detail payload for one selected class

This keeps the Foundry-side browser lightweight and makes it easy to swap a local fixture URL for a real Dauligor endpoint later.

## Catalog Payload

Kind:

```json
"dauligor.class-catalog.v1"
```

Expected shape:

```json
{
  "kind": "dauligor.class-catalog.v1",
  "schemaVersion": 1,
  "source": {
    "system": "dauligor",
    "entity": "class-catalog",
    "id": "campaign-classes"
  },
  "entries": [
    {
      "sourceId": "class-sorcerer",
      "name": "Sorcerer",
      "type": "class",
      "img": "icons/svg/item-bag.svg",
      "rules": "2014",
      "description": "Natural spellcaster class bundle.",
      "payloadKind": "dauligor.class-bundle.v1",
      "payloadUrl": "https://app.example/api/foundry/classes/class-sorcerer.json"
    }
  ]
}
```

Required `entries[]` fields:

- `sourceId`
- `name`
- `type`
- `payloadKind`
- `payloadUrl`

Recommended `entries[]` fields:

- `img`
- `rules`
- `description`

## Preferred Detail Payload

Kind:

```json
"dauligor.class-bundle.v1"
```

This is the preferred format for real imports.

Expected shape:

```json
{
  "kind": "dauligor.class-bundle.v1",
  "schemaVersion": 1,
  "source": {
    "system": "dauligor",
    "entity": "class",
    "id": "class-sorcerer",
    "rules": "2014",
    "revision": 1
  },
  "classItem": {},
  "classFeatures": []
}
```

If the app prefers to send the richer semantic export instead, see:

- `docs/class-semantic-export-notes.md`

### `classItem`

`classItem` is a Foundry-like item source for an item of type `class`.

Required fields:

- `name`
- `type`
- `img`
- `system`
- `flags.dauligor-pairing.sourceId`
- `flags.dauligor-pairing.entityId`
- `flags.dauligor-pairing.sourceBookId`

Required `classItem.system` fields for the current class importer:

- `identifier`
- `description.value`
- `source`
- `levels`
- `hd`
- `spellcasting`
- `primaryAbility`
- `wealth`
- `properties`
- `advancement`

Expected class item example:

```json
{
  "name": "Sorcerer",
  "type": "class",
  "img": "icons/svg/item-bag.svg",
  "flags": {
    "dauligor-pairing": {
      "sourceId": "class-sorcerer",
      "entityId": "awWmrbo3YxCMU86t7Yb9",
      "sourceBookId": "source-phb-2014"
    }
  },
  "system": {
    "identifier": "sorcerer",
    "description": {
      "value": "<p>Class description HTML.</p>",
      "chat": ""
    },
    "source": {
      "custom": "",
      "book": "Player's Handbook",
      "page": "0",
      "license": "",
      "rules": "2014",
      "revision": 1
    },
    "levels": 1,
    "hd": {
      "denomination": "d6",
      "spent": 0,
      "additional": ""
    },
      "spellcasting": {
        "progression": "full",
        "ability": "cha",
        "preparation": {
          "mode": "always"
        }
      },
    "primaryAbility": {
      "value": ["cha"],
      "all": false
    },
    "wealth": "3d4*10",
    "properties": [],
    "advancement": {}
  }
}
```

`wealth` note:

- send a pure Foundry roll formula string
- do not include currency suffixes like `gp`
- do not use textual multiplication like `x`
- preferred example: `3d4*10`
- if Dauligor stores the display form separately, keep that display-only version out of the Foundry payload

`spellcasting.preparation` note:

- `mode` is enough for the Dauligor-side contract unless the app truly models a preparation formula
- raw Foundry exports may include `preparation.formula`, but the Dauligor semantic payload does not need to invent one

`skills` note:

- the importer accepts class skill choices in either location:
  - `class.skills`
  - `class.proficiencies.skills`
- both shapes should use the same structure:

```json
{
  "choiceCount": 1,
  "options": ["acrobatics", "athletics"],
  "fixed": []
}
```

### `classFeatures`

`classFeatures` contains Foundry-like item sources for class-specific feature items that the class advancement tree can grant.

For now, these should be `feat` items.

Required fields per feature:

- `name`
- `type`
- `img`
- `system`
- `flags.dauligor-pairing.sourceId`

Recommended flags:

```json
{
  "dauligor-pairing": {
    "sourceId": "class-feature-sorcerous-origin",
    "classSourceId": "class-sorcerer",
    "sourceType": "classFeature"
  }
}
```

## Advancement Contract

### Storage Shape

Preferred incoming shape:

- `classItem.system.advancement` is an object keyed by stable advancement ids

Example:

```json
{
  "sorcererHitPoints": {
    "_id": "sorcererHitPoints",
    "type": "HitPoints",
    "configuration": {},
    "value": {
      "1": "max"
    },
    "flags": {},
    "hint": ""
  }
}
```

Rules:

- the object key and `_id` should match
- `_id` should be stable across exports
- `_id` should be semantic and importer-safe
- do not generate random Foundry ids in Dauligor when a stable semantic id is available
- do not encode advancement identity from timestamps
- the module is responsible for translating semantic ids into actor-safe Foundry ids

The importer may also accept an array of advancement objects for convenience, but the preferred contract is the object form above because it matches the current Foundry export shape in this project.

### Supported Advancement Types for `v1`

Currently supported and expected:

- `HitPoints`
- `Trait`
- `ScaleValue`
- `ItemGrant`

Not yet part of the contract for production imports:

- `ItemChoice`
- `AbilityScoreImprovement`
- subclass selection advancement
- unverified proficiency/equipment choice structures

### `HitPoints`

Expected shape:

```json
{
  "_id": "sorcererHitPoints",
  "type": "HitPoints",
  "configuration": {},
  "value": {
    "1": "max"
  },
  "flags": {},
  "hint": ""
}
```

### `Trait`

Use `Trait` for simple granted traits that are already known at export time.

Verified example:

```json
{
  "_id": "sorcererSavingThrows",
  "type": "Trait",
  "level": 1,
  "title": "Saving Throws",
  "configuration": {
    "mode": "default",
    "allowReplacements": false,
    "grants": [
      "saves:cha",
      "saves:con"
    ],
    "choices": []
  },
  "value": {
    "chosen": [
      "saves:cha",
      "saves:con"
    ]
  },
  "flags": {},
  "hint": ""
}
```

### `ScaleValue`

Use `ScaleValue` for class progression tracks such as:

- cantrips known
- spells known
- sorcery points
- metamagic known

Expected shape:

```json
{
  "_id": "sorcererCantripsKnown",
  "type": "ScaleValue",
  "title": "Cantrips Known",
  "configuration": {
    "identifier": "cantrips-known",
    "type": "number",
    "distance": {
      "units": ""
    },
    "scale": {
      "1": { "value": 4 },
      "4": { "value": 5 },
      "10": { "value": 6 }
    }
  },
  "value": {},
  "flags": {},
  "hint": ""
}
```

### `ItemGrant`

Use `ItemGrant` to grant class features.

Important rule:

- Dauligor should send `sourceId` references, not world UUIDs

Preferred incoming shape:

```json
{
  "_id": "sorcererGrantFontOfMagic",
  "type": "ItemGrant",
  "level": 2,
  "title": "Features",
  "configuration": {
    "items": [
      {
        "sourceId": "class-feature-font-of-magic",
        "optional": false
      }
    ],
    "optional": false,
    "spell": {
      "ability": [""],
      "uses": {
        "max": "",
        "per": "",
        "requireSlot": false
      },
      "prepared": 0
    }
  },
  "value": {},
  "flags": {},
  "hint": ""
}
```

The module is responsible for:

1. importing/upserting each `classFeatures[]` item into the world
2. resolving `configuration.items[].sourceId` to the created world item UUID
3. writing the final Foundry class item with resolved `uuid` values
4. preserving actor-side advancement identity when embedding a class on an actor

Accepted but not preferred:

- `configuration.items[].uuid`

That legacy shape is supported only so the importer can still read raw Foundry-style research exports.

## Import Behavior

When importing a `dauligor.class-bundle.v1` payload, the module should:

1. validate `kind`
2. validate that `classItem.type === "class"`
3. upsert `classFeatures[]` into world items
4. resolve `ItemGrant` references by `sourceId`
5. upsert the `classItem` into world items
6. preserve `flags.dauligor-pairing.sourceId` on every imported document
7. preserve `flags.dauligor-pairing.entityId` and `flags.dauligor-pairing.sourceBookId` when supplied

World item matching order:

1. `flags.dauligor-pairing.entityId`
2. `flags.dauligor-pairing.sourceId`
3. `system.identifier`
4. `name` + `type` as a fallback

Actor item matching order:

1. `flags.dauligor-pairing.entityId`
2. `flags.dauligor-pairing.sourceId`
3. `system.identifier`
4. `name` + `type` as a fallback

## Actor Import Notes

When a class is imported from an actor sheet:

1. the class is embedded directly on that actor
2. only non-`ItemGrant` advancements are kept on the embedded class item
3. `ItemGrant` advancements are resolved by the importer into embedded class-feature items
4. only features at or below the chosen class level are embedded
5. higher-level class features previously imported for the same class are removed
6. the module reuses `flags.dauligor-pairing.advancementIdMap` so actor-side advancements keep stable local ids

This is important for future reimport and level-up support.

## Legacy Raw Payloads

The module should also keep accepting these research/testing payloads:

1. a raw Foundry-like class item object
2. `dauligor.item.v1` where `item.type === "class"`

These legacy payloads are useful for research, but they are not the preferred Dauligor app contract because they cannot safely express feature references without leaking Foundry-specific UUID assumptions.

## Summary

For classes, the app-to-module contract should be:

- fetch a class catalog
- fetch one class bundle
- class bundle contains one Foundry-like `classItem`
- class bundle contains zero or more Foundry-like `classFeatures`
- `ItemGrant` advancements reference `classFeatures` by `sourceId`
- the Foundry module resolves those references into real UUIDs during import

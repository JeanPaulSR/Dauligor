# Class, Subclass & Feature Item Shapes

> Part of the [Class Import & Advancement Guide](../class-import-and-advancement-guide.md).

## Required Class Item Shape

The normalized Foundry class item should look like a real `dnd5e` class item.

Minimum high-value fields:

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
      "value": "<p>...</p>",
      "chat": ""
    },
    "source": {
      "book": "Player's Handbook",
      "page": "0",
      "rules": "2014",
      "revision": 1,
      "custom": "",
      "license": ""
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
        "formula": ""
      }
    },
    "primaryAbility": {
      "value": ["cha"],
      "all": false
    },
    "properties": [],
    "wealth": "3d4*10",
    "advancement": {}
  }
}
```

## What Each Core Class Field Means

### `system.identifier`

- type: identifier string
- purpose: stable semantic slug for the class
- example: `sorcerer`

This is one of the strongest matching keys on the Foundry side.

### `system.description.value`

- type: HTML string
- purpose: the rich class description shown in the item sheet

The importer now accepts either:

- rendered HTML
- BBCode
- simple markdown-like prose

The module will normalize non-HTML text into Foundry-friendly HTML during import.

## Feature Item Typing

Imported class-related feat items now carry Foundry-native type metadata.

### Ordinary class and subclass features

These import as:

```json
{
  "type": "feat",
  "system": {
    "type": {
      "value": "class",
      "subtype": ""
    }
  }
}
```

That makes them display as `Class Feature` on `dnd5e` sheets.

### Class option items

These import as feat items whose `system.type.value` remains `class`, but whose subtype is derived from the option-group name.

Examples:

- native subtype: `artificerInfusion`
- custom subtype: generated from the option-group name and registered at runtime by the module

The module also stores:

- `flags.dauligor-pairing.featureTypeValue`
- `flags.dauligor-pairing.featureTypeSubtype`
- `flags.dauligor-pairing.featureTypeLabel`

This keeps the display label and future sheet-sorting metadata stable even when the subtype is custom.

### `system.source`

- type: structured source block
- purpose: book/page/rules provenance and revision metadata

At minimum, these fields matter most:

- `book`
- `page`
- `rules`
- `revision`

### `system.levels`

- type: integer
- world class item meaning:
  - usually `1`
- actor embedded class item meaning:
  - the actor's actual current level in that class

This is crucial:

- for an actor import to level 5, `system.levels` on the embedded class item should be `5`
- Foundry level-change and advancement logic uses the embedded class item's `system.levels`

### `system.hd`

Class hit-die structure:

```json
{
  "denomination": "d6",
  "spent": 0,
  "additional": ""
}
```

Meanings:

- `denomination`
  - type: string matching `/^d\\d+$/`
  - examples: `d6`, `d8`, `d10`, `d12`
- `spent`
  - type: integer
  - hit dice spent during rests
- `additional`
  - type: deterministic formula string
  - extra hit dice beyond normal class levels

Important:

- the importer should derive HP logic from `system.hd.denomination`
- do not hardcode `d8`
- later HP calculations and custom formula defaults should come from this field

### `system.spellcasting`

Purpose:

- tells Foundry what kind of spellcasting progression the class uses
- tells Foundry which ability powers class spellcasting

Important fields:

- `progression`
- `ability`
- `preparation.mode`

Common progression values in practice:

- `none`
- `full`
- `half`
- `third`
- `pact`
- `artificer`

For Sorcerer:

- `progression = "full"`
- `ability = "cha"`
- `preparation.mode = "always"`

### `system.primaryAbility`

Purpose:

- multiclassing or primary-ability semantics

Shape:

```json
{
  "value": ["cha"],
  "all": false
}
```

### `system.properties`

- type: set or array of strings
- usually empty for many classes

### `system.wealth`

- type: deterministic Foundry roll formula string
- good: `3d4*10`
- bad: `3d4 x 10 gp`

### `system.advancement`

This is the heart of class importing.

Everything the character creator cares about eventually becomes advancement data or granted items.

## Required Subclass Item Shape

If the class payload includes subclasses, each subclass should normalize into a real `dnd5e` subclass item.

Minimum important fields:

```json
{
  "name": "Divine Soul",
  "type": "subclass",
  "flags": {
    "dauligor-pairing": {
      "sourceId": "subclass-divine-soul",
      "entityId": "subclass-record-id",
      "sourceBookId": "source-phb-2014"
    }
  },
  "system": {
    "identifier": "divine-soul",
    "classIdentifier": "sorcerer",
    "description": {
      "value": "<p>...</p>",
      "chat": ""
    },
    "spellcasting": {
      "progression": "none",
      "ability": ""
    },
    "advancement": {}
  }
}
```

Important:

- `system.classIdentifier` must match the parent class `system.identifier`
- subclass advancements are evaluated using class levels, not a separate subclass level counter

## Class Feature Item Shape

Class and subclass features should normally become `Item.type = "feat"`.

Each feature item needs:

- stable semantic `sourceId`
- `classSourceId`
- a useful `system.identifier`
- description HTML
- activities/effects when relevant

The detailed activity contract now lives in:

- `docs/class-feature-activity-contract.md`


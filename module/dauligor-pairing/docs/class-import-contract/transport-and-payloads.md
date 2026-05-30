# Transport Model & Payloads

> Part of the [Class Import Contract](../class-import-contract.md).

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


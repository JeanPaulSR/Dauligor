# Spell Folder Export Contract

This document defines the Foundry-side batch export used to seed Dauligor spell imports from native `dnd5e` spell items.

## Purpose

This export is meant for:

- exporting all spells in a Foundry Item folder
- reviewing native `dnd5e` spell data in bulk
- driving future Dauligor spell batch import and single-spell import flows

It is not the final app-side spell schema.

It is the transport payload between Foundry and the Dauligor app team.

## Export Trigger

Current module UI:

- Item Directory sidebar
- `Export Spell Folder`

The export prompts for:

- an Item folder containing spell items
- whether subfolders should be included

## Payload Kind

```json
"dauligor.foundry-spell-folder-export.v1"
```

## Top-Level Shape

```json
{
  "kind": "dauligor.foundry-spell-folder-export.v1",
  "schemaVersion": 1,
  "exportedAt": "2026-04-29T00:00:00.000Z",
  "moduleId": "dauligor-pairing",
  "game": {},
  "folder": {},
  "summary": {},
  "spells": []
}
```

## Top-Level Fields

### `game`

World and runtime context:

- `worldId`
- `worldTitle`
- `systemId`
- `systemVersion`
- `coreVersion`

### `folder`

Folder context used for batch import grouping:

- `id`
- `uuid`
- `name`
- `type`
- `path`
- `includeSubfolders`
- `includedFolderIds`
- `parentId`

### `summary`

Quick aggregate data for validation:

- `spellCount`
- `byLevel`
- `bySchool`
- `byMethod`
- `totalActivities`
- `totalEffects`

## Spell Entry Shape

Each entry in `spells` currently contains:

```json
{
  "id": "foundry-item-id",
  "uuid": "Item.xxxxx",
  "name": "Absorb Elements",
  "type": "spell",
  "folderId": "folder-id",
  "folderPath": "Imported Spells/XGE",
  "relativeFolderPath": "XGE",
  "source": {
    "book": "XGE",
    "page": 150,
    "rules": "2014"
  },
  "spellSummary": {
    "level": 1,
    "school": "abj",
    "method": "prepared",
    "prepared": 0,
    "ability": "",
    "sourceItem": "",
    "properties": ["somatic"],
    "materialSummary": {
      "value": "",
      "cost": 0,
      "consumed": false,
      "supply": 0
    },
    "activation": {},
    "range": {},
    "target": {},
    "duration": {},
    "activityCount": 1,
    "effectCount": 0
  },
  "sourceDocument": {}
}
```

## Important Rule

`sourceDocument` is the authoritative native Foundry item payload.

Everything else in the spell entry is convenience metadata for:

- app-side preview
- batch validation
- filtering
- import mapping

If there is ever a mismatch, the importer should trust `sourceDocument`.

## Intended App-Side Usage

The Dauligor app can consume this export in two ways:

1. Batch import
   - process the whole `spells[]` array
   - map each `sourceDocument` into the app spell schema

2. Individual import
   - select one spell from the batch
   - inspect `spellSummary`
   - import from `sourceDocument`

## Immediate Follow-Up

The next app-side spell work should build:

- a batch import surface for this payload
- an individual import/review surface
- a spell detail layout modeled after the 5etools spell page with:
  - left search/filter list
  - right detail pane

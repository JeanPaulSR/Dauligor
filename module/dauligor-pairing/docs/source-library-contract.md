# Dauligor Source Library Contract

This document explains the local file system used to simulate Dauligor "Sources & Documents" inside the Foundry module.

Use this when you want to drop files into the module and have the importer behave as if it were reading from the app's source pages.

## Goal

The app UI you showed has two important layers:

1. a source list page
2. a source detail page with linked content

To simulate that locally, the module now supports a source library under:

`data/sources/`

For class importing, the wizard reads:

- `data/sources/catalog.json`

Then, when you choose a source, it opens that source's linked class catalog.

## Directory Layout

Recommended layout:

```text
data/
  sources/
    catalog.json
    <source-slug>/
      source.json
      classes/
        catalog.json
        <class-file>.json
      spells/
        catalog.json
        <spell-file>.json
      items/
        catalog.json
        <item-file>.json
      bestiary/
        catalog.json
        <creature-file>.json
      journals/
        catalog.json
        <journal-file>.json
```

Only `catalog.json`, `source.json`, and `classes/catalog.json` are needed for the current class importer.

The other folders are part of the contract so the source system can grow into spells, items, bestiary, and journals later.

## Required Documents

### 1. Source Library Index

File:

- `data/sources/catalog.json`

Purpose:

- powers the import wizard source list
- simulates the app's "Sources & Documents" page
- tells the module which sources exist and where their linked content lives

Expected shape:

```json
{
  "kind": "dauligor.source-catalog.v1",
  "schemaVersion": 1,
  "source": {
    "system": "dauligor",
    "entity": "source-catalog",
    "id": "local-source-library"
  },
  "entries": [
    {
      "sourceId": "source-phb-2014",
      "slug": "players-handbook",
      "name": "Player's Handbook",
      "shortName": "PHB",
      "description": "Core 2014 source metadata and linked content manifests for local importer testing.",
      "status": "ready",
      "rules": "2014",
      "tags": ["core", "official", "2014"],
      "supportedImportTypes": ["classes-subclasses"],
      "counts": {
        "classes": 1,
        "spells": 0,
        "items": 0,
        "bestiary": 0,
        "journals": 0
      },
      "detailUrl": "players-handbook/source.json",
      "classCatalogUrl": "players-handbook/classes/catalog.json"
    }
  ]
}
```

Identity note:

- at the source-library layer, `sourceId` means the source/book identity
- example: `source-phb-2014`
- this is different from a class document id or a class identifier

Current importer usage:

- `sourceId`
- `slug`
- `name`
- `shortName`
- `description`
- `status`
- `rules`
- `tags`
- `supportedImportTypes`
- `counts`
- `detailUrl`
- `classCatalogUrl`

### 2. Source Detail Document

File:

- `data/sources/<source-slug>/source.json`

Purpose:

- simulates the app's source detail page
- stores the source metadata card
- stores linked content counts and per-family catalog URLs

Expected shape:

```json
{
  "kind": "dauligor.source.v1",
  "schemaVersion": 1,
  "sourceId": "source-phb-2014",
  "slug": "players-handbook",
  "name": "Player's Handbook",
  "shortName": "PHB",
  "description": "The Players Handbook",
  "coverImage": "",
  "status": "ready",
  "rules": "2014",
  "tags": ["core", "official", "2014"],
  "dates": {
    "addedAt": "2026-04-13T00:00:00.000Z",
    "updatedAt": "2026-04-20T00:00:00.000Z"
  },
  "linkedContent": {
    "classes": {
      "count": 1,
      "catalogUrl": "classes/catalog.json"
    },
    "spells": {
      "count": 0,
      "catalogUrl": null
    },
    "items": {
      "count": 0,
      "catalogUrl": null
    },
    "bestiary": {
      "count": 0,
      "catalogUrl": null
    },
    "journals": {
      "count": 0,
      "catalogUrl": null
    }
  }
}
```

Identity note:

- `source.json.sourceId` should match the source entry in `data/sources/catalog.json`
- it identifies the source itself, not an individual class, spell, or item inside that source

Current importer usage:

- not required for class import yet
- included now so the source system matches the app structure and is ready for later source-detail UI

### 3. Per-Family Linked Content Catalog

For classes:

- `data/sources/<source-slug>/classes/catalog.json`

Purpose:

- simulates the "Linked Content -> Classes" section of a source detail page
- tells the module which class payloads belong to that source

Expected shape:

```json
{
  "kind": "dauligor.class-catalog.v1",
  "schemaVersion": 1,
  "source": {
    "system": "dauligor",
    "entity": "class-catalog",
    "id": "source-phb-2014-classes",
    "sourceId": "source-phb-2014"
  },
  "entries": [
    {
      "sourceId": "fixture:class:source-phb-2014:sorcerer-semantic-export",
      "name": "Sorcerer (App Semantic Export)",
      "type": "class",
      "img": "icons/svg/item-bag.svg",
      "rules": "2014",
      "description": "Current Dauligor app semantic full export fixture linked through the local Player's Handbook source.",
      "payloadKind": "dauligor.semantic.class-export",
      "payloadUrl": "sorcerer.json"
    }
  ]
}
```

Important:

- the current class browser already understands `dauligor.class-catalog.v1`
- so reusing that shape here means the source layer can stay thin

### 4. Per-Document Payload Files

For classes:

- `data/sources/<source-slug>/classes/<class-file>.json`

Purpose:

- contains the actual importable class payload
- this can be either:
  - `dauligor.class-bundle.v1`
  - semantic full class export
  - raw Foundry-like class item JSON

Recommended for current work:

- use the semantic full class export

Example:

- `data/sources/players-handbook/classes/sorcerer.json`

## Minimum File Set for a Working Class Source

To simulate one working source with classes, you need:

1. `data/sources/catalog.json`
2. `data/sources/<source-slug>/source.json`
3. `data/sources/<source-slug>/classes/catalog.json`
4. `data/sources/<source-slug>/classes/<class-file>.json`

That is enough for:

- the import wizard to show the source
- the class browser to load that source's classes
- the importer to fetch the actual class payload

## Associated Information by Layer

### Source List Layer

Represents:

- the main source cards page

Needed information:

- source id
- name
- short name
- short description
- status
- rules year
- tags
- linked content counts

Stored in:

- `data/sources/catalog.json`

### Source Detail Layer

Represents:

- the single source page
- cover image
- description
- content tags
- dates
- linked content families

Needed information:

- source metadata
- cover image URL or empty string
- added/updated dates
- linked content counts
- URLs to each family catalog

Stored in:

- `data/sources/<source-slug>/source.json`

### Linked Content Family Layer

Represents:

- the lists under `Classes`, `Spells`, `Items`, `Bestiary`, and similar sections

Needed information:

- which documents belong to that source
- which payload file to fetch for each document

Stored in:

- `data/sources/<source-slug>/<family>/catalog.json`

### Document Detail Layer

Represents:

- the actual class, spell, item, feat, creature, or journal data

Needed information:

- the import payload itself

Stored in:

- `data/sources/<source-slug>/<family>/<document>.json`

## Current Local Sample

This module now includes a working local sample:

- `data/sources/catalog.json`
- `data/sources/players-handbook/source.json`
- `data/sources/players-handbook/classes/catalog.json`
- `data/sources/players-handbook/classes/sorcerer.json`

That sample points at the current Dauligor app-style Sorcerer semantic export.

## How to Add Another Source

To add another source, copy the pattern:

1. Create a folder under `data/sources/`, for example `xanathars-guide`.
2. Add `source.json` in that folder.
3. Add `classes/catalog.json` in that folder if the source has classes.
4. Add one or more class payload files in `classes/`.
5. Register the new source in `data/sources/catalog.json`.

## Current Runtime Behavior

For the current class importer:

- the wizard reads `data/sources/catalog.json`
- selecting a source chooses its `classCatalogUrl`
- opening the class importer reads that source-specific class catalog

That means you no longer have to hardcode a source in the wizard just to test a new source library entry.

## Future Expansion

The same pattern can be used for:

- spells
- items
- feats
- bestiary
- journals

The family-level catalogs are intentionally separated so the importer can later filter and browse each source family independently, just like the app design.

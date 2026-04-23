# Dauligor Journal Import Contract

This document defines the target payload contract for journal imports.

Journals are mechanically lighter than classes or spells, so they make a good early endpoint family after item imports stabilize.

## Recommended Payload Kinds

Catalog:

```json
"dauligor.journal-catalog.v1"
```

Detail payload:

```json
"dauligor.journal.v1"
```

## Catalog Payload

Expected shape:

```json
{
  "kind": "dauligor.journal-catalog.v1",
  "schemaVersion": 1,
  "source": {
    "system": "dauligor",
    "entity": "journal-catalog",
    "id": "campaign-journals"
  },
  "entries": [
    {
      "sourceId": "journal-ravenloft-overview",
      "name": "Ravenloft Overview",
      "type": "journal",
      "payloadKind": "dauligor.journal.v1",
      "payloadUrl": "https://app.example/api/foundry/journals/journal-ravenloft-overview.json"
    }
  ]
}
```

## Detail Payload

Expected shape:

```json
{
  "kind": "dauligor.journal.v1",
  "schemaVersion": 1,
  "source": {
    "system": "dauligor",
    "entity": "journal",
    "id": "journal-ravenloft-overview",
    "revision": 1
  },
  "journal": {}
}
```

## Journal Root Contract

Minimum journal fields:

- `name`
- `pages`
- `flags.dauligor-pairing.sourceId`

Recommended example:

```json
{
  "name": "Ravenloft Overview",
  "flags": {
    "dauligor-pairing": {
      "sourceId": "journal-ravenloft-overview",
      "sourceType": "journal"
    }
  },
  "pages": [
    {
      "name": "Overview",
      "type": "text",
      "text": {
        "format": 1,
        "content": "<p>Welcome to Ravenloft.</p>"
      }
    }
  ]
}
```

## Page Types

For the earliest Dauligor journal endpoints, prioritize:

- `text`
- `image`

Those two page families cover most lore and reference use cases cleanly.

You can add more page types later when needed.

## Identity Rules

Use stable semantic ids such as:

- `journal-ravenloft-overview`
- `journal-waterdeep-factions`

Page-level source ids are optional for the first pass, but recommended if the app expects to update individual pages later.

Recommended page source-id pattern:

- `journal-ravenloft-overview:page:overview`

## Matching Order

Journal matching order:

1. `flags.dauligor-pairing.sourceId`
2. `name`

Page matching order, once page-level sync is added:

1. `flags.dauligor-pairing.sourceId`
2. `name` + `type`

## Rich Text Rule

Journal content should be sent as already-renderable rich text or HTML.

If Dauligor stores markdown internally, convert it before the Foundry payload is returned.

That keeps the journal endpoint simpler and makes the import result predictable.

## Recommended Endpoints

1. `GET /api/foundry/journals/catalog`
2. `GET /api/foundry/journals/:sourceId`

# Dauligor Class Endpoint Notes

This is the short handoff note for the class endpoints only.

Use this file when the question is:

- which endpoint shapes does the Foundry module want?
- what should the catalog return?
- what should the detail payload return?

Use these for the full contract behind the endpoints:

- `docs/class-import-contract.md`
- `docs/class-semantic-export-notes.md`
- `docs/class-import-and-advancement-guide.md`

## Core Rule

The class importer wants two layers:

1. a browser/catalog layer
2. a full detail payload for one selected class

The module currently accepts two detail-payload families:

- `dauligor.class-bundle.v1`
- the semantic full-export shape documented in `docs/class-semantic-export-notes.md`

## Catalog Endpoint

Purpose:

- populate the Foundry class browser
- provide the list of importable classes
- tell the module where to fetch one class payload

Kind:

```json
"dauligor.class-catalog.v1"
```

Minimum shape:

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

## Detail Endpoint: Normalized Bundle

Purpose:

- return one import-ready class bundle
- include the class item plus the feature/support data it can grant

Kind:

```json
"dauligor.class-bundle.v1"
```

Minimum shape:

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

Use this payload when the app wants to do more of the normalization work itself.

## Detail Endpoint: Semantic Full Export

Purpose:

- let the app stay close to its own semantic class model
- let the module synthesize the Foundry-like class bundle internally

Minimum structural shape:

```json
{
  "class": {},
  "subclasses": [],
  "features": [],
  "scalingColumns": [],
  "spellsKnownScalings": {},
  "alternativeSpellcastingScalings": {},
  "uniqueOptionGroups": [],
  "uniqueOptionItems": []
}
```

Use this payload when the app wants one rich class export instead of a pre-normalized bundle.

Notes:

- `spellcastingScalings` is an older bridge field and should not be used for new exports
- `spellsKnownScalings` is the current semantic source for cantrips/spells known progressions
- `alternativeSpellcastingScalings` is the current semantic source for pact-style or other alternate slot progressions

For the exact field behavior, read:

- `docs/class-semantic-export-notes.md`

## Identity Reminder

Do not solve identity in the endpoint note itself. Follow the full contract.

The short rule is:

- `sourceId` is provenance or stable semantic identity depending on the layer
- `id` is the app record id
- `identifier` is the semantic slug
- Foundry-local `_id` values are the module's job

For the exact rules, read:

- `docs/class-import-contract.md`

## Advancement Reminder

Do not put Foundry-local advancement ids into endpoint payloads.

The app should send semantic advancement ids and semantic relationships.

The module is responsible for:

- generating actor-safe 16-character advancement ids when needed
- resolving `ItemGrant` and `ItemChoice` references in Foundry terms
- persisting chosen advancement state on embedded actor class items

For the full rules, read:

- `docs/advancement-construction-guide.md`
- `docs/class-import-and-advancement-guide.md`

## Source-Library Reminder

If the app wants to mirror the source browser flow locally, the source list and linked source files are documented in:

- `docs/source-library-contract.md`

# Dauligor Feat Import Contract

This document defines the target payload contract for feat-like imports.

Scope for this version:

- general feats
- actor-owned feat items
- class-feature-style feat items

Handled separately:

- classes
- subclasses
- spells

## Recommended Payload Kinds

Catalog:

```json
"dauligor.item-catalog.v1"
```

Detail payload:

```json
"dauligor.item.v1"
```

For v1, feats can be transported as item payloads where:

- `item.type` is `"feat"`

## Detail Payload

Expected shape:

```json
{
  "kind": "dauligor.item.v1",
  "schemaVersion": 1,
  "source": {
    "system": "dauligor",
    "entity": "feat",
    "id": "feat-war-caster",
    "rules": "2014",
    "revision": 1
  },
  "item": {}
}
```

## Minimum Feat Fields

Minimum fields:

- `name`
- `type: "feat"`
- `img`
- `system`
- `flags.dauligor-pairing.sourceId`

Recommended example:

```json
{
  "name": "War Caster",
  "type": "feat",
  "img": "icons/svg/item-bag.svg",
  "flags": {
    "dauligor-pairing": {
      "sourceId": "feat-war-caster",
      "sourceType": "feat"
    }
  },
  "system": {
    "source": {},
    "description": {
      "value": "<p>You have practiced casting spells in the midst of combat.</p>",
      "chat": ""
    },
    "requirements": "The ability to cast at least one spell",
    "activities": {}
  }
}
```

## Identity Rules

Use stable semantic ids such as:

- `feat-war-caster`
- `feat-alert`
- `class-feature-font-of-magic`

The important distinction is `sourceType`.

Recommended values:

- `feat` for general feats
- `classFeature` for features granted through a class bundle
- `subclassFeature` later when subclass importing is formalized

## General Feats vs. Class Features

Foundry often stores both as `Item` documents of type `feat`, but Dauligor should keep them logically distinct.

Recommended flag examples:

General feat:

```json
{
  "flags": {
    "dauligor-pairing": {
      "sourceId": "feat-war-caster",
      "sourceType": "feat"
    }
  }
}
```

Class feature:

```json
{
  "flags": {
    "dauligor-pairing": {
      "sourceId": "class-feature-font-of-magic",
      "sourceType": "classFeature",
      "classSourceId": "class-sorcerer"
    }
  }
}
```

That distinction is important for:

- pruning higher-level class features on actor reimport
- later subclass import support
- keeping general feat import separate from class progression logic

## Behavior Rule

A feat can be:

- passive description only
- a limited-use ability
- an attack or utility action
- an effect source

So Dauligor should plan to support:

- `system.activities`
- `system.uses`
- `effects`

when the feat is mechanically active in play.

For a source-backed breakdown of `dnd5e` feature activity construction, see:

- `docs/class-feature-activity-contract.md`

## Matching Order

World item matching order:

1. `flags.dauligor-pairing.sourceId`
2. `name` + `type`

Actor embedded feat matching order:

1. `flags.dauligor-pairing.sourceId`
2. `name` + `type`

## Endpoints (shipped)

The Foundry side feat importer pulls from two live read-through
endpoints, mirroring the spell importer's surface. The same source
catalog at `/api/module/sources/catalog.json` carries each source's
`counts.feats` and adds `"feats"` to `supportedImportTypes` whenever
a source has at least one feat row — the wizard filters by both.

1. **Per-source feat list (lightweight summaries)**

   ```
   GET /api/module/<source-slug>/feats.json
   ```

   Returns a `dauligor.source-feat-list.v1` bundle:

   ```jsonc
   {
     "kind": "dauligor.source-feat-list.v1",
     "schemaVersion": 1,
     "sourceId": "<row-id>",
     "sourceSlug": "<slug>",
     "sourceSemanticId": "source-phb-2014",
     "feats": [
       {
         "name": "War Caster",
         "type": "feat",
         "img": "https://images.dauligor.com/...",
         "flags": {
           "dauligor-pairing": {
             "schemaVersion": 1,
             "entityKind": "feat",
             "sourceId": "feat-war-caster",
             "dbId": "<row-id>",
             "featSourceType": "feat",
             "featType": "feat",
             "featSubtype": "",
             "featSpellSourceId": "source-phb-2014",
             "repeatable": false,
             "hasUses": false,
             "hasActivities": false,
             "hasEffects": false,
             "hasAdvancements": false,
             "hasPrereqs": true,
             "requirements": "Level 4+ and Initiate of High Sorcery",
             "tagIds": []
           }
         }
       }
     ],
     "generatedAt": 1779754000000
   }
   ```

2. **Per-feat full item (heavy)**

   ```
   GET /api/module/feats/<dbId>.json
   ```

   Returns a `dauligor.feat-item.v1` bundle containing the full
   Foundry-ready `Item` document. The `feat` field is what the
   importer hands to `actor.createEmbeddedDocuments("Item", [feat])`.

   The `system.advancement` block is rebuilt as a Foundry-shape
   keyed-object map (`{ "<_id>": Advancement, ... }`) from the
   Dauligor-side `feats.advancements` array — `_id` keys are
   preserved verbatim so a round-trip through the export side
   doesn't mint new advancement IDs. `system.activities` follows
   the same convention.

The split keeps the picker's initial pool fetch lightweight (~600
bytes/feat) and only pays the full-feat cost (~2-5 KB) for the
feats the user actually picks.

## Requirements Rendering

The `requirements` field on the summary (and `system.requirements`
on the full feat) is produced by `api/_lib/_featRequirements.ts`,
which mirrors the website's `formatRequirementText` pipeline from
`src/lib/requirements.ts`. The render walks `feats.requirements_tree`
(the structured tree authored alongside Modular Option features
and Choice-of-Feature advancements) and resolves referenced
entities (classes, subclasses, features, spells, spell rules) to
their names via a single batched fetch per leaf-type.

Rows that pre-date `requirements_tree` (or have a `null` tree) fall
back to the legacy `feats.requirements` free-text column so older
content keeps working unchanged. Both code paths feed the same
`requirements` field on the wire, so the picker doesn't need to
distinguish.

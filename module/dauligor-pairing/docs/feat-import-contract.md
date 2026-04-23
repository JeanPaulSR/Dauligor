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

## Recommended Endpoints

1. `GET /api/foundry/feats/catalog`
2. `GET /api/foundry/feats/:sourceId`

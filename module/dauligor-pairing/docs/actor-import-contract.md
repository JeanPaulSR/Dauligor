# Dauligor Actor Import Contract

This is the generic actor transport contract.

Use this file when the question is broader than class-driven character import, for example:

- actor catalog and actor bundle payload shape
- generic actor root expectations
- embedded item transport on actors
- character versus NPC transport at a high level

If the actual question is about class-driven characters, use:

- `docs/character-class-import-guide.md`

That is the canonical guide for:

- classes
- subclasses
- class features
- subclass features
- advancement persistence on characters

## Scope

This file covers:

- player character transport
- NPC transport
- actor root identity
- actor root data
- embedded item bundles

It does not try to restate the full class-driven character behavior contract.

## Recommended Payload Kinds

Catalog:

```json
"dauligor.actor-catalog.v1"
```

Detail:

```json
"dauligor.actor-bundle.v1"
```

## Catalog Payload

Minimum shape:

```json
{
  "kind": "dauligor.actor-catalog.v1",
  "schemaVersion": 1,
  "source": {
    "system": "dauligor",
    "entity": "actor-catalog",
    "id": "campaign-actors"
  },
  "entries": [
    {
      "sourceId": "character-althea",
      "name": "Althea",
      "type": "character",
      "img": "icons/svg/mystery-man.svg",
      "payloadKind": "dauligor.actor-bundle.v1",
      "payloadUrl": "https://app.example/api/foundry/actors/character-althea.json"
    }
  ]
}
```

## Detail Payload

Minimum shape:

```json
{
  "kind": "dauligor.actor-bundle.v1",
  "schemaVersion": 1,
  "source": {
    "system": "dauligor",
    "entity": "actor",
    "id": "character-althea",
    "rules": "2014",
    "revision": 1
  },
  "actor": {},
  "items": []
}
```

## Identity Rules

The actor bundle should still follow the normal Dauligor identity split:

- `sourceId`
  - stable semantic provenance or stable transport identity
- `id`
  - app record id
- `identifier`
  - semantic slug when the object family uses one

Required actor-facing identity fields:

- `actor.flags.dauligor-pairing.sourceId`
- `items[].flags.dauligor-pairing.sourceId`

Recommended actor source ids:

- `character-althea`
- `npc-skeleton-archer`

Recommended embedded item source ids:

- `character-althea:class:sorcerer`
- `character-althea:spell:fireball`
- `character-althea:item:wand-of-magic-missiles`

## Generic Actor Root Contract

Minimum root fields:

- `name`
- `type`
- `img`
- `system`
- `flags.dauligor-pairing.sourceId`

Preferred minimal example:

```json
{
  "name": "Althea",
  "type": "character",
  "img": "icons/svg/mystery-man.svg",
  "flags": {
    "dauligor-pairing": {
      "sourceId": "character-althea",
      "sourceType": "actor"
    }
  },
  "system": {
    "abilities": {},
    "attributes": {},
    "details": {},
    "skills": {},
    "traits": {},
    "currency": {}
  }
}
```

## Character Actors

For `type: "character"`, the actor root should usually carry:

- `system.abilities`
- `system.attributes`
- `system.details`
- `system.skills`
- `system.traits`
- `system.currency`

But for class-driven characters, much of the important build state should live on embedded class/subclass items and their advancements rather than being flattened onto the actor root.

For that behavior contract, use:

- `docs/character-class-import-guide.md`

## NPC Actors

For `type: "npc"`, the actor root usually carries more of the actual runtime truth.

Typical important families:

- `system.abilities`
- `system.attributes.ac`
- `system.attributes.hp`
- `system.attributes.movement`
- `system.details`
- `system.skills`
- `system.traits`
- `system.senses`

NPC actions may still be represented as embedded items when they should use native activities or effects.

## Embedded Items

`items[]` should contain Foundry-like item sources for anything the actor owns, knows, or uses.

Common families:

- `class`
- `subclass`
- `feat`
- `spell`
- `weapon`
- `equipment`
- `consumable`
- `tool`
- `loot`
- `background`
- `species`

The actor bundle should not assume that embedded item ids are globally unique outside that actor.

The safe rule is:

- each embedded item gets its own stable `flags.dauligor-pairing.sourceId`
- the module decides whether that item remains actor-only or also exists in the world library

## Generic Sync Policy

Use this high-level rule:

- Dauligor owns build data
- Foundry may temporarily own local session-state data

In practice:

- actor root structure comes from the bundle
- embedded items are matched by `flags.dauligor-pairing.sourceId`
- actor-local transient state should not be confused with export truth

## Related Documents

- `docs/character-class-import-guide.md`
- `docs/class-import-contract.md`
- `docs/item-import-contract.md`
- `docs/spell-import-contract.md`

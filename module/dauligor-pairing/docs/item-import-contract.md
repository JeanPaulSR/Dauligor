# Dauligor Item Import Contract

This document defines the target payload contract for non-class item imports.

Scope for this version:

- weapons
- equipment and armor
- consumables
- tools
- loot and wondrous items
- containers
- backgrounds
- species

Handled separately:

- classes
- spells
- feats

## Related Documents

Use this contract with:

- [class-feature-activity-contract.md](E:/DnD/Professional/Webpage/module/dauligor-pairing/docs/class-feature-activity-contract.md)
- [reference-syntax-guide.md](E:/DnD/Professional/Webpage/module/dauligor-pairing/docs/reference-syntax-guide.md)
- [dae-midi-character-support.md](E:/DnD/Professional/Webpage/module/dauligor-pairing/docs/dae-midi-character-support.md)
- [midi-qol-compatibility.md](E:/DnD/Professional/Webpage/module/dauligor-pairing/docs/midi-qol-compatibility.md)

## Recommended Payload Kinds

Catalog:

```json
"dauligor.item-catalog.v1"
```

Detail payload:

```json
"dauligor.item.v1"
```

## Catalog Payload

Expected shape:

```json
{
  "kind": "dauligor.item-catalog.v1",
  "schemaVersion": 1,
  "source": {
    "system": "dauligor",
    "entity": "item-catalog",
    "id": "campaign-items"
  },
  "entries": [
    {
      "sourceId": "item-potion-of-healing",
      "name": "Potion of Healing",
      "type": "consumable",
      "img": "icons/svg/item-bag.svg",
      "payloadKind": "dauligor.item.v1",
      "payloadUrl": "https://app.example/api/foundry/items/item-potion-of-healing.json"
    }
  ]
}
```

## Detail Payload

Expected shape:

```json
{
  "kind": "dauligor.item.v1",
  "schemaVersion": 1,
  "source": {
    "system": "dauligor",
    "entity": "item",
    "id": "item-potion-of-healing",
    "rules": "2014",
    "revision": 1
  },
  "item": {}
}
```

## Core Item Contract

Minimum fields:

- `name`
- `type`
- `img`
- `system`
- `flags.dauligor-pairing.sourceId`

Recommended generic example:

```json
{
  "name": "Potion of Healing",
  "type": "consumable",
  "img": "icons/svg/item-bag.svg",
  "flags": {
    "dauligor-pairing": {
      "sourceId": "item-potion-of-healing",
      "sourceType": "item"
    }
  },
  "system": {
    "source": {},
    "description": {
      "value": "<p>Heals when consumed.</p>",
      "chat": ""
    },
    "quantity": 1,
    "weight": {
      "value": 0.5,
      "units": "lb"
    },
    "price": {
      "value": 50,
      "denomination": "gp"
    }
  }
}
```

## Identity Rules

Use stable semantic ids such as:

- `item-potion-of-healing`
- `weapon-longsword`
- `equipment-chain-mail`
- `loot-bag-of-holding`

Do not use:

- world UUIDs
- random Foundry item ids
- timestamps as item identity

## Behavior Rule

For modern `dnd5e`, an item is not complete if it only has a description.

When a mechanic matters at runtime, Dauligor should treat these as the authoritative gameplay surfaces:

- `system.activities`
- `system.uses`
- `effects`

This is especially important for:

- consumables
- magical weapons
- charge-based wondrous items
- tools or items with roll behaviors
- items expected to interact with DAE or Midi-QOL

If an item can be clicked, rolled, consumed, toggled, targeted, or used to apply an effect, it should usually not be modeled as description-only.

## Common Item Branches

These branches are widely useful across item families:

- `system.source`
- `system.description`
- `system.quantity`
- `system.weight`
- `system.price`
- `system.attuned`
- `system.equipped`
- `system.identified`
- `system.rarity`
- `system.uses`
- `system.activities`
- `effects`

Not every type uses every branch, but Dauligor should model them as structured data, not raw text.

## Activities And Effects Are First-Class

The most important update for the item contract is this:

- runtime item behavior should be activity-driven
- persistent or applied behavior should be effect-driven

That means:

- attacks should usually be native attack activities
- damage-only items should usually be native damage activities
- healing items should usually be native heal activities
- utility interactions should usually be native utility or check activities
- buffs/debuffs/toggles should usually include real Active Effects

For the supported activity families and their field shapes, use:

- [class-feature-activity-contract.md](E:/DnD/Professional/Webpage/module/dauligor-pairing/docs/class-feature-activity-contract.md)

That document is feature-oriented, but the same native activity families apply to item documents.

## DAE And Midi-QOL Rule

Items do not need a separate Dauligor-only automation format for DAE or Midi.

The safe model is:

1. build valid native `dnd5e` items
2. give them valid native `system.activities`
3. give them valid native `effects`
4. add DAE or Midi flags only where a real automation need exists

Important implications:

- DAE support is primarily about Active Effects, their formulas, durations, and flags
- Midi support is primarily about `activity.use()`, item effects, and optional `flags.midi-qol.*`
- the actor shell is not what makes an item DAE/Midi compatible
- the item document itself does

For the current Dauligor direction, item support should stay:

- `dnd5e`-native first
- DAE/Midi-aware second

## References Inside Items

Item formulas, effect values, and descriptive text should use the semantic reference language from:

- [reference-syntax-guide.md](E:/DnD/Professional/Webpage/module/dauligor-pairing/docs/reference-syntax-guide.md)

Examples:

- `@prof`
- `@ability.str.mod`
- `@attr.hp.max`
- `@class.sorcerer.level`
- `@scale.sorcerer.sorcery-points`

The module should normalize those into native Foundry formula paths or UUID links at import time.

## Weapon Expectations

For `type: "weapon"`, plan for:

- weapon classification
- range or reach
- damage
- proficiency-related properties
- magical and attunement state when applicable
- activities for attacks or special uses
- effects when the weapon grants persistent bonuses, toggles, or rider logic

Typical data families include:

- `system.type`
- `system.range`
- `system.damage`
- `system.properties`
- `system.activities`
- `effects`

## Equipment and Armor Expectations

For `type: "equipment"`, plan for:

- armor type or equipment subtype
- AC contribution where relevant
- strength requirement where relevant
- stealth effect where relevant
- attunement and equip state when applicable

Typical data families include:

- `system.type`
- `system.armor`
- `system.strength`
- `system.stealth`
- `system.equipped`

## Consumable Expectations

For `type: "consumable"`, plan for:

- subtype such as potion, scroll, or ammunition
- uses and recovery behavior
- auto-destroy behavior where relevant
- activity data for healing, damage, buffs, or spell-like use
- effects when the consumable applies a lasting condition or buff

Typical data families include:

- `system.type`
- `system.uses`
- `system.activities`
- `system.properties`
- `effects`

## Tool Expectations

For `type: "tool"`, plan for:

- tool subtype
- relevant ability
- proficiency-facing data
- optional activities if Dauligor wants richer use behavior later
- optional effects only if a specific tool use grants a persistent effect

## Loot and Wondrous Item Expectations

For `type: "loot"`, plan for:

- rarity
- identification state
- attunement state if magical
- optional use activities
- optional effects

This is a good catch-all family for wondrous items, trade goods, and unusual carry items.

## Container Expectations

For `type: "container"`, plan for:

- capacity
- currency storage if relevant
- parent-child inventory relationships later

For now, the most important contract point is stable identity and correct inventory fields.

## Background and Species

These are item-like documents with more build-oriented meaning.

Dauligor should still send them as item payloads with:

- stable `sourceId`
- structured `system` data
- advancement or grant data only when verified against a real export

If a field is not yet verified from a local export, prefer a conservative payload over invented structures.

## Best Current Direction

If you are deciding between:

- "just export the item text for now"
- or
- "export an item with native activities/effects"

the second direction is the one that will age better for:

- stock `dnd5e`
- DAE
- Midi-QOL

The current item contract should be read as activity-first and effect-aware, not as a plain description transport.

## Matching Order

World item matching order:

1. `flags.dauligor-pairing.sourceId`
2. `system.identifier` when applicable
3. `name` + `type`

Actor embedded item matching order:

1. `flags.dauligor-pairing.sourceId`
2. `system.identifier` when applicable
3. `name` + `type`

## Module-Written Metadata

The module may add:

- `flags.dauligor-pairing.importedAt`
- `flags.dauligor-pairing.lastSyncedAt`
- `flags.dauligor-pairing.importMode`
- `flags.dauligor-pairing.moduleVersion`
- `flags.dauligor-pairing.payloadKind`
- `flags.dauligor-pairing.schemaVersion`

## Recommended Endpoints

1. `GET /api/foundry/items/catalog`
2. `GET /api/foundry/items/:sourceId`

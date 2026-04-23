# Dauligor Spell Import Contract

This document defines the target payload contract for spell imports.

Spells are documented separately from generic items because their runtime behavior matters more than their text alone.

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

For v1, spells can travel through the same `dauligor.item.v1` envelope as other items.

The important rule is:

- `item.type` must be `"spell"`

## Spell Detail Payload

Expected shape:

```json
{
  "kind": "dauligor.item.v1",
  "schemaVersion": 1,
  "source": {
    "system": "dauligor",
    "entity": "spell",
    "id": "spell-fireball",
    "rules": "2014",
    "revision": 1
  },
  "item": {}
}
```

## Minimum Spell Fields

Minimum fields:

- `name`
- `type: "spell"`
- `img`
- `system`
- `flags.dauligor-pairing.sourceId`
- `system.activities` when the spell has runtime use behavior
- `effects` when the spell applies a persistent or temporary effect

Recommended example:

```json
{
  "name": "Fireball",
  "type": "spell",
  "img": "icons/svg/item-bag.svg",
  "flags": {
    "dauligor-pairing": {
      "sourceId": "spell-fireball",
      "sourceType": "spell"
    }
  },
  "system": {
    "source": {},
    "description": {
      "value": "<p>A bright streak flashes to a point you choose...</p>",
      "chat": ""
    },
    "level": 3,
    "school": "evo",
    "activation": {},
    "range": {},
    "target": {},
    "duration": {},
    "materials": {},
    "properties": [],
    "preparation": {},
    "activities": {}
  }
}
```

## Identity Rules

Use stable semantic ids such as:

- `spell-fireball`
- `spell-cure-wounds`
- `spell-prestidigitation`

If the same base spell is embedded on a specific actor and the actor should own a separate copy, the actor import layer may namespace it further, but the spell definition itself should still have a stable source id.

## Required Spell Data Families

Dauligor should plan to send structured data for:

- spell level
- school
- components and materials
- preparation mode
- ritual or concentration flags where relevant
- scaling behavior where relevant
- activities for cast, damage, healing, save, summon, or utility behavior
- effects for buffs, debuffs, concentration-linked states, or ongoing rules text

This is the most important spell rule:

- do not reduce spells to HTML description only

## Activities Are The Runtime Surface

For modern `dnd5e`, the authoritative runtime behavior of a spell should usually live in `system.activities`.

That means:

- casting behavior should be modeled as an activity
- rider rolls should be modeled as activities when appropriate
- summoning, transformation, enchantment, saving throw, and healing logic should be modeled as activities when appropriate

The spell item can still carry root metadata like:

- level
- school
- preparation
- materials
- source

But when the question is "how does this spell behave when used?", the answer should usually be:

- its native activities

Use:

- [class-feature-activity-contract.md](E:/DnD/Professional/Webpage/module/dauligor-pairing/docs/class-feature-activity-contract.md)

for the supported activity families and field patterns.

## Effects Matter Just As Much

If a spell creates a persistent or temporary state, the spell should usually also carry native Active Effects.

Common cases:

- buffs
- debuffs
- concentration-linked effects
- ongoing conditions
- passives attached to enchantment or transformation logic

For DAE and Midi support, this is critical:

- DAE enhances Active Effects
- Midi often applies item effects as part of workflow completion

So a spell that only has text and no real effects will remain weak for automation even if the prose is accurate.

## Runtime Behavior Rule

The Foundry target should eventually be able to:

- cast the spell
- generate a useful chat card
- roll damage or healing when relevant
- apply save logic when relevant
- respect concentration, ritual, and preparation-related data

So spell endpoints should carry enough structure to support:

- `system.activities`
- `system.uses` when needed
- `effects` when relevant

That is also the safest direction for compatibility with:

- stock `dnd5e`
- DAE
- Midi-QOL

## Spell Categories Worth Supporting Explicitly

The spell endpoint design should accommodate at least:

- cantrips
- leveled spells
- concentration spells
- ritual spells
- healing spells
- attack spells
- save-based spells
- utility spells with no attack or damage
- spells with applied effects
- spells with overtime or conditional effect logic

## DAE And Midi-QOL Rule

Spells should be modeled as native `dnd5e` spells first.

That means:

1. native spell metadata
2. native `system.activities`
3. native Active Effects
4. optional DAE or Midi-specific flags only where the spell truly needs them

Important practical implications:

- DAE support is primarily about effect expressions, special durations, stacking, and macro-aware effect behavior
- Midi support is primarily about `activity.use()`, hit/save/damage automation, effect application, and optional `flags.midi-qol.*`
- a spell does not become Midi-ready just because it has a description and a level
- it becomes Midi-ready when it has the native activity/effect structure Midi can automate

## References Inside Spells

Spell descriptions, formulas, and effect values should use:

- [reference-syntax-guide.md](E:/DnD/Professional/Webpage/module/dauligor-pairing/docs/reference-syntax-guide.md)

Examples:

- `@prof`
- `@ability.cha.mod`
- `@class.sorcerer.level`
- `@scale.sorcerer.sorcery-points`

The module should normalize these into native Foundry formula paths or enriched links on import.

This is especially important for:

- damage or healing formulas
- save DC helper text
- scaling text
- DAE or Midi effect conditions

## Matching Order

World item matching order:

1. `flags.dauligor-pairing.sourceId`
2. `name` + `type`

Actor embedded spell matching order:

1. `flags.dauligor-pairing.sourceId`
2. `name` + `type`

## Module-Written Metadata

The module may add:

- `flags.dauligor-pairing.importedAt`
- `flags.dauligor-pairing.lastSyncedAt`
- `flags.dauligor-pairing.importMode`
- `flags.dauligor-pairing.moduleVersion`

## Recommended Endpoints

1. `GET /api/foundry/spells/catalog`
2. `GET /api/foundry/spells/:sourceId`

These can still return `dauligor.item-catalog.v1` and `dauligor.item.v1`, as long as the entries are clearly spell entries.

## Best Current Direction

If a spell is expected to be usable in Foundry play, the preferred export direction is:

- a valid spell item
- with native activities
- with native effects where needed
- with semantic references that normalize cleanly

That is the direction most likely to remain compatible with both:

- stock `dnd5e`
- DAE and Midi-QOL automation

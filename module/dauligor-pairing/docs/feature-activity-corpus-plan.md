# Feature Activity Corpus Plan

This file lists the real examples we have, what they already prove, and the remaining examples we still need in order to make feature activity importing reliable.

The current reference sample:

- `E:/DnD/Professional/Foundry-JSON/items/item-feature.json`

is good for structure, but not for populated values. Most complex fields are empty in that sample.

## Goal

Build a feature-activity corpus that proves:

- what fields actually get populated in real Foundry items
- which fields are optional versus practically required
- how `dnd5e` expects effect rows, riders, scaling, and visibility to behave
- which parts Dauligor should own semantically and which parts the module should synthesize

## Capture Format

For each corpus example, try to save:

1. source-side Dauligor semantic JSON
2. raw Foundry export of the imported item
3. research notes:
   - what the feature does
   - which activity types are present
   - which fields matter for actual play
   - whether Midi-QOL changes or adds expectations

## Captured Activity Families

### 1. Attack feature

Need one real feature with:

- `attack.ability`
- `attack.bonus`
- `attack.critical.threshold`
- `attack.type.value`
- `attack.type.classification`
- `damage.parts`
- `damage.critical.bonus`

Why:

- this is the most common player-facing interactive activity shape

Status:

- captured in `E:/DnD/Professional/Foundry-JSON/features/item-test-attack-feature.json`

What this example now proves:

- `attack.type.value = "melee"`
- `attack.type.classification = "weapon"`
- `activation.value` and `activation.condition`
- scalar duration with `units = "minute"` and `value = "3"`
- `description.chatFlavor`
- activity-local uses with `max` and `recovery`
- multiple `consumption.targets` types:
  - `activityUses`
  - `itemUses`
  - `hitDice`
  - `spellSlots`
  - `attribute`
- explicit target/template fields:
  - `template.type = "wall"`
  - `template.count = "2"`
  - `affects.type = "creatureOrObject"`
  - `affects.count = "2"`
  - `prompt = false`
- populated damage parts including:
  - automatic dice damage
  - custom-formula damage
  - per-part scaling modes

What is now documented well enough to build against, even before the next export:

- activation option families
- duration option families
- range and target option families
- attack type and classification values
- attack ability selector values
- damage-part die and scaling input families

What still needs more attack examples:

- explicit `attack.ability`
- non-empty `attack.bonus`
- non-null `attack.critical.threshold`
- non-empty `damage.critical.bonus`
- a more ordinary set of damage `types`

What is already known from manual field setup, even before the next export:

- `attack.ability` supports:
  - default
  - `none`
  - `spellcasting`
  - explicit abilities
- `attack.bonus` is a formula field
- `attack.critical.threshold` is a 1-20 override and defaults to normal 20 behavior when empty
- `damage.critical.bonus` is a formula field

### 2. Save feature

Why it mattered:

- save activities are one of the most common spell-like and feature-like patterns

Status:

- captured in `E:/DnD/Professional/Foundry-JSON/features/item-test-save-feature.json`

What this example now proves:

- `save.ability` persists as one or more ability keys
- `save.dc.calculation` can persist:
  - `spellcasting`
  - ability keys such as `con` and `cha`
  - empty string for custom-formula mode
- `save.dc.formula` is the explicit deterministic DC formula slot
- `damage.onSave` can persist:
  - `none`
  - `half`
  - `full`
- `effects[].onSave = false` is a real stored state
- save activities can carry both ordinary dice rows and custom-formula damage rows
- save activities can persist multi-type damage rows

What still needs more save examples:

- one sample with `effects[].onSave = true`
- one sample with a more effect-heavy save activity
- one sample showing a purely custom-formula DC with no ability-based calculation

### 3. Heal feature

Why it mattered:

- healing uses the damage-part model, and we needed to see how much of that structure really matters in practice

Status:

- captured in `E:/DnD/Professional/Foundry-JSON/features/item-test-heal-feature.json`

What this example now proves:

- `healing` uses the same `DamageField` structure as damage rows
- `healing.number`
- `healing.denomination`
- `healing.bonus`
- `healing.custom.enabled`
- `healing.scaling.number`
- healing `types` can include:
  - `healing`
  - `temphp`
  - `maximum`
- heal activities can carry ordinary activity-local effect rows

What still needs more heal examples:

- a non-empty healing custom formula
- a non-default scaling mode
- a more ordinary single-purpose healing row with only one healing type

### 4. Forward feature

Why it mattered:

- we needed to confirm how sibling activity forwarding should be modeled semantically

Status:

- captured in `E:/DnD/Professional/Foundry-JSON/features/item-test-forward-feature.json`

What this example now proves:

- `activity.id` references a sibling activity id
- forward activities can override activation
- forward activities can carry activity-local uses and recharge recovery
- forward activities can carry `consumption.targets`
- `material` is a real persisted `consumption.targets[].type`

What still needs more forward examples:

- a second sample forwarding into a different activity family
- a cleaner behavioral note for what `material` consumption should mean semantically in Dauligor

### 5. Utility feature

Need one feature with:

- `roll.formula`
- `roll.name`
- `roll.prompt`
- `roll.visible`

Why:

- utility is the easiest generic fallback type, so we need one trustworthy example

### 6. Check feature

Need one feature with:

- `check.ability`
- `check.associated`
- `check.dc.calculation`
- `check.dc.formula`

Why:

- this covers skill-check or tool-check feature flows

Status:

- partial capture in `E:/DnD/Professional/Foundry-JSON/features/item-test-check-feature.json`

What this file currently gives us:

- the check activity shell
- confirmation from the paired sheet UI that:
  - `associated` options come from skills and tools
  - `ability` options are:
    - default
    - `spellcasting`
    - the six abilities
  - `dc.calculation` options are:
    - custom formula mode
    - `spellcasting`
    - the six abilities

What is now documented well enough to build against, even before the next export:

- `check.associated` should store internal skill/tool keys, not labels
- `check.ability` accepted values
- `check.dc.calculation` accepted values
- `check.dc.formula` as a deterministic formula string

What it does not yet prove:

- populated saved `check.associated` values
- populated saved `check.ability`
- populated saved `check.dc.calculation`
- populated saved `check.dc.formula`

What we still need:

- one saved example with one or more associated skills
- one saved example with one or more associated tools
- one saved example using `spellcasting` ability
- one saved example using custom formula mode
- one saved example using ability-based DC calculation

### 7. Cast feature

Need one feature with:

- `spell.uuid`
- `spell.level`
- `spell.challenge.attack`
- `spell.challenge.save`
- `spell.challenge.override`
- `spell.properties`

Why:

- many class features are really "cast a spell through a feature"

Status:

- captured in `E:/DnD/Professional/Foundry-JSON/features/item-test-cast-feature.json`

What this example now proves:

- linked `spell.uuid`
- `spellbook = true`
- explicit `spell.level`
- `spell.challenge.override`
- explicit `spell.challenge.attack`
- explicit `spell.challenge.save`
- multiple `spell.properties` states
- override-heavy cast activities can also override:
  - activation
  - duration
  - range
  - target
- cast activities can use activity-local `uses`
- cast activities can use `visibility.identifier`
- cast activities can use `visibility.level.min/max`

What is now documented well enough to build against, even before the next export:

- cast ability selector values
- challenge override states
- spell property keys exercised by the test:
  - `vocal`
  - `somatic`
  - `material`
  - `concentration`
  - `ritual`
- override flags for activation, duration, range, and target

What still needs more cast examples:

- explicit non-empty `spell.ability`
- a case with `spellbook = false`
- a case where the linked spell UUID is external or compendium-backed in a more importer-realistic way
- clearer evidence for how Foundry expects `spell.properties` to be interpreted semantically

### 8. Damage-only feature

Need one example of a feature that uses `damage` without attack or save.

Why:

- this is a distinct model from attack and save, and the empty sample does not prove its real use

Status:

- captured in `E:/DnD/Professional/Foundry-JSON/features/item-test-damage-feature.json`

What this example now proves:

- `damage.critical.allow = false`
- direct damage-only activities use the same `DamageField` structure as attack/heal parts
- normal dice damage can persist with:
  - `number`
  - `denomination`
  - formula `bonus`
  - elemental `types`
- custom-formula damage can persist with:
  - `custom.enabled = true`
  - `custom.formula`
  - `number = null`
  - `denomination = null`

What is now documented well enough to build against, even before the next export:

- damage-only activity shell
- `critical.allow` as a boolean toggle
- ordinary damage rows
- custom-formula damage rows

What still needs more damage-only examples:

- non-empty `damage.critical.bonus`
- populated scaling modes in a pure damage activity
- a wider range of damage `types`

### 9. Enchant feature

Need one real feature with:

- `effects[].riders.activity`
- `effects[].riders.effect`
- `effects[].riders.item`
- `enchant.self`
- `restrictions.allowMagical`
- `restrictions.categories`
- `restrictions.properties`
- `restrictions.type`

Why:

- enchantment is one of the least obvious and most schema-heavy activity types

Status:

- captured in `E:/DnD/Professional/Foundry-JSON/features/item-test-enchant-feature.json`

What this example now proves:

- `enchant.self = true`
- `restrictions.allowMagical = true`
- `restrictions.type = ""` is the saved "Any Enchantable Type" state
- activity-level enchantment application rows can persist:
  - `_id`
  - `level.min`
  - `level.max`
  - `riders.activity`
  - `riders.effect`
  - `riders.item`
- the source item can carry real effects of:
  - `type = "enchantment"`
  - `type = "base"`
- the root item can also store rider links in `flags.dnd5e.riders`

What is now documented well enough to build against, even before the next export:

- enchant self toggle
- allow-magical restriction
- rider link structure
- level-gated enchantment profile rows
- enchantable type option family

What still needs more enchant examples:

- non-empty `restrictions.type`
- non-empty `restrictions.categories`
- non-empty `restrictions.properties`
- an example with `enchant.self = false`
- an example with multiple competing enchantment profiles

### 10. Summon feature

Why it mattered:

- summon is one of the most complex activity types in the system

Status:

- captured in `E:/DnD/Professional/Foundry-JSON/features/item-test-summon-feature.json`

What this example now proves:

- populated `profiles`
- `profiles[].uuid`
- `profiles[].count`
- `profiles[].cr`
- `profiles[].level.min/max`
- `bonuses.*`
- `match.*`
- `summon.mode`
- `summon.prompt`
- `tempHP`
- `creatureSizes`
- `creatureTypes`

What still needs more summon examples:

- more notes on placement/disposition behavior in actual play
- a second sample with a different summon mode emphasis
- any restrictions or secondary controls that appear only in more complex summon setups

### 11. Transform feature

Why it mattered:

- transform has a large schema and the empty sample proved almost none of its live values

Status:

- captured in `E:/DnD/Professional/Foundry-JSON/features/item-test-transform-feature.json`

What this example now proves:

- populated `profiles`
- `profiles[].uuid`
- `profiles[].sizes`
- `profiles[].types`
- `profiles[].movement`
- `settings`
- `transform.customize`
- `transform.mode`
- `transform.preset`
- `settings.effects`
- `settings.keep`
- `settings.merge`
- `settings.spellLists`
- `settings.transformTokens`
- `settings.minimumAC`
- `settings.tempFormula`

What still needs more transform examples:

- one more sample with a different preset family
- more evidence for any rarely used `other` settings
- more behavioral notes on preset-driven auto-generated settings versus manually edited settings

## Shared Field Captures Still Needed

Across all of the examples above, we also need at least one real populated example for each of these shared structures:

### Consumption targets

Need examples of:

- richer `attribute` targets
- additional `spellSlots` shapes
- more scaled consumption rows
- any other real target types used by `dnd5e` beyond the currently proven set:
  - `activityUses`
  - `itemUses`
  - `hitDice`
  - `spellSlots`
  - `attribute`
  - `material`

### Uses and recovery

Need examples of:

- `max`
- `spent`
- `recovery.period`
- `recovery.type`
- `recovery.formula`

### Range and target

Need examples of:

- scalar range
- touch/self/special
- template targeting
- individual target counts
- `prompt = false`

### Visibility

Need examples of:

- `visibility.identifier`
- `visibility.level.min/max`
- `requireMagic`
- `requireAttunement`
- `requireIdentification`

Current status:

- partially captured via the cast sample

### Effects

Need examples of:

- activity-local effect rows
- item-root effect rows
- level-gated effect rows
- effect rows that remain on successful save
- rider-linked effect rows

## Good Candidate Feature Families

If you want practical targets to capture from Foundry, these are good next examples:

- a smite-like feature
- a healing pool feature
- a channel-divinity-like feature
- a summon companion feature
- a wild-shape or polymorph-like feature
- a metamagic-like utility feature
- an item-imbuing or magical weapon enhancement feature

## Completion Rule

The corpus is in good shape when:

- every activity type has at least one real populated example
- every shared complex field has at least one real populated example
- each example includes both the raw Foundry export and the semantic source payload

Current reality:

- attack: captured
- cast: captured
- check: partially captured
- damage: captured
- enchant: captured
- forward: captured
- heal: captured
- save: captured
- summon: captured
- transform: captured
- utility: still needed

Until then, treat the current activity contract as a schema map with many proven value families, but not a full behavior guarantee for every edge case.

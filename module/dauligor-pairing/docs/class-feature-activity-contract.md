# Dauligor Feature Item And Activity Contract

This document describes the practical Foundry shape for a `dnd5e` feature item and the activity data that can live inside it.

It is based on:

- `E:/DnD/Professional/Foundry-JSON/items/item-feature.json`
- `E:/DnD/Professional/Foundry-JSON/features/item-test-attack-feature.json`
- `E:/DnD/Professional/Foundry-JSON/features/item-test-cast-feature.json`
- `E:/DnD/Professional/Foundry-JSON/features/item-test-check-feature.json`
- `E:/DnD/Professional/Foundry-JSON/features/item-test-damage-feature.json`
- `E:/DnD/Professional/Foundry-JSON/features/item-test-enchant-feature.json`
- `E:/DnD/Professional/Foundry-JSON/features/item-test-forward-feature.json`
- `E:/DnD/Professional/Foundry-JSON/features/item-test-heal-feature.json`
- `E:/DnD/Professional/Foundry-JSON/features/item-test-save-feature.json`
- `E:/DnD/Professional/Foundry-JSON/features/item-test-summon-feature.json`
- `E:/DnD/Professional/Foundry-JSON/features/item-test-transform-feature.json`
- local `dnd5e` `5.3.1` data model code in `C:/Users/Jean/AppData/Local/FoundryVTT/Data/systems/dnd5e/dnd5e.mjs`

Use this document for:

- class features
- subclass features
- imported option items such as Metamagic options
- feat-like features which should become `Item.type = "feat"`

Do not use this as the primary contract for:

- class items
- spell items
- weapons, armor, equipment, consumables, tools, or loot

Those families can also use `system.activities`, but they have extra item-specific rules beyond this contract.

## Core Rule

Dauligor should send semantic feature behavior.

The Foundry module should translate that behavior into:

- `Item.type = "feat"`
- `system.activities`
- `effects`
- `system.uses`
- feature-level metadata such as prerequisites, requirements, and source tracking

Dauligor should not try to generate random Foundry `_id` values for:

- the item itself
- activities
- activity effect rows
- summon or transform profiles

The module can generate Foundry-safe ids when it builds the live item.

## What The Sample Proves

`item-feature.json` is useful because it shows:

- the root `feat` item shell
- one example of every major activity type
- the shared base activity envelope
- which fields are type-specific versus shared

It is not enough on its own to prove:

- fully populated damage parts
- real consumption targets
- real save DC strategies
- real summon profiles
- real transform profiles
- real enchantment rider behavior
- real activity visibility gating
- real effect rows with level gates and rider links

So this document can define the structure, but not every best-practice value. For the missing parts, see `docs/feature-activity-corpus-plan.md`.

`item-test-attack-feature.json` is useful because it proves a real populated `attack` activity with:

- non-empty activation value and condition
- multiple consumption target types
- a scalar duration
- explicit target counts and template type
- activity-local uses and recovery
- populated damage parts

That file is currently the best concrete attack-activity example in the corpus.

`item-test-cast-feature.json` is useful because it proves two real `cast` activity variants:

- a mostly default cast activity with a linked spell UUID
- an override-heavy cast activity with custom activation, duration, range, target, uses, visibility, and spell challenge values

That file is currently the best concrete cast-activity example in the corpus.

`item-test-check-feature.json` is useful in a narrower way:

- the export itself is still default or empty
- but the paired sheet inspection confirms the concrete option sets the `dnd5e` UI allows for check activities

So this file is currently a good UI-discovery reference, but not yet a fully populated persistence example.

`item-test-damage-feature.json` is useful because it proves a real `damage` activity with:

- direct damage parts outside `attack`
- a normal dice damage row
- a custom-formula damage row
- `critical.allow = false`

That file is currently the best concrete damage-only activity example in the corpus.

`item-test-enchant-feature.json` is useful because it proves a real `enchant` activity with:

- a real enchantment effect profile on the item
- populated activity-level enchantment application rows
- rider links to:
  - sibling activities
  - base effects
  - item UUIDs
- level-gated enchantment availability
- `enchant.self = true`
- `restrictions.allowMagical = true`

That file is currently the best concrete enchant-activity example in the corpus.

`item-test-forward-feature.json` is useful because it proves a real `forward` activity with:

- a referenced sibling `activity.id`
- activation override
- activity-local uses and recharge recovery
- populated `consumption.targets`
- a persisted `material` consumption target

That file is currently the best concrete forward-activity example in the corpus.

`item-test-heal-feature.json` is useful because it proves a real `heal` activity with:

- a populated healing `DamageField`
- explicit healing-related `types`
- ordinary dice healing plus formula bonus
- a real activity-local effect row

That file is currently the best concrete heal-activity example in the corpus.

`item-test-save-feature.json` is useful because it proves a real `save` activity with:

- one and many save abilities
- explicit save DC calculation modes
- custom damage-on-save behavior
- real damage rows
- effect rows with `onSave`

That file is currently the best concrete save-activity example in the corpus.

`item-test-summon-feature.json` is useful because it proves a real `summon` activity with:

- populated summon profiles
- real Actor UUID links
- summon bonus formulas
- match and inheritance toggles
- summon mode and prompt behavior

That file is currently the best concrete summon-activity example in the corpus.

`item-test-transform-feature.json` is useful because it proves a real `transform` activity with:

- populated transform profiles
- real Actor UUID links
- explicit transform settings
- preset-driven and custom transform states
- spell-list retention and transformation-setting sets

That file is currently the best concrete transform-activity example in the corpus.

## Foundry Feature Item Shell

Your sample feature item is a Foundry `feat` item with this practical shell:

```json
{
  "name": "Feature",
  "type": "feat",
  "img": "systems/dnd5e/icons/svg/items/feature.svg",
  "system": {
    "activities": {},
    "uses": {
      "spent": 0,
      "recovery": []
    },
    "advancement": {},
    "description": {
      "value": "",
      "chat": ""
    },
    "identifier": "feature",
    "source": {
      "revision": 1,
      "rules": "2024"
    },
    "crewed": false,
    "enchant": {},
    "prerequisites": {
      "items": [],
      "repeatable": false
    },
    "properties": [],
    "requirements": "",
    "type": {
      "value": "",
      "subtype": ""
    }
  },
  "effects": [],
  "flags": {}
}
```

## Top-Level Feature Fields

These are the main feature-level fields Dauligor should understand.

### `name`

Human-readable item name.

Examples:

- `Font of Magic`
- `Metamagic`
- `Divine Magic`

### `type`

Always `"feat"` for feature-style items in this contract.

### `img`

Optional feature icon. If Dauligor does not provide one, the module can fall back to the standard `dnd5e` feature icon.

### `system.identifier`

This is the Foundry-side stable slug for the feature item.

Examples:

- `font-of-magic`
- `metamagic`
- `divine-magic`

This should be derived from the feature's semantic identity, not from a random Foundry id.

### `system.description`

```json
{
  "value": "<p>Feature rules text</p>",
  "chat": ""
}
```

- `value` is the main HTML description shown on the item sheet.
- `chat` is optional additional chat-card text.

For Dauligor, `value` should be treated as required for any real imported feature.

### `system.uses`

Feature-level uses are separate from activity-level uses.

```json
{
  "spent": 0,
  "max": "",
  "recovery": []
}
```

Use feature-level uses when the whole feature has a limited pool, regardless of which activity is triggered.

Field contract:

- `spent`
  - type: integer
  - allowed values: `0` or greater
  - meaning: how many uses have already been consumed
- `max`
  - type: deterministic formula string
  - common values:
    - `""` for no limited use pool
    - `"2"`
    - `"@prof"`
    - `"1 + @abilities.cha.mod"`
  - meaning: the maximum uses available before applying `spent`
- `recovery`
  - type: array of recovery rows
  - each row has:
    - `period`: required string
    - `type`: required string for non-recharge rows
    - `formula`: formula string when required

Accepted `recovery[].period` values confirmed from local `dnd5e`:

- `lr`
- `sr`
- `day`
- `dawn`
- `dusk`
- `initiative`
- `turnStart`
- `turnEnd`
- `turn`
- `recharge`

Accepted `recovery[].type` values confirmed from the editor:

- `recoverAll`
- `loseAll`
- `formula`

`recovery[].formula` rules:

- for `type = "formula"`, this is the formula used to recover or lose uses
- for `period = "recharge"`, Foundry forces `type = "recoverAll"` and uses `formula` as the recharge threshold
- recharge formulas are effectively threshold values from `2` to `6`
- if recharge has no formula, Foundry defaults it to `"6"`

Good examples:

- Rage uses
- Channel Divinity uses
- class feature charges shared across multiple actions

Do not use feature-level uses when each activity has its own independent use pool. In that case, use `activity.uses`.

### `system.advancement`

Usually empty for ordinary feature items.

This only matters when the feature item itself grants structured follow-up choices or configuration.

### `system.source`

The sample shows:

```json
{
  "revision": 1,
  "rules": "2024"
}
```

At minimum, preserve:

- rules generation such as `2014` or `2024`
- source revision when available

Source book identity, app entity identity, and semantic identity should still be tracked in `flags.dauligor-pairing`.

### `system.crewed`

Present on the `FeatData` schema, but usually `false` for ordinary class or subclass features.

### `system.enchant`

Feature-level enchantment configuration:

```json
{
  "max": "",
  "period": ""
}
```

This is separate from `enchant` activities. The root field is about the feature's enchantment capacity, not the activation payload itself.

### `system.prerequisites`

From local `FeatData`, this can include:

- `items`
- `level`
- `repeatable`

Use this only when the feature truly has gating requirements.

### `system.requirements`

Plain display string shown on the item sheet.

Examples:

- `Sorcerer 3`
- `Divine Soul 1`

This is not your primary relationship key.

### `system.properties`

Free-form property set used by `dnd5e` for feature behaviors or labels.

This exists on the schema, but the sample leaves it empty. Only populate it when you know the exact property keys the system expects.

### `system.type`

From `FeatData`:

```json
{
  "value": "",
  "subtype": ""
}
```

This is Foundry's feature categorization field, not the semantic Dauligor identity.

### `effects`

The item itself can carry active effects outside `system.activities`.

This matters because some features:

- passively modify the actor
- add always-on bonuses
- apply enchantments or riders
- scale by actor level without needing a button press

Do not assume all automation must live inside one activity block.

### `flags`

This is where Dauligor-specific metadata should live.

Recommended keys:

- semantic feature identity
- app entity id
- source book id
- import revision
- module import state

## Shared Activity Envelope

All normal activities inherit this common shell from local `BaseActivityData`.

`system.activities` is a map keyed by Foundry activity `_id`.

```json
{
  "HAv1I90q2gpngadL": {
    "_id": "HAv1I90q2gpngadL",
    "type": "attack",
    "name": "",
    "img": null,
    "sort": 0,
    "activation": {},
    "consumption": {},
    "description": {},
    "duration": {},
    "effects": [],
    "flags": {},
    "range": {},
    "target": {},
    "uses": {},
    "visibility": {}
  }
}
```

### Shared Activity Fields

### `_id`

Foundry activity id. The module should generate this.

### `type`

Your sample includes these activity types:

- `attack`
- `cast`
- `check`
- `damage`
- `enchant`
- `forward`
- `heal`
- `save`
- `summon`
- `transform`
- `utility`

### `name`

Optional activity label.

Use it when one feature has multiple activities and each button needs its own name.

### `img`

Optional activity-specific icon override.

### `sort`

Controls display order.

The sample uses large sort gaps:

- `0`
- `100000`
- `200000`

That makes later insertions easier. The module can manage this.

### `activation`

Shared activation structure:

```json
{
  "type": "action",
  "value": 1,
  "condition": "",
  "override": false
}
```

Meaning:

- `type`: action kind such as action, bonus, reaction, minute, hour, special
- `value`: numeric count when the activation type is scalar
- `condition`: text condition such as reaction trigger text
- `override`: whether this activity overrides inherited/default timing

Field contract:

- `type`
  - type: string
  - stored activity values confirmed from local `dnd5e` config:
    - `action`
    - `bonus`
    - `reaction`
    - `minute`
    - `hour`
    - `day`
    - `longRest`
    - `shortRest`
    - `encounter`
    - `turnStart`
    - `turnEnd`
    - `legendary`
    - `mythic`
    - `lair`
    - `crew`
    - `special`
- `value`
  - type: integer or omitted/null
  - relevant to scalar activation types such as:
    - `minute`
    - `hour`
    - `day`
    - `legendary`
    - `mythic`
    - `crew`
- `condition`
  - type: string
- `override`
  - type: boolean

User-facing options confirmed from the attack test notes:

- Standard:
  - Action
  - Bonus Action
  - Reaction
- Time:
  - Minute
  - Hour
  - Day
- Rest:
  - End of a Long Rest
  - End of a Short Rest
- Combat:
  - Start of Encounter
  - Start of Turn
  - End of Turn
- Monster:
  - Legendary Action
  - Mythic Action
  - Lair Action
- Vehicle:
  - Crew Action
- Passive/no-cost states:
  - Special
  - None

Important note:

- the modern activity schema uses `special` for the passive/no-cost state
- the older item-level activation config also exposes a `none` label, so app-side docs should preserve both labels even though the stored activity key is centered on `special`

### `consumption`

Shared resource-consumption structure:

```json
{
  "scaling": {
    "allowed": false,
    "max": ""
  },
  "spellSlot": true,
  "targets": [
    {
      "type": "activityUses",
      "target": "",
      "value": "1",
      "scaling": {
        "mode": "",
        "formula": ""
      }
    }
  ]
}
```

Meaning:

- `scaling.allowed`: whether upcast or scaled spending is allowed
- `scaling.max`: deterministic formula for maximum scaling
- `spellSlot`: whether the activity can consume spell slots
- `targets[]`: explicit consumption rows

Each consumption target row contains:

- `type`: what pool is consumed
- `target`: the referenced pool or target key
- `value`: formula for how much is consumed
- `scaling.mode`
- `scaling.formula`

Field contract:

- `scaling.allowed`
  - type: boolean
- `scaling.max`
  - type: deterministic formula string
- `spellSlot`
  - type: boolean
- `targets`
  - type: array of consumption target rows

Each `targets[]` row:

- `type`
  - type: string
  - currently proven values:
    - `activityUses`
    - `itemUses`
    - `hitDice`
    - `spellSlots`
    - `attribute`
- `target`
  - type: string
  - meaning depends on `type`
  - proven examples:
    - `smallest`
    - `1`
    - `abilities.str.value`
- `value`
  - type: formula string
- `scaling.mode`
  - type: string
  - values proven directly by the corpus/config:
    - `""`
    - `amount`
    - `level` for `spellSlots`
- `scaling.formula`
  - type: formula string

The generic sample leaves this empty, but the attack and forward corpus examples prove these concrete target types:

- `activityUses`
- `itemUses`
- `hitDice`
- `spellSlots`
- `attribute`
- `material`

It also proves some concrete `target` values:

- `hitDice.target = "smallest"`
- `hitDice.target = "largest"` is supported by local `dnd5e` logic
- `hitDice.target = "d6"`-style specific die denominations are supported by local `dnd5e` logic
- `spellSlots.target = "1"`
- `attribute.target = "abilities.str.value"`
- `material.target = ""` can persist on a generic material-consumption row

So this part of the schema is now structurally confirmed, even though we still need more examples to know which target types Dauligor should support first.

Working field notes:

- `activityUses`
  - consumes the current activity's own `uses`
- `itemUses`
  - consumes the parent item's root `system.uses`
- `attribute`
  - `target` should be an actor/system path which resolves to a numeric resource
- `hitDice`
  - `target` can be a specific denomination like `d6`, or selector values like `smallest` or `largest`
- `spellSlots`
  - `target` is a spell level slot key such as `"1"`
- `material`
  - the saved export proves persistence, but we still want one more behavioral note before calling the exact semantics fully locked down

### `description`

Shared activity description structure:

```json
{
  "chatFlavor": ""
}
```

Use this when an activity needs its own chat-card flavor separate from the root feature description.

### `duration`

Shared duration structure:

```json
{
  "value": "",
  "units": "inst",
  "special": "",
  "concentration": false,
  "override": false
}
```

Meaning:

- `value`: deterministic formula when duration is scalar
- `units`: duration unit such as `inst`, `round`, `minute`, `hour`
- `special`: display-only custom duration text
- `concentration`: whether the effect requires concentration
- `override`: whether this activity overrides inherited/default duration

Field contract:

- `value`
  - type: deterministic formula string or empty string
- `units`
  - type: string
  - values proven directly by saved exports:
    - `inst`
    - `minute`
    - `turn`
- `special`
  - type: string
- `concentration`
  - type: boolean
- `override`
  - type: boolean

User-facing duration options confirmed from the attack test notes:

- Instantaneous
- Special
- Time-based:
  - Turn
  - Round
  - Minute
  - Hour
  - Day
  - Month
  - Year
- Permanent-style:
  - Until Dispelled
  - Until Dispelled or Triggered
  - Permanent

The saved corpus has not yet locked down every stored duration-unit key for the longer-duration and permanent variants, so Dauligor should treat those labels as accepted UI states and let the module normalize them until we capture one export for each.

### `effects`

Activity-local effect applications.

Base activities use generic applied effect rows.

Some activity types extend these rows with type-specific fields such as:

- enchantment riders
- `onSave`
- level-gated applicability

### `flags`

Activity-local metadata. This is where Dauligor-specific activity provenance or mapping hints can live if needed.

### `range`

Shared range structure:

```json
{
  "value": "",
  "units": "self",
  "special": "",
  "override": false
}
```

Meaning:

- `value`: scalar range formula when relevant
- `units`: self, touch, ft, mi, special, and related system values
- `special`: custom display text
- `override`: whether this activity overrides inherited/default range

Field contract:

- `value`
  - type: deterministic formula string or empty string
- `units`
  - type: string
  - stored values confirmed from local `dnd5e` config:
    - special range types:
      - `self`
      - `touch`
      - `spec`
      - `any`
    - scalar distance units come from `CONFIG.DND5E.movementUnits`
      - common UI labels recorded by the test notes:
        - Feet
        - Miles
        - Meters
        - Kilometers
- `special`
  - type: string
- `override`
  - type: boolean

### `target`

Shared targeting structure:

```json
{
  "template": {
    "count": "",
    "contiguous": false,
    "stationary": false,
    "type": "",
    "size": "",
    "width": "",
    "height": "",
    "units": "ft"
  },
  "affects": {
    "count": "",
    "type": "",
    "choice": false,
    "special": ""
  },
  "override": false,
  "prompt": true
}
```

Meaning:

- `template`: measured template information
- `affects`: who or how many targets are affected
- `override`: inherited/default target override
- `prompt`: whether Foundry should prompt for targets

Field contract:

- `template.count`
  - type: scalar string
- `template.contiguous`
  - type: boolean
- `template.stationary`
  - type: boolean
- `template.type`
  - type: string
  - stored values confirmed from local `dnd5e` config:
    - `circle`
    - `cone`
    - `cube`
    - `cylinder`
    - `line`
    - `radius`
    - `sphere`
    - `square`
    - `wall`
- `template.size`
  - type: scalar string
  - used by `radius`/emanation-style targeting
- `template.width`
  - type: scalar string
- `template.height`
  - type: scalar string
- `template.units`
  - type: string
  - scalar distance units such as:
    - `ft`
    - `mi`
    - `m`
    - `km`
- `affects.count`
  - type: scalar string
- `affects.type`
  - type: string
  - stored values confirmed from local `dnd5e` config:
    - `self`
    - `ally`
    - `enemy`
    - `creature`
    - `object`
    - `space`
    - `creatureOrObject`
    - `any`
    - `willing`
- `affects.choice`
  - type: boolean
- `affects.special`
  - type: string
- `override`
  - type: boolean
- `prompt`
  - type: boolean

User-facing target options confirmed from the attack test notes:

- Target type:
  - Self
  - Ally
  - Enemy
  - Creature
  - Object
  - Space
  - Creature or Object
  - Any
  - Willing Creature
- Area shape:
  - Cone
  - Cube
  - Cylinder
  - Emanation
  - Line
  - Sphere
  - Circle
  - Square
  - Wall
- Multi-template controls:
  - Amount
  - Contiguous

Shape-specific size inputs confirmed from the recorded sheet notes:

- Cone:
  - `length`
- Cube:
  - `width`
- Cylinder:
  - `radius`
  - `height`
- Emanation:
  - `size`
  - `stationary`
- Line:
  - `length`
  - `width`
- Sphere:
  - `radius`
- Circle:
  - `radius`
- Square:
  - `width`
- Wall:
  - `length`
  - `thickness`
  - `height`

The attack corpus example proves these concrete patterns:

- `target.template.count = "2"`
- `target.template.type = "wall"`
- `target.affects.count = "2"`
- `target.affects.type = "creatureOrObject"`
- `target.affects.special` can hold extra explanatory text
- `target.prompt = false` is a real persisted state

### `uses`

Activity-local use tracking:

```json
{
  "spent": 0,
  "max": "",
  "recovery": [
    {
      "period": "lr",
      "type": "recoverAll",
      "formula": ""
    }
  ]
}
```

Meaning:

- `spent`: already-spent uses
- `max`: deterministic maximum formula
- `recovery[]`: one or more recharge/recovery rules

Activity `uses` uses the same schema as root `system.uses`.

Field contract:

- `spent`
  - type: integer
  - allowed values: `0` or greater
- `max`
  - type: deterministic formula string
- `recovery`
  - type: array of recovery rows
  - each row has:
    - `period`: string
    - `type`: string
    - `formula`: formula string when needed

Accepted `period` values:

- `lr`
- `sr`
- `day`
- `dawn`
- `dusk`
- `initiative`
- `turnStart`
- `turnEnd`
- `turn`
- `recharge`

Accepted `type` values for non-recharge rows:

- `recoverAll`
- `loseAll`
- `formula`

Recharge behavior:

- `period = "recharge"` forces `type = "recoverAll"`
- `formula` becomes the recharge threshold
- valid recharge threshold choices come from the recharge picker and are effectively `2` through `6`
- empty recharge formula defaults to `"6"`

The attack corpus example proves:

- activity-local uses can have `max = "2"`
- activity-local `recovery` rows persist correctly
- root feature-level uses can coexist with activity-local uses

The same feature also shows a broad set of root feature recovery periods:

- `lr`
- `sr`
- `day`
- `dawn`
- `dusk`
- `initiative`
- `turnStart`
- `turnEnd`
- `turn`
- `recharge`

and recovery types such as:

- `recoverAll`
- `loseAll`
- `formula`

### `visibility`

Shared visibility gating:

```json
{
  "identifier": "",
  "level": {
    "min": 0,
    "max": 0
  },
  "requireAttunement": false,
  "requireIdentification": false,
  "requireMagic": false
}
```

Meaning:

- `identifier`: stable gating identifier
- `level.min/max`: only show this activity in a level band
- `requireAttunement`
- `requireIdentification`
- `requireMagic`

The sample leaves most of this blank, so this is another area that needs corpus examples.

Field contract:

- `identifier`
  - type: string
  - cast sample proves a real non-empty value such as `sorcerer`
- `level.min`
  - type: integer or `null`
- `level.max`
  - type: integer or `null`
- `requireAttunement`
  - type: boolean
- `requireIdentification`
  - type: boolean
- `requireMagic`
  - type: boolean

User-facing labels confirmed from the attack and cast test notes:

- Level Limit
- Class Identifier
- Require Magic
- Require Attunement
- Require Identification

The cast sample additionally proves that visibility is a real stored activity gate, not just a UI hint.

## Damage Part Structure

Both damage-style and heal-style activities rely on `DamageField`.

Single damage or healing part structure:

```json
{
  "number": 1,
  "denomination": 6,
  "bonus": "@mod",
  "types": ["fire"],
  "custom": {
    "enabled": false,
    "formula": ""
  },
  "scaling": {
    "mode": "",
    "number": 1,
    "formula": ""
  }
}
```

Meaning:

- `number`: number of dice
- `denomination`: die faces
- `bonus`: additive formula text
- `types`: damage or healing tags
- `custom.enabled/formula`: bypass the auto dice builder and use a custom formula
- `scaling.mode/number/formula`: scaling behavior when the damage changes with spell level or feature scaling

This is one of the most important substructures to capture in a corpus, because your sample leaves every part empty.

The attack corpus example now proves three important real patterns:

1. standard automatic damage

```json
{
  "number": 1,
  "denomination": 4,
  "bonus": "3",
  "types": ["bludgeoning"]
}
```

2. custom-formula damage

```json
{
  "custom": {
    "enabled": true,
    "formula": "3d7"
  },
  "number": null,
  "denomination": null
}
```

3. non-empty scaling modes on a damage part

```json
{
  "scaling": {
    "mode": "whole"
  }
}
```

and:

```json
{
  "scaling": {
    "mode": "half"
  }
}
```

That means the importer should support:

- ordinary dice-based damage parts
- custom damage formulas
- explicit per-part scaling modes

## Activity Types

These are the concrete type-specific fields shown by the local schema.

### `attack`

Use for attack roll activities tied to a feature.

Type-specific fields:

```json
{
  "attack": {
    "ability": "",
    "bonus": "",
    "critical": {
      "threshold": 20
    },
    "flat": false,
    "type": {
      "value": "",
      "classification": ""
    }
  },
  "damage": {
    "critical": {
      "bonus": ""
    },
    "includeBase": true,
    "parts": []
  }
}
```

Important meanings:

- `attack.ability`: explicit ability, `spellcasting`, or auto logic
- `attack.bonus`: extra attack bonus formula
- `attack.critical.threshold`: custom crit floor
- `attack.flat`: whether the attack is flat instead of normal ability/proficiency logic
- `attack.type.value`
- `attack.type.classification`
- `damage.critical.bonus`: extra critical damage formula
- `damage.includeBase`: whether to include base item damage when relevant
- `damage.parts[]`: actual damage rows

The attack corpus example proves these real persisted values:

- `attack.type.value = "melee"`
- `attack.type.classification = "weapon"`
- `activation.value = 1`
- `activation.condition` can hold custom text
- `description.chatFlavor` persists correctly
- `duration.units = "minute"`
- `duration.value = "3"`
- `range.units = "self"`
- `range.special` can hold a display string

It also shows that `attack.ability`, `attack.bonus`, and `attack.critical.threshold` may be persisted as blank or `null`, with Foundry still accepting the activity.

Attack-specific practical rules confirmed from manual setup:

- `attack.ability` can be:
  - blank or default
  - `none`
  - `spellcasting`
  - a specific ability:
    - `str`
    - `dex`
    - `con`
    - `int`
    - `wis`
    - `cha`
- `attack.bonus` should be treated as a formula field, not just a plain integer.
  Good examples:
  - `1`
  - `1d4`
- `attack.flat`
  - type: boolean
- `attack.critical.threshold` is effectively `1` to `20`, and if nothing is provided it should be treated as the normal `20` behavior.
- `damage.critical.bonus` should be treated as a formula field.

Field contract:

- `attack.ability`
  - type: string
  - accepted values:
    - `""` for default ability selection
    - `none`
    - `spellcasting`
    - `str`
    - `dex`
    - `con`
    - `int`
    - `wis`
    - `cha`
- `attack.bonus`
  - type: formula string
- `attack.critical.threshold`
  - type: integer `1-20` or `null`
- `attack.flat`
  - type: boolean
- `attack.type.value`
  - type: string
  - accepted values:
    - `melee`
    - `ranged`
- `attack.type.classification`
  - type: string
  - accepted values:
    - `weapon`
    - `spell`
    - `unarmed`
- `damage.critical.bonus`
  - type: formula string
- `damage.includeBase`
  - type: boolean
- `damage.parts`
  - type: array of damage part rows

Each `damage.parts[]` row:

- `number`
  - type: integer or `null`
- `denomination`
  - type: integer or `null`
  - user-facing die options confirmed from the attack test notes:
    - `4`
    - `6`
    - `8`
    - `10`
    - `12`
    - `20`
    - `100`
- `bonus`
  - type: formula string
- `types`
  - type: array of strings
  - proven values:
    - ordinary damage types such as `bludgeoning`
    - special `maximum` from the sample
  - user-facing note from the attack test:
    - the sheet treats this as damage type or Maximum Hit Points
- `custom.enabled`
  - type: boolean
- `custom.formula`
  - type: formula string
- `scaling.mode`
  - type: string
  - values proven by saved export:
    - `""`
    - `whole`
    - `half`
- `scaling.number`
  - type: integer
- `scaling.formula`
  - type: formula string

User-facing scaling labels recorded in the attack notes:

- No Scaling
- Every Level
- Every Other Level

We still need one cleaner export to lock down the exact stored-key mapping between those UI labels and the saved `whole` / `half` style values.

### `cast`

Use when the feature is really casting an existing spell or spell-like effect.

Type-specific fields:

```json
{
  "spell": {
    "ability": "",
    "challenge": {
      "attack": null,
      "save": null,
      "override": false
    },
    "level": null,
    "properties": ["vocal", "somatic", "material"],
    "spellbook": true,
    "uuid": null
  }
}
```

Important meanings:

- `spell.uuid`: linked spell item UUID
- `spell.ability`: ability override
- `spell.challenge.attack/save`: explicit override numbers
- `spell.challenge.override`: whether to force those overrides
- `spell.level`: explicit cast level
- `spell.properties`: V/S/M-style spell properties
- `spell.spellbook`: whether the linked spell comes from the actor spellbook

Note: the cast schema removes base `effects` from the activity model. That is a real difference from the other types.

The cast corpus example now proves these real persisted patterns:

- `spell.uuid` can point to a spell item UUID
- `spellbook = true` persists normally
- `spell.level` can override the base spell level
- `spell.challenge.override = false` can persist cleanly with:
  - `attack = null`
  - `save = null`
- `spell.challenge.override = true` can coexist with:
  - explicit numeric `attack`
  - explicit numeric `save`
- `spell.properties` acts like a set of ignored or altered spell properties while casting
- activity-level overrides really matter for cast activities:
  - `activation.override = true`
  - `duration.override = true`
  - `range.override = true`
  - `target.override = true`
- cast activities can use ordinary activity-local `uses`
- cast activities can use `visibility.identifier` and `visibility.level.min/max`

The cast corpus example also proves these concrete values:

- `activation.type = "bonus"` on an override activity
- `duration.units = "turn"` with `duration.value = "2"`
- `duration.concentration = true`
- `range.units = "touch"`
- `target.template.type = "cube"`
- `target.template.size = "3"`
- `target.affects.type = "enemy"`
- `target.affects.choice = true`
- `visibility.identifier = "sorcerer"`
- `visibility.level.min = 1`
- `visibility.level.max = 2`

The corrected cast corpus example now proves both states:

- clean non-override challenge state
- populated override challenge state

So the importer can safely treat these as distinct valid cases:

- `challenge.override = false` with no flat override numbers
- `challenge.override = true` with explicit flat attack and save overrides

Field contract:

- `spell.uuid`
  - type: document UUID string or `null`
  - must resolve to an `Item` of type `spell`
- `spell.ability`
  - type: string
  - cast sheet options confirmed from local `dnd5e`:
    - `""` meaning use spellcasting ability
    - `str`
    - `dex`
    - `con`
    - `int`
    - `wis`
    - `cha`
- `spell.challenge.override`
  - type: boolean
- `spell.challenge.attack`
  - type: number or `null`
- `spell.challenge.save`
  - type: number or `null`
- `spell.level`
  - type: integer or `null`
  - cast sheet only offers levels at or above the linked spell's base level
- `spell.properties`
  - type: set/array of strings
  - values clearly exercised in the cast test:
    - `vocal`
    - `somatic`
    - `material`
    - `concentration`
    - `ritual`
- `spell.spellbook`
  - type: boolean

User-facing cast controls confirmed from the cast test notes and sheet:

- Display in Spellbook
- Casting Ability
- Casting Level
- Ignored Properties
- Override Values:
  - Attack Bonus
  - Save DC
- Override sections for:
  - Activation
  - Duration
  - Range
  - Target

Practical rule:

- when `spell.challenge.override = false`, leave `attack` and `save` as `null`
- when `spell.challenge.override = true`, both override numbers should be treated as explicit flat numeric values

### `check`

Use for features that call for a skill, tool, or ability check rather than an attack or save.

Type-specific fields:

```json
{
  "check": {
    "ability": "",
    "associated": [],
    "dc": {
      "calculation": "",
      "formula": ""
    }
  }
}
```

Important meanings:

- `check.ability`: default ability used for the check
- `check.associated`: associated skill or tool keys
- `check.dc.calculation`: how the DC is derived
- `check.dc.formula`: explicit deterministic formula

From the local `dnd5e` sheet code, `check.associated` is built from:

- `CONFIG.DND5E.skills`
- `CONFIG.DND5E.tools`

That means the stored values should be:

- skill keys such as `acr`, `arc`, `ste`
- tool keys from `CONFIG.DND5E.tools`

not display labels like `Acrobatics` or `Alchemist's Supplies`.

From the same sheet code, `check.ability` options are:

- blank default
- `spellcasting`
- explicit abilities:
  - `str`
  - `dex`
  - `con`
  - `int`
  - `wis`
  - `cha`

The blank default option is not just "empty". The UI can relabel it contextually:

- if exactly one associated skill is selected, the default label becomes that skill's normal ability
- if the item is a tool and there are no associated entries, the default label becomes the tool's own ability

From the same sheet code, `check.dc.calculation` options are:

- blank string for custom formula mode
- `spellcasting`
- explicit abilities:
  - `str`
  - `dex`
  - `con`
  - `int`
  - `wis`
  - `cha`

Practical meaning:

- `check.dc.calculation = ""` means the editor treats `check.dc.formula` as the real DC definition
- any non-empty `check.dc.calculation` means the editor shows the formula field as disabled/defaulted

Important caution from the current corpus item:

- `item-test-check-feature.json` did not actually persist any non-default check values

So we should treat the current check example as proof for:

- the schema
- the allowed UI option families

but not yet as proof for:

- real persisted `check.associated` values
- real persisted `check.ability`
- real persisted `check.dc.calculation`
- real persisted `check.dc.formula`

Field contract:

- `check.associated`
  - type: array of strings
  - accepted stored values come from:
    - `CONFIG.DND5E.skills`
    - `CONFIG.DND5E.tools`
  - practical meaning:
    - use internal skill keys such as `acr`, `arc`, `ste`
    - use internal tool keys from `CONFIG.DND5E.tools`, not display labels
- `check.ability`
  - type: string
  - accepted values:
    - `""` for default ability resolution
    - `spellcasting`
    - `str`
    - `dex`
    - `con`
    - `int`
    - `wis`
    - `cha`
- `check.dc.calculation`
  - type: string
  - accepted values:
    - `""` for custom formula mode
    - `spellcasting`
    - `str`
    - `dex`
    - `con`
    - `int`
    - `wis`
    - `cha`
- `check.dc.formula`
  - type: deterministic formula string
  - examples clearly shown in the test UI:
    - `8 + @mod + @prof`
    - a flat numeric string such as `10`

User-facing options confirmed from the check test screenshots:

- Associated Skills or Tools:
  - all skills
  - all tools
- Check Ability:
  - Spellcasting Ability
  - Strength
  - Dexterity
  - Constitution
  - Intelligence
  - Wisdom
  - Charisma
- DC Calculation:
  - specific ability
  - Custom Formula

Important note:

- the current exported check sample still came out blank, so the option families above are confirmed from the real editor UI and local `dnd5e` code, but we still want a saved non-empty export to lock down exact persisted tool keys and custom-formula states.

### `damage`

Use for pure damage with no attack roll and no save.

Type-specific fields:

```json
{
  "damage": {
    "critical": {
      "allow": false,
      "bonus": ""
    },
    "parts": []
  }
}
```

Important meanings:

- `critical.allow`: whether this damage can critically scale
- `critical.bonus`: additional crit formula
- `parts[]`: the actual damage parts

The damage corpus example proves these real persisted patterns:

- `damage.critical.allow = false`
- a normal damage part:
  - `number = 1`
  - `denomination = 8`
  - `bonus = "1d4"`
  - `types = ["cold"]`
- a custom-formula damage part:
  - `custom.enabled = true`
  - `custom.formula = "1d5+@mod"`
  - `number = null`
  - `denomination = null`

Field contract:

- `damage.critical.allow`
  - type: boolean
- `damage.critical.bonus`
  - type: formula string
- `damage.parts`
  - type: array of damage part rows

Each `damage.parts[]` row uses the same `DamageField` contract already described in the shared damage-part section:

- `number`
  - type: integer or `null`
- `denomination`
  - type: integer or `null`
- `bonus`
  - type: formula string
- `types`
  - type: array of strings
- `custom.enabled`
  - type: boolean
- `custom.formula`
  - type: formula string
- `scaling.mode`
  - type: string
- `scaling.number`
  - type: integer
- `scaling.formula`
  - type: formula string

Important difference from `attack.damage`:

- damage-only activities do not use `includeBase`
- damage-only activities use the same damage-part shape, but as the whole payload rather than as an add-on to an attack

### `enchant`

Use when the feature applies or manages enchantments on items.

Type-specific fields:

```json
{
  "effects": [
    {
      "riders": {
        "activity": [],
        "effect": [],
        "item": []
      }
    }
  ],
  "enchant": {
    "self": false
  },
  "restrictions": {
    "allowMagical": false,
    "categories": [],
    "properties": [],
    "type": ""
  }
}
```

Important meanings:

- `effects[].riders.activity`: rider activity ids
- `effects[].riders.effect`: linked effect ids
- `effects[].riders.item`: linked item UUIDs
- `enchant.self`: whether the feature enchants itself
- `restrictions.allowMagical`: can affect already-magical targets
- `restrictions.categories`
- `restrictions.properties`
- `restrictions.type`

The enchant corpus example now proves these real persisted patterns:

- `enchant.self = true`
- `restrictions.allowMagical = true`
- `restrictions.type = ""` is a real saved "Any Enchantable Type" state
- `effects[]` can carry:
  - an `_id`
  - a `level.min`
  - a `level.max`
  - rider links to:
    - sibling activity ids
    - effect ids
    - item UUIDs
- the source item can also carry real active effects of:
  - `type = "enchantment"`
  - `type = "base"`
- the root item can additionally store rider references in `flags.dnd5e.riders`

Field contract:

- `effects`
  - type: array of enchantment application rows

Each activity-level `effects[]` row:

- `_id`
  - type: Foundry document id string
- `level.min`
  - type: integer or `null`
- `level.max`
  - type: integer or `null`
- `riders.activity`
  - type: set/array of Foundry activity id strings
- `riders.effect`
  - type: set/array of Foundry effect id strings
- `riders.item`
  - type: set/array of item UUID strings

- `enchant.self`
  - type: boolean
- `restrictions.allowMagical`
  - type: boolean
- `restrictions.categories`
  - type: set/array of strings
  - accepted values depend on the selected item type's `itemCategories`
- `restrictions.properties`
  - type: set/array of strings
  - accepted values depend on `CONFIG.DND5E.validProperties[restrictions.type]`
- `restrictions.type`
  - type: string
  - empty string means any enchantable type

User-facing restriction type options confirmed from the enchant test UI:

- Any Enchantable Type
- Container
- Consumable
- Equipment
- Feature
- Loot
- Spell
- Tool
- Weapon

Important note:

- `restrictions.categories` and `restrictions.properties` are type-dependent
- this sample did not yet save any non-empty category or property restrictions, so we still want one follow-up export with those populated

### `forward`

Use when one activity simply forwards into another activity with altered consumption or activation context.

Type-specific fields:

```json
{
  "activity": {
    "id": null
  }
}
```

Important meanings:

- `activity.id`: referenced sibling activity id on the same item

Field contract:

- `activity.id`
  - type: Foundry document id string
  - expected source: sibling activity `_id` on the same item
- shared fields which still apply:
  - `activation`
  - `consumption`
  - `description`
  - `uses`
  - `visibility`

Important difference:

Forward activities remove these base fields:

- `duration`
- `effects`
- `range`
- `target`

So do not try to model them like ordinary activities.

What the forward sample proves:

- `activation.override = true`
- `consumption.spellSlot = true`
- `consumption.scaling.allowed = true`
- `consumption.scaling.max = "1"`
- `consumption.targets[]` can include:
  - `type = "material"`
  - `value = "1"`
  - `target = ""`
  - `scaling.mode = "amount"`
  - `scaling.formula = "5"`
- activity-local `uses` can persist:
  - `spent = 3`
  - `max = "3"`
  - `recovery = [{ "period": "recharge", "type": "recoverAll", "formula": "5" }]`

### `heal`

Use for direct healing rolls.

Type-specific fields:

```json
{
  "healing": {
    "number": 1,
    "denomination": 8,
    "bonus": "",
    "types": [],
    "custom": {
      "enabled": false,
      "formula": ""
    },
    "scaling": {
      "mode": "",
      "number": 1,
      "formula": ""
    }
  }
}
```

This uses the same `DamageField` shape as damage parts, just interpreted as healing.

Field contract:

- `healing`
  - type: `DamageField`
  - same subfields as damage rows:
    - `number`
    - `denomination`
    - `bonus`
    - `types`
    - `custom.enabled`
    - `custom.formula`
    - `scaling.mode`
    - `scaling.number`
    - `scaling.formula`

What the heal sample proves:

- `healing.number = 1`
- `healing.denomination = 6`
- `healing.bonus = "@mod"`
- `healing.custom.enabled = false`
- `healing.scaling.number = 1`
- `healing.types` can include:
  - `healing`
  - `temphp`
  - `maximum`
- heal activities can have ordinary activity-local effect rows

Behavior note from local `dnd5e`:

- heal activities do not use critical damage logic the same way attack/damage/save activities do
- Foundry builds healing rolls from `healing.formula`; if there is no formula-equivalent result, there is nothing to roll

### `save`

Use when the feature forces one or more saving throws.

Type-specific fields:

```json
{
  "damage": {
    "onSave": "half",
    "parts": []
  },
  "effects": [
    {
      "onSave": false
    }
  ],
  "save": {
    "ability": [],
    "dc": {
      "calculation": "initial",
      "formula": ""
    }
  }
}
```

Important meanings:

- `save.ability`: one or more allowed save abilities
- `save.dc.calculation`: save DC source
- `save.dc.formula`: explicit deterministic DC formula
- `damage.onSave`: what happens on successful save, such as none or half
- `damage.parts[]`: damage rows gated by the save
- `effects[].onSave`: whether an effect still applies on successful save

Field contract:

- `save.ability`
  - type: set or array of ability keys
  - observed values:
    - `["dex"]`
    - `["str", "dex"]`
- `save.dc.calculation`
  - type: string
  - local `dnd5e` default state starts as `initial`, then normalizes during preparation
  - observed persisted values:
    - `spellcasting`
    - `con`
    - `cha`
    - empty string for custom-formula mode
- `save.dc.formula`
  - type: deterministic formula string
- `damage.onSave`
  - type: string
  - observed values:
    - `none`
    - `half`
    - `full`
- `effects[].onSave`
  - type: boolean

What the save sample proves:

- save activities can target one save ability or several
- save activities can use ability-based DC calculation, spellcasting-based DC calculation, or explicit formula mode
- `damage.parts[]` supports the same `DamageField` rows as other damage-bearing activities
- `effects[].onSave = false` is a real persisted state
- save damage rows can use both standard dice and custom formulas
- save damage rows can carry multiple damage types in one row, such as:
  - `cold`
  - `force`
  - `poison`

### `summon`

Use when the feature summons creatures or temporary companions.

Type-specific fields:

```json
{
  "bonuses": {
    "ac": "",
    "hd": "",
    "hp": "",
    "attackDamage": "",
    "saveDamage": "",
    "healing": ""
  },
  "creatureSizes": [],
  "creatureTypes": [],
  "match": {
    "ability": "",
    "attacks": false,
    "disposition": false,
    "proficiency": false,
    "saves": false
  },
  "profiles": [
    {
      "_id": "",
      "count": "",
      "cr": "",
      "level": {
        "min": 0,
        "max": 0
      },
      "name": "",
      "types": [],
      "uuid": null
    }
  ],
  "summon": {
    "mode": "",
    "prompt": true
  },
  "tempHP": ""
}
```

Important meanings:

- `bonuses.*`: formulas applied to summoned creature stats
- `creatureSizes`
- `creatureTypes`
- `match.*`: inherit or match source actor stats
- `profiles[]`: available summon options
- `summon.mode`
- `summon.prompt`
- `tempHP`

Field contract:

- `bonuses.ac`
- `bonuses.hd`
- `bonuses.hp`
- `bonuses.attackDamage`
- `bonuses.saveDamage`
- `bonuses.healing`
  - type: formula string
- `creatureSizes`
  - type: set or array of actor size keys
  - observed values:
    - `lg`
    - `grg`
- `creatureTypes`
  - type: set or array of creature type keys
  - observed values:
    - `beast`
    - `construct`
    - `fiend`
- `match.ability`
  - type: string
  - observed value:
    - `str`
- `match.attacks`
- `match.disposition`
- `match.proficiency`
- `match.saves`
  - type: boolean
- `profiles[]`
  - type: array of summon profile rows
  - each row has:
    - `_id`: Foundry-safe local row id
    - `count`: formula string
    - `cr`: deterministic formula string
    - `level.min/max`: integers
    - `name`: string
    - `types`: set or array of strings
    - `uuid`: Actor UUID string
- `summon.mode`
  - type: string
  - observed values:
    - `""`
    - `cr`
- `summon.prompt`
  - type: boolean
- `tempHP`
  - type: formula string

What the summon sample proves:

- all `bonuses.*` fields can persist ordinary formulas such as `1d4`
- summon profiles can mix:
  - named UUID-backed creatures
  - CR-based rows
  - type-restricted rows
- `profiles[].uuid` is an Actor UUID, not an Item UUID
- `profiles[].count` is a formula field, not just an integer
- `summon.prompt = true` is a real persisted state
- `tempHP = "1d4"` is a real persisted state

### `transform`

Use for wild shape, polymorph-like, or form-switching behaviors.

Type-specific fields:

```json
{
  "profiles": [
    {
      "_id": "",
      "cr": "",
      "level": {
        "min": 0,
        "max": 0
      },
      "movement": [],
      "name": "",
      "sizes": [],
      "types": [],
      "uuid": null
    }
  ],
  "settings": null,
  "transform": {
    "customize": false,
    "mode": "cr",
    "preset": ""
  }
}
```

Important meanings:

- `profiles[]`: valid transformation targets
- `settings`: embedded transformation settings block
- `transform.customize`: whether the user can customize the transform
- `transform.mode`
- `transform.preset`

Field contract:

- `profiles[]`
  - type: array of transform profile rows
  - each row has:
    - `_id`: Foundry-safe local row id
    - `cr`: deterministic formula string
    - `level.min/max`: integers
    - `movement`: set or array of movement keys
    - `name`: string
    - `sizes`: set or array of size keys
    - `types`: set or array of creature type keys
    - `uuid`: Actor UUID string
- `settings`
  - type: embedded transformation settings block or `null`
  - fields include:
    - `effects`: set of strings
    - `keep`: set of strings
    - `merge`: set of strings
    - `minimumAC`: deterministic formula string
    - `other`: set of strings
    - `preset`: nullable string
    - `spellLists`: set of strings
    - `tempFormula`: deterministic formula string
    - `transformTokens`: boolean
- `transform.customize`
  - type: boolean
- `transform.mode`
  - type: string
  - observed value:
    - `""`
- `transform.preset`
  - type: string
  - observed values:
    - `""`
    - `polymorphSelf`
    - `polymorph`
    - `wildshape`

What the transform sample proves:

- transform profiles can persist real Actor UUIDs
- `profiles[].movement`, `profiles[].sizes`, and `profiles[].types` are stored as sets or arrays of internal keys
- `settings` can be `null` or fully populated
- `settings.effects` observed values include:
  - `all`
  - `origin`
  - `otherOrigin`
  - `background`
  - `class`
  - `feat`
  - `equipment`
  - `spell`
- `settings.keep` observed values include:
  - `physical`
  - `mental`
  - `saves`
  - `skills`
  - `gearProf`
  - `languages`
  - `class`
  - `feats`
  - `items`
  - `spells`
  - `bio`
  - `type`
  - `hp`
  - `tempHP`
  - `resistances`
  - `vision`
- `settings.merge` observed values include:
  - `saves`
  - `skills`
- `settings.spellLists` uses semantic registry keys such as:
  - `class:bard`
  - `subclass:life`
- `settings.transformTokens` can be `true` or `false`
- `settings.minimumAC = "10"` is a real persisted state
- `settings.tempFormula = "1d8"` is a real persisted state

Behavior note from local `dnd5e`:

- if `transform.customize = false`, Foundry can synthesize `settings` from the chosen `transform.preset`
- if `transform.customize = true` and there are no settings yet, Foundry can initialize settings from the preset and then let the user edit them

### `utility`

Use for generic rolls, passive support actions, or arbitrary nonstandard utility rolls.

Type-specific fields:

```json
{
  "roll": {
    "formula": "",
    "name": "",
    "prompt": false,
    "visible": false
  }
}
```

Important meanings:

- `roll.formula`: arbitrary roll formula
- `roll.name`: label for the roll
- `roll.prompt`: whether to prompt before rolling
- `roll.visible`: whether to expose the roll in UI/chat

## Recommended Dauligor Semantic Split

Dauligor should own the meaning.

The module should own the exact Foundry shape.

Recommended semantic split:

### Dauligor should send

- feature identity
- feature description
- usage rules
- prerequisite and requirement meaning
- activity semantic type
- activity range, target, duration, save, damage, heal, summon, or transform intent
- linked spell or linked feature references using semantic ids
- effect intent

### The module should derive

- Foundry item `_id`
- Foundry activity `_id`
- sibling activity references by local Foundry id
- UUID-based links where Foundry requires them
- sort order
- default empty structures for omitted optional fields

## Recommended Minimal Semantic Activity Payload

Dauligor does not need to mirror the full Foundry schema exactly. A semantic payload like this is enough:

```json
{
  "sourceId": "class-feature-font-of-magic",
  "identifier": "font-of-magic",
  "name": "Font of Magic",
  "description": "<p>...</p>",
  "activities": [
    {
      "identifier": "convert-spell-slot",
      "type": "utility",
      "activation": {
        "type": "bonus"
      },
      "uses": {
        "pool": "sorcery-points"
      },
      "roll": {
        "formula": "1"
      }
    }
  ]
}
```

Then the module can expand that into the strict Foundry structure.

## Practical Rules For The Importer

- Always create feature-style imported abilities as `Item.type = "feat"` unless the item is genuinely another family.
- Always generate Foundry activity ids locally.
- Preserve Dauligor semantic identity for the feature item and for each activity in `flags.dauligor-pairing`.
- Prefer stable semantic activity identifiers in flags even if Foundry also has random local `_id` values.
- Treat `item-feature.json` as a structure reference, not as a complete behavioral reference.
- If the app cannot yet supply a complex activity type with enough information, leave the activity out instead of shipping a misleading half-activity.

## Missing Information And Corpus Need

Information is still missing for a production-quality activity builder.

The biggest remaining gaps are:

- one truly populated saved `check` export
- one real `utility` export
- richer enchantment restriction coverage and multi-profile enchantment graphs
- cleaner notes on the exact gameplay semantics of `material` consumption targets
- more `visibility` gating examples outside the cast sample
- additional activity-level and item-level effect interaction examples

That means we should build a corpus before finalizing the importer logic for all activity families.

Use `docs/feature-activity-corpus-plan.md` as the capture checklist.

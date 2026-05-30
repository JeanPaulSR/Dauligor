# Feature Item Shell & Fields

> Part of the [Feature & Activity Contract](../class-feature-activity-contract.md).

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


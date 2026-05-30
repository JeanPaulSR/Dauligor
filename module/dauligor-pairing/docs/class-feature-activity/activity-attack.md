# attack activity

> Part of the [Feature & Activity Contract](../class-feature-activity-contract.md).

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


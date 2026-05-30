# damage activity

> Part of the [Feature & Activity Contract](../class-feature-activity-contract.md).

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


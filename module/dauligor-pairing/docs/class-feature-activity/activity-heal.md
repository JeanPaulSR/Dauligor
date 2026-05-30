# heal activity

> Part of the [Feature & Activity Contract](../class-feature-activity-contract.md).

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


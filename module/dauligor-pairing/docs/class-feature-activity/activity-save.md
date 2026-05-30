# save activity

> Part of the [Feature & Activity Contract](../class-feature-activity-contract.md).

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


# check activity

> Part of the [Feature & Activity Contract](../class-feature-activity-contract.md).

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


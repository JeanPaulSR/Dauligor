# cast activity

> Part of the [Feature & Activity Contract](../class-feature-activity-contract.md).

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


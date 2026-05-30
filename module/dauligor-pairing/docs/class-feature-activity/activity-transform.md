# transform activity

> Part of the [Feature & Activity Contract](../class-feature-activity-contract.md).

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


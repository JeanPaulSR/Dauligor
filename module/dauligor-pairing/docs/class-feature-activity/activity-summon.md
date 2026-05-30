# summon activity

> Part of the [Feature & Activity Contract](../class-feature-activity-contract.md).

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


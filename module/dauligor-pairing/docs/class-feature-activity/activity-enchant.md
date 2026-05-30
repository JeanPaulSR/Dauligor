# enchant activity

> Part of the [Feature & Activity Contract](../class-feature-activity-contract.md).

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


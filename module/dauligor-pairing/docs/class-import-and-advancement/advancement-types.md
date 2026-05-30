# Advancement Model & Supported Types

> Part of the [Class Import & Advancement Guide](../class-import-and-advancement-guide.md).

## Advancement Model

### Storage shape

Dauligor should think in semantic ids.

Preferred incoming shape:

```json
{
  "classSorcererHitPoints": {
    "_id": "classSorcererHitPoints",
    "type": "HitPoints",
    "configuration": {},
    "value": {
      "1": "max"
    },
    "flags": {},
    "hint": ""
  }
}
```

Rules:

- the object key and `_id` should match
- the app sends semantic ids
- the module generates actor-safe 16-character ids only when embedding the class on an actor

### Why actor-side id remapping exists

Foundry requires embedded advancement `_id` values to be valid 16-character alphanumeric ids.

So actor import must:

1. read the semantic advancement id from the payload
2. map it to a Foundry-safe local `_id`
3. save that mapping in `flags.dauligor-pairing.advancementIdMap`
4. also preserve the semantic id on the advancement itself

Example:

```json
{
  "_id": "pmtnr3nzZhwNOw3i",
  "type": "HitPoints",
  "flags": {
    "dauligor-pairing": {
      "sourceAdvancementId": "classSorcererHitPoints"
    }
  }
}
```

This is what allows reimport and level-up to stay stable later.

## Supported Advancement Types For Current Class Import

These are the class advancement types we should treat as first-class citizens.

- `HitPoints`
- `Trait`
- `ScaleValue`
- `ItemGrant`

Everything else should be treated as future work unless we have a proven corpus and a working import path.

## `HitPoints` Advancement

This is the most important advancement for character creation because it stores the class-side HP choices by level.

Example:

```json
{
  "_id": "5LBWU8gHkLxjYAwt",
  "type": "HitPoints",
  "value": {
    "1": "max",
    "2": 4,
    "3": 6
  },
  "configuration": {},
  "flags": {},
  "hint": ""
}
```

### What `value` means

`value` is keyed by class level.

Allowed meaningful states:

- `"max"`
  - first character level in that class when the full hit die is taken
- `"avg"`
  - average HP gain for that level
- integer
  - an explicit die result or chosen numeric result for that class level

Important rule:

- the stored value is the class hit-die contribution
- it should not include Constitution modifier

That means:

- if Sorcerer level 2 is rolled as `5` on the class die and Con mod is `+2`
- save `5` in the advancement
- do not save `7`

Why:

- Foundry's class HP advancement expects the class-side HP contribution
- actor HP totals derive from that plus actor ability data
- if you store Con in the advancement too, HP is effectively double-counted

### Character-creator rule for HP

For class import onto an actor:

- determine current level in this class
- determine target level
- determine whether this is the actor's first class level ever
- gather HP choice per gained level
- write those choices into the class `HitPoints` advancement
- then update actor HP totals from that result

Do not use actor max HP override as the primary source of truth.

The source of truth should be:

- the embedded class item's `HitPoints` advancement `value`

Actor HP root fields should be a consequence of that saved class advancement state.

### Recommended HP import behavior

If importing to level 3 for a fresh Sorcerer:

- level 1
  - save `"max"`
- level 2
  - save `"avg"` if average was chosen
  - or a numeric die result if rolled/custom/min/max mode was used
- level 3
  - same rule

For custom formulas:

- generate the default formula from `system.hd.denomination`
- Sorcerer `d6` should default to `1d6min4`
- Fighter `d10` should default to `1d10min6`

### Why Plutonium matters here

Plutonium saves HP decisions into the class advancement itself.

That is the correct model to follow.

If we only update actor `hp.max` and leave class advancement rows blank:

- level-up state is not really preserved
- the Advancement tab remains misleading
- future class syncs have no trustworthy per-level HP history

## `Trait` Advancement

Use `Trait` for:

- saving throws
- skill choices
- weapon proficiencies
- armor proficiencies
- tool proficiencies
- languages

### Saving throws

Example:

```json
{
  "_id": "wcvKd0AMiQfJGhX7",
  "type": "Trait",
  "level": 1,
  "title": "Saving Throws",
  "classRestriction": "primary",
  "configuration": {
    "mode": "default",
    "allowReplacements": false,
    "grants": [
      "saves:con",
      "saves:cha"
    ],
    "choices": []
  },
  "value": {
    "chosen": [
      "saves:con",
      "saves:cha"
    ]
  }
}
```

### Skill choices

Example:

```json
{
  "_id": "HV29qnwScBYPNtI5",
  "type": "Trait",
  "level": 1,
  "title": "Skills",
  "classRestriction": "primary",
  "configuration": {
    "mode": "default",
    "allowReplacements": false,
    "grants": [],
    "choices": [
      {
        "count": 2,
        "pool": [
          "skills:arc",
          "skills:dec",
          "skills:ins",
          "skills:itm",
          "skills:per",
          "skills:rel"
        ]
      }
    ]
  },
  "value": {
    "chosen": [
      "skills:itm",
      "skills:per"
    ]
  }
}
```

### Important rules for skills

The app should export semantic skill options in its semantic payload.

Examples:

- `arcana`
- `deception`
- `acrobatics`
- `athletics`

The module should translate those into Foundry trait keys:

- `arcana -> skills:arc`
- `deception -> skills:dec`
- `acrobatics -> skills:acr`
- `athletics -> skills:ath`

The important part is:

- `configuration.choices[].pool` describes what can be chosen
- `value.chosen` describes what was actually chosen

For character creation, this is critical.

If we only grant all skills directly on the actor and leave `value.chosen` empty:

- the class item no longer reflects the character's actual choice
- later reimport or level-up cannot tell what was picked

### `classRestriction`

Foundry supports:

- `""`
- `primary`
- `secondary`

For level 1 class proficiencies in a normal single-class import, `primary` is usually correct.

## `ScaleValue` Advancement

Use `ScaleValue` for class progressions that are not player choices.

Examples:

- cantrips known
- spells known
- sorcery points
- metamagic known

Example:

```json
{
  "_id": "IEQeDF6M0sShGTxe",
  "type": "ScaleValue",
  "title": "Sorcery Points",
  "configuration": {
    "identifier": "sorcery-points",
    "type": "number",
    "distance": {
      "units": ""
    },
    "scale": {
      "2": { "value": 2 },
      "3": { "value": 3 },
      "4": { "value": 4 }
    }
  },
  "value": {}
}
```

Important:

- `ScaleValue` usually does not need actor-specific `value` state
- the progression lives in `configuration.scale`
- actor UI reads the current value from class level

That is why `value` is usually empty.

## `ItemGrant` Advancement

Use `ItemGrant` for features granted by level.

Example:

```json
{
  "_id": "b3zEFnmVwjnqwVUC",
  "type": "ItemGrant",
  "level": 2,
  "title": "Features",
  "configuration": {
    "items": [
      {
        "uuid": "Actor.57AKVzw7TMdf0wIH.Item.VLRgIeVtJdQ7L1oM",
        "optional": false
      }
    ],
    "optional": false,
    "spell": {
      "ability": [""],
      "uses": {
        "max": "",
        "per": "",
        "requireSlot": false
      },
      "prepared": 0
    }
  },
  "value": {
    "added": {
      "VLRgIeVtJdQ7L1oM": "Actor.57AKVzw7TMdf0wIH.Item.VLRgIeVtJdQ7L1oM"
    }
  }
}
```

### Important rules

For the app contract:

- send semantic feature references
- do not send world UUIDs as the only identity

For the module:

- resolve those references to world UUIDs on sidebar import
- resolve those references to embedded actor item UUIDs on actor import

### What `value.added` means

`value.added` is the realized state of the grant.

It tells Foundry which concrete items were actually added for that advancement.

For actor import, this matters because:

- the class item should know which embedded features came from which advancement level
- reimport and cleanup logic can compare against this state


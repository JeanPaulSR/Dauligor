# Dauligor Class Import And Advancement Guide

This document is the detailed implementation guide for class importing.

Use it when the question is not just:

- "What endpoint shape should we send?"

but also:

- "What does Foundry need in order for class import, class level-up, and character creation to work correctly?"

This guide sits underneath:

- `docs/class-import-endpoint-notes.md`
- `docs/class-import-contract.md`
- `docs/class-semantic-export-notes.md`

Those documents describe the transport contract.

This document explains the behavior contract.

For the lower-level question of how an individual advancement row should be constructed, use:

- `docs/advancement-construction-guide.md`

## Scope

This guide covers:

- class import into the world library
- class import directly onto an actor
- subclass selection as part of class import
- advancement persistence on embedded actor class items
- how the class item should support a character creator or later level-up flow

This guide does not yet finalize:

- starting equipment automation
- spell selection automation
- non-class feat importing
- general item importing

## The Core Mental Model

There are four layers to think about:

1. Source library
   - a source catalog
   - a source detail document
   - a source-scoped class catalog
   - the actual class payload

2. Semantic class payload
   - the app-native export that is rich enough to describe the class
   - this is where Dauligor should stay most expressive

3. Normalized Foundry class item
   - a `dnd5e` `Item.type = "class"`
   - optional `Item.type = "subclass"`
   - feature items as `Item.type = "feat"`
   - class advancement tree expressed in Foundry terms

4. Embedded actor class state
   - the class item as it lives on a specific character
   - chosen advancement values saved on the class item
   - granted features embedded on the actor
   - actor HP, proficiencies, subclass choice, and feature state updated from that class state

The most important rule is:

- the app owns semantic meaning
- the module owns Foundry-specific translation and persistence

Current working interpretation:

- the app exports root class and subclass `advancements`
- the exporter synthesizes inherent `ItemGrant` rows for ordinary class and subclass features
- the module reads those root advancement rows directly
- actor import applies resulting trait changes back onto the actor root so proficiencies and saves actually appear on the sheet

## Two Import Targets

### 1. World import

Use this when importing from the sidebar or building a world library.

Expected result:

- create or update the class world item
- create or update class feature world items
- optionally create or update subclass world items
- keep stable semantic identities on world documents
- resolve `ItemGrant` references to world UUIDs

This is library building, not character creation.

### 2. Actor import

Use this when importing from an actor sheet or from a character-creation flow.

Expected result:

- never create or update world items
- embed the class directly on the actor
- optionally embed the selected subclass
- embed granted features at or below the selected level
- save advancement state on the embedded class item
- update actor HP and proficiencies from advancement results

With the current importer, that actor-side update now explicitly includes:

- skill selections written onto the class `Trait` advancement and then applied to `actor.system.skills`
- saving throw trait grants applied to `actor.system.abilities.*.proficient`
- tool, armor, weapon, and language trait grants applied to the actor root trait fields

This is the mode the Dauligor character creator should care about most.

## Current Working Advancement Contract

For new Dauligor class exports, the intended contract is now:

- root `class.advancements` are authoritative
- root `subclass.advancements` are authoritative
- ordinary class/subclass feature grants are exported as inherent root `ItemGrant` rows
- feature items still hold content like description, uses, activities, and effects
- older inferred progression paths exist only as fallback compatibility behavior

In practice, a class like Sorcerer should now import with root rows for:

- `HitPoints`
- saving throw and proficiency `Trait` rows
- `Subclass`
- `ScaleValue`
- `ItemChoice`
- `AbilityScoreImprovement`
- inherent feature `ItemGrant`

## Identity Model

Do not overload one field to mean everything.

Use three identities:

- `sourceId`
  - source/book provenance
  - example: `source-phb-2014`
- `id`
  - app record identity
  - example: `awWmrbo3YxCMU86t7Yb9`
- `identifier`
  - semantic entity slug
  - example: `sorcerer`

For normalized Foundry items, the module should store:

```json
{
  "flags": {
    "dauligor-pairing": {
      "sourceId": "class-sorcerer",
      "entityId": "awWmrbo3YxCMU86t7Yb9",
      "sourceBookId": "source-phb-2014"
    }
  }
}
```

Meanings:

- `flags.dauligor-pairing.sourceId`
  - stable semantic identity used for grants, upserts, and matching
- `flags.dauligor-pairing.entityId`
  - the original app record id
- `flags.dauligor-pairing.sourceBookId`
  - the source/book document identity

The app should not send Foundry-local `_id` values as its primary identity.

## Required Class Item Shape

The normalized Foundry class item should look like a real `dnd5e` class item.

Minimum high-value fields:

```json
{
  "name": "Sorcerer",
  "type": "class",
  "img": "icons/svg/item-bag.svg",
  "flags": {
    "dauligor-pairing": {
      "sourceId": "class-sorcerer",
      "entityId": "awWmrbo3YxCMU86t7Yb9",
      "sourceBookId": "source-phb-2014"
    }
  },
  "system": {
    "identifier": "sorcerer",
    "description": {
      "value": "<p>...</p>",
      "chat": ""
    },
    "source": {
      "book": "Player's Handbook",
      "page": "0",
      "rules": "2014",
      "revision": 1,
      "custom": "",
      "license": ""
    },
    "levels": 1,
    "hd": {
      "denomination": "d6",
      "spent": 0,
      "additional": ""
    },
    "spellcasting": {
      "progression": "full",
      "ability": "cha",
      "preparation": {
        "mode": "always"
      }
    },
    "primaryAbility": {
      "value": ["cha"],
      "all": false
    },
    "properties": [],
    "wealth": "3d4*10",
    "advancement": {}
  }
}
```

## What Each Core Class Field Means

### `system.identifier`

- type: identifier string
- purpose: stable semantic slug for the class
- example: `sorcerer`

This is one of the strongest matching keys on the Foundry side.

### `system.description.value`

- type: HTML string
- purpose: the rich class description shown in the item sheet

The app should send rendered HTML, not BBCode.

### `system.source`

- type: structured source block
- purpose: book/page/rules provenance and revision metadata

At minimum, these fields matter most:

- `book`
- `page`
- `rules`
- `revision`

### `system.levels`

- type: integer
- world class item meaning:
  - usually `1`
- actor embedded class item meaning:
  - the actor's actual current level in that class

This is crucial:

- for an actor import to level 5, `system.levels` on the embedded class item should be `5`
- Foundry level-change and advancement logic uses the embedded class item's `system.levels`

### `system.hd`

Class hit-die structure:

```json
{
  "denomination": "d6",
  "spent": 0,
  "additional": ""
}
```

Meanings:

- `denomination`
  - type: string matching `/^d\\d+$/`
  - examples: `d6`, `d8`, `d10`, `d12`
- `spent`
  - type: integer
  - hit dice spent during rests
- `additional`
  - type: deterministic formula string
  - extra hit dice beyond normal class levels

Important:

- the importer should derive HP logic from `system.hd.denomination`
- do not hardcode `d8`
- later HP calculations and custom formula defaults should come from this field

### `system.spellcasting`

Purpose:

- tells Foundry what kind of spellcasting progression the class uses
- tells Foundry which ability powers class spellcasting

Important fields:

- `progression`
- `ability`
- `preparation.mode`

Common progression values in practice:

- `none`
- `full`
- `half`
- `third`
- `pact`
- `artificer`

For Sorcerer:

- `progression = "full"`
- `ability = "cha"`
- `preparation.mode = "always"`

### `system.primaryAbility`

Purpose:

- multiclassing or primary-ability semantics

Shape:

```json
{
  "value": ["cha"],
  "all": false
}
```

### `system.properties`

- type: set or array of strings
- usually empty for many classes

### `system.wealth`

- type: deterministic Foundry roll formula string
- good: `3d4*10`
- bad: `3d4 x 10 gp`

### `system.advancement`

This is the heart of class importing.

Everything the character creator cares about eventually becomes advancement data or granted items.

## Required Subclass Item Shape

If the class payload includes subclasses, each subclass should normalize into a real `dnd5e` subclass item.

Minimum important fields:

```json
{
  "name": "Divine Soul",
  "type": "subclass",
  "flags": {
    "dauligor-pairing": {
      "sourceId": "subclass-divine-soul",
      "entityId": "subclass-record-id",
      "sourceBookId": "source-phb-2014"
    }
  },
  "system": {
    "identifier": "divine-soul",
    "classIdentifier": "sorcerer",
    "description": {
      "value": "<p>...</p>",
      "chat": ""
    },
    "spellcasting": {
      "progression": "none",
      "ability": ""
    },
    "advancement": {}
  }
}
```

Important:

- `system.classIdentifier` must match the parent class `system.identifier`
- subclass advancements are evaluated using class levels, not a separate subclass level counter

## Class Feature Item Shape

Class and subclass features should normally become `Item.type = "feat"`.

Each feature item needs:

- stable semantic `sourceId`
- `classSourceId`
- a useful `system.identifier`
- description HTML
- activities/effects when relevant

The detailed activity contract now lives in:

- `docs/class-feature-activity-contract.md`

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

## Correct Actor Import Sequence For A Character Creator

This is the sequence the Dauligor-side character creator should assume the Foundry module follows.

### Step 1. Determine import context

- actor import only
- no world document creation

### Step 2. Determine selected class row

There are two meaningful selections:

- base class row
  - import class only
- subclass row
  - import class plus that subclass

If only the class row was selected:

- do not silently attach the first subclass

### Step 3. Determine current class state on the actor

Read:

- whether the actor already has this class
- current `system.levels` for that class
- existing subclass, if any
- existing advancement values

### Step 4. Determine minimum and target level

The importer should not reset to level 1 if the actor already has class levels.

Instead:

- current class level becomes the floor
- target level must be greater than or equal to current level

If actor already has Sorcerer 3:

- the next import should start from 3
- the user should choose an ending level such as 4 or 5

### Step 5. Gather advancement choices for gained levels only

This is where the character creator matters most.

Choices may include:

- HP gain per new level
- subclass choice
- skill choices
- option-group choices such as Metamagic
- future spell/equipment choices

Do not ask again for levels that already exist unless explicitly reconfiguring them.

### Step 6. Update the embedded class item

The class item should end this step with:

- `system.levels = targetLevel`
- actor-safe local advancement `_id` values
- semantic advancement ids preserved in flags
- `HitPoints.value` updated for gained levels
- `Trait.value.chosen` updated for chosen skills or other chosen traits
- `ItemGrant.value.added` updated for granted actor items

### Step 7. Update or embed subclass

If subclass was selected:

- embed the subclass item if not already present
- update subclass item advancement state if needed
- embed subclass features granted at or below the class level

If subclass was not selected:

- do not embed a subclass automatically

### Step 8. Update actor root state

This should be derived from advancement results, not used as a substitute for them.

Examples:

- actor HP current/max
- actor skill proficiencies
- actor saving throw proficiencies

The advancement data on the class item should still remain the deeper source of truth.

## Correct Class Import Checklist

For a class import to be considered correct, all of these should be true.

### Payload correctness

- the class has stable semantic identity
- the class has a real `system.identifier`
- the class has valid `system.hd.denomination`
- the class has valid `system.spellcasting`
- the class has a complete `system.advancement` object

### Advancement correctness

- `HitPoints` exists if the class uses HP advancement
- saving throws are modeled as `Trait`
- skills are modeled as `Trait` choices
- scale tracks are modeled as `ScaleValue`
- feature grants are modeled as `ItemGrant`

### Actor import correctness

- class level is saved on the class item
- HP choices are saved in `HitPoints.value`
- chosen skills are saved in `Trait.value.chosen`
- granted features are reflected in `ItemGrant.value.added`
- subclass is only imported if actually selected
- no world items are created during actor import

### Reimport correctness

- advancement local ids stay stable on the actor
- prior chosen values are preserved where still valid
- removed higher-level features are cleaned up
- actor state is not rebuilt blindly from scratch if only level is increasing

## What The App Must Provide vs What The Module Must Provide

### App must provide

- semantic class identity
- semantic subclass identity
- semantic feature identity
- class hit die
- class spellcasting model
- class advancement semantics
- skill choice pools
- option-group progression semantics

### Module must provide

- Foundry-safe local `_id` values
- world UUID resolution
- actor embedded UUID resolution
- advancement id remapping on actors
- actor-specific persistence in `value`
- synchronization between embedded class state and actor root data

## Practical Recommendation

The app should keep exporting the richest semantic class payload it can.

The module should continue owning:

- normalization into real `dnd5e` class/subclass/feat items
- actor-side advancement persistence
- world-vs-actor import policy

That is the cleanest split for supporting both:

- a world library importer
- a Dauligor character creator

## Related Documents

- `docs/class-import-endpoint-notes.md`
- `docs/class-import-contract.md`
- `docs/class-semantic-export-notes.md`
- `docs/class-feature-activity-contract.md`
- `docs/source-library-contract.md`

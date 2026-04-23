# Dauligor Character Class Import Guide

This document explains how character import should work when the only scope is:

- classes
- subclasses
- class features
- subclass features
- class advancement state

This is the right guide to use when planning the Dauligor character creator.

It is intentionally narrower than a full actor contract.

The goal is to define:

- what the character actor root should contain
- what must live on embedded class and subclass items
- what must be preserved in advancement state
- which actor root fields are authoritative versus derived

## Related Documents

Read these alongside this guide:

- `docs/class-import-and-advancement-guide.md`
- `docs/class-import-contract.md`
- `docs/class-semantic-export-notes.md`
- `docs/actor-import-contract.md`

This guide does not replace those documents.

It narrows them to one specific question:

- how should a character import work if the build is class-driven?

## Core Rule

For class-focused character imports:

- embedded class items are the source of truth
- embedded subclass items are linked secondary truth
- actor root statistics are largely derived output

This is the biggest conceptual rule in the whole guide.

If we treat the actor root as the primary truth for class state, we will eventually lose:

- HP level history
- skill-choice history
- subclass selection intent
- which features came from which class level

The correct source of truth is:

1. class item
2. subclass item
3. embedded class/subclass feature items
4. advancement state on the class item

The actor root should mostly reflect that state, not replace it.

## What A Character Payload Should Focus On

If we are only importing class-related character data, the payload should be thought of as:

1. character root shell
2. embedded class package
3. embedded subclass package
4. embedded feature package

A character import does not need to be a full actor export to be useful.

For the current Dauligor scope, the most valuable character payload is:

- one `Actor.type = "character"`
- one or more embedded `Item.type = "class"`
- zero or more embedded `Item.type = "subclass"`
- embedded class feature and subclass feature `feat` items

## Recommended Character Payload Shape

The existing generic actor transport still works:

```json
{
  "kind": "dauligor.actor-bundle.v1",
  "schemaVersion": 1,
  "source": {
    "system": "dauligor",
    "entity": "actor",
    "id": "character-althea",
    "rules": "2014",
    "revision": 1
  },
  "actor": {},
  "items": []
}
```

But for the current class-focused phase, the meaningful subset is:

```json
{
  "kind": "dauligor.actor-bundle.v1",
  "schemaVersion": 1,
  "source": {
    "system": "dauligor",
    "entity": "actor",
    "id": "character-althea",
    "rules": "2014",
    "revision": 1
  },
  "actor": {
    "name": "Althea",
    "type": "character",
    "img": "systems/dnd5e/icons/svg/actors/character.svg",
    "flags": {
      "dauligor-pairing": {
        "sourceId": "character-althea",
        "sourceType": "actor"
      }
    },
    "system": {
      "abilities": {},
      "attributes": {},
      "details": {},
      "skills": {},
      "traits": {},
      "currency": {}
    }
  },
  "items": [
    {},
    {},
    {}
  ]
}
```

## The Character Root: What Matters

### Required root identity

Minimum:

```json
{
  "name": "Althea",
  "type": "character",
  "img": "systems/dnd5e/icons/svg/actors/character.svg",
  "flags": {
    "dauligor-pairing": {
      "sourceId": "character-althea"
    }
  }
}
```

### Recommended root system fields for class-only character import

Even if the payload is class-focused, the actor root still needs some basic character data.

Most useful fields:

- `system.abilities`
- `system.attributes`
- `system.details`
- `system.skills`
- `system.traits`
- `system.currency`

But not all of those fields are equally authoritative.

## Authoritative vs Derived Root Fields

This is the single most important part of the character contract.

### Usually authoritative from the app

These are good candidates for app-owned character root data:

- `system.abilities.<ability>.value`
- `system.currency`
- `system.details.xp.value`
- `system.details.biography`
- `system.details.alignment`
- `system.details.ideal`
- `system.details.bond`
- `system.details.flaw`
- `system.details.trait`
- `system.details.appearance`
- `system.traits.size`

These are root facts about the character.

### Usually derived from embedded classes and advancements

These should generally not be treated as the primary app-owned truth in a class-focused import:

- `system.details.level`
- `system.attributes.prof`
- `system.attributes.spellcasting`
- `system.attributes.hp.max`
- `system.skills.<skill>.value`
- `system.abilities.<ability>.proficient`
- `system.traits.weaponProf`
- `system.traits.armorProf`
- `system.spells.spell1-9.value`

Why:

- `details.level` is derived from embedded class levels
- `prof` is derived from total character level
- spellcasting ability often comes from class/subclass context
- HP max is derived from class HP advancement plus other actor data
- skill and save proficiencies are often granted via `Trait` advancements
- spell slots are derived from class spellcasting progression

If the app sends those as hard truth while also sending embedded class items, the two layers can drift.

## What `dnd5e` Derives Automatically

The local `dnd5e` 5.3.1 system does a lot of derivation for character actors.

Important examples:

- `system.details.level`
  - derived by summing embedded class levels
- `system.attributes.prof`
  - derived from `details.level`
- `system.attributes.hp.max`
  - derived if `hp.max` is `null`
- `system.spells.*`
  - derived from spellcasting classes

That means a class-focused character import should usually prefer:

- correct embedded class state
- minimal root overrides

instead of trying to brute-force every actor root field directly.

## Character Root Fields To Handle Carefully

### `system.details.level`

Treat this as derived.

For character actors, `dnd5e` calculates total level from embedded class items.

Therefore:

- do not send `details.level` as your primary character-level truth
- the class items should determine it

If the character has:

- Sorcerer 3
- Fighter 2

then the actor root should end up with:

- `details.level = 5`

because the embedded class items say so.

### `system.attributes.prof`

Also derived.

Do not try to send proficiency bonus directly as build truth.

It should come from total character level.

### `system.attributes.spellcasting`

This is tricky.

It is a real actor root field, but in a class-driven character import it should usually be treated as:

- a derived convenience field

For a single-class Sorcerer:

- `cha` is a good final value

But the module can infer it from the class if the class spellcasting model is present.

### `system.attributes.hp.max`

This is where class imports often go wrong.

For class-driven imports:

- do not use `hp.max` override as the primary HP record
- the class `HitPoints` advancement should be the true per-level HP history

Recommended model:

- if the actor is build-synced from classes, prefer `hp.max = null` when possible and let `dnd5e` derive max HP from the class items and other bonuses
- only send explicit `hp.max` as app truth if Dauligor intentionally wants to override Foundry's normal class-based HP derivation

### `system.attributes.hp.value`

This is session-sensitive.

For a character creator flow:

- on a fresh import, it is often reasonable to set current HP equal to derived max HP
- on a later sync, current HP may be better treated as session-owned unless the app is explicitly the authority

### `system.skills.<key>.value`

These values are real and matter on the actor.

But for class-driven skill choices:

- the chosen skills should be saved on the class `Trait` advancement
- the actor root skill proficiencies should be treated as synchronized results of that class state

This is important because:

- actor root skills tell you current proficiency
- class advancement tells you why the actor has that proficiency

For a character creator, we want both.

## Embedded Class Package

For class-focused character import, the items array should always be able to contain:

- `class` items
- `subclass` items
- `feat` items representing granted class and subclass features

### Required class item behavior

Each class item should carry:

- `system.identifier`
- `system.levels`
- `system.hd`
- `system.spellcasting`
- `system.primaryAbility`
- `system.advancement`
- `flags.dauligor-pairing.*`

For detailed field definitions, see:

- `docs/class-import-and-advancement-guide.md`

### Required subclass item behavior

Each subclass item should carry:

- `system.identifier`
- `system.classIdentifier`
- `system.advancement`
- `flags.dauligor-pairing.*`

Important:

- subclass class linkage must be explicit
- do not rely only on names

### Required feature item behavior

Each embedded feature item should carry:

- stable semantic source identity
- class or subclass parent source identity
- a useful `system.identifier`
- description
- activities/effects where appropriate

## Advancement State Is The Character Creator Backbone

If the app has a character creator, the creator needs a stable place to remember:

- what level the class reached
- which skills were chosen
- which subclass was chosen
- what HP was taken at each level
- which granted features were actually embedded

For `dnd5e`, that state belongs primarily on the class item's `system.advancement`.

### Why this matters

Without saved advancement state:

- the class sheet becomes visually wrong
- later level-up flows cannot continue cleanly
- imported builds become snapshots rather than editable character state

## Advancement Types That Matter For Characters

### `HitPoints`

Stores per-level HP decisions.

This matters for:

- initial class creation
- later level-up
- resync of actor HP

Expected `value` shape:

```json
{
  "1": "max",
  "2": 4,
  "3": 5
}
```

Important:

- values should represent class hit-die contribution only
- do not add Constitution into the stored per-level numbers

### `Trait`

Stores:

- saving throws
- skills
- weapon proficiencies
- armor proficiencies
- other trait-style grants

For choices, the most important field is:

```json
"value": {
  "chosen": [...]
}
```

That is how the character creator's choices survive round-trips.

### `ScaleValue`

Stores the progression table, not usually actor-specific choices.

Use this for:

- cantrips known
- spells known
- sorcery points
- metamagic known

### `ItemGrant`

Stores:

- what features are granted by level
- what actual embedded items were added

Important field:

```json
"value": {
  "added": {
    "embeddedItemId": "Actor....Item...."
  }
}
```

This matters for cleanup, relinking, and future reimport logic.

## Character Import Order

This is the recommended order for a class-focused character import.

### Step 1. Upsert or create the actor shell

Use stable actor identity:

- `flags.dauligor-pairing.sourceId`

Write root fields that are truly app-owned:

- name
- image
- ability scores
- XP
- biography-like text
- size
- currency

### Step 2. Upsert class items

For each class:

- match by `entityId`
- then `sourceId`
- then `system.identifier`

Write:

- `system.levels`
- `system.hd`
- `system.spellcasting`
- `system.primaryAbility`
- `system.advancement`

### Step 3. Upsert subclass items

For each subclass:

- match by semantic identity
- ensure `system.classIdentifier` matches the owning class

### Step 4. Upsert feature items

Embed:

- class features
- subclass features

Only features that should actually exist on that character should be embedded.

### Step 5. Persist advancement values

This is the critical step.

Make sure the embedded class item saves:

- `HitPoints.value`
- `Trait.value.chosen`
- `ItemGrant.value.added`

### Step 6. Synchronize actor root from class state

Now update actor root outputs as needed:

- skill proficiency values
- save proficiency values
- HP current/max if app policy wants that
- spellcasting attribute if needed

## What The Character Creator Should Remember

For each class on the character, the app should be able to reconstruct:

- class identity
- class level
- subclass identity or no subclass
- chosen skills
- HP decisions by level
- chosen option-group selections
- granted feature identities

That means a practical character-class export should always be able to answer:

1. What class is this?
2. What level is it?
3. What subclass is selected?
4. Which advancement choices were made?
5. Which features were granted?

## Recommended Character-Class Export View

Even if the transport remains `dauligor.actor-bundle.v1`, it is useful to think about a character-class export view like this:

```json
{
  "actorSourceId": "character-althea",
  "classes": [
    {
      "sourceId": "class-sorcerer",
      "entityId": "awWmrbo3YxCMU86t7Yb9",
      "identifier": "sorcerer",
      "level": 5,
      "subclass": {
        "sourceId": "subclass-divine-soul",
        "identifier": "divine-soul"
      },
      "advancement": {
        "hitPoints": {
          "1": "max",
          "2": 4,
          "3": 4,
          "4": 4,
          "5": 6
        },
        "skills": [
          "skills:arc",
          "skills:ins"
        ],
        "grantedFeatureSourceIds": [
          "class-feature-spellcasting",
          "class-feature-font-of-magic",
          "class-feature-metamagic",
          "subclass-feature-divine-magic"
        ]
      }
    }
  ]
}
```

This does not need to be the final endpoint shape.

It is a good mental model for the data the app must be able to express.

## Fresh Character Creation vs Reimport

### Fresh character creation

Recommended behavior:

- create actor
- embed class
- embed subclass if selected
- embed granted features
- save advancement decisions
- initialize root derived state

### Reimport or resync

Recommended behavior:

- preserve stable actor identity
- preserve stable class advancement local ids
- update only changed advancement decisions
- avoid wiping unrelated session-state fields unless the app explicitly owns them

## What Should Not Be Reset Lightly

For class-focused character imports, be careful about blindly resetting:

- `system.attributes.hp.value`
- `system.attributes.hp.temp`
- `system.spells.*.value` current slot usage
- item uses spent
- session effects/conditions

Those may be live play state, not build state.

## Recommended Ownership Split

For the current phase:

### App-owned build state

- ability scores
- class selection
- subclass selection
- class level
- HP decisions by level
- class skill choices
- option-group choices
- granted class/subclass feature structure

### Foundry-owned live state unless app explicitly takes ownership

- current HP damage taken
- temporary HP
- spell slot expenditure
- feature uses spent during play
- active effects and conditions from live sessions

## Correct Character Import Checklist

The character import is class-correct if all of these are true.

### Embedded class state

- every class item has the correct `system.levels`
- every class item has a real advancement tree
- `HitPoints.value` is populated for the gained levels
- skill `Trait.value.chosen` reflects the actual selected skills
- feature `ItemGrant.value.added` reflects the actual embedded features

### Embedded subclass state

- subclass exists only when selected
- subclass is linked to the correct class via `classIdentifier`
- subclass features reflect the current class level

### Actor root state

- total level matches embedded class levels
- proficiency bonus matches total level
- root skill/save proficiencies reflect class advancement choices
- HP root fields do not fight with the class HP advancement model

## Practical Recommendation For The Next Character Endpoint

Do not start by trying to serialize every actor field.

Start with a class-centric character bundle:

1. actor shell
2. class items
3. subclass items
4. class/subclass feature items
5. advancement state preserved on the class items

If that is correct, the rest of character import becomes much easier.

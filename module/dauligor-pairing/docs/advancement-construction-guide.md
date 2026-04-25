# Dauligor Advancement Construction Guide

This document explains how to create `dnd5e` advancements correctly.

It is meant to answer questions like:

- "What is an advancement in Foundry?"
- "Which item should own the advancement?"
- "What goes in `configuration` versus `value`?"
- "How should class features, subclass features, and actor level-up choices be modeled?"

This guide is especially focused on classes and class features, but it also documents the general advancement families available in `dnd5e` `5.3.1`.

Use this alongside:

- `docs/class-import-contract.md`
- `docs/class-import-and-advancement-guide.md`
- `docs/class-feature-activity-contract.md`
- `docs/character-class-import-guide.md`

## Scope

This guide covers:

- the general `dnd5e` advancement model
- the advancement families currently present in `dnd5e` `5.3.1`
- where advancements belong for classes, subclasses, and class features
- how actor-specific advancement state should be persisted
- what the app should express semantically versus what the Foundry module should synthesize
- the current class/subclass contract now used by Dauligor export and import

This guide does not finalize:

- spell importer specifics outside class/subclass scope
- species/background-only advancement authoring
- every possible edge case for homebrew content

## The Core Mental Model

An advancement is not a standalone document.

An advancement is a row inside an item's `system.advancement` object.

That means:

- advancements live on an item
- the item owns the progression tree
- the actor stores advancement choices by embedding that item

For class-driven character creation, the important owner items are:

- the class item
- the subclass item

The important non-owner items are:

- class feature feat items
- subclass feature feat items
- optional feature feat items

Those feature items can contain:

- descriptions
- activities
- effects
- limited uses
- references

But they usually should not own the main class progression logic.

The class or subclass item should own the advancement rows that decide:

- when a feature is granted
- how many cantrips or spells are known
- how many sorcery points exist
- which skills were chosen
- how HP was gained by level
- when a subclass is selected

In the current Dauligor pipeline, this is no longer just a recommendation.

The working contract is:

- the app exports root `class.advancements`
- the app exports root `subclass.advancements`
- the exporter synthesizes inherent class/subclass `ItemGrant` rows for core features by level
- the module imports those root advancement rows directly
- actor import applies the resulting `Trait` advancements back onto the actor root for saves, skills, tools, armor, weapons, and languages

## Where Advancements Belong

### Advancements belong on the class item when:

- the advancement is part of the base class progression
- the advancement changes by class level
- the advancement should exist even before a specific feature item is embedded

Examples:

- Sorcerer hit points
- Sorcerer saving throws
- Sorcerer skill choices
- Sorcerer cantrips known
- Sorcerer spells known
- Sorcerer sorcery points
- Sorcerer feature grants like Spellcasting, Font of Magic, or Metamagic
- Sorcerer subclass selection

Important current rule:

- routine core class feature grants should not need to be hand-authored as visible editor rows
- the exporter should synthesize those `ItemGrant` rows from the class feature list
- explicit editor-authored `ItemGrant` rows are for special cases, not the ordinary base class feature track

### Advancements belong on the subclass item when:

- the progression is specific to one subclass
- the granted items are subclass features
- the scale only exists inside the subclass

Examples:

- Divine Soul feature grants at levels 1, 6, 14, and 18
- subclass-only scale tracks if one exists

The same export rule applies here:

- routine subclass feature grants should be synthesized into root subclass `ItemGrant` rows during export
- they do not need to appear as noisy always-present rows in the subclass editor UI

### Advancements usually do not belong on the feature item when:

- the feature item is simply something granted by the class or subclass

In most cases, a class feature item should be a `feat` item with:

- `system.description`
- `system.activities`
- `system.uses`
- `effects`
- semantic flags

The class or subclass item should then grant that feature using `ItemGrant` or `ItemChoice`.

### A simple rule for feature authoring

If the question is:

- "What does this feature do once the actor has it?"

that usually belongs on the feature item.

If the question is:

- "When does the actor get this feature, and how is that remembered?"

that usually belongs on the class or subclass advancement tree.

## General Advancement Object Shape

An advancement row is stored inside:

```json
{
  "system": {
    "advancement": {
      "pmtnr3nzZhwNOw3i": {
        "_id": "pmtnr3nzZhwNOw3i",
        "type": "HitPoints",
        "level": 1,
        "title": "Hit Points",
        "configuration": {},
        "value": {},
        "flags": {},
        "hint": ""
      }
    }
  }
}
```

The important persisted fields are:

- `_id`
- `type`
- `level`
- `title`
- `configuration`
- `value`
- `flags`
- `hint`

Some advancement families also use:

- `classRestriction`
- `icon`

For Dauligor class exports, the most important currently working root families are:

- `HitPoints`
- `Trait`
- `ScaleValue`
- `ItemGrant`
- `ItemChoice`
- `Subclass`
- `AbilityScoreImprovement`

## What Each Top-Level Field Means

### `_id`

- type: string
- actor-embedded requirement: must be a valid 16-character alphanumeric Foundry id
- purpose: local identity for that advancement row

This is one of the most important implementation details.

For Dauligor:

- world items may preserve semantic/source-style advancement identity if the system accepts it
- actor-embedded class and subclass items should use Foundry-safe 16-character `_id` values
- the semantic id should be preserved separately in flags

Recommended actor-side pattern:

```json
{
  "_id": "AbCdEf123456GhIj",
  "flags": {
    "dauligor-pairing": {
      "sourceAdvancementId": "classSorcererHitPoints"
    }
  }
}
```

### `type`

- type: string
- purpose: chooses the advancement family and its schema

Supported families in `dnd5e` `5.3.1`:

- `AbilityScoreImprovement`
- `HitPoints`
- `ItemChoice`
- `ItemGrant`
- `ScaleValue`
- `Size`
- `Subclass`
- `Trait`

### `level`

- type: integer
- purpose: the class/race/background/etc level where the advancement applies

For classes and subclasses, this is usually the character level within that class progression, not actor total level.

### `title`

- type: string
- purpose: the sheet-facing label shown on the Advancement tab

Examples:

- `Hit Points`
- `Saving Throws`
- `Skills`
- `Cantrips Known`
- `Features`
- `Sorcery Points`

### `configuration`

- type: object
- purpose: the static definition of what the advancement is allowed to do

This is the design-time part of the advancement.

Examples:

- the skill pool a Trait advancement can offer
- the scale table a ScaleValue advancement uses
- the granted item list an ItemGrant advancement can add
- the ASI points cap on AbilityScoreImprovement

### `value`

- type: object
- purpose: the actor- or item-specific realized state of the advancement

This is the runtime/persisted choice layer.

Examples:

- which skills were chosen
- which items were actually granted
- which HP result was taken at each level
- which item choices replaced earlier ones

If `configuration` says what can happen, `value` says what did happen.

### `flags`

- type: object
- purpose: custom module metadata

For Dauligor, use this for:

- `sourceAdvancementId`
- migration metadata
- provenance metadata

### `hint`

- type: string
- purpose: extra UI/help text

Usually optional.

## `configuration` Versus `value`

This distinction is the single most important rule to keep straight.

### `configuration` is for static rules

Examples:

- "Choose 2 from Arcana, Deception, Insight, Intimidation, Persuasion, Religion"
- "At level 2 the value is 2, at level 3 the value is 3"
- "Grant Font of Magic and Sorcery Points at level 2"

### `value` is for realized state

Examples:

- `"chosen": ["skills:itm", "skills:per"]`
- `"1": "max", "2": 4, "3": 6`
- `"added": { "abc...": "Actor.X.Item.abc..." }`

### Common mistake

Do not write actor decisions into `configuration`.

Do not treat `configuration` as "current state."

That will break reimport, level-up continuation, and actor reconstruction.

## General Advancement Families

The list below reflects the advancement families registered in `CONFIG.DND5E.advancementTypes` in `dnd5e` `5.3.1`.

### `AbilityScoreImprovement`

Valid item families:

- `background`
- `class`
- `race`
- `feat`

Purpose:

- models ASI or epic-boon style point allocation

Observed configuration shape:

```json
{
  "cap": 2,
  "fixed": {},
  "locked": [],
  "points": 0,
  "recommendation": null
}
```

Typical usage:

- class levels that grant ASI
- backgrounds or feats that give stat increases

For Dauligor class import:

- this is a future-supported advancement family
- it is the correct long-term place for ASI choices
- do not fake ASI by directly mutating actor abilities without any advancement row

### `HitPoints`

Valid item families:

- `class`

Purpose:

- stores class hit point gains by level

Observed shape:

```json
{
  "type": "HitPoints",
  "configuration": {},
  "value": {
    "1": "max",
    "2": 4,
    "3": 6
  }
}
```

Important behavior:

- `configuration` is usually empty
- `value` is the important part
- level 1 commonly uses `"max"`
- later levels store concrete numeric results

For class importing:

- class hit die belongs on `system.hd`
- the actual per-level gained HP belongs in `HitPoints.value`
- do not rely only on overriding actor `hp.max`

If the actor's HP total changes but the class `HitPoints` advancement stays blank, the import is not correct yet.

### `ItemChoice`

Valid item families:

- all item types supported by `dnd5e`

Purpose:

- allows choosing one or more items from a pool
- also supports replacement behavior

Observed configuration shape:

```json
{
  "allowDrops": true,
  "choices": {
    "4": {
      "count": 2,
      "replacement": true
    },
    "10": {
      "count": 3,
      "replacement": false
    }
  },
  "pool": [
    {
      "uuid": "Item.7nukcdynNu8SURbx"
    }
  ],
  "restriction": {
    "list": []
  },
  "spell": null,
  "type": null
}
```

Observed value shape:

```json
{
  "added": {},
  "replaced": {}
}
```

For class creation:

- this is the better long-term home for option-group style item choices
- examples include fighting styles, maneuvers, invocations, metamagic-style itemized choices, or similar option pools

For current Dauligor flow:

- actor-side option selection is still partly custom workflow driven
- the long-term target is to converge those choices into real ItemChoice persistence where it makes sense

### `ItemGrant`

Valid item families:

- all item types supported by `dnd5e`

Purpose:

- grants concrete items when the advancement applies

Observed configuration shape:

```json
{
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
}
```

Observed value shape:

```json
{
  "added": {
    "VLRgIeVtJdQ7L1oM": "Actor.57AKVzw7TMdf0wIH.Item.VLRgIeVtJdQ7L1oM"
  }
}
```

This is the normal advancement family for class and subclass features.

Use it when:

- a class grants Spellcasting at level 1
- a class grants Font of Magic at level 2
- a subclass grants Divine Magic at level 1

For Dauligor:

- the app should send semantic feature references
- the module should resolve them to world or actor UUIDs
- `value.added` should track what was actually created/attached

### `ScaleValue`

Valid item families:

- all item types supported by `dnd5e`

Purpose:

- defines a level-based scale such as numbers, dice, or strings

Observed configuration shape:

```json
{
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
}
```

Observed value shape:

```json
{}
```

Typical class usage:

- cantrips known
- spells known
- sorcery points
- metamagic known
- any class resource that scales deterministically by level

Important rule:

- the progression belongs in `configuration.scale`
- actor-specific current value is derived from level
- `value` is usually empty

### `Size`

Valid item families:

- `race`

Purpose:

- controls size progression or size choice

This is not a core class advancement family, but it exists in the system and belongs in the general model.

For class-focused work:

- you usually do not need this

### `Subclass`

Valid item families:

- `class`

Purpose:

- defines subclass selection as a real advancement

This is the system-native advancement family for choosing a subclass from a class.

For Dauligor:

- this is the long-term best home for base-class-to-subclass branching
- right now some of our workflow still makes subclass selection externally
- the target architecture should still treat subclass choice as advancement state, not just temporary wizard state

### `Trait`

Valid item families:

- all item types supported by `dnd5e`

Purpose:

- grants or chooses traits and proficiencies

Observed configuration shape:

```json
{
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
}
```

Also observed:

- `classRestriction` can be present, for example `"primary"`

Observed value shape:

```json
{
  "chosen": [
    "skills:itm",
    "skills:per"
  ]
}
```

Typical class usage:

- saving throws
- skill choices
- weapon proficiencies
- armor proficiencies
- tool proficiencies
- languages

This is the correct place for class skill choice persistence.

Do not:

- present a skill choice UI
- grant the chosen proficiencies on the actor
- then leave the class `Trait` advancement empty

That loses the canonical class-state record.

## What A Correct Class Advancement Tree Usually Looks Like

A well-formed class usually mixes several advancement families.

Example patterns:

- `HitPoints`
  - records per-level HP gains
- `Trait`
  - saving throws
  - skills
  - weapon proficiencies
- `ScaleValue`
  - cantrips known
  - spells known
  - class resources
- `ItemGrant`
  - feature items granted at specific levels
- `Subclass`
  - subclass selection from the base class
- `AbilityScoreImprovement`
  - ASI/boon choices at later levels

This is why a feature-rich class is not modeled by one advancement family alone.

## Class Features Versus Advancements

This is the piece that usually causes the most confusion.

### A class feature item is usually a `feat`

The feature item should define:

- name
- semantic identity
- description
- activities
- effects
- uses
- references

### The class advancement should define:

- what level grants the feature
- whether the feature is optional or required
- whether it is one feature or a choice among many
- what actor-side grant state was actually realized

### Example

`Font of Magic` should usually be represented as:

1. a `feat` item named `Font of Magic`
2. a `ScaleValue` advancement for `sorcery-points`
3. an `ItemGrant` advancement on the Sorcerer class that grants the `Font of Magic` feat item

The feature item explains the rule text and activities.

The class advancement tree explains when it exists and how it is persisted.

## Class Feature Patterns

### Pattern 1: fixed class feature

Use:

- `ItemGrant`

Examples:

- Spellcasting
- Font of Magic
- Magical Guidance

### Pattern 2: fixed subclass feature

Use:

- subclass item owns the `ItemGrant`

Examples:

- Divine Magic
- Empowered Healing
- Otherworldly Wings

### Pattern 3: choice among several feature-like options

Use:

- `ItemChoice` when the options are best modeled as items
- `Trait` when the options are trait/proficiency pools

Examples:

- Metamagic options
- fighting styles
- maneuver choices

### Pattern 4: deterministic level resource or progression

Use:

- `ScaleValue`

Examples:

- sorcery points
- cantrips known
- spells known
- metamagic count

### Pattern 5: actor decision at each gained level

Use:

- `HitPoints`
- future `AbilityScoreImprovement`
- `Trait`
- `ItemChoice`

These are the advancement families where `value` persistence matters most.

## World Items Versus Actor-Embedded Items

The same advancement row behaves differently depending on where it lives.

### World item

Purpose:

- define the canonical progression tree

Good place for:

- semantic/source-backed advancement identity
- stable configuration tables
- world UUID references

### Actor-embedded class or subclass item

Purpose:

- define that actor's realized progression state

Must preserve:

- actor-safe advancement `_id`
- semantic advancement id in flags
- chosen `value`
- granted item mappings in `value.added`

If the world class is the blueprint, the actor-embedded class is the filled-in worksheet.

## Actor Persistence Rules

For actor import or character creation, these rules matter most.

### HP must persist in `HitPoints.value`

Example:

```json
{
  "value": {
    "1": "max",
    "2": 4,
    "3": 6
  }
}
```

Why:

- later level-up needs to know what was already chosen
- export needs to reflect the actual class build history
- actor reconstruction should not infer all HP gains from current `hp.max`

### Skill choices must persist in `Trait.value.chosen`

Example:

```json
{
  "value": {
    "chosen": [
      "skills:acr",
      "skills:ath"
    ]
  }
}
```

Why:

- the class item should remember which class skills were chosen
- actor root skill proficiency is derived output, not the deeper source of truth

### Granted feature state must persist in `ItemGrant.value.added`

Example:

```json
{
  "value": {
    "added": {
      "VLRgIeVtJdQ7L1oM": "Actor.XXX.Item.VLRgIeVtJdQ7L1oM"
    }
  }
}
```

Why:

- cleanup and reimport need to know what came from that advancement
- the item grant should be traceable to real embedded items

### Item choices must persist in `ItemChoice.value`

Typical shape:

```json
{
  "value": {
    "added": {},
    "replaced": {}
  }
}
```

Why:

- later edits or reimports need to know what was chosen
- replacement logic depends on remembering what got swapped

## Recommended Dauligor Semantic Contract For Advancements

The app does not need to emit raw Foundry-local `_id` values as its source of truth.

The app should describe advancements semantically.

Recommended semantic shape:

```json
{
  "sourceAdvancementId": "classSorcererHitPoints",
  "type": "HitPoints",
  "level": 1,
  "title": "Hit Points",
  "configuration": {},
  "semantic": {
    "kind": "classHitPoints"
  }
}
```

Another example:

```json
{
  "sourceAdvancementId": "classSorcererSkills",
  "type": "Trait",
  "level": 1,
  "title": "Skills",
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
  }
}
```

The module should then:

- generate the actor-safe `_id`
- preserve `sourceAdvancementId` in flags
- attach or preserve `value` state during import/reimport

## Correct Import and Level-Up Sequence

For class-focused character creation, the advancement flow should look like this:

1. normalize the class and subclass into Foundry items
2. construct the class advancement tree
3. embed the class item on the actor
4. embed the subclass item if selected
5. gather only the choices for newly gained levels
6. write those choices into advancement `value`
7. embed the granted features/options
8. write `ItemGrant.value.added` and `ItemChoice.value`
9. update actor root data from the advancement results

The important order rule is:

- actor root data should be downstream of the class item advancement state

Not the other way around.

## Common Pitfalls

### Pitfall 1: putting class progression on the feature item

Wrong:

- Font of Magic feat owns the logic for when sorcery points appear

Better:

- Sorcerer class owns the `ScaleValue` and `ItemGrant`
- Font of Magic feat owns description and activities

### Pitfall 2: saving choices on the actor but not on the class item

Wrong:

- actor gets Arcana and Insight
- class `Trait.value.chosen` remains empty

Better:

- `Trait.value.chosen` stores the class decision
- actor skills are updated from that decision

### Pitfall 3: using actor HP max as the only HP history

Wrong:

- actor `hp.max` becomes 17
- `HitPoints.value` remains empty

Better:

- `HitPoints.value` stores `"1": "max", "2": 5, "3": 6`
- actor HP total is updated from that stored history

### Pitfall 4: unstable advancement ids on the actor

Wrong:

- each reimport generates new advancement ids

Better:

- preserve semantic ids in flags
- reuse or map stable actor-local ids across reimports

### Pitfall 5: subclass selection as only a temporary UI decision

Wrong:

- the importer remembers subclass only during the wizard
- the class/subclass items do not persist the decision meaningfully

Better:

- subclass selection becomes part of advancement or stored class state
- later level-up can continue from that decision

## Practical Checklists

### Advancement construction checklist

- advancement row has the right `type`
- advancement row has a stable semantic identity in flags
- level is correct for the owning progression
- `configuration` expresses the static rule
- `value` is empty for world blueprints unless there is intentional default state

### Actor import checklist

- embedded advancement ids are Foundry-safe
- HP choices are written into `HitPoints.value`
- skill choices are written into `Trait.value.chosen`
- granted features are written into `ItemGrant.value.added`
- item choices are written into `ItemChoice.value`
- actor root data is updated from those saved choices

### Class feature checklist

- feature itself is a `feat` item
- feature activities and effects live on the feat item
- grant timing lives on the class or subclass advancement tree
- option groups use `ItemChoice` or another advancement pattern, not only wizard-local memory

## Relationship To Character Importing

If character importing is class-focused, then advancement state is the backbone of the actor import.

That means:

- class items define the progression
- subclass items define subclass progression
- feature items define behavior
- advancement `value` defines what the actor actually chose

Without that layer, the actor becomes much harder to reimport, level, audit, or export.

## Related Documents

- `docs/class-import-contract.md`
- `docs/class-import-and-advancement-guide.md`
- `docs/class-feature-activity-contract.md`
- `docs/character-class-import-guide.md`

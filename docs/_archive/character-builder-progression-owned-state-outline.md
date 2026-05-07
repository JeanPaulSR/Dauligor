# Character Builder Progression-Owned State Outline

This document defines the next-state storage model for Dauligor characters so the app can export directly into a Foundry `dnd5e` character actor without losing class, subclass, or advancement history.

It is based on the current local contracts and notes in:

- [schemas/characters.md](E:/DnD/Professional/Dev/Dauligor/schemas/characters.md)
- [actor-import-contract.md](E:/DnD/Professional/Dev/Dauligor/module/dauligor-pairing/docs/actor-import-contract.md)
- [character-class-import-guide.md](E:/DnD/Professional/Dev/Dauligor/module/dauligor-pairing/docs/character-class-import-guide.md)
- [correcting-character-creation.md](E:/DnD/Professional/Dev/Dauligor/module/dauligor-pairing/notes-for-app-team/correcting-character-creation.md)

This is not a final migration script. It is the target shape and the implementation outline the builder should move toward.

## 1. Goal

The builder should stop behaving like a loose sheet snapshot with class notes attached.

The builder should behave like a Dauligor-side representation of a Foundry character actor:

- actor root facts are stored once
- class and subclass progression is preserved explicitly
- advancement choices are preserved explicitly
- granted features are preserved explicitly
- granted items are preserved explicitly
- spells and item ownership have reserved homes even while those systems are still in development

The export target is:

1. actor root shell
2. embedded class items
3. embedded subclass items
4. embedded granted feature items
5. embedded owned spell and item documents

## 2. Current Builder State

The current `characters/{id}` shape is still mostly sheet-first.

Current important fields:

- `name`
- `level`
- `hp`
- `stats.base`
- `savingThrows`
- `proficientSkills`
- `armorProficiencies`
- `weaponProficiencies`
- `toolProficiencies`
- `languages`
- `classId`
- `subclassId`
- `selectedOptions`
- `progression`
- `classes`
- `classGrantedTraits`

### 2.1 What is already better than before

The builder now has:

- `progression` entries with `classId`, `className`, `subclassId`, `level`
- grouped class summaries derived from progression
- per-class subclass ownership instead of a purely global subclass assumption
- multiclass spellcasting calculation from class and subclass contributors

### 2.2 What is still weak

The builder still relies too much on derived reconstruction.

Missing or weak areas:

- advancement choices live in a global `selectedOptions` map instead of a formal progression-owned block
- granted feature ownership is mostly reconstructed from progression summaries instead of stored directly
- granted item ownership is mostly reconstructed from grants instead of stored directly
- `classId` and `subclassId` still exist as compatibility mirrors instead of the only real truth being the progression/class package
- spells do not yet have a reserved owned-state model on the character
- equipment and inventory do not yet have a reserved owned-state model on the character
- `characterExport.ts` is still actor-root heavy and not yet the canonical Foundry actor-bundle exporter

## 3. Foundry-Side Model We Need To Match

For class-driven characters, the important Foundry model is:

### 3.1 Actor root

Good actor-root truth:

- name
- portrait
- ability scores
- biography and descriptive details
- currency
- size
- current HP
- temp HP

Usually derived from class/subclass items:

- total level
- proficiency bonus
- HP max when not intentionally overridden
- spell slots
- save proficiency state
- skill proficiency state
- armor/weapon/tool proficiency state

### 3.2 Embedded class items

Each class item should preserve:

- class identity
- class level
- class spellcasting block
- HP advancement history
- ASI history
- trait advancement choices
- option/item choices
- selected subclass link

### 3.3 Embedded subclass items

Each subclass item should preserve:

- subclass identity
- parent class link
- subclass spellcasting block if it exists
- custom subclass advancement rows
- subclass feature grants at their proper levels

### 3.4 Embedded feature, spell, and inventory items

These should exist as owned item documents on the actor.

Important groups:

- class features
- subclass features
- spells
- inventory/equipment/tools/consumables

The root actor should not be forced to explain ownership by itself.

## 4. Proposed Dauligor Character State

The builder should move toward four layers on the Dauligor character document.

### 4.1 Root character facts

This remains the actor-root-friendly shell.

Recommended owner:

- `name`
- `imageUrl`
- `campaignId`
- `stats.base`
- `info`
- `raceData`
- `currency`
- `hp.current`
- `hp.temp`
- `senses.additional`
- non-class descriptive metadata

These should continue to exist because they are true character facts, not class history.

### 4.2 Progression timeline

Keep `progression`, but treat it as the level-by-level ledger.

Recommended shape:

```json
"progression": [
  {
    "index": 0,
    "classId": "wizardDocId",
    "classIdentifier": "wizard",
    "classSourceId": "class-wizard",
    "className": "Wizard",
    "subclassId": "",
    "subclassIdentifier": "",
    "subclassSourceId": "",
    "level": 1,
    "introductionMode": "primary"
  },
  {
    "index": 1,
    "classId": "wizardDocId",
    "classIdentifier": "wizard",
    "classSourceId": "class-wizard",
    "className": "Wizard",
    "subclassId": "evocationDocId",
    "subclassIdentifier": "school-of-evocation",
    "subclassSourceId": "subclass-school-of-evocation",
    "level": 2,
    "introductionMode": "primary"
  }
]
```

Purpose:

- explicit class-level history
- explicit subclass-on-that-class history
- deterministic multiclass ordering
- deterministic HP history derivation
- deterministic spellcasting contribution derivation

### 4.3 Progression-owned state

This is the new missing layer.

This should hold the resolved advancement state that today is spread between `selectedOptions`, derived grant summaries, and ad hoc builder logic.

Recommended top-level field:

```json
"progressionState": {
  "classPackages": [],
  "ownedFeatures": [],
  "ownedItems": [],
  "ownedSpells": [],
  "derivedSync": {}
}
```

## 5. Class Packages

The clearest unit is one package per active class on the character.

Recommended shape:

```json
{
  "classId": "wizardDocId",
  "classIdentifier": "wizard",
  "classSourceId": "class-wizard",
  "className": "Wizard",
  "classLevel": 3,
  "introductionMode": "primary",
  "subclassId": "evocationDocId",
  "subclassIdentifier": "school-of-evocation",
  "subclassSourceId": "subclass-school-of-evocation",
  "subclassName": "School of Evocation",
  "advancementSelections": [],
  "grantedFeatureRefs": [],
  "grantedItemRefs": [],
  "spellcasting": {},
  "hitPointHistory": {},
  "scaleState": {}
}
```

### 5.1 Why class packages are needed

They give us one place to answer:

1. what class is this
2. what level is it
3. what subclass is attached to this class
4. what choices were made inside this class
5. what did this class grant
6. how does this class contribute to spellcasting

This matches how Foundry thinks about embedded class items.

## 6. Advancement Selections

Replace the global `selectedOptions` map as the true source of truth.

Recommended per-class shape:

```json
"advancementSelections": [
  {
    "key": "type:class|class:wizardDocId|subclass:none|parent:wizardDocId|adv:base-skills|level:1",
    "parentType": "class",
    "parentId": "wizardDocId",
    "parentSourceId": "class-wizard",
    "advancementId": "base-skills",
    "level": 1,
    "type": "Trait",
    "choiceId": "skills",
    "selectedIds": ["arcana", "history"],
    "selectedSemantic": ["skills:arc", "skills:his"]
  }
]
```

### 6.1 Why this is better

It stores:

- exactly which advancement row the choice belongs to
- exactly which class/subclass/feature owns that row
- the raw selected ids from Dauligor
- the semantic selection tokens needed for Foundry-native advancement values

### 6.2 What should remain at top level

For migration compatibility, `selectedOptions` can continue to exist temporarily as a cache or mirror.

Long-term target:

- `progressionState.classPackages[].advancementSelections` is the truth
- `selectedOptions` becomes deprecated

## 7. Granted Features

We need explicit ownership for class and subclass features.

Recommended shape:

```json
"ownedFeatures": [
  {
    "ownerClassId": "wizardDocId",
    "ownerSubclassId": "evocationDocId",
    "sourceFeatureId": "feature-sculpt-spells",
    "sourceType": "subclass-feature",
    "sourceLevel": 2,
    "grantedBy": {
      "parentType": "subclass",
      "parentId": "evocationDocId",
      "advancementId": "inherent-subclass-feature-grant-sculpt-spells"
    },
    "embeddedType": "feat",
    "featureTypeValue": "subclass",
    "featureTypeSubtype": "",
    "active": true
  }
]
```

### 7.1 Why this matters

This is the builder-side equivalent of Foundry actor-owned feat items.

It lets the builder sheet answer:

- what features does this character own right now
- which class or subclass granted them
- what level unlocked them
- what gets removed if class state changes

### 7.2 Current gap

Today this is mostly reconstructed from summaries.

That is useful for display, but it is weaker for:

- export
- pruning
- reimport
- multiclass debugging

## 8. Granted Items

We also need explicit ownership for non-feature granted items.

Recommended shape:

```json
"ownedItems": [
  {
    "ownerClassId": "artificerDocId",
    "ownerSubclassId": "",
    "sourceItemId": "item-thieves-tools",
    "sourceType": "starting-equipment",
    "sourceLevel": 1,
    "grantedBy": {
      "parentType": "class",
      "parentId": "artificerDocId",
      "advancementId": "base-items"
    },
    "itemKind": "tool",
    "quantity": 1,
    "equipped": false,
    "containerId": ""
  }
]
```

### 8.1 Why this matters

This is where:

- starting equipment
- granted equipment
- granted tools
- option-pool items

should live as actual owned character state.

### 8.2 Current gap

The builder can now display granted items better, but it still does not treat them as a first-class owned inventory layer.

## 9. Spells

Spells are still in development, but we should reserve their home now.

Recommended shape:

```json
"ownedSpells": [
  {
    "ownerClassId": "wizardDocId",
    "ownerSubclassId": "",
    "sourceSpellId": "spell-fireball",
    "sourceBookId": "source-phb",
    "classIdentifier": "wizard",
    "listType": "prepared",
    "prepared": true,
    "favorite": false,
    "tags": [],
    "knownFrom": {
      "parentType": "class",
      "parentId": "wizardDocId"
    }
  }
]
```

### 9.1 Why it belongs here

Foundry runtime spell truth lives on embedded spell items, not just actor-root spell slot fields.

So the builder needs a reserved owned-spell layer that can later export into actor-owned spell items with:

- native `dnd5e` spell fields
- Dauligor flags from [actor-spell-flag-schema.md](E:/DnD/Professional/Dev/Dauligor/module/dauligor-pairing/docs/actor-spell-flag-schema.md)

### 9.2 What should not happen

Do not try to make root `system.spells.*` the primary spell model.

Those slot counts are derived outputs, not the owned spell library itself.

## 10. Spellcasting State

Each class package should keep its spellcasting contribution directly.

Recommended per-class shape:

```json
"spellcasting": {
  "enabled": true,
  "ability": "int",
  "type": "prepared",
  "progression": "full",
  "progressionId": "full-caster",
  "preparationFormula": "@mod + @level",
  "multiclassContributionFormula": "1 * level",
  "unlockLevel": 1,
  "effectiveCastingLevel": 3
}
```

For subclasses:

```json
"spellcasting": {
  "enabled": true,
  "ability": "int",
  "type": "known",
  "progression": "third",
  "progressionId": "third-caster",
  "unlockLevel": 3,
  "effectiveCastingLevel": 1
}
```

### 10.1 Why this matters

This lets the builder preserve:

- why the class contributes to multiclass casting
- when subclass casting turns on
- which ability and list type apply

without recomputing everything from scratch at every export boundary.

## 11. Hit Point History

Each class package should preserve explicit HP advancement values.

Recommended shape:

```json
"hitPointHistory": {
  "1": "max",
  "2": 4,
  "3": 5
}
```

This should map cleanly into the class item `HitPoints.value` history in Foundry export.

### 11.1 Why this is needed

This is more correct than only storing:

- `hp.max`
- `hitDie.current`
- `hitDie.max`

because Foundry class state actually cares about the per-level history.

## 12. Scale State

Class and subclass scale columns should have explicit current state.

Recommended shape:

```json
"scaleState": {
  "rage-damage": 2,
  "sorcery-points": 3,
  "artificer-infusions-known": 4
}
```

This can still be derived from class level in many cases, but keeping a normalized class-package view makes sheet rendering and export easier.

## 13. Derived Sync Snapshot

We still need a derived layer for the visible sheet.

Recommended field:

```json
"derivedSync": {
  "savingThrows": ["INT", "WIS"],
  "proficientSkills": ["arcana", "history"],
  "armorProficiencies": ["light", "medium", "shields"],
  "weaponProficiencies": ["simple"],
  "toolProficiencies": ["thieves-tools"],
  "languages": ["common", "elvish"],
  "spellcastingLevel": 4,
  "spellSlots": [4, 3, 0, 0, 0, 0, 0, 0, 0]
}
```

This is the builder-side mirror of actor-root synchronized results.

### 13.1 Important rule

This layer should be treated as cache/output.

It should not replace the class packages as the build truth.

## 14. Direct Mapping To Foundry Export

This is the critical export mapping.

### 14.1 Actor root export

Use root character facts and selected derived sync values to build:

- `actor.name`
- `actor.img`
- `actor.type = "character"`
- `system.abilities`
- `system.details.biography`
- `system.details.alignment`
- `system.traits.size`
- `system.currency`
- `system.attributes.hp.value`
- `system.attributes.hp.temp`

Handle carefully:

- `system.attributes.hp.max`
- `system.details.level`
- `system.attributes.prof`
- `system.spells.*`

These should usually be left derived when possible.

### 14.2 Class item export

From each `classPackage`, export one embedded `Item.type = "class"` with:

- identity
- levels
- spellcasting block
- `HitPoints.value`
- `Trait.value.chosen`
- `ItemChoice.value.chosen`
- `AbilityScoreImprovement.value`
- selected subclass advancement value

### 14.3 Subclass item export

From each class package with a subclass, export one embedded `Item.type = "subclass"` with:

- identity
- parent class identifier
- spellcasting block if applicable
- subclass advancement values

### 14.4 Feature item export

From `ownedFeatures`, export actor-owned `feat` items with:

- description
- uses
- activities
- effect scaffolding
- `flags.dauligor-pairing.sourceId`

### 14.5 Spell item export

From `ownedSpells`, export actor-owned `spell` items with:

- native spell data
- class grouping metadata
- Dauligor spell flags

### 14.6 Inventory item export

From `ownedItems`, export actor-owned `equipment`, `tool`, `weapon`, `consumable`, or `loot` items as appropriate.

## 15. What Is Missing Today

Compared to the target above, the builder still lacks:

1. formal `progressionState.classPackages`
2. formal `advancementSelections` per class package
3. formal `ownedFeatures`
4. formal `ownedItems`
5. formal `ownedSpells`
6. formal `hitPointHistory` per class package
7. formal `scaleState` per class package
8. a canonical export pipeline that reads this model directly instead of reconstructing it

## 16. Recommended Implementation Order

### Phase 1

Create `progressionState.classPackages` and move advancement selections there.

This is the most important foundation because it resolves:

- class ownership
- subclass ownership
- advancement choice history
- spellcasting contribution ownership

### Phase 2

Add `ownedFeatures` and `ownedItems`.

This makes the builder and sheet read from explicit ownership instead of summary inference.

### Phase 3

Add `hitPointHistory` and `scaleState` into each class package.

This makes HP export and class scale export deterministic.

### Phase 4

Reserve and then implement `ownedSpells`.

This should line up with the actor spell flag schema and the multiclass spellcasting work already in progress.

### Phase 5

Refactor `characterExport.ts` and the builder export path so they read this progression-owned model directly and emit a full actor bundle for Foundry.

## 17. Immediate Next Coding Targets

The first coding pass after this outline should likely do these three things:

1. introduce `progressionState.classPackages`
2. move advancement selection truth from top-level `selectedOptions` into `classPackages[].advancementSelections`
3. begin storing explicit `ownedFeatures` and `ownedItems` during class-step progression updates

Once those exist, the sheet and export layers can stop reconstructing so much on the fly.

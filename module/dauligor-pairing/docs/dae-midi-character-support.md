# DAE And Midi Character Support Guide

This document explains what it means for Dauligor-created characters, items, spells, and features to work well with:

- Dynamic Active Effects (`dae`)
- Midi-QOL (`midi-qol`)

This is based on:

- the installed modules in the local Foundry environment
- the local `dnd5e` v5.3.x system behavior
- the official module documentation for DAE and Midi-QOL

Installed module versions observed locally:

- `dae` `13.0.26`
- `midi-qol` `13.0.58`

## Short Version

To support DAE and Midi correctly, a character export does **not** need a special actor format.

What it needs is:

- valid embedded class, subclass, spell, item, and feature items
- real native `dnd5e` `system.activities`
- real native Active Effects when an effect exists
- references and formulas normalized into native Foundry roll-data paths
- optional DAE or Midi flags only where the effect or item actually needs them

The actor shell alone is not what makes a character "Midi-ready" or "DAE-ready".

The supporting items and effects do.

## Core Rule

### DAE is effect-centric

DAE extends how Active Effects work.

It does not replace the need for native items or native activities.

Its main value is:

- richer Active Effect field editing
- formulas and expressions in effect values
- extra duration and stacking behavior
- macro integration
- easier non-transfer effect application

### Midi is activity-centric

Midi-QOL's modern workflow is built around `activity.use()`.

That means:

- if an item has proper native `system.activities`, Midi can automate it
- if an item does not have proper activities, Midi has much less to work with

So the correct support stack is:

1. native `dnd5e` item
2. native `system.activities`
3. native Active Effects
4. DAE/Midi-specific flags only where needed

## What DAE Actually Adds

According to the official DAE readme and the installed module code, DAE mainly expands Active Effects in these ways:

- allows formulas and data references in effect values
- supports additional CUSTOM-style behavior
- supports derived-field updates after normal system preparation
- supports special expiry rules
- supports effect stacking modes
- supports macro execution on effect application/removal
- supports applying non-transfer effects to targets

Useful observed DAE-specific fields and behaviors:

- `flags.dae.specialDuration`
- `flags.dae.stackable`
- `flags.dae.stacks`
- `flags.dae.durationExpression`
- `flags.dae.transfer`
- `flags.dae.itemMacro`
- `flags.dae.activityMacro`
- `flags.dae.enableCondition`
- `flags.dae.disableCondition`

Important practical meaning:

- DAE expects normal Foundry Active Effects to exist first
- then DAE enhances them

So Dauligor should not invent a separate "effect system" for DAE.

It should export native Active Effects plus any DAE-specific fields when needed.

## What Midi-QOL Actually Adds

According to the official Midi documentation and the installed module code, Midi-QOL mainly adds:

- workflow automation around `activity.use()`
- attack/hit/save/damage automation
- effect application based on hit/save outcomes
- reaction handling
- concentration handling
- overtime processing
- macro hooks and workflow hooks
- roll modifier tracking

Important observed Midi expectations:

- `activity.use()` is the recommended trigger surface
- `flags.midi-qol.*` flags are usually set through Active Effects using `CUSTOM` mode
- Midi can consume native activities, then extend them with workflow logic
- many advanced behaviors live in effects and flags, not in the actor root

Useful observed Midi-specific fields and behaviors:

- `flags.midi-qol.onUseMacroName`
- `flags.midi-qol.OverTime`
- `flags.midi-qol.ActivityOverTime`
- `flags.midi-qol.advantage.*`
- `flags.midi-qol.disadvantage.*`
- `flags.midi-qol.grants.*`
- `flags.midi-qol.actions.*`
- `workflowOptions`
- activity `midiProperties`

Important practical meaning:

- Midi wants usable activities first
- DAE-style effects and Midi flags are then layered on top

## What Makes A Character Compatible

For Dauligor, a character should be considered DAE/Midi-compatible if:

- the actor root is valid
- embedded class/subclass/items/spells/features are valid
- those embedded items contain the real activities and effects that gameplay needs

That means compatibility is mostly determined by:

- spells
- weapons
- consumables
- class features
- subclass features
- feats

It is **not** primarily determined by:

- `actor.system.attributes.prof`
- `actor.system.details.level`
- `actor.system.skills.*`

Those fields matter, but they are not what DAE or Midi automate against first.

## What Dauligor Should Export For DAE/Midi-Safe Characters

### Actor shell

The actor still needs the normal data:

- name
- type
- abilities
- HP/current state
- traits
- biography

But that is only the wrapper.

### Embedded items

The actor needs embedded:

- class items
- subclass items
- spells
- features
- items and equipment

### Activities

Wherever a runtime action exists, the item should have native `system.activities`.

Examples:

- spell cast activities
- weapon attack activities
- healing activities
- save activities
- utility activities
- summon activities
- enchant activities
- transform activities

### Effects

Wherever a persistent or applied effect exists, the item should have native Active Effects.

Examples:

- temporary buffs
- toggled effects
- concentration-linked effects
- on-hit rider effects
- ongoing debuffs

## The Most Important Design Rule

If a behavior matters at runtime, prefer:

- native `system.activities`
- native `effects`

and only then:

- DAE enhancements
- Midi enhancements

This keeps Dauligor aligned with stock `dnd5e`, while still letting DAE and Midi work.

## What References Need To Do

DAE and Midi both rely heavily on actor roll data and effect expression evaluation.

That means character support depends on correct reference normalization.

Dauligor should keep authoring semantic references from:

- [reference-syntax-guide.md](E:/DnD/Professional/Webpage/module/dauligor-pairing/docs/reference-syntax-guide.md)

Examples:

- `@prof`
- `@ability.cha.mod`
- `@attr.hp.max`
- `@class.sorcerer.level`
- `@class.sorcerer.hit-die`
- `@scale.sorcerer.sorcery-points`

The module should normalize those into native Foundry paths before the final item/effect is used.

This matters because DAE and Midi evaluate:

- actor roll data
- item roll data
- workflow data
- target data

If Dauligor leaves those references in a semantic-only form that Foundry cannot resolve, the effect or automation will not behave correctly.

## What Items And Spells Need In Particular

### Items

Items should not just be descriptive documents.

For DAE/Midi-safe behavior, an item should carry:

- native item identity and system data
- `system.activities` when it can be used
- `effects` when it applies or grants effects
- optional `flags.midi-qol.*` or `flags.dae.*` only when the item really needs them

### Spells

Spells especially should carry:

- native spell metadata
- native cast and rider activities
- effects where appropriate
- correct durations, targets, and scaling
- optional overtime or automation flags only when the spell genuinely needs them

## What The Module Should Not Do

The module should not:

- require DAE-only fields for baseline import
- require Midi-only fields for baseline import
- replace native `dnd5e` data with a Midi-only model
- invent Active Effects only for DAE if the semantic export never intended an effect

The correct order is:

1. build valid native `dnd5e` data
2. layer optional DAE/Midi support on top

## What We Should Treat As First-Wave Support

For Dauligor character creation, the safest first-wave DAE/Midi support target is:

- native item/spell/feature activities
- native item/spell/feature effects
- semantic references normalized to native Foundry roll-data paths
- no special automation assumptions on the actor shell

This is enough to make characters increasingly compatible without designing the whole system around one automation module.

## Recommended Documentation Pairing

Use this guide together with:

- [reference-syntax-guide.md](E:/DnD/Professional/Webpage/module/dauligor-pairing/docs/reference-syntax-guide.md)
- [class-feature-activity-contract.md](E:/DnD/Professional/Webpage/module/dauligor-pairing/docs/class-feature-activity-contract.md)
- [item-import-contract.md](E:/DnD/Professional/Webpage/module/dauligor-pairing/docs/item-import-contract.md)
- [spell-import-contract.md](E:/DnD/Professional/Webpage/module/dauligor-pairing/docs/spell-import-contract.md)
- [midi-qol-compatibility.md](E:/DnD/Professional/Webpage/module/dauligor-pairing/docs/midi-qol-compatibility.md)

## Bottom Line

To make Dauligor characters support DAE and Midi-QOL:

- build correct native items first
- give those items real activities
- give them real effects when needed
- normalize semantic references into native Foundry formulas
- add DAE or Midi flags only where the behavior truly requires them

That gives us the best chance of supporting:

- stock `dnd5e`
- DAE
- Midi-QOL

without hard-coding the entire character system to one automation stack.

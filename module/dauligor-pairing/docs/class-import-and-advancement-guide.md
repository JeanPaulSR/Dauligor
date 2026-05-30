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


## Contents

Detailed material is split into parts under [`class-import-and-advancement/`](class-import-and-advancement/):

- [Description Text, Modes & Identity](class-import-and-advancement/text-and-modes.md)
- [Class, Subclass & Feature Item Shapes](class-import-and-advancement/class-and-feature-shapes.md)
- [Advancement Model & Supported Types](class-import-and-advancement/advancement-types.md) — HitPoints, Trait, ScaleValue, ItemGrant
- [Import Sequence & Checklists](class-import-and-advancement/import-sequence-checklists.md)

Scope, the Core Mental Model, and the Two Import Targets orient you first.

## Scope

This guide covers:

- class import into the world library
- class import directly onto an actor
- subclass selection as part of class import
- advancement persistence on embedded actor class items
- how the class item should support a character creator or later level-up flow

This guide does not yet finalize:

- starting equipment automation
- non-class feat importing
- general item importing

> Spell-selection automation is now built (the importer's spell step + the class/source
> spell-list endpoints), so it is no longer an open item here.

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
- actor import now distinguishes fresh class import, same-class level-up, and secondary-class multiclass import
- ability score improvements are surfaced through a custom Dauligor ASI app (`DauligorAbilityScoreImprovementApp`) after import when the gained levels cross an ASI row — not the native `dnd5e` AdvancementManager

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
- ASI choices collected through the custom Dauligor ASI app (`DauligorAbilityScoreImprovementApp`) when the imported class levels cross `AbilityScoreImprovement` advancements (not the native `dnd5e` AdvancementManager)

This is the mode the Dauligor character creator should care about most.


## Related Documents

- `docs/class-import-endpoint-notes.md`
- `docs/class-import-contract.md`
- `docs/class-semantic-export-notes.md`
- `docs/class-feature-activity-contract.md`
- `docs/source-library-contract.md`


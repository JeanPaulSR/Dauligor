# Foundry Inputs Required By Spell Manager

This note lists the native Foundry data the Dauligor spell preparation manager needs in order to function correctly.

This is intentionally narrow.

It does not define app-side spell list payloads.

## Purpose

The spell manager depends on two sources:

1. Foundry
   - current actor state
   - current spell item state
   - native rest events
2. Dauligor
   - class or subclass spell availability
   - tags
   - favorites before import
   - list behavior metadata

This note only covers the Foundry side.

## Related Documents

- [spell-preparation-manager-guide.md](E:/DnD/Professional/Webpage/module/dauligor-pairing/docs/spell-preparation-manager-guide.md)
- [actor-spell-flag-schema.md](E:/DnD/Professional/Webpage/module/dauligor-pairing/docs/actor-spell-flag-schema.md)
- [character-class-import-guide.md](E:/DnD/Professional/Webpage/module/dauligor-pairing/docs/character-class-import-guide.md)

## Required Foundry Inputs

### Actor identity

The manager needs the actor itself:

- `Actor`
- expected type:
  - `character`

## Embedded class items

The manager needs the actor's class items.

Minimum fields:

- `actor.classes`
- class `identifier`
- class `system.levels`
- class `system.spellcasting.progression`
- class `system.spellcasting.ability`
- class `system.spellcasting.preparation`

Purpose:

- determine which classes the actor actually has
- determine spellcasting class behavior
- determine which class sections should appear in the UI

## Embedded subclass items

The manager needs subclass identity when subclass-owned spell lists matter.

Minimum fields:

- subclass `identifier`
- subclass `system.classIdentifier`

Purpose:

- determine which subclass-specific spell lists or sections apply

## Spellcasting class view

The manager should use Foundry's computed spellcasting class view when available.

Native field:

- `actor.spellcastingClasses`

Purpose:

- determine which classes on the actor are spellcasting classes
- determine the active spellcasting ability
- determine preparation-related information for sheet summaries

## Embedded spell items

The manager needs the actor's current spell items.

Query:

- actor items where:
  - `type === "spell"`

Minimum fields:

- `name`
- `system.level`
- `system.school`
- `system.method`
- `system.prepared`
- `system.sourceItem`
- `system.activities`
- `effects`
- `flags.dauligor-pairing`

Purpose:

- determine which spells are already imported
- determine which spells are prepared
- determine which class owns each imported spell
- render spell details and action state

## Native preparation state

The manager relies on Foundry's preparation state, not a parallel Dauligor prepared flag.

Native field:

- `spell.system.prepared`

Meaning:

- `0`
  - unprepared
- `1`
  - prepared
- `2`
  - always prepared

Purpose:

- render prepared status
- toggle prepared state
- compute prepared counts

## Native spell source ownership

The manager needs native spell-to-class ownership.

Native field:

- `spell.system.sourceItem`

Purpose:

- determine which class or subclass item granted or owns the spell
- reconcile actor spells against class-owned spell sections

Preferred resolution:

1. native `system.sourceItem`
2. native owning actor class or subclass item
3. Dauligor spell flags

## Native class identifier on spell items

When available, the manager should use Foundry's resolved spell class identity.

Native resolved property:

- `spell.system.classIdentifier`

Purpose:

- group spell items under the correct class section
- avoid guessing from spell name or source text

## Long rest completion

The manager needs a long-rest completion event if it should prompt the player after rest.

Hook:

- `Hooks.on("dnd5e.restCompleted", ...)`

Purpose:

- reopen or offer the spell manager after a long rest
- allow prepared spell review
- allow known-spell replacement if home rules permit it

## Optional Foundry Inputs

These are not strictly required for the first pass, but they improve the manager.

### Actor favorites

If Dauligor chooses to mirror quick-access state into Foundry favorites later, the manager may inspect:

- `actor.system.favorites`

This should not replace Dauligor spell favorites.

### Spellcasting ability summaries

The stock sheet computes class spellcasting summaries from:

- `actor.spellcastingClasses`
- actor abilities
- class or subclass spellcasting metadata

The manager can reuse those computed values for the right-hand summary panel.

### Existing actor spell flags

The manager can use:

- `flags.dauligor-pairing.favorite`
- `flags.dauligor-pairing.folderId`
- `flags.dauligor-pairing.folderLabel`
- `flags.dauligor-pairing.tags`

to render Dauligor-specific organization.

## What Foundry Does Not Provide

Foundry does not provide the full Dauligor-side spell availability model.

It does not tell us:

- all spells a class could choose from
- Dauligor app tags before import
- app-side favorites before import
- home-rule replacement policies
- app-side spell list ids

Those must come from Dauligor.

## Summary

Foundry provides the module with:

- the actor
- class and subclass ownership
- current spell items
- current prepared state
- source ownership for imported spells
- rest completion hooks

Dauligor provides:

- spell availability
- semantic spell lists
- tags
- favorites
- replacement rules

# Dauligor Class Import Contract

This document defines the class-focused payloads that `dauligor-pairing` should receive from the Dauligor app.

For the detailed behavior guide covering:

- world import versus actor import
- embedded class advancement persistence
- HP, skills, ItemGrant, and character-creator expectations

see:

- `docs/class-import-and-advancement-guide.md`

Scope for this version:

- classes
- class-specific features
- class advancement

Out of scope for this version:

- non-class feats
- inventory/items
- starting **equipment** choice automation (the equipment step is a deliberate stub, omitted from the import sequence)

> **Built since this list was first written:** spell-list selection (the spell step is wired —
> `runSpellSelectionStep` + the class/source spell-list endpoints) and **proficiency choice
> automation** (skill / tool / trait selection via `runSkillSelectionStep` / `runToolSelectionStep` /
> `runTraitSelectionStep` + `CharacterUpdater`) are now implemented. Only *starting equipment*
> remains out of scope.

The goal is simple:

1. Dauligor sends stable, semantic JSON.
2. The Foundry module resolves that JSON into `dnd5e` `5.3.1` world items (the version our games
   run; broader `5.x` compatibility is welcome but unverified and not a priority).
3. The app never needs to know Foundry world UUIDs in advance.


## Contents

Detailed material is split into parts under [`class-import-contract/`](class-import-contract/):

- [Identity, Sync Metadata, Descriptions & Feature Types](class-import-contract/identity-and-metadata.md)
- [Transport Model & Payloads](class-import-contract/transport-and-payloads.md) — catalog + preferred detail payloads
- [Advancement Contract](class-import-contract/advancement-contract.md) — supported advancement types and their shapes
- [Import Behavior & Legacy Payloads](class-import-contract/import-behavior.md)

The accepted payload families, spellcasting note, import targets, and summary stay in this index.

## Accepted Detail Payload Families

The importer now understands two detail-payload styles for classes:

1. `dauligor.class-bundle.v1`
2. the semantic full-export shape documented in:
   - `docs/class-semantic-export-notes.md`

The normalized bundle is still the cleanest transport for a strict contract.

The semantic full export is now supported so the app can ship one richer class payload and let the Foundry module perform the final normalization step.

## Native Spellcasting Note

Current `dnd5e` class and subclass documents no longer store a class-level `system.spellcasting.preparation.mode` field.

For imported classes and subclasses, the module should normalize semantic spellcasting into the native item shape:

```json
{
  "system": {
    "spellcasting": {
      "progression": "full",
      "ability": "wis",
      "preparation": {
        "formula": "@abilities.wis.mod + @classes.druid.levels"
      }
    }
  }
}
```

Important:

- `system.spellcasting.progression` should stay native: `none`, `full`, `half`, `third`, `pact`, or `artificer`
- `system.spellcasting.ability` should use lowercase Foundry ability keys such as `wis` or `cha`
- `system.spellcasting.preparation` should only carry native fields, currently `formula`
- prepared-caster formulas must be real Foundry formulas, not display text like `WIS + Level`
- semantic spellcasting metadata such as ritual-caster status or progression type identifiers should stay in module flags, not in native `system.spellcasting`

## Import Targets

The module now supports two distinct import targets for classes:

1. Sidebar import:
   - imports into the Foundry world item library
   - creates or updates the class item and bundled class-feature items in world items

2. Actor-sheet import:
   - never creates or updates world items
   - runs a sequenced Foundry-side import flow for the destination actor
   - prompts for the ending class level, HP handling, skill choices, subclass choices, and option-group choices only when those steps apply
   - embeds the class directly on the actor at that level
   - embeds only the class features granted at or below that level
   - removes previously imported higher-level class features for that same class when they are no longer needed

Actor-import note:

- importer-only choices like `hpMode` or a custom HP roll formula are local Foundry UI state
- Dauligor should not send those fields in the endpoint payload

Current actor-import progression rules:

- if the actor has no copy of the class yet and no other classes, import as a primary/base class
- if the actor already has the same class, import only the newly gained class/subclass features for levels above the current class level
- if the actor does not yet have the class but already has another class, use `class.multiclassProficiencies` instead of the primary class proficiency profile
- if an embedded class item was first imported in multiclass mode, later reimports and level-ups keep that multiclass proficiency mode


## Summary

For classes, the app-to-module contract should be:

- fetch a class catalog
- fetch one class bundle
- class bundle contains one Foundry-like `classItem`
- class bundle contains zero or more Foundry-like `classFeatures`
- `ItemGrant` advancements reference `classFeatures` by `sourceId`
- the Foundry module resolves those references into real UUIDs during import


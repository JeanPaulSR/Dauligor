# Dauligor Import Contract Index

This is the master map for the documentation set.

Use it to answer two questions first:

1. Which document is the source of truth for this subject?
2. Which documents are only scoped notes, handoff notes, or research support?

The goal of this index is to keep the heavy material in a small number of canonical files and keep the rest of the set narrow.

## How The Set Is Organized

The documentation now falls into four layers:

1. Canonical contracts and behavior guides
   - the main documents to implement against
2. Scoped notes
   - narrow summaries for one surface, one audience, or one handoff
3. Research and corpus docs
   - evidence, background, and capture plans
4. App-team notes
   - direct correction notes for the Dauligor app side

If a scoped note and a canonical guide disagree, follow the canonical guide.

## Canonical Documents

These are the files that should be treated as the primary references.

### Classes, subclasses, and advancement

- `docs/class-import-contract.md`
  - canonical transport contract for classes
  - payload families, identity model, import targets, and required class-facing data
- `docs/class-import-and-advancement-guide.md`
  - canonical behavior guide for class import, actor import, level-up, and character-creator expectations
- `docs/advancement-construction-guide.md`
  - canonical native `dnd5e` advancement guide
  - where each advancement type belongs and how it should persist
- `docs/advancement-and-activity-implementation-guide.md`
  - canonical gap list for what still needs to change in the app or module for native advancements and native feature activities

### Feature activities

- `docs/class-feature-activity-contract.md`
  - canonical contract for feature items and their activities
  - use this for accepted activity fields, activity substructures, and item-side runtime behavior

### Characters

- `docs/character-class-import-guide.md`
  - canonical class-driven character import guide
  - what belongs on the actor root versus embedded class/subclass items versus advancement state
- `docs/actor-import-contract.md`
  - canonical generic actor transport contract
  - use this only when the question is broader than class-driven characters

### References

- `docs/reference-syntax-guide.md`
  - canonical semantic reference grammar
  - what Dauligor should author and store
- `docs/class-reference-surface.md`
  - canonical native class and scale reference surface
  - what `dnd5e` already understands directly

### Sources and linked content

- `docs/source-library-contract.md`
  - canonical source-library file contract
  - source list, source detail, linked family catalog, and per-document payload layout

### Other import families

- `docs/item-import-contract.md`
  - canonical item import contract
- `docs/spell-import-contract.md`
  - canonical spell import contract
- `docs/spell-preparation-manager-guide.md`
  - canonical spell preparation and spell-list management guide
  - use this for the Dauligor-managed spell selector, favorites, folders, long-rest behavior, and class-grouped spell handling
- `docs/actor-spell-flag-schema.md`
  - canonical actor spell flag schema
  - use this for the exact `flags.dauligor-pairing` structure on actor-owned spell items
- `docs/feat-import-contract.md`
  - canonical feat import contract
- `docs/journal-import-contract.md`
  - canonical journal import contract

### Automation compatibility

- `docs/dae-midi-character-support.md`
  - canonical DAE/Midi support direction
  - use this for the broad rule set around characters, items, spells, activities, effects, and automation compatibility

## Scoped Notes

These are intentionally narrower. They are useful, but they should not duplicate the full contract.

- `docs/class-import-endpoint-notes.md`
  - short handoff for class endpoint shape only
- `docs/class-semantic-export-notes.md`
  - narrow note for the semantic full-class export shape and what the generalized class normalizer reads from it
- `docs/foundry-spell-manager-inputs.md`
  - narrow note for the native Foundry actor, class, spell, and rest data the spell manager depends on
- `docs/midi-qol-compatibility.md`
  - Midi-only note
  - use this when the question is specifically about Midi behavior rather than the full DAE/Midi stack
- `docs/where-to-look-guide.md`
  - quick route map
  - use this when someone wants to know what to read first, not when they need the full contract

## Research And Corpus Docs

These are support material, not the primary contract.

- `docs/foundry-dnd5e-reference.md`
  - local research summary for Foundry and `dnd5e`
- `docs/google-doc-synthesis.md`
  - synthesis from the broader Google Doc research
- `docs/schema-crosswalk.md`
  - crosswalk between Dauligor concepts and Foundry structures
- `docs/feature-activity-corpus-plan.md`
  - corpus capture status and remaining gaps for activity families
- `docs/agent-research-playbook.md`
  - workflow guide for future research passes
- `docs/corpus/catalog.md`
- `docs/corpus/capture-template.md`

## App-Team Notes

These live outside `docs/` because they are correction notes rather than long-term contracts.

- `notes-for-app-team/index.md`
  - note index
- `notes-for-app-team/correcting-advancemnts.md`
- `notes-for-app-team/correcting-activities.md`
- `notes-for-app-team/correcting-character-creation.md`

## Reading Paths

Use these reading paths instead of jumping randomly between files.

### A. Class export and class import

Read in this order:

1. `docs/class-import-contract.md`
2. `docs/class-semantic-export-notes.md`
3. `docs/class-import-and-advancement-guide.md`
4. `docs/advancement-construction-guide.md`
5. `docs/source-library-contract.md`

### B. Feature activities

Read in this order:

1. `docs/class-feature-activity-contract.md`
2. `docs/feature-activity-corpus-plan.md`
3. `docs/advancement-and-activity-implementation-guide.md`

### C. Spell preparation and spell list UX

Read in this order:

1. `docs/spell-import-contract.md`
2. `docs/spell-preparation-manager-guide.md`
3. `docs/actor-spell-flag-schema.md`
4. `docs/foundry-spell-manager-inputs.md`
5. `docs/character-class-import-guide.md`
6. `docs/reference-syntax-guide.md`

### D. Character creation driven by classes

Read in this order:

1. `docs/character-class-import-guide.md`
2. `docs/class-import-and-advancement-guide.md`
3. `docs/advancement-construction-guide.md`
4. `docs/reference-syntax-guide.md`

### E. References and formulas

Read in this order:

1. `docs/reference-syntax-guide.md`
2. `docs/class-reference-surface.md`
3. `docs/foundry-dnd5e-reference.md`

### F. DAE and Midi support

Read in this order:

1. `docs/dae-midi-character-support.md`
2. `docs/midi-qol-compatibility.md`
3. `docs/class-feature-activity-contract.md`
4. `docs/item-import-contract.md`
5. `docs/spell-import-contract.md`

## What Not To Use As Your First Stop

These are useful, but they should not be the first file you open unless the question is very narrow:

- `docs/where-to-look-guide.md`
  - use only for navigation
- `docs/midi-qol-compatibility.md`
  - too narrow to stand in for the broader DAE/Midi guide
- `docs/class-import-endpoint-notes.md`
  - endpoint-only handoff, not the full class contract
- `docs/class-reference-surface.md`
  - native reference surface only, not the semantic grammar

## Maintenance Rule

When adding new docs:

1. decide whether the file is canonical, scoped, research, or an app-team note
2. add it to the correct section above
3. avoid restating material that already belongs in a canonical doc
4. if a new doc starts repeating a canonical file, trim it back to its narrow scope

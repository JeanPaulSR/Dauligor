# Notes For App Team

These notes are not the full long-term contract set.

They are focused correction notes for the Dauligor app side and are meant to sit next to the canonical docs in `docs/`.

Use them when the question is:

- what do we need to change on the app side?
- what is wrong with the current authoring/export direction?
- what should we stop doing versus keep doing?

## Current Notes

- `notes-for-app-team/correcting-advancemnts.md`
  - findings on how class and subclass advancements should be handled
  - where the current authoring model differs from the Foundry-aligned direction
- `notes-for-app-team/correcting-activities.md`
  - findings on the semantic activity pipeline, missing editor coverage, and module expectations
- `notes-for-app-team/correcting-character-creation.md`
  - findings on the current character export direction, what fields should be authoritative, and how class-driven character state should be exported
- `notes-for-app-team/foundry-advancement-window-schematics.md`
  - layout schematics for Foundry `dnd5e` advancement tabs, editors, and player-facing flow windows
  - intended as a website UI reference, not a data contract

## Read These Alongside The Notes

The notes assume the canonical docs still exist underneath them.

Most useful companion docs:

- `docs/class-import-contract.md`
- `docs/class-import-and-advancement-guide.md`
- `docs/advancement-construction-guide.md`
- `docs/class-feature-activity-contract.md`
- `docs/character-class-import-guide.md`
- `docs/reference-syntax-guide.md`

## Maintenance Rule

If a correction note grows into a general contract, move that durable material into `docs/` and leave the note focused on:

- the problem
- the current mismatch
- the direction of change

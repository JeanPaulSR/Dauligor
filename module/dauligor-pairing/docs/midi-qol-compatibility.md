# Midi-QOL Compatibility Notes

This is the Midi-only companion to:

- `docs/dae-midi-character-support.md`

Use this file when the question is specifically:

- what does Midi-QOL need from imported items?
- how should imported activities behave so Midi can use them?
- which design rules should the importer follow so Midi remains an enhancement layer instead of a dependency?

For the broader DAE + Midi picture, use:

- `docs/dae-midi-character-support.md`

## Short Version

- Midi-QOL v13 is activity-centric.
- It expects native `dnd5e` `system.activities`.
- Imported items should be `dnd5e`-native first.
- Midi-specific fields should be layered on only after the base activity works in stock `dnd5e`.

## What Midi Cares About Most

Midi gets the most value from:

- real `system.activities`
- valid item data
- valid effects when the feature or item applies one
- stable activity identifiers when activities need to reference each other

Midi gets much less value from:

- descriptive item text alone
- actor-root data without usable activities

## Design Rules

1. Build native `dnd5e` activities first.
2. Keep activity identifiers stable.
3. Treat Midi support as metadata on top of a working native activity.
4. Do not build the importer around Midi-only settings.
5. Test imported activities with Midi's replacement-activities option off.

## Safe Import Target

The safe target for a Midi-friendly import is:

- native `system.activities`
- native `effects` where needed
- normalized formulas and references
- optional `flags.midi-qol.*` only where the source behavior actually needs them

## Current Dauligor Rule

Dauligor should not export a separate Midi-only runtime model.

The preferred stack remains:

1. semantic Dauligor export
2. module builds native `dnd5e` items and activities
3. Midi enhances those native activities

## Related Documents

- `docs/dae-midi-character-support.md`
- `docs/class-feature-activity-contract.md`
- `docs/item-import-contract.md`
- `docs/spell-import-contract.md`
- `docs/reference-syntax-guide.md`

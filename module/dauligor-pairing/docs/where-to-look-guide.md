# Dauligor Where-To-Look Guide

This file is a route map only.

Use it when someone asks:

- what should I read first?
- which file is the source of truth for this subject?

For the full organization of the entire set, use:

- `docs/import-contract-index.md`

## 1. Class Feature Activities

Read in this order:

1. `docs/class-feature-activity-contract.md`
2. `docs/feature-activity-corpus-plan.md`
3. `docs/advancement-and-activity-implementation-guide.md`

If you need local evidence after that:

- `E:/DnD/Professional/Foundry-JSON/features/`

## 2. References And Formulas

Read in this order:

1. `docs/reference-syntax-guide.md`
2. `docs/class-reference-surface.md`
3. `docs/foundry-dnd5e-reference.md`

If you need the actual module behavior:

- `scripts/reference-service.js`

## 3. Class Export, Linking, And Advancements

Read in this order:

1. `docs/class-import-contract.md`
2. `docs/class-semantic-export-notes.md`
3. `docs/class-import-and-advancement-guide.md`
4. `docs/advancement-construction-guide.md`
5. `docs/source-library-contract.md`

## 4. Character Creation Driven By Classes

Read in this order:

1. `docs/character-class-import-guide.md`
2. `docs/class-import-and-advancement-guide.md`
3. `docs/advancement-construction-guide.md`
4. `docs/reference-syntax-guide.md`

## 5. DAE And Midi Support

Read in this order:

1. `docs/dae-midi-character-support.md`
2. `docs/midi-qol-compatibility.md`
3. `docs/item-import-contract.md`
4. `docs/spell-import-contract.md`
5. `docs/class-feature-activity-contract.md`

## 6. Rendering Descriptions And References In The UI

When a UI surface (character creator, browsers, sheets) needs to render a stored
description (class / feature / feat / background / species) as display HTML, do
NOT re-implement a BBCode / markdown / HTML converter or title-case slugs into
names. Reuse:

1. `scripts/class-import-service.js` → `normalizeHtmlBlock(value)` (exported) —
   the single description → HTML transform. Detects HTML / BBCode / markdown /
   plain text and returns Foundry-ready HTML. HTML passes through, BUT BBCode
   embedded inside HTML is still converted in place — the website authors tables
   as `[table]…[/table]` (and the odd inline `[i]`) even inside otherwise-HTML
   descriptions, so a naive "looks like HTML → return as-is" would render that
   BBCode literally. The tag replacements live in `applyBbcodeTags()` (shared by
   the escaped+wrapped path and the in-place `convertBbcodeTagsInHtml()`).
2. `scripts/importer-base-features.js` → `formatFoundryLabel(slug)` (exported) —
   resolves a trait slug/key to its REAL display name via `CONFIG.DND5E`
   (skills, abilities, armor/weapon/tool profs, languages, damage types,
   conditions) with a fallback table. Use this for reference keys.
3. Reference normalization (semantic → native Foundry): `scripts/reference-service.js`
   and `docs/reference-syntax-guide.md`.

Reference consumer: `renderDescription` in `scripts/character-creator-app.js`
(`normalizeHtmlBlock` + `formatFoundryLabel` cross-ref resolution + a light
sanitize/cruft-trim). Mirror that pattern; don't fork a new converter.

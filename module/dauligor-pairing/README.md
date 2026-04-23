# Dauligor Pairing

Starter Foundry VTT v13 module for connecting the Dauligor app to `dnd5e` `5.3.1`.

This foundation focuses on five things:

1. Exporting real Foundry documents so you can study their shape.
2. Exporting a world snapshot containing classes, subclasses, monsters, items, journals, and more.
3. Importing simple test JSON onto a character sheet.
4. Browsing and importing bundled class fixtures through a Plutonium-inspired wizard plus class-browser flow.
5. Documenting the practical data expectations for `dnd5e` and the Dauligor class contract.

## Documentation

Start here:

- `docs/import-contract-index.md`

Canonical docs:

- `docs/class-import-contract.md`
- `docs/class-import-and-advancement-guide.md`
- `docs/advancement-construction-guide.md`
- `docs/advancement-and-activity-implementation-guide.md`
- `docs/class-feature-activity-contract.md`
- `docs/character-class-import-guide.md`
- `docs/reference-syntax-guide.md`
- `docs/source-library-contract.md`
- `docs/item-import-contract.md`
- `docs/spell-import-contract.md`
- `docs/spell-preparation-manager-guide.md`
- `docs/actor-spell-flag-schema.md`
- `docs/foundry-spell-manager-inputs.md`
- `docs/feat-import-contract.md`
- `docs/journal-import-contract.md`
- `docs/actor-import-contract.md`
- `docs/dae-midi-character-support.md`

Scoped notes:

- `docs/class-import-endpoint-notes.md`
- `docs/class-semantic-export-notes.md`
- `docs/class-reference-surface.md`
- `docs/midi-qol-compatibility.md`
- `docs/where-to-look-guide.md`

Research and corpus:

- `docs/google-doc-synthesis.md`
- `docs/foundry-dnd5e-reference.md`
- `docs/schema-crosswalk.md`
- `docs/feature-activity-corpus-plan.md`
- `docs/agent-research-playbook.md`
- `docs/corpus/catalog.md`
- `docs/corpus/capture-template.md`

App-team notes:

- `notes-for-app-team/index.md`

## Included files

- `scripts/main.js`
  - hook registration and UI controls
- `scripts/export-service.js`
  - document export, research bundle export, and world snapshot export
- `scripts/import-service.js`
  - test URL import and item upsert logic
- `scripts/reference-service.js`
  - semantic reference normalization for formulas, prose lookups, scales, and UUID links
- `scripts/class-import-service.js`
  - class catalog browser and world-item class import logic
- `scripts/importer-app.js`
  - import wizard shell, class browser window, and launch helpers
- `data/sample-character.json`
  - minimal bundled payload for import testing
- `data/classes/catalog.json`
  - bundled local class catalog used by the Foundry importer browser
- `data/sources/catalog.json`
  - local source-library index used by the import wizard source step
- `data/classes/sorcerer-bundle.json`
  - preferred `dauligor.class-bundle.v1` sample payload
- `data/classes/sorcerer-semantic-export.json`
  - semantic full-export sample consumed by the generalized class normalizer
- `data/sources/players-handbook/source.json`
  - sample source detail document matching the app-style source page
- `data/sources/players-handbook/classes/catalog.json`
  - sample source-scoped class catalog for one source
- `data/sources/players-handbook/classes/sorcerer.json`
  - sample source-scoped semantic class payload
- `docs/foundry-dnd5e-reference.md`
  - schema notes for future Dauligor mapping work
- `docs/import-contract-index.md`
  - master map for the documentation set
- `docs/class-import-contract.md`
  - canonical class transport contract
- `docs/class-import-and-advancement-guide.md`
  - canonical class behavior guide for world import, actor import, level-up, and character creation
- `docs/advancement-construction-guide.md`
  - canonical native `dnd5e` advancement guide
- `docs/advancement-and-activity-implementation-guide.md`
  - implementation checklist for finishing native advancements and feature activities
- `docs/class-import-endpoint-notes.md`
  - short endpoint-only handoff note for class payloads
- `docs/class-semantic-export-notes.md`
  - semantic full-export note for the generalized class normalizer
- `docs/class-feature-activity-contract.md`
  - canonical feature-item and activity contract
- `docs/feature-activity-corpus-plan.md`
  - corpus status and remaining evidence gaps for activity families
- `docs/source-library-contract.md`
  - canonical source-library file contract
- `docs/actor-import-contract.md`
  - generic actor transport contract
- `docs/character-class-import-guide.md`
  - canonical class-driven character import guide
- `docs/reference-syntax-guide.md`
  - canonical semantic reference grammar
- `docs/class-reference-surface.md`
  - native class and scale reference surface in `dnd5e`
- `docs/dae-midi-character-support.md`
  - canonical DAE/Midi support direction
- `docs/midi-qol-compatibility.md`
  - narrow Midi-only note
- `docs/where-to-look-guide.md`
  - quick route map into the heavier docs
- `notes-for-app-team/index.md`
  - app-team note index
- `docs/item-import-contract.md`
  - target item contract for weapons, armor, consumables, loot, and related item families
- `docs/spell-import-contract.md`
  - target spell contract with behavior-oriented spell data expectations
- `docs/spell-preparation-manager-guide.md`
  - canonical spell preparation and spell list management guide
- `docs/actor-spell-flag-schema.md`
  - canonical actor spell flag schema for native actor-owned spell items
- `docs/foundry-spell-manager-inputs.md`
  - narrow note for the Foundry-side actor, class, spell, and rest data the spell manager reads from
- `docs/feat-import-contract.md`
  - target feat contract for general feats and class-feature-style feat items
- `docs/journal-import-contract.md`
  - target journal contract for lore and reference entry imports

## Current controls

### Import wizard

- three-column wizard:
  - `Import Type`
  - `Source Type`
  - `Import Options`
- bottom-right actions:
  - `Cancel`
  - `Open Importer`

Opening the class importer launches a dedicated class browser with:

- search
- tag filter
- class cards grouped by class
- nested subclasses
- single-class radio selection
- a follow-up class options workflow for actor imports

### Settings sidebar

- `Dauligor Tools`
  - `Open Importer`
  - `Open Launcher`
- launcher action:
  - `Import Classes`
  - `Export World Snapshot`
  - `Export World Research`

### Item sheet header

- `Dauligor Import`
- `Export JSON`
- `Export Research`

### Actor sheet header

- `Dauligor Level Up`
- `Dauligor Import`
- `Dauligor Options`
- `Export JSON`
- `Export Research`
- `Import URL`
- `Import Sample`

`Dauligor Level Up` appears on character sheets which already contain a Dauligor class. It opens the importer in actor mode, preselects the matching class entry, and targets the next class level. `Dauligor Import` is available on actor sheets generally. `Import URL` and `Import Sample` remain character-only.

### Actor tools hub

- `Prepare Spells`
  - first-pass manager for current actor spell items
  - groups spells by class and spell level
  - supports favorite toggling, folder assignment, and native prepared-state toggling
- `Item Cleaner`
  - under construction
- `Polymorpher`
  - under construction
- `Show Players`
  - under construction

### Actor sheet spells tab

- `Dauligor Prepare Spells`
  - opens the same first-pass spell manager directly from the native `dnd5e` spells tab

### Sidebar directories

- actors sidebar:
  - `Dauligor Import`
  - `Dauligor Launcher`
- items sidebar:
  - `Dauligor Import`
  - `Dauligor Launcher`

### Directory context menus

- actors: `Dauligor: Export Actor JSON`
- actors: `Dauligor: Export Actor Research`
- items: `Dauligor: Export Item JSON`
- items: `Dauligor: Export Item Research`
- journals: `Dauligor: Export Journal JSON`
- journals: `Dauligor: Export Journal Research`

## Install

Copy this folder into your Foundry modules directory as:

`FoundryVTT/Data/modules/dauligor-pairing`

## Test flow

1. Enable the module.
2. Open Settings and click `Dauligor`.
3. Export a world snapshot and inspect the downloaded JSON.
4. Export a world research snapshot and inspect how activities, advancements, and effects are summarized.
5. Open the importer from Settings, a character sheet, or the Actor/Item sidebar.
6. In the wizard, choose `Classes & Subclasses`, `SRD`, and open the class importer.
7. Import the bundled Sorcerer class from the class browser.
8. Reopen the class browser and confirm the semantic/full-export-backed Sorcerer data is grouped under the same class card.
9. Open an item or actor sheet and click `Export Research`.
10. Open a character sheet and click `Import Sample`.
11. Open the same character and verify the sample feat and sample loot item were added.
12. Open a local endpoint and use `Import URL`.
13. Open a character with an imported Dauligor class and click `Dauligor Level Up`.

## Local endpoint testing

The module simply uses `fetch(url)`.

Examples:

- `http://127.0.0.1:3000/sample-character.json`
- `http://localhost:3000/sample-character.json`

Any endpoint should return JSON with one of these shapes:

- `dauligor.character.v1`
- `dauligor.item.v1`
- direct Foundry-like item JSON with `type` and `system`

## Notes

This is intentionally a starter foundation, not a full Plutonium-like importer yet.

The current importer is deliberately conservative:

- it updates actor root data
- it upserts embedded items by `flags.dauligor-pairing.sourceId`
- it can now open a reusable import wizard from settings, sheets, and sidebar directories
- the wizard now separates import type, source type, and import options before opening a specific importer
- the wizard now reads class-capable sources from `data/sources/catalog.json` instead of a hardcoded SRD row
- class browsing now happens in a dedicated class browser window with search, tag filtering, and nested subclasses
- actor-side class imports now open a class options workflow for subclass choice, unique option groups, HP mode, and spell placeholders
- it can now import class items into the world from a catalog-driven browser
- it can now normalize Dauligor semantic full class exports into the internal class-bundle flow
- the semantic/full Dauligor class export is now the preferred class-browser variant when multiple fixtures exist for the same class
- it preserves stable actor-side advancement identity through `flags.dauligor-pairing.advancementIdMap`
- it resolves `ItemGrant` references from `sourceId` when using `dauligor.class-bundle.v1`
- it now uses a Dauligor-driven actor level-up flow rather than relying on native `dnd5e` to fetch external class features
- it now relinks actor-side granted class features back to `dnd5e` advancement rows after import, following the same general pattern Plutonium uses
- it still does not yet attempt full subclass automation or spell-list import

The exporter is now more research-oriented:

- raw JSON export remains available
- research bundle export adds summaries for activities, advancement, and active effects
- world research export is meant to support corpus building for future schema work

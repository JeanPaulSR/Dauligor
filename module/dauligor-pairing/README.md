# Dauligor Pairing

Foundry VTT **v13** bridge module connecting the Dauligor app to `dnd5e` **5.3.1** (the version our
games run; broader `5.x` is welcome but unverified and not a priority).

The module is the **consumer** side of the project: the Dauligor web app builds and serves semantic
JSON at `/api/module/*`, and this module fetches it and imports it into Foundry (classes,
subclasses, features, advancements, activities, spells, feats). It also exports Foundry documents
back out as research bundles for corpus building.

It does five things today:

1. Imports classes & subclasses (world + actor) through a Plutonium-inspired wizard + class browser,
   building native `dnd5e` advancements and activities.
2. Imports spells via a standalone Spell Browser (multi-select) and manages preparation through the
   Prepare Spells manager.
3. Imports feats via a feat browser; manages post-import option-group swaps + long-rest changes
   through the Feature Manager.
4. Ships an opt-in alt character sheet with per-class spell sections + folders.
5. Exports Foundry documents / world snapshots / research bundles as JSON.

> **Current-state overview:** [`docs/_drafts/module-current-state-2026-05-30.html`](docs/_drafts/module-current-state-2026-05-30.html)
> is the developer-facing snapshot of what is built vs deferred. The backlog lives in [`TODO.md`](TODO.md).

## Documentation

Start here:

- [`docs/import-contract-index.md`](docs/import-contract-index.md) — master map of the doc set.

Canonical contracts & guides:

- `docs/class-import-contract.md`, `docs/class-import-and-advancement-guide.md`,
  `docs/advancement-construction-guide.md`, `docs/advancement-and-activity-implementation-guide.md`,
  `docs/class-feature-activity-contract.md`, `docs/character-class-import-guide.md`
- `docs/spell-import-contract.md`, `docs/spell-preparation-manager-guide.md`,
  `docs/actor-spell-flag-schema.md`, `docs/foundry-spell-manager-inputs.md`
- `docs/feat-import-contract.md`, `docs/item-import-contract.md`, `docs/journal-import-contract.md`,
  `docs/actor-import-contract.md`
- `docs/reference-syntax-guide.md`, `docs/source-library-contract.md`, `docs/property-mapping.md`,
  `docs/dae-midi-character-support.md`, `docs/dauligor-character-sheet.md`

Doc convention: **Markdown contracts are the detailed source of truth for agents**; HTML files
under `docs/_drafts/` are developer overviews. Several contract docs carry a status banner noting
which parts are shipped vs planned — trust the banner over older body text.

## Scripts (`scripts/`)

| File | Role |
|---|---|
| `main.js` | Module entry point (only declared esmodule). Registers all hooks, settings, keybinding, UI controls, the long-rest intercept, and the libWrapper image patch. |
| `class-import-service.js` | Class normalization + import engine (4 payload families; world + actor; native advancements + activities; custom ASI app; deterministic ids). |
| `importer-app.js` | Import wizard shell, class browser, subclass preview, the sequenced actor-import flow, and the shared option-group picker. |
| `importer-base-features.js` | Assembles the 11 base advancement rows (HP/saves/proficiencies); multiclass proficiency overlay. |
| `importer-utils.js` | Small importer helpers (level clamp, id normalization, slugify, html summarize). |
| `foundry-id.js` | Deterministic Foundry `_id` from `SHA-256(moduleId:sourceId)` + per-session cache. |
| `requirements-walker.js` | Evaluates compound requirement trees (`all`/`any`/`one`) against actor state. |
| `update-character.js` | `CharacterUpdater` — batches actor-root proficiency/trait/HP changes into one update. |
| `spell-preparation-app.js` | `DauligorSpellPreparationApp` (prep manager) + `DauligorSpellBrowserApp` (multi-select Spell Browser). |
| `spell-points-service.js` | Optional `dnd5e-spellpoints` compatibility offer. |
| `feat-browser-app.js` | `DauligorFeatBrowserApp` — feat pool browser + verbatim import. |
| `feature-manager-app.js` | `DauligorFeatureManagerApp` — Overview / Features / Spells tabs + long-rest deferred-mutation queue. |
| `dauligor-character-sheet.js` | Opt-in alt character sheet; per-class spell sections + folders + cross-class drag-drop gating. |
| `export-service.js` | Document / research / world-snapshot / folder exports (Foundry → JSON). |
| `import-service.js` | Test-harness import (URL / sample) + socketlib handler. |
| `reference-service.js` | Semantic reference normalization (formulas, prose lookups, scales, UUID links). |
| `section-filter-panel.js` | Shared tri-state filter UI (port of the web app's panel). |
| `gm-app.js` | GM console — placeholder shell. |
| `constants.js`, `utils.js` | Module id / settings keys / paths; logging, downloads, dialogs. |

## Current controls

### Import wizard
Three-column wizard: **Import Type** (`Classes & Subclasses`, `Spells`, `Items` (planned),
`Feats` (planned)) → **Source Type** (filtered by `supportedImportTypes`) → **Import Options**.
Bottom-right: `Cancel`, `Open Importer`.

- **Classes & Subclasses** → dedicated class browser: search, tag filter, class cards with nested
  subclasses, single-class selection, and (for actor imports) the sequenced options workflow
  (subclass, HP mode, option groups, spell selection).
- **Spells** → standalone Spell Browser: merges every selected source's pool, level-banded, with a
  3-state Select-All chip and an "Add N to Sheet" batch import into the alt sheet's "Other Spells"
  bucket.

### Settings
World settings: `defaultImportUrl`, `defaultClassCatalogUrl`, `defaultClassFolderPath`,
`apiEndpointMode` (`local` → `localhost:3000` / `production` → `www.dauligor.com`). GM keybinding:
"Open Dauligor Importer" (unbound by default).

### Sheet & directory controls
- **Actor sheet header menu** (GM): `Dauligor Level Up` (only when the actor has a Dauligor class),
  `Dauligor Import`, `Dauligor Options`.
- **Actor sheet rest bar**: Feature Manager button (characters).
- **Native spells tab**: per-class Prepare button + a global Prepare button.
- **Settings app header**: Dauligor launcher icon. **Scene controls** (GM): Dauligor GM Console.
- **Settings config form** (GM): Dauligor Tools → Open Importer / Open Options.
- **Actor directory sidebar** (GM): Dauligor Import, Export Actor Folder, Open Options.
- **Item directory sidebar** (GM): Dauligor Import, Export Spell/Feat/Item Folder, Open Options.
- **Alt sheet context menus**: Move to Section / Move to Folder; section & folder add/rename/delete.

### Launcher & Actor Tools hub
- Launcher: Import; Actor Tools; Character Creator\*; HP Gain Behavior\*; Spell Points Behavior;
  Loot Generator\*; Equipment Shop\*.
- Actor Tools hub: Item Cleaner\*, Prepare Spells, Feature Manager, Polymorpher\*, Show Players\*.

\* = under-construction placeholder dialog.

## Bundled data (`data/`)

- `data/sources/catalog.json` — source-library index used by the import wizard's source step.
- `data/sources/<source>/` for `phb`, `tce`, `scag`, `xge`, `dsotdq`, `rj`, `uah`, `vrgr` — each with
  `source.json` + `{bestiary,classes,items,journals,spells}/catalog.json`. Individual class JSONs
  exist for `phb` (barbarian, bard, cleric, druid, sorcerer) and `tce` (artificer).
- `data/dauligor_artificer_full_export.json` — a full semantic class-export sample.
- `data/sources.zip` — zipped copy of the sources tree.

Research corpus lives under `docs/corpus/` (source-side 5etools captures + templates).

## Install

Copy this folder into your Foundry modules directory as
`FoundryVTT/Data/modules/dauligor-pairing`.

### Live development sync (recommended for module work)

Replace the copy with a directory junction (Windows) / symlink (macOS/Linux) so repo edits are
picked up on reload without re-copying. **Agents: check whether the junction already exists before
copying** — if it does, editing the repo source is enough.

Windows (PowerShell):

```powershell
$src = "<repo-or-worktree-root>\module\dauligor-pairing"
$dst = "$env:LOCALAPPDATA\FoundryVTT\Data\modules\dauligor-pairing"
if (Test-Path $dst) { Rename-Item $dst "$($dst).bak-$(Get-Date -Format yyyyMMdd-HHmmss)" }
cmd /c mklink /J $dst $src
```

Verify what an existing install points at:

```powershell
Get-Item "$env:LOCALAPPDATA\FoundryVTT\Data\modules\dauligor-pairing" |
  Select-Object FullName, LinkType, Target
```

Caveats when the junction targets a git worktree: switching branches in the linked location changes
what Foundry sees on next reload; removing the worktree leaves the junction dangling (re-point it);
module settings live in the world's settings DB, so deleting/recreating the junction is safe.

**Required modules:** `lib-wrapper` (verified 1.13.4.0), `socketlib` (verified 1.1.3).

## Test flow

1. Enable the module (and lib-wrapper + socketlib). Set `apiEndpointMode` to `local` for a local app.
2. Open the importer (Settings → Dauligor launcher, an actor/item sheet header, or a sidebar button).
3. Choose **Classes & Subclasses** → a class-capable source → Open Importer; import a class from the
   class browser; confirm advancements + activities on the resulting class item.
4. On a character, use **Dauligor Import** (then **Dauligor Level Up** on a later level) and walk the
   sequenced options workflow.
5. Choose **Spells** → pick sources → multi-select in the Spell Browser → "Add N to Sheet".
6. Open **Prepare Spells** (Actor Tools hub, the spells-tab button, or embedded in the Feature
   Manager) and toggle preparation / favorites.
7. Open the **Feature Manager**, swap an option-group pick, and take a long rest to commit queued
   spell changes.
8. From the Item/Actor sidebar, use the **Export … Folder** buttons and inspect the JSON.

## Local endpoint testing

The module uses `fetch(url)`. Examples: `http://127.0.0.1:3000/sample-character.json`. Any URL used
with the test-import path should return JSON of kind `dauligor.character.v1`, `dauligor.item.v1`, or
a bare Foundry-like item (`type` + `system`).

## Notes

This is a maturing module, not yet a full Plutonium-class importer. The class import path is the
most complete (native advancements + activity normalization + custom ASI flow + deterministic ids +
multiclass handling). Known gaps live in [`TODO.md`](TODO.md): native `ItemChoice` synthesis from
option groups, prep-manager virtual folders, the placeholder Feature Manager tabs, real
item/actor/journal importers, and runtime weapon-property display-name resolution.

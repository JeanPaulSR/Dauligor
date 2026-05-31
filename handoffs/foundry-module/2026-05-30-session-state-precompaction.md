# foundry-module — session handoff (pre-compaction, 2026-05-30)

Comprehensive pickup state for the `foundry-module` branch. Read this + the
[manifest](manifest.md) first. Companion: agent memory `project_foundry_module_branch`.

## Branch identity

- **`foundry-module`** = sole steward of `module/dauligor-pairing/` (the FoundryVTT v13 + dnd5e
  module that consumes the app's `/api/module/*` export bundles). Off `origin/main`.
- **Jointly owns** (owner-granted) the Phase-2 viewer files with `system-applications`:
  `scripts/dauligor-viewer.js`, `scripts/enrichers/**`, `templates/dauligor-viewer.hbs`,
  `styles/dauligor-viewer.css`. `scripts/main.js` is append-only shared with that branch.
- dnd5e target pinned to **5.3.1** in docs (module.json `system` left unpinned so other 5.x loads).

## ⚠️ Two operational gotchas (learned the hard way)

1. **The local Foundry junction points at THIS worktree** (owner-granted). If a successor takes over
   the branch in a different worktree, **repoint it** (`cmd /c rmdir` the link, then `mklink /J`) —
   recipe in [manifest.md](manifest.md) "Local Foundry junction". It dangles if this worktree is removed.
2. **Changing `module.json` (`styles`/`esmodules`) needs a FULL Foundry restart** (Return to Setup →
   relaunch), NOT a world reload (F5). Foundry caches the manifest. The CSS split scared us into a
   near-rollback when really the old manifest was just cached pointing at the deleted single
   stylesheet. Always full-restart after editing module.json.

## ‼️ I CANNOT test in Foundry — these need an owner eyeball

All recent code/CSS changes are logic-verified + syntax-checked, but not run in a live world. To verify:
- **Import overview** (commit 76f1de3): first-level shows all base advancements; same-class level-up
  shows only HP; multiclass shows the reduced profile.
- **Option exclusions** (4a9b2a1): excluded options (e.g. Arcane Warrior in Blood Hunter's Alternate
  Fighting Style) no longer appear in the picker.
- **Proficiency category display** (5180004): overview shows "Simple Weapons" / "Light Armor" /
  "Artisan's Tools" instead of every expanded item (saves & skill-choices still list individually).
- **CSS** (the split + dedup, commits f6b1ec0…fd716ed): all windows render correctly; check narrow
  widths (responsive.css loads last) + the embedded spell manager + subclass-preview/option-picker
  detail panes (now the shared `.dauligor-detail` component).

## What shipped this session (all committed on the branch)

1. **Documentation reconciliation pass** — corrected stale class/spell/feat docs; added "shipped vs
   planned" status banners; rewrote `actor-spell-flag-schema.md` to the real endpoint-read model;
   rewrote `README.md`; fixed broken cross-ref links; **split the 4 longest contracts into indexed
   sibling folders** (class-feature-activity/, advancement-construction/, class-import-and-advancement/,
   class-import-contract/); added **`docs/styles-guide.md`** (CSS component finder).
2. **Export-first (Foundry → app, for data shapes)** — `export-service.js` gained background, race,
   and **creature** folder exporters (`dauligor.foundry-{background,race,creature}-folder-export.v1`),
   wired to sidebar buttons. Contracts in `docs/{background-race,creature}-folder-export-contract.md`.
   The **bg/race IMPORT** side was built earlier (feat browser routes by `featType`); creature import
   deferred until the app has a creatures table.
3. **CSS overhaul** — split monolithic `dauligor-importer.css` (7,228 L) into **15 per-area files**
   (tokens/base first, responsive last) wired in `module.json`; unified buttons; defined the phantom
   accent-tint tokens; deduped the detail pane into shared `.dauligor-detail` (CSS + JS markup rename
   in importer-app.js + feature-manager-app.js). See `docs/styles-guide.md`.
4. **Bug fixes** — import-overview mode gating; option `excludedOptionIds` filtering
   (`buildOptionGroupExclusions` in class-import-service.js, all 3 option-build paths); proficiency
   category-name display.
5. **Deleted the bundled offline data** (`data/sources/`, `sources.zip`,
   `dauligor_artificer_full_export.json`) — stale mirror; module reads live `/api/module/*` (R2-backed,
   cheap). Local cache is a future low-priority idea (TODO "Local data cache").

## Verified facts worth keeping

- **Multiclass proficiencies** flow correctly: module reads `class.multiclassProficiencies`
  (`getSemanticClassData` → `payload.class` for semantic exports) and overlays it. The BUNDLED Bard
  fixture was stale (no Light Armor, skill choiceCount 0); the **live bake is correct** (Light Armor
  via `categoryIds:["light"]`, skill choose 1, instrument choose 1). Live is authoritative.
- The live `/api/module/*` endpoints are reachable from this env at both
  `http://localhost:3000` (dev server running) and `https://www.dauligor.com`.

## Top open follow-ups (full list in `module/dauligor-pairing/TODO.md`)

- **bg/race**: round-trip verification once the app's dedicated bg/race table lands; reply already
  sent to `compendium-editors` (incoming request checked off in manifest).
- **creatures**: build the `dauligor.creature-actor.v1` importer when the app exposes a creatures
  table (export side already done; module bundle-shape preferences sent in the reply doc).
- **requirements-walker**: entity-prereq leaves (class/subclass/feature/spell) are advisory/non-blocking
  — prereq-gated options aren't actually blocked (needs export to remap refs to sourceIds + walker to
  evaluate). Distinct from the exclusion fix.
- **dead bundled-file constants** now that `data/` is gone: `SOURCE_LIBRARY_FILE`, `CLASS_CATALOG_FILE`,
  `SAMPLE_FILE`, the "Import Sample" button, `serve-sample.ps1`, `defaultClassCatalogUrl` default.
- **UI polish (needs Foundry eyeball)**: merge the two near-identical accent golds; rename the
  "badge" that's really a tag; prep-manager virtual folders; feat ItemChoice/swap flows; references
  gaps; runtime property-mapping; physical doc-split (done) vs. further modularization.

## Coordination

- `compendium-editors`: bg/race incoming request DONE; reply +
  creature-bundle preferences in `2026-05-30-reply-to-compendium-editors-bg-race.md`. They added the
  bg/race route arms to `functions/api/module/[[path]].ts` (on their branch, not yet on `main`) — the
  bg/race endpoints go live for the module when they merge.
- `system-applications`: joint viewer ownership recorded; coordinate before touching the viewer files.

## Uncommitted at handoff time

The bundled-data deletion + README/TODO/explainer edits + this handoff are committed together in the
final commit of the session (see git log on `foundry-module`). Tree should be clean after that.

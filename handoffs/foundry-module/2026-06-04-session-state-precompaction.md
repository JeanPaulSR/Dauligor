# foundry-module — session handoff (pre-compaction, 2026-06-04)

Pickup state for the `foundry-module` branch after the **Character Creator + class-preview** work.
Read this + [manifest.md](manifest.md) first. Companion: agent memory `project_foundry_module_branch`.
The older pre-compaction handoff [2026-05-30-session-state-precompaction.md](2026-05-30-session-state-precompaction.md)
covers the doc-reconciliation / CSS-split / bg-race-export era before this.

## Git state (at handoff)

- Branch `foundry-module` is **0 behind / 1 ahead** of `origin/main`.
- The 1 ahead = **`175fce8`** `feat(module): class picker preview replicates the updated ClassView page` — **not on main yet** (module-only; doesn't affect prod). Everything else from this session **is on main**.
- Untracked: `module/dauligor-pairing/docs/_drafts/where-we-left-off-2026-06-02.html` (a reader-facing resume brief; committed alongside this handoff).
- `main = production` (Cloudflare Pages auto-deploys). **Always `git fetch` + show `git log origin/main..HEAD` and ASK before pushing.**

## What shipped this session

All on `main` unless noted. Pushed once at `326b351`; then `origin/main` moved ~43 commits
(compendium-editors' species/backgrounds tables + auth) and we **fast-forwarded** cleanly.

1. **Character Creator — radial-hub redesign** (`scripts/character-creator-app.js`,
   `templates/character-creator-shell.hbs`, `styles/character-creator.css`). Replaced the launcher's
   "under construction" stub. Two tabs: **Create** (an SVG **wheel** — center = Ability Scores;
   wedges = Class / Species / Background / Starting Feat / Image; click a wedge → that section
   replaces the wheel, with Back-to-hub) and **Character** (review + **Build Character** in the
   footer → existing apply + class-importer hand-off). "Species" = 2024 label over **race** data.
   - **Ability Scores**: Point Buy (32 budget / 8–16) + a **shared world roll pool** (`ability-roll-pool.js`):
     4d6kh3 sets, non-GM rolls relay to GM via socketlib (`initRollPoolSocket` in import-service),
     DM manual add/clear, world-setting `abilityRollPool` synced via `…rollPoolChanged` hook.
   - **Starting Feat + Image wedges are STUBBED** (open a "coming soon" panel).
2. **Styled launcher** (`scripts/launcher-app.js`, `templates/launcher-shell.hbs`, `styles/launcher.css`) —
   replaced the plain `DialogV2` "Dauligor Options" + "Actor Tools" hubs with one house-styled tile
   menu. Tiles are `<div role="button">` (not `<button>` — see gotcha). Reached from `main.js`
   `openLauncher` / `openActorToolsHub`.
3. **Rich class preview**, twice:
   - First a port of the app's **ClassPreviewPane** modal (header + level table + proficiencies + subclasses + tags + spell slots).
   - Then (commit `175fce8`, **branch-only**) reworked into a port of the app's **updated class VIEW page**
     (`src/pages/compendium/ClassView.tsx`): header + progression table + a **tabbed bottom**
     (Features / Subclass / Spell List / Info / Flavor) + **subclass picker** + **Core Traits sidebar**,
     in the picker's side preview pane.
4. **Spell-slot chart endpoint** (cross-branch, owner-authorized, **on main/prod**) — new
   `GET /api/module/spellcasting/multiclass-chart.json` (builder `api/_lib/_spellcastingChart.ts` reads
   the `multiclass_master_chart` D1 record) + an append-only route arm in
   `functions/api/module/[[path]].ts`. Handoff to its owners:
   [2026-06-02-to-compendium-editors-spellcasting-chart.md](2026-06-02-to-compendium-editors-spellcasting-chart.md).
5. **Dedup + docs** — moved class-advancement parsing into `class-import-service.js`
   (`getClassFeatureLabelsByLevel`); proficiencies reuse `baseClassHandler` + `formatFoundryLabel`.
   Documented the **AppV2 "Window model"** in `docs/styles-guide.md` (the hard-won launcher lesson).

## ‼️ Needs an owner Foundry eyeball — NOTHING here has run in a live world

All logic-/syntax-checked only. To verify (full restart — `module.json` changed → not just F5):
- Options window + Actor Tools (tile grid sizing).
- Character Creator wheel (proportions, wedge→panel→back, consistent background) + roll pool (2 clients for the GM relay).
- **Class preview** (`175fce8`): it's a lot of content in the side pane — width/readability is the open question; tabs + horizontal-scroll table keep it bounded, but the full-width-takeover layout is a quick switch if it's cramped.

## How the class preview pulls data (for resuming this work)

The class bundle `/api/module/<source>/classes/<class>.json` has **no `kind` wrapper** — top-level
`class`, `subclasses`, `features`, `scalingColumns`, `spellsKnownScalings`,
`alternativeSpellcastingScalings`, `source`.
- **Features-by-level (table)**: from `class.advancements` via `getClassFeatureLabelsByLevel()` (robust — works even when `features[]` is empty, e.g. wizard).
- **Feature cards (Features/Subclass tabs)**: from `bundle.features` — `featureKind:"classFeature"` (link `parentSourceId === class.classSourceId`) + subclass features (`parentSourceId === subclass.sourceId`). Descriptions present for many classes (barbarian: 15 with text) but **NOT all** (wizard: empty → tab shows "see the table").
- **Spell slots**: `effectiveCastingLevel(level, spellcasting.progressionFormula)` + `slotsForEffectiveLevel(eff, masterChart)` where masterChart = the new endpoint (cached in `this._spellChart`). Cantrips/spells-known + pact slots come straight from the bundle. Subclass casters (EK/AT): `_effectiveSpellcasting` falls back to the subclass's spellcasting.
- **Proficiencies / Core Traits**: `baseClassHandler({ payload: { class: c } })` + `formatFoundryLabel` (no parallel parse).
- **Spell List tab**: `fetchClassSpellList(chosen.bundleUrl)` (class-import-service), grouped by `flags['dauligor-pairing'].level`.

## Open / next (owner's call)

- **Push `175fce8` to main** once eyeballed (module-only, safe).
- **Spell-slot columns** depend on the chart endpoint serving: compendium-editors must **reload their dev server** (they own localhost:3000); it's already on prod.
- **Build the stubbed Starting Feat + Image** wheel sections.
- **Species/Background richer previews** — compendium-editors just shipped real species/backgrounds tables + export builders (`_speciesOptionExport`, `_backgroundFeatureExport`) + route arms (pulled into main). Re-check those shapes before wiring; natural next feature.
- Backlog (TODO.md): bg/race round-trip, creature importer, dead bundled-file constants.

## Coordination

- **compendium-editors**: own the router (`functions/api/module/[[path]].ts`, append-only) + `api/_lib` + the local dev server. They have the spellcasting-chart handoff. Their species/backgrounds work is now on main.
- **dauligor-applications** (renamed from `system-applications`): joint owner of the Phase-2 viewer files; coordinate before touching them.

## Gotchas (learned the hard way)

- **Window model** (every Dauligor window): fixed NUMERIC `position` height (never `"auto"`), `dauligor-importer-app` + `dauligor-importer-window` content classes, shell `height:100%`+`min-height:0` fill-down chain, shared content-box paints `--dauligor-panel`. New window ⇒ register as a token root in `tokens.css`. See `docs/styles-guide.md` "Window model".
- **Tiles/multi-child clickables**: use `<div role="button">`, not `<button>` (Foundry/dnd5e element-level button styling collapses multi-child flex layouts).
- `module.json` styles/esmodules change ⇒ **full Foundry restart**, not F5.
- The Foundry **junction points at THIS worktree** (repoint on takeover — recipe in manifest).
- `new Function` formula eval in `effectiveCastingLevel` is charset/identifier-whitelisted (trusted DB content).
- Minor date drift: a couple of docs are stamped `2026-06-02`; the real current date is `2026-06-04`.

# Handoff — `compendium-editors`: push Backgrounds (+ proficiency refactor) to main

> **Date:** 2026-06-03 · **Branch:** `compendium-editors` · **Worktree:**
> `E:\DnD\Professional\Dev\Dauligor\.claude\worktrees\nostalgic-lamport-76d78d`
> Continues [2026-06-02-species-backgrounds-features-resume.md](2026-06-02-species-backgrounds-features-resume.md).
> **Purpose of THIS handoff:** full context to land the Backgrounds work on `main` (production).

## TL;DR

A long session built Backgrounds out to "done" (view page, structured proficiencies, prerequisites,
features + Foundry export) and **refactored the class proficiency UI into a shared component that both
the class editor and background editor now use**. None of this session's work is committed yet. The
goal now is to **rebase onto the updated `main` and push** (= live deploy), after applying the
**8 local-only D1 migrations to the remote DB**.

- Branch **10 ahead / 21 behind `origin/main`**, merge-base `d583d6a`. **26 uncommitted files.**
- `main`'s 21 commits are **all foundry-module work** (Character Creator/launcher) + **one new app
  endpoint** (`/api/module/spellcasting/multiclass-chart.json`). **Low conflict risk.**
- **Exactly ONE rebase conflict expected:** `functions/api/module/[[path]].ts` (both sides added a
  route arm + import — keep both).
- **8 migrations are LOCAL-ONLY** and must hit remote D1 **before** the deploy or the live code 500s.
- `npx tsc --noEmit` = **6 errors (pre-existing baseline)** — verify against 6, not 0.
- ⚠️ **The class-editor grid swap is UNVERIFIED by click-test** — do that before pushing (production editor).

---

## Push runbook (do in this order)

> Per [feedback_main_is_production_deploy]: **push to main = live deploy.** Get an explicit, in-session
> go-ahead before the push AND (separately) before each remote migration (AGENTS.md rule #7 — a prior
> go-ahead does NOT transfer).

**0. Pre-flight**
- `git fetch origin` (always, before asserting status).
- Confirm `git log --oneline origin/main..HEAD` shows the 10 prior commits (below).

**1. Commit this session's work** (26 uncommitted files; see inventory). Either one commit
   (`feat(compendium): Backgrounds — proficiencies, features, prerequisites, Foundry export + shared
   proficiency refactor`) or a few logical commits (grouping suggested in the inventory). Commit footer:
   `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. **Do NOT stage
   `.claude/scheduled_tasks.lock`** (it shows ` D`; it blocks rebase — see step 2).

**2. Rebase onto `origin/main`** (`git rebase origin/main`).
   - The deleted `.claude/scheduled_tasks.lock` blocks rebase → `git stash push -- .claude/scheduled_tasks.lock`
     first, rebase, then `git stash pop`.
   - **Expected conflict (1 file):** `functions/api/module/[[path]].ts`. Both branches added a live
     route arm + an import. **Resolution:** keep BOTH `import { buildSpellcastingChartBundle } …`
     (main) and `import { buildBackgroundFeatureItemBundle } …` (ours), and BOTH `else if` route arms
     (the `spellcasting/multiclass-chart.json` arm and the `background-features/<id>.json` arm). They're
     independent.
   - Everything else is disjoint (main = `module/dauligor-pairing/*` + `api/_lib/_spellcastingChart.ts`
     [new file]; ours = `src/pages/compendium/*`, `src/lib/background*`, `src/lib/proficiencySelection.ts`,
     `api/_lib/_background*`, `worker/migrations/20260602-*`).

**3. Verify post-rebase:** `npx tsc --noEmit` ⇒ **6** (baseline). Restart the dev stack and **click-test the
   class editor** (see Caveats).

**4. Apply the 8 migrations to REMOTE D1** (explicit go-ahead first). From `worker/`:
   `npx wrangler d1 execute dauligor-db --remote --file=migrations/<name>.sql` — **in date order**:
   ```
   20260601-1200_backgrounds_species_tables.sql        (backgrounds + species tables)
   20260601-1300_user_species_background_favorites.sql (favorites tables)
   20260601-1400_background_features.sql               (background_features table)
   20260601-1500_species_features.sql                  (species_features table)
   20260602-1200_backgrounds_prerequisite.sql          (backgrounds.prerequisite)
   20260602-1300_backgrounds_proficiencies.sql         (backgrounds.proficiencies)
   20260602-1400_backgrounds_prerequisite_tree.sql     (backgrounds.prerequisiteTree)
   20260602-1500_background_features_parent.sql         (background_features.parentBackgroundId + index)
   ```
   The 1200–1500 (2026-06-01) set is **committed** (in the 10 ahead); the 2026-06-02 set is **untracked**
   (commit it in step 1). All 8 are remote-pending. (Each `ALTER`/`CREATE` is idempotent-ish — they use
   `IF NOT EXISTS` for tables/indexes; the `ADD COLUMN`s are not, so don't double-run.)

**5. Push to main** (explicit ask) → Cloudflare Pages auto-deploys. Migrations MUST be applied first
   (step 4) so the deployed code doesn't query missing columns.

**6. Post-deploy smoke test (remote):**
   - `GET /api/module/backgrounds/<id>.json` → 200, has `system.advancement` Trait entries + `features[]`.
   - `GET /api/module/background-features/<id>.json` → 200.
   - Open `/compendium/backgrounds` (prod) → detail renders; `/compendium/backgrounds/manage` tabs work.
   - **Repopulate:** existing background rows render via the prose fallback until **purged + re-imported**
     (Settings → Maintenance → purge Backgrounds, then the editor's Foundry-Import workbench) so the
     structured `proficiencies` fill. Remote backgrounds table is EMPTY at first (tables just created), so
     a fresh import is needed regardless.

---

## What this branch carries (feature inventory)

**Committed (10 commits, prior session — `b7c2cb1`…`f8806d9`):** dedicated `species` + `backgrounds`
tables, Foundry importers, public browse/view pages, per-user favorites, `background_features` +
`species_features` content types + `CompendiumFeatureEditor`, choosable ability-score increases, native-auth
alignment, import-window FilterBar/detail polish. (See the prior handoff.)

**Uncommitted (this session):**
1. **Backgrounds view page** — `SpeciesBackgroundBrowser` `SBDetail` rebuilt feat-style (art+name left,
   source+favorite right; proficiency summary section; description; bottom source citation). `FeatDetailPanel`
   got the matching bottom-source line.
2. **`cleanFoundryHtml` fix** (`foundryHtmlCleanup.ts`) — added a `slug{Display}` mop-up so leftover
   `&Reference[…]{Display}` / `@type[…]{Display}` enricher braces resolve to the label. **Shared — also
   improves feat/spell/item display + import.** Display path is `cleanFoundryHtml(bbcodeToHtml(bbcode))`.
3. **Maintenance purge cards** (`Settings.tsx`) — Feats / Species / Backgrounds (favorites cascade) for
   purge+reimport.
4. **Editor middle-column scroll** (`CompendiumEditorShell.tsx`) — the `fill` sub-tab layout now scrolls;
   the Basics description editor fills AND scrolls (`min-h-[260px]` floor).
5. **Structured proficiencies on the CLASS model** — `src/lib/proficiencySelection.ts` (shared helpers,
   lifted from ClassEditor) + `src/lib/backgroundProficiencies.ts` (background shape = `{skills, tools,
   languages}` each `{choiceCount, fixedIds, optionIds, categoryIds}`, ids = table ROW ids). Import fills it
   (`speciesBackgroundImport.ts` + workbench load vocab); display renders it (no per-render prose parse,
   prose fallback for un-reimported rows). **2024 ability-scores + origin feat were REMOVED** (2014 focus).
6. **Shared `ProficienciesEditor.tsx`** — promoted from a stub into the full grouped picker (flat
   skills/saves + grouped armor/weapons/tools/languages + **weapon Melee/Ranged pills** + display-name sync).
7. **Prerequisites via the feats `RequirementsEditor`** — `backgrounds.prerequisite` (free text) +
   `prerequisiteTree` (JSON), rendered with the shared `resolveDetailPrereq`.
8. **Editor tabs** — background editor now: Basics · Details (prereq + wealth + equipment) · **Proficiencies**
   (shared picker) · **Features** · Advancement · Scaling.
9. **Background Features authoring + Foundry export** — `BackgroundFeaturesTab.tsx` authors
   `background_features` OWNED by a background (`parentBackgroundId`). Export: `_backgroundFeatureExport.ts`
   (`/api/module/background-features/<id>.json`, a `feat`-type item with `system.type.value="background"`)
   + `_backgroundExport.ts` emits an `ItemGrant` per owned feature (Dauligor-internal `pool:[sourceId]`)
   and embeds the full items in the bundle's `features[]`.
10. **Background proficiency export** — `_backgroundExport.ts` maps the stored row ids → trait identifiers
    and emits dnd5e `Trait` advancements (skills/tools/languages; "any" choice → whole category).
11. **STEP 2: class editor migrated onto the shared component** — `ClassEditor.tsx` now imports the
    proficiency helpers from `proficiencySelection.ts` (local copies removed) AND both its grids (main
    `Proficiencies` + `Multiclass Proficiencies`) render `<ProficienciesEditor>` (~840 lines each replaced);
    the 5 dead grid helpers removed. **Export byte-identical by construction** (no change to `_classExport`,
    stored data, or the save-path derivation; the legacy `savingThrows` state is now vestigial/frozen — saved
    `saving_throws` already derives from `proficiencies.savingThrows.fixedIds`).

---

## ⚠️ Must verify / know before pushing

- **CLASS EDITOR CLICK-TEST (highest priority).** The two class proficiency grids were swapped to the shared
  component via a line-splice; `tsc` is clean but the UI wasn't click-tested. Open a class → **Proficiencies**
  and **Multiclass Proficiencies**: toggle fixed/option for every type, the **Melee/Ranged weapon pills**, the
  **display-name Sync** buttons, and **Save**. Data model + helpers are identical, so it should match — but
  this is the production class editor.
- **Foundry MODULE side is separate.** The background bundle's `features[]` + `ItemGrant` (pool matched by
  `flags.dauligor-pairing.sourceId`) and the Trait advancements need the **foundry-module** importer to
  consume them (mirrors class-feature grants). That's the `foundry-module` branch's job; the export side is
  done + self-describing.
- **Trait entry ids:** backgrounds store table ROW ids; export maps row id → identifier. Skills resolve to
  dnd5e keys (`his`); **tools/languages identifiers should be confirmed against the module via a live
  round-trip** (may need the class-style semantic-id normalization later).
- **Remote backgrounds/species tables start EMPTY** — content arrives by import. Re-import after deploy.

---

## Uncommitted file inventory (26)

**New libs/components/exports (untracked):**
- `src/lib/proficiencySelection.ts` — shared proficiency model + helpers (single source of truth).
- `src/lib/backgroundProficiencies.ts` — background proficiency shape, import-parse, display, `resolveBackgroundDisplay`.
- `src/lib/backgroundDetails.ts` — prose `[ul]` parser (import-only + legacy display fallback).
- `src/components/compendium/BackgroundProficiencies.tsx` — read-only proficiency lines renderer.
- `src/components/compendium/BackgroundFeaturesTab.tsx` — Features tab (authors `background_features`).
- `api/_lib/_backgroundFeatureExport.ts` — feature item builder + `/background-features/<id>.json` bundle.

**Modified:**
- `src/components/compendium/ProficienciesEditor.tsx` (stub → full shared picker + weapon pills)
- `src/components/compendium/CompendiumEditorShell.tsx` (fill-tab scroll)
- `src/components/compendium/FeatDetailPanel.tsx` (bottom source)
- `src/components/compendium/SpeciesBackgroundImportWorkbench.tsx` (load prof vocab → import-fill)
- `src/lib/foundryHtmlCleanup.ts` (slug{Display} mop-up — SHARED behaviour change)
- `src/lib/speciesBackgroundImport.ts` (build structured proficiencies on import)
- `src/lib/d1.ts` (jsonFields += proficiencies*/prerequisiteTree)
- `src/pages/compendium/SpeciesBackgroundEditor.tsx` (tabs, prereq, proficiencies, features wiring)
- `src/pages/compendium/SpeciesBackgroundBrowser.tsx` (rebuilt detail panel)
- `src/pages/compendium/ClassEditor.tsx` (**Step 2** — shared component + helper dedup)
- `src/pages/core/Settings.tsx` (Maintenance purge cards)
- `api/_lib/_backgroundExport.ts` (proficiencies→Trait + features→ItemGrant + `features[]`)
- `functions/api/module/[[path]].ts` (background-features route — **the rebase-conflict file**)

**Migrations (untracked):** `worker/migrations/20260602-{1200,1300,1400,1500}_*.sql` (see runbook step 4).

(Plus 3 pre-existing untracked drafts in `docs/_drafts/` — ignore.)

---

## Verification done this session (empirical)
- Proficiency import parse over **all 91 backgrounds**: 0 misses, skills 100% resolved; display via the class
  formatter ("History, Survival" / "1 of your choice from Navigator's tools, Cartographer's tools").
- Live export round-trips (local dev): `/api/module/backgrounds/<id>.json` → `Trait` advancements with row
  ids resolved to identifiers (`his`/`sur`/`cartographer`, languages "any" expanded); `/background-features/<id>.json`
  → valid `feat` item; background bundle carries the `ItemGrant` + `features[]`.
- `cleanFoundryHtml` regression suite: legit `@spell[…]{…}` refs preserved (not mangled), `{{handlebars}}` /
  spaced `{a, b}` not over-matched.
- Feature CRUD (FK insert by `parentBackgroundId` → filtered select → delete) round-trips on local D1.
- `tsc` = 6 baseline at every checkpoint, incl. after the class grid swap.
- **NOT done:** class-editor UI click-test; Foundry-module consumption of the bg export; remote migrations; commit; push.

---

## Constraints (preserve)
- **main = production**; push only with an explicit in-session ask; **`git fetch origin` before asserting status**.
- D1 migrations: **local first**; remote ONLY with an explicit, **migration-specific** go-ahead (rule #7).
- Never `INSERT OR REPLACE` (use `ON CONFLICT(id) DO UPDATE`).
- Never commit `.claude/scheduled_tasks.lock`; it blocks rebase → `git stash push --` that path, pop after.
- Don't add firebase/firestore imports gratuitously (auth is native `./auth`).
- Commit footer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

## Key file/component map (for resuming)
| Concern | File |
|---|---|
| Shared proficiency model + helpers | `src/lib/proficiencySelection.ts` |
| Shared proficiency picker (class + bg) | `src/components/compendium/ProficienciesEditor.tsx` |
| Background proficiency shape/import/display | `src/lib/backgroundProficiencies.ts` |
| Background editor (tabs) | `src/pages/compendium/SpeciesBackgroundEditor.tsx` |
| Background view | `src/pages/compendium/SpeciesBackgroundBrowser.tsx` |
| Background features tab | `src/components/compendium/BackgroundFeaturesTab.tsx` |
| Background export (+ proficiencies + feature grants) | `api/_lib/_backgroundExport.ts` |
| Feature export | `api/_lib/_backgroundFeatureExport.ts` |
| Module route (conflict file) | `functions/api/module/[[path]].ts` |
| Class editor (Step 2 migrated) | `src/pages/compendium/ClassEditor.tsx` |
| Enricher cleanup (shared) | `src/lib/foundryHtmlCleanup.ts` |

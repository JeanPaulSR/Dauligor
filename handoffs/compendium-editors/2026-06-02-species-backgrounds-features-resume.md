# Handoff — `compendium-editors`: Species + Backgrounds buildout (features epic)

> **Date:** 2026-06-02 · **Branch:** `compendium-editors` · **Worktree:**
> `E:\DnD\Professional\Dev\Dauligor\.claude\worktrees\nostalgic-lamport-76d78d`
> Continues [2026-06-01-species-backgrounds-tables-resume.md](2026-06-01-species-backgrounds-tables-resume.md).

## TL;DR

This session took Species + Backgrounds from "just dedicated tables" to nearly-complete compendium
entities, **plus** rebased onto a `main` that absorbed the Firebase-exit native-auth migration. Built:
dedicated tables → editors → Foundry importers → public browsers → per-user favorites → a dedicated
**features** content type (`background_features` + `species_features`) → choosable **ability-score
increases** for species → import-window polish. **9 commits on `compendium-editors`, NOT pushed.**

**The clear next step is the shared GRANT + EXPORT wiring** (let a background/species grant its
features via `ItemGrant`, + a feature export endpoint). See "Next milestones."

## Git / deploy state

- Branch **`compendium-editors`**, **9 ahead / 0 behind `origin/main`**, **NOT pushed**.
- Commits (oldest→newest):
  - `b7c2cb1` promote Species + Backgrounds to dedicated tables
  - `9698b5b` Foundry importers
  - `e712409` public browse/view pages
  - `111d755` per-user favorites
  - `1a7a2ee` background features content type + editor
  - `9dadeb7` species features + choosable ability-score increases
  - `fbf0e7d` align species/background favorites with native auth (post-main-rebase)
  - `1be1915` import window — drop advancements count + add Resolved filter
  - `6aa1828` import window uses shared FilterBar + feat-style detail
- Working tree clean **except**: `.claude/scheduled_tasks.lock` (harness — shows ` D`; **NEVER stage**;
  it **blocks `git rebase`** → `git stash push -- .claude/scheduled_tasks.lock` first, pop after) +
  3 untracked drafts in `docs/_drafts/` (keep or delete).
- `npx tsc --noEmit` baseline = **6 errors** (pre-existing: `Button asChild` in
  CompendiumBrowserShell / SpellList / LoreEditor + `characterShared.ts:520`). **Verify against 6, not 0.**
- **Migrations applied to LOCAL D1 ONLY** (remote pending; needs explicit, migration-specific
  in-conversation go-ahead per AGENTS.md rule #7):
  - `20260601-1200` species + backgrounds tables
  - `20260601-1300` user_species_favorites + user_background_favorites
  - `20260601-1400` background_features
  - `20260601-1500` species_features
  - `20260531-1200` users password columns — **main's auth migration**, also applied local.

## Locked decisions / architecture

- **camelCase columns** on all new tables. Editors/browsers read/write through `upsertDocument` /
  `fetchDocument` / `fetchCollection` (src/lib/d1.ts) **DIRECTLY — NO `normalizeCompendiumData` /
  `denormalizeCompendiumData`** (those are for the legacy snake_case tables). Only boundary rename:
  `tags` column ↔ `tagIds` form, done inline.
- **Plumbing:** `D1_TABLE_MAP` (src/lib/d1Tables.ts) has `backgrounds`, `species`,
  `backgroundFeatures`, `speciesFeatures`. `PERSISTENT_TABLES` (src/lib/d1.ts) has `backgrounds`,
  `species`, `background_features`, `species_features`. `queryD1` `jsonFields` adds
  `startingEquipment`/`movement`/`senses`/`creatureType` (tags/advancements/effects/uses/activities
  were already there).
- **Naming:** UI says **"Species"**; the Foundry export `type` stays **`"race"`**; the route stays
  `/compendium/races` (intentionally not renamed).
- **Favorites tables** (`user_*_favorites`) are **server-endpoint-only** (`executeD1QueryInternal`),
  so NOT in D1_TABLE_MAP / PERSISTENT_TABLES.
- **All surfaces are `kind`-keyed shared components** (`kind: 'species' | 'background'`, or
  `'background' | 'species'` for features) — mirrors how RaceEditor/BackgroundEditor wrap one editor.

## ⚠️ Auth migration context (READ before writing any auth-touching code)

`main` landed the **Firebase-exit native auth** (scrypt + Worker JWTs). `src/lib/firebase.ts` still
exports `auth`, but **`auth.currentUser` is `null` for native-session users.** Use the new
**`src/lib/auth.ts`** API:
- `getSessionToken(): Promise<string|null>`, `isAuthenticated(): boolean`,
- `getIdentity(): Identity|null` (`.uid`), `onAuthChange(cb): () => void` (subscribe).
- Server-side: `requireAuthenticatedUser` / `verifyEitherToken` (api/_lib/firebase-admin) accept
  native OR Firebase tokens during the migration window.

My favorites code was aligned to this in `fbf0e7d`. **Any NEW client code that needs the user/token
must use `./auth`, never `firebase.auth.currentUser`/`getIdToken`/`onAuthStateChanged`.**

## Component map

| Concern | File(s) | Notes |
|---|---|---|
| Entity editor | `src/pages/compendium/SpeciesBackgroundEditor.tsx` (kind) | Mounted by `RaceEditor.tsx`/`BackgroundEditor.tsx`. Pattern E (`CompendiumEditorShell`). Tabs: Basics · Traits(species)/Details(bg) · Advancement (`AdvancementManager` parentContext `race`/`background`) · Scaling · Tags. Foundry-Import mode (admin) = the workbench below. |
| Feature editor | `src/pages/compendium/CompendiumFeatureEditor.tsx` (kind) | Drives `background_features` + `species_features`. Routes `/compendium/{background,species}-features/manage`. Reached via the **"Features"** button in the browser header. Tabs: Basics · Effects · Tags. |
| Public browser | `src/pages/compendium/SpeciesBackgroundBrowser.tsx` (kind) | Mounted by `RacesList.tsx`/`BackgroundsList.tsx`. `CompendiumBrowserShell`. Search + Source axis (+ Creature Type for species), thumbnail in list, detail pane (`SBDetail`) + **Favorite** toggle + a "Features"/"Manager" link (admin). |
| Import workbench | `src/components/compendium/SpeciesBackgroundImportWorkbench.tsx` (kind) | Uses `<FilterBar>` + `<SectionFilterPanel>` (Source + Status axes) + feat-style detail panel. |
| Import lib | `src/lib/speciesBackgroundImport.ts` | `buildSpeciesBackgroundCandidates(kind, payload, label, sources, existing)`; `IMPORT_KIND_META`. |
| Favorites | `src/lib/speciesBackgroundFavorites.ts` (`useSpeciesBackgroundFavorites(kind, userId)`) + `functions/api/{species,background}-favorites.ts` (mounted in `server.ts` ~L375-376) | Native-auth; per-entity tables. |
| Exporters | `api/_lib/_raceExport.ts` + `_backgroundExport.ts` → share `api/_lib/_speciesBackgroundShared.ts` (`buildSpeciesBackgroundItem`) | Routes `/api/module/races/<id>.json` + `/api/module/backgrounds/<id>.json`. |
| Shared shell change | `CompendiumBrowserShell.tsx` gained an additive `hideFavorites` opt-out | The species/bg browsers now pass REAL favorites (don't use hideFavorites); the prop remains for future browsers. |

## Import behavior / gotchas

- **Images:** keep only **absolute** http(s) cdn art; Foundry-relative plutonium placeholders
  (`family-tree.svg`) → empty (they 404 off R2). ~236/280 species + 76/152 backgrounds have real art.
- **`&Reference[key=Value]`** 5etools enricher is resolved in the **shared** `src/lib/foundryHtmlCleanup.ts`
  (benefits feat/spell/item imports too).
- **Senses:** stored **FLAT** (`{darkvision,…,units,special}`); dnd5e nests under `.ranges` → importer
  flattens on read, `_raceExport` **re-nests** on export.
- **Server export path does NOT auto-parse JSON columns** (only the client `queryD1` does) →
  `_speciesBackgroundShared` runs `parseJsonField` on every JSON column. Remember this for any new
  server-side reader.
- **Source matching** is by book/rules vs the 40 local `sources`; many 5etools books (EEPC, MPMM,
  VGM, EFA…) won't match → import with `sourceId=''` (warned via the Status axis, not blocked).

## NEXT MILESTONES (remaining epic, in order)

1. **Grant + export (shared — the big next step).** Let a background/species **grant** its features.
   **DESIGN DECISION PENDING:** (a) extend `AdvancementManager`'s `ItemGrant` picker with an
   `availableBackgroundFeatures` / `availableSpeciesFeatures` source, OR (b) a dedicated "Features"
   section in `SpeciesBackgroundEditor` that manages `ItemGrant` advancements referencing the feature
   tables. Then a **feature export endpoint** (`/api/module/{background,species}-features/<id>.json`,
   mirroring `_featExport` / `_speciesBackgroundShared`) so the granted feature is a real Foundry item,
   and the bg/species exporter emits the `ItemGrant` ref. NOTE: **2024 Origin Feats are already feats**
   → granted by `ItemGrant`→`feats` (existing mechanism); this milestone is for the dedicated
   `background_features`/`species_features`.
2. **Skills/tools auto-import (backgrounds).** Parse `&Reference[skill=…]` / `@item[…]` from the
   description → `Trait` advancements (AdvancementManager `Trait` already does skills/tools).
3. **Equipment (backgrounds).** Structured `startingEquipment` (EquipmentEntryData choice-tree) editor
   in the Details tab + parse the `Equipment: Choose A or B…` prose. Currently the Details tab has the
   `wealth` field + a placeholder note for startingEquipment.
4. **Origin-feat import (backgrounds).** Link the description's `@feat[Name|SOURCE]` → an `ItemGrant`
   of the matching imported feat (needs feats imported first; unmatched → warning).
- **Deferred:** proposal-mode for these entity types (needs a `proposals` entity_type CHECK migration;
  they're **admin/content-creator DIRECT-write** today, no proposal flow); deeper public-browser polish.

## Verification done this session (empirical)

- Headless import mapping over **all 432** entries: images 100% captured → after the absolute-only fix,
  236 species + 76 backgrounds carry real cdn art; **0** description enricher leakage after the
  `&Reference` fix.
- **Live `/api/module` export = HTTP 200**: `img` + nested `senses.ranges` + `wealth`/`startingEquipment`
  read from the new columns.
- DB round-trips for each new table; `tsc` clean (6 baseline) at every commit.
- Rebase onto `main` clean (0 conflicts); auth migration applied to local; favorites aligned to native auth.

## Constraints (preserve)

- **NEVER** commit `.claude/scheduled_tasks.lock`; it **blocks rebase** → `git stash push --` that path.
- D1 migrations: **local first**; remote ONLY with explicit, migration-specific go-ahead (rule #7).
- Never `INSERT OR REPLACE` (use `ON CONFLICT(id) DO UPDATE`).
- **main = production** (auto-deploys on push). Don't push without an explicit ask. Branch is 9 ahead,
  not pushed; 5 migrations remain local-only.
- Don't touch sibling-worktree processes; verify port ownership before killing (this session reaped
  orphaned `:3000`/`:8787` from my OWN runs — confirmed mine via the seeded D1 rows). `TaskStop` on a
  background dev server can leave orphans → also `taskkill //F //T //PID` by port to fully reap.
- Dev stack (`worker/` `wrangler dev` :8787 + root `npm run dev` :3000) was running; after the rebase
  it reloaded into native auth → **re-login needed**.
- Commit footer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

## Reference drafts (untracked, `docs/_drafts/`)

- `background-features-design-2026-06-01.html` — the features design + the answered decisions
  (dedicated table; hand-author 2014 features; import = origin-feat link only).
- `bg-species-data-shapes-2026-06-01.html` — Foundry export data-shape analysis.
- `species-backgrounds-status-2026-06-01.html` — the status overview written this session.
- Canonical feature doc (tracked): `docs/features/compendium-races-backgrounds.md` (kept current through
  the favorites commit; **does not yet mention** background/species *features* or the import-window
  FilterBar refactor — update it when the grant+export milestone lands).

# Handoff — Pact casting: master chart + class-editor selection DONE

Branch `settings-pages` (worktree `…/kind-wright-2cb7a2`). Resume here.

## Git state
- `origin/main` = **`84424a2`** (foundry-module creature export merged by another
  line). My branch HEAD = `b9cc0dd`, i.e. origin/main minus that one merge; the
  files I touched are identical to origin/main (verified `git diff` empty).
- **UNCOMMITTED** working tree (all of this feature + the prior master chart):
  - NEW `src/pages/admin/PactCastingMasterEditor.tsx`
  - NEW `handoffs/foundry-module/2026-06-10-from-app-castingmode-pact-contract.md`
  - M `src/pages/admin/SpellcastingAdvancementManager.tsx`, `src/lib/d1Tables.ts`,
    `api/_lib/d1-fetchers-server.ts` (the master-chart wiring)
  - M `src/pages/compendium/ClassEditor.tsx`, `SubclassEditor.tsx`, `ClassView.tsx`,
    `ClassList.tsx`; `src/components/compendium/ClassPreviewPane.tsx`;
    `src/lib/classExport.ts`, `api/_lib/_classExport.ts`, `src/lib/characterLogic.ts`,
    `src/lib/characterShared.ts`, `src/lib/spellcasting.ts`;
    `src/pages/characters/CharacterBuilder.tsx` (the casting-mode feature)
- tsc baseline = **3** pre-existing errors only (CompendiumBrowserShell:405 +
  SpellList:779 `asChild`, characterShared:520 arg-count) — **zero new**.
  `vite build` passes. `main` = prod (**ask before pushing**); single-file
  `d1 execute` for remote migrations (never `migrations apply --remote`).
- **No DB migration** in this feature — `castingMode` is just a key in the existing
  `classes.spellcasting` / `subclasses.spellcasting` JSON. The Pact Master Chart
  reuses `multiclass_master_chart` row id `'pact'` (no migration either).

## DONE — Pact Casting Master Chart (prior session)
Admin → Proficiencies → **Spellcasting** tab → collapsible "Pact Casting Master
Chart". `PactCastingMasterEditor.tsx`, per-level `{level, slots, slotLevel}`,
SRD-seeded, stored under `multiclass_master_chart` id `'pact'` via the
`pactMasterChart` collection alias.

## DONE — pact casting selectable in the class editor (this session)
Design (per user): a **Casting Mode** toggle (Standard vs Pact). The existing
**Progression Type** dropdown (Full/Half/Third) stays in **both** modes — casting
mode only changes **which master chart** that progression feeds: Standard →
Multiclass Master Chart; Pact → Pact Master Chart. The deprecated `'custom'`
progression option + `altProgressionId` selector are removed.

Model — `spellcasting.castingMode: 'spellcasting' | 'pact'` (default 'spellcasting'):
- **ClassEditor.tsx** — added to `buildEmptyClassSpellcastingState`; lazy-migrates
  legacy pact in `normalizeClassSpellcastingForEditor` (`progressionId==='custom'`
  OR `altProgressionId` OR `progression==='pact'` → `castingMode:'pact'`, drops the
  `'custom'` sentinel); `normalizeClassSpellcastingForSave` clears `altProgressionId`
  for pact. UI: a 2-button Casting Mode segmented control; removed the
  `Custom / Pact` option + the `progressionId==='custom'` altProgression block; the
  now-dead `pactScalings` state/fetch removed.
- **SubclassEditor.tsx** — subclasses keep their `progression`-string dropdown
  (already had a `pact` option, relabeled "Pact Casting"); `castingMode` is
  **derived** from `progression==='pact'` in the normalizers (kept in lockstep).

Export round-trip — `castingMode='pact'` ⇒ native `progression:'pact'`:
- **classExport.ts** + **api/_lib/_classExport.ts** `normalizeSpellcastingForExport`:
  force `normalized.progression='pact'` for pact mode (overrides the
  hasLinkedScalingIds suppression) and preserve `castingMode` in output.
- **classExport.ts** `importClassSemantic`: `applyDerivedCastingMode()` fills
  `castingMode` from `progression==='pact'` for Foundry/legacy bundles (class +
  subclasses), before upsert.
- **characterLogic.ts** `normalizeSpellcastingForExport`: normalizes `castingMode`.

Runtime slots — pact pool is separate from standard:
- **spellcasting.ts**: `getPactSlotsForLevel(effLevel, pactTable)` → `{slots,slotLevel}`
  and `buildPactDisplayTable(sc, types, pactChart)` → `{name, levels[lvl]={slotCount,slotLevel}}`.
- **CharacterBuilder.tsx**: fetches the pact chart (`pactMasterChart`/`'pact'`); tags
  each contributor with `castingMode`; splits contributors into standard vs pact;
  standard → multiclass 9-array, pact → `getPactSlotsForLevel`; renders pact pips in
  the spell banner + a "Pact Slots" panel; "Highest Slot" accounts for pact;
  the standard slot grid is gated so pure-pact casters don't show an all-zero grid.
- **characterShared.ts**: `primaryClassIdentifier` additively recognizes a pact class
  (`hasSpellcasting && castingMode==='pact'`).

Viewers — pact rendered via the existing alt "Slot Count / Slot Level" columns:
- **ClassView.tsx** + **ClassPreviewPane.tsx** (+ **ClassList.tsx** foundation):
  fetch the pact chart; when `castingMode==='pact'`, feed `buildPactDisplayTable`
  into the alt-spellcasting display and skip the standard chart; `ClassPaneFoundation`
  gained a required `pactMasterChart`.

## Verification
- `npx tsc --noEmit`: 3 baseline errors, **0 new**.
- `npx vite build`: **passes** (pre-existing chunk-size/dyn-import warnings only).
- Pure-function tests (tsx, all PASS): `getPactSlotsForLevel` (incl. clamp + 0),
  `buildPactDisplayTable` for full + half + non-pact + missing-chart.
- Prod data confirmed: only **Warlock** uses the deprecated mechanism
  (`progressionId:'custom'` + `altProgressionId`) → lazy-migrates to pact on next save.

## Remaining (manual, not blocking)
- **Live in-app round-trip** (auth-gated, not automatable here): create/edit a class
  as Pact Casting → save → confirm `castingMode:'pact'` persists; open the Warlock
  in the editor and confirm it shows Pact Casting (lazy migration); export → confirm
  `system.spellcasting.progression: 'pact'`; build a Warlock character and confirm the
  Pact Slots panel; view the class page + preview pane show pact slots.
- Module side: **no change required** — see
  `handoffs/foundry-module/2026-06-10-from-app-castingmode-pact-contract.md`.
- Minor display nicety (optional): a pure-pact character shows "Casting Level 0"
  (that stat is the standard multiclass level; pact level shows in the Pact Slots
  panel). Relabel if desired.

## Pointers
- Refinement roadmap: `handoffs/2026-06-09-refinement-roadmap.md`
  (Articles ~done; Maps / Calendar / Campaign Page still to investigate).
- Dev stack (no-watch): worker `cd worker && npx wrangler dev --port 8788`;
  app `PORT=3001 R2_WORKER_URL=http://localhost:8788 npx tsx server.ts`. Admin pages
  are staff/admin-gated; verify via tsc + Vite-transform + local-D1 queries
  (`npx wrangler d1 execute dauligor-db --local --config worker/wrangler.toml`).

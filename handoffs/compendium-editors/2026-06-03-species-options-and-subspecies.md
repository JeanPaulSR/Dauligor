# Handoff — `compendium-editors`: Species Options (phases 2–5) + Subspecies (new), with a push backlog

> **Date:** 2026-06-03 · **Branch:** `compendium-editors` · **Worktree:**
> `E:\DnD\Professional\Dev\Dauligor\.claude\worktrees\nostalgic-lamport-76d78d`
> **Purpose:** resume the Species work cold after a compaction. Read top-to-bottom.

## 🛑 FIRST — unblock the push (GitHub credential re-auth)

**Two commits are committed locally but NOT pushed** because the GitHub credential expired
mid-session. Any `git push`/`fetch` now fails with `could not read Username for
'https://github.com'` — Git Credential Manager needs an **interactive** sign-in that the agent
can't do from its non-interactive shell (earlier attempts hung for minutes; the orphaned
processes were killed).

- **User action:** in a terminal, run `git credential-manager github login` (or any
  `git push` / `git fetch` from the repo and complete the GitHub popup). GCM caches the token
  for `github.com` globally, so the worktree push then works.
- **Then the agent:** `git fetch origin` → confirm `2 ahead / 0 behind` → `git push origin HEAD:main`.
- **Fast-fail probe** (won't hang): `GCM_INTERACTIVE=Never GIT_TERMINAL_PROMPT=0 git push origin HEAD:main`.
  Exit 128 + "could not read Username" ⇒ still needs re-auth. If it hangs again, kill stuck procs:
  PowerShell `Get-Process -Name git,git-remote-https,git-credential-manager -EA SilentlyContinue | Stop-Process -Force`.

## Git state (at handoff)

- `compendium-editors`: **2 ahead / 0 behind** `origin/main`.
- **Queued (unpushed):**
  - `863d569` feat(compendium): species options — schema + plumbing (phase 1)
  - `256a2a3` feat(compendium): polish species Traits tab (card layout + icons)
- **Deployed to main earlier today** (FYI, already live): `63842ed` doc sync · `55a58e3` class
  dirty-check fix · `e9e0c26` import FK + source picker · `7f4a96a` site scrollbar + editor
  table-tools height · `8b35cd5` caret-jump fix · `3314fec` toolbar-updates-on-click. (Earlier:
  the whole Backgrounds push `64d926c` + dirty-check `fd46b4e`.)
- **Working tree:** only `.claude/scheduled_tasks.lock` shows ` D` (NEVER stage/commit it) + 3
  pre-existing `docs/_drafts/*.html` drafts (ignore). Otherwise clean.
- `npx tsc --noEmit` = **6 errors (pre-existing baseline)** throughout; `npx vite build` clean.

## ⚠️ Local-only migration (remote apply PENDING)

- `worker/migrations/20260603-1600_species_options.sql` — **applied to LOCAL D1 only.** Creates
  `species_options` table + adds `species.speciesOptionIds` (JSON, default `'[]'`).
- **Remote apply is required BEFORE the species-options feature deploys** (else prod 500s on the
  new column/table) and needs BOTH working creds AND a **separate, in-conversation,
  migration-specific go-ahead** (AGENTS.md rule 7 — a prior go-ahead never transfers). From
  `worker/`: `npx wrangler d1 execute dauligor-db --remote --file=migrations/20260603-1600_species_options.sql`
  (PRAGMA-check first per AGENTS.md). The 8 Backgrounds migrations were already applied to remote earlier today.

---

## Species work — status & plan

### #1 Traits tab polish — ✅ DONE (queued `256a2a3`)
`SpeciesTraitsFields` (in `SpeciesBackgroundEditor.tsx`) rebuilt: Movement + Senses as
icon-headed cards side-by-side, inline unit hints inside spinner-free number fields, Creature
Type as its own card. Added `TraitCard` + `StatNumberField` helpers + a `lucide-react` import
(`Footprints, Eye, Dna`). Same data + behavior. tsc 6, build clean.

### #2 Species Options — DESIGN LOCKED, Phase 1 ✅ DONE (queued `863d569`)
**Design doc:** [`docs/_drafts/species-options-design-2026-06-03.html`](../../docs/_drafts/species-options-design-2026-06-03.html) (parchment/gold).

**Confirmed decisions (via the user):**
- **Model = reusable trait → granted FEATURE.** Each option is feat-shaped
  (name/identifier/source/page/description + advancements/activities/effects/uses/tags). Attaching
  it to a species emits an **`ItemGrant`** advancement on the species **and embeds the feature
  item** in the species export bundle's `features[]` — mirrors the background-features path.
- **Storage = a NEW `species_options` type** (table), distinct from the existing `species_features`.
- **Attach mechanism =** `species.speciesOptionIds` JSON id array (no junction; dangling ids on
  delete are simply skipped by the export).

**Phase 1 (done):** migration `20260603-1600` (local), `d1Tables.ts` (`speciesOptions:
'species_options'`), `d1.ts` (`PERSISTENT_TABLES += 'species_options'`; `jsonFields +=
'speciesOptionIds'`).

**Remaining phases (build → then push):**
- **Phase 2 — Options MANAGER.** A CRUD editor for the reusable library. Route
  `/compendium/species-options/manage` (+ `src/App.tsx` route + `src/components/Sidebar.tsx`
  link). Lean fields first (name / identifier / source / image / description); advancements +
  effects later via the existing AdvancementManager / effects editors. Pattern off
  `CompendiumFeatureEditor.tsx` or `BackgroundFeaturesTab.tsx`; collection key `'speciesOptions'`.
  Optional Maintenance purge card in `src/pages/core/Settings.tsx`.
- **Phase 3 — Species editor PICKER.** A new **"Options" sub-tab** on `SpeciesBackgroundEditor`
  (only when `kind === 'species'`). Load all `species_options` in the editor's initial fetch;
  render a searchable multi-select that writes `formData.speciesOptionIds`; `handleSave` already
  spreads species-only fields — add `payload.speciesOptionIds`. `SBPreview` shows the attached set.
- **Phase 4 — Foundry EXPORT.** New `api/_lib/_speciesOptionExport.ts` (parallel to
  `_backgroundFeatureExport.ts`: a `feat` item with `system.type.value="race"`, flags
  `entityKind:"species-option"`). In `_raceExport.ts`: read `row.speciesOptionIds`, build each
  option item → an `ItemGrant` advancement on `system.advancement` + push the item into a new
  `features[]` on `RaceItemBundle` (copy the owned-features block from `_backgroundExport.ts`).
  Add a `species-options/<id>.json` route arm + import in `functions/api/module/[[path]].ts`
  (append-only — that file is a shared/append-only file).
- **Phase 5 — VIEW page.** `SpeciesBackgroundBrowser` `SBDetail` (species branch) renders the
  attached options (load a `speciesOptions` vocab; show name + description as a trait list),
  mirroring how the background detail shows its proficiency lines.

### #3 Subspecies — 🆕 REQUESTED, NOT YET DESIGNED
**User ask:** *"we should also have the ability to add a subspecies, which might have their own
stuff."* (e.g. Elf → High Elf / Wood Elf / Drow — a child of a parent species with its own
traits/options/features.)

**Do this the same way as species options: short AskUserQuestion on the model → HTML design doc →
phased build.** Open design questions to resolve WITH the user:
1. **Data model:** (a) subspecies are `species` rows + a new `parentSpeciesId` column — a
   subspecies IS a species with a parent, reusing ALL species machinery (traits, options,
   advancements, export) for free; **or** (b) a dedicated `subspecies` table (`parentSpeciesId`
   FK, `ON DELETE CASCADE`). Lean toward (a) unless the shape genuinely diverges.
2. **"Own stuff" scope:** own movement/senses/creatureType overrides, own `speciesOptionIds`,
   own features/advancements, ASIs? (Model (a) grants all of these automatically.)
3. **Inheritance:** does a subspecies INHERIT the parent's traits (merge on export) or stand
   alone (author repeats what's shared)? This drives the export shape.
4. **Foundry export:** subspecies as its own `race` item? a parent+child merge? a subrace flag?
   Check `module/dauligor-pairing/docs/` import contract before deciding.
5. **UI:** a **"Subspecies" sub-tab** on the species editor that lists/creates subspecies owned by
   the parent (like `BackgroundFeaturesTab` owns background features) + browse/view.

---

## Constraints (preserve verbatim)
- **main = production**; push only with an explicit in-session ask **and** working creds; ALWAYS
  `git fetch origin` before asserting status.
- D1 migrations: **local first**; remote ONLY with an explicit, **migration-specific** go-ahead
  (rule 7). `20260603-1600` is local-only so far.
- Never `INSERT OR REPLACE` (use `ON CONFLICT(id) DO UPDATE`). Never commit
  `.claude/scheduled_tasks.lock`.
- Commit footer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Present specs/designs as parchment/gold **HTML** in `docs/_drafts/` (not chat prose).
- MarkdownEditor: the caret-jump (`if (editor.isFocused) return` in the sync effect) and
  toolbar-updates-on-selection (`selectionTick`) fixes already shipped — don't regress them. Table
  Tools show **only when the cursor is inside a table** (`hasTable = editor.isActive('table')`).

## Key file / component map
| Concern | File |
|---|---|
| Species + background editor (tabs / traits / future Options & Subspecies sub-tabs) | `src/pages/compendium/SpeciesBackgroundEditor.tsx` |
| Species + background public view | `src/pages/compendium/SpeciesBackgroundBrowser.tsx` |
| Species (race) Foundry export | `api/_lib/_raceExport.ts` + `api/_lib/_speciesBackgroundShared.ts` |
| **Template** for option export (ItemGrant + `features[]`) | `api/_lib/_backgroundFeatureExport.ts` + `api/_lib/_backgroundExport.ts` |
| **Template** for owned-feature authoring tab | `src/components/compendium/BackgroundFeaturesTab.tsx` |
| Module route (append `species-options/<id>.json` arm) | `functions/api/module/[[path]].ts` |
| Table registry (`speciesOptions` added) | `src/lib/d1Tables.ts` |
| JSON auto-parse + persistent tables | `src/lib/d1.ts` |
| Species-options migration (local-only) | `worker/migrations/20260603-1600_species_options.sql` |
| Species-options design doc | `docs/_drafts/species-options-design-2026-06-03.html` |

# Handoff — `compendium-editors`: Subspecies (BUILT, unpushed) + Species Options (phases 2–5)

> **Date:** 2026-06-03 (updated) · **Branch:** `compendium-editors` · **Worktree:**
> `E:\DnD\Professional\Dev\Dauligor\.claude\worktrees\nostalgic-lamport-76d78d`
> **Purpose:** resume the Species work cold after a compaction. Read top-to-bottom.

## Git state (at handoff)

- `compendium-editors`: **3 ahead / 0 behind** `origin/main` (`origin/main` tops at `80096b2`).
- **Queued (unpushed) — the Subspecies feature:**
  - `8ca27bd` subspecies — schema + editor parent field + authoring tab (phases 1–3)
  - `3dc1651` subspecies — group under parent in the browser (phase 4)
  - `70ba1db` subspecies — parentRaceId export flag (phase 5, optional)
- **Already LIVE on main** (pushed earlier today): `80096b2` (this handoff's prior version) ·
  `863d569` species-options phase 1 · `256a2a3` traits-tab polish · plus the morning's batch
  (`63842ed` doc sync · `55a58e3` class dirty-check · `e9e0c26` import FK + source picker ·
  `7f4a96a` scrollbar + editor height · `8b35cd5` caret-jump · `3314fec` toolbar-on-click ·
  `64d926c` Backgrounds).
- **Working tree:** only `.claude/scheduled_tasks.lock` (` D` — NEVER stage/commit) + 3
  pre-existing `docs/_drafts/*.html` drafts (`background-features-design`, `bg-species-data-shapes`,
  `species-backgrounds-status` — not ours, leave untracked). Otherwise clean.
- `npx tsc --noEmit` = **6 errors (pre-existing baseline)**; `npx vite build` clean.

## Push / credentials — RESOLVED (with a gotcha)

The earlier credential block cleared. **`git fetch` works** (the repo is public, so fetch is
anonymous — a successful fetch does **not** prove push creds). **`git push` works** too, but
**only with an interactive popup allowed**: run a plain `git push origin HEAD:main` and complete
the GitHub popup. **Do NOT** push with `GCM_INTERACTIVE=Never GIT_TERMINAL_PROMPT=0` — that fast-
fail combo makes push exit 128 (it's only for a non-hanging *probe*).

---

## 🛑 Subspecies deploy is GATED on an ordering constraint

The user chose to **hold** (keep local) — subspecies is built + committed but **not** pushed and
its migration is **not** applied to remote. When deploying later, the order is **non-negotiable**:

1. **Apply the remote migration FIRST** (needs a fresh, migration-specific go-ahead per AGENTS.md
   rule 7): from `worker/`,
   `npx wrangler d1 execute dauligor-db --remote --file=migrations/20260603-1800_species_subspecies.sql`
   (PRAGMA-check first).
2. **THEN** `git push origin HEAD:main` (popup-allowed) to deploy the 3 commits.

**Why order matters:** unlike species-options phase 1 (inert), the subspecies editor **writes
`parentSpeciesId` on every species save**. If the code deploys before the column exists, *all*
species saves in prod fail with `no such column: parentSpeciesId`. The migration is additive/
backward-compatible, so applying it to remote ahead of the push is harmless to currently-live prod.

### Remote-pending migrations
- `worker/migrations/20260603-1800_species_subspecies.sql` — **applied LOCAL only.** Adds
  `species.parentSpeciesId TEXT REFERENCES species(id) ON DELETE SET NULL` + `idx_species_parent`.
  **Required before any subspecies push** (see above).
- `worker/migrations/20260603-1600_species_options.sql` — **applied LOCAL only.** Creates
  `species_options` + `species.speciesOptionIds`. **Not** required yet (species-options phase 1 is
  inert; phases 2+ aren't built). Apply before species-options phase 2+ deploys.

⚠️ **Local-testing note:** both migrations were applied to the **worktree's** local D1, not the
running dev stack's (that's the *main repo's* — don't disturb it). To click through subspecies on
`localhost`, the main repo's local D1 needs `20260603-1800` too (or run the worktree's stack).

---

## #1 Subspecies — ✅ BUILT (phases 1–5), committed, UNPUSHED
**Design doc:** [`docs/_drafts/subspecies-design-2026-06-03.html`](../../docs/_drafts/subspecies-design-2026-06-03.html).

**Confirmed model (via the user):** a subspecies is a **complete species that names a parent** —
**stand-alone `race` export**, **reuse the `species` table** (self-FK), **a "Subspecies" sub-tab**
on the species editor. (Rejected: parent+child merge — needs nonexistent module support; a
dedicated table — identical shape to species, so pure duplication.)

What shipped:
- **Schema (`8ca27bd`):** `species.parentSpeciesId` self-FK (`ON DELETE SET NULL` → deleting a
  parent *promotes* children to base species; verified empirically on local D1) + index. No
  `d1Tables`/`d1.ts` change (plain id column, round-trips via the editor's `...row` spread).
- **Editor (`8ca27bd`):** `parentSpeciesId` in `SBFormData`, hydrated on load, written in
  `handleSave`'s species branch (`payload.parentSpeciesId = formData.parentSpeciesId || null`).
- **Subspecies tab (`8ca27bd`)** — `src/components/compendium/SubspeciesTab.tsx`: shown only for a
  **saved base species** (`editingId && !parentSpeciesId`). Lists children
  (`species WHERE parentSpeciesId = ?`); "New Subspecies" writes a child pre-filled from the
  parent's traits (movement/senses/creatureType/advancements/speciesOptionIds/tags/source) then
  `onEditChild(childId)` → `setEditingId` opens it in the same editor; edit/delete. Editing a child
  shows a "Subspecies of X · ← Back" banner; children are hidden from the flat editor list. One
  level deep (no grandchildren).
- **Shell support (`8ca27bd`)** — `CompendiumEditorShell.tsx`: new generic `contextBanner` prop
  (renders above the identity row) + a defensive effect that resets the active sub-tab if its key
  vanishes from `editorSubTabs` (so switching parent↔child never blanks the body). Both are generic
  improvements; no-ops for stable editors (spells/feats).
- **Browser (`3dc1651`)** — `SpeciesBackgroundBrowser.tsx`: children hidden from the top-level
  list; a base species' detail lists its subspecies (click → view); a child's detail links back to
  its parent. `selectedRow` falls back to the full row set, so a list-hidden child still renders.
- **Export (`70ba1db`, optional)** — `_raceExport.ts`: stamps
  `flags.dauligor-pairing.parentRaceId = <parent dbId>` (additive, no extra fetch; matches the
  parent bundle's own `dbId`). Each subspecies still exports as a stand-alone `race` item. Module-
  side grouping is the `foundry-module` branch's job.

**Open follow-ups (optional):** subspecies could carry `speciesOptionIds` once the species-options
picker (its phase 3) lands — already pre-filled from the parent; no extra work needed.

## #2 Species Options — phases 2–5 STILL PENDING (phase 1 LIVE on main, inert)
**Design doc:** [`docs/_drafts/species-options-design-2026-06-03.html`](../../docs/_drafts/species-options-design-2026-06-03.html).
Phase 1 (schema + `d1Tables`/`d1.ts` registration) is `863d569`, live on main but inert (nothing
reads `species_options` / `speciesOptionIds` yet). Remaining:
- **Phase 2 — Options MANAGER.** CRUD editor for the reusable library. Route
  `/compendium/species-options/manage` (+ `src/App.tsx` + `src/components/Sidebar.tsx`). Lean
  fields first (name / identifier / source / image / description). Pattern off
  `CompendiumFeatureEditor.tsx` / `BackgroundFeaturesTab.tsx`; collection key `'speciesOptions'`.
- **Phase 3 — Species editor PICKER.** A new **"Options" sub-tab** on `SpeciesBackgroundEditor`
  (species-only). Load all `species_options`; multi-select writes `formData.speciesOptionIds`; add
  `payload.speciesOptionIds` in `handleSave`'s species branch. (NOTE: `handleSave` does NOT yet
  write `speciesOptionIds` — it's preserved on update by the partial-upsert, but the picker must
  add it to the payload to persist edits.)
- **Phase 4 — Foundry EXPORT.** New `api/_lib/_speciesOptionExport.ts` (parallel to
  `_backgroundFeatureExport.ts`). In `_raceExport.ts`: read `row.speciesOptionIds`, build each as a
  `feat` item → `ItemGrant` advancement on `system.advancement` + push into a new `features[]` on
  `RaceItemBundle` (copy the owned-features block from `_backgroundExport.ts`). Add a
  `species-options/<id>.json` route arm in `functions/api/module/[[path]].ts` (append-only file).
- **Phase 5 — VIEW page.** `SpeciesBackgroundBrowser` `SBDetail` species branch renders the
  attached options as a trait list.

---

## Constraints (preserve verbatim)
- **main = production**; push only with an explicit in-session ask **and** popup-allowed creds;
  ALWAYS `git fetch origin` before asserting status.
- D1 migrations: **local first**; remote ONLY with an explicit, **migration-specific** go-ahead
  (rule 7 — a prior go-ahead never transfers). `20260603-1600` and `20260603-1800` are local-only.
- Never `INSERT OR REPLACE` (use `ON CONFLICT(id) DO UPDATE` — `upsertDocument` already does, and
  only updates the columns in the payload). Never commit `.claude/scheduled_tasks.lock`.
- Commit footer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Present specs/designs as parchment/gold **HTML** in `docs/_drafts/` (not chat prose).
- Never npm install in a worktree; don't disturb the running localhost:3000/8787 stack (main repo's).
- MarkdownEditor fixes already shipped (caret-jump, toolbar-on-selection, table-tools-when-in-table)
  — don't regress them.

## Key file / component map
| Concern | File |
|---|---|
| Species + background editor (tabs / traits / Subspecies tab / future Options sub-tab) | `src/pages/compendium/SpeciesBackgroundEditor.tsx` |
| Subspecies authoring tab | `src/components/compendium/SubspeciesTab.tsx` |
| Editor shell (`contextBanner`, sub-tab guard) | `src/components/compendium/CompendiumEditorShell.tsx` |
| Species + background public view (subspecies grouping) | `src/pages/compendium/SpeciesBackgroundBrowser.tsx` |
| Species (race) Foundry export (parentRaceId flag) | `api/_lib/_raceExport.ts` + `api/_lib/_speciesBackgroundShared.ts` |
| Subspecies migration (local-only) | `worker/migrations/20260603-1800_species_subspecies.sql` |
| Species-options migration (local-only) | `worker/migrations/20260603-1600_species_options.sql` |
| **Template** for options export (ItemGrant + `features[]`) | `api/_lib/_backgroundFeatureExport.ts` + `api/_lib/_backgroundExport.ts` |
| Module route (append `species-options/<id>.json` arm) | `functions/api/module/[[path]].ts` |
| Table registry / JSON auto-parse | `src/lib/d1Tables.ts` · `src/lib/d1.ts` |

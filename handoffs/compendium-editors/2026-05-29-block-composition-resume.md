# Handoff — `compendium-editors`: block-composition session (resume after compaction)

> Read this first, then the earlier resume doc
> [2026-05-29-part-bc-implementation-state.md](2026-05-29-part-bc-implementation-state.md) (still valid
> for Part A–D framing + the 4 picker layers), the deep-dive
> [proposal-block-composition.html](../../docs/architecture/compendium-editors/proposal-block-composition.html),
> the test checklist [proposal-mode-test-checklist.html](../../docs/architecture/compendium-editors/proposal-mode-test-checklist.html),
> and the live ask list to proposal-system [2026-05-29-followup-to-proposal-system.md](2026-05-29-followup-to-proposal-system.md).

## TL;DR — where we are

Building "propose a whole class in one block" with `proposal-system`. **Part B + Part C are done**
(scaling_column + feature saves route through the accumulator; draft entities are selectable in every
cross-reference picker at all 4 layers). This session also **made the block flow actually usable**: a
content-creator can now create a class in a block and, without a reload, add features / scaling columns /
subclasses / option groups, see their drafts in lists + pickers, and submit. The headline bug (a 404 that
aborted the whole flush) is fixed. A first **perf pass** (memoize AdvancementManager) is in.

**Still open:** the **§3 hand-back to proposal-system** (coverage table + sample block for their guard #1)
hasn't been written; perf follow-ups (#19); two minor items (controlled-input dev warning; "unnamed
draft" verify). **proposal-system's Part D (atomic approve) is not built** — so you can author + submit a
block, but approving it to land the cluster doesn't work yet.

## Branch / worktree / main state

- Branch **`compendium-editors`** in worktree
  `E:\DnD\Professional\Dev\Dauligor\.claude\worktrees\nostalgic-lamport-76d78d` (folder name is a
  leftover label, not a mismatch). **Bash CWD resets here every call** — use `cd "<path>" && …` or
  `git -C`.
- **Rebased onto `origin/main` = `7d41e5b`** earlier this session (proposal-system's block-entry gate +
  R1 fix + `mode:'block'` toast + the two `entity_type` migrations). `origin/main` is now **`9bf4ca5`**
  (our pushed doc commits sit on top).
- **Doc-sync convention:** doc/handoff commits get pushed to `main` (cherry-pick onto `origin/main` via a
  throwaway detached worktree — `git worktree add --detach <tmp> origin/main` → `cherry-pick <sha>` →
  `push origin HEAD:main` → `worktree remove <tmp>`); CODE stays branch-local. The branch carries
  duplicates of the pushed doc commits (`2e1ff95`, `7478c34`, `d67614b`) — a future rebase drops them.
- Working tree clean; everything committed.

## What shipped this session (branch-local code unless noted)

Commit-by-commit (newest first), grouped:

**Part B (feature) + Part C (overlays):**
- `2dd7b3d` Part B feature — ClassEditor/SubclassEditor `handleSaveFeature`/`handleDeleteFeature` route
  through `useProposalAccumulator('feature')`; extracted `normalizeFeatureData` from `upsertFeature` so the
  queued payload is the flat snake-case shape the approval `writableColumns` expect.
- `e02f2fe` Part C L1 — block-draft overlays for feature/option_group/option_item/feat in the advancement
  pickers (all 4 editors), via new hook **`useBlockDraftPickerOptions`** (bakes "(in this block)").
- `9c96e51` Part C L2/L3/L4 — RequirementsEditor `lookups` (FeatsEditor + UniqueOptionGroupEditor),
  SpellAdvancementEditors (in-component), UniqueOptionGroupEditor class-restriction EntityPicker.
- `c63e85d` was the earlier scaling_column-only L1 (pre-rebase).

**Making the block flow usable (F2 + reload-gap + load-draft):**
- `9e8f9b5` F2 — new hook **`useBlockDraftedList`** (generalizes FeatsEditor's `displayEntries`): the
  ScalingColumnsPanel, ClassEditor/SubclassEditor feature lists now show block-draft creates.
- `a509212` subclasses now show under their class in a block (Subclasses tab content + Add link → gate on
  `effectiveId`; subclass list F2 overlay with a new `parentKey:'class_id'` option on the helper).
- `a474f35` reload-gap (#16): ClassEditor/SubclassEditor child sections gate on **`effectiveId`** (the
  client-minted id), not raw `id` — scaling panel + handleSaveFeature guard + displayFeatures filter.
  Plus subclass draft-parent load (SubclassEditor reads a same-block draft parent class).
- `83923d9` ScalingMatrixEditor loads a draft column from the block (re-open shows its values).
- `3065ccf` option-group editor: the Individual Options section + handleSaveItem gate on `effectiveId`
  (add options to a just-created draft group — Issue 2).
- `421ba96` ⭐ **the big one** — feature create-vs-update (404 fix) + the last Features-tab `id`→`effectiveId`
  gate (see "key fixes" below).
- `9ecd975` feat advancements can read option-group **items** (FeatsEditor now stores + passes
  `availableOptionItems`; covers Race/Background which wrap FeatsEditor).

**Perf:**
- `e912512` `React.memo(AdvancementManager)` + memoized ClassEditor's 5 picker arrays + `classReferenceContext`
  so the heavy advancement editor skips re-renders on unrelated state changes (input-lag fix, first pass).

**Docs (pushed to `main`):** `2e1ff95` followup note (R1/R2/R3 + F1/F2), `9803d16`←`7478c34` F3
(subclasses.preview writableColumns), `9bf4ca5`←`d67614b` R4 (flush atomicity + staleness). Branch-local:
`c9b7c05` deep-dive + checklist.

## The key fixes + WHY (so you don't re-derive)

- **The 404 / "can't link advancements" / "scaling didn't save" were ONE bug.** The "Add Feature" button
  pre-mints `id: crypto.randomUUID()`, and `handleSaveFeature` decided create-vs-update with
  `!editingFeature.id` — never true for a new feature → it queued an **UPDATE** for a feature with no live
  row → the flush's snapshot load 404s **and aborts the whole flush** (so the scaling column etc. didn't
  persist either). Admin-direct hid it (`upsertFeature` = upsert). **Fix:** decide by live-row membership
  `!features.some(f => f.id === editingFeature.id)` — new/draft features are CREATEs (the accumulator folds
  repeat creates / patches the existing draft). In ClassEditor + SubclassEditor.
- **The reload-gap was a family of `{id && …}` gates** that should be `{effectiveId && …}` (route id is
  null on `/new`; `effectiveId = routeId ?? pendingCreateId` carries the minted id post-`recordCreate`).
  Fixed across ClassEditor (scaling panel, Features content, handleSaveFeature, displayFeatures, Subclasses
  content + Add link), SubclassEditor, UniqueOptionGroupEditor (Individual Options + handleSaveItem). The
  spell-list `<Link>` (ClassEditor ~2898) **stays on `id`** — it's a cross-page link needing a live class.
- **Two helpers carry the overlays:** `useBlockDraftPickerOptions(type)` → pickers (id+name+"(in this
  block)"); `useBlockDraftedList(type, liveItems, {parentId,parentType,parentKey})` → own lists/panels
  (full denormalized rows; `parentKey` defaults `parent_id`, use `class_id` for subclasses / `group_id`
  for option items).

## Local env

- **The two `entity_type` migrations ARE applied to local D1** this session (`pending_revisions.entity_type`
  CHECK now includes `scaling_column` + `feature`). Applied via
  `npx wrangler d1 execute dauligor-db --local --file=migrations/20260528-1200_…` then `…-1400_…` from the
  `worker/` dir (the local `d1_migrations` tracker is EMPTY — DB was seeded by file-copy — so do NOT run
  `wrangler migrations apply`; apply specific files only).
- A sibling worktree (`system-applications`, the main repo root `E:\DnD\Professional\Dev\Dauligor`) has an
  uncommitted/branch-local migration `20260529-1200_subclass_preview.sql` (`ALTER TABLE subclasses ADD
  COLUMN preview TEXT`). Reviewed: additive, different table, no conflict with ours. Flagged to
  proposal-system (F3) to add `preview` to the subclass `writableColumns` when it lands.
- Dev server was running (Express :3000 → wrangler :8787). Submitting a block now works post-migration.

## What's LEFT

**Ours (compendium-editors):**
1. **§3 hand-back to proposal-system** (NOT written yet — they're waiting on it to build guard #1): the
   final picker-overlay coverage table (it's recorded in task #14's description + the audit doc), payload-
   shape confirmation, the `parent_type` values actually authored, any new draftable refs, a **sample
   block** (Druid + Wild Shape + a scaling column + an option group w/ one option, all same-block drafts),
   and F2 status. Put it in this folder + push to `main`.
2. **Perf follow-ups (#19):** the in-feature-modal AdvancementManager still gets inline
   `onChange`/`onLinkAdvancement` (only matters while that modal is open); Subclass/Feats/Items editors
   still spread their available* arrays inline — memoize like ClassEditor.
3. **Issue 1 (controlled-input dev warning, minor):** "Base UI FieldControl uncontrolled" near the
   columns/advancement editor — not pinpointed (matrix inputs all have `|| ''`/`?? ''`); likely an
   AdvancementManager numeric input. Needs the exact field/interaction or a defensive `?? ''` sweep.
4. **Issue 2 (unnamed scaling draft, verify):** "(unnamed draft)" = the column was created with an empty
   name (the field IS wired). Re-test now that the flush no longer aborts.

**proposal-system's (on `main` in the followup note, awaiting them):** R1 add type/identifier/distance_units
to `scaling_column.writableColumns`; R2 confirm guard #1 + atomic approve resolve in-block creates whose
parent is a same-block draft (esp. the feature graph); R3 the block-entry gate (shipped — verify); R4 make
the flush atomic + close the drafts-cache staleness window; F2 wrap the `/proposals/edit/option-groups`
catalog-list route; F3 subclass.preview writableColumns. **Part D (atomic approve + guard #1) is the big
remaining piece — not built.**

## Tasks (TaskList)

#13 Part B ✅ · #14 Part C ✅ (coverage table in its description) · #16 reload-gap ✅ · #17 F2 overlays ✅ ·
#18 deep-dive + composition fixes ✅ · #19 extend AdvancementManager memoization (open) · #15 verify
proposal-mode cluster authoring e2e (open — needs Part D for the approve half).

## Verification

`npx tsc --noEmit` from the worktree = **7-error baseline** (6× `Button asChild` in CompendiumBrowserShell/
CampaignEditor/SpellList/LoreEditor + 1× characterShared.ts:520); nothing in touched files. User has been
spot-checking in the running app via the checklist; the functional blockers (404, features lock, subclass
display, option-group items) are resolved.

## Immediate next step

The user's last open choice was: (a) extend the memoization to the feature-modal mount + other editors, (b)
chase the controlled-input warning, or (c) write the **§3 hand-back** to proposal-system. (c) is the most
valuable for unblocking the other agent (it lets them build guard #1 against the final overlay set) — but
confirm with the user, who's been driving the order via spot-checks.

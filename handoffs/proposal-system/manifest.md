# Branch: `proposal-system`

Started: `2026-05-28`
Owner: `Claude`
Goal: `Own and evolve the content-proposals subsystem — queue/drafts/blocks, cascade engine, review mode, and proposal-mode editor wiring. Specific task per session.`
Status: `active`

> Lives in the `loving-banach-d76c40` worktree directory (the dir
> couldn't be renamed to match the branch — Windows locks the active
> session's worktree dir; cosmetic only, git tracks by branch name).

## Primary files (exclusive)

The content-proposals subsystem. Other branches should request changes via the shared-files protocol rather than editing directly.

- `src/lib/proposalAccumulator.ts` — queue + drafts merge (`getDraftedEntities`), dedup, two-phase cascade POST, `useProposalAccumulator`
- `src/lib/proposalAware.ts` — `useEntityWriter`, `applyProposalWrite`, `actionLabel`
- `src/lib/proposalBlock.tsx` — `BlockProvider` / `useBlock` (active block + drafts lifecycle)
- `src/lib/proposalReview.tsx` — review-mode provider + `<ReviewFieldHighlight>`
- `src/components/proposals/**` — wrapper, tombstone, cascade banner, dialogs, README
- `src/hooks/useProposalEntityDrafts.ts`, `useProposalSingleWorkId.ts`, `useProposalPreFlushSave.ts`, `useDraftedEntityIds.ts`, `useEditBaseUnlocks.ts`, `useTombstoneBanner.ts`, `useCascadeDependent.ts`
- `src/pages/core/MyProposals.tsx`
- `src/pages/admin/AdminProposals.tsx`
- `api/_lib/proposals.ts`, `api/_lib/cascadeStrategies.ts`
- `functions/api/proposals/[[path]].ts`, `functions/api/admin/proposals/[[path]].ts`
- `docs/architecture/proposal-editor-pattern.md`, `docs/features/content-proposals.md`

## Shared files (append-only / coordinate with owner)

Proposal-mode logic lives *inside* these files, but the files themselves are owned by compendium / app-shell work. Touch only the proposal-mode branches; coordinate before structural edits.

- Compendium editors (proposal-mode `isProposalMode` branches only): `src/pages/compendium/{SpellsEditor,FeatsEditor,ItemsEditor,ClassEditor,SubclassEditor,TagsExplorer,SpellRulesEditor,SpellListManager,UniqueOptionGroupEditor}.tsx`, `src/components/compendium/DevelopmentCompendiumManager.tsx`
- `src/App.tsx` — `/proposals/edit/*` route entries (owned-shared by `system-applications`)
- `src/components/Sidebar.tsx` — proposals nav links (owned-shared by `system-applications`)
- `worker/migrations/` — new proposal migrations (timestamp-named filenames)

## Open requests to other branches

- [ ] `(2026-05-28)` Request **`compendium-editors`** to implement Parts B + C of
  [2026-05-28-cross-referential-cluster-design.md](2026-05-28-cross-referential-cluster-design.md)
  once proposal-system ships Parts A + D:
  - **Part B** — route scaling-column save/delete through the proposal
    accumulator when `isProposalMode` (`ScalingColumnsPanel.tsx`,
    `SubclassEditor.tsx`, `scaling/ScalingEditor.tsx`). Consumes the new
    `scaling_column` proposable entity type.
  - **Part C** — overlay current-active-block draft creates into the
    cross-reference pickers (`ClassEditor`, `SubclassEditor`,
    `UniqueOptionGroupEditor`, shared `EntityPicker` gains a `draftEntries`
    prop). Consumes the proposal-system picker-overlay helper.
  - Blocks: content-creators authoring full class clusters (the reported bug).

## Handoff log

Newest at the top. Each entry: date + link to the handoff doc in this same folder.

- `2026-05-28` — **Part A built + held on this branch; design hardened.**
  Part A (`scaling_column` proposable type, `useProposalDraftOptions` helper,
  local migration `20260528-1200`) is committed on `proposal-system` but was
  **removed from `main`** (force-reset `abb7fc5`→`3e0e346`) — held off `main`
  until the full feature is agreed. A worst-case pass hardened **Part D** in
  the design doc: approve-whole-block now applies via an **atomic
  `env.DB.batch()`** (an earlier draft wrongly claimed D1 can't transact),
  with pre-apply **reference-integrity validation** + **per-revision drift
  check** + **block-level/cascade reject** + **block edit-lock**. New
  "Failure modes considered" section records the S1–S11 analysis and the
  governing principle: all integrity lives in the **approval layer**, never
  as new FKs/CHECKs (the loose schema is what the admin-direct flow relies on).
  **Consequence for the Open Request:** B + C are *not* unblocked from `main`
  yet (Part A isn't there) — `compendium-editors` either rebases onto
  `proposal-system` or waits for Part A to land on `main`.
- `2026-05-28` — [2026-05-28-cross-referential-cluster-design.md](2026-05-28-cross-referential-cluster-design.md):
  design for proposing cross-referential class clusters (columns/subclasses/
  option-groups). Root cause + agreed architecture (D1 approve-whole-block,
  `scaling_column` as a proposable type, active-block picker overlay).
  proposal-system owns Parts A + D; compendium-editors owns Parts B + C
  (see Open request above).
- `2026-05-28` — branch (re)activated as `proposal-system`. Landed two fixes to main before the rename: `9cdf1c6` (scope block UI to `/proposals/edit/*` only — kill `useEntityWriter` global block-mode auto-promotion) + `3c0d6d2` (FeatsEditor proposal-mode CREATE scroll/undo preservation).

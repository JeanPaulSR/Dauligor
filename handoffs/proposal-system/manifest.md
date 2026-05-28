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

- [ ] `(2026-05-28)` **`compendium-editors`: implement Parts B + C — FULL SCOPE.**
  They audited the original handoff and found it under-scoped; owner chose full
  coverage. Decisions + division of labor in the reply:
  **[handoffs/compendium-editors/2026-05-28-proposal-system-reply.md](../compendium-editors/2026-05-28-proposal-system-reply.md)**.
  Build spec = their [cross-reference audit](../../docs/architecture/compendium-editors/proposal-cross-reference-audit.html)
  (matrix + 4-layer table) + the [design doc](2026-05-28-cross-referential-cluster-design.md).
  - **Part B** — route saves through the accumulator (skip `queueRebake` in
    block): `scaling_column` for **all six** owners **+ `feature`**.
  - **Part C** — draft overlays at **all four** picker layers (L1 Advancement /
    L2 Requirements / L3 SpellAdvancement / L4 EntityPicker).
  - **Fully unblocked** — `scaling_column` (all owners), `feature`, and
    `useProposalDraftOptions` are all on `main` (`aa4d0c8`). Both halves can
    proceed; our Part D (approval) runs in parallel and doesn't gate B/C.

## Handoff log

Newest at the top. Each entry: date + link to the handoff doc in this same folder.

- `2026-05-28` — **`feature` is now a proposable type** (`aa4d0c8` on `main`).
  Existing `features`-table entity registered in the allowlist + config +
  migration `20260528-1400` (local-only). compendium-editors is now fully
  unblocked for both halves (columns + features). Next on this branch: **Part D**
  (atomic approve + full guard #1 walk).
- `2026-05-28` — **Scope expanded to full coverage after compendium-editors'
  cross-reference audit.** Their audit showed "scaling_column only" left a
  proposed class as a feature-less shell + guard #1 covered ~⅓ of refs. Owner
  re-decided: **`feature` proposable too · full guard-#1 walk · all 6
  `scaling_column` owners · picker overlays at all 4 layers.** Design doc
  Decisions + Part D guard #1 updated; reply filed at
  [../compendium-editors/2026-05-28-proposal-system-reply.md](../compendium-editors/2026-05-28-proposal-system-reply.md).
  Next on this branch: add `feature` proposable type (Part A+) then Part D.
- `2026-05-28` — **Part A landed on `main`** (`b5237e1`). Reversed the earlier
  "held off main" call so `compendium-editors` can build B + C straight off
  `main` (no rebase-onto-branch needed). Part A stays inert in prod until B + C
  ship; the remote D1 migration still needs running — with go-ahead — before
  that point. `proposal-system` is now level with `main`.
- `2026-05-28` — [2026-05-28-compendium-editors-handoff.md](2026-05-28-compendium-editors-handoff.md):
  ready-to-pick-up spec for `compendium-editors` (Parts B + C) — plain-language
  summary + before/after code + the `useProposalDraftOptions` / `scaling_column`
  contracts + how to pull Part A. Open Request above points at it. Pushed to
  `main` so the branch can find it.
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

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

- _none yet_

## Handoff log

Newest at the top. Each entry: date + link to the handoff doc in this same folder.

- `2026-05-28` — branch (re)activated as `proposal-system`. Landed two fixes to main before the rename: `9cdf1c6` (scope block UI to `/proposals/edit/*` only — kill `useEntityWriter` global block-mode auto-promotion) + `3c0d6d2` (FeatsEditor proposal-mode CREATE scroll/undo preservation).

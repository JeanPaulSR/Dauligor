# Branch: `proposal-system`

Started: `2026-05-28`
Owner: `Claude`
Goal: `Own and evolve the content-proposals subsystem — queue/drafts/blocks, cascade engine, review mode, and proposal-mode editor wiring. Specific task per session.`
Status: `Part D shipped` — block-atomic approve + guard #1 reference-integrity walk landed on `main` (`b35705f`), incl. the AdminProposals Approve-/Reject-block UI. Pure logic unit-tested green **and the live data-layer e2e passed** (19/19) against local D1 through the real worker `env.DB.batch()` — see the log entry below. **R4** (atomic submit flush + fold-race closure) shipped `700f23a`; **F2-leftover** verified already-satisfied in the merged tree. The whole cross-referential-cluster feature is now functionally complete; only the **gated remote entity_type migrations** remain before prod.

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

- [~] `(2026-05-28→29)` **`compendium-editors`: implement Parts B + C — FULL SCOPE.**
  **Handed back `(2026-05-29)`** with the §3 coverage table
  ([2026-05-29-from-compendium-editors-s3-coverage.md](2026-05-29-from-compendium-editors-s3-coverage.md)):
  **Part B done** (scaling_column + feature saves route through the accumulator, on `main`),
  **Part C in progress** (scaling_column L1 + own-list overlays done; remaining L1–L4 overlays
  ongoing — not blocking Part D). Re-verified against landed code in
  [2026-05-29-handback-reverified-partD-ready.md](2026-05-29-handback-reverified-partD-ready.md).
  Still owed by them: rest of Part C; the e2e sample block (deferred to **after** Part D).
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

- `2026-05-30` — **Part D live e2e PASSED (19/19).** Drove the real approve path
  (guard #1 → `orderBlockRevisions` → `buildApprovedStatements` → one
  `env.DB.batch()`) against a real seeded *Druid + Wild Shape + scaling column +
  option group + option item + subclass* cluster, through the local wrangler
  worker into local D1 (FK enforcement ON). Verified: whole cluster lands
  atomically in FK-safe order (subclass after class, item after group — proves
  the topo-ordering live); `subclass.preview` round-trips (F3); all revisions
  flip to approved; guard #1 rejects a dangling parent ref; a bad-statement batch
  rolls back with nothing applied. Only gap vs a full UI run: the HTTP/admin-auth
  wrapper + the Approve-block button (admin Firebase login is out of scope for me
  to drive). Applied `subclass_preview` to local D1 to enable the F3 check.
  **Footgun spotted:** `worker/migrations/9999_cleanup.sql` is a destructive
  DROP-ALL helper sitting in `migrations_dir` — `wrangler d1 migrations apply`
  would run it last and wipe the DB (flagged for a separate fix).
- `2026-05-29` — **R4 shipped + F2-leftover verified done** (`700f23a` on `main`).
  R4(a): submit-side flush is now one atomic `env.DB.batch()` (no orphaned
  staging rows / dup-on-retry). R4(b): `BlockProvider.refresh()` returns the
  fresh drafts and `ProposalEditorWrapper` serializes flushes + adopts that
  return into a ref, closing the create→update fold cache-staleness race (which
  could otherwise double-POST a CREATE and break Part D's atomic approve on a PK
  clash). F2-leftover: verified the `/proposals/edit/option-groups` list route
  is already wrapped (`App.tsx:375`) and `UniqueOptionGroupList` already overlays
  block drafts via `useBlockDraftedList` — the merge resolved it, no change
  needed. Remaining: the Part D joint e2e (live atomic-batch run; mine to drive).
- `2026-05-29` — **Part D shipped** (`b35705f` on `main`). Block-atomic approve
  (`POST /api/admin/proposals/bundle/:id/approve` + `/reject`): guard #1
  reference-integrity walk → guard #2 per-revision drift → topological order →
  one atomic `env.DB.batch()` (all-or-nothing). `buildApprovedStatements` split
  out of `applyApprovedOperation` as the batch seam; `collectReferences` +
  `orderBlockRevisions` added; AdminProposals gains Approve-/Reject-block UI.
  Pure logic unit-tested green against the Druid+WildShape+column+group cluster
  (incl. F3 `preview` round-trip). Handed to compendium-editors for the joint
  e2e: [../compendium-editors/2026-05-29-partD-shipped.md](../compendium-editors/2026-05-29-partD-shipped.md).
  Documented guard-#1 boundary: advancement array fields (pool/optionalPool/
  excludedOptionIds) not walked yet — extend if those overlays land.
- `2026-05-29` — **Handback received + re-verified; Part D ready to build (held).**
  compendium-editors handed back the §3 coverage table
  ([2026-05-29-from-compendium-editors-s3-coverage.md](2026-05-29-from-compendium-editors-s3-coverage.md)).
  Branch fast-forwarded `7d41e5b → d55fc31` (B/C is on `main`, not branch-local). Re-verified the
  reference graph against the landed code:
  [2026-05-29-handback-reverified-partD-ready.md](2026-05-29-handback-reverified-partD-ready.md) —
  graph matches with reconciliations (advancement refs are 2-level: `advancements[].featureId` +
  `.configuration.{scalingColumnId,optionScalingColumnId,optionGroupId,usesFeatureId}`;
  `spell_rule_application` keys are `rule_id`/`applies_to_*`; scaling_column has 4 live parent_types
  not 6). Found **F3** — `subclass.writableColumns` missing `preview` (migration `20260529-1200` on
  `main`) → proposed subclass drops its blurb on approval (one-line fix, held with Part D). Confirmed
  **R4** — submit-side flush is non-atomic (`functions/api/proposals` `handleSubmit` line ~314).
  Build held pending explicit go-ahead.
- `2026-05-29` — **Part D paused; handed off to compendium-editors to finish B/C
  first.** [2026-05-29-partD-paused-awaiting-bc.md](2026-05-29-partD-paused-awaiting-bc.md)
  documents the full proposal-system state + the §3 checklist I need back at
  handback (final overlay coverage, queued payload shapes, parent_types in play,
  any new refs, a sample block) so guard #1 + the atomic approve are built
  against what's actually wired. Branch status → `paused`.
- `2026-05-29` — **Responded to compendium-editors' B/C follow-up** (reply:
  [../compendium-editors/2026-05-29-proposal-system-reply.md](../compendium-editors/2026-05-29-proposal-system-reply.md)).
  Shipped: **R1** — `scaling_column.writableColumns` += `type`/`identifier`/
  `distance_units` (a proposed dice column was losing its type on approval);
  **R3** — `ProposalEditorWrapper` block-entry gate (user directive: must have
  an active block before authoring; editor body replaced by a pick/create gate,
  `PickOrCreateBlockDialog` gains a `required` mode); **F1** —
  `useProposalAccumulator` reports `mode:'block'` in a wrapper so the toast says
  "added to block" not "submitted for review". **R2** confirmed in the design
  (guard #1 now names `feature.parent_id`→draft class/subclass). Open follow-up:
  routing-enforcement so content-creators can't reach a non-wrapped editor route
  (App.tsx — coordinate w/ system-applications + compendium-editors).
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

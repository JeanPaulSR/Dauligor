# `src/components/proposals/`

Components that make the proposal-mode editor experience work. The wrapper hosts the queue and provides accumulator context; everything else is presentation glued to that context.

For the full pattern + lifecycle, read [docs/architecture/proposal-editor-pattern.md](../../../docs/architecture/proposal-editor-pattern.md).

## Entry points

| Component | Responsibility |
|---|---|
| [`ProposalEditorWrapper.tsx`](ProposalEditorWrapper.tsx) | Mounted on every `/proposals/edit/*` route. Hosts the in-memory queue, exposes the [`ProposalAccumulatorContext`](../../lib/proposalAccumulator.ts), renders the `PROPOSAL EDITOR \| <entity>` header strip + Submit Changes button, gates `<fieldset disabled>` when in read-only review. |
| [`TombstoneRow.tsx`](TombstoneRow.tsx) | Two exports. `<TombstoneRow>` — compact row decorator with strikethrough name + Undo (used in catalog editor lists). `<DeletedEntityBanner>` — full banner for single-work editors above the disabled form. Both call back to `proposalContext.dropEntity(id)`. |
| [`ReviewBanner.tsx`](ReviewBanner.tsx) | Sticky header shown when the URL has `?review=<proposalId>`. Displays operation + status badges, proposed/reviewed timestamps, rejection reason, Close-review button. |
| [`PickOrCreateBlockDialog.tsx`](PickOrCreateBlockDialog.tsx) | Block picker that fires when the user tries to write with no active block. Lets them pick an existing open block or create a new one inline. |
| [`SubclassPickerDialog.tsx`](SubclassPickerDialog.tsx) | Two-step "pick parent class, then subclass" flow for the proposal launcher's Subclasses entry. Saves the user a hop into ClassEditor's subclass tab. |
| [`BlockMetadataDialog.tsx`](BlockMetadataDialog.tsx) | Name + description editor used for both "Start a new block" and "Rename block". |
| [`ProposalReviewProvider`](../../lib/proposalReview.tsx) | (Not in this directory but referenced here for completeness — mounted in App.tsx, exposes `useProposalReview()` to all editors.) |
| [`<ReviewFieldHighlight>`](../../lib/proposalReview.tsx) | Wraps a form field to apply a gold "Changed" badge when the field's column key was modified in the proposal being reviewed. |

## Drop Edits affordances (Phase 4.3)

Used inside editors to drop specific queued changes without abandoning the rest of the block.

| Component | Drops |
|---|---|
| `DropEntityButton` | All queued changes for one entity + any same-bundle server drafts for it |
| `DropSectionButton` | Multiple fields at once (e.g. "drop all my Spellcasting changes on this class") |
| `DropFieldIcon` | A single field's queued change |

All three are thin wrappers over `proposalContext.dropEntity` / `dropFields` / `dropField`.

## What's NOT in this directory

| What you might look for | Where it actually lives |
|---|---|
| `useProposalAccumulator` writer hook | [`src/lib/proposalAccumulator.ts`](../../lib/proposalAccumulator.ts) |
| `useBlock` (active block + drafts) | [`src/lib/proposalBlock.tsx`](../../lib/proposalBlock.tsx) |
| Server-side proposal endpoints | [`functions/api/proposals/[[path]].ts`](../../../functions/api/proposals/%5B%5Bpath%5D%5D.ts) |
| `MyProposals` page (launcher + submissions) | [`src/pages/core/MyProposals.tsx`](../../pages/core/MyProposals.tsx) |
| Admin review queue | [`src/pages/admin/AdminProposals.tsx`](../../pages/admin/AdminProposals.tsx) |
| Feature status + phase history | [`docs/features/content-proposals.md`](../../../docs/features/content-proposals.md) |

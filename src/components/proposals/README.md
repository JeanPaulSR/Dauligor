# `src/components/proposals/`

Components that make the proposal-mode editor experience work. The wrapper hosts the queue and provides accumulator context; everything else is presentation glued to that context.

For the full pattern + lifecycle, read [docs/architecture/proposal-editor-pattern.md](../../../docs/architecture/proposal-editor-pattern.md).

## Entry points

| Component | Responsibility |
|---|---|
| [`ProposalEditorWrapper.tsx`](ProposalEditorWrapper.tsx) | Mounted on every `/proposals/edit/*` route. Hosts the in-memory queue, exposes the [`ProposalAccumulatorContext`](../../lib/proposalAccumulator.ts), renders the `PROPOSAL EDITOR \| <entity>` header strip + Save Progress button, gates `<fieldset disabled>` when in read-only review. |
| [`ProposalAwareEditorHeader.tsx`](ProposalAwareEditorHeader.tsx) | Slim/h1 conditional section header for single-work editors. Locks the proposal-mode container className so it doesn't drift across editors. Pass `proposalTitle` + `adminContent` slots + right-side `children`. |
| [`TombstoneRow.tsx`](TombstoneRow.tsx) | Two exports. `<TombstoneRow>` — compact row decorator with strikethrough name + Undo (used in catalog editor lists). `<DeletedEntityBanner>` — full banner for single-work editors above the disabled form. Both call back to `proposalContext.dropEntity(id)`. |
| [`CascadeDependentBanner.tsx`](CascadeDependentBanner.tsx) | Amber banner shown when the entity an editor is showing is a cascade-enrolled dependent in the active block. Offers Accept (keep the auto-queued strip-the-reference) or Replace (open an entity-type-specific picker). Pairs with [`useCascadeDependent`](../../hooks/useCascadeDependent.ts). |
| [`TagReplacementPicker.tsx`](TagReplacementPicker.tsx) | Entity-type-specific replacement picker for the Replace flow. Defaults to same-group, with a cross-group escape hatch. Caller passes `arrayColumn` so the patch knows which JSON column to rewrite (`'tags'` for spells/feats/items; `'tag_ids'` for class/subclass). |
| [`ReviewBanner.tsx`](ReviewBanner.tsx) | Sticky header shown when the URL has `?review=<proposalId>`. Displays operation + status badges, proposed/reviewed timestamps, rejection reason, Close-review button. |
| [`PickOrCreateBlockDialog.tsx`](PickOrCreateBlockDialog.tsx) | Block picker that fires when the user tries to write with no active block. Lets them pick an existing open block or create a new one inline. |
| [`SubclassPickerDialog.tsx`](SubclassPickerDialog.tsx) | Two-step "pick parent class, then subclass" flow for the proposal launcher's Subclasses entry. Saves the user a hop into ClassEditor's subclass tab. |
| [`BlockMetadataDialog.tsx`](BlockMetadataDialog.tsx) | Name + description editor used for both "Start a new block" and "Rename block". |
| [`ProposalReviewProvider`](../../lib/proposalReview.tsx) | (Not in this directory but referenced here for completeness — mounted in App.tsx, exposes `useProposalReview()` to all editors.) |
| [`<ReviewFieldHighlight>`](../../lib/proposalReview.tsx) | Wraps a form field to apply a gold "Changed" badge when the field's column key was modified in the proposal being reviewed. |

## Companion hooks

These hooks live in `src/hooks/` but are conceptually part of the proposal-editor surface — they encode the contract that editors implement against the wrapper.

| Hook | Purpose |
|---|---|
| [`useProposalEntityDrafts(type)`](../../hooks/useProposalEntityDrafts.ts) | The `getDraftedEntities` overlay (byId / createdIds / deletedIds / deletedSources) for one entity type. Every editor needs this. |
| [`useDraftedEntityIds(type)`](../../hooks/useDraftedEntityIds.ts) | Union Set of ids touched in the active block — drives My-Drafts filter + row-highlight. |
| [`useProposalSingleWorkId(routeId)`](../../hooks/useProposalSingleWorkId.ts) | The `pendingCreateId` / `effectiveId` / `recordCreate` trio for single-work editors. |
| [`useProposalPreFlushSave({...})`](../../hooks/useProposalPreFlushSave.ts) | Registers `handleSave` as the wrapper's pre-flush callback (so Save Progress stages the current form before draining the queue). Variants for single-work (gate on `effectiveId`) and catalog (closure with dirty-check). |
| [`useEditBaseUnlocks({...})`](../../hooks/useEditBaseUnlocks.ts) | The "Edit Base [Name]" unlock state for catalog editors — returns `unlockedBaseIds` + `unlock(id)` + the derived `isReadOnly`. |
| [`useTombstoneBanner(type, id)`](../../hooks/useTombstoneBanner.ts) | The `isPendingDelete` flag + Undo callback for single-work editors that need the deleted banner. |
| [`useCascadeDependent(type, id)`](../../hooks/useCascadeDependent.ts) | When the entity is enrolled as a cascade dependent of some parent delete: returns the dependent draft + Accept/Replace orchestration. Null otherwise. |

The corresponding write-side helper:

| Helper | Purpose |
|---|---|
| [`applyProposalWrite(writer, payload, opts)`](../../lib/proposalAware.ts) | Narrow wrapper for the `writer.create({...payload, id}) / writer.update(id, payload)` + `actionLabel` toast pattern. Every editor's handleSave uses it for the proposal-mode branch. |

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

// =============================================================================
// useTombstoneBanner
// =============================================================================
//
// Wires single-work editors (Class, Subclass, UniqueOptionGroup) into
// the tombstone-banner UX without each editor re-implementing the same
// 3 pieces:
//   - Is THIS entity queued/drafted for deletion in the active block?
//   - The Undo handler that drops queue + draft entries
//   - The flag the editor uses to disable its `<fieldset>` form
//
// Caller pattern (canonical):
//
//   const { isPendingDelete, undoDelete } = useTombstoneBanner('class', id);
//   return (
//     <fieldset disabled={isPendingDelete || otherGate}>
//       {isPendingDelete && (
//         <DeletedEntityBanner
//           entityLabel="Class"
//           name={name || 'this class'}
//           onUndo={undoDelete}
//         />
//       )}
//       ... rest of form ...
//     </fieldset>
//   );
//
// See docs/architecture/proposal-editor-pattern.md ("Single-work
// editors" section) for the bigger picture. The hook is a no-op when
// `id` is null (the editor is on a create flow with no entity bound
// yet) or when not mounted under a <ProposalEditorWrapper>.
// =============================================================================

import { useCallback } from 'react';
import { useProposalContextOptional } from '../lib/proposalAccumulator';
import { useProposalEntityDrafts } from './useProposalEntityDrafts';
import type { ProposalEntityType } from '../lib/proposalAware';

export function useTombstoneBanner(
  entityType: ProposalEntityType,
  id: string | null | undefined,
): {
  isPendingDelete: boolean;
  undoDelete: () => Promise<void>;
} {
  const drafts = useProposalEntityDrafts(entityType);
  const ctx = useProposalContextOptional();
  const isPendingDelete = !!id && drafts.deletedIds.has(id);

  const undoDelete = useCallback(async () => {
    if (!id || !ctx) return;
    await ctx.dropEntity(id);
  }, [id, ctx]);

  return { isPendingDelete, undoDelete };
}

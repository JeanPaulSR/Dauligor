// =============================================================================
// useProposalSingleWorkId
// =============================================================================
//
// Collapses the `pendingCreateId` / `effectiveId` state used by every
// single-work proposal editor (ClassEditor, SubclassEditor,
// UniqueOptionGroupEditor). See the docs/architecture/proposal-editor-pattern.md
// "pendingCreateId convention" section for why this exists:
//
//   - After a CREATE in proposal mode the editor stays on `/new`
//     (navigating to `/edit/<id>` would unmount the wrapper and
//     destroy the in-memory queue). The locally-minted id is held in
//     `pendingCreateId` so subsequent saves UPDATE the same entry
//     instead of minting a fresh CREATE every click.
//   - `effectiveId = routeId ?? pendingCreateId` is what the rest of
//     the editor consults — the CREATE/UPDATE branch in handleSave,
//     the save-button label ("Save X" vs "Create X"), the form header.
//
// `pendingCreateId` resets when the route id changes (route remount
// is a fresh editor session, not a continuation).
//
// Usage:
//   const { effectiveId, pendingCreateId, recordCreate } =
//     useProposalSingleWorkId(id);
//
//   // In handleSave's CREATE branch after queuing:
//   recordCreate(saveId);
//
//   // In dep arrays that depend on the "current entity id":
//   useEffect(() => { ... }, [..., pendingCreateId]);
// =============================================================================

import { useEffect, useState, useCallback } from 'react';

export function useProposalSingleWorkId(routeId: string | undefined) {
  const [pendingCreateId, setPendingCreateId] = useState<string | null>(null);

  // Reset on route param change. When the URL changes from /new to
  // /edit/:id (after navigate) or the user navigates between two
  // /edit pages, the pendingCreateId from the prior session is no
  // longer relevant.
  useEffect(() => {
    setPendingCreateId(null);
  }, [routeId]);

  const recordCreate = useCallback((id: string) => {
    setPendingCreateId(id);
  }, []);

  return {
    effectiveId: routeId ?? pendingCreateId,
    pendingCreateId,
    recordCreate,
  };
}

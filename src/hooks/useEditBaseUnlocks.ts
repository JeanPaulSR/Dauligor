// =============================================================================
// useEditBaseUnlocks
// =============================================================================
//
// State + handlers for the "Edit Base [Name]" unlock pattern used by
// catalog editors with `enableFocusMode` (SpellsEditor, FeatsEditor,
// DevelopmentCompendiumManager).
//
// The wrapper exposes a Focus Mode toggle (In Block / Full Catalog).
// In Full Catalog mode, a row from the live catalog (a "base" entity
// the user didn't author) renders read-only — clicking "Edit Base"
// unlocks the form. The unlock is session-scoped: switching modes
// doesn't relock. The hook also flips Focus Mode to In Block so the
// catalog list rerenders with the just-unlocked entity visible
// alongside the user's other in-progress work.
//
// `isReadOnly` derives from:
//   - focusModeEnabled (the wrapper has enableFocusMode set)
//   - editingId (a live row is selected — new creates are always
//     editable)
//   - whether the user has explicitly unlocked it (`unlockedBaseIds`)
//   - whether they already have a queued/drafted change against it
//     (`draftedIds` — their own work is always editable)
//
// Pass `flipFocusOnUnlock: false` only if you have a positive reason —
// the canonical UX flips so the user's just-unlocked entity surfaces in
// the My Drafts list. Defaults to true.
// =============================================================================

import { useCallback, useState } from 'react';
import type { ProposalAccumulatorContextValue } from '../lib/proposalAccumulator';

export interface UseEditBaseUnlocksOpts {
  /** Whether the wrapper has enableFocusMode set — single source of
   *  truth for whether base-vs-drafts gating applies. */
  focusModeEnabled: boolean;
  /** Currently-selected entity id (null when on the New form). */
  editingId: string | null;
  /** Ids the user has already touched in the active block. From
   *  useDraftedEntityIds — pass it through so isReadOnly knows to
   *  treat the user's own work as always-editable. */
  draftedIds: Set<string>;
  /** The wrapper's accumulator context. Used to flip Focus Mode to
   *  'drafts' on unlock. Null when no wrapper (admin direct route);
   *  hook simply skips the flip. */
  proposalContext: ProposalAccumulatorContextValue | null;
  /** Whether unlocking should flip Focus Mode to 'drafts'. Default
   *  true (the canonical UX). Set false to opt out. */
  flipFocusOnUnlock?: boolean;
}

export function useEditBaseUnlocks(opts: UseEditBaseUnlocksOpts) {
  const [unlockedBaseIds, setUnlockedBaseIds] = useState<Set<string>>(new Set());

  const unlock = useCallback(
    (id: string) => {
      setUnlockedBaseIds((prev) => {
        if (prev.has(id)) return prev;
        const next = new Set(prev);
        next.add(id);
        return next;
      });
      // Flip Focus Mode so the catalog list rerenders with the just-
      // unlocked entity visible in My Drafts. Skip if the caller
      // opted out, or if there's no wrapper (admin direct route).
      const shouldFlip = opts.flipFocusOnUnlock ?? true;
      if (shouldFlip && opts.proposalContext?.setFocusMode) {
        opts.proposalContext.setFocusMode('drafts');
      }
    },
    [opts.proposalContext, opts.flipFocusOnUnlock],
  );

  const isReadOnly =
    opts.focusModeEnabled &&
    !!opts.editingId &&
    !unlockedBaseIds.has(opts.editingId) &&
    !opts.draftedIds.has(opts.editingId);

  return { unlockedBaseIds, unlock, isReadOnly };
}

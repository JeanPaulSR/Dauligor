// =============================================================================
// useProposalPreFlushSave
// =============================================================================
//
// Registers an editor's `handleSave` as a pre-flush callback on the
// active <ProposalEditorWrapper>. The wrapper calls all registered
// pre-flush callbacks IN ORDER before draining the queue on Submit
// Changes, which lets each editor stage its current in-progress form
// state into the queue without the user clicking Save first.
//
// Why this exists:
//
//   - Inside the wrapper, the per-editor Save button is hidden for
//     existing entities — Submit Changes takes its place. But the
//     queue only contains writes that the editor has explicitly
//     pushed via `writer.create/update`. Without a pre-flush, edits
//     the user typed but never explicitly saved fall on the floor at
//     submit time.
//   - The pre-flush is a `() => Promise<void>` that does a silent
//     `handleSave` against the queue. Validation errors surface via
//     `onError` (toast at callsite, generic in wrapper); other errors
//     are swallowed so a partial bundle still submits.
//
// Two callsite shapes:
//
//   - **Single-work editors** (Class / Subclass / UniqueOptionGroup):
//     gate on `effectiveId` so the pre-flush only fires when there's
//     an entity to save. Pass `shouldRun: () => !!effectiveId`.
//
//   - **Catalog editors** (Spells / Feats / DCM): gate on
//     `editingIdRef.current` AND a dirty-check against
//     `lastLoadedFormRef`. Pass a closure that reads those refs.
//
// The hook ref-mirrors both `handleSave` and `shouldRun` so the
// registered callback always reads the LATEST closures at flush time
// without re-registering on every render. Re-registration only
// happens when `enabled` or `proposalContext` change (e.g. mount /
// unmount).
//
// See docs/architecture/proposal-editor-pattern.md for the broader
// proposal-mode contract; the "Pre-flush" section is the contract this
// hook implements.
// =============================================================================

import { useEffect, useRef } from 'react';
import type { ProposalAccumulatorContextValue } from '../lib/proposalAccumulator';

export interface UseProposalPreFlushSaveOpts {
  /** Mode switch — typically `isProposalMode`. When false the hook is
   *  a no-op. */
  enabled: boolean;
  /** The wrapper's accumulator context. When null (no wrapper mounted)
   *  the hook is a no-op. */
  proposalContext: ProposalAccumulatorContextValue | null;
  /** The editor's main save function. Will be called with
   *  `(undefined, { silent: true })` at flush time. Ref-mirrored
   *  internally so re-renders don't require re-registration. */
  handleSave: (e?: any, opts?: { silent?: boolean }) => Promise<void> | void;
  /** Optional gate evaluated at flush time. Return false to skip the
   *  save (e.g. no entity loaded, or no edits since last load).
   *  Defaults to `() => true`. */
  shouldRun?: () => boolean;
  /** Optional error sink for catches inside the pre-flush. Defaults
   *  to a silent swallow — validation toasts already fire from
   *  handleSave's own early returns, and the wrapper surfaces a
   *  generic error for the bundle. Pass a logger here only if you
   *  want per-editor diagnostics. */
  onError?: (err: unknown) => void;
}

export function useProposalPreFlushSave(opts: UseProposalPreFlushSaveOpts): void {
  const handleSaveRef = useRef(opts.handleSave);
  const shouldRunRef = useRef(opts.shouldRun);
  const onErrorRef = useRef(opts.onError);

  // Refresh the refs every render so the registered callback uses
  // the latest closures. Without this, a callback registered on
  // mount would close over the mount-time handleSave and a stale
  // form snapshot would be flushed.
  useEffect(() => {
    handleSaveRef.current = opts.handleSave;
    shouldRunRef.current = opts.shouldRun;
    onErrorRef.current = opts.onError;
  });

  useEffect(() => {
    if (!opts.enabled || !opts.proposalContext) return;
    return opts.proposalContext.registerPreFlush(async () => {
      const should = shouldRunRef.current ? shouldRunRef.current() : true;
      if (!should) return;
      try {
        await handleSaveRef.current(undefined, { silent: true });
      } catch (err) {
        if (onErrorRef.current) onErrorRef.current(err);
      }
    });
  }, [opts.enabled, opts.proposalContext]);
}

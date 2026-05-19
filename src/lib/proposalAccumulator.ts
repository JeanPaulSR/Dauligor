// =============================================================================
// Proposal-editor accumulator — queues writes locally inside a
// <ProposalEditorWrapper> until the user clicks "Submit Changes."
// =============================================================================
//
// Phase 4.2 lays the foundation for the parallel `/proposals/edit/*`
// routes. The contract:
//
//   const writer = useProposalAccumulator('tag', userProfile);
//   await writer.create(payload);   // queues locally inside the wrapper
//   await writer.update(id, patch); // also queues
//   await writer.remove(id);        // also queues
//
// Outside a wrapper (e.g. the admin `/compendium/*/manage` route), the
// hook passes through to `useEntityWriter` unchanged — Save fires
// immediately, no behavior change.
//
// The wrapper's "Submit Changes" button calls `flush()` on the
// context, which drains the queue as one POST to /api/proposals with
// `is_draft: true` + the active `bundle_id`. If no block is open,
// the wrapper opens the PickOrCreateBlockDialog first.
//
// Drop Edits (Phase 4.3) plugs in here via `dropEntity` / `dropSection`
// / `dropField` on the context. For now the context exposes only
// `queueChange` + `flush` + dirty tracking by entity_id.
// =============================================================================

import { createContext, useCallback, useContext, useMemo } from 'react';
import { auth } from './firebase';
import {
  useEntityWriter,
  type ProposalEntityType,
  type WriterApi,
  type WriterMode,
} from './proposalAware';

export type QueuedChange = {
  /** Stable local id for tracking + future Drop Edits operations. */
  queue_id: string;
  entity_type: ProposalEntityType;
  /** null when operation === 'create' (no id yet). */
  entity_id: string | null;
  operation: 'create' | 'update' | 'delete';
  /** The new row shape; null for delete. */
  proposed_payload: Record<string, any> | null;
  notes_from_proposer: string | null;
};

export type ProposalAccumulatorContextValue = {
  /** Current queue of pending writes. */
  queue: QueuedChange[];
  /** Add a change to the queue. Returns the assigned queue_id. */
  queueChange: (change: Omit<QueuedChange, 'queue_id'>) => string;
  /**
   * Drain the queue against a bundle. Caller is the wrapper's Submit
   * Changes button; it resolves the bundle_id (existing or freshly
   * created) before calling.
   */
  flushToBundle: (bundleId: string) => Promise<{ submitted: number }>;
  /** Clear the queue without submitting (e.g. user discards the changes). */
  resetQueue: () => void;
  /** True while flushToBundle is mid-flight. */
  submitting: boolean;
};

/**
 * The context is null outside a <ProposalEditorWrapper>. The hook
 * returns the underlying useEntityWriter in that case, so editors
 * mounted on the admin `/compendium/*` routes keep their existing
 * direct-write behavior.
 */
export const ProposalAccumulatorContext =
  createContext<ProposalAccumulatorContextValue | null>(null);

/**
 * Drop-in replacement for `useEntityWriter` that queues calls when
 * mounted inside a <ProposalEditorWrapper> and passes through
 * otherwise.
 *
 * In proposal mode (inside a wrapper):
 *   - create/update/remove enqueue a QueuedChange and return synchronously
 *     (resolved Promise) with the id; the actual POST happens at
 *     Submit Changes time.
 *   - `writer.mode` is always 'proposal' to make the editor's UI
 *     conditionals straightforward (no Save button, render Drop
 *     Edits affordances, etc.).
 *
 * In direct mode (outside a wrapper): the returned object is the
 * unmodified useEntityWriter result, so admin/direct editors retain
 * their `direct` / `block` / `proposal` (single-revision) / `readonly`
 * dispatch.
 */
export function useProposalAccumulator(
  entityType: ProposalEntityType,
  effectiveProfile: any,
): WriterApi {
  const writer = useEntityWriter(entityType, effectiveProfile);
  const ctx = useContext(ProposalAccumulatorContext);

  return useMemo<WriterApi>(() => {
    if (!ctx) {
      // Not inside a wrapper — passthrough.
      return writer;
    }

    return {
      mode: 'proposal' as WriterMode,
      create: async (payload, opts) => {
        const id = payload.id ?? crypto.randomUUID();
        const { id: _drop, ...rest } = payload;
        ctx.queueChange({
          entity_type: entityType,
          entity_id: null,
          operation: 'create',
          proposed_payload: { ...rest, id },
          notes_from_proposer: opts?.notes ?? null,
        });
        return { id };
      },
      update: async (id, payload, opts) => {
        ctx.queueChange({
          entity_type: entityType,
          entity_id: id,
          operation: 'update',
          proposed_payload: payload,
          notes_from_proposer: opts?.notes ?? null,
        });
      },
      remove: async (id, opts) => {
        ctx.queueChange({
          entity_type: entityType,
          entity_id: id,
          operation: 'delete',
          proposed_payload: null,
          notes_from_proposer: opts?.notes ?? null,
        });
      },
    };
  }, [ctx, writer, entityType]);
}

/**
 * Internal helper used by ProposalEditorWrapper to do the actual POST.
 * Exported so tests / dev tools can drain a queue without going
 * through the wrapper's UI flow.
 */
export async function postQueuedChanges(
  queue: QueuedChange[],
  bundleId: string,
): Promise<{ submitted: number }> {
  if (queue.length === 0) return { submitted: 0 };
  if (queue.length > 50) {
    throw new Error(
      `Submit Changes drains up to 50 revisions at once; queue has ${queue.length}. Split into smaller batches.`,
    );
  }
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) throw new Error('Not signed in.');

  const res = await fetch('/api/proposals', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      revisions: queue.map((q) => ({
        entity_type: q.entity_type,
        entity_id: q.entity_id,
        operation: q.operation,
        proposed_payload: q.proposed_payload,
        notes_from_proposer: q.notes_from_proposer,
      })),
      bundle_id: bundleId,
      is_draft: true,
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      body?.error || `Failed to submit changes (HTTP ${res.status})`,
    );
  }
  return { submitted: queue.length };
}

/**
 * Hook callers don't typically need this — it's exported so the
 * wrapper's submit handler can build its handlers consistently with
 * the queueChange / resetQueue API.
 */
export function useQueueOperations(
  setQueue: (next: QueuedChange[] | ((prev: QueuedChange[]) => QueuedChange[])) => void,
) {
  const queueChange = useCallback(
    (change: Omit<QueuedChange, 'queue_id'>) => {
      const queue_id = `q-${crypto.randomUUID()}`;
      setQueue((q) => [...q, { ...change, queue_id }]);
      return queue_id;
    },
    [setQueue],
  );

  const resetQueue = useCallback(() => {
    setQueue([]);
  }, [setQueue]);

  return { queueChange, resetQueue };
}

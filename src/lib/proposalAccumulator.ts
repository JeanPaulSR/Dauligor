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
  /**
   * Effective entity id. For create operations this is the client-
   * minted id (also stored in `proposed_payload.id`) so Drop Edits
   * can target creates the same way as updates. The actual POST to
   * /api/proposals sends `entity_id: null` for creates — see
   * `postQueuedChanges`.
   */
  entity_id: string;
  operation: 'create' | 'update' | 'delete';
  /** The new row shape; null for delete. */
  proposed_payload: Record<string, any> | null;
  notes_from_proposer: string | null;
};

export type FocusMode = 'drafts' | 'browse';

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
  /* ------------------------------------------------------------- */
  /* Focus mode (multi-work editors only)                             */
  /* ------------------------------------------------------------- */
  /**
   * Whether this wrapper exposes a [ My Drafts | Browse Base ] toggle
   * at all. Single-work editors (ClassEditor, SubclassEditor) leave
   * this off — there's no catalog list to filter. Multi-work editors
   * with large catalogs (Spells, Feats, Items, Option Items) opt in.
   */
  focusModeEnabled: boolean;
  /**
   * 'drafts' = show only entries the user has staged in the active
   * block (queue + server-side drafts). 'browse' = show the live
   * catalog read-only (the editor renders disabled form fields and an
   * "Edit Base [Name]" button per entry). Defaults to 'drafts' when
   * `focusModeEnabled` is true; ignored otherwise.
   */
  focusMode: FocusMode;
  /** Caller (the wrapper's segmented toggle) sets the mode. */
  setFocusMode: (next: FocusMode) => void;
  /* ------------------------------------------------------------- */
  /* Drop Edits (Phase 4.3)                                          */
  /* ------------------------------------------------------------- */
  /**
   * True if any queued change targets this entity. Doesn't reflect
   * server-side drafts — those are visible via `useBlock().drafts`.
   */
  isEntityDirty: (entityId: string) => boolean;
  /**
   * True if the entity's queued change touches this field. False for
   * delete-operation queues (a delete has no field-level granularity).
   */
  isFieldDirty: (entityId: string, fieldName: string) => boolean;
  /**
   * Drop ALL queued changes for the given entity AND delete any
   * server-side draft revisions for it in the active bundle. The
   * editor is responsible for reverting its own in-memory state for
   * this entity (this hook only manipulates the queue + server drafts).
   */
  dropEntity: (entityId: string) => Promise<void>;
  /**
   * Drop a single field from the entity's queued change. If the
   * resulting payload has no fields other than `id`, the entry is
   * removed. Doesn't touch server-side drafts.
   */
  dropField: (entityId: string, fieldName: string) => void;
  /**
   * Drop multiple fields at once (section-level drop). Same semantics
   * as `dropField` per key.
   */
  dropFields: (entityId: string, fieldNames: string[]) => void;
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
          entity_id: id,
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
 * Hook for editor descendants that need direct access to the queue
 * + drop methods. Throws if used outside a <ProposalEditorWrapper> —
 * Drop Edits affordances only make sense in proposal mode.
 */
export function useProposalContext(): ProposalAccumulatorContextValue {
  const ctx = useContext(ProposalAccumulatorContext);
  if (!ctx) {
    throw new Error(
      'useProposalContext must be used inside <ProposalEditorWrapper>.',
    );
  }
  return ctx;
}

/**
 * Same as `useProposalContext` but returns null outside a wrapper.
 * Useful for shared editor components rendered on both admin and
 * proposal routes — the editor checks `ctx === null` to decide
 * whether to render Drop Edits affordances.
 */
export function useProposalContextOptional(): ProposalAccumulatorContextValue | null {
  return useContext(ProposalAccumulatorContext);
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
        // Creates carry their effective id in the queue (so Drop
        // Edits can target them) but the server expects entity_id=null
        // for create operations.
        entity_id: q.operation === 'create' ? null : q.entity_id,
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

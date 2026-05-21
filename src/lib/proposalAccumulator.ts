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
  /**
   * Register a callback that runs JUST BEFORE the wrapper flushes the
   * queue to drafts. The callback can call `queueChange` to add
   * entries that reflect the editor's current form state — this is
   * how Submit Changes replaces per-editor Save buttons. Returns a
   * deregistration function the caller uses in its useEffect
   * cleanup.
   *
   * Multiple editors can register at once (the wrapper invokes them
   * in registration order). Each callback may be sync or async; the
   * wrapper awaits the entire sequence before draining.
   */
  registerPreFlush: (callback: () => Promise<void> | void) => () => void;
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
 * Aggregated view of the user's in-progress proposal state for an
 * entity type. Merges the live in-memory queue with the active
 * block's server-side draft revisions so editors can present the
 * user's own work even before it's been submitted (let alone
 * approved).
 *
 * Returned shape:
 *   - `byId`: map of `entity_id` → effective `proposed_payload`. The
 *     queue overrides matching draft entries when both exist (since
 *     the queue is the most-recent uncommitted edit). For create
 *     operations the payload includes the local UUID at `payload.id`.
 *   - `createdIds`: ids the user is CREATING (no live row yet).
 *     Editors merge these as virtual catalog rows.
 *   - `deletedIds`: ids the user has marked for deletion. Editors
 *     should hide the live row from their list.
 *
 * **Important**: pass the active-block context (drafts + activeBundleId)
 * from `useBlock()` — the function can't reach into proposalBlock.tsx
 * without a circular import. Callers that don't care about server-
 * side drafts can pass `[]` and `null`.
 *
 * Outside a proposal wrapper this returns empty maps so editors can
 * call it unconditionally.
 */
export function getDraftedEntities(
  entityType: ProposalEntityType,
  ctx: ProposalAccumulatorContextValue | null,
  drafts: Array<{
    bundle_id: string | null;
    entity_type: string;
    entity_id: string | null;
    operation: 'create' | 'update' | 'delete';
    proposed_payload: Record<string, any> | null;
  }>,
  activeBundleId: string | null,
): {
  byId: Map<string, Record<string, any>>;
  createdIds: Set<string>;
  deletedIds: Set<string>;
} {
  const byId = new Map<string, Record<string, any>>();
  const createdIds = new Set<string>();
  const deletedIds = new Set<string>();

  // Pull server-side drafts in the active block first — they're the
  // older layer that the queue may then overlay on.
  //
  // CREATE drafts have `entity_id: null` on the server side because
  // the proposal endpoint forcibly nulls it (the entity doesn't exist
  // live yet, so there's no D1 row to point at). The actual id the
  // user minted client-side lives inside `proposed_payload.id`.
  // Falling back to that here is what makes a freshly-submitted
  // CREATE draft visible in the editor's list — without it, every
  // queued-then-flushed CREATE looks like it vanished on Submit
  // Changes.
  if (activeBundleId) {
    for (const d of drafts) {
      if (d.entity_type !== entityType) continue;
      if (d.bundle_id !== activeBundleId) continue;
      const effectiveId =
        d.entity_id ??
        (d.proposed_payload && typeof d.proposed_payload.id === 'string'
          ? d.proposed_payload.id
          : null);
      if (!effectiveId) continue;
      if (d.operation === 'delete') {
        deletedIds.add(effectiveId);
        byId.delete(effectiveId);
        continue;
      }
      if (d.proposed_payload) {
        byId.set(effectiveId, d.proposed_payload);
        if (d.operation === 'create') createdIds.add(effectiveId);
      }
    }
  }

  // Queue entries override drafts (the user's most-recent uncommitted
  // edit wins). A queued delete replaces / removes any draft payload.
  if (ctx) {
    for (const q of ctx.queue) {
      if (q.entity_type !== entityType) continue;
      if (!q.entity_id) continue;
      if (q.operation === 'delete') {
        deletedIds.add(q.entity_id);
        byId.delete(q.entity_id);
        createdIds.delete(q.entity_id);
        continue;
      }
      if (q.proposed_payload) {
        // For updates we merge on top of any draft payload — a queued
        // partial update wouldn't otherwise carry fields the draft
        // already filled. For creates we replace outright.
        if (q.operation === 'update' && byId.has(q.entity_id)) {
          byId.set(q.entity_id, {
            ...(byId.get(q.entity_id) || {}),
            ...q.proposed_payload,
          });
        } else {
          byId.set(q.entity_id, q.proposed_payload);
          if (q.operation === 'create') createdIds.add(q.entity_id);
        }
        deletedIds.delete(q.entity_id);
      }
    }
  }

  return { byId, createdIds, deletedIds };
}

/** Subset of `DraftRevision` (from proposalBlock) that we need to
 *  dedupe queue entries against existing drafts. Kept local so we
 *  don't pull a circular import on the BlockProvider module. */
export type ExistingDraftRef = {
  id: string;
  entity_type: string;
  entity_id: string | null;
  operation: 'create' | 'update' | 'delete';
  proposed_payload: Record<string, any> | null;
};

/**
 * Internal helper used by ProposalEditorWrapper to do the actual POST.
 * Exported so tests / dev tools can drain a queue without going
 * through the wrapper's UI flow.
 *
 * **Draft dedup (Phase 4.5d step 3):** if a queue entry targets the
 * same (entity_type, entity_id) as an existing server-side draft AND
 * both operations are create/update, we PATCH the draft's payload
 * instead of POSTing a new revision. This collapses "create then
 * edit" into a single CREATE draft rather than CREATE + UPDATE
 * polluting the bundle. Pass `existingDrafts` from `useBlock().drafts`
 * (filtered to the active block). Omit for back-compat (always POST).
 *
 * The other reconciliation cases (DELETE-after-CREATE → drop the
 * create draft; DELETE-after-UPDATE → swap to a fresh DELETE revision)
 * are not handled yet — they currently still POST a new revision and
 * leave the admin to resolve. TODO once we have real usage to gauge
 * how disruptive that is.
 */
export async function postQueuedChanges(
  queue: QueuedChange[],
  bundleId: string,
  existingDrafts: ExistingDraftRef[] = [],
): Promise<{ submitted: number }> {
  if (queue.length === 0) return { submitted: 0 };
  if (queue.length > 50) {
    throw new Error(
      `Submit Changes drains up to 50 revisions at once; queue has ${queue.length}. Split into smaller batches.`,
    );
  }
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) throw new Error('Not signed in.');
  const auth_header = `Bearer ${idToken}`;

  // Queue-internal dedup. The wrapper accumulates one QueuedChange
  // per writer call, so an editor that calls create() and then a
  // follow-up update() leaves both in the queue. Submitting an
  // UPDATE on an entity that doesn't exist in the live DB blows up
  // with a 404 ("Cannot propose update on missing …") — the server
  // tries to snapshot the live row and finds nothing.
  //
  // To collapse those into a single CREATE-with-the-final-payload,
  // we fold each (entity_type, entity_id) sequence:
  //   - CREATE + UPDATE…  → single CREATE with merged payload
  //   - UPDATE + UPDATE…  → single UPDATE with merged payload
  //   - …+ DELETE         → DELETE wins; drop any preceding entries
  //                          (CREATE-then-DELETE collapses to nothing)
  const dedupedQueue: QueuedChange[] = [];
  {
    type Key = string;
    const indexByKey = new Map<Key, number>();
    const keyOf = (q: QueuedChange) => `${q.entity_type}:${q.entity_id}`;
    for (const q of queue) {
      // Entries without an entity_id (legacy create-with-null) can't
      // be deduped — just pass them through. Real usage always sets
      // entity_id (creates mint a client-side UUID).
      if (!q.entity_id) {
        dedupedQueue.push(q);
        continue;
      }
      const key = keyOf(q);
      const priorIdx = indexByKey.get(key);
      if (priorIdx === undefined) {
        indexByKey.set(key, dedupedQueue.length);
        dedupedQueue.push(q);
        continue;
      }
      const prior = dedupedQueue[priorIdx];
      if (q.operation === 'delete') {
        if (prior.operation === 'create') {
          // CREATE then DELETE in the same block — drop both. The
          // entity never existed live; deleting it is a no-op.
          dedupedQueue.splice(priorIdx, 1);
          indexByKey.delete(key);
          // Reindex any deduped entries that shifted left.
          for (const [k, i] of indexByKey) {
            if (i > priorIdx) indexByKey.set(k, i - 1);
          }
        } else {
          // UPDATE then DELETE → keep the DELETE, drop the UPDATE.
          dedupedQueue[priorIdx] = q;
        }
        continue;
      }
      if (prior.operation === 'delete') {
        // DELETE then CREATE/UPDATE shouldn't normally happen, but
        // if it does, the later write wins so the row is recreated
        // / re-updated. Replace.
        dedupedQueue[priorIdx] = q;
        continue;
      }
      // Plain merge case: combine payloads, keep the earlier
      // operation. CREATE+UPDATE stays a CREATE; UPDATE+UPDATE stays
      // an UPDATE. The merged payload is what gets POSTed.
      dedupedQueue[priorIdx] = {
        ...prior,
        proposed_payload: {
          ...(prior.proposed_payload || {}),
          ...(q.proposed_payload || {}),
        },
        // Pick the more-recent notes — proposers update their notes
        // as they refine the change.
        notes_from_proposer: q.notes_from_proposer ?? prior.notes_from_proposer,
      };
    }
  }

  // Partition: queue entries that match an existing draft get PATCHed
  // (merging payloads); the rest get POSTed as new revisions.
  //
  // Special case: when the queue carries a DELETE for an entity whose
  // existing draft is a CREATE in the same block, the user is
  // un-proposing their own create. The right answer is to DROP the
  // existing draft entirely — there's no live row to delete, so
  // POSTing a new DELETE revision would 404 server-side ("Cannot
  // propose delete on missing $entity"). Track those drafts separately
  // so we can DELETE /api/proposals/:id for each.
  const draftPatches: { draftId: string; mergedPayload: Record<string, any> }[] = [];
  const draftDrops: string[] = [];
  const newRevisions: QueuedChange[] = [];

  for (const q of dedupedQueue) {
    if (q.operation === 'delete') {
      // DELETE: look up any existing CREATE/UPDATE draft. CREATE → drop
      // the draft (un-propose). UPDATE → drop the UPDATE draft AND
      // POST a fresh DELETE (the user wants to remove the live row,
      // not just abandon their changes to it).
      //
      // CREATE drafts carry `entity_id: null` server-side (the
      // proposal endpoint nulls it — there's no live row yet). So a
      // bare `d.entity_id === q.entity_id` lookup MISSES the CREATE
      // case, even though the client-minted UUID is sitting right
      // there in `proposed_payload.id`. Fall back to that, same as
      // `getDraftedEntities` does — otherwise deleting a tag/spell/
      // feat you just created in this block POSTs a doomed DELETE,
      // 404s, and the queue gets stuck at "N queued" forever.
      const existingDelete = existingDrafts.find((d) => {
        if (d.entity_type !== q.entity_type) return false;
        if (d.entity_id === q.entity_id) return true;
        if (d.entity_id == null && typeof d.proposed_payload?.id === 'string') {
          return d.proposed_payload.id === q.entity_id;
        }
        return false;
      });
      if (existingDelete?.operation === 'create') {
        draftDrops.push(existingDelete.id);
        continue;
      }
      if (existingDelete?.operation === 'update') {
        draftDrops.push(existingDelete.id);
        // fall through to POST the DELETE
      }
      newRevisions.push(q);
      continue;
    }
    // Same entity-id fallback for the UPDATE/CREATE-patch path:
    // patching an existing CREATE draft also needs the
    // proposed_payload.id fallback because the server-side draft's
    // entity_id is null.
    const existing = existingDrafts.find((d) => {
      if (d.entity_type !== q.entity_type) return false;
      if (d.operation !== 'create' && d.operation !== 'update') return false;
      if (d.entity_id === q.entity_id) return true;
      if (d.entity_id == null && typeof d.proposed_payload?.id === 'string') {
        return d.proposed_payload.id === q.entity_id;
      }
      return false;
    });
    if (existing && q.proposed_payload) {
      draftPatches.push({
        draftId: existing.id,
        mergedPayload: {
          ...(existing.proposed_payload || {}),
          ...q.proposed_payload,
        },
      });
    } else {
      newRevisions.push(q);
    }
  }

  // DROP drafts that are being un-proposed by a follow-up queue
  // DELETE. Done before POST so the draft set is consistent when the
  // server runs its own validation on the new revisions.
  if (draftDrops.length > 0) {
    await Promise.all(
      draftDrops.map((draftId) =>
        fetch(`/api/proposals/${encodeURIComponent(draftId)}`, {
          method: 'DELETE',
          headers: { Authorization: auth_header },
        }).then(async (res) => {
          // 404 is acceptable here — the draft may have been resolved
          // (approved / rejected) since the client cache was last
          // refreshed. The user's intent ("undo my proposal") is
          // still satisfied.
          if (!res.ok && res.status !== 404) {
            const body = await res.json().catch(() => ({}));
            throw new Error(
              body?.error || `Failed to withdraw draft ${draftId} (HTTP ${res.status})`,
            );
          }
        }),
      ),
    );
  }

  // PATCH existing drafts in parallel.
  if (draftPatches.length > 0) {
    await Promise.all(
      draftPatches.map((p) =>
        fetch(`/api/proposals/${encodeURIComponent(p.draftId)}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: auth_header,
          },
          body: JSON.stringify({ proposed_payload: p.mergedPayload }),
        }).then(async (res) => {
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(
              body?.error || `Failed to patch existing draft (HTTP ${res.status})`,
            );
          }
        }),
      ),
    );
  }

  if (newRevisions.length > 0) {
    const res = await fetch('/api/proposals', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: auth_header,
      },
      body: JSON.stringify({
        revisions: newRevisions.map((q) => ({
          entity_type: q.entity_type,
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

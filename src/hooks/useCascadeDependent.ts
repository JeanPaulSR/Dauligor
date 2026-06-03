// =============================================================================
// useCascadeDependent
// =============================================================================
//
// Detects whether the entity an editor is showing is a cascade-
// enrolled dependent in the active block, and exposes the
// orchestration for the Accept / Replace flow.
//
// A "cascade dependent" is a draft revision in the active block
// where `cascade_parent_revision_id IS NOT NULL`. The cascade engine
// (api/_lib/cascadeStrategies.ts) creates these automatically when
// the user submits a DELETE that affects other entities — e.g.
// deleting a tag enrolls every spell/class/feat that references it
// as a dependent UPDATE revision that strips the tag id.
//
// State machine:
//   - "needs review": dependent exists, payload has no resolved flag
//   - "resolved": dependent's proposed_payload has __cascade_resolved
//
// Accept (default): user keeps the auto-queued strip-the-reference
//   update. We PATCH the draft to mark `__cascade_resolved: true` so
//   the banner stops showing.
//
// Replace: user picks a replacement id, we PATCH the draft so its
//   proposed_payload swaps the deleted-entity id for the replacement
//   id (substituted into whatever array column the strategy was
//   modifying), then mark `__cascade_resolved: true`.
//
// The hook returns null when there's no matching dependent — most
// editors will see `null` most of the time. Banners check for the
// non-null return and render only then.
// =============================================================================

import { useCallback, useMemo, useState } from 'react';
import { useBlock } from '../lib/proposalBlock';
import { useProposalContextOptional } from '../lib/proposalAccumulator';
import type { DraftRevision } from '../lib/proposalBlock';
import { getSessionToken } from "../lib/auth";

export interface CascadeDependentState {
  /** The drafts row for this dependent. */
  dependent: DraftRevision;
  /** Description of WHY this dependent was enrolled, from the
   *  strategy's `description` field (stored on the draft as
   *  `notes_from_proposer`). */
  description: string;
  /** True when the user has already accepted or replaced. */
  resolved: boolean;
  /** Entity id of the PARENT delete that enrolled this dependent.
   *  Used by the Replace picker to scope its candidates (e.g.
   *  a tag-cascade picker hides the deleted tag from its list). */
  parentEntityId: string | null;
  /** Entity type of the parent delete. Same parent-context as
   *  above — used to pick the right replacement picker for cases
   *  where multiple strategies are wired. */
  parentEntityType: string | null;
  /** Mark the dependent resolved without changing the auto-queued
   *  strip-the-reference payload. */
  accept: () => Promise<void>;
  /** Rewrite the dependent's payload to substitute `replacementId`
   *  for `deletedId` in whichever array column the strategy was
   *  modifying. Marks resolved on success.
   *
   *  `deletedId` is the id of the parent entity being deleted — the
   *  caller knows it via the parent draft's entity_id / payload.id.
   *  `arrayColumn` is the snake_case column name (e.g. 'tags',
   *  'tag_ids') the strategy was editing — the caller knows it from
   *  the entity_type. */
  replace: (
    deletedId: string,
    replacementId: string,
    arrayColumn: string,
  ) => Promise<void>;
  /** Re-open the resolution (clears `__cascade_resolved`). Lets the
   *  user change their mind from Accept to Replace or vice versa. */
  reopen: () => Promise<void>;
}

export function useCascadeDependent(
  entityType: string,
  entityId: string | null | undefined,
): CascadeDependentState | null {
  const ctx = useProposalContextOptional();
  const { drafts, refresh } = useBlock();
  // Local optimistic-resolve so the banner closes immediately on
  // Accept/Replace without waiting for the round-trip + refresh.
  // The persisted state on the draft is the source of truth on
  // reload — this is just a UI smoother.
  const [optimisticResolved, setOptimisticResolved] = useState<Set<string>>(new Set());

  const dependent = useMemo<DraftRevision | null>(() => {
    if (!entityId) return null;
    // Outside <ProposalEditorWrapper> the user is on an admin-direct
    // route — block-level cascade banners shouldn't appear there even
    // if the admin has an unrelated block open with cascade drafts.
    if (!ctx) return null;
    return drafts.find(
      (d) =>
        d.entity_type === entityType &&
        d.entity_id === entityId &&
        !!d.cascade_parent_revision_id,
    ) ?? null;
  }, [ctx, drafts, entityType, entityId]);

  const persistedResolved =
    !!dependent?.proposed_payload &&
    (dependent.proposed_payload as any).__cascade_resolved === true;
  const resolved = persistedResolved || (dependent ? optimisticResolved.has(dependent.id) : false);

  const patchDraft = useCallback(
    async (draftId: string, nextPayload: Record<string, any>) => {
      const idToken = await getSessionToken();
      if (!idToken) throw new Error('Not signed in.');
      const res = await fetch(`/api/proposals/${encodeURIComponent(draftId)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ proposed_payload: nextPayload }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          body?.error || `Failed to update cascade dependent (HTTP ${res.status})`,
        );
      }
    },
    [],
  );

  const accept = useCallback(async () => {
    if (!dependent || !dependent.proposed_payload) return;
    setOptimisticResolved((prev) => new Set(prev).add(dependent.id));
    try {
      await patchDraft(dependent.id, {
        ...dependent.proposed_payload,
        __cascade_resolved: true,
      });
      await refresh();
    } catch (err) {
      // Roll back optimistic state on failure.
      setOptimisticResolved((prev) => {
        const next = new Set(prev);
        next.delete(dependent.id);
        return next;
      });
      throw err;
    }
  }, [dependent, patchDraft, refresh]);

  const replace = useCallback(
    async (deletedId: string, replacementId: string, arrayColumn: string) => {
      if (!dependent || !dependent.proposed_payload) return;
      const currentColumn = (dependent.proposed_payload as any)[arrayColumn];
      const currentArray = Array.isArray(currentColumn)
        ? currentColumn
        : typeof currentColumn === 'string'
          ? (() => {
              try {
                const parsed = JSON.parse(currentColumn);
                return Array.isArray(parsed) ? parsed : [];
              } catch {
                return [];
              }
            })()
          : [];
      // The auto-queued strip-the-reference already removed the
      // deleted id. We need to add the replacement back in (dedup
      // against entries the dependent already had).
      const withoutDeleted = currentArray.filter(
        (id: unknown) => typeof id === 'string' && id !== deletedId,
      );
      const nextArray = withoutDeleted.includes(replacementId)
        ? withoutDeleted
        : [...withoutDeleted, replacementId];

      setOptimisticResolved((prev) => new Set(prev).add(dependent.id));
      try {
        await patchDraft(dependent.id, {
          ...dependent.proposed_payload,
          [arrayColumn]: nextArray,
          __cascade_resolved: true,
        });
        await refresh();
      } catch (err) {
        setOptimisticResolved((prev) => {
          const next = new Set(prev);
          next.delete(dependent.id);
          return next;
        });
        throw err;
      }
    },
    [dependent, patchDraft, refresh],
  );

  const reopen = useCallback(async () => {
    if (!dependent || !dependent.proposed_payload) return;
    setOptimisticResolved((prev) => {
      const next = new Set(prev);
      next.delete(dependent.id);
      return next;
    });
    const { __cascade_resolved: _drop, ...rest } = dependent.proposed_payload as any;
    await patchDraft(dependent.id, rest);
    await refresh();
  }, [dependent, patchDraft, refresh]);

  if (!dependent) return null;
  // Resolve the parent revision so the caller knows which entity is
  // being deleted (the replace picker filters candidates against it).
  const parentDraft = dependent.cascade_parent_revision_id
    ? drafts.find((d) => d.id === dependent.cascade_parent_revision_id) ?? null
    : null;
  // For CREATE drafts the parent's entity_id is null server-side
  // (forced by the proposal endpoint); the actual id lives in
  // proposed_payload.id. Cascade parents are DELETEs though, so
  // entity_id is always present — but fall back defensively.
  const parentEntityId =
    parentDraft?.entity_id ??
    (parentDraft?.proposed_payload && typeof (parentDraft.proposed_payload as any).id === 'string'
      ? (parentDraft.proposed_payload as any).id as string
      : null);
  return {
    dependent,
    description: dependent.notes_from_proposer ?? 'This change was auto-enrolled by a parent delete.',
    resolved,
    accept,
    replace,
    reopen,
    parentEntityId,
    parentEntityType: parentDraft?.entity_type ?? null,
  };
}

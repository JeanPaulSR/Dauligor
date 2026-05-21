// =============================================================================
// Proposal-review mode — read-only replay of a past submission.
// =============================================================================
//
// When a content-creator visits an editor URL with `?review=<proposal_id>`
// they enter review mode: the editor renders the proposal's submitted
// payload instead of the live row, all inputs are disabled, and the
// fields that changed vs the snapshot at submit time get a highlight.
//
// Two exceptions to the read-only stance:
//   - Rejected proposals are editable so the proposer can fix the issue
//     and resubmit.
//   - The Close-review button (in the banner) exits to the same editor
//     URL without the param.
//
// The hook returns null when the URL has no `?review` param, so editors
// can guard their existing behavior with a single check.
// =============================================================================

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { useLocation } from 'react-router-dom';
import { auth } from './firebase';

export type ProposalReviewStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'withdrawn';

export type ProposalReviewData = {
  proposalId: string;
  status: ProposalReviewStatus;
  entityType: string;
  entityId: string | null;
  operation: 'create' | 'update' | 'delete';
  /** Snake-case D1 row shape as submitted (or null for delete proposals). */
  proposedPayload: Record<string, any> | null;
  /** Snake-case D1 row shape captured at submit time (null for creates). */
  snapshotAtProposal: Record<string, any> | null;
  rejectionReason: string | null;
  notesFromProposer: string | null;
  proposedAt: string;
  reviewedAt: string | null;
  /**
   * Set of column keys whose proposed value differs from the snapshot.
   * For create proposals this is every writable key. For delete
   * proposals it's empty (no proposed payload to compare).
   * Editors consume this to highlight changed fields visually.
   */
  changedFields: Set<string>;
  /**
   * True unless `status === 'rejected'`. Editors disable form controls
   * when this is true via a top-level `<fieldset disabled>`.
   */
  isReadOnly: boolean;
};

/**
 * Context shape consumed by editors. `null` when the current URL has
 * no `?review` param (or while loading), so a single conditional in
 * each editor handles "not in review mode" cleanly.
 */
const ProposalReviewContext = createContext<ProposalReviewData | null>(null);

/**
 * Hook for editors. Returns the loaded ProposalReviewData when the URL
 * carries `?review=<proposal_id>` AND the fetch resolved, else null.
 */
export function useProposalReview(): ProposalReviewData | null {
  return useContext(ProposalReviewContext);
}

/**
 * Helper for editor data-fetch effects. Returns the snake-case D1 row
 * shape the editor should populate its form from when the proposal
 * matches the entity being edited. Returns null when:
 *   - Not in review mode (URL has no `?review` param).
 *   - The proposal targets a different entity_type than `entityType`.
 *   - The proposal targets a different entity_id than `entityId`
 *     (single-work editors).
 *
 * Pass `entityId === null` for multi-work editors that want a match
 * regardless of which row id is on the proposal (the editor will
 * select the right row itself based on `reviewMode.entityId`).
 *
 * Delete proposals don't carry a `proposed_payload` — the user
 * "proposed to remove" the snapshot. Returns `snapshotAtProposal` for
 * delete operations so the editor shows what was being removed.
 */
export function resolveReviewPayload(
  reviewMode: ProposalReviewData | null,
  entityType: string,
  entityId: string | null,
): Record<string, any> | null {
  if (!reviewMode) return null;
  if (reviewMode.entityType !== entityType) return null;
  if (entityId !== null && reviewMode.entityId !== entityId) return null;
  if (reviewMode.operation === 'delete') return reviewMode.snapshotAtProposal;
  return reviewMode.proposedPayload;
}

/**
 * Hook helper for editor fields: returns true when the given column
 * key (snake_case D1 column name) is in the proposal's changedFields
 * set, i.e. the proposed value differs from the snapshot.
 *
 * Returns false outside review mode so callers can use the boolean
 * to drive a one-liner highlight without branching on `reviewMode`.
 *
 * Editors that store data in camelCase need to translate to snake_case
 * at the call site (e.g. `useFieldChanged('hit_die')` for `hitDie`).
 */
export function useFieldChanged(columnKey: string): boolean {
  const review = useContext(ProposalReviewContext);
  if (!review) return false;
  return review.changedFields.has(columnKey);
}

/**
 * Lightweight wrapper that highlights its child container when the
 * given column key was changed by the proposal. Use to wrap a field
 * (label + input) so reviewers can spot the diff at a glance.
 *
 * Renders nothing extra outside review mode or when the column wasn't
 * changed — the children pass through inside a plain <div>.
 */
export function ReviewFieldHighlight({
  columnKey,
  children,
  className,
}: {
  columnKey: string;
  children: ReactNode;
  className?: string;
}) {
  const changed = useFieldChanged(columnKey);
  const wrapperClass = changed
    ? `relative pl-3 border-l-2 border-gold/60 bg-gold/5 rounded-r-md py-2 pr-2 ${className ?? ''}`
    : (className ?? undefined);
  return (
    <div className={wrapperClass} data-review-changed={changed || undefined}>
      {changed && (
        <span className="inline-block mb-1 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest bg-gold/20 text-gold rounded">
          Changed
        </span>
      )}
      {children}
    </div>
  );
}

/**
 * Provider mounted at App-level so every route can opt-in via the
 * hook. Reads `?review=<id>` from the URL, fetches the proposal once
 * per id change, exposes the hydrated data via context.
 *
 * The fetch goes through GET /api/proposals/:id which already enforces
 * ownership (own + pending/resolved) — admins can also see others'
 * proposals via the same endpoint.
 */
export function ProposalReviewProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const proposalId = params.get('review');
  const [data, setData] = useState<ProposalReviewData | null>(null);

  useEffect(() => {
    if (!proposalId) {
      setData(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) return;
        const res = await fetch(
          `/api/proposals/${encodeURIComponent(proposalId)}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!res.ok) {
          console.warn(
            `[ProposalReview] /api/proposals/${proposalId} returned ${res.status}`,
          );
          if (!cancelled) setData(null);
          return;
        }
        const body = await res.json();
        const p = body?.proposal;
        if (!p || cancelled) return;
        const proposedPayload = p.proposed_payload ?? null;
        const snapshotAtProposal = p.snapshot_at_proposal ?? null;
        setData({
          proposalId: p.id,
          status: p.status,
          entityType: p.entity_type,
          entityId: p.entity_id,
          operation: p.operation,
          proposedPayload,
          snapshotAtProposal,
          rejectionReason: p.rejection_reason ?? null,
          notesFromProposer: p.notes_from_proposer ?? null,
          proposedAt: p.proposed_at,
          reviewedAt: p.reviewed_at ?? null,
          changedFields: computeChangedFields(
            proposedPayload,
            snapshotAtProposal,
            p.operation,
          ),
          isReadOnly: p.status !== 'rejected',
        });
      } catch (err) {
        console.error('[ProposalReview] failed to load proposal:', err);
        if (!cancelled) setData(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [proposalId]);

  return (
    <ProposalReviewContext.Provider value={data}>
      {children}
    </ProposalReviewContext.Provider>
  );
}

/**
 * Compute the set of keys whose value differs between the proposed
 * payload and the snapshot. Server-managed timestamps (created_at,
 * updated_at, id) are always excluded so they don't show up as
 * "changes" — proposed_payload always has a fresh updated_at.
 *
 * - create: every key in proposedPayload counts (there's no
 *   pre-existing snapshot to compare against).
 * - update: keys where deepEqual is false.
 * - delete: empty set (no proposed payload to compare).
 */
function computeChangedFields(
  proposed: Record<string, any> | null,
  snapshot: Record<string, any> | null,
  operation: 'create' | 'update' | 'delete',
): Set<string> {
  const changed = new Set<string>();
  if (operation === 'delete' || !proposed) return changed;
  const isServerManaged = (k: string) =>
    k === 'id' || k === 'updated_at' || k === 'created_at';
  if (!snapshot) {
    for (const k of Object.keys(proposed)) {
      if (isServerManaged(k)) continue;
      changed.add(k);
    }
    return changed;
  }
  for (const k of Object.keys(proposed)) {
    if (isServerManaged(k)) continue;
    if (!deepEqual(proposed[k], snapshot[k])) changed.add(k);
  }
  return changed;
}

/**
 * Cheap deep-equality via JSON serialization. Adequate for proposal
 * payloads (no functions, no Dates that aren't already strings, no
 * undefined cycles). Falls back to false if either side can't be
 * stringified — which would itself indicate a mismatched shape.
 */
function deepEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

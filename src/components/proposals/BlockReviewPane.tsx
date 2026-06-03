// =============================================================================
// BlockReviewPane — the shared "Option C" split-pane block review.
// =============================================================================
//
// One split-pane review surface, used by BOTH sides of the proposal flow:
//
//   - Admin review (src/pages/admin/AdminProposals.tsx → BlockReview): an
//     admin triaging a submitted block. Per-revision actions = Approve / Reject.
//   - Creator self-review (src/components/proposals/BlockReviewBody.tsx): a
//     content-creator reviewing their OWN block (inline in the active block
//     card on My Proposals). Per-revision actions = Remove-from-block /
//     Open-in-editor; the block's Submit lives in the card header.
//
// The two surfaces render the SAME pane so "what the creator sees" is exactly
// "what the admin sees". Only the surrounding chrome (header + footer) and the
// per-revision action buttons differ — those are slotted by the caller.
//
// What this component owns:
//   - the left rail (changes grouped by entity type, first-seen order),
//   - the right detail pane (field-level FieldDiff of the selected change),
//   - selection state + keyboard-free prev/next stepping + the "N / M" counter.
//
// What the caller owns (passed in):
//   - `revisions`        — the normalized change list (admin Proposal[] or
//                          creator DraftRevision[], both satisfy ReviewRevision),
//   - `renderRevisionActions(rev)` — the footer buttons in the detail pane
//                          (return null to render no action footer, e.g. for an
//                          already-resolved revision),
//   - the Card / Dialog wrapper + its header + its block-level footer.
//
// FieldDiff, OperationBadge, StatusBadge, ENTITY_LABEL and describePayloadSummary
// live here too (they were AdminProposals-local until the creator side needed
// them) so there is ONE copy of each. See docs/architecture/proposal-editor-pattern.md.
// =============================================================================

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '../ui/button';
import { formatSqliteLocal } from '../../lib/sqliteTimestamps';
import type { ProposalEntityType } from '../../lib/proposalAware';
import {
  humanizeFieldLabel,
  meaningfulEntries,
  isBlankValue,
  NOISE_FIELDS,
  FriendlyValue,
  type RefNames,
} from './proposalReviewFormat';

// The proposable entity-type union is canonical in proposalAware.ts; the review
// layer keys its label map off it so a new proposable type can't be added
// without also giving it a review label.
export type ReviewEntityType = ProposalEntityType;
export type ReviewOperation = 'create' | 'update' | 'delete';
// Drafts (creator side) carry 'draft'; the admin queue carries the rest.
export type ReviewStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'withdrawn';

// The minimal shape the pane needs. Admin's `Proposal` and the block
// `DraftRevision` are both structural supersets of this — pass either.
export type ReviewRevision = {
  id: string;
  entity_type: ReviewEntityType;
  entity_id: string | null;
  operation: ReviewOperation;
  proposed_payload: Record<string, any> | null;
  /** Live row state captured when the revision was authored. Drives the
   *  before→after strikethrough on UPDATEs. Absent ⇒ no "before" shown. */
  snapshot_at_proposal?: Record<string, any> | null;
  proposed_at?: string | null;
  status?: ReviewStatus;
  notes_from_proposer?: string | null;
  rejection_reason?: string | null;
  // Denormalized proposer identity (admin side only — a creator reviewing
  // their own block doesn't need to be told the author is themselves).
  proposer_display_name?: string | null;
  proposer_username?: string | null;
  proposed_by_user_id?: string | null;
  cascade_parent_revision_id?: string | null;
};

export const ENTITY_LABEL: Record<ReviewEntityType, string> = {
  tag: 'Tag',
  tag_group: 'Tag Group',
  spell_rule: 'Spell Rule',
  spell_rule_application: 'Rule Application',
  spell: 'Spell',
  class: 'Class',
  subclass: 'Subclass',
  feat: 'Feat',
  item: 'Item',
  unique_option_group: 'Option Group',
  unique_option_item: 'Option Item',
  scaling_column: 'Scaling Column',
  feature: 'Feature',
};

// Human label for a revision's target: prefer the payload name, then slug,
// then the entity id, then a placeholder. Shared so the rail row, the detail
// header and the admin queue rows all read identically.
export function describePayloadSummary(p: Pick<ReviewRevision, 'proposed_payload' | 'entity_id'>): string {
  const payload = p.proposed_payload;
  const name = payload && typeof payload === 'object' ? payload.name : undefined;
  const slug = payload && typeof payload === 'object' ? payload.slug : undefined;
  if (typeof name === 'string') return name;
  if (typeof slug === 'string') return slug;
  if (p.entity_id) return p.entity_id;
  return '(no preview)';
}

export function OperationBadge({ operation }: { operation: ReviewOperation }) {
  const classes: Record<ReviewOperation, string> = {
    create: 'bg-emerald-700/15 text-emerald-700 border-emerald-700/30',
    update: 'bg-archive-blue/15 text-archive-blue border-archive-blue/30',
    delete: 'bg-blood/15 text-blood border-blood/30',
  };
  return (
    <span className={`text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded border ${classes[operation]}`}>
      {operation}
    </span>
  );
}

export function StatusBadge({ status }: { status: ReviewStatus }) {
  const classes: Record<ReviewStatus, string> = {
    draft: 'bg-blood/10 text-blood border-blood/30',
    pending: 'bg-gold/10 text-gold border-gold/30',
    approved: 'bg-emerald-700/10 text-emerald-700 border-emerald-700/30',
    rejected: 'bg-blood/10 text-blood border-blood/30',
    withdrawn: 'bg-ink/5 text-ink/50 border-ink/20',
  };
  return (
    <span className={`text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded border ${classes[status]}`}>
      {status}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* FieldDiff — field-level before→after for one revision.                      */
/*                                                                              */
/* delete → renders the snapshot (or payload) that approval would remove.       */
/* update → changed fields highlighted emerald w/ struck-through old value;     */
/*          unchanged fields collapsed under a <details>.                       */
/* create → every field listed (no "before").                                  */
/* -------------------------------------------------------------------------- */

function isObjVal(v: any): boolean { return v !== null && typeof v === 'object'; }

export function FieldDiff({
  revision,
  refNames,
}: {
  revision: ReviewRevision;
  refNames?: RefNames;
}) {
  const after = isObjVal(revision.proposed_payload) ? (revision.proposed_payload as Record<string, any>) : {};
  const before = isObjVal(revision.snapshot_at_proposal) ? (revision.snapshot_at_proposal as Record<string, any>) : null;

  // DELETE — show the meaningful fields of the entry approval would remove.
  if (revision.operation === 'delete') {
    const entries = meaningfulEntries(before ?? after).filter(([k]) => k !== 'name');
    return (
      <div>
        <p className="text-sm text-blood/80 mb-3">Approving this <b>deletes</b> the entry below.</p>
        {entries.length === 0 ? (
          <p className="text-sm text-ink/50 italic">No further detail.</p>
        ) : (
          <dl className="space-y-2.5">
            {entries.map(([k, v]) => (
              <div key={k} className="text-sm">
                <dt className="text-[10px] uppercase tracking-widest text-ink/45">{humanizeFieldLabel(k)}</dt>
                <dd className="text-ink/70 mt-0.5"><FriendlyValue fieldKey={k} value={v} refNames={refNames} entityType={revision.entity_type} /></dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    );
  }

  // UPDATE — only the changed fields (before → after); unchanged collapsed.
  if (revision.operation === 'update' && before) {
    const keys = Array.from(new Set([...Object.keys(after), ...Object.keys(before)])).filter(
      (k) => !NOISE_FIELDS.has(k),
    );
    const changedKeys = keys.filter((k) => JSON.stringify(after[k]) !== JSON.stringify(before[k]));
    const sameKeys = keys.filter(
      (k) => JSON.stringify(after[k]) === JSON.stringify(before[k]) && !isBlankValue(after[k]),
    );
    return (
      <div className="space-y-4">
        {changedKeys.length === 0 ? (
          <p className="text-sm text-ink/50 italic">No field changes (only metadata differs).</p>
        ) : (
          <dl className="space-y-2.5">
            {changedKeys.map((k) => (
              <div key={k} className="text-sm rounded p-2.5 bg-emerald-700/[0.06] border border-emerald-700/20">
                <dt className="text-[10px] uppercase tracking-widest text-ink/45 flex items-center gap-2">
                  {humanizeFieldLabel(k)}
                  <span className="text-[9px] text-emerald-700 font-bold normal-case tracking-normal">changed</span>
                </dt>
                <dd className="text-blood/70 line-through opacity-80 mt-1">
                  <FriendlyValue fieldKey={k} value={before[k]} refNames={refNames} entityType={revision.entity_type} />
                </dd>
                <dd className="mt-1 text-emerald-800">
                  <FriendlyValue fieldKey={k} value={after[k]} refNames={refNames} entityType={revision.entity_type} />
                </dd>
              </div>
            ))}
          </dl>
        )}
        {sameKeys.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-xs text-ink/45 hover:text-ink/70">
              {sameKeys.length} unchanged field{sameKeys.length === 1 ? '' : 's'}
            </summary>
            <dl className="space-y-2 mt-2 opacity-70">
              {sameKeys.map((k) => (
                <div key={k}>
                  <dt className="text-[10px] uppercase tracking-widest text-ink/40">{humanizeFieldLabel(k)}</dt>
                  <dd className="text-ink/60 mt-0.5"><FriendlyValue fieldKey={k} value={after[k]} refNames={refNames} entityType={revision.entity_type} /></dd>
                </div>
              ))}
            </dl>
          </details>
        )}
      </div>
    );
  }

  // CREATE — every meaningful field (the name is already in the detail header).
  const entries = meaningfulEntries(after).filter(([k]) => k !== 'name');
  return (
    <div>
      {entries.length === 0 ? (
        <p className="text-sm text-ink/50 italic">No details beyond the name.</p>
      ) : (
        <dl className="space-y-2.5">
          {entries.map(([k, v]) => (
            <div key={k} className="text-sm rounded p-2.5 border border-gold/10">
              <dt className="text-[10px] uppercase tracking-widest text-ink/45">{humanizeFieldLabel(k)}</dt>
              <dd className="mt-1 text-ink/80"><FriendlyValue fieldKey={k} value={v} refNames={refNames} entityType={revision.entity_type} /></dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* BlockReviewPane — the split-pane itself (rail + detail).                     */
/* -------------------------------------------------------------------------- */

export type BlockReviewPaneProps = {
  revisions: ReviewRevision[];
  loading?: boolean;
  /** Rail copy when there are zero revisions. */
  emptyLabel?: string;
  /**
   * Extra id→name entries to resolve references against, beyond what the
   * block's own revisions provide. Used to feed in fetched tag names (and
   * could carry other live-entity names) so `tag_ids` etc. show names, not
   * slugs. Block revisions take precedence on id collisions.
   */
  extraRefNames?: RefNames;
  /** Per-revision action buttons rendered in the detail footer. Return null
   *  to render no footer (e.g. an already-approved revision on the admin side,
   *  or a context with no available actions). */
  renderRevisionActions?: (revision: ReviewRevision) => ReactNode;
  /** Min-height of the split region. Admin uses the default; the creator
   *  dialog overrides to fit the dialog viewport. */
  minHeightClass?: string;
  /** Max-height of the independently-scrolling rail + detail columns. */
  scrollMaxHeightClass?: string;
};

export function BlockReviewPane({
  revisions,
  loading = false,
  emptyLabel = 'No changes in this block.',
  renderRevisionActions,
  extraRefNames,
  minHeightClass = 'min-h-[460px]',
  scrollMaxHeightClass = 'max-h-[72vh]',
}: BlockReviewPaneProps) {
  const [selId, setSelId] = useState<string | null>(null);
  // Keep a valid selection as the list changes (initial load, a removed
  // revision, a switched block). Default to the first revision.
  useEffect(() => {
    if (revisions.length && !revisions.some((r) => r.id === selId)) setSelId(revisions[0].id);
    if (!revisions.length) setSelId(null);
  }, [revisions, selId]);

  const idx = revisions.findIndex((r) => r.id === selId);
  const sel = idx >= 0 ? revisions[idx] : null;
  const go = (delta: number) => {
    const n = idx + delta;
    if (n >= 0 && n < revisions.length) setSelId(revisions[n].id);
  };

  // Group the rail by entity type, preserving first-seen order.
  const groups = useMemo(() => {
    const m = new Map<ReviewEntityType, ReviewRevision[]>();
    for (const r of revisions) {
      if (!m.has(r.entity_type)) m.set(r.entity_type, []);
      m.get(r.entity_type)!.push(r);
    }
    return Array.from(m.entries());
  }, [revisions]);

  // id → name across every revision in this block, so FieldDiff can resolve
  // cross-references (a class advancement's featureId → "Wild Shape") to names
  // when the referenced entity is itself a draft/revision in the same block.
  // Effective id = entity_id (update/delete) or proposed_payload.id (create).
  const refNames = useMemo<RefNames>(() => {
    const m = new Map<string, string>();
    // Seed with externally-supplied names (e.g. fetched tags); block revisions
    // below override on id collision.
    if (extraRefNames) for (const [k, v] of extraRefNames) m.set(k, v);
    for (const r of revisions) {
      const payload = r.proposed_payload as Record<string, any> | null;
      const name = payload && (payload.name || payload.title);
      if (!name) continue;
      const eid = r.entity_id || (payload && typeof payload.id === 'string' ? payload.id : null);
      if (eid) m.set(String(eid), String(name));
    }
    return m;
  }, [revisions, extraRefNames]);

  const author = sel
    ? sel.proposer_display_name || sel.proposer_username || sel.proposed_by_user_id || null
    : null;
  const actions = sel && renderRevisionActions ? renderRevisionActions(sel) : null;

  return (
    <div className={`flex flex-col md:flex-row border-t border-gold/10 ${minHeightClass}`}>
      {/* Left rail — changes grouped by type */}
      <div className={`md:w-72 shrink-0 border-b md:border-b-0 md:border-r border-gold/10 bg-gold/[0.03] overflow-y-auto min-h-0 ${scrollMaxHeightClass}`}>
        {loading ? (
          <p className="text-ink/50 italic text-center py-12 text-sm">Loading…</p>
        ) : revisions.length === 0 ? (
          <p className="text-ink/50 italic text-center py-12 text-sm">{emptyLabel}</p>
        ) : (
          groups.map(([type, items]) => (
            <div key={type}>
              <p className="px-3 pt-3 pb-1 text-[10px] uppercase tracking-widest text-gold/70">
                {ENTITY_LABEL[type]} · {items.length}
              </p>
              {items.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelId(p.id)}
                  className={`w-full text-left px-3 py-2 flex items-center gap-2 border-l-2 transition-colors ${
                    p.id === selId ? 'bg-gold/10 border-gold' : 'border-transparent hover:bg-gold/5'
                  }`}
                >
                  <OperationBadge operation={p.operation} />
                  <span className="text-sm truncate flex-1 min-w-0">{describePayloadSummary(p)}</span>
                  {p.status && p.status !== 'pending' && p.status !== 'draft' && <StatusBadge status={p.status} />}
                </button>
              ))}
            </div>
          ))
        )}
      </div>

      {/* Right detail — field-level diff of the selected change */}
      <div className={`flex-1 min-w-0 overflow-y-auto min-h-0 ${scrollMaxHeightClass} p-5`}>
        {sel ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3 flex-wrap">
              <OperationBadge operation={sel.operation} />
              <h3 className="text-base font-medium flex-1 min-w-0 truncate">
                {ENTITY_LABEL[sel.entity_type]} · {describePayloadSummary(sel)}
              </h3>
              {sel.status && <StatusBadge status={sel.status} />}
              <div className="flex items-center gap-1">
                <Button size="xs" variant="outline" onClick={() => go(-1)} disabled={idx <= 0} className="px-2">
                  <ChevronLeft className="w-3.5 h-3.5" />
                </Button>
                <span className="text-[11px] text-ink/50 tabular-nums px-1">{idx + 1} / {revisions.length}</span>
                <Button size="xs" variant="outline" onClick={() => go(1)} disabled={idx >= revisions.length - 1} className="px-2">
                  <ChevronRight className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
            {/* Per-revision actions sit at the TOP so they're reachable
                immediately — no scrolling past a long field diff to find them. */}
            {actions && (
              <div className="flex flex-wrap gap-2 pb-3 border-b border-gold/10">
                {actions}
              </div>
            )}
            {(author || sel.proposed_at) && (
              <p className="text-xs text-ink/55">
                {author ? <>by <span className="font-medium text-ink/75">{author}</span></> : 'staged'}
                {sel.proposed_at && <>{' · '}{formatSqliteLocal(sel.proposed_at)}</>}
              </p>
            )}
            {sel.notes_from_proposer && (
              <div className="p-3 rounded bg-gold/5 border border-gold/10 text-sm">
                <p className="text-[10px] uppercase tracking-widest text-gold/70 mb-1">Notes from proposer</p>
                <p className="whitespace-pre-wrap">{sel.notes_from_proposer}</p>
              </div>
            )}
            {sel.rejection_reason && (
              <div className="p-3 rounded bg-blood/5 border border-blood/10 text-sm">
                <p className="text-[10px] uppercase tracking-widest text-blood/70 mb-1">Rejection reason</p>
                <p className="whitespace-pre-wrap">{sel.rejection_reason}</p>
              </div>
            )}

            <FieldDiff revision={sel} refNames={refNames} />
          </div>
        ) : (
          <p className="text-ink/50 italic text-center py-16">Select a change on the left to review it.</p>
        )}
      </div>
    </div>
  );
}

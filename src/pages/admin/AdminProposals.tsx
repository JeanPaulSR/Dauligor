// =============================================================================
// Admin Proposals — review queue for content-creator submissions.
// =============================================================================
//
// Admins land here from the navbar to triage pending revisions
// submitted via POST /api/proposals. Per-entity tabs split the
// queue (Tags / Tag Groups / Spell Rules / Spell Rule Applications /
// Class Spell Lists) so the reviewer focuses on one entity shape at
// a time. A "Show resolved" toggle surfaces approved / rejected /
// withdrawn rows once they've been handled.
//
// Approve / reject happens inline. When the server reports a
// conflict on approve (snapshot vs current row drift), we surface
// a 3-way diff modal so the admin can compare what the proposer
// saw, what's there now, and what they wanted to write.
// =============================================================================

import { useState, useEffect, useMemo, useCallback } from 'react';
import { toast } from 'sonner';
import { auth } from '../../lib/firebase';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import {
  Dialog, DialogContent, DialogContentLarge, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '../../components/ui/dialog';
import { Textarea } from '../../components/ui/textarea';
import { Inbox, Check, X, AlertTriangle, Undo2, ChevronRight, ChevronLeft, Tags as TagsIcon, ListChecks, Sparkles, Layers, BookOpen, Wand2, Shield, Award, Star, Package, Boxes, Repeat, Columns3, Zap } from 'lucide-react';
import { formatSqliteLocal } from '../../lib/sqliteTimestamps';
// Shared "Option C" review primitives — one copy, used here and by the
// creator-side BlockReviewBody. See BlockReviewPane.tsx.
import {
  BlockReviewPane,
  OperationBadge,
  StatusBadge,
  ENTITY_LABEL,
  describePayloadSummary,
} from '../../components/proposals/BlockReviewPane';

type EntityType =
  | 'tag'
  | 'tag_group'
  | 'spell_rule'
  | 'spell_rule_application'
  | 'spell'
  | 'class'
  | 'subclass'
  | 'feat'
  | 'item'
  | 'unique_option_group'
  | 'unique_option_item'
  | 'scaling_column'
  | 'feature';

type Operation = 'create' | 'update' | 'delete';

type Status = 'pending' | 'approved' | 'rejected' | 'withdrawn';

type Proposal = {
  id: string;
  bundle_id: string | null;
  proposed_by_user_id: string;
  proposer_username: string | null;
  proposer_display_name: string | null;
  proposed_at: string;
  status: Status;
  entity_type: EntityType;
  entity_id: string | null;
  operation: Operation;
  proposed_payload: Record<string, any> | null;
  snapshot_at_proposal: Record<string, any> | null;
  reviewed_by_user_id: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  pinned_at: string | null;
  notes_from_proposer: string | null;
  cascade_parent_revision_id: string | null;
};

// Synthetic bundle id used to represent orphan revisions (those with
// bundle_id IS NULL or whose bundle has no proposal_bundles metadata
// row). Lets the UI reuse the same "selected bundle → revisions list"
// flow without inventing a new view state.
const ORPHANS_PSEUDO_BUNDLE_ID = '__orphans__';

// Per-entity-type icon registry. The bundle detail view shows an
// inline icon next to each entity-type chip in the breakdown so the
// admin can scan the list visually. Keep this in sync with the
// `EntityType` union + the `isProposableEntityType` allowlist in
// api/_lib/proposals.ts.
const ENTITY_ICON: Record<EntityType, any> = {
  tag: TagsIcon,
  tag_group: Layers,
  spell: Wand2,
  spell_rule: Sparkles,
  spell_rule_application: ListChecks,
  class: Shield,
  subclass: Award,
  feat: Star,
  item: Package,
  unique_option_group: Boxes,
  unique_option_item: Repeat,
  scaling_column: Columns3,
  feature: Zap,
};

// ENTITY_LABEL + describePayloadSummary now live in BlockReviewPane.tsx
// (shared with the creator-side review). ENTITY_ICON above stays local —
// only the admin bundle-list breakdown uses it.

// Bundle row returned by GET /api/admin/proposals/bundles. Shape mirrors
// the SQL aggregation in functions/api/admin/proposals/[[path]].ts.
type BundleRow = {
  id: string;
  name: string;
  description: string | null;
  created_by_user_id: string | null;
  created_at: string | null;
  updated_at: string | null;
  bundle_status: string | null;
  proposer_username: string | null;
  proposer_display_name: string | null;
  revision_count: number;
  pending_count: number;
  approved_count: number;
  rejected_count: number;
  withdrawn_count: number;
  first_proposed_at: string | null;
  last_proposed_at: string | null;
  entity_types: EntityType[];
};

// Orphan-revision shape: like Proposal but with denormalized proposer
// fields, since orphans aren't joined into a bundle metadata row.
type OrphanRow = {
  id: string;
  entity_type: EntityType;
  entity_id: string | null;
  operation: 'create' | 'update' | 'delete';
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn';
  bundle_id: string | null;
  proposed_by_user_id: string | null;
  proposed_at: string | null;
  proposer_username: string | null;
  proposer_display_name: string | null;
};

export default function AdminProposals({ userProfile }: { userProfile: any }) {
  // Top-level admin review is now block-based: the list shows pending
  // bundles (a content creator's coherent change-set), and clicking a
  // bundle drills into its constituent revisions. The previous entity-
  // type tab strip slicing didn't match how creators actually package
  // their work, and missed Phase 4 entity types entirely until the
  // 2026-05-21 prod incident (see commit history for context).
  const [bundles, setBundles] = useState<BundleRow[]>([]);
  const [orphans, setOrphans] = useState<OrphanRow[]>([]);
  // When set, we're in bundle-detail view. null = list view.
  const [selectedBundleId, setSelectedBundleId] = useState<string | null>(null);
  // The revisions for `selectedBundleId` — fetched via the existing
  // `?bundle_id=` filter on the legacy list endpoint. No need for a
  // dedicated bundle-detail endpoint; the join already produces the
  // same row shape the ProposalRow component expects.
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [showResolved, setShowResolved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Proposal | null>(null);
  const [conflictDialog, setConflictDialog] = useState<null | {
    proposal: Proposal;
    reason: string;
    currentRow: any;
  }>(null);
  const [rejectDialog, setRejectDialog] = useState<
    | null
    | { proposal: Proposal; reason: string }
    | { bundle: { id: string; name: string }; reason: string }
  >(null);
  const [approvingBlockId, setApprovingBlockId] = useState<string | null>(null);
  // Revert-drift modal — server returns 409 + drift payload when the
  // live row has been edited (or re-created) between the approval and
  // the revert. Surfaces side-by-side so the admin can decide whether
  // to fix manually before re-trying.
  const [revertDrift, setRevertDrift] = useState<null | {
    proposal: Proposal;
    reason: string;
    currentRow: any;
    expectedRow: any;
  }>(null);
  const [revertingId, setRevertingId] = useState<string | null>(null);

  const authedFetch = useCallback(async (input: string, init?: RequestInit) => {
    const idToken = await auth.currentUser?.getIdToken();
    if (!idToken) throw new Error('Not signed in.');
    return fetch(input, {
      ...init,
      headers: {
        ...(init?.headers || {}),
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
    });
  }, []);

  // Bundle list loader. Used when the admin first lands on the page
  // and after any back-to-list action. Pulls bundles + orphans from
  // /api/admin/proposals/bundles in a single roundtrip.
  const loadBundles = useCallback(async () => {
    setLoading(true);
    try {
      const url = new URL('/api/admin/proposals/bundles', window.location.origin);
      url.searchParams.set('status', showResolved ? 'all' : 'pending');
      const res = await authedFetch(url.pathname + url.search);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed to load bundles (HTTP ${res.status})`);
      }
      const body = await res.json();
      setBundles(Array.isArray(body?.bundles) ? body.bundles : []);
      setOrphans(Array.isArray(body?.orphans) ? body.orphans : []);
    } catch (err: any) {
      console.error('Failed to load bundles:', err);
      toast.error(err?.message || 'Failed to load bundles.');
    } finally {
      setLoading(false);
    }
  }, [showResolved, authedFetch]);

  // Bundle-detail loader. Fetches every revision in the bundle (regardless
  // of status, so resolved ones show up in the same view as still-pending
  // siblings) via the existing /api/admin/proposals?bundle_id= filter.
  // Called when the admin clicks into a bundle row.
  const loadBundleRevisions = useCallback(
    async (bundleId: string) => {
      setLoading(true);
      try {
        // Pending first (FIFO review order) then resolved.
        const pendingUrl = `/api/admin/proposals?bundle_id=${encodeURIComponent(bundleId)}&status=pending`;
        const pendRes = await authedFetch(pendingUrl);
        const pendBody = pendRes.ok ? await pendRes.json() : { proposals: [] };
        const pending: Proposal[] = Array.isArray(pendBody?.proposals)
          ? pendBody.proposals
          : [];
        const resolvedRows: Proposal[] = [];
        if (showResolved) {
          for (const s of ['approved', 'rejected', 'withdrawn'] as const) {
            const r = await authedFetch(
              `/api/admin/proposals?bundle_id=${encodeURIComponent(bundleId)}&status=${s}`,
            );
            if (r.ok) {
              const b = await r.json();
              if (Array.isArray(b?.proposals)) resolvedRows.push(...b.proposals);
            }
          }
        }
        setProposals([...pending, ...resolvedRows]);
      } catch (err: any) {
        console.error('Failed to load bundle revisions:', err);
        toast.error(err?.message || 'Failed to load bundle revisions.');
      } finally {
        setLoading(false);
      }
    },
    [authedFetch, showResolved],
  );

  // Convenience: refresh whichever view is currently active. Called
  // after approve / reject / revert actions so the row state updates
  // without a manual refresh.
  const reloadCurrent = useCallback(async () => {
    if (selectedBundleId === ORPHANS_PSEUDO_BUNDLE_ID) {
      await loadBundles();
      // Re-derive proposals from the freshly-fetched orphans (set in
      // the useEffect below).
      return;
    }
    if (selectedBundleId) {
      await Promise.all([loadBundleRevisions(selectedBundleId), loadBundles()]);
    } else {
      await loadBundles();
    }
  }, [selectedBundleId, loadBundles, loadBundleRevisions]);

  useEffect(() => {
    if (userProfile?.role !== 'admin') return;
    if (!selectedBundleId) {
      void loadBundles();
    } else if (selectedBundleId === ORPHANS_PSEUDO_BUNDLE_ID) {
      // Orphans are already loaded as part of loadBundles; mirror them
      // into the proposals state so the detail view's rendering reuses
      // the standard ProposalRow component.
      setProposals(
        orphans.map((o) => ({
          id: o.id,
          entity_type: o.entity_type,
          entity_id: o.entity_id,
          operation: o.operation,
          status: o.status,
          bundle_id: o.bundle_id,
          proposed_by_user_id: o.proposed_by_user_id ?? '',
          proposed_at: o.proposed_at ?? '',
          proposer_username: o.proposer_username,
          proposer_display_name: o.proposer_display_name,
          proposed_payload: null,
          snapshot_at_proposal: null,
          notes_from_proposer: null,
          rejection_reason: null,
          reviewed_at: null,
          reviewed_by_user_id: null,
          cascade_parent_revision_id: null,
          pinned_at: null,
        }) as Proposal),
      );
    } else {
      void loadBundleRevisions(selectedBundleId);
    }
  }, [userProfile?.role, selectedBundleId, loadBundles, loadBundleRevisions, orphans]);

  const handleApprove = async (proposal: Proposal) => {
    try {
      const res = await authedFetch(
        `/api/admin/proposals/${encodeURIComponent(proposal.id)}/approve`,
        { method: 'POST' },
      );
      if (res.status === 409) {
        const body = await res.json().catch(() => ({}));
        if (body?.conflict) {
          setConflictDialog({
            proposal,
            reason: body.conflict.reason,
            currentRow: body.conflict.current_row,
          });
          return;
        }
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed to approve (HTTP ${res.status})`);
      }
      const body = await res.json().catch(() => ({} as any));
      toast.success('Proposal approved.');
      // Post-approve hook: when the change touched a spell row,
      // recompute the rule-driven class_spell_lists rows that
      // reference it. Same call admin's direct upsertSpell makes —
      // without it, a tag/level/school change approved via the queue
      // Post-approve recompute (recomputeAppliedRulesForSpell) was
      // removed in phase 4.4. The resolver path (P4.0-4.3) reads
      // applied-rule state at request time, so an approved spell
      // change is visible on the next consumer-list read without
      // any class_spell_lists refresh step.
      setSelected(null);
      void reloadCurrent();
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || 'Failed to approve.');
    }
  };

  // Block-atomic approve (Part D). Hits the bundle endpoint, which validates
  // references (guard #1) + per-revision drift, orders by FK dependency, and
  // applies the whole block as one env.DB.batch() — all-or-nothing. A guard
  // failure returns { ok:false, stage, failures } with NOTHING applied; we
  // surface the stage + first offender so the admin knows what to fix.
  const handleApproveBlock = async (bundleId: string) => {
    setApprovingBlockId(bundleId);
    try {
      const res = await authedFetch(
        `/api/admin/proposals/bundle/${encodeURIComponent(bundleId)}/approve`,
        { method: 'POST' },
      );
      const body = await res.json().catch(() => ({} as any));
      if (!res.ok || body?.ok === false) {
        if (body?.stage && Array.isArray(body?.failures)) {
          const STAGE_LABEL: Record<string, string> = {
            refs: 'unresolved reference(s)',
            drift: 'the live row(s) changed since submission',
            order: 'a dependency cycle',
            apply: 'a write error (nothing applied)',
          };
          const label = STAGE_LABEL[body.stage] ?? body.stage;
          const first = body.failures[0];
          const detail = first?.field
            ? ` — e.g. ${first.entity_type} ${first.field} → ${first.missing_id}`
            : first?.reason
              ? ` — ${first.reason}`
              : '';
          const more = body.failures.length > 1 ? ` (+${body.failures.length - 1} more)` : '';
          toast.error(`Block not approved: ${label}${detail}${more}. Nothing was applied.`);
          return;
        }
        throw new Error(body?.error || `Failed to approve block (HTTP ${res.status})`);
      }
      const appliedCount = Array.isArray(body?.applied) ? body.applied.length : 0;
      toast.success(
        `Block approved — ${appliedCount} change${appliedCount === 1 ? '' : 's'} applied atomically.`,
      );
      setSelected(null);
      void reloadCurrent();
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || 'Failed to approve block.');
    } finally {
      setApprovingBlockId(null);
    }
  };

  const handleRejectSubmit = async () => {
    if (!rejectDialog) return;
    const reason = rejectDialog.reason.trim() || null;
    try {
      if ('bundle' in rejectDialog) {
        // Block-level reject: every pending revision in the block falls
        // together (an admin can't approve a class but orphan its columns).
        const res = await authedFetch(
          `/api/admin/proposals/bundle/${encodeURIComponent(rejectDialog.bundle.id)}/reject`,
          { method: 'POST', body: JSON.stringify({ rejection_reason: reason }) },
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `Failed to reject block (HTTP ${res.status})`);
        }
        const body = await res.json().catch(() => ({} as any));
        const n = Array.isArray(body?.rejected_revision_ids)
          ? body.rejected_revision_ids.length
          : 0;
        toast.success(`Block rejected — ${n} revision${n === 1 ? '' : 's'}.`);
      } else {
        const res = await authedFetch(
          `/api/admin/proposals/${encodeURIComponent(rejectDialog.proposal.id)}/reject`,
          { method: 'POST', body: JSON.stringify({ rejection_reason: reason }) },
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `Failed to reject (HTTP ${res.status})`);
        }
        const body = await res.json();
        const cascadeCount = Array.isArray(body?.cascaded_revision_ids)
          ? body.cascaded_revision_ids.length
          : 0;
        toast.success(
          cascadeCount > 0
            ? `Rejected. ${cascadeCount} bundle child${cascadeCount === 1 ? '' : 'ren'} also rejected.`
            : 'Proposal rejected.',
        );
      }
      setRejectDialog(null);
      setSelected(null);
      void reloadCurrent();
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || 'Failed to reject.');
    }
  };

  const handleTogglePin = async (proposal: Proposal) => {
    const action = proposal.pinned_at ? 'unpin' : 'pin';
    try {
      const res = await authedFetch(
        `/api/admin/proposals/${encodeURIComponent(proposal.id)}/${action}`,
        { method: 'POST' },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed to ${action} (HTTP ${res.status})`);
      }
      toast.success(
        proposal.pinned_at
          ? 'Unpinned — this proposal will follow the standard 30-day retention.'
          : 'Pinned — this proposal is exempt from the 30-day retention sweep.',
      );
      void reloadCurrent();
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || `Failed to ${action} proposal.`);
    }
  };

  const handleRevert = async (proposal: Proposal) => {
    if (!confirm(`Revert this approved ${ENTITY_LABEL[proposal.entity_type].toLowerCase()} change? The live row will roll back to its pre-approval state and a new "approved revert" revision will be logged.`)) return;
    setRevertingId(proposal.id);
    try {
      const res = await authedFetch(
        `/api/admin/proposals/${encodeURIComponent(proposal.id)}/revert`,
        { method: 'POST' },
      );
      if (res.status === 409) {
        const body = await res.json().catch(() => ({}));
        if (body?.drift) {
          setRevertDrift({
            proposal,
            reason: body.drift.reason,
            currentRow: body.drift.current_row,
            expectedRow: body.drift.expected_row,
          });
          return;
        }
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed to revert (HTTP ${res.status})`);
      }
      toast.success('Proposal reverted; rollback logged as a new approved revision.');
      // Post-revert recompute was removed in phase 4.4 — same
      // rationale as post-approve above.
      setSelected(null);
      void reloadCurrent();
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || 'Failed to revert.');
    } finally {
      setRevertingId(null);
    }
  };

  // In bundle-detail view we show all revisions in the bundle (filtered
  // by `proposals` state, not entity_type). The bundle-list view is
  // populated separately via `bundles` state.
  const detailProposals = proposals;

  // Bundle currently being viewed (for rendering the detail header).
  const activeBundle = useMemo<BundleRow | null>(() => {
    if (!selectedBundleId || selectedBundleId === ORPHANS_PSEUDO_BUNDLE_ID) return null;
    return bundles.find((b) => b.id === selectedBundleId) ?? null;
  }, [bundles, selectedBundleId]);

  // Count cascade dependents per parent revision id. The badge on
  // each row uses this to surface "+N cascade deps" so the admin
  // can see at a glance which deletes will fan out on approval.
  // Counts only pending children — resolved cascades already
  // happened.
  const cascadeChildCountByParent = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of proposals) {
      if (p.status !== 'pending') continue;
      if (!p.cascade_parent_revision_id) continue;
      m.set(
        p.cascade_parent_revision_id,
        (m.get(p.cascade_parent_revision_id) ?? 0) + 1,
      );
    }
    return m;
  }, [proposals]);

  if (userProfile?.role !== 'admin') {
    return <div className="text-center py-20 font-serif italic">Access Denied. Admins only.</div>;
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-20">
      <div className="flex items-center gap-3 text-gold mb-2">
        <Inbox className="w-6 h-6" />
        <span className="text-sm font-bold uppercase tracking-[0.3em]">Admin Tools</span>
      </div>

      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-2">
          <h1 className="text-4xl font-serif font-bold text-ink tracking-tight uppercase">Content Proposals</h1>
          <p className="text-ink/60 font-serif italic">
            Review pending revisions submitted by content creators. Approve to write
            through to the live tables; reject (optionally with a reason) to send
            feedback. Children of a rejected bundle row are cascaded automatically.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => setShowResolved((v) => !v)}
          className="gap-2 h-9"
        >
          {showResolved ? 'Hide resolved' : 'Show resolved'}
        </Button>
      </div>

      {selectedBundleId ? (
        /* ===========================================================
         * BUNDLE DETAIL VIEW — list of revisions in the chosen bundle
         * (or orphan proposals if pseudo-bundle).
         * =========================================================== */
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedBundleId(null)}
              className="gap-2 text-gold hover:bg-gold/10"
            >
              <ChevronLeft className="w-4 h-4" />
              Back to blocks
            </Button>
          </div>
          {selectedBundleId === ORPHANS_PSEUDO_BUNDLE_ID ? (
            <Card className="border-gold/10">
              <CardHeader>
                <CardTitle className="text-base">
                  Standalone proposals — {detailProposals.length}
                </CardTitle>
                <p className="text-xs text-ink/60 italic">
                  Revisions with no block (legacy single-revision submits, or
                  bundles that lost their metadata row).
                </p>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <p className="text-ink/50 italic text-center py-12">Loading…</p>
                ) : detailProposals.length === 0 ? (
                  <p className="text-ink/50 italic text-center py-12">
                    No standalone proposals.
                  </p>
                ) : (
                  <ul className="divide-y divide-gold/5">
                    {detailProposals.map((p) => (
                      <ProposalRow
                        key={p.id}
                        proposal={p}
                        onSelect={() => setSelected(p)}
                        onApprove={() => handleApprove(p)}
                        onReject={() => setRejectDialog({ proposal: p, reason: '' })}
                        onRevert={() => handleRevert(p)}
                        onTogglePin={() => handleTogglePin(p)}
                        reverting={revertingId === p.id}
                        cascadeChildCount={cascadeChildCountByParent.get(p.id)}
                      />
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          ) : activeBundle ? (
            <BlockReview
              bundle={activeBundle}
              revisions={detailProposals}
              loading={loading}
              approvingBlockId={approvingBlockId}
              onApproveBlock={handleApproveBlock}
              onRejectBlock={(b) => setRejectDialog({ bundle: b, reason: '' })}
              onApproveRevision={handleApprove}
              onRejectRevision={(p) => setRejectDialog({ proposal: p, reason: '' })}
            />
          ) : (
            <p className="text-ink/50 italic text-center py-12">
              Block not found.
            </p>
          )}
        </div>
      ) : (
        /* ===========================================================
         * BUNDLE LIST VIEW — top-level "what's waiting for review"
         * surface. Each row summarises a block: name + description +
         * proposer + counts + entity-type chips.
         * =========================================================== */
        <Card className="border-gold/10">
          <CardHeader>
            <CardTitle className="text-base">
              {showResolved
                ? `Blocks — ${bundles.length}`
                : `Pending blocks — ${bundles.length}`}
              {orphans.length > 0 && (
                <> · <span className="text-ink/55">{orphans.length} standalone</span></>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading && bundles.length === 0 && orphans.length === 0 ? (
              <p className="text-ink/50 italic text-center py-12">Loading…</p>
            ) : bundles.length === 0 && orphans.length === 0 ? (
              <p className="text-ink/50 italic text-center py-12">
                {showResolved ? 'Nothing to show.' : 'No pending proposals.'}
              </p>
            ) : (
              <ul className="divide-y divide-gold/5">
                {bundles.map((b) => (
                  <BundleRowDisplay
                    key={b.id}
                    bundle={b}
                    onSelect={() => setSelectedBundleId(b.id)}
                  />
                ))}
                {orphans.length > 0 && (
                  <li>
                    <button
                      type="button"
                      onClick={() => setSelectedBundleId(ORPHANS_PSEUDO_BUNDLE_ID)}
                      className="w-full flex items-center justify-between gap-3 py-3 hover:bg-gold/5 px-2 -mx-2 rounded transition-colors text-left"
                    >
                      <div className="flex flex-col gap-1 min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-ink">
                            Standalone proposals
                          </span>
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                            {orphans.length}
                          </Badge>
                        </div>
                        <span className="text-xs text-ink/55">
                          Pre-block-system submits and bundle metadata gaps
                        </span>
                      </div>
                      <ChevronRight className="w-4 h-4 text-ink/40 flex-shrink-0" />
                    </button>
                  </li>
                )}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      <ProposalDetailDialog
        proposal={selected}
        onClose={() => setSelected(null)}
        onApprove={() => selected && handleApprove(selected)}
        onReject={() => selected && setRejectDialog({ proposal: selected, reason: '' })}
        onRevert={() => selected && handleRevert(selected)}
        reverting={!!(selected && revertingId === selected.id)}
      />

      <Dialog open={!!revertDrift} onOpenChange={(open) => { if (!open) setRevertDrift(null); }}>
        <DialogContentLarge>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-blood">
              <AlertTriangle className="w-5 h-5" />
              Drift — live row has changed since this proposal was approved
            </DialogTitle>
            <DialogDescription>
              {revertDrift?.reason === 'row_changed' && 'The target row has been edited after the original approval landed.'}
              {revertDrift?.reason === 'row_already_deleted' && 'The target row has been deleted since the approval.'}
              {revertDrift?.reason === 'row_resurrected' && 'A row at the deleted id has been re-created since the approval.'}
              {' '}Reverting now would silently overwrite that change. Resolve the drift manually and re-try.
            </DialogDescription>
          </DialogHeader>
          {revertDrift && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <DiffPane title="Expected (state at approval)" data={revertDrift.expectedRow} />
              <DiffPane title="Current row" data={revertDrift.currentRow} />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevertDrift(null)}>Close</Button>
          </DialogFooter>
        </DialogContentLarge>
      </Dialog>

      <Dialog open={!!conflictDialog} onOpenChange={(open) => { if (!open) setConflictDialog(null); }}>
        <DialogContentLarge>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-blood">
              <AlertTriangle className="w-5 h-5" />
              Conflict — entity has drifted since this proposal was submitted
            </DialogTitle>
            <DialogDescription>
              {conflictDialog?.reason === 'row_deleted' && 'The target row has been deleted.'}
              {conflictDialog?.reason === 'row_changed' && 'The target row was edited after this proposal was submitted.'}
              {conflictDialog?.reason === 'row_present_for_create' && 'A row at the proposed id already exists.'}
              {' '}Resolve the drift (edit the live entity manually, or coordinate with the proposer) and re-evaluate.
            </DialogDescription>
          </DialogHeader>
          {conflictDialog && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              <DiffPane title="Snapshot at proposal" data={conflictDialog.proposal.snapshot_at_proposal} />
              <DiffPane title="Current row" data={conflictDialog.currentRow} />
              <DiffPane title="Proposed" data={conflictDialog.proposal.proposed_payload} />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConflictDialog(null)}>Close</Button>
          </DialogFooter>
        </DialogContentLarge>
      </Dialog>

      <Dialog open={!!rejectDialog} onOpenChange={(open) => { if (!open) setRejectDialog(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {rejectDialog && 'bundle' in rejectDialog ? 'Reject block' : 'Reject proposal'}
            </DialogTitle>
            <DialogDescription>
              {rejectDialog && 'bundle' in rejectDialog
                ? 'Rejects every pending revision in this block together. An optional reason is shown to the proposer.'
                : "An optional reason is included in the proposer's view + cascaded to bundle children."}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={rejectDialog?.reason ?? ''}
            onChange={(e) => setRejectDialog((d) => d ? { ...d, reason: e.target.value } : d)}
            rows={3}
            placeholder="e.g. Duplicate of existing tag; renaming the existing one instead."
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectDialog(null)}>Cancel</Button>
            <Button onClick={handleRejectSubmit} className="bg-blood text-white">Reject</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Bundle list row — surfaces the metadata + per-entity-type breakdown.
// Counts derive from the SQL aggregation in handleListBundles; the
// chip group surfaces which entity types appear in the bundle so the
// admin can scan visually ("a tag-cleanup block" vs "a spell-content
// block") without needing to drill in.
function BundleRowDisplay({
  bundle,
  onSelect,
}: {
  bundle: BundleRow;
  onSelect: () => void;
}) {
  // Build a per-entity-type count using a small SELECT-aside is overkill;
  // the GROUP_CONCAT'd entity_types are accurate enough for the visual
  // breakdown. For exact "5 spells, 2 tags" granularity the admin can
  // click in.
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className="w-full flex items-center justify-between gap-3 py-3 hover:bg-gold/5 px-2 -mx-2 rounded transition-colors text-left"
      >
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold text-ink truncate">
              {bundle.name}
            </span>
            {bundle.pending_count > 0 && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-gold/60 text-gold">
                {bundle.pending_count} pending
              </Badge>
            )}
            {bundle.approved_count > 0 && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-emerald-600/40 text-emerald-700">
                {bundle.approved_count} approved
              </Badge>
            )}
            {bundle.rejected_count > 0 && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-blood/40 text-blood">
                {bundle.rejected_count} rejected
              </Badge>
            )}
          </div>
          {bundle.description && (
            <span className="text-xs text-ink/65 line-clamp-2">
              {bundle.description}
            </span>
          )}
          <div className="flex items-center gap-2 flex-wrap text-[11px] text-ink/55">
            <span className="font-medium text-ink/70">
              {bundle.proposer_display_name ||
                bundle.proposer_username ||
                bundle.created_by_user_id ||
                'unknown'}
            </span>
            {bundle.first_proposed_at && (
              <>
                <span>·</span>
                <span>{formatSqliteLocal(bundle.first_proposed_at)}</span>
              </>
            )}
            {bundle.entity_types.length > 0 && (
              <>
                <span>·</span>
                <div className="flex items-center gap-1">
                  {bundle.entity_types.map((et) => {
                    const Icon = ENTITY_ICON[et];
                    return (
                      <span
                        key={et}
                        className="inline-flex items-center gap-0.5 text-ink/50"
                        title={ENTITY_LABEL[et]}
                      >
                        {Icon && <Icon className="w-3 h-3" />}
                      </span>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-ink/40 flex-shrink-0" />
      </button>
    </li>
  );
}

// ── Field-level diff for the split-pane detail (replaces the raw-JSON dump) ──
// ── Split-pane block review (Option C) ──
// The split-pane core (rail + FieldDiff) lives in BlockReviewPane.tsx and is
// shared with the creator-side review. This wrapper supplies the admin chrome:
// the bundle header (proposer + counts + atomic Approve/Reject block) and the
// per-revision Approve-this / Reject-this footer (only for still-pending rows).
function BlockReview({
  bundle, revisions, loading, approvingBlockId,
  onApproveBlock, onRejectBlock, onApproveRevision, onRejectRevision,
}: {
  bundle: BundleRow;
  revisions: Proposal[];
  loading: boolean;
  approvingBlockId: string | null;
  onApproveBlock: (bundleId: string) => void;
  onRejectBlock: (b: { id: string; name: string }) => void;
  onApproveRevision: (p: Proposal) => void;
  onRejectRevision: (p: Proposal) => void;
}) {
  return (
    <Card className="border-gold/10 overflow-hidden">
      <CardHeader>
        <div className="space-y-2">
          <CardTitle className="text-base flex items-center gap-2">{bundle.name}</CardTitle>
          {bundle.description && (
            <p className="text-sm text-ink/70 leading-relaxed">{bundle.description}</p>
          )}
          <p className="text-xs text-ink/55">
            <span className="font-medium text-ink/75">
              {bundle.proposer_display_name || bundle.proposer_username || bundle.created_by_user_id || 'unknown'}
            </span>
            {bundle.first_proposed_at && <>{' · submitted '}{formatSqliteLocal(bundle.first_proposed_at)}</>}
            {' · '}<span className="text-gold/80 font-semibold">{bundle.pending_count} pending</span>
            {bundle.approved_count > 0 && <> · {bundle.approved_count} approved</>}
            {bundle.rejected_count > 0 && <> · {bundle.rejected_count} rejected</>}
            {bundle.withdrawn_count > 0 && <> · {bundle.withdrawn_count} withdrawn</>}
          </p>
          {bundle.pending_count > 0 && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button
                onClick={() => onApproveBlock(bundle.id)}
                disabled={approvingBlockId === bundle.id}
                className="bg-emerald-700 text-white hover:bg-emerald-800 text-xs px-3 py-1.5 h-auto"
              >
                {approvingBlockId === bundle.id ? 'Approving…' : `Approve block (${bundle.pending_count})`}
              </Button>
              <Button
                variant="outline"
                onClick={() => onRejectBlock({ id: bundle.id, name: bundle.name })}
                className="border-blood/40 text-blood hover:bg-blood/5 text-xs px-3 py-1.5 h-auto"
              >
                Reject block
              </Button>
              <span className="text-[11px] text-ink/45">applies all {bundle.pending_count} revisions atomically</span>
            </div>
          )}
        </div>
      </CardHeader>

      <BlockReviewPane
        revisions={revisions}
        loading={loading}
        emptyLabel="No revisions in this block."
        renderRevisionActions={(sel) =>
          sel.status === 'pending' ? (
            <>
              <Button
                variant="outline"
                onClick={() => onRejectRevision(sel as Proposal)}
                className="gap-1.5 border-blood/30 text-blood hover:bg-blood/10"
              >
                <X className="w-3.5 h-3.5" /> Reject this
              </Button>
              <Button onClick={() => onApproveRevision(sel as Proposal)} className="gap-1.5 bg-emerald-700 text-white hover:bg-emerald-800">
                <Check className="w-3.5 h-3.5" /> Approve this
              </Button>
            </>
          ) : null
        }
      />
    </Card>
  );
}

function ProposalRow({
  proposal, onSelect, onApprove, onReject, onRevert, onTogglePin, reverting,
  cascadeChildCount,
}: {
  proposal: Proposal;
  onSelect: () => void;
  onApprove: () => void;
  onReject: () => void;
  onRevert: () => void;
  onTogglePin: () => void;
  reverting: boolean;
  /** Number of pending cascade children whose `cascade_parent_revision_id`
   *  points at this proposal. Approval cascades down; rejection
   *  cascades down. Passed in by the parent component (AdminProposals)
   *  which has the full proposal list available for the lookup. */
  cascadeChildCount?: number;
}) {
  const isPending = proposal.status === 'pending';
  const isApproved = proposal.status === 'approved';
  const isResolved = !isPending; // approved / rejected / withdrawn
  const isPinned = !!proposal.pinned_at;
  return (
    <li className="py-3 flex items-center gap-3 hover:bg-gold/5 px-2 -mx-2 rounded transition-colors">
      <button
        type="button"
        onClick={onSelect}
        className="flex-1 text-left flex items-center gap-3 min-w-0"
      >
        <OperationBadge operation={proposal.operation} />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm truncate flex items-center gap-2">
            {describePayloadSummary(proposal)}
            {isPinned && (
              <Badge variant="outline" className="text-[9px] border-gold/40 text-gold">
                Pinned
              </Badge>
            )}
            {/* Cascade badges: parent shows +N children count;
                children show "cascade child of $parent". Approving the
                parent fans out to all pending children automatically
                (see api/admin/proposals handleApprove); rejecting the
                parent does the same. */}
            {!!cascadeChildCount && cascadeChildCount > 0 && (
              <Badge variant="outline" className="text-[9px] border-amber-600/40 text-amber-700">
                +{cascadeChildCount} cascade dep{cascadeChildCount === 1 ? '' : 's'}
              </Badge>
            )}
            {proposal.cascade_parent_revision_id && (
              <Badge variant="outline" className="text-[9px] border-amber-600/30 text-amber-700/80">
                cascade child
              </Badge>
            )}
          </p>
          <p className="text-[11px] text-ink/50">
            by {proposal.proposer_display_name || proposal.proposer_username || proposal.proposed_by_user_id} ·{' '}
            {formatSqliteLocal(proposal.proposed_at)}
            {proposal.bundle_id && (
              <> · <span className="font-mono text-ink/40">{proposal.bundle_id.slice(0, 12)}</span></>
            )}
          </p>
        </div>
        <StatusBadge status={proposal.status} />
      </button>
      {isResolved && (
        <div className="flex gap-2 shrink-0">
          <Button
            size="xs"
            variant="outline"
            onClick={(e) => { e.stopPropagation(); onTogglePin(); }}
            className={`gap-1.5 ${isPinned ? 'border-gold/60 text-gold bg-gold/10' : 'border-ink/20 text-ink/60 hover:bg-gold/5'}`}
            title={isPinned
              ? 'Unpin — this proposal will follow the standard 30-day retention.'
              : 'Pin — exempt this proposal from the 30-day retention sweep.'}
          >
            {isPinned ? 'Unpin' : 'Pin'}
          </Button>
          {isApproved && (
            <Button
              size="xs"
              variant="outline"
              onClick={onRevert}
              disabled={reverting}
              className="gap-1.5 border-amber-500/40 text-amber-600 hover:bg-amber-500/10"
              title="Roll the live row back to its pre-approval state. Refuses if the row has drifted since approval."
            >
              <Undo2 className="w-3.5 h-3.5" /> {reverting ? 'Reverting…' : 'Revert'}
            </Button>
          )}
        </div>
      )}
      {isPending && (
        <div className="flex gap-2 shrink-0">
          <Button size="xs" variant="outline" onClick={onApprove} className="gap-1.5 border-emerald-700/30 text-emerald-700 hover:bg-emerald-700/10">
            <Check className="w-3.5 h-3.5" /> Approve
          </Button>
          <Button size="xs" variant="outline" onClick={onReject} className="gap-1.5 border-blood/30 text-blood hover:bg-blood/10">
            <X className="w-3.5 h-3.5" /> Reject
          </Button>
        </div>
      )}
    </li>
  );
}

// OperationBadge + StatusBadge now imported from BlockReviewPane.tsx.

function ProposalDetailDialog({
  proposal, onClose, onApprove, onReject, onRevert, reverting,
}: {
  proposal: Proposal | null;
  onClose: () => void;
  onApprove: () => void;
  onReject: () => void;
  onRevert: () => void;
  reverting: boolean;
}) {
  if (!proposal) return null;
  const isPending = proposal.status === 'pending';
  const isApproved = proposal.status === 'approved';
  return (
    <Dialog open={true} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContentLarge>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3 text-base">
            <OperationBadge operation={proposal.operation} />
            <span>{ENTITY_LABEL[proposal.entity_type]} · {describePayloadSummary(proposal)}</span>
            <StatusBadge status={proposal.status} />
          </DialogTitle>
          <DialogDescription className="text-xs">
            Proposed by{' '}
            <span className="font-medium text-ink/70">
              {proposal.proposer_display_name || proposal.proposer_username || proposal.proposed_by_user_id}
            </span>
            {' '}on {formatSqliteLocal(proposal.proposed_at)}.
            {proposal.reviewed_at && (
              <> Reviewed {formatSqliteLocal(proposal.reviewed_at)}.</>
            )}
          </DialogDescription>
        </DialogHeader>

        {proposal.notes_from_proposer && (
          <div className="p-3 rounded bg-gold/5 border border-gold/10 text-sm">
            <p className="text-[10px] uppercase tracking-widest text-gold/70 mb-1">Notes from proposer</p>
            <p className="whitespace-pre-wrap">{proposal.notes_from_proposer}</p>
          </div>
        )}

        {proposal.rejection_reason && (
          <div className="p-3 rounded bg-blood/5 border border-blood/10 text-sm">
            <p className="text-[10px] uppercase tracking-widest text-blood/70 mb-1">Rejection reason</p>
            <p className="whitespace-pre-wrap">{proposal.rejection_reason}</p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {proposal.snapshot_at_proposal && (
            <DiffPane title="Snapshot at submit" data={proposal.snapshot_at_proposal} />
          )}
          <DiffPane title={proposal.operation === 'delete' ? '(delete)' : 'Proposed'} data={proposal.proposed_payload} />
        </div>

        {isPending && (
          <DialogFooter>
            <Button variant="outline" onClick={onReject} className="gap-1.5 border-blood/30 text-blood hover:bg-blood/10">
              <X className="w-3.5 h-3.5" /> Reject
            </Button>
            <Button onClick={onApprove} className="gap-1.5 bg-emerald-700 text-white">
              <Check className="w-3.5 h-3.5" /> Approve
            </Button>
          </DialogFooter>
        )}
        {isApproved && (
          <DialogFooter>
            <Button
              variant="outline"
              onClick={onRevert}
              disabled={reverting}
              className="gap-1.5 border-amber-500/40 text-amber-600 hover:bg-amber-500/10"
            >
              <Undo2 className="w-3.5 h-3.5" /> {reverting ? 'Reverting…' : 'Revert'}
            </Button>
          </DialogFooter>
        )}
      </DialogContentLarge>
    </Dialog>
  );
}

function DiffPane({ title, data }: { title: string; data: any }) {
  return (
    <div className="rounded border border-gold/10 p-3 bg-background/50">
      <p className="text-[10px] uppercase tracking-widest text-ink/40 mb-2">{title}</p>
      <pre className="text-[11px] leading-snug whitespace-pre-wrap break-words font-mono max-h-64 overflow-y-auto">
        {data === null || data === undefined ? '—' : JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}

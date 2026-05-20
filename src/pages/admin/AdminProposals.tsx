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
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '../../components/ui/dialog';
import { Textarea } from '../../components/ui/textarea';
import { Inbox, Check, X, AlertTriangle, Undo2, Tags as TagsIcon, ListChecks, Sparkles, Layers, BookOpen } from 'lucide-react';
import { recomputeAppliedRulesForSpell } from '../../lib/spellRules';

type EntityType =
  | 'tag'
  | 'tag_group'
  | 'spell_rule'
  | 'spell_rule_application'
  | 'class_spell_list'
  | 'spell'
  | 'class'
  | 'subclass'
  | 'unique_option_group'
  | 'unique_option_item';

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
  notes_from_proposer: string | null;
  cascade_parent_revision_id: string | null;
};

const ENTITY_TABS: Array<{ id: EntityType; label: string; icon: any }> = [
  { id: 'tag', label: 'Tags', icon: TagsIcon },
  { id: 'tag_group', label: 'Tag Groups', icon: Layers },
  { id: 'spell_rule', label: 'Spell Rules', icon: Sparkles },
  { id: 'spell_rule_application', label: 'Rule Applications', icon: ListChecks },
  { id: 'class_spell_list', label: 'Spell Lists', icon: BookOpen },
];

const ENTITY_LABEL: Record<EntityType, string> = {
  tag: 'Tag',
  tag_group: 'Tag Group',
  spell_rule: 'Spell Rule',
  spell_rule_application: 'Rule Application',
  class_spell_list: 'Class Spell List',
  spell: 'Spell',
  class: 'Class',
  subclass: 'Subclass',
  unique_option_group: 'Option Group',
  unique_option_item: 'Option Item',
};

function describePayloadSummary(p: Proposal): string {
  const payload = p.proposed_payload;
  const name = payload && typeof payload === 'object' ? payload.name : undefined;
  const slug = payload && typeof payload === 'object' ? payload.slug : undefined;
  if (typeof name === 'string') return name;
  if (typeof slug === 'string') return slug;
  if (p.entity_id) return p.entity_id;
  return '(no preview)';
}

export default function AdminProposals({ userProfile }: { userProfile: any }) {
  const [activeTab, setActiveTab] = useState<EntityType>('tag');
  const [showResolved, setShowResolved] = useState(false);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(false);
  const [counts, setCounts] = useState<Record<EntityType, number>>({
    tag: 0, tag_group: 0, spell_rule: 0, spell_rule_application: 0, class_spell_list: 0,
    spell: 0, class: 0, subclass: 0, unique_option_group: 0, unique_option_item: 0,
  });
  const [selected, setSelected] = useState<Proposal | null>(null);
  const [conflictDialog, setConflictDialog] = useState<null | {
    proposal: Proposal;
    reason: string;
    currentRow: any;
  }>(null);
  const [rejectDialog, setRejectDialog] = useState<null | { proposal: Proposal; reason: string }>(null);
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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // We pull both pending and resolved in parallel for the active
      // tab. Counts come from a small pending-only sweep across every
      // entity so the tab labels can show "(3)" badges without making
      // the queue itself bigger.
      const status = showResolved ? 'all' : 'pending';
      const url = new URL('/api/admin/proposals', window.location.origin);
      url.searchParams.set('entity_type', activeTab);
      if (!showResolved) url.searchParams.set('status', 'pending');
      const res = await authedFetch(url.pathname + url.search);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed to load proposals (HTTP ${res.status})`);
      }
      const body = await res.json();
      let rows: Proposal[] = Array.isArray(body?.proposals) ? body.proposals : [];
      if (showResolved) {
        // The endpoint accepts only one status at a time; for "show
        // resolved" we surface everything matching the entity_type and
        // sort pending-first locally.
        const pendRes = await authedFetch(`/api/admin/proposals?entity_type=${activeTab}&status=pending`);
        const pendBody = pendRes.ok ? await pendRes.json() : { proposals: [] };
        const pending: Proposal[] = Array.isArray(pendBody?.proposals) ? pendBody.proposals : [];
        const ids = new Set(rows.map((r) => r.id));
        rows = [...pending.filter((r) => !ids.has(r.id)), ...rows];
      }
      setProposals(rows);
      if (status !== 'all') {
        // Refresh per-entity counts so the tab strip badges stay
        // current.
        const countResults = await Promise.all(
          ENTITY_TABS.map(async ({ id }) => {
            try {
              const r = await authedFetch(`/api/admin/proposals?entity_type=${id}&status=pending`);
              if (!r.ok) return [id, 0] as const;
              const b = await r.json();
              return [id, Array.isArray(b?.proposals) ? b.proposals.length : 0] as const;
            } catch {
              return [id, 0] as const;
            }
          }),
        );
        setCounts(
          countResults.reduce<Record<EntityType, number>>(
            (acc, [id, count]) => ({ ...acc, [id]: count }),
            {
              tag: 0, tag_group: 0, spell_rule: 0, spell_rule_application: 0,
              class_spell_list: 0, spell: 0, class: 0, subclass: 0,
              unique_option_group: 0, unique_option_item: 0,
            },
          ),
        );
      }
    } catch (err: any) {
      console.error('Failed to load proposals:', err);
      toast.error(err?.message || 'Failed to load proposals.');
    } finally {
      setLoading(false);
    }
  }, [activeTab, showResolved, authedFetch]);

  useEffect(() => {
    if (userProfile?.role !== 'admin') return;
    void load();
  }, [userProfile?.role, load]);

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
      // would leave the class lists stale (the user's stated problem
      // with "constant battle to update them"). Best-effort: a
      // failure here logs but doesn't unwind the approval.
      const touchedSpellId =
        proposal.entity_type === 'spell'
          ? (body?.entity_id as string | undefined) || proposal.entity_id || undefined
          : undefined;
      if (touchedSpellId) {
        try {
          await recomputeAppliedRulesForSpell(touchedSpellId);
        } catch (err) {
          console.warn('[AdminProposals] post-approve spell recompute failed:', err);
        }
      }
      setSelected(null);
      void load();
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || 'Failed to approve.');
    }
  };

  const handleRejectSubmit = async () => {
    if (!rejectDialog) return;
    try {
      const res = await authedFetch(
        `/api/admin/proposals/${encodeURIComponent(rejectDialog.proposal.id)}/reject`,
        {
          method: 'POST',
          body: JSON.stringify({ rejection_reason: rejectDialog.reason.trim() || null }),
        },
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
      setRejectDialog(null);
      setSelected(null);
      void load();
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || 'Failed to reject.');
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
      // Same post-write recompute as approve — a revert that rolls
      // back a spell to its pre-approval state can flip which rules
      // include/exclude it just like the original approval did.
      if (proposal.entity_type === 'spell' && proposal.entity_id) {
        try {
          await recomputeAppliedRulesForSpell(proposal.entity_id);
        } catch (err) {
          console.warn('[AdminProposals] post-revert spell recompute failed:', err);
        }
      }
      setSelected(null);
      void load();
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || 'Failed to revert.');
    } finally {
      setRevertingId(null);
    }
  };

  const filteredProposals = useMemo(() => {
    return proposals.filter((p) => p.entity_type === activeTab);
  }, [proposals, activeTab]);

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

      <div className="flex flex-wrap gap-2 border-b border-gold/10 pb-2">
        {ENTITY_TABS.map((tab) => {
          const Icon = tab.icon;
          const count = counts[tab.id] ?? 0;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-t-lg transition-colors font-bold uppercase tracking-widest text-[10px] ${
                activeTab === tab.id
                  ? 'bg-gold text-white shadow-sm'
                  : 'bg-card text-ink/60 hover:text-ink hover:bg-gold/10'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
              {count > 0 && (
                <Badge variant="outline" className="ml-1 text-[9px] px-1 py-0 border-current text-current">
                  {count}
                </Badge>
              )}
            </button>
          );
        })}
      </div>

      <Card className="border-gold/10">
        <CardHeader>
          <CardTitle className="text-base">
            {ENTITY_LABEL[activeTab]} — {filteredProposals.length} {showResolved ? '' : 'pending'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading && proposals.length === 0 ? (
            <p className="text-ink/50 italic text-center py-12">Loading…</p>
          ) : filteredProposals.length === 0 ? (
            <p className="text-ink/50 italic text-center py-12">
              {showResolved ? 'Nothing to show.' : 'No pending proposals for this entity.'}
            </p>
          ) : (
            <ul className="divide-y divide-gold/5">
              {filteredProposals.map((p) => (
                <ProposalRow
                  key={p.id}
                  proposal={p}
                  onSelect={() => setSelected(p)}
                  onApprove={() => handleApprove(p)}
                  onReject={() => setRejectDialog({ proposal: p, reason: '' })}
                  onRevert={() => handleRevert(p)}
                  reverting={revertingId === p.id}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <ProposalDetailDialog
        proposal={selected}
        onClose={() => setSelected(null)}
        onApprove={() => selected && handleApprove(selected)}
        onReject={() => selected && setRejectDialog({ proposal: selected, reason: '' })}
        onRevert={() => selected && handleRevert(selected)}
        reverting={!!(selected && revertingId === selected.id)}
      />

      <Dialog open={!!revertDrift} onOpenChange={(open) => { if (!open) setRevertDrift(null); }}>
        <DialogContent className="sm:max-w-[720px]">
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
        </DialogContent>
      </Dialog>

      <Dialog open={!!conflictDialog} onOpenChange={(open) => { if (!open) setConflictDialog(null); }}>
        <DialogContent className="sm:max-w-[720px]">
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
        </DialogContent>
      </Dialog>

      <Dialog open={!!rejectDialog} onOpenChange={(open) => { if (!open) setRejectDialog(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject proposal</DialogTitle>
            <DialogDescription>
              An optional reason is included in the proposer's view + cascaded to bundle children.
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

function ProposalRow({
  proposal, onSelect, onApprove, onReject, onRevert, reverting,
}: {
  proposal: Proposal;
  onSelect: () => void;
  onApprove: () => void;
  onReject: () => void;
  onRevert: () => void;
  reverting: boolean;
}) {
  const isPending = proposal.status === 'pending';
  const isApproved = proposal.status === 'approved';
  return (
    <li className="py-3 flex items-center gap-3 hover:bg-gold/5 px-2 -mx-2 rounded transition-colors">
      <button
        type="button"
        onClick={onSelect}
        className="flex-1 text-left flex items-center gap-3 min-w-0"
      >
        <OperationBadge operation={proposal.operation} />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm truncate">{describePayloadSummary(proposal)}</p>
          <p className="text-[11px] text-ink/50">
            by {proposal.proposer_display_name || proposal.proposer_username || proposal.proposed_by_user_id} ·{' '}
            {new Date(proposal.proposed_at).toLocaleString()}
            {proposal.bundle_id && (
              <> · <span className="font-mono text-ink/40">{proposal.bundle_id.slice(0, 12)}</span></>
            )}
          </p>
        </div>
        <StatusBadge status={proposal.status} />
      </button>
      {isApproved && (
        <div className="flex gap-2 shrink-0">
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

function OperationBadge({ operation }: { operation: Operation }) {
  const classes: Record<Operation, string> = {
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

function StatusBadge({ status }: { status: Status }) {
  const classes: Record<Status, string> = {
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
      <DialogContent className="sm:max-w-[720px] max-h-[90vh] overflow-y-auto">
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
            {' '}on {new Date(proposal.proposed_at).toLocaleString()}.
            {proposal.reviewed_at && (
              <> Reviewed {new Date(proposal.reviewed_at).toLocaleString()}.</>
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
      </DialogContent>
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

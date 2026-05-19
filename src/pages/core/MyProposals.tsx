// =============================================================================
// My Proposals — creator's own dashboard.
// =============================================================================
//
// Anyone with `effectiveProfile.permissions['content-creator']` (or
// admin) lands here from the navbar to see what they've submitted,
// what the admin did with it, and to withdraw anything that's still
// pending.
//
// Phase 2b ships read + withdraw. Inline editing of pending payloads
// is a follow-up — the API supports PATCH but the UX for editing
// JSON in place is heavier than the queue benefits from right now.
// =============================================================================

import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { auth } from '../../lib/firebase';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { Badge } from '../../components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '../../components/ui/dialog';
import { ScrollText, X, Plus } from 'lucide-react';

type Status = 'pending' | 'approved' | 'rejected' | 'withdrawn';
type Operation = 'create' | 'update' | 'delete';
type EntityType =
  | 'tag'
  | 'tag_group'
  | 'spell_rule'
  | 'spell_rule_application'
  | 'class_spell_list';

type Proposal = {
  id: string;
  bundle_id: string | null;
  proposed_at: string;
  status: Status;
  entity_type: EntityType;
  entity_id: string | null;
  operation: Operation;
  proposed_payload: Record<string, any> | null;
  snapshot_at_proposal: Record<string, any> | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  notes_from_proposer: string | null;
};

const STATUS_FILTERS: Array<{ id: Status | 'all'; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Pending' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'withdrawn', label: 'Withdrawn' },
];

const ENTITY_LABEL: Record<EntityType, string> = {
  tag: 'Tag',
  tag_group: 'Tag Group',
  spell_rule: 'Spell Rule',
  spell_rule_application: 'Rule Application',
  class_spell_list: 'Class Spell List',
};

function previewName(p: Proposal): string {
  const payload = p.proposed_payload;
  if (payload && typeof payload === 'object') {
    if (typeof payload.name === 'string') return payload.name;
    if (typeof payload.slug === 'string') return payload.slug;
  }
  return p.entity_id ?? '(no preview)';
}

export default function MyProposals({ userProfile }: { userProfile: any }) {
  const [filter, setFilter] = useState<Status | 'all'>('all');
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState<string | null>(null);

  const isContentCreator = !!userProfile?.permissions?.['content-creator'];
  const isAdmin = userProfile?.role === 'admin';
  const allowed = isContentCreator || isAdmin;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      const url = new URL('/api/proposals', window.location.origin);
      if (filter !== 'all') url.searchParams.set('status', filter);
      const res = await fetch(url.pathname + url.search, {
        headers: idToken ? { Authorization: `Bearer ${idToken}` } : {},
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to load proposals (HTTP ${res.status})`);
      }
      const body = await res.json();
      setProposals(Array.isArray(body?.proposals) ? body.proposals : []);
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || 'Failed to load proposals.');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    if (!allowed) return;
    void load();
  }, [allowed, load]);

  const handleWithdraw = async (id: string) => {
    if (!confirm('Withdraw this proposal? Pending only; admin will no longer see it.')) return;
    setWorking(id);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      const res = await fetch(`/api/proposals/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: idToken ? { Authorization: `Bearer ${idToken}` } : {},
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to withdraw (HTTP ${res.status})`);
      }
      toast.success('Proposal withdrawn.');
      void load();
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || 'Failed to withdraw.');
    } finally {
      setWorking(null);
    }
  };

  if (!allowed) {
    return (
      <div className="max-w-3xl mx-auto py-20 text-center font-serif italic text-ink/60">
        You need the Content Creator permission to view this page.
        An admin can grant it from <a href="/admin/users" className="text-gold underline">/admin/users → Permissions</a>.
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-20">
      <div className="flex items-center gap-3 text-gold mb-2">
        <ScrollText className="w-6 h-6" />
        <span className="text-sm font-bold uppercase tracking-[0.3em]">Submissions</span>
      </div>

      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-2">
          <h1 className="text-4xl font-serif font-bold text-ink tracking-tight uppercase">My Proposals</h1>
          <p className="text-ink/60 font-serif italic">
            Compendium changes you've submitted for admin review. Pending entries can be withdrawn at any time.
          </p>
        </div>
        <NewProposalDialog onSubmitted={() => void load()} />
      </div>

      <div className="flex flex-wrap gap-2 border-b border-gold/10 pb-2">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`px-3 py-1.5 rounded-t-md transition-colors font-bold uppercase tracking-widest text-[10px] ${
              filter === f.id
                ? 'bg-gold text-white shadow-sm'
                : 'bg-card text-ink/60 hover:text-ink hover:bg-gold/10'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <Card className="border-gold/10">
        <CardHeader>
          <CardTitle className="text-base">
            {proposals.length} {filter === 'all' ? 'total' : filter}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading && proposals.length === 0 ? (
            <p className="text-ink/50 italic text-center py-12">Loading…</p>
          ) : proposals.length === 0 ? (
            <p className="text-ink/50 italic text-center py-12">No proposals to show.</p>
          ) : (
            <ul className="divide-y divide-gold/5">
              {proposals.map((p) => (
                <li key={p.id} className="py-4 space-y-2">
                  <div className="flex items-center gap-3 flex-wrap">
                    <OperationBadge op={p.operation} />
                    <span className="text-sm font-medium">{previewName(p)}</span>
                    <Badge variant="outline" className="text-[9px] border-ink/20 text-ink/50">
                      {ENTITY_LABEL[p.entity_type]}
                    </Badge>
                    <StatusBadge status={p.status} />
                    {p.bundle_id && (
                      <Badge variant="outline" className="text-[9px] font-mono border-ink/10 text-ink/40">
                        bundle {p.bundle_id.slice(0, 12)}
                      </Badge>
                    )}
                    {p.status === 'pending' && (
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => handleWithdraw(p.id)}
                        disabled={working === p.id}
                        className="ml-auto gap-1.5 border-ink/20 text-ink/60 hover:bg-ink/5"
                      >
                        <X className="w-3.5 h-3.5" /> Withdraw
                      </Button>
                    )}
                  </div>
                  <p className="text-[11px] text-ink/50">
                    Submitted {new Date(p.proposed_at).toLocaleString()}
                    {p.reviewed_at && <> · Reviewed {new Date(p.reviewed_at).toLocaleString()}</>}
                  </p>
                  {p.notes_from_proposer && (
                    <p className="text-xs text-ink/70 italic border-l-2 border-gold/30 pl-3">
                      {p.notes_from_proposer}
                    </p>
                  )}
                  {p.rejection_reason && (
                    <p className="text-xs text-blood/90 italic border-l-2 border-blood/30 pl-3">
                      Rejected: {p.rejection_reason}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function OperationBadge({ op }: { op: Operation }) {
  const classes: Record<Operation, string> = {
    create: 'bg-emerald-700/15 text-emerald-700 border-emerald-700/30',
    update: 'bg-archive-blue/15 text-archive-blue border-archive-blue/30',
    delete: 'bg-blood/15 text-blood border-blood/30',
  };
  return (
    <span className={`text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded border ${classes[op]}`}>
      {op}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* NewProposalDialog                                                            */
/*                                                                              */
/* Generic submit-a-proposal UI. Phase 2b ships this so content creators       */
/* can exercise the workflow before the per-editor "Propose change" hooks      */
/* (TagsExplorer / SpellRulesEditor / SpellListManager) land. JSON-payload     */
/* style — a power-user surface; the editors will provide friendlier UX for    */
/* their specific entity shapes when those hooks ship.                          */
/* -------------------------------------------------------------------------- */

const ENTITY_OPTIONS: Array<{ id: EntityType; label: string }> = [
  { id: 'tag', label: 'Tag' },
  { id: 'tag_group', label: 'Tag Group' },
  { id: 'spell_rule', label: 'Spell Rule' },
  { id: 'spell_rule_application', label: 'Rule Application' },
  { id: 'class_spell_list', label: 'Class Spell List' },
];

function NewProposalDialog({ onSubmitted }: { onSubmitted: () => void }) {
  const [open, setOpen] = useState(false);
  const [entityType, setEntityType] = useState<EntityType>('tag');
  const [operation, setOperation] = useState<Operation>('create');
  const [entityId, setEntityId] = useState('');
  const [payloadText, setPayloadText] = useState('{\n  "name": "",\n  "slug": "",\n  "group_id": ""\n}');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    setError('');
    if (operation !== 'create' && !entityId.trim()) {
      setError('`entity_id` is required for update / delete operations.');
      return;
    }
    let payload: any = null;
    if (operation !== 'delete') {
      try {
        payload = JSON.parse(payloadText);
      } catch (err: any) {
        setError(`Proposed payload is not valid JSON: ${err?.message || err}`);
        return;
      }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        setError('Proposed payload must be a JSON object.');
        return;
      }
    }
    setSubmitting(true);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/proposals', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          revisions: [
            {
              entity_type: entityType,
              entity_id: entityId.trim() || null,
              operation,
              proposed_payload: operation === 'delete' ? null : payload,
              notes_from_proposer: notes.trim() || null,
            },
          ],
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Submit failed (HTTP ${res.status})`);
      }
      toast.success('Proposal submitted for review.');
      setOpen(false);
      setEntityId('');
      setNotes('');
      onSubmitted();
    } catch (err: any) {
      setError(err?.message || 'Submit failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={
        <Button className="gap-2 bg-gold text-white">
          <Plus className="w-4 h-4" /> New proposal
        </Button>
      } />
      <DialogContent className="sm:max-w-[640px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Submit a proposal</DialogTitle>
          <DialogDescription>
            Generic form for the proposal workflow. Per-editor "Propose change" hooks
            will replace this for typical flows; this form stays as a fallback for
            unusual cases (delete an orphaned row, bulk JSON edits, etc.).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">Entity</label>
              <select
                className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
                value={entityType}
                onChange={(e) => setEntityType(e.target.value as EntityType)}
              >
                {ENTITY_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Operation</label>
              <select
                className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
                value={operation}
                onChange={(e) => setOperation(e.target.value as Operation)}
              >
                <option value="create">Create</option>
                <option value="update">Update</option>
                <option value="delete">Delete</option>
              </select>
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">
              Entity ID {operation === 'create' && <span className="text-ink/40">(optional — server generates one)</span>}
            </label>
            <Input
              value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
              placeholder={operation === 'create' ? 'leave blank to auto-generate' : 'required for update/delete'}
              className="font-mono text-xs"
            />
          </div>
          {operation !== 'delete' && (
            <div className="space-y-1">
              <label className="text-sm font-medium">Proposed payload (JSON)</label>
              <Textarea
                value={payloadText}
                onChange={(e) => setPayloadText(e.target.value)}
                rows={8}
                className="font-mono text-xs"
              />
            </div>
          )}
          <div className="space-y-1">
            <label className="text-sm font-medium">Notes to reviewer <span className="text-ink/40">(optional)</span></label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Context the admin should know before approving."
            />
          </div>
          {error && <p className="text-sm text-blood">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={submitting} className="bg-gold text-white">
            {submitting ? 'Submitting…' : 'Submit'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

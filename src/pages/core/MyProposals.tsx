// =============================================================================
// My Proposals — creator's own dashboard.
// =============================================================================
//
// Anyone with `effectiveProfile.permissions['content-creator']` (or
// admin) lands here from the navbar. Three top-level tabs:
//
//   - Submissions: the user's own proposal queue (status sub-filters
//     within: All / Pending / Approved / Rejected / Withdrawn). Read +
//     withdraw. Inline editing of pending payloads is deferred — the
//     API supports PATCH but the UX is heavier than the queue benefits
//     from right now.
//   - New: a launcher card per editor wired through `useEntityWriter`.
//     Clicking opens the editor; for content-creators its Save / Add
//     buttons round-trip through `/api/proposals`. Editors not yet
//     wired show as "coming soon".
//   - Edit: parallel launcher to surface read pages where the user can
//     pick an existing entity and open it for editing. Same wiring
//     status mapping as the New tab.
// =============================================================================

import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { auth } from '../../lib/firebase';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import {
  ScrollText, X, Tags as TagsIcon, Sparkles, BookOpen, ArrowRight,
  Plus, Edit3, Inbox, Swords, Layers,
} from 'lucide-react';

type Status = 'pending' | 'approved' | 'rejected' | 'withdrawn';
type Operation = 'create' | 'update' | 'delete';
type EntityType =
  | 'tag'
  | 'tag_group'
  | 'spell_rule'
  | 'spell_rule_application'
  | 'class_spell_list';

type TopTab = 'submissions' | 'new' | 'edit';

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
  const [topTab, setTopTab] = useState<TopTab>('submissions');
  const [filter, setFilter] = useState<Status | 'all'>('all');
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState<string | null>(null);

  // Use `in` rather than `!!perms[key]` — an unrestricted grant
  // stores scope as `null`, which is the truthy-check trap that
  // mis-classified content-creators as not holding the perm.
  const isContentCreator =
    !!userProfile?.permissions &&
    Object.prototype.hasOwnProperty.call(userProfile.permissions, 'content-creator');
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

  // Only fetch when the Submissions tab is active — no point hitting
  // the API when the user is on New/Edit. Re-fires when the user
  // switches back to Submissions and when the status filter changes.
  useEffect(() => {
    if (!allowed) return;
    if (topTab !== 'submissions') return;
    void load();
  }, [allowed, topTab, load]);

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
        <span className="text-sm font-bold uppercase tracking-[0.3em]">Proposals</span>
      </div>

      <div className="space-y-2">
        <h1 className="text-4xl font-serif font-bold text-ink tracking-tight uppercase">My Proposals</h1>
        <p className="text-ink/60 font-serif italic">
          Compendium changes you've submitted for admin review. Use the
          tabs below to draft something new, edit existing entities, or
          review the queue of your past submissions.
        </p>
      </div>

      {/* Top-level tabs: Submissions / New / Edit */}
      <div className="flex flex-wrap gap-2 border-b border-gold/10 pb-2">
        {([
          { id: 'submissions', label: 'Submissions', icon: Inbox },
          { id: 'new', label: 'New', icon: Plus },
          { id: 'edit', label: 'Edit', icon: Edit3 },
        ] as const).map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setTopTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-t-md transition-colors font-bold uppercase tracking-widest text-[10px] ${
                topTab === tab.id
                  ? 'bg-gold text-white shadow-sm'
                  : 'bg-card text-ink/60 hover:text-ink hover:bg-gold/10'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {topTab === 'submissions' && (
        <SubmissionsPanel
          filter={filter}
          setFilter={setFilter}
          proposals={proposals}
          loading={loading}
          working={working}
          onWithdraw={handleWithdraw}
        />
      )}
      {topTab === 'new' && <CreateLauncher />}
      {topTab === 'edit' && <EditLauncher />}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* SubmissionsPanel — the existing queue view, now scoped to its tab.        */
/* -------------------------------------------------------------------------- */

function SubmissionsPanel({
  filter, setFilter, proposals, loading, working, onWithdraw,
}: {
  filter: Status | 'all';
  setFilter: (s: Status | 'all') => void;
  proposals: Proposal[];
  loading: boolean;
  working: string | null;
  onWithdraw: (id: string) => void;
}) {
  return (
    <>
      <div className="flex flex-wrap gap-2 border-b border-gold/5 pb-2">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`px-3 py-1.5 rounded-t-md transition-colors font-bold uppercase tracking-widest text-[10px] ${
              filter === f.id
                ? 'bg-gold/15 text-gold border border-gold/30'
                : 'bg-transparent text-ink/50 hover:text-ink hover:bg-gold/5'
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
                        onClick={() => onWithdraw(p.id)}
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
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Editor launcher cards — shared shape used by both New and Edit tabs.      */
/* -------------------------------------------------------------------------- */

type LauncherEntry = {
  title: string;
  description: string;
  href: string;
  icon: any;
  status: 'ready' | 'coming-soon';
};

function LauncherGrid({ entries }: { entries: LauncherEntry[] }) {
  return (
    <ul className="grid gap-3 md:grid-cols-2">
      {entries.map((editor) => {
        const Icon = editor.icon;
        const ready = editor.status === 'ready';
        const body = (
          <div
            className={`group p-3 border rounded transition-colors h-full ${
              ready
                ? 'border-gold/20 hover:border-gold hover:bg-gold/10 cursor-pointer'
                : 'border-ink/10 bg-card/30 cursor-not-allowed opacity-60'
            }`}
          >
            <div className="flex items-start gap-3">
              <Icon className="w-5 h-5 text-gold mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm text-ink flex items-center gap-2">
                  {editor.title}
                  {!ready && (
                    <Badge variant="outline" className="text-[9px] border-ink/20 text-ink/40">
                      coming soon
                    </Badge>
                  )}
                </p>
                <p className="text-xs text-ink/60 mt-1 leading-snug">{editor.description}</p>
              </div>
              {ready && (
                <ArrowRight className="w-4 h-4 text-gold/40 group-hover:text-gold shrink-0 mt-0.5" />
              )}
            </div>
          </div>
        );
        return (
          <li key={editor.title}>
            {ready ? <Link to={editor.href}>{body}</Link> : body}
          </li>
        );
      })}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */
/* CreateLauncher — the New tab.                                              */
/*                                                                              */
/* What can the user CREATE? Each entry maps to the editor's own create        */
/* affordance (the "+ New …" buttons inside TagsExplorer, etc.). Add new        */
/* rows as Phase 2c-2 / 2c-3 wire SpellRulesEditor and SpellListManager.       */
/* -------------------------------------------------------------------------- */

const CREATE_ENTRIES: LauncherEntry[] = [
  {
    title: 'Tags & Tag Groups',
    description: 'Add a new tag (or tag group) to the compendium taxonomy.',
    href: '/compendium/tags',
    icon: TagsIcon,
    status: 'ready',
  },
  {
    title: 'Spell Rules',
    description: 'Define a new rule that filters spells onto class lists by tag, level, school, etc.',
    href: '/compendium/spell-rules',
    icon: Sparkles,
    status: 'ready',
  },
  {
    title: 'Class Spell Lists',
    description: 'Pin a new spell to a class\'s spell list outside the rule-driven set.',
    href: '/compendium/spell-lists',
    icon: BookOpen,
    status: 'ready',
  },
];

function CreateLauncher() {
  return (
    <Card className="border-gold/20 bg-gold/5">
      <CardHeader>
        <CardTitle className="text-base font-bold uppercase tracking-widest">
          Create a new proposal
        </CardTitle>
        <p className="text-xs text-ink/60 mt-1 leading-snug">
          Open one of the editors below. Their "+ New …" affordances round-trip
          through this proposal queue for content creators automatically.
        </p>
      </CardHeader>
      <CardContent>
        <LauncherGrid entries={CREATE_ENTRIES} />
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* EditLauncher — the Edit tab.                                                */
/*                                                                              */
/* What can the user EDIT? Same wiring map as New, plus the public read         */
/* pages where you can browse to an existing spell / class / etc. Editing       */
/* those entities still resolves to admin-only direct writes until Phase 4      */
/* extends the proposal allowlist to `spell` / `class`. Until then, the cards   */
/* surface as "coming soon" — clickable cards still hand you the read page in   */
/* case you just want to browse.                                                */
/* -------------------------------------------------------------------------- */

const EDIT_ENTRIES: LauncherEntry[] = [
  {
    title: 'Tags & Tag Groups',
    description: 'Browse the taxonomy and propose renames, slug changes, or deletes on an existing tag.',
    href: '/compendium/tags',
    icon: TagsIcon,
    status: 'ready',
  },
  {
    title: 'Spell Rules',
    description: 'Edit an existing rule\'s query, name, or manual spell list — and propose applying it to (or removing it from) classes.',
    href: '/compendium/spell-rules',
    icon: Sparkles,
    status: 'ready',
  },
  {
    title: 'Class Spell Lists',
    description: 'Add or remove pinned spells from a class\'s spell list.',
    href: '/compendium/spell-lists',
    icon: BookOpen,
    status: 'ready',
  },
  {
    title: 'Spells',
    description: 'Browse the spell catalogue. Propose-edit support arrives with Phase 4 of content-proposals.',
    href: '/compendium/spells',
    icon: Sparkles,
    status: 'coming-soon',
  },
  {
    title: 'Classes',
    description: 'Browse classes via the compendium. Propose-edit support arrives in a future phase (out of scope today).',
    href: '/compendium/classes',
    icon: Swords,
    status: 'coming-soon',
  },
  {
    title: 'Modular Options',
    description: 'Browse the option groups (Maneuvers, Invocations, Infusions, …). Propose-edit support TBD.',
    href: '/compendium/unique-options',
    icon: Layers,
    status: 'coming-soon',
  },
];

function EditLauncher() {
  return (
    <Card className="border-gold/20 bg-gold/5">
      <CardHeader>
        <CardTitle className="text-base font-bold uppercase tracking-widest">
          Edit an existing entity
        </CardTitle>
        <p className="text-xs text-ink/60 mt-1 leading-snug">
          Pick a system below to browse its catalogue and edit an existing entry.
          For wired editors, edits round-trip through the proposal queue
          automatically. Entries marked "coming soon" land you on the read page
          for now — propose-edit support arrives as later phases extend the
          allowlist.
        </p>
      </CardHeader>
      <CardContent>
        <LauncherGrid entries={EDIT_ENTRIES} />
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Small badge components                                                       */
/* -------------------------------------------------------------------------- */

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

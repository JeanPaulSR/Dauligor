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
  Plus, Edit3, Inbox, Swords, Layers, Package, Send, Trash2,
} from 'lucide-react';
import { useBlock } from '../../lib/proposalBlock';
import { BlockMetadataDialog } from '../../components/proposals/BlockMetadataDialog';
import { PickOrCreateBlockDialog } from '../../components/proposals/PickOrCreateBlockDialog';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { formatSqliteLocal } from '../../lib/sqliteTimestamps';
import { useNavigate } from 'react-router-dom';

type Status = 'draft' | 'pending' | 'approved' | 'rejected' | 'withdrawn';
type Operation = 'create' | 'update' | 'delete';
type EntityType =
  | 'tag'
  | 'tag_group'
  | 'spell_rule'
  | 'spell_rule_application'
  | 'class_spell_list';

type TopTab = 'submissions' | 'new' | 'edit' | 'block';

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
  const [topTab, setTopTab] = useState<TopTab>(() => {
    // Allow deep-linking with ?tab=block (navbar Block pill uses this).
    if (typeof window === 'undefined') return 'submissions';
    const t = new URLSearchParams(window.location.search).get('tab');
    if (t === 'block' || t === 'new' || t === 'edit' || t === 'submissions') return t;
    return 'submissions';
  });
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
      // Drafts have their own Block tab — never surface them under
      // Submissions (the queue view), even when filter is 'all'.
      const all: Proposal[] = Array.isArray(body?.proposals) ? body.proposals : [];
      setProposals(all.filter((p) => p.status !== 'draft'));
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
          Compendium changes you've submitted for admin review. Stack
          multiple edits into a <strong>Block</strong> for one combined
          proposal, use <strong>New</strong> / <strong>Edit</strong> to
          jump into an editor, or review the queue of your past
          submissions.
        </p>
      </div>

      {/* Top-level tabs: Submissions / Block / New / Edit. Block sits
          between Submissions and New so users see it as the "active
          work area" before the launchers. */}
      <BlockTabBar topTab={topTab} setTopTab={setTopTab} />

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
      {topTab === 'block' && <BlockPanel />}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Tab strip with a live "Block · N" badge.                                   */
/* -------------------------------------------------------------------------- */

function BlockTabBar({
  topTab,
  setTopTab,
}: {
  topTab: TopTab;
  setTopTab: (t: TopTab) => void;
}) {
  const { activeBundleId, drafts } = useBlock();
  return (
    <div className="flex flex-wrap gap-2 border-b border-gold/10 pb-2">
      {([
        { id: 'submissions', label: 'Submissions', icon: Inbox },
        { id: 'block', label: 'Block', icon: Package },
        { id: 'new', label: 'New', icon: Plus },
        { id: 'edit', label: 'Edit', icon: Edit3 },
      ] as const).map(tab => {
        const Icon = tab.icon;
        const showBadge = tab.id === 'block' && activeBundleId && drafts.length > 0;
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
            {showBadge && (
              <Badge variant="outline" className="ml-1 text-[9px] px-1.5 py-0 bg-blood/15 border-blood/30 text-blood">
                {drafts.length}
              </Badge>
            )}
          </button>
        );
      })}
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
                    Submitted {formatSqliteLocal(p.proposed_at)}
                    {p.reviewed_at && <> · Reviewed {formatSqliteLocal(p.reviewed_at)}</>}
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
  // Clicking a launcher opens the block picker BEFORE navigating to
  // the editor. The picker resolves "which block does this work
  // belong to?" — without it, the user lands in the editor not
  // knowing which block their next save will hit. Cancelling the
  // picker means cancelling the navigation entirely.
  const [pendingEntry, setPendingEntry] = useState<LauncherEntry | null>(null);
  const { openBlocks, setActiveBlock, startBlock } = useBlock();
  const navigate = useNavigate();

  const closeAndNavigate = (href: string) => {
    setPendingEntry(null);
    navigate(href);
  };

  const handlePick = (bundleId: string) => {
    if (!pendingEntry) return;
    setActiveBlock(bundleId);
    closeAndNavigate(pendingEntry.href);
  };

  const handleCreate = async (name: string, description: string | null) => {
    if (!pendingEntry) return;
    // startBlock POSTs the new bundle AND sets it active before
    // resolving — by the time we navigate the editor's wrapper will
    // see the right active id.
    await startBlock(name, description);
    closeAndNavigate(pendingEntry.href);
  };

  return (
    <>
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
              {ready ? (
                <button
                  type="button"
                  onClick={() => setPendingEntry(editor)}
                  className="w-full text-left"
                >
                  {body}
                </button>
              ) : (
                body
              )}
            </li>
          );
        })}
      </ul>
      <PickOrCreateBlockDialog
        open={!!pendingEntry}
        onOpenChange={(open) => {
          if (!open) setPendingEntry(null);
        }}
        openBlocks={openBlocks}
        onPick={handlePick}
        onCreate={handleCreate}
        title={pendingEntry ? `${pendingEntry.title} — pick a block` : 'Pick a block'}
        description="Your edits in this editor will be saved to the block you pick. Choose an existing block or create a new one."
      />
    </>
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
    href: '/proposals/edit/tags',
    icon: TagsIcon,
    status: 'ready',
  },
  {
    title: 'Spell Rules',
    description: 'Define a new rule that filters spells onto class lists by tag, level, school, etc.',
    href: '/proposals/edit/spell-rules',
    icon: Sparkles,
    status: 'ready',
  },
  {
    title: 'Class Spell Lists',
    description: 'Pin a new spell to a class\'s spell list outside the rule-driven set.',
    href: '/proposals/edit/spell-lists',
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
    href: '/proposals/edit/tags',
    icon: TagsIcon,
    status: 'ready',
  },
  {
    title: 'Spell Rules',
    description: 'Edit an existing rule\'s query, name, or manual spell list — and propose applying it to (or removing it from) classes.',
    href: '/proposals/edit/spell-rules',
    icon: Sparkles,
    status: 'ready',
  },
  {
    title: 'Class Spell Lists',
    description: 'Add or remove pinned spells from a class\'s spell list.',
    href: '/proposals/edit/spell-lists',
    icon: BookOpen,
    status: 'ready',
  },
  {
    title: 'Spells',
    description: 'Browse the spell catalogue. Propose-edit support arrives with Phase 4.5d.',
    href: '/proposals/edit/spells',
    icon: Sparkles,
    status: 'ready',
  },
  {
    title: 'Classes',
    description: 'Browse classes via the compendium. Propose-edit support arrives in Phase 4.5f.',
    href: '/proposals/edit/classes',
    icon: Swords,
    status: 'ready',
  },
  {
    title: 'Modular Options',
    description: 'Browse the option groups (Maneuvers, Invocations, Infusions, …) and pick one to edit.',
    href: '/proposals/edit/option-groups',
    icon: Layers,
    status: 'ready',
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
/* BlockPanel — the active Submission Block view.                            */
/*                                                                            */
/* No block open: a Start button + a short explainer of what blocks do.      */
/* Block open: list of staged drafts + Submit + Discard + a hint to keep     */
/* editing.                                                                  */
/* -------------------------------------------------------------------------- */

function BlockPanel() {
  const {
    activeBundleId,
    activeBundle,
    drafts,
    openBlocks,
    loading,
    startBlock,
    setActiveBlock,
    submitBlock,
    discardBlock,
    patchActiveBlock,
  } = useBlock();
  const [working, setWorking] = useState<'submit' | 'discard' | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);

  const handleCreate = async (name: string, description: string | null) => {
    await startBlock(name, description);
    toast.success('Block started. Edits made now will be staged until you submit.');
  };

  const handleSubmit = async () => {
    setWorking('submit');
    try {
      const { submitted } = await submitBlock();
      toast.success(`Block submitted (${submitted} revision${submitted === 1 ? '' : 's'} sent for review).`);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to submit block.');
    } finally {
      setWorking(null);
    }
  };
  const performDiscard = async () => {
    setWorking('discard');
    try {
      const { discarded } = await discardBlock();
      toast.success(`Block discarded (${discarded} draft${discarded === 1 ? '' : 's'} removed).`);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to discard block.');
      throw err; // keep the ConfirmDialog open on failure
    } finally {
      setWorking(null);
    }
  };
  const handleRename = async (name: string, description: string | null) => {
    await patchActiveBlock({ name, description });
    toast.success('Block updated.');
  };

  // Sort: the currently-active block first, others by most-recently-updated.
  const sortedBlocks = [...openBlocks].sort((a, b) => {
    if (a.id === activeBundleId) return -1;
    if (b.id === activeBundleId) return 1;
    return b.updated_at.localeCompare(a.updated_at);
  });

  return (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div className="space-y-1 min-w-0 flex-1">
          <h3 className="text-sm font-bold uppercase tracking-widest text-ink/70">
            Your Blocks
          </h3>
          <p className="text-xs text-ink/55 leading-relaxed">
            Stage edits across multiple editors in a single proposal. Click a block to
            make it active; subsequent saves in any wired editor land in it as drafts
            until you click Submit Block.
          </p>
        </div>
        <Button
          onClick={() => setCreateOpen(true)}
          className="gap-2 bg-gold text-white flex-shrink-0"
        >
          <Plus className="w-4 h-4" /> Start a new block
        </Button>
      </div>

      {openBlocks.length === 0 ? (
        <Card className="border-gold/20 bg-gold/5">
          <CardContent className="py-10 text-center space-y-2">
            <Package className="w-8 h-8 mx-auto text-gold/60" />
            <p className="text-sm text-ink/70 font-medium">
              You haven't started a block yet.
            </p>
            <p className="text-xs text-ink/55 max-w-md mx-auto">
              Click <strong>Start a new block</strong> above to begin. Each block bundles
              your edits into one proposal for an admin to review.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {sortedBlocks.map((b) => {
            const isActive = b.id === activeBundleId;
            return (
              <li key={b.id}>
                {isActive ? (
                  <ActiveBlockCard
                    block={b}
                    drafts={drafts}
                    loading={loading}
                    working={working}
                    onRename={() => setRenameOpen(true)}
                    onDiscard={() => setDiscardConfirmOpen(true)}
                    onSubmit={handleSubmit}
                  />
                ) : (
                  <InactiveBlockCard
                    block={b}
                    onActivate={() => setActiveBlock(b.id)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
      <BlockMetadataDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        mode="rename"
        initialName={activeBundle?.name || ''}
        initialDescription={activeBundle?.description ?? null}
        onSubmit={handleRename}
      />
      <ConfirmDialog
        open={discardConfirmOpen}
        onOpenChange={setDiscardConfirmOpen}
        title={`Discard ${activeBundle?.name ? `"${activeBundle.name}"` : 'this block'}?`}
        description={
          drafts.length > 0
            ? `This deletes ${drafts.length} staged change${drafts.length === 1 ? '' : 's'} and clears the block. Approved changes (if any) remain in your audit trail.`
            : 'This clears the block. There are no staged changes to lose.'
        }
        confirmLabel="Discard block"
        destructive
        onConfirm={performDiscard}
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Per-block cards rendered inside the BlockPanel list.                         */
/* -------------------------------------------------------------------------- */

function ActiveBlockCard({
  block,
  drafts,
  loading,
  working,
  onRename,
  onDiscard,
  onSubmit,
}: {
  block: import('../../lib/proposalBlock').ProposalBundle;
  drafts: import('../../lib/proposalBlock').DraftRevision[];
  loading: boolean;
  working: 'submit' | 'discard' | null;
  onRename: () => void;
  onDiscard: () => void;
  onSubmit: () => void;
}) {
  return (
    <Card className="border-blood/30 bg-blood/5 ring-2 ring-blood/20">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="space-y-1 min-w-0 flex-1">
          <CardTitle className="text-base font-bold uppercase tracking-widest flex items-center gap-2 flex-wrap">
            <Package className="w-4 h-4 text-blood" />
            <span className="truncate">{block.name}</span>
            <Badge variant="outline" className="ml-1 text-[9px] border-blood/30 text-blood">
              Active
            </Badge>
            <Badge variant="outline" className="text-[9px] border-blood/30 text-blood">
              {drafts.length} staged
            </Badge>
          </CardTitle>
          {block.description && (
            <p className="text-xs text-ink/70 leading-relaxed">{block.description}</p>
          )}
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <Button
            variant="outline"
            onClick={onRename}
            disabled={working !== null}
            className="gap-1.5"
          >
            <Edit3 className="w-3.5 h-3.5" /> Rename
          </Button>
          <Button
            variant="outline"
            onClick={onDiscard}
            disabled={working !== null}
            className="gap-1.5 border-blood/30 text-blood hover:bg-blood/10"
          >
            <Trash2 className="w-3.5 h-3.5" /> Discard
          </Button>
          <Button
            onClick={onSubmit}
            disabled={working !== null || drafts.length === 0}
            className="gap-1.5 bg-gold text-white"
          >
            <Send className="w-3.5 h-3.5" /> Submit Block
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading && drafts.length === 0 ? (
          <p className="text-ink/50 italic text-center py-12">Loading drafts…</p>
        ) : drafts.length === 0 ? (
          <div className="text-center py-8 text-ink/60 text-sm">
            <p>
              No drafts yet — open one of the editors (Tags, Spell Rules, Spell Lists,
              Spells) and make a change.
            </p>
            <p className="text-[11px] text-ink/40 mt-2">
              Each Save / Add / Delete you do while this block is active lands here
              instead of going to the admin queue.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-blood/10">
            {drafts.map((d) => (
              <li key={d.id} className="py-3 flex items-center gap-3">
                <OperationBadge op={d.operation} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {(d.proposed_payload && (d.proposed_payload as any).name)
                      || d.entity_id
                      || '(no preview)'}
                  </p>
                  <p className="text-[11px] text-ink/50">
                    <Badge variant="outline" className="text-[9px] border-ink/20 text-ink/50 mr-1">
                      {ENTITY_LABEL[d.entity_type as EntityType] || d.entity_type}
                    </Badge>
                    {formatSqliteLocal(d.proposed_at)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function InactiveBlockCard({
  block,
  onActivate,
}: {
  block: import('../../lib/proposalBlock').ProposalBundle;
  onActivate: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onActivate}
      className="w-full text-left rounded-lg border border-gold/15 bg-card/40 hover:border-gold/40 hover:bg-gold/[0.03] transition-colors p-4"
    >
      <div className="flex items-start gap-3">
        <Package className="w-4 h-4 text-ink/40 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-ink truncate">{block.name}</p>
            <span className="text-[10px] uppercase tracking-widest text-ink/40">
              click to make active
            </span>
          </div>
          {block.description && (
            <p className="text-[11px] text-ink/60 mt-1 leading-relaxed line-clamp-2">
              {block.description}
            </p>
          )}
          <p className="text-[10px] text-ink/40 mt-1.5">
            Last updated {formatSqliteLocal(block.updated_at)}
          </p>
        </div>
      </div>
    </button>
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

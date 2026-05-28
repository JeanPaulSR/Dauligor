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
  Scroll, Hammer, Eye,
} from 'lucide-react';
import { useBlock } from '../../lib/proposalBlock';
import { BlockMetadataDialog } from '../../components/proposals/BlockMetadataDialog';
import { PickOrCreateBlockDialog } from '../../components/proposals/PickOrCreateBlockDialog';
import { SubclassPickerDialog } from '../../components/proposals/SubclassPickerDialog';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogContentLarge,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { formatSqliteLocal } from '../../lib/sqliteTimestamps';
import { useNavigate } from 'react-router-dom';

type Status = 'draft' | 'pending' | 'approved' | 'rejected' | 'withdrawn';
type Operation = 'create' | 'update' | 'delete';
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
  | 'scaling_column';

type TopTab = 'submissions' | 'block';

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
  pinned_at: string | null;
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
  spell: 'Spell',
  class: 'Class',
  subclass: 'Subclass',
  feat: 'Feat',
  item: 'Item',
  unique_option_group: 'Option Group',
  unique_option_item: 'Option Item',
  scaling_column: 'Scaling Column',
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
    // Legacy ?tab=new and ?tab=edit (from older bookmarks / docs) fall
    // through to the Block tab — that's where the New / Edit launchers
    // live now.
    if (typeof window === 'undefined') return 'submissions';
    const t = new URLSearchParams(window.location.search).get('tab');
    if (t === 'block' || t === 'new' || t === 'edit') return 'block';
    if (t === 'submissions') return 'submissions';
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

function buildReviewRoute(p: Proposal): string | null {
  // Single-work editors live at a per-instance route. For UPDATE/DELETE
  // proposals the id is `entity_id` (the live row); for CREATE proposals
  // the server forcibly nulls entity_id and the real id lives in
  // proposed_payload.id (the entity_id-null fallback, see architecture
  // doc). Without the fallback, clicking a class CREATE submission in
  // the queue would dead-end at a null id with no editor link.
  if (p.entity_type === 'class') {
    const id = p.entity_id ?? (
      p.proposed_payload && typeof p.proposed_payload === 'object'
        ? (p.proposed_payload as any).id
        : null
    );
    if (id) return `/proposals/edit/classes/edit/${id}?review=${p.id}`;
  }
  if (p.entity_type === 'subclass') {
    const id = p.entity_id ?? (
      p.proposed_payload && typeof p.proposed_payload === 'object'
        ? (p.proposed_payload as any).id
        : null
    );
    if (id) return `/proposals/edit/subclasses/edit/${id}?review=${p.id}`;
  }
  // Multi-work editors live at a single list route; the editor reads
  // ?review from the URL and (eventually) loads the proposed_payload
  // as the focused entity. Until each multi-work editor wires that,
  // the user lands in the catalog with the wrapper's header hidden.
  const multiWorkBase: Record<string, string> = {
    tag: '/proposals/edit/tags',
    tag_group: '/proposals/edit/tags',
    spell_rule: '/proposals/edit/spell-rules',
    spell_rule_application: '/proposals/edit/spell-rules',
    spell: '/proposals/edit/spells',
    feat: '/proposals/edit/feats',
    item: '/proposals/edit/items',
    unique_option_group: '/proposals/edit/option-groups',
    unique_option_item: '/proposals/edit/option-groups',
  };
  const base = multiWorkBase[p.entity_type];
  if (!base) return null;
  return `${base}?review=${p.id}`;
}

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
  const navigate = useNavigate();
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
                    {p.pinned_at && (
                      <Badge
                        variant="outline"
                        className="text-[9px] border-gold/40 text-gold"
                        title="Admin pinned this proposal — it's exempt from the 30-day retention sweep."
                      >
                        Pinned
                      </Badge>
                    )}
                    {(() => {
                      const reviewHref = buildReviewRoute(p);
                      if (!reviewHref) return null;
                      const label = p.status === 'rejected' ? 'Edit & resubmit' : 'Review';
                      return (
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() => navigate(reviewHref)}
                          className={`ml-auto gap-1.5 ${
                            p.status === 'rejected'
                              ? 'border-blood/30 text-blood hover:bg-blood/10'
                              : 'border-archive-blue/30 text-archive-blue hover:bg-archive-blue/10'
                          }`}
                          title={p.status === 'rejected'
                            ? 'Open this rejected proposal in the editor — fix and resubmit.'
                            : 'View this submission read-only in its editor.'}
                        >
                          <Eye className="w-3.5 h-3.5" /> {label}
                        </Button>
                      );
                    })()}
                    {p.status === 'pending' && (
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => onWithdraw(p.id)}
                        disabled={working === p.id}
                        className="gap-1.5 border-ink/20 text-ink/60 hover:bg-ink/5"
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
  /**
   * Optional click-time picker. When set, clicking the launcher
   * opens this picker INSTEAD of navigating to `href` directly —
   * the picker resolves to a final href and then the normal
   * block-picker + navigation flow runs against that.
   *
   * Use case: Subclass entries need a class picked up front (and,
   * for edit, a subclass within that class) so the editor opens
   * with the right context.
   */
  picker?: 'subclass-create' | 'subclass-edit';
};

function LauncherGrid({
  entries,
  skipBlockPicker = false,
  onNavigated,
}: {
  entries: LauncherEntry[];
  /**
   * When true, clicking a launcher navigates immediately without the
   * PickOrCreateBlockDialog gate. Use when the caller already knows
   * the active block is set (e.g. the in-block New/Edit popups).
   */
  skipBlockPicker?: boolean;
  /** Called after a successful navigation so a parent dialog can close. */
  onNavigated?: () => void;
}) {
  // Clicking a launcher opens the block picker BEFORE navigating to
  // the editor — except when skipBlockPicker is true (in-block popup
  // mode, where the active block is already resolved).
  const [pendingEntry, setPendingEntry] = useState<LauncherEntry | null>(null);
  // Custom picker state — set when the launcher entry has a `picker`
  // field that needs to resolve before we know the final navigation
  // href (subclass create/edit need a class chosen first).
  const [subclassPicker, setSubclassPicker] = useState<{
    mode: 'create' | 'edit';
    /** Bound to the launcher entry that triggered the picker, so the
     *  resolved href can flow through the existing block-picker gate
     *  (when applicable) without losing track of the launcher's
     *  block-picker-skip preference. */
    skipBlockPickerForResolved: boolean;
  } | null>(null);
  const { openBlocks, setActiveBlock, startBlock } = useBlock();
  const navigate = useNavigate();

  const closeAndNavigate = (href: string) => {
    setPendingEntry(null);
    navigate(href);
    onNavigated?.();
  };

  const handleClick = (editor: LauncherEntry) => {
    // Custom picker case — open the subclass picker first; defer the
    // block-picker step until AFTER the user resolves an href.
    if (editor.picker === 'subclass-create') {
      setSubclassPicker({ mode: 'create', skipBlockPickerForResolved: skipBlockPicker });
      return;
    }
    if (editor.picker === 'subclass-edit') {
      setSubclassPicker({ mode: 'edit', skipBlockPickerForResolved: skipBlockPicker });
      return;
    }
    if (skipBlockPicker) {
      navigate(editor.href);
      onNavigated?.();
      return;
    }
    setPendingEntry(editor);
  };

  // Called by SubclassPickerDialog once the user has picked everything
  // it needs — `href` is the fully-resolved /proposals/edit/subclasses/
  // {new|edit/<id>} url. From here we run the standard block-picker
  // gate (or skip it if the caller opted in) so the rest of the flow
  // mirrors a plain href-only launcher click.
  const handleSubclassPicked = (href: string) => {
    const skipBP = subclassPicker?.skipBlockPickerForResolved ?? false;
    setSubclassPicker(null);
    if (skipBP) {
      navigate(href);
      onNavigated?.();
      return;
    }
    setPendingEntry({
      title: 'Subclass',
      description: '',
      href,
      icon: () => null,
      status: 'ready',
    });
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
      {/* `auto-rows-fr` forces every row to share the tallest card's
          height, so the launcher reads as a clean grid rather than a
          ragged-bottom mosaic. Cards stretch via `h-full` on the
          inner body div — content stays at the top via items-start.
          The button wrapping each ready entry needs `h-full` too so
          the body can stretch INTO it (otherwise the body's h-full
          resolves to the button's content height). */}
      <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 auto-rows-fr">
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
            <li key={editor.title} className="h-full">
              {ready ? (
                <button
                  type="button"
                  onClick={() => handleClick(editor)}
                  className="w-full h-full text-left"
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
      <SubclassPickerDialog
        open={!!subclassPicker}
        onOpenChange={(open) => {
          if (!open) setSubclassPicker(null);
        }}
        mode={subclassPicker?.mode ?? 'create'}
        onPicked={handleSubclassPicked}
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* LauncherDialog — popup variant of CreateLauncher / EditLauncher rendered    */
/* from inside ActiveBlockCard's New / Edit buttons. The active block is      */
/* known (we're inside its card), so the launcher skips the block-picker      */
/* hop and navigates straight to the chosen editor.                            */
/* -------------------------------------------------------------------------- */

function LauncherDialog({
  open,
  onOpenChange,
  mode,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'new' | 'edit';
}) {
  const entries = mode === 'new' ? CREATE_ENTRIES : EDIT_ENTRIES;
  const title = mode === 'new' ? 'Create new content' : 'Edit existing content';
  const description = mode === 'new'
    ? 'Open one of the editors below. Saves will land in your active block as drafts until you submit it.'
    : 'Pick a system below to browse its catalogue and edit an existing entry. Edits round-trip through your active block.';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContentLarge>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <LauncherGrid
          entries={entries}
          skipBlockPicker
          onNavigated={() => onOpenChange(false)}
        />
      </DialogContentLarge>
    </Dialog>
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
  {
    title: 'Spells',
    description: 'Author a new spell — identity, level, school, components, activation, range, duration, and automation.',
    href: '/proposals/edit/spells',
    icon: Sparkles,
    status: 'ready',
  },
  {
    title: 'Classes',
    description: 'Draft a new class from scratch — hit die, proficiencies, advancements, spellcasting. Subclasses can be added after the parent class is saved.',
    href: '/proposals/edit/classes/new',
    icon: Swords,
    status: 'ready',
  },
  {
    title: 'Subclasses',
    // Subclasses are nested under a parent class. Picker opens first
    // so the user binds the class up front rather than navigating
    // into the class editor and finding the subclasses tab.
    description: 'Draft a new subclass — pick the parent class first, then fill in spellcasting, advancements, lore.',
    href: '/proposals/edit/subclasses/new',
    icon: Swords,
    status: 'ready',
    picker: 'subclass-create',
  },
  {
    title: 'Feats',
    description: 'Author a new feat — feat type, prerequisites, repeatable flag, uses, activities, effects.',
    href: '/proposals/edit/feats',
    icon: Scroll,
    status: 'ready',
  },
  {
    title: 'Items',
    description: 'Draft a new item — weapon, equipment, consumable, tool, loot, or container. Includes rarity, weight, price, attunement.',
    href: '/proposals/edit/items',
    icon: Hammer,
    status: 'ready',
  },
  {
    title: 'Modular Options',
    description: 'Start a new option group (Maneuvers, Invocations, Infusions, …) with its initial set of options.',
    href: '/proposals/edit/option-groups/new',
    icon: Layers,
    status: 'ready',
  },
];

/* -------------------------------------------------------------------------- */
/* EDIT_ENTRIES — what the user can EDIT. Same wiring map as the CREATE set,   */
/* plus read pages where the user can browse to an existing entity and open it */
/* for editing. Surfaced via the in-block Edit popup (LauncherDialog).         */
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
    description: 'Browse the spell catalogue and propose edits. Multi-spell workflow: clicking a different spell auto-stages the in-flight edits into your active block.',
    href: '/proposals/edit/spells',
    icon: Sparkles,
    status: 'ready',
  },
  {
    title: 'Classes',
    description: 'Browse the class catalog and pick one to edit. Top-level fields propose through; subclass and feature edits route into their own proposal flows.',
    href: '/proposals/edit/classes',
    icon: Swords,
    status: 'ready',
  },
  {
    title: 'Subclasses',
    // Two-step picker: choose parent class first, then pick the
    // subclass within it. Saves a couple of clicks vs. navigating
    // into ClassEditor's subclasses tab.
    description: 'Pick a class then the subclass you want to edit. Skips the parent ClassEditor entirely.',
    href: '/proposals/edit/subclasses',
    icon: Swords,
    status: 'ready',
    picker: 'subclass-edit',
  },
  {
    title: 'Feats',
    description: 'Browse the feat catalogue and propose edits to existing feats. Multi-feat workflow mirrors Spells — switch rows freely, edits auto-stage.',
    href: '/proposals/edit/feats',
    icon: Scroll,
    status: 'ready',
  },
  {
    title: 'Items',
    description: 'Browse the item catalogue and propose edits to weapons, equipment, consumables, tools, loot, or containers.',
    href: '/proposals/edit/items',
    icon: Hammer,
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
  const [submitConfirmOpen, setSubmitConfirmOpen] = useState(false);

  const handleCreate = async (name: string, description: string | null) => {
    await startBlock(name, description);
    toast.success('Block started. Edits made now will be staged until you submit.');
  };

  const performSubmit = async () => {
    setWorking('submit');
    try {
      const { submitted } = await submitBlock();
      toast.success(`Block submitted (${submitted} revision${submitted === 1 ? '' : 's'} sent for review).`);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to submit block.');
      throw err; // keep the ConfirmDialog open on failure
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
            A block is a grouping of content that is submitted for review. To create or
            edit content for a review block, click New and Edit respectively to open up
            editor windows.
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
                    onSubmit={() => setSubmitConfirmOpen(true)}
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
        open={createOpen}
        onOpenChange={setCreateOpen}
        mode="create"
        onSubmit={handleCreate}
      />
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
      <ConfirmDialog
        open={submitConfirmOpen}
        onOpenChange={setSubmitConfirmOpen}
        title={`Submit ${activeBundle?.name ? `"${activeBundle.name}"` : 'this block'} for review?`}
        description={
          drafts.length > 0
            ? `This sends ${drafts.length} staged change${drafts.length === 1 ? '' : 's'} to an admin for review. You won't be able to add more edits to this block once it's submitted.`
            : 'There are no staged changes in this block — submitting now will send an empty proposal.'
        }
        confirmLabel="Submit block"
        onConfirm={performSubmit}
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
  // In-block launcher popups. New = create content; Edit = pick from
  // the existing catalog. Both navigate into the wired editor with
  // the active block already set, so the editor's wrapper queues
  // saves into this block as drafts.
  const [newLauncherOpen, setNewLauncherOpen] = useState(false);
  const [editLauncherOpen, setEditLauncherOpen] = useState(false);

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
        <div className="flex gap-2 flex-shrink-0 flex-wrap">
          <Button
            onClick={() => setNewLauncherOpen(true)}
            disabled={working !== null}
            className="gap-1.5 bg-gold/15 border border-gold/30 text-gold hover:bg-gold/25"
          >
            <Plus className="w-3.5 h-3.5" /> New
          </Button>
          <Button
            onClick={() => setEditLauncherOpen(true)}
            disabled={working !== null}
            className="gap-1.5 bg-gold/15 border border-gold/30 text-gold hover:bg-gold/25"
          >
            <Edit3 className="w-3.5 h-3.5" /> Edit
          </Button>
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
        <LauncherDialog
          open={newLauncherOpen}
          onOpenChange={setNewLauncherOpen}
          mode="new"
        />
        <LauncherDialog
          open={editLauncherOpen}
          onOpenChange={setEditLauncherOpen}
          mode="edit"
        />
      </CardHeader>
      <CardContent>
        {loading && drafts.length === 0 ? (
          <p className="text-ink/50 italic text-center py-12">Loading drafts…</p>
        ) : drafts.length === 0 ? (
          <div className="text-center py-8 text-ink/60 text-sm">
            <p>
              No drafts yet — open one of the editors (Tags, Spell Rules, Spell Lists,
              Spells, Classes, Subclasses, Feats, Items, Option Groups) and make a change.
            </p>
            <p className="text-[11px] text-ink/40 mt-2">
              Each Save / Add / Delete you do while this block is active lands here
              instead of going to the admin queue.
            </p>
          </div>
        ) : (
          <DraftGroups drafts={drafts} />
        )}
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* DraftGroups — group an active block's drafts by entity_type so a mixed     */
/* block reads as "5 spells, 2 feats, 1 item" instead of one flat 8-row list. */
/* Groups appear in the order each entity_type's first draft was created     */
/* (proposed_at ASC from the block API).                                      */
/* -------------------------------------------------------------------------- */

// Maps entity_type → the route that lets the user "continue editing".
// Resolves a draft's "effective" id — the value an editor route should
// receive as :id. For UPDATE/DELETE drafts this is `entity_id` (the
// live row's PK). For CREATE drafts `entity_id` is null on the server
// (the proposal endpoint forcibly nulls it — there's no live row to
// point at yet); the client-minted UUID lives in `proposed_payload.id`.
// See docs/architecture/proposal-editor-pattern.md "The entity_id-null
// fallback".
function effectiveDraftId(
  d: import('../../lib/proposalBlock').DraftRevision,
): string | null {
  if (d.entity_id) return d.entity_id;
  const payload = d.proposed_payload;
  if (payload && typeof payload === 'object' && typeof (payload as any).id === 'string') {
    return (payload as any).id;
  }
  return null;
}

// Multi-work editors return a single list-editor route (the user picks
// the entity from inside it). Single-work editors return a function
// that builds a per-instance route from the draft (since each draft is
// its own page).
const CONTINUE_ROUTE: Record<string, string | ((d: import('../../lib/proposalBlock').DraftRevision) => string)> = {
  tag: '/proposals/edit/tags',
  tag_group: '/proposals/edit/tags',
  spell_rule: '/proposals/edit/spell-rules',
  spell_rule_application: '/proposals/edit/spell-rules',
  spell: '/proposals/edit/spells',
  feat: '/proposals/edit/feats',
  item: '/proposals/edit/items',
  unique_option_group: '/proposals/edit/option-groups',
  unique_option_item: '/proposals/edit/option-groups',
  // Single-work: per-instance routes. Use the entity_id-null fallback
  // so CREATE drafts (entity_id=null, real id in proposed_payload.id)
  // route correctly. Without it, clicking a class CREATE draft would
  // navigate to /proposals/edit/classes/edit/null and the editor would
  // load blank.
  class: (d) => {
    const id = effectiveDraftId(d);
    return id
      ? `/proposals/edit/classes/edit/${id}`
      : '/proposals/edit/classes';
  },
  subclass: (d) => {
    const id = effectiveDraftId(d);
    return id
      ? `/proposals/edit/subclasses/edit/${id}`
      : '/proposals/edit/subclasses';
  },
};

const SINGLE_WORK_ENTITY_TYPES = new Set(['class', 'subclass']);

function DraftGroups({
  drafts,
}: {
  drafts: import('../../lib/proposalBlock').DraftRevision[];
}) {
  const navigate = useNavigate();
  // Insertion-ordered Map preserves "first seen" position so the
  // grouped list stays stable as the user adds drafts. Within each
  // group, drafts come in the same order the API returned them.
  const groups = new Map<string, import('../../lib/proposalBlock').DraftRevision[]>();
  for (const d of drafts) {
    const key = d.entity_type;
    const bucket = groups.get(key);
    if (bucket) bucket.push(d);
    else groups.set(key, [d]);
  }

  return (
    <div className="space-y-4">
      {Array.from(groups.entries()).map(([entityType, group]) => {
        // Op counts for the section header. Mirrors the "create / update
        // / delete" mini-summary the old PendingDraftsPanel had.
        let creates = 0, updates = 0, deletes = 0;
        for (const d of group) {
          if (d.operation === 'create') creates++;
          else if (d.operation === 'update') updates++;
          else if (d.operation === 'delete') deletes++;
        }
        const label = ENTITY_LABEL[entityType as EntityType] || entityType;
        const isSingleWork = SINGLE_WORK_ENTITY_TYPES.has(entityType);
        const continueRoute = CONTINUE_ROUTE[entityType];
        const sectionHref = typeof continueRoute === 'string' ? continueRoute : null;
        return (
          <section key={entityType} className="space-y-1">
            <header className="flex items-center gap-2 flex-wrap text-[11px] uppercase tracking-widest text-ink/70 font-bold border-b border-blood/15 pb-1">
              <span>{label}</span>
              <Badge variant="outline" className="text-[9px] border-blood/20 text-blood">
                {group.length}
              </Badge>
              <span className="flex items-center gap-2 text-[10px] font-normal normal-case tracking-normal text-ink/50">
                {creates > 0 && <span className="text-emerald-700">{creates} create{creates === 1 ? '' : 's'}</span>}
                {updates > 0 && <span className="text-archive-blue">{updates} update{updates === 1 ? '' : 's'}</span>}
                {deletes > 0 && <span className="text-blood">{deletes} delete{deletes === 1 ? '' : 's'}</span>}
              </span>
              {/* Multi-work types get ONE Continue button at the
                  section level — the editor list-pane is where the
                  user resumes editing any of the staged entries. */}
              {!isSingleWork && sectionHref && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => navigate(sectionHref)}
                  className="ml-auto h-6 text-[10px] gap-1 border-gold/30 text-gold hover:bg-gold/10"
                >
                  Continue
                  <ArrowRight className="w-3 h-3" />
                </Button>
              )}
            </header>
            {isSingleWork ? (
              // Single-work types (class, subclass): one Continue
              // button per draft since each opens its own editor.
              <ul className="divide-y divide-blood/10">
                {group.map((d) => {
                  const name = (d.proposed_payload && (d.proposed_payload as any).name)
                    || d.entity_id
                    || '(no preview)';
                  const href = typeof continueRoute === 'function' ? continueRoute(d) : null;
                  return (
                    <li key={d.id} className="py-2 flex items-center gap-3">
                      <OperationBadge op={d.operation} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{name}</p>
                        <p className="text-[11px] text-ink/50">
                          {formatSqliteLocal(d.proposed_at)}
                        </p>
                      </div>
                      {href && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => navigate(href)}
                          className="h-7 gap-1 border-gold/30 text-gold hover:bg-gold/10 flex-shrink-0"
                        >
                          Continue
                          <ArrowRight className="w-3 h-3" />
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </section>
        );
      })}
    </div>
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

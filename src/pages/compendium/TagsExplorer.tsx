// =============================================================================
// Tags Explorer — single tri-pane page for the whole tag taxonomy
// =============================================================================
//
// Replaces the old `/compendium/tags` (overview cards) + `/compendium/tags/:id`
// (per-group editor) split with one explorer. Layout:
//
//   ┌───────────┬──────────────────────┬──────────────────────┐
//   │ Groups    │ Selected group's     │ Selected tag's       │
//   │ (rail)    │ tag tree + filter    │ detail + actions     │
//   │           │ + add-tag form       │  -or-                │
//   │           │                      │ group settings       │
//   │           │                      │ (when no tag picked) │
//   └───────────┴──────────────────────┴──────────────────────┘
//      ~240px      flex-1                ~320/360px
//
// Responsive shell — flex layout, mirrors /admin/proficiencies (see
// docs/ui/components.md → "Fullscreen master-detail page"). Three
// tiers:
//   • xl+    — 3 panes side-by-side (rail | tree | detail).
//   • lg–xl  — 2 panes: rail + body slot that toggles tree↔detail
//              based on `activeView`. Detail collapses first because
//              the tree is where users spend most of their time.
//   • < lg   — single pane drilldown (rail → tree → detail) with
//              sticky back-nav rows.
//
// Page height is locked to viewport-minus-navbar at every width so
// the columns reach the bottom of the screen on phones and tablets
// too (`h-[calc(100vh-4rem)]`). The `admin-page-fullscreen` body
// class strips main's padding + hides the global footer; columns
// scroll internally via `flex-1 min-h-0` + per-Card `overflow-y-auto`.
//
// URL strategy: `/compendium/tags` shows the empty-middle state;
// `/compendium/tags/:id` selects a group. Tag selection lives in
// component state (not URL) — admins bounce between tags rapidly and
// don't need deep links to a single tag. Detail is ~360px wide on
// the direct route, ~320px on the proposal route (slightly narrower
// to leave breathing room next to the ProposalEditorWrapper strip).
//
// Proposal route (`/proposals/edit/tags`) reuses the same component
// wrapped in ProposalEditorWrapper(fullscreen). The wrapper provides
// its own viewport-bound flex column; TagsExplorer's outer flips from
// `h-[calc(100vh-4rem)]` (direct) to `flex-1 min-h-0` (proposal) so
// it grows into the wrapper's flex slot.
//
// Merge / move pickers stay as Dialogs (search input + list need more
// room than the right pane affords). Everything else is in-page.
// =============================================================================

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../components/ui/dialog';
import MarkdownEditor from '../../components/MarkdownEditor';
import { SearchInput } from '../../components/ui/SearchInput';
import { toast } from 'sonner';
import {
  Tags as TagsIcon, Plus, X, Trash2, Check,
  CornerDownRight, ChevronDown, ChevronRight, CornerLeftUp,
  Settings2, BookOpen,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { fetchCollection, fetchDocument, upsertDocument, deleteDocument } from '../../lib/d1';
import { fetchTagUsageMap, invalidateTagUsageCache, summarizeBreakdown, type TagUsageBreakdown } from '../../lib/tagUsage';
import { mergeTagInto } from '../../lib/tagMerge';
import { moveTagToParent } from '../../lib/tagMove';
import { normalizeTagRow } from '../../lib/tagHierarchy';
import { actionLabel, type WriterApi } from '../../lib/proposalAware';
import { useProposalAccumulator, useProposalContextOptional } from '../../lib/proposalAccumulator';
import { useProposalEntityDrafts } from '../../hooks/useProposalEntityDrafts';
import { useProposalReview, resolveReviewPayload } from '../../lib/proposalReview';
import { useBlock } from '../../lib/proposalBlock';
import { TombstoneRow, DeletedEntityBanner } from '../../components/proposals/TombstoneRow';

const SYSTEM_CLASSIFICATIONS = [
  'class', 'subclass', 'race', 'subrace', 'feat', 'background',
  'skill', 'tool', 'spell', 'item', 'lore',
];

// Per migration 20260512-1418, the underlying error surfaces from queryD1
// as a thrown Error whose message contains "UNIQUE constraint". Rewrite
// the generic "Failed to ..." toast into something the user can act on.
const isUniqueConstraintError = (err: unknown): boolean => {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('UNIQUE constraint');
};

// ═══════════════════════════════════════════════════════════════════════
// Main component
// ═══════════════════════════════════════════════════════════════════════

export default function TagsExplorer({ userProfile }: { userProfile: any }) {
  // Admins write directly; content-creators write through the
  // proposal queue; everyone else is read-only (still rendered, so
  // signed-in viewers can browse the taxonomy). The writer hook
  // does the role check internally and exposes `mode` so the UI
  // can label affordances ("Save" vs "Propose Save") and hide
  // multi-op flows (merge/move/group-delete cascades) outside of
  // direct mode.
  const isAdmin = userProfile?.role === 'admin';
  const isContentCreator = !!userProfile?.permissions &&
    Object.prototype.hasOwnProperty.call(userProfile.permissions, 'content-creator');
  const canManageTags = isAdmin || isContentCreator;
  // Inside <ProposalEditorWrapper> (the `/proposals/edit/tags` route)
  // these queue locally and flush on Submit Changes; outside the
  // wrapper (admin `/compendium/tags`) they pass through to
  // useEntityWriter unchanged.
  const tagWriter = useProposalAccumulator('tag', userProfile);
  const groupWriter = useProposalAccumulator('tag_group', userProfile);
  const { id: selectedGroupId } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  // Both `/compendium/tags(:/id)?` (admin direct) and
  // `/proposals/edit/tags(:/id)?` (proposal-wrapped) mount this
  // component. URLs we navigate to must use the same prefix as the
  // current location so a group click inside the proposal route
  // doesn't redirect users back into the AdminOnly-guarded admin
  // route.
  const basePath = location.pathname.startsWith('/proposals/edit/tags')
    ? '/proposals/edit/tags'
    : '/compendium/tags';

  const [tagGroups, setTagGroups] = useState<any[]>([]);
  const [allTags, setAllTags] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tagUsage, setTagUsage] = useState<Map<string, TagUsageBreakdown> | null>(null);

  // Per-group + per-tag UI state. Reset on group switch via the inner
  // component's `key={selectedGroupId}` (further down).
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);

  // Group rail state
  const [groupSearch, setGroupSearch] = useState('');

  // Master-detail view state for narrow viewports. Three tiers:
  //   • xl+         — all three panes render side-by-side; this is ignored.
  //   • lg → xl     — rail is always visible; the body slot (right of
  //                   the rail) toggles between tree and detail based
  //                   on activeView. Detail collapses first as the
  //                   viewport narrows because the tree is where users
  //                   spend the most time and benefits most from room.
  //   • < lg        — exactly one pane is visible at a time; back-nav
  //                   rows on tree + detail walk back up the chain.
  // Mirrors the AdminProficiencies two-pane pattern, generalised to
  // three panes with a staggered collapse.
  //
  // Initial value derives from URL: a deep link like
  // `/compendium/tags/:id` should mount straight into the tree at lg
  // and lg-xl widths (rail+tree), not the rail-only state. We don't
  // peek at selectedTagId because it's local state — anything that
  // wants `detail` on first load needs to setActiveView itself.
  type ActiveView = 'rail' | 'tree' | 'detail';
  const [activeView, setActiveView] = useState<ActiveView>(() =>
    selectedGroupId ? 'tree' : 'rail',
  );

  // Group form (used by both Create dialog and right-pane edit)
  const [createGroupOpen, setCreateGroupOpen] = useState(false);

  // ── Data loading ─────────────────────────────────────────────────────
  const reloadGroups = useCallback(async () => {
    if (!canManageTags) return;
    const groupsData = await fetchCollection<any>('tagGroups', { orderBy: 'name ASC' });
    setTagGroups(groupsData);
  }, [canManageTags]);

  const reloadTags = useCallback(async () => {
    if (!canManageTags) return;
    const tagsData = await fetchCollection<any>('tags', { orderBy: 'name ASC' });
    setAllTags(tagsData.map(normalizeTagRow));
  }, [canManageTags]);

  const reloadUsage = useCallback(async (opts: { force?: boolean } = {}) => {
    if (!canManageTags) return;
    if (opts.force) invalidateTagUsageCache();
    const map = await fetchTagUsageMap(opts.force ? { forceRefresh: true } : undefined);
    setTagUsage(map);
  }, [canManageTags]);

  useEffect(() => {
    if (!canManageTags) return;
    let active = true;
    setLoading(true);
    Promise.all([
      fetchCollection<any>('tagGroups', { orderBy: 'name ASC' }),
      fetchCollection<any>('tags', { orderBy: 'name ASC' }),
    ])
      .then(([groupsData, tagsData]) => {
        if (!active) return;
        setTagGroups(groupsData);
        setAllTags(tagsData.map(normalizeTagRow));
      })
      .catch((err) => console.error('[TagsExplorer] initial load failed:', err))
      .finally(() => { if (active) setLoading(false); });
    fetchTagUsageMap()
      .then((map) => { if (active) setTagUsage(map); })
      .catch((err) => console.warn('[TagsExplorer] tag usage scan failed:', err));
    return () => { active = false; };
  }, [canManageTags]);

  // Reset tag selection when group changes — different group, different
  // tag set, so a stale selection doesn't apply.
  useEffect(() => {
    setSelectedTagId(null);
  }, [selectedGroupId]);

  // Review-mode wiring. When the URL has `?review=<id>` for a tag or
  // tag_group proposal, inject the proposed payload into local state
  // and auto-select it. Tags need the containing group selected first
  // so the middle pane shows the tag tree the right pane is editing.
  const reviewMode = useProposalReview();
  const reviewTagPayload = resolveReviewPayload(reviewMode, 'tag', null);
  const reviewGroupPayload = resolveReviewPayload(reviewMode, 'tag_group', null);

  useEffect(() => {
    if (!reviewMode) return;
    if (reviewMode.entityType === 'tag_group' && reviewGroupPayload) {
      const targetId = reviewMode.entityId ?? reviewGroupPayload.id;
      if (!targetId) return;
      setTagGroups((prev) => {
        const exists = prev.some((g) => g.id === targetId);
        if (exists) {
          return prev.map((g) => (g.id === targetId ? { ...g, ...reviewGroupPayload } : g));
        }
        return [...prev, { ...reviewGroupPayload, id: targetId }];
      });
      if (selectedGroupId !== targetId) {
        navigate(`${basePath}/${targetId}`, { replace: true });
      }
    } else if (reviewMode.entityType === 'tag' && reviewTagPayload) {
      const targetId = reviewMode.entityId ?? reviewTagPayload.id;
      if (!targetId) return;
      const normalized = normalizeTagRow(reviewTagPayload);
      setAllTags((prev) => {
        const exists = prev.some((t) => t.id === targetId);
        if (exists) {
          return prev.map((t) => (t.id === targetId ? { ...t, ...normalized } : t));
        }
        return [...prev, { ...normalized, id: targetId }];
      });
      // Drive group selection from the tag's groupId so the middle
      // pane can render the tree containing it.
      const targetGroupId = normalized.groupId;
      if (targetGroupId && selectedGroupId !== targetGroupId) {
        navigate(`${basePath}/${targetGroupId}`, { replace: true });
      }
      if (selectedTagId !== targetId) {
        setSelectedTagId(targetId);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewMode?.entityId, reviewMode?.entityType, reviewTagPayload, reviewGroupPayload]);

  // Proposal-mode awareness — surfaced earlier so derived data can
  // overlay queued + drafted entities onto the live DB lists.
  const proposalContextEarly = useProposalContextOptional();

  // ── Derived data ─────────────────────────────────────────────────────
  // Merge queued + active-block draft revisions into the displayed
  // tag-group list. Without this, a newly-created group sits invisible
  // in the queue until Submit + approval. The user expects to see
  // their own work-in-progress while building a block.
  const draftedGroups = useProposalEntityDrafts('tag_group');
  const draftedTags = useProposalEntityDrafts('tag');
  // Convenience id sets for the row-highlight decoration in the rail
  // + right pane. byId already includes both queue and active-block
  // drafts (with the entity_id=null fallback), so the same set drives
  // "this group has staged work" for both freshly-queued creates and
  // already-submitted drafts. deletedIds intentionally NOT included
  // here — a tombstone shouldn't render as "modified" highlight.
  const draftedGroupIds = useMemo(() => {
    const ids = new Set<string>(draftedGroups.byId.keys());
    // Also count groups whose CHILDREN were modified — the proposer's
    // mental model is "I touched this group" whether they edited the
    // group itself OR added/edited/removed tags inside it. Without
    // this, adding a tag to "Tradition" leaves the Tradition rail
    // entry looking untouched even though the proposer just changed
    // its contents.
    //
    // We derive the parent group id from each draft/queued tag's
    // payload first (covers creates + edits that carry group_id) and
    // fall back to the live tag's groupId for partial UPDATE payloads
    // that don't restate the group.
    for (const [tagId, payload] of draftedTags.byId.entries()) {
      const parentFromPayload =
        (typeof payload?.group_id === 'string' ? payload.group_id : null) ??
        (typeof payload?.groupId === 'string' ? payload.groupId : null);
      const liveTag = allTags.find((t) => t.id === tagId);
      const parentId = parentFromPayload ?? liveTag?.groupId ?? null;
      if (parentId) ids.add(parentId);
    }
    for (const tagId of draftedTags.deletedIds) {
      const liveTag = allTags.find((t) => t.id === tagId);
      if (liveTag?.groupId) ids.add(liveTag.groupId);
    }
    return ids;
  }, [draftedGroups, draftedTags, allTags]);

  const displayedTagGroups = useMemo(() => {
    if (draftedGroups.byId.size === 0 && draftedGroups.deletedIds.size === 0) {
      return tagGroups;
    }
    // Keep deleted rows visible with a `__pendingDelete` flag — the
    // user can undo the delete inline (see TombstoneRow). Phase 1
    // tombstone UX, per the design doc.
    const merged = tagGroups.map((g) => {
      if (draftedGroups.deletedIds.has(g.id)) {
        return { ...g, __pendingDelete: true };
      }
      const overlay = draftedGroups.byId.get(g.id);
      // Pin `id` last so a partial UPDATE payload (which carries
      // only the changed columns, no `id`) can't accidentally
      // override the original group id with undefined.
      return overlay ? { ...g, ...overlay, id: g.id } : g;
    });
    // Append create-only entries (ids not in the live list).
    for (const [draftId, payload] of draftedGroups.byId.entries()) {
      if (merged.some((g) => g.id === draftId)) continue;
      merged.push({ ...payload, id: draftId });
    }
    // Tombstones for group deletions that target ids not in the live
    // list (CREATE drafts the user un-proposed in the same block).
    // See the deletedSources comment in displayedAllTags.
    for (const [deletedId, payload] of draftedGroups.deletedSources.entries()) {
      if (merged.some((g) => g.id === deletedId)) continue;
      merged.push({ ...payload, id: deletedId, __pendingDelete: true });
    }
    return merged;
  }, [tagGroups, draftedGroups]);

  const displayedAllTags = useMemo(() => {
    if (draftedTags.byId.size === 0 && draftedTags.deletedIds.size === 0) {
      return allTags;
    }
    const merged = allTags.map((t) => {
      if (draftedTags.deletedIds.has(t.id)) {
        return { ...t, __pendingDelete: true };
      }
      const overlay = draftedTags.byId.get(t.id);
      if (!overlay) return t;
      // The queued UPDATE payload only carries the changed columns
      // (e.g. {name, slug, updated_at}) — no `id`. normalizeTagRow
      // would coerce the missing id to "", which the dedup check
      // below would then miss, leaving the original tag in place
      // AND appending the "renamed" version as a phantom row. Carry
      // the live tag's id through the normalize step to keep it
      // stable.
      return {
        ...t,
        ...normalizeTagRow({ ...overlay, id: t.id }),
      };
    });
    for (const [draftId, payload] of draftedTags.byId.entries()) {
      if (merged.some((t) => t.id === draftId)) continue;
      merged.push({ ...normalizeTagRow({ ...payload, id: draftId }), id: draftId });
    }
    // Tombstones for deletions of entities that aren't in `allTags`
    // (CREATE drafts the user is un-proposing in the same block). The
    // deletedSources map captures the payload from before the queue
    // DELETE wiped the entry from byId — render it as a tombstone row
    // so the user can see what they deleted and Undo.
    for (const [deletedId, payload] of draftedTags.deletedSources.entries()) {
      if (merged.some((t) => t.id === deletedId)) continue;
      merged.push({
        ...normalizeTagRow({ ...payload, id: deletedId }),
        id: deletedId,
        __pendingDelete: true,
      });
    }
    return merged;
  }, [allTags, draftedTags]);

  const selectedGroup = useMemo(
    () => displayedTagGroups.find((g) => g.id === selectedGroupId) ?? null,
    [displayedTagGroups, selectedGroupId],
  );
  const tagsInSelectedGroup = useMemo(
    () => displayedAllTags.filter((t) => t.groupId === selectedGroupId),
    [displayedAllTags, selectedGroupId],
  );
  const tagsByGroupId = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const tag of displayedAllTags) {
      if (!tag.groupId) continue;
      if (!map.has(tag.groupId)) map.set(tag.groupId, []);
      map.get(tag.groupId)!.push(tag);
    }
    return map;
  }, [displayedAllTags]);

  if (!canManageTags) {
    return <div className="text-center py-20 font-serif text-2xl text-ink/40">Access Denied</div>;
  }

  // Proposal mode mounts a wrapper that already labels the page
  // ("PROPOSAL EDITOR | Tags") + shows the active block + Submit
  // Changes button. Rendering our own h1 + description below it
  // duplicates the title and adds ~80px of vertical chrome between
  // the wrapper header and the three-pane explorer. Suppress the
  // local page-header when proposal-wrapped.
  const isProposalRouteForLayout = location.pathname.startsWith('/proposals/edit/');

  // Mount the shared `admin-page-fullscreen` body class so the page
  // fills the viewport (minus navbar) and only the three panes
  // scroll internally — matches /admin/proficiencies. We mount on
  // BOTH routes now: the proposal route opts ProposalEditorWrapper
  // into its `fullscreen` shell (see App.tsx), and that shell
  // depends on main being viewport-tall (which admin-page-fullscreen
  // provides by stripping main's padding + locking body overflow).
  // We tag both <html> and <body> so the page-scroll scrollbar
  // styling lands consistently across browsers (Firefox uses html;
  // Chromium/Safari accept either).
  useEffect(() => {
    document.documentElement.classList.add('admin-page-fullscreen');
    document.body.classList.add('admin-page-fullscreen');
    return () => {
      document.documentElement.classList.remove('admin-page-fullscreen');
      document.body.classList.remove('admin-page-fullscreen');
    };
  }, []);

  return (
    <div
      // Fullscreen-flex layout. The two routes get their viewport-
      // bounded height in different ways:
      //  • Direct route — explicit `h-[calc(100vh-4rem)]` (navbar 4rem).
      //  • Proposal route — `flex-1 min-h-0` inside ProposalEditorWrapper's
      //    `flex flex-col h-full` shell (passed via `fullscreen`). flex-1
      //    is more reliable here than `h-full`, which doesn't always
      //    resolve to a definite size when its parent is itself a
      //    flex-1 child.
      className={
        isProposalRouteForLayout
          ? 'flex-1 min-h-0 flex flex-col gap-2 lg:gap-4 max-w-[1600px] mx-auto w-full px-3 sm:px-4 py-2 lg:py-4'
          : 'h-[calc(100vh-4rem)] flex flex-col gap-2 lg:gap-4 max-w-[1600px] mx-auto w-full px-3 sm:px-4 py-2 lg:py-4'
      }
    >
      {/* Page header — admin-direct route only. Visible at lg+ always;
          below lg only on the rail view (the tree and detail panes
          carry their own back-nav row and need every pixel for the
          explorer). Mirrors the AdminProficiencies header pattern.
          `lg:flex` (NOT `lg:block`) because `.page-header` is defined
          as `@apply flex items-center justify-between …` — switching
          its display to `block` at lg+ would kill `items-center` /
          `justify-between` and ruin the title row. */}
      {!isProposalRouteForLayout && (
        <div
          className={cn(
            'page-header shrink-0 lg:flex',
            activeView === 'rail' ? '' : 'hidden',
          )}
        >
          <div>
            <h1 className="h1-title text-ink flex items-center gap-3">
              <TagsIcon className="w-7 h-7 text-gold" />
              Tag Management
            </h1>
            <p className="description-text mt-1 text-ink/60">Organize and curate the compendium taxonomy.</p>
          </div>
        </div>
      )}

      {/* Three-pane explorer — flex layout, mirrors AdminProficiencies'
          rail+body shell (just generalised from two panes to three).
          Flex row + default align-items: stretch makes every visible
          pane the same height for free, no grid template tricks
          needed. Staggered collapse:
            • xl+      — Rail (240) | Tree (flex-1) | Detail (320/360 fixed)
            • lg–xl    — Rail (240) | Body (flex-1, toggles tree↔detail)
            • < lg     — only the activeView pane renders.
          Each pane sets its own scroll; the outer container pins to
          the viewport via `lg:min-h-0 flex-1` in the non-proposal
          case (proposal-wrapped use stays bounded by the proposal
          shell). */}
      <div
        // Same flex shell on both routes now. The parent provides the
        // bounded height (either via `h-[calc(100vh-4rem)]` on the
        // direct route or via the proposal wrapper's flex-1 slot
        // under `h-full`), so the explorer just absorbs whatever
        // remains with `flex-1 min-h-0`.
        className="flex flex-col lg:flex-row gap-4 min-h-0 flex-1"
      >
        {/* Rail — always visible at lg+ (`lg:flex` overrides the
            `hidden` swap); below lg only when activeView==='rail'.
            • At < lg the outer container is flex-col and the rail is
              the only visible child, so it needs `flex-1` to grow
              and fill the page height (otherwise it sizes to content,
              same shrink-0 trap as before).
            • At lg+ the outer flips to flex-row, so `lg:flex-none`
              switches off the grow and `lg:w-[240px]` pins the
              column width while align-items: stretch handles height. */}
        <div
          className={cn(
            'flex-col flex-1 min-h-0 lg:flex-none lg:w-[240px]',
            activeView === 'rail' ? 'flex' : 'hidden',
            'lg:flex',
          )}
        >
          <GroupRail
            groups={displayedTagGroups}
            tagsByGroupId={tagsByGroupId}
            selectedGroupId={selectedGroupId ?? null}
            loading={loading}
            searchQuery={groupSearch}
            onSearchChange={setGroupSearch}
            onSelectGroup={(id) => {
              navigate(`${basePath}/${id}`);
              // Drill the user into the tree:
              //   < lg     — swaps the single visible pane from rail → tree
              //   lg–xl    — populates the body slot with the tree
              //   xl+      — no-op visually (all panes already on-screen)
              setActiveView('tree');
            }}
            onOpenCreateGroup={() => setCreateGroupOpen(true)}
            draftedGroupIds={draftedGroupIds}
            onUndoDelete={async (id) => {
              if (!proposalContextEarly) return;
              await proposalContextEarly.dropEntity(id);
              await reloadGroups();
            }}
          />
        </div>

        {/* Tree (middle) — visible at xl+ always; at lg–xl shares the
            body slot with detail and shows only when
            activeView==='tree'; below lg only when activeView==='tree'.
            `flex-1` makes it absorb remaining horizontal space in the
            flex row whenever it's visible. */}
        <div
          className={cn(
            'flex-col flex-1 lg:min-h-0',
            activeView === 'tree' ? 'flex' : 'hidden',
            'xl:flex',
          )}
        >
          {/* Back-nav (narrow only) — return to the rail. Sticky just
              below the fixed navbar so it survives scroll. */}
          <div className="lg:hidden sticky top-[var(--navbar-height)] z-20 -mx-3 sm:-mx-4 px-3 sm:px-4 py-2 bg-background/95 backdrop-blur-sm border-b border-gold/15 shadow-sm flex items-center gap-2 h-12 mb-2">
            <Button
              onClick={() => setActiveView('rail')}
              variant="ghost"
              size="sm"
              className="text-gold gap-2 hover:bg-gold/5 px-2"
            >
              <CornerLeftUp className="w-4 h-4 rotate-90" /> Groups
            </Button>
            {selectedGroup && (
              <>
                <span className="text-ink/30">/</span>
                <span className="text-xs uppercase tracking-widest font-bold text-ink truncate">
                  {selectedGroup.name}
                </span>
              </>
            )}
          </div>
          {selectedGroupId && selectedGroup ? (
            <TagTreePane
              key={selectedGroupId}
              group={selectedGroup}
              tags={tagsInSelectedGroup}
              tagUsage={tagUsage}
              selectedTagId={selectedTagId}
              onSelectTag={(id) => {
                setSelectedTagId(id);
                if (id) setActiveView('detail');
              }}
              onReloadTags={reloadTags}
              onReloadUsage={reloadUsage}
              isAdmin={isAdmin}
              tagWriter={tagWriter}
            />
          ) : (
            // `flex-1` so the empty-state card fills the tree column's
            // full height (matches the surrounding rail / detail
            // cards). Without it the placeholder is "shorter than its
            // neighbours" when no group is selected.
            <Card className="border-gold/10 bg-card/40 flex flex-col flex-1 items-center justify-center text-center p-10">
              <TagsIcon className="w-10 h-10 text-gold/30 mb-3" />
              <p className="description-text text-ink/60">Select a tag group from the rail</p>
              <p className="text-[11px] text-ink/40 mt-1">or use <span className="text-gold/80">+ New Group</span> to create one.</p>
            </Card>
          )}
        </div>

        {/* Detail (right) — visible at xl+ always; at lg–xl shares the
            body slot with tree (takes the full body width via flex-1
            since tree is hidden); below lg only when
            activeView==='detail'. At xl+, swaps to a fixed column
            (`xl:flex-none xl:shrink-0 xl:w-[…px]`) so it doesn't
            steal width from the tree. Proposal-wrapped flow uses a
            slightly narrower 320px to match the original layout. */}
        <div
          className={cn(
            'flex-col flex-1 lg:min-h-0',
            'xl:flex-none xl:shrink-0',
            isProposalRouteForLayout ? 'xl:w-[320px]' : 'xl:w-[360px]',
            activeView === 'detail' ? 'flex' : 'hidden',
            'xl:flex',
          )}
        >
          {/* Back-nav (narrow + medium) — return to the tree. Visible
              up through lg–xl because at that breakpoint the tree is
              hidden behind the detail; only at xl+ (where tree is
              always on-screen) do we drop this row. */}
          <div className="xl:hidden sticky top-[var(--navbar-height)] z-20 -mx-3 sm:-mx-4 px-3 sm:px-4 py-2 bg-background/95 backdrop-blur-sm border-b border-gold/15 shadow-sm flex items-center gap-2 h-12 mb-2">
            <Button
              onClick={() => setActiveView('tree')}
              variant="ghost"
              size="sm"
              className="text-gold gap-2 hover:bg-gold/5 px-2"
            >
              <CornerLeftUp className="w-4 h-4 rotate-90" />
              {selectedGroup?.name ?? 'Back'}
            </Button>
            {selectedTagId && (
              <>
                <span className="text-ink/30">/</span>
                <span className="text-xs uppercase tracking-widest font-bold text-ink truncate">
                  {tagsInSelectedGroup.find((t) => t.id === selectedTagId)?.name ?? 'Tag'}
                </span>
              </>
            )}
          </div>
          <RightPane
          group={selectedGroup}
          selectedTag={selectedTagId ? tagsInSelectedGroup.find(t => t.id === selectedTagId) ?? null : null}
          allTagsInGroup={tagsInSelectedGroup}
          tagUsage={tagUsage}
          onCloseTag={() => {
            setSelectedTagId(null);
            // Step back from detail → tree. At lg–xl this swaps the
            // body slot from detail to tree; at < lg it pops one
            // level up the drill-down. At xl+ both panes are always
            // visible, so the activeView change is a no-op visually.
            setActiveView('tree');
          }}
          onReloadGroups={reloadGroups}
          onReloadTags={reloadTags}
          onReloadUsage={reloadUsage}
          onSelectedGroupDeleted={() => navigate(basePath)}
          isAdmin={isAdmin}
          tagWriter={tagWriter}
          groupWriter={groupWriter}
          isGroupDrafted={!!selectedGroup && draftedGroupIds.has(selectedGroup.id)}
          draftedTagIds={
            // Pass through so TagDetailPanel can render its own
            // "modified in this block" treatment when the selected
            // tag has queued/drafted work against it.
            new Set(draftedTags.byId.keys())
          }
          // Tombstone flags so the panel switches into "pending
          // delete" mode (banner + disabled form). Computed from the
          // already-merged display list so the boolean stays in sync
          // with what the user sees in the rail / tree.
          isGroupPendingDelete={!!selectedGroup && draftedGroups.deletedIds.has(selectedGroup.id)}
          deletedTagIds={draftedTags.deletedIds}
          onUndoDelete={async (id) => {
            if (!proposalContextEarly) return;
            await proposalContextEarly.dropEntity(id);
            await Promise.all([reloadGroups(), reloadTags()]);
          }}
        />
        </div>
      </div>

      <CreateGroupDialog
        open={createGroupOpen}
        onClose={() => setCreateGroupOpen(false)}
        groupWriter={groupWriter}
        onCreated={async (newId) => {
          await reloadGroups();
          if (groupWriter.mode === 'direct') {
            // In proposal mode the group doesn't exist yet, so don't
            // navigate to it — let the proposer see their submission
            // on /my-proposals instead.
            navigate(`${basePath}/${newId}`);
          }
          setCreateGroupOpen(false);
        }}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Group rail (left column)
// ═══════════════════════════════════════════════════════════════════════

function GroupRail({
  groups, tagsByGroupId, selectedGroupId, loading,
  searchQuery, onSearchChange, onSelectGroup, onOpenCreateGroup,
  draftedGroupIds, onUndoDelete,
}: {
  groups: any[];
  tagsByGroupId: Map<string, any[]>;
  selectedGroupId: string | null;
  loading: boolean;
  searchQuery: string;
  onSearchChange: (s: string) => void;
  onSelectGroup: (id: string) => void;
  onOpenCreateGroup: () => void;
  /**
   * Ids of groups with staged work in the active block (queue +
   * drafts). Rows in this set render with the archive-blue treatment
   * so the proposer can see at a glance which groups they've touched
   * since the block opened.
   */
  draftedGroupIds: Set<string>;
  /**
   * Called when the user clicks Undo on a tombstone row. Drops the
   * queue + draft entries for the group id so it reverts to its live
   * state.
   */
  onUndoDelete: (id: string) => Promise<void> | void;
}) {
  const filteredGroups = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter((g) => {
      const name = String(g.name ?? '').toLowerCase();
      const cats = (g.classifications ?? (g.category ? [g.category] : []))
        .map((c: string) => String(c).toLowerCase());
      return name.includes(q) || cats.some((c: string) => c.includes(q));
    });
  }, [groups, searchQuery]);

  return (
    // `flex-1` so the rail stretches to the grid row's full height —
    // matches the tree + detail columns and prevents the visual
    // "shorter than its neighbours" look when the group list is small.
    <Card className="border-gold/20 bg-card/50 flex flex-col flex-1 min-h-0 overflow-hidden">
      <div className="p-3 border-b border-gold/10 bg-gold/5 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="label-text text-gold">Groups</h3>
          <Button size="sm" onClick={onOpenCreateGroup} className="h-6 px-2 btn-gold-solid text-[10px] gap-1">
            <Plus className="w-3 h-3" /> New
          </Button>
        </div>
        {/* Canonical site search affordance — same component used by
            AdminProficiencies' rail and FilterBar across the app. */}
        <SearchInput
          value={searchQuery}
          onChange={onSearchChange}
          placeholder="Filter…"
          size="sm"
        />
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {loading ? (
          <p className="text-[11px] italic text-ink/40 text-center py-6">Loading…</p>
        ) : filteredGroups.length === 0 ? (
          <p className="text-[11px] italic text-ink/40 text-center py-6">No groups match.</p>
        ) : (
          <ul className="divide-y divide-gold/5">
            {filteredGroups.map((group) => {
              const isActive = group.id === selectedGroupId;
              const drafted = draftedGroupIds.has(group.id);
              const pendingDelete = group.__pendingDelete === true;
              const groupTags = tagsByGroupId.get(group.id) ?? [];
              const subtagCount = groupTags.filter((t) => t.parentTagId).length;
              const rootCount = groupTags.length - subtagCount;
              // Tombstone variant: deleted-in-block rows render with
              // red strikethrough + undo button. Clicking the body
              // still navigates so the user can inspect what they're
              // about to lose; the Undo button stops propagation.
              if (pendingDelete) {
                return (
                  <li key={group.id} onClick={() => onSelectGroup(group.id)} className="cursor-pointer">
                    <TombstoneRow
                      name={group.name}
                      size="sm"
                      onUndo={() => onUndoDelete(group.id)}
                    >
                      {rootCount} tag{rootCount === 1 ? '' : 's'}
                      {subtagCount > 0 && ` + ${subtagCount} sub`}
                    </TombstoneRow>
                  </li>
                );
              }
              return (
                <li key={group.id}>
                  <button
                    type="button"
                    onClick={() => onSelectGroup(group.id)}
                    title={drafted ? `${group.name} — staged in this block` : undefined}
                    className={cn(
                      // Border-left mirrors the tag tree's staged
                      // indicator so a glance at the rail shows
                      // which groups carry pending work.
                      'browser-row w-full grid grid-cols-[1fr_auto] items-center gap-2 px-3 py-2 text-left border-l-4',
                      isActive
                        ? 'bg-gold/15 border-r-4 border-r-gold border-l-transparent text-gold font-bold'
                        : drafted
                          ? 'bg-archive-blue/5 border-l-archive-blue/60 text-archive-blue hover:bg-archive-blue/10'
                          : 'border-l-transparent text-ink/70 hover:bg-gold/5',
                    )}
                  >
                    <span className="text-sm truncate">{group.name}</span>
                    <span className="text-[10px] font-bold tabular-nums text-ink/50 flex items-center gap-1 shrink-0">
                      {rootCount}
                      {subtagCount > 0 && (
                        <span className="inline-flex items-center text-amber-500/80">
                          <CornerDownRight className="w-2.5 h-2.5" />
                          {subtagCount}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Tag tree pane (middle column)
// ═══════════════════════════════════════════════════════════════════════

function TagTreePane({
  group, tags, tagUsage, selectedTagId, onSelectTag, onReloadTags, onReloadUsage, isAdmin, tagWriter,
}: {
  group: any;
  tags: any[];
  tagUsage: Map<string, TagUsageBreakdown> | null;
  selectedTagId: string | null;
  onSelectTag: (id: string | null) => void;
  onReloadTags: () => Promise<void>;
  onReloadUsage: (opts?: { force?: boolean }) => Promise<void>;
  isAdmin: boolean;
  tagWriter: WriterApi;
}) {
  // Mutation routing. In `direct` mode the writer's create/update/
  // remove call upsertDocument / deleteDocument exactly like before;
  // in `proposal` mode they POST to /api/proposals and the change
  // sits in the queue until an admin approves. `block` mode behaves
  // like proposal except the writer also tags `is_draft: true` and
  // pins the active bundle_id. From this editor's perspective both
  // proposal AND block are "don't direct-write — let the writer
  // dispatch", so we treat them the same here. `actionLabel` picks
  // mode-appropriate toast copy ("Added" / "Add submitted for
  // review" / "Add added to block").
  const isProposalMode = tagWriter.mode === 'proposal' || tagWriter.mode === 'block';

  // Tag ids the user has staged in the active block — queue entries
  // (unsubmitted) + same-bundle draft revisions (already submitted).
  // Drives the row-highlight in the tree below. Empty unless the
  // editor is mounted inside a <ProposalEditorWrapper>.
  const proposalContext = useProposalContextOptional();
  const { drafts: allDrafts, activeBundleId } = useBlock();
  const draftedTagIds = useMemo(() => {
    const ids = new Set<string>();
    if (proposalContext) {
      for (const q of proposalContext.queue) {
        if (q.entity_type !== 'tag') continue;
        // CREATE entries in the queue carry the minted UUID in
        // entity_id (the writer stores it there for downstream
        // dedup); UPDATE entries also have it. Either way we want
        // the row to render highlighted.
        if (q.entity_id) ids.add(q.entity_id);
      }
    }
    if (activeBundleId) {
      for (const d of allDrafts) {
        if (d.entity_type !== 'tag') continue;
        if (d.bundle_id !== activeBundleId) continue;
        // Server-side CREATE drafts have entity_id=null because the
        // proposal API forcibly nulls it (no live row to point at
        // yet). The actual id is inside proposed_payload.id — fall
        // back to that so freshly-submitted creates stay highlighted.
        const effectiveId =
          d.entity_id ??
          (d.proposed_payload && typeof d.proposed_payload.id === 'string'
            ? d.proposed_payload.id
            : null);
        if (effectiveId) ids.add(effectiveId);
      }
    }
    return ids;
  }, [proposalContext, allDrafts, activeBundleId]);

  // Per-group editing state — resets on group switch via key prop.
  //
  // The previous middle-pane inline rename (`editingTagId` /
  // `editingTagName`) and the per-row delete button moved to the
  // right pane's TagDetailPanel in the P1 redesign. The middle pane
  // now only has two pieces of write state: the "new tag" name in
  // the toolbar, and the inline subtag form when an admin clicks
  // "+ Subtag" on a root row.
  const [newTagName, setNewTagName] = useState('');
  const [addingSubtagOfId, setAddingSubtagOfId] = useState<string | null>(null);
  const [newSubtagName, setNewSubtagName] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [collapsedRoots, setCollapsedRoots] = useState<Set<string>>(new Set());

  // ── helpers (same shape as the prior TagGroupEditor) ────────────────
  const addTag = async (name: string, parentTagId: string | null) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const newId = crypto.randomUUID();
    const slug = trimmed.toLowerCase().replace(/\s+/g, '-');
    const d1Data: Record<string, any> = {
      group_id: group.id,
      name: trimmed,
      slug,
      updated_at: new Date().toISOString(),
    };
    if (parentTagId) d1Data.parent_tag_id = parentTagId;
    await tagWriter.create({ id: newId, ...d1Data });
    await onReloadTags();
  };

  const handleAddTag = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newTagName.trim();
    if (!trimmed) return;
    try {
      await addTag(trimmed, null);
      setNewTagName('');
      toast.success(actionLabel(tagWriter.mode, 'added'));
    } catch (err) {
      console.error(err);
      toast.error(isUniqueConstraintError(err) ? `A tag named "${trimmed}" already exists here.` : 'Failed to add tag');
    }
  };

  const handleAddSubtag = async (e: React.FormEvent, parentTagId: string) => {
    e.preventDefault();
    const trimmed = newSubtagName.trim();
    if (!trimmed) return;
    try {
      await addTag(trimmed, parentTagId);
      setNewSubtagName('');
      setAddingSubtagOfId(null);
      toast.success(actionLabel(tagWriter.mode, 'added'));
    } catch (err) {
      console.error(err);
      toast.error(isUniqueConstraintError(err) ? `A tag named "${trimmed}" already exists here.` : 'Failed to add subtag');
    }
  };

  // NOTE: handleUpdateTag (rename) and handleDeleteTag (delete with
  // child cascade) moved to TagDetailPanel in the P1 redesign so
  // those actions live in the right pane alongside Move / Merge.
  // The middle pane only writes via handleAddTag and handleAddSubtag.

  const toggleRootCollapsed = (rootId: string) => {
    setCollapsedRoots((prev) => {
      const next = new Set(prev);
      next.has(rootId) ? next.delete(rootId) : next.add(rootId);
      return next;
    });
  };

  // ── Tree build + render ─────────────────────────────────────────────
  const filterTerm = tagFilter.trim().toLowerCase();
  const isFiltering = !!filterTerm;
  const rootsWithKids = useMemo(
    () => tags.filter((t) => !t.parentTagId && tags.some((c) => c.parentTagId === t.id)),
    [tags],
  );

  const visibleIds = useMemo<Set<string> | null>(() => {
    if (!filterTerm) return null;
    const matches = new Set<string>();
    for (const t of tags) {
      if (String(t.name).toLowerCase().includes(filterTerm)) {
        matches.add(t.id);
        if (t.parentTagId) matches.add(t.parentTagId);
      }
    }
    for (const t of tags) {
      if (t.parentTagId && matches.has(t.parentTagId)) matches.add(t.id);
    }
    return matches;
  }, [tags, filterTerm]);

  const roots = useMemo(
    () => tags.filter((t) => !t.parentTagId).sort((a, b) => String(a.name).localeCompare(String(b.name))),
    [tags],
  );
  const childrenByParent = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const t of tags) {
      if (!t.parentTagId) continue;
      if (!map.has(t.parentTagId)) map.set(t.parentTagId, []);
      map.get(t.parentTagId)!.push(t);
    }
    for (const arr of map.values()) arr.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    return map;
  }, [tags]);

  const renderRow = (tag: any, depth: 0 | 1, zebraIdx: number, subtagCount = 0) => {
    const isRoot = depth === 0;
    const isCollapsed = isRoot && !isFiltering && collapsedRoots.has(tag.id);
    const hasSubtags = isRoot && subtagCount > 0;
    const isSelected = tag.id === selectedTagId;
    // Tag has staged work in the active block — queue entry or
    // server-side draft revision. Same archive-blue visual language as
    // SpellsEditor / FeatsEditor row highlight.
    const drafted = draftedTagIds.has(tag.id);
    const pendingDelete = tag.__pendingDelete === true;
    const breakdown = tagUsage?.get(tag.id);
    const total = breakdown?.total ?? 0;

    // Tombstone variant: red strikethrough + undo. Subtags render
    // indented so the user sees the hierarchy preserved.
    if (pendingDelete) {
      return (
        <div key={tag.id} style={depth === 1 ? { paddingLeft: '24px' } : undefined}>
          <TombstoneRow
            name={tag.name}
            size="sm"
            onUndo={async () => {
              if (!proposalContext) return;
              await proposalContext.dropEntity(tag.id);
              await onReloadTags();
            }}
          >
            {total > 0 && <>{total}</>}
            {subtagCount > 0 && <> · {subtagCount} subtag{subtagCount === 1 ? '' : 's'}</>}
          </TombstoneRow>
        </div>
      );
    }

    // The whole row is the click target now (was previously: only
    // the name button + the usage pill triggered selection — the
    // dead zones between them did nothing). role/tabIndex/keyboard
    // wiring keeps it accessible. Inner controls (chevron toggle
    // + Subtag button) stop propagation so they don't also select
    // the tag.
    //
    // Grid layout fixes the column-misalignment problem visible at
    // narrow widths: name = 1fr (shrinks to truncate cleanly),
    // usage = fixed 3.5rem (so pills line up), hover slot = fixed
    // 2rem on lg+ (reserved space prevents layout shift on hover;
    // hidden below lg so the name keeps its room on small screens).
    return (
      <div
        key={tag.id}
        role="button"
        tabIndex={0}
        onClick={() => onSelectTag(tag.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelectTag(tag.id);
          }
        }}
        title={drafted ? `${tag.name} — staged in this block` : tag.description ?? undefined}
        className={cn(
          'group grid items-center gap-2 p-1 cursor-pointer transition-colors border-l-4',
          'grid-cols-[minmax(0,1fr)_3.5rem] lg:grid-cols-[minmax(0,1fr)_3.5rem_2rem]',
          isSelected
            ? 'bg-gold/10 border-gold'
            : drafted
              ? 'bg-archive-blue/5 border-archive-blue/60 hover:bg-archive-blue/10'
              : 'border-transparent hover:bg-gold/5 hover:border-gold',
          !drafted && (zebraIdx % 2 === 0 ? 'bg-background/30' : 'bg-transparent'),
        )}
        style={depth === 1 ? { paddingLeft: '24px' } : undefined}
      >
        {/* Name column — chevron / corner-arrow + truncated name +
            optional subtag-count badge. `min-w-0` is critical to
            let truncate work inside a grid 1fr track. */}
        <div
          className={cn(
            'font-bold pl-1 flex items-center gap-1.5 min-w-0',
            drafted && !isSelected ? 'text-archive-blue' : 'text-ink',
          )}
        >
          {isRoot ? (
            hasSubtags ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleRootCollapsed(tag.id);
                }}
                className="w-3.5 h-3.5 flex items-center justify-center text-ink/50 hover:text-gold shrink-0"
                title={isCollapsed ? 'Expand subtags' : 'Collapse subtags'}
              >
                {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
            ) : (
              <span className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            )
          ) : (
            <CornerDownRight className="w-3.5 h-3.5 text-ink/30 shrink-0" />
          )}
          <span className="truncate min-w-0">{tag.name}</span>
          {hasSubtags && (
            <span
              className={cn(
                'text-[9px] font-bold uppercase tracking-widest px-1 py-0.5 border shrink-0',
                isCollapsed
                  ? 'bg-amber-500/10 border-amber-500/30 text-amber-500'
                  : 'bg-gold/10 border-gold/20 text-gold/80',
              )}
              title={`${subtagCount} subtag${subtagCount === 1 ? '' : 's'}`}
            >
              ↳ {subtagCount}
            </span>
          )}
        </div>

        {/* Usage column — fixed-width so pills align across rows.
            No onClick: the outer row already selects on click. The
            pill is visual + tooltip only. */}
        {tagUsage && (
          <span
            className={cn(
              'text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 border whitespace-nowrap text-center transition-colors',
              total > 0
                ? 'bg-gold/10 border-gold/20 text-gold/80 group-hover:bg-gold/20 group-hover:text-gold'
                : 'bg-background/30 border-ink/10 text-ink/30 italic',
            )}
            title={summarizeBreakdown(breakdown)}
          >
            {total > 0 ? total : 'Unused'}
          </span>
        )}

        {/* Hover slot — fixed-width column on lg+ so layout doesn't
            shift on hover. Hidden below lg so the name keeps the
            full row width on narrow viewports (the New Tag button
            in the toolbar covers the same affordance there). The
            +Subtag button stops propagation so it doesn't double-
            trigger the row's selection click. */}
        <div className="hidden lg:flex justify-end">
          {isRoot && (
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                setAddingSubtagOfId(tag.id);
                setNewSubtagName('');
              }}
              className="h-7 w-7 p-0 text-ink/40 hover:text-gold opacity-0 group-hover:opacity-100 transition-opacity"
              title="Add a subtag"
            >
              <Plus className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </div>
    );
  };

  const renderInlineSubtagForm = (parentTagId: string) => (
    <form
      key={`add-subtag-${parentTagId}`}
      onSubmit={(e) => handleAddSubtag(e, parentTagId)}
      className="flex items-center gap-2 p-1 bg-gold/5 border-l-4 border-gold/40"
      style={{ paddingLeft: '24px' }}
    >
      <CornerDownRight className="w-3.5 h-3.5 text-gold/60 shrink-0" />
      <Input
        value={newSubtagName}
        onChange={(e) => setNewSubtagName(e.target.value)}
        placeholder="New subtag name..."
        autoFocus
        className="h-7 text-sm font-bold flex-1 bg-background border-gold/30"
        onKeyDown={(e) => { if (e.key === 'Escape') { setAddingSubtagOfId(null); setNewSubtagName(''); } }}
      />
      <Button type="submit" size="sm" disabled={!newSubtagName.trim()} className="h-7 px-2 btn-gold-solid text-[10px] shrink-0">Add</Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => { setAddingSubtagOfId(null); setNewSubtagName(''); }} className="h-7 w-7 p-0 text-ink/40 shrink-0"><X className="w-4 h-4" /></Button>
    </form>
  );

  const isVisible = (t: any) => !visibleIds || visibleIds.has(t.id);

  let zebra = 0;
  const rows: React.ReactNode[] = [];
  for (const root of roots) {
    if (!isVisible(root)) continue;
    const children = childrenByParent.get(root.id) ?? [];
    rows.push(renderRow(root, 0, zebra++, children.length));
    const expanded = isFiltering || !collapsedRoots.has(root.id);
    if (expanded) {
      for (const child of children) {
        if (!isVisible(child)) continue;
        rows.push(renderRow(child, 1, zebra++));
      }
    }
    if (addingSubtagOfId === root.id) {
      rows.push(renderInlineSubtagForm(root.id));
    }
  }
  const filterEmptyState = rows.length === 0 && isFiltering;

  return (
    <Card className="border-gold/20 bg-card flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Toolbar — group header (top), then the New Tag form +
          filter on a second row. The previous bottom-of-pane Add
          form moved up here because the long scroll past the tree
          to reach it was the main "awkward" complaint in the
          redesign pass. */}
      <div className="p-4 border-b border-gold/10 bg-gold/5 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="h3-title text-gold truncate flex items-center gap-2">
              <TagsIcon className="w-5 h-5" />
              {group.name}
              <span className="text-xs bg-gold/20 text-gold px-2 py-0.5 shrink-0">{tags.length}</span>
            </h2>
            {(group.description || (group.classifications?.length ?? 0) > 0) && (
              <p className="text-[11px] text-ink/50 mt-0.5 truncate">
                {(group.classifications ?? (group.category ? [group.category] : [])).join(' · ')}
                {group.description ? <> — {group.description}</> : null}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Add tag form — primary affordance for the toolbar. */}
          <form onSubmit={handleAddTag} className="flex items-center gap-1.5 flex-1 min-w-0">
            <Input
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              placeholder="New tag name…"
              className="h-7 text-xs field-input flex-1 min-w-0"
            />
            <Button
              type="submit"
              size="sm"
              disabled={!newTagName.trim()}
              className="h-7 px-2 btn-gold-solid text-[10px] gap-1 shrink-0"
            >
              <Plus className="w-3 h-3" /> Add tag
            </Button>
          </form>
          {/* Filter input — secondary; lives next to the Add form
              so authoring + scanning sit in the same band. Shared
              SearchInput keeps the chrome consistent with the rail
              and every other filter in the app. */}
          <SearchInput
            value={tagFilter}
            onChange={setTagFilter}
            placeholder="Filter…"
            size="sm"
            wrapperClassName="w-44 shrink-0"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar space-y-1">
        <div className="grid grid-cols-[1fr_auto] gap-2 mb-2 p-2 border-b border-gold/20 pb-2 items-center">
          <span className="label-text text-ink/40 pl-2">Name</span>
          {rootsWithKids.length > 0 ? (
            (() => {
              const allCollapsed = rootsWithKids.every((r) => collapsedRoots.has(r.id));
              return (
                <button
                  type="button"
                  onClick={() => {
                    if (allCollapsed) setCollapsedRoots(new Set());
                    else setCollapsedRoots(new Set(rootsWithKids.map((r) => r.id)));
                  }}
                  className="text-[10px] uppercase tracking-widest font-bold text-ink/40 hover:text-gold flex items-center gap-1 pr-2"
                >
                  {allCollapsed ? <><ChevronDown className="w-3 h-3" /> Expand all</> : <><ChevronRight className="w-3 h-3" /> Collapse all</>}
                </button>
              );
            })()
          ) : (
            <span className="label-text text-ink/40 text-right pr-2">Usage</span>
          )}
        </div>
        {tags.length === 0 ? (
          <div className="empty-state">
            <TagsIcon className="w-8 h-8 text-gold/20 mb-3" />
            <p className="description-text">No tags in this group yet.</p>
            <p className="label-text text-gold/40 mt-1">Use the form above to add the first one</p>
          </div>
        ) : filterEmptyState ? (
          <div className="text-center py-8 text-ink/40 italic text-sm">No tags match "{tagFilter}".</div>
        ) : (
          rows
        )}
      </div>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Right pane — tag detail OR group settings OR empty
// ═══════════════════════════════════════════════════════════════════════

function RightPane({
  group, selectedTag, allTagsInGroup, tagUsage,
  onCloseTag, onReloadGroups, onReloadTags, onReloadUsage, onSelectedGroupDeleted,
  isAdmin, tagWriter, groupWriter, isGroupDrafted, draftedTagIds,
  isGroupPendingDelete, deletedTagIds, onUndoDelete,
}: {
  group: any | null;
  selectedTag: any | null;
  allTagsInGroup: any[];
  tagUsage: Map<string, TagUsageBreakdown> | null;
  onCloseTag: () => void;
  onReloadGroups: () => Promise<void>;
  onReloadTags: () => Promise<void>;
  onReloadUsage: (opts?: { force?: boolean }) => Promise<void>;
  onSelectedGroupDeleted: () => void;
  isAdmin: boolean;
  tagWriter: WriterApi;
  groupWriter: WriterApi;
  /** True when the current group has staged work (queue or draft). */
  isGroupDrafted: boolean;
  /** Ids of tags with staged work — used to highlight TagDetailPanel. */
  draftedTagIds: Set<string>;
  /** Current group has a queued/drafted DELETE — show tombstone banner. */
  isGroupPendingDelete: boolean;
  /** Tags with queued/drafted DELETEs — TagDetailPanel uses this. */
  deletedTagIds: Set<string>;
  /** Undo handler — drops queue + draft entries for the entity id. */
  onUndoDelete: (id: string) => Promise<void> | void;
}) {
  if (!group) {
    return (
      // `flex-1` (with the `hidden lg:flex` swap for display) lets the
      // empty card stretch to the right pane's full height so the
      // explorer column doesn't look truncated when nothing is
      // selected — same fill behaviour as TagDetailPanel + GroupSettingsPanel.
      <Card className="border-gold/10 bg-card/30 hidden lg:flex flex-1 items-center justify-center text-center p-6">
        <p className="text-[11px] text-ink/30 italic">Select a group to see options.</p>
      </Card>
    );
  }
  if (selectedTag) {
    return (
      <TagDetailPanel
        group={group}
        selectedTag={selectedTag}
        allTagsInGroup={allTagsInGroup}
        tagUsage={tagUsage}
        onClose={onCloseTag}
        onReloadTags={onReloadTags}
        onReloadUsage={onReloadUsage}
        isAdmin={isAdmin}
        tagWriter={tagWriter}
        isTagDrafted={draftedTagIds.has(selectedTag.id)}
        isTagPendingDelete={deletedTagIds.has(selectedTag.id)}
        onUndoDelete={onUndoDelete}
      />
    );
  }
  return (
    <GroupSettingsPanel
      group={group}
      onReloadGroups={onReloadGroups}
      onReloadTags={onReloadTags}
      onSelectedGroupDeleted={onSelectedGroupDeleted}
      tagsCount={allTagsInGroup.length}
      isAdmin={isAdmin}
      groupWriter={groupWriter}
      isGroupDrafted={isGroupDrafted}
      isGroupPendingDelete={isGroupPendingDelete}
      onUndoDelete={onUndoDelete}
    />
  );
}

// ─── Tag detail panel ────────────────────────────────────────────────

/**
 * Per-consumer kinds rendered in the References table. Order +
 * colour stays in lockstep with the proportional bar at the top of
 * the section so each row reads as a row-of-the-bar. Keys match
 * `TagUsageBreakdown` from tagUsage.ts.
 */
const REFERENCE_KINDS: ReadonlyArray<{
  key: keyof TagUsageBreakdown;
  label: string;
  color: string;
}> = [
  { key: 'spells', label: 'Spells', color: 'bg-violet-500/80' },
  { key: 'feats', label: 'Feats', color: 'bg-amber-500/80' },
  { key: 'features', label: 'Features', color: 'bg-sky-500/80' },
  { key: 'items', label: 'Items', color: 'bg-emerald-500/80' },
  { key: 'classes', label: 'Classes', color: 'bg-rose-500/80' },
  { key: 'subclasses', label: 'Subclasses', color: 'bg-fuchsia-500/80' },
  { key: 'options', label: 'Class Options', color: 'bg-teal-500/80' },
  { key: 'lore', label: 'Lore Articles', color: 'bg-indigo-500/80' },
];

function TagDetailPanel({
  group, selectedTag, allTagsInGroup, tagUsage,
  onClose, onReloadTags, onReloadUsage, isAdmin, tagWriter, isTagDrafted,
  isTagPendingDelete, onUndoDelete,
}: {
  group: any;
  selectedTag: any;
  allTagsInGroup: any[];
  tagUsage: Map<string, TagUsageBreakdown> | null;
  onClose: () => void;
  onReloadTags: () => Promise<void>;
  onReloadUsage: (opts?: { force?: boolean }) => Promise<void>;
  isAdmin: boolean;
  tagWriter: WriterApi;
  /** Selected tag has queued/drafted work — flip the panel ring. */
  isTagDrafted: boolean;
  /** Selected tag has a queued/drafted DELETE — show banner + disable controls. */
  isTagPendingDelete: boolean;
  /** Drops the queue + draft entries for the given entity id. */
  onUndoDelete: (id: string) => Promise<void> | void;
}) {
  const [mergeOpen, setMergeOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [actionInFlight, setActionInFlight] = useState(false);

  // Name draft — the header Input is always editable (matches
  // GroupSettingsPanel's always-on Name field), and Save/Revert
  // surface only when the draft differs from the saved value, same
  // pattern as the description editor below. Reset draftName when
  // the selected tag changes so a fresh selection always shows the
  // saved name in the field.
  const savedName = selectedTag.name ?? '';
  const [draftName, setDraftName] = useState<string>(savedName);
  const [savingName, setSavingName] = useState(false);
  useEffect(() => {
    setDraftName(selectedTag.name ?? '');
  }, [selectedTag.id, selectedTag.name]);
  const nameDirty = draftName.trim() !== savedName.trim() && draftName.trim().length > 0;

  // Description draft (Phase 2). The MarkdownEditor is the source of
  // truth while editing; the explicit Save button writes through
  // `tagWriter.update`. We surface a "dirty" diff so the Save button
  // only appears when there's actually a pending change.
  const savedDescription = selectedTag.description ?? '';
  const [draftDescription, setDraftDescription] = useState<string>(savedDescription);
  const [savingDescription, setSavingDescription] = useState(false);
  useEffect(() => {
    setDraftDescription(selectedTag.description ?? '');
  }, [selectedTag.id, selectedTag.description]);
  const descriptionDirty = draftDescription.trim() !== savedDescription.trim();

  // Linked-article state. The picker writes on selection (no Save
  // button), so we only track the in-flight flag for the UI lock.
  const [linkArticleOpen, setLinkArticleOpen] = useState(false);
  const [linkArticleSearch, setLinkArticleSearch] = useState('');
  const [linkArticleOptions, setLinkArticleOptions] = useState<
    { id: string; title: string }[] | null
  >(null);
  const [savingLinkedArticle, setSavingLinkedArticle] = useState(false);
  // Selected article — derived from the tag itself + the lazy-loaded
  // options list (so we can show the title even before the dropdown
  // is opened). When the picker is closed and we have an id but no
  // option list yet, the chip shows "Linked article" as a fallback
  // until the lazy load resolves.
  const linkedArticleId: string | null = selectedTag.linkedArticleId ?? null;
  const linkedArticleTitle = useMemo(() => {
    if (!linkedArticleId) return null;
    return (
      linkArticleOptions?.find((a) => a.id === linkedArticleId)?.title ?? null
    );
  }, [linkedArticleId, linkArticleOptions]);

  // Lazy-load lore articles once when the picker opens OR when we
  // need the title for a chip. Cached for the lifetime of the panel
  // — admin sessions don't outlive a handful of edits, and articles
  // don't change often.
  useEffect(() => {
    if (linkArticleOptions !== null) return;
    if (!linkArticleOpen && !linkedArticleId) return;
    let active = true;
    fetchCollection<{ id: string; title: string }>('loreArticles', {
      select: 'id, title',
      orderBy: 'title ASC',
    })
      .then((rows) => {
        if (active) setLinkArticleOptions(rows);
      })
      .catch((err) => {
        console.error('[TagDetailPanel] lore article load failed:', err);
        if (active) setLinkArticleOptions([]);
      });
    return () => {
      active = false;
    };
  }, [linkArticleOpen, linkedArticleId, linkArticleOptions]);

  // Close the dropdown on outside-click.
  const linkArticleWrapRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!linkArticleOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (!linkArticleWrapRef.current) return;
      if (!linkArticleWrapRef.current.contains(e.target as Node)) {
        setLinkArticleOpen(false);
        setLinkArticleSearch('');
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [linkArticleOpen]);

  const parentTagId = selectedTag.parentTagId ?? null;
  const parentTag = parentTagId ? allTagsInGroup.find((t) => t.id === parentTagId) : null;
  const isSubtag = !!parentTagId;
  const childCount = allTagsInGroup.filter((t) => t.parentTagId === selectedTag.id).length;
  const breakdown = tagUsage?.get(selectedTag.id);
  const total = breakdown?.total ?? 0;

  const handleRename = async () => {
    const trimmed = draftName.trim();
    // Empty input → revert silently. The user can clear the field
    // accidentally and we'd rather restore than write an empty name.
    if (!trimmed) {
      setDraftName(savedName);
      return;
    }
    // No-op when the draft matches saved; harmless but avoids a
    // redundant write + reload.
    if (trimmed === savedName) return;
    setSavingName(true);
    try {
      const d1Data: Record<string, any> = {
        group_id: group.id,
        name: trimmed,
        slug: trimmed.toLowerCase().replace(/\s+/g, '-'),
        updated_at: new Date().toISOString(),
      };
      // Preserve parent linkage; same shape as the old middle-pane
      // handleUpdateTag so we don't accidentally drop subtag→root.
      if (selectedTag.parentTagId) d1Data.parent_tag_id = selectedTag.parentTagId;
      await tagWriter.update(selectedTag.id, d1Data);
      await onReloadTags();
      toast.success(actionLabel(tagWriter.mode, 'updated'));
    } catch (err) {
      console.error(err);
      toast.error(
        isUniqueConstraintError(err)
          ? `A tag named "${trimmed}" already exists here.`
          : 'Failed to rename tag',
      );
    } finally {
      setSavingName(false);
    }
  };

  /**
   * Helper that builds the base d1 payload preserving the tag's
   * required-by-the-unique-index fields (group_id, name, slug,
   * parent_tag_id). Description + linked_article_id are spread onto
   * this; the writer treats the resulting object as the full row
   * update.
   */
  const buildBasePayload = (): Record<string, any> => {
    const base: Record<string, any> = {
      group_id: group.id,
      name: selectedTag.name,
      slug: String(selectedTag.name)
        .toLowerCase()
        .replace(/\s+/g, '-'),
      updated_at: new Date().toISOString(),
    };
    if (selectedTag.parentTagId) base.parent_tag_id = selectedTag.parentTagId;
    return base;
  };

  const handleSaveDescription = async () => {
    if (!descriptionDirty || savingDescription) return;
    setSavingDescription(true);
    try {
      const payload = buildBasePayload();
      payload.description = draftDescription.trim() || null;
      // Preserve linked article when writing description so the
      // writer doesn't accidentally null out the other field.
      if (linkedArticleId) payload.linked_article_id = linkedArticleId;
      await tagWriter.update(selectedTag.id, payload);
      await onReloadTags();
      toast.success(actionLabel(tagWriter.mode, 'updated'));
    } catch (err) {
      console.error(err);
      toast.error('Failed to save description');
    } finally {
      setSavingDescription(false);
    }
  };

  const handleSetLinkedArticle = async (nextId: string | null) => {
    if (savingLinkedArticle) return;
    if (nextId === linkedArticleId) {
      setLinkArticleOpen(false);
      return;
    }
    setSavingLinkedArticle(true);
    try {
      const payload = buildBasePayload();
      payload.linked_article_id = nextId;
      // Preserve description on the same write.
      if (savedDescription) payload.description = savedDescription;
      await tagWriter.update(selectedTag.id, payload);
      await onReloadTags();
      setLinkArticleOpen(false);
      setLinkArticleSearch('');
      toast.success(
        nextId
          ? actionLabel(tagWriter.mode, 'updated')
          : 'Linked article cleared',
      );
    } catch (err) {
      console.error(err);
      toast.error('Failed to update linked article');
    } finally {
      setSavingLinkedArticle(false);
    }
  };

  const handleDelete = async () => {
    const children = allTagsInGroup.filter((t) => t.parentTagId === selectedTag.id);
    const isProposalMode = tagWriter.mode === 'proposal' || tagWriter.mode === 'block';
    const idsBeingDeleted = [selectedTag.id, ...children.map((c) => c.id)];
    let usageLine = '';
    if (tagUsage) {
      const totalRefs = idsBeingDeleted.reduce(
        (acc, id) => acc + (tagUsage.get(id)?.total ?? 0),
        0,
      );
      if (totalRefs > 0) {
        usageLine = `\n\nThis will affect ${totalRefs} reference${totalRefs === 1 ? '' : 's'} across the compendium.`;
      }
    }
    const baseMsg =
      children.length > 0
        ? isProposalMode
          ? `Propose deleting this tag and its ${children.length} subtag${children.length === 1 ? '' : 's'}?`
          : `Delete this tag and its ${children.length} subtag${children.length === 1 ? '' : 's'}?`
        : isProposalMode
          ? 'Propose deleting this tag?'
          : 'Delete this tag?';
    if (!window.confirm(baseMsg + usageLine)) return;
    setActionInFlight(true);
    try {
      for (const c of children) await tagWriter.remove(c.id);
      await tagWriter.remove(selectedTag.id);
      invalidateTagUsageCache();
      await onReloadTags();
      await onReloadUsage();
      toast.success(
        isProposalMode
          ? actionLabel(tagWriter.mode, 'deleted')
          : children.length > 0
            ? `Deleted tag and ${children.length} subtag${children.length === 1 ? '' : 's'}`
            : 'Tag deleted',
      );
      onClose();
    } catch (err) {
      console.error(err);
      toast.error('Failed to delete tag');
      setActionInFlight(false);
    }
  };

  const handleMerge = async (targetId: string) => {
    if (actionInFlight) return;
    setActionInFlight(true);
    try {
      await mergeTagInto({ sourceId: selectedTag.id, targetId });
      await onReloadTags();
      await onReloadUsage({ force: true });
      toast.success('Tag merged.');
      setMergeOpen(false);
      onClose();
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'Failed to merge tag.');
      setActionInFlight(false);
    }
  };

  const handleMove = async (newParentId: string | null) => {
    if (actionInFlight) return;
    setActionInFlight(true);
    try {
      await moveTagToParent({ tagId: selectedTag.id, newParentId });
      await onReloadTags();
      toast.success(newParentId ? 'Moved tag under new parent.' : 'Promoted to root tag.');
      setMoveOpen(false);
      setActionInFlight(false);
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'Failed to move tag.');
      setActionInFlight(false);
    }
  };

  return (
    <>
      <Card
        className={cn(
          // `flex-1` makes the Card stretch to the grid row's full
          // height. Without it, the Card sizes to its content and
          // the right pane looks short when References is sparse.
          'flex flex-col flex-1 min-h-0 overflow-hidden',
          // Tombstone ring takes precedence (red) over the archive-
          // blue "modified" ring — a deleted tag IS still modified,
          // but the more-destructive state is the one the user
          // should see at a glance.
          isTagPendingDelete
            ? 'border-blood/40 bg-card'
            : isTagDrafted
              ? 'border-archive-blue/40 bg-card'
              : 'border-gold/20 bg-card',
        )}
      >
        {/* ── HEADER — always-editable name input ──────────────
            Previously the header showed a heading + hover-only
            pencil, which hid the rename affordance on touch and
            was easy to miss on desktop. It now mirrors
            GroupSettingsPanel: the Name is rendered as a visible
            field with Save/Revert appearing only when the draft
            differs from the saved value (same UX as the
            description editor below). */}
        <div
          className={cn(
            'p-4 border-b',
            isTagPendingDelete
              ? 'border-blood/20 bg-blood/5'
              : isTagDrafted
                ? 'border-archive-blue/20 bg-archive-blue/5'
                : 'border-gold/10 bg-gold/5',
          )}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center gap-2">
                {isSubtag && (
                  <CornerDownRight className="w-4 h-4 text-ink/40 shrink-0" />
                )}
                <Input
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  disabled={isTagPendingDelete || savingName}
                  className={cn(
                    'h-8 text-sm font-bold field-input flex-1 min-w-0',
                    isTagPendingDelete && 'line-through text-blood',
                    !isTagPendingDelete && isTagDrafted && 'text-archive-blue',
                  )}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRename();
                    if (e.key === 'Escape') setDraftName(savedName);
                  }}
                  title="Tag name"
                />
                {nameDirty && !isTagPendingDelete && (
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDraftName(savedName)}
                      disabled={savingName}
                      className="h-7 w-7 p-0 text-ink/40"
                      title="Revert"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleRename}
                      disabled={savingName}
                      className="h-7 w-7 p-0 btn-gold-solid"
                      title="Save name"
                    >
                      <Check className="w-4 h-4" />
                    </Button>
                  </div>
                )}
              </div>
              <p className="text-[11px] text-ink/50 truncate">
                {group.name}
                {parentTag && <> <span className="text-ink/30">›</span> {parentTag.name}</>}
              </p>
              {!isTagPendingDelete && isTagDrafted && (
                <span className="inline-block px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest bg-archive-blue/15 text-archive-blue rounded">
                  Modified in block
                </span>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="h-7 w-7 p-0 text-ink/40 hover:text-ink shrink-0"
              title="Close detail"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
        {isTagPendingDelete && (
          <div className="p-3 border-b border-blood/20 bg-blood/5">
            <DeletedEntityBanner
              entityLabel="Tag"
              name={selectedTag.name}
              onUndo={() => onUndoDelete(selectedTag.id)}
            />
          </div>
        )}

        {/* ── BODY ───────────────────────────────────────────────
            Section order (redesign Phase 1):
              1. Description — Phase 2 stub (needs tags.description col)
              2. Linked Article — Phase 2 stub (needs tags.linked_article_id col)
              3. Hierarchy
              4. Actions
              5. References
            Actions sit ABOVE References intentionally — what an
            admin came here to do (rename / move / merge / delete)
            shouldn't sit behind 8 rows of reference counts. */}
        <fieldset
          disabled={isTagPendingDelete}
          className="flex-1 overflow-y-auto p-4 custom-scrollbar space-y-5 border-0 m-0 disabled:opacity-60"
        >
          {/* Description — MarkdownEditor with hideToolbar so it
              reads as a tall textarea but supports the same shorthand
              the rest of the app uses. Save button only appears
              when the draft differs from the saved value. */}
          <section className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <h4 className="label-text text-gold">Description</h4>
              {descriptionDirty && (
                <div className="flex items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setDraftDescription(savedDescription)}
                    disabled={savingDescription}
                    className="h-6 text-[10px] text-ink/40 hover:text-ink"
                  >
                    Revert
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSaveDescription}
                    disabled={savingDescription}
                    className="h-6 px-2 btn-gold-solid text-[10px] gap-1"
                  >
                    <Check className="w-3 h-3" />
                    {savingDescription ? 'Saving…' : 'Save'}
                  </Button>
                </div>
              )}
            </div>
            <p className="field-hint">
              Surfaces as a tooltip on the tag in the tree and as context inside tag pickers.
            </p>
            <MarkdownEditor
              value={draftDescription}
              onChange={setDraftDescription}
              placeholder="Explain what this tag captures…"
              hideToolbar
              minHeight="100px"
            />
          </section>

          {/* Linked Article — searchable lore-article picker. On
              select, writes immediately (no explicit Save). When a
              link exists, the chip surfaces the title + an "open"
              icon-link to /wiki/article/:id + a Clear button. */}
          <section className="space-y-1.5" ref={linkArticleWrapRef}>
            <h4 className="label-text text-gold">Linked Article</h4>
            <p className="field-hint">
              Optional. Common on doctrinal tags (branches of magic, schools, factions, etc.).
            </p>
            {linkedArticleId ? (
              <div className="flex items-center justify-between gap-2 p-2 rounded border border-gold/20 bg-gold/5">
                <div className="flex items-center gap-2 min-w-0">
                  <Link
                    to={`/wiki/article/${linkedArticleId}`}
                    className="flex items-center gap-2 min-w-0 hover:text-gold text-ink/80"
                    title="Open the linked article"
                  >
                    <BookOpen className="w-3.5 h-3.5 text-gold shrink-0" />
                    <span className="text-sm truncate">
                      {linkedArticleTitle ?? 'Linked article'}
                    </span>
                  </Link>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setLinkArticleOpen((p) => !p)}
                    disabled={savingLinkedArticle}
                    className="h-6 text-[10px] text-gold/70 hover:text-gold"
                  >
                    Change
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleSetLinkedArticle(null)}
                    disabled={savingLinkedArticle}
                    className="h-6 text-[10px] text-ink/40 hover:text-blood gap-1"
                    title="Clear linked article"
                  >
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setLinkArticleOpen((p) => !p)}
                disabled={savingLinkedArticle}
                className="w-full text-left p-2 rounded border border-dashed border-gold/20 hover:border-gold/40 hover:bg-gold/5 transition-colors text-xs text-ink/50 italic flex items-center gap-2"
              >
                <Plus className="w-3 h-3 text-gold/60" />
                Link a lore article…
              </button>
            )}

            {linkArticleOpen && (
              <div className="relative">
                <div className="absolute z-10 left-0 right-0 bg-card border border-gold/30 rounded shadow-lg max-h-64 overflow-y-auto custom-scrollbar">
                  <div className="p-2 border-b border-gold/10">
                    <SearchInput
                      autoFocus
                      value={linkArticleSearch}
                      onChange={setLinkArticleSearch}
                      placeholder="Search articles by title…"
                      size="sm"
                    />
                  </div>
                  {linkArticleOptions === null ? (
                    <p className="text-[11px] italic text-ink/40 text-center py-3">
                      Loading…
                    </p>
                  ) : (
                    (() => {
                      const q = linkArticleSearch.trim().toLowerCase();
                      const visible = q
                        ? linkArticleOptions.filter((a) =>
                            a.title.toLowerCase().includes(q),
                          )
                        : linkArticleOptions;
                      if (visible.length === 0) {
                        return (
                          <p className="text-[11px] italic text-ink/40 text-center py-3">
                            No match.
                          </p>
                        );
                      }
                      return (
                        <ul className="py-1">
                          {visible.slice(0, 50).map((a) => {
                            const isSelected = a.id === linkedArticleId;
                            return (
                              <li key={a.id}>
                                <button
                                  type="button"
                                  onClick={() => handleSetLinkedArticle(a.id)}
                                  disabled={savingLinkedArticle}
                                  className={cn(
                                    'w-full flex items-center justify-between gap-2 px-3 py-1.5 hover:bg-gold/5 text-left',
                                    isSelected && 'bg-gold/10',
                                  )}
                                >
                                  <span className="text-xs text-ink truncate">
                                    {a.title}
                                  </span>
                                  {isSelected && (
                                    <span className="text-[10px] font-bold uppercase tracking-widest text-gold shrink-0">
                                      ✓
                                    </span>
                                  )}
                                </button>
                              </li>
                            );
                          })}
                          {visible.length > 50 && (
                            <li className="px-3 py-1.5 text-[10px] text-ink/40 italic text-center">
                              + {visible.length - 50} more — narrow your search
                            </li>
                          )}
                        </ul>
                      );
                    })()
                  )}
                </div>
              </div>
            )}
          </section>

          {/* Hierarchy — at-a-glance parent + subtag count. */}
          <section className="space-y-1.5">
            <h4 className="label-text text-gold">Hierarchy</h4>
            <div className="grid grid-cols-2 gap-2">
              <div className="p-2 rounded border border-gold/10">
                <div className="text-[9px] uppercase tracking-widest text-ink/40 mb-0.5">
                  Parent
                </div>
                <div className="text-sm text-ink/80">
                  {parentTag ? (
                    parentTag.name
                  ) : (
                    <span className="italic text-ink/40">Root tag</span>
                  )}
                </div>
              </div>
              <div className="p-2 rounded border border-gold/10">
                <div className="text-[9px] uppercase tracking-widest text-ink/40 mb-0.5">
                  Subtags
                </div>
                <div className="text-sm text-ink/80">
                  {childCount > 0 ? (
                    `${childCount} subtag${childCount === 1 ? '' : 's'}`
                  ) : (
                    <span className="italic text-ink/40">None</span>
                  )}
                </div>
              </div>
            </div>
            {childCount > 0 && (
              <p className="field-hint">
                Merge and demote-under-parent are disabled while subtags
                exist — promote or delete them first.
              </p>
            )}
          </section>

          {/* Actions — admin-only structural / destructive operations.
              Content-creators see an explanation banner instead. */}
          {isAdmin ? (
            <section className="space-y-2">
              <h4 className="label-text text-gold">Actions</h4>
              <div className="grid grid-cols-2 gap-1.5">
                {/* Action buttons render label-only — narrow column widths
                    were clipping label + icon side-by-side. Hover titles
                    still describe what each does for the icon-less user. */}
                {isSubtag ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="btn-gold justify-center h-8 text-xs"
                    disabled={actionInFlight}
                    onClick={() => handleMove(null)}
                    title="Promote this subtag to a root tag in this group"
                  >
                    Promote to root
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="btn-gold justify-center h-8 text-xs"
                    disabled={childCount > 0}
                    title={
                      childCount > 0
                        ? 'Promote subtags first'
                        : 'Make this a subtag of another root tag'
                    }
                    onClick={() => setMoveOpen(true)}
                  >
                    Move under…
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="btn-gold justify-center h-8 text-xs"
                  disabled={childCount > 0}
                  title={
                    childCount > 0
                      ? 'Resolve subtags first'
                      : 'Merge this tag into another'
                  }
                  onClick={() => setMergeOpen(true)}
                >
                  Merge into…
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="btn-danger justify-center h-8 text-xs col-span-2"
                  disabled={actionInFlight}
                  onClick={handleDelete}
                  title={
                    childCount > 0
                      ? `Delete this tag and its ${childCount} subtag${childCount === 1 ? '' : 's'}`
                      : 'Delete this tag'
                  }
                >
                  Delete {childCount > 0 ? `tag + ${childCount} subtag${childCount === 1 ? '' : 's'}` : 'tag'}
                </Button>
              </div>
            </section>
          ) : (
            <section className="space-y-1">
              <h4 className="label-text text-gold">Restricted Actions</h4>
              <p className="field-hint">
                Renaming, merging, moving, and deleting tags are admin-only
                in direct mode (they touch many rows at once and don't fit
                the single-revision proposal shape). Ask an admin if you
                need any of these.
              </p>
            </section>
          )}

          {/* References — scales to hundreds of entities by NOT
              inlining the list. Each row shows count + (eventually)
              a "View all" link to the filtered browser; for Phase 1
              we land just the count and the colour-coded breakdown,
              and wire the click-through in a follow-up once each
              browser's URL filter param is settled. */}
          <section className="space-y-2">
            <h4 className="label-text text-gold">
              References
              {tagUsage && total > 0 && (
                <span className="ml-2 text-ink/60 font-normal">
                  — {total} total
                </span>
              )}
            </h4>
            {!tagUsage ? (
              <p className="text-sm text-ink/40 italic">Counting…</p>
            ) : total === 0 ? (
              <p className="text-sm text-ink/50 italic">
                Not used anywhere yet — safe to delete or repurpose.
              </p>
            ) : (
              <>
                {/* Proportional usage bar — same colour key as the
                    rows below. */}
                <div
                  className="flex w-full overflow-hidden rounded-full bg-ink/10"
                  style={{ height: '8px' }}
                  title={summarizeBreakdown(breakdown)}
                >
                  {REFERENCE_KINDS.map((k) => {
                    const n = (breakdown?.[k.key] as number) ?? 0;
                    if (n === 0) return null;
                    return (
                      <div
                        key={k.key}
                        className={k.color}
                        style={{ width: `${(n / total) * 100}%` }}
                      />
                    );
                  })}
                </div>
                <ul className="border border-gold/10 rounded divide-y divide-gold/10">
                  {REFERENCE_KINDS.filter(
                    (k) => ((breakdown?.[k.key] as number) ?? 0) > 0,
                  ).map((k) => (
                    <li
                      key={k.key}
                      className="flex items-center justify-between gap-3 px-3 py-2"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={`w-2 h-2 rounded-full ${k.color} shrink-0`}
                        />
                        <span className="text-sm text-ink/80">{k.label}</span>
                      </div>
                      <span className="text-sm font-mono tabular-nums text-gold">
                        {(breakdown?.[k.key] as number) ?? 0}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </fieldset>
      </Card>

      <MergeDialog
        open={mergeOpen}
        onClose={() => setMergeOpen(false)}
        sourceTag={selectedTag}
        allTagsInGroup={allTagsInGroup}
        tagUsage={tagUsage}
        actionInFlight={actionInFlight}
        onConfirm={handleMerge}
      />
      <MoveDialog
        open={moveOpen}
        onClose={() => setMoveOpen(false)}
        sourceTag={selectedTag}
        allTagsInGroup={allTagsInGroup}
        actionInFlight={actionInFlight}
        onConfirm={handleMove}
      />
    </>
  );
}

// ─── Group settings sub-components ───────────────────────────────────

/**
 * EntityPicker-style chip + dropdown for the group's system
 * classification slots. Selected chips render on top; clicking the
 * "Add classification…" trigger reveals a searchable list of the
 * remaining options, each with its own help text so users learn
 * which editor a slot surfaces in. Closes on outside click.
 */
function SystemClassificationsField({
  selected,
  onToggle,
}: {
  selected: string[];
  onToggle: (cls: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Close the dropdown when the user clicks outside the picker.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return SYSTEM_CLASSIFICATIONS;
    return SYSTEM_CLASSIFICATIONS.filter((c) => c.toLowerCase().includes(q));
  }, [search]);

  // Help text per system slot — explains where each one surfaces so
  // authors don't have to read the source to find out. Order matches
  // SYSTEM_CLASSIFICATIONS.
  const HELP: Record<string, string> = {
    class: 'Class & subclass editors',
    subclass: 'Subclass tag pickers',
    race: 'Character creation race step',
    subrace: 'Race detail editor',
    feat: 'Feats editor + browser filter',
    background: 'Backgrounds editor + browser filter',
    skill: 'Skill editor',
    tool: 'Tool editor',
    spell: 'Spell editor + browser filter',
    item: 'Items editor',
    lore: 'Lore article tag picker',
  };

  return (
    <div className="space-y-1.5" ref={wrapperRef}>
      <label className="field-label">System Classifications</label>
      <p className="field-hint">
        Slots that let standard editors (Class, Spell, …) auto-find this group.
      </p>

      {/* Selected chips */}
      {selected.filter((c) => SYSTEM_CLASSIFICATIONS.includes(c)).length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected
            .filter((c) => SYSTEM_CLASSIFICATIONS.includes(c))
            .map((c) => (
              <span
                key={c}
                className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest bg-gold/15 text-gold border border-gold/30 rounded"
              >
                {c}
                <button
                  type="button"
                  onClick={() => onToggle(c)}
                  className="p-0.5 hover:bg-gold/20 rounded"
                  title={`Remove ${c}`}
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </span>
            ))}
        </div>
      )}

      {/* Picker trigger + dropdown */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((p) => !p)}
          className="w-full flex items-center justify-between gap-2 px-3 h-8 text-xs text-ink/60 border border-gold/20 rounded bg-background/40 hover:border-gold/40 transition-colors"
        >
          <span className="flex items-center gap-2">
            <Plus className="w-3 h-3 text-gold/60" />
            Add classification…
          </span>
          <ChevronDown
            className={cn('w-3 h-3 transition-transform', open && 'rotate-180')}
          />
        </button>
        {open && (
          <div className="absolute z-10 left-0 right-0 mt-1 bg-card border border-gold/30 rounded shadow-lg max-h-64 overflow-y-auto custom-scrollbar">
            <div className="p-2 border-b border-gold/10">
              <SearchInput
                autoFocus
                value={search}
                onChange={setSearch}
                placeholder="Search classifications…"
                size="sm"
              />
            </div>
            {visible.length === 0 ? (
              <p className="text-[11px] italic text-ink/40 text-center py-3">
                No match.
              </p>
            ) : (
              <ul className="py-1">
                {visible.map((opt) => {
                  const isSelected = selectedSet.has(opt);
                  return (
                    <li key={opt}>
                      <button
                        type="button"
                        onClick={() => onToggle(opt)}
                        className={cn(
                          'w-full flex items-start justify-between gap-2 px-3 py-1.5 hover:bg-gold/5 text-left',
                          isSelected && 'bg-gold/10',
                        )}
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-ink uppercase tracking-widest">
                            {opt}
                          </div>
                          <div className="text-[10px] text-ink/50 truncate normal-case">
                            {HELP[opt] ?? 'Classification slot'}
                          </div>
                        </div>
                        {isSelected && (
                          <span className="text-[10px] font-bold uppercase tracking-widest text-gold shrink-0">
                            ✓
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Custom-classifications block. Shows the group's current custom
 * slots as chips, plus a link to the dedicated management page
 * (where the universe of custom slots is rename-able / delete-able
 * across all groups in one move). The inline "Add custom" form
 * stays for the legacy "type and go" flow but is collapsed under a
 * disclosure so the management-page link is the primary affordance.
 */
function CustomClassificationsField({
  classifications,
  onRemove,
  newClassification,
  setNewClassification,
  onAdd,
}: {
  classifications: string[];
  onRemove: (c: string) => void;
  newClassification: string;
  setNewClassification: (v: string) => void;
  onAdd: (e: React.FormEvent) => void;
}) {
  const custom = classifications.filter((c) => !SYSTEM_CLASSIFICATIONS.includes(c));
  const [legacyOpen, setLegacyOpen] = useState(false);
  return (
    <div className="space-y-1.5">
      <label className="field-label">Custom Classifications</label>
      <p className="field-hint">
        Project-specific slots. Manage the universe of custom slots on the
        dedicated page (link below); rename and delete propagate across
        every group using the slot.
      </p>
      {custom.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {custom.map((c) => (
            <span
              key={c}
              className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest bg-archive-blue/15 text-archive-blue border border-archive-blue/30 rounded"
            >
              {c}
              <button
                type="button"
                onClick={() => onRemove(c)}
                className="p-0.5 hover:bg-archive-blue/20 rounded"
                title={`Remove ${c} from this group`}
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-ink/40 italic">
          No custom slots on this group yet.
        </p>
      )}

      <div className="flex items-center justify-between gap-2 pt-1">
        <Link
          to="/compendium/tags/classifications"
          className="inline-flex items-center gap-1.5 text-[11px] text-gold/70 hover:text-gold underline-offset-2 hover:underline"
        >
          <Settings2 className="w-3 h-3" />
          Manage classifications…
        </Link>
        <button
          type="button"
          onClick={() => setLegacyOpen((p) => !p)}
          className="text-[10px] text-ink/40 hover:text-ink underline-offset-2 hover:underline"
        >
          {legacyOpen ? 'Hide' : 'Show'} legacy add
        </button>
      </div>

      {legacyOpen && (
        <form onSubmit={onAdd} className="flex gap-2 pt-1">
          <Input
            value={newClassification}
            onChange={(e) => setNewClassification(e.target.value)}
            placeholder="add custom (legacy)…"
            className="h-7 text-xs field-input"
          />
          <Button type="submit" size="sm" className="h-7 px-2 btn-gold-solid text-[10px]">
            Add
          </Button>
        </form>
      )}
    </div>
  );
}

// ─── Group settings panel ────────────────────────────────────────────

function GroupSettingsPanel({
  group, onReloadGroups, onReloadTags, onSelectedGroupDeleted, tagsCount, isAdmin, groupWriter, isGroupDrafted,
  isGroupPendingDelete, onUndoDelete,
}: {
  group: any;
  onReloadGroups: () => Promise<void>;
  onReloadTags: () => Promise<void>;
  onSelectedGroupDeleted: () => void;
  tagsCount: number;
  isAdmin: boolean;
  groupWriter: WriterApi;
  /**
   * Group carries queued + drafted writes in the active block.
   * Drives the archive-blue header strip so the proposer can see
   * the section was touched without diffing every field manually.
   */
  isGroupDrafted: boolean;
  /** Group has a queued/drafted DELETE — show banner + disable form. */
  isGroupPendingDelete: boolean;
  /** Drops the queue + draft entries for the given entity id. */
  onUndoDelete: (id: string) => Promise<void> | void;
}) {
  const initialClassifications = group.classifications ?? (group.category ? [group.category] : []);
  const [groupName, setGroupName] = useState(group.name ?? '');
  const [description, setDescription] = useState(group.description ?? '');
  const [classifications, setClassifications] = useState<string[]>(initialClassifications);
  const [newClassification, setNewClassification] = useState('');
  const [saving, setSaving] = useState(false);

  // Reset form fields when the group changes (right pane stays mounted
  // across selection changes, so we have to refresh manually).
  useEffect(() => {
    setGroupName(group.name ?? '');
    setDescription(group.description ?? '');
    setClassifications(group.classifications ?? (group.category ? [group.category] : []));
    setNewClassification('');
  }, [group.id, group.name, group.description, group.classifications, group.category]);

  const toggleClassification = (cls: string) => {
    setClassifications((prev) => prev.includes(cls) ? prev.filter((c) => c !== cls) : [...prev, cls]);
  };

  const handleAddClassification = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newClassification.trim().toLowerCase();
    if (!trimmed || classifications.includes(trimmed)) return;
    setClassifications([...classifications, trimmed]);
    setNewClassification('');
  };

  const handleSave = async () => {
    if (!groupName.trim()) {
      toast.error('Group name is required');
      return;
    }
    setSaving(true);
    try {
      await groupWriter.update(group.id, {
        name: groupName.trim(),
        description,
        classifications,
        updated_at: new Date().toISOString(),
      });
      await onReloadGroups();
      toast.success(actionLabel(groupWriter.mode, 'updated'));
    } catch (err) {
      console.error(err);
      toast.error('Failed to save group');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    const isProposalMode = groupWriter.mode === 'proposal' || groupWriter.mode === 'block';
    // Admin direct mode does the full cascade inline (tags first,
    // then the group). Proposal mode queues only the group DELETE
    // here — Phase 2's server-side cascade strategy enrolls the
    // group's tags + downstream tag references as dependent
    // revisions when the block is submitted. (Until Phase 2 ships,
    // admins reviewing the proposal will need to manually approve
    // any child-tag deletes the proposer adds explicitly.)
    if (!isAdmin && !isProposalMode) {
      toast.error('Deleting a tag group requires admin or content-creator access.');
      return;
    }
    const tagsLine = tagsCount > 0
      ? (isProposalMode
          ? `\n\nThis group has ${tagsCount} tag${tagsCount === 1 ? '' : 's'}. Their dependents will be enrolled in the block when you submit.`
          : `\n\nThis will also delete the ${tagsCount} tag${tagsCount === 1 ? '' : 's'} in this group.`)
      : '';
    const prompt = isProposalMode
      ? `Propose deleting the "${group.name}" group?`
      : `Delete the "${group.name}" group?`;
    if (!window.confirm(prompt + tagsLine)) return;
    try {
      if (isProposalMode) {
        // Queue ONE delete revision. The cascade fans out at submit
        // time on the server (Phase 2) so the in-memory queue stays
        // bounded. Until Phase 2 ships the admin reviewer will see
        // an isolated group-delete revision and must reject any
        // dangling tag references manually.
        await groupWriter.remove(group.id);
        toast.success(actionLabel(groupWriter.mode, 'deleted'));
        onSelectedGroupDeleted();
        await onReloadGroups();
        return;
      }
      // Admin direct mode — same cascade behavior as before.
      const tagsForGroup = await fetchCollection<any>('tags', { where: 'group_id = ?', params: [group.id], select: 'id' });
      for (const t of tagsForGroup) await deleteDocument('tags', t.id);
      await deleteDocument('tagGroups', group.id);
      invalidateTagUsageCache();
      onSelectedGroupDeleted();
      await onReloadGroups();
      toast.success('Tag group deleted');
    } catch (err) {
      console.error(err);
      toast.error('Failed to delete group');
    }
  };

  return (
    <Card
      className={cn(
        // `flex-1` so the Card fills the grid row's height even when
        // the form is short. Matches TagDetailPanel's outer Card so
        // the right pane keeps the same footprint across selections.
        'flex flex-col flex-1 min-h-0 overflow-hidden',
        // When the group carries queued/drafted work, swap the
        // gold-trim Card to an archive-blue accent so the proposer
        // can see at a glance that this section is part of their
        // block. Tombstone state wins (red) over the blue modified
        // ring since the destructive state is the more important
        // one to surface.
        isGroupPendingDelete
          ? 'border-blood/40 bg-card'
          : isGroupDrafted
            ? 'border-archive-blue/40 bg-card'
            : 'border-gold/20 bg-card',
      )}
    >
      {/* HEADER — always-editable Name input + breadcrumb. Mirrors
          TagDetailPanel's header so the right pane reads consistently
          across "group selected" and "tag selected" states. The name
          is still saved by the bottom Save Changes bar (batch save)
          rather than per-field inline like the tag's name, because
          the group has multiple fields that conceptually save
          together; switching the whole panel to inline saves is a
          bigger refactor and not blocking this layout fix. */}
      <div
        className={cn(
          'p-4 border-b',
          isGroupPendingDelete
            ? 'border-blood/20 bg-blood/5'
            : isGroupDrafted
              ? 'border-archive-blue/20 bg-archive-blue/5'
              : 'border-gold/10 bg-gold/5',
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            <Input
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              disabled={isGroupPendingDelete || saving}
              className={cn(
                'h-8 text-sm font-bold field-input',
                isGroupPendingDelete && 'line-through text-blood',
                !isGroupPendingDelete && isGroupDrafted && 'text-archive-blue',
              )}
              title="Group name"
            />
            <p className="text-[11px] text-ink/50 truncate">
              Tag group
              {classifications.length > 0 && (
                <> <span className="text-ink/30">›</span> {classifications.join(' · ')}</>
              )}
            </p>
            {!isGroupPendingDelete && isGroupDrafted && (
              <span className="inline-block px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest bg-archive-blue/15 text-archive-blue rounded">
                Modified in block
              </span>
            )}
          </div>
        </div>
      </div>

      {isGroupPendingDelete && (
        <div className="p-3 border-b border-blood/20 bg-blood/5">
          <DeletedEntityBanner
            entityLabel="Tag group"
            name={group.name}
            onUndo={() => onUndoDelete(group.id)}
          />
        </div>
      )}

      {/* Body — Name moved up into the header (lives next to the
          breadcrumb so the right pane mirrors TagDetailPanel). The
          remaining fields stay in the order they were. */}
      <fieldset
        disabled={isGroupPendingDelete}
        className="flex-1 overflow-y-auto p-4 custom-scrollbar space-y-4 border-0 m-0 disabled:opacity-60">
        {/* Description — MarkdownEditor with the toolbar hidden so it
            reads as a compact text area but still supports the same
            markdown shorthand used everywhere else in the app. The
            `minHeight` matches the per-tag editor in TagDetailPanel
            so the right pane looks consistent across selections. */}
        <div className="space-y-1.5">
          <label className="field-label">Description</label>
          <MarkdownEditor
            value={description}
            onChange={setDescription}
            placeholder="What does this group capture? Where does it surface?"
            hideToolbar
            minHeight="100px"
          />
        </div>

        {/* System Classifications — picker chip + dropdown instead of
            the previous 11-button toggle row. Picker UX matches the
            shared EntityPicker shape: selected chips on top, an "Add"
            trigger underneath that opens a searchable dropdown of the
            unselected options. */}
        <SystemClassificationsField
          selected={classifications}
          onToggle={toggleClassification}
        />

        {/* Custom Classifications — chips for what's already on this
            group, plus a link to the dedicated management page where
            the universe of available custom classifications is
            CRUD'd. Inline create stays for the legacy flow but is
            now collapsed under a "Add custom (legacy)" disclosure
            so the page link is the primary affordance. */}
        <CustomClassificationsField
          classifications={classifications}
          onRemove={(c) =>
            setClassifications((prev) => prev.filter((x) => x !== c))
          }
          newClassification={newClassification}
          setNewClassification={setNewClassification}
          onAdd={handleAddClassification}
        />
      </fieldset>

      {!isGroupPendingDelete && (
        <div className="p-4 border-t border-gold/10 bg-background/50 flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={handleDelete} className="btn-danger gap-2 text-[11px]">
            <Trash2 className="w-3.5 h-3.5" /> Delete group
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving} className="btn-gold-solid label-text">
            {saving ? 'Saving…' : 'Save Changes'}
          </Button>
        </div>
      )}
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Create-group dialog
// ═══════════════════════════════════════════════════════════════════════

function CreateGroupDialog({
  open, onClose, onCreated, groupWriter,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (newId: string) => Promise<void>;
  groupWriter: WriterApi;
}) {
  const [name, setName] = useState('');
  const [classifications, setClassifications] = useState<string[]>([]);
  const [description, setDescription] = useState('');
  const [newClassification, setNewClassification] = useState('');
  const [saving, setSaving] = useState(false);

  // Reset every time the dialog opens.
  useEffect(() => {
    if (open) {
      setName('');
      setClassifications([]);
      setDescription('');
      setNewClassification('');
      setSaving(false);
    }
  }, [open]);

  const toggleClassification = (cls: string) => {
    setClassifications((prev) => prev.includes(cls) ? prev.filter((c) => c !== cls) : [...prev, cls]);
  };

  const handleAddClassification = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newClassification.trim().toLowerCase();
    if (!trimmed || classifications.includes(trimmed)) return;
    setClassifications([...classifications, trimmed]);
    setNewClassification('');
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error('Group name is required');
      return;
    }
    if (classifications.length === 0) {
      toast.error('At least one classification is required');
      return;
    }
    setSaving(true);
    try {
      const newId = crypto.randomUUID();
      const { id: createdId } = await groupWriter.create({
        id: newId,
        name: name.trim(),
        category: classifications[0],
        classifications,
        description,
        updated_at: new Date().toISOString(),
      });
      await onCreated(createdId);
      toast.success(actionLabel(groupWriter.mode, 'created'));
    } catch (err) {
      console.error(err);
      toast.error('Failed to create group');
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="dialog-content max-w-md">
        <DialogHeader className="dialog-header">
          <DialogTitle className="dialog-title">New tag group</DialogTitle>
        </DialogHeader>
        <div className="dialog-body space-y-4">
          <div className="space-y-1.5">
            <label className="field-label">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Damage Types" className="field-input" />
          </div>
          <div className="space-y-1.5">
            <label className="field-label">System Classifications</label>
            <p className="field-hint">Pick the editors this group should surface inside.</p>
            <div className="flex flex-wrap gap-1">
              {SYSTEM_CLASSIFICATIONS.map((cls) => (
                <button
                  key={cls}
                  type="button"
                  onClick={() => toggleClassification(cls)}
                  className={cn(
                    'px-2 py-1 text-[10px] font-bold uppercase tracking-widest transition-colors border',
                    classifications.includes(cls)
                      ? 'bg-gold text-white border-gold'
                      : 'bg-background/50 text-ink/60 border-gold/20 hover:border-gold/40',
                  )}
                >
                  {cls}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="field-label">Custom Classifications</label>
            <div className="flex flex-wrap gap-1">
              {classifications.filter((c) => !SYSTEM_CLASSIFICATIONS.includes(c)).map((cls) => (
                <span key={cls} className="pl-2 pr-1 py-0.5 bg-gold/10 text-gold text-[10px] font-bold uppercase tracking-widest flex items-center gap-1 border border-gold/20">
                  {cls}
                  <button type="button" onClick={() => setClassifications((prev) => prev.filter((c) => c !== cls))} className="p-0.5 hover:bg-gold/20">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
            <form onSubmit={handleAddClassification} className="flex gap-2">
              <Input value={newClassification} onChange={(e) => setNewClassification(e.target.value)} placeholder="add custom…" className="h-7 text-xs field-input" />
              <Button type="submit" size="sm" className="h-7 px-2 btn-gold-solid text-[10px]">Add</Button>
            </form>
          </div>
          <div className="space-y-1.5">
            <label className="field-label">Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} className="w-full text-sm p-2 border border-gold/20 bg-background/50 outline-none min-h-[60px]" placeholder="Optional…" />
          </div>
        </div>
        <DialogFooter className="dialog-footer">
          <Button variant="ghost" onClick={onClose} className="muted-text" disabled={saving}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving} className="btn-gold-solid px-8 label-text">
            {saving ? 'Saving…' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Merge / move dialogs
// ═══════════════════════════════════════════════════════════════════════

function MergeDialog({
  open, onClose, sourceTag, allTagsInGroup, tagUsage, actionInFlight, onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  sourceTag: any;
  allTagsInGroup: any[];
  tagUsage: Map<string, TagUsageBreakdown> | null;
  actionInFlight: boolean;
  onConfirm: (targetId: string) => void;
}) {
  const [search, setSearch] = useState('');

  useEffect(() => { if (open) setSearch(''); }, [open]);

  const candidates = useMemo(() => {
    const term = search.trim().toLowerCase();
    return allTagsInGroup
      .filter((t) => t.id !== sourceTag.id)
      .filter((t) => t.parentTagId !== sourceTag.id)
      .filter((t) => !term || String(t.name).toLowerCase().includes(term))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }, [allTagsInGroup, sourceTag.id, search]);

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="dialog-content max-w-lg">
        <DialogHeader className="dialog-header">
          <DialogTitle className="dialog-title">Merge {sourceTag.name} into…</DialogTitle>
        </DialogHeader>
        <div className="dialog-body space-y-3">
          <p className="field-hint">
            Everything currently tagged <span className="text-ink font-bold">{sourceTag.name}</span> will be retagged to the
            tag you pick. <span className="text-ink font-bold">{sourceTag.name}</span> will then be deleted. Not reversible.
          </p>
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Filter tags…"
          />
          <div className="data-table">
            <div className="data-table-body max-h-72">
              {candidates.length === 0 ? (
                <p className="text-sm text-ink/40 italic px-3 py-4">No other tags in this group match.</p>
              ) : candidates.map((candidate) => {
                const b = tagUsage?.get(candidate.id);
                const t = b?.total ?? 0;
                const isSubtag = !!candidate.parentTagId;
                return (
                  <button
                    key={candidate.id}
                    type="button"
                    disabled={actionInFlight}
                    onClick={() => onConfirm(candidate.id)}
                    className="data-table-row grid grid-cols-[1fr_auto] gap-2 px-3 py-2 text-left disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <span className="text-sm text-ink truncate flex items-center gap-1.5">
                      {isSubtag && <CornerDownRight className="w-3 h-3 text-ink/30 shrink-0" />}
                      {candidate.name}
                    </span>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-ink/50">
                      {t > 0 ? `${t} use${t === 1 ? '' : 's'}` : 'unused'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <DialogFooter className="dialog-footer">
          <Button variant="ghost" onClick={onClose} className="muted-text" disabled={actionInFlight}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MoveDialog({
  open, onClose, sourceTag, allTagsInGroup, actionInFlight, onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  sourceTag: any;
  allTagsInGroup: any[];
  actionInFlight: boolean;
  onConfirm: (newParentId: string | null) => void;
}) {
  const [search, setSearch] = useState('');

  useEffect(() => { if (open) setSearch(''); }, [open]);

  const candidates = useMemo(() => {
    const term = search.trim().toLowerCase();
    return allTagsInGroup
      .filter((t) => !t.parentTagId)
      .filter((t) => t.id !== sourceTag.id)
      .filter((t) => !term || String(t.name).toLowerCase().includes(term))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }, [allTagsInGroup, sourceTag.id, search]);

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="dialog-content max-w-lg">
        <DialogHeader className="dialog-header">
          <DialogTitle className="dialog-title">Move {sourceTag.name} under…</DialogTitle>
        </DialogHeader>
        <div className="dialog-body space-y-3">
          <p className="field-hint">
            <span className="text-ink font-bold">{sourceTag.name}</span> will become a subtag of the root you pick.
            Its usage counts and id stay the same.
          </p>
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Filter root tags…"
          />
          <div className="data-table">
            <div className="data-table-body max-h-72">
              {candidates.length === 0 ? (
                <p className="text-sm text-ink/40 italic px-3 py-4">No other root tags in this group.</p>
              ) : candidates.map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  disabled={actionInFlight}
                  onClick={() => onConfirm(candidate.id)}
                  className="data-table-row grid grid-cols-[1fr] gap-2 px-3 py-2 text-left disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span className="text-sm text-ink truncate">{candidate.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter className="dialog-footer">
          <Button variant="ghost" onClick={onClose} className="muted-text" disabled={actionInFlight}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

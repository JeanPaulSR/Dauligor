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
//      ~240px      flex-1                 ~320px
//
// URL strategy: `/compendium/tags` shows the empty-middle state;
// `/compendium/tags/:id` selects a group. Tag selection lives in
// component state (not URL) — admins bounce between tags rapidly and
// don't need deep links to a single tag.
//
// Merge / move pickers stay as Dialogs (search input + list need more
// room than the right pane affords). Everything else is in-page.
// =============================================================================

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../components/ui/dialog';
import { toast } from 'sonner';
import {
  Tags as TagsIcon, Plus, X, Trash2, Edit2, Check,
  CornerDownRight, Search, ChevronDown, ChevronRight, ArrowRightLeft, Move, CornerLeftUp,
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
  return (
    <div className="max-w-[1600px] mx-auto pb-20 space-y-4">
      {/* Page header — admin-direct route only. */}
      {!isProposalRouteForLayout && (
        <div className="page-header">
          <div>
            <h1 className="h1-title text-ink flex items-center gap-3">
              <TagsIcon className="w-7 h-7 text-gold" />
              Tag Management
            </h1>
            <p className="description-text mt-1 text-ink/60">Organize and curate the compendium taxonomy.</p>
          </div>
        </div>
      )}

      {/* Three-pane explorer */}
      <div className="grid gap-4 items-stretch grid-cols-1 lg:[grid-template-columns:240px_minmax(0,1fr)_320px] min-h-[640px]">
        <GroupRail
          groups={displayedTagGroups}
          tagsByGroupId={tagsByGroupId}
          selectedGroupId={selectedGroupId ?? null}
          loading={loading}
          searchQuery={groupSearch}
          onSearchChange={setGroupSearch}
          onSelectGroup={(id) => navigate(`${basePath}/${id}`)}
          onOpenCreateGroup={() => setCreateGroupOpen(true)}
          draftedGroupIds={draftedGroupIds}
          onUndoDelete={async (id) => {
            if (!proposalContextEarly) return;
            await proposalContextEarly.dropEntity(id);
            await reloadGroups();
          }}
        />

        {selectedGroupId && selectedGroup ? (
          <TagTreePane
            key={selectedGroupId}
            group={selectedGroup}
            tags={tagsInSelectedGroup}
            tagUsage={tagUsage}
            selectedTagId={selectedTagId}
            onSelectTag={setSelectedTagId}
            onReloadTags={reloadTags}
            onReloadUsage={reloadUsage}
            isAdmin={isAdmin}
            tagWriter={tagWriter}
          />
        ) : (
          <Card className="border-gold/10 bg-card/40 flex flex-col items-center justify-center text-center p-10">
            <TagsIcon className="w-10 h-10 text-gold/30 mb-3" />
            <p className="description-text text-ink/60">Select a tag group from the rail</p>
            <p className="text-[11px] text-ink/40 mt-1">or use <span className="text-gold/80">+ New Group</span> to create one.</p>
          </Card>
        )}

        <RightPane
          group={selectedGroup}
          selectedTag={selectedTagId ? tagsInSelectedGroup.find(t => t.id === selectedTagId) ?? null : null}
          allTagsInGroup={tagsInSelectedGroup}
          tagUsage={tagUsage}
          onCloseTag={() => setSelectedTagId(null)}
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
    <Card className="border-gold/20 bg-card/50 flex flex-col min-h-0 overflow-hidden">
      <div className="p-3 border-b border-gold/10 bg-gold/5 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="label-text text-gold">Groups</h3>
          <Button size="sm" onClick={onOpenCreateGroup} className="h-6 px-2 btn-gold-solid text-[10px] gap-1">
            <Plus className="w-3 h-3" /> New
          </Button>
        </div>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-ink/40" />
          <Input
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Filter…"
            className="h-7 pl-7 pr-6 text-xs field-input"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-ink/40 hover:text-ink"
              title="Clear filter"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
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
  const [newTagName, setNewTagName] = useState('');
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [editingTagName, setEditingTagName] = useState('');
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

  const handleUpdateTag = async (tagId: string) => {
    const trimmedName = editingTagName.trim();
    if (!trimmedName) return;
    try {
      const tag = tags.find((t) => t.id === tagId);
      const d1Data: Record<string, any> = {
        group_id: group.id,
        name: trimmedName,
        slug: trimmedName.toLowerCase().replace(/\s+/g, '-'),
        updated_at: new Date().toISOString(),
      };
      if (tag?.parentTagId) d1Data.parent_tag_id = tag.parentTagId;
      await tagWriter.update(tagId, d1Data);
      setEditingTagId(null);
      setEditingTagName('');
      await onReloadTags();
      toast.success(actionLabel(tagWriter.mode, 'updated'));
    } catch (err) {
      console.error(err);
      toast.error(isUniqueConstraintError(err) ? `A tag named "${trimmedName}" already exists here.` : 'Failed to update tag');
    }
  };

  const handleDeleteTag = async (tagId: string) => {
    const children = tags.filter((t) => t.parentTagId === tagId);
    // Proposal mode also handles subtree deletes — we queue a DELETE
    // for each child first, then the parent. The wrapper's queue is a
    // sequence so admin reviewing the block sees the full subtree as a
    // group. (Cross-entity cascade — e.g. spells losing the tag — is
    // Phase 2; this is the within-taxonomy cascade only.)
    const idsBeingDeleted = [tagId, ...children.map((c) => c.id)];
    let usageLine = '';
    if (tagUsage) {
      const total = idsBeingDeleted.reduce((acc, id) => acc + (tagUsage.get(id)?.total ?? 0), 0);
      if (total > 0) {
        usageLine = `\n\nThis will affect ${total} reference${total === 1 ? '' : 's'} across the compendium.`;
      }
    }
    const baseMsg = children.length > 0
      ? (isProposalMode
          ? `Propose deleting this tag and its ${children.length} subtag${children.length === 1 ? '' : 's'}?`
          : `Delete this tag and its ${children.length} subtag${children.length === 1 ? '' : 's'}?`)
      : (isProposalMode ? 'Propose deleting this tag?' : 'Delete this tag?');
    if (!window.confirm(baseMsg + usageLine)) return;

    try {
      // Cascade child tags first so the in-block sequence reads as
      // "leaves first" — matches how a real DB cascade would resolve.
      // In proposal mode this enqueues N+1 DELETE entries in the
      // wrapper queue; the block view + admin reviewer can group them
      // visually later (Phase 4) via the cascade_parent_revision_id
      // column once we wire the strategy registry.
      for (const c of children) await tagWriter.remove(c.id);
      await tagWriter.remove(tagId);
      if (selectedTagId && idsBeingDeleted.includes(selectedTagId)) onSelectTag(null);
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
    } catch (err) {
      console.error(err);
      toast.error('Failed to delete tag');
    }
  };

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
    const isEditing = editingTagId === tag.id;
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
            {total > 0 && <>Used by {total}</>}
            {subtagCount > 0 && <> · {subtagCount} subtag{subtagCount === 1 ? '' : 's'}</>}
          </TombstoneRow>
        </div>
      );
    }

    return (
      <div
        key={tag.id}
        title={drafted ? `${tag.name} — staged in this block` : undefined}
        className={cn(
          'flex items-center justify-between group p-1 transition-colors border-l-4',
          isSelected
            ? 'bg-gold/10 border-gold'
            : drafted
              ? 'bg-archive-blue/5 border-archive-blue/60 hover:bg-archive-blue/10'
              : 'border-transparent hover:bg-gold/5 hover:border-gold',
          !drafted && (zebraIdx % 2 === 0 ? 'bg-background/30' : 'bg-transparent'),
        )}
        style={depth === 1 ? { paddingLeft: '24px' } : undefined}
      >
        {isEditing ? (
          <div className="flex-1 flex gap-2 items-center pl-2">
            <Input
              value={editingTagName}
              onChange={(e) => setEditingTagName(e.target.value)}
              autoFocus
              className="h-7 text-sm font-bold w-full bg-background border-gold/30"
              onKeyDown={(e) => { if (e.key === 'Enter') handleUpdateTag(tag.id); if (e.key === 'Escape') setEditingTagId(null); }}
            />
            <Button size="sm" onClick={() => handleUpdateTag(tag.id)} className="h-7 w-7 p-0 btn-gold-solid shrink-0"><Check className="w-4 h-4" /></Button>
            <Button variant="ghost" size="sm" onClick={() => setEditingTagId(null)} className="h-7 w-7 p-0 text-ink/40 shrink-0"><X className="w-4 h-4" /></Button>
          </div>
        ) : (
          <>
            <span className={cn(
              "font-bold pl-1 truncate flex items-center gap-1.5 min-w-0",
              drafted && !isSelected ? "text-archive-blue" : "text-ink",
            )}>
              {isRoot ? (
                hasSubtags ? (
                  <button
                    type="button"
                    onClick={() => toggleRootCollapsed(tag.id)}
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
              <button
                type="button"
                onClick={() => onSelectTag(tag.id)}
                className="truncate text-left hover:text-gold cursor-pointer"
                title="Open detail"
              >
                {tag.name}
              </button>
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
            </span>
            <div className="flex items-center gap-2 shrink-0">
              {tagUsage && (
                <button
                  type="button"
                  onClick={() => onSelectTag(tag.id)}
                  className={cn(
                    'text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 border whitespace-nowrap cursor-pointer transition-colors',
                    total > 0
                      ? 'bg-gold/10 border-gold/20 text-gold/80 hover:bg-gold/20 hover:text-gold'
                      : 'bg-background/30 border-ink/10 text-ink/30 italic hover:text-ink/60 hover:border-ink/20',
                  )}
                  title={summarizeBreakdown(breakdown) + ' · click for details'}
                >
                  {total > 0 ? `Used by ${total}` : 'Unused'}
                </button>
              )}
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {isRoot && (
                  <Button variant="ghost" size="sm" onClick={() => { setAddingSubtagOfId(tag.id); setNewSubtagName(''); }} className="h-7 px-2 text-[10px] text-ink/40 hover:text-gold" title="Add a subtag">
                    <Plus className="w-3 h-3 mr-1" /> Subtag
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => { setEditingTagId(tag.id); setEditingTagName(tag.name); }} className="h-7 w-7 p-0 text-ink/40 hover:text-gold" title="Rename"><Edit2 className="w-3.5 h-3.5" /></Button>
                <Button variant="ghost" size="sm" onClick={() => handleDeleteTag(tag.id)} className="h-7 w-7 p-0 btn-danger" title="Delete"><Trash2 className="w-3.5 h-3.5" /></Button>
              </div>
            </div>
          </>
        )}
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
    <Card className="border-gold/20 bg-card flex flex-col min-h-0 overflow-hidden">
      <div className="p-4 border-b border-gold/10 bg-gold/5 flex items-center justify-between gap-3">
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
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink/40" />
          <Input
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
            placeholder="Filter…"
            className="h-7 pl-8 pr-7 text-xs field-input"
          />
          {tagFilter && (
            <button type="button" onClick={() => setTagFilter('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-ink/40 hover:text-ink" title="Clear filter">
              <X className="w-3 h-3" />
            </button>
          )}
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
            <span className="label-text text-ink/40 text-right pr-2">Actions</span>
          )}
        </div>
        {tags.length === 0 ? (
          <div className="empty-state">
            <TagsIcon className="w-8 h-8 text-gold/20 mb-3" />
            <p className="description-text">No tags in this group yet.</p>
            <p className="label-text text-gold/40 mt-1">Add the first one below</p>
          </div>
        ) : filterEmptyState ? (
          <div className="text-center py-8 text-ink/40 italic text-sm">No tags match "{tagFilter}".</div>
        ) : (
          rows
        )}
      </div>

      <div className="p-4 border-t border-gold/10 bg-background/50">
        <form onSubmit={handleAddTag} className="flex gap-2">
          <Input value={newTagName} onChange={(e) => setNewTagName(e.target.value)} placeholder="New tag name..." className="flex-1 bg-card border-gold/20 focus:border-gold" />
          <Button type="submit" disabled={!newTagName.trim()} className="btn-gold-solid gap-2">
            <Plus className="w-4 h-4" /> Add Tag
          </Button>
        </form>
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
      <Card className="border-gold/10 bg-card/30 hidden lg:flex items-center justify-center text-center p-6">
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

  const parentTagId = selectedTag.parentTagId ?? null;
  const parentTag = parentTagId ? allTagsInGroup.find((t) => t.id === parentTagId) : null;
  const isSubtag = !!parentTagId;
  const childCount = allTagsInGroup.filter((t) => t.parentTagId === selectedTag.id).length;
  const breakdown = tagUsage?.get(selectedTag.id);
  const total = breakdown?.total ?? 0;

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
          'flex flex-col min-h-0 overflow-hidden',
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
            <div className="min-w-0 flex-1">
              <h3 className={cn(
                'h3-title flex items-center gap-2 truncate',
                isTagPendingDelete
                  ? 'text-blood line-through'
                  : isTagDrafted
                    ? 'text-archive-blue'
                    : 'text-gold',
              )}>
                {isSubtag && <CornerDownRight className="w-4 h-4 text-ink/40 shrink-0" />}
                {selectedTag.name}
              </h3>
              <p className="text-[11px] text-ink/50 mt-0.5 truncate">
                {group.name}
                {parentTag && <> <span className="text-ink/30">›</span> {parentTag.name}</>}
              </p>
              {!isTagPendingDelete && isTagDrafted && (
                <span className="inline-block mt-1 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest bg-archive-blue/15 text-archive-blue rounded">
                  Modified in block
                </span>
              )}
            </div>
            <Button variant="ghost" size="sm" onClick={onClose} className="h-7 w-7 p-0 text-ink/40 hover:text-ink shrink-0" title="Close detail">
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

        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar space-y-4">
          <section className="space-y-1.5">
            <h4 className="label-text text-gold">Usage</h4>
            {tagUsage ? (
              total > 0 ? (
                <div>
                  <p className="text-sm text-ink">
                    <span className="font-bold text-gold">{total}</span> reference{total === 1 ? '' : 's'} across the compendium.
                  </p>
                  <p className="field-hint mt-1">{summarizeBreakdown(breakdown)}</p>
                </div>
              ) : (
                <p className="text-sm text-ink/50 italic">Not used anywhere yet — safe to delete or repurpose.</p>
              )
            ) : (
              <p className="text-sm text-ink/40 italic">Counting…</p>
            )}
          </section>

          {childCount > 0 && (
            <section className="space-y-1">
              <h4 className="label-text text-gold">Hierarchy</h4>
              <p className="field-hint">
                Has <span className="text-ink font-bold">{childCount}</span> subtag{childCount === 1 ? '' : 's'}.
                Merge and demote-under-parent are disabled while subtags exist —
                promote or delete them first.
              </p>
            </section>
          )}

          {isAdmin && (
            <section className="space-y-2">
              <h4 className="label-text text-gold">Actions</h4>
              {/* Merge / Move are admin-only — both do multi-row writes
                  (rewriting every reference to the merged tag, plus
                  the delete) that the single-revision proposal shape
                  can't capture. A future Phase 2c can teach the queue
                  to bundle them. */}
              <div className="flex flex-col gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="btn-gold gap-2 justify-start"
                  disabled={childCount > 0}
                  title={childCount > 0 ? 'Resolve subtags first' : 'Merge this tag into another'}
                  onClick={() => setMergeOpen(true)}
                >
                  <ArrowRightLeft className="w-3.5 h-3.5" /> Merge into…
                </Button>
                {isSubtag ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="btn-gold gap-2 justify-start"
                    disabled={actionInFlight}
                    onClick={() => handleMove(null)}
                  >
                    <CornerLeftUp className="w-3.5 h-3.5" /> Promote to root
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="btn-gold gap-2 justify-start"
                    disabled={childCount > 0}
                    title={childCount > 0 ? 'Promote subtags first' : 'Make this a subtag of another root'}
                    onClick={() => setMoveOpen(true)}
                  >
                    <Move className="w-3.5 h-3.5" /> Move under…
                  </Button>
                )}
              </div>
            </section>
          )}
          {!isAdmin && (
            <section className="space-y-1">
              <h4 className="label-text text-gold">Restricted Actions</h4>
              <p className="field-hint">
                Merging and moving tags are admin-only for now (they touch many
                rows at once and don't fit the single-revision proposal shape).
                Ask an admin if you need either.
              </p>
            </section>
          )}
        </div>
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
        'flex flex-col min-h-0 overflow-hidden',
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
        <div className="flex items-center justify-between gap-2">
          <h3 className={cn(
            'h3-title',
            isGroupPendingDelete
              ? 'text-blood line-through'
              : isGroupDrafted
                ? 'text-archive-blue'
                : 'text-gold',
          )}>
            Group Settings
          </h3>
          {!isGroupPendingDelete && isGroupDrafted && (
            <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest bg-archive-blue/15 text-archive-blue rounded">
              Modified in block
            </span>
          )}
        </div>
        <p className="text-[11px] text-ink/50 mt-0.5">Click a tag in the middle pane for its detail.</p>
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

      <fieldset
        disabled={isGroupPendingDelete}
        className="flex-1 overflow-y-auto p-4 custom-scrollbar space-y-4 border-0 m-0 disabled:opacity-60">
        <div className="space-y-1.5">
          <label className="field-label">Name</label>
          <Input value={groupName} onChange={(e) => setGroupName(e.target.value)} className="field-input" />
        </div>

        <div className="space-y-1.5">
          <label className="field-label">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full text-sm p-2 border border-gold/20 bg-background/50 outline-none min-h-[80px]"
            placeholder="Optional…"
          />
        </div>

        <div className="space-y-1.5">
          <label className="field-label">System Classifications</label>
          <p className="field-hint">Hardcoded slots so standard editors (Class, Spell, …) auto-find this group.</p>
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
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink/40" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter tags…" className="h-8 pl-8 field-input" />
          </div>
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
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink/40" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter root tags…" className="h-8 pl-8 field-input" />
          </div>
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

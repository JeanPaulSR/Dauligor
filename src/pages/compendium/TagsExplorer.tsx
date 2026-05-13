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
import { useParams, useNavigate } from 'react-router-dom';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../components/ui/dialog';
import { toast } from 'sonner';
import {
  Tags as TagsIcon, Plus, X, Trash2, Edit2, Check, Database, CloudOff,
  CornerDownRight, Search, ChevronDown, ChevronRight, ArrowRightLeft, Move, CornerLeftUp,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { fetchCollection, fetchDocument, upsertDocument, deleteDocument } from '../../lib/d1';
import { fetchTagUsageMap, invalidateTagUsageCache, summarizeBreakdown, type TagUsageBreakdown } from '../../lib/tagUsage';
import { mergeTagInto } from '../../lib/tagMerge';
import { moveTagToParent } from '../../lib/tagMove';
import { normalizeTagRow } from '../../lib/tagHierarchy';

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
  const isAdmin = userProfile?.role === 'admin';
  const { id: selectedGroupId } = useParams<{ id?: string }>();
  const navigate = useNavigate();

  const [tagGroups, setTagGroups] = useState<any[]>([]);
  const [allTags, setAllTags] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isUsingD1, setIsUsingD1] = useState(false);
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
    if (!isAdmin) return;
    const groupsData = await fetchCollection<any>('tagGroups', { orderBy: 'name ASC' });
    setTagGroups(groupsData);
    setIsUsingD1(groupsData.length > 0);
  }, [isAdmin]);

  const reloadTags = useCallback(async () => {
    if (!isAdmin) return;
    const tagsData = await fetchCollection<any>('tags', { orderBy: 'name ASC' });
    setAllTags(tagsData.map(normalizeTagRow));
  }, [isAdmin]);

  const reloadUsage = useCallback(async (opts: { force?: boolean } = {}) => {
    if (!isAdmin) return;
    if (opts.force) invalidateTagUsageCache();
    const map = await fetchTagUsageMap(opts.force ? { forceRefresh: true } : undefined);
    setTagUsage(map);
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
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
        setIsUsingD1(groupsData.length > 0 || tagsData.length > 0);
      })
      .catch((err) => console.error('[TagsExplorer] initial load failed:', err))
      .finally(() => { if (active) setLoading(false); });
    fetchTagUsageMap()
      .then((map) => { if (active) setTagUsage(map); })
      .catch((err) => console.warn('[TagsExplorer] tag usage scan failed:', err));
    return () => { active = false; };
  }, [isAdmin]);

  // Reset tag selection when group changes — different group, different
  // tag set, so a stale selection doesn't apply.
  useEffect(() => {
    setSelectedTagId(null);
  }, [selectedGroupId]);

  // ── Derived data ─────────────────────────────────────────────────────
  const selectedGroup = useMemo(
    () => tagGroups.find((g) => g.id === selectedGroupId) ?? null,
    [tagGroups, selectedGroupId],
  );
  const tagsInSelectedGroup = useMemo(
    () => allTags.filter((t) => t.groupId === selectedGroupId),
    [allTags, selectedGroupId],
  );
  const tagsByGroupId = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const tag of allTags) {
      if (!tag.groupId) continue;
      if (!map.has(tag.groupId)) map.set(tag.groupId, []);
      map.get(tag.groupId)!.push(tag);
    }
    return map;
  }, [allTags]);

  if (!isAdmin) {
    return <div className="text-center py-20 font-serif text-2xl text-ink/40">Access Denied</div>;
  }

  return (
    <div className="max-w-[1600px] mx-auto pb-20 space-y-4">
      {/* Page header */}
      <div className="page-header">
        <div>
          <h1 className="h1-title text-ink flex items-center gap-3">
            <TagsIcon className="w-7 h-7 text-gold" />
            Tag Management
            {isUsingD1 ? (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[10px] font-bold text-emerald-500 uppercase tracking-widest">
                <Database className="w-3 h-3" /> D1 Linked
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-[10px] font-bold text-amber-500 uppercase tracking-widest">
                <CloudOff className="w-3 h-3" /> Legacy
              </span>
            )}
          </h1>
          <p className="description-text mt-1 text-ink/60">Organize and curate the compendium taxonomy.</p>
        </div>
      </div>

      {/* Three-pane explorer */}
      <div className="grid gap-4 items-stretch grid-cols-1 lg:[grid-template-columns:240px_minmax(0,1fr)_320px] min-h-[640px]">
        <GroupRail
          groups={tagGroups}
          tagsByGroupId={tagsByGroupId}
          selectedGroupId={selectedGroupId ?? null}
          loading={loading}
          searchQuery={groupSearch}
          onSearchChange={setGroupSearch}
          onSelectGroup={(id) => navigate(`/compendium/tags/${id}`)}
          onOpenCreateGroup={() => setCreateGroupOpen(true)}
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
          onSelectedGroupDeleted={() => navigate('/compendium/tags')}
        />
      </div>

      <CreateGroupDialog
        open={createGroupOpen}
        onClose={() => setCreateGroupOpen(false)}
        onCreated={async (newId) => {
          await reloadGroups();
          navigate(`/compendium/tags/${newId}`);
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
}: {
  groups: any[];
  tagsByGroupId: Map<string, any[]>;
  selectedGroupId: string | null;
  loading: boolean;
  searchQuery: string;
  onSearchChange: (s: string) => void;
  onSelectGroup: (id: string) => void;
  onOpenCreateGroup: () => void;
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
              const groupTags = tagsByGroupId.get(group.id) ?? [];
              const subtagCount = groupTags.filter((t) => t.parentTagId).length;
              const rootCount = groupTags.length - subtagCount;
              return (
                <li key={group.id}>
                  <button
                    type="button"
                    onClick={() => onSelectGroup(group.id)}
                    className={cn(
                      'browser-row w-full grid grid-cols-[1fr_auto] items-center gap-2 px-3 py-2 text-left',
                      isActive
                        ? 'bg-gold/15 border-r-4 border-r-gold text-gold font-bold'
                        : 'text-ink/70 hover:bg-gold/5',
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
  group, tags, tagUsage, selectedTagId, onSelectTag, onReloadTags, onReloadUsage,
}: {
  group: any;
  tags: any[];
  tagUsage: Map<string, TagUsageBreakdown> | null;
  selectedTagId: string | null;
  onSelectTag: (id: string | null) => void;
  onReloadTags: () => Promise<void>;
  onReloadUsage: (opts?: { force?: boolean }) => Promise<void>;
}) {
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
    await upsertDocument('tags', newId, d1Data);
    await onReloadTags();
  };

  const handleAddTag = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newTagName.trim();
    if (!trimmed) return;
    try {
      await addTag(trimmed, null);
      setNewTagName('');
      toast.success('Tag added');
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
      toast.success('Subtag added');
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
      await upsertDocument('tags', tagId, d1Data);
      setEditingTagId(null);
      setEditingTagName('');
      await onReloadTags();
      toast.success('Tag updated');
    } catch (err) {
      console.error(err);
      toast.error(isUniqueConstraintError(err) ? `A tag named "${trimmedName}" already exists here.` : 'Failed to update tag');
    }
  };

  const handleDeleteTag = async (tagId: string) => {
    const children = tags.filter((t) => t.parentTagId === tagId);
    const idsBeingDeleted = [tagId, ...children.map((c) => c.id)];
    let usageLine = '';
    if (tagUsage) {
      const total = idsBeingDeleted.reduce((acc, id) => acc + (tagUsage.get(id)?.total ?? 0), 0);
      if (total > 0) {
        usageLine = `\n\nThis will affect ${total} reference${total === 1 ? '' : 's'} across the compendium.`;
      }
    }
    const baseMsg = children.length > 0
      ? `Delete this tag and its ${children.length} subtag${children.length === 1 ? '' : 's'}?`
      : 'Delete this tag?';
    if (!window.confirm(baseMsg + usageLine)) return;

    try {
      for (const c of children) await deleteDocument('tags', c.id);
      await deleteDocument('tags', tagId);
      if (selectedTagId && idsBeingDeleted.includes(selectedTagId)) onSelectTag(null);
      invalidateTagUsageCache();
      await onReloadTags();
      await onReloadUsage();
      toast.success(children.length > 0
        ? `Deleted tag and ${children.length} subtag${children.length === 1 ? '' : 's'}`
        : 'Tag deleted');
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
    const breakdown = tagUsage?.get(tag.id);
    const total = breakdown?.total ?? 0;

    return (
      <div
        key={tag.id}
        className={cn(
          'flex items-center justify-between group p-1 transition-colors border-l-4',
          isSelected
            ? 'bg-gold/10 border-gold'
            : 'border-transparent hover:bg-gold/5 hover:border-gold',
          zebraIdx % 2 === 0 ? 'bg-background/30' : 'bg-transparent',
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
            <span className="font-bold text-ink pl-1 truncate flex items-center gap-1.5 min-w-0">
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
      />
    );
  }
  return (
    <GroupSettingsPanel
      group={group}
      onReloadGroups={onReloadGroups}
      onSelectedGroupDeleted={onSelectedGroupDeleted}
      tagsCount={allTagsInGroup.length}
    />
  );
}

// ─── Tag detail panel ────────────────────────────────────────────────

function TagDetailPanel({
  group, selectedTag, allTagsInGroup, tagUsage,
  onClose, onReloadTags, onReloadUsage,
}: {
  group: any;
  selectedTag: any;
  allTagsInGroup: any[];
  tagUsage: Map<string, TagUsageBreakdown> | null;
  onClose: () => void;
  onReloadTags: () => Promise<void>;
  onReloadUsage: (opts?: { force?: boolean }) => Promise<void>;
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
      <Card className="border-gold/20 bg-card flex flex-col min-h-0 overflow-hidden">
        <div className="p-4 border-b border-gold/10 bg-gold/5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <h3 className="h3-title text-gold flex items-center gap-2 truncate">
                {isSubtag && <CornerDownRight className="w-4 h-4 text-ink/40 shrink-0" />}
                {selectedTag.name}
              </h3>
              <p className="text-[11px] text-ink/50 mt-0.5 truncate">
                {group.name}
                {parentTag && <> <span className="text-ink/30">›</span> {parentTag.name}</>}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={onClose} className="h-7 w-7 p-0 text-ink/40 hover:text-ink shrink-0" title="Close detail">
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

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

          <section className="space-y-2">
            <h4 className="label-text text-gold">Actions</h4>
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
  group, onReloadGroups, onSelectedGroupDeleted, tagsCount,
}: {
  group: any;
  onReloadGroups: () => Promise<void>;
  onSelectedGroupDeleted: () => void;
  tagsCount: number;
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
      await upsertDocument('tagGroups', group.id, {
        name: groupName.trim(),
        description,
        classifications,
        updated_at: new Date().toISOString(),
      });
      await onReloadGroups();
      toast.success('Group updated');
    } catch (err) {
      console.error(err);
      toast.error('Failed to save group');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    const tagsLine = tagsCount > 0
      ? `\n\nThis will also delete the ${tagsCount} tag${tagsCount === 1 ? '' : 's'} in this group.`
      : '';
    if (!window.confirm(`Delete the "${group.name}" group?${tagsLine}`)) return;
    try {
      // Tags first (cascade isn't on the FK).
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
    <Card className="border-gold/20 bg-card flex flex-col min-h-0 overflow-hidden">
      <div className="p-4 border-b border-gold/10 bg-gold/5">
        <h3 className="h3-title text-gold">Group Settings</h3>
        <p className="text-[11px] text-ink/50 mt-0.5">Click a tag in the middle pane for its detail.</p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar space-y-4">
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
      </div>

      <div className="p-4 border-t border-gold/10 bg-background/50 flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={handleDelete} className="btn-danger gap-2 text-[11px]">
          <Trash2 className="w-3.5 h-3.5" /> Delete group
        </Button>
        <Button size="sm" onClick={handleSave} disabled={saving} className="btn-gold-solid label-text">
          {saving ? 'Saving…' : 'Save Changes'}
        </Button>
      </div>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Create-group dialog
// ═══════════════════════════════════════════════════════════════════════

function CreateGroupDialog({
  open, onClose, onCreated,
}: { open: boolean; onClose: () => void; onCreated: (newId: string) => Promise<void>; }) {
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
      await upsertDocument('tagGroups', newId, {
        name: name.trim(),
        category: classifications[0],
        classifications,
        description,
        updated_at: new Date().toISOString(),
      });
      await onCreated(newId);
      toast.success('Tag group created');
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

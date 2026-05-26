import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Search, X } from 'lucide-react';
import { Input } from '../ui/input';
import { orderTagsAsTree } from '../../lib/tagHierarchy';
import { cn } from '../../lib/utils';

/**
 * Shared tag picker — collapsible per-group chip layout with a single
 * filter input, a "Selected" summary chip row, and sub-tag drawers.
 *
 * Used by every compendium editor's Tags sub-tab (SpellsEditor wired
 * first; ItemsEditor + FeatsEditor on follow-up). The component is
 * pure — owns its own UI state (filter, open groups, expanded parents)
 * but selection state lives in the parent editor's formData so save
 * paths stay unchanged.
 *
 * Originally lived inline in SpellsEditor.tsx as `SpellTagPicker`;
 * extracted 2026-05-26 so the items + facilities tag tabs can use the
 * same affordance without code duplication.
 *
 * Notable behaviours:
 *   - Filter is scoped to this picker — typing matches tag names; the
 *     "Selected" row stays visible while filtering so authors can see
 *     what's pinned even when the chip wall is narrowed.
 *   - Per-group sections are collapsed by default. Auto-open if the
 *     group has selected tags, or if the filter matches any tag in
 *     the group. Force-open when actively filtering so matches don't
 *     hide behind a closed header.
 *   - Sub-tags (tags with `parentTagId`) collapse under a per-root
 *     drawer that the user can expand independently. Toggling a child
 *     auto-includes the parent if it isn't already selected; deselecting
 *     a parent removes its currently-selected children too.
 *   - "Orphaned" sub-tags whose parent isn't in the visible filter set
 *     surface in a separate amber-bordered row so authors can still
 *     find them.
 */

export interface TagPickerProps {
  tags: { id: string; name: string; groupId: string | null; parentTagId: string | null }[];
  tagGroups: { id: string; name: string }[];
  selectedIds: string[];
  onChange: (next: string[]) => void;
  hint: string;
  emptyHint: string;
}

export default function TagPicker({ tags, tagGroups, selectedIds, onChange, hint, emptyHint }: TagPickerProps) {
  const [filter, setFilter] = useState('');
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => {
    const open = new Set<string>();
    for (const tagId of selectedIds) {
      const tag = tags.find((t) => t.id === tagId);
      if (tag?.groupId) open.add(tag.groupId);
    }
    return open;
  });
  const [expandedParents, setExpandedParents] = useState<Set<string>>(new Set());
  const toggleParentExpanded = (rootId: string) => {
    setExpandedParents((prev) => {
      const next = new Set(prev);
      next.has(rootId) ? next.delete(rootId) : next.add(rootId);
      return next;
    });
  };

  const filterTerm = filter.trim().toLowerCase();
  const isFiltering = !!filterTerm;

  const groupData = useMemo(() => {
    return tagGroups
      .map((group) => {
        const groupTags = orderTagsAsTree(tags.filter((t) => t.groupId === group.id));
        const matching = isFiltering
          ? groupTags.filter((t) => String(t.name).toLowerCase().includes(filterTerm))
          : groupTags;
        const selectedInGroup = groupTags.filter((t) => selectedIds.includes(t.id)).length;
        return { group, groupTags, matching, selectedInGroup };
      })
      .filter((d) => d.groupTags.length > 0 && (!isFiltering || d.matching.length > 0));
  }, [tagGroups, tags, isFiltering, filterTerm, selectedIds]);

  const selectedTagsOrdered = useMemo(() => {
    return selectedIds
      .map((id) => tags.find((t) => t.id === id))
      .filter(Boolean) as { id: string; name: string; parentTagId: string | null }[];
  }, [selectedIds, tags]);

  const toggleGroup = (id: string) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleTag = (tagId: string) => {
    if (selectedIds.includes(tagId)) {
      const childIds = new Set(
        tags.filter((t) => t.parentTagId === tagId).map((t) => t.id),
      );
      onChange(selectedIds.filter((id) => id !== tagId && !childIds.has(id)));
      return;
    }
    const tag = tags.find((t) => t.id === tagId);
    const parentId = tag?.parentTagId || null;
    if (parentId && !selectedIds.includes(parentId)) {
      onChange([...selectedIds, parentId, tagId]);
    } else {
      onChange([...selectedIds, tagId]);
    }
  };

  if (tags.length === 0) {
    return (
      <div className="border border-gold/10 rounded-md p-4 bg-background/20">
        <p className="text-xs text-ink/40 italic">{emptyHint}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 border border-gold/10 rounded-md p-4 bg-background/20">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink/40" />
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter tags…"
          className="h-8 pl-8 pr-7 text-xs bg-background/50 border-gold/10 focus:border-gold"
        />
        {filter && (
          <button
            type="button"
            onClick={() => setFilter('')}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-ink/40 hover:text-ink"
            title="Clear filter"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {selectedTagsOrdered.length > 0 && (
        <div className="space-y-1.5">
          <span className="text-[10px] font-bold uppercase tracking-widest text-ink/50">
            Selected ({selectedTagsOrdered.length})
          </span>
          <div className="flex flex-wrap gap-1.5">
            {selectedTagsOrdered.map((tag) => (
              <button
                key={tag.id}
                type="button"
                onClick={() => toggleTag(tag.id)}
                className="rounded border border-gold/60 bg-gold/15 text-gold px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide hover:bg-gold/25 inline-flex items-center gap-1"
                title="Remove from selection"
              >
                {tag.parentTagId && <span className="opacity-60">↳</span>}
                {tag.name}
                <X className="w-3 h-3 opacity-70" />
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        {groupData.length === 0 ? (
          <p className="text-xs text-ink/40 italic">No tags match "{filter}".</p>
        ) : groupData.map(({ group, groupTags, matching, selectedInGroup }) => {
          const isOpen = isFiltering || openGroups.has(group.id);
          const visibleTags = isFiltering ? matching : groupTags;
          return (
            <div key={group.id} className="border border-gold/10 rounded bg-background/30 overflow-hidden">
              <button
                type="button"
                onClick={() => { if (!isFiltering) toggleGroup(group.id); }}
                className={cn(
                  'w-full flex items-center justify-between gap-2 px-3 py-2 text-left transition-colors',
                  isFiltering ? 'cursor-default' : 'hover:bg-gold/5 cursor-pointer',
                )}
              >
                <span className="flex items-center gap-2 min-w-0">
                  {!isFiltering && (
                    isOpen
                      ? <ChevronDown className="w-3.5 h-3.5 text-ink/50 shrink-0" />
                      : <ChevronRight className="w-3.5 h-3.5 text-ink/50 shrink-0" />
                  )}
                  <span className="text-[10px] uppercase tracking-widest font-bold text-ink/70 truncate">
                    {group.name}
                  </span>
                </span>
                <span className="flex items-center gap-2 shrink-0">
                  {selectedInGroup > 0 && (
                    <span className="text-[10px] font-bold tabular-nums bg-gold/15 text-gold border border-gold/30 px-1.5 py-0.5">
                      {selectedInGroup}
                    </span>
                  )}
                  <span className="text-[10px] text-ink/40 tabular-nums">
                    {isFiltering && matching.length !== groupTags.length
                      ? `${matching.length} / ${groupTags.length}`
                      : groupTags.length}
                  </span>
                </span>
              </button>
              {isOpen && (() => {
                const visibleRoots = visibleTags.filter((t) => !t.parentTagId);
                const subtagsByParentId = new Map<string, typeof visibleTags>();
                const visibleRootIds = new Set(visibleRoots.map((r) => r.id));
                const orphans: typeof visibleTags = [];
                for (const tag of visibleTags) {
                  if (!tag.parentTagId) continue;
                  if (!visibleRootIds.has(tag.parentTagId)) {
                    orphans.push(tag);
                    continue;
                  }
                  if (!subtagsByParentId.has(tag.parentTagId)) subtagsByParentId.set(tag.parentTagId, []);
                  subtagsByParentId.get(tag.parentTagId)!.push(tag);
                }

                const autoExpandedRoots = new Set<string>();
                for (const [parentId, children] of subtagsByParentId) {
                  if (children.some((c) => selectedIds.includes(c.id))) {
                    autoExpandedRoots.add(parentId);
                    continue;
                  }
                  if (isFiltering && children.some((c) => String(c.name).toLowerCase().includes(filterTerm))) {
                    autoExpandedRoots.add(parentId);
                  }
                }
                const isRootExpanded = (rootId: string) =>
                  expandedParents.has(rootId) || autoExpandedRoots.has(rootId);

                const renderChip = (tag: typeof visibleTags[number]) => {
                  const active = selectedIds.includes(tag.id);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => toggleTag(tag.id)}
                      className={cn(
                        'rounded border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide transition-colors',
                        active
                          ? 'border-gold/60 bg-gold/15 text-gold'
                          : 'border-gold/15 text-ink/55 hover:border-gold/30 hover:text-gold/80',
                      )}
                    >
                      {tag.name}
                    </button>
                  );
                };

                return (
                  <div className="px-3 pb-2.5 pt-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {visibleRoots.map((root) => {
                        const subs = subtagsByParentId.get(root.id) ?? [];
                        const hasSubs = subs.length > 0;
                        const expanded = hasSubs && isRootExpanded(root.id);
                        return (
                          <span key={root.id} className="inline-flex items-center gap-0.5">
                            {renderChip(root)}
                            {hasSubs && (
                              <button
                                type="button"
                                onClick={() => toggleParentExpanded(root.id)}
                                className={cn(
                                  'inline-flex items-center justify-center h-[22px] w-[18px] -ml-0.5 rounded border transition-colors',
                                  expanded
                                    ? 'border-gold/50 bg-gold/15 text-gold'
                                    : 'border-gold/20 bg-background/40 text-ink/60 hover:border-gold/40 hover:text-gold',
                                )}
                                title={expanded
                                  ? `Hide ${root.name} subtags (${subs.length})`
                                  : `Show ${root.name} subtags (${subs.length})`}
                                aria-expanded={expanded}
                                aria-label={expanded ? `Collapse ${root.name} subtags` : `Expand ${root.name} subtags`}
                              >
                                {expanded
                                  ? <ChevronDown className="w-3 h-3" />
                                  : <ChevronRight className="w-3 h-3" />}
                              </button>
                            )}
                          </span>
                        );
                      })}
                    </div>

                    {visibleRoots.map((root) => {
                      if (!isRootExpanded(root.id)) return null;
                      const subs = subtagsByParentId.get(root.id) ?? [];
                      if (subs.length === 0) return null;
                      return (
                        <div
                          key={`drawer-${root.id}`}
                          className="ml-3 pl-3 border-l border-gold/15 flex flex-wrap items-center gap-1.5"
                        >
                          <span className="text-[10px] uppercase tracking-widest text-ink/40 mr-1">
                            {root.name}:
                          </span>
                          {subs.map(renderChip)}
                        </div>
                      );
                    })}

                    {orphans.length > 0 && (
                      <div
                        className="ml-3 pl-3 border-l border-amber-500/30 flex flex-wrap items-center gap-1.5"
                        title="Subtags whose parent isn't in this group's visible tag set."
                      >
                        <span className="text-[10px] uppercase tracking-widest text-amber-500/60 mr-1">
                          Orphaned:
                        </span>
                        {orphans.map(renderChip)}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          );
        })}
      </div>

      <p className="text-[10px] text-ink/40">{hint}</p>
    </div>
  );
}

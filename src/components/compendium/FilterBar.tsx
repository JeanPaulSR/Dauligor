import React from 'react';
import { Search, Filter, X } from 'lucide-react';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Card } from '../ui/card';
import { cn } from '../../lib/utils';
import type { ReactNode } from 'react';

export interface FilterBarProps {
  search: string;
  setSearch: (val: string) => void;
  isFilterOpen: boolean;
  setIsFilterOpen: (val: boolean) => void;
  activeFilterCount: number;
  tagGroups?: any[];
  tagsByGroup?: Record<string, any[]>;
  tagStates?: Record<string, number>;
  setTagStates?: (val: any) => void;
  cycleTagState?: (tagId: string) => void;
  groupCombineModes?: Record<string, 'AND' | 'OR' | 'XOR'>;
  cycleGroupMode?: (groupId: string) => void;
  groupExclusionModes?: Record<string, 'AND' | 'OR' | 'XOR'>;
  cycleExclusionMode?: (groupId: string) => void;
  resetFilters: () => void;
  searchPlaceholder?: string;
  filterTitle?: string;
  filterSubtitle?: string;
  resetLabel?: string;
  applyLabel?: string;
  renderFilters?: ReactNode;
}

export function FilterBar({
  search, setSearch,
  isFilterOpen, setIsFilterOpen,
  activeFilterCount,
  tagGroups = [],
  tagsByGroup = {},
  tagStates = {},
  setTagStates,
  cycleTagState,
  groupCombineModes = {},
  cycleGroupMode,
  groupExclusionModes = {},
  cycleExclusionMode,
  resetFilters,
  searchPlaceholder = 'Search...',
  filterTitle = 'Advanced Filters',
  filterSubtitle,
  resetLabel = 'Reset All Filters',
  applyLabel = 'Apply & Close',
  renderFilters
}: FilterBarProps) {
  const defaultFilterContent = (
    <>
      {tagGroups.map(group => {
        const groupTags = tagsByGroup[group.id] || [];
        if (groupTags.length === 0) return null;
        const mode = groupCombineModes[group.id] || 'OR';
        const exMode = groupExclusionModes[group.id] || 'OR';

        // Hierarchical layout: roots get their own chip-row; subtags
        // (parent_tag_id / parentTagId pointing to a tag in this group)
        // get an indented chip-row directly under their parent. Mirrors
        // the SpellTagPicker layout — keeps tag groups with many
        // subtags from collapsing into one "clumped up mess" wall of
        // chips. Orphaned subtags (parent missing from the group's tag
        // set, rare with consistent data) fall to a separate amber-
        // edged row so they don't disappear when filtering.
        const idSet = new Set(groupTags.map(t => t.id));
        const getParent = (t: any): string | null => {
          const p = t?.parentTagId ?? t?.parent_tag_id ?? null;
          return p && idSet.has(p) ? p : null;
        };
        const roots = groupTags.filter(t => !getParent(t)).sort((a, b) => String(a.name).localeCompare(String(b.name)));
        const childrenByParent = new Map<string, any[]>();
        for (const t of groupTags) {
          const p = getParent(t);
          if (!p) continue;
          if (!childrenByParent.has(p)) childrenByParent.set(p, []);
          childrenByParent.get(p)!.push(t);
        }
        for (const arr of childrenByParent.values()) {
          arr.sort((a, b) => String(a.name).localeCompare(String(b.name)));
        }
        const orphans = groupTags.filter(t => {
          const raw = t?.parentTagId ?? t?.parent_tag_id ?? null;
          return raw && !idSet.has(raw);
        });

        const renderChip = (tag: any) => {
          const state = tagStates[tag.id] || 0;
          return (
            <button
              key={tag.id}
              onClick={() => cycleTagState?.(tag.id)}
              className={cn(
                "filter-tag",
                state === 1 ? "btn-gold-solid border-gold shadow-lg shadow-gold/20" : state === 2 ? "btn-danger border-blood" : "btn-gold"
              )}
            >
              {/* Subtags render as `Parent.Name` for ambiguity-free
                  scanning when the chip wraps to a new line and loses
                  its left-border indent context. tagPickerLabel returns
                  the `Parent.Child` shape when parentTagId is present. */}
              {String(tag.name)}
            </button>
          );
        };

        return (
          <div key={group.id} className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-6">
                <span className="h3-title uppercase text-ink">{group.name}</span>
                <div className="flex items-center gap-4">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => cycleGroupMode?.(group.id)}
                    className="h-6 px-3 btn-gold text-[9px]"
                  >
                    {mode}
                  </Button>
                  <div className="flex items-center gap-2">
                    <span className="label-text text-blood/60">Exclusion Logic</span>
                    <Button
                      size="sm"
                      onClick={() => cycleExclusionMode?.(group.id)}
                      className="h-6 px-3 btn-danger"
                    >
                      {exMode}
                    </Button>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    if (!setTagStates) return;
                    const newStates: Record<string, number> = { ...tagStates };
                    groupTags.forEach(t => newStates[t.id] = 1);
                    setTagStates(newStates);
                  }}
                  className="label-text hover:underline"
                >
                  Include All
                </button>
                <span className="text-gold/20">|</span>
                <button
                  onClick={() => {
                    if (!setTagStates) return;
                    const newStates: Record<string, number> = { ...tagStates };
                    groupTags.forEach(t => delete newStates[t.id]);
                    setTagStates(newStates);
                  }}
                  className="label-text hover:underline"
                >
                  Clear
                </button>
              </div>
            </div>
            <div className="space-y-2">
              {roots.map(root => {
                const children = childrenByParent.get(root.id) || [];
                return (
                  <React.Fragment key={root.id}>
                    <div className="flex flex-wrap gap-2">
                      {renderChip(root)}
                    </div>
                    {children.length > 0 && (
                      <div className="ml-4 pl-3 border-l border-gold/15 flex flex-wrap gap-2">
                        {children.map(renderChip)}
                      </div>
                    )}
                  </React.Fragment>
                );
              })}
              {orphans.length > 0 && (
                <div className="ml-4 pl-3 border-l border-amber-500/30 flex flex-wrap gap-2" title="Subtags whose parent is not in this group's visible tag set.">
                  {orphans.map(renderChip)}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-4 items-center bg-card p-2 rounded-lg border border-gold/10 shadow-sm">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3 h-3 text-ink/30" />
          <Input 
            placeholder={searchPlaceholder}
            className="field-input pl-8 h-8 focus:border-gold"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button 
          variant={isFilterOpen ? "default" : "outline"} 
          size="sm" 
          onClick={() => setIsFilterOpen(true)}
          className={`h-8 gap-2 w-full sm:w-auto ${isFilterOpen ? 'bg-gold text-white' : 'border-gold/20 text-gold hover:bg-gold/10'}`}
        >
          <Filter className="w-3 h-3" /> Filters
          {activeFilterCount > 0 && (
            <Badge className="bg-white text-gold h-4 px-1 min-w-[1rem] flex items-center justify-center text-[10px]">
              {activeFilterCount}
            </Badge>
          )}
        </Button>
      </div>

      {isFilterOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 md:p-10">
          <div 
            className="absolute inset-0 bg-ink/40 backdrop-blur-sm animate-in fade-in duration-200" 
            onClick={() => setIsFilterOpen(false)} 
          />
          <Card className="relative w-full max-w-4xl max-h-full overflow-hidden flex flex-col border-gold/20 bg-card shadow-2xl animate-in zoom-in-95 duration-200 pointer-events-auto">
            <div className="flex items-center justify-between p-6 border-b border-gold/10 bg-gold/5">
              <div className="flex items-center gap-6">
                <div className="space-y-1">
                  <h2 className="h2-title uppercase text-ink">{filterTitle}</h2>
                  {filterSubtitle ? (
                    <p className="text-sm text-ink/55">{filterSubtitle}</p>
                  ) : null}
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setIsFilterOpen(false)} className="text-ink/40 hover:text-gold transition-colors">
                <X className="w-5 h-5" />
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-12 custom-scrollbar">
              {renderFilters || defaultFilterContent}
            </div>

            <div className="p-6 border-t border-gold/10 bg-gold/5 flex items-center justify-between">
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={resetFilters}
                className="label-text text-ink/40 hover:text-blood"
              >
                {resetLabel}
              </Button>
              <Button onClick={() => setIsFilterOpen(false)} className="btn-gold-solid px-10 h-10 shadow-lg shadow-gold/20">
                {applyLabel}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

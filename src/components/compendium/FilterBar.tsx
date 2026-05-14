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
      {tagGroups.map(group => (
        <TagGroupFilter
          key={group.id}
          group={group}
          tags={tagsByGroup[group.id] || []}
          tagStates={tagStates}
          setTagStates={setTagStates}
          cycleTagState={cycleTagState}
          combineMode={groupCombineModes[group.id]}
          cycleGroupMode={cycleGroupMode}
          exclusionMode={groupExclusionModes[group.id]}
          cycleExclusionMode={cycleExclusionMode}
        />
      ))}
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

/**
 * Apply 3-state tag chip filtering with per-group AND/OR/XOR
 * (inclusion) and AND/OR/XOR (exclusion) modes. Returns true if the
 * entity's effective tag ID set passes every group's rules.
 *
 * `entityTagIds` should already be expanded with ancestors via
 * `expandTagsWithAncestors` so subtag matching works (a class tagged
 * `Conjure.Manifest` matches a filter on `Conjure`).
 *
 * Lifted out of ClassList's inline match logic so SpellList and
 * SpellListManager can share it instead of reinventing the
 * group-result accumulator each.
 */
export function matchesTagFilters(
  entityTagIds: string[],
  tagGroups: Array<{ id: string }>,
  tagsByGroup: Record<string, Array<{ id: string }>>,
  tagStates: Record<string, number>,
  groupCombineModes: Record<string, 'AND' | 'OR' | 'XOR'>,
  groupExclusionModes: Record<string, 'AND' | 'OR' | 'XOR'>,
): boolean {
  if (Object.keys(tagStates).length === 0) return true;

  const groupResults = tagGroups.map(group => {
    const groupTags = tagsByGroup[group.id] || [];
    const includedInGroup = groupTags.filter(t => tagStates[t.id] === 1);
    const excludedInGroup = groupTags.filter(t => tagStates[t.id] === 2);
    if (includedInGroup.length === 0 && excludedInGroup.length === 0) return null;

    const entityTagsInGroup = entityTagIds.filter(tid => groupTags.some(gt => gt.id === tid));

    let inclusionMatch = true;
    if (includedInGroup.length > 0) {
      const mode = groupCombineModes[group.id] || 'OR';
      if (mode === 'OR') inclusionMatch = includedInGroup.some(st => entityTagsInGroup.includes(st.id));
      else if (mode === 'AND') inclusionMatch = includedInGroup.every(st => entityTagsInGroup.includes(st.id));
      else inclusionMatch = includedInGroup.filter(st => entityTagsInGroup.includes(st.id)).length === 1;
    }

    let exclusionMatch = false;
    if (excludedInGroup.length > 0) {
      const mode = groupExclusionModes[group.id] || 'OR';
      if (mode === 'OR') exclusionMatch = excludedInGroup.some(st => entityTagsInGroup.includes(st.id));
      else if (mode === 'AND') exclusionMatch = excludedInGroup.every(st => entityTagsInGroup.includes(st.id));
      else exclusionMatch = excludedInGroup.filter(st => entityTagsInGroup.includes(st.id)).length === 1;
    }

    return {
      inclusionMatch,
      exclusionMatch,
      hasInclusions: includedInGroup.length > 0,
    };
  });

  const activeResults = groupResults.filter(r => r !== null) as Array<{ inclusionMatch: boolean; exclusionMatch: boolean; hasInclusions: boolean }>;
  if (activeResults.length === 0) return true;
  if (activeResults.some(r => r.exclusionMatch)) return false;
  const activeInclusions = activeResults.filter(r => r.hasInclusions);
  if (activeInclusions.length > 0) return activeInclusions.every(r => r.inclusionMatch);
  return true;
}

/**
 * Tag-group filter section with 3-state include/exclude chips and the
 * AND/OR/XOR group-mode toggles. Lifted out of FilterBar's default
 * content so pages with mixed filter axes (SpellList, SpellListManager
 * — sources + level + school + tag groups + activation + range + ...)
 * can embed it inside their custom `renderFilters` without losing the
 * rich tag UX. ClassList's filter modal still goes through FilterBar's
 * default content path, which routes through this same component.
 *
 * Hierarchical layout: roots get their own chip-row; subtags get an
 * indented chip-row directly under their parent with a thin gold left-
 * border. Mirrors the SpellTagPicker layout from the subtag rollout.
 * Orphaned subtags (parent missing from the group's visible set) fall
 * to a separate amber-edged row.
 */
export interface TagGroupFilterProps {
  group: { id: string; name?: string };
  tags: Array<{ id: string; name: string; parent_tag_id?: string | null; parentTagId?: string | null }>;
  tagStates: Record<string, number>;
  setTagStates?: (val: any) => void;
  cycleTagState?: (tagId: string) => void;
  combineMode?: 'AND' | 'OR' | 'XOR';
  cycleGroupMode?: (groupId: string) => void;
  exclusionMode?: 'AND' | 'OR' | 'XOR';
  cycleExclusionMode?: (groupId: string) => void;
}

export function TagGroupFilter({
  group,
  tags,
  tagStates,
  setTagStates,
  cycleTagState,
  combineMode,
  cycleGroupMode,
  exclusionMode,
  cycleExclusionMode,
}: TagGroupFilterProps) {
  if (tags.length === 0) return null;
  const mode = combineMode || 'OR';
  const exMode = exclusionMode || 'OR';

  const idSet = new Set(tags.map(t => t.id));
  const getParent = (t: any): string | null => {
    const p = t?.parentTagId ?? t?.parent_tag_id ?? null;
    return p && idSet.has(p) ? p : null;
  };
  const roots = tags.filter(t => !getParent(t)).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const childrenByParent = new Map<string, any[]>();
  for (const t of tags) {
    const p = getParent(t);
    if (!p) continue;
    if (!childrenByParent.has(p)) childrenByParent.set(p, []);
    childrenByParent.get(p)!.push(t);
  }
  for (const arr of childrenByParent.values()) {
    arr.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }
  const orphans = tags.filter(t => {
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
        title={state === 0 ? 'Click to include' : state === 1 ? 'Click to exclude' : 'Click to clear'}
      >
        {String(tag.name)}
      </button>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-6 flex-wrap">
          <span className="h3-title uppercase text-ink">{group.name}</span>
          <div className="flex items-center gap-4">
            <Button
              size="sm"
              variant="outline"
              onClick={() => cycleGroupMode?.(group.id)}
              className="h-6 px-3 btn-gold text-[9px]"
              title="Inclusion logic: AND requires every included tag, OR requires any, XOR requires exactly one."
            >
              {mode}
            </Button>
            <div className="flex items-center gap-2">
              <span className="label-text text-blood/60">Exclusion Logic</span>
              <Button
                size="sm"
                onClick={() => cycleExclusionMode?.(group.id)}
                className="h-6 px-3 btn-danger"
                title="Exclusion logic for tags toggled to exclude (red)."
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
              tags.forEach(t => newStates[t.id] = 1);
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
              tags.forEach(t => delete newStates[t.id]);
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
}

/**
 * Generic single-axis filter (level / school / source / activation / range /
 * duration / shape / property). Same 3-state chip + AND/OR/XOR combinator +
 * Exclusion Logic vocabulary as <TagGroupFilter>, applied to a flat (non-
 * grouped) value list.
 *
 * For axes where the spell carries exactly one value (level, school,
 * source, bucket), AND across multiple include chips can never match and
 * XOR collapses to OR. The matcher is still correct under those modes;
 * the controls are exposed uniformly so authors don't have to learn
 * which axes "support" which combinator.
 */
export interface AxisFilterSectionProps<V extends string = string> {
  title: string;
  values: Array<{ value: V; label: string }>;
  /** value -> 0 (neutral, omit) | 1 (include) | 2 (exclude). */
  states: Record<string, number>;
  cycleState: (value: V) => void;
  combineMode?: 'AND' | 'OR' | 'XOR';
  cycleCombineMode?: () => void;
  exclusionMode?: 'AND' | 'OR' | 'XOR';
  cycleExclusionMode?: () => void;
  includeAll?: () => void;
  clearAll?: () => void;
}

export function AxisFilterSection<V extends string = string>({
  title,
  values,
  states,
  cycleState,
  combineMode,
  cycleCombineMode,
  exclusionMode,
  cycleExclusionMode,
  includeAll,
  clearAll,
}: AxisFilterSectionProps<V>) {
  if (values.length === 0) return null;
  const mode = combineMode || 'OR';
  const exMode = exclusionMode || 'OR';
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-6 flex-wrap">
          <span className="h3-title uppercase text-ink">{title}</span>
          <div className="flex items-center gap-4">
            <Button
              size="sm"
              variant="outline"
              onClick={cycleCombineMode}
              className="h-6 px-3 btn-gold text-[9px]"
              title="Inclusion logic: AND requires every include chip, OR any, XOR exactly one."
            >
              {mode}
            </Button>
            <div className="flex items-center gap-2">
              <span className="label-text text-blood/60">Exclusion Logic</span>
              <Button
                size="sm"
                onClick={cycleExclusionMode}
                className="h-6 px-3 btn-danger"
                title="Exclusion logic for tags toggled to exclude (red)."
              >
                {exMode}
              </Button>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {includeAll && (
            <>
              <button type="button" onClick={includeAll} className="label-text hover:underline">Include All</button>
              <span className="text-gold/20">|</span>
            </>
          )}
          {clearAll && (
            <button type="button" onClick={clearAll} className="label-text hover:underline">Clear</button>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {values.map(({ value, label }) => {
          const state = states[value] || 0;
          return (
            <button
              key={value}
              type="button"
              onClick={() => cycleState(value)}
              className={cn(
                'filter-tag',
                state === 1
                  ? 'btn-gold-solid border-gold shadow-lg shadow-gold/20'
                  : state === 2
                    ? 'btn-danger border-blood'
                    : 'btn-gold'
              )}
              title={state === 0 ? 'Click to include' : state === 1 ? 'Click to exclude' : 'Click to clear'}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

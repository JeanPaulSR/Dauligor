import React from 'react';
import { Search, Filter, X, ChevronDown, ChevronRight } from 'lucide-react';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Card } from '../ui/card';
import { cn } from '../../lib/utils';
import type { ReactNode } from 'react';

/**
 * Cross-section coordination for the filter modal — chip-label search
 * and Show All / Hide All bulk-collapse signals. Sections (Tag group
 * and Axis) subscribe via `useFilterBarContext()`; FilterBar provides
 * the value via <FilterBarContext.Provider>. Using context (not prop
 * drilling through `renderFilters`) keeps the consumer API unchanged
 * — pages still pass `renderFilters` as a plain ReactNode.
 *
 * `chipSearch` filters which chips render; case-insensitive substring
 * match against the chip label. Empty string means "show all".
 *
 * `hideAllVersion` / `showAllVersion` are monotonic counters. Sections
 * track them via useEffect; whenever the counter increments, the
 * section sets its internal `hidden` state to true / false respectively.
 * Use counters (not booleans) so sections can react every time the
 * button is clicked, even if state would otherwise be idempotent.
 */
type FilterBarContextValue = {
  chipSearch: string;
  hideAllVersion: number;
  showAllVersion: number;
};
const FilterBarContext = React.createContext<FilterBarContextValue>({
  chipSearch: '',
  hideAllVersion: 0,
  showAllVersion: 0,
});
function useFilterBarContext() {
  return React.useContext(FilterBarContext);
}

/**
 * Section-level state hook — internal `hidden` flag plus subscription
 * to the bulk Show All / Hide All counters from FilterBarContext.
 * Effects are guarded against the initial mount so opening the modal
 * doesn't collapse everything just because the counters happen to be
 * non-zero from a previous session.
 */
function useFilterSectionHidden(): [boolean, () => void] {
  const { hideAllVersion, showAllVersion } = useFilterBarContext();
  const [hidden, setHidden] = React.useState(false);
  const mounted = React.useRef(false);
  React.useEffect(() => {
    if (!mounted.current) return;
    setHidden(true);
  }, [hideAllVersion]);
  React.useEffect(() => {
    if (!mounted.current) return;
    setHidden(false);
  }, [showAllVersion]);
  React.useEffect(() => {
    mounted.current = true;
  }, []);
  return [hidden, () => setHidden((h) => !h)];
}

/** Case-insensitive substring match for chip-label filtering. */
function chipMatchesSearch(label: string, search: string): boolean {
  if (!search) return true;
  return String(label).toLowerCase().includes(search.toLowerCase());
}

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

  // Modal-scoped state: chip-label search box + Show All / Hide All
  // counters that sections subscribe to via FilterBarContext.
  const [chipSearch, setChipSearch] = React.useState('');
  const [hideAllVersion, setHideAllVersion] = React.useState(0);
  const [showAllVersion, setShowAllVersion] = React.useState(0);
  const ctxValue = React.useMemo<FilterBarContextValue>(() => ({
    chipSearch,
    hideAllVersion,
    showAllVersion,
  }), [chipSearch, hideAllVersion, showAllVersion]);

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
            <FilterBarContext.Provider value={ctxValue}>
              <div className="flex flex-col gap-3 p-5 border-b border-gold/10 bg-gold/5">
                <div className="flex items-center justify-between gap-4">
                  <div className="space-y-1">
                    <h2 className="h2-title uppercase text-ink">{filterTitle}</h2>
                    {filterSubtitle ? (
                      <p className="text-sm text-ink/55">{filterSubtitle}</p>
                    ) : null}
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setIsFilterOpen(false)} className="text-ink/40 hover:text-gold transition-colors">
                    <X className="w-5 h-5" />
                  </Button>
                </div>

                {/* Modal-wide affordances inspired by 5etools' filter
                    header: chip-label search filters which chips render
                    in every section; Show All / Hide All bulk-collapse
                    every section. Each section keeps its own collapsed
                    state but listens to the counters from
                    FilterBarContext to apply the bulk command. */}
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3 h-3 text-ink/30" />
                    <Input
                      placeholder="Filter chip labels…"
                      className="h-7 text-xs pl-8 bg-background/40 border-gold/15 focus:border-gold"
                      value={chipSearch}
                      onChange={(e) => setChipSearch(e.target.value)}
                    />
                    {chipSearch && (
                      <button
                        type="button"
                        onClick={() => setChipSearch('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-ink/40 hover:text-ink"
                        title="Clear chip search"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShowAllVersion((v) => v + 1)}
                    className="h-7 px-3 text-[10px] uppercase tracking-widest border-gold/20 text-ink/70 hover:bg-gold/5"
                    title="Expand every section"
                  >
                    Show All
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setHideAllVersion((v) => v + 1)}
                    className="h-7 px-3 text-[10px] uppercase tracking-widest border-gold/20 text-ink/70 hover:bg-gold/5"
                    title="Collapse every section to its header"
                  >
                    Hide All
                  </Button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-5 space-y-6 custom-scrollbar">
                {renderFilters || defaultFilterContent}
              </div>

              <div className="p-5 border-t border-gold/10 bg-gold/5 flex items-center justify-between">
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
            </FilterBarContext.Provider>
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
  // All hooks before any early returns — React rules.
  const { chipSearch } = useFilterBarContext();
  const [hidden, toggleHidden] = useFilterSectionHidden();
  // Per-parent expand state — `expandedParents` holds the parent ids
  // the user has manually opened. Parents with any non-neutral subtag
  // state are auto-expanded (`autoExpandedParents` below), so the user
  // never loses sight of an active subtag selection.
  const [expandedParents, setExpandedParents] = React.useState<Set<string>>(new Set());
  const toggleExpanded = (parentId: string) => {
    setExpandedParents(prev => {
      const next = new Set(prev);
      if (next.has(parentId)) next.delete(parentId);
      else next.add(parentId);
      return next;
    });
  };
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
    if (!chipMatchesSearch(String(tag.name), chipSearch)) return null;
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
    <div className="space-y-2">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={toggleHidden}
            className="flex items-center gap-1 text-ink/55 hover:text-gold transition-colors"
            title={hidden ? 'Expand section' : 'Collapse section'}
          >
            {hidden ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            <span className="h3-title uppercase text-ink">{group.name}</span>
          </button>
          {!hidden && (
            <div className="flex items-center gap-3">
              <Button
                size="sm"
                variant="outline"
                onClick={() => cycleGroupMode?.(group.id)}
                className="h-6 px-2 btn-gold text-[9px]"
                title="Inclusion logic: AND requires every included tag, OR requires any, XOR requires exactly one."
              >
                {mode}
              </Button>
              <div className="flex items-center gap-1.5">
                <span className="label-text text-blood/60">Excl</span>
                <Button
                  size="sm"
                  onClick={() => cycleExclusionMode?.(group.id)}
                  className="h-6 px-2 btn-danger text-[9px]"
                  title="Exclusion logic for tags toggled to exclude (red)."
                >
                  {exMode}
                </Button>
              </div>
            </div>
          )}
        </div>
        {!hidden && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                if (!setTagStates) return;
                const newStates: Record<string, number> = { ...tagStates };
                tags.forEach(t => newStates[t.id] = 1);
                setTagStates(newStates);
              }}
              className="label-text hover:underline"
              title="Set every chip to include"
            >
              All
            </button>
            <span className="text-gold/20">|</span>
            <button
              onClick={() => {
                if (!setTagStates) return;
                const newStates: Record<string, number> = { ...tagStates };
                tags.forEach(t => newStates[t.id] = 2);
                setTagStates(newStates);
              }}
              className="label-text hover:underline"
              title="Set every chip to exclude"
            >
              None
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
              title="Reset every chip to neutral"
            >
              Clear
            </button>
            <span className="text-gold/20">|</span>
            <button
              onClick={toggleHidden}
              className="label-text hover:underline"
              title="Collapse section"
            >
              Hide
            </button>
          </div>
        )}
      </div>
      {!hidden && (() => {
        // Auto-expand any parent whose subtag has a non-neutral state
        // OR matches the current chip search — otherwise that subtag
        // would be hidden and the user couldn't see why a filter is
        // active (or why their search seemingly missed something).
        const autoExpanded = new Set<string>();
        for (const t of tags) {
          const parent = getParent(t);
          if (!parent) continue;
          const state = tagStates[t.id] || 0;
          const matchesSearch = chipSearch && chipMatchesSearch(String(t.name), chipSearch);
          if (state !== 0 || matchesSearch) autoExpanded.add(parent);
        }
        const isExpanded = (rootId: string) =>
          expandedParents.has(rootId) || autoExpanded.has(rootId);

        // Filter roots by chipSearch but always keep a root visible
        // if it has any matching/active subtag — that's how the user
        // gets to the expanded subtag drawer below.
        const visibleRoots = roots.filter(r => {
          if (chipMatchesSearch(String(r.name), chipSearch)) return true;
          if (autoExpanded.has(r.id)) return true;
          return false;
        });

        if (visibleRoots.length === 0 && orphans.every(o => !chipMatchesSearch(String(o.name), chipSearch))) {
          return null;
        }

        return (
          <div className="space-y-2">
            {/* Roots flow horizontally in a single wrap-row. Each root
                that has subtags gets a small ▸/▾ button to its right,
                outside the chip itself so the chip's own click target
                continues to cycle the include/exclude state cleanly. */}
            <div className="flex flex-wrap items-center gap-1.5">
              {visibleRoots.map(root => {
                const rootChip = renderChip(root);
                const subtags = childrenByParent.get(root.id) || [];
                const hasSubtags = subtags.length > 0;
                const expanded = hasSubtags && isExpanded(root.id);
                return (
                  <span key={root.id} className="inline-flex items-center gap-0.5">
                    {/* rootChip can be null if it failed chipSearch but
                        a child matched (autoExpanded). Render a faint
                        placeholder pill so the expand affordance still
                        anchors visually. */}
                    {rootChip || (
                      <span className="filter-tag btn-gold opacity-40 cursor-default" title={`${root.name} (filtered out by chip search, expanded for matching subtag)`}>
                        {String(root.name)}
                      </span>
                    )}
                    {hasSubtags && (
                      <button
                        type="button"
                        onClick={() => toggleExpanded(root.id)}
                        className={cn(
                          'inline-flex items-center justify-center h-[22px] w-[18px] -ml-0.5 rounded border transition-colors',
                          expanded
                            ? 'border-gold/50 bg-gold/15 text-gold'
                            : 'border-gold/20 bg-background/40 text-ink/60 hover:border-gold/40 hover:text-gold'
                        )}
                        title={expanded ? `Hide ${root.name} subtags (${subtags.length})` : `Show ${root.name} subtags (${subtags.length})`}
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

            {/* Expanded subtag drawers. Each renders below the roots
                with the parent's name as the label so multiple
                expanded groups don't blur together. Mirrors the
                hierarchy intent of the old indented subtag rows but
                only shows up when the user asks for it. */}
            {visibleRoots.map(root => {
              if (!isExpanded(root.id)) return null;
              const subtags = childrenByParent.get(root.id) || [];
              const subtagChips = subtags
                .map(renderChip)
                .filter(Boolean);
              if (subtagChips.length === 0) return null;
              return (
                <div key={`drawer-${root.id}`} className="ml-3 pl-3 border-l border-gold/15 flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] uppercase tracking-widest text-ink/40 mr-1">{root.name}:</span>
                  {subtagChips}
                </div>
              );
            })}

            {/* Orphans (subtags whose parent is missing from this
                group's visible set) — keep their amber-edged row;
                always shown when any survive chipSearch. */}
            {orphans.length > 0 && (() => {
              const orphanChips = orphans.map(renderChip).filter(Boolean);
              if (orphanChips.length === 0) return null;
              return (
                <div className="ml-3 pl-3 border-l border-amber-500/30 flex flex-wrap items-center gap-1.5" title="Subtags whose parent is not in this group's visible tag set.">
                  <span className="text-[10px] uppercase tracking-widest text-amber-500/60 mr-1">Orphaned:</span>
                  {orphanChips}
                </div>
              );
            })()}
          </div>
        );
      })()}
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
  /** Optional: set every value's chip to state=2 (exclude). Pairs with
   *  includeAll/clearAll as the "None" preset. When omitted the
   *  section's header omits the None button. */
  excludeAll?: () => void;
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
  excludeAll,
}: AxisFilterSectionProps<V>) {
  // Hooks before early-return per React rules.
  const { chipSearch } = useFilterBarContext();
  const [hidden, toggleHidden] = useFilterSectionHidden();
  if (values.length === 0) return null;
  const mode = combineMode || 'OR';
  const exMode = exclusionMode || 'OR';
  const visibleValues = values.filter(({ label }) => chipMatchesSearch(label, chipSearch));
  // Hide the whole section if chip-search filters out every value.
  if (chipSearch && visibleValues.length === 0) return null;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={toggleHidden}
            className="flex items-center gap-1 text-ink/55 hover:text-gold transition-colors"
            title={hidden ? 'Expand section' : 'Collapse section'}
          >
            {hidden ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            <span className="h3-title uppercase text-ink">{title}</span>
          </button>
          {!hidden && (
            <div className="flex items-center gap-3">
              <Button
                size="sm"
                variant="outline"
                onClick={cycleCombineMode}
                className="h-6 px-2 btn-gold text-[9px]"
                title="Inclusion logic: AND requires every include chip, OR any, XOR exactly one."
              >
                {mode}
              </Button>
              <div className="flex items-center gap-1.5">
                <span className="label-text text-blood/60">Excl</span>
                <Button
                  size="sm"
                  onClick={cycleExclusionMode}
                  className="h-6 px-2 btn-danger text-[9px]"
                  title="Exclusion logic for chips toggled to exclude (red)."
                >
                  {exMode}
                </Button>
              </div>
            </div>
          )}
        </div>
        {!hidden && (
          <div className="flex items-center gap-2">
            {includeAll && (
              <>
                <button type="button" onClick={includeAll} className="label-text hover:underline" title="Set every chip to include">All</button>
                <span className="text-gold/20">|</span>
              </>
            )}
            {excludeAll && (
              <>
                <button type="button" onClick={excludeAll} className="label-text hover:underline" title="Set every chip to exclude">None</button>
                <span className="text-gold/20">|</span>
              </>
            )}
            {clearAll && (
              <>
                <button type="button" onClick={clearAll} className="label-text hover:underline" title="Reset every chip to neutral">Clear</button>
                <span className="text-gold/20">|</span>
              </>
            )}
            <button type="button" onClick={toggleHidden} className="label-text hover:underline" title="Collapse section">Hide</button>
          </div>
        )}
      </div>
      {!hidden && (
        <div className="flex flex-wrap gap-1.5">
          {visibleValues.map(({ value, label }) => {
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
      )}
    </div>
  );
}

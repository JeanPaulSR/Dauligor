import React from 'react';
import { Filter, X, RotateCcw } from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Card } from '../ui/card';
import { SearchInput } from '../ui/SearchInput';
import { cn } from '../../lib/utils';
import type { ReactNode } from 'react';

/**
 * Cross-section coordination for the filter modal — chip-label search
 * and Show All / Hide All bulk-collapse signals. SectionFilterPanel
 * (rendered inside `renderFilters`) subscribes via
 * `useFilterBarContext()`; FilterBar provides the value through
 * <FilterBarContext.Provider>. Using context (not prop drilling
 * through `renderFilters`) keeps the consumer API a single ReactNode.
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
// Exported so sibling components rendered inside FilterBar's
// `renderFilters` slot (e.g. SectionFilterPanel) can subscribe to
// the chip-label search + bulk Show All / Hide All counters without
// re-implementing the search input twice.
export function useFilterBarContext() {
  return React.useContext(FilterBarContext);
}

export interface FilterBarProps {
  /**
   * Hide the Filters button + axis modal entirely, leaving just the
   * search input + inline Reset. Useful for browsers (FeatList) that
   * decided per-axis filtering doesn't earn its space — the Reset
   * button still clears the search.
   */
  hideFilters?: boolean;
  search: string;
  setSearch: (val: string) => void;
  isFilterOpen: boolean;
  setIsFilterOpen: (val: boolean) => void;
  activeFilterCount: number;
  resetFilters: () => void;
  searchPlaceholder?: string;
  filterTitle?: string;
  filterSubtitle?: string;
  resetLabel?: string;
  /**
   * Label for the inline Reset button on the main filter row.
   * Defaults to "Reset". Override when the reset action is
   * meaningfully different on a specific page — e.g.,
   * SpellRulesEditor passes "Clear query" because there the
   * filter state IS the document being edited and "Reset" would
   * misleadingly imply "back to saved state."
   */
  resetInlineLabel?: string;
  /**
   * Hide the inline Reset button on the main row. The modal's own
   * "Reset" (in the filter panel header) still clears everything, so
   * compact hosts (e.g. the narrow Modular-Options browse panes) can
   * drop the redundant toolbar Reset without losing the affordance.
   * Defaults to false — every existing consumer keeps the inline Reset.
   */
  hideInlineReset?: boolean;
  renderFilters?: ReactNode;
  /**
   * Optional slot rendered to the right of the Filter button on the
   * same row as the search input. Used by pages that want page-level
   * actions (Settings, edit-mode entry points, result counts) inline
   * with the filter controls rather than in a separate header.
   * Children flex-shrink-0 and align center with the Filter button.
   */
  trailingActions?: ReactNode;
  /**
   * Optional slot rendered to the LEFT of the search input on the
   * main row. Used for navigation chips (Back button when arriving
   * scoped from another page, etc.). shrink-0 so the search input
   * still claims the remaining width.
   */
  leadingActions?: ReactNode;
}

export function FilterBar({
  hideFilters = false,
  search, setSearch,
  isFilterOpen, setIsFilterOpen,
  activeFilterCount,
  resetFilters,
  searchPlaceholder = 'Search...',
  filterTitle = 'Advanced Filters',
  filterSubtitle,
  resetLabel = 'Reset All Filters',
  resetInlineLabel = 'Reset',
  hideInlineReset = false,
  renderFilters,
  trailingActions,
  leadingActions,
}: FilterBarProps) {
  // Modal-scoped state: chip-label search box + Show All / Hide All
  // counters that sections subscribe to via FilterBarContext.
  const [chipSearch, setChipSearch] = React.useState('');
  const [hideAllVersion, setHideAllVersion] = React.useState(0);
  const [showAllVersion, setShowAllVersion] = React.useState(0);

  // Body-scroll lock while the modal is open. Sets `overflow: hidden`
  // on <body> on open and restores the prior value on close. Backdrop
  // clicks remain captured by the absolutely-positioned overlay
  // element (its onClick closes the modal) and chip / button clicks
  // inside the Card aren't affected — the lock only suppresses
  // scrolling, not pointer events.
  React.useEffect(() => {
    if (!isFilterOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isFilterOpen]);

  const ctxValue = React.useMemo<FilterBarContextValue>(() => ({
    chipSearch,
    hideAllVersion,
    showAllVersion,
  }), [chipSearch, hideAllVersion, showAllVersion]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-4 items-center bg-card p-2 rounded-lg border border-gold/15 shadow-sm">
        {leadingActions && (
          <div className="flex items-center gap-2 shrink-0">
            {leadingActions}
          </div>
        )}
        <SearchInput
          placeholder={searchPlaceholder}
          value={search}
          onChange={setSearch}
          wrapperClassName="flex-1 w-full"
        />
        {!hideFilters && (
          <Button
            variant={isFilterOpen ? "default" : "outline"}
            size="sm"
            onClick={() => setIsFilterOpen(true)}
            className={`h-8 gap-2 w-full sm:w-auto ${isFilterOpen ? 'bg-gold text-[var(--primary-foreground)]' : 'border-gold/25 text-gold hover:bg-gold/15'}`}
          >
            <Filter className="w-3 h-3" /> Filters
            {activeFilterCount > 0 && (
              // Bare numeric badge — no background pill, inherits the
              // button's text color so it reads as a count next to the
              // label rather than a chip. Override the default <Badge>
              // background/padding/border via `!` modifiers so the
              // component's own bg-primary etc. don't sneak back in.
              <Badge className="!bg-transparent !border-0 !p-0 !shadow-none text-current text-[10px] font-bold leading-none">
                {activeFilterCount}
              </Badge>
            )}
          </Button>
        )}
        {/* Inline Reset button. Always rendered so users know the
            affordance exists. When there's nothing to reset (no
            active filters, empty search) it dims to a disabled
            state so the visual signal matches the actual capability.
            One click clears both filters and the search box — same
            effect as opening the modal and clicking "Reset Filters"
            then clearing the search, but in one motion. */}
        {!hideInlineReset && (() => {
          const canReset = activeFilterCount > 0 || search.length > 0;
          return (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canReset}
              onClick={() => { resetFilters(); setSearch(''); }}
              className={cn(
                'h-8 gap-2 w-full sm:w-auto border-gold/25',
                canReset
                  ? 'text-ink/75 hover:bg-blood/5 hover:text-blood hover:border-blood/30'
                  : 'text-ink/35 cursor-not-allowed',
              )}
              title={canReset ? 'Clear search and all filters' : 'Nothing to reset'}
            >
              <RotateCcw className="w-3 h-3" /> {resetInlineLabel}
            </Button>
          );
        })()}
        {trailingActions && (
          // shrink-0 so the page-level actions (Settings, Spell Manager,
          // result count, etc.) keep their natural width when the search
          // input expands. They share the same horizontal row.
          <div className="flex items-center gap-2 shrink-0">
            {trailingActions}
          </div>
        )}
      </div>

      {!hideFilters && isFilterOpen && (
        // Outer container vertically centers the Card. Horizontal
        // padding remains so the Card doesn't touch screen edges on
        // narrow widths; vertical padding is dropped so the Card's
        // explicit h-[90vh] yields the requested 5vh top + 5vh
        // bottom margins on any viewport size.
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 sm:px-6 md:px-10">
          <div
            className="absolute inset-0 bg-ink/45 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={() => setIsFilterOpen(false)}
          />
          {/* `py-0 gap-0` overrides the Card primitive's default
              vertical padding + child gap so the modal body sits
              flush with the header (no dead-space band above
              "SOURCES" or below the last axis). */}
          <Card className="relative w-full max-w-4xl h-[90vh] overflow-hidden flex flex-col py-0 gap-0 border-gold/25 bg-card shadow-2xl animate-in zoom-in-95 duration-200 pointer-events-auto">
            <FilterBarContext.Provider value={ctxValue}>
              <div className="flex flex-col gap-3 p-5 border-b border-gold/15 bg-gold/5">
                <div className="flex items-center justify-between gap-4">
                  <div className="space-y-1">
                    <h2 className="h2-title uppercase text-ink">{filterTitle}</h2>
                    {filterSubtitle ? (
                      <p className="text-sm text-ink/55">{filterSubtitle}</p>
                    ) : null}
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setIsFilterOpen(false)} className="text-ink/45 hover:text-gold transition-colors">
                    <X className="w-5 h-5" />
                  </Button>
                </div>

                {/* Modal-wide affordances inspired by 5etools' filter
                    header: chip-label search filters which chips render
                    in every section; Show All / Hide All bulk-collapse
                    every section; Reset clears everything globally
                    (now lives at the top alongside the other controls
                    so users don't have to scroll for it). */}
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="relative flex-1 min-w-[200px]">
                    <SearchInput
                      placeholder="Filter tags…"
                      value={chipSearch}
                      onChange={setChipSearch}
                      size="sm"
                      className="h-7 bg-background/40 border-gold/15"
                    />
                    {chipSearch && (
                      <button
                        type="button"
                        onClick={() => setChipSearch('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-ink/45 hover:text-ink"
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
                    className="h-7 px-3 text-[10px] uppercase tracking-widest border-gold/25 text-ink/75 hover:bg-gold/5"
                    title="Expand every section"
                  >
                    Show All
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setHideAllVersion((v) => v + 1)}
                    className="h-7 px-3 text-[10px] uppercase tracking-widest border-gold/25 text-ink/75 hover:bg-gold/5"
                    title="Collapse every section to its header"
                  >
                    Hide All
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={resetFilters}
                    className="h-7 px-3 text-[10px] uppercase tracking-widest border-gold/25 text-ink/75 hover:bg-gold/5"
                    title="Clear every filter"
                  >
                    {resetLabel}
                  </Button>
                </div>
              </div>

              {/* No vertical padding on the body — the axis cards
                  inside already carry their own bottom-margin /
                  gap and the user asked for the wrapper itself to
                  be flush. Kept the horizontal padding so the
                  scrollbar doesn't sit flush against the wall. */}
              <div className="flex-1 overflow-y-auto px-5 custom-scrollbar space-y-2">
                {renderFilters}
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

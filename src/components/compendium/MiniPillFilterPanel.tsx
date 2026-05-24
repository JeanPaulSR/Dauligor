import React, { useMemo } from 'react';
import { Filter, X, Search, RotateCcw } from 'lucide-react';
import { Button } from '../ui/button';
import { SearchInput } from '../ui/SearchInput';
import { StatusEmblem } from '../ui/StatusEmblem';
import { cn } from '../../lib/utils';
import type { AxisState } from '../../hooks/useSpellFilters';

/**
 * Persistent mini-pill filter panel — production version of Variant E
 * from /mockup/filter-modal (the 5e.tools-inspired pattern). Lives
 * ABOVE the result list as an always-visible strip rather than behind
 * a modal trigger — that's the whole point of the variant: zero clicks
 * between "I want to filter on X" and "I click the X pill."
 *
 * State model
 * -----------
 * Reuses the existing `useSpellFilters` hook's tri-state record:
 * `0` (or missing) = off, `1` = include, `2` = exclude. The panel
 * doesn't own state — every interaction calls back through the
 * cyclers the caller passes in. That keeps the panel a thin renderer
 * over whatever filter state shape the consumer already has.
 *
 * Two pill flavours
 * -----------------
 * - kind: 'axis'  — state lives in `axisFilters[axisKey].states[value]`.
 *                   Click cycles via `cycleAxisState(axisKey, value)`.
 *                   Used for source / level / school / activation /
 *                   range / duration / shape / property.
 * - kind: 'tag'   — state lives in `tagStates[tagId]` directly (no
 *                   per-axis nesting because tags are flat in the
 *                   state model). Click cycles via `cycleTagState(tagId)`.
 *                   Each tag GROUP becomes its own row in the wall;
 *                   the caller bundles those rows by passing one
 *                   `kind: 'tag'` axis per group.
 *
 * Tri-state controls
 * ------------------
 * - Left click  → forward cycle: off → include(1) → exclude(2) → off
 * - Right click → reverse cycle: off → exclude(2) → include(1) → off
 *   (preventDefault on `onContextMenu` so the browser menu doesn't show)
 *
 * What's intentionally NOT in v1
 * ------------------------------
 * - Per-axis AND/OR/XOR combinators (the old `AxisFilterSection` exposes
 *   these; the pill wall defaults each axis to OR for both include and
 *   exclude). If a caller needs finer combinators they should keep the
 *   old FilterBar for that surface. A future "Advanced" modal slot
 *   could surface combinators per-axis here without changing the pill
 *   layout — the `trailingActions` slot is the natural mount point.
 * - Bulk Include-All / Exclude-All per axis (rarely used in practice;
 *   can come back as a long-press or shift-click affordance later).
 *
 * Sort + result-count are owned by the caller and passed in via slots
 * (`resultCount`, `trailingActions`). The panel itself only concerns
 * itself with the pill wall and the search box.
 */

export type MiniPillAxis = {
  /** Unique key. For 'axis' kind this is the axisFilters key
   *  (e.g. 'source'). For 'tag' kind it's a synthetic id used only
   *  for React's `key` prop (e.g. `tag-group:${groupId}`). */
  key: string;
  name: string;
  icon?: React.ComponentType<{ className?: string }>;
  values: Array<{ value: string; label: string; count?: number; title?: string }>;
  /**
   * Where the per-value state lives in the caller's filter shape.
   *   'axis' — read from `axisFilters[axisKey].states[value]`,
   *            cycle via `cycleAxisState(axisKey, value)`.
   *   'tag'  — read from `tagStates[value]` (value === tagId),
   *            cycle via `cycleTagState(value)`.
   */
  kind: 'axis' | 'tag';
  /** Only used when kind === 'axis' — defaults to `key` if omitted. */
  axisKey?: string;
};

export interface MiniPillFilterPanelProps {
  axes: MiniPillAxis[];
  axisFilters: Record<string, AxisState>;
  tagStates: Record<string, number>;
  cycleAxisState: (axisKey: string, value: string) => void;
  cycleAxisStateReverse: (axisKey: string, value: string) => void;
  cycleTagState: (tagId: string) => void;
  cycleTagStateReverse: (tagId: string) => void;

  search: string;
  setSearch: (v: string) => void;
  searchPlaceholder?: string;

  activeFilterCount: number;
  resetAll: () => void;

  /**
   * Pre-rendered "243 / 539 matches" badge (or whatever the caller
   * computes). Lives on the right side of the search row. Caller owns
   * the math because they know what "filtered" means in their context
   * (some pages exclude beyond-class spells, some don't, etc.).
   */
  resultCount?: React.ReactNode;

  /** Extra actions on the right side of the header row (Settings,
   *  per-page toggles, links to other pages, etc.). */
  trailingActions?: React.ReactNode;
  /** Extra actions on the left side (BackButton, etc.). */
  leadingActions?: React.ReactNode;

  /** Optional className on the outer wrapper. */
  className?: string;
}

/**
 * Match a pill's name or its axis name against the search query for
 * the dim-on-search affordance. Empty query = nothing dimmed.
 */
function matchesPillSearch(label: string, axisName: string, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return label.toLowerCase().includes(q) || axisName.toLowerCase().includes(q);
}

export function MiniPillFilterPanel({
  axes,
  axisFilters,
  tagStates,
  cycleAxisState,
  cycleAxisStateReverse,
  cycleTagState,
  cycleTagStateReverse,
  search,
  setSearch,
  searchPlaceholder = 'Search…',
  activeFilterCount,
  resetAll,
  resultCount,
  trailingActions,
  leadingActions,
  className,
}: MiniPillFilterPanelProps) {
  // Pre-compute the search-dim flag at the top of render so each pill
  // doesn't re-call `matchesPillSearch` independently. Tiny optimisation
  // but it keeps the per-pill render purely a state lookup.
  const queryLower = search.trim().toLowerCase();

  const includeCount = useMemo(() => {
    let n = 0;
    for (const axis of axes) {
      if (axis.kind === 'tag') {
        for (const v of axis.values) if (tagStates[v.value] === 1) n++;
      } else {
        const states = axisFilters[axis.axisKey ?? axis.key]?.states ?? {};
        for (const v of axis.values) if (states[v.value] === 1) n++;
      }
    }
    return n;
  }, [axes, axisFilters, tagStates]);

  const excludeCount = useMemo(() => {
    let n = 0;
    for (const axis of axes) {
      if (axis.kind === 'tag') {
        for (const v of axis.values) if (tagStates[v.value] === 2) n++;
      } else {
        const states = axisFilters[axis.axisKey ?? axis.key]?.states ?? {};
        for (const v of axis.values) if (states[v.value] === 2) n++;
      }
    }
    return n;
  }, [axes, axisFilters, tagStates]);

  return (
    <div className={cn('rounded-md border border-gold/15 bg-card/40', className)}>
      {/* Header row — search, counts, leading/trailing actions */}
      <div className="px-3 py-2 border-b border-gold/10 bg-gold/[0.03] flex items-center gap-2 flex-wrap">
        {leadingActions}
        <Filter className="w-3.5 h-3.5 text-gold/80 shrink-0" />
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={searchPlaceholder}
          className="h-8 min-w-[220px] flex-1"
        />
        {resultCount}
        {activeFilterCount > 0 && (
          <button
            type="button"
            onClick={resetAll}
            className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-ink/55 hover:text-blood px-2 py-1 rounded border border-gold/10 hover:border-blood/40 transition-colors"
            title={`Clear ${activeFilterCount} active filter${activeFilterCount === 1 ? '' : 's'}`}
          >
            <RotateCcw className="w-3 h-3" />
            Reset
          </button>
        )}
        {includeCount > 0 && (
          <StatusEmblem tone="success" size="sm" title={`${includeCount} include filter${includeCount === 1 ? '' : 's'}`}>
            +{includeCount}
          </StatusEmblem>
        )}
        {excludeCount > 0 && (
          <StatusEmblem tone="error" size="sm" title={`${excludeCount} exclude filter${excludeCount === 1 ? '' : 's'}`}>
            −{excludeCount}
          </StatusEmblem>
        )}
        {trailingActions ? <div className="ml-auto flex items-center gap-2 flex-wrap">{trailingActions}</div> : null}
      </div>

      {/* Pill wall — every axis, every value, simultaneously visible */}
      <div className="p-2 space-y-1.5">
        {axes.map(axis => {
          const Icon = axis.icon;
          const axisStates =
            axis.kind === 'axis'
              ? axisFilters[axis.axisKey ?? axis.key]?.states ?? {}
              : null;

          // Count active pills in this axis (for the per-axis header badge).
          let axisActive = 0;
          for (const v of axis.values) {
            const s = axis.kind === 'tag' ? tagStates[v.value] : axisStates![v.value];
            if (s) axisActive++;
          }

          return (
            <div key={axis.key} className="rounded border border-gold/10 bg-background/20 p-1.5">
              <div className="flex items-baseline gap-2 mb-1 px-0.5">
                {Icon ? <Icon className="w-3 h-3 text-ink/40 shrink-0" /> : null}
                <span className="text-[9px] uppercase tracking-[0.22em] text-ink/60 font-bold">{axis.name}</span>
                <span className="text-[9px] text-ink/30">{axis.values.length}</span>
                {axisActive > 0 && (
                  <span className="text-[9px] text-gold/70 font-bold">· {axisActive} active</span>
                )}
              </div>
              <div className="flex flex-wrap gap-1">
                {axis.values.map(v => {
                  const state =
                    axis.kind === 'tag' ? tagStates[v.value] : axisStates![v.value];
                  const dimmed = queryLower !== '' && !matchesPillSearch(v.label, axis.name, search);
                  return (
                    <button
                      key={v.value}
                      type="button"
                      onClick={() => {
                        if (axis.kind === 'tag') cycleTagState(v.value);
                        else cycleAxisState(axis.axisKey ?? axis.key, v.value);
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        if (axis.kind === 'tag') cycleTagStateReverse(v.value);
                        else cycleAxisStateReverse(axis.axisKey ?? axis.key, v.value);
                      }}
                      className={cn(
                        'inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide transition-colors select-none',
                        !state && 'border-gold/15 bg-card text-ink/55 hover:border-gold/40 hover:text-ink/90',
                        state === 1 && 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300',
                        state === 2 && 'border-blood/50 bg-blood/15 text-blood line-through',
                        dimmed && 'opacity-20',
                      )}
                      title={
                        v.title ??
                        (!state
                          ? `"${v.label}"\nLeft click: include\nRight click: exclude`
                          : state === 1
                            ? `Including "${v.label}"\nLeft click: exclude\nRight click: clear`
                            : `Excluding "${v.label}"\nLeft click: clear\nRight click: include`)
                      }
                    >
                      {state === 1 && <span className="text-emerald-400/80">+</span>}
                      {state === 2 && <span className="text-blood/70">−</span>}
                      <span>{v.label}</span>
                      {v.count !== undefined && !state && (
                        <span className="text-[8px] text-ink/30 ml-0.5">·{v.count}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Re-export named + default so callers can pick whichever import style
 * matches the rest of their file. Most existing compendium components
 * use named imports.
 */
export default MiniPillFilterPanel;

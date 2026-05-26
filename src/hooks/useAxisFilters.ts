import { useCallback, useMemo, useState } from 'react';

/**
 * Generic axis-filter state hook for the compendium browser pages.
 *
 * Bundles the ~120 LoC of tri-state cycler boilerplate that was
 * triplicated across SpellList / FeatList / ItemList into a single
 * hook that returns the state + every cycler the SectionFilterPanel
 * needs + a derived `activeFilterCount` + a `reset()`.
 *
 * Each "axis" is a named filter dimension (e.g. 'source', 'rarity',
 * 'itemType') whose per-value state is tri-state: 0 = off / not in
 * map, 1 = include, 2 = exclude. The cyclers mutate that map; the
 * combineMode + exclusionMode per-axis are tracked separately and
 * power the OR/AND/XOR buttons SectionFilterPanel renders next to
 * each axis header.
 *
 * Usage:
 *   const { axisFilters, cyclers, activeFilterCount, resetAll } =
 *     useAxisFilters(['source', 'rarity', 'itemType', 'property']);
 *
 *   // Pass `cyclers` (a stable bundle) to SectionFilterPanel via
 *   // the matching prop names. `axisFilters` flows in too so the
 *   // panel can read each axis's state.
 *
 * Generic over the axis-key string union for compile-time safety on
 * the `activeFilterCount` math.
 */

export type AxisState = {
  states: Record<string, number>;
  combineMode?: 'AND' | 'OR' | 'XOR';
  exclusionMode?: 'AND' | 'OR' | 'XOR';
};

export type AxisCyclers = {
  cycleAxisState: (axisKey: string, value: string) => void;
  cycleAxisStateReverse: (axisKey: string, value: string) => void;
  cycleAxisCombineMode: (axisKey: string) => void;
  cycleAxisCombineModeReverse: (axisKey: string) => void;
  cycleAxisExclusionMode: (axisKey: string) => void;
  cycleAxisExclusionModeReverse: (axisKey: string) => void;
  axisIncludeAll: (axisKey: string, values: readonly string[]) => void;
  axisExcludeAll: (axisKey: string, values: readonly string[]) => void;
  axisClear: (axisKey: string) => void;
};

export type UseAxisFiltersResult<TKey extends string = string> = {
  axisFilters: Record<string, AxisState>;
  setAxisFilters: React.Dispatch<React.SetStateAction<Record<string, AxisState>>>;
  cyclers: AxisCyclers;
  /** Sum of all per-value entries across the declared axis keys. */
  activeFilterCount: number;
  /** Wipes every axis back to empty state. */
  resetAll: () => void;
};

/**
 * @param axisKeys The full list of axis keys this page consumes. Used
 *   for the `activeFilterCount` summation — only states under these
 *   keys are tallied, so stale keys from a previous page navigation
 *   don't inflate the badge.
 */
export function useAxisFilters<TKey extends string>(
  axisKeys: readonly TKey[],
): UseAxisFiltersResult<TKey> {
  const [axisFilters, setAxisFilters] = useState<Record<string, AxisState>>({});

  // Forward cycle: off → include(1) → exclude(2) → off. Left-click
  // affordance in SectionFilterPanel.
  const cycleAxisState = useCallback((axisKey: string, value: string) => {
    setAxisFilters((prev) => {
      const cur = prev[axisKey] || { states: {} };
      const states: Record<string, number> = { ...cur.states };
      const s = states[value] || 0;
      const nextState = s === 0 ? 1 : s === 1 ? 2 : 0;
      if (nextState === 0) delete states[value];
      else states[value] = nextState;
      return { ...prev, [axisKey]: { ...cur, states } };
    });
  }, []);

  // Reverse cycle: off → exclude(2) → include(1) → off. Right-click
  // affordance — lets users jump straight to "exclude" without going
  // through "include" first.
  const cycleAxisStateReverse = useCallback((axisKey: string, value: string) => {
    setAxisFilters((prev) => {
      const cur = prev[axisKey] || { states: {} };
      const states: Record<string, number> = { ...cur.states };
      const s = states[value] || 0;
      const nextState = s === 0 ? 2 : s === 2 ? 1 : 0;
      if (nextState === 0) delete states[value];
      else states[value] = nextState;
      return { ...prev, [axisKey]: { ...cur, states } };
    });
  }, []);

  // Per-axis combinator cycle: OR → AND → XOR → OR. Controls how
  // multiple includes on the same axis combine (OR = any match wins,
  // AND = all must match, XOR = exactly one).
  const cycleAxisCombineMode = useCallback((axisKey: string) => {
    setAxisFilters((prev) => {
      const cur = prev[axisKey] || { states: {} };
      const m = (cur.combineMode || 'OR') as 'OR' | 'AND' | 'XOR';
      const next = m === 'OR' ? 'AND' : m === 'AND' ? 'XOR' : 'OR';
      return { ...prev, [axisKey]: { ...cur, combineMode: next } };
    });
  }, []);
  const cycleAxisCombineModeReverse = useCallback((axisKey: string) => {
    setAxisFilters((prev) => {
      const cur = prev[axisKey] || { states: {} };
      const m = (cur.combineMode || 'OR') as 'OR' | 'AND' | 'XOR';
      const next = m === 'OR' ? 'XOR' : m === 'XOR' ? 'AND' : 'OR';
      return { ...prev, [axisKey]: { ...cur, combineMode: next } };
    });
  }, []);

  // Exclusion combinator — same chain, but applies to how the
  // exclude state cells combine. Lets "exclude tag A AND tag B"
  // mean different things from "exclude tag A OR tag B".
  const cycleAxisExclusionMode = useCallback((axisKey: string) => {
    setAxisFilters((prev) => {
      const cur = prev[axisKey] || { states: {} };
      const m = (cur.exclusionMode || 'OR') as 'OR' | 'AND' | 'XOR';
      const next = m === 'OR' ? 'AND' : m === 'AND' ? 'XOR' : 'OR';
      return { ...prev, [axisKey]: { ...cur, exclusionMode: next } };
    });
  }, []);
  const cycleAxisExclusionModeReverse = useCallback((axisKey: string) => {
    setAxisFilters((prev) => {
      const cur = prev[axisKey] || { states: {} };
      const m = (cur.exclusionMode || 'OR') as 'OR' | 'AND' | 'XOR';
      const next = m === 'OR' ? 'XOR' : m === 'XOR' ? 'AND' : 'OR';
      return { ...prev, [axisKey]: { ...cur, exclusionMode: next } };
    });
  }, []);

  // Bulk axis controls. `axisIncludeAll` / `axisExcludeAll` set every
  // value in the axis to include/exclude (used by the per-axis
  // "all" / "none" buttons in SectionFilterPanel). `axisClear` resets
  // just that axis without touching combine/exclusion modes.
  const axisIncludeAll = useCallback((axisKey: string, values: readonly string[]) => {
    setAxisFilters((prev) => {
      const cur = prev[axisKey] || { states: {} };
      const states: Record<string, number> = { ...cur.states };
      for (const v of values) states[v] = 1;
      return { ...prev, [axisKey]: { ...cur, states } };
    });
  }, []);
  const axisExcludeAll = useCallback((axisKey: string, values: readonly string[]) => {
    setAxisFilters((prev) => {
      const cur = prev[axisKey] || { states: {} };
      const states: Record<string, number> = { ...cur.states };
      for (const v of values) states[v] = 2;
      return { ...prev, [axisKey]: { ...cur, states } };
    });
  }, []);
  const axisClear = useCallback((axisKey: string) => {
    setAxisFilters((prev) => {
      const cur = prev[axisKey] || { states: {} };
      return { ...prev, [axisKey]: { ...cur, states: {} } };
    });
  }, []);

  const resetAll = useCallback(() => setAxisFilters({}), []);

  // Derived active-filter count — sums only the axes this hook was
  // declared with. Stale entries from a previous page (e.g. a
  // class-scope filter that was removed) don't bloat the count.
  const activeFilterCount = useMemo(() => {
    let total = 0;
    for (const key of axisKeys) {
      total += Object.keys(axisFilters[key]?.states ?? {}).length;
    }
    return total;
  }, [axisFilters, axisKeys]);

  const cyclers = useMemo<AxisCyclers>(() => ({
    cycleAxisState,
    cycleAxisStateReverse,
    cycleAxisCombineMode,
    cycleAxisCombineModeReverse,
    cycleAxisExclusionMode,
    cycleAxisExclusionModeReverse,
    axisIncludeAll,
    axisExcludeAll,
    axisClear,
  }), [
    cycleAxisState,
    cycleAxisStateReverse,
    cycleAxisCombineMode,
    cycleAxisCombineModeReverse,
    cycleAxisExclusionMode,
    cycleAxisExclusionModeReverse,
    axisIncludeAll,
    axisExcludeAll,
    axisClear,
  ]);

  return { axisFilters, setAxisFilters, cyclers, activeFilterCount, resetAll };
}

import { useCallback, useMemo, useState } from 'react';
import {
  matchesSingleAxisFilter,
  matchesMultiAxisFilter,
  type ActivationBucket,
  type DurationBucket,
  type PropertyFilter,
  type RangeBucket,
  type RuleQuery,
  type ShapeBucket,
  type SpellMatchInput,
} from '../lib/spellFilters';
import { expandTagsWithAncestors } from '../lib/tagHierarchy';

/**
 * Shared filter state for any spell-browsing surface (manager, public list,
 * class detail tab). Owns the rich filter state — 3-state include/exclude
 * chips + per-section AND/OR/XOR + Exclusion Logic — matching the
 * /compendium/spells and /compendium/spell-rules vocabulary so authors learn
 * one control set across the compendium.
 *
 * Surfaces with extra filters (e.g., the manager's "show only on list" toggle)
 * own those locally and apply them to the result of `filter()`.
 */
export type AxisState = {
  states: Record<string, number>;
  combineMode?: 'AND' | 'OR' | 'XOR';
  exclusionMode?: 'AND' | 'OR' | 'XOR';
};

export type UseSpellFiltersResult = {
  // Search
  search: string;
  setSearch: (v: string) => void;

  // Rich per-axis state (source / level / school / activation / range /
  // duration / shape / property). Each axis's state lives under its key
  // in this single record.
  axisFilters: Record<string, AxisState>;
  cycleAxisState: (axisKey: string, value: string) => void;
  cycleAxisCombineMode: (axisKey: string) => void;
  cycleAxisExclusionMode: (axisKey: string) => void;
  axisIncludeAll: (axisKey: string, values: readonly string[]) => void;
  axisClear: (axisKey: string) => void;
  removeAxisValue: (axisKey: string, value: string) => void;

  // Rich tag state (per-group AND/OR/XOR combinators + per-tag 3-state).
  tagStates: Record<string, number>;
  setTagStates: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  cycleTagState: (tagId: string) => void;
  groupCombineModes: Record<string, 'AND' | 'OR' | 'XOR'>;
  cycleGroupMode: (groupId: string) => void;
  groupExclusionModes: Record<string, 'AND' | 'OR' | 'XOR'>;
  cycleExclusionMode: (groupId: string) => void;

  // Derived
  activeFilterCount: number;
  resetAll: () => void;

  // Filter function — returns predicate-passing entries with the matched tag names.
  // `tagsById` value type optionally carries `parent_tag_id` / `parentTagId`
  // so the hook can build a hierarchy map and treat tag matching as
  // subtag-aware (parent matches its descendants). Also carries the
  // tag's `group_id` / `groupId` so per-group AND/OR/XOR can bucket
  // chips correctly when the rich tagStates path is in use.
  filter: <S extends FilterableSpell>(
    spells: S[],
    tagsById: Record<string, { name: string; group_id?: string | null; groupId?: string | null; parent_tag_id?: string | null; parentTagId?: string | null }>,
  ) => FilteredEntry<S>[];
};

export type FilterableSpell = SpellMatchInput & {
  id: string;
  name: string;
};

export type FilteredEntry<S extends FilterableSpell = FilterableSpell> = {
  spell: S;
  /** Tag names that the search query matched on (for display as "via tag: …"). */
  matchedTagNames: string[];
};

export function useSpellFilters(): UseSpellFiltersResult {
  const [search, setSearch] = useState('');
  const [axisFilters, setAxisFilters] = useState<Record<string, AxisState>>({});
  const [tagStates, setTagStates] = useState<Record<string, number>>({});
  const [groupCombineModes, setGroupCombineModes] = useState<Record<string, 'AND' | 'OR' | 'XOR'>>({});
  const [groupExclusionModes, setGroupExclusionModes] = useState<Record<string, 'AND' | 'OR' | 'XOR'>>({});

  const cycleAxisState = useCallback((axisKey: string, value: string) => {
    setAxisFilters(prev => {
      const cur = prev[axisKey] || { states: {} };
      const states: Record<string, number> = { ...cur.states };
      const s = states[value] || 0;
      const nextState = s === 0 ? 1 : s === 1 ? 2 : 0;
      if (nextState === 0) delete states[value];
      else states[value] = nextState;
      return { ...prev, [axisKey]: { ...cur, states } };
    });
  }, []);
  const cycleAxisCombineMode = useCallback((axisKey: string) => {
    setAxisFilters(prev => {
      const cur = prev[axisKey] || { states: {} };
      const m = (cur.combineMode || 'OR') as 'OR' | 'AND' | 'XOR';
      const next = m === 'OR' ? 'AND' : m === 'AND' ? 'XOR' : 'OR';
      return { ...prev, [axisKey]: { ...cur, combineMode: next } };
    });
  }, []);
  const cycleAxisExclusionMode = useCallback((axisKey: string) => {
    setAxisFilters(prev => {
      const cur = prev[axisKey] || { states: {} };
      const m = (cur.exclusionMode || 'OR') as 'OR' | 'AND' | 'XOR';
      const next = m === 'OR' ? 'AND' : m === 'AND' ? 'XOR' : 'OR';
      return { ...prev, [axisKey]: { ...cur, exclusionMode: next } };
    });
  }, []);
  const axisIncludeAll = useCallback((axisKey: string, values: readonly string[]) => {
    setAxisFilters(prev => {
      const cur = prev[axisKey] || { states: {} };
      const states: Record<string, number> = { ...cur.states };
      for (const v of values) states[v] = 1;
      return { ...prev, [axisKey]: { ...cur, states } };
    });
  }, []);
  const axisClear = useCallback((axisKey: string) => {
    setAxisFilters(prev => {
      const cur = prev[axisKey] || { states: {} };
      return { ...prev, [axisKey]: { ...cur, states: {} } };
    });
  }, []);
  const removeAxisValue = useCallback((axisKey: string, value: string) => {
    setAxisFilters(prev => {
      const cur = prev[axisKey] || { states: {} };
      const states: Record<string, number> = { ...cur.states };
      delete states[value];
      return { ...prev, [axisKey]: { ...cur, states } };
    });
  }, []);

  const cycleTagState = useCallback((tagId: string) => {
    setTagStates(prev => {
      const next = { ...prev };
      const state = next[tagId] || 0;
      if (state === 0) next[tagId] = 1;
      else if (state === 1) next[tagId] = 2;
      else delete next[tagId];
      return next;
    });
  }, []);
  const cycleGroupMode = useCallback((groupId: string) => {
    setGroupCombineModes(prev => {
      const cur = prev[groupId] || 'OR';
      const nextMode = cur === 'OR' ? 'AND' : cur === 'AND' ? 'XOR' : 'OR';
      return { ...prev, [groupId]: nextMode };
    });
  }, []);
  const cycleExclusionMode = useCallback((groupId: string) => {
    setGroupExclusionModes(prev => {
      const cur = prev[groupId] || 'OR';
      const nextMode = cur === 'OR' ? 'AND' : cur === 'AND' ? 'XOR' : 'OR';
      return { ...prev, [groupId]: nextMode };
    });
  }, []);

  const activeFilterCount =
    Object.keys(axisFilters.source?.states ?? {}).length
    + Object.keys(axisFilters.level?.states ?? {}).length
    + Object.keys(axisFilters.school?.states ?? {}).length
    + Object.keys(tagStates).length
    + Object.keys(axisFilters.activation?.states ?? {}).length
    + Object.keys(axisFilters.range?.states ?? {}).length
    + Object.keys(axisFilters.duration?.states ?? {}).length
    + Object.keys(axisFilters.shape?.states ?? {}).length
    + Object.keys(axisFilters.property?.states ?? {}).length;

  const resetAll = useCallback(() => {
    setAxisFilters({});
    setTagStates({});
    setGroupCombineModes({});
    setGroupExclusionModes({});
  }, []);

  const filter = useCallback(<S extends FilterableSpell>(
    spells: S[],
    tagsById: Record<string, { name: string; group_id?: string | null; groupId?: string | null; parent_tag_id?: string | null; parentTagId?: string | null }>,
  ): FilteredEntry<S>[] => {
    const q = search.trim().toLowerCase();
    // Build the tag hierarchy + group lookups from the tagsById dict.
    // Same shape <TagGroupFilter> + matchesTagFilters consume.
    const parentByTagId = new Map<string, string | null>();
    const groupByTagId = new Map<string, string | null>();
    for (const tagId of Object.keys(tagsById)) {
      const tag = tagsById[tagId];
      parentByTagId.set(tagId, (tag?.parent_tag_id ?? tag?.parentTagId ?? null) as string | null);
      groupByTagId.set(tagId, (tag?.group_id ?? tag?.groupId ?? null) as string | null);
    }

    const out: FilteredEntry<S>[] = [];
    for (const s of spells) {
      // Per-axis rich matching.
      if (!matchesSingleAxisFilter(String(s.source_id ?? ''), axisFilters.source)) continue;
      if (!matchesSingleAxisFilter(String(s.level), axisFilters.level)) continue;
      if (!matchesSingleAxisFilter(s.school, axisFilters.school)) continue;
      if (!matchesSingleAxisFilter(s.activationBucket, axisFilters.activation)) continue;
      if (!matchesSingleAxisFilter(s.rangeBucket, axisFilters.range)) continue;
      if (!matchesSingleAxisFilter(s.durationBucket, axisFilters.duration)) continue;
      if (!matchesSingleAxisFilter(s.shapeBucket, axisFilters.shape)) continue;
      const propsHave = new Set<string>();
      if ((s as any).concentration) propsHave.add('concentration');
      if ((s as any).ritual) propsHave.add('ritual');
      if ((s as any).vocal) propsHave.add('vocal');
      if ((s as any).somatic) propsHave.add('somatic');
      if ((s as any).material) propsHave.add('material');
      if (!matchesMultiAxisFilter(propsHave, axisFilters.property)) continue;

      // Rich tag matching — same algorithm as matchesTagFilters in
      // FilterBar, with subtag-aware ancestor expansion baked in.
      if (Object.keys(tagStates).length > 0) {
        const effective = new Set(expandTagsWithAncestors(s.tags, parentByTagId));
        const includesByGroup = new Map<string, string[]>();
        const excludesByGroup = new Map<string, string[]>();
        for (const [tagId, state] of Object.entries(tagStates)) {
          if (state !== 1 && state !== 2) continue;
          const groupId = groupByTagId.get(tagId);
          if (!groupId) continue;
          const bucket = state === 1 ? includesByGroup : excludesByGroup;
          if (!bucket.has(groupId)) bucket.set(groupId, []);
          bucket.get(groupId)!.push(tagId);
        }
        let ok = true;
        for (const [groupId, excludedIds] of excludesByGroup) {
          if (!ok) break;
          const matchCount = excludedIds.filter(tid => effective.has(tid)).length;
          const mode = groupExclusionModes[groupId] || 'OR';
          let excluded = false;
          if (mode === 'OR') excluded = matchCount > 0;
          else if (mode === 'AND') excluded = matchCount === excludedIds.length;
          else excluded = matchCount === 1;
          if (excluded) ok = false;
        }
        if (ok) {
          for (const [groupId, includedIds] of includesByGroup) {
            const matchCount = includedIds.filter(tid => effective.has(tid)).length;
            const mode = groupCombineModes[groupId] || 'OR';
            let included = false;
            if (mode === 'OR') included = matchCount > 0;
            else if (mode === 'AND') included = matchCount === includedIds.length;
            else included = matchCount === 1;
            if (!included) { ok = false; break; }
          }
        }
        if (!ok) continue;
      }

      const matchedTagNames: string[] = [];
      if (q) {
        const nameMatch = s.name.toLowerCase().includes(q);
        for (const tagId of s.tags) {
          const tagName = tagsById[tagId]?.name;
          if (tagName && tagName.toLowerCase().includes(q)) matchedTagNames.push(tagName);
        }
        if (!nameMatch && matchedTagNames.length === 0) continue;
      }
      out.push({ spell: s, matchedTagNames });
    }
    return out;
  }, [search, axisFilters, tagStates, groupCombineModes, groupExclusionModes]);

  return {
    search, setSearch,
    axisFilters,
    cycleAxisState,
    cycleAxisCombineMode,
    cycleAxisExclusionMode,
    axisIncludeAll,
    axisClear,
    removeAxisValue,
    tagStates, setTagStates,
    cycleTagState,
    groupCombineModes,
    cycleGroupMode,
    groupExclusionModes,
    cycleExclusionMode,
    activeFilterCount,
    resetAll,
    filter,
  };
}

// Suppress unused-type warning on RuleQuery import (kept for export
// shape consistency with future callers that want to serialize the
// filter state into a saveable rule).
export type { RuleQuery };

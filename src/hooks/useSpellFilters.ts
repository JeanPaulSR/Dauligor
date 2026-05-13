import { useCallback, useMemo, useState } from 'react';
import {
  type ActivationBucket,
  type DurationBucket,
  type PropertyFilter,
  type RangeBucket,
  type RuleQuery,
  type SpellMatchInput,
} from '../lib/spellFilters';
import { expandTagsWithAncestors } from '../lib/tagHierarchy';

/**
 * Shared filter state for any spell-browsing surface (manager, public list,
 * class detail tab). Owns the eight standard filter arrays + search string,
 * exposes a single `filter(spells)` function, and reports active counts.
 *
 * Surfaces with extra filters (e.g., the manager's "show only on list" toggle)
 * own those locally and apply them to the result of `filter()`.
 */
export type UseSpellFiltersResult = {
  // State
  search: string;
  setSearch: (v: string) => void;
  sourceFilterIds: string[];
  setSourceFilterIds: React.Dispatch<React.SetStateAction<string[]>>;
  levelFilters: string[];
  setLevelFilters: React.Dispatch<React.SetStateAction<string[]>>;
  schoolFilters: string[];
  setSchoolFilters: React.Dispatch<React.SetStateAction<string[]>>;
  tagFilterIds: string[];
  setTagFilterIds: React.Dispatch<React.SetStateAction<string[]>>;
  activationFilters: ActivationBucket[];
  setActivationFilters: React.Dispatch<React.SetStateAction<ActivationBucket[]>>;
  rangeFilters: RangeBucket[];
  setRangeFilters: React.Dispatch<React.SetStateAction<RangeBucket[]>>;
  durationFilters: DurationBucket[];
  setDurationFilters: React.Dispatch<React.SetStateAction<DurationBucket[]>>;
  propertyFilters: PropertyFilter[];
  setPropertyFilters: React.Dispatch<React.SetStateAction<PropertyFilter[]>>;

  // Derived
  query: RuleQuery;
  activeFilterCount: number;
  resetAll: () => void;

  // Filter function — returns predicate-passing entries with the matched tag names.
  // `tagsById` value type optionally carries `parent_tag_id` / `parentTagId`
  // so the hook can build a hierarchy map and treat tag matching as
  // subtag-aware (parent matches its descendants). Callers without
  // hierarchy info still work — matching falls back to flat .includes().
  filter: <S extends FilterableSpell>(
    spells: S[],
    tagsById: Record<string, { name: string; parent_tag_id?: string | null; parentTagId?: string | null }>,
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
  const [sourceFilterIds, setSourceFilterIds] = useState<string[]>([]);
  const [levelFilters, setLevelFilters] = useState<string[]>([]);
  const [schoolFilters, setSchoolFilters] = useState<string[]>([]);
  const [tagFilterIds, setTagFilterIds] = useState<string[]>([]);
  const [activationFilters, setActivationFilters] = useState<ActivationBucket[]>([]);
  const [rangeFilters, setRangeFilters] = useState<RangeBucket[]>([]);
  const [durationFilters, setDurationFilters] = useState<DurationBucket[]>([]);
  const [propertyFilters, setPropertyFilters] = useState<PropertyFilter[]>([]);

  const activeFilterCount =
    sourceFilterIds.length
    + levelFilters.length
    + schoolFilters.length
    + tagFilterIds.length
    + activationFilters.length
    + rangeFilters.length
    + durationFilters.length
    + propertyFilters.length;

  const query: RuleQuery = useMemo(() => ({
    sourceFilterIds, levelFilters, schoolFilters, tagFilterIds,
    activationFilters, rangeFilters, durationFilters, propertyFilters,
  }), [sourceFilterIds, levelFilters, schoolFilters, tagFilterIds, activationFilters, rangeFilters, durationFilters, propertyFilters]);

  const resetAll = useCallback(() => {
    setSourceFilterIds([]);
    setLevelFilters([]);
    setSchoolFilters([]);
    setTagFilterIds([]);
    setActivationFilters([]);
    setRangeFilters([]);
    setDurationFilters([]);
    setPropertyFilters([]);
  }, []);

  const filter = useCallback(<S extends FilterableSpell>(
    spells: S[],
    tagsById: Record<string, { name: string; parent_tag_id?: string | null; parentTagId?: string | null }>,
  ): FilteredEntry<S>[] => {
    const q = search.trim().toLowerCase();
    // Hierarchy map for subtag-aware tag matching. Built once per
    // filter() call; map size is bounded by the tag catalog (low
    // hundreds typically). When `tagsById` rows lack parent info, the
    // map is effectively empty and matching degrades to flat
    // `.includes()` exactly as before.
    const parentByTagId = new Map<string, string | null>();
    for (const tagId of Object.keys(tagsById)) {
      const tag = tagsById[tagId];
      parentByTagId.set(tagId, (tag?.parent_tag_id ?? tag?.parentTagId ?? null) as string | null);
    }
    const out: FilteredEntry<S>[] = [];
    for (const s of spells) {
      if (levelFilters.length > 0 && !levelFilters.includes(String(s.level))) continue;
      if (schoolFilters.length > 0 && !schoolFilters.includes(s.school)) continue;
      if (sourceFilterIds.length > 0 && !sourceFilterIds.includes(String(s.source_id ?? ''))) continue;
      if (tagFilterIds.length > 0) {
        const effective = new Set(expandTagsWithAncestors(s.tags, parentByTagId));
        if (!tagFilterIds.every(tid => effective.has(tid))) continue;
      }
      if (activationFilters.length > 0 && !activationFilters.includes(s.activationBucket)) continue;
      if (rangeFilters.length > 0 && !rangeFilters.includes(s.rangeBucket)) continue;
      if (durationFilters.length > 0 && !durationFilters.includes(s.durationBucket)) continue;
      if (propertyFilters.length > 0 && !propertyFilters.every(p => Boolean((s as any)[p]))) continue;

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
  }, [search, sourceFilterIds, levelFilters, schoolFilters, tagFilterIds, activationFilters, rangeFilters, durationFilters, propertyFilters]);

  return {
    search, setSearch,
    sourceFilterIds, setSourceFilterIds,
    levelFilters, setLevelFilters,
    schoolFilters, setSchoolFilters,
    tagFilterIds, setTagFilterIds,
    activationFilters, setActivationFilters,
    rangeFilters, setRangeFilters,
    durationFilters, setDurationFilters,
    propertyFilters, setPropertyFilters,
    query,
    activeFilterCount,
    resetAll,
    filter,
  };
}

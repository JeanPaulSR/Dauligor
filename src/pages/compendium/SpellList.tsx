import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Wand2, Lock } from 'lucide-react';
import { expandTagsWithAncestors, normalizeTagRow } from '../../lib/tagHierarchy';
import { fetchCollection } from '../../lib/d1';
import { Database, CloudOff } from 'lucide-react';
import { SCHOOL_LABELS } from '../../lib/spellImport';
import { cn } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { FilterBar, TagGroupFilter, AxisFilterSection, matchesTagFilters } from '../../components/compendium/FilterBar';
import SpellDetailPanel from '../../components/compendium/SpellDetailPanel';
import VirtualizedList from '../../components/ui/VirtualizedList';
import { fetchSpellSummaries, type SpellSummaryRecord } from '../../lib/spellSummary';
import {
  ACTIVATION_LABELS,
  ACTIVATION_ORDER,
  DURATION_LABELS,
  DURATION_ORDER,
  PROPERTY_LABELS,
  PROPERTY_ORDER,
  RANGE_LABELS,
  RANGE_ORDER,
  SHAPE_LABELS,
  SHAPE_ORDER,
  deriveSpellFilterFacets,
  matchesSingleAxisFilter,
  matchesMultiAxisFilter,
  type ActivationBucket,
  type DurationBucket,
  type PropertyFilter,
  type RangeBucket,
  type ShapeBucket,
} from '../../lib/spellFilters';

type SourceRecord = {
  id: string;
  name?: string;
  abbreviation?: string;
  shortName?: string;
  [key: string]: any;
};

type TagGroupRecord = {
  id: string;
  name?: string;
  classifications?: string[];
  [key: string]: any;
};

type TagRecord = {
  id: string;
  name?: string;
  groupId?: string;
  [key: string]: any;
};

type SpellRecord = {
  id: string;
  name?: string;
  level?: number;
  school?: string;
  sourceId?: string;
  description?: string;
  imageUrl?: string;
  tagIds?: string[];
  foundryImport?: Record<string, any>;
  foundryShell?: Record<string, any>;
  foundryDocument?: Record<string, any>;
  [key: string]: any;
};

const SPELL_LIST_HEIGHT = 820;
const SPELL_ROW_HEIGHT = 78;

const LEVEL_OPTIONS = [
  { value: 'all', label: 'All Levels' },
  { value: '0', label: 'Cantrips' },
  ...Array.from({ length: 9 }, (_, index) => ({ value: String(index + 1), label: `Level ${index + 1}` }))
];

const SCHOOL_OPTIONS = [
  { value: 'all', label: 'All Schools' },
  ...Object.entries(SCHOOL_LABELS).map(([value, label]) => ({ value, label }))
];

export default function SpellList({ userProfile }: { userProfile: any }) {
  const [spells, setSpells] = useState<SpellSummaryRecord[]>([]);
  const [sources, setSources] = useState<SourceRecord[]>([]);
  const [tagGroups, setTagGroups] = useState<TagGroupRecord[]>([]);
  const [allTags, setAllTags] = useState<TagRecord[]>([]);
  const [loadingSpells, setLoadingSpells] = useState(true);
  const [search, setSearch] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  // `?focus=<id>` deep-links to a specific spell — used by [ref|spell|<id>]
  // BBCode cross-references rendered elsewhere in the app. We read the
  // param once on mount and seed selection from it. Identifier-based
  // (slug) matching takes priority over raw ID; falls back to ID for
  // legacy/migration cases where the param is the row UUID.
  const [searchParams] = useSearchParams();
  const focusParam = searchParams.get('focus') || '';
  const [selectedSpellId, setSelectedSpellId] = useState('');
  // Live filter state — rich AxisFilter shape per axis (3-state chips
  // + per-axis include AND/OR/XOR + Exclusion Logic), uniform with the
  // SpellRulesEditor RuleQuery shape. One state object keyed by axis
  // name keeps the 8 useState calls cohesive and the updaters a one-
  // liner each.
  type AxisState = { states: Record<string, number>; combineMode?: 'AND' | 'OR' | 'XOR'; exclusionMode?: 'AND' | 'OR' | 'XOR' };
  const [axisFilters, setAxisFilters] = useState<Record<string, AxisState>>({});
  // Rich tag filter state. tagStates: 0=neutral, 1=include, 2=exclude.
  // `groupCombineModes` controls how multiple include chips within one
  // group combine (AND/OR/XOR). Same for `groupExclusionModes`.
  const [tagStates, setTagStates] = useState<Record<string, number>>({});
  const [groupCombineModes, setGroupCombineModes] = useState<Record<string, 'AND' | 'OR' | 'XOR'>>({});
  const [groupExclusionModes, setGroupExclusionModes] = useState<Record<string, 'AND' | 'OR' | 'XOR'>>({});
  const [isFoundationUsingD1, setIsFoundationUsingD1] = useState(false);

  useEffect(() => {
    const loadSpells = async () => {
      setLoadingSpells(true);
      try {
        const records = await fetchSpellSummaries('name ASC');
        
        const mapped = records.map(row => ({
          ...row,
          sourceId: row.source_id,
          imageUrl: row.image_url,
          tagIds: typeof row.tags === 'string' ? JSON.parse(row.tags) : (row.tags ?? []),
          foundryShell: typeof row.foundry_data === 'string' ? JSON.parse(row.foundry_data) : (row.foundry_data ?? null),
          ...deriveSpellFilterFacets(row),
        }));

        setSpells(mapped);
        setLoadingSpells(false);
      } catch (err) {
        console.error("Error loading spells:", err);
        setLoadingSpells(false);
      }
    };

    loadSpells();

    const loadFoundation = async () => {
      try {
        const [sourcesData, tagGroupsData, tagsData] = await Promise.all([
          fetchCollection<any>('sources', { orderBy: 'name ASC' }),
          fetchCollection<any>('tagGroups', { where: "classifications LIKE '%spell%'" }),
          fetchCollection<any>('tags', { orderBy: 'name ASC' })
        ]);

        setSources(sourcesData);
        setTagGroups(tagGroupsData);
        // Normalize tag rows (snake_case D1 columns -> camelCase the
        // TagGroupFilter / hierarchical layout expects). Same coercion
        // as ClassList. Without this, tagsByGroup's `tag.groupId`
        // lookup is undefined for every row and no tag filter chips
        // render at all.
        setAllTags(tagsData.map((t: any) => ({ ...t, ...normalizeTagRow(t) })));

        if (sourcesData.length > 0) setIsFoundationUsingD1(true);
      } catch (err) {
        console.error("[SpellList] Error loading foundation data:", err);
        setIsFoundationUsingD1(false);
      }
    };

    loadFoundation();

    return () => {
    };
  }, []);

  const sourceById = useMemo(() => Object.fromEntries(sources.map((source) => [source.id, source])), [sources]);
  const tagsByGroup = useMemo(() => {
    const map: Record<string, TagRecord[]> = {};
    for (const tag of allTags) {
      if (!tag.groupId) continue;
      if (!map[tag.groupId]) map[tag.groupId] = [];
      map[tag.groupId].push(tag);
    }
    return map;
  }, [allTags]);
  // Subtag-aware tag filter: a spell tagged `Conjure.Manifest` is
  // treated as also carrying its ancestor `Conjure`, so a filter
  // selection on `Conjure` matches the subtag-tagged spell. See
  // src/lib/tagHierarchy.ts.
  const parentByTagId = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const tag of allTags) {
      map.set(tag.id, ((tag as any).parent_tag_id ?? (tag as any).parentTagId ?? null) as string | null);
    }
    return map;
  }, [allTags]);

  const filteredSpells = useMemo(() => {
    return spells.filter((spell: any) => {
      const sourceRecord = sourceById[String(spell.sourceId ?? '')];
      // Source abbreviation falls back to the Foundry-native publication
      // metadata in the system block (`system.source.book`) when no
      // Dauligor source row matches. `foundryShell` is the parsed
      // foundry_data column (see mapped row above).
      const sourceAbbrev = String(
        sourceRecord?.abbreviation
        || sourceRecord?.shortName
        || spell.foundryShell?.source?.book
        || ''
      ).trim();
      const spellTagIds = Array.isArray(spell.tagIds) ? spell.tagIds : [];
      const matchesSearch = !search.trim()
        || String(spell.name ?? '').toLowerCase().includes(search.trim().toLowerCase())
        || sourceAbbrev.toLowerCase().includes(search.trim().toLowerCase())
        || String(spell.identifier ?? '').toLowerCase().includes(search.trim().toLowerCase());

      // Subtag-aware effective tag set: expand the spell's tags with
      // their ancestors so a filter on `Conjure` matches spells tagged
      // `Conjure.Manifest`. Then route through the shared
      // include/exclude + AND/OR/XOR matcher used by every list page.
      const effectiveTagIds = Array.from(expandTagsWithAncestors(spellTagIds, parentByTagId));
      const tagFilterMatches = matchesTagFilters(
        effectiveTagIds,
        tagGroups,
        tagsByGroup,
        tagStates,
        groupCombineModes,
        groupExclusionModes,
      );

      // Properties live on the spell row as booleans (concentration,
      // ritual, vocal, somatic, material). Collect into a Set for the
      // multi-valued axis matcher.
      const propsHave = new Set<string>();
      if (spell.concentration) propsHave.add('concentration');
      if (spell.ritual) propsHave.add('ritual');
      if (spell.vocal) propsHave.add('vocal');
      if (spell.somatic) propsHave.add('somatic');
      if (spell.material) propsHave.add('material');

      return matchesSearch
        && matchesSingleAxisFilter(String(spell.sourceId ?? ''), axisFilters.source)
        && matchesSingleAxisFilter(String(Number(spell.level ?? 0)), axisFilters.level)
        && matchesSingleAxisFilter(String(spell.school ?? ''), axisFilters.school)
        && tagFilterMatches
        && matchesSingleAxisFilter(spell.activationBucket, axisFilters.activation)
        && matchesSingleAxisFilter(spell.rangeBucket, axisFilters.range)
        && matchesSingleAxisFilter(spell.durationBucket, axisFilters.duration)
        && matchesSingleAxisFilter(spell.shapeBucket, axisFilters.shape)
        && matchesMultiAxisFilter(propsHave, axisFilters.property);
    });
  }, [spells, sourceById, search, axisFilters, tagStates, tagGroups, tagsByGroup, groupCombineModes, groupExclusionModes, parentByTagId]);

  useEffect(() => {
    if (!selectedSpellId) return;
    if (!filteredSpells.some((spell) => spell.id === selectedSpellId)) {
      setSelectedSpellId('');
    }
  }, [filteredSpells, selectedSpellId]);

  // Resolve `?focus=<id-or-identifier>` once spells have loaded.
  // BBCode `[ref|spell|<id>]` cross-references land here — `<id>` is
  // typically the slug-style `identifier` column (e.g. "fire-bolt") so
  // we try that first, then fall back to row UUID for completeness.
  // Runs once per focusParam change; `selectedSpellId` is intentionally
  // not in the deps so we don't fight user clicks after the deep-link
  // takes effect.
  useEffect(() => {
    if (!focusParam || loadingSpells) return;
    const target = spells.find(
      (s) => s.identifier === focusParam || s.id === focusParam
    );
    if (target) setSelectedSpellId(target.id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusParam, loadingSpells, spells]);

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

  // Per-axis updaters. Each is a one-liner that updates the AxisState
  // for `axisKey` in the unified axisFilters record. Replaces the
  // previous 8 single-array toggleSelection / setActivationFilters /
  // … calls with one uniform API.
  const cycleAxisState = (axisKey: string, value: string) => {
    setAxisFilters(prev => {
      const cur = prev[axisKey] || { states: {} };
      const states: Record<string, number> = { ...cur.states };
      const s = states[value] || 0;
      const nextState = s === 0 ? 1 : s === 1 ? 2 : 0;
      if (nextState === 0) delete states[value];
      else states[value] = nextState;
      return { ...prev, [axisKey]: { ...cur, states } };
    });
  };
  const cycleAxisCombineMode = (axisKey: string) => {
    setAxisFilters(prev => {
      const cur = prev[axisKey] || { states: {} };
      const m = (cur.combineMode || 'OR') as 'OR' | 'AND' | 'XOR';
      const next = m === 'OR' ? 'AND' : m === 'AND' ? 'XOR' : 'OR';
      return { ...prev, [axisKey]: { ...cur, combineMode: next } };
    });
  };
  const cycleAxisExclusionMode = (axisKey: string) => {
    setAxisFilters(prev => {
      const cur = prev[axisKey] || { states: {} };
      const m = (cur.exclusionMode || 'OR') as 'OR' | 'AND' | 'XOR';
      const next = m === 'OR' ? 'AND' : m === 'AND' ? 'XOR' : 'OR';
      return { ...prev, [axisKey]: { ...cur, exclusionMode: next } };
    });
  };
  const axisIncludeAll = (axisKey: string, values: readonly string[]) => {
    setAxisFilters(prev => {
      const cur = prev[axisKey] || { states: {} };
      const states: Record<string, number> = { ...cur.states };
      for (const v of values) states[v] = 1;
      return { ...prev, [axisKey]: { ...cur, states } };
    });
  };
  const axisClear = (axisKey: string) => {
    setAxisFilters(prev => {
      const cur = prev[axisKey] || { states: {} };
      return { ...prev, [axisKey]: { ...cur, states: {} } };
    });
  };

  // 3-state cycle: 0 (neutral, not in record) -> 1 (include) -> 2 (exclude) -> 0
  const cycleTagState = (tagId: string) => {
    setTagStates(prev => {
      const next = { ...prev };
      const state = next[tagId] || 0;
      if (state === 0) next[tagId] = 1;
      else if (state === 1) next[tagId] = 2;
      else delete next[tagId];
      return next;
    });
  };
  const cycleGroupMode = (groupId: string) => {
    setGroupCombineModes(prev => {
      const cur = prev[groupId] || 'OR';
      const nextMode = cur === 'OR' ? 'AND' : cur === 'AND' ? 'XOR' : 'OR';
      return { ...prev, [groupId]: nextMode };
    });
  };
  const cycleExclusionMode = (groupId: string) => {
    setGroupExclusionModes(prev => {
      const cur = prev[groupId] || 'OR';
      const nextMode = cur === 'OR' ? 'AND' : cur === 'AND' ? 'XOR' : 'OR';
      return { ...prev, [groupId]: nextMode };
    });
  };

  const renderSourceAbbreviation = (spell: SpellRecord) => {
    const sourceRecord = sourceById[String(spell.sourceId ?? '')];
    return sourceRecord?.abbreviation
      || sourceRecord?.shortName
      || (spell as any).foundryShell?.source?.book
      || '—';
  };

  const resetFilters = () => {
    setAxisFilters({});
    setTagStates({});
    setGroupCombineModes({});
    setGroupExclusionModes({});
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8 pb-20">
      <div className="flex flex-col gap-4 border-b border-gold/10 pb-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-3 text-gold">
            <Wand2 className="h-6 w-6" />
            <span className="text-xs font-bold uppercase tracking-[0.3em]">Compendium</span>
          </div>
          <div className="flex items-center gap-4">
            <h1 className="h1-title">Spell List</h1>
            {isFoundationUsingD1 ? (
              <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                <Database className="w-3.5 h-3.5 text-emerald-500" />
                <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest">Foundation Linked</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20">
                <CloudOff className="w-3.5 h-3.5 text-amber-500" />
                <span className="text-[10px] font-bold text-amber-500 uppercase tracking-widest">Legacy Foundation</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {userProfile?.role === 'admin' ? (
            <Link to="/compendium/spells/manage">
              <Button type="button" variant="outline" className="border-gold/20 text-gold hover:bg-gold/5">
                Spell Manager
              </Button>
            </Link>
          ) : null}
        </div>
      </div>

      <div className="space-y-4">
        <FilterBar
          search={search}
          setSearch={setSearch}
          isFilterOpen={filterOpen}
          setIsFilterOpen={setFilterOpen}
          activeFilterCount={activeFilterCount}
          resetFilters={resetFilters}
          searchPlaceholder="Search spell name, source, or identifier"
          filterTitle="Advanced Filters"
          resetLabel="Reset Filters"
          renderFilters={
            <>
              {/* Base filter sections — each gets 3-state include/exclude
                  chips plus per-section AND/OR/XOR (include combinator)
                  and Exclusion Logic (exclude combinator). Single-valued
                  axes (level/school/source/buckets) treat AND/XOR like
                  OR; multi-valued Properties uses the combinators
                  faithfully. Tags live in the Advanced Options
                  disclosure below the base filters. */}
              <AxisFilterSection
                title="Sources"
                values={sources.map((source) => ({ value: source.id, label: String(source.abbreviation || source.shortName || source.name || source.id) }))}
                states={axisFilters.source?.states || {}}
                cycleState={(v) => cycleAxisState('source', v)}
                combineMode={axisFilters.source?.combineMode}
                cycleCombineMode={() => cycleAxisCombineMode('source')}
                exclusionMode={axisFilters.source?.exclusionMode}
                cycleExclusionMode={() => cycleAxisExclusionMode('source')}
                includeAll={() => axisIncludeAll('source', sources.map((source) => source.id))}
                clearAll={() => axisClear('source')}
              />
              <AxisFilterSection
                title="Spell Level"
                values={LEVEL_OPTIONS.filter((entry) => entry.value !== 'all')}
                states={axisFilters.level?.states || {}}
                cycleState={(v) => cycleAxisState('level', v)}
                combineMode={axisFilters.level?.combineMode}
                cycleCombineMode={() => cycleAxisCombineMode('level')}
                exclusionMode={axisFilters.level?.exclusionMode}
                cycleExclusionMode={() => cycleAxisExclusionMode('level')}
                includeAll={() => axisIncludeAll('level', LEVEL_OPTIONS.filter((entry) => entry.value !== 'all').map((entry) => entry.value))}
                clearAll={() => axisClear('level')}
              />
              <AxisFilterSection
                title="Spell School"
                values={SCHOOL_OPTIONS.filter((entry) => entry.value !== 'all')}
                states={axisFilters.school?.states || {}}
                cycleState={(v) => cycleAxisState('school', v)}
                combineMode={axisFilters.school?.combineMode}
                cycleCombineMode={() => cycleAxisCombineMode('school')}
                exclusionMode={axisFilters.school?.exclusionMode}
                cycleExclusionMode={() => cycleAxisExclusionMode('school')}
                includeAll={() => axisIncludeAll('school', SCHOOL_OPTIONS.filter((entry) => entry.value !== 'all').map((entry) => entry.value))}
                clearAll={() => axisClear('school')}
              />
              <AxisFilterSection
                title="Casting Time"
                values={ACTIVATION_ORDER.map((b) => ({ value: b, label: ACTIVATION_LABELS[b] }))}
                states={axisFilters.activation?.states || {}}
                cycleState={(v) => cycleAxisState('activation', v)}
                combineMode={axisFilters.activation?.combineMode}
                cycleCombineMode={() => cycleAxisCombineMode('activation')}
                exclusionMode={axisFilters.activation?.exclusionMode}
                cycleExclusionMode={() => cycleAxisExclusionMode('activation')}
                includeAll={() => axisIncludeAll('activation', ACTIVATION_ORDER as readonly string[])}
                clearAll={() => axisClear('activation')}
              />
              <AxisFilterSection
                title="Range"
                values={RANGE_ORDER.map((b) => ({ value: b, label: RANGE_LABELS[b] }))}
                states={axisFilters.range?.states || {}}
                cycleState={(v) => cycleAxisState('range', v)}
                combineMode={axisFilters.range?.combineMode}
                cycleCombineMode={() => cycleAxisCombineMode('range')}
                exclusionMode={axisFilters.range?.exclusionMode}
                cycleExclusionMode={() => cycleAxisExclusionMode('range')}
                includeAll={() => axisIncludeAll('range', RANGE_ORDER as readonly string[])}
                clearAll={() => axisClear('range')}
              />
              <AxisFilterSection
                title="Shape"
                values={SHAPE_ORDER.map((b) => ({ value: b, label: SHAPE_LABELS[b] }))}
                states={axisFilters.shape?.states || {}}
                cycleState={(v) => cycleAxisState('shape', v)}
                combineMode={axisFilters.shape?.combineMode}
                cycleCombineMode={() => cycleAxisCombineMode('shape')}
                exclusionMode={axisFilters.shape?.exclusionMode}
                cycleExclusionMode={() => cycleAxisExclusionMode('shape')}
                includeAll={() => axisIncludeAll('shape', SHAPE_ORDER as readonly string[])}
                clearAll={() => axisClear('shape')}
              />
              <AxisFilterSection
                title="Duration"
                values={DURATION_ORDER.map((b) => ({ value: b, label: DURATION_LABELS[b] }))}
                states={axisFilters.duration?.states || {}}
                cycleState={(v) => cycleAxisState('duration', v)}
                combineMode={axisFilters.duration?.combineMode}
                cycleCombineMode={() => cycleAxisCombineMode('duration')}
                exclusionMode={axisFilters.duration?.exclusionMode}
                cycleExclusionMode={() => cycleAxisExclusionMode('duration')}
                includeAll={() => axisIncludeAll('duration', DURATION_ORDER as readonly string[])}
                clearAll={() => axisClear('duration')}
              />
              <AxisFilterSection
                title="Properties"
                values={PROPERTY_ORDER.map((p) => ({ value: p, label: PROPERTY_LABELS[p] }))}
                states={axisFilters.property?.states || {}}
                cycleState={(v) => cycleAxisState('property', v)}
                combineMode={axisFilters.property?.combineMode}
                cycleCombineMode={() => cycleAxisCombineMode('property')}
                exclusionMode={axisFilters.property?.exclusionMode}
                cycleExclusionMode={() => cycleAxisExclusionMode('property')}
                includeAll={() => axisIncludeAll('property', PROPERTY_ORDER as readonly string[])}
                clearAll={() => axisClear('property')}
              />

              {/* Tags + per-group combinators in a collapsible
                  Advanced Options block. Subtag-aware: each chip
                  toggle expands the spell's tag set with ancestors
                  before matching, so a `Conjure` include catches
                  spells tagged `Conjure.Manifest`. Hierarchical
                  parent-then-indented-subtag layout inside. */}
              <details className="group">
                <summary className="cursor-pointer list-none flex items-center justify-between border border-gold/15 rounded-md px-4 py-2 hover:border-gold/30 transition-colors">
                  <span className="text-xs font-bold uppercase tracking-[0.2em] text-gold/80">
                    Advanced Options — Tags
                    {Object.keys(tagStates).length > 0 && (
                      <span className="ml-2 text-gold/60">({Object.keys(tagStates).length} selected)</span>
                    )}
                  </span>
                  <span className="text-[10px] text-ink/40 group-open:rotate-90 transition-transform">▶</span>
                </summary>
                <div className="mt-4 space-y-6 pl-1">
                  {tagGroups.map((group) => (
                    <TagGroupFilter
                      key={group.id}
                      group={group}
                      tags={(tagsByGroup[group.id] || []) as any}
                      tagStates={tagStates}
                      setTagStates={setTagStates}
                      cycleTagState={cycleTagState}
                      combineMode={groupCombineModes[group.id]}
                      cycleGroupMode={cycleGroupMode}
                      exclusionMode={groupExclusionModes[group.id]}
                      cycleExclusionMode={cycleExclusionMode}
                    />
                  ))}
                </div>
              </details>
            </>
          }
        />

        <div className="grid gap-6 xl:grid-cols-[460px_minmax(0,1fr)]">
          <Card className="border-gold/10 bg-card/50 overflow-hidden">
            <CardContent className="p-0">
              <div className="grid grid-cols-[minmax(0,1fr)_80px_100px_70px] gap-3 border-b border-gold/10 bg-background/35 px-4 py-3 text-[10px] font-bold uppercase tracking-[0.2em] text-gold/70">
                <span>Name</span>
                <span>Level</span>
                <span>School</span>
                <span>Source</span>
              </div>
              {loadingSpells ? (
                <div className="px-6 py-12 text-center text-ink/45">
                  Loading spells...
                </div>
              ) : filteredSpells.length === 0 ? (
                <div className="px-6 py-12 text-center text-ink/45">
                  No spells match the current search and filters.
                </div>
                  ) : (
                <VirtualizedList
                  items={filteredSpells}
                  height={SPELL_LIST_HEIGHT}
                  itemHeight={SPELL_ROW_HEIGHT}
                  className="custom-scrollbar overflow-y-auto"
                  innerClassName="divide-y divide-gold/5"
                  renderItem={(spell) => {
                    const sourceLabel = renderSourceAbbreviation(spell);
                    const selected = selectedSpellId === spell.id;
                    return (
                      <button
                        key={spell.id}
                        type="button"
                        onClick={() => setSelectedSpellId(spell.id)}
                        className={cn(
                          'grid h-[78px] w-full grid-cols-[minmax(0,1fr)_80px_100px_70px] gap-3 px-4 py-3 text-left transition-colors',
                          selected ? 'bg-gold/10' : 'hover:bg-gold/5'
                        )}
                      >
                        <div className="min-w-0">
                          <div className="truncate font-serif text-lg text-ink flex items-center gap-1.5">
                            <span className="truncate">{spell.name}</span>
                            {(() => {
                              const reqTagIds = Array.isArray((spell as any).required_tags)
                                ? (spell as any).required_tags
                                : [];
                              const hasFreeText = !!(spell as any).prerequisite_text;
                              if (reqTagIds.length === 0 && !hasFreeText) return null;
                              const tagLabel = reqTagIds
                                .map(
                                  (tid: string) =>
                                    allTags.find((t: any) => t.id === tid)?.name || tid,
                                )
                                .join(', ');
                              const title = [
                                tagLabel ? `Requires: ${tagLabel}` : null,
                                hasFreeText
                                  ? `Note: ${(spell as any).prerequisite_text}`
                                  : null,
                              ]
                                .filter(Boolean)
                                .join(' · ');
                              return (
                                <span title={title} className="shrink-0 inline-flex">
                                  <Lock
                                    className="w-3 h-3 text-blood/70"
                                    aria-label="Has prerequisites"
                                  />
                                </span>
                              );
                            })()}
                          </div>
                        </div>
                        <div className="text-sm text-ink/75">{Number(spell.level ?? 0) === 0 ? 'Cantrip' : spell.level}</div>
                        <div className="text-sm text-ink/75">{SCHOOL_LABELS[String(spell.school ?? '')] || String(spell.school ?? '').toUpperCase()}</div>
                        <div className="text-sm font-bold text-gold/80">{sourceLabel}</div>
                      </button>
                    );
                  }}
                />
              )}
            </CardContent>
          </Card>

          <Card className="border-gold/10 bg-card/50 overflow-hidden">
            <CardContent className="p-0">
              <SpellDetailPanel spellId={selectedSpellId || null} />
            </CardContent>
          </Card>
        </div>
      </div>

    </div>
  );
}

// FilterSection (include-only chip row) was removed when every section
// migrated to the rich <AxisFilterSection> from FilterBar.tsx. Kept the
// removal record so future grep-blame doesn't go looking for "where did
// the simple component go" — the answer is "every section now has
// include/exclude + AND/OR/XOR via the shared component".

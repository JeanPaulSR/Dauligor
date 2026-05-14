import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Scroll, Lock, CloudOff, Database } from 'lucide-react';
import { fetchCollection } from '../../lib/d1';
import { cn } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { FilterBar, AxisFilterSection } from '../../components/compendium/FilterBar';
import { matchesSingleAxisFilter, matchesMultiAxisFilter } from '../../lib/spellFilters';
import FeatDetailPanel from '../../components/compendium/FeatDetailPanel';
import VirtualizedList from '../../components/ui/VirtualizedList';
import {
  FEAT_PROPERTY_LABELS,
  FEAT_PROPERTY_ORDER,
  FEAT_TYPE_LABELS,
  FEAT_TYPE_ORDER,
  deriveFeatPropertyFlags,
  type FeatPropertyFilter,
  type FeatTypeValue,
} from '../../lib/featFilters';

/**
 * Public feat browser. Mirrors `SpellList.tsx`'s structure exactly:
 * filter bar + master-detail grid + virtualized rows + lock-icon
 * prereq affordance. Admins see a "Feat Manager" button that links
 * to the admin editing surface at `/compendium/feats/manage`.
 *
 * Data flow: a single load at mount pulls every feat row plus the
 * sources table for the source-abbreviation lookup. Property facets
 * are derived once per row (see `deriveFeatPropertyFlags`) so the
 * filter chips can flip in O(1) per row instead of recomputing.
 */

type SourceRecord = {
  id: string;
  name?: string;
  abbreviation?: string;
  shortName?: string;
  [key: string]: any;
};

type FeatRow = {
  id: string;
  name?: string;
  identifier?: string;
  sourceId?: string;
  featType?: string;
  featSubtype?: string;
  repeatable?: boolean;
  requirements?: string;
  requirementsTree?: any;
  // Derived booleans the filter chips read against.
  repeatableFlag?: boolean;
  hasUses?: boolean;
  hasActivities?: boolean;
  hasEffects?: boolean;
  hasPrereqs?: boolean;
  [key: string]: any;
};

const FEAT_LIST_HEIGHT = 820;
const FEAT_ROW_HEIGHT = 78;

export default function FeatList({ userProfile }: { userProfile: any }) {
  const [feats, setFeats] = useState<FeatRow[]>([]);
  const [sources, setSources] = useState<SourceRecord[]>([]);
  const [loadingFeats, setLoadingFeats] = useState(true);
  const [search, setSearch] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedFeatId, setSelectedFeatId] = useState('');
  // Rich live filter state — uniform with the other compendium list
  // pages. Each axis: { states (chip 1=include / 2=exclude),
  // combineMode, exclusionMode } keyed by axis name.
  type AxisState = { states: Record<string, number>; combineMode?: 'AND' | 'OR' | 'XOR'; exclusionMode?: 'AND' | 'OR' | 'XOR' };
  const [axisFilters, setAxisFilters] = useState<Record<string, AxisState>>({});
  const [isFoundationUsingD1, setIsFoundationUsingD1] = useState(false);

  useEffect(() => {
    const loadFeats = async () => {
      setLoadingFeats(true);
      try {
        const rows = await fetchCollection<any>('feats', { orderBy: 'name ASC' });
        const mapped: FeatRow[] = rows.map((row: any) => {
          const flags = deriveFeatPropertyFlags(row);
          return {
            ...row,
            sourceId: row.source_id,
            featType: row.feat_type,
            featSubtype: row.feat_subtype || '',
            repeatable: !!row.repeatable,
            repeatableFlag: flags.repeatable,
            hasUses: flags.hasUses,
            hasActivities: flags.hasActivities,
            hasEffects: flags.hasEffects,
            hasPrereqs: flags.hasPrereqs,
          };
        });
        setFeats(mapped);
      } catch (err) {
        console.error('[FeatList] failed to load feats:', err);
      } finally {
        setLoadingFeats(false);
      }
    };

    const loadFoundation = async () => {
      try {
        const sourcesData = await fetchCollection<any>('sources', { orderBy: 'name ASC' });
        setSources(sourcesData);
        if (sourcesData.length > 0) setIsFoundationUsingD1(true);
      } catch (err) {
        console.error('[FeatList] failed to load foundation data:', err);
        setIsFoundationUsingD1(false);
      }
    };

    loadFeats();
    loadFoundation();
  }, []);

  const sourceById = useMemo(
    () => Object.fromEntries(sources.map((s) => [s.id, s])) as Record<string, SourceRecord>,
    [sources],
  );

  const filteredFeats = useMemo(() => {
    const lowered = search.trim().toLowerCase();
    return feats.filter((feat) => {
      const sourceRecord = sourceById[String(feat.sourceId ?? '')];
      const sourceAbbrev = String(
        sourceRecord?.abbreviation || sourceRecord?.shortName || '',
      ).toLowerCase();
      const matchesSearch =
        !lowered
        || String(feat.name ?? '').toLowerCase().includes(lowered)
        || String(feat.identifier ?? '').toLowerCase().includes(lowered)
        || String(feat.featSubtype ?? '').toLowerCase().includes(lowered)
        || sourceAbbrev.includes(lowered);

      // Properties are multi-valued — collect the flag set the feat
      // carries and route through the shared multi-axis matcher.
      // `repeatable` lives on `repeatableFlag` for legacy reasons; the
      // others are direct boolean column copies (see deriveFeatPropertyFlags).
      const propsHave = new Set<string>();
      for (const p of FEAT_PROPERTY_ORDER) {
        const flagKey = p === 'repeatable' ? 'repeatableFlag' : p;
        if ((feat as any)[flagKey]) propsHave.add(p);
      }
      return (
        matchesSearch
        && matchesSingleAxisFilter(String(feat.sourceId ?? ''), axisFilters.source)
        && matchesSingleAxisFilter(String(feat.featType ?? ''), axisFilters.type)
        && matchesMultiAxisFilter(propsHave, axisFilters.property)
      );
    });
  }, [feats, sourceById, search, axisFilters]);

  // Drop the selected feat if the active filter set hides it. Prevents
  // the detail pane from continuing to show a row the user can no longer
  // see in the list. Same protective effect SpellList has.
  useEffect(() => {
    if (!selectedFeatId) return;
    if (!filteredFeats.some((f) => f.id === selectedFeatId)) {
      setSelectedFeatId('');
    }
  }, [filteredFeats, selectedFeatId]);

  const activeFilterCount =
    Object.keys(axisFilters.source?.states ?? {}).length
    + Object.keys(axisFilters.type?.states ?? {}).length
    + Object.keys(axisFilters.property?.states ?? {}).length;

  // Per-axis updaters — same generic pattern every list page uses.
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
  const axisExcludeAll = (axisKey: string, values: readonly string[]) => {
    setAxisFilters(prev => {
      const cur = prev[axisKey] || { states: {} };
      const states: Record<string, number> = { ...cur.states };
      for (const v of values) states[v] = 2;
      return { ...prev, [axisKey]: { ...cur, states } };
    });
  };
  const axisClear = (axisKey: string) => {
    setAxisFilters(prev => {
      const cur = prev[axisKey] || { states: {} };
      return { ...prev, [axisKey]: { ...cur, states: {} } };
    });
  };

  const renderSourceAbbreviation = (feat: FeatRow) => {
    const sourceRecord = sourceById[String(feat.sourceId ?? '')];
    return sourceRecord?.abbreviation || sourceRecord?.shortName || '—';
  };

  const resetFilters = () => {
    setAxisFilters({});
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8 pb-20">
      <div className="flex flex-col gap-4 border-b border-gold/10 pb-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-3 text-gold">
            <Scroll className="h-6 w-6" />
            <span className="text-xs font-bold uppercase tracking-[0.3em]">Compendium</span>
          </div>
          <div className="flex items-center gap-4">
            <h1 className="h1-title">Feat List</h1>
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
            <Link to="/compendium/feats/manage">
              <Button type="button" variant="outline" className="border-gold/20 text-gold hover:bg-gold/5">
                Feat Manager
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
          searchPlaceholder="Search feat name, source, identifier, or subtype"
          filterTitle="Advanced Filters"
          resetLabel="Reset Filters"
          renderFilters={
            <>
              <AxisFilterSection
                title="Sources"
                values={sources.map((source) => ({ value: source.id, label: String(source.abbreviation || source.shortName || source.name || source.id) }))}
                states={axisFilters.source?.states || {}}
                cycleState={(v) => cycleAxisState('source', v)}
                combineMode={axisFilters.source?.combineMode}
                cycleCombineMode={() => cycleAxisCombineMode('source')}
                exclusionMode={axisFilters.source?.exclusionMode}
                cycleExclusionMode={() => cycleAxisExclusionMode('source')}
                includeAll={() => axisIncludeAll('source', sources.map(s => s.id))}
                excludeAll={() => axisExcludeAll('source', sources.map(s => s.id))}
                clearAll={() => axisClear('source')}
              />
              <AxisFilterSection
                title="Feat Type"
                values={FEAT_TYPE_ORDER.map((value) => ({ value, label: FEAT_TYPE_LABELS[value] }))}
                states={axisFilters.type?.states || {}}
                cycleState={(v) => cycleAxisState('type', v)}
                combineMode={axisFilters.type?.combineMode}
                cycleCombineMode={() => cycleAxisCombineMode('type')}
                exclusionMode={axisFilters.type?.exclusionMode}
                cycleExclusionMode={() => cycleAxisExclusionMode('type')}
                includeAll={() => axisIncludeAll('type', FEAT_TYPE_ORDER as readonly string[])}
                excludeAll={() => axisExcludeAll('type', FEAT_TYPE_ORDER as readonly string[])}
                clearAll={() => axisClear('type')}
              />
              <AxisFilterSection
                title="Properties"
                values={FEAT_PROPERTY_ORDER.map((value) => ({ value, label: FEAT_PROPERTY_LABELS[value] }))}
                states={axisFilters.property?.states || {}}
                cycleState={(v) => cycleAxisState('property', v)}
                combineMode={axisFilters.property?.combineMode}
                cycleCombineMode={() => cycleAxisCombineMode('property')}
                exclusionMode={axisFilters.property?.exclusionMode}
                cycleExclusionMode={() => cycleAxisExclusionMode('property')}
                includeAll={() => axisIncludeAll('property', FEAT_PROPERTY_ORDER as readonly string[])}
                excludeAll={() => axisExcludeAll('property', FEAT_PROPERTY_ORDER as readonly string[])}
                clearAll={() => axisClear('property')}
              />
            </>
          }
        />

        <div className="grid gap-6 xl:grid-cols-[460px_minmax(0,1fr)]">
          <Card className="border-gold/10 bg-card/50 overflow-hidden">
            <CardContent className="p-0">
              <div className="grid grid-cols-[minmax(0,1fr)_140px_70px] gap-3 border-b border-gold/10 bg-background/35 px-4 py-3 text-[10px] font-bold uppercase tracking-[0.2em] text-gold/70">
                <span>Name</span>
                <span>Type</span>
                <span>Source</span>
              </div>
              {loadingFeats ? (
                <div className="px-6 py-12 text-center text-ink/45">Loading feats...</div>
              ) : filteredFeats.length === 0 ? (
                <div className="px-6 py-12 text-center text-ink/45">
                  No feats match the current search and filters.
                </div>
              ) : (
                <VirtualizedList
                  items={filteredFeats}
                  height={FEAT_LIST_HEIGHT}
                  itemHeight={FEAT_ROW_HEIGHT}
                  className="custom-scrollbar overflow-y-auto"
                  innerClassName="divide-y divide-gold/5"
                  renderItem={(feat: FeatRow) => {
                    const sourceLabel = renderSourceAbbreviation(feat);
                    const selected = selectedFeatId === feat.id;
                    const valueLabel =
                      FEAT_TYPE_LABELS[feat.featType as FeatTypeValue]
                      || feat.featType
                      || 'Feat';
                    const subtype = String(feat.featSubtype || '').trim();
                    const typeLine = subtype ? `${valueLabel} · ${subtype}` : valueLabel;
                    return (
                      <button
                        key={feat.id}
                        type="button"
                        onClick={() => setSelectedFeatId(feat.id)}
                        className={cn(
                          'grid h-[78px] w-full grid-cols-[minmax(0,1fr)_140px_70px] gap-3 px-4 py-3 text-left transition-colors',
                          selected ? 'bg-gold/10' : 'hover:bg-gold/5',
                        )}
                      >
                        <div className="min-w-0">
                          <div className="truncate font-serif text-lg text-ink flex items-center gap-1.5">
                            <span className="truncate">{feat.name}</span>
                            {feat.hasPrereqs ? (
                              <span
                                title={
                                  feat.requirements
                                    ? `Note: ${feat.requirements}`
                                    : 'Has prerequisites'
                                }
                                className="shrink-0 inline-flex"
                              >
                                <Lock className="w-3 h-3 text-blood/70" aria-label="Has prerequisites" />
                              </span>
                            ) : null}
                            {feat.repeatable ? (
                              <span
                                title="Repeatable"
                                className="shrink-0 text-[9px] uppercase tracking-widest text-gold/60 font-bold"
                              >
                                ↻
                              </span>
                            ) : null}
                          </div>
                          <div className="truncate font-mono text-[10px] text-ink/40">
                            {feat.identifier || '(no identifier)'}
                          </div>
                        </div>
                        <div className="text-sm text-ink/75 truncate">{typeLine}</div>
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
              <FeatDetailPanel featId={selectedFeatId || null} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// FilterSection (include-only chip row) was removed when the page
// migrated to the rich AxisFilterSection from FilterBar.tsx. Kept the
// removal record so future grep-blame doesn't go looking for it.

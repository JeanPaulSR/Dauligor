import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Scroll, Lock, CloudOff, Database } from 'lucide-react';
import { fetchCollection } from '../../lib/d1';
import { cn } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { FilterBar } from '../../components/compendium/FilterBar';
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
  const [sourceFilterIds, setSourceFilterIds] = useState<string[]>([]);
  const [typeFilters, setTypeFilters] = useState<FeatTypeValue[]>([]);
  const [propertyFilters, setPropertyFilters] = useState<FeatPropertyFilter[]>([]);
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

      // The property filters are AND: a feat must satisfy every selected
      // property chip to pass. Type and source filters are OR within their
      // own list (multi-select OR) but AND across categories — same as
      // SpellList's semantics.
      const passesProperty = propertyFilters.every((p) => (feat as any)[p === 'repeatable' ? 'repeatableFlag' : p]);

      return (
        matchesSearch
        && (sourceFilterIds.length === 0 || sourceFilterIds.includes(String(feat.sourceId ?? '')))
        && (typeFilters.length === 0
          || typeFilters.includes(feat.featType as FeatTypeValue))
        && passesProperty
      );
    });
  }, [feats, sourceById, search, sourceFilterIds, typeFilters, propertyFilters]);

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
    sourceFilterIds.length + typeFilters.length + propertyFilters.length;

  const toggleSelection = <T extends string>(
    value: T,
    selected: T[],
    setSelected: React.Dispatch<React.SetStateAction<T[]>>,
  ) => {
    setSelected((current) =>
      current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value],
    );
  };

  const renderSourceAbbreviation = (feat: FeatRow) => {
    const sourceRecord = sourceById[String(feat.sourceId ?? '')];
    return sourceRecord?.abbreviation || sourceRecord?.shortName || '—';
  };

  const resetFilters = () => {
    setSourceFilterIds([]);
    setTypeFilters([]);
    setPropertyFilters([]);
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
              <FilterSection
                title="Sources"
                values={sources.map((source) => ({
                  value: source.id,
                  label: String(source.abbreviation || source.shortName || source.name || source.id),
                }))}
                selected={sourceFilterIds}
                onToggle={(value) => toggleSelection(value, sourceFilterIds, setSourceFilterIds)}
                onIncludeAll={() => setSourceFilterIds(sources.map((s) => s.id))}
                onClear={() => setSourceFilterIds([])}
              />

              <FilterSection
                title="Feat Type"
                values={FEAT_TYPE_ORDER.map((value) => ({ value, label: FEAT_TYPE_LABELS[value] }))}
                selected={typeFilters}
                onToggle={(value) =>
                  toggleSelection(
                    value as FeatTypeValue,
                    typeFilters as string[],
                    setTypeFilters as React.Dispatch<React.SetStateAction<string[]>>,
                  )
                }
                onIncludeAll={() => setTypeFilters([...FEAT_TYPE_ORDER])}
                onClear={() => setTypeFilters([])}
              />

              <FilterSection
                title="Properties"
                values={FEAT_PROPERTY_ORDER.map((value) => ({
                  value,
                  label: FEAT_PROPERTY_LABELS[value],
                }))}
                selected={propertyFilters}
                onToggle={(value) =>
                  toggleSelection(
                    value as FeatPropertyFilter,
                    propertyFilters as string[],
                    setPropertyFilters as React.Dispatch<React.SetStateAction<string[]>>,
                  )
                }
                onIncludeAll={() => setPropertyFilters([...FEAT_PROPERTY_ORDER])}
                onClear={() => setPropertyFilters([])}
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

// Lifted from SpellList.tsx (same internal helper there) — same chip
// row + Include All / Clear shortcuts. Local because the spell file's
// FilterSection isn't exported. If a third surface needs it, extract.
function FilterSection({
  title,
  values,
  selected,
  onToggle,
  onIncludeAll,
  onClear,
}: {
  title: string;
  values: { value: string; label: string }[];
  selected: string[];
  onToggle: (value: string) => void;
  onIncludeAll: () => void;
  onClear: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="h3-title uppercase text-ink">{title}</span>
        <div className="flex items-center gap-3">
          <button type="button" onClick={onIncludeAll} className="label-text hover:underline">
            Include All
          </button>
          <span className="text-gold/20">|</span>
          <button type="button" onClick={onClear} className="label-text hover:underline">
            Clear
          </button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {values.map((entry) => {
          const active = selected.includes(entry.value);
          return (
            <button
              key={entry.value}
              type="button"
              onClick={() => onToggle(entry.value)}
              className={cn(
                'filter-tag',
                active ? 'btn-gold-solid border-gold shadow-lg shadow-gold/20' : 'btn-gold',
              )}
            >
              {entry.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

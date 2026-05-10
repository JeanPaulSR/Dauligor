import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Wand2, Lock } from 'lucide-react';
import { fetchCollection } from '../../lib/d1';
import { Database, CloudOff } from 'lucide-react';
import { SCHOOL_LABELS } from '../../lib/spellImport';
import { cn } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { FilterBar } from '../../components/compendium/FilterBar';
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
  deriveSpellFilterFacets,
  type ActivationBucket,
  type DurationBucket,
  type PropertyFilter,
  type RangeBucket,
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
  const [selectedSpellId, setSelectedSpellId] = useState('');
  const [sourceFilterIds, setSourceFilterIds] = useState<string[]>([]);
  const [levelFilters, setLevelFilters] = useState<string[]>([]);
  const [schoolFilters, setSchoolFilters] = useState<string[]>([]);
  const [tagFilterIds, setTagFilterIds] = useState<string[]>([]);
  const [activationFilters, setActivationFilters] = useState<ActivationBucket[]>([]);
  const [rangeFilters, setRangeFilters] = useState<RangeBucket[]>([]);
  const [durationFilters, setDurationFilters] = useState<DurationBucket[]>([]);
  const [propertyFilters, setPropertyFilters] = useState<PropertyFilter[]>([]);
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
        setAllTags(tagsData);

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
  const filteredSpells = useMemo(() => {
    return spells.filter((spell: any) => {
      const sourceRecord = sourceById[String(spell.sourceId ?? '')];
      const sourceAbbrev = String(sourceRecord?.abbreviation || sourceRecord?.shortName || spell.foundryImport?.sourceBook || '').trim();
      const spellTagIds = Array.isArray(spell.tagIds) ? spell.tagIds : [];
      const matchesSearch = !search.trim()
        || String(spell.name ?? '').toLowerCase().includes(search.trim().toLowerCase())
        || sourceAbbrev.toLowerCase().includes(search.trim().toLowerCase())
        || String(spell.identifier ?? '').toLowerCase().includes(search.trim().toLowerCase());

      return matchesSearch
        && (sourceFilterIds.length === 0 || sourceFilterIds.includes(String(spell.sourceId ?? '')))
        && (levelFilters.length === 0 || levelFilters.includes(String(Number(spell.level ?? 0))))
        && (schoolFilters.length === 0 || schoolFilters.includes(String(spell.school ?? '')))
        && (tagFilterIds.length === 0 || tagFilterIds.every((tagId) => spellTagIds.includes(tagId)))
        && (activationFilters.length === 0 || activationFilters.includes(spell.activationBucket))
        && (rangeFilters.length === 0 || rangeFilters.includes(spell.rangeBucket))
        && (durationFilters.length === 0 || durationFilters.includes(spell.durationBucket))
        && (propertyFilters.length === 0 || propertyFilters.every((p) => spell[p]));
    });
  }, [spells, sourceById, search, sourceFilterIds, levelFilters, schoolFilters, tagFilterIds, activationFilters, rangeFilters, durationFilters, propertyFilters]);

  useEffect(() => {
    if (!selectedSpellId) return;
    if (!filteredSpells.some((spell) => spell.id === selectedSpellId)) {
      setSelectedSpellId('');
    }
  }, [filteredSpells, selectedSpellId]);

  const activeFilterCount =
    sourceFilterIds.length
    + levelFilters.length
    + schoolFilters.length
    + tagFilterIds.length
    + activationFilters.length
    + rangeFilters.length
    + durationFilters.length
    + propertyFilters.length;

  const toggleSelection = (value: string, selected: string[], setSelected: React.Dispatch<React.SetStateAction<string[]>>) => {
    setSelected((current) => current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value]);
  };

  const renderSourceAbbreviation = (spell: SpellRecord) => {
    const sourceRecord = sourceById[String(spell.sourceId ?? '')];
    return sourceRecord?.abbreviation
      || sourceRecord?.shortName
      || spell.foundryImport?.sourceBook
      || '—';
  };

  const resetFilters = () => {
    setSourceFilterIds([]);
    setLevelFilters([]);
    setSchoolFilters([]);
    setTagFilterIds([]);
    setActivationFilters([]);
    setRangeFilters([]);
    setDurationFilters([]);
    setPropertyFilters([]);
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
              <FilterSection
                title="Sources"
                values={sources.map((source) => ({
                  value: source.id,
                  label: String(source.abbreviation || source.shortName || source.name || source.id)
                }))}
                selected={sourceFilterIds}
                onToggle={(value) => toggleSelection(value, sourceFilterIds, setSourceFilterIds)}
                onIncludeAll={() => setSourceFilterIds(sources.map((source) => source.id))}
                onClear={() => setSourceFilterIds([])}
              />

              <FilterSection
                title="Spell Level"
                values={LEVEL_OPTIONS.filter((entry) => entry.value !== 'all')}
                selected={levelFilters}
                onToggle={(value) => toggleSelection(value, levelFilters, setLevelFilters)}
                onIncludeAll={() => setLevelFilters(LEVEL_OPTIONS.filter((entry) => entry.value !== 'all').map((entry) => entry.value))}
                onClear={() => setLevelFilters([])}
              />

              <FilterSection
                title="Spell School"
                values={SCHOOL_OPTIONS.filter((entry) => entry.value !== 'all')}
                selected={schoolFilters}
                onToggle={(value) => toggleSelection(value, schoolFilters, setSchoolFilters)}
                onIncludeAll={() => setSchoolFilters(SCHOOL_OPTIONS.filter((entry) => entry.value !== 'all').map((entry) => entry.value))}
                onClear={() => setSchoolFilters([])}
              />

              {tagGroups.map((group) => {
                const tags = tagsByGroup[group.id] || [];
                if (!tags.length) return null;
                return (
                  <FilterSection
                    key={group.id}
                    title={group.name || 'Tags'}
                    values={tags.map((tag) => ({ value: tag.id, label: String(tag.name || tag.id) }))}
                    selected={tagFilterIds}
                    onToggle={(value) => toggleSelection(value, tagFilterIds, setTagFilterIds)}
                    onIncludeAll={() => setTagFilterIds((current) => Array.from(new Set([...current, ...tags.map((tag) => tag.id)])))}
                    onClear={() => setTagFilterIds((current) => current.filter((tagId) => !tags.some((tag) => tag.id === tagId)))}
                  />
                );
              })}

              <FilterSection
                title="Casting Time"
                values={ACTIVATION_ORDER.map((b) => ({ value: b, label: ACTIVATION_LABELS[b] }))}
                selected={activationFilters}
                onToggle={(value) => toggleSelection(value as ActivationBucket, activationFilters as string[], setActivationFilters as React.Dispatch<React.SetStateAction<string[]>>)}
                onIncludeAll={() => setActivationFilters([...ACTIVATION_ORDER])}
                onClear={() => setActivationFilters([])}
              />

              <FilterSection
                title="Range"
                values={RANGE_ORDER.map((b) => ({ value: b, label: RANGE_LABELS[b] }))}
                selected={rangeFilters}
                onToggle={(value) => toggleSelection(value as RangeBucket, rangeFilters as string[], setRangeFilters as React.Dispatch<React.SetStateAction<string[]>>)}
                onIncludeAll={() => setRangeFilters([...RANGE_ORDER])}
                onClear={() => setRangeFilters([])}
              />

              <FilterSection
                title="Duration"
                values={DURATION_ORDER.map((b) => ({ value: b, label: DURATION_LABELS[b] }))}
                selected={durationFilters}
                onToggle={(value) => toggleSelection(value as DurationBucket, durationFilters as string[], setDurationFilters as React.Dispatch<React.SetStateAction<string[]>>)}
                onIncludeAll={() => setDurationFilters([...DURATION_ORDER])}
                onClear={() => setDurationFilters([])}
              />

              <FilterSection
                title="Properties"
                values={PROPERTY_ORDER.map((p) => ({ value: p, label: PROPERTY_LABELS[p] }))}
                selected={propertyFilters}
                onToggle={(value) => toggleSelection(value as PropertyFilter, propertyFilters as string[], setPropertyFilters as React.Dispatch<React.SetStateAction<string[]>>)}
                onIncludeAll={() => setPropertyFilters([...PROPERTY_ORDER])}
                onClear={() => setPropertyFilters([])}
              />
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

function FilterSection({
  title,
  values,
  selected,
  onToggle,
  onIncludeAll,
  onClear
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
          <button
            type="button"
            onClick={onIncludeAll}
            className="label-text hover:underline"
          >
            Include All
          </button>
          <span className="text-gold/20">|</span>
          <button
            type="button"
            onClick={onClear}
            className="label-text hover:underline"
          >
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
                active
                  ? 'btn-gold-solid border-gold shadow-lg shadow-gold/20'
                  : 'btn-gold'
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

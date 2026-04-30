import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, doc, getDoc, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { Wand2 } from 'lucide-react';
import { db } from '../../lib/firebase';
import { bbcodeToHtml } from '../../lib/bbcode';
import {
  formatActivationLabel,
  formatComponentsLabel,
  formatDurationLabel,
  formatFoundrySpellDescriptionForDisplay,
  formatRangeLabel,
  formatTargetLabel,
  SCHOOL_LABELS
} from '../../lib/spellImport';
import { cn } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { ScrollArea } from '../../components/ui/scroll-area';
import { FilterBar } from '../../components/compendium/FilterBar';
import SpellArtPreview from '../../components/compendium/SpellArtPreview';
import VirtualizedList from '../../components/ui/VirtualizedList';
import { subscribeSpellSummaries, type SpellSummaryRecord } from '../../lib/spellSummary';

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
  const isAdmin = userProfile?.role === 'admin';
  const [spells, setSpells] = useState<SpellSummaryRecord[]>([]);
  const [sources, setSources] = useState<SourceRecord[]>([]);
  const [tagGroups, setTagGroups] = useState<TagGroupRecord[]>([]);
  const [allTags, setAllTags] = useState<TagRecord[]>([]);
  const [search, setSearch] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedSpellId, setSelectedSpellId] = useState('');
  const [spellDetailsById, setSpellDetailsById] = useState<Record<string, SpellRecord>>({});
  const [loadingSelectedSpell, setLoadingSelectedSpell] = useState(false);
  const [sourceFilterIds, setSourceFilterIds] = useState<string[]>([]);
  const [levelFilters, setLevelFilters] = useState<string[]>([]);
  const [schoolFilters, setSchoolFilters] = useState<string[]>([]);
  const [tagFilterIds, setTagFilterIds] = useState<string[]>([]);

  useEffect(() => {
    const unsubscribeSpells = subscribeSpellSummaries(
      (records) => setSpells(records),
      (error) => console.error('Error loading spells:', error)
    );

    const unsubscribeSources = onSnapshot(
      query(collection(db, 'sources'), orderBy('name', 'asc')),
      (snapshot) => setSources(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })))
    );

    const unsubscribeTagGroups = onSnapshot(
      query(collection(db, 'tagGroups'), where('classifications', 'array-contains', 'spell')),
      (snapshot) => setTagGroups(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })))
    );

    const unsubscribeTags = onSnapshot(
      query(collection(db, 'tags'), orderBy('name', 'asc')),
      (snapshot) => setAllTags(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })))
    );

    return () => {
      unsubscribeSpells();
      unsubscribeSources();
      unsubscribeTagGroups();
      unsubscribeTags();
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
    return spells.filter((spell) => {
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
        && (tagFilterIds.length === 0 || tagFilterIds.every((tagId) => spellTagIds.includes(tagId)));
    });
  }, [spells, sourceById, search, sourceFilterIds, levelFilters, schoolFilters, tagFilterIds]);

  useEffect(() => {
    if (!selectedSpellId) return;
    if (!filteredSpells.some((spell) => spell.id === selectedSpellId)) {
      setSelectedSpellId('');
    }
  }, [filteredSpells, selectedSpellId]);

  const selectedSpellSummary = filteredSpells.find((spell) => spell.id === selectedSpellId) || null;
  const selectedSpell = selectedSpellId ? (spellDetailsById[selectedSpellId] || null) : null;
  const activeFilterCount = sourceFilterIds.length + levelFilters.length + schoolFilters.length + tagFilterIds.length;

  useEffect(() => {
    if (!selectedSpellId || spellDetailsById[selectedSpellId]) return;
    let active = true;
    setLoadingSelectedSpell(true);
    void getDoc(doc(db, 'spells', selectedSpellId))
      .then((snapshot) => {
        if (!active) return;
        if (snapshot.exists()) {
          setSpellDetailsById((current) => ({
            ...current,
            [selectedSpellId]: { id: snapshot.id, ...snapshot.data() }
          }));
        }
      })
      .finally(() => {
        if (active) setLoadingSelectedSpell(false);
      });

    return () => {
      active = false;
    };
  }, [selectedSpellId, spellDetailsById]);

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

  const getDescriptionHtml = (spell: SpellRecord) => {
    const rawFoundryHtml = String(spell.foundryDocument?.system?.description?.value || '').trim();
    if (rawFoundryHtml) return formatFoundrySpellDescriptionForDisplay(rawFoundryHtml);

    const bbcodeDescription = String(spell.description || '').trim();
    if (!bbcodeDescription) return '';
    return formatFoundrySpellDescriptionForDisplay(bbcodeToHtml(bbcodeDescription));
  };

  const getShell = (spell: SpellRecord) => {
    return spell.foundryShell || spell.foundryDocument?.system || {};
  };

  const resetFilters = () => {
    setSourceFilterIds([]);
    setLevelFilters([]);
    setSchoolFilters([]);
    setTagFilterIds([]);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8 pb-20">
      <div className="flex flex-col gap-4 border-b border-gold/10 pb-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-3 text-gold">
            <Wand2 className="h-6 w-6" />
            <span className="text-xs font-bold uppercase tracking-[0.3em]">Compendium</span>
          </div>
          <h1 className="h1-title">Spell List</h1>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {isAdmin ? (
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
                  {filteredSpells.length === 0 ? (
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
                          <div className="truncate font-serif text-lg text-ink">{spell.name}</div>
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
              {selectedSpellSummary ? (
                <div className="space-y-0">
                  <div className="border-b border-gold/10 px-6 py-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-2">
                        <div className="flex items-center gap-3">
                          <h2 className="font-serif text-4xl font-bold uppercase tracking-tight text-gold">{selectedSpellSummary.name}</h2>
                          <span className="text-sm font-bold text-gold/70">{renderSourceAbbreviation(selectedSpellSummary)}</span>
                          {selectedSpell?.foundryImport?.sourcePage ? (
                            <span className="text-sm text-ink/35">p{selectedSpell.foundryImport.sourcePage}</span>
                          ) : null}
                        </div>
                        <p className="font-serif italic text-ink/70">
                          {Number(selectedSpellSummary.level ?? 0) === 0 ? 'Cantrip' : `Level ${selectedSpellSummary.level}`}{' '}
                          {SCHOOL_LABELS[String(selectedSpellSummary.school ?? '')] || String(selectedSpellSummary.school ?? '').toUpperCase()}
                        </p>
                      </div>
                    </div>
                  </div>

                  {loadingSelectedSpell || !selectedSpell ? (
                    <div className="px-8 py-20 text-center text-ink/45">
                      Loading spell details...
                    </div>
                  ) : (
                    <>
                      <div className="border-b border-gold/10 px-6 py-5">
                        <div className="grid gap-6 lg:grid-cols-[126px_minmax(0,1fr)]">
                          <SpellArtPreview
                            src={selectedSpell.imageUrl}
                            alt={selectedSpell.name}
                            size={126}
                          />

                          <div className="grid gap-y-3 text-sm text-ink md:grid-cols-2 md:gap-x-8">
                            <SpellRow label="Casting Time" value={formatActivationLabel(getShell(selectedSpell).activation)} />
                            <SpellRow label="Range" value={formatRangeLabel(getShell(selectedSpell).range)} />
                            <SpellRow label="Components" value={formatComponentsLabel(Array.from(getShell(selectedSpell).properties ?? []), getShell(selectedSpell).materials)} />
                            <SpellRow label="Duration" value={formatDurationLabel(getShell(selectedSpell).duration)} />
                            <SpellRow label="Target" value={formatTargetLabel(getShell(selectedSpell).target)} />
                          </div>
                        </div>
                      </div>

                      <div className="space-y-6 px-6 py-5">
                        <div
                          className="prose max-w-none prose-p:text-ink/90 prose-strong:text-ink prose-em:text-ink/80 prose-li:text-ink/85 prose-headings:text-ink"
                          dangerouslySetInnerHTML={{ __html: getDescriptionHtml(selectedSpell) || '<p>No description available.</p>' }}
                        />

                        <div className="border-t border-gold/10 pt-4 text-sm text-ink/70">
                          <span className="font-bold text-ink">Source:</span>{' '}
                          {renderSourceAbbreviation(selectedSpellSummary)}
                          {selectedSpell.foundryImport?.sourcePage ? `, page ${selectedSpell.foundryImport.sourcePage}` : ''}
                          {selectedSpell.foundryImport?.rules ? ` (${selectedSpell.foundryImport.rules})` : ''}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div className="px-8 py-20 text-center text-ink/45">
                  Select a spell from the list to view its details.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

    </div>
  );
}

function SpellRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-gold/70">{label}</div>
      <div className="mt-1 text-sm text-ink/90">{value || '—'}</div>
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

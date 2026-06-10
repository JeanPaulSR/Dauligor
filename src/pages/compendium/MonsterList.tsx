import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCompendiumHashLink } from '../../lib/useCompendiumHashLink';
import { fetchCollection } from '../../lib/d1';
import { Button } from '../../components/ui/button';
import { type FilterSection } from '../../components/compendium/SectionFilterPanel';
import {
  CompendiumBrowserShell,
  type CompendiumColumn,
} from '../../components/compendium/CompendiumBrowserShell';
import { matchesSingleAxisFilter, matchesMultiAxisFilter } from '../../lib/spellFilters';
import { useAxisFilters } from '../../hooks/useAxisFilters';
import MonsterDetailPanel from '../../components/compendium/MonsterDetailPanel';
import {
  CR_BANDS, crToBand, formatCr,
  SIZE_LABEL, CREATURE_TYPE_LABEL,
} from '../../lib/monsterDisplay';

/**
 * Public monsters browser — thin wrapper around `CompendiumBrowserShell`,
 * mirroring `ItemList` / `FeatList` / `SpellList`.
 *
 * The catalog query ships only the slim header columns the list rows, search,
 * and filters need (the stat-block JSON bodies are heavy); the full row is
 * fetched lazily by `MonsterDetailPanel` when a row is opened. No favorites
 * backing store for monsters yet, so the favorites pane is hidden.
 */

type SourceRecord = {
  id: string;
  name?: string;
  abbreviation?: string;
  shortName?: string;
  [key: string]: any;
};

type MonsterRow = {
  id: string;
  name?: string;
  identifier?: string;
  sourceId?: string;
  cr?: number | null;
  creatureType?: string;
  typeSubtype?: string | null;
  swarmSize?: string | null;
  size?: string;
  ac?: number | null;
  hp?: number | null;
  hasLegendary?: number | boolean;
  hasLair?: number | boolean;
  hasSpellcasting?: number | boolean;
  [key: string]: any;
};

// Slim projection for the LIST. The stat-block JSON columns (actions, traits,
// spellcasting, biography, …) are heavy, so the catalog query ships only the
// display + filter + sort columns; the full row loads on click via
// `fetchDocument('monsters', id)` inside the detail panel.
const MONSTER_BROWSER_SELECT =
  'id, name, identifier, sourceId, cr, xp, creatureType, typeSubtype, swarmSize, '
  + 'size, alignment, ac, hp, hasLegendary, hasLair, hasSpellcasting';

const PROPERTY_AXIS_VALUES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'legendary',    label: 'Legendary' },
  { value: 'spellcasting', label: 'Spellcasting' },
  { value: 'lair',         label: 'Lair Actions' },
];

const AXIS_KEYS = ['cr', 'creatureType', 'size', 'source', 'property'] as const;

export default function MonsterList({ userProfile }: { userProfile?: any }) {
  const canManage = userProfile?.role === 'admin' || userProfile?.role === 'co-dm';
  const [monsters, setMonsters] = useState<MonsterRow[]>([]);
  const [sources, setSources] = useState<SourceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState('');

  const { axisFilters, cyclers, activeFilterCount, resetAll: resetFilters } =
    useAxisFilters(AXIS_KEYS);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const settled = await Promise.allSettled([
        fetchCollection<any>('monsters', { select: MONSTER_BROWSER_SELECT, orderBy: 'name ASC' }),
        fetchCollection<any>('sources', { orderBy: 'name ASC' }),
      ]);
      if (cancelled) return;
      const [monstersRes, srcRes] = settled;
      if (srcRes.status === 'fulfilled') setSources(srcRes.value);
      else console.error('[MonsterList] failed to load sources:', srcRes.reason);
      if (monstersRes.status === 'fulfilled') setMonsters(monstersRes.value as MonsterRow[]);
      else console.error('[MonsterList] failed to load monsters:', monstersRes.reason);
      setLoading(false);
    };
    load();
    return () => { cancelled = true; };
  }, []);

  const sourceById = useMemo(
    () => Object.fromEntries(sources.map((s) => [s.id, s])) as Record<string, SourceRecord>,
    [sources],
  );

  useCompendiumHashLink({
    rows: monsters,
    sources,
    sourceById,
    selectedId,
    setSelectedId,
  });

  const filteredMonsters = useMemo(() => {
    const lowered = search.trim().toLowerCase();
    return monsters.filter((row) => {
      const sourceRecord = sourceById[String(row.sourceId ?? '')];
      const sourceAbbrev = String(
        sourceRecord?.abbreviation || sourceRecord?.shortName || '',
      ).toLowerCase();
      const matchesSearch =
        !lowered
        || String(row.name ?? '').toLowerCase().includes(lowered)
        || String(row.identifier ?? '').toLowerCase().includes(lowered)
        || String(row.creatureType ?? '').toLowerCase().includes(lowered)
        || sourceAbbrev.includes(lowered);

      const propsHave = new Set<string>();
      if (row.hasLegendary) propsHave.add('legendary');
      if (row.hasSpellcasting) propsHave.add('spellcasting');
      if (row.hasLair) propsHave.add('lair');

      return (
        matchesSearch
        && matchesSingleAxisFilter(crToBand(row.cr), axisFilters.cr)
        && matchesSingleAxisFilter(String(row.creatureType ?? ''), axisFilters.creatureType)
        && matchesSingleAxisFilter(String(row.size ?? ''), axisFilters.size)
        && matchesSingleAxisFilter(String(row.sourceId ?? ''), axisFilters.source)
        && matchesMultiAxisFilter(propsHave, axisFilters.property)
      );
    });
  }, [monsters, sourceById, search, axisFilters]);

  const filterAxes = useMemo<FilterSection[]>(() => ([
    {
      key: 'cr', name: 'Challenge', kind: 'axis',
      values: CR_BANDS.map((v) => ({ ...v })),
    },
    {
      key: 'creatureType', name: 'Type', kind: 'axis',
      values: Object.entries(CREATURE_TYPE_LABEL).map(([value, label]) => ({ value, label })),
    },
    {
      key: 'size', name: 'Size', kind: 'axis',
      values: Object.entries(SIZE_LABEL).map(([value, label]) => ({ value, label })),
    },
    {
      key: 'source', name: 'Sources', kind: 'axis',
      values: sources.map((s) => ({
        value: s.id,
        label: String(s.abbreviation || s.shortName || s.name || s.id),
        labelAlt: String(s.name || s.shortName || s.abbreviation || s.id),
      })),
    },
    {
      key: 'property', name: 'Properties', kind: 'axis',
      values: PROPERTY_AXIS_VALUES.map((v) => ({ ...v })),
    },
  ]), [sources]);

  const renderSourceAbbrev = (row: MonsterRow) => {
    const src = sourceById[String(row.sourceId ?? '')];
    return src?.abbreviation || src?.shortName || (row as any).sourceBook || '—';
  };

  const columns = useMemo<CompendiumColumn<MonsterRow>[]>(() => ([
    {
      key: 'name',
      label: 'Name',
      width: 'minmax(0,1fr)',
      alwaysVisible: true,
      align: 'start',
      render: (row) => (
        <span className="truncate font-serif text-sm text-ink">{row.name}</span>
      ),
    },
    {
      key: 'cr',
      label: 'CR',
      width: '56px',
      render: (row) => (
        <span className="text-xs font-mono tabular-nums text-ink/80 justify-self-center">
          {formatCr(row.cr)}
        </span>
      ),
    },
    {
      key: 'type',
      label: 'Type',
      width: '108px',
      hideBelow: 'lg',
      render: (row) => {
        const label = CREATURE_TYPE_LABEL[String(row.creatureType || '')]
          || String(row.creatureType || '—');
        return <span className="text-xs text-ink/75 justify-self-center truncate">{label}</span>;
      },
    },
    {
      key: 'size',
      label: 'Size',
      width: '80px',
      hideBelow: 'xl',
      render: (row) => {
        const label = SIZE_LABEL[String(row.size || '')] || String(row.size || '—');
        return <span className="text-[11px] text-ink/75 justify-self-center truncate">{label}</span>;
      },
    },
    {
      key: 'source',
      label: 'Source',
      width: '60px',
      render: (row) => (
        <span className="text-xs font-bold text-gold/85 justify-self-center">
          {renderSourceAbbrev(row)}
        </span>
      ),
    },
  ]), [sourceById]);

  return (
    <CompendiumBrowserShell<MonsterRow>
      rows={filteredMonsters}
      allRows={monsters}
      loading={loading}
      getRowId={(row) => row.id}
      selectedId={selectedId}
      onSelect={setSelectedId}
      search={search}
      onSearchChange={setSearch}
      searchPlaceholder="Search monster name, type, identifier, or source"
      filterAxes={filterAxes}
      axisFilters={axisFilters}
      cyclers={cyclers}
      activeFilterCount={activeFilterCount}
      onResetFilters={resetFilters}
      columns={columns}
      columnsLocalStorageKey="dauligor.monsterListColumns"
      hideFavorites
      trailingActions={
        canManage ? (
          <Link to="/compendium/monsters/manage">
            <Button type="button" variant="outline" size="sm" className="h-8 border-gold/25 text-gold hover:bg-gold/5">
              Monster Manager
            </Button>
          </Link>
        ) : null
      }
      detailPanel={
        <MonsterDetailPanel
          monsterId={selectedId || null}
          source={selectedId ? sourceById[String(monsters.find((m) => m.id === selectedId)?.sourceId ?? '')] : undefined}
        />
      }
      emptyMessage="No monsters match the current search and filters."
    />
  );
}

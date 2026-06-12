import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchCollection } from '../../lib/d1';
import { Button } from '../../components/ui/button';
import { type FilterSection } from '../../components/compendium/SectionFilterPanel';
import {
  CompendiumBrowserShell,
  type CompendiumColumn,
} from '../../components/compendium/CompendiumBrowserShell';
import { matchesSingleAxisFilter, matchesMultiAxisFilter } from '../../lib/spellFilters';
import { useAxisFilters } from '../../hooks/useAxisFilters';
import CraftingMaterialDetailPanel from '../../components/compendium/CraftingMaterialDetailPanel';

/**
 * Public crafting-materials browser — thin wrapper around CompendiumBrowserShell.
 *
 * Queries the `crafting_materials` table directly (camelCase; small rows, so the
 * full row loads up front — no lazy detail fetch needed). Materials are hidden
 * from the gear ItemList by design, so this is their dedicated read view. The
 * backing loot item lives in `items` but the catalog-facing display reads the
 * crafting-domain row here.
 */

type SourceRecord = {
  id: string;
  name?: string;
  abbreviation?: string;
  shortName?: string;
  [key: string]: any;
};

type MaterialRow = {
  id: string;
  name?: string;
  identifier?: string;
  sourceId?: string;
  category?: string;
  rarity?: string;
  subtype?: string;
  usedFor?: string[];
  price?: any;
  weight?: any;
  imageUrl?: string;
  description?: string;
  [key: string]: any;
};

const CATEGORY_LABEL: Record<string, string> = {
  reagent: 'Reagent', essence: 'Essence', magicalInk: 'Magical Ink', metal: 'Metal',
  hide: 'Hide', wood: 'Wood', part: 'Part', gem: 'Gem', cookingSupply: 'Cooking Supply', misc: 'Misc',
};
const RARITY_LABEL: Record<string, string> = {
  trivial: 'Trivial', common: 'Common', uncommon: 'Uncommon', rare: 'Rare',
  veryRare: 'Very Rare', legendary: 'Legendary',
};
const CATEGORY_AXIS_VALUES = Object.entries(CATEGORY_LABEL).map(([value, label]) => ({ value, label }));
const RARITY_AXIS_VALUES = Object.entries(RARITY_LABEL).map(([value, label]) => ({ value, label }));

const AXIS_KEYS = ['category', 'rarity', 'source', 'discipline'] as const;

export default function CraftingMaterialsList({ userProfile }: { userProfile: any }) {
  const [materials, setMaterials] = useState<MaterialRow[]>([]);
  const [sources, setSources] = useState<SourceRecord[]>([]);
  const [disciplines, setDisciplines] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState('');

  const { axisFilters, cyclers, activeFilterCount, resetAll: resetFilters } =
    useAxisFilters(AXIS_KEYS);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const settled = await Promise.allSettled([
        fetchCollection<any>('craftingMaterials', { orderBy: 'name ASC' }),
        fetchCollection<any>('sources', { orderBy: 'name ASC' }),
        fetchCollection<any>('craftingDisciplines', { orderBy: 'sort ASC, name ASC' }),
      ]);
      if (cancelled) return;
      const pick = <T,>(r: PromiseSettledResult<T[]>, label: string): T[] => {
        if (r.status === 'fulfilled') return r.value;
        console.error(`[CraftingMaterialsList] failed to load ${label}:`, r.reason);
        return [];
      };
      const [matRes, srcRes, discRes] = settled;
      setMaterials(pick(matRes, 'craftingMaterials') as MaterialRow[]);
      setSources(pick(srcRes, 'sources') as SourceRecord[]);
      setDisciplines((pick(discRes, 'craftingDisciplines') as any[]).map((d) => ({ id: String(d.id), name: String(d.name) })));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const sourceById = useMemo(
    () => Object.fromEntries(sources.map((s) => [s.id, s])) as Record<string, SourceRecord>,
    [sources],
  );
  const disciplineNameById = useMemo(
    () => Object.fromEntries(disciplines.map((d) => [d.id, d.name])),
    [disciplines],
  );

  const filtered = useMemo(() => {
    const lowered = search.trim().toLowerCase();
    return materials.filter((row) => {
      const src = sourceById[String(row.sourceId ?? '')];
      const sourceAbbrev = String(src?.abbreviation || src?.shortName || '').toLowerCase();
      const matchesSearch =
        !lowered
        || String(row.name ?? '').toLowerCase().includes(lowered)
        || String(row.identifier ?? '').toLowerCase().includes(lowered)
        || String(row.subtype ?? '').toLowerCase().includes(lowered)
        || sourceAbbrev.includes(lowered);

      const usedSet = new Set<string>(Array.isArray(row.usedFor) ? row.usedFor.map(String) : []);

      return (
        matchesSearch
        && matchesSingleAxisFilter(String(row.category ?? ''), axisFilters.category)
        && matchesSingleAxisFilter(String(row.rarity ?? ''), axisFilters.rarity)
        && matchesSingleAxisFilter(String(row.sourceId ?? ''), axisFilters.source)
        && matchesMultiAxisFilter(usedSet, axisFilters.discipline)
      );
    });
  }, [materials, sourceById, search, axisFilters]);

  const filterAxes = useMemo<FilterSection[]>(() => ([
    { key: 'category', name: 'Category', kind: 'axis', values: CATEGORY_AXIS_VALUES.map((v) => ({ ...v })) },
    { key: 'rarity', name: 'Rarity', kind: 'axis', values: RARITY_AXIS_VALUES.map((v) => ({ ...v })) },
    {
      key: 'source', name: 'Sources', kind: 'axis',
      values: sources.map((s) => ({
        value: s.id,
        label: String(s.abbreviation || s.shortName || s.name || s.id),
        labelAlt: String(s.name || s.shortName || s.abbreviation || s.id),
      })),
    },
    {
      key: 'discipline', name: 'Used For', kind: 'axis',
      values: disciplines.map((d) => ({ value: d.id, label: d.name })),
    },
  ]), [sources, disciplines]);

  const renderSourceAbbrev = (row: MaterialRow) => {
    const src = sourceById[String(row.sourceId ?? '')];
    return src?.abbreviation || src?.shortName || '—';
  };

  const columns = useMemo<CompendiumColumn<MaterialRow>[]>(() => ([
    {
      key: 'name', label: 'Name', width: 'minmax(0,1fr)', alwaysVisible: true, align: 'start',
      render: (row) => <span className="truncate font-serif text-sm text-ink">{row.name}</span>,
    },
    {
      key: 'category', label: 'Category', width: '110px',
      render: (row) => <span className="text-xs text-ink/75 justify-self-center truncate">{CATEGORY_LABEL[row.category || ''] || row.category || '—'}</span>,
    },
    {
      key: 'rarity', label: 'Rarity', width: '80px',
      render: (row) => <span className="text-[11px] text-ink/75 justify-self-center truncate">{row.rarity ? (RARITY_LABEL[row.rarity] || row.rarity) : '—'}</span>,
    },
    {
      key: 'source', label: 'Source', width: '60px',
      render: (row) => <span className="text-xs font-bold text-gold/85 justify-self-center">{renderSourceAbbrev(row)}</span>,
    },
  ]), [sourceById]);

  const selectedRow = useMemo(
    () => materials.find((r) => r.id === selectedId) || null,
    [materials, selectedId],
  );

  return (
    <CompendiumBrowserShell<MaterialRow>
      rows={filtered}
      allRows={materials}
      loading={loading}
      getRowId={(row) => row.id}
      selectedId={selectedId}
      onSelect={setSelectedId}
      search={search}
      onSearchChange={setSearch}
      searchPlaceholder="Search material name, subtype, identifier, or source"
      filterAxes={filterAxes}
      axisFilters={axisFilters}
      cyclers={cyclers}
      activeFilterCount={activeFilterCount}
      onResetFilters={resetFilters}
      columns={columns}
      columnsLocalStorageKey="dauligor.craftingMaterialsListColumns"
      hideFavorites
      detailPanel={
        <CraftingMaterialDetailPanel
          row={selectedRow}
          source={selectedRow ? sourceById[String(selectedRow.sourceId ?? '')] : undefined}
          disciplineNameById={disciplineNameById}
        />
      }
      emptyMessage="No materials match the current search and filters."
      trailingActions={
        userProfile?.role === 'admin' ? (
          <Link to="/compendium/materials/manage">
            <Button type="button" variant="outline" size="sm" className="h-8 border-gold/25 text-gold hover:bg-gold/5">
              Material Manager
            </Button>
          </Link>
        ) : null
      }
    />
  );
}

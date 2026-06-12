import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchCollection } from '../../lib/d1';
import { Button } from '../../components/ui/button';
import { type FilterSection } from '../../components/compendium/SectionFilterPanel';
import {
  CompendiumBrowserShell,
  type CompendiumColumn,
} from '../../components/compendium/CompendiumBrowserShell';
import { matchesSingleAxisFilter } from '../../lib/spellFilters';
import { useAxisFilters } from '../../hooks/useAxisFilters';
import RecipeDetailPanel from '../../components/compendium/RecipeDetailPanel';

/**
 * Public crafting-recipes browser — thin wrapper around CompendiumBrowserShell.
 * Temporary read view for Phase A (the editor is the admin authoring surface).
 * Recipes are small rows, so the full row loads up front; items / enchantments /
 * disciplines load slim to resolve the output / input / discipline names.
 */

type SourceRecord = { id: string; name?: string; abbreviation?: string; shortName?: string; [key: string]: any };
type RecipeRow = {
  id: string; name?: string; identifier?: string; sourceId?: string;
  disciplineId?: string; outputType?: string; outputItemId?: string;
  outputEnchantmentId?: string; outputBaseItemId?: string; outputQuantity?: number;
  inputs?: any[]; goldCost?: any; craftTime?: any; craftChecks?: number | null;
  craftDifficultyDC?: number | null; imageUrl?: string; description?: string; [key: string]: any;
};

const OUTPUT_LABEL: Record<string, string> = { item: 'Item', enchantment: 'Enchantment', 'enchant-item': 'Enchanted Item' };
const OUTPUT_AXIS_VALUES = Object.entries(OUTPUT_LABEL).map(([value, label]) => ({ value, label }));
const AXIS_KEYS = ['outputType', 'discipline', 'source'] as const;

export default function RecipesList({ userProfile }: { userProfile: any }) {
  const [recipes, setRecipes] = useState<RecipeRow[]>([]);
  const [sources, setSources] = useState<SourceRecord[]>([]);
  const [disciplines, setDisciplines] = useState<Array<{ id: string; name: string }>>([]);
  const [itemNameById, setItemNameById] = useState<Record<string, string>>({});
  const [enchantmentNameById, setEnchantmentNameById] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState('');

  const { axisFilters, cyclers, activeFilterCount, resetAll: resetFilters } = useAxisFilters(AXIS_KEYS);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const settled = await Promise.allSettled([
        fetchCollection<any>('recipes', { orderBy: 'name ASC' }),
        fetchCollection<any>('sources', { orderBy: 'name ASC' }),
        fetchCollection<any>('craftingDisciplines', { orderBy: 'sort ASC, name ASC' }),
        fetchCollection<any>('items', { select: 'id, name', orderBy: 'name ASC' }),
        fetchCollection<any>('enchantments', { select: 'id, name', orderBy: 'name ASC' }),
      ]);
      if (cancelled) return;
      const pick = <T,>(r: PromiseSettledResult<T[]>, label: string): T[] => {
        if (r.status === 'fulfilled') return r.value;
        console.error(`[RecipesList] failed to load ${label}:`, r.reason);
        return [];
      };
      const [recRes, srcRes, discRes, itemRes, enchRes] = settled;
      setRecipes(pick(recRes, 'recipes') as RecipeRow[]);
      setSources(pick(srcRes, 'sources') as SourceRecord[]);
      setDisciplines((pick(discRes, 'craftingDisciplines') as any[]).map((d) => ({ id: String(d.id), name: String(d.name) })));
      setItemNameById(Object.fromEntries((pick(itemRes, 'items') as any[]).map((i) => [String(i.id), String(i.name)])));
      setEnchantmentNameById(Object.fromEntries((pick(enchRes, 'enchantments') as any[]).map((e) => [String(e.id), String(e.name)])));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const sourceById = useMemo(() => Object.fromEntries(sources.map((s) => [s.id, s])) as Record<string, SourceRecord>, [sources]);
  const disciplineNameById = useMemo(() => Object.fromEntries(disciplines.map((d) => [d.id, d.name])), [disciplines]);

  const filtered = useMemo(() => {
    const lowered = search.trim().toLowerCase();
    return recipes.filter((row) => {
      const src = sourceById[String(row.sourceId ?? '')];
      const sourceAbbrev = String(src?.abbreviation || src?.shortName || '').toLowerCase();
      const matchesSearch =
        !lowered
        || String(row.name ?? '').toLowerCase().includes(lowered)
        || String(row.identifier ?? '').toLowerCase().includes(lowered)
        || sourceAbbrev.includes(lowered);
      return (
        matchesSearch
        && matchesSingleAxisFilter(String(row.outputType ?? ''), axisFilters.outputType)
        && matchesSingleAxisFilter(String(row.disciplineId ?? ''), axisFilters.discipline)
        && matchesSingleAxisFilter(String(row.sourceId ?? ''), axisFilters.source)
      );
    });
  }, [recipes, sourceById, search, axisFilters]);

  const filterAxes = useMemo<FilterSection[]>(() => ([
    { key: 'outputType', name: 'Makes', kind: 'axis', values: OUTPUT_AXIS_VALUES.map((v) => ({ ...v })) },
    { key: 'discipline', name: 'Discipline', kind: 'axis', values: disciplines.map((d) => ({ value: d.id, label: d.name })) },
    {
      key: 'source', name: 'Sources', kind: 'axis',
      values: sources.map((s) => ({
        value: s.id,
        label: String(s.abbreviation || s.shortName || s.name || s.id),
        labelAlt: String(s.name || s.shortName || s.abbreviation || s.id),
      })),
    },
  ]), [sources, disciplines]);

  const renderSourceAbbrev = (row: RecipeRow) => {
    const src = sourceById[String(row.sourceId ?? '')];
    return src?.abbreviation || src?.shortName || '—';
  };

  const columns = useMemo<CompendiumColumn<RecipeRow>[]>(() => ([
    { key: 'name', label: 'Name', width: 'minmax(0,1fr)', alwaysVisible: true, align: 'start', render: (row) => <span className="truncate font-serif text-sm text-ink">{row.name}</span> },
    { key: 'output', label: 'Makes', width: '110px', render: (row) => <span className="text-xs text-ink/75 justify-self-center truncate">{OUTPUT_LABEL[row.outputType || 'item'] || row.outputType || '—'}</span> },
    { key: 'discipline', label: 'Discipline', width: '110px', render: (row) => <span className="text-xs text-ink/75 justify-self-center truncate">{row.disciplineId ? (disciplineNameById[row.disciplineId] || '—') : '—'}</span> },
    { key: 'source', label: 'Source', width: '60px', render: (row) => <span className="text-xs font-bold text-gold/85 justify-self-center">{renderSourceAbbrev(row)}</span> },
  ]), [sourceById, disciplineNameById]);

  const selectedRow = useMemo(() => recipes.find((r) => r.id === selectedId) || null, [recipes, selectedId]);

  return (
    <CompendiumBrowserShell<RecipeRow>
      rows={filtered}
      allRows={recipes}
      loading={loading}
      getRowId={(row) => row.id}
      selectedId={selectedId}
      onSelect={setSelectedId}
      search={search}
      onSearchChange={setSearch}
      searchPlaceholder="Search recipe name, identifier, or source"
      filterAxes={filterAxes}
      axisFilters={axisFilters}
      cyclers={cyclers}
      activeFilterCount={activeFilterCount}
      onResetFilters={resetFilters}
      columns={columns}
      columnsLocalStorageKey="dauligor.recipesListColumns"
      hideFavorites
      detailPanel={
        <RecipeDetailPanel
          row={selectedRow}
          source={selectedRow ? sourceById[String(selectedRow.sourceId ?? '')] : undefined}
          disciplineNameById={disciplineNameById}
          itemNameById={itemNameById}
          enchantmentNameById={enchantmentNameById}
        />
      }
      emptyMessage="No recipes match the current search and filters."
      trailingActions={
        userProfile?.role === 'admin' ? (
          <Link to="/compendium/recipes/manage">
            <Button type="button" variant="outline" size="sm" className="h-8 border-gold/25 text-gold hover:bg-gold/5">
              Recipe Manager
            </Button>
          </Link>
        ) : null
      }
    />
  );
}

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
import EnchantmentDetailPanel from '../../components/compendium/EnchantmentDetailPanel';

/**
 * Public enchantments browser — thin wrapper around CompendiumBrowserShell.
 * Temporary read view for Phase A (the editor is the admin authoring surface).
 * The restriction taxonomies load slim to resolve category / property slugs to
 * readable names in the detail panel.
 */

type SourceRecord = { id: string; name?: string; abbreviation?: string; shortName?: string; [key: string]: any };
type EnchantRow = {
  id: string; name?: string; identifier?: string; sourceId?: string;
  restrictions?: any; rarity?: string; activities?: any[]; effects?: any[];
  magicalBonus?: number | null; attunement?: string; price?: any;
  imageUrl?: string; description?: string; [key: string]: any;
};

const APPLIES_TO_LABEL: Record<string, string> = {
  '': 'Any', container: 'Container', consumable: 'Consumable', equipment: 'Equipment',
  feat: 'Feature', loot: 'Loot', spell: 'Spell', tool: 'Tool', weapon: 'Weapon',
};
const RARITY_LABEL: Record<string, string> = {
  common: 'Common', uncommon: 'Uncommon', rare: 'Rare', veryRare: 'Very Rare', legendary: 'Legendary', artifact: 'Artifact',
};
const APPLIES_TO_AXIS_VALUES = Object.entries(APPLIES_TO_LABEL).map(([value, label]) => ({ value, label }));
const RARITY_AXIS_VALUES = Object.entries(RARITY_LABEL).map(([value, label]) => ({ value, label }));
const RESTRICTION_COLLECTIONS = ['weaponCategories', 'armorCategories', 'toolCategories', 'consumableCategories', 'lootCategories', 'itemProperties'] as const;
const AXIS_KEYS = ['appliesTo', 'rarity', 'source'] as const;

export default function EnchantmentsList({ userProfile }: { userProfile: any }) {
  const [enchantments, setEnchantments] = useState<EnchantRow[]>([]);
  const [sources, setSources] = useState<SourceRecord[]>([]);
  const [restrictionNameById, setRestrictionNameById] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState('');

  const { axisFilters, cyclers, activeFilterCount, resetAll: resetFilters } = useAxisFilters(AXIS_KEYS);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const settled = await Promise.allSettled([
        fetchCollection<any>('enchantments', { orderBy: 'name ASC' }),
        fetchCollection<any>('sources', { orderBy: 'name ASC' }),
      ]);
      if (cancelled) return;
      const pick = <T,>(r: PromiseSettledResult<T[]>, label: string): T[] => {
        if (r.status === 'fulfilled') return r.value;
        console.error(`[EnchantmentsList] failed to load ${label}:`, r.reason);
        return [];
      };
      const [encRes, srcRes] = settled;
      setEnchantments(pick(encRes, 'enchantments') as EnchantRow[]);
      setSources(pick(srcRes, 'sources') as SourceRecord[]);
      setLoading(false);
    })();
    // Restriction taxonomies → id→name map for the detail panel (slug-resolution).
    RESTRICTION_COLLECTIONS.forEach((coll) => {
      fetchCollection<any>(coll, { orderBy: 'name ASC' })
        .then((rows) => {
          if (cancelled) return;
          setRestrictionNameById((prev) => {
            const next = { ...prev };
            rows.forEach((row: any) => { next[String(row.identifier || row.id)] = String(row.name); });
            return next;
          });
        })
        .catch(() => {});
    });
    return () => { cancelled = true; };
  }, []);

  const sourceById = useMemo(() => Object.fromEntries(sources.map((s) => [s.id, s])) as Record<string, SourceRecord>, [sources]);

  const filtered = useMemo(() => {
    const lowered = search.trim().toLowerCase();
    return enchantments.filter((row) => {
      const src = sourceById[String(row.sourceId ?? '')];
      const sourceAbbrev = String(src?.abbreviation || src?.shortName || '').toLowerCase();
      const matchesSearch =
        !lowered
        || String(row.name ?? '').toLowerCase().includes(lowered)
        || String(row.identifier ?? '').toLowerCase().includes(lowered)
        || sourceAbbrev.includes(lowered);
      const appliesTo = String(row.restrictions?.type ?? '');
      return (
        matchesSearch
        && matchesSingleAxisFilter(appliesTo, axisFilters.appliesTo)
        && matchesSingleAxisFilter(String(row.rarity ?? ''), axisFilters.rarity)
        && matchesSingleAxisFilter(String(row.sourceId ?? ''), axisFilters.source)
      );
    });
  }, [enchantments, sourceById, search, axisFilters]);

  const filterAxes = useMemo<FilterSection[]>(() => ([
    { key: 'appliesTo', name: 'Applies To', kind: 'axis', values: APPLIES_TO_AXIS_VALUES.map((v) => ({ ...v })) },
    { key: 'rarity', name: 'Rarity', kind: 'axis', values: RARITY_AXIS_VALUES.map((v) => ({ ...v })) },
    {
      key: 'source', name: 'Sources', kind: 'axis',
      values: sources.map((s) => ({
        value: s.id,
        label: String(s.abbreviation || s.shortName || s.name || s.id),
        labelAlt: String(s.name || s.shortName || s.abbreviation || s.id),
      })),
    },
  ]), [sources]);

  const renderSourceAbbrev = (row: EnchantRow) => {
    const src = sourceById[String(row.sourceId ?? '')];
    return src?.abbreviation || src?.shortName || '—';
  };

  const columns = useMemo<CompendiumColumn<EnchantRow>[]>(() => ([
    { key: 'name', label: 'Name', width: 'minmax(0,1fr)', alwaysVisible: true, align: 'start', render: (row) => <span className="truncate font-serif text-sm text-ink">{row.name}</span> },
    { key: 'appliesTo', label: 'Applies To', width: '110px', render: (row) => <span className="text-xs text-ink/75 justify-self-center truncate">{APPLIES_TO_LABEL[row.restrictions?.type || ''] || row.restrictions?.type || 'Any'}</span> },
    { key: 'rarity', label: 'Rarity', width: '90px', render: (row) => <span className="text-[11px] text-ink/75 justify-self-center truncate">{row.rarity ? (RARITY_LABEL[row.rarity] || row.rarity) : '—'}</span> },
    { key: 'source', label: 'Source', width: '60px', render: (row) => <span className="text-xs font-bold text-gold/85 justify-self-center">{renderSourceAbbrev(row)}</span> },
  ]), [sourceById]);

  const selectedRow = useMemo(() => enchantments.find((r) => r.id === selectedId) || null, [enchantments, selectedId]);

  return (
    <CompendiumBrowserShell<EnchantRow>
      rows={filtered}
      allRows={enchantments}
      loading={loading}
      getRowId={(row) => row.id}
      selectedId={selectedId}
      onSelect={setSelectedId}
      search={search}
      onSearchChange={setSearch}
      searchPlaceholder="Search enchantment name, identifier, or source"
      filterAxes={filterAxes}
      axisFilters={axisFilters}
      cyclers={cyclers}
      activeFilterCount={activeFilterCount}
      onResetFilters={resetFilters}
      columns={columns}
      columnsLocalStorageKey="dauligor.enchantmentsListColumns"
      hideFavorites
      detailPanel={
        <EnchantmentDetailPanel
          row={selectedRow}
          source={selectedRow ? sourceById[String(selectedRow.sourceId ?? '')] : undefined}
          restrictionNameById={restrictionNameById}
        />
      }
      emptyMessage="No enchantments match the current search and filters."
      trailingActions={
        userProfile?.role === 'admin' ? (
          <Link to="/compendium/enchantments/manage">
            <Button type="button" variant="outline" size="sm" className="h-8 border-gold/25 text-gold hover:bg-gold/5">
              Enchantment Manager
            </Button>
          </Link>
        ) : null
      }
    />
  );
}

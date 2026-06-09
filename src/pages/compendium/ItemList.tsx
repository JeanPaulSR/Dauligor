import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCompendiumHashLink } from '../../lib/useCompendiumHashLink';
import { Star } from 'lucide-react';
import { auth } from '../../lib/firebase';
import { fetchCollection } from '../../lib/d1';
import { fetchItem } from '../../lib/compendium';
import { cn } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { type FilterSection } from '../../components/compendium/SectionFilterPanel';
import {
  CompendiumBrowserShell,
  type CompendiumColumn,
} from '../../components/compendium/CompendiumBrowserShell';
import { matchesSingleAxisFilter, matchesMultiAxisFilter } from '../../lib/spellFilters';
import { useAxisFilters } from '../../hooks/useAxisFilters';
import { useItemFavorites } from '../../lib/itemFavorites';
import ItemDetailPanel from '../../components/compendium/ItemDetailPanel';
import { getIdentity } from "../../lib/auth";

/**
 * Public items browser — thin wrapper around `CompendiumBrowserShell`.
 *
 * Queries only the unified `items` table (every Foundry item type
 * lands here per the 20260525-1800 migration). The `weapons` /
 * `armor` / `tools` tables are loaded *only* to resolve
 * `base_weapon_id` / `base_armor_id` / `base_tool_id` → proficiency
 * name for display in the detail panel — they're the proficiency-
 * definition tables managed by AdminProficiencies.
 */

type SourceRecord = {
  id: string;
  name?: string;
  abbreviation?: string;
  shortName?: string;
  [key: string]: any;
};

type ProficiencyRow = {
  id: string;
  name?: string;
  identifier?: string;
  [key: string]: any;
};

type ItemRow = {
  id: string;
  name?: string;
  identifier?: string;
  sourceId?: string;
  item_type?: string;
  rarity?: string;
  attunement?: any;
  magical?: boolean;
  weight?: any;
  price?: any;
  description?: string;
  base_item?: string;
  base_weapon_id?: string | null;
  base_armor_id?: string | null;
  base_tool_id?: string | null;
  magicalFlag?: boolean;
  attunementFlag?: boolean;
  resolvedBaseItemName?: string;
  [key: string]: any;
};

// ─── Constants ────────────────────────────────────────────────

const ITEM_TYPE_AXIS_VALUES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'weapon',     label: 'Weapon' },
  { value: 'equipment',  label: 'Equipment' },
  { value: 'consumable', label: 'Consumable' },
  { value: 'tool',       label: 'Tool' },
  { value: 'loot',       label: 'Loot' },
  { value: 'container',  label: 'Container' },
  { value: 'backpack',   label: 'Backpack (legacy)' },
];

const RARITY_AXIS_VALUES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'none',      label: 'Common (none)' },
  { value: 'common',    label: 'Common' },
  { value: 'uncommon',  label: 'Uncommon' },
  { value: 'rare',      label: 'Rare' },
  { value: 'veryRare',  label: 'Very Rare' },
  { value: 'legendary', label: 'Legendary' },
  { value: 'artifact',  label: 'Artifact' },
];

const PROPERTY_AXIS_VALUES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'magical',    label: 'Magical' },
  { value: 'attunement', label: 'Requires Attunement' },
];

const RARITY_LABEL: Record<string, string> = {
  none: 'Common',
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  veryRare: 'Very Rare',
  legendary: 'Legendary',
  artifact: 'Artifact',
};

const ITEM_TYPE_LABEL: Record<string, string> = {
  weapon: 'Weapon',
  equipment: 'Equipment',
  consumable: 'Consumable',
  tool: 'Tool',
  loot: 'Loot',
  container: 'Container',
  backpack: 'Backpack',
};

// Slim projection for the browser LIST. The heavy per-item payload
// (description + the per-type mechanics JSON) is fetched lazily via
// `fetchItem(id)` only when a row is opened, so the catalog query ships
// just what the list rows, search, filters, and the detail-panel HEADER
// need. The detail BODY (description / weapon-armor-tool mechanics /
// weight / price) loads on click. base_*_id resolve the base-item label.
const ITEM_BROWSER_SELECT =
  'id, name, identifier, source_id, item_type, rarity, magical, attunement, base_item, base_weapon_id, base_armor_id, base_tool_id, image_url';

const AXIS_KEYS = ['itemType', 'rarity', 'source', 'property'] as const;

// ─── Component ────────────────────────────────────────────────

export default function ItemList({ userProfile }: { userProfile: any }) {
  const [items, setItems] = useState<ItemRow[]>([]);
  const [sources, setSources] = useState<SourceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState('');

  const { axisFilters, cyclers, activeFilterCount, resetAll: resetFilters } =
    useAxisFilters(AXIS_KEYS);

  const [authUserId, setAuthUserId] = useState<string | null>(() => getIdentity()?.uid ?? null);
  useEffect(() => {
    const unsub = auth.onAuthStateChanged((u) => setAuthUserId(u?.uid ?? null));
    return unsub;
  }, []);
  const { favorites, isFavorite, toggleFavorite } = useItemFavorites(authUserId);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      // items is the primary corpus; weapons/armor/tools loaded
      // strictly for base_*_id → proficiency-name resolution in the
      // detail panel. Promise.allSettled so one failed query (e.g.
      // an empty `tools` table on a fresh world) doesn't blank the
      // entire page.
      const settled = await Promise.allSettled([
        fetchCollection<any>('items', { select: ITEM_BROWSER_SELECT, orderBy: 'name ASC' }),
        fetchCollection<any>('sources', { orderBy: 'name ASC' }),
        fetchCollection<any>('weapons'),
        fetchCollection<any>('armor'),
        fetchCollection<any>('tools'),
      ]);
      if (cancelled) return;
      const pick = <T,>(r: PromiseSettledResult<T[]>, label: string): T[] => {
        if (r.status === 'fulfilled') return r.value;
        console.error(`[ItemList] failed to load ${label}:`, r.reason);
        return [];
      };
      const [itemsRes, srcRes, weaponsRes, armorRes, toolsRes] = settled;
      const wDefs = pick(weaponsRes, 'weapons') as ProficiencyRow[];
      const aDefs = pick(armorRes, 'armor') as ProficiencyRow[];
      const tDefs = pick(toolsRes, 'tools') as ProficiencyRow[];
      setSources(pick(srcRes, 'sources'));

      const wById = new Map(wDefs.map((r) => [r.id, r.name || r.identifier || '—']));
      const aById = new Map(aDefs.map((r) => [r.id, r.name || r.identifier || '—']));
      const tById = new Map(tDefs.map((r) => [r.id, r.name || r.identifier || '—']));
      const annotated: ItemRow[] = pick(itemsRes, 'items').map((row: any) => {
        const attunementFlag = !!(row.attunement === 1 || row.attunement === true || (typeof row.attunement === 'string' && row.attunement));
        const magicalFlag = !!(row.magical === 1 || row.magical === true);
        // Resolve base-item label from whichever FK is set; fall back
        // to the raw `base_item` slug if no proficiency matched.
        let resolvedBaseItemName: string | undefined;
        if (row.base_weapon_id) resolvedBaseItemName = wById.get(row.base_weapon_id);
        else if (row.base_armor_id) resolvedBaseItemName = aById.get(row.base_armor_id);
        else if (row.base_tool_id) resolvedBaseItemName = tById.get(row.base_tool_id);
        if (!resolvedBaseItemName && row.base_item) resolvedBaseItemName = String(row.base_item);
        return {
          ...row,
          sourceId: row.source_id ?? row.sourceId,
          magicalFlag,
          attunementFlag,
          resolvedBaseItemName,
        };
      });
      setItems(annotated);
      setLoading(false);
    };
    load();
    return () => { cancelled = true; };
  }, []);

  const sourceById = useMemo(
    () => Object.fromEntries(sources.map((s) => [s.id, s])) as Record<string, SourceRecord>,
    [sources],
  );

  // Hash deep-link (`#identifier_abbrev`). Same hook FeatList /
  // SpellList / FacilitiesList use — see `src/lib/useCompendiumHashLink.ts`.
  useCompendiumHashLink({
    rows: items,
    sources,
    sourceById,
    selectedId,
    setSelectedId,
  });

  const filteredItems = useMemo(() => {
    const lowered = search.trim().toLowerCase();
    return items.filter((row) => {
      const sourceRecord = sourceById[String(row.sourceId ?? '')];
      const sourceAbbrev = String(
        sourceRecord?.abbreviation || sourceRecord?.shortName || '',
      ).toLowerCase();
      const matchesSearch =
        !lowered
        || String(row.name ?? '').toLowerCase().includes(lowered)
        || String(row.identifier ?? '').toLowerCase().includes(lowered)
        || String(row.resolvedBaseItemName ?? '').toLowerCase().includes(lowered)
        || sourceAbbrev.includes(lowered);

      const propsHave = new Set<string>();
      if (row.magicalFlag) propsHave.add('magical');
      if (row.attunementFlag) propsHave.add('attunement');

      return (
        matchesSearch
        && matchesSingleAxisFilter(String(row.item_type ?? ''), axisFilters.itemType)
        && matchesSingleAxisFilter(row.rarity || 'none', axisFilters.rarity)
        && matchesSingleAxisFilter(String(row.sourceId ?? ''), axisFilters.source)
        && matchesMultiAxisFilter(propsHave, axisFilters.property)
      );
    });
  }, [items, sourceById, search, axisFilters]);

  const filterAxes = useMemo<FilterSection[]>(() => ([
    {
      key: 'itemType', name: 'Type', kind: 'axis',
      values: ITEM_TYPE_AXIS_VALUES.map((v) => ({ ...v })),
    },
    {
      key: 'rarity', name: 'Rarity', kind: 'axis',
      values: RARITY_AXIS_VALUES.map((v) => ({ ...v })),
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

  const renderSourceAbbrev = (row: ItemRow) => {
    const src = sourceById[String(row.sourceId ?? '')];
    return src?.abbreviation || src?.shortName || '—';
  };

  const columns = useMemo<CompendiumColumn<ItemRow>[]>(() => ([
    {
      key: 'name',
      label: 'Name',
      width: 'minmax(0,1fr)',
      alwaysVisible: true,
      align: 'start',
      render: (row) => {
        const starred = isFavorite(row.id);
        return (
          <div className="min-w-0 flex items-center gap-1.5">
            <span className="truncate font-serif text-sm text-ink">{row.name}</span>
            {starred && (
              <Star className="w-3 h-3 text-gold/75 fill-gold/45 shrink-0" aria-label="Favorite" />
            )}
          </div>
        );
      },
    },
    {
      key: 'type',
      label: 'Type',
      width: '96px',
      render: (row) => {
        const label = ITEM_TYPE_LABEL[String(row.item_type || 'loot')] || String(row.item_type || 'Loot');
        return <span className="text-xs text-ink/75 justify-self-center truncate">{label}</span>;
      },
    },
    {
      key: 'rarity',
      label: 'Rarity',
      width: '80px',
      render: (row) => {
        const label = RARITY_LABEL[row.rarity || 'none'];
        return (
          <span className="text-[11px] text-ink/75 justify-self-center truncate">
            {row.rarity && row.rarity !== 'none' ? label : '—'}
          </span>
        );
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
  ]), [isFavorite, sourceById]);

  const favoritesRowRender = ({ row, selected, toggleStar, onSelect }: { row: ItemRow; selected: boolean; toggleStar: () => void; onSelect: () => void }) => {
    const sourceLabel = renderSourceAbbrev(row);
    return (
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          'w-full grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 px-3 py-2 text-left transition-colors',
          selected ? 'bg-gold/15' : 'hover:bg-gold/5',
        )}
      >
        <span className="truncate text-sm text-ink">{row.name}</span>
        <span className="text-[10px] font-bold text-gold/75">{sourceLabel}</span>
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => { e.stopPropagation(); toggleStar(); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              e.stopPropagation();
              toggleStar();
            }
          }}
          className="text-gold/85 hover:text-blood shrink-0 cursor-pointer"
          title="Remove from favorites"
          aria-label="Remove from favorites"
        >
          <Star className="w-3.5 h-3.5 fill-current" />
        </span>
      </button>
    );
  };

  const selectedRow = useMemo(
    () => items.find((r) => r.id === selectedId) || null,
    [items, selectedId],
  );

  // Lazy-load the FULL selected row (description + per-type mechanics) on
  // click. The catalog list ships only the slim header columns (see
  // ITEM_BROWSER_SELECT), so the rest is fetched the moment a row opens —
  // the detail panel reads the slim `selectedRow` for an instant header
  // and swaps to the full row when it arrives. The list-computed
  // annotations (resolvedBaseItemName / flags / sourceId) are carried onto
  // the full row so the header reads identically across the swap.
  const [selectedFullRow, setSelectedFullRow] = useState<ItemRow | null>(null);
  useEffect(() => {
    if (!selectedId) { setSelectedFullRow(null); return; }
    setSelectedFullRow(null);
    const slim = items.find((r) => r.id === selectedId) || null;
    let cancelled = false;
    (async () => {
      try {
        const full = await fetchItem(selectedId);
        if (cancelled || !full) return;
        setSelectedFullRow({
          ...full,
          sourceId: slim?.sourceId ?? full.source_id ?? full.sourceId,
          magicalFlag: slim?.magicalFlag,
          attunementFlag: slim?.attunementFlag,
          resolvedBaseItemName: slim?.resolvedBaseItemName,
        } as ItemRow);
      } catch (err) {
        console.error('[ItemList] failed to load item details:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedId, items]);

  const detailRow = selectedFullRow ?? selectedRow;

  return (
    <CompendiumBrowserShell<ItemRow>
      rows={filteredItems}
      allRows={items}
      loading={loading}
      getRowId={(row) => row.id}
      selectedId={selectedId}
      onSelect={setSelectedId}
      search={search}
      onSearchChange={setSearch}
      searchPlaceholder="Search item name, base item, identifier, or source"
      filterAxes={filterAxes}
      axisFilters={axisFilters}
      cyclers={cyclers}
      activeFilterCount={activeFilterCount}
      onResetFilters={resetFilters}
      columns={columns}
      columnsLocalStorageKey="dauligor.itemListColumns"
      favorites={favorites}
      onToggleFavorite={toggleFavorite}
      favoritesRowRender={favoritesRowRender}
      favoritesEmptyMessage="Star an item to pin it here."
      detailPanel={
        <ItemDetailPanel
          row={detailRow}
          source={detailRow ? sourceById[String(detailRow.sourceId ?? '')] : undefined}
          starred={detailRow ? isFavorite(detailRow.id) : false}
          onToggleFavorite={detailRow ? () => toggleFavorite(detailRow.id) : undefined}
        />
      }
      emptyMessage="No items match the current search and filters."
      trailingActions={
        userProfile?.role === 'admin' ? (
          <Link to="/compendium/items/manage">
            <Button type="button" variant="outline" size="sm" className="h-8 border-gold/25 text-gold hover:bg-gold/5">
              Item Manager
            </Button>
          </Link>
        ) : null
      }
    />
  );
}

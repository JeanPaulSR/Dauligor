import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Lock, Sparkles, Star } from 'lucide-react';
import { auth } from '../../lib/firebase';
import { fetchCollection } from '../../lib/d1';
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

  const [authUserId, setAuthUserId] = useState<string | null>(() => auth.currentUser?.uid ?? null);
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
        fetchCollection<any>('items', { orderBy: 'name ASC' }),
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
              <Star className="w-3 h-3 text-gold/70 fill-gold/40 shrink-0" aria-label="Favorite" />
            )}
            {row.attunementFlag && (
              <Lock className="w-3 h-3 text-blood/70 shrink-0" aria-label="Requires attunement" />
            )}
            {row.magicalFlag && (
              <Sparkles className="w-3 h-3 text-gold/70 shrink-0" aria-label="Magical" />
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
        <span className="text-xs font-bold text-gold/80 justify-self-center">
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
          selected ? 'bg-gold/10' : 'hover:bg-gold/5',
        )}
      >
        <span className="truncate text-sm text-ink">{row.name}</span>
        <span className="text-[10px] font-bold text-gold/70">{sourceLabel}</span>
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
          className="text-gold/80 hover:text-blood shrink-0 cursor-pointer"
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
          row={selectedRow}
          source={selectedRow ? sourceById[String(selectedRow.sourceId ?? '')] : undefined}
          starred={selectedRow ? isFavorite(selectedRow.id) : false}
          onToggleFavorite={selectedRow ? () => toggleFavorite(selectedRow.id) : undefined}
        />
      }
      emptyMessage="No items match the current search and filters."
      trailingActions={
        userProfile?.role === 'admin' ? (
          <Link to="/compendium/items/manage">
            <Button type="button" variant="outline" size="sm" className="h-8 border-gold/20 text-gold hover:bg-gold/5">
              Item Manager
            </Button>
          </Link>
        ) : null
      }
    />
  );
}

// ─── ItemDetailPanel ──────────────────────────────────────────
// Detail rendering switches sections by `row.item_type` so weapons
// get damage + range, equipment-armor gets AC + stealth, tools get
// the tool category + proficiency-base label.
function ItemDetailPanel({
  row,
  source,
  starred,
  onToggleFavorite,
}: {
  row: ItemRow | null;
  source: SourceRecord | undefined;
  starred: boolean;
  onToggleFavorite?: () => void;
}) {
  if (!row) {
    return (
      <div className="px-6 py-12 text-center text-ink/50">
        Select an item from the list to view its details.
      </div>
    );
  }
  const rarityLabel = RARITY_LABEL[row.rarity || 'none'];
  const typeLabel = ITEM_TYPE_LABEL[String(row.item_type || 'loot')] || String(row.item_type || 'Loot');
  const itemType = String(row.item_type ?? '');

  return (
    <div className="space-y-0">
      <div className="border-b border-gold/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.02),transparent)] px-6 py-5 space-y-2">
        <div className="flex items-center gap-3 flex-wrap">
          <h3 className="font-serif text-3xl font-bold text-ink">{row.name || '—'}</h3>
          {onToggleFavorite ? (
            <button
              type="button"
              onClick={onToggleFavorite}
              className={cn(
                'inline-flex items-center justify-center w-7 h-7 rounded border transition-colors',
                starred
                  ? 'border-gold bg-gold/15 text-gold hover:bg-blood/10 hover:border-blood/40 hover:text-blood'
                  : 'border-gold/20 text-ink/45 hover:border-gold hover:text-gold',
              )}
              title={starred ? 'Remove from favorites' : 'Add to favorites'}
              aria-label={starred ? 'Remove from favorites' : 'Add to favorites'}
            >
              <Star className={cn('w-4 h-4', starred && 'fill-current')} />
            </button>
          ) : null}
          {source ? (
            <span className="text-xs font-bold uppercase tracking-widest text-gold">
              {source.abbreviation || source.shortName || source.name}
            </span>
          ) : null}
        </div>
        <p className="font-serif italic text-ink/70 text-sm">
          {typeLabel}
          {row.rarity && row.rarity !== 'none' ? ` · ${rarityLabel}` : ''}
          {row.attunementFlag ? ' · requires attunement' : ''}
          {row.magicalFlag ? ' · magical' : ''}
        </p>
        {row.resolvedBaseItemName ? (
          <p className="text-xs text-ink/60">
            Base item: <span className="font-bold text-gold/85">{row.resolvedBaseItemName}</span>
            <span className="text-ink/40"> — defined in /admin/proficiencies</span>
          </p>
        ) : null}
      </div>

      <div className="border-b border-gold/10 px-6 py-4 grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
        <DetailRow label="Identifier" value={row.identifier || '—'} mono />
        <DetailRow label="Weight" value={formatWeight(row.weight)} />
        <DetailRow label="Price" value={formatPrice(row.price)} />
      </div>

      {itemType === 'weapon' && <WeaponMechanics raw={row} />}
      {itemType === 'equipment' && row.armor_value != null && <ArmorMechanics raw={row} />}
      {itemType === 'tool' && <ToolMechanics raw={row} />}
      {(itemType === 'consumable' || itemType === 'loot' || itemType === 'container' || itemType === 'backpack') && (
        <OtherMechanics raw={row} />
      )}

      {row.description ? (
        <div className="px-6 py-5 prose prose-invert max-w-none prose-p:text-ink/90">
          {typeof row.description === 'string' ? (
            <p className="whitespace-pre-wrap">{row.description}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-gold/70">{label}</div>
      <div className={cn('mt-1 text-sm text-ink/90', mono && 'font-mono text-xs')}>{value || '—'}</div>
    </div>
  );
}

function WeaponMechanics({ raw }: { raw: ItemRow }) {
  const damage = raw?.damage;
  const range = raw?.range;
  const damageBase = damage?.base;
  const damageStr = damageBase
    ? [
        damageBase.number ? `${damageBase.number}` : null,
        damageBase.denomination ? `d${damageBase.denomination}` : null,
        damageBase.bonus ? ` + ${damageBase.bonus}` : null,
      ].filter(Boolean).join('')
    : '';
  const damageTypes = Array.isArray(damageBase?.types) ? damageBase.types.join(', ') : '';
  const rangeStr = range
    ? [range.value, range.long ? `/ ${range.long}` : null, range.units]
        .filter(Boolean).join(' ')
    : '';
  return (
    <div className="border-b border-gold/10 px-6 py-4 grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
      <DetailRow label="Damage" value={damageStr ? `${damageStr}${damageTypes ? ' ' + damageTypes : ''}` : '—'} />
      <DetailRow label="Range" value={rangeStr || '—'} />
      <DetailRow label="Mastery" value={raw?.mastery || '—'} />
      {raw?.magical_bonus ? <DetailRow label="Magic Bonus" value={`+${raw.magical_bonus}`} /> : null}
      {Array.isArray(raw?.properties) && raw.properties.length > 0 ? (
        <DetailRow label="Properties" value={raw.properties.join(', ')} />
      ) : null}
    </div>
  );
}

function ArmorMechanics({ raw }: { raw: ItemRow }) {
  return (
    <div className="border-b border-gold/10 px-6 py-4 grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
      <DetailRow label="Armor Class" value={raw?.armor_value ? String(raw.armor_value) : '—'} />
      <DetailRow label="Dex Cap" value={raw?.armor_dex != null ? String(raw.armor_dex) : '—'} />
      <DetailRow label="Strength Req" value={raw?.strength ? String(raw.strength) : '—'} />
      <DetailRow label="Stealth" value={raw?.stealth ? 'Disadvantage' : 'Normal'} />
      {raw?.armor_type ? <DetailRow label="Type" value={String(raw.armor_type)} /> : null}
      {raw?.armor_magical_bonus ? <DetailRow label="Magic Bonus" value={`+${raw.armor_magical_bonus}`} /> : null}
    </div>
  );
}

function ToolMechanics({ raw }: { raw: ItemRow }) {
  return (
    <div className="border-b border-gold/10 px-6 py-4 grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
      <DetailRow label="Tool Type" value={raw?.tool_type || '—'} />
      <DetailRow label="Proficiency Bonus" value={raw?.bonus != null && raw.bonus !== '' ? `+${raw.bonus}` : '—'} />
    </div>
  );
}

function OtherMechanics({ raw }: { raw: ItemRow }) {
  return (
    <div className="border-b border-gold/10 px-6 py-4 grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
      <DetailRow label="Quantity" value={raw?.quantity != null ? String(raw.quantity) : '—'} />
    </div>
  );
}

function formatWeight(weight: any): string {
  if (!weight) return '—';
  if (typeof weight === 'object') {
    const value = weight.value ?? 0;
    const units = weight.units || 'lb';
    return `${value} ${units}`;
  }
  return `${weight}`;
}

function formatPrice(price: any): string {
  if (!price) return '—';
  if (typeof price === 'object') {
    const value = price.value ?? 0;
    const denomination = price.denomination || 'gp';
    return `${value} ${denomination}`;
  }
  return `${price}`;
}

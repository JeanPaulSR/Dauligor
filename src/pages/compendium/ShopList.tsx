import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchCollection } from '../../lib/d1';
import { Button } from '../../components/ui/button';
import {
  CompendiumBrowserShell,
  type CompendiumColumn,
} from '../../components/compendium/CompendiumBrowserShell';
import { useAxisFilters } from '../../hooks/useAxisFilters';
import ShopDetailPanel from '../../components/compendium/ShopDetailPanel';

/**
 * Public shops browser — lists shops and, per shop, its stock + prices. Read-only;
 * buy/sell is a later phase (needs a character currency wallet). Items load slim
 * (id / name / price) to resolve the stocked entries in the detail panel.
 */

type ShopRow = {
  id: string;
  name?: string;
  identifier?: string;
  description?: string;
  imageUrl?: string;
  shopItems?: { itemId: string; priceOverride?: any }[];
  [key: string]: any;
};

const NO_AXES = [] as const;

export default function ShopList({ userProfile }: { userProfile: any }) {
  const [shops, setShops] = useState<ShopRow[]>([]);
  const [itemById, setItemById] = useState<Record<string, { name?: string; price?: any }>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState('');

  const { axisFilters, cyclers, activeFilterCount, resetAll: resetFilters } = useAxisFilters(NO_AXES);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const settled = await Promise.allSettled([
        fetchCollection<any>('shops', { orderBy: 'name ASC' }),
        fetchCollection<any>('items', { select: 'id, name, price', orderBy: 'name ASC' }),
      ]);
      if (cancelled) return;
      const pick = <T,>(r: PromiseSettledResult<T[]>, label: string): T[] => {
        if (r.status === 'fulfilled') return r.value;
        console.error(`[ShopList] failed to load ${label}:`, r.reason);
        return [];
      };
      const [shopRes, itemRes] = settled;
      setShops(pick(shopRes, 'shops') as ShopRow[]);
      setItemById(Object.fromEntries((pick(itemRes, 'items') as any[]).map((i) => [String(i.id), { name: i.name, price: i.price }])));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return shops;
    return shops.filter((s) => (s.name || '').toLowerCase().includes(q) || (s.identifier || '').toLowerCase().includes(q));
  }, [shops, search]);

  const columns = useMemo<CompendiumColumn<ShopRow>[]>(() => ([
    { key: 'name', label: 'Shop', width: 'minmax(0,1fr)', alwaysVisible: true, align: 'start', render: (s) => <span className="truncate font-serif text-sm text-ink">{s.name}</span> },
    { key: 'count', label: 'Items', width: '70px', render: (s) => <span className="text-xs text-ink/75 justify-self-center">{Array.isArray(s.shopItems) ? s.shopItems.length : 0}</span> },
  ]), []);

  const selectedRow = useMemo(() => shops.find((s) => s.id === selectedId) || null, [shops, selectedId]);

  return (
    <CompendiumBrowserShell<ShopRow>
      rows={filtered}
      allRows={shops}
      loading={loading}
      getRowId={(s) => s.id}
      selectedId={selectedId}
      onSelect={setSelectedId}
      search={search}
      onSearchChange={setSearch}
      searchPlaceholder="Search shops…"
      filterAxes={[]}
      axisFilters={axisFilters}
      cyclers={cyclers}
      activeFilterCount={activeFilterCount}
      onResetFilters={resetFilters}
      hideFilters
      columns={columns}
      columnsLocalStorageKey="dauligor.shopsListColumns"
      hideFavorites
      detailPanel={<ShopDetailPanel row={selectedRow} itemById={itemById} />}
      emptyMessage="No shops yet."
      trailingActions={
        userProfile?.role === 'admin' ? (
          <Link to="/compendium/shops/manage">
            <Button type="button" variant="outline" size="sm" className="h-8 border-gold/25 text-gold hover:bg-gold/5">
              Shop Manager
            </Button>
          </Link>
        ) : null
      }
    />
  );
}

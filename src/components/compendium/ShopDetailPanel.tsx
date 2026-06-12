import React, { useEffect, useState } from 'react';
import { Store } from 'lucide-react';
import { bbcodeToHtml } from '../../lib/bbcode';

/**
 * Read-only detail panel for a `shops` row — the shop's stock and prices. Used by
 * the public Shops browser. A line's price is the per-entry override, else the
 * item's own price. No buy/sell yet (that needs a character currency wallet).
 */

export type ShopDetailRow = {
  id?: string;
  name?: string;
  imageUrl?: string;
  description?: string;
  shopItems?: { itemId: string; priceOverride?: any }[];
  [key: string]: any;
};

export interface ShopDetailPanelProps {
  row: ShopDetailRow | null;
  /** id → { name, price } for resolving stocked items. */
  itemById?: Record<string, { name?: string; price?: any }>;
  emptyMessage?: string;
}

function formatPrice(p: any): string {
  if (!p || typeof p.value !== 'number') return '—';
  return `${p.value} ${p.denomination || 'gp'}`;
}

function ShopArtPreview({ src, alt, size }: { src?: string; alt: string; size: number }) {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    if (!src) { setOk(false); return; }
    let cancelled = false;
    const img = new Image();
    img.onload = () => { if (!cancelled) setOk(true); };
    img.onerror = () => { if (!cancelled) setOk(false); };
    img.src = src;
    return () => { cancelled = true; };
  }, [src]);
  return (
    <div className="relative shrink-0 overflow-hidden rounded-md border border-gold/15 bg-background/30" style={{ width: size, height: size }}>
      {src && ok ? (
        <img src={src} alt={alt} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-gold/40"><Store className="h-8 w-8" /></div>
      )}
    </div>
  );
}

export default function ShopDetailPanel({
  row, itemById = {},
  emptyMessage = 'Select a shop from the list to view its stock.',
}: ShopDetailPanelProps) {
  if (!row) {
    return <div className="px-6 py-12 text-center text-ink/55">{emptyMessage}</div>;
  }
  const stock = Array.isArray(row.shopItems) ? row.shopItems.filter((s) => s?.itemId) : [];

  return (
    <div className="space-y-0">
      <div className="border-b border-gold/15 bg-[linear-gradient(180deg,rgba(255,255,255,0.02),transparent)] px-6 py-5">
        <div className="flex items-start gap-5">
          <ShopArtPreview src={row.imageUrl} alt={row.name || 'Shop'} size={88} />
          <div className="flex-1 min-w-0 space-y-2">
            <h3 className="font-serif text-3xl font-bold text-ink">{row.name || '—'}</h3>
            <div className="text-sm text-ink/70">{stock.length} item{stock.length === 1 ? '' : 's'} for sale</div>
          </div>
        </div>
      </div>

      {row.description ? (
        <div className="border-b border-gold/15 prose prose-sm max-w-none px-6 py-4 text-ink/90" dangerouslySetInnerHTML={{ __html: bbcodeToHtml(row.description) }} />
      ) : null}

      <div className="px-6 py-4">
        <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-gold/75 mb-1.5">Stock &amp; prices</div>
        {stock.length === 0 ? (
          <div className="text-ink/50 text-sm italic">This shop has no items stocked.</div>
        ) : (
          <ul className="divide-y divide-gold/10 text-sm">
            {stock.map((s, i) => (
              <li key={i} className="flex justify-between gap-3 py-1.5">
                <span className="truncate text-ink">{itemById[s.itemId]?.name || 'Unknown item'}</span>
                <span className="text-gold/85 font-bold shrink-0">{formatPrice(s.priceOverride || itemById[s.itemId]?.price)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

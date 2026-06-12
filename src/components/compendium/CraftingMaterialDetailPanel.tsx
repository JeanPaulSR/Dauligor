import React, { useEffect, useState } from 'react';
import { Boxes } from 'lucide-react';
import { bbcodeToHtml } from '../../lib/bbcode';

/**
 * Read-only detail panel for a `crafting_materials` row. Used by the public
 * Crafting Materials browser (right pane of the 3-col CompendiumBrowserShell)
 * and reusable as a live-preview elsewhere. Mirrors ItemDetailPanel's header +
 * detail-grid + BBCode-description structure, scoped to a material's fields.
 */

export type MaterialDetailSource = {
  id: string;
  name?: string;
  abbreviation?: string;
  shortName?: string;
  [key: string]: any;
};

export type MaterialDetailRow = {
  id?: string;
  name?: string;
  identifier?: string;
  imageUrl?: string;
  category?: string;
  rarity?: string;
  subtype?: string;
  usedFor?: string[];
  price?: any;
  weight?: any;
  description?: string;
  [key: string]: any;
};

export interface MaterialDetailPanelProps {
  row: MaterialDetailRow | null;
  source: MaterialDetailSource | undefined;
  /** id → discipline name, to render `usedFor`. */
  disciplineNameById?: Record<string, string>;
  emptyMessage?: string;
}

const CATEGORY_LABEL: Record<string, string> = {
  reagent: 'Reagent', essence: 'Essence', magicalInk: 'Magical Ink', metal: 'Metal',
  hide: 'Hide', wood: 'Wood', part: 'Part', gem: 'Gem', cookingSupply: 'Cooking Supply', misc: 'Misc',
};
const RARITY_LABEL: Record<string, string> = {
  trivial: 'Trivial', common: 'Common', uncommon: 'Uncommon', rare: 'Rare',
  veryRare: 'Very Rare', legendary: 'Legendary',
};

function formatPrice(price: any): string {
  if (!price || typeof price.value !== 'number') return '—';
  return `${price.value} ${price.denomination || 'gp'}`;
}
function formatWeight(weight: any): string {
  if (!weight || typeof weight.value !== 'number') return '—';
  return `${weight.value} ${weight.units || 'lb'}`;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-gold/75">{label}</div>
      <div className="text-ink">{value}</div>
    </div>
  );
}

// Probe the image first so a broken/missing URL falls back to a glyph instead
// of rendering a broken image (same approach as ItemDetailPanel's art preview).
function MaterialArtPreview({ src, alt, size }: { src?: string; alt: string; size: number }) {
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
    <div
      className="relative shrink-0 overflow-hidden rounded-md border border-gold/15 bg-background/30"
      style={{ width: size, height: size }}
    >
      {src && ok ? (
        <img src={src} alt={alt} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-gold/40">
          <Boxes className="h-8 w-8" />
        </div>
      )}
    </div>
  );
}

export default function CraftingMaterialDetailPanel({
  row,
  source,
  disciplineNameById = {},
  emptyMessage = 'Select a material from the list to view its details.',
}: MaterialDetailPanelProps) {
  if (!row) {
    return (
      <div className="px-6 py-12 text-center text-ink/55">
        {emptyMessage}
      </div>
    );
  }

  const categoryLabel = CATEGORY_LABEL[row.category || ''] || row.category || '—';
  const rarityLabel = row.rarity ? (RARITY_LABEL[row.rarity] || row.rarity) : '';
  const sourceAbbrev = source?.abbreviation || source?.shortName || '';
  const used = Array.isArray(row.usedFor) ? row.usedFor : [];
  const usedLabel = used.length ? used.map((d) => disciplineNameById[d] || d).join(', ') : '—';
  const subtitle = [categoryLabel, rarityLabel].filter(Boolean).join(' · ');

  return (
    <div className="space-y-0">
      <div className="border-b border-gold/15 bg-[linear-gradient(180deg,rgba(255,255,255,0.02),transparent)] px-6 py-5">
        <div className="flex items-start gap-5">
          <MaterialArtPreview src={row.imageUrl} alt={row.name || 'Material'} size={88} />
          <div className="flex-1 min-w-0 space-y-2">
            <h3 className="font-serif text-3xl font-bold text-ink">{row.name || '—'}</h3>
            <div className="flex items-center gap-3 flex-wrap text-sm text-ink/70">
              {subtitle && <span>{subtitle}</span>}
              {sourceAbbrev && <span className="font-bold text-gold/85">{sourceAbbrev}</span>}
            </div>
          </div>
        </div>
      </div>

      <div className="border-b border-gold/15 px-6 py-4 grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
        {row.subtype ? <DetailRow label="Subtype" value={row.subtype} /> : null}
        <DetailRow label="Used For" value={usedLabel} />
        <DetailRow label="Price" value={formatPrice(row.price)} />
        <DetailRow label="Weight" value={formatWeight(row.weight)} />
      </div>

      {row.description ? (
        <div
          className="prose prose-sm max-w-none px-6 py-4 text-ink/90"
          dangerouslySetInnerHTML={{ __html: bbcodeToHtml(row.description) }}
        />
      ) : null}
    </div>
  );
}

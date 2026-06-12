import React, { useEffect, useState } from 'react';
import { Hammer } from 'lucide-react';
import { bbcodeToHtml } from '../../lib/bbcode';

/**
 * Read-only detail panel for a `recipes` row — used by the public Recipes
 * browser. Mirrors the materials/items detail-panel structure (header + detail
 * grid + BBCode description), scoped to a recipe's fields. Output / input /
 * discipline names are resolved by the parent via the *ById maps.
 */

export type RecipeDetailSource = {
  id: string;
  name?: string;
  abbreviation?: string;
  shortName?: string;
  [key: string]: any;
};

export type RecipeDetailRow = {
  id?: string;
  name?: string;
  imageUrl?: string;
  description?: string;
  disciplineId?: string;
  outputType?: string;
  outputItemId?: string;
  outputEnchantmentId?: string;
  outputBaseItemId?: string;
  outputQuantity?: number;
  inputs?: { kind?: string; itemId?: string; category?: string; subtype?: string; rarity?: string; quantity: number }[];
  goldCost?: any;
  craftTime?: any;
  craftChecks?: number | null;
  craftDifficultyDC?: number | null;
  [key: string]: any;
};

export interface RecipeDetailPanelProps {
  row: RecipeDetailRow | null;
  source: RecipeDetailSource | undefined;
  disciplineNameById?: Record<string, string>;
  itemNameById?: Record<string, string>;
  enchantmentNameById?: Record<string, string>;
  emptyMessage?: string;
}

const OUTPUT_LABEL: Record<string, string> = {
  item: 'Item', enchantment: 'Enchantment', 'enchant-item': 'Enchanted Item',
};
const MAT_CATEGORY_LABEL: Record<string, string> = {
  reagent: 'Reagent', essence: 'Essence', magicalInk: 'Magical Ink', metal: 'Metal',
  hide: 'Hide', wood: 'Wood', part: 'Part', gem: 'Gem', cookingSupply: 'Cooking Supply', misc: 'Misc',
};
const MAT_RARITY_LABEL: Record<string, string> = {
  trivial: 'Trivial', common: 'Common', uncommon: 'Uncommon', rare: 'Rare', veryRare: 'Very Rare', legendary: 'Legendary',
};

// Readable label for a recipe input — a specific item name, or a material-slot
// phrase like "Common Curative Reagent" / "Any Metal".
function inputLabel(inp: any, itemNameById: Record<string, string>): string {
  if (inp?.kind === 'slot' || !inp?.itemId) {
    const r = inp?.rarity ? (MAT_RARITY_LABEL[inp.rarity] || inp.rarity) : 'Any';
    const cat = MAT_CATEGORY_LABEL[inp?.category || ''] || inp?.category || 'material';
    const sub = inp?.subtype ? `${inp.subtype} ` : '';
    return `${r} ${sub}${cat}`;
  }
  return itemNameById[inp.itemId] || 'Unknown item';
}

function formatCoin(c: any): string {
  if (!c || typeof c.value !== 'number') return '—';
  return `${c.value} ${c.denomination || 'gp'}`;
}
function formatTime(t: any): string {
  if (!t || typeof t.value !== 'number') return '—';
  const unit = t.unit || 'hour';
  return `${t.value} ${unit}${t.value === 1 ? '' : 's'}`;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-gold/75">{label}</div>
      <div className="text-ink">{value}</div>
    </div>
  );
}

function RecipeArtPreview({ src, alt, size }: { src?: string; alt: string; size: number }) {
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
        <div className="flex h-full w-full items-center justify-center text-gold/40"><Hammer className="h-8 w-8" /></div>
      )}
    </div>
  );
}

export default function RecipeDetailPanel({
  row, source,
  disciplineNameById = {}, itemNameById = {}, enchantmentNameById = {},
  emptyMessage = 'Select a recipe from the list to view its details.',
}: RecipeDetailPanelProps) {
  if (!row) {
    return <div className="px-6 py-12 text-center text-ink/55">{emptyMessage}</div>;
  }

  const disciplineLabel = row.disciplineId ? (disciplineNameById[row.disciplineId] || '—') : '—';
  const sourceAbbrev = source?.abbreviation || source?.shortName || '';

  let outputText = '—';
  if (row.outputType === 'item') {
    const n = row.outputItemId ? (itemNameById[row.outputItemId] || 'Unknown item') : '—';
    outputText = row.outputQuantity && row.outputQuantity > 1 ? `${n} ×${row.outputQuantity}` : n;
  } else if (row.outputType === 'enchantment') {
    outputText = row.outputEnchantmentId ? (enchantmentNameById[row.outputEnchantmentId] || 'Unknown enchantment') : '—';
  } else if (row.outputType === 'enchant-item') {
    const ench = row.outputEnchantmentId ? (enchantmentNameById[row.outputEnchantmentId] || 'Unknown enchantment') : '—';
    const base = row.outputBaseItemId ? (itemNameById[row.outputBaseItemId] || 'Unknown base') : 'any valid base';
    outputText = `${ench} → ${base}`;
  }

  const inputs = Array.isArray(row.inputs) ? row.inputs.filter((i) => i && (i.itemId || i.category)) : [];

  return (
    <div className="space-y-0">
      <div className="border-b border-gold/15 bg-[linear-gradient(180deg,rgba(255,255,255,0.02),transparent)] px-6 py-5">
        <div className="flex items-start gap-5">
          <RecipeArtPreview src={row.imageUrl} alt={row.name || 'Recipe'} size={88} />
          <div className="flex-1 min-w-0 space-y-2">
            <h3 className="font-serif text-3xl font-bold text-ink">{row.name || '—'}</h3>
            <div className="flex items-center gap-3 flex-wrap text-sm text-ink/70">
              <span>Recipe{disciplineLabel !== '—' ? ` · ${disciplineLabel}` : ''}</span>
              {sourceAbbrev && <span className="font-bold text-gold/85">{sourceAbbrev}</span>}
            </div>
          </div>
        </div>
      </div>

      <div className="border-b border-gold/15 px-6 py-4 grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
        <DetailRow label="Makes" value={`${OUTPUT_LABEL[row.outputType || 'item'] || row.outputType || '—'}: ${outputText}`} />
        <DetailRow label="Gold Cost" value={formatCoin(row.goldCost)} />
        <DetailRow label="Craft Time" value={formatTime(row.craftTime)} />
        {typeof row.craftChecks === 'number' ? <DetailRow label="Checks" value={String(row.craftChecks)} /> : null}
        {typeof row.craftDifficultyDC === 'number' ? <DetailRow label="DC" value={String(row.craftDifficultyDC)} /> : null}
      </div>

      <div className="border-b border-gold/15 px-6 py-4">
        <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-gold/75 mb-1.5">Inputs</div>
        {inputs.length === 0 ? (
          <div className="text-ink/50 text-sm italic">No inputs recorded.</div>
        ) : (
          <ul className="space-y-0.5 text-sm text-ink">
            {inputs.map((inp, i) => (
              <li key={i} className="flex justify-between gap-3">
                <span className="truncate">{inputLabel(inp, itemNameById)}</span>
                <span className="text-ink/60 shrink-0">×{inp.quantity || 1}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {row.description ? (
        <div className="prose prose-sm max-w-none px-6 py-4 text-ink/90" dangerouslySetInnerHTML={{ __html: bbcodeToHtml(row.description) }} />
      ) : null}
    </div>
  );
}

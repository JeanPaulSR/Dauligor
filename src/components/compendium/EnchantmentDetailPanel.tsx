import React, { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { bbcodeToHtml } from '../../lib/bbcode';

/**
 * Read-only detail panel for an `enchantments` row — used by the public
 * Enchantments browser. Mirrors the materials/recipe detail-panel structure.
 */

export type EnchantmentDetailSource = {
  id: string; name?: string; abbreviation?: string; shortName?: string; [key: string]: any;
};

export type EnchantmentDetailRow = {
  id?: string; name?: string; imageUrl?: string; description?: string;
  restrictions?: any; activities?: any[]; effects?: any[];
  magicalBonus?: number | null; rarity?: string; attunement?: string; price?: any;
  [key: string]: any;
};

export interface EnchantmentDetailPanelProps {
  row: EnchantmentDetailRow | null;
  source: EnchantmentDetailSource | undefined;
  /** id → readable name for restriction category / property slugs (optional). */
  restrictionNameById?: Record<string, string>;
  emptyMessage?: string;
}

const APPLIES_TO_LABEL: Record<string, string> = {
  '': 'Any', container: 'Container', consumable: 'Consumable', equipment: 'Equipment',
  feat: 'Feature', loot: 'Loot', spell: 'Spell', tool: 'Tool', weapon: 'Weapon',
};
const ATTUNEMENT_LABEL: Record<string, string> = {
  required: 'Required', optional: 'Optional',
};

function formatCoin(c: any): string {
  if (!c || typeof c.value !== 'number') return '—';
  return `${c.value} ${c.denomination || 'gp'}`;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-gold/75">{label}</div>
      <div className="text-ink">{value}</div>
    </div>
  );
}

function EnchantArtPreview({ src, alt, size }: { src?: string; alt: string; size: number }) {
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
        <div className="flex h-full w-full items-center justify-center text-gold/40"><Sparkles className="h-8 w-8" /></div>
      )}
    </div>
  );
}

export default function EnchantmentDetailPanel({
  row, source, restrictionNameById = {},
  emptyMessage = 'Select an enchantment from the list to view its details.',
}: EnchantmentDetailPanelProps) {
  if (!row) {
    return <div className="px-6 py-12 text-center text-ink/55">{emptyMessage}</div>;
  }

  const r = row.restrictions || {};
  const appliesTo = APPLIES_TO_LABEL[r.type || ''] || r.type || 'Any';
  const sourceAbbrev = source?.abbreviation || source?.shortName || '';
  const nameOf = (id: string) => restrictionNameById[id] || id;
  const categories: string[] = Array.isArray(r.categories) ? r.categories : [];
  const properties: string[] = Array.isArray(r.properties) ? r.properties : [];
  const activityCount = Array.isArray(row.activities) ? row.activities.length : 0;
  const effectCount = Array.isArray(row.effects) ? row.effects.length : 0;
  const subtitle = ['Enchantment', row.rarity || ''].filter(Boolean).join(' · ');

  return (
    <div className="space-y-0">
      <div className="border-b border-gold/15 bg-[linear-gradient(180deg,rgba(255,255,255,0.02),transparent)] px-6 py-5">
        <div className="flex items-start gap-5">
          <EnchantArtPreview src={row.imageUrl} alt={row.name || 'Enchantment'} size={88} />
          <div className="flex-1 min-w-0 space-y-2">
            <h3 className="font-serif text-3xl font-bold text-ink">{row.name || '—'}</h3>
            <div className="flex items-center gap-3 flex-wrap text-sm text-ink/70">
              <span>{subtitle}</span>
              {sourceAbbrev && <span className="font-bold text-gold/85">{sourceAbbrev}</span>}
            </div>
          </div>
        </div>
      </div>

      <div className="border-b border-gold/15 px-6 py-4 grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
        <DetailRow label="Applies To" value={appliesTo} />
        {typeof row.magicalBonus === 'number' ? <DetailRow label="Magic Bonus" value={`+${row.magicalBonus}`} /> : null}
        {row.attunement ? <DetailRow label="Attunement" value={ATTUNEMENT_LABEL[row.attunement] || row.attunement} /> : null}
        <DetailRow label="Price Delta" value={formatCoin(row.price)} />
        <DetailRow label="Grants" value={`${activityCount} activit${activityCount === 1 ? 'y' : 'ies'} · ${effectCount} effect${effectCount === 1 ? '' : 's'}`} />
      </div>

      {(categories.length > 0 || properties.length > 0 || r.allowMagical) && (
        <div className="border-b border-gold/15 px-6 py-4 space-y-2 text-sm">
          {categories.length > 0 && (
            <div><span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gold/75">Valid Categories</span><div className="text-ink">{categories.map(nameOf).join(', ')}</div></div>
          )}
          {properties.length > 0 && (
            <div><span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gold/75">Valid Properties</span><div className="text-ink">{properties.map(nameOf).join(', ')}</div></div>
          )}
          {r.allowMagical && <div className="text-ink/70 text-xs italic">Can be applied to already-magical items.</div>}
        </div>
      )}

      {row.description ? (
        <div className="prose prose-sm max-w-none px-6 py-4 text-ink/90" dangerouslySetInnerHTML={{ __html: bbcodeToHtml(row.description) }} />
      ) : null}
    </div>
  );
}

import React from 'react';
import { Star } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * Read-only detail panel for a unified-items-table row. Used by:
 *   - Public ItemList page (right pane in the 3-col CompendiumBrowserShell)
 *   - Admin ItemsEditor (live-preview pane on the right of the editor shell)
 *
 * The panel switches the middle "mechanics" section by `row.item_type`:
 *   weapon       → damage + range + magic bonus + properties
 *   equipment    → armor block (when armor_value is set) or skipped
 *   tool         → tool category + check bonus
 *   else         → quantity-only OtherMechanics block
 *
 * The row shape accepted is intentionally lenient — handles both the
 * snake_case row from queryD1 (`row.item_type`, `row.base_item`) and
 * the lightly camelCased shape ItemsEditor stores in `entries`
 * (`row.itemType`, `row.imageUrl`). Fall-through is preferred over
 * forcing the caller to pre-normalize.
 */

export type ItemDetailSource = {
  id: string;
  name?: string;
  abbreviation?: string;
  shortName?: string;
  [key: string]: any;
};

export type ItemDetailRow = {
  id?: string;
  name?: string;
  identifier?: string;
  item_type?: string;
  itemType?: string;
  rarity?: string;
  attunement?: any;
  attunementFlag?: boolean;
  magical?: any;
  magicalFlag?: boolean;
  weight?: any;
  price?: any;
  description?: string;
  base_item?: string;
  baseItem?: string;
  base_weapon_id?: string | null;
  base_armor_id?: string | null;
  base_tool_id?: string | null;
  baseWeaponId?: string | null;
  baseArmorId?: string | null;
  baseToolId?: string | null;
  resolvedBaseItemName?: string;
  // Weapon stats
  damage?: any;
  range?: any;
  mastery?: string;
  magical_bonus?: number;
  magicalBonus?: number;
  properties?: string[];
  // Armor stats
  armor_value?: number;
  armorValue?: number;
  armor_dex?: number | null;
  armorDex?: number | null;
  armor_magical_bonus?: number;
  armorMagicalBonus?: number;
  strength?: number | null;
  armor_type?: string;
  armorType?: string;
  stealth?: boolean;
  // Tool stats
  tool_type?: string;
  toolType?: string;
  bonus?: string;
  // General
  quantity?: number;
  [key: string]: any;
};

export interface ItemDetailPanelProps {
  row: ItemDetailRow | null;
  source: ItemDetailSource | undefined;
  /** When provided, shows a star-toggle button next to the title.
   *  Both `starred` AND `onToggleFavorite` must be set to render it. */
  starred?: boolean;
  onToggleFavorite?: () => void;
  /** Override the empty-state copy. */
  emptyMessage?: string;
}

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

export default function ItemDetailPanel({
  row,
  source,
  starred,
  onToggleFavorite,
  emptyMessage = 'Select an item from the list to view its details.',
}: ItemDetailPanelProps) {
  if (!row) {
    return (
      <div className="px-6 py-12 text-center text-ink/50">
        {emptyMessage}
      </div>
    );
  }

  const itemType = String(row.item_type ?? row.itemType ?? '');
  const rarityLabel = RARITY_LABEL[row.rarity || 'none'];
  const typeLabel = ITEM_TYPE_LABEL[itemType] || itemType || 'Loot';
  // Compute the "needs attunement" flag tolerantly across both 3-state
  // TEXT (post 20260526-1700) and legacy boolean shapes. The
  // attunementFlag pre-computation from ItemList wins when set.
  const needsAttunement = row.attunementFlag != null
    ? row.attunementFlag
    : (row.attunement === 1 || row.attunement === true
        || (typeof row.attunement === 'string' && row.attunement.length > 0));
  const isMagical = row.magicalFlag != null
    ? row.magicalFlag
    : (row.magical === 1 || row.magical === true);

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
          {needsAttunement ? ' · requires attunement' : ''}
          {isMagical ? ' · magical' : ''}
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
      {itemType === 'equipment' && (row.armor_value != null || row.armorValue != null) && <ArmorMechanics raw={row} />}
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

// ─── Internal helpers ─────────────────────────────────────────────

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-gold/70">{label}</div>
      <div className={cn('mt-1 text-sm text-ink/90', mono && 'font-mono text-xs')}>{value || '—'}</div>
    </div>
  );
}

function WeaponMechanics({ raw }: { raw: ItemDetailRow }) {
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
  const magicBonus = raw?.magical_bonus ?? raw?.magicalBonus ?? 0;
  return (
    <div className="border-b border-gold/10 px-6 py-4 grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
      <DetailRow label="Damage" value={damageStr ? `${damageStr}${damageTypes ? ' ' + damageTypes : ''}` : '—'} />
      <DetailRow label="Range" value={rangeStr || '—'} />
      <DetailRow label="Mastery" value={raw?.mastery || '—'} />
      {magicBonus ? <DetailRow label="Magic Bonus" value={`+${magicBonus}`} /> : null}
      {Array.isArray(raw?.properties) && raw.properties.length > 0 ? (
        <DetailRow label="Properties" value={raw.properties.join(', ')} />
      ) : null}
    </div>
  );
}

function ArmorMechanics({ raw }: { raw: ItemDetailRow }) {
  const ac = raw?.armor_value ?? raw?.armorValue;
  const dex = raw?.armor_dex ?? raw?.armorDex;
  const magicBonus = raw?.armor_magical_bonus ?? raw?.armorMagicalBonus ?? 0;
  const armorType = raw?.armor_type ?? raw?.armorType;
  return (
    <div className="border-b border-gold/10 px-6 py-4 grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
      <DetailRow label="Armor Class" value={ac != null ? String(ac) : '—'} />
      <DetailRow label="Dex Cap" value={dex != null ? String(dex) : '—'} />
      <DetailRow label="Strength Req" value={raw?.strength ? String(raw.strength) : '—'} />
      <DetailRow label="Stealth" value={raw?.stealth ? 'Disadvantage' : 'Normal'} />
      {armorType ? <DetailRow label="Type" value={String(armorType)} /> : null}
      {magicBonus ? <DetailRow label="Magic Bonus" value={`+${magicBonus}`} /> : null}
    </div>
  );
}

function ToolMechanics({ raw }: { raw: ItemDetailRow }) {
  const toolType = raw?.tool_type ?? raw?.toolType;
  return (
    <div className="border-b border-gold/10 px-6 py-4 grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
      <DetailRow label="Tool Type" value={toolType || '—'} />
      <DetailRow label="Proficiency Bonus" value={raw?.bonus != null && raw.bonus !== '' ? `+${raw.bonus}` : '—'} />
    </div>
  );
}

function OtherMechanics({ raw }: { raw: ItemDetailRow }) {
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

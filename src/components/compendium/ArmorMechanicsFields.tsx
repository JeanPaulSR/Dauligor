import React from 'react';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Checkbox } from '../ui/checkbox';

/**
 * Root-level armor stat fields mirroring Foundry dnd5e v5's
 * `system.{armor:{value,dex,magicalBonus}, strength, stealth, type:{value}}`
 * plus the shared item shell (weight/price/rarity/attunement/baseItem).
 *
 * Shape rationale:
 *   - `armor.{value,dex,magicalBonus}` is Foundry's nested AC block.
 *     `dex` null means "no DEX cap" (medium armor uses 2, heavy 0).
 *   - `armor_type` is Foundry's `system.type.value` for equipment-armor
 *     subtypes (light/medium/heavy/shield/natural + clothing/trinket
 *     for non-armor equipment).
 *   - `strength` is the heavy-armor STR requirement (null = none).
 *   - `stealth` is a boolean Stealth-disadvantage flag.
 */

export type ItemWeight = { value: number; units: string };
export type ItemPrice = { value: number; denomination: string };

export interface ArmorMechanicsState {
  armorValue: number;
  armorDex: number | null;        // null = no cap
  armorMagicalBonus: number;
  strength: number | null;        // null = no STR req
  stealth: boolean;
  armorType: string;
  weight: ItemWeight;
  price: ItemPrice;
  rarity: string;
  attunement: string;
  baseItem: string;
}

export const ARMOR_MECHANICS_DEFAULTS: ArmorMechanicsState = {
  armorValue: 10,
  armorDex: null,
  armorMagicalBonus: 0,
  strength: null,
  stealth: false,
  armorType: 'light',
  weight: { value: 0, units: 'lb' },
  price: { value: 0, denomination: 'gp' },
  rarity: 'none',
  attunement: '',
  baseItem: '',
};

// Mirrors `CONFIG.DND5E.armorTypes` + `miscEquipmentTypes` for the
// non-armor `equipment` items that also live in the armor table.
const ARMOR_TYPE_OPTIONS = [
  { value: 'light',    label: 'Light Armor' },
  { value: 'medium',   label: 'Medium Armor' },
  { value: 'heavy',    label: 'Heavy Armor' },
  { value: 'shield',   label: 'Shield' },
  { value: 'natural',  label: 'Natural Armor' },
  { value: 'clothing', label: 'Clothing' },
  { value: 'trinket',  label: 'Trinket' },
  { value: 'wondrous', label: 'Wondrous Item' },
];

const RARITY_OPTIONS = ['none', 'common', 'uncommon', 'rare', 'veryRare', 'legendary', 'artifact'];
const ATTUNEMENT_OPTIONS = [
  { value: '', label: '— None —' },
  { value: 'required', label: 'Required' },
  { value: 'optional', label: 'Optional' },
];
const WEIGHT_UNIT_OPTIONS = ['lb', 'kg'];
const DENOMINATION_OPTIONS = ['cp', 'sp', 'ep', 'gp', 'pp'];

interface Props {
  state: ArmorMechanicsState;
  onChange: (next: ArmorMechanicsState) => void;
}

export default function ArmorMechanicsFields({ state, onChange }: Props) {
  const set = <K extends keyof ArmorMechanicsState>(key: K, value: ArmorMechanicsState[K]) =>
    onChange({ ...state, [key]: value });

  const setWeight = (patch: Partial<ItemWeight>) => set('weight', { ...state.weight, ...patch });
  const setPrice = (patch: Partial<ItemPrice>) => set('price', { ...state.price, ...patch });

  return (
    <div className="space-y-4 border border-gold/10 rounded-md p-4 bg-background/20">
      <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-gold">Armor Mechanics</h3>

      {/* ── AC + DEX CAP + MAGIC BONUS ────────────────────── */}
      <div className="grid md:grid-cols-4 gap-3">
        <div>
          <Label className="text-[10px] uppercase text-ink/40">Armor Type</Label>
          <select
            value={state.armorType}
            onChange={(e) => set('armorType', e.target.value)}
            className="w-full h-10 px-2 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-sm"
          >
            {ARMOR_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div>
          <Label className="text-[10px] uppercase text-ink/40">AC Value</Label>
          <Input
            type="number"
            value={state.armorValue}
            onChange={(e) => set('armorValue', parseInt(e.target.value || '0', 10) || 0)}
            className="bg-background/50 border-gold/10 focus:border-gold"
            placeholder="10"
          />
        </div>
        <div>
          <Label className="text-[10px] uppercase text-ink/40">Dex Cap</Label>
          <Input
            type="number"
            value={state.armorDex ?? ''}
            onChange={(e) => set('armorDex', e.target.value === '' ? null : parseInt(e.target.value, 10) || 0)}
            className="bg-background/50 border-gold/10 focus:border-gold"
            placeholder="— = no cap"
          />
        </div>
        <div>
          <Label className="text-[10px] uppercase text-ink/40">Magic Bonus</Label>
          <Input
            type="number"
            value={state.armorMagicalBonus}
            onChange={(e) => set('armorMagicalBonus', parseInt(e.target.value || '0', 10) || 0)}
            className="bg-background/50 border-gold/10 focus:border-gold"
            placeholder="0"
          />
        </div>
      </div>
      <p className="text-[10px] text-ink/40">
        Total AC = AC Value + min(Dex modifier, Dex Cap) + Magic Bonus. Shields use AC Value as the bonus to base AC instead.
      </p>

      {/* ── STR REQ + STEALTH DISADVANTAGE ────────────────── */}
      <div className="grid md:grid-cols-2 gap-3">
        <div>
          <Label className="text-[10px] uppercase text-ink/40">STR Requirement</Label>
          <Input
            type="number"
            value={state.strength ?? ''}
            onChange={(e) => set('strength', e.target.value === '' ? null : parseInt(e.target.value, 10) || 0)}
            className="bg-background/50 border-gold/10 focus:border-gold"
            placeholder="— = none"
          />
        </div>
        <label className="flex items-end justify-between gap-3 border border-gold/10 rounded-md p-3 h-[60px]">
          <div>
            <Label className="text-[10px] uppercase text-ink/40">Stealth Disadvantage</Label>
            <p className="text-[10px] text-ink/30 mt-1">Disadvantage on Stealth checks while wearing</p>
          </div>
          <Checkbox
            checked={state.stealth}
            onCheckedChange={(checked) => set('stealth', !!checked)}
          />
        </label>
      </div>

      {/* ── BASE ITEM ─────────────────────────────────────── */}
      <div>
        <Label className="text-[10px] uppercase text-ink/40">Base Item (SRD)</Label>
        <Input
          value={state.baseItem}
          onChange={(e) => set('baseItem', e.target.value)}
          placeholder="e.g. chainmail, plate, leather"
          className="bg-background/50 border-gold/10 focus:border-gold font-mono text-xs"
        />
      </div>

      {/* ── WEIGHT + PRICE ─────────────────────────────────── */}
      <div className="grid md:grid-cols-2 gap-3">
        <div>
          <Label className="text-[10px] uppercase text-ink/40">Weight</Label>
          <div className="flex gap-2">
            <Input
              type="number"
              step="0.1"
              value={state.weight.value}
              onChange={(e) => setWeight({ value: parseFloat(e.target.value) || 0 })}
              className="bg-background/50 border-gold/10 focus:border-gold"
            />
            <select
              value={state.weight.units}
              onChange={(e) => setWeight({ units: e.target.value })}
              className="h-10 px-3 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-sm w-20"
            >
              {WEIGHT_UNIT_OPTIONS.map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <Label className="text-[10px] uppercase text-ink/40">Price</Label>
          <div className="flex gap-2">
            <Input
              type="number"
              step="1"
              value={state.price.value}
              onChange={(e) => setPrice({ value: parseFloat(e.target.value) || 0 })}
              className="bg-background/50 border-gold/10 focus:border-gold"
            />
            <select
              value={state.price.denomination}
              onChange={(e) => setPrice({ denomination: e.target.value })}
              className="h-10 px-3 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-sm w-20"
            >
              {DENOMINATION_OPTIONS.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* ── RARITY + ATTUNEMENT ────────────────────────────── */}
      <div className="grid md:grid-cols-2 gap-3">
        <div>
          <Label className="text-[10px] uppercase text-ink/40">Rarity</Label>
          <select
            value={state.rarity}
            onChange={(e) => set('rarity', e.target.value)}
            className="w-full h-10 px-2 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-sm"
          >
            {RARITY_OPTIONS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>
        <div>
          <Label className="text-[10px] uppercase text-ink/40">Attunement</Label>
          <select
            value={state.attunement}
            onChange={(e) => set('attunement', e.target.value)}
            className="w-full h-10 px-2 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-sm"
          >
            {ATTUNEMENT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

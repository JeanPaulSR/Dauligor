import React from 'react';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { DAMAGE_TYPE_OPTIONS, DAMAGE_DIE_DENOMINATIONS } from './activity/constants';

/**
 * Root-level weapon stat fields mirroring Foundry dnd5e v5's
 * `system.{damage, range, mastery, magicalBonus, weight, price,
 *  rarity, attunement, baseItem}`. Rendered inside the WeaponsEditor's
 * ProficiencyEntityShell renderExtraFields slot.
 *
 * The data shape MUST match Foundry exactly so a future weapon
 * exporter can round-trip without unflattening:
 *
 *   damage: { base: { number, denomination, types[], bonus } }
 *   range:  { value, long, units, reach }
 *   weight: { value, units }       // 'lb' | 'kg'
 *   price:  { value, denomination } // cp | sp | ep | gp | pp
 *
 * Mastery slugs come from CONFIG.DND5E.weaponMasteries
 * (cleave/graze/nick/push/sap/slow/topple/vex).
 */

export type WeaponDamageBase = {
  number: number;
  denomination: number;
  types: string[];
  bonus: string;
};

export type WeaponDamage = {
  base: WeaponDamageBase;
};

export type WeaponRange = {
  value: number | null;
  long: number | null;
  units: string;
  reach: number | null;
};

export type ItemWeight = { value: number; units: string };
export type ItemPrice = { value: number; denomination: string };

export interface WeaponMechanicsState {
  damage: WeaponDamage;
  range: WeaponRange;
  mastery: string;
  magicalBonus: number;
  weight: ItemWeight;
  price: ItemPrice;
  rarity: string;
  attunement: string;
  baseItem: string;
}

export const WEAPON_MECHANICS_DEFAULTS: WeaponMechanicsState = {
  damage: { base: { number: 1, denomination: 6, types: [], bonus: '' } },
  range: { value: 5, long: null, units: 'ft', reach: 5 },
  mastery: '',
  magicalBonus: 0,
  weight: { value: 0, units: 'lb' },
  price: { value: 0, denomination: 'gp' },
  rarity: 'none',
  attunement: '',
  baseItem: '',
};

// Mirrors `CONFIG.DND5E.weaponMasteries` in dnd5e v5.3.1.
const MASTERY_OPTIONS = [
  { value: '', label: '— None —' },
  { value: 'cleave', label: 'Cleave' },
  { value: 'graze',  label: 'Graze' },
  { value: 'nick',   label: 'Nick' },
  { value: 'push',   label: 'Push' },
  { value: 'sap',    label: 'Sap' },
  { value: 'slow',   label: 'Slow' },
  { value: 'topple', label: 'Topple' },
  { value: 'vex',    label: 'Vex' },
];

const RARITY_OPTIONS = ['none', 'common', 'uncommon', 'rare', 'veryRare', 'legendary', 'artifact'];
const ATTUNEMENT_OPTIONS = [
  { value: '', label: '— None —' },
  { value: 'required', label: 'Required' },
  { value: 'optional', label: 'Optional' },
];
const RANGE_UNIT_OPTIONS = ['ft', 'mi'];
const WEIGHT_UNIT_OPTIONS = ['lb', 'kg'];
const DENOMINATION_OPTIONS = ['cp', 'sp', 'ep', 'gp', 'pp'];

interface Props {
  state: WeaponMechanicsState;
  onChange: (next: WeaponMechanicsState) => void;
}

export default function WeaponMechanicsFields({ state, onChange }: Props) {
  const set = <K extends keyof WeaponMechanicsState>(key: K, value: WeaponMechanicsState[K]) =>
    onChange({ ...state, [key]: value });

  const setDamageBase = (patch: Partial<WeaponDamageBase>) =>
    set('damage', { ...state.damage, base: { ...state.damage.base, ...patch } });

  const setRange = (patch: Partial<WeaponRange>) =>
    set('range', { ...state.range, ...patch });

  const setWeight = (patch: Partial<ItemWeight>) =>
    set('weight', { ...state.weight, ...patch });

  const setPrice = (patch: Partial<ItemPrice>) =>
    set('price', { ...state.price, ...patch });

  const toggleDamageType = (type: string) => {
    const present = state.damage.base.types.includes(type);
    setDamageBase({
      types: present
        ? state.damage.base.types.filter((t) => t !== type)
        : [...state.damage.base.types, type],
    });
  };

  return (
    <div className="space-y-4 border border-gold/15 rounded-md p-4 bg-background/20">
      <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-gold">Weapon Mechanics</h3>

      {/* ── DAMAGE ─────────────────────────────────────────── */}
      <div className="space-y-2">
        <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-gold/75">Damage</div>
        <div className="grid grid-cols-[80px_60px_1fr] gap-2 items-end">
          <div>
            <Label className="text-[10px] uppercase text-ink/45">Dice</Label>
            <Input
              type="number"
              min={0}
              value={state.damage.base.number}
              onChange={(e) => setDamageBase({ number: parseInt(e.target.value || '0', 10) || 0 })}
              className="bg-background/50 border-gold/15 focus:border-gold"
            />
          </div>
          <div>
            <Label className="text-[10px] uppercase text-ink/45">d</Label>
            <select
              value={state.damage.base.denomination}
              onChange={(e) => setDamageBase({ denomination: parseInt(e.target.value, 10) || 6 })}
              className="w-full h-10 px-2 rounded-md border border-gold/15 bg-background/50 focus:border-gold outline-none text-sm"
            >
              {DAMAGE_DIE_DENOMINATIONS.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-[10px] uppercase text-ink/45">Bonus</Label>
            <Input
              value={state.damage.base.bonus}
              onChange={(e) => setDamageBase({ bonus: e.target.value })}
              placeholder="e.g. @mod, 1d4, 2"
              className="bg-background/50 border-gold/15 focus:border-gold font-mono text-xs"
            />
          </div>
        </div>
        <div>
          <Label className="text-[10px] uppercase text-ink/45">Damage Types</Label>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {DAMAGE_TYPE_OPTIONS.map((opt) => {
              const active = state.damage.base.types.includes(opt.value);
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => toggleDamageType(opt.value)}
                  className={`rounded-md border px-2 py-0.5 text-[10px] uppercase tracking-tight transition-colors ${
                    active
                      ? 'border-gold bg-gold text-background'
                      : 'border-gold/15 bg-background/40 text-ink/65 hover:border-gold/35 hover:text-gold'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── RANGE ─────────────────────────────────────────── */}
      <div className="space-y-2">
        <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-gold/75">Range</div>
        <div className="grid grid-cols-4 gap-2 items-end">
          <div>
            <Label className="text-[10px] uppercase text-ink/45">Reach</Label>
            <Input
              type="number"
              min={0}
              value={state.range.reach ?? ''}
              onChange={(e) => setRange({ reach: e.target.value === '' ? null : parseInt(e.target.value, 10) || 0 })}
              className="bg-background/50 border-gold/15 focus:border-gold"
              placeholder="5"
            />
          </div>
          <div>
            <Label className="text-[10px] uppercase text-ink/45">Normal</Label>
            <Input
              type="number"
              min={0}
              value={state.range.value ?? ''}
              onChange={(e) => setRange({ value: e.target.value === '' ? null : parseInt(e.target.value, 10) || 0 })}
              className="bg-background/50 border-gold/15 focus:border-gold"
              placeholder="—"
            />
          </div>
          <div>
            <Label className="text-[10px] uppercase text-ink/45">Long</Label>
            <Input
              type="number"
              min={0}
              value={state.range.long ?? ''}
              onChange={(e) => setRange({ long: e.target.value === '' ? null : parseInt(e.target.value, 10) || 0 })}
              className="bg-background/50 border-gold/15 focus:border-gold"
              placeholder="—"
            />
          </div>
          <div>
            <Label className="text-[10px] uppercase text-ink/45">Units</Label>
            <select
              value={state.range.units}
              onChange={(e) => setRange({ units: e.target.value })}
              className="w-full h-10 px-2 rounded-md border border-gold/15 bg-background/50 focus:border-gold outline-none text-sm"
            >
              {RANGE_UNIT_OPTIONS.map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          </div>
        </div>
        <p className="text-[10px] text-ink/45">
          Reach is the melee threat radius; Normal / Long are the ranged increments. Leave fields blank for "not applicable".
        </p>
      </div>

      {/* ── MASTERY + MAGIC BONUS + BASE ITEM ─────────────── */}
      <div className="grid md:grid-cols-3 gap-3">
        <div>
          <Label className="text-[10px] uppercase text-ink/45">Mastery</Label>
          <select
            value={state.mastery}
            onChange={(e) => set('mastery', e.target.value)}
            className="w-full h-10 px-2 rounded-md border border-gold/15 bg-background/50 focus:border-gold outline-none text-sm"
          >
            {MASTERY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div>
          <Label className="text-[10px] uppercase text-ink/45">Magic Bonus</Label>
          <Input
            type="number"
            value={state.magicalBonus}
            onChange={(e) => set('magicalBonus', parseInt(e.target.value || '0', 10) || 0)}
            className="bg-background/50 border-gold/15 focus:border-gold"
            placeholder="0"
          />
        </div>
        <div>
          <Label className="text-[10px] uppercase text-ink/45">Base Item (SRD)</Label>
          <Input
            value={state.baseItem}
            onChange={(e) => set('baseItem', e.target.value)}
            placeholder="e.g. longsword"
            className="bg-background/50 border-gold/15 focus:border-gold font-mono text-xs"
          />
        </div>
      </div>

      {/* ── WEIGHT + PRICE ─────────────────────────────────── */}
      <div className="grid md:grid-cols-2 gap-3">
        <div>
          <Label className="text-[10px] uppercase text-ink/45">Weight</Label>
          <div className="flex gap-2">
            <Input
              type="number"
              step="0.1"
              value={state.weight.value}
              onChange={(e) => setWeight({ value: parseFloat(e.target.value) || 0 })}
              className="bg-background/50 border-gold/15 focus:border-gold"
            />
            <select
              value={state.weight.units}
              onChange={(e) => setWeight({ units: e.target.value })}
              className="h-10 px-3 rounded-md border border-gold/15 bg-background/50 focus:border-gold outline-none text-sm w-20"
            >
              {WEIGHT_UNIT_OPTIONS.map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <Label className="text-[10px] uppercase text-ink/45">Price</Label>
          <div className="flex gap-2">
            <Input
              type="number"
              step="1"
              value={state.price.value}
              onChange={(e) => setPrice({ value: parseFloat(e.target.value) || 0 })}
              className="bg-background/50 border-gold/15 focus:border-gold"
            />
            <select
              value={state.price.denomination}
              onChange={(e) => setPrice({ denomination: e.target.value })}
              className="h-10 px-3 rounded-md border border-gold/15 bg-background/50 focus:border-gold outline-none text-sm w-20"
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
          <Label className="text-[10px] uppercase text-ink/45">Rarity</Label>
          <select
            value={state.rarity}
            onChange={(e) => set('rarity', e.target.value)}
            className="w-full h-10 px-2 rounded-md border border-gold/15 bg-background/50 focus:border-gold outline-none text-sm"
          >
            {RARITY_OPTIONS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>
        <div>
          <Label className="text-[10px] uppercase text-ink/45">Attunement</Label>
          <select
            value={state.attunement}
            onChange={(e) => set('attunement', e.target.value)}
            className="w-full h-10 px-2 rounded-md border border-gold/15 bg-background/50 focus:border-gold outline-none text-sm"
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

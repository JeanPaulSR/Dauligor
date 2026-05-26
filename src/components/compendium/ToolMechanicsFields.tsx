import React from 'react';
import { Input } from '../ui/input';
import { Label } from '../ui/label';

/**
 * Root-level tool stat fields mirroring Foundry dnd5e v5's
 * `system.{type:{value, baseItem}, bonus}` plus the shared item shell
 * (weight/price/rarity/attunement). `system.ability` is already
 * tracked via the existing `ability_id` FK column.
 *
 * Tool type vocabulary mirrors `CONFIG.DND5E.toolTypes`:
 *   - art    → Artisan's Tools (alchemist, calligrapher, cook, smith, etc.)
 *   - game   → Gaming Set (cards, chess, dice)
 *   - music  → Musical Instrument (lute, lyre, drum, etc.)
 *   - vehicle → Vehicles (land/water)
 */

export type ItemWeight = { value: number; units: string };
export type ItemPrice = { value: number; denomination: string };

export interface ToolMechanicsState {
  toolType: string;
  baseItem: string;
  bonus: string;
  weight: ItemWeight;
  price: ItemPrice;
  rarity: string;
  attunement: string;
}

export const TOOL_MECHANICS_DEFAULTS: ToolMechanicsState = {
  toolType: 'art',
  baseItem: '',
  bonus: '',
  weight: { value: 0, units: 'lb' },
  price: { value: 0, denomination: 'gp' },
  rarity: 'none',
  attunement: '',
};

const TOOL_TYPE_OPTIONS = [
  { value: 'art',     label: 'Artisan\'s Tools' },
  { value: 'game',    label: 'Gaming Set' },
  { value: 'music',   label: 'Musical Instrument' },
  { value: 'vehicle', label: 'Vehicle' },
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
  state: ToolMechanicsState;
  onChange: (next: ToolMechanicsState) => void;
}

export default function ToolMechanicsFields({ state, onChange }: Props) {
  const set = <K extends keyof ToolMechanicsState>(key: K, value: ToolMechanicsState[K]) =>
    onChange({ ...state, [key]: value });

  const setWeight = (patch: Partial<ItemWeight>) => set('weight', { ...state.weight, ...patch });
  const setPrice = (patch: Partial<ItemPrice>) => set('price', { ...state.price, ...patch });

  return (
    <div className="space-y-4 border border-gold/10 rounded-md p-4 bg-background/20">
      <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-gold">Tool Mechanics</h3>

      {/* ── TYPE + BASE ITEM + BONUS ──────────────────────── */}
      <div className="grid md:grid-cols-3 gap-3">
        <div>
          <Label className="text-[10px] uppercase text-ink/40">Tool Type</Label>
          <select
            value={state.toolType}
            onChange={(e) => set('toolType', e.target.value)}
            className="w-full h-10 px-2 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-sm"
          >
            {TOOL_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div>
          <Label className="text-[10px] uppercase text-ink/40">Base Item (SRD)</Label>
          <Input
            value={state.baseItem}
            onChange={(e) => set('baseItem', e.target.value)}
            placeholder="e.g. alchemist, lute, smith"
            className="bg-background/50 border-gold/10 focus:border-gold font-mono text-xs"
          />
        </div>
        <div>
          <Label className="text-[10px] uppercase text-ink/40">Flat Bonus</Label>
          <Input
            value={state.bonus}
            onChange={(e) => set('bonus', e.target.value)}
            placeholder="e.g. +2, 1d4"
            className="bg-background/50 border-gold/10 focus:border-gold font-mono text-xs"
          />
        </div>
      </div>
      <p className="text-[10px] text-ink/40">
        Bonus is added flat to checks made with this tool. The default check ability comes from the proficiency's Ability field above.
      </p>

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

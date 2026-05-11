import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Checkbox } from '../../ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';
import EntityPicker from '../../ui/EntityPicker';
import {
  DAMAGE_TYPE_OPTIONS,
  DAMAGE_DIE_DENOMINATIONS,
  DAMAGE_SCALING_MODE_OPTIONS,
} from './constants';

/**
 * Damage-part shape — same `parts[]` element type the dnd5e 5.x
 * `damage` and `healing` activity sections store. Each part is one
 * damage roll component (Xd6 + Y of type Z, optionally scaling per
 * level, optionally with a custom formula override).
 *
 * Used by:
 *   - attack activities (single primary damage roll)
 *   - save activities (damage roll with onSave handler)
 *   - damage activities (direct damage, no attack)
 *   - heal activities (single healing roll — singlePart=true)
 */
export interface DamagePart {
  number?: number | null;
  denomination?: number | null;
  bonus?: string;
  types?: string[];
  custom?: { enabled: boolean; formula: string };
  scaling?: { mode: string; number?: number; formula?: string };
}

export interface DamagePartEditorProps {
  parts: DamagePart[];
  onChange: (next: DamagePart[]) => void;
  /**
   * When true, omits the "Add Damage Part" affordance and renders a
   * help note instead — heal activities only ever have one healing
   * roll, so the per-part list is fixed-length.
   */
  singlePart?: boolean;
  /** Label on the empty-list message + Add button. Defaults to "Damage Part". */
  partNoun?: string;
}

/**
 * Editor for the `parts[]` array on a damage/healing activity
 * section. One card per part, with controls for number of dice,
 * denomination, flat bonus, damage type chips, custom-formula
 * override, and per-level scaling.
 *
 * Extracted out of ActivityEditor (commit "ActivityEditor: extract
 * DamagePartEditor sub-component") so the same surface is used
 * across attack/save/damage/heal without ~190 lines of inline JSX
 * duplicated per activity-kind branch. Parent owns the array;
 * `onChange` receives the full next state on every patch.
 */
export default function DamagePartEditor({
  parts,
  onChange,
  singlePart = false,
  partNoun = 'Damage Part',
}: DamagePartEditorProps) {
  const patchAt = (idx: number, patch: Partial<DamagePart>) => {
    const next = parts.slice();
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  };

  const removeAt = (idx: number) => {
    onChange(parts.filter((_, i) => i !== idx));
  };

  const addPart = () => {
    onChange([...parts, { types: [''] }]);
  };

  return (
    <div className="py-2 space-y-3">
      {parts.map((part, idx) => (
        <div key={idx} className="p-3 border border-gold/10 bg-gold/3 rounded relative group">
          {/* Hover-only remove button anchored to the card corner.
              Trash2 to stay consistent with the rest of the editor. */}
          <Button
            variant="ghost"
            size="icon"
            className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-background border border-gold/15 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={() => removeAt(idx)}
            type="button"
            aria-label="Remove part"
          >
            <Trash2 className="h-3 w-3 text-red-400" />
          </Button>

          {/* Row 1: number of dice + die size + flat bonus.
              Even 3-col split keeps each input wide enough to type a
              real value at the dialog's standard 4xl width without
              overflowing on smaller screens. Previously 2/3/7 made the
              Number input cramped and pushed Bonus too far right. */}
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div>
              <p className="text-[9px] uppercase text-ink/40 font-black tracking-widest mb-1">Number</p>
              <Input
                type="number"
                value={part.number ?? ''}
                onChange={e => patchAt(idx, { number: parseInt(e.target.value) || null })}
                className="h-8 bg-background/40 border-gold/10 text-center text-xs no-number-spin"
              />
            </div>
            <div>
              <p className="text-[9px] uppercase text-ink/40 font-black tracking-widest mb-1">Die</p>
              <Select
                value={part.denomination?.toString() || ''}
                onValueChange={val => patchAt(idx, { denomination: parseInt(val) || null })}
              >
                <SelectTrigger className="h-8 bg-background/40 border-gold/10 text-xs">
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  {DAMAGE_DIE_DENOMINATIONS.map(d => (
                    <SelectItem key={d} value={String(d)}>d{d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <p className="text-[9px] uppercase text-ink/40 font-black tracking-widest mb-1">Bonus</p>
              <Input
                value={part.bonus || ''}
                onChange={e => patchAt(idx, { bonus: e.target.value })}
                className="h-8 bg-background/40 border-gold/10 text-xs font-mono"
                placeholder="+5 or @mod"
              />
            </div>
          </div>

          {/* Row 2: damage type chips. Multi-select via EntityPicker
              — same shared pattern used elsewhere. */}
          <div className="mb-3">
            <p className="text-[9px] uppercase text-ink/40 font-black tracking-widest mb-1.5">Damage Types</p>
            <EntityPicker
              entities={DAMAGE_TYPE_OPTIONS.map(dt => ({ id: dt.value, name: dt.label }))}
              selectedIds={part.types || []}
              onChange={(nextTypes) => patchAt(idx, { types: nextTypes })}
              searchPlaceholder="Search damage types…"
              maxHeightClass="max-h-32"
              showChips
            />
          </div>

          {/* Row 3: custom formula toggle (replaces the dice roll
              entirely when enabled). */}
          <div className="flex items-center gap-3 border-t border-gold/8 pt-2.5">
            <Checkbox
              id={`custom-${idx}`}
              checked={part.custom?.enabled}
              onCheckedChange={checked => patchAt(idx, {
                custom: {
                  enabled: !!checked,
                  formula: part.custom?.formula || '',
                },
              })}
            />
            <Label htmlFor={`custom-${idx}`} className="text-[9px] uppercase text-ink/60 font-black tracking-widest">
              Custom Formula
            </Label>
            {part.custom?.enabled && (
              <Input
                value={part.custom.formula}
                onChange={e => patchAt(idx, {
                  custom: {
                    enabled: true,
                    formula: e.target.value,
                  },
                })}
                className="h-7 flex-1 bg-background/40 border-gold/10 text-[9px] font-mono"
                placeholder="Formula…"
              />
            )}
          </div>

          {/* Row 4: scaling — adds dice/formula as character level
              increases. Mode None / Every Level / Every Other Level
              matches Foundry's display labels for the dnd5e slug
              values "" / "whole" / "half".
              base-ui's Select disallows SelectItem value="" (collides
              with the "no selection" sentinel), so we translate the
              empty-string mode to a `__none` token while in the
              dropdown and back to "" when patching the data. Without
              this, clicking the dropdown options did nothing because
              base-ui silently swallowed the change. */}
          <div className="grid grid-cols-12 gap-2 border-t border-gold/8 mt-2.5 pt-2.5">
            <div className="col-span-4">
              <p className="text-[9px] uppercase text-ink/40 font-black tracking-widest mb-1">Scaling Mode</p>
              <Select
                value={part.scaling?.mode || '__none'}
                onValueChange={val => patchAt(idx, {
                  scaling: { ...part.scaling, mode: val === '__none' ? '' : val },
                })}
              >
                <SelectTrigger className="h-7 bg-background/40 border-gold/10 text-[9px]">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  {DAMAGE_SCALING_MODE_OPTIONS.map(o => (
                    <SelectItem key={o.value || '__none'} value={o.value || '__none'}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-8">
              <p className="text-[9px] uppercase text-ink/40 font-black tracking-widest mb-1">Scaling Dice / Formula</p>
              <div className="flex gap-2">
                <Input
                  type="number"
                  value={part.scaling?.number ?? ''}
                  onChange={e => patchAt(idx, {
                    scaling: { ...part.scaling, mode: part.scaling?.mode ?? '', number: parseInt(e.target.value) || 0 },
                  })}
                  className="h-7 w-12 bg-background/40 border-gold/10 text-[9px] text-center no-number-spin"
                  placeholder="1"
                />
                <Input
                  value={part.scaling?.formula || ''}
                  onChange={e => patchAt(idx, {
                    scaling: { ...part.scaling, mode: part.scaling?.mode ?? '', formula: e.target.value },
                  })}
                  className="h-7 flex-1 bg-background/40 border-gold/10 text-[9px] font-mono"
                  placeholder="Formula…"
                />
              </div>
            </div>
          </div>
        </div>
      ))}

      {/* Footer affordance varies by activity kind. Heal activities
          have exactly one healing roll — show a help note instead of
          an add button so authors don't accidentally produce a heal
          activity with two parallel healing parts. */}
      {!singlePart ? (
        <button
          type="button"
          onClick={addPart}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[10px] uppercase tracking-widest font-black text-gold/50 hover:text-gold border border-dashed border-gold/15 hover:border-gold/30 rounded transition-colors"
        >
          <Plus className="w-3 h-3" /> Add {partNoun}
        </button>
      ) : (
        <p className="text-[10px] text-ink/40 border border-dashed border-gold/10 rounded p-3">
          Foundry heal activities use a single healing roll. This editor keeps one primary healing part.
        </p>
      )}
    </div>
  );
}

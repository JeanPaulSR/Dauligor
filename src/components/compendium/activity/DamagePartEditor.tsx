import React from 'react';
import { Minus } from 'lucide-react';
import { Input } from '../../ui/input';
import { Checkbox } from '../../ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';
import { Field } from './primitives';
import { DAMAGE_DIE_DENOMINATIONS, DAMAGE_SCALING_MODE_OPTIONS } from './constants';

/**
 * Damage-part shape — the `parts[]` element of a dnd5e 5.x damage/healing
 * activity section: one roll component (Xd6 + Y of type Z, optionally a custom
 * formula, optionally scaling per level).
 */
export interface DamagePart {
  number?: number | null;
  denomination?: number | null;
  bonus?: string;
  types?: string[];
  custom?: { enabled: boolean; formula: string };
  scaling?: { mode: string; number?: number | null; formula?: string };
}

export interface DamagePartEditorProps {
  parts: DamagePart[];
  onChange: (next: DamagePart[]) => void;
  /**
   * Type options for the part's single Type dropdown — damage types for
   * attack/save/damage, healing types for heal. The host passes the right list.
   */
  typeOptions: { value: string; label: string }[];
  /**
   * Whether the scaling field-group is shown. Mirrors Foundry's `canScale`
   * (`activity.canScaleDamage`) — scaling only renders when the parent activity
   * can actually scale its damage. Defaults to `true` to preserve prior behavior.
   */
  canScale?: boolean;
}

/**
 * Editor for the `parts[]` array, rebuilt to mirror Foundry dnd5e 5.3.1's
 * `damage-part.hbs` + its `.split-group.card` CSS exactly:
 *
 *   • a relative card with a right gutter for the absolute delete control;
 *   • field-group 1 — a `.singleton` custom-formula checkbox (vertically
 *     centered) followed by Number / Die / Bonus (equal columns), or a single
 *     Formula input when custom is toggled on;
 *   • field-group 2 — the Type dropdown;
 *   • field-group 3 — Scaling (+ Dice and Formula once a mode is picked), shown
 *     only when `canScale`;
 *   • a minus (–) delete button pinned to the card's bottom-right corner
 *     (`inset: auto 0 0 auto`).
 *
 * Adding parts is owned by the parent (the section header's ➕); this component
 * renders/edits the existing parts and removes them.
 */
export default function DamagePartEditor({ parts, onChange, typeOptions, canScale = true }: DamagePartEditorProps) {
  const patchAt = (idx: number, patch: Partial<DamagePart>) => {
    const next = parts.slice();
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  };
  const removeAt = (idx: number) => onChange(parts.filter((_, i) => i !== idx));

  return (
    <div className="py-2 space-y-2">
      {parts.map((part, idx) => {
        const custom = !!part.custom?.enabled;
        const scalingMode = part.scaling?.mode || '';
        return (
          <div key={idx} className="relative pr-7 p-2 bg-gold/5 border border-gold/10 rounded">
            <div className="flex flex-col gap-2">
              {/* ── field-group 1: [☐ custom] + Number/Die/Bonus (or Formula) ── */}
              <div className="flex items-end gap-1.5">
                <Checkbox
                  checked={custom}
                  onCheckedChange={checked => patchAt(idx, { custom: { enabled: !!checked, formula: part.custom?.formula || '' } })}
                  title="Use a custom formula rather than the default dice."
                  aria-label="Use a custom formula rather than the default dice."
                  className="self-center shrink-0 mx-0.5"
                />
                {custom ? (
                  <Field label="Formula" className="flex-1">
                    <Input
                      value={part.custom?.formula || ''}
                      onChange={e => patchAt(idx, { custom: { enabled: true, formula: e.target.value } })}
                      autoComplete="off"
                      className="field-input border-gold/15 text-xs font-mono"
                    />
                  </Field>
                ) : (
                  <>
                    <Field label="Number" className="flex-1">
                      <Input
                        type="number"
                        value={part.number ?? ''}
                        onChange={e => patchAt(idx, { number: parseInt(e.target.value) || null })}
                        autoComplete="off"
                        className="field-input border-gold/15 text-xs text-center no-number-spin"
                      />
                    </Field>
                    <Field label="Die" className="flex-1">
                      <Select
                        value={part.denomination ? String(part.denomination) : '__none'}
                        onValueChange={val => patchAt(idx, { denomination: val === '__none' ? null : parseInt(val) })}
                      >
                        <SelectTrigger className="field-input border-gold/15 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none" className="min-h-7 items-center">{' '}</SelectItem>
                          {DAMAGE_DIE_DENOMINATIONS.map(d => (
                            <SelectItem key={d} value={String(d)}>{`d${d}`}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Bonus" className="flex-1">
                      <Input
                        value={part.bonus || ''}
                        onChange={e => patchAt(idx, { bonus: e.target.value })}
                        autoComplete="off"
                        className="field-input border-gold/15 text-xs font-mono"
                      />
                    </Field>
                  </>
                )}
              </div>

              {/* ── field-group 2: Type ── */}
              <Field label="Type">
                <Select
                  value={part.types?.[0] || '__none'}
                  onValueChange={val => patchAt(idx, { types: val === '__none' ? [] : [val] })}
                >
                  <SelectTrigger className="field-input border-gold/15 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none" className="py-1.5">{' '}</SelectItem>
                    {typeOptions.map(o => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              {/* ── field-group 3: Scaling (+ Dice / Formula once a mode is set) ── */}
              {canScale && (
                <div className="flex items-end gap-1.5">
                  <Field label="Scaling" className="flex-1">
                    <Select
                      value={scalingMode || '__none'}
                      onValueChange={val => patchAt(idx, { scaling: { ...(part.scaling || { mode: '' }), mode: val === '__none' ? '' : val } })}
                    >
                      <SelectTrigger className="field-input border-gold/15 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DAMAGE_SCALING_MODE_OPTIONS.map(o => (
                          <SelectItem key={o.value || '__none'} value={o.value || '__none'}>{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  {scalingMode ? (
                    <>
                      <Field label="Dice" className="flex-1">
                        <Input
                          type="number"
                          value={part.scaling?.number ?? ''}
                          onChange={e => patchAt(idx, { scaling: { ...(part.scaling || { mode: '' }), number: parseInt(e.target.value) || null } })}
                          autoComplete="off"
                          className="field-input border-gold/15 text-xs text-center no-number-spin"
                        />
                      </Field>
                      <Field label="Formula" className="flex-1">
                        <Input
                          value={part.scaling?.formula || ''}
                          onChange={e => patchAt(idx, { scaling: { ...(part.scaling || { mode: '' }), formula: e.target.value } })}
                          autoComplete="off"
                          className="field-input border-gold/15 text-xs font-mono"
                        />
                      </Field>
                    </>
                  ) : null}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => removeAt(idx)}
              className="absolute bottom-1.5 right-1 w-5 h-5 flex items-center justify-center cursor-pointer rounded border border-gold/30 bg-gold/10 text-gold/70 hover:bg-blood/15 hover:border-blood/45 hover:text-blood transition-colors"
              aria-label="Remove damage part"
              title="Remove damage part"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

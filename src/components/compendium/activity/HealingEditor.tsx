import React from 'react';
import { Input } from '../../ui/input';
import { Checkbox } from '../../ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';
import { FormRow, Field } from './primitives';
import { DAMAGE_DIE_DENOMINATIONS, DAMAGE_SCALING_MODE_OPTIONS } from './constants';
import type { DamagePart } from './DamagePartEditor';

export interface HealingEditorProps {
  /** The single healing part (Foundry's `healing` is one formula, not a list). */
  part: DamagePart;
  onChange: (patch: Partial<DamagePart>) => void;
  typeOptions: { value: string; label: string }[];
  /** Mirrors `activity.canScaleDamage` — hides Scaling on a non-scaling heal. */
  canScale?: boolean;
}

/**
 * Healing editor — mirrors Foundry dnd5e 5.3.1's shared `field-damage.hbs`
 * rendered with `heal=true` (see `heal-healing.hbs`). Unlike the Damage
 * activity's repeatable `damage-part.hbs` cards, a Heal carries exactly ONE
 * healing formula, so this is a fixed label-left split-group layout — no add
 * (+) and no delete (−):
 *
 *   • Formula — a custom-formula checkbox; toggling it on swaps the dice row
 *     for a single Formula input.
 *   • Heal — Number / Die / Bonus (only while the custom formula is off).
 *   • Type — the healing type (Hit Points / Temp HP / Max HP).
 *   • Scaling — Mode (+ Dice and Formula once a mode is picked), only when the
 *     activity can scale.
 */
export default function HealingEditor({ part, onChange, typeOptions, canScale = true }: HealingEditorProps) {
  const custom = !!part.custom?.enabled;
  const scalingMode = part.scaling?.mode || '';

  return (
    <div>
      {/* Formula — custom-formula toggle (+ the formula input once enabled). */}
      <FormRow label="Formula" wideControls>
        {custom ? (
          <>
            <Checkbox
              checked={custom}
              onCheckedChange={checked => onChange({ custom: { enabled: !!checked, formula: part.custom?.formula || '' } })}
              className="self-center shrink-0"
              title="Should the custom formula be used rather than the default dice."
              aria-label="Enable Custom Formula"
            />
            <Input
              value={part.custom?.formula || ''}
              onChange={e => onChange({ custom: { enabled: true, formula: e.target.value } })}
              autoComplete="off"
              placeholder="2d4 + 2"
              className="field-input border-gold/15 text-xs font-mono flex-1"
            />
          </>
        ) : (
          <div className="flex-1 flex justify-end">
            <Checkbox
              checked={custom}
              onCheckedChange={checked => onChange({ custom: { enabled: !!checked, formula: part.custom?.formula || '' } })}
              title="Should the custom formula be used rather than the default dice."
              aria-label="Enable Custom Formula"
            />
          </div>
        )}
      </FormRow>

      {/* Heal — Number / Die / Bonus (hidden while the custom formula is on). */}
      {!custom && (
        <FormRow label="Heal" wideControls>
          <Field label="Number" className="flex-1">
            <Input
              type="number"
              value={part.number ?? ''}
              onChange={e => onChange({ number: parseInt(e.target.value) || null })}
              autoComplete="off"
              className="field-input border-gold/15 text-xs text-center no-number-spin"
            />
          </Field>
          <Field label="Die" className="flex-1">
            <Select
              value={part.denomination ? String(part.denomination) : '__none'}
              onValueChange={val => onChange({ denomination: val === '__none' ? null : parseInt(val) })}
            >
              <SelectTrigger className="field-input border-gold/15 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none" className="min-h-7 items-center">{' '}</SelectItem>
                {DAMAGE_DIE_DENOMINATIONS.map(d => (
                  <SelectItem key={d} value={String(d)}>{`d${d}`}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Bonus" className="flex-1">
            <Input
              value={part.bonus || ''}
              onChange={e => onChange({ bonus: e.target.value })}
              autoComplete="off"
              className="field-input border-gold/15 text-xs font-mono"
            />
          </Field>
        </FormRow>
      )}

      {/* Type — healing type (single-select, like our damage parts). */}
      <FormRow label="Type" hint="Type of healing inflicted or multiple for the user to select from." wideControls>
        <Field className="flex-1">
          <Select
            value={part.types?.[0] || '__none'}
            onValueChange={val => onChange({ types: val === '__none' ? [] : [val] })}
          >
            <SelectTrigger className="field-input border-gold/15 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none" className="py-1.5">{' '}</SelectItem>
              {typeOptions.map(o => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </FormRow>

      {/* Scaling — Mode (+ Dice / Formula once a mode is set), only when scaling. */}
      {canScale && (
        <FormRow
          label="Scaling"
          wideControls
          below={scalingMode ? (
            <Input
              value={part.scaling?.formula || ''}
              onChange={e => onChange({ scaling: { ...(part.scaling || { mode: '' }), formula: e.target.value } })}
              autoComplete="off"
              placeholder="Scaling formula"
              className="field-input border-gold/15 text-xs font-mono w-full mt-2"
            />
          ) : null}
        >
          <Field label="Scaling" className="flex-1">
            <Select
              value={scalingMode || '__none'}
              onValueChange={val => onChange({ scaling: { ...(part.scaling || { mode: '' }), mode: val === '__none' ? '' : val } })}
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
            <Field label="Dice" className="flex-1">
              <Input
                type="number"
                value={part.scaling?.number ?? ''}
                onChange={e => onChange({ scaling: { ...(part.scaling || { mode: '' }), number: parseInt(e.target.value) || null } })}
                autoComplete="off"
                className="field-input border-gold/15 text-xs text-center no-number-spin"
              />
            </Field>
          ) : null}
        </FormRow>
      )}
    </div>
  );
}

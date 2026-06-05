import React from 'react';
import { Trash2 } from 'lucide-react';
import { Input } from '../../ui/input';
import { Checkbox } from '../../ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';
import SingleSelectSearch from '../../ui/SingleSelectSearch';
import { ActivitySection, FormRow, Field, EmptyRow } from './primitives';
import ActiveEffectKeyInput from '../ActiveEffectKeyInput';
import { RECOVERY_PERIOD_OPTIONS, CONSUMPTION_TARGET_TYPES } from './constants';

/**
 * Consumption-tab content, rebuilt to mirror Foundry dnd5e 5.3.1's
 * `activity-consumption.hbs` (+ the `field-uses` partial). Section order
 * matches Foundry exactly: Consumption → Consumption Scaling → Usage →
 * Recovery. Owns the consumption-targets + recovery arrays via the parent's
 * `onConsumptionChange` / `onUsesChange` patch callbacks.
 */

export interface ConsumptionScalingShape {
  allowed?: boolean;
  max?: string;
}

export interface ConsumptionTargetShape {
  type?: string;
  target?: string;
  value?: string;
  scaling?: { mode?: string; formula?: string };
}

export interface ConsumptionShape {
  scaling?: ConsumptionScalingShape;
  spellSlot?: boolean;
  targets?: ConsumptionTargetShape[];
}

export interface UsesRecoveryShape {
  period: string;
  type: string;
  formula: string;
}

export interface UsesShape {
  spent?: number;
  max?: string;
  recovery?: UsesRecoveryShape[];
}

/** An entity an "Item Uses" consumption target can draw from. */
export interface ConsumptionItemTarget {
  id: string;
  name: string;
  hint?: string;
}

export interface ConsumptionTabEditorProps {
  consumption: ConsumptionShape | undefined;
  onConsumptionChange: (patch: Partial<ConsumptionShape>) => void;
  uses: UsesShape | undefined;
  onUsesChange: (next: UsesShape) => void;
  /** Cast activities surface a "Consume Spell Slot" toggle; others don't. */
  showSpellSlot?: boolean;
  /**
   * Candidate entities for an "Item Uses" consumption target. Supplied by
   * the host editor (class features with uses in ClassEditor; sibling option
   * items in the option-group editor; etc.). When provided, the target field
   * for `itemUses` becomes a searchable dropdown instead of a free-text path.
   */
  itemTargets?: ConsumptionItemTarget[];
}

// Native `uses.recovery[].type` values (dnd5e 5.3.1). The editor previously
// carried invented `recoverPartial` / `recovery` slugs — Foundry only
// recognises these three. Kept local so the shared activity constants (also
// consumed by ItemUsesField / Spells / Feats editors) stay untouched.
const RECOVERY_TYPE_OPTIONS = [
  { value: 'recoverAll', label: 'Recover All Uses' },
  { value: 'formula',    label: 'Recover Formula' },
  { value: 'loseAll',    label: 'Lose All Uses' },
];

// Consumption-target scaling modes. Generic targets scale by a flat
// "amount"; spell-slot consumption can also scale by slot "level". (This is
// distinct from a damage part's whole/half scaling.)
function consumptionScalingModes(type: string | undefined): { value: string; label: string }[] {
  const base = [
    { value: '', label: 'None' },
    { value: 'amount', label: 'Amount' },
  ];
  return type === 'spellSlots'
    ? [...base, { value: 'level', label: 'Spell Slot Level' }]
    : base;
}

export default function ConsumptionTabEditor({
  consumption,
  onConsumptionChange,
  uses,
  onUsesChange,
  showSpellSlot = false,
  itemTargets = [],
}: ConsumptionTabEditorProps) {
  const targets = consumption?.targets ?? [];
  const patchTargets = (next: ConsumptionTargetShape[]) => onConsumptionChange({ targets: next });
  const addTarget = () =>
    patchTargets([...targets, { type: 'activityUses', target: '', value: '1', scaling: { mode: '', formula: '' } }]);

  const patchScaling = (patch: Partial<ConsumptionScalingShape>) =>
    onConsumptionChange({ scaling: { ...(consumption?.scaling || {}), ...patch } });

  const recovery = uses?.recovery ?? [];
  const patchRecovery = (next: UsesRecoveryShape[]) => onUsesChange({ ...(uses || {}), recovery: next });
  const addRecovery = () => patchRecovery([...recovery, { period: 'lr', type: 'recoverAll', formula: '' }]);

  const scalingAllowed = !!consumption?.scaling?.allowed;

  return (
    <div>
      {/* ── CONSUMPTION ── */}
      <ActivitySection label="Consumption" onAdd={addTarget} addLabel="Add consumption target">
        {showSpellSlot && (
          <FormRow inline label="Consume Spell Slot" hint="Native cast activities usually leave this enabled.">
            <Checkbox
              checked={consumption?.spellSlot}
              onCheckedChange={checked => onConsumptionChange({ spellSlot: !!checked })}
            />
          </FormRow>
        )}
        {targets.length === 0 ? (
          <EmptyRow>None</EmptyRow>
        ) : (
          <div className="py-2 space-y-2">
            {targets.map((target, idx) => {
              const patchAt = (patch: Partial<ConsumptionTargetShape>) => {
                const next = targets.slice();
                next[idx] = { ...target, ...patch };
                patchTargets(next);
              };
              const showTarget = !!target.type && target.type !== 'activityUses';
              const useItemPicker = target.type === 'itemUses' && itemTargets.length > 0;
              const scalingModes = consumptionScalingModes(target.type);
              return (
                <div key={idx} className="p-2.5 bg-gold/5 border border-gold/10 rounded space-y-2">
                  <div className="flex items-end gap-2">
                    <Field label="Type" className="flex-1">
                      <Select value={target.type || 'activityUses'} onValueChange={val => patchAt({ type: val })}>
                        <SelectTrigger className="field-input border-gold/15 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CONSUMPTION_TARGET_TYPES.map(o => (
                            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Amount" className="w-24 shrink-0">
                      <Input
                        value={target.value || ''}
                        onChange={e => patchAt({ value: e.target.value })}
                        autoComplete="off"
                        className="field-input border-gold/15 text-xs text-center font-mono"
                        placeholder="1"
                      />
                    </Field>
                    <button
                      type="button"
                      onClick={() => patchTargets(targets.filter((_, i) => i !== idx))}
                      className="h-9 flex items-center text-blood/60 hover:text-blood shrink-0 transition-colors"
                      aria-label="Remove consumption target"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {showTarget && (
                    useItemPicker ? (
                      <Field label="Target">
                        <SingleSelectSearch
                          value={target.target || ''}
                          onChange={(val) => patchAt({ target: val })}
                          options={itemTargets}
                          placeholder="Search items with uses…"
                          noEntitiesText="No items with uses available."
                          triggerClassName="w-full h-9"
                        />
                      </Field>
                    ) : (
                      <ActiveEffectKeyInput
                        value={target.target || ''}
                        onChange={(next) => patchAt({ target: next })}
                        placeholder="resources.primary.value"
                      />
                    )
                  )}
                  <div className="flex items-end gap-2">
                    <Field label="Scaling" className="flex-1">
                      <Select
                        value={target.scaling?.mode || '__none'}
                        onValueChange={val => patchAt({
                          scaling: { ...(target.scaling || { mode: '', formula: '' }), mode: val === '__none' ? '' : val },
                        })}
                      >
                        <SelectTrigger className="field-input border-gold/15 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {scalingModes.map(o => (
                            <SelectItem key={o.value || '__none'} value={o.value || '__none'}>{o.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    {target.scaling?.mode ? (
                      <Field label="Formula" className="flex-1">
                        <Input
                          value={target.scaling?.formula || ''}
                          onChange={e => patchAt({
                            scaling: { ...(target.scaling || { mode: '', formula: '' }), formula: e.target.value },
                          })}
                          autoComplete="off"
                          className="field-input border-gold/15 text-xs font-mono"
                          placeholder="Automatic"
                        />
                      </Field>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </ActivitySection>

      {/* ── CONSUMPTION SCALING ── */}
      <ActivitySection label="Consumption Scaling">
        <FormRow inline label="Allow Scaling" hint="Can an activity not on a spell be activated at higher levels?">
          <Checkbox
            checked={scalingAllowed}
            onCheckedChange={checked => patchScaling({ allowed: !!checked, max: consumption?.scaling?.max || '' })}
          />
        </FormRow>
        {scalingAllowed && (
          <FormRow label="Maximum">
            <Field className="flex-1">
              <Input
                value={consumption?.scaling?.max || ''}
                onChange={e => patchScaling({ max: e.target.value })}
                autoComplete="off"
                className="field-input border-gold/15 text-xs font-mono"
                placeholder="∞"
              />
            </Field>
          </FormRow>
        )}
      </ActivitySection>

      {/* ── USAGE ── */}
      <ActivitySection label="Usage">
        <FormRow label="Limited Uses">
          <Field label="Spent" className="flex-1">
            <Input
              type="number"
              value={uses?.spent || 0}
              onChange={e => onUsesChange({ ...(uses || {}), spent: parseInt(e.target.value) || 0 })}
              className="field-input border-gold/15 text-xs text-center no-number-spin"
            />
          </Field>
          <Field label="Max" className="flex-1">
            <Input
              value={uses?.max || ''}
              onChange={e => onUsesChange({ ...(uses || {}), max: e.target.value })}
              autoComplete="off"
              className="field-input border-gold/15 text-xs text-center font-mono"
              placeholder="—"
            />
          </Field>
        </FormRow>
      </ActivitySection>

      {/* ── RECOVERY ── */}
      <ActivitySection label="Recovery" onAdd={addRecovery} addLabel="Add recovery rule">
        {recovery.length === 0 ? (
          <EmptyRow>Never</EmptyRow>
        ) : (
          <div className="py-2 space-y-2">
            {recovery.map((entry, idx) => {
              const patchAt = (patch: Partial<UsesRecoveryShape>) => {
                const next = recovery.slice();
                next[idx] = { ...entry, ...patch };
                patchRecovery(next);
              };
              return (
                <div key={idx} className="p-2.5 bg-gold/5 border border-gold/10 rounded space-y-2">
                  <div className="flex items-end gap-2">
                    <Field label="Period" className="flex-1">
                      <Select value={entry.period || 'lr'} onValueChange={val => patchAt({ period: val })}>
                        <SelectTrigger className="field-input border-gold/15 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {RECOVERY_PERIOD_OPTIONS.map(o => (
                            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Recovery" className="flex-1">
                      <Select value={entry.type || 'recoverAll'} onValueChange={val => patchAt({ type: val })}>
                        <SelectTrigger className="field-input border-gold/15 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {RECOVERY_TYPE_OPTIONS.map(o => (
                            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <button
                      type="button"
                      onClick={() => patchRecovery(recovery.filter((_, i) => i !== idx))}
                      className="h-9 flex items-center text-blood/60 hover:text-blood shrink-0 transition-colors"
                      aria-label="Remove recovery rule"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {entry.type === 'formula' && (
                    <Input
                      value={entry.formula || ''}
                      onChange={e => patchAt({ formula: e.target.value })}
                      autoComplete="off"
                      className="field-input border-gold/15 text-xs font-mono w-full"
                      placeholder="1d4 or @prof"
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </ActivitySection>
    </div>
  );
}

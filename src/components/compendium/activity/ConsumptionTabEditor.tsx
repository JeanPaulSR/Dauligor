import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Input } from '../../ui/input';
import { Checkbox } from '../../ui/checkbox';
import { ActivitySection, FieldRow } from './primitives';
import SingleSelectSearch from '../../ui/SingleSelectSearch';
import ActiveEffectKeyInput from '../ActiveEffectKeyInput';
import {
  RECOVERY_PERIOD_OPTIONS,
  RECOVERY_TYPE_OPTIONS,
  CONSUMPTION_TARGET_TYPES,
  SCALING_MODE_OPTIONS,
} from './constants';

/**
 * Consumption-tab content: Scaling toggle, Uses + Recovery rules,
 * and the Consumption Targets array. Combines the four
 * ActivitySections that live under "consumption" on every activity.
 *
 * Why all four together: they share the same `consumption` /
 * `uses` patch path on the parent activity, so keeping them
 * co-located makes the props surface smaller (one onConsumptionChange,
 * one onUsesChange) and the sub-component reads cleanly as a single
 * unit. Future authoring tweaks (e.g. autocomplete on recovery
 * formula) only need to touch this one file.
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

/** Matches `SemanticActivity['uses']['recovery'][n]` — all required
 *  strings, even when the author hasn't typed a value yet (empty
 *  string keeps the shape stable). Aligning fully with the canonical
 *  activity type so the parent's `onUsesChange` accepts the patches. */
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

export interface ConsumptionTabEditorProps {
  consumption: ConsumptionShape | undefined;
  onConsumptionChange: (patch: Partial<ConsumptionShape>) => void;
  uses: UsesShape | undefined;
  onUsesChange: (next: UsesShape) => void;
}

export default function ConsumptionTabEditor({
  consumption,
  onConsumptionChange,
  uses,
  onUsesChange,
}: ConsumptionTabEditorProps) {
  const patchScaling = (patch: Partial<ConsumptionScalingShape>) => {
    onConsumptionChange({
      scaling: { ...(consumption?.scaling || {}), ...patch },
    });
  };
  const patchTargets = (next: ConsumptionTargetShape[]) => {
    onConsumptionChange({ targets: next });
  };
  const recovery = uses?.recovery ?? [];
  const patchRecovery = (next: UsesRecoveryShape[]) => {
    onUsesChange({ ...(uses || {}), recovery: next });
  };

  return (
    <div>
      <ActivitySection label="SCALING">
        <FieldRow label="Allow Scaling" hint="Can this activity be activated at higher levels?" inline>
          <Checkbox
            checked={consumption?.scaling?.allowed}
            onCheckedChange={checked => patchScaling({
              allowed: !!checked,
              max: consumption?.scaling?.max || '',
            })}
          />
        </FieldRow>
        {consumption?.scaling?.allowed && (
          <FieldRow label="Maximum Formula">
            <Input
              value={consumption?.scaling?.max || ''}
              onChange={e => patchScaling({ max: e.target.value })}
              className="field-input border-gold/15 font-mono text-xs"
              placeholder="@item.level or 9"
            />
          </FieldRow>
        )}
        <FieldRow label="Consume Spell Slot" hint="Native cast activities usually leave this enabled." inline>
          <Checkbox
            checked={consumption?.spellSlot}
            onCheckedChange={checked => onConsumptionChange({ spellSlot: !!checked })}
          />
        </FieldRow>
      </ActivitySection>

      <ActivitySection label="USES">
        <FieldRow label="Spent">
          <Input
            type="number"
            value={uses?.spent || 0}
            onChange={e => onUsesChange({ ...(uses || {}), spent: parseInt(e.target.value) || 0 })}
            className="field-input border-gold/15 text-xs text-center no-number-spin"
          />
        </FieldRow>
        <FieldRow label="Maximum">
          <Input
            value={uses?.max || ''}
            onChange={e => onUsesChange({ ...(uses || {}), max: e.target.value })}
            className="field-input border-gold/15 text-xs"
            placeholder="Formula or number"
          />
        </FieldRow>
      </ActivitySection>

      <ActivitySection label="RECOVERY">
        <div className="space-y-2 py-2">
          {recovery.map((entry, idx) => (
            <div key={idx} className="flex gap-2 items-center p-2.5 bg-gold/3 border border-gold/8 rounded">
              <SingleSelectSearch
                value={entry.period || ''}
                onChange={(val) => {
                  const next = recovery.slice();
                  next[idx] = { ...entry, period: val };
                  patchRecovery(next);
                }}
                options={RECOVERY_PERIOD_OPTIONS.map(o => ({ id: o.value, name: o.label, hint: o.hint }))}
                placeholder="Period"
                triggerClassName="flex-1"
              />
              <SingleSelectSearch
                value={entry.type || ''}
                onChange={(val) => {
                  const next = recovery.slice();
                  next[idx] = { ...entry, type: val };
                  patchRecovery(next);
                }}
                options={RECOVERY_TYPE_OPTIONS.map(o => ({ id: o.value, name: o.label }))}
                placeholder="Type"
                triggerClassName="flex-1"
              />
              <Input
                value={entry.formula || ''}
                onChange={e => {
                  const next = recovery.slice();
                  next[idx] = { ...entry, formula: e.target.value };
                  patchRecovery(next);
                }}
                className="h-7 text-[10px] font-mono bg-background/40 border-gold/10 flex-1"
                placeholder="1d4 or @prof"
              />
              <button
                type="button"
                onClick={() => patchRecovery(recovery.filter((_, i) => i !== idx))}
                className="text-blood/60 hover:text-blood shrink-0 transition-colors"
                aria-label="Remove recovery rule"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          {recovery.length === 0 && (
            <p className="text-center py-3 text-ink/30 italic text-[10px]">No recovery rules.</p>
          )}
          <button
            type="button"
            onClick={() => patchRecovery([...recovery, { period: '', type: '', formula: '' }])}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[10px] uppercase tracking-widest font-black text-gold/50 hover:text-gold border border-dashed border-gold/15 hover:border-gold/30 rounded transition-colors"
          >
            <Plus className="w-3 h-3" /> Add Recovery Rule
          </button>
        </div>
      </ActivitySection>

      <ActivitySection label="CONSUMPTION TARGETS">
        <div className="space-y-2 py-2">
          {(consumption?.targets || []).map((target, idx) => {
            const targets = consumption?.targets || [];
            const patchAt = (patch: Partial<ConsumptionTargetShape>) => {
              const next = targets.slice();
              next[idx] = { ...target, ...patch };
              patchTargets(next);
            };
            return (
              <div key={idx} className="p-2.5 bg-gold/3 border border-gold/8 rounded space-y-2">
                <div className="flex gap-2 items-center">
                  <SingleSelectSearch
                    value={target.type || ''}
                    onChange={(val) => patchAt({ type: val })}
                    options={CONSUMPTION_TARGET_TYPES.map(o => ({ id: o.value, name: o.label }))}
                    placeholder="Type"
                    triggerClassName="flex-1"
                  />
                  <Input
                    value={target.value || ''}
                    onChange={e => patchAt({ value: e.target.value })}
                    className="h-7 w-16 text-[10px] font-mono bg-background/40 border-gold/10 text-center"
                    placeholder="1"
                  />
                  <button
                    type="button"
                    onClick={() => patchTargets(targets.filter((_, i) => i !== idx))}
                    className="text-blood/60 hover:text-blood shrink-0 transition-colors"
                    aria-label="Remove consumption target"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <ActiveEffectKeyInput
                  value={target.target || ''}
                  onChange={(next) => patchAt({ target: next })}
                  placeholder="resources.primary.value"
                />
                <div className="flex gap-2 items-center">
                  <SingleSelectSearch
                    value={target.scaling?.mode || ''}
                    onChange={(val) => patchAt({
                      scaling: { ...(target.scaling || { mode: '', formula: '' }), mode: val },
                    })}
                    options={SCALING_MODE_OPTIONS.map(o => ({ id: o.value, name: o.label }))}
                    placeholder="No Scaling"
                    allowClear={false}
                    triggerClassName="flex-1"
                  />
                  <Input
                    value={target.scaling?.formula || ''}
                    onChange={e => patchAt({
                      scaling: { ...(target.scaling || { mode: '', formula: '' }), formula: e.target.value },
                    })}
                    className="h-7 text-[10px] font-mono bg-background/40 border-gold/10 flex-1"
                    placeholder="@item.level"
                  />
                </div>
              </div>
            );
          })}
          {!(consumption?.targets?.length) && (
            <p className="text-center py-3 text-ink/30 italic text-[10px]">No consumption targets.</p>
          )}
          <button
            type="button"
            onClick={() => patchTargets([
              ...(consumption?.targets || []),
              { type: '', target: '', value: '', scaling: { mode: '', formula: '' } },
            ])}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[10px] uppercase tracking-widest font-black text-gold/50 hover:text-gold border border-dashed border-gold/15 hover:border-gold/30 rounded transition-colors"
          >
            <Plus className="w-3 h-3" /> Add Target
          </button>
        </div>
      </ActivitySection>
    </div>
  );
}

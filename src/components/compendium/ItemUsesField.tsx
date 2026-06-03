import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Input } from '../ui/input';
import { Checkbox } from '../ui/checkbox';
import { ActivitySection, FieldRow } from './activity/primitives';
import SingleSelectSearch from '../ui/SingleSelectSearch';
import { RECOVERY_PERIOD_OPTIONS, RECOVERY_TYPE_OPTIONS } from './activity/constants';

/**
 * ItemUsesField — drop-in editor for an item's `system.uses` block.
 *
 * Subset of `ConsumptionTabEditor`'s USES + RECOVERY sub-sections, tuned
 * for item-level (rather than activity-level) authoring. Items don't have
 * the scaling toggle or consumption-targets concepts that activities do;
 * those live one layer deeper inside the activity editor and are out of
 * scope here.
 *
 * Used by the dynamic ItemsEditor (C6) for every shape that carries
 * `uses`: consumable, equipment, tool, weapon. Containers + loot don't
 * have uses so they skip this component.
 *
 * Shape (matches dnd5e v5's UsesField, persisted to `items.uses` JSON):
 *   {
 *     max:        string,      // formula or literal int ('1', '@levels.cleric')
 *     spent:      number,      // current spent (instance state, default 0)
 *     recovery:   Array<{ period, type, formula }>,  // when uses regen
 *     autoDestroy: boolean,    // delete item when uses exhausted (potions)
 *   }
 *
 * Added 2026-05-26 to support the C6 items-editor rebuild without
 * duplicating the recovery-row pattern that ConsumptionTabEditor proved out.
 */

export interface UsesRecoveryShape {
  period: string;
  type: string;
  formula: string;
}

export interface UsesShape {
  max?: string;
  spent?: number;
  recovery?: UsesRecoveryShape[];
  autoDestroy?: boolean;
}

export interface ItemUsesFieldProps {
  uses: UsesShape | undefined;
  onChange: (next: UsesShape) => void;
  /** Whether to surface the autoDestroy checkbox. Consumables typically
   *  want it (potion is destroyed when empty); rechargeable items (wand of
   *  fireballs) don't. Default: true. */
  showAutoDestroy?: boolean;
}

export default function ItemUsesField({ uses, onChange, showAutoDestroy = true }: ItemUsesFieldProps) {
  const recovery = uses?.recovery ?? [];
  const patchRecovery = (next: UsesRecoveryShape[]) => {
    onChange({ ...(uses || {}), recovery: next });
  };

  return (
    <div>
      <ActivitySection label="USES">
        <FieldRow label="Maximum">
          <Input
            value={uses?.max || ''}
            onChange={e => onChange({ ...(uses || {}), max: e.target.value })}
            className="field-input border-gold/15 text-xs"
            placeholder="Formula or number"
          />
        </FieldRow>
        <FieldRow label="Spent">
          <Input
            type="number"
            value={uses?.spent || 0}
            onChange={e => onChange({ ...(uses || {}), spent: parseInt(e.target.value) || 0 })}
            className="field-input border-gold/15 text-xs text-center no-number-spin"
          />
        </FieldRow>
        {showAutoDestroy && (
          <FieldRow
            label="Auto-Destroy When Empty"
            hint="Destroys the item when uses reach 0 (potions, scrolls)."
            inline
          >
            <Checkbox
              checked={!!uses?.autoDestroy}
              onCheckedChange={(checked) => onChange({ ...(uses || {}), autoDestroy: !!checked })}
            />
          </FieldRow>
        )}
      </ActivitySection>

      <ActivitySection label="RECOVERY">
        <div className="space-y-2 py-2">
          {recovery.map((entry, idx) => (
            <div key={idx} className="flex gap-2 items-center p-2.5 bg-gold/5 border border-gold/5 rounded">
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
                className="h-7 text-[10px] font-mono bg-background/40 border-gold/15 flex-1"
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
            <p className="text-center py-3 text-ink/35 italic text-[10px]">No recovery rules.</p>
          )}
          <button
            type="button"
            onClick={() => patchRecovery([...recovery, { period: '', type: '', formula: '' }])}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[10px] uppercase tracking-widest font-black text-gold/55 hover:text-gold border border-dashed border-gold/15 hover:border-gold/35 rounded transition-colors"
          >
            <Plus className="w-3 h-3" /> Add Recovery Rule
          </button>
        </div>
      </ActivitySection>
    </div>
  );
}

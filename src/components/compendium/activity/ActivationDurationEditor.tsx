import React from 'react';
import { Input } from '../../ui/input';
import { Checkbox } from '../../ui/checkbox';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '../../ui/select';
import { ActivitySection, FormRow, Field } from './primitives';

/**
 * Activation + Duration sections of the activity editor's Activation
 * tab — rebuilt to mirror Foundry dnd5e 5.3.1's `activity-time.hbs`
 * (+ the `field-activation` / `field-duration` shared partials):
 *
 * - Two-part labels: a bold field label on the left, each control
 *   carrying its own small uppercase header ("COST" / "TIME").
 * - The numeric "Amount" field appears ONLY for scalar types — the
 *   activation costs minute/hour/day/legendary/mythic/crew, and the
 *   scalar duration periods turn…year. Foundry hides it otherwise.
 * - Activation Condition is a full-width input beneath the cost row.
 * - Duration "Special" only shows when units === "spec".
 *
 * The parent passes the activation/duration sub-objects + a patch
 * callback per section. `showsDuration` mirrors the parent's kind-aware
 * visibility flag (forward activities don't carry a duration).
 */

export interface ActivationShape {
  type?: string;
  value?: number | null;
  condition?: string;
  override?: boolean;
}

export interface DurationShape {
  value?: string;
  units?: string;
  special?: string;
  concentration?: boolean;
  override?: boolean;
}

export interface ActivationDurationEditorProps {
  activation: ActivationShape | undefined;
  onActivationChange: (patch: Partial<ActivationShape>) => void;
  duration: DurationShape | undefined;
  onDurationChange: (patch: Partial<DurationShape>) => void;
  /** Forward activities don't carry their own duration. */
  showsDuration: boolean;
  /**
   * When true (a Cast activity has linked a spell, or a Forward a target
   * activity), the Activation/Duration sections gain a Foundry-style override
   * toggle: their values are inherited from that source unless overridden.
   */
  canOverride?: boolean;
  /** Noun for the inherited-from notices ("spell" for Cast, "activity" for Forward). */
  overrideNoun?: string;
}

// Mirrors `CONFIG.DND5E.activityActivationTypes` (dnd5e 5.3.1). Groups
// follow Foundry's Standard / Time / Rest / Combat / Monster / Vehicle /
// Special. `scalar` marks the costs that take a numeric Amount. (Foundry
// has no "none" entry in the activity list, unlike the legacy ability
// activation map — so it's intentionally absent here.)
const ACTIVATION_TYPE_OPTIONS: { value: string; label: string; group: string; scalar?: boolean }[] = [
  { value: 'action',    label: 'Action',              group: 'Standard' },
  { value: 'bonus',     label: 'Bonus Action',        group: 'Standard' },
  { value: 'reaction',  label: 'Reaction',            group: 'Standard' },
  { value: 'minute',    label: 'Minute',              group: 'Time', scalar: true },
  { value: 'hour',      label: 'Hour',                group: 'Time', scalar: true },
  { value: 'day',       label: 'Day',                 group: 'Time', scalar: true },
  { value: 'longRest',  label: 'End of a Long Rest',  group: 'Rest' },
  { value: 'shortRest', label: 'End of a Short Rest', group: 'Rest' },
  { value: 'encounter', label: 'Start of Encounter',  group: 'Combat' },
  { value: 'turnStart', label: 'Start of Turn',       group: 'Combat' },
  { value: 'turnEnd',   label: 'End of Turn',         group: 'Combat' },
  { value: 'legendary', label: 'Legendary Action',    group: 'Monster', scalar: true },
  { value: 'mythic',    label: 'Mythic Action',       group: 'Monster', scalar: true },
  { value: 'lair',      label: 'Lair Action',         group: 'Monster' },
  { value: 'crew',      label: 'Crew Action',         group: 'Vehicle', scalar: true },
  { value: 'special',   label: 'Special',             group: 'Special' },
];
const SCALAR_ACTIVATION = new Set(ACTIVATION_TYPE_OPTIONS.filter(o => o.scalar).map(o => o.value));

// Mirrors `CONFIG.DND5E.timePeriods` (dnd5e 5.3.1), ordered Foundry-style
// special → permanent → scalar. `month` / `year` were previously missing.
// `scalar` marks the periods that take a numeric Amount.
const DURATION_UNIT_OPTIONS: { value: string; label: string; scalar?: boolean; group?: string }[] = [
  // Ungrouped (rendered first, no header) — matches Foundry's duration menu.
  { value: 'inst',   label: 'Instantaneous' },
  { value: 'spec',   label: 'Special' },
  // Time group (scalar — takes a numeric Amount).
  { value: 'turn',   label: 'Turn',   scalar: true, group: 'Time' },
  { value: 'round',  label: 'Round',  scalar: true, group: 'Time' },
  { value: 'minute', label: 'Minute', scalar: true, group: 'Time' },
  { value: 'hour',   label: 'Hour',   scalar: true, group: 'Time' },
  { value: 'day',    label: 'Day',    scalar: true, group: 'Time' },
  { value: 'month',  label: 'Month',  scalar: true, group: 'Time' },
  { value: 'year',   label: 'Year',   scalar: true, group: 'Time' },
  // Permanent group.
  { value: 'disp',   label: 'Until Dispelled',              group: 'Permanent' },
  { value: 'dstr',   label: 'Until Dispelled or Triggered', group: 'Permanent' },
  { value: 'perm',   label: 'Permanent',                    group: 'Permanent' },
];
const SCALAR_DURATION = new Set(DURATION_UNIT_OPTIONS.filter(o => o.scalar).map(o => o.value));

// Foundry groups both dropdowns under category headers (matched to the
// dnd5e menus): activation → Standard / Time / Rest / Combat / Monster /
// Vehicle / Special; duration → ungrouped Instantaneous/Special, then Time,
// then Permanent. These orders drive the optgroup-style rendering below.
const ACTIVATION_GROUP_ORDER = ['Standard', 'Time', 'Rest', 'Combat', 'Monster', 'Vehicle', 'Special'] as const;
const DURATION_GROUP_ORDER = ['Time', 'Permanent'] as const;
const GROUP_LABEL_CLASS = 'text-[10px] font-black uppercase tracking-wider text-gold/55 px-2 pt-2 pb-1';

export default function ActivationDurationEditor({
  activation,
  onActivationChange,
  duration,
  onDurationChange,
  showsDuration,
  canOverride = false,
  overrideNoun = 'spell',
}: ActivationDurationEditorProps) {
  const isScalarActivation = SCALAR_ACTIVATION.has(activation?.type || '');
  const isScalarDuration = SCALAR_DURATION.has(duration?.units || '');

  // Foundry override toggles (only once a source is linked). Off ⇒ the section
  // inherits from the linked source and is locked; on ⇒ the author's own values
  // apply. The flags round-trip so the native conversion can emit them.
  const activationOverride = canOverride ? {
    checked: !!activation?.override,
    onChange: (v: boolean) => onActivationChange({ override: v }),
    hint: `Override the linked ${overrideNoun}'s activation.`,
    note: `Activation is inherited from the linked ${overrideNoun} — enable Override to set a custom cost.`,
  } : undefined;
  const durationOverride = canOverride ? {
    checked: !!duration?.override,
    onChange: (v: boolean) => onDurationChange({ override: v }),
    hint: `Override the linked ${overrideNoun}'s duration.`,
    note: `Duration is inherited from the linked ${overrideNoun} — enable Override to set a custom duration.`,
  } : undefined;

  return (
    <div>
      <ActivitySection label="Activation" override={activationOverride}>
        <FormRow
          label="Activation Cost"
          below={
            <Input
              value={activation?.condition || ''}
              onChange={e => onActivationChange({ condition: e.target.value })}
              placeholder="Activation Condition"
              className="field-input border-gold/15 text-xs w-full mt-2"
            />
          }
        >
          {isScalarActivation && (
            <Field label="Amount" className="w-16 shrink-0">
              <Input
                type="number"
                value={activation?.value ?? 1}
                onChange={e => onActivationChange({ value: parseInt(e.target.value, 10) || 1 })}
                className="field-input border-gold/15 text-xs text-center no-number-spin"
              />
            </Field>
          )}
          <Field label="Cost" className="flex-1">
            <Select
              value={activation?.type}
              onValueChange={val => onActivationChange({ type: val })}
            >
              <SelectTrigger className="field-input border-gold/15 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACTIVATION_GROUP_ORDER.map(groupName => {
                  const items = ACTIVATION_TYPE_OPTIONS.filter(o => o.group === groupName);
                  if (!items.length) return null;
                  return (
                    <SelectGroup key={groupName}>
                      <SelectLabel className={GROUP_LABEL_CLASS}>{groupName}</SelectLabel>
                      {items.map(opt => (
                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                      ))}
                    </SelectGroup>
                  );
                })}
              </SelectContent>
            </Select>
          </Field>
        </FormRow>
      </ActivitySection>

      {showsDuration && (
        <ActivitySection label="Duration" override={durationOverride}>
          <FormRow
            label="Duration"
            below={
              duration?.units === 'spec' ? (
                <Input
                  value={duration?.special || ''}
                  onChange={e => onDurationChange({ special: e.target.value })}
                  placeholder="Special duration text"
                  className="field-input border-gold/15 text-xs w-full mt-2"
                />
              ) : null
            }
          >
            {isScalarDuration && (
              <Field label="Amount" className="w-20 shrink-0">
                <Input
                  value={duration?.value || ''}
                  onChange={e => onDurationChange({ value: e.target.value })}
                  className="field-input border-gold/15 text-xs text-center font-mono"
                  placeholder="1"
                />
              </Field>
            )}
            <Field label="Time" className="flex-1">
              <Select
                value={duration?.units}
                onValueChange={val => onDurationChange({ units: val })}
              >
                <SelectTrigger className="field-input border-gold/15 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DURATION_UNIT_OPTIONS.filter(o => !o.group).map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                  {DURATION_GROUP_ORDER.map(groupName => {
                    const items = DURATION_UNIT_OPTIONS.filter(o => o.group === groupName);
                    if (!items.length) return null;
                    return (
                      <SelectGroup key={groupName}>
                        <SelectLabel className={GROUP_LABEL_CLASS}>{groupName}</SelectLabel>
                        {items.map(opt => (
                          <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                        ))}
                      </SelectGroup>
                    );
                  })}
                </SelectContent>
              </Select>
            </Field>
          </FormRow>
          <FormRow
            inline
            label="Concentration"
            hint="Creature must maintain concentration while active."
          >
            <Checkbox
              checked={duration?.concentration}
              onCheckedChange={checked => onDurationChange({ concentration: !!checked })}
            />
          </FormRow>
        </ActivitySection>
      )}
    </div>
  );
}

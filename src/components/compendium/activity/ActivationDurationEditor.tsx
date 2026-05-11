import React from 'react';
import { Input } from '../../ui/input';
import { Checkbox } from '../../ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';
import { ActivitySection, FieldRow } from './primitives';

/**
 * Activation + Duration sections of the activity editor's
 * Activation tab. Extracted out of ActivityEditor for the same
 * reason DamagePartEditor was — every activity kind carries an
 * activation, and most carry a duration, so this is repeated
 * surface that's nicer as a single component.
 *
 * The parent passes the activation/duration sub-objects + a patch
 * callback per section. `showsDuration` mirrors the parent's
 * kind-aware visibility flag (forward activities don't have a
 * duration of their own).
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
}

const ACTIVATION_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'action',   label: 'Action' },
  { value: 'bonus',    label: 'Bonus Action' },
  { value: 'reaction', label: 'Reaction' },
  { value: 'minute',   label: 'Minute' },
  { value: 'hour',     label: 'Hour' },
  { value: 'special',  label: 'Special' },
];

const DURATION_UNIT_OPTIONS: { value: string; label: string }[] = [
  { value: 'inst',   label: 'Instantaneous' },
  { value: 'round',  label: 'Round' },
  { value: 'minute', label: 'Minute' },
  { value: 'hour',   label: 'Hour' },
  { value: 'day',    label: 'Day' },
  { value: 'spec',   label: 'Special' },
];

export default function ActivationDurationEditor({
  activation,
  onActivationChange,
  duration,
  onDurationChange,
  showsDuration,
}: ActivationDurationEditorProps) {
  return (
    <div>
      <ActivitySection label="ACTIVATION">
        <FieldRow label="Cost">
          <Select
            value={activation?.type}
            onValueChange={val => onActivationChange({ type: val })}
          >
            <SelectTrigger className="field-input border-gold/15 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ACTIVATION_TYPE_OPTIONS.map(opt => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldRow>
        <FieldRow label="Value">
          <Input
            type="number"
            value={activation?.value ?? 1}
            onChange={e => onActivationChange({ value: parseInt(e.target.value, 10) || 1 })}
            className="field-input border-gold/15 text-xs text-center no-number-spin"
          />
        </FieldRow>
        <FieldRow label="Condition" hint="Required condition to trigger this activation">
          <Input
            value={activation?.condition || ''}
            onChange={e => onActivationChange({ condition: e.target.value })}
            placeholder="Activation Condition"
            className="field-input border-gold/15 text-xs"
          />
        </FieldRow>
        <FieldRow label="Override Activation" hint="Use this activity's activation instead of inheriting from a cast/forward source." inline>
          <Checkbox
            checked={activation?.override}
            onCheckedChange={checked => onActivationChange({ override: !!checked })}
          />
        </FieldRow>
      </ActivitySection>

      {showsDuration && (
        <ActivitySection label="DURATION">
          <FieldRow label="Value">
            <Input
              value={duration?.value || ''}
              onChange={e => onDurationChange({ value: e.target.value })}
              className="field-input border-gold/15 text-xs font-mono"
              placeholder="1"
            />
          </FieldRow>
          <FieldRow label="Time">
            <Select
              value={duration?.units}
              onValueChange={val => onDurationChange({ units: val })}
            >
              <SelectTrigger className="field-input border-gold/15 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DURATION_UNIT_OPTIONS.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldRow>
          <FieldRow label="Special">
            <Input
              value={duration?.special || ''}
              onChange={e => onDurationChange({ special: e.target.value })}
              className="field-input border-gold/15 text-xs"
              placeholder="Special duration text"
            />
          </FieldRow>
          <FieldRow label="Concentration" hint="Creature must maintain concentration while active." inline>
            <Checkbox
              checked={duration?.concentration}
              onCheckedChange={checked => onDurationChange({ concentration: !!checked })}
            />
          </FieldRow>
          <FieldRow label="Override Duration" inline>
            <Checkbox
              checked={duration?.override}
              onCheckedChange={checked => onDurationChange({ override: !!checked })}
            />
          </FieldRow>
        </ActivitySection>
      )}
    </div>
  );
}

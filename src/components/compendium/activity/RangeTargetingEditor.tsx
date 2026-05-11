import React from 'react';
import { Input } from '../../ui/input';
import { Checkbox } from '../../ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';
import { ActivitySection, FieldRow } from './primitives';
import { TARGET_TYPE_OPTIONS, TEMPLATE_TYPE_OPTIONS } from './constants';

/**
 * Range + Targets + Area editor for the activity Targeting tab.
 *
 * `range` covers how far the activity reaches (Self / Touch / Feet /
 * Miles / Special). `target.affects` covers who/what the activity
 * affects (a creature, an ally, an enemy, an object, a space). `area`
 * (i.e. `target.template`) covers the measured-template overlay shape
 * (cone, cube, line, sphere, etc.) for AoEs.
 *
 * Each section is hidden when the parent's kind-aware visibility
 * flag is false (forward activities don't have their own range, for
 * example).
 */

export interface RangeShape {
  units?: string;
  value?: string;
  special?: string;
  override?: boolean;
}

export interface TargetAffectsShape {
  type?: string;
  count?: string;
  choice?: boolean;
  special?: string;
}

export interface TargetTemplateShape {
  type?: string;
  count?: string;
  size?: string;
  units?: string;
  width?: string;
  height?: string;
  contiguous?: boolean;
  stationary?: boolean;
}

export interface TargetShape {
  affects?: TargetAffectsShape;
  template?: TargetTemplateShape;
  prompt?: boolean;
  override?: boolean;
}

export interface RangeTargetingEditorProps {
  range: RangeShape | undefined;
  onRangeChange: (patch: Partial<RangeShape>) => void;
  target: TargetShape | undefined;
  onAffectsChange: (patch: Partial<TargetAffectsShape>) => void;
  onTemplateChange: (patch: Partial<TargetTemplateShape>) => void;
  onTargetChange: (patch: Partial<TargetShape>) => void;
  showsRange: boolean;
  showsTargeting: boolean;
}

const RANGE_UNIT_OPTIONS: { value: string; label: string }[] = [
  { value: 'self',  label: 'Self' },
  { value: 'touch', label: 'Touch' },
  { value: 'ft',    label: 'Feet' },
  { value: 'mi',    label: 'Miles' },
  { value: 'spec',  label: 'Special' },
];

const TEMPLATE_UNIT_OPTIONS: { value: string; label: string }[] = [
  { value: 'ft', label: 'Feet' },
  { value: 'mi', label: 'Miles' },
];

export default function RangeTargetingEditor({
  range,
  onRangeChange,
  target,
  onAffectsChange,
  onTemplateChange,
  onTargetChange,
  showsRange,
  showsTargeting,
}: RangeTargetingEditorProps) {
  return (
    <div>
      {showsRange && (
        <ActivitySection label="RANGE">
          <FieldRow label="Unit">
            <Select
              value={range?.units}
              onValueChange={val => onRangeChange({ units: val })}
            >
              <SelectTrigger className="field-input border-gold/15 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RANGE_UNIT_OPTIONS.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldRow>
          <FieldRow label="Value">
            <Input
              value={range?.value || ''}
              onChange={e => onRangeChange({ value: e.target.value })}
              className="field-input border-gold/15 text-xs font-mono"
              placeholder="30"
            />
          </FieldRow>
          <FieldRow label="Special">
            <Input
              value={range?.special || ''}
              onChange={e => onRangeChange({ special: e.target.value })}
              placeholder="Special Range"
              className="field-input border-gold/15 text-xs"
            />
          </FieldRow>
          <FieldRow label="Override Range" hint="Important for cast and forward activities that can inherit another source." inline>
            <Checkbox
              checked={range?.override}
              onCheckedChange={checked => onRangeChange({ override: !!checked })}
            />
          </FieldRow>
        </ActivitySection>
      )}

      {showsTargeting && (
        <ActivitySection label="TARGETS">
          <FieldRow label="Type">
            <Select
              value={target?.affects?.type || 'none'}
              onValueChange={val => onAffectsChange({ type: val === 'none' ? '' : val })}
            >
              <SelectTrigger className="field-input border-gold/15 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TARGET_TYPE_OPTIONS.map(option => (
                  <SelectItem key={option.value} value={option.value || 'none'}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldRow>
          <FieldRow label="Count">
            <Input
              value={target?.affects?.count || ''}
              onChange={e => onAffectsChange({ count: e.target.value })}
              className="field-input border-gold/15 text-xs font-mono"
              placeholder="1"
            />
          </FieldRow>
          <FieldRow label="Special Targeting">
            <Input
              value={target?.affects?.special || ''}
              onChange={e => onAffectsChange({ special: e.target.value })}
              className="field-input border-gold/15 text-xs"
              placeholder="Additional target text"
            />
          </FieldRow>
          <FieldRow label="Allow Choice" inline>
            <Checkbox
              checked={target?.affects?.choice}
              onCheckedChange={checked => onAffectsChange({ choice: !!checked })}
            />
          </FieldRow>
        </ActivitySection>
      )}

      <ActivitySection label="AREA">
        <FieldRow label="Shape">
          <Select
            value={target?.template?.type || 'none'}
            onValueChange={val => onTemplateChange({ type: val === 'none' ? '' : val })}
          >
            <SelectTrigger className="field-input border-gold/15 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TEMPLATE_TYPE_OPTIONS.map(option => (
                <SelectItem key={option.value} value={option.value || 'none'}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldRow>
        <FieldRow label="Count">
          <Input
            value={target?.template?.count || ''}
            onChange={e => onTemplateChange({ count: e.target.value })}
            className="field-input border-gold/15 text-xs font-mono"
            placeholder="1"
          />
        </FieldRow>
        <FieldRow label="Size">
          <Input
            value={target?.template?.size || ''}
            onChange={e => onTemplateChange({ size: e.target.value })}
            className="field-input border-gold/15 text-xs font-mono"
            placeholder="15"
          />
        </FieldRow>
        <FieldRow label="Units">
          <Select
            value={target?.template?.units || 'ft'}
            onValueChange={val => onTemplateChange({ units: val })}
          >
            <SelectTrigger className="field-input border-gold/15 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TEMPLATE_UNIT_OPTIONS.map(opt => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldRow>
        <FieldRow label="Width">
          <Input
            value={target?.template?.width || ''}
            onChange={e => onTemplateChange({ width: e.target.value })}
            className="field-input border-gold/15 text-xs font-mono"
            placeholder="5"
          />
        </FieldRow>
        <FieldRow label="Height">
          <Input
            value={target?.template?.height || ''}
            onChange={e => onTemplateChange({ height: e.target.value })}
            className="field-input border-gold/15 text-xs font-mono"
            placeholder="5"
          />
        </FieldRow>
        <FieldRow label="Contiguous" hint="Template is a single connected area." inline>
          <Checkbox
            checked={target?.template?.contiguous}
            onCheckedChange={checked => onTemplateChange({ contiguous: !!checked })}
          />
        </FieldRow>
        <FieldRow label="Stationary" hint="Template can't be moved after placement." inline>
          <Checkbox
            checked={target?.template?.stationary}
            onCheckedChange={checked => onTemplateChange({ stationary: !!checked })}
          />
        </FieldRow>
        <FieldRow label="Override Target" inline>
          <Checkbox
            checked={target?.override}
            onCheckedChange={checked => onTargetChange({ override: !!checked })}
          />
        </FieldRow>
      </ActivitySection>
    </div>
  );
}

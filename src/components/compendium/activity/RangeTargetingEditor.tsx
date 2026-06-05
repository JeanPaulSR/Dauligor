import React from 'react';
import { Input } from '../../ui/input';
import { Checkbox } from '../../ui/checkbox';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '../../ui/select';
import { ActivitySection, FormRow, Field } from './primitives';

/**
 * Range + Targets + Area editor for the activity Targeting tab — rebuilt to
 * mirror Foundry dnd5e 5.3.1's `activity-targeting.hbs` + the `field-range` /
 * `field-targets` shared partials:
 *
 * - **Range**: a Unit dropdown (Self / Touch / Special / Any, then a grouped
 *   Distance set Feet / Miles / Meters / Kilometers). The numeric **Value**
 *   only renders for the scalar distance units — Self/Touch/Special/Any have
 *   no value. Special is a full-width input beneath.
 * - **Targets**: an affected-Type dropdown (individualTargetTypes). The
 *   **Amount** field only shows for scalar types (everything but Self). Special
 *   targeting shows once a type is set; "Allow Choice" only when an area
 *   template exists.
 * - **Area**: a Shape dropdown (areaTargetTypes). When a shape is set, the
 *   **Dimensions** row renders only the inputs that shape uses, with
 *   shape-specific labels (cone→Length, cylinder→Radius+Height, wall→Length+
 *   Thickness+Height, …) per `TargetField.templateDimensions`. Stationary shows
 *   for Emanation (`radius`); Contiguous when more than one template.
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

// Range units = `CONFIG.DND5E.rangeTypes` (self/touch/spec/any) + the distance
// `movementUnits` (ft/mi/m/km), grouped under "Distance" Foundry-style. The
// distance units are scalar — they reveal the numeric Value field.
const RANGE_UNIT_OPTIONS: { value: string; label: string; group?: string }[] = [
  { value: 'self',  label: 'Self' },
  { value: 'touch', label: 'Touch' },
  { value: 'spec',  label: 'Special' },
  { value: 'any',   label: 'Any' },
  { value: 'ft',    label: 'Feet',       group: 'Distance' },
  { value: 'mi',    label: 'Miles',      group: 'Distance' },
  { value: 'm',     label: 'Meters',     group: 'Distance' },
  { value: 'km',    label: 'Kilometers', group: 'Distance' },
];
const SCALAR_RANGE = new Set(['ft', 'mi', 'm', 'km']);

// `CONFIG.DND5E.individualTargetTypes` (dnd5e 5.3.1). "None" (cleared) is added
// separately. `scalar` (everything but Self) gates the Amount/count field.
const TARGET_AFFECTS_OPTIONS: { value: string; label: string; scalar?: boolean }[] = [
  { value: 'self',             label: 'Self' },
  { value: 'ally',             label: 'Ally', scalar: true },
  { value: 'enemy',            label: 'Enemy', scalar: true },
  { value: 'creature',         label: 'Creature', scalar: true },
  { value: 'object',           label: 'Object', scalar: true },
  { value: 'space',            label: 'Space', scalar: true },
  { value: 'creatureOrObject', label: 'Creature or Object', scalar: true },
  { value: 'any',              label: 'Any', scalar: true },
  { value: 'willing',          label: 'Willing Creature', scalar: true },
];
const SCALAR_AFFECTS = new Set(TARGET_AFFECTS_OPTIONS.filter(o => o.scalar).map(o => o.value));

// `CONFIG.DND5E.areaTargetTypes` (dnd5e 5.3.1). "None" (cleared) added
// separately. `radius` is Foundry's "Emanation".
const AREA_SHAPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'circle',   label: 'Circle' },
  { value: 'cone',     label: 'Cone' },
  { value: 'cube',     label: 'Cube' },
  { value: 'cylinder', label: 'Cylinder' },
  { value: 'radius',   label: 'Emanation' },
  { value: 'line',     label: 'Line' },
  { value: 'sphere',   label: 'Sphere' },
  { value: 'square',   label: 'Square' },
  { value: 'wall',     label: 'Wall' },
];

// Per-shape dimension labels, mirroring `TargetField.templateDimensions`:
// the always-present `size` field is relabelled per shape, and width/height
// only appear for shapes that use them. Values still write to the fixed
// `size` / `width` / `height` data fields.
const AREA_DIMENSIONS: Record<string, { size: string; width?: string; height?: string }> = {
  circle:   { size: 'Radius' },
  cone:     { size: 'Length' },
  cube:     { size: 'Width' },
  cylinder: { size: 'Radius', height: 'Height' },
  radius:   { size: 'Size' },
  line:     { size: 'Length', width: 'Width' },
  sphere:   { size: 'Radius' },
  square:   { size: 'Width' },
  wall:     { size: 'Length', width: 'Thickness', height: 'Height' },
};

const TEMPLATE_UNIT_OPTIONS: { value: string; label: string }[] = [
  { value: 'ft', label: 'Feet' },
  { value: 'mi', label: 'Miles' },
  { value: 'm',  label: 'Meters' },
  { value: 'km', label: 'Kilometers' },
];

const GROUP_LABEL_CLASS = 'text-[10px] font-black uppercase tracking-wider text-gold/55 px-2 pt-2 pb-1';

export default function RangeTargetingEditor({
  range,
  onRangeChange,
  target,
  onAffectsChange,
  onTemplateChange,
  showsRange,
  showsTargeting,
}: RangeTargetingEditorProps) {
  const affects = target?.affects;
  const template = target?.template;
  const isScalarRange = SCALAR_RANGE.has(range?.units || '');
  const isScalarAffects = SCALAR_AFFECTS.has(affects?.type || '');
  const dims = template?.type ? AREA_DIMENSIONS[template.type] : undefined;
  const templateCount = parseInt(String(template?.count ?? ''), 10);

  return (
    <div>
      {showsRange && (
        <ActivitySection label="Range">
          <FormRow
            label="Range"
            below={
              <Input
                value={range?.special || ''}
                onChange={e => onRangeChange({ special: e.target.value })}
                placeholder="Special Range"
                className="field-input border-gold/15 text-xs w-full mt-2"
              />
            }
          >
            {isScalarRange && (
              <Field label="Value" className="w-24 shrink-0">
                <Input
                  value={range?.value || ''}
                  onChange={e => onRangeChange({ value: e.target.value })}
                  className="field-input border-gold/15 text-xs text-center font-mono"
                  placeholder="30"
                />
              </Field>
            )}
            <Field label="Unit" className="flex-1">
              <Select value={range?.units} onValueChange={val => onRangeChange({ units: val })}>
                <SelectTrigger className="field-input border-gold/15 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RANGE_UNIT_OPTIONS.filter(o => !o.group).map(o => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                  <SelectGroup>
                    <SelectLabel className={GROUP_LABEL_CLASS}>Distance</SelectLabel>
                    {RANGE_UNIT_OPTIONS.filter(o => o.group === 'Distance').map(o => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </FormRow>
        </ActivitySection>
      )}

      {showsTargeting && (
        <>
          <ActivitySection label="Targets">
            <FormRow
              label="Type"
              below={
                affects?.type ? (
                  <Input
                    value={affects?.special || ''}
                    onChange={e => onAffectsChange({ special: e.target.value })}
                    placeholder="Special targeting"
                    className="field-input border-gold/15 text-xs w-full mt-2"
                  />
                ) : null
              }
            >
              {isScalarAffects && (
                <Field label="Amount" className="w-24 shrink-0">
                  <Input
                    value={affects?.count || ''}
                    onChange={e => onAffectsChange({ count: e.target.value })}
                    className="field-input border-gold/15 text-xs text-center font-mono"
                    placeholder="Any"
                  />
                </Field>
              )}
              <Field label="Type" className="flex-1">
                <Select
                  value={affects?.type || '__none'}
                  onValueChange={val => onAffectsChange({ type: val === '__none' ? '' : val })}
                >
                  <SelectTrigger className="field-input border-gold/15 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">None</SelectItem>
                    {TARGET_AFFECTS_OPTIONS.map(o => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </FormRow>
            {template?.type && (
              <FormRow inline label="Allow Choice" hint="Let the player choose which valid targets are affected.">
                <Checkbox
                  checked={affects?.choice}
                  onCheckedChange={checked => onAffectsChange({ choice: !!checked })}
                />
              </FormRow>
            )}
          </ActivitySection>

          <ActivitySection label="Area">
            <FormRow label="Shape">
              <Field label="Type" className="flex-1">
                <Select
                  value={template?.type || '__none'}
                  onValueChange={val => onTemplateChange({ type: val === '__none' ? '' : val })}
                >
                  <SelectTrigger className="field-input border-gold/15 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">None</SelectItem>
                    {AREA_SHAPE_OPTIONS.map(o => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </FormRow>

            {template?.type && (
              <>
                {dims && (
                  <FormRow label="Dimensions">
                    <Field label={dims.size} className="flex-1">
                      <Input
                        value={template?.size || ''}
                        onChange={e => onTemplateChange({ size: e.target.value })}
                        className="field-input border-gold/15 text-xs text-center font-mono"
                        placeholder="15"
                      />
                    </Field>
                    {dims.width && (
                      <Field label={dims.width} className="flex-1">
                        <Input
                          value={template?.width || ''}
                          onChange={e => onTemplateChange({ width: e.target.value })}
                          className="field-input border-gold/15 text-xs text-center font-mono"
                          placeholder="5"
                        />
                      </Field>
                    )}
                    {dims.height && (
                      <Field label={dims.height} className="flex-1">
                        <Input
                          value={template?.height || ''}
                          onChange={e => onTemplateChange({ height: e.target.value })}
                          className="field-input border-gold/15 text-xs text-center font-mono"
                          placeholder="5"
                        />
                      </Field>
                    )}
                    <Field label="Unit" className="flex-1">
                      <Select
                        value={template?.units || 'ft'}
                        onValueChange={val => onTemplateChange({ units: val })}
                      >
                        <SelectTrigger className="field-input border-gold/15 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TEMPLATE_UNIT_OPTIONS.map(o => (
                            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  </FormRow>
                )}
                <FormRow label="Multiple">
                  <Field label="Amount" className="w-24 shrink-0">
                    <Input
                      value={template?.count || ''}
                      onChange={e => onTemplateChange({ count: e.target.value })}
                      className="field-input border-gold/15 text-xs text-center font-mono"
                      placeholder="1"
                    />
                  </Field>
                </FormRow>
                {templateCount > 1 && (
                  <FormRow inline label="Contiguous" hint="Templates must form a single connected area.">
                    <Checkbox
                      checked={template?.contiguous}
                      onCheckedChange={checked => onTemplateChange({ contiguous: !!checked })}
                    />
                  </FormRow>
                )}
                {template?.type === 'radius' && (
                  <FormRow inline label="Stationary" hint="Template can't be moved after placement.">
                    <Checkbox
                      checked={template?.stationary}
                      onCheckedChange={checked => onTemplateChange({ stationary: !!checked })}
                    />
                  </FormRow>
                )}
              </>
            )}
          </ActivitySection>
        </>
      )}
    </div>
  );
}

import React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';

/**
 * Base-ui multi-select rendering comma-joined labels — the activity editor's
 * standard multi pattern (Save abilities, Check associated, Ignored Properties,
 * Summon/Transform creature sizes & types & movement). base-ui's default
 * SelectValue only renders single values, so we supply a custom join renderer.
 */
export default function MultiSelect({ value, onChange, options, placeholder = 'None' }: {
  value: string[];
  onChange: (next: string[]) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
}) {
  return (
    <Select multiple value={value} onValueChange={(vals: string[]) => onChange(vals)}>
      <SelectTrigger className="field-input border-gold/15 text-xs">
        <SelectValue placeholder={placeholder}>
          {(v: unknown) => {
            const arr = Array.isArray(v) ? (v as string[]) : [];
            if (!arr.length) return '';
            return arr.map(x => options.find(o => o.value === x)?.label || x).join(', ');
          }}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

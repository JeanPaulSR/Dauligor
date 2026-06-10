import React from 'react';
import { cn } from '../../../lib/utils';

/**
 * A toggleable chip multi-select over a fixed option list (damage types,
 * conditions, languages, habitats). Value is the selected slug array.
 */
export default function ChipMultiSelect({ options, value, onChange }: {
  options: ReadonlyArray<[string, string]>;
  value: string[] | undefined;
  onChange: (next: string[]) => void;
}) {
  const selected = new Set(value || []);
  const toggle = (v: string) => {
    const next = new Set(selected);
    if (next.has(v)) next.delete(v); else next.add(v);
    onChange([...next]);
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(([v, label]) => {
        const on = selected.has(v);
        return (
          <button
            key={v}
            type="button"
            onClick={() => toggle(v)}
            className={cn(
              'text-xs px-2 py-1 rounded border transition-colors',
              on ? 'border-gold/50 bg-gold/15 text-gold font-medium' : 'border-gold/15 text-ink/60 hover:border-gold/30 hover:text-ink',
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

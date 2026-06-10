import React from 'react';
import { cn } from '../../../lib/utils';
import { Input } from '../../ui/input';

/**
 * Shared form primitives for the monster editor tabs (Basics / Defenses /
 * Movement & Senses / …). Thin wrappers around `Input` + a native select so
 * the tabs stay declarative. The editor's form state is the camelCase monster
 * row itself (`MonsterForm`); `SetForm` patches it.
 */

export type MonsterForm = Record<string, any>;
export type SetForm = (patch: Partial<MonsterForm>) => void;

const INPUT_CLASS = 'h-8 bg-background/50 border-gold/15 focus:border-gold text-sm';

export function Field({ label, children, className }: {
  label: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return (
    <label className={cn('space-y-0.5 block', className)}>
      <span className="block text-[10px] font-bold uppercase tracking-widest text-ink/45">{label}</span>
      {children}
    </label>
  );
}

export function TextField({ value, onChange, placeholder, mono, className }: {
  value: any; onChange: (v: string) => void; placeholder?: string; mono?: boolean; className?: string;
}) {
  return (
    <Input
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={cn(INPUT_CLASS, mono && 'font-mono', className)}
    />
  );
}

/** Number input that emits `number | null` (empty → null). */
export function NumField({ value, onChange, placeholder, className }: {
  value: number | null | undefined; onChange: (v: number | null) => void; placeholder?: string; className?: string;
}) {
  return (
    <Input
      type="number"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      placeholder={placeholder}
      className={cn(INPUT_CLASS, className)}
    />
  );
}

export function Sel({ value, onChange, options, className }: {
  value: string; onChange: (v: string) => void; options: ReadonlyArray<[string, string]>; className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn('h-8 w-full bg-background/50 border border-gold/15 focus:border-gold rounded-md px-2 text-sm text-ink', className)}
    >
      {options.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
    </select>
  );
}

/** Small "adopt the computed value" affordance — the recompute nudge. */
export function Nudge({ label, onClick, title }: { label: string; onClick: () => void; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-gold/80 hover:text-gold border border-gold/30 rounded px-1.5 h-7 whitespace-nowrap"
    >
      {label}
    </button>
  );
}

export function MonsterFieldset({ legend, children }: { legend: string; children: React.ReactNode }) {
  return (
    <fieldset className="config-fieldset">
      <legend className="text-[10px] font-bold uppercase tracking-widest text-gold/75 px-1">{legend}</legend>
      <div className="pt-1">{children}</div>
    </fieldset>
  );
}

export function numOrNull(v: any): number | null {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

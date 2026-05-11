import React from 'react';
import { cn } from '../../../lib/utils';

/**
 * Section header for grouping FieldRows inside an activity tab.
 *
 * Gold-tinted bar with a left-edge accent stripe and a real
 * container box around the rows below. Replaces the earlier
 * "tiny label between dashed lines" pattern that was easy to miss
 * while scrolling. Shared by every extracted sub-editor
 * (DamagePartEditor, ConsumptionEditor, etc.) so section visuals
 * stay consistent across the activity editor surface.
 */
export function ActivitySection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="mt-5 first:mt-0">
      <header className="flex items-center gap-2 mb-1 px-3 py-2 rounded-t bg-gold/8 border border-gold/15 border-b-0">
        <span className="w-1 h-3 bg-gold/60 rounded-sm shrink-0" aria-hidden />
        <h3 className="text-[10px] uppercase tracking-[0.2em] font-black text-gold/80 select-none">{label}</h3>
      </header>
      <div className="border border-gold/15 border-t-0 rounded-b px-3 divide-y divide-gold/8 bg-background/20">
        {children}
      </div>
    </section>
  );
}

/**
 * Single labelled field inside an ActivitySection.
 *
 * The label column carries the field name + optional hint; the
 * input column sits on the right at a fixed width so labels and
 * inputs line up across sibling rows. `inline=true` collapses the
 * alignment for single-control rows (checkboxes etc.).
 */
export function FieldRow({
  label, hint, children, inline = false,
}: {
  label: string; hint?: string; children: React.ReactNode; inline?: boolean;
}) {
  return (
    <div className={cn('flex gap-4 py-2.5', inline ? 'items-center' : 'items-start')}>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-ink/80 leading-none">{label}</p>
        {hint && <p className="text-[10px] text-ink/40 mt-1 leading-snug">{hint}</p>}
      </div>
      <div className={inline ? 'shrink-0' : 'w-[240px] shrink-0'}>{children}</div>
    </div>
  );
}

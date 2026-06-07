import React from 'react';
import { Plus } from 'lucide-react';
import { Checkbox } from '../../ui/checkbox';
import { cn } from '../../../lib/utils';

/**
 * Section header for grouping rows inside an activity tab.
 *
 * Gold-tinted bar with a left-edge accent stripe and a real
 * container box around the rows below — our themed equivalent of
 * Foundry dnd5e's `<fieldset><legend>` activity sections.
 *
 * `onAdd` renders a ➕ control on the right of the header, matching
 * the Foundry pattern where repeating sections (Consumption,
 * Recovery, Damage parts, Applied Effects) add rows from the header.
 *
 * `override` adds a Foundry-style override toggle to the legend. Cast/Forward
 * activities inherit their activation/duration/range/target from a linked spell
 * (or target activity) unless overridden — mirroring dnd5e's
 * `<legend><label class="checkbox">` + `disabled.<field>` pattern. When the
 * toggle is OFF the section content is locked (greyed, non-interactive) and
 * shows an inherited notice. `locked` locks the content WITHOUT its own
 * checkbox — for a section that shares a sibling's override flag (e.g. Area
 * shares the Targets override).
 */
export function ActivitySection({
  label, onAdd, addLabel = 'Add', override, locked, children,
}: {
  label: string;
  onAdd?: () => void;
  addLabel?: string;
  override?: { checked: boolean; onChange: (next: boolean) => void; hint?: string; note?: string };
  locked?: boolean;
  children: React.ReactNode;
}) {
  const isLocked = !!locked || (!!override && !override.checked);
  return (
    <section className="mt-3.5 first:mt-0">
      <header className="flex items-center gap-2 mb-1 px-3 py-1.5 rounded-t bg-gold/5 border border-gold/15 border-b-0">
        <span className="w-1 h-3 bg-gold/65 rounded-sm shrink-0" aria-hidden />
        <h3 className="flex-1 text-[10px] uppercase tracking-[0.2em] font-black text-gold/85 select-none">{label}</h3>
        {override ? (
          <label className="-my-0.5 shrink-0 flex items-center gap-1.5 cursor-pointer select-none" title={override.hint}>
            <span className="text-[9px] uppercase tracking-wider font-black text-gold/55">Override</span>
            <Checkbox checked={override.checked} onCheckedChange={v => override.onChange(!!v)} />
          </label>
        ) : null}
        {onAdd ? (
          <button
            type="button"
            onClick={onAdd}
            title={addLabel}
            aria-label={addLabel}
            className="-my-0.5 shrink-0 flex items-center justify-center w-5 h-5 cursor-pointer rounded border border-gold/30 bg-gold/10 text-gold/80 hover:bg-gold/20 hover:text-gold hover:border-gold/50 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        ) : null}
      </header>
      <div
        className={cn(
          'border border-gold/15 border-t-0 rounded-b px-3 divide-y divide-gold/5 bg-background/20',
          isLocked && 'opacity-50 pointer-events-none select-none',
        )}
        aria-disabled={isLocked || undefined}
      >
        {isLocked && override?.note ? (
          <p className="py-2 text-[10px] italic text-ink/55 leading-snug">{override.note}</p>
        ) : null}
        {children}
      </div>
    </section>
  );
}

/**
 * Foundry-style "split group" row: a bold field label on the left and
 * a control cluster on the right. Mirrors dnd5e's `.form-group.split-group`
 * layout. The control cluster holds one or more <Field> cells (each with
 * its own small uppercase "label-top" header), an optional full-width
 * `below` element (Foundry's `.full-width` condition / special inputs),
 * and an optional `hint` that spans beneath the whole row.
 *
 * `inline` collapses the layout for single-checkbox rows (Concentration,
 * Flat To Hit, etc.) — label left, control right, vertically centered.
 */
export function FormRow({
  label, hint, children, below, inline = false, wideControls = false,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  children?: React.ReactNode;
  below?: React.ReactNode;
  inline?: boolean;
  /**
   * Let the control cluster fill the remaining row width (label shrinks to its
   * content) instead of the fixed 256px column — for rows packing several
   * cells, e.g. the area Dimensions row (Size / Width / Height / Unit).
   */
  wideControls?: boolean;
}) {
  return (
    <div className="py-2">
      <div className={cn('flex gap-4', inline ? 'items-center' : 'items-end')}>
        <p className={cn('min-w-0 text-xs font-semibold text-ink/85 leading-tight', wideControls ? 'shrink-0' : 'flex-1')}>{label}</p>
        {children != null && (
          <div className={cn('flex items-end gap-2', inline ? 'shrink-0' : (wideControls ? 'flex-1' : 'w-[256px] shrink-0'))}>
            {children}
          </div>
        )}
      </div>
      {below}
      {hint && <p className="text-[10px] text-ink/45 mt-1 leading-snug">{hint}</p>}
    </div>
  );
}

/**
 * A single control cell with a small uppercase header above it —
 * Foundry's `.label-top` form-field. Used inside a <FormRow> control
 * cluster (e.g. "Amount" + "Cost", "Period" + "Recovery" + "Formula").
 * Pass `className="flex-1"` on the cell that should fill the row.
 */
export function Field({
  label, children, className,
}: {
  label?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-1 min-w-0', className)}>
      {label ? (
        <span className="text-[9px] uppercase tracking-wider text-ink/45 font-black leading-none">{label}</span>
      ) : null}
      {children}
    </div>
  );
}

/** Foundry's `.empty` placeholder for an empty repeating section ("None" / "Never"). */
export function EmptyRow({ children = 'None' }: { children?: React.ReactNode }) {
  return <p className="py-3 text-center text-ink/35 italic text-[11px] select-none">{children}</p>;
}

/**
 * Single labelled field — legacy row used by activity-kind sections not
 * yet migrated to the Foundry <FormRow> layout. Kept so unmigrated kinds
 * keep rendering while the rebuild rolls out kind by kind.
 */
export function FieldRow({
  label, hint, children, inline = false,
}: {
  label: string; hint?: string; children: React.ReactNode; inline?: boolean;
}) {
  return (
    <div className={cn('flex gap-4 py-2', inline ? 'items-center' : 'items-start')}>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-ink/85 leading-tight">{label}</p>
        {hint && <p className="text-[10px] text-ink/45 mt-0.5 leading-snug">{hint}</p>}
      </div>
      <div className={inline ? 'shrink-0' : 'w-[240px] shrink-0'}>{children}</div>
    </div>
  );
}

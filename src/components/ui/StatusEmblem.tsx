import React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Square-cornered status chip used for tagging rows with a short
 * uppercase label (Manual / Auto / Stale / etc).
 *
 * Extracted from the inline `<span className="rounded-full border…">`
 * pattern that was being copy-pasted across the spell pages, class
 * editor, character builder, etc. Centralising it means:
 *   - One place to tweak the visual aesthetic (border radius,
 *     padding, font scale) for every status chip in the app.
 *   - A semantic `tone` prop instead of ad-hoc Tailwind class
 *     concatenation per site, so the same intent reads the same
 *     way (e.g. every `tone="manual"` looks identical).
 *
 * Tones map onto Dauligor's existing palette:
 *   - `manual`   gold accent — admin-controlled, deliberate state
 *   - `auto`     muted ink — system-derived, default state
 *   - `stale`    amber — needs attention but not an error
 *   - `warning`  amber (alias for stale, semantically different
 *                 callers — e.g. "Stale" vs "Outdated" vs "Pending")
 *   - `error`    blood — failure / blocking state
 *   - `success`  emerald — passing / healthy state
 *   - `neutral`  subtle gold — generic count / pill chrome
 *
 * Sizing: defaults to the prevailing `text-[9px] uppercase tracking-widest`
 * micro-label rhythm used across the compendium pages. Pass `size="md"`
 * for the slightly larger `text-[10px]` rhythm used on toolbars +
 * filter chips.
 *
 * Pass a `title` attribute (via {...rest}) for the tooltip; the
 * component is just a `<span>` so any HTML attribute passes through.
 */
const statusEmblemVariants = cva(
  // `cursor-default` keeps the I-beam text-selection cursor away from
  // these chips. They exist for at-a-glance scanning + an optional
  // tooltip (via the `title` attribute), not for text selection — the
  // default arrow signals that more clearly. If a caller ever wants
  // the help-cursor (`?`), they can override via className.
  'inline-flex items-center justify-center rounded border font-bold uppercase whitespace-nowrap cursor-default',
  {
    variants: {
      tone: {
        manual: 'border-gold/40 bg-gold/10 text-gold',
        auto: 'border-ink/15 bg-ink/5 text-ink/55',
        stale: 'border-amber-400/40 bg-amber-400/10 text-amber-400',
        warning: 'border-amber-400/40 bg-amber-400/10 text-amber-400',
        error: 'border-blood/40 bg-blood/10 text-blood',
        success: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500',
        neutral: 'border-gold/25 bg-gold/5 text-gold/80',
      },
      size: {
        // `sm` — inline mini-label rhythm (9px). Use when the emblem
        // sits in dense rows (e.g. a count badge inside a card row).
        sm: 'px-2 py-0.5 text-[9px] tracking-widest',
        // `md` — toolbar / filter-chip rhythm (10px) at h-7 to align
        // with shadcn Buttons in the same column. Use when the
        // emblem is paired with action buttons that need vertical
        // alignment (RuleMembershipPanel's right column).
        md: 'h-7 px-2 text-[10px] tracking-[0.18em]',
      },
    },
    defaultVariants: {
      tone: 'neutral',
      size: 'sm',
    },
  },
);

export type StatusEmblemTone = NonNullable<VariantProps<typeof statusEmblemVariants>['tone']>;
export type StatusEmblemSize = NonNullable<VariantProps<typeof statusEmblemVariants>['size']>;

export interface StatusEmblemProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof statusEmblemVariants> {}

export function StatusEmblem({
  className,
  tone,
  size,
  children,
  ...rest
}: StatusEmblemProps) {
  return (
    <span className={cn(statusEmblemVariants({ tone, size }), className)} {...rest}>
      {children}
    </span>
  );
}

export default StatusEmblem;

import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Compact "Back to <X>" navigation chip.
 *
 * Three ways to specify the destination, in priority order:
 *
 *   1. Explicit `to` prop — caller provides a route + label. Used
 *      when the back target is implied by the current page's
 *      context (e.g. SpellList scoped to `?class=<id>` sets
 *      to=`/compendium/classes/view/<id>` + label=`Back to <name>`).
 *      Highest priority — overrides everything below.
 *
 *   2. `location.state.from` — React Router's location.state
 *      passed by the Link that brought the user here. Useful for
 *      flows where the source URL isn't reconstructable from the
 *      destination's URL alone.
 *
 *   3. Browser history fallback — uses `navigate(-1)` when neither
 *      of the above is set. The least informative (we don't know
 *      WHAT the user is going back to) so we render a generic
 *      "Back" label and only show this if `fallback={true}` is
 *      explicitly opted in.
 *
 * Layout: h-8, matches FilterBar / toolbar button heights so it
 * sits cleanly in the leadingActions slot.
 */
export interface BackButtonProps {
  /** Explicit destination route. Takes precedence over everything else. */
  to?: string;
  /** Label override — defaults to "Back" if no `to` is given, or "Back to <label>" otherwise. */
  label?: string;
  /** Tooltip override. */
  title?: string;
  /**
   * Allow falling back to `navigate(-1)` when neither `to` nor
   * `location.state.from` is set. Default false because a generic
   * "Back" button with no target context is usually less useful
   * than just not rendering the chip at all — pages that opt in
   * accept the trade-off.
   */
  fallback?: boolean;
  className?: string;
}

export default function BackButton({
  to,
  label,
  title,
  fallback = false,
  className,
}: BackButtonProps) {
  const location = useLocation();
  const navigate = useNavigate();

  // Priority resolution.
  const stateFrom = (location.state as { from?: string; fromLabel?: string } | null)?.from;
  const stateFromLabel = (location.state as { from?: string; fromLabel?: string } | null)?.fromLabel;

  const resolvedTo = to || stateFrom || null;
  const resolvedLabel = label
    || (to ? 'Back' : stateFromLabel ? `Back to ${stateFromLabel}` : 'Back');

  const baseClasses =
    'inline-flex items-center gap-1 h-8 px-2 rounded-md border border-gold/20 ' +
    'text-[11px] font-bold uppercase tracking-widest text-gold ' +
    'hover:bg-gold/10 hover:border-gold/40 transition-colors whitespace-nowrap';

  // Case 1: explicit route or routed-via-state — use <Link>.
  if (resolvedTo) {
    return (
      <Link to={resolvedTo} className={cn(baseClasses, className)} title={title || resolvedLabel}>
        <ChevronLeft className="w-3.5 h-3.5" />
        {resolvedLabel}
      </Link>
    );
  }

  // Case 2: no route and no state — only render if fallback is on.
  if (!fallback) return null;
  return (
    <button
      type="button"
      onClick={() => navigate(-1)}
      className={cn(baseClasses, className)}
      title={title || resolvedLabel}
    >
      <ChevronLeft className="w-3.5 h-3.5" />
      {resolvedLabel}
    </button>
  );
}

// =============================================================================
// CascadeDependentBanner — surfaced inside an editor when the entity
// being edited is a cascade-enrolled dependent of some other parent
// delete in the same block.
// =============================================================================
//
// When the cascade engine enrolls dependents (e.g. a tag delete fans
// out to every spell/class/feat that references it), each dependent
// shows up as a server-side draft revision with
// `cascade_parent_revision_id` pointing at the parent. The proposer
// sees the dependent in their block list (Phase 3 part 2), and when
// they OPEN that dependent's editor, this banner appears at the top
// so they can:
//
//   - **Accept removal** (default) — the auto-queued UPDATE stays as
//     is: the reference to the deleted entity is stripped from the
//     dependent's JSON column. One click and the banner closes.
//   - **Replace** — open a picker filtered to the deleted entity's
//     type, choose a replacement, and the auto-queued payload is
//     PATCHed so the JSON column contains the replacement id instead
//     of nothing.
//
// Both actions resolve the "needs handling" state on this dependent
// without removing it from the bundle. Submitting the block then
// posts all dependents alongside the parent delete in one atomic
// admin queue entry (Phase 4 grouping).
//
// The banner is a no-op outside review/edit mode for a cascade-
// enrolled entity — when `parentDraft` is null, the component
// renders nothing.
// =============================================================================

import { AlertTriangle, Check, ArrowLeftRight } from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { cn } from '../../lib/utils';

export function CascadeDependentBanner({
  /** Brief description of WHY this dependent is enrolled, copied from
   *  the parent strategy's `description` field on the dependent spec. */
  description,
  /** Has the proposer already resolved this dependent? When true, the
   *  banner switches to the "accepted" state with a way to re-open. */
  resolved,
  /** Click handler for "Accept removal" — typically a no-op marker
   *  set on the draft's payload that this UI checks via `resolved`. */
  onAccept,
  /** Click handler for "Replace…" — opens a picker (caller owns the
   *  picker component, which is entity-type specific). */
  onReplace,
  /** Reset the resolution state if the user changes their mind. */
  onReopen,
  className,
}: {
  description: string;
  resolved: boolean;
  onAccept: () => void | Promise<void>;
  onReplace: () => void;
  onReopen?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-md border px-4 py-3 flex items-start justify-between gap-3',
        resolved
          ? 'border-emerald-600/30 bg-emerald-600/5'
          : 'border-amber-500/40 bg-amber-500/5',
        className,
      )}
    >
      <div className="flex items-start gap-3 min-w-0 flex-1">
        {resolved ? (
          <Check className="w-4 h-4 mt-0.5 flex-shrink-0 text-emerald-700" />
        ) : (
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-600" />
        )}
        <div className="space-y-1 min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge
              variant="outline"
              className={cn(
                'text-[9px] font-bold uppercase tracking-widest',
                resolved
                  ? 'border-emerald-700/30 text-emerald-700'
                  : 'border-amber-600/40 text-amber-700',
              )}
            >
              {resolved ? 'Dependent · resolved' : 'Cascade dependent · needs review'}
            </Badge>
          </div>
          <p className="text-xs leading-relaxed text-ink/85">{description}</p>
          {!resolved && (
            <p className="text-[11px] leading-relaxed text-ink/55">
              This change was auto-enrolled by a parent delete in your block.
              Accept the strip-the-reference default, or pick a replacement to
              substitute in.
            </p>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-1.5 flex-shrink-0">
        {resolved ? (
          onReopen && (
            <Button
              size="sm"
              variant="outline"
              onClick={onReopen}
              className="gap-1.5"
            >
              Re-open
            </Button>
          )
        ) : (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={onReplace}
              className="gap-1.5"
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
              Replace…
            </Button>
            <Button
              size="sm"
              onClick={() => void onAccept()}
              className="gap-1.5 bg-emerald-700 text-white hover:bg-emerald-700/90"
            >
              <Check className="w-3.5 h-3.5" />
              Accept
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

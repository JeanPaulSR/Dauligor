// =============================================================================
// TombstoneRow — visual decorator + undo affordance for entities the
// user has queued for deletion in a proposal block.
// =============================================================================
//
// Rendered inline inside each editor's list (Tags, Spells, Feats, …)
// when `proposalContext.queue` or `useBlock().drafts` carry a DELETE
// revision for a row. Until Submit Changes drains the queue (or Phase
// 2's cascade enrollment lands), the row stays in the catalog with a
// red strikethrough so the proposer can quickly undo a regret-delete.
//
// Undo wires to `dropEntity(id)` on the proposal accumulator context,
// which:
//   - Removes the entity's queue entries (the DELETE we're undoing)
//   - DELETEs any server-side draft revisions for that entity in the
//     active block (so a previously-submitted DELETE draft also clears)
//
// The component is presentation-only — the editor decides how to
// arrange children (name, badges, etc.). Pass `name` for the header
// strikethrough; everything else (icons, count badges) goes in
// `children` and inherits the muted/strikethrough treatment.
// =============================================================================

import type { ReactNode } from 'react';
import { Trash2, Undo2 } from 'lucide-react';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';

export function TombstoneRow({
  name,
  children,
  onUndo,
  size = 'md',
  className,
}: {
  /** Primary identifier (e.g. tag name, spell name) shown with strikethrough. */
  name: string;
  /** Optional secondary info (counts, source, icons). Rendered with
   *  muted opacity so the strikethrough effect carries through. */
  children?: ReactNode;
  /** Click handler for the undo button. Should call
   *  `proposalContext.dropEntity(id)` upstream so the queue + drafts
   *  both clear. */
  onUndo: () => void;
  /** Compact list rows vs full-height detail panels. */
  size?: 'sm' | 'md';
  className?: string;
}) {
  const padding = size === 'sm' ? 'px-2 py-1' : 'px-3 py-2';
  return (
    <div
      className={cn(
        // Red tint + dashed border so the tombstone is unmistakable
        // even when several rows are decorated. Mirrors the
        // archive-blue treatment used for "modified in block" so the
        // visual vocabulary stays consistent.
        'flex items-center justify-between gap-2 border-l-4 border-blood/60 bg-blood/5 transition-colors hover:bg-blood/10',
        padding,
        className,
      )}
      title={`${name} — marked for deletion in this block`}
    >
      <div className="min-w-0 flex-1 flex items-center gap-2 opacity-70">
        <Trash2 className="w-3.5 h-3.5 shrink-0 text-blood/70" />
        <div className="min-w-0 flex-1">
          <span className="font-bold line-through text-blood/80 truncate block">
            {name}
          </span>
          {children && (
            <div className="text-[11px] line-through text-ink/40 truncate">
              {children}
            </div>
          )}
        </div>
        <span className="shrink-0 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest bg-blood/10 text-blood/80 rounded">
          Deleted
        </span>
      </div>
      <Button
        size="sm"
        variant="ghost"
        onClick={(e) => {
          e.stopPropagation();
          onUndo();
        }}
        className="h-7 w-7 p-0 text-blood hover:bg-blood/10"
        title="Undo delete"
      >
        <Undo2 className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}

/**
 * Banner variant for single-work editors (ClassEditor, SubclassEditor,
 * UniqueOptionGroupEditor): the user has the entity open and queued it
 * for deletion. The form body wraps in <fieldset disabled> below this
 * banner so the inputs go read-only without removing the page.
 */
export function DeletedEntityBanner({
  entityLabel,
  name,
  onUndo,
}: {
  /** Capitalised entity label, e.g. "Class", "Subclass". */
  entityLabel: string;
  name: string;
  onUndo: () => void;
}) {
  return (
    <div className="rounded-md border border-blood/40 bg-blood/5 px-4 py-3 flex items-start justify-between gap-3">
      <div className="flex items-start gap-3 min-w-0 flex-1">
        <Trash2 className="w-4 h-4 mt-0.5 flex-shrink-0 text-blood" />
        <div className="space-y-1 min-w-0 flex-1">
          <p className="text-sm font-bold text-blood">
            {entityLabel} marked for deletion
          </p>
          <p className="text-xs text-ink/70 leading-relaxed">
            <span className="font-semibold">{name}</span> will be removed when
            this block is approved. The form below is read-only until you undo
            the delete or submit the block.
          </p>
        </div>
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={onUndo}
        className="gap-1.5 flex-shrink-0 border-blood/40 text-blood hover:bg-blood/10"
      >
        <Undo2 className="w-3.5 h-3.5" />
        Undo delete
      </Button>
    </div>
  );
}

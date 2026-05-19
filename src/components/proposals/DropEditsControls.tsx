// =============================================================================
// Drop Edits UI primitives — entity / section / field level revert
// controls for editors inside <ProposalEditorWrapper>.
// =============================================================================
//
// The wrapper's accumulator context exposes the queue manipulation
// methods (`dropEntity`, `dropField`, `dropFields`) plus dirty
// checks. These components are thin wrappers that:
//   - hide themselves when there's nothing to drop;
//   - call the context method on click;
//   - invoke an editor-supplied `onDropped` callback so the editor
//     can revert its in-memory state in lockstep.
//
// Each component is opt-in: an editor inside the wrapper renders
// them where appropriate (top of editor for entity, top of each tab
// for section, next to each input for field). Editors mounted on
// the admin `/compendium/*` routes won't render these at all —
// they live outside any wrapper, and `useProposalContextOptional`
// returns null there.
// =============================================================================

import { useCallback, useState } from 'react';
import { Undo2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { useProposalContext } from '../../lib/proposalAccumulator';
import { Button } from '../ui/button';
import { ConfirmDialog } from '../ui/confirm-dialog';

/* -------------------------------------------------------------------------- */
/* Entity-level: "Drop all edits to <name>"                                    */
/* -------------------------------------------------------------------------- */

export type DropEntityButtonProps = {
  entityId: string;
  /** Pretty label for the confirmation prompt. */
  entityLabel?: string;
  /**
   * Editor's reset callback. Called AFTER the context drops the queue
   * + server-side drafts; the editor uses it to revert its local
   * in-memory state for this entity.
   */
  onDropped?: () => void;
  /** Skip the confirm() prompt. Off by default — entity drops can
   *  delete already-submitted drafts. */
  skipConfirm?: boolean;
  className?: string;
};

export function DropEntityButton({
  entityId,
  entityLabel,
  onDropped,
  skipConfirm = false,
  className,
}: DropEntityButtonProps) {
  const ctx = useProposalContext();
  const [working, setWorking] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const performDrop = useCallback(async () => {
    setWorking(true);
    try {
      await ctx.dropEntity(entityId);
      onDropped?.();
      toast.success(
        entityLabel ? `Dropped edits to "${entityLabel}".` : 'Edits dropped.',
      );
    } catch (err: any) {
      toast.error(err?.message || 'Failed to drop edits.');
      throw err; // keep the ConfirmDialog open on failure
    } finally {
      setWorking(false);
    }
  }, [ctx, entityId, entityLabel, onDropped]);

  const handleClick = useCallback(() => {
    if (skipConfirm) {
      void performDrop();
      return;
    }
    setConfirmOpen(true);
  }, [skipConfirm, performDrop]);

  return (
    <>
      <Button
        variant="outline"
        type="button"
        onClick={handleClick}
        disabled={working}
        className={`gap-1.5 border-blood/30 text-blood hover:bg-blood/10 ${className ?? ''}`}
      >
        <RotateCcw className="w-3.5 h-3.5" />
        {working ? 'Dropping…' : 'Drop edits'}
      </Button>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Drop all edits to ${entityLabel ? `"${entityLabel}"` : 'this entry'}?`}
        description="This removes any queued changes and any drafts already in the block. The live row is unchanged."
        confirmLabel="Drop edits"
        destructive
        onConfirm={performDrop}
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Section-level: "Drop section edits"                                         */
/* -------------------------------------------------------------------------- */

export type DropSectionButtonProps = {
  entityId: string;
  /** The fields that belong to this section. The button drops these
   *  from the queue entry's payload. */
  sectionFields: string[];
  /** Pretty label for the button + confirmation text. */
  sectionLabel?: string;
  /** Editor's reset callback for this section's fields. */
  onDropped?: () => void;
  /** Skip the confirm() prompt. Default true — section drops are
   *  local-only and easy to redo. */
  skipConfirm?: boolean;
  className?: string;
};

export function DropSectionButton({
  entityId,
  sectionFields,
  sectionLabel,
  onDropped,
  skipConfirm = true,
  className,
}: DropSectionButtonProps) {
  const ctx = useProposalContext();
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Visible only if at least one field in the section is dirty.
  const hasDirty = sectionFields.some((f) => ctx.isFieldDirty(entityId, f));
  if (!hasDirty) return null;

  const performDrop = () => {
    ctx.dropFields(entityId, sectionFields);
    onDropped?.();
  };

  const handleClick = () => {
    if (skipConfirm) {
      performDrop();
      return;
    }
    setConfirmOpen(true);
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        type="button"
        onClick={handleClick}
        className={`gap-1 text-xs text-blood/80 hover:text-blood hover:bg-blood/10 ${className ?? ''}`}
      >
        <Undo2 className="w-3 h-3" />
        Drop section
      </Button>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Drop your edits to ${sectionLabel ? `"${sectionLabel}"` : 'this section'}?`}
        confirmLabel="Drop section"
        destructive
        onConfirm={performDrop}
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Field-level: a small undo icon next to a modified field.                    */
/* -------------------------------------------------------------------------- */

export type DropFieldIconProps = {
  entityId: string;
  fieldName: string;
  /** Editor's reset callback for the single field. */
  onDropped?: () => void;
  title?: string;
  className?: string;
};

export function DropFieldIcon({
  entityId,
  fieldName,
  onDropped,
  title,
  className,
}: DropFieldIconProps) {
  const ctx = useProposalContext();
  if (!ctx.isFieldDirty(entityId, fieldName)) return null;

  return (
    <button
      type="button"
      onClick={() => {
        ctx.dropField(entityId, fieldName);
        onDropped?.();
      }}
      title={title ?? 'Drop edit to this field'}
      aria-label={title ?? 'Drop edit to this field'}
      className={`inline-flex items-center justify-center p-1 rounded hover:bg-blood/10 text-blood/70 hover:text-blood transition-colors ${className ?? ''}`}
    >
      <Undo2 className="w-3 h-3" />
    </button>
  );
}

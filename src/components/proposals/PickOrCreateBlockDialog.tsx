// =============================================================================
// PickOrCreateBlockDialog — choose an existing open block, or create one.
// =============================================================================
//
// Opened by <ProposalEditorWrapper> when the user clicks "Submit
// Changes" with no active block. Two paths:
//
//   1. Pick an existing open block from the list → onPick(id).
//   2. Click "+ Create new block" → swaps to the BlockMetadataDialog
//      (reused from Phase 4.1) → on save, onCreate(name, desc) →
//      caller resolves the new bundle id and continues the submit.
//
// The dialog itself owns no Block-context state; the caller wires
// onPick / onCreate.
// =============================================================================

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Plus, Package } from 'lucide-react';
import type { ProposalBundle } from '../../lib/proposalBlock';
import { BlockMetadataDialog } from './BlockMetadataDialog';

export type PickOrCreateBlockDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  openBlocks: ProposalBundle[];
  /** Called when the user picks an existing open block. */
  onPick: (bundleId: string) => Promise<void> | void;
  /**
   * Called when the user creates a new block via the embedded form.
   * Should POST to /api/proposals/bundle and resolve to the new id;
   * the caller then sets it active + resumes the submit flow.
   */
  onCreate: (name: string, description: string | null) => Promise<void>;
  /** Optional title override. Default suits the Submit Changes flow. */
  title?: string;
  /** Optional description override. */
  description?: string;
  /**
   * Block-entry gate mode. When true the dialog hides its Cancel
   * button — the caller (ProposalEditorWrapper) is using it to force
   * block selection before authoring, and there's no "cancel" path
   * (dismissing just returns to the gate panel, which re-prompts).
   */
  required?: boolean;
};

export function PickOrCreateBlockDialog({
  open,
  onOpenChange,
  openBlocks,
  onPick,
  onCreate,
  title = 'Pick a block to submit into',
  description = "You haven't opened a block yet. Choose one of your existing open blocks, or create a new one to bundle these changes.",
  required = false,
}: PickOrCreateBlockDialogProps) {
  // The create form lives in BlockMetadataDialog; this dialog opens
  // it when the user clicks "+ Create new block". The two dialogs
  // are sequential rather than nested — we close this one first.
  const [createOpen, setCreateOpen] = useState(false);

  const handlePickClick = async (bundleId: string) => {
    onOpenChange(false);
    await onPick(bundleId);
  };

  const handleCreateRequest = () => {
    onOpenChange(false);
    setCreateOpen(true);
  };

  const handleCreateSubmit = async (name: string, description: string | null) => {
    setCreateOpen(false);
    await onCreate(name, description);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <div className="py-2 max-h-[40vh] overflow-y-auto">
            {openBlocks.length === 0 ? (
              <p className="text-xs text-ink/55 italic text-center py-8">
                You have no open blocks yet.
              </p>
            ) : (
              <ul className="divide-y divide-foreground/10">
                {openBlocks.map((b) => (
                  <li key={b.id}>
                    <button
                      type="button"
                      onClick={() => handlePickClick(b.id)}
                      className="w-full text-left py-3 px-2 hover:bg-foreground/5 rounded-md transition-colors"
                    >
                      <div className="flex items-start gap-3">
                        <Package className="w-4 h-4 text-blood mt-0.5 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold truncate">{b.name}</p>
                          {b.description && (
                            <p className="text-[11px] text-ink/65 mt-0.5 leading-relaxed line-clamp-2">
                              {b.description}
                            </p>
                          )}
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <DialogFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            {required ? (
              <span />
            ) : (
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
            )}
            <Button
              onClick={handleCreateRequest}
              className="gap-2 bg-gold text-[var(--primary-foreground)]"
            >
              <Plus className="w-4 h-4" /> Create new block
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <BlockMetadataDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        mode="create"
        onSubmit={handleCreateSubmit}
      />
    </>
  );
}

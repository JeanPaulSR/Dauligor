// =============================================================================
// ConfirmDialog — styled replacement for window.confirm().
// =============================================================================
//
// Controlled by `open` / `onOpenChange`; the parent component owns
// the show/hide state and the action handler. Pattern:
//
//   const [open, setOpen] = useState(false);
//   ...
//   <Button onClick={() => setOpen(true)}>Delete</Button>
//   <ConfirmDialog
//     open={open}
//     onOpenChange={setOpen}
//     title="Delete this thing?"
//     description="This action cannot be undone."
//     confirmLabel="Delete"
//     destructive
//     onConfirm={async () => { await doDelete(); }}
//   />
//
// `onConfirm` may be sync or async; the dialog handles its own
// "working…" spinner state and closes on success. Errors thrown from
// `onConfirm` keep the dialog open so the caller can show a toast
// (or whatever) without the user losing context.
// =============================================================================

import { useState, type ReactNode } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog';
import { Button } from './button';

export type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  /** Default: "Confirm" */
  confirmLabel?: string;
  /** Default: "Cancel" */
  cancelLabel?: string;
  /** Red confirm button + warning copy semantics. */
  destructive?: boolean;
  /** Called on confirm. May be async; the dialog spinners + closes on
   *  resolve. Rejections keep the dialog open. */
  onConfirm: () => void | Promise<void>;
};

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
}: ConfirmDialogProps) {
  const [working, setWorking] = useState(false);

  const handleConfirm = async () => {
    setWorking(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch {
      // Caller is responsible for surfacing the error (toast etc.).
      // Keep the dialog open so the user can retry or cancel.
    } finally {
      setWorking(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description !== undefined && (
            <DialogDescription>{description}</DialogDescription>
          )}
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={working}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={working}
            className={
              destructive
                ? 'bg-blood text-white hover:bg-blood/90'
                : 'bg-gold text-[var(--primary-foreground)]'
            }
          >
            {working ? 'Working…' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// "Bake Now" button — manual override for the debounced rebake queue.
//
// Most edits land in `module_export_queue` and rebake ~1h after the last
// edit. When an admin needs the change live immediately (e.g. "fix a
// player's import flow"), this button calls /api/module/rebake-now to run
// the export pipeline synchronously and write R2 in front of the wait.
//
// If the editor reports unsaved changes, we prompt before baking — baking
// the saved (older) version while the user has unsaved edits in front of
// them is almost never what they want. They can still bake the saved
// version explicitly via "Bake Anyway".

import { useState } from 'react';
import { Hammer, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { rebakeNow, type ExportEntityKind } from '../../lib/moduleExport';

interface BakeNowButtonProps {
  kind: ExportEntityKind;
  id: string | null | undefined;
  isDirty?: boolean;
  /** Editor's save handler. Called by "Save & Bake". */
  onSaveFirst?: () => Promise<void> | void;
  label?: string;
  size?: 'sm' | 'default' | 'lg' | 'icon';
  className?: string;
}

export function BakeNowButton({
  kind,
  id,
  isDirty = false,
  onSaveFirst,
  label = 'Bake Now',
  size = 'sm',
  className,
}: BakeNowButtonProps) {
  const [busy, setBusy] = useState(false);
  const [showSavePrompt, setShowSavePrompt] = useState(false);

  const runBake = async () => {
    if (!id) {
      toast.error('Save the record first to assign an id.');
      return;
    }
    setBusy(true);
    try {
      const result = await rebakeNow(kind, id);
      if (result.ok) {
        const count = result.written.length;
        toast.success(`Export rebaked — wrote ${count} object${count === 1 ? '' : 's'} to R2.`);
      } else {
        toast.error(`Bake failed: ${result.error ?? 'unknown error'}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const onClick = () => {
    if (isDirty) {
      setShowSavePrompt(true);
      return;
    }
    void runBake();
  };

  const handleSaveAndBake = async () => {
    setShowSavePrompt(false);
    if (onSaveFirst) {
      try {
        await onSaveFirst();
      } catch (error) {
        // The editor's save handler already toasted; bail out so we don't
        // bake an inconsistent version.
        console.warn('[BakeNowButton] save-first handler threw, aborting bake', { error });
        return;
      }
    }
    await runBake();
  };

  const handleBakeAnyway = async () => {
    setShowSavePrompt(false);
    await runBake();
  };

  return (
    <>
      <Button
        type="button"
        onClick={onClick}
        disabled={busy || !id}
        size={size}
        variant="outline"
        className={className}
        title={!id ? 'Save the record first to assign an id.' : 'Run the module export pipeline now.'}
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Hammer className="w-4 h-4" />}
        {label}
      </Button>

      <Dialog open={showSavePrompt} onOpenChange={(open) => !open && setShowSavePrompt(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Unsaved Changes</DialogTitle>
          </DialogHeader>
          <p className="text-ink/80 text-sm font-sans">
            You have unsaved changes. Would you like to save first and then bake the
            export? The bake uses whatever's in the database, not what's on screen.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowSavePrompt(false)}>
              Cancel
            </Button>
            <Button variant="ghost" onClick={handleBakeAnyway}>
              Bake Anyway
            </Button>
            <Button onClick={handleSaveAndBake} className="btn-gold-solid">
              Save & Bake
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// =============================================================================
// BlockMetadataDialog — name + description form for a Submission Block.
// =============================================================================
//
// Used in two modes:
//   - `create`: opening the dialog with no initial values; on submit,
//     calls the supplied handler (typically `startBlock(name, desc)`)
//     and closes on success.
//   - `rename`: pre-populated with the active block's metadata; on
//     submit, calls the supplied handler (typically
//     `patchActiveBlock({name, description})`) and closes on success.
//
// The dialog itself owns no Block-context state — it's just a form
// shell. Callers wire the actual create / patch call through the
// `onSubmit` prop and handle their own context invalidation.
// =============================================================================

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';

const NAME_MAX = 200;
const DESCRIPTION_MAX = 2000;

export type BlockMetadataDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'rename';
  initialName?: string;
  initialDescription?: string | null;
  onSubmit: (name: string, description: string | null) => Promise<void>;
};

export function BlockMetadataDialog({
  open,
  onOpenChange,
  mode,
  initialName = '',
  initialDescription = null,
  onSubmit,
}: BlockMetadataDialogProps) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState<string>(initialDescription ?? '');
  const [submitting, setSubmitting] = useState(false);

  // Re-sync local state whenever the dialog opens. Without this, a
  // rename-mode dialog re-opened against a different block would
  // keep the previous block's values.
  useEffect(() => {
    if (open) {
      setName(initialName);
      setDescription(initialDescription ?? '');
    }
  }, [open, initialName, initialDescription]);

  const titleCopy =
    mode === 'create' ? 'Start a new block' : 'Rename / re-describe this block';
  const submitCopy = mode === 'create' ? 'Create block' : 'Save changes';
  const descriptionCopy =
    mode === 'create'
      ? 'Edits made while this block is active will be staged together. Name and describe it so future-you (and your reviewer) know what it covers.'
      : 'Update the name or description for the active block. Drafts already staged inside it stay in place.';

  const trimmedName = name.trim();
  const canSubmit =
    !submitting && trimmedName.length > 0 && trimmedName.length <= NAME_MAX;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onSubmit(trimmedName, description.trim() === '' ? null : description);
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to save block metadata.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{titleCopy}</DialogTitle>
            <DialogDescription>{descriptionCopy}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="block-name">
                Name <span className="text-blood">*</span>
              </Label>
              <Input
                id="block-name"
                value={name}
                onChange={(e) => setName(e.target.value.slice(0, NAME_MAX))}
                placeholder="e.g. Spring spell taxonomy pass"
                maxLength={NAME_MAX}
                autoFocus
              />
              <p className="text-[11px] text-ink/40">
                {trimmedName.length}/{NAME_MAX}
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="block-description">Description (optional)</Label>
              <Textarea
                id="block-description"
                value={description}
                onChange={(e) =>
                  setDescription(e.target.value.slice(0, DESCRIPTION_MAX))
                }
                placeholder="What changes does this block cover? Why?"
                maxLength={DESCRIPTION_MAX}
                rows={4}
              />
              <p className="text-[11px] text-ink/40">
                {description.length}/{DESCRIPTION_MAX}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit} className="bg-gold text-white">
              {submitting ? 'Saving…' : submitCopy}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

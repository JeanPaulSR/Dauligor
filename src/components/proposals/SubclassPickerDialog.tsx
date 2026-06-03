// =============================================================================
// SubclassPickerDialog — pick-a-class-and-(optionally)-a-subclass flow used
// by the proposal launcher's "Subclasses" entries.
// =============================================================================
//
// Subclasses are nested under classes in the data model (subclasses.class_id)
// and the editor expects a `?classId=` query param when creating, plus an
// `:id` route param when editing. From the launcher we don't have either
// yet, so this dialog asks the user up front:
//
//   Create mode: pick a class → navigate to /proposals/edit/subclasses/new
//                ?classId=<class>
//
//   Edit mode:   pick a class → pick one of that class's subclasses →
//                navigate to /proposals/edit/subclasses/edit/<subclass>
//
// Both modes show the picked-block context badge at the top — the dialog
// runs AFTER the LauncherGrid's block-picker gate, so by the time it
// opens the user already has an active block bound.
// =============================================================================

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Search, X, ChevronRight, Swords } from 'lucide-react';
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
import { fetchCollection } from '../../lib/d1';

type ClassRow = { id: string; name: string };
type SubclassRow = { id: string; name: string; class_id: string };

export function SubclassPickerDialog({
  open,
  onOpenChange,
  mode,
  onPicked,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * 'create' picks a class then resolves with a /new href.
   * 'edit'   picks a class then a subclass then resolves with an /edit href.
   */
  mode: 'create' | 'edit';
  /** Called with the final navigation href after the user finishes picking. */
  onPicked: (href: string) => void;
}) {
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [subclasses, setSubclasses] = useState<SubclassRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [step, setStep] = useState<'class' | 'subclass'>('class');
  const [pickedClassId, setPickedClassId] = useState<string | null>(null);

  // Reset when the dialog opens — picker is stateful between sessions
  // otherwise (a partial pick from last time would survive).
  useEffect(() => {
    if (!open) return;
    setStep('class');
    setPickedClassId(null);
    setSearch('');
  }, [open, mode]);

  // Lazy-load classes the first time the dialog opens. Cached for the
  // session — small enough table that a refetch every open is fine but
  // not worth the latency on rapid reopens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    fetchCollection<any>('classes', { orderBy: 'name ASC', select: 'id, name' })
      .then((rows) => {
        if (cancelled) return;
        setClasses(rows.map((r) => ({ id: String(r.id), name: String(r.name) })));
      })
      .catch((err) => {
        console.error('[SubclassPickerDialog] failed to load classes:', err);
        toast.error('Could not load classes — please retry.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Edit mode step 2: load the picked class's subclasses.
  useEffect(() => {
    if (!open || mode !== 'edit' || step !== 'subclass' || !pickedClassId) return;
    let cancelled = false;
    setLoading(true);
    fetchCollection<any>('subclasses', {
      where: 'class_id = ?',
      params: [pickedClassId],
      orderBy: 'name ASC',
      select: 'id, name, class_id',
    })
      .then((rows) => {
        if (cancelled) return;
        setSubclasses(
          rows.map((r) => ({
            id: String(r.id),
            name: String(r.name),
            class_id: String(r.class_id),
          })),
        );
      })
      .catch((err) => {
        console.error('[SubclassPickerDialog] failed to load subclasses:', err);
        toast.error('Could not load subclasses — please retry.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, mode, step, pickedClassId]);

  const lowered = search.trim().toLowerCase();
  const visibleClasses = useMemo(
    () =>
      lowered
        ? classes.filter((c) => c.name.toLowerCase().includes(lowered))
        : classes,
    [classes, lowered],
  );
  const visibleSubclasses = useMemo(
    () =>
      lowered
        ? subclasses.filter((s) => s.name.toLowerCase().includes(lowered))
        : subclasses,
    [subclasses, lowered],
  );

  const pickedClass = pickedClassId
    ? classes.find((c) => c.id === pickedClassId)
    : null;

  const handlePickClass = (classId: string) => {
    if (mode === 'create') {
      // No subclass-id step — go straight to the new-subclass editor
      // with the chosen class pre-bound via the ?classId= param.
      onPicked(`/proposals/edit/subclasses/new?classId=${encodeURIComponent(classId)}`);
      onOpenChange(false);
      return;
    }
    setPickedClassId(classId);
    setStep('subclass');
    setSearch('');
  };

  const handlePickSubclass = (subclassId: string) => {
    onPicked(`/proposals/edit/subclasses/edit/${encodeURIComponent(subclassId)}`);
    onOpenChange(false);
  };

  const headerCopy =
    mode === 'create'
      ? 'Create a new Subclass'
      : step === 'class'
        ? 'Edit a Subclass'
        : `Edit a Subclass · ${pickedClass?.name ?? ''}`;
  const descriptionCopy =
    mode === 'create'
      ? 'Pick the parent class first — subclasses live under their class in the catalog. You can change parent later from the subclass editor.'
      : step === 'class'
        ? 'Pick the parent class to see its subclasses.'
        : 'Pick the subclass you want to edit.';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{headerCopy}</DialogTitle>
          <DialogDescription>{descriptionCopy}</DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink/45" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={step === 'class' ? 'Filter classes…' : 'Filter subclasses…'}
            className="h-9 pl-8 pr-7 text-sm"
            autoFocus
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-ink/45 hover:text-ink"
              title="Clear filter"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        <div className="max-h-[50vh] overflow-y-auto custom-scrollbar -mx-2 px-2">
          {loading ? (
            <p className="text-center py-8 text-sm text-ink/45 italic">Loading…</p>
          ) : step === 'class' ? (
            visibleClasses.length === 0 ? (
              <p className="text-center py-8 text-sm text-ink/45 italic">No classes match.</p>
            ) : (
              <ul className="divide-y divide-gold/5">
                {visibleClasses.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => handlePickClass(c.id)}
                      className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-gold/5 transition-colors"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Swords className="w-3.5 h-3.5 text-gold shrink-0" />
                        <span className="text-sm font-medium text-ink truncate">
                          {c.name}
                        </span>
                      </div>
                      <ChevronRight className="w-4 h-4 text-ink/35 shrink-0" />
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : visibleSubclasses.length === 0 ? (
            <div className="text-center py-8 space-y-2">
              <p className="text-sm text-ink/45 italic">
                {subclasses.length === 0
                  ? 'No subclasses exist for this class yet.'
                  : 'No subclasses match.'}
              </p>
              {subclasses.length === 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    onPicked(`/proposals/edit/subclasses/new?classId=${encodeURIComponent(pickedClassId!)}`)
                  }
                >
                  Create one instead
                </Button>
              )}
            </div>
          ) : (
            <ul className="divide-y divide-gold/5">
              {visibleSubclasses.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => handlePickSubclass(s.id)}
                    className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-gold/5 transition-colors"
                  >
                    <span className="text-sm font-medium text-ink truncate">{s.name}</span>
                    <ChevronRight className="w-4 h-4 text-ink/35 shrink-0" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter className="gap-2">
          {step === 'subclass' && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setStep('class');
                setSearch('');
              }}
            >
              Back to classes
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

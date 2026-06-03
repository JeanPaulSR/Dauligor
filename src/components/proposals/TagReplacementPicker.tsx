// =============================================================================
// TagReplacementPicker — picks a tag to substitute for a cascade-
// deleted tag inside a dependent entity (spell / feat / class / etc).
// =============================================================================
//
// Used by the "Handle this dependent" Replace flow (Phase 3). When a
// tag is being deleted in the active block, every entity that
// references that tag gets a cascade-enrolled UPDATE that strips the
// id. The proposer can either:
//   - Accept the strip (default, no UI needed)
//   - Replace the deleted tag with another tag via this picker
//
// We filter to tags in the SAME tag_group as the deleted tag by
// default (most replacements are intra-group, per the existing
// tag-merge flow's behavior). A "show all groups" toggle escapes
// that constraint for the rare cross-group case.
//
// The picker is entity-type-specific to the DELETED parent, not to
// the dependent — when Phase 2 adds more strategies (unique_option_
// group, etc.) each gets its own picker. Tags are the only strategy
// shipped today.
// =============================================================================

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Search, X, ChevronRight } from 'lucide-react';
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
import { Checkbox } from '../ui/checkbox';
import { fetchCollection } from '../../lib/d1';
import { normalizeTagRow } from '../../lib/tagHierarchy';

type TagRow = { id: string; name: string; groupId: string | null };

export function TagReplacementPicker({
  open,
  onOpenChange,
  /** Id of the tag being deleted. Used to filter the picker to its
   *  group by default and to hide it from the candidate list. */
  deletedTagId,
  /** Optional name of the deleted tag for the dialog header. */
  deletedTagName,
  /** Called with the picked replacement tag id. The caller's hook
   *  (useCascadeDependent.replace) handles the PATCH; this dialog
   *  just resolves the choice and closes. */
  onPicked,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deletedTagId: string;
  deletedTagName?: string | null;
  onPicked: (replacementTagId: string) => void;
}) {
  const [allTags, setAllTags] = useState<TagRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [crossGroup, setCrossGroup] = useState(false);
  const [deletedGroupId, setDeletedGroupId] = useState<string | null>(null);

  // Reset state every time the dialog re-opens.
  useEffect(() => {
    if (!open) return;
    setSearch('');
    setCrossGroup(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    fetchCollection<any>('tags', { orderBy: 'name ASC' })
      .then((rows) => {
        if (cancelled) return;
        const normalized = rows.map((r) => normalizeTagRow(r));
        setAllTags(normalized);
        // Capture the deleted tag's groupId so the same-group filter
        // can default-on. If the deleted tag is in NO tags table
        // anymore (uncommon — caller may pass a tag that's only a
        // queued create), default to cross-group.
        const deleted = normalized.find((t) => t.id === deletedTagId);
        setDeletedGroupId(deleted?.groupId ?? null);
      })
      .catch((err) => {
        console.error('[TagReplacementPicker] failed to load tags:', err);
        toast.error('Could not load tags — please retry.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, deletedTagId]);

  const lowered = search.trim().toLowerCase();
  const visibleTags = useMemo(() => {
    return allTags.filter((t) => {
      if (t.id === deletedTagId) return false;
      if (!crossGroup && deletedGroupId && t.groupId !== deletedGroupId) return false;
      if (!lowered) return true;
      return t.name.toLowerCase().includes(lowered);
    });
  }, [allTags, deletedTagId, crossGroup, deletedGroupId, lowered]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Replace with another tag</DialogTitle>
          <DialogDescription>
            {deletedTagName ? (
              <>
                Pick a tag to substitute for{' '}
                <span className="font-semibold text-ink">{deletedTagName}</span>{' '}
                in this entity. The deleted tag will be replaced; everything
                else in the entity stays as-is.
              </>
            ) : (
              <>
                Pick a tag to substitute for the deleted one. Default is to
                strip the reference — Replace lets you keep a tag in place.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink/45" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter tags…"
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
          {deletedGroupId && (
            <label className="flex items-center gap-2 text-[11px] text-ink/65 cursor-pointer">
              <Checkbox
                checked={crossGroup}
                onCheckedChange={(v) => setCrossGroup(!!v)}
              />
              Show tags from all groups (default: same group only)
            </label>
          )}
        </div>

        <div className="max-h-[40vh] overflow-y-auto custom-scrollbar -mx-2 px-2">
          {loading ? (
            <p className="text-center py-8 text-sm text-ink/45 italic">Loading…</p>
          ) : visibleTags.length === 0 ? (
            <p className="text-center py-8 text-sm text-ink/45 italic">
              {lowered ? 'No tags match.' : 'No replacement candidates available.'}
            </p>
          ) : (
            <ul className="divide-y divide-gold/5">
              {visibleTags.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onPicked(t.id);
                      onOpenChange(false);
                    }}
                    className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-gold/5 transition-colors"
                  >
                    <span className="text-sm text-ink truncate">{t.name}</span>
                    <ChevronRight className="w-4 h-4 text-ink/35 shrink-0" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

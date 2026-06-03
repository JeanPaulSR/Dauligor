/**
 * /compendium/tags/classifications — TAG CLASSIFICATIONS MANAGER
 *
 * Discovery + management surface for the "classification slots"
 * that tell standard editors (Class, Spell, Feat, …) which tag
 * groups apply to which entities.
 *
 * Two kinds:
 *   • SYSTEM — hardcoded in TagsExplorer (see `SYSTEM_CLASSIFICATIONS`
 *     at the top of that file). Read-only here; the help text per
 *     slot tells authors where each one surfaces in the app.
 *   • CUSTOM — any string in a tag_group's `classifications` array
 *     that ISN'T a system slot. Phase 1 stores them inline on the
 *     groups themselves; this page surfaces the unique universe by
 *     scanning all groups, computes usage count per slot, and lets
 *     admins rename / delete across every group in a single move.
 *     (Phase 2 will lift custom classifications into their own
 *     table; this page becomes its CRUD shell.)
 *
 * Scope decisions for Phase 1:
 *   - No "+ Add new" affordance here. Adding still happens via
 *     the group editor's "Show legacy add" disclosure — once a
 *     custom slot appears on any group, this page lists it
 *     globally and offers rename/delete.
 *   - Rename is a multi-group write: every group whose
 *     classifications array contains the old string gets updated.
 *     Same for delete (clears from every group using it).
 *   - Admin-only.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ChevronLeft,
  Settings2,
  Pencil,
  Trash2,
  Check,
  X,
  Layers,
} from 'lucide-react';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { fetchCollection, upsertDocument } from '../../lib/d1';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';

// Mirrors the SYSTEM_CLASSIFICATIONS constant + help map in
// TagsExplorer.tsx. Kept in lockstep manually for Phase 1; when
// Phase 2 lifts classifications into a real table we can drop both
// copies in favor of seeded rows.
const SYSTEM_SLOTS: { id: string; help: string }[] = [
  { id: 'class', help: 'Class & subclass editors' },
  { id: 'subclass', help: 'Subclass tag pickers' },
  { id: 'race', help: 'Character creation race step' },
  { id: 'subrace', help: 'Race detail editor' },
  { id: 'feat', help: 'Feats editor + browser filter' },
  { id: 'background', help: 'Backgrounds editor + browser filter' },
  { id: 'skill', help: 'Skill editor' },
  { id: 'tool', help: 'Tool editor' },
  { id: 'spell', help: 'Spell editor + browser filter' },
  { id: 'item', help: 'Items editor' },
  { id: 'lore', help: 'Lore article tag picker' },
];
const SYSTEM_IDS = new Set(SYSTEM_SLOTS.map((s) => s.id));

interface GroupRow {
  id: string;
  name: string;
  classifications?: string[];
  category?: string;
}

interface CustomSlot {
  name: string;
  groups: { id: string; name: string }[];
}

export default function TagClassifications({
  userProfile,
}: {
  userProfile: any;
}) {
  const [groups, setGroups] = useState<GroupRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState('');
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isAdmin = userProfile?.role === 'admin';

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      // Pull every group's classifications. Lightweight read — we
      // only need id/name/classifications/category here. (`category`
      // is the legacy single-string column kept for backwards
      // compatibility; treat it like a one-element classifications
      // array when the new column is empty.)
      const rows = await fetchCollection<GroupRow>('tagGroups', {
        select: 'id, name, classifications, category',
      });
      setGroups(rows);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Failed to load groups');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isAdmin) return;
    reload();
  }, [isAdmin]);

  // Compute the global universe of custom slots from the loaded
  // groups. Lower-cased for de-dup so "Homebrew" / "homebrew" are
  // treated as the same slot (they would collide on case anyway in
  // the group editor's current normalize step).
  const customSlots = useMemo<CustomSlot[]>(() => {
    if (!groups) return [];
    const byName = new Map<string, CustomSlot>();
    for (const g of groups) {
      const arr =
        g.classifications && g.classifications.length > 0
          ? g.classifications
          : g.category
            ? [g.category]
            : [];
      for (const raw of arr) {
        const trimmed = String(raw ?? '').trim();
        if (!trimmed) continue;
        if (SYSTEM_IDS.has(trimmed)) continue;
        const key = trimmed.toLowerCase();
        const existing = byName.get(key);
        if (existing) {
          existing.groups.push({ id: g.id, name: g.name });
        } else {
          byName.set(key, {
            name: trimmed,
            groups: [{ id: g.id, name: g.name }],
          });
        }
      }
    }
    return Array.from(byName.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }, [groups]);

  const handleRename = async (oldName: string) => {
    const trimmed = editingDraft.trim();
    if (!trimmed) {
      toast.error('Name cannot be empty');
      return;
    }
    if (trimmed === oldName) {
      setEditingName(null);
      return;
    }
    if (SYSTEM_IDS.has(trimmed.toLowerCase())) {
      toast.error(
        `"${trimmed}" is a system slot. Pick a different custom name.`,
      );
      return;
    }
    setBusy(true);
    try {
      const affected = (groups ?? []).filter((g) =>
        ((g.classifications && g.classifications.length > 0
          ? g.classifications
          : g.category
            ? [g.category]
            : []) as string[]).some(
          (c) => String(c).trim().toLowerCase() === oldName.toLowerCase(),
        ),
      );
      // Rewrite each affected group's classifications array,
      // replacing the old string with the new one. We write the
      // canonical `classifications` column going forward; the
      // legacy `category` column is left untouched so backwards-
      // compat data stays intact.
      for (const g of affected) {
        const arr =
          g.classifications && g.classifications.length > 0
            ? g.classifications
            : g.category
              ? [g.category]
              : [];
        const next = arr.map((c) =>
          String(c).trim().toLowerCase() === oldName.toLowerCase()
            ? trimmed
            : c,
        );
        // Dedupe — if the target name already existed alongside,
        // collapse to a single entry.
        const deduped = Array.from(new Set(next.map((s) => String(s).trim()).filter(Boolean)));
        await upsertDocument('tagGroups', g.id, {
          classifications: deduped,
          updated_at: new Date().toISOString(),
        });
      }
      setEditingName(null);
      setEditingDraft('');
      await reload();
      toast.success(
        `Renamed "${oldName}" → "${trimmed}" across ${affected.length} group${affected.length === 1 ? '' : 's'}`,
      );
    } catch (err) {
      console.error(err);
      toast.error('Failed to rename classification');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (name: string) => {
    setBusy(true);
    try {
      const affected = (groups ?? []).filter((g) =>
        ((g.classifications && g.classifications.length > 0
          ? g.classifications
          : g.category
            ? [g.category]
            : []) as string[]).some(
          (c) => String(c).trim().toLowerCase() === name.toLowerCase(),
        ),
      );
      for (const g of affected) {
        const arr =
          g.classifications && g.classifications.length > 0
            ? g.classifications
            : g.category
              ? [g.category]
              : [];
        const next = arr.filter(
          (c) => String(c).trim().toLowerCase() !== name.toLowerCase(),
        );
        await upsertDocument('tagGroups', g.id, {
          classifications: next,
          updated_at: new Date().toISOString(),
        });
      }
      setPendingDelete(null);
      await reload();
      toast.success(
        `Removed "${name}" from ${affected.length} group${affected.length === 1 ? '' : 's'}`,
      );
    } catch (err) {
      console.error(err);
      toast.error('Failed to delete classification');
    } finally {
      setBusy(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="text-center py-20 text-ink/55 italic">
        Tag classifications are admin-only.
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <header className="space-y-2">
        <div className="flex items-center gap-2 text-gold/65">
          <Link
            to="/compendium/tags"
            className="inline-flex items-center gap-1 text-xs hover:text-gold underline-offset-2 hover:underline"
          >
            <ChevronLeft className="w-3 h-3" />
            Back to TagsExplorer
          </Link>
        </div>
        <div className="flex items-center gap-3 text-gold">
          <Settings2 className="w-5 h-5" />
          <span className="text-xs font-bold uppercase tracking-[0.3em]">
            Compendium · Tag Settings
          </span>
        </div>
        <h1 className="text-3xl font-serif font-bold text-ink tracking-tight uppercase">
          Manage Tag Classifications
        </h1>
        <p className="text-ink/65 font-serif italic max-w-3xl">
          Classifications are the slots that tell standard editors which
          tag groups apply to which entities. System slots ship with the
          app and can't be changed here. Custom slots are project-specific
          and computed from the current set of tag groups.
        </p>
      </header>

      {/* System slots — read-only reference */}
      <Card className="border-gold/25 bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-gold/15 bg-gold/5">
          <h2 className="label-text text-gold">System Slots</h2>
          <p className="text-[11px] text-ink/55 mt-0.5">
            Hardcoded. Each slot surfaces this group on the listed editor /
            browser. Cannot be renamed or deleted.
          </p>
        </div>
        <ul className="divide-y divide-gold/15">
          {SYSTEM_SLOTS.map((slot) => (
            <li key={slot.id} className="flex items-center justify-between gap-3 px-4 py-2">
              <div className="min-w-0 flex items-center gap-3">
                <Layers className="w-3.5 h-3.5 text-gold/45 shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-bold text-ink uppercase tracking-widest">
                    {slot.id}
                  </div>
                  <div className="text-[11px] text-ink/55 truncate">
                    {slot.help}
                  </div>
                </div>
              </div>
              <span className="text-[10px] uppercase tracking-widest text-ink/35 italic shrink-0">
                System
              </span>
            </li>
          ))}
        </ul>
      </Card>

      {/* Custom slots — CRUD'd here, rename / delete propagate across
          every group that uses the slot. */}
      <Card className="border-gold/25 bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-gold/15 bg-gold/5">
          <h2 className="label-text text-gold">Custom Slots</h2>
          <p className="text-[11px] text-ink/55 mt-0.5">
            Computed from every tag group's <code className="text-gold/75">classifications</code>{' '}
            array. To <em>add</em> a custom slot, use the group editor's{' '}
            <code className="text-gold/75">Show legacy add</code> disclosure
            on any group's settings panel. Rename and delete propagate to
            every group using the slot.
          </p>
        </div>
        {loading ? (
          <p className="text-[11px] italic text-ink/45 text-center py-6">
            Loading…
          </p>
        ) : error ? (
          <p className="text-sm text-blood/80 italic text-center py-6">
            {error}
          </p>
        ) : customSlots.length === 0 ? (
          <p className="text-sm text-ink/45 italic text-center py-6">
            No custom classifications yet — add one via the group editor.
          </p>
        ) : (
          <ul className="divide-y divide-gold/15">
            {customSlots.map((slot) => {
              const isEditing = editingName === slot.name;
              return (
                <li
                  key={slot.name}
                  className="flex items-center justify-between gap-3 px-4 py-2"
                >
                  <div className="min-w-0 flex-1">
                    {isEditing ? (
                      <div className="flex items-center gap-2">
                        <Input
                          autoFocus
                          value={editingDraft}
                          onChange={(e) => setEditingDraft(e.target.value)}
                          className="h-7 text-sm field-input"
                          disabled={busy}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleRename(slot.name);
                            if (e.key === 'Escape') {
                              setEditingName(null);
                              setEditingDraft('');
                            }
                          }}
                        />
                        <Button
                          size="sm"
                          onClick={() => handleRename(slot.name)}
                          disabled={busy}
                          className="h-7 w-7 p-0 btn-gold-solid shrink-0"
                          title="Save"
                        >
                          <Check className="w-4 h-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditingName(null);
                            setEditingDraft('');
                          }}
                          disabled={busy}
                          className="h-7 w-7 p-0 text-ink/45 shrink-0"
                          title="Cancel"
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    ) : (
                      <>
                        <div className="text-sm font-bold text-ink uppercase tracking-widest">
                          {slot.name}
                        </div>
                        <div className="text-[11px] text-ink/55 truncate">
                          Used by {slot.groups.length} group
                          {slot.groups.length === 1 ? '' : 's'}:{' '}
                          {slot.groups
                            .slice(0, 4)
                            .map((g) => g.name)
                            .join(', ')}
                          {slot.groups.length > 4 &&
                            ` + ${slot.groups.length - 4} more`}
                        </div>
                      </>
                    )}
                  </div>
                  {!isEditing && (
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditingName(slot.name);
                          setEditingDraft(slot.name);
                        }}
                        className="h-7 text-[10px] gap-1 text-gold/75 hover:text-gold"
                      >
                        <Pencil className="w-3 h-3" /> Rename
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setPendingDelete(slot.name)}
                        className="h-7 w-7 p-0 btn-danger"
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(next) => {
          if (!next) setPendingDelete(null);
        }}
        title="Delete this custom classification?"
        description={
          pendingDelete ? (
            <>
              You're about to remove{' '}
              <strong className="text-ink">{pendingDelete}</strong> from every
              group using it. This won't delete any tags or groups — only
              the classification slot itself.
            </>
          ) : (
            'This action cannot be undone.'
          )
        }
        confirmLabel="Delete"
        destructive
        onConfirm={() => pendingDelete && handleDelete(pendingDelete)}
      />
    </div>
  );
}

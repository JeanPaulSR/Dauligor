import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Dna, Edit, Plus, Trash2 } from 'lucide-react';
import { fetchCollection, upsertDocument, deleteDocument } from '../../lib/d1';
import { reportClientError, OperationType } from '../../lib/firebase';
import { Button } from '../ui/button';

/**
 * Species "Subspecies" tab — lists and creates the child species owned by a
 * parent species (Elf → High Elf / Wood Elf / Drow). See
 * docs/_drafts/subspecies-design-2026-06-03.html.
 *
 * A subspecies IS a full `species` row (migration 20260603-1800 adds the
 * self-referential `parentSpeciesId`). Unlike background features (a lean
 * inline feat), a subspecies needs the ENTIRE species editor — so this tab
 * does NOT host an inline editor. Instead it:
 *   - lists the parent's children (parentSpeciesId = <parent>),
 *   - "New Subspecies" writes a child row pre-filled from the parent's traits
 *     (movement / senses / creatureType / advancements / speciesOptionIds /
 *     tags / source), then hands off to the same editor via `onEditChild`,
 *   - "Edit" / row-click also hand off via `onEditChild`,
 *   - "Delete" removes the child row.
 *
 * On export each subspecies is a stand-alone Foundry `race` item (it reuses
 * `_raceExport.ts` and the /api/module/races/<id>.json route unchanged) — the
 * parent link is for authoring/grouping only.
 */

type SpeciesRow = {
  id: string;
  name?: string;
  identifier?: string;
  imageUrl?: string;
  parentSpeciesId?: string | null;
  [k: string]: any;
};

export default function SubspeciesTab({
  parentSpeciesId,
  parentForm,
  onEditChild,
  onChanged,
}: {
  /** The open parent species' id (null until it's saved). */
  parentSpeciesId: string | null;
  /** The parent's current form state — used to pre-fill a new child. */
  parentForm: Record<string, any>;
  /** Switch the editor to edit the given child species id. */
  onEditChild: (id: string) => void;
  /** Notify the parent editor that the child set changed (refresh its list). */
  onChanged?: () => void;
}) {
  const [children, setChildren] = useState<SpeciesRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = async () => {
    if (!parentSpeciesId) { setChildren([]); return; }
    setLoading(true);
    try {
      const rows = await fetchCollection<SpeciesRow>('species', {
        where: 'parentSpeciesId = ?',
        params: [parentSpeciesId],
        orderBy: 'name ASC',
      });
      setChildren(rows);
    } catch (err) {
      console.error('[SubspeciesTab] load failed:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [parentSpeciesId]);

  if (!parentSpeciesId) {
    return (
      <div className="pt-4 border-t border-gold/10">
        <div className="p-4 border border-gold/10 bg-card/30 rounded-xl">
          <p className="text-[11px] text-ink/50 italic leading-relaxed">
            Save this species first to add subspecies — a subspecies attaches to a stable parent id.
          </p>
        </div>
      </div>
    );
  }

  const createChild = async () => {
    setCreating(true);
    try {
      const childId = crypto.randomUUID();
      // Pre-fill the child's traits from the parent (a one-time copy at create,
      // not a live link). Export is stand-alone, so the child needs the full
      // trait set — pre-fill saves re-entry. Name/description start fresh.
      const payload = {
        name: 'New Subspecies',
        identifier: `subspecies-${childId.slice(0, 8)}`,
        sourceId: parentForm.sourceId || null,
        page: (parentForm.page || '').trim() || null,
        imageUrl: parentForm.imageUrl || null,
        description: '',
        advancements: Array.isArray(parentForm.advancements) ? parentForm.advancements : [],
        movement: parentForm.movement,
        senses: parentForm.senses,
        creatureType: parentForm.creatureType,
        speciesOptionIds: Array.isArray(parentForm.speciesOptionIds) ? parentForm.speciesOptionIds : [],
        tags: Array.isArray(parentForm.tagIds) ? parentForm.tagIds : [],
        parentSpeciesId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await upsertDocument('species', childId, payload);
      toast.success('Subspecies created — pre-filled from parent');
      onChanged?.();
      onEditChild(childId);
    } catch (error) {
      console.error('[SubspeciesTab] create failed:', error);
      toast.error('Failed to create subspecies');
      reportClientError(error, OperationType.CREATE, 'species/(new subspecies)');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this subspecies? This removes the child species entirely.')) return;
    try {
      await deleteDocument('species', id);
      toast.success('Subspecies deleted');
      await load();
      onChanged?.();
    } catch (error) {
      console.error('[SubspeciesTab] delete failed:', error);
      toast.error('Failed to delete subspecies');
      reportClientError(error, OperationType.DELETE, `species/${id}`);
    }
  };

  return (
    <div className="space-y-4 pt-4 border-t border-gold/10">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-gold">Subspecies</h3>
          <p className="text-[10px] text-ink/40 italic">
            Child species of this one (e.g. High Elf, Wood Elf). Each is a full species — created pre-filled from this parent, then edited on its own.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={() => void createChild()}
          disabled={creating}
          className="h-7 gap-1 border border-gold/20 text-gold bg-gold/5 hover:bg-gold/10 shrink-0"
        >
          <Plus className="w-3 h-3" /> {creating ? 'Creating…' : 'New Subspecies'}
        </Button>
      </div>

      {loading ? (
        <p className="text-[11px] text-ink/40 italic">Loading…</p>
      ) : children.length === 0 ? (
        <p className="text-[11px] text-ink/40 italic">No subspecies yet.</p>
      ) : (
        <div className="divide-y divide-gold/10 rounded-lg border border-gold/10 bg-card/30">
          {children.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-3 px-3 py-2 group">
              <button
                type="button"
                onClick={() => onEditChild(c.id)}
                className="flex items-center gap-2 min-w-0 text-left flex-1"
              >
                {c.imageUrl ? (
                  <img src={c.imageUrl} alt="" className="h-6 w-6 rounded border border-gold/20 object-cover shrink-0" />
                ) : (
                  <span className="h-6 w-6 rounded border border-gold/10 bg-background/40 flex items-center justify-center shrink-0">
                    <Dna className="h-3 w-3 text-ink/30" />
                  </span>
                )}
                <span className="text-sm font-semibold text-ink truncate">{c.name || 'Untitled'}</span>
              </button>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                <button
                  type="button"
                  onClick={() => onEditChild(c.id)}
                  className="h-6 w-6 grid place-items-center text-gold hover:bg-gold/10 rounded"
                  title="Edit"
                >
                  <Edit className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete(c.id)}
                  className="h-6 w-6 grid place-items-center text-blood hover:bg-blood/10 rounded"
                  title="Delete"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

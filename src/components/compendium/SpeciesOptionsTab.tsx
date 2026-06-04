import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Check, Dna, Edit, Plus, Trash2, X } from 'lucide-react';
import { fetchCollection, upsertDocument, deleteDocument } from '../../lib/d1';
import { slugify, cn } from '../../lib/utils';
import { reportClientError, OperationType } from '../../lib/firebase';
import MarkdownEditor from '../MarkdownEditor';
import { ImageUpload } from '../ui/ImageUpload';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Button } from '../ui/button';
import SingleSelectSearch from '../ui/SingleSelectSearch';

/**
 * Species "Options" tab — the single home for the reusable racial-trait library
 * (`species_options`, migration 20260603-1600). See
 * docs/_drafts/species-options-design-2026-06-03.html +
 * docs/features/compendium-races-backgrounds.md.
 *
 * Unlike background features (owned per-background via parentBackgroundId),
 * species options are a SHARED library: this one tab both
 *   - lets the open species ATTACH options (the checkbox per row writes
 *     `speciesOptionIds` on the species), and
 *   - lets you AUTHOR options inline (create / edit / delete) — a new option is
 *     written to the shared `species_options` table, so it immediately appears
 *     in every species' picker (and auto-attaches to the current one).
 *
 * This replaces the standalone species-options manager: the editor is folded
 * into the tab. On Foundry export each attached option becomes an ItemGrant
 * advancement + a feat item in the race bundle's features[] (see
 * api/_lib/_speciesOptionExport.ts + _raceExport.ts).
 *
 * Lean field set (name / identifier / source / page / image / description) —
 * the common case for a trait. Other species_options columns (advancements /
 * activities / effects / uses / tags) are preserved across edits by the partial
 * upsert; richer authoring can be added here later.
 */

type OptionRow = {
  id: string;
  name?: string;
  identifier?: string;
  sourceId?: string | null;
  page?: string;
  description?: string;
  imageUrl?: string | null;
  [k: string]: any;
};

export default function SpeciesOptionsTab({
  selectedIds,
  onChangeSelected,
  sources,
  defaultSourceId,
}: {
  /** Option ids attached to the open species (formData.speciesOptionIds). */
  selectedIds: string[];
  /** Write the new attached-ids array back onto the species form. */
  onChangeSelected: (next: string[]) => void;
  /** Source rows for the inline editor's source picker. */
  sources: any[];
  /** Pre-selected source for a newly created option. */
  defaultSourceId: string;
}) {
  const [options, setOptions] = useState<OptionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<OptionRow | null>(null);
  const [saving, setSaving] = useState(false);

  const sourceAbbrevById = useMemo(
    () => Object.fromEntries(sources.map((s) => [s.id, s.abbreviation || s.shortName || s.name || s.id])),
    [sources],
  );
  const sourceOptions = useMemo(
    () => sources.map((s) => ({
      id: String(s.id),
      name: (s.abbreviation ? `${s.abbreviation} — ` : '') + (s.name || s.id),
    })),
    [sources],
  );

  const load = async () => {
    setLoading(true);
    try {
      const rows = await fetchCollection<OptionRow>('speciesOptions', { orderBy: 'name ASC' });
      setOptions(rows);
    } catch (err) {
      console.error('[SpeciesOptionsTab] load failed:', err);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);

  const selectedSet = new Set(selectedIds);
  const toggleAttach = (id: string) => {
    onChangeSelected(selectedSet.has(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);
  };

  const startNew = () =>
    setEditing({ id: crypto.randomUUID(), name: '', identifier: '', sourceId: defaultSourceId || '', page: '', description: '', imageUrl: '', __new: true });

  const handleSave = async () => {
    if (!editing) return;
    if (!editing.name?.trim()) { toast.error('Option name is required'); return; }
    setSaving(true);
    try {
      const isNew = !!editing.__new;
      const payload = {
        name: editing.name.trim(),
        identifier: (editing.identifier || '').trim() || slugify(editing.name),
        sourceId: editing.sourceId || null,
        page: (editing.page || '').trim() || null,
        description: editing.description || '',
        imageUrl: editing.imageUrl || null,
        updatedAt: new Date().toISOString(),
        createdAt: editing.createdAt || new Date().toISOString(),
      };
      await upsertDocument('speciesOptions', editing.id, payload);
      toast.success(`Option ${isNew ? 'created' : 'updated'}`);
      // A freshly created option auto-attaches to the species being edited.
      if (isNew && !selectedSet.has(editing.id)) onChangeSelected([...selectedIds, editing.id]);
      setEditing(null);
      await load();
    } catch (error) {
      console.error('[SpeciesOptionsTab] save failed:', error);
      toast.error('Failed to save option');
      reportClientError(error, editing.__new ? OperationType.CREATE : OperationType.UPDATE, `species_options/${editing.id}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this species option? It is removed from every species that uses it.')) return;
    try {
      await deleteDocument('speciesOptions', id);
      toast.success('Option deleted');
      if (selectedSet.has(id)) onChangeSelected(selectedIds.filter((x) => x !== id));
      if (editing?.id === id) setEditing(null);
      await load();
    } catch (error) {
      console.error('[SpeciesOptionsTab] delete failed:', error);
      toast.error('Failed to delete option');
      reportClientError(error, OperationType.DELETE, `species_options/${id}`);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) =>
      String(o.name || '').toLowerCase().includes(q)
      || String(o.identifier || '').toLowerCase().includes(q)
      || String(sourceAbbrevById[String(o.sourceId ?? '')] || '').toLowerCase().includes(q));
  }, [options, search, sourceAbbrevById]);

  return (
    <div className="space-y-4 pt-4 border-t border-gold/10">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-gold">
            Species Options {selectedIds.length > 0 && <span className="text-gold/60">({selectedIds.length} attached)</span>}
          </h3>
          <p className="text-[10px] text-ink/40 italic">
            Reusable racial traits (Darkvision, Powerful Build, …). Check the ones this species grants;
            create new ones here and they become available to every species. Each attached option is
            granted as a feature on Foundry export.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={startNew}
          className="h-7 gap-1 border border-gold/20 text-gold bg-gold/5 hover:bg-gold/10 shrink-0"
        >
          <Plus className="w-3 h-3" /> New Option
        </Button>
      </div>

      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search options…"
        className="h-8 bg-background/50 border-gold/10 focus:border-gold text-sm"
      />

      {loading ? (
        <p className="text-[11px] text-ink/40 italic">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="text-[11px] text-ink/40 italic">
          {options.length === 0 ? 'No species options yet — create one with "New Option".' : 'No options match your search.'}
        </p>
      ) : (
        <div className="divide-y divide-gold/10 rounded-lg border border-gold/10 bg-card/30 max-h-80 overflow-y-auto custom-scrollbar">
          {filtered.map((o) => {
            const attached = selectedSet.has(o.id);
            return (
              <div key={o.id} className="flex items-center justify-between gap-3 px-3 py-2 group">
                <button
                  type="button"
                  onClick={() => toggleAttach(o.id)}
                  className="flex items-center gap-2.5 min-w-0 flex-1 text-left"
                  title={attached ? 'Attached to this species — click to detach' : 'Click to attach to this species'}
                >
                  <span className={cn(
                    'w-4 h-4 rounded border shrink-0 flex items-center justify-center transition-colors',
                    attached ? 'bg-gold border-gold' : 'border-gold/30 group-hover:border-gold/60',
                  )}>
                    {attached ? <Check className="w-3 h-3 text-white" /> : null}
                  </span>
                  {o.imageUrl ? (
                    <img src={o.imageUrl} alt="" className="h-6 w-6 rounded border border-gold/20 object-cover shrink-0" />
                  ) : (
                    <span className="h-6 w-6 rounded border border-gold/10 bg-background/40 flex items-center justify-center shrink-0">
                      <Dna className="h-3 w-3 text-ink/30" />
                    </span>
                  )}
                  <span className="text-sm font-semibold text-ink truncate">{o.name || 'Untitled'}</span>
                  {o.sourceId ? (
                    <span className="text-[9px] font-bold text-gold/70 shrink-0">{sourceAbbrevById[String(o.sourceId)] || ''}</span>
                  ) : null}
                </button>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <button type="button" onClick={() => setEditing({ ...o })} className="h-6 w-6 grid place-items-center text-gold hover:bg-gold/10 rounded" title="Edit">
                    <Edit className="w-3 h-3" />
                  </button>
                  <button type="button" onClick={() => void handleDelete(o.id)} className="h-6 w-6 grid place-items-center text-blood hover:bg-blood/10 rounded" title="Delete">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Inline create / edit editor */}
      {editing && (
        <div className="rounded-xl border border-gold/20 bg-card/50 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-[11px] font-bold uppercase tracking-widest text-gold/80">
              {editing.__new ? 'New Species Option' : 'Edit Species Option'}
            </h4>
            <button type="button" onClick={() => setEditing(null)} className="text-ink/40 hover:text-ink" title="Cancel">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid gap-3 md:grid-cols-[64px_minmax(0,1fr)]">
            <ImageUpload
              currentImageUrl={editing.imageUrl || ''}
              storagePath={`images/species-options/${editing.id}/`}
              onUpload={(url) => setEditing((p) => (p ? { ...p, imageUrl: url } : p))}
              imageType="icon"
              compact
              className="h-16 w-16"
            />
            <div className="grid gap-3 grid-cols-2">
              <div className="space-y-0.5">
                <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/40">Name</Label>
                <Input
                  value={editing.name || ''}
                  onChange={(e) => setEditing((p) => (p ? { ...p, name: e.target.value } : p))}
                  className="h-8 bg-background/50 border-gold/10 focus:border-gold text-sm"
                  placeholder="e.g. Darkvision 60"
                />
              </div>
              <div className="space-y-0.5">
                <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/40">Identifier</Label>
                <Input
                  value={editing.identifier || ''}
                  onChange={(e) => setEditing((p) => (p ? { ...p, identifier: e.target.value } : p))}
                  className="h-8 bg-background/50 border-gold/10 focus:border-gold font-mono text-sm"
                  placeholder={slugify(editing.name || 'option')}
                />
              </div>
              <div className="space-y-0.5">
                <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/40">Source</Label>
                <SingleSelectSearch
                  value={editing.sourceId || ''}
                  onChange={(next) => setEditing((p) => (p ? { ...p, sourceId: next } : p))}
                  options={sourceOptions}
                  placeholder="— none —"
                  triggerClassName="h-8 w-full"
                />
              </div>
              <div className="space-y-0.5">
                <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/40">Page</Label>
                <Input
                  value={editing.page || ''}
                  onChange={(e) => setEditing((p) => (p ? { ...p, page: e.target.value } : p))}
                  className="h-8 bg-background/50 border-gold/10 focus:border-gold text-sm"
                  placeholder="e.g. 35"
                />
              </div>
            </div>
          </div>

          <div className="space-y-0.5">
            <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/40">Description</Label>
            <MarkdownEditor
              value={editing.description || ''}
              onChange={(description) => setEditing((p) => (p ? { ...p, description } : p))}
              minHeight="180px"
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setEditing(null)} className="h-8 border-gold/20 text-ink">
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={() => void handleSave()} disabled={saving} className="h-8 bg-primary text-primary-foreground">
              {saving ? 'Saving…' : 'Save Option'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

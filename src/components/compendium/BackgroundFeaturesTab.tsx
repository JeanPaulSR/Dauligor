import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { BookOpen, Edit, Plus, Trash2, X } from 'lucide-react';
import { fetchCollection, upsertDocument, deleteDocument } from '../../lib/d1';
import { slugify } from '../../lib/utils';
import { reportClientError, OperationType } from '../../lib/firebase';
import MarkdownEditor from '../MarkdownEditor';
import { ImageUpload } from '../ui/ImageUpload';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Button } from '../ui/button';

/**
 * Background "Features" tab — authors the feature(s) a background grants (the
 * 2014 "Feature: …" block), the way the class editor authors class features.
 *
 * Features are stored in `background_features` OWNED by this background
 * (`parentBackgroundId`, migration 20260602-1500) and saved independently of
 * the background form (each Add/Edit/Delete writes immediately) — so the
 * background must be saved first to have a stable id. Foundry export of these
 * (ItemGrant + a feature export endpoint) is a separate, planned step; this tab
 * is the authoring surface.
 *
 * Intentionally lightweight (name + identifier + image + description). The
 * standalone CompendiumFeatureEditor remains for richer catalog authoring.
 */

type FeatureRow = {
  id: string;
  name?: string;
  identifier?: string;
  description?: string;
  imageUrl?: string;
  page?: string;
  parentBackgroundId?: string;
  [k: string]: any;
};

export default function BackgroundFeaturesTab({
  backgroundId,
  defaultSourceId,
  storageFolder,
}: {
  backgroundId: string | null;
  defaultSourceId: string;
  storageFolder: string;
}) {
  const [features, setFeatures] = useState<FeatureRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<FeatureRow | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!backgroundId) { setFeatures([]); return; }
    setLoading(true);
    try {
      const rows = await fetchCollection<FeatureRow>('backgroundFeatures', {
        where: 'parentBackgroundId = ?',
        params: [backgroundId],
        orderBy: 'name ASC',
      });
      setFeatures(rows);
    } catch (err) {
      console.error('[BackgroundFeaturesTab] load failed:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [backgroundId]);

  if (!backgroundId) {
    return (
      <div className="pt-4 border-t border-gold/10">
        <div className="p-4 border border-gold/10 bg-card/30 rounded-xl">
          <p className="text-[11px] text-ink/50 italic leading-relaxed">
            Save this background first to add features — features attach to a stable background id.
          </p>
        </div>
      </div>
    );
  }

  const startNew = () =>
    setEditing({ id: crypto.randomUUID(), name: '', identifier: '', description: '', imageUrl: '', page: '', __new: true });

  const handleSave = async () => {
    if (!editing) return;
    if (!editing.name?.trim()) { toast.error('Feature name is required'); return; }
    setSaving(true);
    try {
      const payload = {
        ...editing,
        name: editing.name.trim(),
        identifier: (editing.identifier || '').trim() || slugify(editing.name),
        sourceId: editing.sourceId || defaultSourceId || null,
        description: editing.description || '',
        imageUrl: editing.imageUrl || null,
        page: (editing.page || '').trim() || null,
        parentBackgroundId: backgroundId,
        updatedAt: new Date().toISOString(),
        createdAt: editing.createdAt || new Date().toISOString(),
      };
      delete (payload as any).__new;
      await upsertDocument('backgroundFeatures', editing.id, payload);
      toast.success(`Feature ${editing.__new ? 'created' : 'updated'}`);
      setEditing(null);
      await load();
    } catch (error) {
      console.error('[BackgroundFeaturesTab] save failed:', error);
      toast.error('Failed to save feature');
      reportClientError(error, editing.__new ? OperationType.CREATE : OperationType.UPDATE, `background_features/${editing.id}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this feature?')) return;
    try {
      await deleteDocument('backgroundFeatures', id);
      toast.success('Feature deleted');
      if (editing?.id === id) setEditing(null);
      await load();
    } catch (error) {
      console.error('[BackgroundFeaturesTab] delete failed:', error);
      toast.error('Failed to delete feature');
      reportClientError(error, OperationType.DELETE, `background_features/${id}`);
    }
  };

  return (
    <div className="space-y-4 pt-4 border-t border-gold/10">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-gold">Features</h3>
          <p className="text-[10px] text-ink/40 italic">
            The special feature(s) this background grants (e.g. "Shelter of the Faithful").
          </p>
        </div>
        <Button type="button" size="sm" onClick={startNew} className="h-7 gap-1 border border-gold/20 text-gold bg-gold/5 hover:bg-gold/10">
          <Plus className="w-3 h-3" /> Add Feature
        </Button>
      </div>

      {/* List */}
      {loading ? (
        <p className="text-[11px] text-ink/40 italic">Loading…</p>
      ) : features.length === 0 ? (
        <p className="text-[11px] text-ink/40 italic">No features yet.</p>
      ) : (
        <div className="divide-y divide-gold/10 rounded-lg border border-gold/10 bg-card/30">
          {features.map((f) => (
            <div key={f.id} className="flex items-center justify-between gap-3 px-3 py-2 group">
              <div className="flex items-center gap-2 min-w-0">
                {f.imageUrl ? (
                  <img src={f.imageUrl} alt="" className="h-6 w-6 rounded border border-gold/20 object-cover shrink-0" />
                ) : (
                  <span className="h-6 w-6 rounded border border-gold/10 bg-background/40 flex items-center justify-center shrink-0">
                    <BookOpen className="h-3 w-3 text-ink/30" />
                  </span>
                )}
                <span className="text-sm font-semibold text-ink truncate">{f.name || 'Untitled'}</span>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                <button type="button" onClick={() => setEditing({ ...f })} className="h-6 w-6 grid place-items-center text-gold hover:bg-gold/10 rounded" title="Edit">
                  <Edit className="w-3 h-3" />
                </button>
                <button type="button" onClick={() => void handleDelete(f.id)} className="h-6 w-6 grid place-items-center text-blood hover:bg-blood/10 rounded" title="Delete">
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Inline editor */}
      {editing && (
        <div className="rounded-xl border border-gold/20 bg-card/50 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-[11px] font-bold uppercase tracking-widest text-gold/80">
              {editing.__new ? 'New Feature' : 'Edit Feature'}
            </h4>
            <button type="button" onClick={() => setEditing(null)} className="text-ink/40 hover:text-ink" title="Cancel">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid gap-3 md:grid-cols-[64px_minmax(0,1fr)]">
            <ImageUpload
              currentImageUrl={editing.imageUrl || ''}
              storagePath={`images/${storageFolder}/${editing.id}/`}
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
                  placeholder="e.g. Shelter of the Faithful"
                />
              </div>
              <div className="space-y-0.5">
                <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/40">Identifier</Label>
                <Input
                  value={editing.identifier || ''}
                  onChange={(e) => setEditing((p) => (p ? { ...p, identifier: e.target.value } : p))}
                  className="h-8 bg-background/50 border-gold/10 focus:border-gold font-mono text-sm"
                  placeholder={slugify(editing.name || 'feature')}
                />
              </div>
            </div>
          </div>

          <div className="space-y-0.5">
            <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/40">Description</Label>
            <MarkdownEditor
              value={editing.description || ''}
              onChange={(description) => setEditing((p) => (p ? { ...p, description } : p))}
              minHeight="200px"
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setEditing(null)} className="h-8 border-gold/20 text-ink">
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={() => void handleSave()} disabled={saving} className="h-8 bg-primary text-primary-foreground">
              {saving ? 'Saving…' : 'Save Feature'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

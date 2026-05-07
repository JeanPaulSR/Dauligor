import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { fetchCollection, upsertDocument, deleteDocument } from '../../lib/d1';
import { normalizeCompendiumData, denormalizeCompendiumData } from '../../lib/compendium';
import { Database, CloudOff, ChevronLeft, Edit, Plus, Save, Trash2, Wrench } from 'lucide-react';
import { slugify } from '../../lib/utils';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { ImageUpload } from '../ui/ImageUpload';
import MarkdownEditor from '../MarkdownEditor';
import ActivityEditor from './ActivityEditor';

type DevelopmentFormData = {
  id?: string;
  name: string;
  identifier: string;
  sourceId: string;
  imageUrl: string;
  description: string;
  activities: any[];
  effectsStr: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: any;
};

interface DevelopmentCompendiumManagerProps {
  userProfile: any;
  collectionName: string;
  title: string;
  singularLabel: string;
  icon: LucideIcon;
  description: string;
  backPath?: string;
  defaultData: Omit<DevelopmentFormData, 'sourceId'> & { sourceId?: string };
  renderSpecificFields: (
    formData: DevelopmentFormData,
    setFormData: React.Dispatch<React.SetStateAction<DevelopmentFormData>>
  ) => React.ReactNode;
  summarizeEntry?: (entry: any, sourceLabel: string) => React.ReactNode;
  normalizeBeforeSave?: (formData: DevelopmentFormData) => Record<string, any>;
}

function makeInitialForm(defaultData: DevelopmentCompendiumManagerProps['defaultData'], sources: any[] = []): DevelopmentFormData {
  return {
    ...defaultData,
    sourceId: defaultData.sourceId || sources[0]?.id || '',
    activities: Array.isArray(defaultData.activities) ? defaultData.activities : [],
    effectsStr: defaultData.effectsStr ?? '[]'
  } as DevelopmentFormData;
}

export default function DevelopmentCompendiumManager({
  userProfile,
  collectionName,
  title,
  singularLabel,
  icon: Icon,
  description,
  backPath = '/compendium',
  defaultData,
  renderSpecificFields,
  summarizeEntry,
  normalizeBeforeSave
}: DevelopmentCompendiumManagerProps) {
  const isAdmin = userProfile?.role === 'admin';
  const [entries, setEntries] = useState<any[]>([]);
  const [sources, setSources] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<DevelopmentFormData>(makeInitialForm(defaultData));
  const [isFoundationUsingD1, setIsFoundationUsingD1] = useState(false);

  const loadEntries = async () => {
    try {
      const items = await fetchCollection<any>(collectionName, { orderBy: 'name ASC' });

      // Denormalize: Map snake_case to camelCase and restore automation object
      const denormalized = items.map((item: any) => denormalizeCompendiumData(item));

      setEntries(denormalized);
      setLoading(false);
    } catch (err) {
      console.error(`Error loading ${collectionName}:`, err);
      setLoading(false);
    }
  };

  const loadSources = async () => {
    try {
      const data = await fetchCollection('sources', { orderBy: 'name ASC' });
      setSources(data);
      if (data.length > 0) setIsFoundationUsingD1(true);
    } catch (err) {
      console.error(`[${title}] Error loading sources:`, err);
      setIsFoundationUsingD1(false);
    }
  };

  useEffect(() => {
    if (!isAdmin) return;
    loadEntries();
    loadSources();

    return () => {
      // No more unsubscribe needed for fetchCollection
    };
  }, [collectionName, isAdmin, title]);

  useEffect(() => {
    if (editingId) return;
    if (formData.sourceId || sources.length === 0) return;
    setFormData(prev => ({ ...prev, sourceId: sources[0].id }));
  }, [editingId, formData.sourceId, sources]);

  const resetForm = () => {
    setEditingId(null);
    setFormData(makeInitialForm(defaultData, sources));
  };

  const startEditing = (entry: any) => {
    setEditingId(entry.id);
    setFormData({
      ...makeInitialForm(defaultData, sources),
      ...entry,
      id: entry.id,
      sourceId: entry.sourceId || sources[0]?.id || '',
      activities: Array.isArray(entry.automation?.activities)
        ? entry.automation.activities
        : Array.isArray(entry.activities)
          ? entry.activities
          : [],
      effectsStr: JSON.stringify(entry.automation?.effects || entry.effects || [], null, 2)
    });
  };

  const sourceNameById = useMemo(() => {
    return Object.fromEntries(sources.map(source => [source.id, source.name]));
  }, [sources]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      toast.error(`${singularLabel} name is required`);
      return;
    }
    if (!formData.sourceId) {
      toast.error('Source is required');
      return;
    }

    let parsedEffects: any[] = [];
    try {
      parsedEffects = formData.effectsStr ? JSON.parse(formData.effectsStr) : [];
      if (!Array.isArray(parsedEffects)) throw new Error('Effects must be a JSON array');
    } catch (error: any) {
      toast.error(error.message || 'Effects must be valid JSON');
      return;
    }

    setSaving(true);
    try {
      const basePayload: Record<string, any> = {
        ...formData,
        identifier: formData.identifier.trim() || slugify(formData.name),
        automation: {
          activities: Array.isArray(formData.activities)
            ? formData.activities
            : Object.values(formData.activities || {}),
          effects: parsedEffects
        },
        updatedAt: new Date().toISOString(),
        status: 'development'
      };

      delete basePayload.id;
      delete basePayload.activities;
      delete basePayload.effectsStr;

      const normalizedPayload = normalizeBeforeSave
        ? { ...basePayload, ...normalizeBeforeSave(formData) }
        : basePayload;

      // Final normalization for D1 columns (camelCase -> snake_case)
      const d1Payload = normalizeCompendiumData(normalizedPayload);

      Object.keys(d1Payload).forEach(key => {
        if (d1Payload[key] === undefined) delete d1Payload[key];
      });

      const entryId = editingId || crypto.randomUUID();
      await upsertDocument(collectionName, entryId, d1Payload);
      
      toast.success(`${singularLabel} ${editingId ? 'updated' : 'created'}`);

      resetForm();
      // Trigger a reload to show the new/updated entry
      loadEntries();
    } catch (error) {
      console.error(`Error saving ${collectionName} entry:`, error);
      toast.error(`Failed to save ${singularLabel.toLowerCase()}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm(`Delete this ${singularLabel.toLowerCase()}?`)) return;
    try {
      await deleteDocument(collectionName, id);
      toast.success(`${singularLabel} deleted`);
      setEntries(prev => prev.filter(e => e.id !== id));
      if (editingId === id) resetForm();
    } catch (error) {
      console.error(`Error deleting ${collectionName} entry:`, error);
      toast.error(`Failed to delete ${singularLabel.toLowerCase()}`);
    }
  };

  if (!isAdmin) {
    return <div className="text-center py-20">Access Denied. Admins only.</div>;
  }

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-20">
      <div className="flex items-center gap-3 text-gold mb-2">
        <Icon className="w-6 h-6" />
        <span className="text-sm font-bold uppercase tracking-[0.3em]">Compendium Development</span>
      </div>

      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-2">
          <div className="flex items-center gap-4 mb-2">
            <Link to={backPath}>
              <Button variant="ghost" size="sm" className="text-gold gap-2 hover:bg-gold/5">
                <ChevronLeft className="w-4 h-4" /> Back
              </Button>
            </Link>
          </div>
          <div className="flex items-center gap-4">
            <h1 className="text-4xl font-serif font-bold text-ink tracking-tight uppercase">{title}</h1>
            {isFoundationUsingD1 ? (
              <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                <Database className="w-3.5 h-3.5 text-emerald-500" />
                <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest">Foundation Linked</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20">
                <CloudOff className="w-3.5 h-3.5 text-amber-500" />
                <span className="text-[10px] font-bold text-amber-500 uppercase tracking-widest">Legacy Foundation</span>
              </div>
            )}
          </div>
          <p className="text-ink/60 font-serif italic max-w-3xl">{description}</p>
          <p className="text-xs text-gold/80 border border-gold/10 bg-gold/5 rounded px-3 py-2 max-w-3xl">
            Admin-only development surface. These entries are for schema shaping and Foundry alignment while the workflow is still in progress.
          </p>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-8">
        <div className="space-y-6 lg:col-span-2">
          <Card className="border-gold/20 bg-card/50">
            <CardContent className="p-6">
              <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-gold border-b border-gold/10 pb-2">
                {editingId ? `Edit ${singularLabel}` : `New ${singularLabel}`}
              </h2>

              <form onSubmit={handleSave} className="space-y-6 mt-4">
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label className="text-xs font-bold uppercase tracking-widest text-ink/40">Name</Label>
                    <Input
                      value={formData.name}
                      onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
                      className="bg-background/50 border-gold/10 focus:border-gold"
                      placeholder={`e.g. ${singularLabel}`}
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-bold uppercase tracking-widest text-ink/40">Identifier</Label>
                    <Input
                      value={formData.identifier}
                      onChange={e => setFormData(prev => ({ ...prev, identifier: e.target.value }))}
                      className="bg-background/50 border-gold/10 focus:border-gold font-mono"
                      placeholder={slugify(formData.name || singularLabel)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-bold uppercase tracking-widest text-ink/40">Source</Label>
                    <select
                      value={formData.sourceId}
                      onChange={e => setFormData(prev => ({ ...prev, sourceId: e.target.value }))}
                      className="w-full h-10 px-3 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-sm"
                    >
                      <option value="">Select a source</option>
                      {sources.map(source => (
                        <option key={source.id} value={source.id}>{source.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs font-bold uppercase tracking-widest text-ink/40">Image</Label>
                  <ImageUpload
                    currentImageUrl={formData.imageUrl}
                    storagePath={`images/${collectionName}/${editingId || 'draft'}/`}
                    onUpload={(url) => setFormData(prev => ({ ...prev, imageUrl: url }))}
                  />
                </div>

                <MarkdownEditor
                  value={formData.description}
                  onChange={value => setFormData(prev => ({ ...prev, description: value }))}
                  label="Description"
                  placeholder={`Describe the ${singularLabel.toLowerCase()} in game terms and Foundry-facing behavior. Activities should carry runtime mechanics.`}
                  minHeight="220px"
                />

                {renderSpecificFields(formData, setFormData)}

                <div className="space-y-3">
                  <div className="border-t border-gold/10 pt-4">
                    <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-gold mb-2">Activities</h3>
                    <ActivityEditor
                      activities={formData.activities}
                      onChange={(activities) => setFormData(prev => ({ ...prev, activities }))}
                    />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs font-bold uppercase tracking-widest text-ink/40">Effects (JSON)</Label>
                    <textarea
                      value={formData.effectsStr}
                      onChange={e => setFormData(prev => ({ ...prev, effectsStr: e.target.value }))}
                      className="w-full min-h-[160px] rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-xs font-mono p-3"
                      placeholder="[]"
                    />
                    <p className="text-[10px] text-ink/40">
                      Raw effect scaffolding for now. Activities should be the primary runtime surface, with effects for persistent states and automation support.
                    </p>
                  </div>
                </div>

                <div className="flex gap-3 pt-2">
                  <Button type="submit" className="bg-primary hover:bg-primary/90 text-primary-foreground gap-2" disabled={saving}>
                    <Save className="w-4 h-4" /> {saving ? 'Saving...' : `Save ${singularLabel}`}
                  </Button>
                  <Button type="button" variant="ghost" className="text-ink/60 hover:text-gold" onClick={resetForm}>
                    Reset
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="border-gold/20 bg-card/50">
            <CardContent className="p-6">
              <div className="flex items-center justify-between border-b border-gold/10 pb-2 mb-4">
                <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-gold">{title} Drafts</h2>
                <div className="flex items-center gap-2 text-ink/40 text-xs">
                  <Wrench className="w-3 h-3" />
                  {entries.length}
                </div>
              </div>

              {loading ? (
                <div className="text-sm text-ink/40 italic">Loading…</div>
              ) : entries.length === 0 ? (
                <div className="text-sm text-ink/40 italic">No {title.toLowerCase()} drafted yet.</div>
              ) : (
                <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
                  {entries.map(entry => {
                    const sourceLabel = sourceNameById[entry.sourceId] || entry.sourceId || 'Unknown source';
                    return (
                      <div key={entry.id} className="border border-gold/10 rounded-md p-3 bg-background/30 space-y-2">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h3 className="font-bold text-sm text-ink">{entry.name}</h3>
                            <p className="text-[10px] uppercase tracking-widest text-gold/70">{sourceLabel}</p>
                          </div>
                          <div className="flex gap-1">
                            <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0 text-gold" onClick={() => startEditing(entry)}>
                              <Edit className="w-3 h-3" />
                            </Button>
                            <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0 text-blood" onClick={() => handleDelete(entry.id)}>
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                        </div>
                        <p className="text-[10px] text-ink/50 font-mono">{entry.identifier || '(no identifier)'}</p>
                        <div className="text-xs text-ink/70">
                          {summarizeEntry ? summarizeEntry(entry, sourceLabel) : `${(entry.automation?.activities || []).length || 0} activities`}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

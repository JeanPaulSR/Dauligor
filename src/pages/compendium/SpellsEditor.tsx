import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, Edit3, Plus, Save, Search, Trash2, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import SpellImportWorkbench from '../../components/compendium/SpellImportWorkbench';
import ActivityEditor from '../../components/compendium/ActivityEditor';
import MarkdownEditor from '../../components/MarkdownEditor';
import { reportClientError, OperationType } from '../../lib/firebase';
import { upsertSpell, deleteSpell, fetchSpell } from '../../lib/compendium';
import { fetchCollection } from '../../lib/d1';
import { slugify } from '../../lib/utils';
import { Database, CloudOff } from 'lucide-react';
import { SCHOOL_LABELS } from '../../lib/spellImport';
import { cn } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Checkbox } from '../../components/ui/checkbox';
import { ImageUpload } from '../../components/ui/ImageUpload';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import VirtualizedList from '../../components/ui/VirtualizedList';
import type { SpellSummaryRecord } from '../../lib/spellSummary';

const SPELL_SCHOOLS = [
  ['abj', 'Abjuration'],
  ['con', 'Conjuration'],
  ['div', 'Divination'],
  ['enc', 'Enchantment'],
  ['evo', 'Evocation'],
  ['ill', 'Illusion'],
  ['nec', 'Necromancy'],
  ['trs', 'Transmutation']
];

const PREPARATION_MODES = [
  ['spell', 'Spell'],
  ['always', 'Always'],
  ['atwill', 'At-Will'],
  ['innate', 'Innate'],
  ['pact', 'Pact']
];

const MANAGER_LIST_HEIGHT = 720;
const MANAGER_ROW_HEIGHT = 94;

type SpellFormData = {
  id?: string;
  name: string;
  identifier: string;
  sourceId: string;
  imageUrl: string;
  description: string;
  activities: any[];
  effectsStr: string;
  level: number;
  school: string;
  preparationMode: string;
  ritual: boolean;
  concentration: boolean;
  components: {
    vocal: boolean;
    somatic: boolean;
    material: boolean;
    materialText: string;
    consumed: boolean;
    cost: string;
  };
  createdAt?: string;
  updatedAt?: string;
  [key: string]: any;
};

const SPELL_DEFAULTS: Omit<SpellFormData, 'sourceId'> & { sourceId?: string } = {
  name: '',
  identifier: '',
  sourceId: '',
  imageUrl: '',
  description: '',
  activities: [],
  effectsStr: '[]',
  level: 0,
  school: 'evo',
  preparationMode: 'spell',
  ritual: false,
  concentration: false,
  components: {
    vocal: true,
    somatic: true,
    material: false,
    materialText: '',
    consumed: false,
    cost: ''
  }
};

function makeInitialSpellForm(sources: any[] = []): SpellFormData {
  return {
    ...SPELL_DEFAULTS,
    sourceId: sources[0]?.id || ''
  } as SpellFormData;
}

function mergeSpellComponents(
  current: SpellFormData['components'] | undefined,
  patch: Partial<SpellFormData['components']>
): SpellFormData['components'] {
  return {
    vocal: current?.vocal ?? true,
    somatic: current?.somatic ?? true,
    material: current?.material ?? false,
    materialText: current?.materialText ?? '',
    consumed: current?.consumed ?? false,
    cost: current?.cost ?? '',
    ...patch
  };
}

export default function SpellsEditor({ userProfile }: { userProfile: any }) {
  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-20">
      <div className="flex items-center gap-4">
        <Link to="/compendium/spells">
          <Button variant="ghost" size="sm" className="text-gold gap-2 hover:bg-gold/5">
            <ChevronLeft className="w-4 h-4" />
            Back To Spells
          </Button>
        </Link>
      </div>

      <Tabs defaultValue="foundry-import" className="space-y-6">
        <TabsList variant="line" className="gap-2 bg-transparent p-0">
          <TabsTrigger value="foundry-import" className="rounded-md border border-gold/15 bg-background/30 px-4 py-2 text-sm uppercase tracking-[0.18em] text-ink/65 data-active:border-gold/40 data-active:bg-gold/10 data-active:text-gold">
            Foundry Import
          </TabsTrigger>
          <TabsTrigger value="manual-editor" className="rounded-md border border-gold/15 bg-background/30 px-4 py-2 text-sm uppercase tracking-[0.18em] text-ink/65 data-active:border-gold/40 data-active:bg-gold/10 data-active:text-gold">
            Manual Editor
          </TabsTrigger>
        </TabsList>

        <TabsContent value="foundry-import">
          <SpellImportWorkbench userProfile={userProfile} />
        </TabsContent>

        <TabsContent value="manual-editor">
          <SpellManualEditor userProfile={userProfile} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SpellManualEditor({ userProfile }: { userProfile: any }) {
  const isAdmin = userProfile?.role === 'admin';
  const [entries, setEntries] = useState<any[]>([]);
  const [spellDetailsById, setSpellDetailsById] = useState<Record<string, any>>({});
  const [sources, setSources] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [purging, setPurging] = useState(false);
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<SpellFormData>(makeInitialSpellForm());
  const [isFoundationUsingD1, setIsFoundationUsingD1] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;

    const loadEntries = async () => {
      try {
        const data = await fetchCollection<any>('spells', { orderBy: 'name ASC' });
        
        // Map D1 results to what the UI expects (camelCase)
        const mapped = data.map(row => ({
          ...row,
          sourceId: row.source_id,
          imageUrl: row.image_url,
          level: Number(row.level || 0),
          school: row.school,
          preparationMode: row.preparation_mode,
          tagIds: Array.isArray(row.tags) ? row.tags : []
        }));
        
        setEntries(mapped);
        setLoading(false);
      } catch (err) {
        console.error('Error loading spells from D1:', err);
        setLoading(false);
      }
    };

    loadEntries();

    const loadSources = async () => {
      try {
        const data = await fetchCollection('sources', { orderBy: 'name ASC' });
        setSources(data);
        if (data.length > 0) setIsFoundationUsingD1(true);
      } catch (err) {
        console.error("[SpellsEditor] Error loading sources:", err);
        setIsFoundationUsingD1(false);
      }
    };

    loadSources();
  }, [isAdmin]);

  useEffect(() => {
    if (editingId) return;
    if (formData.sourceId || sources.length === 0) return;
    setFormData((prev) => ({ ...prev, sourceId: sources[0].id }));
  }, [editingId, formData.sourceId, sources]);

  const sourceNameById = useMemo(
    () => Object.fromEntries(sources.map((source) => [source.id, source.name || source.abbreviation || source.shortName || source.id])),
    [sources]
  );

  const filteredEntries = useMemo(() => {
    const lowered = search.trim().toLowerCase();
    if (!lowered) return entries;
    return entries.filter((entry) => {
      const sourceLabel = String(sourceNameById[entry.sourceId] || '').toLowerCase();
      return String(entry.name || '').toLowerCase().includes(lowered)
        || String(entry.identifier || '').toLowerCase().includes(lowered)
        || sourceLabel.includes(lowered);
    });
  }, [entries, search, sourceNameById]);

  const resetForm = () => {
    setEditingId(null);
    setFormData(makeInitialSpellForm(sources));
  };

  useEffect(() => {
    if (!editingId) return;
    if (spellDetailsById[editingId]) {
      const entry = spellDetailsById[editingId];
      setFormData({
        ...makeInitialSpellForm(sources),
        ...entry,
        id: entry.id,
        sourceId: entry.sourceId || sources[0]?.id || '',
        activities: Array.isArray(entry.automation?.activities)
          ? entry.automation.activities
          : Array.isArray(entry.activities)
            ? entry.activities
            : [],
        effectsStr: JSON.stringify(entry.automation?.effects || entry.effects || [], null, 2),
        level: Number(entry.level || 0),
        school: entry.school || 'evo',
        preparationMode: entry.preparationMode || 'spell',
        ritual: !!entry.ritual,
        concentration: !!entry.concentration,
        components: {
          vocal: !!entry.components?.vocal,
          somatic: !!entry.components?.somatic,
          material: !!entry.components?.material,
          materialText: entry.components?.materialText || '',
          consumed: !!entry.components?.consumed,
          cost: entry.components?.cost || ''
        }
      });
      return;
    }

    let active = true;
    const loadDetails = async () => {
      try {
        const data = await fetchSpell(editingId);

        if (!active || !data) return;

        setSpellDetailsById((current) => ({
          ...current,
          [editingId]: data
        }));
      } catch (err) {
        console.error("Error loading spell details:", err);
      }
    };

    loadDetails();

    return () => {
      active = false;
    };
  }, [editingId, sources, spellDetailsById]);

  const startEditing = (entry: SpellSummaryRecord) => {
    setEditingId(entry.id);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      toast.error('Spell name is required');
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
      const payload: Record<string, any> = {
        ...formData,
        identifier: formData.identifier.trim() || slugify(formData.name),
        automation: {
          activities: Array.isArray(formData.activities)
            ? formData.activities
            : Object.values(formData.activities || {}),
          effects: parsedEffects
        },
        updatedAt: new Date().toISOString(),
        status: 'development',
        sourceType: 'spell',
        type: 'spell',
        level: Number(formData.level || 0),
        preparationMode: formData.preparationMode || 'spell'
      };

      delete payload.id;
      delete payload.activities;
      delete payload.effectsStr;

      Object.keys(payload).forEach((key) => {
        if (payload[key] === undefined) delete payload[key];
      });

      if (editingId) {
        await upsertSpell(editingId, {
          ...payload,
          createdAt: formData.createdAt || new Date().toISOString()
        });
        toast.success('Spell updated');
      } else {
        const createdId = crypto.randomUUID();
        await upsertSpell(createdId, {
          ...payload,
          createdAt: new Date().toISOString()
        });
        toast.success('Spell created');
      }

      // Refresh entries list
      const updatedData = await fetchCollection<any>('spells', { orderBy: 'name ASC' });
      const mapped = updatedData.map(row => ({
        ...row,
        sourceId: row.source_id,
        imageUrl: row.image_url,
        level: Number(row.level || 0),
        school: row.school,
        preparationMode: row.preparation_mode,
        tagIds: Array.isArray(row.tags) ? row.tags : []
      }));
      setEntries(mapped);
      
      resetForm();
    } catch (error) {
      console.error('Error saving spell:', error);
      toast.error('Failed to save spell');
      reportClientError(error, editingId ? OperationType.UPDATE : OperationType.CREATE, `spells/${editingId || '(new)'}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!editingId) return;
    if (!window.confirm('Delete this spell?')) return;

    try {
      await deleteSpell(editingId);
      toast.success('Spell deleted');
      
      // Refresh entries list
      const updatedData = await fetchCollection<any>('spells', { orderBy: 'name ASC' });
      const mapped = updatedData.map(row => ({
        ...row,
        sourceId: row.source_id,
        imageUrl: row.image_url,
        level: Number(row.level || 0),
        school: row.school,
        preparationMode: row.preparation_mode,
        tagIds: Array.isArray(row.tags) ? row.tags : []
      }));
      setEntries(mapped);
      
      resetForm();
    } catch (error) {
      console.error('Error deleting spell:', error);
      toast.error('Failed to delete spell');
      reportClientError(error, OperationType.DELETE, `spells/${editingId}`);
    }
  };


  if (!isAdmin) {
    return <div className="text-center py-20">Access Denied. Admins only.</div>;
  }

  return (
    <div className="space-y-6">
      <Card className="border-gold/20 bg-card/50 overflow-hidden">
        <CardContent className="p-0">
          <div className="border-b border-gold/10 bg-[radial-gradient(circle_at_top_left,rgba(192,160,96,0.14),transparent_52%),linear-gradient(180deg,rgba(12,16,24,0.75),rgba(12,16,24,0.98))] p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="space-y-3">
                <div className="flex items-center gap-3 text-gold">
                  <Wand2 className="h-5 w-5" />
                  <span className="text-xs font-bold uppercase tracking-[0.3em]">Compendium Development</span>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-4">
                  <h2 className="text-3xl font-serif font-bold uppercase tracking-tight text-ink">Spell Manager</h2>
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
                  <p className="max-w-3xl font-serif italic text-ink/60">
                    Draft and refine spell records with the same selector rhythm as the importer while keeping the right pane dedicated to the actual spell editor.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <Button
                  type="button"
                  variant="outline"
                  className="gap-2 border-gold/20 bg-background/40 text-ink hover:bg-gold/5"
                  onClick={resetForm}
                >
                  <Plus className="h-4 w-4" />
                  New Spell
                </Button>
              </div>
            </div>
          </div>

          <div className="grid gap-6 p-6 xl:grid-cols-[360px_minmax(0,1fr)]">
            <div className="space-y-4">
              <div className="space-y-1">
                <Label className="text-xs font-bold uppercase tracking-widest text-ink/40">Search</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink/30" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search spell name, source, or identifier"
                    className="bg-background/50 border-gold/10 pl-9 focus:border-gold"
                  />
                </div>
              </div>

              <Card className="border-gold/10 bg-background/20">
                <CardContent className="p-0">
                  <div className="border-b border-gold/10 px-4 py-3 text-[10px] font-bold uppercase tracking-[0.2em] text-gold/70">
                    Spell Drafts
                  </div>
                  <div className="max-h-[78vh] space-y-2 overflow-y-auto custom-scrollbar p-3 pr-2">
                    {loading ? (
                      <div className="px-3 py-8 text-sm text-ink/40 italic">Loading...</div>
                    ) : filteredEntries.length === 0 ? (
                      <div className="px-3 py-8 text-sm text-ink/40 italic">No spells match the current search.</div>
                    ) : (
                      <VirtualizedList
                        items={filteredEntries}
                        height={MANAGER_LIST_HEIGHT}
                        itemHeight={MANAGER_ROW_HEIGHT}
                        className="custom-scrollbar overflow-y-auto"
                        innerClassName="space-y-2"
                        renderItem={(entry: SpellSummaryRecord) => {
                          const selected = entry.id === editingId;
                          const sourceLabel = String(sourceNameById[entry.sourceId] || entry.sourceId || 'Unknown Source');
                          return (
                            <button
                              type="button"
                              key={entry.id}
                              onClick={() => startEditing(entry)}
                              className={cn(
                                'h-[94px] w-full rounded-xl border p-3 text-left transition-colors',
                                selected
                                  ? 'border-gold/50 bg-gold/10 shadow-[0_0_0_1px_rgba(192,160,96,0.2)]'
                                  : 'border-gold/10 bg-background/30 hover:border-gold/30 hover:bg-background/50'
                              )}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <div className="font-serif text-lg text-ink">{entry.name || '(Untitled Spell)'}</div>
                                  <div className="text-[10px] uppercase tracking-[0.2em] text-gold/70">
                                    {Number(entry.level ?? 0) === 0 ? 'Cantrip' : `Level ${entry.level ?? 0}`} {SCHOOL_LABELS[String(entry.school ?? '')] || String(entry.school ?? '').toUpperCase()}
                                  </div>
                                </div>
                                <span className="text-[10px] font-mono text-ink/35">{sourceLabel}</span>
                              </div>

                              <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-ink/55">
                                <span>{PREPARATION_MODES.find(([value]) => value === 'spell')?.[1] || 'Spell'}</span>
                                <span className="text-right font-mono">{entry.identifier || '(no identifier)'}</span>
                              </div>
                            </button>
                          );
                        }}
                      />
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card className="border-gold/20 bg-card/50">
              <CardContent className="p-0">
                <div className="border-b border-gold/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.02),transparent)] px-6 py-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-2">
                      <div className="flex items-center gap-3">
                        <h3 className="font-serif text-4xl font-bold text-ink">
                          {editingId ? (formData.name || 'Untitled Spell') : 'New Spell'}
                        </h3>
                        {formData.sourceId ? (
                          <span className="rounded border border-gold/20 bg-gold/10 px-2 py-1 text-xs text-gold">
                            {String(sourceNameById[formData.sourceId] || formData.sourceId)}
                          </span>
                        ) : null}
                      </div>
                      <p className="font-serif italic text-ink/70">
                        {Number(formData.level ?? 0) === 0 ? 'Cantrip' : `Level ${formData.level ?? 0}`}{' '}
                        {SCHOOL_LABELS[String(formData.school ?? '')] || String(formData.school ?? '').toUpperCase()}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {editingId ? (
                        <Button
                          type="button"
                          variant="outline"
                          className="gap-2 border-blood/30 text-blood hover:bg-blood/10"
                          onClick={handleDelete}
                        >
                          <Trash2 className="h-4 w-4" />
                          Delete Spell
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        variant="outline"
                        className="gap-2 border-gold/20 bg-background/40 text-ink hover:bg-gold/5"
                        onClick={resetForm}
                      >
                        <Edit3 className="h-4 w-4" />
                        Reset
                      </Button>
                      <Button
                        type="submit"
                        form="spell-manual-editor-form"
                        className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground"
                        disabled={saving}
                      >
                        <Save className="h-4 w-4" />
                        {saving ? 'Saving...' : editingId ? 'Update Spell' : 'Save Spell'}
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="max-h-[78vh] overflow-y-auto custom-scrollbar px-6 py-5">
                  <form id="spell-manual-editor-form" onSubmit={handleSave} className="space-y-6">
                    <div className="grid gap-6 lg:grid-cols-[126px_minmax(0,1fr)]">
                      <ImageUpload
                        currentImageUrl={formData.imageUrl}
                        storagePath={`images/spells/${editingId || 'draft'}/`}
                        onUpload={(url) => setFormData(prev => ({ ...prev, imageUrl: url }))}
                        imageType="icon"
                        compact
                        className="h-[126px] w-[126px]"
                      />

                      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                        <div className="space-y-1">
                          <Label className="text-xs font-bold uppercase tracking-widest text-ink/40">Name</Label>
                          <Input
                            value={formData.name}
                            onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
                            className="bg-background/50 border-gold/10 focus:border-gold"
                            placeholder="e.g. Fireball"
                            required
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs font-bold uppercase tracking-widest text-ink/40">Identifier</Label>
                          <Input
                            value={formData.identifier}
                            onChange={e => setFormData(prev => ({ ...prev, identifier: e.target.value }))}
                            className="bg-background/50 border-gold/10 focus:border-gold font-mono"
                            placeholder={slugify(formData.name || 'spell')}
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
                        <div className="space-y-1">
                          <Label className="text-xs font-bold uppercase tracking-widest text-ink/40">Level</Label>
                          <Input
                            type="number"
                            min={0}
                            max={9}
                            value={formData.level ?? 0}
                            onChange={e => setFormData(prev => ({ ...prev, level: parseInt(e.target.value || '0', 10) || 0 }))}
                            className="bg-background/50 border-gold/10 focus:border-gold"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs font-bold uppercase tracking-widest text-ink/40">School</Label>
                          <select
                            value={formData.school || 'evo'}
                            onChange={e => setFormData(prev => ({ ...prev, school: e.target.value }))}
                            className="w-full h-10 px-3 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-sm"
                          >
                            {SPELL_SCHOOLS.map(([value, label]) => (
                              <option key={value} value={value}>{label}</option>
                            ))}
                          </select>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs font-bold uppercase tracking-widest text-ink/40">Preparation Mode</Label>
                          <select
                            value={formData.preparationMode || 'spell'}
                            onChange={e => setFormData(prev => ({ ...prev, preparationMode: e.target.value }))}
                            className="w-full h-10 px-3 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-sm"
                          >
                            {PREPARATION_MODES.map(([value, label]) => (
                              <option key={value} value={value}>{label}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>

                    <MarkdownEditor
                      key={editingId || 'new-spell'}
                      value={formData.description}
                      onChange={value => setFormData(prev => ({ ...prev, description: value }))}
                      label="Description"
                      placeholder="Describe the spell in player-facing terms. Activities should carry runtime mechanics."
                      minHeight="300px"
                      autoSizeToContent={false}
                    />

                    <div className="space-y-4 border border-gold/10 rounded-md p-4 bg-background/20">
                      <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-gold">Foundry Spell Shell</h3>
                      <div className="grid md:grid-cols-2 gap-4">
                        <label className="flex items-center justify-between gap-3 border border-gold/10 rounded-md p-3">
                          <span className="text-xs font-bold uppercase tracking-widest text-ink/60">Ritual</span>
                          <Checkbox
                            checked={!!formData.ritual}
                            onCheckedChange={checked => setFormData(prev => ({ ...prev, ritual: !!checked }))}
                          />
                        </label>
                        <label className="flex items-center justify-between gap-3 border border-gold/10 rounded-md p-3">
                          <span className="text-xs font-bold uppercase tracking-widest text-ink/60">Concentration</span>
                          <Checkbox
                            checked={!!formData.concentration}
                            onCheckedChange={checked => setFormData(prev => ({ ...prev, concentration: !!checked }))}
                          />
                        </label>
                      </div>

                      <div className="space-y-3">
                        <h4 className="text-xs font-bold uppercase tracking-widest text-ink/60">Components</h4>
                        <div className="grid md:grid-cols-3 gap-4">
                          <label className="flex items-center justify-between gap-3 border border-gold/10 rounded-md p-3">
                            <span className="text-xs uppercase text-ink/60 font-bold">Verbal</span>
                            <Checkbox
                              checked={!!formData.components?.vocal}
                              onCheckedChange={checked => setFormData(prev => ({
                                ...prev,
                                components: mergeSpellComponents(prev.components, { vocal: !!checked })
                              }))}
                            />
                          </label>
                          <label className="flex items-center justify-between gap-3 border border-gold/10 rounded-md p-3">
                            <span className="text-xs uppercase text-ink/60 font-bold">Somatic</span>
                            <Checkbox
                              checked={!!formData.components?.somatic}
                              onCheckedChange={checked => setFormData(prev => ({
                                ...prev,
                                components: mergeSpellComponents(prev.components, { somatic: !!checked })
                              }))}
                            />
                          </label>
                          <label className="flex items-center justify-between gap-3 border border-gold/10 rounded-md p-3">
                            <span className="text-xs uppercase text-ink/60 font-bold">Material</span>
                            <Checkbox
                              checked={!!formData.components?.material}
                              onCheckedChange={checked => setFormData(prev => ({
                                ...prev,
                                components: mergeSpellComponents(prev.components, { material: !!checked })
                              }))}
                            />
                          </label>
                        </div>
                        <div className="grid md:grid-cols-2 gap-4">
                          <div className="space-y-1">
                            <Label className="text-xs font-bold uppercase tracking-widest text-ink/40">Material Text</Label>
                            <Input
                              value={formData.components?.materialText || ''}
                              onChange={e => setFormData(prev => ({
                                ...prev,
                                components: mergeSpellComponents(prev.components, { materialText: e.target.value })
                              }))}
                              className="bg-background/50 border-gold/10 focus:border-gold"
                              placeholder="a tiny ball of bat guano and sulfur"
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            <label className="flex items-center justify-between gap-3 border border-gold/10 rounded-md p-3">
                              <span className="text-xs uppercase text-ink/60 font-bold">Consumed</span>
                              <Checkbox
                                checked={!!formData.components?.consumed}
                                onCheckedChange={checked => setFormData(prev => ({
                                  ...prev,
                                  components: mergeSpellComponents(prev.components, { consumed: !!checked })
                                }))}
                              />
                            </label>
                            <div className="space-y-1">
                              <Label className="text-xs font-bold uppercase tracking-widest text-ink/40">Cost</Label>
                              <Input
                                value={formData.components?.cost || ''}
                                onChange={e => setFormData(prev => ({
                                  ...prev,
                                  components: mergeSpellComponents(prev.components, { cost: e.target.value })
                                }))}
                                className="bg-background/50 border-gold/10 focus:border-gold"
                                placeholder="100 gp"
                              />
                            </div>
                          </div>
                        </div>
                        <p className="text-[10px] text-ink/40">
                          Spell metadata should stay lightweight here. Runtime behavior should live in native-style activities below.
                        </p>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="border-t border-gold/10 pt-4">
                        <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-gold mb-2">Activities</h3>
                        <ActivityEditor
                          activities={formData.activities}
                          onChange={(activities) => setFormData(prev => ({ ...prev, activities }))}
                          context="spell"
                        />
                      </div>

                      <div className="space-y-1">
                        <Label className="text-xs font-bold uppercase tracking-widest text-ink/40">Effects (JSON)</Label>
                        <textarea
                          value={formData.effectsStr}
                          onChange={e => setFormData(prev => ({ ...prev, effectsStr: e.target.value }))}
                          className="w-full min-h-[160px] rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-xs font-mono p-3 custom-scrollbar"
                          placeholder="[]"
                        />
                        <p className="text-[10px] text-ink/40">
                          Raw effect scaffolding for now. Activities should be the primary runtime surface, with effects for persistent states and automation support.
                        </p>
                      </div>
                    </div>
                  </form>
                </div>
              </CardContent>
            </Card>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

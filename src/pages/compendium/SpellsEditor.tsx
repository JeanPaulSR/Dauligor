import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronLeft, ChevronRight, Edit3, Plus, Save, Search, Trash2, Wand2, X } from 'lucide-react';
import { toast } from 'sonner';
import SpellImportWorkbench from '../../components/compendium/SpellImportWorkbench';
import ActivityEditor from '../../components/compendium/ActivityEditor';
import ActiveEffectEditor from '../../components/compendium/ActiveEffectEditor';
import MarkdownEditor from '../../components/MarkdownEditor';
import { reportClientError, OperationType } from '../../lib/firebase';
import { upsertSpell, deleteSpell, fetchSpell } from '../../lib/compendium';
import { fetchCollection } from '../../lib/d1';
import { orderTagsAsTree, normalizeTagRow } from '../../lib/tagHierarchy';
import { slugify } from '../../lib/utils';
import { bbcodeToHtml } from '../../lib/bbcode';
import { Database, CloudOff } from 'lucide-react';
import { SCHOOL_LABELS } from '../../lib/spellImport';
import { parseFoundrySystem as parseFoundrySystemForEditor } from '../../lib/spellFilters';
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
  // Item-level Active Effects authored through the shared
  // `<ActiveEffectEditor>` — same component class features, feats, and
  // option items use. Stored as a parsed array on the form; the
  // `spells.effects` column round-trips as a JSON string at the d1
  // layer.
  effects: any[];
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
  // Foundry system shape — carry these on the form so they can be authored manually,
  // not just inherited from a Foundry import. On save they are merged into foundry_data.
  activation: { type: string; value: number | string; condition: string };
  range: { value: number | string; units: string; special: string };
  duration: { value: number | string; units: string };
  // dnd5e 5.x splits target into `template` (AoE shape) + `affects`
  // (who/what is targeted). Both are optional — touch spells leave
  // both empty, AoE spells fill `template`, single-target spells fill
  // `affects`. See `docs/database/structure/tags.md` peer files for
  // the round-trip pattern. Stored under foundry_data.target.
  target: {
    template: { type: string; size: string; width: string; height: string; units: string };
    affects: { type: string; count: string; choice: boolean; special: string };
  };
  // Limited-use spells (artifact-bound, once-per-day homebrew, etc.).
  // `recovery` is an array of period rows — empty for unlimited-use
  // (the common case). Stored under foundry_data.uses.
  uses: {
    max: string;
    recovery: { period: string; type: string; formula: string }[];
  };
  // Descriptive tags — what classifies the spell (e.g. "fire", "divine",
  // "necrotic"). Spell rules + class spell list rules query against these.
  // Stored on the spells.tags JSON column.
  tags: string[];
  // Prerequisites — character-level gates. requiredTags is checked against the
  // character's effective tag set. prerequisiteText is a free-text fallback for
  // prereqs that don't fit cleanly as a tag check.
  requiredTags: string[];
  prerequisiteText: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: any;
};

const ACTIVATION_TYPES: [string, string][] = [
  ['action', 'Action'],
  ['bonus', 'Bonus Action'],
  ['reaction', 'Reaction'],
  ['minute', 'Minute(s)'],
  ['hour', 'Hour(s)'],
  ['special', 'Special'],
];

const RANGE_UNITS: [string, string][] = [
  ['self', 'Self'],
  ['touch', 'Touch'],
  ['ft', 'Feet'],
  ['mi', 'Miles'],
  ['spec', 'Special'],
  ['any', 'Unlimited'],
];

const DURATION_UNITS: [string, string][] = [
  ['inst', 'Instantaneous'],
  ['round', 'Round(s)'],
  ['minute', 'Minute(s)'],
  ['hour', 'Hour(s)'],
  ['day', 'Day(s)'],
  ['perm', 'Permanent'],
  ['spec', 'Special'],
];

const SPELL_DEFAULTS: Omit<SpellFormData, 'sourceId'> & { sourceId?: string } = {
  name: '',
  identifier: '',
  sourceId: '',
  imageUrl: '',
  description: '',
  activities: [],
  effects: [],
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
  },
  activation: { type: 'action', value: 1, condition: '' },
  range: { value: 0, units: 'self', special: '' },
  duration: { value: 0, units: 'inst' },
  target: {
    template: { type: '', size: '', width: '', height: '', units: 'ft' },
    affects: { type: '', count: '', choice: false, special: '' },
  },
  uses: { max: '', recovery: [] },
  tags: [],
  requiredTags: [],
  prerequisiteText: '',
};

function parseStringArray(raw: any): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

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
  const [tags, setTags] = useState<{ id: string; name: string; groupId: string | null; parentTagId: string | null }[]>([]);
  const [tagGroups, setTagGroups] = useState<{ id: string; name: string }[]>([]);
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

    // Load tags + tag groups for the prerequisites picker. Spell-classified groups
    // are the ones that semantically apply to spells; restricting the picker keeps
    // it from being polluted by class-only or lore-only tag groups.
    const loadTagFoundation = async () => {
      try {
        const [tagData, groupData] = await Promise.all([
          fetchCollection<any>('tags', { orderBy: 'name ASC' }),
          fetchCollection<any>('tagGroups', { where: "classifications LIKE '%spell%'" }),
        ]);
        setTags(tagData.map(normalizeTagRow));
        setTagGroups(groupData.map((g: any) => ({ id: g.id, name: g.name || 'Tags' })));
      } catch (err) {
        console.error("[SpellsEditor] Error loading tag foundation:", err);
      }
    };

    loadTagFoundation();
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
      const system = parseFoundrySystemForEditor(entry.foundry_data ?? entry.foundryData);
      const defaults = makeInitialSpellForm(sources);
      setFormData({
        ...defaults,
        ...entry,
        id: entry.id,
        sourceId: entry.sourceId || sources[0]?.id || '',
        activities: Array.isArray(entry.automation?.activities)
          ? entry.automation.activities
          : Array.isArray(entry.activities)
            ? entry.activities
            : [],
        // Effects round-trip as a JSON-encoded array on the
        // `spells.effects` column. Accept either a pre-parsed array
        // (e.g. from automation.effects) or a JSON string (raw column
        // value). Same parse pattern FeatsEditor uses.
        effects: Array.isArray(entry.automation?.effects)
          ? entry.automation.effects
          : Array.isArray(entry.effects)
            ? entry.effects
            : parseStringArray(entry.effects).length
              ? parseStringArray(entry.effects)
              : (() => { try { const v = JSON.parse(entry.effects ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; } })(),
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
        },
        activation: {
          type: String(system?.activation?.type ?? defaults.activation.type),
          value: system?.activation?.value ?? defaults.activation.value,
          condition: String(system?.activation?.condition ?? ''),
        },
        range: {
          value: system?.range?.value ?? defaults.range.value,
          units: String(system?.range?.units ?? defaults.range.units),
          special: String(system?.range?.special ?? ''),
        },
        duration: {
          value: system?.duration?.value ?? defaults.duration.value,
          units: String(system?.duration?.units ?? defaults.duration.units),
        },
        target: {
          template: {
            type:   String(system?.target?.template?.type   ?? ''),
            size:   String(system?.target?.template?.size   ?? ''),
            width:  String(system?.target?.template?.width  ?? ''),
            height: String(system?.target?.template?.height ?? ''),
            units:  String(system?.target?.template?.units  ?? 'ft'),
          },
          affects: {
            type:    String(system?.target?.affects?.type    ?? ''),
            count:   String(system?.target?.affects?.count   ?? ''),
            choice:  !!system?.target?.affects?.choice,
            special: String(system?.target?.affects?.special ?? ''),
          },
        },
        uses: {
          max: String(system?.uses?.max ?? ''),
          recovery: Array.isArray(system?.uses?.recovery) ? system.uses.recovery : [],
        },
        tags: parseStringArray(entry.tags ?? entry.tagIds),
        requiredTags: parseStringArray(entry.requiredTags ?? entry.required_tags),
        prerequisiteText: String(entry.prerequisiteText ?? entry.prerequisite_text ?? ''),
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

    setSaving(true);
    try {
      // Merge new casting/range/duration/target/uses values into the
      // existing foundry_data system object so we don't clobber other
      // Foundry-only fields (materials, properties set, etc.) when an
      // imported spell is edited from the manual form.
      const existingSystem = editingId
        ? (parseFoundrySystemForEditor(spellDetailsById[editingId]?.foundry_data ?? spellDetailsById[editingId]?.foundryData) || {})
        : {};
      // Mirror the BBCode description back into the Foundry-shape description.value
      // as HTML so that next time the pairing module reads this spell (or the actor
      // bundle re-exports it) Foundry receives the user's edits. The app itself
      // reads `description` (BBCode) for display — this is purely the round-trip
      // payload. See docs/features/compendium-spells.md.
      const descriptionHtmlForFoundry = bbcodeToHtml(String(formData.description || ''));

      const mergedFoundryData = {
        ...existingSystem,
        description: {
          ...(existingSystem.description || {}),
          value: descriptionHtmlForFoundry,
        },
        activation: { ...(existingSystem.activation || {}), ...formData.activation },
        range:      { ...(existingSystem.range      || {}), ...formData.range      },
        duration:   { ...(existingSystem.duration   || {}), ...formData.duration   },
        target: {
          ...(existingSystem.target || {}),
          template: { ...((existingSystem.target || {}).template || {}), ...formData.target.template },
          affects:  { ...((existingSystem.target || {}).affects  || {}), ...formData.target.affects  },
        },
        uses: {
          ...(existingSystem.uses || {}),
          max:      formData.uses.max,
          recovery: formData.uses.recovery,
        },
      };

      const effectsArr = Array.isArray(formData.effects) ? formData.effects : [];

      const payload: Record<string, any> = {
        ...formData,
        identifier: formData.identifier.trim() || slugify(formData.name),
        automation: {
          activities: Array.isArray(formData.activities)
            ? formData.activities
            : Object.values(formData.activities || {}),
          effects: effectsArr,
        },
        updatedAt: new Date().toISOString(),
        status: 'development',
        sourceType: 'spell',
        type: 'spell',
        level: Number(formData.level || 0),
        preparationMode: formData.preparationMode || 'spell',
        foundry_data: mergedFoundryData,
      };

      delete payload.id;
      delete payload.activities;
      // effects is delivered via `automation.effects`; the d1 layer
      // round-trips it onto `spells.effects` as JSON. Drop the
      // top-level copy so we don't write the same data twice.
      delete payload.effects;
      // These live in foundry_data, not as top-level columns on the spells table.
      delete payload.activation;
      delete payload.range;
      delete payload.duration;
      delete payload.target;
      delete payload.uses;

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
                {/* Form is segmented into Tabs so admins can jump
                  * between sections (Basics, Description, Mechanics,
                  * Activities, Tags & Prereqs) instead of scrolling
                  * past everything. The header (title + Save buttons)
                  * stays mounted above the tab list so save is always
                  * one click away regardless of which tab is showing.
                  *
                  * Inactive TabsContent unmounts by default in Radix;
                  * the form's `onSubmit` reads from `formData` state
                  * (every input is controlled), so unmounted fields
                  * still contribute on save. No need for forceMount. */}
                <Tabs defaultValue="basics" className="flex flex-col">
                <div className="border-b border-gold/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.02),transparent)] px-6 py-5 space-y-4">
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
                  <TabsList variant="line" className="gap-2 bg-transparent p-0">
                    <TabsTrigger value="basics"     className="rounded-md border border-gold/15 bg-background/30 px-3 py-1.5 text-xs uppercase tracking-[0.18em] text-ink/65 data-active:border-gold/40 data-active:bg-gold/10 data-active:text-gold">Basics</TabsTrigger>
                    <TabsTrigger value="mechanics"  className="rounded-md border border-gold/15 bg-background/30 px-3 py-1.5 text-xs uppercase tracking-[0.18em] text-ink/65 data-active:border-gold/40 data-active:bg-gold/10 data-active:text-gold">Mechanics</TabsTrigger>
                    <TabsTrigger value="activities" className="rounded-md border border-gold/15 bg-background/30 px-3 py-1.5 text-xs uppercase tracking-[0.18em] text-ink/65 data-active:border-gold/40 data-active:bg-gold/10 data-active:text-gold">Activities</TabsTrigger>
                    <TabsTrigger value="effects"    className="rounded-md border border-gold/15 bg-background/30 px-3 py-1.5 text-xs uppercase tracking-[0.18em] text-ink/65 data-active:border-gold/40 data-active:bg-gold/10 data-active:text-gold">Effects</TabsTrigger>
                    <TabsTrigger value="tags"       className="rounded-md border border-gold/15 bg-background/30 px-3 py-1.5 text-xs uppercase tracking-[0.18em] text-ink/65 data-active:border-gold/40 data-active:bg-gold/10 data-active:text-gold">Tags & Prereqs</TabsTrigger>
                  </TabsList>
                </div>

                <div className="max-h-[78vh] overflow-y-auto custom-scrollbar px-6 py-5">
                  <form id="spell-manual-editor-form" onSubmit={handleSave} className="space-y-6">
                  <TabsContent value="basics" className="mt-0 space-y-6">
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

                    {/* Description lives inside Basics — the page has
                      * enough vertical room and keeping it adjacent to
                      * name/identifier matches how the Foundry sheet's
                      * Description tab is the first thing you see. */}
                    <MarkdownEditor
                      key={editingId || 'new-spell'}
                      value={formData.description}
                      onChange={value => setFormData(prev => ({ ...prev, description: value }))}
                      label="Description"
                      placeholder="Describe the spell in player-facing terms. Activities should carry runtime mechanics."
                      minHeight="300px"
                      autoSizeToContent={false}
                    />
                  </TabsContent>

                  <TabsContent value="mechanics" className="mt-0 space-y-6">
                    <div className="space-y-4 border border-gold/10 rounded-md p-4 bg-background/20">
                      <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-gold">Casting · Range · Duration</h3>
                      <div className="grid gap-4 lg:grid-cols-3">
                        <div className="space-y-2">
                          <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/60">Casting Time</Label>
                          <div className="grid grid-cols-[1fr_70px] gap-2">
                            <select
                              value={formData.activation.type || 'action'}
                              onChange={e => setFormData(prev => ({ ...prev, activation: { ...prev.activation, type: e.target.value } }))}
                              className="h-9 px-2 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-sm"
                            >
                              {ACTIVATION_TYPES.map(([value, label]) => (
                                <option key={value} value={value}>{label}</option>
                              ))}
                            </select>
                            <Input
                              type="number"
                              min={0}
                              value={String(formData.activation.value ?? '')}
                              onChange={e => setFormData(prev => ({ ...prev, activation: { ...prev.activation, value: e.target.value === '' ? '' : Number(e.target.value) } }))}
                              className="h-9 bg-background/50 border-gold/10 focus:border-gold"
                            />
                          </div>
                          <Input
                            value={formData.activation.condition || ''}
                            onChange={e => setFormData(prev => ({ ...prev, activation: { ...prev.activation, condition: e.target.value } }))}
                            placeholder="Reaction trigger (optional)"
                            className="h-9 bg-background/50 border-gold/10 focus:border-gold text-xs"
                          />
                        </div>

                        <div className="space-y-2">
                          <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/60">Range</Label>
                          <div className="grid grid-cols-[1fr_70px] gap-2">
                            <select
                              value={formData.range.units || 'self'}
                              onChange={e => setFormData(prev => ({ ...prev, range: { ...prev.range, units: e.target.value } }))}
                              className="h-9 px-2 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-sm"
                            >
                              {RANGE_UNITS.map(([value, label]) => (
                                <option key={value} value={value}>{label}</option>
                              ))}
                            </select>
                            <Input
                              type="number"
                              min={0}
                              value={String(formData.range.value ?? '')}
                              onChange={e => setFormData(prev => ({ ...prev, range: { ...prev.range, value: e.target.value === '' ? '' : Number(e.target.value) } }))}
                              disabled={formData.range.units === 'self' || formData.range.units === 'touch'}
                              className="h-9 bg-background/50 border-gold/10 focus:border-gold disabled:opacity-50"
                            />
                          </div>
                          <Input
                            value={formData.range.special || ''}
                            onChange={e => setFormData(prev => ({ ...prev, range: { ...prev.range, special: e.target.value } }))}
                            placeholder='e.g. "Sight" (optional)'
                            className="h-9 bg-background/50 border-gold/10 focus:border-gold text-xs"
                          />
                        </div>

                        <div className="space-y-2">
                          <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/60">Duration</Label>
                          <div className="grid grid-cols-[1fr_70px] gap-2">
                            <select
                              value={formData.duration.units || 'inst'}
                              onChange={e => setFormData(prev => ({ ...prev, duration: { ...prev.duration, units: e.target.value } }))}
                              className="h-9 px-2 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-sm"
                            >
                              {DURATION_UNITS.map(([value, label]) => (
                                <option key={value} value={value}>{label}</option>
                              ))}
                            </select>
                            <Input
                              type="number"
                              min={0}
                              value={String(formData.duration.value ?? '')}
                              onChange={e => setFormData(prev => ({ ...prev, duration: { ...prev.duration, value: e.target.value === '' ? '' : Number(e.target.value) } }))}
                              disabled={formData.duration.units === 'inst' || formData.duration.units === 'perm' || formData.duration.units === 'spec'}
                              className="h-9 bg-background/50 border-gold/10 focus:border-gold disabled:opacity-50"
                            />
                          </div>
                        </div>
                      </div>
                    </div>

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

                    {/* Target — AoE templates + creature affects.
                      * Two distinct sub-shapes per dnd5e 5.x schema:
                      *   - template.{type,size,width,height,units}
                      *   - affects.{type,count,choice,special}
                      * See `item-spell-spell-fire-shield.json` in the
                      * Foundry-JSON samples for the round-trip shape. */}
                    <div className="space-y-4 border border-gold/10 rounded-md p-4 bg-background/20">
                      <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-gold">Target</h3>
                      <div className="grid gap-4 lg:grid-cols-2">
                        <div className="space-y-2">
                          <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/60">Area Template</Label>
                          <div className="grid grid-cols-[1fr_70px] gap-2">
                            <select
                              value={formData.target.template.type || ''}
                              onChange={e => setFormData(prev => ({ ...prev, target: { ...prev.target, template: { ...prev.target.template, type: e.target.value } } }))}
                              className="h-9 px-2 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-sm"
                            >
                              <option value="">None</option>
                              <option value="cone">Cone</option>
                              <option value="cube">Cube</option>
                              <option value="cylinder">Cylinder</option>
                              <option value="line">Line</option>
                              <option value="radius">Radius</option>
                              <option value="sphere">Sphere</option>
                              <option value="square">Square</option>
                              <option value="wall">Wall</option>
                            </select>
                            <select
                              value={formData.target.template.units || 'ft'}
                              onChange={e => setFormData(prev => ({ ...prev, target: { ...prev.target, template: { ...prev.target.template, units: e.target.value } } }))}
                              className="h-9 px-2 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-xs"
                              disabled={!formData.target.template.type}
                            >
                              <option value="ft">ft</option>
                              <option value="mi">mi</option>
                              <option value="m">m</option>
                              <option value="km">km</option>
                            </select>
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            <Input
                              value={String(formData.target.template.size ?? '')}
                              onChange={e => setFormData(prev => ({ ...prev, target: { ...prev.target, template: { ...prev.target.template, size: e.target.value } } }))}
                              placeholder="Size"
                              disabled={!formData.target.template.type}
                              className="h-9 bg-background/50 border-gold/10 focus:border-gold disabled:opacity-50 text-xs"
                            />
                            <Input
                              value={String(formData.target.template.width ?? '')}
                              onChange={e => setFormData(prev => ({ ...prev, target: { ...prev.target, template: { ...prev.target.template, width: e.target.value } } }))}
                              placeholder="Width"
                              disabled={!['line', 'wall'].includes(formData.target.template.type)}
                              className="h-9 bg-background/50 border-gold/10 focus:border-gold disabled:opacity-50 text-xs"
                            />
                            <Input
                              value={String(formData.target.template.height ?? '')}
                              onChange={e => setFormData(prev => ({ ...prev, target: { ...prev.target, template: { ...prev.target.template, height: e.target.value } } }))}
                              placeholder="Height"
                              disabled={!['cylinder', 'wall'].includes(formData.target.template.type)}
                              className="h-9 bg-background/50 border-gold/10 focus:border-gold disabled:opacity-50 text-xs"
                            />
                          </div>
                        </div>

                        <div className="space-y-2">
                          <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/60">Affects</Label>
                          <div className="grid grid-cols-[1fr_70px] gap-2">
                            <select
                              value={formData.target.affects.type || ''}
                              onChange={e => setFormData(prev => ({ ...prev, target: { ...prev.target, affects: { ...prev.target.affects, type: e.target.value } } }))}
                              className="h-9 px-2 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-sm"
                            >
                              <option value="">None</option>
                              <option value="self">Self</option>
                              <option value="creature">Creature</option>
                              <option value="enemy">Enemy</option>
                              <option value="ally">Ally</option>
                              <option value="object">Object</option>
                              <option value="space">Space</option>
                            </select>
                            <Input
                              value={String(formData.target.affects.count ?? '')}
                              onChange={e => setFormData(prev => ({ ...prev, target: { ...prev.target, affects: { ...prev.target.affects, count: e.target.value } } }))}
                              placeholder="Count"
                              disabled={!formData.target.affects.type || formData.target.affects.type === 'self'}
                              className="h-9 bg-background/50 border-gold/10 focus:border-gold disabled:opacity-50 text-xs"
                            />
                          </div>
                          <label className="flex items-center justify-between gap-3 border border-gold/10 rounded-md p-2.5">
                            <span className="text-[10px] uppercase text-ink/60 font-bold tracking-widest">Caster chooses</span>
                            <Checkbox
                              checked={!!formData.target.affects.choice}
                              onCheckedChange={checked => setFormData(prev => ({ ...prev, target: { ...prev.target, affects: { ...prev.target.affects, choice: !!checked } } }))}
                            />
                          </label>
                          <Input
                            value={formData.target.affects.special || ''}
                            onChange={e => setFormData(prev => ({ ...prev, target: { ...prev.target, affects: { ...prev.target.affects, special: e.target.value } } }))}
                            placeholder='Special override (e.g. "any number")'
                            className="h-9 bg-background/50 border-gold/10 focus:border-gold text-xs"
                          />
                        </div>
                      </div>
                      <p className="text-[10px] text-ink/40">
                        Touch / self spells can leave both blank. AoE spells use Template; single-target spells use Affects.
                      </p>
                    </div>

                    {/* Limited Uses — rare for spells but real for
                      * artifact-bound or once-per-day homebrew. Just
                      * `max` for now; recovery rows can be authored on
                      * the Foundry side until we need them in this
                      * editor too. */}
                    <div className="space-y-4 border border-gold/10 rounded-md p-4 bg-background/20">
                      <div className="flex items-baseline justify-between">
                        <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-gold">Limited Uses</h3>
                        <span className="text-[10px] text-ink/40">Optional — leave blank for unlimited.</span>
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="space-y-1">
                          <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/60">Max (formula or number)</Label>
                          <Input
                            value={formData.uses.max || ''}
                            onChange={e => setFormData(prev => ({ ...prev, uses: { ...prev.uses, max: e.target.value } }))}
                            placeholder="e.g. @prof or 3"
                            className="bg-background/50 border-gold/10 focus:border-gold text-xs font-mono"
                          />
                        </div>
                        <p className="text-[10px] text-ink/40 self-end">
                          Recovery period and refresh formula can be authored on the Foundry sheet
                          for now; we round-trip the whole `uses` object through `foundry_data`.
                        </p>
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="tags" className="mt-0 space-y-4">
                    {/* Sub-tabs: Descriptive (what the spell IS) vs.
                      * Prerequisites (what the caster must have).
                      * Same picker shape for both; routes through the
                      * shared <SpellTagPicker> below so the filter +
                      * collapse + selected-summary affordances stay
                      * in sync between the two. Replaces the previous
                      * "show every group twice in one long scroll"
                      * layout that exposed 100+ chips at once. */}
                    <Tabs defaultValue="descriptive" className="space-y-3">
                      <TabsList variant="line" className="gap-2 bg-transparent p-0">
                        <TabsTrigger value="descriptive" className="rounded-md border border-gold/15 bg-background/30 px-3 py-1.5 text-xs uppercase tracking-[0.18em] text-ink/65 data-active:border-gold/40 data-active:bg-gold/10 data-active:text-gold">
                          Descriptive {formData.tags.length > 0 && <span className="ml-1 text-gold/70">({formData.tags.length})</span>}
                        </TabsTrigger>
                        <TabsTrigger value="prereqs" className="rounded-md border border-gold/15 bg-background/30 px-3 py-1.5 text-xs uppercase tracking-[0.18em] text-ink/65 data-active:border-gold/40 data-active:bg-gold/10 data-active:text-gold">
                          Prerequisites {formData.requiredTags.length > 0 && <span className="ml-1 text-gold/70">({formData.requiredTags.length})</span>}
                        </TabsTrigger>
                      </TabsList>

                      <TabsContent value="descriptive" className="mt-0">
                        <SpellTagPicker
                          tags={tags}
                          tagGroups={tagGroups}
                          selectedIds={formData.tags}
                          onChange={(next) => setFormData(prev => ({ ...prev, tags: next }))}
                          hint="Tag rules + class spell list rules use these to decide which spells they include."
                          emptyHint="No tags loaded yet."
                        />
                      </TabsContent>

                      <TabsContent value="prereqs" className="mt-0 space-y-4">
                        <SpellTagPicker
                          tags={tags}
                          tagGroups={tagGroups}
                          selectedIds={formData.requiredTags}
                          onChange={(next) => setFormData(prev => ({ ...prev, requiredTags: next }))}
                          hint="A character must have all selected tags on their effective tag set to use this spell."
                          emptyHint="No tags loaded yet."
                        />
                        <div className="space-y-1 border border-gold/10 rounded-md p-3 bg-background/20">
                          <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/60">Prerequisite Notes</Label>
                          <Input
                            value={formData.prerequisiteText}
                            onChange={e => setFormData(prev => ({ ...prev, prerequisiteText: e.target.value }))}
                            placeholder='e.g. "Must have cast Detect Magic in the past hour"'
                            className="bg-background/50 border-gold/10 focus:border-gold text-xs"
                          />
                          <p className="text-[10px] text-ink/40">
                            Free-text fallback for prereqs that can't be expressed as a tag check. Displayed on the spell card; not machine-checked.
                          </p>
                        </div>
                      </TabsContent>
                    </Tabs>
                  </TabsContent>

                  <TabsContent value="activities" className="mt-0 space-y-6">
                    {/* Same ActivityEditor + availableEffects pattern
                      * that FeatsEditor / ClassEditor / OptionGroup
                      * use, so Apply Effects on save/utility/cast
                      * activities can reference this spell's authored
                      * effects (see Effects tab) by id. */}
                    <div className="border-t border-gold/10 pt-4">
                      <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-gold mb-2">Activities</h3>
                      <ActivityEditor
                        activities={formData.activities}
                        onChange={(activities) => setFormData(prev => ({ ...prev, activities }))}
                        availableEffects={formData.effects}
                        context="spell"
                      />
                    </div>
                  </TabsContent>

                  <TabsContent value="effects" className="mt-0 space-y-6">
                    {/* Item-level Active Effects — replaces the raw
                      * JSON textarea that used to live in Activities.
                      * Routes through `<ActiveEffectEditor>`, the same
                      * authoring surface feats / class features / option
                      * items use. Effects round-trip onto the
                      * `spells.effects` JSON column at the d1 layer. */}
                    <div className="border-t border-gold/10 pt-4">
                      <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-gold mb-2">Active Effects</h3>
                      <ActiveEffectEditor
                        effects={formData.effects}
                        onChange={(effects) => setFormData(prev => ({ ...prev, effects }))}
                        defaultImg={formData.imageUrl || null}
                      />
                    </div>
                  </TabsContent>
                  </form>
                </div>
                </Tabs>
              </CardContent>
            </Card>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// =============================================================================
// SpellTagPicker — collapsible per-group chip picker
// =============================================================================
//
// Replaces the old "show every group's chips inline, twice" layout with a
// focused picker:
//
//   - Single filter input scoped to this picker (matches tag names).
//   - "Selected" summary chip row at the top — quick at-a-glance + one-click
//     remove. Hidden when no selections.
//   - Per-group collapsible sections. Closed by default to avoid overwhelming
//     authors with 100+ chips at once. Auto-open if any tag in the group is
//     currently selected on mount, and force-open while a filter is active
//     so matches don't hide behind a closed group.
//   - Selection-count badge per group header so admins can see at a glance
//     which groups have picks without expanding them.
//
// Used twice inside the Tags tab — once for descriptive tags, once for
// prerequisite tags. Component is pure: it owns its own UI state (filter,
// open-groups) but selection state lives in the parent SpellsEditor's
// formData so the form save path is unchanged.
// =============================================================================

interface SpellTagPickerProps {
  tags: { id: string; name: string; groupId: string | null; parentTagId: string | null }[];
  tagGroups: { id: string; name: string }[];
  selectedIds: string[];
  onChange: (next: string[]) => void;
  hint: string;
  emptyHint: string;
}

function SpellTagPicker({ tags, tagGroups, selectedIds, onChange, hint, emptyHint }: SpellTagPickerProps) {
  const [filter, setFilter] = useState('');
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => {
    // Auto-open every group that has any tag currently selected so
    // editing an existing spell doesn't bury the picks behind closed
    // sections. Computed once on mount; further toggles are user-driven.
    const open = new Set<string>();
    for (const tagId of selectedIds) {
      const tag = tags.find(t => t.id === tagId);
      if (tag?.groupId) open.add(tag.groupId);
    }
    return open;
  });

  const filterTerm = filter.trim().toLowerCase();
  const isFiltering = !!filterTerm;

  const groupData = useMemo(() => {
    return tagGroups
      .map(group => {
        const groupTags = orderTagsAsTree(tags.filter(t => t.groupId === group.id));
        const matching = isFiltering
          ? groupTags.filter(t => String(t.name).toLowerCase().includes(filterTerm))
          : groupTags;
        const selectedInGroup = groupTags.filter(t => selectedIds.includes(t.id)).length;
        return { group, groupTags, matching, selectedInGroup };
      })
      // Hide empty groups always; while filtering, hide groups with no matches.
      .filter(d => d.groupTags.length > 0 && (!isFiltering || d.matching.length > 0));
  }, [tagGroups, tags, isFiltering, filterTerm, selectedIds]);

  const selectedTagsOrdered = useMemo(() => {
    return selectedIds
      .map(id => tags.find(t => t.id === id))
      .filter(Boolean) as { id: string; name: string; parentTagId: string | null }[];
  }, [selectedIds, tags]);

  const toggleGroup = (id: string) => {
    setOpenGroups(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleTag = (tagId: string) => {
    onChange(
      selectedIds.includes(tagId)
        ? selectedIds.filter(id => id !== tagId)
        : [...selectedIds, tagId],
    );
  };

  if (tags.length === 0) {
    return (
      <div className="border border-gold/10 rounded-md p-4 bg-background/20">
        <p className="text-xs text-ink/40 italic">{emptyHint}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 border border-gold/10 rounded-md p-4 bg-background/20">
      {/* Filter row */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink/40" />
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter tags…"
          className="h-8 pl-8 pr-7 text-xs bg-background/50 border-gold/10 focus:border-gold"
        />
        {filter && (
          <button
            type="button"
            onClick={() => setFilter('')}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-ink/40 hover:text-ink"
            title="Clear filter"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Selected summary — only when something is picked */}
      {selectedTagsOrdered.length > 0 && (
        <div className="space-y-1.5">
          <span className="text-[10px] font-bold uppercase tracking-widest text-ink/50">
            Selected ({selectedTagsOrdered.length})
          </span>
          <div className="flex flex-wrap gap-1.5">
            {selectedTagsOrdered.map(tag => (
              <button
                key={tag.id}
                type="button"
                onClick={() => toggleTag(tag.id)}
                className="rounded border border-gold/60 bg-gold/15 text-gold px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide hover:bg-gold/25 inline-flex items-center gap-1"
                title="Remove from selection"
              >
                {tag.parentTagId && <span className="opacity-60">↳</span>}
                {tag.name}
                <X className="w-3 h-3 opacity-70" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Collapsible per-group sections */}
      <div className="space-y-1.5">
        {groupData.length === 0 ? (
          <p className="text-xs text-ink/40 italic">No tags match "{filter}".</p>
        ) : groupData.map(({ group, groupTags, matching, selectedInGroup }) => {
          const isOpen = isFiltering || openGroups.has(group.id);
          const visibleTags = isFiltering ? matching : groupTags;
          return (
            <div key={group.id} className="border border-gold/10 rounded bg-background/30 overflow-hidden">
              <button
                type="button"
                onClick={() => { if (!isFiltering) toggleGroup(group.id); }}
                className={cn(
                  'w-full flex items-center justify-between gap-2 px-3 py-2 text-left transition-colors',
                  isFiltering ? 'cursor-default' : 'hover:bg-gold/5 cursor-pointer',
                )}
              >
                <span className="flex items-center gap-2 min-w-0">
                  {!isFiltering && (
                    isOpen
                      ? <ChevronDown className="w-3.5 h-3.5 text-ink/50 shrink-0" />
                      : <ChevronRight className="w-3.5 h-3.5 text-ink/50 shrink-0" />
                  )}
                  <span className="text-[10px] uppercase tracking-widest font-bold text-ink/70 truncate">
                    {group.name}
                  </span>
                </span>
                <span className="flex items-center gap-2 shrink-0">
                  {selectedInGroup > 0 && (
                    <span className="text-[10px] font-bold tabular-nums bg-gold/15 text-gold border border-gold/30 px-1.5 py-0.5">
                      {selectedInGroup}
                    </span>
                  )}
                  <span className="text-[10px] text-ink/40 tabular-nums">
                    {isFiltering && matching.length !== groupTags.length
                      ? `${matching.length} / ${groupTags.length}`
                      : groupTags.length}
                  </span>
                </span>
              </button>
              {isOpen && (() => {
                // Two-level tree render: each root gets its own row;
                // its subtags (if any) get an indented row below. The
                // earlier flat layout with `↳` glyphs in front of each
                // subtag made for compact rows but hard scanning, since
                // a parent and its subtags interleaved with the next
                // parent on the same line. Stacking by parent is taller
                // but reads as a tree at a glance.
                //
                // `visibleTags` is already ordered roots-first-then-
                // children by orderTagsAsTree, and the filter logic
                // upstream keeps parents in the visible set when a
                // subtag matches. So a visible subtag whose parent
                // ALSO isn't in `visibleTags` is rare (synthetic data
                // / orphaned hierarchy); we surface those at the
                // bottom as an "ungrouped" sub-row so they don't
                // disappear.
                const visibleRoots = visibleTags.filter(t => !t.parentTagId);
                const subtagsByParentId = new Map<string, typeof visibleTags>();
                const visibleRootIds = new Set(visibleRoots.map(r => r.id));
                const orphans: typeof visibleTags = [];
                for (const tag of visibleTags) {
                  if (!tag.parentTagId) continue;
                  if (!visibleRootIds.has(tag.parentTagId)) {
                    orphans.push(tag);
                    continue;
                  }
                  if (!subtagsByParentId.has(tag.parentTagId)) subtagsByParentId.set(tag.parentTagId, []);
                  subtagsByParentId.get(tag.parentTagId)!.push(tag);
                }

                const renderChip = (tag: typeof visibleTags[number]) => {
                  const active = selectedIds.includes(tag.id);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => toggleTag(tag.id)}
                      className={cn(
                        'rounded border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide transition-colors',
                        active
                          ? 'border-gold/60 bg-gold/15 text-gold'
                          : 'border-gold/15 text-ink/55 hover:border-gold/30 hover:text-gold/80',
                      )}
                    >
                      {tag.name}
                    </button>
                  );
                };

                return (
                  <div className="px-3 pb-2.5 pt-1 space-y-1.5">
                    {visibleRoots.map(root => {
                      const subs = subtagsByParentId.get(root.id) ?? [];
                      return (
                        <div key={root.id} className="space-y-1">
                          <div className="flex flex-wrap gap-1.5">{renderChip(root)}</div>
                          {subs.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 pl-5 border-l border-gold/10 ml-1">
                              {subs.map(renderChip)}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {orphans.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pl-5 border-l border-amber-500/20 ml-1">
                        {orphans.map(renderChip)}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          );
        })}
      </div>

      <p className="text-[10px] text-ink/40">{hint}</p>
    </div>
  );
}

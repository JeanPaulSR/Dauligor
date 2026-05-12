import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CloudOff,
  Database,
  Edit3,
  Lock,
  Plus,
  Save,
  Scroll,
  Search,
  Trash2,
  ChevronLeft,
} from 'lucide-react';
import { toast } from 'sonner';
import ActivityEditor from '../../components/compendium/ActivityEditor';
import MarkdownEditor from '../../components/MarkdownEditor';
import RequirementsEditor, { RequirementsEditorLookups } from '../../components/compendium/RequirementsEditor';
import {
  EMPTY_REQUIREMENT_TREE,
  parseRequirementTree,
  serializeRequirementTree,
  formatRequirementText,
  type Requirement,
  type ProficiencyKind,
} from '../../lib/requirements';
import { reportClientError, OperationType } from '../../lib/firebase';
import { upsertFeat, deleteFeat, fetchFeat } from '../../lib/compendium';
import { fetchCollection } from '../../lib/d1';
import { slugify, cn } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Checkbox } from '../../components/ui/checkbox';
import { ImageUpload } from '../../components/ui/ImageUpload';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import VirtualizedList from '../../components/ui/VirtualizedList';

// ─── Constants ──────────────────────────────────────────────────────────

// Feat category enum. These currently map 1:1 to dnd5e 5.x `system.type.value`
// for feat-typed items (with our `classFeature` slug mapping to dnd5e's
// "class feature" subtype on export). We keep the editor's enum narrow —
// the importer can expand the value/subtype pair from this list when it
// wires up the feats round-trip.
const FEAT_TYPES: [string, string][] = [
  ['general', 'General'],
  ['origin', 'Origin'],
  ['fightingStyle', 'Fighting Style'],
  ['epicBoon', 'Epic Boon'],
  ['classFeature', 'Class Feature Style'],
];

// Used by the export pipeline (and eventually the import pipeline) to
// decide which Foundry document shape to mint — most go to a `feat`-typed
// Item; class/subclass-feature variants land as features attached to a
// class instead.
const SOURCE_TYPES: [string, string][] = [
  ['feat', 'Feat'],
  ['classFeature', 'Class Feature'],
  ['subclassFeature', 'Subclass Feature'],
];

// Mirrors the dimensions SpellsEditor uses so the two managers feel
// visually identical at a glance.
const MANAGER_LIST_HEIGHT = 720;
const MANAGER_ROW_HEIGHT = 94;

// ─── Form shape ─────────────────────────────────────────────────────────

type FeatFormData = {
  id?: string;
  name: string;
  identifier: string;
  sourceId: string;
  imageUrl: string;
  description: string;
  featType: string;
  sourceType: string;
  requirements: string;
  repeatable: boolean;
  uses: { max: string; spent: number };
  activities: any[];
  effectsStr: string;
  /**
   * Compound requirement tree authored via `<RequirementsEditor>`. Stored
   * separately from the free-text `requirements` field — the two are
   * surfaced side-by-side so authors can keep the narrative blurb while
   * adding structured leaves the importer (eventual feats import path)
   * can evaluate against the actor.
   */
  requirementsTree: Requirement | null;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: any;
};

const FEAT_DEFAULTS: Omit<FeatFormData, 'sourceId'> & { sourceId?: string } = {
  name: '',
  identifier: '',
  sourceId: '',
  imageUrl: '',
  description: '',
  featType: 'general',
  sourceType: 'feat',
  requirements: '',
  repeatable: false,
  uses: { max: '', spent: 0 },
  activities: [],
  effectsStr: '[]',
  requirementsTree: EMPTY_REQUIREMENT_TREE,
};

function makeInitialFeatForm(sources: any[] = []): FeatFormData {
  return {
    ...FEAT_DEFAULTS,
    sourceId: sources[0]?.id || '',
  } as FeatFormData;
}

// ─── Page ───────────────────────────────────────────────────────────────

export default function FeatsEditor({ userProfile }: { userProfile: any }) {
  const isAdmin = userProfile?.role === 'admin';

  // Entries + UI state
  const [entries, setEntries] = useState<any[]>([]);
  const [featDetailsById, setFeatDetailsById] = useState<Record<string, any>>({});
  const [sources, setSources] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<FeatFormData>(makeInitialFeatForm());
  const [isFoundationUsingD1, setIsFoundationUsingD1] = useState(false);

  // Lookups consumed by <RequirementsEditor>. Same shape + load order as
  // UniqueOptionGroupEditor — every leaf-picker the tree might render
  // (class / subclass / spellRule / optionItem / proficiency) pulls from
  // here. Loaded once on mount in parallel with the feats list itself.
  const [classes, setClasses] = useState<any[]>([]);
  const [subclasses, setSubclasses] = useState<any[]>([]);
  const [spellRules, setSpellRules] = useState<any[]>([]);
  const [allOptionGroups, setAllOptionGroups] = useState<Array<{
    id: string;
    name: string;
    items: Array<{ id: string; name: string }>;
  }>>([]);
  const [proficiencyPools, setProficiencyPools] = useState<
    Partial<Record<ProficiencyKind, Array<{ id: string; name: string; hint?: string }>>>
  >({});

  // Initial load — entries + sources + every RequirementsEditor lookup
  // pool. All in parallel so the page settles in one paint.
  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;

    const loadAll = async () => {
      try {
        const [
          featRows,
          sourceRows,
          classRows,
          subclassRows,
          spellRuleRows,
          optionGroupRows,
          optionItemRows,
          weapons, weaponCategories,
          armor, armorCategories,
          tools, toolCategories,
          skills,
          languages, languageCategories,
        ] = await Promise.all([
          fetchCollection<any>('feats', { orderBy: 'name ASC' }),
          fetchCollection<any>('sources', { orderBy: 'name ASC' }),
          fetchCollection<any>('classes', { orderBy: 'name ASC' }),
          fetchCollection<any>('subclasses', { orderBy: 'name ASC' }),
          fetchCollection<any>('spellRules', { orderBy: 'name ASC' }),
          fetchCollection<any>('uniqueOptionGroups', { orderBy: 'name ASC' }),
          fetchCollection<any>('uniqueOptionItems', { orderBy: 'name ASC' }),
          fetchCollection<any>('weapons', { orderBy: 'name ASC' }),
          fetchCollection<any>('weaponCategories', { orderBy: '"order", name ASC' }),
          fetchCollection<any>('armor', { orderBy: 'name ASC' }),
          fetchCollection<any>('armorCategories', { orderBy: '"order", name ASC' }),
          fetchCollection<any>('tools', { orderBy: 'name ASC' }),
          fetchCollection<any>('toolCategories', { orderBy: '"order", name ASC' }),
          fetchCollection<any>('skills', { orderBy: 'name ASC' }),
          fetchCollection<any>('languages', { orderBy: 'name ASC' }),
          fetchCollection<any>('languageCategories', { orderBy: '"order", name ASC' }),
        ]);
        if (cancelled) return;

        // Map snake_case → camelCase for the list-row render. Same shape
        // SpellsEditor's `mapped` produces. requirementsTree is auto-
        // parsed by d1.ts and arrives as the typed object on the row
        // already, but parse defensively so older rows survive.
        const mapped = featRows.map((row: any) => ({
          ...row,
          sourceId: row.source_id,
          imageUrl: row.image_url,
          featType: row.feat_type,
          sourceType: row.source_type,
          requirementsTree: parseRequirementTree(row.requirements_tree ?? row.requirementsTree),
          tagIds: Array.isArray(row.tags) ? row.tags : [],
        }));
        setEntries(mapped);
        setSources(sourceRows);
        if (sourceRows.length > 0) setIsFoundationUsingD1(true);
        setClasses(classRows);
        setSubclasses(subclassRows);
        setSpellRules(spellRuleRows);

        // Bucket option items into their parent groups — same pattern
        // UniqueOptionGroupEditor uses for the cascading optionItem
        // leaf picker.
        const groupsWithItems = optionGroupRows.map((g: any) => ({
          id: g.id,
          name: g.name,
          items: optionItemRows
            .filter((it: any) => (it.group_id || it.groupId) === g.id)
            .map((it: any) => ({ id: it.id, name: it.name })),
        }));
        setAllOptionGroups(groupsWithItems);

        // Merge per-kind proficiency pools (entries + category rows).
        // The `identifier` column is the Foundry key and what gets
        // stored on the leaf; category rows carry a "Category" hint
        // badge so authors can tell "Martial Weapons" from a specific
        // weapon at a glance.
        const mergeProf = (
          entriesArr: any[],
          categories: any[],
        ): Array<{ id: string; name: string; hint?: string }> => [
          ...entriesArr.map((e: any) => ({ id: e.identifier, name: e.name })),
          ...categories.map((c: any) => ({ id: c.identifier, name: c.name, hint: 'Category' })),
        ];
        setProficiencyPools({
          weapon: mergeProf(weapons, weaponCategories),
          armor: mergeProf(armor, armorCategories),
          tool: mergeProf(tools, toolCategories),
          skill: skills.map((s: any) => ({ id: s.identifier, name: s.name })),
          language: mergeProf(languages, languageCategories),
        });

        setLoading(false);
      } catch (err) {
        console.error('Error loading feats:', err);
        if (!cancelled) {
          setIsFoundationUsingD1(false);
          setLoading(false);
        }
      }
    };

    loadAll();
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  // Pin a default source onto the form once sources have loaded, so a
  // new-feat draft starts with a valid sourceId. SpellsEditor uses the
  // same effect.
  useEffect(() => {
    if (editingId) return;
    if (formData.sourceId || sources.length === 0) return;
    setFormData((prev) => ({ ...prev, sourceId: sources[0].id }));
  }, [editingId, formData.sourceId, sources]);

  const sourceNameById = useMemo(
    () =>
      Object.fromEntries(
        sources.map((source) => [
          source.id,
          source.name || source.abbreviation || source.shortName || source.id,
        ]),
      ),
    [sources],
  );

  const filteredEntries = useMemo(() => {
    const lowered = search.trim().toLowerCase();
    if (!lowered) return entries;
    return entries.filter((entry) => {
      const sourceLabel = String(sourceNameById[entry.sourceId] || '').toLowerCase();
      return (
        String(entry.name || '').toLowerCase().includes(lowered)
        || String(entry.identifier || '').toLowerCase().includes(lowered)
        || String(entry.featType || '').toLowerCase().includes(lowered)
        || sourceLabel.includes(lowered)
      );
    });
  }, [entries, search, sourceNameById]);

  // Lookup the RequirementsEditor + the list-row prereq summary share.
  // Built once per dependency change so the renderItem callback below
  // doesn't recompute it on every scroll tick.
  const requirementsLookups: RequirementsEditorLookups = useMemo(() => ({
    classes: classes.map((c: any) => ({ id: c.id, name: c.name })),
    subclasses: subclasses.map((s: any) => ({ id: s.id, name: s.name })),
    spellRules: spellRules.map((r: any) => ({ id: r.id, name: r.name })),
    optionGroups: allOptionGroups.map((g) => ({ id: g.id, name: g.name, items: g.items })),
    proficiencies: proficiencyPools,
  }), [classes, subclasses, spellRules, allOptionGroups, proficiencyPools]);

  const requirementsTextLookup = useMemo(() => ({
    classNameById: Object.fromEntries(classes.map((c: any) => [c.id, c.name])),
    subclassNameById: Object.fromEntries(subclasses.map((s: any) => [s.id, s.name])),
    spellRuleNameById: Object.fromEntries(spellRules.map((r: any) => [r.id, r.name])),
    optionItemNameById: Object.fromEntries(
      allOptionGroups.flatMap((g) => g.items.map((it) => [it.id, it.name] as const)),
    ),
  }), [classes, subclasses, spellRules, allOptionGroups]);

  const resetForm = () => {
    setEditingId(null);
    setFormData(makeInitialFeatForm(sources));
  };

  // Hydrate the form from the picked entry. Mirrors SpellsEditor's
  // approach: kick a detail fetch when we don't already have the full
  // row cached, otherwise just rehydrate from cache. Lets the
  // virtualized list stay cheap (summary only) while the right pane
  // pulls a full row.
  useEffect(() => {
    if (!editingId) return;
    const cached = featDetailsById[editingId];
    if (cached) {
      const defaults = makeInitialFeatForm(sources);
      setFormData({
        ...defaults,
        ...cached,
        id: cached.id,
        sourceId: cached.sourceId || cached.source_id || sources[0]?.id || '',
        imageUrl: cached.imageUrl || cached.image_url || '',
        featType: cached.featType || cached.feat_type || 'general',
        sourceType: cached.sourceType || cached.source_type || 'feat',
        requirements: cached.requirements || '',
        repeatable: !!cached.repeatable,
        uses: {
          max: cached.uses?.max ?? cached.usesMax ?? cached.uses_max ?? '',
          spent: Number(cached.uses?.spent ?? cached.usesSpent ?? cached.uses_spent ?? 0) || 0,
        },
        activities: Array.isArray(cached.automation?.activities)
          ? cached.automation.activities
          : Array.isArray(cached.activities)
            ? cached.activities
            : [],
        effectsStr: JSON.stringify(
          cached.automation?.effects || cached.effects || [],
          null,
          2,
        ),
        requirementsTree: parseRequirementTree(
          cached.requirementsTree ?? cached.requirements_tree,
        ),
      });
      return;
    }

    let active = true;
    const loadDetails = async () => {
      try {
        const data = await fetchFeat(editingId);
        if (!active || !data) return;
        setFeatDetailsById((current) => ({ ...current, [editingId]: data }));
      } catch (err) {
        console.error('Error loading feat details:', err);
      }
    };
    loadDetails();
    return () => {
      active = false;
    };
  }, [editingId, sources, featDetailsById]);

  const startEditing = (entry: any) => {
    setEditingId(entry.id);
  };

  const refreshEntries = async () => {
    try {
      const rows = await fetchCollection<any>('feats', { orderBy: 'name ASC' });
      const mapped = rows.map((row: any) => ({
        ...row,
        sourceId: row.source_id,
        imageUrl: row.image_url,
        featType: row.feat_type,
        sourceType: row.source_type,
        requirementsTree: parseRequirementTree(row.requirements_tree ?? row.requirementsTree),
        tagIds: Array.isArray(row.tags) ? row.tags : [],
      }));
      setEntries(mapped);
      // Invalidate the per-feat detail cache so the next select re-reads
      // the freshly-saved row (no stale activities/effects after edit).
      setFeatDetailsById({});
    } catch (err) {
      console.error('Error refreshing feats:', err);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      toast.error('Feat name is required');
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
      // Payload mirrors what `DevelopmentCompendiumManager` produced for
      // feats today — `automation: { activities, effects }` is the shape
      // `normalizeCompendiumData` expects, and the JSON columns get
      // unwrapped to top-level `activities` / `effects` automatically.
      // We also write `requirements_tree` as the serialized tree (or null).
      const payload: Record<string, any> = {
        name: formData.name,
        identifier: formData.identifier.trim() || slugify(formData.name),
        source_id: formData.sourceId,
        image_url: formData.imageUrl || null,
        description: formData.description || '',
        feat_type: formData.featType || 'general',
        source_type: formData.sourceType || 'feat',
        requirements: formData.requirements || null,
        repeatable: formData.repeatable ? 1 : 0,
        uses_max: formData.uses.max || null,
        uses_spent: Number(formData.uses.spent) || 0,
        activities: Array.isArray(formData.activities) ? formData.activities : [],
        effects: parsedEffects,
        requirements_tree: serializeRequirementTree(formData.requirementsTree),
        updated_at: new Date().toISOString(),
      };

      Object.keys(payload).forEach((key) => {
        if (payload[key] === undefined) delete payload[key];
      });

      const entryId = editingId || crypto.randomUUID();
      await upsertFeat(entryId, {
        ...payload,
        created_at: formData.createdAt || new Date().toISOString(),
      });
      toast.success(`Feat ${editingId ? 'updated' : 'created'}`);
      await refreshEntries();
      resetForm();
    } catch (error) {
      console.error('Error saving feat:', error);
      toast.error('Failed to save feat');
      reportClientError(
        error,
        editingId ? OperationType.UPDATE : OperationType.CREATE,
        `feats/${editingId || '(new)'}`,
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!editingId) return;
    if (!window.confirm('Delete this feat?')) return;
    try {
      await deleteFeat(editingId);
      toast.success('Feat deleted');
      await refreshEntries();
      resetForm();
    } catch (error) {
      console.error('Error deleting feat:', error);
      toast.error('Failed to delete feat');
      reportClientError(error, OperationType.DELETE, `feats/${editingId}`);
    }
  };

  if (!isAdmin) {
    return <div className="text-center py-20">Access Denied. Admins only.</div>;
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-20">
      <div className="flex items-center gap-4">
        <Link to="/compendium">
          <Button variant="ghost" size="sm" className="text-gold gap-2 hover:bg-gold/5">
            <ChevronLeft className="w-4 h-4" />
            Back To Compendium
          </Button>
        </Link>
      </div>

      <Card className="border-gold/20 bg-card/50 overflow-hidden">
        <CardContent className="p-0">
          {/* Header — same gradient stripe + Foundation pill the spell
              manager uses. The pill flips between Linked (D1 sources
              fetched) and Legacy (fetch failed / empty) so admins can
              tell at a glance whether they're authoring against a real
              D1 backend. */}
          <div className="border-b border-gold/10 bg-[radial-gradient(circle_at_top_left,rgba(192,160,96,0.14),transparent_52%),linear-gradient(180deg,rgba(12,16,24,0.75),rgba(12,16,24,0.98))] p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="space-y-3">
                <div className="flex items-center gap-3 text-gold">
                  <Scroll className="h-5 w-5" />
                  <span className="text-xs font-bold uppercase tracking-[0.3em]">Compendium Development</span>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-4">
                    <h2 className="text-3xl font-serif font-bold uppercase tracking-tight text-ink">Feat Manager</h2>
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
                    Draft and refine feat records using the same master-detail rhythm as the spell manager. Identity and structured requirements live at the root; mechanics ride on activities + effects.
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
                  New Feat
                </Button>
              </div>
            </div>
          </div>

          {/* Master-detail grid. The 360px / fr split is intentional: at
              that width the list comfortably renders feat name + meta
              + identifier in the row, and the right pane has enough
              real estate for the description editor + the activity
              authoring surface without wrapping. */}
          <div className="grid gap-6 p-6 xl:grid-cols-[360px_minmax(0,1fr)]">
            <div className="space-y-4">
              <div className="space-y-1">
                <Label className="text-xs font-bold uppercase tracking-widest text-ink/40">Search</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink/30" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search feat name, type, source, or identifier"
                    className="bg-background/50 border-gold/10 pl-9 focus:border-gold"
                  />
                </div>
              </div>

              <Card className="border-gold/10 bg-background/20">
                <CardContent className="p-0">
                  <div className="border-b border-gold/10 px-4 py-3 text-[10px] font-bold uppercase tracking-[0.2em] text-gold/70">
                    Feat Drafts
                  </div>
                  <div className="max-h-[78vh] space-y-2 overflow-y-auto custom-scrollbar p-3 pr-2">
                    {loading ? (
                      <div className="px-3 py-8 text-sm text-ink/40 italic">Loading...</div>
                    ) : filteredEntries.length === 0 ? (
                      <div className="px-3 py-8 text-sm text-ink/40 italic">No feats match the current search.</div>
                    ) : (
                      <VirtualizedList
                        items={filteredEntries}
                        height={MANAGER_LIST_HEIGHT}
                        itemHeight={MANAGER_ROW_HEIGHT}
                        className="custom-scrollbar overflow-y-auto"
                        innerClassName="space-y-2"
                        renderItem={(entry: any) => {
                          const selected = entry.id === editingId;
                          const sourceLabel = String(
                            sourceNameById[entry.sourceId] || entry.sourceId || 'Unknown Source',
                          );
                          const featTypeLabel =
                            FEAT_TYPES.find(([value]) => value === entry.featType)?.[1]
                            || entry.featType
                            || 'General';
                          // A row "has prereqs" if either the legacy free-text
                          // column carries a value or the structured tree is
                          // non-empty. Mirrors the lock-icon UX SpellList
                          // uses for spells with required tags.
                          const hasFreeTextPrereq = !!(entry.requirements && String(entry.requirements).trim());
                          const hasTreePrereq = !!entry.requirementsTree;
                          const hasPrereq = hasFreeTextPrereq || hasTreePrereq;
                          return (
                            <button
                              type="button"
                              key={entry.id}
                              onClick={() => startEditing(entry)}
                              className={cn(
                                'h-[94px] w-full rounded-xl border p-3 text-left transition-colors',
                                selected
                                  ? 'border-gold/50 bg-gold/10 shadow-[0_0_0_1px_rgba(192,160,96,0.2)]'
                                  : 'border-gold/10 bg-background/30 hover:border-gold/30 hover:bg-background/50',
                              )}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <div className="font-serif text-lg text-ink truncate">
                                      {entry.name || '(Untitled Feat)'}
                                    </div>
                                    {hasPrereq && (
                                      <Lock
                                        className="h-3 w-3 shrink-0 text-gold/60"
                                        aria-label="Has prerequisites"
                                      />
                                    )}
                                  </div>
                                  <div className="text-[10px] uppercase tracking-[0.2em] text-gold/70">
                                    {featTypeLabel}
                                    {entry.repeatable ? ' · Repeatable' : ''}
                                  </div>
                                </div>
                                <span className="text-[10px] font-mono text-ink/35 shrink-0">{sourceLabel}</span>
                              </div>

                              <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-ink/55">
                                <span>
                                  {(entry.automation?.activities?.length || entry.activities?.length || 0)} activities
                                </span>
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
                {/* Right-pane sticky-ish header: name + source pill on
                    the left, save/reset/delete on the right. Mirrors
                    SpellsEditor's pattern so the two managers feel
                    identical. */}
                <div className="border-b border-gold/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.02),transparent)] px-6 py-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-2">
                      <div className="flex items-center gap-3">
                        <h3 className="font-serif text-4xl font-bold text-ink">
                          {editingId ? (formData.name || 'Untitled Feat') : 'New Feat'}
                        </h3>
                        {formData.sourceId ? (
                          <span className="rounded border border-gold/20 bg-gold/10 px-2 py-1 text-xs text-gold">
                            {String(sourceNameById[formData.sourceId] || formData.sourceId)}
                          </span>
                        ) : null}
                      </div>
                      <p className="font-serif italic text-ink/70">
                        {FEAT_TYPES.find(([value]) => value === formData.featType)?.[1] || 'General'}
                        {formData.repeatable ? ' · Repeatable' : ''}
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
                          Delete Feat
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
                        form="feat-manual-editor-form"
                        className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground"
                        disabled={saving}
                      >
                        <Save className="h-4 w-4" />
                        {saving ? 'Saving...' : editingId ? 'Update Feat' : 'Save Feat'}
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="max-h-[78vh] overflow-y-auto custom-scrollbar px-6 py-5">
                  <form id="feat-manual-editor-form" onSubmit={handleSave} className="space-y-6">
                    {/* Image + identity strip. Compact 126px icon to
                        the left, identity grid (name/identifier/source/
                        featType/sourceType) to the right. */}
                    <div className="grid gap-6 lg:grid-cols-[126px_minmax(0,1fr)]">
                      <ImageUpload
                        currentImageUrl={formData.imageUrl}
                        storagePath={`images/feats/${editingId || 'draft'}/`}
                        onUpload={(url) => setFormData((prev) => ({ ...prev, imageUrl: url }))}
                        imageType="icon"
                        compact
                        className="h-[126px] w-[126px]"
                      />

                      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                        <div className="space-y-1">
                          <Label className="text-xs font-bold uppercase tracking-widest text-ink/40">Name</Label>
                          <Input
                            value={formData.name}
                            onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                            className="bg-background/50 border-gold/10 focus:border-gold"
                            placeholder="e.g. Great Weapon Master"
                            required
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs font-bold uppercase tracking-widest text-ink/40">Identifier</Label>
                          <Input
                            value={formData.identifier}
                            onChange={(e) => setFormData((prev) => ({ ...prev, identifier: e.target.value }))}
                            className="bg-background/50 border-gold/10 focus:border-gold font-mono"
                            placeholder={slugify(formData.name || 'feat')}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs font-bold uppercase tracking-widest text-ink/40">Source</Label>
                          <select
                            value={formData.sourceId}
                            onChange={(e) => setFormData((prev) => ({ ...prev, sourceId: e.target.value }))}
                            className="w-full h-10 px-3 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-sm"
                          >
                            <option value="">Select a source</option>
                            {sources.map((source) => (
                              <option key={source.id} value={source.id}>{source.name}</option>
                            ))}
                          </select>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs font-bold uppercase tracking-widest text-ink/40">Feat Type</Label>
                          <select
                            value={formData.featType || 'general'}
                            onChange={(e) => setFormData((prev) => ({ ...prev, featType: e.target.value }))}
                            className="w-full h-10 px-3 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-sm"
                          >
                            {FEAT_TYPES.map(([value, label]) => (
                              <option key={value} value={value}>{label}</option>
                            ))}
                          </select>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs font-bold uppercase tracking-widest text-ink/40">Source Type</Label>
                          <select
                            value={formData.sourceType || 'feat'}
                            onChange={(e) => setFormData((prev) => ({ ...prev, sourceType: e.target.value }))}
                            className="w-full h-10 px-3 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-sm"
                          >
                            {SOURCE_TYPES.map(([value, label]) => (
                              <option key={value} value={value}>{label}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>

                    <MarkdownEditor
                      key={editingId || 'new-feat'}
                      value={formData.description}
                      onChange={(value) => setFormData((prev) => ({ ...prev, description: value }))}
                      label="Description"
                      placeholder="Describe the feat in player-facing terms. Activities should carry runtime mechanics."
                      minHeight="300px"
                      autoSizeToContent={false}
                    />

                    {/* Foundry shell — feat-specific scalar fields that
                        round-trip onto `system.*` of the embedded
                        Foundry feat item. Repeatable + Uses already
                        have well-defined slots; the free-text
                        Requirements field is the legacy gate (still
                        what most published feats use). The structured
                        RequirementsEditor below it is the new path. */}
                    <div className="space-y-4 border border-gold/10 rounded-md p-4 bg-background/20">
                      <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-gold">Foundry Feat Shell</h3>
                      <div className="grid md:grid-cols-2 gap-4">
                        <label className="flex items-center justify-between gap-3 border border-gold/10 rounded-md p-3">
                          <span className="text-xs font-bold uppercase tracking-widest text-ink/60">Repeatable</span>
                          <Checkbox
                            checked={!!formData.repeatable}
                            onCheckedChange={(checked) =>
                              setFormData((prev) => ({ ...prev, repeatable: !!checked }))
                            }
                          />
                        </label>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-1">
                            <Label className="text-xs font-bold uppercase tracking-widest text-ink/40">Uses Max</Label>
                            <Input
                              value={formData.uses.max || ''}
                              onChange={(e) =>
                                setFormData((prev) => ({
                                  ...prev,
                                  uses: { ...prev.uses, max: e.target.value },
                                }))
                              }
                              className="bg-background/50 border-gold/10 focus:border-gold font-mono"
                              placeholder="@prof"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs font-bold uppercase tracking-widest text-ink/40">Uses Spent</Label>
                            <Input
                              type="number"
                              min={0}
                              value={formData.uses.spent ?? 0}
                              onChange={(e) =>
                                setFormData((prev) => ({
                                  ...prev,
                                  uses: { ...prev.uses, spent: parseInt(e.target.value || '0', 10) || 0 },
                                }))
                              }
                              className="bg-background/50 border-gold/10 focus:border-gold no-number-spin"
                            />
                          </div>
                        </div>
                      </div>
                      <p className="text-[10px] text-ink/40">
                        This is for general feats first. Class and subclass features still primarily travel through the class feature pipeline, even though they import as Foundry <code className="font-mono">feat</code> items.
                      </p>
                    </div>

                    {/* Prerequisites — the structured tree authoring
                        surface, plus a free-text legacy field for
                        narrative gates that can't fit the tree leaves
                        (e.g. "DM approval", or 5e PHB-flavor prose). */}
                    <div className="space-y-4 border border-gold/10 rounded-md p-4 bg-background/20">
                      <div className="flex items-baseline justify-between">
                        <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-gold">Prerequisites</h3>
                        <span className="text-[10px] text-ink/40">Structured tree gates · evaluated at the actor; free-text below is shown on the feat card.</span>
                      </div>

                      <div className="space-y-1">
                        <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/60">Free Text (legacy)</Label>
                        <Input
                          value={formData.requirements}
                          onChange={(e) => setFormData((prev) => ({ ...prev, requirements: e.target.value }))}
                          placeholder="e.g. The ability to cast at least one spell"
                          className="bg-background/50 border-gold/10 focus:border-gold text-xs"
                        />
                        <p className="text-[10px] text-ink/40">
                          Free-text fallback for prerequisites that don't fit the tree below. Displayed on the feat card; not machine-checked.
                        </p>
                      </div>

                      {/* Tree editor — same shared component the
                          UniqueOptionGroupEditor uses. Loaded lookups
                          (classes/subclasses/spellRules/option groups/
                          proficiencies) flow in via requirementsLookups
                          built above. Wiring lives in `feats.requirements_tree`. */}
                      <RequirementsEditor
                        value={formData.requirementsTree}
                        onChange={(next) => setFormData((prev) => ({ ...prev, requirementsTree: next }))}
                        lookups={requirementsLookups}
                        label="Compound Requirements"
                      />

                      {/* Preview the rendered tree so authors see what
                          the importer + Foundry item card will display
                          without having to save and reopen. Empty tree
                          renders nothing. */}
                      {formData.requirementsTree && (
                        <div className="rounded border border-gold/10 bg-background/40 px-3 py-2">
                          <span className="text-[9px] uppercase tracking-widest text-ink/40">Preview · </span>
                          <span className="text-xs italic text-ink/70">
                            {formatRequirementText(formData.requirementsTree, requirementsTextLookup)}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Activities + raw effects. Same shape SpellsEditor
                        uses — ActivityEditor for the structured array,
                        a JSON textarea for the still-evolving Active
                        Effects raw shape. */}
                    <div className="space-y-3">
                      <div className="border-t border-gold/10 pt-4">
                        <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-gold mb-2">Activities</h3>
                        <ActivityEditor
                          activities={formData.activities}
                          onChange={(activities) => setFormData((prev) => ({ ...prev, activities }))}
                          context="feat"
                        />
                      </div>

                      <div className="space-y-1">
                        <Label className="text-xs font-bold uppercase tracking-widest text-ink/40">Effects (JSON)</Label>
                        <textarea
                          value={formData.effectsStr}
                          onChange={(e) => setFormData((prev) => ({ ...prev, effectsStr: e.target.value }))}
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

import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronLeft, Wand2, Plus, X, Search, ChevronDown, ChevronRight, Trash2, Save, Info } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../../components/ui/dialog';
import { FilterBar } from '../../components/compendium/FilterBar';
import { fetchCollection } from '../../lib/d1';
import { fetchSpellSummaries } from '../../lib/spellSummary';
import { cn } from '../../lib/utils';
import { SCHOOL_LABELS } from '../../lib/spellImport';
import {
  ACTIVATION_LABELS,
  ACTIVATION_ORDER,
  DURATION_LABELS,
  DURATION_ORDER,
  PROPERTY_LABELS,
  PROPERTY_ORDER,
  RANGE_LABELS,
  RANGE_ORDER,
  deriveSpellFilterFacets,
  type ActivationBucket,
  type DurationBucket,
  type PropertyFilter,
  type RangeBucket,
  type RuleQuery,
  type SpellMatchInput,
} from '../../lib/spellFilters';
import {
  fetchAllRules,
  fetchAppliedRulesFor,
  fetchApplicationCounts,
  fetchRuleApplications,
  saveRule,
  deleteRule,
  applyRule,
  unapplyRule,
  spellMatchesRule,
  CONSUMER_TYPES,
  type ConsumerType,
  type SpellRule,
  type SpellRuleApplication,
} from '../../lib/spellRules';

const LEVEL_VALUES = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
const CONSUMER_LABELS: Record<ConsumerType, string> = {
  class: 'Class',
  subclass: 'Subclass',
  feat: 'Feat',
  feature: 'Feature',
  background: 'Background',
  item: 'Item',
  unique_option_item: 'Option Item',
};

type SpellSummaryRow = SpellMatchInput & {
  id: string;
  name: string;
  source_id: string | null;
};

type ClassRow = { id: string; name: string };
type SourceRow = { id: string; name?: string; abbreviation?: string; shortName?: string };
type TagRow = { id: string; name: string; groupId: string | null };
type TagGroupRow = { id: string; name: string };

/**
 * Standalone admin page for authoring Spell Rules — the bulk-grant primitive
 * applied to classes (and eventually subclasses, feats, features, backgrounds,
 * items, option items). See docs/features/spellbook-manager.md for the layered
 * model. Class-side consumption lives in `/compendium/spell-lists`.
 */
export default function SpellRulesEditor({ userProfile }: { userProfile: any }) {
  const isAdmin = userProfile?.role === 'admin';
  const [searchParams, setSearchParams] = useSearchParams();
  const initialRuleId = searchParams.get('rule') || '';

  // Foundation
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [tags, setTags] = useState<TagRow[]>([]);
  const [tagGroups, setTagGroups] = useState<TagGroupRow[]>([]);
  const [spells, setSpells] = useState<SpellSummaryRow[]>([]);

  // Rules state
  const [rules, setRules] = useState<SpellRule[]>([]);
  const [appCounts, setAppCounts] = useState<Record<string, number>>({});
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(initialRuleId || null);
  const [draft, setDraft] = useState<SpellRule | null>(null);
  const [draftDirty, setDraftDirty] = useState(false);
  const [draftApplications, setDraftApplications] = useState<SpellRuleApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // UI state
  const [howOpen, setHowOpen] = useState(true);
  const [filterOpen, setFilterOpen] = useState(false);
  const [manualSpellsSearch, setManualSpellsSearch] = useState('');
  const [applyDialogOpen, setApplyDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // Initial load
  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    (async () => {
      try {
        const [classData, sourceData, tagData, tagGroupData, spellData, ruleData, counts] = await Promise.all([
          fetchCollection<any>('classes', { orderBy: 'name ASC' }),
          fetchCollection<any>('sources', { orderBy: 'name ASC' }),
          fetchCollection<any>('tags', { orderBy: 'name ASC' }),
          fetchCollection<any>('tagGroups', { where: "classifications LIKE '%spell%'" }),
          fetchSpellSummaries('level ASC, name ASC'),
          fetchAllRules(),
          fetchApplicationCounts(),
        ]);
        if (!active) return;
        setClasses(classData.map((c: any) => ({ id: c.id, name: c.name })));
        setSources(sourceData);
        setTags(tagData.map((t: any) => ({ id: t.id, name: t.name || '', groupId: t.group_id || t.groupId || null })));
        setTagGroups(tagGroupData.map((g: any) => ({ id: g.id, name: g.name || 'Tags' })));
        setSpells(spellData.map((s: any) => ({
          id: s.id,
          name: s.name,
          level: Number(s.level || 0),
          school: s.school || '',
          source_id: s.source_id,
          tags: typeof s.tags === 'string' ? safeParseArr(s.tags) : (Array.isArray(s.tags) ? s.tags : []),
          ...deriveSpellFilterFacets(s),
        })));
        setRules(ruleData);
        setAppCounts(counts);
      } catch (err) {
        console.error('[SpellRulesEditor] Failed to load:', err);
        toast.error('Failed to load rules.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [isAdmin]);

  // Keep ?rule=<id> in the URL in sync with selection so the page is link-shareable.
  useEffect(() => {
    const current = searchParams.get('rule') || '';
    const want = selectedRuleId || '';
    if (current === want) return;
    const next = new URLSearchParams(searchParams);
    if (want) next.set('rule', want);
    else next.delete('rule');
    setSearchParams(next, { replace: true });
  }, [selectedRuleId, searchParams, setSearchParams]);

  // Selection — load draft + applications for selected rule
  useEffect(() => {
    if (!selectedRuleId) {
      setDraft(null);
      setDraftDirty(false);
      setDraftApplications([]);
      return;
    }
    const rule = rules.find(r => r.id === selectedRuleId) || null;
    if (rule) setDraft({ ...rule });
    setDraftDirty(false);

    let active = true;
    fetchRuleApplications(selectedRuleId)
      .then(apps => { if (active) setDraftApplications(apps); })
      .catch(err => console.error('[SpellRulesEditor] Failed to load applications:', err));
    return () => { active = false; };
  }, [selectedRuleId, rules]);

  const tagsById = useMemo(
    () => Object.fromEntries(tags.map(t => [t.id, t])) as Record<string, TagRow>,
    [tags],
  );
  const tagsByGroup = useMemo(() => {
    const map: Record<string, TagRow[]> = {};
    for (const tag of tags) {
      if (!tag.groupId) continue;
      (map[tag.groupId] = map[tag.groupId] || []).push(tag);
    }
    return map;
  }, [tags]);
  const sourceById = useMemo(
    () => Object.fromEntries(sources.map(s => [s.id, s])) as Record<string, SourceRow>,
    [sources],
  );
  const classById = useMemo(
    () => Object.fromEntries(classes.map(c => [c.id, c])) as Record<string, ClassRow>,
    [classes],
  );
  const spellById = useMemo(
    () => Object.fromEntries(spells.map(s => [s.id, s])) as Record<string, SpellSummaryRow>,
    [spells],
  );

  // Live match preview for the draft
  const draftMatchCount = useMemo(() => {
    if (!draft) return 0;
    let n = 0;
    for (const s of spells) if (spellMatchesRule(s, draft)) n++;
    return n;
  }, [draft, spells]);

  // Filtered spell suggestions for the manual-spells search
  const manualSpellSuggestions = useMemo(() => {
    const q = manualSpellsSearch.trim().toLowerCase();
    if (!q) return [];
    return spells
      .filter(s => !draft?.manualSpells.includes(s.id))
      .filter(s => s.name.toLowerCase().includes(q))
      .slice(0, 12);
  }, [manualSpellsSearch, spells, draft?.manualSpells]);

  if (!isAdmin) {
    return <div className="text-center py-20 text-ink/70">Access Denied. Admins only.</div>;
  }

  // ------- Handlers -------

  const handleNewRule = () => {
    const fresh: SpellRule = {
      id: '',
      name: 'New Rule',
      description: '',
      query: {},
      manualSpells: [],
    };
    setSelectedRuleId(null);
    setDraft(fresh);
    setDraftDirty(true);
    setDraftApplications([]);
  };

  const updateDraft = (patch: Partial<SpellRule>) => {
    if (!draft) return;
    setDraft({ ...draft, ...patch });
    setDraftDirty(true);
  };

  const updateQuery = (patch: Partial<RuleQuery>) => {
    if (!draft) return;
    setDraft({ ...draft, query: { ...draft.query, ...patch } });
    setDraftDirty(true);
  };

  const handleSave = async () => {
    if (!draft) return;
    if (!draft.name.trim()) {
      toast.error('Rule name is required.');
      return;
    }
    setSaving(true);
    try {
      const id = await saveRule({
        id: draft.id || null,
        name: draft.name.trim(),
        description: draft.description,
        query: draft.query,
        manualSpells: draft.manualSpells,
      });
      const refreshed = await fetchAllRules();
      const counts = await fetchApplicationCounts();
      setRules(refreshed);
      setAppCounts(counts);
      setSelectedRuleId(id);
      setDraftDirty(false);
      toast(draft.id ? `Saved rule "${draft.name}".` : `Created rule "${draft.name}".`);
    } catch (err) {
      console.error('[SpellRulesEditor] Save failed:', err);
      toast.error('Failed to save rule.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!draft || !draft.id) return;
    setDeleteDialogOpen(false);
    try {
      await deleteRule(draft.id);
      const refreshed = await fetchAllRules();
      const counts = await fetchApplicationCounts();
      setRules(refreshed);
      setAppCounts(counts);
      setSelectedRuleId(null);
      setDraft(null);
      toast(`Deleted rule "${draft.name}".`);
    } catch (err) {
      console.error('[SpellRulesEditor] Delete failed:', err);
      toast.error('Failed to delete rule.');
    }
  };

  const handleApplyToConsumer = async (type: ConsumerType, id: string) => {
    if (!draft?.id) return;
    try {
      await applyRule(draft.id, type, id);
      const apps = await fetchRuleApplications(draft.id);
      setDraftApplications(apps);
      setAppCounts(await fetchApplicationCounts());
      const label = type === 'class' ? classById[id]?.name || id : id;
      toast(`Applied "${draft.name}" to ${CONSUMER_LABELS[type]}: ${label}.`);
    } catch (err) {
      console.error('[SpellRulesEditor] Apply failed:', err);
      toast.error('Failed to apply rule.');
    }
  };

  const handleUnapply = async (app: SpellRuleApplication) => {
    if (!draft?.id) return;
    try {
      await unapplyRule(draft.id, app.appliesToType, app.appliesToId);
      setDraftApplications(prev => prev.filter(a => a.id !== app.id));
      setAppCounts(await fetchApplicationCounts());
    } catch (err) {
      console.error('[SpellRulesEditor] Unapply failed:', err);
      toast.error('Failed to remove application.');
    }
  };

  const toggleFromQueryArray = <K extends keyof RuleQuery>(
    field: K,
    value: NonNullable<RuleQuery[K]>[number],
  ) => {
    if (!draft) return;
    const current = (draft.query[field] as any[] | undefined) || [];
    const next = current.includes(value) ? current.filter(v => v !== value) : [...current, value];
    updateQuery({ [field]: next } as Partial<RuleQuery>);
  };

  const queryActiveCount = useMemo(() => {
    if (!draft) return 0;
    const q = draft.query;
    return (q.sourceFilterIds?.length ?? 0)
      + (q.levelFilters?.length ?? 0)
      + (q.schoolFilters?.length ?? 0)
      + (q.tagFilterIds?.length ?? 0)
      + (q.activationFilters?.length ?? 0)
      + (q.rangeFilters?.length ?? 0)
      + (q.durationFilters?.length ?? 0)
      + (q.propertyFilters?.length ?? 0);
  }, [draft]);

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-20">
      <div className="flex items-center gap-4">
        <Link to="/compendium/classes">
          <Button variant="ghost" size="sm" className="text-gold gap-2 hover:bg-gold/5">
            <ChevronLeft className="w-4 h-4" /> Back To Classes
          </Button>
        </Link>
      </div>

      {/* Title + how-rules-work */}
      <Card className="border-gold/20 bg-card/50 overflow-hidden">
        <CardContent className="p-0">
          <div className="bg-[radial-gradient(circle_at_top_left,rgba(192,160,96,0.14),transparent_52%),linear-gradient(180deg,rgba(12,16,24,0.75),rgba(12,16,24,0.98))] p-6 space-y-3">
            <div className="flex items-center gap-3 text-gold">
              <Wand2 className="h-5 w-5" />
              <span className="text-xs font-bold uppercase tracking-[0.3em]">Compendium Development</span>
            </div>
            <h2 className="text-3xl font-serif font-bold uppercase tracking-tight text-ink">Spell Rules</h2>
            <p className="text-sm text-ink/60 max-w-3xl">
              Reusable spell-grant patterns. Define a rule once (filter query + manual additions) and apply
              it to as many classes, feats, items, etc. as you want.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setHowOpen(v => !v)}
            className="w-full flex items-center gap-2 px-6 py-2 border-t border-gold/10 text-[10px] font-bold uppercase tracking-[0.2em] text-gold/70 hover:bg-gold/5"
          >
            {howOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            <Info className="w-3.5 h-3.5" />
            How rules work
          </button>
          {howOpen ? (
            <div className="px-6 pb-5 pt-2 text-sm text-ink/75 space-y-2 border-t border-gold/10 bg-background/30">
              <p>
                <span className="text-gold font-bold">A rule</span> is a saved spell-curation pattern. It has a
                <span className="text-gold"> tag query</span> (e.g. "all spells tagged <em>Divine</em> at level 1+")
                plus a <span className="text-gold">manual list</span> of spell IDs that always match.
              </p>
              <p>
                <span className="text-gold font-bold">Applying a rule</span> links it to a consumer (a class, subclass,
                feat, feature, background, item, or option item). The same rule can be applied to many consumers — that's
                the point. A "Divine — Major" rule could power Cleric and Paladin spell lists from a single source.
              </p>
              <p>
                <span className="text-gold font-bold">For classes</span>, applying a rule means it contributes to the class's
                master spell list (`class_spell_lists`) at rebuild time. Manual entries on the class are preserved across rebuilds.
              </p>
              <p className="text-ink/50 text-xs italic">
                For non-class consumers, the application is stored but not yet read — that wires up in Layer 2 (`GrantSpells`)
                when characters can resolve their spell pools.
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        {/* Rule list */}
        <Card className="border-gold/20 bg-card/50 overflow-hidden self-start">
          <CardContent className="p-0">
            <div className="border-b border-gold/10 px-4 py-3 flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-gold">All Rules ({rules.length})</h3>
              <Button
                type="button"
                size="sm"
                onClick={handleNewRule}
                className="h-7 px-2 text-[10px] uppercase tracking-[0.18em] bg-gold/15 text-gold border border-gold/30 hover:bg-gold/25"
              >
                <Plus className="w-3 h-3 mr-1" /> New
              </Button>
            </div>
            {loading ? (
              <div className="px-6 py-12 text-center text-ink/45">Loading…</div>
            ) : rules.length === 0 ? (
              <div className="px-6 py-12 text-center text-ink/45 text-sm italic">
                No rules yet. Click <strong>New</strong> to create one.
              </div>
            ) : (
              <div className="max-h-[640px] overflow-y-auto custom-scrollbar divide-y divide-gold/5">
                {rules.map(rule => {
                  const isSelected = rule.id === selectedRuleId;
                  const apps = appCounts[rule.id] || 0;
                  return (
                    <button
                      key={rule.id}
                      type="button"
                      onClick={() => setSelectedRuleId(rule.id)}
                      className={cn(
                        'w-full text-left px-4 py-2.5 transition-colors',
                        isSelected ? 'bg-gold/15' : 'hover:bg-gold/5',
                      )}
                    >
                      <div className="text-sm text-ink font-bold truncate">{rule.name}</div>
                      <div className="text-[10px] text-ink/50">
                        {apps === 0 ? <span className="italic">unapplied</span> : `applied to ${apps}`}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Editor */}
        <Card className="border-gold/20 bg-card/50 overflow-hidden self-start">
          <CardContent className="p-0">
            {!draft ? (
              <div className="px-8 py-20 text-center text-ink/45">
                Pick a rule from the list, or click <strong>New</strong> to create one.
              </div>
            ) : (
              <div className="divide-y divide-gold/10">
                {/* Header / actions */}
                <div className="px-6 py-4 flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <Input
                      value={draft.name}
                      onChange={e => updateDraft({ name: e.target.value })}
                      placeholder="Rule name (e.g. Divine — Major)"
                      className="h-9 text-base font-bold bg-background/40 border-gold/20"
                    />
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {draft.id ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setDeleteDialogOpen(true)}
                        className="h-8 px-3 text-[10px] uppercase tracking-[0.18em] border-gold/20 text-ink/45 hover:bg-blood/10 hover:text-blood hover:border-blood/40"
                      >
                        <Trash2 className="w-3 h-3 mr-1" /> Delete
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleSave}
                      disabled={saving || !draft.name.trim()}
                      className="h-8 px-3 text-[10px] uppercase tracking-[0.18em] bg-gold/15 text-gold border border-gold/30 hover:bg-gold/25"
                    >
                      <Save className="w-3 h-3 mr-1" /> {saving ? 'Saving…' : draft.id ? 'Save Changes' : 'Save Rule'}
                    </Button>
                  </div>
                </div>

                <div className="px-6 py-4 space-y-1">
                  <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/60">Description</Label>
                  <Input
                    value={draft.description}
                    onChange={e => updateDraft({ description: e.target.value })}
                    placeholder="Short note about what this rule covers"
                    className="bg-background/40 border-gold/20"
                  />
                </div>

                {/* Filter editor */}
                <div className="px-6 py-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-gold">Tag Query</h3>
                    <span className="text-[10px] text-ink/50">
                      <span className="text-gold font-bold">{draftMatchCount}</span> spell{draftMatchCount === 1 ? '' : 's'} match (query + manual)
                    </span>
                  </div>
                  <FilterBar
                    search=""
                    setSearch={() => {}}
                    isFilterOpen={filterOpen}
                    setIsFilterOpen={setFilterOpen}
                    activeFilterCount={queryActiveCount}
                    resetFilters={() => updateDraft({ query: {} })}
                    searchPlaceholder=""
                    filterTitle="Rule Filters"
                    renderFilters={
                      <>
                        <RuleFilterSection
                          title="Source"
                          values={sources.map(s => ({ value: s.id, label: String(s.abbreviation || s.shortName || s.name || s.id) }))}
                          selected={draft.query.sourceFilterIds || []}
                          onToggle={v => toggleFromQueryArray('sourceFilterIds', v)}
                          onIncludeAll={() => updateQuery({ sourceFilterIds: sources.map(s => s.id) })}
                          onClear={() => updateQuery({ sourceFilterIds: [] })}
                        />
                        <RuleFilterSection
                          title="Spell Level"
                          values={LEVEL_VALUES.map(lvl => ({ value: lvl, label: lvl === '0' ? 'Cantrip' : `Level ${lvl}` }))}
                          selected={draft.query.levelFilters || []}
                          onToggle={v => toggleFromQueryArray('levelFilters', v)}
                          onIncludeAll={() => updateQuery({ levelFilters: [...LEVEL_VALUES] })}
                          onClear={() => updateQuery({ levelFilters: [] })}
                        />
                        <RuleFilterSection
                          title="Spell School"
                          values={Object.entries(SCHOOL_LABELS).map(([k, label]) => ({ value: k, label }))}
                          selected={draft.query.schoolFilters || []}
                          onToggle={v => toggleFromQueryArray('schoolFilters', v)}
                          onIncludeAll={() => updateQuery({ schoolFilters: Object.keys(SCHOOL_LABELS) })}
                          onClear={() => updateQuery({ schoolFilters: [] })}
                        />
                        {tagGroups.map(group => {
                          const groupTags = tagsByGroup[group.id] || [];
                          if (!groupTags.length) return null;
                          return (
                            <RuleFilterSection
                              key={group.id}
                              title={group.name}
                              values={groupTags.map(t => ({ value: t.id, label: t.name }))}
                              selected={draft.query.tagFilterIds || []}
                              onToggle={v => toggleFromQueryArray('tagFilterIds', v)}
                              onIncludeAll={() => updateQuery({
                                tagFilterIds: Array.from(new Set([...(draft.query.tagFilterIds || []), ...groupTags.map(t => t.id)])),
                              })}
                              onClear={() => updateQuery({
                                tagFilterIds: (draft.query.tagFilterIds || []).filter(id => !groupTags.some(t => t.id === id)),
                              })}
                            />
                          );
                        })}
                        <RuleFilterSection
                          title="Casting Time"
                          values={ACTIVATION_ORDER.map(b => ({ value: b, label: ACTIVATION_LABELS[b] }))}
                          selected={draft.query.activationFilters || []}
                          onToggle={v => toggleFromQueryArray('activationFilters', v as ActivationBucket)}
                          onIncludeAll={() => updateQuery({ activationFilters: [...ACTIVATION_ORDER] })}
                          onClear={() => updateQuery({ activationFilters: [] })}
                        />
                        <RuleFilterSection
                          title="Range"
                          values={RANGE_ORDER.map(b => ({ value: b, label: RANGE_LABELS[b] }))}
                          selected={draft.query.rangeFilters || []}
                          onToggle={v => toggleFromQueryArray('rangeFilters', v as RangeBucket)}
                          onIncludeAll={() => updateQuery({ rangeFilters: [...RANGE_ORDER] })}
                          onClear={() => updateQuery({ rangeFilters: [] })}
                        />
                        <RuleFilterSection
                          title="Duration"
                          values={DURATION_ORDER.map(b => ({ value: b, label: DURATION_LABELS[b] }))}
                          selected={draft.query.durationFilters || []}
                          onToggle={v => toggleFromQueryArray('durationFilters', v as DurationBucket)}
                          onIncludeAll={() => updateQuery({ durationFilters: [...DURATION_ORDER] })}
                          onClear={() => updateQuery({ durationFilters: [] })}
                        />
                        <RuleFilterSection
                          title="Properties"
                          values={PROPERTY_ORDER.map(p => ({ value: p, label: PROPERTY_LABELS[p] }))}
                          selected={draft.query.propertyFilters || []}
                          onToggle={v => toggleFromQueryArray('propertyFilters', v as PropertyFilter)}
                          onIncludeAll={() => updateQuery({ propertyFilters: [...PROPERTY_ORDER] })}
                          onClear={() => updateQuery({ propertyFilters: [] })}
                        />
                      </>
                    }
                  />
                  <p className="text-[10px] text-ink/40">
                    The query selects spells by their attributes. Combine sections with AND (a spell must match every section that has any chips picked).
                  </p>
                </div>

                {/* Manual spells */}
                <div className="px-6 py-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-gold">
                      Manual Additions ({draft.manualSpells.length})
                    </h3>
                  </div>
                  <p className="text-[10px] text-ink/40">
                    Specific spells that always match this rule, even if the tag query doesn't pick them up.
                  </p>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink/40 pointer-events-none" />
                    <Input
                      value={manualSpellsSearch}
                      onChange={e => setManualSpellsSearch(e.target.value)}
                      placeholder="Search spells to add…"
                      className="pl-9 bg-background/40 border-gold/20"
                    />
                    {manualSpellSuggestions.length > 0 ? (
                      <div className="absolute left-0 right-0 top-full mt-1 z-10 max-h-64 overflow-y-auto bg-card border border-gold/30 rounded-md shadow-lg divide-y divide-gold/10">
                        {manualSpellSuggestions.map(s => (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => {
                              updateDraft({ manualSpells: [...draft.manualSpells, s.id] });
                              setManualSpellsSearch('');
                            }}
                            className="w-full text-left px-3 py-2 text-sm text-ink hover:bg-gold/10 flex items-center justify-between"
                          >
                            <span className="truncate">{s.name}</span>
                            <span className="text-[10px] text-ink/50 shrink-0 ml-2">
                              {s.level === 0 ? 'C' : `L${s.level}`} · {SCHOOL_LABELS[s.school] || s.school}
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  {draft.manualSpells.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {draft.manualSpells.map(id => {
                        const s = spellById[id];
                        return (
                          <span
                            key={id}
                            className="inline-flex items-center gap-1 rounded-full border border-gold/30 bg-gold/10 pl-2 pr-1 py-0.5 text-[11px] text-gold"
                          >
                            {s?.name || id}
                            <button
                              type="button"
                              onClick={() => updateDraft({ manualSpells: draft.manualSpells.filter(x => x !== id) })}
                              aria-label="Remove spell"
                              className="rounded-full hover:bg-gold/20 p-0.5"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-xs text-ink/40 italic">No manual additions.</p>
                  )}
                </div>

                {/* Applied to */}
                <div className="px-6 py-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-gold">
                      Applied To ({draftApplications.length})
                    </h3>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setApplyDialogOpen(true)}
                      disabled={!draft.id}
                      className="h-7 px-2 text-[10px] uppercase tracking-[0.18em] border-gold/30 text-gold hover:bg-gold/10"
                      title={!draft.id ? 'Save the rule before linking it to consumers' : 'Apply this rule to a consumer'}
                    >
                      <Plus className="w-3 h-3 mr-1" /> Apply To…
                    </Button>
                  </div>
                  {!draft.id ? (
                    <p className="text-xs text-ink/40 italic">Save the rule first to link it to classes / feats / etc.</p>
                  ) : draftApplications.length === 0 ? (
                    <p className="text-xs text-ink/40 italic">Not applied to anything yet.</p>
                  ) : (
                    <div className="space-y-1">
                      {draftApplications.map(app => {
                        const label = app.appliesToType === 'class'
                          ? (classById[app.appliesToId]?.name || app.appliesToId)
                          : app.appliesToId;
                        return (
                          <div
                            key={app.id}
                            className="flex items-center gap-3 px-3 py-1.5 rounded border border-gold/15 hover:border-gold/30"
                          >
                            <span className="text-[10px] uppercase tracking-widest text-gold/60 shrink-0">
                              {CONSUMER_LABELS[app.appliesToType]}
                            </span>
                            <span className="text-sm text-ink truncate flex-1">{label}</span>
                            <button
                              type="button"
                              onClick={() => handleUnapply(app)}
                              className="text-[10px] uppercase tracking-widest text-ink/40 hover:text-blood"
                            >
                              Remove
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {draftDirty ? (
                  <div className="px-6 py-3 bg-gold/[0.06] text-[10px] uppercase tracking-widest text-gold/80">
                    Unsaved changes
                  </div>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Apply-to dialog */}
      <Dialog open={applyDialogOpen} onOpenChange={setApplyDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Apply rule to…</DialogTitle>
            <DialogDescription>
              Pick a class to link this rule to. Other consumer types (subclasses, feats, items, etc.)
              are supported by the data model and will become pickable here as Layer 2 lands.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-72 overflow-y-auto custom-scrollbar divide-y divide-gold/10 -mx-4">
            {classes.length === 0 ? (
              <p className="px-4 py-3 text-sm text-ink/45 italic">No classes loaded.</p>
            ) : (
              classes.map(c => {
                const alreadyApplied = draftApplications.some(
                  a => a.appliesToType === 'class' && a.appliesToId === c.id,
                );
                return (
                  <button
                    key={c.id}
                    type="button"
                    disabled={alreadyApplied}
                    onClick={async () => {
                      await handleApplyToConsumer('class', c.id);
                      setApplyDialogOpen(false);
                    }}
                    className={cn(
                      'w-full text-left px-4 py-2 text-sm flex items-center justify-between',
                      alreadyApplied ? 'text-ink/30 cursor-not-allowed' : 'text-ink hover:bg-gold/10',
                    )}
                  >
                    <span>{c.name}</span>
                    {alreadyApplied ? <span className="text-[10px] uppercase text-gold/50">already applied</span> : null}
                  </button>
                );
              })
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setApplyDialogOpen(false)}
              className="border-gold/20 text-ink/70 hover:bg-gold/5"
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete-confirm dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete rule?</DialogTitle>
            <DialogDescription>
              {draft ? (
                <>
                  Permanently remove <span className="text-ink font-bold">{draft.name}</span>. All applications
                  to consumers are removed too. Spells already added to class lists by this rule stay there
                  until the next Rebuild for each affected class.
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
              className="border-gold/20 text-ink/70 hover:bg-gold/5"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleDelete}
              className="bg-blood/15 text-blood border border-blood/40 hover:bg-blood/25"
            >
              Delete Rule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function safeParseArr(raw: string): any[] {
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; } catch { return []; }
}

function RuleFilterSection({
  title,
  values,
  selected,
  onToggle,
  onIncludeAll,
  onClear,
}: {
  title: string;
  values: { value: string; label: string }[];
  selected: string[];
  onToggle: (value: string) => void;
  onIncludeAll: () => void;
  onClear: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="h3-title uppercase text-ink">{title}</span>
        <div className="flex items-center gap-3">
          <button type="button" onClick={onIncludeAll} className="label-text hover:underline">Include All</button>
          <span className="text-gold/20">|</span>
          <button type="button" onClick={onClear} className="label-text hover:underline">Clear</button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {values.map(({ value, label }) => {
          const active = selected.includes(value);
          return (
            <button
              key={value}
              type="button"
              onClick={() => onToggle(value)}
              className={cn(
                'rounded border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide transition-colors',
                active
                  ? 'border-gold/60 bg-gold/15 text-gold'
                  : 'border-gold/15 text-ink/55 hover:border-gold/30 hover:text-gold/80',
              )}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

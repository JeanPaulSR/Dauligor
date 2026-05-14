import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronLeft, Wand2, Plus, X, Search, ChevronDown, ChevronRight, Trash2, Save, Info } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../../components/ui/dialog';
import { FilterBar, TagGroupFilter, AxisFilterSection } from '../../components/compendium/FilterBar';
import { fetchCollection } from '../../lib/d1';
import { fetchSpellSummaries } from '../../lib/spellSummary';
import { normalizeTagRow, orderTagsAsTree, tagPickerLabel, buildTagIndex } from '../../lib/tagHierarchy';
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
  SHAPE_LABELS,
  SHAPE_ORDER,
  deriveSpellFilterFacets,
  type ActivationBucket,
  type DurationBucket,
  type PropertyFilter,
  type RangeBucket,
  type RuleQuery,
  type ShapeBucket,
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
type TagRow = { id: string; name: string; groupId: string | null; parentTagId: string | null };
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
  const [howOpen, setHowOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [manualSpellsSearch, setManualSpellsSearch] = useState('');
  const [applyDialogOpen, setApplyDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // Fullscreen-page opt-in — mirrors /compendium/spells,
  // /compendium/spells/manage, /compendium/spell-lists. Hides the
  // global footer and strips <main>'s container padding so the
  // working area uses the full viewport.
  useEffect(() => {
    if (!isAdmin) return;
    document.body.classList.add('spell-list-fullscreen');
    return () => document.body.classList.remove('spell-list-fullscreen');
  }, [isAdmin]);

  // Viewport-derived pane height. Chrome above the working grid:
  // navbar (~56) + toolbar (~50) + maybe "How rules work" strip
  // (collapsed by default; ~36 when collapsed, ~140 when expanded)
  // + small gaps ≈ 180. Conservative — a small underestimate just
  // leaves a few pixels at the bottom.
  const [paneHeight, setPaneHeight] = useState<number>(() =>
    typeof window === 'undefined' ? 720 : Math.max(420, window.innerHeight - 180),
  );
  useEffect(() => {
    const onResize = () => setPaneHeight(Math.max(420, window.innerHeight - 180));
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

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
        setTags(tagData.map(normalizeTagRow));
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
    if (rule) {
      // Auto-migrate legacy include-only arrays to the rich AxisFilter
      // shape at load time. The editor only ever writes the rich shape
      // (see the per-axis cycle handlers below), so legacy fields are
      // cleared as part of the migration. Authors don't see a behavior
      // change — every legacy entry becomes an `include` chip with the
      // default OR combinator.
      const q = rule.query;
      const migrated: Partial<typeof q> = {};
      const arrToStates = (arr?: string[]): Record<string, number> | undefined => {
        if (!arr || arr.length === 0) return undefined;
        const out: Record<string, number> = {};
        for (const v of arr) out[v] = 1;
        return out;
      };
      // Tags: rich tagStates already covers this — same logic, kept in
      // case a rule has BOTH the legacy and the rich (rare/partial).
      if ((!q.tagStates || Object.keys(q.tagStates).length === 0) && q.tagFilterIds?.length) {
        migrated.tagStates = arrToStates(q.tagFilterIds);
        migrated.tagFilterIds = undefined;
      }
      // Per-axis migration. Each promotes legacy array -> rich filter
      // and nulls the legacy field so saves write only the new shape.
      const promoteAxis = (
        legacyKey: 'sourceFilterIds' | 'levelFilters' | 'schoolFilters' | 'activationFilters' | 'rangeFilters' | 'durationFilters' | 'shapeFilters' | 'propertyFilters',
        axisKey: 'source' | 'level' | 'school' | 'activation' | 'range' | 'duration' | 'shape' | 'property',
      ) => {
        const legacy = q[legacyKey] as string[] | undefined;
        const rich = q[axisKey] as any;
        const hasRich = rich && rich.states && Object.keys(rich.states).length > 0;
        if (!hasRich && legacy && legacy.length > 0) {
          (migrated as any)[axisKey] = { states: arrToStates(legacy) };
          (migrated as any)[legacyKey] = undefined;
        }
      };
      promoteAxis('sourceFilterIds', 'source');
      promoteAxis('levelFilters', 'level');
      promoteAxis('schoolFilters', 'school');
      promoteAxis('activationFilters', 'activation');
      promoteAxis('rangeFilters', 'range');
      promoteAxis('durationFilters', 'duration');
      promoteAxis('shapeFilters', 'shape');
      promoteAxis('propertyFilters', 'property');

      if (Object.keys(migrated).length > 0) {
        setDraft({ ...rule, query: { ...q, ...migrated } });
      } else {
        setDraft({ ...rule });
      }
    }
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
    // Subtags are ordered immediately after their parent within each
    // group so the chip row reads "Parent, ↳ Sub1, ↳ Sub2, NextParent,
    // …" — the visual prefix is applied per-tag in the picker via
    // tagPickerLabel().
    const map: Record<string, TagRow[]> = {};
    for (const tag of tags) {
      if (!tag.groupId) continue;
      (map[tag.groupId] = map[tag.groupId] || []).push(tag);
    }
    for (const groupId in map) {
      map[groupId] = orderTagsAsTree(map[groupId]);
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

  // Tag-hierarchy index required by the rule matcher so rich-tag
  // rules (tagStates with per-group AND/OR/XOR combinators) actually
  // bucket their chips by group. Without this, the matcher's
  // defensive fallback in matchSpellAgainstRule returns true for
  // every spell — the live "matches" count would lie. The
  // server-side rebuild path builds its own index; this is for the
  // UI preview only.
  const tagIndex = useMemo(() => buildTagIndex(tags as any), [tags]);

  // Live match preview for the draft
  const draftMatchCount = useMemo(() => {
    if (!draft) return 0;
    let n = 0;
    for (const s of spells) if (spellMatchesRule(s, draft, tagIndex)) n++;
    return n;
  }, [draft, spells, tagIndex]);

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

  // Per-axis helpers. `axisKey` is the canonical RuleQuery field
  // (source / level / school / activation / range / duration / shape /
  // property); `legacyKey` is the corresponding include-only array kept
  // for back-compat (sourceFilterIds / levelFilters / …). Every write
  // through the editor produces the rich shape and nulls the legacy
  // field so saves persist the new format only.
  type AxisFieldName = 'source' | 'level' | 'school' | 'activation' | 'range' | 'duration' | 'shape' | 'property';
  type LegacyFieldName = 'sourceFilterIds' | 'levelFilters' | 'schoolFilters' | 'activationFilters' | 'rangeFilters' | 'durationFilters' | 'shapeFilters' | 'propertyFilters';
  const cycleAxisState = (axisKey: AxisFieldName, legacyKey: LegacyFieldName, value: string) => {
    if (!draft) return;
    const axis = (draft.query[axisKey] as any) || {};
    const states = { ...(axis.states || {}) } as Record<string, number>;
    const cur = states[value] || 0;
    const nextState = cur === 0 ? 1 : cur === 1 ? 2 : 0;
    if (nextState === 0) delete states[value];
    else states[value] = nextState;
    updateQuery({ [axisKey]: { ...axis, states }, [legacyKey]: undefined } as Partial<RuleQuery>);
  };
  const cycleAxisCombineMode = (axisKey: AxisFieldName, legacyKey: LegacyFieldName) => {
    if (!draft) return;
    const axis = (draft.query[axisKey] as any) || {};
    const cur = (axis.combineMode || 'OR') as 'OR' | 'AND' | 'XOR';
    const next = cur === 'OR' ? 'AND' : cur === 'AND' ? 'XOR' : 'OR';
    updateQuery({ [axisKey]: { ...axis, combineMode: next }, [legacyKey]: undefined } as Partial<RuleQuery>);
  };
  const cycleAxisExclusionMode = (axisKey: AxisFieldName, legacyKey: LegacyFieldName) => {
    if (!draft) return;
    const axis = (draft.query[axisKey] as any) || {};
    const cur = (axis.exclusionMode || 'OR') as 'OR' | 'AND' | 'XOR';
    const next = cur === 'OR' ? 'AND' : cur === 'AND' ? 'XOR' : 'OR';
    updateQuery({ [axisKey]: { ...axis, exclusionMode: next }, [legacyKey]: undefined } as Partial<RuleQuery>);
  };
  const axisIncludeAll = (axisKey: AxisFieldName, legacyKey: LegacyFieldName, values: readonly string[]) => {
    if (!draft) return;
    const axis = (draft.query[axisKey] as any) || {};
    const states: Record<string, number> = { ...(axis.states || {}) };
    for (const v of values) states[v] = 1;
    updateQuery({ [axisKey]: { ...axis, states }, [legacyKey]: undefined } as Partial<RuleQuery>);
  };
  const axisExcludeAll = (axisKey: AxisFieldName, legacyKey: LegacyFieldName, values: readonly string[]) => {
    if (!draft) return;
    const axis = (draft.query[axisKey] as any) || {};
    const states: Record<string, number> = { ...(axis.states || {}) };
    for (const v of values) states[v] = 2;
    updateQuery({ [axisKey]: { ...axis, states }, [legacyKey]: undefined } as Partial<RuleQuery>);
  };
  const axisClear = (axisKey: AxisFieldName, legacyKey: LegacyFieldName) => {
    if (!draft) return;
    const axis = (draft.query[axisKey] as any) || {};
    updateQuery({ [axisKey]: { ...axis, states: {} }, [legacyKey]: undefined } as Partial<RuleQuery>);
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

  // Narrow K to only the array-typed fields. RuleQuery now has Record
  // fields too (tagStates / groupCombineModes / groupExclusionModes)
  // which can't be indexed via `[number]`, so the original signature
  // broke. Extract just the array-typed keys at the type level.
  type ArrayQueryKey = {
    [K in keyof RuleQuery]: RuleQuery[K] extends (infer _T)[] | undefined ? K : never;
  }[keyof RuleQuery];

  const toggleFromQueryArray = <K extends ArrayQueryKey>(
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
    const axisCount = (a: { states?: Record<string, number> } | undefined) => Object.keys(a?.states ?? {}).length;
    return (q.sourceFilterIds?.length ?? 0)
      + (q.levelFilters?.length ?? 0)
      + (q.schoolFilters?.length ?? 0)
      + (q.tagFilterIds?.length ?? 0)
      + Object.keys(q.tagStates ?? {}).length
      + (q.activationFilters?.length ?? 0)
      + (q.rangeFilters?.length ?? 0)
      + (q.durationFilters?.length ?? 0)
      + (q.shapeFilters?.length ?? 0)
      + (q.propertyFilters?.length ?? 0)
      + axisCount(q.source)
      + axisCount(q.level)
      + axisCount(q.school)
      + axisCount(q.activation)
      + axisCount(q.range)
      + axisCount(q.duration)
      + axisCount(q.shape)
      + axisCount(q.property);
  }, [draft]);

  return (
    // Fullscreen layout — toolbar shrinks to its natural height,
    // working grid (rules list | editor) fills the remaining
    // viewport. Mirrors /compendium/spells / /compendium/spells/
    // manage / /compendium/spell-lists.
    <div className="h-full flex flex-col gap-2 p-2">
      {/* Consolidated top toolbar: Back link + title chip +
          "How rules work" disclosure trigger + dirty banner. */}
      <div className="shrink-0 flex items-center gap-3 bg-card p-2 rounded-lg border border-gold/10 shadow-sm flex-wrap">
        <Link to="/compendium/classes">
          <Button variant="ghost" size="sm" className="h-8 text-gold gap-2 hover:bg-gold/5">
            <ChevronLeft className="w-4 h-4" />
            Back
          </Button>
        </Link>
        <span className="text-xs font-bold uppercase tracking-[0.18em] text-gold/70 shrink-0">Spell Rules</span>
        <span className="text-[11px] text-ink/45 tabular-nums">{rules.length} rules</span>
        <button
          type="button"
          onClick={() => setHowOpen(v => !v)}
          className="h-8 inline-flex items-center gap-1.5 px-2 rounded-md border border-gold/15 text-[10px] uppercase tracking-[0.18em] text-ink/65 hover:bg-gold/5 hover:text-gold transition-colors"
          aria-expanded={howOpen}
        >
          {howOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          <Info className="w-3 h-3" />
          How rules work
        </button>
        <div className="flex-1" />
        {draftDirty ? (
          <span className="text-[10px] uppercase tracking-[0.2em] text-amber-400 font-bold">Unsaved changes</span>
        ) : null}
      </div>

      {/* Expanded "How rules work" — only when explicitly opened.
          Keeps the toolbar slim by default; opens to a fixed-height
          strip with the full explainer. */}
      {howOpen ? (
        <div className="shrink-0 px-4 py-3 bg-background/30 border border-gold/10 rounded-md text-xs text-ink/75 space-y-1.5">
          <p>
            <span className="text-gold font-bold">A rule</span> is a saved spell-curation pattern — a
            <span className="text-gold"> tag query</span> (e.g. "all spells tagged <em>Divine</em> at level 1+")
            plus a <span className="text-gold">manual list</span> of spell IDs that always match.
          </p>
          <p>
            <span className="text-gold font-bold">Applying a rule</span> links it to a consumer (class, subclass, feat, item, etc.).
            The same rule can power many consumers — that's the point.
            For classes, application contributes to <code className="text-gold/80">class_spell_lists</code> at rebuild time;
            manual class entries are preserved.
          </p>
        </div>
      ) : null}

      {/* Working area — rules list (320px) | editor (1fr). Both
          cards fixed at paneHeight so they scroll internally and
          the viewport stays anchored. */}
      <div className="flex-1 min-h-0 grid gap-2 lg:grid-cols-[320px_minmax(0,1fr)]">
        {/* Rule list — flex column so the header strip pins to the
            top while the rule rows scroll within the remaining
            height. */}
        <Card
          className="border-gold/20 bg-card/50 overflow-hidden"
          style={{ height: `${paneHeight}px` }}
        >
          <CardContent className="p-0 h-full flex flex-col">
            <div className="border-b border-gold/10 px-4 py-3 flex items-center justify-between shrink-0">
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
              <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar divide-y divide-gold/5">
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

        {/* Editor — same paneHeight cap; CardContent scrolls
            internally so all the editor sections (name, query
            filters, manual spells, applied-to) stay reachable
            without a page-level scroll. */}
        <Card
          className="border-gold/20 bg-card/50 overflow-hidden"
          style={{ height: `${paneHeight}px` }}
        >
          <CardContent className="p-0 h-full overflow-y-auto custom-scrollbar">
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
                    // Filter state on this page IS the document being
                    // edited (draft.query → spell_rules.query JSON),
                    // not a transient page-level filter. Override the
                    // inline button label so "Reset" doesn't read as
                    // "reset to saved state" — it actually clears
                    // every chip in the rule's query. The dirty
                    // banner above the toolbar is the safety net.
                    resetInlineLabel="Clear query"
                    searchPlaceholder=""
                    filterTitle="Rule Filters"
                    renderFilters={
                      <>
                        <AxisFilterSection
                          title="Source"
                          values={sources.map(s => ({ value: s.id, label: String(s.abbreviation || s.shortName || s.name || s.id) }))}
                          states={draft.query.source?.states || {}}
                          cycleState={(v) => cycleAxisState('source', 'sourceFilterIds', v)}
                          combineMode={draft.query.source?.combineMode}
                          cycleCombineMode={() => cycleAxisCombineMode('source', 'sourceFilterIds')}
                          exclusionMode={draft.query.source?.exclusionMode}
                          cycleExclusionMode={() => cycleAxisExclusionMode('source', 'sourceFilterIds')}
                          includeAll={() => axisIncludeAll('source', 'sourceFilterIds', sources.map(s => s.id))}
                          excludeAll={() => axisExcludeAll('source', 'sourceFilterIds', sources.map(s => s.id))}
                          clearAll={() => axisClear('source', 'sourceFilterIds')}
                        />
                        <AxisFilterSection
                          title="Spell Level"
                          values={LEVEL_VALUES.map(lvl => ({ value: lvl, label: lvl === '0' ? 'Cantrip' : `Level ${lvl}` }))}
                          states={draft.query.level?.states || {}}
                          cycleState={(v) => cycleAxisState('level', 'levelFilters', v)}
                          combineMode={draft.query.level?.combineMode}
                          cycleCombineMode={() => cycleAxisCombineMode('level', 'levelFilters')}
                          exclusionMode={draft.query.level?.exclusionMode}
                          cycleExclusionMode={() => cycleAxisExclusionMode('level', 'levelFilters')}
                          includeAll={() => axisIncludeAll('level', 'levelFilters', LEVEL_VALUES)}
                          excludeAll={() => axisExcludeAll('level', 'levelFilters', LEVEL_VALUES)}
                          clearAll={() => axisClear('level', 'levelFilters')}
                        />
                        <AxisFilterSection
                          title="Spell School"
                          values={Object.entries(SCHOOL_LABELS).map(([k, label]) => ({ value: k, label }))}
                          states={draft.query.school?.states || {}}
                          cycleState={(v) => cycleAxisState('school', 'schoolFilters', v)}
                          combineMode={draft.query.school?.combineMode}
                          cycleCombineMode={() => cycleAxisCombineMode('school', 'schoolFilters')}
                          exclusionMode={draft.query.school?.exclusionMode}
                          cycleExclusionMode={() => cycleAxisExclusionMode('school', 'schoolFilters')}
                          includeAll={() => axisIncludeAll('school', 'schoolFilters', Object.keys(SCHOOL_LABELS))}
                          excludeAll={() => axisExcludeAll('school', 'schoolFilters', Object.keys(SCHOOL_LABELS))}
                          clearAll={() => axisClear('school', 'schoolFilters')}
                        />
                        <AxisFilterSection
                          title="Casting Time"
                          values={ACTIVATION_ORDER.map(b => ({ value: b, label: ACTIVATION_LABELS[b] }))}
                          states={draft.query.activation?.states || {}}
                          cycleState={(v) => cycleAxisState('activation', 'activationFilters', v)}
                          combineMode={draft.query.activation?.combineMode}
                          cycleCombineMode={() => cycleAxisCombineMode('activation', 'activationFilters')}
                          exclusionMode={draft.query.activation?.exclusionMode}
                          cycleExclusionMode={() => cycleAxisExclusionMode('activation', 'activationFilters')}
                          includeAll={() => axisIncludeAll('activation', 'activationFilters', ACTIVATION_ORDER as readonly string[])}
                          excludeAll={() => axisExcludeAll('activation', 'activationFilters', ACTIVATION_ORDER as readonly string[])}
                          clearAll={() => axisClear('activation', 'activationFilters')}
                        />
                        <AxisFilterSection
                          title="Range"
                          values={RANGE_ORDER.map(b => ({ value: b, label: RANGE_LABELS[b] }))}
                          states={draft.query.range?.states || {}}
                          cycleState={(v) => cycleAxisState('range', 'rangeFilters', v)}
                          combineMode={draft.query.range?.combineMode}
                          cycleCombineMode={() => cycleAxisCombineMode('range', 'rangeFilters')}
                          exclusionMode={draft.query.range?.exclusionMode}
                          cycleExclusionMode={() => cycleAxisExclusionMode('range', 'rangeFilters')}
                          includeAll={() => axisIncludeAll('range', 'rangeFilters', RANGE_ORDER as readonly string[])}
                          excludeAll={() => axisExcludeAll('range', 'rangeFilters', RANGE_ORDER as readonly string[])}
                          clearAll={() => axisClear('range', 'rangeFilters')}
                        />
                        <AxisFilterSection
                          title="Shape"
                          values={SHAPE_ORDER.map(b => ({ value: b, label: SHAPE_LABELS[b] }))}
                          states={draft.query.shape?.states || {}}
                          cycleState={(v) => cycleAxisState('shape', 'shapeFilters', v)}
                          combineMode={draft.query.shape?.combineMode}
                          cycleCombineMode={() => cycleAxisCombineMode('shape', 'shapeFilters')}
                          exclusionMode={draft.query.shape?.exclusionMode}
                          cycleExclusionMode={() => cycleAxisExclusionMode('shape', 'shapeFilters')}
                          includeAll={() => axisIncludeAll('shape', 'shapeFilters', SHAPE_ORDER as readonly string[])}
                          excludeAll={() => axisExcludeAll('shape', 'shapeFilters', SHAPE_ORDER as readonly string[])}
                          clearAll={() => axisClear('shape', 'shapeFilters')}
                        />
                        <AxisFilterSection
                          title="Duration"
                          values={DURATION_ORDER.map(b => ({ value: b, label: DURATION_LABELS[b] }))}
                          states={draft.query.duration?.states || {}}
                          cycleState={(v) => cycleAxisState('duration', 'durationFilters', v)}
                          combineMode={draft.query.duration?.combineMode}
                          cycleCombineMode={() => cycleAxisCombineMode('duration', 'durationFilters')}
                          exclusionMode={draft.query.duration?.exclusionMode}
                          cycleExclusionMode={() => cycleAxisExclusionMode('duration', 'durationFilters')}
                          includeAll={() => axisIncludeAll('duration', 'durationFilters', DURATION_ORDER as readonly string[])}
                          excludeAll={() => axisExcludeAll('duration', 'durationFilters', DURATION_ORDER as readonly string[])}
                          clearAll={() => axisClear('duration', 'durationFilters')}
                        />
                        <AxisFilterSection
                          title="Properties"
                          values={PROPERTY_ORDER.map(p => ({ value: p, label: PROPERTY_LABELS[p] }))}
                          states={draft.query.property?.states || {}}
                          cycleState={(v) => cycleAxisState('property', 'propertyFilters', v)}
                          combineMode={draft.query.property?.combineMode}
                          cycleCombineMode={() => cycleAxisCombineMode('property', 'propertyFilters')}
                          exclusionMode={draft.query.property?.exclusionMode}
                          cycleExclusionMode={() => cycleAxisExclusionMode('property', 'propertyFilters')}
                          includeAll={() => axisIncludeAll('property', 'propertyFilters', PROPERTY_ORDER as readonly string[])}
                          excludeAll={() => axisExcludeAll('property', 'propertyFilters', PROPERTY_ORDER as readonly string[])}
                          clearAll={() => axisClear('property', 'propertyFilters')}
                        />

                        {/* Tags + per-group AND/OR/XOR live in an
                            Advanced Options disclosure. Most rules use
                            level/school/source/buckets only; tags are
                            opt-in for the longer-tail queries. */}
                        <details className="group">
                          <summary className="cursor-pointer list-none flex items-center justify-between border border-gold/15 rounded-md px-4 py-2 hover:border-gold/30 transition-colors">
                            <span className="text-xs font-bold uppercase tracking-[0.2em] text-gold/80">
                              Advanced Options — Tags
                              {Object.keys(draft.query.tagStates ?? {}).length > 0 && (
                                <span className="ml-2 text-gold/60">({Object.keys(draft.query.tagStates ?? {}).length} selected)</span>
                              )}
                            </span>
                            <span className="text-[10px] text-ink/40 group-open:rotate-90 transition-transform">▶</span>
                          </summary>
                          <div className="mt-4 space-y-6 pl-1">
                            {tagGroups.map(group => (
                              <TagGroupFilter
                                key={group.id}
                                group={group}
                                tags={(tagsByGroup[group.id] || []) as any}
                                tagStates={draft.query.tagStates || {}}
                                setTagStates={(next) => updateQuery({ tagStates: typeof next === 'function' ? next(draft.query.tagStates || {}) : next, tagFilterIds: undefined })}
                                cycleTagState={(tagId) => {
                                  const cur = (draft.query.tagStates || {})[tagId] || 0;
                                  const nextState = cur === 0 ? 1 : cur === 1 ? 2 : 0;
                                  const nextStates = { ...(draft.query.tagStates || {}) };
                                  if (nextState === 0) delete nextStates[tagId];
                                  else nextStates[tagId] = nextState;
                                  updateQuery({ tagStates: nextStates, tagFilterIds: undefined });
                                }}
                                combineMode={(draft.query.groupCombineModes || {})[group.id]}
                                cycleGroupMode={(groupId) => {
                                  const cur = (draft.query.groupCombineModes || {})[groupId] || 'OR';
                                  const nextMode = cur === 'OR' ? 'AND' : cur === 'AND' ? 'XOR' : 'OR';
                                  updateQuery({ groupCombineModes: { ...(draft.query.groupCombineModes || {}), [groupId]: nextMode } });
                                }}
                                exclusionMode={(draft.query.groupExclusionModes || {})[group.id]}
                                cycleExclusionMode={(groupId) => {
                                  const cur = (draft.query.groupExclusionModes || {})[groupId] || 'OR';
                                  const nextMode = cur === 'OR' ? 'AND' : cur === 'AND' ? 'XOR' : 'OR';
                                  updateQuery({ groupExclusionModes: { ...(draft.query.groupExclusionModes || {}), [groupId]: nextMode } });
                                }}
                              />
                            ))}
                          </div>
                        </details>
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

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronLeft, ChevronRight, Edit3, Plus, Save, Search, Trash2, Wand2, X } from 'lucide-react';
import { toast } from 'sonner';
import SpellImportWorkbench from '../../components/compendium/SpellImportWorkbench';
import { FilterBar, AxisFilterSection, TagGroupFilter, matchesTagFilters } from '../../components/compendium/FilterBar';
import {
  matchesSingleAxisFilter,
  matchesMultiAxisFilter,
  deriveSpellFilterFacets,
  ACTIVATION_ORDER,
  ACTIVATION_LABELS,
  RANGE_ORDER,
  RANGE_LABELS,
  DURATION_ORDER,
  DURATION_LABELS,
  SHAPE_ORDER,
  SHAPE_LABELS,
  PROPERTY_ORDER,
  PROPERTY_LABELS,
  type PropertyFilter,
} from '../../lib/spellFilters';
import { expandTagsWithAncestors } from '../../lib/tagHierarchy';
import ActivityEditor from '../../components/compendium/ActivityEditor';
import ActiveEffectEditor from '../../components/compendium/ActiveEffectEditor';
import MarkdownEditor from '../../components/MarkdownEditor';
import { reportClientError, OperationType } from '../../lib/firebase';
import { upsertSpell, deleteSpell, fetchSpell, purgeAllSpells } from '../../lib/compendium';
import { fetchCollection } from '../../lib/d1';
import { orderTagsAsTree, normalizeTagRow } from '../../lib/tagHierarchy';
import { slugify } from '../../lib/utils';
import { bbcodeToHtml } from '../../lib/bbcode';
import { Database, CloudOff } from 'lucide-react';
import { SCHOOL_LABELS, backfillSpellDescriptionsFromFoundry } from '../../lib/spellImport';
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
import SingleSelectSearch from '../../components/ui/SingleSelectSearch';
import {
  RECOVERY_PERIOD_OPTIONS,
  RECOVERY_TYPE_OPTIONS,
} from '../../components/compendium/activity/constants';
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
  // `long` is dnd5e's second range value, used by attack-style spells with
  // a normal + long increment (Eldritch Blast, Firebolt-like ranged attacks).
  // Most spells leave it blank; on export it lands at `system.range.long`.
  range: { value: number | string; long: number | string; units: string; special: string };
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
  range: { value: 0, long: '', units: 'self', special: '' },
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
  const isAdmin = userProfile?.role === 'admin';
  const [backfilling, setBackfilling] = useState(false);
  const [purging, setPurging] = useState(false);

  // Fullscreen-page opt-in — hides the global footer and strips
  // <main>'s container padding so the editor (and the Foundry
  // Import workbench when its tab is active) gets the full viewport.
  // Lives on the outer wrapper, not just the manual editor, so the
  // class is set regardless of which tab is active.
  useEffect(() => {
    document.body.classList.add('spell-list-fullscreen');
    return () => document.body.classList.remove('spell-list-fullscreen');
  }, []);

  const handleBackfillDescriptions = async () => {
    if (!confirm(
      'This will regenerate the BBCode description of every spell from its ' +
      'preserved Foundry HTML payload (foundry_data.description.value). ' +
      'Existing descriptions will be overwritten. Spells without a Foundry ' +
      'payload are skipped. Continue?'
    )) return;
    setBackfilling(true);
    try {
      const result = await backfillSpellDescriptionsFromFoundry();
      toast.success(
        `Backfilled ${result.updated} of ${result.scanned} spells ` +
        `(${result.skipped} unchanged${result.errors.length ? `, ${result.errors.length} errors` : ''})`
      );
      if (result.errors.length) {
        // eslint-disable-next-line no-console
        console.warn('Backfill errors:', result.errors);
      }
    } catch (err: any) {
      toast.error(`Backfill failed: ${err?.message ?? err}`);
    } finally {
      setBackfilling(false);
    }
  };

  const handlePurgeAllSpells = async () => {
    // Two-stage confirm because the action is irreversible. The second
    // prompt requires the user to type the literal string so muscle-
    // memory enter-presses don't blow away the catalogue.
    if (!confirm(
      'PURGE ALL SPELLS will delete every row in the spells table — ' +
      'manual entries, Foundry imports, descriptions, tags, everything. ' +
      'This is meant for clean-slating before a fresh import. ' +
      'Are you sure?'
    )) return;
    const phrase = prompt('Type "DELETE ALL SPELLS" exactly to confirm:');
    if (phrase !== 'DELETE ALL SPELLS') {
      toast.error('Phrase did not match. Nothing deleted.');
      return;
    }
    setPurging(true);
    try {
      const removed = await purgeAllSpells();
      toast.success(`Purged ${removed} spells.`);
    } catch (err: any) {
      toast.error(`Purge failed: ${err?.message ?? err}`);
    } finally {
      setPurging(false);
    }
  };

  return (
    // Fullscreen page wrapper. The body class strips <main>'s padding,
    // and `h-full` here makes us fill the available viewport-minus-
    // navbar. flex-col lets the toolbar shrink to its natural height
    // and the active tab claim the rest.
    <Tabs defaultValue="manual-editor" className="h-full flex flex-col gap-2 p-2">
      {/* Single consolidated top toolbar — Back link + tab switcher +
          admin maintenance actions (Backfill / Purge) all on one row
          so the editor content below doesn't get pushed off-screen.
          Previously these were spread across three separate rows. */}
      <div className="shrink-0 flex items-center gap-2 bg-card p-2 rounded-lg border border-gold/10 shadow-sm flex-wrap">
        <Link to="/compendium/spells">
          <Button variant="ghost" size="sm" className="h-8 text-gold gap-2 hover:bg-gold/5">
            <ChevronLeft className="w-4 h-4" />
            Back To Spells
          </Button>
        </Link>
        <TabsList variant="line" className="gap-1 bg-transparent p-0">
          <TabsTrigger
            value="foundry-import"
            className="h-8 rounded-md border border-gold/15 bg-background/30 px-3 py-1 text-xs uppercase tracking-[0.18em] text-ink/65 data-active:border-gold/40 data-active:bg-gold/10 data-active:text-gold"
          >
            Foundry Import
          </TabsTrigger>
          <TabsTrigger
            value="manual-editor"
            className="h-8 rounded-md border border-gold/15 bg-background/30 px-3 py-1 text-xs uppercase tracking-[0.18em] text-ink/65 data-active:border-gold/40 data-active:bg-gold/10 data-active:text-gold"
          >
            Manual Editor
          </TabsTrigger>
        </TabsList>
        {/* Spacer pushes admin maintenance actions to the right. */}
        <div className="flex-1" />
        {isAdmin && (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleBackfillDescriptions}
              disabled={backfilling || purging}
              className="h-8 border-gold/30 text-gold/80 hover:bg-gold/5 hover:text-gold text-xs uppercase tracking-widest"
              title="Regenerate every spell's BBCode description from its preserved Foundry HTML payload."
            >
              <Wand2 className="w-3.5 h-3.5 mr-1.5" />
              {backfilling ? 'Backfilling…' : 'Backfill'}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handlePurgeAllSpells}
              disabled={backfilling || purging}
              className="h-8 border-blood/30 text-blood/80 hover:bg-blood/5 hover:text-blood text-xs uppercase tracking-widest"
              title="Delete every row in the spells table. Meant for clean-slate before reimport."
            >
              <Trash2 className="w-3.5 h-3.5 mr-1.5" />
              {purging ? 'Purging…' : 'Purge All'}
            </Button>
          </>
        )}
      </div>

      {/* flex-1 min-h-0 = "fill the rest of the viewport but allow my
          children to clip when they overflow". Without this, long
          editor content would force the page to scroll. */}
      <TabsContent value="foundry-import" className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
        <SpellImportWorkbench userProfile={userProfile} />
      </TabsContent>

      <TabsContent value="manual-editor" className="flex-1 min-h-0">
        <SpellManualEditor userProfile={userProfile} />
      </TabsContent>
    </Tabs>
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
  // Filter modal state. Mirrors the AxisFilter shape from
  // src/pages/compendium/SpellList.tsx so the modal layout +
  // chip semantics (3-state include/exclude + per-axis combine
  // modes) match the public browser. Scoped to the three axes
  // most useful for editing — Source, Level, School. Adding more
  // axes is a matter of declaring more AxisFilterSection entries
  // in renderFilters below.
  type AxisState = { states: Record<string, number>; combineMode?: 'AND' | 'OR' | 'XOR'; exclusionMode?: 'AND' | 'OR' | 'XOR' };
  const [axisFilters, setAxisFilters] = useState<Record<string, AxisState>>({});
  // Rich tag filter state — same shape used everywhere else in the
  // app (SpellList, SpellRulesEditor, SpellListManager). 3-state
  // tagStates (0=neutral, 1=include, 2=exclude), per-group AND/OR/XOR
  // include and exclusion combinators. Lets admins slice the spell
  // list by tag membership to audit consistency.
  const [tagStates, setTagStates] = useState<Record<string, number>>({});
  const [groupCombineModes, setGroupCombineModes] = useState<Record<string, 'AND' | 'OR' | 'XOR'>>({});
  const [groupExclusionModes, setGroupExclusionModes] = useState<Record<string, 'AND' | 'OR' | 'XOR'>>({});
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  // Mirror of `editingId` for use inside async handlers — captures
  // the CURRENT selection at the moment the await resolves, not the
  // one closed over at function-call time. Lets the save handler
  // tell "user navigated away while the save was in flight" from
  // "user still on this spell" so we can update the form
  // appropriately (or leave their nav alone).
  const editingIdRef = useRef<string | null>(null);
  useEffect(() => { editingIdRef.current = editingId; }, [editingId]);
  const [isFoundationUsingD1, setIsFoundationUsingD1] = useState(false);

  // Viewport-derived pane height. The chrome we subtract for: navbar
  // (~56) + outer page toolbar with Back / tab switcher / Backfill /
  // Purge (~50) + this manual editor's search toolbar (~50) + page
  // padding/gaps (~24) = ~180. Slight underestimate is fine.
  // (Body-class fullscreen toggle moved to the outer SpellsEditor
  // wrapper so it applies regardless of which tab is active.)
  const [paneHeight, setPaneHeight] = useState<number>(() =>
    typeof window === 'undefined' ? 720 : Math.max(420, window.innerHeight - 200),
  );
  useEffect(() => {
    const onResize = () => setPaneHeight(Math.max(420, window.innerHeight - 200));
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Single mapping function so all three spell-load sites (initial,
  // post-save refresh, post-delete refresh) produce identical entry
  // shapes — including the derived filter facets (activationBucket,
  // rangeBucket, durationBucket, shapeBucket, properties, etc.) the
  // filter modal needs. Without facets the bucket axes can't match
  // anything because filteredEntries reads `entry.activationBucket`
  // and friends. Matches the same mapping SpellList.tsx does so the
  // editor's filter chips slice the catalogue identically.
  const mapSpellRow = (row: any) => {
    // d1.ts's queryD1 auto-parses fixed JSON columns including `tags`
    // and `foundry_data` — so we usually already see arrays / objects.
    // The string fallbacks here are defensive in case a future code
    // path bypasses that auto-parse (e.g. raw worker output).
    const parseJsonCol = <T,>(v: unknown, fallback: T): T => {
      if (typeof v === 'string') {
        try { return JSON.parse(v) as T; } catch { return fallback; }
      }
      return (v ?? fallback) as T;
    };
    return {
      ...row,
      sourceId: row.source_id,
      imageUrl: row.image_url,
      level: Number(row.level || 0),
      school: row.school,
      preparationMode: row.preparation_mode,
      tagIds: parseJsonCol<string[]>(row.tags, []),
      foundryShell: parseJsonCol<any>(row.foundry_data, null),
      ...deriveSpellFilterFacets(row),
    };
  };

  useEffect(() => {
    if (!isAdmin) return;

    const loadEntries = async () => {
      try {
        const data = await fetchCollection<any>('spells', { orderBy: 'name ASC' });
        const mapped = data.map(mapSpellRow);
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

  // Tag indices used by the rich tag filter and matchesTagFilters:
  //   - tagsByGroup: group_id -> tag[] (drives the TagGroupFilter sections).
  //   - parentByTagId: tag_id -> parent_tag_id|null (used by
  //     matchesTagFilters to do subtag-aware matching).
  const tagsByGroup = useMemo(() => {
    const out: Record<string, any[]> = {};
    for (const tag of tags) {
      const gid = String(tag.groupId ?? '');
      if (!gid) continue;
      if (!out[gid]) out[gid] = [];
      out[gid].push(tag);
    }
    return out;
  }, [tags]);
  const parentByTagId = useMemo(() => {
    const out = new Map<string, string | null>();
    for (const tag of tags) out.set(String(tag.id), tag.parentTagId ? String(tag.parentTagId) : null);
    return out;
  }, [tags]);

  // Abbreviation lookup for the compact left-column spell rows. Falls
  // back through abbreviation → shortName → name → id so a row always
  // has SOMETHING in the Src column.
  const sourceAbbrevById = useMemo(
    () => Object.fromEntries(sources.map((source) => [
      source.id,
      source.abbreviation || source.shortName || source.name || source.id,
    ])),
    [sources]
  );

  const filteredEntries = useMemo(() => {
    const lowered = search.trim().toLowerCase();
    return entries.filter((entry) => {
      // Search match — name / identifier / source label substring.
      if (lowered) {
        const sourceLabel = String(sourceNameById[entry.sourceId] || '').toLowerCase();
        const matchesSearch = String(entry.name || '').toLowerCase().includes(lowered)
          || String(entry.identifier || '').toLowerCase().includes(lowered)
          || sourceLabel.includes(lowered);
        if (!matchesSearch) return false;
      }
      // Axis filters. matchesSingleAxisFilter returns true when the
      // axis has no chip activity (i.e. an undefined filter state is
      // "match anything"). Multi-valued Properties uses
      // matchesMultiAxisFilter (a spell can have V+S+M simultaneously).
      if (!matchesSingleAxisFilter(String(entry.sourceId ?? ''), axisFilters.source)) return false;
      if (!matchesSingleAxisFilter(String(Number(entry.level ?? 0)), axisFilters.level)) return false;
      if (!matchesSingleAxisFilter(String(entry.school ?? ''), axisFilters.school)) return false;
      if (!matchesSingleAxisFilter(entry.activationBucket, axisFilters.activation)) return false;
      if (!matchesSingleAxisFilter(entry.rangeBucket,      axisFilters.range))      return false;
      if (!matchesSingleAxisFilter(entry.durationBucket,   axisFilters.duration))   return false;
      if (!matchesSingleAxisFilter(entry.shapeBucket,      axisFilters.shape))      return false;

      // Properties (multi-valued) — assemble the "what this spell
      // has" set from the entry's facet flags so the chip set checks
      // against an accurate membership.
      const propsHave = new Set<PropertyFilter>();
      if (entry.concentration) propsHave.add('concentration');
      if (entry.ritual) propsHave.add('ritual');
      if (entry.hasV) propsHave.add('vocal');
      if (entry.hasS) propsHave.add('somatic');
      if (entry.hasM) propsHave.add('material');
      if (!matchesMultiAxisFilter(propsHave, axisFilters.property)) return false;

      // Tag filtering — ancestor-expand the entry's tags so a parent
      // include-chip matches a spell tagged with any subtag of it,
      // then run the rich tag matcher. matchesTagFilters arg order:
      // (entityTagIds, tagGroups, tagsByGroup, tagStates, combine, exclusion).
      const tagIds: string[] = Array.isArray(entry.tagIds) ? entry.tagIds : [];
      const effectiveTags = expandTagsWithAncestors(tagIds, parentByTagId);
      if (!matchesTagFilters(effectiveTags, tagGroups, tagsByGroup, tagStates, groupCombineModes, groupExclusionModes)) return false;

      return true;
    });
  }, [entries, search, sourceNameById, axisFilters, tagStates, tagGroups, tagsByGroup, groupCombineModes, groupExclusionModes, parentByTagId]);

  const resetForm = () => {
    setEditingId(null);
    setFormData(makeInitialSpellForm(sources));
  };

  // ============================================================
  // Filter helpers — mirror the SpellList browser implementation
  // so the chip semantics (3-state + AND/OR/XOR combine + invert)
  // match exactly. Each helper acts on a named axis (`source`,
  // `level`, `school`) inside the unified `axisFilters` record.
  // ============================================================
  const cycleAxisState = (axisKey: string, value: string) => {
    setAxisFilters(prev => {
      const cur = prev[axisKey] || { states: {} };
      const state = cur.states[value] || 0;
      const next = (state + 1) % 3;
      const states = { ...cur.states };
      if (next === 0) delete states[value]; else states[value] = next;
      return { ...prev, [axisKey]: { ...cur, states } };
    });
  };
  const cycleAxisCombineMode = (axisKey: string) => {
    setAxisFilters(prev => {
      const cur = prev[axisKey] || { states: {} };
      const m = cur.combineMode || 'OR';
      const next: 'AND' | 'OR' | 'XOR' = m === 'OR' ? 'AND' : m === 'AND' ? 'XOR' : 'OR';
      return { ...prev, [axisKey]: { ...cur, combineMode: next } };
    });
  };
  const cycleAxisExclusionMode = (axisKey: string) => {
    setAxisFilters(prev => {
      const cur = prev[axisKey] || { states: {} };
      const m = cur.exclusionMode || 'OR';
      const next: 'AND' | 'OR' | 'XOR' = m === 'OR' ? 'AND' : m === 'AND' ? 'XOR' : 'OR';
      return { ...prev, [axisKey]: { ...cur, exclusionMode: next } };
    });
  };
  const axisIncludeAll = (axisKey: string, values: readonly string[]) => {
    setAxisFilters(prev => {
      const cur = prev[axisKey] || { states: {} };
      const states: Record<string, number> = {};
      for (const v of values) states[v] = 1;
      return { ...prev, [axisKey]: { ...cur, states } };
    });
  };
  const axisExcludeAll = (axisKey: string, values: readonly string[]) => {
    setAxisFilters(prev => {
      const cur = prev[axisKey] || { states: {} };
      const states: Record<string, number> = {};
      for (const v of values) states[v] = 2;
      return { ...prev, [axisKey]: { ...cur, states } };
    });
  };
  const axisClear = (axisKey: string) => {
    setAxisFilters(prev => {
      const next = { ...prev };
      delete next[axisKey];
      return next;
    });
  };

  const activeFilterCount =
    Object.keys(axisFilters.source?.states ?? {}).length
    + Object.keys(axisFilters.level?.states ?? {}).length
    + Object.keys(axisFilters.school?.states ?? {}).length
    + Object.keys(axisFilters.activation?.states ?? {}).length
    + Object.keys(axisFilters.range?.states ?? {}).length
    + Object.keys(axisFilters.duration?.states ?? {}).length
    + Object.keys(axisFilters.shape?.states ?? {}).length
    + Object.keys(axisFilters.property?.states ?? {}).length
    + Object.values(tagStates).filter(s => s === 1 || s === 2).length;

  const resetAllFilters = () => {
    setAxisFilters({});
    setTagStates({});
    setGroupCombineModes({});
    setGroupExclusionModes({});
  };

  // Tag filter helpers — single-tag cycle and per-group combinator
  // cycles. Match the same handlers SpellList.tsx wires into
  // <TagGroupFilter>.
  const cycleTagState = (tagId: string) => {
    setTagStates(prev => {
      const cur = prev[tagId] || 0;
      const next = (cur + 1) % 3;
      const out = { ...prev };
      if (next === 0) delete out[tagId]; else out[tagId] = next;
      return out;
    });
  };
  const cycleGroupMode = (groupId: string) => {
    setGroupCombineModes(prev => {
      const cur = prev[groupId] || 'OR';
      const next: 'AND' | 'OR' | 'XOR' = cur === 'OR' ? 'AND' : cur === 'AND' ? 'XOR' : 'OR';
      return { ...prev, [groupId]: next };
    });
  };
  const cycleGroupExclusionMode = (groupId: string) => {
    setGroupExclusionModes(prev => {
      const cur = prev[groupId] || 'OR';
      const next: 'AND' | 'OR' | 'XOR' = cur === 'OR' ? 'AND' : cur === 'AND' ? 'XOR' : 'OR';
      return { ...prev, [groupId]: next };
    });
  };

  // Options for the filter modal sections. Levels: 0-9. Schools:
  // pulled from the SPELL_SCHOOLS const used elsewhere in this
  // file so the labels match the editor's school dropdown.
  const LEVEL_FILTER_OPTIONS = useMemo(
    () => Array.from({ length: 10 }, (_, i) => ({ value: String(i), label: i === 0 ? 'Cantrip' : `Level ${i}` })),
    [],
  );
  const SCHOOL_FILTER_OPTIONS = useMemo(
    () => SPELL_SCHOOLS.map(([value, label]) => ({ value, label })),
    [],
  );

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
          long: system?.range?.long ?? '',
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

      // Determine the id we're saving against up front so subsequent
      // refresh logic has a stable target even if editingId changes
      // while the await is in flight.
      const editingIdAtStart = editingId;
      const wasCreate = !editingIdAtStart;
      const savedId = editingIdAtStart || crypto.randomUUID();

      await upsertSpell(savedId, {
        ...payload,
        createdAt: editingIdAtStart
          ? (formData.createdAt || new Date().toISOString())
          : new Date().toISOString(),
      });
      toast.success(wasCreate ? 'Spell created' : 'Spell updated');

      // Refresh entries list so the left column reflects the new
      // name / level / source / etc. without a full page reload.
      const updatedData = await fetchCollection<any>('spells', { orderBy: 'name ASC' });
      setEntries(updatedData.map(mapSpellRow));

      // Refresh the just-saved spell's cache. Two reasons:
      //   1. If the user clicks away and back, they see fresh data
      //      instead of the pre-save snapshot we had cached when
      //      they first selected it.
      //   2. Server normalization (slugified identifier, timestamp,
      //      etc.) only shows up in the next read, so the in-memory
      //      cache would diverge from D1 otherwise.
      try {
        const refreshed = await fetchSpell(savedId);
        if (refreshed) {
          setSpellDetailsById(prev => ({ ...prev, [savedId]: refreshed }));
        }
      } catch (err) {
        // Refresh is best-effort — the save itself already
        // succeeded. Don't surface to the user.
        // eslint-disable-next-line no-console
        console.warn('[SpellsEditor] post-save refresh failed:', err);
      }

      // If the user is still on the spell they were saving (or just
      // created a new spell and hasn't navigated yet), adopt the
      // saved id as the editing target. This:
      //   - On UPDATE: no-op (editingId already === savedId).
      //   - On CREATE: switches from "New Spell" mode to "editing
      //     the just-created spell" so subsequent edits route to
      //     the same row instead of creating duplicates.
      // If the user navigated away during the save, leave their
      // current selection alone — don't yank them back.
      if (editingIdRef.current === editingIdAtStart) {
        setEditingId(savedId);
      }
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
      setEntries(updatedData.map(mapSpellRow));

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

  // Inner-list height for the left column's VirtualizedList. Pane
  // minus the small header strip (~36px) above the rows.
  const listInnerHeight = Math.max(200, paneHeight - 40);

  return (
    // Fullscreen layout — toolbar on top, 3-column grid filling the
    // remaining viewport. Mirrors src/pages/compendium/SpellList.tsx
    // so editor + browser share the same rhythm. No outer padding
    // because the parent Tabs root (in SpellsEditor) already pads.
    <div className="h-full flex flex-col gap-2">
      {/* Toolbar — uses the shared FilterBar component for search +
          Filters modal + inline Reset. trailingActions slot carries
          the result count and the New Spell button. Per-spell
          actions (Save / Delete / Reset Form) live in the editor
          card header further down because they only make sense
          when there's a spell loaded. */}
      <div className="shrink-0">
        <FilterBar
          search={search}
          setSearch={setSearch}
          isFilterOpen={isFilterOpen}
          setIsFilterOpen={setIsFilterOpen}
          activeFilterCount={activeFilterCount}
          resetFilters={resetAllFilters}
          searchPlaceholder="Search spell name, source, or identifier"
          filterTitle="Advanced Filters"
          resetLabel="Reset Filters"
          trailingActions={
            <>
              <div
                className="text-[11px] font-mono tabular-nums text-ink/55 whitespace-nowrap px-1"
                title={`${filteredEntries.length} of ${entries.length} total`}
              >
                {loading ? '— / —' : `${filteredEntries.length} / ${entries.length}`}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={resetForm}
                className="h-8 gap-2 border-gold/20 text-gold hover:bg-gold/5"
              >
                <Plus className="w-3 h-3" /> New Spell
              </Button>
            </>
          }
          renderFilters={
            <>
              {/* Source / Level / School filter chips with the same
                  3-state include/exclude semantics as the public
                  Spell List browser. */}
              <AxisFilterSection
                title="Sources"
                values={sources.map((source) => ({
                  value: source.id,
                  label: String(source.abbreviation || source.shortName || source.name || source.id),
                }))}
                states={axisFilters.source?.states || {}}
                cycleState={(v) => cycleAxisState('source', v)}
                combineMode={axisFilters.source?.combineMode}
                cycleCombineMode={() => cycleAxisCombineMode('source')}
                exclusionMode={axisFilters.source?.exclusionMode}
                cycleExclusionMode={() => cycleAxisExclusionMode('source')}
                includeAll={() => axisIncludeAll('source', sources.map((s) => s.id))}
                excludeAll={() => axisExcludeAll('source', sources.map((s) => s.id))}
                clearAll={() => axisClear('source')}
              />
              <AxisFilterSection
                title="Spell Level"
                values={LEVEL_FILTER_OPTIONS}
                states={axisFilters.level?.states || {}}
                cycleState={(v) => cycleAxisState('level', v)}
                combineMode={axisFilters.level?.combineMode}
                cycleCombineMode={() => cycleAxisCombineMode('level')}
                exclusionMode={axisFilters.level?.exclusionMode}
                cycleExclusionMode={() => cycleAxisExclusionMode('level')}
                includeAll={() => axisIncludeAll('level', LEVEL_FILTER_OPTIONS.map((o) => o.value))}
                excludeAll={() => axisExcludeAll('level', LEVEL_FILTER_OPTIONS.map((o) => o.value))}
                clearAll={() => axisClear('level')}
              />
              <AxisFilterSection
                title="Spell School"
                values={SCHOOL_FILTER_OPTIONS}
                states={axisFilters.school?.states || {}}
                cycleState={(v) => cycleAxisState('school', v)}
                combineMode={axisFilters.school?.combineMode}
                cycleCombineMode={() => cycleAxisCombineMode('school')}
                exclusionMode={axisFilters.school?.exclusionMode}
                cycleExclusionMode={() => cycleAxisExclusionMode('school')}
                includeAll={() => axisIncludeAll('school', SCHOOL_FILTER_OPTIONS.map((o) => o.value))}
                excludeAll={() => axisExcludeAll('school', SCHOOL_FILTER_OPTIONS.map((o) => o.value))}
                clearAll={() => axisClear('school')}
              />
              {/* Bucket axes — Casting Time, Range, Duration, Shape.
                  Same constants the public browser uses so the editor's
                  filter vocabulary matches `/compendium/spells`. */}
              <AxisFilterSection
                title="Casting Time"
                values={ACTIVATION_ORDER.map((b) => ({ value: b, label: ACTIVATION_LABELS[b] }))}
                states={axisFilters.activation?.states || {}}
                cycleState={(v) => cycleAxisState('activation', v)}
                combineMode={axisFilters.activation?.combineMode}
                cycleCombineMode={() => cycleAxisCombineMode('activation')}
                exclusionMode={axisFilters.activation?.exclusionMode}
                cycleExclusionMode={() => cycleAxisExclusionMode('activation')}
                includeAll={() => axisIncludeAll('activation', ACTIVATION_ORDER as readonly string[])}
                excludeAll={() => axisExcludeAll('activation', ACTIVATION_ORDER as readonly string[])}
                clearAll={() => axisClear('activation')}
              />
              <AxisFilterSection
                title="Range"
                values={RANGE_ORDER.map((b) => ({ value: b, label: RANGE_LABELS[b] }))}
                states={axisFilters.range?.states || {}}
                cycleState={(v) => cycleAxisState('range', v)}
                combineMode={axisFilters.range?.combineMode}
                cycleCombineMode={() => cycleAxisCombineMode('range')}
                exclusionMode={axisFilters.range?.exclusionMode}
                cycleExclusionMode={() => cycleAxisExclusionMode('range')}
                includeAll={() => axisIncludeAll('range', RANGE_ORDER as readonly string[])}
                excludeAll={() => axisExcludeAll('range', RANGE_ORDER as readonly string[])}
                clearAll={() => axisClear('range')}
              />
              <AxisFilterSection
                title="Duration"
                values={DURATION_ORDER.map((b) => ({ value: b, label: DURATION_LABELS[b] }))}
                states={axisFilters.duration?.states || {}}
                cycleState={(v) => cycleAxisState('duration', v)}
                combineMode={axisFilters.duration?.combineMode}
                cycleCombineMode={() => cycleAxisCombineMode('duration')}
                exclusionMode={axisFilters.duration?.exclusionMode}
                cycleExclusionMode={() => cycleAxisExclusionMode('duration')}
                includeAll={() => axisIncludeAll('duration', DURATION_ORDER as readonly string[])}
                excludeAll={() => axisExcludeAll('duration', DURATION_ORDER as readonly string[])}
                clearAll={() => axisClear('duration')}
              />
              <AxisFilterSection
                title="Shape"
                values={SHAPE_ORDER.map((b) => ({ value: b, label: SHAPE_LABELS[b] }))}
                states={axisFilters.shape?.states || {}}
                cycleState={(v) => cycleAxisState('shape', v)}
                combineMode={axisFilters.shape?.combineMode}
                cycleCombineMode={() => cycleAxisCombineMode('shape')}
                exclusionMode={axisFilters.shape?.exclusionMode}
                cycleExclusionMode={() => cycleAxisExclusionMode('shape')}
                includeAll={() => axisIncludeAll('shape', SHAPE_ORDER as readonly string[])}
                excludeAll={() => axisExcludeAll('shape', SHAPE_ORDER as readonly string[])}
                clearAll={() => axisClear('shape')}
              />
              <AxisFilterSection
                title="Properties"
                values={PROPERTY_ORDER.map((b) => ({ value: b, label: PROPERTY_LABELS[b] }))}
                states={axisFilters.property?.states || {}}
                cycleState={(v) => cycleAxisState('property', v)}
                combineMode={axisFilters.property?.combineMode}
                cycleCombineMode={() => cycleAxisCombineMode('property')}
                exclusionMode={axisFilters.property?.exclusionMode}
                cycleExclusionMode={() => cycleAxisExclusionMode('property')}
                includeAll={() => axisIncludeAll('property', PROPERTY_ORDER as readonly string[])}
                excludeAll={() => axisExcludeAll('property', PROPERTY_ORDER as readonly string[])}
                clearAll={() => axisClear('property')}
              />
              {/* Tag groups — collapsible Advanced Options below the
                  base axes. Same components SpellList uses, so the
                  tagging-consistency audit experience matches the
                  public browser. */}
              <details className="border border-gold/10 rounded-md bg-background/20">
                <summary className="px-3 py-2 text-xs uppercase tracking-[0.18em] text-ink/65 cursor-pointer hover:bg-gold/5">
                  Tag Groups
                  {Object.values(tagStates).filter(s => s === 1 || s === 2).length > 0 && (
                    <span className="ml-2 text-gold/70 normal-case tracking-normal">
                      ({Object.values(tagStates).filter(s => s === 1 || s === 2).length} chips active)
                    </span>
                  )}
                </summary>
                <div className="px-3 py-3 space-y-3 border-t border-gold/10">
                  {tagGroups.map(group => (
                    <TagGroupFilter
                      key={group.id}
                      group={group}
                      tags={tagsByGroup[group.id] || []}
                      tagStates={tagStates}
                      setTagStates={setTagStates}
                      cycleTagState={cycleTagState}
                      combineMode={groupCombineModes[group.id]}
                      cycleGroupMode={cycleGroupMode}
                      exclusionMode={groupExclusionModes[group.id]}
                      cycleExclusionMode={cycleGroupExclusionMode}
                    />
                  ))}
                </div>
              </details>
            </>
          }
        />
      </div>

      {/* 3-column grid: spell list (left, narrow) | editor (middle,
          widest) | tag picker (right, narrow-medium). flex-1 + min-h-0
          lets the grid fill the leftover vertical space inside the
          flex column without forcing the page to scroll. */}
      {/* 3-column grid widths. Bumped the right column from 320 →
          420 so tag chips have breathing room: a typical tag-group
          row with 6-8 chips + the ▸/▾ expand button no longer wraps
          mid-chip, and the per-parent drawer below has enough width
          to keep subtags on a single line for short tag lists.
          Middle column is still `1fr` so it absorbs the rest of the
          viewport. */}
      <div className="flex-1 min-h-0 grid gap-2 lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)_420px]">
        {/* Left column — compact spell list (Name | Lv | Src). Rows
            mirror the SpellList browser's compact rhythm; columns are
            tighter because the editor needs the middle column for
            actual editing. */}
        <Card
          className="border-gold/10 bg-card/50 overflow-hidden"
          style={{ height: `${paneHeight}px` }}
        >
          <CardContent className="p-0 flex flex-col h-full">
            <div className="border-b border-gold/10 bg-background/35 px-3 py-2.5 shrink-0">
              <div
                className="grid gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-gold/70 items-center"
                style={{ gridTemplateColumns: 'minmax(0,1fr) 28px 52px' }}
              >
                <span>Name</span>
                <span className="text-center">Lv</span>
                <span className="text-center">Src</span>
              </div>
            </div>
            {loading ? (
              <div className="px-6 py-12 text-center text-ink/45">Loading…</div>
            ) : filteredEntries.length === 0 ? (
              <div className="px-6 py-12 text-center text-ink/45">No spells match the current search.</div>
            ) : (
              <VirtualizedList
                items={filteredEntries}
                height={listInnerHeight}
                itemHeight={36}
                className="custom-scrollbar overflow-y-auto"
                renderItem={(entry: SpellSummaryRecord) => {
                  const selected = entry.id === editingId;
                  const srcAbbrev = String(sourceAbbrevById[entry.sourceId] || entry.sourceId || '—');
                  const lvl = Number(entry.level ?? 0);
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => startEditing(entry)}
                      className={cn(
                        'grid h-[36px] w-full gap-2 items-center px-3 text-left transition-colors border-b border-gold/5',
                        selected ? 'bg-gold/10' : 'hover:bg-gold/5',
                      )}
                      style={{ gridTemplateColumns: 'minmax(0,1fr) 28px 52px' }}
                      title={entry.name || '(Untitled Spell)'}
                    >
                      <span className="truncate font-serif text-sm text-ink">
                        {entry.name || <em className="text-ink/40">Untitled</em>}
                      </span>
                      <span className="text-xs text-ink/75 text-center">
                        {lvl === 0 ? 'C' : lvl}
                      </span>
                      <span className="text-[10px] font-bold text-gold/80 text-center truncate">
                        {srcAbbrev}
                      </span>
                    </button>
                  );
                }}
              />
            )}
          </CardContent>
        </Card>

        {/* Middle column — the editor itself. Same Tabs structure as
            before (Basics / Mechanics / Activities / Effects / Prereqs);
            descriptive Tags moved out to the right column below. */}
        <Card className="border-gold/20 bg-card/50 overflow-hidden" style={{ height: `${paneHeight}px` }}>
              <CardContent className="p-0 h-full flex flex-col">
                {/* Form is segmented into Tabs so admins can jump
                  * between sections (Basics, Description, Mechanics,
                  * Activities, Prereqs) instead of scrolling past
                  * everything. The header (title + Save buttons)
                  * stays mounted above the tab list so save is always
                  * one click away regardless of which tab is showing.
                  *
                  * Inactive TabsContent unmounts by default in Radix;
                  * the form's `onSubmit` reads from `formData` state
                  * (every input is controlled), so unmounted fields
                  * still contribute on save. No need for forceMount.
                  *
                  * `flex-1 min-h-0` lets the Tabs subtree fill the
                  * card's height; the form's scroll area inside uses
                  * `flex-1 overflow-y-auto` instead of `max-h-[78vh]`
                  * so the editor uses ALL available height. */}
                <Tabs defaultValue="basics" className="flex-1 min-h-0 flex flex-col">
                <div className="border-b border-gold/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.02),transparent)] px-6 py-5 space-y-4">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-2">
                      <div className="flex items-center gap-3">
                        <h3 className="font-serif text-2xl xl:text-3xl font-bold text-ink leading-tight break-words">
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
                  </TabsList>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-6 py-5">
                  {/* `autoComplete="off"` blocks browser autofill on the
                    * form's text inputs; `spellCheck={false}` cascades to
                    * every contained input so spell names and identifiers
                    * don't get red-squiggle-underlined. `data-1p-ignore`
                    * and `data-lpignore` ask 1Password / LastPass to skip
                    * the form. Foundry-shape values (identifiers, formulas
                    * like `@prof`, range values) are not natural language
                    * and should never be autocorrected. */}
                  <form
                    id="spell-manual-editor-form"
                    onSubmit={handleSave}
                    className="space-y-6"
                    autoComplete="off"
                    spellCheck={false}
                    data-1p-ignore="true"
                    data-lpignore="true"
                  >
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

                  <TabsContent value="mechanics" className="mt-0 space-y-4">
                    {/* Sub-tabs mirror Foundry's Details-tab field grouping
                      * (Casting / Targeting / Uses) and break the previously
                      * cramped single scroll into focused panels. Same
                      * Radix-Tabs pattern as the Tags & Prereqs tab — form
                      * state is fully controlled in `formData`, so Radix
                      * unmounting inactive sub-tabs does NOT discard
                      * unsaved values when you switch sub-tabs. */}
                    <Tabs defaultValue="casting" className="space-y-4">
                      <TabsList variant="line" className="gap-2 bg-transparent p-0">
                        <TabsTrigger value="casting" className="rounded-md border border-gold/15 bg-background/30 px-3 py-1.5 text-xs uppercase tracking-[0.18em] text-ink/65 data-active:border-gold/40 data-active:bg-gold/10 data-active:text-gold">
                          Casting
                        </TabsTrigger>
                        <TabsTrigger value="targeting" className="rounded-md border border-gold/15 bg-background/30 px-3 py-1.5 text-xs uppercase tracking-[0.18em] text-ink/65 data-active:border-gold/40 data-active:bg-gold/10 data-active:text-gold">
                          Targeting
                        </TabsTrigger>
                        <TabsTrigger value="uses" className="rounded-md border border-gold/15 bg-background/30 px-3 py-1.5 text-xs uppercase tracking-[0.18em] text-ink/65 data-active:border-gold/40 data-active:bg-gold/10 data-active:text-gold">
                          Uses {formData.uses.recovery.length > 0 && <span className="ml-1 text-gold/70">({formData.uses.recovery.length})</span>}
                        </TabsTrigger>
                      </TabsList>

                      <TabsContent value="casting" className="mt-0 space-y-4">
                        <div className="space-y-4 border border-gold/10 rounded-md p-4 bg-background/20">
                          <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-gold">Casting Time</h3>
                          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                            <div className="space-y-2">
                              <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/60">Activation</Label>
                              <div className="grid grid-cols-[1fr_80px] gap-2">
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
                            </div>
                            <div className="space-y-2">
                              <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/60">Reaction Trigger</Label>
                              <Input
                                value={formData.activation.condition || ''}
                                onChange={e => setFormData(prev => ({ ...prev, activation: { ...prev.activation, condition: e.target.value } }))}
                                placeholder="e.g. when you take damage (optional)"
                                className="h-9 bg-background/50 border-gold/10 focus:border-gold text-xs"
                              />
                            </div>
                          </div>
                          <div className="grid md:grid-cols-2 gap-3">
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
                        </div>

                        <div className="space-y-3 border border-gold/10 rounded-md p-4 bg-background/20">
                          <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-gold">Components</h3>
                          <div className="grid md:grid-cols-3 gap-3">
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
                          <div className="grid md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3">
                            <div className="space-y-1">
                              <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/60">Material Text</Label>
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
                            <div className="space-y-1">
                              <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/60">Cost</Label>
                              <Input
                                value={formData.components?.cost || ''}
                                onChange={e => setFormData(prev => ({
                                  ...prev,
                                  components: mergeSpellComponents(prev.components, { cost: e.target.value })
                                }))}
                                className="bg-background/50 border-gold/10 focus:border-gold text-xs"
                                placeholder="100 gp"
                              />
                            </div>
                            <label className="flex items-center justify-between gap-3 border border-gold/10 rounded-md p-3 self-end">
                              <span className="text-[10px] uppercase text-ink/60 font-bold tracking-widest">Consumed</span>
                              <Checkbox
                                checked={!!formData.components?.consumed}
                                onCheckedChange={checked => setFormData(prev => ({
                                  ...prev,
                                  components: mergeSpellComponents(prev.components, { consumed: !!checked })
                                }))}
                              />
                            </label>
                          </div>
                          <p className="text-[10px] text-ink/40">
                            Spell metadata stays lightweight here. Runtime behavior lives in Activities.
                          </p>
                        </div>
                      </TabsContent>

                      <TabsContent value="targeting" className="mt-0 space-y-4">
                        <div className="space-y-4 border border-gold/10 rounded-md p-4 bg-background/20">
                          <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-gold">Range &amp; Duration</h3>
                          <div className="grid gap-4 lg:grid-cols-2">
                            <div className="space-y-2">
                              <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/60">Range</Label>
                              <div className="grid grid-cols-[1fr_70px_70px] gap-2">
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
                                  placeholder="Value"
                                  className="h-9 bg-background/50 border-gold/10 focus:border-gold disabled:opacity-50 text-xs"
                                />
                                <Input
                                  type="number"
                                  min={0}
                                  value={String(formData.range.long ?? '')}
                                  onChange={e => setFormData(prev => ({ ...prev, range: { ...prev.range, long: e.target.value === '' ? '' : Number(e.target.value) } }))}
                                  disabled={formData.range.units === 'self' || formData.range.units === 'touch'}
                                  placeholder="Long"
                                  className="h-9 bg-background/50 border-gold/10 focus:border-gold disabled:opacity-50 text-xs"
                                />
                              </div>
                              <Input
                                value={formData.range.special || ''}
                                onChange={e => setFormData(prev => ({ ...prev, range: { ...prev.range, special: e.target.value } }))}
                                placeholder='e.g. "Sight" (optional)'
                                className="h-9 bg-background/50 border-gold/10 focus:border-gold text-xs"
                              />
                              <p className="text-[10px] text-ink/40">
                                Long range is only meaningful for ranged-attack spells (Firebolt, Eldritch Blast); most spells leave it blank.
                              </p>
                            </div>

                            <div className="space-y-2">
                              <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/60">Duration</Label>
                              <div className="grid grid-cols-[1fr_80px] gap-2">
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
                      </TabsContent>

                      <TabsContent value="uses" className="mt-0 space-y-4">
                        {/* Limited Uses — rare on spells but real for
                          * artifact-bound or once-per-day homebrew. Mirrors
                          * the FeatsEditor / ActivityEditor ConsumptionTab
                          * recovery editor (same constants, same row
                          * layout) so authors don't learn a second UI for
                          * the same concept. Empty recovery list = uses
                          * persist until manually reset. */}
                        <div className="space-y-4 border border-gold/10 rounded-md p-4 bg-background/20">
                          <div className="flex items-baseline justify-between">
                            <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-gold">Limited Uses</h3>
                            <span className="text-[10px] text-ink/40">Optional — leave blank for unlimited.</span>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/60">Max (formula or number)</Label>
                            <Input
                              value={formData.uses.max || ''}
                              onChange={e => setFormData(prev => ({ ...prev, uses: { ...prev.uses, max: e.target.value } }))}
                              placeholder="e.g. @prof or 3"
                              className="bg-background/50 border-gold/10 focus:border-gold text-xs font-mono"
                            />
                          </div>

                          <div className="space-y-2 border-t border-gold/8 pt-3">
                            <div className="flex items-baseline justify-between">
                              <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/60">Recovery Rules</Label>
                              <span className="text-[10px] text-ink/40">Lands at <code className="font-mono">system.uses.recovery[]</code></span>
                            </div>
                            <div className="space-y-2">
                              {formData.uses.recovery.map((entry, idx) => (
                                <div
                                  key={idx}
                                  className="flex gap-2 items-center p-2.5 bg-gold/3 border border-gold/8 rounded"
                                >
                                  <SingleSelectSearch
                                    value={entry.period || ''}
                                    onChange={(val) => {
                                      const next = formData.uses.recovery.slice();
                                      next[idx] = { ...entry, period: val };
                                      setFormData((prev) => ({
                                        ...prev,
                                        uses: { ...prev.uses, recovery: next },
                                      }));
                                    }}
                                    options={RECOVERY_PERIOD_OPTIONS.map((o) => ({
                                      id: o.value,
                                      name: o.label,
                                      hint: o.hint,
                                    }))}
                                    placeholder="Period"
                                    triggerClassName="flex-1"
                                  />
                                  <SingleSelectSearch
                                    value={entry.type || ''}
                                    onChange={(val) => {
                                      const next = formData.uses.recovery.slice();
                                      next[idx] = { ...entry, type: val };
                                      setFormData((prev) => ({
                                        ...prev,
                                        uses: { ...prev.uses, recovery: next },
                                      }));
                                    }}
                                    options={RECOVERY_TYPE_OPTIONS.map((o) => ({
                                      id: o.value,
                                      name: o.label,
                                    }))}
                                    placeholder="Type"
                                    triggerClassName="flex-1"
                                  />
                                  <Input
                                    value={entry.formula || ''}
                                    onChange={(e) => {
                                      const next = formData.uses.recovery.slice();
                                      next[idx] = { ...entry, formula: e.target.value };
                                      setFormData((prev) => ({
                                        ...prev,
                                        uses: { ...prev.uses, recovery: next },
                                      }));
                                    }}
                                    className="h-7 text-[10px] font-mono bg-background/40 border-gold/10 flex-1"
                                    placeholder="1d4 or @prof"
                                  />
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setFormData((prev) => ({
                                        ...prev,
                                        uses: {
                                          ...prev.uses,
                                          recovery: prev.uses.recovery.filter((_, i) => i !== idx),
                                        },
                                      }))
                                    }
                                    className="text-blood/60 hover:text-blood shrink-0 transition-colors"
                                    aria-label="Remove recovery rule"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ))}
                              {formData.uses.recovery.length === 0 && (
                                <p className="text-center py-3 text-ink/30 italic text-[10px]">No recovery rules.</p>
                              )}
                              <button
                                type="button"
                                onClick={() =>
                                  setFormData((prev) => ({
                                    ...prev,
                                    uses: {
                                      ...prev.uses,
                                      recovery: [
                                        ...prev.uses.recovery,
                                        { period: '', type: '', formula: '' },
                                      ],
                                    },
                                  }))
                                }
                                className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[10px] uppercase tracking-widest font-black text-gold/50 hover:text-gold border border-dashed border-gold/15 hover:border-gold/30 rounded transition-colors"
                              >
                                <Plus className="w-3 h-3" /> Add Recovery Rule
                              </button>
                            </div>
                          </div>
                          <p className="text-[10px] text-ink/40">
                            Period + Type drive Foundry's automatic recovery on rest. Formula optional — populate it for "recover 1d4 charges" patterns.
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

        {/* Right column — two-tab picker: Tags (descriptive) and
            Prereqs (gating tags + free-text notes). Lifting Prereqs
            out of the middle editor and into the right column groups
            both tag-shaped concerns in one place. Tabs share the
            same SpellTagPicker so the chip + tree pattern stays
            consistent between them. */}
        <Card className="border-gold/10 bg-card/50 overflow-hidden" style={{ height: `${paneHeight}px` }}>
          <CardContent className="p-0 h-full flex flex-col">
            <Tabs defaultValue="tags" className="flex-1 min-h-0 flex flex-col">
              <div className="border-b border-gold/10 bg-background/35 px-3 py-2.5 shrink-0">
                <TabsList variant="line" className="gap-1 bg-transparent p-0">
                  <TabsTrigger
                    value="tags"
                    className="h-7 rounded-md border border-gold/15 bg-background/30 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-ink/65 data-active:border-gold/40 data-active:bg-gold/10 data-active:text-gold"
                  >
                    Tags {formData.tags.length > 0 && (
                      <span className="ml-1 text-gold/70">({formData.tags.length})</span>
                    )}
                  </TabsTrigger>
                  <TabsTrigger
                    value="prereqs"
                    className="h-7 rounded-md border border-gold/15 bg-background/30 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-ink/65 data-active:border-gold/40 data-active:bg-gold/10 data-active:text-gold"
                  >
                    Prereqs {formData.requiredTags.length > 0 && (
                      <span className="ml-1 text-gold/70">({formData.requiredTags.length})</span>
                    )}
                  </TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="tags" className="mt-0 flex-1 min-h-0 overflow-y-auto custom-scrollbar p-3">
                <SpellTagPicker
                  tags={tags}
                  tagGroups={tagGroups}
                  selectedIds={formData.tags}
                  onChange={(next) => setFormData(prev => ({ ...prev, tags: next }))}
                  hint="Tag rules + class spell list rules use these to decide which spells they include."
                  emptyHint="No tags loaded yet."
                />
              </TabsContent>

              <TabsContent value="prereqs" className="mt-0 flex-1 min-h-0 overflow-y-auto custom-scrollbar p-3 space-y-3">
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
          </CardContent>
        </Card>
      </div>
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
  // Per-parent "show subtag drawer" state. Mirrors the
  // TagGroupFilter pattern — clicking the ▸/▾ next to a parent
  // chip reveals its subtag drawer below the root row. A parent
  // is also auto-expanded if any of its subtags are currently
  // selected (so existing selections never hide).
  const [expandedParents, setExpandedParents] = useState<Set<string>>(new Set());
  const toggleParentExpanded = (rootId: string) => {
    setExpandedParents(prev => {
      const next = new Set(prev);
      next.has(rootId) ? next.delete(rootId) : next.add(rootId);
      return next;
    });
  };

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
    if (selectedIds.includes(tagId)) {
      // Deselect. If this is a parent tag, ALSO drop any of its
      // subtags that are selected — keeps the invariant "a subtag
      // is only present when its parent is present" intact even
      // when removing.
      const childIds = new Set(
        tags.filter(t => t.parentTagId === tagId).map(t => t.id),
      );
      onChange(selectedIds.filter(id => id !== tagId && !childIds.has(id)));
      return;
    }
    // Selecting. If this is a subtag whose parent isn't already
    // selected, auto-add the parent so the "subtag implies its
    // super tag" invariant holds (matches the user-visible model
    // where a subtag is meaningless without its parent).
    const tag = tags.find(t => t.id === tagId);
    const parentId = tag?.parentTagId || null;
    if (parentId && !selectedIds.includes(parentId)) {
      onChange([...selectedIds, parentId, tagId]);
    } else {
      onChange([...selectedIds, tagId]);
    }
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
                // Hierarchical render that mirrors TagGroupFilter
                // (src/components/compendium/FilterBar.tsx ~line 580):
                //   - Roots flow horizontally in a single wrap-row.
                //     Each root with subtags gets a ▸/▾ button next
                //     to it; the button controls a per-parent drawer
                //     rendered BELOW the roots row.
                //   - A parent is auto-expanded if any of its subtags
                //     is currently selected OR matches the filter.
                //     The user can never lose sight of an active
                //     subtag pick behind a closed drawer.
                //   - The "only get a subtag if its part of the super
                //     tag" rule is enforced at toggle time
                //     (toggleTag auto-adds the parent on subtag
                //     select; auto-drops subtags on parent deselect).
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

                // Auto-expand any parent whose subtag is selected
                // (or matches filter). Combined with the user's
                // explicit expandedParents set, this drives drawer
                // visibility.
                const autoExpandedRoots = new Set<string>();
                for (const [parentId, children] of subtagsByParentId) {
                  if (children.some(c => selectedIds.includes(c.id))) {
                    autoExpandedRoots.add(parentId);
                    continue;
                  }
                  if (isFiltering && children.some(c => String(c.name).toLowerCase().includes(filterTerm))) {
                    autoExpandedRoots.add(parentId);
                  }
                }
                const isRootExpanded = (rootId: string) =>
                  expandedParents.has(rootId) || autoExpandedRoots.has(rootId);

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
                  <div className="px-3 pb-2.5 pt-1 space-y-2">
                    {/* Roots row — single wrap-row. Expand button
                        renders inline immediately after each chip
                        that has subtags so the chip's click target
                        stays purely "toggle this tag's selection". */}
                    <div className="flex flex-wrap items-center gap-1.5">
                      {visibleRoots.map(root => {
                        const subs = subtagsByParentId.get(root.id) ?? [];
                        const hasSubs = subs.length > 0;
                        const expanded = hasSubs && isRootExpanded(root.id);
                        return (
                          <span key={root.id} className="inline-flex items-center gap-0.5">
                            {renderChip(root)}
                            {hasSubs && (
                              <button
                                type="button"
                                onClick={() => toggleParentExpanded(root.id)}
                                className={cn(
                                  'inline-flex items-center justify-center h-[22px] w-[18px] -ml-0.5 rounded border transition-colors',
                                  expanded
                                    ? 'border-gold/50 bg-gold/15 text-gold'
                                    : 'border-gold/20 bg-background/40 text-ink/60 hover:border-gold/40 hover:text-gold',
                                )}
                                title={expanded
                                  ? `Hide ${root.name} subtags (${subs.length})`
                                  : `Show ${root.name} subtags (${subs.length})`}
                                aria-expanded={expanded}
                                aria-label={expanded ? `Collapse ${root.name} subtags` : `Expand ${root.name} subtags`}
                              >
                                {expanded
                                  ? <ChevronDown className="w-3 h-3" />
                                  : <ChevronRight className="w-3 h-3" />}
                              </button>
                            )}
                          </span>
                        );
                      })}
                    </div>

                    {/* Expanded subtag drawers — one labeled row per
                        expanded parent, indented under a thin gold
                        rule so multiple expanded parents don't blur
                        together. Selecting a subtag here auto-adds
                        its parent via toggleTag. */}
                    {visibleRoots.map(root => {
                      if (!isRootExpanded(root.id)) return null;
                      const subs = subtagsByParentId.get(root.id) ?? [];
                      if (subs.length === 0) return null;
                      return (
                        <div
                          key={`drawer-${root.id}`}
                          className="ml-3 pl-3 border-l border-gold/15 flex flex-wrap items-center gap-1.5"
                        >
                          <span className="text-[10px] uppercase tracking-widest text-ink/40 mr-1">
                            {root.name}:
                          </span>
                          {subs.map(renderChip)}
                        </div>
                      );
                    })}

                    {/* Orphans — subtags whose parent isn't in this
                        group's visible set. Surface them in an
                        amber-edged row so they're not silently
                        dropped (rare; usually stale hierarchy). */}
                    {orphans.length > 0 && (
                      <div
                        className="ml-3 pl-3 border-l border-amber-500/30 flex flex-wrap items-center gap-1.5"
                        title="Subtags whose parent isn't in this group's visible tag set."
                      >
                        <span className="text-[10px] uppercase tracking-widest text-amber-500/60 mr-1">
                          Orphaned:
                        </span>
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

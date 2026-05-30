import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ChevronDown, ChevronRight, Search, Trash2, Wand2, X } from 'lucide-react';
import { useKeyboardSave } from '../../hooks/useKeyboardSave';
import { toast } from 'sonner';
import SpellImportWorkbench from '../../components/compendium/SpellImportWorkbench';
import RuleMembershipPanel from '../../components/compendium/RuleMembershipPanel';
import SpellDetailPanel from '../../components/compendium/SpellDetailPanel';
import { matchesTagFilters } from '../../components/compendium/FilterBar';
import { SectionFilterPanel, type FilterSection } from '../../components/compendium/SectionFilterPanel';
import {
  CompendiumEditorShell,
  type EditorMode,
  type EditorSubTab,
  type TagsSubTab,
  type EditorListColumn,
} from '../../components/compendium/CompendiumEditorShell';
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
import { useEditorFormSession } from '../../components/compendium/useEditorFormSession';
import { reportClientError, OperationType } from '../../lib/firebase';
import { upsertSpell, deleteSpell, fetchSpell, purgeAllSpells, prepareSpellPayloadForWrite, denormalizeCompendiumData } from '../../lib/compendium';
import { useProposalAccumulator, useProposalContextOptional } from '../../lib/proposalAccumulator';
import { useProposalEntityDrafts } from '../../hooks/useProposalEntityDrafts';
import { actionLabel, applyProposalWrite } from '../../lib/proposalAware';
import { useProposalReview, resolveReviewPayload, ReviewFieldHighlight } from '../../lib/proposalReview';
import { TombstoneRow } from '../../components/proposals/TombstoneRow';
import { CascadeDependentBanner } from '../../components/proposals/CascadeDependentBanner';
import { TagReplacementPicker } from '../../components/proposals/TagReplacementPicker';
import { useCascadeDependent } from '../../hooks/useCascadeDependent';
import { useProposalPreFlushSave } from '../../hooks/useProposalPreFlushSave';
import { useDraftedEntityIds } from '../../hooks/useDraftedEntityIds';
import { useEditBaseUnlocks } from '../../hooks/useEditBaseUnlocks';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { fetchCollection } from '../../lib/d1';
import { fetchSpellSummaries } from '../../lib/spellSummary';
import { orderTagsAsTree, normalizeTagRow } from '../../lib/tagHierarchy';
import { slugify } from '../../lib/utils';
import { bbcodeToHtml } from '../../lib/bbcode';
import { SCHOOL_LABELS, backfillSpellDescriptionsFromFoundry } from '../../lib/spellImport';
import { parseFoundrySystem as parseFoundrySystemForEditor } from '../../lib/spellFilters';
import { cn } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { Checkbox } from '../../components/ui/checkbox';
import { ImageUpload } from '../../components/ui/ImageUpload';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import SingleSelectSearch from '../../components/ui/SingleSelectSearch';
import TagPicker from '../../components/compendium/TagPicker';
import { Plus } from 'lucide-react';
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

type SpellFormData = {
  id?: string;
  name: string;
  identifier: string;
  sourceId: string;
  imageUrl: string;
  description: string;
  activities: any[];
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
  activation: { type: string; value: number | string; condition: string };
  range: { value: number | string; long: number | string; units: string; special: string };
  duration: { value: number | string; units: string };
  target: {
    template: { type: string; size: string; width: string; height: string; units: string };
    affects: { type: string; count: string; choice: boolean; special: string };
  };
  uses: {
    max: string;
    recovery: { period: string; type: string; formula: string }[];
  };
  tags: string[];
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
  const isContentCreator = !!userProfile?.permissions &&
    Object.prototype.hasOwnProperty.call(userProfile.permissions, 'content-creator');
  const canManage = isAdmin || isContentCreator;
  const [backfilling, setBackfilling] = useState(false);
  const [purging, setPurging] = useState(false);
  const location = useLocation();
  const isProposalRoute = location.pathname.startsWith('/proposals/edit/');
  const backPath = isProposalRoute ? '/my-proposals' : '/compendium/spells';
  const backLabel = isProposalRoute ? 'Back to My Proposals' : 'Back To Spells';

  // ── Proposal-mode plumbing ────────────────────────────────────
  const spellWriter = useProposalAccumulator('spell', userProfile);
  const isProposalMode = spellWriter.mode === 'proposal' || spellWriter.mode === 'block';
  const proposalContext = useProposalContextOptional();
  const focusMode = proposalContext?.focusMode ?? 'drafts';
  const focusModeEnabled = proposalContext?.focusModeEnabled ?? false;
  const reviewMode = useProposalReview();
  const reviewPayload = resolveReviewPayload(reviewMode, 'spell', null);
  const isReviewingSpell = !!reviewMode && !!reviewPayload && reviewMode.entityType === 'spell';

  // ── Entries + form state ──────────────────────────────────────
  const [entries, setEntries] = useState<any[]>([]);
  const [spellDetailsById, setSpellDetailsById] = useState<Record<string, any>>({});
  const [sources, setSources] = useState<any[]>([]);
  const [tags, setTags] = useState<{ id: string; name: string; groupId: string | null; parentTagId: string | null }[]>([]);
  const [tagGroups, setTagGroups] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  // Bumped after every successful save so the right-side <SpellDetailPanel>
  // preview re-reads the now-persisted row. The panel caches by spellId and
  // can't otherwise tell that an in-place UPDATE (same editingId) changed the
  // underlying spell — the id is unchanged, so only a key bump re-triggers it.
  const [previewRefreshKey, setPreviewRefreshKey] = useState(0);
  const [formData, setFormData] = useState<SpellFormData>(makeInitialSpellForm());
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [listDeleteTarget, setListDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  // Drafted ids + entities for proposal-mode list merge.
  const draftedSpellIds = useDraftedEntityIds('spell');
  const draftedSpellEntities = useProposalEntityDrafts('spell');

  // Cascade dependent banner + replace-tag picker.
  const cascadeDep = useCascadeDependent('spell', editingId);
  const [replaceTagPickerOpen, setReplaceTagPickerOpen] = useState(false);

  // Edit-base unlocks + isReadOnly.
  const {
    unlockedBaseIds,
    unlock: unlockBaseSpell,
    isReadOnly,
  } = useEditBaseUnlocks({
    focusModeEnabled,
    editingId,
    draftedIds: draftedSpellIds,
    proposalContext,
  });

  // ── Filter state ──────────────────────────────────────────────
  type AxisState = { states: Record<string, number>; combineMode?: 'AND' | 'OR' | 'XOR'; exclusionMode?: 'AND' | 'OR' | 'XOR' };
  const [axisFilters, setAxisFilters] = useState<Record<string, AxisState>>({});
  const [tagStates, setTagStates] = useState<Record<string, number>>({});
  const [groupCombineModes, setGroupCombineModes] = useState<Record<string, 'AND' | 'OR' | 'XOR'>>({});
  const [groupExclusionModes, setGroupExclusionModes] = useState<Record<string, 'AND' | 'OR' | 'XOR'>>({});
  const [isFilterOpen, setIsFilterOpen] = useState(false);

  // Refs for async callbacks.
  const editingIdRef = useRef<string | null>(null);
  useEffect(() => { editingIdRef.current = editingId; }, [editingId]);
  const lastLoadedFormRef = useRef<string>('');
  const loadedIdRef = useRef<string | null>(null);
  const formDataRef = useRef<SpellFormData | null>(null);

  // Editor-body session key (see useEditorFormSession). Keyed on
  // this token instead of `editingId` so the MarkdownEditor / TipTap
  // body doesn't remount when a save promotes editingId from
  // `null → newId` — that remount was the "save jumps the editor
  // to the top" behavior we got bug reports about. The session
  // still bumps on explicit row switches / resets.
  const { sessionKey, markSaving } = useEditorFormSession(editingId);

  // ── Admin maintenance handlers ────────────────────────────────
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

  // ── Load entries + sources + tags ─────────────────────────────
  const mapSpellRow = (row: any) => {
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
      foundryShell: row.activation_type !== undefined || row.range_units !== undefined ? {
        activation: {
          type:      row.activation_type ?? '',
          value:     row.activation_value ?? '',
          condition: row.activation_condition ?? '',
        },
        range: {
          units:   row.range_units ?? '',
          value:   row.range_value ?? '',
          special: row.range_special ?? '',
        },
        duration: {
          units: row.duration_units ?? '',
          value: row.duration_value ?? '',
        },
      } : parseJsonCol<any>(row.foundry_data, null),
      ...deriveSpellFilterFacets(row),
    };
  };

  useEffect(() => {
    if (!canManage) return;

    const loadEntries = async () => {
      try {
        const data = await fetchSpellSummaries('name ASC');
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
      } catch (err) {
        console.error("[SpellsEditor] Error loading sources:", err);
      }
    };

    loadSources();

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
  }, [canManage]);

  useEffect(() => {
    if (editingId) return;
    if (formData.sourceId || sources.length === 0) return;
    setFormData((prev) => ({ ...prev, sourceId: sources[0].id }));
  }, [editingId, formData.sourceId, sources]);

  const sourceNameById = useMemo(
    () => Object.fromEntries(sources.map((source) => [source.id, source.name || source.abbreviation || source.shortName || source.id])),
    [sources]
  );

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

  const miniPillAxes = useMemo<FilterSection[]>(() => {
    const axes: FilterSection[] = [
      {
        key: 'source', name: 'Sources', kind: 'axis', hasDefault: true,
        values: sources.map(s => ({
          value: s.id,
          label: String(s.abbreviation || s.shortName || s.name || s.id),
          labelAlt: String(s.name || s.shortName || s.abbreviation || s.id),
        })),
      },
      {
        key: 'level', name: 'Spell Level', kind: 'axis',
        values: Array.from({ length: 10 }, (_, i) => ({ value: String(i), label: i === 0 ? 'Cantrip' : `Level ${i}` })),
      },
      {
        key: 'school', name: 'School', kind: 'axis',
        values: Object.entries(SCHOOL_LABELS).map(([k, label]) => ({ value: k, label })),
      },
      {
        key: 'activation', name: 'Casting Time', kind: 'axis',
        values: ACTIVATION_ORDER.map(b => ({ value: b, label: ACTIVATION_LABELS[b] })),
      },
      {
        key: 'range', name: 'Range', kind: 'axis',
        values: RANGE_ORDER.map(b => ({ value: b, label: RANGE_LABELS[b] })),
      },
      {
        key: 'duration', name: 'Duration', kind: 'axis',
        values: DURATION_ORDER.map(b => ({ value: b, label: DURATION_LABELS[b] })),
      },
      {
        key: 'shape', name: 'Shape', kind: 'axis',
        values: SHAPE_ORDER.map(b => ({ value: b, label: SHAPE_LABELS[b] })),
      },
      {
        key: 'property', name: 'Properties', kind: 'axis',
        values: PROPERTY_ORDER.map(p => ({ value: p, label: PROPERTY_LABELS[p] })),
      },
    ];
    for (const group of tagGroups) {
      const groupTags = tagsByGroup[group.id] || [];
      if (groupTags.length === 0) continue;
      const idSet = new Set(groupTags.map((t: any) => t.id));
      axes.push({
        key: `tag-group:${group.id}`,
        name: String((group as any).name ?? 'Tags'),
        kind: 'tag',
        groupId: group.id,
        values: groupTags.map((t: any) => {
          const parent = t.parentTagId ?? t.parent_tag_id ?? null;
          return {
            value: t.id,
            label: String(t.name ?? t.id),
            parentValue: parent && idSet.has(parent) ? parent : undefined,
          };
        }),
      });
    }
    return axes;
  }, [sources, tagGroups, tagsByGroup]);

  const axisRestoreDefault = (axisKey: string) => {
    if (axisKey === 'source') axisIncludeAll('source', sources.map(s => s.id));
    else axisClear(axisKey);
  };
  const parentByTagId = useMemo(() => {
    const out = new Map<string, string | null>();
    for (const tag of tags) out.set(String(tag.id), tag.parentTagId ? String(tag.parentTagId) : null);
    return out;
  }, [tags]);

  const sourceAbbrevById = useMemo(
    () => Object.fromEntries(sources.map((source) => [
      source.id,
      source.abbreviation || source.shortName || source.name || source.id,
    ])),
    [sources]
  );

  const displayEntries = useMemo(() => {
    if (
      draftedSpellEntities.byId.size === 0 &&
      draftedSpellEntities.deletedIds.size === 0
    ) {
      return entries;
    }
    const merged = entries.map((e) => {
      if (draftedSpellEntities.deletedIds.has(String(e.id))) {
        return { ...e, __pendingDelete: true };
      }
      const overlay = draftedSpellEntities.byId.get(String(e.id));
      return overlay ? { ...e, ...mapSpellRow({ ...e, ...overlay }) } : e;
    });
    for (const [draftId, payload] of draftedSpellEntities.byId.entries()) {
      if (merged.some((e) => String(e.id) === draftId)) continue;
      merged.push({ ...mapSpellRow({ ...payload, id: draftId }), id: draftId });
    }
    return merged;
  }, [entries, draftedSpellEntities]);

  const filteredEntries = useMemo(() => {
    const lowered = search.trim().toLowerCase();
    return displayEntries.filter((entry) => {
      if (lowered) {
        const sourceLabel = String(sourceNameById[entry.sourceId] || '').toLowerCase();
        const matchesSearch = String(entry.name || '').toLowerCase().includes(lowered)
          || String(entry.identifier || '').toLowerCase().includes(lowered)
          || sourceLabel.includes(lowered);
        if (!matchesSearch) return false;
      }
      if (!matchesSingleAxisFilter(String(entry.sourceId ?? ''), axisFilters.source)) return false;
      if (!matchesSingleAxisFilter(String(Number(entry.level ?? 0)), axisFilters.level)) return false;
      if (!matchesSingleAxisFilter(String(entry.school ?? ''), axisFilters.school)) return false;
      if (!matchesSingleAxisFilter(entry.activationBucket, axisFilters.activation)) return false;
      if (!matchesSingleAxisFilter(entry.rangeBucket,      axisFilters.range))      return false;
      if (!matchesSingleAxisFilter(entry.durationBucket,   axisFilters.duration))   return false;
      if (!matchesSingleAxisFilter(entry.shapeBucket,      axisFilters.shape))      return false;

      const propsHave = new Set<PropertyFilter>();
      if (entry.concentration) propsHave.add('concentration');
      if (entry.ritual) propsHave.add('ritual');
      if (entry.hasV) propsHave.add('vocal');
      if (entry.hasS) propsHave.add('somatic');
      if (entry.hasM) propsHave.add('material');
      if (!matchesMultiAxisFilter(propsHave, axisFilters.property)) return false;

      const tagIds: string[] = Array.isArray(entry.tagIds) ? entry.tagIds : [];
      const effectiveTags = expandTagsWithAncestors(tagIds, parentByTagId);
      if (!matchesTagFilters(effectiveTags, tagGroups, tagsByGroup, tagStates, groupCombineModes, groupExclusionModes)) return false;

      if (focusModeEnabled && focusMode === 'drafts') {
        const id = String(entry.id);
        const isMyWork = draftedSpellIds.has(id) || unlockedBaseIds.has(id);
        if (!isMyWork) return false;
      }

      return true;
    });
  }, [displayEntries, search, sourceNameById, axisFilters, tagStates, tagGroups, tagsByGroup, groupCombineModes, groupExclusionModes, parentByTagId, focusModeEnabled, focusMode, draftedSpellIds, unlockedBaseIds]);

  const resetForm = () => {
    const initial = makeInitialSpellForm(sources);
    setEditingId(null);
    setFormData(initial);
    lastLoadedFormRef.current = JSON.stringify(initial);
    loadedIdRef.current = null;
  };

  // ── Filter helpers ────────────────────────────────────────────
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
  const cycleAxisStateReverse = (axisKey: string, value: string) => {
    setAxisFilters(prev => {
      const cur = prev[axisKey] || { states: {} };
      const state = cur.states[value] || 0;
      const next = state === 0 ? 2 : state === 2 ? 1 : 0;
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
  const cycleAxisCombineModeReverse = (axisKey: string) => {
    setAxisFilters(prev => {
      const cur = prev[axisKey] || { states: {} };
      const m = cur.combineMode || 'OR';
      const next: 'AND' | 'OR' | 'XOR' = m === 'OR' ? 'XOR' : m === 'XOR' ? 'AND' : 'OR';
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
  const cycleAxisExclusionModeReverse = (axisKey: string) => {
    setAxisFilters(prev => {
      const cur = prev[axisKey] || { states: {} };
      const m = cur.exclusionMode || 'OR';
      const next: 'AND' | 'OR' | 'XOR' = m === 'OR' ? 'XOR' : m === 'XOR' ? 'AND' : 'OR';
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

  const cycleTagState = (tagId: string) => {
    setTagStates(prev => {
      const cur = prev[tagId] || 0;
      const next = (cur + 1) % 3;
      const out = { ...prev };
      if (next === 0) delete out[tagId]; else out[tagId] = next;
      return out;
    });
  };
  const cycleTagStateReverse = (tagId: string) => {
    setTagStates(prev => {
      const cur = prev[tagId] || 0;
      const next = cur === 0 ? 2 : cur === 2 ? 1 : 0;
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
  const cycleGroupModeReverse = (groupId: string) => {
    setGroupCombineModes(prev => {
      const cur = prev[groupId] || 'OR';
      const next: 'AND' | 'OR' | 'XOR' = cur === 'OR' ? 'XOR' : cur === 'XOR' ? 'AND' : 'OR';
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
  const cycleGroupExclusionModeReverse = (groupId: string) => {
    setGroupExclusionModes(prev => {
      const cur = prev[groupId] || 'OR';
      const next: 'AND' | 'OR' | 'XOR' = cur === 'OR' ? 'XOR' : cur === 'XOR' ? 'AND' : 'OR';
      return { ...prev, [groupId]: next };
    });
  };

  // ── Load detail / hydrate form ────────────────────────────────
  useEffect(() => {
    if (!isReviewingSpell || !reviewMode?.entityId || !reviewPayload) return;
    setSpellDetailsById((current) =>
      current[reviewMode.entityId!]
        ? current
        : {
            ...current,
            [reviewMode.entityId!]: denormalizeCompendiumData(reviewPayload),
          },
    );
    if (editingId !== reviewMode.entityId) {
      setEditingId(reviewMode.entityId);
    }
  }, [isReviewingSpell, reviewMode?.entityId, reviewPayload, editingId]);

  useEffect(() => {
    if (!editingId) return;
    if (loadedIdRef.current === editingId) return;
    const draftedOverlay = draftedSpellEntities.byId.get(editingId);
    if (draftedOverlay) {
      const denormalized = denormalizeCompendiumData(draftedOverlay);
      const cached = spellDetailsById[editingId];
      if (!cached || JSON.stringify(cached) !== JSON.stringify(denormalized)) {
        setSpellDetailsById((current) => ({
          ...current,
          [editingId]: denormalized,
        }));
        return;
      }
    }
    if (spellDetailsById[editingId]) {
      const entry = spellDetailsById[editingId];
      const system = parseFoundrySystemForEditor(entry.foundry_data ?? entry.foundryData);
      const defaults = makeInitialSpellForm(sources);
      const loaded: SpellFormData = {
        ...defaults,
        ...entry,
        id: entry.id,
        sourceId: entry.sourceId || sources[0]?.id || '',
        activities: Array.isArray(entry.automation?.activities)
          ? entry.automation.activities
          : Array.isArray(entry.activities)
            ? entry.activities
            : [],
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
      };
      console.log('[imgdbg] FORM-LOAD setFormData(loaded)', { editingId, loadedIdRef: loadedIdRef.current, loaded_imageUrl: loaded.imageUrl });
      console.trace('[imgdbg] form-load trace');
      setFormData(loaded);
      lastLoadedFormRef.current = JSON.stringify(loaded);
      loadedIdRef.current = editingId;
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
    return () => { active = false; };
  }, [editingId, sources, spellDetailsById, draftedSpellEntities]);

  // ── Switch handler — auto-stage on switch in proposal mode ────
  const startEditing = async (id: string) => {
    if (
      isProposalMode &&
      editingIdRef.current &&
      id !== editingIdRef.current
    ) {
      const currentSerialized = JSON.stringify(formDataRef.current ?? formData);
      if (currentSerialized !== lastLoadedFormRef.current) {
        try {
          await handleSaveRef.current(undefined, { silent: true });
        } catch (err) {
          console.error('[SpellsEditor] auto-stage failed:', err);
          toast.error('Could not stage previous spell — switching anyway.');
        }
      }
    }
    setEditingId(id);
  };

  // ── Save ──────────────────────────────────────────────────────
  const handleSave = async (e?: React.FormEvent, opts: { silent?: boolean } = {}) => {
    if (e) e.preventDefault();
    // Build the save from the LATEST committed form state, not this
    // closure's `formData`. On the edit-existing-spell path the handleSave
    // that fires can be from an earlier render whose closed-over `formData`
    // predates a just-picked icon, so the payload serialized an empty
    // image_url even though the new icon was live in state and shown in the
    // icon slot (the "image won't save on update" bug). `formDataRef` is
    // kept in sync with `formData` via an effect and is the same source the
    // dirty-check below already trusts — read it here so the two stay
    // consistent and a last-moment edit can't be dropped on save.
    const fd = formDataRef.current ?? formData;
    console.log('[imgdbg] SAVE', { editingId, closure_imageUrl: formData.imageUrl, ref_imageUrl: formDataRef.current?.imageUrl, fd_imageUrl: fd.imageUrl, silent: opts.silent });
    if (!fd.name.trim()) {
      if (!opts.silent) toast.error('Spell name is required');
      return;
    }
    if (!fd.sourceId) {
      if (!opts.silent) toast.error('Source is required');
      return;
    }

    if (!opts.silent) setSaving(true);
    try {
      const existingSystem = editingId
        ? (parseFoundrySystemForEditor(spellDetailsById[editingId]?.foundry_data ?? spellDetailsById[editingId]?.foundryData) || {})
        : {};
      const descriptionHtmlForFoundry = bbcodeToHtml(String(fd.description || ''));

      const mergedFoundryData = {
        ...existingSystem,
        description: {
          ...(existingSystem.description || {}),
          value: descriptionHtmlForFoundry,
        },
        activation: { ...(existingSystem.activation || {}), ...fd.activation },
        range:      { ...(existingSystem.range      || {}), ...fd.range      },
        duration:   { ...(existingSystem.duration   || {}), ...fd.duration   },
        target: {
          ...(existingSystem.target || {}),
          template: { ...((existingSystem.target || {}).template || {}), ...fd.target.template },
          affects:  { ...((existingSystem.target || {}).affects  || {}), ...fd.target.affects  },
        },
        uses: {
          ...(existingSystem.uses || {}),
          max:      fd.uses.max,
          recovery: fd.uses.recovery,
        },
      };

      const effectsArr = Array.isArray(fd.effects) ? fd.effects : [];

      const payload: Record<string, any> = {
        ...fd,
        identifier: fd.identifier.trim() || slugify(fd.name),
        automation: {
          activities: Array.isArray(fd.activities)
            ? fd.activities
            : Object.values(fd.activities || {}),
          effects: effectsArr,
        },
        updatedAt: new Date().toISOString(),
        status: 'development',
        sourceType: 'spell',
        type: 'spell',
        level: Number(fd.level || 0),
        preparationMode: fd.preparationMode || 'spell',
        foundry_data: mergedFoundryData,
      };

      delete payload.id;
      delete payload.activities;
      delete payload.effects;
      delete payload.activation;
      delete payload.range;
      delete payload.duration;
      delete payload.target;
      delete payload.uses;

      Object.keys(payload).forEach((key) => {
        if (payload[key] === undefined) delete payload[key];
      });

      const editingIdAtStart = editingId;
      const wasCreate = !editingIdAtStart;
      const savedId = editingIdAtStart || crypto.randomUUID();

      const payloadWithCreatedAt = {
        ...payload,
        createdAt: editingIdAtStart
          ? (fd.createdAt || new Date().toISOString())
          : new Date().toISOString(),
      };

      if (isProposalMode) {
        const prepared = prepareSpellPayloadForWrite(payloadWithCreatedAt);
        delete (prepared as any).created_at;
        delete (prepared as any).updated_at;
        await applyProposalWrite(spellWriter, prepared, {
          id: savedId,
          isCreate: wasCreate,
          silent: opts.silent,
          submitNow: proposalContext?.submitNow,
        });
        lastLoadedFormRef.current = JSON.stringify(formDataRef.current ?? formData);
      } else {
        await upsertSpell(savedId, payloadWithCreatedAt);
        toast.success(wasCreate ? 'Spell created' : 'Spell updated');

        const updatedData = await fetchSpellSummaries('name ASC');
        setEntries(updatedData.map(mapSpellRow));

        try {
          const refreshed = await fetchSpell(savedId);
          if (refreshed) {
            setSpellDetailsById(prev => ({ ...prev, [savedId]: refreshed }));
          }
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn('[SpellsEditor] post-save refresh failed:', err);
        }
      }

      if (!opts.silent && editingIdRef.current === editingIdAtStart) {
        // For new-spell saves, editingId transitions `null → savedId`.
        // Mark the next id change as a save promotion so the editor
        // body's `sessionKey` stays stable across it — without
        // this, TipTap remounts and the MarkdownEditor scrolls back
        // to the top mid-flow.
        if (wasCreate) markSaving();
        setEditingId(savedId);
      }

      // Refresh the preview pane against the freshly-persisted row. For a
      // new spell the id changes (null → savedId) and the panel re-fetches
      // on its own; for an in-place UPDATE the id is unchanged, so the bump
      // is what makes the preview reflect the save.
      setPreviewRefreshKey(k => k + 1);
    } catch (error) {
      console.error('Error saving spell:', error);
      if (!opts.silent) toast.error('Failed to save spell');
      reportClientError(error, editingId ? OperationType.UPDATE : OperationType.CREATE, `spells/${editingId || '(new)'}`);
      if (opts.silent) throw error;
    } finally {
      if (!opts.silent) setSaving(false);
    }
  };

  const handleSaveRef = useRef(handleSave);
  useEffect(() => { handleSaveRef.current = handleSave; });
  useEffect(() => { formDataRef.current = formData; }, [formData]);
  // TEMP DEBUG (remove after image-save diagnosis): trace every imageUrl change
  useEffect(() => { console.log('[imgdbg] formData.imageUrl =>', JSON.stringify(formData.imageUrl), '| editingId', editingId, '| loadedIdRef', loadedIdRef.current); }, [formData.imageUrl]);

  useProposalPreFlushSave({
    enabled: isProposalMode,
    proposalContext,
    handleSave,
    shouldRun: () => {
      if (!editingIdRef.current) return false;
      const currentSerialized = JSON.stringify(formDataRef.current ?? formData);
      return currentSerialized !== lastLoadedFormRef.current;
    },
    onError: (err) => console.error('[SpellsEditor] pre-flush stage failed:', err),
  });

  // ── Delete flows ──────────────────────────────────────────────
  const handleDelete = () => {
    if (!editingId) return;
    setDeleteConfirmOpen(true);
  };

  const deleteSpellById = async (id: string, name: string) => {
    if (isProposalMode) {
      await spellWriter.remove(id);
      toast.success(actionLabel(spellWriter.mode, 'deleted'));
      if (proposalContext) {
        await proposalContext.submitNow({ silent: true });
      }
    } else {
      await deleteSpell(id);
      toast.success(`Deleted "${name || 'spell'}"`);
      const updatedData = await fetchSpellSummaries('name ASC');
      setEntries(updatedData.map(mapSpellRow));
    }
  };

  const performDelete = async () => {
    if (!editingId) return;
    try {
      await deleteSpellById(editingId, formData.name || '');
      resetForm();
    } catch (error) {
      console.error('Error deleting spell:', error);
      toast.error('Failed to delete spell');
      reportClientError(error, OperationType.DELETE, `spells/${editingId}`);
      throw error;
    }
  };

  const deleteRowDirect = async (id: string, name: string) => {
    try {
      await deleteSpellById(id, name);
      if (editingId === id) resetForm();
    } catch (error) {
      console.error('Error deleting spell from list:', error);
      toast.error('Failed to delete spell');
      reportClientError(error, OperationType.DELETE, `spells/${id}`);
    }
  };
  const handleDeleteFromList = async (entry: SpellSummaryRecord, ctrlPressed: boolean) => {
    const id = String(entry.id);
    const name = String(entry.name || 'Untitled Spell');
    if (ctrlPressed) {
      await deleteRowDirect(id, name);
      return;
    }
    setListDeleteTarget({ id, name });
  };
  const performListDelete = async () => {
    if (!listDeleteTarget) return;
    try {
      await deleteSpellById(listDeleteTarget.id, listDeleteTarget.name);
      if (editingId === listDeleteTarget.id) resetForm();
      setListDeleteTarget(null);
    } catch (error) {
      console.error('Error deleting spell from list:', error);
      toast.error('Failed to delete spell');
      reportClientError(error, OperationType.DELETE, `spells/${listDeleteTarget.id}`);
      throw error;
    }
  };

  // ── + New Spell ───────────────────────────────────────────────
  const handleCreateNewSpell = async () => {
    if (!isProposalMode) {
      resetForm();
      return;
    }
    if (editingIdRef.current) {
      const currentSerialized = JSON.stringify(formDataRef.current ?? formData);
      if (currentSerialized !== lastLoadedFormRef.current) {
        try {
          await handleSaveRef.current(undefined, { silent: true });
        } catch (err) {
          console.error('[SpellsEditor] auto-stage failed on + New Spell:', err);
          toast.error('Could not stage previous spell — creating new anyway.');
        }
      }
    }
    const newId = crypto.randomUUID();
    const defaults = makeInitialSpellForm(sources);
    const stubFormData: SpellFormData = { ...defaults, id: newId };
    await spellWriter.create({
      ...prepareSpellPayloadForWrite({
        ...stubFormData,
        sourceType: 'spell',
        type: 'spell',
        status: 'development',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
      id: newId,
    });
    setSpellDetailsById((curr) => ({
      ...curr,
      [newId]: { ...stubFormData },
    }));
    setEditingId(newId);
    setFormData(stubFormData);
    lastLoadedFormRef.current = JSON.stringify(stubFormData);
    loadedIdRef.current = newId;
  };

  useKeyboardSave(() => { void handleSave(); });

  // ── Identity bits for the shell header ────────────────────────
  const identitySubtitle = `${Number(formData.level ?? 0) === 0 ? 'Cantrip' : `Lvl ${formData.level ?? 0}`} ${SCHOOL_LABELS[String(formData.school ?? '')] || String(formData.school ?? '').toUpperCase()}`;

  // ── Sub-tabs ──────────────────────────────────────────────────
  const editorSubTabs: EditorSubTab[] = useMemo(() => [
    {
      key: 'basics',
      label: 'Basics',
      layout: 'fill',
      render: () => (
        <>
          <div className="grid gap-3 md:grid-cols-[80px_minmax(0,1fr)] shrink-0">
            <ImageUpload
              currentImageUrl={formData.imageUrl}
              storagePath={`images/spells/${editingId || 'draft'}/`}
              onUpload={(url) => { console.log('[imgdbg] onUpload <-', JSON.stringify(url)); setFormData(prev => ({ ...prev, imageUrl: url })); }}
              imageType="icon"
              compact
              className="h-[80px] w-[80px]"
            />

            <div className="grid gap-3 grid-cols-2 md:grid-cols-3">
              <ReviewFieldHighlight columnKey="name" className="space-y-0.5">
                <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/40">Name</Label>
                <Input
                  value={formData.name}
                  onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  className="h-8 bg-background/50 border-gold/10 focus:border-gold text-sm"
                  placeholder="e.g. Fireball"
                  required
                />
              </ReviewFieldHighlight>
              <ReviewFieldHighlight columnKey="identifier" className="space-y-0.5">
                <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/40">Identifier</Label>
                <Input
                  value={formData.identifier}
                  onChange={e => setFormData(prev => ({ ...prev, identifier: e.target.value }))}
                  className="h-8 bg-background/50 border-gold/10 focus:border-gold font-mono text-sm"
                  placeholder={slugify(formData.name || 'spell')}
                />
              </ReviewFieldHighlight>
              <ReviewFieldHighlight columnKey="source_id" className="space-y-0.5">
                <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/40">Source</Label>
                <select
                  value={formData.sourceId}
                  onChange={e => setFormData(prev => ({ ...prev, sourceId: e.target.value }))}
                  className="w-full h-8 px-2 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-sm"
                >
                  <option value="">Select a source</option>
                  {sources.map(source => (
                    <option key={source.id} value={source.id}>{source.name}</option>
                  ))}
                </select>
              </ReviewFieldHighlight>
              <ReviewFieldHighlight columnKey="level" className="space-y-0.5">
                <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/40">Level</Label>
                <Input
                  type="number"
                  min={0}
                  max={9}
                  value={formData.level ?? 0}
                  onChange={e => setFormData(prev => ({ ...prev, level: parseInt(e.target.value || '0', 10) || 0 }))}
                  className="h-8 bg-background/50 border-gold/10 focus:border-gold text-sm"
                />
              </ReviewFieldHighlight>
              <ReviewFieldHighlight columnKey="school" className="space-y-0.5">
                <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/40">School</Label>
                <select
                  value={formData.school || 'evo'}
                  onChange={e => setFormData(prev => ({ ...prev, school: e.target.value }))}
                  className="w-full h-8 px-2 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-sm"
                >
                  {SPELL_SCHOOLS.map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </ReviewFieldHighlight>
              <ReviewFieldHighlight columnKey="preparation_mode" className="space-y-0.5">
                <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/40">Prep Mode</Label>
                <select
                  value={formData.preparationMode || 'spell'}
                  onChange={e => setFormData(prev => ({ ...prev, preparationMode: e.target.value }))}
                  className="w-full h-8 px-2 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-sm"
                >
                  {PREPARATION_MODES.map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </ReviewFieldHighlight>
            </div>
          </div>

          <ReviewFieldHighlight columnKey="description" className="flex-1 min-h-0 flex flex-col">
            <MarkdownEditor
              key={sessionKey}
              value={formData.description}
              onChange={value => setFormData(prev => ({ ...prev, description: value }))}
              label="Description"
              placeholder="Describe the spell in player-facing terms. Activities should carry runtime mechanics."
              fillContainer
              className="flex-1 min-h-0"
            />
          </ReviewFieldHighlight>
        </>
      ),
    },
    {
      key: 'mechanics',
      label: 'Mechanics',
      render: () => (
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
                          setFormData((prev) => ({ ...prev, uses: { ...prev.uses, recovery: next } }));
                        }}
                        options={RECOVERY_PERIOD_OPTIONS.map((o) => ({ id: o.value, name: o.label, hint: o.hint }))}
                        placeholder="Period"
                        triggerClassName="flex-1"
                      />
                      <SingleSelectSearch
                        value={entry.type || ''}
                        onChange={(val) => {
                          const next = formData.uses.recovery.slice();
                          next[idx] = { ...entry, type: val };
                          setFormData((prev) => ({ ...prev, uses: { ...prev.uses, recovery: next } }));
                        }}
                        options={RECOVERY_TYPE_OPTIONS.map((o) => ({ id: o.value, name: o.label }))}
                        placeholder="Type"
                        triggerClassName="flex-1"
                      />
                      <Input
                        value={entry.formula || ''}
                        onChange={(e) => {
                          const next = formData.uses.recovery.slice();
                          next[idx] = { ...entry, formula: e.target.value };
                          setFormData((prev) => ({ ...prev, uses: { ...prev.uses, recovery: next } }));
                        }}
                        className="h-7 text-[10px] font-mono bg-background/40 border-gold/10 flex-1"
                        placeholder="1d4 or @prof"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setFormData((prev) => ({
                            ...prev,
                            uses: { ...prev.uses, recovery: prev.uses.recovery.filter((_, i) => i !== idx) },
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
                          recovery: [...prev.uses.recovery, { period: '', type: '', formula: '' }],
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
      ),
    },
    {
      key: 'activities',
      label: 'Activities',
      render: () => (
        <div className="border-t border-gold/10 pt-4">
          <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-gold mb-2">Activities</h3>
          <ActivityEditor
            activities={formData.activities}
            onChange={(activities) => setFormData(prev => ({ ...prev, activities }))}
            availableEffects={formData.effects}
            context="spell"
          />
        </div>
      ),
    },
    {
      key: 'effects',
      label: 'Effects',
      render: () => (
        <div className="border-t border-gold/10 pt-4">
          <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-gold mb-2">Active Effects</h3>
          <ActiveEffectEditor
            effects={formData.effects}
            onChange={(effects) => setFormData(prev => ({ ...prev, effects }))}
            defaultImg={formData.imageUrl || null}
          />
        </div>
      ),
    },
  ], [formData, sources, editingId]);

  const tagsSubTabsList: TagsSubTab[] = useMemo(() => [
    {
      key: 'tags',
      label: (
        <>
          Tags {formData.tags.length > 0 && (
            <span className="ml-1 text-gold/70">({formData.tags.length})</span>
          )}
        </>
      ),
      render: () => (
        <TagPicker
          tags={tags}
          tagGroups={tagGroups}
          selectedIds={formData.tags}
          onChange={(next) => setFormData(prev => ({ ...prev, tags: next }))}
          hint="Tag rules + class spell list rules use these to decide which spells they include."
          emptyHint="No tags loaded yet."
        />
      ),
    },
    {
      key: 'prereqs',
      label: (
        <>
          Prereqs {formData.requiredTags.length > 0 && (
            <span className="ml-1 text-gold/70">({formData.requiredTags.length})</span>
          )}
        </>
      ),
      render: () => (
        <div className="space-y-3">
          <TagPicker
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
        </div>
      ),
    },
    {
      key: 'rules',
      label: 'Rules',
      render: () => (
        editingId ? (
          <RuleMembershipPanel
            spellId={editingId}
            canEdit={isAdmin}
          />
        ) : (
          <div className="text-xs text-ink/40 italic">
            Save this spell first — rule membership wires up
            to the spell's persisted id.
          </div>
        )
      ),
    },
  ], [tags, tagGroups, formData.tags, formData.requiredTags, formData.prerequisiteText, editingId, isAdmin]);

  // ── List columns ──────────────────────────────────────────────
  const listColumns: EditorListColumn<SpellSummaryRecord & { __pendingDelete?: boolean }>[] = useMemo(() => [
    {
      key: 'name',
      label: 'Name',
      width: 'minmax(0,1fr)',
      align: 'start',
      render: (entry) => {
        if (entry.__pendingDelete) {
          return (
            <span className="truncate font-serif text-sm line-through text-blood/70">
              {entry.name || 'Untitled Spell'}
            </span>
          );
        }
        const drafted = focusModeEnabled && draftedSpellIds.has(String(entry.id));
        return (
          <span className={cn(
            "truncate font-serif text-sm",
            drafted ? 'text-archive-blue font-semibold' : 'text-ink',
          )}>
            {entry.name || <em className="text-ink/40">Untitled</em>}
          </span>
        );
      },
    },
    {
      key: 'level',
      label: 'Lv',
      width: '28px',
      align: 'center',
      render: (entry) => {
        const lvl = Number(entry.level ?? 0);
        return (
          <span className="text-xs text-ink/75 text-center">
            {lvl === 0 ? 'C' : lvl}
          </span>
        );
      },
    },
    {
      key: 'src',
      label: 'Src',
      width: '52px',
      align: 'center',
      render: (entry) => {
        const srcAbbrev = String(sourceAbbrevById[entry.sourceId] || entry.sourceId || '—');
        return (
          <>
            <span className="text-[10px] font-bold text-gold/80 text-center truncate">
              {srcAbbrev}
            </span>
            {!entry.__pendingDelete && (
              <button
                type="button"
                aria-label={`Delete ${entry.name || 'spell'}`}
                onClick={(e) => {
                  e.stopPropagation();
                  const ctrlPressed = e.ctrlKey || e.metaKey;
                  void handleDeleteFromList(entry, ctrlPressed);
                }}
                className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-blood/60 hover:text-blood hover:bg-blood/10 focus:outline-none focus:ring-1 focus:ring-blood/40 transition-colors"
                title="Delete spell — Ctrl+click to skip confirm"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </>
        );
      },
    },
  ], [sourceAbbrevById, focusModeEnabled, draftedSpellIds]);

  // ── Override row render for pendingDelete (tombstone) + drafted-row highlighting ──
  // The shell's default row click handler calls onSelect; we route through
  // startEditing instead so auto-stage fires. For tombstone rows we render a
  // TombstoneRow with an Undo handler. We do this by wrapping the listRows
  // with a custom item-render function via the shell's listColumns mechanism.
  // To keep delete + tombstone semantics, we replace the default row body
  // when __pendingDelete is set by emitting a single column that spans the
  // grid via colSpan-like CSS, but the shell uses a strict grid. So instead,
  // we filter the row select callback to no-op for pending deletes and let
  // the column renders show the strike-through + undo button.
  const handleListSelect = (id: string) => {
    const entry = filteredEntries.find((e) => String(e.id) === id);
    if (entry?.__pendingDelete) return; // tombstones are inert
    void startEditing(id);
  };

  // ── Custom list emptyContent for Block-mode teaching state ────
  const listEmptyContent = useMemo(() => {
    if (focusModeEnabled && focusMode === 'drafts') {
      return (
        <div className="px-6 py-12 text-center text-ink/60 max-w-sm mx-auto space-y-2">
          <p className="font-bold text-ink/80">No spells in this block yet.</p>
          <p className="text-xs leading-relaxed text-ink/55">
            Click <span className="font-bold text-gold">New Spell</span> above to
            author one from scratch.
          </p>
          <p className="text-xs leading-relaxed text-ink/55">
            To propose changes to an existing spell, switch to
            <span className="font-bold text-gold"> Full Catalog</span> (top right,
            next to Submit Changes), open the spell, then click
            <span className="font-bold text-gold"> Edit Base</span> — it'll move
            into this list automatically.
          </p>
        </div>
      );
    }
    return 'No spells match the current search.';
  }, [focusModeEnabled, focusMode]);

  // ── Mode tabs ─────────────────────────────────────────────────
  const modes: EditorMode[] = [
    ...(isAdmin ? [{
      key: 'foundry-import',
      label: 'Foundry Import',
      adminOnly: true,
      render: <SpellImportWorkbench userProfile={userProfile} />,
    } as EditorMode] : []),
    {
      key: 'manual-editor',
      label: 'Manual Editor',
      render: null, // Shell renders the 3-pane editor itself for this key.
    },
  ];

  // ── Admin actions ─────────────────────────────────────────────
  const adminActions = isAdmin ? (
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
  ) : null;

  if (!canManage) {
    return <div className="text-center py-20">Access Denied. Admins or content-creators only.</div>;
  }

  // ── Cascade banner ────────────────────────────────────────────
  const cascadeBanner = cascadeDep ? (
    <CascadeDependentBanner
      description={cascadeDep.description}
      resolved={cascadeDep.resolved}
      onAccept={cascadeDep.accept}
      onReopen={cascadeDep.reopen}
      onReplace={() => setReplaceTagPickerOpen(true)}
    />
  ) : null;

  return (
    <>
      <CompendiumEditorShell<SpellSummaryRecord & { __pendingDelete?: boolean }>
        entityName={{ singular: 'Spell', plural: 'Spells' }}
        backPath={backPath}
        backLabel={backLabel}
        modes={modes}
        defaultModeKey="manual-editor"
        manualEditorModeKey="manual-editor"
        isAdmin={isAdmin}
        adminActions={adminActions}
        listRows={filteredEntries}
        listColumns={listColumns}
        listRowHeight={36}
        loading={loading}
        selectedId={editingId}
        onSelect={handleListSelect}
        onNew={() => void handleCreateNewSpell()}
        getRowId={(row) => String(row.id)}
        emptyListMessage={listEmptyContent}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search spell name, source, or identifier"
        activeFilterCount={activeFilterCount}
        isFilterOpen={isFilterOpen}
        setIsFilterOpen={setIsFilterOpen}
        resetFilters={resetAllFilters}
        renderFilters={
          <SectionFilterPanel
            axes={miniPillAxes}
            axisFilters={axisFilters}
            tagStates={tagStates}
            cycleAxisState={cycleAxisState}
            cycleAxisStateReverse={cycleAxisStateReverse}
            cycleTagState={cycleTagState}
            cycleTagStateReverse={cycleTagStateReverse}
            cycleAxisCombineMode={cycleAxisCombineMode}
            cycleAxisCombineModeReverse={cycleAxisCombineModeReverse}
            cycleAxisExclusionMode={cycleAxisExclusionMode}
            cycleAxisExclusionModeReverse={cycleAxisExclusionModeReverse}
            axisIncludeAll={axisIncludeAll}
            axisExcludeAll={axisExcludeAll}
            axisClear={axisClear}
            axisRestoreDefault={axisRestoreDefault}
            cycleGroupMode={cycleGroupMode}
            cycleGroupModeReverse={cycleGroupModeReverse}
            cycleExclusionMode={cycleGroupExclusionMode}
            cycleExclusionModeReverse={cycleGroupExclusionModeReverse}
            groupCombineModes={groupCombineModes}
            groupExclusionModes={groupExclusionModes}
            setTagStates={setTagStates}
            search={search}
            setSearch={setSearch}
            activeFilterCount={activeFilterCount}
            resetAll={resetAllFilters}
            embedded
          />
        }
        identityName={formData.name}
        identitySourceAbbrev={formData.sourceId ? String(sourceAbbrevById[formData.sourceId] || formData.sourceId) : undefined}
        identitySourceFullName={formData.sourceId ? String(sourceNameById[formData.sourceId] || formData.sourceId) : undefined}
        identitySubtitle={identitySubtitle}
        onSave={(e) => void handleSave(e)}
        onDelete={editingId && !isProposalMode ? handleDelete : undefined}
        onReset={resetForm}
        saving={saving}
        formId="spell-manual-editor-form"
        isReadOnly={isReadOnly}
        onUnlockBase={editingId ? () => unlockBaseSpell(editingId) : undefined}
        cascadeBanner={cascadeBanner}
        proposalMode={!!proposalContext}
        editorSubTabs={editorSubTabs}
        tagsSubTabs={tagsSubTabsList}
        tagsSuperTabCount={formData.tags.length + formData.requiredTags.length}
        renderPreview={(id) =>
          id ? (
            <SpellDetailPanel
              spellId={id}
              emptyMessage="Loading preview…"
              refreshKey={previewRefreshKey}
            />
          ) : (
            <div className="h-full flex items-center justify-center px-6 py-12 text-center">
              <div className="space-y-2 max-w-xs">
                <p className="text-sm text-ink/60 font-serif italic">
                  Preview pane
                </p>
                <p className="text-[11px] text-ink/40 leading-relaxed">
                  Select a spell from the list to preview it as it
                  appears in the public compendium. Pending edits
                  don't reflect until you save.
                </p>
              </div>
            </div>
          )
        }
      />
      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title={`Delete ${formData.name ? `"${formData.name}"` : 'this spell'}?`}
        description={
          isProposalMode
            ? 'A DELETE proposal will be queued in your block. The live spell is not removed until an admin approves.'
            : 'This permanently deletes the spell from the live catalog.'
        }
        confirmLabel="Delete"
        destructive
        onConfirm={performDelete}
      />
      <ConfirmDialog
        open={!!listDeleteTarget}
        onOpenChange={(open) => { if (!open) setListDeleteTarget(null); }}
        title={`Delete "${listDeleteTarget?.name || 'this spell'}"?`}
        description={
          isProposalMode
            ? 'A DELETE proposal will be queued in your block. The live spell is not removed until an admin approves — undo any time before submit.'
            : 'This permanently deletes the spell from the live catalog.'
        }
        confirmLabel="Delete"
        destructive
        onConfirm={performListDelete}
      />
      {cascadeDep && cascadeDep.parentEntityType === 'tag' && cascadeDep.parentEntityId && (
        <TagReplacementPicker
          open={replaceTagPickerOpen}
          onOpenChange={setReplaceTagPickerOpen}
          deletedTagId={cascadeDep.parentEntityId}
          onPicked={async (replacementTagId) => {
            try {
              await cascadeDep.replace(
                cascadeDep.parentEntityId!,
                replacementTagId,
                'tags',
              );
              toast.success('Replacement saved.');
            } catch (err: any) {
              toast.error(err?.message || 'Could not replace tag.');
            }
          }}
        />
      )}
    </>
  );
}

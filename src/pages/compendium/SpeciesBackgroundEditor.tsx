import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  fetchCollection,
  fetchDocument,
  upsertDocument,
  deleteDocument,
} from '../../lib/d1';
import { denormalizeCompendiumData } from '../../lib/compendium';
import { slugify } from '../../lib/utils';
import { bbcodeToHtml } from '../../lib/bbcode';
import { reportClientError, OperationType } from '../../lib/firebase';
import { matchesSingleAxisFilter } from '../../lib/spellFilters';
import { useAxisFilters } from '../../hooks/useAxisFilters';
import {
  CompendiumEditorShell,
  type EditorMode,
  type EditorSubTab,
  type TagsSubTab,
  type EditorListColumn,
} from '../../components/compendium/CompendiumEditorShell';
import { SectionFilterPanel, type FilterSection } from '../../components/compendium/SectionFilterPanel';
import AdvancementManager, { type Advancement } from '../../components/compendium/AdvancementManager';
import ScalingColumnsPanel from '../../components/compendium/ScalingColumnsPanel';
import SpeciesBackgroundImportWorkbench from '../../components/compendium/SpeciesBackgroundImportWorkbench';
import TagPicker from '../../components/compendium/TagPicker';
import { normalizeTagRow } from '../../lib/tagHierarchy';
import MarkdownEditor from '../../components/MarkdownEditor';
import { ImageUpload } from '../../components/ui/ImageUpload';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Checkbox } from '../../components/ui/checkbox';
import SingleSelectSearch from '../../components/ui/SingleSelectSearch';

/**
 * SpeciesBackgroundEditor
 * ───────────────────────
 * Dedicated Pattern E editor for the `species` + `backgrounds` tables
 * (migration 20260601-1200), which graduated out of the shared `feats`
 * table. One component drives both: the `kind` prop selects the target
 * table, the type-specific sub-tab, and the AdvancementManager
 * `parentContext`. Everything else (identity, description, advancements,
 * scaling columns, tags) is shared.
 *
 * Naming: the user-facing entity is "Species" (the 2024 rename of
 * "Race"). The Foundry export `type` stays "race" — handled by the
 * exporter, not here. The route URL is still `/compendium/races`.
 *
 * camelCase data layer: these tables use camelCase column names, so the
 * editor writes through `upsertDocument` / reads through `fetchDocument`
 * DIRECTLY — no `normalizeCompendiumData` / `denormalizeCompendiumData`
 * snake↔camel mapping (those are for the legacy snake_case tables). The
 * only boundary translation is `tags` (column) ↔ `tagIds` (form), done
 * inline. JSON columns (movement / senses / creatureType /
 * startingEquipment / advancements / tags) are auto-parsed on read by
 * queryD1's jsonFields list and auto-stringified on write by
 * upsertDocument.
 *
 * v1 scope: admin + content-creator direct-write. Proposal-mode
 * authoring (cascade banners, review highlights, block drafts) is a
 * deliberate follow-up — `species` / `background` aren't registered
 * proposal entity types yet (that needs a proposals CHECK migration).
 * The Foundry-import workbench mode is likewise a follow-up (the
 * importer is the next planned step).
 */

export type SpeciesBackgroundKind = 'species' | 'background';

// ─── Vocabularies ──────────────────────────────────────────────────

// dnd5e MovementField speed keys (system.movement). `units` + `hover`
// round out the object; `walk` defaults to 30.
const MOVEMENT_SPEEDS: Array<[string, string]> = [
  ['walk', 'Walk'],
  ['fly', 'Fly'],
  ['swim', 'Swim'],
  ['climb', 'Climb'],
  ['burrow', 'Burrow'],
];

// dnd5e SensesField range keys (system.senses).
const SENSE_RANGES: Array<[string, string]> = [
  ['darkvision', 'Darkvision'],
  ['blindsight', 'Blindsight'],
  ['tremorsense', 'Tremorsense'],
  ['truesight', 'Truesight'],
];

// Shared distance units for movement + senses (dnd5e uses ft canonically).
const DISTANCE_UNITS: Array<[string, string]> = [
  ['ft', 'feet'],
  ['mi', 'miles'],
  ['m', 'meters'],
  ['km', 'km'],
];

// dnd5e CreatureTypeField.value enum — the creature type a species confers.
const CREATURE_TYPES: Array<[string, string]> = [
  ['aberration', 'Aberration'],
  ['beast', 'Beast'],
  ['celestial', 'Celestial'],
  ['construct', 'Construct'],
  ['dragon', 'Dragon'],
  ['elemental', 'Elemental'],
  ['fey', 'Fey'],
  ['fiend', 'Fiend'],
  ['giant', 'Giant'],
  ['humanoid', 'Humanoid'],
  ['monstrosity', 'Monstrosity'],
  ['ooze', 'Ooze'],
  ['plant', 'Plant'],
  ['undead', 'Undead'],
];

// ─── Form data shape ───────────────────────────────────────────────

type MovementShape = {
  walk: number | null;
  fly: number | null;
  swim: number | null;
  climb: number | null;
  burrow: number | null;
  hover: boolean;
  units: string;
};

type SensesShape = {
  darkvision: number | null;
  blindsight: number | null;
  tremorsense: number | null;
  truesight: number | null;
  units: string;
  special: string;
};

type CreatureTypeShape = {
  value: string;
  subtype: string;
  swarm: string;
  custom: string;
};

type SBFormData = {
  id?: string;
  // Identity (shared)
  name: string;
  identifier: string;
  sourceId: string;
  page: string;
  imageUrl: string;
  description: string;
  // Shared mechanics
  advancements: Advancement[];
  tagIds: string[];
  // Background-only
  wealth: string;
  startingEquipment: any[];
  // Species-only
  movement: MovementShape;
  senses: SensesShape;
  creatureType: CreatureTypeShape;
  // Bookkeeping
  createdAt?: string;
  updatedAt?: string;
  [key: string]: any;
};

const DEFAULT_MOVEMENT: MovementShape = {
  walk: 30, fly: null, swim: null, climb: null, burrow: null, hover: false, units: 'ft',
};
const DEFAULT_SENSES: SensesShape = {
  darkvision: null, blindsight: null, tremorsense: null, truesight: null, units: 'ft', special: '',
};
const DEFAULT_CREATURE_TYPE: CreatureTypeShape = {
  value: 'humanoid', subtype: '', swarm: '', custom: '',
};

function makeInitialForm(sources: any[] = []): SBFormData {
  return {
    name: '',
    identifier: '',
    sourceId: sources[0]?.id || '',
    page: '',
    imageUrl: '',
    description: '',
    advancements: [],
    tagIds: [],
    wealth: '',
    startingEquipment: [],
    movement: { ...DEFAULT_MOVEMENT },
    senses: { ...DEFAULT_SENSES },
    creatureType: { ...DEFAULT_CREATURE_TYPE },
  };
}

// ── Per-kind config ────────────────────────────────────────────────

type KindConfig = {
  collection: string;
  singular: string;
  plural: string;
  backPath: string;
  backLabel: string;
  formId: string;
  searchPlaceholder: string;
  parentContext: 'race' | 'background';
  scalingParentType: 'race' | 'background';
  scalingLabel: string;
  referenceSheetTitle: string;
  storageFolder: string;
};

const KIND_CONFIG: Record<SpeciesBackgroundKind, KindConfig> = {
  species: {
    collection: 'species',
    singular: 'Species',
    plural: 'Species',
    backPath: '/compendium/races',
    backLabel: 'Back To Species',
    formId: 'species-manual-editor-form',
    searchPlaceholder: 'Search species name, identifier, or source',
    parentContext: 'race',
    scalingParentType: 'race',
    scalingLabel: 'Species Columns',
    referenceSheetTitle: 'Species Reference Sheet',
    storageFolder: 'species',
  },
  background: {
    collection: 'backgrounds',
    singular: 'Background',
    plural: 'Backgrounds',
    backPath: '/compendium/backgrounds',
    backLabel: 'Back To Backgrounds',
    formId: 'background-manual-editor-form',
    searchPlaceholder: 'Search background name, identifier, or source',
    parentContext: 'background',
    scalingParentType: 'background',
    scalingLabel: 'Background Columns',
    referenceSheetTitle: 'Background Reference Sheet',
    storageFolder: 'backgrounds',
  },
};

// SectionFilterPanel requires tag-axis handlers even when a page has no
// tag-kind axes. Stable top-level no-ops so memoised axes don't re-key.
const NOOP_CYCLE_TAG = () => { /* no tag axes here */ };
const NOOP_SET_TAG_STATES: React.Dispatch<React.SetStateAction<Record<string, number>>> = () => { /* no tag axes here */ };
const EMPTY_TAG_STATES: Record<string, number> = {};

const SB_AXIS_KEYS = ['source'] as const;

// ─── Page ─────────────────────────────────────────────────────────

export default function SpeciesBackgroundEditor({
  userProfile,
  kind,
}: {
  userProfile: any;
  kind: SpeciesBackgroundKind;
}) {
  const cfg = KIND_CONFIG[kind];
  const isAdmin = userProfile?.role === 'admin';
  const isContentCreator = !!userProfile?.permissions &&
    Object.prototype.hasOwnProperty.call(userProfile.permissions, 'content-creator');
  const canManage = isAdmin || isContentCreator;

  // ── State ─────────────────────────────────────────────────────
  const [entries, setEntries] = useState<any[]>([]);
  const [sources, setSources] = useState<any[]>([]);
  const [tags, setTags] = useState<Array<{ id: string; name: string; groupId: string | null; parentTagId: string | null }>>([]);
  const [tagGroups, setTagGroups] = useState<Array<{ id: string; name: string }>>([]);
  const [availableFeats, setAvailableFeats] = useState<any[]>([]);
  const [availableFeatures, setAvailableFeatures] = useState<any[]>([]);
  const [availableOptionGroups, setAvailableOptionGroups] = useState<any[]>([]);
  const [availableOptionItems, setAvailableOptionItems] = useState<any[]>([]);

  const { axisFilters, cyclers, activeFilterCount, resetAll: resetAxisFilters } =
    useAxisFilters(SB_AXIS_KEYS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [isFilterOpen, setIsFilterOpen] = useState(false);

  // URL-backed editingId so AdvancementManager / ScalingColumnsPanel
  // "+ Add" navigations return here with the row still selected.
  const [urlSearchParams, setUrlSearchParams] = useSearchParams();
  const [editingId, setEditingId] = useState<string | null>(urlSearchParams.get('editingId'));
  const [formData, setFormData] = useState<SBFormData>(makeInitialForm());

  // Scaling columns owned by the currently-edited row (parent_type =
  // 'race' | 'background'). Dragonborn-style ScaleValue advancements
  // reference these via @scale.<identifier>.<column>.
  const [scalingColumns, setScalingColumns] = useState<any[]>([]);
  const [scalingLoadTick, setScalingLoadTick] = useState(0);

  // editingId → URL (replace: keeps the back stack clean while clicking).
  useEffect(() => {
    const current = urlSearchParams.get('editingId');
    if (editingId && editingId !== current) {
      setUrlSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('editingId', editingId);
        return next;
      }, { replace: true });
    } else if (!editingId && current) {
      setUrlSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('editingId');
        return next;
      }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId]);

  // URL → editingId (back/forward, address bar). Equality guard avoids a loop.
  useEffect(() => {
    const urlEditingId = urlSearchParams.get('editingId');
    if ((urlEditingId || null) !== editingId) setEditingId(urlEditingId || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlSearchParams]);

  const lastLoadedFormRef = useRef<string>('');

  // ── Initial load ──────────────────────────────────────────────
  useEffect(() => {
    if (!canManage) return;
    let cancelled = false;
    (async () => {
      try {
        const [rows, sourceRows, tagRows, tagGroupRows, featRows, featureRows, optionGroupRows, optionItemRows] =
          await Promise.all([
            fetchCollection<any>(cfg.collection, { orderBy: 'name ASC' }),
            fetchCollection<any>('sources', { orderBy: 'name ASC' }),
            fetchCollection<any>('tags', { orderBy: 'name ASC' }),
            fetchCollection<any>('tagGroups', { orderBy: 'name ASC' }),
            fetchCollection<any>('feats', { orderBy: 'name ASC' }),
            fetchCollection<any>('features', { orderBy: 'name ASC' }),
            fetchCollection<any>('uniqueOptionGroups', { orderBy: 'name ASC' }),
            fetchCollection<any>('uniqueOptionItems', { orderBy: 'name ASC' }),
          ]);
        if (cancelled) return;
        setEntries(rows);
        setSources(sourceRows);
        setAvailableFeats(featRows);
        setAvailableFeatures(featureRows);
        setAvailableOptionGroups(optionGroupRows);
        setAvailableOptionItems(optionItemRows);
        setTags(tagRows.map((row: any) => {
          const n = normalizeTagRow(row);
          return {
            id: String(n.id),
            name: String(n.name || ''),
            groupId: n.groupId ?? null,
            parentTagId: n.parentTagId ?? null,
          };
        }));
        setTagGroups(tagGroupRows.map((row: any) => ({ id: String(row.id), name: String(row.name || '') })));
        setLoading(false);
      } catch (err) {
        console.error(`[SpeciesBackgroundEditor:${kind}] failed to load:`, err);
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [canManage, cfg.collection, kind]);

  // Default source on first New row.
  useEffect(() => {
    if (editingId) return;
    if (formData.sourceId || sources.length === 0) return;
    setFormData((prev) => ({ ...prev, sourceId: sources[0].id }));
  }, [editingId, formData.sourceId, sources]);

  const sourceNameById = useMemo(
    () => Object.fromEntries(sources.map((s) => [s.id, s.name || s.abbreviation || s.id])),
    [sources],
  );
  const sourceAbbrevById = useMemo(
    () => Object.fromEntries(sources.map((s) => [s.id, s.abbreviation || s.shortName || s.name || s.id])),
    [sources],
  );

  // ── Reset / hydrate ───────────────────────────────────────────
  const resetForm = () => {
    const initial = makeInitialForm(sources);
    setEditingId(null);
    setFormData(initial);
    lastLoadedFormRef.current = JSON.stringify(initial);
  };

  // Hydrate form when editingId changes. Reads the row from the list
  // cache when present, else fetches it. Columns are camelCase, so the
  // row maps almost 1:1 — only `tags` → `tagIds` is renamed.
  useEffect(() => {
    if (!editingId) return;
    let active = true;
    const hydrate = (row: any) => {
      const defaults = makeInitialForm(sources);
      const loaded: SBFormData = {
        ...defaults,
        ...row,
        id: row.id,
        name: row.name || '',
        identifier: row.identifier || '',
        sourceId: row.sourceId || sources[0]?.id || '',
        page: String(row.page || ''),
        imageUrl: row.imageUrl || '',
        description: row.description || '',
        advancements: Array.isArray(row.advancements) ? row.advancements : [],
        tagIds: Array.isArray(row.tags) ? row.tags : [],
        wealth: String(row.wealth || ''),
        startingEquipment: Array.isArray(row.startingEquipment) ? row.startingEquipment : [],
        movement: row.movement && typeof row.movement === 'object'
          ? { ...DEFAULT_MOVEMENT, ...row.movement }
          : { ...DEFAULT_MOVEMENT },
        senses: row.senses && typeof row.senses === 'object'
          ? { ...DEFAULT_SENSES, ...row.senses }
          : { ...DEFAULT_SENSES },
        creatureType: row.creatureType && typeof row.creatureType === 'object'
          ? { ...DEFAULT_CREATURE_TYPE, ...row.creatureType }
          : { ...DEFAULT_CREATURE_TYPE },
      };
      setFormData(loaded);
      lastLoadedFormRef.current = JSON.stringify(loaded);
    };

    const cached = entries.find((e) => String(e.id) === editingId);
    if (cached) {
      hydrate(cached);
      return;
    }
    (async () => {
      try {
        const row = await fetchDocument<any>(cfg.collection, editingId);
        if (!active || !row) return;
        hydrate(row);
      } catch (err) {
        console.error(`[SpeciesBackgroundEditor:${kind}] failed to load row:`, err);
      }
    })();
    return () => { active = false; };
  }, [editingId, entries, sources, cfg.collection, kind]);

  // Scaling columns for the current row.
  useEffect(() => {
    if (!editingId) { setScalingColumns([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const rows = await fetchCollection<any>('scaling_columns', {
          where: 'parent_id = ? AND parent_type = ?',
          params: [editingId, cfg.scalingParentType],
          orderBy: 'name ASC',
        });
        if (cancelled) return;
        setScalingColumns(rows.map((r: any) => denormalizeCompendiumData(r)));
      } catch (err) {
        console.error(`[SpeciesBackgroundEditor:${kind}] scaling_columns load failed:`, err);
      }
    })();
    return () => { cancelled = true; };
  }, [editingId, scalingLoadTick, cfg.scalingParentType, kind]);

  // ── Save / Delete ─────────────────────────────────────────────
  const refreshEntries = async () => {
    try {
      const rows = await fetchCollection<any>(cfg.collection, { orderBy: 'name ASC' });
      setEntries(rows);
    } catch (err) {
      console.error(`[SpeciesBackgroundEditor:${kind}] refresh failed:`, err);
    }
  };

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!formData.name.trim()) { toast.error(`${cfg.singular} name is required`); return; }
    if (!formData.sourceId) { toast.error('Source is required'); return; }

    setSaving(true);
    try {
      // Build the camelCase row. Only the columns that exist on the
      // target table are included — never cross-write species columns
      // onto a background row or vice versa.
      const payload: Record<string, any> = {
        name: formData.name.trim(),
        identifier: formData.identifier.trim() || slugify(formData.name),
        sourceId: formData.sourceId,
        page: formData.page.trim() || null,
        imageUrl: formData.imageUrl || null,
        description: formData.description || '',
        advancements: Array.isArray(formData.advancements) ? formData.advancements : [],
        tags: Array.isArray(formData.tagIds) ? formData.tagIds : [],
        updatedAt: new Date().toISOString(),
      };
      if (kind === 'background') {
        payload.wealth = formData.wealth.trim();
        payload.startingEquipment = Array.isArray(formData.startingEquipment) ? formData.startingEquipment : [];
      } else {
        payload.movement = formData.movement;
        payload.senses = formData.senses;
        payload.creatureType = formData.creatureType;
      }

      const wasCreate = !editingId;
      const entryId = editingId || crypto.randomUUID();
      await upsertDocument(cfg.collection, entryId, {
        ...payload,
        createdAt: formData.createdAt || new Date().toISOString(),
      });
      toast.success(`${cfg.singular} ${wasCreate ? 'created' : 'updated'}`);
      await refreshEntries();
      resetForm();
    } catch (error) {
      console.error(`[SpeciesBackgroundEditor:${kind}] save failed:`, error);
      toast.error(`Failed to save ${cfg.singular.toLowerCase()}`);
      reportClientError(
        error,
        editingId ? OperationType.UPDATE : OperationType.CREATE,
        `${cfg.collection}/${editingId || '(new)'}`,
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!editingId) return;
    if (!window.confirm(`Delete this ${cfg.singular.toLowerCase()}?`)) return;
    try {
      await deleteDocument(cfg.collection, editingId);
      toast.success(`${cfg.singular} deleted`);
      await refreshEntries();
      resetForm();
    } catch (error) {
      console.error(`[SpeciesBackgroundEditor:${kind}] delete failed:`, error);
      toast.error(`Failed to delete ${cfg.singular.toLowerCase()}`);
      reportClientError(error, OperationType.DELETE, `${cfg.collection}/${editingId}`);
    }
  };

  // ── Filter pipeline ───────────────────────────────────────────
  const filteredEntries = useMemo(() => {
    const lowered = search.trim().toLowerCase();
    return entries.filter((entry) => {
      if (lowered) {
        const abbrev = String(sourceAbbrevById[entry.sourceId] || '').toLowerCase();
        const hit = String(entry.name || '').toLowerCase().includes(lowered)
          || String(entry.identifier || '').toLowerCase().includes(lowered)
          || abbrev.includes(lowered);
        if (!hit) return false;
      }
      if (!matchesSingleAxisFilter(String(entry.sourceId ?? ''), axisFilters.source)) return false;
      return true;
    });
  }, [entries, search, sourceAbbrevById, axisFilters]);

  const filterAxes = useMemo<FilterSection[]>(() => ([
    {
      key: 'source', name: 'Sources', kind: 'axis',
      values: sources.map((s) => ({
        value: s.id,
        label: String(s.abbreviation || s.shortName || s.name || s.id),
        labelAlt: String(s.name || s.shortName || s.abbreviation || s.id),
      })),
    },
  ]), [sources]);

  // ── Identity subtitle ─────────────────────────────────────────
  const identitySubtitle = useMemo(() => {
    if (kind === 'species') {
      const parts: string[] = [];
      const ct = CREATURE_TYPES.find(([v]) => v === formData.creatureType.value)?.[1];
      if (ct) parts.push(ct);
      if (formData.movement.walk != null) parts.push(`${formData.movement.walk} ${formData.movement.units}`);
      if (formData.creatureType.subtype) parts.push(formData.creatureType.subtype);
      return parts.join(' · ') || 'Species';
    }
    const parts: string[] = ['Background'];
    if (formData.wealth) parts.push(`Wealth ${formData.wealth}`);
    return parts.join(' · ');
  }, [kind, formData.creatureType, formData.movement, formData.wealth]);

  // ── Editor sub-tabs ───────────────────────────────────────────
  const editorSubTabs: EditorSubTab[] = useMemo(() => {
    const tabs: EditorSubTab[] = [
      {
        key: 'basics',
        label: 'Basics',
        layout: 'fill',
        render: () => (
          <BasicsFields
            formData={formData}
            setFormData={setFormData}
            sources={sources}
            editingId={editingId}
            storageFolder={cfg.storageFolder}
          />
        ),
      },
    ];

    if (kind === 'species') {
      tabs.push({
        key: 'traits',
        label: 'Traits',
        layout: 'scroll',
        render: () => <SpeciesTraitsFields formData={formData} setFormData={setFormData} />,
      });
    } else {
      tabs.push({
        key: 'details',
        label: 'Details',
        layout: 'scroll',
        render: () => <BackgroundDetailsFields formData={formData} setFormData={setFormData} />,
      });
    }

    tabs.push({
      key: 'advancement',
      label: 'Advancement',
      render: () => (
        <div className="border-t border-gold/10 pt-4 space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-gold">Advancement</h3>
            <span className="text-[10px] text-ink/40 italic">
              {kind === 'species'
                ? 'Racial traits are Grant Item advancements; size is a Size advancement; breath-weapon-style dice are ScaleValue.'
                : 'Backgrounds usually grant a feat / skill proficiencies via Grant advancements.'}
            </span>
          </div>
          <AdvancementManager
            advancements={formData.advancements}
            onChange={(advancements) => setFormData((prev) => ({ ...prev, advancements }))}
            parentContext={cfg.parentContext}
            availableScalingColumns={scalingColumns}
            availableFeats={availableFeats}
            availableFeatures={availableFeatures}
            availableOptionGroups={availableOptionGroups}
            availableOptionItems={availableOptionItems}
            defaultLevel={kind === 'species' ? 0 : 1}
            referenceContext={{
              classLabel: formData.name || cfg.singular,
              classIdentifier: formData.identifier || slugify(formData.name || cfg.singular),
            }}
            referenceSheetTitle={cfg.referenceSheetTitle}
          />
        </div>
      ),
    });

    tabs.push({
      key: 'scaling',
      label: 'Scaling',
      render: () => (
        <div className="border-t border-gold/10 pt-4 space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-gold">{cfg.scalingLabel}</h3>
            <span className="text-[10px] text-ink/40 italic">
              Per-level progression tables this {cfg.singular.toLowerCase()} owns. ScaleValue
              advancements reference them as <span className="font-mono">@scale.&lt;identifier&gt;.&lt;column&gt;</span>.
            </span>
          </div>
          {editingId ? (
            <ScalingColumnsPanel
              parentId={editingId}
              parentType={cfg.scalingParentType}
              columns={scalingColumns}
              onColumnsChanged={() => setScalingLoadTick((t) => t + 1)}
              userProfile={userProfile}
              label={cfg.scalingLabel}
            />
          ) : (
            <div className="p-4 border border-gold/10 bg-card/30 rounded-xl">
              <p className="text-[11px] text-ink/50 italic leading-relaxed">
                Save this {cfg.singular.toLowerCase()} first to add scaling columns — columns
                attach to a stable row id.
              </p>
            </div>
          )}
        </div>
      ),
    });

    return tabs;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, formData, sources, editingId, scalingColumns, availableFeats, availableFeatures, availableOptionGroups, availableOptionItems]);

  const tagsSubTabs: TagsSubTab[] = useMemo(() => [
    {
      key: 'tags',
      label: (
        <>
          Tags {formData.tagIds.length > 0 && (
            <span className="ml-1 text-gold/70">({formData.tagIds.length})</span>
          )}
        </>
      ),
      render: () => (
        <TagPicker
          tags={tags}
          tagGroups={tagGroups}
          selectedIds={formData.tagIds}
          onChange={(next) => setFormData((prev) => ({ ...prev, tagIds: next }))}
          hint="Tag rules use these to decide which entries they include."
          emptyHint="No tags loaded yet."
        />
      ),
    },
  ], [tags, tagGroups, formData.tagIds]);

  // ── List columns ──────────────────────────────────────────────
  const listColumns: EditorListColumn<any>[] = useMemo(() => [
    {
      key: 'name',
      label: 'Name',
      width: 'minmax(0,1fr)',
      align: 'start',
      render: (entry: any) => (
        <span className="truncate font-serif text-sm text-ink">
          {entry.name || <em className="text-ink/40">Untitled</em>}
        </span>
      ),
    },
    {
      key: 'source',
      label: 'Src',
      width: '50px',
      align: 'center',
      render: (entry: any) => (
        <span className="text-[10px] font-bold text-gold/80">
          {sourceAbbrevById[entry.sourceId] || '—'}
        </span>
      ),
    },
  ], [sourceAbbrevById]);

  // ── Mode tabs ─────────────────────────────────────────────────
  // Foundry-import workbench (admin-only) + manual editor. The
  // workbench's onImported refreshes the manual-editor list so freshly
  // imported rows show up without a reload.
  const modes: EditorMode[] = [
    ...(isAdmin ? [{
      key: 'foundry-import',
      label: 'Foundry Import',
      adminOnly: true,
      render: (
        <SpeciesBackgroundImportWorkbench
          userProfile={userProfile}
          kind={kind}
          onImported={() => { void refreshEntries(); }}
        />
      ),
    } as EditorMode] : []),
    { key: 'manual-editor', label: 'Manual Editor', render: null },
  ];

  if (!canManage) {
    return <div className="text-center py-20">Access Denied. Admins or content-creators only.</div>;
  }

  return (
    <CompendiumEditorShell<any>
      entityName={{ singular: cfg.singular, plural: cfg.plural }}
      backPath={cfg.backPath}
      backLabel={cfg.backLabel}
      modes={modes}
      defaultModeKey="manual-editor"
      manualEditorModeKey="manual-editor"
      isAdmin={isAdmin}
      listRows={filteredEntries}
      listColumns={listColumns}
      listRowHeight={36}
      loading={loading}
      selectedId={editingId}
      onSelect={(id) => setEditingId(id)}
      onNew={resetForm}
      getRowId={(row) => String(row.id)}
      search={search}
      onSearchChange={setSearch}
      searchPlaceholder={cfg.searchPlaceholder}
      activeFilterCount={activeFilterCount}
      isFilterOpen={isFilterOpen}
      setIsFilterOpen={setIsFilterOpen}
      resetFilters={() => { setSearch(''); resetAxisFilters(); }}
      renderFilters={
        <SectionFilterPanel
          axes={filterAxes}
          axisFilters={axisFilters}
          tagStates={EMPTY_TAG_STATES}
          setTagStates={NOOP_SET_TAG_STATES}
          cycleAxisState={cyclers.cycleAxisState}
          cycleAxisStateReverse={cyclers.cycleAxisStateReverse}
          cycleTagState={NOOP_CYCLE_TAG}
          cycleTagStateReverse={NOOP_CYCLE_TAG}
          cycleAxisCombineMode={cyclers.cycleAxisCombineMode}
          cycleAxisCombineModeReverse={cyclers.cycleAxisCombineModeReverse}
          cycleAxisExclusionMode={cyclers.cycleAxisExclusionMode}
          cycleAxisExclusionModeReverse={cyclers.cycleAxisExclusionModeReverse}
          axisIncludeAll={cyclers.axisIncludeAll}
          axisExcludeAll={cyclers.axisExcludeAll}
          axisClear={cyclers.axisClear}
          search={search}
          setSearch={setSearch}
          searchPlaceholder={cfg.searchPlaceholder}
          activeFilterCount={activeFilterCount}
          resetAll={() => { setSearch(''); resetAxisFilters(); }}
          embedded
        />
      }
      filterTitle={`Filter ${cfg.plural}`}
      identityName={formData.name}
      identitySourceAbbrev={formData.sourceId ? String(sourceAbbrevById[formData.sourceId] || formData.sourceId) : undefined}
      identitySourceFullName={formData.sourceId ? String(sourceNameById[formData.sourceId] || formData.sourceId) : undefined}
      identitySubtitle={identitySubtitle}
      onSave={(e) => void handleSave(e)}
      onDelete={editingId ? handleDelete : undefined}
      onReset={resetForm}
      saving={saving}
      formId={cfg.formId}
      editorSubTabs={editorSubTabs}
      tagsSubTabs={tagsSubTabs}
      tagsSuperTabCount={formData.tagIds.length}
      renderPreview={(id) => {
        if (!id && !formData.name) {
          return (
            <div className="px-6 py-12 text-center text-ink/50">
              Select or create a {cfg.singular.toLowerCase()} to preview it here.
            </div>
          );
        }
        return (
          <SBPreview
            kind={kind}
            formData={formData}
            sourceAbbrev={formData.sourceId ? String(sourceAbbrevById[formData.sourceId] || '') : ''}
            sourceName={formData.sourceId ? String(sourceNameById[formData.sourceId] || '') : ''}
          />
        );
      }}
    />
  );
}

// ─── Basics fields (shared) ─────────────────────────────────────────

function BasicsFields({
  formData,
  setFormData,
  sources,
  editingId,
  storageFolder,
}: {
  formData: SBFormData;
  setFormData: React.Dispatch<React.SetStateAction<SBFormData>>;
  sources: any[];
  editingId: string | null;
  storageFolder: string;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-[80px_minmax(0,1fr)] shrink-0">
        <ImageUpload
          currentImageUrl={formData.imageUrl}
          storagePath={`images/${storageFolder}/${editingId || 'draft'}/`}
          onUpload={(url) => setFormData((prev) => ({ ...prev, imageUrl: url }))}
          imageType="icon"
          compact
          className="h-[80px] w-[80px]"
        />
        <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
          <div className="space-y-0.5">
            <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/40">Name</Label>
            <Input
              value={formData.name}
              onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
              className="h-8 bg-background/50 border-gold/10 focus:border-gold text-sm"
              placeholder="e.g. Mountain Dwarf"
              required
            />
          </div>
          <div className="space-y-0.5">
            <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/40">Identifier</Label>
            <Input
              value={formData.identifier}
              onChange={(e) => setFormData((prev) => ({ ...prev, identifier: e.target.value }))}
              className="h-8 bg-background/50 border-gold/10 focus:border-gold font-mono text-sm"
              placeholder={slugify(formData.name || 'entry')}
            />
          </div>
          <div className="space-y-0.5">
            <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/40">Source</Label>
            <select
              value={formData.sourceId}
              onChange={(e) => setFormData((prev) => ({ ...prev, sourceId: e.target.value }))}
              className="w-full h-8 px-2 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-sm"
            >
              <option value="">Select a source</option>
              {sources.map((source) => (
                <option key={source.id} value={source.id}>{source.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-0.5">
            <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/40">Page</Label>
            <Input
              value={formData.page}
              onChange={(e) => setFormData((prev) => ({ ...prev, page: e.target.value }))}
              className="h-8 bg-background/50 border-gold/10 focus:border-gold text-sm"
              placeholder="e.g. 36"
            />
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col min-h-0 space-y-1">
        <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/40">Description</Label>
        <MarkdownEditor
          value={formData.description}
          onChange={(description) => setFormData((prev) => ({ ...prev, description }))}
          fillContainer
        />
      </div>
    </div>
  );
}

// ─── Species traits fields (movement / senses / creature type) ──────

function SpeciesTraitsFields({
  formData,
  setFormData,
}: {
  formData: SBFormData;
  setFormData: React.Dispatch<React.SetStateAction<SBFormData>>;
}) {
  const numOrNull = (raw: string): number | null => {
    const t = raw.trim();
    if (t === '') return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  };

  return (
    <div className="space-y-5 pt-4 border-t border-gold/10">
      {/* Movement */}
      <section className="space-y-2">
        <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-gold">Movement</h3>
        <div className="grid gap-3 grid-cols-2 md:grid-cols-5">
          {MOVEMENT_SPEEDS.map(([key, label]) => (
            <div key={key} className="space-y-0.5">
              <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/40">{label}</Label>
              <Input
                type="number"
                min={0}
                value={(formData.movement as any)[key] ?? ''}
                onChange={(e) => setFormData((prev) => ({
                  ...prev,
                  movement: { ...prev.movement, [key]: numOrNull(e.target.value) },
                }))}
                className="h-8 bg-background/50 border-gold/10 focus:border-gold text-sm"
                placeholder="—"
              />
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-0.5">
            <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/40">Units</Label>
            <SingleSelectSearch
              value={formData.movement.units || 'ft'}
              onChange={(val) => setFormData((prev) => ({ ...prev, movement: { ...prev.movement, units: val } }))}
              options={DISTANCE_UNITS.map(([v, l]) => ({ id: v, name: l }))}
              triggerClassName="w-28"
              allowClear={false}
            />
          </div>
          <label className="flex items-center gap-2 pb-1.5">
            <Checkbox
              checked={!!formData.movement.hover}
              onCheckedChange={(checked) => setFormData((prev) => ({ ...prev, movement: { ...prev.movement, hover: !!checked } }))}
            />
            <span className="text-xs text-ink/70">Hover</span>
          </label>
        </div>
      </section>

      {/* Senses */}
      <section className="space-y-2">
        <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-gold">Senses</h3>
        <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
          {SENSE_RANGES.map(([key, label]) => (
            <div key={key} className="space-y-0.5">
              <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/40">{label}</Label>
              <Input
                type="number"
                min={0}
                value={(formData.senses as any)[key] ?? ''}
                onChange={(e) => setFormData((prev) => ({
                  ...prev,
                  senses: { ...prev.senses, [key]: numOrNull(e.target.value) },
                }))}
                className="h-8 bg-background/50 border-gold/10 focus:border-gold text-sm"
                placeholder="—"
              />
            </div>
          ))}
        </div>
        <div className="grid gap-3 md:grid-cols-[7rem_minmax(0,1fr)]">
          <div className="space-y-0.5">
            <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/40">Units</Label>
            <SingleSelectSearch
              value={formData.senses.units || 'ft'}
              onChange={(val) => setFormData((prev) => ({ ...prev, senses: { ...prev.senses, units: val } }))}
              options={DISTANCE_UNITS.map(([v, l]) => ({ id: v, name: l }))}
              triggerClassName="w-28"
              allowClear={false}
            />
          </div>
          <div className="space-y-0.5">
            <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/40">Special senses</Label>
            <Input
              value={formData.senses.special}
              onChange={(e) => setFormData((prev) => ({ ...prev, senses: { ...prev.senses, special: e.target.value } }))}
              className="h-8 bg-background/50 border-gold/10 focus:border-gold text-sm"
              placeholder="e.g. can't be blinded"
            />
          </div>
        </div>
      </section>

      {/* Creature type */}
      <section className="space-y-2">
        <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-gold">Creature Type</h3>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="space-y-0.5">
            <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/40">Type</Label>
            <SingleSelectSearch
              value={formData.creatureType.value || 'humanoid'}
              onChange={(val) => setFormData((prev) => ({ ...prev, creatureType: { ...prev.creatureType, value: val } }))}
              options={CREATURE_TYPES.map(([v, l]) => ({ id: v, name: l }))}
              triggerClassName="w-full"
              allowClear={false}
            />
          </div>
          <div className="space-y-0.5">
            <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/40">Subtype</Label>
            <Input
              value={formData.creatureType.subtype}
              onChange={(e) => setFormData((prev) => ({ ...prev, creatureType: { ...prev.creatureType, subtype: e.target.value } }))}
              className="h-8 bg-background/50 border-gold/10 focus:border-gold text-sm"
              placeholder="e.g. elf, dwarf"
            />
          </div>
          <div className="space-y-0.5">
            <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/40">Custom</Label>
            <Input
              value={formData.creatureType.custom}
              onChange={(e) => setFormData((prev) => ({ ...prev, creatureType: { ...prev.creatureType, custom: e.target.value } }))}
              className="h-8 bg-background/50 border-gold/10 focus:border-gold text-sm"
              placeholder="override label"
            />
          </div>
        </div>
      </section>
    </div>
  );
}

// ─── Background details fields (wealth / starting equipment) ─────────

function BackgroundDetailsFields({
  formData,
  setFormData,
}: {
  formData: SBFormData;
  setFormData: React.Dispatch<React.SetStateAction<SBFormData>>;
}) {
  return (
    <div className="space-y-5 pt-4 border-t border-gold/10">
      <section className="space-y-2">
        <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-gold">Starting Wealth</h3>
        <div className="md:max-w-xs space-y-0.5">
          <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/40">
            Wealth formula
          </Label>
          <Input
            value={formData.wealth}
            onChange={(e) => setFormData((prev) => ({ ...prev, wealth: e.target.value }))}
            className="h-8 bg-background/50 border-gold/10 focus:border-gold font-mono text-sm"
            placeholder="e.g. 50 or 5d4 * 10"
          />
          <p className="text-[10px] text-ink/40 italic">
            dnd5e FormulaField — starting gold (gp) when the table uses the wealth option.
          </p>
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-gold">Starting Equipment</h3>
        <div className="p-4 border border-gold/10 bg-card/30 rounded-xl space-y-1.5">
          <p className="text-[11px] text-ink/55 leading-relaxed">
            {formData.startingEquipment.length > 0
              ? `${formData.startingEquipment.length} equipment ${formData.startingEquipment.length === 1 ? 'entry' : 'entries'} are stored on this background (preserved on save).`
              : 'No starting-equipment entries yet.'}
          </p>
          <p className="text-[10px] text-ink/40 italic leading-relaxed">
            The structured EquipmentEntryData tree (AND/OR groups, linked items,
            currency, focus) is populated by the Foundry importer. A visual editor
            for it is a planned follow-up; existing entries round-trip unchanged.
          </p>
        </div>
      </section>
    </div>
  );
}

// ─── Preview pane ───────────────────────────────────────────────────

function SBPreview({
  kind,
  formData,
  sourceAbbrev,
  sourceName,
}: {
  kind: SpeciesBackgroundKind;
  formData: SBFormData;
  sourceAbbrev: string;
  sourceName: string;
}) {
  const descHtml = formData.description ? bbcodeToHtml(formData.description) : '';
  const facts: Array<[string, string]> = [];
  if (kind === 'species') {
    const ct = CREATURE_TYPES.find(([v]) => v === formData.creatureType.value)?.[1] || formData.creatureType.value;
    facts.push(['Type', formData.creatureType.subtype ? `${ct} (${formData.creatureType.subtype})` : ct]);
    const speeds = MOVEMENT_SPEEDS
      .filter(([k]) => (formData.movement as any)[k] != null)
      .map(([k, l]) => `${l} ${(formData.movement as any)[k]} ${formData.movement.units}`);
    if (formData.movement.hover) speeds.push('hover');
    if (speeds.length) facts.push(['Speed', speeds.join(', ')]);
    const senses = SENSE_RANGES
      .filter(([k]) => (formData.senses as any)[k] != null)
      .map(([k, l]) => `${l} ${(formData.senses as any)[k]} ${formData.senses.units}`);
    if (formData.senses.special) senses.push(formData.senses.special);
    if (senses.length) facts.push(['Senses', senses.join(', ')]);
  } else {
    if (formData.wealth) facts.push(['Wealth', formData.wealth]);
    if (formData.startingEquipment.length) facts.push(['Equipment', `${formData.startingEquipment.length} entries`]);
  }
  facts.push(['Advancements', String(formData.advancements.length)]);
  if (formData.tagIds.length) facts.push(['Tags', String(formData.tagIds.length)]);

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-start gap-3">
        {formData.imageUrl ? (
          <img src={formData.imageUrl} alt="" className="h-14 w-14 rounded border border-gold/20 object-cover" />
        ) : null}
        <div className="min-w-0">
          <h2 className="font-serif text-xl font-bold text-ink leading-tight break-words">
            {formData.name || `Untitled ${kind === 'species' ? 'Species' : 'Background'}`}
          </h2>
          <div className="flex items-center gap-2 mt-0.5 text-[11px] text-ink/55">
            {sourceAbbrev ? <span className="font-bold text-gold/80" title={sourceName}>{sourceAbbrev}</span> : null}
            {formData.identifier ? <span className="font-mono">{formData.identifier}</span> : null}
            {formData.page ? <span>· p.{formData.page}</span> : null}
          </div>
        </div>
      </div>

      {facts.length > 0 && (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
          {facts.map(([label, value]) => (
            <React.Fragment key={label}>
              <dt className="font-bold uppercase tracking-widest text-[10px] text-gold/70 pt-0.5">{label}</dt>
              <dd className="text-ink/80">{value}</dd>
            </React.Fragment>
          ))}
        </dl>
      )}

      {descHtml ? (
        <div
          className="prose prose-sm max-w-none text-ink/85 border-t border-gold/10 pt-3"
          // Preview only — content is author-controlled compendium text.
          dangerouslySetInnerHTML={{ __html: descHtml }}
        />
      ) : (
        <p className="text-xs text-ink/40 italic border-t border-gold/10 pt-3">No description yet.</p>
      )}
    </div>
  );
}

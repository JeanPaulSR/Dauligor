import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import FeatImportWorkbench from '../../components/compendium/FeatImportWorkbench';
import { useProposalAccumulator, useProposalContextOptional } from '../../lib/proposalAccumulator';
import { useProposalEntityDrafts } from '../../hooks/useProposalEntityDrafts';
import { useBlockDraftPickerOptions } from '../../hooks/useBlockDraftPickerOptions';
import { actionLabel, applyProposalWrite } from '../../lib/proposalAware';
import { useProposalReview, resolveReviewPayload, ReviewFieldHighlight } from '../../lib/proposalReview';
import { CascadeDependentBanner } from '../../components/proposals/CascadeDependentBanner';
import { TagReplacementPicker } from '../../components/proposals/TagReplacementPicker';
import { useCascadeDependent } from '../../hooks/useCascadeDependent';
import { useProposalPreFlushSave } from '../../hooks/useProposalPreFlushSave';
import { useDraftedEntityIds } from '../../hooks/useDraftedEntityIds';
import { useEditBaseUnlocks } from '../../hooks/useEditBaseUnlocks';
import { Plus, Trash2 } from 'lucide-react';
import FeatDetailPanel from '../../components/compendium/FeatDetailPanel';
import { toast } from 'sonner';
import ActivityEditor from '../../components/compendium/ActivityEditor';
import ActiveEffectEditor from '../../components/compendium/ActiveEffectEditor';
import AdvancementManager, { type Advancement } from '../../components/compendium/AdvancementManager';
import MarkdownEditor from '../../components/MarkdownEditor';
import RequirementsEditor, { RequirementsEditorLookups } from '../../components/compendium/RequirementsEditor';
import ScalingColumnsPanel, { type ScalingOwnerType } from '../../components/compendium/ScalingColumnsPanel';
import { useEditorFormSession } from '../../components/compendium/useEditorFormSession';
import {
  EMPTY_REQUIREMENT_TREE,
  parseRequirementTree,
  serializeRequirementTree,
  formatRequirementText,
  type Requirement,
  type ProficiencyKind,
} from '../../lib/requirements';
import {
  RECOVERY_PERIOD_OPTIONS,
  RECOVERY_TYPE_OPTIONS,
} from '../../components/compendium/activity/constants';
import { reportClientError, OperationType } from '../../lib/firebase';
import { upsertFeat, deleteFeat, fetchFeat, denormalizeCompendiumData } from '../../lib/compendium';
import { rebakeNow } from '../../lib/moduleExport';
import { fetchCollection } from '../../lib/d1';
import { slugify, cn } from '../../lib/utils';
import { matchesSingleAxisFilter, matchesMultiAxisFilter } from '../../lib/spellFilters';
import { useAxisFilters } from '../../hooks/useAxisFilters';
import {
  deriveFeatPropertyFlags,
  FEAT_PROPERTY_LABELS,
  FEAT_PROPERTY_ORDER,
  FEAT_TYPE_LABELS,
  FEAT_TYPE_ORDER,
} from '../../lib/featFilters';
import {
  CompendiumEditorShell,
  type EditorMode,
  type EditorSubTab,
  type TagsSubTab,
  type EditorListColumn,
} from '../../components/compendium/CompendiumEditorShell';
import { SectionFilterPanel, type FilterSection } from '../../components/compendium/SectionFilterPanel';
import { Checkbox } from '../../components/ui/checkbox';
import { ImageUpload } from '../../components/ui/ImageUpload';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import SingleSelectSearch from '../../components/ui/SingleSelectSearch';
// Tag system — matches the SpellsEditor / ItemsEditor pattern. Feats
// reuse the shared `tags` + `tag_groups` tables; the field on the row
// is `tags` (JSON column auto-parsed by d1.ts) but editors carry it
// as `tagIds` for cross-entity consistency, and the upsertFeat path
// already remaps `tagIds → tags` on save (see compendium.ts).
import TagPicker from '../../components/compendium/TagPicker';
import { normalizeTagRow } from '../../lib/tagHierarchy';

// ─── Constants ──────────────────────────────────────────────────────────

const FEAT_TYPE_VALUES: [string, string][] = [
  ['feat', 'Feat'],
  ['class', 'Class Feature'],
  ['subclass', 'Subclass Feature'],
  ['race', 'Racial Feature'],
  ['background', 'Background Feature'],
  ['monster', 'Monster Feature'],
];

const FEAT_SUBTYPE_OPTIONS_BY_VALUE: Record<string, [string, string][]> = {
  feat: [
    ['', '(None)'],
    ['general', 'General'],
    ['origin', 'Origin'],
    ['fightingStyle', 'Fighting Style'],
    ['epicBoon', 'Epic Boon'],
  ],
  class: [],
  subclass: [],
  race: [],
  background: [],
  monster: [],
};

const SOURCE_TYPES: [string, string][] = [
  ['feat', 'Feat'],
  ['classFeature', 'Class Feature'],
  ['subclassFeature', 'Subclass Feature'],
];

// Advancement-type axis vocabulary. Mirrors `AdvancementManager`'s
// supported types — used by the filter modal to surface "feats that
// grant an ItemGrant" / "feats with a ScaleValue" etc. Slug values
// match the canonical `Advancement.type` strings dnd5e ships.
const ADVANCEMENT_TYPE_VALUES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'Trait',                     label: 'Trait' },
  { value: 'ItemGrant',                 label: 'Item Grant' },
  { value: 'ItemChoice',                label: 'Item Choice' },
  { value: 'AbilityScoreImprovement',   label: 'Ability Score Improvement' },
  { value: 'HitPoints',                 label: 'Hit Points' },
  { value: 'ScaleValue',                label: 'Scale Value' },
  { value: 'Size',                      label: 'Size' },
];

// Axis keys this page consumes. Drives `useAxisFilters`'s
// `activeFilterCount` summation so stale keys don't inflate the
// modal-button badge.
const FEAT_AXIS_KEYS = [
  'featType', 'source', 'sourceType', 'property', 'advancementType',
] as const;

// No-op tag-axis handlers. Feats don't surface tag-kind axes today
// (their tag picker lives on the Tags super-tab as a list, not a
// filter); SectionFilterPanel still requires the prop pair.
const NOOP_CYCLE_TAG = () => { /* no tag axes on feats */ };
const NOOP_SET_TAG_STATES: React.Dispatch<React.SetStateAction<Record<string, number>>> = () => { /* no tag axes on feats */ };
const EMPTY_TAG_STATES: Record<string, number> = {};

type UsesRecoveryRule = {
  period: string;
  type: string;
  formula?: string;
};

// ─── Form shape ─────────────────────────────────────────────────────────

type FeatFormData = {
  id?: string;
  name: string;
  identifier: string;
  sourceId: string;
  imageUrl: string;
  description: string;
  featType: string;
  featSubtype: string;
  sourceType: string;
  // Admin-managed feat-category taxonomy. Empty string means
  // "no category assigned"; the public detail view simply hides
  // the category line in that case.
  featCategoryId: string;
  // Three-layer prerequisite display. Resolution priority in the
  // FeatList compact column: `requirementsShortText` →
  // `requirements` → formatted `requirementsTree`. The detail panel
  // skips the short layer and uses `requirements` → tree.
  requirements: string;
  requirementsShortText: string;
  repeatable: boolean;
  uses: {
    max: string;
    spent: number;
    recovery: UsesRecoveryRule[];
  };
  activities: any[];
  effects: any[];
  // Foundry-shape `system.advancement` carried as a flat array. The
  // AdvancementManager (the same one ClassEditor / SubclassEditor
  // mount) owns the editing UX; runtime resolution lives in
  // CharacterBuilder's feat walker. Feat advancements default to
  // `level: 0` (= "always on when feat is owned"); a positive level
  // gates against the granting class's level (or character total
  // level for standalone feats) per the locked level-resolution rule.
  advancements: Advancement[];
  // Tag system — same shape as SpellsEditor / ItemsEditor.
  // `upsertFeat` remaps `tagIds → tags` on save; the load path reads
  // the `tags` JSON column back into `tagIds`.
  tagIds: string[];
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
  featType: 'feat',
  featSubtype: 'general',
  sourceType: 'feat',
  featCategoryId: '',
  requirements: '',
  requirementsShortText: '',
  repeatable: false,
  uses: { max: '', spent: 0, recovery: [] },
  activities: [],
  effects: [],
  advancements: [],
  tagIds: [],
  requirementsTree: EMPTY_REQUIREMENT_TREE,
};

function normalizeLegacyFeatType(legacyType: string | undefined | null): { featType: string; featSubtype: string } {
  const t = String(legacyType ?? '').trim();
  if (t === 'general' || t === 'origin' || t === 'fightingStyle' || t === 'epicBoon') {
    return { featType: 'feat', featSubtype: t };
  }
  if (t === 'classFeature') return { featType: 'class', featSubtype: '' };
  if (!t) return { featType: 'feat', featSubtype: '' };
  return { featType: t, featSubtype: '' };
}

function makeInitialFeatForm(sources: any[] = []): FeatFormData {
  return {
    ...FEAT_DEFAULTS,
    sourceId: sources[0]?.id || '',
  } as FeatFormData;
}

// ─── Page ───────────────────────────────────────────────────────────────

/**
 * `scopeFeatType` (optional) — when set, the editor behaves as a
 * scoped editor for ONLY rows whose `feat_type` matches this value.
 *  - Filters the list to that type
 *  - Defaults new entries to that type
 *  - Routes the back-button to the matching public list
 *  - Forwards a matching `parentContext` to AdvancementManager
 *
 * Default (undefined) preserves the previous all-types editor surface.
 * The RaceEditor / BackgroundEditor wrappers thread this prop through.
 */
type FeatsEditorProps = {
  userProfile: any;
  scopeFeatType?: 'feat' | 'race' | 'background';
};

export default function FeatsEditor({ userProfile, scopeFeatType }: FeatsEditorProps) {
  const location = useLocation();
  const isAdmin = userProfile?.role === 'admin';
  const isContentCreator = !!userProfile?.permissions &&
    Object.prototype.hasOwnProperty.call(userProfile.permissions, 'content-creator');
  const canManage = isAdmin || isContentCreator;
  const isProposalRoute = location.pathname.startsWith('/proposals/edit/');
  const scopedBackPath = scopeFeatType === 'race'
    ? '/compendium/races'
    : scopeFeatType === 'background'
      ? '/compendium/backgrounds'
      : '/compendium/feats';
  const scopedBackLabel = scopeFeatType === 'race'
    ? 'Back To Races'
    : scopeFeatType === 'background'
      ? 'Back To Backgrounds'
      : 'Back To Feats';
  const backPath = isProposalRoute ? '/my-proposals' : scopedBackPath;
  const backLabel = isProposalRoute ? 'Back to My Proposals' : scopedBackLabel;

  // ── Proposal-mode plumbing ────────────────────────────────────
  const featWriter = useProposalAccumulator('feat', userProfile);
  const proposalContext = useProposalContextOptional();
  const isProposalMode = featWriter.mode === 'proposal' || featWriter.mode === 'block';
  // Block-draft picker overlays (Part C L1). Drafts authored in the active block
  // (scaling columns, option groups, feats this feat's advancements reference)
  // have no live row yet; surface them in the advancement picker (display-only,
  // "(in this block)" suffix). Empty outside a <ProposalEditorWrapper>.
  const scalingColumnDraftOptions = useBlockDraftPickerOptions('scaling_column');
  const optionGroupDraftOptions = useBlockDraftPickerOptions('unique_option_group');
  const featDraftOptions = useBlockDraftPickerOptions('feat');
  const optionItemDraftOptions = useBlockDraftPickerOptions('unique_option_item');
  // Also merged into the RequirementsEditor lookups (Part C L2) so a feat's
  // prerequisites can reference a same-block draft class / subclass / spell-rule.
  const classDraftOptions = useBlockDraftPickerOptions('class');
  const subclassDraftOptions = useBlockDraftPickerOptions('subclass');
  const spellRuleDraftOptions = useBlockDraftPickerOptions('spell_rule');
  const focusMode = proposalContext?.focusMode ?? 'drafts';
  const focusModeEnabled = proposalContext?.focusModeEnabled ?? false;
  const reviewMode = useProposalReview();
  const reviewPayload = resolveReviewPayload(reviewMode, 'feat', null);
  const isReviewingFeat = !!reviewMode && !!reviewPayload && reviewMode.entityType === 'feat';

  // ── Entries + form state ──────────────────────────────────────
  const [entries, setEntries] = useState<any[]>([]);
  const [featDetailsById, setFeatDetailsById] = useState<Record<string, any>>({});
  const [sources, setSources] = useState<any[]>([]);
  // Scaling columns owned by the currently-edited feat. Class
  // features (feat_type='class'/'subclass') intentionally don't get
  // their own columns — they inherit from the parent class. For
  // everything else (feat/race/background/monster) the feat owns
  // its own progression table, queryable as
  // `parent_id = <feat.id> AND parent_type = 'feat'|'race'|'background'`.
  const [scalingColumns, setScalingColumns] = useState<any[]>([]);
  const [scalingLoadTick, setScalingLoadTick] = useState(0);
  // Admin-managed feat-category taxonomy — drives the per-feat
  // Feat Category picker below. Loaded once at mount; the editor
  // doesn't surface a "create category" affordance (admins author
  // categories at /admin/proficiencies → Feat Categories).
  const [featCategories, setFeatCategories] = useState<Array<{ id: string; name: string; sortOrder?: number; order?: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  // URL-backed editingId — survives navigation away/back (e.g.
  // when the user clicks "+ Add" on a scaling column, edits it in
  // ScalingEditor, and hits Save → navigate(-1) returns here with
  // ?editingId=X intact). Pulled from the URL on mount; pushed
  // back to the URL whenever the user picks a different row.
  // Mirrors the URL-deep-link pattern FeatList uses for #hash so
  // every editor surface is reload-safe.
  const [urlSearchParams, setUrlSearchParams] = useSearchParams();
  const initialEditingId = urlSearchParams.get('editingId');
  const [editingId, setEditingId] = useState<string | null>(initialEditingId);
  const [formData, setFormData] = useState<FeatFormData>(makeInitialFeatForm());
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  // FeatDetailPanel (rendered as the preview pane) caches the loaded
  // feat by id. Incrementing this counter after a successful save
  // flips the `cacheBustKey` prop on the panel, evicting the stale
  // cached entry and forcing a refetch — so the preview reflects the
  // just-persisted shape without the user having to refresh the page.
  const [previewBustKey, setPreviewBustKey] = useState(0);

  // Outgoing sync: when editingId changes from any code path
  // (startEditing, save promotions, reviewMode hydration, the
  // delete handler), reflect it in the URL. `replace: true` so
  // row-by-row browsing doesn't bury the back stack the way a
  // pushState chain would. Skipping the no-op case avoids a
  // redundant history entry on mount.
  useEffect(() => {
    const current = urlSearchParams.get('editingId');
    if (editingId && editingId !== current) {
      setUrlSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('editingId', editingId);
          return next;
        },
        { replace: true },
      );
    } else if (!editingId && current) {
      setUrlSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete('editingId');
          return next;
        },
        { replace: true },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId]);

  // Inbound sync: when the URL's editingId changes from outside —
  // browser back/forward, address-bar edits, or another component
  // calling setSearchParams — pull it back into state. The
  // matching-value guard prevents a feedback loop with the
  // outgoing effect (both no-op when state and URL agree).
  useEffect(() => {
    const urlEditingId = urlSearchParams.get('editingId');
    if ((urlEditingId || null) !== editingId) {
      setEditingId(urlEditingId || null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlSearchParams]);

  // ── Filter state ──────────────────────────────────────────────
  // useAxisFilters bundles every cycler the SectionFilterPanel needs.
  // Items + spells use the same hook — keeping the per-editor wiring
  // consistent means changes to the filter UX land in one spot.
  const { axisFilters, cyclers, activeFilterCount, resetAll: resetAxisFilters } =
    useAxisFilters(FEAT_AXIS_KEYS);

  // Cascade dependent state.
  const cascadeDep = useCascadeDependent('feat', editingId);
  const [replaceTagPickerOpen, setReplaceTagPickerOpen] = useState(false);

  // Refs.
  const editingIdRef = useRef<string | null>(null);
  useEffect(() => { editingIdRef.current = editingId; }, [editingId]);
  const formDataRef = useRef<FeatFormData | null>(null);
  const lastLoadedFormRef = useRef<string>('');

  // Editor-body session key (see useEditorFormSession). Keyed on
  // this token instead of `editingId` so the MarkdownEditor / TipTap
  // body doesn't remount when a save promotes editingId from
  // `null → newId` — that remount was the "save jumps the editor
  // to the top" behavior we got bug reports about. The session
  // still bumps on explicit row switches / resets.
  const { sessionKey, markSaving } = useEditorFormSession(editingId);

  // RequirementsEditor lookups.
  const [classes, setClasses] = useState<any[]>([]);
  const [subclasses, setSubclasses] = useState<any[]>([]);
  const [spellRules, setSpellRules] = useState<any[]>([]);
  // Spells + features — wire the `spell` / `feature` requirement leaf
  // pickers in the RequirementsEditor (the leaf types existed but their
  // lookups were never passed). Slim {id,name} loads — the picker is searchable.
  const [spells, setSpells] = useState<any[]>([]);
  const [features, setFeatures] = useState<any[]>([]);
  const [allOptionGroups, setAllOptionGroups] = useState<Array<{
    id: string;
    name: string;
    items: Array<{ id: string; name: string }>;
  }>>([]);
  // Flat option-item list (with groupId) for AdvancementManager — it resolves a
  // group's items from `availableOptionItems.filter(i => i.groupId === groupId)`,
  // so a feat advancement that grants/chooses from an option group needs these.
  const [allOptionItems, setAllOptionItems] = useState<any[]>([]);
  const [proficiencyPools, setProficiencyPools] = useState<
    Partial<Record<ProficiencyKind, Array<{ id: string; name: string; hint?: string }>>>
  >({});

  // Tags + tag groups for the Tags sub-tab. Loaded once on mount
  // alongside the other catalogs. Shape mirrors what SpellsEditor /
  // ItemsEditor pass to TagPicker: tags come through `normalizeTagRow`
  // (which renames `parent_tag_id` → `parentTagId`, etc.), groups stay
  // as `{ id, name }`.
  const [tags, setTags] = useState<Array<{
    id: string;
    name: string;
    groupId: string | null;
    parentTagId: string | null;
  }>>([]);
  const [tagGroups, setTagGroups] = useState<Array<{ id: string; name: string }>>([]);

  // ── Initial load ──────────────────────────────────────────────
  useEffect(() => {
    if (!canManage) return;
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
          featCategoryRows,
          tagRows,
          tagGroupRows,
          spellRows,
          featureRows,
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
          // Sort by `"order"` (the admin shell stores display priority
          // in this column for every taxonomy) then by name to break
          // ties. ProficiencyEntityShell already produces this exact
          // ordering on its list page.
          fetchCollection<any>('featCategories', { orderBy: '"order", name ASC' }),
          // Tag system — same fetch pattern SpellsEditor uses.
          // `normalizeTagRow` runs on each row below to project the
          // shape TagPicker expects. The tagGroups fetch is scoped by
          // `classifications LIKE '%feat%'` so only feat-relevant
          // groups surface in the picker (matches SpellsEditor's
          // `'%spell%'` scoping). TagPicker filters tags by groupId
          // at render time, so unscoped tags drop out naturally.
          fetchCollection<any>('tags', { orderBy: 'name ASC' }),
          fetchCollection<any>('tagGroups', { where: "classifications LIKE '%feat%'" }),
          // Spells + features for the `spell` / `feature` requirement leaf pickers.
          fetchCollection<any>('spells', { select: 'id, name', orderBy: 'name ASC' }),
          fetchCollection<any>('features', { select: 'id, name', orderBy: 'name ASC' }),
        ]);
        if (cancelled) return;

        const mapped = featRows.map((row: any) => {
          const normalized = normalizeLegacyFeatType(row.feat_type);
          // Pre-compute the boolean property flags (hasUses / has
          // Activities / hasEffects / hasPrereqs / repeatable) once at
          // load time — the filter modal reads these per entry. Same
          // helper FeatList uses for its public-side chips.
          const propertyFlags = deriveFeatPropertyFlags(row);
          // Aggregate the set of advancement.type slugs the feat
          // declares — drives the "Advancements" multi-axis filter
          // ("feats that grant an ItemGrant" etc.). Tolerates the
          // advancements column being either a parsed array, a JSON
          // string, or absent.
          const advRaw = row.advancements;
          const advancements: any[] = Array.isArray(advRaw)
            ? advRaw
            : typeof advRaw === 'string'
              ? (() => { try { return JSON.parse(advRaw); } catch { return []; } })()
              : [];
          const advancementTypeSet = new Set<string>();
          for (const a of advancements) {
            const t = String(a?.type ?? '').trim();
            if (t) advancementTypeSet.add(t);
          }
          return {
            ...row,
            sourceId: row.source_id,
            imageUrl: row.image_url,
            featType: normalized.featType,
            featSubtype: row.feat_subtype || normalized.featSubtype,
            sourceType: row.source_type,
            featCategoryId: row.feat_category_id || '',
            requirementsTree: parseRequirementTree(row.requirements_tree ?? row.requirementsTree),
            tagIds: Array.isArray(row.tags) ? row.tags : [],
            // Filter-axis precomputes:
            ...propertyFlags,
            advancementTypeSet,
          };
        });
        setEntries(mapped);
        setSources(sourceRows);
        // d1.ts auto-converts snake_case columns to camelCase for known
        // columns; `sort_order` may surface as `sortOrder` while the
        // ProficiencyEntityShell's `"order"` quoting writes to a
        // literal `order` column. Normalize here so the picker sort
        // doesn't need to care.
        setFeatCategories(
          (featCategoryRows || []).map((r: any) => ({
            id: String(r.id),
            name: String(r.name || ''),
            sortOrder: Number(r.sort_order ?? r.sortOrder ?? r.order ?? 0) || 0,
          }))
        );
        setClasses(classRows);
        setSubclasses(subclassRows);
        setSpellRules(spellRuleRows);
        setSpells(spellRows);
        setFeatures(featureRows);

        const groupsWithItems = optionGroupRows.map((g: any) => ({
          id: g.id,
          name: g.name,
          items: optionItemRows
            .filter((it: any) => (it.group_id || it.groupId) === g.id)
            .map((it: any) => ({ id: it.id, name: it.name })),
        }));
        setAllOptionGroups(groupsWithItems);
        // denormalize → camelCase so items carry `groupId` (+ levelPrerequisite),
        // the shape AdvancementManager's group→items filter expects.
        setAllOptionItems(optionItemRows.map((i: any) => denormalizeCompendiumData(i)));

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
        // Tags + tagGroups for the TagPicker. `normalizeTagRow` handles
        // the snake_case → camelCase rename + the `parent_tag_id` →
        // `parentTagId` shape the picker expects (matches the pattern
        // in ItemsEditor + SpellsEditor).
        setTags(tagRows.map((row: any) => {
          const normalized = normalizeTagRow(row);
          return {
            id: String(normalized.id),
            name: String(normalized.name || ''),
            groupId: normalized.groupId ?? null,
            parentTagId: normalized.parentTagId ?? null,
          };
        }));
        setTagGroups(tagGroupRows.map((g: any) => ({
          id: String(g.id),
          name: String(g.name || 'Tags'),
        })));

        setLoading(false);
      } catch (err) {
        console.error('Error loading feats:', err);
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadAll();
    return () => {
      cancelled = true;
    };
  }, [canManage]);

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

  const sourceAbbrevById = useMemo(
    () =>
      Object.fromEntries(
        sources.map((source) => [
          source.id,
          source.abbreviation || source.shortName || source.name || source.id,
        ]),
      ),
    [sources],
  );

  // Drafted ids + entities for proposal-mode list merge.
  const draftedFeatIds = useDraftedEntityIds('feat');
  const draftedFeatEntities = useProposalEntityDrafts('feat');

  // Edit-base unlocks + isReadOnly.
  const {
    unlockedBaseIds,
    unlock: unlockBaseFeat,
    isReadOnly,
  } = useEditBaseUnlocks({
    focusModeEnabled,
    editingId,
    draftedIds: draftedFeatIds,
    proposalContext,
  });

  const displayEntries = useMemo(() => {
    if (
      draftedFeatEntities.byId.size === 0 &&
      draftedFeatEntities.deletedIds.size === 0
    ) {
      return entries;
    }
    const merged = entries.map((e) => {
      if (draftedFeatEntities.deletedIds.has(String(e.id))) {
        return { ...e, __pendingDelete: true };
      }
      const overlay = draftedFeatEntities.byId.get(String(e.id));
      if (!overlay) return e;
      return { ...e, ...denormalizeCompendiumData(overlay) };
    });
    for (const [draftId, payload] of draftedFeatEntities.byId.entries()) {
      if (merged.some((e) => String(e.id) === draftId)) continue;
      merged.push({ ...denormalizeCompendiumData(payload), id: draftId });
    }
    return merged;
  }, [entries, draftedFeatEntities]);

  const filteredEntries = useMemo(() => {
    const lowered = search.trim().toLowerCase();
    return displayEntries.filter((entry) => {
      // Scope filter — applied before any other check so the RaceEditor
      // / BackgroundEditor surfaces never show entries of the wrong
      // type. The feats table is the shared store; the editor wrappers
      // present a curated view.
      if (scopeFeatType) {
        const entryType = String(entry.featType || '').toLowerCase();
        if (entryType !== scopeFeatType) return false;
      }
      if (lowered) {
        const sourceLabel = String(sourceNameById[entry.sourceId] || '').toLowerCase();
        const matches =
          String(entry.name || '').toLowerCase().includes(lowered)
          || String(entry.identifier || '').toLowerCase().includes(lowered)
          || String(entry.featType || '').toLowerCase().includes(lowered)
          || String(entry.featSubtype || '').toLowerCase().includes(lowered)
          || sourceLabel.includes(lowered);
        if (!matches) return false;
      }
      if (focusModeEnabled && focusMode === 'drafts') {
        const id = String(entry.id);
        const isMyWork = draftedFeatIds.has(id) || unlockedBaseIds.has(id);
        if (!isMyWork) return false;
      }
      // ── Axis filters ─────────────────────────────────────────
      // Each axis is independently ANDed; multi-axis filters
      // (property / advancementType) honor per-axis combineMode +
      // exclusionMode via matchesMultiAxisFilter.
      if (!matchesSingleAxisFilter(String(entry.featType ?? ''), axisFilters.featType)) return false;
      if (!matchesSingleAxisFilter(String(entry.sourceId ?? ''), axisFilters.source)) return false;
      if (!matchesSingleAxisFilter(String(entry.sourceType ?? ''), axisFilters.sourceType)) return false;
      const propsHave = new Set<string>();
      for (const p of FEAT_PROPERTY_ORDER) {
        if ((entry as any)[p]) propsHave.add(p);
      }
      if (!matchesMultiAxisFilter(propsHave, axisFilters.property)) return false;
      if (!matchesMultiAxisFilter(
        (entry.advancementTypeSet as Set<string>) || new Set<string>(),
        axisFilters.advancementType,
      )) return false;
      return true;
    });
  }, [displayEntries, search, sourceNameById, focusModeEnabled, focusMode, draftedFeatIds, unlockedBaseIds, scopeFeatType, axisFilters]);

  const requirementsLookups: RequirementsEditorLookups = useMemo(() => ({
    classes: [...classes.map((c: any) => ({ id: c.id, name: c.name })), ...classDraftOptions],
    subclasses: [...subclasses.map((s: any) => ({ id: s.id, name: s.name })), ...subclassDraftOptions],
    spellRules: [...spellRules.map((r: any) => ({ id: r.id, name: r.name })), ...spellRuleDraftOptions],
    spells: spells.map((s: any) => ({ id: s.id, name: s.name })),
    features: features.map((f: any) => ({ id: f.id, name: f.name })),
    optionGroups: [
      ...allOptionGroups.map((g) => ({ id: g.id, name: g.name, items: g.items })),
      ...optionGroupDraftOptions.map((d) => ({ id: d.id, name: d.name, items: null })),
    ],
    proficiencies: proficiencyPools,
  }), [classes, subclasses, spellRules, spells, features, allOptionGroups, proficiencyPools, classDraftOptions, subclassDraftOptions, spellRuleDraftOptions, optionGroupDraftOptions]);

  const requirementsTextLookup = useMemo(() => {
    // Proficiency pools land keyed by their Foundry identifier
    // (skill = `ath`, weapon = `longsword`, language = `elvish`,
    // etc.) — the exact key shape the formatter expects. Without
    // these maps the editor's detail preview would render slugs
    // ("ath Proficiency") while the public FeatDetailPanel resolves
    // them to display names ("Athletics Proficiency") — drift.
    // Reading from proficiencyPools (the source the leaf picker
    // already uses) keeps the two surfaces consistent.
    const profMap = (cat: 'weapon' | 'armor' | 'tool' | 'skill' | 'language') =>
      Object.fromEntries((proficiencyPools[cat] ?? []).map((p) => [p.id, p.name]));
    return {
      classNameById: Object.fromEntries(classes.map((c: any) => [c.id, c.name])),
      subclassNameById: Object.fromEntries(subclasses.map((s: any) => [s.id, s.name])),
      spellRuleNameById: Object.fromEntries(spellRules.map((r: any) => [r.id, r.name])),
      spellNameById: Object.fromEntries(spells.map((s: any) => [s.id, s.name])),
      featureNameById: Object.fromEntries(features.map((f: any) => [f.id, f.name])),
      optionItemNameById: Object.fromEntries(
        allOptionGroups.flatMap((g) => g.items.map((it) => [it.id, it.name] as const)),
      ),
      skillNameById: profMap('skill'),
      weaponNameById: profMap('weapon'),
      armorNameById: profMap('armor'),
      toolNameById: profMap('tool'),
      languageNameById: profMap('language'),
    };
  }, [classes, subclasses, spellRules, spells, features, allOptionGroups, proficiencyPools]);

  const resetForm = () => {
    const initial = makeInitialFeatForm(sources);
    // Scoped editors (RaceEditor / BackgroundEditor) seed `featType`
    // to their scope so a fresh entry from the New button lands in the
    // correct type without the user having to remember to flip the
    // dropdown. Subtype clears because the scoped types have no enum
    // subtypes today (feat is the only one with origin/general/etc.).
    if (scopeFeatType) {
      initial.featType = scopeFeatType;
      initial.featSubtype = '';
    }
    setEditingId(null);
    setFormData(initial);
    lastLoadedFormRef.current = JSON.stringify(initial);
  };

  // Review mode hydration.
  useEffect(() => {
    if (!isReviewingFeat || !reviewMode?.entityId || !reviewPayload) return;
    setFeatDetailsById((current) =>
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
  }, [isReviewingFeat, reviewMode?.entityId, reviewPayload, editingId]);

  // Form hydrate.
  useEffect(() => {
    if (!editingId) return;
    const draftedOverlay = draftedFeatEntities.byId.get(editingId);
    if (draftedOverlay && !featDetailsById[editingId]) {
      setFeatDetailsById((current) => ({
        ...current,
        [editingId]: denormalizeCompendiumData(draftedOverlay),
      }));
    }
    const cached = featDetailsById[editingId];
    if (cached) {
      const defaults = makeInitialFeatForm(sources);
      const normalized = normalizeLegacyFeatType(cached.featType || cached.feat_type);
      const recoveryRaw = cached.uses?.recovery
        ?? cached.usesRecovery
        ?? cached.uses_recovery
        ?? [];
      const loaded: FeatFormData = {
        ...defaults,
        ...cached,
        id: cached.id,
        sourceId: cached.sourceId || cached.source_id || sources[0]?.id || '',
        imageUrl: cached.imageUrl || cached.image_url || '',
        featType: normalized.featType,
        featSubtype: cached.featSubtype || cached.feat_subtype || normalized.featSubtype || '',
        sourceType: cached.sourceType || cached.source_type || 'feat',
        featCategoryId: cached.featCategoryId || cached.feat_category_id || '',
        requirements: cached.requirements || '',
        requirementsShortText: cached.requirementsShortText || cached.requirements_short_text || '',
        repeatable: !!cached.repeatable,
        uses: {
          max: cached.uses?.max ?? cached.usesMax ?? cached.uses_max ?? '',
          spent: Number(cached.uses?.spent ?? cached.usesSpent ?? cached.uses_spent ?? 0) || 0,
          recovery: Array.isArray(recoveryRaw)
            ? recoveryRaw
            : typeof recoveryRaw === 'string'
              ? (() => { try { return JSON.parse(recoveryRaw); } catch { return []; } })()
              : [],
        },
        activities: Array.isArray(cached.automation?.activities)
          ? cached.automation.activities
          : Array.isArray(cached.activities)
            ? cached.activities
            : [],
        effects: Array.isArray(cached.automation?.effects)
          ? cached.automation.effects
          : Array.isArray(cached.effects)
            ? cached.effects
            : [],
        // Legacy rows pre-migration 20260525-1900 have no `advancements`
        // column at all; the load path coalesces NULL / undefined / a
        // raw JSON string into an array. `denormalizeCompendiumData`
        // already JSON.parses the column (it's in the `jsonColumns`
        // list), so the array branch is the steady-state shape.
        advancements: Array.isArray(cached.advancements)
          ? (cached.advancements as Advancement[])
          : typeof cached.advancements === 'string'
            ? (() => { try { return JSON.parse(cached.advancements) as Advancement[]; } catch { return []; } })()
            : [],
        requirementsTree: parseRequirementTree(
          cached.requirementsTree ?? cached.requirements_tree,
        ),
      };
      setFormData(loaded);
      lastLoadedFormRef.current = JSON.stringify(loaded);
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
  }, [editingId, sources, featDetailsById, draftedFeatEntities]);

  // Scaling columns owned by the currently-edited feat. Class
  // features (feat_type='class'/'subclass') inherit from the
  // parent class, so they don't load their own columns. The
  // `scaling_columns` table is already polymorphic via
  // (parent_id, parent_type) — no schema migration was needed
  // to support feats / races / backgrounds; we just write new
  // parent_type values.
  useEffect(() => {
    if (!editingId) {
      setScalingColumns([]);
      return;
    }
    const featTypeForScaling = String(formData.featType ?? '').toLowerCase();
    if (featTypeForScaling === 'class' || featTypeForScaling === 'subclass') {
      setScalingColumns([]);
      return;
    }
    // 'feat' / 'race' / 'background' map 1:1 to their parent_type
    // string. 'monster' uses 'feat' since monsters don't have
    // their own scaling-owner type today (they're authored as
    // feats with feat_type='monster').
    const parentType: ScalingOwnerType =
      featTypeForScaling === 'race' || featTypeForScaling === 'background'
        ? (featTypeForScaling as ScalingOwnerType)
        : 'feat';
    let cancelled = false;
    (async () => {
      try {
        const rows = await fetchCollection<any>('scaling_columns', {
          where: 'parent_id = ? AND parent_type = ?',
          params: [editingId, parentType],
          orderBy: 'name ASC',
        });
        if (cancelled) return;
        setScalingColumns(rows.map((r: any) => denormalizeCompendiumData(r)));
      } catch (err) {
        console.error('[FeatsEditor] scaling_columns load failed:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [editingId, formData.featType, scalingLoadTick]);

  // ── Switch handler ────────────────────────────────────────────
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
          console.error('[FeatsEditor] auto-stage failed:', err);
          toast.error('Could not stage previous feat — switching anyway.');
        }
      }
    }
    setEditingId(id);
  };

  const refreshEntries = async () => {
    try {
      const rows = await fetchCollection<any>('feats', { orderBy: 'name ASC' });
      const mapped = rows.map((row: any) => {
        const normalized = normalizeLegacyFeatType(row.feat_type);
        return {
          ...row,
          sourceId: row.source_id,
          imageUrl: row.image_url,
          featType: normalized.featType,
          featSubtype: row.feat_subtype || normalized.featSubtype,
          sourceType: row.source_type,
          requirementsTree: parseRequirementTree(row.requirements_tree ?? row.requirementsTree),
          tagIds: Array.isArray(row.tags) ? row.tags : [],
        };
      });
      setEntries(mapped);
      setFeatDetailsById({});
    } catch (err) {
      console.error('Error refreshing feats:', err);
    }
  };

  const handleSave = async (e?: React.FormEvent, opts: { silent?: boolean } = {}) => {
    if (e) e.preventDefault();
    if (!formData.name.trim()) {
      if (!opts.silent) toast.error('Feat name is required');
      return;
    }
    if (!formData.sourceId) {
      if (!opts.silent) toast.error('Source is required');
      return;
    }

    if (!opts.silent) setSaving(true);
    try {
      const cleanedRecovery = (formData.uses.recovery || []).filter(
        (r) => r.period || r.type || (r.formula && r.formula.trim()),
      );

      const payload: Record<string, any> = {
        name: formData.name,
        identifier: formData.identifier.trim() || slugify(formData.name),
        source_id: formData.sourceId,
        image_url: formData.imageUrl || null,
        description: formData.description || '',
        feat_type: formData.featType || 'feat',
        feat_subtype: formData.featSubtype || null,
        source_type: formData.sourceType || 'feat',
        // Empty string → null so D1's FK constraint accepts the row
        // ("no category" === FK is NULL). The picker treats "" as the
        // none option.
        feat_category_id: formData.featCategoryId || null,
        requirements: formData.requirements || null,
        requirements_short_text: formData.requirementsShortText || null,
        repeatable: formData.repeatable ? 1 : 0,
        uses_max: formData.uses.max || null,
        uses_spent: Number(formData.uses.spent) || 0,
        uses_recovery: cleanedRecovery,
        activities: Array.isArray(formData.activities) ? formData.activities : [],
        effects: Array.isArray(formData.effects) ? formData.effects : [],
        // `advancements` lands in the feats.advancements TEXT column —
        // `d1.ts:upsertDocument` JSON-stringifies the array on the way
        // in (the column is in the `jsonFields` autolist), and
        // `denormalizeCompendiumData` parses it back to an array on read.
        advancements: Array.isArray(formData.advancements) ? formData.advancements : [],
        requirements_tree: serializeRequirementTree(formData.requirementsTree),
        updated_at: new Date().toISOString(),
      };

      Object.keys(payload).forEach((key) => {
        if (payload[key] === undefined) delete payload[key];
      });

      const entryIdAtStart = editingId;
      const wasCreate = !entryIdAtStart;
      const entryId = entryIdAtStart || crypto.randomUUID();

      if (isProposalMode) {
        const { updated_at: _droppedUpdatedAt, ...proposalPayload } = payload;
        await applyProposalWrite(featWriter, proposalPayload, {
          id: entryId,
          isCreate: wasCreate,
          silent: opts.silent,
          submitNow: proposalContext?.submitNow,
        });
        lastLoadedFormRef.current = JSON.stringify(formDataRef.current ?? formData);
        if (wasCreate && !opts.silent && editingIdRef.current === entryIdAtStart) {
          // Same scroll-preservation as the direct path below — without
          // markSaving(), the editingId promotion null → entryId bumps
          // sessionKey and remounts the MarkdownEditor, scrolling back
          // to the top and wiping undo history. The proposal save path
          // needs the same protection.
          markSaving();
          setEditingId(entryId);
        }
      } else {
        await upsertFeat(entryId, {
          ...payload,
          created_at: formData.createdAt || new Date().toISOString(),
        });
        if (!opts.silent) toast.success(`Feat ${entryIdAtStart ? 'updated' : 'created'}`);
        await refreshEntries();
        // Bump the preview pane's cache-bust signal so FeatDetailPanel
        // refetches the just-persisted feat instead of serving its
        // stale cached entry. Without this the preview shows the
        // pre-save shape until the user reloads the page.
        setPreviewBustKey((n) => n + 1);
        // Rebake the top-level source catalog NOW so the Foundry
        // importer's wizard sees the updated `counts.feats` +
        // `supportedImportTypes` immediately. Fire-and-forget — a
        // failure here doesn't roll back the save.
        //
        // We use `rebakeNow` rather than the debounced `queueRebake`
        // because the catalog is a single cheap document (one query +
        // one R2 write) and authors expect their tag/feat-count
        // changes to land in Foundry the moment they save. The
        // debounced queue path is more appropriate for expensive
        // multi-bundle rebakes (classes/subclasses fan out to many
        // R2 keys); feats only touch the one catalog.
        //
        // Backgrounds + races share this editor (via `scopeFeatType`)
        // and the same feats table, but export as their own Foundry
        // Item kinds — rebake under the scope-appropriate kind so the
        // catalog's per-type counts/supportedImportTypes stay in sync.
        void rebakeNow(scopeFeatType ?? 'feat', entryId);
        if (!opts.silent) {
          // Stay on the just-saved feat rather than resetting back to
          // a fresh form — the editor previously jumped the user
          // away from their work, which felt like data loss even
          // though the save succeeded. For new-feat saves we promote
          // `editingId` to the freshly-minted id so the next save
          // updates rather than creates a second row. Calling
          // markSaving() right before the promotion keeps
          // `sessionKey` stable across it so the MarkdownEditor
          // body doesn't remount + scroll back to top.
          if (wasCreate) {
            markSaving();
            setEditingId(entryId);
          }
          // Mark the current form as clean (it now matches what's
          // persisted). The cache-eviction in refreshEntries() will
          // trigger a re-fetch through the editingId useEffect, so
          // the form gets the canonical post-save shape on its next
          // tick — but in the meantime, this keeps the dirty-check
          // honest if the user clicks another row before then.
          lastLoadedFormRef.current = JSON.stringify(formDataRef.current ?? formData);
        }
      }
    } catch (error) {
      console.error('Error saving feat:', error);
      if (!opts.silent) toast.error('Failed to save feat');
      reportClientError(
        error,
        editingId ? OperationType.UPDATE : OperationType.CREATE,
        `feats/${editingId || '(new)'}`,
      );
      if (opts.silent) throw error;
    } finally {
      if (!opts.silent) setSaving(false);
    }
  };

  const handleSaveRef = useRef(handleSave);
  useEffect(() => { handleSaveRef.current = handleSave; });
  useEffect(() => { formDataRef.current = formData; }, [formData]);

  useProposalPreFlushSave({
    enabled: isProposalMode,
    proposalContext,
    handleSave,
    shouldRun: () => {
      if (!editingIdRef.current) return false;
      const currentSerialized = JSON.stringify(formDataRef.current ?? formData);
      return currentSerialized !== lastLoadedFormRef.current;
    },
    onError: (err) => console.error('[FeatsEditor] pre-flush stage failed:', err),
  });

  const handleDelete = async () => {
    if (!editingId) return;
    if (!window.confirm('Delete this feat?')) return;
    try {
      if (isProposalMode) {
        await featWriter.remove(editingId);
        toast.success(actionLabel(featWriter.mode, 'deleted'));
        resetForm();
      } else {
        await deleteFeat(editingId);
        toast.success('Feat deleted');
        await refreshEntries();
        resetForm();
      }
    } catch (error) {
      console.error('Error deleting feat:', error);
      toast.error('Failed to delete feat');
      reportClientError(error, OperationType.DELETE, `feats/${editingId}`);
    }
  };

  // Identity subtitle.
  const featTypeSubtitle = (() => {
    const valueLabel =
      FEAT_TYPE_VALUES.find(([value]) => value === formData.featType)?.[1] || 'Feat';
    const subtypeRaw = String(formData.featSubtype || '').trim();
    if (!subtypeRaw) return valueLabel;
    const enumLabel = (FEAT_SUBTYPE_OPTIONS_BY_VALUE[formData.featType] || [])
      .find(([v]) => v === subtypeRaw)?.[1];
    return `${valueLabel} · ${enumLabel || subtypeRaw}`;
  })();

  const identitySubtitle = `${featTypeSubtitle}${formData.repeatable ? ' · Repeatable' : ''}`;

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
              storagePath={`images/feats/${editingId || 'draft'}/`}
              onUpload={(url) => setFormData((prev) => ({ ...prev, imageUrl: url }))}
              imageType="icon"
              compact
              className="h-[80px] w-[80px]"
            />

            <div className="grid gap-3 grid-cols-2 md:grid-cols-3">
              <ReviewFieldHighlight columnKey="name" className="space-y-0.5">
                <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/45">Name</Label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                  className="h-8 bg-background/50 border-gold/15 focus:border-gold text-sm"
                  placeholder="e.g. Great Weapon Master"
                  required
                />
              </ReviewFieldHighlight>
              <ReviewFieldHighlight columnKey="identifier" className="space-y-0.5">
                <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/45">Identifier</Label>
                <Input
                  value={formData.identifier}
                  onChange={(e) => setFormData((prev) => ({ ...prev, identifier: e.target.value }))}
                  className="h-8 bg-background/50 border-gold/15 focus:border-gold font-mono text-sm"
                  placeholder={slugify(formData.name || 'feat')}
                />
              </ReviewFieldHighlight>
              <ReviewFieldHighlight columnKey="source_id" className="space-y-0.5">
                <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/45">Source</Label>
                <select
                  value={formData.sourceId}
                  onChange={(e) => setFormData((prev) => ({ ...prev, sourceId: e.target.value }))}
                  className="w-full h-8 px-2 rounded-md border border-gold/15 bg-background/50 focus:border-gold outline-none text-sm"
                >
                  <option value="">Select a source</option>
                  {sources.map((source) => (
                    <option key={source.id} value={source.id}>{source.name}</option>
                  ))}
                </select>
              </ReviewFieldHighlight>
              <ReviewFieldHighlight columnKey="feat_category_id" className="space-y-0.5">
                <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/45">Feat Category</Label>
                {/* Admin-managed taxonomy authored at
                    /admin/proficiencies → Feat Categories. Empty
                    option is the "no category assigned" sentinel; the
                    public detail view hides the line when this is
                    null. The dropdown is the only visible control for
                    the feat's bucket — the legacy feat_type /
                    feat_subtype / source_type fields are gone. */}
                <select
                  value={formData.featCategoryId}
                  onChange={(e) => setFormData((prev) => ({ ...prev, featCategoryId: e.target.value }))}
                  className="w-full h-8 px-2 rounded-md border border-gold/15 bg-background/50 focus:border-gold outline-none text-sm"
                >
                  <option value="">— Uncategorized —</option>
                  {featCategories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </ReviewFieldHighlight>
            </div>
          </div>

          <ReviewFieldHighlight columnKey="description" className="flex-1 min-h-0 flex flex-col">
            <MarkdownEditor
              key={sessionKey}
              value={formData.description}
              onChange={(value) => setFormData((prev) => ({ ...prev, description: value }))}
              label="Description"
              placeholder="Describe the feat in player-facing terms. Activities should carry runtime mechanics."
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
        <div className="space-y-4 border border-gold/15 rounded-md p-4 bg-background/20">
          <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-gold">Foundry Feat Shell</h3>
          <div className="grid md:grid-cols-2 gap-4">
            <label className="flex items-center justify-between gap-3 border border-gold/15 rounded-md p-3">
              <span className="text-xs font-bold uppercase tracking-widest text-ink/65">Repeatable</span>
              <Checkbox
                checked={!!formData.repeatable}
                onCheckedChange={(checked) =>
                  setFormData((prev) => ({ ...prev, repeatable: !!checked }))
                }
              />
            </label>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label className="text-xs font-bold uppercase tracking-widest text-ink/45">Uses Max</Label>
                <Input
                  value={formData.uses.max || ''}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      uses: { ...prev.uses, max: e.target.value },
                    }))
                  }
                  className="bg-background/50 border-gold/15 focus:border-gold font-mono"
                  placeholder="@prof"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-bold uppercase tracking-widest text-ink/45">Uses Spent</Label>
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
                  className="bg-background/50 border-gold/15 focus:border-gold no-number-spin"
                />
              </div>
            </div>
          </div>
          <div className="space-y-2 border-t border-gold/5 pt-3">
            <div className="flex items-baseline justify-between">
              <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/65">Recovery Rules</Label>
              <span className="text-[10px] text-ink/45">Lands at <code className="font-mono">system.uses.recovery[]</code></span>
            </div>
            <div className="space-y-2">
              {formData.uses.recovery.map((entry, idx) => (
                <div
                  key={idx}
                  className="flex gap-2 items-center p-2.5 bg-gold/5 border border-gold/5 rounded"
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
                    className="h-7 text-[10px] font-mono bg-background/40 border-gold/15 flex-1"
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
                <p className="text-center py-3 text-ink/35 italic text-[10px]">No recovery rules.</p>
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
                className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[10px] uppercase tracking-widest font-black text-gold/55 hover:text-gold border border-dashed border-gold/15 hover:border-gold/35 rounded transition-colors"
              >
                <Plus className="w-3 h-3" /> Add Recovery Rule
              </button>
            </div>
          </div>

          <p className="text-[10px] text-ink/45">
            This is for general feats first. Class and subclass features still primarily travel through the class feature pipeline, even though they import as Foundry <code className="font-mono">feat</code> items.
          </p>
        </div>
      ),
    },
    {
      key: 'activities',
      label: 'Activities',
      render: () => (
        <div className="border-t border-gold/15 pt-4">
          <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-gold mb-2">Activities</h3>
          <ActivityEditor
            activities={formData.activities}
            onChange={(activities) => setFormData((prev) => ({ ...prev, activities }))}
            availableEffects={formData.effects}
            context="feat"
          />
        </div>
      ),
    },
    {
      key: 'advancement',
      label: 'Advancement',
      layout: 'scroll',
      render: () => {
        // Scaling columns are gated by feat type. Class features
        // (feat_type='class'/'subclass') inherit from the parent
        // class — they don't author their own progression tables.
        // Everything else owns its own columns, queryable as
        // (parent_id=<feat.id>, parent_type=<feat|race|background>).
        const ft = String(formData.featType ?? '').toLowerCase();
        const scalingAllowed = ft !== 'class' && ft !== 'subclass';
        const scalingOwnerType: ScalingOwnerType =
          ft === 'race' || ft === 'background'
            ? (ft as ScalingOwnerType)
            : 'feat';
        const scalingLabel =
          ft === 'race' ? 'Race Columns'
            : ft === 'background' ? 'Background Columns'
              : 'Feat Columns';
        return (
          <div className="border-t border-gold/15 pt-4 space-y-3">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-gold">Advancement</h3>
              <span className="text-[10px] text-ink/45 italic">
                Default level <span className="font-mono">0</span> = always-on while feat is owned.
                Set a level &gt; 0 to gate against the granting class's level (or character level
                for standalone feats).
              </span>
            </div>
            {/* Two-column layout mirroring ClassEditor: the
                AdvancementManager owns the main column; the
                ScalingColumnsPanel hugs the right at xl+. Columns
                authored here surface as `availableScalingColumns`
                in the manager (next prop), so a ScaleValue
                advancement on the feat can reference them. */}
            <div className="grid xl:grid-cols-[1fr_320px] gap-6">
              <AdvancementManager
                advancements={formData.advancements}
                onChange={(advancements) => setFormData((prev) => ({ ...prev, advancements }))}
                parentContext={scopeFeatType || 'feat'}
                // Feats don't have sub-features (their `featureId` slot is
                // a class-side concept). `availableFeatures` left at the
                // default `[]` hides the picker; `parentContext="feat"`
                // ALSO hides it explicitly.
                availableOptionGroups={[...allOptionGroups, ...optionGroupDraftOptions]}
                // Option items aren't needed in the feat add menu today —
                // ItemGrant / ItemChoice pools resolve against option
                // GROUPS, not raw items. Leaving the prop empty mirrors the
                // pattern in ClassEditor where group-level choice is the
                // primary path.
                availableOptionItems={[...allOptionItems, ...optionItemDraftOptions]}
                // Scaling columns owned by THIS feat. Passing them
                // lets a ScaleValue advancement reference the
                // feat's own progression tables (e.g. a feat that
                // scales channel-divinity uses based on character
                // level). Class features omit this — they inherit
                // from the parent class instead.
                availableScalingColumns={scalingAllowed ? [...scalingColumns, ...scalingColumnDraftOptions] : undefined}
                // Tasha's-style feats can grant OTHER feats via ItemGrant
                // (e.g. "Skilled" with sub-feats). The feats list is the
                // already-loaded catalog (`entries`) — we filter out the
                // feat currently being edited so an author can't accidentally
                // make a feat grant itself.
                availableFeats={[...entries.filter((e: any) => e.id !== editingId), ...featDraftOptions.filter((d: any) => d.id !== editingId)]}
                // No classId — the option-group filter (which restricts
                // groups to classIds.includes(classId)) no-ops when classId
                // is undefined, falling through to all groups. That's the
                // right default for feats, which aren't class-scoped.
                defaultLevel={0}
                referenceContext={{
                  classLabel: formData.name || 'Feat',
                  classIdentifier: formData.identifier || slugify(formData.name || 'feat'),
                }}
                referenceSheetTitle="Feat Reference Sheet"
              />
              {scalingAllowed && editingId ? (
                <ScalingColumnsPanel
                  parentId={editingId}
                  parentType={scalingOwnerType}
                  columns={scalingColumns}
                  onColumnsChanged={() => setScalingLoadTick((t) => t + 1)}
                  userProfile={userProfile}
                  label={scalingLabel}
                />
              ) : scalingAllowed ? (
                // Placeholder so the column-authoring affordance is
                // visible BEFORE first save. The real panel needs a
                // saved parent_id to FK against, so we render an
                // inert hint card until the user saves the feat.
                // Without this, the entire feature was invisible to
                // anyone who hadn't already saved a draft.
                <div className="p-4 border border-gold/15 bg-card/30 rounded-xl space-y-2">
                  <h2 className="text-[10px] font-bold uppercase tracking-[0.16em] text-gold/75">{scalingLabel}</h2>
                  <p className="text-[11px] text-ink/55 italic leading-relaxed">
                    Save this {ft === 'race' ? 'race' : ft === 'background' ? 'background' : 'feat'} first
                    to add scaling columns. Columns appear here once the row
                    has a stable id to attach to.
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        );
      },
    },
    {
      key: 'effects',
      label: 'Effects',
      render: () => (
        <div className="border-t border-gold/15 pt-4">
          <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-gold mb-2">Active Effects</h3>
          <ActiveEffectEditor
            effects={formData.effects}
            onChange={(effects) => setFormData((prev) => ({ ...prev, effects }))}
            defaultImg={formData.imageUrl || null}
          />
        </div>
      ),
    },
  ], [formData, sources, editingId, scalingColumns, allOptionGroups, entries, scopeFeatType]);

  const tagsSubTabsList: TagsSubTab[] = useMemo(() => [
    {
      key: 'prereqs',
      label: 'Prereqs',
      render: () => (
        <div className="space-y-4 border border-gold/15 rounded-md p-4 bg-background/20">
          <div className="flex items-baseline justify-between">
            <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-gold">Prerequisites</h3>
            <span className="text-[10px] text-ink/45">
              Three layers · short text → free text → compound tree
            </span>
          </div>

          {/* RequirementsEditor now hosts all three layers itself —
              passing the freeText / shortText pairs activates the
              corresponding inputs + the live resolution preview.
              FeatsEditor just owns the state shape; the layout and
              the override semantics live inside the component so
              every consumer (UniqueOptionGroupEditor and future
              ones) gets the same affordances by passing the same
              prop set. */}
          <RequirementsEditor
            value={formData.requirementsTree}
            onChange={(next) => setFormData((prev) => ({ ...prev, requirementsTree: next }))}
            lookups={requirementsLookups}
            label="Compound Requirements"
            freeText={formData.requirements}
            onFreeTextChange={(next) => setFormData((prev) => ({ ...prev, requirements: next }))}
            shortText={formData.requirementsShortText}
            onShortTextChange={(next) => setFormData((prev) => ({ ...prev, requirementsShortText: next }))}
            previewLookup={requirementsTextLookup}
          />
        </div>
      ),
    },
    {
      key: 'tags',
      // Label carries the selection count so authors see what they've
      // already tagged without opening the sub-tab — mirrors the
      // SpellsEditor / ItemsEditor pattern.
      label: (
        <>
          Tags {formData.tagIds.length > 0 && (
            <span className="ml-1 text-gold/75">({formData.tagIds.length})</span>
          )}
        </>
      ),
      render: () => (
        <TagPicker
          tags={tags}
          tagGroups={tagGroups}
          selectedIds={formData.tagIds}
          onChange={(next) => setFormData((prev) => ({ ...prev, tagIds: next }))}
          hint="Tag rules + class spell list rules use these to decide which feats they include. Feats granted to a character also contribute their tags to the character's effective tag set."
          emptyHint="No tags loaded yet."
        />
      ),
    },
  ], [
    formData.requirements,
    formData.requirementsShortText,
    formData.requirementsTree,
    formData.tagIds,
    requirementsLookups,
    requirementsTextLookup,
    tags,
    tagGroups,
  ]);

  // ── List columns ──────────────────────────────────────────────
  const listColumns: EditorListColumn<any>[] = useMemo(() => [
    {
      key: 'name',
      label: 'Name',
      width: 'minmax(0,1fr)',
      align: 'start',
      render: (entry: any) => {
        if (entry.__pendingDelete) {
          return (
            <span className="truncate font-serif text-sm line-through text-blood/70">
              {entry.name || 'Untitled Feat'}
            </span>
          );
        }
        const drafted = focusModeEnabled && draftedFeatIds.has(String(entry.id));
        return (
          <span className={cn(
            "truncate font-serif text-sm",
            drafted ? 'text-archive-blue font-semibold' : 'text-ink',
          )}>
            {entry.name || <em className="text-ink/45">Untitled</em>}
          </span>
        );
      },
    },
    {
      key: 'type',
      label: 'Type',
      width: '40px',
      align: 'center',
      render: (entry: any) => {
        const valueLabel =
          FEAT_TYPE_VALUES.find(([value]) => value === entry.featType)?.[1]
          || entry.featType
          || 'Feat';
        const typeShort = valueLabel.split(' ')[0];
        return (
          <span className="text-[10px] text-ink/75 text-center truncate">
            {typeShort}
          </span>
        );
      },
    },
    {
      key: 'src',
      label: 'Src',
      width: '52px',
      align: 'center',
      render: (entry: any) => {
        const srcAbbrev = String(sourceAbbrevById[entry.sourceId] || entry.sourceId || '—');
        return (
          <span className="text-[10px] font-bold text-gold/85 text-center truncate">
            {srcAbbrev}
          </span>
        );
      },
    },
  ], [sourceAbbrevById, focusModeEnabled, draftedFeatIds]);

  // ── Filter axes (drives the modal body) ──────────────────────
  // Feat type + source come from the loaded entry shape; property +
  // advancementType use the pre-computed flags / set on each entry.
  const filterAxes = useMemo<FilterSection[]>(() => ([
    {
      key: 'featType', name: 'Feat Type', kind: 'axis',
      values: FEAT_TYPE_ORDER.map((value) => ({ value, label: FEAT_TYPE_LABELS[value] })),
    },
    {
      key: 'sourceType', name: 'Authoring Slot', kind: 'axis',
      values: SOURCE_TYPES.map(([value, label]) => ({ value, label })),
    },
    {
      key: 'property', name: 'Properties', kind: 'axis',
      values: FEAT_PROPERTY_ORDER.map((value) => ({ value, label: FEAT_PROPERTY_LABELS[value] })),
    },
    {
      key: 'advancementType', name: 'Advancements', kind: 'axis',
      values: ADVANCEMENT_TYPE_VALUES.map((v) => ({ ...v })),
    },
    {
      key: 'source', name: 'Sources', kind: 'axis',
      values: sources.map((s) => ({
        value: s.id,
        label: String(s.abbreviation || s.shortName || s.name || s.id),
        labelAlt: String(s.name || s.shortName || s.abbreviation || s.id),
      })),
    },
  ]), [sources]);

  // ── Inert pendingDelete handling ──────────────────────────────
  const handleListSelect = (id: string) => {
    const entry = filteredEntries.find((e) => String(e.id) === id);
    if (entry?.__pendingDelete) return; // tombstones are inert
    void startEditing(id);
  };

  // ── List empty-state copy ─────────────────────────────────────
  const listEmptyContent = useMemo(() => {
    if (focusModeEnabled && focusMode === 'drafts') {
      return (
        <div className="px-6 py-12 text-center text-ink/65 max-w-sm mx-auto space-y-2">
          <p className="font-bold text-ink/85">No feats in this block yet.</p>
          <p className="text-xs leading-relaxed text-ink/55">
            Click <span className="font-bold text-gold">New Feat</span> above to
            author one from scratch.
          </p>
          <p className="text-xs leading-relaxed text-ink/55">
            To propose changes to an existing feat, switch to
            <span className="font-bold text-gold"> Full Catalog</span> (top right,
            next to Submit Changes), open the feat, then click
            <span className="font-bold text-gold"> Edit Base</span> — it'll move
            into this list automatically.
          </p>
        </div>
      );
    }
    return 'No feats match the current search.';
  }, [focusModeEnabled, focusMode]);

  // ── Mode tabs ─────────────────────────────────────────────────
  const modes: EditorMode[] = [
    ...(isAdmin ? [{
      key: 'foundry-import',
      label: 'Foundry Import',
      adminOnly: true,
      render: <FeatImportWorkbench userProfile={userProfile} />,
    } as EditorMode] : []),
    {
      key: 'manual-editor',
      label: 'Manual Editor',
      render: null,
    },
  ];

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
      <CompendiumEditorShell<any>
        entityName={{
          singular: scopeFeatType === 'race'
            ? 'Race'
            : scopeFeatType === 'background'
              ? 'Background'
              : 'Feat',
          plural: scopeFeatType === 'race'
            ? 'Races'
            : scopeFeatType === 'background'
              ? 'Backgrounds'
              : 'Feats',
        }}
        backPath={backPath}
        backLabel={backLabel}
        modes={modes}
        defaultModeKey="manual-editor"
        manualEditorModeKey="manual-editor"
        isAdmin={isAdmin}
        listRows={filteredEntries}
        listColumns={listColumns}
        listRowHeight={36}
        loading={loading}
        selectedId={editingId}
        onSelect={handleListSelect}
        onNew={resetForm}
        getRowId={(row) => String(row.id)}
        emptyListMessage={listEmptyContent}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search feat name, type, source, or identifier"
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
            searchPlaceholder="Search feat name, type, source, or identifier"
            activeFilterCount={activeFilterCount}
            resetAll={() => { setSearch(''); resetAxisFilters(); }}
            embedded
          />
        }
        filterTitle="Filter Feats"
        identityName={formData.name}
        identitySourceAbbrev={formData.sourceId ? String(sourceAbbrevById[formData.sourceId] || formData.sourceId) : undefined}
        identitySourceFullName={formData.sourceId ? String(sourceNameById[formData.sourceId] || formData.sourceId) : undefined}
        identitySubtitle={identitySubtitle}
        onSave={(e) => void handleSave(e)}
        onDelete={editingId && !isProposalMode ? handleDelete : undefined}
        onReset={resetForm}
        saving={saving}
        formId="feat-manual-editor-form"
        isReadOnly={isReadOnly}
        onUnlockBase={editingId ? () => unlockBaseFeat(editingId) : undefined}
        cascadeBanner={cascadeBanner}
        proposalMode={!!proposalContext}
        editorSubTabs={editorSubTabs}
        tagsSubTabs={tagsSubTabsList}
        tagsSuperTabCount={formData.tagIds.length}
        renderPreview={(id) =>
          id ? (
            <FeatDetailPanel
              featId={id}
              emptyMessage="Loading preview…"
              cacheBustKey={previewBustKey}
              // In proposal mode a draft has no persisted live row to fetch
              // (create) or its live row doesn't yet reflect the edits (update),
              // so hand the panel the in-block draft's raw row to render from.
              featData={proposalContext ? (draftedFeatEntities.byId.get(id) ?? undefined) : undefined}
            />
          ) : (
            <div className="h-full flex items-center justify-center px-6 py-12 text-center">
              <div className="space-y-2 max-w-xs">
                <p className="text-sm text-ink/65 font-serif italic">
                  Preview pane
                </p>
                <p className="text-[11px] text-ink/45 leading-relaxed">
                  Select a feat from the list to preview it as it
                  appears in the public compendium. Pending edits
                  don't reflect until you save.
                </p>
              </div>
            </div>
          )
        }
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

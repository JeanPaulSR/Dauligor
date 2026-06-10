import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { useUnsavedChangesWarning } from '../../hooks/useUnsavedChangesWarning';
import { useClassRouteId, buildClassSlug } from '../../lib/useClassRouteId';
import { useKeyboardSave } from '../../hooks/useKeyboardSave';
import ActivityEditor from '../../components/compendium/ActivityEditor';
import FeatureModalHero from '../../components/compendium/FeatureModalHero';
import ProficienciesEditor from '../../components/compendium/ProficienciesEditor';
import ActiveEffectEditor from '../../components/compendium/ActiveEffectEditor';
import { reportClientError, OperationType } from '../../lib/firebase';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { ImageUpload } from '../../components/ui/ImageUpload';
import { ImageSetEditor, type ImageDisplay, DEFAULT_DISPLAY } from '../../components/ui/ImageSetEditor';
import { Sword, Save, Plus, Trash2, ChevronLeft, Shield, Scroll, Wand2, Heart, Hammer, BookOpen, Tag, Edit, Check, Image as ImageIcon, Zap, ListChecks, ChevronDown, ChevronRight, MessageCircle, Sliders } from 'lucide-react';
import { Dialog, DialogContent, DialogContentLarge, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from '../../components/ui/dialog';
import { ScrollArea } from '../../components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Checkbox } from '../../components/ui/checkbox';
import MarkdownEditor from '../../components/MarkdownEditor';
import Markdown from 'react-markdown';
import BBCodeRenderer from '../../components/BBCodeRenderer';
import { slugify, cn } from '../../lib/utils';
import AdvancementManager, { Advancement } from '../../components/compendium/AdvancementManager';
import ReferenceSyntaxHelp from '../../components/reference/ReferenceSyntaxHelp';
import ReferenceSheetDialog from '../../components/reference/ReferenceSheetDialog';
import { buildSpellFormulaShortcutRows, normalizeSpellFormulaShortcuts } from '../../lib/referenceSyntax';
import { normalizeAdvancementListForEditor, resolveAdvancementDefaultHitDie } from '../../lib/advancementState';
import { buildCanonicalBaseClassAdvancements } from '../../lib/classProgression';
import {
  sanitizeProficiencySelection,
  buildNextGroupedProficiencyCollection,
  buildGroupedProficiencyDisplayName,
} from '../../lib/proficiencySelection';
import { fetchCollection, fetchDocument, queryD1, upsertDocument, deleteDocument } from '../../lib/d1';
import { normalizeFeatureData, denormalizeCompendiumData } from '../../lib/compendium';
import { effectiveOptionLevel } from '../../lib/requirements';
import { useProposalAccumulator, useProposalContextOptional } from '../../lib/proposalAccumulator';
import { useProposalEntityDrafts } from '../../hooks/useProposalEntityDrafts';
import { useBlockDraftPickerOptions } from '../../hooks/useBlockDraftPickerOptions';
import { useBlockDraftedList } from '../../hooks/useBlockDraftedList';
import { actionLabel, applyProposalWrite } from '../../lib/proposalAware';
import { useProposalReview, ReviewFieldHighlight } from '../../lib/proposalReview';
import { ReviewBanner } from '../../components/proposals/ReviewBanner';
import { DeletedEntityBanner } from '../../components/proposals/TombstoneRow';
import { useTombstoneBanner } from '../../hooks/useTombstoneBanner';
import { CascadeDependentBanner } from '../../components/proposals/CascadeDependentBanner';
import { TagReplacementPicker } from '../../components/proposals/TagReplacementPicker';
import { useCascadeDependent } from '../../hooks/useCascadeDependent';
import { useProposalSingleWorkId } from '../../hooks/useProposalSingleWorkId';
import { useProposalPreFlushSave } from '../../hooks/useProposalPreFlushSave';
import { ProposalAwareEditorHeader } from '../../components/proposals/ProposalAwareEditorHeader';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { queueRebake } from '../../lib/moduleExport';
import { BakeNowButton } from '../../components/compendium/BakeNowButton';
import ScalingColumnsPanel from '../../components/compendium/ScalingColumnsPanel';

const FEATURE_TYPES = [
  { id: 'background', name: 'Background Feature' },
  { id: 'class', name: 'Class Feature' },
  { id: 'monster', name: 'Monster Feature' },
  { id: 'species', name: 'Species Feature' },
  { id: 'enchantment', name: 'Enchantment' },
  { id: 'feat', name: 'Feat' },
  { id: 'gift', name: 'Supernatural Gift' },
  { id: 'vehicle', name: 'Vehicle Feature' }
];

const CLASS_FEATURE_SUBTYPES = [
  { id: '', name: 'None' },
  { id: 'arcaneShot', name: 'Arcane Shot' },
  { id: 'artificerInfusion', name: 'Artificer Infusion' },
  { id: 'artificerPlan', name: 'Artificer Plan' },
  { id: 'channelDivinity', name: 'Channel Divinity' },
  { id: 'defensiveTactic', name: 'Defensive Tactic' },
  { id: 'eldritchInvocation', name: 'Eldritch Invocation' },
  { id: 'elementalDiscipline', name: 'Elemental Discipline' },
  { id: 'fightingStyle', name: 'Fighting Style' },
  { id: 'huntersPrey', name: "Hunter's Prey" },
  { id: 'ki', name: 'Ki Ability' },
  { id: 'maneuver', name: 'Maneuver' },
  { id: 'metamagic', name: 'Metamagic Option' },
  { id: 'multiattack', name: 'Multiattack' },
  { id: 'pactBoon', name: 'Pact Boon' },
  { id: 'psionicPower', name: 'Psionic Power' },
  { id: 'rune', name: 'Rune' },
  { id: 'superiorHuntersDefense', name: "Superior Hunter's Defense" }
];

const normalizeFeaturePropertiesForEditor = (properties: any[] = []) => {
  const mapped = (Array.isArray(properties) ? properties : [])
    .map((property) => {
      if (property === 'magical') return 'mgc';
      if (property === 'passive') return 'trait';
      return String(property || '').trim();
    })
    .filter(Boolean);

  return Array.from(new Set(mapped));
};

const SPELLCASTING_FORMULA_GUIDANCE = [
  'Dauligor spellcasting shortcuts are contextual in this field.',
  'Use min(), floor(), and ceil() for rounding or minimum logic.',
  'The preview below shows how the current class and ability resolve.'
];

function getClassReferenceIdentifier(sourceId: string, name: string) {
  if (String(sourceId || '').startsWith('class-')) return String(sourceId).slice(6);
  return slugify(name || 'class');
}

function resolveLegacyProficiencyIds(legacyValue: string, entries: any[] = []) {
  if (!legacyValue?.trim() || entries.length === 0) return [];
  const parts = legacyValue
    .split(',')
    .map(part => part.trim().toLowerCase())
    .filter(Boolean);

  return entries
    .filter(entry => {
      const comparableValues = [
        entry.name,
        entry.identifier,
        entry.category,
        entry.foundryAlias
      ]
        .filter(Boolean)
        .map((value: string) => String(value).trim().toLowerCase());

      return parts.some(part => comparableValues.includes(part));
    })
    .map(entry => entry.id);
}

function sanitizeProficiencyCollection(raw: any = {}) {
  return {
    armor: sanitizeProficiencySelection(raw.armor, { includeCategories: true }),
    // Weapons get the extra includeWeaponTypeFilters flag so the
    // categoryMeleeIds / categoryRangedIds arrays survive the round-trip
    // through this normalizer. Other proficiency types don't have a
    // melee/ranged dimension.
    weapons: sanitizeProficiencySelection(raw.weapons, { includeCategories: true, includeWeaponTypeFilters: true }),
    tools: sanitizeProficiencySelection(raw.tools, { includeCategories: true }),
    skills: sanitizeProficiencySelection(raw.skills, { includeCategories: false }),
    savingThrows: sanitizeProficiencySelection(raw.savingThrows, { uppercase: true, includeCategories: false }),
    languages: sanitizeProficiencySelection(raw.languages, { includeCategories: true }),
    armorDisplayName: typeof raw.armorDisplayName === 'string' ? raw.armorDisplayName : '',
    weaponsDisplayName: typeof raw.weaponsDisplayName === 'string' ? raw.weaponsDisplayName : '',
    toolsDisplayName: typeof raw.toolsDisplayName === 'string' ? raw.toolsDisplayName : '',
    skillsDisplayName: typeof raw.skillsDisplayName === 'string' ? raw.skillsDisplayName : ''
  };
}

function sortAdvancementsByLevelThenType(a: Advancement, b: Advancement) {
  if (a.level !== b.level) return a.level - b.level;
  return a.type.localeCompare(b.type);
}

function flattenStringArray(values: any): string[] {
  if (!Array.isArray(values)) {
    const single = String(values ?? '').trim();
    return single ? [single] : [];
  }

  return values.flatMap((value) => flattenStringArray(value));
}

function normalizePrimaryAbilityListForSave(values: any): string[] {
  return Array.from(new Set(
    flattenStringArray(values)
      .map((value) => String(value || '').trim().toLowerCase())
      .filter((value) => ['str', 'dex', 'con', 'int', 'wis', 'cha'].includes(value))
  ));
}

function normalizePrimaryAbilityListForEditor(values: any): string[] {
  return normalizePrimaryAbilityListForSave(values).map((value) => value.toUpperCase());
}

function buildEmptyClassSpellcastingState() {
  return {
    hasSpellcasting: false,
    isRitualCaster: false,
    description: '',
    level: 1,
    ability: 'INT',
    type: 'prepared',
    // Which slot system this class draws from. 'spellcasting' = standard
    // slots (the Full/Half/Third progression feeds the Multiclass Master
    // Chart); 'pact' = Warlock-style pact slots (the same progression feeds
    // the Pact Master Chart instead). Replaces the deprecated
    // progressionId === 'custom' + altProgressionId mechanism.
    castingMode: 'spellcasting',
    progressionId: '',
    // DEPRECATED — pact magic is now `castingMode: 'pact'`. Kept in the
    // shape only so legacy rows lazy-migrate cleanly on load/save.
    altProgressionId: '',
    spellsKnownId: '',
    spellsKnownFormula: '',
    // Spellbook-only fields. `startingSpellbookCount` is how many
    // initial spells the class adds to its spellbook at the
    // spellcasting trigger level (Wizard: 6). `spellbookAdditionsPerLevel`
    // is how many spells get added per class level after that
    // (Wizard: 2). The Foundry importer's spell-pick step uses these
    // to compute pick counts for spellbook-type classes, since
    // spellbook casters don't ship a spellsKnown scaling table for
    // their leveled-spell count (the spellbook is open-ended;
    // prepared count is formula-driven via `spellsKnownFormula`).
    startingSpellbookCount: 0,
    spellbookAdditionsPerLevel: 0,
  };
}

function normalizeClassSpellcastingForEditor(spellcasting: any) {
  if (!spellcasting || typeof spellcasting !== 'object') {
    return buildEmptyClassSpellcastingState();
  }

  // Casting mode + lazy migration off the deprecated custom/pact mechanism.
  // Old pact classes were marked by progressionId === 'custom' plus an
  // altProgressionId (or an exported progression === 'pact'); surface those as
  // castingMode 'pact' and drop the 'custom' sentinel so the Progression Type
  // dropdown (Full/Half/Third) shows a real selection again.
  const rawCastingMode = String(spellcasting.castingMode || '').trim().toLowerCase();
  const legacyProgressionId = String(spellcasting.progressionId || '').trim();
  const looksLikeLegacyPact =
    legacyProgressionId === 'custom'
    || Boolean(String(spellcasting.altProgressionId || '').trim())
    || String(spellcasting.progression || '').trim().toLowerCase() === 'pact';
  const castingMode =
    rawCastingMode === 'pact' || (!rawCastingMode && looksLikeLegacyPact)
      ? 'pact'
      : 'spellcasting';

  const normalized = {
    ...buildEmptyClassSpellcastingState(),
    ...spellcasting,
    hasSpellcasting: Boolean(spellcasting.hasSpellcasting),
    isRitualCaster: Boolean(spellcasting.isRitualCaster),
    castingMode,
    progressionId: legacyProgressionId === 'custom' ? '' : legacyProgressionId,
    ability: String(spellcasting.ability || 'INT').toUpperCase(),
    type: String(spellcasting.type || 'prepared').toLowerCase(),
    level: Number(spellcasting.level || 1) || 1,
    // Coerce to non-negative integers — the editor inputs are
    // `type="number"` but D1 stores spellcasting as JSON so old
    // records or hand-edited rows might land any shape.
    startingSpellbookCount: Math.max(0, Number(spellcasting.startingSpellbookCount ?? 0) || 0),
    spellbookAdditionsPerLevel: Math.max(0, Number(spellcasting.spellbookAdditionsPerLevel ?? 0) || 0),
  } as any;

  return normalized;
}

function normalizeClassSpellcastingForSave(spellcasting: any) {
  const normalized = normalizeClassSpellcastingForEditor(spellcasting);
  if (!normalized.hasSpellcasting) return null;

  const hasLinkedScalingIds = Boolean(
    normalized.progressionId
    || normalized.altProgressionId
    || normalized.spellsKnownId
  );

  delete normalized.manualProgressionId;

  if (hasLinkedScalingIds) {
    delete normalized.progression;
  }

  // Pact magic is expressed solely via castingMode now; retire the deprecated
  // alternative-progression pointer so it can't shadow the Pact Master Chart.
  // The Full/Half/Third progressionId still rides along — it just feeds the
  // pact chart instead of the standard one at runtime/export.
  if (normalized.castingMode === 'pact') {
    normalized.altProgressionId = '';
  }

  return normalized;
}

export default function ClassEditor({ userProfile }: { userProfile: any }) {
  // PERF: lazily render tab panels. ClassEditor builds the JSX for ALL tab
  // panels on every render; the two proficiency grids alone are hundreds of
  // elements each, so every keystroke rebuilt them (dev `jsxDEV` made this the
  // dominant typing cost: ~291ms/render in dev vs 16ms in prod). Gating each
  // heavy tab's content on `activeTab` skips constructing inactive tabs.
  const [activeTab, setActiveTab] = useState('basic');
  // Route param resolves through `useClassRouteId`, which handles both
  // the admin `:slug` form (`sorcerer_phb`) and the proposal `:id` form
  // (primary key, or React Router's stringified `"null"`/`"undefined"`
  // for pre-`ce906dc` CREATE-draft routes — those fall through to
  // create-mode behaviour because the hook returns `id: undefined`).
  // The `slug` field carries the original URL slug for outbound
  // back-link construction on the admin side.
  const { id, slug, isLoading: slugLoading, notFound: slugNotFound } = useClassRouteId();
  const navigate = useNavigate();
  const location = useLocation();
  const isAdmin = userProfile?.role === 'admin';
  // Route-aware basePath — admin route writes directly via upsertDocument;
  // proposal route wraps + the accumulator queues into the active block.
  // Nested entity writes (features, scaling columns, subclasses) stay
  // admin-only — those tables aren't in the proposal allowlist yet.
  const isProposalRoute = location.pathname.startsWith('/proposals/edit/');
  const basePath = isProposalRoute ? '/proposals/edit/classes' : '/compendium/classes';
  const classWriter = useProposalAccumulator('class', userProfile);
  // Features (Wild Shape, Rage, …) are interior nodes of a class. Routing
  // their saves through the accumulator lets a content-creator author them
  // inside the class's proposal block instead of 403-ing on the direct
  // `features` write. Outside a wrapper this is admin-direct (upsert) /
  // content-creator standalone / readonly, same as every other writer.
  const featureWriter = useProposalAccumulator('feature', userProfile);
  const proposalContext = useProposalContextOptional();
  const isProposalMode = classWriter.mode === 'proposal' || classWriter.mode === 'block';
  // In-progress class state (queued + active-block drafts). Used to
  // restore the form when the user just created a new class via the
  // proposal route: the live row doesn't exist yet, so fetching from
  // D1 would blank the form. Falling back to the queued payload keeps
  // their work visible until Submit Changes lands the draft.
  const classDrafts = useProposalEntityDrafts('class');
  // Tombstone state — true when this class has a queued/drafted
  // DELETE in the active block. Shown via DeletedEntityBanner above
  // the form + wraps the rest of the form in fieldset disabled.
  const { isPendingDelete: isClassPendingDelete, undoDelete: undoClassDelete } = useTombstoneBanner('class', id);
  // Cascade dependent state — true when this class was auto-enrolled
  // by a parent tag delete in the active block (e.g. a deleted tag's
  // id was stripped from this class's `tag_ids`). The banner offers
  // Accept (keep the strip) / Replace (substitute another tag).
  const cascadeDep = useCascadeDependent('class', id);
  const [replaceTagPickerOpen, setReplaceTagPickerOpen] = useState(false);
  // After a proposal-mode CREATE we stay on the /new route (navigating
  // to /edit/<id> would unmount the wrapper and destroy the queue).
  // See useProposalSingleWorkId for the full pendingCreateId convention.
  const { effectiveId, pendingCreateId, recordCreate } = useProposalSingleWorkId(id);
  // Review mode — the editor is being viewed via `?review=<proposal_id>`
  // (e.g. the user clicked a past submission in /my-proposals). In
  // this mode the form is populated from the proposal's payload, all
  // controls are disabled, and the wrapper's Submit Changes is
  // suppressed. Rejected proposals stay editable so the user can
  // resubmit.
  const reviewMode = useProposalReview();
  const isReviewingThisClass =
    !!reviewMode &&
    reviewMode.entityType === 'class' &&
    (reviewMode.entityId === id || (reviewMode.operation === 'create' && !id));
  const reviewIsReadOnly = isReviewingThisClass && reviewMode!.isReadOnly;
  const [deleteClassConfirmOpen, setDeleteClassConfirmOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(!!id);
  const [sources, setSources] = useState<any[]>([]);
  const [spellcastingTypes, setSpellcastingTypes] = useState<any[]>([]);
  const [knownScalings, setKnownScalings] = useState<any[]>([]);
  const [allSkills, setAllSkills] = useState<any[]>([]);
  const [allTools, setAllTools] = useState<any[]>([]);
  const [allToolCategories, setAllToolCategories] = useState<any[]>([]);
  const [allArmor, setAllArmor] = useState<any[]>([]);
  const [allArmorCategories, setAllArmorCategories] = useState<any[]>([]);
  const [allWeapons, setAllWeapons] = useState<any[]>([]);
  const [allWeaponCategories, setAllWeaponCategories] = useState<any[]>([]);
  const [allLanguages, setAllLanguages] = useState<any[]>([]);
  const [allLanguageCategories, setAllLanguageCategories] = useState<any[]>([]);
  const [allAttributes, setAllAttributes] = useState<any[]>([]);
  const [subclasses, setSubclasses] = useState<any[]>([]);
  const [name, setName] = useState('');
  const [preview, setPreview] = useState('');
  const [description, setDescription] = useState('');
  const [lore, setLore] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [category, setCategory] = useState<'core' | 'alternate' | 'new'>('core');
  const [hitDie, setHitDie] = useState(8);
  const [savingThrows, setSavingThrows] = useState<string[]>([]);
  const [proficiencies, setProficiencies] = useState<any>({
    armor: {
      choiceCount: 0,
      optionIds: [],
      fixedIds: [],
      categoryIds: []
    },
    weapons: {
      choiceCount: 0,
      optionIds: [],
      fixedIds: [],
      categoryIds: [],
      // 20260526: melee/ranged-restricted category grants. Parallel to
      // categoryIds — see sanitizeProficiencySelection for the contract.
      categoryMeleeIds: [],
      categoryRangedIds: []
    },
    tools: {
      choiceCount: 0,
      optionIds: [],
      fixedIds: [],
      categoryIds: []
    },
    languages: {
      choiceCount: 0,
      optionIds: [],
      fixedIds: [],
      categoryIds: []
    },
    skills: {
      choiceCount: 0,
      optionIds: [],
      fixedIds: []
    },
    savingThrows: {
      choiceCount: 0,
      optionIds: [],
      fixedIds: []
    },
    armorDisplayName: '',
    weaponsDisplayName: '',
    toolsDisplayName: '',
    skillsDisplayName: ''
  });
  const [startingEquipment, setStartingEquipment] = useState('');
  const [wealth, setWealth] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [imageDisplay, setImageDisplay] = useState<ImageDisplay>(DEFAULT_DISPLAY);
  const [cardImageUrl, setCardImageUrl] = useState('');
  const [cardDisplay, setCardDisplay] = useState<ImageDisplay>(DEFAULT_DISPLAY);
  const [previewImageUrl, setPreviewImageUrl] = useState('');
  const [previewDisplay, setPreviewDisplay] = useState<ImageDisplay>(DEFAULT_DISPLAY);
  const [multiclassing, setMulticlassing] = useState('');
  const [multiclassProficiencies, setMulticlassProficiencies] = useState<any>({
    armor: { choiceCount: 0, optionIds: [], fixedIds: [], categoryIds: [] },
    weapons: { choiceCount: 0, optionIds: [], fixedIds: [], categoryIds: [], categoryMeleeIds: [], categoryRangedIds: [] },
    tools: { choiceCount: 0, optionIds: [], fixedIds: [], categoryIds: [] },
    languages: { choiceCount: 0, optionIds: [], fixedIds: [], categoryIds: [] },
    skills: { choiceCount: 0, optionIds: [], fixedIds: [] },
    savingThrows: { choiceCount: 0, optionIds: [], fixedIds: [] },
    armorDisplayName: '',
    weaponsDisplayName: '',
    toolsDisplayName: '',
    skillsDisplayName: ''
  });
  const [primaryAbility, setPrimaryAbility] = useState<string[]>([]);
  const [primaryAbilityChoice, setPrimaryAbilityChoice] = useState<string[]>([]);
  const [spellcasting, setSpellcasting] = useState(buildEmptyClassSpellcastingState());
  const [excludedOptionIds, setExcludedOptionIds] = useState<Record<string, string[]>>({});
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [subclassTitle, setSubclassTitle] = useState('');
  const [subclassFeatureLevels, setSubclassFeatureLevels] = useState<number[]>([]);
  const [levelsInput, setLevelsInput] = useState('');
  const [asiLevels, setAsiLevels] = useState<number[]>([4, 8, 12, 16, 19]);
  const [asiLevelsInput, setAsiLevelsInput] = useState('4, 8, 12, 16, 19');

  // Features State
  const [features, setFeatures] = useState<any[]>([]);
  const [editingFeature, setEditingFeature] = useState<any>(null);
  // Bumped after a feature/scaling save or delete so the data-load useEffect re-fires.
  const [loadTick, setLoadTick] = useState(0);
  const [isFeatureModalOpen, setIsFeatureModalOpen] = useState(false);
  const [featureTab, setFeatureTab] = useState('description');
  const [showFeatureSource, setShowFeatureSource] = useState(false);

  // Groups for selection
  const [allOptionGroups, setAllOptionGroups] = useState<any[]>([]);
  const [allOptionItems, setAllOptionItems] = useState<any[]>([]);
  // Feats catalog for AdvancementManager's ItemGrant / ItemChoice
  // "Feat" pool. Loaded once in the foundation effect alongside option
  // groups; the runtime walker in CharacterBuilder reads feat refs back
  // out of `optionsCache`, so the authoring side just needs the catalog
  // here to populate the picker.
  const [allFeats, setAllFeats] = useState<any[]>([]);
  const [tagGroups, setTagGroups] = useState<any[]>([]);
  const [allTags, setAllTags] = useState<any[]>([]);
  const [scalingColumns, setScalingColumns] = useState<any[]>([]);
  // Block-draft picker overlays (Part C L1). A content-creator building this
  // class in a proposal block also drafts the entities its advancements
  // reference — scaling columns, features, option groups/items, feats — in the
  // SAME block, with no live row yet. These surface those drafts (display-only,
  // "(in this block)" suffix) so they're selectable in the advancement pickers.
  // Empty outside a <ProposalEditorWrapper>; NEVER merged into a save payload.
  const scalingColumnDraftOptions = useBlockDraftPickerOptions('scaling_column');
  // Parent-scoped: only THIS class's draft features belong in the advancement
  // feature picker — without the filter a sibling subclass's block-draft
  // features leaked in. Mirrors the displayFeatures overlay just below.
  const featureDraftOptions = useBlockDraftPickerOptions('feature', { parentId: effectiveId, parentType: 'class' });
  const optionGroupDraftOptions = useBlockDraftPickerOptions('unique_option_group');
  const optionItemDraftOptions = useBlockDraftPickerOptions('unique_option_item');
  const featDraftOptions = useBlockDraftPickerOptions('feat');
  // Memoized merged picker arrays (live + block-draft). Stable refs across
  // unrelated re-renders (e.g. typing in a basics field) so the now-memoized
  // AdvancementManager can skip re-rendering — the fix for the editor's input lag.
  const scalingColumnPickerOptions = useMemo(() => [...scalingColumns, ...scalingColumnDraftOptions], [scalingColumns, scalingColumnDraftOptions]);
  const featurePickerOptions = useMemo(() => [...features, ...featureDraftOptions], [features, featureDraftOptions]);
  const optionGroupPickerOptions = useMemo(() => [...allOptionGroups, ...optionGroupDraftOptions], [allOptionGroups, optionGroupDraftOptions]);
  const optionItemPickerOptions = useMemo(() => [...allOptionItems, ...optionItemDraftOptions], [allOptionItems, optionItemDraftOptions]);
  const featPickerOptions = useMemo(() => [...allFeats, ...featDraftOptions], [allFeats, featDraftOptions]);
  // F2 — the Features list shows live rows; in a block, merge this class's
  // queued draft features in so a just-added feature is visible (not gone until
  // a reload). Unchanged on admin-direct routes.
  const displayFeatures = useBlockDraftedList('feature', features, { parentId: effectiveId, parentType: 'class' });
  // F2 — same for the Subclasses list. Subclasses key on `class_id` (not
  // parent_id/parent_type), so match on that. A subclass drafted in this block
  // shows under its class without a reload.
  const displaySubclasses = useBlockDraftedList('subclass', subclasses, { parentId: effectiveId, parentKey: 'class_id' });
  const [advancements, setAdvancements] = useState<Advancement[]>([]);

  const normalizeEditorAdvancements = useCallback((list: any[] = [], defaultLevel = 1, dieOverride?: number) => (
    normalizeAdvancementListForEditor(list, {
      defaultLevel,
      defaultHitDie: resolveAdvancementDefaultHitDie(dieOverride ?? hitDie)
    }) as Advancement[]
  ), [hitDie]);

  const normalizeFeatureForEditor = useCallback((feature: any) => {
    const prerequisites = feature?.prerequisites || {};
    const configuration = feature?.configuration || {};
    const uses = feature?.uses || feature?.usage || {};
    return {
      ...feature,
      name: feature?.name || '',
      description: feature?.description || '',
      identifier: feature?.identifier || slugify(feature?.name || ''),
      source: {
        custom: feature?.source?.custom || '',
        book: feature?.source?.book || '',
        page: feature?.source?.page || '',
        license: feature?.source?.license || '',
        rules: feature?.source?.rules || '',
        revision: feature?.source?.revision ?? 1
      },
      requirements: feature?.requirements || '',
      subtype: feature?.subtype || '',
      level: feature?.level ?? 1,
      featureType: feature?.featureType || 'class',
      prerequisites: {
        level: prerequisites.level ?? (configuration.requiredLevel && configuration.requiredLevel > 1 ? configuration.requiredLevel : null),
        items: Array.isArray(prerequisites.items) && prerequisites.items.length
          ? prerequisites.items
          : (configuration.requiredIds || []),
        repeatable: prerequisites.repeatable ?? configuration.repeatable ?? false
      },
      properties: normalizeFeaturePropertiesForEditor(feature?.properties || []),
      uses: {
        spent: Number(uses.spent || 0) || 0,
        max: uses.max || '',
        recovery: Array.isArray(uses.recovery) ? uses.recovery : []
      },
      advancements: normalizeEditorAdvancements(feature?.advancements || [], Number(feature?.level || 1) || 1)
    };
  }, [normalizeEditorAdvancements]);

  // Unique Options Management
  const [managingGroupId, setManagingGroupId] = useState<string | null>(null);
  const [managingGroupSearch, setManagingGroupSearch] = useState('');

  // Refs for Markdown Toolbar
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const equipmentRef = useRef<HTMLTextAreaElement>(null);
  const multiclassingRef = useRef<HTMLTextAreaElement>(null);
  const spellcastingRef = useRef<HTMLTextAreaElement>(null);
  const featureDescRef = useRef<HTMLTextAreaElement>(null);

  const getCurrentStateHash = useCallback(() => {
    return JSON.stringify({
      name, preview, description, lore, sourceId, hitDie, savingThrows, proficiencies, multiclassProficiencies,
      primaryAbility, primaryAbilityChoice, tagIds, subclassFeatureLevels, asiLevels,
      advancements, imageUrl, imageDisplay, cardImageUrl, cardDisplay, previewImageUrl, previewDisplay, spellcasting, startingEquipment, wealth, multiclassing, excludedOptionIds, subclassTitle
    });
  }, [name, preview, description, lore, sourceId, hitDie, savingThrows, proficiencies, multiclassProficiencies, primaryAbility, primaryAbilityChoice, tagIds, subclassFeatureLevels, asiLevels, advancements, imageUrl, imageDisplay, cardImageUrl, cardDisplay, previewImageUrl, previewDisplay, spellcasting, startingEquipment, wealth, multiclassing, excludedOptionIds, subclassTitle]);

  const [initialDataHash, setInitialDataHash] = useState<string>('');
  const [lastSavedTick, setLastSavedTick] = useState<number>(0);
  // True once the user has actually interacted with the page (pointer/key).
  // A ref, not state: flipping it must never trigger a render.
  const userHasEditedRef = useRef(false);

  const isDirty = useMemo(() => {
    if (!initialDataHash) return false;
    return initialDataHash !== getCurrentStateHash();
  }, [initialDataHash, getCurrentStateHash]);

  useUnsavedChangesWarning(isDirty);
  useKeyboardSave(() => { handleSave(); });

  // Reset the "user touched it" flag whenever a different class is loaded, so a
  // freshly-loaded class re-folds its own load-time normalizations (below).
  useEffect(() => { userHasEditedRef.current = false; }, [id]);

  // The first genuine user interaction freezes the saved-state baseline below.
  useEffect(() => {
    const markEdited = () => { userHasEditedRef.current = true; };
    document.addEventListener('pointerdown', markEdited, { capture: true });
    document.addEventListener('keydown', markEdited, { capture: true });
    return () => {
      document.removeEventListener('pointerdown', markEdited, { capture: true });
      document.removeEventListener('keydown', markEdited, { capture: true });
    };
  }, []);

  // Saved-state baseline for the unsaved-changes guard.
  //
  // Loading a class settles ~two dozen fields across several async ticks: the
  // rich-text editors re-parse/normalize their stored BBCode, the legacy
  // armor/weapons string->object conversion runs once the catalogs arrive,
  // foundation-dependent values fill in. Those are PROGRAMMATIC changes, not
  // user edits. Snapshotting the baseline at any single moment during that
  // settle froze a transient shape and made isDirty read true on a class nobody
  // touched, so the leave-page guard fired spuriously.
  //
  // So while the form is UNTOUCHED we keep the baseline synced to the current
  // state on every change — folding all post-load normalization into the
  // pristine baseline no matter when (or why) it lands. The first real
  // interaction (handled above) freezes it; from then on a genuine edit (typed
  // OR clicked) flips isDirty. After a save we re-baseline to the saved state.
  useEffect(() => {
    if (initialLoading) return;
    if (lastSavedTick > 0) {
      setInitialDataHash(getCurrentStateHash());
      setLastSavedTick(0);
      return;
    }
    if (!userHasEditedRef.current) {
      setInitialDataHash(getCurrentStateHash());
    }
  }, [initialLoading, getCurrentStateHash, lastSavedTick]);

  useEffect(() => {
    const loadFoundation = async () => {
      try {
        // Fetch all foundation/taxonomy collections in parallel
        const [
          sourcesData,
          scTypesData,
          knownData,
          skillsData,
          toolsData,
          toolCatsData,
          armorData,
          armorCatsData,
          weaponsData,
          weaponCatsData,
          langsData,
          langCatsData,
          attrsData,
          optGroupsData,
          optItemsData,
          tagGroupsData,
          allTagsData,
          featsData
        ] = await Promise.all([
          fetchCollection('sources', { orderBy: 'name ASC' }),
          fetchCollection('spellcastingTypes', { orderBy: 'name ASC' }),
          fetchCollection('spellsKnownScalings', { orderBy: 'name ASC' }),
          fetchCollection('skills', { orderBy: 'name ASC' }),
          fetchCollection('tools', { orderBy: 'name ASC' }),
          fetchCollection('toolCategories', { orderBy: 'name ASC' }),
          fetchCollection('armor', { orderBy: 'name ASC' }),
          fetchCollection('armorCategories', { orderBy: 'name ASC' }),
          fetchCollection('weapons', { orderBy: 'name ASC' }),
          fetchCollection('weaponCategories', { orderBy: 'name ASC' }),
          fetchCollection('languages', { orderBy: 'name ASC' }),
          fetchCollection('languageCategories', { orderBy: 'name ASC' }),
          fetchCollection('attributes'),
          fetchCollection('uniqueOptionGroups', { orderBy: 'name ASC' }),
          fetchCollection('uniqueOptionItems'),
          fetchCollection('tagGroups', {
            where: "classifications LIKE '%\"class\"%'"
          }),
          fetchCollection('tags'),
          // Feats catalog feeds AdvancementManager's "Feat" pool.
          // Snake_case `feat_subtype` is normalized to camelCase below
          // so the picker can read `featSubtype` directly.
          fetchCollection('feats', { orderBy: 'name ASC' })
        ]);

        setSources(sourcesData.map(s => denormalizeCompendiumData(s)));
        setSpellcastingTypes(scTypesData.map(t => denormalizeCompendiumData(t)));
        setKnownScalings(knownData.map((k: any) => ({
          ...denormalizeCompendiumData(k),
          levels: typeof k.levels === 'string' ? JSON.parse(k.levels) : (k.levels || [])
        })));
        setAllSkills(skillsData.map(s => denormalizeCompendiumData(s)));
        setAllTools(toolsData.map(t => denormalizeCompendiumData(t)));
        setAllToolCategories(toolCatsData.map(c => denormalizeCompendiumData(c)));
        setAllArmor(armorData.map(a => denormalizeCompendiumData(a)));
        setAllArmorCategories(armorCatsData.map(c => denormalizeCompendiumData(c)));
        setAllWeapons(weaponsData.map((w: any) => ({
          ...denormalizeCompendiumData(w),
          propertyIds: typeof w.property_ids === 'string' ? JSON.parse(w.property_ids) : (w.property_ids || w.propertyIds || [])
        })));
        setAllWeaponCategories(weaponCatsData.map(c => denormalizeCompendiumData(c)));
        setAllLanguages(langsData.map(l => denormalizeCompendiumData(l)));
        setAllLanguageCategories(langCatsData.map(c => denormalizeCompendiumData(c)));
        
        // Attributes unique logic
        const uniqueAttrsMap = new Map();
        attrsData.map(a => denormalizeCompendiumData(a)).forEach((item: any) => {
          const key = (item.identifier || item.id).toUpperCase();
          if (!uniqueAttrsMap.has(key) || item.identifier) {
            uniqueAttrsMap.set(key, item);
          }
        });
        setAllAttributes(Array.from(uniqueAttrsMap.values()).sort((a: any, b: any) => {
          const orderA = typeof a.order === 'number' ? a.order : 999;
          const orderB = typeof b.order === 'number' ? b.order : 999;
          if (orderA !== orderB) return orderA - orderB;
          return (a.name || '').localeCompare(b.name || '');
        }));

        setAllOptionGroups(optGroupsData.map(g => denormalizeCompendiumData(g)));
        setAllOptionItems(optItemsData.map(i => denormalizeCompendiumData(i)));
        setTagGroups(tagGroupsData.map((tg: any) => ({
          ...denormalizeCompendiumData(tg),
          classifications: typeof tg.classifications === 'string' ? JSON.parse(tg.classifications) : (tg.classifications || [])
        })));
        setAllTags(allTagsData.map(t => denormalizeCompendiumData(t)));
        setAllFeats(featsData.map((f: any) => {
          const d = denormalizeCompendiumData(f);
          return {
            ...d,
            featType: d.featType ?? d.feat_type,
            featSubtype: d.featSubtype ?? d.feat_subtype,
          };
        }));
      } catch (err) {
        console.error("[ClassEditor] Error loading foundation data:", err);
      }
    };

    loadFoundation();

    if (id) {
      const fetchAllData = async () => {
        setInitialLoading(true);
        const startTime = performance.now();
        try {
          // 1. Fetch Class Data — UNLESS we're in review mode for this
          //    class. In review mode the form is populated from the
          //    proposal's submitted payload (snake_case D1 shape), so
          //    the live row would clobber what the user is reviewing.
          //
          //    Proposal mode also short-circuits to the queued/drafted
          //    payload when the live row hasn't been written yet — this
          //    is the path that catches "just clicked Create on a new
          //    class" (the route navigates to /edit/<newId> but the row
          //    only exists in the in-memory queue).
          let data: any = null;
          if (isReviewingThisClass) {
            data = reviewMode!.proposedPayload;
          } else if (isProposalMode && classDrafts.byId.has(id)) {
            data = classDrafts.byId.get(id) ?? null;
          } else {
            data = await fetchDocument<any>('classes', id);
            // If the live row doesn't exist but we DO have a queued or
            // drafted payload for it, fall back to that. This covers
            // the case where the route reloaded after a queued create
            // and the writer hasn't flushed yet.
            if (!data && isProposalMode && classDrafts.byId.has(id)) {
              data = classDrafts.byId.get(id) ?? null;
            }
          }

          if (data) {
            console.log(`[ClassEditor] Class data loaded: ${data.name}`);
            
            // Use standard denormalization
            const remapped = denormalizeCompendiumData(data);
            
            // Ensure hitDie is a number for the editor
            remapped.hitDie = Number(remapped.hitDie || 8);
            
            // Handle some fields that might need specific defaults for the editor
            if (!remapped.asiLevels) remapped.asiLevels = [4, 8, 12, 16, 19];
            if (!remapped.subclassFeatureLevels) remapped.subclassFeatureLevels = [];
            if (!remapped.subclassTitle) remapped.subclassTitle = 'Subclass';

            setName(remapped.name || '');
            setPreview(remapped.preview || '');
            setDescription(remapped.description || '');
            setLore(remapped.lore || '');
            setSourceId(remapped.sourceId || '');
            setCategory(remapped.category || 'core');
            setHitDie(remapped.hitDie);
            
            const loadedSavingThrows = (remapped.savingThrows || []).map((s: string) => s.toUpperCase());
            setSavingThrows(loadedSavingThrows);
            
            const rawProf = remapped.proficiencies || {};
            setProficiencies(sanitizeProficiencyCollection({
              armor: typeof rawProf.armor === 'object' && !Array.isArray(rawProf.armor)
                ? {
                  choiceCount: rawProf.armor.choiceCount || 0,
                  optionIds: rawProf.armor.optionIds || [],
                  fixedIds: rawProf.armor.fixedIds || rawProf.armorIds || [],
                  categoryIds: rawProf.armor.categoryIds || []
                }
                : { choiceCount: 0, optionIds: [], fixedIds: rawProf.armorIds || [], categoryIds: [] },
              weapons: typeof rawProf.weapons === 'object' && !Array.isArray(rawProf.weapons)
                ? {
                  choiceCount: rawProf.weapons.choiceCount || 0,
                  optionIds: rawProf.weapons.optionIds || [],
                  fixedIds: rawProf.weapons.fixedIds || rawProf.weaponIds || [],
                  categoryIds: rawProf.weapons.categoryIds || []
                }
                : { choiceCount: 0, optionIds: [], fixedIds: rawProf.weaponIds || [], categoryIds: [] },
              tools: {
                choiceCount: (rawProf.tools || {}).choiceCount || 0,
                optionIds: (rawProf.tools || {}).optionIds || [],
                fixedIds: (rawProf.tools || {}).fixedIds || [],
                categoryIds: (rawProf.tools || {}).categoryIds || []
              },
              skills: {
                choiceCount: (rawProf.skills || {}).choiceCount || 0,
                optionIds: (rawProf.skills || {}).optionIds || [],
                fixedIds: (rawProf.skills || {}).fixedIds || []
              },
              savingThrows: {
                choiceCount: (rawProf.savingThrows || {}).choiceCount || 0,
                optionIds: ((rawProf.savingThrows || {}).optionIds || []).map((s: string) => s.toUpperCase()),
                fixedIds: ((rawProf.savingThrows || {}).fixedIds || loadedSavingThrows).map((s: string) => s.toUpperCase())
              },
              languages: typeof remapped.proficiencies?.languages === 'object' && !Array.isArray(remapped.proficiencies.languages)
                ? {
                  choiceCount: remapped.proficiencies.languages.choiceCount || 0,
                  optionIds: remapped.proficiencies.languages.optionIds || [],
                  fixedIds: remapped.proficiencies.languages.fixedIds || [],
                  categoryIds: remapped.proficiencies.languages.categoryIds || []
                }
                : {
                  choiceCount: 0,
                  optionIds: [],
                  fixedIds: (typeof remapped.proficiencies?.languages === 'string' ? remapped.proficiencies.languages.split(',').map((s: string) => s.trim()).filter(Boolean) : remapped.proficiencies?.languages?.fixedIds) || [],
                  categoryIds: []
                },
              armorDisplayName: rawProf.armorDisplayName || '',
              weaponsDisplayName: rawProf.weaponsDisplayName || '',
              toolsDisplayName: rawProf.toolsDisplayName || '',
              skillsDisplayName: rawProf.skillsDisplayName || ''
            }));

            setStartingEquipment(remapped.startingEquipment);
            setPrimaryAbility(normalizePrimaryAbilityListForEditor(remapped.primaryAbility));
            setPrimaryAbilityChoice(normalizePrimaryAbilityListForEditor(remapped.primaryAbilityChoice));
            setWealth(remapped.wealth || '');
            setImageUrl(remapped.imageUrl);
            setImageDisplay(remapped.imageDisplay || (data.imageFocalPoint ? { ...data.imageFocalPoint, scale: 1 } : DEFAULT_DISPLAY));
            setCardImageUrl(remapped.cardImageUrl);
            setCardDisplay(remapped.cardDisplay || (data.cardFocalPoint ? { ...data.cardFocalPoint, scale: 1 } : DEFAULT_DISPLAY));
            setPreviewImageUrl(remapped.previewImageUrl);
            setPreviewDisplay(remapped.previewDisplay || (data.previewFocalPoint ? { ...data.previewFocalPoint, scale: 1 } : DEFAULT_DISPLAY));
            setMulticlassing(remapped.multiclassing || '');
            
            const rawMultiProf = remapped.multiclassProficiencies || {};
            setMulticlassProficiencies(sanitizeProficiencyCollection({
              armor: typeof rawMultiProf.armor === 'object' && !Array.isArray(rawMultiProf.armor)
                ? {
                  choiceCount: rawMultiProf.armor.choiceCount || 0,
                  optionIds: rawMultiProf.armor.optionIds || [],
                  fixedIds: rawMultiProf.armor.fixedIds || [],
                  categoryIds: rawMultiProf.armor.categoryIds || []
                }
                : { choiceCount: 0, optionIds: [], fixedIds: [], categoryIds: [] },
              weapons: typeof rawMultiProf.weapons === 'object' && !Array.isArray(rawMultiProf.weapons)
                ? {
                  choiceCount: rawMultiProf.weapons.choiceCount || 0,
                  optionIds: rawMultiProf.weapons.optionIds || [],
                  fixedIds: rawMultiProf.weapons.fixedIds || [],
                  categoryIds: rawMultiProf.weapons.categoryIds || []
                }
                : { choiceCount: 0, optionIds: [], fixedIds: [], categoryIds: [] },
              tools: {
                choiceCount: (rawMultiProf.tools || {}).choiceCount || 0,
                optionIds: (rawMultiProf.tools || {}).optionIds || [],
                fixedIds: (rawMultiProf.tools || {}).fixedIds || [],
                categoryIds: (rawMultiProf.tools || {}).categoryIds || []
              },
              skills: {
                choiceCount: (rawMultiProf.skills || {}).choiceCount || 0,
                optionIds: (rawMultiProf.skills || {}).optionIds || [],
                fixedIds: (rawMultiProf.skills || {}).fixedIds || []
              },
              savingThrows: {
                choiceCount: (rawMultiProf.savingThrows || {}).choiceCount || 0,
                optionIds: ((rawMultiProf.savingThrows || {}).optionIds || []).map((s: string) => s.toUpperCase()),
                fixedIds: ((rawMultiProf.savingThrows || {}).fixedIds || []).map((s: string) => s.toUpperCase())
              },
              languages: typeof rawMultiProf.languages === 'object' && !Array.isArray(rawMultiProf.languages)
                ? {
                  choiceCount: rawMultiProf.languages.choiceCount || 0,
                  optionIds: rawMultiProf.languages.optionIds || [],
                  fixedIds: rawMultiProf.languages.fixedIds || [],
                  categoryIds: rawMultiProf.languages.categoryIds || []
                }
                : { choiceCount: 0, optionIds: [], fixedIds: [], categoryIds: [] },
              armorDisplayName: rawMultiProf.armorDisplayName || '',
              weaponsDisplayName: rawMultiProf.weaponsDisplayName || '',
              toolsDisplayName: rawMultiProf.toolsDisplayName || '',
              skillsDisplayName: rawMultiProf.skillsDisplayName || ''
            }));

            const loadedSpellcasting = normalizeClassSpellcastingForEditor(remapped.spellcasting);
            setSpellcasting(loadedSpellcasting);
            setTagIds(remapped.tagIds);
            setAdvancements(normalizeEditorAdvancements(remapped.advancements, 1, remapped.hitDie || hitDie));
            setSubclassTitle(remapped.subclassTitle);
            setSubclassFeatureLevels(remapped.subclassFeatureLevels);
            setLevelsInput(remapped.subclassFeatureLevels.join(', '));
            setAsiLevels(remapped.asiLevels);
            setAsiLevelsInput(remapped.asiLevels.join(', '));
            // Note: features / scaling_columns / subclasses are loaded by the
            // dedicated dependents effect below so a save/delete can refresh
            // just those without re-running the foundation + class-info fetch.
          } else {
            console.warn(`[ClassEditor] Class document ${id} does not exist.`);
          }
        } catch (error) {
          console.error("[ClassEditor] Error fetching data:", error);
          toast.error("Failed to load class data.");
        } finally {
          setInitialLoading(false);
          console.log(`[ClassEditor] Load complete in ${(performance.now() - startTime).toFixed(2)}ms`);
        }
      };
      fetchAllData();

      return () => {
        console.log(`[ClassEditor] Cleaning up ID: ${id}`);
      };
    } else {
      setInitialLoading(false); // No ID, so nothing to load
    }
  }, [id]);

  // Dependent collections — features, scaling columns, subclasses for this class.
  // Bumping `loadTick` (after a feature/scaling save or delete) re-runs only
  // this effect, leaving the foundation/taxonomy + class-info caches alone.
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const [featuresData, scalingData, subData] = await Promise.all([
          fetchCollection<any>('features', {
            where: 'parent_id = ? AND parent_type = ?',
            params: [id, 'class'],
            orderBy: 'level ASC',
          }).catch(err => { console.error("[ClassEditor] Features load failed:", err); return []; }),
          fetchCollection<any>('scaling_columns', {
            where: 'parent_id = ? AND parent_type = ?',
            params: [id, 'class'],
            orderBy: 'name ASC',
          }).catch(err => { console.error("[ClassEditor] Scaling load failed:", err); return []; }),
          fetchCollection<any>('subclasses', {
            where: 'class_id = ?',
            params: [id],
            orderBy: 'name ASC',
          }).catch(err => { console.error("[ClassEditor] Subclasses load failed:", err); return []; }),
        ]);
        if (cancelled) return;
        setFeatures(featuresData.map(row => normalizeFeatureForEditor(denormalizeCompendiumData(row))));
        setScalingColumns(scalingData.map(s => denormalizeCompendiumData(s)));
        setSubclasses(subData.map(sub => denormalizeCompendiumData(sub)));
      } catch (err) {
        console.error("[ClassEditor] Dependents load failed:", err);
      }
    })();
    return () => { cancelled = true; };
  }, [id, loadTick]);

  useEffect(() => {
    if (allArmor.length === 0 && allWeapons.length === 0) return;

    // Only legacy-format rows (armor/weapons stored as a raw string) need the
    // string -> structured-selection conversion. Modern rows are already
    // objects, so this is a no-op for them (no setState, no re-baseline).
    const isArmorLegacyStr = typeof proficiencies.armor === 'string';
    const isWeaponLegacyStr = typeof proficiencies.weapons === 'string';
    if (!isArmorLegacyStr && !isWeaponLegacyStr) return;

    setProficiencies((prev: any) => ({
      ...prev,
      armor: typeof prev.armor === 'string'
        ? { choiceCount: 0, optionIds: [], fixedIds: resolveLegacyProficiencyIds(prev.armor as string, allArmor) }
        : prev.armor,
      weapons: typeof prev.weapons === 'string'
        ? { choiceCount: 0, optionIds: [], fixedIds: resolveLegacyProficiencyIds(prev.weapons as string, allWeapons) }
        : prev.weapons
    }));

    // This conversion is a programmatic normalization, NOT a user edit. The
    // saved-state baseline (initialDataHash) is captured the moment the class
    // finishes loading — BEFORE this effect runs (it waits on allArmor/allWeapons,
    // which load on a separate track) — so it froze the legacy *string* shape.
    // Comparing that against the converted *object* shape made isDirty report
    // phantom "unsaved changes" on an untouched class, firing the leave-page
    // guard. Invalidate the baseline so it re-captures the converted shape on the
    // next commit; a genuine edit afterwards still flips isDirty.
    setInitialDataHash('');
  }, [allArmor, allWeapons, proficiencies]);

  const handleSaveFeature = async (e: React.FormEvent) => {
    e.preventDefault();
    // effectiveId, not id: a class created in a block carries its minted id
    // here even though useParams.id is still null on the /new route, so features
    // can be authored without a reload (reload-gap fix).
    if (!effectiveId) return;

    try {
      let parsedActivities = {};
      try {
        if (editingFeature.activitiesStr) parsedActivities = JSON.parse(editingFeature.activitiesStr);
      } catch (err) {
        toast.error("Invalid JSON in Activities");
        return;
      }

      const featureData: any = {
        ...editingFeature,
        parentId: effectiveId,
        parentType: 'class',
        advancements: normalizeEditorAdvancements(editingFeature.advancements || [], Number(editingFeature.level || 1) || 1),
        identifier: editingFeature.identifier || slugify(editingFeature.name || ''),
        requirements: editingFeature.requirements || '',
        sourceId: editingFeature.sourceId || '',
        source: {
          custom: editingFeature.source?.custom || '',
          book: editingFeature.source?.book || '',
          page: editingFeature.source?.page || '',
          license: editingFeature.source?.license || '',
          rules: editingFeature.source?.rules || '',
          revision: Number(editingFeature.source?.revision || 1) || 1
        },
        subtype: editingFeature.subtype || '',
        prerequisites: {
          level: editingFeature.prerequisites?.level ? Number(editingFeature.prerequisites.level) : null,
          items: (editingFeature.prerequisites?.items || []).map((item: string) => String(item || '').trim()).filter(Boolean),
          repeatable: !!editingFeature.prerequisites?.repeatable
        },
        properties: normalizeFeaturePropertiesForEditor(editingFeature.properties || []),
        uses: {
          spent: Number(editingFeature.uses?.spent || 0) || 0,
          max: editingFeature.uses?.max || '',
          recovery: Array.isArray(editingFeature.uses?.recovery) ? editingFeature.uses.recovery : []
        },
        usage: {
          spent: Number(editingFeature.uses?.spent || 0) || 0,
          max: editingFeature.uses?.max || '',
          recovery: Array.isArray(editingFeature.uses?.recovery) ? editingFeature.uses.recovery : []
        },
        configuration: {
          ...editingFeature.configuration,
          requiredLevel: editingFeature.prerequisites?.level ? Number(editingFeature.prerequisites.level) : (Number(editingFeature.level || 1) || 1),
          requiredIds: (editingFeature.prerequisites?.items || []).map((item: string) => String(item || '').trim()).filter(Boolean),
          repeatable: !!editingFeature.prerequisites?.repeatable
        },
        quantityColumnId: editingFeature.quantityColumnId || '',
        scalingColumnId: editingFeature.scalingColumnId || '',
        automation: {
          activities: Array.isArray(editingFeature.activities)
            ? editingFeature.activities
            : Object.values(editingFeature.activities || {}),
          effects: Array.isArray(editingFeature.effects) ? editingFeature.effects : []
        },
        updatedAt: new Date().toISOString()
      };

      delete featureData.activitiesStr;
      delete featureData.effects;
      delete featureData.activities;
      delete featureData.__usesRecoveryDraft;

      // A new feature is pre-minted an id at modal-open ("Add Feature"), so
      // `!editingFeature.id` is never true. Decide create-vs-update by whether
      // the feature is a LIVE row: anything not live (brand-new, or a same-block
      // draft) is a CREATE — the accumulator folds repeat creates / patches the
      // existing draft. Queuing an UPDATE for a feature with no live row 404s
      // ("Cannot propose update on missing feature") at flush time.
      const isCreate = !features.some((f: any) => String(f.id) === String(editingFeature.id));
      const saveId = editingFeature.id || crypto.randomUUID();
      const featurePayload = normalizeFeatureData({
        ...featureData,
        createdAt: editingFeature.createdAt || new Date().toISOString(),
      });
      if (isCreate) {
        await featureWriter.create({ ...featurePayload, id: saveId });
      } else {
        await featureWriter.update(saveId, featurePayload);
      }
      // Rebake only on a real (admin-direct) write — proposal/block changes
      // don't touch live data until approval, which fires the rebake itself.
      if (featureWriter.mode === 'direct') queueRebake('feature', saveId);
      toast.success(actionLabel(featureWriter.mode, isCreate ? 'created' : 'updated'));
      setIsFeatureModalOpen(false);
      setEditingFeature(null);
      // Re-fetch features to show changes
      setLoadTick(t => t + 1);
    } catch (error) {
      console.error("Error saving feature:", error);
      toast.error('Error saving feature');
    }
  };

  const handleDeleteFeature = async (featureId: string) => {
    try {
      await featureWriter.remove(featureId);
      toast.success(actionLabel(featureWriter.mode, 'deleted'));
      setLoadTick(t => t + 1);
    } catch (error) {
      console.error("Error deleting feature:", error);
      toast.error('Failed to delete feature');
    }
  };

  // Reentrancy guard. If a pre-flush callback fires handleSave({silent:true})
  // while an outer handleSave is still mid-execution, we'd run the heavy
  // normalization pipeline twice in nested fashion — wasteful at best,
  // a debugging nightmare if any state-setter inside the inner call
  // triggers a re-render that cascades. Short-circuit the re-entry.
  // (The wrapper's `submitting` state + applyProposalWrite's silent gate
  // already prevent the *common* case; this is belt-and-braces for
  // anything that slips through.)
  const handleSaveInFlight = useRef(false);

  const handleSave = async (e?: React.FormEvent, opts: { silent?: boolean } = {}) => {
    if (e) {
      e.preventDefault();
    }
    if (handleSaveInFlight.current) {
      console.warn('[ClassEditor] handleSave called while already in flight — skipping recursive entry.');
      return;
    }
    handleSaveInFlight.current = true;
    if (!opts.silent) setLoading(true);
    if (!opts.silent) {
      console.log('[ClassEditor] handleSave start', { effectiveId, isProposalMode, isCreate: !effectiveId });
    }

    try {
      const normalizedProficiencies = sanitizeProficiencyCollection({
        ...proficiencies,
        armorDisplayName: proficiencies.armorDisplayName || buildGroupedProficiencyDisplayName(proficiencies.armor, allArmor, allArmorCategories),
        weaponsDisplayName: proficiencies.weaponsDisplayName || buildGroupedProficiencyDisplayName(proficiencies.weapons, allWeapons, allWeaponCategories),
        toolsDisplayName: proficiencies.toolsDisplayName || buildGroupedProficiencyDisplayName(proficiencies.tools, allTools, allToolCategories),
        // Skills have no categories — pass [] so the helper composes the
        // display string from the selected skill items alone.
        skillsDisplayName: proficiencies.skillsDisplayName || buildGroupedProficiencyDisplayName(proficiencies.skills, allSkills, [])
      });
      const normalizedMulticlassProficiencies = sanitizeProficiencyCollection({
        ...multiclassProficiencies,
        armorDisplayName: multiclassProficiencies.armorDisplayName || buildGroupedProficiencyDisplayName(multiclassProficiencies.armor, allArmor, allArmorCategories),
        weaponsDisplayName: multiclassProficiencies.weaponsDisplayName || buildGroupedProficiencyDisplayName(multiclassProficiencies.weapons, allWeapons, allWeaponCategories),
        toolsDisplayName: multiclassProficiencies.toolsDisplayName || buildGroupedProficiencyDisplayName(multiclassProficiencies.tools, allTools, allToolCategories),
        // Skills have no categories — pass [] so the helper composes the
        // display string from the selected skill items alone.
        skillsDisplayName: multiclassProficiencies.skillsDisplayName || buildGroupedProficiencyDisplayName(multiclassProficiencies.skills, allSkills, [])
      });
      const syncedAdvancements = buildCanonicalBaseClassAdvancements({
        advancements,
        hitDie,
        proficiencies: normalizedProficiencies,
        savingThrows,
        subclassTitle,
        subclassFeatureLevels,
        asiLevels
      });
      const normalizedSyncedAdvancements = normalizeEditorAdvancements(syncedAdvancements, 1, hitDie);
      const normalizedSpellcasting = normalizeClassSpellcastingForSave(spellcasting);

      const normalizedPrimaryAbility = normalizePrimaryAbilityListForSave(primaryAbility);
      const normalizedPrimaryAbilityChoice = normalizePrimaryAbilityListForSave(primaryAbilityChoice);
      const classData = {
        name,
        identifier: slugify(name),
        preview,
        description,
        lore,
        sourceId,
        category,
        hitDie,
        savingThrows: normalizedProficiencies.savingThrows?.fixedIds || [],
        proficiencies: normalizedProficiencies,
        startingEquipment,
        primaryAbility: normalizedPrimaryAbility,
        primaryAbilityChoice: normalizedPrimaryAbilityChoice,
        wealth,
        multiclassing,
        multiclassProficiencies: normalizedMulticlassProficiencies,
        excludedOptionIds,
        tagIds,
        subclassTitle,
        subclassFeatureLevels,
        asiLevels,
        advancements: normalizedSyncedAdvancements,
        imageUrl,
        imageDisplay,
        cardImageUrl,
        cardDisplay,
        previewImageUrl,
        previewDisplay,
        updatedAt: new Date().toISOString()
      };

      // effectiveId carries forward the locally-minted id from a prior
      // proposal-mode CREATE so subsequent saves update that same
      // queued entry rather than minting new ones. Falls back to a
      // fresh UUID for the first save when no id exists yet.
      const saveId = effectiveId || crypto.randomUUID();
      const d1Data = {
        name: classData.name,
        identifier: classData.identifier,
        preview: classData.preview,
        description: classData.description,
        lore: classData.lore,
        source_id: classData.sourceId,
        category: classData.category,
        hit_die: classData.hitDie,
        saving_throws: classData.savingThrows,
        proficiencies: classData.proficiencies,
        starting_equipment: classData.startingEquipment,
        primary_ability: classData.primaryAbility,
        primary_ability_choice: classData.primaryAbilityChoice,
        wealth: classData.wealth,
        multiclassing: classData.multiclassing,
        multiclass_proficiencies: classData.multiclassProficiencies,
        excluded_option_ids: classData.excludedOptionIds,
        tag_ids: classData.tagIds,
        subclass_title: classData.subclassTitle,
        subclass_feature_levels: classData.subclassFeatureLevels,
        asi_levels: classData.asiLevels,
        advancements: classData.advancements,
        image_url: classData.imageUrl,
        image_display: classData.imageDisplay,
        card_image_url: classData.cardImageUrl,
        card_display: classData.cardDisplay,
        preview_image_url: classData.previewImageUrl,
        preview_display: classData.previewDisplay,
        spellcasting: normalizedSpellcasting,
        updated_at: classData.updatedAt
      };

      if (isProposalMode) {
        // Proposal route — drop server-managed columns the proposal
        // endpoint also strips, queue via the writer. Rebake is
        // skipped (the live class hasn't changed yet); it'll fire on
        // admin approval through the existing direct-write path.
        //
        // effectiveId picks up `pendingCreateId` after the first save
        // so a follow-up edit on the same /new page routes through
        // UPDATE instead of CREATE. Only the initial save (no id from
        // useParams AND no pendingCreateId yet) takes the create
        // branch.
        const { updated_at: _droppedUpdatedAt, ...proposalPayload } = d1Data;
        const isCreate = !effectiveId;
        if (!opts.silent) {
          console.log('[ClassEditor] proposal-mode save → applyProposalWrite', {
            saveId, isCreate, hasSubmitNow: !!proposalContext?.submitNow,
          });
        }
        await applyProposalWrite(classWriter, proposalPayload, {
          id: saveId,
          isCreate,
          silent: opts.silent,
          submitNow: proposalContext?.submitNow,
        });
        if (!opts.silent) {
          console.log('[ClassEditor] applyProposalWrite returned', { saveId, isCreate });
        }
        if (isCreate) recordCreate(saveId);
      } else {
        await upsertDocument('classes', saveId, d1Data);
        // Schedule a debounced R2 rebake for this class. Consecutive
        // saves reset the 1h clock; manual "Bake Now" bypasses the wait.
        queueRebake('class', saveId);
        if (!opts.silent) toast.success('Class saved successfully!');
      }

      // Skip the post-create navigate when the wrapper invoked us
      // through pre-flush — navigating during flush would unmount the
      // wrapper mid-drain.
      //
      // In proposal mode we also stay on the /new route after the
      // queued create. Navigating to /edit/<id> would remount the
      // wrapper, destroying the in-memory queue we just added the
      // create to — the form would then reload empty from a live row
      // that doesn't exist yet. Subsequent saves on this page still
      // recognize the entity as new (no `id` from useParams), so the
      // pre-flush + auto-stage paths queue an update for `saveId`
      // through the dedup logic in `postQueuedChanges`. The route
      // catches up on the next page load via `classDrafts.byId.get(id)`
      // once the draft persists server-side.
      if (!id && !opts.silent && !isProposalMode) {
        // Admin route uses the `<identifier>_<sourceAbbrev>` slug now;
        // fall back to the primary key only if the row somehow has no
        // identifier (shouldn't happen — `slugify(name)` produces one
        // for any non-empty name).
        const savedSource = sources.find((s: any) => s.id === sourceId);
        const savedAbbrev = savedSource?.abbreviation || savedSource?.shortName;
        const newSlug = buildClassSlug({ identifier: slugify(name) }, savedAbbrev);
        navigate(`${basePath}/edit/${newSlug ?? saveId}`);
      }
      setProficiencies(normalizedProficiencies);
      setMulticlassProficiencies(normalizedMulticlassProficiencies);
      setAdvancements(normalizedSyncedAdvancements);
      setLastSavedTick(Date.now());
    } catch (error) {
      console.error("Error saving class:", error);
      if (!opts.silent) toast.error('Failed to save class.');
      else throw error;
    } finally {
      if (!opts.silent) setLoading(false);
      handleSaveInFlight.current = false;
      if (!opts.silent) {
        console.log('[ClassEditor] handleSave done');
      }
    }
  };

  // Pre-flush: stage the currently-edited class into the queue right
  // before Submit Changes drains. Single-work gate is `effectiveId`
  // (an in-progress create OR an existing edit — both need staging).
  useProposalPreFlushSave({
    enabled: isProposalMode,
    proposalContext,
    handleSave,
    shouldRun: () => !!effectiveId,
  });

  const handleInitializeBaseAdvancements = () => {
    const normalizedProficiencies = sanitizeProficiencyCollection(proficiencies);
    const syncedAdvancements = buildCanonicalBaseClassAdvancements({
      advancements,
      hitDie,
      proficiencies: normalizedProficiencies,
      savingThrows,
      subclassTitle,
      subclassFeatureLevels,
      asiLevels
    });
    const normalizedSyncedAdvancements = normalizeEditorAdvancements(syncedAdvancements, 1, hitDie);

    if (JSON.stringify(advancements) === JSON.stringify(normalizedSyncedAdvancements)) {
      toast.info('All base advancements are already present and up to date');
      return;
    }

    const added = normalizedSyncedAdvancements.filter((adv) => adv.isBase && !advancements.some((existing) => existing._id === adv._id)).length;
    const updated = normalizedSyncedAdvancements.filter((adv) => adv.isBase && advancements.some((existing) => existing._id === adv._id)).length;
    setAdvancements(normalizedSyncedAdvancements);
    toast.success(`Advancements synced: ${added} added, ${updated} updated.`);
  };

  const groupedArmor = (allArmor || []).reduce((acc, item) => {
    const cat = allArmorCategories.find(c => c.id === item.categoryId)?.name || item.category || 'Other';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(item);
    return acc;
  }, {} as Record<string, any[]>);

  const groupedWeapons = (allWeapons || []).reduce((acc, item) => {
    let cat = allWeaponCategories.find(c => c.id === item.categoryId)?.name || item.category || 'Other';
    if (item.weaponType) {
      cat = cat.replace(/ Weapons?/i, '');
      cat += ` ${item.weaponType}`;
    }
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(item);
    return acc;
  }, {} as Record<string, any[]>);

  const groupedTools = (allTools || []).reduce((acc, item) => {
    const cat = allToolCategories.find(c => c.id === item.categoryId)?.name || 'Other';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(item);
    return acc;
  }, {} as Record<string, any[]>);

  const groupedLanguages = (allLanguages || []).reduce((acc, item) => {
    const cat = allLanguageCategories.find(c => c.id === item.categoryId)?.name || 'Other';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(item);
    return acc;
  }, {} as Record<string, any[]>);
  const selectedSpellcastingType = spellcastingTypes.find((type) => type.id === spellcasting.progressionId);
  // Memoized so AdvancementManager's `referenceContext` prop is a stable ref —
  // recomputes only when the bits it derives from change, not on every keystroke.
  const classReferenceContext = useMemo(() => ({
    classIdentifier: getClassReferenceIdentifier(sourceId, name),
    classLabel: name || 'Class',
    spellcastingAbility: spellcasting.ability,
    classColumns: scalingColumns.map((column: any) => ({
      name: column.name,
      identifier: column.identifier,
      sourceId: column.sourceId,
      parentType: 'class',
    })),
  }), [sourceId, name, spellcasting.ability, scalingColumns]);
  const spellFormulaShortcuts = useMemo(() => buildSpellFormulaShortcutRows(classReferenceContext), [classReferenceContext]);

  if (slugLoading || initialLoading) {
    return (
      <div className="max-w-6xl mx-auto py-20 text-center space-y-4">
        <div className="font-serif italic text-gold animate-pulse">Consulting the archives...</div>
        <Button variant="ghost" size="sm" onClick={() => navigate(isProposalRoute ? '/my-proposals' : '/compendium/classes')} className="text-ink/40">
          <ChevronLeft className="w-4 h-4 mr-2" /> {isProposalRoute ? 'Back to My Proposals' : 'Return to Compendium'}
        </Button>
      </div>
    );
  }
  if (slugNotFound) {
    return (
      <div className="max-w-6xl mx-auto py-20 text-center space-y-4">
        <div className="font-serif italic text-ink/60">No class matches the slug "{slug}".</div>
        <Button variant="ghost" size="sm" onClick={() => navigate(isProposalRoute ? '/my-proposals' : '/compendium/classes')} className="text-ink/40">
          <ChevronLeft className="w-4 h-4 mr-2" /> {isProposalRoute ? 'Back to My Proposals' : 'Return to Compendium'}
        </Button>
      </div>
    );
  }

  // When the editor is mounted INSIDE a ProposalEditorWrapper, the
  // wrapper already renders the ReviewBanner + the fieldset-disable
  // overlay. Avoid double-render by only emitting them here on the
  // admin direct route (/compendium/classes/edit/:id), where the
  // wrapper isn't mounted.
  const showLocalReviewChrome = isReviewingThisClass && !proposalContext;
  return (
    <fieldset
      disabled={(showLocalReviewChrome && reviewIsReadOnly) || isClassPendingDelete}
      className="max-w-6xl mx-auto space-y-6 pb-20 border-0 p-0 m-0 disabled:opacity-95"
    >
      {showLocalReviewChrome && <ReviewBanner />}
      {isClassPendingDelete && (
        <DeletedEntityBanner
          entityLabel="Class"
          name={name || 'this class'}
          onUndo={undoClassDelete}
        />
      )}
      {cascadeDep && (
        <CascadeDependentBanner
          description={cascadeDep.description}
          resolved={cascadeDep.resolved}
          onAccept={cascadeDep.accept}
          onReopen={cascadeDep.reopen}
          onReplace={() => setReplaceTagPickerOpen(true)}
        />
      )}
      <ProposalAwareEditorHeader
        isProposalMode={isProposalMode}
        backHref={
          // A class is a TOP-LEVEL block entity (like a unique option
          // group, unlike a subclass which nests under its parent class),
          // so in ANY proposal/block context — whether that's signalled by
          // the writer mode (`isProposalMode`) or the `/proposals/edit/*`
          // URL (`isProposalRoute`) — Back returns to the proposal
          // dashboard. Previously the existing-class branch sent you to the
          // class LIST (`/proposals/edit/classes`), and a block-mode writer
          // on a non-proposal URL fell through to the literal class VIEW
          // (`/compendium/classes/view/:slug`) — both flagged as wrong.
          // Admin direct edits (no proposal context) still land on the
          // class view / catalog list.
          (isReviewingThisClass || isProposalMode || isProposalRoute)
            ? '/my-proposals'
            : (slug ? `/compendium/classes/view/${slug}` : '/compendium/classes')
        }
        proposalTitle={effectiveId ? (name || 'Untitled Class') : 'New Class'}
        adminContent={
          <h1 className="h1-title text-ink">
            {effectiveId ? `Edit ${name || 'Class'}` : 'New Class'}
          </h1>
        }
      >
        <div className="flex flex-col items-stretch gap-2 sm:items-end">
          <div className="flex items-center gap-2">
            {/* Save Class is only shown when there's no global Submit
                Changes covering it: admin direct route always, AND the
                proposal route's create flow (where the explicit click
                navigates to /edit/:newId after queueing). Existing
                classes in proposal mode use the wrapper's Submit Changes
                via the pre-flush hook. Reviewing a read-only past
                submission hides this entirely. */}
            {(!isProposalMode || !effectiveId) && !reviewIsReadOnly && (
              <Button onClick={handleSave} disabled={loading} size="sm" className="btn-gold-solid gap-2">
                <Save className="w-4 h-4" /> {effectiveId ? 'Save Class' : 'Create Class'}
              </Button>
            )}
            {/* BakeNow is admin-only — it fires the R2 bundle bake which
                requires direct write access. */}
            {!isProposalMode && (
              <BakeNowButton
                kind="class"
                id={id}
                isDirty={isDirty}
                onSaveFirst={handleSave}
                size="sm"
                className="gap-2"
              />
            )}
          </div>
          <ReferenceSheetDialog
            title="Class Reference Sheet"
            triggerLabel="Open Reference Sheet"
            triggerIcon="scroll"
            triggerClassName="w-full sm:w-auto"
            context={classReferenceContext}
          />
        </div>
      </ProposalAwareEditorHeader>

      <div className="grid lg:grid-cols-4 gap-6">
        <div className="lg:col-span-3">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="w-full h-auto flex flex-col gap-1 bg-transparent border-none p-0 mb-6">
              <div className="w-full grid grid-cols-2 lg:grid-cols-5 gap-1 bg-card/50 border border-gold/10 p-1 rounded-md">
                <TabsTrigger value="basic">Basic Info</TabsTrigger>
                <TabsTrigger value="proficiencies">Proficiencies</TabsTrigger>
                {/* Gate on effectiveId, not id, so the tab unlocks after
                    Create Class even in proposal mode (where the route
                    stays on /new and only pendingCreateId is set — see
                    useProposalSingleWorkId for the convention). Pre-fix
                    behaviour: admin route unlocked instantly (post-save
                    navigate updated useParams.id); proposal route stayed
                    locked until a manual refresh. */}
                <TabsTrigger value="features" disabled={!effectiveId}>Class Features</TabsTrigger>
                <TabsTrigger value="spellcasting">Spellcasting</TabsTrigger>
                <TabsTrigger value="subclasses" disabled={!effectiveId}>Subclasses</TabsTrigger>
              </div>
              <div className="w-full grid grid-cols-2 lg:grid-cols-6 gap-1 bg-card/50 border border-gold/10 p-1 rounded-md">
                <TabsTrigger value="equipment">Equipment</TabsTrigger>
                <TabsTrigger value="multiclassing">Multiclassing</TabsTrigger>
                <TabsTrigger value="multiclass-proficiencies">Multiclass Profs</TabsTrigger>
                <TabsTrigger value="tags">Tags</TabsTrigger>
                <TabsTrigger value="progression">Progression</TabsTrigger>
                {!isProposalMode && (
                  <TabsTrigger value="danger" disabled={!id}>Danger Zone</TabsTrigger>
                )}
              </div>
            </TabsList>

            <TabsContent value="basic" className="space-y-6 mt-0">
              {/* Basic Info */}
              <div className="p-4 border border-gold/20 bg-card/50 space-y-4">
                <h2 className="label-text text-gold border-b border-gold/10 pb-2">Basic Information</h2>
                <div className="flex flex-col md:flex-row gap-6">
                  {/* Left: image set (default image + framable Detail/Card/Preview windows) */}
                  <div className="w-full md:w-1/3">
                    <ImageSetEditor
                      label="Class Icon / Artwork"
                      baseImage={imageUrl}
                      onBaseImageChange={setImageUrl}
                      storagePath={`images/classes/${id || 'new'}/`}
                      systemImages
                      controlsOnTop
                      windows={[
                        {
                          key: 'detail', base: true,
                          label: 'Detail View', subtitle: 'ClassView page',
                          aspectClass: 'aspect-square',
                          display: imageDisplay, onDisplayChange: setImageDisplay,
                        },
                        {
                          key: 'card',
                          label: 'Card View', subtitle: 'ClassList grid',
                          aspectClass: 'aspect-[4/5]',
                          imageUrl: cardImageUrl, onImageUrlChange: setCardImageUrl,
                          display: cardDisplay, onDisplayChange: setCardDisplay,
                          overlay: (
                            <>
                              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-transparent opacity-80" />
                              <div className="absolute inset-x-0 bottom-0 p-2 text-center z-10">
                                <span className="text-[9px] font-black uppercase text-gold tracking-widest drop-shadow-sm">Class Name</span>
                              </div>
                            </>
                          ),
                        },
                        {
                          key: 'preview',
                          label: 'Preview Header', subtitle: 'Quick-view panel',
                          aspectClass: 'aspect-[3/1]',
                          imageUrl: previewImageUrl, onImageUrlChange: setPreviewImageUrl,
                          display: previewDisplay, onDisplayChange: setPreviewDisplay,
                          overlay: (
                            <>
                              <div className="absolute inset-0 bg-gradient-to-t from-background to-background/20" />
                              <div className="absolute inset-0 opacity-30 bg-black" />
                              <div className="absolute inset-x-0 bottom-0 p-2 pl-3 z-10">
                                <span className="text-[9px] font-black uppercase text-gold tracking-widest drop-shadow-sm">Class Name</span>
                              </div>
                            </>
                          ),
                        },
                      ]}
                    />
                  </div>

                  {/* Right: fields */}
                  <div className="flex-1 grid sm:grid-cols-2 gap-4 h-fit">
                    <ReviewFieldHighlight columnKey="name" className="space-y-1">
                      <label className="label-text">Class Name</label>
                      <Input
                        value={name}
                        onChange={e => setName(e.target.value)}
                        placeholder="e.g. Fighter"
                        className="h-8 text-sm bg-background/50 border-gold/10 focus:border-gold"
                      />
                    </ReviewFieldHighlight>
                    <ReviewFieldHighlight columnKey="source_id" className="space-y-1">
                      <label className="label-text">Source</label>
                      <select
                        value={sourceId}
                        onChange={e => setSourceId(e.target.value)}
                        className="w-full h-8 px-2 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-sm text-ink"
                      >
                        <option value="">Select a Source</option>
                        {sources.map(s => (
                          <option key={s.id} value={s.id}>{s.name} {s.abbreviation ? `(${s.abbreviation})` : ''}</option>
                        ))}
                      </select>
                    </ReviewFieldHighlight>
                    <ReviewFieldHighlight columnKey="hit_die" className="space-y-1">
                      <label className="label-text">Hit Die</label>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-mono text-gold">d</span>
                        <select
                          value={hitDie}
                          onChange={e => setHitDie(parseInt(e.target.value))}
                          className="flex-1 h-8 px-2 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-sm text-ink"
                        >
                          {[4, 6, 8, 10, 12].map(d => (
                            <option key={d} value={d}>{d}</option>
                          ))}
                        </select>
                      </div>
                    </ReviewFieldHighlight>
                    <ReviewFieldHighlight columnKey="category" className="space-y-1">
                      <label className="label-text">Category</label>
                      <select
                        value={category}
                        onChange={e => setCategory(e.target.value as any)}
                        className="w-full h-8 px-2 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-sm text-ink"
                      >
                        <option value="core">Core Class</option>
                        <option value="alternate">Alternate Class</option>
                        <option value="new">New Class</option>
                      </select>
                    </ReviewFieldHighlight>
                    <div className="space-y-1">
                      <label className="label-text">ASI Levels (csv)</label>
                      <Input
                        value={asiLevelsInput}
                        onChange={e => {
                          setAsiLevelsInput(e.target.value);
                          const parsed = e.target.value.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
                          setAsiLevels(parsed);
                        }}
                        placeholder="4, 8, 12, 16, 19"
                        className="h-8 text-sm bg-background/50 border-gold/10 focus:border-gold font-mono"
                      />
                      <p className="text-[10px] text-ink/40">Used in Populating Base Advancements</p>
                    </div>
                  </div>
                </div>
                <div className="space-y-4">
                  <div className="flex flex-col md:flex-row gap-6 items-start">
                    <div className="flex-1 w-full">
                      <MarkdownEditor
                        value={preview}
                        onChange={setPreview}
                        placeholder="A short flavourful teaser shown on the class card and at the top of the class page..."
                        minHeight="144px"
                        label="Class Preview"
                      />
                    </div>
                    <div className="w-full md:w-[320px] shrink-0 space-y-1">
                      <label className="label-text">Card List Cutoff Preview</label>
                      <div className="relative rounded-lg overflow-hidden border border-gold/20 shadow-lg bg-black/40 h-[320px] flex flex-col justify-end">
                        {/* Simulated Background */}
                        {imageUrl && (
                          <div className="absolute inset-0 z-0">
                            <img src={imageUrl} className="w-full h-full object-cover opacity-50" alt="" />
                            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />
                          </div>
                        )}
                        <div className="relative z-10 p-4 border-t border-gold/20 bg-black/10 backdrop-blur-md h-[45%] flex flex-col items-center text-center">
                          <div className="text-white/80 text-xs italic line-clamp-6 overflow-hidden w-full font-serif leading-relaxed">
                            <Markdown>{preview || description || "No preview description available."}</Markdown>
                          </div>
                        </div>
                      </div>
                      <p className="text-[10px] text-ink/40 leading-tight pt-1">This simulates how the text fits into the class selection cards. If it cuts off with ellipses, shorten it!</p>
                    </div>
                  </div>
                  <ReviewFieldHighlight columnKey="description">
                    <MarkdownEditor
                      value={description}
                      onChange={setDescription}
                      placeholder="A detailed explanation of how the class plays and what it does..."
                      minHeight="100px"
                      label="Class Description"
                    />
                  </ReviewFieldHighlight>
                  <ReviewFieldHighlight columnKey="lore">
                    <MarkdownEditor
                      value={lore}
                      onChange={setLore}
                      placeholder="How this class fits into the setting's lore..."
                      minHeight="100px"
                      label="Class Lore"
                    />
                  </ReviewFieldHighlight>
                </div>
              </div>

            </TabsContent>
            {/* Subclasses */}
            {effectiveId && (
              <TabsContent value="subclasses" className="space-y-6 mt-0">
                <div className="p-4 border border-gold/20 bg-card/50 space-y-4">
                  <div className="section-header">
                    <h2 className="label-text text-gold">Subclasses</h2>
                    <Link to={
                      isProposalRoute
                        ? `/proposals/edit/subclasses/new?classId=${effectiveId}`
                        : `/compendium/subclasses/new?classId=${id}`
                    }>
                      <Button
                        size="sm"
                        className="h-6 gap-1 btn-gold"
                      >
                        <Plus className="w-3 h-3" /> Add Subclass
                      </Button>
                    </Link>
                  </div>

                  {/* Subclass Feature Progression */}
                  <div className="space-y-4 bg-gold/5 p-3 border border-gold/10 rounded">
                    <div className="space-y-3">
                      <div className="section-header">
                        <div className="space-y-1 flex-1">
                          <label className="label-text text-[10px] text-gold/60">Subclass Title (e.g. Sorcerous Origin)</label>
                          <Input
                            value={subclassTitle}
                            onChange={e => setSubclassTitle(e.target.value)}
                            placeholder="Archetype, Domain, Path..."
                            className="h-7 text-xs bg-background/50 border-gold/10 focus:border-gold"
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="label-text text-[10px] text-gold/60">Subclass Feature Levels (comma separated, e.g. 1, 6, 14, 18)</label>
                        <Input
                          value={levelsInput}
                          onChange={e => {
                            const val = e.target.value;
                            setLevelsInput(val);
                            const levels = val.split(',').map(v => parseInt(v.trim())).filter(n => !isNaN(n));
                            setSubclassFeatureLevels(levels);
                          }}
                          placeholder="1, 6, 14, 18"
                          className="h-8 text-xs bg-background/50 border-gold/10 focus:border-gold"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="divide-y divide-gold/10">
                    {displaySubclasses.map(sub => (
                      <div key={sub.id} className="py-2 flex items-center justify-between group">
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-bold text-ink">{sub.name}</span>
                          <span className="text-[10px] text-ink/40 uppercase font-mono">
                            {sources.find(s => s.id === sub.sourceId)?.abbreviation || 'Unknown'}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Link to={
                            isProposalRoute
                              ? `/proposals/edit/subclasses/edit/${sub.id}`
                              : `/compendium/subclasses/edit/${sub.id}`
                          }>
                            <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-gold">
                              <Edit className="w-3 h-3" />
                            </Button>
                          </Link>
                        </div>
                      </div>
                    ))}
                    {displaySubclasses.length === 0 && (
                      <p className="py-4 text-center muted-text italic text-[10px]">No subclasses added.</p>
                    )}
                  </div>
                </div>
              </TabsContent>
            )}

            {/* Proficiencies */}
            <TabsContent value="proficiencies" className="space-y-6 mt-0">{activeTab === 'proficiencies' && (
              <div className="p-4 border border-gold/20 bg-card/50 space-y-6">
                <div className="section-header">
                  <h2 className="label-text text-gold">Proficiencies</h2>
                  <Shield className="w-4 h-4 text-gold/40" />
                </div>

                <ProficienciesEditor
                  proficiencies={proficiencies}
                  setProficiencies={setProficiencies}
                  types={['savingThrows', 'armor', 'weapons', 'skills', 'tools', 'languages']}
                  allAttributes={allAttributes}
                  allSkills={allSkills}
                  groupedArmor={groupedArmor}
                  allArmor={allArmor}
                  allArmorCategories={allArmorCategories}
                  groupedWeapons={groupedWeapons}
                  allWeapons={allWeapons}
                  allWeaponCategories={allWeaponCategories}
                  groupedTools={groupedTools}
                  allTools={allTools}
                  allToolCategories={allToolCategories}
                  groupedLanguages={groupedLanguages}
                  allLanguages={allLanguages}
                  allLanguageCategories={allLanguageCategories}
                />
              </div>
            )}
            </TabsContent>

            {/* Spellcasting */}
            <TabsContent value="spellcasting" className="space-y-6 mt-0">
              <div className="p-4 border border-gold/20 bg-card/50 space-y-4">
                <div className="section-header">
                  <div className="flex items-center gap-3">
                    <h2 className="label-text text-gold">Spellcasting</h2>
                    <label className="flex items-center gap-2 cursor-pointer group">
                      <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${spellcasting.hasSpellcasting ? 'bg-gold border-gold' : 'border-gold/30 group-hover:border-gold/50'}`}>
                        {spellcasting.hasSpellcasting && <Check className="w-3 h-3 text-white" />}
                      </div>
                      <input
                        type="checkbox"
                        className="hidden"
                        checked={spellcasting.hasSpellcasting}
                        onChange={e => setSpellcasting({ ...spellcasting, hasSpellcasting: e.target.checked })}
                      />
                      <span className="text-[10px] font-bold uppercase tracking-widest text-ink/40">Enable Spellcasting</span>
                    </label>
                  </div>
                  <div className="flex items-center gap-3">
                    {id ? (
                      <Link
                        to={`/compendium/spell-lists?class=${id}`}
                        className="text-[10px] font-bold uppercase tracking-widest text-gold/70 hover:text-gold underline-offset-4 hover:underline"
                      >
                        Manage Spell List →
                      </Link>
                    ) : null}
                    <Wand2 className="w-4 h-4 text-gold/40" />
                  </div>
                </div>

                {spellcasting.hasSpellcasting && (
                  <div className="space-y-6 animate-in fade-in slide-in-from-top-2 duration-300">
                    <div className="grid sm:grid-cols-4 gap-4">
                      <div className="flex items-center gap-2 col-span-full mb-[-12px]">
                        <div className="flex items-center gap-2 cursor-pointer group p-2 -ml-2 rounded hover:bg-gold/5" onClick={() => setSpellcasting({ ...spellcasting, isRitualCaster: !spellcasting.isRitualCaster })}>
                          <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${spellcasting.isRitualCaster ? 'bg-gold border-gold' : 'border-gold/30 group-hover:border-gold/50'}`}>
                            {spellcasting.isRitualCaster && <Check className="w-3 h-3 text-white" />}
                          </div>
                          <span className="text-[10px] font-bold uppercase tracking-widest text-gold select-none">Ritual Caster</span>
                        </div>
                      </div>
                      {/* Casting Mode — chooses which master chart the
                          Full/Half/Third progression below feeds: standard
                          spell slots (Multiclass Master Chart) or Warlock-style
                          pact slots (Pact Master Chart). Replaces the retired
                          "Custom / Pact" progression option + altProgressionId. */}
                      <div className="space-y-1 col-span-full">
                        <label className="label-text">Casting Mode</label>
                        <div className="inline-flex rounded-md border border-gold/15 overflow-hidden bg-background/50">
                          {([
                            { key: 'spellcasting', label: 'Standard Spellcasting' },
                            { key: 'pact', label: 'Pact Casting' },
                          ] as const).map(opt => {
                            const active = (spellcasting.castingMode || 'spellcasting') === opt.key;
                            return (
                              <button
                                key={opt.key}
                                type="button"
                                onClick={() => setSpellcasting({ ...spellcasting, castingMode: opt.key })}
                                className={`px-3 h-8 text-[11px] font-bold uppercase tracking-widest transition-colors ${active ? 'bg-gold text-[var(--primary-foreground)]' : 'text-ink/55 hover:text-gold hover:bg-gold/5'}`}
                              >
                                {opt.label}
                              </button>
                            );
                          })}
                        </div>
                        <p className="text-[9px] text-ink/40 italic">
                          {(spellcasting.castingMode || 'spellcasting') === 'pact'
                            ? 'Warlock-style: a few slots, all the same level, drawn from the Pact Master Chart. The Progression Type below scales the pact-caster level (Full Caster = 1:1).'
                            : 'Standard spell slots spread across levels 1–9, drawn from the Multiclass Master Chart via the Progression Type below.'}
                        </p>
                      </div>
                      <div className="space-y-1">
                        <label className="label-text">Level Obtained</label>
                        <Input
                          type="number"
                          value={spellcasting.level}
                          onChange={e => setSpellcasting({ ...spellcasting, level: parseInt(e.target.value) || 1 })}
                          className="h-8 text-xs bg-background/50 border-gold/10 focus:border-gold"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="label-text">Progression Type</label>
                        <select
                          value={spellcasting.progressionId || ''}
                          onChange={e => setSpellcasting({ ...spellcasting, progressionId: e.target.value })}
                          className="w-full h-8 px-2 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-xs text-ink"
                        >
                          <option value="">None</option>
                          {spellcastingTypes.map(type => (
                            <option key={type.id} value={type.id}>{type.name}</option>
                          ))}
                        </select>
                        {selectedSpellcastingType && (
                          <p className="text-[9px] text-ink/40 italic">
                            Foundry: <span className="font-mono text-gold/70">{selectedSpellcastingType.foundryName || 'unset'}</span>
                            {selectedSpellcastingType.formula ? (
                              <>
                                {' '}| Formula: <span className="font-mono text-gold/70">{selectedSpellcastingType.formula}</span>
                              </>
                            ) : null}
                          </p>
                        )}
                      </div>
                      <div className="space-y-1">
                        <label className="label-text">Ability</label>
                        <select
                          value={spellcasting.ability}
                          onChange={e => setSpellcasting({ ...spellcasting, ability: e.target.value.toUpperCase() })}
                          className="w-full h-8 px-2 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-xs text-ink"
                        >
                          {allAttributes.map(attr => (
                            <option key={attr.id} value={(attr.identifier || attr.id).toUpperCase()}>{attr.name}</option>
                          ))}
                          {allAttributes.length === 0 && (
                            <>
                              <option value="INT">Intelligence</option>
                              <option value="WIS">Wisdom</option>
                              <option value="CHA">Charisma</option>
                            </>
                          )}
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="label-text">Type</label>
                        <select
                          value={spellcasting.type}
                          onChange={e => setSpellcasting({ ...spellcasting, type: e.target.value })}
                          className="w-full h-8 px-2 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-xs text-ink"
                        >
                          <option value="prepared">Prepared</option>
                          <option value="known">Known</option>
                          <option value="spellbook">Spellbook</option>
                        </select>
                      </div>
                    </div>

                    {['prepared', 'spellbook'].includes(spellcasting.type) && (
                      <fieldset className="config-fieldset bg-background/20">
                        <legend className="section-label text-sky-500/60 px-1">Spells Known Formula</legend>
                        <div className="space-y-3">
                          <div className="space-y-1.5">
                            <label className="field-label">Formula</label>
                            <Input
                              value={spellcasting.spellsKnownFormula}
                              onChange={e => setSpellcasting({ ...spellcasting, spellsKnownFormula: e.target.value })}
                              placeholder="Preferred: @abilities.wis.mod + @classes.druid.levels"
                              className="field-input text-xs"
                            />
                            <div className="space-y-1">
                              {SPELLCASTING_FORMULA_GUIDANCE.map((line) => (
                                <p key={line} className="field-hint">
                                  {line}
                                </p>
                              ))}
                            </div>
                          </div>
                          <ReferenceSyntaxHelp
                            title="Spell Formula References"
                            description="Dauligor spellcasting shortcuts are contextual in this field."
                            buttonLabel="Shortcuts"
                            value={spellcasting.spellsKnownFormula}
                            examples={spellFormulaShortcuts.map(row => ({
                              label: row.label,
                              semantic: row.authoring,
                              native: row.preview,
                              description: row.description
                            }))}
                            context={classReferenceContext}
                            // This field uses the spell-formula shortcut
                            // vocabulary (`@level`/`@mod`/`@value`/...) — not
                            // the general semantic grammar. Pass the matching
                            // resolver so the inline preview shows what the
                            // exporter (`normalizeSpellcastingForExport` in
                            // `classExport.ts`) will actually emit.
                            normalize={(v) => normalizeSpellFormulaShortcuts(v, classReferenceContext)}
                          />
                        </div>
                      </fieldset>
                    )}

                    {/* Spellbook-only: starting + per-level spellbook
                        additions. The "Spells Known Formula" above
                        defines how many spells can be PREPARED each
                        day from the spellbook; these two values
                        define how many spells get ADDED to the
                        spellbook itself. Wizard SRD: 6 starter spells
                        at the class's spellcasting trigger level
                        (level 1 by default), then +2 each level
                        after. */}
                    {spellcasting.type === 'spellbook' && (
                      <fieldset className="config-fieldset bg-background/20">
                        <legend className="section-label text-sky-500/60 px-1">Spellbook</legend>
                        <div className="grid sm:grid-cols-2 gap-4">
                          <div className="space-y-1.5">
                            <label className="field-label">Starting Spells</label>
                            <Input
                              type="number"
                              min={0}
                              value={spellcasting.startingSpellbookCount}
                              onChange={e => setSpellcasting({
                                ...spellcasting,
                                startingSpellbookCount: Math.max(0, parseInt(e.target.value, 10) || 0),
                              })}
                              placeholder="e.g. 6"
                              className="field-input text-xs"
                            />
                            <p className="field-hint">Number of spells added to the spellbook at the level the class gains spellcasting (Wizard SRD: 6).</p>
                          </div>
                          <div className="space-y-1.5">
                            <label className="field-label">Spells Added per Level</label>
                            <Input
                              type="number"
                              min={0}
                              value={spellcasting.spellbookAdditionsPerLevel}
                              onChange={e => setSpellcasting({
                                ...spellcasting,
                                spellbookAdditionsPerLevel: Math.max(0, parseInt(e.target.value, 10) || 0),
                              })}
                              placeholder="e.g. 2"
                              className="field-input text-xs"
                            />
                            <p className="field-hint">Number of spells added to the spellbook each class level after the trigger level (Wizard SRD: 2).</p>
                          </div>
                        </div>
                      </fieldset>
                    )}

                    <div className="space-y-4">
                      <div className="grid sm:grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="label-text">Spells Known Scaling (Cantrips / Spells)</label>
                          <div className="flex gap-1">
                            <select
                              value={spellcasting.spellsKnownId}
                              onChange={e => setSpellcasting({ ...spellcasting, spellsKnownId: e.target.value })}
                              className="flex-1 h-8 px-2 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-xs text-ink"
                            >
                              <option value="">None</option>
                              {knownScalings.map(s => (
                                <option key={s.id} value={s.id}>{s.name}</option>
                              ))}
                            </select>
                            <div className="flex gap-1">
                              {spellcasting.spellsKnownId && (
                                <Link to={`/compendium/spells-known-scaling/edit/${spellcasting.spellsKnownId}`}>
                                  <Button variant="outline" size="sm" className="h-8 w-8 border-gold/10 text-gold hover:bg-gold/5 p-0">
                                    <Edit className="w-3 h-3" />
                                  </Button>
                                </Link>
                              )}
                              <Link to="/compendium/spells-known-scaling/new">
                                <Button variant="outline" size="sm" className="h-8 w-8 border-gold/10 text-gold hover:bg-gold/5 p-0">
                                  <Plus className="w-3 h-3" />
                                </Button>
                              </Link>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="label-text">Spellcasting Description</label>
                      <MarkdownEditor
                        value={spellcasting.description}
                        onChange={(val) => setSpellcasting({ ...spellcasting, description: val })}
                        placeholder="Describe how this class casts spells..."
                        minHeight="120px"
                      />
                    </div>
                  </div>
                )}
              </div>

            </TabsContent>

            {/* Equipment */}
            <TabsContent value="equipment" className="space-y-6 mt-0">
              <div className="p-4 border border-gold/20 bg-card/50 space-y-4">
                <h2 className="label-text text-gold border-b border-gold/10 pb-2">Starting Equipment & Wealth</h2>

                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="label-text">Foundry Wealth Formula</label>
                    <Input
                      value={wealth}
                      onChange={e => setWealth(e.target.value)}
                      placeholder="e.g. 3d4*10"
                      className="h-full min-h-[42px] text-sm bg-background/50 border-gold/10 focus:border-gold"
                    />
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="space-y-1">
                    <label className="label-text">Starting Equipment</label>
                    <MarkdownEditor
                      value={startingEquipment}
                      onChange={setStartingEquipment}
                      minHeight="60px"
                    />
                  </div>
                </div>
              </div>

            </TabsContent>

            <TabsContent value="features" className="space-y-6 mt-0">
              {/* Features — gate on effectiveId (not id) so the section is usable
                  on a class created in-block before useParams.id is set. */}
              {effectiveId && (
                <div className="p-4 border border-gold/20 bg-card/50 space-y-4">
                  <div className="section-header">
                    <h2 className="label-text text-gold">Class Features</h2>
                    <Button
                      size="sm"
                      onClick={() => {
                        setEditingFeature(normalizeFeatureForEditor({
                          id: crypto.randomUUID(),
                          name: '',
                          description: '',
                          level: 1,
                          isSubclassFeature: false,
                          type: 'class',
                          subtype: '',
                          identifier: '',
                          requirements: '',
                          sourceId: sourceId || '',
                          source: {
                            custom: '',
                            book: '',
                            page: '',
                            license: '',
                            rules: '',
                            revision: 1
                          },
                          configuration: {
                            requiredLevel: 1,
                            requiredIds: [],
                            repeatable: false
                          },
                          prerequisites: {
                            level: null,
                            items: [],
                            repeatable: false
                          },
                          properties: ['passive'],
                          uses: {
                            spent: 0,
                            max: '',
                            recovery: []
                          },
                          quantityColumnId: '',
                          scalingColumnId: '',
                          uniqueOptionGroupIds: [],
                          activities: {},
                          effects: [],
                          advancements: []
                        }));
                        setIsFeatureModalOpen(true);
                      }}
                      className="h-6 gap-1 btn-gold"
                    >
                      <Plus className="w-3 h-3" /> Add Feature
                    </Button>
                  </div>
                  <div className="divide-y divide-gold/10">
                    {displayFeatures.map((feature) => (
                      <div key={feature.id} className="py-2 flex items-center justify-between group">
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-mono text-gold/60 w-4">L{feature.level}</span>
                          <span className="text-sm font-bold text-ink">{feature.name}</span>
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button variant="ghost" size="sm" onClick={() => {
                            setEditingFeature(normalizeFeatureForEditor({
                              ...feature,
                              type: feature.type || 'class',
                              configuration: feature.configuration || {
                                requiredLevel: feature.level || 1,
                                requiredIds: [],
                                repeatable: false
                              },
                              activities: feature.automation?.activities || {},
                              effects: feature.automation?.effects || [],
                              advancements: feature.advancements || []
                            }));
                            setIsFeatureModalOpen(true);
                          }} className="h-6 w-6 p-0 text-gold"><Edit className="w-3 h-3" /></Button>
                          <Button variant="ghost" size="sm" onClick={() => handleDeleteFeature(feature.id)} className="h-6 w-6 p-0 text-blood"><Trash2 className="w-3 h-3" /></Button>
                        </div>
                      </div>
                    ))}
                    {displayFeatures.length === 0 && <p className="py-4 text-center muted-text italic">No features added.</p>}
                  </div>
                </div>
              )}
            </TabsContent>

            {/* Multiclassing */}
            <TabsContent value="multiclassing" className="space-y-6 mt-0">
              <div className="p-4 border border-gold/20 bg-card/50 space-y-4">
                <h2 className="label-text text-gold border-b border-gold/10 pb-2">Multiclassing</h2>

                <div className="grid sm:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <div className="space-y-1">
                      <label className="label-text group flex items-center gap-2">
                        Primary Ability
                      </label>
                      <p className="text-[10px] text-ink/40 italic mb-2">Attributes that are ALL required.</p>
                      <div className="flex flex-wrap gap-2 pt-1 border border-gold/10 bg-background/50 p-2 rounded-md">
                        {allAttributes.map(attr => (
                          <button
                            key={attr.id}
                            type="button"
                            onClick={() => {
                              const iden = (attr.identifier || attr.id).toUpperCase();
                              if (primaryAbility.includes(iden)) {
                                setPrimaryAbility(primaryAbility.filter(s => s !== iden));
                              } else {
                                setPrimaryAbility([...primaryAbility, iden]);
                                setPrimaryAbilityChoice(prev => prev.filter(s => s !== iden));
                              }
                            }}
                            className={`px-2 py-1 rounded text-[10px] font-bold transition-all border ${primaryAbility.includes((attr.identifier || attr.id).toUpperCase())
                                ? 'bg-gold text-white border-gold'
                                : 'bg-gold/5 text-gold border-gold/10 hover:bg-gold/10'
                              }`}
                          >
                            {attr.name}
                          </button>
                        ))}
                        {allAttributes.length === 0 && <p className="text-[10px] text-ink/30 italic">No attributes defined.</p>}
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="label-text">Primary Ability Choice Row</label>
                      <p className="text-[10px] text-ink/40 italic mb-2">Choose ONE of these attributes to fulfill the requirement.</p>
                      <div className="flex flex-wrap gap-2 pt-1 border border-gold/10 bg-background/50 p-2 rounded-md">
                        {allAttributes.map(attr => (
                          <button
                            key={attr.id}
                            type="button"
                            onClick={() => {
                              const iden = (attr.identifier || attr.id).toUpperCase();
                              if (primaryAbilityChoice.includes(iden)) {
                                setPrimaryAbilityChoice(primaryAbilityChoice.filter(s => s !== iden));
                              } else {
                                setPrimaryAbilityChoice([...primaryAbilityChoice, iden]);
                                setPrimaryAbility(prev => prev.filter(s => s !== iden));
                              }
                            }}
                            className={`px-2 py-1 rounded text-[10px] font-bold transition-all border ${primaryAbilityChoice.includes((attr.identifier || attr.id).toUpperCase())
                                ? 'bg-gold text-white border-gold'
                                : 'bg-gold/5 text-gold border-gold/10 hover:bg-gold/10'
                              }`}
                          >
                            {attr.name}
                          </button>
                        ))}
                        {allAttributes.length === 0 && <p className="text-[10px] text-ink/30 italic">No attributes defined.</p>}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="space-y-1">
                      <label className="label-text">Multiclassing Requirement Preview</label>
                      <div className="p-4 bg-background/80 border border-gold/20 rounded-lg min-h-[100px] flex items-center justify-center text-center">
                        {(() => {
                          const fixedNames = primaryAbility.map(id => allAttributes.find(a => (a.identifier || a.id).toUpperCase() === id.toUpperCase())?.name || id.toUpperCase());
                          const choiceNames = primaryAbilityChoice.map(id => allAttributes.find(a => (a.identifier || a.id).toUpperCase() === id.toUpperCase())?.name || id.toUpperCase());

                          if (fixedNames.length === 0 && choiceNames.length === 0) {
                            return <span className="text-ink/20 italic text-xs">No multiclassing requirements defined.</span>;
                          }

                          let requirementPart = "";
                          if (fixedNames.length > 0) {
                            requirementPart = fixedNames.join(" and ");
                          }

                          if (choiceNames.length > 0) {
                            if (requirementPart) requirementPart += " and ";
                            requirementPart += choiceNames.join(" or ");
                          }

                          if (multiclassing && multiclassing.trim() !== '') {
                            return (
                              <div className="w-full text-left" key="multiclassing-manual">
                                <div className="text-sm font-serif italic text-gold/80 leading-relaxed group">
                                  <BBCodeRenderer content={multiclassing} className="prose-sm italic text-xs" />
                                </div>
                              </div>
                            );
                          }

                          if (!requirementPart) {
                            return <span className="text-ink/20 italic text-xs">No multiclassing requirements defined.</span>;
                          }

                          return (
                            <div className="text-sm font-serif italic text-gold/80 leading-relaxed">
                              You must have a {requirementPart} score of 13 or higher in order to multiclass in or out of this class.
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="label-text">Manual Override / Additional Requirements</label>
                      <MarkdownEditor
                        value={multiclassing}
                        onChange={setMulticlassing}
                        minHeight="40px"
                        placeholder="e.g. You must have a Strength and Charisma score of 13 or higher..."
                      />
                    </div>
                  </div>
                </div>
              </div>

            </TabsContent>

            {/* Multiclass Proficiencies */}
            <TabsContent value="multiclass-proficiencies" className="space-y-6 mt-0">{activeTab === 'multiclass-proficiencies' && (
              <div className="p-4 border border-gold/20 bg-card/50 space-y-6">
                <div className="section-header">
                  <h2 className="label-text text-gold">Multiclass Proficiencies</h2>
                  <Shield className="w-4 h-4 text-gold/40" />
                </div>

                <ProficienciesEditor
                  proficiencies={multiclassProficiencies}
                  setProficiencies={setMulticlassProficiencies}
                  types={['savingThrows', 'armor', 'weapons', 'skills', 'tools', 'languages']}
                  allAttributes={allAttributes}
                  allSkills={allSkills}
                  groupedArmor={groupedArmor}
                  allArmor={allArmor}
                  allArmorCategories={allArmorCategories}
                  groupedWeapons={groupedWeapons}
                  allWeapons={allWeapons}
                  allWeaponCategories={allWeaponCategories}
                  groupedTools={groupedTools}
                  allTools={allTools}
                  allToolCategories={allToolCategories}
                  groupedLanguages={groupedLanguages}
                  allLanguages={allLanguages}
                  allLanguageCategories={allLanguageCategories}
                />
              </div>
            )}
            </TabsContent>

            {/* Tags */}
            <TabsContent value="tags" className="space-y-6 mt-0">
              <div className="p-4 border border-gold/20 bg-card/50 space-y-4">
                <div className="section-header">
                  <h2 className="label-text text-gold">Tags & Categorization</h2>
                  <Link to="/compendium/tags">
                    <Button
                      size="sm"
                      className="h-6 gap-1 btn-gold"
                    >
                      <Plus className="w-3 h-3" /> Manage Tags
                    </Button>
                  </Link>
                </div>
                <div className="space-y-6">
                  {tagGroups.map(group => {
                    const groupTags = allTags.filter(t => t.groupId === group.id);
                    if (groupTags.length === 0) return null;
                    return (
                      <div key={group.id} className="space-y-2">
                        <label className="label-text text-ink/30">{group.name}</label>
                        <div className="flex flex-wrap gap-2">
                          {groupTags.map(tag => (
                            <button
                              key={tag.id}
                              type="button"
                              onClick={() => {
                                if (tagIds.includes(tag.id)) {
                                  setTagIds(tagIds.filter(id => id !== tag.id));
                                } else {
                                  setTagIds([...tagIds, tag.id]);
                                }
                              }}
                              className={cn(
                                "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider transition-all border",
                                tagIds.includes(tag.id)
                                  ? 'bg-gold/20 border-gold/40 text-gold shadow-sm shadow-gold/10'
                                  : 'bg-card text-ink/60 border-gold/10 hover:border-gold/30 hover:text-gold'
                              )}
                            >
                              <div className="flex items-center gap-2">
                                {tag.name}
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                  {tagGroups.length === 0 && (
                    <p className="muted-text italic">No class tags defined. <Link to="/compendium/tags" className="text-gold hover:underline">Manage tags</Link>.</p>
                  )}
                </div>
              </div>

            </TabsContent>

            {/* Progression & Advancements */}
            <TabsContent value="progression" className="space-y-6 mt-0">
              <div className="p-4 border border-gold/20 bg-card/50 space-y-4">
                <div className="section-header">
                  <div className="flex items-center gap-2">
                    <h2 className="label-text text-gold">Class Progression & Advancements</h2>
                    <Zap className="w-4 h-4 text-gold/40" />
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleInitializeBaseAdvancements}
                    className="h-7 text-[9px] uppercase font-black bg-gold/5 text-gold/60 border-gold/10 hover:bg-gold/10"
                  >
                    Initialize Base Advancements
                  </Button>
                </div>
                <div className="space-y-4">
                  <p className="text-[10px] text-ink/40 italic">Global progression rules for this class (Ability Score Improvements, Hit Points, etc.)</p>
                  <AdvancementManager
                    advancements={advancements}
                    onChange={setAdvancements}
                    availableFeatures={featurePickerOptions}
                    availableScalingColumns={scalingColumnPickerOptions}
                    availableOptionGroups={optionGroupPickerOptions}
                    availableOptionItems={optionItemPickerOptions}
                    availableFeats={featPickerOptions}
                    classId={id}
                    defaultHitDie={hitDie}
                    referenceContext={classReferenceContext}
                    referenceSheetTitle="Class Reference Sheet"
                  />
                </div>
              </div>


            </TabsContent>

            {/* Danger Zone — admin only. Deleting a class cascades
                through subclasses / features / scaling columns / etc.,
                which aren't on the proposal allowlist. Content-creators
                who want a class removed need to ask an admin. */}
            {id && !isProposalMode && (
              <TabsContent value="danger" className="space-y-6 mt-0">
                <div className="p-4 border border-blood/20 bg-blood/5 space-y-4 rounded-xl">
                  <h2 className="label-text text-blood border-b border-blood/10 pb-2 flex items-center gap-2 uppercase tracking-tighter">
                    <Trash2 className="w-4 h-4" />
                    Danger Zone
                  </h2>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full text-blood hover:text-white hover:bg-blood border border-blood/20 gap-2 text-[10px] font-black uppercase tracking-widest transition-all"
                    onClick={() => id && setDeleteClassConfirmOpen(true)}
                  >
                    Delete Class
                  </Button>
                </div>
              </TabsContent>
            )}

          </Tabs>
        </div>

        {/* Sidebar — shared ScalingColumnsPanel, parametrized for
            class ownership. FeatsEditor / ItemsEditor use the same
            component with their own parentType so behavior stays
            in lockstep across owner kinds. */}
        <div className="xl:col-span-1 space-y-6">
          {effectiveId ? (
            <ScalingColumnsPanel
              parentId={effectiveId}
              parentType="class"
              columns={scalingColumns}
              onColumnsChanged={() => setLoadTick((t) => t + 1)}
              userProfile={userProfile}
              label="Class Columns"
            />
          ) : null}
        </div>
      </div>

      {/* Feature Modal */}
      <Dialog open={isFeatureModalOpen} onOpenChange={(open) => {
        setIsFeatureModalOpen(open);
        if (open) setFeatureTab('description');
      }}>
        <DialogContent className="dialog-content max-w-[95vw] lg:max-w-6xl flex flex-col h-[90vh]">
          {editingFeature && (
            <>
              <FeatureModalHero
                iconUrl={editingFeature.iconUrl || ''}
                onIconChange={(url) => setEditingFeature({ ...editingFeature, iconUrl: url })}
                name={editingFeature.name || ''}
                onNameChange={(name) => setEditingFeature({ ...editingFeature, name })}
                required
                tabs={['description', 'details', 'activities', 'effects', 'advancement']}
                activeTab={featureTab}
                onTabChange={setFeatureTab}
                nameExtras={
                  <>
                    <div className="flex justify-center transition-all">
                      <span className="text-xs text-ink/60 my-auto mr-1 select-none pointer-events-none">Level</span>
                      <input
                        type="number"
                        min="1"
                        max="20"
                        value={editingFeature.level || 1}
                        onChange={e => setEditingFeature({ ...editingFeature, level: parseInt(e.target.value) || 1, configuration: { ...editingFeature.configuration, requiredLevel: parseInt(e.target.value) || 1 } })}
                        className="w-12 h-8 bg-transparent border border-transparent rounded text-left text-xs text-ink/60 px-2 py-0 focus:ring-1 focus:ring-gold/50 hover:bg-gold/5 outline-none transition-colors"
                      />
                    </div>
                    <ReferenceSheetDialog
                      title="Class Reference Sheet"
                      triggerLabel="Open Reference Sheet"
                      triggerClassName="mt-2"
                      context={classReferenceContext}
                    />
                  </>
                }
              />

              <div className={`flex-1 min-h-0 p-6 bg-background/50 ${featureTab === 'description' ? 'overflow-hidden' : 'overflow-y-auto custom-scrollbar'}`}>
                {featureTab === 'description' && (
                  <div className="space-y-4 h-full min-h-0">
                    <MarkdownEditor
                      value={editingFeature.description || ''}
                      onChange={(val) => setEditingFeature({ ...editingFeature, description: val })}
                      minHeight="400px"
                      maxHeight="100%"
                      className="h-full min-h-0"
                      label="Description"
                    />
                  </div>
                )}

                {featureTab === 'details' && (() => {
                  const recovery: any[] = editingFeature.uses?.recovery || [];
                  const setRecovery = (rows: any[]) =>
                    setEditingFeature({ ...editingFeature, uses: { ...editingFeature.uses, recovery: rows } });
                  const addRecovery = () =>
                    setRecovery([...recovery, { period: 'lr', type: 'recoverAll' }]);
                  const removeRecovery = (i: number) =>
                    setRecovery(recovery.filter((_: any, ri: number) => ri !== i));
                  const patchRecovery = (i: number, patch: any) =>
                    setRecovery(recovery.map((r: any, ri: number) => ri === i ? { ...r, ...patch } : r));

                  const hasSourceContent = !!(editingFeature.sourceId || editingFeature.source?.page || editingFeature.source?.custom);

                  return (
                    <div className="divide-y divide-gold/10 pt-1">

                      {/* ── FEATURE DETAILS ─────────────────────────────── */}
                      <div className="py-3 space-y-0 divide-y divide-gold/5">
                        <p className="text-[9px] uppercase tracking-[0.2em] font-black text-gold/50 pb-2 select-none">Feature Details</p>

                        {/* Type */}
                        <div className="flex items-center justify-between py-2 gap-4">
                          <label className="text-xs font-semibold text-ink/70 shrink-0 w-36">Type</label>
                          <Select value={editingFeature.type || 'class'} onValueChange={val => setEditingFeature({ ...editingFeature, type: val })}>
                            <SelectTrigger className="h-7 text-xs flex-1 bg-background/50 border-gold/10 focus:border-gold"><SelectValue /></SelectTrigger>
                            <SelectContent>{FEATURE_TYPES.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
                          </Select>
                        </div>

                        {/* Subtype */}
                        <div className="flex items-center justify-between py-2 gap-4">
                          <label className="text-xs font-semibold text-ink/70 shrink-0 w-36">Subtype</label>
                          {editingFeature.type === 'class' ? (
                            <Select value={editingFeature.subtype || ''} onValueChange={val => setEditingFeature({ ...editingFeature, subtype: val })}>
                              <SelectTrigger className="h-7 text-xs flex-1 bg-background/50 border-gold/10 focus:border-gold"><SelectValue placeholder="None" /></SelectTrigger>
                              <SelectContent>{CLASS_FEATURE_SUBTYPES.map(o => <SelectItem key={o.id || 'none'} value={o.id}>{o.name}</SelectItem>)}</SelectContent>
                            </Select>
                          ) : (
                            <Input value={editingFeature.subtype || ''} onChange={e => setEditingFeature({ ...editingFeature, subtype: e.target.value })} className="h-7 text-xs flex-1 bg-background/50 border-gold/10 focus:border-gold" />
                          )}
                        </div>

                        {/* Identifier */}
                        <div className="flex items-center justify-between py-2 gap-4">
                          <div className="shrink-0 w-36">
                            <p className="text-xs font-semibold text-ink/70">Identifier</p>
                          </div>
                          <Input value={editingFeature.identifier || ''} onChange={e => setEditingFeature({ ...editingFeature, identifier: slugify(e.target.value) })} placeholder={slugify(editingFeature.name || 'feature')} className="h-7 text-xs flex-1 font-mono bg-background/50 border-gold/10 focus:border-gold" />
                        </div>

                        {/* Requirements */}
                        <div className="flex items-center justify-between py-2 gap-4">
                          <label className="text-xs font-semibold text-ink/70 shrink-0 w-36">Requirements</label>
                          <Input value={editingFeature.requirements || ''} onChange={e => setEditingFeature({ ...editingFeature, requirements: e.target.value })} placeholder="Barbarian 1" className="h-7 text-xs flex-1 bg-background/50 border-gold/10 focus:border-gold" />
                        </div>

                        {/* Required Level */}
                        <div className="flex items-center justify-between py-2 gap-4">
                          <div className="shrink-0 w-36">
                            <p className="text-xs font-semibold text-ink/70">Required Level</p>
                            <p className="text-[10px] text-ink/40">Character or class level to select this feature when levelling up.</p>
                          </div>
                          <Input type="number" value={editingFeature.prerequisites?.level ?? ''} onChange={e => setEditingFeature({ ...editingFeature, prerequisites: { ...editingFeature.prerequisites, level: e.target.value ? parseInt(e.target.value) || null : null } })} placeholder="—" className="h-7 text-xs w-24 shrink-0 bg-background/50 border-gold/10 focus:border-gold" />
                        </div>

                        {/* Required Items */}
                        <div className="flex items-center justify-between py-2 gap-4">
                          <div className="shrink-0 w-36">
                            <p className="text-xs font-semibold text-ink/70">Required Items</p>
                            <p className="text-[10px] text-ink/40">Identifiers the character must have before selecting this.</p>
                          </div>
                          <Input value={editingFeature.prerequisites?.items?.join(', ') || ''} onChange={e => setEditingFeature({ ...editingFeature, prerequisites: { ...editingFeature.prerequisites, items: e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean) } })} placeholder="item-identifier-1, item-identifier-2" className="h-7 text-xs flex-1 bg-background/50 border-gold/10 focus:border-gold" />
                        </div>

                        {/* Repeatable */}
                        <div className="flex items-center justify-between py-2 gap-4">
                          <div className="shrink-0 w-36">
                            <p className="text-xs font-semibold text-ink/70">Repeatable</p>
                            <p className="text-[10px] text-ink/40">This feature can be chosen more than once.</p>
                          </div>
                          <Checkbox id="feat-repeatable" className="border-gold/30 data-[state=checked]:bg-gold data-[state=checked]:text-white" checked={editingFeature.prerequisites?.repeatable || false} onCheckedChange={checked => setEditingFeature({ ...editingFeature, prerequisites: { ...editingFeature.prerequisites, repeatable: !!checked } })} />
                        </div>

                        {/* Feature Properties */}
                        <div className="py-2">
                          <p className="text-xs font-semibold text-ink/70 mb-2">Feature Properties</p>
                          <div className="flex items-center gap-6">
                            <div className="flex items-center gap-2">
                              <Checkbox id="feat-magical" className="border-gold/30 data-[state=checked]:bg-gold data-[state=checked]:text-white" checked={editingFeature.properties?.includes('mgc') || false} onCheckedChange={checked => { const props = normalizeFeaturePropertiesForEditor(editingFeature.properties || []); setEditingFeature({ ...editingFeature, properties: checked ? Array.from(new Set([...props, 'mgc'])) : props.filter((p: string) => p !== 'mgc') }); }} />
                              <label htmlFor="feat-magical" className="text-xs text-ink/70 cursor-pointer">Magical</label>
                            </div>
                            <div className="flex items-center gap-2">
                              <Checkbox id="feat-passive" className="border-gold/30 data-[state=checked]:bg-gold data-[state=checked]:text-white" checked={editingFeature.properties?.includes('trait') || false} onCheckedChange={checked => { const props = normalizeFeaturePropertiesForEditor(editingFeature.properties || []); setEditingFeature({ ...editingFeature, properties: checked ? Array.from(new Set([...props, 'trait'])) : props.filter((p: string) => p !== 'trait') }); }} />
                              <label htmlFor="feat-passive" className="text-xs text-ink/70 cursor-pointer">Passive Trait</label>
                            </div>
                            <div className="flex items-center gap-2">
                              <Checkbox id="isSubclassFeature" className="border-gold/30 data-[state=checked]:bg-gold data-[state=checked]:text-white" checked={editingFeature?.isSubclassFeature || false} onCheckedChange={checked => setEditingFeature({ ...editingFeature, isSubclassFeature: !!checked })} />
                              <label htmlFor="isSubclassFeature" className="text-xs text-ink/70 cursor-pointer">Subclass Choice Point</label>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* ── SOURCE (collapsible) ─────────────────────────── */}
                      <div className="py-3">
                        <button
                          type="button"
                          onClick={() => setShowFeatureSource(v => !v)}
                          className="flex items-center gap-2 w-full text-left group"
                        >
                          <p className="text-[9px] uppercase tracking-[0.2em] font-black text-gold/50 select-none">Source</p>
                          {hasSourceContent && !showFeatureSource && (
                            <span className="text-[10px] text-ink/50 font-mono">
                              {sources.find((s: any) => s.id === editingFeature.sourceId)?.abbreviation || editingFeature.source?.book || ''}
                              {editingFeature.source?.page ? ` p.${editingFeature.source.page}` : ''}
                            </span>
                          )}
                          <span className="ml-auto text-ink/30 text-xs">{showFeatureSource ? '▲' : '▼'}</span>
                        </button>
                        {showFeatureSource && (
                          <div className="mt-2 space-y-0 divide-y divide-gold/5">
                            <div className="flex items-center justify-between py-2 gap-4">
                              <label className="text-xs font-semibold text-ink/70 shrink-0 w-36">Book</label>
                              <select value={editingFeature.sourceId || ''} onChange={e => { const match = sources.find((s: any) => s.id === e.target.value); setEditingFeature({ ...editingFeature, sourceId: e.target.value, source: { ...editingFeature.source, book: match?.abbreviation || match?.name || editingFeature.source?.book || '' } }); }} className="h-7 flex-1 px-2 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-xs text-ink">
                                <option value="">Inherit class source</option>
                                {sources.map((entry: any) => <option key={entry.id} value={entry.id}>{entry.name}{entry.abbreviation ? ` (${entry.abbreviation})` : ''}</option>)}
                              </select>
                            </div>
                            <div className="flex items-center justify-between py-2 gap-4">
                              <label className="text-xs font-semibold text-ink/70 shrink-0 w-36">Page</label>
                              <Input value={editingFeature.source?.page || ''} onChange={e => setEditingFeature({ ...editingFeature, source: { ...editingFeature.source, page: e.target.value } })} className="h-7 text-xs flex-1 bg-background/50 border-gold/10 focus:border-gold" />
                            </div>
                            <div className="flex items-center justify-between py-2 gap-4">
                              <label className="text-xs font-semibold text-ink/70 shrink-0 w-36">Rules</label>
                              <Input value={editingFeature.source?.rules || ''} onChange={e => setEditingFeature({ ...editingFeature, source: { ...editingFeature.source, rules: e.target.value } })} placeholder="2014, 2024" className="h-7 text-xs flex-1 bg-background/50 border-gold/10 focus:border-gold" />
                            </div>
                            <div className="flex items-center justify-between py-2 gap-4">
                              <label className="text-xs font-semibold text-ink/70 shrink-0 w-36">Custom Note</label>
                              <Input value={editingFeature.source?.custom || ''} onChange={e => setEditingFeature({ ...editingFeature, source: { ...editingFeature.source, custom: e.target.value } })} className="h-7 text-xs flex-1 bg-background/50 border-gold/10 focus:border-gold" />
                            </div>
                          </div>
                        )}
                      </div>

                      {/* ── USAGE ───────────────────────────────────────── */}
                      <div className="py-3 space-y-0 divide-y divide-gold/5">
                        <div className="flex items-center justify-between pb-2">
                          <p className="text-[9px] uppercase tracking-[0.2em] font-black text-gold/50 select-none">Usage</p>
                          <ReferenceSyntaxHelp title="Usage Formula References" description="Use semantic references for feature uses on the site. The helper previews the Foundry-native target shape." buttonLabel="Usage Help" value={editingFeature.uses?.max || ''} context={classReferenceContext} />
                        </div>
                        <div className="flex items-center gap-4 py-2">
                          <label className="text-xs font-semibold text-ink/70 shrink-0 w-36">Limited Uses</label>
                          <div className="flex items-center gap-3 flex-1">
                            <div className="flex flex-col items-center gap-0.5">
                              <span className="text-[9px] uppercase text-ink/40 font-black tracking-wider">Spent</span>
                              <Input type="number" value={editingFeature.uses?.spent || 0} onChange={e => setEditingFeature({ ...editingFeature, uses: { ...editingFeature.uses, spent: parseInt(e.target.value) || 0 } })} className="h-7 w-16 text-center text-xs bg-background/50 border-gold/10 focus:border-gold" />
                            </div>
                            <div className="flex flex-col items-center gap-0.5">
                              <span className="text-[9px] uppercase text-ink/40 font-black tracking-wider">Max</span>
                              <Input value={editingFeature.uses?.max || ''} onChange={e => setEditingFeature({ ...editingFeature, uses: { ...editingFeature.uses, max: e.target.value } })} placeholder="—" className="h-7 w-28 text-center text-xs bg-background/50 border-gold/10 focus:border-gold" />
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* ── RECOVERY ────────────────────────────────────── */}
                      <div className="py-3">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-[9px] uppercase tracking-[0.2em] font-black text-gold/50 select-none">Recovery</p>
                          <button type="button" onClick={addRecovery} className="text-[10px] font-black text-gold/60 hover:text-gold transition-colors px-1">+ ADD</button>
                        </div>
                        {recovery.length === 0 && (
                          <p className="text-xs text-ink/30 italic py-1">No recovery rules. Click + ADD to add one.</p>
                        )}
                        <div className="space-y-1.5">
                          {recovery.map((row: any, i: number) => (
                            <div key={i} className="flex items-center gap-2">
                              {/* Period */}
                              <div className="flex flex-col gap-0.5 flex-1">
                                {i === 0 && <span className="text-[9px] uppercase text-ink/40 font-black tracking-wider">Period</span>}
                                <select value={row.period || 'lr'} onChange={e => patchRecovery(i, { period: e.target.value, ...(e.target.value === 'recharge' ? { type: 'recoverAll', formula: '6' } : { formula: undefined }) })} className="h-7 px-2 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-xs text-ink w-full">
                                  <option value="lr">Long Rest</option>
                                  <option value="sr">Short Rest</option>
                                  <option value="day">Daily</option>
                                  <option value="dawn">Dawn</option>
                                  <option value="dusk">Dusk</option>
                                  <option value="initiative">Initiative</option>
                                  <option value="turnStart">Turn Start</option>
                                  <option value="turnEnd">Turn End</option>
                                  <option value="turn">Each Turn</option>
                                  <option value="recharge">Recharge</option>
                                </select>
                              </div>
                              {/* Recovery type or Recharge value */}
                              {row.period === 'recharge' ? (
                                <div className="flex flex-col gap-0.5 flex-1">
                                  {i === 0 && <span className="text-[9px] uppercase text-ink/40 font-black tracking-wider">Value</span>}
                                  <select value={row.formula || '6'} onChange={e => patchRecovery(i, { formula: e.target.value })} className="h-7 px-2 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-xs text-ink w-full">
                                    <option value="6">Recharge 6</option>
                                    <option value="5">Recharge 5–6</option>
                                    <option value="4">Recharge 4–6</option>
                                    <option value="3">Recharge 3–6</option>
                                    <option value="2">Recharge 2–6</option>
                                  </select>
                                </div>
                              ) : (
                                <>
                                  <div className="flex flex-col gap-0.5 flex-1">
                                    {i === 0 && <span className="text-[9px] uppercase text-ink/40 font-black tracking-wider">Recovery</span>}
                                    <select value={row.type || 'recoverAll'} onChange={e => patchRecovery(i, { type: e.target.value, ...(e.target.value !== 'formula' ? { formula: undefined } : {}) })} className="h-7 px-2 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-xs text-ink w-full">
                                      <option value="recoverAll">Recover All Uses</option>
                                      <option value="loseAll">Lose All Uses</option>
                                      <option value="formula">Custom Formula</option>
                                    </select>
                                  </div>
                                  {row.type === 'formula' && (
                                    <div className="flex flex-col gap-0.5 flex-1">
                                      {i === 0 && <span className="text-[9px] uppercase text-ink/40 font-black tracking-wider">Formula</span>}
                                      <Input value={row.formula || ''} onChange={e => patchRecovery(i, { formula: e.target.value })} placeholder="2 + @class.level" className="h-7 text-xs font-mono bg-background/50 border-gold/10 focus:border-gold" />
                                    </div>
                                  )}
                                </>
                              )}
                              {/* Remove */}
                              <div className={i === 0 ? 'pt-3.5' : ''}>
                                <button type="button" onClick={() => removeRecovery(i)} className="h-7 w-7 flex items-center justify-center text-ink/30 hover:text-blood transition-colors rounded border border-transparent hover:border-blood/20">
                                  <span className="text-sm leading-none">−</span>
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* ── TABLE COLUMN LINKS ─────────────────────────── */}
                      {/* Authoring metadata: which scaling column from this
                          class's progression conceptually backs this
                          feature's quantity-of-uses or scaling-value. The
                          actor-side @scale.<class>.<identifier> reference
                          is published by the class progression itself —
                          the picker here is just a hint for authors so
                          they remember which column the feature relates
                          to, and so a future activity-authoring layer can
                          surface the formula automatically. */}
                      <div className="py-3 space-y-3 border-t border-gold/10">
                        <h4 className="text-[10px] text-gold uppercase tracking-widest font-black">Table Column Links</h4>
                        <div className="grid gap-3">
                          <div className="space-y-1">
                            <label className="text-[10px] uppercase text-ink/60 font-bold">Quantity Column</label>
                            <select
                              value={editingFeature?.quantityColumnId || ''}
                              onChange={e => setEditingFeature({ ...editingFeature, quantityColumnId: e.target.value })}
                              className="w-full h-9 px-2 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-sm text-ink"
                            >
                              <option value="">None</option>
                              {scalingColumnPickerOptions.map((col: any) => (
                                <option key={col.id} value={col.id}>{col.name}</option>
                              ))}
                            </select>
                            <p className="text-[10px] text-ink/40 italic">Link to a column that dictates the quantity of uses — e.g. the number of bardic inspiration or superiority dice the class has. Pre-fills <code className="text-gold/70">system.uses.max</code> on the embedded feature with the column's <code className="text-gold/70">@scale.&lt;class&gt;.&lt;identifier&gt;</code> reference when no manual Max is set. Manual values in the Max field always win.</p>
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] uppercase text-ink/60 font-bold">Scaling Column</label>
                            <select
                              value={editingFeature?.scalingColumnId || ''}
                              onChange={e => setEditingFeature({ ...editingFeature, scalingColumnId: e.target.value })}
                              className="w-full h-9 px-2 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-sm text-ink"
                            >
                              <option value="">None</option>
                              {scalingColumnPickerOptions.map((col: any) => (
                                <option key={col.id} value={col.id}>{col.name}</option>
                              ))}
                            </select>
                            <p className="text-[10px] text-ink/40 italic">Link to a column that dictates the scaling values — e.g. the roll of a bardic inspiration or a superiority dice. The column's <code className="text-gold/70">@scale.&lt;class&gt;.&lt;identifier&gt;</code> reference is stashed on the embedded feature so activity damage / dice formulas can pick it up automatically (and authors can paste it without typing the path).</p>
                          </div>
                        </div>
                      </div>

                    </div>
                  );
                })()}

                {featureTab === 'activities' && (
                  <div className="pt-2">
                    <ActivityEditor
                      activities={editingFeature.activities || {}}
                      onChange={(acts) => setEditingFeature((prev: any) => ({ ...prev, activities: acts }))}
                      availableEffects={editingFeature.effects || []}
                      onAvailableEffectsChange={(fx) => setEditingFeature((prev: any) => ({ ...prev, effects: fx }))}
                      defaultEffectImg={editingFeature.iconUrl || editingFeature.imageUrl || editingFeature.icon_url || editingFeature.image_url || null}
                      itemTargets={(features || [])
                        .filter((f: any) => f?.uses?.max && String(f.id) !== String(editingFeature.id))
                        .map((f: any) => ({ id: f.identifier || f.id, name: f.name || f.identifier || String(f.id) }))}
                    />
                  </div>
                )}

                {featureTab === 'effects' && (
                  <div className="pt-2">
                    <ActiveEffectEditor
                      effects={editingFeature.effects || []}
                      onChange={fx => setEditingFeature({ ...editingFeature, effects: fx })}
                      defaultImg={editingFeature.iconUrl || editingFeature.imageUrl || editingFeature.icon_url || editingFeature.image_url || null}
                    />
                  </div>
                )}

                {featureTab === 'advancement' && (
                  <div className="pt-4 space-y-4">
                    <div className="section-header">
                      <h4 className="text-[10px] text-gold uppercase tracking-widest font-black">Linked Advancements</h4>
                      <p className="text-[10px] text-ink/40">Link this feature to progression rules defined on the class.</p>
                    </div>
                    <AdvancementManager
                      advancements={[]} // Not used for management here
                      onChange={() => { }} // Not used for management here
                      availableFeatures={featurePickerOptions}
                      availableScalingColumns={scalingColumnPickerOptions}
                      availableOptionGroups={optionGroupPickerOptions}
                      availableFeats={featPickerOptions}
                      classId={id}
                      isInsideFeature={true}
                      featureId={editingFeature.id}
                      rootAdvancements={advancements}
                      defaultLevel={editingFeature.level}
                      onLinkAdvancement={(advId, featId) => {
                        const nextAdvs = advancements.map(a => {
                          if (a._id === advId) {
                            const next = { ...a, featureId: featId };
                            if (featId) next.level = editingFeature.level || 1;
                            return next;
                          }
                          return a;
                        });
                        setAdvancements(nextAdvs);
                      }}
                    />
                  </div>
                )}
              </div>

              <div className="px-5 py-2 border-t border-gold/15 bg-gold/[0.03] flex justify-end shrink-0 gap-2">
                <Button type="button" variant="ghost" onClick={() => setIsFeatureModalOpen(false)} className="label-text opacity-70 hover:opacity-100 h-8">Cancel</Button>
                <Button onClick={handleSaveFeature} className="bg-primary hover:bg-primary/90 text-primary-foreground px-6 label-text h-8">
                  Save Feature
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
      {/* Unique Options Management Dialog */}
      <Dialog open={!!managingGroupId} onOpenChange={(open) => {
        if (!open) {
          setManagingGroupId(null);
          setManagingGroupSearch('');
        }
      }}>
        <DialogContentLarge className="bg-card border-gold/30">
          <DialogHeader>
            <DialogTitle className="text-gold font-serif uppercase tracking-tight">
              Manage {allOptionGroups.find(g => g.id === managingGroupId)?.name} Options
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <p className="text-xs text-ink/60 italic">
              Uncheck options that are NOT available to the {name || 'this'} class.
            </p>

            <Input
              placeholder="Search options..."
              value={managingGroupSearch}
              onChange={e => setManagingGroupSearch(e.target.value)}
              className="h-8 text-xs bg-background/50 border-gold/10"
            />

            <div className="grid sm:grid-cols-2 gap-2">
              {allOptionItems
                .filter(item => item.groupId === managingGroupId)
                .filter(item => !managingGroupSearch || item.name.toLowerCase().includes(managingGroupSearch.toLowerCase()))
                .map(item => {
                  const isExcluded = (excludedOptionIds[managingGroupId!] || []).includes(item.id);
                  const isClassRestricted = item.classIds && Array.isArray(item.classIds) && item.classIds.length > 0 && !item.classIds.includes(id);

                  return (
                    <label
                      key={item.id}
                      className={`flex items-start gap-3 p-2 border transition-all cursor-pointer ${isExcluded || isClassRestricted
                          ? 'bg-background/20 border-gold/5 opacity-50 text-ink/50'
                          : 'bg-gold/10 border-gold/30 text-ink'
                        }`}
                    >
                      <input
                        type="checkbox"
                        checked={!isExcluded && !isClassRestricted}
                        disabled={isClassRestricted}
                        onChange={e => {
                          const currentExcluded = excludedOptionIds[managingGroupId!] || [];
                          let newExcluded;
                          if (e.target.checked) {
                            newExcluded = currentExcluded.filter(eid => eid !== item.id);
                          } else {
                            newExcluded = [...currentExcluded, item.id];
                          }
                          setExcludedOptionIds({
                            ...excludedOptionIds,
                            [managingGroupId!]: newExcluded
                          });
                        }}
                        className="mt-1 w-3 h-3 rounded border-gold/20 text-gold focus:ring-gold"
                      />
                      <div className="space-y-0.5">
                        <span className="text-xs font-bold text-ink block">{item.name}</span>
                        {effectiveOptionLevel(item) > 0 && (
                          <span className="text-[10px] text-gold/60 font-mono block">Level {effectiveOptionLevel(item)}+</span>
                        )}
                        {isClassRestricted && (
                          <span className="text-[9px] text-blood font-bold uppercase block">Restricted by Item</span>
                        )}
                      </div>
                    </label>
                  );
                })}
            </div>
          </div>

          <DialogFooter>
            <Button onClick={() => setManagingGroupId(null)} className="btn-gold-solid">
              Done
            </Button>
          </DialogFooter>
        </DialogContentLarge>
      </Dialog>
      <ConfirmDialog
        open={deleteClassConfirmOpen}
        onOpenChange={setDeleteClassConfirmOpen}
        title={`Delete ${name ? `"${name}"` : 'this class'}?`}
        description={
          isProposalMode
            ? 'Queues a DELETE proposal for this class. The live class stays in place until an admin approves. Subclasses, features, and other linked rows are NOT included — those need admin cleanup separately.'
            : 'Permanently deletes this class from the live catalog. Subclasses, features, and other linked rows are not cascaded — clean those up separately if needed.'
        }
        confirmLabel="Delete class"
        destructive
        onConfirm={async () => {
          if (!id) return;
          try {
            if (isProposalMode) {
              await classWriter.remove(id);
              toast.success(actionLabel(classWriter.mode, 'deleted'));
            } else {
              await deleteDocument('classes', id);
              toast.success('Class deleted');
            }
            setInitialDataHash(getCurrentStateHash()); // Prevent dirty check
            setTimeout(() => navigate((isProposalMode || isProposalRoute) ? '/my-proposals' : '/compendium/classes'), 0);
          } catch (error) {
            toast.error('Failed to delete class');
            throw error; // keep dialog open
          }
        }}
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
                'tag_ids',
              );
              toast.success('Replacement saved.');
            } catch (err: any) {
              toast.error(err?.message || 'Could not replace tag.');
            }
          }}
        />
      )}
    </fieldset>
  );
}

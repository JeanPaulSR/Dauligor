import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useUnsavedChangesWarning } from '../../hooks/useUnsavedChangesWarning';
import { useKeyboardSave } from '../../hooks/useKeyboardSave';
import ActivityEditor from '../../components/compendium/ActivityEditor';
import ActiveEffectEditor from '../../components/compendium/ActiveEffectEditor';
import { reportClientError, OperationType } from '../../lib/firebase';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { ImageUpload } from '../../components/ui/ImageUpload';
import { ClassImageEditor, type ImageDisplay, DEFAULT_DISPLAY } from '../../components/compendium/ClassImageEditor';
import { Sword, Save, Plus, Trash2, ChevronLeft, Shield, Scroll, Wand2, Heart, Hammer, BookOpen, Tag, Edit, Check, Image as ImageIcon, Zap, ListChecks, ChevronDown, ChevronRight, MessageCircle, Sliders } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from '../../components/ui/dialog';
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
import { buildSpellFormulaShortcutRows } from '../../lib/referenceSyntax';
import { normalizeAdvancementListForEditor, resolveAdvancementDefaultHitDie } from '../../lib/advancementState';
import { buildCanonicalBaseClassAdvancements } from '../../lib/classProgression';
import { fetchCollection, fetchDocument, queryD1, upsertDocument, deleteDocument } from '../../lib/d1';
import { upsertFeature, denormalizeCompendiumData } from '../../lib/compendium';
import { queueRebake } from '../../lib/moduleExport';
import { BakeNowButton } from '../../components/compendium/BakeNowButton';
import { Database, CloudOff } from 'lucide-react';

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

function getScalingBreakpoints(values: Record<string, any> = {}) {
  let lastValue: string | undefined;
  return Object.entries(values)
    .sort(([a], [b]) => Number(a) - Number(b))
    .filter(([, value]) => {
      const normalized = String(value ?? '');
      if (!normalized || normalized === lastValue) return false;
      lastValue = normalized;
      return true;
    });
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

function normalizeChoiceCount(value: any) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.floor(parsed);
}

function uniqueNormalizedIds(values: any[] = [], { uppercase = false }: { uppercase?: boolean } = {}) {
  return Array.from(new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => {
        const normalized = String(value ?? '').trim();
        if (!normalized) return '';
        return uppercase ? normalized.toUpperCase() : normalized;
      })
      .filter(Boolean)
  ));
}

function sanitizeProficiencySelection(
  selection: any,
  {
    uppercase = false,
    includeCategories = true
  }: {
    uppercase?: boolean;
    includeCategories?: boolean;
  } = {}
) {
  const fixedIds = uniqueNormalizedIds(selection?.fixedIds || [], { uppercase });
  const fixedSet = new Set(fixedIds);
  const optionIds = uniqueNormalizedIds(selection?.optionIds || [], { uppercase }).filter((id) => !fixedSet.has(id));
  const normalized: any = {
    choiceCount: normalizeChoiceCount(selection?.choiceCount),
    optionIds,
    fixedIds
  };

  if (includeCategories) {
    normalized.categoryIds = uniqueNormalizedIds(selection?.categoryIds || []);
  }

  return normalized;
}

function sanitizeProficiencyCollection(raw: any = {}) {
  return {
    armor: sanitizeProficiencySelection(raw.armor, { includeCategories: true }),
    weapons: sanitizeProficiencySelection(raw.weapons, { includeCategories: true }),
    tools: sanitizeProficiencySelection(raw.tools, { includeCategories: true }),
    skills: sanitizeProficiencySelection(raw.skills, { includeCategories: false }),
    savingThrows: sanitizeProficiencySelection(raw.savingThrows, { uppercase: true, includeCategories: false }),
    languages: sanitizeProficiencySelection(raw.languages, { includeCategories: true }),
    armorDisplayName: typeof raw.armorDisplayName === 'string' ? raw.armorDisplayName : '',
    weaponsDisplayName: typeof raw.weaponsDisplayName === 'string' ? raw.weaponsDisplayName : '',
    toolsDisplayName: typeof raw.toolsDisplayName === 'string' ? raw.toolsDisplayName : ''
  };
}

function buildNextGroupedProficiencyCollection(
  collection: any,
  items: any[],
  type: 'armor' | 'weapons' | 'tools' | 'languages',
  target: 'fixedIds' | 'optionIds',
  categoryId?: string
) {
  const section = collection?.[type] || {};
  const currentIds = new Set<string>((section[target] || []) as string[]);
  const itemIds = (items || []).map((item) => item.id).filter(Boolean) as string[];
  const allExist = itemIds.every((itemId) => currentIds.has(itemId));

  let nextIds: string[];
  if (allExist) {
    nextIds = Array.from(currentIds).filter((id) => !itemIds.includes(id));
  } else {
    nextIds = Array.from(new Set([...Array.from(currentIds), ...itemIds]));
  }

  const allowOverlap = true;
  const otherTarget = target === 'fixedIds' ? 'optionIds' : 'fixedIds';
  let nextOtherIds = (section[otherTarget] || []) as string[];
  if (!allowOverlap && !allExist) {
    nextOtherIds = nextOtherIds.filter((id: string) => !itemIds.includes(id));
  }

  const currentCatIds = (section.categoryIds || []) as string[];
  let nextCatIds = currentCatIds;
  if (categoryId) {
    nextCatIds = allExist
      ? currentCatIds.filter((id: string) => id !== categoryId)
      : Array.from(new Set([...currentCatIds, categoryId]));
  }

  return {
    ...collection,
    [type]: {
      ...section,
      [target]: nextIds,
      [otherTarget]: nextOtherIds,
      categoryIds: nextCatIds
    }
  };
}

function joinDisplaySegments(fixedSegments: string[], choiceSegments: string[]) {
  const normalizedFixed = fixedSegments.filter(Boolean);
  const normalizedChoices = choiceSegments.filter(Boolean);
  const fixedText = normalizedFixed.join(', ');
  const choiceText = normalizedChoices.join('; and ');

  if (fixedText && choiceText) return `${fixedText}; and ${choiceText}`;
  return fixedText || choiceText;
}

function buildGroupedProficiencyDisplayName(
  selection: any,
  items: any[] = [],
  categories: any[] = []
) {
  const fixedIds = new Set(selection?.fixedIds || []);
  const optionIds = new Set(selection?.optionIds || []);
  const choiceCount = Math.max(normalizeChoiceCount(selection?.choiceCount), 1);
  const categoryList = Array.isArray(categories) ? categories : [];
  const itemList = Array.isArray(items) ? items : [];
  const itemsByCategory = new Map<string, any[]>();

  for (const item of itemList) {
    const categoryId = String(item?.categoryId || '').trim();
    if (!categoryId) continue;
    if (!itemsByCategory.has(categoryId)) itemsByCategory.set(categoryId, []);
    itemsByCategory.get(categoryId)?.push(item);
  }

  const fixedCategoryIds = new Set<string>();
  const optionCategoryIds = new Set<string>();

  for (const category of categoryList) {
    const categoryId = String(category?.id || '').trim();
    if (!categoryId) continue;
    const categoryItems = itemsByCategory.get(categoryId) || [];
    if (categoryItems.length === 0) continue;

    const isFixedCategory = categoryItems.every((item) => fixedIds.has(item.id));
    if (isFixedCategory) {
      fixedCategoryIds.add(categoryId);
      continue;
    }

    const isOptionCategory = categoryItems.every((item) => optionIds.has(item.id));
    if (isOptionCategory) {
      optionCategoryIds.add(categoryId);
    }
  }

  const fixedSegments = categoryList
    .filter((category) => fixedCategoryIds.has(String(category?.id || '')))
    .map((category) => String(category?.name || '').trim())
    .filter(Boolean);

  const fixedItemSegments = itemList
    .filter((item) => fixedIds.has(item.id) && !fixedCategoryIds.has(String(item?.categoryId || '')))
    .map((item) => String(item?.name || '').trim())
    .filter(Boolean);

  const optionEntries = [
    ...categoryList
      .filter((category) => optionCategoryIds.has(String(category?.id || '')))
      .map((category) => String(category?.name || '').trim())
      .filter(Boolean),
    ...itemList
      .filter((item) => optionIds.has(item.id) && !fixedIds.has(item.id) && !optionCategoryIds.has(String(item?.categoryId || '')))
      .map((item) => String(item?.name || '').trim())
      .filter(Boolean)
  ];

  const choiceSegments = optionEntries.length === 0
    ? []
    : optionEntries.length === 1
      ? [`${choiceCount} ${optionEntries[0]} of your choice`]
      : [`${choiceCount} of your choice from ${optionEntries.join(', ')}`];

  return joinDisplaySegments([...fixedSegments, ...fixedItemSegments], choiceSegments);
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
    progressionId: '',
    altProgressionId: '',
    spellsKnownId: '',
    spellsKnownFormula: ''
  };
}

function normalizeClassSpellcastingForEditor(spellcasting: any) {
  if (!spellcasting || typeof spellcasting !== 'object') {
    return buildEmptyClassSpellcastingState();
  }

  const normalized = {
    ...buildEmptyClassSpellcastingState(),
    ...spellcasting,
    hasSpellcasting: Boolean(spellcasting.hasSpellcasting),
    isRitualCaster: Boolean(spellcasting.isRitualCaster),
    ability: String(spellcasting.ability || 'INT').toUpperCase(),
    type: String(spellcasting.type || 'prepared').toLowerCase(),
    level: Number(spellcasting.level || 1) || 1
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

  return normalized;
}

export default function ClassEditor({ userProfile }: { userProfile: any }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(!!id);
  const [sources, setSources] = useState<any[]>([]);
  const [spellcastingTypes, setSpellcastingTypes] = useState<any[]>([]);
  const [pactScalings, setPactScalings] = useState<any[]>([]);
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
      categoryIds: []
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
    toolsDisplayName: ''
  });
  const [startingEquipment, setStartingEquipment] = useState('');
  const [wealth, setWealth] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [imageDisplay, setImageDisplay] = useState<ImageDisplay>(DEFAULT_DISPLAY);
  const [cardImageUrl, setCardImageUrl] = useState('');
  const [cardDisplay, setCardDisplay] = useState<ImageDisplay>(DEFAULT_DISPLAY);
  const [previewImageUrl, setPreviewImageUrl] = useState('');
  const [previewDisplay, setPreviewDisplay] = useState<ImageDisplay>(DEFAULT_DISPLAY);
  const [imageDialogOpen, setImageDialogOpen] = useState(false);
  const [multiclassing, setMulticlassing] = useState('');
  const [multiclassProficiencies, setMulticlassProficiencies] = useState({
    armor: { choiceCount: 0, optionIds: [], fixedIds: [], categoryIds: [] },
    weapons: { choiceCount: 0, optionIds: [], fixedIds: [], categoryIds: [] },
    tools: { choiceCount: 0, optionIds: [], fixedIds: [], categoryIds: [] },
    languages: { choiceCount: 0, optionIds: [], fixedIds: [], categoryIds: [] },
    skills: { choiceCount: 0, optionIds: [], fixedIds: [] },
    savingThrows: { choiceCount: 0, optionIds: [], fixedIds: [] },
    armorDisplayName: '',
    weaponsDisplayName: '',
    toolsDisplayName: ''
  });
  const [primaryAbility, setPrimaryAbility] = useState<string[]>([]);
  const [primaryAbilityChoice, setPrimaryAbilityChoice] = useState<string[]>([]);
  const [spellcasting, setSpellcasting] = useState({
    hasSpellcasting: false,
    isRitualCaster: false,
    description: '',
    level: 1,
    ability: 'INT',
    type: 'prepared',
    progressionId: '',
    altProgressionId: '',
    spellsKnownId: '',
    spellsKnownFormula: ''
  });
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
  const [tagGroups, setTagGroups] = useState<any[]>([]);
  const [allTags, setAllTags] = useState<any[]>([]);
  const [scalingColumns, setScalingColumns] = useState<any[]>([]);
  const [advancements, setAdvancements] = useState<Advancement[]>([]);
  const [isFoundationUsingD1, setIsFoundationUsingD1] = useState(false);

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

  const isDirty = useMemo(() => {
    if (!initialDataHash) return false;
    return initialDataHash !== getCurrentStateHash();
  }, [initialDataHash, getCurrentStateHash]);

  useUnsavedChangesWarning(isDirty);
  useKeyboardSave(() => { handleSave(); });

  useEffect(() => {
    if (!initialLoading && !initialDataHash) {
      setInitialDataHash(getCurrentStateHash());
    } else if (lastSavedTick > 0) {
      setInitialDataHash(getCurrentStateHash());
      setLastSavedTick(0);
    }
  }, [initialLoading, initialDataHash, getCurrentStateHash, lastSavedTick]);

  useEffect(() => {
    const loadFoundation = async () => {
      try {
        // Fetch all foundation/taxonomy collections in parallel
        const [
          sourcesData,
          scTypesData,
          pactData,
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
          allTagsData
        ] = await Promise.all([
          fetchCollection('sources', { orderBy: 'name ASC' }),
          fetchCollection('spellcastingTypes', { orderBy: 'name ASC' }),
          fetchCollection('pactMagicScalings', { orderBy: 'name ASC' }),
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
          fetchCollection('tags')
        ]);

        setSources(sourcesData.map(s => denormalizeCompendiumData(s)));
        setSpellcastingTypes(scTypesData.map(t => denormalizeCompendiumData(t)));
        setPactScalings(pactData.map((p: any) => ({
          ...denormalizeCompendiumData(p),
          levels: typeof p.levels === 'string' ? JSON.parse(p.levels) : (p.levels || [])
        })));
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

        // Simple check to set D1 status based on first collection
        if (sourcesData.length > 0) {
          setIsFoundationUsingD1(true);
        }
      } catch (err) {
        console.error("[ClassEditor] Error loading foundation data:", err);
        setIsFoundationUsingD1(false);
      }
    };

    loadFoundation();

    if (id) {
      const fetchAllData = async () => {
        setInitialLoading(true);
        const startTime = performance.now();
        try {
          // 1. Fetch Class Data
          const data = await fetchDocument<any>('classes', id);

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
              toolsDisplayName: rawProf.toolsDisplayName || ''
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
              toolsDisplayName: rawMultiProf.toolsDisplayName || ''
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

    setProficiencies((prev: any) => {
      const isArmorLegacyStr = typeof prev.armor === 'string';
      const isWeaponLegacyStr = typeof prev.weapons === 'string';

      if (!isArmorLegacyStr && !isWeaponLegacyStr) return prev;

      return {
        ...prev,
        armor: isArmorLegacyStr
          ? { choiceCount: 0, optionIds: [], fixedIds: resolveLegacyProficiencyIds(prev.armor as string, allArmor) }
          : prev.armor,
        weapons: isWeaponLegacyStr
          ? { choiceCount: 0, optionIds: [], fixedIds: resolveLegacyProficiencyIds(prev.weapons as string, allWeapons) }
          : prev.weapons
      };
    });
  }, [allArmor, allWeapons]);

  const handleSaveFeature = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;

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
        parentId: id,
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

      if (editingFeature.id) {
        await upsertFeature(editingFeature.id, {
          ...featureData,
          createdAt: editingFeature.createdAt || new Date().toISOString()
        });
        queueRebake('feature', editingFeature.id);
      } else {
        const newId = crypto.randomUUID();
        await upsertFeature(newId, {
          ...featureData,
          createdAt: new Date().toISOString()
        });
        queueRebake('feature', newId);
      }
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
      await deleteDocument('features', featureId);
      toast.success('Feature deleted');
      setLoadTick(t => t + 1);
    } catch (error) {
      console.error("Error deleting feature:", error);
      toast.error('Failed to delete feature');
    }
  };

  const handleDeleteScaling = async (scalingId: string) => {
    try {
      await deleteDocument('scaling_columns', scalingId);
      toast.success('Scaling column deleted');
      setLoadTick(t => t + 1);
    } catch (error) {
      console.error("Error deleting scaling:", error);
      toast.error('Failed to delete scaling');
    }
  };

  const handleSave = async (e?: React.FormEvent) => {
    if (e) {
      e.preventDefault();
    }
    setLoading(true);

    try {
      const normalizedProficiencies = sanitizeProficiencyCollection({
        ...proficiencies,
        armorDisplayName: proficiencies.armorDisplayName || buildGroupedProficiencyDisplayName(proficiencies.armor, allArmor, allArmorCategories),
        weaponsDisplayName: proficiencies.weaponsDisplayName || buildGroupedProficiencyDisplayName(proficiencies.weapons, allWeapons, allWeaponCategories),
        toolsDisplayName: proficiencies.toolsDisplayName || buildGroupedProficiencyDisplayName(proficiencies.tools, allTools, allToolCategories)
      });
      const normalizedMulticlassProficiencies = sanitizeProficiencyCollection({
        ...multiclassProficiencies,
        armorDisplayName: multiclassProficiencies.armorDisplayName || buildGroupedProficiencyDisplayName(multiclassProficiencies.armor, allArmor, allArmorCategories),
        weaponsDisplayName: multiclassProficiencies.weaponsDisplayName || buildGroupedProficiencyDisplayName(multiclassProficiencies.weapons, allWeapons, allWeaponCategories),
        toolsDisplayName: multiclassProficiencies.toolsDisplayName || buildGroupedProficiencyDisplayName(multiclassProficiencies.tools, allTools, allToolCategories)
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

      const saveId = id || crypto.randomUUID();
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

      await upsertDocument('classes', saveId, d1Data);
      // Schedule a debounced R2 rebake for this class. Consecutive saves
      // reset the 1h clock; manual "Bake Now" bypasses the wait.
      queueRebake('class', saveId);

      if (!id) {
        navigate(`/compendium/classes/edit/${saveId}`);
      }
      setProficiencies(normalizedProficiencies);
      setMulticlassProficiencies(normalizedMulticlassProficiencies);
      setAdvancements(normalizedSyncedAdvancements);
      toast.success('Class saved successfully!');
      setLastSavedTick(Date.now());
    } catch (error) {
      console.error("Error saving class:", error);
      toast.error('Failed to save class.');
    } finally {
      setLoading(false);
    }
  };

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
  const classReferenceContext = {
    classIdentifier: getClassReferenceIdentifier(sourceId, name),
    classLabel: name || 'Class',
    spellcastingAbility: spellcasting.ability,
    classColumns: scalingColumns.map((column: any) => ({
      name: column.name,
      identifier: column.identifier,
      sourceId: column.sourceId,
      parentType: 'class',
    })),
  };
  const spellFormulaShortcuts = buildSpellFormulaShortcutRows(classReferenceContext);

  const toggleGroup = (items: any[], type: 'armor' | 'weapons' | 'tools' | 'languages', target: 'fixedIds' | 'optionIds', categoryId?: string) => {
    setProficiencies(buildNextGroupedProficiencyCollection(proficiencies, items, type, target, categoryId));
  };

  const toggleMulticlassGroup = (items: any[], type: 'armor' | 'weapons' | 'tools' | 'languages', target: 'fixedIds' | 'optionIds', categoryId?: string) => {
    setMulticlassProficiencies(buildNextGroupedProficiencyCollection(multiclassProficiencies, items, type, target, categoryId));
  };

  const syncGroupedDisplayName = (
    collection: any,
    setCollection: (value: any) => void,
    type: 'armor' | 'weapons' | 'tools',
    displayKey: 'armorDisplayName' | 'weaponsDisplayName' | 'toolsDisplayName',
    items: any[],
    categories: any[]
  ) => {
    setCollection({
      ...collection,
      [displayKey]: buildGroupedProficiencyDisplayName(collection[type], items, categories)
    });
  };

  if (initialLoading) {
    return (
      <div className="max-w-6xl mx-auto py-20 text-center space-y-4">
        <div className="font-serif italic text-gold animate-pulse">Consulting the archives...</div>
        <Button variant="ghost" size="sm" onClick={() => navigate('/compendium/classes')} className="text-ink/40">
          <ChevronLeft className="w-4 h-4 mr-2" /> Return to Compendium
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-20">
      <div className="section-header">
        <div className="flex items-center gap-4">
          <Link to={id ? `/compendium/classes/view/${id}` : '/compendium/classes'}>
            <Button variant="ghost" size="sm" className="text-gold gap-2 hover:bg-gold/5">
              <ChevronLeft className="w-4 h-4" /> Back
            </Button>
          </Link>
          <div className="flex items-center gap-4">
            <h1 className="h1-title text-ink">
              {id ? `Edit ${name || 'Class'}` : 'New Class'}
            </h1>
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
        </div>
        <div className="flex flex-col items-stretch gap-2 sm:items-end">
          <div className="flex items-center gap-2">
            <Button onClick={handleSave} disabled={loading} size="sm" className="btn-gold-solid gap-2">
              <Save className="w-4 h-4" /> Save Class
            </Button>
            <BakeNowButton
              kind="class"
              id={id}
              isDirty={isDirty}
              onSaveFirst={handleSave}
              size="sm"
              className="gap-2"
            />
          </div>
          <ReferenceSheetDialog
            title="Class Reference Sheet"
            triggerLabel="Open Reference Sheet"
            triggerIcon="scroll"
            triggerClassName="w-full sm:w-auto"
            context={classReferenceContext}
          />
        </div>
      </div>

      <div className="grid lg:grid-cols-4 gap-6">
        <div className="lg:col-span-3">
          <Tabs defaultValue="basic" className="w-full">
            <TabsList className="w-full h-auto flex flex-col gap-1 bg-transparent border-none p-0 mb-6">
              <div className="w-full grid grid-cols-2 lg:grid-cols-5 gap-1 bg-card/50 border border-gold/10 p-1 rounded-md">
                <TabsTrigger value="basic">Basic Info</TabsTrigger>
                <TabsTrigger value="proficiencies">Proficiencies</TabsTrigger>
                <TabsTrigger value="features" disabled={!id}>Class Features</TabsTrigger>
                <TabsTrigger value="spellcasting">Spellcasting</TabsTrigger>
                <TabsTrigger value="subclasses" disabled={!id}>Subclasses</TabsTrigger>
              </div>
              <div className="w-full grid grid-cols-2 lg:grid-cols-6 gap-1 bg-card/50 border border-gold/10 p-1 rounded-md">
                <TabsTrigger value="equipment">Equipment</TabsTrigger>
                <TabsTrigger value="multiclassing">Multiclassing</TabsTrigger>
                <TabsTrigger value="multiclass-proficiencies">Multiclass Profs</TabsTrigger>
                <TabsTrigger value="tags">Tags</TabsTrigger>
                <TabsTrigger value="progression">Progression</TabsTrigger>
                <TabsTrigger value="danger" disabled={!id}>Danger Zone</TabsTrigger>
              </div>
            </TabsList>

            <TabsContent value="basic" className="space-y-6 mt-0">
              {/* Basic Info */}
              <div className="p-4 border border-gold/20 bg-card/50 space-y-4">
                <h2 className="label-text text-gold border-b border-gold/10 pb-2">Basic Information</h2>
                <div className="flex flex-col md:flex-row gap-6">
                  {/* Left: image upload + Edit Display button */}
                  <div className="w-full md:w-1/3 space-y-2">
                    <label className="label-text text-gold/60">Class Icon / Artwork</label>
                    <ImageUpload
                      currentImageUrl={imageUrl}
                      storagePath={`images/classes/${id || 'new'}/`}
                      onUpload={setImageUrl}
                    />
                    {imageUrl && (
                      <div className="space-y-2 mt-2">
                        <Button
                          type="button"
                          size="sm"
                          className="w-full btn-gold gap-2"
                          onClick={() => setImageDialogOpen(true)}
                        >
                          <Sliders className="w-3 h-3" /> Edit Display
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="w-full h-8 text-xs text-blood/60 hover:text-blood hover:bg-blood/10 border border-blood/20 gap-2"
                          onClick={() => setImageUrl('')}
                        >
                          <Trash2 className="w-3 h-3" /> Delete Image
                        </Button>
                      </div>
                    )}
                  </div>

                  {/* Edit Display Dialog */}
                  <Dialog open={imageDialogOpen} onOpenChange={setImageDialogOpen}>
                    <DialogContent className="dialog-content sm:max-w-5xl w-[95vw]">
                      <DialogHeader className="dialog-header">
                        <DialogTitle className="dialog-title">Edit Image Display</DialogTitle>
                      </DialogHeader>
                      <div className="dialog-body max-h-[80vh]">
                        <ClassImageEditor
                          imageUrl={imageUrl}
                          onImageUrlChange={setImageUrl}
                          imageDisplay={imageDisplay}
                          onImageDisplayChange={setImageDisplay}
                          cardImageUrl={cardImageUrl}
                          onCardImageUrlChange={setCardImageUrl}
                          cardDisplay={cardDisplay}
                          onCardDisplayChange={setCardDisplay}
                          previewImageUrl={previewImageUrl}
                          onPreviewImageUrlChange={setPreviewImageUrl}
                          previewDisplay={previewDisplay}
                          onPreviewDisplayChange={setPreviewDisplay}
                          storagePath={`images/classes/${id || 'new'}/`}
                        />
                      </div>
                      <DialogFooter className="dialog-footer">
                        <Button onClick={() => setImageDialogOpen(false)} className="btn-gold-solid px-8 label-text">Done</Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>

                  {/* Right: fields */}
                  <div className="flex-1 grid sm:grid-cols-2 gap-4 h-fit">
                    <div className="space-y-1">
                      <label className="label-text">Class Name</label>
                      <Input
                        value={name}
                        onChange={e => setName(e.target.value)}
                        placeholder="e.g. Fighter"
                        className="h-8 text-sm bg-background/50 border-gold/10 focus:border-gold"
                      />
                    </div>
                    <div className="space-y-1">
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
                    </div>
                    <div className="space-y-1">
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
                    </div>
                    <div className="space-y-1">
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
                    </div>
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
                  <MarkdownEditor
                    value={description}
                    onChange={setDescription}
                    placeholder="A detailed explanation of how the class plays and what it does..."
                    minHeight="100px"
                    label="Class Description"
                  />
                  <MarkdownEditor
                    value={lore}
                    onChange={setLore}
                    placeholder="How this class fits into the setting's lore..."
                    minHeight="100px"
                    label="Class Lore"
                  />
                </div>
              </div>

            </TabsContent>
            {/* Subclasses */}
            {id && (
              <TabsContent value="subclasses" className="space-y-6 mt-0">
                <div className="p-4 border border-gold/20 bg-card/50 space-y-4">
                  <div className="section-header">
                    <h2 className="label-text text-gold">Subclasses</h2>
                    <Link to={`/compendium/subclasses/new?classId=${id}`}>
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
                    {subclasses.map(sub => (
                      <div key={sub.id} className="py-2 flex items-center justify-between group">
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-bold text-ink">{sub.name}</span>
                          <span className="text-[10px] text-ink/40 uppercase font-mono">
                            {sources.find(s => s.id === sub.sourceId)?.abbreviation || 'Unknown'}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Link to={`/compendium/subclasses/edit/${sub.id}`}>
                            <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-gold">
                              <Edit className="w-3 h-3" />
                            </Button>
                          </Link>
                        </div>
                      </div>
                    ))}
                    {subclasses.length === 0 && (
                      <p className="py-4 text-center muted-text italic text-[10px]">No subclasses added.</p>
                    )}
                  </div>
                </div>
              </TabsContent>
            )}

            {/* Proficiencies */}
            <TabsContent value="proficiencies" className="space-y-6 mt-0">
              <div className="p-4 border border-gold/20 bg-card/50 space-y-6">
                <div className="section-header">
                  <h2 className="label-text text-gold">Proficiencies</h2>
                  <Shield className="w-4 h-4 text-gold/40" />
                </div>

                <div className="space-y-8">
                  {/* Saving Throws Section */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between border-b border-gold/5 pb-2">
                      <h3 className="text-xs font-bold uppercase tracking-widest text-ink/60 flex items-center gap-2">
                        <Shield className="w-3.5 h-3.5 text-gold/40" /> Saving Throws
                      </h3>
                      <div className="flex items-center gap-2">
                        <label className="text-[10px] font-bold uppercase text-ink/40">Choices:</label>
                        <Input
                          type="number"
                          value={proficiencies.savingThrows?.choiceCount || 0}
                          onChange={e => setProficiencies({
                            ...proficiencies,
                            savingThrows: { ...proficiencies.savingThrows, choiceCount: parseInt(e.target.value) || 0 }
                          })}
                          className="w-12 h-6 text-center text-xs bg-background/50 border-gold/10"
                        />
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-gold/60">Choice Options</label>
                        <div className="flex flex-wrap gap-2">
                          {allAttributes.map(attr => {
                            const iden = (attr.identifier || attr.id).toUpperCase();
                            const isSelected = proficiencies.savingThrows?.optionIds?.includes(iden);
                            return (
                              <button
                                key={attr.id}
                                type="button"
                                onClick={() => {
                                  const currentOptions = proficiencies.savingThrows?.optionIds || [];
                                  setProficiencies({
                                    ...proficiencies,
                                    savingThrows: {
                                      ...proficiencies.savingThrows,
                                      optionIds: isSelected
                                        ? currentOptions.filter((id: string) => id !== iden)
                                        : [...currentOptions, iden]
                                    }
                                  });
                                }}
                                className={`px-4 py-1.5 rounded text-xs font-bold transition-all border ${isSelected
                                    ? 'bg-gold text-white border-gold'
                                    : 'bg-card text-gold/60 border-gold/10 hover:border-gold/20'
                                  }`}
                              >
                                {attr.name}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-gold/60">Given (Fixed)</label>
                        <div className="flex flex-wrap gap-2">
                          {allAttributes.map(attr => {
                            const iden = (attr.identifier || attr.id).toUpperCase();
                            const isFixed = proficiencies.savingThrows?.fixedIds?.includes(iden);
                            return (
                              <button
                                key={attr.id}
                                type="button"
                                onClick={() => {
                                  const currentFixed = proficiencies.savingThrows?.fixedIds || [];
                                  const newFixed = isFixed
                                    ? currentFixed.filter((id: string) => id !== iden)
                                    : [...currentFixed, iden];

                                  setProficiencies({
                                    ...proficiencies,
                                    savingThrows: {
                                      ...proficiencies.savingThrows,
                                      fixedIds: newFixed
                                    }
                                  });
                                  // Also sync legacy state for now to be safe, though we migrated handleSave
                                  setSavingThrows(newFixed);
                                }}
                                className={`px-4 py-1.5 rounded text-xs font-bold transition-all border ${isFixed
                                    ? 'bg-gold text-white border-gold'
                                    : 'bg-card text-gold/60 border-gold/10 hover:border-gold/20'
                                  }`}
                              >
                                {attr.name}
                              </button>
                            );
                          })}
                          {allAttributes.length === 0 && <p className="text-[10px] text-ink/30 italic col-span-2">No attributes defined. <Link to="/admin/proficiencies" className="text-gold underline">Manage Attributes</Link></p>}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Armor Section */}
                  <div className="space-y-4 pt-4 border-t border-gold/10">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-bold uppercase tracking-widest text-ink/60 flex items-center gap-2">
                        <Shield className="w-3.5 h-3.5 text-gold/40" /> Armor
                      </h3>
                      <div className="flex items-center gap-2">
                        <label className="text-[10px] font-bold uppercase text-ink/40">Choices:</label>
                        <Input
                          type="number"
                          value={proficiencies.armor.choiceCount}
                          onChange={e => setProficiencies({
                            ...proficiencies,
                            armor: { ...proficiencies.armor, choiceCount: parseInt(e.target.value) || 0 }
                          })}
                          className="w-12 h-6 text-center text-xs bg-background/50 border-gold/10"
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="label-text">Armor Display Name (e.g. Light Armor, Shields)</label>
                      <div className="flex gap-2">
                        <Input
                          value={proficiencies.armorDisplayName || ''}
                          onChange={e => setProficiencies({ ...proficiencies, armorDisplayName: e.target.value })}
                          placeholder="e.g. All armor, shields"
                          className="h-8 text-xs bg-background/50 border-gold/10 focus:border-gold"
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 text-[10px] uppercase font-bold border-gold/20"
                          onClick={() => syncGroupedDisplayName(proficiencies, setProficiencies, 'armor', 'armorDisplayName', allArmor, allArmorCategories)}
                        >
                          Sync
                        </Button>
                      </div>
                    </div>

                    <div className="grid sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-gold/60">Armor Options</label>
                        <div className="p-3 border border-gold/10 bg-background/30 rounded-md space-y-4">
                          {Object.entries(groupedArmor).sort().map(([category, items]) => {
                            const currentIds = new Set(proficiencies.armor.optionIds || []);
                            const allExist = (items as any[]).every(item => currentIds.has(item.id));
                            return (
                              <div key={`armor-options-${category}`} className="space-y-1">
                                <div className="flex items-center gap-2 border-b border-gold/5 pb-1 mb-1 group/header">
                                  <label className="flex items-center gap-2 cursor-pointer group/label">
                                    <div className={`w-3 h-3 rounded border flex items-center justify-center transition-all ${allExist ? 'bg-gold border-gold' : 'border-gold/30 group-hover/label:border-gold/50'}`}>
                                      {allExist && <Check className="w-2 h-2 text-white" />}
                                    </div>
                                    <input
                                      type="checkbox"
                                      className="hidden"
                                      checked={allExist}
                                      onChange={() => {
                                        const catId = allArmorCategories.find(c => c.name === category)?.id;
                                        toggleGroup(items as any[], 'armor', 'optionIds', catId);
                                      }}
                                    />
                                    <span className="text-[10px] font-black uppercase tracking-widest text-gold/40 italic">{category}</span>
                                  </label>
                                  {allExist && <span className="text-[9px] text-ink/20 ml-auto italic">All Selected</span>}
                                </div>
                                {!allExist && (
                                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                                    {(items as any[]).map(armor => {
                                      const isOption = proficiencies.armor.optionIds?.includes(armor.id);
                                      const isFixed = proficiencies.armor.fixedIds?.includes(armor.id);
                                      return (
                                        <label key={`armor-option-${armor.id}`} className="flex items-center gap-2 cursor-pointer group">
                                          <div className={`w-3 h-3 rounded border flex items-center justify-center transition-all ${isOption ? 'bg-gold border-gold' : 'border-gold/30 group-hover:border-gold/50'}`}>
                                            {isOption && <Check className="w-2 h-2 text-white" />}
                                          </div>
                                          <input
                                            type="checkbox"
                                            className="hidden"
                                            checked={isOption}
                                            onChange={e => {
                                              const current = proficiencies.armor.optionIds;
                                              const next = e.target.checked ? [...current, armor.id] : current.filter((id: string) => id !== armor.id);
                                              setProficiencies({ ...proficiencies, armor: { ...proficiencies.armor, optionIds: next } });
                                            }}
                                          />
                                          <span className="text-[10px] font-bold text-ink/60 truncate">{armor.name}</span>
                                        </label>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                          {allArmor.length === 0 && <p className="text-[10px] text-ink/30 italic">No armor defined.</p>}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-gold/60">Fixed Armor (Automatic)</label>
                        <div className="p-3 border border-gold/10 bg-background/30 rounded-md space-y-4">
                          {Object.entries(groupedArmor).sort().map(([category, items]) => {
                            const currentFixedIds = new Set(proficiencies.armor.fixedIds || []);
                            const allFixed = (items as any[]).every(item => currentFixedIds.has(item.id));
                            return (
                              <div key={`armor-fixed-${category}`} className="space-y-1">
                                <div className="flex items-center gap-2 border-b border-gold/5 pb-1 mb-1 group/header">
                                  <label className="flex items-center gap-2 cursor-pointer group/label">
                                    <div className={`w-3 h-3 rounded border flex items-center justify-center transition-all ${allFixed ? 'bg-gold border-gold' : 'border-gold/30 group-hover/label:border-gold/50'}`}>
                                      {allFixed && <Check className="w-2 h-2 text-white" />}
                                    </div>
                                    <input
                                      type="checkbox"
                                      className="hidden"
                                      checked={allFixed}
                                      onChange={() => {
                                        const catId = allArmorCategories.find(c => c.name === category)?.id;
                                        toggleGroup(items as any[], 'armor', 'fixedIds', catId);
                                      }}
                                    />
                                    <span className="text-[10px] font-black uppercase tracking-widest text-gold/40 italic">{category}</span>
                                  </label>
                                  {allFixed && <span className="text-[9px] text-ink/20 ml-auto italic">All Fixed</span>}
                                </div>
                                {!allFixed && (
                                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                                    {(items as any[]).map(armor => {
                                      const isFixed = proficiencies.armor.fixedIds?.includes(armor.id);
                                      return (
                                        <label key={`armor-fixed-item-${armor.id}`} className="flex items-center gap-2 cursor-pointer group">
                                          <div className={`w-3 h-3 rounded border flex items-center justify-center transition-all ${isFixed ? 'bg-gold border-gold' : 'border-gold/30 group-hover:border-gold/50'}`}>
                                            {isFixed && <Check className="w-2 h-2 text-white" />}
                                          </div>
                                          <input
                                            type="checkbox"
                                            className="hidden"
                                            checked={isFixed}
                                            onChange={e => {
                                              const current = proficiencies.armor.fixedIds;
                                              const next = e.target.checked ? [...current, armor.id] : current.filter((id: string) => id !== armor.id);
                                              const nextOptions = proficiencies.armor.optionIds;
                                              setProficiencies({ ...proficiencies, armor: { ...proficiencies.armor, fixedIds: next, optionIds: nextOptions } });
                                            }}
                                          />
                                          <span className="text-[10px] font-bold text-ink/60 truncate">{armor.name}</span>
                                        </label>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Weapons Section */}
                  <div className="space-y-4 pt-4 border-t border-gold/10">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-bold uppercase tracking-widest text-ink/60 flex items-center gap-2">
                        <Sword className="w-3.5 h-3.5 text-gold/40" /> Weapons
                      </h3>
                      <div className="flex items-center gap-2">
                        <label className="text-[10px] font-bold uppercase text-ink/40">Choices:</label>
                        <Input
                          type="number"
                          value={proficiencies.weapons.choiceCount}
                          onChange={e => setProficiencies({
                            ...proficiencies,
                            weapons: { ...proficiencies.weapons, choiceCount: parseInt(e.target.value) || 0 }
                          })}
                          className="w-12 h-6 text-center text-xs bg-background/50 border-gold/10"
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="label-text">Weapons Display Name (e.g. Simple weapons, martial weapons)</label>
                      <div className="flex gap-2">
                        <Input
                          value={proficiencies.weaponsDisplayName || ''}
                          onChange={e => setProficiencies({ ...proficiencies, weaponsDisplayName: e.target.value })}
                          placeholder="e.g. Simple weapons, martial weapons"
                          className="h-8 text-xs bg-background/50 border-gold/10 focus:border-gold"
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 text-[10px] uppercase font-bold border-gold/20"
                          onClick={() => syncGroupedDisplayName(proficiencies, setProficiencies, 'weapons', 'weaponsDisplayName', allWeapons, allWeaponCategories)}
                        >
                          Sync
                        </Button>
                      </div>
                    </div>

                    <div className="grid sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-gold/60">Weapon Options</label>
                        <div className="p-3 border border-gold/10 bg-background/30 rounded-md space-y-4">
                          {Object.entries(groupedWeapons).sort().map(([category, items]) => {
                            const currentIds = new Set(proficiencies.weapons.optionIds || []);
                            const allExist = (items as any[]).every(item => currentIds.has(item.id));
                            return (
                              <div key={`weapon-options-${category}`} className="space-y-1">
                                <div className="flex items-center gap-2 border-b border-gold/5 pb-1 mb-1 group/header">
                                  <label className="flex items-center gap-2 cursor-pointer group/label">
                                    <div className={`w-3 h-3 rounded border flex items-center justify-center transition-all ${allExist ? 'bg-gold border-gold' : 'border-gold/30 group-hover/label:border-gold/50'}`}>
                                      {allExist && <Check className="w-2 h-2 text-white" />}
                                    </div>
                                    <input
                                      type="checkbox"
                                      className="hidden"
                                      checked={allExist}
                                      onChange={() => {
                                        const catId = allWeaponCategories.find(c => c.name === category)?.id;
                                        toggleGroup(items as any[], 'weapons', 'optionIds', catId);
                                      }}
                                    />
                                    <span className="text-[10px] font-black uppercase tracking-widest text-gold/40 italic">{category}</span>
                                  </label>
                                  {allExist && <span className="text-[9px] text-ink/20 ml-auto italic">All Selected</span>}
                                </div>
                                {!allExist && (
                                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                                    {(items as any[]).map(weapon => {
                                      const isOption = proficiencies.weapons.optionIds?.includes(weapon.id);
                                      const isFixed = proficiencies.weapons.fixedIds?.includes(weapon.id);
                                      return (
                                        <label key={`weapon-option-${weapon.id}`} className="flex items-center gap-2 cursor-pointer group">
                                          <div className={`w-3 h-3 rounded border flex items-center justify-center transition-all ${isOption ? 'bg-gold border-gold' : 'border-gold/30 group-hover:border-gold/50'}`}>
                                            {isOption && <Check className="w-2 h-2 text-white" />}
                                          </div>
                                          <input
                                            type="checkbox"
                                            className="hidden"
                                            checked={isOption}
                                            onChange={e => {
                                              const current = proficiencies.weapons.optionIds;
                                              const next = e.target.checked ? [...current, weapon.id] : current.filter((id: string) => id !== weapon.id);
                                              setProficiencies({ ...proficiencies, weapons: { ...proficiencies.weapons, optionIds: next } });
                                            }}
                                          />
                                          <span className="text-[10px] font-bold text-ink/60 truncate">{weapon.name}</span>
                                        </label>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-gold/60">Fixed Weapons (Automatic)</label>
                        <div className="p-3 border border-gold/10 bg-background/30 rounded-md space-y-4">
                          {Object.entries(groupedWeapons).sort().map(([category, items]) => {
                            const currentFixedIds = new Set(proficiencies.weapons.fixedIds || []);
                            const allFixed = (items as any[]).every(item => currentFixedIds.has(item.id));
                            return (
                              <div key={`weapon-fixed-${category}`} className="space-y-1">
                                <div className="flex items-center gap-2 border-b border-gold/5 pb-1 mb-1 group/header">
                                  <label className="flex items-center gap-2 cursor-pointer group/label">
                                    <div className={`w-3 h-3 rounded border flex items-center justify-center transition-all ${allFixed ? 'bg-gold border-gold' : 'border-gold/30 group-hover/label:border-gold/50'}`}>
                                      {allFixed && <Check className="w-2 h-2 text-white" />}
                                    </div>
                                    <input
                                      type="checkbox"
                                      className="hidden"
                                      checked={allFixed}
                                      onChange={() => {
                                        const catId = allWeaponCategories.find(c => c.name === category)?.id;
                                        toggleGroup(items as any[], 'weapons', 'fixedIds', catId);
                                      }}
                                    />
                                    <span className="text-[10px] font-black uppercase tracking-widest text-gold/40 italic">{category}</span>
                                  </label>
                                  {allFixed && <span className="text-[9px] text-ink/20 ml-auto italic">All Fixed</span>}
                                </div>
                                {!allFixed && (
                                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                                    {(items as any[]).map(weapon => {
                                      const isFixed = proficiencies.weapons.fixedIds?.includes(weapon.id);
                                      return (
                                        <label key={`weapon-fixed-item-${weapon.id}`} className="flex items-center gap-2 cursor-pointer group">
                                          <div className={`w-3 h-3 rounded border flex items-center justify-center transition-all ${isFixed ? 'bg-gold border-gold' : 'border-gold/30 group-hover:border-gold/50'}`}>
                                            {isFixed && <Check className="w-2 h-2 text-white" />}
                                          </div>
                                          <input
                                            type="checkbox"
                                            className="hidden"
                                            checked={isFixed}
                                            onChange={e => {
                                              const current = proficiencies.weapons.fixedIds;
                                              const next = e.target.checked ? [...current, weapon.id] : current.filter((id: string) => id !== weapon.id);
                                              const nextOptions = proficiencies.weapons.optionIds;
                                              setProficiencies({ ...proficiencies, weapons: { ...proficiencies.weapons, fixedIds: next, optionIds: nextOptions } });
                                            }}
                                          />
                                          <span className="text-[10px] font-bold text-ink/60 truncate">{weapon.name}</span>
                                        </label>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-6 pt-4 border-t border-gold/10">
                  {/* Skills Section */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-bold uppercase tracking-widest text-ink/60">Skills</h3>
                      <div className="flex items-center gap-2">
                        <label className="text-[10px] font-bold uppercase text-ink/40">Choices:</label>
                        <Input
                          type="number"
                          value={proficiencies.skills.choiceCount}
                          onChange={e => setProficiencies({
                            ...proficiencies,
                            skills: { ...proficiencies.skills, choiceCount: parseInt(e.target.value) || 0 }
                          })}
                          className="w-12 h-6 text-center text-xs bg-background/50 border-gold/10"
                        />
                      </div>
                    </div>

                    <div className="grid sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-gold/60">Skill Options</label>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 p-3 border border-gold/10 bg-background/30 rounded-md min-h-[100px]">
                          {allSkills.map(skill => {
                            const isOption = proficiencies.skills.optionIds?.includes(skill.id);
                            const isFixed = proficiencies.skills.fixedIds?.includes(skill.id);
                            return (
                              <label
                                key={skill.id}
                                className={`flex items-center gap-2 cursor-pointer group ${isFixed ? 'opacity-50 cursor-not-allowed' : ''}`}
                              >
                                <div className={`w-3 h-3 rounded border flex items-center justify-center transition-all ${isOption || isFixed ? 'bg-gold border-gold' : 'border-gold/30 group-hover:border-gold/50'}`}>
                                  {(isOption || isFixed) && <Check className="w-2 h-2 text-white" />}
                                </div>
                                <input
                                  type="checkbox"
                                  className="hidden"
                                  disabled={isFixed}
                                  checked={isOption || isFixed}
                                  onChange={e => {
                                    const current = proficiencies.skills.optionIds;
                                    const next = e.target.checked ? [...current, skill.id] : current.filter((id: string) => id !== skill.id);
                                    setProficiencies({
                                      ...proficiencies,
                                      skills: { ...proficiencies.skills, optionIds: next }
                                    });
                                  }}
                                />
                                <span className="text-[10px] font-bold text-ink/60 truncate">{skill.name}</span>
                              </label>
                            );
                          })}
                          {allSkills.length === 0 && <p className="text-[10px] text-ink/30 italic col-span-2">No skills defined. <Link to="/compendium/skills" className="text-gold underline">Add skills</Link></p>}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-gold/60">Fixed Skills (Automatic)</label>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 p-3 border border-gold/10 bg-background/30 rounded-md min-h-[100px]">
                          {allSkills.map(skill => {
                            const isFixed = proficiencies.skills.fixedIds?.includes(skill.id);
                            return (
                              <label
                                key={skill.id}
                                className="flex items-center gap-2 cursor-pointer group"
                              >
                                <div className={`w-3 h-3 rounded border flex items-center justify-center transition-all ${isFixed ? 'bg-gold border-gold' : 'border-gold/30 group-hover:border-gold/50'}`}>
                                  {isFixed && <Check className="w-2 h-2 text-white" />}
                                </div>
                                <input
                                  type="checkbox"
                                  className="hidden"
                                  checked={isFixed}
                                  onChange={e => {
                                    const current = proficiencies.skills.fixedIds;
                                    const next = e.target.checked ? [...current, skill.id] : current.filter((id: string) => id !== skill.id);

                                    // If adding to fixed, remove from options
                                    let nextOptions = proficiencies.skills.optionIds;
                                    if (e.target.checked) {
                                      nextOptions = nextOptions.filter((id: string) => id !== skill.id);
                                    }

                                    setProficiencies({
                                      ...proficiencies,
                                      skills: { ...proficiencies.skills, fixedIds: next, optionIds: nextOptions }
                                    });
                                  }}
                                />
                                <span className="text-[10px] font-bold text-ink/60 truncate">{skill.name}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Tools Section */}
                  <div className="space-y-4 pt-4 border-t border-gold/10">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-bold uppercase tracking-widest text-ink/60 flex items-center gap-2">
                        <Hammer className="w-3.5 h-3.5 text-gold/40" /> Tools
                      </h3>
                      <div className="flex items-center gap-2">
                        <label className="text-[10px] font-bold uppercase text-ink/40">Choices:</label>
                        <Input
                          type="number"
                          value={proficiencies.tools.choiceCount}
                          onChange={e => setProficiencies({
                            ...proficiencies,
                            tools: { ...proficiencies.tools, choiceCount: parseInt(e.target.value) || 0 }
                          })}
                          className="w-12 h-6 text-center text-xs bg-background/50 border-gold/10"
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="label-text text-[10px] text-gold/60">Tools Display Name (e.g. any three artisan's tools)</label>
                      <div className="flex gap-2">
                        <Input
                          value={proficiencies.toolsDisplayName || ''}
                          onChange={e => setProficiencies({ ...proficiencies, toolsDisplayName: e.target.value })}
                          placeholder="e.g. Any three artisan's tools"
                          className="h-8 text-xs bg-background/50 border-gold/10 focus:border-gold"
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 text-[10px] uppercase font-bold border-gold/20"
                          onClick={() => syncGroupedDisplayName(proficiencies, setProficiencies, 'tools', 'toolsDisplayName', allTools, allToolCategories)}
                        >
                          Sync
                        </Button>
                      </div>
                    </div>

                    <div className="grid sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-gold/60">Tool Options</label>
                        <div className="p-3 border border-gold/10 bg-background/30 rounded-md space-y-4">
                          {Object.entries(groupedTools).sort().map(([categoryName, items]) => {
                            const catId = allToolCategories.find(c => c.name === categoryName)?.id;
                            const currentIds = new Set(proficiencies.tools.optionIds || []);
                            const allExist = (items as any[]).every(item => currentIds.has(item.id));
                            return (
                              <div key={`tool-options-${categoryName}`} className="space-y-1">
                                <div className="flex items-center gap-2 border-b border-gold/5 pb-1 mb-1 group/header">
                                  <label className="flex items-center gap-2 cursor-pointer group/label">
                                    <div className={`w-3 h-3 rounded border flex items-center justify-center transition-all ${allExist ? 'bg-gold border-gold' : 'border-gold/30 group-hover/label:border-gold/50'}`}>
                                      {allExist && <Check className="w-2 h-2 text-white" />}
                                    </div>
                                    <input
                                      type="checkbox"
                                      className="hidden"
                                      checked={allExist}
                                      onChange={() => toggleGroup(items as any[], 'tools', 'optionIds', catId)}
                                    />
                                    <span className="text-[10px] font-black uppercase tracking-widest text-gold/40 italic">{categoryName}</span>
                                  </label>
                                  {allExist && <span className="text-[9px] text-ink/20 ml-auto italic">All Selected</span>}
                                </div>
                                {!allExist && (
                                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                                    {(items as any[]).map(tool => {
                                      const isOption = proficiencies.tools.optionIds?.includes(tool.id);
                                      const isFixed = proficiencies.tools.fixedIds?.includes(tool.id);
                                      return (
                                        <label key={`tool-option-${tool.id}`} className="flex items-center gap-2 cursor-pointer group">
                                          <div className={`w-3 h-3 rounded border flex items-center justify-center transition-all ${isOption ? 'bg-gold border-gold' : 'border-gold/30 group-hover:border-gold/50'}`}>
                                            {isOption && <Check className="w-2 h-2 text-white" />}
                                          </div>
                                          <input
                                            type="checkbox"
                                            className="hidden"
                                            checked={isOption}
                                            onChange={e => {
                                              const current = proficiencies.tools.optionIds;
                                              const next = e.target.checked ? [...current, tool.id] : current.filter((id: string) => id !== tool.id);
                                              setProficiencies({ ...proficiencies, tools: { ...proficiencies.tools, optionIds: next } });
                                            }}
                                          />
                                          <span className="text-[10px] font-bold text-ink/60 truncate">{tool.name}</span>
                                        </label>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                          {allTools.length === 0 && <p className="text-[10px] text-ink/30 italic col-span-2">No tools defined. <Link to="/compendium/tools" className="text-gold underline">Add tools</Link></p>}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-gold/60">Fixed Tools (Automatic)</label>
                        <div className="p-3 border border-gold/10 bg-background/30 rounded-md space-y-4">
                          {Object.entries(groupedTools).sort().map(([categoryName, items]) => {
                            const catId = allToolCategories.find(c => c.name === categoryName)?.id;
                            const currentFixedIds = new Set(proficiencies.tools.fixedIds || []);
                            const allFixed = (items as any[]).every(item => currentFixedIds.has(item.id));
                            return (
                              <div key={`tool-fixed-${categoryName}`} className="space-y-1">
                                <div className="flex items-center gap-2 border-b border-gold/5 pb-1 mb-1 group/header">
                                  <label className="flex items-center gap-2 cursor-pointer group/label">
                                    <div className={`w-3 h-3 rounded border flex items-center justify-center transition-all ${allFixed ? 'bg-gold border-gold' : 'border-gold/30 group-hover:border-gold/50'}`}>
                                      {allFixed && <Check className="w-2 h-2 text-white" />}
                                    </div>
                                    <input
                                      type="checkbox"
                                      className="hidden"
                                      checked={allFixed}
                                      onChange={() => toggleGroup(items as any[], 'tools', 'fixedIds', catId)}
                                    />
                                    <span className="text-[10px] font-black uppercase tracking-widest text-gold/40 italic">{categoryName}</span>
                                  </label>
                                  {allFixed && <span className="text-[9px] text-ink/20 ml-auto italic">All Selected</span>}
                                </div>
                                {!allFixed && (
                                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                                    {(items as any[]).map(tool => {
                                      const isFixed = proficiencies.tools.fixedIds?.includes(tool.id);
                                      return (
                                        <label key={`tool-fixed-item-${tool.id}`} className="flex items-center gap-2 cursor-pointer group">
                                          <div className={`w-3 h-3 rounded border flex items-center justify-center transition-all ${isFixed ? 'bg-gold border-gold' : 'border-gold/30 group-hover:border-gold/50'}`}>
                                            {isFixed && <Check className="w-2 h-2 text-white" />}
                                          </div>
                                          <input
                                            type="checkbox"
                                            className="hidden"
                                            checked={isFixed}
                                            onChange={e => {
                                              const current = proficiencies.tools.fixedIds;
                                              const next = e.target.checked ? [...current, tool.id] : current.filter((id: string) => id !== tool.id);

                                              // If adding to fixed, remove from options
                                              setProficiencies({
                                                ...proficiencies,
                                                tools: { ...proficiencies.tools, fixedIds: next, optionIds: proficiencies.tools.optionIds }
                                              });
                                            }}
                                          />
                                          <span className="text-[10px] font-bold text-ink/60 truncate">{tool.name}</span>
                                        </label>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Languages Section */}
                  <div className="space-y-4 pt-4 border-t border-gold/10">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-bold uppercase tracking-widest text-ink/60 flex items-center gap-2">
                        <MessageCircle className="w-3.5 h-3.5 text-gold/40" /> Languages
                      </h3>
                      <div className="flex items-center gap-2">
                        <label className="text-[10px] font-bold uppercase text-ink/40">Choices:</label>
                        <Input
                          type="number"
                          value={proficiencies.languages.choiceCount}
                          onChange={e => setProficiencies({
                            ...proficiencies,
                            languages: { ...proficiencies.languages, choiceCount: parseInt(e.target.value) || 0 }
                          })}
                          className="w-12 h-6 text-center text-xs bg-background/50 border-gold/10"
                        />
                      </div>
                    </div>

                    <div className="grid sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-gold/60">Language Options</label>
                        <div className="p-3 border border-gold/10 bg-background/30 rounded-md space-y-4">
                          {Object.entries(groupedLanguages).sort().map(([categoryName, items]) => {
                            const catId = allLanguageCategories.find(c => c.name === categoryName)?.id;
                            const currentIds = new Set(proficiencies.languages.optionIds || []);
                            const allExist = (items as any[]).every(item => currentIds.has(item.id));
                            return (
                              <div key={`lang-options-${categoryName}`} className="space-y-1">
                                <div className="flex items-center gap-2 border-b border-gold/5 pb-1 mb-1 group/header">
                                  <label className="flex items-center gap-2 cursor-pointer group/label">
                                    <div className={`w-3 h-3 rounded border flex items-center justify-center transition-all ${allExist ? 'bg-gold border-gold' : 'border-gold/30 group-hover/label:border-gold/50'}`}>
                                      {allExist && <Check className="w-2 h-2 text-white" />}
                                    </div>
                                    <input
                                      type="checkbox"
                                      className="hidden"
                                      checked={allExist}
                                      onChange={() => toggleGroup(items as any[], 'languages', 'optionIds', catId)}
                                    />
                                    <span className="text-[10px] font-black uppercase tracking-widest text-gold/40 italic">{categoryName}</span>
                                  </label>
                                  {allExist && <span className="text-[9px] text-ink/20 ml-auto italic">All Selected</span>}
                                </div>
                                {!allExist && (
                                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                                    {(items as any[]).map(lang => {
                                      const isOption = proficiencies.languages.optionIds?.includes(lang.id);
                                      const isFixed = proficiencies.languages.fixedIds?.includes(lang.id);
                                      return (
                                        <label key={`lang-option-${lang.id}`} className="flex items-center gap-2 cursor-pointer group">
                                          <div className={`w-3 h-3 rounded border flex items-center justify-center transition-all ${isOption ? 'bg-gold border-gold' : 'border-gold/30 group-hover:border-gold/50'}`}>
                                            {isOption && <Check className="w-2 h-2 text-white" />}
                                          </div>
                                          <input
                                            type="checkbox"
                                            className="hidden"
                                            checked={isOption}
                                            onChange={e => {
                                              const current = proficiencies.languages.optionIds;
                                              const next = e.target.checked ? [...current, lang.id] : current.filter((id: string) => id !== lang.id);
                                              setProficiencies({ ...proficiencies, languages: { ...proficiencies.languages, optionIds: next } });
                                            }}
                                          />
                                          <span className="text-[10px] font-bold text-ink/60 truncate">{lang.name}</span>
                                        </label>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                          {allLanguages.length === 0 && <p className="text-[10px] text-ink/30 italic col-span-2">No languages defined. <Link to="/admin/proficiencies" className="text-gold underline">Manage Languages</Link></p>}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-gold/60">Fixed Languages (Automatic)</label>
                        <div className="p-3 border border-gold/10 bg-background/30 rounded-md space-y-4">
                          {Object.entries(groupedLanguages).sort().map(([categoryName, items]) => {
                            const catId = allLanguageCategories.find(c => c.name === categoryName)?.id;
                            const currentFixedIds = new Set(proficiencies.languages.fixedIds || []);
                            const allFixed = (items as any[]).every(item => currentFixedIds.has(item.id));
                            return (
                              <div key={`lang-fixed-${categoryName}`} className="space-y-1">
                                <div className="flex items-center gap-2 border-b border-gold/5 pb-1 mb-1 group/header">
                                  <label className="flex items-center gap-2 cursor-pointer group/label">
                                    <div className={`w-3 h-3 rounded border flex items-center justify-center transition-all ${allFixed ? 'bg-gold border-gold' : 'border-gold/30 group-hover/label:border-gold/50'}`}>
                                      {allFixed && <Check className="w-2 h-2 text-white" />}
                                    </div>
                                    <input
                                      type="checkbox"
                                      className="hidden"
                                      checked={allFixed}
                                      onChange={() => toggleGroup(items as any[], 'languages', 'fixedIds', catId)}
                                    />
                                    <span className="text-[10px] font-black uppercase tracking-widest text-gold/40 italic">{categoryName}</span>
                                  </label>
                                  {allFixed && <span className="text-[9px] text-ink/20 ml-auto italic">All Selected</span>}
                                </div>
                                {!allFixed && (
                                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                                    {(items as any[]).map(lang => {
                                      const isFixed = proficiencies.languages.fixedIds?.includes(lang.id);
                                      return (
                                        <label key={`lang-fixed-item-${lang.id}`} className="flex items-center gap-2 cursor-pointer group">
                                          <div className={`w-3 h-3 rounded border flex items-center justify-center transition-all ${isFixed ? 'bg-gold border-gold' : 'border-gold/30 group-hover:border-gold/50'}`}>
                                            {isFixed && <Check className="w-2 h-2 text-white" />}
                                          </div>
                                          <input
                                            type="checkbox"
                                            className="hidden"
                                            checked={isFixed}
                                            onChange={e => {
                                              const current = proficiencies.languages.fixedIds;
                                              const next = e.target.checked ? [...current, lang.id] : current.filter((id: string) => id !== lang.id);

                                              // If adding to fixed, remove from options
                                              setProficiencies({
                                                ...proficiencies,
                                                languages: { ...proficiencies.languages, fixedIds: next, optionIds: proficiencies.languages.optionIds }
                                              });
                                            }}
                                          />
                                          <span className="text-[10px] font-bold text-ink/60 truncate">{lang.name}</span>
                                        </label>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

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
                  <Wand2 className="w-4 h-4 text-gold/40" />
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
                          <option value="custom">Custom / Pact</option>
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
                          />
                        </div>
                      </fieldset>
                    )}

                    <div className="space-y-4">
                      <div className="grid sm:grid-cols-2 gap-4">
                        {spellcasting.progressionId === 'custom' && (
                          <div className="space-y-1">
                            <label className="label-text">Alternative Progression (Pact / Focus Slots)</label>
                            <div className="flex gap-1">
                              <select
                                value={spellcasting.altProgressionId}
                                onChange={e => setSpellcasting({ ...spellcasting, altProgressionId: e.target.value })}
                                className="flex-1 h-8 px-2 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-xs text-ink"
                              >
                                <option value="">None</option>
                                {pactScalings.map(s => (
                                  <option key={s.id} value={s.id}>{s.name}</option>
                                ))}
                              </select>
                            </div>
                            <p className="text-[9px] text-ink/40 italic">Use this only for separate alternative slot systems such as Pact-style casting. (Editing UI deprecated; uses existing entries only.)</p>
                          </div>
                        )}

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
              {/* Features */}
              {id && (
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
                    {features.map((feature) => (
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
                    {features.length === 0 && <p className="py-4 text-center muted-text italic">No features added.</p>}
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
            <TabsContent value="multiclass-proficiencies" className="space-y-6 mt-0">
              <div className="p-4 border border-gold/20 bg-card/50 space-y-6">
                <div className="section-header">
                  <h2 className="label-text text-gold">Multiclass Proficiencies</h2>
                  <Shield className="w-4 h-4 text-gold/40" />
                </div>

                <div className="space-y-8">
                  {/* Saving Throws Section */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between border-b border-gold/5 pb-2">
                      <h3 className="text-xs font-bold uppercase tracking-widest text-ink/60 flex items-center gap-2">
                        <Shield className="w-3.5 h-3.5 text-gold/40" /> Saving Throws
                      </h3>
                      <div className="flex items-center gap-2">
                        <label className="text-[10px] font-bold uppercase text-ink/40">Choices:</label>
                        <Input
                          type="number"
                          value={multiclassProficiencies.savingThrows?.choiceCount || 0}
                          onChange={e => setMulticlassProficiencies({
                            ...multiclassProficiencies,
                            savingThrows: { ...multiclassProficiencies.savingThrows, choiceCount: parseInt(e.target.value) || 0 }
                          })}
                          className="w-12 h-6 text-center text-xs bg-background/50 border-gold/10"
                        />
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-gold/60">Choice Options</label>
                        <div className="flex flex-wrap gap-2">
                          {allAttributes.map(attr => {
                            const iden = (attr.identifier || attr.id).toUpperCase();
                            const isSelected = multiclassProficiencies.savingThrows?.optionIds?.includes(iden);
                            return (
                              <button
                                key={attr.id}
                                type="button"
                                onClick={() => {
                                  const currentOptions = multiclassProficiencies.savingThrows?.optionIds || [];
                                  setMulticlassProficiencies({
                                    ...multiclassProficiencies,
                                    savingThrows: {
                                      ...multiclassProficiencies.savingThrows,
                                      optionIds: isSelected
                                        ? currentOptions.filter((id: string) => id !== iden)
                                        : [...currentOptions, iden]
                                    }
                                  });
                                }}
                                className={`px-4 py-1.5 rounded text-xs font-bold transition-all border ${isSelected
                                    ? 'bg-gold text-white border-gold'
                                    : 'bg-card text-gold/60 border-gold/10 hover:border-gold/20'
                                  }`}
                              >
                                {attr.name}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-gold/60">Given (Fixed)</label>
                        <div className="flex flex-wrap gap-2">
                          {allAttributes.map(attr => {
                            const iden = (attr.identifier || attr.id).toUpperCase();
                            const isFixed = multiclassProficiencies.savingThrows?.fixedIds?.includes(iden);
                            return (
                              <button
                                key={attr.id}
                                type="button"
                                onClick={() => {
                                  const currentFixed = multiclassProficiencies.savingThrows?.fixedIds || [];
                                  const newFixed = isFixed
                                    ? currentFixed.filter((id: string) => id !== iden)
                                    : [...currentFixed, iden];

                                  setMulticlassProficiencies({
                                    ...multiclassProficiencies,
                                    savingThrows: {
                                      ...multiclassProficiencies.savingThrows,
                                      fixedIds: newFixed
                                    }
                                  });
                                  // Also sync legacy state for now to be safe, though we migrated handleSave
                                  setSavingThrows(newFixed);
                                }}
                                className={`px-4 py-1.5 rounded text-xs font-bold transition-all border ${isFixed
                                    ? 'bg-gold text-white border-gold'
                                    : 'bg-card text-gold/60 border-gold/10 hover:border-gold/20'
                                  }`}
                              >
                                {attr.name}
                              </button>
                            );
                          })}
                          {allAttributes.length === 0 && <p className="text-[10px] text-ink/30 italic col-span-2">No attributes defined. <Link to="/admin/proficiencies" className="text-gold underline">Manage Attributes</Link></p>}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Armor Section */}
                  <div className="space-y-4 pt-4 border-t border-gold/10">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-bold uppercase tracking-widest text-ink/60 flex items-center gap-2">
                        <Shield className="w-3.5 h-3.5 text-gold/40" /> Armor
                      </h3>
                      <div className="flex items-center gap-2">
                        <label className="text-[10px] font-bold uppercase text-ink/40">Choices:</label>
                        <Input
                          type="number"
                          value={multiclassProficiencies.armor.choiceCount}
                          onChange={e => setMulticlassProficiencies({
                            ...multiclassProficiencies,
                            armor: { ...multiclassProficiencies.armor, choiceCount: parseInt(e.target.value) || 0 }
                          })}
                          className="w-12 h-6 text-center text-xs bg-background/50 border-gold/10"
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="label-text">Armor Display Name (e.g. Light Armor, Shields)</label>
                      <div className="flex gap-2">
                        <Input
                          value={multiclassProficiencies.armorDisplayName || ''}
                          onChange={e => setMulticlassProficiencies({ ...multiclassProficiencies, armorDisplayName: e.target.value })}
                          placeholder="e.g. All armor, shields"
                          className="h-8 text-xs bg-background/50 border-gold/10 focus:border-gold"
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 text-[10px] uppercase font-bold border-gold/20"
                          onClick={() => syncGroupedDisplayName(multiclassProficiencies, setMulticlassProficiencies, 'armor', 'armorDisplayName', allArmor, allArmorCategories)}
                        >
                          Sync
                        </Button>
                      </div>
                    </div>

                    <div className="grid sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-gold/60">Armor Options</label>
                        <div className="p-3 border border-gold/10 bg-background/30 rounded-md space-y-4">
                          {Object.entries(groupedArmor).sort().map(([category, items]) => {
                            const currentIds = new Set(multiclassProficiencies.armor.optionIds || []);
                            const allExist = (items as any[]).every(item => currentIds.has(item.id));
                            return (
                              <div key={`armor-options-${category}`} className="space-y-1">
                                <div className="flex items-center gap-2 border-b border-gold/5 pb-1 mb-1 group/header">
                                  <label className="flex items-center gap-2 cursor-pointer group/label">
                                    <div className={`w-3 h-3 rounded border flex items-center justify-center transition-all ${allExist ? 'bg-gold border-gold' : 'border-gold/30 group-hover/label:border-gold/50'}`}>
                                      {allExist && <Check className="w-2 h-2 text-white" />}
                                    </div>
                                    <input
                                      type="checkbox"
                                      className="hidden"
                                      checked={allExist}
                                      onChange={() => {
                                        const catId = allArmorCategories.find(c => c.name === category)?.id;
                                        toggleMulticlassGroup(items as any[], 'armor', 'optionIds', catId);
                                      }}
                                    />
                                    <span className="text-[10px] font-black uppercase tracking-widest text-gold/40 italic">{category}</span>
                                  </label>
                                  {allExist && <span className="text-[9px] text-ink/20 ml-auto italic">All Selected</span>}
                                </div>
                                {!allExist && (
                                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                                    {(items as any[]).map(armor => {
                                      const isOption = multiclassProficiencies.armor.optionIds?.includes(armor.id);
                                      const isFixed = multiclassProficiencies.armor.fixedIds?.includes(armor.id);
                                      return (
                                        <label key={`armor-option-${armor.id}`} className="flex items-center gap-2 cursor-pointer group">
                                          <div className={`w-3 h-3 rounded border flex items-center justify-center transition-all ${isOption ? 'bg-gold border-gold' : 'border-gold/30 group-hover:border-gold/50'}`}>
                                            {isOption && <Check className="w-2 h-2 text-white" />}
                                          </div>
                                          <input
                                            type="checkbox"
                                            className="hidden"
                                            checked={isOption}
                                            onChange={e => {
                                              const current = multiclassProficiencies.armor.optionIds;
                                              const next = e.target.checked ? [...current, armor.id] : current.filter((id: string) => id !== armor.id);
                                              setMulticlassProficiencies({ ...multiclassProficiencies, armor: { ...multiclassProficiencies.armor, optionIds: next } });
                                            }}
                                          />
                                          <span className="text-[10px] font-bold text-ink/60 truncate">{armor.name}</span>
                                        </label>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                          {allArmor.length === 0 && <p className="text-[10px] text-ink/30 italic">No armor defined.</p>}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-gold/60">Fixed Armor (Automatic)</label>
                        <div className="p-3 border border-gold/10 bg-background/30 rounded-md space-y-4">
                          {Object.entries(groupedArmor).sort().map(([category, items]) => {
                            const currentFixedIds = new Set(multiclassProficiencies.armor.fixedIds || []);
                            const allFixed = (items as any[]).every(item => currentFixedIds.has(item.id));
                            return (
                              <div key={`armor-fixed-${category}`} className="space-y-1">
                                <div className="flex items-center gap-2 border-b border-gold/5 pb-1 mb-1 group/header">
                                  <label className="flex items-center gap-2 cursor-pointer group/label">
                                    <div className={`w-3 h-3 rounded border flex items-center justify-center transition-all ${allFixed ? 'bg-gold border-gold' : 'border-gold/30 group-hover/label:border-gold/50'}`}>
                                      {allFixed && <Check className="w-2 h-2 text-white" />}
                                    </div>
                                    <input
                                      type="checkbox"
                                      className="hidden"
                                      checked={allFixed}
                                      onChange={() => {
                                        const catId = allArmorCategories.find(c => c.name === category)?.id;
                                        toggleMulticlassGroup(items as any[], 'armor', 'fixedIds', catId);
                                      }}
                                    />
                                    <span className="text-[10px] font-black uppercase tracking-widest text-gold/40 italic">{category}</span>
                                  </label>
                                  {allFixed && <span className="text-[9px] text-ink/20 ml-auto italic">All Fixed</span>}
                                </div>
                                {!allFixed && (
                                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                                    {(items as any[]).map(armor => {
                                      const isFixed = multiclassProficiencies.armor.fixedIds?.includes(armor.id);
                                      return (
                                        <label key={`armor-fixed-item-${armor.id}`} className="flex items-center gap-2 cursor-pointer group">
                                          <div className={`w-3 h-3 rounded border flex items-center justify-center transition-all ${isFixed ? 'bg-gold border-gold' : 'border-gold/30 group-hover:border-gold/50'}`}>
                                            {isFixed && <Check className="w-2 h-2 text-white" />}
                                          </div>
                                          <input
                                            type="checkbox"
                                            className="hidden"
                                            checked={isFixed}
                                            onChange={e => {
                                              const current = multiclassProficiencies.armor.fixedIds;
                                              const next = e.target.checked ? [...current, armor.id] : current.filter((id: string) => id !== armor.id);
                                              const nextOptions = multiclassProficiencies.armor.optionIds;
                                              setMulticlassProficiencies({ ...multiclassProficiencies, armor: { ...multiclassProficiencies.armor, fixedIds: next, optionIds: nextOptions } });
                                            }}
                                          />
                                          <span className="text-[10px] font-bold text-ink/60 truncate">{armor.name}</span>
                                        </label>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Weapons Section */}
                  <div className="space-y-4 pt-4 border-t border-gold/10">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-bold uppercase tracking-widest text-ink/60 flex items-center gap-2">
                        <Sword className="w-3.5 h-3.5 text-gold/40" /> Weapons
                      </h3>
                      <div className="flex items-center gap-2">
                        <label className="text-[10px] font-bold uppercase text-ink/40">Choices:</label>
                        <Input
                          type="number"
                          value={multiclassProficiencies.weapons.choiceCount}
                          onChange={e => setMulticlassProficiencies({
                            ...multiclassProficiencies,
                            weapons: { ...multiclassProficiencies.weapons, choiceCount: parseInt(e.target.value) || 0 }
                          })}
                          className="w-12 h-6 text-center text-xs bg-background/50 border-gold/10"
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="label-text">Weapons Display Name (e.g. Simple weapons, martial weapons)</label>
                      <div className="flex gap-2">
                        <Input
                          value={multiclassProficiencies.weaponsDisplayName || ''}
                          onChange={e => setMulticlassProficiencies({ ...multiclassProficiencies, weaponsDisplayName: e.target.value })}
                          placeholder="e.g. Simple weapons, martial weapons"
                          className="h-8 text-xs bg-background/50 border-gold/10 focus:border-gold"
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 text-[10px] uppercase font-bold border-gold/20"
                          onClick={() => syncGroupedDisplayName(multiclassProficiencies, setMulticlassProficiencies, 'weapons', 'weaponsDisplayName', allWeapons, allWeaponCategories)}
                        >
                          Sync
                        </Button>
                      </div>
                    </div>

                    <div className="grid sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-gold/60">Weapon Options</label>
                        <div className="p-3 border border-gold/10 bg-background/30 rounded-md space-y-4">
                          {Object.entries(groupedWeapons).sort().map(([category, items]) => {
                            const currentIds = new Set(multiclassProficiencies.weapons.optionIds || []);
                            const allExist = (items as any[]).every(item => currentIds.has(item.id));
                            return (
                              <div key={`weapon-options-${category}`} className="space-y-1">
                                <div className="flex items-center gap-2 border-b border-gold/5 pb-1 mb-1 group/header">
                                  <label className="flex items-center gap-2 cursor-pointer group/label">
                                    <div className={`w-3 h-3 rounded border flex items-center justify-center transition-all ${allExist ? 'bg-gold border-gold' : 'border-gold/30 group-hover/label:border-gold/50'}`}>
                                      {allExist && <Check className="w-2 h-2 text-white" />}
                                    </div>
                                    <input
                                      type="checkbox"
                                      className="hidden"
                                      checked={allExist}
                                      onChange={() => {
                                        const catId = allWeaponCategories.find(c => c.name === category)?.id;
                                        toggleMulticlassGroup(items as any[], 'weapons', 'optionIds', catId);
                                      }}
                                    />
                                    <span className="text-[10px] font-black uppercase tracking-widest text-gold/40 italic">{category}</span>
                                  </label>
                                  {allExist && <span className="text-[9px] text-ink/20 ml-auto italic">All Selected</span>}
                                </div>
                                {!allExist && (
                                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                                    {(items as any[]).map(weapon => {
                                      const isOption = multiclassProficiencies.weapons.optionIds?.includes(weapon.id);
                                      const isFixed = multiclassProficiencies.weapons.fixedIds?.includes(weapon.id);
                                      return (
                                        <label key={`weapon-option-${weapon.id}`} className="flex items-center gap-2 cursor-pointer group">
                                          <div className={`w-3 h-3 rounded border flex items-center justify-center transition-all ${isOption ? 'bg-gold border-gold' : 'border-gold/30 group-hover:border-gold/50'}`}>
                                            {isOption && <Check className="w-2 h-2 text-white" />}
                                          </div>
                                          <input
                                            type="checkbox"
                                            className="hidden"
                                            checked={isOption}
                                            onChange={e => {
                                              const current = multiclassProficiencies.weapons.optionIds;
                                              const next = e.target.checked ? [...current, weapon.id] : current.filter((id: string) => id !== weapon.id);
                                              setMulticlassProficiencies({ ...multiclassProficiencies, weapons: { ...multiclassProficiencies.weapons, optionIds: next } });
                                            }}
                                          />
                                          <span className="text-[10px] font-bold text-ink/60 truncate">{weapon.name}</span>
                                        </label>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-gold/60">Fixed Weapons (Automatic)</label>
                        <div className="p-3 border border-gold/10 bg-background/30 rounded-md space-y-4">
                          {Object.entries(groupedWeapons).sort().map(([category, items]) => {
                            const currentFixedIds = new Set(multiclassProficiencies.weapons.fixedIds || []);
                            const allFixed = (items as any[]).every(item => currentFixedIds.has(item.id));
                            return (
                              <div key={`weapon-fixed-${category}`} className="space-y-1">
                                <div className="flex items-center gap-2 border-b border-gold/5 pb-1 mb-1 group/header">
                                  <label className="flex items-center gap-2 cursor-pointer group/label">
                                    <div className={`w-3 h-3 rounded border flex items-center justify-center transition-all ${allFixed ? 'bg-gold border-gold' : 'border-gold/30 group-hover/label:border-gold/50'}`}>
                                      {allFixed && <Check className="w-2 h-2 text-white" />}
                                    </div>
                                    <input
                                      type="checkbox"
                                      className="hidden"
                                      checked={allFixed}
                                      onChange={() => {
                                        const catId = allWeaponCategories.find(c => c.name === category)?.id;
                                        toggleMulticlassGroup(items as any[], 'weapons', 'fixedIds', catId);
                                      }}
                                    />
                                    <span className="text-[10px] font-black uppercase tracking-widest text-gold/40 italic">{category}</span>
                                  </label>
                                  {allFixed && <span className="text-[9px] text-ink/20 ml-auto italic">All Fixed</span>}
                                </div>
                                {!allFixed && (
                                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                                    {(items as any[]).map(weapon => {
                                      const isFixed = multiclassProficiencies.weapons.fixedIds?.includes(weapon.id);
                                      return (
                                        <label key={`weapon-fixed-item-${weapon.id}`} className="flex items-center gap-2 cursor-pointer group">
                                          <div className={`w-3 h-3 rounded border flex items-center justify-center transition-all ${isFixed ? 'bg-gold border-gold' : 'border-gold/30 group-hover:border-gold/50'}`}>
                                            {isFixed && <Check className="w-2 h-2 text-white" />}
                                          </div>
                                          <input
                                            type="checkbox"
                                            className="hidden"
                                            checked={isFixed}
                                            onChange={e => {
                                              const current = multiclassProficiencies.weapons.fixedIds;
                                              const next = e.target.checked ? [...current, weapon.id] : current.filter((id: string) => id !== weapon.id);
                                              const nextOptions = multiclassProficiencies.weapons.optionIds;
                                              setMulticlassProficiencies({ ...multiclassProficiencies, weapons: { ...multiclassProficiencies.weapons, fixedIds: next, optionIds: nextOptions } });
                                            }}
                                          />
                                          <span className="text-[10px] font-bold text-ink/60 truncate">{weapon.name}</span>
                                        </label>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-6 pt-4 border-t border-gold/10">
                  {/* Skills Section */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-bold uppercase tracking-widest text-ink/60">Skills</h3>
                      <div className="flex items-center gap-2">
                        <label className="text-[10px] font-bold uppercase text-ink/40">Choices:</label>
                        <Input
                          type="number"
                          value={multiclassProficiencies.skills.choiceCount}
                          onChange={e => setMulticlassProficiencies({
                            ...multiclassProficiencies,
                            skills: { ...multiclassProficiencies.skills, choiceCount: parseInt(e.target.value) || 0 }
                          })}
                          className="w-12 h-6 text-center text-xs bg-background/50 border-gold/10"
                        />
                      </div>
                    </div>

                    <div className="grid sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-gold/60">Skill Options</label>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 p-3 border border-gold/10 bg-background/30 rounded-md min-h-[100px]">
                          {allSkills.map(skill => {
                            const isOption = multiclassProficiencies.skills.optionIds?.includes(skill.id);
                            const isFixed = multiclassProficiencies.skills.fixedIds?.includes(skill.id);
                            return (
                              <label
                                key={skill.id}
                                className={`flex items-center gap-2 cursor-pointer group ${isFixed ? 'opacity-50 cursor-not-allowed' : ''}`}
                              >
                                <div className={`w-3 h-3 rounded border flex items-center justify-center transition-all ${isOption || isFixed ? 'bg-gold border-gold' : 'border-gold/30 group-hover:border-gold/50'}`}>
                                  {(isOption || isFixed) && <Check className="w-2 h-2 text-white" />}
                                </div>
                                <input
                                  type="checkbox"
                                  className="hidden"
                                  disabled={isFixed}
                                  checked={isOption || isFixed}
                                  onChange={e => {
                                    const current = multiclassProficiencies.skills.optionIds;
                                    const next = e.target.checked ? [...current, skill.id] : current.filter((id: string) => id !== skill.id);
                                    setMulticlassProficiencies({
                                      ...multiclassProficiencies,
                                      skills: { ...multiclassProficiencies.skills, optionIds: next }
                                    });
                                  }}
                                />
                                <span className="text-[10px] font-bold text-ink/60 truncate">{skill.name}</span>
                              </label>
                            );
                          })}
                          {allSkills.length === 0 && <p className="text-[10px] text-ink/30 italic col-span-2">No skills defined. <Link to="/compendium/skills" className="text-gold underline">Add skills</Link></p>}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-gold/60">Fixed Skills (Automatic)</label>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 p-3 border border-gold/10 bg-background/30 rounded-md min-h-[100px]">
                          {allSkills.map(skill => {
                            const isFixed = multiclassProficiencies.skills.fixedIds?.includes(skill.id);
                            return (
                              <label
                                key={skill.id}
                                className="flex items-center gap-2 cursor-pointer group"
                              >
                                <div className={`w-3 h-3 rounded border flex items-center justify-center transition-all ${isFixed ? 'bg-gold border-gold' : 'border-gold/30 group-hover:border-gold/50'}`}>
                                  {isFixed && <Check className="w-2 h-2 text-white" />}
                                </div>
                                <input
                                  type="checkbox"
                                  className="hidden"
                                  checked={isFixed}
                                  onChange={e => {
                                    const current = multiclassProficiencies.skills.fixedIds;
                                    const next = e.target.checked ? [...current, skill.id] : current.filter((id: string) => id !== skill.id);

                                    // If adding to fixed, remove from options
                                    let nextOptions = multiclassProficiencies.skills.optionIds;
                                    if (e.target.checked) {
                                      nextOptions = nextOptions.filter((id: string) => id !== skill.id);
                                    }

                                    setMulticlassProficiencies({
                                      ...multiclassProficiencies,
                                      skills: { ...multiclassProficiencies.skills, fixedIds: next, optionIds: nextOptions }
                                    });
                                  }}
                                />
                                <span className="text-[10px] font-bold text-ink/60 truncate">{skill.name}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Tools Section */}
                  <div className="space-y-4 pt-4 border-t border-gold/10">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-bold uppercase tracking-widest text-ink/60 flex items-center gap-2">
                        <Hammer className="w-3.5 h-3.5 text-gold/40" /> Tools
                      </h3>
                      <div className="flex items-center gap-2">
                        <label className="text-[10px] font-bold uppercase text-ink/40">Choices:</label>
                        <Input
                          type="number"
                          value={multiclassProficiencies.tools.choiceCount}
                          onChange={e => setMulticlassProficiencies({
                            ...multiclassProficiencies,
                            tools: { ...multiclassProficiencies.tools, choiceCount: parseInt(e.target.value) || 0 }
                          })}
                          className="w-12 h-6 text-center text-xs bg-background/50 border-gold/10"
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="label-text text-[10px] text-gold/60">Tools Display Name (e.g. any three artisan's tools)</label>
                      <div className="flex gap-2">
                        <Input
                          value={multiclassProficiencies.toolsDisplayName || ''}
                          onChange={e => setMulticlassProficiencies({ ...multiclassProficiencies, toolsDisplayName: e.target.value })}
                          placeholder="e.g. Any three artisan's tools"
                          className="h-8 text-xs bg-background/50 border-gold/10 focus:border-gold"
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 text-[10px] uppercase font-bold border-gold/20"
                          onClick={() => syncGroupedDisplayName(multiclassProficiencies, setMulticlassProficiencies, 'tools', 'toolsDisplayName', allTools, allToolCategories)}
                        >
                          Sync
                        </Button>
                      </div>
                    </div>

                    <div className="grid sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-gold/60">Tool Options</label>
                        <div className="p-3 border border-gold/10 bg-background/30 rounded-md space-y-4">
                          {Object.entries(groupedTools).sort().map(([categoryName, items]) => {
                            const catId = allToolCategories.find(c => c.name === categoryName)?.id;
                            const currentIds = new Set(multiclassProficiencies.tools.optionIds || []);
                            const allExist = (items as any[]).every(item => currentIds.has(item.id));
                            return (
                              <div key={`tool-options-${categoryName}`} className="space-y-1">
                                <div className="flex items-center gap-2 border-b border-gold/5 pb-1 mb-1 group/header">
                                  <label className="flex items-center gap-2 cursor-pointer group/label">
                                    <div className={`w-3 h-3 rounded border flex items-center justify-center transition-all ${allExist ? 'bg-gold border-gold' : 'border-gold/30 group-hover/label:border-gold/50'}`}>
                                      {allExist && <Check className="w-2 h-2 text-white" />}
                                    </div>
                                    <input
                                      type="checkbox"
                                      className="hidden"
                                      checked={allExist}
                                      onChange={() => toggleMulticlassGroup(items as any[], 'tools', 'optionIds', catId)}
                                    />
                                    <span className="text-[10px] font-black uppercase tracking-widest text-gold/40 italic">{categoryName}</span>
                                  </label>
                                  {allExist && <span className="text-[9px] text-ink/20 ml-auto italic">All Selected</span>}
                                </div>
                                {!allExist && (
                                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                                    {(items as any[]).map(tool => {
                                      const isOption = multiclassProficiencies.tools.optionIds?.includes(tool.id);
                                      const isFixed = multiclassProficiencies.tools.fixedIds?.includes(tool.id);
                                      return (
                                        <label key={`tool-option-${tool.id}`} className="flex items-center gap-2 cursor-pointer group">
                                          <div className={`w-3 h-3 rounded border flex items-center justify-center transition-all ${isOption ? 'bg-gold border-gold' : 'border-gold/30 group-hover:border-gold/50'}`}>
                                            {isOption && <Check className="w-2 h-2 text-white" />}
                                          </div>
                                          <input
                                            type="checkbox"
                                            className="hidden"
                                            checked={isOption}
                                            onChange={e => {
                                              const current = multiclassProficiencies.tools.optionIds;
                                              const next = e.target.checked ? [...current, tool.id] : current.filter((id: string) => id !== tool.id);
                                              setMulticlassProficiencies({ ...multiclassProficiencies, tools: { ...multiclassProficiencies.tools, optionIds: next } });
                                            }}
                                          />
                                          <span className="text-[10px] font-bold text-ink/60 truncate">{tool.name}</span>
                                        </label>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                          {allTools.length === 0 && <p className="text-[10px] text-ink/30 italic col-span-2">No tools defined. <Link to="/compendium/tools" className="text-gold underline">Add tools</Link></p>}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-gold/60">Fixed Tools (Automatic)</label>
                        <div className="p-3 border border-gold/10 bg-background/30 rounded-md space-y-4">
                          {Object.entries(groupedTools).sort().map(([categoryName, items]) => {
                            const catId = allToolCategories.find(c => c.name === categoryName)?.id;
                            const currentFixedIds = new Set(multiclassProficiencies.tools.fixedIds || []);
                            const allFixed = (items as any[]).every(item => currentFixedIds.has(item.id));
                            return (
                              <div key={`tool-fixed-${categoryName}`} className="space-y-1">
                                <div className="flex items-center gap-2 border-b border-gold/5 pb-1 mb-1 group/header">
                                  <label className="flex items-center gap-2 cursor-pointer group/label">
                                    <div className={`w-3 h-3 rounded border flex items-center justify-center transition-all ${allFixed ? 'bg-gold border-gold' : 'border-gold/30 group-hover:border-gold/50'}`}>
                                      {allFixed && <Check className="w-2 h-2 text-white" />}
                                    </div>
                                    <input
                                      type="checkbox"
                                      className="hidden"
                                      checked={allFixed}
                                      onChange={() => toggleMulticlassGroup(items as any[], 'tools', 'fixedIds', catId)}
                                    />
                                    <span className="text-[10px] font-black uppercase tracking-widest text-gold/40 italic">{categoryName}</span>
                                  </label>
                                  {allFixed && <span className="text-[9px] text-ink/20 ml-auto italic">All Selected</span>}
                                </div>
                                {!allFixed && (
                                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                                    {(items as any[]).map(tool => {
                                      const isFixed = multiclassProficiencies.tools.fixedIds?.includes(tool.id);
                                      return (
                                        <label key={`tool-fixed-item-${tool.id}`} className="flex items-center gap-2 cursor-pointer group">
                                          <div className={`w-3 h-3 rounded border flex items-center justify-center transition-all ${isFixed ? 'bg-gold border-gold' : 'border-gold/30 group-hover:border-gold/50'}`}>
                                            {isFixed && <Check className="w-2 h-2 text-white" />}
                                          </div>
                                          <input
                                            type="checkbox"
                                            className="hidden"
                                            checked={isFixed}
                                            onChange={e => {
                                              const current = multiclassProficiencies.tools.fixedIds;
                                              const next = e.target.checked ? [...current, tool.id] : current.filter((id: string) => id !== tool.id);

                                              // If adding to fixed, remove from options
                                              setMulticlassProficiencies({
                                                ...multiclassProficiencies,
                                                tools: { ...multiclassProficiencies.tools, fixedIds: next, optionIds: multiclassProficiencies.tools.optionIds }
                                              });
                                            }}
                                          />
                                          <span className="text-[10px] font-bold text-ink/60 truncate">{tool.name}</span>
                                        </label>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Languages Section */}
                  <div className="space-y-4 pt-4 border-t border-gold/10">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-bold uppercase tracking-widest text-ink/60 flex items-center gap-2">
                        <MessageCircle className="w-3.5 h-3.5 text-gold/40" /> Languages
                      </h3>
                      <div className="flex items-center gap-2">
                        <label className="text-[10px] font-bold uppercase text-ink/40">Choices:</label>
                        <Input
                          type="number"
                          value={multiclassProficiencies.languages.choiceCount}
                          onChange={e => setMulticlassProficiencies({
                            ...multiclassProficiencies,
                            languages: { ...multiclassProficiencies.languages, choiceCount: parseInt(e.target.value) || 0 }
                          })}
                          className="w-12 h-6 text-center text-xs bg-background/50 border-gold/10"
                        />
                      </div>
                    </div>

                    <div className="grid sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-gold/60">Language Options</label>
                        <div className="p-3 border border-gold/10 bg-background/30 rounded-md space-y-4">
                          {Object.entries(groupedLanguages).sort().map(([categoryName, items]) => {
                            const catId = allLanguageCategories.find(c => c.name === categoryName)?.id;
                            const currentIds = new Set(multiclassProficiencies.languages.optionIds || []);
                            const allExist = (items as any[]).every(item => currentIds.has(item.id));
                            return (
                              <div key={`lang-options-${categoryName}`} className="space-y-1">
                                <div className="flex items-center gap-2 border-b border-gold/5 pb-1 mb-1 group/header">
                                  <label className="flex items-center gap-2 cursor-pointer group/label">
                                    <div className={`w-3 h-3 rounded border flex items-center justify-center transition-all ${allExist ? 'bg-gold border-gold' : 'border-gold/30 group-hover/label:border-gold/50'}`}>
                                      {allExist && <Check className="w-2 h-2 text-white" />}
                                    </div>
                                    <input
                                      type="checkbox"
                                      className="hidden"
                                      checked={allExist}
                                      onChange={() => toggleMulticlassGroup(items as any[], 'languages', 'optionIds', catId)}
                                    />
                                    <span className="text-[10px] font-black uppercase tracking-widest text-gold/40 italic">{categoryName}</span>
                                  </label>
                                  {allExist && <span className="text-[9px] text-ink/20 ml-auto italic">All Selected</span>}
                                </div>
                                {!allExist && (
                                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                                    {(items as any[]).map(lang => {
                                      const isOption = multiclassProficiencies.languages.optionIds?.includes(lang.id);
                                      const isFixed = multiclassProficiencies.languages.fixedIds?.includes(lang.id);
                                      return (
                                        <label key={`lang-option-${lang.id}`} className="flex items-center gap-2 cursor-pointer group">
                                          <div className={`w-3 h-3 rounded border flex items-center justify-center transition-all ${isOption ? 'bg-gold border-gold' : 'border-gold/30 group-hover:border-gold/50'}`}>
                                            {isOption && <Check className="w-2 h-2 text-white" />}
                                          </div>
                                          <input
                                            type="checkbox"
                                            className="hidden"
                                            checked={isOption}
                                            onChange={e => {
                                              const current = multiclassProficiencies.languages.optionIds;
                                              const next = e.target.checked ? [...current, lang.id] : current.filter((id: string) => id !== lang.id);
                                              setMulticlassProficiencies({ ...multiclassProficiencies, languages: { ...multiclassProficiencies.languages, optionIds: next } });
                                            }}
                                          />
                                          <span className="text-[10px] font-bold text-ink/60 truncate">{lang.name}</span>
                                        </label>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                          {allLanguages.length === 0 && <p className="text-[10px] text-ink/30 italic col-span-2">No languages defined. <Link to="/admin/proficiencies" className="text-gold underline">Manage Languages</Link></p>}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-gold/60">Fixed Languages (Automatic)</label>
                        <div className="p-3 border border-gold/10 bg-background/30 rounded-md space-y-4">
                          {Object.entries(groupedLanguages).sort().map(([categoryName, items]) => {
                            const catId = allLanguageCategories.find(c => c.name === categoryName)?.id;
                            const currentFixedIds = new Set(multiclassProficiencies.languages.fixedIds || []);
                            const allFixed = (items as any[]).every(item => currentFixedIds.has(item.id));
                            return (
                              <div key={`lang-fixed-${categoryName}`} className="space-y-1">
                                <div className="flex items-center gap-2 border-b border-gold/5 pb-1 mb-1 group/header">
                                  <label className="flex items-center gap-2 cursor-pointer group/label">
                                    <div className={`w-3 h-3 rounded border flex items-center justify-center transition-all ${allFixed ? 'bg-gold border-gold' : 'border-gold/30 group-hover/label:border-gold/50'}`}>
                                      {allFixed && <Check className="w-2 h-2 text-white" />}
                                    </div>
                                    <input
                                      type="checkbox"
                                      className="hidden"
                                      checked={allFixed}
                                      onChange={() => toggleMulticlassGroup(items as any[], 'languages', 'fixedIds', catId)}
                                    />
                                    <span className="text-[10px] font-black uppercase tracking-widest text-gold/40 italic">{categoryName}</span>
                                  </label>
                                  {allFixed && <span className="text-[9px] text-ink/20 ml-auto italic">All Selected</span>}
                                </div>
                                {!allFixed && (
                                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                                    {(items as any[]).map(lang => {
                                      const isFixed = multiclassProficiencies.languages.fixedIds?.includes(lang.id);
                                      return (
                                        <label key={`lang-fixed-item-${lang.id}`} className="flex items-center gap-2 cursor-pointer group">
                                          <div className={`w-3 h-3 rounded border flex items-center justify-center transition-all ${isFixed ? 'bg-gold border-gold' : 'border-gold/30 group-hover:border-gold/50'}`}>
                                            {isFixed && <Check className="w-2 h-2 text-white" />}
                                          </div>
                                          <input
                                            type="checkbox"
                                            className="hidden"
                                            checked={isFixed}
                                            onChange={e => {
                                              const current = multiclassProficiencies.languages.fixedIds;
                                              const next = e.target.checked ? [...current, lang.id] : current.filter((id: string) => id !== lang.id);

                                              // If adding to fixed, remove from options
                                              setMulticlassProficiencies({
                                                ...multiclassProficiencies,
                                                languages: { ...multiclassProficiencies.languages, fixedIds: next, optionIds: multiclassProficiencies.languages.optionIds }
                                              });
                                            }}
                                          />
                                          <span className="text-[10px] font-bold text-ink/60 truncate">{lang.name}</span>
                                        </label>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

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
                    availableFeatures={features}
                    availableScalingColumns={scalingColumns}
                    availableOptionGroups={allOptionGroups}
                    availableOptionItems={allOptionItems}
                    classId={id}
                    defaultHitDie={hitDie}
                    referenceContext={classReferenceContext}
                    referenceSheetTitle="Class Reference Sheet"
                  />
                </div>
              </div>


            </TabsContent>

            {/* Danger Zone */}
            {id && (
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
                    onClick={async () => {
                      if (id && confirm('Are you sure you want to delete this class? This cannot be undone.')) {
                        try {
                          await deleteDocument('classes', id);
                          toast.success('Class deleted');
                          setInitialDataHash(getCurrentStateHash()); // Prevent dirty check
                          setTimeout(() => navigate('/compendium/classes'), 0);
                        } catch (error) {
                          toast.error('Failed to delete class');
                        }
                      }
                    }}
                  >
                    Delete Class
                  </Button>
                </div>
              </TabsContent>
            )}

          </Tabs>
        </div>

        {/* Sidebar */}
        <div className="xl:col-span-1 space-y-6">
          <div className="p-4 border border-gold/20 bg-card/50 space-y-4 rounded-xl">
            <div className="section-header">
              <h2 className="label-text text-gold uppercase tracking-tighter">Class Columns</h2>
              <Link to={`/compendium/scaling/new?parentId=${id}&parentType=class`}>
                <Button
                  size="sm"
                  className="h-6 btn-gold"
                >
                  <Plus className="w-3 h-3 mr-1" /> Add
                </Button>
              </Link>
            </div>

            <div className="space-y-4">
              {scalingColumns.map(col => (
                <div key={col.id} className="p-3 bg-gold/5 border border-gold/10 rounded space-y-2 group relative">
                  <div className="flex items-center justify-between">
                    <Input
                      value={col.name}
                      onChange={e => {
                        upsertDocument("scaling_columns", col.id, { name: e.target.value });
                        queueRebake('scalingColumn', col.id);
                      }}
                      className="h-6 text-[11px] font-bold bg-transparent border-none p-0 focus-visible:ring-0"
                    />
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Link to={`/compendium/scaling/edit/${col.id}?parentId=${id}&parentType=class`}>
                        <Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-gold">
                          <Edit className="w-3 h-3" />
                        </Button>
                      </Link>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteScaling(col.id)}
                        className="h-5 w-5 p-0 text-blood"
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>

                  <details className="group/details">
                    <summary className="text-[9px] uppercase font-black tracking-widest text-gold/50 cursor-pointer select-none flex items-center justify-between hover:text-gold transition-colors [&::-webkit-details-marker]:hidden">
                      Breakpoints
                      <ChevronDown className="w-3 h-3 transition-transform group-open/details:rotate-180" />
                    </summary>
                    <div className="mt-2 space-y-2">
                      {getScalingBreakpoints(col.values || {}).length > 0 ? (
                        <div className="flex flex-col gap-1 w-full">
                          {getScalingBreakpoints(col.values || {}).map(([level, value]) => (
                            <div key={level} className="flex items-center gap-3 rounded border border-gold/10 bg-background/60 px-3 py-1.5 w-full">
                              <span className="text-[9px] font-black tracking-widest text-gold whitespace-nowrap min-w-[2.5rem]">Lvl {level}</span>
                              <div className="h-px bg-gold/10 flex-1" />
                              <span className="text-[11px] font-black text-ink">{String(value)}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[10px] text-ink/30 italic">No saved matrix values yet.</p>
                      )}
                    </div>
                  </details>

                  <div className="pt-1">
                    <Link to={`/compendium/scaling/edit/${col.id}?parentId=${id}&parentType=class`}>
                      <Button variant="ghost" size="sm" className="w-full h-6 text-[9px] font-bold uppercase tracking-widest text-gold/60 hover:text-gold hover:bg-gold/5 border border-gold/10">
                        Open Full Matrix Editor
                      </Button>
                    </Link>
                  </div>
                </div>
              ))}
              {scalingColumns.length === 0 && (
                <p className="text-[10px] text-ink/30 text-center italic py-4">No scaling columns defined.</p>
              )}
            </div>
          </div>
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
              <div className="p-6 pb-0 shrink-0 border-b border-gold/10">
                <div className="flex gap-6 items-start">
                  <div className="w-32 h-32 shrink-0">
                    <ImageUpload
                      storagePath="icons/features/"
                      imageType="icon"
                      compact
                      currentImageUrl={editingFeature.iconUrl || ''}
                      onUpload={(url) => setEditingFeature({ ...editingFeature, iconUrl: url })}
                      className="w-full h-full"
                    />
                  </div>
                  <div className="flex-1 space-y-2 pt-2 flex flex-col items-center">
                    <input
                      value={editingFeature.name || ''}
                      onChange={e => setEditingFeature({ ...editingFeature, name: e.target.value })}
                      className="w-full h-16 font-serif text-4xl tracking-tight text-center bg-transparent border border-transparent hover:border-gold/20 focus:border-gold/50 focus:bg-background/50 rounded outline-none text-gold transition-colors"
                      placeholder="Feature Name"
                      required
                    />
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
                  </div>
                </div>

                <div className="flex mt-6 relative pb-4">
                  <div className="absolute left-[50%] ml-[-12px] bottom-[-16px] w-6 h-6 bg-card flex items-center justify-center text-gold/40 text-sm rounded-full z-10 border border-gold/10">
                    <Zap className="w-3 h-3" />
                  </div>
                  <Tabs value={featureTab} onValueChange={setFeatureTab} className="w-full bg-transparent border-none">
                    <TabsList className="bg-transparent border-none h-auto p-0 flex justify-between w-full">
                      {['description', 'details', 'activities', 'effects', 'advancement'].map(tab => (
                        <TabsTrigger
                          key={tab}
                          value={tab}
                          className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-gold data-[state=active]:border-b-2 data-[state=active]:border-gold rounded-none h-10 px-0 label-text transition-all opacity-60 data-[state=active]:opacity-100 flex-1 hover:text-gold/80"
                        >
                          {tab}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                  </Tabs>
                </div>
              </div>

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

                    </div>
                  );
                })()}

                {featureTab === 'activities' && (
                  <div className="pt-2">
                    <ActivityEditor
                      activities={editingFeature.activities || {}}
                      onChange={(acts) => setEditingFeature({ ...editingFeature, activities: acts })}
                      availableEffects={editingFeature.effects || []}
                    />
                  </div>
                )}

                {featureTab === 'effects' && (
                  <div className="pt-2">
                    <ActiveEffectEditor
                      effects={editingFeature.effects || []}
                      onChange={fx => setEditingFeature({ ...editingFeature, effects: fx })}
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
                      availableFeatures={features}
                      availableScalingColumns={scalingColumns}
                      availableOptionGroups={allOptionGroups}
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

              <div className="p-4 border-t border-gold/10 bg-background flex justify-end shrink-0 gap-3">
                <Button type="button" variant="ghost" onClick={() => setIsFeatureModalOpen(false)} className="label-text opacity-70 hover:opacity-100">Cancel</Button>
                <Button onClick={handleSaveFeature} className="bg-primary hover:bg-primary/90 text-primary-foreground gap-2 px-8 label-text">
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
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto bg-card border-gold/30">
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
                        {item.levelPrerequisite > 0 && (
                          <span className="text-[10px] text-gold/60 font-mono block">Level {item.levelPrerequisite}+</span>
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
        </DialogContent>
      </Dialog>
    </div>
  );
}

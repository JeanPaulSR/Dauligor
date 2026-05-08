import React, { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useKeyboardSave } from "../../hooks/useKeyboardSave";
import { reportClientError, OperationType } from "../../lib/firebase";
import {
  queryD1,
  upsertDocument,
  fetchCollection,
  fetchDocument,
} from "../../lib/d1";

// ── D1 row → camelCase shape helpers ────────────────────────────────────────
// CharacterBuilder reads many fields with camelCase access (`row.classId`,
// `row.parentId`, etc.). D1 stores snake_case. These tiny helpers keep the
// existing reads working without touching call sites all over the file.
const denormClass = (d: any) => d ? ({ ...d, hitDie: d.hit_die }) : d;
const denormSubclass = (d: any) => d ? ({ ...d, classId: d.class_id }) : d;
const denormFeature = (d: any) => d ? ({
  ...d,
  parentId: d.parent_id,
  parentType: d.parent_type,
}) : d;
const denormScalingCol = (d: any) => d ? ({
  ...d,
  parentId: d.parent_id,
  parentType: d.parent_type,
}) : d;
const denormCategoryId = (d: any) => d ? ({
  ...d,
  categoryId: d.category_id,
}) : d;
import { rebuildCharacterFromSql } from "../../lib/characterShared";
import {
  uniqueStringList,
  getTotalCharacterLevel,
  getProficiencyBonusForLevel,
  getProgressionClassKey,
  sanitizeAdvancementKeyPart,
  isLegacyAdvancementSelectionKey,
  buildEmptyProgressionState,
  normalizeAdvancementSelectionEntry,
  normalizeProgressionState,
  buildSelectedOptionsMapFromClassPackages,
  getClassIntroductionMode,
  resolveHitDieFaces,
  buildCurrentProgression,
  buildProgressionClassGroups,
  buildCharacterClassesFromProgression,
  buildAdvancementSelectionsForPackage,
  buildProgressionStateForCharacter,
  buildAdvancementSelectionMapForPackage,
  getSelectionsForAdvancement,
  normalizeAdvancementList,
  buildNamedDocLookup,
  flattenStringArray,
  normalizePrimaryAbilityValue,
  buildAdvancementSourceScope,
  buildAdvancementSourceContext,
  buildLegacyAdvancementSelectionKey,
  parseAdvancementSourceScope,
  buildAdvancementSelectionKey,
  getAdvancementSelectionValues,
  writeAdvancementSelectionValues,
  buildNonLegacySelectedOptionsMap,
  buildCharacterSelectedOptionsMap,
  updateCharacterAdvancementSelectionState,
  dedupeOwnedStateEntries,
  getStoredHpMax,
  hasExplicitHpMaxOverride,
  getEffectiveHpMax,
  areStringListsEqual,
  normalizeSpellcastingForExport,
} from "../../lib/characterLogic";
import { Button } from "../../components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { ImageUpload } from "../../components/ui/ImageUpload";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "../../components/ui/dialog";
import {
  Save,
  ChevronLeft,
  User,
  Shield,
  Package,
  Zap,
  Wind,
  Star,
  Clock,
  Settings,
  Plus,
  Minus,
  Edit2,
  Hammer,
  Check,
  Users,
  Scroll,
  Dna,
  Sword,
  ShieldCheck,
  Eye,
  Copy,
  ChevronUp,
  Download,
} from "lucide-react";
import { ClassList } from "../compendium/ClassList";
import BBCodeRenderer from "../../components/BBCodeRenderer";
import { exportCharacterJSON } from "../../lib/characterExport";
import { calculateEffectiveCastingLevel, getSpellSlotsForLevel } from "../../lib/spellcasting";
import {
  getCanonicalTraitChoiceEntries,
  normalizeAdvancementListForEditor,
  resolveAdvancementDefaultHitDie
} from "../../lib/advancementState";

const getModifier = (score: number) => {
  const mod = Math.floor((score - 10) / 2);
  return mod >= 0 ? `+${mod}` : mod.toString();
};

const TRAIT_TYPE_COLLECTIONS: Record<string, string> = {
  skills: "skills",
  saves: "attributes",
  armor: "armor",
  weapons: "weapons",
  tools: "tools",
  languages: "languages",
  di: "damageTypes",
  dr: "damageTypes",
  dv: "damageTypes",
  ci: "conditions",
};

function normalizeProgressionAdvancements(list: any[] = [], defaultLevel = 1, defaultHitDie = 8) {
  return normalizeAdvancementListForEditor(list, {
    defaultLevel,
    defaultHitDie: resolveAdvancementDefaultHitDie(defaultHitDie)
  });
}

const BASE_CLASS_PROFILE_TRAIT_MAP: Record<
  string,
  { profileKey: string; traitType: string }
> = {
  "base-saves": { profileKey: "savingThrows", traitType: "saves" },
  "base-armor": { profileKey: "armor", traitType: "armor" },
  "base-weapons": { profileKey: "weapons", traitType: "weapons" },
  "base-skills": { profileKey: "skills", traitType: "skills" },
  "base-tools": { profileKey: "tools", traitType: "tools" },
  "base-languages": { profileKey: "languages", traitType: "languages" },
};

const TRAIT_CHARACTER_FIELDS: Record<string, string> = {
  saves: "savingThrows",
  skills: "proficientSkills",
  armor: "armorProficiencies",
  weapons: "weaponProficiencies",
  tools: "toolProficiencies",
  languages: "languages",
};

// uniqueStringList moved to characterLogic.ts

// buildNamedDocLookup moved to characterLogic.ts

// flattenStringArray moved to characterLogic.ts

// normalizePrimaryAbilityValue moved to characterLogic.ts

// normalizeSpellcastingForExport moved to characterLogic.ts

// Logic moved to characterLogic.ts

// HP and String comparison helpers moved to characterLogic.ts

// Logic moved to characterLogic.ts

// Logic moved to characterLogic.ts

// Logic moved to characterLogic.ts

// dedupeOwnedStateEntries moved to characterLogic.ts

function buildOwnedFeaturesFromSummaries(classProgressionSummaries: any[] = []) {
  return dedupeOwnedStateEntries(
    classProgressionSummaries.flatMap((summary: any) =>
      (Array.isArray(summary?.features) ? summary.features : []).map((feature: any) => ({
        ownerClassId: summary.classId || "",
        ownerSubclassId: summary.subclassDocument?.id || "",
        ownerClassName: summary.className || "",
        ownerSubclassName: summary.subclassName || "",
        sourceId:
          String(feature?.sourceId || "").trim() || `feature-${feature.id}`,
        entityId: String(feature?.id || "").trim(),
        sourceType:
          String(feature?.parentType || "").includes("subclass")
            ? "subclass-feature"
            : "class-feature",
        level: Number(feature?.level || 1) || 1,
        parentType: String(feature?.parentType || "").trim(),
        parentId: String(feature?.parentId || "").trim(),
        classSourceId: summary.classId ? `class-${summary.classId}` : "",
        subclassSourceId: summary.subclassDocument?.id
          ? `subclass-${summary.subclassDocument.id}`
          : "",
        name: feature?.name || "",
        description: feature?.description || "",
        imageUrl: feature?.imageUrl || "",
        featureTypeValue: String(feature?.parentType || "").includes("subclass")
          ? "subclass"
          : "class",
        featureTypeSubtype: String(feature?.featureTypeSubtype || "").trim(),
        active: true,
      })),
    ),
  );
}

function buildOwnedItemsFromState(
  classProgressionSummaries: any[] = [],
  classPackages: any[] = [],
  optionsCache: Record<string, any> = {},
) {
  const grantedItems = classProgressionSummaries.flatMap((summary: any) =>
    (Array.isArray(summary?.grantedItems) ? summary.grantedItems : []).map(
      (item: any) => ({
        ownerClassId: summary.classId || "",
        ownerSubclassId: summary.subclassDocument?.id || "",
        ownerClassName: summary.className || "",
        ownerSubclassName: summary.subclassName || "",
        sourceId: String(item?.sourceId || "").trim() || `${item?.kind || "item"}-${item?.id}`,
        entityId: String(item?.id || "").trim(),
        sourceType: String(item?.kind || "item").trim(),
        level: Number(item?.level || 1) || 1,
        parentType: String(item?.parentType || "").trim(),
        parentId: String(item?.parentId || "").trim(),
        classSourceId: summary.classId ? `class-${summary.classId}` : "",
        subclassSourceId: summary.subclassDocument?.id
          ? `subclass-${summary.subclassDocument.id}`
          : "",
        name: item?.name || "",
        description: item?.description || "",
        imageUrl: item?.imageUrl || "",
        itemKind: item?.kind || "item",
        featureTypeValue: String(item?.featureTypeValue || "").trim(),
        featureTypeSubtype: String(item?.featureTypeSubtype || "").trim(),
        groupSourceId: String(item?.groupSourceId || "").trim(),
        featureSourceId: String(item?.featureSourceId || "").trim(),
        scalingSourceId: String(item?.scalingSourceId || "").trim(),
        active: true,
      }),
    ),
  );

  const selectedOptionItems = (Array.isArray(classPackages) ? classPackages : []).flatMap(
    (pkg: any) =>
      (Array.isArray(pkg?.advancementSelections) ? pkg.advancementSelections : []).flatMap(
        (selection: any) => {
          const parsedScope = parseAdvancementSourceScope(selection?.key || "");
          return uniqueStringList(selection?.selectedIds || []).map((selectedId) => {
            const option = optionsCache[selectedId];
            return {
              ownerClassId: String(pkg?.classId || "").trim(),
              ownerSubclassId: String(pkg?.subclassId || "").trim(),
              ownerClassName: String(pkg?.className || "").trim(),
              ownerSubclassName: String(pkg?.subclassName || "").trim(),
              sourceId:
                String(option?.sourceId || "").trim() ||
                `class-option-${selectedId}`,
              entityId: String(selectedId || "").trim(),
              sourceType: option ? "option" : "selection",
              level: Number(selection?.level || 1) || 1,
              parentType: String(parsedScope.type || "").trim(),
              parentId: String(parsedScope.parent || "").trim(),
              classSourceId: String(pkg?.classSourceId || "").trim(),
              subclassSourceId: String(pkg?.subclassSourceId || "").trim(),
              name: option?.name || selectedId,
              description: option?.description || "",
              imageUrl: option?.imageUrl || "",
              itemKind: option ? "option" : "selection",
              featureTypeValue: "class",
              featureTypeSubtype: String(option?.featureType || "").trim(),
              groupSourceId: String(option?.groupSourceId || "").trim(),
              featureSourceId: String(option?.featureSourceId || "").trim(),
              scalingSourceId: String(option?.scalingSourceId || "").trim(),
              active: true,
            };
          });
        },
      ),
  );

  return dedupeOwnedStateEntries([...grantedItems, ...selectedOptionItems]);
}

// Functions moved to characterLogic.ts

function buildTraitConfigurationFromProfileBlock(
  profileBlock: any,
  traitType: string,
  fallbackConfiguration: any = {},
) {
  const normalizedFixed = uniqueStringList(
    profileBlock?.fixedIds ||
      fallbackConfiguration?.fixed ||
      fallbackConfiguration?.grants,
  );
  return {
    ...fallbackConfiguration,
    type: traitType,
    mode: "default",
    fixed: normalizedFixed,
    grants: uniqueStringList(
      profileBlock?.fixedIds ||
        fallbackConfiguration?.grants ||
        fallbackConfiguration?.fixed,
    ),
    options: uniqueStringList(
      profileBlock?.optionIds || fallbackConfiguration?.options,
    ),
    choiceCount: Math.max(
      0,
      Number(profileBlock?.choiceCount ?? fallbackConfiguration?.choiceCount ?? 0) || 0,
    ),
    categoryIds: uniqueStringList(
      profileBlock?.categoryIds || fallbackConfiguration?.categoryIds,
    ),
  };
}

function getEffectiveClassAdvancement(
  advancement: any,
  classDocument: any,
  introductionMode = "primary",
) {
  if (!advancement || typeof advancement !== "object") return advancement;

  const advancementId = String(advancement._id || "");
  if (advancementId === "base-items" && introductionMode === "multiclass") {
    return null;
  }

  const profileTraitConfig = BASE_CLASS_PROFILE_TRAIT_MAP[advancementId];
  if (!profileTraitConfig) return advancement;

  const profileSource =
    introductionMode === "multiclass"
      ? classDocument?.multiclassProficiencies
      : classDocument?.proficiencies;

  return {
    ...advancement,
    configuration: buildTraitConfigurationFromProfileBlock(
      profileSource?.[profileTraitConfig.profileKey],
      profileTraitConfig.traitType,
      advancement.configuration,
    ),
  };
}

function normalizeTraitValueForCharacter(traitType: string, value: any) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  if (traitType === "saves") return raw.toUpperCase();
  return raw;
}

function collectTraitValuesFromAdvancement(
  advancement: any,
  selectedOptions: Record<string, string[]> = {},
  source: Record<string, any> = {},
) {
  const configuration = advancement?.configuration || {};
  const traitType = String(configuration.type || "").trim();
  if (!traitType) return [];

  const values = [
    ...uniqueStringList(configuration.fixed),
    ...uniqueStringList(configuration.grants),
    ...uniqueStringList(configuration.categoryIds),
  ];

  const choiceCount = Math.max(0, Number(configuration.choiceCount || 0) || 0);
  const canonicalChoices = getCanonicalTraitChoiceEntries(configuration);

  if (choiceCount <= 0) {
    values.push(...uniqueStringList(configuration.options));
  } else if (canonicalChoices.length > 0) {
    canonicalChoices.forEach((choice) => {
      values.push(
        ...getAdvancementSelectionValues(selectedOptions, {
          source,
          advancementId: advancement._id,
          level: advancement.level,
          choiceId: choice.id,
        }),
      );
    });
  } else {
    values.push(
      ...getAdvancementSelectionValues(selectedOptions, {
        source,
        advancementId: advancement._id,
        level: advancement.level,
      }),
    );
  }

  return uniqueStringList(
    values.map((value) => normalizeTraitValueForCharacter(traitType, value)),
  );
}

function resolveProgressionEntryName(entry: any, lookups: any) {
  const currentName = String(entry?.name || "").trim();
  const entryId = String(entry?.id || entry?.entityId || "").trim();
  const sourceId = String(entry?.sourceId || "").trim();
  const likelyIdentifierName =
    !currentName ||
    currentName === entryId ||
    currentName === sourceId ||
    /^(class|subclass|feature|option|selection)-/i.test(currentName);

  if (!likelyIdentifierName) {
    return currentName;
  }

  const resolved =
    resolveGrantedItemRecord(sourceId, lookups) ||
    resolveGrantedItemRecord(entryId, lookups) ||
    resolveGrantedItemRecord(currentName, lookups);

  return (
    String(resolved?.name || "").trim() ||
    currentName ||
    entryId ||
    sourceId
  );
}

function normalizeProgressionEntryDisplay(entry: any, lookups: any) {
  const resolved =
    resolveGrantedItemRecord(String(entry?.sourceId || "").trim(), lookups) ||
    resolveGrantedItemRecord(String(entry?.id || entry?.entityId || "").trim(), lookups);

  return {
    ...entry,
    name: resolveProgressionEntryName(entry, lookups),
    description: entry?.description || resolved?.description || "",
    imageUrl: entry?.imageUrl || resolved?.imageUrl || "",
    featureTypeSubtype:
      entry?.featureTypeSubtype || resolved?.featureTypeSubtype || "",
  };
}

function collectAdvancementSelectionsForExport(
  advancement: any,
  selectedOptions: Record<string, string[]> = {},
  source: Record<string, any> = {},
) {
  if (advancement?.type === "Trait") {
    const canonicalChoices = getCanonicalTraitChoiceEntries(
      advancement?.configuration || {},
    );
    if (canonicalChoices.length > 0) {
      return uniqueStringList(
        canonicalChoices.flatMap((choice) =>
          getAdvancementSelectionValues(selectedOptions, {
            source,
            advancementId: advancement?._id,
            level: advancement?.level,
            choiceId: choice.id,
          }),
        ),
      );
    }
  }

  return getAdvancementSelectionValues(selectedOptions, {
    source,
    advancementId: advancement?._id,
    level: advancement?.level,
  });
}

function applyTraitValuesToCharacterGrants(
  grants: Record<string, string[]>,
  traitType: string,
  values: string[] = [],
) {
  const field = TRAIT_CHARACTER_FIELDS[traitType];
  if (!field) return;

  grants[field] = uniqueStringList([...(grants[field] || []), ...values]);
}

function buildEmptyClassGrantedTraits() {
  return {
    savingThrows: [] as string[],
    proficientSkills: [] as string[],
    armorProficiencies: [] as string[],
    weaponProficiencies: [] as string[],
    toolProficiencies: [] as string[],
    languages: [] as string[],
  };
}

// Logic moved to characterLogic.ts

function resolveSpellcastingTypeRecord(
  spellcasting: any,
  spellcastingTypes: any[] = [],
) {
  if (!spellcasting || !Array.isArray(spellcastingTypes) || spellcastingTypes.length === 0) {
    return null;
  }

  const progressionId = String(spellcasting.progressionId || "").trim();
  if (progressionId) {
    const byId = spellcastingTypes.find((type) => type.id === progressionId);
    if (byId) return byId;
  }

  const progressionName = String(spellcasting.progression || "").trim().toLowerCase();
  if (!progressionName) return null;

  return (
    spellcastingTypes.find(
      (type) =>
        String(type.foundryName || "").trim().toLowerCase() === progressionName ||
        String(type.identifier || "").trim().toLowerCase() === progressionName ||
        String(type.name || "").trim().toLowerCase() === progressionName,
    ) || null
  );
}

function resolveScaleValueAtLevel(column: any, level: number) {
  const values =
    (column?.values && typeof column.values === "object" && !Array.isArray(column.values)
      ? column.values
      : null) ||
    (column?.levels && typeof column.levels === "object" && !Array.isArray(column.levels)
      ? column.levels
      : null) ||
    (column?.configuration?.values &&
    typeof column.configuration.values === "object" &&
    !Array.isArray(column.configuration.values)
      ? column.configuration.values
      : null) ||
    {};

  const numericLevels = Object.keys(values)
    .map((entry) => Number(entry))
    .filter((entry) => Number.isFinite(entry) && entry <= level)
    .sort((left, right) => left - right);

  if (numericLevels.length === 0) return null;

  const highestLevel = numericLevels[numericLevels.length - 1];
  return values[String(highestLevel)] ?? null;
}

function normalizeLookupKey(value: any) {
  return String(value ?? "").trim().toLowerCase();
}

function buildGrantedItemLookups(featureCache: Record<string, any[]>, optionsCache: Record<string, any>) {
  const byId: Record<string, any> = {};
  const bySourceId: Record<string, any> = {};
  const byIdentifier: Record<string, any> = {};
  const byName: Record<string, any> = {};

  Object.values(featureCache || {})
    .flat()
    .forEach((feature: any) => {
      if (!feature?.id) return;
      byId[String(feature.id)] = { ...feature, kind: "feature" };
      if (feature.sourceId) {
        bySourceId[String(feature.sourceId)] = { ...feature, kind: "feature" };
      }
      if (feature.identifier) {
        byIdentifier[normalizeLookupKey(feature.identifier)] = {
          ...feature,
          kind: "feature",
        };
      }
      if (feature.name) {
        byName[normalizeLookupKey(feature.name)] = { ...feature, kind: "feature" };
      }
    });

  Object.values(optionsCache || {}).forEach((option: any) => {
    if (!option?.id) return;
    byId[String(option.id)] = { ...option, kind: "option" };
    if (option.sourceId) {
      bySourceId[String(option.sourceId)] = { ...option, kind: "option" };
    }
    if (option.identifier) {
      byIdentifier[normalizeLookupKey(option.identifier)] = {
        ...option,
        kind: "option",
      };
    }
    if (option.name) {
      byName[normalizeLookupKey(option.name)] = { ...option, kind: "option" };
    }
  });

  return { byId, bySourceId, byIdentifier, byName };
}

function collectGrantedItemReferences(advancement: any) {
  const configuration = advancement?.configuration || {};
  const refs = [
    ...uniqueStringList(configuration.pool),
    ...uniqueStringList(
      (Array.isArray(configuration.items) ? configuration.items : []).map(
        (entry: any) => entry?.sourceId || entry?.uuid || entry,
      ),
    ),
    ...uniqueStringList(
      (Array.isArray(advancement?.value?.added) ? advancement.value.added : []).map(
        (entry: any) => entry?.sourceId || entry?.uuid || entry,
      ),
    ),
  ];

  return uniqueStringList(refs);
}

function resolveGrantedItemRecord(ref: string, lookups: any) {
  const raw = String(ref || "").trim();
  if (!raw) return null;

  return (
    lookups.byId?.[raw] ||
    lookups.bySourceId?.[raw] ||
    lookups.byIdentifier?.[normalizeLookupKey(raw)] ||
    lookups.byName?.[normalizeLookupKey(raw)] ||
    null
  );
}

function collectGrantedItemsFromAdvancementList(
  advancements: any[] = [],
  {
    maxLevel = 1,
    defaultLevel = 1,
    parentType = "class",
    lookups,
    classDocument = null,
    introductionMode = "primary",
    applyClassMode = false,
  }: {
    maxLevel?: number;
    defaultLevel?: number;
    parentType?: string;
    lookups: any;
    classDocument?: any;
    introductionMode?: string;
    applyClassMode?: boolean;
  },
) {
  const grantedItems: any[] = [];
  const seen = new Set<string>();

  normalizeProgressionAdvancements(
    advancements,
    defaultLevel,
    Number(classDocument?.hitDie || 8) || 8,
  ).forEach(
    (advancement: any) => {
      const effectiveAdvancement =
        applyClassMode && classDocument
          ? getEffectiveClassAdvancement(
              advancement,
              classDocument,
              introductionMode,
            )
          : advancement;
      if (!effectiveAdvancement || effectiveAdvancement.type !== "ItemGrant") return;

      const level = Number(effectiveAdvancement.level || 1) || 1;
      if (level > maxLevel) return;

      collectGrantedItemReferences(effectiveAdvancement).forEach((ref) => {
        const resolved = resolveGrantedItemRecord(ref, lookups);
        const entry = resolved || { id: ref, name: ref, kind: "item" };
        const dedupeKey = `${parentType}:${entry.id}:${level}`;
        if (seen.has(dedupeKey)) return;
        seen.add(dedupeKey);
        grantedItems.push({
          id: entry.id,
          name: entry.name || ref,
          level,
          parentType,
          kind: entry.kind || "item",
        });
      });
    },
  );

  return grantedItems.sort((left, right) => {
    if (left.level !== right.level) return left.level - right.level;
    return String(left.name || "").localeCompare(String(right.name || ""));
  });
}

function dedupeProgressionEntries(entries: any[] = []) {
  const seen = new Set<string>();
  return entries.filter((entry: any) => {
    const key = [
      String(entry?.parentType || ""),
      String(entry?.id || ""),
      String(entry?.level || ""),
    ].join(":");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function groupProgressionEntriesByLevel(entries: any[] = []) {
  return entries.reduce((acc: Record<number, any[]>, entry: any) => {
    const level = Number(entry?.level || 1) || 1;
    if (!acc[level]) acc[level] = [];
    acc[level].push(entry);
    return acc;
  }, {});
}

const StatBlock = ({
  label,
  value,
  score,
  onPlus,
  onMinus,
}: {
  label: string;
  value: string;
  score: number;
  onPlus: () => void;
  onMinus: () => void;
}) => (
  <div className="flex flex-col items-center group relative pb-4">
    <div className="mb-1">
      <span className="text-xs uppercase font-black text-ink/60 tracking-widest leading-none">
        {label}
      </span>
    </div>
    <div className="w-full h-20 bg-card border-2 border-gold/20 rounded-lg flex flex-col items-center justify-center p-2 shadow-sm transition-all group-hover:border-gold group-hover:shadow-[0_0_15px_rgba(197,160,89,0.2)]">
      <span className="text-3xl font-black text-ink leading-none">{value}</span>
    </div>
    <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 bg-gold px-3 py-1 rounded-sm z-10 border border-gold/40 shadow-md">
      <span className="text-xs font-black text-white leading-none">
        {score}
      </span>
    </div>
    <div className="absolute -right-3 top-1/2 -translate-y-1/2 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-20">
      <button
        onClick={onPlus}
        className="p-1 px-1.5 bg-ink text-gold rounded border border-gold/30 shadow-lg hover:bg-gold hover:text-white transition-all active:scale-90"
      >
        <Plus className="w-3 h-3" />
      </button>
      <button
        onClick={onMinus}
        className="p-1 px-1.5 bg-ink text-gold rounded border border-gold/30 shadow-lg hover:bg-gold hover:text-white transition-all active:scale-90"
      >
        <Minus className="w-3 h-3" />
      </button>
    </div>
  </div>
);

const STEPS = [
  { id: "sheet", label: "Character Sheet", icon: <Save className="w-4 h-4" /> },
  { id: "race", label: "Race", icon: <User className="w-4 h-4" /> },
  { id: "class", label: "Class", icon: <Shield className="w-4 h-4" /> },
  {
    id: "equipment",
    label: "Equipment",
    icon: <Package className="w-4 h-4" />,
  },
  { id: "spells", label: "Spells", icon: <Zap className="w-4 h-4" /> },
  { id: "actions", label: "Actions", icon: <Wind className="w-4 h-4" /> },
  {
    id: "proficiencies",
    label: "Proficiencies",
    icon: <Star className="w-4 h-4" />,
  },
  { id: "history", label: "History", icon: <Clock className="w-4 h-4" /> },
];

export default function CharacterBuilder({
  userProfile,
}: {
  userProfile: any;
}) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeStep, setActiveStep] = useState("sheet");
  const [sheetSection, setSheetSection] = useState("info");
  const [isSelectingClass, setIsSelectingClass] = useState(false);
  const [isSelectingSubclass, setIsSelectingSubclass] = useState({
    open: false,
    classId: "",
    level: 0,
  });
  const [availableSubclasses, setAvailableSubclasses] = useState<any[]>([]);
  const [classCache, setClassCache] = useState<Record<string, any>>({});
  const [subclassCache, setSubclassCache] = useState<Record<string, any>>({});
  const [featureCache, setFeatureCache] = useState<Record<string, any[]>>({});
  const [scalingCache, setScalingCache] = useState<Record<string, any>>({});
  const [optionsCache, setOptionsCache] = useState<Record<string, any>>({});

  const [optionDialogOpen, setOptionDialogOpen] = useState<{
    name: string;
    count: number;
    advId: string;
    level: number;
    selectionKey: string;
    sourceScope?: string;
    choiceId?: string;
    featureType?: string;
    optionGroupId?: string;
  } | null>(null);
  const [availableOptions, setAvailableOptions] = useState<any[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);

  const handleOpenOptionDialog = async (choice: {
    name: string;
    count: number;
    advId: string;
    level: number;
    selectionKey: string;
    sourceScope?: string;
    choiceId?: string;
    featureType?: string;
    optionGroupId?: string;
    configuration?: any;
    advType?: string;
  }) => {
    setOptionDialogOpen(choice);
    setLoadingOptions(true);
    setAvailableOptions([]);
    try {
      if (choice.optionGroupId) {
        const rows = await fetchCollection<any>("uniqueOptionItems", {
          where: "group_id = ?",
          params: [choice.optionGroupId],
        });
        const excludedOptionIds = new Set(choice.configuration?.excludedOptionIds || []);
        const items = rows.filter((item: any) => !excludedOptionIds.has(item.id));
        setAvailableOptions(items);
        setOptionsCache((prev) => {
          const nc = { ...prev };
          items.forEach((i: any) => (nc[i.id] = i));
          return nc;
        });
      } else if (choice.configuration?.choiceType === "feature") {
        const pool = choice.configuration?.pool || [];
        if (pool.length > 0) {
          const slice = pool.slice(0, 30);
          const placeholders = slice.map(() => '?').join(',');
          const items = await fetchCollection<any>("features", {
            where: `id IN (${placeholders})`,
            params: slice,
          });
          setAvailableOptions(items);
          setOptionsCache((prev) => {
            const nc = { ...prev };
            items.forEach((i: any) => (nc[i.id] = i));
            return nc;
          });
        }
      } else if (choice.advType === "Trait") {
        const canonicalTraitChoices = getCanonicalTraitChoiceEntries(
          choice.configuration,
        );
        const primaryTraitChoice =
          canonicalTraitChoices.find(
            (entry) => entry.id === choice.advId || choice.advId?.endsWith(`-${entry.id}`),
          ) || canonicalTraitChoices[0];
        const pool = primaryTraitChoice?.pool || [];
        const categoryIds = primaryTraitChoice?.categoryIds || [];
        const traitType = primaryTraitChoice?.type || choice.configuration?.type;
        const traitCollection = TRAIT_TYPE_COLLECTIONS[traitType];

        if ((pool.length > 0 || categoryIds.length > 0) && traitCollection) {
          try {
            const fetches: Promise<any[]>[] = [];
            if (pool.length > 0) {
              const slice = pool.slice(0, 30);
              const placeholders = slice.map(() => '?').join(',');
              fetches.push(
                fetchCollection<any>(traitCollection, {
                  where: `id IN (${placeholders})`,
                  params: slice,
                }).catch(() => [] as any[]),
              );
            }
            if (categoryIds.length > 0) {
              const slice = categoryIds.slice(0, 30);
              const placeholders = slice.map(() => '?').join(',');
              fetches.push(
                fetchCollection<any>(traitCollection, {
                  where: `category_id IN (${placeholders})`,
                  params: slice,
                }).catch(() => [] as any[]),
              );
            }
            const allRows = await Promise.all(fetches);
            // De-dupe by id; rows from the pool/category fetches can overlap.
            const items = Array.from(
              new Map(
                allRows.flat().map((r: any) => [r.id, r]),
              ).values(),
            );
            setAvailableOptions(items);
            setOptionsCache((prev) => {
              const nc = { ...prev };
              items.forEach((i: any) => (nc[i.id] = i));
              return nc;
            });
          } catch (e) {
            console.error("Error fetching trait options", e);
          }
        }
      } else {
        // Legacy branch: queried Firestore for `featureType` on uniqueOptionItems.
        // That field never existed on the D1 unique_option_items schema; the
        // Firestore version returned zero docs in practice. Preserve the
        // no-op behavior so this code path remains a clean fall-through.
        setAvailableOptions([]);
      }
    } catch (err) {
      console.error("Failed to load options", err);
    } finally {
      setLoadingOptions(false);
    }
  };

  const handleRemoveClass = (className: string) => {
    setCharacter((prev: any) => {
      const newProg = (prev.progression || []).filter(
        (p: any) => p.className !== className,
      );
      
      // Re-calculate level and reset main class if necessary
      const newLevel = newProg.length;
      const nextGroups = buildProgressionClassGroups(
        newProg,
        classCache,
        subclassCache,
        prev.subclassId,
      );
      let nextClassId = nextGroups[0]?.classId || "";
      let nextSubclassId = nextGroups[0]?.subclassId || "";

      // Find the class document by name to compare with prev.classId
      const removedClassDoc = Object.values(classCache).find(c => c.name === className);
      
      if (removedClassDoc && prev.classId === removedClassDoc.id) {
        if (newProg.length > 0) {
          const firstClassDoc = Object.values(classCache).find(c => c.name === newProg[0].className);
          nextClassId = firstClassDoc ? firstClassDoc.id : "";
        } else {
          nextClassId = "";
        }
      }

      if (newProg.length === 0) {
        nextClassId = "";
        nextSubclassId = "";
      }

      return {
        ...prev,
        level: newLevel,
        progression: newProg,
        classId: nextClassId,
        subclassId: nextSubclassId,
      };
    });
  };

  const [character, setCharacter] = useState<any>({
    name: "",
    level: 1,
    isLevelLocked: false,
    campaignId: "",
    classId: "",
    subclassId: "",
    backgroundId: "",
    raceId: "",
    imageUrl: "",
    hasInspiration: false,
    exhaustion: 0,
    hp: { current: 10, max: 10, temp: 0 },
    hitDie: { current: 1, max: 1, type: "d10" },
    spellPoints: { current: 0, max: 0 },
    ac: 10,
    initiative: 0,
    speed: 30,
    proficiencyBonus: 2,
    stats: {
      base: {
        STR: 10,
        DEX: 10,
        CON: 10,
        INT: 10,
        WIS: 10,
        CHA: 10,
      },
    },
    savingThrows: [],
    proficientSkills: [],
    expertiseSkills: [],
    halfProficientSkills: [],
    halfProficientSavingThrows: [],
    overriddenSkillAbilities: {},
    resistances: [],
    immunities: [],
    vulnerabilities: [],
    armorProficiencies: [],
    weaponProficiencies: [],
    toolProficiencies: [],
    languages: [],
    senses: {
      passivePerception: 10,
      passiveInvestigation: 10,
      passiveInsight: 10,
      additional: "",
    },
    classGrantedTraits: buildEmptyClassGrantedTraits(),
    raceData: {
      creatureType: "",
      size: "",
    },
    info: {
      alignment: "",
      gender: "",
      eyes: "",
      height: "",
      hair: "",
      skin: "",
      age: "",
      weight: "",
      deity: "",
      reverate: "",
      scorn: "",
      traits: "",
      ideals: "",
      bonds: "",
      flaws: "",
      appearance: "",
    },
    bookmarks: [],
    progressionState: buildEmptyProgressionState(),
    selectedOptions: {}, // e.g. { "Invocations": ["item_id_1", "item_id_2"] }
  });

  const selectedOptionsMap = useMemo(
    () => buildCharacterSelectedOptionsMap(character),
    [character.progressionState, character.selectedOptions],
  );

  useEffect(() => {
    const fetchSelectedOptions = async () => {
      const allSelectedIds = Object.values(
        selectedOptionsMap || {},
      ).flat() as string[];
      if (allSelectedIds.length === 0) return;

      const missingIds = allSelectedIds.filter((id) => !optionsCache[id]);
      if (missingIds.length === 0) return;

      try {
        const results = await Promise.all(
          missingIds.map((id: string) => fetchDocument<any>("uniqueOptionItems", id)),
        );
        setOptionsCache((prev) => {
          const nc = { ...prev };
          results.forEach((row: any) => {
            if (row && row.id) nc[row.id] = row;
          });
          return nc;
        });
      } catch (err) {
        console.error("Failed to load options cache", err);
      }
    };
    fetchSelectedOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOptionsMap]);

  useEffect(() => {
    const fetchFeatures = async () => {
      try {
        const progression =
          (character.progression && character.progression.length > 0)
            ? character.progression
            : (character.classId
              ? Array.from({ length: character.level || 1 }).map((_, i) => ({
                  className: character.classId,
                  level: i + 1,
                }))
              : []);
        if (progression.length === 0) return;

        // Get unique class names
        const classNames: string[] = Array.from(
          new Set(progression.map((p: any) => p.className)),
        );

        let newClassCache = { ...classCache };
        const missingNames = classNames.filter(
          (name) => !Object.values(newClassCache).find((c) => c.name === name),
        );

        if (missingNames.length > 0) {
          const rows = await fetchCollection<any>("classes");
          rows.forEach((raw: any) => {
            const data = denormClass(raw);
            newClassCache[data.id] = {
              ...data,
              advancements: normalizeProgressionAdvancements(
                data.advancements || [],
                1,
                data.hitDie || 8,
              ),
            };
          });
          setClassCache(newClassCache);
        }

        // Feature caching
        const classIdsInProgression = classNames
          .map((name) => {
            const found = Object.values(newClassCache).find(
              (c) => c.name === name,
            );
            return found ? found.id : null;
          })
          .filter(Boolean) as string[];

        const progressionGroups = buildProgressionClassGroups(
          progression,
          newClassCache,
          subclassCache,
          character.subclassId,
        );

        // Subclass caching
        let newSubclassCache = { ...subclassCache };
        const missingSubclassIds = uniqueStringList(
          progressionGroups.map((group: any) => group.subclassId).filter(Boolean),
        ).filter((id) => !newSubclassCache[id]);
        if (missingSubclassIds.length > 0) {
          const scResults = await Promise.all(
            missingSubclassIds.map((id) => fetchDocument<any>("subclasses", id)),
          );
          scResults.forEach((raw: any) => {
            if (!raw) return;
            const data = denormSubclass(raw);
            const subclassHitDie = Number(
              newClassCache[String(data.classId || "")]?.hitDie || 8,
            ) || 8;
            newSubclassCache[data.id] = {
              ...data,
              advancements: normalizeProgressionAdvancements(
                data.advancements || [],
                1,
                subclassHitDie,
              ),
            };
          });
          setSubclassCache(newSubclassCache);
        }

        let newFeatureCache = { ...featureCache };
        const missingClassIds = classIdsInProgression.filter(
          (id) => !newFeatureCache[id],
        );
        const subclassIds = Object.keys(newSubclassCache);
        const missingSubclassFIds = subclassIds.filter(
          (id) => !newFeatureCache[id],
        );

        if (missingClassIds.length > 0 || missingSubclassFIds.length > 0) {
          const featurePromises = [
            ...missingClassIds.map((id) => ({ id, type: "class" })),
            ...missingSubclassFIds.map((id) => ({ id, type: "subclass" })),
          ].map(async ({ id, type }) => {
            const rows = await fetchCollection<any>("features", {
              where: "parent_id = ? AND parent_type = ?",
              params: [id, type],
            });
            const parentHitDie =
              type === "class"
                ? Number(newClassCache[id]?.hitDie || 8) || 8
                : Number(
                    newClassCache[
                      String(newSubclassCache[id]?.classId || "")
                    ]?.hitDie || 8,
                  ) || 8;
            return {
              id,
              features: rows.map((raw: any) => {
                const data = denormFeature(raw);
                return {
                  ...data,
                  advancements: normalizeProgressionAdvancements(
                    data.advancements || [],
                    Number(data.level || 1) || 1,
                    parentHitDie,
                  ),
                };
              }),
            };
          });

          const results = await Promise.all(featurePromises);
          results.forEach((res) => {
            newFeatureCache[res.id] = res.features;
          });
          setFeatureCache(newFeatureCache);
        }

        // Scaling Columns caching
        let newScalingCache = { ...scalingCache };
        const missingScalingParentIds = [
          ...classIdsInProgression,
          ...subclassIds,
        ].filter(
          (id) =>
            !Object.values(newScalingCache).some((col) => col.parentId === id),
        );

        if (missingScalingParentIds.length > 0) {
          const scalingPromises = missingScalingParentIds.map((id) =>
            fetchCollection<any>("scalingColumns", {
              where: "parent_id = ?",
              params: [id],
            }),
          );

          const results = await Promise.all(scalingPromises);
          results.flat().forEach((raw: any) => {
            const col = denormScalingCol(raw);
            newScalingCache[col.id] = col;
          });
          setScalingCache(newScalingCache);
        }
      } catch (err) {
        console.error("Failed to load class features:", err);
      }
    };
    fetchFeatures();
  }, [
    character.progression,
    character.classId,
    character.level,
    character.subclassId,
  ]);

  useEffect(() => {
    const currentProgression = buildCurrentProgression(character);

    const nextClassGrantedTraits = buildEmptyClassGrantedTraits();

    const classEntries = buildProgressionClassGroups(
      currentProgression,
      classCache,
      subclassCache,
      character.subclassId,
    );

    classEntries.forEach((entry: any) => {
      const classKey = entry.classKey;
      const classDocument = entry.classDocument ||
        classCache[classKey] ||
        Object.values(classCache).find(
          (candidate: any) =>
            candidate?.id === entry?.classId || candidate?.name === entry?.className,
        );

      if (!classDocument) return;

      const classLevel = Number(entry.classLevel || 0) || 0;

      if (classLevel <= 0) return;

      const introductionMode = getClassIntroductionMode(
        currentProgression,
        classKey,
      );
      const resolvedHitDie = Number(classDocument.hitDie || 8) || 8;
      const classAdvancements = normalizeProgressionAdvancements(
        classDocument.advancements || [],
        1,
        resolvedHitDie,
      );

      classAdvancements.forEach((advancement: any) => {
        if (advancement.type !== "Trait") return;
        if ((Number(advancement.level || 1) || 1) > classLevel) return;

        const effectiveAdvancement =
          String(advancement._id || "").startsWith("base-")
            ? getEffectiveClassAdvancement(
                advancement,
                classDocument,
                introductionMode,
              )
            : advancement;
        if (!effectiveAdvancement) return;

        applyTraitValuesToCharacterGrants(
          nextClassGrantedTraits,
          effectiveAdvancement.configuration?.type,
          collectTraitValuesFromAdvancement(
            effectiveAdvancement,
            selectedOptionsMap,
            buildAdvancementSourceContext({
              parentType: "class",
              classDocument,
            }),
          ),
        );
      });

      const classFeatures = (featureCache[classDocument.id] || []).filter(
        (feature: any) => (Number(feature.level || 1) || 1) <= classLevel,
      );
      classFeatures.forEach((feature: any) => {
        normalizeProgressionAdvancements(
          feature.advancements || [],
          Number(feature.level || 1) || 1,
          resolvedHitDie,
        ).forEach((advancement: any) => {
          if (advancement.type !== "Trait") return;
          if ((Number(advancement.level || feature.level || 1) || 1) > classLevel) return;
          applyTraitValuesToCharacterGrants(
            nextClassGrantedTraits,
            advancement.configuration?.type,
            collectTraitValuesFromAdvancement(
              advancement,
              selectedOptionsMap,
              buildAdvancementSourceContext({
                parentType: "feature",
                classDocument,
                parentDocument: feature,
              }),
            ),
          );
        });
      });

      const selectedSubclass =
        entry.subclassId &&
        subclassCache[entry.subclassId]?.classId === classDocument.id
          ? subclassCache[entry.subclassId]
          : null;

      if (!selectedSubclass) return;

      normalizeProgressionAdvancements(
        selectedSubclass.advancements || [],
        1,
        resolvedHitDie,
      ).forEach((advancement: any) => {
        if (advancement.type !== "Trait") return;
        if ((Number(advancement.level || 1) || 1) > classLevel) return;
        applyTraitValuesToCharacterGrants(
          nextClassGrantedTraits,
          advancement.configuration?.type,
          collectTraitValuesFromAdvancement(
            advancement,
            selectedOptionsMap,
            buildAdvancementSourceContext({
              parentType: "subclass",
              classDocument,
              subclassDocument: selectedSubclass,
            }),
          ),
        );
      });

      const subclassFeatures = (featureCache[selectedSubclass.id] || []).filter(
        (feature: any) => (Number(feature.level || 1) || 1) <= classLevel,
      );
      subclassFeatures.forEach((feature: any) => {
        normalizeProgressionAdvancements(
          feature.advancements || [],
          Number(feature.level || 1) || 1,
          resolvedHitDie,
        ).forEach((advancement: any) => {
          if (advancement.type !== "Trait") return;
          if ((Number(advancement.level || feature.level || 1) || 1) > classLevel) return;
          applyTraitValuesToCharacterGrants(
            nextClassGrantedTraits,
            advancement.configuration?.type,
            collectTraitValuesFromAdvancement(
              advancement,
              selectedOptionsMap,
              buildAdvancementSourceContext({
                parentType: "subclass-feature",
                classDocument,
                subclassDocument: selectedSubclass,
                parentDocument: feature,
              }),
            ),
          );
        });
      });
    });

    setCharacter((prev: any) => {
      const previousClassGranted =
        prev.classGrantedTraits || buildEmptyClassGrantedTraits();
      const nextUpdates: Record<string, any> = {};
      let hasChanges = false;

      Object.keys(nextClassGrantedTraits).forEach((field) => {
        const currentValues = Array.isArray(prev[field]) ? prev[field] : [];
        const previousDerived = Array.isArray(previousClassGranted[field])
          ? previousClassGranted[field]
          : [];
        const preservedValues = currentValues.filter(
          (value: string) => !previousDerived.includes(value),
        );
        const nextValues = uniqueStringList([
          ...preservedValues,
          ...nextClassGrantedTraits[field],
        ]);

        if (!areStringListsEqual(currentValues, nextValues)) {
          nextUpdates[field] = nextValues;
          hasChanges = true;
        }
      });

      if (
        Object.keys(nextClassGrantedTraits).some(
          (field) =>
            !areStringListsEqual(
              previousClassGranted[field] || [],
              nextClassGrantedTraits[field] || [],
            ),
        )
      ) {
        nextUpdates.classGrantedTraits = nextClassGrantedTraits;
        hasChanges = true;
      }

      return hasChanges ? { ...prev, ...nextUpdates } : prev;
    });
  }, [
    character.classId,
    character.level,
    character.progression,
    selectedOptionsMap,
    character.subclassId,
    classCache,
    featureCache,
    subclassCache,
  ]);

  useEffect(() => {
    const progression = buildCurrentProgression(character);
    const totalLevel = getTotalCharacterLevel(progression, character.level);
    const nextProficiencyBonus = getProficiencyBonusForLevel(totalLevel);

    setCharacter((prev: any) => (
      Number(prev.proficiencyBonus ?? 0) === nextProficiencyBonus
        ? prev
        : { ...prev, proficiencyBonus: nextProficiencyBonus }
    ));
  }, [character.progression, character.level]);

  useEffect(() => {
    const progression = buildCurrentProgression(character);
    if (progression.length === 0) return;

    const conMod = Math.floor(((character.stats?.base?.CON ?? 10) - 10) / 2);
    let derivedHpMax = 0;

    progression.forEach((entry: any, index: number) => {
      const classDocument =
        classCache[entry?.classId || ""] ||
        Object.values(classCache).find(
          (candidate: any) =>
            candidate?.id === entry?.classId || candidate?.name === entry?.className,
        );
      const faces = Number(String(classDocument?.hitDie || "d8").replace(/[^\d]/g, "")) || 8;
      const baseGain = index === 0 ? faces : Math.floor(faces / 2) + 1;
      derivedHpMax += Math.max(1, baseGain + conMod);
    });

    const primaryClassEntry = progression[0];
    const primaryClassDocument =
      classCache[primaryClassEntry?.classId || ""] ||
      Object.values(classCache).find(
        (candidate: any) =>
          candidate?.id === primaryClassEntry?.classId ||
          candidate?.name === primaryClassEntry?.className,
      );
    const primaryHitDieType = String(primaryClassDocument?.hitDie || "d8");

    setCharacter((prev: any) => {
      const previousDerivedHpMax =
        Number(prev.derivedHpMax ?? 10) || 10;
      const storedHpMax = getStoredHpMax(prev);
      const currentHpMax = storedHpMax ?? previousDerivedHpMax;
      const currentHpValue = Number(prev.hp?.current ?? currentHpMax) || currentHpMax;

      const shouldUpdateMax =
        storedHpMax != null &&
        (storedHpMax === previousDerivedHpMax || storedHpMax === 10);
      const shouldUpdateCurrent =
        currentHpValue === previousDerivedHpMax || currentHpValue === 10 || currentHpValue === currentHpMax;

      const nextHitDieMax = progression.length;
      const nextHitDieCurrent = Math.min(
        Number(prev.hitDie?.current ?? nextHitDieMax) || nextHitDieMax,
        nextHitDieMax,
      );

      const nextState: any = {
        ...prev,
        derivedHpMax,
        hitDie: {
          ...(prev.hitDie || {}),
          max: nextHitDieMax,
          current: nextHitDieCurrent,
          type: primaryHitDieType,
        },
      };

      if (shouldUpdateMax || shouldUpdateCurrent) {
        nextState.hp = {
          ...(prev.hp || {}),
          ...(storedHpMax != null
            ? { max: shouldUpdateMax ? derivedHpMax : storedHpMax }
            : {}),
          current: shouldUpdateCurrent
            ? (storedHpMax != null && !shouldUpdateMax ? storedHpMax : derivedHpMax)
            : currentHpValue,
        };
      }

      const hitDieUnchanged =
        String(prev.hitDie?.type || "") === primaryHitDieType &&
        Number(prev.hitDie?.max ?? 0) === nextHitDieMax &&
        Number(prev.hitDie?.current ?? 0) === nextHitDieCurrent;
      const hpUnchanged =
        Number((nextState.hp || prev.hp)?.max ?? 0) === Number(prev.hp?.max ?? 0) &&
        Number((nextState.hp || prev.hp)?.current ?? 0) === Number(prev.hp?.current ?? 0);
      const derivedUnchanged = Number(prev.derivedHpMax ?? 0) === derivedHpMax;

      return hitDieUnchanged && hpUnchanged && derivedUnchanged ? prev : nextState;
    });
  }, [character.classId, character.progression, character.stats?.base?.CON, classCache]);

  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [allSkills, setAllSkills] = useState<any[]>([]);
  const [allAttributes, setAllAttributes] = useState<any[]>([]);
  const [proficiencyCatalogs, setProficiencyCatalogs] = useState<Record<string, Record<string, string>>>({
    armor: {},
    armorCategories: {},
    weapons: {},
    weaponCategories: {},
    tools: {},
    toolCategories: {},
    languages: {},
    languageCategories: {},
  });
  const [spellcastingTypes, setSpellcastingTypes] = useState<any[]>([]);
  const [masterMulticlassChart, setMasterMulticlassChart] = useState<any | null>(null);
  const isStaff = ["admin", "co-dm"].includes(userProfile?.role);
  const isAdmin = userProfile?.role === "admin";

  const generatePairingJson = () => {
    const skillMap: Record<string, string> = {
      acrobatics: "acr",
      animal_handling: "ani",
      arcana: "arc",
      athletics: "ath",
      deception: "dec",
      history: "his",
      insight: "ins",
      intimidation: "itm",
      investigation: "inv",
      medicine: "med",
      nature: "nat",
      perception: "prc",
      performance: "prf",
      persuasion: "per",
      religion: "rel",
      sleight_of_hand: "slt",
      stealth: "ste",
      survival: "sur",
    };

    const skills: Record<string, any> = {};
    allSkills.forEach((s) => {
      const isProf = character.proficientSkills?.includes(s.id);
      const isExp = character.expertiseSkills?.includes(s.id);
      const isHalf = character.halfProficientSkills?.includes(s.id);

      let val = 0;
      if (isExp) val = 2;
      else if (isProf) val = 1;
      else if (isHalf) val = 0.5;

      const key = skillMap[s.id] || s.id.substring(0, 3);
      skills[key] = {
        value: val,
        ability: (
          character.overriddenSkillAbilities?.[s.id] || s.ability
        ).toLowerCase(),
      };
    });

    const abilities: Record<string, any> = {};
    const attrIdentifiers = allAttributes.length > 0 
      ? allAttributes.map(a => a.identifier || a.id)
      : ["STR", "DEX", "CON", "INT", "WIS", "CHA"];

    attrIdentifiers.forEach((a) => {
      const key = a.toLowerCase();
      const isProf = character.savingThrows?.includes(a);
      const isHalf = character.halfProficientSavingThrows?.includes(a);

      abilities[key] = {
        value: character.stats?.base?.[a] ?? 10,
        proficient: isProf ? 1 : isHalf ? 0.5 : 0,
      };
    });

    const items: any[] = [];
    const exportProgression = buildCurrentProgression(character);
    const totalCharacterLevel = getTotalCharacterLevel(
      exportProgression,
      character.level,
    );
    const proficiencyBonus = getProficiencyBonusForLevel(totalCharacterLevel);
    const hpMaxOverride = hasExplicitHpMaxOverride(character)
      ? getStoredHpMax(character)
      : null;
    const exportClassGroups = buildCharacterClassesFromProgression(
      buildProgressionClassGroups(
        exportProgression,
        classCache,
        subclassCache,
        character.subclassId,
      ),
      subclassCache,
    );

    exportClassGroups.forEach((clsData: any) => {
      const clsDoc = classCache[clsData.classId];
      const classSummary =
        resolvedClassProgressionSummaries.find(
          (summary: any) =>
            summary.classId === clsData.classId &&
            String(summary.subclassDocument?.id || "").trim() ===
              String(clsData.subclassId || "").trim(),
        ) ||
        resolvedClassProgressionSummaries.find(
          (summary: any) => summary.classId === clsData.classId,
        ) ||
        null;
      if (clsDoc) {
        const classAdvancementSource = buildAdvancementSourceContext({
          parentType: "class",
          classDocument: clsDoc,
        });
        const hitDieFaces = resolveHitDieFaces(clsDoc.hitDie);
        items.push({
          name: clsDoc.name,
          type: "class",
          img: clsDoc.imageUrl || "icons/svg/item-bag.svg",
          system: {
            identifier: clsDoc.name.toLowerCase().replace(/\s+/g, "-"),
            levels: clsData.level || 1,
            hd: {
              number: clsData.level || 1,
              denomination: String(hitDieFaces || 10),
            },
            spellcasting: normalizeSpellcastingForExport(clsDoc.spellcasting, 1),
            primaryAbility: {
              value:
                normalizePrimaryAbilityValue(clsDoc.primaryAbility).length > 0
                  ? normalizePrimaryAbilityValue(clsDoc.primaryAbility)
                  : ["str"],
            },
            advancement: (clsDoc.advancements || []).map((adv: any) => {
              const res = { ...adv };
              const chosenSelections = collectAdvancementSelectionsForExport(
                adv,
                selectedOptionsMap,
                classAdvancementSource,
              );
              
              if (adv.type === "HitPoints") {
                const hdSize = hitDieFaces || 8;
                const avg = Math.floor(hdSize / 2) + 1;
                
                const hpValue: Record<string, string | number> = { "1": "max" };
                for (let i = 2; i <= clsData.level; i++) {
                  hpValue[i.toString()] = avg;
                }
                res.value = hpValue;
              } else if (chosenSelections.length > 0) {
                if (
                  adv.type === "Trait" ||
                  adv.type === "ItemChoice" ||
                  adv.type === "Subclass"
                ) {
                  const chosenRaw = chosenSelections;
                  let chosenSemantic = chosenRaw;
                  if (adv.type === "Trait") {
                    chosenSemantic = chosenRaw.map((id: string) => {
                      const cached =
                        optionsCache[id] ||
                        allSkills.find((s) => s.id === id) ||
                        allAttributes.find(
                          (a) => a.id === id || a.identifier === id,
                        );
                      if (cached) {
                        if (cached.ability) {
                          // Assuming skills have 'ability'
                          const code =
                            (skillMap as any)[id] || id.substring(0, 3);
                          return `skills:${code}`;
                        } else if (
                          cached.identifier &&
                          cached.identifier.length === 3
                        ) {
                          // Attributes/Saves
                          return `saves:${cached.identifier.toLowerCase()}`;
                        } else {
                          return `tools:${id.replace(/[^a-z0-9]/g, "").substring(0, 3)}`; // Fallback for tools
                        }
                      }
                      return id;
                    });
                  }
                  res.value = {
                    chosen: chosenSemantic,
                  };
                }
              }
              return res;
            }),
          },
          flags: {
            "dauligor-pairing": {
              sourceId: `class-${clsDoc.id}`,
            },
          },
        });

        const ownedClassFeatures = (
          classSummary?.features || []
        ).filter(
          (feature: any) =>
            !String(feature?.parentType || "").includes("subclass"),
        );
        ownedClassFeatures.forEach((feat: any) => {
          if ((Number(feat.level || 1) || 1) <= clsData.level) {
            items.push({
              name: feat.name,
              type: "feat",
              img: feat.imageUrl || "icons/svg/book.svg",
              system: {
                description: { value: feat.description || "" },
                identifier: feat.name.toLowerCase().replace(/\W+/g, "-"),
                type: { value: "class", subtype: "" },
              },
              flags: {
                "dauligor-pairing": {
                  sourceId: feat.sourceId || `feature-${feat.id}`,
                  classSourceId: `class-${clsDoc.id}`,
                },
              },
            });
          }
        });

        const ownedClassOptionItems = (
          classSummary?.grantedItems || []
        ).filter((entry: any) =>
          ["option", "selection"].includes(String(entry?.kind || "").trim()),
        );
        ownedClassOptionItems.forEach((entry: any) => {
          items.push({
            name: entry.name,
            type: "feat",
            img: entry.imageUrl || "icons/svg/book.svg",
            system: {
              description: { value: entry.description || "" },
              identifier: String(entry.sourceId || entry.id || entry.name)
                .toLowerCase()
                .replace(/\W+/g, "-"),
              type: {
                value: entry.featureTypeValue || "class",
                subtype: entry.featureTypeSubtype || "",
              },
            },
            flags: {
              "dauligor-pairing": {
                sourceId: entry.sourceId || `class-option-${entry.id}`,
                classSourceId: `class-${clsDoc.id}`,
                groupSourceId: entry.groupSourceId || null,
                featureSourceId: entry.featureSourceId || null,
                scalingSourceId: entry.scalingSourceId || null,
                featureTypeValue: entry.featureTypeValue || "class",
                featureTypeSubtype: entry.featureTypeSubtype || "",
              },
            },
          });
        });
      }

      if (clsData.subclassId) {
        const subDoc = subclassCache[clsData.subclassId];
        if (subDoc) {
          const subclassAdvancementSource = buildAdvancementSourceContext({
            parentType: "subclass",
            classDocument: clsDoc,
            subclassDocument: subDoc,
          });
          items.push({
            name: subDoc.name,
            type: "subclass",
            img: subDoc.imageUrl || "icons/svg/item-bag.svg",
            system: {
              identifier: subDoc.name.toLowerCase().replace(/\s+/g, "-"),
              classIdentifier: clsDoc
                ? clsDoc.name.toLowerCase().replace(/\s+/g, "-")
                : "",
              spellcasting: normalizeSpellcastingForExport(
                subDoc.spellcasting,
                3,
              ),
              advancement: (subDoc.advancements || []).map((adv: any) => {
                const res = { ...adv };
                const chosenSelections = collectAdvancementSelectionsForExport(
                  adv,
                  selectedOptionsMap,
                  subclassAdvancementSource,
                );
                if (chosenSelections.length > 0) {
                  if (
                    adv.type === "Trait" ||
                    adv.type === "ItemChoice" ||
                    adv.type === "Subclass"
                  ) {
                    res.value = {
                      chosen: chosenSelections,
                    };
                  }
                }
                return res;
              }),
            },
            flags: {
              "dauligor-pairing": {
                sourceId: `subclass-${subDoc.id}`,
              },
            },
          });

          const ownedSubclassFeatures = (
            classSummary?.features || []
          ).filter((feature: any) =>
            String(feature?.parentType || "").includes("subclass"),
          );
          ownedSubclassFeatures.forEach((feat: any) => {
            if ((Number(feat.level || 1) || 1) <= clsData.level) {
              items.push({
                name: feat.name,
                type: "feat",
                img: feat.imageUrl || "icons/svg/book.svg",
                system: {
                  description: { value: feat.description || "" },
                  identifier: feat.name.toLowerCase().replace(/\W+/g, "-"),
                  type: { value: "subclass", subtype: "" },
                },
                flags: {
                  "dauligor-pairing": {
                    sourceId: feat.sourceId || `feature-${feat.id}`,
                    classSourceId: clsDoc ? `class-${clsDoc.id}` : null,
                    parentSourceId: `subclass-${subDoc.id}`,
                  },
                },
              });
            }
          });
        }
      }
    });

    return {
      kind: "dauligor.actor-bundle.v1",
      schemaVersion: 1,
      source: {
        system: "dauligor",
        entity: "actor",
        id: character.id || id || "new",
        rules: "2014",
        revision: 1
      },
      actor: {
        name: character.name || "UNNAMED ADVENTURER",
        type: "character",
        img: character.imageUrl || "icons/svg/mystery-man.svg",
        system: {
          abilities,
          attributes: {
            hp: {
              value: character.hp?.current ?? 10,
              ...(hpMaxOverride != null ? { max: hpMaxOverride } : {}),
              temp: character.hp?.temp ?? 0,
            },
            ac: {
              flat: character.ac ?? 10,
              calc: "flat",
            },
            init: { bonus: character.initiative ?? 0 },
            movement: { walk: character.speed ?? 30, units: "ft" },
            prof: proficiencyBonus,
            exhaustion: character.exhaustion ?? 0,
          },
          details: {
            alignment: character.info?.alignment ?? "",
            race: character.raceId ?? "",
            background: character.backgroundId ?? "",
            biography: {
              value: `
                ${character.info?.appearance ? `<h3>Appearance</h3><p>${character.info.appearance}</p>` : ""}
                ${character.info?.traits ? `<h3>Traits</h3><p>${character.info.traits}</p>` : ""}
                ${character.info?.ideals ? `<h3>Ideals</h3><p>${character.info.ideals}</p>` : ""}
                ${character.info?.bonds ? `<h3>Bonds</h3><p>${character.info.bonds}</p>` : ""}
                ${character.info?.flaws ? `<h3>Flaws</h3><p>${character.info.flaws}</p>` : ""}
              `.trim(),
            },
          },
          skills,
          traits: {
            size: (character.raceData?.size || "Medium")
              .toLowerCase()
              .substring(0, 3),
            languages: { value: character.languages || [] },
            dr: { value: character.resistances || [] },
            di: { value: character.immunities || [] },
            dv: { value: character.vulnerabilities || [] },
          },
        },
        flags: {
          "dauligor-pairing": {
            sourceId: `character-${character.id || id || "new"}`,
            entityKind: "character",
            schemaVersion: 1,
            primaryClassId: exportClassGroups[0]?.classId || character.classId || "",
            primarySubclassId:
              exportClassGroups[0]?.subclassId || character.subclassId || "",
            progressionClassIds: uniqueStringList(
              exportClassGroups.map((group: any) => group.classId),
            ),
            progressionSubclassIds: uniqueStringList(
              exportClassGroups.map((group: any) => group.subclassId),
            ),
            selectedOptions: selectedOptionsMap,
          },
        },
      },
      items,
    };
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        if (id && id !== "new") {
          const [baseRows, progressionRows, selectionRows, inventoryRows, spellRows, proficiencyRows] = await Promise.all([
            queryD1("SELECT * FROM characters WHERE id = ?", [id]),
            queryD1("SELECT * FROM character_progression WHERE character_id = ?", [id]),
            queryD1("SELECT * FROM character_selections WHERE character_id = ?", [id]),
            queryD1("SELECT * FROM character_inventory WHERE character_id = ?", [id]),
            queryD1("SELECT * FROM character_spells WHERE character_id = ?", [id]),
            queryD1("SELECT * FROM character_proficiencies WHERE character_id = ?", [id])
          ]);

          if (baseRows && baseRows.length > 0) {
            const data = rebuildCharacterFromSql(
              baseRows[0],
              progressionRows,
              selectionRows,
              inventoryRows,
              spellRows,
              proficiencyRows
            );

            if (data) {
              const normalizedBase: Record<string, number> = {};
              const rawBase = data.stats?.base || { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 };
              Object.entries(rawBase).forEach(([key, val]) => {
                normalizedBase[key.toUpperCase()] = Number(val);
              });

              setCharacter({
                ...data,
                progression: Array.isArray(data.progression)
                  ? data.progression.map((entry: any) => ({
                      ...entry,
                      subclassId: String(entry?.subclassId || "").trim(),
                    }))
                  : buildCurrentProgression({
                      classId: data.classId,
                      subclassId: data.subclassId,
                      level: data.level || 1,
                    }),
                hp: data.hp || { current: 10, max: 10, temp: 0 },
                stats: {
                  ...(data.stats || { method: "point-buy" }),
                  base: normalizedBase,
                },
                progressionState: normalizeProgressionState(data.progressionState),
              });
            }
          } else {
            navigate("/characters");
          }
        }

        if (isStaff) {
          const camps = await fetchCollection<any>("campaigns");
          setCampaigns(camps);
        }

        // Attributes load first so we can map skill.ability_id → identifier
        const attrs = await fetchCollection<any>("attributes");
        const uniqueAttrsMap = new Map();
        attrs.forEach((item: any) => {
          const key = (item.identifier || item.id).toUpperCase();
          if (!uniqueAttrsMap.has(key) || item.identifier) {
            uniqueAttrsMap.set(key, item);
          }
        });
        const uniqueAttrs = Array.from(uniqueAttrsMap.values());
        setAllAttributes(uniqueAttrs.sort((a: any, b: any) => {
          const orderA = typeof a.order === 'number' ? a.order : 999;
          const orderB = typeof b.order === 'number' ? b.order : 999;
          if (orderA !== orderB) return orderA - orderB;
          return (a.name || '').localeCompare(b.name || '');
        }));

        const abilityIdToIdentifier = new Map<string, string>();
        attrs.forEach((attr: any) => {
          if (attr.id && (attr.identifier || attr.id)) {
            abilityIdToIdentifier.set(attr.id, (attr.identifier || attr.id).toUpperCase());
          }
        });

        const skillsRaw = await fetchCollection<any>("skills");
        // Skills reference attributes via `ability_id`; downstream code reads
        // `skill.ability` as the identifier string ("STR"/"DEX"/...). Map once
        // on load so consumers don't need to know about the FK shape.
        const skills = skillsRaw.map((s: any) => ({
          ...s,
          ability: s.ability_id ? abilityIdToIdentifier.get(s.ability_id) : s.ability,
        }));
        setAllSkills(skills);

        const [
          armor,
          armorCategories,
          weapons,
          weaponCategories,
          tools,
          toolCategories,
          languages,
          languageCategories,
        ] = await Promise.all([
          fetchCollection<any>("armor"),
          fetchCollection<any>("armorCategories"),
          fetchCollection<any>("weapons"),
          fetchCollection<any>("weaponCategories"),
          fetchCollection<any>("tools"),
          fetchCollection<any>("toolCategories"),
          fetchCollection<any>("languages"),
          fetchCollection<any>("languageCategories"),
        ]);

        // Items in armor/weapons/tools/languages reference their category via
        // `category_id`; downstream lookup code reads `categoryId`. Remap once
        // here so consumers don't need to know about the snake_case columns.
        setProficiencyCatalogs({
          armor: buildNamedDocLookup(armor.map(denormCategoryId)),
          armorCategories: buildNamedDocLookup(armorCategories),
          weapons: buildNamedDocLookup(weapons.map(denormCategoryId)),
          weaponCategories: buildNamedDocLookup(weaponCategories),
          tools: buildNamedDocLookup(tools.map(denormCategoryId)),
          toolCategories: buildNamedDocLookup(toolCategories),
          languages: buildNamedDocLookup(languages.map(denormCategoryId)),
          languageCategories: buildNamedDocLookup(languageCategories),
        });

        const spellcastingTypesData = await fetchCollection<any>("spellcastingTypes");
        setSpellcastingTypes(spellcastingTypesData);

        const multiclassMasterDoc = await fetchDocument<any>(
          "standardMulticlassProgression",
          "master",
        );
        if (multiclassMasterDoc) {
          setMasterMulticlassChart(multiclassMasterDoc);
        }

      } catch (err) {
        reportClientError(err, OperationType.GET, "characters");
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [id, navigate, isStaff]);

  useEffect(() => {
    const progression = buildCurrentProgression(character);
    const progressionGroups = buildProgressionClassGroups(
      progression,
      classCache,
      subclassCache,
      character.subclassId,
    );
    const nextProgressionState = buildProgressionStateForCharacter(
      character,
      progressionGroups,
      selectedOptionsMap,
      subclassCache,
    );
    const nextSelectedOptions = buildSelectedOptionsMapFromClassPackages(
      nextProgressionState.classPackages,
    );

    const currentProgressionState = normalizeProgressionState(
      character.progressionState,
    );
    const currentSelectedOptions = buildNonLegacySelectedOptionsMap(
      character.selectedOptions || {},
    );

    if (
      JSON.stringify(currentProgressionState) ===
        JSON.stringify(nextProgressionState) &&
      JSON.stringify(currentSelectedOptions) ===
        JSON.stringify(nextSelectedOptions)
    ) {
      return;
    }

    setCharacter((prev: any) => ({
      ...prev,
      progressionState: nextProgressionState,
      selectedOptions: nextSelectedOptions,
    }));
  }, [
    character.progression,
    character.progressionState,
    character.selectedOptions,
    character.subclassId,
    classCache,
    selectedOptionsMap,
    subclassCache,
  ]);

  useEffect(() => {
    const progression = buildCurrentProgression(character);
    const progressionGroups = buildProgressionClassGroups(
      progression,
      classCache,
      subclassCache,
      character.subclassId,
    );

    const primaryGroup = progressionGroups[0];
    const nextClassId = primaryGroup?.classId || "";
    const nextSubclassId = primaryGroup?.subclassId || "";

    if (
      String(character.classId || "") === String(nextClassId || "") &&
      String(character.subclassId || "") === String(nextSubclassId || "")
    ) {
      return;
    }

    setCharacter((prev: any) => {
      if (
        String(prev.classId || "") === String(nextClassId || "") &&
        String(prev.subclassId || "") === String(nextSubclassId || "")
      ) {
        return prev;
      }

      return {
        ...prev,
        classId: nextClassId,
        subclassId: nextSubclassId,
      };
    });
  }, [character.progression, classCache, subclassCache, character.classId, character.subclassId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const isNew = !id || id === "new";
      const charId = isNew ? crypto.randomUUID() : id;
      
      const progression = buildCurrentProgression(character);
      const progressionGroups = buildProgressionClassGroups(
        progression,
        classCache,
        subclassCache,
        character.subclassId,
      );
      const primaryGroup = progressionGroups[0];
      const progressionState = buildProgressionStateForCharacter(
        character,
        progressionGroups,
        selectedOptionsMap,
        subclassCache,
      );

      const finalChar = {
        ...character,
        id: charId,
        userId: isNew ? userProfile.id : character.userId,
        progression,
        progressionState,
        classId: primaryGroup?.classId || "",
        subclassId: primaryGroup?.subclassId || "",
        updatedAt: new Date().toISOString(),
      };

      const { generateCharacterSaveQueries } = await import("../../lib/characterShared");
      const { batchQueryD1 } = await import("../../lib/d1");
      const queries = generateCharacterSaveQueries(charId, finalChar);
      await batchQueryD1(queries);

      if (isNew) {
        navigate(`/characters/builder/${charId}`);
      }
    } catch (err) {
      reportClientError(err, OperationType.WRITE, "characters");
    } finally {
      setSaving(false);
    }
  };

  useKeyboardSave(() => { handleSave(); });

  const handleInfoChange = (field: string, value: string) => {
    setCharacter((prev: any) => ({
      ...prev,
      info: {
        ...prev.info,
        [field]: value,
      },
    }));
  };

  const [showPointBuy, setShowPointBuy] = useState(false);

  const getSafeStat = (attr: string) => {
    return character.stats?.base?.[attr] ?? 10;
  };

  const handleStatChange = (attr: string, delta: number) => {
    setCharacter((prev: any) => ({
      ...prev,
      stats: {
        ...prev.stats,
        base: {
          ...prev.stats.base,
          [attr]: Math.max(
            1,
            Math.min(30, (prev.stats.base[attr] || 10) + delta),
          ),
        },
      },
    }));
  };

  const getSafeModifier = (attr: string) => {
    const score = getSafeStat(attr);
    const mod = Math.floor((score - 10) / 2);
    return mod >= 0 ? `+${mod}` : mod.toString();
  };

  const getSkillTotal = (skillId: string) => {
    const skill = allSkills.find((s) => s.id === skillId);
    if (!skill) return 0;

    // Check for overridden ability
    const ability =
      character.overriddenSkillAbilities?.[skillId] || skill.ability;

    const isProficient = character.proficientSkills?.includes(skill.id);
    const isExpert = character.expertiseSkills?.includes(skill.id);
    const isHalf = character.halfProficientSkills?.includes(skill.id);
    const mod = parseInt(getSafeModifier(ability));
    const bonus = character.proficiencyBonus || 2;

    let profBonus = 0;
    if (isExpert) profBonus = bonus * 2;
    else if (isProficient) profBonus = bonus;
    else if (isHalf) profBonus = Math.floor(bonus / 2);

    return mod + profBonus;
  };

  const getPassiveScore = (skillId: string) => {
    return 10 + getSkillTotal(skillId);
  };

  const selectedClassDocument =
    (character.classId && classCache[character.classId]) ||
    Object.values(classCache).find(
      (entry: any) =>
        entry?.id === character.classId || entry?.name === character.classId,
    ) ||
    null;

  const selectedSubclassDocument =
    (character.subclassId && subclassCache[character.subclassId]) || null;

  const currentProgression = buildCurrentProgression(character);
  const progressionClassGroups = buildProgressionClassGroups(
    currentProgression,
    classCache,
    subclassCache,
    character.subclassId,
  );
  const normalizedProgressionState = useMemo(
    () => normalizeProgressionState(character.progressionState),
    [character.progressionState],
  );
  const grantedItemLookups = buildGrantedItemLookups(featureCache, optionsCache);
  const skillLabelLookup = useMemo(
    () =>
      Object.fromEntries(
        allSkills.flatMap((skill: any) => {
          const label = String(skill?.name || skill?.id || "").trim();
          return [
            [String(skill?.id || ""), label],
            [String(skill?.id || "").toLowerCase(), label],
          ];
        }),
      ),
    [allSkills],
  );
  const attributeLabelLookup = useMemo(
    () =>
      Object.fromEntries(
        allAttributes.flatMap((attribute: any) => {
          const label = String(attribute?.name || attribute?.identifier || attribute?.id || "").trim();
          return [
            [String(attribute?.id || ""), label],
            [String(attribute?.identifier || ""), label],
            [String(attribute?.id || "").toLowerCase(), label],
            [String(attribute?.identifier || "").toLowerCase(), label],
            [String(attribute?.id || "").toUpperCase(), label],
            [String(attribute?.identifier || "").toUpperCase(), label],
          ];
        }),
      ),
    [allAttributes],
  );

  const resolveTraitDisplayLabel = (
    traitType: string,
    value: any,
  ) => {
    const raw = String(value ?? "").trim();
    if (!raw) return "";

    if (traitType === "skills") {
      return skillLabelLookup[raw] || skillLabelLookup[raw.toLowerCase()] || raw;
    }

    if (traitType === "saves") {
      return (
        attributeLabelLookup[raw] ||
        attributeLabelLookup[raw.toUpperCase()] ||
        attributeLabelLookup[raw.toLowerCase()] ||
        raw
      );
    }

    if (traitType === "armor") {
      return (
        proficiencyCatalogs.armor[raw] ||
        proficiencyCatalogs.armorCategories[raw] ||
        proficiencyCatalogs.armor[raw.toLowerCase()] ||
        proficiencyCatalogs.armorCategories[raw.toLowerCase()] ||
        raw
      );
    }

    if (traitType === "weapons") {
      return (
        proficiencyCatalogs.weapons[raw] ||
        proficiencyCatalogs.weaponCategories[raw] ||
        proficiencyCatalogs.weapons[raw.toLowerCase()] ||
        proficiencyCatalogs.weaponCategories[raw.toLowerCase()] ||
        raw
      );
    }

    if (traitType === "tools") {
      return (
        proficiencyCatalogs.tools[raw] ||
        proficiencyCatalogs.toolCategories[raw] ||
        proficiencyCatalogs.tools[raw.toLowerCase()] ||
        proficiencyCatalogs.toolCategories[raw.toLowerCase()] ||
        raw
      );
    }

    if (traitType === "languages") {
      return (
        proficiencyCatalogs.languages[raw] ||
        proficiencyCatalogs.languageCategories[raw] ||
        proficiencyCatalogs.languages[raw.toLowerCase()] ||
        proficiencyCatalogs.languageCategories[raw.toLowerCase()] ||
        raw
      );
    }

    return raw;
  };

  const formatTraitValues = (traitType: string, values: any[] = []) =>
    uniqueStringList(values.map((value) => resolveTraitDisplayLabel(traitType, value)));

  const classProgressionSummaries = progressionClassGroups
    .map((entry: any) => {
      const classDocument =
        entry.classDocument ||
        classCache[entry?.classId || ""] ||
        Object.values(classCache).find(
          (candidate: any) =>
            candidate?.id === entry?.classId || candidate?.name === entry?.className,
        );
      if (!classDocument) return null;

      const classKey = entry.classKey || classDocument.id;
      const classLevel = Number(entry.classLevel || 0) || 0;

      const subclassDocument =
        entry.subclassId &&
        subclassCache[entry.subclassId]?.classId === classDocument.id
          ? subclassCache[entry.subclassId]
          : null;

      const introductionMode = getClassIntroductionMode(
        currentProgression,
        classKey,
      );

      const allAccessibleClassFeatures = (featureCache[classDocument.id] || []).filter(
        (feature: any) => (Number(feature.level || 1) || 1) <= classLevel,
      );
      const allAccessibleSubclassFeatures = subclassDocument
        ? (featureCache[subclassDocument.id] || []).filter(
            (feature: any) => (Number(feature.level || 1) || 1) <= classLevel,
          )
        : [];

      const grantedClassEntries = collectGrantedItemsFromAdvancementList(
        classDocument.advancements || [],
        {
          maxLevel: classLevel,
          defaultLevel: 1,
          parentType: "class",
          lookups: grantedItemLookups,
          classDocument,
          introductionMode,
          applyClassMode: true,
        },
      );

      const grantedSubclassEntries = subclassDocument
        ? collectGrantedItemsFromAdvancementList(
            subclassDocument.advancements || [],
            {
              maxLevel: classLevel,
              defaultLevel: 1,
              parentType: "subclass",
              lookups: grantedItemLookups,
              classDocument: subclassDocument,
              introductionMode: "primary",
              applyClassMode: false,
            },
          )
        : [];

      const grantedFeatureEntries = allAccessibleClassFeatures.flatMap(
        (feature: any) =>
          collectGrantedItemsFromAdvancementList(feature.advancements || [], {
            maxLevel: classLevel,
            defaultLevel: Number(feature.level || 1) || 1,
            parentType: "feature",
            lookups: grantedItemLookups,
            classDocument,
            introductionMode: "primary",
            applyClassMode: false,
          }).map((granted: any) => ({
            ...granted,
            sourceFeatureId: feature.id,
            sourceFeatureName: feature.name,
          })),
      );

      const grantedSubclassFeatureEntries = allAccessibleSubclassFeatures.flatMap(
        (feature: any) =>
          collectGrantedItemsFromAdvancementList(feature.advancements || [], {
            maxLevel: classLevel,
            defaultLevel: Number(feature.level || 1) || 1,
            parentType: "subclass-feature",
            lookups: grantedItemLookups,
            classDocument,
            introductionMode: "primary",
            applyClassMode: false,
          }).map((granted: any) => ({
            ...granted,
            sourceFeatureId: feature.id,
            sourceFeatureName: feature.name,
          })),
      );

      const grantedFeatures = [
        ...grantedClassEntries,
        ...grantedSubclassEntries,
        ...grantedFeatureEntries,
        ...grantedSubclassFeatureEntries,
      ].filter((granted: any) => granted.kind === "feature");

      const hasGrantedClassFeatures = grantedFeatures.some(
        (feature: any) => feature.parentType === "class" || feature.parentType === "feature",
      );
      const hasGrantedSubclassFeatures = grantedFeatures.some(
        (feature: any) =>
          feature.parentType === "subclass" || feature.parentType === "subclass-feature",
      );

      const fallbackFeatures = [
        ...(hasGrantedClassFeatures
          ? []
          : allAccessibleClassFeatures.map((feature: any) => ({
              id: feature.id,
              name: feature.name,
              description: feature.description || "",
              level: Number(feature.level || 1) || 1,
              parentType: "class",
              parentId: classDocument.id,
              kind: "feature",
            }))),
        ...(hasGrantedSubclassFeatures
          ? []
          : allAccessibleSubclassFeatures.map((feature: any) => ({
              id: feature.id,
              name: feature.name,
              description: feature.description || "",
              level: Number(feature.level || 1) || 1,
              parentType: "subclass",
              parentId: subclassDocument?.id || "",
              kind: "feature",
            }))),
      ];

      const features = dedupeProgressionEntries([
        ...grantedFeatures.map((feature: any) =>
          normalizeProgressionEntryDisplay(
            {
              ...feature,
              description: feature.description || "",
              parentId:
                feature.parentType === "subclass" || feature.parentType === "subclass-feature"
                  ? subclassDocument?.id || ""
                  : classDocument.id,
            },
            grantedItemLookups,
          ),
        ),
        ...fallbackFeatures.map((feature: any) =>
          normalizeProgressionEntryDisplay(feature, grantedItemLookups),
        ),
      ]).sort((left: any, right: any) => {
        if (left.level !== right.level) return left.level - right.level;
        return String(left.name || "").localeCompare(String(right.name || ""));
      });

      const grantedItems = dedupeProgressionEntries(
        [
          ...grantedClassEntries,
          ...grantedSubclassEntries,
          ...grantedFeatureEntries,
          ...grantedSubclassFeatureEntries,
        ].filter((granted: any) => granted.kind !== "feature"),
      )
        .map((entry: any) =>
          normalizeProgressionEntryDisplay(entry, grantedItemLookups),
        )
        .sort((left: any, right: any) => {
        if (left.level !== right.level) return left.level - right.level;
        return String(left.name || "").localeCompare(String(right.name || ""));
      });

      const scales = Object.values(scalingCache)
        .filter((column: any) => {
          if (!column) return false;
          return (
            column.parentId === classDocument.id ||
            (subclassDocument && column.parentId === subclassDocument.id)
          );
        })
        .map((column: any) => ({
          id: column.id,
          name: column.name,
          value: resolveScaleValueAtLevel(column, classLevel),
          parentType:
            subclassDocument && column.parentId === subclassDocument.id
              ? "subclass"
              : "class",
        }))
        .filter((column: any) => column.value !== null && column.value !== undefined);

      return {
        classId: classDocument.id,
        classKey,
        className: classDocument.name,
        classLevel,
        subclassDocument,
        subclassName: subclassDocument?.name || "",
        features,
        featuresByLevel: groupProgressionEntriesByLevel(features),
        grantedItems,
        grantedItemsByLevel: groupProgressionEntriesByLevel(grantedItems),
        scales,
        accessibleClassFeatures: allAccessibleClassFeatures,
        accessibleSubclassFeatures: allAccessibleSubclassFeatures,
      };
    })
    .filter(Boolean) as any[];

  const persistedOwnedFeatures = normalizedProgressionState.ownedFeatures || [];
  const persistedOwnedItems = normalizedProgressionState.ownedItems || [];
  const ownedFeaturesByClass = new Map<string, any[]>();
  const ownedItemsByClass = new Map<string, any[]>();

  persistedOwnedFeatures.forEach((entry: any) => {
    const key = String(entry?.ownerClassId || "").trim();
    if (!key) return;
    if (!ownedFeaturesByClass.has(key)) ownedFeaturesByClass.set(key, []);
    ownedFeaturesByClass.get(key)?.push(entry);
  });

  persistedOwnedItems.forEach((entry: any) => {
    const key = String(entry?.ownerClassId || "").trim();
    if (!key) return;
    if (!ownedItemsByClass.has(key)) ownedItemsByClass.set(key, []);
    ownedItemsByClass.get(key)?.push(entry);
  });

  const canonicalOwnedFeatures = buildOwnedFeaturesFromSummaries(
    classProgressionSummaries,
  );
  const canonicalOwnedItems = buildOwnedItemsFromState(
    classProgressionSummaries,
    normalizedProgressionState.classPackages,
    optionsCache,
  );
  const resolvedClassProgressionSummaries = classProgressionSummaries.map(
    (summary: any) => {
      const persistedFeatures = (
        ownedFeaturesByClass.get(summary.classId) || []
      )
        .filter(
          (entry: any) =>
            String(entry?.ownerSubclassId || "").trim() ===
              String(summary.subclassDocument?.id || "").trim() ||
            !String(entry?.ownerSubclassId || "").trim(),
        )
        .map((entry: any) => ({
          id: entry.entityId,
          sourceId: entry.sourceId,
          name: resolveProgressionEntryName(entry, grantedItemLookups),
          description: entry.description || "",
          level: Number(entry.level || 1) || 1,
          parentType: entry.parentType,
          parentId: entry.parentId,
          kind: "feature",
          imageUrl: entry.imageUrl || "",
          featureTypeSubtype: entry.featureTypeSubtype || "",
        }))
        .sort((left: any, right: any) => {
          if (left.level !== right.level) return left.level - right.level;
          return String(left.name || "").localeCompare(String(right.name || ""));
        });

      const persistedItems = (
        ownedItemsByClass.get(summary.classId) || []
      )
        .filter(
          (entry: any) =>
            String(entry?.ownerSubclassId || "").trim() ===
              String(summary.subclassDocument?.id || "").trim() ||
            !String(entry?.ownerSubclassId || "").trim(),
        )
        .map((entry: any) =>
          normalizeProgressionEntryDisplay(
            {
              id: entry.entityId,
              sourceId: entry.sourceId,
              name: entry.name,
              description: entry.description || "",
              level: Number(entry.level || 1) || 1,
              parentType: entry.parentType,
              parentId: entry.parentId,
              kind: entry.itemKind || entry.sourceType || "item",
              imageUrl: entry.imageUrl || "",
              featureTypeValue: entry.featureTypeValue || "",
              featureTypeSubtype: entry.featureTypeSubtype || "",
              groupSourceId: entry.groupSourceId || "",
              featureSourceId: entry.featureSourceId || "",
              scalingSourceId: entry.scalingSourceId || "",
            },
            grantedItemLookups,
          ),
        )
        .sort((left: any, right: any) => {
          if (left.level !== right.level) return left.level - right.level;
          return String(left.name || "").localeCompare(String(right.name || ""));
        });

      const features =
        persistedFeatures.length > 0 ? persistedFeatures : summary.features;
      const grantedItems =
        persistedItems.length > 0 ? persistedItems : summary.grantedItems;

      return {
        ...summary,
        features,
        featuresByLevel: groupProgressionEntriesByLevel(features),
        grantedItems,
        grantedItemsByLevel: groupProgressionEntriesByLevel(grantedItems),
      };
    },
  );

  useEffect(() => {
    const loadGrantedItemLabels = async () => {
      const referencedIds = uniqueStringList(
        resolvedClassProgressionSummaries.flatMap((summary: any) =>
          (Array.isArray(summary?.grantedItems) ? summary.grantedItems : []).map(
            (item: any) => String(item?.id || item?.sourceId || "").trim(),
          ),
        ),
      ).filter(
        (id) => id && !grantedItemLookups.byId?.[id] && !optionsCache[id],
      );

      if (referencedIds.length === 0) return;

      try {
        const rows = await Promise.all(
          referencedIds.map((entryId) => fetchDocument<any>("uniqueOptionItems", entryId)),
        );

        setOptionsCache((prev) => {
          const next = { ...prev };
          rows.forEach((row: any) => {
            if (row && row.id) next[row.id] = row;
          });
          return next;
        });
      } catch (err) {
        console.error("Failed to load granted item labels", err);
      }
    };

    loadGrantedItemLabels();
  }, [resolvedClassProgressionSummaries, grantedItemLookups.byId, optionsCache]);

  useEffect(() => {
    const nextClassPackages = normalizedProgressionState.classPackages.map((pkg: any) => {
      const grantedFeatureRefs = canonicalOwnedFeatures
        .filter(
          (entry: any) =>
            String(entry?.ownerClassId || "").trim() ===
              String(pkg?.classId || "").trim() &&
            String(entry?.ownerSubclassId || "").trim() ===
              String(pkg?.subclassId || "").trim(),
        )
        .map((entry: any) => ({
          sourceId: entry.sourceId,
          entityId: entry.entityId,
          level: entry.level,
          sourceType: entry.sourceType,
          parentType: entry.parentType,
          parentId: entry.parentId,
        }));

      const grantedItemRefs = canonicalOwnedItems
        .filter(
          (entry: any) =>
            String(entry?.ownerClassId || "").trim() ===
              String(pkg?.classId || "").trim() &&
            String(entry?.ownerSubclassId || "").trim() ===
              String(pkg?.subclassId || "").trim(),
        )
        .map((entry: any) => ({
          sourceId: entry.sourceId,
          entityId: entry.entityId,
          level: entry.level,
          sourceType: entry.sourceType,
          itemKind: entry.itemKind,
          parentType: entry.parentType,
          parentId: entry.parentId,
          featureSourceId: entry.featureSourceId || "",
          groupSourceId: entry.groupSourceId || "",
        }));

      return {
        ...pkg,
        grantedFeatureRefs,
        grantedItemRefs,
      };
    });

    const nextProgressionState = {
      ...normalizedProgressionState,
      classPackages: nextClassPackages,
      ownedFeatures: canonicalOwnedFeatures,
      ownedItems: canonicalOwnedItems,
    };

    if (
      JSON.stringify(normalizedProgressionState.classPackages) ===
        JSON.stringify(nextClassPackages) &&
      JSON.stringify(normalizedProgressionState.ownedFeatures || []) ===
        JSON.stringify(canonicalOwnedFeatures) &&
      JSON.stringify(normalizedProgressionState.ownedItems || []) ===
        JSON.stringify(canonicalOwnedItems)
    ) {
      return;
    }

    setCharacter((prev: any) => ({
      ...prev,
      progressionState: nextProgressionState,
    }));
  }, [
    canonicalOwnedFeatures,
    canonicalOwnedItems,
    normalizedProgressionState,
  ]);

  const classProgressionSummaryByKey = new Map(
    resolvedClassProgressionSummaries.map((summary: any) => [summary.classKey, summary]),
  );

  const sheetClassSummaries = resolvedClassProgressionSummaries;

  const selectedAdvancementOptionItems = uniqueStringList(
    Object.values(selectedOptionsMap || {}).flat() as string[],
  ).map((optionId) => ({
    id: optionId,
    name: optionsCache[optionId]?.name || optionId,
    featureType: optionsCache[optionId]?.featureType || "",
  }));

  const spellcastingContributors = resolvedClassProgressionSummaries
    .flatMap((summary: any) => {
      const contributors: any[] = [];
      const classSpellcasting = summary.classDocument?.spellcasting;
      const subclassSpellcasting = summary.subclassDocument?.spellcasting;
      const classLevel = Number(summary.classLevel || 0) || 0;

      const addContributor = (spellcasting: any, sourceType: "class" | "subclass", label: string) => {
        if (!spellcasting?.hasSpellcasting) return;

        const unlockLevel = Number(spellcasting.level || 1) || 1;
        if (classLevel < unlockLevel) return;

        const typeRecord = resolveSpellcastingTypeRecord(spellcasting, spellcastingTypes);
        if (!typeRecord?.formula) return;

        const contribution = calculateEffectiveCastingLevel(classLevel, String(typeRecord.formula || ""));
        if (contribution <= 0) return;

        contributors.push({
          sourceType,
          label,
          className: summary.className,
          subclassName: summary.subclassName || "",
          classLevel,
          unlockLevel,
          progressionTypeName: typeRecord.name || typeRecord.identifier || typeRecord.foundryName || "Custom",
          progressionFormula: typeRecord.formula,
          effectiveLevel: contribution,
          ability: String(spellcasting.ability || "").toUpperCase(),
          preparationType: spellcasting.type || "prepared",
        });
      };

      addContributor(classSpellcasting, "class", summary.className);
      if (summary.subclassDocument) {
        addContributor(
          subclassSpellcasting,
          "subclass",
          summary.subclassName ? `${summary.className} • ${summary.subclassName}` : summary.className,
        );
      }

      return contributors;
    })
    .sort((left: any, right: any) => left.label.localeCompare(right.label));

  const totalSpellcastingLevel = spellcastingContributors.reduce(
    (sum: number, contributor: any) => sum + (Number(contributor.effectiveLevel || 0) || 0),
    0,
  );
  const spellSlotLevels = masterMulticlassChart?.levels || [];
  const multiclassSpellSlots =
    totalSpellcastingLevel > 0 && Array.isArray(spellSlotLevels)
      ? getSpellSlotsForLevel(totalSpellcastingLevel, spellSlotLevels)
      : Array(9).fill(0);

  const legacyAdvancementSelectionKeys = Object.keys(
    character.selectedOptions || {},
  ).filter(isLegacyAdvancementSelectionKey);
  const hasLegacyAdvancementSelections =
    legacyAdvancementSelectionKeys.length > 0;

  if (loading) return null;

  return (
    <div className="max-w-7xl mx-auto pb-24 pt-4 px-2 sm:px-4 lg:px-6">
      {/* Top Header & Save */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-gold/20 pb-4 mb-6">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/characters")}
            className="text-gold gap-2 hover:bg-gold/5 uppercase tracking-widest text-[10px] font-black h-8"
          >
            <ChevronLeft className="w-4 h-4" />{" "}
            <span className="hidden xs:inline">Characters</span>
          </Button>
          <div className="h-4 w-px bg-gold/20" />
          <p className="label-text opacity-40 whitespace-nowrap">Workroom</p>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto sm:overflow-visible pb-1 sm:pb-0">
          {isAdmin && (
            <Dialog>
              <DialogTrigger
                render={
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={hasLegacyAdvancementSelections}
                    title={
                      hasLegacyAdvancementSelections
                        ? "Reselect legacy class or subclass advancement choices before viewing export JSON."
                        : "View current Foundry pairing output."
                    }
                    className="border-gold/30 text-gold hover:bg-gold/5 gap-2 uppercase tracking-widest text-[10px] font-black h-8"
                  >
                    <Eye className="w-3.5 h-3.5" /> View JSON
                  </Button>
                }
              />
              <DialogContent className="sm:max-w-2xl bg-parchment border-gold/30 p-0 overflow-hidden">
                <DialogHeader className="p-6 bg-ink text-gold border-b border-gold/20">
                  <DialogTitle className="text-xl font-serif font-black uppercase tracking-tight">
                    Foundry Pairing Output
                  </DialogTitle>
                  <DialogDescription className="text-gold/60 font-serif italic">
                    Formatted for the dauligor-pairing module bridge
                  </DialogDescription>
                </DialogHeader>
                <div className="p-6 bg-card/40">
                  {hasLegacyAdvancementSelections ? (
                    <div className="bg-blood/10 border border-blood/20 rounded-lg p-4 text-sm font-serif text-blood">
                      Export preview is blocked until the legacy advancement
                      selections listed above are reselected from the class
                      progression step.
                    </div>
                  ) : (
                    <pre className="bg-ink p-4 rounded-lg overflow-auto max-h-[400px] text-xs font-mono text-gold/80 border border-gold/10 custom-scrollbar">
                      {JSON.stringify(generatePairingJson(), null, 2)}
                    </pre>
                  )}
                </div>
                <DialogFooter className="p-4 bg-ink/5 border-t border-gold/10">
                  <Button
                    disabled={hasLegacyAdvancementSelections}
                    className="bg-gold text-white hover:bg-gold/80 gap-2 uppercase tracking-widest text-[10px] font-black"
                    onClick={() => {
                      navigator.clipboard.writeText(
                        JSON.stringify(generatePairingJson(), null, 2),
                      );
                    }}
                  >
                    <Copy className="w-3 h-3" /> Copy to Clipboard
                  </Button>
                  <DialogClose
                    render={
                      <Button
                        variant="ghost"
                        className="text-ink/40 hover:text-ink/60 uppercase tracking-widest text-[10px] font-black"
                      >
                        Close
                      </Button>
                    }
                  />
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}

          {id && id !== "new" && (
            <Button
              variant="outline"
              size="sm"
              disabled={hasLegacyAdvancementSelections}
              title={
                hasLegacyAdvancementSelections
                  ? "Reselect legacy class or subclass advancement choices before exporting."
                  : "Export Full Semantic Character Payload"
              }
              onClick={async () => {
                try {
                  await exportCharacterJSON(id as string);
                } catch (error) {
                  console.error(error);
                }
              }}
              className="border-gold/20 text-gold hover:bg-gold/10 gap-2 uppercase tracking-widest text-[10px] font-black h-8 px-3"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Export</span>
            </Button>
          )}

          <Button
            onClick={handleSave}
            disabled={saving}
            size="sm"
            className="bg-gold hover:bg-gold/80 text-white gap-2 uppercase tracking-widest text-[10px] font-black px-4 h-8 transition-all shadow-md active:scale-95"
          >
            <Save className="w-3.5 h-3.5" />{" "}
            {saving ? "Writing..." : "Commit Changes"}
          </Button>
        </div>
      </div>

      {hasLegacyAdvancementSelections && (
        <div className="mb-6 border border-blood/30 bg-blood/5 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 w-2 h-2 rounded-full bg-blood shrink-0" />
            <div className="space-y-2">
              <p className="text-sm font-black uppercase tracking-widest text-blood">
                Legacy Advancement Selections Found
              </p>
              <p className="text-sm font-serif text-ink/80">
                This character still has older advancement-choice keys that the
                current builder no longer reads. Go back to the class
                progression step and reselect the affected class or subclass
                choices before exporting or trusting the current progression
                view.
              </p>
              <p className="text-xs font-mono text-ink/60 break-all">
                {legacyAdvancementSelectionKeys.join(", ")}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-6">
        {/* MAIN AREA */}
        <div className="flex-1 min-h-[500px] lg:min-h-[800px]">
          {activeStep === "sheet" ? (
            <div className="space-y-6 bg-card/10 p-4 sm:p-6 md:p-8 rounded-xl border border-gold/10 relative shadow-inner h-full min-h-[500px]">
              {/* COMPACT CHARACTER HEADER */}
              <div className="flex flex-col md:flex-row items-center gap-4 md:gap-6 border-b-2 border-gold/10 pb-6 md:pb-8 mb-6 md:mb-8">
                <div className="flex-1 w-full text-center md:text-left space-y-1">
                  <Input
                    value={character.name}
                    onChange={(e) =>
                      setCharacter({ ...character, name: e.target.value })
                    }
                    placeholder="UNNAMED ADVENTURER"
                    className="text-3xl sm:text-4xl md:text-5xl font-serif font-black text-ink bg-transparent border-none p-0 focus-visible:ring-0 placeholder:text-ink/10 h-auto tracking-tighter uppercase text-center md:text-left"
                  />
                  <div className="label-text flex flex-wrap items-center justify-center md:justify-start gap-2 sm:gap-3">
                    <span className="bg-gold text-white px-1.5 py-0.5 rounded-sm text-[9px] sm:text-[10px]">
                      LVL {character.level}
                    </span>
                    <span className="text-ink/60 truncate max-w-[120px]">
                      {selectedClassDocument?.name || "No Class"}
                    </span>
                    <span className="w-1 h-1 sm:w-1.5 sm:h-1.5 bg-gold/20 rounded-full" />
                    <span className="text-ink/60 truncate max-w-[120px]">
                      {character.raceId || "No Race"}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-3 sm:gap-4 md:gap-6 flex-wrap justify-center border-t border-gold/5 pt-4 md:pt-0 md:border-none">
                  {/* HEROIC INSPIRATION */}
                  <div
                    className="flex flex-col items-center cursor-pointer group"
                    onClick={() =>
                      setCharacter({
                        ...character,
                        hasInspiration: !character.hasInspiration,
                      })
                    }
                  >
                    <div
                      className={`w-12 h-12 border-2 flex items-center justify-center rounded-lg transition-all duration-300 ${character.hasInspiration ? "bg-gold border-gold text-ink shadow-[0_0_15px_rgba(197,160,89,0.5)]" : "bg-transparent border-gold/20 text-gold/20 group-hover:border-gold/50"}`}
                    >
                      <Star
                        className={`w-7 h-7 transition-all duration-500 ${character.hasInspiration ? "scale-110 rotate-[72deg]" : ""}`}
                        fill={
                          character.hasInspiration ? "currentColor" : "none"
                        }
                      />
                    </div>
                    <span className="text-[8px] uppercase font-black text-ink/40 mt-1.5 tracking-[0.1em]">
                      Inspiration
                    </span>
                  </div>

                  {/* EXHAUSTION */}
                  <div className="flex flex-col items-center">
                    <div className="w-24 h-12 border-2 border-gold/20 flex items-center justify-between px-2 bg-muted rounded-lg group hover:border-gold/30 transition-colors shadow-sm">
                      <button
                        onClick={() =>
                          setCharacter({
                            ...character,
                            exhaustion: Math.max(0, character.exhaustion - 1),
                          })
                        }
                        className="text-ink/40 hover:text-rose-700 transition-colors"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <div className="flex flex-col items-center -space-y-1">
                        <span
                          className={`${character.exhaustion > 0 ? "text-rose-700" : "text-ink/20"} text-base font-black`}
                        >
                          {character.exhaustion}
                        </span>
                      </div>
                      <button
                        onClick={() =>
                          setCharacter({
                            ...character,
                            exhaustion: Math.min(6, character.exhaustion + 1),
                          })
                        }
                        className="text-ink/40 hover:text-rose-700 transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <span className="text-[7px] uppercase font-black text-ink/30 mt-1 tracking-widest">
                      Exhaustion
                    </span>
                  </div>
                </div>
              </div>

              {/* ABILITY SCORES - TIGHTER GRID */}
              <div className="grid grid-cols-3 md:grid-cols-6 gap-3 md:gap-4 mb-10">
                {allAttributes.map((attr) => {
                  const iden = attr.identifier || attr.id;
                  return (
                    <StatBlock
                      key={attr.id}
                      label={attr.name}
                      value={getSafeModifier(iden)}
                      score={getSafeStat(iden)}
                      onPlus={() => handleStatChange(iden, 1)}
                      onMinus={() => handleStatChange(iden, -1)}
                    />
                  );
                })}
                {allAttributes.length === 0 && ["STR", "DEX", "CON", "INT", "WIS", "CHA"].map((attr) => (
                  <StatBlock
                    key={attr}
                    label={attr}
                    value={getSafeModifier(attr)}
                    score={getSafeStat(attr)}
                    onPlus={() => handleStatChange(attr, 1)}
                    onMinus={() => handleStatChange(attr, -1)}
                  />
                ))}
              </div>

              {false && (
              <div className="border border-gold/20 bg-card/40 rounded-xl p-4 sm:p-6 shadow-sm space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div>
                    <h3 className="text-base sm:text-lg font-serif font-black uppercase text-ink/80 tracking-tight flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 sm:w-5 sm:h-5 text-gold" />
                      Class Progression
                    </h3>
                    <p className="text-xs text-ink/50 font-serif italic mt-1">
                      Features, scale tracks, and advancement selections currently active on this character.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setActiveStep("class")}
                    className="border-gold/30 text-gold hover:bg-gold/5 uppercase tracking-widest text-[10px] font-black"
                  >
                    Open Class Step
                  </Button>
                </div>

                {sheetClassSummaries.length > 0 ? (
                  <div className="grid gap-4 xl:grid-cols-2">
                    {sheetClassSummaries.map((summary: any) => (
                      <div
                        key={summary.classId}
                        className="border border-gold/15 bg-background/40 rounded-lg p-4 space-y-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-lg font-serif font-black text-ink leading-none">
                              {summary.className}
                            </div>
                            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-gold/70 mt-1">
                              Level {summary.classLevel}
                              {summary.subclassName ? ` • ${summary.subclassName}` : ""}
                            </div>
                          </div>
                          <div className="px-2 py-1 border border-gold/20 bg-gold/5 rounded text-[10px] font-black uppercase tracking-widest text-ink/50">
                            {summary.features.length} Features
                          </div>
                        </div>

                        <div className="space-y-2">
                          <div className="text-[10px] font-black uppercase tracking-[0.2em] text-ink/40">
                            Scale Values
                          </div>
                          {summary.scales.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              {summary.scales.map((scale: any) => (
                                <div
                                  key={scale.id}
                                  className="px-2 py-1 border border-gold/20 bg-gold/5 rounded-sm"
                                >
                                  <span className="text-[9px] font-black uppercase tracking-widest text-gold/70">
                                    {scale.name}
                                  </span>
                                  <span className="ml-2 text-sm font-black text-ink">
                                    {String(scale.value)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="text-xs font-serif italic text-ink/35">
                              No tracked scale values yet.
                            </div>
                          )}
                        </div>

                        <div className="space-y-2">
                          <div className="text-[10px] font-black uppercase tracking-[0.2em] text-ink/40">
                            Granted Features
                          </div>
                          {summary.features.length > 0 ? (
                            <div className="space-y-1.5">
                              {summary.features.map((feature: any) => (
                                <div
                                  key={`${summary.classId}-${feature.id}`}
                                  className="flex items-center justify-between gap-3 border-b border-gold/10 pb-1 last:border-b-0 last:pb-0"
                                >
                                  <span className="text-sm font-serif text-ink">
                                    {feature.name}
                                  </span>
                                  <span className="text-[9px] font-black uppercase tracking-widest text-ink/35">
                                    L{feature.level}
                                    {feature.parentType === "subclass" ? " • Subclass" : ""}
                                  </span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="text-xs font-serif italic text-ink/35">
                              No granted features yet.
                            </div>
                          )}
                        </div>

                        <div className="space-y-2">
                          <div className="text-[10px] font-black uppercase tracking-[0.2em] text-ink/40">
                            Granted Items
                          </div>
                          {summary.grantedItems.length > 0 ? (
                            <div className="space-y-1.5">
                              {summary.grantedItems.map((item: any) => (
                                <div
                                  key={`${summary.classId}-item-${item.id}-${item.level}`}
                                  className="flex items-center justify-between gap-3 border-b border-gold/10 pb-1 last:border-b-0 last:pb-0"
                                >
                                  <span className="text-sm font-serif text-ink">
                                    {item.name}
                                  </span>
                                  <span className="text-[9px] font-black uppercase tracking-widest text-ink/35">
                                    L{item.level}
                                  </span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="text-xs font-serif italic text-ink/35">
                              No granted items yet.
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm font-serif italic text-ink/35">
                    No class progression is active yet.
                  </div>
                )}

                <div className="space-y-2 pt-2 border-t border-gold/10">
                  <div className="text-[10px] font-black uppercase tracking-[0.2em] text-ink/40">
                    Selected Advancement Options
                  </div>
                  {selectedAdvancementOptionItems.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {selectedAdvancementOptionItems.map((option: any) => (
                        <span
                          key={option.id}
                          className="px-2 py-1 bg-card border border-gold/20 rounded-sm text-[10px] font-bold text-ink/70 uppercase"
                        >
                          {option.name}
                          {option.featureType ? ` • ${option.featureType}` : ""}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs font-serif italic text-ink/35">
                      No advancement options selected yet.
                    </div>
                  )}
                </div>
              </div>
              )}

              {true && (
              <>
              <div className="grid xl:grid-cols-2 gap-8">
                {/* PORTRAIT & CORE STATUS */}
                <div className="border border-gold/20 p-5 flex flex-col xl:flex-row gap-6 rounded-lg bg-card/50 shadow-sm relative group transition-all hover:bg-card/80 hover:shadow-md">
                  <div className="w-full sm:w-48 xl:w-36 aspect-[3/4] border-2 border-gold/10 bg-card relative rounded-md overflow-hidden flex-shrink-0 shadow-inner group/portrait mx-auto xl:mx-0 self-center xl:self-start">
                    {character.imageUrl ? (
                      <img
                        src={character.imageUrl}
                        alt="Portrait"
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center text-ink/40 font-serif italic text-base p-4 text-center bg-muted/20">
                        <User className="w-12 h-12 mb-3 opacity-20" />
                        No Portrait
                      </div>
                    )}
                    <div className="absolute inset-0 bg-ink/60 opacity-0 group-hover/portrait:opacity-100 transition-all flex flex-col items-center justify-center p-2 text-center">
                      <ImageUpload
                        currentImageUrl={character.imageUrl}
                        storagePath={`images/characters/${id || "new"}/`}
                        onUpload={(url) =>
                          setCharacter({ ...character, imageUrl: url })
                        }
                        className="scale-75"
                      />
                    </div>
                    {/* AC SHIELD */}
                    <div
                      className="absolute top-1 left-1 w-11 h-13 bg-gold text-white border border-white/20 flex flex-col items-center justify-center shadow-lg pt-0.5"
                      style={{
                        clipPath:
                          "polygon(0% 0%, 100% 0%, 100% 80%, 50% 100%, 0% 80%)",
                      }}
                    >
                      <span className="text-lg font-black leading-none">
                        {character.ac}
                      </span>
                      <span className="text-[7px] uppercase font-black text-white/80 tracking-tighter">
                        AC
                      </span>
                    </div>
                  </div>

                  <div className="flex-1 space-y-4 py-1">
                    {/* HIT POINTS */}
                    <div className="space-y-1.5">
                      <div className="flex justify-between items-baseline px-0.5">
                        <h4 className="label-text text-ink/40">Hit Points</h4>
                        <div className="flex items-baseline gap-1 text-ink font-black leading-none">
                          <span className="text-xl">
                            {character.hp.current}
                          </span>
                          <span className="text-xs text-ink/20">/</span>
                          <span className="text-xs text-ink/60">
                            {getEffectiveHpMax(character)}
                          </span>
                        </div>
                      </div>

                      <div className="h-4 bg-muted/50 border border-gold/10 rounded-full group relative overflow-hidden p-[1px]">
                        <div
                          className="h-full bg-emerald-600 rounded-full transition-all duration-700 shadow-[inset_0_1px_2px_rgba(255,255,255,0.3)]"
                          style={{
                            width: `${Math.min(100, (character.hp.current / Math.max(1, getEffectiveHpMax(character))) * 100)}%`,
                          }}
                        />
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-card/10 backdrop-blur-[1px]">
                          <div className="flex gap-2">
                            <button
                              onClick={() =>
                                setCharacter({
                                  ...character,
                                  hp: {
                                    ...character.hp,
                                    current: Math.min(
                                      getEffectiveHpMax(character),
                                      character.hp.current + 1,
                                    ),
                                  },
                                })
                              }
                              className="w-5 h-5 bg-card text-ink border border-gold/20 hover:bg-emerald-500 hover:text-white rounded-full flex items-center justify-center shadow-sm"
                            >
                              <Plus className="w-2.5 h-2.5" />
                            </button>
                            <button
                              onClick={() =>
                                setCharacter({
                                  ...character,
                                  hp: {
                                    ...character.hp,
                                    current: Math.max(
                                      0,
                                      character.hp.current - 1,
                                    ),
                                  },
                                })
                              }
                              className="w-5 h-5 bg-card text-ink border border-gold/20 hover:bg-rose-500 hover:text-white rounded-full flex items-center justify-center shadow-sm"
                            >
                              <Minus className="w-2.5 h-2.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* VITAL CORE STATS */}
                    <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
                      {[
                        {
                          label: "INITIATIVE",
                          shortLabel: "INIT",
                          value:
                            character.initiative >= 0
                              ? `+${character.initiative}`
                              : character.initiative,
                        },
                        {
                          label: "SPEED",
                          shortLabel: "SPD",
                          value: `${character.speed}ft`,
                        },
                        {
                          label: "PROFICIENCY",
                          shortLabel: "PROF",
                          value: `+${character.proficiencyBonus}`,
                        },
                      ].map((stat) => (
                        <div
                          key={stat.label}
                          className="p-1 px-1 sm:p-2 sm:py-3 border border-gold/20 bg-card rounded flex flex-col items-center justify-center shadow-sm transition-all hover:-translate-y-0.5 min-w-0"
                        >
                          <span className="text-[7px] sm:text-[8px] xl:text-[7px] 2xl:text-[8px] text-ink/40 font-black tracking-tighter sm:tracking-widest leading-tight uppercase mb-0.5 truncate w-full text-center">
                            <span className="hidden sm:inline-block xl:hidden 2xl:inline-block">
                              {stat.label}
                            </span>
                            <span className="inline-block sm:hidden xl:inline-block 2xl:hidden">
                              {stat.shortLabel}
                            </span>
                          </span>
                          <span className="text-[10px] sm:text-xs font-black text-ink leading-none">
                            {stat.value}
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* SLIM RESOURCE METERS */}
                    <div className="space-y-3 pt-3 border-t border-gold/10">
                      <div className="flex items-center gap-3">
                        <span className="text-[8px] uppercase font-black text-ink/40 w-16">
                          Hit Dice
                        </span>
                        <div className="flex-1 h-2 bg-muted rounded-sm border border-gold/5 overflow-hidden">
                          <div
                            className="h-full bg-rose-700/70"
                            style={{
                              width: `${(character.hitDie.current / character.hitDie.max) * 100}%`,
                            }}
                          />
                        </div>
                        <span className="text-[10px] font-black text-ink/60 w-6 text-right">
                          {character.hitDie.current}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-[8px] uppercase font-black text-ink/40 w-16">
                          Spell Points
                        </span>
                        <div className="flex-1 h-2 bg-muted rounded-sm border border-gold/5 overflow-hidden">
                          <div
                            className="h-full bg-indigo-700/70"
                            style={{
                              width: `${character.spellPoints.max > 0 ? (character.spellPoints.current / character.spellPoints.max) * 100 : 0}%`,
                            }}
                          />
                        </div>
                        <span className="text-[10px] font-black text-ink/60 w-6 text-right">
                          {character.spellPoints.current}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* SAVING THROWS */}
                <div className="border border-gold/20 p-4 sm:p-6 rounded-lg bg-card/40 shadow-sm group">
                  <div className="section-header mb-4 sm:mb-6">
                    <h3 className="text-base sm:text-lg font-serif font-black uppercase text-ink/80 flex items-center gap-2 tracking-tight">
                      <ShieldCheck className="w-4 h-4 sm:w-5 sm:h-5 text-gold" />
                      Saving Throws
                    </h3>
                  </div>
                  <div className="grid grid-cols-1 xs:grid-cols-2 gap-x-6 sm:gap-x-12 gap-y-3 sm:gap-y-4">
                    {(allAttributes.length > 0 ? allAttributes : [
                      { id: 'STR', identifier: 'STR', name: 'STR' },
                      { id: 'DEX', identifier: 'DEX', name: 'DEX' },
                      { id: 'CON', identifier: 'CON', name: 'CON' },
                      { id: 'INT', identifier: 'INT', name: 'INT' },
                      { id: 'WIS', identifier: 'WIS', name: 'WIS' },
                      { id: 'CHA', identifier: 'CHA', name: 'CHA' }
                    ]).map((attrObj) => {
                      const attrIden = attrObj.identifier || attrObj.id;
                      const attrName = attrObj.name;
                      const isProficient =
                        character.savingThrows?.includes(attrIden);
                      const isExpert =
                        character.expertiseSavingThrows?.includes(attrIden); 
                      const isHalf =
                        character.halfProficientSavingThrows?.includes(attrIden);

                      const baseMod = parseInt(getModifier(getSafeStat(attrIden)));
                      const bonus = character.proficiencyBonus || 2;
                      let profBonus = 0;
                      if (isExpert) profBonus = bonus * 2;
                      else if (isProficient) profBonus = bonus;
                      else if (isHalf) profBonus = Math.floor(bonus / 2);

                      const total = baseMod + profBonus;

                      return (
                        <div
                          key={attrObj.id}
                          className="flex items-center justify-between group/row cursor-pointer py-1"
                          onClick={() => {
                            let newProf = [...(character.savingThrows || [])];
                            let newExp = [
                              ...(character.expertiseSavingThrows || []),
                            ];
                            let newHalf = [
                              ...(character.halfProficientSavingThrows || []),
                            ];
                            if (isHalf)
                              newHalf = newHalf.filter(
                                (s: string) => s !== attrIden,
                              );
                            else if (isExpert) {
                              newExp = newExp.filter((s: string) => s !== attrIden);
                              newHalf.push(attrIden);
                            } else if (isProficient) {
                              newProf = newProf.filter(
                                (s: string) => s !== attrIden,
                              );
                              newExp.push(attrIden);
                            } else newProf.push(attrIden);
                            setCharacter({
                              ...character,
                              savingThrows: newProf,
                              expertiseSavingThrows: newExp,
                              halfProficientSavingThrows: newHalf,
                            });
                          }}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            let newProf = [...(character.savingThrows || [])];
                            let newExp = [
                              ...(character.expertiseSavingThrows || []),
                            ];
                            let newHalf = [
                              ...(character.halfProficientSavingThrows || []),
                            ];
                            if (isHalf) {
                              newHalf = newHalf.filter(
                                (s: string) => s !== attrIden,
                              );
                              newExp.push(attrIden);
                            } else if (isExpert) {
                              newExp = newExp.filter((s: string) => s !== attrIden);
                              newProf.push(attrIden);
                            } else if (isProficient)
                              newProf = newProf.filter(
                                (s: string) => s !== attrIden,
                              );
                            else newHalf.push(attrIden);
                            setCharacter({
                              ...character,
                              savingThrows: newProf,
                              expertiseSavingThrows: newExp,
                              halfProficientSavingThrows: newHalf,
                            });
                          }}
                        >
                          <div className="flex items-center gap-4">
                            <div
                              className={`w-5 h-5 rounded-full border-2 relative transition-all flex items-center justify-center ${isProficient || isExpert || isHalf ? "border-gold" : "border-gold/30 group-hover/row:border-gold/60"} ${isProficient ? "bg-gold" : ""}`}
                            >
                              {isExpert && (
                                <div className="w-full h-full rounded-full bg-gold border-[3px] border-card flex items-center justify-center">
                                  <div className="w-1.5 h-1.5 bg-gold rounded-full" />
                                </div>
                              )}
                              {isHalf && (
                                <div
                                  className="absolute inset-0 bg-gold rounded-full"
                                  style={{
                                    clipPath:
                                      "polygon(0 0, 50% 0, 50% 100%, 0 100%)",
                                  }}
                                />
                              )}
                            </div>
                            <span
                              className={`text-xl font-black tracking-tight transition-colors ${isProficient || isExpert || isHalf ? "text-ink" : "text-ink/40"}`}
                            >
                              {attrName}
                            </span>
                          </div>
                          <span className="text-xl font-black text-ink">
                            {total >= 0 ? `+${total}` : total}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="grid md:grid-cols-3 gap-6 pt-4">
                {/* SKILLS & TOOLS COLUMN */}
                <div className="space-y-6">
                  <div className="p-4 border border-gold/20 bg-card/50 flex flex-col">
                    <div className="section-header mb-4">
                      <h3 className="label-text flex items-center gap-2">
                        <Package className="w-3 h-3 text-gold" />
                        Skills
                      </h3>
                      <Settings className="w-3 h-3 text-ink/20" />
                    </div>
                    <div className="flex flex-col">
                      {allSkills.map((skill, idx) => {
                        const isProficient =
                          character.proficientSkills?.includes(skill.id);
                        const isExpert = character.expertiseSkills?.includes(
                          skill.id,
                        );
                        const isHalf = character.halfProficientSkills?.includes(
                          skill.id,
                        );
                        const currentAbility =
                          character.overriddenSkillAbilities?.[skill.id] ||
                          skill.ability;
                        const total = getSkillTotal(skill.id);

                        return (
                          <div
                            key={skill.id}
                            className={`flex items-center gap-2 py-1 relative group ${idx !== allSkills.length - 1 ? "border-b border-dashed border-gold/10" : ""}`}
                          >
                            {/* Proficiency Cycle Button */}
                            <button
                              onClick={() => {
                                let newProf = [
                                  ...(character.proficientSkills || []),
                                ];
                                let newExp = [
                                  ...(character.expertiseSkills || []),
                                ];
                                let newHalf = [
                                  ...(character.halfProficientSkills || []),
                                ];

                                if (isHalf) {
                                  newHalf = newHalf.filter(
                                    (s: string) => s !== skill.id,
                                  );
                                } else if (isExpert) {
                                  newExp = newExp.filter(
                                    (s: string) => s !== skill.id,
                                  );
                                  newHalf.push(skill.id);
                                } else if (isProficient) {
                                  newProf = newProf.filter(
                                    (s: string) => s !== skill.id,
                                  );
                                  newExp.push(skill.id);
                                } else {
                                  newProf.push(skill.id);
                                }
                                setCharacter({
                                  ...character,
                                  proficientSkills: newProf,
                                  expertiseSkills: newExp,
                                  halfProficientSkills: newHalf,
                                });
                              }}
                              onContextMenu={(e) => {
                                e.preventDefault();
                                let newProf = [
                                  ...(character.proficientSkills || []),
                                ];
                                let newExp = [
                                  ...(character.expertiseSkills || []),
                                ];
                                let newHalf = [
                                  ...(character.halfProficientSkills || []),
                                ];

                                if (isHalf) {
                                  newHalf = newHalf.filter(
                                    (s: string) => s !== skill.id,
                                  );
                                  newExp.push(skill.id);
                                } else if (isExpert) {
                                  newExp = newExp.filter(
                                    (s: string) => s !== skill.id,
                                  );
                                  newProf.push(skill.id);
                                } else if (isProficient) {
                                  newProf = newProf.filter(
                                    (s: string) => s !== skill.id,
                                  );
                                } else {
                                  newHalf.push(skill.id);
                                }
                                setCharacter({
                                  ...character,
                                  proficientSkills: newProf,
                                  expertiseSkills: newExp,
                                  halfProficientSkills: newHalf,
                                });
                              }}
                              className="w-5 h-5 flex items-center justify-center flex-shrink-0"
                            >
                              <div
                                className={`w-3 h-3 rounded-full border-2 relative flex items-center justify-center transition-all ${isProficient || isExpert || isHalf ? "border-gold" : "border-gold/30 group-hover:border-gold/60"} ${isProficient ? "bg-gold" : ""}`}
                              >
                                {isExpert && (
                                  <div className="w-full h-full rounded-full bg-gold border-[2px] border-card flex items-center justify-center">
                                    <div className="w-1 h-1 bg-gold rounded-full" />
                                  </div>
                                )}
                                {isHalf && (
                                  <div
                                    className="absolute inset-0 bg-gold rounded-full"
                                    style={{
                                      clipPath:
                                        "polygon(0 0, 50% 0, 50% 100%, 0 100%)",
                                    }}
                                  />
                                )}
                              </div>
                            </button>

                            {/* Ability Select */}
                            <div className="w-8 flex-shrink-0">
                              <select
                                value={currentAbility}
                                onChange={(e) => {
                                  setCharacter({
                                    ...character,
                                    overriddenSkillAbilities: {
                                      ...(character.overriddenSkillAbilities ||
                                        {}),
                                      [skill.id]: e.target.value,
                                    },
                                  });
                                }}
                                className="bg-transparent text-[9px] sm:text-[10px] font-black text-gold/60 uppercase hover:text-gold transition-colors focus:outline-none cursor-pointer appearance-none px-0.5 w-full text-center"
                              >
                                {["STR", "DEX", "CON", "INT", "WIS", "CHA"].map(
                                  (a) => (
                                    <option
                                      key={a}
                                      value={a}
                                      className="bg-card text-ink"
                                    >
                                      {a}
                                    </option>
                                  ),
                                )}
                              </select>
                            </div>

                            {/* Skill Name */}
                            <span
                              className={`text-[11px] sm:text-xs font-black uppercase flex-1 transition-colors tracking-tighter truncate ${isProficient || isExpert || isHalf ? "text-ink" : "text-ink/30"}`}
                            >
                              {skill.name}
                            </span>

                            {/* Total Bonus */}
                            <span className="text-xs font-black text-ink/80 w-6 sm:w-8 text-right font-mono flex-shrink-0">
                              {total >= 0 ? `+${total}` : total}
                            </span>

                            {/* Small context cog */}
                            <button className="opacity-0 group-hover:opacity-20 transition-opacity hover:!opacity-60">
                              <Settings className="w-2.5 h-2.5 text-ink" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="p-4 border border-gold/20 bg-card/50 space-y-3">
                    <h4 className="label-text border-b border-gold/10 pb-2 flex items-center gap-2">
                      <Hammer className="w-3 h-3" />
                      Tool Proficiencies
                    </h4>
                    <div className="space-y-1">
                      {character.toolProficiencies?.length ? (
                        formatTraitValues("tools", character.toolProficiencies).map((item: string) => (
                          <div
                            key={item}
                            className="text-xs font-bold text-ink/70 flex items-center gap-2 uppercase tracking-tight"
                          >
                            <div className="w-1.5 h-1.5 bg-gold/40 rounded-full" />
                            {item}
                          </div>
                        ))
                      ) : (
                        <p className="text-[10px] italic text-ink/30 uppercase font-black">
                          No specialized tools
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="md:col-span-2 space-y-4">
                  <div className="flex flex-wrap items-center gap-3 border-b border-gold/10 pb-4">
                    {[
                      { id: "info", label: "Character Info" },
                      { id: "features", label: "Features" },
                      { id: "spells", label: "Spells" },
                    ].map((section) => (
                      <button
                        key={section.id}
                        onClick={() => setSheetSection(section.id)}
                        className={`px-4 py-2 border text-xs font-black uppercase tracking-widest transition-colors ${
                          sheetSection === section.id
                            ? "bg-gold/15 border-gold text-gold"
                            : "bg-card/30 border-gold/20 text-ink/45 hover:border-gold/50 hover:text-gold"
                        }`}
                      >
                        {section.label}
                      </button>
                    ))}
                  </div>

                  {sheetSection === "info" && (
                  <div className="grid md:grid-cols-2 gap-6">
                    {/* SENSES & DEFENSES */}
                    <div className="space-y-6">
                      <div className="p-4 border border-gold/20 bg-card/50 space-y-3 shadow-sm">
                        <div className="section-header mb-2">
                          <span className="label-text flex items-center gap-2">
                            <Zap className="w-3 h-3" />
                            Passive Traits
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                          {[
                            {
                              label: "Perception",
                              value: getPassiveScore("perception"),
                            },
                            {
                              label: "Investigation",
                              value: getPassiveScore("investigation"),
                            },
                            {
                              label: "Insight",
                              value: getPassiveScore("insight"),
                            },
                          ].map((sense) => (
                            <div
                              key={sense.label}
                              className="flex flex-col items-center gap-1"
                            >
                              <div className="w-full aspect-square bg-card border border-gold/10 text-ink flex items-center justify-center font-black rounded-sm shadow-sm text-lg">
                                {sense.value}
                              </div>
                              <span className="text-[9px] font-black text-gold/60 tracking-tight text-center leading-[1.1]">
                                {sense.label}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="p-4 border border-gold/20 bg-card/50 space-y-5">
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <span className="label-text text-ink/30 border-l-2 border-gold pl-2">
                              Languages
                            </span>
                            <div className="flex flex-wrap gap-1">
                              {character.languages?.length ? (
                                formatTraitValues("languages", character.languages).map((l: string) => (
                                  <span
                                    key={l}
                                    className="px-2 py-0.5 bg-gold/5 border border-gold/10 rounded-sm text-[10px] font-bold text-gold uppercase"
                                  >
                                    {l}
                                  </span>
                                ))
                              ) : (
                                <span className="text-[10px] font-bold text-ink/30 italic uppercase">
                                  Common
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="space-y-2">
                            <span className="label-text text-ink/30 border-l-2 border-rose-500 pl-2">
                              Resistances
                            </span>
                            <div className="flex flex-wrap gap-1">
                              {character.resistances?.length ? (
                                character.resistances.map((l: string) => (
                                  <span
                                    key={l}
                                    className="px-2 py-0.5 bg-rose-50 border border-rose-200/50 rounded-sm text-[10px] font-bold text-rose-800 uppercase"
                                  >
                                    {l}
                                  </span>
                                ))
                              ) : (
                                <span className="text-[10px] font-bold text-ink/10 italic uppercase">
                                  None
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* IDENTITY & PROFICIENCY STACK */}
                    <div className="space-y-4">
                      {[
                        {
                          title: character.raceId || "Select Race",
                          sub: character.raceData?.size || "Creature Size",
                          icon: <Dna className="w-5 h-5" />,
                          type: "Race",
                        },
                        {
                          title:
                            character.raceData?.creatureType || "Creature Type",
                          sub: "",
                          icon: <Users className="w-5 h-5" />,
                          type: "Creature Type",
                        },
                        {
                          title: character.backgroundId || "Select Background",
                          sub: "",
                          icon: <Scroll className="w-5 h-5" />,
                          type: "Background",
                        },
                        {
                          title: "Armor Proficiencies",
                          sub:
                            formatTraitValues("armor", character.armorProficiencies).join(", ") || "None",
                          icon: <Shield className="w-5 h-5" />,
                          type: "",
                        },
                        {
                          title: "Weapon Proficiencies",
                          sub:
                            formatTraitValues("weapons", character.weaponProficiencies).join(", ") || "None",
                          icon: <Sword className="w-5 h-5" />,
                          type: "",
                        },
                      ].map((item, idx) => (
                        <div
                          key={idx}
                          className="p-3 border border-gold/20 bg-card/60 rounded-md relative group flex items-center gap-4 transition-all hover:bg-card/80"
                        >
                          <div className="w-12 h-12 flex-shrink-0 bg-gold/10 rounded flex items-center justify-center border border-gold/20 text-gold shadow-sm group-hover:scale-105 transition-transform">
                            {item.icon}
                          </div>
                          <div className="flex-1 min-w-0">
                            <h4
                              className={`text-lg font-serif font-black uppercase tracking-tight leading-none line-clamp-1 transition-colors ${
                                item.title.startsWith("Select") ||
                                item.title === "Creature Type"
                                  ? "text-ink/20 italic"
                                  : "text-ink"
                              }`}
                            >
                              {item.title}
                            </h4>
                            {item.sub && (
                              <p
                                className={`font-bold uppercase tracking-widest mt-1.5 line-clamp-2 ${
                                  item.sub === "Creature Size"
                                    ? "text-[9px] text-ink/20 italic"
                                    : "text-xs text-ink/40"
                                }`}
                              >
                                {item.sub}
                              </p>
                            )}
                          </div>
                          {item.type && (
                            <div className="absolute top-2 right-3 opacity-20 group-hover:opacity-60 transition-opacity">
                              <span className="text-[8px] font-black uppercase tracking-[0.3em] text-ink">
                                {item.type}
                              </span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                  )}

                  {sheetSection === "features" && (
                    <div className="border border-gold/20 bg-card/40 rounded-xl p-4 sm:p-6 shadow-sm space-y-4">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div>
                          <h3 className="text-base sm:text-lg font-serif font-black uppercase text-ink/80 tracking-tight flex items-center gap-2">
                            <ShieldCheck className="w-4 h-4 sm:w-5 sm:h-5 text-gold" />
                            Class Progression
                          </h3>
                          <p className="text-xs text-ink/50 font-serif italic mt-1">
                            Features, scale tracks, and advancement selections currently active on this character.
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setActiveStep("class")}
                          className="border-gold/30 text-gold hover:bg-gold/5 uppercase tracking-widest text-[10px] font-black"
                        >
                          Open Class Step
                        </Button>
                      </div>

                      {sheetClassSummaries.length > 0 ? (
                        <div className="grid gap-4 xl:grid-cols-2">
                          {sheetClassSummaries.map((summary: any) => (
                            <div
                              key={summary.classId}
                              className="border border-gold/15 bg-background/40 rounded-lg p-4 space-y-4"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <div className="text-lg font-serif font-black text-ink leading-none">
                                    {summary.className}
                                  </div>
                                  <div className="text-[10px] font-black uppercase tracking-[0.22em] text-gold/70 mt-1">
                                    Level {summary.classLevel}
                                    {summary.subclassName ? ` • ${summary.subclassName}` : ""}
                                  </div>
                                </div>
                                <div className="px-2 py-1 border border-gold/20 bg-gold/5 rounded text-[10px] font-black uppercase tracking-widest text-ink/50">
                                  {summary.features.length} Features
                                </div>
                              </div>

                              <div className="space-y-2">
                                <div className="text-[10px] font-black uppercase tracking-[0.2em] text-ink/40">
                                  Scale Values
                                </div>
                                {summary.scales.length > 0 ? (
                                  <div className="flex flex-wrap gap-2">
                                    {summary.scales.map((scale: any) => (
                                      <div
                                        key={scale.id}
                                        className="px-2 py-1 border border-gold/20 bg-gold/5 rounded-sm"
                                      >
                                        <span className="text-[9px] font-black uppercase tracking-widest text-gold/70">
                                          {scale.name}
                                        </span>
                                        <span className="ml-2 text-sm font-black text-ink">
                                          {String(scale.value)}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <div className="text-xs font-serif italic text-ink/35">
                                    No tracked scale values yet.
                                  </div>
                                )}
                              </div>

                              <div className="space-y-2">
                                <div className="text-[10px] font-black uppercase tracking-[0.2em] text-ink/40">
                                  Granted Features
                                </div>
                                {summary.features.length > 0 ? (
                                  <div className="space-y-1.5">
                                    {summary.features.map((feature: any) => (
                                      <div
                                        key={`${summary.classId}-${feature.id}`}
                                        className="flex items-center justify-between gap-3 border-b border-gold/10 pb-1 last:border-b-0 last:pb-0"
                                      >
                                        <span className="text-sm font-serif text-ink">
                                          {feature.name}
                                        </span>
                                        <span className="text-[9px] font-black uppercase tracking-widest text-ink/35">
                                          L{feature.level}
                                          {feature.parentType === "subclass" ? " • Subclass" : ""}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <div className="text-xs font-serif italic text-ink/35">
                                    No granted features yet.
                                  </div>
                                )}
                              </div>

                              <div className="space-y-2">
                                <div className="text-[10px] font-black uppercase tracking-[0.2em] text-ink/40">
                                  Granted Items
                                </div>
                                {summary.grantedItems.length > 0 ? (
                                  <div className="space-y-1.5">
                                    {summary.grantedItems.map((item: any) => (
                                      <div
                                        key={`${summary.classId}-item-${item.id}-${item.level}`}
                                        className="flex items-center justify-between gap-3 border-b border-gold/10 pb-1 last:border-b-0 last:pb-0"
                                      >
                                        <span className="text-sm font-serif text-ink">
                                          {item.name}
                                        </span>
                                        <span className="text-[9px] font-black uppercase tracking-widest text-ink/35">
                                          L{item.level}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <div className="text-xs font-serif italic text-ink/35">
                                    No granted items yet.
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-sm font-serif italic text-ink/35">
                          No class progression is active yet.
                        </div>
                      )}

                      <div className="space-y-2 pt-2 border-t border-gold/10">
                        <div className="text-[10px] font-black uppercase tracking-[0.2em] text-ink/40">
                          Selected Advancement Options
                        </div>
                        {selectedAdvancementOptionItems.length > 0 ? (
                          <div className="flex flex-wrap gap-2">
                            {selectedAdvancementOptionItems.map((option: any) => (
                              <span
                                key={option.id}
                                className="px-2 py-1 bg-card border border-gold/20 rounded-sm text-[10px] font-bold text-ink/70 uppercase"
                              >
                                {option.name}
                                {option.featureType ? ` • ${option.featureType}` : ""}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <div className="text-xs font-serif italic text-ink/35">
                            No advancement options selected yet.
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {sheetSection === "spells" && (
                    <div className="border border-gold/20 bg-card/40 rounded-xl p-6 shadow-sm space-y-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <h3 className="text-base sm:text-lg font-serif font-black uppercase text-ink/80 tracking-tight flex items-center gap-2">
                            <Zap className="w-4 h-4 sm:w-5 sm:h-5 text-gold" />
                            Spellcasting
                          </h3>
                          <p className="text-xs text-ink/50 font-serif italic mt-1">
                            This sheet pane will reflect prepared or known spell state from the same class progression model.
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setActiveStep("class")}
                          className="border-gold/30 text-gold hover:bg-gold/5 uppercase tracking-widest text-[10px] font-black"
                        >
                          Open Class Step
                        </Button>
                      </div>

                      {spellcastingContributors.length > 0 ? (
                        <div className="space-y-4">
                          <div className="grid gap-4 md:grid-cols-3">
                            <div className="border border-gold/15 bg-background/40 rounded-lg p-4">
                              <div className="text-[10px] font-black uppercase tracking-[0.2em] text-ink/40 mb-2">
                                Casting Level
                              </div>
                              <div className="text-xl font-black text-ink">
                                {totalSpellcastingLevel}
                              </div>
                            </div>
                            <div className="border border-gold/15 bg-background/40 rounded-lg p-4">
                              <div className="text-[10px] font-black uppercase tracking-[0.2em] text-ink/40 mb-2">
                                Active Sources
                              </div>
                              <div className="text-xl font-black text-ink">
                                {spellcastingContributors.length}
                              </div>
                            </div>
                            <div className="border border-gold/15 bg-background/40 rounded-lg p-4">
                              <div className="text-[10px] font-black uppercase tracking-[0.2em] text-ink/40 mb-2">
                                Highest Slot
                              </div>
                              <div className="text-xl font-black text-ink">
                                {Math.max(
                                  0,
                                  ...multiclassSpellSlots.map((count: number, index: number) => (count > 0 ? index + 1 : 0)),
                                ) || "None"}
                              </div>
                            </div>
                          </div>

                          <div className="grid gap-3 md:grid-cols-2">
                            {spellcastingContributors.map((contributor: any) => (
                              <div
                                key={`${contributor.kind}-${contributor.classId}-${contributor.subclassId || "none"}`}
                                className="border border-gold/15 bg-background/40 rounded-lg p-4 space-y-2"
                              >
                                <div className="text-sm font-serif font-black text-ink">
                                  {contributor.label}
                                </div>
                                <div className="text-[10px] font-black uppercase tracking-[0.2em] text-gold/60">
                                  {contributor.progressionLabel || contributor.progression || "Spellcasting"}
                                </div>
                                <div className="text-xs font-serif text-ink/55">
                                  Contributes {contributor.effectiveLevel} casting level
                                  {contributor.effectiveLevel === 1 ? "" : "s"}.
                                </div>
                              </div>
                            ))}
                          </div>

                          <div className="border border-gold/15 bg-background/40 rounded-lg p-4">
                            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-ink/40 mb-3">
                              Multiclass Spell Slots
                            </div>
                            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                              {multiclassSpellSlots.map((count: number, index: number) => (
                                <div
                                  key={`slot-${index}`}
                                  className="border border-gold/10 bg-card/40 rounded-md p-3 text-center"
                                >
                                  <div className="text-[10px] font-black uppercase tracking-[0.2em] text-gold/60">
                                    {index + 1}
                                    {index === 0 ? "st" : index === 1 ? "nd" : index === 2 ? "rd" : "th"}
                                  </div>
                                  <div className="text-lg font-black text-ink mt-1">
                                    {count}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="text-sm font-serif italic text-ink/35">
                          No active spellcasting sources yet.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
              </>
              )}

              {false && (
                <div className="border border-gold/20 bg-card/40 rounded-xl p-6 shadow-sm space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-base sm:text-lg font-serif font-black uppercase text-ink/80 tracking-tight flex items-center gap-2">
                        <Zap className="w-4 h-4 sm:w-5 sm:h-5 text-gold" />
                        Spellcasting
                      </h3>
                      <p className="text-xs text-ink/50 font-serif italic mt-1">
                        This sheet pane will reflect prepared or known spell state from the same class progression model.
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setActiveStep("class")}
                      className="border-gold/30 text-gold hover:bg-gold/5 uppercase tracking-widest text-[10px] font-black"
                    >
                      Open Class Step
                    </Button>
                  </div>

                  {spellcastingContributors.length > 0 ? (
                    <div className="space-y-4">
                      <div className="grid gap-4 md:grid-cols-3">
                        <div className="border border-gold/15 bg-background/40 rounded-lg p-4">
                          <div className="text-[10px] font-black uppercase tracking-[0.2em] text-ink/40 mb-2">
                            Casting Level
                          </div>
                          <div className="text-xl font-black text-ink">
                            {totalSpellcastingLevel}
                          </div>
                        </div>
                        <div className="border border-gold/15 bg-background/40 rounded-lg p-4">
                          <div className="text-[10px] font-black uppercase tracking-[0.2em] text-ink/40 mb-2">
                            Active Sources
                          </div>
                          <div className="text-xl font-black text-ink">
                            {spellcastingContributors.length}
                          </div>
                        </div>
                        <div className="border border-gold/15 bg-background/40 rounded-lg p-4">
                          <div className="text-[10px] font-black uppercase tracking-[0.2em] text-ink/40 mb-2">
                            Highest Slot
                          </div>
                          <div className="text-xl font-black text-ink">
                            {Math.max(
                              0,
                              ...multiclassSpellSlots
                                .map((count: number, index: number) => (count > 0 ? index + 1 : 0)),
                            ) || "None"}
                          </div>
                        </div>
                      </div>

                      <div className="grid gap-3 md:grid-cols-2">
                        {spellcastingContributors.map((contributor: any) => (
                          <div
                            key={`${contributor.sourceType}-${contributor.label}`}
                            className="border border-gold/15 bg-background/40 rounded-lg p-4 space-y-2"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-sm font-black text-ink">
                                {contributor.label}
                              </div>
                              <div className="text-[10px] font-black uppercase tracking-[0.2em] text-gold">
                                +{contributor.effectiveLevel}
                              </div>
                            </div>
                            <div className="text-[10px] text-ink/50 uppercase tracking-[0.2em] font-black">
                              {contributor.sourceType} spellcasting
                            </div>
                            <div className="text-xs text-ink/70 font-serif">
                              {contributor.progressionTypeName} • Level {contributor.classLevel}
                            </div>
                            <div className="text-[11px] text-ink/50 font-mono">
                              {contributor.progressionFormula}
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="border border-gold/15 bg-background/40 rounded-lg p-4">
                        <div className="text-[10px] font-black uppercase tracking-[0.2em] text-ink/40 mb-3">
                          Multiclass Slot Table Result
                        </div>
                        <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-2">
                          {multiclassSpellSlots.map((count: number, index: number) => (
                            <div
                              key={`slot-${index + 1}`}
                              className="border border-gold/10 rounded-md p-2 text-center bg-card/40"
                            >
                              <div className="text-[9px] font-black uppercase tracking-[0.2em] text-ink/40">
                                {index + 1}
                              </div>
                              <div className="text-lg font-black text-ink">
                                {count}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm font-serif italic text-ink/35">
                      No spellcasting progression is active yet.
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : activeStep === "class" ? (
            <div className="bg-background/50 rounded-xl border border-gold/10 h-full min-h-[500px]">
              {isSelectingClass ? (
                <div className="p-4 sm:p-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <ClassList
                    userProfile={userProfile}
                    selectionMode={true}
                    onSelectClass={(cls) => {
                      setCharacter((prev: any) => {
                        const newProg = [...(prev.progression || [])];
                        // If no progression, this is the first class choice
                        if (newProg.length === 0) {
                          return {
                            ...prev,
                            classId: cls.id,
                            progression: [
                              { classId: cls.id, className: cls.name, subclassId: "", level: 1 },
                            ],
                            level: 1,
                          };
                        }
                        // Adding a new class or an extra level of a selected class
                        const currentClassLevel = newProg.filter(
                          (p: any) =>
                            p.classId === cls.id || p.className === cls.name,
                        ).length;
                        return {
                          ...prev,
                          progression: [
                            ...newProg,
                            {
                              classId: cls.id,
                              className: cls.name,
                              subclassId: newProg.find(
                                (p: any) => p.classId === cls.id || p.className === cls.name,
                              )?.subclassId || "",
                              level: currentClassLevel + 1,
                            },
                          ],
                          level: (prev.level || newProg.length) + 1,
                        };
                      });
                      setIsSelectingClass(false);
                    }}
                    onCancelSelection={() => setIsSelectingClass(false)}
                  />
                </div>
              ) : (
                <div className="p-4 sm:p-8 flex flex-col h-full min-h-[500px]">
                  <div className="flex-1 flex flex-col gap-6 w-full text-left max-w-4xl mx-auto">
                    {/* Top Box: Classes Summary */}
                    <div className="border border-gold/20 bg-card p-6 rounded-xl shadow-sm mb-4">
                      <div className="flex justify-end mb-4">
                        <Button
                          onClick={() => setIsSelectingClass(true)}
                          variant="ghost"
                          title="Add Class"
                          className="text-gold hover:bg-gold/10 font-bold uppercase tracking-widest text-xs gap-2"
                        >
                          <Plus className="w-4 h-4" /> Add Class
                        </Button>
                      </div>
                      <div className="space-y-3">
                        {(() => {
                          if (progressionClassGroups.length === 0) {
                            return (
                              <div className="text-center py-6 text-ink/40 font-serif italic text-lg">
                                No classes added yet. Select Add Class to begin.
                              </div>
                            );
                          }

                          return progressionClassGroups.map((group: any) => (
                            <div
                              key={group.classKey}
                              className="flex justify-between items-center group"
                            >
                              <div className="flex items-baseline gap-2 pl-2">
                                <span className="font-serif text-xl font-bold text-ink">
                                  {group.className} {group.classLevel}
                                </span>
                                {group.subclassId && subclassCache[group.subclassId]?.name && (
                                  <span className="text-xs font-black uppercase tracking-[0.2em] text-gold/70">
                                    {subclassCache[group.subclassId].name}
                                  </span>
                                )}
                              </div>
                               <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleRemoveClass(group.className)}
                                className="text-blood/60 hover:text-white hover:bg-blood uppercase font-bold tracking-widest text-[10px] transition-colors"
                              >
                                Remove Class
                              </Button>
                            </div>
                          ));
                        })()}
                      </div>
                    </div>

                    {/* Progression List */}
                    {(() => {
                      const currentProgression = buildCurrentProgression(character);
                      if (currentProgression.length === 0) return null;

                      return (
                        <div className="space-y-6">
                          <div className="space-y-4">
                            {currentProgression.map(
                              (prog: any, idx: number) => {
                                const classKey = getProgressionClassKey(prog);
                                const matchedClass =
                                  classCache[prog.classId || ""] ||
                                  Object.values(classCache).find(
                                    (c: any) =>
                                      c.id === prog.classId ||
                                      c.name === prog.className,
                                  );
                                const classSummary =
                                  classProgressionSummaryByKey.get(classKey) ||
                                  (matchedClass
                                    ? classProgressionSummaryByKey.get(matchedClass.id)
                                    : null);
                                const matchedSubclass =
                                  classSummary?.subclassDocument ||
                                  (prog.subclassId
                                    ? subclassCache[prog.subclassId]
                                    : null);
                                const classIntroductionMode = matchedClass
                                  ? getClassIntroductionMode(
                                      currentProgression,
                                      classKey,
                                    )
                                  : "none";
                                const features =
                                  classSummary?.featuresByLevel?.[prog.level] || [];
                                const grantedItemsAtThisLevel =
                                  classSummary?.grantedItemsByLevel?.[prog.level] || [];

                                // Calculate choices and advancements
                                const choicesAtThisLevel: any[] = [];

                                // 1. Check legacy optionalfeatureProgression
                                if (matchedClass?.optionalfeatureProgression) {
                                  matchedClass.optionalfeatureProgression.forEach(
                                    (opt: any) => {
                                      const currentProgVal =
                                        opt.progression[prog.level - 1] || 0;
                                      const prevProgVal =
                                        prog.level > 1
                                          ? opt.progression[prog.level - 2] || 0
                                          : 0;
                                      const newlyAcquired =
                                        currentProgVal - prevProgVal;
                                      if (newlyAcquired > 0) {
                                        choicesAtThisLevel.push({
                                          name: opt.name,
                                          count: newlyAcquired,
                                          featureType: opt.featureType,
                                          type: "legacy",
                                        });
                                      }
                                    },
                                  );
                                }

                                // Check advancements from ALL obtainable features at this point in progression
                                const allAccessibleFeatures =
                                  classSummary?.accessibleClassFeatures ||
                                  (matchedClass && featureCache[matchedClass.id]
                                    ? featureCache[matchedClass.id].filter(
                                        (f) => f.level <= prog.level,
                                      )
                                    : []);
                                const allAccessibleSubclassFeatures =
                                  classSummary?.accessibleSubclassFeatures ||
                                  (matchedSubclass &&
                                  featureCache[matchedSubclass.id]
                                    ? featureCache[matchedSubclass.id].filter(
                                        (f) => f.level <= prog.level,
                                      )
                                    : []);

                                // 2. Check Modern Advancements
                                const processAdvancement = (
                                  adv: any,
                                  sourceContext: Record<string, any>,
                                  isSubclass = false,
                                ) => {
                                  const effectiveAdvancement =
                                    !isSubclass && matchedClass
                                      ? getEffectiveClassAdvancement(
                                          adv,
                                          matchedClass,
                                          classIntroductionMode,
                                        )
                                      : adv;
                                  if (!effectiveAdvancement) return;

                                  adv = effectiveAdvancement;
                                  const advLevel = adv.level || 1;
                                  const scalingSource =
                                    adv.configuration?.countSource ===
                                      "scaling" ||
                                    adv.configuration?.choiceSource ===
                                      "scaling";

                                  let resolvedCount = 0;
                                  let isIncremental = false;

                                  if (adv.type === "AbilityScoreImprovement") {
                                    if (advLevel !== prog.level) return;

                                    choicesAtThisLevel.push({
                                      name: adv.title || "Ability Score Improvement",
                                      count: 1,
                                      type: "asi-trigger",
                                      advType: adv.type,
                                      featureId: adv.featureId,
                                      advId: adv._id,
                                      sourceScope:
                                        buildAdvancementSourceScope(sourceContext),
                                      classId: matchedClass?.id,
                                      level: prog.level,
                                      configuration: adv.configuration,
                                    });
                                    return;
                                  }

                                  if (scalingSource) {
                                    if (prog.level < advLevel) return;

                                    const colId =
                                      adv.configuration?.scalingColumnId;
                                    if (!colId) return;

                                    const col = scalingCache[colId];
                                    if (col && col.values) {
                                      const currentVal =
                                        parseInt(
                                          col.values[prog.level.toString()],
                                        ) || 0;
                                      const prevVal =
                                        prog.level > 1
                                          ? parseInt(
                                              col.values[
                                                (prog.level - 1).toString()
                                              ],
                                            ) || 0
                                          : 0;
                                      resolvedCount = currentVal - prevVal;
                                      isIncremental = prog.level > advLevel;
                                    }
                                  } else {
                                    if (advLevel !== prog.level) return;
                                    resolvedCount =
                                      adv.type === "ItemChoice"
                                        ? adv.configuration?.count || 1
                                        : adv.configuration?.choiceCount || 0;
                                  }

                                  if (resolvedCount <= 0 && adv.type !== "Subclass") return;

                                  let title = adv.title || (adv.type === "ItemChoice" ? "Choice" : adv.type === "Subclass" ? "Subclass" : adv.type);
                                  
                                  if (isIncremental) {
                                    const parentFeature = [
                                      ...allAccessibleFeatures,
                                      ...allAccessibleSubclassFeatures,
                                    ].find(f => f.id === adv.featureId);
                                    
                                    if (parentFeature) {
                                      title = `${parentFeature.name} Additional Choice`;
                                    } else {
                                      title = `${title} Additional Choice`;
                                    }
                                  }

                                  const baseChoices = {
                                    name: title,
                                    count: resolvedCount,
                                    type: "advancement",
                                    advType: adv.type,
                                    featureId: adv.featureId,
                                    advId: adv._id,
                                    sourceScope: buildAdvancementSourceScope(sourceContext),
                                    classId: matchedClass?.id,
                                    level: prog.level,
                                    configuration: adv.configuration,
                                  };

                                  const canonicalTraitChoices =
                                    adv.type === "Trait"
                                      ? getCanonicalTraitChoiceEntries(
                                          adv.configuration,
                                        )
                                      : [];
                                  const fallbackTraitChoices =
                                    adv.type === "Trait" &&
                                    canonicalTraitChoices.length === 0 &&
                                    resolvedCount > 0 &&
                                    (adv.configuration?.options?.length || 0) > 0
                                      ? [
                                          {
                                            id: String(
                                              adv.configuration?.type ||
                                                "trait",
                                            ),
                                            count: resolvedCount,
                                            type: String(
                                              adv.configuration?.type ||
                                                "trait",
                                            ),
                                            pool:
                                              adv.configuration?.options || [],
                                            categoryIds:
                                              adv.configuration?.categoryIds || [],
                                          },
                                        ]
                                      : [];
                                  const traitChoices =
                                    canonicalTraitChoices.length > 0
                                      ? canonicalTraitChoices
                                      : fallbackTraitChoices;

                                  if (
                                    adv.type === "ItemChoice" ||
                                    (adv.type === "Trait" &&
                                      traitChoices.length > 0)
                                  ) {
                                    if (adv.type === "Trait" && traitChoices.length > 0) {
                                      traitChoices.forEach((traitChoice, cIdx: number) => {
                                        if (
                                          traitChoice.count > 0 &&
                                          ((traitChoice.pool?.length || 0) > 0 ||
                                            (traitChoice.categoryIds?.length || 0) > 0)
                                        ) {
                                          choicesAtThisLevel.push({
                                            ...baseChoices,
                                            choiceId: String(
                                              traitChoice.id || cIdx,
                                            ),
                                            selectionKey:
                                              buildAdvancementSelectionKey({
                                                sourceScope:
                                                  baseChoices.sourceScope,
                                                advancementId: adv._id,
                                                level: prog.level,
                                                choiceId:
                                                  traitChoice.id || cIdx,
                                              }),
                                            name: `${title} (${traitChoice.type.charAt(0).toUpperCase() + traitChoice.type.slice(1)})`,
                                            count: traitChoice.count,
                                            featureType: traitChoice.type,
                                            configuration: {
                                              ...adv.configuration,
                                              choices: [traitChoice]
                                            }
                                          });
                                        }
                                      });
                                    } else if (resolvedCount > 0) {
                                      choicesAtThisLevel.push({
                                        ...baseChoices,
                                        selectionKey:
                                          buildAdvancementSelectionKey({
                                            sourceScope:
                                              baseChoices.sourceScope,
                                            advancementId: adv._id,
                                            level: prog.level,
                                          }),
                                        featureType:
                                          adv.type === "ItemChoice"
                                            ? adv.configuration?.choiceType ===
                                              "feature"
                                              ? adv.configuration?.pool?.[0]
                                              : adv.configuration?.featureType
                                            : adv.configuration?.type || "trait",
                                        optionGroupId:
                                          adv.configuration?.optionGroupId ||
                                          (adv.configuration?.choiceType ===
                                          "option-group"
                                            ? adv.configuration?.optionGroupId
                                            : undefined),
                                      });
                                    }
                                  } else if (
                                    adv.type === "Subclass" &&
                                    !isSubclass
                                  ) {
                                    if (!matchedSubclass) {
                                      choicesAtThisLevel.push({
                                        ...baseChoices,
                                        type: "subclass-trigger",
                                        classId: matchedClass?.id,
                                        level: prog.level,
                                      });
                                    } else {
                                      // Already have a subclass, show it as info
                                      choicesAtThisLevel.push({
                                        ...baseChoices,
                                        type: "advancement-info",
                                      });
                                    }
                                  } else if (adv.featureId) {
                                    // General attached advancement (Grant, Trait, etc)
                                    choicesAtThisLevel.push({
                                      ...baseChoices,
                                      type: "advancement-info",
                                    });
                                  }
                                };

                                if (matchedClass?.advancements) {
                                  matchedClass.advancements.forEach(
                                    (adv: any) =>
                                      processAdvancement(
                                        adv,
                                        buildAdvancementSourceContext({
                                          parentType: "class",
                                          classDocument: matchedClass,
                                        }),
                                      ),
                                  );
                                }

                                // 3. Synthesize Subclass Choice from subclassFeatureLevels if no explicit advancement exists
                                const hasExplicitSubclassAdv = 
                                  matchedClass?.advancements?.some((a: any) => a.type === "Subclass") ||
                                  allAccessibleFeatures.some(f => f.advancements?.some((a: any) => a.type === "Subclass"));
                                if (!hasExplicitSubclassAdv && matchedClass?.subclassFeatureLevels?.length > 0) {
                                  const firstSubclassLevel = matchedClass.subclassFeatureLevels[0];
                                  if (prog.level === firstSubclassLevel) {
                                    processAdvancement({
                                      _id: `synth-subclass-${matchedClass.id}`,
                                      type: "Subclass",
                                      level: firstSubclassLevel,
                                      title: matchedClass.subclassTitle || "Subclass",
                                      configuration: {}
                                    }, buildAdvancementSourceContext({
                                      parentType: "class",
                                      classDocument: matchedClass,
                                    }));
                                  }
                                }

                                if (matchedSubclass?.advancements) {
                                  matchedSubclass.advancements.forEach(
                                    (adv: any) =>
                                      processAdvancement(
                                        adv,
                                        buildAdvancementSourceContext({
                                          parentType: "subclass",
                                          classDocument: matchedClass,
                                          subclassDocument: matchedSubclass,
                                        }),
                                        true,
                                      ),
                                  );
                                }

                                allAccessibleFeatures.forEach((feat: any) => {
                                  if (feat.advancements) {
                                    feat.advancements.forEach((adv: any) => {
                                      processAdvancement(
                                        {
                                          ...adv,
                                          level: (adv.level !== undefined && adv.level !== null) ? adv.level : feat.level,
                                          featureId: feat.id,
                                        },
                                        buildAdvancementSourceContext({
                                          parentType: "feature",
                                          classDocument: matchedClass,
                                          parentDocument: feat,
                                        }),
                                        false,
                                      );
                                    });
                                  }
                                });

                                allAccessibleSubclassFeatures.forEach((feat: any) => {
                                  if (feat.advancements) {
                                    feat.advancements.forEach((adv: any) => {
                                      processAdvancement(
                                        {
                                          ...adv,
                                          level: (adv.level !== undefined && adv.level !== null) ? adv.level : feat.level,
                                          featureId: feat.id,
                                        },
                                        buildAdvancementSourceContext({
                                          parentType: "subclass-feature",
                                          classDocument: matchedClass,
                                          subclassDocument: matchedSubclass,
                                          parentDocument: feat,
                                        }),
                                        true,
                                      );
                                    });
                                  }
                                });

                                return (
                                  <div
                                    key={idx}
                                    className="bg-transparent group border-b border-gold/10 pb-4 flex gap-4"
                                  >
                                    <div className="w-24 shrink-0 flex flex-col items-center pt-2 gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
                                      <span className="font-sans font-black text-ink uppercase tracking-widest text-[10px] text-center w-full truncate px-1">
                                        {prog.className}
                                      </span>
                                      <div className="flex flex-col items-center leading-none border border-gold/30 rounded-md p-2 bg-gold/5 w-14 shadow-sm group-hover:bg-gold/10 group-hover:border-gold/50 transition-colors">
                                        <span className="font-serif text-2xl font-black text-ink">
                                          {prog.level}
                                        </span>
                                        <span className="text-[8px] font-bold uppercase tracking-widest text-ink/60 mt-1">
                                          Level
                                        </span>
                                      </div>
                                    </div>
                                    <div className="flex-1 space-y-4 justify-center flex flex-col pt-2">
                                      {features.length > 0 ||
                                      grantedItemsAtThisLevel.length > 0 ||
                                      choicesAtThisLevel.length > 0 ? (
                                        <>
                                          {features.map((f: any) => (
                                            <div
                                              key={`${f.id}-${f.level}-${f.parentType}`}
                                              className="space-y-1"
                                            >
                                              <div className="flex items-center gap-2">
                                                <div className="w-1.5 h-1.5 rounded-full bg-gold/50"></div>
                                                <span className="font-serif font-bold text-ink text-lg">
                                                  {f.name}
                                                </span>
                                                {matchedSubclass &&
                                                  f.parentId === matchedSubclass.id && (
                                                  <span className="text-[8px] font-black uppercase text-gold/60 tracking-widest ml-2">
                                                    Subclass
                                                  </span>
                                                )}
                                              </div>
                                              {f.description && (
                                                <div className="text-ink/70 font-serif text-sm leading-relaxed pl-3.5 border-l border-gold/20 ml-[3px]">
                                                  <BBCodeRenderer
                                                    content={f.description}
                                                  />
                                                </div>
                                              )}
                                            </div>
                                          ))}
                                          {grantedItemsAtThisLevel.length > 0 && (
                                            <div className="space-y-2 pt-1">
                                              <div className="flex items-center gap-2 text-gold/70">
                                                <Package className="w-4 h-4" />
                                                <span className="text-[10px] font-black uppercase tracking-[0.24em]">
                                                  Granted Items
                                                </span>
                                              </div>
                                              <div className="flex flex-wrap gap-2 pl-3.5">
                                                {grantedItemsAtThisLevel.map((item: any) => (
                                                  <span
                                                    key={`${item.id}-${item.level}-${item.parentType}`}
                                                    className="px-2 py-1 bg-card border border-gold/20 rounded-sm text-[10px] font-bold text-ink/70 uppercase"
                                                  >
                                                    {item.name}
                                                  </span>
                                                ))}
                                              </div>
                                            </div>
                                          )}
                                          {choicesAtThisLevel.length > 0 && (
                                            <div className="flex items-center gap-2 pt-2 text-gold/70">
                                              <ShieldCheck className="w-4 h-4" />
                                              <span className="text-[10px] font-black uppercase tracking-[0.24em]">
                                                Level Advancements
                                              </span>
                                            </div>
                                          )}
                                          {choicesAtThisLevel
                                            .map(
                                              (choice: any, cidx: number) => {
                                                if (
                                                  choice.type ===
                                                  "subclass-trigger"
                                                ) {
                                                  return (
                                                    <div
                                                      key={`subclass-${cidx}`}
                                                      className="bg-emerald-500/5 border border-emerald-500/20 rounded-md p-4 mt-2 mb-4 ml-[3px]"
                                                    >
                                                      <div className="flex items-center justify-between mb-2">
                                                        <span className="font-serif font-bold text-ink text-sm uppercase tracking-wider flex items-center gap-2">
                                                          <Star className="w-4 h-4 text-emerald-500" />
                                                          Select {choice.name}
                                                        </span>
                                                      </div>
                                                      <p className="text-xs text-ink/60 font-serif mb-4 italic">
                                                        You reached the level to
                                                        specialize. Choose your
                                                        path.
                                                      </p>
                                                      <Button
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={async () => {
                                                          const rows = await fetchCollection<any>(
                                                            "subclasses",
                                                            {
                                                              where: "class_id = ?",
                                                              params: [choice.classId],
                                                            },
                                                          );
                                                          setAvailableSubclasses(rows.map(denormSubclass));
                                                          setIsSelectingSubclass(
                                                            {
                                                              open: true,
                                                              classId:
                                                                choice.classId,
                                                              level:
                                                                choice.level,
                                                            },
                                                          );
                                                        }}
                                                        className="w-full border-dashed border-emerald-500/40 text-emerald-700 hover:bg-emerald-500/10 hover:border-emerald-500 font-bold tracking-widest uppercase text-[10px]"
                                                      >
                                                        <Plus className="w-3 h-3 mr-2" />{" "}
                                                        Choose {choice.name}
                                                      </Button>
                                                    </div>
                                                  );
                                                }

                                                if (
                                                  choice.type ===
                                                  "asi-trigger"
                                                ) {
                                                  return (
                                                    <div
                                                      key={`asi-${cidx}`}
                                                      className="bg-sky-500/5 border border-sky-500/20 rounded-md p-4 mt-2 mb-4 ml-[3px]"
                                                    >
                                                      <div className="flex items-center justify-between gap-3 mb-2">
                                                        <span className="font-serif font-bold text-ink text-sm uppercase tracking-wider flex items-center gap-2">
                                                          <Edit2 className="w-4 h-4 text-sky-600" />
                                                          {choice.name}
                                                        </span>
                                                        <span className="text-[9px] font-black uppercase tracking-[0.2em] text-sky-700/70">
                                                          Level {choice.level}
                                                        </span>
                                                      </div>
                                                      <p className="text-xs text-ink/60 font-serif mb-4 italic">
                                                        This level grants an ability score improvement.
                                                        Use the sheet controls to apply the increase for now.
                                                      </p>
                                                      <Button
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={() => setShowPointBuy(true)}
                                                        className="w-full border-dashed border-sky-500/40 text-sky-700 hover:bg-sky-500/10 hover:border-sky-500 font-bold tracking-widest uppercase text-[10px]"
                                                      >
                                                        <Edit2 className="w-3 h-3 mr-2" />
                                                        Manage Ability Scores
                                                      </Button>
                                                    </div>
                                                  );
                                                }

                                                if (
                                                  choice.type ===
                                                  "advancement-info"
                                                ) {
                                                  const traitValues =
                                                    choice.advType === "Trait"
                                                      ? uniqueStringList(
                                                          [
                                                            ...uniqueStringList(
                                                              choice.configuration
                                                                ?.grants,
                                                            ),
                                                            ...uniqueStringList(
                                                              choice.configuration
                                                                ?.fixed,
                                                            ),
                                                            ...uniqueStringList(
                                                              choice.configuration
                                                                ?.options,
                                                            ),
                                                            ...uniqueStringList(
                                                              choice.configuration
                                                                ?.categoryIds,
                                                            ),
                                                          ].map((value) =>
                                                            normalizeTraitValueForCharacter(
                                                              String(
                                                                choice
                                                                  .configuration
                                                                  ?.type || "",
                                                              ),
                                                              value,
                                                            ),
                                                          ),
                                                        )
                                                      : [];
                                                  return (
                                                    <div
                                                      key={`info-${cidx}`}
                                                      className="bg-ink/5 border border-ink/10 rounded-md p-3 mt-2 mb-4 ml-[3px] text-[10px] font-serif"
                                                    >
                                                      <div className="flex items-center gap-2 text-ink/60 mb-1">
                                                        <Zap className="w-3 h-3 text-gold" />
                                                        <span className="font-bold uppercase tracking-tight">
                                                          {choice.name}
                                                        </span>
                                                      </div>
                                                      {choice.advType ===
                                                        "ItemGrant" && (
                                                        <div className="flex flex-wrap gap-1 mt-1">
                                                          {collectGrantedItemReferences(choice).map(
                                                            (
                                                              itemId: string,
                                                            ) => {
                                                              const resolvedItem =
                                                                resolveGrantedItemRecord(
                                                                  itemId,
                                                                  grantedItemLookups,
                                                                );
                                                              const featName =
                                                                resolvedItem?.name ||
                                                                itemId;
                                                              return (
                                                                <span
                                                                  key={itemId}
                                                                  className="bg-gold/10 text-gold px-1.5 py-0.5 rounded border border-gold/20"
                                                                >
                                                                  {featName}
                                                                </span>
                                                              );
                                                            },
                                                          )}
                                                        </div>
                                                      )}
                                                      {choice.advType ===
                                                        "Trait" && (
                                                        <p className="text-ink/50 italic">
                                                          Gains proficiency in:{" "}
                                                          {traitValues.length > 0
                                                            ? traitValues.join(", ")
                                                            : choice.configuration
                                                                ?.type || "Trait"}
                                                        </p>
                                                      )}
                                                      {choice.advType ===
                                                        "Subclass" && (
                                                        <div className="mt-1">
                                                          <span className="text-emerald-600 font-bold">
                                                            {matchedSubclass?.name ||
                                                              (prog.subclassId
                                                                ? `ID: ${prog.subclassId}`
                                                                : "Not Selected")}
                                                          </span>
                                                        </div>
                                                      )}
                                                    </div>
                                                  );
                                                }

                                                if (!choice) return null;
                                                const selectionKey =
                                                  choice.selectionKey ||
                                                  buildAdvancementSelectionKey({
                                                    sourceScope:
                                                      choice.sourceScope,
                                                    advancementId:
                                                      choice.advId,
                                                    level: choice.level,
                                                    choiceId: choice.choiceId,
                                                  });
                                                const selectedChoicesForOption =
                                                  getAdvancementSelectionValues(
                                                    selectedOptionsMap,
                                                    {
                                                      sourceScope:
                                                        choice.sourceScope,
                                                      advancementId:
                                                        choice.advId,
                                                      level: choice.level,
                                                      choiceId:
                                                        choice.choiceId,
                                                    },
                                                  );
                                                const selectedChoiceLabels =
                                                  choice.advType === "Trait"
                                                    ? formatTraitValues(
                                                        String(
                                                          choice.configuration
                                                            ?.type || "",
                                                        ),
                                                        selectedChoicesForOption,
                                                      )
                                                    : selectedChoicesForOption.map(
                                                        (optId: string) =>
                                                          optionsCache[optId]
                                                            ?.name || optId,
                                                      );

                                                return (
                                                  <div key={`choice-${cidx}`}>
                                                    <div className="space-y-1 mb-4">
                                                      <div className="flex items-center gap-2">
                                                        <div className="w-1.5 h-1.5 rounded-full bg-gold/50"></div>
                                                        <span className="font-serif font-bold text-ink text-lg">
                                                          {choice.name}
                                                        </span>
                                                      </div>
                                                      <div className="text-ink/70 font-serif text-sm leading-relaxed pl-3.5 border-l border-gold/20 ml-[3px]">
                                                        Advancement choice available for this level.
                                                      </div>
                                                    </div>
                                                    <div className="bg-gold/5 border border-gold/20 rounded-md p-4 mt-2 mb-4 ml-[3px]">
                                                      <div className="flex items-center justify-between mb-2">
                                                        <span className="font-serif font-bold text-ink text-sm uppercase tracking-wider flex items-center gap-2">
                                                          <ShieldCheck className="w-4 h-4 text-gold" />
                                                          Select {choice.name}{" "}
                                                          Options
                                                        </span>
                                                        <span className="text-xs font-black text-ink/40 tracking-widest">
                                                          {choice.count}{" "}
                                                          AVAILABLE
                                                        </span>
                                                      </div>
                                                      {selectedChoicesForOption.length >
                                                        0 && (
                                                        <div className="space-y-2 mb-2">
                                                          {selectedChoiceLabels.map(
                                                            (label: string, labelIdx: number) => (
                                                              <div
                                                                key={`${selectionKey}-${labelIdx}-${label}`}
                                                                className="flex justify-between items-center bg-card border border-gold/20 p-2 text-sm font-serif"
                                                              >
                                                                <span>{label}</span>
                                                                <Button
                                                                  variant="ghost"
                                                                  size="sm"
                                                                onClick={() => {
                                                                  const targetSelectionId =
                                                                    selectedChoicesForOption[
                                                                      labelIdx
                                                                    ];
                                                                  setCharacter(
                                                                    (
                                                                      prev: any,
                                                                    ) =>
                                                                      updateCharacterAdvancementSelectionState(
                                                                        prev,
                                                                        {
                                                                          sourceScope:
                                                                            choice.sourceScope,
                                                                          advancementId:
                                                                            choice.advId,
                                                                          level:
                                                                            choice.level,
                                                                          choiceId:
                                                                            choice.choiceId,
                                                                        },
                                                                        selectedChoicesForOption.filter(
                                                                          (
                                                                            id: string,
                                                                          ) =>
                                                                            id !==
                                                                            targetSelectionId,
                                                                        ),
                                                                      ),
                                                                  );
                                                                }}
                                                                  className="h-6 w-6 p-0 text-blood hover:text-white hover:bg-blood transition-colors"
                                                                >
                                                                  <Minus className="w-3 h-3" />
                                                                </Button>
                                                              </div>
                                                            ),
                                                          )}
                                                        </div>
                                                      )}
                                                      <Button
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={() =>
                                                          handleOpenOptionDialog(
                                                            choice,
                                                          )
                                                        }
                                                        className="w-full border-dashed border-gold/40 text-gold hover:bg-gold/10 hover:border-gold mt-2 font-bold tracking-widest uppercase text-[10px]"
                                                      >
                                                        <Plus className="w-3 h-3 mr-2" />{" "}
                                                        Choose Options
                                                      </Button>
                                                    </div>
                                                  </div>
                                                );
                                              },
                                            )}
                                        </>
                                      ) : (
                                        <div className="text-ink/40 font-serif italic text-sm py-4">
                                          No new features gained at this level.
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                );
                              },
                            )}
                          </div>

                          <div className="flex justify-center pt-4 pb-12">
                            <Button
                              className="btn-gold-solid font-bold uppercase tracking-widest px-6 py-2 shadow-sm transition-all active:translate-y-1 text-xs"
                              onClick={() => {
                                setCharacter((prev: any) => {
                                  const newProg =
                                    prev.progression ||
                                    (prev.classId
                                      ? Array.from({
                                          length: prev.level || 1,
                                        }).map((_, i) => ({
                                          className: prev.classId,
                                          level: i + 1,
                                        }))
                                      : []);
                                  if (newProg.length === 0) return prev;
                                  const lastClassEntry = newProg[newProg.length - 1];
                                  const lastClass = lastClassEntry.className;
                                  const currentClassLevel = newProg.filter(
                                    (p: any) =>
                                      p.classId === lastClassEntry.classId ||
                                      p.className === lastClass,
                                  ).length;
                                  return {
                                    ...prev,
                                    level: (prev.level || 1) + 1,
                                    progression: [
                                      ...newProg,
                                      {
                                        classId: lastClassEntry.classId,
                                        className: lastClass,
                                        subclassId: lastClassEntry.subclassId || "",
                                        level: currentClassLevel + 1,
                                      },
                                    ],
                                  };
                                });
                              }}
                            >
                              Level Up
                            </Button>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-background/50 p-8 rounded-xl border border-gold/10 h-full flex flex-col items-center justify-center text-center">
              <div className="w-24 h-24 bg-gold/5 rounded-full flex items-center justify-center mb-6 border border-gold/20">
                {STEPS.find((s) => s.id === activeStep)?.icon}
              </div>
              <h2 className="text-2xl font-serif font-black text-ink mb-2 uppercase tracking-tight">
                {STEPS.find((s) => s.id === activeStep)?.label}
              </h2>
              <p className="text-ink/60 max-w-sm font-serif italic mb-8">
                This workspace section is currently under construction. Please
                use the Character Sheet tab to manage core vitals and stats.
              </p>
              <Button
                onClick={() => setActiveStep("sheet")}
                variant="outline"
                className="border-gold/30 text-gold hover:bg-gold/5 uppercase tracking-widest text-xs font-black"
              >
                Return to Sheet
              </Button>
            </div>
          )}
        </div>

        {/* NAVIGATION RAIL - RESPONSIVE */}
        <div className="fixed bottom-0 left-0 right-0 z-40 lg:relative lg:bottom-auto lg:left-auto lg:right-auto lg:z-0 bg-background/95 backdrop-blur-md lg:bg-transparent border-t lg:border-none border-gold/10 p-2 sm:p-4 lg:p-0 lg:w-16 lg:pt-4">
          <div className="flex lg:flex-col items-center justify-between lg:justify-start gap-1 sm:gap-2 lg:gap-3 max-w-7xl mx-auto lg:sticky lg:top-24">
            {STEPS.map((step) => (
              <button
                key={step.id}
                onClick={() => {
                  setActiveStep(step.id);
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                title={step.label}
                className={`w-10 h-10 sm:w-12 sm:h-12 lg:w-14 lg:h-14 border-2 lg:border-4 flex items-center justify-center transition-all shadow-md active:scale-95 flex-shrink-0 ${
                  activeStep === step.id
                    ? "bg-gold text-white border-gold scale-110"
                    : "bg-card text-ink border-gold/20 hover:bg-gold/10"
                }`}
                style={{ borderRadius: "10px" }}
              >
                {React.cloneElement(
                  step.icon as React.ReactElement<{ className?: string }>,
                  { className: "w-4 h-4 sm:w-5 sm:h-5 lg:w-6 lg:h-6" },
                )}
              </button>
            ))}
            <div className="hidden lg:block h-4" />
            <button
              className="w-10 h-10 sm:w-12 sm:h-12 lg:w-14 lg:h-14 border-2 lg:border-4 bg-ink/5 border-ink/20 flex items-center justify-center text-ink/40 cursor-not-allowed flex-shrink-0"
              style={{ borderRadius: "10px" }}
            >
              <Settings className="w-4 h-4 sm:w-5 sm:h-5 lg:w-5 lg:h-5" />
            </button>
          </div>
        </div>
      </div>

      {optionDialogOpen && (
        <div className="fixed inset-0 bg-ink/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <Card className="max-w-4xl w-full max-h-[90vh] flex flex-col border-4 border-gold bg-background shadow-2xl overflow-hidden">
            <CardHeader className="border-b border-gold/20 flex flex-row items-center justify-between shrink-0">
              <div>
                <CardTitle className="font-serif text-2xl font-black text-ink">
                  {optionDialogOpen.name}
                </CardTitle>
                <CardDescription className="text-ink/60 font-bold uppercase text-[10px] tracking-widest mt-1">
                  AVAILABLE TO SELECT: {optionDialogOpen.count}
                </CardDescription>
              </div>
              <Button variant="ghost" onClick={() => setOptionDialogOpen(null)}>
                <Plus className="w-5 h-5 rotate-45" />
              </Button>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto p-0">
              {loadingOptions ? (
                <div className="p-8 text-center text-ink/50 font-serif italic">
                  Loading options...
                </div>
              ) : availableOptions.length === 0 ? (
                <div className="p-8 text-center text-ink/50 font-serif italic">
                  No options found for this feature.
                </div>
              ) : (
                <div className="divide-y divide-gold/10">
                  {availableOptions.map((opt) => {
                    if (!optionDialogOpen) return null;
                    const selectedForDialog =
                      getAdvancementSelectionValues(
                        selectedOptionsMap,
                        {
                          advancementId: optionDialogOpen.advId,
                          level: optionDialogOpen.level,
                          sourceScope: optionDialogOpen.sourceScope,
                          choiceId: optionDialogOpen.choiceId,
                        },
                      );
                    const isSelected = selectedForDialog.includes(opt.id);

                    // Check if this option was already chosen in OTHER levels for the same modular group
                    const allSelectionsForGroup = Object.entries(
                      selectedOptionsMap || {},
                    ).flatMap(([, val]: any) => {
                      // We need to know if the key belongs to an advancement with the same modular group
                      // Since we don't have a direct map easily in this render scope without extra lookups,
                      // we can check if the opt.id is present in ANY other selection, assuming opt.ids are unique enough
                      // or better yet, we check ALL selected options in the character state.
                      return val;
                    });

                    const isAlreadyChosenElsewhere = allSelectionsForGroup.includes(
                      opt.id,
                    ) && !isSelected;
                    
                    const isDisabled =
                      (!isSelected &&
                        selectedForDialog.length >=
                          optionDialogOpen.count) ||
                      (isAlreadyChosenElsewhere && !opt.isRepeatable);

                    return (
                      <div
                        key={opt.id}
                        className={`p-4 flex gap-4 hover:bg-gold/5 transition-colors ${isAlreadyChosenElsewhere && !opt.isRepeatable ? "opacity-50" : ""}`}
                      >
                        <div className="pt-1">
                          <button
                            disabled={isDisabled}
                            onClick={() => {
                              setCharacter((prev: any) => {
                                const previousSelectedOptions =
                                  buildCharacterSelectedOptionsMap(prev);
                                const current =
                                  getAdvancementSelectionValues(
                                    previousSelectedOptions,
                                    {
                                      sourceScope:
                                        optionDialogOpen.sourceScope,
                                      advancementId:
                                        optionDialogOpen.advId,
                                      level: optionDialogOpen.level,
                                      choiceId:
                                        optionDialogOpen.choiceId,
                                    },
                                  );
                                if (isSelected) {
                                  return updateCharacterAdvancementSelectionState(
                                    prev,
                                    {
                                      sourceScope:
                                        optionDialogOpen.sourceScope,
                                      advancementId:
                                        optionDialogOpen.advId,
                                      level: optionDialogOpen.level,
                                      choiceId:
                                        optionDialogOpen.choiceId,
                                    },
                                    current.filter(
                                      (i: string) => i !== opt.id,
                                    ),
                                  );
                                } else {
                                  if (current.length >= optionDialogOpen.count)
                                    return prev;
                                  return updateCharacterAdvancementSelectionState(
                                    prev,
                                    {
                                      sourceScope:
                                        optionDialogOpen.sourceScope,
                                      advancementId:
                                        optionDialogOpen.advId,
                                      level: optionDialogOpen.level,
                                      choiceId:
                                        optionDialogOpen.choiceId,
                                    },
                                    [...current, opt.id],
                                  );
                                }
                              });
                            }}
                            className={`w-6 h-6 rounded-md border-2 flex items-center justify-center transition-colors ${isSelected ? "bg-gold border-gold text-white" : "border-gold/40 hover:border-gold"} ${isDisabled ? "cursor-not-allowed" : ""}`}
                          >
                            {isSelected && <Check className="w-4 h-4" />}
                          </button>
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center justify-between">
                            <h4 className="font-serif font-bold text-ink text-lg text-balance">
                              {opt.name}
                              {isAlreadyChosenElsewhere && !opt.isRepeatable && (
                                <span className="ml-2 text-[10px] uppercase tracking-widest text-gold bg-gold/10 px-2 py-0.5 rounded">
                                  Already Selected
                                </span>
                              )}
                            </h4>
                          </div>
                          {opt.description && (
                            <div className="text-sm font-serif text-ink/70 mt-1 leading-relaxed">
                              <BBCodeRenderer content={opt.description} />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {isSelectingSubclass.open && (
        <div className="fixed inset-0 bg-ink/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <Card className="max-w-4xl w-full max-h-[90vh] flex flex-col border-4 border-gold bg-background shadow-2xl overflow-hidden">
            <CardHeader className="border-b border-gold/20 flex flex-row items-center justify-between shrink-0">
              <div>
                <CardTitle className="font-serif text-2xl font-black text-ink">
                  Select Subclass
                </CardTitle>
                <CardDescription className="text-ink/60 font-bold uppercase text-[10px] tracking-widest mt-1">
                  CHOOSE YOUR SPECIALIZATION
                </CardDescription>
              </div>
              <Button variant="ghost" onClick={() => setIsSelectingSubclass({ open: false, classId: "", level: 0 })}>
                <Plus className="w-5 h-5 rotate-45" />
              </Button>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto p-0">
              {availableSubclasses.length === 0 ? (
                <div className="p-8 text-center text-ink/50 font-serif italic">
                  No subclasses found for this class.
                </div>
              ) : (
                <div className="divide-y divide-gold/10">
                  {availableSubclasses.map((subclass) => (
                    <div key={subclass.id} className="p-4 flex flex-col sm:flex-row gap-4 hover:bg-gold/5 transition-colors">
                      <div className="flex-1">
                        <h4 className="font-serif font-bold text-ink text-lg text-balance">
                          {subclass.name}
                        </h4>
                        {subclass.description && (
                          <div className="text-sm font-serif text-ink/70 mt-1 leading-relaxed">
                            <BBCodeRenderer content={subclass.description} />
                          </div>
                        )}
                      </div>
                      <div className="sm:self-center shrink-0">
                        <Button
                          size="sm"
                        onClick={() => {
                          setCharacter((prev: any) => ({
                            ...prev,
                            progression: (prev.progression || []).map((entry: any) => {
                              const entryClassId = String(entry?.classId || "").trim();
                              const entryClassName = String(entry?.className || "").trim();
                              const targetClassId = String(isSelectingSubclass.classId || "").trim();
                              if (entryClassId === targetClassId || entryClassName === targetClassId) {
                                return {
                                  ...entry,
                                  subclassId: subclass.id,
                                };
                              }
                              return entry;
                            }),
                            subclassId: subclass.id,
                          }));
                          setIsSelectingSubclass({ open: false, classId: "", level: 0 });
                        }}
                          className="bg-emerald-600 border-emerald-500 text-white hover:bg-emerald-700 w-full sm:w-auto uppercase tracking-widest text-[10px] font-bold"
                        >
                          Select Path
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {showPointBuy && (
        <div className="fixed inset-0 bg-ink/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <Card className="max-w-md w-full border-4 border-gold bg-background shadow-2xl">
            <CardHeader className="border-b-2 border-gold/20">
              <CardTitle className="font-serif text-2xl font-black">
                Score Management
              </CardTitle>
              <CardDescription className="text-ink/60 font-bold uppercase text-[10px] tracking-widest">
                Point Buy & Standards
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6 pt-6">
              <div className="p-8 border-4 border-dashed border-ink/10 rounded-xl flex flex-col items-center justify-center text-center">
                <Edit2 className="w-10 h-10 text-gold mb-4" />
                <p className="text-ink/60 font-serif italic text-sm">
                  Ability score management logic is currently being finalized.
                  Please use the Â± controls on the sheet interface for now.
                </p>
              </div>
              <Button
                className="w-full bg-ink text-white hover:bg-gold transition-colors font-bold uppercase tracking-widest h-12"
                onClick={() => setShowPointBuy(false)}
              >
                Return to Sheet
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

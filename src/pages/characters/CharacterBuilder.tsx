import React, { useState, useEffect, useMemo, useCallback } from "react";
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
  ChevronDown,
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
import {
  collectGrantedSpellsFromAdvancementList,
  collectSpellListExtensionsFromAdvancementList,
  dedupeOwnedSpellGrants,
  dedupeSpellListExtensions,
} from "../../lib/spellGrants";
import { fetchClassSpellList } from "../../lib/classSpellLists";
import { fetchAllRules, spellMatchesRule, type SpellRule } from "../../lib/spellRules";
import { buildTagIndex } from "../../lib/tagHierarchy";
import { fetchSpellSummaries } from "../../lib/spellSummary";
import { deriveSpellFilterFacets } from "../../lib/spellFilters";
import { useSpellFilters } from "../../hooks/useSpellFilters";
import SpellFilterShell from "../../components/compendium/SpellFilterShell";
import SpellDetailPanel from "../../components/compendium/SpellDetailPanel";
import {
  buildCharacterEffectiveTagAttributions,
  characterMeetsSpellPrerequisites,
  missingPrerequisiteTags,
} from "../../lib/characterTags";
import { cn } from "../../lib/utils";

const getModifier = (score: number) => {
  const mod = Math.floor((score - 10) / 2);
  return mod >= 0 ? `+${mod}` : mod.toString();
};

// ── Point Buy (Dauligor variant) ────────────────────────────────────────────
// Extended 32-point pool, scores 8–16, on top of the standard cost
// curve. 1pt per score from 8→13, then a +2 jump at 14 and 15 (canonical
// 5e), then a +3 jump at 16 (the variant escalation that keeps a
// single 16 a real commitment — 12 of the 32 points). Applied via
// the PointBuyModal at the top of the sheet — flips
// character.stats.method to "point-buy" while active.
const POINT_BUY_BUDGET = 32;
const POINT_BUY_MIN = 8;
const POINT_BUY_MAX = 16;
const POINT_BUY_COSTS: Record<number, number> = {
  8: 0,
  9: 1,
  10: 2,
  11: 3,
  12: 4,
  13: 5,
  14: 7,
  15: 9,
  16: 12,
};
const pointBuyCost = (score: number): number => {
  if (!Number.isFinite(score)) return 0;
  const clamped = Math.max(POINT_BUY_MIN, Math.min(POINT_BUY_MAX, Math.round(score)));
  return POINT_BUY_COSTS[clamped] ?? 0;
};
const pointBuyTotal = (scores: Record<string, number>): number =>
  Object.values(scores).reduce((sum, s) => sum + pointBuyCost(s), 0);


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

  // D1 rows come back snake_case (`foundry_name`), but legacy/normalised data
  // sometimes carries `foundryName`. Match either.
  return (
    spellcastingTypes.find(
      (type) =>
        String(type.foundry_name || type.foundryName || "").trim().toLowerCase() === progressionName ||
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

// ─── PrepareSpellsModal — Phase 2 of the Spell Manager design handoff ──────
//
// Per-class focused prepare flow. Triggered from the class header
// "Prepare" button in the main Spell Manager tree (see CharacterBuilder
// activeStep === "spells" block) — closes back to the main tree on Done
// or backdrop click.
//
// Layout matches the Variant C design from the handoff:
//   - Header strip: class · prep-type badge · prepared / max · cantrips
//     / max · always count · Done button.
//   - 3-column body: Favourites (left, 240px) | filtered class pool
//     (middle, 1fr) | SpellDetailPanel (right, 360px).
//   - Filter row above the middle pool: search + Filters toggle +
//     active-count badge + reset. Inline filter panel with Level /
//     School / Source / Properties chip sections — local to the modal,
//     does NOT mutate the main spell manager's filter state.
//
// The modal mutates character state via the three handler props
// (onTogglePrepared / onTogglePlayerKnown / onToggleFavourite) — same
// handlers the main tree uses, so the two surfaces stay in sync.

type PrepareSpellsModalProps = {
  classId: string;
  className: string;
  preparationType: string;
  spellDC: number;
  spellAtk: string;
  cantripsCap: number | null;
  spellsCap: number | null;
  cantripsKnownCount: number;
  spellsKnownCount: number;
  pool: any[];
  ownedSpellMap: Map<string, any>;
  spellManagerSources: Array<{ id: string; name?: string; abbreviation?: string; shortName?: string }>;
  spellManagerTags: Array<{ id: string; name?: string; parentTagId?: string | null }>;
  effectiveTagSet: Set<string>;
  tagParentMap: Map<string, string | null>;
  onClose: () => void;
  onTogglePrepared: (spellId: string) => void;
  onTogglePlayerKnown: (id: string, level: number, requiredTags: string[]) => void;
  onToggleFavourite: (spellId: string) => void;
};

const PREPARATION_TYPE_LABELS: Record<string, string> = {
  always: "Always Prepared",
  innate: "Innate",
  pact: "Pact Magic",
  prepared: "Prepared Caster",
  spell: "Spellbook",
  ritual: "Ritual Only",
  leveled: "Leveled Caster",
};

function PrepareSpellsModal(props: PrepareSpellsModalProps) {
  const {
    classId,
    className,
    preparationType,
    spellDC,
    spellAtk,
    cantripsCap,
    spellsCap,
    cantripsKnownCount,
    spellsKnownCount,
    pool,
    ownedSpellMap,
    spellManagerSources,
    spellManagerTags,
    effectiveTagSet,
    tagParentMap,
    onClose,
    onTogglePrepared,
    onTogglePlayerKnown,
    onToggleFavourite,
  } = props;

  const [search, setSearch] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [lvlF, setLvlF] = useState<number[]>([]);
  const [schoolF, setSchoolF] = useState<string[]>([]);
  const [sourceF, setSourceF] = useState<string[]>([]);
  const [propF, setPropF] = useState<string[]>([]);
  const [selId, setSelId] = useState<string | null>(pool[0]?.id ?? null);

  const sourceById = useMemo(
    () => Object.fromEntries(spellManagerSources.map((s) => [s.id, s])),
    [spellManagerSources],
  );

  const sourcesInPool = useMemo(
    () => Array.from(new Set(pool.map((s) => s.source_id).filter(Boolean))) as string[],
    [pool],
  );
  const schoolsInPool = useMemo(
    () => Array.from(new Set(pool.map((s) => s.school).filter(Boolean))) as string[],
    [pool],
  );

  const toggleIn = <T,>(v: T, list: T[], setList: (l: T[]) => void) => {
    setList(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  };

  // Tag lookup so the modal can render prereq-locked rows with a
  // human-readable "Needs: X, Y" tooltip when an unprepared spell would
  // otherwise be picked.
  const tagsById = useMemo(
    () => Object.fromEntries(spellManagerTags.map((t) => [t.id, t])),
    [spellManagerTags],
  );

  // Local row filter — `propF` carries spell-state flags ("ritual" /
  // "concentration" / "known" / "prepared"). The first two read from the
  // spell facet flags (computed at load time); the latter two cross-
  // reference the ownedSpellMap so "prepared only" hides everything the
  // character hasn't actually committed to.
  const filteredPool = useMemo(() => {
    const q = search.trim().toLowerCase();
    return pool.filter((s) => {
      if (q && !String(s.name || "").toLowerCase().includes(q)) return false;
      if (lvlF.length && !lvlF.includes(Number(s.level ?? 0))) return false;
      if (schoolF.length && !schoolF.includes(String(s.school || ""))) return false;
      if (sourceF.length && !sourceF.includes(String(s.source_id || ""))) return false;
      if (propF.length) {
        const owned = ownedSpellMap.get(s.id);
        for (const p of propF) {
          if (p === "ritual" && !s.ritual && !s.foundryShell?.ritual) return false;
          if (p === "concentration" && !s.concentration && !s.foundryShell?.concentration) return false;
          if (p === "known" && !owned) return false;
          if (p === "prepared" && !owned?.isPrepared && !owned?.isAlwaysPrepared) return false;
        }
      }
      return true;
    });
  }, [pool, search, lvlF, schoolF, sourceF, propF, ownedSpellMap]);

  const groupedPool = useMemo(() => {
    const m = new Map<number, any[]>();
    filteredPool.forEach((s) => {
      const lv = Number(s.level ?? 0);
      if (!m.has(lv)) m.set(lv, []);
      m.get(lv)!.push(s);
    });
    return Array.from(m.entries()).sort((a, b) => a[0] - b[0]);
  }, [filteredPool]);

  const favList = useMemo(
    () => pool.filter((s) => ownedSpellMap.get(s.id)?.isFavourite),
    [pool, ownedSpellMap],
  );

  const activeFilters = lvlF.length + schoolF.length + sourceF.length + propF.length;
  const resetFilters = () => {
    setLvlF([]);
    setSchoolF([]);
    setSourceF([]);
    setPropF([]);
  };

  // Per-class counters — same shape as the main header strip but scoped to
  // THIS class's spell pool.
  const preparedHere = useMemo(
    () => pool.filter((s) => {
      const o = ownedSpellMap.get(s.id);
      return o?.isPrepared && !o?.isAlwaysPrepared;
    }).length,
    [pool, ownedSpellMap],
  );
  const alwaysHere = useMemo(
    () => pool.filter((s) => ownedSpellMap.get(s.id)?.isAlwaysPrepared).length,
    [pool, ownedSpellMap],
  );

  const prepTypeLabel = PREPARATION_TYPE_LABELS[preparationType] || preparationType;

  const selected = useMemo(
    () => (selId ? pool.find((s) => s.id === selId) || null : null),
    [pool, selId],
  );

  // Per-spell prereq + cap blocking. The main tree's togglePlayerKnown
  // already enforces these (silently no-ops when blocked); we re-check
  // here so the row can disable the + button + render a "Locked" hint.
  const blockedFor = (spell: any) => {
    const owned = ownedSpellMap.get(spell.id);
    if (owned) return { prereqBlocked: false, capBlocked: false, missingTags: [] as string[] };
    const isGranted = !!owned?.grantedByAdvancementId;
    if (isGranted) return { prereqBlocked: false, capBlocked: false, missingTags: [] as string[] };
    const requiredTags = Array.isArray(spell.requiredTags) ? spell.requiredTags : [];
    const missingTags = requiredTags.length === 0
      ? []
      : requiredTags.filter((tid: string) => {
          if (effectiveTagSet.has(tid)) return false;
          // Climb the parent chain — `Conjure.Manifest` satisfies a
          // `Conjure` prereq. Mirrors `missingPrerequisiteTags` in
          // characterTags.ts.
          let cursor: string | null | undefined = tid;
          while (cursor) {
            if (effectiveTagSet.has(cursor)) return false;
            cursor = tagParentMap.get(cursor) ?? null;
          }
          return true;
        });
    const prereqBlocked = missingTags.length > 0;
    const lv = Number(spell.level ?? 0);
    const capBlocked =
      (lv === 0 && cantripsCap !== null && cantripsKnownCount >= cantripsCap) ||
      (lv > 0 && spellsCap !== null && spellsKnownCount >= spellsCap);
    return { prereqBlocked, capBlocked, missingTags };
  };

  const renderPoolRow = (spell: any, opts: { showFav?: boolean } = {}) => {
    const { showFav = true } = opts;
    const owned = ownedSpellMap.get(spell.id);
    const isAlways = !!owned?.isAlwaysPrepared;
    const isGranted = !!owned?.grantedByAdvancementId;
    const isKnown = !!owned;
    const isPrepared = !!owned?.isPrepared;
    const isFav = !!owned?.isFavourite;
    const isSelected = selId === spell.id;
    const sourceLabel = sourceById[spell.source_id || ""]?.abbreviation
      || sourceById[spell.source_id || ""]?.shortName
      || "";
    const { prereqBlocked, capBlocked, missingTags } = blockedFor(spell);
    const requiredTags = Array.isArray(spell.requiredTags) ? spell.requiredTags : [];

    return (
      <div
        key={spell.id}
        onClick={() => setSelId(spell.id)}
        className={cn(
          "grid items-center cursor-pointer border-b border-gold/5 transition-colors",
          isSelected
            ? "bg-gold/10 border-l-[3px] border-l-gold"
            : "border-l-[3px] border-l-transparent hover:bg-gold/5",
        )}
        style={{
          gridTemplateColumns: showFav
            ? "22px minmax(0,1fr) 40px 28px 20px"
            : "22px minmax(0,1fr) 40px 28px",
          padding: "6px 10px",
        }}
      >
        <div>
          {isAlways ? (
            <span className="text-emerald-500 text-sm font-black" title="Always prepared">✦</span>
          ) : isGranted ? (
            <span className="text-emerald-600 text-sm font-black" title="Granted by an advancement">✓</span>
          ) : isKnown ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onTogglePrepared(spell.id);
              }}
              title={isPrepared ? "Unprepare" : "Prepare"}
              className={cn(
                "w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center",
                isPrepared ? "border-gold bg-gold text-white" : "border-gold/40 hover:border-gold",
              )}
            >
              {isPrepared && <Check className="w-2 h-2" />}
            </button>
          ) : (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (prereqBlocked || capBlocked) return;
                onTogglePlayerKnown(spell.id, Number(spell.level ?? 0), requiredTags);
              }}
              disabled={prereqBlocked || capBlocked}
              title={
                prereqBlocked
                  ? `Missing: ${missingTags
                      .map((tid) => tagsById[tid]?.name || tid)
                      .join(", ")}`
                  : capBlocked
                    ? Number(spell.level ?? 0) === 0
                      ? `At cantrips-known cap (${cantripsCap})`
                      : `At spells-known cap (${spellsCap})`
                    : "Add to known"
              }
              className={cn(
                "w-3.5 h-3.5 flex items-center justify-center text-[11px] leading-none border border-dashed",
                prereqBlocked || capBlocked
                  ? "border-blood/25 text-blood/35 cursor-not-allowed"
                  : "border-gold/30 text-gold/55 hover:border-gold/60 hover:text-gold",
              )}
            >
              +
            </button>
          )}
        </div>
        <span
          className={cn(
            "font-serif text-sm truncate flex items-center gap-1.5",
            isSelected ? "font-bold text-ink" : isKnown ? "font-medium text-ink" : "font-medium text-ink/40",
          )}
        >
          <span className="truncate">{spell.name}</span>
          {prereqBlocked && (
            <span
              className="text-[9px] font-bold uppercase tracking-widest text-blood/70 shrink-0"
              title={`Requires: ${missingTags
                .map((tid) => tagsById[tid]?.name || tid)
                .join(", ")}`}
            >
              ⚷
            </span>
          )}
        </span>
        <span
          className="text-[8px] font-black uppercase tracking-[0.06em] text-gold/65 truncate"
          title={String(spell.school || "")}
        >
          {String(spell.school || "").slice(0, 4)}
        </span>
        <span className="text-[7px] font-bold uppercase tracking-widest text-ink/35 truncate">
          {sourceLabel}
        </span>
        {showFav && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavourite(spell.id);
            }}
            title={isFav ? "Unfavourite" : "Favourite"}
            className={cn(
              "text-sm leading-none transition-colors",
              isFav ? "text-amber-500" : "text-ink/20 hover:text-amber-500",
            )}
          >
            ★
          </button>
        )}
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex bg-black/55 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex-1 max-w-[1400px] mx-auto flex flex-col bg-card border border-gold shadow-2xl overflow-hidden"
      >
        {/* Modal header */}
        <div
          className="flex items-center gap-4 px-4 py-3 border-b border-gold shrink-0"
          style={{ background: "#efe6cf" }}
        >
          <div className="flex flex-col gap-1 min-w-0">
            <div className="flex items-baseline gap-3 flex-wrap">
              <h3 className="font-serif text-xl font-bold text-ink leading-none">
                Prepare Spells
              </h3>
              <span className="font-serif text-sm italic text-ink/55">
                · {className}
              </span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[9px] font-black uppercase tracking-[0.14em] px-1.5 py-0.5 border border-gold text-gold bg-gold/10">
                {prepTypeLabel}
              </span>
              <span className="font-mono text-[10px] text-ink/60">
                DC {spellDC} · Atk {spellAtk}
              </span>
            </div>
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-4">
            {cantripsCap !== null && (
              <div className="text-right">
                <div className="text-[7px] font-black uppercase tracking-[0.16em] text-ink/45">
                  Cantrips
                </div>
                <div className="font-mono text-base font-black text-gold leading-none">
                  {cantripsKnownCount}
                  <span className="text-ink/40 text-xs"> / {cantripsCap}</span>
                </div>
              </div>
            )}
            <div className="text-right">
              <div className="text-[7px] font-black uppercase tracking-[0.16em] text-ink/45">
                Prepared
              </div>
              <div className="font-mono text-base font-black text-gold leading-none">
                {preparedHere}
                {spellsCap !== null && (
                  <span className="text-ink/40 text-xs"> / {spellsCap}</span>
                )}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[7px] font-black uppercase tracking-[0.16em] text-ink/45">
                Always
              </div>
              <div className="font-mono text-base font-black text-emerald-600 leading-none">
                {alwaysHere}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-[10px] font-black uppercase tracking-widest px-3 py-1.5 border border-gold bg-gold text-white hover:bg-gold/90"
            >
              Done
            </button>
          </div>
        </div>

        {/* 3-col body */}
        <div
          className="flex-1 grid overflow-hidden"
          style={{ gridTemplateColumns: "240px minmax(0,1fr) 360px" }}
        >
          {/* LEFT — Favourites */}
          <div className="flex flex-col border-r border-gold/15 bg-gold/[0.03] overflow-hidden">
            <div className="px-3 py-2 border-b border-gold/15 flex items-center gap-2 shrink-0">
              <Star className="w-3 h-3 text-gold" />
              <span className="text-[9px] font-black uppercase tracking-[0.18em] text-ink/60">
                Favourites
              </span>
              <span className="flex-1" />
              <span className="font-mono text-[9px] font-bold text-ink/40">
                {favList.length}
              </span>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar">
              {favList.length === 0 ? (
                <div className="px-3 py-10 text-center">
                  <div className="text-2xl text-gold/25 mb-1">★</div>
                  <div className="font-serif italic text-[11px] text-ink/45 leading-relaxed">
                    Star spells in the middle column to pin them here for fast access.
                  </div>
                </div>
              ) : (
                favList.map((spell) => renderPoolRow(spell, { showFav: false }))
              )}
            </div>
          </div>

          {/* MIDDLE — class spell pool */}
          <div className="flex flex-col border-r border-gold/15 overflow-hidden">
            <div className="px-3 py-2 border-b border-gold/15 flex items-center gap-2 shrink-0">
              <span className="text-[9px] font-black uppercase tracking-[0.18em] text-ink/60">
                {className} Spell List
              </span>
              <span className="flex-1" />
              <span className="font-mono text-[9px] font-bold text-ink/40">
                {filteredPool.length}
                {filteredPool.length !== pool.length && (
                  <span className="text-ink/25"> / {pool.length}</span>
                )}
              </span>
            </div>
            <div className="px-3 py-2 border-b border-gold/10 flex items-center gap-2 shrink-0">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search spell name…"
                className="flex-1 min-w-0 text-[12px] px-2 py-1 border border-gold/25 bg-gold/[0.04] outline-none focus:border-gold/60 text-ink rounded-sm"
              />
              <button
                type="button"
                onClick={() => setFilterOpen((o) => !o)}
                className={cn(
                  "flex items-center gap-1.5 px-2 py-1 text-[9px] font-black uppercase tracking-[0.12em] border transition-colors",
                  filterOpen || activeFilters > 0
                    ? "border-gold bg-gold/15 text-gold"
                    : "border-gold/25 text-ink/55 hover:border-gold/50",
                )}
              >
                Filters
                {activeFilters > 0 && (
                  <span className="font-mono text-[8px] px-1 py-px bg-gold text-white rounded-sm">
                    {activeFilters}
                  </span>
                )}
              </button>
              {activeFilters > 0 && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="text-[8px] font-black uppercase tracking-widest text-blood hover:underline"
                >
                  ✕ Reset
                </button>
              )}
            </div>
            {filterOpen && (
              <div className="px-3 py-3 border-b border-gold/10 bg-gold/[0.03] max-h-52 overflow-y-auto custom-scrollbar shrink-0 space-y-3">
                <FilterChipSection
                  title="Level"
                  options={[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((l) => ({
                    v: l,
                    l: l === 0 ? "Cantrip" : `Level ${l}`,
                  }))}
                  selected={lvlF}
                  onToggle={(v) => toggleIn<number>(v, lvlF, setLvlF)}
                  onAll={() => setLvlF([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])}
                  onClear={() => setLvlF([])}
                />
                {schoolsInPool.length > 0 && (
                  <FilterChipSection
                    title="School"
                    options={schoolsInPool.map((k) => ({ v: k, l: String(k).toUpperCase() }))}
                    selected={schoolF}
                    onToggle={(v) => toggleIn<string>(v, schoolF, setSchoolF)}
                    onAll={() => setSchoolF([...schoolsInPool])}
                    onClear={() => setSchoolF([])}
                  />
                )}
                {sourcesInPool.length > 0 && (
                  <FilterChipSection
                    title="Source"
                    options={sourcesInPool.map((sid) => ({
                      v: sid,
                      l:
                        sourceById[sid]?.abbreviation ||
                        sourceById[sid]?.shortName ||
                        sourceById[sid]?.name ||
                        sid,
                    }))}
                    selected={sourceF}
                    onToggle={(v) => toggleIn<string>(v, sourceF, setSourceF)}
                    onAll={() => setSourceF([...sourcesInPool])}
                    onClear={() => setSourceF([])}
                  />
                )}
                <FilterChipSection
                  title="Properties"
                  options={[
                    { v: "ritual", l: "Ritual" },
                    { v: "concentration", l: "Concentration" },
                    { v: "known", l: "Known" },
                    { v: "prepared", l: "Prepared" },
                  ]}
                  selected={propF}
                  onToggle={(v) => toggleIn<string>(v, propF, setPropF)}
                  onAll={() => setPropF(["ritual", "concentration", "known", "prepared"])}
                  onClear={() => setPropF([])}
                />
              </div>
            )}
            <div className="flex-1 overflow-y-auto custom-scrollbar">
              {groupedPool.length === 0 ? (
                <div className="px-4 py-14 text-center text-ink/45 font-serif italic text-sm">
                  No spells match.
                </div>
              ) : (
                groupedPool.map(([lv, spells]) => (
                  <div key={lv}>
                    <div className="px-3 py-1.5 border-b border-gold/10 bg-gold/[0.04] flex items-center gap-2">
                      <span className="text-[9px] font-black uppercase tracking-[0.16em] text-ink/50">
                        {lv === 0 ? "Cantrips" : `Level ${lv}`}
                      </span>
                      <span className="flex-1" />
                      <span className="font-mono text-[8px] font-bold text-ink/30">
                        {spells.length}
                      </span>
                    </div>
                    {spells.map((spell) => renderPoolRow(spell))}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* RIGHT — detail */}
          <div className="overflow-hidden">
            <SpellDetailPanel
              spellId={selId}
              emptyMessage="Select a spell to see its details."
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// Filter chip section used by PrepareSpellsModal. Single-shot
// multi-select with Include All / Clear shortcuts on the right —
// mirrors the FilterChipSection pattern from the design handoff's
// spell-manager.jsx (Variant C inline-filter panel).
function FilterChipSection<T extends string | number>(props: {
  title: string;
  options: Array<{ v: T; l: string }>;
  selected: T[];
  onToggle: (v: T) => void;
  onAll: () => void;
  onClear: () => void;
}) {
  const { title, options, selected, onToggle, onAll, onClear } = props;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-black uppercase tracking-[0.18em] text-ink/55">
          {title}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onAll}
            className="text-[8px] font-black uppercase tracking-widest text-ink/45 hover:text-ink/70"
          >
            Include All
          </button>
          <span className="text-gold/30">|</span>
          <button
            type="button"
            onClick={onClear}
            className="text-[8px] font-black uppercase tracking-widest text-ink/45 hover:text-ink/70"
          >
            Clear
          </button>
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        {options.map(({ v, l }) => {
          const active = selected.includes(v);
          return (
            <button
              key={String(v)}
              type="button"
              onClick={() => onToggle(v)}
              className={cn(
                "px-2 py-1 text-[9px] font-bold border transition-colors rounded-sm",
                active
                  ? "border-gold bg-gold text-white"
                  : "border-gold/25 text-ink/60 hover:border-gold/50",
              )}
            >
              {l}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Point Buy modal ────────────────────────────────────────────────────────
// Standalone modal so it can manage its own draft state via hooks (the
// outer CharacterBuilder render path is too heavy to react cleanly to a
// dozen extra useState calls). Receives an initial score map, returns
// the chosen scores via onApply.
function PointBuyModal({
  attributes,
  attrIdentifiers,
  initialScores,
  onApply,
  onClose,
}: {
  attributes: any[];
  attrIdentifiers: string[];
  initialScores: Record<string, number>;
  onApply: (scores: Record<string, number>) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Record<string, number>>(initialScores);

  const total = pointBuyTotal(draft);
  const remaining = POINT_BUY_BUDGET - total;
  const overBudget = remaining < 0;

  const attrName = (identifier: string): string => {
    const found = attributes.find((a: any) => String(a.identifier || a.id).toUpperCase() === identifier.toUpperCase());
    return found?.name || identifier;
  };

  const setScore = (id: string, score: number) => {
    setDraft((prev) => ({
      ...prev,
      [id]: Math.max(POINT_BUY_MIN, Math.min(POINT_BUY_MAX, score)),
    }));
  };

  const inc = (id: string) => {
    const current = draft[id] ?? POINT_BUY_MIN;
    if (current >= POINT_BUY_MAX) return;
    const nextScore = current + 1;
    // Would the new total fit? Compute incremental cost (cost@next -
    // cost@current) instead of recomputing whole pool.
    const delta = pointBuyCost(nextScore) - pointBuyCost(current);
    if (total + delta > POINT_BUY_BUDGET) return;
    setScore(id, nextScore);
  };
  const dec = (id: string) => {
    const current = draft[id] ?? POINT_BUY_MIN;
    if (current <= POINT_BUY_MIN) return;
    setScore(id, current - 1);
  };

  const reset = () => {
    const next: Record<string, number> = {};
    for (const id of attrIdentifiers) next[id] = POINT_BUY_MIN;
    setDraft(next);
  };

  const apply = () => {
    // Belt-and-braces: don't let an over-budget draft escape the modal.
    if (overBudget) return;
    onApply(draft);
  };

  return (
    <div
      // bg-black/* is theme-stable. The previous bg-ink/80 inverted in
      // dark mode (where --ink is light) — that's the "bright white"
      // overlay users were hitting.
      className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl bg-background border-4 border-gold shadow-2xl rounded-lg overflow-hidden"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b-2 border-gold/20 flex items-center gap-4">
          <div className="flex-1 min-w-0">
            <h2 className="font-serif text-2xl font-black text-ink uppercase tracking-tight">
              Point Buy
            </h2>
            <p className="text-[10px] font-bold uppercase tracking-widest text-ink/55 mt-1">
              Dauligor variant · 32 points · scores 8–16
            </p>
          </div>
          <div className="text-right">
            <div className="text-[9px] font-black uppercase tracking-[0.16em] text-ink/45">
              Remaining
            </div>
            <div
              className={cn(
                "font-mono text-3xl font-black leading-none",
                overBudget ? "text-blood" : remaining === 0 ? "text-emerald-600" : "text-gold",
              )}
            >
              {remaining}
              <span className="text-sm text-ink/35 font-bold"> / {POINT_BUY_BUDGET}</span>
            </div>
          </div>
        </div>

        {/* Ability rows */}
        <div className="p-6 space-y-2">
          {attrIdentifiers.map((id) => {
            const score = draft[id] ?? POINT_BUY_MIN;
            const cost = pointBuyCost(score);
            const modN = Math.floor((score - 10) / 2);
            const modLabel = modN >= 0 ? `+${modN}` : `${modN}`;
            const atMin = score <= POINT_BUY_MIN;
            const atMax = score >= POINT_BUY_MAX;
            const nextScore = score + 1;
            const nextCostDelta = nextScore <= POINT_BUY_MAX
              ? pointBuyCost(nextScore) - cost
              : 0;
            const blockedNext = atMax || total + nextCostDelta > POINT_BUY_BUDGET;

            return (
              <div
                key={id}
                className="flex items-center gap-4 p-3 border border-gold/20 bg-card/50 rounded-md"
              >
                <div className="w-12 shrink-0">
                  <div className="text-[9px] font-black uppercase tracking-widest text-ink/45">
                    {id}
                  </div>
                  <div className="text-[10px] font-bold text-ink/60 truncate">
                    {attrName(id)}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => dec(id)}
                    disabled={atMin}
                    aria-label={`Decrease ${id}`}
                    className={cn(
                      "w-8 h-8 rounded-md border flex items-center justify-center transition-colors",
                      atMin
                        ? "border-gold/10 text-ink/15 cursor-not-allowed"
                        : "border-gold/30 text-gold hover:bg-gold/10",
                    )}
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <div className="w-14 text-center">
                    <div className="font-mono text-2xl font-black text-ink leading-none">
                      {score}
                    </div>
                    <div className="text-[10px] font-bold text-ink/45 mt-0.5">
                      {modLabel}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => inc(id)}
                    disabled={blockedNext}
                    aria-label={`Increase ${id}`}
                    title={
                      atMax
                        ? `Max ${POINT_BUY_MAX}`
                        : total + nextCostDelta > POINT_BUY_BUDGET
                          ? "Not enough points"
                          : `Costs ${nextCostDelta} more`
                    }
                    className={cn(
                      "w-8 h-8 rounded-md border flex items-center justify-center transition-colors",
                      blockedNext
                        ? "border-gold/10 text-ink/15 cursor-not-allowed"
                        : "border-gold/30 text-gold hover:bg-gold/10",
                    )}
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>

                {/* Cost track — pip-style visualisation of the 12 max
                    points-per-ability under the Dauligor 32-point
                    variant. Two visible tier breaks:
                      - pips 0..4 (gold)     cheap tier: 8 → 13 (+1 each)
                      - pips 5..8 (blood/70) double tier: 14 → 15 (+2 each)
                      - pips 9..11 (blood)   triple tier: 16 (+3) */}
                <div className="flex-1 min-w-0 flex items-center gap-2">
                  <div className="flex-1 flex items-center gap-0.5">
                    {Array.from({ length: 12 }).map((_, i) => {
                      const filled = i < cost;
                      const tier = i < 5 ? "cheap" : i < 9 ? "double" : "triple";
                      return (
                        <span
                          key={i}
                          className={cn(
                            "h-1.5 flex-1 rounded-sm transition-colors",
                            filled
                              ? tier === "cheap"
                                ? "bg-gold"
                                : tier === "double"
                                  ? "bg-blood/70"
                                  : "bg-blood"
                              : tier === "cheap"
                                ? "bg-gold/15"
                                : tier === "double"
                                  ? "bg-blood/10"
                                  : "bg-blood/15",
                          )}
                        />
                      );
                    })}
                  </div>
                  <span className="font-mono text-[10px] font-bold text-ink/55 shrink-0 w-10 text-right">
                    {cost} pt
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t-2 border-gold/20 bg-card/30 flex items-center justify-between gap-3 flex-wrap">
          <button
            type="button"
            onClick={reset}
            className="text-[10px] font-bold uppercase tracking-widest text-ink/55 hover:text-blood transition-colors"
          >
            Reset to 8s
          </button>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="border-gold/30 text-ink/70 hover:bg-gold/5 uppercase tracking-widest text-xs font-black"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={apply}
              disabled={overBudget}
              className={cn(
                "uppercase tracking-widest text-xs font-black",
                overBudget
                  ? "bg-blood/30 text-blood/60 cursor-not-allowed"
                  : "bg-gold text-white hover:bg-gold/90",
              )}
            >
              {overBudget ? "Over Budget" : remaining === 0 ? "Apply (All Spent)" : `Apply (${remaining} unspent)`}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
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
  { id: "spells", label: "Spell Manager", icon: <Zap className="w-4 h-4" /> },
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
  // Spellbook Manager (Layer 2): lazily loaded id→{name, level, school} for any
  // spell IDs surfaced by GrantSpells / ExtendSpellList advancements. Avoids
  // pulling the full 5k-row spell catalog into builder context.
  const [spellNameCache, setSpellNameCache] = useState<Record<string, any>>({});
  // Spell Manager step: per-class spell pool (master list joined with spell row).
  // Loaded on first entry to the step for each spellcasting class.
  const [classSpellPools, setClassSpellPools] = useState<Record<string, any[]>>({});
  const [activeSpellManagerClassId, setActiveSpellManagerClassId] = useState<string>("");
  // Phase 4 / Layer 4 — per-character filter toggles (orthogonal to spell-state filters).
  const [showFavouritesOnly, setShowFavouritesOnly] = useState(false);
  const [showWatchlistOnly, setShowWatchlistOnly] = useState(false);
  const [showLoadoutOnly, setShowLoadoutOnly] = useState(false);
  // Foundation data for the Spell Manager filter shell + detail pane.
  // Loaded once when the step opens.
  const [spellManagerSources, setSpellManagerSources] = useState<any[]>([]);
  const [spellManagerTags, setSpellManagerTags] = useState<any[]>([]);
  const [spellManagerTagGroups, setSpellManagerTagGroups] = useState<any[]>([]);
  const [selectedSpellId, setSelectedSpellId] = useState<string | null>(null);
  const spellManagerFilters = useSpellFilters();
  // Variant C (Spell Manager redesign) — tree-collapse state + Prepare modal trigger.
  // `spellsCollapsedClasses` keeps a Set of class IDs whose section in the
  // left tree is collapsed; same with `spellsCollapsedLevels` for the per-
  // class level sub-headers (key shape: `${classId}:${level}`). The Prepare
  // button on each class header opens a focused modal scoped to that class
  // — `spellsPrepModalClass` holds the open class id, or null when closed.
  const [spellsCollapsedClasses, setSpellsCollapsedClasses] = useState<Set<string>>(new Set());
  const [spellsCollapsedLevels, setSpellsCollapsedLevels] = useState<Set<string>>(new Set());
  const [spellsPrepModalClass, setSpellsPrepModalClass] = useState<string | null>(null);
  // Layer 2 rule resolver (Phase 1b.5b): all defined spell rules + the slim
  // spell catalog. Loaded on demand the first time a rule-resolver advancement
  // appears in the visible progression. spellSummaries is the slim projection
  // (cached in PERSISTENT_TABLES so the cost is one fetch per session).
  const [spellRulesById, setSpellRulesById] = useState<Record<string, SpellRule>>({});
  const [allSpellSummaries, setAllSpellSummaries] = useState<any[] | null>(null);

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

  // Spellbook Manager (Layer 2): GrantSpells choice-mode picker. Stores the
  // advancement reference, not a frozen pool snapshot — pool is re-resolved
  // at dialog render time so it picks up rules loading after the click.
  const [spellChoiceDialogOpen, setSpellChoiceDialogOpen] = useState<{
    name: string;
    count: number;
    advId: string;
    level: number;
    sourceScope: string;
    resolverKind: "explicit" | "rule";
    explicitSpellIds: string[];
    ruleId: string;
  } | null>(null);

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
          const [baseRows, progressionRows, selectionRows, inventoryRows, spellRows, proficiencyRows, extensionRows, loadoutRows] = await Promise.all([
            queryD1("SELECT * FROM characters WHERE id = ?", [id]),
            queryD1("SELECT * FROM character_progression WHERE character_id = ?", [id]),
            queryD1("SELECT * FROM character_selections WHERE character_id = ?", [id]),
            queryD1("SELECT * FROM character_inventory WHERE character_id = ?", [id]),
            queryD1("SELECT * FROM character_spells WHERE character_id = ?", [id]),
            queryD1("SELECT * FROM character_proficiencies WHERE character_id = ?", [id]),
            queryD1("SELECT * FROM character_spell_list_extensions WHERE character_id = ?", [id]),
            queryD1("SELECT * FROM character_spell_loadouts WHERE character_id = ?", [id])
          ]);

          if (baseRows && baseRows.length > 0) {
            const data = rebuildCharacterFromSql(
              baseRows[0],
              progressionRows,
              selectionRows,
              inventoryRows,
              spellRows,
              proficiencyRows,
              extensionRows,
              loadoutRows
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

      // Notify the Sidebar (and anything else listening) that the
      // user's character list may have changed so the recent-
      // characters sub-list refreshes without a page reload. Cheap
      // — the sidebar's listener just runs one indexed D1 query.
      window.dispatchEvent(new Event("characterListUpdated"));

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

  const spellcastingClassIds = uniqueStringList(
    progressionClassGroups
      .map((entry: any) => {
        const doc = entry.classDocument || classCache[entry?.classId || ""];
        // Canonical flag (see ClassEditor / classExport). `progression` is a
        // legacy string-only path; modern records carry hasSpellcasting + a
        // progressionId pointing at a spellcasting-type document.
        return doc?.spellcasting?.hasSpellcasting ? doc?.id : "";
      })
      .filter(Boolean) as string[],
  );

  // Detect whether the visible progression carries any rule-resolver
  // advancement. If yes, lazy-load rules + spell summaries so we can resolve
  // them. Walks classes/subclasses/features at the levels the character has.
  const needsRuleResolution = useMemo(() => {
    const hasRuleResolver = (advs: any[]): boolean =>
      Array.isArray(advs) &&
      advs.some(
        (a: any) =>
          (a?.type === "GrantSpells" || a?.type === "ExtendSpellList") &&
          a?.configuration?.resolver?.kind === "rule" &&
          a?.configuration?.resolver?.ruleId,
      );
    return progressionClassGroups.some((entry: any) => {
      const cls = entry.classDocument || classCache[entry?.classId || ""];
      const sub = entry.subclassId ? subclassCache[entry.subclassId] : null;
      const lvl = Number(entry.classLevel || 0) || 0;
      if (hasRuleResolver(cls?.advancements)) return true;
      if (hasRuleResolver(sub?.advancements)) return true;
      const featureLists = [
        ...(featureCache[cls?.id] || []),
        ...(sub ? featureCache[sub.id] || [] : []),
      ].filter((f: any) => (Number(f.level || 1) || 1) <= lvl);
      return featureLists.some((f: any) => hasRuleResolver(f?.advancements));
    });
  }, [progressionClassGroups, classCache, subclassCache, featureCache]);

  // Load rules + spell summaries the first time we detect rule-resolver usage.
  // Once allSpellSummaries is non-null, both have been fetched (even if rules
  // is empty — the empty-rules case must not re-fire infinitely).
  useEffect(() => {
    if (!needsRuleResolution) return;
    if (allSpellSummaries !== null) return;
    let cancelled = false;
    (async () => {
      try {
        const [rules, summaries] = await Promise.all([
          fetchAllRules(),
          fetchSpellSummaries(),
        ]);
        if (cancelled) return;
        setSpellRulesById(Object.fromEntries(rules.map((r) => [r.id, r])));
        setAllSpellSummaries(summaries);
      } catch (err) {
        console.error("Failed to load spell rules / summaries for rule resolver", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [needsRuleResolution, allSpellSummaries]);

  // Pre-derive filter facets (activation/range/duration buckets, property
  // booleans) once so spellMatchesRule can read them. fetchSpellSummaries
  // returns raw rows — derived facets aren't in the slim projection.
  const facetEnrichedSpellSummaries = useMemo(() => {
    if (!allSpellSummaries) return null;
    return allSpellSummaries.map((s: any) => ({
      ...s,
      tags: Array.isArray(s.tags) ? s.tags : [],
      ...deriveSpellFilterFacets(s),
    }));
  }, [allSpellSummaries]);

  // Memoised ruleId → matched spell IDs. Re-derives when rules or summaries
  // change. Each rule walks the full catalog once; for ~5k spells this is
  // fast enough for client-side derivation. Manual spells from the rule's
  // `manualSpells` always-include list are merged in by `spellMatchesRule`.
  // Tag-hierarchy index required by spellMatchesRule for any rule
  // that uses rich tagStates (per-group AND/OR/XOR chip semantics).
  // Without this, the matcher's defensive fallback in
  // matchSpellAgainstRule returns true for every spell — which means
  // character spell pools would include the entire catalogue for any
  // rule built with the rich tag-filter UI. (Subtle bug: legacy
  // tagFilterIds rules would still work without an index; only the
  // new tagStates shape needs it.)
  const ruleTagIndex = useMemo(() => buildTagIndex(spellManagerTags as any), [spellManagerTags]);

  const ruleResolvedSpellIds = useMemo(() => {
    if (!facetEnrichedSpellSummaries) return {} as Record<string, string[]>;
    const out: Record<string, string[]> = {};
    Object.values(spellRulesById).forEach((rule) => {
      const matches: string[] = [];
      for (const spell of facetEnrichedSpellSummaries) {
        if (spellMatchesRule(spell, rule, ruleTagIndex)) matches.push(spell.id);
      }
      out[rule.id] = matches;
    });
    return out;
  }, [spellRulesById, facetEnrichedSpellSummaries, ruleTagIndex]);

  const resolveRulePool = useCallback(
    (ruleId: string) => ruleResolvedSpellIds[ruleId] || [],
    [ruleResolvedSpellIds],
  );

  // Layer 3 — character effective tag set. Aggregates tags from progression
  // classes, subclasses, accessible features, and chosen option items. Used
  // for spell-prerequisite gating in the Spell Manager.
  const effectiveTagAttributions = useMemo(
    () =>
      buildCharacterEffectiveTagAttributions({
        progression: character.progression || [],
        classCache,
        subclassCache,
        featureCache,
        optionsCache,
        selectedOptionsMap,
      }),
    [character.progression, classCache, subclassCache, featureCache, optionsCache, selectedOptionsMap],
  );
  const effectiveTagSet = useMemo(
    () => new Set(effectiveTagAttributions.keys()),
    [effectiveTagAttributions],
  );
  // Subtag-aware prereq matching: lets a character carrying
  // `Conjure.Manifest` satisfy a spell's `Conjure` requirement. Built
  // from spellManagerTags which preserves `parentTagId` per row. When
  // tags haven't loaded yet the map is empty and prereq matching
  // degrades to flat exact-id compare. See src/lib/characterTags.ts.
  const tagParentMap = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const t of spellManagerTags) map.set(t.id, t.parentTagId ?? null);
    return map;
  }, [spellManagerTags]);

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

      // ── Spellbook Manager (Layer 2) — collect GrantSpells + ExtendSpellList
      // Walks the same advancement tree as grantedItems above, but emits
      // ownedSpells / spellListExtensions instead of items. Sources covered:
      // class, subclass, class features, subclass features. Choice-mode
      // advancements consult selectedOptionsMap; explicit-resolver only for now.
      const classSourceScope = buildAdvancementSourceScope(
        buildAdvancementSourceContext({ parentType: "class", classDocument }),
      );
      const subclassSourceScope = subclassDocument
        ? buildAdvancementSourceScope(
            buildAdvancementSourceContext({
              parentType: "subclass",
              classDocument,
              subclassDocument,
            }),
          )
        : "";

      const grantedSpellEntries: ReturnType<typeof collectGrantedSpellsFromAdvancementList> = [
        ...collectGrantedSpellsFromAdvancementList(classDocument.advancements || [], {
          maxLevel: classLevel,
          defaultLevel: 1,
          parentType: "class",
          parentId: classDocument.id,
          sourceScope: classSourceScope,
          selectedOptionsMap,
          classId: classDocument.id,
          spellcastingClassIds,
          resolveRulePool,
        }),
        ...(subclassDocument
          ? collectGrantedSpellsFromAdvancementList(
              subclassDocument.advancements || [],
              {
                maxLevel: classLevel,
                defaultLevel: 1,
                parentType: "subclass",
                parentId: subclassDocument.id,
                sourceScope: subclassSourceScope,
                selectedOptionsMap,
                classId: classDocument.id,
                spellcastingClassIds,
                resolveRulePool,
              },
            )
          : []),
        ...allAccessibleClassFeatures.flatMap((feature: any) => {
          const featureSourceScope = buildAdvancementSourceScope(
            buildAdvancementSourceContext({
              parentType: "feature",
              classDocument,
              parentDocument: feature,
            }),
          );
          return collectGrantedSpellsFromAdvancementList(feature.advancements || [], {
            maxLevel: classLevel,
            defaultLevel: Number(feature.level || 1) || 1,
            parentType: "feature",
            parentId: feature.id,
            sourceScope: featureSourceScope,
            selectedOptionsMap,
            classId: classDocument.id,
            spellcastingClassIds,
            resolveRulePool,
          });
        }),
        ...allAccessibleSubclassFeatures.flatMap((feature: any) => {
          const featureSourceScope = buildAdvancementSourceScope(
            buildAdvancementSourceContext({
              parentType: "subclass-feature",
              classDocument,
              subclassDocument,
              parentDocument: feature,
            }),
          );
          return collectGrantedSpellsFromAdvancementList(feature.advancements || [], {
            maxLevel: classLevel,
            defaultLevel: Number(feature.level || 1) || 1,
            parentType: "feature",
            parentId: feature.id,
            sourceScope: featureSourceScope,
            selectedOptionsMap,
            classId: classDocument.id,
            spellcastingClassIds,
            resolveRulePool,
          });
        }),
      ];

      const spellListExtensionEntries: ReturnType<
        typeof collectSpellListExtensionsFromAdvancementList
      > = [
        ...collectSpellListExtensionsFromAdvancementList(classDocument.advancements || [], {
          maxLevel: classLevel,
          defaultLevel: 1,
          parentType: "class",
          parentId: classDocument.id,
          sourceScope: classSourceScope,
          selectedOptionsMap,
          classId: classDocument.id,
          spellcastingClassIds,
          resolveRulePool,
        }),
        ...(subclassDocument
          ? collectSpellListExtensionsFromAdvancementList(
              subclassDocument.advancements || [],
              {
                maxLevel: classLevel,
                defaultLevel: 1,
                parentType: "subclass",
                parentId: subclassDocument.id,
                sourceScope: subclassSourceScope,
                selectedOptionsMap,
                classId: classDocument.id,
                spellcastingClassIds,
                resolveRulePool,
              },
            )
          : []),
        ...allAccessibleClassFeatures.flatMap((feature: any) =>
          collectSpellListExtensionsFromAdvancementList(feature.advancements || [], {
            maxLevel: classLevel,
            defaultLevel: Number(feature.level || 1) || 1,
            parentType: "feature",
            parentId: feature.id,
            sourceScope: buildAdvancementSourceScope(
              buildAdvancementSourceContext({
                parentType: "feature",
                classDocument,
                parentDocument: feature,
              }),
            ),
            selectedOptionsMap,
            classId: classDocument.id,
            spellcastingClassIds,
            resolveRulePool,
          }),
        ),
        ...allAccessibleSubclassFeatures.flatMap((feature: any) =>
          collectSpellListExtensionsFromAdvancementList(feature.advancements || [], {
            maxLevel: classLevel,
            defaultLevel: Number(feature.level || 1) || 1,
            parentType: "feature",
            parentId: feature.id,
            sourceScope: buildAdvancementSourceScope(
              buildAdvancementSourceContext({
                parentType: "subclass-feature",
                classDocument,
                subclassDocument,
                parentDocument: feature,
              }),
            ),
            selectedOptionsMap,
            classId: classDocument.id,
            spellcastingClassIds,
            resolveRulePool,
          }),
        ),
      ];

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
        grantedSpells: grantedSpellEntries,
        spellListExtensions: spellListExtensionEntries,
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

  // Spellbook Manager (Layer 2): materialise advancement-derived spell grants.
  // Each summary already collected its GrantSpells / ExtendSpellList entries
  // upstream; here we flatten + dedupe across classes for the state writeback.
  // Source attribution + counts_as_class_id propagate through unchanged so
  // removal of a class/subclass/feature can sweep its grants in one query.
  const canonicalOwnedSpellGrants = dedupeOwnedSpellGrants(
    classProgressionSummaries.flatMap(
      (summary: any) => (Array.isArray(summary?.grantedSpells) ? summary.grantedSpells : []),
    ),
  );
  const canonicalSpellListExtensions = dedupeSpellListExtensions(
    classProgressionSummaries.flatMap(
      (summary: any) =>
        (Array.isArray(summary?.spellListExtensions) ? summary.spellListExtensions : []),
    ),
  );

  useEffect(() => {
    // If the spell catalog is loaded (rule-resolver path), use it to back-fill
    // names without a per-spell fetch. Otherwise fall back to per-id fetches
    // (the explicit-resolver path, where the catalog isn't needed).
    if (allSpellSummaries) {
      const knownIds = new Set(allSpellSummaries.map((s: any) => s.id));
      const newEntries: Record<string, any> = {};
      [
        ...canonicalOwnedSpellGrants.map((g) => g.spellId),
        ...canonicalSpellListExtensions.map((e) => e.spellId),
        // Player-picked (manual) entries — needed for the Sheet's Known Spells panel.
        ...(character.progressionState?.ownedSpells || [])
          .filter((s: any) => !s?.grantedByAdvancementId)
          .map((s: any) => s.id),
      ].forEach((id) => {
        if (!id || spellNameCache[id]) return;
        if (!knownIds.has(id)) return;
        const row = allSpellSummaries.find((s: any) => s.id === id);
        if (row) {
          newEntries[id] = {
            id: row.id,
            name: row.name,
            level: row.level,
            school: row.school,
          };
        }
      });
      if (Object.keys(newEntries).length > 0) {
        setSpellNameCache((prev) => ({ ...prev, ...newEntries }));
        return;
      }
    }
    const referenced = uniqueStringList([
      ...canonicalOwnedSpellGrants.map((g) => g.spellId),
      ...canonicalSpellListExtensions.map((e) => e.spellId),
      ...(character.progressionState?.ownedSpells || [])
        .filter((s: any) => !s?.grantedByAdvancementId)
        .map((s: any) => s.id),
    ]);
    const missing = referenced.filter((id) => id && !spellNameCache[id]);
    if (missing.length === 0) return;

    let cancelled = false;
    (async () => {
      try {
        const rows = await Promise.all(
          missing.map((id) => fetchDocument<any>("spells", id)),
        );
        if (cancelled) return;
        setSpellNameCache((prev) => {
          const next = { ...prev };
          rows.forEach((row: any) => {
            if (row && row.id) {
              next[row.id] = {
                id: row.id,
                name: row.name,
                level: row.level,
                school: row.school,
              };
            }
          });
          return next;
        });
      } catch (err) {
        console.error("Failed to load spell names for advancement display", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canonicalOwnedSpellGrants, canonicalSpellListExtensions, spellNameCache, allSpellSummaries, character.progressionState?.ownedSpells]);

  // Spell Manager: load filter foundation data (sources, tags, tag groups) on
  // first entry to the step. Cheap, cached by d1 layer.
  useEffect(() => {
    if (activeStep !== "spells") return;
    if (
      spellManagerSources.length > 0 &&
      spellManagerTags.length > 0 &&
      spellManagerTagGroups.length > 0
    ) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [sources, tags, tagGroups] = await Promise.all([
          fetchCollection<any>("sources", { orderBy: "name ASC" }),
          fetchCollection<any>("tags", { orderBy: "name ASC" }),
          fetchCollection<any>("tagGroups", { orderBy: "name ASC" }),
        ]);
        if (cancelled) return;
        setSpellManagerSources(sources);
        setSpellManagerTags(
          tags.map((t: any) => ({
            id: t.id,
            name: t.name || "",
            groupId: t.groupId || t.group_id || null,
            // Preserve parent for hierarchical prereq matching — a
            // character carrying `Conjure.Manifest` satisfies a spell's
            // `Conjure` requirement. See src/lib/characterTags.ts.
            parentTagId: t.parent_tag_id ?? t.parentTagId ?? null,
          })),
        );
        setSpellManagerTagGroups(tagGroups);
      } catch (err) {
        console.error("Failed to load Spell Manager foundation data", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    activeStep,
    spellManagerSources.length,
    spellManagerTags.length,
    spellManagerTagGroups.length,
  ]);

  // Spell Manager: load per-class spell pools when the step opens. Skips classes
  // already loaded. Each pool is the class's master list (class_spell_lists)
  // joined with the spells row — extensions from this character are merged
  // client-side at render time.
  useEffect(() => {
    if (activeStep !== "spells") return;
    const classesToLoad = spellcastingClassIds.filter((cid) => !classSpellPools[cid]);
    if (classesToLoad.length === 0) {
      if (!activeSpellManagerClassId && spellcastingClassIds.length > 0) {
        setActiveSpellManagerClassId(spellcastingClassIds[0]);
      }
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const results = await Promise.all(
          classesToLoad.map(async (cid) => [cid, await fetchClassSpellList(cid)] as const),
        );
        if (cancelled) return;
        setClassSpellPools((prev) => {
          const next = { ...prev };
          results.forEach(([cid, pool]) => {
            next[cid] = pool;
          });
          return next;
        });
        if (!activeSpellManagerClassId && spellcastingClassIds.length > 0) {
          setActiveSpellManagerClassId(spellcastingClassIds[0]);
        }
      } catch (err) {
        console.error("Failed to load class spell pools for Spell Manager", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeStep, spellcastingClassIds, classSpellPools, activeSpellManagerClassId]);

  // Choice-mode picker open: pre-load spell names for the entire pool so the
  // dialog renders with names rather than IDs. Pool is resolved live (rule
  // resolver may finish loading after the click).
  useEffect(() => {
    if (!spellChoiceDialogOpen) return;
    const dlg = spellChoiceDialogOpen;
    const livePool =
      dlg.resolverKind === "rule"
        ? resolveRulePool(dlg.ruleId)
        : dlg.explicitSpellIds;
    const missing = livePool.filter((id) => id && !spellNameCache[id]);
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const rows = await Promise.all(
          missing.map((id) => fetchDocument<any>("spells", id)),
        );
        if (cancelled) return;
        setSpellNameCache((prev) => {
          const next = { ...prev };
          rows.forEach((row: any) => {
            if (row?.id) {
              next[row.id] = {
                id: row.id,
                name: row.name,
                level: row.level,
                school: row.school,
                description: row.description,
              };
            }
          });
          return next;
        });
      } catch (err) {
        console.error("Failed to load picker pool spell names", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [spellChoiceDialogOpen, spellNameCache, resolveRulePool]);
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

    // Reconcile auto-granted spells with persisted player-edit state
    // (isPrepared toggles, manually added spells from the spellbook UI).
    // Granted entries replace their persisted counterpart but inherit the
    // existing isPrepared / isAlwaysPrepared flag so toggling survives a
    // recompute. Persisted-but-not-granted entries (manually added) pass
    // through untouched.
    const persistedSpellsByKey = new Map<string, any>();
    (normalizedProgressionState.ownedSpells || []).forEach((spell: any) => {
      const key = spell?.grantedByAdvancementId
        ? `adv:${spell.grantedByAdvancementId}:${spell.id}`
        : `manual:${spell.id}`;
      persistedSpellsByKey.set(key, spell);
    });

    const grantedOwnedSpells = canonicalOwnedSpellGrants.map((grant) => {
      const key = `adv:${grant.grantedByAdvancementId}:${grant.spellId}`;
      const persisted = persistedSpellsByKey.get(key);
      return {
        id: grant.spellId,
        sourceId: persisted?.sourceId || null,
        isPrepared: grant.alwaysPrepared
          ? true
          : persisted?.isPrepared ?? false,
        isAlwaysPrepared: grant.alwaysPrepared,
        grantedByType: grant.grantedByType,
        grantedById: grant.grantedById,
        grantedByAdvancementId: grant.grantedByAdvancementId,
        countsAsClassId: grant.countsAsClassId,
        doesntCountAgainstPrepared: grant.doesntCountAgainstPrepared,
        doesntCountAgainstKnown: grant.doesntCountAgainstKnown,
        // Phase 4 / Layer 4: player annotations + loadout membership survive
        // recomputes — they're orthogonal to the grant attribution.
        isFavourite: persisted?.isFavourite ?? false,
        isWatchlist: persisted?.isWatchlist ?? false,
        watchlistNote: persisted?.watchlistNote || '',
        loadoutMembership: Array.isArray(persisted?.loadoutMembership)
          ? persisted.loadoutMembership
          : [],
      };
    });

    // Manual entries (player-added in the Spell Manager) pass through. Persisted
    // entries that carried a grantedByAdvancementId are NOT promoted to manual —
    // they're owned by canonicalOwnedSpellGrants. Orphaned grant rows (advancement
    // gone because a class was removed) drop out cleanly here.
    const manualOwnedSpells = (normalizedProgressionState.ownedSpells || []).filter(
      (spell: any) => !spell?.grantedByAdvancementId,
    );

    const nextOwnedSpells = [...grantedOwnedSpells, ...manualOwnedSpells];
    const nextSpellListExtensions = canonicalSpellListExtensions.map((ext) => ({
      classId: ext.classId,
      spellId: ext.spellId,
      grantedByType: ext.grantedByType,
      grantedById: ext.grantedById,
      grantedByAdvancementId: ext.grantedByAdvancementId,
    }));

    const nextProgressionState = {
      ...normalizedProgressionState,
      classPackages: nextClassPackages,
      ownedFeatures: canonicalOwnedFeatures,
      ownedItems: canonicalOwnedItems,
      ownedSpells: nextOwnedSpells,
      spellListExtensions: nextSpellListExtensions,
    };

    if (
      JSON.stringify(normalizedProgressionState.classPackages) ===
        JSON.stringify(nextClassPackages) &&
      JSON.stringify(normalizedProgressionState.ownedFeatures || []) ===
        JSON.stringify(canonicalOwnedFeatures) &&
      JSON.stringify(normalizedProgressionState.ownedItems || []) ===
        JSON.stringify(canonicalOwnedItems) &&
      JSON.stringify(normalizedProgressionState.ownedSpells || []) ===
        JSON.stringify(nextOwnedSpells) &&
      JSON.stringify(normalizedProgressionState.spellListExtensions || []) ===
        JSON.stringify(nextSpellListExtensions)
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
    canonicalOwnedSpellGrants,
    canonicalSpellListExtensions,
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

        // Resolve the progression type to compute a slot-table contribution. If
        // the class is missing a progressionId, or it doesn't match a loaded
        // spellcasting_types row, fall back to "full caster" so the contributor
        // still renders. The character is clearly a spellcaster — we just don't
        // know the exact progression. Log a warning so the misconfiguration is
        // visible without breaking the UI.
        const typeRecord = resolveSpellcastingTypeRecord(spellcasting, spellcastingTypes);
        const formula = typeRecord?.formula
          ? String(typeRecord.formula)
          : "1 * level";
        if (!typeRecord?.formula) {
          console.warn(
            `[Spellcasting] No progression type found for ${label}; using full-caster fallback. ` +
              `progressionId=${spellcasting.progressionId || "(unset)"}, progression=${spellcasting.progression || "(unset)"}`,
          );
        }

        const contribution = calculateEffectiveCastingLevel(classLevel, formula);

        contributors.push({
          sourceType,
          label,
          className: summary.className,
          subclassName: summary.subclassName || "",
          classLevel,
          unlockLevel,
          progressionTypeName:
            typeRecord?.name ||
            typeRecord?.identifier ||
            (typeRecord as any)?.foundry_name ||
            (typeRecord as any)?.foundryName ||
            "Unknown progression",
          progressionFormula: formula,
          effectiveLevel: contribution > 0 ? contribution : classLevel,
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
            // Book-Spread Sheet shell — frames the sheet as an open
            // tome. Outer wrapper carries the parchment tint + ringed
            // gold border + 2xl drop shadow; the existing 2-col grid
            // below renders as the verso/recto pages with a center
            // spine divider added via absolute positioning so the
            // children don't have to be re-padded.
            <div className="space-y-6 bg-gradient-to-b from-gold/[0.04] via-card/30 to-gold/[0.02] p-4 sm:p-6 md:p-8 rounded-2xl border-2 border-gold/25 ring-1 ring-inset ring-gold/10 relative shadow-2xl h-full min-h-[500px]">
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
              {/* Header row exposes the Point Buy modal next to the
                  scores so players don't have to fish for it through
                  an ASI advancement. Pre-fill summary in the badge
                  reflects whether the current scores actually fit a
                  27-point allocation (8–15 only, no double-cost
                  overrun). */}
              <div className="flex items-baseline justify-between gap-3 mb-3 px-1">
                <div className="flex items-baseline gap-3">
                  <span className="label-text text-ink/30 border-l-2 border-gold pl-2">
                    Abilities &amp; Saves
                  </span>
                  {(() => {
                    const ids = (allAttributes.length > 0
                      ? allAttributes.map((a: any) => String(a.identifier || a.id))
                      : ["STR", "DEX", "CON", "INT", "WIS", "CHA"]) as string[];
                    const scoresMap: Record<string, number> = {};
                    let inRange = true;
                    for (const id of ids) {
                      const s = Number(character?.stats?.base?.[id] ?? 10);
                      scoresMap[id] = s;
                      if (s < POINT_BUY_MIN || s > POINT_BUY_MAX) inRange = false;
                    }
                    const isPB = String(character?.stats?.method || "") === "point-buy";
                    if (!inRange) {
                      return (
                        <span className="text-[9px] font-bold uppercase tracking-widest text-ink/40">
                          Custom range
                        </span>
                      );
                    }
                    const total = pointBuyTotal(scoresMap);
                    const remaining = POINT_BUY_BUDGET - total;
                    return (
                      <span
                        className={cn(
                          "text-[9px] font-bold uppercase tracking-widest",
                          isPB ? "text-gold" : "text-ink/45",
                        )}
                        title="Whether the current scores fit a standard 27-point allocation."
                      >
                        {isPB ? "Point Buy · " : "Fits Point Buy · "}
                        {remaining >= 0 ? `${remaining} unspent` : `${-remaining} over`}
                      </span>
                    );
                  })()}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowPointBuy(true)}
                  className="border-gold/30 text-gold hover:bg-gold/5 uppercase tracking-widest text-[10px] font-black gap-2"
                >
                  <Edit2 className="w-3 h-3" /> Point Buy
                </Button>
              </div>
              {/* ── Abilities & Saves unified grid (BookSpread design)
                  ──────────────────────────────────────────────────
                  Each ability gets one cell that stacks the score box
                  (with modifier inside), the raw-score tag, the +/-
                  controls on hover, AND the save row (prof dot +
                  "SAVE" label + save total). Clicking the save row
                  cycles the proficiency state (none → prof → expert
                  → half → none); right-click cycles in reverse —
                  same controls the old standalone Saving Throws
                  block exposed, now consolidated into one place. */}
              <div className="grid grid-cols-3 md:grid-cols-6 gap-3 md:gap-4 mb-8">
                {(allAttributes.length > 0
                  ? allAttributes
                  : ["STR", "DEX", "CON", "INT", "WIS", "CHA"].map((id) => ({ id, identifier: id, name: id }))
                ).map((attr: any) => {
                  const iden = attr.identifier || attr.id;
                  const attrName = attr.name || iden;
                  const score = getSafeStat(iden);
                  const modStr = getSafeModifier(iden);

                  const isProf = character.savingThrows?.includes(iden);
                  const isExp = character.expertiseSavingThrows?.includes(iden);
                  const isHalf = character.halfProficientSavingThrows?.includes(iden);

                  const baseMod = Math.floor((score - 10) / 2);
                  const profBonus = Number(character.proficiencyBonus || 2);
                  const saveAdd = isExp ? profBonus * 2 : isProf ? profBonus : isHalf ? Math.floor(profBonus / 2) : 0;
                  const saveTotal = baseMod + saveAdd;
                  const saveTotalLabel = saveTotal >= 0 ? `+${saveTotal}` : `${saveTotal}`;

                  const cycleSave = (e: React.MouseEvent) => {
                    e.preventDefault();
                    let p = [...(character.savingThrows || [])];
                    let x = [...(character.expertiseSavingThrows || [])];
                    let h = [...(character.halfProficientSavingThrows || [])];
                    if (isHalf) h = h.filter((s: string) => s !== iden);
                    else if (isExp) {
                      x = x.filter((s: string) => s !== iden);
                      h.push(iden);
                    } else if (isProf) {
                      p = p.filter((s: string) => s !== iden);
                      x.push(iden);
                    } else p.push(iden);
                    setCharacter({
                      ...character,
                      savingThrows: p,
                      expertiseSavingThrows: x,
                      halfProficientSavingThrows: h,
                    });
                  };
                  const cycleSaveReverse = (e: React.MouseEvent) => {
                    e.preventDefault();
                    let p = [...(character.savingThrows || [])];
                    let x = [...(character.expertiseSavingThrows || [])];
                    let h = [...(character.halfProficientSavingThrows || [])];
                    if (isHalf) {
                      h = h.filter((s: string) => s !== iden);
                      x.push(iden);
                    } else if (isExp) {
                      x = x.filter((s: string) => s !== iden);
                      p.push(iden);
                    } else if (isProf) p = p.filter((s: string) => s !== iden);
                    else h.push(iden);
                    setCharacter({
                      ...character,
                      savingThrows: p,
                      expertiseSavingThrows: x,
                      halfProficientSavingThrows: h,
                    });
                  };

                  const saveActive = isProf || isExp || isHalf;

                  return (
                    <div
                      key={attr.id || iden}
                      className="group relative flex flex-col items-stretch"
                    >
                      <span className="text-[10px] font-black uppercase tracking-widest text-ink/55 text-center mb-1">
                        {attrName}
                      </span>
                      <div className="bg-card border-2 border-gold/25 rounded-lg p-3 flex flex-col items-center transition-all group-hover:border-gold group-hover:shadow-[0_0_12px_rgba(197,160,89,0.18)]">
                        <span className="text-2xl sm:text-3xl font-black text-ink leading-none">
                          {modStr}
                        </span>
                        <span className="mt-1.5 px-2 py-0.5 bg-gold/15 border border-gold/30 rounded-sm font-mono text-[10px] font-black text-gold leading-none">
                          {score}
                        </span>

                        <button
                          type="button"
                          onClick={cycleSave}
                          onContextMenu={cycleSaveReverse}
                          title={
                            isExp
                              ? "Expertise save · click for half · right-click for proficient"
                              : isProf
                                ? "Proficient save · click for expertise · right-click for none"
                                : isHalf
                                  ? "Half-proficient · click for none · right-click for expertise"
                                  : "Click to cycle proficiency · right-click reverses"
                          }
                          className={cn(
                            "mt-2 pt-2 border-t w-full flex items-center justify-between gap-1.5 transition-colors group/save",
                            saveActive ? "border-gold/30" : "border-gold/10 hover:border-gold/25",
                          )}
                        >
                          <span
                            className={cn(
                              "w-3 h-3 rounded-full border-2 flex items-center justify-center shrink-0 transition-all relative overflow-hidden",
                              isExp
                                ? "border-gold bg-card"
                                : isProf
                                  ? "border-gold bg-gold"
                                  : isHalf
                                    ? "border-gold bg-gold"
                                    : "border-gold/30 group-hover/save:border-gold/60",
                            )}
                          >
                            {isExp && <span className="block w-1.5 h-1.5 rounded-full bg-gold" />}
                            {isHalf && (
                              <span
                                className="absolute inset-0 bg-card"
                                style={{ clipPath: "polygon(50% 0, 100% 0, 100% 100%, 50% 100%)" }}
                              />
                            )}
                          </span>
                          <span className="text-[8px] font-black uppercase tracking-widest text-ink/45 leading-none">
                            Save
                          </span>
                          <span
                            className={cn(
                              "font-mono text-xs font-black leading-none ml-auto",
                              saveActive ? "text-gold" : "text-ink/55",
                            )}
                          >
                            {saveTotalLabel}
                          </span>
                        </button>
                      </div>

                      <div className="absolute -right-2 top-6 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-20">
                        <button
                          onClick={() => handleStatChange(iden, 1)}
                          className="p-1 bg-ink text-gold rounded border border-gold/30 shadow-lg hover:bg-gold hover:text-white transition-all active:scale-90"
                          aria-label={`Increase ${iden}`}
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => handleStatChange(iden, -1)}
                          className="p-1 bg-ink text-gold rounded border border-gold/30 shadow-lg hover:bg-gold hover:text-white transition-all active:scale-90"
                          aria-label={`Decrease ${iden}`}
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>


              {true && (
              <>
              {/* Vital block — Portrait + HP + Hit Dice + Spell Points
                  + the small vital-stats triplet (Init / Speed / Prof).
                  Used to be paired in a two-column xl grid with the
                  standalone Saving Throws card; the Abilities & Saves
                  unified grid above now subsumes the save column, so
                  this is a single full-width card. */}
              <div className="mb-8">
                {/* ── Vital Hub (BookSpread design) ─────────────────
                    Ringed portrait on the left (outer HP arc, optional
                    inner Spell Points arc, center monogram or image,
                    AC shield overlay), with the right column carrying
                    HP/SP/Temp HP side-by-side, the Hit Dice strip, and
                    the Initiative/Speed/Proficiency triplet.

                    Per-class Hit Dice cards aren't possible yet — the
                    character model has a single `hitDie` field rather
                    than a `hitDicePools[]` array. When the model picks
                    up per-class HD tracking, the single card below
                    splits into one card per class. */}
                {(() => {
                  const hpMax = getEffectiveHpMax(character);
                  const hpCurrent = Number(character?.hp?.current ?? 0) || 0;
                  const hpTemp = Number(character?.hp?.temp ?? 0) || 0;
                  const hpPct = hpMax > 0 ? Math.min(100, Math.max(0, (hpCurrent / hpMax) * 100)) : 0;
                  const spMax = Number(character?.spellPoints?.max ?? 0) || 0;
                  const spCurrent = Number(character?.spellPoints?.current ?? 0) || 0;
                  const hasSP = spMax > 0;
                  const spPct = hasSP ? Math.min(100, Math.max(0, (spCurrent / spMax) * 100)) : 0;

                  // Ring math — SVG circles render an arc by setting
                  // strokeDasharray to "<filled> <total>" so we render
                  // exactly the percentage we want. The whole SVG is
                  // rotated -90° so 0% lives at the top of the circle.
                  const RING_SIZE = 160;
                  const HP_R = 72;
                  const SP_R = 60;
                  const HP_CIRC = 2 * Math.PI * HP_R;
                  const SP_CIRC = 2 * Math.PI * SP_R;
                  const hpDash = (HP_CIRC * hpPct) / 100;
                  const spDash = (SP_CIRC * spPct) / 100;

                  const monogram = String(character?.name || "?")
                    .trim()
                    .charAt(0)
                    .toUpperCase() || "?";

                  return (
                    <div className="border border-gold/20 p-5 flex flex-col xl:flex-row gap-6 rounded-lg bg-card/50 shadow-sm relative group transition-all hover:bg-card/80 hover:shadow-md">
                      {/* RINGED PORTRAIT */}
                      <div
                        className="relative shrink-0 mx-auto xl:mx-0 group/portrait"
                        style={{ width: RING_SIZE, height: RING_SIZE }}
                      >
                        {/* SVG rings: HP (outer, blood), SP (inner, indigo, conditional). */}
                        <svg
                          width={RING_SIZE}
                          height={RING_SIZE}
                          viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
                          style={{ transform: "rotate(-90deg)" }}
                          className="absolute inset-0 overflow-visible pointer-events-none"
                        >
                          <circle
                            cx={RING_SIZE / 2}
                            cy={RING_SIZE / 2}
                            r={HP_R}
                            fill="none"
                            stroke="rgba(190,18,60,0.14)"
                            strokeWidth={8}
                          />
                          <circle
                            cx={RING_SIZE / 2}
                            cy={RING_SIZE / 2}
                            r={HP_R}
                            fill="none"
                            stroke="#be123c"
                            strokeWidth={8}
                            strokeLinecap="butt"
                            strokeDasharray={`${hpDash} ${HP_CIRC}`}
                          />
                          {hasSP && (
                            <>
                              <circle
                                cx={RING_SIZE / 2}
                                cy={RING_SIZE / 2}
                                r={SP_R}
                                fill="none"
                                stroke="rgba(67,56,202,0.14)"
                                strokeWidth={5}
                              />
                              <circle
                                cx={RING_SIZE / 2}
                                cy={RING_SIZE / 2}
                                r={SP_R}
                                fill="none"
                                stroke="#4338ca"
                                strokeWidth={5}
                                strokeLinecap="butt"
                                strokeDasharray={`${spDash} ${SP_CIRC}`}
                              />
                            </>
                          )}
                        </svg>

                        {/* Portrait core — 96px circle in the dead
                            center of the rings. Image when present,
                            else a monogram of the character's first
                            letter (matches the handoff's V/D monograms). */}
                        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-24 h-24 rounded-full overflow-hidden border-2 border-gold/30 bg-card flex items-center justify-center shadow-inner">
                          {character.imageUrl ? (
                            <img
                              src={character.imageUrl}
                              alt=""
                              className="w-full h-full object-cover"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <span className="font-serif text-4xl font-bold text-gold/55 leading-none select-none">
                              {monogram}
                            </span>
                          )}
                        </div>

                        {/* Hover image-upload overlay — same trigger as
                            before, scoped to the center circle so it
                            doesn't fight with the AC shield's hit area. */}
                        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-24 h-24 rounded-full bg-ink/65 opacity-0 group-hover/portrait:opacity-100 transition-opacity flex items-center justify-center pointer-events-auto">
                          <ImageUpload
                            currentImageUrl={character.imageUrl}
                            storagePath={`images/characters/${id || "new"}/`}
                            onUpload={(url) =>
                              setCharacter({ ...character, imageUrl: url })
                            }
                            className="scale-75"
                          />
                        </div>

                        {/* AC shield — anchored to the bottom-right of
                            the ring frame, like a wax seal. */}
                        <div
                          className="absolute -bottom-1 -right-1 w-11 h-12 bg-gold text-white border border-white/20 flex flex-col items-center justify-center shadow-lg pt-0.5"
                          style={{
                            clipPath: "polygon(0% 0%, 100% 0%, 100% 80%, 50% 100%, 0% 80%)",
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

                      {/* RIGHT — HP/SP blocks, Hit Dice strip, Vital triplet */}
                      <div className="flex-1 min-w-0 space-y-3 py-1">
                        {/* HP + Spell Points blocks (side-by-side) */}
                        <div className="flex flex-col sm:flex-row gap-3">
                          {/* HP block */}
                          <div className="flex-1 p-3 border border-blood/25 bg-blood/[0.04] rounded-md group/hp">
                            <div className="flex items-end gap-3">
                              <div className="flex-1 min-w-0">
                                <div className="text-[8px] font-black uppercase tracking-widest text-ink/45 leading-none mb-1.5">
                                  Hit Points
                                </div>
                                <div className="flex items-baseline gap-1">
                                  <span className="font-mono text-2xl sm:text-3xl font-black text-ink leading-none">
                                    {hpCurrent}
                                  </span>
                                  <span className="text-xs text-ink/30 font-bold">
                                    / {hpMax}
                                  </span>
                                </div>
                              </div>
                              <div className="text-right shrink-0">
                                <div className="text-[8px] font-black uppercase tracking-widest text-sky-700/75 leading-none mb-1.5">
                                  Temp HP
                                </div>
                                <div
                                  className={cn(
                                    "font-mono text-lg font-black leading-none",
                                    hpTemp > 0 ? "text-sky-600" : "text-ink/25",
                                  )}
                                >
                                  {hpTemp}
                                </div>
                              </div>
                              <div className="opacity-0 group-hover/hp:opacity-100 transition-opacity flex flex-col gap-1 shrink-0">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setCharacter({
                                      ...character,
                                      hp: {
                                        ...character.hp,
                                        current: Math.min(
                                          hpMax,
                                          hpCurrent + 1,
                                        ),
                                      },
                                    })
                                  }
                                  aria-label="Increase HP"
                                  className="w-6 h-6 bg-card text-ink border border-gold/30 hover:bg-emerald-500 hover:text-white rounded flex items-center justify-center shadow-sm transition-colors"
                                >
                                  <Plus className="w-3 h-3" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setCharacter({
                                      ...character,
                                      hp: {
                                        ...character.hp,
                                        current: Math.max(0, hpCurrent - 1),
                                      },
                                    })
                                  }
                                  aria-label="Decrease HP"
                                  className="w-6 h-6 bg-card text-ink border border-gold/30 hover:bg-rose-500 hover:text-white rounded flex items-center justify-center shadow-sm transition-colors"
                                >
                                  <Minus className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                            {/* Slim fill bar — visualises the HP
                                percentage; supplements the rotating
                                ring on the portrait. */}
                            <div className="h-1.5 mt-2 bg-blood/10 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-blood/70 rounded-full transition-all duration-700"
                                style={{ width: `${hpPct}%` }}
                              />
                            </div>
                          </div>

                          {/* Spell Points block — only when the
                              character is a spellcaster with a non-
                              zero max. Non-casters keep the simpler
                              HP-only layout. */}
                          {hasSP && (
                            <div className="flex-1 p-3 border border-indigo-500/25 bg-indigo-500/[0.04] rounded-md">
                              <div className="text-[8px] font-black uppercase tracking-widest text-indigo-700/75 leading-none mb-1.5">
                                Spell Points
                              </div>
                              <div className="flex items-baseline gap-1">
                                <span className="font-mono text-2xl sm:text-3xl font-black text-indigo-700 leading-none">
                                  {spCurrent}
                                </span>
                                <span className="text-xs text-indigo-700/40 font-bold">
                                  / {spMax}
                                </span>
                              </div>
                              <div className="h-1.5 mt-2 bg-indigo-500/10 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-indigo-600/70 rounded-full transition-all duration-700"
                                  style={{ width: `${spPct}%` }}
                                />
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Hit Dice strip — one card per class once
                            the model supports it. Today: single card
                            for the character's primary hit-die type. */}
                        <div className="flex items-center gap-3 p-2 border border-gold/15 bg-card/30 rounded-md">
                          <span className="text-[8px] font-black uppercase tracking-widest text-ink/45 pl-1">
                            Hit Dice
                          </span>
                          <div className="flex-1 flex gap-2">
                            <div className="px-3 py-1.5 border border-gold/20 bg-card rounded flex items-center gap-3">
                              <span className="font-mono text-base font-black leading-none">
                                <span className="text-ink">{character.hitDie.current}</span>
                                <span className="text-ink/25"> / </span>
                                <span className="text-ink/55">{character.hitDie.max}</span>
                              </span>
                              <span className="w-px h-4 bg-gold/20" />
                              <span className="text-[10px] font-black uppercase tracking-widest text-gold/75 leading-none">
                                {character.hitDie.type}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* VITAL TRIPLET — Initiative / Speed / Proficiency */}
                        <div className="grid grid-cols-3 gap-2">
                          {[
                            {
                              label: "Initiative",
                              value:
                                character.initiative >= 0
                                  ? `+${character.initiative}`
                                  : `${character.initiative}`,
                            },
                            {
                              label: "Speed",
                              value: (
                                <>
                                  {character.speed}
                                  <span className="text-xs text-ink/40 font-bold"> ft</span>
                                </>
                              ),
                            },
                            {
                              label: "Proficiency",
                              value: `+${character.proficiencyBonus}`,
                            },
                          ].map((stat) => (
                            <div
                              key={stat.label}
                              className="p-2 sm:p-3 border border-gold/20 bg-card rounded flex flex-col items-center justify-center text-center shadow-sm transition-all hover:-translate-y-0.5"
                            >
                              <span className="font-mono text-xl sm:text-2xl font-black text-ink leading-none">
                                {stat.value}
                              </span>
                              <span className="text-[8px] sm:text-[9px] font-black uppercase tracking-[0.16em] text-ink/45 mt-1.5">
                                {stat.label}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })()}
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
                    <div className="border border-gold/20 bg-card/40 rounded-xl p-4 sm:p-6 shadow-sm space-y-5">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div>
                          <h3 className="text-base sm:text-lg font-serif font-black uppercase text-ink/80 tracking-tight flex items-center gap-2">
                            <ShieldCheck className="w-4 h-4 sm:w-5 sm:h-5 text-gold" />
                            Granted Features
                          </h3>
                          <p className="text-xs text-ink/50 font-serif italic mt-1">
                            Features, scale tracks, and granted items from your class progression. Manage advancements in the Class step.
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

                      {/* ── Granted Features grid (design handoff) ────────
                           Per-class section with a 2-col card grid below.
                           Each card: feature name (serif, semibold) + L#
                           pill + source tag + optional description. Mirrors
                           the Features-by-class layout from sheet-v3.jsx. */}
                      {sheetClassSummaries.length > 0 ? (
                        sheetClassSummaries.map((summary: any) => {
                          const hasFeatures = summary.features.length > 0;
                          const hasScales = summary.scales.length > 0;
                          const hasItems = summary.grantedItems.length > 0;
                          return (
                            <div
                              key={summary.classId}
                              className="space-y-3 border-l-[3px] border-gold/40 pl-4"
                            >
                              <div className="flex items-baseline justify-between gap-3 flex-wrap">
                                <div className="flex items-baseline gap-3">
                                  <span className="text-base font-serif font-bold text-ink">
                                    {summary.className}
                                  </span>
                                  <span className="text-[10px] font-black uppercase tracking-[0.18em] text-gold/70">
                                    Level {summary.classLevel}
                                    {summary.subclassName ? ` · ${summary.subclassName}` : ""}
                                  </span>
                                </div>
                                <span className="text-[10px] font-bold uppercase tracking-widest text-ink/35">
                                  {summary.features.length} feature{summary.features.length === 1 ? "" : "s"}
                                </span>
                              </div>

                              {hasScales && (
                                <div className="flex flex-wrap gap-1.5">
                                  {summary.scales.map((scale: any) => (
                                    <div
                                      key={scale.id}
                                      className="px-2 py-0.5 border border-gold/25 bg-gold/5 rounded-sm flex items-baseline gap-1.5"
                                    >
                                      <span className="text-[9px] font-black uppercase tracking-widest text-gold/65">
                                        {scale.name}
                                      </span>
                                      <span className="font-mono text-xs font-black text-ink">
                                        {String(scale.value)}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              )}

                              {hasFeatures ? (
                                <div className="grid gap-2 sm:grid-cols-2">
                                  {summary.features.map((feature: any) => {
                                    const isSubclass = feature.parentType === "subclass";
                                    return (
                                      <div
                                        key={`${summary.classId}-${feature.id}`}
                                        className={cn(
                                          "p-3 rounded-md border bg-card/60 transition-colors hover:bg-card/80",
                                          isSubclass
                                            ? "border-amber-500/25"
                                            : "border-gold/20",
                                        )}
                                      >
                                        <div className="flex items-start justify-between gap-2">
                                          <span className="font-serif text-sm font-bold text-ink leading-tight">
                                            {feature.name}
                                          </span>
                                          <div className="flex items-center gap-1 shrink-0">
                                            <span className="text-[8px] font-black uppercase tracking-[0.16em] text-gold/65 px-1.5 py-0.5 border border-gold/25 rounded-sm">
                                              L{feature.level}
                                            </span>
                                            {isSubclass && (
                                              <span className="text-[8px] font-black uppercase tracking-[0.16em] text-amber-600/80 px-1.5 py-0.5 border border-amber-500/30 rounded-sm">
                                                Sub
                                              </span>
                                            )}
                                          </div>
                                        </div>
                                        {feature.description && (
                                          <p className="text-[11px] text-ink/55 font-serif leading-relaxed mt-1.5 line-clamp-3">
                                            {String(feature.description).replace(/\[[^\]]+\]/g, "").trim()}
                                          </p>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : (
                                <div className="text-xs font-serif italic text-ink/35">
                                  No granted features yet.
                                </div>
                              )}

                              {hasItems && (
                                <div className="space-y-1 pt-2 border-t border-gold/10">
                                  <div className="text-[9px] font-black uppercase tracking-[0.18em] text-ink/40">
                                    Granted Items
                                  </div>
                                  <div className="flex flex-wrap gap-1.5">
                                    {summary.grantedItems.map((item: any) => (
                                      <span
                                        key={`${summary.classId}-item-${item.id}-${item.level}`}
                                        className="px-2 py-0.5 bg-card border border-gold/20 rounded-sm text-[10px] font-bold text-ink/70 inline-flex items-center gap-1.5"
                                      >
                                        <span className="font-serif normal-case">{item.name}</span>
                                        <span className="text-[8px] font-black tracking-widest text-gold/60">L{item.level}</span>
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })
                      ) : (
                        <div className="text-sm font-serif italic text-ink/35">
                          No class progression is active yet.
                        </div>
                      )}

                      {selectedAdvancementOptionItems.length > 0 && (
                        <div className="space-y-2 pt-3 border-t border-gold/10">
                          <div className="text-[10px] font-black uppercase tracking-[0.2em] text-ink/40">
                            Selected Advancement Options
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {selectedAdvancementOptionItems.map((option: any) => (
                              <span
                                key={option.id}
                                className="px-2 py-0.5 bg-card border border-gold/20 rounded-sm text-[10px] font-bold text-ink/70 uppercase inline-flex items-baseline gap-1.5"
                              >
                                <span>{option.name}</span>
                                {option.featureType && (
                                  <span className="text-[8px] font-black tracking-widest text-gold/60 normal-case">
                                    {option.featureType}
                                  </span>
                                )}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
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
                            Prepared and granted spells from your class progression — manage via the Spell Manager step.
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setActiveStep("spells")}
                          className="border-gold/30 text-gold hover:bg-gold/5 uppercase tracking-widest text-[10px] font-black"
                        >
                          Open Spell Manager
                        </Button>
                      </div>

                      {/* ── Spell stats banner (design handoff) ──────────
                           Per-class Save DC / Atk chips + the multiclass
                           spell-slot pip bar at a glance. Lives at the
                           top of the sheet's Spells sub-tab so combat
                           reference data is the first thing the player
                           sees. Slot usage tracking (used vs unused) is
                           future work — pips render full for now. */}
                      {spellcastingContributors.length > 0 && (
                        <div className="border border-gold/25 bg-[#efe6cf]/40 rounded-lg p-4 space-y-4">
                          <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
                            {spellcastingContributors.map((contributor: any) => {
                              const ab = contributor.ability;
                              const score = Number(character?.stats?.base?.[ab] ?? 10);
                              const mod = Math.floor((score - 10) / 2);
                              const prof = Number(character?.proficiencyBonus ?? 2);
                              const dc = 8 + prof + mod;
                              const atk = prof + mod;
                              return (
                                <div
                                  key={`${contributor.kind}-${contributor.classId}-${contributor.subclassId || "none"}`}
                                  className="flex flex-col gap-0.5"
                                >
                                  <span className="text-[8px] font-black uppercase tracking-[0.18em] text-ink/45">
                                    {contributor.label} · {ab}
                                  </span>
                                  <span className="font-mono text-base font-black text-gold leading-none">
                                    DC {dc} · {atk >= 0 ? `+${atk}` : atk}
                                  </span>
                                </div>
                              );
                            })}

                            <div className="ml-auto flex flex-wrap items-end gap-3">
                              {multiclassSpellSlots.map((count: number, i: number) =>
                                count > 0 ? (
                                  <div
                                    key={`slot-pip-${i}`}
                                    className="flex flex-col items-center gap-1"
                                  >
                                    <div className="flex gap-1">
                                      {Array.from({ length: count }).map((_, j) => (
                                        <span
                                          key={j}
                                          className="w-2 h-2 rounded-full border-2 border-gold bg-gold"
                                          title={`Level ${i + 1} slot ${j + 1}`}
                                        />
                                      ))}
                                    </div>
                                    <span className="text-[8px] font-black uppercase tracking-[0.16em] text-ink/45">
                                      L{i + 1}
                                    </span>
                                  </div>
                                ) : null,
                              )}
                            </div>
                          </div>

                          {/* Per-spellcasting-class quick counts —
                              Cantrips / Spells Known / Prepared.
                              Reads from the ownedSpells progression
                              state, scoped by the contributor's class
                              when attribution columns are populated. */}
                          {(() => {
                            const ps = character.progressionState || {};
                            const allOwned: any[] = ps.ownedSpells || [];
                            const totalKnown = allOwned.filter(
                              (s: any) => !s?.grantedByAdvancementId || !s?.doesntCountAgainstKnown,
                            ).length;
                            const totalPrepared = allOwned.filter(
                              (s: any) => s?.isPrepared || s?.isAlwaysPrepared,
                            ).length;
                            const totalCantrips = allOwned.filter((s: any) => {
                              const lvl = spellNameCache[s.id]?.level;
                              return lvl === 0;
                            }).length;
                            const totalRituals = allOwned.filter((s: any) => {
                              const cached = spellNameCache[s.id];
                              return cached?.ritual || cached?.foundryShell?.ritual;
                            }).length;
                            return (
                              <div className="flex items-center gap-4 text-[10px] font-bold uppercase tracking-widest text-ink/55 flex-wrap pt-3 border-t border-gold/15">
                                <span>
                                  Cantrips: <span className="text-gold">{totalCantrips}</span>
                                </span>
                                <span className="text-ink/20">·</span>
                                <span>
                                  Known: <span className="text-gold">{totalKnown}</span>
                                </span>
                                <span className="text-ink/20">·</span>
                                <span>
                                  Prepared: <span className="text-blood">{totalPrepared}</span>
                                </span>
                                {totalRituals > 0 && (
                                  <>
                                    <span className="text-ink/20">·</span>
                                    <span>
                                      Ritual:{" "}
                                      <span className="text-amber-600">{totalRituals}</span>
                                    </span>
                                  </>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      )}

                      {/* ── Prepared at a Glance (design handoff) ────────
                           Read-only grouped view of currently-prepared
                           spells (always_prepared ∪ isPrepared ∪ any
                           active-loadout member). The intent of the
                           sheet's Spells sub-tab is combat reference:
                           "what spells do I have right now?" The full
                           Spell Manager step is where the player
                           actually composes the prepared set. */}
                      {spellcastingContributors.length > 0 && (() => {
                        const ps = character.progressionState || {};
                        const allOwned: any[] = ps.ownedSpells || [];
                        const allLoadouts: any[] = ps.spellLoadouts || [];
                        const activeLoadoutIds = new Set(
                          allLoadouts.filter((l: any) => l?.isActive).map((l: any) => l.id),
                        );
                        const isPreparedByEither = (s: any) => {
                          if (s?.isAlwaysPrepared) return true;
                          if (s?.isPrepared) return true;
                          const membership = Array.isArray(s?.loadoutMembership)
                            ? s.loadoutMembership
                            : [];
                          return membership.some((lid: string) => activeLoadoutIds.has(lid));
                        };
                        const prepared = allOwned.filter(isPreparedByEither);
                        if (prepared.length === 0) {
                          return (
                            <div className="border border-dashed border-gold/25 rounded-lg p-4 text-center">
                              <p className="text-[10px] font-bold uppercase tracking-widest text-gold/55">
                                No Spells Prepared
                              </p>
                              <p className="text-xs text-ink/40 font-serif italic mt-1">
                                Open the Spell Manager step to prepare spells.
                              </p>
                            </div>
                          );
                        }

                        const byLvl = new Map<number, any[]>();
                        prepared.forEach((s: any) => {
                          const lvl = Number(spellNameCache[s.id]?.level ?? -1);
                          if (!byLvl.has(lvl)) byLvl.set(lvl, []);
                          byLvl.get(lvl)!.push(s);
                        });
                        const lvls = Array.from(byLvl.keys()).sort((a, b) => a - b);

                        return (
                          <div className="border border-gold/20 rounded-lg p-4 bg-background/30 space-y-3">
                            <div className="flex items-center justify-between gap-2 border-b border-gold/15 pb-2">
                              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-gold">
                                Prepared · At a Glance
                              </span>
                              <span className="font-mono text-[10px] font-bold text-ink/45">
                                {prepared.length} spell{prepared.length === 1 ? "" : "s"}
                              </span>
                            </div>
                            <div className="space-y-3">
                              {lvls.map((lvl) => {
                                const rows = byLvl.get(lvl) || [];
                                return (
                                  <div key={`prep-glance-${lvl}`} className="space-y-1">
                                    <div className="text-[9px] font-black uppercase tracking-[0.18em] text-ink/45 px-1">
                                      {lvl < 0
                                        ? "Loading…"
                                        : lvl === 0
                                          ? "Cantrips"
                                          : `Level ${lvl}`}
                                      <span className="text-ink/30 font-bold ml-1">
                                        · {rows.length}
                                      </span>
                                    </div>
                                    {rows.map((s: any) => {
                                      const cached = spellNameCache[s.id];
                                      const isAlways = !!s?.isAlwaysPrepared;
                                      const isRitual =
                                        cached?.ritual || cached?.foundryShell?.ritual;
                                      const isConc =
                                        cached?.concentration || cached?.foundryShell?.concentration;
                                      return (
                                        <div
                                          key={`prep-glance-row-${s.id}`}
                                          className="flex items-center gap-2 px-3 py-1 bg-card/40 border border-gold/10 rounded-sm"
                                        >
                                          <span
                                            className={cn(
                                              "w-2 h-2 rounded-full shrink-0",
                                              isAlways ? "bg-emerald-500" : "bg-gold",
                                            )}
                                            title={isAlways ? "Always prepared" : "Prepared"}
                                          />
                                          <span className="font-serif text-sm text-ink truncate flex-1">
                                            {cached?.name || s.id}
                                          </span>
                                          {cached?.school && (
                                            <span className="text-[9px] font-black uppercase tracking-widest text-gold/60 shrink-0">
                                              {String(cached.school).slice(0, 4)}
                                            </span>
                                          )}
                                          {isRitual && (
                                            <span
                                              className="text-[9px] font-black uppercase tracking-widest text-amber-600 shrink-0"
                                              title="Ritual"
                                            >
                                              R
                                            </span>
                                          )}
                                          {isConc && (
                                            <span
                                              className="text-[9px] font-black uppercase tracking-widest text-cyan-600 shrink-0"
                                              title="Concentration"
                                            >
                                              C
                                            </span>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })()}

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

                      {/* ── Spellbook Manager (Layer 2/3/4) — known + granted + extensions + favourites + watchlist + loadouts ── */}
                      {(() => {
                        const ps = character.progressionState || {};
                        const allOwned = ps.ownedSpells || [];
                        const knownSpells = allOwned.filter(
                          (s: any) => !s?.grantedByAdvancementId,
                        );
                        const grantedSpells = allOwned.filter(
                          (s: any) => s?.grantedByAdvancementId,
                        );
                        const extensions = ps.spellListExtensions || [];
                        const favouriteSpells = allOwned.filter((s: any) => s?.isFavourite);
                        const watchlistSpells = allOwned.filter((s: any) => s?.isWatchlist);
                        const sheetLoadouts = (ps.spellLoadouts || []) as any[];

                        const resolveSourceName = (type: string, id: string) => {
                          if (type === "class") return classCache[id]?.name || `Class ${id.slice(0, 6)}`;
                          if (type === "subclass") return subclassCache[id]?.name || `Subclass ${id.slice(0, 6)}`;
                          if (type === "feature") {
                            for (const list of Object.values(featureCache)) {
                              if (!Array.isArray(list)) continue;
                              const f = list.find((x: any) => x?.id === id);
                              if (f) return f.name;
                            }
                            return `Feature ${id.slice(0, 6)}`;
                          }
                          return type;
                        };

                        if (
                          grantedSpells.length === 0 &&
                          extensions.length === 0 &&
                          knownSpells.length === 0 &&
                          favouriteSpells.length === 0 &&
                          watchlistSpells.length === 0 &&
                          sheetLoadouts.length === 0
                        ) {
                          return null;
                        }

                        return (
                          <div className="space-y-4 pt-2 border-t border-gold/10">
                            {sheetLoadouts.length > 0 && (
                              <div className="border border-purple-500/20 bg-purple-500/5 rounded-lg p-4 space-y-2">
                                <div className="text-[10px] font-black uppercase tracking-[0.2em] text-purple-700">
                                  Loadouts ({sheetLoadouts.length})
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  {sheetLoadouts.map((l: any) => {
                                    const memberCount = allOwned.filter((s: any) =>
                                      (s.loadoutMembership || []).includes(l.id),
                                    ).length;
                                    return (
                                      <div
                                        key={l.id}
                                        className={`flex items-center gap-2 px-2 py-1 rounded border text-[10px] font-bold uppercase tracking-widest ${
                                          l.isActive
                                            ? "border-purple-500/40 bg-purple-500/10 text-purple-700"
                                            : "border-gold/15 bg-card/40 text-ink/55"
                                        }`}
                                      >
                                        <span>{l.name}</span>
                                        <span className="text-ink/45">
                                          {memberCount} / {l.size || "?"}
                                        </span>
                                        {l.isActive && (
                                          <span className="text-purple-700/70 normal-case font-serif italic text-[10px]">
                                            active
                                          </span>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            {favouriteSpells.length > 0 && (
                              <div className="border border-amber-500/20 bg-amber-500/5 rounded-lg p-4">
                                <div className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-600 mb-3">
                                  ★ Favourites ({favouriteSpells.length})
                                </div>
                                <div className="flex flex-wrap gap-1">
                                  {favouriteSpells.map((s: any) => {
                                    const cached = spellNameCache[s.id];
                                    return (
                                      <span
                                        key={`fav-${s.id}`}
                                        className="text-[11px] font-bold text-amber-700 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20"
                                      >
                                        {cached?.name || s.id}
                                      </span>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            {watchlistSpells.length > 0 && (
                              <div className="border border-cyan-500/20 bg-cyan-500/5 rounded-lg p-4">
                                <div className="text-[10px] font-black uppercase tracking-[0.2em] text-cyan-700 mb-3">
                                  ◐ Watchlist ({watchlistSpells.length})
                                </div>
                                <div className="flex flex-wrap gap-1">
                                  {watchlistSpells.map((s: any) => {
                                    const cached = spellNameCache[s.id];
                                    return (
                                      <span
                                        key={`watch-${s.id}`}
                                        className="text-[11px] font-bold text-cyan-700 bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/20"
                                      >
                                        {cached?.name || s.id}
                                        {s.watchlistNote && (
                                          <span className="ml-1 italic font-serif text-cyan-600/70">
                                            ({s.watchlistNote})
                                          </span>
                                        )}
                                      </span>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                            {knownSpells.length > 0 && (
                              <div className="border border-gold/30 bg-gold/5 rounded-lg p-4">
                                <div className="flex items-center justify-between mb-3">
                                  <div className="text-[10px] font-black uppercase tracking-[0.2em] text-gold">
                                    Known Spells ({knownSpells.length})
                                  </div>
                                  <p className="text-[9px] font-serif italic text-ink/45">
                                    Player-picked from the Spell Manager
                                  </p>
                                </div>
                                {(() => {
                                  const byLevel = new Map<number, any[]>();
                                  knownSpells.forEach((s: any) => {
                                    const lvl = Number(spellNameCache[s.id]?.level ?? -1);
                                    if (!byLevel.has(lvl)) byLevel.set(lvl, []);
                                    byLevel.get(lvl)!.push(s);
                                  });
                                  const levels = Array.from(byLevel.keys()).sort((a, b) => a - b);
                                  return (
                                    <div className="space-y-3">
                                      {levels.map((lvl) => (
                                        <div key={`known-lvl-${lvl}`} className="space-y-1.5">
                                          <div className="text-[9px] font-black uppercase tracking-[0.2em] text-gold/60 px-1">
                                            {lvl < 0
                                              ? "Loading…"
                                              : lvl === 0
                                                ? "Cantrips"
                                                : `Level ${lvl}`}
                                            <span className="text-ink/35 font-bold">
                                              {" "}
                                              · {byLevel.get(lvl)!.length}
                                            </span>
                                          </div>
                                          {byLevel.get(lvl)!.map((spell: any) => {
                                            const cached = spellNameCache[spell.id];
                                            const isPrepared = !!spell.isPrepared;
                                            return (
                                              <div
                                                key={`known-${spell.id}`}
                                                className="flex items-center justify-between gap-3 px-3 py-2 bg-card/60 border border-gold/15 rounded-md"
                                              >
                                                <div className="flex-1 min-w-0">
                                                  <div className="font-serif font-bold text-ink text-sm truncate">
                                                    {cached?.name || spell.id}
                                                    {cached?.school && (
                                                      <span className="ml-2 text-[10px] font-bold uppercase tracking-widest text-ink/40">
                                                        {cached.school}
                                                      </span>
                                                    )}
                                                  </div>
                                                </div>
                                                {isPrepared && (
                                                  <span className="text-[9px] font-bold uppercase tracking-widest text-blood bg-blood/10 px-1.5 py-0.5 rounded border border-blood/30 shrink-0">
                                                    Prepared
                                                  </span>
                                                )}
                                              </div>
                                            );
                                          })}
                                        </div>
                                      ))}
                                    </div>
                                  );
                                })()}
                              </div>
                            )}

                            {grantedSpells.length > 0 && (
                              <div className="border border-emerald-500/20 bg-emerald-500/5 rounded-lg p-4">
                                <div className="flex items-center justify-between mb-3">
                                  <div className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-700">
                                    Granted Spells ({grantedSpells.length})
                                  </div>
                                  <p className="text-[9px] font-serif italic text-ink/45">
                                    From class features, subclasses, feats, etc.
                                  </p>
                                </div>
                                {(() => {
                                  const byLevel = new Map<number, any[]>();
                                  grantedSpells.forEach((s: any) => {
                                    const lvl = Number(spellNameCache[s.id]?.level ?? -1);
                                    if (!byLevel.has(lvl)) byLevel.set(lvl, []);
                                    byLevel.get(lvl)!.push(s);
                                  });
                                  const levels = Array.from(byLevel.keys()).sort((a, b) => a - b);
                                  return (
                                    <div className="space-y-3">
                                      {levels.map((lvl) => (
                                        <div key={`granted-lvl-${lvl}`} className="space-y-1.5">
                                          <div className="text-[9px] font-black uppercase tracking-[0.2em] text-emerald-700/60 px-1">
                                            {lvl < 0
                                              ? "Loading…"
                                              : lvl === 0
                                                ? "Cantrips"
                                                : `Level ${lvl}`}
                                            <span className="text-ink/35 font-bold">
                                              {" "}
                                              · {byLevel.get(lvl)!.length}
                                            </span>
                                          </div>
                                          {byLevel.get(lvl)!.map((spell: any) => {
                                            const cached = spellNameCache[spell.id];
                                            const sourceName = resolveSourceName(
                                              spell.grantedByType,
                                              spell.grantedById,
                                            );
                                            const flagBits: string[] = [];
                                            if (spell.isAlwaysPrepared) flagBits.push("Always prepared");
                                            if (spell.doesntCountAgainstPrepared)
                                              flagBits.push("Free prepared");
                                            if (spell.doesntCountAgainstKnown) flagBits.push("Free known");
                                            if (spell.countsAsClassId) {
                                              const c = classCache[spell.countsAsClassId];
                                              flagBits.push(`Counts as ${c?.name || "class"}`);
                                            }
                                            return (
                                              <div
                                                key={`${spell.grantedByAdvancementId}-${spell.id}`}
                                                className="flex items-center justify-between gap-3 px-3 py-2 bg-card/60 border border-emerald-500/10 rounded-md"
                                              >
                                                <div className="flex-1 min-w-0">
                                                  <div className="font-serif font-bold text-ink text-sm truncate">
                                                    {cached?.name || spell.id}
                                                  </div>
                                                  <div className="text-[10px] font-bold uppercase tracking-widest text-ink/45 mt-0.5 truncate">
                                                    from {sourceName}
                                                  </div>
                                                </div>
                                                {flagBits.length > 0 && (
                                                  <div className="flex flex-wrap gap-1 shrink-0">
                                                    {flagBits.map((bit) => (
                                                      <span
                                                        key={bit}
                                                        className="text-[9px] font-bold uppercase tracking-widest text-emerald-700 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20"
                                                      >
                                                        {bit}
                                                      </span>
                                                    ))}
                                                  </div>
                                                )}
                                              </div>
                                            );
                                          })}
                                        </div>
                                      ))}
                                    </div>
                                  );
                                })()}
                              </div>
                            )}

                            {extensions.length > 0 && (
                              <div className="border border-cyan-500/20 bg-cyan-500/5 rounded-lg p-4">
                                <div className="flex items-center justify-between mb-3">
                                  <div className="text-[10px] font-black uppercase tracking-[0.2em] text-cyan-700">
                                    Spell List Extensions ({extensions.length})
                                  </div>
                                  <p className="text-[9px] font-serif italic text-ink/45">
                                    Spells added to a class's available pool for this character
                                  </p>
                                </div>
                                {(() => {
                                  const byLevel = new Map<number, any[]>();
                                  extensions.forEach((ext: any) => {
                                    const lvl = Number(spellNameCache[ext.spellId]?.level ?? -1);
                                    if (!byLevel.has(lvl)) byLevel.set(lvl, []);
                                    byLevel.get(lvl)!.push(ext);
                                  });
                                  const levels = Array.from(byLevel.keys()).sort((a, b) => a - b);
                                  return (
                                    <div className="space-y-3">
                                      {levels.map((lvl) => (
                                        <div key={`ext-lvl-${lvl}`} className="space-y-1.5">
                                          <div className="text-[9px] font-black uppercase tracking-[0.2em] text-cyan-700/60 px-1">
                                            {lvl < 0
                                              ? "Loading…"
                                              : lvl === 0
                                                ? "Cantrips"
                                                : `Level ${lvl}`}
                                            <span className="text-ink/35 font-bold">
                                              {" "}
                                              · {byLevel.get(lvl)!.length}
                                            </span>
                                          </div>
                                          {byLevel.get(lvl)!.map((ext: any, idx: number) => {
                                            const cached = spellNameCache[ext.spellId];
                                            const className =
                                              classCache[ext.classId]?.name ||
                                              `Class ${ext.classId.slice(0, 6)}`;
                                            const sourceName = resolveSourceName(
                                              ext.grantedByType,
                                              ext.grantedById,
                                            );
                                            return (
                                              <div
                                                key={`${ext.classId}-${ext.spellId}-${idx}`}
                                                className="flex items-center justify-between gap-3 px-3 py-2 bg-card/60 border border-cyan-500/10 rounded-md"
                                              >
                                                <div className="flex-1 min-w-0">
                                                  <div className="font-serif font-bold text-ink text-sm truncate">
                                                    {cached?.name || ext.spellId}
                                                  </div>
                                                  <div className="text-[10px] font-bold uppercase tracking-widest text-ink/45 mt-0.5 truncate">
                                                    added to {className} list · from {sourceName}
                                                  </div>
                                                </div>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      ))}
                                    </div>
                                  );
                                })()}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              </div>
              </>
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

                                  // ── Spellbook Manager (Layer 2) ──
                                  // GrantSpells fixed mode + ExtendSpellList render
                                  // as info cards (auto-applied). GrantSpells in
                                  // choice mode emits a "spell-choice" card that
                                  // opens the picker dialog.
                                  if (
                                    adv.type === "GrantSpells" ||
                                    adv.type === "ExtendSpellList"
                                  ) {
                                    if (advLevel !== prog.level) return;
                                    const cfg = adv.configuration || {};
                                    // Choice mode pool: explicit spellIds OR
                                    // the resolved rule matches. Both kinds
                                    // open the same picker dialog.
                                    const choicePool =
                                      cfg.mode === "choice" &&
                                      adv.type === "GrantSpells"
                                        ? cfg.resolver?.kind === "rule"
                                          ? resolveRulePool(
                                              String(cfg.resolver.ruleId || ""),
                                            )
                                          : Array.isArray(cfg.resolver?.spellIds)
                                            ? cfg.resolver.spellIds
                                            : []
                                        : [];
                                    const isSpellChoice = choicePool.length > 0;

                                    choicesAtThisLevel.push({
                                      name:
                                        adv.title ||
                                        (adv.type === "GrantSpells"
                                          ? "Granted Spells"
                                          : "Extended Spell List"),
                                      count: isSpellChoice ? Number(cfg.count) || 1 : 0,
                                      type: isSpellChoice
                                        ? "spell-choice"
                                        : "advancement-info",
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

                                // ── Per-level status (Foundry-importer-inspired) ─────
                                // After processAdvancement has populated
                                // choicesAtThisLevel, classify each row as
                                // "actionable" (needs a pick) or
                                // "informational" (display only). Aggregate
                                // into a single status kind for the level
                                // header badge so players can scan which
                                // levels still need their attention — same
                                // mental model as the importer's
                                // pending/active/complete progress markers.
                                const levelChoicesStatus = (() => {
                                  let needs = 0;
                                  let done = 0;
                                  let needsSubclass = false;
                                  for (const c of choicesAtThisLevel) {
                                    const t = String(c?.type || "");
                                    if (t === "advancement-info") continue;
                                    if (t === "asi-trigger") {
                                      // ASI rows are informational here —
                                      // the actual ASI/feat application
                                      // happens via the Point Buy modal +
                                      // ASI sheet controls, not via a
                                      // single completion flag on this
                                      // row. Skip so they don't gate
                                      // level-completion.
                                      continue;
                                    }
                                    if (t === "subclass-trigger") {
                                      needs += 1;
                                      needsSubclass = true;
                                      // A "subclass-trigger" only fires
                                      // when no subclass has been picked
                                      // (the matchedSubclass-present branch
                                      // emits "advancement-info" instead),
                                      // so we always count it as pending.
                                      continue;
                                    }
                                    const need = Number(c?.count ?? 0) || 0;
                                    if (need <= 0) continue;
                                    needs += 1;
                                    const sel = getAdvancementSelectionValues(
                                      selectedOptionsMap,
                                      {
                                        sourceScope: c?.sourceScope || "",
                                        advancementId: c?.advId || "",
                                        level: c?.level ?? prog.level,
                                      },
                                    );
                                    if (sel.length >= need) done += 1;
                                  }
                                  if (needs === 0) {
                                    return { kind: "info-only" as const, needs, done, needsSubclass };
                                  }
                                  if (done === 0) {
                                    return { kind: "pending" as const, needs, done, needsSubclass };
                                  }
                                  if (done < needs) {
                                    return { kind: "partial" as const, needs, done, needsSubclass };
                                  }
                                  return { kind: "complete" as const, needs, done, needsSubclass };
                                })();

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
                                      {/* Status pip — mirrors the importer's
                                          progress markers. Hidden for
                                          info-only levels (nothing to do
                                          here) so the rail stays uncluttered. */}
                                      {levelChoicesStatus.kind !== "info-only" && (
                                        <div
                                          className={cn(
                                            "mt-1 px-1.5 py-0.5 rounded-sm border text-[8px] font-black uppercase tracking-widest text-center",
                                            levelChoicesStatus.kind === "complete"
                                              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700"
                                              : levelChoicesStatus.kind === "partial"
                                                ? "border-gold/40 bg-gold/10 text-gold"
                                                : "border-blood/30 bg-blood/5 text-blood",
                                          )}
                                          title={
                                            levelChoicesStatus.kind === "complete"
                                              ? `All ${levelChoicesStatus.needs} choice${levelChoicesStatus.needs === 1 ? "" : "s"} resolved.`
                                              : levelChoicesStatus.kind === "partial"
                                                ? `${levelChoicesStatus.done} of ${levelChoicesStatus.needs} choices resolved.`
                                                : levelChoicesStatus.needsSubclass
                                                  ? `Pick a subclass + ${levelChoicesStatus.needs - 1} other choice${levelChoicesStatus.needs - 1 === 1 ? "" : "s"}.`
                                                  : `${levelChoicesStatus.needs} choice${levelChoicesStatus.needs === 1 ? "" : "s"} to make.`
                                          }
                                        >
                                          {levelChoicesStatus.kind === "complete"
                                            ? "Done"
                                            : `${levelChoicesStatus.done}/${levelChoicesStatus.needs}`}
                                        </div>
                                      )}
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
                                                        This level grants an ability score improvement. Use Point Buy below to rebudget your scores, or apply the increase via the
                                                        ± controls on the sheet.
                                                      </p>
                                                      <Button
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={() => setShowPointBuy(true)}
                                                        className="w-full border-dashed border-sky-500/40 text-sky-700 hover:bg-sky-500/10 hover:border-sky-500 font-bold tracking-widest uppercase text-[10px]"
                                                      >
                                                        <Edit2 className="w-3 h-3 mr-2" />
                                                        Open Point Buy
                                                      </Button>
                                                    </div>
                                                  );
                                                }

                                                if (
                                                  choice.type === "spell-choice"
                                                ) {
                                                  // ── Spellbook Manager (Layer 2) ──
                                                  // GrantSpells choice-mode card.
                                                  // Pool: explicit spellIds OR the
                                                  // resolved rule matches.
                                                  const cfg = choice.configuration || {};
                                                  const poolIds: string[] =
                                                    cfg.resolver?.kind === "rule"
                                                      ? resolveRulePool(
                                                          String(cfg.resolver.ruleId || ""),
                                                        )
                                                      : Array.isArray(cfg.resolver?.spellIds)
                                                        ? cfg.resolver.spellIds
                                                        : [];
                                                  const sel = getAdvancementSelectionValues(
                                                    selectedOptionsMap,
                                                    {
                                                      sourceScope: choice.sourceScope,
                                                      advancementId: choice.advId,
                                                      level: choice.level,
                                                    },
                                                  );
                                                  return (
                                                    <div
                                                      key={`spell-choice-${cidx}`}
                                                      className="bg-emerald-500/5 border border-emerald-500/25 rounded-md p-4 mt-2 mb-4 ml-[3px]"
                                                    >
                                                      <div className="flex items-center justify-between mb-2">
                                                        <span className="font-serif font-bold text-ink text-sm uppercase tracking-wider flex items-center gap-2">
                                                          <Zap className="w-4 h-4 text-emerald-600" />
                                                          {choice.name}
                                                        </span>
                                                        <span className="text-[9px] font-black uppercase tracking-[0.2em] text-emerald-700">
                                                          {sel.length} / {choice.count} chosen
                                                        </span>
                                                      </div>
                                                      {sel.length > 0 && (
                                                        <div className="flex flex-wrap gap-1 mb-3">
                                                          {sel.map((sid: string) => (
                                                            <span
                                                              key={sid}
                                                              className="bg-emerald-500/10 text-emerald-700 px-1.5 py-0.5 rounded border border-emerald-500/20 text-[10px]"
                                                            >
                                                              {spellNameCache[sid]?.name || sid}
                                                            </span>
                                                          ))}
                                                        </div>
                                                      )}
                                                      <Button
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={() =>
                                                          setSpellChoiceDialogOpen({
                                                            name: choice.name,
                                                            count: choice.count,
                                                            advId: choice.advId,
                                                            level: choice.level,
                                                            sourceScope:
                                                              choice.sourceScope || "",
                                                            resolverKind:
                                                              cfg.resolver?.kind === "rule"
                                                                ? "rule"
                                                                : "explicit",
                                                            explicitSpellIds: Array.isArray(
                                                              cfg.resolver?.spellIds,
                                                            )
                                                              ? cfg.resolver.spellIds
                                                              : [],
                                                            ruleId: String(
                                                              cfg.resolver?.ruleId || "",
                                                            ),
                                                          })
                                                        }
                                                        className="w-full border-dashed border-emerald-500/40 text-emerald-700 hover:bg-emerald-500/10 hover:border-emerald-500 font-bold tracking-widest uppercase text-[10px]"
                                                      >
                                                        <Plus className="w-3 h-3 mr-2" />
                                                        {sel.length === 0
                                                          ? "Choose Spells"
                                                          : "Edit Spell Choices"}
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
                                                      {(choice.advType ===
                                                        "GrantSpells" ||
                                                        choice.advType ===
                                                          "ExtendSpellList") && (() => {
                                                        const cfg = choice.configuration || {};
                                                        const isRule =
                                                          cfg?.resolver?.kind === "rule";
                                                        const ruleId = String(
                                                          cfg?.resolver?.ruleId || "",
                                                        );
                                                        const rule = isRule
                                                          ? spellRulesById[ruleId]
                                                          : null;
                                                        const spellIds = isRule
                                                          ? resolveRulePool(ruleId)
                                                          : Array.isArray(cfg.resolver?.spellIds)
                                                            ? cfg.resolver.spellIds
                                                            : [];
                                                        const flagBits = [];
                                                        if (choice.advType === "GrantSpells") {
                                                          if (cfg.alwaysPrepared)
                                                            flagBits.push("Always prepared");
                                                          if (cfg.doesntCountAgainstPrepared)
                                                            flagBits.push("Free prepared");
                                                          if (cfg.doesntCountAgainstKnown)
                                                            flagBits.push("Free known");
                                                          if (cfg.mode === "choice")
                                                            flagBits.push(`Pick ${cfg.count || 1}`);
                                                        }
                                                        if (choice.advType === "ExtendSpellList") {
                                                          flagBits.push(
                                                            `Scope: ${cfg.scope || "self"}`,
                                                          );
                                                        }
                                                        return (
                                                          <div className="mt-1 space-y-1">
                                                            {flagBits.length > 0 && (
                                                              <p className="text-ink/45 text-[9px] font-bold uppercase tracking-widest">
                                                                {flagBits.join(" · ")}
                                                              </p>
                                                            )}
                                                            {isRule && (
                                                              <p className="text-ink/55 text-[10px] font-bold uppercase tracking-widest">
                                                                Rule:{" "}
                                                                {rule?.name || ruleId.slice(0, 6)}{" "}
                                                                <span className="text-ink/35">
                                                                  · {spellIds.length} matches
                                                                </span>
                                                              </p>
                                                            )}
                                                            {spellIds.length === 0 ? (
                                                              <p className="text-ink/50 italic text-[10px]">
                                                                {isRule && !allSpellSummaries
                                                                  ? "Loading rule matches…"
                                                                  : "No spells in pool."}
                                                              </p>
                                                            ) : (
                                                              <div className="flex flex-wrap gap-1">
                                                                {spellIds.slice(0, 12).map((spellId: string) => {
                                                                  const cached =
                                                                    spellNameCache[spellId];
                                                                  return (
                                                                    <span
                                                                      key={spellId}
                                                                      className={
                                                                        choice.advType ===
                                                                        "GrantSpells"
                                                                          ? "bg-emerald-500/10 text-emerald-700 px-1.5 py-0.5 rounded border border-emerald-500/20"
                                                                          : "bg-cyan-500/10 text-cyan-700 px-1.5 py-0.5 rounded border border-cyan-500/20"
                                                                      }
                                                                    >
                                                                      {cached?.name || spellId}
                                                                    </span>
                                                                  );
                                                                })}
                                                                {spellIds.length > 12 && (
                                                                  <span className="text-ink/40 px-1.5 py-0.5 text-[10px]">
                                                                    +{spellIds.length - 12} more
                                                                  </span>
                                                                )}
                                                              </div>
                                                            )}
                                                          </div>
                                                        );
                                                      })()}
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
          ) : activeStep === "spells" ? (
            (() => {
              // ── Spell Manager (Layer 3 starter) ──
              // Per-class browser of available spells: master class list +
              // per-character extensions. Player can mark spells known/prepared.
              // Granted spells (from advancements) display as locked rows.
              const ps = character.progressionState || {};
              const ownedSpells = ps.ownedSpells || [];
              const extensions = ps.spellListExtensions || [];

              // Build the active class's pool: class_spell_lists ∪ extensions
              const activeClassId =
                activeSpellManagerClassId ||
                (spellcastingClassIds[0] ?? "");
              const activeClass = activeClassId ? classCache[activeClassId] : null;
              // Active-class quick lookup map used by the inline per-spell
              // rows in the tree below. Per-class pool building happens
              // inside the tree IIFE (see the body section) so each
              // class's spells can render in one pass.
              const ownedSpellMap = new Map<string, any>(
                ownedSpells.map((s: any) => [s.id, s]),
              );

              // Counters for the active class. Granted spells with
              // doesntCountAgainstKnown are excluded from the cap counts (Magic
              // Initiate, Chronomancy Initiate, etc).
              const countsTowardsActiveClass = (s: any) => {
                if (!s) return false;
                if (s.grantedByAdvancementId) {
                  if (s.doesntCountAgainstKnown) return false;
                  return s.countsAsClassId
                    ? s.countsAsClassId === activeClassId
                    : true;
                }
                return true;
              };
              const ownedForClass = ownedSpells.filter(countsTowardsActiveClass);
              const knownCount = ownedForClass.length;
              const preparedCount = ownedSpells.filter(
                (s: any) => s?.isPrepared || s?.isAlwaysPrepared,
              ).length;

              // Detect cap scaling columns by name. If the class authors them
              // as "Cantrips Known" / "Spells Known" scale columns, we display
              // the cap and block over-cap selection. If absent, no cap is
              // enforced (current behaviour preserved). Match is case-insensitive
              // and tolerates "Cantrips" → "Cantrips Known" abbreviation.
              const matchCapColumn = (pattern: RegExp) => {
                for (const col of Object.values(scalingCache) as any[]) {
                  if (!col || col.parentId !== activeClassId) continue;
                  const name = String(col.name || "").trim();
                  if (pattern.test(name)) {
                    const v = resolveScaleValueAtLevel(
                      col,
                      progressionClassGroups.find(
                        (g: any) => g.classId === activeClassId,
                      )?.classLevel || 0,
                    );
                    const n = Number(v);
                    if (Number.isFinite(n)) return n;
                  }
                }
                return null;
              };
              const cantripsCap = matchCapColumn(/^cantrips\s*(known)?$/i);
              const spellsCap = matchCapColumn(/^spells\s*known$/i);

              const cantripsKnownCount = ownedForClass.filter((s: any) => {
                const lvl = spellNameCache[s.id]?.level;
                return lvl === 0;
              }).length;
              const spellsKnownCount = ownedForClass.filter((s: any) => {
                const lvl = spellNameCache[s.id]?.level;
                return lvl !== undefined && lvl > 0;
              }).length;
              const atCantripsCap =
                cantripsCap !== null && cantripsKnownCount >= cantripsCap;
              const atSpellsCap = spellsCap !== null && spellsKnownCount >= spellsCap;

              const togglePlayerKnown = (
                spellId: string,
                spellLevel: number,
                spellRequiredTags: string[] = [],
              ) => {
                setCharacter((prev: any) => {
                  const psPrev = prev.progressionState || {};
                  const owned = psPrev.ownedSpells || [];
                  const existing = owned.find((s: any) => s.id === spellId);
                  // Don't let players toggle granted spells off; they're locked.
                  if (existing?.grantedByAdvancementId) return prev;
                  let nextOwned;
                  if (existing) {
                    nextOwned = owned.filter((s: any) => s.id !== spellId);
                  } else {
                    // Block adding when prereqs aren't met.
                    if (
                      spellRequiredTags.length > 0 &&
                      !characterMeetsSpellPrerequisites(effectiveTagSet, {
                        requiredTags: spellRequiredTags,
                      }, tagParentMap)
                    ) {
                      return prev;
                    }
                    // Enforce caps when set. Adding a cantrip while at cantrip
                    // cap or a leveled spell while at spells-known cap silently
                    // no-ops; the UI reflects the cap state separately.
                    const isCantrip = spellLevel === 0;
                    if (isCantrip && atCantripsCap) return prev;
                    if (!isCantrip && atSpellsCap) return prev;
                    nextOwned = [
                      ...owned,
                      {
                        id: spellId,
                        sourceId: null,
                        isPrepared: false,
                        isAlwaysPrepared: false,
                        grantedByType: null,
                        grantedById: null,
                        grantedByAdvancementId: null,
                        countsAsClassId: null,
                        doesntCountAgainstPrepared: false,
                        doesntCountAgainstKnown: false,
                        isFavourite: false,
                        isWatchlist: false,
                        watchlistNote: '',
                        loadoutMembership: [],
                      },
                    ];
                  }
                  return {
                    ...prev,
                    progressionState: { ...psPrev, ownedSpells: nextOwned },
                  };
                });
              };

              const togglePrepared = (spellId: string) => {
                setCharacter((prev: any) => {
                  const psPrev = prev.progressionState || {};
                  const owned = psPrev.ownedSpells || [];
                  const nextOwned = owned.map((s: any) =>
                    s.id === spellId
                      ? {
                          ...s,
                          isPrepared: s.isAlwaysPrepared
                            ? true
                            : !s.isPrepared,
                        }
                      : s,
                  );
                  return {
                    ...prev,
                    progressionState: { ...psPrev, ownedSpells: nextOwned },
                  };
                });
              };

              const toggleFavourite = (spellId: string) => {
                setCharacter((prev: any) => {
                  const psPrev = prev.progressionState || {};
                  const owned = psPrev.ownedSpells || [];
                  const existing = owned.find((s: any) => s.id === spellId);
                  // Players can favourite spells they don't yet know — auto-create
                  // a stub entry so the favourite persists.
                  let nextOwned;
                  if (existing) {
                    nextOwned = owned.map((s: any) =>
                      s.id === spellId ? { ...s, isFavourite: !s.isFavourite } : s,
                    );
                  } else {
                    nextOwned = [
                      ...owned,
                      {
                        id: spellId,
                        sourceId: null,
                        isPrepared: false,
                        isAlwaysPrepared: false,
                        grantedByType: null,
                        grantedById: null,
                        grantedByAdvancementId: null,
                        countsAsClassId: null,
                        doesntCountAgainstPrepared: false,
                        doesntCountAgainstKnown: false,
                        isFavourite: true,
                        isWatchlist: false,
                        watchlistNote: '',
                        loadoutMembership: [],
                      },
                    ];
                  }
                  return {
                    ...prev,
                    progressionState: { ...psPrev, ownedSpells: nextOwned },
                  };
                });
              };

              const toggleWatchlist = (spellId: string) => {
                setCharacter((prev: any) => {
                  const psPrev = prev.progressionState || {};
                  const owned = psPrev.ownedSpells || [];
                  const existing = owned.find((s: any) => s.id === spellId);
                  let nextOwned;
                  if (existing) {
                    nextOwned = owned.map((s: any) =>
                      s.id === spellId ? { ...s, isWatchlist: !s.isWatchlist } : s,
                    );
                  } else {
                    nextOwned = [
                      ...owned,
                      {
                        id: spellId,
                        sourceId: null,
                        isPrepared: false,
                        isAlwaysPrepared: false,
                        grantedByType: null,
                        grantedById: null,
                        grantedByAdvancementId: null,
                        countsAsClassId: null,
                        doesntCountAgainstPrepared: false,
                        doesntCountAgainstKnown: false,
                        isFavourite: false,
                        isWatchlist: true,
                        watchlistNote: '',
                        loadoutMembership: [],
                      },
                    ];
                  }
                  return {
                    ...prev,
                    progressionState: { ...psPrev, ownedSpells: nextOwned },
                  };
                });
              };

              // ── Layer 4: Loadouts ──
              const loadouts = (ps.spellLoadouts || []) as any[];
              const activeLoadouts = loadouts.filter((l: any) => l?.isActive);

              const createLoadout = () => {
                const name = window.prompt("Loadout name?", "Combat");
                if (!name) return;
                const sizeStr = window.prompt(
                  "How many spells does this loadout hold?",
                  "5",
                );
                const size = Math.max(0, Number(sizeStr || 0) || 0);
                const newLoadout = {
                  id: crypto.randomUUID(),
                  name: name.trim(),
                  size,
                  isActive: true,
                  sortOrder: loadouts.length,
                };
                setCharacter((prev: any) => ({
                  ...prev,
                  progressionState: {
                    ...(prev.progressionState || {}),
                    spellLoadouts: [...(prev.progressionState?.spellLoadouts || []), newLoadout],
                  },
                }));
              };

              const updateLoadout = (loadoutId: string, patch: Record<string, any>) => {
                setCharacter((prev: any) => ({
                  ...prev,
                  progressionState: {
                    ...(prev.progressionState || {}),
                    spellLoadouts: (prev.progressionState?.spellLoadouts || []).map((l: any) =>
                      l.id === loadoutId ? { ...l, ...patch } : l,
                    ),
                  },
                }));
              };

              const deleteLoadout = (loadoutId: string) => {
                if (!window.confirm("Delete this loadout?")) return;
                setCharacter((prev: any) => {
                  const psPrev = prev.progressionState || {};
                  return {
                    ...prev,
                    progressionState: {
                      ...psPrev,
                      spellLoadouts: (psPrev.spellLoadouts || []).filter(
                        (l: any) => l.id !== loadoutId,
                      ),
                      // Strip the deleted loadout's id from every spell's membership.
                      ownedSpells: (psPrev.ownedSpells || []).map((s: any) => ({
                        ...s,
                        loadoutMembership: Array.isArray(s.loadoutMembership)
                          ? s.loadoutMembership.filter((id: string) => id !== loadoutId)
                          : [],
                      })),
                    },
                  };
                });
              };

              const toggleLoadoutMembership = (spellId: string, loadoutId: string) => {
                setCharacter((prev: any) => {
                  const psPrev = prev.progressionState || {};
                  const owned = psPrev.ownedSpells || [];
                  const nextOwned = owned.map((s: any) => {
                    if (s.id !== spellId) return s;
                    const cur = Array.isArray(s.loadoutMembership) ? s.loadoutMembership : [];
                    return {
                      ...s,
                      loadoutMembership: cur.includes(loadoutId)
                        ? cur.filter((id: string) => id !== loadoutId)
                        : [...cur, loadoutId],
                    };
                  });
                  return {
                    ...prev,
                    progressionState: { ...psPrev, ownedSpells: nextOwned },
                  };
                });
              };

              const isInActiveLoadout = (spell: any) => {
                if (!spell?.loadoutMembership?.length) return false;
                return spell.loadoutMembership.some((lid: string) =>
                  activeLoadouts.some((l: any) => l.id === lid),
                );
              };

              // Effective prepared = always_prepared ∪ active-loadout members ∪ legacy isPrepared.
              const effectivePreparedSet = new Set<string>();
              ownedSpells.forEach((s: any) => {
                if (s?.isAlwaysPrepared || s?.isPrepared || isInActiveLoadout(s)) {
                  effectivePreparedSet.add(s.id);
                }
              });
              const effectivePreparedCount = effectivePreparedSet.size;
              const favouriteCount = ownedSpells.filter((s: any) => s?.isFavourite).length;
              const watchlistCount = ownedSpells.filter((s: any) => s?.isWatchlist).length;

              if (spellcastingClassIds.length === 0) {
                return (
                  <div className="bg-background/50 p-8 rounded-xl border border-gold/10 h-full flex flex-col items-center justify-center text-center">
                    <div className="w-24 h-24 bg-gold/5 rounded-full flex items-center justify-center mb-6 border border-gold/20">
                      <Zap className="w-10 h-10 text-gold" />
                    </div>
                    <h2 className="text-2xl font-serif font-black text-ink mb-2 uppercase tracking-tight">
                      Spell Manager
                    </h2>
                    <p className="text-ink/60 max-w-sm font-serif italic mb-8">
                      No spellcasting class on this character yet.
                    </p>
                    <Button
                      onClick={() => setActiveStep("class")}
                      variant="outline"
                      className="border-gold/30 text-gold hover:bg-gold/5 uppercase tracking-widest text-xs font-black"
                    >
                      Add a Class
                    </Button>
                  </div>
                );
              }

              // ── Variant C (Spell Manager redesign) prep ─────────────
              // Per-class DC + Atk for the top header strip. Computed from
              // the spellcastingContributors record (which already resolves
              // the spellcasting ability) and the character's current
              // ability scores + proficiency bonus.
              const abilityMod = (ab: string | null | undefined) => {
                if (!ab) return 0;
                const score = Number(character?.stats?.base?.[ab] ?? character?.stats?.base?.[ab?.toUpperCase()] ?? 10);
                return Math.floor((score - 10) / 2);
              };
              const profBonus = Number(character?.proficiencyBonus ?? 2);
              const contributorByClass = new Map<string, any>();
              for (const c of spellcastingContributors) {
                if (c?.classId) contributorByClass.set(c.classId, c);
              }
              const dcForClass = (cid: string) => {
                const ab = contributorByClass.get(cid)?.ability
                  || String(classCache[cid]?.spellcasting?.ability || '').toUpperCase();
                return 8 + profBonus + abilityMod(ab);
              };
              const atkForClass = (cid: string) => {
                const ab = contributorByClass.get(cid)?.ability
                  || String(classCache[cid]?.spellcasting?.ability || '').toUpperCase();
                const n = profBonus + abilityMod(ab);
                return n >= 0 ? `+${n}` : `${n}`;
              };

              const toggleClassCollapsed = (cid: string) => {
                setSpellsCollapsedClasses(prev => {
                  const next = new Set(prev);
                  next.has(cid) ? next.delete(cid) : next.add(cid);
                  return next;
                });
              };
              const toggleLevelCollapsed = (key: string) => {
                setSpellsCollapsedLevels(prev => {
                  const next = new Set(prev);
                  next.has(key) ? next.delete(key) : next.add(key);
                  return next;
                });
              };

              return (
                <div className="space-y-3">
                  {/* ── Class header strip — Variant C ─────────────
                       Per-class chips (active highlighted) + Save DC /
                       Atk for the active class + counters. Replaces
                       the old "tabs + counters" + "class tabs" rows. */}
                  <div className="flex items-center gap-3 px-3 py-2 bg-gold/5 border border-gold/15 rounded-md flex-wrap">
                    <div className="flex gap-1">
                      {spellcastingClassIds.map((cid) => {
                        const c = classCache[cid];
                        const isActive = cid === activeClassId;
                        return (
                          <button
                            key={cid}
                            type="button"
                            onClick={() => {
                              setActiveSpellManagerClassId(cid);
                              setSelectedSpellId(null);
                            }}
                            className={cn(
                              "px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] border transition-colors",
                              isActive
                                ? "bg-gold text-white border-gold"
                                : "bg-transparent text-ink/55 border-gold/25 hover:border-gold/50 hover:text-ink",
                            )}
                          >
                            {c?.name || `Class ${cid.slice(0, 6)}`}
                          </button>
                        );
                      })}
                    </div>

                    <div className="w-px h-7 bg-gold/20" />

                    <div className="flex flex-col gap-0.5">
                      <span className="text-[7px] font-black uppercase tracking-[0.16em] text-ink/50">
                        {activeClass?.name || "Class"} Spell Save DC
                      </span>
                      <span className="font-mono text-base font-black text-gold leading-none">
                        {dcForClass(activeClassId)}
                      </span>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[7px] font-black uppercase tracking-[0.16em] text-ink/50">
                        {activeClass?.name || "Class"} Atk Bonus
                      </span>
                      <span className="font-mono text-base font-black text-gold leading-none">
                        {atkForClass(activeClassId)}
                      </span>
                    </div>

                    <div className="ml-auto flex items-center gap-3 text-[10px] font-bold uppercase tracking-widest text-ink/55 flex-wrap">
                      {cantripsCap !== null && (
                        <span>
                          Cantrips:{" "}
                          <span className={atCantripsCap ? "text-blood" : "text-gold"}>
                            {cantripsKnownCount} / {cantripsCap}
                          </span>
                        </span>
                      )}
                      {spellsCap !== null && (
                        <>
                          {cantripsCap !== null && <span className="text-ink/20">·</span>}
                          <span>
                            Spells:{" "}
                            <span className={atSpellsCap ? "text-blood" : "text-gold"}>
                              {spellsKnownCount} / {spellsCap}
                            </span>
                          </span>
                        </>
                      )}
                      {cantripsCap === null && spellsCap === null && (
                        <span>
                          Known: <span className="text-gold">{knownCount}</span>
                        </span>
                      )}
                      <span className="text-ink/20">·</span>
                      <span>
                        Prepared: <span className="text-blood">{effectivePreparedCount}</span>
                      </span>
                      <span className="text-ink/20">·</span>
                      <span>
                        ★ <span className="text-amber-500">{favouriteCount}</span>
                      </span>
                      <span className="text-ink/20">·</span>
                      <span>
                        ◐ <span className="text-cyan-500">{watchlistCount}</span>
                      </span>
                    </div>
                  </div>

                  {/* Filter shell (search + filter button + chips + axes
                      panel). Lives ABOVE the tree so the search bar
                      sits next to the class header per the Variant C
                      design. */}
                  <SpellFilterShell
                    filters={spellManagerFilters}
                    sources={spellManagerSources}
                    tags={spellManagerTags}
                    tagGroups={spellManagerTagGroups}
                    searchPlaceholder="Search this class's spells..."
                  />

                  {/* Combined row: state filter pills + Loadouts.
                      Previously the Loadouts panel was a heavy purple
                      block that pushed the tree down; collapsed here
                      to a slim <details> on the right so power-user
                      functionality is one click away without
                      dominating the layout. */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => setShowFavouritesOnly(v => !v)}
                      className={cn(
                        "text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded border transition-colors",
                        showFavouritesOnly
                          ? "border-amber-500/60 bg-amber-500/15 text-amber-600"
                          : "border-gold/15 bg-card/40 text-ink/55 hover:border-amber-500/30",
                      )}
                    >
                      ★ Favourites only
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowWatchlistOnly(v => !v)}
                      className={cn(
                        "text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded border transition-colors",
                        showWatchlistOnly
                          ? "border-cyan-500/60 bg-cyan-500/15 text-cyan-700"
                          : "border-gold/15 bg-card/40 text-ink/55 hover:border-cyan-500/30",
                      )}
                    >
                      ◐ Watchlist only
                    </button>
                    {activeLoadouts.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowLoadoutOnly(v => !v)}
                        className={cn(
                          "text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded border transition-colors",
                          showLoadoutOnly
                            ? "border-purple-500/60 bg-purple-500/15 text-purple-700"
                            : "border-gold/15 bg-card/40 text-ink/55 hover:border-purple-500/30",
                        )}
                      >
                        Active loadouts only
                      </button>
                    )}

                    <details className="ml-auto group">
                      <summary className="cursor-pointer list-none flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded border border-purple-500/20 bg-purple-500/5 text-purple-700 hover:border-purple-500/40 transition-colors">
                        <ChevronDown className="w-3 h-3 transition-transform group-open:rotate-180" />
                        <span>
                          Loadouts ({loadouts.length})
                          {activeLoadouts.length > 0 && (
                            <span className="text-purple-700/60 ml-1 normal-case">
                              · {activeLoadouts.length} active
                            </span>
                          )}
                        </span>
                      </summary>
                      <div className="mt-2 p-2 border border-purple-500/20 bg-purple-500/5 rounded-md space-y-2 w-full max-w-xl">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[9px] font-black uppercase tracking-[0.18em] text-purple-700/80">
                            Compose your prepared sets
                          </span>
                          <button
                            type="button"
                            onClick={createLoadout}
                            className="text-[10px] font-bold uppercase tracking-widest text-purple-700 bg-purple-500/10 px-2 py-0.5 rounded border border-purple-500/30 hover:bg-purple-500/20"
                          >
                            + New Loadout
                          </button>
                        </div>
                        {loadouts.length === 0 ? (
                          <p className="text-[11px] font-serif italic text-ink/45">
                            Create a loadout to compose your prepared spells.
                            Multiple loadouts can be active at once.
                          </p>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            {loadouts.map((l: any) => {
                              const memberCount = ownedSpells.filter((s: any) =>
                                (s.loadoutMembership || []).includes(l.id),
                              ).length;
                              const overSize = l.size > 0 && memberCount > l.size;
                              return (
                                <div
                                  key={l.id}
                                  className={cn(
                                    "flex items-center gap-2 px-2 py-1 rounded border",
                                    l.isActive
                                      ? "border-purple-500/40 bg-purple-500/10"
                                      : "border-gold/15 bg-card/40",
                                  )}
                                >
                                  <button
                                    type="button"
                                    onClick={() => updateLoadout(l.id, { isActive: !l.isActive })}
                                    title={l.isActive ? "Deactivate" : "Activate"}
                                    className={cn(
                                      "w-3 h-3 rounded border-2 flex-shrink-0",
                                      l.isActive
                                        ? "bg-purple-600 border-purple-600"
                                        : "border-purple-500/40",
                                    )}
                                  />
                                  <input
                                    type="text"
                                    value={l.name}
                                    onChange={(e) => updateLoadout(l.id, { name: e.target.value })}
                                    className="bg-transparent text-xs font-bold text-ink border-0 outline-none focus:ring-1 focus:ring-purple-500/40 rounded px-1 w-24"
                                  />
                                  <span
                                    className={cn(
                                      "text-[10px] font-bold uppercase tracking-widest",
                                      overSize ? "text-blood" : "text-ink/45",
                                    )}
                                  >
                                    {memberCount} / {l.size || "?"}
                                  </span>
                                  <input
                                    type="number"
                                    min={0}
                                    value={l.size}
                                    onChange={(e) =>
                                      updateLoadout(l.id, { size: Math.max(0, Number(e.target.value || 0) || 0) })
                                    }
                                    className="bg-transparent text-[10px] text-ink/55 border border-gold/15 outline-none focus:ring-1 focus:ring-purple-500/40 rounded px-1 w-10 text-center"
                                    title="Size cap (informational)"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => deleteLoadout(l.id)}
                                    title="Delete"
                                    className="text-[10px] text-blood/70 hover:text-blood px-1"
                                  >
                                    ×
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </details>
                  </div>

                  {/* Effective tag set — drives spell prerequisite gating */}
                  {effectiveTagAttributions.size > 0 && (
                    <details className="border border-gold/15 bg-card/30 rounded-md px-3 py-2 text-[11px]">
                      <summary className="cursor-pointer flex items-center justify-between gap-2 font-bold uppercase tracking-widest text-ink/55">
                        <span>
                          Character tags ({effectiveTagAttributions.size})
                        </span>
                        <span className="text-[9px] font-bold uppercase tracking-widest text-ink/40 normal-case">
                          Drives spell prereqs
                        </span>
                      </summary>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {Array.from(effectiveTagAttributions.values()).map((attr: any) => {
                          const tagName =
                            spellManagerTags.find((t: any) => t.id === attr.tagId)?.name ||
                            attr.tagId;
                          return (
                            <span
                              key={attr.tagId}
                              title={`from ${attr.source}: ${attr.sourceName}`}
                              className="bg-gold/10 text-gold px-1.5 py-0.5 rounded border border-gold/20 text-[10px] font-bold uppercase tracking-widest"
                            >
                              {tagName}
                            </span>
                          );
                        })}
                      </div>
                    </details>
                  )}

                  {/* ── Two-pane body — Variant C ─────────────────────
                       Left pane: grouped Class › Level tree showing
                       ALL spellcasting classes at once. Class header
                       is sticky inside the scroll, and the Prepare
                       button per class opens the focused modal (still
                       wip — Phase 2 follow-up).
                       Right pane: SpellDetailPanel for the selected
                       spell (sticky on lg+ viewports). */}
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
                    <div className="min-w-0">
                      {(() => {
                        // Build per-class filtered pools so we can render the
                        // entire spell tree (all classes) in one pass. The old
                        // implementation only computed the active class's pool;
                        // Variant C wants every spellcasting class visible at
                        // once, with the per-class header doubling as both a
                        // section divider and an active-class toggle.
                        const tagsByIdLocal = Object.fromEntries(
                          spellManagerTags.map((t: any) => [t.id, t]),
                        );

                        const buildPoolForClass = (cid: string) => {
                          const base = classSpellPools[cid] || [];
                          const extIdsForClass = (extensions as any[])
                            .filter((e: any) => e.classId === cid)
                            .map((e: any) => e.spellId);
                          const extEntriesLocal = extIdsForClass
                            .filter((id: string) => !base.some((s: any) => s.id === id))
                            .map((id: string) => {
                              const cached = spellNameCache[id];
                              return {
                                id,
                                name: cached?.name || id,
                                level: cached?.level ?? 0,
                                school: cached?.school || "",
                                image_url: null,
                                source_id: null,
                                tags: [],
                                membershipId: `ext-${id}`,
                                membershipSource: "extension",
                                addedAt: "",
                                isExtension: true,
                              };
                            });
                          return [...base, ...extEntriesLocal]
                            .map((spell: any) => {
                              if (spell.activationBucket) return spell;
                              const fromCatalog = facetEnrichedSpellSummaries?.find(
                                (s: any) => s.id === spell.id,
                              );
                              return fromCatalog ? { ...spell, ...fromCatalog } : spell;
                            })
                            .sort((a: any, b: any) => {
                              if ((a.level || 0) !== (b.level || 0))
                                return (a.level || 0) - (b.level || 0);
                              return String(a.name || "").localeCompare(String(b.name || ""));
                            });
                        };

                        const applyStatePills = (spells: any[]) => {
                          if (!showFavouritesOnly && !showWatchlistOnly && !showLoadoutOnly) {
                            return spells;
                          }
                          return spells.filter((spell: any) => {
                            const owned = ownedSpells.find((s: any) => s.id === spell.id);
                            if (!owned) return false;
                            if (showFavouritesOnly && !owned.isFavourite) return false;
                            if (showWatchlistOnly && !owned.isWatchlist) return false;
                            if (showLoadoutOnly) {
                              const inActive = (owned.loadoutMembership || []).some(
                                (lid: string) => activeLoadouts.some((l: any) => l.id === lid),
                              );
                              if (!inActive) return false;
                            }
                            return true;
                          });
                        };

                        const perClassPools = spellcastingClassIds.map((cid) => {
                          const baseTotal = (classSpellPools[cid] || []).length;
                          const pool = buildPoolForClass(cid);
                          const filteredEntries = spellManagerFilters.filter(
                            pool as any,
                            tagsByIdLocal,
                          );
                          const filtered = applyStatePills(filteredEntries.map((e: any) => e.spell));
                          return {
                            cid,
                            cls: classCache[cid],
                            loaded: !!classSpellPools[cid],
                            baseTotal,
                            poolTotal: pool.length,
                            filtered,
                          };
                        });

                        const grandTotal = perClassPools.reduce((sum, p) => sum + p.filtered.length, 0);
                        const grandBase = perClassPools.reduce((sum, p) => sum + p.poolTotal, 0);
                        const allEmpty = perClassPools.every((p) => p.loaded && p.poolTotal === 0);

                        if (perClassPools.some((p) => !p.loaded)) {
                          return (
                            <div className="text-sm text-ink/45 font-serif italic p-4">
                              Loading class spell lists…
                            </div>
                          );
                        }
                        if (allEmpty) {
                          return (
                            <div className="text-sm text-ink/45 font-serif italic p-4 border border-gold/10 rounded-md bg-card/40">
                              No spells on any of this character's class spell
                              lists yet. Curate them in /compendium/spell-lists.
                            </div>
                          );
                        }
                        if (grandTotal === 0) {
                          return (
                            <div className="text-sm text-ink/45 font-serif italic p-4 border border-gold/10 rounded-md bg-card/40">
                              No spells match the current filters.{" "}
                              <button
                                type="button"
                                onClick={() => {
                                  spellManagerFilters.resetAll();
                                  spellManagerFilters.setSearch("");
                                  setShowFavouritesOnly(false);
                                  setShowWatchlistOnly(false);
                                  setShowLoadoutOnly(false);
                                }}
                                className="text-gold hover:underline"
                              >
                                Reset filters
                              </button>
                            </div>
                          );
                        }

                        return (
                          <div className="border border-gold/15 rounded-md bg-card overflow-hidden">
                            <div className="px-3 py-2 border-b border-gold/15 bg-gold/[0.03] flex items-center justify-between gap-2">
                              <span className="text-[10px] font-bold uppercase tracking-widest text-ink/45">
                                {grandTotal} of {grandBase} spells
                              </span>
                              <span className="text-[9px] font-bold uppercase tracking-widest text-ink/30">
                                {spellcastingClassIds.length === 1
                                  ? "Single class"
                                  : `${spellcastingClassIds.length} classes`}
                              </span>
                            </div>
                            <div className="max-h-[70vh] overflow-y-auto custom-scrollbar divide-y divide-gold/5">
                              {perClassPools.map(({ cid, cls, filtered, poolTotal }) => {
                                if (filtered.length === 0) return null;
                                const isActive = cid === activeClassId;
                                const classCollapsed = spellsCollapsedClasses.has(cid);

                                const byLvlMap = new Map<number, any[]>();
                                filtered.forEach((s: any) => {
                                  const lv = Number(s.level || 0);
                                  if (!byLvlMap.has(lv)) byLvlMap.set(lv, []);
                                  byLvlMap.get(lv)!.push(s);
                                });
                                const sortedLvls = Array.from(byLvlMap.keys()).sort((a, b) => a - b);

                                return (
                                  <div key={cid}>
                                    {/* Class header — sticky inside the
                                        scroll. Click the label area to
                                        switch active class + toggle
                                        collapse; Prepare button opens the
                                        per-class modal (Phase 2). */}
                                    <div
                                      className={cn(
                                        "px-3 py-2 border-y border-gold/30 flex items-center gap-2 sticky top-0 z-10",
                                        isActive
                                          ? "bg-gold/20"
                                          : "bg-[color-mix(in_srgb,var(--gold)_10%,var(--card))]",
                                      )}
                                    >
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setActiveSpellManagerClassId(cid);
                                          toggleClassCollapsed(cid);
                                        }}
                                        className="flex items-center gap-2 flex-1 min-w-0 text-left"
                                        title={`Toggle ${cls?.name || "class"} section · click again to switch active class`}
                                      >
                                        <ChevronDown
                                          className={cn(
                                            "w-3 h-3 text-ink/40 transition-transform shrink-0",
                                            classCollapsed && "-rotate-90",
                                          )}
                                        />
                                        <span className="font-serif text-sm font-bold text-ink tracking-tight">
                                          {cls?.name || `Class ${cid.slice(0, 6)}`}
                                        </span>
                                        <span className="font-mono text-[10px] font-bold text-ink/40">
                                          {filtered.length}
                                          {filtered.length !== poolTotal && (
                                            <span className="text-ink/25"> / {poolTotal}</span>
                                          )}
                                        </span>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setSpellsPrepModalClass(cid)}
                                        className="text-[9px] font-black uppercase tracking-[0.16em] px-2 py-1 border border-gold bg-gold text-white hover:bg-gold/90 transition-colors whitespace-nowrap"
                                        title={`Prepare spells from the ${cls?.name || "class"} list`}
                                      >
                                        Prepare
                                      </button>
                                    </div>

                                    {!classCollapsed && sortedLvls.map((lvl) => {
                                      const spellsAtLvl = byLvlMap.get(lvl) || [];
                                      const lvlKey = `${cid}:${lvl}`;
                                      const lvlCollapsed = spellsCollapsedLevels.has(lvlKey);
                                      return (
                                        <div key={lvlKey}>
                                          <button
                                            type="button"
                                            onClick={() => toggleLevelCollapsed(lvlKey)}
                                            className="w-full flex items-center gap-2 px-4 py-1.5 bg-gold/[0.03] border-b border-gold/10 text-left"
                                          >
                                            <ChevronDown
                                              className={cn(
                                                "w-3 h-3 text-ink/30 transition-transform shrink-0",
                                                lvlCollapsed && "-rotate-90",
                                              )}
                                            />
                                            <span className="text-[10px] font-black uppercase tracking-[0.18em] text-ink/45">
                                              {lvl === 0 ? "Cantrips" : `Level ${lvl}`}
                                            </span>
                                            <span className="flex-1" />
                                            <span className="font-mono text-[9px] font-bold text-ink/30">
                                              {spellsAtLvl.length}
                                            </span>
                                          </button>
                                          {!lvlCollapsed && spellsAtLvl.map((spell: any) => {
                                  const owned = ownedSpellMap.get(spell.id);
                                  const isGranted = !!owned?.grantedByAdvancementId;
                                  const isKnown = !!owned;
                                  const isPrepared = !!owned?.isPrepared;
                                  const isExtension = spell.isExtension;
                                  const isSelected = selectedSpellId === spell.id;
                                  const spellLvl = Number(spell.level || 0);
                                  const isCantrip = spellLvl === 0;
                                  const requiredTags = Array.isArray(spell.requiredTags)
                                    ? spell.requiredTags
                                    : [];
                                  const missingTags = missingPrerequisiteTags(
                                    effectiveTagSet,
                                    { requiredTags },
                                    tagParentMap,
                                  );
                                  const prereqBlocked =
                                    !isKnown && !isGranted && missingTags.length > 0;
                                  const blockedByCap =
                                    !isKnown &&
                                    !isGranted &&
                                    !prereqBlocked &&
                                    ((isCantrip && atCantripsCap) ||
                                      (!isCantrip && atSpellsCap));
                                  const isBlocked = prereqBlocked || blockedByCap;
                                  return (
                                    <div
                                      key={spell.id}
                                      onClick={() => setSelectedSpellId(spell.id)}
                                      className={`flex items-center gap-3 px-3 py-2 rounded-md border transition-colors cursor-pointer ${
                                        isSelected
                                          ? "border-gold ring-1 ring-gold/40 bg-gold/10"
                                          : isGranted
                                            ? "border-emerald-500/30 bg-emerald-500/5"
                                            : isKnown
                                              ? "border-gold/30 bg-gold/5"
                                              : prereqBlocked
                                                ? "border-blood/15 bg-blood/[0.03] opacity-70"
                                                : blockedByCap
                                                  ? "border-gold/5 bg-card/20 opacity-60"
                                                  : "border-gold/10 bg-card/40 hover:bg-card/60"
                                      }`}
                                    >
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          if (!isGranted)
                                            togglePlayerKnown(spell.id, spellLvl, requiredTags);
                                        }}
                                        disabled={isGranted || isBlocked}
                                        title={
                                          isGranted
                                            ? "Granted by an advancement (locked)"
                                            : prereqBlocked
                                              ? `Missing prerequisite tag${missingTags.length === 1 ? "" : "s"}`
                                              : blockedByCap
                                                ? isCantrip
                                                  ? `At cantrips-known cap (${cantripsCap})`
                                                  : `At spells-known cap (${spellsCap})`
                                                : isKnown
                                                  ? "Remove from known"
                                                  : "Mark as known"
                                        }
                                        className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 ${
                                          isKnown
                                            ? isGranted
                                              ? "bg-emerald-600 border-emerald-600 text-white"
                                              : "bg-gold border-gold text-white"
                                            : prereqBlocked
                                              ? "border-blood/30"
                                              : "border-gold/30 hover:border-gold"
                                        } ${isGranted || isBlocked ? "cursor-not-allowed" : ""}`}
                                      >
                                        {isKnown && <Check className="w-3 h-3" />}
                                      </button>
                                      <div className="flex-1 min-w-0">
                                        <div className="font-serif font-bold text-ink text-sm truncate flex items-center gap-1.5">
                                          <span className="truncate">{spell.name}</span>
                                          {requiredTags.length > 0 && (
                                            <span
                                              className="text-[9px] font-bold uppercase tracking-widest text-blood/70 shrink-0"
                                              title={`Requires: ${requiredTags.map((tid: string) => spellManagerTags.find((t: any) => t.id === tid)?.name || tid).join(", ")}`}
                                            >
                                              ⚷
                                            </span>
                                          )}
                                          {spell.school && (
                                            <span className="ml-2 text-[10px] font-bold uppercase tracking-widest text-ink/40 shrink-0">
                                              {spell.school}
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-1 shrink-0">
                                        {isExtension && (
                                          <span className="text-[9px] font-bold uppercase tracking-widest text-cyan-700 bg-cyan-500/10 px-1.5 py-0.5 rounded border border-cyan-500/20">
                                            Extension
                                          </span>
                                        )}
                                        {isGranted && (
                                          <span className="text-[9px] font-bold uppercase tracking-widest text-emerald-700 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                                            Granted
                                          </span>
                                        )}
                                        {prereqBlocked && (
                                          <span
                                            className="text-[9px] font-bold uppercase tracking-widest text-blood bg-blood/10 px-1.5 py-0.5 rounded border border-blood/30"
                                            title={`Needs: ${missingTags
                                              .map(
                                                (tid: string) =>
                                                  spellManagerTags.find((t: any) => t.id === tid)?.name ||
                                                  tid,
                                              )
                                              .join(", ")}`}
                                          >
                                            Locked
                                          </span>
                                        )}
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            toggleFavourite(spell.id);
                                          }}
                                          title={owned?.isFavourite ? "Unfavourite" : "Favourite"}
                                          className={`text-sm leading-none px-1 ${
                                            owned?.isFavourite
                                              ? "text-amber-500"
                                              : "text-ink/25 hover:text-amber-500"
                                          }`}
                                        >
                                          ★
                                        </button>
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            toggleWatchlist(spell.id);
                                          }}
                                          title={owned?.isWatchlist ? "Remove from watchlist" : "Watchlist"}
                                          className={`text-sm leading-none px-1 ${
                                            owned?.isWatchlist
                                              ? "text-cyan-500"
                                              : "text-ink/25 hover:text-cyan-500"
                                          }`}
                                        >
                                          ◐
                                        </button>
                                        {isKnown && loadouts.length > 0 && (
                                          <div
                                            onClick={(e) => e.stopPropagation()}
                                            className="flex items-center gap-0.5"
                                          >
                                            {loadouts.map((l: any) => {
                                              const inLoadout = (
                                                owned?.loadoutMembership || []
                                              ).includes(l.id);
                                              return (
                                                <button
                                                  key={l.id}
                                                  type="button"
                                                  onClick={() =>
                                                    toggleLoadoutMembership(spell.id, l.id)
                                                  }
                                                  title={`${inLoadout ? "Remove from" : "Add to"} ${l.name}`}
                                                  className={`text-[9px] font-bold uppercase tracking-widest w-4 h-4 rounded border flex items-center justify-center ${
                                                    inLoadout
                                                      ? "border-purple-500/60 bg-purple-500/20 text-purple-700"
                                                      : "border-gold/15 text-ink/30 hover:border-purple-500/30"
                                                  }`}
                                                >
                                                  {l.name.charAt(0).toUpperCase()}
                                                </button>
                                              );
                                            })}
                                          </div>
                                        )}
                                        {isKnown && (
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              togglePrepared(spell.id);
                                            }}
                                            disabled={!!owned?.isAlwaysPrepared}
                                            title={
                                              owned?.isAlwaysPrepared
                                                ? "Always prepared (locked)"
                                                : isPrepared
                                                  ? "Unprepare"
                                                  : "Prepare"
                                            }
                                            className={`text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded border ${
                                              isPrepared || isInActiveLoadout(owned)
                                                ? "text-blood bg-blood/10 border-blood/30"
                                                : "text-ink/45 bg-card border-gold/15 hover:border-blood/30"
                                            } ${owned?.isAlwaysPrepared ? "cursor-not-allowed" : ""}`}
                                          >
                                            {isPrepared || isInActiveLoadout(owned) ? "Prepared" : "Prepare"}
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  );
                                          })}
                                        </div>
                                      );
                                    })}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })()}
                    </div>

                    {/* Detail pane (sticky on lg+) */}
                    <div className="hidden lg:block">
                      <div className="lg:sticky lg:top-4">
                        <SpellDetailPanel
                          spellId={selectedSpellId}
                          emptyMessage="Click a spell to see its details."
                        />
                      </div>
                    </div>
                  </div>

                  {/* Mobile detail pane (modal-style, below the list) */}
                  {selectedSpellId && (
                    <div className="lg:hidden border-t-2 border-gold/20 pt-4">
                      <div className="flex justify-end mb-2">
                        <button
                          type="button"
                          onClick={() => setSelectedSpellId(null)}
                          className="text-[10px] font-bold uppercase tracking-widest text-ink/45 hover:text-gold"
                        >
                          Close detail
                        </button>
                      </div>
                      <SpellDetailPanel spellId={selectedSpellId} />
                    </div>
                  )}

                  {/* ── PrepareSpellsModal — Phase 2 ─────────────────────
                       Focused per-class prepare flow. Opens from the
                       class header "Prepare" button (see the tree
                       above). The component is defined at module level
                       so it can run its own hooks (search / filter /
                       selection); state mutations route back through
                       the same handlers as the main tree so the two
                       surfaces stay in sync. */}
                  {spellsPrepModalClass && (() => {
                    const modalCid = spellsPrepModalClass;
                    const modalClass = classCache[modalCid];
                    const modalContributor = contributorByClass.get(modalCid);

                    // Build the per-class pool the modal will browse.
                    // Same shape as the inline tree builds (basePool +
                    // extensions + facet back-fill + sort), but scoped
                    // to this single class.
                    const modalBase = classSpellPools[modalCid] || [];
                    const modalExtIds = (extensions as any[])
                      .filter((e: any) => e.classId === modalCid)
                      .map((e: any) => e.spellId);
                    const modalExtEntries = modalExtIds
                      .filter((id: string) => !modalBase.some((s: any) => s.id === id))
                      .map((id: string) => {
                        const cached = spellNameCache[id];
                        return {
                          id,
                          name: cached?.name || id,
                          level: cached?.level ?? 0,
                          school: cached?.school || "",
                          image_url: null,
                          source_id: null,
                          tags: [],
                          membershipId: `ext-${id}`,
                          membershipSource: "extension",
                          addedAt: "",
                          isExtension: true,
                        };
                      });
                    const modalPool = [...modalBase, ...modalExtEntries]
                      .map((spell: any) => {
                        if (spell.activationBucket) return spell;
                        const fromCatalog = facetEnrichedSpellSummaries?.find(
                          (s: any) => s.id === spell.id,
                        );
                        return fromCatalog ? { ...spell, ...fromCatalog } : spell;
                      })
                      .sort((a: any, b: any) => {
                        if ((a.level || 0) !== (b.level || 0))
                          return (a.level || 0) - (b.level || 0);
                        return String(a.name || "").localeCompare(String(b.name || ""));
                      });

                    // Caps for THIS class (modal may be opened on a
                    // non-active class). Same matcher used in the IIFE
                    // for the active-class header strip, scoped here.
                    const matchModalCap = (pattern: RegExp) => {
                      for (const col of Object.values(scalingCache) as any[]) {
                        if (!col || col.parentId !== modalCid) continue;
                        const name = String(col.name || "").trim();
                        if (pattern.test(name)) {
                          const v = resolveScaleValueAtLevel(
                            col,
                            progressionClassGroups.find(
                              (g: any) => g.classId === modalCid,
                            )?.classLevel || 0,
                          );
                          const n = Number(v);
                          if (Number.isFinite(n)) return n;
                        }
                      }
                      return null;
                    };
                    const modalCantripsCap = matchModalCap(/^cantrips\s*(known)?$/i);
                    const modalSpellsCap = matchModalCap(/^spells\s*known$/i);

                    // Counts scoped to this modal's class — granted
                    // spells with doesntCountAgainstKnown stay excluded
                    // from cap totals (Magic Initiate etc.).
                    const countsTowardsModalClass = (s: any) => {
                      if (!s) return false;
                      if (s.grantedByAdvancementId) {
                        if (s.doesntCountAgainstKnown) return false;
                        return s.countsAsClassId
                          ? s.countsAsClassId === modalCid
                          : true;
                      }
                      return true;
                    };
                    const modalOwnedForClass = ownedSpells.filter(countsTowardsModalClass);
                    const modalCantripsKnown = modalOwnedForClass.filter((s: any) => {
                      const lvl = spellNameCache[s.id]?.level;
                      return lvl === 0;
                    }).length;
                    const modalSpellsKnown = modalOwnedForClass.filter((s: any) => {
                      const lvl = spellNameCache[s.id]?.level;
                      return lvl !== undefined && lvl > 0;
                    }).length;

                    return (
                      <PrepareSpellsModal
                        classId={modalCid}
                        className={modalClass?.name || `Class ${modalCid.slice(0, 6)}`}
                        preparationType={modalContributor?.preparationType || "prepared"}
                        spellDC={dcForClass(modalCid)}
                        spellAtk={atkForClass(modalCid)}
                        cantripsCap={modalCantripsCap}
                        spellsCap={modalSpellsCap}
                        cantripsKnownCount={modalCantripsKnown}
                        spellsKnownCount={modalSpellsKnown}
                        pool={modalPool}
                        ownedSpellMap={ownedSpellMap}
                        spellManagerSources={spellManagerSources}
                        spellManagerTags={spellManagerTags}
                        effectiveTagSet={effectiveTagSet}
                        tagParentMap={tagParentMap}
                        onClose={() => setSpellsPrepModalClass(null)}
                        onTogglePrepared={togglePrepared}
                        onTogglePlayerKnown={togglePlayerKnown}
                        onToggleFavourite={toggleFavourite}
                      />
                    );
                  })()}
                </div>
              );
            })()
          ) : activeStep === "proficiencies" ? (
            (() => {
              // ── Proficiencies step (design handoff) ───────────────
              // Read-only summary view: each proficiency category
              // (Saves, Skills, Armor, Weapons, Tools, Languages,
              // Resistances/Immunities/Vulnerabilities, Senses) renders
              // as a kind-colored card. Tag-cloud body shows the
              // proficient items; an "Expertise" sub-cloud calls out
              // skills + tools the character has doubled-proficient.
              //
              // Editing happens upstream in the Trait advancement rows
              // on the Class step (and via race/background/feat picks),
              // not here — this is the consolidated read-out across
              // every source.

              const arr = (v: any): string[] => Array.isArray(v) ? v.map(String).filter(Boolean) : [];
              const profSkillIds: string[] = arr(character.proficientSkills);
              const expSkillIds: string[] = arr(character.expertiseSkills);
              const halfSkillIds: string[] = arr(character.halfProficientSkills);
              const savingThrowIds: string[] = arr(character.savingThrows).map((s) => s.toUpperCase());
              const expSaveIds: string[] = arr(character.expertiseSavingThrows).map((s) => s.toUpperCase());

              const skillById = new Map(allSkills.map((s: any) => [String(s.id), s]));
              const attributeById = new Map(allAttributes.map((a: any) => [String(a.identifier || a.id).toUpperCase(), a]));

              const profSkillNames = profSkillIds
                .map((id) => skillById.get(id)?.name || id)
                .filter(Boolean) as string[];
              const expSkillNames = expSkillIds
                .map((id) => skillById.get(id)?.name || id)
                .filter(Boolean) as string[];
              const halfSkillNames = halfSkillIds
                .map((id) => skillById.get(id)?.name || id)
                .filter(Boolean) as string[];

              const profSaveNames = savingThrowIds
                .map((id) => attributeById.get(id)?.name || id)
                .filter(Boolean) as string[];
              const expSaveNames = expSaveIds
                .map((id) => attributeById.get(id)?.name || id)
                .filter(Boolean) as string[];

              const armorNames = formatTraitValues("armor", character.armorProficiencies || []);
              const weaponNames = formatTraitValues("weapons", character.weaponProficiencies || []);
              const toolNames = formatTraitValues("tools", character.toolProficiencies || []);
              const langNames = formatTraitValues("languages", character.languages || []);

              const resistanceNames = arr(character.resistances);
              const immunityNames = arr(character.immunities);
              const vulnerabilityNames = arr(character.vulnerabilities);
              const conditionImmunityNames = arr(character.conditionImmunities);

              const senses = character.senses || {};
              const sensesAdditional = String(senses.additional || "").trim();

              // Card definitions — color matches the design handoff's
              // KIND_META palette (skill/save/armor/weapon/tool/language
              // /resistance/immunity/sense).
              const cards = [
                {
                  key: "saves",
                  title: "Saving Throws",
                  icon: "◈",
                  color: "#2a5a4a",
                  bgClass: "bg-emerald-700/[0.04]",
                  borderClass: "border-emerald-700/25",
                  textClass: "text-emerald-800",
                  items: profSaveNames,
                  expertise: expSaveNames,
                  emptyText: "No save proficiencies.",
                },
                {
                  key: "skills",
                  title: "Skills",
                  icon: "◇",
                  color: "#3a7ca5",
                  bgClass: "bg-sky-700/[0.04]",
                  borderClass: "border-sky-700/25",
                  textClass: "text-sky-800",
                  items: profSkillNames,
                  expertise: expSkillNames,
                  half: halfSkillNames,
                  emptyText: "No skill proficiencies.",
                },
                {
                  key: "armor",
                  title: "Armor",
                  icon: "▣",
                  color: "#6b5034",
                  bgClass: "bg-amber-900/[0.04]",
                  borderClass: "border-amber-900/25",
                  textClass: "text-amber-900",
                  items: armorNames,
                  emptyText: "No armor proficiencies.",
                },
                {
                  key: "weapons",
                  title: "Weapons",
                  icon: "⚔",
                  color: "#7d2b2b",
                  bgClass: "bg-blood/[0.04]",
                  borderClass: "border-blood/25",
                  textClass: "text-blood",
                  items: weaponNames,
                  emptyText: "No weapon proficiencies.",
                },
                {
                  key: "tools",
                  title: "Tools",
                  icon: "⚒",
                  color: "#8a6f37",
                  bgClass: "bg-gold/5",
                  borderClass: "border-gold/30",
                  textClass: "text-gold",
                  items: toolNames,
                  emptyText: "No tool proficiencies.",
                },
                {
                  key: "languages",
                  title: "Languages",
                  icon: "✎",
                  color: "#6b4f8a",
                  bgClass: "bg-purple-700/[0.04]",
                  borderClass: "border-purple-700/25",
                  textClass: "text-purple-800",
                  items: langNames.length > 0 ? langNames : ["Common"],
                  emptyText: "None.",
                },
              ];

              const hasDamageTraits =
                resistanceNames.length > 0 ||
                immunityNames.length > 0 ||
                vulnerabilityNames.length > 0 ||
                conditionImmunityNames.length > 0;

              const hasSenses =
                Number(senses.passivePerception ?? 0) > 0 ||
                Number(senses.passiveInvestigation ?? 0) > 0 ||
                Number(senses.passiveInsight ?? 0) > 0 ||
                sensesAdditional.length > 0;

              const renderChips = (
                items: string[],
                opts: { color: string; bgClass: string; borderClass: string; textClass: string; emphasize?: boolean },
              ) => (
                <div className="flex flex-wrap gap-1.5">
                  {items.map((item) => (
                    <span
                      key={item}
                      className={cn(
                        "px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest rounded-sm border",
                        opts.borderClass,
                        opts.bgClass,
                        opts.textClass,
                        opts.emphasize ? "font-black ring-1 ring-inset ring-gold/30" : "",
                      )}
                    >
                      {item}
                    </span>
                  ))}
                </div>
              );

              return (
                <div className="bg-background/50 p-4 sm:p-6 rounded-xl border border-gold/10 space-y-5">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <h2 className="text-xl sm:text-2xl font-serif font-black text-ink uppercase tracking-tight flex items-center gap-2">
                        <Star className="w-5 h-5 text-gold" />
                        Proficiencies
                      </h2>
                      <p className="text-xs text-ink/55 font-serif italic mt-1">
                        Consolidated view across class, subclass, race, background, and feats. Edit via the Trait rows on the Class step.
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

                  {/* Category grid */}
                  <div className="grid gap-3 sm:gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {cards.map((card) => {
                      const hasContent = card.items.length > 0;
                      const expertiseList = card.expertise || [];
                      const halfList = card.half || [];
                      return (
                        <div
                          key={card.key}
                          className={cn(
                            "p-3 sm:p-4 rounded-md border bg-card/50 border-l-[3px]",
                            card.borderClass,
                          )}
                          style={{ borderLeftColor: card.color }}
                        >
                          <div className="flex items-baseline justify-between gap-2 pb-2 mb-2 border-b border-gold/10">
                            <div className="flex items-baseline gap-2 min-w-0">
                              <span
                                className="text-base font-black leading-none"
                                style={{ color: card.color }}
                              >
                                {card.icon}
                              </span>
                              <span className="font-serif text-sm font-bold text-ink truncate">
                                {card.title}
                              </span>
                            </div>
                            <span className="text-[9px] font-bold uppercase tracking-widest text-ink/40 shrink-0">
                              {card.items.length + expertiseList.length + halfList.length}
                            </span>
                          </div>

                          {hasContent ? (
                            renderChips(card.items, {
                              color: card.color,
                              bgClass: card.bgClass,
                              borderClass: card.borderClass,
                              textClass: card.textClass,
                            })
                          ) : (
                            <p className="text-[11px] font-serif italic text-ink/35">
                              {card.emptyText}
                            </p>
                          )}

                          {expertiseList.length > 0 && (
                            <div className="mt-2 pt-2 border-t border-gold/10 space-y-1">
                              <span className="text-[9px] font-black uppercase tracking-[0.18em] text-gold/65">
                                Expertise
                              </span>
                              {renderChips(expertiseList, {
                                color: card.color,
                                bgClass: card.bgClass,
                                borderClass: card.borderClass,
                                textClass: card.textClass,
                                emphasize: true,
                              })}
                            </div>
                          )}

                          {halfList.length > 0 && (
                            <div className="mt-2 pt-2 border-t border-gold/10 space-y-1">
                              <span className="text-[9px] font-black uppercase tracking-[0.18em] text-ink/45">
                                Half-Proficient
                              </span>
                              {renderChips(halfList, {
                                color: card.color,
                                bgClass: "bg-card/30",
                                borderClass: "border-gold/20",
                                textClass: "text-ink/60",
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Damage traits + senses — variable-presence, rendered
                      only when the character has anything to show in
                      these categories. Keeps the grid clean for new
                      characters. */}
                  {(hasDamageTraits || hasSenses) && (
                    <div className="grid gap-3 sm:gap-4 sm:grid-cols-2">
                      {hasDamageTraits && (
                        <div
                          className="p-3 sm:p-4 rounded-md border bg-card/50 border-l-[3px] border-emerald-700/25"
                          style={{ borderLeftColor: "#1f6f5c" }}
                        >
                          <div className="flex items-baseline justify-between gap-2 pb-2 mb-2 border-b border-gold/10">
                            <div className="flex items-baseline gap-2">
                              <span className="text-base font-black text-emerald-700 leading-none">⛨</span>
                              <span className="font-serif text-sm font-bold text-ink">
                                Damage Traits
                              </span>
                            </div>
                            <span className="text-[9px] font-bold uppercase tracking-widest text-ink/40">
                              {resistanceNames.length + immunityNames.length + vulnerabilityNames.length + conditionImmunityNames.length}
                            </span>
                          </div>
                          <div className="space-y-2">
                            {resistanceNames.length > 0 && (
                              <div className="space-y-1">
                                <span className="text-[9px] font-black uppercase tracking-[0.18em] text-emerald-700/75">
                                  Resistances
                                </span>
                                {renderChips(resistanceNames, {
                                  color: "#1f6f5c",
                                  bgClass: "bg-emerald-700/[0.05]",
                                  borderClass: "border-emerald-700/25",
                                  textClass: "text-emerald-800",
                                })}
                              </div>
                            )}
                            {immunityNames.length > 0 && (
                              <div className="space-y-1">
                                <span className="text-[9px] font-black uppercase tracking-[0.18em] text-emerald-800/75">
                                  Immunities
                                </span>
                                {renderChips(immunityNames, {
                                  color: "#0f5f3f",
                                  bgClass: "bg-emerald-800/[0.06]",
                                  borderClass: "border-emerald-800/30",
                                  textClass: "text-emerald-900",
                                  emphasize: true,
                                })}
                              </div>
                            )}
                            {vulnerabilityNames.length > 0 && (
                              <div className="space-y-1">
                                <span className="text-[9px] font-black uppercase tracking-[0.18em] text-blood/75">
                                  Vulnerabilities
                                </span>
                                {renderChips(vulnerabilityNames, {
                                  color: "#7d2b2b",
                                  bgClass: "bg-blood/[0.06]",
                                  borderClass: "border-blood/25",
                                  textClass: "text-blood",
                                })}
                              </div>
                            )}
                            {conditionImmunityNames.length > 0 && (
                              <div className="space-y-1">
                                <span className="text-[9px] font-black uppercase tracking-[0.18em] text-emerald-700/75">
                                  Condition Immunities
                                </span>
                                {renderChips(conditionImmunityNames, {
                                  color: "#0f5f3f",
                                  bgClass: "bg-emerald-700/[0.05]",
                                  borderClass: "border-emerald-700/25",
                                  textClass: "text-emerald-800",
                                })}
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {hasSenses && (
                        <div
                          className="p-3 sm:p-4 rounded-md border bg-card/50 border-l-[3px]"
                          style={{ borderLeftColor: "#5a4a8a" }}
                        >
                          <div className="flex items-baseline justify-between gap-2 pb-2 mb-2 border-b border-gold/10">
                            <div className="flex items-baseline gap-2">
                              <span className="text-base font-black text-purple-700 leading-none">◉</span>
                              <span className="font-serif text-sm font-bold text-ink">
                                Senses
                              </span>
                            </div>
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            {[
                              { lbl: "Passive Perception", v: senses.passivePerception },
                              { lbl: "Passive Investigation", v: senses.passiveInvestigation },
                              { lbl: "Passive Insight", v: senses.passiveInsight },
                            ].map((p) => (
                              <div
                                key={p.lbl}
                                className="flex flex-col items-center gap-1 p-2 border border-purple-700/15 bg-purple-700/[0.03] rounded-sm"
                              >
                                <span className="font-mono text-base font-black text-purple-900 leading-none">
                                  {p.v ?? "—"}
                                </span>
                                <span className="text-[8px] font-black uppercase tracking-[0.14em] text-purple-700/65 text-center leading-tight">
                                  {p.lbl.replace("Passive ", "")}
                                </span>
                              </div>
                            ))}
                          </div>
                          {sensesAdditional && (
                            <p className="text-[11px] font-serif text-ink/65 mt-3 pt-2 border-t border-gold/10 leading-relaxed">
                              {sensesAdditional}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()
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

      {/* ── Spellbook Manager (Layer 2) — GrantSpells choice-mode picker ── */}
      {spellChoiceDialogOpen && (() => {
        const dlg = spellChoiceDialogOpen;
        // Re-resolve the pool live so a rule that finishes loading after the
        // click renders correctly without forcing the user to reopen.
        const livePool =
          dlg.resolverKind === "rule"
            ? resolveRulePool(dlg.ruleId)
            : dlg.explicitSpellIds;
        const sel = getAdvancementSelectionValues(selectedOptionsMap, {
          sourceScope: dlg.sourceScope,
          advancementId: dlg.advId,
          level: dlg.level,
        });
        const writeSel = (next: string[]) => {
          setCharacter((prev: any) =>
            updateCharacterAdvancementSelectionState(
              prev,
              {
                sourceScope: dlg.sourceScope,
                advancementId: dlg.advId,
                level: dlg.level,
              },
              next,
            ),
          );
        };
        return (
          <div className="fixed inset-0 bg-ink/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <Card className="max-w-3xl w-full max-h-[90vh] flex flex-col border-4 border-emerald-500 bg-background shadow-2xl overflow-hidden">
              <CardHeader className="border-b border-emerald-500/20 flex flex-row items-center justify-between shrink-0">
                <div>
                  <CardTitle className="font-serif text-2xl font-black text-ink flex items-center gap-2">
                    <Zap className="w-5 h-5 text-emerald-600" />
                    {dlg.name}
                  </CardTitle>
                  <CardDescription className="text-ink/60 font-bold uppercase text-[10px] tracking-widest mt-1">
                    Choose {dlg.count} from {livePool.length} · {sel.length} chosen
                    {dlg.resolverKind === "rule" && livePool.length === 0 && (
                      <span className="ml-2 italic text-ink/40">
                        (loading rule matches…)
                      </span>
                    )}
                  </CardDescription>
                </div>
                <Button variant="ghost" onClick={() => setSpellChoiceDialogOpen(null)}>
                  <Plus className="w-5 h-5 rotate-45" />
                </Button>
              </CardHeader>
              <CardContent className="flex-1 overflow-y-auto p-0">
                {livePool.length === 0 ? (
                  <div className="p-8 text-center text-ink/50 font-serif italic">
                    {dlg.resolverKind === "rule"
                      ? "Loading rule matches… or this rule matches nothing."
                      : "No spells in the picker pool."}
                  </div>
                ) : (
                  <div className="divide-y divide-emerald-500/10">
                    {livePool.map((sid) => {
                      const cached = spellNameCache[sid];
                      const isSelected = sel.includes(sid);
                      const atCap = !isSelected && sel.length >= dlg.count;
                      return (
                        <div
                          key={sid}
                          className={`p-4 flex gap-4 transition-colors ${
                            atCap ? "opacity-50" : "hover:bg-emerald-500/5"
                          }`}
                        >
                          <div className="pt-1">
                            <button
                              disabled={atCap}
                              onClick={() => {
                                if (isSelected) {
                                  writeSel(sel.filter((x) => x !== sid));
                                } else if (sel.length < dlg.count) {
                                  writeSel([...sel, sid]);
                                }
                              }}
                              className={`w-6 h-6 rounded-md border-2 flex items-center justify-center transition-colors ${
                                isSelected
                                  ? "bg-emerald-600 border-emerald-600 text-white"
                                  : "border-emerald-500/40 hover:border-emerald-500"
                              } ${atCap ? "cursor-not-allowed" : ""}`}
                            >
                              {isSelected && <Check className="w-4 h-4" />}
                            </button>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-serif font-bold text-ink text-base">
                              {cached?.name || sid}
                              {cached?.level !== undefined && (
                                <span className="ml-2 text-[10px] font-bold uppercase tracking-widest text-ink/40">
                                  {cached.level === 0 ? "Cantrip" : `Lv ${cached.level}`}
                                </span>
                              )}
                              {cached?.school && (
                                <span className="ml-2 text-[10px] font-bold uppercase tracking-widest text-ink/40">
                                  {cached.school}
                                </span>
                              )}
                            </div>
                            {cached?.description && (
                              <div className="text-xs font-serif text-ink/70 mt-1 leading-relaxed line-clamp-3">
                                <BBCodeRenderer content={cached.description} />
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
        );
      })()}

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

      {showPointBuy && (() => {
        // ── Point Buy modal ─────────────────────────────────────────
        // Standard D&D 5e 27-point allocator. Each ability seeds from
        // the character's current score (clamped into [8,15]) so the
        // modal opens to a "what would point-buy look like for the
        // current build?" state rather than wiping the user's values.
        // Apply writes back to character.stats.base and flips
        // stats.method = "point-buy" for downstream lookups.
        const attrIdentifiers = allAttributes.length > 0
          ? allAttributes.map((a: any) => String(a.identifier || a.id))
          : ["STR", "DEX", "CON", "INT", "WIS", "CHA"];
        const baseScores = (character?.stats?.base || {}) as Record<string, number>;

        // Local draft state lives inside an inner component so the
        // hooks fire only while the modal is mounted. The IIFE wrapper
        // exists so we can declare these vars + nest the component
        // without polluting the outer render scope.
        const initial: Record<string, number> = {};
        for (const id of attrIdentifiers) {
          const raw = Number(baseScores[id] ?? 10);
          initial[id] = Math.max(POINT_BUY_MIN, Math.min(POINT_BUY_MAX, Math.round(raw)));
        }
        return (
          <PointBuyModal
            attributes={allAttributes}
            attrIdentifiers={attrIdentifiers}
            initialScores={initial}
            onApply={(next) => {
              setCharacter((prev: any) => ({
                ...prev,
                stats: {
                  ...prev.stats,
                  method: "point-buy",
                  base: {
                    ...(prev.stats?.base ?? {}),
                    ...next,
                  },
                },
              }));
              setShowPointBuy(false);
            }}
            onClose={() => setShowPointBuy(false)}
          />
        );
      })()}
    </div>
  );
}

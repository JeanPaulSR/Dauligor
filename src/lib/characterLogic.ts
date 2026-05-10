/**
 * Shared character progression and state logic.
 * Extracted from CharacterBuilder.tsx and characterExport.ts
 */

export function uniqueStringList(values: any[] = []) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value ?? "").trim())
        .filter(Boolean),
    ),
  );
}

export function getTotalCharacterLevel(
  progression: any[] = [],
  fallbackLevel = 1,
) {
  const progressionCount = Array.isArray(progression) ? progression.length : 0;
  if (progressionCount > 0) return progressionCount;
  return Math.max(1, Number(fallbackLevel || 1) || 1);
}

export function getProficiencyBonusForLevel(level: any) {
  const numericLevel = Math.max(1, Number(level || 1) || 1);
  return Math.floor((numericLevel - 1) / 4) + 2;
}

export function getProgressionClassKey(entry: any) {
  return String(entry?.classId || entry?.className || "").trim();
}

export function sanitizeAdvancementKeyPart(value: any, fallback = "none") {
  const raw = String(value ?? "").trim();
  return (raw || fallback).replace(/[|]/g, "-");
}

export function isLegacyAdvancementSelectionKey(key: any) {
  const k = String(key || "");
  return !k.includes("|adv:") && !k.includes("|level:");
}

export function buildEmptyProgressionState() {
  return {
    classPackages: [],
    ownedFeatures: [],
    ownedItems: [],
    ownedSpells: [],
    spellListExtensions: [],
    spellLoadouts: [],
    derivedSync: {},
  };
}

export function normalizeAdvancementSelectionEntry(entry: any) {
  return {
    key: String(entry?.key || "").trim(),
    selectedIds: Array.isArray(entry?.selectedIds) ? entry.selectedIds : [],
    level: Number(entry?.level) || 1,
  };
}

export function normalizeProgressionState(progressState: any) {
  const normalized = progressState && typeof progressState === "object"
    ? progressState
    : {};

  return {
    ...buildEmptyProgressionState(),
    ...normalized,
    classPackages: Array.isArray(normalized.classPackages)
      ? normalized.classPackages.map((pkg: any) => ({
          ...pkg,
          advancementSelections: Array.isArray(pkg?.advancementSelections)
            ? pkg.advancementSelections.map(normalizeAdvancementSelectionEntry)
            : [],
          grantedFeatureRefs: Array.isArray(pkg?.grantedFeatureRefs)
            ? pkg.grantedFeatureRefs
            : [],
          grantedItemRefs: Array.isArray(pkg?.grantedItemRefs)
            ? pkg.grantedItemRefs
            : [],
          spellcasting: pkg?.spellcasting && typeof pkg.spellcasting === "object"
            ? pkg.spellcasting
            : {},
          hitPointHistory:
            pkg?.hitPointHistory &&
            typeof pkg.hitPointHistory === "object" &&
            !Array.isArray(pkg.hitPointHistory)
              ? pkg.hitPointHistory
              : {},
          scaleState:
            pkg?.scaleState &&
            typeof pkg.scaleState === "object" &&
            !Array.isArray(pkg.scaleState)
              ? pkg.scaleState
              : {},
        }))
      : [],
    ownedFeatures: Array.isArray(normalized.ownedFeatures)
      ? normalized.ownedFeatures
      : [],
    ownedItems: Array.isArray(normalized.ownedItems) ? normalized.ownedItems : [],
    ownedSpells: Array.isArray(normalized.ownedSpells) ? normalized.ownedSpells : [],
    spellListExtensions: Array.isArray(normalized.spellListExtensions)
      ? normalized.spellListExtensions
      : [],
    spellLoadouts: Array.isArray(normalized.spellLoadouts)
      ? normalized.spellLoadouts
      : [],
    derivedSync:
      normalized.derivedSync &&
      typeof normalized.derivedSync === "object" &&
      !Array.isArray(normalized.derivedSync)
        ? normalized.derivedSync
        : {},
  };
}

export function buildSelectedOptionsMapFromClassPackages(classPackages: any[] = []) {
  const mappedEntries = (Array.isArray(classPackages) ? classPackages : []).flatMap(
    (pkg: any) =>
      (Array.isArray(pkg?.advancementSelections)
        ? pkg.advancementSelections
        : []
      )
        .map(normalizeAdvancementSelectionEntry)
        .filter((entry: any) => entry.key)
        .map((entry: any) => [entry.key, uniqueStringList(entry.selectedIds)] as const),
  );

  return Object.fromEntries(
    mappedEntries.filter(([, value]) => Array.isArray(value) && value.length > 0),
  ) as Record<string, string[]>;
}

export function getClassIntroductionMode(progression: any[] = [], classKey = "") {
  if (!Array.isArray(progression) || progression.length === 0) return "primary";
  const firstEntry = progression[0];
  const firstKey = getProgressionClassKey(firstEntry);
  return firstKey === classKey ? "primary" : "multiclass";
}

export function resolveHitDieFaces(hitDie: any) {
  const raw = typeof hitDie === "object" ? hitDie?.faces : hitDie;
  const num = Number(raw);
  return Number.isFinite(num) && num > 0 ? num : 8;
}

export function buildCurrentProgression(character: any) {
  if (Array.isArray(character?.progression) && character.progression.length > 0) {
    return character.progression;
  }

  if (!character?.classId) return [];
  return Array.from({ length: character.level || 1 }).map((_, i) => ({
    classId: character.classId,
    className: character.classId,
    subclassId: character.subclassId || "",
    level: i + 1,
  }));
}

function resolveClassDocumentFromProgressionEntry(
  entry: any,
  classCache: Record<string, any>,
) {
  return (
    classCache[entry?.classId || ""] ||
    Object.values(classCache).find(
      (candidate: any) =>
        candidate?.id === entry?.classId || candidate?.name === entry?.className,
    ) ||
    null
  );
}

export function buildProgressionClassGroups(
  progression: any[] = [],
  classCache: Record<string, any> = {},
  subclassCache: Record<string, any> = {},
  legacySubclassId = "",
) {
  const groups = new Map<string, any>();

  progression.forEach((entry: any, index: number) => {
    const classDocument = resolveClassDocumentFromProgressionEntry(entry, classCache);
    const classKey =
      String(classDocument?.id || getProgressionClassKey(entry) || entry?.className || "").trim();
    if (!classKey) return;

    if (!groups.has(classKey)) {
      groups.set(classKey, {
        classKey,
        classId: classDocument?.id || String(entry?.classId || "").trim(),
        className: classDocument?.name || String(entry?.className || "").trim(),
        classDocument,
        classLevel: 0,
        subclassId: "",
        firstIndex: index,
      });
    }

    const group = groups.get(classKey);
    group.classLevel += 1;
    if (index < group.firstIndex) group.firstIndex = index;
    if (!group.classDocument && classDocument) {
      group.classDocument = classDocument;
      group.classId = classDocument.id;
      group.className = classDocument.name;
    }

    const entrySubclassId = String(entry?.subclassId || "").trim();
    if (entrySubclassId) {
      group.subclassId = entrySubclassId;
    }
  });

  const normalizedLegacySubclassId = String(legacySubclassId || "").trim();
  if (normalizedLegacySubclassId && groups.size > 0) {
    const legacySubclass = subclassCache[normalizedLegacySubclassId];
    if (legacySubclass) {
      const matchingGroup = Array.from(groups.values()).find(
        (group: any) => group.classId === legacySubclass.classId,
      );
      if (matchingGroup && !matchingGroup.subclassId) {
        matchingGroup.subclassId = normalizedLegacySubclassId;
      }
    }
  }

  return Array.from(groups.values()).sort(
    (left: any, right: any) => left.firstIndex - right.firstIndex,
  );
}

export function buildCharacterClassesFromProgression(
  progressionGroups: any[] = [],
  subclassCache: Record<string, any> = {},
) {
  return progressionGroups.map((group: any) => ({
    classId: group.classId,
    className: group.className,
    level: group.classLevel,
    subclassId: group.subclassId || "",
    subclassName: group.subclassId
      ? subclassCache[group.subclassId]?.name || ""
      : "",
  }));
}

export function buildAdvancementSelectionsForPackage(
  selectedOptions: Record<string, string[]> = {},
  classToken = "",
  subclassToken = "",
  existingSelections: any[] = [],
) {
  const seededSelections = Array.isArray(existingSelections)
    ? existingSelections.map(normalizeAdvancementSelectionEntry)
    : [];
  const nextSelections = new Map<string, any>();

  seededSelections.forEach((entry) => {
    if (entry.key) nextSelections.set(entry.key, entry);
  });

  Object.entries(selectedOptions || {}).forEach(([key, value]) => {
    if (!key.includes("|adv:")) return;
    if (!key.includes(`|class:${classToken}|`) && !key.includes(`|subclass:${subclassToken}|`)) return;

    nextSelections.set(key, {
      key,
      selectedIds: value,
      level: Number(key.split("|level:")[1]) || 1
    });
  });

  return Array.from(nextSelections.values());
}

export function buildProgressionStateForCharacter(
  character: any,
  progressionGroups: any[] = [],
  selectedOptions: Record<string, string[]> = {},
  subclassCache: Record<string, any> = {},
) {
  const currentProgression = buildCurrentProgression(character);
  const normalizedProgressionState = normalizeProgressionState(
    character?.progressionState,
  );
  const existingPackages = new Map<string, any>();
  normalizedProgressionState.classPackages.forEach((pkg: any) => {
    const packageKey = String(pkg?.classId || pkg?.className || "").trim();
    if (packageKey) existingPackages.set(packageKey, pkg);
  });

  const classPackages = progressionGroups.map((group: any) => {
    const classDocument = group.classDocument || null;
    const subclassDocument = group.subclassId
      ? subclassCache[group.subclassId] || null
      : null;
    const packageKey = String(group.classId || group.className || "").trim();
    const existingPackage = existingPackages.get(packageKey) || {};
    const classToken = sanitizeAdvancementKeyPart(
      group.classId || group.className,
      "none",
    );
    const subclassToken = sanitizeAdvancementKeyPart(
      group.subclassId ||
        subclassDocument?.id ||
        subclassDocument?.name ||
        "",
      "none",
    );

    return {
      classId: group.classId || "",
      classIdentifier:
        String(classDocument?.identifier || "").trim() ||
        String(existingPackage?.classIdentifier || "").trim(),
      classSourceId:
        String(classDocument?.sourceId || "").trim() ||
        String(existingPackage?.classSourceId || "").trim() ||
        (group.classId ? `class-${group.classId}` : ""),
      className: group.className || "",
      classLevel: group.classLevel || 0,
      introductionMode: getClassIntroductionMode(
        currentProgression,
        group.classKey,
      ),
      subclassId: group.subclassId || "",
      subclassIdentifier:
        String(subclassDocument?.identifier || "").trim() ||
        String(existingPackage?.subclassIdentifier || "").trim(),
      subclassSourceId:
        String(subclassDocument?.sourceId || "").trim() ||
        String(existingPackage?.subclassSourceId || "").trim() ||
        (group.subclassId ? `subclass-${group.subclassId}` : ""),
      subclassName:
        String(subclassDocument?.name || "").trim() ||
        String(existingPackage?.subclassName || "").trim(),
      advancementSelections: buildAdvancementSelectionsForPackage(
        selectedOptions,
        classToken,
        subclassToken,
        existingPackage?.advancementSelections || [],
      ),
      grantedFeatureRefs: Array.isArray(existingPackage?.grantedFeatureRefs)
        ? existingPackage.grantedFeatureRefs
        : [],
      grantedItemRefs: Array.isArray(existingPackage?.grantedItemRefs)
        ? existingPackage.grantedItemRefs
        : [],
      spellcasting: {
        class: classDocument?.spellcasting || null,
        subclass: subclassDocument?.spellcasting || null,
      },
      hitPointHistory:
        existingPackage?.hitPointHistory &&
        typeof existingPackage.hitPointHistory === "object" &&
        !Array.isArray(existingPackage.hitPointHistory)
          ? existingPackage.hitPointHistory
          : {},
      scaleState:
        existingPackage?.scaleState &&
        typeof existingPackage.scaleState === "object" &&
        !Array.isArray(existingPackage.scaleState)
          ? existingPackage.scaleState
          : {},
    };
  });

  return {
    ...normalizedProgressionState,
    classPackages,
  };
}

export function buildAdvancementSelectionMapForPackage(pkg: any) {
  const selections = Array.isArray(pkg?.advancementSelections)
    ? pkg.advancementSelections
    : [];
  return Object.fromEntries(
    selections
      .map(normalizeAdvancementSelectionEntry)
      .filter((entry) => entry.key)
      .map((entry) => [entry.key, entry.selectedIds]),
  );
}

export function getSelectionsForAdvancement(
  advancement: any,
  selectionMap: Record<string, string[]>,
) {
  const key = advancement.key;
  if (!key) return [];
  return selectionMap[key] || [];
}

export function normalizeAdvancementList(advancements: any[] = [], defaultHitDie = 8) {
  const validAdvancements = Array.isArray(advancements) ? advancements : [];
  return validAdvancements.map((adv) => {
    if (adv.type === "HitPoints") {
      return {
        ...adv,
        configuration: {
          ...adv.configuration,
          hitDie: adv.configuration?.hitDie || defaultHitDie,
        },
      };
    }
    return adv;
  });
}

export const SKILL_KEY_MAP: Record<string, string> = {
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

export const SKILL_ABILITY_MAP: Record<string, string> = {
  acrobatics: "dex",
  animal_handling: "wis",
  arcana: "int",
  athletics: "str",
  deception: "cha",
  history: "int",
  insight: "wis",
  intimidation: "cha",
  investigation: "int",
  medicine: "wis",
  nature: "int",
  perception: "wis",
  performance: "cha",
  persuasion: "cha",
  religion: "int",
  sleight_of_hand: "dex",
  stealth: "dex",
  survival: "wis",
};

export const ABILITY_KEYS = ["STR", "DEX", "CON", "INT", "WIS", "CHA"];

export function trimString(value: any) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeSpellcastingForExport(spellcasting: any, fallbackLevel = 1) {
  if (!spellcasting || typeof spellcasting !== "object") {
    return {
      progression: "none",
      ability: "",
      type: "",
      level: fallbackLevel,
      hasSpellcasting: false,
      isRitualCaster: false,
      description: "",
      spellsKnownFormula: "",
      spellsKnownId: "",
      progressionId: "",
      altProgressionId: "",
    };
  }

  const normalized = {
    ...spellcasting,
    ability: trimString(spellcasting.ability).toUpperCase(),
    type: trimString(spellcasting.type).toLowerCase(),
    level: Number(spellcasting.level || fallbackLevel) || fallbackLevel,
    hasSpellcasting: Boolean(spellcasting.hasSpellcasting),
    isRitualCaster: Boolean(spellcasting.isRitualCaster),
  } as any;

  if (!normalized.hasSpellcasting) {
    return {
      progression: "none",
      ability: "",
      type: "",
      level: normalized.level,
      hasSpellcasting: false,
      isRitualCaster: false,
      description: "",
      spellsKnownFormula: "",
      spellsKnownId: "",
      progressionId: "",
      altProgressionId: "",
    };
  }

  return normalized;
}

export function getHpExportState(character: any) {
  const derivedHpMax = Number(character?.derivedHpMax ?? 0) || 0;
  const rawMax = character?.hp?.max;
  const normalizedCurrent = Number(character?.hp?.current ?? 10) || 10;
  const normalizedTemp = Number(character?.hp?.temp ?? 0) || 0;
  const normalizedMax = rawMax == null ? null : Number(rawMax);
  const hasExplicitMax =
    Number.isFinite(normalizedMax) &&
    (normalizedMax as number) > 0 &&
    (derivedHpMax <= 0 || normalizedMax !== derivedHpMax);

  return {
    current: normalizedCurrent,
    temp: normalizedTemp,
    max: hasExplicitMax ? normalizedMax : null,
  };
}

export function buildAbilityRoot(character: any) {
  return {
    str: { value: Number(character?.stats?.base?.STR ?? 10) || 10 },
    dex: { value: Number(character?.stats?.base?.DEX ?? 10) || 10 },
    con: { value: Number(character?.stats?.base?.CON ?? 10) || 10 },
    int: { value: Number(character?.stats?.base?.INT ?? 10) || 10 },
    wis: { value: Number(character?.stats?.base?.WIS ?? 10) || 10 },
    cha: { value: Number(character?.stats?.base?.CHA ?? 10) || 10 },
  };
}

export function buildSkillRoot(character: any) {
  return Object.fromEntries(
    Object.entries(SKILL_KEY_MAP).map(([skillId, skillKey]) => {
      const isExpert = Array.isArray(character?.expertiseSkills)
        ? character.expertiseSkills.includes(skillId)
        : false;
      const isProficient = Array.isArray(character?.proficientSkills)
        ? character.proficientSkills.includes(skillId)
        : false;
      const isHalf = Array.isArray(character?.halfProficientSkills)
        ? character.halfProficientSkills.includes(skillId)
        : false;
      const overriddenAbility = trimString(character?.overriddenSkillAbilities?.[skillId]);
      
      const value = isExpert ? 2 : (isProficient ? 1 : (isHalf ? 0.5 : 0));
      const ability = (overriddenAbility || SKILL_ABILITY_MAP[skillId] || "int").toLowerCase();

      return [
        skillKey,
        {
          value,
          ability,
          bonus: 0,
        },
      ];
    }),
  );
}

export function mapTraitSelectionToSemantic(traitType: string, selectedId: string) {
  const raw = String(selectedId || "").trim();
  if (!raw) return raw;

  if (traitType === "skills") {
    const skillCode = SKILL_KEY_MAP[raw] || raw;
    return skillCode.length <= 3 && !skillCode.includes(":")
      ? `skills:${skillCode}`
      : raw;
  }

  if (traitType === "saves") {
    return `saves:${raw.toLowerCase()}`;
  }

  return raw;
}

export function buildFeatureItemFromOwnedFeature(entry: any) {
  const isSubclassFeature = String(entry?.sourceType || "").includes("subclass");
  return {
    name: entry?.name || "Feature",
    type: "feat",
    img: entry?.imageUrl || "icons/svg/book.svg",
    system: {
      description: { value: entry?.description || "" },
      identifier: String(entry?.sourceId || entry?.entityId || entry?.name || "feature")
        .toLowerCase()
        .replace(/\W+/g, "-"),
      type: {
        value: isSubclassFeature ? "subclass" : "class",
        subtype: entry?.featureTypeSubtype || "",
      },
    },
    flags: {
      "dauligor-pairing": {
        sourceId: entry?.sourceId || `feature-${entry?.entityId}`,
        classSourceId: entry?.classSourceId || null,
        parentSourceId: isSubclassFeature
          ? entry?.subclassSourceId || null
          : null,
        featureTypeValue: isSubclassFeature ? "subclass" : "class",
        featureTypeSubtype: entry?.featureTypeSubtype || "",
      },
    },
  };
}

export function buildOptionFeatItem(entry: any) {
  return {
    name: entry?.name || "Option",
    type: "feat",
    img: entry?.imageUrl || "icons/svg/book.svg",
    system: {
      description: { value: entry?.description || "" },
      identifier: String(entry?.sourceId || entry?.entityId || entry?.name || "option")
        .toLowerCase()
        .replace(/\W+/g, "-"),
      type: {
        value: entry?.featureTypeValue || "class",
        subtype: entry?.featureTypeSubtype || "",
      },
    },
  };
}

export function normalizePrimaryAbilityValue(values: any): string[] {
  const valid = new Set(ABILITY_KEYS.map((key) => key.toLowerCase()));
  const flat = Array.isArray(values) ? values.flat(Infinity) : [values];
  return Array.from(
    new Set(
      flat
        .map((value) => String(value || "").trim().toLowerCase())
        .filter((value) => valid.has(value)),
    ),
  );
}

export function slugify(text: string) {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\w-]+/g, "")
    .replace(/--+/g, "-");
}

export function flattenStringArray(values: any): string[] {
  if (!Array.isArray(values)) {
    const single = String(values ?? "").trim();
    return single ? [single] : [];
  }

  return values.flatMap((value) => flattenStringArray(value));
}

export function buildNamedDocLookup(entries: any[] = []) {
  const lookup: Record<string, string> = {};

  (Array.isArray(entries) ? entries : []).forEach((entry: any) => {
    const label = String(
      entry?.name || entry?.label || entry?.title || entry?.identifier || entry?.id || "",
    ).trim();
    if (!label) return;

    const keys = uniqueStringList([
      entry?.id,
      entry?.identifier,
      entry?.sourceId,
      entry?.slug,
      entry?.key,
    ]);

    keys.forEach((key) => {
      lookup[String(key)] = label;
      lookup[String(key).toLowerCase()] = label;
      lookup[String(key).toUpperCase()] = label;
    });
  });

  return lookup;
}
export function buildAdvancementSourceScope({
  parentType = "advancement",
  classId = "",
  className = "",
  subclassId = "",
  subclassName = "",
  parentId = "",
  parentName = "",
  sourceId = "",
}: {
  parentType?: string;
  classId?: string;
  className?: string;
  subclassId?: string;
  subclassName?: string;
  parentId?: string;
  parentName?: string;
  sourceId?: string;
} = {}) {
  return [
    `type:${sanitizeAdvancementKeyPart(parentType, "advancement")}`,
    `class:${sanitizeAdvancementKeyPart(classId || className, "none")}`,
    `subclass:${sanitizeAdvancementKeyPart(subclassId || subclassName, "none")}`,
    `parent:${sanitizeAdvancementKeyPart(parentId || sourceId || parentName, "root")}`,
  ].join("|");
}

export function buildAdvancementSourceContext({
  parentType = "class",
  classDocument = null,
  subclassDocument = null,
  parentDocument = null,
}: {
  parentType?: string;
  classDocument?: any;
  subclassDocument?: any;
  parentDocument?: any;
} = {}) {
  return {
    parentType,
    classId: String(classDocument?.id || "").trim(),
    className: String(classDocument?.name || "").trim(),
    subclassId: String(subclassDocument?.id || "").trim(),
    subclassName: String(subclassDocument?.name || "").trim(),
    parentId: String(
      parentDocument?.id || subclassDocument?.id || classDocument?.id || "",
    ).trim(),
    parentName: String(
      parentDocument?.name || subclassDocument?.name || classDocument?.name || "",
    ).trim(),
    sourceId: String(
      parentDocument
        ? `feature-${parentDocument.id}`
        : subclassDocument
          ? `subclass-${subclassDocument.id}`
          : classDocument
            ? `class-${classDocument.id}`
            : "",
    ).trim(),
  };
}

export function buildLegacyAdvancementSelectionKey(
  advancementId: any,
  level: any,
  choiceId?: any,
) {
  const advKey = String(advancementId ?? "").trim();
  const levelKey = String(level ?? "").trim() || "0";
  const choiceKey = String(choiceId ?? "").trim();
  return choiceKey
    ? `${advKey}-${choiceKey}-${levelKey}`
    : `${advKey}-${levelKey}`;
}

export function parseAdvancementSourceScope(scope: any) {
  return String(scope ?? "")
    .split("|")
    .reduce(
      (acc: Record<string, string>, part) => {
        const [rawKey, ...rest] = String(part || "").split(":");
        const key = String(rawKey || "").trim();
        if (!key) return acc;
        acc[key] = rest.join(":").trim();
        return acc;
      },
      {} as Record<string, string>,
    );
}

export function buildAdvancementSelectionKey({
  sourceScope = "",
  source,
  advancementId,
  level,
  choiceId,
}: {
  sourceScope?: string;
  source?: Record<string, any>;
  advancementId: any;
  level: any;
  choiceId?: any;
}) {
  const resolvedSourceScope =
    sourceScope || buildAdvancementSourceScope(source || {});
  const advKey = sanitizeAdvancementKeyPart(advancementId, "unknown");
  const levelKey = sanitizeAdvancementKeyPart(level, "0");
  const choiceKey = String(choiceId ?? "").trim();

  return [
    resolvedSourceScope,
    `adv:${advKey}`,
    `level:${levelKey}`,
    ...(choiceKey
      ? [`choice:${sanitizeAdvancementKeyPart(choiceKey, "choice")}`]
      : []),
  ].join("|");
}

export function getAdvancementSelectionValues(
  selectedOptions: Record<string, string[]> = {},
  keyConfig: {
    sourceScope?: string;
    source?: Record<string, any>;
    advancementId: any;
    level: any;
    choiceId?: any;
  },
) {
  const scopedKey = buildAdvancementSelectionKey(keyConfig);
  if (Array.isArray(selectedOptions?.[scopedKey])) {
    return uniqueStringList(selectedOptions[scopedKey]);
  }
  return [];
}

export function writeAdvancementSelectionValues(
  selectedOptions: Record<string, string[]> = {},
  keyConfig: {
    sourceScope?: string;
    source?: Record<string, any>;
    advancementId: any;
    level: any;
    choiceId?: any;
  },
  nextValues: string[] = [],
) {
  const scopedKey = buildAdvancementSelectionKey(keyConfig);
  const legacyKey = buildLegacyAdvancementSelectionKey(
    keyConfig.advancementId,
    keyConfig.level,
    keyConfig.choiceId,
  );
  const normalizedValues = uniqueStringList(nextValues);
  const nextSelectedOptions = { ...selectedOptions };

  if (legacyKey in nextSelectedOptions) {
    delete nextSelectedOptions[legacyKey];
  }

  if (normalizedValues.length > 0) {
    nextSelectedOptions[scopedKey] = normalizedValues;
  } else {
    delete nextSelectedOptions[scopedKey];
  }

  return nextSelectedOptions;
}

export function buildNonLegacySelectedOptionsMap(selectedOptions: Record<string, string[]> = {}) {
  return Object.fromEntries(
    Object.entries(selectedOptions || {}).filter(
      ([key, value]) =>
        !isLegacyAdvancementSelectionKey(key) &&
        Array.isArray(value) &&
        value.length > 0,
    ),
  ) as Record<string, string[]>;
}

export function buildCharacterSelectedOptionsMap(character: any) {
  const normalizedProgressionState = normalizeProgressionState(
    character?.progressionState,
  );
  const fromPackages = buildSelectedOptionsMapFromClassPackages(
    normalizedProgressionState.classPackages,
  );
  if (Object.keys(fromPackages).length > 0) {
    return fromPackages;
  }

  return buildNonLegacySelectedOptionsMap(character?.selectedOptions || {});
}

export function updateCharacterAdvancementSelectionState(
  character: any,
  keyConfig: {
    sourceScope?: string;
    source?: Record<string, any>;
    advancementId: any;
    level: any;
    choiceId?: any;
  },
  nextValues: string[] = [],
) {
  const nextSelectedOptions = writeAdvancementSelectionValues(
    character?.selectedOptions || {},
    keyConfig,
    nextValues,
  );
  const normalizedProgressionState = normalizeProgressionState(
    character?.progressionState,
  );
  const scopedKey = buildAdvancementSelectionKey(keyConfig);
  const parsedScope = parseAdvancementSourceScope(
    keyConfig.sourceScope || buildAdvancementSourceScope(keyConfig.source || {}),
  );
  const classToken = String(parsedScope.class || "").trim();
  const normalizedValues = uniqueStringList(nextValues);

  const nextClassPackages = normalizedProgressionState.classPackages.map((pkg: any) => {
    const packageClassToken = sanitizeAdvancementKeyPart(
      pkg?.classId || pkg?.className,
      "none",
    );
    if (packageClassToken !== classToken) return pkg;

    const existingSelections = Array.isArray(pkg?.advancementSelections)
      ? pkg.advancementSelections.map(normalizeAdvancementSelectionEntry)
      : [];
    const filteredSelections = existingSelections.filter(
      (entry: any) => entry.key !== scopedKey,
    );

    return {
      ...pkg,
      advancementSelections:
        normalizedValues.length > 0
          ? [
              ...filteredSelections,
              {
                key: scopedKey,
                parentType: String(parsedScope.type || "").trim(),
                parentId: String(parsedScope.parent || "").trim(),
                parentSourceId: String(
                  keyConfig.source?.sourceId || "",
                ).trim(),
                advancementId: String(keyConfig.advancementId || "").trim(),
                level: Number(keyConfig.level || 0) || 0,
                choiceId: String(keyConfig.choiceId || "").trim(),
                type: "",
                selectedIds: normalizedValues,
                selectedSemantic: [],
              },
            ]
          : filteredSelections,
    };
  });

  return {
    ...character,
    selectedOptions: nextSelectedOptions,
    progressionState: {
      ...normalizedProgressionState,
      classPackages: nextClassPackages,
    },
  };
}

export function dedupeOwnedStateEntries(entries: any[] = []) {
  const seen = new Set<string>();
  return entries.filter((entry: any) => {
    const key = [
      String(entry?.ownerClassId || ""),
      String(entry?.ownerSubclassId || ""),
      String(entry?.sourceId || entry?.entityId || ""),
      String(entry?.parentType || ""),
      String(entry?.level || ""),
    ].join(":");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function getStoredHpMax(character: any) {
  const rawMax = character?.hp?.max;
  if (rawMax == null || rawMax === "") return null;
  const numericMax = Number(rawMax);
  return Number.isFinite(numericMax) && numericMax > 0 ? numericMax : null;
}

export function hasExplicitHpMaxOverride(character: any) {
  const storedMax = getStoredHpMax(character);
  const derivedHpMax = Number(character?.derivedHpMax ?? 0) || 0;
  return storedMax != null && (derivedHpMax <= 0 || storedMax !== derivedHpMax);
}

export function getEffectiveHpMax(character: any) {
  const storedMax = getStoredHpMax(character);
  if (storedMax != null) return storedMax;
  return Number(character?.derivedHpMax ?? 10) || 10;
}

export function areStringListsEqual(left: any[] = [], right: any[] = []) {
  const normalizedLeft = uniqueStringList(left);
  const normalizedRight = uniqueStringList(right);
  return (
    normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((value, index) => value === normalizedRight[index])
  );
}

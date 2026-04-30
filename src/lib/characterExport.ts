import { db } from "./firebase";
import { doc, getDoc } from "firebase/firestore";
import { saveAs } from "file-saver";
import { slugify } from "./classExport";
import {
  getCanonicalTraitChoiceEntries,
  normalizeAdvancementListForEditor,
  resolveAdvancementDefaultHitDie,
} from "./advancementState";

export interface CharacterExportBundle {
  kind: "dauligor.actor-bundle.v1";
  schemaVersion: 1;
  source: {
    system: "dauligor";
    entity: "actor";
    id: string;
    rules: "2014";
    revision: 1;
  };
  actor: any;
  items: any[];
}

const SKILL_KEY_MAP: Record<string, string> = {
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

const SKILL_ABILITY_MAP: Record<string, string> = {
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

const ABILITY_KEYS = ["STR", "DEX", "CON", "INT", "WIS", "CHA"];

function trimString(value: any) {
  return typeof value === "string" ? value.trim() : "";
}

function uniqueStrings(values: any[] = []) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value ?? "").trim())
        .filter(Boolean),
    ),
  );
}

function flattenStringArray(values: any): string[] {
  if (!Array.isArray(values)) {
    const single = String(values ?? "").trim();
    return single ? [single] : [];
  }

  return values.flatMap((value) => flattenStringArray(value));
}

function normalizePrimaryAbilityValue(values: any): string[] {
  const valid = new Set(ABILITY_KEYS.map((key) => key.toLowerCase()));
  return Array.from(
    new Set(
      flattenStringArray(values)
        .map((value) => String(value || "").trim().toLowerCase())
        .filter((value) => valid.has(value)),
    ),
  );
}

function normalizeSpellcastingForExport(spellcasting: any, fallbackLevel = 1) {
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

function getTotalCharacterLevel(
  progression: any[] = [],
  progressionGroups: any[] = [],
  fallbackLevel = 1,
) {
  const progressionCount = Array.isArray(progression) ? progression.length : 0;
  if (progressionCount > 0) return progressionCount;

  const groupedLevel = (Array.isArray(progressionGroups) ? progressionGroups : []).reduce(
    (sum, group: any) => sum + (Number(group?.classLevel || 0) || 0),
    0,
  );
  if (groupedLevel > 0) return groupedLevel;

  const numericFallback = Number(fallbackLevel || 1) || 1;
  return Math.max(1, numericFallback);
}

function getProficiencyBonusForLevel(level: any) {
  const numericLevel = Math.max(1, Number(level || 1) || 1);
  return Math.floor((numericLevel - 1) / 4) + 2;
}

function getHpExportState(character: any) {
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

function buildEmptyProgressionState() {
  return {
    classPackages: [] as any[],
    ownedFeatures: [] as any[],
    ownedItems: [] as any[],
    ownedSpells: [] as any[],
    derivedSync: {},
  };
}

function normalizeProgressionState(progressState: any) {
  const normalized =
    progressState && typeof progressState === "object" ? progressState : {};

  return {
    ...buildEmptyProgressionState(),
    ...normalized,
    classPackages: Array.isArray(normalized.classPackages)
      ? normalized.classPackages
      : [],
    ownedFeatures: Array.isArray(normalized.ownedFeatures)
      ? normalized.ownedFeatures
      : [],
    ownedItems: Array.isArray(normalized.ownedItems) ? normalized.ownedItems : [],
    ownedSpells: Array.isArray(normalized.ownedSpells)
      ? normalized.ownedSpells
      : [],
    derivedSync:
      normalized.derivedSync &&
      typeof normalized.derivedSync === "object" &&
      !Array.isArray(normalized.derivedSync)
        ? normalized.derivedSync
        : {},
  };
}

function buildSelectedOptionsMapFromClassPackages(classPackages: any[] = []) {
  return Object.fromEntries(
    (Array.isArray(classPackages) ? classPackages : [])
      .flatMap((pkg: any) =>
        (Array.isArray(pkg?.advancementSelections)
          ? pkg.advancementSelections
          : []
        ).map((selection: any) => [
          String(selection?.key || "").trim(),
          uniqueStrings(selection?.selectedIds || []),
        ]),
      )
      .filter(([key, value]) => key && Array.isArray(value) && value.length > 0),
  ) as Record<string, string[]>;
}

function buildCurrentProgression(character: any) {
  if (Array.isArray(character?.progression) && character.progression.length > 0) {
    return character.progression;
  }

  if (!character?.classId) return [];
  return Array.from({ length: character.level || 1 }).map((_, index) => ({
    classId: character.classId,
    className: character.classId,
    subclassId: character.subclassId || "",
    level: index + 1,
  }));
}

function getProgressionClassKey(entry: any) {
  return String(entry?.classId || entry?.className || "").trim();
}

function buildProgressionClassGroups(
  progression: any[] = [],
  classDocsById: Record<string, any> = {},
  subclassDocsById: Record<string, any> = {},
  legacySubclassId = "",
) {
  const groups = new Map<string, any>();

  progression.forEach((entry: any, index: number) => {
    const classId = String(entry?.classId || "").trim();
    const className = String(entry?.className || "").trim();
    const classDocument =
      classDocsById[classId] ||
      Object.values(classDocsById).find(
        (candidate: any) =>
          candidate?.id === classId || candidate?.name === className,
      ) ||
      null;
    const classKey = String(classDocument?.id || classId || className).trim();
    if (!classKey) return;

    if (!groups.has(classKey)) {
      groups.set(classKey, {
        classKey,
        classId: classDocument?.id || classId,
        className: classDocument?.name || className,
        classDocument,
        classLevel: 0,
        subclassId: "",
        firstIndex: index,
      });
    }

    const group = groups.get(classKey);
    group.classLevel += 1;
    if (!group.classDocument && classDocument) group.classDocument = classDocument;

    const entrySubclassId = String(entry?.subclassId || "").trim();
    if (entrySubclassId) group.subclassId = entrySubclassId;
  });

  const normalizedLegacySubclassId = String(legacySubclassId || "").trim();
  if (normalizedLegacySubclassId && groups.size > 0) {
    const legacySubclass = subclassDocsById[normalizedLegacySubclassId];
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

function resolveHitDieFaces(hitDie: any) {
  if (typeof hitDie === "number") {
    return resolveAdvancementDefaultHitDie(hitDie);
  }

  const raw = String(hitDie ?? "").trim();
  const match = raw.match(/\d+/);
  const parsed = match ? parseInt(match[0], 10) : Number.NaN;
  return resolveAdvancementDefaultHitDie(parsed);
}

function normalizeAdvancementList(advancements: any[] = [], defaultHitDie = 8) {
  return normalizeAdvancementListForEditor(advancements, {
    defaultLevel: 1,
    defaultHitDie: resolveAdvancementDefaultHitDie(defaultHitDie),
  });
}

function buildAdvancementSelectionMapForPackage(pkg: any) {
  return Object.fromEntries(
    (Array.isArray(pkg?.advancementSelections) ? pkg.advancementSelections : [])
      .map((selection: any) => [
        String(selection?.key || "").trim(),
        uniqueStrings(selection?.selectedIds || []),
      ])
      .filter(([key, value]) => key && Array.isArray(value) && value.length > 0),
  ) as Record<string, string[]>;
}

function getSelectionsForAdvancement(
  advancement: any,
  selectionMap: Record<string, string[]> = {},
) {
  const advancementId = String(advancement?._id || "").trim();
  const level = Number(advancement?.level || 1) || 1;

  if (advancement?.type === "Trait") {
    const canonicalChoices = getCanonicalTraitChoiceEntries(
      advancement?.configuration || {},
    );
    if (canonicalChoices.length > 0) {
      return uniqueStrings(
        canonicalChoices.flatMap((choice) => {
          const choiceId = String(choice?.id || "").trim();
          return selectionMap[
            Object.keys(selectionMap).find(
              (key) =>
                key.includes(`|adv:${advancementId}|`) &&
                key.includes(`|level:${level}`) &&
                key.includes(`|choice:${choiceId}`),
            ) || ""
          ] || [];
        }),
      );
    }
  }

  return uniqueStrings(
    selectionMap[
      Object.keys(selectionMap).find(
        (key) =>
          key.includes(`|adv:${advancementId}|`) &&
          key.includes(`|level:${level}`),
      ) || ""
    ] || [],
  );
}

function mapTraitSelectionToSemantic(traitType: string, selectedId: string) {
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

function buildFeatureItemFromOwnedFeature(entry: any) {
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

function buildOptionFeatItem(entry: any) {
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
    flags: {
      "dauligor-pairing": {
        sourceId: entry?.sourceId || `class-option-${entry?.entityId}`,
        classSourceId: entry?.classSourceId || null,
        groupSourceId: entry?.groupSourceId || null,
        featureSourceId: entry?.featureSourceId || null,
        scalingSourceId: entry?.scalingSourceId || null,
        featureTypeValue: entry?.featureTypeValue || "class",
        featureTypeSubtype: entry?.featureTypeSubtype || "",
      },
    },
  };
}

async function fetchDocumentsByIds(collectionName: string, ids: string[]) {
  const entries = await Promise.all(
    uniqueStrings(ids).map(async (id) => {
      const snapshot = await getDoc(doc(db, collectionName, id));
      if (!snapshot.exists()) return null;
      return { id: snapshot.id, ...snapshot.data() };
    }),
  );

  return Object.fromEntries(
    entries
      .filter(Boolean)
      .map((entry: any) => [entry.id, entry]),
  ) as Record<string, any>;
}

function buildAbilityRoot(character: any) {
  return {
    str: { value: Number(character?.stats?.base?.STR ?? 10) || 10 },
    dex: { value: Number(character?.stats?.base?.DEX ?? 10) || 10 },
    con: { value: Number(character?.stats?.base?.CON ?? 10) || 10 },
    int: { value: Number(character?.stats?.base?.INT ?? 10) || 10 },
    wis: { value: Number(character?.stats?.base?.WIS ?? 10) || 10 },
    cha: { value: Number(character?.stats?.base?.CHA ?? 10) || 10 },
  };
}

function buildSkillRoot(character: any) {
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
      const overriddenAbility = trimString(
        character?.overriddenSkillAbilities?.[skillId],
      ).toLowerCase();

      return [
        skillKey,
        {
          value: isExpert ? 2 : isProficient ? 1 : isHalf ? 0.5 : 0,
          ability: overriddenAbility || SKILL_ABILITY_MAP[skillId],
        },
      ];
    }),
  );
}

export async function buildCharacterExport(
  characterId: string,
): Promise<CharacterExportBundle | null> {
  const charDoc = await getDoc(doc(db, "characters", characterId));
  if (!charDoc.exists()) return null;

  const charData = { id: charDoc.id, ...charDoc.data() } as any;
  const progressionState = normalizeProgressionState(charData.progressionState);
  const progression = buildCurrentProgression(charData);
  const classPackages = Array.isArray(progressionState.classPackages)
    ? progressionState.classPackages
    : [];
  const classIds = uniqueStrings(
    classPackages.map((pkg: any) => pkg?.classId).filter(Boolean),
  );
  const subclassIds = uniqueStrings(
    classPackages.map((pkg: any) => pkg?.subclassId).filter(Boolean),
  );

  const [classDocsById, subclassDocsById] = await Promise.all([
    fetchDocumentsByIds("classes", classIds),
    fetchDocumentsByIds("subclasses", subclassIds),
  ]);

  const progressionGroups = buildProgressionClassGroups(
    progression,
    classDocsById,
    subclassDocsById,
    charData.subclassId,
  );
  const packageByClassId = Object.fromEntries(
    classPackages.map((pkg: any) => [String(pkg?.classId || "").trim(), pkg]),
  ) as Record<string, any>;
  const totalCharacterLevel = getTotalCharacterLevel(
    progression,
    progressionGroups,
    charData.level,
  );
  const proficiencyBonus = getProficiencyBonusForLevel(totalCharacterLevel);
  const hpExportState = getHpExportState(charData);

  const items: any[] = [];

  progressionGroups.forEach((group: any) => {
    const classDoc = classDocsById[group.classId];
    if (!classDoc) return;

    const classPackage = packageByClassId[group.classId] || {};
    const selectionMap = buildAdvancementSelectionMapForPackage(classPackage);
    const hitDieFaces = resolveHitDieFaces(classDoc.hitDie);
    const classAdvancements = normalizeAdvancementList(
      classDoc.advancements || [],
      hitDieFaces,
    ).map((advancement: any) => {
      const normalizedAdvancement = { ...advancement };
      const chosenSelections = getSelectionsForAdvancement(
        normalizedAdvancement,
        selectionMap,
      );

      if (normalizedAdvancement.type === "HitPoints") {
        const history =
          classPackage?.hitPointHistory &&
          Object.keys(classPackage.hitPointHistory).length > 0
            ? classPackage.hitPointHistory
            : (() => {
                const fallback: Record<string, string | number> = { "1": "max" };
                const avg = Math.floor(hitDieFaces / 2) + 1;
                for (let level = 2; level <= (group.classLevel || 1); level += 1) {
                  fallback[String(level)] = avg;
                }
                return fallback;
              })();
        normalizedAdvancement.value = history;
        return normalizedAdvancement;
      }

      if (chosenSelections.length > 0) {
        if (normalizedAdvancement.type === "Trait") {
          const traitType = trimString(
            normalizedAdvancement?.configuration?.type,
          );
          normalizedAdvancement.value = {
            chosen: chosenSelections.map((entry) =>
              mapTraitSelectionToSemantic(traitType, entry),
            ),
          };
        } else if (
          normalizedAdvancement.type === "ItemChoice" ||
          normalizedAdvancement.type === "Subclass"
        ) {
          normalizedAdvancement.value = { chosen: chosenSelections };
        }
      }

      return normalizedAdvancement;
    });

    items.push({
      name: classDoc.name,
      type: "class",
      img: classDoc.imageUrl || "icons/svg/item-bag.svg",
      system: {
        identifier: trimString(classDoc.identifier) || slugify(classDoc.name),
        levels: group.classLevel || 1,
        hd: {
          number: group.classLevel || 1,
          denomination: String(hitDieFaces || 10),
        },
        spellcasting: normalizeSpellcastingForExport(classDoc.spellcasting, 1),
        primaryAbility: {
          value:
            normalizePrimaryAbilityValue(classDoc.primaryAbility).length > 0
              ? normalizePrimaryAbilityValue(classDoc.primaryAbility)
              : ["str"],
        },
        advancement: classAdvancements,
      },
      flags: {
        "dauligor-pairing": {
          sourceId: classPackage?.classSourceId || `class-${classDoc.id}`,
        },
      },
    });

    const subclassId = String(group.subclassId || "").trim();
    if (subclassId) {
      const subclassDoc = subclassDocsById[subclassId];
      if (subclassDoc) {
        const subclassAdvancements = normalizeAdvancementList(
          subclassDoc.advancements || [],
          hitDieFaces,
        ).map((advancement: any) => {
          const normalizedAdvancement = { ...advancement };
          const chosenSelections = getSelectionsForAdvancement(
            normalizedAdvancement,
            selectionMap,
          );
          if (chosenSelections.length > 0) {
            if (
              normalizedAdvancement.type === "Trait" ||
              normalizedAdvancement.type === "ItemChoice" ||
              normalizedAdvancement.type === "Subclass"
            ) {
              normalizedAdvancement.value = { chosen: chosenSelections };
            }
          }
          return normalizedAdvancement;
        });

        items.push({
          name: subclassDoc.name,
          type: "subclass",
          img: subclassDoc.imageUrl || "icons/svg/item-bag.svg",
          system: {
            identifier:
              trimString(subclassDoc.identifier) || slugify(subclassDoc.name),
            classIdentifier:
              trimString(classDoc.identifier) || slugify(classDoc.name),
            spellcasting: normalizeSpellcastingForExport(
              subclassDoc.spellcasting,
              3,
            ),
            advancement: subclassAdvancements,
          },
          flags: {
            "dauligor-pairing": {
              sourceId:
                classPackage?.subclassSourceId || `subclass-${subclassDoc.id}`,
            },
          },
        });
      }
    }
  });

  progressionState.ownedFeatures.forEach((entry: any) => {
    items.push(buildFeatureItemFromOwnedFeature(entry));
  });

  progressionState.ownedItems
    .filter((entry: any) =>
      ["option", "selection"].includes(String(entry?.sourceType || "").trim()),
    )
    .forEach((entry: any) => {
      items.push(buildOptionFeatItem(entry));
    });

  const actorSourceId = `character-${charDoc.id}`;
  const selectedOptions = buildSelectedOptionsMapFromClassPackages(classPackages);

  return {
    kind: "dauligor.actor-bundle.v1",
    schemaVersion: 1,
    source: {
      system: "dauligor",
      entity: "actor",
      id: charDoc.id,
      rules: "2014",
      revision: 1,
    },
    actor: {
      name: charData.name || "Unnamed Character",
      type: "character",
      img: charData.imageUrl || "icons/svg/mystery-man.svg",
      system: {
        abilities: buildAbilityRoot(charData),
        attributes: {
          hp: {
            value: hpExportState.current,
            ...(hpExportState.max != null ? { max: hpExportState.max } : {}),
            temp: hpExportState.temp,
          },
          ac: {
            flat: Number(charData.ac ?? 10) || 10,
            calc: "flat",
          },
          init: {
            bonus: Number(charData.initiative ?? 0) || 0,
          },
          movement: {
            walk: Number(charData.speed ?? 30) || 30,
            units: "ft",
          },
          prof: proficiencyBonus,
          exhaustion: Number(charData.exhaustion ?? 0) || 0,
        },
        details: {
          alignment: trimString(charData.info?.alignment),
          race: trimString(charData.raceId),
          background: trimString(charData.backgroundId),
          biography: {
            value: `
              ${charData.info?.appearance ? `<h3>Appearance</h3><p>${charData.info.appearance}</p>` : ""}
              ${charData.info?.traits ? `<h3>Traits</h3><p>${charData.info.traits}</p>` : ""}
              ${charData.info?.ideals ? `<h3>Ideals</h3><p>${charData.info.ideals}</p>` : ""}
              ${charData.info?.bonds ? `<h3>Bonds</h3><p>${charData.info.bonds}</p>` : ""}
              ${charData.info?.flaws ? `<h3>Flaws</h3><p>${charData.info.flaws}</p>` : ""}
            `.trim(),
          },
        },
        skills: buildSkillRoot(charData),
        traits: {
          size: trimString(charData.raceData?.size || "Medium")
            .toLowerCase()
            .substring(0, 3),
          languages: { value: Array.isArray(charData.languages) ? charData.languages : [] },
          dr: { value: Array.isArray(charData.resistances) ? charData.resistances : [] },
          di: { value: Array.isArray(charData.immunities) ? charData.immunities : [] },
          dv: {
            value: Array.isArray(charData.vulnerabilities)
              ? charData.vulnerabilities
              : [],
          },
        },
        currency:
          charData.currency && typeof charData.currency === "object"
            ? charData.currency
            : {},
      },
      flags: {
        "dauligor-pairing": {
          sourceId: actorSourceId,
          sourceType: "actor",
          entityKind: "character",
          schemaVersion: 1,
          campaignId: trimString(charData.campaignId),
          isLevelLocked: Boolean(charData.isLevelLocked),
          primaryClassId: trimString(progressionGroups[0]?.classId || charData.classId),
          primarySubclassId: trimString(
            progressionGroups[0]?.subclassId || charData.subclassId,
          ),
          progressionClassIds: uniqueStrings(
            progressionGroups.map((group: any) => group.classId),
          ),
          progressionSubclassIds: uniqueStrings(
            progressionGroups.map((group: any) => group.subclassId),
          ),
          selectedOptions,
        },
      },
    },
    items,
  };
}

export async function exportCharacterJSON(characterId: string) {
  const payload = await buildCharacterExport(characterId);
  if (!payload) {
    throw new Error("Character not found or could not be loaded for export.");
  }

  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const safeName = slugify(payload.actor?.name || "character");
  saveAs(blob, `dauligor-character-${safeName}-${characterId}.json`);
}

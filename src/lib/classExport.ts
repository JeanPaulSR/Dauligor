import { db } from './firebase';
import { 
  doc, 
  getDoc, 
  getDocs, 
  collection, 
  query, 
  where, 
  documentId,
  setDoc,
  serverTimestamp
} from 'firebase/firestore';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';

export interface SourceExportBundle {
  catalog: any;
  sourceDetail: any;
  classCatalog: any;
  classes: { [slug: string]: any };
}

function buildSemanticRecordSourceId(prefix: string, record: any, fallbackId: string = '') {
  const identifier = trimString(record?.identifier) || slugify(trimString(record?.name || fallbackId));
  return identifier ? `${prefix}-${identifier}` : trimString(fallbackId);
}

function resolveImageUrl(record: any) {
  return trimString(
    record?.imageUrl
    || record?.iconUrl
    || record?.img
    || record?.image
  );
}

/**
 * Imports a class semantic export bundle into Firestore.
 */
export async function importClassSemantic(data: any) {
  if (!data.class || !data.class.id) {
    throw new Error("Invalid class export data: missing class information");
  }

  const {
    class: classData,
    subclasses = [],
    features = [],
    scalingColumns = [],
    uniqueOptionGroups = [],
    uniqueOptionItems = [],
    spellcastingScalings = {},
    spellsKnownScalings = {},
    alternativeSpellcastingScalings = {},
    source = null
  } = data;

  // Helper to strip internal Firestore metadata and handle Timestamps
  const prepare = (docData: any) => {
    const clean = { ...docData };
    delete clean.id; // Usually stored separately
    // If createdAt/updatedAt are objects (from JSON), we replace them with serverTimestamp or current date
    if (clean.createdAt && typeof clean.createdAt === 'object') {
      delete clean.createdAt;
    }
    if (clean.updatedAt && typeof clean.updatedAt === 'object') {
      delete clean.updatedAt;
    }
    return clean;
  };

  // 1. Handle Source
  if (source && source.id) {
    const sourceRef = doc(db, 'sources', source.id);
    const sourceSnap = await getDoc(sourceRef);
    if (!sourceSnap.exists()) {
      // Create source if it doesn't exist
      await setDoc(sourceRef, {
        ...prepare(source),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    }
  }

  // 2. Handle Spellcasting Scalings
  for (const id in spellcastingScalings) {
    const sc = spellcastingScalings[id];
    await setDoc(doc(db, 'spellcastingScalings', id), {
      ...prepare(sc),
      updatedAt: serverTimestamp()
    });
  }

  for (const id in spellsKnownScalings) {
    const sc = spellsKnownScalings[id];
    await setDoc(doc(db, 'spellsKnownScalings', id), {
      ...prepare(sc),
      updatedAt: serverTimestamp()
    });
  }

  for (const id in alternativeSpellcastingScalings) {
    const sc = alternativeSpellcastingScalings[id];
    await setDoc(doc(db, 'pactMagicScalings', id), {
      ...prepare(sc),
      updatedAt: serverTimestamp()
    });
  }

  // 3. Handle Unique Option Groups
  for (const group of uniqueOptionGroups) {
    await setDoc(doc(db, 'uniqueOptionGroups', group.id), {
      ...prepare(group),
      updatedAt: serverTimestamp()
    });
  }

  // 4. Handle Unique Option Items
  for (const item of uniqueOptionItems) {
    await setDoc(doc(db, 'uniqueOptionItems', item.id), {
      ...prepare(item),
      updatedAt: serverTimestamp()
    });
  }

  // 5. Handle Scaling Columns
  for (const col of scalingColumns) {
    await setDoc(doc(db, 'scalingColumns', col.id), {
      ...prepare(col),
      updatedAt: serverTimestamp()
    });
  }

  // 6. Handle Subclasses
  for (const sub of subclasses) {
    await setDoc(doc(db, 'subclasses', sub.id), {
      ...prepare(sub),
      updatedAt: serverTimestamp()
    });
  }

  // 7. Handle Features
  for (const feat of features) {
    await setDoc(doc(db, 'features', feat.id), {
      ...prepare(feat),
      updatedAt: serverTimestamp()
    });
  }

  // 8. Handle the Class itself
  await setDoc(doc(db, 'classes', classData.id), {
    ...prepare(classData),
    updatedAt: serverTimestamp()
  });

  return classData.id;
}

/**
 * Helper to slugify strings.
 */
export function slugify(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9-]/g, '-');
}

/**
 * Robust text cleaner that converts BBCode/HTML to Markdown
 * and fixes common encoding/legacy text artifacts.
 */
function cleanText(text: string): string {
  if (!text) return "";
  let cleaned = text;
  
  // Convert BBCode to Markdown
  cleaned = cleaned.replace(/\[h(\d)\]/gi, (match, level) => '\n' + '#'.repeat(parseInt(level)) + ' ');
  cleaned = cleaned.replace(/\[\/h\d\]/gi, '\n');
  cleaned = cleaned.replace(/\[b\]/gi, '**').replace(/\[\/b\]/gi, '**');
  cleaned = cleaned.replace(/\[i\]/gi, '*').replace(/\[\/i\]/gi, '*');
  cleaned = cleaned.replace(/\[ul\]/gi, '\n').replace(/\[\/ul\]/gi, '\n');
  cleaned = cleaned.replace(/\[li\]/gi, '* ').replace(/\[\/li\]/gi, '\n');
  cleaned = cleaned.replace(/\[center\]/gi, '').replace(/\[\/center\]/gi, '');
  
  // HTML tags to Markdown (basic)
  cleaned = cleaned.replace(/<p>/gi, '').replace(/<\/p>/gi, '\n');
  cleaned = cleaned.replace(/<br\s*\/?>/gi, '\n');
  cleaned = cleaned.replace(/&nbsp;/gi, ' ');
  
  // Remove remaining HTML tags
  cleaned = cleaned.replace(/<[^>]*>?/gm, '');

  // Fix "mojibake" / Special characters (Curly quotes to straight, etc.)
  cleaned = cleaned.replace(/[\u201C\u201D]/g, '"');
  cleaned = cleaned.replace(/[\u2018\u2019]/g, "'");
  cleaned = cleaned.replace(/\u2013/g, "-");
  cleaned = cleaned.replace(/\u2014/g, "--");
  cleaned = cleaned.replace(/\u2026/g, "...");

  // Consolidate multiple newlines
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

  return cleaned.trim();
}

function trimString(value: any) {
  return typeof value === 'string' ? value.trim() : '';
}

function uniqueStrings(values: any[] = []) {
  return Array.from(new Set(values.map(value => trimString(value)).filter(Boolean)));
}

function omitKeys<T extends Record<string, any>>(value: T, keys: string[] = []) {
  const clone: Record<string, any> = { ...value };
  keys.forEach((key) => {
    delete clone[key];
  });
  return clone as T;
}

function asArray<T = any>(value: any): T[] {
  return Array.isArray(value) ? value : [];
}

function buildDocMap(snapshot: any) {
  const mapped: Record<string, any> = {};
  snapshot.docs.forEach((docSnap: any) => {
    mapped[docSnap.id] = { id: docSnap.id, ...docSnap.data() };
  });
  return mapped;
}

function getSemanticToken(entry: any, {
  preferFoundry = false,
  uppercase = false
}: { preferFoundry?: boolean; uppercase?: boolean } = {}) {
  const raw = preferFoundry
    ? (entry?.foundryAlias || entry?.identifier || entry?.name)
    : (entry?.identifier || entry?.foundryAlias || entry?.name);
  const fallback = slugify(String(raw || ''));
  if (!fallback) return '';
  return uppercase ? fallback.toUpperCase() : fallback.toLowerCase();
}

function normalizeMappedId(id: string | undefined, map: Record<string, any>, options: { preferFoundry?: boolean; uppercase?: boolean } = {}) {
  const raw = trimString(id);
  if (!raw) return '';
  const entry = map[raw];
  if (!entry) {
    return options.uppercase ? raw.toUpperCase() : raw;
  }
  return getSemanticToken(entry, options);
}

function normalizeSpellcastingForExport(spellcasting: any, refs: any = {}, {
  preserveNativeProgression = false
}: { preserveNativeProgression?: boolean } = {}) {
  if (!spellcasting || typeof spellcasting !== 'object') return null;

  const normalized: any = {
    ...spellcasting,
    description: cleanText(spellcasting.description || ''),
    hasSpellcasting: Boolean(spellcasting.hasSpellcasting),
    level: Number(spellcasting.level || 1) || 1,
    ability: trimString(spellcasting.ability).toUpperCase() || '',
    type: trimString(spellcasting.type).toLowerCase() || 'prepared',
    spellsKnownFormula: trimString(spellcasting.spellsKnownFormula)
  };

  const progressionTypeId = trimString(spellcasting.progressionId);
  const progressionType = refs.spellcastingTypesById?.[progressionTypeId];
  if (progressionTypeId) {
    normalized.progressionTypeSourceId = buildSemanticRecordSourceId('spellcasting-type', progressionType, progressionTypeId);
  }
  if (progressionType?.identifier) normalized.progressionTypeIdentifier = trimString(progressionType.identifier);
  if (progressionType?.name) normalized.progressionTypeLabel = trimString(progressionType.name);
  if (progressionType?.formula) normalized.progressionFormula = trimString(progressionType.formula);

  const mappedProgression = trimString(progressionType?.foundryName).toLowerCase();
  const progression = trimString(spellcasting.progression).toLowerCase();
  const validNativeProgressions = new Set(['none', 'full', 'half', 'third', 'pact', 'artificer']);
  const hasLinkedScalingIds = Boolean(
    progressionTypeId
    || trimString(spellcasting.altProgressionId)
    || trimString(spellcasting.spellsKnownId)
  );

  if (mappedProgression && validNativeProgressions.has(mappedProgression)) {
    normalized.progression = mappedProgression;
  } else if (
    progression
    && validNativeProgressions.has(progression)
    && (preserveNativeProgression || !hasLinkedScalingIds)
  ) {
    normalized.progression = progression;
  } else {
    delete normalized.progression;
  }

  const alternativeProgressionId = trimString(spellcasting.altProgressionId);
  const alternativeProgression = refs.pactMagicScalingsById?.[alternativeProgressionId];
  if (alternativeProgressionId) {
    normalized.altProgressionSourceId = buildSemanticRecordSourceId('alternative-spellcasting-scaling', alternativeProgression, alternativeProgressionId);
  }

  const spellsKnownId = trimString(spellcasting.spellsKnownId);
  const spellsKnownScaling = refs.spellsKnownScalingsById?.[spellsKnownId];
  if (spellsKnownId) {
    normalized.spellsKnownSourceId = buildSemanticRecordSourceId('spells-known-scaling', spellsKnownScaling, spellsKnownId);
  }

  delete normalized.progressionId;
  delete normalized.manualProgressionId;
  delete normalized.altProgressionId;
  delete normalized.spellsKnownId;

  return normalized;
}

function sanitizeNormalizedProficiencyBlock(block: any) {
  const fixedIds = uniqueStrings(asArray(block?.fixedIds));
  const fixedSet = new Set(fixedIds);
  return {
    choiceCount: Number(block?.choiceCount || 0) || 0,
    categoryIds: uniqueStrings(asArray(block?.categoryIds)),
    optionIds: uniqueStrings(asArray(block?.optionIds)).filter((id) => !fixedSet.has(id)),
    fixedIds
  };
}

function normalizeClassProficiencies(rawProficiencies: any, refs: any) {
  const raw = rawProficiencies || {};

  return {
    armor: sanitizeNormalizedProficiencyBlock({
      choiceCount: Number(raw.armor?.choiceCount || 0) || 0,
      categoryIds: uniqueStrings(asArray(raw.armor?.categoryIds).map((id: string) => normalizeMappedId(id, refs.armorCategoriesById))),
      optionIds: uniqueStrings(asArray(raw.armor?.optionIds).map((id: string) => normalizeMappedId(id, refs.armorById, { preferFoundry: true }))),
      fixedIds: uniqueStrings(asArray(raw.armor?.fixedIds).map((id: string) => normalizeMappedId(id, refs.armorById, { preferFoundry: true })))
    }),
    weapons: sanitizeNormalizedProficiencyBlock({
      choiceCount: Number(raw.weapons?.choiceCount || 0) || 0,
      categoryIds: uniqueStrings(asArray(raw.weapons?.categoryIds).map((id: string) => normalizeMappedId(id, refs.weaponCategoriesById))),
      optionIds: uniqueStrings(asArray(raw.weapons?.optionIds).map((id: string) => normalizeMappedId(id, refs.weaponsById, { preferFoundry: true }))),
      fixedIds: uniqueStrings(asArray(raw.weapons?.fixedIds).map((id: string) => normalizeMappedId(id, refs.weaponsById, { preferFoundry: true })))
    }),
    tools: sanitizeNormalizedProficiencyBlock({
      choiceCount: Number(raw.tools?.choiceCount || 0) || 0,
      categoryIds: uniqueStrings(asArray(raw.tools?.categoryIds).map((id: string) => normalizeMappedId(id, refs.toolCategoriesById))),
      optionIds: uniqueStrings(asArray(raw.tools?.optionIds).map((id: string) => normalizeMappedId(id, refs.toolsById, { preferFoundry: true }))),
      fixedIds: uniqueStrings(asArray(raw.tools?.fixedIds).map((id: string) => normalizeMappedId(id, refs.toolsById, { preferFoundry: true })))
    }),
    languages: sanitizeNormalizedProficiencyBlock({
      choiceCount: Number(raw.languages?.choiceCount || 0) || 0,
      categoryIds: uniqueStrings(asArray(raw.languages?.categoryIds).map((id: string) => normalizeMappedId(id, refs.languageCategoriesById))),
      optionIds: uniqueStrings(asArray(raw.languages?.optionIds).map((id: string) => normalizeMappedId(id, refs.languagesById))),
      fixedIds: uniqueStrings(asArray(raw.languages?.fixedIds).map((id: string) => normalizeMappedId(id, refs.languagesById)))
    }),
    skills: sanitizeNormalizedProficiencyBlock({
      choiceCount: Number(raw.skills?.choiceCount || 0) || 0,
      optionIds: uniqueStrings(asArray(raw.skills?.optionIds).map((id: string) => normalizeMappedId(id, refs.skillsById, { preferFoundry: true }))),
      fixedIds: uniqueStrings(asArray(raw.skills?.fixedIds).map((id: string) => normalizeMappedId(id, refs.skillsById, { preferFoundry: true })))
    }),
    savingThrows: sanitizeNormalizedProficiencyBlock({
      choiceCount: Number(raw.savingThrows?.choiceCount || 0) || 0,
      optionIds: uniqueStrings(asArray(raw.savingThrows?.optionIds).map((id: string) => normalizeMappedId(id, refs.attributesById, { uppercase: true }))),
      fixedIds: uniqueStrings(asArray(raw.savingThrows?.fixedIds).map((id: string) => normalizeMappedId(id, refs.attributesById, { uppercase: true })))
    })
  };
}

function collectExplicitGrantedFeatureRefs(advancements: any[] = []) {
  const granted = new Set<string>();

  advancements.forEach((advancement) => {
    if (trimString(advancement?.type) !== 'ItemGrant') return;
    if (trimString(advancement?.featureId)) granted.add(trimString(advancement.featureId));
    if (trimString(advancement?.featureSourceId)) granted.add(trimString(advancement.featureSourceId));

    asArray(advancement?.configuration?.pool).forEach((entry: any) => granted.add(trimString(entry)));
    asArray(advancement?.configuration?.optionalPool).forEach((entry: any) => granted.add(trimString(entry)));
    asArray(advancement?.configuration?.items).forEach((entry: any) => {
      const sourceId = trimString(entry?.sourceId);
      const uuid = trimString(entry?.uuid);
      if (sourceId) granted.add(sourceId);
      if (uuid) granted.add(uuid);
    });
  });

  return granted;
}

function buildInherentFeatureGrantAdvancements(features: any[] = [], existingAdvancements: any[] = [], prefix: string) {
  const explicitlyGranted = collectExplicitGrantedFeatureRefs(existingAdvancements);

  return features
    .filter((feature) => !explicitlyGranted.has(feature.id) && !explicitlyGranted.has(feature.sourceId))
    .map((feature) => ({
      _id: `${prefix}-${feature.identifier || feature.id}`,
      type: 'ItemGrant',
      level: Number(feature.level || 1) || 1,
      title: feature.name || 'Grant Feature',
      featureId: feature.id,
      configuration: {
        choiceType: 'feature',
        optional: false,
        items: [{ uuid: feature.id, optional: false }]
      }
    }));
}

function buildOptionGroupFeatureSourceMap(records: any[] = [], featuresById: Record<string, any>) {
  const featureSourceByOptionGroup: Record<string, string> = {};

  records.forEach((record) => {
    asArray(record?.advancements).forEach((advancement) => {
      const optionGroupId = trimString(advancement?.configuration?.optionGroupId);
      if (!optionGroupId) return;

      const featureSourceId = trimString(advancement?.featureSourceId)
        || featuresById[trimString(advancement?.featureId)]?.sourceId
        || '';

      if (featureSourceId && !featureSourceByOptionGroup[optionGroupId]) {
        featureSourceByOptionGroup[optionGroupId] = featureSourceId;
      }
    });
  });

  return featureSourceByOptionGroup;
}

function normalizeSelectionCountsByLevel(values: any) {
  const normalized: Record<string, number> = {};
  if (!values || typeof values !== 'object') return normalized;

  Object.entries(values).forEach(([level, value]) => {
    const normalizedLevel = String(Number(level || 0) || 0);
    const numericValue = Number((value as any)?.count ?? value ?? 0) || 0;
    if (normalizedLevel !== '0' && numericValue > 0) {
      normalized[normalizedLevel] = numericValue;
    }
  });

  return normalized;
}

function buildOptionGroupAdvancementMetadataMap(
  records: any[] = [],
  featuresById: Record<string, any> = {},
  scalingById: Record<string, any> = {},
  scalingSourceIdById: Record<string, string> = {}
) {
  const metadataByOptionGroup: Record<string, {
    featureSourceId: string;
    scalingSourceId: string;
    selectionCountsByLevel: Record<string, number>;
  }> = {};

  records.forEach((record) => {
    asArray(record?.advancements).forEach((advancement) => {
      if (trimString(advancement?.type) !== 'ItemChoice') return;

      const configuration = advancement?.configuration || {};
      const optionGroupId = trimString(configuration?.optionGroupId);
      if (!optionGroupId) return;

      const entry = metadataByOptionGroup[optionGroupId] ||= {
        featureSourceId: '',
        scalingSourceId: '',
        selectionCountsByLevel: {}
      };

      const featureSourceId = trimString(advancement?.featureSourceId)
        || featuresById[trimString(advancement?.featureId)]?.sourceId
        || '';
      if (featureSourceId && !entry.featureSourceId) {
        entry.featureSourceId = featureSourceId;
      }

      const scalingSourceId = scalingSourceIdById[trimString(configuration?.scalingColumnId)]
        || trimString(configuration?.scalingSourceId)
        || trimString(configuration?.scalingColumnId);
      if (scalingSourceId && !entry.scalingSourceId) {
        entry.scalingSourceId = scalingSourceId;
      }

      if (trimString(configuration?.countSource) === 'scaling') {
        const scalingColumnId = trimString(configuration?.scalingColumnId);
        const scalingValues = normalizeSelectionCountsByLevel(
          scalingById[scalingColumnId]?.values
        );
        if (Object.keys(scalingValues).length) {
          entry.selectionCountsByLevel = scalingValues;
          return;
        }
      }

      const explicitCounts = normalizeSelectionCountsByLevel(configuration?.choices);
      if (Object.keys(explicitCounts).length) {
        Object.assign(entry.selectionCountsByLevel, explicitCounts);
        return;
      }

      const fixedCount = Number(configuration?.count || 0) || 0;
      const level = Number(advancement?.level || 0) || 0;
      if (fixedCount > 0 && level > 0 && !entry.selectionCountsByLevel[String(level)]) {
        entry.selectionCountsByLevel[String(level)] = fixedCount;
      }
    });
  });

  return metadataByOptionGroup;
}

function buildBaseClassAdvancementsForExport({
  classDataRaw,
  normalizedProficiencies,
  hitDie,
  subclassTitle,
  subclassFeatureLevels,
  asiLevels,
  existingAdvancements
}: {
  classDataRaw: any;
  normalizedProficiencies: any;
  hitDie: number;
  subclassTitle: string;
  subclassFeatureLevels: number[];
  asiLevels: number[];
  existingAdvancements: any[];
}) {
  const existingById = new Map(asArray(existingAdvancements).map((adv: any) => [adv._id, adv]));
  const baseItems = existingById.get('base-items');
  const subclassLevel = Number(subclassFeatureLevels?.[0] || existingById.get('base-subclass')?.level || 3) || 3;
  const baseAdvancements: any[] = [
    {
      _id: 'base-hp',
      type: 'HitPoints',
      isBase: true,
      level: 1,
      title: 'Hit Points',
      configuration: { hitDie }
    },
    {
      _id: 'base-saves',
      type: 'Trait',
      isBase: true,
      level: 1,
      title: 'Saving Throw Proficiencies',
      configuration: {
        type: 'saves',
        mode: 'default',
        choiceCount: normalizedProficiencies.savingThrows.choiceCount,
        fixed: normalizedProficiencies.savingThrows.fixedIds,
        options: normalizedProficiencies.savingThrows.optionIds,
        categoryIds: []
      }
    },
    {
      _id: 'base-armor',
      type: 'Trait',
      isBase: true,
      level: 1,
      title: 'Armor Proficiencies',
      configuration: {
        type: 'armor',
        mode: 'default',
        choiceCount: normalizedProficiencies.armor.choiceCount,
        fixed: normalizedProficiencies.armor.fixedIds,
        options: normalizedProficiencies.armor.optionIds,
        categoryIds: normalizedProficiencies.armor.categoryIds
      }
    },
    {
      _id: 'base-weapons',
      type: 'Trait',
      isBase: true,
      level: 1,
      title: 'Weapon Proficiencies',
      configuration: {
        type: 'weapons',
        mode: 'default',
        choiceCount: normalizedProficiencies.weapons.choiceCount,
        fixed: normalizedProficiencies.weapons.fixedIds,
        options: normalizedProficiencies.weapons.optionIds,
        categoryIds: normalizedProficiencies.weapons.categoryIds
      }
    },
    {
      _id: 'base-skills',
      type: 'Trait',
      isBase: true,
      level: 1,
      title: 'Skill Proficiencies',
      configuration: {
        type: 'skills',
        mode: 'default',
        choiceCount: normalizedProficiencies.skills.choiceCount,
        fixed: normalizedProficiencies.skills.fixedIds,
        options: normalizedProficiencies.skills.optionIds,
        categoryIds: []
      }
    },
    {
      _id: 'base-tools',
      type: 'Trait',
      isBase: true,
      level: 1,
      title: 'Tool Proficiencies',
      configuration: {
        type: 'tools',
        mode: 'default',
        choiceCount: normalizedProficiencies.tools.choiceCount,
        fixed: normalizedProficiencies.tools.fixedIds,
        options: normalizedProficiencies.tools.optionIds,
        categoryIds: normalizedProficiencies.tools.categoryIds
      }
    },
    {
      _id: 'base-languages',
      type: 'Trait',
      isBase: true,
      level: 1,
      title: 'Languages',
      configuration: {
        type: 'languages',
        mode: 'default',
        choiceCount: normalizedProficiencies.languages.choiceCount,
        fixed: normalizedProficiencies.languages.fixedIds,
        options: normalizedProficiencies.languages.optionIds,
        categoryIds: normalizedProficiencies.languages.categoryIds
      }
    },
    {
      _id: 'base-items',
      type: 'ItemChoice',
      isBase: true,
      level: 1,
      title: baseItems?.title || 'Starting Equipment Choices',
      configuration: {
        ...(baseItems?.configuration || {}),
        choiceType: baseItems?.configuration?.choiceType || 'item',
        pool: asArray(baseItems?.configuration?.pool),
        count: Number(baseItems?.configuration?.count || 1) || 1
      }
    },
    {
      _id: 'base-subclass',
      type: 'Subclass',
      isBase: true,
      level: subclassLevel,
      title: trimString(subclassTitle) || existingById.get('base-subclass')?.title || 'Select Subclass',
      configuration: {
        ...(existingById.get('base-subclass')?.configuration || {})
      }
    }
  ];

  (asiLevels || []).forEach((level, index) => {
    baseAdvancements.push({
      _id: `base-asi-${index}`,
      type: 'AbilityScoreImprovement',
      isBase: true,
      level,
      title: 'Ability Score Improvement',
      configuration: {
        points: 2,
        featAllowed: true
      }
    });
  });

  return baseAdvancements;
}

function collectReferencedOptionGroupIds(...records: any[]) {
  const ids = new Set<string>();

  const collectFromAdvancements = (advancements: any[] = []) => {
    advancements.forEach((adv) => {
      const optionGroupId = trimString(adv?.configuration?.optionGroupId);
      if (optionGroupId) ids.add(optionGroupId);
    });
  };

  records.forEach((record) => {
    if (!record) return;
    asArray(record.uniqueOptionGroupIds).forEach((id: string) => {
      const normalized = trimString(id);
      if (normalized) ids.add(normalized);
    });
    collectFromAdvancements(asArray(record.advancements));
  });

  return Array.from(ids);
}

function normalizeTraitEntry(kind: string, value: string, refs: any) {
  const raw = trimString(value);
  if (!raw) return '';
  if (raw.includes(':')) return raw;

  switch (kind) {
    case 'skills':
      return normalizeMappedId(raw, refs.skillsById, { preferFoundry: true });
    case 'saves':
      return normalizeMappedId(raw, refs.attributesById, { uppercase: true });
    case 'tools':
      return normalizeMappedId(raw, refs.toolsById, { preferFoundry: true });
    case 'armor':
      return normalizeMappedId(raw, refs.armorById, { preferFoundry: true });
    case 'weapons':
      return normalizeMappedId(raw, refs.weaponsById, { preferFoundry: true });
    case 'languages':
      return normalizeMappedId(raw, refs.languagesById);
    default:
      return raw;
  }
}

function normalizeTraitCategory(kind: string, value: string, refs: any) {
  const raw = trimString(value);
  if (!raw) return '';

  switch (kind) {
    case 'tools':
      return normalizeMappedId(raw, refs.toolCategoriesById);
    case 'armor':
      return normalizeMappedId(raw, refs.armorCategoriesById);
    case 'weapons':
      return normalizeMappedId(raw, refs.weaponCategoriesById);
    case 'languages':
      return normalizeMappedId(raw, refs.languageCategoriesById);
    default:
      return raw;
  }
}

function normalizeAdvancementForExport(advancement: any, context: any) {
  if (!advancement || typeof advancement !== 'object') return null;

  const normalized: any = JSON.parse(JSON.stringify(advancement));
  const configuration = { ...(normalized.configuration || {}) };
  const type = trimString(normalized.type);

  if (normalized.featureId) {
    const linkedFeature = context.featuresById[normalized.featureId];
    if (linkedFeature) {
      normalized.featureSourceId = linkedFeature.sourceId;
      normalized.level = Number(linkedFeature.level || normalized.level || 1) || 1;
      if (!trimString(normalized.title)) normalized.title = linkedFeature.name || normalized.title;
    }
    delete normalized.featureId;
  }

  if (type === 'Trait') {
    const traitType = trimString(configuration.type || 'skills');
    normalized.configuration = {
      ...configuration,
      mode: trimString(configuration.mode || 'default') || 'default',
      choiceCount: Number(configuration.choiceCount || 0) || 0,
      choiceSource: trimString(configuration.choiceSource || ''),
      allowReplacements: Boolean(configuration.allowReplacements ?? configuration.allowReplacement),
      fixed: uniqueStrings(asArray(configuration.fixed).map((value: string) => normalizeTraitEntry(traitType, value, context.refs))),
      options: uniqueStrings(asArray(configuration.options).map((value: string) => normalizeTraitEntry(traitType, value, context.refs))),
      categoryIds: uniqueStrings(asArray(configuration.categoryIds).map((value: string) => normalizeTraitCategory(traitType, value, context.refs)))
    };

    if (configuration.scalingColumnId) {
      const scalingSourceId = context.scalingSourceIdById[configuration.scalingColumnId] || trimString(configuration.scalingColumnId);
      if (scalingSourceId) normalized.configuration.scalingSourceId = scalingSourceId;
    }

    delete normalized.configuration.allowReplacement;
    delete normalized.configuration.scalingColumnId;
  } else if (type === 'ItemChoice' || type === 'ItemGrant') {
    normalized.configuration = {
      ...configuration,
      choiceType: trimString(configuration.choiceType || (type === 'ItemChoice' ? 'feature' : 'feature')),
      countSource: trimString(configuration.countSource || 'fixed'),
      count: Number(configuration.count || 0) || 0,
      pool: uniqueStrings(asArray(configuration.pool).map((value: string) => context.featureSourceIdById[value] || trimString(value))),
      optionalPool: uniqueStrings(asArray(configuration.optionalPool).map((value: string) => context.featureSourceIdById[value] || trimString(value))),
      excludedOptionIds: uniqueStrings(asArray(configuration.excludedOptionIds).map((value: string) => context.optionItemSourceIdById[value] || trimString(value))),
      optional: Boolean(configuration.optional)
    };

    if (configuration.optionGroupId) {
      const optionGroupSourceId = context.optionGroupSourceIdById[configuration.optionGroupId] || trimString(configuration.optionGroupId);
      if (optionGroupSourceId) normalized.configuration.optionGroupId = optionGroupSourceId;
    }

    if (configuration.scalingColumnId) {
      const scalingSourceId = context.scalingSourceIdById[configuration.scalingColumnId] || trimString(configuration.scalingColumnId);
      if (scalingSourceId) normalized.configuration.scalingColumnId = scalingSourceId;
    }

    if (Array.isArray(configuration.items)) {
      normalized.configuration.items = configuration.items.map((entry: any) => {
        const sourceId = trimString(entry?.sourceId)
          || context.featureSourceIdById[entry?.uuid]
          || trimString(entry?.uuid);
        return sourceId
          ? { sourceId, optional: Boolean(entry?.optional) }
          : null;
      }).filter(Boolean);
    }
  } else if (type === 'ScaleValue') {
    const linkedScale = context.scalingById[configuration.scalingColumnId];
    normalized.configuration = {
      ...configuration,
      identifier: trimString(configuration.identifier) || linkedScale?.identifier || slugify(normalized.title || 'scale'),
      values: linkedScale?.values || configuration.values || {}
    };
    if (linkedScale?.sourceId) {
      normalized.configuration.scalingColumnId = linkedScale.sourceId;
      normalized.sourceScaleId = linkedScale.sourceId;
    } else {
      delete normalized.configuration.scalingColumnId;
    }
    if (!trimString(normalized.title) && linkedScale?.name) normalized.title = linkedScale.name;
  } else {
    normalized.configuration = configuration;
  }

  delete normalized.isBase;
  return normalized;
}

function sortAdvancementsByLevelThenType(left: any, right: any) {
  if (left.level !== right.level) return left.level - right.level;
  return String(left.type || '').localeCompare(String(right.type || ''));
}

/**
 * Fetches all data for a single class and formats it for semantic export.
 */
export async function exportClassSemantic(classId: string) {
  const classDoc = await getDoc(doc(db, 'classes', classId));
  if (!classDoc.exists()) return null;
  const classDataRaw: any = { id: classDoc.id, ...classDoc.data() };
  const [
    skillsSnap,
    toolsSnap,
    toolCategoriesSnap,
    armorSnap,
    armorCategoriesSnap,
    weaponsSnap,
    weaponCategoriesSnap,
    languagesSnap,
    languageCategoriesSnap,
    attributesSnap,
    tagsSnap,
    spellcastingTypesSnap,
    pactMagicScalingsSnap,
    spellsKnownScalingsSnap
  ] = await Promise.all([
    getDocs(collection(db, 'skills')),
    getDocs(collection(db, 'tools')),
    getDocs(collection(db, 'toolCategories')),
    getDocs(collection(db, 'armor')),
    getDocs(collection(db, 'armorCategories')),
    getDocs(collection(db, 'weapons')),
    getDocs(collection(db, 'weaponCategories')),
    getDocs(collection(db, 'languages')),
    getDocs(collection(db, 'languageCategories')),
    getDocs(collection(db, 'attributes')),
    getDocs(collection(db, 'tags')),
    getDocs(collection(db, 'spellcastingTypes')),
    getDocs(collection(db, 'pactMagicScalings')),
    getDocs(collection(db, 'spellsKnownScalings'))
  ]);

  const refs = {
    skillsById: buildDocMap(skillsSnap),
    toolsById: buildDocMap(toolsSnap),
    toolCategoriesById: buildDocMap(toolCategoriesSnap),
    armorById: buildDocMap(armorSnap),
    armorCategoriesById: buildDocMap(armorCategoriesSnap),
    weaponsById: buildDocMap(weaponsSnap),
    weaponCategoriesById: buildDocMap(weaponCategoriesSnap),
    languagesById: buildDocMap(languagesSnap),
    languageCategoriesById: buildDocMap(languageCategoriesSnap),
    attributesById: buildDocMap(attributesSnap),
    tagsById: buildDocMap(tagsSnap),
    spellcastingTypesById: buildDocMap(spellcastingTypesSnap),
    pactMagicScalingsById: buildDocMap(pactMagicScalingsSnap),
    spellsKnownScalingsById: buildDocMap(spellsKnownScalingsSnap)
  };

  const sourceCache: { [id: string]: string } = {};
  const resolveBookId = async (sid: string | undefined) => {
    if (!sid) return undefined;
    if (sourceCache[sid]) return sourceCache[sid];
    if (sid.startsWith('source-')) return sid;

    const sourceSnap = await getDoc(doc(db, 'sources', sid));
    if (sourceSnap.exists()) {
      sourceCache[sid] = getSemanticSourceId(sourceSnap.data(), sid);
      return sourceCache[sid];
    }
    return sid;
  };

  const classIdentifier = classDataRaw.identifier || slugify(classDataRaw.name);
  const classSourceId = `class-${classIdentifier}`;
  const resolvedClassBookId = await resolveBookId(classDataRaw.sourceId) || '';
  const normalizedProficiencies = normalizeClassProficiencies(classDataRaw.proficiencies, refs);
  const normalizedMulticlassProficiencies = normalizeClassProficiencies(classDataRaw.multiclassProficiencies, refs);
  const normalizedSavingThrows = uniqueStrings(
    asArray(classDataRaw.savingThrows?.length ? classDataRaw.savingThrows : normalizedProficiencies.savingThrows.fixedIds)
      .map((id: string) => normalizeMappedId(id, refs.attributesById, { uppercase: true }))
  );
  const tagIds = uniqueStrings(asArray(classDataRaw.tagIds).map((id: string) => getSemanticToken(refs.tagsById[id]) || trimString(id)));

  const subclassesSnap = await getDocs(query(collection(db, 'subclasses'), where('classId', '==', classId)));
  const subclassesRaw = subclassesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const subclassIds = subclassesRaw.map((sub: any) => sub.id);
  const allParentIds = [classId, ...subclassIds];

  let featuresRaw: any[] = [];
  if (allParentIds.length > 0) {
    const featuresSnap = await getDocs(query(collection(db, 'features'), where('parentId', 'in', allParentIds)));
    featuresRaw = featuresSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  let scalingColumnsRaw: any[] = [];
  if (allParentIds.length > 0) {
    const scalingSnap = await getDocs(query(collection(db, 'scalingColumns'), where('parentId', 'in', allParentIds)));
    scalingColumnsRaw = scalingSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  const subclasses = await Promise.all(subclassesRaw.map(async (subclass: any) => {
    const identifier = subclass.identifier || slugify(subclass.name);
    const resolvedLocal = await resolveBookId(subclass.sourceId);
    const sourceBookId = (resolvedLocal && resolvedLocal.startsWith('source-')) ? resolvedLocal : resolvedClassBookId;
    return omitKeys({
      ...subclass,
      id: subclass.id,
      identifier,
      sourceId: `subclass-${identifier}`,
      sourceBookId,
      classSourceId,
      classIdentifier,
      description: cleanText(subclass.description),
      lore: cleanText(subclass.lore),
      tagIds: uniqueStrings(asArray(subclass.tagIds).map((id: string) => getSemanticToken(refs.tagsById[id]) || trimString(id))),
      spellcasting: normalizeSpellcastingForExport(subclass.spellcasting, refs, { preserveNativeProgression: true })
    }, ['classId', 'excludedOptionIds']);
  }));

  const idToSourceIdMap: Record<string, string> = { [classId]: classSourceId };
  const idToBookIdMap: Record<string, string> = { [classId]: resolvedClassBookId };
  subclasses.forEach((subclass) => {
    idToSourceIdMap[subclass.id] = subclass.sourceId;
    idToBookIdMap[subclass.id] = subclass.sourceBookId;
  });

  const scalingColumns = scalingColumnsRaw.map((column: any) => {
    const identifier = column.identifier || slugify(column.name);
    const parentSourceId = idToSourceIdMap[column.parentId] || column.parentId;
    const parentBookId = idToBookIdMap[column.parentId] || resolvedClassBookId;
    return omitKeys({
      ...column,
      id: column.id,
      identifier,
      sourceId: `scale-${identifier}`,
      sourceBookId: parentBookId,
      classSourceId,
      parentSourceId
    }, ['parentId']);
  });

  const scalingById = Object.fromEntries(scalingColumns.map((column) => [column.id, column]));
  const scalingSourceIdById = Object.fromEntries(scalingColumns.map((column) => [column.id, column.sourceId]));

  const referencedGroupIds = collectReferencedOptionGroupIds(classDataRaw, ...subclassesRaw, ...featuresRaw);
  const allGroupIds = uniqueStrings([
    ...referencedGroupIds,
    ...asArray(classDataRaw.uniqueOptionGroupIds),
    ...featuresRaw.flatMap((feature) => asArray(feature.uniqueOptionGroupIds))
  ]);

  let uniqueOptionGroups: any[] = [];
  if (allGroupIds.length > 0) {
    const groupsSnap = await getDocs(query(collection(db, 'uniqueOptionGroups'), where(documentId(), 'in', allGroupIds)));
    uniqueOptionGroups = groupsSnap.docs.map((d) => {
      const data: any = d.data();
      const identifier = data.identifier || slugify(data.name || '');
      const scalingSourceId = scalingSourceIdById[data.scalingColumnId] || trimString(data.scalingId);
      return omitKeys({
        ...data,
        id: d.id,
        identifier,
        sourceId: `class-option-group-${identifier}`,
        sourceBookId: resolvedClassBookId,
        featureSourceId: '',
        scalingSourceId: scalingSourceId || undefined,
        description: cleanText(data.description || '')
      }, ['featureId', 'scalingColumnId']);
    });
  }

  const optionGroupSourceIdById = Object.fromEntries(uniqueOptionGroups.map((group) => [group.id, group.sourceId]));

  const features = await Promise.all(featuresRaw.map(async (feature: any) => {
    const identifier = feature.identifier || slugify(feature.name);
    const parentPrefix = feature.parentType === 'subclass' ? 'subclass' : 'class';
    const resolvedLocal = await resolveBookId(feature.sourceId);
    const sourceBookId = (resolvedLocal && resolvedLocal.startsWith('source-'))
      ? resolvedLocal
      : (idToBookIdMap[feature.parentId] || resolvedClassBookId);

    return omitKeys({
      ...feature,
      imageUrl: resolveImageUrl(feature) || undefined,
      id: feature.id,
      identifier,
      sourceId: `${parentPrefix}-feature-${identifier}`,
      sourceBookId,
      parentSourceId: idToSourceIdMap[feature.parentId] || feature.parentId,
      classSourceId,
      featureKind: feature.featureKind || (feature.parentType === 'subclass' ? 'subclassFeature' : 'classFeature'),
      description: cleanText(feature.description),
      tagIds: uniqueStrings(asArray(feature.tagIds).map((id: string) => getSemanticToken(refs.tagsById[id]) || trimString(id))),
      uniqueOptionGroupIds: uniqueStrings(asArray(feature.uniqueOptionGroupIds).map((groupId: string) => optionGroupSourceIdById[groupId] || trimString(groupId))),
      quantityColumnSourceId: scalingSourceIdById[feature.quantityColumnId] || trimString(feature.quantityColumnId) || undefined,
      scalingSourceId: scalingSourceIdById[feature.scalingColumnId] || trimString(feature.scalingColumnId) || undefined,
      automation: {
        activities: Array.isArray(feature.automation?.activities)
          ? feature.automation.activities
          : Object.values(feature.automation?.activities || {}),
        effects: feature.automation?.effects || []
      }
    }, ['parentId', 'quantityColumnId', 'scalingColumnId']);
  }));

  const featuresById = Object.fromEntries(features.map((feature) => [feature.id, feature]));
  const featureSourceIdById = Object.fromEntries(features.map((feature) => [feature.id, feature.sourceId]));
  const optionGroupFeatureSourceById = buildOptionGroupFeatureSourceMap([classDataRaw, ...subclassesRaw], featuresById);
  const optionGroupAdvancementMetadataById = buildOptionGroupAdvancementMetadataMap(
    [classDataRaw, ...subclassesRaw],
    featuresById,
    scalingById,
    scalingSourceIdById
  );

  uniqueOptionGroups = uniqueOptionGroups.map((group) => {
    const advancementMetadata = optionGroupAdvancementMetadataById[group.id] || {
      featureSourceId: '',
      scalingSourceId: '',
      selectionCountsByLevel: {}
    };
    const associatedFeature = group.featureId ? featuresById[group.featureId] : null;
    const derivedFeatureSourceId = associatedFeature?.sourceId
      || optionGroupFeatureSourceById[group.id]
      || optionGroupFeatureSourceById[group.sourceId]
      || advancementMetadata.featureSourceId
      || '';
    return {
      ...group,
      sourceBookId: associatedFeature?.sourceBookId || group.sourceBookId || resolvedClassBookId,
      featureSourceId: derivedFeatureSourceId,
      scalingSourceId: trimString(group.scalingSourceId) || advancementMetadata.scalingSourceId || undefined,
      selectionCountsByLevel: Object.keys(group.selectionCountsByLevel || {}).length
        ? group.selectionCountsByLevel
        : advancementMetadata.selectionCountsByLevel
    };
  });

  let uniqueOptionItems: any[] = [];
  if (allGroupIds.length > 0) {
    const optionsSnap = await getDocs(query(collection(db, 'uniqueOptionItems'), where('groupId', 'in', allGroupIds)));
    uniqueOptionItems = optionsSnap.docs.map((d) => {
      const data: any = d.data();
      const group = uniqueOptionGroups.find((entry) => entry.id === data.groupId);
      const identifier = data.identifier || slugify(data.name || '');
      const linkedFeature = data.featureId ? featuresById[data.featureId] : null;
      return omitKeys({
        ...data,
        imageUrl: resolveImageUrl(data) || undefined,
        id: d.id,
        identifier,
        sourceId: `class-option-${identifier}`,
        sourceBookId: group?.sourceBookId || resolvedClassBookId,
        groupSourceId: group?.sourceId || trimString(data.groupId),
        featureSourceId: linkedFeature?.sourceId || group?.featureSourceId || '',
        description: cleanText(data.description),
        levelPrerequisite: Number(data.levelPrerequisite || 0) || 0
      }, ['groupId', 'featureId']);
    });
  }

  const optionItemSourceIdById = Object.fromEntries(uniqueOptionItems.map((item) => [item.id, item.sourceId]));

  const advancementContext = {
    refs,
    featuresById,
    featureSourceIdById,
    scalingById,
    scalingSourceIdById,
    optionGroupSourceIdById,
    optionItemSourceIdById
  };

  const normalizedFeatures = features.map((feature) => ({
    ...feature,
    advancements: asArray(feature.advancements).map((advancement: any) => normalizeAdvancementForExport(advancement, advancementContext)).filter(Boolean)
  }));

  const baseClassAdvancements = buildBaseClassAdvancementsForExport({
    classDataRaw,
    normalizedProficiencies,
    hitDie: Number(classDataRaw.hitDie || 0) || 8,
    subclassTitle: classDataRaw.subclassTitle || '',
    subclassFeatureLevels: asArray(classDataRaw.subclassFeatureLevels).map((level: any) => Number(level)).filter(Boolean),
    asiLevels: asArray(classDataRaw.asiLevels).map((level: any) => Number(level)).filter(Boolean),
    existingAdvancements: asArray(classDataRaw.advancements)
  }).map((advancement) => normalizeAdvancementForExport(advancement, advancementContext)).filter(Boolean);
  const inherentClassFeatureGrants = buildInherentFeatureGrantAdvancements(
    normalizedFeatures.filter((feature) => feature.parentSourceId === classSourceId),
    asArray(classDataRaw.advancements),
    'inherent-class-feature-grant'
  ).map((advancement) => normalizeAdvancementForExport(advancement, advancementContext)).filter(Boolean);

  const customClassAdvancements = asArray(classDataRaw.advancements)
    .filter((advancement: any) => {
      const id = trimString(advancement?._id);
      if (!id) return true;
      if (id === 'base-items') return false;
      if (id.startsWith('base-')) return false;
      if (id.startsWith('implicit-class-features-')) return false;
      return true;
    })
    .map((advancement: any) => normalizeAdvancementForExport(advancement, advancementContext))
    .filter(Boolean);

  const normalizedSubclasses = (subclasses as any[]).map((subclass: any) => {
    const subclassRaw: any = subclassesRaw.find((entry: any) => entry.id === subclass.id) || {};
    const inherentSubclassFeatureGrants = buildInherentFeatureGrantAdvancements(
      normalizedFeatures.filter((feature) => feature.parentSourceId === subclass.sourceId),
      asArray(subclassRaw.advancements),
      `inherent-subclass-feature-grant-${subclass.identifier || subclass.id}`
    ).map((advancement) => normalizeAdvancementForExport(advancement, advancementContext)).filter(Boolean);
    const customAdvancements = asArray(subclass.advancements)
      .map((advancement: any) => normalizeAdvancementForExport(advancement, advancementContext))
      .filter(Boolean);

    return {
      ...subclass,
      advancements: [...inherentSubclassFeatureGrants, ...customAdvancements].sort(sortAdvancementsByLevelThenType)
    };
  });

  const classSpellcasting = normalizeSpellcastingForExport(classDataRaw.spellcasting, refs, { preserveNativeProgression: false });
  const usedAlternativeProgressionIds = uniqueStrings([
    trimString(classDataRaw.spellcasting?.altProgressionId),
    ...subclassesRaw.map((subclass: any) => trimString(subclass.spellcasting?.altProgressionId))
  ]);
  const usedSpellsKnownIds = uniqueStrings([
    trimString(classDataRaw.spellcasting?.spellsKnownId),
    ...subclassesRaw.map((subclass: any) => trimString(subclass.spellcasting?.spellsKnownId))
  ]);

  const alternativeSpellcastingScalings: { [id: string]: any } = {};
  usedAlternativeProgressionIds.forEach((id) => {
    const scaling = refs.pactMagicScalingsById[id];
    if (!scaling) return;
    const sourceId = buildSemanticRecordSourceId('alternative-spellcasting-scaling', scaling, id);
    alternativeSpellcastingScalings[sourceId] = {
      id,
      sourceId,
      identifier: trimString(scaling.identifier) || slugify(trimString(scaling.name || id)),
      name: scaling.name || '',
      levels: scaling.levels || {},
      updatedAt: scaling.updatedAt || null,
      createdAt: scaling.createdAt || null
    };
  });

  const spellsKnownScalings: { [id: string]: any } = {};
  usedSpellsKnownIds.forEach((id) => {
    const scaling = refs.spellsKnownScalingsById[id];
    if (!scaling) return;
    const sourceId = buildSemanticRecordSourceId('spells-known-scaling', scaling, id);
    spellsKnownScalings[sourceId] = {
      id,
      sourceId,
      identifier: trimString(scaling.identifier) || slugify(trimString(scaling.name || id)),
      name: scaling.name || '',
      levels: scaling.levels || {},
      updatedAt: scaling.updatedAt || null,
      createdAt: scaling.createdAt || null
    };
  });

  let source = null;
  if (classDataRaw.sourceId) {
    const sourceSnap = await getDoc(doc(db, 'sources', classDataRaw.sourceId));
    if (sourceSnap.exists()) source = { id: sourceSnap.id, ...sourceSnap.data() };
  }

  const classData = {
    ...classDataRaw,
    id: classDataRaw.id,
    identifier: classIdentifier,
    sourceId: resolvedClassBookId,
    classSourceId,
    sourceBookId: resolvedClassBookId,
    savingThrows: normalizedSavingThrows,
    description: cleanText(classDataRaw.description),
    lore: cleanText(classDataRaw.lore),
    startingEquipment: cleanText(classDataRaw.startingEquipment),
    multiclassing: cleanText(classDataRaw.multiclassing),
    tagIds,
    proficiencies: normalizedProficiencies,
    multiclassProficiencies: normalizedMulticlassProficiencies,
    spellcasting: classSpellcasting,
    advancements: [...baseClassAdvancements, ...inherentClassFeatureGrants, ...customClassAdvancements].sort(sortAdvancementsByLevelThenType)
  };

  delete classData.uniqueOptionGroupIds;
  delete classData.excludedOptionIds;
  delete classData.subclassTitle;
  delete classData.asiLevels;
  delete classData.spellcastingId;

  return {
    class: omitKeys(classData, ['excludedOptionIds', 'uniqueOptionGroupIds', 'subclassTitle', 'asiLevels', 'spellcastingId']),
    subclasses: normalizedSubclasses,
    features: normalizedFeatures,
    scalingColumns,
    uniqueOptionGroups,
    uniqueOptionItems,
    spellsKnownScalings,
    alternativeSpellcastingScalings,
    source
  };
}

/**
 * Generates a semantic ID for a source suitable for stable linking in external systems.
 * e.g. source-phb-2014 or source-xanathars-guide
 */
export function getSemanticSourceId(sourceData: any, originalId: string) {
  const slug = sourceData.slug;
  const abbr = sourceData.abbreviation?.toLowerCase();
  const rules = sourceData.rules || "2014";
  
  if (abbr) return `source-${abbr.replace(/[^a-z0-9]/g, '')}-${rules}`;
  if (slug) return `source-${slug}`;
  return originalId;
}

/**
 * Generates the source export bundle for a specific source.
 */
export async function exportSourceForFoundry(sourceId: string, includePayloads: boolean = true) {
  const sourceDoc = await getDoc(doc(db, 'sources', sourceId));
  if (!sourceDoc.exists()) throw new Error("Source not found");
  const sourceData: any = sourceDoc.data();
  const slug = sourceData.slug || sourceId;
  const semanticId = getSemanticSourceId(sourceData, sourceId);

  // Helper to ensure ISO date strings in JSON
  const toISO = (val: any) => {
    if (!val) return null;
    if (typeof val.toDate === 'function') return val.toDate().toISOString();
    if (val instanceof Date) return val.toISOString();
    return val;
  };

  // 1. Source Detail (source.json)
  const sourceDetail = {
    kind: "dauligor.source.v1",
    schemaVersion: 1,
    sourceId: semanticId,
    slug: slug,
    name: sourceData.name,
    shortName: sourceData.abbreviation || sourceData.name,
    description: sourceData.description,
    coverImage: sourceData.imageUrl || "",
    status: sourceData.status || "ready",
    rules: sourceData.rules || "2014",
    tags: sourceData.tags || [],
    dates: {
      addedAt: toISO(sourceData.createdAt),
      updatedAt: toISO(sourceData.updatedAt)
    },
    linkedContent: {
      classes: { count: 0, catalogUrl: "classes/catalog.json" },
      spells: { count: 0, catalogUrl: null },
      items: { count: 0, catalogUrl: null },
      bestiary: { count: 0, catalogUrl: null },
      journals: { count: 0, catalogUrl: null }
    }
  };

  // 2. Fetch Classes (using Firestore ID for DB query)
  const classesSnap = await getDocs(query(collection(db, 'classes'), where('sourceId', '==', sourceId)));
  const classes = classesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  sourceDetail.linkedContent.classes.count = classes.length;

  // 3. Class Catalog (classes/catalog.json)
  const classCatalog = {
    kind: "dauligor.class-catalog.v1",
    schemaVersion: 1,
    source: {
      system: "dauligor",
      entity: "class-catalog",
      id: `${semanticId}-classes`,
      sourceId: semanticId
    },
    entries: classes.map((cls: any) => ({
      sourceId: `class-${(cls as any).identifier || slugify(cls.name)}`,
      name: cls.name,
      type: "class",
      img: cls.imageUrl || "icons/svg/item-bag.svg",
      rules: sourceData.rules || "2014",
      description: cleanText(cls.description).substring(0, 200),
      payloadKind: "dauligor.semantic.class-export",
      payloadUrl: `${(cls as any).identifier || cls.id}.json`
    }))
  };

  // 4. Source Library Index (catalog.json)
  const sourceCatalog = {
    kind: "dauligor.source-catalog.v1",
    schemaVersion: 1,
    source: {
      system: "dauligor",
      entity: "source-catalog",
      id: "exported-source-library"
    },
    entries: [
      {
        sourceId: semanticId,
        slug: slug,
        name: sourceData.name,
        shortName: sourceData.abbreviation || sourceData.name,
        description: sourceData.description?.substring(0, 200) || "",
        status: sourceData.status || "ready",
        rules: sourceData.rules || "2014",
        tags: sourceData.tags || [],
        supportedImportTypes: ["classes-subclasses"],
        counts: {
          classes: classes.length,
          spells: 0,
          items: 0,
          bestiary: 0,
          journals: 0
        },
        detailUrl: `${slug}/source.json`,
        classCatalogUrl: `${slug}/classes/catalog.json`
      }
    ]
  };

  // 5. Build ZIP
  const zip = new JSZip();
  // We use the slug as the root folder in the zip
  const sourceFolder = zip.folder(slug);
  if (!sourceFolder) throw new Error("Could not create source folder");

  sourceFolder.file("source.json", JSON.stringify(sourceDetail, null, 2));
  
  // Create family folders as per contract, even if empty
  const classFolder = sourceFolder.folder("classes");
  const spellsFolder = sourceFolder.folder("spells");
  const itemsFolder = sourceFolder.folder("items");
  const bestiaryFolder = sourceFolder.folder("bestiary");
  const journalsFolder = sourceFolder.folder("journals");

  if (classes.length > 0 && classFolder) {
    classFolder.file("catalog.json", JSON.stringify(classCatalog, null, 2));
    
    // Always include payloads in this standard export
    for (const cls of classes) {
      const fullExport = await exportClassSemantic(cls.id);
      if (fullExport) {
        classFolder.file(`${(cls as any).identifier || cls.id}.json`, JSON.stringify(fullExport, null, 2));
      }
    }
  } else if (classFolder) {
    // Ensure catalog exists even if empty for the wizard
    classFolder.file("catalog.json", JSON.stringify({ ...classCatalog, entries: [] }, null, 2));
  }
  
  // Ensure other family catalogs exist (empty)
  if (spellsFolder) spellsFolder.file("catalog.json", JSON.stringify({ kind: "dauligor.spell-catalog.v1", schemaVersion: 1, entries: [] }, null, 2));
  if (itemsFolder) itemsFolder.file("catalog.json", JSON.stringify({ kind: "dauligor.item-catalog.v1", schemaVersion: 1, entries: [] }, null, 2));
  if (bestiaryFolder) bestiaryFolder.file("catalog.json", JSON.stringify({ kind: "dauligor.bestiary-catalog.v1", schemaVersion: 1, entries: [] }, null, 2));
  if (journalsFolder) journalsFolder.file("catalog.json", JSON.stringify({ kind: "dauligor.journal-catalog.v1", schemaVersion: 1, entries: [] }, null, 2));

  const content = await zip.generateAsync({ type: "blob" });
  saveAs(content, `dauligor-source-${slug}.zip`);
}

/**
 * Generates a full library export containing all ready sources.
 */
export async function exportFullSourceLibrary(includePayloads: boolean = true) {
  const sourcesSnap = await getDocs(query(collection(db, 'sources'), where('status', '==', 'ready')));
  const sources = sourcesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  // 5. Build ZIP
  const zip = new JSZip();
  
  const sourceEntries: any[] = [];
  const toISO = (val: any) => {
    if (!val) return null;
    if (typeof val.toDate === 'function') return val.toDate().toISOString();
    if (val instanceof Date) return val.toISOString();
    return val;
  };

  for (const sourceDocData of sources) {
    const sourceData: any = sourceDocData;
    const sourceId = sourceData.id;
    const slug = sourceData.slug || sourceId;
    const semanticId = getSemanticSourceId(sourceData, sourceId);

    // Fetch Classes for this source (using Firestore ID for DB query)
    const classesSnap = await getDocs(query(collection(db, 'classes'), where('sourceId', '==', sourceId)));
    const classes = classesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Source Detail
    const sourceDetail = {
      kind: "dauligor.source.v1",
      schemaVersion: 1,
      sourceId: semanticId,
      slug: slug,
      name: sourceData.name,
      shortName: sourceData.abbreviation || sourceData.name,
      description: sourceData.description,
      coverImage: sourceData.imageUrl || "",
      status: sourceData.status || "ready",
      rules: sourceData.rules || "2014",
      tags: sourceData.tags || [],
      dates: {
        addedAt: toISO(sourceData.createdAt),
        updatedAt: toISO(sourceData.updatedAt)
      },
      linkedContent: {
        classes: { count: classes.length, catalogUrl: "classes/catalog.json" },
        spells: { count: 0, catalogUrl: "spells/catalog.json" },
        items: { count: 0, catalogUrl: "items/catalog.json" },
        bestiary: { count: 0, catalogUrl: "bestiary/catalog.json" },
        journals: { count: 0, catalogUrl: "journals/catalog.json" }
      }
    };

    // Class Catalog
    const classCatalog = {
      kind: "dauligor.class-catalog.v1",
      schemaVersion: 1,
      source: {
        system: "dauligor",
        entity: "class-catalog",
        id: `${semanticId}-classes`,
        sourceId: semanticId
      },
      entries: classes.map((cls: any) => ({
        sourceId: `class-${(cls as any).identifier || slugify(cls.name)}`,
        name: cls.name,
        type: "class",
        img: cls.imageUrl || "icons/svg/item-bag.svg",
        rules: sourceData.rules || "2014",
        description: cleanText(cls.description).substring(0, 200),
        payloadKind: "dauligor.semantic.class-export",
        payloadUrl: `${(cls as any).identifier || cls.id}.json`
      }))
    };

    // Add to library catalog entries
    sourceEntries.push({
      sourceId: semanticId,
      slug: slug,
      name: sourceData.name,
      shortName: sourceData.abbreviation || sourceData.name,
      description: sourceData.description?.substring(0, 200) || "",
      status: sourceData.status || "ready",
      rules: sourceData.rules || "2014",
      tags: sourceData.tags || [],
      supportedImportTypes: ["classes-subclasses"],
      counts: {
        classes: classes.length,
        spells: 0,
        items: 0,
        bestiary: 0,
        journals: 0
      },
      detailUrl: `${slug}/source.json`,
      classCatalogUrl: `${slug}/classes/catalog.json`
    });

    // Add files to zip
    const sourceFolder = zip.folder(slug);
    if (sourceFolder) {
      sourceFolder.file("source.json", JSON.stringify(sourceDetail, null, 2));
      
      const classFolder = sourceFolder.folder("classes");
      const spellsFolder = sourceFolder.folder("spells");
      const itemsFolder = sourceFolder.folder("items");
      const bestiaryFolder = sourceFolder.folder("bestiary");
      const journalsFolder = sourceFolder.folder("journals");

      if (classFolder) {
        classFolder.file("catalog.json", JSON.stringify(classCatalog, null, 2));
        for (const cls of classes) {
          const fullExport = await exportClassSemantic(cls.id);
          if (fullExport) {
            classFolder.file(`${(cls as any).identifier || cls.id}.json`, JSON.stringify(fullExport, null, 2));
          }
        }
      }

      // Empty families
      if (spellsFolder) spellsFolder.file("catalog.json", JSON.stringify({ kind: "dauligor.spell-catalog.v1", schemaVersion: 1, entries: [] }, null, 2));
      if (itemsFolder) itemsFolder.file("catalog.json", JSON.stringify({ kind: "dauligor.item-catalog.v1", schemaVersion: 1, entries: [] }, null, 2));
      if (bestiaryFolder) bestiaryFolder.file("catalog.json", JSON.stringify({ kind: "dauligor.bestiary-catalog.v1", schemaVersion: 1, entries: [] }, null, 2));
      if (journalsFolder) journalsFolder.file("catalog.json", JSON.stringify({ kind: "dauligor.journal-catalog.v1", schemaVersion: 1, entries: [] }, null, 2));
    }
  }

  // Final Library Catalog
  const sourceCatalog = {
    kind: "dauligor.source-catalog.v1",
    schemaVersion: 1,
    source: {
      system: "dauligor",
      entity: "source-catalog",
      id: "full-exported-source-library"
    },
    entries: sourceEntries
  };

  zip.file("catalog.json", JSON.stringify(sourceCatalog, null, 2));

  const content = await zip.generateAsync({ type: "blob" });
  saveAs(content, "dauligor-full-library.zip");
}

/**
 * Specifically exports the master library catalog.json as a raw file for manual verification.
 */
export async function exportRawLibraryCatalogJSON() {
  const sourcesSnap = await getDocs(query(collection(db, 'sources'), where('status', '==', 'ready')));
  const sources = sourcesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  const entries: any[] = [];
  for (const source of sources) {
    const s: any = source;
    // Fetch count for display in catalog
    const classesSnap = await getDocs(query(collection(db, 'classes'), where('sourceId', '==', s.id)));
    const semanticId = getSemanticSourceId(s, s.id);
    
    entries.push({
      sourceId: semanticId,
      slug: s.slug || s.id,
      name: s.name,
      shortName: s.abbreviation || s.name,
      description: s.description?.substring(0, 200) || "",
      status: s.status || "ready",
      rules: s.rules || "2014",
      tags: s.tags || [],
      supportedImportTypes: ["classes-subclasses"],
      counts: {
        classes: classesSnap.size,
        spells: 0,
        items: 0,
        bestiary: 0,
        journals: 0
      },
      detailUrl: `${s.slug || s.id}/source.json`,
      classCatalogUrl: `${s.slug || s.id}/classes/catalog.json`
    });
  }

  const catalog = {
    kind: "dauligor.source-catalog.v1",
    schemaVersion: 1,
    source: {
      system: "dauligor",
      entity: "source-catalog",
      id: "manual-export-catalog"
    },
    entries
  };

  const blob = new Blob([JSON.stringify(catalog, null, 2)], { type: "application/json" });
  saveAs(blob, "catalog.json");
}

/**
 * Specifically exports a single source.json as a raw file for manual verification.
 */
export async function exportRawSourceJSON(sourceId: string) {
  const sourceDoc = await getDoc(doc(db, 'sources', sourceId));
  if (!sourceDoc.exists()) throw new Error("Source not found");
  const sourceData: any = sourceDoc.data();
  const slug = sourceData.slug || sourceId;
  const semanticId = getSemanticSourceId(sourceData, sourceId);

  // Fetch Classes for count
  const classesSnap = await getDocs(query(collection(db, 'classes'), where('sourceId', '==', sourceId)));

  const toISO = (val: any) => {
    if (!val) return null;
    if (typeof val.toDate === 'function') return val.toDate().toISOString();
    if (val instanceof Date) return val.toISOString();
    return val;
  };

  const sourceDetail = {
    kind: "dauligor.source.v1",
    schemaVersion: 1,
    sourceId: semanticId,
    slug: slug,
    name: sourceData.name,
    shortName: sourceData.abbreviation || sourceData.name,
    description: sourceData.description,
    coverImage: sourceData.imageUrl || "",
    status: sourceData.status || "ready",
    rules: sourceData.rules || "2014",
    tags: sourceData.tags || [],
    dates: {
      addedAt: toISO(sourceData.createdAt),
      updatedAt: toISO(sourceData.updatedAt)
    },
    linkedContent: {
      classes: { count: classesSnap.size, catalogUrl: "classes/catalog.json" },
      spells: { count: 0, catalogUrl: null },
      items: { count: 0, catalogUrl: null },
      bestiary: { count: 0, catalogUrl: null },
      journals: { count: 0, catalogUrl: null }
    }
  };

  const blob = new Blob([JSON.stringify(sourceDetail, null, 2)], { type: "application/json" });
  saveAs(blob, `${slug}.json`);
}

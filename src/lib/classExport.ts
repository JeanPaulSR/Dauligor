// Side-effect-free imports only at the top level — keeps this module
// importable from server contexts (Vercel functions) without dragging in
// `firebase`, `jszip`, `file-saver`, or `./d1`. Client-only deps are loaded
// via dynamic `import()` inside the function that needs them; the semantic
// export takes its fetchers as a required parameter so it never references
// `./d1` at all.
import { normalizeSpellFormulaShortcuts } from './referenceSyntax';
import {
  buildCanonicalClassProgression,
  buildCanonicalSubclassProgression
} from './classProgression';

/**
 * Pluggable fetchers so this module can run from server contexts that don't
 * have access to the client-side `fetchCollection`/`fetchDocument` (which
 * authenticate via Firebase JWT through `/api/d1/query`).
 *
 * Required — callers must supply fetchers explicitly. The Vercel API
 * endpoint that exposes class detail to the Foundry module passes server
 * fetchers backed by `executeD1QueryInternal`; client call sites pass the
 * helpers from `./d1`. Keeping this required means classExport.ts never
 * imports `./d1` at runtime, which is the only way the Vercel bundler
 * reliably leaves firebase/JSON config out of the api/module function.
 */
export interface ExportFetchers {
  fetchCollection: <T = any>(
    collectionName: string,
    options?: { select?: string; where?: string; params?: any[]; orderBy?: string },
  ) => Promise<T[]>;
  fetchDocument: <T = any>(collectionName: string, id: string) => Promise<T | null>;
}

// ── D1 row → camelCase shape helpers ────────────────────────────────────────
// The Foundry export contract is camelCase only. D1 stores snake_case. These
// helpers map the snake_case columns to their camelCase aliases AND strip
// every remaining snake_case key, so the export JSON does not leak D1 column
// names like `image_url` / `created_at` / `parent_id`.

// Strip every shallow key whose name contains an underscore (D1 snake_case).
// Run after camelCase aliases are in place so nothing is lost.
function dropSnakeKeys<T extends Record<string, any>>(obj: T): T {
  if (!obj || typeof obj !== 'object') return obj;
  const out: any = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!k.includes('_')) out[k] = v;
  }
  return out;
}

function parseJsonField(val: any, fallback: any) {
  if (typeof val === 'string') {
    try { return JSON.parse(val); } catch { return fallback; }
  }
  return val ?? fallback;
}

function denormalizeSource(row: any) {
  if (!row) return row;
  const out: any = dropSnakeKeys({
    ...row,
    imageUrl: row.image_url ?? '',
    rules: row.rules_version ?? '',
    url: row.external_url ?? '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
  // `payload` is a D1-only catch-all column; not part of the export contract.
  delete out.payload;
  return out;
}

export function denormalizeClassRow(row: any) {
  if (!row) return row;
  return dropSnakeKeys({
    ...row,
    sourceId: row.source_id,
    hitDie: row.hit_die,
    tagIds: parseJsonField(row.tag_ids, []),
    proficiencies: parseJsonField(row.proficiencies, {}),
    multiclassProficiencies: parseJsonField(row.multiclass_proficiencies, {}),
    savingThrows: parseJsonField(row.saving_throws, []),
    spellcasting: parseJsonField(row.spellcasting, {}),
    advancements: parseJsonField(row.advancements, []),
    subclassTitle: row.subclass_title,
    subclassFeatureLevels: parseJsonField(row.subclass_feature_levels, []),
    asiLevels: parseJsonField(row.asi_levels, []),
    primaryAbility: parseJsonField(row.primary_ability, []),
    primaryAbilityChoice: parseJsonField(row.primary_ability_choice, []),
    excludedOptionIds: parseJsonField(row.excluded_option_ids, {}),
    uniqueOptionMappings: parseJsonField(row.unique_option_mappings, []),
    startingEquipment: row.starting_equipment,
    imageUrl: row.image_url,
    cardImageUrl: row.card_image_url,
    previewImageUrl: row.preview_image_url,
    imageDisplay: parseJsonField(row.image_display, undefined),
    cardDisplay: parseJsonField(row.card_display, undefined),
    previewDisplay: parseJsonField(row.preview_display, undefined),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export function denormalizeSubclassRow(row: any) {
  if (!row) return row;
  return dropSnakeKeys({
    ...row,
    classId: row.class_id,
    classIdentifier: row.class_identifier,
    sourceId: row.source_id,
    tagIds: parseJsonField(row.tag_ids, []),
    advancements: parseJsonField(row.advancements, []),
    spellcasting: parseJsonField(row.spellcasting, {}),
    excludedOptionIds: parseJsonField(row.excluded_option_ids, {}),
    uniqueOptionGroupIds: parseJsonField(row.unique_option_group_ids, []),
    imageUrl: row.image_url,
    cardImageUrl: row.card_image_url,
    previewImageUrl: row.preview_image_url,
    // Display shapes flow through unchanged — no default. A `null` D1 value
    // becomes undefined here, which JSON.stringify drops on output. The
    // canonical contract only includes a display when the source had one.
    imageDisplay: parseJsonField(row.image_display, undefined) ?? undefined,
    cardDisplay: parseJsonField(row.card_display, undefined) ?? undefined,
    previewDisplay: parseJsonField(row.preview_display, undefined) ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function denormalizeFeatureRow(row: any) {
  if (!row) return row;
  const out: any = dropSnakeKeys({
    ...row,
    parentId: row.parent_id,
    parentType: row.parent_type,
    featureType: row.feature_type,
    sourceId: row.source_id,
    isSubclassFeature: row.parent_type === 'subclass' || row.is_subclass_feature === 1,
    imageUrl: row.image_url,
    iconUrl: row.icon_url,
    quantityColumnId: row.quantity_column_id,
    scalingColumnId: row.scaling_column_id,
    usesMax: row.uses_max,
    usesSpent: row.uses_spent,
    usesRecovery: parseJsonField(row.uses_recovery, []),
    prerequisitesLevel: row.prerequisites_level,
    prerequisitesItems: parseJsonField(row.prerequisites_items, []),
    advancements: parseJsonField(row.advancements, []),
    activities: parseJsonField(row.activities, []),
    effects: parseJsonField(row.effects, []),
    properties: parseJsonField(row.properties, []),
    tagIds: parseJsonField(row.tags, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
  // `tags` is the D1 JSON column whose canonical alias is `tagIds`; drop the raw form.
  delete out.tags;
  return out;
}

function denormalizeScalingColumnRow(row: any) {
  if (!row) return row;
  return dropSnakeKeys({
    ...row,
    parentId: row.parent_id,
    parentType: row.parent_type,
    sourceId: row.source_id,
    type: row.type || 'number',
    distanceUnits: row.distance_units || null,
    values: parseJsonField(row.values, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function denormalizeOptionGroupRow(row: any) {
  if (!row) return row;
  return dropSnakeKeys({
    ...row,
    sourceId: row.source_id,
    classIds: parseJsonField(row.class_ids, []),
    scalingColumnId: row.scaling_column_id,
    scalingId: row.scaling_id,
    featureId: row.feature_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function denormalizeOptionItemRow(row: any) {
  if (!row) return row;
  return dropSnakeKeys({
    ...row,
    groupId: row.group_id,
    sourceId: row.source_id,
    classIds: parseJsonField(row.class_ids, []),
    iconUrl: row.icon_url,
    levelPrerequisite: row.level_prerequisite,
    stringPrerequisite: row.string_prerequisite,
    requiresOptionIds: parseJsonField(row.requires_option_ids, []),
    isRepeatable: row.is_repeatable,
    featureId: row.feature_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

// Generic camelCase → snake_case shallow key converter for the import path.
// Composite/nested values pass through; D1's upsertDocument JSON.stringifies
// objects on the way to SQLite.
function toSnakeKeys(obj: any): any {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const out: any = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'id') continue; // id is passed separately to upsertDocument
    if (k === 'createdAt' || k === 'updatedAt') continue; // let D1 default-stamp
    const snake = k.replace(/[A-Z]/g, c => '_' + c.toLowerCase());
    out[snake] = v;
  }
  return out;
}

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
 * Imports a class semantic export bundle into D1. Client-only — pulls in
 * `./d1` for the upsert helpers via dynamic import so this module stays
 * loadable from the server.
 */
export async function importClassSemantic(data: any) {
  if (!data.class || !data.class.id) {
    throw new Error("Invalid class export data: missing class information");
  }

  const { fetchDocument, upsertDocument, upsertDocumentBatch } = await import('./d1');

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

  // 1. Handle Source — only insert if it doesn't already exist
  if (source && source.id) {
    const existing = await fetchDocument<any>('sources', source.id);
    if (!existing) {
      await upsertDocument('sources', source.id, toSnakeKeys(source));
    }
  }

  // 2. Handle Spellcasting Scalings (all three legacy collections fold into
  // the spellcasting_progressions table — D1_TABLE_MAP routes them; the row
  // must carry an explicit `type` so reads can filter by kind.)
  for (const id in spellcastingScalings) {
    await upsertDocument('spellcastingScalings', id, {
      ...toSnakeKeys(spellcastingScalings[id]),
      type: 'standard',
    });
  }
  for (const id in spellsKnownScalings) {
    await upsertDocument('spellsKnownScalings', id, {
      ...toSnakeKeys(spellsKnownScalings[id]),
      type: 'known',
    });
  }
  for (const id in alternativeSpellcastingScalings) {
    await upsertDocument('pactMagicScalings', id, {
      ...toSnakeKeys(alternativeSpellcastingScalings[id]),
      type: 'pact',
    });
  }

  // 3. Handle Unique Option Groups
  for (const group of uniqueOptionGroups) {
    await upsertDocument('uniqueOptionGroups', group.id, toSnakeKeys(group));
  }

  // 4-7. Batch the bulk child collections — fewer round-trips, same result.
  if (uniqueOptionItems.length > 0) {
    await upsertDocumentBatch('uniqueOptionItems',
      uniqueOptionItems.map((item: any) => ({ id: item.id, data: toSnakeKeys(item) })));
  }
  if (scalingColumns.length > 0) {
    await upsertDocumentBatch('scalingColumns',
      scalingColumns.map((col: any) => ({ id: col.id, data: toSnakeKeys(col) })));
  }
  if (subclasses.length > 0) {
    await upsertDocumentBatch('subclasses',
      subclasses.map((sub: any) => ({ id: sub.id, data: toSnakeKeys(sub) })));
  }
  if (features.length > 0) {
    await upsertDocumentBatch('features',
      features.map((feat: any) => ({ id: feat.id, data: toSnakeKeys(feat) })));
  }

  // 8. Handle the Class itself
  await upsertDocument('classes', classData.id, toSnakeKeys(classData));

  return classData.id;
}

/**
 * Helper to slugify strings.
 */
export function slugify(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9-]/g, '-');
}

/**
 * Parse a per-level dice expression (`"1d6"`, `"d8"`, `"2d6+3"`, `"3d4-1"`)
 * into the shape dnd5e's ScaleValueTypeDice schema expects:
 *   `{ number: number|null, faces: number, modifiers: string[] }`
 *
 * Returns null if the input doesn't parse — caller should skip the level.
 * Mirror of `parseDiceScaleEntry` in api/_lib/_classExport.ts (drift pair).
 */
function parseDiceScaleEntry(raw: string): { number: number | null; faces: number; modifiers: string[] } | null {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const match = text.match(/^(\d*)d(\d+)\s*([+-].+)?$/i);
  if (!match) return null;
  const numberStr = match[1];
  const faces = Number(match[2]);
  if (!Number.isFinite(faces) || faces <= 0) return null;
  const modifiers: string[] = [];
  if (match[3]) {
    const mod = match[3].replace(/\s+/g, '');
    if (mod) modifiers.push(mod);
  }
  return {
    number: numberStr === '' ? null : Number(numberStr),
    faces,
    modifiers
  };
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
  preserveNativeProgression = false,
  classIdentifierForLevelRef = ''
}: { preserveNativeProgression?: boolean; classIdentifierForLevelRef?: string } = {}) {
  if (!spellcasting || typeof spellcasting !== 'object') return null;

  const normalizedAbility = trimString(spellcasting.ability).toUpperCase() || '';
  const normalized: any = {
    ...spellcasting,
    description: cleanText(spellcasting.description || ''),
    hasSpellcasting: Boolean(spellcasting.hasSpellcasting),
    level: Number(spellcasting.level || 1) || 1,
    ability: normalizedAbility,
    type: trimString(spellcasting.type).toLowerCase() || 'prepared',
    spellsKnownFormula: normalizeSpellFormulaShortcuts(
      trimString(spellcasting.spellsKnownFormula),
      {
        classIdentifier: classIdentifierForLevelRef,
        spellcastingAbility: normalizedAbility,
      },
    )
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
    }),
    armorDisplayName: trimString(raw.armorDisplayName),
    weaponsDisplayName: trimString(raw.weaponsDisplayName),
    toolsDisplayName: trimString(raw.toolsDisplayName)
  };
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
  scalingSourceIdById: Record<string, string> = {},
  // Map of `record === subclassRow` → that subclass's sourceId. Used to
  // attribute groups referenced from a subclass-root advancement to the
  // owning subclass so the runtime can filter them per-subclass. Class
  // root references are unattributed and appear for every subclass.
  subclassSourceIdByRecord: Map<any, string> = new Map()
) {
  const metadataByOptionGroup: Record<string, {
    featureSourceId: string;
    subclassSourceId: string;
    scalingSourceId: string;
    selectionCountsByLevel: Record<string, number>;
  }> = {};

  records.forEach((record) => {
    const ownerSubclassSourceId = subclassSourceIdByRecord.get(record) || '';
    asArray(record?.advancements).forEach((advancement) => {
      if (trimString(advancement?.type) !== 'ItemChoice') return;

      const configuration = advancement?.configuration || {};
      const optionGroupId = trimString(configuration?.optionGroupId);
      if (!optionGroupId) return;

      const entry = metadataByOptionGroup[optionGroupId] ||= {
        featureSourceId: '',
        subclassSourceId: '',
        scalingSourceId: '',
        selectionCountsByLevel: {}
      };

      const featureSourceId = trimString(advancement?.featureSourceId)
        || featuresById[trimString(advancement?.featureId)]?.sourceId
        || '';
      if (featureSourceId && !entry.featureSourceId) {
        entry.featureSourceId = featureSourceId;
      }
      if (ownerSubclassSourceId && !entry.subclassSourceId) {
        entry.subclassSourceId = ownerSubclassSourceId;
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
      // `static` (default) — pool is the authored options[] below.
      // `proficient` — pool is derived at runtime by the module from the
      // actor's current proficiencies of `type`. With `choiceCount: 0`
      // the runtime auto-applies to every match without prompting
      // (e.g. "All tools you are proficient in gain expertise").
      poolSource: trimString(configuration.poolSource || 'static') || 'static',
      choiceCount: Number(configuration.choiceCount || 0) || 0,
      choiceSource: trimString(configuration.choiceSource || ''),
      allowReplacements: Boolean(configuration.allowReplacements),
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

    // Translate the editor-side `usesFeatureId` (D1 PK) to the per-feature
    // `usesFeatureSourceId` the module looks up at embed time. The module
    // post-processes each granted option item's activities to consume from
    // the matching actor item (Battle Master maneuvers → Superiority Dice
    // pool, etc.) and inherit its damage scaling.
    if (configuration.usesFeatureId) {
      const usesFeatureSourceId = context.featureSourceIdById[configuration.usesFeatureId] || trimString(configuration.usesFeatureId);
      if (usesFeatureSourceId) normalized.configuration.usesFeatureSourceId = usesFeatureSourceId;
    }
    delete normalized.configuration.usesFeatureId;

    // Per-grant Damage Scaling Column. Translates editor-side D1 PK to
    // the per-column sourceId so the module can resolve the @scale
    // formula at embed time. Independent of the existing scalingColumnId
    // field (which drives count-source for ItemChoice). When set, this
    // wins over Uses-Feature-inherited scaling and over the linked
    // feature's own scaling — letting the same shared option group
    // resolve `@scale.linked` differently per granter.
    if (configuration.optionScalingColumnId) {
      const optionScalingSourceId = context.scalingSourceIdById[configuration.optionScalingColumnId] || trimString(configuration.optionScalingColumnId);
      if (optionScalingSourceId) normalized.configuration.optionScalingSourceId = optionScalingSourceId;
    }
    delete normalized.configuration.optionScalingColumnId;

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
  } else if (type === 'Size') {
    const selectedSizeIds = uniqueStrings([
      ...Object.entries(configuration?.sizes || {})
        .filter(([, isSelected]) => Boolean(isSelected))
        .map(([sizeId]) => trimString(sizeId)),
      trimString(configuration?.size)
    ]);

    normalized.configuration = {
      ...configuration,
      sizes: Object.fromEntries(selectedSizeIds.map((sizeId) => [sizeId, true]))
    };

    if (selectedSizeIds[0]) normalized.configuration.size = selectedSizeIds[0];
    else delete normalized.configuration.size;
  } else if (type === 'ScaleValue') {
    const linkedScale = context.scalingById[configuration.scalingColumnId];
    // dnd5e's ScaleValueAdvancement schema:
    //   - per-level map is `scale` (not `values`)
    //   - `type` is one of "string" | "number" | "cr" | "dice" | "distance"
    //   - dice type expects `{ number, faces, modifiers }` per level;
    //     all other types expect `{ value }`
    //   - `distance.units` schema field is unconditional, set "" when unused
    // Authoring stores `type` on the scaling column; dispatch per-level
    // shape here so `@scale.<class>.<id>` resolves correctly.
    const scaleType = trimString(linkedScale?.type) || trimString(configuration.type) || 'number';
    const rawScale = linkedScale?.values || configuration.scale || configuration.values || {};
    const scaleMap: Record<string, any> = {};
    for (const [level, raw] of Object.entries(rawScale)) {
      if (raw == null) continue;
      if (typeof raw === 'object' && !Array.isArray(raw)) {
        scaleMap[level] = raw;
        continue;
      }
      const trimmed = String(raw).trim();
      if (!trimmed) continue;

      if (scaleType === 'dice') {
        const parsed = parseDiceScaleEntry(trimmed);
        if (parsed) scaleMap[level] = parsed;
      } else {
        scaleMap[level] = { value: trimmed };
      }
    }

    normalized.configuration = {
      ...configuration,
      type: scaleType,
      identifier: trimString(configuration.identifier) || trimString(linkedScale?.identifier) || slugify(normalized.title || 'scale'),
      scale: scaleMap
    };
    delete (normalized.configuration as any).values;

    const distanceUnits = trimString(linkedScale?.distanceUnits) || trimString((configuration as any)?.distance?.units) || '';
    normalized.configuration.distance = { units: scaleType === 'distance' ? (distanceUnits || 'ft') : '' };

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
export async function exportClassSemantic(
  classId: string,
  fetchers: ExportFetchers,
) {
  const { fetchCollection, fetchDocument } = fetchers;
  const classInfo = await fetchDocument<any>('classes', classId);
  if (!classInfo) return null;

  const classDataRaw = denormalizeClassRow(classInfo);
  if (!classDataRaw.subclassTitle) classDataRaw.subclassTitle = 'Subclass';

  const [
    skillsData,
    toolsData,
    toolCategoriesData,
    armorData,
    armorCategoriesData,
    weaponsData,
    weaponCategoriesData,
    languagesData,
    languageCategoriesData,
    attributesData,
    tagsData,
    spellcastingTypesData,
    pactMagicScalingsData,
    spellsKnownScalingsData
  ] = await Promise.all([
    fetchCollection('skills'),
    fetchCollection('tools'),
    fetchCollection('toolCategories'),
    fetchCollection('armor'),
    fetchCollection('armorCategories'),
    fetchCollection('weapons'),
    fetchCollection('weaponCategories'),
    fetchCollection('languages'),
    fetchCollection('languageCategories'),
    fetchCollection('attributes'),
    fetchCollection('tags'),
    fetchCollection('spellcastingTypes'),
    fetchCollection('pactMagicScalings', { where: "type = 'pact'" }),
    fetchCollection('spellsKnownScalings', { where: "type = 'known'" })
  ]);

  // D1 returns snake_case columns; the export code reads camelCase. Build
  // alias maps once here so the rest of the orchestration is shape-agnostic.
  const parseLevels = (s: any) => (typeof s.levels === 'string' ? JSON.parse(s.levels) : (s.levels || []));
  const parsePropertyIds = (w: any) => (typeof w.property_ids === 'string' ? JSON.parse(w.property_ids) : (w.property_ids || []));
  const refs = {
    skillsById: Object.fromEntries(skillsData.map((s: any) => [s.id, { ...s, abilityId: s.ability_id }])),
    toolsById: Object.fromEntries(toolsData.map((t: any) => [t.id, { ...t, categoryId: t.category_id, abilityId: t.ability_id }])),
    toolCategoriesById: Object.fromEntries(toolCategoriesData.map((c: any) => [c.id, c])),
    armorById: Object.fromEntries(armorData.map((a: any) => [a.id, { ...a, categoryId: a.category_id, abilityId: a.ability_id }])),
    armorCategoriesById: Object.fromEntries(armorCategoriesData.map((c: any) => [c.id, c])),
    weaponsById: Object.fromEntries(weaponsData.map((w: any) => [w.id, { ...w, categoryId: w.category_id, abilityId: w.ability_id, propertyIds: parsePropertyIds(w) }])),
    weaponCategoriesById: Object.fromEntries(weaponCategoriesData.map((c: any) => [c.id, c])),
    languagesById: Object.fromEntries(languagesData.map((l: any) => [l.id, { ...l, categoryId: l.category_id }])),
    languageCategoriesById: Object.fromEntries(languageCategoriesData.map((c: any) => [c.id, c])),
    attributesById: Object.fromEntries(attributesData.map((a: any) => [a.id, a])),
    tagsById: Object.fromEntries(tagsData.map((t: any) => [t.id, t])),
    spellcastingTypesById: Object.fromEntries(spellcastingTypesData.map((t: any) => [t.id, t])),
    pactMagicScalingsById: Object.fromEntries(pactMagicScalingsData.map((s: any) => [s.id, { ...s, levels: parseLevels(s) }])),
    spellsKnownScalingsById: Object.fromEntries(spellsKnownScalingsData.map((s: any) => [s.id, { ...s, levels: parseLevels(s) }])),
  };

  const sourceCache: { [id: string]: string } = {};
  const resolveBookId = async (sid: string | undefined) => {
    if (!sid) return undefined;
    if (sourceCache[sid]) return sourceCache[sid];
    if (sid.startsWith('source-')) return sid;

    const sourceRow = await fetchDocument<any>('sources', sid);
    const sourceSnap = denormalizeSource(sourceRow);
    if (sourceSnap) {
      sourceCache[sid] = getSemanticSourceId(sourceSnap, sid);
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

  const subclassesData = await fetchCollection<any>('subclasses', { where: "class_id = ?", params: [classId] });
  const subclassesRaw = subclassesData.map(denormalizeSubclassRow);
  const subclassIds = subclassesRaw.map((sub: any) => sub.id);
  const allParentIds = [classId, ...subclassIds];

  let featuresRaw: any[] = [];
  if (allParentIds.length > 0) {
    const featuresData = await fetchCollection<any>('features', { where: `parent_id IN (${allParentIds.map(() => '?').join(',')})`, params: allParentIds });
    featuresRaw = featuresData.map(denormalizeFeatureRow);
  }

  let scalingColumnsRaw: any[] = [];
  if (allParentIds.length > 0) {
    const scalingData = await fetchCollection<any>('scalingColumns', { where: `parent_id IN (${allParentIds.map(() => '?').join(',')})`, params: allParentIds });
    scalingColumnsRaw = scalingData.map(denormalizeScalingColumnRow);
  }

  const subclasses = await Promise.all(subclassesRaw.map(async (subclass: any) => {
    const identifier = subclass.identifier || slugify(subclass.name);
    const resolvedLocal = await resolveBookId(subclass.sourceId);
    const sourceBookId = (resolvedLocal && resolvedLocal.startsWith('source-')) ? resolvedLocal : resolvedClassBookId;
    const out: any = omitKeys({
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
      spellcasting: normalizeSpellcastingForExport(subclass.spellcasting, refs, {
        preserveNativeProgression: true,
        classIdentifierForLevelRef: classIdentifier,
      })
    }, ['classId', 'excludedOptionIds']);
    // Empty image variants come through as `""` from migrate (Firestore
    // didn't carry the field). Drop the pair so output matches canonical.
    if (!out.cardImageUrl) { delete out.cardImageUrl; delete out.cardDisplay; }
    if (!out.previewImageUrl) { delete out.previewImageUrl; delete out.previewDisplay; }
    // imageDisplay/cardDisplay/previewDisplay drop naturally via JSON.stringify
    // when undefined. uniqueOptionGroupIds is always included (even empty).
    return out;
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
  // Map of column.id → @scale.<class>.<identifier> formula. The module's
  // class-root ScaleValueAdvancement emits every column (class- or
  // subclass-authored) under the class identifier, so the same prefix
  // always resolves on the actor.
  const scalingFormulaById = Object.fromEntries(
    scalingColumns
      .filter((column) => trimString(column.identifier))
      .map((column) => [column.id, `@scale.${classIdentifier}.${column.identifier}`])
  );

  const referencedGroupIds = collectReferencedOptionGroupIds(classDataRaw, ...subclassesRaw, ...featuresRaw);
  const allGroupIds = uniqueStrings([
    ...referencedGroupIds,
    ...asArray(classDataRaw.uniqueOptionGroupIds),
    ...featuresRaw.flatMap((feature) => asArray(feature.uniqueOptionGroupIds))
  ]);

  let uniqueOptionGroups: any[] = [];
  if (allGroupIds.length > 0) {
    const placeholders = allGroupIds.map(() => '?').join(',');
    const groupsRows = await fetchCollection<any>('uniqueOptionGroups', {
      where: `id IN (${placeholders})`,
      params: allGroupIds,
    });
    uniqueOptionGroups = groupsRows.map((row: any) => {
      const data = denormalizeOptionGroupRow(row);
      const identifier = data.identifier || slugify(data.name || '');
      const scalingSourceId = scalingSourceIdById[data.scalingColumnId] || trimString(data.scalingId);
      return omitKeys({
        ...data,
        id: row.id,
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

    // Reconstruct the canonical feature shape:
    //   - `type` from the legacy `featureType` column
    //   - `usage` container from flat uses_max/uses_spent/uses_recovery
    //   - `configuration` container from flat prerequisites_*/repeatable
    // and drop the flat versions + other fields the export contract omits.
    const usage: Record<string, any> = {
      max: feature.usesMax ?? '',
      spent: Number(feature.usesSpent ?? 0) || 0,
    };
    if (Array.isArray(feature.usesRecovery) && feature.usesRecovery.length > 0) {
      usage.recovery = feature.usesRecovery;
    }

    const configuration: Record<string, any> = {
      requiredLevel: feature.prerequisitesLevel ?? (Number(feature.level || 1) || 1),
      requiredIds: Array.isArray(feature.prerequisitesItems) ? feature.prerequisitesItems : [],
      repeatable: !!feature.repeatable,
    };

    // imageUrl falls back to iconUrl per the canonical contract (the export
    // historically routed both columns to the same value via resolveImageUrl).
    // Both ship only when at least one is set; otherwise undefined and dropped.
    const resolvedImage = resolveImageUrl(feature) || undefined;
    const imageUrl = resolvedImage;
    const iconUrl = feature.iconUrl || resolvedImage || undefined;

    return omitKeys({
      ...feature,
      id: feature.id,
      identifier,
      type: feature.featureType || 'class',
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
      // Pre-built `@scale.<class>.<identifier>` formulas. The module
      // pre-fills system.uses.max from `usesScaleFormula` when the
      // feature has no manually-authored Max, and stashes both
      // formulas in feature flags so activity damage / dice formulas
      // can reference them without the user typing the path manually.
      usesScaleFormula: scalingFormulaById[feature.quantityColumnId] || undefined,
      scaleFormula: scalingFormulaById[feature.scalingColumnId] || undefined,
      imageUrl,
      iconUrl,
      configuration,
      usage,
      automation: {
        activities: Array.isArray(feature.automation?.activities)
          ? feature.automation.activities
          : Object.values(feature.automation?.activities || {}),
        effects: feature.automation?.effects || []
      }
    }, [
      'parentId', 'quantityColumnId', 'scalingColumnId',
      // raw D1 fields that have a canonical container counterpart above
      'featureType', 'subtype', 'requirements', 'repeatable', 'page',
      'usesMax', 'usesSpent', 'usesRecovery',
      'prerequisitesLevel', 'prerequisitesItems',
      'activities', 'effects',
    ]);
  }));

  const featuresById = Object.fromEntries(features.map((feature) => [feature.id, feature]));
  const featureSourceIdById = Object.fromEntries(features.map((feature) => [feature.id, feature.sourceId]));
  const optionGroupFeatureSourceById = buildOptionGroupFeatureSourceMap([classDataRaw, ...subclassesRaw], featuresById);
  // Subclass attribution: when an option-group is referenced from a
  // subclass-root advancement (Battle Master Maneuvers, Eldritch Knight
  // spell pool, etc.) its prompt must only fire when that subclass is
  // selected. Build a record→sourceId map so the metadata builder can
  // tag those groups for runtime filtering. Class-root references stay
  // unattributed and appear for every subclass.
  const subclassSourceIdByRecord = new Map<any, string>();
  for (const subclass of subclassesRaw) {
    const subclassResolved = subclasses.find((s: any) => s.id === subclass.id);
    if (subclassResolved?.sourceId) {
      subclassSourceIdByRecord.set(subclass, subclassResolved.sourceId);
    }
  }
  const optionGroupAdvancementMetadataById = buildOptionGroupAdvancementMetadataMap(
    [classDataRaw, ...subclassesRaw],
    featuresById,
    scalingById,
    scalingSourceIdById,
    subclassSourceIdByRecord
  );

  uniqueOptionGroups = uniqueOptionGroups.map((group) => {
    const advancementMetadata = optionGroupAdvancementMetadataById[group.id] || {
      featureSourceId: '',
      subclassSourceId: '',
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
      // Empty when the group is class-root or owned by a feature
      // (those already filter via featureSourceId / grantedFeatureSourceIds).
      subclassSourceId: advancementMetadata.subclassSourceId || '',
      scalingSourceId: trimString(group.scalingSourceId) || advancementMetadata.scalingSourceId || undefined,
      selectionCountsByLevel: Object.keys(group.selectionCountsByLevel || {}).length
        ? group.selectionCountsByLevel
        : advancementMetadata.selectionCountsByLevel
    };
  });

  let uniqueOptionItems: any[] = [];
  if (allGroupIds.length > 0) {
    const placeholders = allGroupIds.map(() => '?').join(',');
    const itemsRows = await fetchCollection<any>('uniqueOptionItems', {
      where: `group_id IN (${placeholders})`,
      params: allGroupIds,
    });
    uniqueOptionItems = itemsRows.map((row: any) => {
      const data = denormalizeOptionItemRow(row);
      const group = uniqueOptionGroups.find((entry) => entry.id === data.groupId);
      const identifier = data.identifier || slugify(data.name || '');
      const linkedFeature = data.featureId ? featuresById[data.featureId] : null;
      return omitKeys({
        ...data,
        imageUrl: resolveImageUrl(data) || undefined,
        id: row.id,
        identifier,
        sourceId: `class-option-${identifier}`,
        sourceBookId: group?.sourceBookId || resolvedClassBookId,
        groupSourceId: group?.sourceId || trimString(data.groupId),
        // Group's owner — kept around for backward compat / display.
        // The module reads the group's owner from the group itself,
        // so this is mostly informational on the option row.
        featureSourceId: group?.featureSourceId || '',
        // The option's OWN linked feature — points at the feature
        // whose activities, damage, and advancements back this option's
        // mechanics. Empty when the option is a pure stub. The module
        // reads this in createSemanticOptionItem and merges the linked
        // feature's content into the embedded item.
        linkedFeatureSourceId: linkedFeature?.sourceId || '',
        description: cleanText(data.description),
        levelPrerequisite: Number(data.levelPrerequisite || 0) || 0,
        // PK list at authoring time; remapped to per-option sourceIds
        // below once every option's sourceId is known. The module
        // checks this against `state.optionSelections` to gate options
        // whose prerequisite picks haven't been made yet.
        requiresOptionIds: asArray(data.requiresOptionIds)
      }, ['groupId', 'featureId', 'classIds', 'iconUrl', 'page']);
    });
  }

  const optionItemSourceIdById = Object.fromEntries(uniqueOptionItems.map((item) => [item.id, item.sourceId]));

  // Second pass: translate each option's requiresOptionIds (PKs from
  // the editor) into the canonical per-option sourceIds, dropping any
  // PK that no longer resolves (stale reference).
  for (const opt of uniqueOptionItems) {
    const remapped: string[] = [];
    for (const pk of asArray(opt.requiresOptionIds)) {
      const sid = optionItemSourceIdById[pk];
      if (sid) remapped.push(sid);
    }
    opt.requiresOptionIds = remapped;
  }

  // Build per-grant maps of optionGroupSourceId → granter-specified data:
  //   - usesFeatureByGroupSourceId: which feature's uses pool the
  //     granted options consume from.
  //   - optionScaleFormulaByGroupSourceId: which @scale.<class>.<col>
  //     formula `@scale.linked` resolves to in the granted options'
  //     damage / dice formulas. Lets one shared option group resolve
  //     differently per granter (Reaver → @scale.barbarian.superiority-dice,
  //     Battle Master → @scale.fighter.superiority-dice).
  // First match wins when the same group is granted by multiple
  // advancements with conflicting links (rare).
  const usesFeatureByGroupSourceId: Record<string, string> = {};
  const optionScaleFormulaByGroupSourceId: Record<string, string> = {};
  for (const record of [classDataRaw, ...subclassesRaw, ...featuresRaw]) {
    for (const adv of asArray(record?.advancements)) {
      const advType = trimString(adv?.type);
      if (advType !== 'ItemChoice' && advType !== 'ItemGrant') continue;
      const optionGroupId = trimString(adv?.configuration?.optionGroupId);
      if (!optionGroupId) continue;
      const optionGroupSourceId = optionGroupSourceIdById[optionGroupId] || optionGroupId;
      if (!optionGroupSourceId) continue;

      const usesFeatureId = trimString(adv?.configuration?.usesFeatureId);
      if (usesFeatureId) {
        const usesFeatureSourceId = featureSourceIdById[usesFeatureId] || trimString(usesFeatureId);
        if (usesFeatureSourceId && !usesFeatureByGroupSourceId[optionGroupSourceId]) {
          usesFeatureByGroupSourceId[optionGroupSourceId] = usesFeatureSourceId;
        }
      }

      const optionScalingColumnId = trimString(adv?.configuration?.optionScalingColumnId);
      if (optionScalingColumnId) {
        const column = scalingById[optionScalingColumnId];
        const columnIdentifier = trimString(column?.identifier);
        if (columnIdentifier && !optionScaleFormulaByGroupSourceId[optionGroupSourceId]) {
          optionScaleFormulaByGroupSourceId[optionGroupSourceId] = `@scale.${classIdentifier}.${columnIdentifier}`;
        }
      }
    }
  }
  for (const opt of uniqueOptionItems) {
    const sid = trimString(opt.groupSourceId);
    if (!sid) continue;
    if (usesFeatureByGroupSourceId[sid]) {
      opt.usesFeatureSourceId = usesFeatureByGroupSourceId[sid];
    }
    if (optionScaleFormulaByGroupSourceId[sid]) {
      opt.optionScaleFormula = optionScaleFormulaByGroupSourceId[sid];
    }
  }

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

  const canonicalClassProgression = buildCanonicalClassProgression({
    advancements: asArray(classDataRaw.advancements),
    hitDie: Number(classDataRaw.hitDie || 0) || 8,
    proficiencies: normalizedProficiencies,
    savingThrows: normalizedSavingThrows,
    subclassTitle: classDataRaw.subclassTitle || '',
    subclassFeatureLevels: asArray(classDataRaw.subclassFeatureLevels).map((level: any) => Number(level)).filter(Boolean),
    asiLevels: asArray(classDataRaw.asiLevels).map((level: any) => Number(level)).filter(Boolean),
    features: normalizedFeatures.filter((feature) => feature.parentSourceId === classSourceId),
    implicitGrantPrefix: 'inherent-class-feature-grant',
    includeImplicitFeatureGrants: true
  });

  const baseClassAdvancements = canonicalClassProgression.baseAdvancements
    .map((advancement) => normalizeAdvancementForExport(advancement, advancementContext))
    .filter(Boolean);
  const inherentClassFeatureGrants = canonicalClassProgression.implicitFeatureGrants
    .map((advancement) => normalizeAdvancementForExport(advancement, advancementContext))
    .filter(Boolean);
  const customClassAdvancements = canonicalClassProgression.customAdvancements
    .map((advancement) => normalizeAdvancementForExport(advancement, advancementContext))
    .filter(Boolean);

  const normalizedSubclasses = (subclasses as any[]).map((subclass: any) => {
    const subclassRaw: any = subclassesRaw.find((entry: any) => entry.id === subclass.id) || {};
    const canonicalSubclassProgression = buildCanonicalSubclassProgression({
      advancements: asArray(subclassRaw.advancements),
      features: normalizedFeatures.filter((feature) => feature.parentSourceId === subclass.sourceId),
      implicitGrantPrefix: `inherent-subclass-feature-grant-${subclass.identifier || subclass.id}`,
      includeImplicitFeatureGrants: true
    });
    const inherentSubclassFeatureGrants = canonicalSubclassProgression.implicitFeatureGrants
      .map((advancement) => normalizeAdvancementForExport(advancement, advancementContext))
      .filter(Boolean);
    const customAdvancements = canonicalSubclassProgression.customAdvancements
      .map((advancement: any) => normalizeAdvancementForExport(advancement, advancementContext))
      .filter(Boolean);

    return {
      ...subclass,
      advancements: [...inherentSubclassFeatureGrants, ...customAdvancements].sort(sortAdvancementsByLevelThenType)
    };
  });

  const classSpellcasting = normalizeSpellcastingForExport(classDataRaw.spellcasting, refs, {
    preserveNativeProgression: false,
    classIdentifierForLevelRef: classIdentifier,
  });
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

  let source: any = null;
  if (classDataRaw.sourceId) {
    const sourceRow = await fetchDocument<any>('sources', classDataRaw.sourceId);
    if (sourceRow) source = denormalizeSource(sourceRow);
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
  const [{ default: JSZip }, { saveAs }, { fetchDocument, fetchCollection }] = await Promise.all([
    import('jszip'),
    import('file-saver'),
    import('./d1'),
  ]);
  const exportFetchers = { fetchCollection, fetchDocument };
  const sourceRow = await fetchDocument<any>('sources', sourceId);
  if (!sourceRow) throw new Error("Source not found");
  const sourceData: any = denormalizeSource(sourceRow);
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

  // 2. Fetch Classes for this source
  const classesRows = await fetchCollection<any>('classes', {
    where: 'source_id = ?',
    params: [sourceId],
  });
  const classes = classesRows.map((c: any) => denormalizeClassRow(c));
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
      const fullExport = await exportClassSemantic(cls.id, exportFetchers);
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
  const [{ default: JSZip }, { saveAs }, { fetchCollection, fetchDocument }] = await Promise.all([
    import('jszip'),
    import('file-saver'),
    import('./d1'),
  ]);
  const exportFetchers = { fetchCollection, fetchDocument };
  const sourcesRows = await fetchCollection<any>('sources', {
    where: 'status = ?',
    params: ['ready'],
  });
  const sources = sourcesRows.map((s: any) => denormalizeSource(s));

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

    // Fetch Classes for this source
    const classesRows = await fetchCollection<any>('classes', {
      where: 'source_id = ?',
      params: [sourceId],
    });
    const classes = classesRows.map((c: any) => denormalizeClassRow(c));

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
          const fullExport = await exportClassSemantic(cls.id, exportFetchers);
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
  const [{ saveAs }, { fetchCollection }] = await Promise.all([
    import('file-saver'),
    import('./d1'),
  ]);
  const sourcesRows = await fetchCollection<any>('sources', {
    where: 'status = ?',
    params: ['ready'],
  });
  const sources = sourcesRows.map((s: any) => denormalizeSource(s));

  const entries: any[] = [];
  for (const source of sources) {
    const s: any = source;
    // Fetch count for display in catalog
    const classesRows = await fetchCollection<any>('classes', {
      select: 'id',
      where: 'source_id = ?',
      params: [s.id],
    });
    const classCount = classesRows.length;
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
        classes: classCount,
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
  const [{ saveAs }, { fetchDocument, fetchCollection }] = await Promise.all([
    import('file-saver'),
    import('./d1'),
  ]);
  const sourceRow = await fetchDocument<any>('sources', sourceId);
  if (!sourceRow) throw new Error("Source not found");
  const sourceData: any = denormalizeSource(sourceRow);
  const slug = sourceData.slug || sourceId;
  const semanticId = getSemanticSourceId(sourceData, sourceId);

  // Fetch Classes for count
  const classesRows = await fetchCollection<any>('classes', {
    select: 'id',
    where: 'source_id = ?',
    params: [sourceId],
  });
  const classCount = classesRows.length;

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
      classes: { count: classCount, catalogUrl: "classes/catalog.json" },
      spells: { count: 0, catalogUrl: null },
      items: { count: 0, catalogUrl: null },
      bestiary: { count: 0, catalogUrl: null },
      journals: { count: 0, catalogUrl: null }
    }
  };

  const blob = new Blob([JSON.stringify(sourceDetail, null, 2)], { type: "application/json" });
  saveAs(blob, `${slug}.json`);
}

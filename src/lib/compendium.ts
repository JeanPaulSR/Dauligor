import { upsertDocument, deleteDocument, fetchDocument, upsertDocumentBatch, queryD1 } from './d1';
import { slugify, makeFoundryId } from './utils';

/**
 * Standard mapping for common compendium fields from camelCase (React) to snake_case (SQL).
 */
export function normalizeCompendiumData(data: Record<string, any>): Record<string, any> {
  const mapping: Record<string, string> = {
    imageUrl: 'image_url',
    sourceId: 'source_id',
    itemType: 'item_type',
    priceValue: 'price_value',
    priceDenomination: 'price_denomination',
    usesMax: 'uses_max',
    usesSpent: 'uses_spent',
    usesPeriod: 'uses_period',
    usesRecovery: 'uses_recovery',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    parentId: 'parent_id',
    parentType: 'parent_type',
    preparationMode: 'preparation_mode',
    componentsVocal: 'components_vocal',
    componentsSomatic: 'components_somatic',
    componentsMaterial: 'components_material',
    componentsMaterialText: 'components_material_text',
    componentsConsumed: 'components_consumed',
    componentsCost: 'components_cost',
    isSubclassFeature: 'is_subclass_feature',
    iconUrl: 'icon_url',
    quantityColumnId: 'quantity_column_id',
    scalingColumnId: 'scaling_column_id',
    // spell prerequisites + Layer-2 GrantSpells/ExtendSpellList source attribution
    // (claude/kind-maxwell-bfa076 — Spellbook Manager).
    requiredTags: 'required_tags',
    prerequisiteText: 'prerequisite_text',
    grantedByType: 'granted_by_type',
    grantedById: 'granted_by_id',
    grantedByAdvancementId: 'granted_by_advancement_id',
    countsAsClassId: 'counts_as_class_id',
    doesntCountAgainstPrepared: 'doesnt_count_against_prepared',
    doesntCountAgainstKnown: 'doesnt_count_against_known'
  };

  const normalized: Record<string, any> = {};

  // 1. Basic Mapping
  for (const [key, value] of Object.entries(data)) {
    const mappedKey = mapping[key] || key;
    normalized[mappedKey] = value;
  }

  // 2. Unwrap Automation (Activities & Effects)
  if (normalized.automation) {
    if (normalized.automation.activities) normalized.activities = normalized.automation.activities;
    if (normalized.automation.effects) normalized.effects = normalized.automation.effects;
    delete normalized.automation;
  }

  // 3. Map legacy 'uses' object if it exists
  if (normalized.uses && typeof normalized.uses === 'object') {
    if (normalized.uses.max !== undefined) normalized.uses_max = String(normalized.uses.max);
    if (normalized.uses.spent !== undefined) normalized.uses_spent = Number(normalized.uses.spent);
    if (normalized.uses.value !== undefined && normalized.uses.spent === undefined) {
      const max = Number(normalized.uses.max || 0);
      const val = Number(normalized.uses.value || 0);
      normalized.uses_spent = Math.max(0, max - val);
    }
    if (normalized.uses.per !== undefined) normalized.uses_period = normalized.uses.per;
    if (normalized.uses.period !== undefined) normalized.uses_period = normalized.uses.period;
    if (normalized.uses.recovery !== undefined) normalized.uses_recovery = normalized.uses.recovery;
    
    delete normalized.uses;
  }

  // 4. Map 'components' object if it exists (for Spells)
  if (normalized.components && typeof normalized.components === 'object') {
    if (normalized.components.vocal !== undefined) normalized.components_vocal = normalized.components.vocal;
    if (normalized.components.somatic !== undefined) normalized.components_somatic = normalized.components.somatic;
    if (normalized.components.material !== undefined) normalized.components_material = normalized.components.material;
    if (normalized.components.materialText !== undefined) normalized.components_material_text = normalized.components.materialText;
    if (normalized.components.consumed !== undefined) normalized.components_consumed = normalized.components.consumed;
    if (normalized.components.cost !== undefined) normalized.components_cost = normalized.components.cost;
    
    delete normalized.components;
  }

  // 5. Map prerequisites object if it exists (for Features)
  if (normalized.prerequisites && typeof normalized.prerequisites === 'object') {
    if (normalized.prerequisites.level !== undefined) normalized.prerequisites_level = normalized.prerequisites.level;
    if (normalized.prerequisites.items !== undefined) normalized.prerequisites_items = normalized.prerequisites.items;
    if (normalized.prerequisites.repeatable !== undefined) normalized.repeatable = normalized.prerequisites.repeatable;
    
    delete normalized.prerequisites;
  }

  // 5. Map prerequisites object if it exists (for Features)
  if (normalized.prerequisites && typeof normalized.prerequisites === 'object') {
    if (normalized.prerequisites.level !== undefined) normalized.prerequisites_level = normalized.prerequisites.level;
    if (normalized.prerequisites.items !== undefined) normalized.prerequisites_items = normalized.prerequisites.items;
    if (normalized.prerequisites.repeatable !== undefined) normalized.repeatable = normalized.prerequisites.repeatable;
    
    delete normalized.prerequisites;
  }

  // 6. Numeric Conversions
  const numericFields = ['weight', 'price_value', 'level', 'quantity', 'uses_spent', 'prerequisites_level'];
  numericFields.forEach(field => {
    if (normalized[field] !== undefined && normalized[field] !== '' && normalized[field] !== null) {
      normalized[field] = Number(normalized[field]);
    }
  });

  // 6. ID Field Cleanup (Empty string to Null)
  const idFields = ['source_id', 'category_id', 'ability_id', 'group_id', 'parent_id'];
  idFields.forEach(field => {
    if (normalized[field] === '') {
      normalized[field] = null;
    }
  });

  // 7. Boolean to Integer (SQLite doesn't have a native boolean type)
  const booleanFields = [
    'attunement', 'equipped', 'identified', 'magical', 'ritual', 'concentration',
    'repeatable', 'components_vocal', 'components_somatic', 'components_material',
    'components_consumed', 'is_subclass_feature'
  ];
  booleanFields.forEach(field => {
    if (normalized[field] !== undefined) {
      normalized[field] = normalized[field] ? 1 : 0;
    }
  });

  // 8. Ensure identifier exists
  if (normalized.name && !normalized.identifier) {
    normalized.identifier = slugify(normalized.name);
  }

  // 9. Filter out UI-only or legacy fields that cause SQL errors.
  // `source` is the legacy Firestore publication-metadata object (book/page/
  // license/rules/revision); D1 only stores `source_id` (the FK) and `page`
  // — the rest is dropped. The editor still builds it for back-compat
  // viewing, but it must not reach the upsert.
  const forbidden = [
    'effectsStr', 'id', 'automation', 'activitiesStr', 'status', 'usage',
    'configuration', 'sourceType', 'source_type', 'type', '__usesRecoveryDraft',
    'featType', 'feat_type', 'featureType', 'feature_type', 'source',
    // `uniqueOptionGroupIds` is seeded on new features (`[]`) but the
    // features table has no column for it — option groups link to
    // features one-way via `unique_option_groups.feature_id`, not back
    // through the feature row. Filter to avoid the "no such column" error.
    'uniqueOptionGroupIds', 'unique_option_group_ids',
  ];
  forbidden.forEach(key => delete normalized[key]);

  return normalized;
}

/**
 * Map common compendium fields from snake_case (SQL) back to camelCase (React).
 */
export function denormalizeCompendiumData(row: any): any {
  if (!row) return row;
  
  const mapping: Record<string, string> = {
    image_display: 'imageDisplay',
    card_display: 'cardDisplay',
    preview_display: 'previewDisplay',
    image_url: 'imageUrl',
    card_image_url: 'cardImageUrl',
    preview_image_url: 'previewImageUrl',
    source_id: 'sourceId',
    category_id: 'categoryId',
    group_id: 'groupId',
    external_url: 'externalUrl',
    rules_version: 'rulesVersion',
    foundry_alias: 'foundryAlias',
    ability_id: 'abilityId',
    hit_die: 'hitDie',
    subclass_title: 'subclassTitle',
    subclass_feature_levels: 'subclassFeatureLevels',
    saving_throws: 'savingThrows',
    starting_equipment: 'startingEquipment',
    primary_ability: 'primaryAbility',
    primary_ability_choice: 'primaryAbilityChoice',
    tag_ids: 'tagIds',
    item_type: 'itemType',
    feat_type: 'featType',
    feature_type: 'featureType',
    source_type: 'sourceType',
    price_value: 'priceValue',
    price_denomination: 'priceDenomination',
    uses_max: 'usesMax',
    uses_spent: 'usesSpent',
    uses_period: 'usesPeriod',
    uses_recovery: 'usesRecovery',
    created_at: 'createdAt',
    updated_at: 'updatedAt',
    parent_id: 'parentId',
    parent_type: 'parentType',
    class_id: 'classId',
    class_identifier: 'classIdentifier',
    preparation_mode: 'preparationMode',
    components_vocal: 'componentsVocal',
    components_somatic: 'componentsSomatic',
    components_material: 'componentsMaterial',
    components_material_text: 'componentsMaterialText',
    components_consumed: 'componentsConsumed',
    components_cost: 'componentsCost',
    is_subclass_feature: 'isSubclassFeature',
    icon_url: 'iconUrl',
    quantity_column_id: 'quantityColumnId',
    scaling_column_id: 'scalingColumnId',
    // unique_option_items field aliases — without these, the
    // AdvancementManager picker silently filters every group to empty
    // ("This group has no saved unique options yet") because it reads
    // camelCase keys off raw snake_case rows. The feat-shape columns
    // added in migration 20260509-1356 (feature_type / image_url /
    // uses_max / uses_spent / uses_recovery) are already covered by
    // the features-table mapping above; reuse instead of duplicate.
    level_prerequisite: 'levelPrerequisite',
    string_prerequisite: 'stringPrerequisite',
    is_repeatable: 'isRepeatable',
    class_ids: 'classIds',
    requires_option_ids: 'requiresOptionIds',
    // spell prerequisites + Layer-2 GrantSpells/ExtendSpellList source attribution
    // (claude/kind-maxwell-bfa076 — Spellbook Manager).
    required_tags: 'requiredTags',
    prerequisite_text: 'prerequisiteText',
    granted_by_type: 'grantedByType',
    granted_by_id: 'grantedById',
    granted_by_advancement_id: 'grantedByAdvancementId',
    counts_as_class_id: 'countsAsClassId',
    doesnt_count_against_prepared: 'doesntCountAgainstPrepared',
    doesnt_count_against_known: 'doesntCountAgainstKnown'
  };

  const denormalized: any = { ...row };
  
  for (const [key, value] of Object.entries(row)) {
    if (mapping[key]) {
      denormalized[mapping[key]] = value;
    }
  }

  // Restore 'uses' object for editor compatibility
  if (denormalized.usesMax !== undefined || denormalized.usesSpent !== undefined) {
    denormalized.uses = {
      max: denormalized.usesMax || '',
      spent: denormalized.usesSpent || 0,
      value: Number(denormalized.usesMax || 0) - Number(denormalized.usesSpent || 0),
      per: denormalized.usesPeriod || '',
      period: denormalized.usesPeriod || '',
      recovery: typeof denormalized.uses_recovery === 'string' ? JSON.parse(denormalized.uses_recovery) : (denormalized.uses_recovery || [])
    };
  }

  // Restore 'components' object for Spell editor compatibility
  if (denormalized.componentsVocal !== undefined) {
    denormalized.components = {
      vocal: !!denormalized.componentsVocal,
      somatic: !!denormalized.componentsSomatic,
      material: !!denormalized.componentsMaterial,
      materialText: denormalized.componentsMaterialText || '',
      consumed: !!denormalized.componentsConsumed,
      cost: denormalized.componentsCost || ''
    };
  }

  // Restore 'prerequisites' object for Feature editor compatibility
  if (denormalized.prerequisites_level !== undefined || denormalized.prerequisites_items !== undefined) {
    denormalized.prerequisites = {
      level: denormalized.prerequisites_level || 1,
      items: typeof denormalized.prerequisites_items === 'string' ? JSON.parse(denormalized.prerequisites_items) : (denormalized.prerequisites_items || []),
      repeatable: !!denormalized.repeatable
    };
  }

  // Root activities/effects parsing
  denormalized.activities = typeof row.activities === 'string' ? JSON.parse(row.activities) : (row.activities || []);
  denormalized.effects = typeof row.effects === 'string' ? JSON.parse(row.effects) : (row.effects || []);

  // Restore automation object for editor compatibility
  denormalized.automation = {
    activities: denormalized.activities,
    effects: denormalized.effects
  };

  // Map _id to id for internal editor compatibility
  if (Array.isArray(denormalized.automation.activities)) {
    denormalized.automation.activities = denormalized.automation.activities.map((a: any) => ({
      ...a,
      id: a.id || a._id || makeFoundryId()
    }));
  }
  if (Array.isArray(denormalized.automation.effects)) {
    denormalized.automation.effects = denormalized.automation.effects.map((e: any) => ({
      ...e,
      id: e.id || e._id || makeFoundryId()
    }));
  }

  // Parse remaining JSON columns
  const jsonColumns = [
    'proficiencies', 'spellcasting', 'advancements', 'tagIds', 'savingThrows',
    'primaryAbility', 'primaryAbilityChoice', 'subclassFeatureLevels',
    'imageDisplay', 'cardDisplay', 'previewDisplay', 'properties'
  ];

  jsonColumns.forEach(col => {
    if (typeof denormalized[col] === 'string') {
      try {
        denormalized[col] = JSON.parse(denormalized[col]);
      } catch (e) {
        console.warn(`Failed to parse JSON column ${col}:`, e);
        denormalized[col] = col === 'proficiencies' || col === 'spellcasting' || col === 'imageDisplay' || col === 'cardDisplay' || col === 'previewDisplay' ? {} : [];
      }
    }
  });

  return denormalized;
}

/**
 * Items specialized helpers
 */
export async function upsertItem(id: string, data: Record<string, any>) {
  const normalized = normalizeCompendiumData(data);
  return upsertDocument('items', id, normalized);
}

export async function fetchItem(id: string) {
  const row = await fetchDocument<any>('items', id);
  return denormalizeCompendiumData(row);
}

export async function deleteItem(id: string) {
  return deleteDocument('items', id);
}

/**
 * Feats specialized helpers
 */
export async function upsertFeat(id: string, data: Record<string, any>) {
  const normalized = normalizeCompendiumData(data);
  return upsertDocument('feats', id, normalized);
}

export async function fetchFeat(id: string) {
  const row = await fetchDocument<any>('feats', id);
  return denormalizeCompendiumData(row);
}

export async function deleteFeat(id: string) {
  return deleteDocument('feats', id);
}

/**
 * Spells specialized helpers
 */
export async function upsertSpell(id: string, data: Record<string, any>) {
  const normalized = normalizeCompendiumData(data);
  return upsertDocument('spells', id, normalized);
}

export async function fetchSpell(id: string) {
  const row = await fetchDocument<any>('spells', id);
  return denormalizeCompendiumData(row);
}

export async function deleteSpell(id: string) {
  return deleteDocument('spells', id);
}

/**
 * Admin maintenance: nuke every spell row. Used to recover from a bad
 * import state (e.g. the May 2026 column-name bug that shipped empty
 * foundry_data for ~540 rows). Single DELETE — no FK children cascade
 * off `spells.id` at the time of writing, so this is a clean wipe.
 *
 * Returns the number of rows removed so the admin button can surface
 * a toast count.
 */
export async function purgeAllSpells(): Promise<number> {
  // SELECT first so we can report the count back to the UI; D1's
  // result shape doesn't surface changes() the same way a local
  // SQLite driver would.
  const countRows = await queryD1<{ n: number }>('SELECT COUNT(*) AS n FROM spells');
  const before = Number(countRows?.[0]?.n ?? 0);
  await queryD1('DELETE FROM spells');
  return before;
}

/**
 * Executes a batch of spell upserts.
 */
export async function upsertSpellBatch(entries: { id: string | null, data: Record<string, any> }[]) {
  const normalizedEntries = entries.map(entry => ({
    id: entry.id,
    data: normalizeCompendiumData(entry.data)
  }));
  return upsertDocumentBatch('spells', normalizedEntries);
}

/**
 * Features specialized helpers
 */
export async function upsertFeature(id: string, data: Record<string, any>) {
  const normalized = normalizeCompendiumData(data);
  // The features table column is `tags` (not `tag_ids` like classes /
  // subclasses). Editors carry the loaded list as `tagIds` for
  // cross-entity consistency, so translate on the way in to avoid the
  // "no such column: tagIds" error.
  if (normalized.tagIds !== undefined) {
    normalized.tags = normalized.tagIds;
    delete normalized.tagIds;
  }
  return upsertDocument('features', id, normalized);
}

export async function fetchFeature(id: string) {
  const row = await fetchDocument<any>('features', id);
  return denormalizeCompendiumData(row);
}

export async function deleteFeature(id: string) {
  return deleteDocument('features', id);
}

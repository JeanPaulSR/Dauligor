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
    // priceValue / priceDenomination removed 2026-05-24 — the items
    // table now stores `price` as a nested JSON column ({value, denomination}).
    // Editors should write the nested shape directly; the legacy flat
    // form fields are gone. See migration 20260524-1800.
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
    doesntCountAgainstKnown: 'doesnt_count_against_known',
    // 2026-05-24 Foundry alignment (migration 20260524-1800):
    // weapon/armor/tool root-level fields. The nested JSON columns
    // (weight, price, damage, range) don't need mapping — their form
    // keys match the column names. These are the flat-scalar fields
    // that needed the camelCase→snake_case translation.
    magicalBonus: 'magical_bonus',
    baseItem: 'base_item',
    armorValue: 'armor_value',
    armorDex: 'armor_dex',
    armorMagicalBonus: 'armor_magical_bonus',
    armorType: 'armor_type',
    toolType: 'tool_type',
    // 20260526-1700 items completeness columns. `currency` /
    // `capacity` aren't in the map — they're already lowercase
    // single words that match the column name. `attunement` is
    // also column-name-equivalent (3-state TEXT post 20260526-1700,
    // not the legacy boolean).
    chatFlavor: 'chat_flavor',
    containerId: 'container_id',
    typeSubtype: 'type_subtype',
    unidentifiedDescription: 'unidentified_description',
    abilityId: 'ability_id',
    baseWeaponId: 'base_weapon_id',
    baseArmorId: 'base_armor_id',
    baseToolId: 'base_tool_id',
    // 20260526-2000 facilities columns. The JSON sub-blocks
    // (progress / trade / craft / defenders / hirelings) match the
    // column name as-is, no rename needed. Same with `size`,
    // `level`, `built`, `free`, `disabled`, `enlargeable`.
    facilityType: 'facility_type',
    facilitySubtype: 'facility_subtype',
    facilityOrder: 'facility_order',
  };

  const normalized: Record<string, any> = {};

  // 1. Basic Mapping — two passes so a camelCase editor key ALWAYS wins over a
  // stale snake_case counterpart carried in from a denormalized DB load.
  // `denormalizeCompendiumData` spreads the raw row (keeping e.g. `image_url`)
  // AND adds the camel alias (`imageUrl`), so an edited row's save payload (the
  // editor spreads `...formData`) contains BOTH. Picking a new icon updates
  // only `imageUrl`; the leftover `image_url` still holds the old value. A
  // single pass lets whichever key is iterated last win — and the snake key
  // sorts after the camel one — silently overwriting the fresh value with the
  // stale one. That's why changing an image (or any other mapped field, e.g.
  // source) on an EXISTING row didn't save, while new rows (no snake key yet)
  // did. Pass 1 copies snake/unmapped keys; pass 2 applies the camel→snake
  // mappings last, so the editor's value wins.
  const isMappingKey = (k: string) => Object.prototype.hasOwnProperty.call(mapping, k);
  for (const [key, value] of Object.entries(data)) {
    if (!isMappingKey(key)) normalized[key] = value;
  }
  for (const [key, value] of Object.entries(data)) {
    if (isMappingKey(key)) normalized[mapping[key]] = value;
  }

  // 2. Unwrap Automation (Activities & Effects)
  if (normalized.automation) {
    if (normalized.automation.activities) normalized.activities = normalized.automation.activities;
    if (normalized.automation.effects) normalized.effects = normalized.automation.effects;
    delete normalized.automation;
  }

  // 3. Map legacy 'uses' object if it exists.
  //
  // Features and other legacy entities decompose `uses` into the flat
  // `uses_max` / `uses_spent` / `uses_period` / `uses_recovery` columns
  // their schema actually has. The items table — post-20260526-1700 —
  // stores `uses` as a single JSON column and DOES NOT have those flat
  // columns. Decomposing for items would (a) silently strand the data
  // (no flat columns to land in), and (b) drop the `uses` JSON column
  // via the `delete normalized.uses` at the end. Detect items payloads
  // via the `item_type` discriminator (already snake_cased by step 1)
  // and skip the decomposition so the items.uses JSON column gets the
  // object intact.
  if (normalized.uses && typeof normalized.uses === 'object') {
    const isItemsPayload = !!normalized.item_type;
    if (!isItemsPayload) {
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

  // 6. Numeric Conversions
  // NOTE: `weight` and `price_value` were removed from this list
  // 2026-05-24 — the items/weapons/armor/tools schemas now store
  // weight as a nested JSON object `{value, units}` and price as
  // `{value, denomination}`. Casting them to Number would corrupt
  // the object. New numeric flat columns from the same migration
  // (armor_value, armor_dex, armor_magical_bonus, magical_bonus,
  // strength, stealth) are added below.
  const numericFields = [
    'level', 'quantity', 'uses_spent', 'prerequisites_level',
    'armor_value', 'armor_dex', 'armor_magical_bonus', 'magical_bonus',
    'strength',
  ];
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
  //
  // The coercion fires ONLY when the value is an actual JS boolean.
  // That keeps `attunement` safe across two callers writing different
  // shapes against different schemas:
  //   - items.attunement INTEGER (legacy) ← ItemsEditor sends `false`/`true`
  //   - weapons/armor/tools.attunement TEXT ← Editor sends `''`/`'required'`/`'optional'`
  // A blanket `value ? 1 : 0` would turn `'required'` into 1 and write
  // the integer 1 into a TEXT column. typeof-boolean gates it.
  const booleanFields = [
    'attunement', 'equipped', 'identified', 'magical', 'ritual', 'concentration',
    'repeatable', 'components_vocal', 'components_somatic', 'components_material',
    'components_consumed', 'is_subclass_feature',
    // armor.stealth disadvantage flag (0/1)
    'stealth',
  ];
  booleanFields.forEach(field => {
    if (typeof normalized[field] === 'boolean') {
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
    'configuration', 'sourceType', 'type', '__usesRecoveryDraft',
    'featType', 'featureType', 'feature_type', 'source',
    // `uniqueOptionGroupIds` is seeded on new features (`[]`) but the
    // features table has no column for it — option groups link to
    // features one-way via `unique_option_groups.feature_id`, not back
    // through the feature row. Filter to avoid the "no such column" error.
    'uniqueOptionGroupIds', 'unique_option_group_ids',
    // NOTE: `feat_type`, `feat_subtype`, `source_type` (snake_case) are
    // intentionally NOT forbidden — they are valid columns on the `feats`
    // table that FeatsEditor + FeatImportWorkbench both write directly.
    // Removing them from the forbidden list (May 2026, alongside the
    // FeatImportWorkbench rollout) fixed a latent silent-drop bug in the
    // FeatsEditor's save path. The camelCase `featType` / `sourceType`
    // stay forbidden so callers are forced through the snake-case
    // columns (the schema's source of truth).
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
    // Was MISSING — the ClassEditor reads `remapped.multiclassProficiencies`
    // off this denormalize pass, but without the alias the camelCase key
    // never existed, so every multiclass proficiency loaded empty (and a
    // subsequent save persisted the empties). The column is also added to
    // jsonColumns below so it parses from its TEXT string to an object.
    multiclass_proficiencies: 'multiclassProficiencies',
    tag_ids: 'tagIds',
    item_type: 'itemType',
    feat_type: 'featType',
    feature_type: 'featureType',
    source_type: 'sourceType',
    // price_value / price_denomination dropped 2026-05-24 — `price`
    // is now stored as a nested JSON object {value, denomination}
    // (see migration 20260524-1800). The d1.ts jsonFields list
    // auto-parses it on read, so consumers receive a typed object.
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
    level_prereq_is_total: 'levelPrereqIsTotal',
    string_prerequisite: 'stringPrerequisite',
    is_repeatable: 'isRepeatable',
    class_ids: 'classIds',
    requires_option_ids: 'requiresOptionIds',
    // requirements_tree is parsed by d1.ts on read (jsonFields); the alias
    // exposes it in camelCase so option-item consumers (level gates,
    // requirement summaries) can read `requirementsTree` consistently with
    // the rest of the denormalized shape.
    requirements_tree: 'requirementsTree',
    // spell prerequisites + Layer-2 GrantSpells/ExtendSpellList source attribution
    // (claude/kind-maxwell-bfa076 — Spellbook Manager).
    required_tags: 'requiredTags',
    prerequisite_text: 'prerequisiteText',
    granted_by_type: 'grantedByType',
    granted_by_id: 'grantedById',
    granted_by_advancement_id: 'grantedByAdvancementId',
    counts_as_class_id: 'countsAsClassId',
    doesnt_count_against_prepared: 'doesntCountAgainstPrepared',
    doesnt_count_against_known: 'doesntCountAgainstKnown',
    // 2026-05-24 Foundry alignment — reverse mappings for the new
    // weapon/armor/tool root-level columns added by migration
    // 20260524-1800. The nested JSON columns (weight, price, damage,
    // range) are parsed by d1.ts directly with no key change.
    magical_bonus: 'magicalBonus',
    base_item: 'baseItem',
    armor_value: 'armorValue',
    armor_dex: 'armorDex',
    armor_magical_bonus: 'armorMagicalBonus',
    armor_type: 'armorType',
    tool_type: 'toolType',
    // 20260526-1700 items completeness columns. Mirrors the new
    // mappings on the normalize side so the editor reads them as
    // camelCase consistently.
    chat_flavor: 'chatFlavor',
    container_id: 'containerId',
    type_subtype: 'typeSubtype',
    unidentified_description: 'unidentifiedDescription',
    base_weapon_id: 'baseWeaponId',
    base_armor_id: 'baseArmorId',
    base_tool_id: 'baseToolId',
    // 20260526-2000 facilities columns.
    facility_type: 'facilityType',
    facility_subtype: 'facilitySubtype',
    facility_order: 'facilityOrder',
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
    'imageDisplay', 'cardDisplay', 'previewDisplay', 'properties',
    // Parse the multiclass proficiency collection (same shape as
    // `proficiencies`). Aliased from `multiclass_proficiencies` above;
    // stored as a TEXT JSON string, so without this the ClassEditor's
    // `typeof rawMultiProf.armor === 'object'` guard sees a string and
    // falls back to all-empty collections.
    'multiclassProficiencies'
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
  // Same `tagIds` → `tags` remap upsertFeat does — the items column
  // is `tags` (JSON array), but editors carry the loaded list as
  // `tagIds` for cross-entity consistency. Translate on the way in to
  // avoid "no such column: tag_ids".
  if (normalized.tagIds !== undefined) {
    normalized.tags = normalized.tagIds;
    delete normalized.tagIds;
  }
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
 * Batch upsert for items. Mirrors `upsertSpellBatch` / `upsertFeatBatch`.
 * Used by `ItemImportWorkbench` to write every imported item (the unified
 * `items` table — weapons / armor / tools included; `targetTable` is only a
 * column-selection hint). Normalizes each entry AND applies the same
 * `tagIds → tags` remap as `upsertItem`, since the import payload carries the
 * tag list as `tagIds` but the column is `tags`.
 */
export async function upsertItemBatch(entries: { id: string | null, data: Record<string, any> }[]) {
  const normalizedEntries = entries.map((entry) => {
    const data = normalizeCompendiumData(entry.data);
    // Same `tagIds` → `tags` remap upsertItem (singular) does — the items
    // column is `tags` (JSON array), but the import + editors carry the list as
    // `tagIds`. Without this the batch import hits "no column named tagIds".
    if (data.tagIds !== undefined) {
      data.tags = data.tagIds;
      delete data.tagIds;
    }
    return { id: entry.id, data };
  });
  return upsertDocumentBatch('items', normalizedEntries);
}

/**
 * Feats specialized helpers
 */
export async function upsertFeat(id: string, data: Record<string, any>) {
  const normalized = normalizeCompendiumData(data);
  // Same `tagIds` → `tags` remap upsertFeature does — the feats column
  // is `tags`, not `tag_ids`, but editors carry the loaded list as
  // `tagIds` for cross-entity consistency. Translate on the way in to
  // avoid "no such column: tag_ids".
  if (normalized.tagIds !== undefined) {
    normalized.tags = normalized.tagIds;
    delete normalized.tagIds;
  }
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
 * Batch upsert for feats. Mirrors `upsertSpellBatch` but without the
 * filter-bucket materialisation (no `prepareSpellPayloadForWrite`
 * equivalent — feats don't have the four filter columns spells do).
 *
 * Used by `FeatImportWorkbench` when the admin clicks
 * "Import Visible Batch". Same payload shape as `upsertFeat` — every
 * row is run through `normalizeCompendiumData` so callers can keep
 * mixed camelCase / snake_case input, and the `tagIds` → `tags`
 * remap is applied per-row.
 */
export async function upsertFeatBatch(entries: { id: string | null, data: Record<string, any> }[]) {
  const normalizedEntries = entries.map((entry) => {
    const normalized = normalizeCompendiumData(entry.data);
    // The feats table column is `tags`, not `tag_ids` — the same
    // translation upsertFeature does explicitly. Editors and the
    // import workbench both pass `tagIds` for cross-entity
    // consistency, so translate here to dodge "no such column: tag_ids".
    if (normalized.tagIds !== undefined) {
      normalized.tags = normalized.tagIds;
      delete normalized.tagIds;
    }
    return { id: entry.id, data: normalized };
  });
  return upsertDocumentBatch('feats', normalizedEntries);
}

/**
 * Spells specialized helpers
 */

/**
 * Compute the four filter-bucket facets from a spell's `foundry_data`
 * payload (the spells row's Foundry `system` blob — note: stored
 * directly, not under a `.system` wrapper). Mirrors the bucketers in
 * src/lib/spellFilters.ts so the materialised columns and the live
 * filter UI agree on what each bucket means.
 *
 * Returns the four bucket values as strings ready to splice into the
 * D1 row. Returns nulls when foundry_data is missing — the read path
 * (`deriveSpellFilterFacets`) falls back to parsing foundry_data on
 * the fly when the columns are null, so a missing payload doesn't
 * make a row unfilterable.
 */
function computeSpellBuckets(foundryData: any): {
  activation_bucket: string | null;
  range_bucket: string | null;
  duration_bucket: string | null;
  shape_bucket: string | null;
  // Display-scalar fields. The slim spell summary drops foundry_data
  // entirely, so the column values become the source of truth for
  // SpellList's "60 ft" / "1 action" labels in the Range / Time
  // columns. mapSpellRow reconstructs a faux foundryShell from
  // these so the existing format* helpers keep working unchanged.
  activation_type: string | null;
  activation_value: string | null;
  activation_condition: string | null;
  range_units: string | null;
  range_value: number | null;
  range_special: string | null;
  duration_units: string | null;
  duration_value: string | null;
} {
  const system = (typeof foundryData === 'string')
    ? (() => { try { return JSON.parse(foundryData); } catch { return null; } })()
    : foundryData;
  if (!system) {
    return {
      activation_bucket: null, range_bucket: null, duration_bucket: null, shape_bucket: null,
      activation_type: null, activation_value: null, activation_condition: null,
      range_units: null, range_value: null, range_special: null,
      duration_units: null, duration_value: null,
    };
  }

  // Activation
  const actType = String(system?.activation?.type ?? '').trim();
  const activation_bucket =
    ['action', 'bonus', 'reaction', 'minute', 'hour'].includes(actType) ? actType : 'special';

  // Range
  const rUnits = String(system?.range?.units ?? '').trim();
  const rValue = Number(system?.range?.value ?? 0);
  let range_bucket: string;
  if (rUnits === 'self') range_bucket = 'self';
  else if (rUnits === 'touch') range_bucket = 'touch';
  else if (rUnits === 'ft') {
    if (rValue <= 5) range_bucket = '5ft';
    else if (rValue <= 30) range_bucket = '30ft';
    else if (rValue <= 60) range_bucket = '60ft';
    else if (rValue <= 120) range_bucket = '120ft';
    else range_bucket = 'long';
  }
  else if (['mi', 'any', 'unlimited'].includes(rUnits)) range_bucket = 'long';
  else range_bucket = 'other';

  // Duration
  const dUnits = String(system?.duration?.units ?? '').trim();
  const duration_bucket =
    ['inst', 'round', 'minute', 'hour', 'day', 'perm'].includes(dUnits) ? dUnits : 'special';

  // Shape
  const sType = String(system?.target?.template?.type ?? '').trim();
  const shape_bucket =
    ['cone', 'cube', 'cylinder', 'line', 'radius', 'sphere', 'square', 'wall'].includes(sType) ? sType : 'none';

  // Display scalars — preserve the raw input as written by the editor
  // / importer so format* helpers can reconstruct labels without
  // foundry_data. Numbers stored as REAL (range_value) so the column
  // sorts naturally on D1; other fields stored as their original
  // strings (Foundry sometimes carries "1" not 1 for activation
  // value etc., so coerce-to-string is the safe round-trip).
  const stringOrNull = (v: any): string | null => {
    if (v === null || v === undefined || v === '') return null;
    return String(v);
  };
  const numberOrNull = (v: any): number | null => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  return {
    activation_bucket, range_bucket, duration_bucket, shape_bucket,
    activation_type:      stringOrNull(system?.activation?.type),
    activation_value:     stringOrNull(system?.activation?.value),
    activation_condition: stringOrNull(system?.activation?.condition),
    range_units:          stringOrNull(system?.range?.units),
    range_value:          numberOrNull(system?.range?.value),
    range_special:        stringOrNull(system?.range?.special),
    duration_units:       stringOrNull(system?.duration?.units),
    duration_value:       stringOrNull(system?.duration?.value),
  };
}

/**
 * Read foundry_data off a normalized spell payload regardless of
 * which property name the caller used. The editor sometimes carries
 * it as camelCased `foundryData`, the importer + d1 layer as snake
 * `foundry_data`. Either is fine — we look at both.
 */
function readFoundryDataField(normalized: Record<string, any>): any {
  return normalized.foundry_data ?? normalized.foundryData ?? null;
}

/**
 * Take an editor's raw camelCase + nested form payload and produce
 * the snake_case + flat shape D1 expects, plus the four filter-bucket
 * scalar columns. Pulled out of `upsertSpell` so the content-proposals
 * flow can call it before queueing a draft — the proposal endpoint's
 * `sanitizePayload` only keeps keys that match the writable column
 * allowlist, so we MUST normalize before crossing the API boundary or
 * half the spell's fields get silently dropped.
 *
 * Steps:
 *   1. `normalizeCompendiumData` — flatten `components.*` / `uses.*` /
 *      `prerequisites.*` and camelCase → snake_case the column-name
 *      keys.
 *   2. Rename `tagIds` → `tags` (the spells column uses `tags`, not
 *      `tag_ids` like classes / subclasses).
 *   3. Materialise the four filter-bucket columns
 *      (activation_bucket / range_bucket / duration_bucket /
 *      shape_bucket) from the Foundry payload so the summary view's
 *      filter chips stay in lockstep.
 *
 * Pure — no DB writes, no side effects. Safe to call repeatedly on
 * the same data.
 */
export function prepareSpellPayloadForWrite(
  data: Record<string, any>,
): Record<string, any> {
  const normalized = normalizeCompendiumData(data);
  if (normalized.tagIds !== undefined) {
    normalized.tags = normalized.tagIds;
    delete normalized.tagIds;
  }
  const buckets = computeSpellBuckets(readFoundryDataField(normalized));
  Object.assign(normalized, buckets);
  return normalized;
}

export async function upsertSpell(
  id: string,
  data: Record<string, any>,
  options: { skipRuleRecompute?: boolean } = {},
) {
  const normalized = prepareSpellPayloadForWrite(data);

  const result = await upsertDocument('spells', id, normalized);

  // Tag-driven recompute: a spell save can flip which rules now
  // include/exclude this spell (tag change, level change, school
  // change). Walk every class-applied rule and update the matching
  // No post-save recompute needed in the resolver world — the next
  // read of any consumer's spell list goes through
  // `getCachedOrCompute`, which re-evaluates rule contributions
  // against the fresh spell row. The `skipRuleRecompute` option on
  // the input shape is left as a no-op for callers that still pass
  // it; remove it in a follow-up sweep once nothing references it.

  return result;
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
 *
 * Deliberately does NOT call `recomputeAppliedRulesForSpell` per
 * entry — a bulk import of 500 spells would fan out to thousands of
 * D1 round-trips. Callers that need the rule-driven slice refreshed
 * after a batch should call `rebuildClassSpellListFromAppliedRules`
 * once per affected class (or trigger a manual "Rebuild Stale" from
 * the SpellListManager UI). The SpellListManager's stale-detection
 * indicator catches this case automatically: every batched edit
 * bumps the affected spells' `updated_at`, so any class whose
 * applied rules cover changed spells will mark stale until
 * rebuilt.
 */
export async function upsertSpellBatch(entries: { id: string | null, data: Record<string, any> }[]) {
  // Same prep as upsertSpell — normalize column names, rename tagIds,
  // materialise the four filter-bucket scalar columns. Foundry imports
  // (which use this batch path) MUST populate the bucket columns or
  // the imported spells won't show in filtered list views.
  const normalizedEntries = entries.map((entry) => ({
    id: entry.id,
    data: prepareSpellPayloadForWrite(entry.data),
  }));
  return upsertDocumentBatch('spells', normalizedEntries);
}

/**
 * Features specialized helpers
 */
/**
 * Editor (camelCase) → DB (snake_case) shape for a single feature row,
 * WITHOUT writing it. Extracted from `upsertFeature` so proposal-aware
 * editors can queue the *same* normalized payload through
 * `useProposalAccumulator('feature')`. The generic writer (and the
 * proposal queue) do NOT normalize — they pass the payload straight to
 * `upsertDocument` / `pending_revisions` — so routing the raw camelCase
 * editor shape would write/queue unrecognized columns. Normalizing here
 * keeps the direct-write and proposal paths byte-identical.
 */
export function normalizeFeatureData(data: Record<string, any>): Record<string, any> {
  const normalized = normalizeCompendiumData(data);
  // The features table column is `tags` (not `tag_ids` like classes /
  // subclasses). Editors carry the loaded list as `tagIds` for
  // cross-entity consistency, so translate on the way in to avoid the
  // "no such column: tagIds" error.
  if (normalized.tagIds !== undefined) {
    normalized.tags = normalized.tagIds;
    delete normalized.tagIds;
  }
  return normalized;
}

export async function upsertFeature(id: string, data: Record<string, any>) {
  return upsertDocument('features', id, normalizeFeatureData(data));
}

export async function fetchFeature(id: string) {
  const row = await fetchDocument<any>('features', id);
  return denormalizeCompendiumData(row);
}

export async function deleteFeature(id: string) {
  return deleteDocument('features', id);
}

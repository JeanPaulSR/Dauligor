/**
 * Shared utility for rebuilding character state from SQL results.
 * This logic is used by both the client (CharacterBuilder/Export) and the server (Pairing API).
 */
import { denormalizeClassRow, denormalizeSubclassRow } from "./classExport";

function parseLoadoutMembership(raw: any): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function rebuildCharacterFromSql(
  baseRow: any,
  progressionRows: any[] = [],
  selectionRows: any[] = [],
  inventoryRows: any[] = [],
  spellRows: any[] = [],
  proficiencyRows: any[] = [],
  spellListExtensionRows: any[] = [],
  spellLoadoutRows: any[] = []
) {
  if (!baseRow) return null;

  // Parse JSON columns
  const stats = typeof baseRow.stats_json === 'string' ? JSON.parse(baseRow.stats_json) : (baseRow.stats_json || {});
  const info = typeof baseRow.info_json === 'string' ? JSON.parse(baseRow.info_json) : (baseRow.info_json || {});
  const senses = typeof baseRow.senses_json === 'string' ? JSON.parse(baseRow.senses_json) : (baseRow.senses_json || {});
  const metadata = typeof baseRow.metadata_json === 'string' ? JSON.parse(baseRow.metadata_json) : (baseRow.metadata_json || {});

  // Reconstruct arrays from proficiencies
  const savingThrows: string[] = [];
  const halfProficientSavingThrows: string[] = [];
  const proficientSkills: string[] = [];
  const expertiseSkills: string[] = [];
  const halfProficientSkills: string[] = [];
  const armorProficiencies: string[] = [];
  const weaponProficiencies: string[] = [];
  const toolProficiencies: string[] = [];
  const languages: string[] = [];
  const resistances: string[] = [];
  const immunities: string[] = [];
  const vulnerabilities: string[] = [];

  proficiencyRows.forEach(row => {
    const { entity_id, entity_type, proficiency_level } = row;
    if (entity_type === 'save') {
      if (proficiency_level === 1) savingThrows.push(entity_id);
      else if (proficiency_level === 0.5) halfProficientSavingThrows.push(entity_id);
    } else if (entity_type === 'skill') {
      if (proficiency_level === 1) proficientSkills.push(entity_id);
      else if (proficiency_level === 2) expertiseSkills.push(entity_id);
      else if (proficiency_level === 0.5) halfProficientSkills.push(entity_id);
    } else if (entity_type === 'armor') armorProficiencies.push(entity_id);
    else if (entity_type === 'weapon') weaponProficiencies.push(entity_id);
    else if (entity_type === 'tool') toolProficiencies.push(entity_id);
    else if (entity_type === 'language') languages.push(entity_id);
    else if (entity_type === 'resistance') resistances.push(entity_id);
    else if (entity_type === 'immunity') immunities.push(entity_id);
    else if (entity_type === 'vulnerability') vulnerabilities.push(entity_id);
  });

  // Reconstruct selectedOptions map
  const selectedOptions: Record<string, string[]> = {};
  selectionRows.forEach(row => {
    const key = row.source_scope 
      ? `${row.source_scope}|adv:${row.advancement_id}|level:${row.level}`
      : row.advancement_id;
    const values = typeof row.selected_ids === 'string' ? JSON.parse(row.selected_ids) : (row.selected_ids || []);
    selectedOptions[key] = values;
  });

  // Reconstruct progression
  const progression = progressionRows
    .sort((a, b) => a.level_index - b.level_index)
    .map(row => ({
      classId: row.class_id,
      subclassId: row.subclass_id || "",
      level: row.level_index,
      hpRoll: row.hp_roll || 0
    }));

  // Reconstruct progressionState
  const ownedItems = inventoryRows.map(row => ({
    id: row.item_id,
    quantity: row.quantity || 1,
    isEquipped: row.is_equipped === 1,
    containerId: row.container_id || null,
    customData: typeof row.custom_data === 'string' ? JSON.parse(row.custom_data) : (row.custom_data || {})
  }));

  const ownedSpells = spellRows.map(row => ({
    id: row.spell_id,
    sourceId: row.source_id || null,
    isPrepared: row.is_prepared === 1,
    isAlwaysPrepared: row.is_always_prepared === 1,
    grantedByType: row.granted_by_type || null,
    grantedById: row.granted_by_id || null,
    grantedByAdvancementId: row.granted_by_advancement_id || null,
    countsAsClassId: row.counts_as_class_id || null,
    doesntCountAgainstPrepared: row.doesnt_count_against_prepared === 1,
    doesntCountAgainstKnown: row.doesnt_count_against_known === 1,
    isFavourite: row.is_favourite === 1,
    isWatchlist: row.is_watchlist === 1,
    watchlistNote: row.watchlist_note || '',
    loadoutMembership: parseLoadoutMembership(row.loadout_membership),
  }));

  const spellListExtensions = (spellListExtensionRows || []).map(row => ({
    classId: row.class_id,
    spellId: row.spell_id,
    grantedByType: row.granted_by_type || null,
    grantedById: row.granted_by_id || null,
    grantedByAdvancementId: row.granted_by_advancement_id || null,
  }));

  const spellLoadouts = (spellLoadoutRows || [])
    .slice()
    .sort((a, b) => (Number(a.sort_order || 0) - Number(b.sort_order || 0)))
    .map(row => ({
      id: row.id,
      name: row.name || '',
      size: Number(row.size || 0),
      isActive: row.is_active === 1,
      sortOrder: Number(row.sort_order || 0),
    }));

  // Build the final character object
  return {
    id: baseRow.id,
    userId: baseRow.user_id,
    campaignId: baseRow.campaign_id,
    name: baseRow.name,
    imageUrl: baseRow.image_url,
    raceId: baseRow.race_id,
    backgroundId: baseRow.background_id,
    level: baseRow.level,
    exhaustion: baseRow.exhaustion,
    hasInspiration: baseRow.has_inspiration === 1,
    hp: {
      current: baseRow.current_hp,
      temp: baseRow.temp_hp,
      max: baseRow.max_hp_override
    },
    stats,
    info,
    senses,
    ...metadata, // Spreads bookmarks, overrides, etc.
    savingThrows,
    halfProficientSavingThrows,
    proficientSkills,
    expertiseSkills,
    halfProficientSkills,
    armorProficiencies,
    weaponProficiencies,
    toolProficiencies,
    languages,
    resistances,
    immunities,
    vulnerabilities,
    selectedOptions,
    progression,
    progressionState: {
      ownedItems,
      ownedSpells,
      spellListExtensions,
      spellLoadouts
      // classPackages are built on demand in UI/Export from progression and selectedOptions
    },
    updatedAt: baseRow.updated_at,
    createdAt: baseRow.created_at
  };
}

export function generateCharacterSaveQueries(id: string, character: any) {
  const queries: { sql: string, params?: any[] }[] = [];

  // 1. Base Character
  const metadata = {
    isLevelLocked: !!character.isLevelLocked,
    exhaustion: character.exhaustion || 0,
    hasInspiration: !!character.hasInspiration,
    hitDie: character.hitDie || {},
    spellPoints: character.spellPoints || {},
    ac: character.ac ?? 10,
    initiative: character.initiative ?? 0,
    speed: character.speed ?? 30,
    proficiencyBonus: character.proficiencyBonus ?? 2,
    bookmarks: character.bookmarks || [],
    overriddenSkillAbilities: character.overriddenSkillAbilities || {}
  };

  // ON CONFLICT DO UPDATE: INSERT OR REPLACE would cascade-delete every
  // character_progression / _selections / _inventory / _spells / _proficiencies
  // row before the batch's explicit DELETE+re-INSERT below runs.
  queries.push({
    sql: `INSERT INTO characters (
      id, user_id, campaign_id, name, image_url, race_id, background_id,
      level, exhaustion, has_inspiration, current_hp, temp_hp, max_hp_override,
      stats_json, info_json, senses_json, metadata_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      user_id = excluded.user_id,
      campaign_id = excluded.campaign_id,
      name = excluded.name,
      image_url = excluded.image_url,
      race_id = excluded.race_id,
      background_id = excluded.background_id,
      level = excluded.level,
      exhaustion = excluded.exhaustion,
      has_inspiration = excluded.has_inspiration,
      current_hp = excluded.current_hp,
      temp_hp = excluded.temp_hp,
      max_hp_override = excluded.max_hp_override,
      stats_json = excluded.stats_json,
      info_json = excluded.info_json,
      senses_json = excluded.senses_json,
      metadata_json = excluded.metadata_json,
      updated_at = CURRENT_TIMESTAMP`,
    params: [
      id,
      character.userId,
      character.campaignId || null,
      character.name,
      character.imageUrl || null,
      character.raceId || null,
      character.backgroundId || null,
      character.level || 1,
      character.exhaustion || 0,
      character.hasInspiration ? 1 : 0,
      character.hp?.current ?? 10,
      character.hp?.temp ?? 0,
      character.hp?.max || null,
      JSON.stringify(character.stats || {}),
      JSON.stringify(character.info || {}),
      JSON.stringify(character.senses || {}),
      JSON.stringify(metadata)
    ]
  });

  // Clear related tables before re-inserting (or we could do a more complex diff, but clear/insert is safer for now)
  queries.push({ sql: "DELETE FROM character_progression WHERE character_id = ?", params: [id] });
  queries.push({ sql: "DELETE FROM character_selections WHERE character_id = ?", params: [id] });
  queries.push({ sql: "DELETE FROM character_inventory WHERE character_id = ?", params: [id] });
  queries.push({ sql: "DELETE FROM character_spells WHERE character_id = ?", params: [id] });
  queries.push({ sql: "DELETE FROM character_spell_list_extensions WHERE character_id = ?", params: [id] });
  queries.push({ sql: "DELETE FROM character_spell_loadouts WHERE character_id = ?", params: [id] });
  queries.push({ sql: "DELETE FROM character_proficiencies WHERE character_id = ?", params: [id] });

  // 2. Progression
  (character.progression || []).forEach((entry: any, idx: number) => {
    queries.push({
      sql: "INSERT INTO character_progression (id, character_id, class_id, subclass_id, level_index, hp_roll) VALUES (?, ?, ?, ?, ?, ?)",
      params: [`${id}_p_${idx}`, id, entry.classId, entry.subclassId || null, idx + 1, entry.hpRoll || 0]
    });
  });

  // 3. Selections
  Object.entries(character.selectedOptions || {}).forEach(([key, values]: [string, any], idx) => {
    if (!Array.isArray(values) || values.length === 0) return;
    let scope = null;
    let advId = key;
    let level = 1;
    if (key.includes('|')) {
      const parts = key.split('|');
      scope = parts.filter(p => !p.startsWith('adv:') && !p.startsWith('level:')).join('|');
      const advPart = parts.find(p => p.startsWith('adv:'));
      const levelPart = parts.find(p => p.startsWith('level:'));
      if (advPart) advId = advPart.replace('adv:', '');
      if (levelPart) level = parseInt(levelPart.replace('level:', '')) || 1;
    }
    queries.push({
      sql: "INSERT INTO character_selections (id, character_id, advancement_id, level, selected_ids, source_scope) VALUES (?, ?, ?, ?, ?, ?)",
      params: [`${id}_s_${idx}`, id, advId, level, JSON.stringify(values), scope]
    });
  });

  // 4. Inventory & Spells
  const ps = character.progressionState || {};
  (ps.ownedItems || []).forEach((item: any, idx: number) => {
    queries.push({
      sql: "INSERT INTO character_inventory (id, character_id, item_id, quantity, is_equipped, container_id, custom_data) VALUES (?, ?, ?, ?, ?, ?, ?)",
      params: [`${id}_i_${idx}`, id, item.id || item.entityId, item.quantity || 1, item.isEquipped ? 1 : 0, item.containerId || null, JSON.stringify(item.customData || {})]
    });
  });
  (ps.ownedSpells || []).forEach((spell: any, idx: number) => {
    queries.push({
      sql: `INSERT INTO character_spells (
        id, character_id, spell_id, source_id, is_prepared, is_always_prepared,
        granted_by_type, granted_by_id, granted_by_advancement_id,
        counts_as_class_id, doesnt_count_against_prepared, doesnt_count_against_known,
        is_favourite, is_watchlist, watchlist_note, loadout_membership
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        `${id}_sp_${idx}`,
        id,
        spell.id || spell.entityId,
        spell.sourceId || null,
        spell.isPrepared ? 1 : 0,
        spell.isAlwaysPrepared ? 1 : 0,
        spell.grantedByType || null,
        spell.grantedById || null,
        spell.grantedByAdvancementId || null,
        spell.countsAsClassId || null,
        spell.doesntCountAgainstPrepared ? 1 : 0,
        spell.doesntCountAgainstKnown ? 1 : 0,
        spell.isFavourite ? 1 : 0,
        spell.isWatchlist ? 1 : 0,
        spell.watchlistNote || null,
        JSON.stringify(Array.isArray(spell.loadoutMembership) ? spell.loadoutMembership : []),
      ]
    });
  });
  (ps.spellLoadouts || []).forEach((loadout: any, idx: number) => {
    if (!loadout?.id || !loadout?.name) return;
    queries.push({
      sql: `INSERT INTO character_spell_loadouts (
        id, character_id, name, size, is_active, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      params: [
        loadout.id,
        id,
        loadout.name,
        Number(loadout.size || 0) || 0,
        loadout.isActive ? 1 : 0,
        Number(loadout.sortOrder ?? idx) || idx,
      ]
    });
  });
  (ps.spellListExtensions || []).forEach((ext: any, idx: number) => {
    if (!ext?.classId || !ext?.spellId) return;
    queries.push({
      sql: `INSERT INTO character_spell_list_extensions (
        id, character_id, class_id, spell_id,
        granted_by_type, granted_by_id, granted_by_advancement_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(character_id, class_id, spell_id) DO UPDATE SET
        granted_by_type = excluded.granted_by_type,
        granted_by_id = excluded.granted_by_id,
        granted_by_advancement_id = excluded.granted_by_advancement_id`,
      params: [
        `${id}_ext_${idx}`,
        id,
        ext.classId,
        ext.spellId,
        ext.grantedByType || null,
        ext.grantedById || null,
        ext.grantedByAdvancementId || null,
      ]
    });
  });

  // 5. Proficiencies
  const addProfs = (list: string[], type: string, level: number) => {
    if (!Array.isArray(list)) return;
    list.forEach((entityId, idx) => {
      queries.push({
        sql: "INSERT INTO character_proficiencies (id, character_id, entity_id, entity_type, proficiency_level) VALUES (?, ?, ?, ?, ?)",
        params: [`${id}_prof_${type}_${idx}`, id, entityId, type, level]
      });
    });
  };

  addProfs(character.savingThrows, 'save', 1);
  addProfs(character.halfProficientSavingThrows, 'save', 0.5);
  addProfs(character.expertiseSavingThrows, 'save', 2);
  addProfs(character.proficientSkills, 'skill', 1);
  addProfs(character.expertiseSkills, 'skill', 2);
  addProfs(character.halfProficientSkills, 'skill', 0.5);
  addProfs(character.armorProficiencies, 'armor', 1);
  addProfs(character.weaponProficiencies, 'weapon', 1);
  addProfs(character.toolProficiencies, 'tool', 1);
  addProfs(character.languages, 'language', 1);
  addProfs(character.resistances, 'resistance', 1);
  addProfs(character.immunities, 'immunity', 1);
  addProfs(character.vulnerabilities, 'vulnerability', 1);

  return queries;
}

/**
 * Builds a Foundry VTT compatible export object for a character.
 * Generic enough to run on client or server by providing the query function.
 */
export async function buildCharacterExport(
  characterId: string,
  queryFn: <T>(sql: string, params?: any[]) => Promise<T[]>
) {
  const [baseRows, progressionRows, selectionRows, inventoryRows, spellRows, proficiencyRows, extensionRows, loadoutRows] = await Promise.all([
    queryFn<any>("SELECT * FROM characters WHERE id = ?", [characterId]),
    queryFn<any>("SELECT * FROM character_progression WHERE character_id = ? ORDER BY level_index ASC", [characterId]),
    queryFn<any>("SELECT * FROM character_selections WHERE character_id = ?", [characterId]),
    queryFn<any>("SELECT * FROM character_inventory WHERE character_id = ?", [characterId]),
    queryFn<any>("SELECT * FROM character_spells WHERE character_id = ?", [characterId]),
    queryFn<any>("SELECT * FROM character_proficiencies WHERE character_id = ?", [characterId]),
    queryFn<any>("SELECT * FROM character_spell_list_extensions WHERE character_id = ?", [characterId]),
    queryFn<any>("SELECT * FROM character_spell_loadouts WHERE character_id = ?", [characterId])
  ]);

  if (!baseRows || baseRows.length === 0) return null;

  const charData = rebuildCharacterFromSql(
    baseRows[0],
    progressionRows,
    selectionRows,
    inventoryRows,
    spellRows,
    proficiencyRows,
    extensionRows,
    loadoutRows
  );

  if (!charData) return null;

  const progression = charData.progression || [];
  const classIds = uniqueStrings(progression.map((p: any) => p.classId));
  const subclassIds = uniqueStrings(progression.map((p: any) => p.subclassId).filter(Boolean));

  // Fetch documents for classes and subclasses
  const [classRows, subclassRows] = await Promise.all([
    classIds.length > 0 
      ? queryFn<any>(`SELECT * FROM classes WHERE id IN (${classIds.map(() => "?").join(",")})`, classIds)
      : Promise.resolve([]),
    subclassIds.length > 0
      ? queryFn<any>(`SELECT * FROM subclasses WHERE id IN (${subclassIds.map(() => "?").join(",")})`, subclassIds)
      : Promise.resolve([])
  ]);

  // D1 rows are snake_case with JSON columns as strings; the export code below
  // reads camelCase fields and expects parsed JSON (`hitDie`, `imageUrl`,
  // `spellcasting`, `advancements`, `primaryAbility`, etc.). Run every row
  // through the canonical denormalizers so the actor shape is correct.
  const classDocsById = Object.fromEntries(classRows.map(r => [r.id, denormalizeClassRow(r)]));
  const subclassDocsById = Object.fromEntries(subclassRows.map(r => [r.id, denormalizeSubclassRow(r)]));

  // Shared Logic Imports (assumed available in scope or via imports)
  const {
    getHpExportState,
    buildProgressionClassGroups,
    getProficiencyBonusForLevel,
    getTotalCharacterLevel,
    normalizeAdvancementList,
    buildSelectedOptionsMapFromClassPackages,
    buildAbilityRoot,
    buildSkillRoot,
    normalizeSpellcastingForExport,
    normalizePrimaryAbilityValue,
    buildFeatureItemFromOwnedFeature,
    buildOptionFeatItem,
    mapTraitSelectionToSemantic,
    trimString,
    slugify
  } = await import("./characterLogic");

  const hpState = getHpExportState(charData);
  const progressionGroups = buildProgressionClassGroups(progression, classDocsById, subclassDocsById);
  const totalLevel = getTotalCharacterLevel(progression, progressionGroups, charData.level);
  const proficiencyBonus = getProficiencyBonusForLevel(totalLevel);

  const items: any[] = [];
  const progressionState = charData.progressionState || { classPackages: [], ownedFeatures: [], ownedItems: [] };
  const classPackages = progressionState.classPackages || [];

  progressionGroups.forEach((group: any) => {
    const classDoc = group.classDocument;
    if (!classDoc) return;

    const classPackage = classPackages.find((pkg: any) => pkg.classId === group.classId);
    const selectionMap = Object.fromEntries(
      (classPackage?.advancementSelections || []).map((s: any) => [s.key, s.selectedIds])
    );

    const hitDieFaces = Number(classDoc.hitDie) || 8;
    const classAdvancements = normalizeAdvancementList(classDoc.advancements || [], hitDieFaces).map((adv: any) => {
      // Basic selection mapping (simplified for shared logic)
      // In a real scenario, this would use getSelectionsForAdvancement from characterLogic
      return adv; 
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
          denomination: String(hitDieFaces),
        },
        spellcasting: normalizeSpellcastingForExport(classDoc.spellcasting, 1),
        primaryAbility: {
          value: normalizePrimaryAbilityValue(classDoc.primaryAbility),
        },
        advancement: classAdvancements,
      },
      flags: {
        "dauligor-pairing": {
          sourceId: classPackage?.classSourceId || `class-${classDoc.id}`,
        },
      },
    });

    const subclassId = group.subclassId;
    if (subclassId && subclassDocsById[subclassId]) {
      const subclassDoc = subclassDocsById[subclassId];
      items.push({
        name: subclassDoc.name,
        type: "subclass",
        img: subclassDoc.imageUrl || "icons/svg/item-bag.svg",
        system: {
          identifier: trimString(subclassDoc.identifier) || slugify(subclassDoc.name),
          classIdentifier: trimString(classDoc.identifier) || slugify(classDoc.name),
          spellcasting: normalizeSpellcastingForExport(subclassDoc.spellcasting, 3),
          advancement: normalizeAdvancementList(subclassDoc.advancements || [], hitDieFaces),
        },
        flags: {
          "dauligor-pairing": {
            sourceId: classPackage?.subclassSourceId || `subclass-${subclassDoc.id}`,
          },
        },
      });
    }
  });

  (progressionState.ownedFeatures || []).forEach((entry: any) => {
    items.push(buildFeatureItemFromOwnedFeature(entry));
  });

  // Spells — fetch the referenced spell rows once and build a Foundry
  // `type: "spell"` item per ownedSpell, layering the per-character state
  // (preparation, attribution, loadout membership, favorite/watchlist) over
  // the spell's native shape from the compendium.
  const ownedSpells: any[] = progressionState.ownedSpells || [];
  const spellListExtensions: any[] = progressionState.spellListExtensions || [];
  const spellLoadouts: any[] = progressionState.spellLoadouts || [];
  const ownedSpellIds = uniqueStrings(ownedSpells.map((s: any) => s.id));
  const spellContentRows = ownedSpellIds.length > 0
    ? await queryFn<any>(
        `SELECT * FROM spells WHERE id IN (${ownedSpellIds.map(() => '?').join(',')})`,
        ownedSpellIds
      )
    : [];
  const spellsById = Object.fromEntries(spellContentRows.map((row: any) => [row.id, row]));

  // Active loadouts drive effective prepared (union with is_prepared and
  // is_always_prepared). Per the spellbook handoff, this matches
  // `effectivePreparedSet` in CharacterBuilder.
  const activeLoadoutIds = new Set(
    spellLoadouts.filter((l: any) => l.isActive).map((l: any) => l.id)
  );

  // Primary spellcasting class falls back here when ownedSpell.countsAsClassId
  // is null. Uses the first progression class with a non-"none" spellcasting
  // progression. Multi-class characters can still override per-spell via
  // `countsAsClassId`.
  const primaryClassIdentifier = (() => {
    for (const group of progressionGroups) {
      const classDoc = group.classDocument;
      const progression = classDoc?.spellcasting?.progression;
      if (classDoc && progression && progression !== 'none') {
        return trimString(classDoc.identifier) || slugify(classDoc.name) || '';
      }
    }
    return '';
  })();

  const parseJsonColumn = <T,>(raw: any, fallback: T): T => {
    if (raw == null) return fallback;
    if (typeof raw !== 'string') return raw as T;
    try { return JSON.parse(raw) as T; } catch { return fallback; }
  };

  for (const owned of ownedSpells) {
    const spell = spellsById[owned.id];
    // Stub-favourites have an entry on character_spells but the spell row
    // may have been deleted from the compendium since. Skip rather than
    // ship a broken item.
    if (!spell) continue;

    const foundrySystem: any = parseJsonColumn<any>(spell.foundry_data, {});
    const ownerClassDoc = owned.countsAsClassId ? classDocsById[owned.countsAsClassId] : null;
    const classIdentifier = trimString(ownerClassDoc?.identifier)
      || (ownerClassDoc?.name ? slugify(ownerClassDoc.name) : '')
      || primaryClassIdentifier;
    const classSourceId = ownerClassDoc
      ? `class-${trimString(ownerClassDoc.identifier) || slugify(ownerClassDoc.name)}`
      : null;

    // listType per actor-spell-flag-schema.md.
    // (Distinguishing "known" from "prepared" by the class's spellcasting
    // method is left for the module to refine — this branch picks the safer
    // default until the prepared/known semantics get a dedicated pass.)
    let listType: 'prepared' | 'known' | 'always-prepared' | 'expanded' | 'innate' = 'prepared';
    if (owned.isAlwaysPrepared) listType = 'always-prepared';
    else if (owned.doesntCountAgainstKnown) listType = 'innate';
    else if (owned.grantedByType === 'extension') listType = 'expanded';

    // dnd5e preparation.mode = "always" for both inherently-always-prepared
    // and "doesn't count against prepared" (free-prepared) — Foundry has no
    // native concept for the latter, "always" is the closest match.
    const prepMode = (owned.isAlwaysPrepared || owned.doesntCountAgainstPrepared)
      ? 'always'
      : 'prepared';
    const memberOfActiveLoadout = (owned.loadoutMembership || []).some((id: string) => activeLoadoutIds.has(id));
    const prepared = !!(owned.isAlwaysPrepared || owned.isPrepared || memberOfActiveLoadout);

    const properties = Array.isArray(foundrySystem.properties)
      ? foundrySystem.properties.map(String)
      : [];

    items.push({
      name: spell.name || `Spell ${owned.id}`,
      type: 'spell',
      img: spell.image_url || foundrySystem.img || 'icons/svg/item-bag.svg',
      system: {
        level: Number(spell.level ?? foundrySystem.level ?? 0) || 0,
        school: trimString(spell.school) || trimString(foundrySystem.school) || '',
        description: {
          value: spell.description || foundrySystem.description?.value || '',
          chat: '',
        },
        activation: foundrySystem.activation || {},
        range: foundrySystem.range || {},
        target: foundrySystem.target || {},
        duration: foundrySystem.duration || {},
        materials: foundrySystem.materials || {
          value: spell.components_material_text || '',
          consumed: Boolean(spell.components_consumed),
          cost: Number(spell.components_cost ?? 0) || 0,
          supply: 0,
        },
        properties,
        preparation: { mode: prepMode, prepared },
        sourceClass: classIdentifier,
        activities: parseJsonColumn<any>(spell.activities, {}),
      },
      effects: parseJsonColumn<any[]>(spell.effects, []),
      flags: {
        'dauligor-pairing': {
          schemaVersion: 1,
          entityKind: 'spell',
          sourceId: spell.identifier ? `spell-${spell.identifier}` : `spell-${owned.id}`,
          entityId: owned.id,
          identifier: trimString(spell.identifier) || null,
          sourceBookId: spell.source_id ? `source-${spell.source_id}` : null,
          classIdentifier,
          classSourceId,
          listType,
          favorite: Boolean(owned.isFavourite),
          tags: parseJsonColumn<string[]>(spell.tags, []),
          importSource: 'dauligor',
          // Layer-2 attribution: who granted this spell (class / feature /
          // feat), driving un-grant on level-down and which class's
          // spellcasting mod and DC apply.
          grantedByType: owned.grantedByType || null,
          grantedById: owned.grantedById || null,
          grantedByAdvancementId: owned.grantedByAdvancementId || null,
          // Layer-3 Phase-4 user metadata.
          watchlist: Boolean(owned.isWatchlist),
          watchlistNote: owned.watchlistNote || '',
          // Layer-4 loadouts. The membership is the union of loadouts this
          // spell belongs to; active loadouts already drove `prepared`
          // above. Module side reconstructs which loadout buttons are
          // checked from this list.
          loadoutMembership: Array.isArray(owned.loadoutMembership) ? owned.loadoutMembership : [],
          // Free-known marker (Foundry has no native concept; the module
          // can choose to display this differently — e.g. exempt from
          // spells-known caps in its UI).
          freeKnown: Boolean(owned.doesntCountAgainstKnown),
          // Free-prepared marker — informational (preparation.mode="always"
          // already enforces it on the dnd5e side).
          freePrepared: Boolean(owned.doesntCountAgainstPrepared),
        },
      },
    });
  }

  const selectedOptions = buildSelectedOptionsMapFromClassPackages(classPackages);

  return {
    kind: "dauligor.actor-bundle.v1",
    schemaVersion: 1,
    source: {
      system: "dauligor",
      entity: "actor",
      id: charData.id,
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
            value: hpState.current,
            ...(hpState.max != null ? { max: hpState.max } : {}),
            temp: hpState.temp,
          },
          ac: { flat: Number(charData.ac ?? 10) || 10, calc: "flat" },
          init: { bonus: Number(charData.initiative ?? 0) || 0 },
          movement: { walk: Number(charData.speed ?? 30) || 30, units: "ft" },
          prof: proficiencyBonus,
          exhaustion: Number(charData.exhaustion ?? 0) || 0,
        },
        details: {
          alignment: trimString(charData.info?.alignment),
          race: trimString(charData.raceId),
          background: trimString(charData.backgroundId),
          biography: { value: "" }, // Simplified for now
        },
        skills: buildSkillRoot(charData),
        traits: {
          size: trimString(charData.raceData?.size || "Medium").toLowerCase().substring(0, 3),
          languages: { value: charData.languages || [] },
          dr: { value: charData.resistances || [] },
          di: { value: charData.immunities || [] },
          dv: { value: charData.vulnerabilities || [] },
        },
      },
      flags: {
        "dauligor-pairing": {
          sourceId: `character-${charData.id}`,
          sourceType: "actor",
          campaignId: trimString(charData.campaignId),
          selectedOptions,
          // Per-character class-spell-list adjustments — extends a class's
          // available pool for THIS character only. Keyed by classId so the
          // module can scope each entry to the matching actor class item.
          spellListExtensions: spellListExtensions.map((ext: any) => ({
            classId: ext.classId,
            spellId: ext.spellId,
            grantedByType: ext.grantedByType || null,
            grantedById: ext.grantedById || null,
            grantedByAdvancementId: ext.grantedByAdvancementId || null,
          })),
          // Sized, multi-active spell loadouts. Membership is on each
          // spell item's flag (`loadoutMembership`); active loadouts
          // already drove the spell items' `system.preparation.prepared`
          // above. The list here lets the module reconstruct loadout UI
          // (size caps + active toggle) without re-deriving from spells.
          spellLoadouts: spellLoadouts.map((l: any) => ({
            id: l.id,
            name: l.name,
            size: Number(l.size ?? 0) || 0,
            isActive: Boolean(l.isActive),
            sortOrder: Number(l.sortOrder ?? 0) || 0,
          })),
        },
      },
    },
    items,
  };
}

function uniqueStrings(arr: any[]) {
  return Array.from(new Set((arr || []).map(s => String(s).trim()).filter(Boolean)));
}

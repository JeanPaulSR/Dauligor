// Server copy of the two pure helpers from `src/lib/characterShared.ts`.
// Kept here (not imported from src/) because Vercel bundles `api/` separately
// from `src/` — see `memory/project_vercel_module_endpoint.md` for the
// original /api/module gotcha that established this convention.
//
// Functions copied:
//   - rebuildCharacterFromSql — takes the 8 row-sets from the character_*
//     tables, returns a structured character object.
//   - generateCharacterSaveQueries — takes a character object, returns the
//     batched INSERT/DELETE statements that persist it.
//
// Both are pure (no module-level state, no external imports beyond standard
// JSON.parse / JSON.stringify) — they can be diffed against the client copy
// for parity without worrying about runtime drift. If you change either side,
// update both. The client copy will go away once every consumer has migrated
// off the raw SQL helpers.

function parseLoadoutMembership(raw: any): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === "string") {
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
  spellLoadoutRows: any[] = [],
) {
  if (!baseRow) return null;

  // Parse JSON columns
  const stats = typeof baseRow.stats_json === "string" ? JSON.parse(baseRow.stats_json) : baseRow.stats_json || {};
  const info = typeof baseRow.info_json === "string" ? JSON.parse(baseRow.info_json) : baseRow.info_json || {};
  const senses = typeof baseRow.senses_json === "string" ? JSON.parse(baseRow.senses_json) : baseRow.senses_json || {};
  const metadata = typeof baseRow.metadata_json === "string" ? JSON.parse(baseRow.metadata_json) : baseRow.metadata_json || {};

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

  proficiencyRows.forEach((row) => {
    const { entity_id, entity_type, proficiency_level } = row;
    if (entity_type === "save") {
      if (proficiency_level === 1) savingThrows.push(entity_id);
      else if (proficiency_level === 0.5) halfProficientSavingThrows.push(entity_id);
    } else if (entity_type === "skill") {
      if (proficiency_level === 1) proficientSkills.push(entity_id);
      else if (proficiency_level === 2) expertiseSkills.push(entity_id);
      else if (proficiency_level === 0.5) halfProficientSkills.push(entity_id);
    } else if (entity_type === "armor") armorProficiencies.push(entity_id);
    else if (entity_type === "weapon") weaponProficiencies.push(entity_id);
    else if (entity_type === "tool") toolProficiencies.push(entity_id);
    else if (entity_type === "language") languages.push(entity_id);
    else if (entity_type === "resistance") resistances.push(entity_id);
    else if (entity_type === "immunity") immunities.push(entity_id);
    else if (entity_type === "vulnerability") vulnerabilities.push(entity_id);
  });

  // Reconstruct selectedOptions map
  const selectedOptions: Record<string, string[]> = {};
  selectionRows.forEach((row) => {
    const key = row.source_scope
      ? `${row.source_scope}|adv:${row.advancement_id}|level:${row.level}`
      : row.advancement_id;
    const values = typeof row.selected_ids === "string" ? JSON.parse(row.selected_ids) : row.selected_ids || [];
    selectedOptions[key] = values;
  });

  const progression = progressionRows
    .slice()
    .sort((a, b) => a.level_index - b.level_index)
    .map((row) => ({
      classId: row.class_id,
      subclassId: row.subclass_id || "",
      level: row.level_index,
      hpRoll: row.hp_roll || 0,
    }));

  const ownedItems = inventoryRows.map((row) => ({
    id: row.item_id,
    quantity: row.quantity || 1,
    isEquipped: row.is_equipped === 1,
    containerId: row.container_id || null,
    customData: typeof row.custom_data === "string" ? JSON.parse(row.custom_data) : row.custom_data || {},
  }));

  const ownedSpells = spellRows.map((row) => ({
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
    watchlistNote: row.watchlist_note || "",
    loadoutMembership: parseLoadoutMembership(row.loadout_membership),
  }));

  const spellListExtensions = (spellListExtensionRows || []).map((row) => ({
    classId: row.class_id,
    spellId: row.spell_id,
    grantedByType: row.granted_by_type || null,
    grantedById: row.granted_by_id || null,
    grantedByAdvancementId: row.granted_by_advancement_id || null,
  }));

  const spellLoadouts = (spellLoadoutRows || [])
    .slice()
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
    .map((row) => ({
      id: row.id,
      name: row.name || "",
      size: Number(row.size || 0),
      isActive: row.is_active === 1,
      sortOrder: Number(row.sort_order || 0),
    }));

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
      max: baseRow.max_hp_override,
    },
    stats,
    info,
    senses,
    ...metadata,
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
      spellLoadouts,
    },
    updatedAt: baseRow.updated_at,
    createdAt: baseRow.created_at,
  };
}

export function generateCharacterSaveQueries(id: string, character: any) {
  const queries: { sql: string; params?: any[] }[] = [];

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
    overriddenSkillAbilities: character.overriddenSkillAbilities || {},
  };

  // ON CONFLICT DO UPDATE — never INSERT OR REPLACE, that cascades the FK
  // children before the explicit DELETE+INSERT pass below runs. See
  // memory/project_d1_upsert_idiom.md.
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
      JSON.stringify(metadata),
    ],
  });

  queries.push({ sql: "DELETE FROM character_progression WHERE character_id = ?", params: [id] });
  queries.push({ sql: "DELETE FROM character_selections WHERE character_id = ?", params: [id] });
  queries.push({ sql: "DELETE FROM character_inventory WHERE character_id = ?", params: [id] });
  queries.push({ sql: "DELETE FROM character_spells WHERE character_id = ?", params: [id] });
  queries.push({ sql: "DELETE FROM character_spell_list_extensions WHERE character_id = ?", params: [id] });
  queries.push({ sql: "DELETE FROM character_spell_loadouts WHERE character_id = ?", params: [id] });
  queries.push({ sql: "DELETE FROM character_proficiencies WHERE character_id = ?", params: [id] });

  (character.progression || []).forEach((entry: any, idx: number) => {
    queries.push({
      sql: "INSERT INTO character_progression (id, character_id, class_id, subclass_id, level_index, hp_roll) VALUES (?, ?, ?, ?, ?, ?)",
      params: [`${id}_p_${idx}`, id, entry.classId, entry.subclassId || null, idx + 1, entry.hpRoll || 0],
    });
  });

  Object.entries(character.selectedOptions || {}).forEach(([key, values]: [string, any], idx) => {
    if (!Array.isArray(values) || values.length === 0) return;
    let scope: string | null = null;
    let advId = key;
    let level = 1;
    if (key.includes("|")) {
      const parts = key.split("|");
      scope = parts.filter((p) => !p.startsWith("adv:") && !p.startsWith("level:")).join("|");
      const advPart = parts.find((p) => p.startsWith("adv:"));
      const levelPart = parts.find((p) => p.startsWith("level:"));
      if (advPart) advId = advPart.replace("adv:", "");
      if (levelPart) level = parseInt(levelPart.replace("level:", ""), 10) || 1;
    }
    queries.push({
      sql: "INSERT INTO character_selections (id, character_id, advancement_id, level, selected_ids, source_scope) VALUES (?, ?, ?, ?, ?, ?)",
      params: [`${id}_s_${idx}`, id, advId, level, JSON.stringify(values), scope],
    });
  });

  const ps = character.progressionState || {};
  (ps.ownedItems || []).forEach((item: any, idx: number) => {
    queries.push({
      sql: "INSERT INTO character_inventory (id, character_id, item_id, quantity, is_equipped, container_id, custom_data) VALUES (?, ?, ?, ?, ?, ?, ?)",
      params: [
        `${id}_i_${idx}`,
        id,
        item.id || item.entityId,
        item.quantity || 1,
        item.isEquipped ? 1 : 0,
        item.containerId || null,
        JSON.stringify(item.customData || {}),
      ],
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
      ],
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
      ],
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
      ],
    });
  });

  const addProfs = (list: string[] | undefined, type: string, level: number) => {
    if (!Array.isArray(list)) return;
    list.forEach((entityId, idx) => {
      queries.push({
        sql: "INSERT INTO character_proficiencies (id, character_id, entity_id, entity_type, proficiency_level) VALUES (?, ?, ?, ?, ?)",
        params: [`${id}_prof_${type}_${idx}`, id, entityId, type, level],
      });
    });
  };

  addProfs(character.savingThrows, "save", 1);
  addProfs(character.halfProficientSavingThrows, "save", 0.5);
  addProfs(character.expertiseSavingThrows, "save", 2);
  addProfs(character.proficientSkills, "skill", 1);
  addProfs(character.expertiseSkills, "skill", 2);
  addProfs(character.halfProficientSkills, "skill", 0.5);
  addProfs(character.armorProficiencies, "armor", 1);
  addProfs(character.weaponProficiencies, "weapon", 1);
  addProfs(character.toolProficiencies, "tool", 1);
  addProfs(character.languages, "language", 1);
  addProfs(character.resistances, "resistance", 1);
  addProfs(character.immunities, "immunity", 1);
  addProfs(character.vulnerabilities, "vulnerability", 1);

  return queries;
}

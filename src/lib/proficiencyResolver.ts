/**
 * Proficiency resolver — Dauligor character_proficiencies → item proficiency badge.
 *
 * The polymorphic `character_proficiencies` table holds rows whose
 * `entity_type` discriminator says what the row's `entity_id` points at
 * (a specific weapon, a whole weapon_category, a weapon_property, an
 * armor row, etc.). When the character sheet renders an item it asks
 * this library: is this character proficient with this thing, and at
 * what level?
 *
 * The walk is hierarchical and the first match wins, ordered most-
 * specific to broadest:
 *   1. SPECIFIC          — character_proficiencies WHERE entity_type='weapon|armor|tool' AND entity_id=<base FK>
 *   2. CATEGORY          — WHERE entity_type='weapon_category|armor_category|tool_category' AND entity_id=<base.category_id>
 *                          For weapon_category rows, weapon_type_filter (NULL | 'Melee' | 'Ranged') must
 *                          either be NULL ("both") or match the weapon's weapon_type — this is what
 *                          differentiates "Simple Weapons" from "Simple Melee Weapons".
 *   3. PROPERTY          — WHERE entity_type='weapon_property' AND entity_id IN (base.property_ids)
 *                          Rare in 5e ("proficient with finesse weapons") but supported.
 *
 * Proficiency level is the polymorphic row's `proficiency_level`:
 *     0.5 = half (Jack of All Trades style)
 *     1   = full
 *     2   = expertise
 * The character sheet multiplies the character's proficiency bonus by
 * this when scoring attack/check rolls against the item.
 *
 * This module is intentionally a pure read-side library — caller supplies
 * the rows; resolver runs the match logic. The fetch side (joining items
 * + base_*_id + character_proficiencies) lives in the consumer page or
 * an /api endpoint, not here. That keeps the resolver testable and
 * independent of whether the caller is on Pages Functions or the SPA.
 *
 * Added 2026-05-26 alongside migration 20260526-1700 (which introduced
 * the `weapon_type_filter` + polymorphic source columns). The character
 * sheet doesn't consume this yet — it lands ready for C6's items editor
 * to surface a "[Proficient]" badge inline, and for the character sheet
 * rewrite to use as its source of truth.
 */

// ─── Row shapes ─────────────────────────────────────────────────────

export type CharacterProficiencyRow = {
  id: string;
  character_id: string;
  entity_id: string;
  // Open string so callers can pass through skill/save/etc. rows without
  // friction — the resolver only matches against the weapon/armor/tool
  // discriminators below.
  entity_type: string;
  proficiency_level: number;
  // 20260526-1700 columns. Optional so callers passing legacy rows
  // (pre-migration data) don't blow up.
  weapon_type_filter?: string | null;   // 'Melee' | 'Ranged' | null
  source_entity_type?: string | null;
  source_entity_id?: string | null;
};

/** The minimum item shape the resolver needs. The character sheet should
 *  pre-join the base-proficiency row (weapons / armor / tools) so the
 *  resolver doesn't have to do its own SQL — keeps this library pure. */
export type ItemForProficiency = {
  id: string;
  item_type: string;
  base_weapon_id?: string | null;
  base_armor_id?: string | null;
  base_tool_id?: string | null;
  /** Joined from `weapons` table by the caller. */
  baseWeapon?: {
    id: string;
    category_id: string;
    weapon_type: 'Melee' | 'Ranged' | string;
    property_ids?: string[];
  } | null;
  /** Joined from `armor` table by the caller. */
  baseArmor?: {
    id: string;
    category_id: string;
  } | null;
  /** Joined from `tools` table by the caller. */
  baseTool?: {
    id: string;
    category_id: string;
  } | null;
};

export type ProficiencyMatch = {
  /** True iff a row was found with proficiency_level > 0. */
  proficient: boolean;
  /** 0 = not proficient. 0.5 = half. 1 = full. 2 = expertise. */
  proficiencyLevel: 0 | 0.5 | 1 | 2;
  /** Which step of the hierarchy matched, for debugging + tooltip copy. */
  matchedVia: 'specific' | 'category' | 'property' | null;
  /** The entity_id of the matching character_proficiencies row, when one matched. */
  matchedEntityId: string | null;
  /** Polymorphic source attribution: `{type:'class', id:'<fighter-id>'}` etc.
   *  Powers "Granted by Fighter L1" tooltips on the sheet. */
  source: { type: string; id: string } | null;
};

const NO_MATCH: ProficiencyMatch = {
  proficient: false,
  proficiencyLevel: 0,
  matchedVia: null,
  matchedEntityId: null,
  source: null,
};

// ─── Resolver ──────────────────────────────────────────────────────

/**
 * Score an item's proficiency against a character's `character_proficiencies`
 * rows. Returns the highest-priority match (specific > category > property)
 * with proficiency_level > 0, or NO_MATCH.
 *
 * The caller is responsible for filtering `proficiencies` to the
 * relevant character (we don't filter by character_id here — the array
 * passed in should already be scoped).
 */
export function resolveItemProficiency(
  item: ItemForProficiency,
  proficiencies: CharacterProficiencyRow[],
): ProficiencyMatch {
  // ── Weapons ──
  if (item.base_weapon_id && item.baseWeapon) {
    const weapon = item.baseWeapon;

    // 1. SPECIFIC — match on weapons.id directly. Highest priority so a
    // class that grants "Greatsword" specifically beats a category-level
    // grant for the same weapon (the row could carry a higher level).
    const specific = findHighestMatch(proficiencies, (cp) =>
      cp.entity_type === 'weapon' && cp.entity_id === item.base_weapon_id);
    if (specific) return materialize(specific, 'specific');

    // 2. CATEGORY — match on weapons.category_id, honoring weapon_type_filter.
    // NULL filter = grants both Melee + Ranged.
    const category = findHighestMatch(proficiencies, (cp) =>
      cp.entity_type === 'weapon_category'
      && cp.entity_id === weapon.category_id
      && (cp.weapon_type_filter == null || cp.weapon_type_filter === weapon.weapon_type));
    if (category) return materialize(category, 'category');

    // 3. PROPERTY — uncommon path. A class/feat might grant
    // "proficient with all finesse weapons" via this mechanism.
    if (weapon.property_ids?.length) {
      const propertySet = new Set(weapon.property_ids);
      const property = findHighestMatch(proficiencies, (cp) =>
        cp.entity_type === 'weapon_property' && propertySet.has(cp.entity_id));
      if (property) return materialize(property, 'property');
    }

    return NO_MATCH;
  }

  // ── Armor ──
  if (item.base_armor_id && item.baseArmor) {
    const armor = item.baseArmor;

    const specific = findHighestMatch(proficiencies, (cp) =>
      cp.entity_type === 'armor' && cp.entity_id === item.base_armor_id);
    if (specific) return materialize(specific, 'specific');

    // Armor has no melee/ranged dimension — single category match.
    const category = findHighestMatch(proficiencies, (cp) =>
      cp.entity_type === 'armor_category' && cp.entity_id === armor.category_id);
    if (category) return materialize(category, 'category');

    return NO_MATCH;
  }

  // ── Tools ──
  if (item.base_tool_id && item.baseTool) {
    const tool = item.baseTool;

    const specific = findHighestMatch(proficiencies, (cp) =>
      cp.entity_type === 'tool' && cp.entity_id === item.base_tool_id);
    if (specific) return materialize(specific, 'specific');

    const category = findHighestMatch(proficiencies, (cp) =>
      cp.entity_type === 'tool_category' && cp.entity_id === tool.category_id);
    if (category) return materialize(category, 'category');

    return NO_MATCH;
  }

  // Item has no base proficiency association (loot, consumable, generic
  // equipment, container) — proficiency doesn't apply. The character
  // sheet should suppress the badge entirely for these.
  return NO_MATCH;
}

/**
 * Bulk version — resolve every item against the same proficiency set
 * in one pass. Returns a map keyed by item.id.
 */
export function resolveItemProficiencies(
  items: ItemForProficiency[],
  proficiencies: CharacterProficiencyRow[],
): Record<string, ProficiencyMatch> {
  const out: Record<string, ProficiencyMatch> = {};
  for (const item of items) {
    out[item.id] = resolveItemProficiency(item, proficiencies);
  }
  return out;
}

// ─── Internals ──────────────────────────────────────────────────────

/** Walk all rows matching the predicate; return the one with the
 *  HIGHEST proficiency_level (expertise > full > half > none). Returns
 *  undefined if no row matches at all. */
function findHighestMatch(
  rows: CharacterProficiencyRow[],
  pred: (cp: CharacterProficiencyRow) => boolean,
): CharacterProficiencyRow | undefined {
  let best: CharacterProficiencyRow | undefined;
  for (const cp of rows) {
    if (!pred(cp)) continue;
    if (!(cp.proficiency_level > 0)) continue;
    if (!best || cp.proficiency_level > best.proficiency_level) best = cp;
  }
  return best;
}

function materialize(
  cp: CharacterProficiencyRow,
  matchedVia: 'specific' | 'category' | 'property',
): ProficiencyMatch {
  return {
    proficient: true,
    // The schema stores REAL; values come from 0.5 / 1 / 2. Cast for
    // the discriminated union — clamp anything weird to 1.
    proficiencyLevel: (
      cp.proficiency_level === 0.5 ? 0.5
      : cp.proficiency_level === 2 ? 2
      : 1
    ) as 0.5 | 1 | 2,
    matchedVia,
    matchedEntityId: cp.entity_id,
    source: cp.source_entity_type && cp.source_entity_id
      ? { type: cp.source_entity_type, id: cp.source_entity_id }
      : null,
  };
}

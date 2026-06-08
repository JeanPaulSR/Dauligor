// Builder for the full Foundry-ready item document — served by
// `/api/module/items/<dbId>.json`. Mirrors `_featExport.ts` and
// `_spellExport.ts` for the items domain.
//
// Why this exists
// ----------------
// Items have flowed Foundry → app (folder export) for a while, but
// not app → Foundry. Phase B.2 of the non-class scaling track adds
// the forward direction so app-authored items — and crucially their
// `scaling_columns` rows — can land in Foundry with `system.advancement`
// pre-baked. Without this, an item like Amulet of the Devout authored
// in the app would lose its +1 Channel Divinity scaling on round-trip.
//
// Output shape
// ------------
// Matches dnd5e v5 expectations for each `item.type` (weapon /
// equipment / consumable / tool / loot / container). The bundle's
// `item` field is the Foundry-ready document the Foundry-side
// importer hands to `actor.createEmbeddedDocuments("Item", [item])`.
// Per-type system.* blocks vary by `item_type`:
//   - weapon:    damage, range, mastery, magicalBonus, ammunition, proficient
//   - equipment: armor (value/dex/magicalBonus), strength, stealth, proficient
//   - tool:      type.value (tool_type), ability, proficient, bonus
//   - container: capacity
//   - consumable, loot: common-only
// Common fields (description, weight, price, properties, rarity,
// attunement, equipped, identified, activities, effects, source)
// apply to every type.
//
// Scaling synthesis
// -----------------
// Items don't author advancements app-side — the Scaling tab on
// ItemsEditor (Phase A.2) writes directly to `scaling_columns`
// rows. On export we walk those rows, synthesize one `ScaleValue`
// advancement per column, and run each through the shared
// `normalizeScaleValueAdvancement` helper (from `_classExport.ts`)
// to fill in the per-level scale map.
//
// Foundry's dnd5e resolves `@scale.<item.system.identifier>.<column.identifier>`
// natively at play time once these advancements land. No module-side
// runtime hook needed — same mechanism classes already use.

import type { ExportFetchers } from "./_classExport.js";
import {
  getSemanticSourceId,
  denormalizeScalingColumnRow,
  normalizeScaleValueAdvancement,
} from "./_classExport.js";
import { bbcodeToHtml } from "./_bbcode.js";

const parseJsonField = (val: any, fallback: any) => {
  if (val == null) return fallback;
  if (typeof val !== "string") return val;
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
};

const trimString = (val: any) => String(val ?? "").trim();

/**
 * Response payload shape. `item` is the Foundry-ready item document.
 */
export interface ItemDocBundle {
  kind: "dauligor.item-item.v1";
  schemaVersion: 1;
  dbId: string;
  sourceId: string;
  item: {
    name: string;
    type: string;
    img?: string;
    system: Record<string, any>;
    effects: unknown[];
    flags: Record<string, any>;
  };
  generatedAt: number;
}

/**
 * Coerce an `advancement` / `activities` field into the Foundry-shape
 * keyed-object map (`{ "<_id>": Advancement, ... }`). Same convention
 * `_featExport.ts` uses — kept inline (not shared) because the helper
 * is one-liner-grade and the import-time matching is by
 * `flags.dauligor-pairing.sourceId` + name, not these IDs.
 */
function arrayToFoundryMap(entries: any): Record<string, any> {
  if (entries && typeof entries === "object" && !Array.isArray(entries)) {
    return entries as Record<string, any>;
  }
  const list = Array.isArray(entries) ? entries : [];
  const map: Record<string, any> = {};
  for (let i = 0; i < list.length; i++) {
    const entry = list[i] ?? {};
    const id = trimString(entry?._id);
    const key = id || `adv${String(i).padStart(14, "0")}`;
    map[key] = entry;
  }
  return map;
}

/**
 * Synthesize ScaleValue advancements for every `scaling_columns` row
 * owned by the item. Each column produces one advancement; the
 * advancement's `configuration.scalingColumnId` points at the column's
 * PK, so the shared `normalizeScaleValueAdvancement` helper can fill
 * in `scale` / `identifier` / `type` / `distance` from the column's
 * `values` / `type` / `distance_units`.
 *
 * `_id` is derived from the column's PK so the same column always
 * produces the same advancement id across re-exports — important for
 * round-trip stability (Foundry's matching is by `_id` within an item).
 */
function synthesizeScaleValueAdvancementsForItem(
  scalingColumns: any[],
): any[] {
  if (!scalingColumns.length) return [];
  const scalingById = Object.fromEntries(scalingColumns.map((column) => [column.id, column]));
  const synthesized: any[] = [];
  for (const column of scalingColumns) {
    // 16-char ID derived from the column's UUID. dnd5e accepts any
    // 16-char alphanumeric for `_id`; stripping hyphens + truncating
    // to 16 gives us a stable derivation. If two columns ever
    // produced the same prefix (astronomically unlikely with v4
    // UUIDs), Foundry would dedupe on the second one — better that
    // than a non-deterministic id.
    const advId = String(column.id || "").replace(/-/g, "").slice(0, 16).padEnd(16, "0");
    const stub = {
      _id: advId,
      type: "ScaleValue",
      level: 1,
      title: trimString(column.name) || trimString(column.identifier) || "Scaling",
      configuration: {
        identifier: trimString(column.identifier),
        scalingColumnId: column.id,
      },
    };
    const filled = normalizeScaleValueAdvancement(stub, scalingById);
    if (filled) synthesized.push(filled);
  }
  return synthesized;
}

/**
 * Build per-item_type `system.*` blocks. Common fields are emitted
 * by the caller; this function only adds the type-specific extras.
 * Mirrors the module-side `buildItemSummary` shape so the imported
 * item validates clean against dnd5e v5's per-type schemas.
 */
function buildTypeSpecificSystem(itemType: string, row: any): Record<string, any> {
  const extras: Record<string, any> = {};
  if (itemType === "weapon") {
    extras.damage = parseJsonField(row.damage, {}) || {};
    extras.range = parseJsonField(row.range, {}) || {};
    extras.mastery = trimString(row.mastery);
    extras.magicalBonus = Number(row.magical_bonus ?? 0) || 0;
    extras.ammunition = row.ammunition || null;
    extras.proficient = row.proficient != null ? Number(row.proficient) : null;
    // `system.type` for weapons carries the base-item slug ("greatsword")
    // under `baseItem` so dnd5e's per-weapon schema kicks in.
    extras.type = {
      value: trimString(row.weapon_type) || "simpleM",
      baseItem: trimString(row.base_item),
    };
  } else if (itemType === "equipment") {
    // Equipment covers armor + non-armor wearables (rings, cloaks).
    // armor.value=null + armor.dex=null means non-armor; populated
    // values mean an actual armor piece.
    extras.armor = {
      value: row.armor_value != null ? Number(row.armor_value) : null,
      dex: row.armor_dex != null ? Number(row.armor_dex) : null,
      magicalBonus: Number(row.armor_magical_bonus ?? 0) || 0,
    };
    extras.strength = trimString(row.strength) || null;
    extras.stealth = !!Number(row.stealth ?? 0);
    extras.proficient = row.proficient != null ? Number(row.proficient) : null;
    extras.type = {
      value: trimString(row.armor_type) || "trinket",
      baseItem: trimString(row.base_item),
    };
  } else if (itemType === "tool") {
    extras.ability = trimString((row as any).ability);
    extras.proficient = row.proficient != null ? Number(row.proficient) : null;
    extras.bonus = trimString(row.bonus);
    extras.type = {
      value: trimString(row.tool_type) || "art",
      baseItem: trimString(row.base_item),
    };
  } else if (itemType === "container" || itemType === "backpack") {
    extras.capacity = parseJsonField((row as any).capacity, {}) || {};
    extras.type = {
      value: itemType,
      baseItem: trimString(row.base_item),
    };
  } else if (itemType === "consumable") {
    extras.type = {
      // Subtype lives in `consumable_type` if we have it, else fall
      // through to a generic "potion". Foundry coerces unknown values
      // gracefully.
      value: trimString((row as any).consumable_type) || "potion",
      baseItem: trimString(row.base_item),
    };
  } else {
    // loot, treasure, any future type — emit just a base type with
    // the slug; dnd5e will accept the document with default schemas.
    extras.type = {
      value: itemType || "loot",
      baseItem: trimString(row.base_item),
    };
  }
  return extras;
}

/**
 * Build the full Foundry-ready item bundle for one items-table row.
 *
 * Returns null when no row matches.
 */
export async function buildItemBundle(
  itemId: string,
  fetchers: ExportFetchers,
): Promise<ItemDocBundle | null> {
  const { fetchDocument, fetchCollection } = fetchers;
  const row: any = await fetchDocument<any>("items", itemId);
  if (!row) return null;

  const activitiesArr = Array.isArray(row.activities)
    ? row.activities
    : parseJsonField(row.activities, []) || [];
  const effectsArr = Array.isArray(row.effects)
    ? row.effects
    : parseJsonField(row.effects, []) || [];
  const propertiesArr = Array.isArray(row.properties)
    ? row.properties
    : parseJsonField(row.properties, []) || [];
  const usesRecoveryArr = Array.isArray(row.uses_recovery)
    ? row.uses_recovery
    : parseJsonField(row.uses_recovery, []) || [];

  const sourceId = trimString(row.identifier) || `item-${row.id}`;
  const itemType = trimString(row.item_type) || "loot";

  // Resolve the item's source FK to its public semantic id for the
  // flag block + system.source. Same best-effort pattern feat export
  // uses — a stale FK doesn't break the bundle.
  let itemSourceSemanticId: string | null = null;
  let sourceBook = "";
  let sourceRulesVersion = "2014";
  if (row.source_id) {
    const sourceRow: any = await fetchDocument<any>("sources", String(row.source_id));
    if (sourceRow) {
      sourceBook = String(sourceRow.abbreviation || sourceRow.name || "");
      sourceRulesVersion = String(sourceRow.rules_version || "2014");
      itemSourceSemanticId = getSemanticSourceId({
        slug: sourceRow.slug,
        abbreviation: sourceRow.abbreviation,
        rules: sourceRow.rules_version || "2014",
      }, sourceRow.id);
    } else {
      itemSourceSemanticId = String(row.source_id);
    }
  }

  // Description: BBCode → HTML. Mirrors feat / spell exports.
  const descriptionBbcode = trimString(row.description);
  const descriptionHtml = descriptionBbcode ? bbcodeToHtml(descriptionBbcode) : "";

  // Load + synthesize scaling. Items don't author advancements
  // app-side; ScaleValue advancements are built from scratch off
  // the `scaling_columns` table here. Each column produces one
  // advancement keyed on `flags.dauligor-pairing.sourceId` for
  // re-import matching.
  let scalingColumns: any[] = [];
  try {
    const rows = await fetchCollection<any>("scaling_columns", {
      where: "parent_id = ? AND parent_type = ?",
      params: [String(row.id), "item"],
      orderBy: "name ASC",
    });
    scalingColumns = (rows || []).map(denormalizeScalingColumnRow);
  } catch {
    scalingColumns = [];
  }
  const synthesizedAdvancements = synthesizeScaleValueAdvancementsForItem(scalingColumns);

  // Weight + price are stored as JSON shapes that already match
  // Foundry's nested objects (`{ value, units }` + `{ value, denomination }`).
  // Pass through after defensive coercion in case a legacy row stored
  // a flat number.
  const weightRaw = parseJsonField(row.weight, null);
  const weight = (weightRaw && typeof weightRaw === "object")
    ? weightRaw
    : { value: Number(row.weight ?? 0) || 0, units: "lb" };
  const priceRaw = parseJsonField(row.price, null);
  const price = (priceRaw && typeof priceRaw === "object")
    ? priceRaw
    : { value: Number(row.price ?? 0) || 0, denomination: "gp" };

  // Chat Description (system.description.chat) + Unidentified Description
  // (system.unidentified.description) — BBCode → HTML, mirroring the main
  // description above. Both were previously dropped on export.
  const chatHtml = trimString(row.chat_description) ? bbcodeToHtml(trimString(row.chat_description)) : "";
  const unidentifiedHtml = trimString(row.unidentified_description) ? bbcodeToHtml(trimString(row.unidentified_description)) : "";

  const baseSystem: Record<string, any> = {
    identifier: sourceId.replace(/^item-/, ""),
    description: {
      value: descriptionHtml,
      chat: chatHtml,
    },
    unidentified: { description: unidentifiedHtml },
    properties: propertiesArr,
    rarity: trimString(row.rarity) || "common",
    attunement: trimString(row.attunement),
    equipped: !!Number(row.equipped ?? 0),
    identified: row.identified == null ? true : !!Number(row.identified),
    quantity: Number(row.quantity ?? 1) || 1,
    weight,
    price,
    uses: {
      max: trimString(row.uses_max),
      spent: Number(row.uses_spent || 0),
      recovery: Array.isArray(usesRecoveryArr) ? usesRecoveryArr : [],
    },
    activities: arrayToFoundryMap(activitiesArr),
    advancement: arrayToFoundryMap(synthesizedAdvancements),
    source: {
      book: sourceBook,
      page: trimString(row.page),
      rules: sourceRulesVersion,
      revision: 1,
      custom: "",
      license: "",
    },
  };

  // Merge the per-type extras (system.type for every type;
  // damage/range/armor/etc. depending on item_type).
  const system = {
    ...baseSystem,
    ...buildTypeSpecificSystem(itemType, row),
  };

  const item = {
    name: String(row.name || ""),
    type: itemType,
    img: row.image_url || undefined,
    system,
    effects: Array.isArray(effectsArr) ? effectsArr : [],
    flags: {
      "dauligor-pairing": {
        schemaVersion: 1,
        entityKind: "item",
        sourceId,
        dbId: String(row.id),
        sourceType: "item",
        itemType,
        itemSourceSemanticId,
        // Tags aren't yet authored on items today, but the picker
        // shell is in place; surface an empty list for forward
        // compatibility with future tag work.
        tagIds: [],
      },
    },
  };

  return {
    kind: "dauligor.item-item.v1",
    schemaVersion: 1,
    dbId: String(row.id),
    sourceId,
    item,
    generatedAt: Date.now(),
  };
}

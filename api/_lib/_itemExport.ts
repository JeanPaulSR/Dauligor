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
export interface ItemDoc {
  name: string;
  type: string;
  img?: string;
  system: Record<string, any>;
  effects: unknown[];
  flags: Record<string, any>;
}

export interface ItemDocBundle {
  kind: "dauligor.item-item.v1";
  schemaVersion: 1;
  dbId: string;
  sourceId: string;
  item: ItemDoc;
  /**
   * Container recipe (option C) expanded into flat child item docs. Present
   * only for container/backpack rows that carry `container_contents` entries.
   * Each child is a full item doc with `system.container` (the container's
   * sourceId slug) + `system.quantity`, plus a `flags.dauligor-pairing`
   * membership marker (`container` slug, `contentKind` reference|custom,
   * `contentQuantity`). The module materializes these as sibling items,
   * remapping `system.container` to the newly-created container's id; app
   * re-import collapses them back into `container_contents` rows by slug.
   */
  contents?: ItemDoc[];
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
    extras.ammunition = parseJsonField(row.ammunition, null);
    extras.proficient = row.proficient != null ? Number(row.proficient) : null;
    // `system.type.value` is the weapon CATEGORY. items.type_subtype holds our
    // proficiency category (simple/martial/exotic/natural/improv/siege); for
    // simple/martial the base weapon's Melee/Ranged is folded in by
    // buildItemBundle to yield Foundry's split-type (simpleM/simpleR/…). Legacy
    // rows fall back to the weapon_type mirror. baseItem carries the base-weapon
    // slug ("greatsword") so dnd5e's per-weapon schema kicks in.
    extras.type = {
      value: trimString(row.type_subtype) || trimString(row.weapon_type) || "simpleM",
      baseItem: trimString(row.base_item),
    };
  } else if (itemType === "equipment") {
    // Equipment covers armor + non-armor wearables (rings, cloaks) + vehicle
    // equipment (mountable). armor.value/dex populated = an armor piece;
    // vehicle equipment pulls armor.value (AC) from the items.vehicle JSON.
    const isVehicle = trimString(row.type_subtype) === "vehicle";
    const veh = isVehicle ? (parseJsonField((row as any).vehicle, {}) || {}) : {};
    const vehArmor = (veh.armor && typeof veh.armor === "object") ? veh.armor : {};
    extras.armor = {
      value: isVehicle
        ? (vehArmor.value != null ? Number(vehArmor.value) : null)
        : (row.armor_value != null ? Number(row.armor_value) : null),
      dex: row.armor_dex != null ? Number(row.armor_dex) : null,
      magicalBonus: Number(row.armor_magical_bonus ?? 0) || 0,
    };
    extras.strength = trimString(row.strength) || null;
    extras.stealth = !!Number(row.stealth ?? 0);
    extras.proficient = row.proficient != null ? Number(row.proficient) : null;
    // `system.type.value` ← items.type_subtype (the canonical subtype the
    // editor writes); legacy rows fall back to the armor_type mirror.
    extras.type = {
      value: trimString(row.type_subtype) || trimString(row.armor_type) || "trinket",
      baseItem: trimString(row.base_item),
    };
    // Vehicle-equipment (mountable) extras — system.cover/crew/hp/speed from
    // the items.vehicle JSON (pass-through; the module preserves system.*).
    if (isVehicle) {
      if (veh.cover != null) extras.cover = Number(veh.cover);
      if (veh.crew && typeof veh.crew === "object") {
        extras.crew = { max: veh.crew.max ?? null, value: Array.isArray(veh.crew.value) ? veh.crew.value : [] };
      }
      if (veh.hp && typeof veh.hp === "object") extras.hp = veh.hp;
      if (veh.speed && typeof veh.speed === "object") extras.speed = veh.speed;
    }
  } else if (itemType === "tool") {
    // `system.ability` is resolved from items.ability_id in buildItemBundle
    // (needs the attributes table) — placeholder here. Empty = Default.
    extras.ability = "";
    extras.proficient = row.proficient != null ? Number(row.proficient) : null;
    extras.bonus = trimString(row.bonus);
    // `system.type.value` ← items.type_subtype (the tool category the editor
    // writes); legacy rows fall back to the tool_type mirror.
    extras.type = {
      value: trimString(row.type_subtype) || trimString(row.tool_type) || "art",
      baseItem: trimString(row.base_item),
    };
  } else if (itemType === "container" || itemType === "backpack") {
    extras.capacity = parseJsonField((row as any).capacity, {}) || {};
    // Coins the container itself holds → system.currency (5-coin grid).
    extras.currency = parseJsonField((row as any).currency, {}) || {};
    extras.type = {
      value: itemType,
      baseItem: trimString(row.base_item),
    };
  } else if (itemType === "consumable") {
    // Foundry `system.type.value` is the consumable subtype
    // (potion/scroll/ammo/poison/…) — stored in items.type_subtype.
    // `system.type.subtype` is the second axis (ammo arrow/bolt, poison
    // contact/injury) — items.type_inner_subtype (migration 20260607-1300).
    extras.type = {
      value: trimString((row as any).type_subtype) || "potion",
      subtype: trimString((row as any).type_inner_subtype),
      baseItem: trimString(row.base_item),
    };
    // Ammo consumables carry damage in items.damage — same column as
    // weapons, Foundry shape `{ base:<DamagePart>, replace:<bool> }`.
    extras.damage = parseJsonField(row.damage, {}) || {};
  } else {
    // loot, treasure, any future type — `system.type.value` is the loot
    // subtype (art/gear/gem/…) from items.type_subtype; fall back to the
    // item_type slug. dnd5e accepts the document with default schemas.
    extras.type = {
      value: trimString(row.type_subtype) || itemType || "loot",
      baseItem: trimString(row.base_item),
    };
  }
  return extras;
}

/**
 * Expand a container's `container_contents` recipe into Foundry child item
 * documents (option C — flat siblings). Reference rows become a full copy of
 * the referenced catalog item; custom rows become a minimal loot doc from
 * `custom_data`. Each carries `system.container` + `system.quantity` + a
 * `flags.dauligor-pairing` membership marker so re-import can collapse it back
 * by slug. Children are built with `expandContents:false` so a container
 * nested inside a container can't recurse without bound.
 */
async function buildContainerContents(
  containerRow: any,
  containerSourceId: string,
  fetchers: ExportFetchers,
): Promise<ItemDoc[]> {
  let rows: any[] = [];
  try {
    rows = (await fetchers.fetchCollection<any>("container_contents", {
      where: "container_id = ?",
      params: [String(containerRow.id)],
      orderBy: "sort_order, created_at",
    })) || [];
  } catch {
    return [];
  }
  const children: ItemDoc[] = [];
  for (const cc of rows) {
    const qty = Number(cc.quantity ?? 1) || 1;
    // Custom one-off → minimal loot doc from the snapshot.
    if (Number(cc.is_custom) === 1 || !cc.item_id) {
      const cd = parseJsonField(cc.custom_data, {}) || {};
      children.push({
        name: String(cd.name || "Custom item"),
        type: "loot",
        system: {
          identifier: "",
          description: { value: "", chat: "" },
          quantity: qty,
          container: containerSourceId,
        },
        effects: [],
        flags: {
          "dauligor-pairing": {
            entityKind: "item",
            container: containerSourceId,
            contentKind: "custom",
            contentQuantity: qty,
            custom: cd,
          },
        },
      });
      continue;
    }
    // Reference → full copy of the catalog item, stamped as content.
    const childBundle = await buildItemBundle(String(cc.item_id), fetchers, { expandContents: false });
    if (!childBundle) continue;
    const childItem = childBundle.item;
    childItem.system = { ...childItem.system, container: containerSourceId, quantity: qty };
    const dp = (childItem.flags?.["dauligor-pairing"] as Record<string, any>) || {};
    childItem.flags = {
      ...childItem.flags,
      "dauligor-pairing": {
        ...dp,
        container: containerSourceId,
        contentKind: "reference",
        contentQuantity: qty,
      },
    };
    children.push(childItem);
  }
  return children;
}

/**
 * Build the full Foundry-ready item bundle for one items-table row.
 *
 * Returns null when no row matches. `opts.expandContents` (default true)
 * gates the container_contents → child-doc expansion; children are built
 * with it false to bound nested-container recursion.
 */
export async function buildItemBundle(
  itemId: string,
  fetchers: ExportFetchers,
  opts: { expandContents?: boolean } = {},
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
  const system: Record<string, any> = {
    ...baseSystem,
    ...buildTypeSpecificSystem(itemType, row),
  };

  // Tool `system.ability` ← resolve items.ability_id → the attribute's
  // identifier slug (str/dex/…). Empty = Default ability.
  if (itemType === "tool" && (row as any).ability_id) {
    try {
      const attr: any = await fetchDocument<any>("attributes", String((row as any).ability_id));
      // dnd5e `system.ability` is the lowercase slug (str/dex/…); our
      // attributes identifiers are uppercase (STR/DEX/…).
      if (attr?.identifier) system.ability = String(attr.identifier).toLowerCase();
    } catch { /* leave placeholder */ }
  }

  // Weapon `system.type.value` — fold the base weapon's Melee/Ranged into our
  // proficiency category (type_subtype) to produce Foundry's split weapon type
  // (simple + Melee → simpleM, martial + Ranged → martialR, …). natural/improv/
  // siege/exotic + homebrew categories pass through unchanged. The category
  // lives in type_subtype; the Melee/Ranged classification rides the linked
  // weapons proficiency row (items.base_weapon_id → weapons.weapon_type).
  if (itemType === "weapon") {
    const cat = trimString((row as any).type_subtype);
    if (cat === "simple" || cat === "martial") {
      // simple/martial MUST carry the melee/ranged suffix to be a valid Foundry
      // weapon type. Read the base weapon's classification when linked; default
      // to Melee for baseless weapons (rare magic items with no SRD base) so the
      // export is always a real CONFIG.DND5E.weaponTypes key (never raw "simple").
      let ranged = false;
      if ((row as any).base_weapon_id) {
        try {
          const w: any = await fetchDocument<any>("weapons", String((row as any).base_weapon_id));
          ranged = String(w?.weapon_type ?? "").toLowerCase() === "ranged";
        } catch { /* default to melee */ }
      }
      system.type = { ...(system.type || {}), value: cat + (ranged ? "R" : "M") };
    }
  }

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

  // Container contents (option C): expand the recipe into flat child item
  // docs the module materializes as siblings. Top-level only — children are
  // built with expandContents:false to bound nested-container recursion.
  let contents: ItemDoc[] | undefined;
  if ((itemType === "container" || itemType === "backpack") && opts.expandContents !== false) {
    const children = await buildContainerContents(row, sourceId, fetchers);
    if (children.length) contents = children;
  }

  return {
    kind: "dauligor.item-item.v1",
    schemaVersion: 1,
    dbId: String(row.id),
    sourceId,
    item,
    ...(contents ? { contents } : {}),
    generatedAt: Date.now(),
  };
}

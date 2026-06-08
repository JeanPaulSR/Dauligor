/**
 * Item import library — Foundry → Dauligor.
 *
 * **Single-target architecture (rebuilt 2026-05-25):** every Foundry
 * item — weapon, equipment, consumable, tool, loot, container — lands
 * in the unified `items` table. The `weapons`, `armor`, and `tools`
 * tables stay as proficiency-type definitions (catalogued by
 * AdminProficiencies); imported items reference them via the
 * `items.base_weapon_id` / `items.base_armor_id` / `items.base_tool_id`
 * polymorphic FK columns (added in migration 20260525-1800).
 *
 * Routing example:
 *   "Flame Tongue Greatsword" (foundryType=weapon) →
 *     INSERT INTO items (...) VALUES (..., item_type='weapon',
 *       base_weapon_id=<id of "Greatsword" proficiency row>, …);
 *
 * Base-item resolution: Foundry's `system.type.baseItem` is an SRD
 * slug ("greatsword" / "padded" / "lyre"). The importer matches it
 * against `weapons.identifier` / `armor.identifier` / `tools.identifier`
 * to find the proficiency row and writes the row id into the matching
 * base_*_id column. The other two stay NULL.
 *
 * Helpers (slugify / source-matching / image-url resolution / HTML→BBCode)
 * are copied — not re-exported — from spellImport.ts / featImport.ts on
 * purpose. The three import libraries are siblings; a divergence in
 * one side shouldn't cascade into the others.
 *
 * Unified items-table schema absorbed (per 20260524-1800 + 20260525-1800):
 *   common:  name / identifier / source_id / page / item_type /
 *            description / activities / effects / properties / rarity /
 *            quantity / weight / price / attunement / equipped /
 *            identified / magical / base_item (SRD slug, source of truth)
 *   weapons: damage (JSON) / range (JSON) / mastery / magical_bonus /
 *            ammunition / proficient / base_weapon_id (FK)
 *   armor:   armor_value / armor_dex / armor_magical_bonus / strength /
 *            stealth / armor_type / base_armor_id (FK)
 *   tools:   tool_type / bonus / base_tool_id (FK)
 *
 * FK gaps:
 *   - Each base_*_id is null when no proficiency row matches the
 *     Foundry slug. The original `base_item` slug stays populated so
 *     admins can re-resolve later if a missing proficiency definition
 *     gets added.
 */

import { slugify } from './utils';
import { htmlToBbcode } from './bbcode';
import { cleanFoundryHtml } from './foundryHtmlCleanup';

const IMAGE_CDN_BASE = 'https://images.dauligor.com';

// ─── Types ──────────────────────────────────────────────────────────

type SourceRecord = {
  id: string;
  name?: string;
  abbreviation?: string;
  shortName?: string;
  slug?: string;
  rules?: string;
  [key: string]: any;
};

type AbilityRecord = {
  id: string;
  name?: string;
  identifier?: string;
  [key: string]: any;
};

export type ItemTargetTable = 'items' | 'weapons' | 'armor' | 'tools';

export type FoundryItemExportEntry = {
  id: string;
  uuid?: string;
  name: string;
  type: string;
  folderId?: string | null;
  folderPath?: string;
  relativeFolderPath?: string;
  source?: {
    book?: string;
    page?: string | number | null;
    rules?: string;
  };
  itemSummary?: Record<string, any>;
  sourceDocument: any;
};

export type FoundryItemFolderExport = {
  kind: string;
  schemaVersion?: number;
  exportedAt?: string;
  moduleId?: string;
  game?: Record<string, any>;
  folder?: Record<string, any>;
  summary?: Record<string, any>;
  items?: FoundryItemExportEntry[];
};

type ExistingItemRow = {
  id: string;
  name?: string;
  identifier?: string;
  source_id?: string | null;
  sourceId?: string | null;
  [key: string]: any;
};

export type ItemImportCandidate = {
  candidateId: string;
  batchId: string;
  batchLabel: string;
  name: string;
  identifier: string;
  // Routing
  foundryType: string;             // weapon / equipment / consumable / tool / loot / container / backpack
  foundryCategory: string;         // system.type.value (light/simpleM/potion/etc.)
  targetTable: ItemTargetTable;
  targetTableLabel: string;
  // Identity / source
  sourceBook: string;
  sourcePage: string;
  rules: string;
  imageUrl: string;
  descriptionHtml: string;
  // Common preview fields (shown across all rows)
  rarity: string;
  rarityLabel: string;
  attunement: string;
  attunementLabel: string;
  magical: boolean;
  quantity: number;
  weight: number;
  price: { value: number; denomination: string };
  properties: string[];
  hasActivities: boolean;
  hasEffects: boolean;
  // Type-specific previews (one of these is populated based on targetTable)
  weaponPreview?: {
    damageBase?: any;
    range?: any;
    mastery?: string;
    magicalBonus?: number;
    ammunition?: any;
  };
  armorPreview?: {
    armorValue?: number | null;
    armorDex?: number | null;
    magicalBonus?: number;
    strength?: number | null;
    stealth?: boolean;
    armorType?: string;
  };
  toolPreview?: {
    ability?: string;
    bonus?: string;
  };
  consumablePreview?: {
    destroyOnEmpty?: boolean;
    consumableType?: string;
  };
  containerPreview?: {
    capacity?: any;
  };
  // Source resolution
  matchedSourceId: string;
  matchedSourceLabel: string;
  sourceResolved: boolean;
  // Existing row dedupe — by (identifier, source_id) on the target table
  existingEntryId: string;
  existingEntryName: string;
  // Bookkeeping
  importWarnings: string[];
  activities: any[];
  effects: any[];
  sourceDocument: any;
  // Ready-to-write payload (snake_case keys matching the target schema)
  savePayload: Record<string, any>;
};

// ─── Constants ──────────────────────────────────────────────────────

const TARGET_TABLE_LABELS: Record<ItemTargetTable, string> = {
  items: 'Items',
  weapons: 'Weapons',
  armor: 'Armor',
  tools: 'Tools',
};

const RARITY_LABELS: Record<string, string> = {
  none: 'Common',
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  veryRare: 'Very Rare',
  legendary: 'Legendary',
  artifact: 'Artifact',
};

const ATTUNEMENT_LABELS: Record<string, string> = {
  '': 'None',
  required: 'Required',
  optional: 'Optional',
};

// Foundry `equipment` items whose `system.type.value` is one of these
// slugs land in the armor table (they carry an AC value). Everything
// else (clothing/trinket/wondrous/ring/rod/wand/vehicle) lands in
// the items table as worn gear.
const ARMOR_CATEGORIES = new Set(['light', 'medium', 'heavy', 'shield', 'natural']);

// Foundry weapon-type slugs → Dauligor's weapon_type CHECK constraint
// (the weapons table requires 'Melee' or 'Ranged' exactly).
const FOUNDRY_WEAPON_TYPE_TO_DAULIGOR: Record<string, 'Melee' | 'Ranged'> = {
  simpleM: 'Melee',
  martialM: 'Melee',
  simpleR: 'Ranged',
  martialR: 'Ranged',
  natural: 'Melee',  // natural weapons are melee in practice
  improv: 'Melee',
  siege: 'Ranged',
};

// ─── Helpers (copied from spellImport / featImport) ─────────────────

function toCleanUpper(value: string) {
  return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function normalizeRules(value: string) {
  const numeric = String(value ?? '').replace(/[^0-9]/g, '');
  if (numeric === '2014' || numeric === '14') return '2014';
  if (numeric === '2024' || numeric === '24') return '2024';
  return String(value ?? '').trim();
}

function resolveFoundryImageUrl(value: string) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (/^https?:\/\//iu.test(raw)) return raw;
  if (raw.startsWith('/')) return `${IMAGE_CDN_BASE}${raw}`;
  if (/^(icons|systems|modules)\//iu.test(raw)) return `${IMAGE_CDN_BASE}/${raw}`;
  return raw;
}

function matchSourceRecord(book: string, rules: string, sources: SourceRecord[]) {
  const normalizedBook = toCleanUpper(book);
  const normalizedRules = normalizeRules(rules);
  const variants = new Set<string>();
  if (normalizedBook) {
    variants.add(normalizedBook);
    variants.add(normalizedBook.replace(/(2014|2024|14|24)$/u, ''));
  }

  const scored = sources
    .map((source) => {
      const candidates = [
        source.abbreviation, source.shortName, source.slug, source.name,
      ].map((value) => toCleanUpper(String(value ?? ''))).filter(Boolean);

      // EXACT MATCH ONLY — see featImport.ts:matchSourceRecord for
      // the full rationale. tl;dr the previous prefix-match routed
      // sub-book codes like "GH:CG'14" to a generic "GH" source,
      // breaking the composite UNIQUE the schema now enforces on
      // both feats and items. Variants already strip 14/24 suffix.
      let score = 0;
      for (const variant of variants) {
        if (!variant) continue;
        if (candidates.includes(variant)) score = Math.max(score, 3);
      }

      const sourceRules = normalizeRules(String(source.rules ?? ''));
      if (score > 0 && normalizedRules && sourceRules && normalizedRules === sourceRules) score += 1;

      return { source, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.source ?? null;
}

function convertFoundryHtmlToBbcode(html: string) {
  // Run the cleanup BEFORE `htmlToBbcode` so enrichers (`@feat[…]`,
  // `[[/r …]]`, `@UUID[…]{label}`, etc.) become plain text before
  // the converter sees them. Otherwise raw tokens survive into the
  // BBCode column and surface as literal text in every consumer.
  return htmlToBbcode(cleanFoundryHtml(html));
}

export function formatFoundryItemDescriptionForDisplay(html: string) {
  // Delegates to the shared `cleanFoundryHtml` so the enricher
  // grammar stays consistent across spells / feats / items. Items
  // skip the prereqs-line stripper — they don't typically open with
  // a hand-authored "Prerequisites: …" marker the way feats do.
  return cleanFoundryHtml(html);
}

// ─── Routing helper ────────────────────────────────────────────────

/**
 * Classify a Foundry item's "shape" for UI grouping (preview pane,
 * filter axis). The returned label is informational only — every item
 * still lands in the `items` table regardless of shape.
 *
 * Kept as `ItemTargetTable` for backward-compat with the workbench's
 * preview helpers, even though the "target" terminology is now a
 * misnomer (there is only one target table).
 */
export function classifyItemShape(foundryType: string, foundryCategory: string): ItemTargetTable {
  if (foundryType === 'weapon') return 'weapons';
  if (foundryType === 'tool') return 'tools';
  if (foundryType === 'equipment') {
    return ARMOR_CATEGORIES.has(foundryCategory) ? 'armor' : 'items';
  }
  // consumable / loot / container / backpack
  return 'items';
}

/** @deprecated Use `classifyItemShape`. Old name kept for any external callers. */
export const routeToTargetTable = classifyItemShape;

// ─── Base-item FK resolution ───────────────────────────────────────

/**
 * Foundry's `system.type.baseItem` ("greatsword" / "padded" / "lyre")
 * → Dauligor proficiency-row id. Searches the matching proficiency
 * table by `identifier` (the same slug Foundry uses). Returns the
 * three FK columns ready to splat onto the items save payload.
 *
 * Only one of the three FKs is set per call — driven by the item's
 * shape. Weapons resolve against weapons.identifier; armor-shaped
 * equipment resolves against armor.identifier; tools resolve against
 * tools.identifier; everything else (consumable / loot / container /
 * worn-gear equipment) doesn't have a base-item concept and all three
 * FKs stay null.
 */
function resolveBaseItemFkColumns(
  shape: ItemTargetTable,
  baseItemSlug: string,
  proficiencies: { weapons?: BaseItemRow[]; armor?: BaseItemRow[]; tools?: BaseItemRow[] },
): { base_weapon_id: string | null; base_armor_id: string | null; base_tool_id: string | null } {
  const slug = String(baseItemSlug || '').trim().toLowerCase();
  const empty = { base_weapon_id: null, base_armor_id: null, base_tool_id: null };
  if (!slug) return empty;

  const matchById = (rows: BaseItemRow[] | undefined): string | null => {
    if (!rows) return null;
    const found = rows.find((r) => String(r.identifier ?? '').toLowerCase() === slug);
    return found?.id ?? null;
  };

  switch (shape) {
    case 'weapons':
      return { ...empty, base_weapon_id: matchById(proficiencies.weapons) };
    case 'armor':
      return { ...empty, base_armor_id: matchById(proficiencies.armor) };
    case 'tools':
      return { ...empty, base_tool_id: matchById(proficiencies.tools) };
    default:
      return empty;
  }
}

/** Row from a proficiency table (weapons / armor / tools). The
 *  importer only reads name + identifier — name is for warning copy,
 *  identifier is the lookup key against Foundry's `baseItem` slug. */
type BaseItemRow = {
  id: string;
  name?: string;
  identifier?: string;
  [key: string]: any;
};

/**
 * Best-effort match of a Foundry ability slug ("str"/"dex"/…) to a
 * Dauligor ability_id by looking at the `attributes` lookup table.
 * Falls back to null when no match — caller (tool save payload)
 * accepts null without erroring.
 *
 * Dauligor's `attributes` table conventionally stores `identifier`
 * as uppercase 3-letter slugs ("STR"/"DEX"/…). The match is done
 * case-insensitively against identifier AND name so it works whether
 * the table was seeded with uppercase slugs or long names
 * (Strength / Dexterity / …).
 */
function matchAbilityId(slug: string, abilities: AbilityRecord[]): string | null {
  if (!slug) return null;
  const wanted = String(slug).toLowerCase().trim();
  const longName: Record<string, string> = {
    str: 'strength', dex: 'dexterity', con: 'constitution',
    int: 'intelligence', wis: 'wisdom', cha: 'charisma',
  };
  const variants = new Set([wanted, longName[wanted] ?? ''].filter(Boolean));
  const found = abilities.find((a) => {
    const id = String(a.identifier ?? '').toLowerCase();
    const name = String(a.name ?? '').toLowerCase();
    return variants.has(id) || variants.has(name);
  });
  return found?.id ?? null;
}

// ─── Unified items save-payload builder ────────────────────────────

/**
 * Build the full snake_case save payload for the items table. Includes
 * shape-specific fields (damage/range for weapons; armor_value/etc. for
 * armor-shaped equipment; tool_type/bonus for tools) — the unused
 * columns stay null. The `base_weapon_id` / `base_armor_id` /
 * `base_tool_id` FKs are resolved against the loaded proficiency
 * collections; if Foundry's baseItem slug doesn't match any
 * proficiency row, all three stay null and the warning is surfaced
 * for admin triage.
 *
 * Note: the items table's `attunement` column is the legacy boolean
 * (INTEGER 0/1), separate from the descriptive string Foundry uses
 * ("required"/"optional"). We keep both: the boolean for "this thing
 * needs attunement, period" and the verbatim slug for display via
 * Foundry's three-state vocabulary.
 */
function buildUnifiedItemSavePayload(
  item: FoundryItemExportEntry,
  matchedSource: SourceRecord | null,
  abilities: AbilityRecord[],
  proficiencies: { weapons?: BaseItemRow[]; armor?: BaseItemRow[]; tools?: BaseItemRow[] },
): Record<string, any> {
  const sourceDocument = item.sourceDocument ?? {};
  const system = sourceDocument.system ?? {};
  const properties = Array.from(system.properties ?? []).map((v) => String(v));
  const foundryType = String(item.type ?? '');
  const foundryCategory = String(system.type?.value ?? '');
  const shape = classifyItemShape(foundryType, foundryCategory);
  const baseItemSlug = String(system.type?.baseItem ?? '').trim();

  // `magical` derivation matches the export's flag — `mgc` property OR
  // any non-`none` rarity counts as magical.
  const isMagical = properties.includes('mgc')
    || (system.rarity && system.rarity !== 'none' && system.rarity !== '');

  // ── attunement ──
  // Foundry stores attunement as a 3-state string. We mirror it verbatim
  // now (post 20260526-1700) — was lossy boolean before.
  //   ''         — does not require attunement
  //   'required' — must be attuned to use any attunement-gated effect
  //   'optional' — can be attuned but works without
  const attunementValue = (() => {
    const raw = String(system.attunement ?? '').trim().toLowerCase();
    if (raw === 'required' || raw === 'optional') return raw;
    // Legacy boolean true → 'required' for back-compat with older exports
    if (system.attunement === true) return 'required';
    return '';
  })();

  // ── uses ──
  // Foundry's UsesField shape: {max:string, spent:number, recovery:[{period,type,formula}], autoDestroy:boolean}.
  // Shared across consumable / equipment / tool / weapon. Stash the
  // whole object as JSON; the new ItemUsesField (C5) and the existing
  // ConsumptionTabEditor consume the same shape.
  const usesBlock = system.uses && typeof system.uses === 'object' ? system.uses : null;
  const usesPayload = usesBlock ? {
    max: String(usesBlock.max ?? ''),
    spent: Number(usesBlock.spent ?? 0) || 0,
    recovery: Array.isArray(usesBlock.recovery) ? usesBlock.recovery : [],
    autoDestroy: !!usesBlock.autoDestroy,
  } : null;

  // ── type.value (stored in items.type_subtype) ──
  // We use items.type_subtype as the unified primary-subtype column —
  // Foundry's `system.type.value` (potion/scroll/light/art/etc.). For
  // weapons/armor/tools the same info also lives in dedicated columns
  // (the weapons proficiency row's weapon_type, items.armor_type,
  // items.tool_type), but type_subtype stays the canonical read-path
  // for the dynamic items editor so its dropdown logic doesn't have
  // to branch by shape.
  //
  // The rare two-axis case (poison delivery contact/inhaled/ammo
  // arrow/bolt) currently has nowhere to land — Foundry's
  // `system.type.subtype` is dropped here on import. A future schema
  // addition (e.g. items.type_inner_subtype) or a packed-slug
  // convention ("poison:contact") would close that gap. Tracked in
  // the C8 docs pass; not in scope for the C6 dynamic-editor landing.
  const typeSubtype = String(system.type?.value ?? '').trim() || null;

  // ── unidentified description ──
  const unidentifiedDescription = system.unidentified?.description
    ? convertFoundryHtmlToBbcode(String(system.unidentified.description))
    : null;

  // ── chat description ──
  // Foundry's `system.description.chat` — the rich-text "Chat Description"
  // block shown on every item's Description tab. Distinct from
  // `system.chatFlavor` (captured as chat_flavor for tools).
  const chatDescription = system.description?.chat
    ? convertFoundryHtmlToBbcode(String(system.description.chat))
    : null;

  // Common fields — same shape every Foundry item type carries.
  const commonPayload: Record<string, any> = {
    name: item.name || sourceDocument.name || 'Item',
    identifier: slugify(String(system.identifier ?? '') || item.name || 'item'),
    source_id: matchedSource?.id || null,
    image_url: resolveFoundryImageUrl(sourceDocument.img || '') || null,
    description: convertFoundryHtmlToBbcode(String(system.description?.value ?? '')),
    item_type: foundryType,
    rarity: String(system.rarity ?? '').trim() || 'none',
    quantity: Number(system.quantity ?? 1) || 1,
    weight: system.weight ?? { value: 0, units: 'lb' },
    price: system.price ?? { value: 0, denomination: 'gp' },
    attunement: attunementValue,
    equipped: !!system.equipped,
    identified: system.identified !== false,
    magical: !!isMagical,
    // Properties pass-through. Per the 20260526-1700 weapon-properties
    // slug rename, our identifier vocabulary now matches dnd5e's
    // CONFIG.DND5E.itemProperties (fin / hvy / lgt / lod / two / ver /
    // thr / rch / amm / spc / sil) for the 11 standard 5e ones. Custom
    // properties (lance / net / range / improvised-weapons / module-
    // defined extensions like 'superHeavy') pass through verbatim — the
    // module-side property-mapping contract handles their interpretation
    // when re-exporting. We do not attempt to invent reverse-mappings
    // for unknown Foundry codes (per user direction 2026-05-26).
    properties,
    base_item: baseItemSlug || null,
    page: String(item.source?.page ?? system.source?.page ?? '') || null,
    activities: Object.values(system.activities ?? {}),
    effects: Array.isArray(sourceDocument.effects) ? sourceDocument.effects : [],
    uses: usesPayload,
    type_subtype: typeSubtype,
    unidentified_description: unidentifiedDescription,
    chat_description: chatDescription,
    tagIds: [],
  };

  // Shape-specific fields. Each branch sets only its own columns; the
  // others stay implicitly null (no key written) so the upsert doesn't
  // disturb their values.
  const shapePayload: Record<string, any> = {};
  if (shape === 'weapons') {
    // dnd5e v5 stores magicalBonus as a string "+1" / "+2" — coerce to int.
    const magicalBonus = Number(String(system.magicalBonus ?? '').replace(/[^0-9-]/g, '')) || 0;
    shapePayload.damage = system.damage ?? null;
    shapePayload.range = system.range ?? null;
    // Mastery is a 2024-only feature. We're a 2014-rules base game (per
    // user direction 2026-05-26) — mastery will be null in practice but
    // we still capture the imported value so 2024-marked items round-trip
    // cleanly back to Foundry.
    shapePayload.mastery = String(system.mastery ?? '').trim() || null;
    shapePayload.magical_bonus = magicalBonus;
    shapePayload.ammunition = system.ammunition ?? null;
    shapePayload.proficient = system.proficient ?? null;
  } else if (shape === 'armor') {
    const armorBlock = system.armor ?? {};
    const armorMagicalBonus = Number(String(armorBlock.magicalBonus ?? '').replace(/[^0-9-]/g, '')) || 0;
    shapePayload.armor_value = Number(armorBlock.value ?? 10) || 10;
    shapePayload.armor_dex = armorBlock.dex === null || armorBlock.dex === undefined ? null : Number(armorBlock.dex);
    shapePayload.armor_magical_bonus = armorMagicalBonus;
    shapePayload.strength = system.strength === null || system.strength === undefined || system.strength === ''
      ? null
      : Number(system.strength);
    // Stealth-disadvantage is now stored as the `stealthDisadvantage`
    // slug in items.properties (per the 20260526-1700 column drop).
    // dnd5e v5 already migrates legacy boolean exports into the property
    // set, so by the time we see `system.properties` the slug should be
    // there. If it isn't (very old export), surface as a property add.
    if (system.stealth && !properties.includes('stealthDisadvantage')) {
      commonPayload.properties = [...properties, 'stealthDisadvantage'];
    }
    shapePayload.armor_type = foundryCategory || 'light';
  } else if (shape === 'tools') {
    shapePayload.tool_type = foundryCategory || 'art';
    shapePayload.bonus = String(system.bonus ?? '').trim() || null;
    // Tool ability check slug ("dex"/"str"/etc) → attributes(id) FK.
    // Now persisted (per 20260526-1700 items.ability_id column add) so
    // the character sheet can score tool checks without an Activity
    // wire-up. matchAbilityId returns null on miss; that's fine — the
    // tool just falls back to manual ability selection at use time.
    shapePayload.ability_id = matchAbilityId(String(system.ability ?? '').trim(), abilities);
    shapePayload.chat_flavor = String(system.chatFlavor ?? '').trim() || null;
  }

  // Container shape fields. Containers don't go through the
  // classifyItemShape branch (it returns 'items' for them), but they
  // still carry capacity + currency that need their own columns. Detect
  // via foundryType rather than shape so we don't muddy the shape API.
  if (foundryType === 'container' || foundryType === 'backpack') {
    shapePayload.capacity = system.capacity ?? null;
    shapePayload.currency = system.currency ?? null;
  }

  // Nested-container reference. Foundry uses a `system.container` UUID
  // pointing at another item document. Carry the string for now; the
  // C6 dynamic editor will surface a container picker that turns this
  // into a Dauligor items.id FK on save.
  if (system.container) {
    shapePayload.container_id = String(system.container);
  }

  // Polymorphic base-item FK. Only ever fills one of the three.
  const baseItemFkColumns = resolveBaseItemFkColumns(shape, baseItemSlug, proficiencies);

  return { ...commonPayload, ...shapePayload, ...baseItemFkColumns };
}

// ─── Type-specific preview builders ────────────────────────────────

function buildWeaponPreview(item: FoundryItemExportEntry): ItemImportCandidate['weaponPreview'] {
  const summary = item.itemSummary?.weapon ?? {};
  return {
    damageBase: summary.damage?.base,
    range: summary.range,
    mastery: String(summary.mastery ?? '').trim() || undefined,
    magicalBonus: Number(summary.magicalBonus ?? 0) || 0,
    ammunition: summary.ammunition,
  };
}

function buildArmorPreview(item: FoundryItemExportEntry): ItemImportCandidate['armorPreview'] {
  const summary = item.itemSummary?.equipment ?? {};
  const armor = summary.armor ?? {};
  const foundryCategory = String(item.itemSummary?.itemCategory ?? '');
  return {
    armorValue: armor.value === null || armor.value === undefined ? null : Number(armor.value),
    armorDex: armor.dex === null || armor.dex === undefined ? null : Number(armor.dex),
    magicalBonus: Number(String(armor.magicalBonus ?? '').replace(/[^0-9-]/g, '')) || 0,
    strength: summary.strength === null || summary.strength === undefined ? null : Number(summary.strength),
    stealth: !!summary.stealth,
    armorType: foundryCategory,
  };
}

function buildToolPreview(item: FoundryItemExportEntry): ItemImportCandidate['toolPreview'] {
  const summary = item.itemSummary?.tool ?? {};
  return {
    ability: String(summary.ability ?? '').trim() || undefined,
    bonus: String(summary.bonus ?? '').trim() || undefined,
  };
}

function buildConsumablePreview(item: FoundryItemExportEntry): ItemImportCandidate['consumablePreview'] {
  const summary = item.itemSummary?.consumable ?? {};
  return {
    destroyOnEmpty: !!summary.destroyOnEmpty,
    consumableType: String(item.itemSummary?.itemCategory ?? ''),
  };
}

function buildContainerPreview(item: FoundryItemExportEntry): ItemImportCandidate['containerPreview'] {
  const summary = item.itemSummary?.container ?? {};
  return {
    capacity: summary.capacity,
  };
}

// ─── Warnings builder ──────────────────────────────────────────────

function buildImportWarnings(
  item: FoundryItemExportEntry,
  shape: ItemTargetTable,
  baseItemSlug: string,
  matchedSource: SourceRecord | null,
  baseItemMatched: boolean,
): string[] {
  const warnings: string[] = [];
  const sourceDocument = item.sourceDocument ?? {};
  if (!matchedSource) {
    warnings.push(`Source "${item.source?.book || 'Unknown'}" could not be matched to a Dauligor source.`);
  }
  if (!sourceDocument?.system?.description?.value) {
    warnings.push('Item description is empty.');
  }
  // Surface unresolved base-item FKs so admins know the proficiency
  // link is missing. Only relevant for shaped items — consumables /
  // loot / containers don't reference a proficiency definition.
  if ((shape === 'weapons' || shape === 'armor' || shape === 'tools') && baseItemSlug && !baseItemMatched) {
    warnings.push(`Base item "${baseItemSlug}" doesn't match any ${shape} proficiency row — add it to /admin/proficiencies, then re-import to wire the FK.`);
  }
  return warnings;
}

// ─── Main builder ──────────────────────────────────────────────────

export function buildItemImportCandidates(
  entry: FoundryItemFolderExport,
  batchLabel: string,
  sources: SourceRecord[],
  abilities: AbilityRecord[],
  /** Existing items table rows for dedupe by (identifier, source_id). */
  existingItems: ExistingItemRow[],
  /** Proficiency-definition rows for base-item FK resolution. The
   *  importer matches Foundry's `system.type.baseItem` slug against
   *  each table's `identifier` column. */
  proficiencies: { weapons?: BaseItemRow[]; armor?: BaseItemRow[]; tools?: BaseItemRow[] },
): ItemImportCandidate[] {
  const items = Array.isArray(entry.items) ? entry.items : [];

  return items.map((item, index) => {
    const sourceDocument = item.sourceDocument ?? {};
    const system = sourceDocument.system ?? {};
    const foundryType = String(item.type ?? '');
    const foundryCategory = String(system.type?.value ?? item.itemSummary?.itemCategory ?? '');
    const shape = classifyItemShape(foundryType, foundryCategory);

    const matchedSource = matchSourceRecord(
      String(item.source?.book ?? system.source?.book ?? ''),
      String(item.source?.rules ?? system.source?.rules ?? ''),
      sources,
    );

    const identifier = slugify(
      String(system.identifier ?? '') || item.name || sourceDocument.name || `item-${index + 1}`,
    );

    // Dedupe against the items table by (identifier, source_id). All
    // items live in one table now, so the lookup is single-table.
    const existingEntry = existingItems.find((row) => {
      const rowSourceId = row.source_id ?? row.sourceId ?? '';
      const rowIdent = row.identifier ?? '';
      return rowIdent === identifier && String(rowSourceId) === String(matchedSource?.id ?? '');
    });

    // Unified save payload — covers every shape; unused columns stay
    // null on the row.
    const savePayload = buildUnifiedItemSavePayload(item, matchedSource, abilities, proficiencies);

    // Track whether the base-item FK resolved. The save payload has
    // the three FK columns — only one is non-null when a match was
    // found.
    const baseItemSlug = String(system.type?.baseItem ?? '').trim();
    const baseItemMatched = !!(
      savePayload.base_weapon_id || savePayload.base_armor_id || savePayload.base_tool_id
    );

    // Type-specific previews — informational, drive the workbench's
    // per-shape detail panes. Routing semantics moved to the unified
    // builder; previews stay so admins can sanity-check the import.
    let weaponPreview, armorPreview, toolPreview, consumablePreview, containerPreview;
    if (foundryType === 'weapon') weaponPreview = buildWeaponPreview(item);
    if (foundryType === 'equipment' && shape === 'armor') armorPreview = buildArmorPreview(item);
    if (foundryType === 'tool') toolPreview = buildToolPreview(item);
    if (foundryType === 'consumable') consumablePreview = buildConsumablePreview(item);
    if (foundryType === 'container' || foundryType === 'backpack') containerPreview = buildContainerPreview(item);

    const activities = Object.values(system.activities ?? {});
    const effects = Array.isArray(sourceDocument.effects) ? sourceDocument.effects : [];
    const properties = Array.from(system.properties ?? []).map((v) => String(v));
    const rarity = String(system.rarity ?? '').trim() || 'none';
    const attunement = String(system.attunement ?? '').trim();
    const isMagical = properties.includes('mgc') || (rarity !== 'none' && rarity !== '');

    return {
      candidateId: `${batchLabel}::${item.uuid || item.id || identifier}`,
      batchId: batchLabel,
      batchLabel,
      name: item.name || sourceDocument.name || 'Item',
      identifier,
      foundryType,
      foundryCategory,
      // `targetTable` is kept on the candidate as a *shape* hint for
      // the workbench's per-shape preview UI. Every candidate writes
      // to the items table now — the value here is informational.
      targetTable: shape,
      targetTableLabel: TARGET_TABLE_LABELS[shape],
      sourceBook: String(item.source?.book ?? system.source?.book ?? '').trim(),
      sourcePage: String(item.source?.page ?? system.source?.page ?? '').trim(),
      rules: String(item.source?.rules ?? system.source?.rules ?? '').trim(),
      imageUrl: resolveFoundryImageUrl(sourceDocument.img || ''),
      descriptionHtml: String(system.description?.value ?? ''),
      rarity,
      rarityLabel: RARITY_LABELS[rarity] || rarity,
      attunement,
      attunementLabel: ATTUNEMENT_LABELS[attunement] || attunement || 'None',
      magical: isMagical,
      quantity: Number(system.quantity ?? 1) || 1,
      weight: typeof system.weight === 'object' ? Number(system.weight?.value ?? 0) : Number(system.weight ?? 0),
      price: system.price ?? { value: 0, denomination: 'gp' },
      properties,
      hasActivities: activities.length > 0,
      hasEffects: effects.length > 0,
      weaponPreview,
      armorPreview,
      toolPreview,
      consumablePreview,
      containerPreview,
      matchedSourceId: matchedSource?.id || '',
      matchedSourceLabel: matchedSource?.name || matchedSource?.abbreviation || '',
      sourceResolved: Boolean(matchedSource),
      existingEntryId: existingEntry?.id || '',
      existingEntryName: existingEntry?.name || '',
      importWarnings: buildImportWarnings(item, shape, baseItemSlug, matchedSource, baseItemMatched),
      activities,
      effects,
      sourceDocument,
      savePayload,
    };
  });
}

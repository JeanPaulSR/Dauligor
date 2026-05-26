-- Migration: Items completeness + proficiency source/melee-ranged filter
--   + weapon-properties slug rename to Foundry dnd5e v5 vocabulary
-- Date: 2026-05-26
--
-- This migration delivers four related changes, bundled because they all
-- support the C2-C6 work (dynamic ItemsEditor + proficiency-resolution chain):
--
-- 1. ITEMS table completeness columns
--    Adds the dropdown-driven dynamic-shape fields that Foundry dnd5e v5
--    carries on every item but our table didn't have storage for yet.
--    Most-needed: `uses` (every charged item — Wand of Magic Missiles,
--    healing potions with multiple sips, Bag of Tricks, etc.). Also:
--    container nesting, currency + capacity (containers), tool ability
--    + chat flavor, consumable/loot subtype, unidentified description.
--
-- 2. ITEMS.attunement widening
--    Foundry stores attunement as a 3-state string ('' / 'required' /
--    'optional'). Our column was INTEGER 0/1 — lossy. Widen to TEXT.
--
-- 3. ITEMS.stealth column drop
--    Stealth-disadvantage is stored in `items.properties` as the
--    `stealthDisadvantage` slug per dnd5e v5. Our dedicated column
--    duplicated state and would drift. Drop it; reading code already
--    falls back to checking `properties`.
--
-- 4. CHARACTER_PROFICIENCIES source-tracking + weapon-type filter
--    Adds polymorphic `source_entity_type` + `source_entity_id` so class
--    re-imports can prune their own grants (and so the character sheet
--    can show "granted by Fighter L1"). Adds `weapon_type_filter`
--    (NULL | 'Melee' | 'Ranged') so a category-level proficiency can be
--    restricted to one weapon type — supports "Simple Melee Weapons"
--    style grants needed for 2014-PHB-style class descriptions.
--
-- 5. WEAPON_PROPERTIES slug rename to Foundry codes
--    Aligns our identifier vocabulary with dnd5e's CONFIG.DND5E.itemProperties
--    so export/import is 1:1 for the standard 5e weapon properties. The
--    11 standard ones get renamed; the 4 app-custom ones (lance, net,
--    range, improvised-weapons) keep their current slugs and stay as
--    Dauligor extensions handled module-side per the property-mapping
--    contract.
--
-- Safety: `items` table currently has 0 rows (confirmed via remote D1
-- query 2026-05-26). column-shape changes are risk-free. The slug rename
-- is an UPDATE on weapon_properties; no foreign-key references exist (the
-- weapons.property_ids JSON stores weapon_properties.id PKs, not slugs).

-- ── 1. items completeness columns ───────────────────────────────────
-- `uses` — Foundry's UsesField shape: {max, spent, recovery[], autoDestroy}.
-- Shared by consumable, equipment, tool, weapon. Stored as JSON; the
-- existing ConsumptionTabEditor + new ItemUsesField components edit it.
ALTER TABLE items ADD COLUMN uses TEXT;

-- `container_id` — foreign key to another item in the items table. When
-- set, this item is nested inside that container. Mirrors Foundry's
-- `system.container` ForeignDocumentField. ON DELETE SET NULL so deleting
-- a container leaves orphaned items rather than cascade-wiping inventory.
ALTER TABLE items ADD COLUMN container_id TEXT REFERENCES items(id) ON DELETE SET NULL;

-- `currency` — container-only. Stored coins in the container. Shape:
-- {cp, sp, ep, gp, pp}. Containers like "Bag of Holding" stash currency.
ALTER TABLE items ADD COLUMN currency TEXT;

-- `capacity` — container-only. Shape: {count?, volume:{value,units}, weight:{value,units}}.
-- count vs weight is mutually exclusive (UI toggle picks which constraint
-- the container enforces). count is rarer (item-count limit, like a quiver).
ALTER TABLE items ADD COLUMN capacity TEXT;

-- `chat_flavor` — tool-only. Foundry's `system.chatFlavor` field used as
-- a one-liner that appears in the chat card when the tool is used.
ALTER TABLE items ADD COLUMN chat_flavor TEXT;

-- `ability_id` — tool-only. The default ability the tool's check uses
-- (str/dex/con/int/wis/cha). Distinct from the tool's CATEGORY (art/game/
-- music/etc which is `tool_type`). The class importer + character sheet
-- read this to score the tool check correctly.
ALTER TABLE items ADD COLUMN ability_id TEXT REFERENCES attributes(id) ON DELETE SET NULL;

-- `type_subtype` — Foundry's `system.type.subtype` for items where the
-- parent dropdown drives a second axis. Examples:
--   consumable: poison contact/inhaled/injury/ingested; ammo arrow/bolt/etc.
--   loot: art/gem/treasure subtype with associated weight bracket.
--   facility: garden/library/smithy/etc. (33 subtypes per 2024 DMG).
ALTER TABLE items ADD COLUMN type_subtype TEXT;

-- `unidentified_description` — Foundry's `system.unidentified.description`.
-- Shown to players before the item is identified (e.g. "a glowing sword"
-- becomes "longsword +1" after Identify).
ALTER TABLE items ADD COLUMN unidentified_description TEXT;

-- ── 2. items.attunement widening (INTEGER → TEXT) ──────────────────
-- SQLite doesn't support ALTER COLUMN TYPE. The standard workaround is
-- add-new / copy / drop-old / rename. Since the table is empty, the copy
-- step is a no-op. We still do the full dance so this migration is safe
-- against future re-runs against populated tables.
ALTER TABLE items ADD COLUMN attunement_new TEXT DEFAULT '';
UPDATE items SET attunement_new = CASE
  WHEN attunement = 1 THEN 'required'
  ELSE ''
END;
ALTER TABLE items DROP COLUMN attunement;
ALTER TABLE items RENAME COLUMN attunement_new TO attunement;

-- ── 3. items.stealth drop ──────────────────────────────────────────
-- The stealth-disadvantage flag is in items.properties as the slug
-- `stealthDisadvantage` (dnd5e v5 migrated away from the boolean column
-- a while ago). Reading code already checks the properties array — this
-- removes the duplicated state.
ALTER TABLE items DROP COLUMN stealth;

-- ── 4. character_proficiencies source + weapon_type filter ─────────
-- `source_entity_type` + `source_entity_id`: who granted this proficiency.
-- Polymorphic — entity_type discriminator says whether entity_id is a
-- class / subclass / feat / race / background / 'manual' / etc. Mirrors
-- the existing entity_type/entity_id pattern. Class re-imports can run
--   DELETE FROM character_proficiencies WHERE character_id=? AND
--     source_entity_type='class' AND source_entity_id=?
-- before re-applying their grants. NULL = legacy row from before this
-- migration; the resolver treats those as "manual / unknown source".
ALTER TABLE character_proficiencies ADD COLUMN source_entity_type TEXT;
ALTER TABLE character_proficiencies ADD COLUMN source_entity_id TEXT;

-- `weapon_type_filter`: restricts a weapon-category proficiency to just
-- one Foundry weaponType. Only meaningful when entity_type='weapon_category'.
-- Values: NULL = both melee + ranged (current behavior), 'Melee' = melee
-- weapons in this category only, 'Ranged' = ranged weapons only.
-- 2014-PHB classes use this constantly: Rogue gets "Simple Weapons + 4
-- specific martials"; some homebrew Fighter variants get "Simple Melee
-- Weapons" without ranged. The resolver reads this when scoring an item's
-- proficiency: the item's weapons.weapon_type must match the filter (or
-- the filter is NULL) for the category proficiency to apply.
ALTER TABLE character_proficiencies ADD COLUMN weapon_type_filter TEXT;

-- Index for the resolver's hot path: filter by character + source.
-- (entity_type/entity_id are the join key against weapons/categories.)
CREATE INDEX IF NOT EXISTS idx_character_proficiencies_source
  ON character_proficiencies(character_id, source_entity_type, source_entity_id);

-- ── 5. weapon_properties slug rename ───────────────────────────────
-- The 11 standard 5e properties get aligned with Foundry's short codes.
-- `name` (the display label) stays as the human-readable string — only
-- the `identifier` (technical slug) changes. weapons.property_ids stores
-- FK PKs, not slugs, so the rename has zero downstream effects on
-- existing weapon-property associations.
--
-- Unchanged (kept as Dauligor-custom): lance, net, range, improvised-weapons.
-- The module's property-mapping contract documents these as app-custom.
UPDATE weapon_properties SET identifier = 'fin' WHERE identifier = 'finesse';
UPDATE weapon_properties SET identifier = 'hvy' WHERE identifier = 'heavy';
UPDATE weapon_properties SET identifier = 'lgt' WHERE identifier = 'light';
UPDATE weapon_properties SET identifier = 'lod' WHERE identifier = 'loading';
UPDATE weapon_properties SET identifier = 'two' WHERE identifier = 'two-handed';
UPDATE weapon_properties SET identifier = 'ver' WHERE identifier = 'versatile';
UPDATE weapon_properties SET identifier = 'thr' WHERE identifier = 'thrown';
UPDATE weapon_properties SET identifier = 'rch' WHERE identifier = 'reach';
UPDATE weapon_properties SET identifier = 'amm' WHERE identifier = 'ammunition';
UPDATE weapon_properties SET identifier = 'spc' WHERE identifier = 'special';
UPDATE weapon_properties SET identifier = 'sil' WHERE identifier = 'silvered-weapons';

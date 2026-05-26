-- Items table absorbs the weapon / armor / tool shape columns so the
-- single `items` table can hold every Foundry item type (consumable,
-- container, equipment, loot, tool, weapon) and future types
-- (crafting ingredients, spell catalysts) without per-type tables.
--
-- The `weapons`, `armor`, and `tools` tables stay as proficiency-type
-- definitions only — they catalogue the base categories ("Greatsword",
-- "Padded", "Lyre") that AdminProficiencies edits. Actual game items
-- (like "Flame Tongue Greatsword") now live exclusively in `items`
-- and reference their proficiency category via the new
-- base_weapon_id / base_armor_id / base_tool_id FK columns
-- (polymorphic — one is set per item, others NULL).
--
-- Existing `base_item TEXT` column (added 20260524-1800) stays as the
-- Foundry SRD slug source-of-truth. The importer resolves it to the
-- matching proficiency row at write time and populates the
-- corresponding FK; the slug stays for traceability / re-resolution
-- if the proficiency table is reorganised.

-- Weapon-shape columns. JSON for damage + range to mirror Foundry's
-- nested {base:{number,denomination,types,bonus}, versatile:{…}}
-- and {value, long, units} shapes exactly.
ALTER TABLE items ADD COLUMN damage TEXT;
ALTER TABLE items ADD COLUMN range TEXT;
ALTER TABLE items ADD COLUMN mastery TEXT;
ALTER TABLE items ADD COLUMN magical_bonus INTEGER;
ALTER TABLE items ADD COLUMN ammunition TEXT;
ALTER TABLE items ADD COLUMN proficient INTEGER;

-- Armor-shape columns. Stealth is a 0/1 boolean ("Disadvantage" when
-- truthy). armor_dex is the dex-cap (NULL = no cap, e.g. light armor;
-- 0 = "no dex", e.g. heavy armor).
ALTER TABLE items ADD COLUMN armor_value INTEGER;
ALTER TABLE items ADD COLUMN armor_dex INTEGER;
ALTER TABLE items ADD COLUMN armor_magical_bonus INTEGER;
ALTER TABLE items ADD COLUMN strength TEXT;
ALTER TABLE items ADD COLUMN stealth INTEGER;
ALTER TABLE items ADD COLUMN armor_type TEXT;

-- Tool-shape columns. tool_type maps to Foundry's `system.type.value`
-- (art / game / music / vehicle / kit / etc.). bonus is the
-- proficiency bonus override expression (mostly empty; magical tools
-- like "Robe of Useful Items" don't apply here).
ALTER TABLE items ADD COLUMN tool_type TEXT;
ALTER TABLE items ADD COLUMN bonus TEXT;

-- Polymorphic base-item FKs. One is set per item, the others stay
-- NULL. ON DELETE SET NULL so deleting a proficiency definition
-- nulls the reference instead of cascading and wiping the item —
-- the item itself is still valid, just orphaned from its category.
-- The importer (src/lib/itemImport.ts) resolves Foundry's
-- `system.type.baseItem` slug against weapons/armor/tools.identifier
-- and writes the matching id here.
ALTER TABLE items ADD COLUMN base_weapon_id TEXT REFERENCES weapons(id) ON DELETE SET NULL;
ALTER TABLE items ADD COLUMN base_armor_id TEXT REFERENCES armor(id) ON DELETE SET NULL;
ALTER TABLE items ADD COLUMN base_tool_id TEXT REFERENCES tools(id) ON DELETE SET NULL;

-- Indexes on the FKs so AdminProficiencies' "which items use this
-- base type?" query (when it lands) doesn't full-scan items.
CREATE INDEX IF NOT EXISTS idx_items_base_weapon ON items(base_weapon_id);
CREATE INDEX IF NOT EXISTS idx_items_base_armor  ON items(base_armor_id);
CREATE INDEX IF NOT EXISTS idx_items_base_tool   ON items(base_tool_id);

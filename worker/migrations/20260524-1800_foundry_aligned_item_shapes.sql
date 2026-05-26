-- Migration: Foundry-aligned item/weapon/armor/tool shapes
-- Date: 2026-05-24
--
-- Aligns Dauligor's compendium tables with dnd5e v5.3.1's `system.*`
-- block shapes so editors can round-trip cleanly to Foundry without
-- shape drift. See `Foundry-JSON/windows/` for the canonical reference.
--
-- Safe to drop existing flat columns because the four tables are
-- currently empty (no production data, confirmed 2026-05-24 by user
-- during the items folder export design pass).
--
-- ── items ─────────────────────────────────────────────────────────
-- BEFORE:
--   weight REAL DEFAULT 0
--   price_value REAL DEFAULT 0
--   price_denomination TEXT DEFAULT 'gp'
-- AFTER:
--   weight TEXT DEFAULT '{"value":0,"units":"lb"}'  -- JSON {value, units}
--   price  TEXT DEFAULT '{"value":0,"denomination":"gp"}'  -- JSON {value, denomination}
--
-- Matches Foundry's `system.weight` and `system.price` blocks.
-- Both are nested in dnd5e v5+ because weight can carry weight units
-- (lb/kg) and price can carry the coin denomination per row.
--
-- SQLite ALTER TABLE doesn't support DROP COLUMN before 3.35 reliably,
-- but D1 runs SQLite 3.43+ so we can use it. Per Dauligor convention,
-- create + swap to be safe across dev/prod parity.

-- 1. Add the new nested columns to items
ALTER TABLE items ADD COLUMN weight_new TEXT DEFAULT '{"value":0,"units":"lb"}';
ALTER TABLE items ADD COLUMN price TEXT DEFAULT '{"value":0,"denomination":"gp"}';
ALTER TABLE items ADD COLUMN properties TEXT DEFAULT '[]';  -- system.properties (mgc, ada, sil, …)
ALTER TABLE items ADD COLUMN base_item TEXT;                -- system.type.baseItem (SRD ref)

-- 2. Drop the legacy flat columns (table is empty, no migration needed)
ALTER TABLE items DROP COLUMN weight;
ALTER TABLE items DROP COLUMN price_value;
ALTER TABLE items DROP COLUMN price_denomination;
ALTER TABLE items RENAME COLUMN weight_new TO weight;

-- ── weapons ───────────────────────────────────────────────────────
-- Add the Foundry root-level weapon stats. dnd5e v5 stores these at
-- system.{damage:{base:{number,denomination,types,bonus}}, range:{value,long,units,reach}, mastery, magicalBonus}.
-- Plus the shared item fields (weight/price/rarity/attunement/properties/identifier/baseItem).
ALTER TABLE weapons ADD COLUMN damage TEXT DEFAULT '{"base":{"number":1,"denomination":6,"types":[],"bonus":""}}';
ALTER TABLE weapons ADD COLUMN range TEXT DEFAULT '{"value":5,"long":null,"units":"ft","reach":5}';
ALTER TABLE weapons ADD COLUMN mastery TEXT;
ALTER TABLE weapons ADD COLUMN magical_bonus INTEGER DEFAULT 0;
ALTER TABLE weapons ADD COLUMN weight TEXT DEFAULT '{"value":0,"units":"lb"}';
ALTER TABLE weapons ADD COLUMN price TEXT DEFAULT '{"value":0,"denomination":"gp"}';
ALTER TABLE weapons ADD COLUMN rarity TEXT DEFAULT 'none';
ALTER TABLE weapons ADD COLUMN attunement TEXT;            -- ''/'required'/'optional'
ALTER TABLE weapons ADD COLUMN properties TEXT DEFAULT '[]';
ALTER TABLE weapons ADD COLUMN base_item TEXT;
ALTER TABLE weapons ADD COLUMN proficient INTEGER;          -- null = inherit, 0 = not, 1 = yes
ALTER TABLE weapons ADD COLUMN ammunition TEXT;             -- linked ammo type slug

-- ── armor ─────────────────────────────────────────────────────────
-- dnd5e v5 stores armor as `system.armor:{value,dex,magicalBonus}` plus
-- `system.{strength, stealth}` for the heavy-armor STR req and the
-- Stealth-disadvantage flag. `system.type.value` carries the armor
-- category slug (light/medium/heavy/shield/natural).
ALTER TABLE armor ADD COLUMN armor_value INTEGER DEFAULT 10;       -- system.armor.value (AC)
ALTER TABLE armor ADD COLUMN armor_dex INTEGER;                     -- system.armor.dex (cap, null = no cap)
ALTER TABLE armor ADD COLUMN armor_magical_bonus INTEGER DEFAULT 0; -- system.armor.magicalBonus
ALTER TABLE armor ADD COLUMN strength INTEGER;                       -- system.strength (STR req, null = none)
ALTER TABLE armor ADD COLUMN stealth INTEGER DEFAULT 0;              -- system.stealth (disadvantage flag, 0/1)
ALTER TABLE armor ADD COLUMN armor_type TEXT DEFAULT 'light';        -- light/medium/heavy/shield/natural/clothing/trinket
ALTER TABLE armor ADD COLUMN weight TEXT DEFAULT '{"value":0,"units":"lb"}';
ALTER TABLE armor ADD COLUMN price TEXT DEFAULT '{"value":0,"denomination":"gp"}';
ALTER TABLE armor ADD COLUMN rarity TEXT DEFAULT 'none';
ALTER TABLE armor ADD COLUMN attunement TEXT;
ALTER TABLE armor ADD COLUMN properties TEXT DEFAULT '[]';
ALTER TABLE armor ADD COLUMN base_item TEXT;
ALTER TABLE armor ADD COLUMN proficient INTEGER;

-- ── tools ─────────────────────────────────────────────────────────
-- dnd5e v5 stores tool category at `system.type.value` (art/game/music/
-- vehicle) and the SRD base reference at `system.type.baseItem`. The
-- `system.ability` field is already present as `ability_id` (FK) in
-- the existing schema — no rename needed.
ALTER TABLE tools ADD COLUMN tool_type TEXT DEFAULT 'art';  -- art/game/music/vehicle
ALTER TABLE tools ADD COLUMN base_item TEXT;                 -- SRD ref like 'alchemist', 'lute'
ALTER TABLE tools ADD COLUMN weight TEXT DEFAULT '{"value":0,"units":"lb"}';
ALTER TABLE tools ADD COLUMN price TEXT DEFAULT '{"value":0,"denomination":"gp"}';
ALTER TABLE tools ADD COLUMN rarity TEXT DEFAULT 'none';
ALTER TABLE tools ADD COLUMN attunement TEXT;
ALTER TABLE tools ADD COLUMN properties TEXT DEFAULT '[]';
ALTER TABLE tools ADD COLUMN proficient INTEGER;
ALTER TABLE tools ADD COLUMN bonus TEXT;                     -- system.bonus (flat bonus to checks)

-- Indices on the new categorisation columns so list views can filter
-- without table scans.
CREATE INDEX IF NOT EXISTS idx_weapons_mastery ON weapons(mastery);
CREATE INDEX IF NOT EXISTS idx_weapons_rarity ON weapons(rarity);
CREATE INDEX IF NOT EXISTS idx_armor_type ON armor(armor_type);
CREATE INDEX IF NOT EXISTS idx_armor_rarity ON armor(rarity);
CREATE INDEX IF NOT EXISTS idx_tools_type ON tools(tool_type);

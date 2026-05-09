-- Migration: 0019 — Add `type` and `identifier` to scaling_columns
--
-- dnd5e's ScaleValueAdvancement schema requires a `type`
-- ("string" | "number" | "cr" | "dice" | "distance") and a stable
-- `identifier` per scale. The app was previously authoring without
-- either: type was implicit (defaulted to "number" via guess-on-export)
-- and identifier was slugify-from-name on save.
--
-- This causes two visible problems:
--   - Dice-valued scales (Sneak Attack, Sea Storm Aura, Superiority
--     Dice, Spirit Shield, Spiked Armor, etc.) silently break when
--     exported because dnd5e expects `{ number, faces, modifiers }`
--     entries for type="dice", not `{ value: "1d6" }`.
--   - Renaming a scaling column shifts its derived identifier and
--     silently invalidates every `@scale.<class>.<identifier>`
--     reference that uses it.
--
-- Default `type` to 'number' since most existing rows are numeric
-- (Rages, Maneuvers Known, Brutal Critical Dice, etc.). Admins can
-- flip dice-valued columns to type='dice' via the editor in a
-- follow-up pass.
--
-- `identifier` is nullable — the export already falls back to
-- slugify(name) when null, so existing rows continue to round-trip
-- the same identifier they have today. Setting it explicitly is the
-- recommended path for new rows.
--
-- `distance_units` is a small companion field for type='distance'
-- (rare in PHB classes — used for spell ranges scaled by level, etc.)

ALTER TABLE scaling_columns ADD COLUMN type TEXT NOT NULL DEFAULT 'number';
ALTER TABLE scaling_columns ADD COLUMN identifier TEXT;
ALTER TABLE scaling_columns ADD COLUMN distance_units TEXT;

CREATE INDEX IF NOT EXISTS idx_scaling_columns_identifier
  ON scaling_columns (identifier)
  WHERE identifier IS NOT NULL;

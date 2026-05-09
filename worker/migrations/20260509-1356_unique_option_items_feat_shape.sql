-- Migration: 0022 — option items become full feat-shape feature documents
--
-- Drops the linked-feature concept (feature_id, the half-built link to a
-- features row that supplied content). Option items now carry their own
-- mechanical content end-to-end. If a class feature wants to delegate to
-- a shared maneuver / invocation / infusion, it does so via the option
-- group in an ItemChoice / ItemGrant advancement, not by linking a
-- single feature row.
--
-- Adds the feat-shape columns to mirror what `features` already carries:
-- subtype, uses, properties, activities, effects, advancements, tags,
-- quantity / scaling column links, etc. Per dnd5e v5.x, Battle Master
-- Maneuvers, Eldritch Invocations, and Artificer Infusions all embed as
-- `feat`-typed items with these same fields populated:
--   - Maneuvers   → `system.type.subtype = "Maneuver"`, activities with
--                   itemUses consumption pointing at Superiority Dice.
--   - Invocations → `system.type.subtype = "EldritchInvocation"`,
--                   mostly Effects (passive); some grant spells via
--                   ItemGrant advancements.
--   - Infusions   → `system.type.subtype = "Infusion"`, mostly Effects
--                   that apply to a target item.
-- (See https://github.com/foundryvtt/dnd5e/wiki/Activities and
-- https://github.com/foundryvtt/dnd5e/issues/4367.)
--
-- The existing option-specific columns stay alongside the feat-shape
-- additions:
--   - level_prerequisite (option's own level gate; distinct from
--     features.prerequisites_level which targets feature IDs)
--   - string_prerequisite (free-text gate)
--   - is_repeatable (mirrors features.repeatable)
--   - class_ids (option-only — restricts which classes see the option
--     in the AdvancementManager picker; class features are bound to
--     a single parent already)
--   - requires_option_ids (option-only — sibling-option prereq chain
--     within the same group)

-- 1. Drop the half-built linked-feature column + its index.
DROP INDEX IF EXISTS idx_unique_option_items_feature_id;
ALTER TABLE unique_option_items DROP COLUMN feature_id;

-- 2. Feat-shape body (mirrors `features` columns of the same names so
--    authoring + export logic stays parallel).
ALTER TABLE unique_option_items ADD COLUMN feature_type TEXT;
ALTER TABLE unique_option_items ADD COLUMN subtype TEXT;
ALTER TABLE unique_option_items ADD COLUMN requirements TEXT;
ALTER TABLE unique_option_items ADD COLUMN image_url TEXT;
ALTER TABLE unique_option_items ADD COLUMN uses_max TEXT;
ALTER TABLE unique_option_items ADD COLUMN uses_spent INTEGER DEFAULT 0;
ALTER TABLE unique_option_items ADD COLUMN uses_recovery TEXT DEFAULT '[]';
ALTER TABLE unique_option_items ADD COLUMN properties TEXT DEFAULT '[]';
ALTER TABLE unique_option_items ADD COLUMN activities TEXT DEFAULT '[]';
ALTER TABLE unique_option_items ADD COLUMN effects TEXT DEFAULT '[]';
ALTER TABLE unique_option_items ADD COLUMN advancements TEXT DEFAULT '[]';
ALTER TABLE unique_option_items ADD COLUMN tags TEXT DEFAULT '[]';
ALTER TABLE unique_option_items ADD COLUMN quantity_column_id TEXT;
ALTER TABLE unique_option_items ADD COLUMN scaling_column_id TEXT;

CREATE INDEX IF NOT EXISTS idx_unique_option_items_feature_type
  ON unique_option_items (feature_type)
  WHERE feature_type IS NOT NULL;

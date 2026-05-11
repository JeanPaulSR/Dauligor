-- Migration: requirements tree replaces flat requires_option_ids + standalone
-- `requirements` text column.
--
-- Background
-- ----------
-- Today an option item's prereqs live in three independent columns:
--   - level_prerequisite (int)
--   - string_prerequisite (text, free-form)
--   - requires_option_ids (JSON array of sibling option IDs — single AND list)
--   - requirements (text, free-form — redundant with string_prerequisite)
--
-- That's enough for "Level 5 AND String X AND must-have-picked Y", but not
-- for compound feats like Ultimate Pact Weapon (UA), which needs
--   AND { Pact of the Blade, Superior Pact Weapon (UA) }
-- where the leaves cross option groups and may grow to other entity kinds
-- (class / subclass / spell / spell-rule / feature / ability score / proficiency).
--
-- This migration introduces a single JSON tree column that captures
-- arbitrary And/Or/Xor compositions of typed leaves. See
-- `src/lib/requirements.ts` for the runtime shape.
--
-- What we keep
-- ------------
--   - level_prerequisite (still common — most options gate on level only)
--   - string_prerequisite (free-text gate; still authored directly)
--
-- What we add
-- -----------
--   - requirements_tree (TEXT, JSON-encoded Requirement | null)
--   - level_prereq_is_total (INTEGER bool 0/1; default 0)
--       0 = level_prerequisite is the level *in the importing class* (default;
--           matches how today's option items are gated — picked during a
--           class advancement, so "level 5" means "fighter 5" for a Battle
--           Master Maneuver).
--       1 = level_prerequisite is total character level (rare; e.g. a
--           feat-style option that requires character level 4 regardless of
--           class). The new option-modal exposes this as a checkbox next to
--           the level number.
--
-- What we drop
-- ------------
--   - requires_option_ids — backfilled into requirements_tree as a top-level
--     `all` group of `optionItem` leaves before drop.
--   - requirements — redundant with string_prerequisite. Backfilled onto
--     string_prerequisite when string_prerequisite is empty, then dropped.
--
-- Feats
-- -----
-- feats table also gets requirements_tree. We don't add level_prereq_is_total
-- to feats because feats don't have a flat level_prerequisite column — when
-- a feat needs a level gate, the author adds a `level` leaf inside the tree
-- with its own isTotal flag.

-- ===== unique_option_items =====

ALTER TABLE unique_option_items ADD COLUMN requirements_tree TEXT;
ALTER TABLE unique_option_items ADD COLUMN level_prereq_is_total INTEGER NOT NULL DEFAULT 0;

-- Backfill requires_option_ids → requirements_tree.
-- Wrap each requirement id as { kind: 'leaf', type: 'optionItem', itemId: <id> }
-- under a top-level `all` group, matching the previous AND semantics.
UPDATE unique_option_items
SET requirements_tree = (
  SELECT json_object(
    'kind', 'all',
    'children', json_group_array(
      json_object('kind', 'leaf', 'type', 'optionItem', 'itemId', value)
    )
  )
  FROM json_each(unique_option_items.requires_option_ids)
)
WHERE requires_option_ids IS NOT NULL
  AND requires_option_ids != ''
  AND requires_option_ids != '[]'
  AND json_array_length(requires_option_ids) > 0;

-- Backfill `requirements` text onto `string_prerequisite` when the latter is
-- empty. If both are populated we keep string_prerequisite (the newer field)
-- and discard requirements; if only requirements was populated, we promote it.
UPDATE unique_option_items
SET string_prerequisite = requirements
WHERE (string_prerequisite IS NULL OR string_prerequisite = '')
  AND requirements IS NOT NULL
  AND requirements != '';

-- Drop the deprecated columns. D1 (SQLite ≥ 3.35) supports DROP COLUMN
-- directly, no table rebuild needed.
ALTER TABLE unique_option_items DROP COLUMN requires_option_ids;
ALTER TABLE unique_option_items DROP COLUMN requirements;

-- ===== feats =====

ALTER TABLE feats ADD COLUMN requirements_tree TEXT;

-- We leave feats.requirements (free-text) in place — it's the conventional
-- D&D feat prerequisite string ("Strength 13 or higher") and predates the
-- requirements_tree concept. Authors who want structured composition author
-- in the tree; the free-text column stays as the fallback display surface.

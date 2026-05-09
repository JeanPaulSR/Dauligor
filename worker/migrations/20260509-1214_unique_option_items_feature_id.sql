-- Migration: 0021 — Add `feature_id` to unique_option_items
--
-- Each option item (a Maneuver, an Eldritch Invocation, a Fighting
-- Style, etc.) is a stub by default — it carries display metadata
-- (name, description, prereqs) but no activities or damage. The actual
-- mechanical content lives in a feature row in the `features` table.
-- This column lets an option point at the feature that backs it, so
-- when the user picks "Trip Attack" from the Maneuvers group at
-- import time, the bridge embeds the Trip Attack feature's full
-- content (activities, uses, advancements) on the actor — using the
-- option's metadata (sourceId, levelPrerequisite, requiresOptionIds,
-- usesFeatureSourceId) as flags on top.
--
-- Half of the wiring already exists in the export: denormalizeOptionItemRow
-- reads feature_id → featureId, and the bundle resolves a linkedFeature
-- when present. The column was just never created and the editor never
-- exposed a picker.
--
-- Nullable: most existing option items don't have a backing feature
-- yet (or never will, for purely-cosmetic groups). Default null.

ALTER TABLE unique_option_items ADD COLUMN feature_id TEXT;

CREATE INDEX IF NOT EXISTS idx_unique_option_items_feature_id
  ON unique_option_items (feature_id)
  WHERE feature_id IS NOT NULL;

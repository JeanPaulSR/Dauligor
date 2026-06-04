-- Let a `background_features` row be OWNED by a specific background.
--
-- Mirrors how class features hang off their class (parent_id/parent_type): a
-- background authors its own feature(s) (the 2014 "Feature: …" block) in a
-- Features tab on the background editor, and those rows carry the owning
-- background's id here. NULL = a standalone catalog feature (the existing
-- CompendiumFeatureEditor behaviour) — both coexist.
--
-- Plain TEXT FK to backgrounds(id), ON DELETE CASCADE so purging/deleting a
-- background takes its owned features with it. Indexed for the per-background
-- list query in the editor.
--
-- D1 NOTE: no user BEGIN/COMMIT/PRAGMA — D1 wraps each migration atomically.

ALTER TABLE background_features
  ADD COLUMN parentBackgroundId TEXT REFERENCES backgrounds(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_background_features_parent
  ON background_features(parentBackgroundId);

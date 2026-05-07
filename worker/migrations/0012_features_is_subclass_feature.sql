-- Migration: Phase 4d.1 — features.is_subclass_feature
-- Description: Adds an explicit column for "Subclass Choice Point" placeholder
-- features (e.g. Sorcerous Origin, Bard College, Divine Domain). The Firestore
-- source has this as a top-level boolean; the original migration dropped it.

ALTER TABLE features ADD COLUMN is_subclass_feature INTEGER DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_features_is_subclass_feature ON features(is_subclass_feature) WHERE is_subclass_feature = 1;

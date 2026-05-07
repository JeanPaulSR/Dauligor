-- Migration: 0014 — Firestore→D1 field drift fixes
-- Adds columns identified by the field-universe audit as silently dropped
-- on every save. Each was confirmed ALIVE (read AND written by current
-- editors) before being added here; legacy/computed/derived fields were
-- intentionally left out.

-- features: scaling references and per-feature icon (separate from image_url)
ALTER TABLE features ADD COLUMN quantity_column_id TEXT;
ALTER TABLE features ADD COLUMN scaling_column_id TEXT;
ALTER TABLE features ADD COLUMN icon_url TEXT;
CREATE INDEX IF NOT EXISTS idx_features_scaling_column ON features(scaling_column_id) WHERE scaling_column_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_features_quantity_column ON features(quantity_column_id) WHERE quantity_column_id IS NOT NULL;

-- attributes: editor flavor text
ALTER TABLE attributes ADD COLUMN description TEXT;

-- languages: display ordering (column name "order" is reserved, must be quoted at use sites)
ALTER TABLE languages ADD COLUMN "order" INTEGER DEFAULT 0;

-- campaigns: image variants (mirror what classes/lore already have)
ALTER TABLE campaigns ADD COLUMN preview_image_url TEXT;
ALTER TABLE campaigns ADD COLUMN card_image_url TEXT;
ALTER TABLE campaigns ADD COLUMN background_image_url TEXT;

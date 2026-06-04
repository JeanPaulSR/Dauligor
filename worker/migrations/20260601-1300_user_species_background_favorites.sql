-- Per-user favorites for the public Species + Background browsers.
-- Mirrors user_feat_favorites (20260525-1600) / user_spell_favorites
-- (20260514-1522): account-level "starred for later" sets, synced for
-- signed-in users; anonymous users keep favorites in localStorage (the
-- client hook merges on login). One table per entity — matches the
-- feats/items/spells convention + the "new table for new functionality"
-- principle. Universal scope only (no per-character variant).
--
-- Accessed exclusively through the server endpoints
-- (functions/api/species-favorites.ts / background-favorites.ts via
-- executeD1QueryInternal), which derive user_id from the verified token.
-- Not part of the client d1.ts collection layer, so no D1_TABLE_MAP /
-- PERSISTENT_TABLES entry is needed.

CREATE TABLE IF NOT EXISTS user_species_favorites (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  species_id TEXT NOT NULL REFERENCES species(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, species_id)
);

CREATE INDEX IF NOT EXISTS idx_user_species_favorites_user
  ON user_species_favorites(user_id);

CREATE TABLE IF NOT EXISTS user_background_favorites (
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  background_id TEXT NOT NULL REFERENCES backgrounds(id) ON DELETE CASCADE,
  created_at    TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, background_id)
);

CREATE INDEX IF NOT EXISTS idx_user_background_favorites_user
  ON user_background_favorites(user_id);

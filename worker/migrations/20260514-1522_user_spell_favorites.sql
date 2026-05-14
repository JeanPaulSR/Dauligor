-- Per-user spell favorites for the public /compendium/spells browser.
--
-- Decoupled from character_spells.is_favourite (per-character spell-row
-- state used by the Spellbook Manager — that's "this spell is on this
-- character's favorites strip"). This is account-level "starred for
-- later" state from the catalogue view, synced across devices for
-- logged-in users.
--
-- Anonymous users keep their favorites in localStorage only; the hook
-- in src/lib/spellFavorites.ts treats this table as the cloud copy
-- and merges with localStorage on login.

CREATE TABLE IF NOT EXISTS user_spell_favorites (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  spell_id   TEXT NOT NULL REFERENCES spells(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, spell_id)
);

CREATE INDEX IF NOT EXISTS idx_user_spell_favorites_user
  ON user_spell_favorites(user_id);

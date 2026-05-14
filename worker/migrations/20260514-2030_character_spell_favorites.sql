-- Per-character spell favorites for the public /compendium/spells browser.
--
-- Sibling to user_spell_favorites (universal scope). Users can star a
-- spell against a specific character of theirs from the favorites-
-- scope dropdown; those toggles land here.
--
-- user_id is denormalized onto the row for two reasons:
--   1. Defense in depth — the endpoint always derives user_id from
--      the verified token and pins INSERT/DELETE/SELECT to that
--      user_id, so even if a request tries to read another user's
--      character's favorites the WHERE clause filters them out.
--   2. Cascade-delete still works even if a character is reassigned
--      (today we have no such flow, but it keeps the schema cheap
--      to reason about).
--
-- Anonymous users obviously can't have characters, so this table only
-- ever has rows for authenticated callers — the endpoint short-
-- circuits everything else.

CREATE TABLE IF NOT EXISTS character_spell_favorites (
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  spell_id     TEXT NOT NULL REFERENCES spells(id) ON DELETE CASCADE,
  created_at   TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, character_id, spell_id)
);

CREATE INDEX IF NOT EXISTS idx_character_spell_favorites_character
  ON character_spell_favorites(character_id);

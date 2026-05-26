-- Per-user feat favorites for the public /compendium/feats browser.
--
-- Mirrors `user_spell_favorites` (see 20260514-1522 migration). The
-- decoupling rationale carries over: `feats.repeatable` or any other
-- per-feat row state is a property of the feat itself; this table
-- holds account-level "starred for later" state from the browser
-- view, synced across devices for logged-in users.
--
-- No per-character variant. Spells have one (character_spell_favorites)
-- because spell prep is character-scoped — a wizard's favorite spells
-- differ from a sorcerer's; for feats we expose only the universal
-- "favorite this for later" set. If per-character feat favorites ever
-- becomes useful, add a parallel `character_feat_favorites` table the
-- same way the spell side does.
--
-- Anonymous users keep their favorites in localStorage only; the hook
-- in src/lib/featFavorites.ts treats this table as the cloud copy and
-- merges with localStorage on login (same union-merge algorithm
-- spellFavorites uses).

CREATE TABLE IF NOT EXISTS user_feat_favorites (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feat_id    TEXT NOT NULL REFERENCES feats(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, feat_id)
);

CREATE INDEX IF NOT EXISTS idx_user_feat_favorites_user
  ON user_feat_favorites(user_id);

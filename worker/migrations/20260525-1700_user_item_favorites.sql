-- Per-user item favorites for the public /compendium/items browser.
--
-- Mirrors `user_spell_favorites` + `user_feat_favorites`. The items
-- catalogue spans four tables (items, weapons, armor, tools), but the
-- favorites table stores just the ID — the unified ItemList resolves
-- those IDs against each per-table corpus client-side, so the
-- favorites table doesn't need to know which kind of item a given ID
-- refers to. (Item IDs are UUID-style and unique across all four
-- tables; collisions would require manual editing.)
--
-- No FOREIGN KEY back to a specific items table for the same reason
-- — the row's "kind" is determined by which table actually has a row
-- with that ID. A favorite for an item that's later deleted simply
-- doesn't render in the favorites pane (the resolver filters to
-- rows present in the loaded corpus).
--
-- Universal scope only. Per-character item favorites are not a
-- concept in 5e the way per-character spell prep is.

CREATE TABLE IF NOT EXISTS user_item_favorites (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id    TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_user_item_favorites_user
  ON user_item_favorites(user_id);

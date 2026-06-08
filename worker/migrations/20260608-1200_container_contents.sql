-- Migration: container_contents — catalog/template container recipe.
-- Date: 2026-06-08
--
-- A compendium container (a starting pack like Explorer's Pack) defines a
-- *recipe* of contents: references to catalog items + a quantity, with a
-- custom fallback for one-offs that aren't catalog items. This is the
-- TEMPLATE layer.
--
-- Per-character bag instances live in `character_inventory` (independent
-- copies that carry instance state) — they are MATERIALIZED by expanding
-- this recipe when a container is added to / imported onto a character, so
-- editing a character's bag never touches this list. Foundry round-trip:
-- export expands each row into a child item document with system.container;
-- import collapses children → rows (catalog match → reference, else custom).
--
-- Idempotent: IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS container_contents (
  id           TEXT PRIMARY KEY,
  container_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,  -- the container/pack
  item_id      TEXT,                          -- → items.id (catalog ref); NULL when custom
  is_custom    INTEGER NOT NULL DEFAULT 0,     -- 1 = inline one-off (custom_data), not a catalog item
  custom_data  TEXT,                           -- JSON item snapshot when is_custom = 1
  quantity     INTEGER NOT NULL DEFAULT 1,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT,
  updated_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_container_contents_container
  ON container_contents(container_id);

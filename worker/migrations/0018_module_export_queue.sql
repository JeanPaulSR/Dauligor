-- Migration: 0018 — Module-export rebake queue
-- Tracks "needs rebake" intents from editor saves so the R2-cached export
-- bundles in `module-export/v2/...` can be regenerated on a debounced
-- schedule (default ~1h after last edit) instead of every save. Manual
-- "Bake Now" actions and lazy-on-read processors both consume + clear
-- entries from this table.
--
-- entity_kind values currently in use:
--   class            — `<source>/classes/<identifier>.json` + that source's catalog
--   subclass         — parent class bundle (subclass nests inside)
--   feature          — parent class bundle (cascade up if parent is a subclass)
--   scalingColumn    — parent class bundle
--   optionGroup      — every class whose advancements reference the group
--   optionItem       — every class whose advancements reference the parent group
--   source           — top-level catalog + that source's class catalog + per-class bundles
--
-- last_edit_at is unix-ms epoch (matches the rest of the schema's timestamp
-- columns) and is bumped on every queue-rebake call so consecutive saves on
-- the same entity reset the debounce window.

CREATE TABLE IF NOT EXISTS module_export_queue (
  entity_kind TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  last_edit_at INTEGER NOT NULL,
  PRIMARY KEY (entity_kind, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_module_export_queue_last_edit_at
  ON module_export_queue (last_edit_at);

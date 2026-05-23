-- Add two nullable columns to the `tags` table for Phase 2 of the
-- TagsExplorer redesign:
--   • description       — free-text markdown describing the tag.
--                          Surfaces as the row tooltip in the tree
--                          and as a context block in the tag detail
--                          panel. Optional.
--   • linked_article_id — pointer at a lore_articles row that goes
--                          deeper on the concept. Common on
--                          doctrinal tags (schools of magic, lore
--                          factions, etc.). Optional.
--
-- Both are added as plain TEXT NULL with no DB-level constraint. The
-- app validates the linked_article_id at write time (the picker pulls
-- from lore_articles directly), and SQLite's ALTER TABLE doesn't
-- support adding a FK constraint inline anyway. If we ever want
-- strict referential integrity we can do a table-rebuild migration
-- following the same shape as 20260512-1418_tags_parent_aware_unique.sql.
--
-- D1 notes: wrangler runs these statements one at a time inside a
-- D1-managed transaction. ALTER TABLE ADD COLUMN is well-supported
-- for nullable columns without defaults. No PRAGMA or BEGIN/COMMIT
-- here — D1 rejects both.

ALTER TABLE tags ADD COLUMN description TEXT;
ALTER TABLE tags ADD COLUMN linked_article_id TEXT;

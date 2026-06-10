-- Retire the legacy storyteller-secret + dm-notes schema. Storyteller notes are
-- now `note` blocks and secrets are `secret` blocks (see the 20260610-1200
-- backfill); nothing reads or writes these tables / column anymore.
--
-- MUST run AFTER the block-only code is deployed (so live code never queries the
-- dropped objects) and AFTER 20260610-1200 (the secret->block backfill).
--
-- Junction tables drop first (they FK lore_secrets), then the table, then the
-- column. D1/SQLite supports ALTER TABLE ... DROP COLUMN.

DROP TABLE IF EXISTS lore_secret_campaigns;
DROP TABLE IF EXISTS lore_secret_eras;
DROP TABLE IF EXISTS lore_secrets;

ALTER TABLE lore_articles DROP COLUMN dm_notes;

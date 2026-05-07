-- Migration: 0015 — created_at on option tables
-- The Phase 1 schema for unique_option_groups and unique_option_items shipped
-- with only `updated_at`. Firestore source docs carry `createdAt`, and the
-- Foundry export contract emits it on every option entity. Adding the column
-- so migrate.js can preserve the original timestamp and the export round-trips
-- cleanly.

-- SQLite forbids non-constant defaults in ALTER TABLE ADD COLUMN, so the
-- created_at column is added without a default. Existing rows are backfilled
-- from updated_at; new rows are populated by application code (migrate.js
-- mappers + editor save handlers).
ALTER TABLE unique_option_groups ADD COLUMN created_at DATETIME;
ALTER TABLE unique_option_items  ADD COLUMN created_at DATETIME;

UPDATE unique_option_groups SET created_at = updated_at WHERE created_at IS NULL;
UPDATE unique_option_items  SET created_at = updated_at WHERE created_at IS NULL;

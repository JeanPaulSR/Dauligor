-- ============================================================================
-- !!! DANGER - DESTRUCTIVE - DROPS EVERY TABLE - NOT A MIGRATION !!!
-- ============================================================================
-- Manual, LOCAL-ONLY "fresh start" helper. Kept OUT of worker/migrations/ on
-- purpose so `wrangler d1 migrations apply` can NEVER pick it up and run it
-- (which would wipe the database).
--
-- NEVER run this against remote/production D1. On remote it destroys all
-- content and forces a restore from backup.
--
-- Use locally only when you deliberately want to rebuild local D1 from scratch:
--   wrangler d1 execute dauligor-db --local --file=worker/scripts/9999_cleanup.sql
-- then re-apply the migration files in order.
-- ============================================================================

-- Phase 2 tables (reverse dependency order)
DROP TABLE IF EXISTS campaign_members;
DROP TABLE IF EXISTS campaigns;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS eras;

-- Phase 1 tables (reverse dependency order)
DROP TABLE IF EXISTS unique_option_items;
DROP TABLE IF EXISTS unique_option_groups;
DROP TABLE IF EXISTS multiclass_master_chart;
DROP TABLE IF EXISTS spellcasting_progressions;
DROP TABLE IF EXISTS spellcasting_types;
DROP TABLE IF EXISTS armor;
DROP TABLE IF EXISTS weapons;
DROP TABLE IF EXISTS tools;
DROP TABLE IF EXISTS skills;
DROP TABLE IF EXISTS status_conditions;
DROP TABLE IF EXISTS condition_categories;
DROP TABLE IF EXISTS damage_types;
DROP TABLE IF EXISTS attributes;
DROP TABLE IF EXISTS languages;
DROP TABLE IF EXISTS language_categories;
DROP TABLE IF EXISTS tool_categories;
DROP TABLE IF EXISTS weapon_properties;
DROP TABLE IF EXISTS weapon_categories;
DROP TABLE IF EXISTS armor_categories;
DROP TABLE IF EXISTS tags;
DROP TABLE IF EXISTS tag_groups;
DROP TABLE IF EXISTS sources;
DROP TABLE IF EXISTS image_metadata;

-- Legacy tables from old migrations (safe to ignore if they don't exist)
DROP TABLE IF EXISTS classes;
DROP TABLE IF EXISTS spells;
DROP TABLE IF EXISTS lore_articles;
DROP TABLE IF EXISTS d1_migrations;

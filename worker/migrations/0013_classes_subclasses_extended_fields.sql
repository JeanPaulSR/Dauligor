-- Migration: Phase 4d.2 — restore class + subclass fields the migrate script silently dropped
--
-- Discovered when ClassEditor and SubclassEditor save flows hit "no such column"
-- errors. The Firestore source has these fields on every doc; the original
-- migrate.js mapping in scripts/migrate.js didn't include them, so the column
-- was never created in D1, so the editor's save (which mirrors the field shape)
-- failed at INSERT OR REPLACE.

-- classes additions
ALTER TABLE classes ADD COLUMN wealth TEXT;
ALTER TABLE classes ADD COLUMN multiclass_proficiencies TEXT DEFAULT '{}';      -- JSON object: per-multiclass proficiency selections
ALTER TABLE classes ADD COLUMN excluded_option_ids TEXT DEFAULT '{}';            -- JSON map: per-feature option exclusions
ALTER TABLE classes ADD COLUMN asi_levels TEXT DEFAULT '[]';                     -- JSON array of integers (typical [4,8,12,16,19])
ALTER TABLE classes ADD COLUMN unique_option_mappings TEXT DEFAULT '[]';         -- JSON array: option-group → feature mappings

-- subclasses additions
ALTER TABLE subclasses ADD COLUMN identifier TEXT;
ALTER TABLE subclasses ADD COLUMN class_identifier TEXT;
ALTER TABLE subclasses ADD COLUMN lore TEXT;
ALTER TABLE subclasses ADD COLUMN card_image_url TEXT;
ALTER TABLE subclasses ADD COLUMN card_display TEXT DEFAULT '{}';
ALTER TABLE subclasses ADD COLUMN preview_image_url TEXT;
ALTER TABLE subclasses ADD COLUMN preview_display TEXT DEFAULT '{}';
ALTER TABLE subclasses ADD COLUMN tag_ids TEXT DEFAULT '[]';                     -- JSON array
ALTER TABLE subclasses ADD COLUMN excluded_option_ids TEXT DEFAULT '{}';
ALTER TABLE subclasses ADD COLUMN unique_option_group_ids TEXT DEFAULT '[]';

CREATE INDEX IF NOT EXISTS idx_subclasses_identifier ON subclasses(identifier);

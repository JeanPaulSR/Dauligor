-- Promote Backgrounds + Species (the 2024 name for "Race") out of the shared
-- `feats` table into their own dedicated tables. Roadmap Step 1 (see the
-- compendium-editor-roadmap + the "new table for new functionality" principle):
-- extracting a discriminator-typed subset back into its own table later is
-- painful, so these graduate to first-class tables now. Until now they lived in
-- `feats` with feat_type='race'/'background' as an intentional placeholder.
--
-- NAMING: the user-facing entity is "Species" (D&D 2024 rename of "Race"). The
-- Foundry export `type` stays "race" for dnd5e compatibility (see
-- api/_lib/_raceExport.ts) — so: table = `species`, UI says "Species", the
-- exporter still emits type:"race".
--
-- CAMELCASE COLUMNS: per the 2026-05-27 roadmap decision, new compendium tables
-- use camelCase column names from day one (Foundry is camelCase end-to-end; the
-- legacy snake_case tables migrate later). The client data layer
-- (src/lib/d1.ts upsertDocument / fetchDocument) is column-name-agnostic, so
-- camelCase columns round-trip WITHOUT the normalize/denormalize snake<->camel
-- mapping in compendium.ts. The JSON columns below must be added to queryD1's
-- auto-parse `jsonFields` list (startingEquipment / movement / senses /
-- creatureType; tags + advancements are already present) so reads come back
-- parsed.
--
-- These tables start EMPTY. Content arrives later via a Foundry-export importer
-- (152 backgrounds + 280 species) — a deliberate FOLLOW-UP step; the editors
-- land first to prove the schema before bulk-loading. Background
-- `advancements` / `startingEquipment` are empty in the current 5etools-sourced
-- data, but the columns ship anyway ("that may change later").
--
-- contentHash mirrors the other entity tables (migration 20260527-1420) so the
-- live-content bridge / update-detection work (Phase 4) treats Species +
-- Backgrounds like every other exported entity. NULL until a hash-on-upsert
-- path populates it; harmless empty until then.
--
-- D1 NOTE: no user `BEGIN`/`COMMIT`/`PRAGMA` — D1 wraps each migration
-- atomically and rejects those statements at the wrangler exec layer.

-- ─── backgrounds ──────────────────────────────────────────────────────────
-- dnd5e BackgroundData = AdvancementTemplate + ItemDescriptionTemplate +
-- StartingEquipmentTemplate. system.{startingEquipment[], wealth} are the
-- background-only fields; advancement + description + source are shared with
-- the feat machinery this table is graduating from.

CREATE TABLE IF NOT EXISTS backgrounds (
    id                TEXT PRIMARY KEY,
    name              TEXT NOT NULL,
    identifier        TEXT NOT NULL,                  -- slug; unique within source (index below)
    sourceId          TEXT REFERENCES sources(id),
    page              TEXT,
    description       TEXT,                           -- authored body; HTML-ized on Foundry export
    advancements      TEXT DEFAULT '[]',              -- JSON: dnd5e advancement entries (empty in current data)
    startingEquipment TEXT DEFAULT '[]',              -- JSON: EquipmentEntryData tree (empty in current data)
    wealth            TEXT DEFAULT '',                -- starting-gold roll formula (dnd5e FormulaField)
    tags              TEXT DEFAULT '[]',              -- JSON: tag id array
    imageUrl          TEXT,
    contentHash       TEXT,                           -- SHA-256 of canonical content (Phase 4 update detection)
    createdAt         DATETIME DEFAULT CURRENT_TIMESTAMP,
    updatedAt         DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_backgrounds_source ON backgrounds(sourceId);

-- Source-scoped uniqueness (same pattern as feats/items, migration
-- 20260526-2300): two sources may both ship "soldier"; one source may not ship
-- it twice. COALESCE collapses NULL sourceIds into one bucket so orphan rows
-- can't duplicate either (SQLite treats each NULL as distinct otherwise).
CREATE UNIQUE INDEX IF NOT EXISTS backgrounds_source_identifier_uniq
    ON backgrounds(COALESCE(sourceId, ''), identifier);

-- ─── species ────────────────────────────────────────────────────────────────
-- dnd5e RaceData = AdvancementTemplate + ItemDescriptionTemplate + the three
-- creature-shaped fields below. Racial traits themselves are ItemGrant / Size /
-- ScaleValue advancements (handled by AdvancementManager), stored in
-- `advancements`. Size is present on 279/280 species; ScaleValue on 10/280
-- (e.g. Dragonborn breath weapon).

CREATE TABLE IF NOT EXISTS species (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    identifier   TEXT NOT NULL,
    sourceId     TEXT REFERENCES sources(id),
    page         TEXT,
    description  TEXT,
    advancements TEXT DEFAULT '[]',                   -- JSON: Size + ScaleValue + ItemGrant advancement entries
    movement     TEXT DEFAULT '{}',                   -- JSON: MovementField {walk,fly,swim,climb,burrow,hover,units}
    senses       TEXT DEFAULT '{}',                   -- JSON: SensesField {darkvision,blindsight,tremorsense,truesight,units,special}
    creatureType TEXT DEFAULT '{}',                   -- JSON: CreatureTypeField {value,subtype,swarm,custom}
    tags         TEXT DEFAULT '[]',                   -- JSON: tag id array
    imageUrl     TEXT,
    contentHash  TEXT,
    createdAt    DATETIME DEFAULT CURRENT_TIMESTAMP,
    updatedAt    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_species_source ON species(sourceId);

CREATE UNIQUE INDEX IF NOT EXISTS species_source_identifier_uniq
    ON species(COALESCE(sourceId, ''), identifier);

-- Species Options — a reusable, modular library of racial traits (Darkvision,
-- Powerful Build, Fey Ancestry, …) attachable to MANY species, so a trait is
-- authored once and reused rather than recreated per species. See
-- docs/_drafts/species-options-design-2026-06-03.html.
--
-- Model (confirmed 2026-06-03): each option is a reusable FEATURE — feat-shaped,
-- like species_features (migration 20260601-1500) but explicitly a shared
-- library, distinct from a species's own bespoke features. Attaching an option
-- to a species grants it via an ItemGrant advancement on the species and embeds
-- the feature item in the species export bundle's features[] (mirrors the
-- background-features grant path). camelCase columns; the JSON ones
-- (advancements / activities / effects / uses / tags) are already in queryD1's
-- jsonFields auto-parse list, so only the D1_TABLE_MAP alias + PERSISTENT_TABLES
-- entry are added.
--
-- A species references its chosen options via a new JSON `speciesOptionIds`
-- column (below): a portable id array, consistent with the other camelCase
-- compendium tables (NO junction table). Deleting an option just leaves a
-- dangling id the export skips — no cascade needed. `speciesOptionIds` must be
-- added to queryD1's jsonFields list so reads come back parsed.
--
-- D1 NOTE: no user BEGIN/COMMIT/PRAGMA — D1 wraps each migration atomically.

CREATE TABLE IF NOT EXISTS species_options (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    identifier   TEXT NOT NULL,                  -- slug; unique within source (index below)
    sourceId     TEXT REFERENCES sources(id),
    page         TEXT,
    description  TEXT,                            -- authored body; HTML-ized on Foundry export
    advancements TEXT DEFAULT '[]',              -- JSON: sub-advancements (rare)
    activities   TEXT DEFAULT '[]',              -- JSON: dnd5e activities (an option with an action)
    effects      TEXT DEFAULT '[]',              -- JSON: ActiveEffect[]
    uses         TEXT,                            -- JSON: UsesField {max,spent,recovery,…}
    tags         TEXT DEFAULT '[]',              -- JSON: tag id array
    imageUrl     TEXT,
    contentHash  TEXT,
    createdAt    DATETIME DEFAULT CURRENT_TIMESTAMP,
    updatedAt    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_species_options_source ON species_options(sourceId);

-- Source-scoped uniqueness, same pattern as species/feats/items.
CREATE UNIQUE INDEX IF NOT EXISTS species_options_source_identifier_uniq
    ON species_options(COALESCE(sourceId, ''), identifier);

-- Which options a species includes — a JSON array of species_options ids.
ALTER TABLE species ADD COLUMN speciesOptionIds TEXT DEFAULT '[]';

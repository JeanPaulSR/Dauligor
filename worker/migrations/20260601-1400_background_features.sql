-- Background Features — a dedicated content type for the special
-- feature(s) a background grants (e.g. the 2014-style "Shelter of the
-- Faithful"). Per the 2026-06-01 design decision (docs/_drafts/
-- background-features-design-2026-06-01.html): a first-class table of
-- their own (NOT folded into `feats`, NOT embedded on the background
-- row), granted by backgrounds via ItemGrant advancements and exported
-- as Foundry feat-type items so they land on the character sheet.
--
-- Feat-shaped but lean + camelCase (new compendium table → camelCase
-- from day one, same as species/backgrounds). The JSON columns
-- (advancements / activities / effects / uses / tags) are already in
-- queryD1's jsonFields auto-parse list, so no d1.ts parse change is
-- needed — only the D1_TABLE_MAP alias + PERSISTENT_TABLES entry.
--
-- 2014-style features are HAND-AUTHORED here (the source has them only
-- as description prose, so there's no clean import); the 2024 Origin
-- Feat a background grants is a real feat in the `feats` table, granted
-- by ItemGrant — NOT a background_feature.

CREATE TABLE IF NOT EXISTS background_features (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    identifier   TEXT NOT NULL,                  -- slug; unique within source (index below)
    sourceId     TEXT REFERENCES sources(id),
    page         TEXT,
    description  TEXT,                            -- authored body; HTML-ized on Foundry export
    advancements TEXT DEFAULT '[]',              -- JSON: sub-advancements (rare — e.g. a feature granting a proficiency)
    activities   TEXT DEFAULT '[]',              -- JSON: dnd5e activities (a feature with an action)
    effects      TEXT DEFAULT '[]',              -- JSON: ActiveEffect[]
    uses         TEXT,                            -- JSON: UsesField {max,spent,recovery,…} (limited-use features)
    tags         TEXT DEFAULT '[]',              -- JSON: tag id array
    imageUrl     TEXT,
    contentHash  TEXT,
    createdAt    DATETIME DEFAULT CURRENT_TIMESTAMP,
    updatedAt    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_background_features_source ON background_features(sourceId);

-- Source-scoped uniqueness, same pattern as species/backgrounds/feats.
CREATE UNIQUE INDEX IF NOT EXISTS background_features_source_identifier_uniq
    ON background_features(COALESCE(sourceId, ''), identifier);

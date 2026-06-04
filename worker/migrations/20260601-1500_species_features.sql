-- Species Features — a dedicated content type for the feature(s) a species
-- grants (racial traits authored as first-class features, e.g. "Breath
-- Weapon", "Fey Ancestry"). Parallel to background_features (migration
-- 20260601-1400) per the 2026-06-01 direction: species get features +
-- advancements "like backgrounds". Their own table (NOT folded into feats
-- or features), granted by a species via ItemGrant advancements and
-- exported as Foundry feat-type items.
--
-- Feat-shaped, lean, camelCase. JSON columns (advancements / activities /
-- effects / uses / tags) are already in queryD1's jsonFields auto-parse
-- list, so only the D1_TABLE_MAP alias + PERSISTENT_TABLES entry are added.
--
-- (Note: many racial traits are simpler as Size / ScaleValue / Trait /
-- ItemGrant advancements directly on the species — features here are for
-- the named, describable traits a species wants as standalone content.)

CREATE TABLE IF NOT EXISTS species_features (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    identifier   TEXT NOT NULL,                  -- slug; unique within source (index below)
    sourceId     TEXT REFERENCES sources(id),
    page         TEXT,
    description  TEXT,                            -- authored body; HTML-ized on Foundry export
    advancements TEXT DEFAULT '[]',              -- JSON: sub-advancements (rare)
    activities   TEXT DEFAULT '[]',              -- JSON: dnd5e activities (a trait with an action, e.g. breath weapon)
    effects      TEXT DEFAULT '[]',              -- JSON: ActiveEffect[]
    uses         TEXT,                            -- JSON: UsesField {max,spent,recovery,…}
    tags         TEXT DEFAULT '[]',              -- JSON: tag id array
    imageUrl     TEXT,
    contentHash  TEXT,
    createdAt    DATETIME DEFAULT CURRENT_TIMESTAMP,
    updatedAt    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_species_features_source ON species_features(sourceId);

CREATE UNIQUE INDEX IF NOT EXISTS species_features_source_identifier_uniq
    ON species_features(COALESCE(sourceId, ''), identifier);

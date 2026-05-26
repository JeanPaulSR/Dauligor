-- Phase: identifier uniqueness becomes source-scoped on feats + items
-- ============================================================
-- The original `feats` (0005) and `items` (0004) tables each carry
-- `identifier TEXT NOT NULL UNIQUE`, which was the right invariant
-- before the importer started ingesting multi-source content.
-- Once the Foundry feat / item importers landed, this turned into a
-- real bug: when the user imports "Athlete" from PHB and "Athlete"
-- from Kibble Feats, the dedup query in src/lib/featImport.ts
-- correctly pairs (identifier, source_id) and assigns each row a
-- distinct primary key — but the column-level UNIQUE on identifier
-- fires at insert time and the whole batch fails with
-- SQLITE_CONSTRAINT_UNIQUE.
--
-- Desired invariant: identifiers are unique within their source.
-- Two sources that both ship "athlete" are allowed; one source
-- shipping "athlete" twice is not. The replacement constraint lives
-- in a UNIQUE INDEX rather than a table-level UNIQUE because we need
-- COALESCE(source_id, '') so orphan-source rows (source_id IS NULL)
-- can't collide with each other either (SQLite treats every NULL as
-- distinct in UNIQUE constraints — without COALESCE, multiple
-- orphan rows with the same identifier would slip through).
--
-- The items table gets the same fix in this migration. It carries
-- the identical latent bug — two sources with an item identifier
-- collision would fail identically — and fixing it now while we're
-- in the area saves a follow-up migration.
--
-- ORDER MATTERS: canonical SQLite 12-step rebuild order, same as
-- the 20260512-1418 tags rebuild. CREATE new → INSERT → DROP old →
-- RENAME new TO old. Modern SQLite (≥ 3.26, the D1 default) auto-
-- rewrites FK references in OTHER tables when we RENAME, so any
-- inbound FK that pointed at "feats" before the rebuild still
-- points at "feats" after. Inbound FKs to watch:
--   - user_feat_favorites.feat_id REFERENCES feats(id) ON DELETE CASCADE
--   - items.container_id REFERENCES items(id) ON DELETE SET NULL  (self-ref)
-- The self-FK inside items_new is declared against `items_new(id)`
-- below; the RENAME auto-rewrites it to `REFERENCES items(id)` per
-- SQLite's FK-rewrite-on-rename behavior. user_feat_favorites'
-- inbound FK is dangling during the brief window between
-- DROP TABLE feats and RENAME feats_new TO feats — fine, since
-- referencing rows survive table drop in SQLite (ON DELETE CASCADE
-- fires on row delete, not on table drop) and the new feats has
-- the same row IDs (the INSERT preserves them).
--
-- D1 SPECIFICS: Cloudflare D1 rejects user-supplied `BEGIN
-- TRANSACTION` / `COMMIT` and `PRAGMA` statements — transactions
-- are managed by the platform, and PRAGMA toggles aren't honored
-- at the wrangler exec layer. wrangler runs each statement
-- individually and D1 wraps the migration atomically on its side.
--
-- SAFETY: the new constraint is strictly weaker than the old (any
-- row satisfying the global UNIQUE also satisfies the composite
-- UNIQUE), so existing rows are guaranteed to fit through the
-- INSERT step without conflict.

-- ─── feats ─────────────────────────────────────────────────────

CREATE TABLE feats_new (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    identifier TEXT NOT NULL,
    feat_type TEXT NOT NULL DEFAULT 'general',
    source_type TEXT NOT NULL DEFAULT 'feat',
    requirements TEXT,
    repeatable INTEGER DEFAULT 0,
    uses_max TEXT,
    uses_spent INTEGER DEFAULT 0,
    description TEXT,
    image_url TEXT,
    activities TEXT DEFAULT '[]',
    effects TEXT DEFAULT '[]',
    source_id TEXT REFERENCES sources(id),
    page TEXT,
    tags TEXT DEFAULT '[]',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    requirements_tree TEXT,
    feat_subtype TEXT,
    uses_recovery TEXT DEFAULT '[]',
    advancements TEXT DEFAULT '[]'
);

INSERT INTO feats_new (
    id, name, identifier, feat_type, source_type, requirements, repeatable,
    uses_max, uses_spent, description, image_url, activities, effects,
    source_id, page, tags, created_at, updated_at, requirements_tree,
    feat_subtype, uses_recovery, advancements
)
SELECT
    id, name, identifier, feat_type, source_type, requirements, repeatable,
    uses_max, uses_spent, description, image_url, activities, effects,
    source_id, page, tags, created_at, updated_at, requirements_tree,
    feat_subtype, uses_recovery, advancements
FROM feats;

DROP TABLE feats;

ALTER TABLE feats_new RENAME TO feats;

-- Recreate the indexes that lived on the old table.
CREATE INDEX IF NOT EXISTS idx_feats_type        ON feats(feat_type);
CREATE INDEX IF NOT EXISTS idx_feats_source_type ON feats(source_type);
CREATE INDEX IF NOT EXISTS idx_feats_source      ON feats(source_id);

-- The replacement uniqueness: same source + same identifier is
-- forbidden. COALESCE collapses NULL source_ids (orphan rows) into
-- the empty-string bucket so duplicate orphans are still blocked.
CREATE UNIQUE INDEX IF NOT EXISTS feats_source_identifier_uniq
    ON feats(COALESCE(source_id, ''), identifier);

-- ─── items ─────────────────────────────────────────────────────

CREATE TABLE items_new (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    identifier TEXT NOT NULL,
    item_type TEXT NOT NULL DEFAULT 'loot',
    rarity TEXT DEFAULT 'none',
    quantity INTEGER DEFAULT 1,
    equipped INTEGER DEFAULT 0,
    identified INTEGER DEFAULT 1,
    magical INTEGER DEFAULT 0,
    description TEXT,
    image_url TEXT,
    activities TEXT DEFAULT '[]',
    effects TEXT DEFAULT '[]',
    source_id TEXT REFERENCES sources(id),
    page TEXT,
    tags TEXT DEFAULT '[]',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    weight TEXT DEFAULT '{"value":0,"units":"lb"}',
    price TEXT DEFAULT '{"value":0,"denomination":"gp"}',
    properties TEXT DEFAULT '[]',
    base_item TEXT,
    damage TEXT,
    range TEXT,
    mastery TEXT,
    magical_bonus INTEGER,
    ammunition TEXT,
    proficient INTEGER,
    armor_value INTEGER,
    armor_dex INTEGER,
    armor_magical_bonus INTEGER,
    strength TEXT,
    armor_type TEXT,
    tool_type TEXT,
    bonus TEXT,
    base_weapon_id TEXT REFERENCES weapons(id)    ON DELETE SET NULL,
    base_armor_id  TEXT REFERENCES armor(id)      ON DELETE SET NULL,
    base_tool_id   TEXT REFERENCES tools(id)      ON DELETE SET NULL,
    uses TEXT,
    -- Self-reference via the temp name. The RENAME below auto-
    -- rewrites this to `REFERENCES items(id)` (still a self-
    -- reference) per SQLite's FK-rewrite-on-rename behavior.
    container_id   TEXT REFERENCES items_new(id)  ON DELETE SET NULL,
    currency TEXT,
    capacity TEXT,
    chat_flavor TEXT,
    ability_id     TEXT REFERENCES attributes(id) ON DELETE SET NULL,
    type_subtype TEXT,
    unidentified_description TEXT,
    attunement TEXT DEFAULT ''
);

INSERT INTO items_new (
    id, name, identifier, item_type, rarity, quantity, equipped, identified,
    magical, description, image_url, activities, effects, source_id, page,
    tags, created_at, updated_at, weight, price, properties, base_item,
    damage, range, mastery, magical_bonus, ammunition, proficient,
    armor_value, armor_dex, armor_magical_bonus, strength, armor_type,
    tool_type, bonus, base_weapon_id, base_armor_id, base_tool_id, uses,
    container_id, currency, capacity, chat_flavor, ability_id, type_subtype,
    unidentified_description, attunement
)
SELECT
    id, name, identifier, item_type, rarity, quantity, equipped, identified,
    magical, description, image_url, activities, effects, source_id, page,
    tags, created_at, updated_at, weight, price, properties, base_item,
    damage, range, mastery, magical_bonus, ammunition, proficient,
    armor_value, armor_dex, armor_magical_bonus, strength, armor_type,
    tool_type, bonus, base_weapon_id, base_armor_id, base_tool_id, uses,
    container_id, currency, capacity, chat_flavor, ability_id, type_subtype,
    unidentified_description, attunement
FROM items;

DROP TABLE items;

ALTER TABLE items_new RENAME TO items;

-- Recreate the indexes that lived on the old table.
CREATE INDEX IF NOT EXISTS idx_items_type        ON items(item_type);
CREATE INDEX IF NOT EXISTS idx_items_rarity      ON items(rarity);
CREATE INDEX IF NOT EXISTS idx_items_source      ON items(source_id);
CREATE INDEX IF NOT EXISTS idx_items_base_weapon ON items(base_weapon_id);
CREATE INDEX IF NOT EXISTS idx_items_base_armor  ON items(base_armor_id);
CREATE INDEX IF NOT EXISTS idx_items_base_tool   ON items(base_tool_id);

-- Same composite uniqueness pattern as feats above.
CREATE UNIQUE INDEX IF NOT EXISTS items_source_identifier_uniq
    ON items(COALESCE(source_id, ''), identifier);

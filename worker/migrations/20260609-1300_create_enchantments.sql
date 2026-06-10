-- Enchantments: a first-class, reusable library of enchantment definitions —
-- the FIRST step of the crafting system (see
-- docs/_drafts/crafting-commerce-design-2026-06-09.html). An enchantment is NOT
-- an item you carry; it is a reusable EFFECT applied to many base items (Flame
-- Tongue = +2d6 fire on a shortsword OR a greatsword). So it graduates to its own
-- table rather than riding `items` (the "new table for new functionality" rule).
--
-- FOUNDRY MODEL (dnd5e 5.x): an enchantment is an Active Effect of
-- type:"enchantment" applied to an Item, delivered by an Enchant activity whose
-- `restrictions` gate which items are valid targets. Our `SemanticActivity.enchant`
-- (src/types/activities.ts) already mirrors this exactly, and the shared
-- ActivityEditor (`enchant` kind) + Active Effect editor author it today. The
-- Enchant activity's Restrictions tab already reads the reference taxonomies seeded
-- by migration 20260605-1200 (consumable_categories / loot_categories /
-- item_properties.valid_types) — this table's `restrictions` JSON references that
-- same vocabulary; we do NOT duplicate it here.
--
-- COLUMN SHAPE — what a row needs to reconstruct (a) an Enchant activity and
-- (b) its enchantment Active Effect(s):
--   restrictions : the activity's gate {allowMagical,type,categories[],properties[]}
--   effects      : the Active Effect document(s) (type:enchantment) — the actual
--                  changes (name override, system.magicalBonus, damage riders, AC…)
--   riders       : extras granted alongside {activity[],effect[],item[]}
-- magicalBonus / rarity / attunement / price are authoring + economy conveniences
-- (feed the later Magic-Items tab + Shop + crafting cost). Per-effect level gating
-- (effects[].level {min,max}) lives NESTED inside `effects` — we deliberately do NOT
-- add a top-level `level` column because d1.ts's jsonFields auto-parse list is
-- GLOBAL and a bare `level` would try to JSON-parse every table's scalar level.
--
-- CAMELCASE COLUMNS: per the 2026-05-27 roadmap decision, new compendium tables use
-- camelCase column names from day one (Foundry is camelCase end-to-end). The client
-- data layer (src/lib/d1.ts upsertDocument/fetchDocument) is column-name-agnostic, so
-- camelCase round-trips WITHOUT the snake<->camel mapping in compendium.ts. The JSON
-- columns below (restrictions / riders) are added to queryD1's auto-parse jsonFields
-- list + the server mirror's JSON_COLUMNS set (effects / tags / price already present).
--
-- contentHash mirrors the other entity tables (migration 20260527-1420) so the
-- live-content bridge / update-detection treats enchantments like any exported
-- entity. NULL until a hash-on-upsert path populates it; harmless until then.
--
-- Starts EMPTY: the editor lands first to prove the schema (Phase A); content is
-- authored by hand / imported later.
--
-- D1 NOTE: no user BEGIN/COMMIT/PRAGMA — D1 wraps each migration atomically and
-- rejects those statements at the wrangler exec layer.

CREATE TABLE IF NOT EXISTS enchantments (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    identifier    TEXT NOT NULL,                  -- slug; unique within source (index below)
    sourceId      TEXT REFERENCES sources(id),    -- ON DELETE not set → SET NULL semantics via app
    page          TEXT,
    description   TEXT,                            -- BBCode authored body
    imageUrl      TEXT,
    restrictions  TEXT DEFAULT '{}',              -- JSON {allowMagical,type,categories[],properties[]}
    effects       TEXT DEFAULT '[]',              -- JSON Active Effect[] (type:enchantment changes)
    riders        TEXT DEFAULT '{}',              -- JSON {activity[],effect[],item[]} granted alongside
    magicalBonus  INTEGER,                         -- convenience flat +N (mirrors items.magical_bonus)
    rarity        TEXT,                            -- rarity conferred (none|common|…|artifact)
    attunement    TEXT DEFAULT '',                -- '' | 'required' | 'optional'
    price         TEXT DEFAULT '{}',              -- JSON {value,denomination} — economy delta
    tags          TEXT DEFAULT '[]',              -- JSON tag id array
    contentHash   TEXT,                            -- SHA-256 of canonical content (update detection)
    createdAt     DATETIME DEFAULT CURRENT_TIMESTAMP,
    updatedAt     DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_enchantments_source ON enchantments(sourceId);

-- Source-scoped uniqueness (same pattern as feats/items/species, migration
-- 20260526-2300): two sources may both ship "flame-tongue"; one source may not ship
-- it twice. COALESCE collapses NULL sourceIds into one bucket so orphan rows can't
-- duplicate either (SQLite treats each NULL as distinct otherwise).
CREATE UNIQUE INDEX IF NOT EXISTS enchantments_source_identifier_uniq
    ON enchantments(COALESCE(sourceId, ''), identifier);

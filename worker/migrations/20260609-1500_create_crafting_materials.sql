-- Crafting materials: the crafting-domain catalog of raw/intermediate materials
-- (reagents, essences, ingots, hides, parts, wood, gems...). Per the user's design,
-- each material is BACKED BY a loot-type items row (type_subtype='material') as its
-- carryable "base item sheet" - so it stacks/prices/sells/saves to a character sheet
-- like any item - while THIS table holds the crafting-domain metadata.
--
-- Column set is the SLIM, authoring-focused set from the 2026-06-09 Kibbles
-- reconciliation (docs/_drafts/kibbles-reconciliation-2026-06-09.html): the material
-- taxonomy is category x rarity-tier x property/flavor (subtype) x used-for-discipline
-- x price. Deliberately DEFERRED (shop / Phase-D execution): equivalentGoldValue,
-- salvageable, sourceMetadata (harvest provenance) - add when the shop / harvesting
-- land. camelCase columns; source-scoped identifier uniqueness like enchantments/recipes.
--
-- D1 wraps each migration atomically - no BEGIN/COMMIT/PRAGMA.

CREATE TABLE IF NOT EXISTS crafting_materials (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    identifier    TEXT NOT NULL,                 -- slug; unique within source (index below)
    sourceId      TEXT REFERENCES sources(id),
    page          TEXT,
    description   TEXT,                           -- BBCode
    imageUrl      TEXT,
    itemId        TEXT REFERENCES items(id),      -- the backing carryable loot row (type_subtype='material'); NULL until paired
    category      TEXT NOT NULL,                  -- reagent|essence|magicalInk|metal|hide|wood|part|gem|cookingSupply|misc
    rarity        TEXT,                           -- trivial|common|uncommon|rare|veryRare|legendary (bare TEXT, app-validated)
    subtype       TEXT,                           -- category-specific flavor: reagent(curative|reactive|poisonous) | essence(arcane|divine|primal|psionic) | metal grade | wood quality | hide form
    usedFor       TEXT DEFAULT '[]',             -- JSON crafting_disciplines id array (many-to-many)
    price         TEXT DEFAULT '{}',             -- JSON {value, denomination} buy price (sell ~= half, derived)
    weight        TEXT DEFAULT '{}',             -- JSON {value, units} per-unit weight
    tags          TEXT DEFAULT '[]',             -- JSON tag id array
    contentHash   TEXT,
    createdAt     DATETIME DEFAULT CURRENT_TIMESTAMP,
    updatedAt     DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_crafting_materials_source   ON crafting_materials(sourceId);
CREATE INDEX IF NOT EXISTS idx_crafting_materials_category ON crafting_materials(category);
CREATE INDEX IF NOT EXISTS idx_crafting_materials_item     ON crafting_materials(itemId);

CREATE UNIQUE INDEX IF NOT EXISTS crafting_materials_source_identifier_uniq
    ON crafting_materials(COALESCE(sourceId, ''), identifier);

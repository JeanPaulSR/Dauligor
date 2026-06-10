-- Recipes: the UNIVERSAL creation rule — the spine of the crafting system
-- (design: docs/_drafts/crafting-commerce-design-2026-06-09.html;
-- schema: docs/database/structure/recipes.md). A recipe is "inputs → output":
-- it is the one mechanism behind everything craftable. Per the user's 2026-06-09
-- direction, recipes are foundational and come BEFORE the enchantments editor
-- because they are used "in the creation of all types of items, including
-- enchantments." Applying an enchantment to a base item is itself a recipe — so
-- recipes subsume the earlier one-off "bake/apply" flow.
--
-- This is an APP-NATIVE concept (Foundry dnd5e has no first-class "recipe"
-- document; the Bastion `facilities.craft` block is a narrow, facility-bound
-- mechanic, not a general engine). Foundry export of recipes is a later,
-- separate concern (module handoff) — this table is authored app-side first.
--
-- OUTPUT — three modes (the universal model), driven by `outputType`:
--   'item'         → produces `outputItemId` × `outputQuantity` (a potion, a refined
--                    material, a forged mundane item, OR a pre-authored magic item)
--   'enchantment'  → produces / teaches `outputEnchantmentId` (craft the enchantment
--                    DEFINITION itself — research/discovery)
--   'enchant-item' → applies `outputEnchantmentId` to `outputBaseItemId` → a magic
--                    item. `outputBaseItemId` NULL = any base valid per the
--                    enchantment's own `restrictions`, chosen at craft time.
-- The three nullable output FK columns mirror items' polymorphic base_*_id pattern
-- (exactly the relevant ones are set for the chosen mode).
--
-- INPUTS: `inputs` (consumed items/materials — a crafting material is its backing
-- loot item, so inputs reference items.id), `goldCost`, `craftTime`,
-- `craftRequirements` (tool proficiency / min level / spells / features). Tools are
-- a requirement, not consumed; gold is `goldCost`, not an input row.
--
-- CAMELCASE COLUMNS (2026-05-27 convention) — no compendium.ts alias layer. The
-- JSON columns use DISTINCTIVE names (inputs / goldCost / craftTime /
-- craftRequirements) added to d1.ts jsonFields + the server mirror; deliberately
-- NOT bare `time`/`cost`/`requirements`, since that auto-parse list is GLOBAL and
-- generic names risk colliding with other tables' scalar columns.
--
-- Starts EMPTY (editor lands first to prove the schema). contentHash mirrors the
-- other entity tables. D1 wraps each migration atomically — no BEGIN/COMMIT/PRAGMA.

CREATE TABLE IF NOT EXISTS recipes (
    id                  TEXT PRIMARY KEY,
    name                TEXT NOT NULL,
    identifier          TEXT NOT NULL,                 -- slug; unique within source (index below)
    sourceId            TEXT REFERENCES sources(id),
    page                TEXT,
    description         TEXT,                          -- BBCode
    imageUrl            TEXT,
    disciplineId        TEXT REFERENCES crafting_disciplines(id),  -- organizing axis (Alchemy/Blacksmithing/Enchanting/...); taxonomy seeded by migration 20260609-1350

    -- OUTPUT (what it makes)
    outputType          TEXT NOT NULL DEFAULT 'item'
                          CHECK (outputType IN ('item','enchantment','enchant-item')),
    outputItemId        TEXT REFERENCES items(id),        -- mode 'item'
    outputEnchantmentId TEXT REFERENCES enchantments(id), -- mode 'enchantment' | 'enchant-item'
    outputBaseItemId    TEXT REFERENCES items(id),        -- mode 'enchant-item' (NULL = any valid base)
    outputQuantity      INTEGER DEFAULT 1,

    -- INPUTS (what it consumes / requires)
    inputs              TEXT DEFAULT '[]',   -- JSON [{itemId, quantity}] consumed materials/items
    goldCost            TEXT DEFAULT '{}',   -- JSON {value, denomination}
    craftTime           TEXT DEFAULT '{}',   -- JSON {value, unit}  e.g. {value:8, unit:'hour'}
    craftRequirements   TEXT DEFAULT '{}',   -- JSON {tools:[toolId], minLevel, spells:[id], features:[id], custom}
    -- Per-recipe crafting numbers — the two canonical Kibbles table columns
    -- (Name | Materials | Time | CHECKS | DIFFICULTY | Rarity | Value). Intrinsic to
    -- the recipe (not derivable from the output). Author-entered, store-only: do NOT
    -- compute craftChecks as craftTime/2 — Kibbles documents real exceptions.
    craftChecks         INTEGER,             -- number of successful crafting rolls required
    craftDifficultyDC   INTEGER,             -- the per-check DC (no range constraint; allows large sentinels)

    tags                TEXT DEFAULT '[]',
    contentHash         TEXT,
    createdAt           DATETIME DEFAULT CURRENT_TIMESTAMP,
    updatedAt           DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_recipes_source             ON recipes(sourceId);
CREATE INDEX IF NOT EXISTS idx_recipes_discipline         ON recipes(disciplineId);
CREATE INDEX IF NOT EXISTS idx_recipes_output_item        ON recipes(outputItemId);
CREATE INDEX IF NOT EXISTS idx_recipes_output_enchantment ON recipes(outputEnchantmentId);

-- Source-scoped slug uniqueness (same pattern as items/feats/enchantments).
CREATE UNIQUE INDEX IF NOT EXISTS recipes_source_identifier_uniq
    ON recipes(COALESCE(sourceId, ''), identifier);

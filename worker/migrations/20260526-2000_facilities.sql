-- ─────────────────────────────────────────────────────────────────────
-- 20260526-2000  Facilities (Bastions) — separate table + page
--
-- Added per the items-completeness handoff (docs/handoff-items-completeness-
-- 2026-05-26.md → C7). Facilities are dnd5e v5's Bastion system from the
-- 2024 DMG — distinct from the items table because they carry a heavily
-- different shape (orders/progress/trade/craft sub-objects, defender +
-- hireling rosters, build state) and a much smaller catalog (~30 special
-- subtypes vs 1700+ items). They live at their own route, /compendium/
-- facilities, with their own importer routing.
--
-- Schema mirrors Foundry's `system.*` block for facility items:
--   system.type.value      → facility_type        (basic | special)
--   system.type.subtype    → facility_subtype     (bedroom / archive / ...)
--   system.size            → size                 (cramped | roomy | vast)
--   system.level           → level                (1-9, default 5)
--   system.building.built  → built                (boolean)
--   system.free            → free                 (boolean, granted free vs paid)
--   system.disabled        → disabled             (boolean, forces order='repair')
--   system.enlargeable     → enlargeable          (boolean)
--   system.order           → facility_order       (build|change|craft|...)
--   system.progress        → progress JSON        ({value, max, order})
--   system.trade           → trade JSON           ({creatures, profit, stock, pending})
--   system.craft           → craft JSON           ({item, quantity})
--   system.defenders       → defenders JSON       ({value: actor-uuid[], max})
--   system.hirelings       → hirelings JSON       ({value: actor-uuid[], max})
-- Plus the standard catalog fields (name, identifier, source, description,
-- image, page, tags) shared across every compendium entity.
--
-- The `activities` + `effects` columns mirror items.activities / .effects
-- so a facility can carry the same automation surface — orders like
-- 'craft' or 'empower' are nicely modeled as Activities, and the
-- ActivityEditor already speaks this shape.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS facilities (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    identifier TEXT NOT NULL UNIQUE,

    -- Foundry's system.type.{value, subtype}. `facility_type` is the
    -- coarse axis (basic vs special); `facility_subtype` is the
    -- specific catalog slug (bedroom / library / smithy / etc.).
    facility_type TEXT NOT NULL DEFAULT 'basic'
        CHECK (facility_type IN ('basic', 'special')),
    facility_subtype TEXT,

    -- system.size — cramped|roomy|vast. Drives price + sq + upkeep
    -- in the bastion rules. Constrained because the rules table
    -- references it by slug.
    size TEXT NOT NULL DEFAULT 'cramped'
        CHECK (size IN ('cramped', 'roomy', 'vast')),

    -- system.level — character level required to operate; the rules
    -- gate certain special facility subtypes behind level 9/13/17.
    level INTEGER NOT NULL DEFAULT 5,

    -- system.building.built / system.free / system.disabled /
    -- system.enlargeable — booleans stored as INTEGER (D1 convention,
    -- matches items.equipped / .identified / .magical etc.).
    built INTEGER NOT NULL DEFAULT 0,
    free INTEGER NOT NULL DEFAULT 0,
    disabled INTEGER NOT NULL DEFAULT 0,
    enlargeable INTEGER NOT NULL DEFAULT 0,

    -- system.order — the currently-active order. The editor surfaces
    -- a sub-block (Trade / Craft JSON) only when the order matches.
    -- 'repair' is hidden in the UI but forced when disabled=1.
    facility_order TEXT
        CHECK (facility_order IS NULL OR facility_order IN (
            'build', 'change', 'craft', 'empower', 'enlarge',
            'harvest', 'maintain', 'recruit', 'repair', 'research', 'trade'
        )),

    -- Per-order state — all JSON. The editor only surfaces the sub-form
    -- matching the current `facility_order` so authoring stays focused;
    -- the unused columns hold stale data harmlessly.
    progress TEXT,       -- {value, max, order, pct?}
    trade TEXT,          -- {creatures, profit, stock, pending}
    craft TEXT,          -- {item, quantity}
    defenders TEXT,      -- {value: actor-uuid[], max}
    hirelings TEXT,      -- {value: actor-uuid[], max}

    -- Standard catalog fields. Mirror the items + feats schema so the
    -- CompendiumBrowserShell + DevelopmentCompendiumManager work without
    -- per-entity branching.
    description TEXT,
    image_url TEXT,
    activities TEXT DEFAULT '[]',
    effects TEXT DEFAULT '[]',
    source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
    page TEXT,
    tags TEXT DEFAULT '[]',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_facilities_type ON facilities(facility_type);
CREATE INDEX IF NOT EXISTS idx_facilities_subtype ON facilities(facility_subtype);
CREATE INDEX IF NOT EXISTS idx_facilities_source ON facilities(source_id);
CREATE INDEX IF NOT EXISTS idx_facilities_order ON facilities(facility_order);

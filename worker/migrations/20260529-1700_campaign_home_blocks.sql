-- Campaign-specific homepage layout — an ordered list of content blocks that,
-- when present, replaces the default Home page body for members of that campaign.
-- One row per ROOT block; container blocks (group/columns/column) nest their
-- children inside `config.children` (JSON), so the table stays flat.
-- `block_type` + `config` (JSON) are type-agnostic by design — the block-type
-- set is owned by the app (src/lib/campaignHome.ts HomeBlockType) and validated
-- server-side (ALLOWED_HOME_BLOCK_TYPES in functions/api/campaigns/[[path]].ts).
-- Current types: hero | text | image | divider | recommended | callout |
--   entity-row | entity-feature | group | columns | column. `config` shape is
-- per-type (see campaignHome.ts); EntityRefs carry optional title/description/
-- span overrides. A campaign with zero blocks falls back to the default Home.

CREATE TABLE campaign_home_blocks (
    id          TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    block_type  TEXT NOT NULL,                      -- see header; validated by ALLOWED_HOME_BLOCK_TYPES
    "order"     INTEGER NOT NULL DEFAULT 0,         -- position within the campaign's page (root blocks)
    config      TEXT,                               -- JSON, block-type-specific (children nest here)
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_campaign_home_blocks_campaign_order ON campaign_home_blocks(campaign_id, "order");

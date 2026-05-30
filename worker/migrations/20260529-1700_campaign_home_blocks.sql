-- Campaign-specific homepage layout — an ordered list of content blocks that,
-- when present, replaces the default Home page body for members of that campaign.
-- Each block has a type and a JSON `config` whose shape depends on the type:
--   hero         { title, subtitle }
--   text         { body }                         -- BBCode
--   article-row  { title, columns (2|3), articleIds[] }
--   image        { url, caption }
--   recommended  { title }                        -- renders the campaign's recommended_lore
-- A campaign with zero blocks falls back to the global default Home layout.

CREATE TABLE campaign_home_blocks (
    id          TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    block_type  TEXT NOT NULL,                      -- hero | text | article-row | image | recommended
    "order"     INTEGER NOT NULL DEFAULT 0,         -- position within the campaign's page
    config      TEXT,                               -- JSON, block-type-specific (see header)
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_campaign_home_blocks_campaign_order ON campaign_home_blocks(campaign_id, "order");

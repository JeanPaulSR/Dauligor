-- Lore-article block layout — an ordered list of content blocks that form an
-- article's body, replacing the single BBCode `lore_articles.content` field as
-- the render source. Mirrors `campaign_home_blocks` (migration 20260529-1700)
-- exactly so the generic layout engine (src/lib/layoutBlocks.ts) and its
-- replace-all save idiom are reused verbatim. One row per ROOT block; container
-- blocks (group/columns/column) nest their children inside `config.children`
-- (JSON), so the table stays flat.
--
-- `block_type` + `config` (JSON) are type-agnostic by design — the block-type
-- set is owned by the app (LayoutBlockType) and validated server-side
-- (ALLOWED_ARTICLE_BLOCK_TYPES in functions/api/lore/[[path]].ts). Article block
-- set = the campaign homepage set MINUS `recommended` (campaign-specific):
--   hero | text | image | divider | callout | entity-row | entity-feature |
--   group | columns | column.
--
-- `lore_articles.content` is RETAINED but DEMOTED: no longer the render source.
-- The blocks PUT endpoint keeps it populated with a BBCode mirror derived from
-- the text blocks, so existing search, excerpts, and recommended-card fallbacks
-- keep working unchanged.
--
-- Idempotent: IF NOT EXISTS guards + a NOT EXISTS guard on the seed, plus
-- deterministic seed ids, so re-running this file is a no-op. (Safe under the
-- "apply ONE file via d1 execute" remote rule — never `migrations apply`.)

CREATE TABLE IF NOT EXISTS lore_article_blocks (
    id          TEXT PRIMARY KEY,
    article_id  TEXT NOT NULL REFERENCES lore_articles(id) ON DELETE CASCADE,
    block_type  TEXT NOT NULL,                      -- see header; validated by ALLOWED_ARTICLE_BLOCK_TYPES
    "order"     INTEGER NOT NULL DEFAULT 0,         -- position within the article body (root blocks)
    config      TEXT,                               -- JSON, block-type-specific (children nest here)
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lore_article_blocks_article_order
    ON lore_article_blocks(article_id, "order");

-- One-time content → block seed. For every article with a non-empty `content`
-- and no block rows yet, insert a single `text` block whose config.body is the
-- existing BBCode. Renders identically (one text block == the old body), so this
-- is a no-visual-change cutover for the current article set. Deterministic id
-- (`<article_id>:body`) + the NOT EXISTS guard make re-runs a no-op.
INSERT INTO lore_article_blocks (id, article_id, block_type, "order", config, created_at, updated_at)
SELECT la.id || ':body',
       la.id,
       'text',
       0,
       json_object('body', la.content, 'width', 'normal'),
       CURRENT_TIMESTAMP,
       CURRENT_TIMESTAMP
FROM lore_articles la
WHERE la.content IS NOT NULL
  AND TRIM(la.content) <> ''
  AND NOT EXISTS (SELECT 1 FROM lore_article_blocks b WHERE b.article_id = la.id);

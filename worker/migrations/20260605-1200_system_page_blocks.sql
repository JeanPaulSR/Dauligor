-- System-page body layout — the block list that forms a system page's body,
-- replacing the single BBCode `system_pages.description` field as the render
-- source for the page intro. Mirrors `lore_article_blocks` / `campaign_home_blocks`
-- so the generic layout engine (src/lib/layoutBlocks.ts) and its replace-all save
-- idiom are reused. One row per ROOT block; container blocks (group/columns/column)
-- nest their children inside `config.children` (JSON), so the table stays flat.
--
-- Stage-2 scope (page body only): the ENTRIES glossary (`system_page_entries`) is
-- unchanged — it remains the dedicated, addressable (`#anchor`), &-reference-target,
-- entity-backed system. Only the page's intro body moves to blocks.
--
-- `system_pages.description` is RETAINED but DEMOTED to a BBCode mirror derived
-- from the body's text blocks, so the page-level `&kind[]` reference (which cites
-- the page description) and search keep working.
--
-- No data seed here: the lib (systemPages.ts) lazily wraps a page's existing
-- `description` into a text block when a page has no block rows yet, so existing
-- pages render + edit losslessly without a bulk migration. Idempotent (IF NOT
-- EXISTS), safe to re-run.

CREATE TABLE IF NOT EXISTS system_page_blocks (
    id          TEXT PRIMARY KEY,
    page_id     TEXT NOT NULL REFERENCES system_pages(id) ON DELETE CASCADE,
    block_type  TEXT NOT NULL,
    "order"     INTEGER NOT NULL DEFAULT 0,
    config      TEXT,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_system_page_blocks_page_order
    ON system_page_blocks(page_id, "order");

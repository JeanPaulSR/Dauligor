-- Phase: Feat Category — admin-managed taxonomy
-- ============================================================
-- New `feat_categories` table backs the "Feat Category" picker in
-- the FeatsEditor + the Category column in the public FeatList. The
-- 2024 PHB taxonomy is the seed expectation (General, Fighting
-- Style, Epic Boon, Origin, Eldritch Epic), but the table is admin-
-- managed so DMs can add custom categories without a code deploy.
--
-- Sourcing the column on `feats` rather than embedding category as
-- a free-text field keeps the taxonomy normalized — renaming a
-- category propagates to every feat that uses it, and `ON DELETE
-- SET NULL` clears the reference cleanly when a category is
-- removed (vs the cascade alternative which would nuke feats).
--
-- The previous `feat_type` / `feat_subtype` columns stay in place
-- (hidden from the editor UI). Foundry import still populates them
-- from `system.type.value` for export round-trip fidelity. Feat
-- Category is a separate, app-side taxonomy layered on top.

CREATE TABLE IF NOT EXISTS feat_categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    identifier TEXT NOT NULL UNIQUE,
    description TEXT,
    -- Sort order for the admin page + the editor picker. Lower
    -- numbers float to the top; ties break alphabetically.
    sort_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_feat_categories_sort ON feat_categories(sort_order, name);

-- Add the FK column on feats. Nullable — every existing row has
-- NULL until the admin assigns a category. `ON DELETE SET NULL`
-- keeps feats alive when a category is dropped.
ALTER TABLE feats ADD COLUMN feat_category_id TEXT REFERENCES feat_categories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_feats_category ON feats(feat_category_id);

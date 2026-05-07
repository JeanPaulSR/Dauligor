-- Migration: 0017 — Interactive Map system
-- Three tables for the world-map feature:
--   maps             — image + identity, scoped to an era
--   map_markers      — point-pin on a map, optionally linked to a lore article
--   map_highlights   — region (rect/etc.) on a map, optionally linked to an
--                      article and/or a submap; both targets allowed simultaneously
-- Empty pins/highlights are intentional — admins use them as organisational
-- placeholders before the article or submap is authored.

-- Drop earlier-iteration map_markers (the bare table created earlier in 0017
-- before the full design was settled). Empty, no data loss.
DROP INDEX IF EXISTS idx_map_markers_article;
DROP TABLE IF EXISTS map_markers;
DROP TABLE IF EXISTS map_highlights;
DROP TABLE IF EXISTS maps;

CREATE TABLE maps (
    id TEXT PRIMARY KEY,
    identifier TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    background_image_url TEXT,
    era_id TEXT NOT NULL,                          -- the era this map represents
    parent_marker_id TEXT,                         -- entry point on a parent map (if reached via a pin)
    parent_highlight_id TEXT,                      -- entry point on a parent map (if reached via a highlight)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    -- NO ACTION blocks era deletion while maps still reference it; force explicit cleanup.
    FOREIGN KEY (era_id) REFERENCES eras(id),
    FOREIGN KEY (parent_marker_id) REFERENCES map_markers(id) ON DELETE SET NULL,
    FOREIGN KEY (parent_highlight_id) REFERENCES map_highlights(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX idx_maps_era_identifier ON maps(era_id, identifier);
CREATE INDEX idx_maps_era ON maps(era_id);

CREATE TABLE map_markers (
    id TEXT PRIMARY KEY,
    map_id TEXT NOT NULL,
    article_id TEXT,                               -- NULL allowed for placeholder pins
    x REAL NOT NULL,                               -- 0–100 percent
    y REAL NOT NULL,
    label TEXT,
    icon TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (map_id) REFERENCES maps(id) ON DELETE CASCADE,
    -- Article delete only nulls the link; the pin survives as a visual placeholder.
    FOREIGN KEY (article_id) REFERENCES lore_articles(id) ON DELETE SET NULL
);
CREATE INDEX idx_map_markers_map ON map_markers(map_id);
CREATE INDEX idx_map_markers_article ON map_markers(article_id) WHERE article_id IS NOT NULL;

CREATE TABLE map_highlights (
    id TEXT PRIMARY KEY,
    map_id TEXT NOT NULL,
    article_id TEXT,                               -- nullable; either, both, or neither target allowed
    child_map_id TEXT,                             -- nullable
    shape TEXT NOT NULL DEFAULT 'rect',            -- 'rect' v1; 'circle'/'polygon' future
    x REAL NOT NULL,                               -- top-left, 0–100 percent
    y REAL NOT NULL,
    width REAL,                                    -- percent (for rect/ellipse)
    height REAL,
    label TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (map_id) REFERENCES maps(id) ON DELETE CASCADE,
    FOREIGN KEY (article_id) REFERENCES lore_articles(id) ON DELETE SET NULL,
    FOREIGN KEY (child_map_id) REFERENCES maps(id) ON DELETE SET NULL
);
CREATE INDEX idx_map_highlights_map ON map_highlights(map_id);

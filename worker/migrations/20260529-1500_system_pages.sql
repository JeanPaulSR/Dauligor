-- System Pages — a site-consistent, reference-addressable glossary article type.
-- Distinct from lore_articles (campaign narrative): system pages are canonical,
-- global rules reference (Conditions, Skills, Magic, homebrew rulesets). The
-- cross-reference `&<system>[<entry>]` sigil resolves into these pages, where the
-- page's `identifier` IS the reference kind (&condition[prone] -> the "condition"
-- page, "prone" entry). See docs/_drafts/system-page-spec.html.

CREATE TABLE system_pages (
    id          TEXT PRIMARY KEY,
    identifier  TEXT UNIQUE NOT NULL,            -- site-wide slug + the `&` ref kind: "condition", "skill"
    name        TEXT NOT NULL,                   -- "Conditions"
    description TEXT,                             -- intro prose shown atop the glossary (BBCode)
    icon        TEXT,                             -- optional lucide icon name / image url
    "order"     INTEGER,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- One addressable subsection of a system page. Hybrid (per spec §5): an entry is
-- EITHER free-authored prose (`body`) OR entity-backed (`source_kind`/`source_id`
-- point at an existing canonical row, e.g. a status_conditions row, so its text is
-- pulled live with no duplication). `source_id` is intentionally NOT a FK — it is
-- polymorphic across backing tables.
CREATE TABLE system_page_entries (
    id          TEXT PRIMARY KEY,
    page_id     TEXT NOT NULL REFERENCES system_pages(id) ON DELETE CASCADE,
    identifier  TEXT NOT NULL,                   -- slug, unique within page: "prone" (the #anchor)
    name        TEXT NOT NULL,                   -- "Prone"
    summary     TEXT,                            -- short blurb for the hover card
    body        TEXT,                            -- full entry text (BBCode); null when entity-backed
    source_kind TEXT,                            -- optional entity binding, e.g. "condition"
    source_id   TEXT,                            -- optional id into that entity's table (polymorphic)
    image_url   TEXT,
    "order"     INTEGER,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(page_id, identifier)
);

CREATE INDEX idx_system_page_entries_page_order ON system_page_entries(page_id, "order");

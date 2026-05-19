-- Phase 4.1 — proposal_bundles (block metadata)
-- ============================================================
-- Submission Blocks (Phase 2e) used an opaque client-generated
-- bundle_id with no metadata — users couldn't name or describe
-- a block. Phase 4 adds a sibling proposal_bundles table keyed
-- by the same id, holding name + description + status + creator.
--
-- The relationship to pending_revisions.bundle_id is a SOFT FK:
-- no DB-level constraint, because pre-existing bundles (created
-- before this migration) don't have metadata rows and we want
-- those rows to keep working. Enforcement is in code.
--
-- Lifecycle:
--   open       — block is being authored; drafts can be added.
--   submitted  — submitBundle flipped its drafts to pending; the
--                metadata row stays around as a label for the
--                admin-side view.
--   discarded  — handleDiscardBundle deletes the metadata row
--                outright, so this status mainly exists for
--                completeness / future "soft discard" flows. The
--                CHECK still admits it.

CREATE TABLE proposal_bundles (
    id                   TEXT PRIMARY KEY,
    name                 TEXT NOT NULL,
    description          TEXT,
    created_by_user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at           TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at           TEXT DEFAULT CURRENT_TIMESTAMP,
    status               TEXT NOT NULL DEFAULT 'open'
                           CHECK (status IN ('open', 'submitted', 'discarded'))
);

-- "List my open blocks" — picker prompt + future block menu.
CREATE INDEX idx_proposal_bundles_by_creator
    ON proposal_bundles(created_by_user_id, status);

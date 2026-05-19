-- Phase: Content proposals — pending_revisions table
-- ============================================================
-- The shadow table that captures every proposed mutation.
-- See docs/features/content-proposals.md for the full data model.
--
-- One table for every proposed change against the phase-1 entities
-- (tags / tag_groups / spell_rules / spell_rule_applications /
-- class_spell_lists). The shape is diff-based — `proposed_payload`
-- holds the next state, `snapshot_at_proposal` captures the row
-- state at submit so the admin can detect drift and the audit log
-- can revert.
--
-- Phase 2 adds `spell` to the entity allowlist (the CHECK below)
-- via a follow-up migration that rebuilds the table; SQLite can't
-- ALTER a CHECK in place.

CREATE TABLE pending_revisions (
    id                          TEXT PRIMARY KEY,
    -- Groups related revisions submitted in one go (e.g. a new tag
    -- and a new rule that filters on that tag). Nullable so single-
    -- entity proposals stay simple.
    bundle_id                   TEXT,
    proposed_by_user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    proposed_at                 TEXT DEFAULT CURRENT_TIMESTAMP,
    status                      TEXT NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
    -- Allowlist must agree with PROPOSABLE_ENTITY_TYPES in
    -- api/_lib/proposals.ts. Adding `spell` later means rebuilding
    -- the table (SQLite limitation).
    entity_type                 TEXT NOT NULL
                                  CHECK (entity_type IN ('tag', 'tag_group', 'spell_rule', 'spell_rule_application', 'class_spell_list')),
    -- NULL for `create` operations (no row yet); FK by id otherwise.
    -- We can't FK to a specific table since `entity_type` decides
    -- which table — keep this as plain TEXT and validate in code.
    entity_id                   TEXT,
    operation                   TEXT NOT NULL
                                  CHECK (operation IN ('create', 'update', 'delete')),
    -- The proposed new row shape (JSON). NULL for `delete`.
    proposed_payload            TEXT,
    -- Row state at submit time (JSON). NULL for `create`. Drives
    -- conflict detection on approve + revert on rollback.
    snapshot_at_proposal        TEXT,
    reviewed_by_user_id         TEXT REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at                 TEXT,
    rejection_reason            TEXT,
    notes_from_proposer         TEXT,
    -- Declares a within-bundle dependency: rejecting the parent
    -- cascades to its declared children. NULL for independent
    -- revisions. Self-FK; the server enforces same-bundle.
    cascade_parent_revision_id  TEXT REFERENCES pending_revisions(id) ON DELETE SET NULL
);

-- Queue rendering — admin opens /admin/proposals and the most
-- common query is "pending, ordered by age, optionally filtered by
-- entity_type". `(status, proposed_at)` covers the leading column
-- + the ordering.
CREATE INDEX idx_pending_revisions_status_proposed_at
    ON pending_revisions(status, proposed_at);

-- "My proposals" + creator's own list view.
CREATE INDEX idx_pending_revisions_by_creator
    ON pending_revisions(proposed_by_user_id, status);

-- "What's pending against this row" — useful when the admin opens
-- an entity in its editor and we want to surface any in-flight
-- proposals before they save.
CREATE INDEX idx_pending_revisions_entity
    ON pending_revisions(entity_type, entity_id);

-- Bundle grouping.
CREATE INDEX idx_pending_revisions_bundle
    ON pending_revisions(bundle_id);

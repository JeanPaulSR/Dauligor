-- Phase 4.7 — add `pinned_at` to pending_revisions
-- ============================================================
-- Resolved proposals (approved / rejected / withdrawn) get
-- auto-deleted by a daily cron sweep after 30 days. The exception:
-- admins can mark a resolved row with a non-null `pinned_at` so it
-- survives the sweep — useful when a substantial change should
-- remain in the audit trail beyond the default retention window.
--
-- Drafts and pending rows are NOT swept (they're still actively
-- in flight). Only the resolved trio gets the retention treatment.

ALTER TABLE pending_revisions ADD COLUMN pinned_at TEXT;

CREATE INDEX IF NOT EXISTS idx_pending_revisions_pinned
    ON pending_revisions(pinned_at) WHERE pinned_at IS NOT NULL;

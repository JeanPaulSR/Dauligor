-- Phase: content_hash columns for the live-content bridge (Phase 4)
--
-- Adds a `content_hash TEXT` column to every entity table the live
-- viewer + drag-construct + update-detection systems consume. The
-- column is initially NULL on existing rows; population happens in
-- the next commit (Phase 1.5: hash-on-upsert wiring) and consumption
-- in Phase 4 (update-detection batch API + glow-icon UI).
--
-- Hash semantics:
--   - Computed app-side on every upsert from the canonical JSON
--     representation of the row's content fields (name, description,
--     activities, effects, advancements, etc. — see Phase 1.5)
--   - SHA-256, hex-encoded, 64-char string. Cheap to recompute, cheap
--     to compare (string equality), no false negatives on identical
--     content.
--   - Excludes timestamps (created_at, updated_at) and any caller-
--     specific state. Two rows with identical content but different
--     updated_at values hash to the same value.
--
-- Why a stored column instead of computing on-demand at API time:
--   - The Phase 4 batch-status endpoint compares known-hash from each
--     foundry client against current hash for ~50 items at a time.
--     Computing 50 SHA-256s on each batch call is acceptable, but
--     reading 50 column values is faster and lets the API short-
--     circuit when nothing changed.
--   - Future caching layers (R2 module exports) can ETag-ify based
--     on hash without re-reading row content.
--
-- Lore articles are deliberately omitted from this pass — the article
-- system is slated for a schema revamp before Phase 2 (see
-- `docs/roadmap.md` § "Article system unification"). Adding columns
-- here that may get dropped by that revamp is wasteful. Lore article
-- content_hash will be added by the article revamp migration.
--
-- Unique option items are also omitted: they're source-scoped via
-- their parent group, and update detection at the option level isn't
-- in the Phase 4 scope — drag-construct treats option items as part
-- of their parent group bundle.

ALTER TABLE spells ADD COLUMN content_hash TEXT;
ALTER TABLE feats ADD COLUMN content_hash TEXT;
ALTER TABLE items ADD COLUMN content_hash TEXT;
ALTER TABLE classes ADD COLUMN content_hash TEXT;
ALTER TABLE subclasses ADD COLUMN content_hash TEXT;
ALTER TABLE features ADD COLUMN content_hash TEXT;
ALTER TABLE unique_option_groups ADD COLUMN content_hash TEXT;

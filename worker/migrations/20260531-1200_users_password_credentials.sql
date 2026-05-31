-- Self-rolled auth, Phase 1: native password credentials on the users row.
--
-- Part of retiring Firebase Authentication (see
-- docs/_drafts/auth-cloudflare-migration-plan-2026-05-31.html). Passwords move
-- from Firebase Auth into D1 as a scrypt hash; the Worker issues its own JWTs.
--
-- This migration is ADDITIVE and behaviour-neutral on its own: both columns are
-- nullable and nothing reads them yet. A NULL password_hash means "this account
-- has not been adopted into native auth" — the hash-on-next-login cutover fills
-- it the first time the user signs in successfully via Firebase during the
-- transition window (Phase 3). Existing logins keep working until then.
--
-- users.id stays a Firebase UID for already-migrated accounts (it is an FK
-- target across the schema and must never be re-keyed); only NEW accounts get a
-- locally generated id.

ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE users ADD COLUMN password_updated_at TEXT;

# Handoff — Firebase Auth Exit, Phases 1–2 (2026-05-31)

Branch `dauligor-applications`. Picks up the [fresh-start brief](2026-05-31-fresh-start-brief.md); this is the "accounts on Firebase, not Cloudflare" work the owner asked for.

Design doc (parchment HTML, local): `docs/_drafts/auth-cloudflare-migration-plan-2026-05-31.html`. Owner-approved decisions: **scrypt (@noble/hashes)**, **hash-on-next-login** cutover, **single sliding ~30-day JWT**, **phased — verify as we go**.

> Reframing that drove this: the 13-day-old "Stage 1" (drop firebase-admin SDK) was **already done** before this session — `jose`+JWKS verifies Firebase tokens, no service-account needed for the read path. The remaining work is **Stage 2**: passwords as hashes in D1 + Worker-issued JWTs, then delete Firebase. See updated memory `project_firebase_auth_exit_plan.md`.

## Done this session (Phases 1 + 2) — NOT yet committed, NOT pushed

All on the working tree only. tsc: **7 pre-existing errors, 0 introduced** (Base-UI `asChild`/ref family + characterShared, all other branches' files).

**Phase 1 — schema + hashing primitive**
- `worker/migrations/20260531-1200_users_password_credentials.sql` (new) — additive `ALTER TABLE users ADD COLUMN password_hash TEXT` + `password_updated_at TEXT`. Both nullable, behaviour-neutral. **Smoke-tested locally against a stub `users` table (applies clean); NOT applied to remote** (remote needs explicit per-migration go-ahead, and must ship WITH the code).
- `@noble/hashes@^1.8.0` added (package.json + lockfile). NOTE: a hung `npm install` had to be killed; dep reconciled via `npm install --package-lock-only --offline`. Import subpath is `@noble/hashes/scrypt.js` (the **.js is required** in v1.8).
- `api/_lib/password.ts` (new) — `hashPassword` / `verifyPassword`. scrypt N=2^15,r=8,p=1; self-describing `scrypt$N$r$p$salt$dk` string (params tunable later w/o migration); constant-time compare; NFKC-normalized; Web-Crypto randomness; runs in Node + Workers. Round-trip tested.

**Phase 2 — native login + dual-token verify (dark; nothing in the SPA calls it yet)**
- `api/_lib/sessionToken.ts` (new) — `issueSessionToken` / `verifySessionToken` / `isNativeAuthConfigured`. HS256 via `jose`, secret `AUTH_JWT_SECRET`, issuer `dauligor`, aud `dauligor-app`, 30-day sliding exp. Carries `sub`(=users.id), `username`, `email` (synthetic fallback so the hardcoded staff-email bypass still fires), `role`.
- `api/_lib/firebase-admin.ts` — added exported `verifyEitherToken()` (tries native when configured, falls back to Firebase JWKS; HS256 vs RS256 makes the fallthrough clean). `checkAccessFromToken` now calls it, so **every `require*` gate transparently accepts EITHER token** during the window.
- `server.ts` — dev `verifyAdminToken` also uses `verifyEitherToken`; added `/api/auth` to the explicit `pagesFunctions` mount array (prod auto-discovers by path; dev needs the explicit mount).
- `functions/api/auth/[[path]].ts` (new) — `POST /login` ({username,password} → verify hash → `{token, profile}`; case-insensitive username; uniform 401, no enumeration) and `POST /adopt` (authed by current Firebase token + plaintext body → writes the scrypt hash to the caller's row; the hash-on-next-login cutover, bound to token uid).

**Verification done:** 12/12 deterministic checks via tsx — token identity/TTL round-trip, dual-verify accepts native, signature enforced, garbage rejected, login core (hash/verify + null-hash unadopted rejection). HTTP+D1 layer verified-by-construction (mirrors the `me` endpoint).

**Verification NOT done:** live HTTP e2e. This worktree's local D1 is **empty/unseeded** and the worker isn't running, so no real login round-trip yet. Best run in the **main checkout** (`dauligor-applications` @ `node scripts/dev-sysapp.mjs`, :3001/:8788, seeded local D1) — set `AUTH_JWT_SECRET` in its env, insert a test user with a hash (or call `/adopt`), then `POST /api/auth/login`.

## Phase 3a — DONE (client flip), committed `047db15` (not pushed)

The whole client is off `firebase.auth.currentUser` and onto `src/lib/auth.ts`.
- **`src/lib/auth.ts`** (new): single source of truth. `getSessionToken()` (native JWT if present+unexpired, else Firebase), `getIdentity()`/`isAuthenticated()`, `onAuthChange()`, `login()` (native-first → Firebase fallback → `/adopt`), `logout()`, `redeemToken()`. Continuous expiry check; flash-free subscribe (sync-fires only on a definitive native session); native-token-set-before-firebase-signout ordering.
- **~44 files swept** via codemod: `auth.currentUser.getIdToken()`→`getSessionToken()`, `auth.currentUser`→`getIdentity()`/`isAuthenticated()`. Orphaned firebase imports removed from 30 files.
- **Entry points (hand-wired):** `App.tsx` (`onAuthChange` + `Identity` state, `loadProfile()` uses `getSessionToken`), `Navbar` (`login`/`logout`), `RedeemTokenPage` (`redeemToken`), `d1.ts` (`getAuthHeaders`/`checkFoundationUpdate`).
- **Settings:** dropped the redundant Firebase `updateProfile` (D1 PATCH is source of truth); password change → new **`POST /api/auth/change-password`** (session-authed; no current-password field by design parity — hardening follow-up: require current password).
- **Verified:** `tsc` 0 new errors; **`vite build` green**; live endpoint smoke login + adopt + **change-password 6/6** through a real worker + D1.
- ⚠ **Env hiccup (resolved):** the earlier hung/offline `npm install` left the `motion`/`framer-motion`/`motion-dom` packages with incomplete ESM extraction → `vite build` failed on entry resolution. Fixed with `npm cache clean --force` + removing the motion-family dirs + fresh reinstall. Not a code issue. `package.json`/lock unchanged beyond the committed `@noble/hashes` add.

Codemod gotcha for the future: insert new imports AFTER the last import statement's *end* (multi-line `import {…}` blocks span several lines) — a first attempt inserted mid-statement and broke ~6 files.

## Next — Phase 3b / 5 (each needs owner go-ahead)

1. **Remote migration** `20260531-1200_*` applied to remote D1 WITH the code (per-migration go-ahead). Lesson re-stated in the design doc §8.
2. **Client flip** — `src/lib/auth.ts` (new) replacing the Firebase SDK surface in `src/lib/firebase.ts`; `Navbar.tsx` login → `POST /api/auth/login` + store token; `App.tsx` `onAuthStateChanged` → our listener; `RedeemTokenPage.tsx` → our one-time token. Wire `/adopt` into the existing Firebase login so accounts self-migrate during the window.
3. **Admin user CRUD** → D1 writes (drop Identity Toolkit): create = insert + hash (new id = `crypto.randomUUID()`; **keep existing Firebase-UID ids verbatim** — FK target everywhere); temp-password = rehash; sign-in-link = mint our one-time JWT; delete = D1 only.
4. **Phase 5 cleanup** — drop dual-token branch, `firebase` dep, `firebase-applet-config.json`, `FIREBASE_SERVICE_ACCOUNT_JSON`; rename `firebase-admin.ts`→`auth.ts`; promote `docs/platform/auth-firebase.md`→`auth.md`.

## Gotchas carried
- Secrets needed for go-live: `AUTH_JWT_SECRET` on **both** the Worker and Pages (and local `.env` for dev). Until set, native auth returns 503 and Firebase keeps working (graceful).
- `users.id` MUST stay the Firebase UID for migrated users (FK target across characters/lore/campaign_members/user_permissions/proposals). Never re-key.
- No real inboxes (`@archive.internal`) → forgot-password is admin-mediated for now; real email (Resend + `recovery_email`) is a v2.
- Hardcoded staff-email bypass lives in 3 files (`firebase-admin.ts`, `server.ts`, `functions/api/me/[[path]].ts`) — survives the swap, keep in sync.

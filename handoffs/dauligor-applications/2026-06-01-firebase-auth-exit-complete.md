# Handoff — Firebase Auth Exit: COMPLETE (code), pre-go-live (2026-06-01)

Branch `dauligor-applications` (work done in worktree `claude/kind-wright-2cb7a2`, reset onto `origin/dauligor-applications`). Supersedes [2026-05-31-firebase-auth-exit-phases-1-2.md](2026-05-31-firebase-auth-exit-phases-1-2.md) (Phases 1–2) and the Phase-3a note. Design doc + reviews: `docs/_drafts/auth-cloudflare-migration-plan-2026-05-31.html`, `docs/_drafts/auth-migration-review-2026-05-31.html`, `docs/_drafts/auth-flip-audit-2026-05-31.html`.

## TL;DR
Accounts moved off Firebase Authentication onto the native Cloudflare/D1 stack: scrypt password hashes in D1, Worker-issued HS256 session JWTs, sliding refresh. **Phases 1–5 are code-complete, locally verified, and committed — NOTHING is pushed and NOTHING is deployed.** Firebase is entirely gone from `src/`, `api/`, `functions/` (no imports, no config, dep removed from package.json). The full native-auth surface passes a 14/14 live test suite.

## 🛑 CRITICAL: the branch HEAD is the END-STATE — do NOT one-shot deploy it
Production today = 100% Firebase: **no `AUTH_JWT_SECRET` secret, no `password_hash` column on remote D1, no user has a native hash.** The branch HEAD has Firebase fully removed (Phase 5) and therefore **no Firebase fallback**. Deploying HEAD as-is would **lock out every user (and kick out anyone signed in) immediately** — native login 503/401 with nothing to fall back to. Go-live MUST be staged (see runbook below). This is why everything is unpushed.

## Phase-by-phase + commits (all on `claude/kind-wright-2cb7a2`, unpushed)
| Commit | Phase | What |
|--------|-------|------|
| `bcca68b` | 1–2 | Foundation (dark): `api/_lib/password.ts` scrypt, `sessionToken.ts` HS256 JWT, `functions/api/auth/[[path]].ts` `/login`+`/adopt`, dual-token gate `verifyEitherToken`, migration `20260531-1200_users_password_credentials.sql` (password_hash + password_updated_at) |
| `047db15` | 3a | Client flip — new `src/lib/auth.ts`; ~44 files swept onto it; native-first login + Firebase fallback + adopt; `/change-password` |
| `2fa466e`,`7804c2c`,`961e3b1` | 3a fixes | default-avatar; logout profile-reload race; keep D1 cache across logout/login |
| `1dca495`,`f9fa2ab`,`01f7203` | 3b | sliding `/api/auth/refresh`; require current password to change; multi-tab `storage` sync |
| `de6bc0f` | hardening | client `login()` falls back to Firebase on ANY native failure (401/503/500/network); server login lookup tolerates a missing `password_hash` column → 401 not 500; error reports include native identity. **Makes the pre-Phase-5 commits safe to deploy in any DB-migration order.** |
| `f07bcfc` | 4 | Admin user CRUD → D1 (drop Identity Toolkit): create = `crypto.randomUUID()` id + scrypt hash; temp-password = hash; delete = D1 only; sign-in-token = short-lived (1h) native token; `/api/me` username change drops Firebase email sync; removed dev temp-password route |
| `94fc8a2` | 5a | Client Firebase removal: `auth.ts` native-only; `firebase.ts` deleted; `reportClientError`/`OperationType` → new `src/lib/clientError.ts`; `proposalBlock`/`FeatList`/`ItemList` listeners → `onAuthChange`; AdminUsers "Send Recovery Email" removed; **`firebase` dep removed from package.json + `firebase-applet-config.json` deleted** |
| `40b8fd0` | 5b | Server gate native-only: gutted `api/_lib/firebase-admin.ts` — no Firebase JWKS verify, no Identity Toolkit, no service account, no `getAdminServices`; `verifyEitherToken`→`verifySessionToken`; `getCredentialErrorMessage` kept as null stub; `FIREBASE_SERVICE_ACCOUNT_JSON` no longer read anywhere |

## How native auth works now
- **Login** `POST /api/auth/login {username,password}` → verify scrypt hash on the users row → return a 30-day HS256 JWT signed with `AUTH_JWT_SECRET` (claims: sub=users.id, username, role, email-synthetic). Client stores it in `localStorage['dauligor:authToken']`.
- **Every request** sends `Authorization: Bearer <jwt>`; `firebase-admin.ts` (misnomer — native now) verifies it and **reads role live from D1** on every call (token role is cosmetic).
- **Sliding refresh** `POST /api/auth/refresh` — `getSessionToken()` opportunistically renews once the token is past half-life (~15d).
- **Change password** `POST /api/auth/change-password {currentPassword,newPassword}` (verifies current).
- **Admin** `/api/admin/users` create/temp-password/sign-in-token/delete — all D1-native.
- **Sign-in link** mints a 1h native token; `RedeemTokenPage` stores it via `auth.ts redeemToken()`.
- IDs: existing users keep their Firebase-UID `users.id` (FK target everywhere — never re-key); NEW users get `crypto.randomUUID()`.

## Local dev / testing
- Stack (this worktree): worker `cd worker && npx wrangler dev --port 8788 --inspector-port 9230 --local` (background); app `PORT=3001 R2_WORKER_URL=http://localhost:8788 DISABLE_HMR=true npx tsx server.ts` (background, NO `tsx watch` — it restart-loops on Vite config temp files). App http://localhost:3001.
- **NEVER `npm install` in a worktree** — node_modules is a junction to the parent repo; npm replaces it with a divergent copy → dual-React + motion corruption. See memory `project_worktree_node_modules_junction.md`.
- Local `.env` (gitignored) has `AUTH_JWT_SECRET` + `R2_API_SECRET=devsecret`; `worker/.dev.vars` has `API_SECRET=devsecret`.
- Local D1 was seeded from a **prod snapshot** (`wrangler d1 export --remote` → import + the password migration). Prod users have NO hash, so I set known passwords for testing:
  | username | password | role |
  |---|---|---|
  | `tester` | `test1234` | admin |
  | `admin` | `testpass1` | admin |
  | `ayogavino` | `testpass1` | trusted-player |
  | `creator-test` | `testpass1` | user |
- Verification: `tsc` 6 pre-existing errors / 0 introduced; `vite build` green (~177 kB smaller); 14/14 live auth-suite (login+roles, gating, refresh, change-pw, admin CRUD round-trip).

## GO-LIVE RUNBOOK (staged — do NOT skip the order). Each remote step needs explicit per-step go-ahead.
1. **Remote schema + secret** (does not change behaviour yet): apply `worker/migrations/20260531-1200_users_password_credentials.sql` to **remote** D1 (`cd worker && npx wrangler d1 execute dauligor-db --remote --file=…`); set `AUTH_JWT_SECRET` as a Cloudflare **Pages** secret AND **Worker** secret (same value).
2. **Deploy a commit that STILL HAS the Firebase fallback** — i.e. **`f07bcfc` (Phase 4)**, NOT HEAD. Now: existing users log in via Firebase and silently adopt a hash; native login works for anyone who has one; admin-created users are native.
3. **Drive adoption** — wait until every active user has logged in once (check `SELECT COUNT(*) FROM users WHERE password_hash IS NULL`), and/or admin sets temp-passwords for stragglers.
4. **Only when password_hash is non-null for everyone who must log in** → deploy **HEAD (`40b8fd0`, Phase 5)** to remove Firebase.
5. Post-cutover: `FIREBASE_SERVICE_ACCOUNT_JSON` + the Firebase project can be retired.

## Open / deferred (cosmetic, optional)
- Rename `api/_lib/firebase-admin.ts` → `auth.ts` (touches ~20 importers) and `docs/platform/auth-firebase.md` → `auth.md` — pure cosmetics; deferred to avoid churn.
- Refresh `docs/_drafts/auth-migration-review-*.html` to mark Phases 4–5 done.
- `reportClientError` native-identity is already handled; the firebase-admin filename is the only lingering misnomer.

## Branch/worktree note
Work is committed on `claude/kind-wright-2cb7a2` (a worktree reset onto `origin/dauligor-applications` @ `b56e809`). `dauligor-applications` itself is unchanged at `b56e809`. To land: fast-forward `dauligor-applications` onto these commits (clean FF), then push only on explicit request.

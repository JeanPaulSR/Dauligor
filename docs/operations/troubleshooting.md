# Troubleshooting

Common errors and their fixes, organised by where the problem surfaces.

## D1 / database

### `503 — D1 proxy is not configured`
The Express dev server can't read `R2_WORKER_URL` or `R2_API_SECRET`.

- Confirm `.env` exists at the repo root.
- Confirm both vars are set (see [../platform/env-vars.md](../platform/env-vars.md)).
- Restart the Express process — `dotenv/config` is loaded once at startup.

### `401 — Unauthorized` from the Worker
The shared secret between the proxy and the Worker doesn't match.

- `R2_API_SECRET` in `.env` (or Vercel env) must equal `API_SECRET` in `worker/.dev.vars` (or the Worker's secret store in prod).
- Restart **both** processes after editing.

### `[D1] Table X is empty.`
Local D1 has the table but no rows. Either run the relevant schema migration if the table itself is missing (`wrangler d1 execute --local --file=migrations/0XXX_*.sql`), or pull a fresh snapshot from remote (`wrangler d1 export … --remote --no-schema` followed by `--local --file=…`). The procedure lives in [../database/README.md#resetting-local-dev](../database/README.md#resetting-local-dev).

### Worker won't start
- "no D1 database bound" → run `wrangler dev` from the `worker/` directory, not the repo root.
- "binding 'BUCKET' is not declared" → confirm `worker/wrangler.toml` matches the binding referenced in `worker/index.js`.

### `INSERT OR REPLACE` failing with `FOREIGN KEY constraint failed`
**Don't use `INSERT OR REPLACE`.** D1 has `PRAGMA foreign_keys = ON` by default; `INSERT OR REPLACE` resolves PK conflicts by deleting and reinserting the row, which fires `ON DELETE CASCADE` on FK children — silent data loss. Use `INSERT … ON CONFLICT(<pk>) DO UPDATE SET …` instead. See [../database-memory.md#upsert-idiom--never-use-insert-or-replace](../database-memory.md#upsert-idiom--never-use-insert-or-replace).

### Cache seems stale across tabs
The foundation heartbeat (30-second poll on `system_metadata.last_foundation_update`) is what keeps tabs in sync.

- Confirm `system_metadata` has a `last_foundation_update` row.
- Confirm `App.tsx` is calling `checkFoundationUpdate()` on its interval.
- Try `clearCache()` in the browser console (exposed via `src/lib/d1.ts`).

## Authentication

### `Could not load the default credentials`
The proxy can't initialise `firebase-admin`.

- Set `FIREBASE_SERVICE_ACCOUNT_JSON` (preferred) or `GOOGLE_APPLICATION_CREDENTIALS` (path).
- The local-dev fallback parses tokens signaturelessly and grants admin — the warning is expected and **must not happen in production**.

### "Missing bearer token" / 401 on every D1 call
The browser isn't attaching the Firebase ID token.

- Confirm the user is signed in (`auth.currentUser` is non-null in the console).
- Token might be expired — call `auth.currentUser.getIdToken(true)` to force a refresh.
- The user might have been deleted server-side; sign out and back in.

### Admin role not recognised after promotion
The user's existing JWT still claims their old role until refresh.

- The user can sign out and back in.
- Or call `auth.currentUser.getIdToken(true)` from the console.
- The app code force-refreshes on detected role changes; if that's not happening, check the role-change effect in `App.tsx`.

### `403 — Admin access required`
The user's D1 `users.role` isn't one of the values required by the route.

- Check the user's row: `SELECT role FROM users WHERE id = '<uid>';`
- If they should be admin, update directly in D1 — or sign in as a hardcoded staff email and use the admin panel.

## Image upload / R2

### Upload fails with `503` or "R2 proxy is not configured"
Same root cause as the D1 503 — the proxy can't see `R2_WORKER_URL` or `R2_API_SECRET`. Same fix.

### Upload returns 200 but the image doesn't appear
- Check the Network response — the URL field should be a public `https://images.dauligor.com/...` URL.
- Confirm the URL was actually written into the relevant D1 row (e.g., `classes.image_url`).
- In local dev, the Worker emulates R2 on disk; the file is at `worker/.wrangler/state/v3/r2/<bucket>/...`.

### Image rename loses references
The `imageMetadata.ts` side updates D1 references in parallel with the R2 rename. If references break:

- The Image Manager has a "Move & Update Links" button that explicitly runs `updateImageReferences`. Use it instead of plain rename.
- If references are already broken, the URL string is the only key — search across the relevant tables for the old URL and replace.

### "Cannot delete — N references found"
This is `scanForReferences(url)` working as designed. The dialog lists the documents that still reference the URL. Either delete those references first, or accept that you'll have broken images.

## Routing / build

### Newly added `/api/...` route returns 404 in dev
The Express server (`tsx watch server.ts`) reloads on save, but a watcher miss can leave the old route table in place.

- Stop and restart `npm run dev`.
- Confirm the route is registered before the Vite middleware in `server.ts` (route order matters).

### Vercel build fails with TypeScript errors locally absent
Vercel builds with stricter settings than `tsc --noEmit`. Run `npm run lint` (`tsc --noEmit`) to catch them locally.

## UI

### BBCode tag doesn't render
- Add it to `bbcodeToHtml`/`htmlToBbcode` in [src/lib/bbcode.ts](../../src/lib/bbcode.ts).
- Add it to the rendering switch in `BBCodeRenderer`.
- See [../ui/bbcode.md](../ui/bbcode.md).

### TipTap editor doesn't pick up async-loaded value
Known fix: `MarkdownEditor.tsx` removes the `!isWYSIWYG` guard on the sync `useEffect` and uses `setContent(html, { emitUpdate: false })`. If a similar editor regresses, mirror that pattern.

### TipTap editor grows indefinitely
Override the `.prose` heights in `src/index.css`. The default `prose` class has no max height.

### Sidebar doesn't collapse / expand
The `isCollapsed` prop must be wired to a state in `App.tsx`. If toggling isn't working, confirm `previewMode` isn't accidentally overriding the role-checked branch.

## Production-specific

### Vercel deploy succeeded but app shows blank screen
- Open browser console. Likely an env var is missing — `R2_WORKER_URL` or `FIREBASE_SERVICE_ACCOUNT_JSON` set incorrectly in Vercel project settings.
- Vercel functions log errors separately from the SPA — check the Vercel logs panel.

### Worker deploy fails: "secret not set"
Run `npx wrangler secret put API_SECRET` from `worker/`.

### D1 remote has different data than local
The two are independent SQLite instances. To sync local with the current production state, dump remote and load into local: `wrangler d1 export dauligor-db --remote --output=./dump.sql --no-schema && wrangler d1 execute dauligor-db --local --file=./dump.sql`. Don't go the other direction without an explicit reason — production is the source of truth.

## Related docs

- [local-dev.md](local-dev.md) — initial setup and the two-terminal workflow
- [deployment.md](deployment.md) — production deploy steps
- [../platform/d1-architecture.md](../platform/d1-architecture.md) — query API, cache layers
- [../platform/auth-firebase.md](../platform/auth-firebase.md) — full auth chain
- [../database/README.md](../database/README.md) — schema philosophy, migration index, reset workflow
- [../database-memory.md](../database-memory.md) — phase registry and the upsert-idiom guardrail

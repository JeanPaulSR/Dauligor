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

### `[D1] Table X is empty. Falling back to Firebase.`
The local D1 doesn't have the requested table populated, and the call site is still using a `firebaseFallback`. Either:

- Run `node scripts/migrate.js` to copy from Firestore into local D1, or
- Run the relevant `wrangler d1 execute --local --file=migrations/0XXX_*.sql` if the table doesn't even exist yet.

This is **expected** during migration. Once a table is fully on D1, the call site should pass `null` as the fallback and you'll get an empty array instead of a fall-back.

### Worker won't start
- "no D1 database bound" → run `wrangler dev` from the `worker/` directory, not the repo root.
- "binding 'BUCKET' is not declared" → confirm `worker/wrangler.toml` matches the binding referenced in `worker/index.js`.

### `INSERT OR REPLACE` failing with `FOREIGN KEY constraint failed`
A foreign-key column points at an ID that doesn't exist in the parent table. Common during migration when child rows are written before parent rows.

- For a one-off fix in local dev, add `PRAGMA foreign_keys = OFF;` at the top of your SQL, finish the writes, then turn FKs back on.
- For migration code, ensure parent tables are populated first. `scripts/migrate.js` orders inserts to respect FKs — when adding a new table, follow the same ordering convention.

### Cache seems stale across tabs
The foundation heartbeat (30-second poll on `system_metadata.last_foundation_update`) is what keeps tabs in sync.

- Confirm `system_metadata` has a `last_foundation_update` row.
- Confirm `App.tsx` is calling `checkFoundationUpdate()` on its interval.
- Try `clearCache()` in the browser console (exposed via `src/lib/d1.ts`).

### `INTERNAL ASSERTION FAILED` (Firestore-era error)
This used to come from a corrupted IndexedDB cache when Firestore had persistence enabled. We're now on memory-only Firestore + D1, so this should be gone — if you see it, report it.

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
The `imageMetadata.ts` side updates D1 (or Firestore during migration) references in parallel with the R2 rename. If references break:

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

## Migration-specific

### Same data showing up twice
A row is in both Firestore (read via fallback) and D1 (read directly), and a list view is concatenating them.

- Confirm the call site uses `fetchCollection(name, fallback)` not both `fetchCollection(...)` and a separate `getDocs(...)`.
- The fallback only fires on empty D1 results; if D1 has even one row, the fallback is skipped.

### `firebaseFallback` runs every time
D1 returned an empty result. Either the table is genuinely empty, or the `WHERE` clause didn't match anything in D1 but does match in Firestore (column name drift, case difference, etc.).

- Inspect the SQL in the network tab.
- Run the same query in `wrangler d1 execute --local --command "..."` and verify the result.

### Migration script (`migrate.js`) hangs or errors
- Confirm `firebase-service-account.json` is present and valid.
- Confirm local D1 has the relevant schema migrations applied.
- The script writes SQL to a temp file under the repo root and calls `wrangler d1 execute --local --file ...` per batch — the temp file is left behind on error so you can inspect what failed.

## Production-specific

### Vercel deploy succeeded but app shows blank screen
- Open browser console. Likely an env var is missing — `R2_WORKER_URL` or `FIREBASE_SERVICE_ACCOUNT_JSON` set incorrectly in Vercel project settings.
- Vercel functions log errors separately from the SPA — check the Vercel logs panel.

### Worker deploy fails: "secret not set"
Run `npx wrangler secret put API_SECRET` from `worker/`.

### D1 remote has different data than local
This is normal — local has data copied from Firestore at the time you ran `migrate.js`. Remote is whatever you've explicitly applied. They are not auto-synced.

## Related docs

- [local-dev.md](local-dev.md) — initial setup and the two-terminal workflow
- [deployment.md](deployment.md) — production deploy steps
- [../platform/d1-architecture.md](../platform/d1-architecture.md) — query API, cache layers
- [../platform/auth-firebase.md](../platform/auth-firebase.md) — full auth chain
- [../database/README.md](../database/README.md) — phase status, punchlist

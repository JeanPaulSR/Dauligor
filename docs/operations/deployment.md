# Deployment

The app deploys to **Cloudflare Pages** (SPA + Pages Functions) and **Cloudflare Workers** (the storage worker that backs D1 + R2). Pages auto-deploys from `main`; the Worker deploys manually. There is no single "ship it" button — you trigger each side intentionally.

## Production layout

| Component | Where | How updated |
|---|---|---|
| Frontend SPA | Cloudflare Pages | Auto-deploys on push to `main` (Pages Git integration) |
| Pages Functions (`functions/api/**`) | Cloudflare Pages | Same auto-deploy as the SPA |
| Cloudflare Worker (storage) | Cloudflare Workers | Manual `wrangler deploy` from `worker/` |
| D1 schema | Cloudflare D1 | Manual `wrangler d1 execute … --remote` |
| R2 bucket | Cloudflare R2 | Created once; objects are mutated by the Worker |
| Firebase Auth | Google | No deploy step — config lives in `firebase-applet-config.json` |

## Frontend + Pages Functions

`git push origin main` (or merge a PR into `main`) triggers an auto-deploy. Cloudflare Pages clones the repo, runs `npm install` + `npm run build`, deploys `dist/` as static plus the `functions/api/**` tree as Pages Functions, and ships within a few minutes. Watch the deploy logs in the Pages dashboard for build errors.

Non-production branch pushes auto-deploy to per-branch preview URLs (e.g. `https://<branch>.dauligor.pages.dev`) which are isolated from production. The Pages-side custom-domain attachment (`www.dauligor.com`, `dauligor.com`) is pinned to the production branch only.

### Required Pages env vars

Set in the Pages dashboard → Settings → Variables and Secrets. **Important: set them for BOTH the Production environment AND the Preview environment** — the dashboard defaults to one at a time, and bindings on Production do not auto-mirror to Preview. Easy to miss on first setup.

- `R2_WORKER_URL` — `https://dauligor-storage.<account>.workers.dev` (or a custom domain)
- `R2_API_SECRET` (encrypted) — must match the Worker's `API_SECRET`
- `FIREBASE_SERVICE_ACCOUNT_JSON` (encrypted) — service-account JSON, all on one line. Required by the admin user-management endpoints (createUser / updateUser for username renames + temp passwords / deleteUser / createCustomToken for sign-in links). JWT verification does NOT need it (jose+JWKS is credential-free); only the admin user-mgmt path 503s if missing.
- `CF_PAGES_URL` — injected by the Pages runtime automatically; used as a fallback in `api/_lib/module-export-store.ts` when `PUBLIC_SITE_URL` isn't set.

Optional:
- `PUBLIC_SITE_URL` — explicit override for the deployment hostname used to warm the public CDN after a bake. Defaults to `CF_PAGES_URL`.
- `FIREBASE_PROJECT_ID` — defaults to `gen-lang-client-0493579997`; only override if pointing at a different Firebase project.

### Compatibility flag

`compatibility_flags = ["nodejs_compat"]` in [wrangler.toml](../../wrangler.toml) is required — the shared helpers in `api/_lib/*` use `Buffer`, `process.env`, and a few other Node globals that only exist under the nodejs_compat shim. With `compatibility_date >= 2025-04-21` the runtime also auto-populates `process.env` from the binding context, so the helpers can read env vars directly without an explicit `context.env → process.env` projection.

### Cross-folder import pattern (drift-managed pairs)

A few server-side helpers under `api/_lib/` (`_classExport.ts`, `_referenceSyntax.ts`, `_classProgression.ts`) mirror their client-side equivalents under `src/lib/` for clarity and bundle-size reasons. **Both copies must stay in sync** — see the per-file headers and `docs/architecture/foundry-integration.md §6`. The original justification was Vercel's bundler not reliably traversing `api/` ↔ `src/` imports; Pages Functions don't have that limitation, but keeping the pairs as siblings still scopes the bundle correctly.

## Cloudflare Worker

The Worker is the gateway to D1 and R2. Deploy it whenever you change [worker/index.js](../../worker/index.js) or [worker/wrangler.toml](../../worker/wrangler.toml).

```bash
cd worker
npx wrangler deploy
```

First-time setup of secrets:

```bash
npx wrangler secret put API_SECRET
# paste the production secret value when prompted
```

`R2_PUBLIC_URL` is in `[vars]` in `wrangler.toml` (not a secret) and ships with the Worker.

Bindings (`BUCKET` for R2, `DB` for D1) are also defined in `wrangler.toml` and applied on deploy.

## D1 schema migrations

**Always run `--local` first**, validate the app against local D1, then run `--remote`.

```bash
# After validating locally:
cd worker
npx wrangler d1 execute dauligor-db --remote --file=migrations/00NN_*.sql
```

Once a migration has been applied to remote D1, it cannot be cleanly reversed without writing a counter-migration. Treat `--remote` as a one-way door.

### Bulk data ops (rare)

If you ever need to copy local D1 → remote (e.g. after rebuilding local from scratch and wanting remote to match):

```bash
cd worker
npx wrangler d1 export dauligor-db --local --output=./local-dump.sql --no-schema
# Wipe rows you want to overwrite, then:
npx wrangler d1 execute dauligor-db --remote --file=./local-dump.sql
rm ./local-dump.sql
```

Don't commit dumps; they're in `.gitignore` (`worker/*-dump.sql`).

## R2 bucket

The bucket exists once, in production. `worker/wrangler.toml` references it by name (`dauligor-storage`). Don't recreate or rename — that breaks every public image URL.

If you ever need to reorganise the bucket, do it via the Worker's `/move-folder` endpoint (called from the Image Manager UI). Direct R2 console operations bypass the metadata sync that `imageMetadata` depends on.

## Rolling back

The intended rollback is **branch-level**:

- If a Pages deploy regresses, revert the offending commit on `main`. Pages auto-deploys the revert within minutes.
  - The Pages dashboard also has a per-deployment "Rollback to this deployment" button on any successful past deployment — instant, no Git step required. Useful when you want a known-good rollback while you investigate the regression on a branch.
- If a Worker deploy regresses behaviour, redeploy the prior commit's `worker/index.js` (`git checkout <hash> -- worker/index.js && cd worker && npx wrangler deploy`).
- If a remote D1 migration introduced a bad column, write a counter-migration that drops/renames it. SQLite has limited `ALTER TABLE` support; sometimes the cleanest path is a follow-up migration that creates a new table, copies rows, drops the old, and renames.

## Pre-deploy checklist

- [ ] `npm run build` clean locally
- [ ] `npx tsc --noEmit` count is at the documented baseline (or lower)
- [ ] If a D1 migration is part of the change: `--local` applied + tested before `--remote`
- [ ] If `worker/index.js` changed: `wrangler deploy` ready to run
- [ ] If the export shape changed: both `src/lib/classExport.ts` AND `api/_lib/_classExport.ts` updated together (drift contract — see [../architecture/foundry-integration.md §6](../architecture/foundry-integration.md#6-how-the-pipeline-is-wired-today))
- [ ] Pages env vars confirmed on **both** Production and Preview environments (`R2_WORKER_URL` points to the **prod** Worker)
- [ ] Production smoke test: sign in, view a class, edit a lore article, upload an image

## Related docs

- [local-dev.md](local-dev.md) — local setup, two-terminal workflow
- [troubleshooting.md](troubleshooting.md) — recovery from deploy mishaps
- [../platform/env-vars.md](../platform/env-vars.md) — every env var, prod-vs-dev values
- [../database/README.md](../database/README.md) — schema philosophy and migration index
- [../architecture/foundry-integration.md](../architecture/foundry-integration.md) — Foundry export pipeline + drift contract

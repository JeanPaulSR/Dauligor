# Project Directory Map

File-resolution guide. Pair with [AGENTS.md](AGENTS.md) for the agent briefing and [docs/](docs/) for topic-deep documentation.

## 1. Top-level

| Path | Purpose |
|---|---|
| [AGENTS.md](AGENTS.md) | Agent / contributor briefing — read first |
| [README.md](README.md) | Public-facing project overview |
| [DIRECTORY_MAP.md](DIRECTORY_MAP.md) | This file |
| [Overview.txt](Overview.txt) | High-level system intent (short) |
| [docs/](docs/) | Full documentation tree |
| [package.json](package.json), [tsconfig.json](tsconfig.json), [vite.config.ts](vite.config.ts), [components.json](components.json), [wrangler.toml](wrangler.toml) | Standard build / TS / Vite / shadcn / Pages config |
| [firebase-applet-config.json](firebase-applet-config.json) | Firebase Auth client config (project IDs only — not a secret) |
| [.env.example](.env.example) | Sample environment variables |
| `FIREBASE_SERVICE_ACCOUNT_JSON` env var | Inline service-account JSON; required server-side only for admin user-management endpoints (createUser / updateUser / deleteUser / createCustomToken). JWT verification doesn't need it (jose+JWKS). Set in `.env` locally and in the Pages dashboard Variables & Secrets (both Production and Preview environments) on the deployed side. The legacy `firebase-service-account.json` file path is no longer read. |

## 2. Application source (`src/`)

| Path | Purpose |
|---|---|
| `src/App.tsx` | Global route table; top-level state (`userProfile`, `effectiveProfile`, `previewMode`, foundation heartbeat) |
| `src/index.css` | Tailwind directives; theme variables; named utility classes |
| `src/components/` | Shared UI components |
| `src/components/ui/` | shadcn/ui primitives |
| `src/components/compendium/` | Domain components: `AdvancementManager`, `ActivityEditor`, `ActiveEffectEditor`, `FilterBar`, `ModularChoiceView`, `SpellImportWorkbench`, `SpellArtPreview`, `DevelopmentCompendiumManager` |
| `src/components/reference/` | Reference syntax helpers — `ReferenceSyntaxHelp`, `ReferenceSheetDialog`, `CharacterReferencePanel` |
| `src/hooks/` | React hooks (`useUnsavedChangesWarning`, etc.) |
| `src/pages/core/` | `Home`, `Map`, `Profile`, `Settings` |
| `src/pages/wiki/` | `Wiki`, `LoreArticle`, `LoreEditor` |
| `src/pages/compendium/` | Class / spell / option / scaling editors |
| `src/pages/compendium/scaling/` | Scaling-specific editors (`SpellcastingScalingEditor`, etc.) |
| `src/pages/admin/` | Admin panels (`AdminUsers`, `AdminCampaigns`, `ImageManager`, ability/category editors) |
| `src/pages/characters/` | `CharacterList`, `CharacterBuilder` |
| `src/pages/sources/` | `Sources`, `SourceDetail`, `SourceEditor` |
| `src/pages/campaign/` | `CampaignManager`, `CampaignEditor` |

### Library (`src/lib/`)

| File | Role |
|---|---|
| [src/lib/d1.ts](src/lib/d1.ts) | **D1 client** — `queryD1`, `batchQueryD1`, `fetchCollection`, `fetchDocument`, `upsertDocument`, `upsertDocumentBatch`, `deleteDocument`, in-memory + sessionStorage caches, foundation heartbeat. **Auto-parses a fixed list of JSON columns** before returning rows; downstream remap blocks must pass through already-parsed values (see AGENTS.md §4). |
| [src/lib/d1Tables.ts](src/lib/d1Tables.ts) | Standalone `D1_TABLE_MAP` + `getTableName` (no other deps; importable from server contexts) |
| [src/lib/firebase.ts](src/lib/firebase.ts) | **Firebase Authentication.** `usernameToEmail`, `reportClientError`, `OperationType` enum. |
| [src/lib/r2.ts](src/lib/r2.ts) | R2 client — `r2Upload`, `r2List`, `r2Delete`, `r2Rename`, `r2MoveFolder` |
| [src/lib/imageMetadata.ts](src/lib/imageMetadata.ts) | Image metadata CRUD + reference scanning |
| [src/lib/imageUtils.ts](src/lib/imageUtils.ts) | WebP conversion + center-crop |
| [src/lib/bbcode.ts](src/lib/bbcode.ts) | BBCode ↔ HTML conversion |
| [src/lib/lore.ts](src/lib/lore.ts) | Lore article helpers |
| [src/lib/compendium.ts](src/lib/compendium.ts) | Compendium-wide helpers (denormalize / normalize entry points) |
| [src/lib/classExport.ts](src/lib/classExport.ts) | **Client-side semantic class export pipeline.** `exportClassSemantic(classId, fetchers)`, `getSemanticSourceId`, denormalize\* / normalize\* helpers, plus the zip-export functions used by the UI download buttons. Mirrored on the server side in `api/_lib/_classExport.ts` — see §3. |
| [src/lib/classProgression.ts](src/lib/classProgression.ts) | Canonical class-progression builder |
| [src/lib/advancementState.ts](src/lib/advancementState.ts) | Advancement normalisation |
| [src/lib/characterExport.ts](src/lib/characterExport.ts) | `dauligor.actor-bundle.v1` export trigger (client) |
| [src/lib/characterLogic.ts](src/lib/characterLogic.ts), [src/lib/characterShared.ts](src/lib/characterShared.ts) | Shared character-side logic; `buildCharacterExport` lives here and is called from both the client downloader and the server admin/export endpoints |
| [src/lib/spellcasting.ts](src/lib/spellcasting.ts) | Multiclass slot computation |
| [src/lib/spellSummary.ts](src/lib/spellSummary.ts) | Spell summary index helpers |
| [src/lib/spellImport.ts](src/lib/spellImport.ts) | Foundry spell folder importer |
| [src/lib/referenceSyntax.ts](src/lib/referenceSyntax.ts) | `@prof` / `@scale.*` resolution |
| [src/lib/wikiPreviewContext.ts](src/lib/wikiPreviewContext.ts) | Wiki preview-mode context |
| [src/lib/utils.ts](src/lib/utils.ts) | `cn()` helper for `tailwind-merge` |

## 3. Server / proxy / Worker

| Path | Purpose |
|---|---|
| [server.ts](server.ts) | Express dev server — wires Pages-equivalent routes for `npm run dev` + Vite middleware. Excludes `/api/module/*` (Pages-only — use `wrangler pages dev` for that). |
| [functions/api/](functions/api/) | **Cloudflare Pages Functions** — native handler files for every `/api/*` route. Filesystem routing: `functions/api/me/[[path]].ts` serves `/api/me/*`, `functions/api/characters/[id].ts` serves `/api/characters/<id>`, etc. |
| [api/_lib/](api/_lib/) | Shared runtime-portable library code consumed by both Pages Functions and the local Express server. No Vercel-shaped (req, res) handlers live at the top level of `api/` anymore. |
| [api/_lib/firebase-admin.ts](api/_lib/firebase-admin.ts) | JWT verification via `jose` against Firebase's public JWKS (no Admin SDK); `requireStaffAccess` / `requireImageManagerAccess` / `requireAdminAccess` helpers. Admin user-management (createUser, updateUser, deleteUser, createCustomToken) uses Firebase Identity Toolkit REST. |
| [api/_lib/pages-adapter.ts](api/_lib/pages-adapter.ts) | Vercel-shape `(req, res) → onRequest(context) → Response` adapter. Used only by the two Pages Functions whose backing `_lib` helpers are still `(req, res)`-shaped (`functions/api/d1/query.ts` and `functions/api/r2/[action].ts`). Goes away when `d1-proxy.ts` and `r2-proxy.ts` are rewritten to native Fetch API. |
| [api/_lib/d1-internal.ts](api/_lib/d1-internal.ts) | `executeD1QueryInternal`, `loadUserRoleFromD1` — server-side worker proxy that doesn't need a client JWT |
| [api/_lib/d1-proxy.ts](api/_lib/d1-proxy.ts) | `handleD1Query` — proxies authenticated `/api/d1/query` requests to the Worker. Still `(req, res)`-shaped; called via `pages-adapter` from the Pages Function. |
| [api/_lib/r2-proxy.ts](api/_lib/r2-proxy.ts) | R2 proxy handlers — `(req, res)`-shaped; called via `pages-adapter` from `functions/api/r2/[action].ts`. |
| [api/_lib/d1-fetchers-server.ts](api/_lib/d1-fetchers-server.ts) | `SERVER_EXPORT_FETCHERS` — adapters that match the client `fetchCollection`/`fetchDocument` signature but talk through `executeD1QueryInternal`. Inlined table map (no cross-folder src/ import). |
| [api/_lib/_classExport.ts](api/_lib/_classExport.ts), [_referenceSyntax.ts](api/_lib/_referenceSyntax.ts), [_classProgression.ts](api/_lib/_classProgression.ts) | Drift-managed server copies of `src/lib/classExport.ts`, `src/lib/referenceSyntax.ts`, `src/lib/classProgression.ts`. Sibling-pair pattern keeps the server bundle scoped to `api/` for clarity. **Both copies must stay in sync** — see headers at the top of each file. |
| [functions/api/d1/query.ts](functions/api/d1/query.ts) | Adapter-shim Pages Function that delegates to `handleD1Query`. |
| [functions/api/r2/[action].ts](functions/api/r2/[action].ts) | Adapter-shim that dispatches on `params.action` (`list`, `delete`, `rename`, `move-folder`, `upload`, `scan-references`, `rewrite-references`) and delegates to the matching `r2-proxy` handler. |
| [functions/api/admin/](functions/api/admin/) | Admin-only endpoints (`characters.ts`, `users/[[path]].ts`, `eras/[[path]].ts`). |
| [functions/api/module/[[path]].ts](functions/api/module/[[path]].ts) | Foundry module dynamic catalog API. Returns `dauligor.source-catalog.v1`, per-source `dauligor.class-catalog.v1`, per-class `dauligor.semantic.class-export` bundles, and live per-class / per-spell / per-source / tag-catalog endpoints. Read-through R2 cache for the baked bundles; opportunistic queue processing via `context.waitUntil`. |

## 4. Worker

| Path | Purpose |
|---|---|
| [worker/index.js](worker/index.js) | Cloudflare Worker — single process, two bindings (`BUCKET` for R2, `DB` for D1); auth via shared `API_SECRET` |
| [worker/wrangler.toml](worker/wrangler.toml) | Worker config — D1 DB ID, R2 bucket binding, public URL |
| [worker/migrations/](worker/migrations/) | D1 schema migrations (`0001_phase1_foundation.sql` … `0017_map_markers.sql`, `9999_cleanup.sql`). 0016 was stillborn and removed — the chain skips from 0015 to 0017. |
| `worker/.dev.vars` | Local Worker secrets (`API_SECRET`) — gitignored |
| `worker/.wrangler/state/` | Local D1 + R2 emulation state — gitignored |

## 5. Operational scripts (active)

| Path | Purpose |
|---|---|
| [scripts/backup-d1.mjs](scripts/backup-d1.mjs) | D1 backup runner (`npm run backup:d1`) |
| [scripts/restore-d1.mjs](scripts/restore-d1.mjs) | D1 restore runner (`npm run restore:d1`) |
| [scripts/d1-timetravel.mjs](scripts/d1-timetravel.mjs) | D1 Time Travel diagnostic (`npm run timetravel`) |
| [scripts/install-nightly-backup.ps1](scripts/install-nightly-backup.ps1) / [uninstall-nightly-backup.ps1](scripts/uninstall-nightly-backup.ps1) | Windows scheduled-task installer for nightly backups |
| [scripts/_repro_progression_loop.mjs](scripts/_repro_progression_loop.mjs) | Headless regression harness for the character-builder normalize/build loop — `npx tsx scripts/_repro_progression_loop.mjs` |

## 5a. Historical scripts ([scripts/_archive/](scripts/_archive/))

One-shot migration utilities and codemods retained as reference material. **None of them are part of the regular dev or deploy loop** and they're not invoked from `package.json`. Contents include the original data importers (`migrate.js`, `migrate_subclasses.js`), the field-drift audit tools (`_audit-*.py`, `_audit_field_drift.js`), the codemods that retired legacy client patterns (`_rename_error_helper.mjs`, `_rewrite_fetchers.mjs`), and the one-off rename / dedup scripts (`rename-blade-of-disaster.js`, `delete-replaced-sorcerer-set.js`).

## 6. Foundry pairing module

| Path | Purpose |
|---|---|
| [module/dauligor-pairing/](module/dauligor-pairing/) | Foundry VTT module dev source |
| [module/dauligor-pairing/module.json](module/dauligor-pairing/module.json) | Foundry manifest (v13 + dnd5e; requires `lib-wrapper` + `socketlib`) |
| [module/dauligor-pairing/scripts/](module/dauligor-pairing/scripts/) | Module runtime (`main.js`, `class-import-service.js`, `import-service.js`, `update-character.js`, etc.) |
| [module/dauligor-pairing/templates/](module/dauligor-pairing/templates/) | Handlebars templates (`.hbs`) |
| [module/dauligor-pairing/styles/](module/dauligor-pairing/styles/) | Module CSS |
| [module/dauligor-pairing/data/sources/](module/dauligor-pairing/data/sources/) | Static seed data for the source catalog. Used as bootstrap material when populating R2 on a fresh deployment; no longer hit at runtime (the legacy `fs.readFileSync` fallback was removed in the Pages migration). |
| [module/dauligor-pairing/docs/](module/dauligor-pairing/docs/) | Module-side documentation — see [`import-contract-index.md`](module/dauligor-pairing/docs/import-contract-index.md) for the master index of canonical contracts |
| [module/dauligor-pairing/notes-for-app-team/](module/dauligor-pairing/notes-for-app-team/) | Correction notes from the module side to the app side; each one should be actioned and retired |

## 7. Documentation tree

| Path | Coverage |
|---|---|
| [docs/README.md](docs/README.md) | Topic-segmented index |
| [docs/platform/](docs/platform/) | Runtime, D1, R2, auth, env vars |
| [docs/database/](docs/database/) | D1 schema, migrations, phase-by-phase migration record |
| [docs/database/structure/](docs/database/structure/) | Per-table specs (16 files). The DDL in `worker/migrations/0001_phase1_foundation.sql` and later is the authoritative source for any table not yet covered here |
| [docs/_archive/migration-details/](docs/_archive/migration-details/) | Phase-by-phase migration plans (5 files). Historical. |
| [docs/features/](docs/features/) | Per-feature docs (wiki-lore, compendium-\*, character-builder, character-sheet, campaigns-eras, admin-users, image-manager, foundry-export) |
| [docs/ui/](docs/ui/) | Style guide, theming, BBCode, content rendering, components |
| [docs/architecture/](docs/architecture/) | Routing, RBAC, foundry-integration, reference-syntax, compendium-editor-patterns |
| [docs/operations/](docs/operations/) | Local dev, deployment, troubleshooting |
| [docs/_archive/](docs/_archive/) | Pre-migration / superseded docs (kept for history; not authoritative) |
| [docs/database-memory.md](docs/database-memory.md) | High-level state registry — last-known migration status + cut-over checklist |

## 8. Technical decision matrix

| Task | Procedure |
|---|---|
| **Add a route** | Update `Routes` in `src/App.tsx` and `NAV_ITEMS` in `src/components/Sidebar.tsx` |
| **Add a D1 query path** | Use helpers in `src/lib/d1.ts`. See [docs/platform/d1-architecture.md](docs/platform/d1-architecture.md) |
| **Add a D1 table** | Write migration in `worker/migrations/`; apply locally first; document in `docs/database/structure/`; update `D1_TABLE_MAP` in [src/lib/d1Tables.ts](src/lib/d1Tables.ts) (mirror in `api/_lib/d1-fetchers-server.ts` if the table is needed server-side) |
| **Add a Pages Function** | Add a `functions/api/<path>.ts` file (single-segment) or `functions/api/<resource>/[[path]].ts` for a catch-all dispatcher. Export `onRequest(context)` returning `Response`. Mirror in `server.ts` for local-dev parity if the route is exercised via `npm run dev`. Shared helpers go in `api/_lib/`. |
| **Add an R2 upload site** | Use `ImageUpload` in `src/components/ui/ImageUpload.tsx`; storage key under `images/`, `icons/`, or `tokens/` |
| **Style a new component** | Use named classes from [docs/ui/style-guide.md](docs/ui/style-guide.md) before reaching for inline Tailwind |
| **BBCode tag** | Update `src/lib/bbcode.ts` and `BBCodeRenderer.tsx`. See [docs/ui/bbcode.md](docs/ui/bbcode.md) |
| **RBAC change** | Update `users.role` enum (D1 schema) and the relevant `requireXAccess` helper in `api/_lib/firebase-admin.ts` |
| **Auth debugging** | See [docs/platform/auth-firebase.md](docs/platform/auth-firebase.md) |
| **Change the class export shape** | Edit `src/lib/classExport.ts` (client downloader). Mirror the change in `api/_lib/_classExport.ts` (server endpoint). Forgetting either side will silently desync the Foundry module's import flow. |
| **Change Foundry module contract** | Update both the relevant doc under `module/dauligor-pairing/docs/` AND the matching server-side mapping in `functions/api/module/[[path]].ts` / `_classExport.ts`. App-side schema changes that affect the module should also flag `module/dauligor-pairing/docs/schema-crosswalk.md` for review. |
| **Production deploy** | Push to `main` triggers Cloudflare Pages auto-deploy. Worker deploys via `cd worker && npx wrangler deploy`. Remote D1 migrations via `npx wrangler d1 execute dauligor-db --remote --file=migrations/<file>.sql`. See [docs/operations/deployment.md](docs/operations/deployment.md). |

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
| [package.json](package.json), [tsconfig.json](tsconfig.json), [vite.config.ts](vite.config.ts), [components.json](components.json), [vercel.json](vercel.json) | Standard build / TS / Vite / shadcn / deploy config |
| [firebase-applet-config.json](firebase-applet-config.json) | Firebase Auth client config (project IDs only — not a secret) |
| [.env.example](.env.example) | Sample environment variables |
| `firebase-service-account.json` | Local-only credential for Firebase Admin SDK; never committed. Required for admin endpoints (e.g. generating temporary passwords). Production sets the same JSON via the `FIREBASE_SERVICE_ACCOUNT_JSON` env var on Vercel. |

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
| [src/lib/firebase.ts](src/lib/firebase.ts) | **Firebase Authentication only.** `usernameToEmail`, `reportClientError`, `OperationType` enum. Top-of-file guardrail forbids `firebase/firestore` imports. |
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
| [server.ts](server.ts) | Express dev server — wires Vercel-equivalent routes + Vite middleware |
| [api/](api/) | Vercel serverless functions |
| [api/_lib/firebase-admin.ts](api/_lib/firebase-admin.ts) | JWT verification; `requireStaffAccess` / `requireImageManagerAccess` / `requireAdminAccess`. **Currently the only consumer of the Firebase Admin SDK** — see [memory: Firebase Auth exit plan](#) for the queued JWKS-based replacement |
| [api/_lib/d1-internal.ts](api/_lib/d1-internal.ts) | `executeD1QueryInternal`, `loadUserRoleFromD1` — server-side worker proxy that doesn't need a client JWT |
| [api/_lib/d1-proxy.ts](api/_lib/d1-proxy.ts) | `handleD1Query` — proxies authenticated `/api/d1/query` requests to the Worker |
| [api/_lib/r2-proxy.ts](api/_lib/r2-proxy.ts) | R2 proxy — forwards `/api/r2/*` to the Worker |
| [api/_lib/d1-fetchers-server.ts](api/_lib/d1-fetchers-server.ts) | `SERVER_EXPORT_FETCHERS` — adapters that match the client `fetchCollection`/`fetchDocument` signature but talk through `executeD1QueryInternal`. Inlined table map (no cross-folder src/ import). Used by `_classExport` server copy. |
| [api/_lib/_classExport.ts](api/_lib/_classExport.ts) | **Server copy** of `src/lib/classExport.ts` (stripped of zip exports + `importClassSemantic`). Drift-warning header at the top — keep in sync with the client version. Justification: Vercel's serverless bundler does not reliably traverse cross-folder `src/` imports; this lives as a sibling. |
| [api/_lib/_referenceSyntax.ts](api/_lib/_referenceSyntax.ts) | Verbatim copy of `src/lib/referenceSyntax.ts` for the same reason |
| [api/_lib/_classProgression.ts](api/_lib/_classProgression.ts) | Verbatim copy of `src/lib/classProgression.ts` for the same reason |
| [api/d1/query.ts](api/d1/query.ts) | Vercel handler that wraps `handleD1Query` |
| [api/r2/upload.ts](api/r2/upload.ts), `list.ts`, `delete.ts`, `rename.ts`, `move-folder.ts` | R2 endpoints |
| [api/admin/](api/admin/) | Admin-only endpoints (user temp password etc.) |
| [api/module.ts](api/module.ts) | Foundry module dynamic catalog API. Returns `dauligor.source-catalog.v1`, per-source `dauligor.class-catalog.v1`, and per-class `dauligor.semantic.class-export` bundles built via `_classExport` server copy. |
| [api/module/](api/module/) | Reserved for future module-side endpoints (currently empty after the catchall was removed; `vercel.json` rewrites `/api/module/*` → `/api/module`) |

## 4. Worker

| Path | Purpose |
|---|---|
| [worker/index.js](worker/index.js) | Cloudflare Worker — single process, two bindings (`BUCKET` for R2, `DB` for D1); auth via shared `API_SECRET` |
| [worker/wrangler.toml](worker/wrangler.toml) | Worker config — D1 DB ID, R2 bucket binding, public URL |
| [worker/migrations/](worker/migrations/) | D1 schema migrations (`0001_phase1_foundation.sql` … `0017_map_markers.sql`, `9999_cleanup.sql`). 0016 was stillborn and removed — the chain skips from 0015 to 0017. |
| `worker/.dev.vars` | Local Worker secrets (`API_SECRET`) — gitignored |
| `worker/.wrangler/state/` | Local D1 + R2 emulation state — gitignored |

## 5. Migration scripts (historical)

The Firestore→D1 migration is complete. These scripts are kept for posterity and as reference material if a similar migration is ever needed; they are **not part of the regular dev or deploy loop**.

| Path | Purpose |
|---|---|
| [scripts/migrate.js](scripts/migrate.js) | Firestore → local D1 (one-time, completed) |
| [scripts/migrate_subclasses.js](scripts/migrate_subclasses.js) | Targeted subclass migration (one-time) |
| [scripts/check_firestore.js](scripts/check_firestore.js) | Pre-migration sanity check (no longer applicable) |
| `scripts/_audit-*.py`, `scripts/_audit_field_drift.js` | Field-drift audit scripts used to compare Firestore JSON dumps against migrated D1 rows during the cut |

## 6. Foundry pairing module

| Path | Purpose |
|---|---|
| [module/dauligor-pairing/](module/dauligor-pairing/) | Foundry VTT module dev source |
| [module/dauligor-pairing/module.json](module/dauligor-pairing/module.json) | Foundry manifest (v13 + dnd5e; requires `lib-wrapper` + `socketlib`) |
| [module/dauligor-pairing/scripts/](module/dauligor-pairing/scripts/) | Module runtime (`main.js`, `class-import-service.js`, `import-service.js`, `update-character.js`, etc.) |
| [module/dauligor-pairing/templates/](module/dauligor-pairing/templates/) | Handlebars templates (`.hbs`) |
| [module/dauligor-pairing/styles/](module/dauligor-pairing/styles/) | Module CSS |
| [module/dauligor-pairing/data/sources/](module/dauligor-pairing/data/sources/) | Static export catalog (also reachable via `/api/module/*`); fallback when the dynamic API path is unavailable |
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
| **Add a D1 query path** | Use helpers in `src/lib/d1.ts`. Never call `firebase/firestore`. See [docs/platform/d1-architecture.md](docs/platform/d1-architecture.md) |
| **Add a D1 table** | Write migration in `worker/migrations/`; apply locally first; document in `docs/database/structure/`; update `D1_TABLE_MAP` in [src/lib/d1Tables.ts](src/lib/d1Tables.ts) (mirror in `api/_lib/d1-fetchers-server.ts` if the table is needed server-side) |
| **Add a Vercel function** | Add to `api/`. Mirror in `server.ts` for local dev. Cross-folder imports from `api/` to `src/lib/` are unreliable in Vercel's bundler — keep server-only deps inside `api/_lib/` (see `_classExport.ts` for the pattern). |
| **Add an R2 upload site** | Use `ImageUpload` in `src/components/ui/ImageUpload.tsx`; storage key under `images/`, `icons/`, or `tokens/` |
| **Style a new component** | Use named classes from [docs/ui/style-guide.md](docs/ui/style-guide.md) before reaching for inline Tailwind |
| **BBCode tag** | Update `src/lib/bbcode.ts` and `BBCodeRenderer.tsx`. See [docs/ui/bbcode.md](docs/ui/bbcode.md) |
| **RBAC change** | Update `users.role` enum (D1 schema) and the relevant `requireXAccess` helper in `api/_lib/firebase-admin.ts` |
| **Auth debugging** | See [docs/platform/auth-firebase.md](docs/platform/auth-firebase.md) |
| **Change the class export shape** | Edit `src/lib/classExport.ts` (client downloader). Mirror the change in `api/_lib/_classExport.ts` (server endpoint). Forgetting either side will silently desync the Foundry module's import flow. |
| **Change Foundry module contract** | Update both the relevant doc under `module/dauligor-pairing/docs/` AND the matching server-side mapping in `api/module.ts` / `_classExport.ts`. App-side schema changes that affect the module should also flag `module/dauligor-pairing/docs/schema-crosswalk.md` for review. |
| **Production deploy** | Push to `main` triggers Vercel auto-deploy. Worker deploys via `cd worker && npx wrangler deploy`. Remote D1 migrations via `npx wrangler d1 execute dauligor-db --remote --file=migrations/<file>.sql`. See [docs/operations/deployment.md](docs/operations/deployment.md). |

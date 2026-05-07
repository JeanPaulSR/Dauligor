# Project Directory Map

File-resolution guide. Pair with [AGENTS.md](AGENTS.md) for the agent briefing and [docs/](docs/) for topic-deep documentation.

## 1. Top-level

| Path | Purpose |
|---|---|
| [AGENTS.md](AGENTS.md) | Agent / contributor briefing — read first |
| [README.md](README.md) | Public-facing project overview |
| [DIRECTORY_MAP.md](DIRECTORY_MAP.md) | This file |
| [Overview.txt](Overview.txt) | High-level system intent (legacy short doc) |
| [docs/](docs/) | Full documentation tree |
| [schemas/](schemas/) | Interface and validation specs for primary entities |
| [package.json](package.json), [tsconfig.json](tsconfig.json), [vite.config.ts](vite.config.ts), [components.json](components.json), [vercel.json](vercel.json) | Standard build / TS / Vite / shadcn / deploy config |
| [firebase-applet-config.json](firebase-applet-config.json) | Firebase Auth client config (project IDs only — not a secret) |
| [.env.example](.env.example) | Sample environment variables |

### Migration-era leftovers (going away once Firestore is cut)
| Path | Status |
|---|---|
| `firestore.rules`, `firebase.json`, `firebase-blueprint.json`, `storage.rules` | Delete after migration |
| `firebase-service-account.json` | Local-only; never committed |

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
| [src/lib/d1.ts](src/lib/d1.ts) | **D1 client** — `queryD1`, `batchQueryD1`, `fetchCollection`, `fetchDocument`, `upsertDocument`, `upsertDocumentBatch`, `deleteDocument`, cache layers, foundation heartbeat |
| [src/lib/firebase.ts](src/lib/firebase.ts) | Firebase Auth init + (legacy) Firestore client; `usernameToEmail` |
| [src/lib/r2.ts](src/lib/r2.ts) | R2 client — `r2Upload`, `r2List`, `r2Delete`, `r2Rename`, `r2MoveFolder` |
| [src/lib/imageMetadata.ts](src/lib/imageMetadata.ts) | Image metadata CRUD + reference scanning |
| [src/lib/imageUtils.ts](src/lib/imageUtils.ts) | WebP conversion + center-crop |
| [src/lib/bbcode.ts](src/lib/bbcode.ts) | BBCode ↔ HTML conversion |
| [src/lib/lore.ts](src/lib/lore.ts) | Lore article helpers |
| [src/lib/compendium.ts](src/lib/compendium.ts) | Compendium-wide helpers |
| [src/lib/classExport.ts](src/lib/classExport.ts) | Semantic class export pipeline |
| [src/lib/classProgression.ts](src/lib/classProgression.ts) | Canonical class-progression builder |
| [src/lib/advancementState.ts](src/lib/advancementState.ts) | Advancement normalisation |
| [src/lib/characterExport.ts](src/lib/characterExport.ts) | `dauligor.actor-bundle.v1` export |
| [src/lib/characterLogic.ts](src/lib/characterLogic.ts), [src/lib/characterShared.ts](src/lib/characterShared.ts) | Shared character-side logic |
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
| [api/](api/) | Vercel functions |
| [api/_lib/firebase-admin.ts](api/_lib/firebase-admin.ts) | JWT verification; `requireStaffAccess` / `requireImageManagerAccess` / `requireAdminAccess` |
| [api/_lib/d1-proxy.ts](api/_lib/d1-proxy.ts) | D1 proxy — forwards `/api/d1/query` to the Worker |
| [api/_lib/r2-proxy.ts](api/_lib/r2-proxy.ts) | R2 proxy — forwards `/api/r2/*` to the Worker |
| [api/d1/query.ts](api/d1/query.ts) (or wired in `server.ts`) | D1 query endpoint |
| [api/r2/upload.ts](api/r2/upload.ts), `list.ts`, `delete.ts`, `rename.ts`, `move-folder.ts` | R2 endpoints |
| [api/admin/](api/admin/) | Admin-only endpoints (spell upsert/delete/purge/import-batch, user temp password) |
| [api/module/](api/module/), [api/module.ts](api/module.ts) | Foundry module dynamic catalog API |

## 4. Worker

| Path | Purpose |
|---|---|
| [worker/index.js](worker/index.js) | Cloudflare Worker — single process, two bindings (`BUCKET` for R2, `DB` for D1) |
| [worker/wrangler.toml](worker/wrangler.toml) | Worker config — D1 DB ID, R2 bucket, public URL |
| [worker/migrations/](worker/migrations/) | D1 schema migrations (`0001_phase1_foundation.sql` … `0011_system_metadata.sql`, `9999_cleanup.sql`) |
| `worker/.dev.vars` | Local Worker secrets (`API_SECRET`, `R2_PUBLIC_URL`) — not committed |
| `worker/.wrangler/state/` | Local D1 + R2 emulation state — git-ignored |

## 5. Migration scripts

| Path | Purpose |
|---|---|
| [scripts/migrate.js](scripts/migrate.js) | Firestore → local D1 (Phase 1–4) |
| [scripts/migrate_subclasses.js](scripts/migrate_subclasses.js) | Targeted subclass migration |
| [scripts/check_firestore.js](scripts/check_firestore.js) | Pre-migration sanity check on Firestore document counts |

## 6. Foundry pairing module

| Path | Purpose |
|---|---|
| [module/dauligor-pairing/](module/dauligor-pairing/) | Foundry VTT module dev source |
| [module/dauligor-pairing/scripts/](module/dauligor-pairing/scripts/) | Module runtime (`class-import-service.js`, `update-character.js`, etc.) |
| [module/dauligor-pairing/templates/](module/dauligor-pairing/templates/) | Handlebars templates (`.hbs`) |
| [module/dauligor-pairing/data/sources/](module/dauligor-pairing/data/sources/) | Static export catalog (also reachable via `/api/module/*`) |
| [module/dauligor-pairing/docs/](module/dauligor-pairing/docs/) | Module-side documentation (separate from app `docs/`) |
| [module/dauligor-pairing/corpus/](module/dauligor-pairing/corpus/) | Reference empty/example schemas for the importer |

## 7. Documentation tree

| Path | Coverage |
|---|---|
| [docs/README.md](docs/README.md) | Topic-segmented index |
| [docs/platform/](docs/platform/) | Runtime, D1, R2, auth, env vars |
| [docs/database/](docs/database/) | D1 schema, migrations, phase status, punchlist |
| [docs/database/structure/](docs/database/structure/) | Per-table specs (16 files) |
| [docs/database/migration-details/](docs/database/migration-details/) | Phase-by-phase migration plans (5 files) |
| [docs/features/](docs/features/) | Per-feature docs (wiki, compendium-*, characters, campaigns, admin-users, image-manager, foundry-export) |
| [docs/ui/](docs/ui/) | Style guide, theming, BBCode, content rendering, components |
| [docs/architecture/](docs/architecture/) | Routing, RBAC, foundry-integration, reference-syntax |
| [docs/operations/](docs/operations/) | Local dev, deployment, troubleshooting |
| [docs/_archive/](docs/_archive/) | Pre-migration / superseded docs (kept for history) |

## 8. Schemas

| Path | Spec |
|---|---|
| [schemas/characters.md](schemas/characters.md) | Character entity |
| [schemas/classes.md](schemas/classes.md) | Class entity |
| [schemas/source.md](schemas/source.md) | Source entity |
| [schemas/tags.md](schemas/tags.md) | Tag system |
| [schemas/unique-options.md](schemas/unique-options.md) | Unique option groups + items |

## 9. Technical decision matrix

| Task | Procedure |
|---|---|
| **Add a route** | Update `Routes` in `src/App.tsx` and `NAV_ITEMS` in `src/components/Sidebar.tsx` |
| **Add a D1 query path** | Use helpers in `src/lib/d1.ts`; never call `firebase/firestore` directly. See [docs/platform/d1-architecture.md](docs/platform/d1-architecture.md) |
| **Add a D1 table** | Write migration in `worker/migrations/`; apply locally first; document in `docs/database/structure/`; update `D1_TABLE_MAP` in `src/lib/d1.ts` |
| **Add a Vercel function** | Add to `api/`; mirror in `server.ts` for local dev |
| **Add an R2 upload site** | Use `ImageUpload` in `src/components/ui/ImageUpload.tsx`; storage key under `images/`, `icons/`, or `tokens/` |
| **Style a new component** | Use named classes from [docs/ui/style-guide.md](docs/ui/style-guide.md) before reaching for inline Tailwind |
| **BBCode tag** | Update `src/lib/bbcode.ts` and `BBCodeRenderer.tsx`. See [docs/ui/bbcode.md](docs/ui/bbcode.md) |
| **RBAC change** | Update `users.role` enum (D1 schema) and the relevant `requireXAccess` helper in `api/_lib/firebase-admin.ts` |
| **Auth debugging** | See [docs/platform/auth-firebase.md](docs/platform/auth-firebase.md) |
| **Run scripts/migrate.js** | Local D1 only by default. See [docs/operations/local-dev.md](docs/operations/local-dev.md) |
| **Production deploy** | See [docs/operations/deployment.md](docs/operations/deployment.md) — DO NOT push to `main` until migration validated |

# AGENTS.md — Dauligor (the Archive)

Briefing for AI agents and new contributors. Read this once; then use the topic links below to dive deep on whatever you're working on.

## What this is

The Archive is a D&D 5e campaign-management web app:

- **Wiki** — hierarchical lore with DM-only secrets and category metadata.
- **Compendium** — classes, subclasses, features, spells, feats, items, and the scaling/option-group machinery that backs them.
- **Character builder & sheet** — class-progression-aware character creation with Foundry-VTT-compatible export.
- **Admin** — RBAC user management, campaign management, image library, system catalogs (skills, tools, weapons, armor, languages, damage types, conditions).
- **Foundry pairing module** — companion FoundryVTT module that consumes the app's exported JSON.

## Current stack (mid-migration — read this carefully)

| Layer | Technology |
|---|---|
| Frontend | React 19 · Vite · TypeScript · Tailwind 4 · shadcn/ui · TipTap |
| Database | **Cloudflare D1** (SQL) via the project Worker |
| Storage | **Cloudflare R2** (`https://images.dauligor.com`) via the same Worker |
| Auth | **Firebase Authentication** (kept; only used as the JWT layer) |
| Hosting | Vercel functions (`api/`); local dev uses an Express server (`server.ts`) that mirrors the same routes |

The app is **mid-transition from Firestore to D1**. Most read/write paths are migrated. Firebase **Authentication** is staying. Firestore and Firebase Storage are being decommissioned.

## Non-negotiable migration rules

1. **Never** add new code that calls `getDoc`, `getDocs`, `addDoc`, `setDoc`, `updateDoc`, `deleteDoc`, `onSnapshot`, or `collection(db, ...)` directly. Use the helpers in [src/lib/d1.ts](src/lib/d1.ts): `queryD1`, `batchQueryD1`, `fetchCollection`, `fetchDocument`, `upsertDocument`, `upsertDocumentBatch`, `deleteDocument`, `deleteDocuments`.
2. When migrating an **existing** call site, prefer `fetchCollection(name, fallback)` / `fetchDocument(name, id, fallback)` with the legacy Firestore call as the fallback. Once the D1 path is validated for that call site, replace the fallback with `null` to enter D1-only mode.
3. **Local D1 first.** Schema changes go through `wrangler d1 execute … --local` and `node scripts/migrate.js` before they ever touch `--remote`. Validate the app against local D1 before changing remote.
4. **Don't commit and push** until the migration is fully validated — Vercel auto-deploys from the main branch and would push an unfinished migration to production. The rollback reference is `E:\DnD\Professional\Dev\Pre-Update\Dauligor-main` (a snapshot of the working Firestore-era code).
5. **Zero functionality loss vs Pre-Update.** Every feature the Pre-Update reference supports must continue to work after migration.

## Where to look

| If you're working on… | Start here |
|---|---|
| **Anything runtime** (Vercel, Worker, Express, env vars) | [docs/platform/](docs/platform/) |
| **The database** (D1 schema, migrations, queries) | [docs/database/](docs/database/) |
| **A specific feature** (wiki, classes, spells, characters…) | [docs/features/](docs/features/) |
| **Adding a new editor / CRUD page** | [docs/architecture/compendium-editor-patterns.md](docs/architecture/compendium-editor-patterns.md) — pattern decision tree |
| **UI / styling / components** | [docs/ui/](docs/ui/) |
| **Architecture & RBAC** | [docs/architecture/](docs/architecture/) |
| **Local setup / deployment / debugging** | [docs/operations/](docs/operations/) |
| **Foundry VTT integration** | [docs/architecture/foundry-integration.md](docs/architecture/foundry-integration.md) and [module/dauligor-pairing/docs/](module/dauligor-pairing/docs/) |
| **File-path resolution** | [DIRECTORY_MAP.md](DIRECTORY_MAP.md) |
| **Schema specs** (interfaces, validation) | [schemas/](schemas/) |
| **What to do after the migration is done** | [docs/architecture/compendium-editor-patterns.md#post-migration-cleanup-roadmap](docs/architecture/compendium-editor-patterns.md#post-migration-cleanup-roadmap) — only relevant once [docs/database/firestore-cut-punchlist.md](docs/database/firestore-cut-punchlist.md) is empty |

## Durable rules (independent of the migration)

- **Authentication**: no anonymous or public registration. Users map to internal handles via `usernameToEmail` in [src/lib/firebase.ts](src/lib/firebase.ts). Hardcoded staff emails (`luapnaej101@gmail.com`, `admin@archive.internal`, `gm@archive.internal`) bootstrap administrative roles. Details: [docs/platform/auth-firebase.md](docs/platform/auth-firebase.md).
- **RBAC**: roles are `admin` · `co-dm` · `lore-writer` · `trusted-player` · `user`. Always pass the `effectiveProfile` object (which respects `previewMode`) into page components — never the raw `userProfile`. Details: [docs/architecture/permissions-rbac.md](docs/architecture/permissions-rbac.md).
- **Rich text**: BBCode is the storage format; TipTap is the visual editor; `BBCodeRenderer` is the display component. Never use `ReactMarkdown` for fields that contain BBCode. Details: [docs/ui/bbcode.md](docs/ui/bbcode.md).
- **Icons**: `lucide-react` only. No emojis in code or docs unless explicitly requested.
- **Styling**: use the named classes in [docs/ui/style-guide.md](docs/ui/style-guide.md) (`.field-input`, `.btn-gold`, `.compendium-card`, etc.) before reaching for inline Tailwind. Theme colors are CSS variables (`--ink`, `--gold`, `--background`, `--card`, `--blood`); never hardcode hex.
- **Error handling**: D1 helpers throw on failure. Wrap mutating calls in `try/catch` and surface the error via `toast.error(...)`. Don't silently swallow.

## Local development quickstart

You need **two terminals**:

```
# Terminal 1 — local Cloudflare Worker (D1 + R2)
cd worker && npx wrangler dev

# Terminal 2 — Vite + Express
npm run dev
```

The Express server reads `R2_WORKER_URL=http://localhost:8787` from `.env` and proxies `/api/d1/query` and `/api/r2/*` to the local Worker. Full setup, including `.dev.vars` and Firebase Admin credentials, is in [docs/operations/local-dev.md](docs/operations/local-dev.md).

## Documentation lookup protocol

1. Resolve files via [DIRECTORY_MAP.md](DIRECTORY_MAP.md).
2. For implementation logic, go to the relevant `docs/` subtree.
3. For data shapes, go to [schemas/](schemas/) and [docs/database/structure/](docs/database/structure/).
4. For migration status (which paths are still on Firestore), check [docs/database/README.md](docs/database/README.md).

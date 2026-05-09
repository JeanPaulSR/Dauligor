# AGENTS.md — Dauligor (the Archive)

Briefing for AI agents and new contributors. Read this once; then use the topic links below to dive deep on whatever you're working on.

## What this is

The Archive is a D&D 5e campaign-management web app:

- **Wiki** — hierarchical lore with DM-only secrets and category metadata.
- **Compendium** — classes, subclasses, features, spells, feats, items, and the scaling/option-group machinery that backs them.
- **Character builder & sheet** — class-progression-aware character creation with Foundry-VTT-compatible export.
- **Admin** — RBAC user management, campaign management, image library, system catalogs (skills, tools, weapons, armor, languages, damage types, conditions).
- **Foundry pairing module** — companion FoundryVTT module that consumes the app's exported JSON.

## Current stack

| Layer | Technology |
|---|---|
| Frontend | React 19 · Vite · TypeScript · Tailwind 4 · shadcn/ui · TipTap |
| Database | **Cloudflare D1** (SQL) via the project Worker |
| Storage | **Cloudflare R2** (`https://images.dauligor.com`) via the same Worker |
| Auth | **Firebase Authentication** (JWT layer only — Firestore is gone) |
| Hosting | Vercel (frontend + `api/` serverless functions); local dev uses an Express server (`server.ts`) that mirrors the same routes |

The Firestore→D1 migration is **complete**. Every read/write path on production data goes through Cloudflare D1; image storage is on R2; the app is live at `https://www.dauligor.com`. The companion Foundry module imports work end-to-end against the live API. See [docs/database/README.md](docs/database/README.md) for the database state, [docs/platform/runtime.md](docs/platform/runtime.md) for the request lifecycle.

## Non-negotiable rules

1. **Never** add `firebase/firestore` imports anywhere. The database is gone — `getDoc`, `getDocs`, `addDoc`, `setDoc`, `updateDoc`, `deleteDoc`, `onSnapshot`, `collection(db, ...)` are all forbidden. Use the helpers in [src/lib/d1.ts](src/lib/d1.ts): `queryD1`, `batchQueryD1`, `fetchCollection`, `fetchDocument`, `upsertDocument`, `upsertDocumentBatch`, `deleteDocument`, `deleteDocuments`. The single remaining `firebase` import (`firebase/auth`) is the JWT layer and is staying for now — see [docs/platform/auth-firebase.md](docs/platform/auth-firebase.md).
2. **Never use `INSERT OR REPLACE`.** Cloudflare D1 has `PRAGMA foreign_keys = ON` by default; `INSERT OR REPLACE` resolves a PK conflict by deleting the row and reinserting, which fires `ON DELETE CASCADE` on FK children. Documented data-loss incident during the migration. Always use `INSERT … ON CONFLICT(<pk>) DO UPDATE SET …` for single-PK upserts, or `INSERT OR IGNORE` for junction tables. Repo-wide grep should return zero hits in `src/`, `scripts/`, `worker/`, `api/`.
3. **No backwards compatibility.** When the schema changes, update sources to fit the new shape; do not preserve `row.snake_case ?? row.camelCase` dual-reads. The rollback reference is the Pre-Update snapshot (a frozen Firestore-era copy), not parallel paths inside the live code.
4. **`src/lib/d1.ts:queryD1` auto-parses JSON columns.** Inline remap blocks that read JSON columns (`tag_ids`, `proficiencies`, `spellcasting`, `advancements`, `properties`, etc.) must use `typeof X === 'string' ? JSON.parse(X) : (X ?? <default>)` so already-parsed values pass through. Forgetting the passthrough silently empties arrays/objects. The auto-parse list lives in [src/lib/d1.ts](src/lib/d1.ts).
5. **`api/_lib/_classExport.ts` is a drift-managed copy** of `src/lib/classExport.ts`. The Vercel serverless bundler in this project does not reliably bundle cross-folder imports from `api/` into `src/lib/` — two attempts crashed the function with `FUNCTION_INVOCATION_FAILED`. Any change to the bundle shape (denormalize\*, normalizeAdvancementForExport, exportClassSemantic body) must land in **both** files. The drift-warning header at the top of `_classExport.ts` says the same.

## Where to look

| If you're working on… | Start here |
|---|---|
| **Anything runtime** (Vercel, Worker, Express, env vars) | [docs/platform/](docs/platform/) |
| **The database** (D1 schema, migrations, queries) | [docs/database/](docs/database/) |
| **Per-table SQL schema** | [docs/database/structure/](docs/database/structure/) |
| **A specific feature** (wiki, classes, spells, characters…) | [docs/features/](docs/features/) |
| **Adding a new editor / CRUD page** | [docs/architecture/compendium-editor-patterns.md](docs/architecture/compendium-editor-patterns.md) — pattern decision tree |
| **UI / styling / components** | [docs/ui/](docs/ui/) |
| **Architecture & RBAC** | [docs/architecture/](docs/architecture/) |
| **Local setup / deployment / debugging** | [docs/operations/](docs/operations/) |
| **Foundry VTT integration** | [docs/architecture/foundry-integration.md](docs/architecture/foundry-integration.md) and [module/dauligor-pairing/docs/import-contract-index.md](module/dauligor-pairing/docs/import-contract-index.md) |
| **File-path resolution** | [DIRECTORY_MAP.md](DIRECTORY_MAP.md) |

## Durable rules

- **Authentication**: no anonymous or public registration. Users map to internal handles via `usernameToEmail` in [src/lib/firebase.ts](src/lib/firebase.ts). Hardcoded staff emails (`luapnaej101@gmail.com`, `admin@archive.internal`, `gm@archive.internal`) bootstrap administrative roles. Details: [docs/platform/auth-firebase.md](docs/platform/auth-firebase.md).
- **RBAC**: roles are `admin` · `co-dm` · `lore-writer` · `trusted-player` · `user`. Always pass the `effectiveProfile` object (which respects `previewMode`) into page components — never the raw `userProfile`. Details: [docs/architecture/permissions-rbac.md](docs/architecture/permissions-rbac.md).
- **`userProfile.id`, not `.uid`.** `userProfile` is the raw D1 `users` row, whose primary key is `id`. The Firebase `User` object has `.uid`, but in app code, read identity off `userProfile.id`. Same applies to `userProfile.display_name` (snake), `.active_campaign_id` (snake), `.accent_color` (snake) — the row is in D1 shape.
- **Rich text**: BBCode is the storage format; TipTap is the visual editor; `BBCodeRenderer` is the display component. Never use `ReactMarkdown` for fields that contain BBCode. Details: [docs/ui/bbcode.md](docs/ui/bbcode.md).
- **Icons**: `lucide-react` only. No emojis in code or docs unless explicitly requested.
- **Styling**: use the named classes in [docs/ui/style-guide.md](docs/ui/style-guide.md) (`.field-input`, `.btn-gold`, `.compendium-card`, etc.) before reaching for inline Tailwind. Theme colors are CSS variables (`--ink`, `--gold`, `--background`, `--card`, `--blood`); never hardcode hex.
- **Error handling**: D1 helpers throw on failure. Wrap mutating calls in `try/catch` and surface the error via `toast.error(...)`. Don't silently swallow.
- **Diagnostics**: use `reportClientError` in [src/lib/firebase.ts](src/lib/firebase.ts) (the legacy `handleFirestoreError` is gone; same enum lives on as `OperationType`).

## Local development quickstart

You need **two terminals**:

```
# Terminal 1 — local Cloudflare Worker (D1 + R2 simulator)
cd worker && npx wrangler dev

# Terminal 2 — Vite + Express
npm run dev
```

The Express server reads `R2_WORKER_URL=http://localhost:8787` from `.env` and proxies `/api/d1/query` and `/api/r2/*` to the local Worker. `worker/.dev.vars` provides `API_SECRET` to the worker process. Full setup, including Firebase Admin credentials and the per-class Foundry endpoint behavior, is in [docs/operations/local-dev.md](docs/operations/local-dev.md).

## Multi-agent coordination

Multiple agents work this repo in parallel via worktrees under
`.claude/worktrees/<branch-name>/`. The rules below keep merge
conflicts mechanical instead of semantic. Update this section whenever
branches start or finish.

### Active branches & file ownership

Each branch claims a primary domain. **If you're working on a file in
another branch's domain, stop and check first** — either rebase that
branch's work onto yours, or hand the change off via a small main-bound
commit, or ask the user to coordinate.

| Branch | Owns |
|---|---|
| `claude/pedantic-antonelli-ce1c7f` | Class importer + advancement system + option groups + class export pipeline (`module/dauligor-pairing/**`, `api/_lib/_classExport.ts`, `src/lib/classExport.ts`, `src/lib/advancementState.ts`, `src/components/compendium/AdvancementManager.tsx`, `src/pages/compendium/UniqueOptionGroup*.tsx`). Other branches may make small **additive, commented** edits to `AdvancementManager.tsx` and `advancementState.ts` to register new advancement types — keep them on the contributing branch through merge rather than relaying via main. |
| `claude/kind-maxwell-bfa076` | Spell list manager + spell rules + spellbook authoring (`src/pages/compendium/SpellList*.tsx`, `src/pages/compendium/SpellRules*.tsx`, `src/components/compendium/Spell*.tsx`, `src/lib/spell*.ts`, `src/hooks/useSpellFilters.ts`, `src/lib/classSpellLists.ts`, new `EntityPicker.tsx`) |

### Shared utility files (append-only discipline)

Both branches may add to these. Conflicts at merge are mechanical
(same kind of entry, different lines). Treat them like log files —
**never reorder, never collapse other branches' entries**.

- `src/lib/compendium.ts` — `normalizeCompendiumData` mapping table,
  `denormalizeCompendiumData` mapping table, forbidden list,
  `upsertX` helpers
- `src/lib/d1.ts` — `jsonFields` auto-parse list inside `queryD1`
- `src/lib/d1Tables.ts` — table-name registry
- `src/App.tsx` — route definitions
- `src/components/Sidebar.tsx` — nav links

### Migration filename convention

**New migrations use timestamps, not sequential numbers.** Two agents
running in parallel cannot collide on `0023_*.sql` vs `0023_*.sql` if
they're both `20260512-1430_*.sql` and `20260512-1545_*.sql`.

```
worker/migrations/YYYYMMDD-HHMM_descriptive_name.sql
```

Sortable, alphabetical = chronological, collision-free across branches.
Wrangler doesn't care about the leading number; it sorts the directory.

Existing `0001..0018` stay numbered (historical). The migrations after
0018 on `claude/pedantic-antonelli-ce1c7f` were renamed to timestamps
in commit `<future commit>`. Going forward, every new migration on any
branch uses `YYYYMMDD-HHMM_*.sql`.

### Pre-commit rebase

Before each commit, `git fetch origin main && git rebase origin/main`.
Cheap when the branch is small. The pattern that hurts: rebasing once
at the end after 20 commits land on main. The active branches in this
repo already share churn on `compendium.ts`, `d1.ts`, and the
advancement editor — fresh rebases keep the conflict surface tiny.

**Do not use `git stash pop` to integrate upstream changes on shared
files.** It silently resolves to the stashed version of conflicting
hunks, which can wipe other branches' additions to mapping tables /
JSON-parse lists / route registries without producing a conflict
marker. Use `git rebase` (or `git checkout stash@{0} -- <safe-paths>`
for surgical extraction). A "clean" stash-pop on shared utility files
is not equivalent to a proper merge.

### Migrations applied to remote D1

Some migrations get applied via `wrangler d1 execute --remote --file=…`
(bypassing the wrangler `migrations apply` tracking table) because that
table thinks every migration is unapplied — see [docs/database/](docs/database/).
**A migration file's presence in `worker/migrations/` is not proof
that it has run on remote.** Conversely, **a migration's absence from
your branch's working tree is not proof that it hasn't run on remote**
(another branch may have applied it). Always `wrangler d1 execute
--remote --command="PRAGMA table_info(<table>)"` when in doubt.

### When you find a conflict you can't resolve cleanly

Stop and tell the user. Don't paper over a semantic conflict with a
text-merge that compiles — schema changes, advancement-shape changes,
and Foundry-import flow changes can all silently break things if both
sides looked plausible in isolation.

## Documentation lookup protocol

1. Resolve files via [DIRECTORY_MAP.md](DIRECTORY_MAP.md).
2. For implementation logic, go to the relevant `docs/` subtree.
3. For data shapes, go to [docs/database/structure/](docs/database/structure/).
4. For Foundry module contracts, go to [module/dauligor-pairing/docs/import-contract-index.md](module/dauligor-pairing/docs/import-contract-index.md).
5. For the historical "what changed during the migration" record, see `docs/_archive/` — content there is for posterity only and should not be treated as current.

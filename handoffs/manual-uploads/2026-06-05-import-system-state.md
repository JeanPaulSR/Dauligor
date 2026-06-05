# Handoff — manual-uploads import system (pre-compaction snapshot)

**Date:** 2026-06-05 · **Branch:** `manual-uploads` · **Author:** Claude

A snapshot so a fresh context can continue the import work without re-deriving everything.

## TL;DR

Built the **manual-uploads import system** — an in-app "Mark & Build" window (`/compendium/import`) that creates compendium entities from structured fields, writing through the **editors' exact write helpers** so an imported entity is byte-identical to one saved from the hand editor. **Spells** are the proven proof-of-concept (created live, verified in D1). The PDF/text → fields parsing is out of scope: the agent (or a future extractor) supplies the fields; the window saves them faithfully.

## Branch state

- On `manual-uploads`, **6 commits ahead** of its rebase base; working tree clean, **NOT pushed** (local only). `origin/main` advanced ~2 commits during the session (other branches merging) → it's now ~2 behind, so **rebase onto `origin/main` again before any merge/cherry-pick to main** (`git fetch origin && git rebase origin/main`; the overlap check last time was zero, so expect it clean).
- Commits (newest first):
  - `docs(handoff): import system state snapshot (pre-compaction)` (this file)
  - `feat(import): persistent source picker + empty-source warning`
  - `chore(dev): branch dev stack launcher on port 3003`
  - `feat(import): manual-uploads import system (spells proof of concept)`
  - `docs(local-dev): D1 seed via schema-then-data; add refresh note`
  - `docs(auth): correct framing to native session tokens (Firebase = fallback)`
- The two `docs(...)` commits are cherry-pick candidates for `main` (they fix stale info everyone reads). **Never push to `main` without the user's explicit, in-conversation OK** — every push to main is a prod deploy. Show `git log origin/main..HEAD` first.

## Architecture

**`src/lib/import/`** — pure, front-end-agnostic core:
- `types.ts` — `ImportDescriptor`, `ImportFieldDef`, `ResolvedEntity`.
- `registry.ts` — `listImportDescriptors()`, `getImportDescriptor(type)`, **`resolveEntity(type, fields)`** (PURE — validates required fields, applies defaults, mints id + identifier, emits warnings incl. empty-source, returns the exact payload that will be written), **`commitEntity(resolved)`** (delegates to the descriptor's `commit()`; refuses if there are errors).
- `spell.ts` — the spell descriptor. `buildPayload` MIRRORS `SpellsEditor.handleSave` and `commit()` calls the REAL `upsertSpell`, so the row — including the materialized `activation/range/duration/shape` bucket columns — is identical to an editor save.
- `index.ts` — barrel.

**`src/pages/compendium/ImportMarkWindow.tsx`** — admin "Mark & Build" window. Route `/compendium/import` + sidebar "Import / Mark" (both append-only edits in `src/App.tsx` / `src/components/Sidebar.tsx`, admin-gated via `<AdminOnly>`). Flow: pick type → persistent **Source** picker (`SingleSelectSearch`) → fill grouped fields → live preview (resolved name/identifier/source/id + errors red / warnings amber) → Create. Manual entry only; **span-marking of pasted text is the next phase.**

## Fidelity contract (CRITICAL when extending to new types)

Each descriptor's `commit()` MUST call the editor's real write function with the verbatim payload — **never reimplement the D1 write layer.** Verified per-type save paths live in the design doc's table (`docs/_drafts/manual-uploads-import-system-2026-06-04.html`). Summary:
- **spell** → `upsertSpell(id, payload)` (src/lib/compendium.ts) — runs `normalizeCompendiumData` + spell-bucket materialization.
- **feat** → `upsertFeat`, **item** → `upsertItem`, **feature** → `upsertFeature` (+ `queueRebake('feature', id)`).
- **class** → `upsertDocument('classes', id, d1Data)` + `queueRebake('class', id)`; **subclass** similar (+ `class_id`, `class_identifier`).
- **unique_option_group/item, species, subspecies, species_options, background, background_features, facility, source, system pages, spell_rules** → direct `upsertDocument(collection, id, payload)` (or `saveRule`/`saveSystemPage*`) with the verbatim editor payload.
- Universal idioms: `id` is a SEPARATE positional arg = `existingId ?? crypto.randomUUID()`; `identifier = identifier.trim() || slugify(name)`; `tag` column is `tag_ids` for class/subclass, `tags` everywhere else (helpers do `tagIds→tags`); legacy tables are snake_case, `backgrounds`/`species`/`species_options`/`background_features` are camelCase.

## Verified this session

- Spell create end-to-end via the window: **Verification Bolt** (no source) and **Black Hole** (source ATLAS, lvl 8 trs, 60ft, concentration) → confirmed D1 rows with correct columns + materialized bucket columns.
- Source picker + empty-source warning: empty → warns (amber + blood "No source" badge) but **Create stays enabled** (warnings warn, only errors block); set source → clears. Black Hole landed with `source_slug = atlas`.
- `tsc --noEmit` clean for the new files; full app smoke-test against the seeded DB had no D1/code errors.

## Dev / test setup (how to resume)

- **Local D1 is seeded from remote** (84 tables, ~4.3k rows, byte-equal to prod, FK-clean). Method = schema-then-data (`docs/operations/local-dev.md`).
- **Dev stack on :3003** — `node scripts/dev-manual-uploads.mjs` (app 3003, worker 8790, inspector 9232; app runs **no-watch**). Or via the preview harness: `preview_start("manual-uploads")` (`.claude/launch.json` has the entry) → returns a `serverId` for the `preview_*` tools. **serverId changes each start** — use `preview_list` to get the current one.
- **`.env` + `worker/.dev.vars`** were copied from the parent repo (gitignored). I added **`AUTH_JWT_SECRET`** to `.env` (a local-only dev value) so native login works.
- **Logging in for browser tests** (the seeded users are prod rows with unknown passwords): mint a native session token and inject it: `localStorage.setItem('dauligor:authToken', <jwt>)` then reload. The JWT must match `api/_lib/sessionToken.ts`: HS256, issuer `dauligor`, audience `dauligor-app`, `sub` = admin user id `n65elKlUnDhN8lGAiI1MfETUsHO2`, claims `{username:'admin', email:'admin@archive.internal', role:'admin'}`, signed with the `AUTH_JWT_SECRET` value in `.env`. (The throwaway mint script was deleted — recreate a `scripts/_mint-*.mjs` with `jose` `SignJWT` if needed.) The client only decodes the JWT (no client-side sig check); the proxy verifies the signature.

## Gotchas

- **Source-less entries are hidden from the public browsers** (they filter by source). A spell with `source_id = NULL` won't appear — now surfaced by the window's warning. (This is what hid "Verification Bolt.")
- **Worktree dev server must be no-watch** — `tsx watch` restart-loops on the junctioned `node_modules/.vite-temp` churn. Never `npm install` in a worktree.
- **D1 seed is schema-then-data** (combined dump FK-fails) and **non-idempotent** (wipe `worker/.wrangler/state/v3/d1` to refresh; stop the worker first — it holds the file). See local-dev.md.
- `PRAGMA integrity_check` is blocked on local D1 (miniflare `SQLITE_AUTH`); use `foreign_key_check`. A single big `UNION` count hits D1's compound-SELECT cap — chunk it or use named subqueries.
- `/api/characters/[id]` is Pages-only → returns the SPA HTML in Express dev (not a bug, just dev routing).
- Vite HMR WebSocket `24678` "already in use" is a cosmetic clash with sibling stacks; the app still serves.

## Next work (open)

1. **Extend descriptors** using the fidelity table: feat / item / feature (helper path — easy), then class/subclass (direct `upsertDocument` + `queueRebake`), then options / species / background / facility / source.
2. **Span-marking UI** — highlight pasted source text → mark a span as a field / new entity (the original "mark a section" idea). Today the window is manual fields only.
3. **Promote** the design draft into `docs/features/` once the feature broadens.
4. (Done this session: spells PoC + window; persistent source picker + warn-on-empty-source.)

## Pointers

- Design spec (with the full per-type save-path table): `docs/_drafts/manual-uploads-import-system-2026-06-04.html`.
- Branch manifest: `handoffs/manual-uploads/manifest.md`; registry row in `handoffs/BRANCH_REGISTRY.md`.
- Relevant memory: `project_d1_local_seed_method`, `project_worktree_node_modules_junction`, `feedback_main_is_production_deploy`, `project_firebase_auth_exit_plan`.

# Handoff — Block-based Lore Articles + System Pages (2026-06-06)

Compaction handoff for the "block designer" line of work. Resume from here.

## TL;DR
A generic block-layout engine (extracted from the campaign homepage builder) now powers **lore
articles** (shipped to production) and **system pages** (built locally, not yet shipped).

- **Branch / worktree:** `settings-pages` at `E:\DnD\Professional\Dev\Dauligor\.claude\worktrees\kind-wright-2cb7a2`.
- **`main` = production** (Cloudflare Pages auto-deploys every push). `origin/main` is at **`c238c3a`**.
- **Local state:** `settings-pages` = `f7fdec1` (System Pages Stage 2, committed) — **1 commit ahead of
  origin/main, NOT pushed** — PLUS a large set of **UNCOMMITTED** working-tree changes (System Pages
  Stage 3 + the reference/definition reframe + doc updates).

## What is SHIPPED to main (`c238c3a`)
The lore article block designer, fully live:
- **Generic engine:** `src/lib/layoutBlocks.ts` (block model: parse/serialize, `makeBlock`,
  `BLOCK_TYPE_META`, `LAYOUT_BLOCK_TYPES`, generic `fetch/saveLayoutBlocks(url)`),
  `src/components/layout/LayoutBlocks.tsx` (renderer; threads `viewContext`), `LayoutEditor.tsx`
  (3-pane builder; supports `fullscreen`, `embedded`, `controlled`, `renderInspectorExtras`).
- **Campaign homepage** repointed at the engine via thin adapters (behavior-preserving).
- **Lore designer:** `src/pages/wiki/LoreArticleDesigner.tsx` (fullscreen; settings side-panel folds the
  old LoreEditor tabs; canvas = embedded controlled LayoutEditor). Routed at `/wiki/new` + `/wiki/edit/:id`;
  classic editor kept at `/wiki/new-classic` + `/wiki/edit-classic/:id`.
- **Lore viewer** (`LoreArticle.tsx`) renders blocks; `lore_article_blocks` table + `GET/PUT
  /api/lore/articles/:id/blocks` (replace-all, content-mirror, packet inclusion). Migration
  `20260604-1300` applied LOCAL + REMOTE (11/11 prod articles seeded losslessly).
- **Block types:** hero, text, **note** (staff-only; server-stripped for non-staff), **secret**
  (self-contained, per-campaign reveal; server-filtered), **reference** (embed an entity inline/card/link),
  image, divider, callout, entity-row, entity-feature, group, columns, column.
- **Slug URLs:** `/wiki/article/<slug>` resolves (server `resolveArticle(idOrSlug)` in
  `functions/api/lore/[[path]].ts`); saves always use the real UUID.
- Reference-system docs: `docs/architecture/cross-references.md` (`&`/`@` — canonical, accurate).

## What is COMMITTED locally but NOT pushed — `f7fdec1` (System Pages Stage 2)
Page **body** as a block layout (entries glossary still separate at this commit):
- Migration `worker/migrations/20260605-1200_system_page_blocks.sql` — `system_page_blocks` table
  (mirror of the lore/campaign block tables). **APPLIED to LOCAL D1 only. REMOTE NOT applied.**
- `systemPages.ts`: `fetchSystemPageBlocks` / `saveSystemPageBlocks` (via the generic d1 proxy) +
  description mirror; `SystemPageDesigner.tsx` (fullscreen body designer); reader renders the body blocks.

## What is UNCOMMITTED in the working tree — System Pages Stage 3 (full unification) + reframe + docs
**This is the active, unfinished work.** Decision: **system pages are canonical homes; entries ARE blocks.**
- **`definition` block** = the addressable ENTRY (config `{anchor, name, body}`); its `anchor` is the
  `&kind[anchor]` / `#anchor` target. **`reference` block** = a pure pointer (embeds an entity defined
  elsewhere) — explicitly **NOT** an entry, and **excluded from system pages**. (`reference.anchor` that was
  briefly added has been reverted; reference matches its shipped form.)
- **Model** (`layoutBlocks.ts`): `DefinitionBlock` added (Hash icon); `collectAnchoredBlocks(blocks)` returns
  definition blocks with an anchor (depth-first) — used by the reader rail + the resolver.
- **Designer usable:** `definition` in `SYSTEM_BLOCK_TYPES` (reference excluded); `LayoutEditor` has a
  definition inspector case (name/anchor/body) + Hash icon. `SystemPageDesigner` `load` =
  `assembleSystemPageEditorBlocks(id, description)` which **lazy-migrates**: description→text block +
  existing `system_page_entries`→`definition` blocks (resolved name/body) when the page has none. Save
  persists as blocks; the entries table is LEFT INTACT (fallback).
- **Resolver** (`systemPages.ts`): `resolveSystemEntry` reads definition blocks first (by anchor), falls
  back to `system_page_entries`. `searchSystemEntries` merges definition blocks (across pages) + entries
  rows (deduped, blocks win). So imported Foundry `&Reference[...]` keeps resolving through the transition.
- **Reader** (`SystemPageGlossary.tsx`): when definition blocks exist, renders the whole block layout +
  Contents rail/scroll-spy from `collectAnchoredBlocks` (anchors via the renderer's `#anchor`); otherwise
  the legacy entries glossary.
- **Editor** (`SystemPageEditor.tsx`): entries master-detail **RETIRED** — now a settings-only form
  (name/identifier/icon) + "Design Page Content" → the designer. `description` is round-tripped (the designer
  owns it as the body's text mirror).
- **Docs:** `docs/architecture/cross-references.md` got a "Pointers vs. targets" section;
  `docs/_drafts/system-pages-block-system-2026-06-04.html` has a decisions banner.
- **Approach = lazy + fallback** (chosen to avoid a risky bulk migration of the `&`-ref backbone). No new
  data migration; pages convert to blocks when edited; entries table kept as a safety net (not dropped).
  Entity-backed entries become definition snapshots on lazy-migrate (page = canonical home).
- **Verified:** tsc clean except 3 pre-existing main errors (CompendiumBrowserShell/SpellList `asChild`,
  characterShared:520 — not ours); all touched modules Vite-transform 200; local DB test confirms both
  resolver queries resolve `&conditions[prone]` to a definition block.

## Reference grammar (ground truth: `src/lib/bbcode.ts` `resolveRefRoute`)
- `@kind[id]` = ENTITY ref → the entity's own page (`/compendium/...`, `/wiki/article/...`).
- `&kind[id]` = RULE ref → a SYSTEM PAGE: `/system/<kind>#<anchor||id>` (`&kind[]` = page-level). The page
  identifier IS the kind; the entry id is the `#anchor`. `&`/`@` are LINKS ONLY — the target (system-page
  entry / entity) must already exist. Full doc: `docs/architecture/cross-references.md`.

## NEXT STEPS (in order)
1. **Test System Pages Stage 3 locally** (dev stack below). Open `/compendium/system-pages/edit/<id>` →
   "Design Page Content"; existing entries appear as Definition blocks; add/edit; Save; view
   `/system/<identifier>` (rail + `#anchor` deep-links); confirm an inline `&conditions[prone]` resolves.
2. **Commit Stage 3** on `settings-pages` (one logical commit) once happy. (Commit only when the user asks.)
3. **Before any push:** the code reads `system_page_blocks`, so the table MUST exist on REMOTE D1 first.
   Apply ONE file (gated — get explicit go-ahead):
   `npx wrangler d1 execute dauligor-db --remote --file worker/migrations/20260605-1200_system_page_blocks.sql --config worker/wrangler.toml -y`
   (NEVER `wrangler d1 migrations apply --remote` — it replays everything and corrupts prod.)
4. **Then** rebase onto origin/main → `npx vite build` (the deploy gate; tsc not run by the build) →
   show `git log origin/main..HEAD` → `git push origin HEAD:main`. Always ask before pushing (main = prod).

## Dev stack (no-watch — `tsx watch` restart-loops in this junctioned worktree)
- Worker: `cd worker && npx wrangler dev --port 8788 --inspector-port 9230` (LOCAL D1).
- App: `PORT=3001 R2_WORKER_URL=http://localhost:8788 npx tsx server.ts`.
- App :3001, worker :8788. Frontend reflects edits on browser reload; **server-side function changes need a
  restart** (bounce the app). Designers are staff/admin-gated (no dev-auth bypass — real `/api/me`), so
  verify via tsc + Vite-transform curls + local-D1 queries when you can't log in.
- Local D1 query: `POST http://localhost:8788/query` with `Authorization: Bearer <API_SECRET from worker/.dev.vars>`,
  body `{ "sql": "...", "params": [...] }` (single statement) or a JSON array of `{sql,params}` (batch).
- Local D1 is a separate seeded subset — edits never touch production.

## Pointers
- Durable state + full phase history: memory `project_lore_article_designer.md` (⭐ in `MEMORY.md`).
- Production/push rules: memory `feedback_main_is_production_deploy.md`.
- Remote-D1 apply rule: memory `project_d1_remote_migration_apply.md`.
- Worktree node_modules junction (never `npm install` here): `project_worktree_node_modules_junction.md`.

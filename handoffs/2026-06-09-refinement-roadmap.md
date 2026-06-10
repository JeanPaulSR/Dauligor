# Refinement Roadmap — Articles · Maps · Calendar · Campaign Page

**Canonical TODO for the next phase of work. Handoffs should point here.**
Branch: `settings-pages`. Created 2026-06-09, after the block-designer / system-pages /
image-authoring line shipped.

The next phase is *refinement* (not greenfield) of four player-facing world surfaces.
Order: **Articles first**, then Maps, Calendar, Campaign Page. Each section below is the
working TODO for that surface; fill in decisions as we make them.

---

## 1. Articles  ← STARTING HERE

The article system is the most mature (it's where the block engine was built). This pass
is polish + closing half-migrated paths, not a rebuild.

### Structure (as-built — see code map below)
- **Storage:** `lore_articles` (base + image fields + `dm_notes` + `content` mirror) +
  `lore_article_blocks` (the real body, one row per root block; containers nest children in
  `config.children`). Metadata in `lore_meta_*`; visibility via `lore_article_eras` /
  `_campaigns`; `lore_links` mention graph; `lore_secrets` (legacy, being replaced by secret blocks).
- **API:** `functions/api/lore/[[path]].ts` — `GET/PUT/DELETE /articles[/:id]`,
  `/:id/blocks`, `/:id/secrets`; `resolveArticle` (id-or-slug); server-side `dm_notes` strip +
  per-campaign secret filter (`filterBlocksForViewer`); `deriveContentMirror` refreshes
  `content` on block save.
- **Block engine (shared):** `src/lib/layoutBlocks.ts` (model + 15 block types),
  `src/components/layout/LayoutBlocks.tsx` (renderer, threads `viewContext`),
  `LayoutEditor.tsx` (3-pane builder). Article transport: `src/lib/loreArticleBlocks.ts`.
- **Editor:** `src/pages/wiki/LoreArticleDesigner.tsx` (settings side-panel — Details /
  Visibility / Imagery via `ImageSetEditor` / Tags+Template — + embedded `LayoutEditor`;
  `CATEGORIES` (30) + `TemplateFields` metadata; save = `upsertLoreArticle` +
  `saveLoreArticleBlocks`).
- **Reader:** `src/pages/wiki/LoreArticle.tsx` (renders blocks, legacy-content fallback,
  hover-preview popover, DM banner, era/campaign staff preview, metadata cards, mentions).
- **Browser:** `src/pages/wiki/Wiki.tsx` (grid/list, category filter, search).
- **References:** `@article[slug]` → `/wiki/article/:slug`; `&kind[anchor]` → system pages.
  `src/lib/bbcode.ts` (`resolveRefRoute`, `bbcodeToHtml`), `src/lib/references.ts`
  (`KIND_CONFIG`, search/resolve).
- **Docs:** `docs/features/wiki-lore.md` (updated 2026-06-09), `docs/database/structure/lore_articles.md`,
  `docs/architecture/cross-references.md`, `docs/ui/bbcode.md`, `docs/ui/content-rendering.md`.

### Candidate refinements (from the 2026-06-09 investigation — triage with the user)
- [ ] **Finish the block migration.** Legacy fallbacks still exist (content→text block,
  `dm_notes`→note block, `lore_secrets`→secret blocks) that only convert on re-save. Consider a
  one-time backfill so every article is block-native and the dual read paths collapse.
- [ ] **Orphaned `lore_secrets`.** After secret-block migration the old rows linger with no
  cleanup. Decide: backfill + drop, or keep as archive.
- [ ] **Single source for block-type allow-lists.** `ARTICLE_BLOCK_TYPES` (client) and
  `ALLOWED_ARTICLE_BLOCK_TYPES` (server) are hand-synced; export one list from `layoutBlocks.ts`.
- [ ] **`deriveContentMirror` duplicated** client + server — extract to one shared module.
- [ ] **Missing block types** authors may want: tables, insets/sidebars, tabbed/choice
  sections (legacy content had recursive table/inset; no block equivalent yet).
- [ ] **Slug ambiguity.** `slug` isn't unique across categories; `resolveArticle` picks first
  match. Consider `UNIQUE(category, slug)` or category-scoped URLs.
- [ ] **Image cleanup.** New-article uploads land under `images/lore/new`; orphaned if save
  fails / id differs. Move to id path post-save or sweep.
- [ ] **Parent picker has no cycle guard** (an article can be its own ancestor).
- [ ] **Metadata round-trip.** `loadMetadata` is a second call after the article fetch; could
  fold into the article packet.

---

## 2. Maps  (not yet investigated)
Entry points (from prior knowledge): `src/pages/core/Map.tsx`; tables `maps`, `map_markers`,
`map_highlights` (`worker/migrations/0017_map_markers.sql`); markers link to `lore_articles`.
Docs: `docs/features/wiki-lore.md` (Map section). **TODO: full investigation when we reach it.**

## 3. Calendar  (not yet investigated)
Entry points: sidebar "Calendars" / "Timelines" / "History". **TODO: locate the components,
tables, and any docs; investigate when we reach it.**

## 4. Campaign Page  (not yet investigated)
Entry points: `src/components/campaign/CampaignHomeEditor.tsx` (block-based homepage builder,
already on the shared engine), `src/pages/campaign/CampaignManager.tsx`, `CampaignEditor.tsx`;
tables `campaigns`, `campaign_members`. Memory: the v1 homepage builder was "rebuilt as 3-pane
Outline+Preview" — confirm current state. **TODO: investigate when we reach it.**

---

## Working rules (carry-over)
- `main` = production (Cloudflare Pages auto-deploys); ask before pushing; rebase onto
  `origin/main` first. tsc baseline = 3 pre-existing errors. No `wrangler d1 migrations apply
  --remote` — single-file `d1 execute` per migration, applied to BOTH local and remote.
- Block engine is shared across articles / campaign homepage / system pages — changes ripple;
  verify all three when touching `layoutBlocks.ts` / `LayoutBlocks` / `LayoutEditor`.

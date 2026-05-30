# Handoff — Campaign Homepage Layout Builder (2026-05-30)

Pickup context for branch `system-applications`. Builds on (does not replace):
- [2026-05-29-system-pages.md](2026-05-29-system-pages.md) — system pages + `&`/`@` cross-references (the entity-resolution backbone this feature reuses).

> Memory cross-ref: `~/.claude/.../memory/project_campaign_home_builder.md` (chosen direction + theme/component reqs), `feedback_limit_icons.md`, `feedback_general_info_as_html.md`, `feedback_survey_first.md`.

## TL;DR

Built a **per-campaign homepage layout builder**: a GM customizes what their players see at `/` (the Home page). When a campaign has a saved layout it renders; otherwise the **default layout** renders — and crucially the default is now produced by the SAME block system, so the editor preview, the no-blocks home, and a freshly-saved default are one code path (preview == saved by construction).

The editor is a **fullscreen 3-pane Outline + Preview builder** (Structure tree · live Preview · Inspector) at its own route, with **nested containers**, **generalized entity rows** (any reference kind — articles/classes/items/system pages…), **placeholder refs**, draggable pane resizers, and a faithful default that reproduces the legacy home's flourishes.

**All work is on `origin/main`** (HEAD `a2ca53f` == origin/main, in sync). Branch `system-applications`.

## State: SHIPPED to main, NOT yet driven end-to-end logged-in

- `tsc --noEmit`: **6 pre-existing errors, 0 introduced** by any of this work. (The 6 are the long-standing Base-UI `asChild` type errors in CompendiumBrowserShell / SpellList / LoreEditor×3 + a characterShared arg-count — all in OTHER branches' files; see "Known issues" below.)
- Every module compiles through Vite (200, not 500).
- **NOT verified:** the live logged-in flow (drag/nest/pick/save/resize, the default-save round-trip, image upload). The editor is staff-auth-gated and the local preview session is logged out; auth is a prohibited action I can't perform. The user needs to log in to confirm the interaction end-to-end. Everything is verified-by-compile + class-matching against the legacy JSX, not by click-through.

## Commits (all on origin/main, newest first)

| SHA | Subject |
|-----|---------|
| `a2ca53f` | fix(home): default layout survives save — enrich blocks + unify render path |
| `fe41b4c` | fix(campaign): Homepage tab navigates straight to the fullscreen editor |
| `2ee76ee` | feat(home): fullscreen campaign homepage editor route + resizable panes |
| `110a1e4` | fix(campaign): nested-button popover trigger + add Restore Default to home editor |
| `aaa71a9` | feat(home): campaign-specific homepage layout builder + home fixes |
| `47ba08f` | fix(home): clamp entity-row count/columns consistently |

(Earlier v1 + faithful-default + placeholder commits are ancestors, rebased in.)

## Architecture / where the code lives

- **`src/lib/campaignHome.ts`** — the model. `HomeBlock` union + per-type interfaces; `defaultHomeBlocks()`; `makeBlock()`; `parseHomeBlock()` / `serializeHomeBlock()` (recursive — container children live in `config.children`); clamp helpers; `EntityRef` + placeholder helpers (`PLACEHOLDER_KIND`, `isPlaceholderRef`, `makePlaceholderRef`); `ENTITY_PICKER_KINDS`; `fetchCampaignHomeBlocks` / `saveCampaignHomeBlocks`.
- **`src/components/campaign/CampaignHomeBlocks.tsx`** — the RENDERER (player-facing + editor preview). Resolves every `EntityRef` once via `resolveReference` (references.ts), renders each block type. Placeholder/unresolved refs → graceful "coming soon" card (never vanish).
- **`src/components/campaign/CampaignHomeEditor.tsx`** — the 3-pane editor. `fullscreen` + `onBack` props; BlockTree (drag-reorder + drag-to-nest), Inspector (per-type config), EntityRefPicker (kind dropdown + debounced search + drag-reorder chips + "Add as placeholder"), AddBlockPicker, draggable ResizeHandle (widths persisted to `localStorage` key `dauligor:campaignHomeEditor:panes:v1`). Boxed in-tab mode kept as fallback when `fullscreen` is off.
- **`src/pages/campaign/CampaignHomeEditorPage.tsx`** — fullscreen route host. Staff-gated, fetches campaign name, renders editor with `fullscreen` + Back→`/campaign/edit/:id`.
- **`src/pages/core/Home.tsx`** — REWRITTEN. Now renders ENTIRELY through `CampaignHomeBlocks` (saved blocks, else `defaultHomeBlocks()`; drops the `recommended` block when no active campaign). The ~100-line hardcoded JSX + `renderArticlePreview`/`specialArticles` are gone.
- **`src/pages/campaign/CampaignEditor.tsx`** — "Homepage" tab navigates straight to the route (no in-tab content). Also the popover nested-button fix here (line ~389: `PopoverTrigger render={<Button/>}`, NOT `asChild`).
- **`src/App.tsx`** — route `/campaign/edit/:id/homepage`.
- **DB**: `worker/migrations/20260529-1700_campaign_home_blocks.sql` — one row per ROOT block (`id, campaign_id, block_type, "order", config`); nesting lives inside `config.children`. **LOCAL applied; REMOTE PENDING** (no per-migration go-ahead given — needs explicit permission, then `cd worker && npx wrangler d1 execute dauligor-db --remote --yes --file=migrations/20260529-1700_campaign_home_blocks.sql`).
- **API**: per-route `GET`/`PUT /api/campaigns/:id/home-blocks` on `functions/api/campaigns/[[path]].ts` (read = member-or-staff; write = isCharacterDM; replace-all via DELETE+INSERT, NOT INSERT OR REPLACE).

## Block types

`hero` · `text` (BBCode) · `image` · `divider` · `recommended` (auto = campaign's `recommended_lore_id`, or specific) · `callout` (styled CTA box: heading + body + optional button — the "Character Creation · Work in Progress" panel) · `entity-row` (row/grid of cards; `source` manual|auto, `card` image|compact|list, `columns` 1–4, `excerpt`, `featureFirst` = first card spans 2 cols) · `entity-feature` (one large highlighted entity) · `group` (titled container) · `columns` (2–4 cell container). Containers hold children; the tree nests.

## Non-obvious decisions

- **Unified render path** is the fix for "default loses its niceness on save": both the no-blocks home AND saved blocks go through `CampaignHomeBlocks`, so they can't diverge. Don't reintroduce a separate hardcoded default.
- **`featureFirst` + `callout`** were added specifically so `defaultHomeBlocks()` reproduces the legacy home exactly (asymmetric World-of-Dauligor grid + the CTA box). The default seeds the 5 World articles by SLUG (`world-primer`, `world-history`, `rules`, `divinity`, `magic`); any missing on a given world render as graceful placeholders.
- **Placeholder refs** (`kind: 'placeholder'`, name-only) let a GM name a card without a real article — per user "no fake files." Renderer shows placeholder card for both intentional placeholders AND unresolved real refs.
- **Icons minimized** (per `feedback_limit_icons`): block-type glyphs only in the structure tree; tree rows show the component TYPE, not the authored title.
- **Theme**: Cormorant Garamond serif + Inter/Geist sans, `--radius:0` (square corners), parchment `#f5f5f0`/gold `#c5a059`/blood `#8b0000`. Real classes: `browser-panel/-sidebar/-row`, `data-table-*`, `config-fieldset`+`section-label`, `field-label/-input/-hint`, `btn-gold/-solid/-danger`, `empty-state`. The fullscreen shell uses the documented `admin-page-fullscreen` recipe (canonical ref: `TagsExplorer.tsx`, docs/ui/components.md).
- Native HTML5 drag-and-drop throughout (no dnd library) — matches ImageManager pattern.

## Open items / next steps

1. **Image upload 500 ("No initial boundary string", r2.ts:70)** — NOT a code bug. The fix (`3e45389`, preserve binary multipart bodies in `api/_lib/pages-adapter.ts` + `r2-proxy.ts`) is already in the code. The user hit it because the **dev server was running stale code** — `server.ts`/adapter changes need a process RESTART (Vite HMR only reloads client code). I restarted the stack this session; **user must retry upload to confirm.** If it still 500s after a clean restart, it's a real regression in the adapter — dig there.
2. **Remote migration** `20260529-1700_campaign_home_blocks.sql` — LOCAL only; needs explicit per-migration go-ahead before the feature works on the live site.
3. **Logged-in end-to-end verification** — the whole feature is unverified by click-through (auth-gated). Walk the GM through: open editor → drag/nest blocks → pick entities → save → reload → confirm render → save default → confirm it stays pretty.
4. **Backgrounds as a ref kind** — `ENTITY_PICKER_KINDS` offers Feats as a stand-in; backgrounds live in the feats table (`feat_type='background'`), not a top-level ref kind. Real fix: add backgrounds to `KIND_CONFIG` in `src/lib/references.ts` (system-applications owns that file).
5. **entity-row `auto` (by category)** — model/inspector support it but the renderer treats auto as manual-of-whatever-refs-exist; the actual category fetch is a TODO (manual mode covers the "specific entities" ask).
6. Pre-existing from earlier this session: Foundry inline-roll chips (#7, on roadmap), system-pages remote migration (DONE this session), live-content bridge (deferred branch goal).

## Known issues NOT mine (flag, don't cross-edit)

The 6 standing `tsc` errors are all the Base-UI `asChild`-on-`<Button>` pattern (Radix API; Base UI uses `render`). I fixed the one in CampaignEditor (the campaign "Add Player" popover, was causing a real nested-`<button>` hydration error). The other 5 live in files owned by other branches — **CompendiumBrowserShell.tsx:399** + **SpellList.tsx:779** (compendium-editors) and **LoreEditor.tsx:596/855/912** (wiki). CompendiumBrowserShell wraps a real `<Button>` so it throws the same console error on the Spells browser — worth the owning branch applying the identical `render={<Button/>}` fix. Per shared-files protocol I did not edit them.

## Dev / verification

- Branch dev stack: `node scripts/dev-sysapp.mjs` from repo root → app :3001, worker :8788, inspector :9230. **server.ts / adapter / worker changes need a full restart** (HMR won't pick them up).
- If the worker (:8788) dies but the app (:3001) stays up, every D1/R2 proxy call 500s with `ECONNREFUSED` (this is what the foundation-update 500 was earlier — a dead worker, fixed by restart). Check both ports: app should be 200, worker 401.
- `tsc --noEmit` then check errors aren't in `campaignHome|CampaignHome|core/Home|App.tsx`.

## Other work shipped this session (context, all on main)

- System-pages migration applied to **remote** D1 (verified).
- `docs/architecture/cross-references.md` (new canonical doc for `@`/`&`), roadmap drift fixed (system pages → Shipped), Foundry inline-roll roadmap entry added.
- Maps: fixed highlight tooltips + broken `/wiki?id=` links + picsum placeholder; added `docs/features/maps.md`.
- Home quick fixes: GM wording, "Work in Progress" CTA, responsive loading skeleton.

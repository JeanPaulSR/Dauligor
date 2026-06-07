# foundry-module — session handoff (pre-compaction, 2026-06-06)

Pickup doc for the `foundry-module` branch, mid **page-system build (roadmap #1)**.
Read this + the files in §"Read these first". Prior pickup:
[2026-06-05-session-state-precompaction.md](2026-06-05-session-state-precompaction.md).

## TL;DR — where we are

Building the **in-Foundry page system** (load app articles / system-pages /
campaign content, rendered natively, with clickable cross-refs). **Phase 1 (the
engine) is done + committed; Phase 2 (the viewer window) is next.** Auth/login
(roadmap #4) shipped + works. The immediate open question is whether to keep the
**native block renderer** (recommended) vs an iframe / server-HTML alternative —
see §"DECIDE FIRST".

## Git state (at handoff)

- Branch `foundry-module`: **3 commits ahead of `origin/main` AND
  `origin/foundry-module`** (both at `6622db6`). Clean working tree.
- The 3 **unpushed** commits (owner said "hold" — module-only, safe to push when
  ready):
  - `5868b71` page-system **Phase 1** (content-service.js + layout-blocks.js)
  - `af71b62` page-system **design doc** (the plan)
  - `edbfa49` auth **chat-card nudge + per-user sessions**
- `origin/main` = `6622db6` (CORS for /api/auth+lore+campaigns — landed by
  `dauligor-applications`).
- **`main` = production** (Cloudflare Pages auto-deploys). ALWAYS `git fetch` +
  show `git log origin/main..HEAD` + ASK before pushing. Module-only pushes are
  safe (no `src/`/`functions/` → identical web-app build). Push to main with
  `git push origin foundry-module:main` (fast-forward), then sync
  `origin/foundry-module` + local `main`.

## DECIDE FIRST (open question, owner asked, not yet answered)

"Can we reuse the website's layouts/rendering instead of building from scratch?"
Assessment (I recommended **keep the native renderer**):

- The app's block renderer `src/components/layout/LayoutBlocks.tsx` is **React**
  (JSX + react-router + Tailwind + live `resolveReference` DB lookups) — cannot
  run in Foundry's non-React window. It's a **spec, not a dependency**.
- We're NOT reinventing the heavy part: BBCode→HTML is the module's
  `normalizeHtmlBlock` (a port of the site's `bbcode.ts`). Only the thin
  block→HTML map (~100 lines, 15 stable types) is module-specific.
- **iframe the live page**: technically possible (site sets no X-Frame-Options /
  frame-ancestors), but the iframe session is separate from the module token
  (needs an app-side auth bridge), shows full site chrome (no embed mode), and
  isn't native. → more work + worse UX.
- **App server-renders blocks→HTML** (handoff): no server block-renderer exists
  (`_bbcode.ts` is BBCode-only) → app would build one + an endpoint. → moves work
  app-side, doesn't remove it.
- **Recommendation: keep the native renderer** (Phase 1, done). If drift bites
  later, ask the app to extract a framework-agnostic `blocks→HTML` fn shared by
  app + a server endpoint + a module port. **Confirm this with the owner before
  Phase 2.**

## The page system — plan + progress

Design doc (READ IT): `module/dauligor-pairing/docs/_drafts/page-system-design-2026-06-06.html`.

**Owner decisions locked:** Option **A** for system pages (read via
`POST /api/d1/query`, no app endpoint); **link-out** for `@spell/class/feat/item`
refs in v1; **viewer-only** enrichers in v1 (no Foundry-wide enrichers yet);
**articles first**.

**Phase 1 — DONE (`5868b71`), verified headless, NOT loaded in Foundry yet**
(imported by the viewer in Phase 2, so no runtime change until then):
- `scripts/content-service.js` — authed (`authFetch` Bearer) readers:
  `listArticles`, `getArticle(idOrSlug)`, `getArticleBlocks`, `listCampaigns`,
  `getCampaign`, `getCampaignHomeBlocks`; `resolveSystemEntry` stubbed (Phase 4).
  Friendly errors for not-logged-in / expired / network.
- `scripts/layout-blocks.js` — `renderBlocks(blocks)` → HTML for all 15 block
  types (mirrors the app's `parseLayoutBlock`: parse `config`, switch
  `block_type`, recurse `config.children`); `renderRichText(bbcode)` =
  `normalizeHtmlBlock` + cross-ref enrich; `collectAnchors(blocks)` for a
  Contents rail. Ref route map mirrors `resolveRefRoute`; dangling badge for
  kinds with no page. Refs emit `<a class="dauligor-ref" data-ref-kind/-id/-sigil
  data-route="https://www.dauligor.com/...">` for the viewer's click handler.

**Phase 2 — NEXT (the first testable UI):** `scripts/dauligor-viewer.js`
(ApplicationV2 + `templates/dauligor-viewer.hbs` + `styles/dauligor-viewer.css`) —
fetch an article via content-service, render its `article.blocks` with
`renderBlocks`, a Contents rail from `collectAnchors`, back/history nav, and a
click handler for `.dauligor-ref` (kind `article` → load in-viewer; else open
`data-route` in browser). A launcher "Dauligor Library" entry opens it. Reuse the
`dauligor-importer-app` window theme. ⚠️ These viewer files are **reserved for
`system-applications`, jointly owned with `foundry-module`** (registry) — owner
said "I build module," so build them, but `scripts/main.js` is append-only shared
— coordinate.

**Phase 3:** article browser (list + `section-filter` search + open); in-viewer
`@article` ref navigation.
**Phase 4:** campaign home (`getCampaignHomeBlocks`) + system-page `&` refs —
wire `resolveSystemEntry` via `/api/d1/query` (Option A; see §contracts).
**Phase 5 (optional):** Foundry-wide `CONFIG.TextEditor.enrichers` (refs clickable
in journals/sheets) — push enrichers, do NOT override `enrichHTML`.

## Auth (roadmap #4 — DONE, working)

- Native auth (NOT Firebase): `POST /api/auth/login {username,password}` →
  `{token, profile}`; `POST /api/auth/refresh` (Bearer) → `{token}` (30-day
  sliding). `requireAuthenticatedUser` accepts the Bearer token on /api/me,
  /api/lore, /api/campaigns, /api/d1/query.
- `scripts/auth-service.js`: `login/logout/getSession/getProfile/isLoggedIn/
  getDisplayName/authFetch` (+ `resolveApiHost`). `authFetch(path, opts)` attaches
  Bearer, refreshes once on 401, clears session if refresh fails. **Session =
  client-scoped JSON map keyed by `game.user.id`** (per-user, never shared,
  unsynced). Setting `SETTINGS.session` registered client-scoped in main.js.
- Login UI: launcher "Log in to Dauligor" / "Account: <name>" → account dialog
  (login form / status+logout); a **whispered chat card** on `ready` when logged
  out (`postLoginChatCard` + `hasLoginPromptCard` dedup + `registerLoginChatPrompt`
  binding via v13 `renderChatMessageHTML`). CSS `.dauligor-login-card` in base.css.
- **CORS is live on prod** for /api/auth + /api/lore + /api/campaigns (`6622db6`,
  reply: `2026-06-06-reply-cors-for-module-login.md`). Verified via curl
  (OPTIONS→204, ACAO:*). Login confirmed working by the owner in Foundry.

## Key contracts (for Phase 2+; full detail in the design doc)

- `GET /api/lore/articles` → `{articles:[...]}` (published-only + dm_notes
  stripped for non-staff). `GET /api/lore/articles/<idOrSlug>` →
  `{article:{...fields, metadata, tags, visibilityEraIds, visibilityCampaignIds,
  blocks:[raw rows]}, parent, mentions}`. `blocks` rows = `{id, article_id,
  block_type, "order", config}` where `config` is a **JSON string**.
  `GET /api/lore/articles/<id>/blocks` → `{blocks:[...]}`.
- `GET /api/campaigns` → `{campaigns:[...]}` (member-filtered);
  `GET /api/campaigns/<id>` → `{campaign}`; `/<id>/home-blocks` → `{blocks:[...]}`.
- **Block model** = `src/lib/layoutBlocks.ts`. 15 types: hero, text, note, secret,
  image, divider, recommended, callout, reference, definition, entity-row,
  entity-feature, group, columns, column. Containers (group/columns/column) nest
  via `config.children`. `EntityRef = {kind, id, name?, title?, description?}`.
  `collectAnchoredBlocks` → `definition` anchors. **note/secret are
  server-stripped by role/active_campaign_id** (defensive client gate optional).
- **Refs** are RAW in body BBCode: `@kind[id]#anchor{display}` (entity, →
  `/wiki/article/<id>`, `/compendium/...`) and `&kind[id]{display}` (rule, →
  `/system/<kind>#<anchor>`). Route map = `src/lib/bbcode.ts` `resolveRefRoute`;
  grammar doc = `docs/architecture/cross-references.md`. The module's enricher
  must process them (server leaves them raw).
- **System pages: NO REST endpoint.** Option A (chosen): `POST /api/d1/query`
  reads `system_pages` + `system_page_blocks` (both player-readable — NOT in the
  proxy's PROTECTED_READ_TABLES). Mirror `resolveSystemEntry` /
  `getSystemPageKindMap` in `src/lib/systemPages.ts`.

## Reuse map (don't reinvent)

- BBCode→HTML (incl. embedded `[table]` in HTML): `normalizeHtmlBlock` +
  `applyBbcodeTags` — `scripts/class-import-service.js`.
- Ref display-name: `formatFoundryLabel` — `scripts/importer-base-features.js`.
- Block render + ref enrich + anchors: `scripts/layout-blocks.js` (Phase 1).
- Authed fetch: `authFetch` — `scripts/auth-service.js`. Content reads:
  `scripts/content-service.js`.
- Browsing filter UI: `scripts/section-filter-panel.js`.
- Window theme: ApplicationV2 + `dauligor-importer-app` classes (dark panel +
  `--dauligor-*` tokens, `styles/importer-wizard.css` + `tokens.css`).
- DialogV2 pattern: see `openCampaignSourcesDialog` / `openDauligorAccountDialog`
  in `scripts/main.js`.

## Cross-branch / open

- ✅ CORS handoff DONE (dauligor-applications, `6622db6`).
- ⏳ Species data gap: remote `species` table EMPTY on prod (0/48 sources);
  bg/feats UNtagged (filter axes sparse). App-side seed needed. Handoff:
  `2026-06-05-to-compendium-editors-species-table-empty-on-prod.md`.
- Viewer files reserved for `system-applications` (jointly owned) — coordinate.
- `scripts/main.js` is append-only shared with `system-applications`.

## "After" bucket (roadmap order: #1 page system → #2 → #3; #4 done)

- Roadmap **#2**: import wizard dedicated **Species + Background** sections
  (importer-app.js IMPORT_TYPES/SOURCE_TYPES; public /api/module catalogs; no
  auth) — fully in lane, unblocked. (task #9)
- Roadmap **#3**: UI cleanup for real-world use + **multiplayer** verification
  (roll pool has a GM socketlib relay; verify non-GM flows). (task #10)
- Foundry **eyeball** of the whole Character Creator + the new login — nothing
  ran live this session except the owner's quick login test. (task #1)
- **Image wheel section** still a stub (`_bodySectionStub`). (task #3)

## Gotchas

- New script imported by main.js (or its chain) needs **no module.json change** →
  F5 reload. Changing `module.json` styles/esmodules → **full Foundry restart**.
- Can't run Foundry here; verify renderers headless (node replica / msedge) — the
  owner does the live eyeball. Auth-gated endpoints can't be curled without a
  token, so test renderers on synthetic blocks.
- v13: chat hook is `renderChatMessageHTML` (HTMLElement, jQuery gone); new
  windows = ApplicationV2 + HandlebarsApplicationMixin; reserved `data-action`
  values exist (`"tab"` → use `cc-tab`).
- D1 remote: NEVER `wrangler d1 migrations apply --remote`. Foundry junction →
  this worktree (edit source, reload).

## Read these first (next session)

1. **This handoff** + [manifest.md](manifest.md).
2. **The design doc** — `module/dauligor-pairing/docs/_drafts/page-system-design-2026-06-06.html` (the plan).
3. **Phase 1 code** — `module/dauligor-pairing/scripts/layout-blocks.js` + `content-service.js`.
4. **Auth client** — `module/dauligor-pairing/scripts/auth-service.js` (the page system reads through it).
5. CORS reply — [2026-06-06-reply-cors-for-module-login.md](2026-06-06-reply-cors-for-module-login.md).
6. Agent memory `project_foundry_module_branch` + `AGENTS.md` (root) for workflow/ownership.
7. Contract sources for Phase 2+ — `src/lib/layoutBlocks.ts`, `src/components/layout/LayoutBlocks.tsx` (React renderer = block-markup spec), `functions/api/lore/[[path]].ts`, `functions/api/campaigns/[[path]].ts`, `src/lib/systemPages.ts`, `src/lib/bbcode.ts` (`resolveRefRoute`), `docs/architecture/cross-references.md`.
8. `module/dauligor-pairing/docs/where-to-look-guide.md` §6 (description rendering).

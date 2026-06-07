# Page System (in-Foundry content viewer)

The page system loads the Dauligor app's authored content — lore articles, system
pages (rules glossaries), and campaign home pages — and renders it **natively
inside Foundry**, with clickable cross-references. It is read-only: authoring
stays on the website; Foundry is a reader.

**Related docs**
- [`cross-reference-enrichers.md`](cross-reference-enrichers.md) — how `@`/`&` refs render + navigate (in the viewer and Foundry-wide).
- [`native-auth.md`](native-auth.md) — the per-user account session every content read authenticates with.
- [`ui-entry-points-and-visibility.md`](ui-entry-points-and-visibility.md) — how users open the Library and who can see it.
- [`reference-syntax-guide.md`](reference-syntax-guide.md) — a *different* ref grammar (import-time `@class`/`@scale` → Foundry paths/UUIDs), not the display refs here.

## What it renders

| Content | Source endpoint | Viewer mode |
|---|---|---|
| Lore articles | `GET /api/lore/articles`, `GET /api/lore/articles/<idOrSlug>` | `list` (browser) → `article` |
| System pages (Conditions, Skills, …) | `POST /api/d1/query` (`system_pages` + `system_page_blocks`) | `system` |
| Campaign home pages | `GET /api/campaigns`, `GET /api/campaigns/<id>/home-blocks` | `campaigns` (list) → `campaign` |

All three are stored as the app's **layout-block** model and render through one
engine, so they look and behave consistently.

## Components

| File | Role |
|---|---|
| `scripts/layout-blocks.js` | The renderer: block JSON → HTML for all 15 block types; BBCode → HTML; anchor collection; the shared ref-anchor builder. |
| `scripts/content-service.js` | Authenticated readers (`listArticles`, `getArticle`, `getArticleBlocks`, `listCampaigns`, `getCampaign`, `getCampaignHomeBlocks`, `getSystemPage`). Returns parsed JSON; maps failures to friendly errors. |
| `scripts/dauligor-viewer.js` | `DauligorViewerApp` (ApplicationV2) — the "Dauligor Library" window. Owns navigation, the browser, and rendering of each mode. |
| `scripts/ref-enricher.js` | Foundry-wide `CONFIG.TextEditor` enrichers + the delegated click router (see the cross-reference doc). |
| `styles/dauligor-viewer.css` | Viewer chrome + every `.dauligor-block--*` / `.dauligor-richtext` / `.dauligor-ref` rule the renderer emits. |
| `styles/base.css` | Global `.dauligor-ref` style for refs enriched *outside* the viewer (journals/sheets). |

## Data flow

```
launcher tile / ref click
  → DauligorViewerApp.open({ ...target })
    → content-service reader (authFetch → app endpoint, Bearer token)
      → server filters by the account's role + active campaign
    → layout-blocks.renderBlocks(blocks) → HTML
    → injected into the viewer's body; refs wired for navigation
```

The viewer never mutates app data and never assumes a role — the **server**
decides what the logged-in account may read, and the viewer renders whatever it
receives.

## The block model

Content is an ordered list of root block rows: `{ id, block_type, "order",
config }`, where `config` is a **JSON string**. Container blocks
(`group` / `columns` / `column`) nest their children inside `config.children`.
The canonical model is the app's `src/lib/layoutBlocks.ts`; the module mirrors
its parse + the block→markup mapping.

`renderBlocks(rows)` parses each row (JSON-parsing the `config` string), switches
on `block_type`, and recurses container children. The 15 types:

`hero`, `text`, `note`, `secret`, `image`, `divider`, `recommended`, `callout`,
`reference`, `definition`, `entity-row`, `entity-feature`, `group`, `columns`,
`column`. Unknown types are dropped (matching the app's `parseLayoutBlock`).

Body prose inside blocks is **BBCode**, converted to HTML by
`normalizeHtmlBlock` (from `class-import-service.js` — the single BBCode/markdown/
HTML transform, including BBCode tables embedded in HTML), then passed through the
cross-reference enricher so `@`/`&` refs become clickable. `renderRichText(bbcode)`
is the combined helper.

`collectAnchors(blocks)` returns the `definition` blocks that carry an `anchor`
(depth-first) — the entries shown in the viewer's Contents rail and the targets of
`&kind[anchor]` refs.

## The viewer (`DauligorViewerApp`)

A singleton ApplicationV2 window themed like the importer (`dauligor-importer-app`
classes + `--dauligor-*` tokens). It holds a `_current` view and a `_history`
back-stack, and renders one of these modes:

- **`list`** — the article browser: a live title/excerpt search plus a
  section-filter panel with synthetic **Category / Folder / Status** axes (an axis
  appears only when the pool has more than one value, so Status surfaces only for
  staff who can see drafts). Each row opens the article.
- **`article`** — rendered blocks + a Contents rail (definition anchors) + the
  toolbar (back / Library / refresh). Falls back to rendering `article.content`
  (the BBCode mirror) when an article has no blocks yet.
- **`system`** — a system page rendered the same way; reached by clicking a `&`
  rule ref. Scrolls to the cited entry's `#anchor`.
- **`campaigns`** — the list of campaigns the account is a member of.
- **`campaign`** — a campaign's home-page blocks.

`open({ articleId | campaignId | systemKind, systemAnchor | view:"campaigns" })`
opens (or focuses) the window at a specific target. A monotonic `_seq` guard
prevents a slow fetch from painting over a newer view after the user navigates
away. Logged-out / network-error / empty states render a friendly message with a
log-in or retry action.

## content-service readers

Every reader calls `authFetch` (see [`native-auth.md`](native-auth.md)), so each
request carries the logged-in account's Bearer token and the server returns
role-appropriate content.

| Function | Endpoint | Returns |
|---|---|---|
| `listArticles(opts)` | `GET /api/lore/articles` | `[{ id, title, slug, category, folder, excerpt, status, … }]` |
| `getArticle(idOrSlug)` | `GET /api/lore/articles/<idOrSlug>` | `{ article: { …, blocks }, parent, mentions }` |
| `getArticleBlocks(id)` | `GET /api/lore/articles/<id>/blocks` | `[block rows]` |
| `listCampaigns()` | `GET /api/campaigns` | `[{ id, name, description, memberCount, … }]` (membership-filtered) |
| `getCampaign(id)` | `GET /api/campaigns/<id>` | `{ campaign }` |
| `getCampaignHomeBlocks(id)` | `GET /api/campaigns/<id>/home-blocks` | `[block rows]` |
| `getSystemPage(kind)` | `POST /api/d1/query` | `{ page, blocks }` or `null` |

`block_type` / `config` rows from every endpoint share the same shape, so
`renderBlocks` handles all of them.

### System pages — Option A (generic D1 proxy)

System pages have **no dedicated REST endpoint**. They are read through the
generic query proxy `POST /api/d1/query` because `system_pages` and
`system_page_blocks` are **player-readable** — neither is in the proxy's
`PROTECTED_READ_TABLES`, so a plain `SELECT` passes the gate with just the Bearer
token.

`getSystemPage(kind)` resolves a `&`-ref kind to its page, mirroring the app's
`src/lib/systemPages.ts`:
1. `SELECT … FROM system_pages` → match `identifier === kind`, else a name-slug
   alias (so `&condition[…]` resolves a page named "Conditions" whose identifier
   is `conditions`).
2. `SELECT … FROM system_page_blocks WHERE page_id = ?` → the page's block layout.

The viewer then renders those blocks and scrolls to the entry's `definition`
anchor. A `&` kind with no authored page falls back to an "Open in app" CTA.

## Visibility (server-enforced)

The viewer is a pure consumer; privacy is enforced **server-side**, so privileged
content never crosses the wire to an account that shouldn't get it:
- Non-staff readers get only `status = 'published'` articles; a draft requested by
  id/slug returns 404.
- `note` blocks (Storyteller Notes) are stripped for non-staff.
- `secret` blocks are sent only to staff or to a player whose active campaign is
  in the secret's `revealedCampaignIds`.
- `dm_notes` are stripped for non-staff.

When a `note` or `secret` block *does* render (i.e. the viewer is entitled to it),
the renderer labels it ("Storyteller Note · staff only" / "Secret") and the
browser badges unpublished rows with their status — staff-facing cues that the
content isn't player-visible.

## Reasoned decisions

- **Native renderer, not iframe or app-rendered HTML.** The app's React
  `LayoutBlocks.tsx` cannot run in Foundry's non-React window; it is treated as a
  *spec*, not a dependency. The heavy part (BBCode→HTML) is already the module's
  `normalizeHtmlBlock`; only the thin block→HTML map (~15 stable types) is
  module-specific. An iframe would need an app-side auth bridge and shows full
  site chrome; an app-rendered-HTML endpoint does not exist (the app renderer is
  React). The native renderer is the least-coupled option and reuses existing code.
- **Option A for system pages** (generic D1 proxy, no new endpoint) was chosen
  because the two tables are already player-readable; it avoided an app-side
  endpoint at the cost of mirroring the resolver logic in `getSystemPage`.

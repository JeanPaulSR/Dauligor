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
| `scripts/layout-blocks.js` | The renderer: block JSON → HTML for all 15 block types; BBCode → HTML; anchor collection; the shared ref-anchor builder; entity-reference **card** rendering + `collectEntityRefs`. |
| `scripts/content-service.js` | Authenticated readers (`listArticles`, `getArticle`, `getArticleBlocks`, `listCampaigns`, `getCampaign`, `getCampaignHomeBlocks`, `getSystemPage`) **and `resolveReferences` / `clearReferenceCache`** (entity-reference card resolution). Returns parsed JSON; maps failures to friendly errors. |
| `scripts/dauligor-viewer.js` | `DauligorViewerApp` (ApplicationV2) — the "Dauligor Library" window. Owns navigation, the browser, and rendering of each mode. |
| `scripts/ref-enricher.js` | Foundry-wide `CONFIG.TextEditor` enrichers + the delegated click router (see the cross-reference doc). |
| `scripts/ref-hovercard.js` | Foundry-wide reference **hover preview cards** — our `.dauligor-ref` links (app data) + Foundry `@UUID` content-links (the linked document). See the cross-reference doc. |
| `scripts/ref-import.js` | **On-demand import** for compendium-backed refs (`@spell`, …): click opens the Foundry item in a temporary sheet; drag imports it onto a sheet. See the cross-reference doc. |
| `scripts/class-detail-view.js` | The shared **ClassView** (header + progression table + Features/Subclass/Spell-List/Info/Flavor tabs + Core-Traits sidebar) — `renderClassView` / `bindClassView` + fetch helpers. Used by the character creator's Class tab, the standalone class-detail window, and reusable by the import/subclass wizards. |
| `scripts/class-detail-app.js` | The standalone **class-detail window** opened by a clicked `@class[…]` ref — mounts `class-detail-view` (not the full creator). |
| `styles/dauligor-viewer.css` | Viewer chrome + every `.dauligor-block--*` / `.dauligor-richtext` / `.dauligor-ref` rule the renderer emits. |
| `styles/base.css` | Global `.dauligor-ref` style for refs enriched *outside* the viewer (journals/sheets). |

## Data flow

```
launcher tile / ref click
  → DauligorViewerApp.open({ ...target })
    → content-service reader (authFetch → app endpoint, Bearer token)
      → server filters by the account's role + active campaign
    → resolveReferences(collectEntityRefs(blocks)) → entity-card display data
    → layout-blocks.renderBlocks(blocks, { resolved }) → HTML
    → injected into the viewer's body; refs + cards wired for navigation
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

`renderBlocks(rows, { resolved, recommended })` parses each row (JSON-parsing the
`config` string), switches on `block_type`, and recurses container children. The
optional `resolved` map (and `recommended` payload) drive the entity-reference
cards — see [Entity-reference resolution](#entity-reference-resolution-cards)
below; with no opts, those blocks degrade to "reference not yet made" cards. The
15 types:

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
| `resolveReferences(refs)` | `POST /api/d1/query` (one per kind) | `Map(kind:id → { name, summary, image, sourceLabel, rule })` — see [Entity-reference resolution](#entity-reference-resolution-cards) |

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

## Entity-reference resolution (cards)

Four block types embed a pointer to another entity rather than prose:
`reference`, `entity-feature`, `entity-row`, and `recommended`. Each stores an
`EntityRef { kind, id }` where `id` is the **semantic identifier/slug** (an
article's slug; a spell/class/feat/item/condition identifier; a system-page entry
anchor) — never a DB primary key. The viewer resolves these to rich cards
(image + title + summary + source) before rendering, mirroring the app's
`src/lib/references.ts` + `LayoutBlocks.tsx`.

**Flow.** Before `renderBlocks`, the viewer calls
`resolveReferences(collectEntityRefs(blocks))`. The resolver:
1. Dedupes refs by `kind:id` and memoizes them in a module cache (cleared by the
   toolbar's Refresh via `clearReferenceCache`, so site edits show up).
2. For each kind, checks the system-page kind map **first** — so a `&` rule kind
   (`condition`, `skill`, …) resolves as a system-page entry (definition block,
   then a legacy `system_page_entries` fallback). Otherwise it reads the static
   table by identifier: `spells` / `classes` / `subclasses` / `feats` / `items` /
   `status_conditions` / `lore_articles`. `class`/`subclass` also carry an image
   (`card_image_url`→`image_url`) and source abbreviation; the rest are text-only —
   matching the app.
3. Returns a `Map` keyed `kind:id` → `{ name, summary, image, sourceLabel, rule }`.
   `rule` tells the renderer whether the card's link is a `&` system route (opens
   in-viewer) or an `@` entity route.

Every table the resolver reads is **player-readable** through the D1 proxy (none
are in `PROTECTED_READ_TABLES`), so the same Bearer token used for every other
read suffices — no public endpoint, no auth split.

**Per-card display.** `reference` honors `display` (inline / card / link); `card`
and `inline` render the summary as **rich BBCode** (the title is a separate link,
so a summary's own refs never nest inside a card anchor). `entity-row` honors
`card` (image / compact / list), `columns`, per-card `span`, and `excerpt`;
`entity-feature` honors `imageSide`; `recommended` shows an "Essential Reading"
card. Author overrides win: a ref's stored `title` / `description` take precedence
over the resolved name / summary.

**Unresolved vs. placeholder.** A real ref whose target doesn't exist yet renders
a distinct **"Reference not yet made"** card showing the intended title plus the
`kind:id` — so an author sees *what* is missing and *where* it belongs, and can go
create it. This is kept visually separate from an intentional `placeholder`-kind
ref (a deliberate "Coming Soon" slot). Unknown kinds and id-less refs are skipped.

**Auto modes.** A `recommended` block in `auto` mode is fed by the viewer
resolving the campaign's `recommended_lore_id` (via `getArticle`) into
`opts.recommended`. `entity-row` in `auto` mode (latest-N-of-a-category) is not
fetched in Foundry yet — it shows a short note — matching the app, which also
defers it.

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

# foundry-module — handoff: reference-card resolution (page system)

Pickup doc for the next task on the `foundry-module` branch. The in-Foundry page
system (Phases 1–5) is shipped and live; this is a follow-up enhancement.

## TL;DR

The four **entity-reference blocks** (`reference`, `entity-feature`,
`entity-row`, `recommended`) currently render as **clickable links + any cached
name/description** — not the website's rich cards. Build **reference-card
resolution**: fetch each referenced entity's display data (name, image, summary)
and render real image+title+summary cards, mirroring the app's
`resolveReference`. Also fix the `recommended` `auto`-mode gap (resolve the
campaign's `recommended_lore_id`).

## Read first

The page system is now fully documented — start there:

1. [`module/dauligor-pairing/docs/page-system.md`](../../module/dauligor-pairing/docs/page-system.md) — the viewer, block renderer, content-service readers, visibility.
2. [`module/dauligor-pairing/docs/cross-reference-enrichers.md`](../../module/dauligor-pairing/docs/cross-reference-enrichers.md) — the ref grammar + `refMarkup` + route map (cards reuse this for the click target).
3. [`module/dauligor-pairing/docs/native-auth.md`](../../module/dauligor-pairing/docs/native-auth.md) — `authFetch` (lore/campaign reads need it; `/api/module/*` is public).
4. [`module/dauligor-pairing/docs/import-contract-index.md`](../../module/dauligor-pairing/docs/import-contract-index.md) — doc map (the new docs are under "In-Foundry runtime systems").

App-side sources to mirror (read these for the resolution logic):
- `src/lib/references.ts` — **`resolveReference(kind, id)`**: the kind → table/route map and how the app fetches name/image/summary. Mirror its kind handling.
- `src/components/layout/LayoutBlocks.tsx` — how the React renderer turns a resolved ref into a card (the markup/fields to reproduce).
- `src/lib/layoutBlocks.ts` — the `EntityRef` shape + each block's config fields.
- `functions/api/module/[[path]].ts` — the public module API dispatcher; **confirm which `/api/module/<kind>/<id>.json` detail endpoints exist and their fields** before coding (see "Verify" below).

## Current state (what renders today)

`module/dauligor-pairing/scripts/layout-blocks.js`:
- `entityRefLink(ref)` → a clickable `.dauligor-ref` (or a dangling span for a
  placeholder / id-less ref). Label = `ref.name || ref.title`.
- `renderEntityRef(ref, variant)` → a card-panel `<div>` containing the link +
  `ref.description` (only if the block author cached one). No image, no fetch.
- `renderEntityRow(c)` → a grid of `<li class="dauligor-block__entity-card">`,
  each just the link.
- `recommended` → `entityRefLink(c.ref)`; `source: "auto"` has no ref → renders
  nothing.

So: functional + styled as cards, but **no entity resolution** (no image, no
live name/summary; `reference` display modes inline/card/link are not
distinguished; `entity-row` `card` modes image/compact/list not distinguished).

`styles/dauligor-viewer.css` already has card panels
(`.dauligor-block--reference`, `--entity-feature`, `--recommended`,
`__entity-card`, `__entity-grid`, `__row-title`) — they need image + summary
layout added.

## Plan

### 1. Resolver in `content-service.js`

Add `resolveReferences(refs)` → returns a `Map` keyed by `"<kind>:<id>"` of
`{ name, image, summary }` (route comes from `refMarkup`/`refRoute`, no need to
re-derive). Batch + cache (a module-level `Map` cache keyed `kind:id`). Per-kind
routing (mirror `src/lib/references.ts`):

| kind | source | fields |
|---|---|---|
| `article` | `getArticle(id)` (authFetch — lore) | `title` → name, `excerpt` → summary, `card_image_url`/`image_url` → image |
| `spell` | `GET /api/module/spells/<id>.json` (public) | name, img, summarized description |
| `feat` | `GET /api/module/feats/<id>.json` (public) | name, img, summary |
| `item` | `/api/module/items/<id>.json` — **verify path/kind** | name, img, summary |
| `class` | class detail — **verify path** (`functions/api/module/[[path]].ts`) | name, img, summary |
| `condition` / system kinds | `getSystemPage(kind)` → entry whose anchor === id | entry name + body→summary |
| `subclass`, `option-group`, unknown | none — fall back to the current link/dangling | — |

Note the auth split: `article` reads go through `authFetch` (lore is auth-gated);
compendium entities use the **public** `/api/module/*` (no auth, already
CORS-open). Don't authFetch the public ones.

### 2. Render: pre-resolve, then pass a map into `renderBlocks`

`renderBlocks` is **synchronous**; resolution is **async** — so resolve first,
then render:
1. Add `collectEntityRefs(blocks)` to `layout-blocks.js` (walk reference /
   entity-feature / entity-row.refs / recommended, depth-first incl. container
   children).
2. In the viewer's article/system/campaign render paths
   (`dauligor-viewer.js`): collect refs → `await resolveReferences(refs)` →
   `renderBlocks(blocks, { resolved })`.
3. Extend `renderBlocks(blocks, opts)` + the entity-card renderers to read
   `opts.resolved.get("<kind>:<id>")` and build an image+name+summary card; fall
   back to the current link when a ref is unresolved (subclass/unknown/miss).
4. Honor the block display options where cheap: `reference.display`
   (inline/card/link), `entity-feature.imageSide`, `entity-row.card`
   (image/compact/list) + `excerpt`.

(Alternative: render placeholder cards synchronously with `data-ref-*` and
hydrate them async after fetch. Pre-resolve is cleaner — prefer it unless the
batch is large enough to want progressive paint.)

### 3. `recommended` auto-mode

The campaign view has the `campaign` object. When a `recommended` block has
`source: "auto"`, resolve `campaign.recommended_lore_id` as an `article` ref and
render its card. Thread the campaign (or the resolved recommended ref) into the
campaign render path.

### 4. `entity-row` auto-source (decide)

`entity-row` with `source: "auto"` shows the latest N articles of a category.
There may be no module endpoint for "latest N of a category" — either add one
app-side (handoff) or fetch the article list (`listArticles({category})`) and
take N. Decide + note; OK to defer (render the manual refs only) in v1.

## Files to touch

- `scripts/content-service.js` — `resolveReferences` + per-kind fetch + cache.
- `scripts/layout-blocks.js` — `collectEntityRefs`; `renderBlocks(blocks, opts)`;
  card markup in the four entity-reference cases.
- `scripts/dauligor-viewer.js` — collect + resolve before render; pass `resolved`
  (+ campaign recommended) into `renderBlocks`.
- `styles/dauligor-viewer.css` — image + summary card layout.
- Update `docs/page-system.md` (replace the "renders as links" notes with the
  resolved-card behavior) once shipped.

## Verify before coding

- Exact `/api/module` detail endpoints + response kinds/fields for spell / feat /
  item / class (read `functions/api/module/[[path]].ts`). Confirmed already:
  `/api/module/spells/<id>.json` (`dauligor.spell-item.v1`),
  `/api/module/feats/<id>.json` (`dauligor.feat-item.v1`),
  `/api/module/backgrounds/<id>.json`, `/api/module/races/<id>.json`. Items +
  classes need confirming.
- `EntityRef` cached fields vs resolved fields (prefer the block's stored
  `title`/`name`/`description` override, then the resolved values — the app does
  override-wins).

## Gotchas

- N refs → batch + cache; don't refetch the same `kind:id`. `getArticle` is
  authFetch (lore); compendium detail is public — don't mix.
- Headless verification: `renderBlocks` is testable in node with the foundry
  stub (see the existing `_render_check`-style harness pattern in the session
  history); the resolver can be tested by mocking `fetch`/`authFetch`. The owner
  does the live Foundry eyeball.
- Unresolved kinds must keep the current link/dangling fallback (don't regress
  `@subclass` etc.).
- Foundry v13 + the renderer is sync — keep `renderBlocks` sync; do all async
  work in the viewer before calling it.

## Git state (at handoff)

- Branch `foundry-module`: `origin/main` == `f1cd2a5` plus unpushed commits
  `a7b4e95` (docs) and this handoff. The page system + importer + auth + UI work
  is already on `main`.
- **main = production**: always `git fetch` + show `git log origin/main..HEAD` +
  ASK before pushing. Module/docs-only pushes don't change the web build.
- Compaction note: these commits live in the worktree, so they survive
  compaction; the next session reads this handoff + the docs from disk.

# Cross-Reference Enrichers (display refs)

How the Dauligor display references — `@kind[id]{label}` (entity) and
`&kind[id]{label}` (rule) — become clickable links both inside the Library viewer
and **everywhere Foundry enriches text** (journal pages, item/actor descriptions,
chat). Also covers the takeover of dnd5e's `&Reference[…]` syntax.

**Related docs**
- [`page-system.md`](page-system.md) — the viewer these refs navigate within.
- [`reference-syntax-guide.md`](reference-syntax-guide.md) — a **different** grammar: import-time semantic refs (`@class`, `@scale`, `@feature` → Foundry roll-data paths / `@UUID`). Those are resolved by the importer at import time; the refs here are *display/navigation* links resolved at read time. Don't conflate the two.

## Grammar

```
@kind[semantic-id]#anchor{display}      entity reference
&kind[semantic-id]#anchor{display}      rule reference
```

`#anchor` and `{display}` are optional. `kind` is lowercase. The app authors and
stores these raw in BBCode bodies; the module renders them. The grammar matches
`src/lib/bbcode.ts` on the app side.

- **Entity refs (`@`)** point at a compendium/lore entity and route to its app
  page (or load in-viewer for articles).
- **Rule refs (`&`)** point at a **system page** entry and route to
  `/system/<kind>#<anchor>` — or open in-viewer as a system page.

## Route map (`refRoute`)

`layout-blocks.js` mirrors the app's `resolveRefRoute`. Routes are absolute to the
live site (`https://www.dauligor.com`):

| Sigil · kind | Route |
|---|---|
| `&` (any rule kind) | `/system/<kind>#<anchor-or-id>` |
| `@spell` | `/compendium/spells?focus=<id>` |
| `@class` | `/compendium/classes/view/<id>` |
| `@feat` | `/compendium/feats?focus=<id>` |
| `@item` | `/compendium/items?focus=<id>` |
| `@article` | `/wiki/article/<id>` |
| `@subclass`, unknown kinds | none → rendered as a non-clickable "dangling" badge |

## Shared markup (`refMarkup`)

`refMarkup({ kind, id, anchor, rule, display })` is the single source of
`.dauligor-ref` markup, used by both the block renderer's enricher and the
Foundry-wide enricher, so a ref looks and behaves identically everywhere. It emits:

```html
<a class="dauligor-ref dauligor-ref--<kind>"
   data-ref-sigil="@|&" data-ref-kind="<kind>" data-ref-id="<id>"
   [data-ref-anchor="<anchor>"] data-route="<absolute app url>">label</a>
```

or, when there is no route, a non-clickable `<span class="dauligor-ref
dauligor-ref--dangling">`. The label falls back to a humanized id via
`formatFoundryLabel` when `{display}` is absent.

## Two surfaces, two binders

### 1. Inside the Library viewer

`DauligorViewerApp._bindRefs()` wires every `.dauligor-ref[data-route]` in the
rendered body with **history-aware** navigation:
- `@article` → loads the article in-viewer (`_navigate({mode:"article"})`).
- `&` rule ref → loads the system page in-viewer (`_navigate({mode:"system", kind,
  anchor})`).
- a `@class` ref → opens the standalone class-detail window (see below).
- a compendium-backed entity ref (`@spell` / `@item` / `@species` / `@background`)
  → imports + opens the Foundry item (see [On-demand import](#on-demand-import-click--drag)).
- any other entity ref → opens its `data-route` in a browser tab.

### 2. Foundry-wide (journals, sheets, chat)

`scripts/ref-enricher.js` registers `CONFIG.TextEditor` enrichers so the same refs
written **anywhere** Foundry runs `enrichHTML` render as `.dauligor-ref` links,
plus one delegated click handler that routes them.

- `registerRefEnrichers()` — called in the `init` hook. Pushes/​unshifts two
  enrichers (see below).
- `registerRefClickHandler()` — called in the `ready` hook. One delegated
  `document` click listener: it **skips refs inside `.dauligor-viewer`** (the
  viewer binds its own, history-aware), then routes the rest exactly like the
  viewer — `&` → `DauligorViewerApp.open({systemKind, systemAnchor})`, `@article`
  → `openDauligorLibrary({articleId})`, `@class` → the standalone class-detail
  window, a compendium-backed ref (`@spell` / `@item` / `@species` / `@background`)
  → the on-demand import (see above), else `window.open(route)`.

Global `.dauligor-ref` styling lives in `base.css` (the viewer's scoped rules win
inside the window); it uses literal color fallbacks because journals/sheets don't
carry the `--dauligor-*` palette.

## Hover preview cards

The model is **hover to preview, click to navigate**. Hovering a reference shows a
small preview card; clicking still does its normal thing (the binders above).
Registered by `scripts/ref-hovercard.js` (`registerRefHoverCards()`, called in
`ready`) as one delegated `document` `pointerover` / `pointerout` listener. The
card is a single body-level element with `pointer-events: none`, so it never
intercepts the click. Two families are covered:

| Hovered link | Card data source | Click |
|---|---|---|
| Dauligor `.dauligor-ref[data-ref-kind]` | `content-service.resolveReferences` (app data — needs login) | compendium kinds → import the Foundry item (see [On-demand import](#on-demand-import-click--drag)); `@article` / `&` → in-viewer Library; else the app page |
| Foundry `@UUID` content-link (`a.content-link[data-uuid]`) | the linked Foundry **document** via `fromUuid` (name / image / description) | Foundry-native — opens the item |

**Two ref forms in practice.** Native Foundry `@UUID` content-links (from SRD /
already-imported content) hover-preview the linked document and click open it
natively — the importer only converts `@class` / `@subclass` / `@feature` /
`@option` / `@source` into `@UUID` (see
[`reference-service.js`](../scripts/reference-service.js)). Dauligor `@spell[slug]`
refs (how Dauligor authors spell→spell references) hover-preview app data, and
**click/drag import the Foundry item on-demand** (next section). The hover system
covers both, so any reference shows a card regardless of form.

**States:** a logged-out viewer hovering a *Dauligor* ref gets a "Log in to
preview" card; a Dauligor ref whose target doesn't exist yet shows "Reference not
yet made" (mirroring the in-page block cards). Refs that already sit inside an
expanded entity card (`.dauligor-card`) are skipped — that card is itself the
preview. The card markup + display data are resolved/cached the same way as the
block cards (see [`page-system.md`](page-system.md) → Entity-reference resolution).
Styling is global: `.dauligor-reftip` in `base.css`, with literal token fallbacks
(it lives at `document.body`, outside the window scope).

## On-demand import (click + drag)

A compendium-backed reference (`@spell`, `@item`, `@species`, `@background`) is a
**portal** to an entity on the Dauligor site — it stays semantic, never dangles,
and never needs the entity pre-imported. `scripts/ref-import.js` gives it two
interactions, mirroring how Foundry treats a content-link / Plutonium handles a
5etools tag:

- **Click** → fetch the full Foundry-ready item and open it in a **temporary item
  sheet** (the real dnd5e sheet, activities and all). Nothing is added to the
  world — exactly like opening a compendium item's sheet.
- **Drag** → the link carries the built item as a Foundry `{type:"Item", data}`
  drop payload, so dropping it on an actor sheet (or the Items sidebar) imports it
  through Foundry's own drop handling.

**Kinds + endpoints.** Each importable kind maps to a public per-entity endpoint
and the Foundry document it builds:

| Ref kind | Endpoint | Payload kind | Foundry item |
|---|---|---|---|
| `@spell` | `/api/module/spells/<dbId>.json` | `dauligor.spell-item.v1` | `spell` |
| `@item` | `/api/module/items/<dbId>.json` | `dauligor.item-item.v1` | weapon / equipment / … |
| `@background` | `/api/module/backgrounds/<dbId>.json` | `dauligor.background-item.v1` | `background` |
| `@species` / `@race` | `/api/module/races/<dbId>.json` | `dauligor.race-item.v1` | `race` |

Backgrounds + species live in the **`feats` table** app-side
(`feat_type='background'` / `'race'`), so the slug→dbId lookup (`resolveTableRefs`)
ANDs a `feat_type` filter — `@background[x]` can't resolve a feat or species of the
same identifier.

**Classes are special.** `@class[…]` is NOT a temp-item import — clicking it opens a
**standalone class-detail window** (`openClassReference` → `openDauligorClassDetail`)
showing the SAME rich ClassView the character creator renders (header + progression
table + Features / Subclass / Spell-List / Info / Flavor tabs + Core-Traits
sidebar). That view lives in a shared module,
[`class-detail-view.js`](../scripts/class-detail-view.js) (`renderClassView` +
`bindClassView` + fetch helpers), used by the creator's Class tab, this window, and
the **import wizard's class browser** (an inline preview pane beside the
class/subclass card grid — `DauligorClassBrowserApp._renderClassDetail`) — **one
implementation, no duplication**. The window resolves the class's source slug (via
`resolveReferences`), fetches the public class bundle
(`/api/module/<source>/classes/<identifier>.json`) + the multiclass slot chart, then
renders. Subclass / feat / condition / article refs keep their prior routing.

In the import wizard the ClassView's subclass dropdown is two-way synced with the
card grid (the authoritative import target), so the preview always matches what will
be imported; the bundle is the variant's lazily-fetched payload
(`_ensureVariantPayload`), which IS the semantic class-export the ClassView consumes.

**Pipeline.** `resolveReferences` returns the entity's DB id (`docId`) for the
slug; the full Foundry-ready item is then fetched from the **public**
`/api/module/<kind>/<dbId>.json` endpoint (a `dauligor.spell-item.v1` payload —
the same one the Spell importer uses, so the item carries description / activities
/ materials). `openReferencedItem` builds a temporary `Item` and renders its sheet;
results are cached by `kind:id` (the viewer's Refresh clears the cache).

**The async-at-dragstart detail.** A drag payload must be set synchronously at
`dragstart`, but the fetch is async. The cursor entering a ref (`pointerover`)
both enables dragging and prefetches the item, so it's cached by the time you
drag. A drag with no prior hover just does the browser default (re-hover, then drag).

**Why not bake `@UUID` at import.** A converted `@UUID` **dangles** for any entity
not present in the world (Foundry shows a broken link, not a website fallback),
which defeats "reference anything on the site." Keeping the ref semantic and
importing on demand means the click always resolves to *something* — the Foundry
item if buildable, else the app page — and never a dead link.

## The two enricher patterns

| Constant | Pattern (in `ref-enricher.js`) | Registered |
|---|---|---|
| `REF_PATTERN` | `(@\|&amp;\|&)([a-z][a-z0-9-]*)\[…\]…` — global, **case-SENSITIVE** | `push` |
| `REFERENCE_PATTERN` | `(?:&amp;\|&)Reference\[type(=key)? …flags\]{label}?` — global, case-insensitive | `unshift` |

### Why case-sensitive on `REF_PATTERN`

The lowercase-only `kind` is deliberate: it ensures the pattern **never matches
Foundry's own PascalCase document enrichers** — `@UUID[…]`, `@Actor[…]`,
`@Compendium[…]`, `@Check[…]`. A case-insensitive flag would let `[a-z]` match `U`
in `@UUID` and clobber core links. (`&amp;` is matched first so an HTML-encoded
ampersand resolves before a bare `&`.)

### Why `REFERENCE_PATTERN` is unshifted (the `&Reference` takeover)

dnd5e ships its own `&Reference[type=key]` enricher (id `dnd5e-reference`,
`/&(?<type>Reference)\[…/gi`) that renders the SRD rules tooltip. The system is
initialized **before** modules, so its enricher is already in
`CONFIG.TextEditor.enrichers` when this module's `init` runs. To make a Dauligor
Library page win for `&Reference[…]`, the module **unshifts** its enricher to the
front of the array so it matches first and consumes the text before dnd5e sees it.

The takeover maps dnd5e's syntax to a Dauligor rule ref, mirroring the app's
`bbcode.ts` `&Reference` normalization: `type` → page kind, `key` → entry anchor;
the page-level shorthand `&Reference[prone]` → kind `prone`, no entry; trailing
dnd5e flags (e.g. ` apply=false`) are ignored.

**Owner decision (2026-06-07): the Library wins for `&Reference[…]`.** Tradeoff: a
`&Reference[…]` whose kind has no Dauligor system page lands on the viewer's "Open
in app" fallback instead of dnd5e's working SRD tooltip. The native `&kind[…]`
syntax is unaffected (dnd5e ignores lowercase kinds, so its enricher stays `push`).

## Gotchas

- Enrichers run on the HTML string in array order. The `&Reference` enricher must
  stay **unshifted** (front) to beat dnd5e's; the native enricher is `push`ed.
- An enricher's `pattern` must carry the global flag; the `enricher` callback
  returns an `HTMLElement` (built from `refMarkup` via a `<template>`).
- Do **not** override `TextEditor.enrichHTML` — push/unshift into the enrichers
  array so the module composes with core + every other module.

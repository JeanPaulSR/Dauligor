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
  → `openDauligorLibrary({articleId})`, else `window.open(route)`.

Global `.dauligor-ref` styling lives in `base.css` (the viewer's scoped rules win
inside the window); it uses literal color fallbacks because journals/sheets don't
carry the `--dauligor-*` palette.

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

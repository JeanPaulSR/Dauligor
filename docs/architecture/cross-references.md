# Cross-References (`@` entity links & `&` rule links)

> **Not the same as [reference-syntax.md](reference-syntax.md)**, which covers *formula*
> references (`@prof`, `@scale.<class>.<column>`) resolved at Foundry-export time. **This**
> doc covers the **cross-reference** system: the `@kind[id]` / `&kind[id]` BBCode sigils
> that turn prose into clickable, hover-previewable links to compendium entities, lore
> articles, and system pages.

## The two families

Cross-references come in two sigils, each searching a different family of targets:

| Sigil | Family | Targets | Example |
|---|---|---|---|
| `@` | **entity** | compendium docs + lore articles | `@spell[fireball]`, `@class[wizard]`, `@article[deep-shadow-cult]` |
| `&` | **rule** | **system pages** (glossary articles) | `&condition[prone]`, `&condition[]` |

`@` points at a specific stored row (a spell, class, feat, item, subclass, lore article, or
unique-option group). `&` points into the **system-page** glossary (Conditions, Skills,
Magic, homebrew rules) — see [System pages](#system-pages-the--targets) below.

Kinds wired today (`src/lib/references.ts` → `KIND_CONFIG` / `FAMILY_KINDS`):
- **entity**: `spell`, `class`, `subclass`, `feat`, `item`, `article`, `option-group`
- **rule**: `condition` (static fallback) — in practice shadowed by a same-named system page

## Grammar

```
@kind[id]                 entity reference
&kind[id]                 rule reference (→ a system-page entry)
&kind[]                   page-level reference (the page itself, no entry)
@kind[id]#anchor          explicit anchor
@kind[id]{Custom Label}   custom display text (else the id is humanised)
```

- **`id`** is the SEMANTIC identifier (slug) of the target — never a Foundry UUID.
  (`option-group` is special: no stored slug, so its id is `slugify(name)`, and a drill-down
  item is the composite `<group-slug>:<item-slug>`.)
- **Empty brackets `[]`** make a `&` reference *page-level*: it cites the page itself and the
  route omits the anchor.
- **`{display}`** overrides the link text. Without it the label is `humanizeRefId(kind, id)`
  (strip a leading `kind-` prefix, swap `-`/`_` for spaces, Title-Case).

### Foundry `&Reference[…]` is accepted verbatim

Pasted Foundry / dnd5e compendium prose uses `&Reference[type=key]`. A pre-pass in
`bbcode.ts` rewrites it to the internal form **before** the main parser runs, so it inherits
all the same routing / hover / dangling logic:

| Pasted | Rewritten to |
|---|---|
| `&Reference[condition]` | `&condition[]` (page-level) |
| `&Reference[condition=paralyzed]` | `&condition[paralyzed]` |
| `&Reference[type=key flags]{Label}` | `&type[key]{Label}` (trailing flags dropped) |

## How a reference renders (client pipeline)

All of this lives in **`src/lib/bbcode.ts`** (`bbcodeToHtml`) and runs only in *view* mode —
in editor mode references stay as plain, editable text.

1. **XSS escape.** `&` becomes `&amp;`, so the rule sigil arrives as `&amp;`.
2. **Foundry pre-pass.** `&amp;Reference[…]` → internal `&amp;kind[entry]` (table above).
3. **Main pass.** One regex matches `(@|&amp;)kind[id](#anchor)?({display})?` and, per hit,
   calls `resolveRefRoute(kind, id, anchor, { rule: sigil !== '@' })`:
   - **route found** → a clickable `<a class="ref-link ref-<kind>" …>` carrying
     `data-ref-sigil` / `data-ref-kind` / `data-ref-id` (the hover card reads these).
   - **route null** → a non-clickable `<span class="ref-link ref-<kind> ref-dangling" …>`
     (still hoverable, just "not a page yet").

`resolveRefRoute` (also in `bbcode.ts`):
- **`&` (rule)** always routes to `/system/<kind>` (plus `#<anchor-or-id>` for an entry). It
  never returns null, so `&` refs are always clickable — the `/system` reader handles a
  not-yet-authored page gracefully.
- **`@` (entity)** maps per kind: `spell`→`/compendium/spells?focus=<id>`,
  `class`→`/compendium/classes/view/<id>`, `feat`→`/compendium/feats?focus=<id>`,
  `item`→`/compendium/items?focus=<id>`, `article`→`/wiki/article/<id>`. `subclass`,
  `option-group`, and unknown kinds return **null** → they hover but don't link (no public
  page yet).

## How hover + autocomplete resolve

**`src/lib/references.ts`** powers the hover card and the `@`/`&` autocomplete; reads go
through the standard `queryD1` proxy (no dedicated endpoint).

- **`resolveReference(kind, id)`** → the hover-card data (`RefResolved`: name, summary,
  prereq lines, image, source label, route, and `docId` = the real primary key for hosts that
  open a full preview pane). **System pages are tried first**: it consults
  `getSystemPageKindMap()` and, if the kind is a system page, returns the page (empty id) or
  the entry; otherwise it falls through to `KIND_CONFIG`. Returns `null` for a dangling
  reference (unknown kind or missing row).
- **`searchReferenceFamily(family, query)`** → autocomplete results for a whole sigil family
  in one round-trip. The **rule** family pulls system pages + entries first, then drops any
  static rule kind shadowed by a same-named system page. The **entity** family issues one
  `SELECT` per kind via `batchQueryD1` — *not* a UNION, because D1 caps a compound `SELECT` at
  5 terms and the entity family has 6 kinds (a 6-term UNION fails and the search returns
  nothing).
- **`KIND_CONFIG`** is the per-kind mapping (table, id column, name column, summary
  expression, plus optional image / source / prereq columns). Add a kind here to make it
  resolvable.

## System pages (the `&` targets)

A **system page** is a site-consistent, reference-addressable glossary article — the
navigation target `&` rule references resolve into. Data layer: **`src/lib/systemPages.ts`**.

- **Schema** (`worker/migrations/20260529-1500_system_pages.sql`, applied local + remote):
  - `system_pages` — `id`, `identifier` (UNIQUE), `name`, `description` (BBCode), `icon`, `order`.
  - `system_page_entries` — `id`, `page_id` (FK CASCADE), `identifier` (UNIQUE per page),
    `name`, `summary`, `body`, `source_kind`, `source_id`, `image_url`, `order`.
- **`identifier` IS the `&` kind.** `&condition[prone]` → the page whose identifier is
  `condition`, entry `prone` → `/system/condition#prone`. `&condition[]` → the page itself.
- **Name-slug aliases.** `getSystemPageKindMap()` maps both a page's canonical `identifier`
  AND `slugify(name)` → the identifier. So Foundry's `&Reference[condition=…]` lands on a page
  whose admin identifier is `conditions` (name "Condition" slugifies to `condition`).
  Canonical identifiers win; first writer wins among name-slugs. Cached; cleared on
  save/delete via `invalidateSystemPageCache()`.
- **Hybrid entries.** An entry is EITHER free prose (`body`) OR entity-backed
  (`source_kind`/`source_id` point at a canonical row; `SYSTEM_SOURCE_TABLES` maps the kind to
  its table, e.g. `condition → status_conditions`). Backed text is pulled live and merged in
  `resolveEntries`; a stored field still overrides the source. *(The create-UI for
  entity-backed entries is held off today — schema + data layer are ready.)*
- **Surfaces:**
  - Reader: `/system/:identifier` (public) — `SystemPageView.tsx` + `SystemPageGlossary.tsx`.
  - Admin: `/compendium/system-pages` (list, player-visible) + `/new` & `/edit/:id`
    (admin only) — `SystemPagesList.tsx` + `SystemPageEditor.tsx`.

## Drift pair: `bbcode.ts` ↔ `_bbcode.ts`

Reference rendering is **intentionally divergent** between the client renderer
(`src/lib/bbcode.ts`) and the server mirror (`api/_lib/_bbcode.ts`). The server leaves
references as plain text for the Foundry-side enrichers (the deferred live-content bridge).
The `&Reference[…]` pre-pass and the page-level grammar live **only** in the client.
**Do not mirror reference changes to `_bbcode.ts`.**

## File map

| File | Role |
|---|---|
| `src/lib/bbcode.ts` | `bbcodeToHtml` render pipeline, `resolveRefRoute`, `humanizeRefId`, Foundry pre-pass, `RefKind` |
| `src/lib/references.ts` | `resolveReference` (hover), `searchReferenceFamily` / `searchReferences` (autocomplete), `KIND_CONFIG`, `FAMILY_KINDS` |
| `src/lib/systemPages.ts` | system-page data layer + `getSystemPageKindMap` |
| `src/components/reference/ReferenceHoverCard.tsx` | hover-card UI (consumes the `data-ref-*` attributes) |
| `src/components/MarkdownEditor.tsx` | inline `@`/`&` autocomplete |
| `src/pages/system/SystemPageView.tsx`, `src/components/compendium/SystemPageGlossary.tsx` | reader |
| `src/pages/compendium/SystemPagesList.tsx`, `SystemPageEditor.tsx` | admin |
| `api/_lib/_bbcode.ts` | server mirror — refs stay as text (drift pair; **do not** mirror ref logic) |

## Adding a new reference target

- **A new `&` rule page** (e.g. Skills, Magic): create it in the admin at
  `/compendium/system-pages/new`, with `identifier` = the `&` kind you want (`skill`). That's
  it — autocomplete, hover, and routing pick it up via `getSystemPageKindMap()`. To back its
  entries with an existing table, add a row to `SYSTEM_SOURCE_TABLES` in `systemPages.ts`.
- **A new `@` entity kind**: add it to `RefKind` (`bbcode.ts`), a `KIND_CONFIG` row +
  `FAMILY_KINDS.entity` (`references.ts`), and a `case` in `resolveRefRoute` (`bbcode.ts`) if
  it has a public page.

## Related docs

- [reference-syntax.md](reference-syntax.md) — *formula* references (`@prof` / `@scale.*`), a separate system.
- [../ui/bbcode.md](../ui/bbcode.md) — the BBCode tag set + TipTap editor.
- [../roadmap.md](../roadmap.md) — live-content bridge (Foundry-side reference handling) + article unification.

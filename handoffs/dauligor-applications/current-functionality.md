# Current functionality — rich text, cross-references, Foundry export

_User-facing snapshot of what the areas this branch touches do **today on `main`**,
before this branch's changes land. Paired with [changes-being-made.md](changes-being-made.md)._

## Rich text editing
- All long-form content (lore articles; class / spell / feat / item descriptions; DM
  notes) is written in **BBCode** and edited through a shared editor with a **Visual**
  (what-you-see) mode and a **Source** (raw BBCode) mode, toggled from the toolbar.
- Supported formatting: bold, italic, underline, strikethrough, headings, alignment,
  lists, tables, quotes, code, links, subscript/superscript, spoilers, horizontal rules.

## Cross-references between content
- A cross-reference links one piece of content to another (e.g. a spell mentioned in an
  article).
- Today only **three** kinds work: **spells**, **classes**, and **conditions**.
- There is **no toolbar button** to insert one — an author must switch to Source mode and
  hand-type the markup, knowing the target's identifier in advance.

## Foundry VTT
- The companion module **imports** Dauligor content into a Foundry game as copies (a
  "static importer"). Edits made in the app afterwards don't reach already-imported copies.

## Known rough edges
- Several rich-text bugs and the missing cross-reference UI are being addressed on this
  branch — see [changes-being-made.md](changes-being-made.md).

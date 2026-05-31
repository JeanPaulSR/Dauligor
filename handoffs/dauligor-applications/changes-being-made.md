# Changes being made — `system-applications` branch

_User-facing summary of what this branch will change once it merges. Paired with
[current-functionality.md](current-functionality.md). When this branch's code lands on
`main`, these entries get folded into the current-functionality docs and removed from here._

## Shipped on the branch (pending merge to `main`)

**Rich-text reliability fixes** — a pass to make BBCode dependable before we build on it:
- Block quotes no longer leave a stray empty line after them.
- Horizontal rules render correctly (a malformed-tag bug is fixed).
- Links are now visible (gold) on every theme, including dark mode, with a pointer cursor.
- The Spoiler toolbar button works in Visual mode; formatting with the cursor inside a word
  now wraps the whole word; wrapping no longer captures surrounding spaces.
- The **Comment** button was removed — it silently hid your text; the hidden-comment tag is
  now Source-mode only.
- A new **link dialog** replaces the browser's built-in prompt.
- A developer **BBCode tester** page (`/dev/bbcode`, admin-only) for finding and reporting
  rich-text bugs.

## Planned (not yet started)
- **Cross-reference authoring** — add the missing kinds (items, articles, feats, …) and a
  toolbar picker so authors can insert cross-references without hand-typing.
- **Live-content bridge** — turn the Foundry module from a static importer into a live
  viewer that always shows the freshest content (multi-phase).

## Where the detail lives
- Plain-language roadmap: [docs/roadmap.html](../../docs/roadmap.html)
- Current system architecture: [docs/system-overview.html](../../docs/system-overview.html)
- Technical manifest (files this branch owns): [manifest.md](manifest.md)

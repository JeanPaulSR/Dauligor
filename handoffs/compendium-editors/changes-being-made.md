# Changes being made — `compendium-editors` branch

_User-facing summary of what this branch will change once it merges. Paired with
[current-functionality.md](current-functionality.md). When this branch's work lands on `main`,
these entries get folded into the current-functionality docs and removed from here._

## Shipped on the branch (pending merge to `main`)

**A navigable documentation reference for the compendium editors** — a multi-page HTML reference
under `docs/architecture/compendium-editors/` that explains, in human-focused language, how the
editors actually work today. Sections:
- **Survey** — every editor, the pattern it follows, the components it mounts, the table it writes
  to (plus a dense file-by-file reference sibling).
- **Data flow** — how a save round-trips from the form to the database and back, the caching, the
  cross-client refresh.
- **Tables & relations** — how the content tables relate, what's stored as JSON vs separate
  tables, the cascade rules.
- **Components walkthrough** (in progress) — one shared widget at a time, documenting it and
  flagging/fixing UI issues as we go.
- **Endpoints** (planned) — the app-side endpoints that serve the Foundry module.

This reference is the source of truth for *what was found* during the documentation pass.

## In progress

**Component walkthrough + UI fixes.** Going through the shared editor widgets one at a time. Each
gets documented; UI-side issues get flagged and the quick ones fixed on this branch. Started with
the master-detail shell (the layout behind the Spell/Feat/Item editors) — first issues flagged
(list-column width on narrow screens).

## Planned

Following the agreed cleanup roadmap:
1. **Finish the main character-content editors** — Backgrounds, Races, Items. Clean up their views
   and editors; promote Backgrounds and Races to their own tables (out of the feats table).
2. **Clean up the Class / Subclass editors** — these stay bespoke (they're innately complex).
3. **Clean up the shared widgets** — advancement editor, activity editor, etc. — once, so the fix
   propagates across every editor.
4. **UI polish + edge cases** — including replacing the Facilities editor's temporary shell.

## Conventions adopted on this branch (apply going forward)

- New editors and endpoints are written in **camelCase** (matching Foundry); the legacy
  camel/snake translation on existing tables is migrated later.
- New compendium tables (Backgrounds, Races when promoted) are added to the client-side persistent
  cache list so their reads survive a page reload.

## Where the detail lives

- The reference set: `docs/architecture/compendium-editors/index.html`
- Technical manifest (files this branch owns): [manifest.md](manifest.md)

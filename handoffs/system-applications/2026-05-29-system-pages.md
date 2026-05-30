# Handoff — System Pages (2026-05-29)

Pickup context for branch `system-applications`. Builds on (does not replace):

- [2026-05-29-reference-enhancements.md](2026-05-29-reference-enhancements.md) — class preview pane + earlier-today reference enhancements (commits already on `main`).

## TL;DR

The **system page article type** shipped end-to-end and pushed to `main` today
(commits `8989bd1` + `1ecbf0a`). Site-consistent, reference-addressable glossary
pages — the navigation target the `&` rule references have been waiting for.
The `&` ref system was extended in the same push to handle **page-level refs**
(`&kind[]`), **Foundry's native `&Reference[type=key]`** form, and **slugified-
name aliases** so Foundry kinds (`condition`) resolve even when the admin's
page identifier is `conditions`.

## Commits (both on `origin/main`)

| SHA | Subject |
|-----|---------|
| `8989bd1` | feat(compendium): system page article type — reader, admin, migration |
| `1ecbf0a` | feat(references): page-level refs, Foundry `&Reference[…]`, name-slug aliases |

## What shipped

**Migration** — `worker/migrations/20260529-1500_system_pages.sql`. Two tables
(`system_pages`, `system_page_entries`) with the hybrid `source_kind`/`source_id`
columns kept on the entry schema for the later condition→entry linking even
though the create-UI for entity-backed entries is held off. **Applied to LOCAL
and REMOTE D1** (remote applied 2026-05-29; verified `system_pages`,
`system_page_entries`, and the `idx_system_page_entries_page_order` index in
remote `sqlite_master`).

**Data layer** — `src/lib/systemPages.ts`. Types, fetch/resolve/search/CRUD,
`getSystemPageKindMap()` (kind → canonical identifier, includes slugified-name
aliases), `invalidateSystemPageCache()` (called on save/delete to drop the
kind-map cache so renames take effect).

**Reader** — `/system/:identifier` (public, no AdminOnly):

- `src/pages/system/SystemPageView.tsx` — fetches + renders, handles loading and
  not-found states.
- `src/components/compendium/SystemPageGlossary.tsx` — Quiet-Focus blocks (sharp
  edges, flat at rest, soft `gold/[0.04]` fill + 2 px left accent on hover or
  active), right-hand Contents rail (pure typography, no chrome line, serif
  names with the active item in accent), description panel at the top rendered
  straight from the admin's BBCode with no imposed styling (per user — the
  admin shapes it via BBCode).
- **Tolerant of identifier mismatch** — `fetchSystemPageDetail` falls back to a
  slugified-name match so `/system/condition` lands on the conditions page even
  when the admin's identifier is `conditions`.

**Admin** — `/compendium/system-pages` (player-visible list) + `/new` and
`/edit/:id` (AdminOnly):

- `src/pages/compendium/SystemPagesList.tsx` — searchable compact list (built
  for 30+ pages), row-click goes to the view page (for everyone), admin actions
  (Edit / Delete) revealed on hover **for admins only**. "New System Page"
  button admin-only.
- `src/pages/compendium/SystemPageEditor.tsx` — master-detail using the
  documented `browser-panel` pattern. Sticky save bar (Ctrl/Cmd+S also saves).
  Left sidebar lists "Page Details" + every entry (hover-revealed up/down/
  delete on each row). Right pane edits the selected item. `/new` route opens
  with a draft uuid; first save flips the URL to `/edit/:id` via
  `navigate(…, { replace: true })`. Entries are kept in local state until Save;
  deletes persist immediately (idempotent — harmless if not yet persisted).
  Description + entry body authored via `MarkdownEditor` (BBCode + `@`/`&`
  autocomplete).

**Reference wiring** (commit `1ecbf0a`):

- **Page-level grammar** — `&kind[]` (empty brackets) cites the page itself
  (not an entry). `resolveReference` returns the page's name + description as
  the summary; route is `/system/<kind>` (no fragment).
- **Foundry `&Reference[…]` pre-pass** — translates `&Reference[type=key]` to
  the internal `&type[key]` form **before** the main parser runs, so pasted
  Foundry/dnd5e content inherits all the existing route/hover/dangling logic
  uniformly. Handles bare `&Reference[type]` (page-level), `&Reference[type=key]`,
  `&Reference[type=key flags]{Label}` (trailing flags stripped).
- **Kind map with name-slug aliases** — `getSystemPageKindMap()` maps both a
  page's canonical identifier AND a slug of its name → its identifier. Foundry's
  `&Reference[condition=…]` resolves to a page whose admin identifier is
  `conditions` (name "Condition" slugifies to `condition`). Canonical wins on
  collisions; first-write wins among name-slugs.
- **Autocomplete (`&` family)** now includes system pages alongside entries.
  Insert format is `&kind[entry-id]{Name}` (empty entry-id for page-level →
  `&kind[]{Name}`).
- **Shadow check** — a system-page kind shadows the static rule kind in
  `KIND_CONFIG` (so a `condition` system page replaces the `status_conditions`
  resolve, per locked spec §8 #3). Uses the kind map (with aliases), so the
  shadow fires for Foundry-style kinds too.

**Routing + chrome** (`src/App.tsx`):

- Routes: `/system/:identifier` (public), `/compendium/system-pages` (public),
  `/compendium/system-pages/new` + `/edit/:id` (AdminOnly).
- `RouteAwareFooter` suppresses the global OGL/copyright footer on `/system/*`
  AND `/compendium/system-pages*` (kept on every other page for the OGL notice).

**Compendium landing** (`src/pages/compendium/Compendium.tsx`): "System Pages"
link added to the **Reference** section (alongside Sources), visible to all
players. Originally placed under Admin Tools; moved when the list became
player-visible (per user feedback).

**Drift pair `bbcode.ts` ↔ `_bbcode.ts`** — ref rendering is INTENTIONALLY
divergent: the server (`_bbcode.ts`) leaves refs as text for the Foundry-side
enrichers. The `&Reference[…]` pre-pass and page-level grammar live only in
the client `bbcode.ts`. **Do not mirror.**

## Architecture notes — non-obvious bits

- **StrictMode + initial deep-link scroll** (`SystemPageGlossary`). The URL
  hash jump (`/system/condition#incapacitated`) uses `block: 'center'` (matches
  the rail-click handler so the scroll-spy agrees) inside a
  `requestAnimationFrame` callback. The "done" gate is flipped **inside the
  rAF callback**, not at effect entry — otherwise React StrictMode's cleanup
  would cancel the rAF and the second pass would skip rescheduling, leaving
  the page wherever the browser's native anchor scroll happened to land
  (often the wrong entry once content rendered). See in-file comment.
- **Scroll-spy logic** picks the entry whose vertical center is closest to the
  viewport's, with a per-click 800 ms `scrollLockRef` so intermediate entries
  don't steal the active state mid smooth-scroll. Click-from-rail AND URL-hash
  jump both go through this coordinated path (`jumpTo` / the rAF callback) so
  active state + lock + scroll always agree.
- **Hybrid entry model — currently free-only in the UI.** The schema's
  `source_kind`/`source_id` columns support entity-backed entries (point at a
  `status_conditions` row, pull text live). The CREATE-UI for that was held
  off per user direction ("currently just focus on the system page; condition
  → entry linking comes later"). Data layer (`resolveEntries`,
  `SYSTEM_SOURCE_TABLES`) still handles backed entries if they exist; the
  editor just doesn't create them yet.
- **Description = plain BBCode area, not a styled lead.** Per user direction
  the description renders as plain `BBCodeRenderer` output with NO wrapper
  card or imposed italic/font styling. The admin shapes the styling via
  BBCode (`[i]`, `[b]`, headings, lists, etc.). Don't wrap it in a card.

## Open items

- **Foundry inline-roll formulas** (task #7 from the original task list —
  still pending). `[[/r …]]` / `[[/damage …]]` → readable chips in
  `bbcode.ts` reader **only** (NOT mirrored to `_bbcode.ts` — server leaves
  them for Foundry's enrichers). Add a `.inline-roll` style to `src/index.css`
  under `@layer components`. Small.
- **Condition → system-entry linking** — bring back the entity-backed UI in
  `SystemPageEditor`. Schema/data layer is already there
  (`SYSTEM_SOURCE_TABLES = { condition: 'status_conditions' }` in
  `systemPages.ts`); just add an editor mode to bind an entry to a
  `status_conditions` row (populate `source_kind='condition'` +
  `source_id=<id>`, leave `body` null so the reader pulls live text from the
  linked row). Reader already handles backed entries via `resolveEntries`.
- **Apply `20260529-1500_system_pages.sql` to REMOTE D1** — ✅ **done 2026-05-29**
  (applied with `npx wrangler d1 execute dauligor-db --remote --yes
  --file=migrations/20260529-1500_system_pages.sql`; both tables + the
  page-order index verified on remote via `sqlite_master`).
- **Subclass image-led hover** — handed off to `compendium-editors`. Open
  request added in [manifest.md § Open requests](manifest.md). Full detail in
  [../compendium-editors/2026-05-29-from-system-applications.md](../compendium-editors/2026-05-29-from-system-applications.md).
- Deferred larger arc (original branch goal): **live-content bridge** —
  Phase 1.5 hash-on-upsert → article-system unification → Phase 2 Foundry
  viewer. Manifest's "When to retire" lists these.

## Branch / dev / verification

- Branch `system-applications`, now at `1ecbf0a` (== `origin/main`).
- Dev stack on `:3001` / `:8788` / `:9230` via `node scripts/dev-sysapp.mjs`
  from repo root (branch-specific ports per manifest).
- `tsc --noEmit`: **7 pre-existing errors** (`asChild` on `Button` in
  `CompendiumBrowserShell` / `CampaignEditor` / `SpellList` /
  `LoreEditor` × 3 + an argument-count error in `characterShared.ts`).
  **None introduced** by this work.
- Live verification done: `/system/conditions` renders the seeded entries;
  `&Reference[condition=paralyzed]` from the BBCode tester (`/dev/bbcode`)
  renders + hovers + clicks through correctly; page-level `&condition[]`
  shows the description and routes to `/system/conditions`; deep-link
  `/system/condition#incapacitated` lands on the right entry (post the
  StrictMode-rAF fix).

## How to resume

1. `git branch --show-current` → `system-applications`. `git status` to confirm
   a clean tree (only the intentionally-local `docs/_drafts/*.html`, the
   foundry-alignment doc, and `cleanup-branches.bat` remain untracked).
2. Dev stack: `curl localhost:3001` (200) + `curl localhost:8788` (401). If
   down: `node scripts/dev-sysapp.mjs` from the repo root.
3. Pick a next item from "Open items" above. User signals so far:
   `#7 Foundry inline-roll formulas` is the smallest tangible win;
   `condition → entry linking` closes the hybrid loop; the `live-content
   bridge` is the original branch goal.
4. Remote migration is **already applied** (2026-05-29) — `system_pages` /
   `system_page_entries` + the page-order index exist on both local and remote
   D1. No action needed.
5. Local-only design drafts that stay UNTRACKED per convention (don't push):
   `docs/_drafts/system-page-spec.html` (locked design),
   `docs/_drafts/system-page-design-concepts.html` (initial 4 concepts +
   refined-direction inset),
   `docs/_drafts/system-page-layouts-v2.html` (subtle-typography iteration —
   set aside),
   `docs/_drafts/system-page-layouts-v3.html` (Quiet-Focus & friends — the
   one that landed). Useful if the design needs another iteration; not
   referenced from anywhere else.

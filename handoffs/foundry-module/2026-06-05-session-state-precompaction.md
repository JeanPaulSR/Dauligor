# foundry-module — session handoff (pre-compaction, 2026-06-05)

Pickup doc for the `foundry-module` branch after a big **Character Creator** pass.
Read this + [manifest.md](manifest.md) first. Companion: agent memory
`project_foundry_module_branch`. Prior pickup:
[2026-06-04-session-state-precompaction.md](2026-06-04-session-state-precompaction.md).

## Git state (at handoff)

- Branch `foundry-module`: **11 behind / 2 ahead** of `origin/main`.
  - 2 ahead = `175fce8` (class-view preview) + `a5ff64d` (prior handoff). Both committed.
  - **11 behind** — `origin/main` moved (compendium-editors' class-category + other work
    landed). Consider rebasing/merging `origin/main` before any push.
- **ALL of THIS session's work is UNCOMMITTED** (working tree): `character-creator-app.js`,
  `class-import-service.js` (one export), `styles/character-creator.css`,
  `templates/character-creator-shell.hbs`, `docs/where-to-look-guide.md`, `manifest.md`,
  3 new handoffs, 1 docs/_drafts HTML.
- `main = production` (Cloudflare Pages auto-deploys). **Always `git fetch` + show
  `git log origin/main..HEAD` and ASK before pushing.** Per the cross-branch rule, this
  branch does NOT edit compendium-editors' app-side files or their `:3000` server.

## What shipped this session (all UNCOMMITTED, module-side)

The Character Creator (`scripts/character-creator-app.js` + `styles/character-creator.css`):

1. **Per-option top tabs** — `Create` (wheel) · `Class` · `Species` · `Background` ·
   `Starting Feat` · `Image` · `Character`. Wheel center = Ability Scores (sub-view of
   Create); wedges + review Edit-jumps switch tabs.
2. **Scroll preservation** — `_bodyKey` + `data-scroll-id` capture/restore so clicks
   (cv-tabs, feature toggles, picking rows, filter pills) don't jump to top.
3. **Class preview** — Spell List tab only shows when the class casts or the chosen
   subclass grants casting; active-tab falls back to Features when hidden.
4. **Class Select/Cancel** — browsing sets a PREVIEW (`_classPreview`); **Select Class**
   commits → wheel; **Cancel** reverts. Build Character lives on Create + Character.
5. **Wheel image fill** — a selected class paints its wedge with the class art, framed by
   the class view's stored `imageDisplay` (`{x,y,scale}` → object-fit/position/scale) via
   an SVG `<foreignObject>` + `<clipPath>` (NOT a pattern fill — that lost to Foundry CSS).
   Inline `style` fills so the stylesheet can't override. Generalizes to species/background.
6. **Class tag filter** — the import wizard's shared `section-filter-panel.js` reused in the
   class picker (tri-state pills, grouped tag axes + subtags, OR/AND/XOR, chip-search,
   Cancel/Save). Catalog already ships `tags` + `tagIndex`; tag catalog loaded lazily.
7. **Core / Alternate / New grouping** — class list divides by `category` (live on prod now,
   see below); flat fallback until present.
8. **Starting Feat picker** — was stubbed; now a real picker (generalized the bg/species
   feat-family methods to a 3rd `feat` kind). Lists `featType:"feat"` from `feats.json`,
   embeds the feat item on Build (deduped by sourceId).
9. **Description rendering refactor (REUSE, not reinvent)** — `renderDescription` now wraps
   the importer's exported `normalizeHtmlBlock` (HTML/BBCode/markdown → HTML) + resolves
   cross-refs to real names via `formatFoundryLabel` + light sanitize + trims a leading
   `<hr>` / duplicate "Prerequisite:" line. Feat detail shows a clean **Prerequisite** line
   from `system.requirements`. Deleted the hand-rolled converters + dead `truncate`/`stripHtml`.
   CSS unified on `.__desc` (removed dead `__rt-h/__rt-list/__rt-table`, kept `__rt-ref`).
   Documented the reusable utils in `docs/where-to-look-guide.md` §6.

## Cross-branch state (compendium-editors own `api/_lib` + router + the `:3000` server)

- ✅ **class `category`** — requested + THEY applied it + **pushed to `main` → live on prod**
  (verified `ll`=alternate/new, `phb`=core). Reply:
  [2026-06-04-reply-class-category.md](2026-06-04-reply-class-category.md). The grouping
  lights up wherever the catalog ships `category` (prod now; local `:3000` after its server
  restarts on updated code).
- ✅ **spellcasting multiclass-chart** — on prod (earlier; feeds the class preview slots).
- ⏳ **backgrounds & species LIST endpoints — REQUESTED, PENDING.** bg/race were moved out of
  `feats` into their own tables (detail endpoints exist) but `feats.json` no longer carries
  them and there's **no list endpoint** → the creator's Species/Background sections AND the
  import wizard's feat browser both come up **empty**. Asked for per-source
  `/<source>/backgrounds.json` + `/species.json`. Request:
  [2026-06-04-to-compendium-editors-bg-species-list-endpoints.md](2026-06-04-to-compendium-editors-bg-species-list-endpoints.md).
  Diagnosis: `docs/_drafts/remote-bg-species-state-2026-06-04.html`.

## Pending systems (the resume list)

1. **Owner Foundry eyeball** — NOTHING ran in a live world this session. Full restart needed
   (`module.json` styles/esmodules referenced; JS/CSS/HBS changed). Verify: tabs, wheel art,
   class filter modal, categorization, feat picker + detail, scroll behavior.
2. **Backgrounds & Species** — BLOCKED on the list-endpoints request above. When live:
   repoint the creator's `_loadFeatFamily` + the import wizard's feat browser from
   `feats.json`+`featType` to the new endpoints (drop the stale "bg/race ride the feats pool"
   assumption in `feat-browser-app.js`).
3. **Image wheel section** — still a STUB (`_bodySectionStub`). Build the portrait/token picker.
4. **Commit the batch** — after the eyeball, commit the creator work to `foundry-module`.
   Consider rebasing onto `origin/main` (11 behind) first. **Ask before pushing to main.**
5. **Feat picker polish (optional, deferred)** — owner said feats are "any feat for now"
   (NO 2024 origin-feat filter — important note); a `featSubtype`/tag filter is a later add.
   Also the tag **filter** isn't on the feat picker yet (only class) — feats carry `tagIds`.

## Key reuse / where-to-look (so we don't reinvent again)

- **Description → HTML:** `normalizeHtmlBlock(value)` — exported from `class-import-service.js`.
- **Slug/key → real name:** `formatFoundryLabel(slug)` — `importer-base-features.js` (CONFIG.DND5E).
- **References (semantic→native):** `reference-service.js` + `docs/reference-syntax-guide.md`.
- **Shared filter panel:** `section-filter-panel.js` (+ `styles/section-filter.css`).
- Route map: `docs/where-to-look-guide.md` (now incl. §6 UI description rendering).

## Gotchas

- **Verification:** can't run Foundry here; I render standalone SVG/HTML with **headless Edge**
  (`msedge --headless --allow-file-access-from-files --screenshot`) — same Chromium as Foundry.
  ES-module `import` over file:// needs `--allow-file-access-from-files`.
- **SVG fills:** presentation-attribute `fill="url(#…)"` loses to Foundry's stylesheet → use
  inline `style="fill:url(#…)"` (and `<clipPath>` for images, not `<pattern>`).
- **`:3000` dev server** runs the MAIN checkout (currently `dauligor-applications`), NOT this
  worktree — worktree app-side edits aren't served there; cross-branch needs a handoff.
- Window model, `<div role=button>` for multi-child clickables, full-restart-on-module.json —
  see `docs/styles-guide.md`.

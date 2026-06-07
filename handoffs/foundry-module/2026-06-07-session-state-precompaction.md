# foundry-module — session state (pre-compaction): reference interactions shipped, import-wizard ClassView pending

Pickup doc for the next session. Supersedes the `2026-06-07-reference-card-resolution.md`
pickup — that task (and a lot more) is now **done + committed**. **One task remains:
the import wizard's inline ClassView (#3), fully scoped below.**

## TL;DR

Built the whole **reference-interaction layer** on top of the shipped page system:

1. **Entity-reference blocks → rich cards** (reference / entity-feature / entity-row /
   recommended) — image + title + summary, resolved via `content-service.resolveReferences`.
   Unresolved real refs render a **"Reference not yet made"** card (shows `kind:id`);
   intentional placeholders render "Coming Soon".
2. **Hover preview cards** (`ref-hovercard.js`) — for our `.dauligor-ref` links (app data)
   AND Foundry `@UUID` content-links (the linked doc, via `fromUuid`).
3. **On-demand import** (Plutonium-style, `ref-import.js`) — for `@spell` / `@item` /
   `@feat` / `@species` / `@background`: **click** → opens a **temporary Foundry item
   sheet** (not imported), **drag** → imports onto a sheet (`{type:"Item", data}` drop).
4. **`@class` → a standalone class-detail window** (`class-detail-app.js`) showing the
   rich **ClassView**, which was **extracted into a shared module** (`class-detail-view.js`)
   that the character creator now delegates to — one implementation, no duplication.

All committed on `foundry-module` (`7243165`, `f87e806`), **unpushed**.

## What shipped (committed, unpushed)

**`7243165`** — reference cards + hover previews + on-demand spell import:
- `content-service.js`: `resolveReferences(refs)` → Map `kind:id` → `{name, summary, image,
  sourceLabel, rule}` (+ `docId`, `sourceSlug` added in the next commit). Mirrors the app's
  `src/lib/references.ts`; reads via the authed `queryD1` (every table is player-readable —
  not in the proxy's `PROTECTED_READ_TABLES`). `clearReferenceCache()`.
- `layout-blocks.js`: the 4 entity-reference blocks render rich cards (image/title/summary/
  source) + the "Reference not yet made" / placeholder states; `collectEntityRefs`,
  `hasAutoRecommendedBlock`, `plainExcerpt`; `renderBlocks(blocks, { resolved, recommended })`.
- `ref-hovercard.js` (NEW): global `pointerover`/`pointerout` hover cards (`.dauligor-reftip`
  in `base.css`, body-level, `pointer-events:none`). Logged-out → "Log in to preview".
- `dauligor-viewer.js`: resolve-then-render in article/system/campaign paths; Refresh busts
  the cache; `_bindRefs` catches card links.

**`f87e806`** — @class detail window + on-demand import for item/feat/species/background:
- `ref-import.js` (NEW): `IMPORT_ENDPOINTS` (spell/item/background/species/race/feat),
  `openReferencedItem`, `openClassReference`, `registerReferenceImports`, prefetch/cache.
- `class-detail-view.js` (NEW): the **shared ClassView** — `renderClassView(view)` +
  `bindClassView(root, view, onRerender)` + fetch helpers (`fetchClassBundle`,
  `ensureSpellChart`, `fetchClassSpells`). PURE render (state passed in).
- `class-detail-app.js` (NEW) + `templates/class-detail.hbs` (NEW): the standalone window.
- `character-creator-app.js`: its `_renderClassPreview` now **delegates** to
  `renderClassView` (9 ClassView render methods removed; cv-state/fetch/handlers kept).
- `content-service.js`: `resolveTableRefs` returns `docId` (DB id, for the import fetch) +
  class `sourceSlug`; per-kind `where`-filter support. Background/species → dedicated
  `backgrounds` / `species` tables (NOT `feats`); `@feat` scoped to standalone feats.
- `layout-blocks.js`: `refRoute` cases for `background` / `species` / `race` (clickability
  fix — see Gotchas).

## How the reference system fits together

- **Enrich** (`ref-enricher.js`, unchanged): `CONFIG.TextEditor` enrichers turn `@kind[id]`/
  `&kind[id]` (and the dnd5e `&Reference[…]` takeover) into `.dauligor-ref` links via
  `layout-blocks.refMarkup`.
- **`refRoute`** (`layout-blocks.js`): `@kind` → app URL, else `null`. **A `null` route → a
  non-clickable dangling `<span>`.** The click + drag handlers only bind `a[data-route]`, so a
  ref MUST have a route to be interactive.
- **`resolveReferences`** (`content-service.js`): `REF_KIND_TABLES` maps kind →
  `{table, idCol, summary, image?, source?, sourceSlug?, where?, nameCol?}`. Returns
  `{name, summary, image, sourceLabel, sourceSlug, docId, rule}`. System/`&` kinds resolve via
  `getSystemPage` (definition blocks first, legacy `system_page_entries` fallback).
- **On-demand import** (`ref-import.js`): `IMPORT_ENDPOINTS` maps kind → `{path, payloadKind,
  field}`. `openReferencedItem(kind,id)` → resolve docId → fetch
  `/api/module/<path>/<docId>.json` (public, via `fetchJson`) → `payload[field]` →
  `new CONFIG.Item.documentClass(data)` + `.sheet.render(true)` (temporary item).
  `registerReferenceImports()` (in `main.js` ready): `pointerover` enables `draggable` +
  prefetches; `dragstart` sets `{type:"Item", data}` from cache.
- **Click routing** (`ref-enricher.registerRefClickHandler` + `dauligor-viewer._bindRefs`):
  `&` → system view; `@article` → Library; `@class` → `openClassReference`; else if
  `isImportableKind` → `openReferencedItem` (fallback `window.open(route)`).
- **Shared ClassView** (`class-detail-view.js`): used by the creator (delegation) + the
  standalone window. The host window root must carry **`dauligor-character-creator`** for the
  ClassView CSS + tokens.

## ⏳ PENDING — #3: inline ClassView in the import wizard's class browser

Owner chose **inline** (like the creator), reusing `class-detail-view.js`. The import wizard
(`openDauligorImporter`) dispatches `classes-subclasses` → `openDauligorClassBrowser` →
**`DauligorClassBrowserApp`** (in `importer-app.js`, ~889–1700). It's a card-grid picker
(template `class-browser-shell.hbs`: `toolbar` / `list` / `footer` regions) with **no
class-detail pane** — that's what to add. Full plan (no template change needed — render the
detail INSIDE the `list` region):

1. **Import** into `importer-app.js`:
   `import { renderClassView, bindClassView, ensureSpellChart, fetchClassSpells } from "./class-detail-view.js";`
   (No cycle — `class-detail-view` doesn't import `importer-app`. Verified all modules import clean.)
2. **Constructor** (`DauligorClassBrowserApp`): add cv-state
   `this._cv = { cvTab: "features", cvSubclassId: null, cvExpanded: new Set(), cvSpells: new Map(), spellChart: null, spellChartFetched: false };`
3. **`_renderList`** (~1600): wrap the existing `<div class="dauligor-class-browser__table">…</div>`
   in a two-pane and add a detail container:
   ```
   <div class="dauligor-class-browser__split">
     <div class="dauligor-class-browser__cards">[the existing table]</div>
     <div class="dauligor-class-browser__detail dauligor-character-creator" data-region="cv-detail"></div>
   </div>
   ```
   Keep the existing `select-class` / `select-subclass` bindings (they still match via
   `this._listRegion.querySelectorAll`). At the END of `_renderList`, call `this._renderClassDetail()`.
4. **Add `_renderClassDetail()`**:
   - `detailEl = this._listRegion?.querySelector('[data-region="cv-detail"]')`; bail if none.
   - `selected = this._getSelectedClass()` (~1939); if none → detailEl = "Select a class to preview it."
   - `variant = this._getSelectedVariant(selected)` (~1943); `bundle = variant?.payload`.
   - **If no `bundle`:** show a loading spinner; `this._ensureVariantPayload(variant).then(ok => { if (ok && this._state.selectedClassSourceId === selected.classSourceId) this._renderClassDetail(); })`; call `this._ensureCvSpellChart()`; return.
     (`_ensureVariantPayload`, ~2012, populates `variant.payload` — which **IS** the semantic
     class-export bundle: top-level `class`/`subclasses`/`features`/`scalingColumns`, exactly
     what `renderClassView` consumes. No transform.)
   - `chosen = { name: selected.name, sourceSlug: selected.sourceLabel || "", img: bundle.class?.previewImageUrl || bundle.class?.imageUrl || "", bundleUrl: variant.entry.payloadUrl }`.
   - `const view = { chosen, bundle, cvTab: this._cv.cvTab, cvSubclassId: this._cv.cvSubclassId, cvExpanded: this._cv.cvExpanded, cvSpells: this._cv.cvSpells, spellChart: this._cv.spellChart, onFetchSpells: (c) => fetchClassSpells(c.bundleUrl, this._cv.cvSpells, (url) => { if (this._cv.cvTab === "spells" && this._getSelectedClass()?.classSourceId === selected.classSourceId) this._renderClassDetail(); }) };`
   - `detailEl.innerHTML = renderClassView(view); bindClassView(detailEl, this._cv, () => this._renderClassDetail());`
5. **Add `_ensureCvSpellChart()`**: `if (this._cv.spellChartFetched) return; ensureSpellChart(this._cv).then((chart) => { if (chart) this._renderClassDetail(); });`
   (`ensureSpellChart(state)` mutates `state.spellChart` + `state.spellChartFetched` — `this._cv` has both.)
6. **`_selectClass`** (~1967): when the class changes, reset cv-state
   (`this._cv.cvTab = "features"; this._cv.cvExpanded = new Set();`) and sync
   `this._cv.cvSubclassId = subclassSourceId ?? null` (so the detail reflects the chosen
   subclass). It already calls `_renderList` at the end → which calls `_renderClassDetail`.
7. **CSS** (`styles/class-browser.css`): the `__region--list` is `flex:1; overflow:auto`, so a
   `height:100%` split inside it scrolls each pane independently (low risk):
   ```
   .dauligor-class-browser__split { display: flex; height: 100%; min-height: 0; }
   .dauligor-class-browser__cards { flex: 1 1 46%; min-width: 0; overflow-y: auto; }
   .dauligor-class-browser__detail { flex: 1 1 54%; min-width: 0; overflow-y: auto; border-left: 1px solid var(--dauligor-border); }
   ```
8. **Verify**: headless — `renderClassView(view)` into a fake detail element + `importer-app.js`
   imports clean (stub-foundry harness). Live — import wizard → classes-subclasses → pick
   sources → select a class → ClassView shows inline; ensure the existing import flow (footer
   "Configure & Import") still works.

Then update `docs/cross-reference-enrichers.md` (the "Classes are special" + a note that the
import wizard now shows the inline ClassView too).

## Git state

`foundry-module` is **4 commits ahead of `origin/main`, ALL UNPUSHED**:
`a7b4e95` (docs) · `039fc88` (handoff) · `7243165` (cards+hover+spell import) ·
`f87e806` (@class window + item/feat/species/background import). `origin/main` unchanged this
session. Working tree clean.

🛑 **main = production.** ALWAYS `git fetch` + show `git log origin/main..HEAD` + **ASK before
pushing.** These commits are module/docs-only (no web-build change), but still ask.

## Live eyeball still pending (couldn't be verified headless)

- **Temp item sheet activities** (the user explicitly flagged): clicking a spell/item/feat/
  background/species ref opens a **temporary** Foundry item sheet — does **clicking into an
  activity** work "like a normal Foundry item"? Temp (unsaved, not-in-collection) items aren't
  always UUID-resolvable; if activities misbehave, the fallback is to make the preview item
  resolvable (e.g. a transient world/compendium item) WITHOUT a real import. **Not confirmed live.**
- **Drag → drop import** onto an actor sheet (native `{type:"Item", data}`). Hover the link
  first (prefetch warms the cache for the sync `dragstart`).
- **`@class`** → standalone window renders the full ClassView; **regression check:** the
  character creator's Class tab still renders after the extraction.
- **`@background[acolyte]`** etc. click → creates the item card (this session's last fix).

## Gotchas learned this session

- **A ref needs a `refRoute` to be clickable.** `null` route → non-clickable dangling `<span>`
  (hover works because the hover handler keys on `data-ref-kind`; click/drag don't because they
  bind `a[data-route]`). This was the Acolyte "resolves but no card" bug — fixed by adding
  background/species/race to `refRoute`.
- **Backgrounds/species live in dedicated `backgrounds` / `species` tables** (camelCase columns;
  see `api/_lib/_speciesBackgroundShared.ts`), **NOT `feats`** — despite the
  `functions/api/module/[[path]].ts` comments still saying "feats table". `/api/module/races/<id>`
  reads the `species` table. The `feats` table holds standalone feats + class/subclass features
  (by `feat_type`), so `@feat` filters `LOWER(COALESCE(feat_type,'feat')) = 'feat'` (case-insensitive —
  the column isn't reliably lowercase).
- **`@UUID` content-links** (Foundry-native, e.g. SRD spell→spell) open the Foundry item on click
  (Foundry's job); our hover previews them via `fromUuid`. A **dangling `@UUID` does NOT fall back
  to a website** — it just breaks. That's WHY we keep refs semantic (`@spell[slug]`) and import on
  demand, rather than baking `@UUID` at import (which would dangle for anything not pre-imported,
  defeating "reference anything on the site").
- **Drag payload is set synchronously at `dragstart`** but the item fetch is async → prefetched on
  `pointerover` into a module cache.
- **`node --check` can't catch ESM runtime errors.** Use the stubbed-foundry dynamic-import harness
  (stub `foundry`/`game`/`Hooks`/`window`/`document`/`CONFIG`, then `await import(...)`). Every
  piece this session was verified that way (delete the temp `_*.mjs` after).
- D1 compound SELECT cap = 5 terms → `resolveReferences` batches one SELECT per kind (no UNION).

## Docs updated

`docs/page-system.md` (Entity-reference resolution + the new component files) and
`docs/cross-reference-enrichers.md` (hover preview cards + on-demand import + the kinds/endpoints
table + the class special-case). Update again after #3.

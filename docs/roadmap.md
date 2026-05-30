# Roadmap

Open ideas + larger pieces of work that aren't blocking but should
land eventually. Linked from the README so notes don't get lost in
chat. Add entries below as they come up — most-recently-added at the
top so the tail of the file accrues the long-tenured stuff.

Conventions:
- Each idea is its own `## Heading` so other docs can deep-link
  (`docs/roadmap.md#systems-overview-page`).
- Cross-reference design docs under `docs/features/` rather than
  duplicating the spec here. Roadmap is just the pointer.
- Once an item ships, move it under the "Shipped" section at the
  bottom with the commit / PR / branch hash.

---

## Foundry inline-roll formulas → readable chips

**Status**: open (carried from the system-pages handoff Open items — task #7). **Size**: small.

Pasted Foundry / dnd5e content embeds inline-roll enrichers — `[[/r 1d20+5]]`,
`[[/damage 2d6 fire]]`, and the related `[[/check …]]` / `[[/save …]]` forms. Today these
render verbatim as raw `[[/…]]` text in the app reader, which is noise to a human reader.

Turn them into readable, **non-interactive** chips in the **client** renderer only:
- Parse the `[[/…]]` forms in [src/lib/bbcode.ts](../src/lib/bbcode.ts) (`bbcodeToHtml`,
  **view mode only** — leave them as plain text in editor mode, mirroring the existing `@`/`&`
  reference handling).
- Render each as a styled `.inline-roll` chip (small die glyph + the formula / flavor), with the
  selector added to [src/index.css](../src/index.css) under `@layer components` (append-only).
- **Do NOT mirror to `api/_lib/_bbcode.ts`.** The server intentionally leaves these as text for
  Foundry's own enrichers — same drift-pair rule as the `&`/`@` reference rendering. See
  [architecture/cross-references.md](architecture/cross-references.md).
- Display sugar only — no dice execution, no rolling. Just make the formula legible in-app.

Created 2026-05-29.

---

## Live-content bridge — Phase 2+ work

**Status**: Phase 1 foundation patches shipped 2026-05-27 on `claude/phase1-foundation`. Phase 2 (read-only live viewer) gated on article revamp — see "Article system unification" below. **Working spec**: [docs/_drafts/foundry-enricher-deep-dive-2026-05-26.html](_drafts/foundry-enricher-deep-dive-2026-05-26.html).

The plan: instead of baking Dauligor content into Foundry as static compendium documents, Foundry becomes a live viewer that fetches from `/api/module/*`. Solves the stale-journal problem; canonical content lives in one place forever. Drag-and-drop for mechanical content still creates real Foundry documents (the drag payload carries the full Foundry-shape JSON), but the *reference* layer (article cross-links, system pages, hover tooltips) is live-fetched and cached per-world.

**Phase 1 patches that just shipped** (this branch):
- Composite `(source_id, identifier)` uniqueness on spells, classes, subclasses, unique_option_groups was incomplete. Migration `20260527-1400_composite_identifier_uniqueness.sql` adds it for spells / classes / subclasses (matches the pattern set by feats + items in `20260526-2300`).
- Features had **zero uniqueness** on identifier. Migration `20260527-1410_features_parent_scoped_identifier.sql` adds `UNIQUE(parent_type, parent_id, identifier)` — scoped by owner since the same identifier can recur across different classes/subclasses/feats. One pre-existing duplicate (Arcane Archer subclass had a feature with the wrong identifier slug) was fixed inline.
- Added `content_hash TEXT` column to spells / feats / items / classes / subclasses / features / unique_option_groups via `20260527-1420_content_hash_columns.sql`. Population (hash-on-upsert) happens in Phase 1.5 — column is currently NULL on existing rows. Phase 4 update-detection consumes this column.
- New deterministic Foundry `_id` derivation helper at [module/dauligor-pairing/scripts/foundry-id.js](../module/dauligor-pairing/scripts/foundry-id.js). SHA-256 hash of `(MODULE_ID + ':' + sourceId)` → 16-char base62. Stable across re-imports. Async (crypto.subtle); pre-warm pattern documented for sync `dragstart` handlers.

**Phase 2 (read-only live viewer)** — next, after article revamp:
- New API endpoints under `/api/module/<source>/articles/<slug>` (full HTML) and `/articles/<slug>/summary` (hover summary, short HTML)
- `DauligorViewer` ApplicationV2 class in the module — opens when a Dauligor reference link is clicked, renders the API HTML into a Foundry window with the standard Journal chrome
- Custom enricher registration via `CONFIG.TextEditor.enrichers.push(...)` for `@article[slug]`, `@condition[key]`, `@rule[key]`, etc.
- Hover tooltips via `data-tooltip-html` populated by lazy fetch + per-session cache
- World-local cache (Foundry world `setFlag`) keyed by `kind/source/key/hash` — offline reads fall through to cache
- ✅ **"System page" article type — SHIPPED 2026-05-29** as a standalone `system_pages` + `system_page_entries` table pair (addressed by `identifier`, which doubles as the `&` ref kind — *not* the parent-article-by-slug structure first sketched here). App-side reader + admin + the `&`/`@` cross-reference resolution are live; see [architecture/cross-references.md](architecture/cross-references.md). The Foundry-side enricher/viewer for system pages remains Phase 2 work.

**Phase 3 (drag-construct mechanical items)** — relies on deterministic Foundry `_id` helper from Phase 1 above:
- Pre-fetch full Foundry-shape JSON on hover (extends Phase 2's summary fetch)
- `dragstart` reads cached payload, emits `{ type: "Item", data: <converted> }` — Foundry's drop handler does the rest
- Sentinel fallback for cache misses: `{ type: "Item", data: { _dauligorRef: "<sourceId>" } }`, resolved async via `preCreateItem` hook
- Reuses existing batch-import conversion code from `class-import-service.js` exposed as a per-item path

**Phase 4 (update detection)**:
- Batch freshness API: `POST /api/module/<source>/batch-status` with `[{ sourceId, knownHash }]` returns `[{ sourceId, isStale, currentHash }]`
- Glow icon on stale item sheets (CSS pulse on a header element when `flags.dauligor-pairing.sourceHash !== currentHash`)
- Diff modal: click icon → opt-in to re-fetch + replace, OR opt-out (stamps the current hash so glow stops until next change)

**Phase 5 (hardening)**:
- "Bake to world" snapshot button — one-way conversion of cached content into real Foundry `JournalEntry`s for offline play
- Auth model audit (currently public reads suffice; per-world API key if private content becomes a concern)
- Architecture doc under `docs/architecture/live-content-bridge.md`

Created 2026-05-27.

---

## Races + Backgrounds full implementation

**Status**: placeholder list pages + editor wrappers exist (commit `<see compendium-shell handoff>`). **No DB tables.** **No importers.** **No exports.**

The compendium browser already shows Race / Background tiles via [src/pages/compendium/RacesList.tsx](../src/pages/compendium/RacesList.tsx) and [BackgroundsList.tsx](../src/pages/compendium/BackgroundsList.tsx), and edit-wrappers exist at [RaceEditor.tsx](../src/pages/compendium/RaceEditor.tsx) / [BackgroundEditor.tsx](../src/pages/compendium/BackgroundEditor.tsx) — but they're scaffolding only. Anyone picking this up needs to deliver:

**Database**:
- `CREATE TABLE races` and `CREATE TABLE backgrounds` migrations. Schemas should mirror the existing entity-table pattern: `id`, `name`, `identifier`, `source_id`, `description`, `image_url`, `tags`, `activities`, `effects`, `advancements`, `content_hash`, plus race-/background-specific fields (race: size, speed, vision, traits; background: skill proficiencies, tool proficiencies, equipment, feature).
- **Important**: today the feat exporter already covers races + backgrounds (commit `10fa13c`) — features authored as `feat_type='race'`/`'background'` flow through the feat path. **The new `races`/`backgrounds` tables must coexist with that** until the migration cuts over, or the feat-table approach must be retired explicitly. Pick one and document the choice.
- Apply the same composite `UNIQUE(COALESCE(source_id, ''), identifier)` pattern set by `20260526-2300_feats_items_composite_identifier_uniq.sql` and `20260527-1400_composite_identifier_uniqueness.sql`.
- Add `content_hash TEXT` column to both tables (matches `20260527-1420_content_hash_columns.sql`).

**Server export**:
- New `api/_lib/_raceExport.ts` and `_backgroundExport.ts` paralleling `_featExport.ts` / `_itemExport.ts`. Both have to stamp `flags.dauligor-pairing.sourceId`, `dbId`, `entityKind`, plus type-specific extras (race subraces, background features).
- Module dispatcher in `functions/api/module/[[path]].ts` — add `/races/<dbId>.json` and `/backgrounds/<dbId>.json` routes.

**Module-side importer**:
- The existing feat / item importer pattern in `module/dauligor-pairing/scripts/` is the template. Race import should drop a `type: "race"` item with subrace handling; background import should drop a `type: "background"` item with the standard 5e starting-feature pattern.

**Editor surfaces**:
- Race-specific fields (size, speed, languages, traits) and background-specific fields (skill+tool proficiencies, equipment, feature description) in the existing editor wrappers.
- Advancement-driven proficiency grants — share the AdvancementManager already used by classes / subclasses / feats. Owner kind extends to `'race'` and `'background'` per Phase B groundwork.

**Foundry contract docs**:
- `module/dauligor-pairing/docs/race-import-contract.md` and `background-import-contract.md`. Pattern: take `feat-import-contract.md` as the template.

Created 2026-05-27.

---

## Article system unification (blocks live-content bridge Phase 2)

**Status**: open. **Should land before** [Live-content bridge Phase 2](#live-content-bridge--phase-2-work) starts.

`lore_articles` is the odd one out across Dauligor entity tables. Every other content table uses `(identifier, source_id)` as the semantic identity pair, with composite UNIQUE enforcement (per the Phase 1 patches above). `lore_articles` uses `slug + parent_id` — partitioned by hierarchy (parent article), not by source.

That's fine for the existing wiki use case but breaks down when articles need to participate in the live-content bridge:

- **`@article[slug]` references** — what scope does the slug live in? Currently global (since `slug` is per-row, no namespacing). If two campaigns ship articles named "Deep Shadow Cult," they collide. Need either source-scoping (`@article[deep-shadow-cult]{slug + source}`) or world-scoping.
- ~~**"System page" article type**~~ — ✅ **resolved independently 2026-05-29.** System pages shipped as their own `system_pages` + `system_page_entries` tables (each with its own `identifier`), so they never needed `lore_articles`' `parent_id` hierarchy. This item no longer blocks them; see [architecture/cross-references.md](architecture/cross-references.md). (Article unification is still wanted for `@article[…]` namespacing + the module deep-link URL below.)
- **Module deep-link URL** — Foundry-side `DauligorViewer` needs to compose `https://www.dauligor.com/wiki/<something>` for "open in app." Today's wiki uses slug-based URLs but the slug isn't guaranteed unique outside its parent.

**Recommended path**:
1. Add `identifier TEXT NOT NULL DEFAULT ''` column to `lore_articles`, backfilled from `slug` on existing rows.
2. Add `source_id TEXT REFERENCES sources(id)` for source-scoping (optional — could also scope by `world_id` once worlds ship).
3. Add `UNIQUE(COALESCE(source_id, ''), identifier)` once duplicates are resolved.
4. Add `content_hash TEXT` (Phase 4 update detection — articles update frequently).
5. Update [src/pages/wiki/Wiki.tsx](../src/pages/wiki/Wiki.tsx) to route by identifier rather than slug.
6. Update BBCode parser (`src/lib/bbcode.ts`) to compile `@article[…]` to identifier-based hrefs.

Created 2026-05-27.

---

## Scaling columns for non-class owners — follow-ups

The first slices of the "advancements outside classes" track shipped on `feat/scaling-non-class-owners` (commits `f1e4f6b` … `10fa13c`). What's still open:

### Phase B.2 — Item Foundry export endpoint (app → Foundry)
**Status**: app-side shipped on `<commit>` · module-side companion open

Races + backgrounds were always covered by the feat-export path (commit `10fa13c`) since they're stored as feats with `feat_type='race'`/`'background'`. The feat exporter maps that to `parent_type` correctly. ✅

**What shipped**:
- New `api/_lib/_itemExport.ts` paralleling `_featExport.ts`. Builds the full Foundry-ready item document with per-`item_type` system blocks (weapon / equipment / consumable / tool / container / loot). Common fields (description, weight, price, properties, rarity, attunement, equipped, identified, uses, activities, effects, source) emit for every type; type-specific extras (damage / armor / tool / capacity / etc.) layer on top via `buildTypeSpecificSystem()`.
- Synthesizes one `ScaleValue` advancement per `scaling_columns` row owned by the item (`parent_type='item'`). Stub advancements run through the shared `normalizeScaleValueAdvancement` helper from `_classExport.ts` to fill in `scale` / `identifier` / `type` / `distance`. Advancement `_id` derived from the column's UUID (hyphens stripped, 16-char) for round-trip stability.
- New `/api/module/items/<dbId>.json` route in `functions/api/module/[[path]].ts`, mirroring the spell / feat detail endpoints.
- Items flow round-trip with scaling: author column in app → server endpoint emits ScaleValue → Foundry's dnd5e resolves `@scale.<item.identifier>.<column.identifier>` natively at play time.

**What's still open**:
- Module-side companion: an item importer in Foundry that consumes `/api/module/items/<dbId>.json` and embeds the document. Pattern is established by the feat importer in `module/dauligor-pairing/scripts/`. Until a module-side consumer ships, the app-side endpoint is verifiable only by URL inspection (see [verification doc § F'](verification-scaling-non-class-owners.md#f-item-server-export-endpoint-phase-b2-items--forward-direction)).
- Canonical contract clarification in `item-import-contract.md` to acknowledge advancements as a valid field. Owner-gated per `dauligor-guardian`.

### Phase B.3 — Importer side: ScaleValue → `scaling_columns` rows
**Status**: shipped for feats + items on `<commit>` and `<followup-commit>` · **Priority**: complete for in-scope owners

Foundry → app reverse direction.

- **Feats** (covers races + backgrounds, since they share the feats table): when a feat lands in `FeatImportWorkbench` with `ScaleValue` advancements, the importer extracts each one into a `scaling_columns` row owned by the imported entity and patches the advancement's `configuration.scalingColumnId` to link to that row. FeatsEditor's "Feat Columns" / "Race Columns" / "Background Columns" panel shows the imported scaling immediately, and re-exports through `normalizeScaleValueAdvancement` rebuild the same scale map.

- **Items**: same flow in `ItemImportWorkbench`. `sourceDocument.system.advancement` is preserved by the canonical folder-export contract (the "intentionally omitted" line in `item-folder-export-contract.md` § "What's intentionally not in the entry" applies only to the slim `itemSummary` projection — the full doc round-trips). The importer pulls advancements off `sourceDocument`, walks ScaleValue entries, persists them as `scaling_columns` rows with `parent_type='item'`. The items table itself doesn't grow an `advancements` column — advancements aren't authored on items app-side; scaling columns are the canonical surface.

Touches: [src/lib/scalingImport.ts](../src/lib/scalingImport.ts) (shared helper) + [src/components/compendium/FeatImportWorkbench.tsx](../src/components/compendium/FeatImportWorkbench.tsx) + [src/components/compendium/ItemImportWorkbench.tsx](../src/components/compendium/ItemImportWorkbench.tsx).

### Phase B.4 — Module canonical contract updates
**Status**: core three shipped (May 2026) · stale wider corpus still open · **Priority**: low

The three core contract docs received owner-scope clarifying notes
acknowledging non-class scaling owners + the new `ItemBumpUses`
advancement type:

- ✅ [module/dauligor-pairing/docs/class-import-contract.md](../module/dauligor-pairing/docs/class-import-contract.md) — `ScaleValue` section gained an owner-scope callout
- ✅ [module/dauligor-pairing/docs/advancement-construction-guide.md](../module/dauligor-pairing/docs/advancement-construction-guide.md) — `ScaleValue` section + Pitfall 1 reframed; new `ItemBumpUses` section added
- ✅ [module/dauligor-pairing/docs/schema-crosswalk.md](../module/dauligor-pairing/docs/schema-crosswalk.md) — owner-scope callout in "Scaling Value Advancements"; new "ItemBumpUses" section appended

The fourth doc the original list named (`class-feature-activity-contract.md`)
no longer references `ScaleValue` directly — that pointer was stale
and the doc needs no edit.

Remaining: a sweep across the wider module-doc corpus (eight other docs
still use class-only language for scaling — see [followups-advancements-outside-classes.md § 1.4](followups-advancements-outside-classes.md#14-stale-module-doc-refs)).

### Phase C — `ItemBumpUses` advancement type
**Status**: v1 end-to-end shipped on `feat/itembumpuses-advancement` (authoring + CharacterBuilder runtime + Foundry actor export) · feat-authored bumps on server export + items as authors still open · **Pick-up doc**: [handoff-phase-c-itembumpuses.md](handoff-phase-c-itembumpuses.md)

A separate advancement type that lets a feat or item upgrade an existing feature on a character — bumping its `uses.max` is the first mode. Design call: separate type (not a flag on `ItemGrant`), per [the design call in this conversation](handoff-scaling-non-class-owners.md#phase-c-design-decisions).

**What shipped (Phase C v1 — end-to-end)**:
- New `'ItemBumpUses'` entry in [src/components/compendium/AdvancementManager.tsx](../src/components/compendium/AdvancementManager.tsx)'s `AdvancementType` union, plus a `Plus`-iconed teal entry in `ADVANCEMENT_INFO` and a compact list-row subtitle string.
- New default-configuration + normalizer branch in [src/lib/advancementState.ts](../src/lib/advancementState.ts): `{ target: { kind: 'feature'|'feat', id } | null, amount: string }`. Kind is restricted to `feature` / `feat`; everything else is coerced to `null`.
- Editor UI block in AdvancementManager: kind picker (Class Feature / Feat) + `SingleSelectSearch` bound to `availableFeatures` / `availableFeats`, plus a formula input for the bump amount. Includes a help card explaining bake-time resolution + the target-not-found warning behavior.
- Shared resolver `collectItemBumpUses` in [src/lib/characterLogic.ts](../src/lib/characterLogic.ts) — walks class / subclass / feature / feat advancements, gates by effective level, produces `{ bumps: Record<key, ItemBumpEntry[]>, warnings: ItemBumpWarning[] }`. `combineUsesMaxWithBumps` stitches multiple bumps onto a base `uses.max` formula with normalized signs.
- Character builder runtime: a new effect in [CharacterBuilder.tsx](../src/pages/characters/CharacterBuilder.tsx) derives `character.derivedItemBumpUses` from the walker. New warnings toast (deduped via a ref-tracked seen set) so authors can pass orphan info to their DM.
- Foundry actor export: [characterShared.ts](../src/lib/characterShared.ts) fetches feature rows, calls the same walker, and bakes the bumps into each feature item's `system.uses.max`. Per-item `flags['dauligor-pairing'].itemBumpUses` and a top-level `actor.flags['dauligor-pairing'].itemBumpUses` audit trail let the module side surface "where did this bump come from" without re-walking.
- Verification covered in [§ J of verification-scaling-non-class-owners.md](verification-scaling-non-class-owners.md#j-itembumpuses-end-to-end-phase-c-v1).

**What's still open**: All v1 surfaces shipped — the remaining items (feat-authored bumps in server export, item-authored bumps in the character runtime, future advancement modes, module-side consumers) are cataloged in [docs/followups-advancements-outside-classes.md](followups-advancements-outside-classes.md). Focus shifted back to feats / editors code clarity on 2026-05-27.

Created 2026-05-27. v1 end-to-end shipped on `feat/itembumpuses-advancement` (commits `fe71fdd` authoring + `656d96c` walker + `e709888` builder runtime + `960a99d` export + items-as-authors follow-up).

---

## Systems overview page

A first-class "Systems" page in the app (probably `/docs` or
`/systems`) that surfaces a curated, modular list of the major
systems the app exposes: Worlds, Permissions / Content Proposals,
Tags + Filters, Spell Rules, Sources, Class Spell Lists, Modular
Options, Compendium, Lore Wiki, Foundry Export, etc.

Each entry is a **modular section** — independently authored,
independently linkable — that:

- States what the system does in one paragraph.
- Lists the entry-point pages + their roles (browse, edit, admin).
- Calls out the permission model (who can read, who can write, who
  can propose).
- Links to the canonical spec under `docs/features/` and to the
  rendered editor / browser pages.

Why this matters:
- New contributors should be able to scan one page and see what the
  app contains, instead of stitching it together from `docs/` and
  the sidebar.
- The README + per-feature docs can deep-link into specific
  sections (e.g. README's quick-start could link to "Permissions /
  Content Proposals" without copying the whole explanation).
- It's also the natural home for an embedded "what's coming"
  callout per system, so this roadmap stays the index and the
  Systems page does the rendered tour.

Status: not started. Owner: TBD. Created 2026-05-19.

---

## Shipped

_Move shipped items here with a one-line link to the commit / PR
once the bullet above is no longer relevant._

### System page article type + `&`/`@` cross-reference resolution — 2026-05-29
Site-consistent glossary pages (`system_pages` + `system_page_entries`, migration
`20260529-1500`, local + remote) that `&` rule references resolve into, plus the `@`/`&`
cross-reference layer (page-level `&kind[]`, Foundry `&Reference[…]`, name-slug aliases,
hover + autocomplete). Commits `8989bd1` + `1ecbf0a` on `main`. Reference doc:
[architecture/cross-references.md](architecture/cross-references.md); handoff:
[../handoffs/system-applications/2026-05-29-system-pages.md](../handoffs/system-applications/2026-05-29-system-pages.md).

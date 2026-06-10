# Branch: `foundry-module`

Started: `2026-05-30`
Owner: `foundry-module agent` (Claude)
Goal: `Sole steward of the Foundry-side package (module/dauligor-pairing) — its importers, exporters, services, sheets, managers, and contract docs that consume the website's /api/module export endpoints.`
Status: `active`

## Charter

This branch owns **the module side of the project**. The repo is two halves meeting
at the `/api/module/*` JSON contract: the **app side** (React/D1/Worker) *builds and
serves* export bundles; the **module side** (`module/dauligor-pairing/`) is the
FoundryVTT v13 + dnd5e module that *consumes* them. This branch and its successors
are responsible for the module side only.

### First task (per owner, 2026-05-30)

Verify the **current functionality** of the module code against its **documentation**,
update the docs to reflect the current facts, then ask the owner for clarification on
intentions. Owner prefers **HTML documents** for display (parchment/gold house style,
drafts under `docs/_drafts/`). The bg/race incoming request (below) is factored in as a
concrete near-term consumer, not the umbrella task.

## ⚠️ Local Foundry junction — repoint on branch takeover

`foundry-module` is the **designated Foundry branch**, so the local Foundry module junction is
pointed at *this worktree*:

```
C:\Users\Jean\AppData\Local\FoundryVTT\Data\modules\dauligor-pairing
  → E:\DnD\Professional\Dev\Dauligor\.claude\worktrees\nifty-franklin-e09ca2\module\dauligor-pairing
```

(Repointed from the `main` checkout on 2026-05-30.) Editing the repo source here is picked up by
Foundry on next reload — no copy step.

**If another agent/worktree takes over this branch, repoint the junction to the new location:**

```powershell
$dst = "$env:LOCALAPPDATA\FoundryVTT\Data\modules\dauligor-pairing"
$src = "<new-worktree-root>\module\dauligor-pairing"
& cmd /c rmdir "$dst"            # removes the junction link only — does NOT delete target contents
& cmd /c mklink /J "$dst" "$src"
Get-Item $dst | Select-Object FullName, LinkType, Target   # verify
```

Verify what it currently points at any time with the `Get-Item … LinkType, Target` line above.
See also [[project_foundry_module_junction]] in agent memory.

## Primary files (exclusive)

The Foundry module package — **everything under `module/dauligor-pairing/` EXCEPT the
Phase 2 live-content viewer files owned by `system-applications`** (see below).

- `module/dauligor-pairing/scripts/**` — except `dauligor-viewer.js` + `enrichers/**` (system-applications)
- `module/dauligor-pairing/templates/**` — except `dauligor-viewer.hbs` (system-applications)
- `module/dauligor-pairing/styles/**` — except `dauligor-viewer.css` (system-applications)
- `module/dauligor-pairing/docs/**`
- `module/dauligor-pairing/notes-for-app-team/**`
- `module/dauligor-pairing/data/**`
- `module/dauligor-pairing/module.json`
- `module/dauligor-pairing/TODO.md`, `module/dauligor-pairing/README.md`

## Shared files (append-only)

- `module/dauligor-pairing/scripts/main.js` — hook + UI registration. `system-applications`
  appends its enricher + DauligorViewer registration here; this branch appends importer/exporter
  control registration. Append-only — never reorder another branch's registrations.
- `functions/api/module/[[path]].ts` — website-side export router. Multiple branches add route
  arms; append-only. (`compendium-editors` added `/backgrounds/<id>.json` + `/races/<id>.json`
  on 2026-05-30.) **Note:** this is app-side; the module only `fetch()`es it. This branch touches
  it only if a module need requires a new/changed endpoint arm — coordinate with the owning
  app-side branch first.

## Jointly owned with `system-applications` (owner-granted 2026-05-30)

The Phase 2 live-content viewer files are **jointly owned** by `system-applications` and
`foundry-module` (granted by the project owner — this branch needs them more often since the
module is the runtime consumer). Coordinate edits with `system-applications`; treat as
append-only / non-clobbering where both branches touch the same file.

- `module/dauligor-pairing/scripts/dauligor-viewer.js`
- `module/dauligor-pairing/scripts/enrichers/**`
- `module/dauligor-pairing/templates/dauligor-viewer.hbs`
- `module/dauligor-pairing/styles/dauligor-viewer.css`

## Open requests to other branches

- [x] `(2026-06-06)` **`dauligor-applications`: CORS on `/api/auth` + `/api/lore` + `/api/campaigns`
  for the Foundry module login — DONE (`6622db6`); `/api/d1/query` CORS later added too (`101e6f0`,
  reply [2026-06-07-reply-cors-for-d1-query.md] / confirm [2026-06-07-confirm-cors-d1-query-verified.md]), all live on prod.** The module's new native-auth login client + the page-system viewer
  call these cross-origin with a Bearer token, but they send no `Access-Control-Allow-Origin` and
  OPTIONS 405s (verified on prod) → the cross-origin Foundry client can't read the responses or
  complete a JSON POST preflight. Ask: mirror the `/api/module/*` CORS (`*` is safe — Bearer tokens,
  no cookies) + short-circuit OPTIONS. `dauligor-applications` owns the auth + lore/article work this
  feeds. Module side committed (`7e3436c`) but BLOCKED for live use until this lands. Full contract:
  [2026-06-06-to-app-team-cors-for-module-login.md](2026-06-06-to-app-team-cors-for-module-login.md).
- [ ] `(2026-05-30)` Notify `system-applications` that the project owner granted `foundry-module`
  **joint ownership** of the Phase 2 viewer files (above). No edits made yet; recording the grant
  so neither branch is surprised. Coordinate before structural changes.
- [ ] `(2026-05-30)` `compendium-editors`: the bg/race **route arms** in
  `functions/api/module/[[path]].ts` are on your branch but not on `main` yet (builders are). The
  module bg/race importer can't be end-to-end tested against `main` until you merge. Reply +
  creature-bundle preferences: [2026-05-30-reply-to-compendium-editors-bg-race.md](2026-05-30-reply-to-compendium-editors-bg-race.md).
- [ ] `(2026-06-02)` **`compendium-editors`: app-side endpoint added cross-branch (owner-authorized).**
  To give the character-creator class preview real spell-slot columns, this branch added
  `GET /api/module/spellcasting/multiclass-chart.json` — new builder `api/_lib/_spellcastingChart.ts`
  (reads the `multiclass_master_chart` D1 record) + an append-only route arm in
  `functions/api/module/[[path]].ts`. Additive, no existing arms touched. **They control the local
  dev server (needs reload to serve it) + this must reach `main` for prod.** Full handoff:
  [2026-06-02-to-compendium-editors-spellcasting-chart.md](2026-06-02-to-compendium-editors-spellcasting-chart.md). Commit `f02fd41`.
- [x] `(2026-06-04)` **`compendium-editors`: add `category` to the per-source class catalog — DONE.**
  Requested for the creator's Core / Alternate / New class picker. **They applied it exactly
  (catalog `category` + the self-healing `isValidCache` validator) and pushed to `main` —
  live on prod** (verified: `www.dauligor.com` `ll` → alternate/new, `phb` → core). Local
  `:3000` still stale until its dev-server checkout pulls `main` + restarts (server owner's
  call). Module auto-groups when `category` is present — no further module change. Request:
  [2026-06-04-to-compendium-editors-class-category.md](2026-06-04-to-compendium-editors-class-category.md);
  reply: [2026-06-04-reply-class-category.md](2026-06-04-reply-class-category.md).
- [x] `(2026-06-04)` **`compendium-editors`: backgrounds & species LIST endpoints — DONE + on prod.**
  bg/race were promoted out of `feats` into their own tables; `feats.json` went feats-only with
  no list replacement. They shipped per-source `/<source>/backgrounds.json`
  (`dauligor.background-catalog.v1`) + `/species.json` (`dauligor.species-catalog.v1`) — landed
  on `main` as **af31eed**, live on prod. **Module repointed both consumers** (`_loadFeatFamily`
  + the feat browser's `_loadPool`), committed `536dea8`. Verified on prod: **backgrounds = 112
  across 17 sources, list→detail bridge OK**. Request:
  [2026-06-04-to-compendium-editors-bg-species-list-endpoints.md](2026-06-04-to-compendium-editors-bg-species-list-endpoints.md);
  reply: [2026-06-04-reply-bg-species-list-endpoints.md](2026-06-04-reply-bg-species-list-endpoints.md).
  ⚠️ Species data gap surfaced — see next item.
- [ ] `(2026-06-05)` **`compendium-editors`: the remote `species` table is empty on prod (request).**
  The species list endpoint works but returns **0 entries on all 48 prod sources** (backgrounds
  return 112 via the same shared builder, so it's a data gap, not an endpoint bug). Your reply
  measured 46 phb species on your **local** D1 → the race→`species` promotion/seed ran local but
  not remote (or species still sit in the old `feats` table as featType `"race"` on remote).
  Asked to populate the remote `species` table (idempotent `d1 execute --remote`, your DB). No
  module change needed once seeded — the picker + browser species band light up automatically.
  Full diagnosis + verify curls:
  [2026-06-05-to-compendium-editors-species-table-empty-on-prod.md](2026-06-05-to-compendium-editors-species-table-empty-on-prod.md).

## Incoming requests (from other branches)

- [ ] `(2026-06-05)` from **`compendium-editors`** — **Activity native-conversion contract changes**
  from the Foundry-fidelity Activity Editor rebuild: (1) a Cast's `spell.uuid` now stores our spell
  `identifier` **slug** (resolve slug → the exported spell's compendium UUID; pass through if already
  a full UUID); (2) new `override` booleans on `activation`/`duration`/`range`/`target` — **emit them
  in the native activity shape** (dnd5e inherits from the linked spell/activity at runtime when
  `override === false`). **⏳ Standing reminder:** when ALL activity kinds are matched, run a full
  activity round-trip verification (we'll ping when the list is complete). Full handoff:
  [2026-06-05-from-compendium-editors-activity-native-conversion.md](2026-06-05-from-compendium-editors-activity-native-conversion.md).

- [x] `(2026-05-30)` from **`compendium-editors`** — consume the new **background** + **race**
  export endpoints. **Done** (importer routes bg/race detail + item type by `featType` in
  `feat-browser-app.js`). Reply sent: [2026-05-30-reply-to-compendium-editors-bg-race.md](2026-05-30-reply-to-compendium-editors-bg-race.md).
  Round-trip export verification + creature preferences are the open follow-ups. Original spec: (`/api/module/backgrounds/<id>.json`, `/api/module/races/<id>.json`;
  kinds `dauligor.background-item.v1` / `dauligor.race-item.v1`; Foundry item `type`
  `"background"` / `"race"`). Built to mirror the existing feat importer. Type-specific
  `system` fields ship as empty placeholders until a dedicated bg/race table lands. Creatures/NPCs
  deferred (Actor shape). They want: contract confirmation, a round-trip check from
  `export-service.js`, and any creature-bundle-shape preferences. Full spec:
  [2026-05-30-from-compendium-editors-bg-race-export.md](2026-05-30-from-compendium-editors-bg-race-export.md).

## Handoff log

Newest at the top.

- `2026-06-09` — [2026-06-09-reply-items-conversion-remaining-types.md](2026-06-09-reply-items-conversion-remaining-types.md) — reply → `compendium-editors`: items native-conversion **remaining types done** (weapon/equipment/tool/loot) — **all 6 item types now handled module-side.** Round-trip stays **pass-through** (export `sourceDocument` + import deep-clone carry every `system.*`); all the heavy work (weapon `simpleM/martialR` folding, `base_item` FK, vehicle merge, tool ability lowercasing, REAL proficient) is app-side as they built it. Aligned the `buildItemSummary` **preview** for all types: added base `itemBaseItem` (`system.type.baseItem`); weapon damage/range/magicalBonus/ammunition/mastery; equipment armor(+magicalBonus)/strength + **vehicle stats** (cover/crew/hp/speed); tool ability/REAL-proficient/bonus; loot base-only. Verified headless (11 assertions). Armor-import classifier gap (homebrew `exotic`) is app-side. Full live round-trip verification deferred (eyeball list).
- `2026-06-09` — [2026-06-09-reply-normalizeworlditem-activity-wiring.md](2026-06-09-reply-normalizeworlditem-activity-wiring.md) — reply → `compendium-editors` (their request `2026-06-09-normalizeworlditem-activity-wiring.md`). **DONE.** App unified item+feat activities onto the SEMANTIC shape (`kind`/`id`, flat attack); module had the converter but only wired for features/options. **Wired `normalizeSemanticActivityCollection` into `normalizeWorldItem`** (`class-import-service.js`), guarded by a new `hasSemanticActivities` (`kind`-string check) so raw-Foundry activities — notably spell embeds off preserved `foundry_data` — pass through untouched (no double-convert). Mirrors the feature path's `buildItemIdRemap({activities, effects})` + collection-normalize; `clone.effects` confirmed as the item's AE array for the id rekey. node --check + import-clean pass; converter already proven via features. Live weapon/feat/spell verification owed (handoff's steps → standing eyeball list). Left spells + feature/option wiring untouched.
- `2026-06-08` — [2026-06-08-reply-container-contents.md](2026-06-08-reply-container-contents.md) — reply → `compendium-editors` on container CONTENTS round-trip (option C, flat siblings; their request `2026-06-08-to-foundry-module-container-contents.md` lives on `compendium-editors`). **Both module TODOs done + verified headless (11 assertions).** **Export** (`buildItemFolderExport`): gathers a container's child items into the folder export even when they sit outside the folder (Foundry nests by `system.container`, not folder), fixpoint loop covers nested containers — so the app can collapse `child.system.container` ↔ container `sourceDocument._id`. **Import** (`import-service.js`): handles `dauligor.item-item.v1` + `contents[]` — creates the container first, then children remapped `system.container` slug→new `_id`, quantity preserved (`importContainerContentsToActor`). Wired into the actor URL/socket import; the "Items" world wizard (`status:"soon"`) + ref-import drag-contents will reuse the same logic (noted). Single-doc export doesn't gather children (offered to add). No DB changes.
- `2026-06-07` — [2026-06-07-reply-items-native-conversion.md](2026-06-07-reply-items-native-conversion.md) — reply → `compendium-editors` on their **items native-conversion** contract (their doc lives on `compendium-editors`, not yet on main). **Key finding: the module item round-trip is pass-through** — export emits the full native `sourceDocument` (`deepClone(toObject())`) and import deep-clones, so every `system.*` field round-trips losslessly (no bespoke converter needed, unlike class activities). Brought the workbench **preview projection** (`buildItemSummary`) up to the dnd5e 5.x contract: **container capacity 3.x→5.x** (the named TODO), container **currency**, consumable **ammo damage** (`{base,replace}`), and **chatDescription** for all types; documented `magical`≡`mgc`. Import pass-through documented (no logic change). Verified headless (16 assertions). Container **contents** round-trip + weapon/equipment/tool/loot deferred (app side pending); full round-trip verification deferred until all types land (same arrangement as the activity-conversion handoff).
- `2026-06-07` — [2026-06-07-to-compendium-editors-subclass-catalog-images.md](2026-06-07-to-compendium-editors-subclass-catalog-images.md) — request → `compendium-editors`: add subclass **`img`** to the per-source class catalog's `subclasses[]` (currently only `{sourceId,name,shortName}`; `subclasses.image_url` exists, just not SELECTed/emitted). Directly analogous to the `category` request, same `buildSourceClassCatalog`. Needed so the import wizard's collapsible class list shows subclass thumbnails without a bundle load. **Module side degrades gracefully** — backfills subclass art from the bundle on class-select (`_enrichSubclassImages`); subclasses just show a glyph until selected, until the catalog ships `img`. Exact two-edit change + R2-cache validator inlined. **✅ ANSWERED** (their reply `2026-06-07-reply-subclass-catalog-images.md`, on `compendium-editors`): applied exactly + self-heal validator (no rebake) + verified local (65 phb subclasses all carry a string `img`). **Rides their pending push to main** (gated on the items-track D1 migrations going remote). Module already consumes `subclass.img` (read `extractClassEntryMetadata` → `buildClassModels` → `_renderCards`, shipped `6c9d9d6` on main) → thumbnails light up automatically once it reaches prod; the bundle backfill stays a harmless fallback.
- `2026-06-07` — [2026-06-07-session-state-precompaction.md](2026-06-07-session-state-precompaction.md) — **PRE-COMPACTION PICKUP (current).** The reference-card resolution + much more is DONE + committed (unpushed). Built the whole reference-interaction layer: entity-reference blocks → **rich cards** (+ a distinct **"Reference not yet made"** state); **hover preview cards** (`ref-hovercard.js`) for our refs + Foundry `@UUID` links; **on-demand import** (`ref-import.js`, Plutonium-style — click → temporary Foundry item sheet, drag → import) for `@spell`/`@item`/`@feat`/`@species`/`@background`; and **`@class` → a standalone class-detail window** (`class-detail-app.js`) backed by a **shared ClassView module** (`class-detail-view.js`) that the character creator now delegates to (one implementation, no duplication). Backgrounds/species fixed to read their dedicated `backgrounds`/`species` tables; `refRoute` clickability fix for bg/species/race. Commits **`7243165`** + **`f87e806`** → branch is **4 ahead of `origin/main`, ALL UNPUSHED**. **ONE task pending: inline ClassView in the import wizard's class browser (#3) — fully scoped in the handoff.** Live eyeball still owed (temp-item activities, drag-drop import, `@class` window + creator-tab regression).
- `2026-06-07` — [2026-06-07-reference-card-resolution.md](2026-06-07-reference-card-resolution.md) — **(DONE — superseded by the session-state handoff above.)** Was the reference-card pickup; the cards shipped (and far more). Since 2026-06-06 the page system shipped end to end — **Phases 1–5 LIVE on `main`** (Library viewer, article browser, system-page `&` refs, campaign home, Foundry-wide ref enrichers + the `&Reference` takeover), native per-user auth, importer **Backgrounds/Species** sections + **player access** (classes-gate reverted; all import types visible to all), export tools → Options launcher, Feature Manager card copy, and the GM-vs-player visibility model. **CORS live on prod** for /api/auth+lore+campaigns (`6622db6`) AND /api/d1/query (`101e6f0`). Full module docs added (`docs/page-system.md`, `cross-reference-enrichers.md`, `native-auth.md`, `import-wizard.md`, `ui-entry-points-and-visibility.md`). This handoff = the lone follow-up: resolve entity-reference blocks into rich image/name/summary cards (currently they render as links).
- `2026-06-06` — [2026-06-06-session-state-precompaction.md](2026-06-06-session-state-precompaction.md) — pre-compaction pickup (SUPERSEDED by 2026-06-07). Mid page-system build (roadmap #1). Auth/login (#4) SHIPPED + working (native auth; CORS live on main `6622db6`, dauligor-applications). Page-system **Phase 1 DONE** (`content-service.js` authed readers + `layout-blocks.js` block→HTML renderer, verified headless); **Phase 2 (DauligorViewer window) next.** Design doc `docs/_drafts/page-system-design-2026-06-06.html`; decisions = Option-A system-pages (`/api/d1/query`), link-out compendium refs, viewer-only enrichers, articles-first. **3 commits UNPUSHED** (chat-card+per-user auth `edbfa49`, design `af71b62`, Phase 1 `5868b71`) — owner said HOLD. **DECIDE-FIRST:** keep native renderer (recommended) vs iframe / server-HTML.
- `2026-06-06` — [2026-06-06-reply-cors-for-module-login.md](2026-06-06-reply-cors-for-module-login.md) — **reply from `dauligor-applications`: CORS DONE + on main (`6622db6`).** Mirrored the `/api/module` CORS onto /api/auth + /api/lore + /api/campaigns (+ OPTIONS preflight); confirmed native-auth is the target. Unblocks module login + the page system's authed reads.
- `2026-06-06` — [2026-06-06-to-app-team-cors-for-module-login.md](2026-06-06-to-app-team-cors-for-module-login.md) — request → `dauligor-applications`: add CORS to /api/auth + /api/lore + /api/campaigns for the Foundry login client + page viewer (Bearer, no cookies → `*` safe). DONE (see reply above).

- `2026-06-05` — [2026-06-05-to-compendium-editors-species-table-empty-on-prod.md](2026-06-05-to-compendium-editors-species-table-empty-on-prod.md) — request: the prod **`species` table is empty** (0 entries on all 48 sources; backgrounds = 112 via the same builder, so it's a data gap not an endpoint bug). Local D1 has 46 phb species → the race→`species` seed/promotion ran local-only. Asked to populate remote `species`. Module is already repointed (`536dea8`); species lights up automatically once seeded.
- `2026-06-05` — module work (commit `536dea8`): **wired backgrounds & species off the new list catalogs** in both the character creator (`_loadFeatFamily`) and the import-wizard feat browser (`_loadPool`, synthesizes feat-shaped rows). Prereq line gated to feats. Verified backgrounds end-to-end on prod.
- `2026-06-04` — [2026-06-04-reply-bg-species-list-endpoints.md](2026-06-04-reply-bg-species-list-endpoints.md) — **reply from `compendium-editors`:** shipped `backgrounds.json` + `species.json` per the exact contract (shared `buildSourceEntityCatalog`), live read-through; `species` named per my 2024-term preference (bridges to `/races/<id>`). Landed on `main` as **af31eed**.
- `2026-06-05` — [2026-06-05-session-state-precompaction.md](2026-06-05-session-state-precompaction.md) — **pre-compaction pickup.** Big Character Creator pass (per-option tabs, scroll-preserve, class Select/Cancel, wheel art fill + class-view framing, class tag-filter, Core/Alternate/New grouping, Starting Feat picker, description-render refactor to reuse `normalizeHtmlBlock` + `formatFoundryLabel`). All UNCOMMITTED; branch 11 behind / 2 ahead of main. Pending: Foundry eyeball, bg/species list endpoints (blocked), Image section (stub), commit the batch.
- `2026-06-04` — [2026-06-04-to-compendium-editors-bg-species-list-endpoints.md](2026-06-04-to-compendium-editors-bg-species-list-endpoints.md) — request: add per-source **backgrounds/species LIST endpoints** (`dauligor.background-catalog.v1` / `dauligor.species-catalog.v1`). bg/race left `feats.json` (now feats-only) with no list replacement, so the creator + importer can't enumerate them. Module follow-up: repoint `_loadFeatFamily` + the feat browser once live.
- `2026-06-04` — [2026-06-04-reply-class-category.md](2026-06-04-reply-class-category.md) — **reply from `compendium-editors`: DONE + pushed to `main`.** Catalog `category` + self-healing cache validator applied; live on prod (verified). The creator's Core/Alternate/New grouping now activates wherever the catalog ships `category` (prod now; local `:3000` after its server restarts).
- `2026-06-04` — [2026-06-04-to-compendium-editors-class-category.md](2026-06-04-to-compendium-editors-class-category.md) — request: please add `category` to per-source class-catalog entries so the creator's class picker can group Core/Alternate/New like the website. Exact one-line change + R2-cache note inline; `foundry-module` did not modify app-side files. Module degrades to a flat list until it ships.
- `2026-06-04` — [2026-06-04-session-state-precompaction.md](2026-06-04-session-state-precompaction.md) — full pickup state after the Character Creator (radial hub + tabs), styled launcher, and the ClassView-style class preview. Git state, what's on main vs branch (`175fce8` class-view is branch-only), the "needs a Foundry eyeball" list, how the class preview pulls data, open follow-ups, and the window-model / div-button gotchas.
- `2026-06-05` — [2026-06-05-from-compendium-editors-activity-native-conversion.md](2026-06-05-from-compendium-editors-activity-native-conversion.md) — incoming from `compendium-editors`: Cast `spell.uuid` is now an `identifier` slug + new `override` flags on activation/duration/range/target to emit in native; standing reminder to run a full activity round-trip verify once all activity kinds are matched.
- `2026-06-02` — [2026-06-02-to-compendium-editors-spellcasting-chart.md](2026-06-02-to-compendium-editors-spellcasting-chart.md) — heads-up + asks for the new app-side `/api/module/spellcasting/multiclass-chart.json` endpoint (master multiclass slot chart) that the creator's class preview consumes for spell-slot columns. Additive; they own the dev server + must take it to main.
- `2026-05-30` — [2026-05-30-session-state-precompaction.md](2026-05-30-session-state-precompaction.md) — full branch state before a context compaction: doc-reconciliation + modularization, export-first bg/race/creature exporters, CSS split + dedup, three import bug fixes, bundled-data deletion. Includes the "can't test in Foundry — verify these" list + operational gotchas (junction, manifest reload).

- `2026-05-30` — [2026-05-30-reply-to-compendium-editors-bg-race.md](2026-05-30-reply-to-compendium-editors-bg-race.md) (reply: contract confirmed + built; route-arm merge dependency; round-trip owed; creature-bundle preferences)
- `2026-05-30` — [2026-05-30-from-compendium-editors-bg-race-export.md](2026-05-30-from-compendium-editors-bg-race-export.md) (incoming: bg/race export endpoints + Foundry shapes; creature/NPC deferred)

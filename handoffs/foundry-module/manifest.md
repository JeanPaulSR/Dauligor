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

- [ ] `(2026-06-12)` **`compendium-editors`: enchantment DAMAGE authoring → native `system.damage.parts` (request).**
  Crimson Offering's enchant damage is inert by construction: `system.bonuses.mwak/rwak.damage` are ACTOR
  fields (read at dnd5e.mjs:12551) but enchantments apply to the ITEM (23304). The native mechanism is the
  enchantment-only `system.damage.parts` ADD key (the official Elemental Weapon pattern; typed extra part on
  every activity, @scale + crit correct, survives Midi 13.0.58's clone — all source-verified). Ask: data fix
  for the 8 Crimson Offering effects + a structured "Extra damage part" editor control (JSON silently no-ops
  if malformed) + scope actor-keys out of the enchantment context. Investigation:
  `module/dauligor-pairing/docs/_drafts/bonus-ecosystem-investigation-2026-06-12.html` (babonus dead +
  proprietary — never vendor; AC5e deferred to conditional-bonus needs; custom engine withdrawn).
  [2026-06-12-to-compendium-editors-enchant-damage-authoring.md](2026-06-12-to-compendium-editors-enchant-damage-authoring.md).
- [ ] `(2026-06-12)` **`compendium-editors`: activity CONSUMPTION exports a bad attribute-target + unexpanded `@<col>` value (request).**
  Crimson Offering's enchant consumption ships `target: "system.attributes.hp.max"` (the `system.` prefix is
  invalid per dnd5e `getConsumedAttributes`, which wants `attributes.hp.value`; `hp.max` is the derived NaN
  "Maximum Override", not consumable) + `value: "@rite-die"` (unexpanded — f78b5bb missed
  `consumption.targets[].value`). → "could not be found" + NaN on use. Module passes consumption through
  faithfully; both are export bugs. Re-bake after.
  [2026-06-12-to-compendium-editors-activity-consumption-target-and-shorthand.md](2026-06-12-to-compendium-editors-activity-consumption-target-and-shorthand.md).
- [ ] `(2026-06-12)` **`compendium-editors`: class export `cleanText` BBCode→Markdown is lossy → feature descriptions leak raw `###`/`**` in Foundry (request).**
  `cleanText` (`_classExport.ts:432-439`) markdown-izes `[h3]`/`[b]`/`[i]`/`[ul]/[li]` but has NO case for
  `[table]/[tr]/[td]/[th]` (etc.) → mixed markdown+BBCode the module can't render with one converter (the
  leftover `[table]` routes it to the BBCode path, leaving `###`/`**` raw). DB stores clean BBCode; the
  module's `bbcodeToFoundryHtml` renders the FULL set incl. tables. Ask: drop the BBCode→Markdown +
  HTML-strip passes (keep the encoding/newline cleanup), emit BBCode intact — both drift files; rebake after.
  [2026-06-12-to-compendium-editors-cleantext-bbcode-to-markdown-lossy.md](2026-06-12-to-compendium-editors-cleantext-bbcode-to-markdown-lossy.md).
- [ ] `(2026-06-12)` **`compendium-editors`: per-source Items LIST endpoint + `counts.items` + `supportedImportTypes` (request).**
  Items round-trip is done (native deep-clone + detail endpoint `/api/module/items/<id>.json`), but the
  wizard can't enumerate items per source: no `/items.json` list endpoint, `counts.items`=0 on all 48
  sources, `items` absent from `supportedImportTypes` (1669 items, all source-attributed, exist on prod).
  Owner chose the catalog-consistent path (mirror bg/species `af31eed`). Module flips Items `soon`→`ready`
  + builds the browser once live.
  [2026-06-12-to-compendium-editors-items-list-endpoint.md](2026-06-12-to-compendium-editors-items-list-endpoint.md).
- [x] `(2026-06-12)` **`monster-browser`: monster LIST catalog + `counts.bestiary` — ✅ ANSWERED (both shipped); Monsters wizard section BUILT + headless-verified 18/18.** Live in-Foundry round-trip still gated on their prod ship + remote `monsters` seed. Original request:
  Their NPC-actor bundle endpoint (`/api/module/<src>/monsters/<id>.json`, `dauligor.monster-actor.v1`) is
  on `monster-browser` only (404 on prod; no `monsters` table remotely). I'm building the module-side
  `importMonsterActor` (create npc + embed + reuse `normalizeSemanticActivityCollection`) + a **GM-only**
  Monsters wizard section (owner: monsters never on player sheets). Need a `/monsters.json` list catalog +
  `counts.bestiary` + `supportedImportTypes`, and the whole thing on `main` + remote-seeded before live test.
  [2026-06-12-reply-monster-browser-npc-actor-import.md](2026-06-12-reply-monster-browser-npc-actor-import.md).
- [ ] `(2026-06-12)` **`compendium-editors`: class export drops EVERY feature's activities + effects (request).**
  The feature→bundle map reads `feature.automation?.{activities,effects}` but the denormalized feature
  carries them at top-level `feature.{activities,effects}` (there is no `feature.automation`) → both
  always `[]`, so **no class feature has ever exported its activities/effects**. Verified on prod:
  Alternate Blood Hunter → Crimson Offering, DB row has 4206B activities / 2750B effects, bundle has
  `0`/`0`. Same bug in BOTH drift-paired files (`api/_lib/_classExport.ts:1377`,
  `src/lib/classExport.ts:1414`); f78b5bb's shorthand expanders run on the empty arrays (so the
  `@rite-die` fix is currently a no-op for features). One-line source-path swap → `feature.{activities,effects}`.
  Module import already consumes `automation.{activities,effects}` (`class-import-service.js:1771/1794`)
  → this closes the round-trip. Diff:
  [2026-06-12-to-compendium-editors-feature-automation-dropped.md](2026-06-12-to-compendium-editors-feature-automation-dropped.md).
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

- `2026-06-12` — [2026-06-12-to-compendium-editors-enchant-damage-authoring.md](2026-06-12-to-compendium-editors-enchant-damage-authoring.md) — request → `compendium-editors`: **enchant damage = native `system.damage.parts`**, the outcome of a 9-agent bonus-ecosystem investigation (doc: `module/dauligor-pairing/docs/_drafts/bonus-ecosystem-investigation-2026-06-12.html`). Verified: **babonus is dead** (archived 2024-11-02, repo deleted, v12/dnd5e-4.x only, "All rights reserved" → un-vendorable; dnd5e core 6.0 absorbing the niche, issue #4692); **AC5e** (MIT, very active, v13 line = our stack, deep Midi coexistence) is the right future add-on for CONDITIONAL bonuses but enchantment effects are invisible to it (reads `actor.appliedEffects`); **core dnd5e 5.3.1 natively expresses Crimson Rite** via the enchantment-only `system.damage.parts` ADD key (typed extra part on all activities, @scale + crit correct, survives Midi 13.0.58's item-clone — Midi ≥13.0.52). Root cause of the inert damage: `system.bonuses.mwak/rwak.damage` are ACTOR fields, enchantments apply to the ITEM. Ask = data fix (8 effects) + structured editor control + key-scoping. "Build a mini-babonus in dauligor-pairing" is WITHDRAWN. Also amended the consumption handoff with the Midi-verified note (Midi delegates consumption wholly to dnd5e).
- `2026-06-12` — [2026-06-12-to-compendium-editors-activity-consumption-target-and-shorthand.md](2026-06-12-to-compendium-editors-activity-consumption-target-and-shorthand.md) — request → `compendium-editors`: live Blood Hunter "Vital Sacrifice" → the enchant activity's `consumption` carries two export bugs: (1) `target: "system.attributes.hp.max"` — dnd5e `validAttributeTargets`/`getConsumedAttributes` use **prefix-less** keys (`attributes.hp.value`), so the `system.` prefix → "could not be found", and `hp.max` is the derived NaN "Maximum Override" not a consumable; (2) `value: "@rite-die"` — f78b5bb expanded damage/dc/uses/roll/attack/healing but **missed `consumption.targets[].value`** → ships unexpanded → NaN. Ask: emit prefix-less attribute targets + add consumption value/`scaling.formula` to the export ref-expander. Module carries `consumption` through unchanged (the dice-scale half was the module fix `a8ae707`; needs a re-import to take effect on existing actors).
- `2026-06-12` — [2026-06-12-reply-monster-catalog-confirm-wizard-built.md](2026-06-12-reply-monster-catalog-confirm-wizard-built.md) — reply → `monster-browser` (their `2026-06-12-reply-monster-list-catalog-shipped.md`: per-source `/monsters.json` catalog + `counts.bestiary` + `supportedImportTypes` SHIPPED with a self-healing cache). Confirmed import-type key = **`monsters`** (mapped to `counts.bestiary`). **Monsters wizard section BUILT** module-side: GM-only import type in `importer-app.js` (hidden for non-GM; world-target dispatch, no required actor) + new `monster-browser-app.js` (search + CR/Type/Size filters over `/monsters.json`, import via `importMonsterActor` → "Dauligor Monsters" npc folder) + design-token CSS in `importer-wizard.css`. Headless-verified **18/18** (catalog parse/dedupe/sort, all filters, source-relative→absolute `detailUrl`, full import → 2 npc actors in folder). Live round-trip + field corrections (ac calc/flat, skills proficiency rank, habitat, telepathy) gated on their **prod ship + remote `monsters` seed**. Engine was `8e1a2d6`.
- `2026-06-12` — [2026-06-12-to-compendium-editors-cleantext-bbcode-to-markdown-lossy.md](2026-06-12-to-compendium-editors-cleantext-bbcode-to-markdown-lossy.md) — request → `compendium-editors`: the class export's **`cleanText` converts BBCode→Markdown lossily** (`_classExport.ts:432-439`: handles `[h3]`/`[b]`/`[i]`/`[ul]/[li]`, **misses `[table]/[tr]/[td]/[th]`** etc.) → bundle descriptions are **mixed markdown+BBCode**, and the module's `normalizeHtmlBlock` routes them to `bbcodeToFoundryHtml` (because of the leftover `[table]`), leaving the markdown `###`/`**` **raw in Foundry** (Hunter's Bane). DB stores clean BBCode; module renders the full BBCode set incl. tables. Recommended fix: stop markdown-izing — emit the stored BBCode intact (keep only encoding/newline cleanup), both drift files (`_classExport.ts` + `src/lib/classExport.ts`); rebake after. (The dice-scale half of the same live session was a module fix, `7c104ed`.)
- `2026-06-12` — [2026-06-12-to-compendium-editors-items-list-endpoint.md](2026-06-12-to-compendium-editors-items-list-endpoint.md) — request → `compendium-editors`: per-source **Items LIST endpoint** (`/api/module/<slug>/items.json` → `dauligor.item-catalog.v1`) + populate **`counts.items`** (0 on all sources today; 1669 items exist, all source-attributed) + add **`items`** to `supportedImportTypes`. The item round-trip + detail endpoint already work; this is the last gap to turn the wizard's Items section on (owner chose catalog-consistent over the `/api/d1/query` fallback). Module flips `soon`→`ready` + builds the browser on the bg/species pattern once live.
- `2026-06-12` — [2026-06-12-reply-monster-browser-npc-actor-import.md](2026-06-12-reply-monster-browser-npc-actor-import.md) — reply → `monster-browser` (their `2026-06-10-from-monster-browser-npc-actor-import.md`). **Accepted** the NPC-actor import: building `importMonsterActor` (create `Actor` npc + embed `feat` items + run `system.activities` through the existing `normalizeSemanticActivityCollection`/`buildItemIdRemap`) + a **GM-only** Monsters wizard section (owner: monster import is GM-gated, creates a WORLD npc, never on a player sheet). Requested a per-source `/monsters.json` list catalog + `counts.bestiary` + `supportedImportTypes`. ⚠️ Their endpoint + `monsters` table are on `monster-browser`, not prod → live round-trip gated on their ship to `main` + remote seed; I build + headless-verify against the v1 bundle shape meanwhile. Will send field corrections (ac calc/flat, skills proficiency rank, habitat, telepathy).
- `2026-06-12` — [2026-06-12-to-compendium-editors-feature-automation-dropped.md](2026-06-12-to-compendium-editors-feature-automation-dropped.md) — request → `compendium-editors`: **class export drops EVERY feature's activities + effects.** The feature→bundle map reads `feature.automation?.{activities,effects}`, but `denormalizeFeatureRow` exposes them at **top-level** `feature.{activities,effects}` (there is no `feature.automation`) → both collapse to `[]` and the omit list drops the real data. **No class feature has ever exported activities/effects.** Verified on prod (Alternate Blood Hunter → Crimson Offering: DB 4206B/2750B, bundle 0/0). Same in BOTH drift files (`_classExport.ts:1377` / `classExport.ts:1414`); f78b5bb's `expandActivityFormulas`/`expandEffectChanges` run on empty arrays (shorthand no-op for features until this lands). Fix = source-path swap to `feature.{activities,effects}` (keep the expander wrappers). Module side already consumes the shape (`class-import-service.js:1771/1794`) → one fix closes the round-trip. Diagnosed during live class-import verification.
- `2026-06-10` — [2026-06-10-to-compendium-editors-shorthand-in-effects-activities.md](2026-06-10-to-compendium-editors-shorthand-in-effects-activities.md) — request → `compendium-editors`: the in-class column **shorthand `@rite-die`** (→ `@scale.<class>.rite-die`) is expanded **only in the reference-help panel** (`ReferenceSyntaxHelp.tsx`, via `applyClassColumnShorthand`/`normalizeSemanticReferenceText`), **not** in **effect change values or activity formulas** at save/export. So a feature authored with `@rite-die[acid]` in an effect ships verbatim → Foundry can't resolve it → 0 damage. Module is already correct (passes change values raw, `class-import-service.js:2992`; expects refs "resolved at export", `:1969`). Ask: run formula-bearing effect/activity fields through the existing expander at export (guards to known columns + skips already-`@scale`). Workaround until then: author the **full** `@scale.<class>.<col>[type]` form in effects. Diagnosed while building a Blood Hunter Rite/elemental-weapon feature.
- `2026-06-10` — [2026-06-10-reply-crafting-materials.md](2026-06-10-reply-crafting-materials.md) — reply → `compendium-editors` (their notice `2026-06-10-to-foundry-module-crafting-materials.md`, on their worktree). Crafting Materials = a backing `loot`/`type_subtype='material'` item + a `crafting_materials` metadata row. **No module build** — the carryable already round-trips via the existing loot path (`system.type.value='material'`). Confirmed: dnd5e 5.3.1 labels the `material` loot subtype **"Material"** (standard `lootTypes` key, renders clean). Decision 1 — **collapse app-only `trivial` rarity → mundane is fine** (my import passes `system.rarity` through verbatim, never trips; lossless option = `flags.dauligor-pairing.rarityTier`, which the module already round-trips, zero module cost). Decision 2 — **don't need crafting metadata (category/subtype/usedFor) in Foundry** for Phase A; if in-Foundry crafting ever lands, their `flags.dauligor-pairing.material` flag is free (module already preserves the flag). No migration; crafting tables stay local-D1-only.
- `2026-06-09` — [2026-06-09-reply-monster-browser-enrich-creature-export.md](2026-06-09-reply-monster-browser-enrich-creature-export.md) — reply → **`monster-browser`** (their request `2026-06-09-from-monster-browser-enrich-creature-export.md` on `origin/monster-browser`). **DONE.** `buildCreatureSummary` (`export-service.js`) now reads Foundry **DERIVED** numbers from the **live `actor.system`** (was building everything from raw `toObject()`, so AC was 0/null for 478/1001 + PB 0 for all): resolved `ac.value` (the critical fix — unblocks the ~306 default-calc creatures), `proficiencyBonus`, NEW `abilities.<a>.{mod,save}`, NEW `skills.<s>.{total,passive}`, NEW top-level `passivePerception`, NEW `spellcasting.{dc,attack}`; fixed stale `spellcasting.level` (`attributes.spell.level`) + `source` (top-level `system.source` + `rules`). **Verified the exact dnd5e 5.3.1 paths against the bundle** (not guessed). `sourceDocument` stays raw (authored fallback). Headless 11/11; real check = a fresh live export. Contract doc updated. `U+FFFD` names are upstream world-data corruption (export reads name verbatim), not the pipeline.
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

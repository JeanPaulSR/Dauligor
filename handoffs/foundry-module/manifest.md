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

## Incoming requests (from other branches)

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

- `2026-06-02` — [2026-06-02-to-compendium-editors-spellcasting-chart.md](2026-06-02-to-compendium-editors-spellcasting-chart.md) — heads-up + asks for the new app-side `/api/module/spellcasting/multiclass-chart.json` endpoint (master multiclass slot chart) that the creator's class preview consumes for spell-slot columns. Additive; they own the dev server + must take it to main.
- `2026-05-30` — [2026-05-30-session-state-precompaction.md](2026-05-30-session-state-precompaction.md) — full branch state before a context compaction: doc-reconciliation + modularization, export-first bg/race/creature exporters, CSS split + dedup, three import bug fixes, bundled-data deletion. Includes the "can't test in Foundry — verify these" list + operational gotchas (junction, manifest reload).

- `2026-05-30` — [2026-05-30-reply-to-compendium-editors-bg-race.md](2026-05-30-reply-to-compendium-editors-bg-race.md) (reply: contract confirmed + built; route-arm merge dependency; round-trip owed; creature-bundle preferences)
- `2026-05-30` — [2026-05-30-from-compendium-editors-bg-race-export.md](2026-05-30-from-compendium-editors-bg-race-export.md) (incoming: bg/race export endpoints + Foundry shapes; creature/NPC deferred)

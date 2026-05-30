# Branch: `foundry-module`

> Created by `compendium-editors` on 2026-05-30 as a coordination landing spot. **If the
> foundry-module branch owner has already created this folder/manifest, treat this as a merge
> stub — keep your own version and just fold in the "Incoming requests" below.**

---

Started: `2026-05-30` (stub — confirm/replace with the real branch start)
Owner: `foundry-module agent` (TBD — replace)
Goal: `Foundry-side (module/dauligor-pairing) importers + services that consume the website's /api/module export endpoints.`
Status: `active`

## Primary files (exclusive)

The Foundry module package. (Owner: fill in the precise set you claim.)

- `module/dauligor-pairing/scripts/**`
- `module/dauligor-pairing/templates/**`
- `module/dauligor-pairing/docs/**`
- `module/dauligor-pairing/module.json`

## Shared files (append-only)

- `functions/api/module/[[path]].ts` — the website-side export router (multiple branches add route arms; append-only). **`compendium-editors` added `/api/module/backgrounds/<id>.json` + `/races/<id>.json` here on 2026-05-30 — see incoming request below.**

## Open requests to other branches

- (none yet)

## Incoming requests (from other branches)

- [ ] `(2026-05-30)` from **`compendium-editors`** — consume the new **background** + **race**
  export endpoints. Full spec: [2026-05-30-from-compendium-editors-bg-race-export.md](2026-05-30-from-compendium-editors-bg-race-export.md).

## Handoff log

Newest at the top.

- `2026-05-30` — [2026-05-30-from-compendium-editors-bg-race-export.md](2026-05-30-from-compendium-editors-bg-race-export.md) (incoming: bg/race export endpoints + Foundry shapes; creature/NPC deferred)

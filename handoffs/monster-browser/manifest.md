# Branch: `monster-browser`

**Status:** active · **Owner:** Claude · **Started:** 2026-06-09
**Base:** `origin/main` @ `f79c806` (NOT `compendium-editors`)
**Progress:**
- ✅ **Phase 1 (schema)** — migration `20260609-1600_create_monsters.sql` applied local + verified (57 cols, indexes); registered in `d1.ts`/`d1-fetchers-server.ts` jsonFields, `d1Tables.ts`, `d1-architecture.md` + `monsters.md`.
- ✅ **Phase 2 (seed)** — local D1 seeded from remote (93 tables, 84 sources, 542 spells).
- ✅ **Phase 3 (importer)** — `src/lib/monsterImport.ts` (transform) + `scripts/import-monsters.ts` (runner); all **1001 creatures imported to local D1** + adversarially verified (9-archetype + completeness-critic workflow). 5 reconstruction bugs found & fixed: spell-list dedup, weapon `includeBase` damage-mod, melee reach labeling, unnamed lair/regional bullets, `monsterTrait`→bonusAction refinement (97 features). Deferred: dual-caster per-feat spell grouping (38 creatures, prose intact), 1 recharge edge (Black Abishai), add MPMM source row (291 `sourceId` null).
- ⏭ **Next: Phase 4** — `MonsterList` + `MonsterDetailPanel` UI (needs the dev server + parent `.env`/`worker/.dev.vars`).

## What this branch is doing

Building a **public, read-only Monster Browser** — a compendium browser for D&D 5e
monsters / stat blocks (NPCs, beasts, dragons, …), routed at `/compendium/monsters`,
mirroring the existing `/compendium/items`, `/spells`, `/feats` browsers.

Greenfield: no `monsters` table, page, import, or doc exists today. The browser
*pattern* (`CompendiumBrowserShell` + `ItemList.tsx` + `ItemDetailPanel.tsx`) is mature
and copied/adapted.

Kickoff spec: [2026-06-09-monster-browser-kickoff.md](2026-06-09-monster-browser-kickoff.md).

**Out of scope (later, separate passes):** an admin monster editor and a Foundry `npc`
actor importer. The Foundry actor shape still *informs the table now* (see below).

## Phasing

1. **Migration** — `monsters` table (5e stat-block shape) + register JSON cols in
   `src/lib/d1.ts` + `docs/platform/d1-architecture.md` + write
   `docs/database/structure/monsters.md`. Apply **local-first**.
2. **Seed** a handful of monsters so the browser has data to render.
3. **`MonsterList.tsx`** — copy `ItemList.tsx`; columns (Name / CR / Type / Size /
   Source) + filter axes; slim list-load + lazy `fetchMonster` on select.
4. **`MonsterDetailPanel.tsx`** — copy `ItemDetailPanel.tsx`; render the stat block.
5. Register the `/compendium/monsters` route + sidebar entry.

## Primary files (exclusive)

- `src/pages/compendium/MonsterList.tsx` — new. The 3-pane public browser.
- `src/components/compendium/MonsterDetailPanel.tsx` — new. Read-only stat-block panel
  (+ an optional `MonsterArtPreview` helper, modeled on `FeatArtPreview`).
- `worker/migrations/<timestamp>_create_monsters.sql` — new. The `monsters` table.
- `docs/database/structure/monsters.md` — new. Per-table schema doc.
- The `monsters` D1 table itself.

## Shared files (append-only)

- `src/App.tsx` — one new public route `/compendium/monsters`.
- `src/components/Sidebar.tsx` — one new nav link.
- `src/lib/d1.ts` — add `monsters`' JSON columns to the `jsonFields` auto-parse list.
- `src/lib/d1Tables.ts` — register `monsters` in the table-name registry.
- `worker/migrations/` — timestamped filename to avoid collision.
- `docs/platform/d1-architecture.md` — register `monsters`' JSON columns in the
  auto-parse list documentation.
- `handoffs/BRANCH_REGISTRY.md` — this branch's row.

## Reused (imported, NOT modified)

- `src/components/compendium/CompendiumBrowserShell.tsx` — the shared 3-pane shell.
- `src/hooks/useAxisFilters.ts` — filter-state hook.
- `src/components/compendium/SectionFilterPanel.tsx` — `FilterSection` type + modal body.
- `src/lib/d1.ts` exports (`fetchCollection` w/ `select:` projection, `fetchDocument`)
  — called, not edited (the only edit is the append-only `jsonFields` entry above).
- `src/lib/bbcode.ts` (`bbcodeToHtml`) — render descriptions / actions.

## Coordination notes

- **`src/components/compendium/**` is nominally claimed by `compendium-editors`** (except
  `SystemPageGlossary.tsx`). `compendium-editors` is **shipped** (`== origin/main ==
  f79c806`, items work done per the kickoff doc). `MonsterDetailPanel.tsx` is a **brand-new
  file** — no merge conflict with any existing file in that directory. Treating it as an
  append-only addition at the directory level. Flagging here for transparency; will notify
  if `compendium-editors` resumes active work touching shared component infra.
- **Foundry data model:** monsters are Foundry **`Actor`** docs (`type: "npc"`) — a
  *different* schema than `Item` docs. Before committing the migration, pin the column
  shape against a **real npc actor export**. The item importers
  (`src/lib/itemImport.ts`, `src/lib/foundryActivities.ts`) are the right *pattern* for a
  future importer, not a drop-in.

## Open requests to other branches

- **→ `foundry-module`** (2026-06-09): enrich the `creature-folder-export` with
  Foundry **derived** values (resolved `ac.value`, PB, save/skill totals, passive
  Perception, spell DC/attack) + two path fixes. ✅ **RESOLVED — foundry-module did it
  (`84424a2`).** Request:
  [`...enrich-creature-export.md`](../foundry-module/2026-06-09-from-monster-browser-enrich-creature-export.md)
  · their reply: `...reply-monster-browser-enrich-creature-export.md` · our ack:
  [`...ack-enrich-done.md`](../foundry-module/2026-06-09-from-monster-browser-ack-enrich-done.md).
  **⏳ Pending a fresh re-export** of the Creatures folder (derived values only
  populate on a live export) — then validate + drop the `ac_unverified` path.

## Local dev

This branch's **isolated** dev stack — `node scripts/dev-monster-browser.mjs`:

| service | URL |
|---|---|
| app (Express + Vite) | **http://localhost:3006** |
| worker (wrangler dev — D1 + R2 sandbox) | **http://localhost:8793** |
| wrangler inspector | :9234 |

⚠ **NOT :3000** — that's the main checkout's default stack. Sibling branches:
sysapp `:3001` · proposal `:3002` · manual-uploads `:3003` · character-creator `:3005`.

Runs **no-watch** (`tsx server.ts`) — the junctioned `node_modules` makes `tsx watch`
loop endlessly in a worktree; restart the launcher to pick up source edits. The
monsters migration is already applied to this worktree's local D1; **seed the rest of
the schema** (sources/spells/… for FK + spell-linking) from remote per the bootstrap
in the script header, then re-apply the monsters migration. Copy the parent repo's
`.env` + `worker/.dev.vars` into this worktree if absent.

## Notes

- `main` = production (auto-deploys). Never push without explicit permission; show
  `git log origin/main..HEAD` first. tsc has a known baseline of pre-existing errors —
  keep it there.
- Never `npm install` in this worktree (`node_modules` is junctioned to the parent repo).
- Migrations: apply **local-first**; remote only with explicit go-ahead (never
  `wrangler d1 migrations apply --remote`).

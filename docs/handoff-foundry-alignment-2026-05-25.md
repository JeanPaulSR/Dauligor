# Handoff — Foundry alignment + import workbenches (2026-05-25)

> **Read first:**
> - `docs/architecture/proposal-editor-pattern.md` (still the live contract for proposal-mode editors)
> - `module/dauligor-pairing/docs/{spell,feat,item,actor}-folder-export-contract.md` (the four Foundry → Dauligor transport contracts)
>
> **Status:** **uncommitted work-in-progress on `main`**. Two sessions of work sit pending: (1) the 2026-05-21 content-proposals production deploy (committed + shipped to prod); (2) this session's Foundry alignment pass (uncommitted, ~28 files modified/new, local D1 migration applied but **NOT** pushed to remote D1).

---

## Production topology (stable since 2026-05-21)

| Layer | Where it runs |
|---|---|
| Frontend SPA | Cloudflare Pages (`www.dauligor.com`) |
| `/api/*` surface | Cloudflare Pages Functions (`functions/api/*` — `[[path]].ts` catch-alls) |
| D1 + R2 binding | Cloudflare Worker `dauligor-storage` (separate `wrangler deploy` from `worker/`) |
| Local dev | Express + Vite on `:3000`, `wrangler dev` worker on `:8787` |

No `vercel.json`. The Vercel → Cloudflare Pages migration is complete; treat any "Vercel" references in older docs as historical.

## 🚨 Critical D1 migration rules

**Production D1's `d1_migrations` tracking table is empty.** Existing tables were created via direct SQL execution, not via `wrangler d1 migrations apply`. **Until task #39 (backfill `d1_migrations`) ships:**

- ✅ **Apply new migrations** via `npx wrangler d1 execute dauligor-db --remote --file=<file>`
- ❌ **Do NOT** run `npx wrangler d1 migrations apply dauligor-db --remote` — it'll try to replay every migration starting from `0001_phase1_foundation.sql`

**Per-migration permission rule (AGENTS.md #7):** Never apply a migration to remote D1 without explicit per-migration permission from the user. An earlier "go ahead" does not transfer between migrations. Treat `--remote` as a one-way door.

---

## This session's uncommitted work (Foundry alignment pass)

**Goal:** align Dauligor's compendium data shapes with Foundry dnd5e v5.3.1, and build Foundry → Dauligor import workbenches for feats and items (mirroring the existing spell importer).

### Files (uncommitted)

| Group | Files | Status |
|---|---|---|
| **Foundry exports** (module) | `module/dauligor-pairing/scripts/export-service.js`, `main.js` + `docs/{item,actor}-folder-export-contract.md` | Added Item + Actor folder exports parallel to existing Spell + Feat. Sidebar buttons routed by directory type (Item → 3 export buttons; Actor → 1). |
| **Feat import** | `src/lib/featImport.ts`, `src/components/compendium/FeatImportWorkbench.tsx`, `src/pages/compendium/FeatsEditor.tsx` (tabs wrapper) | Full parity with SpellImportWorkbench. |
| **Item import (multi-target routing)** | `src/lib/itemImport.ts`, `src/components/compendium/ItemImportWorkbench.tsx`, `src/pages/compendium/ItemsEditor.tsx` (tabs wrapper), `src/lib/compendium.ts` (`upsertItemBatch`) | Single workbench auto-routes each Foundry item to `weapons` / `armor` / `tools` / `items` based on `item.type` + `system.type.value`. |
| **Schema migration** | `worker/migrations/20260524-1800_foundry_aligned_item_shapes.sql` | **Applied to LOCAL D1 only.** Drops `items.{weight, price_value, price_denomination}`, adds JSON `weight`/`price`. Adds weapon/armor/tool root stats (damage, range, mastery, magical_bonus, armor.value/dex, strength, stealth, tool_type, base_item, etc.). |
| **Editor mechanics-fields** | `src/components/compendium/{Weapon,Armor,Tool}MechanicsFields.tsx`, updates to `{Weapons,Armor,Tools,Items}Editor.tsx` | Surfaces Foundry root stats in the manual editors. |
| **Activity enum alignment** | `src/components/compendium/activity/{constants.ts, ActivationDurationEditor.tsx, RangeTargetingEditor.tsx}`, `ActivityEditor.tsx` | Added 11 missing activation types (longRest/mythic/legendary/lair/crew/turnStart/turnEnd/encounter/day/none), 4 duration units (turn/disp/dstr/perm), 3 template types (radius/rect/wall), `any` range unit, `initiative` recovery period, `recovery`/`recoverPartial` recovery types. Surfaced `visibility.requireAttunement/requireIdentification/requireMagic` as checkboxes (used to be silently stripped). |
| **Shared library updates** | `src/lib/compendium.ts`, `src/lib/d1.ts` | Removed `feat_type`/`feat_subtype`/`source_type` from forbidden list (fixed latent FeatsEditor silent-drop bug). Type-aware boolean coercion (`typeof === 'boolean'`) so items.attunement still coerces but weapons/armor/tools string attunement passes through. Added `weight`/`price`/`damage`/`range` to d1.ts jsonFields. |

### Critical bug fix during this session

**Items workbench was marking every row "Unresolved Source"** because it called `fetchCollection('abilities')` — table doesn't exist. `Promise.all` rejected → no setters fired → `sources` stayed `[]`. Fix: query `attributes` (the right table per `d1Tables.ts`) AND switch to `Promise.allSettled` so any one failed table doesn't nuke the rest. Same defensive pattern should probably be applied elsewhere.

### Theme-aware import workbench headers

All three import workbenches (Spell + Feat + Item) used a hardcoded `bg-[linear-gradient(180deg,rgba(12,16,24,...))]` for their hero header — only looked right on dark themes. Replaced with `bg-card` + an absolutely-positioned gold radial overlay so the surface adapts to the active theme. Items got an additional layout pass: outer card is now `h-full flex flex-col`, body uses independent column scrolling so the tall type-specific preview panes (weapon damage, armor stats, etc.) don't push content off the page.

### What's deferred

- `category_id` / `ability_id` on weapons / armor / tools imports stay NULL — admin assigns in manual editor after import (per "FK gaps stay NULL with warnings" scope choice).
- `property_ids` (weapons FK to weaponProperties) stays empty; Foundry slugs land in the raw `properties` text column.
- Migration `20260524-1800_foundry_aligned_item_shapes.sql` **NOT** applied to remote D1. Needs per-migration permission before deploy.

### Verification status

- `npx tsc --noEmit` — 7 pre-existing errors, **0 new errors** from this session
- `npm run build` — green
- Local D1 migration applied successfully
- Items workbench manually tested against `E:\DnD\Professional\Foundry Export\Items\items-items-export.json` (1691 items; PHB/TCoE/XGE/etc. sources matched after the abilities/attributes fix)

### Commit strategy (recommended)

When ready, split into ~3 logical commits:
1. **Foundry export expansion** — module changes + Item/Actor contract docs (lowest risk; deploy independently)
2. **Feat import parity** — featImport.ts + FeatImportWorkbench + FeatsEditor tabs + compendium.ts fixes
3. **Foundry-aligned data shapes** — migration + activity enums + 4 editor refactors + mechanics-fields components + itemImport + ItemImportWorkbench

---

## Content-proposals system (shipped 2026-05-21)

Already in production. Don't redo:
- `/my-proposals`, `/proposals/edit/*` routes (wrapped editors)
- Admin queue at `/admin/proposals` (review/approve/reject/revert)
- Cascade dependency banner + Replace flow on Spell/Feat/Item/Class/Subclass editors
- DRY hooks: `useProposalEntityDrafts`, `useProposalSingleWorkId`, `useProposalPreFlushSave`, `useDraftedEntityIds`, `useEditBaseUnlocks`, `useTombstoneBanner`, `useCascadeDependent`
- `<ProposalAwareEditorHeader>` component

The 9 proposal-system migrations (`worlds`, `user_permissions`, `pending_revisions`, `proposal_bundles`, +5 follow-ups) are all on prod D1, applied via `wrangler d1 execute --remote --file`.

## Rollback runbook (2026-05-21 deploy)

For regressions in the proposal system specifically:

| Anchor | Value |
|---|---|
| Pre-merge `origin/main` | `3e45389` (git tag `pre-merge-dry-pass-20260521`) |
| D1 Time Travel pre-migration bookmark | `00000060-000001d8-00005072-845c9424ad25731c79a1a4e9aa21ed45` (`2026-05-21T01:55:00Z`) |
| D1 SQL backup | `backups/dauligor-remote-20260521-0155.sql` (SHA256 `6a2be779...`) |

**Path A — code-only rollback (default):**
```bash
git fetch origin && git checkout main
git reset --hard pre-merge-dry-pass-20260521
git push origin main --force-with-lease
```
Cloudflare Pages auto-redeploys; proposal tables stay in prod D1 (harmless, old code ignores them).

**Path B — full rollback** (only if new code corrupted pre-existing tables):
```bash
npm run backup:d1
# Path A first, then:
npm run timetravel -- restore 00000060-000001d8-00005072-845c9424ad25731c79a1a4e9aa21ed45 --confirm
```
Destroys any writes made after 01:55 UTC.

Full runbook in `docs/rollback-2026-05-21-merge-to-main.md`.

---

## Pending non-blocking feature work

| # | Task | Sketch |
|---|---|---|
| #24 | Self-serve world creation + per-block world selection | Only seeded `dauligor-base` exists; users should spin up their own worlds. |
| #25 | Per-world content gating | Owner picks which base content (classes/spells/tags) is allowed inside their world. |
| #26 | System page type with referenceable modular components | Wiki page that lets DMs assemble system docs from referenceable building blocks. |
| #39 | Backfill `d1_migrations` on prod D1 | Until done, never use `migrations apply --remote` — see above. |
| #194 | Audit unchunked IN clauses in `_classExport.ts` | D1 has ~100-param limit; chunk to 90 like `_classSpellList.ts` does. |
| #204 | Foundry visual + functional verify | Manual test of all sidebar buttons + new exports against a live Foundry world. |

The two items-side TODOs from this session:
- **Items folder export bug**: `itemSummary.magical` ships as `""` instead of `false` when neither magical nor rare. Truthy/falsy still works, but cosmetic — wrap `!!(...)` in `buildItemSummary` in `export-service.js`.
- **Items contract doc drift**: `itemSummary.container.capacity` ships as `{ weight: {value, units}, volume: {units} }` but the contract documents the older `{ type, value }` shape. Update the doc.

---

## What to read for a fresh agent

1. **This handoff** (you're here) — current state of uncommitted work
2. **`docs/architecture/proposal-editor-pattern.md`** — canonical proposal-editor contract
3. **`docs/rollback-2026-05-21-merge-to-main.md`** — incident response for the 2026-05-21 deploy
4. **`module/dauligor-pairing/docs/*-folder-export-contract.md`** — 4 Foundry transport contracts (spell/feat/item/actor)
5. **`src/components/proposals/README.md`** — proposal UI components + hooks tour
6. **`AGENTS.md`** + **`DIRECTORY_MAP.md`** — top-level guardrails

---

## Project conventions to honor

- **No backwards compatibility during migrations** — when shape changes, update sources to fit; don't preserve dual shapes. (User feedback memorialized.)
- **Survey first, no DB touches** — verify code against doc claims before refactoring; almost never touch the database.
- **D1 upsert idiom** — never `INSERT OR REPLACE` (cascade-delete bug); always `ON CONFLICT(id) DO UPDATE`.
- **Foundry module junction** — `%LOCALAPPDATA%\FoundryVTT\Data\modules\dauligor-pairing` is an NTFS junction → repo `module/dauligor-pairing`. Edit repo source; no copy step. **Never** repoint at a `.claude/worktrees/*` agent sandbox.
- **No remote D1 writes without per-migration permission** (above).
- **No push to `origin/main` without explicit green-light.**

---

**Delete this handoff when:** the uncommitted Foundry alignment work has been committed, the schema migration has been applied to remote D1 (with permission), and the import workbenches have been smoke-tested in production. Until then, this is the single entry point for "what's in flight on data shapes + imports."

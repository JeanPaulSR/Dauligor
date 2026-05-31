# Fresh-Start Brief — Project, Working Style & Branch Reset

Date: 2026-05-31
Branch: `dauligor-applications` (created 2026-05-31 from `origin/main`; replaces the retired `system-applications`)
Author: agent (Claude)
Status: branch is **clean and identical to `origin/main`**; this brief captures project + working-style knowledge across the reset. The perceived "corruption" was a tooling I/O issue this session, **not** git/repo corruption (see §7). The retired `system-applications` had **0 unique commits** over `origin/main`, so nothing was lost in the swap.

> This is a broader-than-usual handoff: it doubles as a project orientation and a working-style guide, because the owner is resetting the branch and wants nothing lost. Assume you (the reader) are a competent agent who knows nothing about this session.

---

## 0. TL;DR for the next agent

1. The repo is fine. `system-applications` == `origin/main` == `fff679b`, **0 unique commits**, clean tree. There is nothing to "recover."
2. The flakiness the owner saw was **garbled tool output** (Read/Bash returning duplicated/interleaved text). Deleting the branch will **not** fix that — it's environmental. A fresh session/harness restart is the real fix.
3. Read the owner's **working style (§5)** before doing anything. The two cardinal rules: **never push to `main` without an explicit request**, and **don't over-batch tool calls** (one logical operation at a time, especially git).
4. Active feature direction: **admin pages pass**, then **bring the home-block system to Articles**.

---

## 1. The application — Dauligor / "The Archive"

A D&D 5e campaign-management platform for Dungeon Masters. Balances "technical dashboard" utility with a "sword & sorcery" parchment/gold aesthetic.

**Stack**
- React 19 + TypeScript + Vite + React Router 7 + Tailwind CSS 4 + shadcn/ui
- Backend: Cloudflare Pages Functions + a deployed Cloudflare Worker; **D1** (SQLite) + **R2** (object storage)
- Auth: **Firebase** (pseudo-username mapping; synthetic `<username>@archive.internal` login emails — not real inboxes). No anonymous registration.
- Rich text: TipTap editor + custom **BBCode** parser (`src/lib/bbcode.ts`), rendered via `BBCodeRenderer`
- AI: Google Gemini API
- Hosting: Cloudflare Pages (the Vercel→Pages migration is complete)

**Core modules**
- **World Engine (Wiki)** — hierarchical lore; DM-only `[secret]…[/secret]` blocks
- **Rules Foundry (Compendium)** — classes, subclasses, spells, feats, scaling tables
- **Character Workspace** — full sheets (HP/Mana/Hit Dice)
- **Administrative Hub** — RBAC: admin / co-dm / lore-writer / trusted-player / user
- **Campaign Home Builder** — per-campaign homepage layout via a nestable block tree
- **Dauligor Pairing Module** — Foundry VTT integration in `module/dauligor-pairing/`

**Migration status:** Firestore→D1 migration is **complete**. No Firestore client remains. Firebase **Auth** is still in place (an exit plan exists but is not started).

---

## 2. Current repo & branch state (verified 2026-05-31)

- **Local `system-applications` = `origin/main` = `fff679b`** (`docs(compendium): reconcile option editor + filter docs…`).
- `git rev-list --count origin/main..system-applications` → **0**. No unique work on the branch.
- **`system-applications` was never pushed** — there is no `origin/system-applications`. It has no remote backup.
- Working tree clean except one intentional untracked file: `docs/_drafts/campaign-home-handoff-2026-05-30.html` (a local HTML read-aid; carries over across branch swaps).
- `git fsck` shows no object corruption.

**Backup branch:** `wip/password-reset-attempt-2026-05-31` @ `3289b75` holds the 7 reverted password-reset commits (see §4). Keep until the owner confirms the password work is abandoned.

**Other worktrees / branches with live work** (the repo runs many parallel worktrees under `.claude/worktrees/`):
| Branch | Head | Area |
|---|---|---|
| `system-applications` (main checkout) | `fff679b` | this branch — admin/auth/articles/home builder |
| `compendium-editors` | `fff679b` | compendium editor cleanup |
| `foundry-module` | `1b0b083` | **sole steward** of `module/dauligor-pairing/` |
| `proposal-system` | `ffbc555` | content proposals (shipped) |
| several `claude/*` worktrees | — | CharacterBuilder, spell tag pickers, image manager, class importer (ephemeral agent branches) |

---

## 3. Feature areas & their state (project-wide)

Pulled from project memory; verify with `git fetch origin` before asserting any status — local trees drift.

- **Campaign Home Builder** — feature-complete and live in prod. Block-based: 11 block types (hero/"Header", text, image, divider, recommended, callout, entity-row, entity-feature, group, columns, column). Stored one-row-per-root-block in `campaign_home_blocks` (D1); nesting in `config.children` JSON. v1 of the layout builder was rejected as clunky and redesigned as a 3-pane Outline+Preview editor.
- **Content Proposals** — shipped end-to-end May 2026 (on `proposal-system` / merged).
- **Spellbook Manager** — feature-complete + committed; Foundry export round-trip handed to the importer.
- **Spell List Decoupling** — per-class spell list lives on its own endpoint (`/api/module/<source>/classes/<class>/spells.json`), live read-through, tag-driven recompute on spell save. Open: Phase 2 mutations + importer consumption.
- **Spell Pages — next pass** (parked): extend SpellsEditor filter modal (Casting Time/Range/Duration/Shape/Tag-as-filter); apply fullscreen 3-col + filter parity to SpellListManager and SpellRulesEditor.
- **Compendium Editor Cleanup Roadmap** — priority: (1) Backgrounds/Races/Items → Pattern E + promote R/B to own tables, (2) Class/Subclass cleanup (stays bespoke), (3) shared widgets, (4) UI polish + Facilities replacement.
- **Class Importer** — paused: universal-advancements UI works; commit + feature embed not wired; architectural fork (A/B/C) undecided.
- **Foundry module** (`foundry-module` branch) — sole owner of `module/dauligor-pairing/`; current-state audit done, awaiting owner direction.
- **Live-content bridge / system-applications architecture** — Foundry text → enricher → DauligorViewer → `/api/module/*`; article-system unification migration planned.

---

## 4. This session: the password-reset undo (why the branch felt broken)

A prior session tried to build a self-service "Change Password" + admin "Reset Password" + post-login nudge system. It went sideways (repeated garbled reads → edits applied to wrong anchors → an incompletely-wired feature) and **3 of its commits were pushed to `origin/main`**, which is exactly what the owner has repeatedly asked not to happen.

**Resolution (completed this session, with explicit go-ahead):**
- Backed up all 7 attempt commits to `wip/password-reset-attempt-2026-05-31` (`3289b75`).
- Hard-reset local `system-applications` → `fff679b`.
- Force-pushed `origin/main` `10599ec → fff679b` using `--force-with-lease=main:10599ec…` (rejects if main moved). Verified after: `origin/main` == `fff679b`, 0 password commits, campaign-home work intact.
- Confirmed remote D1 never got the `must_change_password` column (the migration was local-only), so `origin/main` was self-consistent after the revert.

**If the password feature is wanted later:** recover from the backup branch. Note the design landmines: `updatePassword` needs recent login → re-auth inline via `reauthenticateWithCredential(user, EmailAuthProvider.credential(email, current))`; the `must_change_password` flag needs its D1 migration applied to remote **with** the code; and synthetic `@archive.internal` emails mean real "recovery email" flows don't work (that feature was intentionally marked WIP).

---

## 5. How the owner works — READ THIS BEFORE ACTING

These are hard-won preferences. Violating them is the main way past sessions went wrong.

1. **Never push to `main` without an explicit request.** Work stays on the feature branch. This has burned multiple sessions — treat it as a hard rule. (And: don't bundle a `push` into the same batch as the question that gates it.)
2. **One logical operation per step; don't over-batch tool calls.** When many tool calls are fired in parallel and one errors, the rest cancel and the state view gets corrupted. Prefer sequential, verifiable steps — especially for git. Batching was the dominant process failure this session.
3. **Confirm before changing anything**, especially destructive/irreversible actions. Survey and present a plan first.
4. **Survey first; verify code against doc claims before refactoring. Almost never touch the database.** Measure, don't infer — empirical verification over reasoning (esp. perf: dev-build ≠ prod-build, observed ~145× difference).
5. **No backwards compatibility during migrations.** Update sources to fit the new system; don't preserve dual shapes.
6. **Prefer a new D1 table over a discriminator column** for new functionality. Extracting later is harder than starting separated.
7. **Present specs / designs / overviews as pleasing-to-read HTML** (parchment/gold style), not chat prose — "information blurs together" in chat. Drafts go in `docs/_drafts/`. (An HTML read-aid version of this brief can be produced on request.)
8. **Use the `/documentation-clarity` skill** when updating docs (it's a verification gate against silently destroying still-correct content).
9. **Minimize icons** — they read as clutter. Keep only at-a-glance type glyphs + real action controls. Show component *type*, not authored title, in list rows.
10. Use the `dauligor-guardian` skill as the context briefing before any subagent touches this codebase.

---

## 6. Environment & technical gotchas

- **Dev launcher:** `node scripts/dev-sysapp.mjs` (uses `tsx watch`; server hot-reloads). App on `:3001`, worker on `:8788`.
- **D1 upsert idiom:** never `INSERT OR REPLACE` (cascade-delete bug) — always `ON CONFLICT(id) DO UPDATE`.
- **D1 compound SELECT limit:** the D1 Worker caps `UNION` at 5 terms (6th 500s); the wrangler CLI does *not* enforce this. Use `batchQueryD1` for N>5 tables.
- **Remote D1 migrations:** need explicit per-migration go-ahead, and a feature's remote migration must ship **with** its code or endpoints 500 in prod.
- **Block-type allowlist gotcha:** any new home-block type must be added to `ALLOWED_HOME_BLOCK_TYPES` in `functions/api/campaigns/[[path]].ts` **and** given a `parseHomeBlock` case, or saves 400 / loads crash. (Bit twice this month: `callout`, then `column`.)
- **Theme system:** theme is a class on `<html>` (`.parchment` default / `.light` / `.dark`), **not** a `data-theme` attribute. `--radius:0` everywhere (square corners). `--ink` token remaps per theme — don't hardcode ink colors.
- **Helper classes** live in `docs/ui/style-guide.md` (not `docs/stylings/`): `.field-label`, `.field-hint`, `.section-label`, `.h3-title`, `.description-text`, `.body-text`, `.label-text`, `.muted-text`.
- **`BBCodeRenderer`:** its `.prose` div sets `color: var(--ink) !important` on itself and child `<p>`; pass utilities via `className` onto the `.prose` element directly (a wrapper can't override the child color).
- **`/api/me`** does `SELECT *`, so new user columns reach the client automatically; writes are gated by `ALLOWED_PATCH_FIELDS` / `BOOLEAN_PATCH_FIELDS`.
- **tsc baseline:** ~6 pre-existing errors (Base-UI `asChild` in other branches' files + characterShared). 0 should be introduced by new work. Root tsconfig has no `strictNullChecks`.
- **Foundry module junction:** the Foundry install path for `dauligor-pairing` is a junction to the active worktree — edit repo source, no copy step.

---

## 7. Issues / landmines for the delete-and-replace

The owner asked for these up front:

1. **"Corruption" is tool I/O, not the branch.** Directly observed this session: a freshly written file read back with duplicated/interleaved lines; git data underneath is consistent. **Deleting/recreating the branch will not fix garbled tool output.** The real fix is restarting the session/agent harness. Flag this so the owner doesn't expect the swap to solve flakiness.
2. **You cannot delete the branch you're on.** The main repo checkout is on `system-applications`. The swap must either *rename* it (`git branch -m`) or *create+switch* to the new branch first, then delete the old.
3. **The branch is identical to `origin/main`** (0 unique commits). So "replace with a new one" is effectively: point a new branch at `origin/main`. Nothing is lost either way — but that also means the swap is cosmetic unless the goal is also to **push the new branch to origin** for a real remote backup (this branch currently has none).
4. **Preserve this handoff across the swap.** Two safe options: (a) keep the handoff file **uncommitted** so it carries over in the working tree, then commit it on the new branch; or (b) commit it now and create the new branch from *this* commit. Do **not** create the new branch from bare `origin/main` and then delete `system-applications` *after* committing the handoff only on `system-applications` — that orphans the commit.
5. **Backup branch decision:** `wip/password-reset-attempt-2026-05-31` should survive the swap (branch deletion of `system-applications` doesn't touch it). Decide later whether to keep or delete it.
6. **Worktrees are unaffected** but be aware they exist: `compendium-editors`, `foundry-module`, `proposal-system`, and ephemeral `claude/*` all run in parallel. Don't prune them as part of this reset.

---

## 8. Recommended next steps

1. **Branch swap — DONE (2026-05-31).** `dauligor-applications` was created from `origin/main`, this handoff folder was renamed to match and committed, the branch was pushed to origin (its remote backup), and local `system-applications` was deleted. The password-attempt commits remain on `wip/password-reset-attempt-2026-05-31`.
2. **Resume feature work:** (1) admin pages pass — survey-first against `docs/ui/style-guide.md`, documented helper classes, theme-safe tokens (verify in parchment/light/dark); (2) bring the home-block system to **Articles** using the campaign-home builder as the proven baseline.
3. **Decide on the backup branch** `wip/password-reset-attempt-2026-05-31` — keep as a safety net, or delete once the password work is confirmed abandoned.

---

## Key files & entry points

- Project orientation: `AGENTS.md`, `Overview.txt`, `DIRECTORY_MAP.md`, `README.md`
- UI standards: `docs/ui/style-guide.md` + `docs/styling/`
- DB layout (source of truth): `docs/database-structure/<table>.md`
- RBAC: `docs/architecture/permissions-rbac.md`
- Foundry module contracts: `module/dauligor-pairing/docs/import-contract-index.md`
- Campaign home builder: `src/lib/campaignHome.ts`, `src/components/campaign/CampaignHome*.tsx`, `functions/api/campaigns/[[path]].ts`
- Prior handoffs (still valid history): `2026-05-30-campaign-home-builder.md`, `2026-05-29-campaign-home-builder.md`

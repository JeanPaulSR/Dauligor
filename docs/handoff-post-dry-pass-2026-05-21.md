# Handoff — Post-dry-pass production deploy (2026-05-21)

> **Read first:** `docs/architecture/proposal-editor-pattern.md` (the live contract for any editor that writes to a proposal-allowlisted table) and `docs/rollback-2026-05-21-merge-to-main.md` (the incident-response runbook for this deploy).
>
> **Status:** the content-proposals system shipped to production on 2026-05-21. This is its first prod deploy. All 65 commits on the work branch landed on `main` (rebased, fast-forwarded, force-pushed). The post-deploy stress test is in progress at the time this doc was written.

---

## Where we are

The 2026-05-21 push moved the proposal system from "branch-only" to live on prod. Everything visible in the proposal UI surfaces is brand new in production:

- `/my-proposals` (content-creator launcher)
- `/proposals/edit/*` routes (all wrapped editors)
- The admin queue at `/admin/proposals` (review, approve, reject, revert with drift refuse)
- The cascade dependency banner + Replace flow on Spell/Feat/Item/Class/Subclass editors
- The DRY-refactored editor hooks (`useProposalEntityDrafts`, `useProposalSingleWorkId`, `useProposalPreFlushSave`, `useDraftedEntityIds`, `useEditBaseUnlocks`, `useTombstoneBanner`, `useCascadeDependent`) and the `<ProposalAwareEditorHeader>` component

## The Cloudflare migration is done

The Vercel→Cloudflare Pages hosting migration is **complete**. Anything in the docs that frames Vercel as the current host is either stale (and should be fixed) or historical (correctly past-tense — leave as-is). Current production topology:

| Layer | Where it runs |
|---|---|
| Frontend SPA | Cloudflare Pages (`www.dauligor.com`) |
| `/api/*` surface | Cloudflare Pages Functions (`functions/api/*`) |
| D1 + R2 binding | Cloudflare Worker `dauligor-storage` (separate deploy via `wrangler deploy` from `worker/`) |
| Local dev | Express + Vite on `:3000`, `wrangler dev` worker on `:8787` |

No `vercel.json` exists in the repo. Routing for Pages Functions is file-based under `functions/api/*` with `[[path]].ts` for catch-alls.

## The migration gap that surfaced during this deploy

**Critical context for any future agent touching D1 migrations.**

Production D1's `d1_migrations` tracking table is **empty**. Wrangler has never managed migrations on prod D1 — existing tables were created via direct one-shot SQL execution, not via `wrangler d1 migrations apply`. The proposal-system migrations (`worlds`, `user_permissions`, `pending_revisions`, `proposal_bundles`, +5 follow-ups) had only ever been applied to local dev D1.

When today's push made the proposal-system code live on prod, `/api/me` immediately started returning 500 with `D1_ERROR: no such table: user_permissions`. The fix was running the 9 missing migrations directly against prod D1:

```bash
cd worker
npx wrangler d1 execute dauligor-db --remote --file=migrations/<each-of-the-9-proposal-migrations>.sql
```

(See `docs/rollback-2026-05-21-merge-to-main.md` "Post-deploy correction" banner for the full list and order.)

**Task #39** tracks the follow-up debt: backfill `d1_migrations` so future `wrangler d1 migrations apply` calls don't try to re-run every migration starting from `0001_phase1_foundation.sql`. **Until #39 is done:**

- ✅ Apply new migrations via `npx wrangler d1 execute dauligor-db --remote --file=<file>`
- ❌ Do NOT run `npx wrangler d1 migrations apply dauligor-db --remote`

## Operational reference: rollback procedure

If the post-deploy stress test surfaces a regression you can't quickly fix forward, the runbook is `docs/rollback-2026-05-21-merge-to-main.md`. Summary:

| Anchor | Value |
|---|---|
| Pre-merge `origin/main` commit | `3e45389` (also tagged on origin as `pre-merge-dry-pass-20260521`) |
| D1 Time Travel — pre-migration bookmark | `00000060-000001d8-00005072-845c9424ad25731c79a1a4e9aa21ed45` (resolves to `2026-05-21T01:55:00Z`) |
| D1 SQL backup (forensic / >30-day fallback) | `backups/dauligor-remote-20260521-0155.sql` (SHA256 `6a2be779...`) |

**Path A — code-only rollback (default)** for most failures:
```bash
git fetch origin
git checkout main
git reset --hard pre-merge-dry-pass-20260521
git push origin main --force-with-lease
# Cloudflare Pages auto-redeploys within 2-3 min
```
Leaves proposal tables harmlessly in prod D1; old code doesn't query them.

**Path B — full rollback** only if the new code corrupted pre-existing tables:
```bash
npm run backup:d1                           # forensic snapshot first
# Then Path A (code rollback) before D1 rollback
npm run timetravel -- restore 00000060-000001d8-00005072-845c9424ad25731c79a1a4e9aa21ed45 --confirm
```
This destroys any writes to existing tables (users, spells, classes, etc.) made after 01:55 UTC, in addition to dropping the proposal tables.

**The chat that ran the 2026-05-21 deploy is preserved as a fallback for D1-related questions** — if you hit a problem that this handoff doesn't cover, especially around the migration apply or rollback mechanics, that transcript has the full debug context.

## Read order for a fresh agent

1. **`docs/architecture/proposal-editor-pattern.md`** — the canonical contract for proposal-mode editors. Three gotchas in there are marked DO NOT regress.
2. **`docs/rollback-2026-05-21-merge-to-main.md`** — the incident-response doc. Lives on main until the stress test confirms stability.
3. **`src/components/proposals/README.md`** — entry-point tour of the proposal UI components + companion hooks.
4. **`docs/handoff-content-proposals-cascade.md`** — pre-deploy snapshot. Useful for the full commit chronology since the rollback tag `pre-dry-pass-2026-05-21`, plus the "what NOT to redo" list.
5. **`AGENTS.md`** + **`DIRECTORY_MAP.md`** — top-level guardrails + file resolution.

The older `docs/handoff-content-proposals-phase4-wiring.md` has been archived to `docs/_archive/` since the cascade handoff supersedes it. Look there only if you need Phase 4 architecture context not covered in the architecture doc.

## What's NOT pending right now

The following items have all been actioned and don't need redoing:

- DRY audit picks #1 + #10 (shipped in `3bdda92`)
- DRY audit picks #2 / #3 / #4 / #5 / #6 / #7 (shipped in the post-rebase `075f0ae`)
- Cascade Phases 2 / 3 / 4 (shipped in `62dfd60`)
- Cascade strategy expansion to `tag_group` / `unique_option_group` / `class` (shipped in `94e7f9c`)
- DialogContentLarge sweep on AdminProposals + Class/Subclass option-group dialogs (shipped in `075f0ae`)
- Cascade dependent banner wired in Class/Subclass editors (shipped in `075f0ae`)

`docs/_drafts/dry-audit-2026-05-21.md` and `docs/_drafts/stress-test-2026-05-21.md` are both already deleted (their content was fully actioned).

## Pending work — non-blocking feature-level design

Three items remain open at the feature-design level. None are blocking. They're parked because they need user input on scope before implementation:

| # | Task | Sketch |
|---|---|---|
| #24 | Self-serve world creation + per-block world selection | Currently the only world is the seeded `dauligor-base`. Users should be able to spin up their own world and target a block at it. |
| #25 | Per-world content gating | Owner of a world picks which base content (which classes, spells, tags, etc.) is allowed inside it. Combination of allow/deny lists + cascade enforcement at proposal-write time. |
| #26 | System page type with referenceable modular components | A wiki/page type that lets DMs assemble system docs from referenceable building blocks (e.g. a "House Rule" page that cites specific spell rules, scaling progressions, status conditions). Needs an audit-and-design pass before implementation. |

The handoff doc `docs/handoff-foundry-spell-manager.md` is a separate, unrelated work stream (Foundry module-side parity). Status unclear at the time of writing — review it on its own merits if you're picking up Foundry-export work, otherwise it can be left alone.

## What to watch in the post-deploy stress test

Failure modes ordered by likelihood:

1. **Hook regression in a wrapped editor** — the DRY pass refactored 6 editors. A useEffect dep-array mistake or ref-mirror staleness would manifest as a stale form snapshot getting submitted, or a queue entry being dropped. Suspects: `075f0ae`. Recover via Path A.
2. **Cascade strategy edge case** — the new `tag_group` / `unique_option_group` / `class` strategies haven't been exercised at scale. If a delete cascades to thousands of dependents, the 1000-revision cap will trip (the proposer will see "over_limit" in the cascade-preview response and submit will block). This is by design but the error UX hasn't been stress-tested.
3. **Migration drift between dev and prod** — the 9 proposal migrations are now on prod, but if your dev D1 has been clobbered/re-applied differently, schema may diverge subtly. Spot-check by querying `sqlite_master` from both and diffing.
4. **`/api/me` 500s reappearing** — would indicate the migration didn't fully land. Confirm with `npx wrangler d1 execute dauligor-db --remote --command="SELECT name FROM sqlite_master WHERE name='user_permissions'"`.

If any of these surface and a quick fix isn't obvious, prefer Path A rollback over thrashing in prod — the proposal system can re-deploy cleanly once the bug is fixed on a branch.

---

**Delete this doc when:** the post-deploy stress test confirms stability AND task #39 (`d1_migrations` backfill) is closed. Until then it's the single entry point for "what's going on with the production database right now".

# Rollback procedure — 2026-05-21 dry-pass merge to main

> **Post-deploy correction (2026-05-21 ~02:10 UTC):** This push was the
> proposal system's first production deploy. The proposal-system D1
> migrations had only ever been applied to local dev D1, never to
> remote prod D1 — which surfaced as `/api/me` 500s with
> `D1_ERROR: no such table: user_permissions` immediately after the
> push went live. **Fix applied:** the 9 proposal-system migrations
> (`20260518-1100_worlds_and_user_permissions.sql` through
> `20260520-1000_pending_revisions_pinned.sql`) were executed against
> prod D1 via `npx wrangler d1 execute dauligor-db --remote
> --file=<migration>` in chronological order. All additive — empty
> tables + one seeded default world (`dauligor-base`).
>
> **Going forward:** any future production deploy that depends on new
> D1 schema MUST run those migrations against remote D1 *before* the
> code push. The `d1_migrations` tracking table on remote prod is still
> empty (we used `d1 execute` directly, not `d1 migrations apply`) —
> see "D1 migration state debt" below.

---

If stress-testing in production surfaces a regression you can't quickly
fix forward, this is the recipe to restore the system. There are now
**two distinct rollback paths** depending on what failed:

| Scenario | Path | What it touches |
|---|---|---|
| **Code-only regression** (a feature broken by the new code; data is fine) | Path A — code rollback only | git history + Cloudflare Pages redeploy |
| **Data corruption** (existing tables got bad rows written by the new code) | Path B — full rollback (code + D1 Time Travel) | git + Cloudflare D1 Time Travel (SQL dump as fallback only) |

**Default to Path A.** The proposal-system migrations applied to prod D1
on 2026-05-21 ~02:10 UTC are *additive* — old code simply doesn't query
those tables and ignores them being there. So code-only rollback leaves
the proposal tables in prod D1 (empty, harmless) and there's nothing to
clean up.

**Only choose Path B** if you have concrete evidence that the new code
mutated existing tables (`users`, `spells`, `classes`, `characters`,
`tags`, etc.) in a way you need to undo. D1 rollback uses Cloudflare
Time Travel (point-in-time recovery, 30-day window) — the pre-migration
bookmark is captured in the snapshot table below. Time Travel rolling
back to `2026-05-21T01:55:00Z` will both:
- recover the existing tables to their 01:55 state (losing any legitimate
  writes since then), AND
- drop the four proposal-system tables (`worlds`, `user_permissions`,
  `pending_revisions`, `proposal_bundles`) entirely

so it's a coarser tool. If you go Path B, you must also do the code
rollback (Path A) FIRST — leaving new code running against the restored
DB would replay the original `no such table` errors.

---

## Pre-merge state snapshot

| Anchor | Value |
|---|---|
| Pre-merge `origin/main` commit | **`3e45389`** (`fix(pages): preserve binary request bodies for /api/r2/upload`) |
| Local + remote tag pointing at it | `pre-merge-dry-pass-20260521` |
| Current post-merge tip | `3953351` (`docs(content-proposals): record post-deploy migration-apply step + d1_migrations debt`) |
| **D1 Time Travel — pre-migration bookmark** | `00000060-000001d8-00005072-845c9424ad25731c79a1a4e9aa21ed45` (resolves to `2026-05-21T01:55:00Z`) |
| D1 backup file (local, secondary fallback) | `backups/dauligor-remote-20260521-0155.sql` |
| D1 backup SHA256 | `6a2be779feb07da2faa4b17280b1dc6450e686712bc3e860c629c2f4322c00d1` |
| D1 backup size | 5,516,053 bytes (5.4 MB) |
| D1 state at the bookmark / in the backup | Pre-migration: NO `worlds` / `user_permissions` / `pending_revisions` / `proposal_bundles` tables. The four migration-applied tables were created at ~02:10 UTC, AFTER both anchors. |

## Path A — code rollback only (default)

For most failure modes. Leaves the proposal-system tables in prod D1
(empty and unused after the rollback — old code doesn't query them).

```bash
# 1) From the repo root (or any worktree connected to the repo), make
#    sure your local main is up to date with origin.
git fetch origin
git checkout main
git status   # verify clean tree

# 2) Hard-reset main to the pre-merge commit.
git reset --hard pre-merge-dry-pass-20260521
# (equivalent to: git reset --hard 3e45389)

# 3) Force-push main to origin. The branch protection / hooks may need
#    to allow force-pushes — coordinate if not. --force-with-lease
#    fails safely if origin/main has moved since your fetch.
git push origin main --force-with-lease
```

**Cloudflare Pages deploy:** auto-rebuilds on push to `main`. Watch the
Cloudflare Pages dashboard for the new deployment to go live (~2–3 min).
That covers both the frontend AND the `functions/api/*` Pages Functions.

**Cloudflare Worker (`dauligor-storage`):** not touched by this push
cycle (lives in `worker/`; deployed separately via `wrangler deploy`).
No worker redeploy needed for this rollback.

After the force-push, the post-merge commits are still recoverable
via `git reflog` for ~30 days. The branch `claude/loving-banach-d76c40`
remains intact on origin with the post-merge state if you want to
revisit / retry — just don't merge it back into `main` without first
addressing whatever failure mode caused the rollback.

## Path B — full rollback (code + D1)

Only when there's evidence the new code corrupted existing tables. Do
Path A's code rollback first, THEN roll back D1. Order matters — if
new code is still live when D1 rolls back, the proposal-system queries
will start 500-ing again because the rollback drops the proposal
tables.

The preferred remote-restore mechanism is **Cloudflare D1 Time
Travel** — point-in-time recovery, free, transactional, 30-day window,
no schema clashes. The local SQL backup is a secondary fallback for
forensic / >30-day scenarios; it's NOT the right tool for routine
remote restore because `wrangler d1 execute --file=<dump>` against an
already-populated DB will fail with CREATE TABLE conflicts (see the
warning in `scripts/restore-d1.mjs`).

```bash
# 0) Take a forensic snapshot of the current (broken) prod state before
#    rolling back — gives you a diff target later for post-mortem.
npm run backup:d1
# Note the new filename it prints.

# 1) Do Path A (code rollback) first. Confirm Cloudflare Pages has
#    redeployed (~2-3 min after force-push) BEFORE doing step 2.

# 2) Verify the Time Travel bookmark resolves where we expect.
npm run timetravel -- info
# Shows the current bookmark (latest writes) — not what we want to
# restore to, but confirms the API works.

# 3) Restore D1 to the pre-migration bookmark.
npm run timetravel -- restore 00000060-000001d8-00005072-845c9424ad25731c79a1a4e9aa21ed45 --confirm
# (That bookmark id is already resolved from 2026-05-21T01:55:00Z —
# captured in the snapshot table above. The wrapper prints a 5-second
# Ctrl-C window before firing the restore.)
```

If the 30-day Time Travel window has expired (i.e. you're reading this
more than 30 days after 2026-05-21), or if Time Travel itself fails for
some reason, the SQL dump is the fallback. Note that a successful
remote restore from the SQL dump requires the target DB to be EMPTY
(otherwise CREATE TABLE clashes). The practical path looks like:

```bash
# Fallback (only if Time Travel unavailable):
# 1) Manually DROP every conflicting table on remote (DANGEROUS).
# 2) THEN: npm run restore:d1 -- --file dauligor-remote-20260521-0155.sql --remote --confirm
# Or: spin up a new D1 instance, restore into that, and re-point the
# binding via wrangler.toml + Pages dashboard.
```

> **What Time Travel restore actually does:** transactional rollback of
> the entire DB to the chosen bookmark. Any writes after the bookmark
> are LOST. The four proposal-system tables (`worlds`, `user_permissions`,
> `pending_revisions`, `proposal_bundles`) are dropped because they
> were created AFTER the chosen bookmark. Existing tables (`users`,
> `spells`, `classes`, `characters`, tag/lore content, etc.) revert
> to their 01:55 UTC state, losing any rows or edits made since then.
> If users have been actively editing prod between 01:55 UTC and now,
> their work in those existing tables will be discarded.

## Verification after rollback

After Path A (code-only):
- `/api/me` returns 200 with the user's profile (no `user_permissions`
  query happens in pre-merge code, so the table's existence doesn't
  matter).
- `/compendium/tags` loads + shows the expected tag count.
- The proposal-system UI surfaces (`/my-proposals`, `/proposals/edit/*`,
  the admin queue) are NO LONGER reachable from the sidebar — that's
  the rollback working. The code that rendered those links no longer
  exists.
- Pre-existing routes (Spells, Classes, Characters, Wiki, Image
  Manager, Admin/Users) work exactly as before this cycle.

After Path B (full rollback):
- All of the above, PLUS:
- The four proposal-system tables no longer exist in prod D1 — confirm
  via `npx wrangler d1 execute dauligor-db --remote --command="SELECT
  name FROM sqlite_master WHERE type='table' AND name='user_permissions'"`
  returning 0 rows.
- Any data created in existing tables between 01:55 UTC and the
  restore is gone — accept this as the cost of the data-corruption
  rollback path.

## What this merge contained (for forensic triage)

The ten commits in this push (`3e45389..3953351`):

```
3953351 docs(content-proposals): record post-deploy migration-apply step + d1_migrations debt
f95bf2b docs(content-proposals): rollback procedure for the 2026-05-21 dry-pass merge
28d38e8 docs(content-proposals): refresh architecture + handoff + components README for the DRY sweep
94e7f9c feat(content-proposals): expand cascade strategies — tag_group, unique_option_group, class
075f0ae refactor(content-proposals): five DRY hooks + ProposalAwareEditorHeader + cascade banner in Class/Subclass + dialog sweep
+ five earlier commits from the same session (handoff doc, Phase 2/3/4
  cascade system, tombstone-gap fix, architecture doc, cross-boundary
  dedup fix) — see `git log 3e45389..3953351`
```

Note: the 65 commits in this push include the ENTIRE proposal system
going back to Phase 1 foundation — this was the proposal system's
first prod deploy. Pre-merge prod had NONE of the proposal-system code.

If the failure looks like a DRY-refactor regression (hook deps, ref-
mirror staleness, queue dedup edge case), the prime suspects are
`075f0ae` and the earlier hook-extraction commit. If it's a cascade-
strategy regression specifically, `94e7f9c` and the earlier cascade
infrastructure commit are the candidates. If it's a generic proposal-
system bug (e.g. write path failure, focus-mode lock-up), the entire
range is suspect — but a code-only rollback covers any of those at
once.

The pre-DRY rollback safety tag `pre-dry-pass-2026-05-21` (`6945895`)
also exists if you want to roll the branch state forward from the
cascade work but skip the DRY sweep — cherry-pick the cascade strategy
expansion + the pre-rebase cascade commit onto that base. This is a
"keep the proposal-system feature but undo the DRY refactor" option,
relevant only if the DRY work is clearly the culprit and the cascade
work is clearly clean.

---

**This doc can be deleted once the post-merge stress test confirms the
production system is stable.** Until then, keep it discoverable — it's
the only place that ties the backup file SHA + pre-merge commit SHA +
restore procedure together.

---

## D1 migration state debt (followup, non-blocking)

Prod D1's `d1_migrations` tracking table is empty. Today's nine
proposal-system migrations were applied via `d1 execute --file=...`
which does NOT update `d1_migrations`. That means a future
`npx wrangler d1 migrations apply dauligor-db --remote` would try to
re-apply every migration starting from `0001_phase1_foundation.sql`,
which would conflict with the existing schema.

**Don't run `migrations apply` against prod until this is reconciled.**

The reconciliation work, when ready:

1. Inspect prod schema (`SELECT sql FROM sqlite_master WHERE type='table'`)
   to derive which migrations are effectively applied.
2. Backfill `d1_migrations` with INSERT statements naming every applied
   migration in chronological order, including the nine we ran today.
3. Then `migrations apply` becomes safe again for future migrations.

Recommended migration commands going forward (until step 3 is done):
- For each new SQL migration file: `npx wrangler d1 execute dauligor-db
  --remote --file=migrations/<new-file>.sql`
- Manually add the file name to `d1_migrations` if you want future
  `migrations apply` to skip it.
- OR adopt the convention that all migrations go through `d1 execute`
  for now until reconciliation is done.

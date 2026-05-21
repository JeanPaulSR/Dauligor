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

If stress-testing in production after this merge surfaces a regression
you can't quickly fix forward, this is the exact recipe to restore both
**code** and **D1 data** to the pre-merge state.

> Treat this as a single atomic operation: roll back code AND D1
> together. A code-only rollback is fine because the proposal system is
> additive — old code can read the post-merge D1 schema (nothing was
> dropped this cycle). A D1-only rollback while the new code is live
> would break runtime if any new proposal-revision rows reference cascade
> columns the old schema doesn't have. **In doubt: roll back both.**

---

## Pre-merge state snapshot

| Anchor | Value |
|---|---|
| Pre-merge `origin/main` commit | **`3e45389`** (`fix(pages): preserve binary request bodies for /api/r2/upload`) |
| Local tag pointing at it | `pre-merge-dry-pass-20260521` |
| D1 backup file | `backups/dauligor-remote-20260521-0155.sql` |
| D1 backup SHA256 | `6a2be779feb07da2faa4b17280b1dc6450e686712bc3e860c629c2f4322c00d1` |
| D1 backup size | 5,516,053 bytes (5.4 MB) |
| Post-merge tip (what got pushed) | `28d38e8` (`docs(content-proposals): refresh architecture + handoff + components README for the DRY sweep`) |

## Rollback — code

```bash
# 1) Verify you're on the worktree root (where the .git lives or its gitlink does).
git status

# 2) Hard-reset main locally to the pre-merge commit.
git checkout main
git fetch origin
git reset --hard 3e45389   # or: git reset --hard pre-merge-dry-pass-20260521

# 3) Force-push main to origin. This rewrites the public history —
#    coordinate with anyone else who might have pulled the post-merge
#    main, or they will get rejected pushes on their next pull.
git push origin main --force-with-lease

# 4) Vercel will auto-deploy the previous frontend within a minute or
#    two. Watch the Vercel dashboard for the new deployment to land.

# 5) If the Cloudflare Worker was also deployed from main and needs to
#    roll back, redeploy from the pre-merge commit:
cd worker
npx wrangler deploy
```

After the force-push, the post-merge commits are still recoverable via
`git reflog` for ~30 days even though they're no longer on a branch.
The branch `claude/loving-banach-d76c40` still exists locally with the
post-merge state if you want to retry the merge later — push it back
with a different name if you want to keep the SHAs.

## Rollback — D1

The backup file is a plain SQL dump created by `wrangler d1 export
--remote`. Restore in two steps:

```bash
# 1) Verify the backup's integrity before restoring.
node scripts/restore-d1.mjs --list
# Look for: dauligor-remote-20260521-0155.sql with SHA256 6a2be779...

# 2) Restore it to the REMOTE D1.
node scripts/restore-d1.mjs backups/dauligor-remote-20260521-0155.sql
# Or whatever the script's actual restore invocation is — check
# scripts/restore-d1.mjs --help if the CLI differs from what's
# documented here.
```

> **Caution before restore:** the restore replays the SQL dump against
> the live database. Any rows written AFTER the backup was taken
> (`2026-05-21T01:55Z`) will be LOST. Decide whether to:
> - Take a fresh backup of the current (broken) production state first
>   so you can forensic-diff later (`npm run backup:d1`).
> - Or skip that step if the breakage clearly didn't write any
>   important data.

## Verification after rollback

Quick sanity checks the rollback worked:

- `/api/health` or whatever health endpoint exists returns 200.
- `/compendium/tags` loads + shows the expected tag count.
- `/my-proposals` for a content-creator user shows their old submissions.
- The proposal-mode `/proposals/edit/spells` route still loads (proposal
  routing itself has been on main for a while — only the DRY refactor
  and cascade expansions were merged this cycle, so the route shape
  shouldn't change).
- One end-to-end content-creator test: edit a base tag → submit a block
  → admin approve. Confirms the proposal pipeline is still wired.

## What this merge contained (for forensic triage)

The eight new commits in this push (`3e45389..28d38e8`):

```
28d38e8 docs(content-proposals): refresh architecture + handoff + components README for the DRY sweep
94e7f9c feat(content-proposals): expand cascade strategies — tag_group, unique_option_group, class
075f0ae refactor(content-proposals): five DRY hooks + ProposalAwareEditorHeader + cascade banner in Class/Subclass + dialog sweep
[5 earlier commits from the same session — see git log]
```

If the failure looks like a DRY-refactor regression (hook deps, ref-
mirror staleness, queue dedup edge case), the prime suspects are
`075f0ae` and `94e7f9c`. If it's a cascade-strategy regression
specifically, `94e7f9c` and `62dfd60` (the original cascade work) are
the candidates.

The pre-DRY rollback safety tag `pre-dry-pass-2026-05-21` (`6945895`)
is also still available if you want to roll the branch state forward
from the cascade work but skip the DRY sweep — cherry-pick the cascade
strategy expansion (`94e7f9c` and the pre-rebase `62dfd60`) onto that
base.

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

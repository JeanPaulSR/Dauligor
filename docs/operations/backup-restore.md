# D1 Backup & Restore

The Archive's data lives in a single Cloudflare D1 database (`dauligor-db`).
Two recovery layers protect it:

1. **Cloudflare Time Travel** — built-in, free, transactional point-in-time
   recovery. 30-day retention. **This is the primary recovery path.**
2. **Local SQL dumps** — `wrangler d1 export` snapshots stored under
   `backups/` (gitignored). Best for offsite archival, diffing, or seeding a
   local dev database.

When something goes wrong on the remote DB, **reach for Time Travel first.**
SQL-dump restore is for local testing or when you've left Time Travel's window.

---

## Quick reference

```bash
# Dump remote D1 to backups/dauligor-remote-YYYYMMDD-HHmm.sql (+ .sha256)
npm run backup:d1

# Variants
node scripts/backup-d1.mjs --schema-only        # schema only
node scripts/backup-d1.mjs --data-only          # data only
node scripts/backup-d1.mjs --prune-days 30      # also delete dumps older than 30d
node scripts/backup-d1.mjs --push-r2            # also upload to private R2 bucket
node scripts/backup-d1.mjs --local              # dump local .wrangler state instead

# Recommended scheduled-task command (combines all the above):
node scripts/backup-d1.mjs --prune-days 30 --push-r2

# List existing dumps
npm run backup:d1:list

# Restore (LOCAL by default — safe)
node scripts/restore-d1.mjs --latest
node scripts/restore-d1.mjs --file dauligor-remote-20260508-1118.sql

# Cloudflare Time Travel — free 30-day point-in-time recovery
npm run timetravel -- info
npm run timetravel -- bookmark 2026-05-08T11:00:00Z
npm run timetravel -- restore <bookmark> --confirm
```

---

## Offsite redundancy: the `dauligor-backups` R2 bucket

`--push-r2` uploads the SQL dump and its `.sha256` sidecar to the
**private** `dauligor-backups` R2 bucket. This bucket has no custom
hostname and no public read URL — only the Cloudflare account owner can
access it via wrangler or the dashboard. Object keys live under
`backups/`.

To list what's in R2:
```bash
# In the Cloudflare dashboard: R2 -> dauligor-backups -> Objects
# Or via wrangler (objects must be fetched by exact key):
cd worker
npx wrangler r2 object get "dauligor-backups/backups/<filename>.sql.sha256" --remote --pipe
```

To pull a backup back down from R2:
```bash
cd worker
npx wrangler r2 object get \
  "dauligor-backups/backups/dauligor-remote-20260508-1118.sql" \
  --remote \
  --file ../backups/dauligor-remote-20260508-1118.sql
```

The `dauligor-backups` bucket is **separate from** the public
`dauligor-storage` bucket used for images. It was deliberately created
private so that timestamped (and thus guessable) backup keys are not
publicly readable through the `images.dauligor.com` CDN.

## Nightly automated backup (Windows)

A scheduled task can run the backup nightly without prompting. Two
PowerShell helpers ship in `scripts/`:

```powershell
# Register the task (defaults: 3am daily, prune 30d, push to R2)
.\scripts\install-nightly-backup.ps1

# Variations
.\scripts\install-nightly-backup.ps1 -At 4am -PruneDays 60
.\scripts\install-nightly-backup.ps1 -PushR2:$false   # local-only
.\scripts\install-nightly-backup.ps1 -ProjectPath "E:\DnD\Professional\Dev\Dauligor"

# Test it manually
Start-ScheduledTask -TaskName "Dauligor D1 Nightly Backup"
Get-ScheduledTaskInfo -TaskName "Dauligor D1 Nightly Backup"

# Remove
.\scripts\uninstall-nightly-backup.ps1
```

**⚠️ Don't install this from a `.claude/worktrees/<name>/` worktree.**
The worktree gets cleaned up when its branch is merged or pruned, which
silently breaks the task. Install it from the main repo path
(`E:\DnD\Professional\Dev\Dauligor`) once the backup branch is merged
into `main`. Pass `-ProjectPath` if you need to override.

The task runs as the current user, requires no admin to register, and
fires only when the user is logged on. To run while logged out, use:
`Register-ScheduledTask -User <name> -Password ...`.

## Recommended cadence

| Trigger | Action |
|---|---|
| Before any destructive script run (mass delete, schema migration, importer with `--write`) | `npm run backup:d1`, then capture a Time Travel bookmark with `npm run timetravel -- info` |
| Weekly (or before a stretch of heavy editing) | `npm run backup:d1` |
| Post-incident | `npm run backup:d1` immediately after recovery so the post-incident state is preserved before further changes |
| Schema migration (new `worker/migrations/000X_*.sql`) | `npm run backup:d1` BEFORE applying with `wrangler d1 migrations apply` |

A nightly cron is optional — Time Travel already covers 30 days for free.
Local dumps add value mainly when you want a snapshot you can read,
diff, or re-import elsewhere.

---

## Recovery scenarios

### "I just ran a bad UPDATE/DELETE on remote"

Use Time Travel — fastest, no schema clashes, atomic.

```bash
# 1. Capture the bookmark from a moment BEFORE the bad write.
#    Pick a timestamp 1-2 minutes before the mistake.
npm run timetravel -- bookmark 2026-05-08T10:55:00Z
# -> prints a bookmark id like 00000005-00000010-...

# 2. Restore.
npm run timetravel -- restore <bookmark-id> --confirm
```

The whole DB rolls back atomically. All writes after the bookmark are gone.

### "I want to test a risky migration locally first"

Pull a fresh remote snapshot into local D1.

```bash
# 1. Get a snapshot of remote.
npm run backup:d1

# 2. Nuke local D1 so the import doesn't clash with existing tables.
#    (Stop wrangler dev first if it's running — it locks the sqlite file.)
rm worker/.wrangler/state/v3/d1/*/db.sqlite

# 3. Restore the dump locally.
node scripts/restore-d1.mjs --latest  # picks the newest backup

# 4. Run wrangler dev and try your migration against the local copy.
cd worker && npx wrangler dev
```

### "Time Travel window has expired (>30 days)"

You're relying on local SQL dumps. The dump is a full schema + data
recreation, so to restore over an existing remote DB you'd need to drop
all tables first — risky and not automated by this toolchain.

If you find yourself here, the recommended path is:

1. Stand up a fresh D1 instance: `npx wrangler d1 create dauligor-db-restore`
2. Apply the dump there: `node scripts/restore-d1.mjs --file <dump> --remote --confirm`
   (You'll need to swap the `DB_NAME` in the script or pass it via env.)
3. Validate by pointing a worker at the restored DB.
4. Once validated, swap the production binding to the restored DB in
   `worker/wrangler.toml` and redeploy. Old DB stays as a safety net.

---

## Backup file format

```
backups/
  dauligor-remote-20260508-1118.sql         # the SQL dump
  dauligor-remote-20260508-1118.sql.sha256  # checksum sidecar
```

Filename: `dauligor-{remote|local}-YYYYMMDD-HHmm[-schema|-data].sql`.

The `.sha256` sidecar is verified automatically before restore. A
mismatch aborts the restore.

`backups/` is gitignored ([.gitignore:15](../../.gitignore#L15)). Don't
commit dumps — they contain user data.

---

## Why two layers?

Time Travel covers ~99% of "oh no" scenarios within its window with the
fastest recovery time. SQL dumps are slower and have schema-clash
gotchas, but:

- They're a forensic record you can `git diff`-style compare across days.
- They survive D1 account/team-level disasters (Time Travel is bound to
  the live DB; if the DB is deleted, Time Travel goes with it).
- They let you bootstrap a brand-new local DB without depending on the
  remote being online.
- They can be uploaded to R2 (or any other storage) for true offsite
  redundancy.

---

## Related docs

- [local-dev.md](local-dev.md) — full local dev setup
- [deployment.md](deployment.md) — promoting changes to remote
- [troubleshooting.md](troubleshooting.md) — generic recovery
- [Cloudflare D1 Time Travel docs](https://developers.cloudflare.com/d1/reference/time-travel/) — upstream reference

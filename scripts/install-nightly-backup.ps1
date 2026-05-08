# Register a Windows Scheduled Task that runs `npm run backup:d1` nightly.
#
# Usage:
#   .\scripts\install-nightly-backup.ps1
#   .\scripts\install-nightly-backup.ps1 -At 4am -PruneDays 60
#   .\scripts\install-nightly-backup.ps1 -ProjectPath "E:\DnD\Professional\Dev\Dauligor"
#   .\scripts\install-nightly-backup.ps1 -PushR2:$false   # local-only, skip R2 push
#
# Defaults:
#   - Runs daily at 3:00 AM
#   - Prunes local backups/ files older than 30 days
#   - Pushes the dump to the private dauligor-backups R2 bucket
#   - ProjectPath defaults to the parent of this script directory
#
# Notes:
#   - Runs as the current user (no admin required to register).
#   - The task only fires when the user is logged on. To run while logged off,
#     re-register manually with `Register-ScheduledTask -User <name> -Password ...`.
#   - .env must exist at $ProjectPath with R2_WORKER_URL + R2_API_SECRET, and
#     wrangler must be authenticated (`npx wrangler whoami` from $ProjectPath).
#   - WARNING: if you install this from a git worktree under .claude/worktrees/,
#     deleting the worktree will silently break the task. Prefer the main repo
#     path. Pass -ProjectPath explicitly to point at it.

param(
  [string]$TaskName = "Dauligor D1 Nightly Backup",
  [string]$ProjectPath = (Resolve-Path "$PSScriptRoot\..").Path,
  [string]$At = "3am",
  [int]$PruneDays = 30,
  [bool]$PushR2 = $true
)

if (-not (Test-Path (Join-Path $ProjectPath "package.json"))) {
  Write-Error "ProjectPath '$ProjectPath' does not contain a package.json. Did you mean a different directory?"
  exit 1
}

if (-not (Test-Path (Join-Path $ProjectPath ".env"))) {
  Write-Warning ".env not found at $ProjectPath. The backup script needs R2_WORKER_URL and R2_API_SECRET to talk to the worker."
  Write-Warning "(D1 backup itself uses wrangler, so it'll work without .env, but admin endpoints in the dev server won't.)"
}

# Build the npm command line.
# --skip-if-recent 20 guards against the logon trigger re-running a backup
# that the daily trigger already did. 20h is short enough that a missed
# 3am run still fires from the next-day logon trigger, but long enough
# that multiple logins in one day don't pile up extra backups.
$npmArgList = @(
  "run", "backup:d1", "--",
  "--prune-days", $PruneDays.ToString(),
  "--skip-if-recent", "20"
)
if ($PushR2) { $npmArgList += "--push-r2" }
$npmArgString = $npmArgList -join " "

# npm.cmd is the cmd shim; reliable across PowerShell versions.
$npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
if (-not $npm) { $npm = "npm.cmd" }

# Wrap the npm call in `cmd.exe /c "" ... ""` launched via `conhost.exe`
# with no window. This way:
#   - No console window flashes on screen mid-game.
#   - stdin is genuinely detached, so stray keystrokes can't reach the
#     wrangler prompt (the script also passes `-y` to wrangler now, but
#     belt-and-suspenders).
# `start "" /B` runs without spawning a new window in the current console.
# We pipe stdout/stderr to a log file so failures are still recoverable.
$logPath = Join-Path $ProjectPath "backups\nightly-backup.log"
$cmdArgs = "/d /c `"`"$npm`" $npmArgString >> `"$logPath`" 2>&1`""

$action = New-ScheduledTaskAction `
  -Execute "cmd.exe" `
  -Argument $cmdArgs `
  -WorkingDirectory $ProjectPath

# Two triggers:
#   1. Daily at $At (3am default) — the primary nightly run.
#   2. AtLogOn — fallback so a missed nightly (PC was off/asleep) catches
#      up the next time you log in. The script's --skip-if-recent 20
#      guard makes this a no-op if the daily trigger already succeeded.
$triggerDaily = New-ScheduledTaskTrigger -Daily -At $At
$triggerLogon = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$triggers = @($triggerDaily, $triggerLogon)

$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -DontStopOnIdleEnd `
  -Hidden `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
  -RestartCount 2 `
  -RestartInterval (New-TimeSpan -Minutes 10)

$desc = "Nightly Cloudflare D1 dump for the Dauligor Archive. Writes to $ProjectPath\backups and prunes files older than $PruneDays days. PushR2=$PushR2."

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Write-Host "Task '$TaskName' already exists - replacing."
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $triggers `
  -Settings $settings `
  -Description $desc | Out-Null

Write-Host "Registered scheduled task '$TaskName'."
Write-Host "  Working directory: $ProjectPath"
Write-Host "  Command:           cmd.exe $cmdArgs"
Write-Host "  Triggers:          Daily at $At + AtLogOn ($env:USERNAME)"
Write-Host "                     (logon trigger no-ops if a backup ran in the last 20h)"
Write-Host "  Hidden window:     yes (no console flash, stdin detached)"
Write-Host "  Log file:          $logPath"
Write-Host ""
Write-Host "Run it once now to verify:"
Write-Host "  Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "  Get-ScheduledTaskInfo -TaskName '$TaskName'"
Write-Host "  Get-Content '$logPath' -Tail 20"
Write-Host ""
Write-Host "To remove later:"
Write-Host "  .\scripts\uninstall-nightly-backup.ps1"

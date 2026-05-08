# Remove the nightly D1 backup scheduled task.
#
# Usage:
#   .\scripts\uninstall-nightly-backup.ps1
#   .\scripts\uninstall-nightly-backup.ps1 -TaskName "Some Other Name"

param(
  [string]$TaskName = "Dauligor D1 Nightly Backup"
)

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Removed scheduled task '$TaskName'."
} else {
  Write-Host "No scheduled task named '$TaskName' was found. Nothing to do."
}

# =============================================================================
# setup-claude-commits.ps1 — One-time setup for Claude-driven autonomous commits.
#
# Run this ONCE from the repo root:
#   pwsh -ExecutionPolicy Bypass -File .\setup-claude-commits.ps1
#
# What it does:
#   1. Writes .git/hooks/pre-commit (syntax-check guard)
#   2. Registers a Windows Scheduled Task "ClaudeCurriculumWatcher" that runs
#      claude-watcher.ps1 at logon, hidden, and restarts it if it dies.
#   3. Starts the task immediately so you don't have to log out/in.
#
# Idempotent: safe to re-run after pulling updates to the watcher/commit scripts.
# To remove everything, run:  .\setup-claude-commits.ps1 -Uninstall
# =============================================================================

param(
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$repoRoot     = Split-Path -Parent $MyInvocation.MyCommand.Path
$hookPath     = Join-Path $repoRoot '.git\hooks\pre-commit'
$watcherPath  = Join-Path $repoRoot 'claude-watcher.ps1'
$taskName     = 'ClaudeCurriculumWatcher'

function Write-Step($msg) { Write-Host "[setup] $msg" -ForegroundColor Cyan }

if ($Uninstall) {
  Write-Step "Uninstalling..."
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  if (Test-Path $hookPath) { Remove-Item $hookPath -Force }
  Write-Step "Done. Hook and scheduled task removed. (Scripts and sentinel left in place.)"
  exit 0
}

# ---- 1. Pre-commit hook ----
Write-Step "Installing pre-commit hook → $hookPath"
$hookDir = Split-Path -Parent $hookPath
if (-not (Test-Path $hookDir)) {
  Write-Host "[setup] WARN: $hookDir does not exist. Is this a git repo?" -ForegroundColor Yellow
  exit 1
}
$hookContent = @'
#!/bin/sh
# pre-commit: block commits where app.js or data.js fails to parse.
# Installed by setup-claude-commits.ps1. Bypass with --no-verify if you must.
set -e
CHANGED=$(git diff --cached --name-only --diff-filter=ACM)
echo "$CHANGED" | grep -q '^app\.js$'  && { echo "[pre-commit] node --check app.js";  node --check app.js;  } || true
echo "$CHANGED" | grep -q '^data\.js$' && { echo "[pre-commit] node --check data.js"; node --check data.js; } || true
echo "[pre-commit] OK"
exit 0
'@
# Write with LF endings — Git on Windows runs hooks through sh which wants Unix line endings.
$bytes = [System.Text.UTF8Encoding]::new($false).GetBytes(($hookContent -replace "`r`n", "`n"))
[System.IO.File]::WriteAllBytes($hookPath, $bytes)
Write-Step "Hook installed ($($bytes.Length) bytes)."

# ---- 2. Scheduled Task ----
Write-Step "Registering Scheduled Task '$taskName'..."

# Build the command. -NoProfile keeps startup fast; -WindowStyle Hidden keeps it invisible.
$pwsh = (Get-Command pwsh -ErrorAction SilentlyContinue)
if (-not $pwsh) {
  $pwsh = (Get-Command powershell -ErrorAction Stop)
  Write-Host "[setup] NOTE: pwsh (PowerShell 7) not found; falling back to Windows PowerShell." -ForegroundColor Yellow
}
$pwshExe = $pwsh.Source

$action  = New-ScheduledTaskAction -Execute $pwshExe -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$watcherPath`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

# Replace if exists.
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal | Out-Null

# Kick it off now so user doesn't have to log out/in.
Start-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 2
$state = (Get-ScheduledTask -TaskName $taskName | Get-ScheduledTaskInfo).LastTaskResult
Write-Step "Task registered and started. LastTaskResult code: $state (0 or 267009 = running)."

Write-Step "Setup complete."
Write-Host ""
Write-Host "Verify:" -ForegroundColor Green
Write-Host "  - Task:    Get-ScheduledTask -TaskName $taskName"
Write-Host "  - Watcher: tail .claude-watcher.log    # PowerShell: Get-Content .claude-watcher.log -Wait"
Write-Host "  - Trigger: write { `"message`": `"test`" } to .claude-commit-request → expect a commit"
Write-Host ""
Write-Host "To uninstall:  .\setup-claude-commits.ps1 -Uninstall"

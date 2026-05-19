# =============================================================================
# claude-watcher.ps1 — Sentinel-file watcher that lets Claude trigger commits.
#
# Watches:  <repo>\.claude-commit-request
# When that file is changed with a JSON payload like:
#   { "message": "feat: short description" }
# the watcher reads the message, invokes commit.ps1, then clears the file.
#
# Architecture:
#   - A FileSystemWatcher fires only a tiny event handler that flips a
#     $Global flag. The handler does no heavy work — heavy work in event
#     handlers under Register-ObjectEvent is fragile (scope quirks, action
#     can fail silently and stop re-arming).
#   - A polling main loop in the main script scope picks up the flag and
#     runs Process-Request. This is the only place subprocesses run, so
#     scope/access to variables and functions is straightforward.
#   - Sentinel content is also re-scanned every poll tick, so if the
#     watcher is restarted with a pending message in the sentinel it gets
#     picked up immediately (no need to "touch" the file).
#
# Started by Task Scheduler ("ClaudeCurriculumWatcher") under whatever
# PowerShell was detected at setup time. Logs to .claude-watcher.log.
# =============================================================================

$ErrorActionPreference = 'Continue'   # main loop must survive errors
$repoRoot      = Split-Path -Parent $MyInvocation.MyCommand.Path
$sentinel      = Join-Path $repoRoot '.claude-commit-request'
$logFile       = Join-Path $repoRoot '.claude-watcher.log'
$commitPs1     = Join-Path $repoRoot 'commit.ps1'
$debounceMs    = 1500
$subprocessTimeoutSec = 120

# ---- PowerShell exe detection ----
# Prefer pwsh (PowerShell 7) if installed; fall back to Windows PowerShell.
# This avoids the historical bug where the watcher was hardcoded to pwsh
# and failed silently on machines without PS7.
$pwshExe = $null
try { $pwshExe = (Get-Command pwsh -ErrorAction Stop).Source } catch {}
if (-not $pwshExe) {
  try { $pwshExe = (Get-Command powershell -ErrorAction Stop).Source } catch {}
}
if (-not $pwshExe) {
  Add-Content -Path $logFile -Value ("[{0}] FATAL: neither pwsh nor powershell.exe found on PATH" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
  exit 1
}

function Log {
  param([string]$msg)
  $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Add-Content -Path $logFile -Value $line
  Write-Host $line
}

if (-not (Test-Path $commitPs1)) {
  Log "FATAL: commit.ps1 not found at $commitPs1"
  exit 1
}

Log "Starting watcher on $sentinel"
Log "  shell      = $pwshExe"
Log "  commit.ps1 = $commitPs1"
Log "  log file   = $logFile"

# Ensure the sentinel exists so we can read from it on every poll.
if (-not (Test-Path $sentinel)) { Set-Content -Path $sentinel -Value '{}' -NoNewline }

# ---- Process one sentinel read ----
# Returns:
#   $true  if a commit was attempted (whether successful or not)
#   $false if the sentinel was empty/invalid/lacking a message (no-op)
function Process-Sentinel {
  if (-not (Test-Path $sentinel)) { return $false }
  $raw = (Get-Content -Path $sentinel -Raw -ErrorAction SilentlyContinue)
  if (-not $raw -or -not $raw.Trim() -or $raw.Trim() -eq '{}') { return $false }

  $payload = $null
  try { $payload = $raw | ConvertFrom-Json } catch {
    Log "Sentinel JSON invalid; clearing to recover. Raw: $($raw.Trim())"
    Set-Content -Path $sentinel -Value '{}' -NoNewline
    return $false
  }
  $msg = $payload.message
  if (-not $msg -or -not $msg.Trim()) { return $false }

  Log "Triggering commit: $msg"

  # Force git to fail fast instead of prompting for credentials in this
  # non-interactive subprocess. If a credential prompt appears, the user
  # sees an error in the log rather than a silent hang.
  $env:GIT_TERMINAL_PROMPT = '0'

  # Capture stdout+stderr line by line via Start-Process redirection. This
  # gives us a hard timeout (kill subprocess after $subprocessTimeoutSec).
  $tmpOut = [System.IO.Path]::GetTempFileName()
  $tmpErr = [System.IO.Path]::GetTempFileName()
  $procArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $commitPs1, '-Message', $msg)
  try {
    $proc = Start-Process -FilePath $pwshExe -ArgumentList $procArgs `
              -NoNewWindow -PassThru `
              -RedirectStandardOutput $tmpOut -RedirectStandardError $tmpErr `
              -WorkingDirectory $repoRoot
    $finished = $proc.WaitForExit($subprocessTimeoutSec * 1000)
    if (-not $finished) {
      try { $proc.Kill() } catch {}
      Log "Subprocess exceeded ${subprocessTimeoutSec}s timeout; killed. Sentinel preserved."
      return $true
    }
    $exit = $proc.ExitCode
    # Stream the subprocess output into our log.
    Get-Content -Path $tmpOut -ErrorAction SilentlyContinue | ForEach-Object { Log "  > $_" }
    $errLines = Get-Content -Path $tmpErr -ErrorAction SilentlyContinue
    if ($errLines) { $errLines | ForEach-Object { Log "  ! $_" } }
    if ($exit -eq 0) {
      Log "Commit OK; clearing sentinel."
      Set-Content -Path $sentinel -Value '{}' -NoNewline
    } else {
      Log "Commit returned exit $exit; leaving sentinel for inspection."
    }
  } finally {
    Remove-Item -Path $tmpOut, $tmpErr -ErrorAction SilentlyContinue
  }
  return $true
}

# ---- FileSystemWatcher → flag flip only ----
$Global:ClaudeCommitPending = $false

$watcher = New-Object System.IO.FileSystemWatcher
$watcher.Path = $repoRoot
$watcher.Filter = '.claude-commit-request'
$watcher.IncludeSubdirectories = $false
$watcher.NotifyFilter = [System.IO.NotifyFilters]::LastWrite -bor [System.IO.NotifyFilters]::CreationTime -bor [System.IO.NotifyFilters]::Size
$watcher.EnableRaisingEvents = $true

# Tiny action: just flip the global flag. Scope quirks here don't matter
# because we use $Global: which crosses runspaces reliably.
$action = { $Global:ClaudeCommitPending = $true }
Register-ObjectEvent -InputObject $watcher -EventName 'Changed' -Action $action | Out-Null
Register-ObjectEvent -InputObject $watcher -EventName 'Created' -Action $action | Out-Null

# Pick up any pre-existing pending sentinel content immediately on startup,
# so restarts don't strand a request that was written while we were down.
$Global:ClaudeCommitPending = $true

Log "Watcher ready. Edit $sentinel with a JSON message to trigger a commit."

# ---- Main polling loop ----
# Sleeps in short ticks. When the flag is set, debounces briefly (so rapid
# successive writes coalesce into one commit) and processes the sentinel.
# All work happens here, in the main script scope.
while ($true) {
  try {
    if ($Global:ClaudeCommitPending) {
      $Global:ClaudeCommitPending = $false
      Start-Sleep -Milliseconds $debounceMs
      # If more events arrived during the debounce window, clear the flag
      # again; we'll re-read the sentinel anyway, so a single processing
      # pass picks up the latest state.
      $Global:ClaudeCommitPending = $false
      Process-Sentinel | Out-Null
    }
  } catch {
    # Never crash the loop. Log and continue.
    Log "Loop error (continuing): $_"
  }
  Start-Sleep -Milliseconds 500
}

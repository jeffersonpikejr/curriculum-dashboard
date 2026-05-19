# =============================================================================
# commit.ps1 — Validate + commit + push the curriculum dashboard.
#
# Called by:
#   - claude-watcher.ps1 (automatic, when .claude-commit-request changes)
#   - You, manually:  pwsh .\commit.ps1 "Your message here"
#
# Behavior:
#   1. node --check app.js and data.js (fast syntax gate)
#   2. Bump APP_VERSION in app.js to "v{nextCount} · {timestamp}" so the page
#      footer shows a fresh stamp on every commit. Lets you hard-refresh and
#      confirm at-a-glance that the deploy fired.
#   3. git add -A
#   4. git commit -m "<message>"  (skipped if nothing staged)
#   5. git push
#
# Exit codes:
#   0 = success (or nothing to commit)
#   1 = syntax check failed
#   2 = git operation failed
#
# The pre-commit hook is a second line of defense; this script's node-check
# is redundant but gives a faster error message before git runs.
# =============================================================================

param(
  [Parameter(Position = 0)]
  [string]$Message = "Claude session update $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $repoRoot

Write-Host "[commit] repo: $repoRoot"
Write-Host "[commit] message: $Message"

# ---- 1. Syntax gate ----
foreach ($f in @('app.js', 'data.js')) {
  if (Test-Path $f) {
    Write-Host "[commit] node --check $f"
    & node --check $f
    if ($LASTEXITCODE -ne 0) {
      Write-Host "[commit] ABORT: $f failed syntax check" -ForegroundColor Red
      exit 1
    }
  }
}

# ---- 1.5. Version bump ----
# Regex-replaces the APP_VERSION literal in app.js. Build number is
# (count of commits reachable from HEAD) + 1, so each new commit increments
# monotonically. Failure here is non-fatal — we log and continue.
if (Test-Path 'app.js') {
  try {
    $count = & git rev-list --count HEAD 2>$null
    if (-not $count) { $count = 0 }
    $next = [int]$count + 1
    $ts = Get-Date -Format 'yyyy-MM-dd HH:mm'
    $version = "v$next | $ts"
    $appJs = Get-Content -Raw -Path 'app.js'
    $pattern = "const APP_VERSION = '[^']*';"
    if ($appJs -match $pattern) {
      $updated = [regex]::Replace($appJs, $pattern, "const APP_VERSION = '$version';")
      # Preserve original encoding/line endings by writing as bytes.
      $bytes = [System.Text.UTF8Encoding]::new($false).GetBytes($updated)
      [System.IO.File]::WriteAllBytes((Resolve-Path 'app.js'), $bytes)
      Write-Host "[commit] version -> $version"
    } else {
      Write-Host "[commit] APP_VERSION constant not found in app.js; skipping bump" -ForegroundColor Yellow
    }
  } catch {
    Write-Host "[commit] version bump failed (continuing): $_" -ForegroundColor Yellow
  }
}

# ---- 2. Stage ----
& git add -A
if ($LASTEXITCODE -ne 0) { Write-Host "[commit] git add failed" -ForegroundColor Red; exit 2 }

# Nothing to commit?
$staged = & git diff --cached --name-only
if (-not $staged) {
  Write-Host "[commit] nothing to commit; skipping" -ForegroundColor Yellow
  exit 0
}
Write-Host "[commit] staged files:"
$staged | ForEach-Object { Write-Host "         $_" }

# ---- 3. Commit ----
& git commit -m $Message
if ($LASTEXITCODE -ne 0) { Write-Host "[commit] git commit failed" -ForegroundColor Red; exit 2 }

# ---- 4. Push ----
& git push
if ($LASTEXITCODE -ne 0) { Write-Host "[commit] git push failed" -ForegroundColor Red; exit 2 }

Write-Host "[commit] OK" -ForegroundColor Green
exit 0

# =============================================================================
# fix-mojibake.ps1 - One-time recovery for the UTF-8 -> CP1252 -> UTF-8 double
# encoding caused by an earlier bug in commit.ps1 (Get-Content without
# -Encoding UTF8 on Windows PowerShell 5.1).
#
# How the damage happened:
#   File on disk:    UTF-8 bytes (e.g. middle-dot = 0xC2 0xB7)
#   Get-Content:     decoded as Windows-1252  -> two chars (0xC2, 0xB7)
#   WriteAllBytes:   re-encoded as UTF-8      -> 0xC3 0x82 0xC2 0xB7
#
# Recovery (this script):
#   ReadAllBytes:    raw bytes (0xC3 0x82 0xC2 0xB7)
#   Decode UTF-8:    string of two CP1252-range chars
#   Encode CP1252:   0xC2 0xB7
#   Decode UTF-8:    middle-dot (1 char)
#   WriteAllBytes:   correct UTF-8 (2 bytes)
#
# NOTE: This script's source is intentionally pure ASCII. Earlier draft had
# UTF-8 marker chars in the source which PS 5.1 misparsed as CP1252 (same
# bug class as the one we're fixing). We use [char] codes for any non-ASCII
# matching to avoid that trap.
#
# Usage:
#   .\fix-mojibake.ps1                # dry-run, prints sample of changes
#   .\fix-mojibake.ps1 -Apply         # actually rewrites app.js
#   .\fix-mojibake.ps1 -Apply -File styles.css   # different target file
# =============================================================================

param(
  [string]$File = 'app.js',
  [switch]$Apply
)

$ErrorActionPreference = 'Stop'
$path = (Resolve-Path $File).Path

$bytesBefore = [System.IO.File]::ReadAllBytes($path)
$mojibake    = [System.Text.Encoding]::UTF8.GetString($bytesBefore)

# Mojibake signature: lead-byte characters that appear in CP1252-misread
# UTF-8. Build the marker set using [char] codes so this script's source
# stays pure ASCII.
$markerChars = @(
  [char]0xC2,   # 0xC2 leading byte of 2-byte UTF-8 -> A-circumflex
  [char]0xC3,   # 0xC3 leading byte of 2-byte UTF-8 -> A-tilde
  [char]0xE2    # 0xE2 leading byte of 3-byte UTF-8 -> a-circumflex
)
function Count-Markers {
  param([string]$text, [char[]]$chars)
  $total = 0
  foreach ($c in $chars) {
    $total += ([regex]::Matches($text, [regex]::Escape([string]$c))).Count
  }
  return $total
}

# Iterative round-trip: re-encode as CP1252, decode as UTF-8, repeat until
# the marker count stops shrinking. Handles single-mangle, double-mangle, or
# any depth in case commit.ps1 ran more than once before we caught the bug.
# Stops after max 5 passes to avoid runaway corruption on edge cases.
$cp1252 = [System.Text.Encoding]::GetEncoding(1252)
$current = $mojibake
$startMarkers = Count-Markers $current $markerChars
$passes = 0
while ($passes -lt 5) {
  try {
    $stepBytes = $cp1252.GetBytes($current)
  } catch {
    break
  }
  $next = [System.Text.Encoding]::UTF8.GetString($stepBytes)
  $nextMarkers = Count-Markers $next $markerChars
  if ($nextMarkers -ge (Count-Markers $current $markerChars)) { break }
  $current = $next
  $passes++
}
$recovered = $current
$endMarkers = Count-Markers $recovered $markerChars

Write-Host "File:                    $path"
Write-Host "Bytes (current):         $($bytesBefore.Length)"
Write-Host "Recovery passes:         $passes"
Write-Host "Mojibake markers before: $startMarkers"
Write-Host "Mojibake markers after:  $endMarkers"

if ($startMarkers -eq 0) {
  Write-Host "No mojibake detected - file appears clean. Nothing to do." -ForegroundColor Green
  exit 0
}
if ($endMarkers -ge $startMarkers) {
  Write-Host "Recovery did NOT reduce mojibake count. Refusing to write." -ForegroundColor Red
  exit 3
}

# Sample up to 6 affected lines as before/after preview.
$beforeLines = $mojibake -split "`r?`n"
$afterLines  = $recovered -split "`r?`n"
$samples = New-Object System.Collections.ArrayList
# Build the regex character-class with explicit parens to avoid precedence
# trap: '[' + ($x) -join '' + ']' would be parsed as ('[' + $x) -join ('' + ']').
$escapedChars = ($markerChars | ForEach-Object { [regex]::Escape([string]$_) }) -join ''
$markerPattern = "[$escapedChars]"
for ($i = 0; $i -lt $beforeLines.Length -and $samples.Count -lt 6; $i++) {
  if ($beforeLines[$i] -match $markerPattern) {
    $b = $beforeLines[$i].Trim()
    $a = if ($i -lt $afterLines.Length) { $afterLines[$i].Trim() } else { '' }
    if ($b.Length -gt 80) { $b = $b.Substring(0,80) + '...' }
    if ($a.Length -gt 80) { $a = $a.Substring(0,80) + '...' }
    [void]$samples.Add([pscustomobject]@{
      Line   = $i + 1
      Before = $b
      After  = $a
    })
  }
}
Write-Host ""
Write-Host "Sample changes:" -ForegroundColor Cyan
$samples | Format-Table -AutoSize -Wrap

if (-not $Apply) {
  Write-Host ""
  Write-Host "DRY RUN - no file written. Re-run with -Apply to write the recovered file." -ForegroundColor Yellow
  exit 0
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$outBytes  = $utf8NoBom.GetBytes($recovered)
[System.IO.File]::WriteAllBytes($path, $outBytes)
Write-Host ""
Write-Host "Wrote $path with $($outBytes.Length) bytes (UTF-8, no BOM) in $passes pass(es)." -ForegroundColor Green
Write-Host "Hard-refresh the dashboard to verify the rendered text looks correct." -ForegroundColor Green

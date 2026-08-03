[CmdletBinding()]
param(
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
$tauriConfigPath = Join-Path $repoRoot "src-tauri\tauri.conf.json"

if (-not (Test-Path -LiteralPath $tauriConfigPath)) {
  throw "Missing Tauri config: $tauriConfigPath"
}

$config = Get-Content -LiteralPath $tauriConfigPath -Raw | ConvertFrom-Json
$productName = [string]$config.productName
$identifier = [string]$config.identifier

if ([string]::IsNullOrWhiteSpace($productName) -or [string]::IsNullOrWhiteSpace($identifier)) {
  throw "productName or identifier is missing in $tauriConfigPath"
}

$candidatePaths = @(
  (Join-Path $env:APPDATA $identifier),
  (Join-Path $env:LOCALAPPDATA $identifier),
  (Join-Path $env:LOCALAPPDATA $productName),
  (Join-Path $env:TEMP $identifier),
  (Join-Path $env:TEMP $productName)
)

$resolvedCandidates = @()
foreach ($candidate in $candidatePaths | Select-Object -Unique) {
  if ([string]::IsNullOrWhiteSpace($candidate)) {
    continue
  }

  $fullPath = [System.IO.Path]::GetFullPath($candidate)
  if (
    $fullPath.StartsWith($env:APPDATA, [System.StringComparison]::OrdinalIgnoreCase) -or
    $fullPath.StartsWith($env:LOCALAPPDATA, [System.StringComparison]::OrdinalIgnoreCase) -or
    $fullPath.StartsWith($env:TEMP, [System.StringComparison]::OrdinalIgnoreCase)
  ) {
    $resolvedCandidates += $fullPath
  }
}

$processNames = @("open-clipper")

Write-Host "Desktop clean-install helper"
Write-Host "Product: $productName"
Write-Host "Identifier: $identifier"
Write-Host "DryRun: $DryRun"
Write-Host ""
Write-Host "Processes to stop:"
foreach ($name in $processNames) {
  Write-Host " - $name"
}
Write-Host ""
Write-Host "Paths to remove if they exist:"
foreach ($path in $resolvedCandidates) {
  Write-Host " - $path"
}

if ($DryRun) {
  return
}

foreach ($name in $processNames) {
  $running = Get-Process -Name $name -ErrorAction SilentlyContinue
  if ($running) {
    $running | Stop-Process -Force
  }
}

foreach ($path in $resolvedCandidates) {
  if (Test-Path -LiteralPath $path) {
    Remove-Item -LiteralPath $path -Recurse -Force
  }
}

Write-Host ""
Write-Host "Clean install prep complete."

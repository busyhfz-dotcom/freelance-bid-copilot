param(
  [string]$PanelUrl = "http://127.0.0.1:3000",
  [switch]$SkipInstall,
  [switch]$ForceInstall,
  [switch]$DevMode
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$PanelPath = Join-Path $ProjectRoot "panel"
$DesktopPath = Join-Path $ProjectRoot "desktop"
$LocalPanel = $PanelUrl -match "^http://(127\.0\.0\.1|localhost)(:\d+)?"

if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
  throw "Node.js was not found. Install Node.js 22 or newer, then run this script again."
}

if (-not $SkipInstall) {
  Push-Location $PanelPath
  try {
    if ($ForceInstall -or -not (Test-Path (Join-Path $PanelPath "node_modules"))) {
      npm.cmd install
    }
  } finally { Pop-Location }

  Push-Location $DesktopPath
  try {
    if ($ForceInstall -or -not (Test-Path (Join-Path $DesktopPath "node_modules"))) {
      npm.cmd install
    }
  } finally { Pop-Location }
}

if ($LocalPanel) {
  $EnvPath = Join-Path $PanelPath ".env.local"
  if (-not (Test-Path $EnvPath)) {
    Copy-Item (Join-Path $PanelPath ".env.example") $EnvPath
  }

  $PanelArguments = @("run", "dev", "--", "-H", "127.0.0.1")
  if (-not $DevMode) {
    $BuildId = Join-Path $PanelPath ".next\BUILD_ID"
    $NeedsBuild = -not (Test-Path $BuildId)
    if (-not $NeedsBuild) {
      $BuildTime = (Get-Item $BuildId).LastWriteTimeUtc
      $SourceRoots = @(
        (Join-Path $PanelPath "app"),
        (Join-Path $PanelPath "lib"),
        (Join-Path $PanelPath "types")
      )
      $LatestSource = Get-ChildItem $SourceRoots -File -Recurse |
        Sort-Object LastWriteTimeUtc -Descending |
        Select-Object -First 1
      $PackageFile = Get-Item (Join-Path $PanelPath "package.json")
      if (($LatestSource -and $LatestSource.LastWriteTimeUtc -gt $BuildTime) -or $PackageFile.LastWriteTimeUtc -gt $BuildTime) {
        $NeedsBuild = $true
      }
    }
    if ($NeedsBuild) {
      Push-Location $PanelPath
      try { npm.cmd run build } finally { Pop-Location }
    }
    $PanelArguments = @("run", "start", "--", "-H", "127.0.0.1")
  }

  Start-Process -FilePath "npm.cmd" -ArgumentList $PanelArguments -WorkingDirectory $PanelPath
  $Ready = $false
  for ($Attempt = 0; $Attempt -lt 40; $Attempt += 1) {
    try {
      Invoke-WebRequest -UseBasicParsing -Uri $PanelUrl -TimeoutSec 1 | Out-Null
      $Ready = $true
      break
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }
  if (-not $Ready) { throw "The local panel did not become ready at $PanelUrl." }
}

$env:PANEL_URL = $PanelUrl
Push-Location $DesktopPath
try { npm.cmd start } finally { Pop-Location }

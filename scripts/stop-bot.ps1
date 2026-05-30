$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$RuntimeDir = Join-Path $Root "runtime"
$PidFile = Join-Path $RuntimeDir "kuma-bot.pid"
$EntryFile = Join-Path $Root "src\index.js"

function Write-Info($Message) {
  Write-Host "[MabiKumaBot] $Message"
}

function Get-BotProcesses {
  $processes = @()

  if (Test-Path -LiteralPath $PidFile) {
    $pidText = (Get-Content -LiteralPath $PidFile -Raw).Trim()
    if ($pidText -match '^\d+$') {
      $process = Get-CimInstance Win32_Process -Filter "ProcessId = $pidText" -ErrorAction SilentlyContinue
      if ($process -and $process.CommandLine -like "*src*index.js*") {
        $processes += $process
      }
    }
  }

  $escapedEntry = [WildcardPattern]::Escape($EntryFile)
  $fallbackProcesses = Get-CimInstance Win32_Process |
    Where-Object { $_.Name -like "node*" -and ($_.CommandLine -like "*$escapedEntry*" -or $_.CommandLine -like "*src\index.js*") }

  foreach ($process in $fallbackProcesses) {
    if (-not ($processes | Where-Object { $_.ProcessId -eq $process.ProcessId })) {
      $processes += $process
    }
  }

  return $processes
}

$processes = Get-BotProcesses
if (-not $processes -or $processes.Count -eq 0) {
  if (Test-Path -LiteralPath $PidFile) {
    Remove-Item -LiteralPath $PidFile -Force
  }
  Write-Info "Bot is not running."
  exit 0
}

foreach ($process in $processes) {
  Write-Info "Stopping PID=$($process.ProcessId)..."
  Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
}

Start-Sleep -Seconds 1

if (Test-Path -LiteralPath $PidFile) {
  Remove-Item -LiteralPath $PidFile -Force
}

Write-Info "Stopped."

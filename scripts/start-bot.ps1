$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$RuntimeDir = Join-Path $Root "runtime"
$PidFile = Join-Path $RuntimeDir "kuma-bot.pid"
$LogFile = Join-Path $Root "bot.log"
$ErrFile = Join-Path $Root "bot.err"
$EntryFile = Join-Path $Root "src\index.js"
$NodeModules = Join-Path $Root "node_modules\discord.js"

function Write-Info($Message) {
  Write-Host "[MabiKumaBot] $Message"
}

function Get-NodeExe {
  function Test-NodeExe($Path) {
    if (-not $Path -or -not (Test-Path -LiteralPath $Path)) {
      return $false
    }

    try {
      $null = & $Path --version 2>$null
      return $LASTEXITCODE -eq 0
    } catch {
      return $false
    }
  }

  if (Test-NodeExe $env:NODE_EXE) {
    return $env:NODE_EXE
  }

  $candidates = @(
    "C:\Program Files\nodejs\node.exe",
    "C:\Program Files (x86)\nodejs\node.exe",
    "C:\Users\inbox\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
  )

  foreach ($candidate in $candidates) {
    if (Test-NodeExe $candidate) {
      return $candidate
    }
  }

  $command = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($command -and (Test-NodeExe $command.Source)) {
    return $command.Source
  }

  throw "Node.js executable not found. Install Node.js 22.12.0 or newer, or set NODE_EXE to node.exe."
}

function Get-RunningBotProcess {
  if (Test-Path -LiteralPath $PidFile) {
    $pidText = (Get-Content -LiteralPath $PidFile -Raw).Trim()
    if ($pidText -match '^\d+$') {
      $process = Get-CimInstance Win32_Process -Filter "ProcessId = $pidText" -ErrorAction SilentlyContinue
      if ($process -and $process.CommandLine -like "*src*index.js*") {
        return $process
      }
    }
  }

  $escapedEntry = [WildcardPattern]::Escape($EntryFile)
  $processes = Get-CimInstance Win32_Process |
    Where-Object { $_.Name -like "node*" -and ($_.CommandLine -like "*$escapedEntry*" -or $_.CommandLine -like "*src\index.js*") }

  return $processes | Select-Object -First 1
}

New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null

if (-not (Test-Path -LiteralPath $EntryFile)) {
  throw "Bot entry file not found: $EntryFile"
}

if (-not (Test-Path -LiteralPath (Join-Path $Root ".env"))) {
  throw ".env file not found. Create it from .env.example first."
}

if (-not (Test-Path -LiteralPath $NodeModules)) {
  throw "node_modules not found. Run npm install in $Root first."
}

$running = Get-RunningBotProcess
if ($running) {
  Set-Content -LiteralPath $PidFile -Value $running.ProcessId -Encoding ASCII
  Write-Info "Already running. PID=$($running.ProcessId)"
  Write-Info "Log: $LogFile"
  exit 0
}

$nodeExe = Get-NodeExe
Write-Info "Starting bot..."
Write-Info "Node: $nodeExe"

$process = Start-Process `
  -FilePath $nodeExe `
  -ArgumentList @($EntryFile) `
  -WorkingDirectory $Root `
  -RedirectStandardOutput $LogFile `
  -RedirectStandardError $ErrFile `
  -WindowStyle Hidden `
  -PassThru

Set-Content -LiteralPath $PidFile -Value $process.Id -Encoding ASCII
Start-Sleep -Seconds 2

$started = Get-CimInstance Win32_Process -Filter "ProcessId = $($process.Id)" -ErrorAction SilentlyContinue
if ($started) {
  Write-Info "Started. PID=$($process.Id)"
  Write-Info "Log: $LogFile"
  Write-Info "Error log: $ErrFile"
  exit 0
}

Write-Info "Bot exited during startup. Check logs:"
Write-Info $LogFile
Write-Info $ErrFile
exit 1

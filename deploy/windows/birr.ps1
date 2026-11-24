<#
.SYNOPSIS
  Run Birr on this Windows PC as a background service (Scheduled Task, starts at boot).

.EXAMPLE
  .\deploy\windows\birr.ps1 install     # build + register tasks + start   (Administrator)
  .\deploy\windows\birr.ps1 status
  .\deploy\windows\birr.ps1 logs
  .\deploy\windows\birr.ps1 restart     # after editing .env               (Administrator)
  .\deploy\windows\birr.ps1 update      # git pull + build + restart       (Administrator)
  .\deploy\windows\birr.ps1 stop        # e.g. before running `pnpm dev`   (Administrator)
  .\deploy\windows\birr.ps1 backup      # back up the database now
  .\deploy\windows\birr.ps1 uninstall   # remove the tasks (keeps your data) (Administrator)
#>
param(
  [Parameter(Position = 0)]
  [ValidateSet('install', 'uninstall', 'start', 'stop', 'restart', 'status', 'logs', 'update', 'backup')]
  [string]$Command = 'status'
)

$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$Server = Join-Path $Repo 'apps\server'
$EnvFile = Join-Path $Repo '.env'
$Log = Join-Path $Repo 'data\logs\birr.log'
$TaskName = 'Birr'
$BackupTaskName = 'Birr Backup'

function Test-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  return ([Security.Principal.WindowsPrincipal]$id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}
function Assert-Admin {
  if (-not (Test-Admin)) { throw "Run this from an Administrator PowerShell (right-click PowerShell > Run as administrator)." }
}
function Get-EnvValue([string]$name) {
  if (-not (Test-Path $EnvFile)) { return $null }
  $line = Get-Content $EnvFile | Where-Object { $_ -match "^\s*$name\s*=" } | Select-Object -Last 1
  if ($line) { return ($line -replace "^\s*$name\s*=\s*", '').Trim().Trim('"') }
  return $null
}
function Test-Health {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 -Uri 'http://127.0.0.1:8787/health'
    return $r.StatusCode -eq 200
  } catch { return $false }
}
function Wait-Healthy([int]$seconds = 40) {
  for ($i = 0; $i -lt $seconds; $i++) {
    if (Test-Health) { return $true }
    Start-Sleep -Seconds 1
  }
  return $false
}
# Stopping a scheduled task ends run.ps1 but can leave its node child running, so kill that too.
function Stop-BirrProcesses {
  $procs = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine -like '*src\index.ts*' -and $_.CommandLine -like '*--env-file=..\..\.env*' }
  foreach ($p in $procs) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
}
function Invoke-Build {
  Push-Location $Repo
  try {
    & pnpm install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw 'pnpm install failed' }
    & pnpm --filter '@birr/miniapp' build
    if ($LASTEXITCODE -ne 0) { throw 'Mini App build failed' }
  } finally { Pop-Location }
}
function Assert-Config {
  if (-not (Test-Path $EnvFile)) { throw ".env not found. Copy .env.example to .env and fill it in (see WINDOWS.md)." }
  $missing = @('BOT_TOKEN', 'ALLOWED_TELEGRAM_IDS', 'DATA_ENCRYPTION_KEY', 'PUBLIC_URL', 'MINIAPP_URL') |
    Where-Object { -not (Get-EnvValue $_) }
  if ($missing) { throw ".env is missing: $($missing -join ', ')" }
  if ((Get-EnvValue 'SERVE_MINIAPP') -ne 'true') { Write-Warning 'SERVE_MINIAPP is not true in .env; the Mini App will not be served.' }
  if ((Get-EnvValue 'BOT_MODE') -eq 'webhook') { Write-Warning 'BOT_MODE=webhook: on a home PC, polling is simpler and does not depend on the tunnel.' }
  if (-not (Get-EnvValue 'PUBLIC_URL').StartsWith('https://')) { Write-Warning 'PUBLIC_URL is not https://. Your iPhone and Telegram will not reach it.' }
}

switch ($Command) {
  'install' {
    Assert-Admin
    Assert-Config
    Write-Host '==> Installing dependencies and building the Mini App' -ForegroundColor Green
    Invoke-Build

    $user = "$env:USERDOMAIN\$env:USERNAME"
    # S4U: runs at boot without anyone logged in and without storing your password.
    $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType S4U -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
      -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew

    $runner = Join-Path $PSScriptRoot 'run.ps1'
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' `
      -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$runner`""
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger (New-ScheduledTaskTrigger -AtStartup) `
      -Principal $principal -Settings $settings -Description 'Birr finance tracker (API + Telegram bot)' -Force | Out-Null

    $bSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
      -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
    $bAction = New-ScheduledTaskAction -Execute 'node.exe' -WorkingDirectory $Server `
      -Argument '--env-file=..\..\.env --import tsx src\db\backup.ts'
    Register-ScheduledTask -TaskName $BackupTaskName -Action $bAction -Trigger (New-ScheduledTaskTrigger -Daily -At 3am) `
      -Principal $principal -Settings $bSettings -Description 'Daily Birr database backup' -Force | Out-Null

    Stop-BirrProcesses
    Start-ScheduledTask -TaskName $TaskName
    if (Wait-Healthy) {
      Write-Host "==> Birr is running and will start automatically at boot." -ForegroundColor Green
      Write-Host "    Public URL: $(Get-EnvValue 'PUBLIC_URL')   (check it opens: $(Get-EnvValue 'PUBLIC_URL')/health)"
    } else {
      Write-Warning "Birr did not become healthy. Last log lines:"
      if (Test-Path $Log) { Get-Content $Log -Tail 30 }
      exit 1
    }
  }
  'uninstall' {
    Assert-Admin
    foreach ($t in @($TaskName, $BackupTaskName)) {
      if (Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue) {
        Stop-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue
        Unregister-ScheduledTask -TaskName $t -Confirm:$false
      }
    }
    Stop-BirrProcesses
    Write-Host '==> Removed the Birr tasks. Your data in data\ is untouched.'
  }
  'start' {
    Assert-Admin
    Start-ScheduledTask -TaskName $TaskName
    if (Wait-Healthy) { Write-Host '==> running' } else { Write-Warning 'not healthy yet; see: birr.ps1 logs' }
  }
  'stop' {
    Assert-Admin
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Stop-BirrProcesses
    Write-Host '==> stopped (it will start again at next boot; use uninstall to prevent that)'
  }
  'restart' {
    Assert-Admin
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Stop-BirrProcesses
    Start-ScheduledTask -TaskName $TaskName
    if (Wait-Healthy) { Write-Host '==> restarted' } else { Write-Warning 'not healthy; see: birr.ps1 logs'; exit 1 }
  }
  'update' {
    Assert-Admin
    Push-Location $Repo
    try {
      & git pull --ff-only
      if ($LASTEXITCODE -ne 0) { throw 'git pull failed' }
    } finally { Pop-Location }
    Invoke-Build
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Stop-BirrProcesses
    Start-ScheduledTask -TaskName $TaskName
    if (Wait-Healthy) { Write-Host '==> updated and running' } else { Write-Warning 'not healthy; see: birr.ps1 logs'; exit 1 }
  }
  'status' {
    $t = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if (-not $t) { Write-Host 'Not installed. Run: .\deploy\windows\birr.ps1 install (as Administrator)'; break }
    $info = Get-ScheduledTaskInfo -TaskName $TaskName
    Write-Host ("Task:     {0} (last run {1})" -f $t.State, $info.LastRunTime)
    Write-Host ("Health:   {0}" -f $(if (Test-Health) { 'OK (http://127.0.0.1:8787/health)' } else { 'NOT RESPONDING' }))
    Write-Host ("Public:   {0}" -f (Get-EnvValue 'PUBLIC_URL'))
    $b = Get-ScheduledTaskInfo -TaskName $BackupTaskName -ErrorAction SilentlyContinue
    if ($b) { Write-Host ("Backup:   last {0}, next {1}" -f $b.LastRunTime, $b.NextRunTime) }
  }
  'logs' {
    if (Test-Path $Log) { Get-Content $Log -Tail 50 -Wait } else { Write-Host "No log yet at $Log" }
  }
  'backup' {
    Push-Location $Server
    try { & node --env-file=..\..\.env --import tsx src\db\backup.ts } finally { Pop-Location }
  }
}

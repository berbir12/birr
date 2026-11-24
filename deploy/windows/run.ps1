# Runs the Birr server forever, restarting it if it exits. Started at boot by the "Birr" scheduled task.
# Not meant to be run by hand; use birr.ps1 (start / stop / status / logs).
$ErrorActionPreference = 'Continue'

$Repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$Server = Join-Path $Repo 'apps\server'
$LogDir = Join-Path $Repo 'data\logs'
$Log = Join-Path $LogDir 'birr.log'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Write-Log([string]$msg) {
  Add-Content -Path $Log -Value ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg) -Encoding UTF8
}

Set-Location $Server
while ($true) {
  if ((Test-Path $Log) -and ((Get-Item $Log).Length -gt 10MB)) {
    Move-Item -Force $Log "$Log.1"
  }
  Write-Log 'starting birr'
  # cmd /c keeps stdout/stderr as plain text (PowerShell 5.1 would wrap stderr lines as errors).
  cmd.exe /d /c "node --env-file=..\..\.env --import tsx src\index.ts >> `"$Log`" 2>&1"
  Write-Log "birr exited with code $LASTEXITCODE; restarting in 5 seconds"
  Start-Sleep -Seconds 5
}

param([switch]$Setup, [int]$ApiPort = 8002, [int]$WebPort = 3001)
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $Repo
$PythonCommand = Join-Path $Repo '.venv/Scripts/python.exe'
if ($Setup) {
  if (-not (Test-Path -LiteralPath $PythonCommand)) {
    python -m venv .venv
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the Python environment.' }
  }
  & $PythonCommand -m pip install -r requirements.txt
  if ($LASTEXITCODE -ne 0) { throw 'Could not install backend dependencies.' }
  Push-Location (Join-Path $Repo 'frontend')
  try { npm install; if ($LASTEXITCODE -ne 0) { throw 'Could not install frontend dependencies.' } }
  finally { Pop-Location }
}
if (-not (Test-Path -LiteralPath $PythonCommand)) { throw 'Run scripts/run_flowsense.ps1 -Setup with Python 3.13 or newer.' }
$env:FLOWSENSE_CITY = 'los_angeles'
$Graph = Join-Path $Repo 'data/processed/los_angeles_regional_graph.graphml'
if (-not (Test-Path -LiteralPath $Graph)) {
  & $PythonCommand scripts/download_regional_graph.py
  if ($LASTEXITCODE -ne 0) { throw 'Could not download the Los Angeles road graph.' }
}
if (-not (Test-Path -LiteralPath (Join-Path $Repo 'models/yolov8n.onnx'))) {
  & $PythonCommand scripts/download_model.py
  if ($LASTEXITCODE -ne 0) { Write-Warning 'Model installation failed. Public images will be available without counts.' }
}
$ExistingApi = Get-NetTCPConnection -LocalPort $ApiPort -State Listen -ErrorAction SilentlyContinue
if ($ExistingApi) {
  $Health = Invoke-RestMethod "http://127.0.0.1:$ApiPort/" -TimeoutSec 5
  if ($Health.pilot_city -ne 'Greater Los Angeles, California') { throw "Port $ApiPort is occupied by another profile. Stop that service or choose another port." }
} else {
  Start-Process -FilePath $PythonCommand -ArgumentList @('-m','uvicorn','src.main:app','--host','127.0.0.1','--port',"$ApiPort") -WorkingDirectory $Repo -WindowStyle Hidden -RedirectStandardOutput (Join-Path $Repo 'backend.local.log') -RedirectStandardError (Join-Path $Repo 'backend.local.err.log')
}
$ViteScript = Join-Path $Repo 'frontend/node_modules/vite/bin/vite.js'
if (-not (Test-Path -LiteralPath $ViteScript)) { throw 'Run scripts/run_flowsense.ps1 -Setup to install the frontend.' }
$env:FLOWSENSE_API_PORT = "$ApiPort"
$env:FLOWSENSE_API_URL = "http://127.0.0.1:$ApiPort"
$env:VITE_API_URL = ''
if (-not (Get-NetTCPConnection -LocalPort $WebPort -State Listen -ErrorAction SilentlyContinue)) {
  Start-Process -FilePath 'node' -ArgumentList @(('"' + $ViteScript + '"'),'--host','127.0.0.1','--port',"$WebPort") -WorkingDirectory (Join-Path $Repo 'frontend') -WindowStyle Hidden -RedirectStandardOutput (Join-Path $Repo 'frontend.local.log') -RedirectStandardError (Join-Path $Repo 'frontend.local.err.log')
}
$Ready = $false
for ($Attempt = 0; $Attempt -lt 30; $Attempt++) {
  try {
    $Health = Invoke-RestMethod "http://127.0.0.1:$ApiPort/" -TimeoutSec 2
    $Web = Invoke-WebRequest "http://127.0.0.1:$WebPort/" -TimeoutSec 2
    if ($Health.status -eq 'operational' -and $Web.StatusCode -eq 200) { $Ready = $true; break }
  } catch { Start-Sleep -Seconds 1 }
}
if (-not $Ready) { throw 'Services did not respond. Check the local backend and frontend logs.' }
Write-Host "FlowSense: http://127.0.0.1:$WebPort/overview"
Write-Host "API: http://127.0.0.1:$ApiPort/docs"
Write-Host 'Los Angeles profile · free Caltrans cameras · cases are stored locally.'

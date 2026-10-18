param(
  [switch]$DownloadGraph,
  [int]$ApiPort = 8002
)
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
Set-Location $Repo
$PythonCommand = Join-Path $Repo '.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $PythonCommand)) { $PythonCommand = 'python' }
$env:FLOWSENSE_CITY = 'cartagena'

$Graph = Join-Path $Repo 'data/processed/cartagena_graph.graphml'
if ($DownloadGraph -or -not (Test-Path -LiteralPath $Graph)) {
  & $PythonCommand scripts/download_city_graph.py --bbox -75.62 10.31 -75.42 10.50 --output data/processed/cartagena_graph.graphml
  if ($LASTEXITCODE -ne 0) { throw 'Could not download the Cartagena road graph.' }
}

$ExistingApi = Get-NetTCPConnection -LocalPort $ApiPort -State Listen -ErrorAction SilentlyContinue
if (-not $ExistingApi) {
  $ApiLog = Join-Path ([System.IO.Path]::GetTempPath()) 'flowsense-cartagena-api.log'
  $ApiErr = Join-Path ([System.IO.Path]::GetTempPath()) 'flowsense-cartagena-api.err.log'
  Start-Process -FilePath $PythonCommand -ArgumentList @('-m','uvicorn','src.main:app','--host','127.0.0.1','--port',"$ApiPort") `
    -WorkingDirectory $Repo -RedirectStandardOutput $ApiLog -RedirectStandardError $ApiErr -WindowStyle Hidden
  Write-Host "FlowSense Cartagena API: http://localhost:$ApiPort (log: $ApiLog)"
} else {
  Write-Host "An API is already listening at http://localhost:$ApiPort"
}
$env:FLOWSENSE_API_PORT = "$ApiPort"
$env:FLOWSENSE_API_URL = "http://127.0.0.1:$ApiPort"
$env:VITE_API_URL = ''
Write-Host 'Start the frontend in this terminal so it inherits the API settings:'
Write-Host 'Push-Location frontend; npm run dev -- --host 127.0.0.1; Pop-Location'
Write-Host "In a separate terminal, set FLOWSENSE_API_URL=http://127.0.0.1:$ApiPort before starting Vite."

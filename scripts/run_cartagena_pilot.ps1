param(
  [switch]$DownloadGraph,
  [int]$ApiPort = 8002
)
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
Set-Location $Repo
$env:FLOWSENSE_CITY = 'cartagena'

$Graph = Join-Path $Repo 'data/processed/cartagena_graph.graphml'
if ($DownloadGraph -or -not (Test-Path -LiteralPath $Graph)) {
  python scripts/download_city_graph.py --bbox 10.50 10.31 -75.42 -75.62 --output data/processed/cartagena_graph.graphml
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo descargar el grafo vial de Cartagena.' }
}

$ExistingApi = Get-NetTCPConnection -LocalPort $ApiPort -State Listen -ErrorAction SilentlyContinue
if (-not $ExistingApi) {
  $ApiLog = Join-Path ([System.IO.Path]::GetTempPath()) 'flowsense-cartagena-api.log'
  $ApiErr = Join-Path ([System.IO.Path]::GetTempPath()) 'flowsense-cartagena-api.err.log'
  Start-Process -FilePath 'python' -ArgumentList @('-m','uvicorn','src.main:app','--host','127.0.0.1','--port',"$ApiPort") `
    -WorkingDirectory $Repo -RedirectStandardOutput $ApiLog -RedirectStandardError $ApiErr -WindowStyle Hidden
  Write-Host "FlowSense Cartagena API: http://localhost:$ApiPort (log: $ApiLog)"
} else {
  Write-Host "API ya está escuchando en http://localhost:$ApiPort"
}
Write-Host 'In otra terminal, en frontend/: npm run dev -- --host 127.0.0.1'

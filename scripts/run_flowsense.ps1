param([switch]$Setup, [int]$ApiPort = 8004, [int]$WebPort = 3002,
  [string]$EvidenceDirectory, [double]$EvidenceMaxGigabytes = 0)
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $Repo
$EvidenceDirectoryConfigured = -not [string]::IsNullOrWhiteSpace($EvidenceDirectory)
if ($EvidenceDirectoryConfigured) {
  $EvidenceDirectory = [Environment]::ExpandEnvironmentVariables($EvidenceDirectory)
  $EvidenceDirectory = [System.IO.Path]::GetFullPath($EvidenceDirectory)
  New-Item -ItemType Directory -Path $EvidenceDirectory -Force | Out-Null
  $EvidenceDirectory = (Resolve-Path -LiteralPath $EvidenceDirectory).Path
  $EvidenceVolumeRoot = [System.IO.Path]::GetPathRoot($EvidenceDirectory)
  if ([string]::IsNullOrWhiteSpace($EvidenceVolumeRoot)) {
    throw 'The evidence directory must resolve to a mounted volume or network share.'
  }
  $EvidenceVolume = [System.IO.DriveInfo]::new($EvidenceVolumeRoot)
  if (-not $EvidenceVolume.IsReady) { throw "Evidence volume is not ready: $EvidenceVolumeRoot" }
  $EvidenceMinimumFreeBytes = [long]1000000000
  $ConfiguredReserve = 0L
  if ($env:VIDEO_EVIDENCE_MIN_FREE_BYTES -and
      [long]::TryParse($env:VIDEO_EVIDENCE_MIN_FREE_BYTES, [ref]$ConfiguredReserve) -and $ConfiguredReserve -ge 0) {
    $EvidenceMinimumFreeBytes = $ConfiguredReserve
  }
  if ($EvidenceVolume.AvailableFreeSpace -lt $EvidenceMinimumFreeBytes) {
    $FreeGigabytes = [math]::Round($EvidenceVolume.AvailableFreeSpace / 1e9, 2)
    $RequiredGigabytes = [math]::Round($EvidenceMinimumFreeBytes / 1e9, 2)
    throw "Evidence volume has only $FreeGigabytes GB free; $RequiredGigabytes GB must be available before the API can switch storage. The existing API was not restarted."
  }
  Write-Host "New MP4 clips will be stored in $EvidenceDirectory; existing clips stay in place and remain reviewable."
}
if ($EvidenceMaxGigabytes -lt 0 -or $EvidenceMaxGigabytes -gt 1000000) {
  throw 'EvidenceMaxGigabytes must be between 0 and 1,000,000 GB.'
}
if ($EvidenceMaxGigabytes -gt 0) {
  Write-Host "Configured total evidence quota: $EvidenceMaxGigabytes GB."
}
$PythonCommand = Join-Path $Repo '.venv/Scripts/python.exe'
if ($Setup) {
  if (-not (Test-Path -LiteralPath $PythonCommand)) {
    python -m venv .venv
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the Python environment.' }
  }
  & $PythonCommand -m pip install -r requirements.txt
  if ($LASTEXITCODE -ne 0) { throw 'Could not install backend dependencies.' }
  if (Get-Command nvidia-smi -ErrorAction SilentlyContinue) {
    & $PythonCommand -m pip uninstall -y onnxruntime
    if ($LASTEXITCODE -ne 0) { throw 'Could not replace the CPU inference runtime.' }
    & $PythonCommand -m pip install -r requirements-gpu.txt
    if ($LASTEXITCODE -ne 0) {
      Write-Warning 'CUDA inference setup failed. Restoring the CPU ONNX Runtime provider.'
      & $PythonCommand -m pip install 'onnxruntime>=1.31.0'
      if ($LASTEXITCODE -ne 0) { throw 'Could not restore the CPU inference runtime.' }
    }
  }
  Push-Location (Join-Path $Repo 'frontend')
  try { npm install; if ($LASTEXITCODE -ne 0) { throw 'Could not install frontend dependencies.' } }
  finally { Pop-Location }
}
if (-not (Test-Path -LiteralPath $PythonCommand)) { throw 'Run scripts/run_flowsense.ps1 -Setup with Python 3.13 or newer.' }
& $PythonCommand -c 'import aiortc, av'
if ($LASTEXITCODE -ne 0) { throw 'Continuous video dependencies are missing. Run scripts/run_flowsense.ps1 -Setup.' }
$env:FLOWSENSE_CITY = 'los_angeles'
$Graph = Join-Path $Repo 'data/processed/los_angeles_regional_graph.graphml'
if (-not (Test-Path -LiteralPath $Graph)) {
  & $PythonCommand scripts/download_regional_graph.py
  if ($LASTEXITCODE -ne 0) { throw 'Could not download the Los Angeles road graph.' }
}
if (-not (Test-Path -LiteralPath (Join-Path $Repo 'models/yolov8n.onnx'))) {
  & $PythonCommand scripts/download_model.py
  if ($LASTEXITCODE -ne 0) { Write-Warning 'Model installation failed. Video will remain available without detection counts.' }
}
if (-not (Test-Path -LiteralPath (Join-Path $Repo 'models/yolov8s.onnx'))) {
  & $PythonCommand scripts/download_model.py --model yolov8s
  if ($LASTEXITCODE -ne 0) { throw 'Could not prepare the YOLOv8 small video detector.' }
}
if (-not (Test-Path -LiteralPath (Join-Path $Repo 'models/bdd-yolo11n.onnx'))) {
  $RoadExporter = Join-Path $Repo '.venv-model-tools/Scripts/python.exe'
  if ($Setup -and -not (Test-Path -LiteralPath $RoadExporter)) {
    & $PythonCommand -m venv .venv-model-tools
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the isolated road-model export environment.' }
    & $RoadExporter -m pip install -r requirements-model-tools.txt
    if ($LASTEXITCODE -ne 0) { throw 'Could not install the road-model export tools.' }
  }
  if (Test-Path -LiteralPath $RoadExporter) {
    & $RoadExporter scripts/prepare_road_model.py
    if ($LASTEXITCODE -ne 0) { throw 'Could not prepare the BDD100K road detector.' }
  } else {
    Write-Warning 'The road detector is not installed. Run scripts/run_flowsense.ps1 -Setup to prepare it.'
  }
}
$ExistingApi = Get-NetTCPConnection -LocalPort $ApiPort -State Listen -ErrorAction SilentlyContinue
if ($ExistingApi) {
  $Health = Invoke-RestMethod "http://127.0.0.1:$ApiPort/" -TimeoutSec 5
  if ($Health.pilot_city -ne 'Greater Los Angeles, California') { throw "Port $ApiPort is occupied by another profile. Stop that service or choose another port." }
  $ApiSummary = Invoke-RestMethod "http://127.0.0.1:$ApiPort/api/v1/mobility/video/cameras/caltrans-d7-cctv-1031/summary" -TimeoutSec 8
  $ApiOpenApi = Invoke-RestMethod "http://127.0.0.1:$ApiPort/openapi.json" -TimeoutSec 5
  $HasFastCaptureStatus = $null -ne $ApiOpenApi.paths.PSObject.Properties['/api/v1/mobility/video/cameras/{camera_id}/capture-status']
  $HasCurrentRoadMatcher = $null -ne $ApiSummary.road -and
    $null -ne $ApiSummary.road.PSObject.Properties['road_matching_version'] -and
    [int]$ApiSummary.road.road_matching_version -eq 5
  $HasCurrentCameraDetectionPolicy = $null -ne $ApiSummary.capture_status -and
    $null -ne $ApiSummary.capture_status.PSObject.Properties['camera_detection_policy_version'] -and
    [int]$ApiSummary.capture_status.camera_detection_policy_version -eq 2
  $HasCurrentRoadCoveragePolicy = $null -ne $ApiSummary.PSObject.Properties['road_coverage_policy_version'] -and
    [int]$ApiSummary.road_coverage_policy_version -eq 2
  $HasCaptureDiagnostics = $null -ne $ApiSummary.capture_status -and
    $null -ne $ApiSummary.capture_status.PSObject.Properties['model'] -and
    $null -ne $ApiSummary.capture_status.PSObject.Properties['detection_profile'] -and
    $null -ne $ApiSummary.capture_status.PSObject.Properties['visible_tracks']
  $HasIndependentObservationDiagnostics = $null -ne $ApiSummary.capture_status -and
    $null -ne $ApiSummary.capture_status.PSObject.Properties['storage_error']
  $HasCachedVideoCapacityChecks = $null -ne $ApiSummary.capture_status -and
    $null -ne $ApiSummary.capture_status.PSObject.Properties['video_capacity_scan_version'] -and
    [int]$ApiSummary.capture_status.video_capacity_scan_version -eq 1
  $HasEvidenceFramePolicy = $null -ne $ApiSummary.capture_status -and
    $null -ne $ApiSummary.capture_status.PSObject.Properties['evidence_frame_policy_version'] -and
    [int]$ApiSummary.capture_status.evidence_frame_policy_version -eq 4
  $HasOrderedEvidencePauses = $null -ne $ApiSummary.capture_status -and
    $null -ne $ApiSummary.capture_status.PSObject.Properties['evidence_pause_order_version'] -and
    [int]$ApiSummary.capture_status.evidence_pause_order_version -eq 1
  $ApiHistory = $null
  if ($ExistingApi) {
    try { $ApiHistory = Invoke-RestMethod "http://127.0.0.1:$ApiPort/api/v1/mobility/video/cameras/caltrans-d7-cctv-1031/history?limit=1" -TimeoutSec 5 }
    catch { }
  }
  $HasReviewArchive = $null -ne $ApiHistory -and $null -ne $ApiHistory.PSObject.Properties['reviewed_events']
  $ApiClipPage = $null
  if ($ExistingApi) {
    try { $ApiClipPage = Invoke-RestMethod "http://127.0.0.1:$ApiPort/api/v1/mobility/video/cameras/caltrans-d7-cctv-1031/clips?limit=1&include_earlier_zones=true" -TimeoutSec 5 }
    catch { }
  }
  $HasClipPaging = $false
  if ($ApiClipPage) {
    $HasClipPaging = $null -ne $ApiClipPage.PSObject.Properties['has_more'] -and
      $null -ne $ApiClipPage.PSObject.Properties['next_cursor'] -and
      $ApiClipPage.includes_earlier_zones -eq $true
  }
  $UsageRatio = 0.0
  if ($ApiSummary.video_evidence.max_bytes -gt 0) {
    $UsageRatio = [double]$ApiSummary.video_evidence.bytes_used / [double]$ApiSummary.video_evidence.max_bytes
  }
  $DiskHeadroomBytes = [double]$ApiSummary.video_evidence.free_disk_bytes - [double]$ApiSummary.video_evidence.minimum_free_bytes
  $ExpectedEvidenceCrf = if ($UsageRatio -ge 0.90 -or $DiskHeadroomBytes -lt 250000000) { 37 }
    elseif ($UsageRatio -ge 0.75 -or $DiskHeadroomBytes -lt 750000000) { 31 } else { 28 }
  $StaleEvidenceEncoderPolicy = $null -ne $ApiSummary.video_evidence.PSObject.Properties['encoding_crf'] -and
    [int]$ApiSummary.video_evidence.encoding_crf -ne $ExpectedEvidenceCrf
  if ($ExistingApi -and (-not $ApiSummary.PSObject.Properties['capture_status'] -or
      -not $ApiSummary.capture_status.PSObject.Properties['reconnect_attempts'] -or
      [int]$ApiSummary.capture_status.restart_drain_version -ne 1 -or
      -not $ApiSummary.PSObject.Properties['minute_video_coverage'] -or
      -not $ApiSummary.PSObject.Properties['minute_timeline_sorted'] -or
      -not $ApiSummary.video_continuity.PSObject.Properties['recent_pauses'] -or
      -not $ApiSummary.PSObject.Properties['video_evidence_linkage'] -or
      -not $ApiSummary.video_evidence_linkage.PSObject.Properties['paused_clip_crossings'] -or
      -not $HasFastCaptureStatus -or
      $ApiSummary.video_evidence.minimum_free_bytes -ne 1000000000 -or
      -not $ApiSummary.video_evidence.PSObject.Properties['encoding_crf'] -or
      -not $ApiSummary.video_evidence.PSObject.Properties['recent_recording_pauses'] -or
      $StaleEvidenceEncoderPolicy -or
      -not $HasClipPaging -or
      -not $HasReviewArchive -or
      -not $HasCurrentRoadMatcher -or
      -not $HasCurrentCameraDetectionPolicy -or
      -not $HasCurrentRoadCoveragePolicy -or
      -not $HasCaptureDiagnostics -or -not $HasIndependentObservationDiagnostics -or
      -not $HasCachedVideoCapacityChecks -or -not $HasOrderedEvidencePauses -or -not $HasEvidenceFramePolicy -or
      $EvidenceDirectoryConfigured -or $EvidenceMaxGigabytes -gt 0)) {
    $ActiveRecordings = [int]$ApiSummary.video_evidence.recording_clips
    $ApiProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($ExistingApi.OwningProcess)"
    $ExpectedCommand = "uvicorn src.main:app --host 127.0.0.1 --port $ApiPort"
    if (-not $ApiProcess -or $ApiProcess.Name -ne 'python.exe' -or $ApiProcess.CommandLine -notmatch [regex]::Escape($ExpectedCommand)) {
      throw "Port $ApiPort serves an older camera API, but its process is not the expected FlowSense Uvicorn service. Stop it or choose another API port."
    }
    $CanRestartApi = $false
    $SupportsRestartDrain = $false
    try {
      $DrainStatus = Invoke-RestMethod "http://127.0.0.1:$ApiPort/api/v1/mobility/video/prepare-restart" -Method Post -TimeoutSec 5
      $SupportsRestartDrain = $true
    } catch { }
    if ($SupportsRestartDrain) {
      $DrainDeadline = [DateTime]::UtcNow.AddSeconds(30)
      while ([DateTime]::UtcNow -lt $DrainDeadline) {
        $DrainStatus = Invoke-RestMethod "http://127.0.0.1:$ApiPort/api/v1/mobility/video/prepare-restart" -Method Post -TimeoutSec 5
        $DrainSummary = Invoke-RestMethod "http://127.0.0.1:$ApiPort/api/v1/mobility/video/cameras/caltrans-d7-cctv-1031/summary" -TimeoutSec 8
        if ($DrainStatus.ready -and [int]$DrainSummary.video_evidence.recording_clips -eq 0) {
          $CanRestartApi = $true
          break
        }
        Start-Sleep -Milliseconds 250
      }
      if (-not $CanRestartApi) {
        try { Invoke-RestMethod "http://127.0.0.1:$ApiPort/api/v1/mobility/video/cancel-restart" -Method Post -TimeoutSec 5 | Out-Null } catch { }
        Write-Warning "The API could not drain evidence clips within 30 seconds. It remains running and clip recording has been resumed."
      }
    } elseif ($ActiveRecordings -eq 0) {
      # Older APIs do not support coordinated draining. Recheck immediately
      # before the legacy refresh. An idle analysis window is safe; when the
      # storage gate is already below its reserve, it also prevents a new clip
      # writer from opening while the process is replaced.
      $DrainSummary = Invoke-RestMethod "http://127.0.0.1:$ApiPort/api/v1/mobility/video/cameras/caltrans-d7-cctv-1031/summary" -TimeoutSec 8
      $StoragePreventsNewClip = -not [string]::IsNullOrWhiteSpace([string]$DrainSummary.video_evidence.storage_block_reason) -and
        [long]$DrainSummary.video_evidence.free_disk_bytes -lt [long]$DrainSummary.video_evidence.minimum_free_bytes
      $NoOpenWriter = [int]$DrainSummary.video_evidence.recording_clips -eq 0
      $NoTrackCanOpenWriter = [int]$DrainSummary.tracked_in_window -eq 0 -or $StoragePreventsNewClip
      $CanRestartApi = $NoOpenWriter -and $NoTrackCanOpenWriter
      if (-not $CanRestartApi) {
        Write-Warning "The legacy API has no safe clip-drain endpoint, active clips or tracks may still write evidence, and storage is not blocking new clips. Keeping it running to preserve video evidence."
      } elseif ($StoragePreventsNewClip) {
        Write-Host 'No MP4 clips are open and the disk reserve prevents new writers. Existing observations and clips remain on disk during the camera reconnect.'
      }
    } else {
      Write-Warning "The API does not support coordinated clip draining and $ActiveRecordings evidence clip(s) are recording. Keeping it running to preserve them."
    }
    if ($CanRestartApi) {
      Write-Host "Refreshing the FlowSense API on port $ApiPort after evidence recording was safely drained."
      Stop-Process -Id $ApiProcess.ProcessId -ErrorAction Stop
      $PortReleased = $false
      for ($Attempt = 0; $Attempt -lt 40; $Attempt++) {
        if (-not (Get-NetTCPConnection -LocalPort $ApiPort -State Listen -ErrorAction SilentlyContinue)) { $PortReleased = $true; break }
        Start-Sleep -Milliseconds 250
      }
      if (-not $PortReleased) { throw "FlowSense API did not release port $ApiPort after refresh." }
      $ExistingApi = $null
    }
  }
}
if (-not $ExistingApi) {
  $PreviousEvidenceDirectory = [Environment]::GetEnvironmentVariable('VIDEO_EVIDENCE_DIR', 'Process')
  $PreviousEvidenceMaxBytes = [Environment]::GetEnvironmentVariable('VIDEO_EVIDENCE_MAX_BYTES', 'Process')
  try {
    if ($EvidenceDirectoryConfigured) { $env:VIDEO_EVIDENCE_DIR = $EvidenceDirectory }
    if ($EvidenceMaxGigabytes -gt 0) { $env:VIDEO_EVIDENCE_MAX_BYTES = [string][long]($EvidenceMaxGigabytes * 1000000000) }
    Start-Process -FilePath $PythonCommand -ArgumentList @('-m','uvicorn','src.main:app','--host','127.0.0.1','--port',"$ApiPort") -WorkingDirectory $Repo -WindowStyle Hidden -RedirectStandardOutput (Join-Path $Repo 'backend.local.log') -RedirectStandardError (Join-Path $Repo 'backend.local.err.log')
  } finally {
    [Environment]::SetEnvironmentVariable('VIDEO_EVIDENCE_DIR', $PreviousEvidenceDirectory, 'Process')
    [Environment]::SetEnvironmentVariable('VIDEO_EVIDENCE_MAX_BYTES', $PreviousEvidenceMaxBytes, 'Process')
  }
}
$ViteScript = Join-Path $Repo 'frontend/node_modules/vite/bin/vite.js'
if (-not (Test-Path -LiteralPath $ViteScript)) { throw 'Run scripts/run_flowsense.ps1 -Setup to install the frontend.' }
$env:FLOWSENSE_API_PORT = "$ApiPort"
$env:FLOWSENSE_API_URL = "http://127.0.0.1:$ApiPort"
$env:VITE_API_URL = ''
$ExpectedApiTarget = "http://127.0.0.1:$ApiPort"
$ExistingWeb = Get-NetTCPConnection -LocalPort $WebPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($ExistingWeb) {
  $ConfiguredApiTarget = $null
  try {
    $ProxyHealth = Invoke-RestMethod "http://127.0.0.1:$WebPort/__flowsense/proxy-health" -TimeoutSec 3
    $ConfiguredApiTarget = ([string]$ProxyHealth.target).TrimEnd('/')
  } catch { }
  if ($ConfiguredApiTarget -ne $ExpectedApiTarget) {
    $WebProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($ExistingWeb.OwningProcess)"
    if (-not $WebProcess -or $WebProcess.Name -ne 'node.exe' -or $WebProcess.CommandLine -notmatch 'vite[\\/]+bin[\\/]+vite\.js') {
      throw "Port $WebPort is occupied by a service that is not the FlowSense Vite server. Stop it or choose another web port."
    }
    Write-Host "Restarting the FlowSense web server because its API target is '$ConfiguredApiTarget' (expected '$ExpectedApiTarget')."
    Stop-Process -Id $WebProcess.ProcessId -ErrorAction Stop
    $PortReleased = $false
    for ($Attempt = 0; $Attempt -lt 15; $Attempt++) {
      if (-not (Get-NetTCPConnection -LocalPort $WebPort -State Listen -ErrorAction SilentlyContinue)) { $PortReleased = $true; break }
      Start-Sleep -Milliseconds 300
    }
    if (-not $PortReleased) { throw "FlowSense Vite did not release port $WebPort after restart." }
    $ExistingWeb = $null
  }
}
if (-not $ExistingWeb) {
  Start-Process -FilePath 'node' -ArgumentList @(('"' + $ViteScript + '"'),'--host','127.0.0.1','--port',"$WebPort") -WorkingDirectory (Join-Path $Repo 'frontend') -WindowStyle Hidden -RedirectStandardOutput (Join-Path $Repo 'frontend.local.log') -RedirectStandardError (Join-Path $Repo 'frontend.local.err.log')
}
$Ready = $false
for ($Attempt = 0; $Attempt -lt 30; $Attempt++) {
  try {
    $Health = Invoke-RestMethod "http://127.0.0.1:$ApiPort/" -TimeoutSec 2
    $Web = Invoke-WebRequest "http://127.0.0.1:$WebPort/" -TimeoutSec 2
    $ProxyHealth = Invoke-RestMethod "http://127.0.0.1:$WebPort/__flowsense/proxy-health" -TimeoutSec 2
    $CameraZone = Invoke-RestMethod "http://127.0.0.1:$WebPort/api/v1/mobility/video/cameras/caltrans-d7-cctv-1031/analysis-zone" -TimeoutSec 2
    if ($Health.status -eq 'operational' -and $Web.StatusCode -eq 200 -and
        ([string]$ProxyHealth.target).TrimEnd('/') -eq $ExpectedApiTarget -and $CameraZone.enabled) {
      $Ready = $true
      break
    }
  } catch { Start-Sleep -Seconds 1 }
}
if (-not $Ready) { throw 'Services did not respond. Check the local backend and frontend logs.' }
$CameraHistory = Invoke-RestMethod "http://127.0.0.1:$ApiPort/api/v1/mobility/video/cameras/caltrans-d7-cctv-1031/history?limit=1" -TimeoutSec 5
$CameraSummary = Invoke-RestMethod "http://127.0.0.1:$ApiPort/api/v1/mobility/video/cameras/caltrans-d7-cctv-1031/summary" -TimeoutSec 5
$CameraOpenApi = Invoke-RestMethod "http://127.0.0.1:$ApiPort/openapi.json" -TimeoutSec 5
$CameraClipPage = $null
try { $CameraClipPage = Invoke-RestMethod "http://127.0.0.1:$ApiPort/api/v1/mobility/video/cameras/caltrans-d7-cctv-1031/clips?limit=1&include_earlier_zones=true" -TimeoutSec 5 }
catch { }
$HasClipPaging = $false
if ($CameraClipPage) {
  $HasClipPaging = $null -ne $CameraClipPage.PSObject.Properties['has_more'] -and
    $null -ne $CameraClipPage.PSObject.Properties['next_cursor'] -and
    $CameraClipPage.includes_earlier_zones -eq $true
}
$MissingCameraCapabilities = @()
if (-not $CameraHistory.PSObject.Properties['reviewed_events']) {
  $MissingCameraCapabilities += 'archived video review history'
}
if (-not $CameraHistory.PSObject.Properties['candidate_tracks']) {
  $MissingCameraCapabilities += 'full-history class-suggestion totals'
}
if (-not $CameraSummary.PSObject.Properties['track_quality']) {
  $MissingCameraCapabilities += 'track-duration quality diagnostics'
}
if (-not $CameraSummary.PSObject.Properties['capture_status']) {
  $MissingCameraCapabilities += 'live capture-session status'
}
if (-not $CameraSummary.capture_status.PSObject.Properties['reconnect_attempts']) {
  $MissingCameraCapabilities += 'automatic live reconnect status'
}
if ([int]$CameraSummary.capture_status.restart_drain_version -ne 1) {
  $MissingCameraCapabilities += 'safe evidence-recorder restart drain'
}
if ([int]$CameraSummary.road_coverage_policy_version -ne 2) {
  $MissingCameraCapabilities += 'current low-light road-coverage policy'
}
if (-not $CameraSummary.PSObject.Properties['minute_video_coverage']) {
  $MissingCameraCapabilities += 'minute-level video coverage'
}
if (-not $CameraSummary.PSObject.Properties['minute_timeline_sorted']) {
  $MissingCameraCapabilities += 'chronological minute timeline'
}
if (-not $CameraSummary.video_continuity.PSObject.Properties['recent_pauses']) {
  $MissingCameraCapabilities += 'recent and in-progress video gaps'
}
if (-not $CameraSummary.PSObject.Properties['video_evidence_linkage']) {
  $MissingCameraCapabilities += 'recent crossing-to-video evidence coverage'
}
if (-not $CameraSummary.video_evidence_linkage.PSObject.Properties['paused_clip_crossings']) {
  $MissingCameraCapabilities += 'crossings during recording pauses'
}
if ($null -eq $CameraOpenApi.paths.PSObject.Properties['/api/v1/mobility/video/cameras/{camera_id}/capture-status']) {
  $MissingCameraCapabilities += 'lightweight live capture-status endpoint'
}
if (-not $HasClipPaging) {
  $MissingCameraCapabilities += 'paged saved-clip history'
}
$EvidenceFields = @($CameraSummary.video_evidence.PSObject.Properties.Name)
foreach ($Field in @('free_disk_bytes', 'minimum_free_bytes', 'storage_block_reason', 'encoding_crf', 'recent_recording_pauses')) {
  if ($Field -notin $EvidenceFields) { $MissingCameraCapabilities += "video-storage diagnostic '$Field'" }
}
if ($MissingCameraCapabilities.Count -gt 0) {
  $ActiveRecordings = [int]$CameraSummary.video_evidence.recording_clips
  $MissingText = $MissingCameraCapabilities -join ', '
  Write-Warning "The API on port $ApiPort is older than the current camera source and omits: $MissingText. Live video and saved observations may continue, but the camera UI cannot show these diagnostics until the API is restarted from the current source. Active evidence clips: $ActiveRecordings. The launcher will drain clips before a supported restart."
}
Write-Host "FlowSense: http://127.0.0.1:$WebPort/overview"
Write-Host "API: http://127.0.0.1:$ApiPort/docs"
Write-Host 'Los Angeles profile · free Caltrans cameras · cases are stored locally.'

import { useEffect, useRef, useState } from 'react';
import { apiUrl } from '../api/urls';
import { Panel, Badge } from './ui';
import './savedEvidenceReading.css';
import { isMonitoring, monitoringStartedAt, registerMonitoring, setMonitoring } from './monitoring';
import { useProduct } from './store';
import type { Camera } from './types';
import { crossingReviewOffset, missingDetectionClipMessage, playSavedClipAt } from './detectionClipPlayback';
import { archivedReviewHistoryMessage, canSaveVideoReview, confirmableSuggestedClass, groupReviewableDetections, reviewableDetections } from './detectionReviewQueue';
import { candidateHintCoverage, classReviewEvidenceStatus, formatTrackScore } from './detectionDiagnostics';
import { formatClipCapacityNote, formatPausedVideoAnalysisStatus, partitionVideoClips, videoWriterStatus } from './videoStorageDiagnostics';
import { diskReserveDiagnostic } from './diskReserveDiagnostics';
import { monitoringPollDelay } from './monitoringPollDelay';
import { trackQualityFromRecentHistory, type TrackQualitySample } from './trackQualityDiagnostics';
import { buildTrafficTimeline, describeTrafficMinute } from './trafficTimeline';
import { describeContinuityCoverage, describeLatestSampleAge, describeVideoGap, liveCaptureIsFresh } from './videoGapDiagnostics';
import { roadCountDisplay, savedTrackScopeLabel, savedTrackScopeNote } from './roadAnalysisState';
import './trafficSummary.css';
import './savedClips.css';
import { calibrationCorridorProgress, corridorCalibrationCoverage, type CameraZoneStatus } from './cameraCalibration';

interface Summary {
  total_passed: number; tracked_in_window: number; count_basis: string; classes: Record<string, number>; zone_revision?: number;
  directional_zone_enabled: boolean;
  minutes: { minute: string; total: number; classes: Record<string, number>; video_samples?: number }[];
  minute_video_coverage?: boolean;
  traffic_estimate: { level: string; label: string; image_coverage_percent: number | null; updated_at: string | null; sample_count: number; track_crossings_last_minute: number; movement_sample_count?: number | null; visibility?: string; evidence_quality?: string };
  track_quality?: { counted_track_count: number; measurable_track_count?: number; brief_track_count: number; brief_track_percent: number | null; average_observations: number | null };
  video_evidence_linkage?: { window_seconds: number; counted_crossings: number; playable_clip_crossings: number; recording_clip_crossings: number; paused_clip_crossings?: number; no_clip_crossings: number; unavailable_clip_crossings: number; playable_percent: number | null };
  video_continuity?: { window_seconds: number; sample_count: number; session_count: number; long_pause_count: number; longest_pause_seconds: number; in_session_pause_count?: number; longest_in_session_pause_seconds?: number; session_boundary_gap_count?: number; coverage_percent: number | null; latest_sample_age_seconds: number | null; recent_pauses?: Array<{ from: string; to: string; duration_seconds: number; session_changed: boolean; in_progress?: boolean }> };
  capture_status?: { active: boolean; session_state: string; monitoring_lease_count: number; live_viewer_count: number; sample_age_seconds: number | null; frames_decoded: number; inference_updates: number; model?: string | null; detection_profile?: string | null; supplemental_detail_status?: 'road_zone_required' | 'model_unavailable' | 'cuda_required' | 'multiple_sessions' | 'memory_limited' | 'eligible' | null; execution_provider?: string | null; output_fps?: number; inference_fps?: number; evidence_fps?: number | null; visible_tracks?: number | null; confirmed_visible_tracks?: number | null; provisional_visible_tracks?: number | null; reconnect_attempts: number; retry_in_seconds: number | null; error: string; inference_error: string; storage_error?: string };
  video_evidence: { enabled: boolean; external_clip_storage?: boolean; ready_clips: number; recording_clips: number; interrupted_clips: number; short_clips?: number; unavailable_clips?: number; bytes_used: number; max_bytes: number; encoding_crf?: number; free_disk_bytes?: number; minimum_free_bytes?: number; storage_block_reason?: string; recent_recording_pauses?: Array<{ started_at: string; ended_at: string | null; reason: string; in_progress: boolean; timestamp_conflict?: boolean }> };
  road: { name: string; route?: string; direction?: string; matched: boolean; distance_m?: number; association: string };
}
interface Clip { id: string; created_at: string; duration: number; state: string; start_media_time: number; zone_revision?: number }
interface ClipCursor { created_at: string; id: string }
type ReviewedClass = 'car' | 'truck' | 'bus' | 'motorcycle' | 'bicycle' | 'pedestrian' | 'rider' | 'vehicle' | 'false_positive';
interface Crossing { session: string; generation: number; track: number; class: string; effective_class?: string; candidate_class?: string | null; class_status?: string; direction?: string; first_seen?: string; last_seen?: string; crossed_at?: string | null; confidence: number; model_hits: number; observations?: number; counted: boolean; clip: string; crossing_offset_seconds?: number; feedback?: { original_class: string; reviewed_class: ReviewedClass; reviewed_at: string; model_prediction?: string | null } | null }
interface ReviewSummary { reviewed_detections: number; scored_predictions?: number; matching_labels: number; class_or_detection_errors: number; model_abstentions?: number; false_positives?: number; agreement_rate: number | null; applies_to_track_counts?: boolean; basis: string }

export function TrafficSummary({ camera, activeCount, storageError = '' }: { camera: Camera; activeCount: number | null; storageError?: string }) {
  const catalogCameras = useProduct(state => state.cameras);
  const [data, setData] = useState<Summary | null>(null);
  const [zoneStatuses, setZoneStatuses] = useState<CameraZoneStatus[] | null>(null);
  const [zoneCoverageState, setZoneCoverageState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [captureStatus, setCaptureStatus] = useState<{ cameraId: string; value: Summary['capture_status'] } | null>(null);
  const [error, setError] = useState('');
  const [retryingSummary, setRetryingSummary] = useState(false);
  const [summaryRetry, setSummaryRetry] = useState(0);
  const [background, setBackground] = useState(() => isMonitoring(camera.id));
  const [selectedMinute, setSelectedMinute] = useState<string | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const [clipCursor, setClipCursor] = useState<ClipCursor | null>(null);
  const [hasOlderClips, setHasOlderClips] = useState(false);
  const [clipPagingAvailable, setClipPagingAvailable] = useState(true);
  const [loadingOlderClips, setLoadingOlderClips] = useState(false);
  const [olderClipPages, setOlderClipPages] = useState(0);
  const [includeEarlierZones, setIncludeEarlierZones] = useState(false);
  const [shortClipCount, setShortClipCount] = useState(0);
  const [crossings, setCrossings] = useState<Crossing[]>([]);
  const [reviewedHistory, setReviewedHistory] = useState<Crossing[]>([]);
  const [trackedClasses, setTrackedClasses] = useState<Record<string, number> | null>(null);
  const [candidateTracks, setCandidateTracks] = useState<Record<string, number>>({});
  const [candidateScope, setCandidateScope] = useState('the latest saved track records');
  const [candidateHistoryComplete, setCandidateHistoryComplete] = useState<boolean | null>(null);
  const [reviewSummary, setReviewSummary] = useState<ReviewSummary | null>(null);
  const [reviewHistorySupported, setReviewHistorySupported] = useState<boolean | null>(null);
  const [historyTrackQuality, setHistoryTrackQuality] = useState<TrackQualitySample | null>(null);
  const [feedbackValues, setFeedbackValues] = useState<Record<string, ReviewedClass>>({});
  const [playedClipIds, setPlayedClipIds] = useState<Set<string>>(() => new Set());
  const [savingFeedback, setSavingFeedback] = useState<string | null>(null);
  const [feedbackNotice, setFeedbackNotice] = useState('');
  const [feedbackNoticeIsError, setFeedbackNoticeIsError] = useState(false);
  const [clipPlaybackNotice, setClipPlaybackNotice] = useState('');
  const [focusedCrossing, setFocusedCrossing] = useState<Crossing | null>(null);
  const [clipError, setClipError] = useState('');
  const [retryingClipHistory, setRetryingClipHistory] = useState(false);
  const [clipHistoryRetry, setClipHistoryRetry] = useState(0);
  const providerOutOfService = camera.provider_in_service === false;
  const sourceUnavailable = camera.video_health?.state === 'unavailable';
  const clipReview = useRef<HTMLDetailsElement>(null);
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const since = monitoringStartedAt();
  const [now, setNow] = useState(() => Math.floor(Date.now() / 60000) * 60000);
  useEffect(() => { registerMonitoring(camera.id); }, [camera.id]);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(apiUrl('/api/v1/mobility/video/analysis-zones'), {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
    }).then(async response => {
      if (!response.ok) throw new Error('Corridor calibration is unavailable.');
      const result = await response.json() as { cameras: CameraZoneStatus[] };
      setZoneStatuses(result.cameras);
      setZoneCoverageState('ready');
    }).catch(() => { if (!controller.signal.aborted) { setZoneStatuses(null); setZoneCoverageState('error'); } });
    return () => controller.abort();
  }, [camera.id]);
  useEffect(() => {
    let stopped = false, pending = false;
    const controller = new AbortController();
    const update = async () => {
      if (pending) return;
      pending = true;
      try {
        const response = await fetch(apiUrl(`/api/v1/mobility/video/cameras/${encodeURIComponent(camera.id)}/capture-status`), { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(3000)]) });
        if (!response.ok) return;
        const result = await response.json() as NonNullable<Summary['capture_status']>;
        if (!stopped) setCaptureStatus({ cameraId: camera.id, value: result });
      } catch { /* Keep the last live status while the next lightweight poll retries. */ }
      finally { pending = false; }
    };
    void update();
    const timer = window.setInterval(() => void update(), 2000);
    return () => { stopped = true; controller.abort(); clearInterval(timer); };
  }, [camera.id]);
  useEffect(() => {
    let stopped = false, pending = false, consecutiveFailures = 0;
    let timer: number | undefined;
    const controller = new AbortController();
    const update = async () => {
      if (pending) return;
      pending = true;
      try {
        const response = await fetch(apiUrl(`/api/v1/mobility/video/cameras/${encodeURIComponent(camera.id)}/summary?since=${encodeURIComponent(since)}`), { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) });
        if (!response.ok) throw new Error('Monitoring history is temporarily unavailable.');
        const result = await response.json() as Summary;
        consecutiveFailures = 0;
        if (!stopped) { setData(result); setError(''); setNow(Math.floor(Date.now() / 60000) * 60000); }
      } catch (reason) {
        consecutiveFailures += 1;
        if (!stopped) setError(reason instanceof Error ? reason.message : 'Could not load traffic history.');
      } finally {
        pending = false;
        if (!stopped) setRetryingSummary(false);
        if (!stopped) timer = window.setTimeout(() => void update(), monitoringPollDelay(consecutiveFailures, consecutiveFailures === 0));
      }
    };
    void update();
    return () => { stopped = true; controller.abort(); if (timer !== undefined) clearTimeout(timer); };
  }, [camera.id, since, summaryRetry]);
  useEffect(() => {
    let stopped = false, pending = false;
    const controller = new AbortController();
    const update = async () => {
      if (pending) return;
      pending = true;
      try {
        const response = await fetch(apiUrl(`/api/v1/mobility/video/cameras/${encodeURIComponent(camera.id)}/history?limit=500`), { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) });
        if (!response.ok) throw new Error('Saved clip history is temporarily unavailable.');
        const result = await response.json() as { clips?: Clip[]; events?: Crossing[]; reviewed_events?: Crossing[]; unique_tracks?: Record<string, number>; candidate_tracks?: Record<string, number>; directional_zone_enabled?: boolean; review_summary?: ReviewSummary };
        const clipQuery = new URLSearchParams({ limit: '30', include_earlier_zones: String(includeEarlierZones) });
        const clipResponse = await fetch(apiUrl(`/api/v1/mobility/video/cameras/${encodeURIComponent(camera.id)}/clips?${clipQuery}`), { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) });
        const pagingAvailable = clipResponse.ok;
        const clipPage = pagingAvailable
          ? await clipResponse.json() as { clips: Clip[]; has_more: boolean; next_cursor: ClipCursor | null }
          : { clips: result.clips || [], has_more: false, next_cursor: null };
        const { reviewable: readyClips, shortCount } = partitionVideoClips(clipPage.clips);
        const readyIds = new Set(readyClips.map(clip => clip.id));
        const hasFullCandidateHistory = Object.hasOwn(result, 'candidate_tracks');
        const candidateTracks = hasFullCandidateHistory ? result.candidate_tracks || {} : (result.events || []).reduce<Record<string, number>>((totals, event) => {
          if (event.class === 'vehicle' && event.class_status === 'uncertain' && event.candidate_class && !event.feedback) {
            totals[event.candidate_class] = (totals[event.candidate_class] || 0) + 1;
          }
          return totals;
        }, {});
        if (!stopped) {
          setClips(current => {
            const latestIds = new Set(readyClips.map(clip => clip.id));
            return [...readyClips, ...current.filter(clip => !latestIds.has(clip.id))]
              .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
          });
          if (olderClipPages === 0) {
            setClipCursor(clipPage.next_cursor);
            setHasOlderClips(clipPage.has_more);
            setClipPagingAvailable(pagingAvailable);
          }
          setShortClipCount(shortCount);
          setTrackedClasses(result.unique_tracks || null);
          setCandidateTracks(candidateTracks);
          setCandidateHistoryComplete(hasFullCandidateHistory);
          setCandidateScope(hasFullCandidateHistory ? 'all saved track records in the current road zone' : 'the latest 500 saved track records');
          setReviewSummary(result.review_summary || null);
          setReviewHistorySupported(Object.hasOwn(result, 'reviewed_events'));
          setHistoryTrackQuality(trackQualityFromRecentHistory(result.events || []));
          const reviewable = reviewableDetections(result.events || [], readyIds, result.directional_zone_enabled);
          const groups = groupReviewableDetections(reviewable);
          setCrossings([...groups.pending, ...groups.reviewed, ...groups.counted]);
          const reviewed = [...(result.events || []), ...(result.reviewed_events || [])]
            .filter((event, index, all) => Boolean(event.feedback) && Boolean(event.clip)
              && all.findIndex(item => item.session === event.session && item.generation === event.generation && item.track === event.track) === index)
            .sort((a, b) => Date.parse(b.feedback!.reviewed_at) - Date.parse(a.feedback!.reviewed_at))
            .slice(0, 50);
          setReviewedHistory(reviewed);
          setClipError('');
        }
      } catch (reason) { if (!stopped) setClipError(reason instanceof Error ? reason.message : 'Could not load saved clips.'); }
      finally { pending = false; if (!stopped) setRetryingClipHistory(false); }
    };
    void update(); const timer = window.setInterval(() => void update(), 10000);
    return () => { stopped = true; controller.abort(); clearInterval(timer); };
  }, [camera.id, olderClipPages, includeEarlierZones, clipHistoryRetry]);
  const bins = buildTrafficTimeline(data?.minutes || [], since, now);
  const maximum = Math.max(1, ...bins.map(bin => bin.total));
  const selection = bins.find(bin => bin.minute === selectedMinute);
  const estimate = data?.traffic_estimate;
  const corridorCoverage = zoneStatuses ? corridorCalibrationCoverage(camera, zoneStatuses) : null;
  const currentCorridorKey = camera.route && camera.direction
    ? `${camera.route.trim().toUpperCase()}|${camera.direction.trim().toLowerCase()}` : '';
  const currentCorridor = zoneStatuses && currentCorridorKey
    ? calibrationCorridorProgress(catalogCameras, zoneStatuses).find(item => item.key === currentCorridorKey)
    : undefined;
  const roadZoneEnabled = data?.directional_zone_enabled;
  const roadZoneRequired = roadZoneEnabled === false;
  const analyzedAt = estimate?.updated_at && Number.isFinite(Date.parse(estimate.updated_at))
    ? new Date(estimate.updated_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' }) : null;
  const evidence = data?.video_evidence;
  const currentCaptureStatus = (captureStatus?.cameraId === camera.id ? captureStatus.value : null) ?? data?.capture_status;
  const activeStorageError = storageError || currentCaptureStatus?.storage_error || '';
  const archivedReviewMessage = archivedReviewHistoryMessage(reviewHistorySupported, reviewSummary?.reviewed_detections || 0);
  const shortClips = evidence?.short_clips ?? shortClipCount;
  const storagePercent = evidence ? Math.min(100, Math.round(evidence.bytes_used / Math.max(1, evidence.max_bytes) * 100)) : 0;
  const storageText = evidence ? `${(evidence.bytes_used / 1_000_000_000).toFixed(2)} / ${(evidence.max_bytes / 1_000_000_000).toFixed(2)} GB used · ${storagePercent}%` : 'Checking clip storage…';
  const remainingClipStorage = evidence ? Math.max(0, evidence.max_bytes - evidence.bytes_used) / 1_000_000_000 : null;
  const writerStatus = videoWriterStatus(activeStorageError, evidence?.storage_block_reason || '');
  const storageBlockReason = writerStatus.pauseReason;
  const diskReserve = evidence ? diskReserveDiagnostic(evidence.free_disk_bytes, evidence.minimum_free_bytes) : null;
  const storageRecoverySteps = diskReserve?.level === 'critical'
    ? evidence?.external_clip_storage
      ? 'Free space on the configured evidence volume until it meets the reserve, or move VIDEO_EVIDENCE_DIR to another volume with adequate headroom, then restart the API. Existing clips are preserved.'
      : 'Free space on this volume until it meets the reserve, or configure VIDEO_EVIDENCE_DIR on another volume and restart the API. Keep VIDEO_EVIDENCE_MIN_FREE_BYTES as the safety margin. Existing clips are preserved; FlowSense does not delete them automatically.'
    : null;
  const storageState = remainingClipStorage == null ? 'checking' : storagePercent >= 90 ? 'critical' : storagePercent >= 75 ? 'near-limit' : 'available';
  const trackedTotal = trackedClasses ? Object.values(trackedClasses).reduce((total, count) => total + count, 0) : null;
  const candidateHintTotal = Object.values(candidateTracks).reduce((total, count) => total + count, 0);
  const hintCoverage = candidateHintCoverage(candidateHintTotal, trackedClasses?.vehicle, candidateHistoryComplete === true);
  const latestPlayableClip = clips[0];
  const latestClipAgeMinutes = latestPlayableClip && data?.traffic_estimate.updated_at
    ? Math.max(0, Math.floor((Date.parse(data.traffic_estimate.updated_at) - Date.parse(latestPlayableClip.created_at)) / 60000)) : null;
  const playCrossing = (crossing: Crossing) => {
    if (!crossing.clip) { setClipPlaybackNotice(missingDetectionClipMessage(false)); return; }
    if (clipReview.current) clipReview.current.open = true;
    clipReview.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const video = videoRefs.current[crossing.clip];
    if (!video) {
      setFocusedCrossing(crossing);
      setClipPlaybackNotice('Loading this detection’s linked saved video…');
      return;
    }
    setFocusedCrossing(null);
    const clip = clips.find(item => item.id === crossing.clip);
    const firstSeenOffset = crossing.first_seen && clip
      ? (Date.parse(crossing.first_seen) - Date.parse(clip.created_at)) / 1000 : Number.NaN;
    const offset = crossing.counted && Number.isFinite(crossing.crossing_offset_seconds)
      ? crossingReviewOffset(crossing.crossing_offset_seconds!)
      : Number.isFinite(firstSeenOffset) ? firstSeenOffset : 0;
    setClipPlaybackNotice('');
    setClipError('');
    playSavedClipAt(video, offset || 0, message => setClipError(`Could not play saved evidence: ${message}`));
  };
  useEffect(() => {
    if (!focusedCrossing?.clip) return;
    const video = videoRefs.current[focusedCrossing.clip];
    if (!video) return;
    const clip = clips.find(item => item.id === focusedCrossing.clip);
    const firstSeenOffset = focusedCrossing.first_seen && clip
      ? (Date.parse(focusedCrossing.first_seen) - Date.parse(clip.created_at)) / 1000 : Number.NaN;
    const offset = focusedCrossing.counted && Number.isFinite(focusedCrossing.crossing_offset_seconds)
      ? crossingReviewOffset(focusedCrossing.crossing_offset_seconds!)
      : Number.isFinite(firstSeenOffset) ? firstSeenOffset : 0;
    setClipPlaybackNotice('');
    setClipError('');
    playSavedClipAt(video, offset || 0, message => setClipError(`Could not play saved evidence: ${message}`));
  }, [focusedCrossing, clips]);
  const reviewCrossing = async (crossing: Crossing, confirmedSuggestion?: ReviewedClass) => {
    if (savingFeedback) return;
    const key = `${crossing.session}-${crossing.generation}-${crossing.track}`;
    if (!canSaveVideoReview(crossing, playedClipIds)) {
      setFeedbackNoticeIsError(true);
      setFeedbackNotice('Play this detection’s linked saved video before saving or changing its label.');
      return;
    }
    const reviewedClass = confirmedSuggestion || feedbackValues[key] || crossing.feedback?.reviewed_class || crossing.effective_class as ReviewedClass || crossing.class as ReviewedClass;
    setSavingFeedback(key); setFeedbackNotice(''); setFeedbackNoticeIsError(false);
    try {
      const response = await fetch(apiUrl(`/api/v1/mobility/video/cameras/${encodeURIComponent(camera.id)}/tracks/${encodeURIComponent(crossing.session)}/${crossing.generation}/${crossing.track}/feedback`), {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reviewed_class: reviewedClass }),
        signal: AbortSignal.timeout(10000),
      });
      const result = await response.json() as { reviewed_class?: ReviewedClass; detail?: string; original_class?: string; model_prediction?: string | null; applies_to_track_counts?: boolean; reviewed_at?: string };
      if (!response.ok) throw new Error(result.detail || 'Could not save the detection review.');
      if (result.applies_to_track_counts !== true || !Object.hasOwn(result, 'model_prediction')) {
        setFeedbackNotice('Review saved. Restart the camera service to apply corrections to saved track and crossing totals.');
        return;
      }
      const originalClass = result.original_class || crossing.class;
      const modelPrediction = result.model_prediction ?? null;
      const grade = (prediction: string | null | undefined, label: ReviewedClass) => ({
        scored: Boolean(prediction && !['vehicle', 'false_positive'].includes(label)),
        match: Boolean(prediction && prediction === label && label !== 'vehicle'),
        abstention: !prediction && !['vehicle', 'false_positive'].includes(label),
        falsePositive: label === 'false_positive',
      });
      const previous = crossing.feedback ? grade(crossing.feedback.model_prediction, crossing.feedback.reviewed_class)
        : { scored: false, match: false, abstention: false, falsePositive: false };
      const next = grade(modelPrediction, reviewedClass);
      const updatedCrossing = { ...crossing, effective_class: reviewedClass, feedback: { original_class: originalClass, model_prediction: modelPrediction,
        reviewed_class: result.reviewed_class || reviewedClass, reviewed_at: result.reviewed_at || new Date().toISOString() } };
      setCrossings(current => current.map(item => item.session === crossing.session && item.generation === crossing.generation && item.track === crossing.track
        ? updatedCrossing : item));
      setReviewedHistory(current => [updatedCrossing, ...current.filter(item => item.session !== crossing.session
        || item.generation !== crossing.generation || item.track !== crossing.track)].slice(0, 50));
      setTrackedClasses(current => {
        if (!current) return current;
        const before = crossing.effective_class || crossing.class;
        if (before === reviewedClass) return current;
        const updated = { ...current };
        if (before !== 'false_positive') updated[before] = Math.max(0, (updated[before] || 0) - 1);
        if (reviewedClass !== 'false_positive') updated[reviewedClass] = (updated[reviewedClass] || 0) + 1;
        return updated;
      });
      setCandidateTracks(current => {
        if (crossing.feedback || crossing.class !== 'vehicle' || !crossing.candidate_class) return current;
        const updated = { ...current };
        updated[crossing.candidate_class] = Math.max(0, (updated[crossing.candidate_class] || 0) - 1);
        if (updated[crossing.candidate_class] === 0) delete updated[crossing.candidate_class];
        return updated;
      });
      setReviewSummary(current => {
        if (!current) return current;
        const reviewedDetections = current.reviewed_detections + (crossing.feedback ? 0 : 1);
        const scoredPredictions = (current.scored_predictions ?? 0) + Number(next.scored) - Number(previous.scored);
        const matchingLabels = current.matching_labels + Number(next.match) - Number(previous.match);
        const modelAbstentions = (current.model_abstentions ?? 0) + Number(next.abstention) - Number(previous.abstention);
        const falsePositives = (current.false_positives ?? 0) + Number(next.falsePositive) - Number(previous.falsePositive);
        const evaluated = scoredPredictions + falsePositives;
        return { ...current, reviewed_detections: reviewedDetections, scored_predictions: scoredPredictions,
          matching_labels: matchingLabels, model_abstentions: modelAbstentions, false_positives: falsePositives,
          class_or_detection_errors: evaluated - matchingLabels,
          agreement_rate: evaluated ? matchingLabels / evaluated : null };
      });
      setFeedbackNotice('Review saved.');
    } catch (reason) { setFeedbackNoticeIsError(true); setFeedbackNotice(reason instanceof Error ? reason.message : 'Could not save the detection review.'); }
    finally { setSavingFeedback(null); }
  };
  const loadOlderClips = async () => {
    if (!clipCursor || loadingOlderClips) return;
    setLoadingOlderClips(true);
    setClipError('');
    try {
      const query = new URLSearchParams({ limit: '30', before_created_at: clipCursor.created_at, before_id: clipCursor.id,
        include_earlier_zones: String(includeEarlierZones) });
      const response = await fetch(apiUrl(`/api/v1/mobility/video/cameras/${encodeURIComponent(camera.id)}/clips?${query}`), { signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('Could not load older saved clips.');
      const page = await response.json() as { clips: Clip[]; has_more: boolean; next_cursor: ClipCursor | null };
      const older = partitionVideoClips(page.clips).reviewable;
      setClips(current => {
        const existing = new Set(current.map(clip => clip.id));
        return [...current, ...older.filter(clip => !existing.has(clip.id))]
          .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
      });
      setClipCursor(page.next_cursor);
      setHasOlderClips(page.has_more);
      setOlderClipPages(count => count + 1);
    } catch (reason) { setClipError(reason instanceof Error ? reason.message : 'Could not load older saved clips.'); }
    finally { setLoadingOlderClips(false); }
  };
  const renderCrossing = (crossing: Crossing) => {
    const key = `${crossing.session}-${crossing.generation}-${crossing.track}`;
    const suggestedClass = confirmableSuggestedClass(crossing, playedClipIds) as ReviewedClass | null;
    const reviewEvidencePlayed = canSaveVideoReview(crossing, playedClipIds);
    const waitingForOtherReview = savingFeedback !== null && savingFeedback !== key;
    const detectionTime = crossing.crossed_at || crossing.last_seen || crossing.first_seen;
    const shownClass = crossing.feedback?.reviewed_class || crossing.class;
    const label = crossing.feedback ? `${shownClass.replace('_', ' ')} · reviewed`
      : crossing.class === 'vehicle' && crossing.candidate_class ? `${crossing.candidate_class[0].toUpperCase()}${crossing.candidate_class.slice(1)}? · Vehicle` : crossing.class;
    const evidenceScope = roadZoneRequired
      ? 'Full-scene track · road lane not assigned'
      : crossing.counted ? 'Counted inbound crossing' : crossing.direction === 'approaching' ? 'Unconfirmed candidate · approaching lane' : 'Uncertain class';
    const labelEvidenceScope = crossing.class_status === 'stable' && !crossing.counted && !crossing.feedback
      ? roadZoneRequired ? 'Stable model label · full scene' : 'Stable model label · approaching lane'
      : evidenceScope;
    return <article className="p-crossing-item" aria-busy={savingFeedback === key} key={`${crossing.clip}-${crossing.track}-${crossing.crossed_at}`}>
      <button className="p-crossing-main" onClick={() => playCrossing(crossing)}><span>{label} · {detectionTime ? new Date(detectionTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Time unavailable'}</span><small>{crossing.feedback ? 'Operator-reviewed label applied to saved totals' : crossing.candidate_class ? `Unconfirmed ${crossing.candidate_class} candidate · ${roadZoneRequired ? 'full scene' : crossing.direction === 'approaching' ? 'approaching lane' : 'road lane not assigned'}` : labelEvidenceScope} · Track #{crossing.track} · {formatTrackScore(crossing.confidence)} · {crossing.model_hits > 0 ? `${crossing.model_hits} detector updates` : 'detector update count unavailable'}</small><strong>{crossing.counted ? 'Play video at crossing' : 'Play detection clip'}</strong></button>
      {crossing.class === 'vehicle' && crossing.class_status === 'uncertain' && crossing.candidate_class && !crossing.feedback && <div className="p-review-suggestion">
        <button type="button" disabled={!suggestedClass || savingFeedback !== null} onClick={() => { if (suggestedClass) void reviewCrossing(crossing, suggestedClass); }}>
          {savingFeedback === key ? 'Saving review…' : `Confirm ${crossing.candidate_class[0].toUpperCase()}${crossing.candidate_class.slice(1)} after video review`}
        </button>
        {!suggestedClass && <small>Play this detection’s linked video first to enable confirmation.</small>}
      </div>}
      <details className="p-crossing-review-edit"><summary>{crossing.feedback ? `Reviewed · ${crossing.feedback.reviewed_class.replace('_', ' ')}` : 'Review detection label'}</summary>
        <label>What is visible in the video?
          <select aria-label={`Reviewed label for track ${crossing.track}`} value={feedbackValues[key] || crossing.feedback?.reviewed_class || crossing.effective_class as ReviewedClass || crossing.class as ReviewedClass}
            onChange={event => setFeedbackValues(current => ({ ...current, [key]: event.target.value as ReviewedClass }))}>
          <option value="car">Car</option><option value="truck">Truck</option><option value="bus">Bus</option><option value="motorcycle">Motorcycle</option><option value="bicycle">Bicycle</option><option value="pedestrian">Person</option><option value="rider">Rider · bike or motorcycle unclear</option><option value="vehicle">Vehicle, type unclear</option><option value="false_positive">No target object</option>
          </select>
        </label>
        <button className="p-text-button" disabled={savingFeedback !== null || !reviewEvidencePlayed} onClick={() => void reviewCrossing(crossing)}>{savingFeedback === key ? 'Saving review…' : crossing.feedback ? 'Update review' : 'Save review'}</button>
        {!reviewEvidencePlayed && <small>Play this detection’s linked saved video before saving a label.</small>}
        {waitingForOtherReview && <small className="p-review-wait-note">Another review is being saved. Wait for its result before submitting this label.</small>}
      </details>
    </article>;
  };
  const uncertainCrossings = crossings.filter(crossing => !crossing.counted && !crossing.feedback);
  const recentlyReviewedCrossings = reviewedHistory;
  const countedCrossings = crossings.filter(crossing => crossing.counted);
  const roadBadge = providerOutOfService || sourceUnavailable ? 'Video unavailable' : !estimate ? 'Checking feed' : data?.directional_zone_enabled === false ? 'Road setup needed' : estimate.evidence_quality === 'sparse' ? 'Sparse evidence' : estimate.evidence_quality === 'motion_unavailable' ? 'Motion unavailable' : estimate.level === 'unknown' ? (estimate.label === 'No recent estimate' ? 'Estimate stale' : 'Estimate pending') : estimate.visibility === 'low_light' ? 'Night estimate' : 'Live estimate';
  const roadTone = providerOutOfService || sourceUnavailable ? 'amber' : estimate?.level === 'moving' ? 'green' : 'amber';
  const riderObserved = Number(data?.classes?.rider || trackedClasses?.rider || 0) > 0;
  const kinds = [['car', 'Cars'], ['truck', 'Trucks'], ['bus', 'Buses'], ['motorcycle', 'Motorcycles'], ['bicycle', 'Bicycles'], ...(riderObserved ? [['rider', 'Riders · mode unclear']] : []), ['vehicle', 'Type pending']];
  return <div className="p-traffic-summary">
    <Panel title="Monitoring history" action={<Badge tone={activeCount ? 'green' : 'amber'}>{activeCount ?? '—'} tracked in last 2 sec</Badge>}>
      {roadZoneRequired && <div className="p-road-zone-required" role="status"><span>{providerOutOfService
        ? 'This camera is currently out of service. Saved detections are preserved; road-specific totals will be available after the inbound lane and travel direction are reviewed.'
        : <>Live tracking is active. Set the inbound lane and travel direction in the video controls to unlock road-specific totals.</>}</span>{!providerOutOfService && <a className="p-road-zone-action" href="#camera-live-player">Go to video controls <span aria-hidden="true">→</span></a>}</div>}
      <div className={`p-traffic-total${roadZoneRequired ? ' is-unavailable' : ''}`}><span>Counted inbound crossings</span><strong>{roadCountDisplay(data?.total_passed, roadZoneEnabled)}</strong><small>{roadZoneRequired ? 'Configure the inbound lane to begin directional counting.' : `Tracks that crossed the configured counting line since ${new Date(since).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`}</small></div>
      <div className="p-traffic-types">{kinds.map(([key, label]) => <div key={key}><span>{label}</span><b>{roadCountDisplay(data?.classes?.[key], roadZoneEnabled)}</b></div>)}</div>
      <details className="p-tracked-records"><summary><span>{savedTrackScopeLabel(roadZoneEnabled)}</span><b>{trackedTotal ?? '—'}</b></summary><p>{savedTrackScopeNote(roadZoneEnabled)}</p><div className="p-tracked-record-types">{kinds.map(([key, label]) => <span key={key}>{label} <b>{trackedClasses?.[key] ?? 0}</b></span>)}</div></details>
      {(candidateHistoryComplete === false || candidateHintTotal > 0) && <details className={`p-candidate-records${candidateHistoryComplete === false ? ' p-candidate-records--partial' : ''}`} aria-label="Unconfirmed class suggestions"><summary><b>Class suggestions · review needed</b><span>{candidateHintTotal}</span></summary><p>Some saved vehicles from {candidateScope} may need a clearer class. Review these suggestions before they are added to class totals.</p>{hintCoverage && <p>Type hints are available for {hintCoverage.candidateCount} of {hintCoverage.pendingVehicleCount} pending vehicles ({hintCoverage.percent}%).</p>}{candidateHistoryComplete === false && <p className="p-candidate-history-warning" role="status">This view includes the latest 500 saved tracks. Older suggestions may also be waiting.</p>}<div>{Object.entries(candidateTracks).filter(([, count]) => count > 0).map(([key, count]) => <span key={key}>{key[0].toUpperCase() + key.slice(1)}? <b>{count}</b></span>)}</div></details>}
      <div className="p-traffic-chart"><div><b>Track crossings per minute</b><small>{bins.length > 1 ? `Last ${bins.length} minutes` : 'Current minute'}</small></div>
        {roadZoneRequired ? <p className="p-road-zone-required-note">Road-specific crossings will appear after the inbound zone and direction are reviewed.</p> : <div className="p-traffic-bars">{bins.map(bin => <button key={bin.minute} className={bin.observed ? '' : 'is-unobserved'} title={describeTrafficMinute(bin)} aria-label={describeTrafficMinute(bin)} aria-pressed={selectedMinute === bin.minute} onClick={() => setSelectedMinute(bin.minute)}><i style={{ height: `${Math.max(3, bin.total / maximum * 100)}%` }} /></button>)}</div>}
        {!roadZoneRequired && <label className="p-traffic-minute-picker"><span>Inspect a minute</span><select value={selection?.minute || ''} onChange={event => setSelectedMinute(event.currentTarget.value || null)}><option value="">Choose a minute</option>{bins.map(bin => <option key={bin.minute} value={bin.minute}>{describeTrafficMinute(bin)}</option>)}</select></label>}
        {!roadZoneRequired && <p>{selection ? selection.observed
          ? `${new Date(selection.minute).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })} · ${selection.total} track crossings · ${selection.video_samples} video analysis samples`
          : `${new Date(selection.minute).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })} · No video evidence · crossings unknown`
          : 'Choose a minute above or select a bar. Hatched bars mean no video evidence was saved.'}</p>}
      </div>
      <p className="p-small-note">{data?.count_basis || 'Counts are based on model tracks crossing the approaching-lane counter.'} Check recording, continuity and storage status below before relying on saved video.{data?.minute_video_coverage === false ? ' This server does not report minute-level video coverage, so zero bars may include unobserved gaps.' : ''}</p>
      <p className="p-small-note">{roadZoneRequired ? 'Full-scene records remain saved; records from earlier road-zone revisions are retained.' : 'History uses the current road zone. Records from earlier zones remain saved.'}</p>
      <button className="p-text-button" aria-pressed={background || isMonitoring(camera.id)} onClick={() => { const next = !isMonitoring(camera.id); setMonitoring(camera.id, next); setBackground(next); }}>{background || isMonitoring(camera.id) ? 'Pause background monitoring' : 'Keep monitoring in the app'}</button>
      <p className="p-small-note">{providerOutOfService
        ? background || isMonitoring(camera.id)
          ? 'Monitoring is paused while Caltrans lists this camera out of service. Your saved preference will resume when the provider reports it in service.'
          : 'Caltrans lists this camera out of service. Turn monitoring on to resume saving automatically when the provider reports it in service.'
        : sourceUnavailable
          ? background || isMonitoring(camera.id)
            ? 'Monitoring is paused after the HLS source returned a not-found response. Your preference and history are preserved; a later health check can resume monitoring.'
            : 'The HLS source returned a not-found response. Turn monitoring on to resume automatically after a later health check confirms the feed is back.'
        : background || isMonitoring(camera.id)
        ? 'Background monitoring is on. This camera can keep saving observations while its page is hidden.'
        : 'Background monitoring is off. Video capture pauses when this page is hidden or closed.'}</p>
      {error && <div role="status" className="p-inline-error p-clip-retry"><span>{error} {data ? 'Showing the last successfully loaded history.' : ''}</span><button type="button" className="p-text-button" disabled={retryingSummary} onClick={() => { setRetryingSummary(true); setSummaryRetry(value => value + 1); }}>{retryingSummary ? 'Retrying…' : 'Retry traffic history'}</button></div>}
    </Panel>
    <Panel title="Video evidence" action={<Badge tone={evidence?.enabled && !storageBlockReason ? 'green' : 'amber'}>{!evidence ? 'Checking storage' : !evidence.enabled ? 'MP4 capture off' : storageBlockReason ? 'Recording paused' : evidence.recording_clips ? 'Recording' : 'Armed · waiting for detections'}</Badge>}>
      {evidence?.external_clip_storage && <p className="p-small-note">New MP4 clips are stored in the configured evidence directory. Existing clips remain available from their original location.</p>}
      {storageBlockReason
        ? <p className="p-small-note p-evidence-alert" role="alert">Saving video clips is paused. Live video and vehicle history continue; saved clips are safe.</p>
        : writerStatus.warning
          ? <p className="p-small-note" role="status">{writerStatus.warning}{writerStatus.warning.startsWith('Evidence writer fell behind') ? ' Recording can continue while the bounded queue drains; a few frames in the clip may be missing.' : ''}</p>
        : <p className="p-small-note">{!evidence ? 'Clip recording status is not available from the server yet.' : evidence.enabled ? evidence.recording_clips ? 'A short H.264 evidence segment is being recorded from tracked detections.' : 'Detection-triggered MP4 recording is enabled. No clip is open right now; clips begin when tracked detections appear.' : 'Live video and observation history are active. Detection-triggered MP4 clips are disabled in server settings.'}</p>}
      {storageRecoverySteps && <details className="p-recording-pause-history">
        <summary>How to resume saving video</summary>
        <div><p>{storageRecoverySteps}</p><p>To use external storage, set <code>VIDEO_EVIDENCE_DIR</code> to a directory on the mounted volume and set <code>VIDEO_EVIDENCE_MAX_BYTES</code> to a quota that fits its free space. After restart, verify this panel reports external clip storage and that a new clip becomes playable.</p></div>
      </details>}
      {storageBlockReason && data?.video_continuity && <p className="p-small-note" role="status">{formatPausedVideoAnalysisStatus(data.video_continuity.sample_count, data.video_continuity.window_seconds)}</p>}
      {diskReserve && <p className={`p-small-note p-video-storage-note p-video-storage-note--${diskReserve.level}`}>{diskReserve.text}</p>}
      {diskReserve?.level === 'critical' && !evidence?.external_clip_storage && <details className="p-recording-pause-history">
        <summary>How to resume MP4 recording</summary>
        <p className="p-small-note">Free the amount shown above on the system drive, or connect a mounted volume with at least 1 GB free and point new evidence clips to it. The launcher checks available space before restarting the API; existing clips and detection history stay in place.</p>
        <pre><code>.\scripts\run_flowsense.ps1 -EvidenceDirectory 'E:\FlowSense\Evidence' -EvidenceMaxGigabytes 50</code></pre>
        <p className="p-small-note">Replace <code>E:\FlowSense\Evidence</code> with a folder on your available volume and choose a quota that fits. If no other volume is mounted, this command cannot resume recording until one is available.</p>
      </details>}
      {!!evidence?.recent_recording_pauses?.length && <details className="p-recording-pause-history"><summary>Recording pause history · {evidence.recent_recording_pauses.length}</summary><ul>{evidence.recent_recording_pauses.map((pause, index) => <li key={`${pause.started_at}-${index}`}><b>{pause.in_progress ? 'In progress' : pause.timestamp_conflict ? `${new Date(pause.started_at).toLocaleString('en-US')} · End time unavailable (timestamp conflict)` : `${new Date(pause.started_at).toLocaleString('en-US')} – ${pause.ended_at ? new Date(pause.ended_at).toLocaleString('en-US') : 'Unknown'}`}</b><span>{pause.reason.replace(/^Video evidence paused:\s*/, '')}</span></li>)}</ul></details>}
      {data?.video_evidence_linkage && <p className="p-small-note">
        {data.video_evidence_linkage.counted_crossings === 0
          ? 'No inbound crossings were counted in the last 15 minutes.'
          : `Recent crossing video evidence · ${data.video_evidence_linkage.playable_clip_crossings} of ${data.video_evidence_linkage.counted_crossings} counted crossings have playable clips (${data.video_evidence_linkage.playable_percent ?? 0}%). ${data.video_evidence_linkage.recording_clip_crossings} are still recording${data.video_evidence_linkage.paused_clip_crossings ? ` · ${data.video_evidence_linkage.paused_clip_crossings} occurred while MP4 recording was paused` : ''} · ${data.video_evidence_linkage.no_clip_crossings}${data.video_evidence_linkage.paused_clip_crossings != null ? ' have no linked clip outside a recorded pause' : ' have no linked clip'} · ${data.video_evidence_linkage.unavailable_clip_crossings} are linked to unavailable clips.`}
      </p>}
      <p className="p-small-note">{evidence ? `${evidence.ready_clips} clips marked ready by the server across road-zone revisions${evidence.recording_clips ? ` · ${evidence.recording_clips} recording` : ''}${evidence.interrupted_clips ? ` · ${evidence.interrupted_clips} interrupted` : ''}` : 'Checking saved clip history…'}</p>
      {!!evidence?.unavailable_clips && <p className="p-small-note">{evidence.unavailable_clips} clip records have no video file in storage. Detection history is preserved, but those videos cannot be played.</p>}
      {shortClips > 0 && <p className="p-small-note">{evidence?.short_clips != null ? `${shortClips} saved captures are shorter than 0.25 seconds` : `${shortClips} of the latest 30 captures are shorter than 0.25 seconds`}. Their files are retained, but they are excluded from video review because they do not show enough motion.</p>}
      {!evidence?.recording_clips && latestPlayableClip && latestClipAgeMinutes !== null && latestClipAgeMinutes >= 1
        && <p className="p-small-note">Latest playable clip in this road zone: {latestClipAgeMinutes} min ago. Live detections and saved observation history may be newer.</p>}
      {!!evidence?.interrupted_clips && <p className="p-small-note">Interrupted video files are preserved on disk; clips affected by an unclean shutdown may be incomplete.</p>}
      <div className={`p-video-storage p-video-storage--${storageState}`}><progress max={100} value={storagePercent} aria-label="Video clip storage used" /><span>{storageText}</span></div>
      <p className={`p-small-note p-video-storage-note p-video-storage-note--${storageState}`}>{formatClipCapacityNote(remainingClipStorage, storagePercent, Boolean(storageBlockReason), Boolean(evidence?.storage_block_reason))}</p>
      {!!evidence && evidence.encoding_crf != null && evidence.encoding_crf >= 31 && !storageBlockReason && <p className="p-small-note" role="status">New clips are using compact H.264 settings to preserve evidence capacity. This can reduce fine detail in saved clips; live video and detection remain at full resolution.</p>}
      {reviewSummary && <p className="p-small-note">{reviewSummary.applies_to_track_counts !== true
        ? 'Operator labels are saved for review. Restart the camera service to apply corrections to historical track and crossing totals.'
        : reviewSummary.reviewed_detections > 0
          ? `Saved video reviews: ${reviewSummary.matching_labels} of ${(reviewSummary.scored_predictions || 0) + (reviewSummary.false_positives || 0)} specific model decisions matched; ${reviewSummary.model_abstentions || 0} reviewed detections had no specific model label and ${reviewSummary.false_positives || 0} were marked as false positives. Corrections update saved track and crossing totals while preserving the original model output. This selected sample is not a random accuracy estimate.`
          : crossings.length > 0
            ? 'No operator-reviewed labels yet. Review one of the linked detections below to correct its historical class or remove a false positive from track and crossing totals. Original model output remains preserved.'
            : classReviewEvidenceStatus(crossings.length, clips.length, latestClipAgeMinutes, Boolean(storageBlockReason))}</p>}
      {archivedReviewMessage && <p role="status" className="p-small-note">{archivedReviewMessage}</p>}
      {roadZoneRequired && crossings.length > 0 && <p className="p-small-note">These full-scene reviews can correct object classes in saved records; they do not assign a camera track to a road or affect directional traffic estimates.</p>}
      {(crossings.length > 0 || reviewedHistory.length > 0) && <div className="p-crossing-review">
        {clipPlaybackNotice && <p role="status" className="p-small-note">{clipPlaybackNotice}</p>}
        {uncertainCrossings.length > 0 && <b>{roadZoneRequired ? 'Full-scene detections with saved video · road lane unassigned' : 'Detections with saved video · approaching lane'} · {uncertainCrossings.length}</b>}
        {uncertainCrossings.slice(0, 3).map(renderCrossing)}
        {uncertainCrossings.length > 3 && <details className="p-more-crossings"><summary>Review {uncertainCrossings.length - 3} more unconfirmed detections</summary>{uncertainCrossings.slice(3).map(renderCrossing)}</details>}
        {recentlyReviewedCrossings.length > 0 && <details className="p-more-crossings"><summary>Saved video review history · {recentlyReviewedCrossings.length}</summary>{recentlyReviewedCrossings.map(renderCrossing)}</details>}
        {countedCrossings.length > 0 && <b>Recent counted crossings to spot-check · {countedCrossings.length}</b>}
        {countedCrossings.map(renderCrossing)}
        {feedbackNotice && <p role={feedbackNoticeIsError ? 'alert' : 'status'} aria-live={feedbackNoticeIsError ? 'assertive' : 'polite'} className={feedbackNoticeIsError ? 'p-small-note p-inline-error' : 'p-small-note'}>{feedbackNotice}</p>}</div>}
      {focusedCrossing?.clip && !clips.some(clip => clip.id === focusedCrossing.clip) && <div className="p-saved-clip p-focused-detection-clip">
        <div><b>Saved video · Track #{focusedCrossing.track}</b><span>Loaded directly from this reviewed detection’s linked clip</span></div>
        <video ref={video => { videoRefs.current[focusedCrossing.clip!] = video; }} onPlaying={() => setPlayedClipIds(current => current.has(focusedCrossing.clip!) ? current : new Set(current).add(focusedCrossing.clip!))} controls preload="metadata" playsInline aria-label={`Linked saved video for reviewed track ${focusedCrossing.track}`} src={apiUrl(`/api/v1/mobility/video/clips/${encodeURIComponent(focusedCrossing.clip)}`)} />
      </div>}
      <details ref={clipReview} className="p-saved-clips"><summary>Review saved clips · {clips.length} loaded {includeEarlierZones ? 'across road-zone revisions' : 'in the current road zone'}</summary>
        <p className="p-saved-clips-timezone">Dates and times use your device time zone: <b>{Intl.DateTimeFormat().resolvedOptions().timeZone}</b>. Media time is the position within the source video, not the capture date.</p><label className="p-small-note p-clip-history-scope"><input type="checkbox" checked={includeEarlierZones} onChange={event => {
          setClips([]); setClipCursor(null); setHasOlderClips(false); setOlderClipPages(0);
          setIncludeEarlierZones(event.target.checked);
        }} /> Include clips from earlier road-zone revisions</label>
        {clips.map(clip => <div className="p-saved-clip" key={clip.id}>
          <div><b><time dateTime={clip.created_at}>{new Date(clip.created_at).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' })}</time>{includeEarlierZones && clip.zone_revision !== data?.zone_revision ? ` · Earlier road zone r${clip.zone_revision ?? 'legacy'}` : ''}</b><span>{clip.duration.toFixed(1)} sec · media time {clip.start_media_time.toFixed(1)} sec</span></div>
          <video ref={video => { videoRefs.current[clip.id] = video; }} onPlaying={() => setPlayedClipIds(current => current.has(clip.id) ? current : new Set(current).add(clip.id))} controls preload="metadata" playsInline aria-label={`Saved detection clip from ${new Date(clip.created_at).toLocaleString('en-US')}`} src={apiUrl(`/api/v1/mobility/video/clips/${encodeURIComponent(clip.id)}`)} />
        </div>)}
        {!clips.length && !clipError && <p className="p-small-note">New clips appear here after a detected segment is finalized.</p>}
        {hasOlderClips && <button className="p-text-button" disabled={loadingOlderClips} onClick={() => void loadOlderClips()}>{loadingOlderClips ? 'Loading older clips…' : 'Load 30 older clips'}</button>}
        {!clipPagingAvailable && <p className="p-small-note">Older clip pagination becomes available after the camera API is refreshed; the latest clips remain accessible.</p>}
        {clipPagingAvailable && !hasOlderClips && clips.length > 0 && <p className="p-small-note">All playable clips across the selected road-zone revisions are loaded.</p>}
        {clipError && <div role="status" className="p-inline-error p-clip-retry"><span>{clipError} {clips.length > 0 ? 'Previously loaded clips remain available.' : ''}</span><button type="button" className="p-text-button" disabled={retryingClipHistory} onClick={() => { setRetryingClipHistory(true); setClipHistoryRetry(value => value + 1); }}>{retryingClipHistory ? 'Retrying…' : 'Retry clip history'}</button></div>}
      </details>
    </Panel>
    <Panel title="Road conditions" action={<Badge tone={roadTone}>{roadBadge}</Badge>}>
      <div className="p-road-condition"><span>{data?.road.route || camera.name}{data?.road.direction ? ` · ${data.road.direction}bound` : ''}</span><h3>{data?.traffic_estimate.label || 'Collecting observations'}</h3><p>{data?.road.matched ? `${data.road.name} · mapped segment ${data.road.distance_m} m from camera` : data?.road.association || 'Matching this camera to the road network…'}</p>{analyzedAt && <p className="p-road-updated">Latest analyzed sample · {analyzedAt} local time</p>}</div>
      {corridorCoverage && corridorCoverage.total > 0
        ? <><p className="p-small-note p-road-corridor-coverage" role="status"><b>Directed corridor coverage</b> · {corridorCoverage.ready} of {corridorCoverage.total} {corridorCoverage.route} {corridorCoverage.direction}{corridorCoverage.direction.toLowerCase().endsWith('bound') ? '' : 'bound'} video sources have reviewed road zones. This panel shows this camera’s estimate; the map combines estimates from usable sources on the mapped road.</p>
          {currentCorridor?.next_camera && <button className="p-text-button p-road-corridor-next" aria-label={`Check next camera on ${corridorCoverage.route} ${corridorCoverage.direction}: ${currentCorridor.next_camera.name}`} onClick={() => useProduct.getState().navigate(`/cameras/${encodeURIComponent(currentCorridor.next_camera!.id)}?calibrate=road&queue=1`)}>Check next camera · {currentCorridor.next_camera.name}</button>}
        </>
        : camera.route && camera.direction && zoneCoverageState === 'loading'
          ? <p className="p-small-note p-road-corridor-coverage" role="status">Checking reviewed camera coverage for {camera.route} {camera.direction}{camera.direction.toLowerCase().endsWith('bound') ? '' : 'bound'}…</p>
          : camera.route && camera.direction && zoneCoverageState === 'error'
            ? <p className="p-small-note p-road-corridor-coverage" role="status">Directed corridor coverage is unavailable. The estimate shown here is from this camera only.</p>
            : corridorCoverage && corridorCoverage.total === 0
              ? <p className="p-small-note p-road-corridor-coverage" role="status">No video sources are currently listed for this directed corridor. This estimate comes from this camera only.</p>
              : null}
      {currentCaptureStatus && <p className="p-small-note">
        {!currentCaptureStatus.active
          ? providerOutOfService
            ? 'No active capture: Caltrans lists this source out of service. Use “Try video anyway” to check whether its feed has returned.'
            : sourceUnavailable
              ? 'No active capture: the latest HLS check returned a not-found response. Use “Try video anyway” to test the source directly.'
            : 'No active capture session. Open the live video or enable “Keep monitoring in the app” to resume analysis and clip recording.'
          : currentCaptureStatus.session_state !== 'Live'
            ? `Camera capture session · ${currentCaptureStatus.session_state}${currentCaptureStatus.reconnect_attempts ? ` · reconnect attempt ${currentCaptureStatus.reconnect_attempts}${currentCaptureStatus.retry_in_seconds !== null ? ` in ${Math.ceil(currentCaptureStatus.retry_in_seconds)}s` : ''}` : ''}${currentCaptureStatus.error ? ` · ${currentCaptureStatus.error}` : ''}${currentCaptureStatus.inference_error ? ` · ${currentCaptureStatus.inference_error}` : ''}`
            : `Capture active · ${currentCaptureStatus.live_viewer_count} live viewer${currentCaptureStatus.live_viewer_count === 1 ? '' : 's'} · ${currentCaptureStatus.monitoring_lease_count} monitoring lease${currentCaptureStatus.monitoring_lease_count === 1 ? '' : 's'} · ${currentCaptureStatus.frames_decoded} frames decoded · ${currentCaptureStatus.inference_updates} inference updates${currentCaptureStatus.detection_profile ? ` · ${currentCaptureStatus.detection_profile === 'low_light' ? 'low-light' : currentCaptureStatus.detection_profile === 'low_light_unavailable' ? 'low-light fallback' : 'standard'} analysis` : ''}${currentCaptureStatus.model ? ` · ${currentCaptureStatus.model}` : ''}${currentCaptureStatus.execution_provider ? ` · ${currentCaptureStatus.execution_provider}` : ''}${currentCaptureStatus.evidence_fps != null ? ` · MP4 encoder ${currentCaptureStatus.evidence_fps} FPS` : ''}${currentCaptureStatus.visible_tracks != null ? ` · ${currentCaptureStatus.visible_tracks} tracked object${currentCaptureStatus.visible_tracks === 1 ? '' : 's'} in latest frame${currentCaptureStatus.provisional_visible_tracks ? `, ${currentCaptureStatus.provisional_visible_tracks} provisional` : ''}` : ''}.`}
      </p>}
      {currentCaptureStatus?.supplemental_detail_status && <p className="p-small-note" role="status">
        {currentCaptureStatus.supplemental_detail_status === 'memory_limited'
          ? 'Night detail is paused because less than 2 GB of system RAM is free; the standard low-light detector remains active.'
          : currentCaptureStatus.supplemental_detail_status === 'eligible'
            ? 'Night detail pass is eligible on selected inference updates.'
            : currentCaptureStatus.supplemental_detail_status === 'multiple_sessions'
              ? 'Night detail pass is paused while multiple camera sessions are active.'
              : currentCaptureStatus.supplemental_detail_status === 'cuda_required'
                ? 'Night detail pass requires the CUDA inference engine.'
                : currentCaptureStatus.supplemental_detail_status === 'model_unavailable'
                  ? 'Night detail model is unavailable; the standard detector remains active.'
                  : 'Night detail pass needs a reviewed road zone.'}
      </p>}
      <div className="p-traffic-road-metrics"><div><span>Inbound track crossings · last minute</span><b>{roadCountDisplay(data?.traffic_estimate.track_crossings_last_minute, roadZoneEnabled)}</b></div><div><span>Vehicle footprint in road zone</span><b>{roadZoneRequired ? '—' : data?.traffic_estimate.image_coverage_percent != null ? `${data.traffic_estimate.image_coverage_percent}%` : '—'}</b></div><div><span>Video analysis samples · last minute</span><b>{roadCountDisplay(data?.traffic_estimate.sample_count, roadZoneEnabled)}</b></div>{!roadZoneRequired && estimate?.movement_sample_count != null && <div><span>Samples with measurable track motion</span><b>{estimate.movement_sample_count}</b></div>}</div>
      {data && <p className="p-small-note">{!data.video_continuity
        ? 'Capture continuity is unavailable from the current camera API. Saved detections do not prove uninterrupted video.'
        : data.video_continuity.sample_count === 0
          ? 'Capture continuity · no saved video samples in the last 15 minutes.'
          : describeContinuityCoverage(data.video_continuity)}</p>}
      {data?.video_continuity?.latest_sample_age_seconds != null && data.video_continuity.latest_sample_age_seconds > 5 && <p role="status" className="p-small-note">
        {describeLatestSampleAge(data.video_continuity.latest_sample_age_seconds, liveCaptureIsFresh(currentCaptureStatus))}
      </p>}
      {!!data?.video_continuity?.recent_pauses?.length && <div className="p-small-note" aria-label="Recent analysis gaps">
        <b>Recent analysis gaps · cause unverified</b>
        {data.video_continuity.recent_pauses.slice(-3).reverse().map((pause, index) => <p key={`${pause.from}-${index}`}>
          {new Date(pause.from).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}–{pause.in_progress ? 'now' : new Date(pause.to).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} · {pause.duration_seconds}s · {describeVideoGap(pause, liveCaptureIsFresh(currentCaptureStatus))}
        </p>)}
      </div>}
      {(data?.track_quality || historyTrackQuality)?.brief_track_percent != null && <p className="p-small-note">{(data?.track_quality || historyTrackQuality)!.brief_track_percent}% of counted track IDs with measurable timestamps were observed for under 2 seconds ({(data?.track_quality || historyTrackQuality)!.brief_track_count} of {(data?.track_quality || historyTrackQuality)!.measurable_track_count ?? (data?.track_quality || historyTrackQuality)!.counted_track_count}). {data?.track_quality ? 'This covers the last minute.' : `Fallback sample from the ${historyTrackQuality?.history_event_count || 0} most recent saved track records; it can omit older events when history exceeds 500 records.`} Brief visibility can be real and does not by itself prove a false detection.</p>}
      {data && !data.track_quality && historyTrackQuality?.brief_track_percent == null && <p className="p-small-note">Track-duration summary is unavailable from this camera API version, and the latest saved history contains no eligible counted tracks in the last minute. This does not mean zero brief tracks across the full window.</p>}
      <button className="p-button" onClick={() => { const state = useProduct.getState(); state.setMode('observed'); state.setMapFocus([camera.lat, camera.lng]); state.navigate('/map'); }}>View road on map</button>
      {data?.directional_zone_enabled === false
        ? <p className="p-small-note">Configure this camera’s road polygon and travel direction before using detections for road counts or map estimates. Full-scene detections are not assigned to a road.</p>
        : <p className="p-small-note">Estimated from model box area and tracked movement within the inbound zone over the last minute. This is not calibrated road occupancy or speed. The OSM association is approximate.</p>}
      {estimate?.visibility === 'low_light' && <p className="p-small-note">Limited night visibility: missed vehicles can understate traffic. Sparse detections do not establish a clear road.</p>}
      {estimate?.evidence_quality === 'sparse' && estimate.level === 'moving' && <p className="p-small-note">Vehicle boxes cover a small share of the road zone, but repeated track motion supports moving traffic. The map color does not represent calibrated speed or prove congestion.</p>}
      {estimate?.evidence_quality === 'sparse' && estimate.level === 'unknown' && <p className="p-small-note">Vehicle boxes cover a small share of the road zone, so congestion remains unclassified. An uncolored segment does not mean the road is clear.</p>}
      {estimate?.evidence_quality === 'motion_unavailable' && <p className="p-small-note">Vehicles were visible, but the current tracks did not provide measurable movement. The map leaves congestion unclassified.</p>}
      {estimate?.level === 'unknown' && estimate.evidence_quality !== 'sparse' && <p className="p-small-note">Road conditions are withheld until fresh video analysis is available. No estimate does not mean the road is clear.</p>}
    </Panel>
  </div>;
}

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './roadZoneControls.css';
import { apiUrl } from '../api/urls';
import { canSaveRoadZone, directionDifferenceDegrees, retainRecentRoadRegionSuggestion, suggestObservedDirection, suggestObservedRoadRegion } from './cameraCalibration';

type Point = [number, number];
interface Zone { enabled: boolean; name: string; polygon: Point[]; direction: Point; minimum_motion: number; revision?: number; counting_line_y?: number; counting_line?: [Point, Point] }
interface OutsideCandidate { bbox: [number, number, number, number]; class: string; confidence: number }
interface DirectionalOutsideTrack extends OutsideCandidate { candidate_class?: string | null; observation_hits: number; trail: Point[] }
interface MotionTrack { class: string; trail?: Point[]; bbox?: [number, number, number, number] }

export function RoadZoneEditor({ cameraId, onClose, onSaved, stageElement, frameWidth, frameHeight, motionTracks, outsideCandidateCount, outsideCandidates, directionalOutsideTracks, routeReference }: {
  cameraId: string; onClose: () => void; onSaved?: () => void; stageElement: HTMLDivElement | null;
  frameWidth: number; frameHeight: number; motionTracks: MotionTrack[]; outsideCandidateCount: number; outsideCandidates: OutsideCandidate[];
  directionalOutsideTracks: DirectionalOutsideTrack[]; routeReference?: string;
}) {
  const [zone, setZone] = useState<Zone | null>(null);
  const [mode, setMode] = useState<'polygon' | 'direction' | 'counting-line'>('polygon');
  const [directionPoints, setDirectionPoints] = useState<Point[]>([]);
  const [countingLinePoints, setCountingLinePoints] = useState<Point[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const saveHelpId = useId();
  const directionArrowId = `${saveHelpId}-direction-arrow`;
  const zoneClipId = `${saveHelpId}-road-clip`;
  const drawingSurface = useRef<SVGSVGElement>(null);
  const [keyboardPoint, setKeyboardPoint] = useState<Point>([.5, .5]);
  const [keyboardDrawing, setKeyboardDrawing] = useState(false);
  const [recentRoadRegion, setRecentRoadRegion] = useState<{ cameraId: string; value: NonNullable<ReturnType<typeof retainRecentRoadRegionSuggestion>> } | null>(null);
  const endpoint = apiUrl(`/api/v1/mobility/video/cameras/${encodeURIComponent(cameraId)}/analysis-zone`);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(endpoint, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('Could not load the road zone.');
      return response.json() as Promise<Zone>;
    }).then(value => {
      if (value.revision === 0) setZone({ ...value, polygon: [] });
      else setZone(value);
    }).catch(reason => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, [endpoint]);
  const save = async () => {
    if (!zone) return;
    setSaving(true); setError('');
    try {
      const response = await fetch(endpoint, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(zone), signal: AbortSignal.timeout(10000) });
      const body = await response.json();
      if (!response.ok) throw new Error(typeof body.detail === 'string' ? body.detail : 'Use a non-crossing convex polygon and a valid travel direction.');
      onSaved?.();
      onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save this road zone.'); }
    finally { setSaving(false); }
  };
  const start: Point = directionPoints[0] || [.40, .48];
  const end: Point = directionPoints[1] || [start[0] + (zone?.direction[0] || 0) * .17, start[1] + (zone?.direction[1] || 1) * .17];
  const validDirectionSelection = directionPoints.length === 2 && Math.hypot(directionPoints[1][0] - directionPoints[0][0], directionPoints[1][1] - directionPoints[0][1]) > .03;
  const hasDirection = (zone?.revision ?? 0) > 0 || validDirectionSelection;
  const unfinishedDirection = mode === 'direction' && directionPoints.length > 0 && !validDirectionSelection;
  const unfinishedCountingLine = mode === 'counting-line' && countingLinePoints.length > 0 && (countingLinePoints.length < 2 || Math.hypot(countingLinePoints[1][0] - countingLinePoints[0][0], countingLinePoints[1][1] - countingLinePoints[0][1]) <= .03);
  const observedDirection = zone ? suggestObservedDirection(zone.polygon,
    motionTracks.flatMap(track => track.trail ? [{ class: track.class, trail: track.trail }] : []), frameWidth, frameHeight) : null;
  const currentRoadRegion = useMemo(() => zone?.revision === 0
    ? suggestObservedRoadRegion(motionTracks.flatMap(track => track.trail
      ? [{ class: track.class, trail: track.trail, bbox: track.bbox }] : []), frameWidth, frameHeight)
    : null, [zone?.revision, motionTracks, frameWidth, frameHeight]);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setRecentRoadRegion(previous => {
        const previousValue = previous?.cameraId === cameraId ? previous.value : null;
        const value = retainRecentRoadRegionSuggestion(currentRoadRegion, previousValue, Date.now());
        return value ? { cameraId, value } : null;
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [cameraId, currentRoadRegion]);
  useEffect(() => {
    if (!recentRoadRegion || recentRoadRegion.cameraId !== cameraId) return;
    const { observedAt } = recentRoadRegion.value;
    const timer = window.setTimeout(() => {
      setRecentRoadRegion(current => current?.cameraId === cameraId && current.value.observedAt === observedAt ? null : current);
    }, Math.max(0, observedAt + 8_001 - Date.now()));
    return () => window.clearTimeout(timer);
  }, [cameraId, recentRoadRegion]);
  const observedRoadRegion = recentRoadRegion?.cameraId === cameraId ? recentRoadRegion.value.suggestion : null;
  const savedDirectionDifference = zone && (zone.revision ?? 0) > 0 && observedDirection
    ? directionDifferenceDegrees(zone.direction, observedDirection.direction) : null;
  const previewCandidates = outsideCandidates.filter(candidate => candidate.confidence >= .10).slice(0, 6);
  const previewDirectional = directionalOutsideTracks.slice(0, 6);
  const directionAudit = zone === null
    ? 'Loading the saved road zone and travel direction…'
    : !zone.enabled
    ? 'Road and direction filtering is disabled; no outside-zone direction audit is active.'
    : previewDirectional.length > 0
    ? `${directionalOutsideTracks.length} outside-zone object${directionalOutsideTracks.length === 1 ? '' : 's'} matched the selected travel direction across repeated detections. Their cyan trails are diagnostic only; review the moving video before changing the polygon.`
    : 'No repeated outside-zone object matched the selected travel direction in the latest inference update.';
  const rawEvidence = outsideCandidateCount > 0
    ? `Latest frame: ${outsideCandidateCount} model candidates outside the zone; showing ${previewCandidates.length} at 10%+ confidence${previewCandidates.length ? ` (${previewCandidates.map(candidate => `${candidate.class} ${Math.round(candidate.confidence * 100)}%`).join(', ')})` : ''}. These are provisional, not tracked or counted.`
    : 'No model candidates were outside the zone in the latest inference frame.';
  const previewEvidence = `${directionAudit} ${rawEvidence}`;
  const zoneCanBeSaved = zone && canSaveRoadZone(zone.enabled, zone.polygon.length, zone.revision, validDirectionSelection ? 2 : 0) && !unfinishedDirection && !unfinishedCountingLine;
  const saveGuidance = !zone ? 'Waiting for the road-zone record.'
    : !zone.enabled ? 'Enable the road and direction filter before saving.'
    : zone.polygon.length < 3 ? `Outline the inbound road area: ${zone.polygon.length} points placed; at least 3 are required.`
    : unfinishedDirection ? 'Place two separated points along visible vehicle movement. If the points are too close, choose Set travel direction to start again. The previous direction has not been replaced.'
    : unfinishedCountingLine ? 'Place two separated endpoints across the inbound lanes. If they are too close, choose Draw counting line to start again. The previous counting line has not been replaced.'
    : !hasDirection ? 'Set the travel direction with two points, or review and apply the observed movement suggestion.'
    : 'The required inputs are present. Review the outline, movement and counting line against the video before saving; geometry is checked on submission.';
  const gate: [Point, Point] = zone?.counting_line || [[0, zone?.counting_line_y ?? .64], [1, zone?.counting_line_y ?? .64]];
  const placePoint = (point: Point) => {
    if (!zone) return;
      if (mode === 'polygon') { if (zone.polygon.length < 12) setZone({ ...zone, polygon: [...zone.polygon, point] }); }
      else if (mode === 'direction') {
        const points = directionPoints.length === 1 ? [directionPoints[0], point] : [point];
        setDirectionPoints(points);
        if (points.length === 2) {
          const dx = points[1][0] - points[0][0], dy = points[1][1] - points[0][1], length = Math.hypot(dx, dy);
          if (length > .03) setZone({ ...zone, direction: [dx / length, dy / length] });
        }
      } else {
        const points = countingLinePoints.length === 1 ? [countingLinePoints[0], point] : [point];
        setCountingLinePoints(points);
        if (points.length === 2 && Math.hypot(points[1][0] - points[0][0], points[1][1] - points[0][1]) > .03) {
          setZone({ ...zone, counting_line: [points[0], points[1]] });
        }
      }
  };
  return <div className="p-zone-settings">{stageElement && createPortal(<div className="p-zone-editor">
    <svg ref={drawingSurface} viewBox="0 0 1280 720" preserveAspectRatio="xMidYMid meet" role="group" tabIndex={0} aria-label="Road-zone drawing surface" aria-describedby={`${saveHelpId}-keyboard`} onBlur={() => setKeyboardDrawing(false)} onKeyDown={event => {
      if (event.nativeEvent.isComposing) return;
      const moves: Record<string, Point> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const direction = moves[event.key];
      if (direction) {
        event.preventDefault(); event.stopPropagation(); setKeyboardDrawing(true);
        const step = event.shiftKey ? .05 : .01;
        setKeyboardPoint(point => [Math.max(0, Math.min(1, point[0] + direction[0] * step)), Math.max(0, Math.min(1, point[1] + direction[1] * step))]);
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault(); event.stopPropagation();
        if (event.repeat) return;
        setKeyboardDrawing(true); placePoint(keyboardPoint);
      }
    }} onPointerDown={event => {
      if (!zone) return;
      const box = event.currentTarget.getBoundingClientRect();
      const sourceWidth = frameWidth || 16, sourceHeight = frameHeight || 9;
      const scale = Math.min(box.width / sourceWidth, box.height / sourceHeight);
      const renderedWidth = sourceWidth * scale, renderedHeight = sourceHeight * scale;
      const offsetX = (box.width - renderedWidth) / 2, offsetY = (box.height - renderedHeight) / 2;
      const point: Point = [(event.clientX - box.left - offsetX) / renderedWidth,
        (event.clientY - box.top - offsetY) / renderedHeight];
      if (point[0] < 0 || point[0] > 1 || point[1] < 0 || point[1] > 1) return;
      setKeyboardDrawing(false);
      placePoint(point);
    }}>
      <defs><marker id={directionArrowId} markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#a7c7b3" /></marker>
        <clipPath id={zoneClipId}><polygon points={zone?.polygon.map(([x, y]) => `${x * 1280},${y * 720}`).join(' ')} /></clipPath></defs>
      {zone && <><polygon points={zone.polygon.map(([x, y]) => `${x * 1280},${y * 720}`).join(' ')} fill="#a7c7b30c" stroke="#a7c7b3" strokeWidth="2" strokeDasharray="10 7" vectorEffect="non-scaling-stroke" />
        {zone.polygon.map(([x, y], index) => <circle key={index} cx={x * 1280} cy={y * 720} r="6" fill="#c3d8c9" vectorEffect="non-scaling-stroke" />)}
        <line x1={gate[0][0] * 1280} y1={gate[0][1] * 720} x2={gate[1][0] * 1280} y2={gate[1][1] * 720} stroke="#f1d6a4" strokeWidth="3" strokeDasharray="12 8" clipPath={`url(#${zoneClipId})`} vectorEffect="non-scaling-stroke" />
        {hasDirection && <line x1={start[0] * 1280} y1={start[1] * 720} x2={end[0] * 1280} y2={end[1] * 720} stroke="#a7c7b3" strokeWidth="3" markerEnd={`url(#${directionArrowId})`} vectorEffect="non-scaling-stroke" />}
        {frameWidth > 0 && frameHeight > 0 && previewDirectional.map((track, index) => {
          const [x, y, width, height] = track.bbox;
          const left = x / frameWidth * 1280, top = y / frameHeight * 720;
          const boxWidth = width / frameWidth * 1280, boxHeight = height / frameHeight * 720;
          const label = track.candidate_class ? `${track.candidate_class}?` : track.class;
          const points = track.trail.map(([px, py]) => `${px / frameWidth * 1280},${py / frameHeight * 720}`).join(' ');
          return <g key={`direction-${x}-${y}-${index}`} className="p-zone-direction-audit" pointerEvents="none">
            <title>{`Direction-matched ${label} candidate · ${track.observation_hits} detector updates · not counted`}</title>
            {track.trail.length > 1 && <polyline points={points} fill="none" stroke="#7fe3dc" strokeWidth="3" strokeDasharray="7 5" vectorEffect="non-scaling-stroke" />}
            <rect x={left} y={top} width={boxWidth} height={boxHeight} rx="3" fill="#7fe3dc18" stroke="#7fe3dc" strokeWidth="3" strokeDasharray="7 4" vectorEffect="non-scaling-stroke" />
          </g>;
        })}
        {frameWidth > 0 && frameHeight > 0 && previewCandidates.map((candidate, index) => {
          const [x, y, width, height] = candidate.bbox;
          const left = x / frameWidth * 1280, top = y / frameHeight * 720;
          const boxWidth = width / frameWidth * 1280, boxHeight = height / frameHeight * 720;
          const label = `${candidate.class} ${Math.round(candidate.confidence * 100)}%`;
          const labelX = Math.max(0, Math.min(left, 1270 - label.length * 8));
          const labelY = Math.max(18, top - 5);
          const opacity = candidate.confidence < .20 ? .45 : .85;
          return <g key={`${candidate.class}-${x}-${y}-${index}`} className="p-zone-candidate" pointerEvents="none">
            <title>{`Untracked ${candidate.class} candidate · ${Math.round(candidate.confidence * 100)}% confidence`}</title>
            <rect x={left} y={top} width={boxWidth} height={boxHeight} rx="3" fill="#f2c66d18" fillOpacity={opacity} stroke="#f2c66d" strokeOpacity={opacity} strokeWidth="3" strokeDasharray="8 5" vectorEffect="non-scaling-stroke" />
            <rect x={labelX} y={labelY - 19} width={Math.min(1280 - labelX, label.length * 8 + 10)} height="20" rx="3" fill="#29251b" fillOpacity=".94" />
            <text x={labelX + 5} y={labelY - 5} fill="#ffe3a8" fontSize="14" fontWeight="700" opacity={opacity}>{label}</text>
          </g>;
        })}
      </>}
      {keyboardDrawing && <g pointerEvents="none" aria-hidden="true" className="p-zone-keyboard-cursor"><circle cx={keyboardPoint[0] * 1280} cy={keyboardPoint[1] * 720} r="12" fill="#172124" stroke="#68c7ce" strokeWidth="2" /><path d={`M${keyboardPoint[0] * 1280 - 20},${keyboardPoint[1] * 720}h40 M${keyboardPoint[0] * 1280},${keyboardPoint[1] * 720 - 20}v40`} stroke="#68c7ce" strokeWidth="2" /></g>}
    </svg></div>, stageElement)}
    <div className="p-zone-toolbar"><details className="p-zone-keyboard-guide"><summary>Keyboard drawing controls</summary><p id={`${saveHelpId}-keyboard`} className="p-zone-keyboard-help">Click or tap the video to place points. With the drawing surface focused, use arrow keys to move the cursor, Shift + arrows for larger moves, and Enter or Space to place a point. These controls edit the draft; use Save road zone to submit it.</p><button type="button" onClick={() => { setKeyboardDrawing(true); drawingSurface.current?.focus({ preventScroll: false }); }}>Focus drawing surface</button></details>{keyboardDrawing && <span role="status">Drawing cursor: {Math.round(keyboardPoint[0] * 100)}% across, {Math.round(keyboardPoint[1] * 100)}% down. {mode === 'polygon' ? `${zone?.polygon.length || 0} of 12 outline points placed.` : mode === 'direction' ? `${directionPoints.length} of 2 direction points placed.` : `${countingLinePoints.length} of 2 line endpoints placed.`}</span>}<strong>{mode === 'polygon' ? 'Mark road corners in order' : mode === 'direction' ? 'Click a start point, then a point toward the camera' : 'Click two endpoints across the inbound lanes'}</strong>
      {routeReference && <span>Route metadata reference: {routeReference}. Verify the carriageway and actual vehicle movement in the video before setting the inbound direction.</span>}
      {zone?.revision === 0 && <span>First calibration: draw only the inbound carriageway, then set its direction while vehicles are moving. Counts stay disabled until both steps are complete.</span>}
      {zone?.revision === 0 && <span>{observedDirection
        ? `Observed direction suggestion: ${observedDirection.agreeingTracks} of ${observedDirection.sampledTracks} in-zone tracks agree. Review the arrow against the moving video before saving.`
        : 'A direction suggestion appears after at least three in-zone vehicle tracks show consistent movement. You can always set the direction manually.'}</span>}
      {zone?.revision === 0 && <span>Road-area assistance uses recent tracks moving in a shared direction. It is only a starting outline; verify it against the roadway in the live video before saving.</span>}
      {savedDirectionDifference !== null && <span role="status" className={savedDirectionDifference <= 30 ? 'p-zone-direction-status' : 'p-zone-direction-status p-zone-direction-status--warning'}>
        {savedDirectionDifference <= 30
          ? `Observed movement agrees with the saved direction within ${savedDirectionDifference}° (${observedDirection?.agreeingTracks}/${observedDirection?.sampledTracks} tracks).`
          : `Observed movement differs from the saved direction by ${savedDirectionDifference}° (${observedDirection?.agreeingTracks}/${observedDirection?.sampledTracks} tracks). Review the carriageway before applying; saving a changed direction starts a new analysis revision.`}
      </span>}
      <span>Only this road and travel direction will be counted. Set the gold counting line across the inbound lanes; tracks count only when their observed movement crosses that finite line. Changes start a new analysis revision. Gold boxes show raw outside-zone candidates; cyan trails show temporary direction-matched diagnostic tracks that are never counted. {previewEvidence}</span>
      <div><button onClick={() => { if (zone) setZone({ ...zone, polygon: [] }); setMode('polygon'); }}>Redraw polygon</button>
        <button disabled={!zone?.polygon.length} onClick={() => { if (zone) setZone({ ...zone, polygon: zone.polygon.slice(0, -1) }); }}>Undo polygon point</button>
        {zone?.revision === 0 && <button disabled={!observedRoadRegion} title={observedRoadRegion
          ? `${observedRoadRegion.agreeingTracks} of ${observedRoadRegion.sampledTracks} recent moving tracks support this outline; review it against the video before saving.`
          : 'Wait for at least three vehicle tracks to show a consistent direction.'}
          onClick={() => {
            if (!zone || !observedRoadRegion) return;
            setZone({ ...zone, polygon: observedRoadRegion.polygon });
            setDirectionPoints([]);
            setMode('polygon');
          }}>Use observed road-area outline{observedRoadRegion ? ` · ${observedRoadRegion.agreeingTracks} tracks` : ''}</button>}
        <button disabled={!observedDirection} title={observedDirection
          ? `${observedDirection.agreeingTracks} of ${observedDirection.sampledTracks} in-zone tracks agree`
          : 'Draw the inbound lane and wait for at least three tracks with consistent movement'}
          onClick={() => {
            if (!zone || !observedDirection) return;
            setZone({ ...zone, direction: observedDirection.direction });
            setDirectionPoints([observedDirection.start, observedDirection.end]);
            setMode('direction');
          }}>Use observed movement{observedDirection ? ` · ${observedDirection.agreeingTracks}/${observedDirection.sampledTracks}` : ''}</button>
        <button onClick={() => { setMode('direction'); setDirectionPoints([]); }}>Set travel direction</button>
        <button onClick={() => { setMode('counting-line'); setCountingLinePoints([]); }}>Draw counting line</button>
        {zone?.counting_line && <button onClick={() => setZone({ ...zone, counting_line: undefined })}>Use horizontal line</button>}
        <button aria-describedby={saveHelpId} disabled={!zoneCanBeSaved || saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save road zone'}</button><button onClick={onClose}>Cancel</button></div>
      <p id={saveHelpId} className="p-zone-save-guidance" role="status">{saving ? 'Saving this road-zone revision. Wait for the result before making another change.' : saveGuidance}</p>
      {zone && <label><input type="checkbox" checked={zone.enabled} onChange={event => setZone({ ...zone, enabled: event.target.checked })} /> Enable road and direction filter</label>}
      {zone && !zone.counting_line && <label className="p-zone-line-position">Horizontal counting line · {Math.round((zone.counting_line_y ?? .64) * 100)}% from the top<input aria-label="Counting line position" aria-valuetext={`${Math.round((zone.counting_line_y ?? .64) * 100)} percent from the top of the image`} type="range" min=".3" max=".85" step=".01" value={zone.counting_line_y ?? .64} onChange={event => setZone({ ...zone, counting_line_y: Number(event.target.value) })} /><small>Move the line vertically, or draw an angled line across the inbound lanes.</small></label>}
      {error && <span role="status">{error}</span>}
    </div>
  </div>;
}

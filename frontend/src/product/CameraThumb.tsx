import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useProduct } from './store';
import { Icon } from './ui';
import type { Camera } from './types';
import './cameraPreviewActions.css';

const CompactCameraPlayer = lazy(() => import('./LiveCameraPlayer').then(module => ({ default: module.LiveCameraPlayer })));

// Only one opt-in preview runs at a time; full tracking sessions have their own capacity limit.
const previewEvents = new EventTarget();
let previewOwner = '';

export function CameraThumb({ camera, onClick, showDetailsAction = true }: { camera?: Camera; onClick?: () => void; showDetailsAction?: boolean }) {
  const [playing, setPlaying] = useState(false);
  const token = useRef(crypto.randomUUID());
  const root = useRef<HTMLDivElement>(null);
  const previewTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const changed = () => { if (previewOwner !== token.current || document.visibilityState !== 'visible') setPlaying(false); };
    previewEvents.addEventListener('change', changed);
    document.addEventListener('visibilitychange', changed);
    const observer = new IntersectionObserver(entries => { if (!entries[0]?.isIntersecting) setPlaying(false); });
    if (root.current) observer.observe(root.current);
    return () => {
      observer.disconnect();
      previewEvents.removeEventListener('change', changed);
      document.removeEventListener('visibilitychange', changed);
      if (previewOwner === token.current) previewOwner = '';
    };
  }, []);
  if (!camera) return <div className="p-photo-empty"><Icon name="camera" /><span>No associated video camera</span></div>;
  const providerOutOfService = camera.provider_in_service === false;
  const sourceUnavailable = camera.video_health?.state === 'unavailable';
  const videoUnavailable = providerOutOfService || sourceUnavailable;
  const previewLabel = providerOutOfService ? 'Provider reports out of service' : sourceUnavailable ? 'Video source unavailable' : camera.stream_url ? 'Preview video' : 'Video unavailable';
  const unavailableMessage = providerOutOfService
    ? `${camera.provider || 'The provider'} currently lists this camera as out of service.`
    : camera.video_health?.message;
  return <div className="p-video-preview" ref={root}>
    <div className="p-video-preview-title"><Icon name="camera" size={16} /><span><b>{camera.name}</b><small>{camera.route ? `${camera.route}${camera.direction ? ` · ${camera.direction}bound` : ''}` : camera.district}</small></span></div>
    {playing && camera.stream_url && !videoUnavailable
      ? <Suspense fallback={<div className="p-photo-empty" role="status"><Icon name="camera" /><span>Connecting video preview…</span></div>}><CompactCameraPlayer compact cameraId={camera.id} name={camera.name} /></Suspense>
      : <button ref={previewTrigger} type="button" className="p-video-preview-start" aria-label={`${previewLabel}: ${camera.name}`} onClick={() => { previewOwner = token.current; previewEvents.dispatchEvent(new Event('change')); setPlaying(true); }} disabled={!camera.stream_url || videoUnavailable}><Icon name="play" size={16} /><span>{previewLabel}</span></button>}
    {playing && camera.stream_url && !videoUnavailable && <div className="p-camera-preview-actions"><span>One preview at a time</span><button type="button" aria-label={`Close video preview for ${camera.name}`} onClick={() => { if (previewOwner === token.current) previewOwner = ''; setPlaying(false); requestAnimationFrame(() => previewTrigger.current?.focus({ preventScroll: true })); }}><Icon name="close" size={14} />Close preview</button></div>}
    {videoUnavailable && <p className="p-small-note" role="status">{unavailableMessage || 'The latest video source check reported an unavailable feed.'} Open source details to check whether saved evidence is available.</p>}
    {showDetailsAction && <button className="p-text-button" aria-label={`Open source details for ${camera.name}`} onClick={onClick || (() => useProduct.getState().navigate(`/cameras/${encodeURIComponent(camera.id)}`))}>Open source details <Icon name="arrow" size={14} /></button>}
  </div>;
}

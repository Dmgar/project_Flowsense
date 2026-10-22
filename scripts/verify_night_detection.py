"""Paired night-video diagnosis; prediction continuity is not ground-truth recall."""
import argparse
import json
from pathlib import Path
import time
from datetime import datetime, timezone
from statistics import median
import cv2

from src.core.config import settings
from src.perception.detector import VehicleDetector
from src.perception.traffic_detector import TrafficDetector
from src.perception.road_tracking import RoadTracker, in_road_zone
from src.services.video_service import VideoService, CLASSES, COLORS


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--video', default='output/detection-audit/night-source.mp4')
    parser.add_argument('--output-dir', type=Path,
                        help='New or empty directory for this run; defaults to a timestamped audit folder.')
    args=parser.parse_args()
    audit_root = Path('output/detection-audit')
    if args.output_dir is None:
        stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ')
        root = audit_root / f'night-comparison-{stamp}'
    else:
        root = args.output_dir
    if root.exists() and any(root.iterdir()):
        raise SystemExit(f'Output directory must be empty to preserve earlier evidence: {root}')
    root.mkdir(parents=True, exist_ok=True)
    cap=cv2.VideoCapture(args.video);fps=cap.get(cv2.CAP_PROP_FPS) or 15
    frames=[]
    while True:
        ok,frame=cap.read()
        if not ok: break
        frames.append(frame)
    cap.release()
    if not frames: raise RuntimeError('The diagnostic input must contain actual video frames.')
    zone=json.loads(Path('data/camera_analysis_zones.json').read_text())['caltrans-d7-cctv-1031']
    old_zone={**zone,'polygon':[[.12,.27],[.25,.28],[.98,.63],[.98,.96],[.27,.96]],'revision':1}
    baseline=TrafficDetector(VehicleDetector(str(settings.VIDEO_MODEL_PATH),confidence_threshold=.10,class_names=CLASSES))
    engine=VideoService()
    report={'source':args.video,'frames':len(frames),'sample_interval_seconds':6/fps,
            'scope':'Same-source prediction continuity, not independently labeled precision/recall.',
            'timing_method':'Each inference path is warmed once before frame timings are collected.'}
    for name,infer in [('baseline',lambda f:baseline.detect(f,old_zone)),('low_light',lambda f:engine.infer(f,zone))]:
        tracker=RoadTracker();records=[];best=-1
        profile=old_zone if name=='baseline' else zone
        infer(frames[0])
        for index in range(0,len(frames),6):
            frame=frames[index];start=time.perf_counter();detections=infer(frame);duration=time.perf_counter()-start
            boxes=tracker.update(detections,frame,index/fps,{**profile,'low_light':name=='low_light'})
            eligible=[box for box in boxes if box['track_confidence']>=(.20 if name=='low_light' else .30)]
            records.append({'frame':index,'candidates_in_zone':sum(in_road_zone(d.bbox,frame.shape,profile) for d in detections),
                'strong_in_zone':sum(d.confidence>=.3 and in_road_zone(d.bbox,frame.shape,profile) for d in detections),
                'inbound_tracks':len(boxes),'display_eligible':len(eligible),'seconds':duration,
                'tracks':[{key:box[key] for key in ['id','class','bbox','confidence']} for box in eligible]})
            if len(eligible)>best:
                best=len(eligible);rendered=frame.copy()
                for box in eligible:
                    x,y,w,h=box['bbox'];color=COLORS[box['class']]
                    cv2.rectangle(rendered,(x,y),(x+w,y+h),color,2)
                    cv2.putText(rendered,f"{box['class']} #{box['id']}",(x,max(20,y-5)),0,.6,color,2)
                cv2.imwrite(str(root/f'night-paired-{name}.jpg'),rendered)
        report[name]={'samples':len(records),'strong_in_zone':sum(r['strong_in_zone'] for r in records),
            'inbound_track_observations':sum(r['inbound_tracks'] for r in records),
            'samples_with_display_eligible_tracks':sum(r['display_eligible']>0 for r in records),
            'maximum_display_eligible':best,
            'mean_inference_seconds':sum(r['seconds'] for r in records)/len(records),
            'median_inference_seconds':median(r['seconds'] for r in records), 'records':records}
        print(name,json.dumps({k:v for k,v in report[name].items() if k!='records'}),flush=True)
    (root/'night-paired-report.json').write_text(json.dumps(report,indent=2))


if __name__=='__main__': main()

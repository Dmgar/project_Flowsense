"""Compare two detectors on the same paced video, tracker and compositor."""
import argparse
import asyncio
from fractions import Fraction
import json
from pathlib import Path
import time
import av
import cv2

from src.perception.detector import VehicleDetector
from src.perception.traffic_detector import DetectionBatch,detect_low_light
from src.services.video_service import VideoService,VideoSession,CLASSES,COLORS
from src.services.detection_store import DetectionStore
from src.services.mobility_service import mobility_service


def annotate(frame,metrics):
    for box in metrics.get('detections',[]):
        x,y,w,h=box['bbox'];color=COLORS[box['class']]
        label=f"{box['class'].title() if box['class']!='vehicle' else 'Tracking'} #{box['id']}"
        cv2.rectangle(frame,(x,y),(x+w,y+h),color,2)
        (tw,th),_=cv2.getTextSize(label,0,.55,1)
        y0=max(th+7,y-5);x0=max(0,min(x,frame.shape[1]-tw-8))
        cv2.rectangle(frame,(x0,y0-th-5),(x0+tw+8,y0+4),color,-1)
        cv2.putText(frame,label,(x0+4,y0),0,.55,(20,25,20),1,cv2.LINE_AA)
    return frame


def replay_video(source,destination,records):
    cap=cv2.VideoCapture(str(source));fps=round(cap.get(cv2.CAP_PROP_FPS)) or 15
    index=0;stream=None
    with av.open(str(destination),'w',options={'movflags':'+faststart'}) as output:
        while True:
            ok,frame=cap.read()
            if not ok: break
            index+=1;frame=annotate(frame,records.get(index,{}))
            if stream is None:
                stream=output.add_stream('libx264',rate=fps);stream.width=frame.shape[1];stream.height=frame.shape[0]
                stream.pix_fmt='yuv420p';stream.options={'preset':'fast','crf':'24'}
            video=av.VideoFrame.from_ndarray(frame,format='bgr24');video.pts=index-1;video.time_base=Fraction(1,fps)
            for packet in stream.encode(video):output.mux(packet)
        if stream:
            for packet in stream.encode():output.mux(packet)
    cap.release()


async def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--video',default='output/detection-audit/night-source.mp4')
    parser.add_argument('--output',default='output/detection-audit/continuity-comparison')
    args=parser.parse_args();source=Path(args.video).resolve();root=Path(args.output);root.mkdir(parents=True,exist_ok=True)
    cap=cv2.VideoCapture(str(source));ok,first=cap.read();cap.release()
    if not ok:raise RuntimeError('An actual source video is required.')
    legacy=VehicleDetector('models/yolo11s.onnx',confidence_threshold=.1,class_names=CLASSES)
    camera={**mobility_service.cameras['caltrans-d7-cctv-1031'],'stream_url':str(source),'playback_mode':'recorded'}
    report={'source':str(source),'scope':'Same paced source, current tracker/zone/compositor; changes detector and actual processing cadence. Not ground-truth accuracy.'}
    for name in ['legacy_coco','road_domain']:
        engine=VideoService(DetectionStore(root/name,record_video=False))
        def infer(frame,zone=None):
            if name=='legacy_coco':return DetectionBatch(detect_low_light(legacy,frame),'yolo11s.onnx','low_light')
            return engine.infer(frame,zone)
        infer(first,zone=engine.observation_store.zone(camera['id']))
        session=VideoSession(camera,infer,engine.model_lock,engine.observation_store,zone_aware_inference=True)
        records={};peak=-1;started=time.monotonic()
        try:
            while time.monotonic()-started<40:
                reading=session.status();metrics=reading.get('metrics')
                if metrics:
                    records[metrics['sequence']]=metrics
                    count=sum((metrics['counts'] or {}).values())
                    if count>peak:
                        peak=count
                        with session.lock:
                            if session.output:cv2.imwrite(str(root/f'{name}.png'),session.output[2])
                if reading['state']=='Recorded playback ended':break
                await asyncio.sleep(.02)
            measured=list(records.values())
            report[name]={'sample_count':len(measured),'samples_with_detections':sum(bool(m['detections']) for m in measured),
                'maximum_objects':peak,'output_fps':reading['output_fps'],'inference_fps':reading['inference_fps'],
                'observed_classes':sorted({b['class'] for m in measured for b in m['detections']}),'records':measured}
            print(name,json.dumps({k:v for k,v in report[name].items() if k!='records'}),flush=True)
        finally:await session.close()
        replay_video(source,root/f'{name}.mp4',records)
    (root/'report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')


if __name__=='__main__': asyncio.run(main())

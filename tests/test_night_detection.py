import numpy as np
import cv2
import threading
from types import SimpleNamespace
import pytest

from src.perception.models import Detection
from src.perception.traffic_detector import is_low_light, detect_low_light, reject_headlight_fragments
from src.perception.road_tracking import RoadTracker, FlowAssistedIoU, in_road_zone


def test_dark_scene_detection_is_not_based_on_clock_or_one_bright_headlight():
    dark = np.full((144,256,3),45,np.uint8)
    dark[20:40,10:30] = 255
    assert is_low_light(dark)
    assert not is_low_light(np.full_like(dark,155))
    assert not is_low_light(np.full_like(dark,105))  # Flat overcast scene.


def test_corrected_camera_zone_includes_guardrail_lane_but_excludes_opposing_road():
    import json
    from pathlib import Path
    profile=json.loads(Path('data/camera_analysis_zones.json').read_text())['caltrans-d7-cctv-1031']
    # Actual model box from the supplied night screenshot, previously excluded.
    assert in_road_zone((73,160,28,25),(438,737),profile)
    assert not in_road_zone((500,130,40,25),(438,737),profile)


def test_small_night_vehicle_near_zone_edge_gets_pixel_tolerance_but_other_road_does_not():
    zone = {'enabled': True, 'polygon': [[.1, .1], [.8, .1], [.8, .8], [.1, .8]]}
    assert in_road_zone((35, 300, 12, 8), (400, 400), zone)  # contact is 1 px outside
    assert not in_road_zone((20, 300, 12, 8), (400, 400), zone)  # clearly beyond edge


def test_gamma_view_is_merged_as_one_observation_and_keeps_raw_evidence():
    class Detector:
        confidence_threshold = .1
        def detect(self, frame):
            return [Detection((10,20,40,30),2,'car',.7 if frame.mean()<80 else .4)]
    result = detect_low_light(Detector(),np.full((60,80,3),60,np.uint8))
    assert len(result)==1 and result[0].confidence==.7


def test_bdd_road_detail_crop_is_gamma_lifted_while_broad_crop_stays_original():
    from src.perception.traffic_detector import TrafficDetector

    class Detector:
        confidence_threshold = .1
        def __init__(self): self.means = []
        def detect(self, crop):
            self.means.append(float(crop.mean()))
            return []

    detector = Detector()
    road = TrafficDetector(detector)
    frame = np.full((720, 1280, 3), 35, np.uint8)
    zone = {"enabled": True, "polygon": [[.05,.25],[.25,.25],[.98,.65],[.98,.96],[.18,.96]],
            "direction": [.7,.7], "minimum_motion": .008}

    road.detect(frame, zone, enhance_detail=True)

    assert len(detector.means) == 2
    assert detector.means[0] == 35
    assert detector.means[1] > detector.means[0]


def test_nested_headlight_fragment_does_not_duplicate_a_car_or_erase_its_neighbor():
    car=Detection((100,100,140,70),2,'car',.4)
    fragment=Detection((155,100,50,70),2,'car',.7)
    neighbor=Detection((250,100,90,65),2,'car',.6)
    rider=Detection((155,100,25,60),0,'pedestrian',.8)
    assert reject_headlight_fragments([fragment,car,neighbor,rider])==[car,neighbor,rider]


def test_flow_association_preserves_identity_when_sparse_updates_do_not_overlap():
    tracker = RoadTracker()
    rng = np.random.default_rng(42)
    patch = rng.integers(30,220,(36,44,3),dtype=np.uint8)
    zone = {'enabled':True,'polygon':[[0,0],[1,0],[1,1],[0,1]],'direction':[1,0], 'minimum_motion':.008,'low_light':True}
    ids=[]
    for index in range(5):
        frame=np.zeros((200,360,3),np.uint8)
        x=20+index*48
        frame[70:106,x:x+44]=patch
        boxes=tracker.update([Detection((x,70,44,36),2,'car',.7)],frame,index*.3,zone)
        ids.extend(box['id'] for box in boxes)
    assert ids and len(set(ids))==1
    assert isinstance(tracker.trackers['road'].iou,FlowAssistedIoU)


def test_low_light_features_cannot_create_detections_on_empty_road():
    tracker=RoadTracker()
    frame=np.zeros((200,360,3),np.uint8)
    zone={'enabled':False,'low_light':True}
    tracker.update([Detection((30,70,44,36),2,'car',.8)],frame,0.,zone)
    assert tracker.update([],frame,.3,zone)==[]


def test_weak_night_track_is_visible_after_two_hits_but_never_counted_without_confidence():
    tracker=RoadTracker()
    frame=np.zeros((200,360,3),np.uint8)
    zone={'enabled':True,'polygon':[[0,0],[1,0],[1,1],[0,1]],'direction':[1,0], 'minimum_motion':.008,'low_light':True}
    results=[]
    for index in range(3):
        results.append(tracker.update([Detection((20+index*6,70,44,36),2,'car',.22)],frame,index*.2,zone))
    assert not results[0]
    assert results[1] and results[1][0]['class']=='vehicle'
    assert results[1][0]['candidate_class']=='car'
    assert results[2] and results[2][0]['class']=='car'
    assert all(not result[0]['counted'] for result in results[1:])


def test_repeated_night_candidate_is_visible_as_checking_before_direction_is_confirmed():
    tracker = RoadTracker()
    frame = np.zeros((200, 360, 3), np.uint8)
    zone = {'enabled': True, 'polygon': [[0,0],[1,0],[1,1],[0,1]],
            'direction': [1,0], 'minimum_motion': .02, 'low_light': True}
    first = tracker.update([Detection((100, 70, 44, 36), 2, 'car', .22)], frame, 0., zone)
    second = tracker.update([Detection((100, 80, 44, 36), 2, 'car', .22)], frame, .2, zone)
    assert first == []
    assert second and second[0]['direction_status'] == 'checking'
    assert second[0]['track_age_seconds'] == pytest.approx(.2)
    assert not second[0]['counted']


def test_repeated_low_confidence_night_car_is_visible_but_not_counted():
    tracker = RoadTracker()
    frame = np.zeros((400, 600, 3), np.uint8)
    zone = {'enabled': True, 'polygon': [[0,0],[1,0],[1,1],[0,1]],
            'direction': [0,1], 'minimum_motion': .04, 'low_light': True}
    outputs = [tracker.update([Detection((100, 70 + index * 4, 44, 36), 2, 'car', .11)],
                             frame, index * .2, zone) for index in range(4)]
    assert outputs[:3] == [[], [], []]
    assert outputs[3] and outputs[3][0]['direction_status'] == 'checking'
    assert outputs[3][0]['class'] == 'vehicle'
    assert outputs[3][0]['candidate_class'] == 'car'
    assert outputs[3][0]['counted'] is False


def test_repeated_low_confidence_opposing_night_car_stays_hidden():
    tracker = RoadTracker()
    frame = np.zeros((400, 600, 3), np.uint8)
    zone = {'enabled': True, 'polygon': [[0,0],[1,0],[1,1],[0,1]],
            'direction': [0,1], 'minimum_motion': .02, 'low_light': True}
    results = [tracker.update([Detection((100, 100 - index * 8, 44, 36), 2, 'car', .11)],
                             frame, index * .2, zone) for index in range(3)]
    assert results == [[], [], []]


def test_flow_assistance_does_not_admit_reverse_traffic():
    tracker=RoadTracker()
    patch=np.random.default_rng(9).integers(30,220,(36,44,3),dtype=np.uint8)
    zone={'enabled':True,'polygon':[[0,0],[1,0],[1,1],[0,1]],'direction':[1,0], 'minimum_motion':.008,'low_light':True}
    for index in range(5):
        frame=np.zeros((200,360,3),np.uint8);x=250-index*48
        frame[70:106,x:x+44]=patch
        assert tracker.update([Detection((x,70,44,36),2,'car',.7)],frame,index*.3,zone)==[]


def test_runtime_reports_actual_night_model_and_missing_model_fallback(monkeypatch,tmp_path):
    import src.services.video_service as module
    class Detector:
        def __init__(self,*args,**kwargs): self.confidence_threshold=.1
        def detect(self,frame): return [Detection((10,20,40,30),2,'car',.7)]
    monkeypatch.setattr(module,'VehicleDetector',Detector)
    path=tmp_path/'night.onnx';path.touch()
    monkeypatch.setattr(module.settings,'VIDEO_LOW_LIGHT_MODEL_PATH',path)
    engine=module.VideoService()
    frame=np.full((60,80,3),40,np.uint8)
    night=engine.infer(frame)
    assert night.profile=='low_light' and night.model_name=='night.onnx' and len(night)==1
    path.unlink()
    fallback=engine.infer(frame)
    assert fallback.profile=='low_light_unavailable'
    assert fallback.model_name==module.settings.VIDEO_MODEL_PATH.name


def test_bdd_night_inference_uses_inbound_and_far_road_crops(monkeypatch,tmp_path):
    import src.services.video_service as module
    calls=[]
    class Detector:
        def __init__(self,*args,**kwargs): self.confidence_threshold=.1
        def detect(self,frame):
            calls.append(frame.shape[:2])
            if frame.shape[:2] == (480,480):
                return [Detection((20,30,40,30),2,'car',.65)]
            return []
    monkeypatch.setattr(module,'VehicleDetector',Detector)
    path=tmp_path/'night.onnx';path.touch()
    monkeypatch.setattr(module.settings,'VIDEO_LOW_LIGHT_MODEL_PATH',path)
    monkeypatch.setattr(module.settings,'VIDEO_LOW_LIGHT_PROFILE','bdd100k')
    engine=module.VideoService()
    frame=np.full((720,1280,3),40,np.uint8)
    zone={'enabled':True,'polygon':[[.5,0],[1,0],[1,1],[.5,1]],
          'direction':[1,0],'minimum_motion':.008,'revision':1}

    result=engine.infer(frame,zone)

    assert result.profile=='low_light'
    assert calls==[(720,656),(480,480)]
    assert len(result)==1 and result[0].bbox==(740,30,40,30)


@pytest.mark.parametrize("provider,active_cameras,expected_size", [
    ("CUDAExecutionProvider", 0, 960),
    ("CUDAExecutionProvider", 2, 640),
    ("CPUExecutionProvider", 0, 640),
])
def test_high_resolution_night_model_is_cuda_only_and_single_camera(monkeypatch,tmp_path,provider,active_cameras,expected_size):
    import src.services.video_service as module
    monkeypatch.setattr(module, "available_system_memory_bytes", lambda: 3_000_000_000)
    low=tmp_path/'night-640.onnx';low.touch()
    high=tmp_path/'night-960.onnx';high.touch()
    monkeypatch.setattr(module.settings,'VIDEO_LOW_LIGHT_MODEL_PATH',low)
    monkeypatch.setattr(module.settings,'VIDEO_LOW_LIGHT_HIGH_RES_MODEL_PATH',high)
    monkeypatch.setattr(module.settings,'VIDEO_LOW_LIGHT_PROFILE','bdd100k')
    sizes=[]
    class Detector:
        def __init__(self,path,**kwargs):
            self.model_path=path
            self.input_size=kwargs['input_size']
            self.confidence_threshold=kwargs['confidence_threshold']
            self.execution_provider=provider
            sizes.append(self.input_size)
        def detect(self,frame): return []
    monkeypatch.setattr(module,'VehicleDetector',Detector)
    engine=module.VideoService()
    engine.sessions={str(index):SimpleNamespace(stop_event=threading.Event()) for index in range(active_cameras)}
    zone={'enabled':True,'polygon':[[0,0],[1,0],[1,1],[0,1]],'direction':[1,0],
          'minimum_motion':.008,'counting_line_y':.64,'_high_resolution_detail':True}

    result=engine.infer(np.full((720,1280,3),40,np.uint8),zone)

    assert sizes==([640,960] if expected_size==960 else [640])
    assert result.execution_provider==provider
    expected_model=('night-640.onnx+night-960.onnx' if expected_size==960 else 'night-640.onnx')
    assert result.model_name==expected_model


def test_high_resolution_night_detections_supplement_stable_base_boxes(monkeypatch,tmp_path):
    import src.services.video_service as module
    monkeypatch.setattr(module, "available_system_memory_bytes", lambda: 3_000_000_000)
    low=tmp_path/'night-640.onnx';low.touch()
    high=tmp_path/'night-960.onnx';high.touch()
    monkeypatch.setattr(module.settings,'VIDEO_LOW_LIGHT_MODEL_PATH',low)
    monkeypatch.setattr(module.settings,'VIDEO_LOW_LIGHT_HIGH_RES_MODEL_PATH',high)
    monkeypatch.setattr(module.settings,'VIDEO_LOW_LIGHT_PROFILE','bdd100k')
    class Detector:
        def __init__(self,path,**kwargs):
            self.input_size=kwargs['input_size'];self.model_path=path
            self.confidence_threshold=kwargs['confidence_threshold']
            self.execution_provider='CUDAExecutionProvider'
        def detect(self,frame):
            if frame.shape[:2] != (720,1280): return []
            if self.input_size==640:
                return [Detection((180,140,90,50),2,'car',.42)]
            return [Detection((180,140,90,50),2,'car',.61),
                    Detection((820,310,110,65),4,'bus',.48)]
    monkeypatch.setattr(module,'VehicleDetector',Detector)
    engine=module.VideoService()
    frame=np.full((720,1280,3),40,np.uint8)
    zone={'enabled':True,'polygon':[[0,0],[1,0],[1,1],[0,1]],'direction':[1,0],
          'minimum_motion':.008,'_high_resolution_detail':True}

    result=engine.infer(frame,zone)

    assert [(item.class_name,item.bbox) for item in result]==[
        ('car',(180,140,90,50)),('bus',(820,310,110,65))]
    assert result.model_name=='night-640.onnx+night-960.onnx'
    assert result.execution_provider=='CUDAExecutionProvider'


@pytest.mark.parametrize("provider,active_cameras,detail_enabled,expected_size", [
    ("CUDAExecutionProvider", 1, True, [640, 1280]),
    ("CUDAExecutionProvider", 2, True, [640]),
    ("CPUExecutionProvider", 1, True, [640]),
    ("CUDAExecutionProvider", 1, False, [640]),
])
def test_high_resolution_day_detail_is_cuda_single_camera_and_zone_gated(
        monkeypatch, tmp_path, provider, active_cameras, detail_enabled, expected_size):
    import src.services.video_service as module
    monkeypatch.setattr(module, "available_system_memory_bytes", lambda: 3_000_000_000)
    base = tmp_path / "base.onnx"
    detail = tmp_path / "detail-1280.onnx"
    base.touch(); detail.touch()
    monkeypatch.setattr(module.settings, "VIDEO_MODEL_PATH", base)
    monkeypatch.setattr(module.settings, "VIDEO_HIGH_RES_DETAIL_MODEL_PATH", detail)
    monkeypatch.setattr(module.settings, "VIDEO_LOW_LIGHT_MODEL_PATH", tmp_path / "missing-night.onnx")
    monkeypatch.setattr(module.settings, "PERCEPTION_BACKEND", "onnxruntime")
    sizes = []

    class Detector:
        def __init__(self, path, **kwargs):
            self.model_path = path
            self.input_size = kwargs.get("input_size", 640)
            self.confidence_threshold = kwargs["confidence_threshold"]
            self.execution_provider = provider
            sizes.append(self.input_size)
        def detect(self, frame):
            return []

    monkeypatch.setattr(module, "VehicleDetector", Detector)
    engine = module.VideoService()
    engine.sessions = {str(index): SimpleNamespace(stop_event=threading.Event())
                       for index in range(active_cameras)}
    zone = {"enabled": True, "polygon": [[0,0],[1,0],[1,1],[0,1]],
            "direction": [1,0], "minimum_motion": .008,
            "_high_resolution_detail": detail_enabled}

    result = engine.infer(np.full((720,1280,3), 155, np.uint8), zone)

    assert sizes == expected_size
    assert result.profile == "standard"
    assert result.execution_provider == provider
    expected_name = "base.onnx+detail-1280.onnx" if expected_size == [640, 1280] else "base.onnx"
    assert result.model_name == expected_name


def test_high_resolution_day_detail_adds_small_road_vehicle_without_dropping_base(monkeypatch, tmp_path):
    import src.services.video_service as module
    monkeypatch.setattr(module, "available_system_memory_bytes", lambda: 3_000_000_000)
    base = tmp_path / "base.onnx"
    detail = tmp_path / "detail-1280.onnx"
    base.touch(); detail.touch()
    monkeypatch.setattr(module.settings, "VIDEO_MODEL_PATH", base)
    monkeypatch.setattr(module.settings, "VIDEO_HIGH_RES_DETAIL_MODEL_PATH", detail)
    monkeypatch.setattr(module.settings, "VIDEO_LOW_LIGHT_MODEL_PATH", tmp_path / "missing-night.onnx")
    monkeypatch.setattr(module.settings, "PERCEPTION_BACKEND", "onnxruntime")

    class Detector:
        def __init__(self, path, **kwargs):
            self.model_path = path
            self.input_size = kwargs.get("input_size", 640)
            self.confidence_threshold = kwargs["confidence_threshold"]
            self.execution_provider = "CUDAExecutionProvider"
        def detect(self, frame):
            if self.input_size == 640 and frame.shape[1] > 500:
                return [Detection((300, 260, 90, 50), 2, "car", .48)]
            if self.input_size == 1280 and frame.shape[:2] == (480, 480):
                return [Detection((120, 260, 26, 20), 2, "car", .36)]
            return []

    monkeypatch.setattr(module, "VehicleDetector", Detector)
    engine = module.VideoService()
    zone = {"enabled": True, "polygon": [[0,0],[1,0],[1,1],[0,1]],
            "direction": [1,0], "minimum_motion": .008, "_high_resolution_detail": True}

    result = engine.infer(np.full((720,1280,3), 155, np.uint8), zone)

    boxes = [(item.class_name, item.bbox) for item in result]
    assert boxes.count(("car", (300, 260, 90, 50))) == 1
    assert ("car", (520, 260, 26, 20)) in boxes
    assert result.model_name == "base.onnx+detail-1280.onnx"


def test_high_resolution_day_detail_failure_keeps_base_and_backs_off(monkeypatch, tmp_path):
    import src.services.video_service as module
    monkeypatch.setattr(module, "available_system_memory_bytes", lambda: 3_000_000_000)
    base = tmp_path / "base.onnx"
    detail = tmp_path / "detail-1280.onnx"
    base.touch(); detail.touch()
    monkeypatch.setattr(module.settings, "VIDEO_MODEL_PATH", base)
    monkeypatch.setattr(module.settings, "VIDEO_HIGH_RES_DETAIL_MODEL_PATH", detail)
    monkeypatch.setattr(module.settings, "VIDEO_LOW_LIGHT_MODEL_PATH", tmp_path / "missing-night.onnx")
    monkeypatch.setattr(module.settings, "PERCEPTION_BACKEND", "onnxruntime")
    attempts = []

    class Detector:
        def __init__(self, path, **kwargs):
            self.model_path = path
            self.input_size = kwargs.get("input_size", 640)
            self.confidence_threshold = kwargs["confidence_threshold"]
            self.execution_provider = "CUDAExecutionProvider"
            if self.input_size == 1280:
                attempts.append(path)
                raise RuntimeError("Simulated detail-model allocation failure.")
        def detect(self, frame):
            # Keep the base object in the whole-zone pass only; detail crops
            # may contain other cars and should not fabricate this same box.
            return ([Detection((320, 280, 72, 42), 2, "car", .55)]
                    if self.input_size == 640 and frame.shape[:2] != (480, 480) else [])

    monkeypatch.setattr(module, "VehicleDetector", Detector)
    engine = module.VideoService()
    zone = {"enabled": True, "polygon": [[0,0],[1,0],[1,1],[0,1]],
            "direction": [1,0], "minimum_motion": .008, "_high_resolution_detail": True}
    frame = np.full((720,1280,3), 155, np.uint8)

    expected = engine.infer(frame, {**zone, "_high_resolution_detail": False})
    first = engine.infer(frame, zone)
    second = engine.infer(frame, zone)

    assert len(attempts) == 1
    expected_boxes = [(item.class_name, item.bbox) for item in expected]
    assert [(item.class_name, item.bbox) for item in first] == expected_boxes
    assert [(item.class_name, item.bbox) for item in second] == expected_boxes
    assert first.model_name == second.model_name == "base.onnx"

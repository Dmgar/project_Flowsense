import numpy as np
import pytest
from src.perception.detector import VehicleDetector
from src.perception.models import Detection
from src.perception.road_tracking import ClassConsensus, RoadTracker
from src.api.routes.video import Filters
from src.services.video_service import BDD_CLASSES


def test_bdd_output_uses_its_own_classes_instead_of_coco_ids():
    detector=VehicleDetector.__new__(VehicleDetector)
    detector.num_classes=10
    detector.class_names=BDD_CLASSES
    detector.confidence_threshold=.2
    detector.nms_threshold=.5
    raw=np.zeros((1,14,len(BDD_CLASSES)),np.float32)
    for index,class_id in enumerate(BDD_CLASSES):
        raw[0,:4,index]=[100+index*100,100,80,50]
        raw[0,4+class_id,index]=.9
    detections=detector._postprocess(raw,0,0,1)
    assert {d.class_name for d in detections}==set(BDD_CLASSES.values())
    assert next(d for d in detections if d.class_id==3).class_name=='truck'
    assert next(d for d in detections if d.class_id==4).class_name=='bus'
    assert next(d for d in detections if d.class_id==7).class_name=='bicycle'
    assert next(d for d in detections if d.class_id==1).class_name=='rider'


def test_rider_is_kept_as_its_own_temporal_track_and_can_be_filtered():
    tracker = RoadTracker()
    frame = np.zeros((300, 400, 3), np.uint8)
    profile = {"enabled": False}
    rider = Detection((80, 100, 30, 40), 1, "rider", .82)
    output = []
    for index in range(3):
        output = tracker.update([rider], frame, index / 15, profile)
    assert output and output[-1]["class"] == "rider"
    assert Filters(confidence=.1, classes=["rider"]).classes == ["rider"]


def test_wrong_label_schema_fails_instead_of_mislabeling_objects():
    detector=VehicleDetector.__new__(VehicleDetector)
    detector.num_classes=10
    with pytest.raises(ValueError,match='class count'):
        detector._postprocess(np.zeros((1,84,8400),np.float32),0,0,1)


def test_night_car_requires_three_separated_class_votes():
    classifier=ClassConsensus(low_light=True)
    car=Detection((10,20,40,25),2,'car',.25,{'car':.25,'truck':.03,'bus':.02})
    assert classifier.update(car)=='vehicle'
    assert classifier.update(car)=='vehicle'
    assert classifier.update(car)=='car'


def test_night_ambiguity_is_not_forced_to_car():
    classifier=ClassConsensus(low_light=True)
    for _ in range(8):
        label=classifier.update(Detection((10,20,40,25),2,'car',.25,{'car':.25,'truck':.23,'bus':.02}))
    assert label=='vehicle'


def test_short_model_gap_uses_verified_motion_and_does_not_hold_a_static_ghost():
    from src.services.video_service import aligned_boxes
    rng=np.random.default_rng(7)
    patch=rng.integers(30,220,(40,50),dtype=np.uint8)
    previous=np.zeros((160,240),np.uint8);previous[60:100,30:80]=patch
    current=np.zeros_like(previous);current[60:100,50:100]=patch
    frame=np.zeros((160,240,3),np.uint8)
    box={'id':1,'class':'car','confidence':.6,'bbox':(30,60,50,40),'velocity':(50,0),'observation_hits':4}
    history=[(1,10.,[box],previous,1.,1)]
    result=aligned_boxes(history,(2,10.4,frame,1),current,1.)
    assert result and abs(result[0]['bbox'][0]-50)<=1
    assert aligned_boxes(history,(2,10.4,frame,1),previous,1.)==[]
    assert aligned_boxes(history,(2,10.6,frame,1),current,1.)==[]


def test_larger_input_preserves_letterbox_coordinates():
    frame=np.zeros((720,1280,3),np.uint8)
    blob,pad_x,pad_y,scale,width,height=VehicleDetector._preprocess(frame,input_size=960)
    assert blob.shape==(1,3,960,960)
    assert pad_x==0 and pad_y==210 and scale==.75 and (width,height)==(1280,720)

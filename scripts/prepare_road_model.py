"""Fetch a pinned BDD100K checkpoint and export it without unrestricted pickle loading.

Run in the isolated requirements-model-tools.txt environment. Production uses ONNX.
"""
import argparse
import hashlib
import importlib
import json
from pathlib import Path
import urllib.request

REPOSITORY = 'dronefreak/bdd100k-yolo11n'
REVISION = '2b5554133522f96f50ce87a4df0a2de556e4b7ad'
WEIGHT_SHA256 = 'c120d075bcc6aaf94523f9a2c9d681819ebd692f36eb5ea64656d1c5f1278a70'
EXPECTED_CLASSES = {0:'person',1:'rider',2:'car',3:'truck',4:'bus',5:'train',6:'motor',7:'bike',8:'traffic light',9:'traffic sign'}
ALLOWED_MODULES = {'torch.nn.modules.activation','torch.nn.modules.batchnorm',
    'torch.nn.modules.container','torch.nn.modules.conv','torch.nn.modules.linear',
    'torch.nn.modules.pooling','torch.nn.modules.upsampling','ultralytics.nn.modules.block',
    'ultralytics.nn.modules.conv','ultralytics.nn.modules.head','ultralytics.nn.tasks'}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input-size',type=int,choices=[640,960],default=640)
    args=parser.parse_args()
    import torch
    from ultralytics import YOLO, __version__
    from ultralytics.cfg import DEFAULT_CFG_DICT
    import onnx
    root=Path(__file__).resolve().parents[1]/'models';root.mkdir(exist_ok=True)
    checkpoint_path=root/'bdd-yolo11n.pt'
    url=f'https://huggingface.co/{REPOSITORY}/resolve/{REVISION}/best.pt'
    if not checkpoint_path.exists():
        temporary=checkpoint_path.with_suffix('.download')
        with urllib.request.urlopen(url,timeout=60) as response,temporary.open('wb') as output:
            while chunk:=response.read(1024*1024): output.write(chunk)
        if hashlib.sha256(temporary.read_bytes()).hexdigest()!=WEIGHT_SHA256:
            raise RuntimeError('Downloaded checkpoint checksum mismatch.')
        temporary.replace(checkpoint_path)
    if hashlib.sha256(checkpoint_path.read_bytes()).hexdigest()!=WEIGHT_SHA256:
        raise RuntimeError('Existing checkpoint checksum mismatch; refusing to load it.')
    allowed=[]
    for identifier in torch.serialization.get_unsafe_globals_in_checkpoint(checkpoint_path):
        module,name=identifier.rsplit('.',1)
        if module not in ALLOWED_MODULES:
            raise RuntimeError(f'Unrecognized checkpoint global: {identifier}')
        allowed.append(getattr(importlib.import_module(module),name))
    with torch.serialization.safe_globals(allowed):
        checkpoint=torch.load(checkpoint_path,map_location='cpu',weights_only=True)
    network=(checkpoint.get('ema') or checkpoint['model']).float().eval()
    if network.names!=EXPECTED_CLASSES: raise RuntimeError('Unexpected road-model label schema.')
    network.task='detect'
    name='bdd-yolo11n' if args.input_size==640 else 'bdd-yolo11n-960'
    network.pt_path=str(root/f'{name}.pt')
    network.args={**DEFAULT_CFG_DICT,**getattr(network,'args',{})}
    wrapper=YOLO('yolo11n.yaml');wrapper.model=network;wrapper.task='detect'
    wrapper.ckpt_path=network.pt_path;wrapper.overrides={'model':network.pt_path,'task':'detect'}
    exported=Path(wrapper.export(format='onnx',imgsz=args.input_size,opset=17,simplify=False,dynamic=False,nms=False))
    onnx.checker.check_model(str(exported))
    manifest={'repository':REPOSITORY,'revision':REVISION,'source':f'https://huggingface.co/{REPOSITORY}',
        'checkpoint_sha256':WEIGHT_SHA256,'onnx_sha256':hashlib.sha256(exported.read_bytes()).hexdigest(),
        'input_size':args.input_size,'num_classes':10,'classes':EXPECTED_CLASSES,
        'ultralytics_version':__version__,'runtime':'OpenCV DNN','export_only':'PyTorch restricted weights-only load',
        'upstream_license':'AGPL-3.0; consult upstream model/dataset terms',
        'validation':'Camera-specific prediction continuity; independently labeled precision/recall not measured.'}
    (root/f'{name}.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(manifest,indent=2))


if __name__=='__main__': main()

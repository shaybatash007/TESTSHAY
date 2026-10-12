"""Elena: landmarks for touch regions + blink / speech patches aligned to each outfit's neutral frame.
Usage: python3 prep.py <src dir with the generated stills> <out dir> <face model .task> <pose model .task>"""
import json, sys, numpy as np, mediapipe as mp
from mediapipe.tasks import python as mpt
from mediapipe.tasks.python import vision
from PIL import Image
SRC, OUT, FACE_M, POSE_M = sys.argv[1:5]
W, H = 1024, 1536
OUTFITS = {'black': 'base', 'red': 'o_red', 'white': 'o_white'}
POSES = ['soft', 'wave', 'flex', 'hips', 'lookL', 'lookR']
fl = vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(base_options=mpt.BaseOptions(model_asset_path=FACE_M), num_faces=1))
pl = vision.PoseLandmarker.create_from_options(vision.PoseLandmarkerOptions(base_options=mpt.BaseOptions(model_asset_path=POSE_M)))
def marks(name):
    im = np.asarray(Image.open(f'{SRC}/{name}.jpg').convert('RGB')); mi = mp.Image(image_format=mp.ImageFormat.SRGB, data=im)
    f, p = fl.detect(mi), pl.detect(mi)
    return {'face': [[l.x, l.y] for l in f.face_landmarks[0]] if f.face_landmarks else None,
            'pose': [[round(l.x, 4), round(l.y, 4)] for l in p.pose_landmarks[0]] if p.pose_landmarks else None}
STABLE = [33, 133, 362, 263, 168, 6, 197, 234, 454, 10, 109, 338]
EYES = [33, 133, 159, 145, 362, 263, 386, 374, 70, 300, 105, 334]
MOUTH = [61, 291, 0, 17, 13, 14, 78, 308, 152, 2]
src_marks = {k: marks(k) for k in ['blink', 'talk', 'talk2']}
def patch(src, tgt_face, ids, pad, out):
    T = np.array(tgt_face) * [W, H]; S_ = np.array(src_marks[src]['face']) * [W, H]
    A_ = np.hstack([T[STABLE], np.ones((len(STABLE), 1))]); M, *_ = np.linalg.lstsq(A_, S_[STABLE], rcond=None)   # target -> source
    img = Image.open(f'{SRC}/{src}.jpg').convert('RGB').transform((W, H), Image.AFFINE, (M[0, 0], M[1, 0], M[2, 0], M[0, 1], M[1, 1], M[2, 1]), resample=Image.BICUBIC)
    pts = T[ids]; x0, y0 = (pts.min(0) - pad).astype(int); x1, y1 = (pts.max(0) + pad + 0.5).astype(int)
    crop = img.crop((x0, y0, x1, y1)); w, h = crop.size
    yy, xx = np.mgrid[0:h, 0:w]; r = np.sqrt(((xx - (w - 1) / 2) / (w / 2)) ** 2 + ((yy - (h - 1) / 2) / (h / 2)) ** 2)
    a = np.clip((1 - r) / 0.35, 0, 1) ** 1.5
    Image.fromarray(np.dstack([np.asarray(crop), (a * 255).astype(np.uint8)]), 'RGBA').save(f'{OUT}/{out}.webp', quality=90)
    return [int(x0), int(y0), w, h]
meta = {'size': [W, H], 'outfits': {}}
for o, basefile in OUTFITS.items():
    files = {'base': basefile, **{p: (p if o == 'black' else f'{o}_{p}') for p in POSES}}
    ent = {'regions': {}, 'patches': {}}
    for state, f in files.items():
        Image.open(f'{SRC}/{f}.jpg').convert('RGB').save(f'{OUT}/{o}_{state}.webp', quality=84)
        m = marks(f); ent['regions'][state] = {'face': m['face'] and [[round(v, 4) for v in m['face'][i]] for i in (10, 152, 234, 454)], 'pose': m['pose']}
        if state == 'base':
            ent['patches'] = {'blink': patch('blink', m['face'], EYES, 18, f'{o}_p_blink'), 'talk': patch('talk', m['face'], MOUTH, 22, f'{o}_p_talk'), 'talk2': patch('talk2', m['face'], MOUTH, 22, f'{o}_p_talk2')}
    meta['outfits'][o] = ent; print(o, ent['patches'])
json.dump(meta, open(f'{OUT}/../elena.json', 'w'), separators=(',', ':'))

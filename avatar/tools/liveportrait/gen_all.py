import sys, os, json, time
sys.path.insert(0, '/tmp/claude-0/lp')
import numpy as np, cv2
import lp

OUT = '/tmp/claude-0/lp/frames'; os.makedirs(OUT, exist_ok=True); os.makedirs('/tmp/claude-0/lp/aligned', exist_ok=True)
main = lp.Source('/tmp/claude-0/lp/main.jpg')
STABLE = [33, 133, 362, 263, 6, 1, 234, 454, 10, 168, 70, 300]
def aligned(name):
    p = f'/tmp/claude-0/exps/{name}.jpg'; img = cv2.imread(p); rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    l = lp.landmarks(rgb)
    M, _ = cv2.estimateAffinePartial2D(l[STABLE], main.lmk[STABLE], method=cv2.LMEDS)
    w = cv2.warpAffine(img, M, (img.shape[1], img.shape[0]), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT)
    op = f'/tmp/claude-0/lp/aligned/{name}.jpg'; cv2.imwrite(op, w, [cv2.IMWRITE_JPEG_QUALITY, 97]); return op

EYES = {'o': None, 'h': 0.17, 'c': 0.0}
MOUTHS = ['cl', 'pp', 'a1', 'a2', 'e', 'o', 'u', 'ss']
def spec(src, m):
    d = np.zeros_like(src.exp); lip = None
    if m == 'pp': d[:, 20, 1] = 0.04
    elif m == 'a1': lip = 0.28
    elif m == 'a2': lip = 0.6
    elif m == 'e': lip = 0.18; d[:, 17, 1] = 0.03
    elif m == 'o': lip = 0.25; d[:, 14, 1] = 0.04
    elif m == 'u': lip = 0.12; d[:, 14, 1] = 0.05
    elif m == 'ss': lip = 0.10; d[:, 17, 1] = 0.025
    return lip, d
POSES = {'C': (0, 0), 'L': (0, -12), 'R': (0, 12), 'U': (-7, 0), 'D': (7, 0), 'X': (0, -24), 'Y': (0, 24)}
def run_source(expr, src, jobs):
    d = f'{OUT}/main'; os.makedirs(d, exist_ok=True); t0 = time.time()
    for (p, ey, m) in jobs:
        fp = f'{d}/{p}_{expr}_{ey}_{m}.png'
        if os.path.exists(fp): continue
        lip, dm = spec(src, m); dp, dyaw = POSES[p]
        img = src.frame(dp=dp, dy=dyaw, exp_delta=dm, eye=EYES[ey], lip=lip, crop_only=True)
        cv2.imwrite(fp, cv2.cvtColor(img, cv2.COLOR_RGB2BGR))
    print(expr, len(jobs), round(time.time() - t0), flush=True)

full = [('C', ey, m) for ey in 'och' for m in MOUTHS]
cells = [(p, ey, m) for p in 'LRUD' for ey in 'oc' for m in ['cl', 'a1', 'a2', 'o']] + [(p, ey, 'cl') for p in 'XY' for ey in 'oc']
plan = [('neutral', None, full + cells), ('smile', 'smile', full + cells), ('grin', 'grin', full), ('smirk', 'smirk', full), ('serious', 'serious', full), ('sad', 'sad', full), ('tender', 'tender', full),
        ('laugh', 'laugh', [('C', 'o', 'cl'), ('C', 'c', 'cl'), ('C', 'h', 'cl')]), ('surprised', 'surprised', [('C', 'o', 'cl'), ('C', 'c', 'cl'), ('C', 'h', 'cl')])]
meta = {'size': list(main.rgb.shape[1::-1]), 'M_c2o': main.M_c2o.tolist(), 'lmk': main.lmk.tolist()}
json.dump(meta, open(f'{OUT}/main_meta.json', 'w'))
for expr, edit, jobs in plan:
    src = main if edit is None else lp.Source(aligned(edit), Minv=main.Minv)
    run_source(expr, src, jobs)
print('ALLDONE', flush=True)

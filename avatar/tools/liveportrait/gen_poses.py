import sys, os, json, time
sys.path.insert(0, '/tmp/claude-0/lp')
import numpy as np, cv2
import lp
EYES = {'o': None, 'c': 0.0}
def spec(src, m):
    d = np.zeros_like(src.exp); lip = None
    if m == 'a1': lip = 0.28
    elif m == 'a2': lip = 0.6
    elif m == 'o': lip = 0.25; d[:, 14, 1] = 0.04
    return lip, d
for name in ['flex', 'flexL', 'flexR', 'hips', 'wave']:
    out = f'/tmp/claude-0/lp/frames/{name}'; os.makedirs(out, exist_ok=True)
    src = lp.Source(f'/tmp/claude-0/scn2/{name}.jpg'); t0 = time.time()
    json.dump({'size': list(src.rgb.shape[1::-1]), 'M_c2o': src.M_c2o.tolist(), 'lmk': src.lmk.tolist()}, open(f'{out}/meta.json', 'w'))
    for ey in 'oc':
        for m in ['cl', 'a1', 'a2', 'o']:
            fp = f'{out}/C_{name}_{ey}_{m}.png'
            if os.path.exists(fp): continue
            lip, dm = spec(src, m)
            img = src.frame(exp_delta=dm, eye=EYES[ey], lip=lip, crop_only=True)
            cv2.imwrite(fp, cv2.cvtColor(img, cv2.COLOR_RGB2BGR))
    print(name, round(time.time() - t0), flush=True)
print('POSESDONE', flush=True)

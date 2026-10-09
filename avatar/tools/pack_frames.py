"""Pack LivePortrait face frames into WebP atlases + a manifest the browser renderer reads.

Center sets are stored as DELTAS against the neutral frame (so the photo keeps its full resolution and only the
changed pixels come from the model); head-turn cells are stored as the plain frames.
"""
import json, os, sys, glob, re
import numpy as np, cv2

FR = sys.argv[1]            # frames dir (…/frames)
OUT = sys.argv[2]           # output dir (…/avatar/live)
os.makedirs(OUT + '/atlas', exist_ok=True)
OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109]
EYE = {'L': (33, 133, 159, 145), 'R': (362, 263, 386, 374)}

def o2c_from(meta):
    M = np.vstack([np.array(meta['M_c2o']), [0, 0, 1]]); return np.linalg.inv(M)[:2]
def to_crop(M, pts): return (np.hstack([pts, np.ones((len(pts), 1))]) @ M.T)

def scene_geometry(meta, margin=0.30):
    M = o2c_from(meta); l = np.array(meta['lmk']); c = to_crop(M, l)
    o = c[OVAL]; x0, y0 = o.min(0); x1, y1 = o.max(0); w, h = x1 - x0, y1 - y0
    x0, x1 = max(0, x0 - w * margin), min(512, x1 + w * margin); y0, y1 = max(0, y0 - h * 0.22), min(512, y1 + h * 0.26)
    bbox = [int(x0), int(y0), int(x1 - x0) // 2 * 2, int(y1 - y0) // 2 * 2]
    eyes = {}
    for k, (a, b, t, d) in EYE.items():
        ew = np.linalg.norm(c[a] - c[b]); ctr = (c[a] + c[b]) / 2
        eyes[k] = [float(ctr[0]), float(ctr[1]), float(ew * 0.78), float(ew * 0.55)]
    mouth = ((c[13] + c[14]) / 2).tolist()
    return M, bbox, eyes, mouth, c

def pack(scene, meta, groups, ref_name, mode_of):
    M, bbox, eyes, mouth, c = scene_geometry(meta)
    x0, y0, bw, bh = bbox
    ref = cv2.imread(f'{FR}/{scene}/{ref_name}.png').astype(np.float32)
    atlases = {}
    for gname, files in groups.items():
        mode = mode_of(gname); cols = 6; rows = (len(files) + cols - 1) // cols
        atlas = np.zeros((rows * bh, cols * bw, 3), np.float32) + 128
        cells = {}
        for i, f in enumerate(files):
            im = cv2.imread(f).astype(np.float32)
            if mode == 'delta': tile = np.clip((im - ref)[y0:y0 + bh, x0:x0 + bw] * 0.5 + 128, 0, 255)
            else: tile = im[y0:y0 + bh, x0:x0 + bw]
            r, k = divmod(i, cols); atlas[r * bh:(r + 1) * bh, k * bw:(k + 1) * bw] = tile
            cells[os.path.basename(f)[:-4]] = i
        fn = f'atlas/{scene}_{gname}.webp'
        cv2.imwrite(f'{OUT}/{fn}', atlas.astype(np.uint8), [cv2.IMWRITE_WEBP_QUALITY, 90])
        atlases[gname] = {'file': fn, 'cols': cols, 'rows': rows, 'cw': bw, 'ch': bh, 'mode': mode, 'cells': cells}
        print(scene, gname, len(files), round(os.path.getsize(f'{OUT}/{fn}') / 1024), 'KB')
    return {'o2c': M.tolist(), 'bbox': bbox, 'eyes': eyes, 'mouth': mouth, 'size': meta['size'], 'atlases': atlases,
            'lmk': (np.array(meta['lmk'])).round(1).tolist()}

manifest = {'scenes': {}}
# main scene
meta = json.load(open(f'{FR}/main_meta.json')); allf = sorted(glob.glob(f'{FR}/main/*.png')); groups = {}
for f in allf:
    p, e, ey, m = os.path.basename(f)[:-4].split('_')
    key = f'exp_{e}' if p == 'C' else f'cells_{e}'
    groups.setdefault(key, []).append(f)
manifest['scenes']['main'] = pack('main', meta, groups, 'C_neutral_o_cl', lambda g: 'delta' if g.startswith('exp_') else 'direct')
# pose scenes
for name in ['flex', 'flexL', 'flexR', 'hips', 'wave']:
    if not os.path.exists(f'{FR}/{name}/meta.json'): continue
    meta = json.load(open(f'{FR}/{name}/meta.json')); files = sorted(glob.glob(f'{FR}/{name}/*.png'))
    manifest['scenes'][name] = pack(name, meta, {'face': files}, f'C_{name}_o_cl', lambda g: 'delta')
json.dump(manifest, open(OUT + '/manifest.json', 'w'))
print('manifest ok')

"""Slim + restyle the MPFB (MakeHuman, CC0) avatar into models/avatar.glb.

Usage: python3 tools/make_avatar.py in.glb out.glb
- drops morph targets the app does not use, and morph normals/tangents
- recompresses textures, tints skin/hair, recolours the tee (pink) and trousers (dark)
"""
import io, json, struct, sys
import numpy as np
from PIL import Image, ImageDraw

SRC, DST = sys.argv[1], sys.argv[2]
KEEP = set('''jawOpen mouthClose mouthFunnel mouthPucker mouthSmileLeft mouthSmileRight mouthFrownLeft mouthFrownRight mouthDimpleLeft mouthDimpleRight
mouthPressLeft mouthPressRight mouthShrugLower mouthLowerDownLeft mouthLowerDownRight mouthUpperUpLeft mouthUpperUpRight cheekSquintLeft cheekSquintRight
eyeBlinkLeft eyeBlinkRight eyeSquintLeft eyeSquintRight eyeWideLeft eyeWideRight eyeLookUpLeft eyeLookUpRight eyeLookDownLeft eyeLookDownRight
eyeLookInLeft eyeLookInRight eyeLookOutLeft eyeLookOutRight browDownLeft browDownRight browInnerUp browOuterUpLeft browOuterUpRight
viseme_aa viseme_E viseme_I viseme_O viseme_U viseme_PP viseme_FF viseme_TH viseme_DD viseme_kk viseme_CH viseme_SS viseme_nn viseme_RR'''.split())

raw = open(SRC, 'rb').read()
jl = struct.unpack('<I', raw[12:16])[0]
g = json.loads(raw[20:20 + jl])
bl = struct.unpack('<I', raw[20 + jl:24 + jl])[0]
blob = raw[28 + jl:28 + jl + bl]
CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}

def bv_bytes(i):
    bv = g['bufferViews'][i]; return blob[bv.get('byteOffset', 0):bv.get('byteOffset', 0) + bv['byteLength']]

def read_acc(i):
    a = g['accessors'][i]; dt = CT[a['componentType']]; n = NC[a['type']]
    arr = np.frombuffer(bv_bytes(a['bufferView']), dtype=dt, offset=a.get('byteOffset', 0), count=a['count'] * n).reshape(a['count'], n).copy() if 'bufferView' in a else np.zeros((a['count'], n), dt)
    if 'sparse' in a:
        sp = a['sparse']; ib = g['bufferViews'][sp['indices']['bufferView']]; vb = g['bufferViews'][sp['values']['bufferView']]
        ids = np.frombuffer(blob, dtype=CT[sp['indices']['componentType']], offset=ib.get('byteOffset', 0) + sp['indices'].get('byteOffset', 0), count=sp['count'])
        vals = np.frombuffer(blob, dtype=dt, offset=vb.get('byteOffset', 0) + sp['values'].get('byteOffset', 0), count=sp['count'] * n).reshape(sp['count'], n)
        arr[ids] = vals
    return arr

# ---- 1. prune morph targets (keep only the used names, POSITION only) ----
for m in g['meshes']:
    names = (m.get('extras') or {}).get('targetNames')
    if not names: continue
    keep = [i for i, n in enumerate(names) if n in KEEP]
    for p in m['primitives']:
        p['targets'] = [{'POSITION': p['targets'][i]['POSITION']} for i in keep]
    m['extras']['targetNames'] = [names[i] for i in keep]
    m['weights'] = [0.0] * len(keep)

# ---- 2. textures: tint / recolour ----
def png(i):
    return Image.open(io.BytesIO(bv_bytes(g['images'][i]['bufferView'])))

suit_mesh = next(m for m in g['meshes'] if m['name'] == 'female_casualsuit01')
sp = suit_mesh['primitives'][0]
pos = read_acc(sp['attributes']['POSITION']).astype(np.float32); uv = read_acc(sp['attributes']['TEXCOORD_0']).astype(np.float32)
idx = read_acc(sp['indices']).reshape(-1, 3)
tee_mask = Image.new('L', (1024, 1024), 0); jeans_mask = Image.new('L', (1024, 1024), 0)
dt, dj = ImageDraw.Draw(tee_mask), ImageDraw.Draw(jeans_mask)
for tri in idx:
    y = pos[tri, 1].mean(); poly = [(float(uv[v, 0]) * 1024, float(uv[v, 1]) * 1024) for v in tri]
    (dt if y > 1.0 else dj).polygon(poly, fill=255)

out_img = {}
def jpg(img, size, q=86):
    b = io.BytesIO(); img.convert('RGB').resize((size, size), Image.LANCZOS).save(b, 'JPEG', quality=q, optimize=True); return b.getvalue(), 'image/jpeg'
def pngb(img, size):
    b = io.BytesIO(); img.resize((size, size), Image.LANCZOS).save(b, 'PNG', optimize=True); return b.getvalue(), 'image/png'

# skin (image 0): match Noa's skin tone and project her face photo onto the head
FACE = json.load(open('tools/reference/noa_face.json')); photo = np.asarray(Image.open('tools/reference/noa_face.jpg').convert('RGB')).astype(np.float32) / 255
PH, PW = photo.shape[:2]
def bilinear(img, u, v):
    x = np.clip(u * (img.shape[1] - 1), 0, img.shape[1] - 1.001); y = np.clip(v * (img.shape[0] - 1), 0, img.shape[0] - 1.001)
    x0, y0 = x.astype(int), y.astype(int); fx, fy = (x - x0)[..., None], (y - y0)[..., None]
    return (img[y0, x0] * (1 - fx) * (1 - fy) + img[y0, x0 + 1] * fx * (1 - fy) + img[y0 + 1, x0] * (1 - fx) * fy + img[y0 + 1, x0 + 1] * fx * fy)
base_mesh = next(m for m in g['meshes'] if m['name'] == 'base'); bp = base_mesh['primitives'][0]
bpos = read_acc(bp['attributes']['POSITION']).astype(np.float32); buv = read_acc(bp['attributes']['TEXCOORD_0']).astype(np.float32)
bnor = read_acc(bp['attributes']['NORMAL']).astype(np.float32); bidx = read_acc(bp['indices']).reshape(-1, 3)
tnames = base_mesh['extras']['targetNames']
def corner(name):
    d = read_acc(bp['targets'][tnames.index(name)]['POSITION']).astype(np.float32); i = int(np.argmax(np.linalg.norm(d, axis=1))); return bpos[i]
cL, cR = corner('mouthSmileLeft'), corner('mouthSmileRight')       # her left (+x) / right (-x) mouth corners
bones = {n['name']: n for n in g['nodes'] if 'name' in n}
def world(name):   # node translation chain
    n = bones[name]; p = np.array(n.get('translation', [0, 0, 0]), np.float32)
    parent = next((q for q in g['nodes'] if name_idx(n) in q.get('children', [])), None)
    return p if parent is None else p + world_of(parent)
node_index = {id(n): i for i, n in enumerate(g['nodes'])}
def name_idx(n): return node_index[id(n)]
def world_of(n):
    p = np.array(n.get('translation', [0, 0, 0]), np.float32); sc = np.array(n.get('scale', [1, 1, 1]), np.float32)
    parent = next((q for q in g['nodes'] if name_idx(n) in q.get('children', [])), None)
    return p if parent is None else (p * np.array(parent.get('scale', [1, 1, 1]), np.float32)) + world_of(parent)
eyes_mesh = next(m for m in g['meshes'] if m['name'] == 'high-poly')
ep = read_acc(eyes_mesh['primitives'][0]['attributes']['POSITION']).astype(np.float32)
eyeL_w, eyeR_w = ep[ep[:, 0] > 0].mean(axis=0), ep[ep[:, 0] < 0].mean(axis=0)
print('avatar eyes', eyeL_w, eyeR_w, 'mouth corners', cL, cR)
# least-squares affine from avatar (x,y) -> photo (u,v), using eyes + mouth corners
src = np.array([[eyeL_w[0], eyeL_w[1]], [eyeR_w[0], eyeR_w[1]], [cL[0], cL[1]], [cR[0], cR[1]]], np.float64)
pu = {'iris_L': FACE['iris_L'], 'iris_R': FACE['iris_R'], 'mouthR': FACE['mouthR'], 'mouthL': FACE['mouthL']}
dst = np.array([FACE['iris_L'], FACE['iris_R'], FACE['mouthR'], FACE['mouthL']], np.float64)   # larger-x corner first
A_ = np.hstack([src, np.ones((4, 1))]); M, *_ = np.linalg.lstsq(A_, dst, rcond=None)           # 3x2
vuv = np.hstack([bpos[:, :2], np.ones((len(bpos), 1))]) @ M                                       # photo coords per vertex
# per-vertex blend weight: inside the face ellipse, facing the camera, outside eye openings
cx, cy, rx, ry = 0.0, float(eyeL_w[1] - 0.012), 0.058, 0.098
r = np.sqrt(((bpos[:, 0] - cx) / rx) ** 2 + ((bpos[:, 1] - cy) / ry) ** 2)
w = np.clip((1.0 - r) / 0.28, 0, 1) * np.clip((bnor[:, 2] - 0.35) / 0.4, 0, 1) * (bpos[:, 2] > 0.04)
for k in ('eyeA', 'eyeB'):
    e = FACE[k]; ex, ey = (e['x0'] + e['x1']) / 2, (e['yT'] + e['yB']) / 2; erx, ery = (e['x1'] - e['x0']) * 0.66, max((e['yB'] - e['yT']) * 1.7, 0.016)
    d = np.sqrt(((vuv[:, 0] - ex) / erx) ** 2 + ((vuv[:, 1] - ey) / ery) ** 2); w *= np.clip((d - 0.85) / 0.5, 0, 1)
tex0 = np.asarray(png(0).convert('RGB')).astype(np.float32) / 255; TS = tex0.shape[0]
# rasterise head triangles into the skin texture
head = (bpos[:, 1] > eyeL_w[1] - 0.14)
acc = np.zeros_like(tex0); wsum = np.zeros(tex0.shape[:2], np.float32)
for tri in bidx:
    if not head[tri].all() or w[tri].max() <= 0: continue
    P = buv[tri] * TS; x0, x1 = int(max(P[:, 0].min() - 1, 0)), int(min(P[:, 0].max() + 2, TS)); y0, y1 = int(max(P[:, 1].min() - 1, 0)), int(min(P[:, 1].max() + 2, TS))
    if x1 <= x0 or y1 <= y0: continue
    gx, gy = np.meshgrid(np.arange(x0, x1) + 0.5, np.arange(y0, y1) + 0.5)
    den = (P[1, 1] - P[2, 1]) * (P[0, 0] - P[2, 0]) + (P[2, 0] - P[1, 0]) * (P[0, 1] - P[2, 1])
    if abs(den) < 1e-9: continue
    l0 = ((P[1, 1] - P[2, 1]) * (gx - P[2, 0]) + (P[2, 0] - P[1, 0]) * (gy - P[2, 1])) / den
    l1 = ((P[2, 1] - P[0, 1]) * (gx - P[2, 0]) + (P[0, 0] - P[2, 0]) * (gy - P[2, 1])) / den
    l2 = 1 - l0 - l1; inside = (l0 >= -0.02) & (l1 >= -0.02) & (l2 >= -0.02)
    if not inside.any(): continue
    uu = l0 * vuv[tri[0], 0] + l1 * vuv[tri[1], 0] + l2 * vuv[tri[2], 0]; vv = l0 * vuv[tri[0], 1] + l1 * vuv[tri[1], 1] + l2 * vuv[tri[2], 1]
    ww = (l0 * w[tri[0]] + l1 * w[tri[1]] + l2 * w[tri[2]]) * inside
    col = bilinear(photo, uu, vv)
    acc[y0:y1, x0:x1] += col * ww[..., None]; wsum[y0:y1, x0:x1] += ww
m = np.clip(wsum, 0, 1)[..., None]; proj = acc / np.maximum(wsum, 1e-4)[..., None]
core = (np.clip(wsum, 0, 1) > 0.6)
tex_med = np.median(tex0[core], axis=0); photo_med = np.median(proj[core], axis=0)
factor = np.clip(photo_med / tex_med, 0.4, 1.4); print('tex_med', tex_med, 'photo_med', photo_med, 'factor', factor)
skin = np.clip(tex0 * factor, 0, 1)
skin = skin * (1 - 0.92 * m) + proj * 0.92 * m
# light dilation of the painted area borders is handled by the weight feather above
out_img[0] = jpg(Image.fromarray((np.clip(skin, 0, 1) * 255).astype(np.uint8)), 2048, 90)
g.setdefault('asset', {}).setdefault('extras', {})['noaFace'] = True
body_med = np.median((tex0 * factor).reshape(-1, 3)[::97], axis=0)
g['asset']['extras']['skinColor'] = [round(float(x), 4) for x in body_med]
# suit normal (image 1)
out_img[1] = jpg(png(1), 1024, 90)
# suit diffuse (image 2): tee -> pink, jeans -> dark navy leggings look
d = np.asarray(png(2).convert('RGB').resize((1024, 1024), Image.LANCZOS)).astype(np.float32) / 255
from PIL import ImageFilter
lum = (d * [0.3, 0.59, 0.11]).sum(axis=2)
tm = np.asarray(tee_mask).astype(np.float32) / 255; jm = np.asarray(jeans_mask).astype(np.float32) / 255
def wblur(a, m, r):
    num = np.asarray(Image.fromarray((a * m * 255).clip(0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(r))).astype(np.float32)
    den = np.asarray(Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(r))).astype(np.float32) + 1e-3
    return np.clip(num / den, 0, 1.5)
tlum = wblur(lum, tm, 28)[..., None]; jlum = wblur(lum, jm, 10)[..., None]
tee = np.clip((0.85 * tlum + 0.15 * lum[..., None]) * 1.55 * np.array([1.0, 0.52, 0.70]) + 0.04, 0, 1)
jeans = np.clip((0.4 * jlum + 0.6 * lum[..., None]) * 0.55 * np.array([0.7, 0.75, 1.0]) + 0.02, 0, 1)
tm3, jm3 = tm[..., None], jm[..., None]
d = d * (1 - np.clip(tm3 + jm3, 0, 1)) + tee * tm3 + jeans * jm3
out_img[2] = jpg(Image.fromarray((np.clip(d, 0, 1) * 255).astype(np.uint8)), 1024, 90)
# eyes (3): keep, shrink
e = np.asarray(png(3).convert('RGBA')).astype(np.float32) / 255; e[..., :3] = np.clip(e[..., :3] * np.array([0.78, 0.62, 0.5]), 0, 1)
out_img[3] = pngb(Image.fromarray((e * 255).astype(np.uint8), 'RGBA'), 512)
# ponytail (4): darker brown hair
h = png(4).convert('RGBA'); ha = np.asarray(h).astype(np.float32) / 255
ha[..., :3] = np.clip(ha[..., :3] * np.array([0.42, 0.34, 0.30]), 0, 1)
out_img[4] = pngb(Image.fromarray((ha * 255).astype(np.uint8), 'RGBA'), 1024)
out_img[5] = pngb(png(5).convert('RGBA'), 512)
out_img[6] = jpg(png(6), 512, 88)

# ---- 3. garbage-collect accessors / bufferViews, rebuild buffer ----
used_acc = set()
def use_acc(i): used_acc.add(i)
for m in g['meshes']:
    for p in m['primitives']:
        for v in p['attributes'].values(): use_acc(v)
        if 'indices' in p: use_acc(p['indices'])
        for t in p.get('targets', []):
            for v in t.values(): use_acc(v)
for s in g.get('skins', []):
    if 'inverseBindMatrices' in s: use_acc(s['inverseBindMatrices'])
acc_map = {old: new for new, old in enumerate(sorted(used_acc))}
used_bv = set()
for i in sorted(used_acc):
    a = g['accessors'][i]
    if 'bufferView' in a: used_bv.add(a['bufferView'])
    if 'sparse' in a: used_bv.add(a['sparse']['indices']['bufferView']); used_bv.add(a['sparse']['values']['bufferView'])
bv_map = {}; new_bvs = []; chunks = []; off = 0
def add_chunk(data, extra=None):
    global off
    pad = (-off) % 4; chunks.append(b'\x00' * pad); off += pad
    bv = {'buffer': 0, 'byteOffset': off, 'byteLength': len(data)}
    if extra: bv.update(extra)
    chunks.append(data); off += len(data); new_bvs.append(bv); return len(new_bvs) - 1
for i in sorted(used_bv):
    bv = g['bufferViews'][i]; extra = {k: v for k, v in bv.items() if k in ('byteStride', 'target')}
    bv_map[i] = add_chunk(bv_bytes(i), extra)
img_bv = {}
for i, (data, mime) in out_img.items():
    img_bv[i] = add_chunk(data); g['images'][i]['bufferView'] = img_bv[i]; g['images'][i]['mimeType'] = mime
new_acc = []
for i in sorted(used_acc):
    a = dict(g['accessors'][i])
    if 'bufferView' in a: a['bufferView'] = bv_map[a['bufferView']]
    if 'sparse' in a:
        a['sparse'] = json.loads(json.dumps(a['sparse']))
        a['sparse']['indices']['bufferView'] = bv_map[a['sparse']['indices']['bufferView']]; a['sparse']['values']['bufferView'] = bv_map[a['sparse']['values']['bufferView']]
    new_acc.append(a)
for m in g['meshes']:
    for p in m['primitives']:
        p['attributes'] = {k: acc_map[v] for k, v in p['attributes'].items()}
        if 'indices' in p: p['indices'] = acc_map[p['indices']]
        p['targets'] = [{k: acc_map[v] for k, v in t.items()} for t in p.get('targets', [])]
        if not p['targets']: p.pop('targets')
for s in g.get('skins', []):
    if 'inverseBindMatrices' in s: s['inverseBindMatrices'] = acc_map[s['inverseBindMatrices']]
g['accessors'] = new_acc
for im in g['images']:
    im.pop('uri', None)
# image bufferViews must not carry byteStride/target; every other bufferView is rebuilt above
g['bufferViews'] = new_bvs
binary = b''.join(chunks); binary += b'\x00' * ((-len(binary)) % 4)
g['buffers'] = [{'byteLength': len(binary)}]
# MASK-mode materials need alphaCutoff; keep the glTF defaults
js = json.dumps(g, separators=(',', ':')).encode(); js += b' ' * ((-len(js)) % 4)
glb = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(binary)) + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(binary), 0x004E4942) + binary
open(DST, 'wb').write(glb)
print('wrote', DST, round(len(glb) / 1e6, 2), 'MB; morph kept per mesh:', {m['name']: len((m.get('extras') or {}).get('targetNames', [])) for m in g['meshes']})

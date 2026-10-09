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
    arr = np.frombuffer(bv_bytes(a['bufferView']), dtype=dt, offset=a.get('byteOffset', 0), count=a['count'] * n).reshape(a['count'], n) if 'bufferView' in a else np.zeros((a['count'], n), dt)
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

# skin (image 0): warm tan
skin = np.asarray(png(0).convert('RGB')).astype(np.float32) / 255
skin = np.clip(skin * np.array([0.84, 0.69, 0.55]) * 1.06, 0, 1)
out_img[0] = jpg(Image.fromarray((skin * 255).astype(np.uint8)), 2048, 88)
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
out_img[3] = pngb(png(3).convert('RGBA'), 512)
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

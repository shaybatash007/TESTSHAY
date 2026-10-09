"""Build avatar/live/: atlases + manifest from LivePortrait frames, and the photo scenes (outfits x poses) as WebP."""
import json, os, subprocess, sys, shutil
import cv2
FR, SRC, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
here = os.path.dirname(os.path.abspath(__file__))
subprocess.check_call([sys.executable, '-I', f'{here}/pack_frames.py', FR, OUT])
mf = json.load(open(f'{OUT}/manifest.json'))
NAMES = {'black': 'ספורט שחור', 'gym': 'כושר', 'run': 'ריצה', 'beach': 'חוף', 'tropic': 'טרופי', 'evening': 'ערב', 'casual': 'יומיומי'}
POSES = ['flex', 'flexL', 'flexR', 'hips', 'wave', 'back']
def conv(src, dst):
    if not os.path.exists(src): return False
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    im = cv2.imread(src); cv2.imwrite(dst, im, [cv2.IMWRITE_WEBP_QUALITY, 86]); return True
mf['outfits'] = {}
for oid, name in NAMES.items():
    o = {'name': name, 'poses': {}}
    main_src = f'{SRC}/scn/c.jpg' if oid == 'black' else f'{SRC}/scn3/{oid}.jpg'
    if conv(main_src, f'{OUT}/scenes/{oid}/main.webp'): o['base'] = f'scenes/{oid}/main.webp'
    for p in POSES:
        ps = f'{SRC}/scn2/{p}.jpg' if oid == 'black' else f'{SRC}/scn4/{oid}_{p}.jpg'
        if conv(ps, f'{OUT}/scenes/{oid}/{p}.webp'): o['poses'][p] = f'scenes/{oid}/{p}.webp'
    if 'base' in o: mf['outfits'][oid] = o
json.dump(mf, open(f'{OUT}/manifest.json', 'w'))
tot = sum(os.path.getsize(os.path.join(d, f)) for d, _, fs in os.walk(OUT) for f in fs)
print('outfits', list(mf['outfits']), 'total MB', round(tot / 1e6, 1))

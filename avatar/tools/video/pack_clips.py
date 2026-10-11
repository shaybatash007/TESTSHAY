"""Copy generated clips into live/clips/<outfit>/, add reversed versions of the 'into pose' clips, list them in the manifest."""
import json, os, sys, glob
import imageio.v3 as iio, imageio
SRC, OUT = sys.argv[1], sys.argv[2]           # /tmp/claude-0/ltx/clips  avatar/live
mf = json.load(open(f'{OUT}/manifest.json')); mf['clips'] = {}
def write(frames, path):
    w = imageio.get_writer(path, fps=24, codec='libx264', quality=8, pixelformat='yuv420p', macro_block_size=16, ffmpeg_params=['-movflags', '+faststart'])
    for f in frames: w.append_data(f)
    w.close()
for d in sorted(glob.glob(f'{SRC}/*/')):
    outfit = os.path.basename(d.rstrip('/')); os.makedirs(f'{OUT}/clips/{outfit}', exist_ok=True); lst = {}
    for f in sorted(glob.glob(f'{d}*.mp4')):
        name = os.path.basename(f)[:-4]; fr = iio.imread(f)
        write(fr, f'{OUT}/clips/{outfit}/{name}.mp4'); lst[name] = f'clips/{outfit}/{name}.mp4'
        if name.startswith('to_') or name == 'turn':
            write(fr[::-1], f'{OUT}/clips/{outfit}/{name}_rev.mp4'); lst[name + '_rev'] = f'clips/{outfit}/{name}_rev.mp4'
    mf['clips'][outfit] = lst; print(outfit, sorted(lst))
json.dump(mf, open(f'{OUT}/manifest.json', 'w'))

"""Pack generated clips for one outfit: mp4 (H.264) + webm (VP9), plus reversed copies of the 'into pose' clips for the way back.
Usage: python3 pack.py <src dir with *.mp4> <dst dir, e.g. clips/black> [skip,names]"""
import sys, glob, os
import imageio.v3 as iio, imageio
SRC, DST = sys.argv[1], sys.argv[2]; SKIP = set(sys.argv[3].split(',')) if len(sys.argv) > 3 else set()
os.makedirs(DST, exist_ok=True)
def write(frames, path):
    w = imageio.get_writer(path + '.mp4', fps=24, codec='libx264', quality=8, pixelformat='yuv420p', macro_block_size=16, ffmpeg_params=['-movflags', '+faststart'])
    for f in frames: w.append_data(f)
    w.close()
    w = imageio.get_writer(path + '.webm', fps=24, codec='libvpx-vp9', pixelformat='yuv420p', macro_block_size=16, ffmpeg_params=['-crf', '32', '-b:v', '0', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4'])
    for f in frames: w.append_data(f)
    w.close()
for f in sorted(glob.glob(f'{SRC}/*.mp4')):
    name = os.path.basename(f)[:-4]
    if name in SKIP: continue
    fr = iio.imread(f); write(fr, f'{DST}/{name}')
    if name.startswith('to_'): write(fr[::-1], f'{DST}/{name}_rev')
    print('packed', name)

"""Inline may.json (+ the list of clips that exist) into may.html -> index.html."""
import json, os, glob
meta = json.load(open('may.json'))
meta['clips'] = {o: sorted({os.path.basename(f)[:-4] for f in glob.glob(f'clips/{o}/*.mp4')}) for o in ['red', 'black', 'white'] if os.path.isdir(f'clips/{o}')}
open('index.html', 'w').write(open('may.html').read().replace('__META__', json.dumps(meta, separators=(',', ':'))))
print('clips', meta['clips'])

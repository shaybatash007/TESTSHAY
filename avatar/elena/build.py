"""Inline elena.json (+ the list of clips that exist) into elena.html -> index.html."""
import json, os, glob
meta = json.load(open('elena.json'))
meta['clips'] = {o: sorted({os.path.basename(f)[:-4] for f in glob.glob(f'clips/{o}/*.mp4')}) for o in ['black', 'red', 'white'] if os.path.isdir(f'clips/{o}')}
open('index.html', 'w').write(open('elena.html').read().replace('__META__', json.dumps(meta, separators=(',', ':'))))
print('clips', meta['clips'])

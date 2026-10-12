"""Inline aura.json into aura.html -> index.html (the page the artifact / any static host serves)."""
import json
meta = json.load(open('aura.json'))
html = open('aura.html').read().replace('__META__', json.dumps(meta, separators=(',', ':')))
open('index.html', 'w').write(html); print(len(html))

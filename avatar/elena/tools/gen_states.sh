#!/bin/bash
# Generate every still Elena needs from one base photo (base.jpg in DIR): poses, expressions, blink / speech, outfits, poses per outfit.
# Usage: gen_states.sh DIR   (edits with FLUX.2 [klein] on Workers AI; skips files that already exist)
DIR=$1; cd "$DIR" || exit 1; A=9213747898b0eef6d720f037cb32bee4
KEEP="Keep her identity, face, hair, tattoos, body, skin, camera framing, background and lighting exactly identical"
declare -A E=(
 [wave]="she raises her right hand to shoulder height and waves hello at the camera with an open palm, big smile"
 [flex]="she raises both arms and flexes her biceps in a confident double biceps pose, playful proud smile"
 [hips]="she places both hands on her hips in a confident power pose, slight smirk"
 [soft]="she has a calm gentle closed-mouth smile and looks warmly at the camera"
 [lookL]="she turns her head and looks down toward her own left shoulder with a soft smile"
 [lookR]="she turns her head and looks down toward her own right shoulder with a soft smile")
declare -A F=(
 [blink]="she closes her eyes completely in a natural relaxed blink, everything else unchanged"
 [talk]="her mouth is slightly open as if in the middle of speaking a word, everything else unchanged"
 [talk2]="her lips are rounded and slightly open as if saying 'oo' mid-word, everything else unchanged")
declare -A O=([red]="an opaque red sporty bikini with thin double straps" [white]="an opaque white sporty bikini")
edit(){ # out input prompt
  [ -s "$1.jpg" ] && return
  for t in 1 2 3 4; do
    curl -s -m 200 -X POST https://api.cloudflare.com/client/v4/accounts/$A/ai/run/@cf/black-forest-labs/flux-2-klein-4b -F "prompt=Edit this photo: $3. Photorealistic." -F "input_image_0=@$2" -F "width=1024" -F "height=1536" -o "$1.json"
    python3 -I -c "
import json,base64,sys
try: d=json.load(open('$1.json'))
except Exception: sys.exit(1)
i=d.get('result',{}).get('image')
open('$1.jpg','wb').write(base64.b64decode(i)) if i else sys.exit(1)" && return
    sleep $((t*4))
  done; echo "FAILED $1"
}
for k in "${!E[@]}"; do edit $k base.jpg "${E[$k]}. $KEEP, and her bikini unchanged" & done
for k in "${!F[@]}"; do edit $k base.jpg "${F[$k]}. $KEEP, and her bikini unchanged" & done
for o in "${!O[@]}"; do edit o_$o base.jpg "change only her bikini to ${O[$o]}. $KEEP" & done
wait
for o in "${!O[@]}"; do for k in "${!E[@]}"; do edit ${o}_$k o_$o.jpg "${E[$k]}. $KEEP, and the $o bikini unchanged" & done; done
wait; echo ALLSTILLS

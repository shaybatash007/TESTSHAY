#!/bin/bash
# May (invented character): real motion clips, each pinned to a photo at both ends (first/last-frame conditioning).
S=/tmp/claude-0/may; O=$S/clips; mkdir -p $O; M=$S/base.jpg
D="A muscular athletic woman with long wavy brown hair in a red sporty bikini on a wooden beach boardwalk, golden sunset light, sea behind her. Static camera, realistic, smooth natural motion."
run(){ [ -s $O/$1.mp4 ] && return; LTX_BF16=1 python3 -I /home/user/TESTSHAY/avatar/tools/video/ltx_cpu.py "$2" $O/$1.mp4 "$D $4" 49 512 768 $5 "$3" > $O/$1.log 2>&1; echo "$1 $(grep -a DONE $O/$1.log)"; }
run idle_a $M $M "She stands relaxed facing the camera, breathes calmly, the sea breeze moves her long wavy hair, she blinks and smiles." 3
run to_wave $M $S/wave.jpg "She lifts her right hand and waves hello with a big friendly smile." 5
run to_flex $M $S/flex.jpg "She raises both arms and flexes her biceps in a double biceps pose, confident smile." 11
run to_hips $M $S/hips.jpg "She puts both hands on her hips in a confident power pose." 7
run dance $M $M "She dances playfully in place to music, swaying her hips and shoulders and moving her arms, smiling, then returns to standing." 13
run idle_b $M $M "She stands relaxed, shifts her weight to one leg and back, her long hair swaying in the wind, smiling softly." 23
echo ALLCLIPS

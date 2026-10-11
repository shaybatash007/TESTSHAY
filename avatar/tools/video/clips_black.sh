#!/bin/bash
# Real video clips for the default outfit; each lands exactly on one of the photos (first/last-frame conditioning).
S=/tmp/claude-0; P=$S/scn2; M=$S/scn/c.jpg; O=$S/ltx/clips/black; mkdir -p $O
D="A muscular woman with long dark hair in a black sports top and black leggings, in a grey photo studio. Static camera, realistic, smooth natural motion."
run(){ [ -s $O/$1.mp4 ] && return; LTX_BF16=1 python3 -I /home/user/TESTSHAY/avatar/tools/video/ltx_cpu.py "$2" $O/$1.mp4 "$D $4" 49 512 768 $5 "$3" > $O/$1.log 2>&1; echo "$1 $(grep -a DONE $O/$1.log)"; }
run idle_a $M $M "She stands relaxed facing the camera, breathes calmly, blinks, glances slightly to the side and back, a faint smile." 3
run to_flex $M $P/flex.jpg "She raises both arms and flexes her biceps in a double biceps pose, confident look." 11
run to_wave $M $P/wave.jpg "She lifts her right hand and waves hello with a big friendly smile." 5
run to_hips $M $P/hips.jpg "She puts both hands on her hips in a confident power pose." 7
run turn $M $P/back.jpg "She turns around slowly until her back faces the camera, her long hair swinging." 9
run to_flexL $M $P/flexL.jpg "She raises one arm and flexes her bicep, smiling." 13
run to_flexR $M $P/flexR.jpg "She raises one arm and flexes her bicep, smiling." 17
run laugh $M $M "She laughs joyfully, her shoulders shaking slightly, then calms down and smiles." 21
run idle_b $M $M "She stands relaxed, touches her hair with one hand, smiles softly at the camera and lowers her hand." 23
run wave_loop $P/wave.jpg $P/wave.jpg "She keeps waving her raised hand from side to side, smiling at the camera." 29
echo ALLCLIPS

# ELENA AI – concept

An invented photoreal character (text prompt only, FLUX.2 [klein] 9B on Workers AI; no reference photo) in three swimsuits, with:
real motion clips (LTX-Video, pinned to the stills at both ends; `../tools/video/clips_elena.sh`), touch detection by body region (MediaPipe pose + face per frame),
blink / speech patches aligned to each outfit (`tools/prep.py`), voice in/out and chat. Non-explicit by design.

`elena.html` + `elena.json` + `clips/` → `python3 build.py` → `index.html`.

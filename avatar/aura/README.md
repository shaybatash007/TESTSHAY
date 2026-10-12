# AURA AI – visual concept

A phone-first concept of the AURA screen: a photoreal, fully invented character (generated from a text prompt only, FLUX.2 [klein] on Workers AI) with
touch detection by body region (MediaPipe pose + face landmarks per frame), touch rings, reactions, blinking and speech (mouth / eye patches aligned to the neutral frame),
voice in/out and chat. Non-explicit by design.

- `aura.html` + `aura.json` → `python3 build.py` → `index.html`; images in `img/`.
- This is the look and interaction concept. The live version (real-time body, physics, any movement) is the Unreal / MetaHuman plan; see `../live3d` for the physics mechanics.

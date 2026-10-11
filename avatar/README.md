# Noa – photoreal live avatar

Photographs of one (AI-generated, original) person, animated live in the browser.

- **Photos**: waist-up studio shots made with FLUX.2 [klein] (Cloudflare Workers AI) – 7 outfits × 7 poses (standing, flex, one-arm flex ×2, hands on hips, wave, back view).
- **Face**: animated offline with [LivePortrait](https://github.com/KwaiVGI/LivePortrait) (ONNX, CPU): blinks, 8 mouth shapes (visemes), 9 expressions, head turns. The frames are packed as WebP atlases (`tools/pack_frames.py`) and stored as *differences* from the neutral frame, so the photo keeps its full resolution.
- **Body motion**: real video clips made with LTX-Video (image-to-video, first and last frame pinned to the photos, so every clip starts and ends exactly on a photo). Generated on CPU with `tools/video/ltx_cpu.py` + `clips_black.sh`, packed (mp4 + webm, reversed copies for the way back) with `tools/video/pack_clips.py`. So far only the black outfit has clips; other outfits use the photo crossfade.
- **Runtime** (`app.js`, plain WebGL): picks and cross-fades frames for speech, blinking, expression and gaze. The photo itself is never warped. Touch reacts to the part you touch; commands (type/speak): "תעשי שרירים", "תחייכי", "תסתובבי", "תלבשי בגד ים"…
- **Chat**: `ANTHROPIC_API_KEY=… node server.js` → http://localhost:5190 (without a key: canned replies). Non-explicit by design.

Rebuild the assets: `tools/pack_frames.py` / `tools/build_live.py` (needs the LivePortrait frames; see git history for the generator).
`legacy-3d/` holds the earlier real-time 3D version.

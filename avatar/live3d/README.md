# Noa – free real-time 3D physics demo

A concept demo for the "live, physical, no video clips" direction, built only with free tools (Three.js, CC0 MakeHuman/MPFB body, CC0 Poly Haven HDRI).

- **Character**: fully invented. The face (`tools/ai_face.jpg`) was generated from a text prompt only (no reference photo) and projected onto the MPFB head by `make_avatar.py`.
- **Physics** (`app.js`, "physics" section): every major joint is a damped spring with inertia layered on top of the animation. A touch is a force at a point → torque on the bone you hit and, with falloff, its parents. Drag on the body pulls the grabbed point toward your finger; release and it springs back.
- **Soft tissue**: up to 4 contacts dent the skin / clothes in the vertex shader (cup + bulge ring, deeper the longer you hold, jiggle on release), with matching normals so the light shows it.
- **Motion without clips**: poses, dance, turn, wave etc. are procedural (bone aiming + springs), mixed with the physics.
- Run: `node server.js` → http://localhost:5190 (rebuild the model: `python3 make_avatar.py <mpfb.glb> models/ai.glb`).

The look is game-engine level; the production plan (Unreal MetaHuman + Pixel Streaming) is what brings film-level realism.

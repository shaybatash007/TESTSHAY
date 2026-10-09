# Noa – live 3D avatar

A real-time 3D character (skinned GLB, ARKit blend shapes + visemes) that you can talk to, touch and give commands.

```
cd avatar
ANTHROPIC_API_KEY=sk-ant-... node server.js    # http://localhost:5190
```

- **Touch**: forehead, eyes, nose, cheeks, mouth, chin, hair, neck, shoulders, arms, torso all react differently. Drag the body to spin her.
- **Commands** (type or speak, Hebrew/English): "תעשי שרירים", "תחייכי", "תסתובבי", "תנופפי", "ידיים על המותניים", "תקרצי", …
- **Voice**: lip-sync is generated from the text (Hebrew + English letters to visemes) while the browser reads it aloud.
- **Your own avatar**: tap "טען אווטאר משלך" and pick any GLB with a Mixamo-style skeleton and ARKit + Oculus viseme blend shapes
  (Ready Player Me with `morphTargets=ARKit,Oculus Visemes`, or Avaturn). Create one from a photo and she will look like the photo.
- `models/noa.glb` is built from the CC0 MPFB avatar with `tools/make_avatar.py` (slimmed, recoloured).
- No API key: canned replies. The character is non-explicit by design.

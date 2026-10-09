# Noa – interactive live avatar

An original animated character that follows your finger with her eyes, reacts to taps, holds and drags,
talks (text + voice in/out) and has three personality modes: **soft**, **normal**, **firm**.

```
cd avatar
ANTHROPIC_API_KEY=sk-ant-... node server.js    # http://localhost:5190
```

Without a key the app still runs with canned replies. Open it on your phone via your machine's LAN IP.
Voice uses the browser Web Speech API (Chrome/Safari). The character is non-explicit by design.

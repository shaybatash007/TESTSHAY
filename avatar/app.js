const $ = (s) => document.querySelector(s);
const canvas = $('#avatar'), stage = $('#stage');

// =====================================================================
//  Photoreal avatar: a set of photos of one character (poses), warped
//  live on the GPU.
//  Vertex   -> head tilt / yaw / pitch, breathing, hair sway, shrug,
//              turn-around squash, skin that follows your finger.
//  Fragment -> blink / wink, gaze, brow lift, smile, talking mouth, blush.
// =====================================================================
const VS = `
attribute vec2 aPos; varying vec2 vUv;
uniform float tilt, breath, sway, squash, shrug, yaw, pitch, tpress, neck, ipd;
uniform vec2 headShift, bodyShift, fc, tpos, tvec;
void main(){
  vec2 p = aPos; vUv = p; vec2 q = p;
  float low = smoothstep(0.5, 0.7, p.y);
  q = mix(q, vec2(0.5, 1.0) + (q - vec2(0.5, 1.0)) * (1.0 + breath * 0.008), low);
  float hw = (1.0 - smoothstep(fc.x - 1.6 * ipd, fc.x - 0.9 * ipd, p.x))
           + smoothstep(fc.x + 0.9 * ipd, fc.x + 1.6 * ipd, p.x) * (1.0 - smoothstep(fc.x + 3.0 * ipd, fc.x + 4.2 * ipd, p.x));
  q.x += sway * 0.012 * hw * clamp(p.y - (fc.y - 0.2), 0.0, 1.0);
  vec2 dd = p - tpos; float tw = exp(-dot(dd, dd) / 0.0035);
  q += tvec * tw - dd * tw * tpress * 0.22;
  vec2 d2 = p - fc; float prof = exp(-dot(d2, d2) / (2.0 * pow(1.7 * ipd, 2.0)));
  q.x += yaw * 0.03 * prof; q.y += pitch * 0.025 * prof;
  q.x = fc.x + (q.x - fc.x) * (1.0 - abs(yaw) * 0.03 * prof);
  float hW = 1.0 - smoothstep(neck - 0.05, neck + 0.11, p.y);
  vec2 piv = vec2(fc.x, neck + 0.05), r = q - piv;
  float c = cos(tilt * hW), s = sin(tilt * hW);
  q = piv + vec2(c * r.x - s * r.y, s * r.x + c * r.y) + headShift * hW + bodyShift;
  float sh = smoothstep(neck - 0.02, neck + 0.08, p.y) * (1.0 - smoothstep(neck + 0.22, neck + 0.36, p.y));
  q.y -= shrug * (0.02 * sh + 0.012 * hW);
  q.x = 0.5 + (q.x - 0.5) * squash;
  q = vec2(0.5) + (q - vec2(0.5)) * 1.05;
  gl_Position = vec4(q.x * 2.0 - 1.0, 1.0 - q.y * 2.0, 0.0, 1.0);
}`;
const FS = `
precision mediump float;
varying vec2 vUv; uniform sampler2D tex;
uniform vec2 gaze, EL, ER, MC; uniform float blinkL, blinkR, mouthOpen, smile, brow, blush, fipd, faceOn, alpha;
float ell(vec2 p, vec2 c, vec2 r){ return 1.0 - smoothstep(0.7, 1.0, length((p - c) / r)); }
vec3 lids(vec3 col, vec2 uv, vec2 E, float b, float fs){
  float m = ell(uv, E, vec2(.034, .020) * fs);
  float edge = E.y - 0.018 * fs + b * 0.036 * fs;
  float cover = 1.0 - smoothstep(edge - 0.0015 * fs, edge + 0.0015 * fs, uv.y);
  float line = 1.0 - smoothstep(0.0, 0.0022 * fs, abs(uv.y - edge));
  col = mix(col, texture2D(tex, uv + vec2(0.0, -0.017 * fs)).rgb, m * cover);
  return mix(col, vec3(.10, .05, .04), m * line * step(0.02, b));
}
void main(){
  vec2 uv = vUv, s = uv; vec3 col; bool gap = false; float dx = 0.0, d = 0.0, t = 0.0;
  float fs = fipd / 0.1042;
  if (faceOn > 0.5) {
    float bm = max(ell(uv, EL + vec2(-.004, -.027) * fs, vec2(.05, .022) * fs), ell(uv, ER + vec2(.004, -.027) * fs, vec2(.05, .022) * fs));
    s.y += brow * 0.010 * fs * bm;
    dx = (uv.x - MC.x) / (0.058 * fs);
    s.y += smile * 0.007 * fs * dx * dx * ell(uv, MC, vec2(.075, .05) * fs);
    d = mouthOpen * 0.020 * fs * (1.0 - smoothstep(0.03 * fs, 0.06 * fs, uv.y - MC.y)) * (1.0 - smoothstep(0.5, 1.0, abs(dx)));
    if (uv.y > MC.y) { if (uv.y < MC.y + d) gap = true; else s.y -= d; }
    s -= gaze * vec2(.0045, .0030) * fs * (1.0 - smoothstep(.011 * fs, .017 * fs, length((uv - EL) * vec2(1.0, 1.5))));
    s -= gaze * vec2(.0045, .0030) * fs * (1.0 - smoothstep(.011 * fs, .017 * fs, length((uv - ER) * vec2(1.0, 1.5))));
  }
  col = texture2D(tex, s).rgb;
  if (faceOn > 0.5) {
    if (gap) {
      t = (uv.y - MC.y) / max(d, 0.0001);
      vec3 inside = mix(vec3(.93, .90, .88), vec3(.30, .08, .10), smoothstep(0.55, 1.0, t));
      col = mix(col, inside, 1.0 - smoothstep(0.55, 0.95, abs(dx)));
    }
    float ch = max(ell(uv, EL + vec2(-.02, .05) * fs, vec2(.05, .034) * fs), ell(uv, ER + vec2(.02, .05) * fs, vec2(.05, .034) * fs));
    col = mix(col, col * vec3(1.06, .92, .94) + vec3(.03, .0, .005), blush * ch * 0.7);
    col = lids(col, uv, EL, blinkL, fs);
    col = lids(col, uv, ER, blinkR, fs);
  }
  gl_FragColor = vec4(col, alpha);
}`;

const gl = canvas.getContext('webgl', { antialias: true });
const U = {};
function sh(type, src) { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
const prog = gl.createProgram();
gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
gl.linkProgram(prog); gl.useProgram(prog);
['tilt', 'breath', 'sway', 'squash', 'shrug', 'yaw', 'pitch', 'tpress', 'neck', 'ipd', 'headShift', 'bodyShift', 'fc', 'tpos', 'tvec',
  'fipd', 'gaze', 'EL', 'ER', 'MC', 'blinkL', 'blinkR', 'mouthOpen', 'smile', 'brow', 'blush', 'faceOn', 'alpha']
  .forEach((n) => (U[n] = gl.getUniformLocation(prog, n)));
const N = 48, verts = [], idx = [];
for (let y = 0; y <= N; y++) for (let x = 0; x <= N; x++) verts.push(x / N, y / N);
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const a = y * (N + 1) + x, b = a + 1, c = a + N + 1, d = c + 1; idx.push(a, b, c, b, d, c); }
const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
const loc = gl.getAttribLocation(prog, 'aPos'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

// ---------- poses: image + face landmarks measured with a face-landmark model ----------
const POSES = {
  base:    { f: 'noa.jpg',          EL: [.4786, .2767], ER: [.5828, .2788], MC: [.5251, .3891] },
  flex:    { f: 'poses/flex.jpg',   EL: [.4711, .2564], ER: [.5588, .2558], MC: [.5125, .3501], arms: 1 },
  flexL:   { f: 'poses/flexL.jpg',  EL: [.4847, .2142], ER: [.5615, .2108], MC: [.5248, .2940] },
  flexR:   { f: 'poses/flexR.jpg',  EL: [.4786, .2172], ER: [.5506, .2203], MC: [.5088, .2971] },
  hips:    { f: 'poses/hips.jpg',   EL: [.4754, .1897], ER: [.5437, .1899], MC: [.5083, .2649] },
  laugh:   { f: 'poses/laugh.jpg',  EL: [.4761, .2182], ER: [.5613, .2208], MC: [.5141, .3119] },
  serious: { f: 'poses/serious.jpg', EL: [.4625, .2122], ER: [.5439, .2094], MC: [.5041, .3014] },
  wave:    { f: 'poses/wave.jpg',   EL: [.4872, .2025], ER: [.5559, .2047], MC: [.5163, .2807] },
  back:    { f: 'poses/back.jpg',   back: 1, fc: [.47, .22], ipd: .10, neck: .42 },
};
for (const [name, c] of Object.entries(POSES)) {
  if (!c.back) {
    c.ipd = c.ER[0] - c.EL[0]; c.mx = (c.EL[0] + c.ER[0]) / 2; c.ey = (c.EL[1] + c.ER[1]) / 2;
    c.fc = [c.mx, c.ey + 0.5 * c.ipd]; c.neck = c.ey + 2.62 * c.ipd;
  } else { c.mx = c.fc[0]; c.ey = c.fc[1]; }
  c.face = c.back ? 0 : 1;
  c.tex = gl.createTexture(); c.ready = false;
  const img = new Image();
  img.onload = () => {
    gl.bindTexture(gl.TEXTURE_2D, c.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    c.ready = true;
  };
  img.src = c.f;
}

// ---------- state ----------
const state = { mood: 'neutral', moodUntil: 0, speaking: false, mode: 'normal',
  gaze: { x: 0, y: 0, tx: 0, ty: 0 }, tilt: 0, ttilt: 0, bounce: 0, blink: 0, nextBlink: 1500,
  wink: 0, lastPointer: 0, lastTap: 0, lookUntil: 0, shakeUntil: 0, nodUntil: 0, smileBoost: 0, forceBlink: 0 };
const spring = (k = 0.14, d = 0.78) => ({ x: 0, v: 0, t: 0, k, d, step() { this.v = (this.v + (this.t - this.x) * this.k) * this.d; this.x += this.v; return this.x; } });
const sSmile = spring(0.1, 0.8), sBrow = spring(0.12, 0.8), sOpen = spring(0.35, 0.6), sBlush = spring(0.05, 0.9), sShrug = spring(0.15, 0.7);
const sYaw = spring(0.08, 0.8), sPitch = spring(0.08, 0.8), sTX = spring(0.2, 0.62), sTY = spring(0.2, 0.62), sPress = spring(0.25, 0.7);
const hair = { sway: 0, v: 0, prevTilt: 0, prevBounce: 0 };
const IDLE_MOOD = { soft: 'happy', normal: 'neutral', firm: 'serious' };
const FACE = { neutral: [0.2, 0], happy: [1, 0.3], playful: [0.9, 0.7], surprised: [0, 1.4], serious: [-0.6, -0.8], sad: [-1, 0.5] };
const setMood = (m, ms = 2500) => { state.mood = m; state.moodUntil = performance.now() + ms; };
const now = () => performance.now();

// ---------- view: which pose is on screen, fades and the turn-around ----------
const view = { cur: 'base', prev: null, fade: 1, until: 0, turn: null, squash: 1 };
function show(name, ms = 0) {
  if (name !== view.cur) { view.prev = view.cur; view.cur = name; view.fade = 0; }
  view.until = ms ? now() + ms : 0;
}
function startTurn(to) {
  if (view.turn || view.cur === to) return;
  view.turn = { t0: now(), to, swapped: false };
}

// ---------- actions (what the commands and touches trigger) ----------
const quip = (text, ms = 1500) => {
  if (state.speaking) return;
  bubble.hidden = false; bubble.textContent = text;
  clearTimeout(quip.t); quip.t = setTimeout(() => { if (!state.speaking) bubble.hidden = true; }, ms);
};
const ACT = {
  flex: () => { show('flex', 4200); setMood('playful', 4200); },
  flexL: () => { show('flexL', 3600); setMood('playful', 3600); },
  flexR: () => { show('flexR', 3600); setMood('playful', 3600); },
  smile: () => { show('base'); state.smileBoost = now() + 4500; setMood('happy', 4500); },
  laugh: () => { show('laugh', 3600); setMood('happy', 3600); },
  wave: () => { show('wave', 3400); setMood('happy', 3400); },
  hips: () => { show('hips', 4000); setMood('serious', 4000); },
  serious: () => { show('serious', 4000); setMood('serious', 4000); },
  turn: () => startTurn('back'),
  front: () => { startTurn('base'); },
  wink: () => { state.wink = 1; setMood('playful', 1300); },
  blink: () => { state.forceBlink = 1; },
  surprised: () => setMood('surprised', 2400),
  sad: () => setMood('sad', 3200),
  tilt: () => { state.ttilt = 7; setTimeout(() => (state.ttilt = 0), 2200); setMood('playful', 2200); },
  hair: () => { hair.v += 4; state.shakeUntil = now() + 900; setMood('playful', 1800); },
  shake: () => { state.shakeUntil = now() + 1500; },
  nod: () => { state.nodUntil = now() + 1500; setMood('happy', 1500); },
  lookL: () => { state.gaze.tx = -1.2; state.lookUntil = now() + 2200; },
  lookR: () => { state.gaze.tx = 1.2; state.lookUntil = now() + 2200; },
  lookU: () => { state.gaze.ty = -1.2; state.lookUntil = now() + 2200; },
  lookD: () => { state.gaze.ty = 1.2; state.lookUntil = now() + 2200; },
  lookAtMe: () => { state.gaze.tx = 0; state.gaze.ty = 0; state.lookUntil = now() + 2200; },
};
function act(name) { if (ACT[name]) { ACT[name](); return true; } return false; }

// natural-language commands, Hebrew + English; first match wins
const CMDS = [
  [/תסתובבי חזרה|תחזרי|פני אלי|תסתכלי עלי|תסתכלי אלי|turn back|face me|come back|turn around again/, 'front'],
  [/תסתובבי|סיבוב|תסתובב|turn around|spin|show me your back/, 'turn'],
  [/(שרירים|שריר|תכופפי|פלקס|תפגיני|flex|muscle|bicep).*(ימין|right)|(ימין|right).*(שרירים|שריר|תכופפי|פלקס|flex|muscle|bicep)/, 'flexR'],
  [/(שרירים|שריר|תכופפי|פלקס|תפגיני|flex|muscle|bicep).*(שמאל|left)|(שמאל|left).*(שרירים|שריר|תכופפי|פלקס|flex|muscle|bicep)/, 'flexL'],
  [/שרירים|שריר|תכופפי|פלקס|תפגיני|דו.?ראשי|flex|muscle|bicep/, 'flex'],
  [/תקרצי|קריצה|wink/, 'wink'],
  [/תצחקי|צחוק|laugh/, 'laugh'],
  [/תחייכי|חיוך|תחייך|smile/, 'smile'],
  [/תנופפי|נפנפי|wave/, 'wave'],
  [/מותניים|תעמדי|עמידה|hands on (your )?hips|power pose/, 'hips'],
  [/רצינית|תהיי קשוחה|serious|stern|angry|כועסת/, 'serious'],
  [/תמצמצי|blink/, 'blink'],
  [/תופתעי|הפתעה|surprised|shocked/, 'surprised'],
  [/עצובה|תהיי עצובה|sad/, 'sad'],
  [/תטי ראש|תטי את הראש|tilt/, 'tilt'],
  [/תזיזי שיער|תנערי|תעיפי שיער|hair flip|toss your hair/, 'hair'],
  [/תנענעי ראש|תגידי לא|shake your head/, 'shake'],
  [/תהנהני|תגידי כן|nod/, 'nod'],
  [/תסתכלי (ל?ימינה|ימין)|look right/, 'lookR'],
  [/תסתכלי (ל?שמאלה|שמאל)|look left/, 'lookL'],
  [/תסתכלי (ל?מעלה|למעלה)|look up/, 'lookU'],
  [/תסתכלי (ל?מטה|למטה)|look down/, 'lookD'],
];
function parseCommand(text) {
  const t = text.toLowerCase().replace(/[֑-ׇ"'.,!?]/g, ' ');
  for (const [re, name] of CMDS) if (re.test(t)) return name;
  return null;
}

// ---------- touch: what part of her did you touch? ----------
// Coordinates are in "eye-distance units" around the eye midpoint, so it works on every pose.
function regionOf(p) {
  const c = POSES[view.cur];
  if (c.back) return { r: 'back', sx: 0 };
  const x = (p.x - c.mx) / c.ipd, y = (p.y - c.ey) / c.ipd, ax = Math.abs(x), sx = x < 0 ? -1 : 1;
  if (ax < 1.35 && y > -2.3 && y < 2.0) {
    if (y < -0.55) return { r: 'forehead', sx };
    if (y < 0.3 && ax < 0.95) return { r: 'eyes', sx };
    if (y < 1.0 && ax < 0.4) return { r: 'nose', sx };
    if (y < 1.0) return { r: 'cheek', sx };
    if (y < 1.5) return ax < 0.85 ? { r: 'mouth', sx } : { r: 'cheek', sx };
    return { r: 'chin', sx };
  }
  if (y < -2.3 && ax < 2.2) return { r: 'hair', sx };
  if (ax < 1.1 && y >= 2.0 && y < 3.2) return { r: 'neck', sx };
  if (ax >= 3.0 || (c.arms && ax >= 2.2 && y > -1.5 && y < 3.5)) return { r: 'arm', sx };
  if (ax >= 1.35 && y < 2.9) return { r: 'hair', sx };
  if (y < 4.6 && ax < 3.2) return { r: 'shoulder', sx };
  return { r: 'torso', sx };
}
function react({ r, sx }) {
  state.bounce = 0.6;
  const yawTo = (v) => { sYaw.v += v * 0.12; };
  switch (r) {
    case 'forehead': setMood('surprised', 900); sPitch.v -= 0.5; state.gaze.ty = -1; state.lookUntil = now() + 1200; quip('היי!'); break;
    case 'eyes': state.forceBlink = 1; setMood('playful', 1100); quip('אוי!'); break;
    case 'nose': state.forceBlink = 1; setMood('happy', 1400); sPitch.v -= 0.6; sBlush.t = 0.6; quip('בוּפּ!'); break;
    case 'cheek': setMood('happy', 1800); sBlush.t = 0.9; yawTo(sx * 9); state.gaze.tx = sx * 1.2; state.lookUntil = now() + 1400; break;
    case 'mouth': setMood('playful', 1600); sBlush.t = 0.6; sYaw.v += -sx * 0.4 - 0.2; sPitch.v += 0.4; quip('חחח נו…'); break;
    case 'chin': setMood('happy', 1500); sPitch.v -= 0.6; break;
    case 'hair': hair.v += sx * 4; setMood('playful', 1500); yawTo(sx * 6); break;
    case 'neck': setMood('happy', 1500); sShrug.v += 1.2; sBlush.t = 0.4; quip('מדגדג!'); break;
    case 'shoulder': sShrug.v += 1; setMood('happy', 1400); state.gaze.tx = sx * 1.2; state.lookUntil = now() + 1300; break;
    case 'arm': act(sx < 0 ? 'flexL' : 'flexR'); quip('רוצה לראות?'); break;
    case 'torso': act('flex'); quip('חח, שרירים?'); break;
    case 'back': startTurn('base'); quip('הייי!'); break;
  }
}

// ---------- pointer ----------
function uv(e) {
  const r = canvas.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
  return { x: 0.5 + (x - 0.5) / 1.05, y: 0.5 + (y - 0.5) / 1.05, w: r.width, h: r.height };   // undo the 1.05 zoom
}
const touch = { x: 0.5, y: 0.5, tvx: 0, tvy: 0 };
function aim(e) {
  const p = uv(e), c = POSES[view.cur];
  state.gaze.tx = Math.max(-1.5, Math.min(1.5, (p.x - c.mx) / (c.ipd * 5)));
  state.gaze.ty = Math.max(-1.5, Math.min(1.5, (p.y - c.ey) / (c.ipd * 5)));
  state.lastPointer = now(); state.lookUntil = 0;
}
let down = null, holdTimer = null;
stage.addEventListener('pointermove', (e) => {
  aim(e);
  if (!down) return;
  const p = uv(e);
  touch.x = p.x; touch.y = p.y;
  const dx = (e.clientX - down.cx) / p.w, dy = (e.clientY - down.cy) / p.h;
  sTX.t = Math.max(-0.045, Math.min(0.045, dx * 0.45)); sTY.t = Math.max(-0.045, Math.min(0.045, dy * 0.45));
  if (Math.hypot(e.clientX - down.cx, e.clientY - down.cy) > 14) { clearTimeout(holdTimer); down.moved = true; }
  state.ttilt = Math.max(-1, Math.min(1, (p.x - 0.5) * 2)) * 5;
});
stage.addEventListener('pointerdown', (e) => {
  stage.setPointerCapture(e.pointerId);
  window.DeviceOrientationEvent?.requestPermission?.().catch(() => {});
  const p = uv(e), t = now();
  down = { cx: e.clientX, cy: e.clientY, t, moved: false, reg: regionOf(p), w: p.w };
  touch.x = p.x; touch.y = p.y; sPress.t = 1; sTX.t = 0; sTY.t = 0;
  aim(e);
  navigator.vibrate?.(15);
  if (down.reg.r === 'eyes' && t - state.lastTap < 380) { state.wink = 1; setMood('playful', 1400); quip('😉'); }
  else react(down.reg);
  state.lastTap = t;
  clearTimeout(holdTimer);
  holdTimer = setTimeout(() => { sBlush.t = 1; setMood('happy', 3000); navigator.vibrate?.(30); }, 700);
});
const release = (e) => {
  clearTimeout(holdTimer);
  if (down && e?.clientX != null) {
    const dx = e.clientX - down.cx, dt = now() - down.t;
    // quick horizontal swipe across her body = turn around
    if (Math.abs(dx) > down.w * 0.3 && dt < 600 && !['forehead', 'eyes', 'nose', 'cheek', 'mouth', 'chin'].includes(down.reg.r)) {
      startTurn(view.cur === 'back' ? 'base' : 'back');
    }
  }
  down = null; state.ttilt = 0; sPress.t = 0; sTX.t = 0; sTY.t = 0; sBlush.t = 0;
};
stage.addEventListener('pointerup', release);
stage.addEventListener('pointercancel', () => release());
stage.addEventListener('pointerleave', () => { if (!down && now() > state.lookUntil) { state.gaze.tx = 0; state.gaze.ty = 0; } });
window.addEventListener('deviceorientation', (e) => {
  if (now() - state.lastPointer < 2500 || e.gamma == null) return;
  state.gaze.tx = Math.max(-1, Math.min(1, e.gamma / 30));
  state.gaze.ty = Math.max(-1, Math.min(1, ((e.beta || 45) - 45) / 30));
});

// ---------- render ----------
const lerp = (a, b, k) => a + (b - a) * k;
let last = now();
function pass(name, a, f, P) {
  const c = POSES[name]; if (!c.ready) return;
  gl.bindTexture(gl.TEXTURE_2D, c.tex);
  gl.uniform1f(U.alpha, a);
  gl.uniform1f(U.faceOn, c.face);
  gl.uniform1f(U.ipd, c.ipd); gl.uniform1f(U.fipd, c.ipd); gl.uniform1f(U.neck, c.neck); gl.uniform2f(U.fc, c.fc[0], c.fc[1]);
  if (c.face) { gl.uniform2f(U.EL, c.EL[0], c.EL[1]); gl.uniform2f(U.ER, c.ER[0], c.ER[1]); gl.uniform2f(U.MC, c.MC[0], c.MC[1]); }
  gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_SHORT, 0);
}
function frame(t) {
  requestAnimationFrame(frame);
  if (!POSES.base.ready) return;
  const dt = Math.min(50, t - last); last = t;

  // pose timers + turn-around
  if (view.until && t > view.until) { if (view.cur === 'back') startTurn('base'); else show('base'); }
  view.fade = Math.min(1, view.fade + dt / 220); if (view.fade >= 1) view.prev = null;
  if (view.turn) {
    const k = (t - view.turn.t0) / 950;
    if (k < 0.5) view.squash = 1 - Math.pow(k * 2, 2) * 0.96;
    else {
      if (!view.turn.swapped) { view.turn.swapped = true; view.cur = view.turn.to; view.prev = null; view.fade = 1; view.until = view.cur === 'back' ? t + 7000 : 0; }
      view.squash = 0.04 + (1 - Math.pow(1 - (k - 0.5) * 2, 2)) * 0.96;
    }
    if (k >= 1) { view.turn = null; view.squash = 1; }
  } else view.squash = 1;

  if (t > state.moodUntil) state.mood = state.speaking ? 'happy' : IDLE_MOOD[state.mode];
  if (state.lookUntil && t > state.lookUntil) { state.lookUntil = 0; state.gaze.tx = 0; state.gaze.ty = 0; }
  const g = state.gaze;
  g.x = lerp(g.x, g.tx, 0.12); g.y = lerp(g.y, g.ty, 0.12);
  state.tilt = lerp(state.tilt, state.ttilt + g.x * 2.5, 0.1);
  state.bounce = Math.max(0, state.bounce - dt / 400);
  state.wink = Math.max(0, state.wink - dt / 700);

  const breath = Math.sin(t / 900), swayIdle = Math.sin(t / 2600);
  const hop = Math.sin(state.bounce * Math.PI) * -0.012;
  const surprised = state.mood === 'surprised';

  hair.v += -(state.tilt - hair.prevTilt) * 0.5 - (state.bounce - hair.prevBounce) * 5 - hair.sway * 0.07;
  hair.v *= 0.9; hair.sway += hair.v;
  hair.prevTilt = state.tilt; hair.prevBounce = state.bounce;

  const [sm, br] = FACE[state.mood] || FACE.neutral;
  sSmile.t = t < state.smileBoost ? 1.35 : sm; sBrow.t = br;
  sOpen.t = state.speaking ? Math.max(0, Math.sin(t / 85) + Math.sin(t / 53) * 0.8) * 0.55
    : t < state.smileBoost ? 0.14 : surprised ? 0.7 : state.mood === 'happy' ? 0.12 : 0;
  if (!down && !sBlush.t) sBlush.t = 0;
  sShrug.t = surprised ? 0.6 : 0;
  // head shake / nod
  const shake = t < state.shakeUntil ? Math.sin(t / 90) * 0.9 : 0;
  const nod = t < state.nodUntil ? Math.sin(t / 110) * 0.8 : 0;
  sYaw.t = g.x * 0.5 + shake; sPitch.t = g.y * 0.4 + nod;

  state.nextBlink -= dt;
  if (state.nextBlink < 0) { state.blink = 1; state.nextBlink = 1800 + Math.random() * 3500; }
  if (state.forceBlink) { state.blink = 1; state.forceBlink = 0; }
  state.blink = Math.max(0, state.blink - dt / 150);
  const closeness = Math.sin(state.blink * Math.PI);
  const squint = state.mood === 'serious' ? 0.18 : state.mood === 'happy' ? 0.1 : 0;

  // skin that follows the finger (underdamped spring = jelly wobble on release)
  const tvx = sTX.step(), tvy = sTY.step(), press = sPress.step();

  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0.41, 0.46, 0.5, 1); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.uniform1f(U.tilt, (state.tilt * Math.PI) / 180);
  gl.uniform1f(U.breath, breath + (state.speaking ? 0.4 : 0));
  gl.uniform1f(U.sway, hair.sway + Math.sin(t / 1700) * 0.8);
  gl.uniform1f(U.squash, view.squash);
  gl.uniform1f(U.shrug, sShrug.step());
  gl.uniform1f(U.yaw, sYaw.step()); gl.uniform1f(U.pitch, sPitch.step());
  gl.uniform1f(U.tpress, press); gl.uniform2f(U.tpos, touch.x, touch.y); gl.uniform2f(U.tvec, tvx, tvy);
  gl.uniform2f(U.headShift, g.x * 0.012 + swayIdle * 0.003, g.y * 0.008 + hop + breath * 0.002);
  gl.uniform2f(U.bodyShift, swayIdle * 0.002, 0);
  gl.uniform2f(U.gaze, g.x + Math.sin(t / 2300) * 0.15, g.y + Math.cos(t / 3100) * 0.08);
  gl.uniform1f(U.blinkL, Math.max(closeness, squint));
  gl.uniform1f(U.blinkR, state.wink > 0 ? 1 : Math.max(closeness, squint));
  gl.uniform1f(U.mouthOpen, Math.max(0, sOpen.step()));
  gl.uniform1f(U.smile, sSmile.step()); gl.uniform1f(U.brow, sBrow.step());
  gl.uniform1f(U.blush, Math.max(0, sBlush.step()));
  if (view.prev) pass(view.prev, 1);
  pass(view.cur, view.prev ? view.fade : 1);
}
requestAnimationFrame(frame);

// ---------- modes + quick commands ----------
document.querySelectorAll('.modes button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.modes button').forEach((x) => x.classList.toggle('on', x === b));
  state.mode = b.dataset.mode;
  history.length = 0;
  if (state.mode === 'firm') act('hips'); else if (state.mode === 'normal') act('wave');
  say({ soft: 'היי, אני כאן. בקצב שלך.', normal: 'היי! מה קורה?', firm: 'טוב. מקשיבה. תדבר ברור.' }[state.mode],
    { soft: 'happy', normal: 'playful', firm: 'serious' }[state.mode]);
}));
document.querySelectorAll('.chips button').forEach((b) => b.addEventListener('click', () => {
  const a = b.dataset.act; act(a); navigator.vibrate?.(10);
  addLine('me', b.textContent);
}));

// ---------- chat ----------
const log = $('#log'), bubble = $('#bubble');
const history = [];
function addLine(cls, text) {
  const p = document.createElement('p'); p.className = cls; p.textContent = text;
  log.append(p); log.scrollTop = log.scrollHeight;
}
function say(text, mood = 'neutral') {
  addLine('her', text);
  bubble.hidden = false; bubble.textContent = text;
  setMood(mood, 3500);
  if ($('#voice').checked && 'speechSynthesis' in window) {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = /[֐-׿]/.test(text) ? 'he-IL' : 'en-US';
    u.rate = state.mode === 'firm' ? 1.1 : state.mode === 'soft' ? 0.92 : 1;
    u.pitch = state.mode === 'firm' ? 0.85 : 1.1;
    u.onstart = () => (state.speaking = true);
    u.onend = u.onerror = () => { state.speaking = false; bubble.hidden = true; };
    speechSynthesis.speak(u);
  } else {
    state.speaking = true;
    setTimeout(() => { state.speaking = false; bubble.hidden = true; }, Math.min(6000, text.length * 70));
  }
}
const OFFLINE = {
  soft: ['אני שומעת אותך. ספר לי עוד?', 'זה נשמע חשוב. קח את הזמן.'],
  normal: ['חחח, אהבתי. ועוד?', 'מעניין! מה עוד עובר לך בראש?'],
  firm: ['לא שמעתי תירוץ. תתחיל לזוז.', 'עוד פעם. בלי להתבלבל.'],
};
//ASK-START
async function ask(mode, messages) {
  const r = await fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode, messages }) });
  return r.json();
}
//ASK-END
async function send(text) {
  addLine('me', text);
  history.push({ role: 'user', content: text });
  const cmd = parseCommand(text);
  if (cmd) act(cmd);                                   // instant, no round trip
  setMood('neutral', 600);
  let out;
  try { out = await ask(state.mode, history.map((m, i) => (i === history.length - 1 && cmd ? { ...m, content: `${m.content}\n(The app already performed the action "${cmd}" on screen.)` } : m))); } catch { out = { offline: true }; }
  if (!out || out.offline || out.error) {
    const pool = OFFLINE[state.mode];
    out = { mood: 'playful', reply: cmd ? ({ flex: 'הנה, תראה!', smile: 'כזה?', turn: 'סיבוב!', wave: 'היי!', wink: '😉' }[cmd] || 'בטח!') : pool[Math.floor(Math.random() * pool.length)] };
  }
  if (!cmd && out.act) act(out.act);                   // Claude can decide to move too
  history.push({ role: 'assistant', content: out.reply });
  say(out.reply, out.mood);
}
$('#form').addEventListener('submit', (e) => {
  e.preventDefault();
  const t = $('#text').value.trim(); if (!t) return;
  $('#text').value = ''; send(t);
});

// ---------- voice input ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const mic = $('#mic');
if (!SR) mic.hidden = true;
else {
  const rec = new SR(); rec.lang = 'he-IL';
  rec.onresult = (e) => send(e.results[0][0].transcript);
  rec.onend = () => mic.classList.remove('rec');
  mic.addEventListener('click', () => { speechSynthesis.cancel(); mic.classList.add('rec'); rec.start(); });
}

act('wave');
say('היי, אני נועה. תיגע בי, תגיד "תעשי שרירים", "תחייכי" או "תסתובבי".', 'happy');

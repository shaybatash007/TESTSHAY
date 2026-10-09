const $ = (s) => document.querySelector(s);
const canvas = $('#avatar'), stage = $('#stage');

// =====================================================================
//  Photoreal avatar: one portrait, warped live on the GPU.
//  Vertex shader  -> head tilt/parallax, breathing, hair sway, arm swell.
//  Fragment shader -> blink / wink, gaze, brow lift, smile, talking mouth.
// =====================================================================
const VS = `
attribute vec2 aPos; varying vec2 vUv;
uniform float tilt, breath, sway, flexL, flexR;
uniform vec2 headShift, bodyShift;
void main(){
  vec2 p = aPos; vUv = p; vec2 q = p;
  float low = smoothstep(0.5, 0.7, p.y);
  q = mix(q, vec2(0.5, 1.0) + (q - vec2(0.5, 1.0)) * (1.0 + breath * 0.008), low);
  float fl = (1.0 - smoothstep(0.22, 0.32, p.x)) * smoothstep(0.55, 0.75, p.y);
  float fr = smoothstep(0.78, 0.88, p.x) * smoothstep(0.55, 0.75, p.y);
  q += (q - vec2(0.14, 0.88)) * fl * flexL * 0.05 + (q - vec2(0.88, 0.88)) * fr * flexR * 0.05;
  float hw = (1.0 - smoothstep(0.34, 0.44, p.x)) + smoothstep(0.62, 0.72, p.x) * (1.0 - smoothstep(0.82, 0.95, p.x));
  q.x += sway * 0.012 * hw * clamp(p.y - 0.3, 0.0, 1.0);
  float hW = 1.0 - smoothstep(0.50, 0.66, p.y);
  vec2 piv = vec2(0.53, 0.60), r = q - piv;
  float c = cos(tilt * hW), s = sin(tilt * hW);
  q = piv + vec2(c * r.x - s * r.y, s * r.x + c * r.y) + headShift * hW + bodyShift;
  q = vec2(0.5) + (q - vec2(0.5)) * 1.05;
  gl_Position = vec4(q.x * 2.0 - 1.0, 1.0 - q.y * 2.0, 0.0, 1.0);
}`;
const FS = `
precision mediump float;
varying vec2 vUv; uniform sampler2D tex;
uniform vec2 gaze; uniform float blinkL, blinkR, mouthOpen, smile, brow;
const vec2 EL = vec2(.474, .270), ER = vec2(.586, .273), MC = vec2(.524, .389);
float ell(vec2 p, vec2 c, vec2 r){ return 1.0 - smoothstep(0.7, 1.0, length((p - c) / r)); }
vec3 lidSkin(vec2 uv){ return texture2D(tex, uv + vec2(0.0, -0.017)).rgb; }
vec3 lids(vec3 col, vec2 uv, vec2 E, float b){
  float m = ell(uv, E, vec2(.034, .020));
  float edge = E.y - 0.018 + b * 0.036;
  float cover = 1.0 - smoothstep(edge - 0.0015, edge + 0.0015, uv.y);
  float line = 1.0 - smoothstep(0.0, 0.0022, abs(uv.y - edge));
  col = mix(col, lidSkin(uv), m * cover);
  return mix(col, vec3(.10, .05, .04), m * line * step(0.02, b));
}
void main(){
  vec2 uv = vUv, s = uv;
  float bm = max(ell(uv, EL + vec2(-.004, -.027), vec2(.05, .022)), ell(uv, ER + vec2(.004, -.027), vec2(.05, .022)));
  s.y += brow * 0.010 * bm;
  float dx = (uv.x - MC.x) / 0.058;
  s.y += smile * 0.007 * dx * dx * ell(uv, MC, vec2(.075, .05));
  float d = mouthOpen * 0.020 * (1.0 - smoothstep(0.03, 0.06, uv.y - MC.y)) * (1.0 - smoothstep(0.5, 1.0, abs(dx)));
  bool gap = false;
  if (uv.y > MC.y) { if (uv.y < MC.y + d) gap = true; else s.y -= d; }
  s -= gaze * vec2(.0045, .0030) * (1.0 - smoothstep(.011, .017, length((uv - EL) * vec2(1.0, 1.5))));
  s -= gaze * vec2(.0045, .0030) * (1.0 - smoothstep(.011, .017, length((uv - ER) * vec2(1.0, 1.5))));
  vec3 col = texture2D(tex, s).rgb;
  if (gap) {
    float t = (uv.y - MC.y) / max(d, 0.0001);
    vec3 inside = mix(vec3(.93, .90, .88), vec3(.22, .05, .08), smoothstep(0.0, 0.55, t));
    col = mix(col, inside, 1.0 - smoothstep(0.55, 0.95, abs(dx)));
  }
  col = lids(col, uv, EL, blinkL);
  col = lids(col, uv, ER, blinkR);
  gl_FragColor = vec4(col, 1.0);
}`;

const gl = canvas.getContext('webgl', { antialias: true });
const U = {};
function sh(type, src) { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
const prog = gl.createProgram();
gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
gl.linkProgram(prog); gl.useProgram(prog);
['tilt', 'breath', 'sway', 'flexL', 'flexR', 'headShift', 'bodyShift', 'gaze', 'blinkL', 'blinkR', 'mouthOpen', 'smile', 'brow']
  .forEach((n) => (U[n] = gl.getUniformLocation(prog, n)));
// 48x48 grid in uv space
const N = 48, verts = [], idx = [];
for (let y = 0; y <= N; y++) for (let x = 0; x <= N; x++) verts.push(x / N, y / N);
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const a = y * (N + 1) + x, b = a + 1, c = a + N + 1, d = c + 1; idx.push(a, b, c, b, d, c); }
const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
const loc = gl.getAttribLocation(prog, 'aPos'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
const tex = gl.createTexture();
let ready = false;
const img = new Image();
img.onload = () => {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  ready = true;
};
img.src = 'noa.jpg';

// ---------- state ----------
const state = { mood: 'neutral', moodUntil: 0, speaking: false, mode: 'normal',
  gaze: { x: 0, y: 0, tx: 0, ty: 0 }, tilt: 0, ttilt: 0, bounce: 0, blink: 0, nextBlink: 1500,
  wink: 0, lastPointer: 0, lastTap: 0 };
const spring = (k = 0.14, d = 0.78) => ({ x: 0, v: 0, t: 0, k, d, step() { this.v = (this.v + (this.t - this.x) * this.k) * this.d; this.x += this.v; return this.x; } });
const sSmile = spring(0.1, 0.8), sBrow = spring(0.12, 0.8), sOpen = spring(0.35, 0.6), sFlexL = spring(0.2, 0.7), sFlexR = spring(0.2, 0.7);
const flexUntil = { L: 0, R: 0 };
const hair = { sway: 0, v: 0, prevTilt: 0, prevBounce: 0 };
const IDLE_MOOD = { soft: 'happy', normal: 'neutral', firm: 'serious' };
// per mood: [smile, brow lift]
const FACE = { neutral: [0.2, 0], happy: [1, 0.3], playful: [0.9, 0.7], surprised: [0, 1.4], serious: [-0.6, -0.8], sad: [-1, 0.5] };
const setMood = (m, ms = 2500) => { state.mood = m; state.moodUntil = performance.now() + ms; };
const flex = (side, ms = 2200) => { flexUntil[side] = performance.now() + ms; };

// ---------- pointer interaction (uv coordinates of the portrait) ----------
function uv(e) { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }; }
function aim(e) {
  const p = uv(e);
  state.gaze.tx = Math.max(-1.5, Math.min(1.5, (p.x - 0.52) * 2.4));
  state.gaze.ty = Math.max(-1.5, Math.min(1.5, (p.y - 0.3) * 2.4));
  state.lastPointer = performance.now();
}
let down = null, holdTimer = null;
stage.addEventListener('pointermove', (e) => {
  aim(e);
  if (down) {
    state.ttilt = Math.max(-1, Math.min(1, (uv(e).x - 0.5) * 2)) * 6;
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 12) { clearTimeout(holdTimer); setMood('playful', 800); }
  }
});
stage.addEventListener('pointerdown', (e) => {
  stage.setPointerCapture(e.pointerId);
  window.DeviceOrientationEvent?.requestPermission?.().catch(() => {});
  down = { x: e.clientX, y: e.clientY };
  aim(e);
  const p = uv(e), now = performance.now();
  navigator.vibrate?.(15);
  state.bounce = 1;
  if (p.y < 0.55 && p.x > 0.3 && p.x < 0.8) {                    // head
    if (now - state.lastTap < 380) { state.wink = 1; setMood('playful', 1400); }   // double tap = wink
    else if (p.y < 0.2) setMood('surprised', 900);
    else setMood(Math.random() < 0.5 ? 'happy' : 'playful', 1600);
  } else if (p.y >= 0.5 && (p.x <= 0.3 || p.x >= 0.78)) {         // arm -> flex
    flex(p.x < 0.5 ? 'L' : 'R'); setMood('playful', 2200);
  } else { flex('L', 2400); flex('R', 2400); setMood('happy', 2400); }  // torso
  state.lastTap = now;
  clearTimeout(holdTimer);
  holdTimer = setTimeout(() => { setMood('happy', 3000); navigator.vibrate?.(30); }, 700);
});
const release = () => { down = null; state.ttilt = 0; clearTimeout(holdTimer); };
stage.addEventListener('pointerup', release);
stage.addEventListener('pointercancel', release);
stage.addEventListener('pointerleave', () => { if (!down) { state.gaze.tx = 0; state.gaze.ty = 0; } });
window.addEventListener('deviceorientation', (e) => {
  if (performance.now() - state.lastPointer < 2500 || e.gamma == null) return;
  state.gaze.tx = Math.max(-1, Math.min(1, e.gamma / 30));
  state.gaze.ty = Math.max(-1, Math.min(1, ((e.beta || 45) - 45) / 30));
});

// ---------- render loop ----------
const lerp = (a, b, k) => a + (b - a) * k;
let last = performance.now();
function frame(t) {
  requestAnimationFrame(frame);
  if (!ready) return;
  const dt = Math.min(50, t - last); last = t;
  if (t > state.moodUntil) state.mood = state.speaking ? 'happy' : IDLE_MOOD[state.mode];
  const g = state.gaze;
  g.x = lerp(g.x, g.tx, 0.12); g.y = lerp(g.y, g.ty, 0.12);
  state.tilt = lerp(state.tilt, state.ttilt + g.x * 2.5, 0.1);
  state.bounce = Math.max(0, state.bounce - dt / 400);
  state.wink = Math.max(0, state.wink - dt / 700);

  const breath = Math.sin(t / 900), swayIdle = Math.sin(t / 2600);
  const hop = Math.sin(state.bounce * Math.PI) * -0.012;
  const shrug = state.mood === 'surprised' ? -0.006 : 0;

  hair.v += -(state.tilt - hair.prevTilt) * 0.5 - (state.bounce - hair.prevBounce) * 5 - hair.sway * 0.07;
  hair.v *= 0.9; hair.sway += hair.v;
  hair.prevTilt = state.tilt; hair.prevBounce = state.bounce;

  const [sm, br] = FACE[state.mood] || FACE.neutral;
  sSmile.t = sm; sBrow.t = br;
  sOpen.t = state.speaking ? Math.max(0, Math.sin(t / 85) + Math.sin(t / 53) * 0.8) * 0.55 : state.mood === 'surprised' ? 0.7 : state.mood === 'happy' ? 0.12 : 0;
  sFlexL.t = t < flexUntil.L ? 1 : state.mode === 'firm' ? 0.25 : 0;
  sFlexR.t = t < flexUntil.R ? 1 : state.mode === 'firm' ? 0.25 : 0;

  state.nextBlink -= dt;
  if (state.nextBlink < 0) { state.blink = 1; state.nextBlink = 1800 + Math.random() * 3500; }
  state.blink = Math.max(0, state.blink - dt / 150);
  const closeness = Math.sin(state.blink * Math.PI);
  const squint = state.mood === 'serious' ? 0.18 : state.mood === 'happy' ? 0.1 : 0;

  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.uniform1f(U.tilt, (state.tilt * Math.PI) / 180);
  gl.uniform1f(U.breath, breath + (state.speaking ? 0.4 : 0));
  gl.uniform1f(U.sway, hair.sway + Math.sin(t / 1700) * 0.8);
  gl.uniform1f(U.flexL, sFlexL.step()); gl.uniform1f(U.flexR, sFlexR.step());
  gl.uniform2f(U.headShift, g.x * 0.012 + swayIdle * 0.003, g.y * 0.008 + hop + breath * 0.002 + shrug);
  gl.uniform2f(U.bodyShift, swayIdle * 0.002, 0);
  gl.uniform2f(U.gaze, g.x + Math.sin(t / 2300) * 0.15, g.y + Math.cos(t / 3100) * 0.08);
  gl.uniform1f(U.blinkL, Math.max(closeness, squint));
  gl.uniform1f(U.blinkR, state.wink > 0 ? 1 : Math.max(closeness, squint));
  gl.uniform1f(U.mouthOpen, Math.max(0, sOpen.step()));
  gl.uniform1f(U.smile, sSmile.step()); gl.uniform1f(U.brow, sBrow.step());
  gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_SHORT, 0);
}
requestAnimationFrame(frame);

// ---------- modes ----------
document.querySelectorAll('.modes button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.modes button').forEach((x) => x.classList.toggle('on', x === b));
  state.mode = b.dataset.mode;
  history.length = 0;
  if (state.mode === 'firm') { flex('L', 1800); flex('R', 1800); }
  say({ soft: 'היי, אני כאן. בקצב שלך.', normal: 'היי! מה קורה?', firm: 'טוב. מקשיבה. תדבר ברור.' }[state.mode],
    { soft: 'happy', normal: 'playful', firm: 'serious' }[state.mode]);
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
async function send(text) {
  addLine('me', text);
  history.push({ role: 'user', content: text });
  setMood('neutral', 600);
  let out;
  try {
    const r = await fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: state.mode, messages: history }) });
    out = await r.json();
  } catch { out = { offline: true }; }
  if (out.offline || out.error) {
    const pool = OFFLINE[state.mode];
    out = { mood: 'playful', reply: pool[Math.floor(Math.random() * pool.length)] };
  }
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

say('היי, אני נועה. תיגע בי, תדבר איתי, תבחר מצב למעלה.', 'happy');

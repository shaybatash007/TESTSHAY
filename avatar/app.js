const $ = (s) => document.querySelector(s);
const canvas = $('#avatar'), stage = $('#stage'), bubble = $('#bubble'), log = $('#log');
const now = () => performance.now() / 1000;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// =====================================================================
//  Photoreal live avatar.
//  The pictures are photographs of one person. Her face is animated by a neural face-animation model offline
//  (LivePortrait): blinks, 8 mouth shapes, 9 expressions and head turns are pre-rendered as small frames and packed
//  into atlases. In the browser a WebGL shader picks and blends those frames in real time, on top of the photo,
//  and warps the whole picture for breathing, head sway, hair movement and the skin that follows your finger.
// =====================================================================
const gl = canvas.getContext('webgl', { antialias: true, premultipliedAlpha: false, alpha: false });
const VS = `
attribute vec2 aPos; varying vec2 vUv;
uniform float tilt, breath, sway, squash, asp, ipd, neck, tpress;
uniform vec2 headShift, fc, tpos, tvec, look;
void main(){
  vec2 p = vec2(aPos.x, aPos.y * asp); vUv = aPos; vec2 q = p;
  vec2 f = vec2(fc.x, fc.y * asp);
  float low = smoothstep(neck + 0.1 * asp, neck + 0.5 * asp, p.y);
  q = mix(q, vec2(0.5, asp) + (q - vec2(0.5, asp)) * (1.0 + breath * 0.007), low);
  float hw = (1.0 - smoothstep(f.x - 1.9 * ipd, f.x - 0.9 * ipd, p.x)) + smoothstep(f.x + 0.9 * ipd, f.x + 1.9 * ipd, p.x);
  q.x += sway * 0.010 * hw * clamp((p.y - f.y) / (1.2 * asp), 0.0, 1.0) * smoothstep(f.y - 0.1, f.y + 0.4 * asp, p.y);
  vec2 dd = (aPos - tpos) * vec2(1.0, asp); float tw = exp(-dot(dd, dd) / 0.0035);
  q += tvec * tw - dd * tw * tpress * 0.2;
  float hW = 1.0 - smoothstep(neck - 0.04 * asp, neck + 0.12 * asp, p.y);
  vec2 piv = vec2(f.x, neck + 0.05 * asp), r = q - piv;
  float c = cos(tilt * hW), s = sin(tilt * hW);
  q = piv + vec2(c * r.x - s * r.y, s * r.x + c * r.y) + headShift * hW * vec2(1.0, asp);
  q.x += look.x * 0.012 * smoothstep(neck + 0.2 * asp, neck - 0.3 * asp, p.y);
  q.x = 0.5 + (q.x - 0.5) * squash;
  q = vec2(0.5, 0.5 * asp) + (q - vec2(0.5, 0.5 * asp)) * 1.04;
  q.y /= asp;
  gl_Position = vec4(q.x * 2.0 - 1.0, 1.0 - q.y * 2.0, 0.0, 1.0);
}`;
const FS = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uBase, uAtlasA, uAtlasB;
uniform vec2 uSize;
uniform vec3 uO2C0, uO2C1;           // image px -> crop px (2x3)
uniform vec4 uBBox;                  // crop px: x, y, w, h
uniform vec4 uEyeL, uEyeR;           // crop px: cx, cy, rx, ry
uniform vec4 uAtlasInfoA, uAtlasInfoB;   // cols, rows, cw, ch
uniform vec4 uCellsA, uCellsB;       // open, half, closed cell index (a), mode (w): 0 none 1 delta 2 direct
uniform vec2 uBlink;                 // left, right (0..1)
uniform float uMix, uFace, uAlpha;
vec3 fetchCell(sampler2D t, vec4 info, float idx, vec2 q){
  float col = mod(idx, info.x), row = floor(idx / info.x);
  vec2 qq = clamp(q, vec2(0.6 / info.z, 0.6 / info.w), vec2(1.0 - 0.6 / info.z, 1.0 - 0.6 / info.w));
  vec2 uv = vec2((col + qq.x) / info.x, (row + qq.y) / info.y);
  return texture2D(t, uv).rgb;
}
vec3 compose(sampler2D t, vec4 info, vec4 cells, vec2 q, float b, vec3 base){
  vec3 fo = fetchCell(t, info, cells.x, q);
  vec3 fh = fetchCell(t, info, cells.y, q);
  vec3 fcl = fetchCell(t, info, cells.z, q);
  vec3 v = mix(mix(fo, fh, clamp(2.0 * b, 0.0, 1.0)), fcl, clamp(2.0 * b - 1.0, 0.0, 1.0));
  return cells.w > 1.5 ? v : base + (v - 0.50196) * 2.0;
}
float ell(vec2 p, vec4 e){ return 1.0 - smoothstep(0.55, 1.0, length((p - e.xy) / e.zw)); }
void main(){
  vec3 base = texture2D(uBase, vUv).rgb;
  vec3 col = base;
  if (uFace > 0.5) {
    vec2 px = vUv * uSize;
    vec2 pc = vec2(dot(uO2C0, vec3(px, 1.0)), dot(uO2C1, vec3(px, 1.0)));
    vec2 q = (pc - uBBox.xy) / uBBox.zw;
    if (q.x > 0.0 && q.x < 1.0 && q.y > 0.0 && q.y < 1.0) {
      float m = 1.0 - smoothstep(0.78, 1.0, length((q - 0.5) * 2.0));
      float bl = clamp(uBlink.x * ell(pc, uEyeL) + uBlink.y * ell(pc, uEyeR), 0.0, 1.0);
      vec3 c0 = compose(uAtlasA, uAtlasInfoA, uCellsA, q, bl, base);
      vec3 c1 = uMix > 0.002 ? compose(uAtlasB, uAtlasInfoB, uCellsB, q, bl, base) : c0;
      col = mix(base, mix(c0, c1, uMix), m);
    }
  }
  gl_FragColor = vec4(col, uAlpha);
}`;
function sh(type, src) { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
const prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog); gl.useProgram(prog);
const U = {}; for (const n of ['tilt', 'breath', 'sway', 'squash', 'asp', 'ipd', 'neck', 'tpress', 'headShift', 'fc', 'tpos', 'tvec', 'look', 'uBase', 'uAtlasA', 'uAtlasB', 'uSize', 'uO2C0', 'uO2C1', 'uBBox', 'uEyeL', 'uEyeR', 'uAtlasInfoA', 'uAtlasInfoB', 'uCellsA', 'uCellsB', 'uBlink', 'uMix', 'uFace', 'uAlpha']) U[n] = gl.getUniformLocation(prog, n);
const NX = 40, NY = 60, verts = [], idx = [];
for (let y = 0; y <= NY; y++) for (let x = 0; x <= NX; x++) verts.push(x / NX, y / NY);
for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) { const a = y * (NX + 1) + x, b = a + 1, c = a + NX + 1, d = c + 1; idx.push(a, b, c, b, d, c); }
gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
const loc = gl.getAttribLocation(prog, 'aPos'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
gl.uniform1i(U.uBase, 0); gl.uniform1i(U.uAtlasA, 1); gl.uniform1i(U.uAtlasB, 2);

function resize() { const dpr = Math.min(devicePixelRatio || 1, 2), w = Math.round(stage.clientWidth * dpr), h = Math.round(stage.clientHeight * dpr); if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; } }
new ResizeObserver(resize).observe(stage); resize();

// ---------- textures (lazy, small LRU) ----------
const BASE = new URL('.', document.currentScript?.src || location.href).href;
const url = (p) => new URL(p, BASE).href;
const texCache = new Map();           // key -> {tex, ready, t}
function loadTex(key, src) {
  let e = texCache.get(key); if (e) { e.t = now(); return e; }
  e = { tex: gl.createTexture(), ready: false, t: now(), w: 0, h: 0 }; texCache.set(key, e);
  const img = new Image(); img.crossOrigin = 'anonymous';
  img.onload = () => {
    gl.bindTexture(gl.TEXTURE_2D, e.tex); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    e.w = img.width; e.h = img.height; e.ready = true;
    if (texCache.size > 22) { const old = [...texCache.entries()].filter(([k, v]) => v.ready && !k.startsWith('keep:')).sort((a, b) => a[1].t - b[1].t)[0]; if (old && old[1] !== e) { gl.deleteTexture(old[1].tex); texCache.delete(old[0]); } }
  };
  img.src = src; return e;
}

// ---------- manifest ----------
let MF = null;
const S = {
  outfit: 'black', scene: 'main', sceneUntil: 0, prevScene: null, fade: 1, fadeFrom: null,
  expr: 'neutral', mood: 'neutral', moodUntil: 0, mode: 'normal', speaking: false,
  mouth: 'cl', blink: 0, blinkDir: 0, nextBlink: 2, wink: 0, forceBlink: 0, thinking: false, listening: false, typingUntil: 0,
  ptr: { x: 0, y: 0, last: -99 }, glance: { x: 0, y: 0 }, glanceUntil: 0, nextGlance: 3,
  laughUntil: 0, smileBoost: 0, shakeUntil: 0, nodUntil: 0, turn: null, squash: 1, turnBack: 0,
  tilt: 0, bounce: 0, blushT: 0,
};
class Spr { constructor(k = 60, d = 11, x = 0) { this.x = x; this.v = 0; this.t = x; this.k = k; this.d = d; } step(dt) { const a = (this.t - this.x) * this.k - this.v * this.d; this.v += a * dt; this.x += this.v * dt; return this.x; } kick(v) { this.v += v; } }
const sp = { tilt: new Spr(60, 9), hx: new Spr(50, 9), hy: new Spr(50, 9), sway: new Spr(30, 4), tx: new Spr(220, 12), ty: new Spr(220, 12), press: new Spr(260, 16), look: new Spr(40, 9) };

// ---------- scene geometry for the vertex warp ----------
function geomOf(sceneKey) {
  const sc = MF.scenes[sceneKey === 'main' || !MF.scenes[sceneKey] ? 'main' : sceneKey]; const L = sc.lmk, W = sc.size[0], H = sc.size[1];
  const eL = L[468], eR = L[473], mid = [(eL[0] + eR[0]) / 2 / W, (eL[1] + eR[1]) / 2 / H];
  const ipd = Math.hypot(eL[0] - eR[0], eL[1] - eR[1]) / W, asp = H / W;
  return { sc, W, H, ipd, asp, mid, fc: [mid[0], mid[1] + 0.5 * ipd / asp], neck: (mid[1] * asp + 2.62 * ipd) };
}

// ---------- face frame selection ----------
const MOUTHS = ['cl', 'pp', 'a1', 'a2', 'e', 'o', 'u', 'ss'];
const CELL_MOUTH = { cl: 'cl', pp: 'cl', ss: 'cl', a1: 'a1', e: 'a1', a2: 'a2', o: 'o', u: 'o' };
function atlasFor(sceneKey, expr, cell) {
  if (!MF) return null;
  if (sceneKey !== 'main') { const sc = MF.scenes[sceneKey]; return sc ? { key: sceneKey + ':face', at: sc.atlases.face, prefix: `C_${sceneKey}` } : null; }
  const sc = MF.scenes.main;
  if (cell !== 'C' && (expr === 'neutral' || expr === 'smile') && sc.atlases['cells_' + expr]) return { key: 'main:cells_' + expr, at: sc.atlases['cells_' + expr], prefix: `${cell}_${expr}` };
  const e = sc.atlases['exp_' + expr] ? expr : 'neutral';
  return { key: 'main:exp_' + e, at: sc.atlases['exp_' + e], prefix: `C_${e}` };
}
function pickFrames(sceneKey, expr, cell, mouth) {
  const a = atlasFor(sceneKey, expr, cell); if (!a) return null;
  const cells = a.at.cells, isCell = a.key.includes('cells_') || sceneKey !== 'main';
  const m = isCell ? (sceneKey !== 'main' ? ({ cl: 'cl', pp: 'cl', ss: 'cl', e: 'a1', u: 'o' }[mouth] || mouth) : CELL_MOUTH[mouth]) : mouth;
  const get = (ey) => { for (const mm of [m, 'cl']) { const k = `${a.prefix}_${ey}_${mm}`; if (cells[k] !== undefined) return cells[k]; } return undefined; };
  const o = get('o'); if (o === undefined) return null;
  const c = get('c') ?? o, h = get('h') ?? c;
  return { key: a.key, at: a.at, o, h, c, mode: a.at.mode === 'delta' ? 1 : 2, sig: `${a.key}|${o}|${h}|${c}` };
}
function bindAtlas(unit, which, fr) {
  const e = loadTex('atlas:' + fr.key, url('live/' + fr.at.file)); if (!e.ready) return false;
  gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, e.tex);
  const info = [fr.at.cols, fr.at.rows, fr.at.cw, fr.at.ch], cells = [fr.o, fr.h, fr.c, fr.mode];
  if (which === 'A') { gl.uniform4f(U.uAtlasInfoA, ...info); gl.uniform4f(U.uCellsA, ...cells); } else { gl.uniform4f(U.uAtlasInfoB, ...info); gl.uniform4f(U.uCellsB, ...cells); }
  return true;
}

// ---------- the face "slots": the frame set being shown (A), the one fading in (B) ----------
const slot = { A: null, B: null, mix: 0, dur: 0.06 };
function wantFrames(fr, dur) {
  if (!slot.A) { slot.A = fr; return; }
  const target = slot.B || slot.A; if (target.sig === fr.sig) return;
  if (slot.B && slot.mix > 0.5) slot.A = slot.B;
  slot.B = fr; slot.mix = 0; slot.dur = dur;
}

// ---------- scene switching (outfits, poses) ----------
function baseUrl(outfit, scene) { const o = MF.outfits[outfit] || MF.outfits.black; return url('live/' + (scene === 'main' ? o.base : (o.poses[scene] || o.base))); }
function showScene(scene, hold = 0, fadeDur = 0.35) {
  if (scene === S.scene) { S.sceneUntil = hold ? now() + hold : 0; return; }
  S.fadeFrom = { scene: S.scene, outfit: S.outfit }; S.scene = scene; S.fade = 0; S.fadeDur = fadeDur; S.sceneUntil = hold ? now() + hold : 0;
  loadTex(S.outfit + '/' + scene, baseUrl(S.outfit, scene));
}
function setOutfit(id) {
  if (!MF.outfits[id] || id === S.outfit) return;
  S.fadeFrom = { scene: S.scene, outfit: S.outfit }; S.outfit = id; S.fade = 0; S.fadeDur = 0.5;
  loadTex(id + '/' + S.scene, baseUrl(id, S.scene));
  try { localStorage.setItem('noa.outfit', id); } catch {}
  markPanel();
}

// ---------- actions ----------
const quip = (text, ms = 1500) => { if (S.speaking) return; bubble.hidden = false; bubble.textContent = text; clearTimeout(quip.t); quip.t = setTimeout(() => { if (!S.speaking) bubble.hidden = true; }, ms); };
const setMood = (m, sec = 2.5) => { S.mood = m; S.moodUntil = now() + sec; };
const IDLE = { soft: 'tender', normal: 'neutral', firm: 'serious' };
const MOOD_EXPR = { neutral: 'neutral', happy: 'smile', playful: 'smirk', surprised: 'surprised', serious: 'serious', sad: 'sad', tender: 'tender', grin: 'grin', laugh: 'laugh' };
const ACT = {
  flex: () => { showScene('flex', 4.5); setMood('playful', 4.5); }, flexL: () => { showScene('flexL', 3.8); setMood('playful', 3.8); }, flexR: () => { showScene('flexR', 3.8); setMood('playful', 3.8); },
  wave: () => { showScene('wave', 3.6); setMood('happy', 3.6); }, hips: () => { showScene('hips', 4.2); setMood('serious', 4.2); },
  smile: () => { S.smileBoost = now() + 4.5; setMood('grin', 4.5); }, laugh: () => { S.laughUntil = now() + 3; setMood('laugh', 3); sp.hy.kick(2); },
  turn: () => startTurn('back'), front: () => startTurn('main'),
  wink: () => { S.wink = 1; setMood('playful', 1.3); }, blink: () => { S.forceBlink = 1; },
  surprised: () => setMood('surprised', 2.4), sad: () => setMood('sad', 3.2), serious: () => setMood('serious', 4),
  tilt: () => { sp.tilt.t = 0.09; setTimeout(() => (sp.tilt.t = 0), 2200); setMood('tender', 2.2); },
  hair: () => { sp.sway.kick(5); sp.tilt.kick(1.2); setMood('playful', 1.8); }, shake: () => { S.shakeUntil = now() + 1.5; }, nod: () => { S.nodUntil = now() + 1.5; setMood('happy', 1.5); },
  lookL: () => { S.glance = { x: -1, y: 0 }; S.glanceUntil = now() + 2.2; }, lookR: () => { S.glance = { x: 1, y: 0 }; S.glanceUntil = now() + 2.2; },
  lookU: () => { S.glance = { x: 0, y: -1 }; S.glanceUntil = now() + 2.2; }, lookD: () => { S.glance = { x: 0, y: 1 }; S.glanceUntil = now() + 2.2; },
  lookAtMe: () => { S.glance = { x: 0, y: 0 }; S.glanceUntil = now() + 2.5; },
};
for (const id of ['gym', 'run', 'beach', 'tropic', 'evening', 'casual', 'black']) ACT['outfit_' + id] = () => { setOutfit(id); setMood('happy', 2.5); };
function startTurn(to) { if (S.scene === to) return; showScene(to, to === 'back' ? 6.5 : 0, 0.45); }
const act = (n) => (ACT[n] ? (ACT[n](), true) : false);
const CMDS = [
  [/תסתובבי חזרה|תחזרי|פני אלי|תסתכלי עלי|תסתכלי אלי|turn back|face me|come back/, 'front'],
  [/תסתובבי|סיבוב|תסתובב|turn around|spin|show me your back/, 'turn'],
  [/(שרירים|שריר|תכופפי|פלקס|תפגיני|flex|muscle|bicep).*(ימין|right)|(ימין|right).*(שרירים|שריר|תכופפי|פלקס|flex|muscle|bicep)/, 'flexR'],
  [/(שרירים|שריר|תכופפי|פלקס|תפגיני|flex|muscle|bicep).*(שמאל|left)|(שמאל|left).*(שרירים|שריר|תכופפי|פלקס|flex|muscle|bicep)/, 'flexL'],
  [/שרירים|שריר|תכופפי|פלקס|תפגיני|דו.?ראשי|flex|muscle|bicep/, 'flex'],
  [/תקרצי|קריצה|wink/, 'wink'], [/תצחקי|צחוק|laugh/, 'laugh'], [/תחייכי|חיוך|תחייך|smile/, 'smile'], [/תנופפי|נפנפי|wave/, 'wave'],
  [/מותניים|תעמדי|עמידה|hands on (your )?hips|power pose/, 'hips'], [/רצינית|תהיי קשוחה|serious|stern|angry|כועסת/, 'serious'],
  [/תמצמצי|blink/, 'blink'], [/תופתעי|הפתעה|surprised|shocked/, 'surprised'], [/עצובה|תהיי עצובה|sad/, 'sad'],
  [/תטי ראש|תטי את הראש|tilt/, 'tilt'], [/תזיזי שיער|תנערי|תעיפי שיער|hair flip|toss your hair/, 'hair'], [/תנענעי ראש|תגידי לא|shake your head/, 'shake'], [/תהנהני|תגידי כן|nod/, 'nod'],
  [/תסתכלי (ל?ימינה|ימין)|look right/, 'lookR'], [/תסתכלי (ל?שמאלה|שמאל)|look left/, 'lookL'], [/תסתכלי (ל?מעלה|למעלה)|look up/, 'lookU'], [/תסתכלי (ל?מטה|למטה)|look down/, 'lookD'],
];
function parseCommand(text) { const t = text.toLowerCase().replace(/[֑-ׇ"'.,!?]/g, ' '); for (const [re, n] of CMDS) if (re.test(t)) return n; return null; }
// outfit commands
const OUTFIT_WORDS = [[/חוף|ים|beach|swim/, 'beach'], [/טרופי|אקזוטי|exotic|tropic/, 'tropic'], [/ערב|שמלה|evening|dress/, 'evening'], [/ריצה|run/, 'run'], [/כושר|gym/, 'gym'], [/יומיומי|ג'ינס|casual|jeans/, 'casual'], [/שחור|black/, 'black']];
function parseOutfit(text) { if (!/בגד|תלבשי|תחליפי|ללבוש|לבוש|outfit|wear|change clothes|put on/i.test(text)) return null; for (const [re, id] of OUTFIT_WORDS) if (re.test(text)) return id; return null; }

// ---------- touch ----------
function regionOf(p) {
  const g = geomOf(S.scene === 'back' ? 'main' : S.scene); const L = g.sc.lmk, W = g.W, H = g.H, mx = g.mid[0], my = g.mid[1];
  const x = (p.x - mx) / g.ipd, y = ((p.y - my) * H / W) / g.ipd, ax = Math.abs(x), sx = x < 0 ? -1 : 1;
  if (S.scene === 'back') return { r: 'back', sx };
  if (ax < 1.35 && y > -2.3 && y < 2.0) {
    if (y < -0.55) return { r: 'forehead', sx }; if (y < 0.3 && ax < 0.95) return { r: 'eyes', sx }; if (y < 1.0 && ax < 0.4) return { r: 'nose', sx };
    if (y < 1.0) return { r: 'cheek', sx }; if (y < 1.5) return ax < 0.85 ? { r: 'mouth', sx } : { r: 'cheek', sx }; return { r: 'chin', sx };
  }
  if (y < -2.3 && ax < 2.2) return { r: 'hair', sx };
  if (ax < 1.1 && y >= 2.0 && y < 3.2) return { r: 'neck', sx };
  if (ax >= 2.9 || (S.scene.startsWith('flex') && ax >= 2.0 && y > -1.5 && y < 3.5)) return { r: 'arm', sx };
  if (ax >= 1.35 && y < 2.9) return { r: 'hair', sx };
  if (y < 4.6 && ax < 3.2) return { r: 'shoulder', sx };
  return { r: 'torso', sx };
}
function react({ r, sx }) {
  const n = now(); S.bounce = 0.6;
  switch (r) {
    case 'forehead': setMood('surprised', 0.9); sp.hy.kick(-2); quip('היי!'); break;
    case 'eyes': S.forceBlink = 1; setMood('playful', 1.1); quip('אוי!'); break;
    case 'nose': S.forceBlink = 1; setMood('happy', 1.4); sp.hy.kick(-2.5); S.blushT = 0.6; quip('בוּפּ!'); break;
    case 'cheek': setMood('happy', 1.8); sp.tilt.kick(sx * 0.9); S.glance = { x: sx, y: 0 }; S.glanceUntil = n + 1.4; break;
    case 'mouth': setMood('playful', 1.6); sp.tilt.kick(-sx * 0.8); quip('חחח נו…'); break;
    case 'chin': setMood('happy', 1.5); sp.hy.kick(-2); break;
    case 'hair': sp.sway.kick(sx * 6); sp.tilt.kick(sx * 0.8); setMood('playful', 1.5); break;
    case 'neck': setMood('happy', 1.5); sp.hy.kick(1.5); quip('מדגדג!'); break;
    case 'shoulder': setMood('happy', 1.4); sp.hy.kick(-1.6); S.glance = { x: sx, y: 0 }; S.glanceUntil = n + 1.3; break;
    case 'arm': act(sx < 0 ? 'flexR' : 'flexL'); quip('רוצה לראות?'); break;
    case 'torso': act('flex'); quip('חח, שרירים?'); break;
    case 'back': startTurn('main'); quip('הייי!'); break;
  }
}
let down = null, holdT = null; const touch = { x: 0.5, y: 0.4 };
function uvOf(e) { const r = canvas.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height; return { x: 0.5 + (x - 0.5) / 1.04, y: 0.5 + (y - 0.5) / 1.04, w: r.width, h: r.height }; }
function aim(e) { const p = uvOf(e); S.ptr.x = clamp((p.x - 0.5) * 2, -1, 1); S.ptr.y = clamp((p.y - 0.3) * 2, -1, 1); S.ptr.last = now(); }
stage.addEventListener('pointermove', (e) => {
  aim(e); if (!down) return; const p = uvOf(e); touch.x = p.x; touch.y = p.y;
  const dx = (e.clientX - down.cx) / p.w, dy = (e.clientY - down.cy) / p.h;
  sp.tx.t = clamp(dx * 0.45, -0.045, 0.045); sp.ty.t = clamp(dy * 0.45, -0.045, 0.045);
  if (Math.hypot(e.clientX - down.cx, e.clientY - down.cy) > 14) { clearTimeout(holdT); down.moved = true; }
});
stage.addEventListener('pointerdown', (e) => {
  stage.setPointerCapture(e.pointerId); const p = uvOf(e), t = now(); aim(e);
  down = { cx: e.clientX, cy: e.clientY, t, moved: false, reg: regionOf(p), w: p.w }; touch.x = p.x; touch.y = p.y; sp.press.t = 1;
  navigator.vibrate?.(15);
  if (down.reg.r === 'eyes' && t - (down.last || 0) < 0.4) { S.wink = 1; quip('😉'); } else react(down.reg);
  clearTimeout(holdT); holdT = setTimeout(() => { S.blushT = 1; setMood('tender', 3); navigator.vibrate?.(30); }, 700);
});
const release = (e) => {
  clearTimeout(holdT);
  if (down && e?.clientX != null) { const dx = e.clientX - down.cx, dt = now() - down.t; if (Math.abs(dx) > down.w * 0.3 && dt < 0.6 && !['forehead', 'eyes', 'nose', 'cheek', 'mouth', 'chin'].includes(down.reg.r)) startTurn(S.scene === 'back' ? 'main' : 'back'); }
  down = null; sp.press.t = 0; sp.tx.t = 0; sp.ty.t = 0; S.blushT = 0;
};
stage.addEventListener('pointerup', release); stage.addEventListener('pointercancel', () => release()); stage.addEventListener('pointerleave', () => { if (!down) S.ptr.last = -99; });
window.addEventListener('deviceorientation', (e) => { if (now() - S.ptr.last < 2.5 || e.gamma == null) return; S.ptr.x = clamp(e.gamma / 30, -1, 1); S.ptr.y = clamp(((e.beta || 45) - 45) / 30, -1, 1); S.ptr.last = now() - 1.9; });

// ---------- speech: text -> mouth shapes ----------
const HE = { 'א': 'aa', 'ע': 'aa', 'ה': 'aa', 'י': 'I', 'ו': 'O', 'ב': 'PP', 'מ': 'PP', 'ם': 'PP', 'פ': 'PP', 'ף': 'FF', 'ש': 'SS', 'ס': 'SS', 'ז': 'SS', 'צ': 'SS', 'ץ': 'SS', 'ד': 'DD', 'ת': 'DD', 'ט': 'DD', 'ל': 'DD', 'נ': 'nn', 'ן': 'nn', 'כ': 'kk', 'ך': 'kk', 'ק': 'kk', 'ג': 'kk', 'ח': 'kk', 'ר': 'RR' };
const EN = { a: 'aa', e: 'E', i: 'I', o: 'O', u: 'U', m: 'PP', b: 'PP', p: 'PP', f: 'FF', v: 'FF', s: 'SS', z: 'SS', d: 'DD', t: 'DD', l: 'DD', n: 'nn', k: 'kk', g: 'kk', c: 'kk', q: 'kk', r: 'RR', j: 'CH', h: 'aa', w: 'U', y: 'I', x: 'SS' };
const V2M = { aa: 'a2', E: 'e', I: 'e', O: 'o', U: 'u', PP: 'pp', FF: 'ss', TH: 'ss', DD: 'a1', kk: 'a1', CH: 'o', SS: 'ss', nn: 'a1', RR: 'o', sil: 'cl' };
const VOW = ['aa', 'E', 'O', 'aa', 'I'];
function visemeSeq(text) {
  const out = []; let vi = 0;
  for (const ch of text.toLowerCase()) {
    if (HE[ch]) { const v = HE[ch]; out.push(v); if (!['aa', 'I', 'O'].includes(v)) out.push(VOW[vi++ % VOW.length]); }
    else if (EN[ch]) out.push(EN[ch]); else if (/[\s,.!?;:]/.test(ch)) out.push('sil');
  }
  return out.length ? out : ['sil'];
}
const talk = { seq: [], t0: 0, dur: 1, active: false };
function startTalk(text, d) { talk.seq = visemeSeq(text); talk.t0 = now(); talk.dur = Math.max(0.8, d); talk.active = true; S.speaking = true; }
function stopTalk() { talk.active = false; S.speaking = false; }

// ---------- per-frame ----------
let last = now(); const time0 = now();
function setGlobalUniforms(g, t, st) {
  gl.uniform1f(U.tilt, st.tilt); gl.uniform1f(U.breath, st.breath); gl.uniform1f(U.sway, st.sway); gl.uniform1f(U.squash, S.squash); gl.uniform1f(U.asp, g.asp); gl.uniform1f(U.ipd, g.ipd);
  gl.uniform1f(U.neck, g.neck); gl.uniform1f(U.tpress, st.press); gl.uniform2f(U.headShift, st.hx, st.hy); gl.uniform2f(U.fc, g.fc[0], g.fc[1]); gl.uniform2f(U.tpos, touch.x, touch.y); gl.uniform2f(U.tvec, st.tx, st.ty); gl.uniform2f(U.look, st.look, 0);
}
function drawScene(sceneKey, outfit, alpha, g, faceOn, st) {
  const te = loadTex(outfit + '/' + sceneKey, baseUrl(outfit, sceneKey)); if (!te.ready) return false;
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, te.tex);
  gl.uniform2f(U.uSize, te.w, te.h); gl.uniform1f(U.uAlpha, alpha);
  let face = 0;
  if (faceOn && slot.A) {
    const sc = g.sc, o = sc.o2c;
    gl.uniform3f(U.uO2C0, o[0][0], o[0][1], o[0][2]); gl.uniform3f(U.uO2C1, o[1][0], o[1][1], o[1][2]);
    gl.uniform4f(U.uBBox, ...sc.bbox); gl.uniform4f(U.uEyeL, ...sc.eyes.L); gl.uniform4f(U.uEyeR, ...sc.eyes.R);
    if (bindAtlas(1, 'A', slot.A)) { face = 1; gl.uniform1f(U.uMix, 0); if (slot.B && bindAtlas(2, 'B', slot.B)) gl.uniform1f(U.uMix, slot.mix); }
    gl.uniform2f(U.uBlink, st.bl, st.br);
  }
  gl.uniform1f(U.uFace, face);
  gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_SHORT, 0); return true;
}
function frame() {
  requestAnimationFrame(frame);
  if (!MF) return;
  const t = now(), dt = Math.min(0.05, t - last); last = t; resize();
  const sceneKey = S.scene; const faceScene = sceneKey === 'back' ? null : sceneKey;

  // timers
  if (S.sceneUntil && t > S.sceneUntil) { S.sceneUntil = 0; showScene('main'); }
  if (S.fade < 1) S.fade = Math.min(1, S.fade + dt / (S.fadeDur || 0.35));
  if (S.turn) {
    const k = (t - S.turn.t0) / 0.95;
    if (k < 0.5) S.squash = 1 - Math.pow(k * 2, 2) * 0.96;
    else { if (!S.turn.swapped) { S.turn.swapped = true; S.scene = S.turn.to; S.fade = 1; S.fadeFrom = null; S.sceneUntil = S.scene === 'back' ? t + 6.5 : 0; } S.squash = 0.04 + (1 - Math.pow(1 - (k - 0.5) * 2, 2)) * 0.96; }
    if (k >= 1) { S.turn = null; S.squash = 1; }
  } else S.squash = 1;
  if (S.scene === 'back' && S.sceneUntil && t > S.sceneUntil && !S.turn) startTurn('main');
  if (t > S.moodUntil) S.mood = S.speaking ? 'happy' : IDLE[S.mode];
  S.listening = t < S.typingUntil || mic.classList.contains('rec');

  // blink
  S.nextBlink -= dt; if (S.nextBlink < 0) { S.blinkDir = 1; S.nextBlink = 2 + Math.random() * 4.5; if (Math.random() < 0.18) S.nextBlink = 0.3; }
  if (S.forceBlink) { S.blinkDir = 1; S.forceBlink = 0; }
  if (S.blinkDir === 1) { S.blink += dt / 0.06; if (S.blink >= 1) { S.blink = 1; S.blinkDir = -1; } } else if (S.blinkDir === -1) { S.blink -= dt / 0.11; if (S.blink <= 0) { S.blink = 0; S.blinkDir = 0; } }
  S.wink = Math.max(0, S.wink - dt / 0.9);

  // expression
  let expr = MOOD_EXPR[S.mood] || 'neutral';
  if (S.speaking && (expr === 'smirk' || expr === 'grin')) expr = 'smile';
  if (t < S.laughUntil) expr = Math.sin(t * 17) > -0.2 ? 'laugh' : 'grin';
  if (S.thinking) expr = 'neutral';
  // gaze / head cell
  const havePtr = t - S.ptr.last < 3; let gx = 0, gy = 0;
  if (t < S.glanceUntil) { gx = S.glance.x; gy = S.glance.y; } else if (havePtr) { gx = S.ptr.x; gy = S.ptr.y; }
  else { if (t > S.nextGlance) { S.glance = { x: (Math.random() - 0.5) * 1.6, y: (Math.random() - 0.5) * 0.6 }; if (Math.random() < 0.45) S.glance = { x: 0, y: 0 }; S.nextGlance = t + 1.5 + Math.random() * 3.5; } gx = S.glance.x; gy = S.glance.y; }
  if (S.thinking) { gx = -0.8; gy = -0.6; }
  if (S.listening) { gx *= 0.3; gy *= 0.3; }
  let cell = 'C'; if (Math.abs(gx) > 0.88) cell = gx < 0 ? 'X' : 'Y'; else if (Math.abs(gx) > 0.34) cell = gx < 0 ? 'L' : 'R'; else if (Math.abs(gy) > 0.62) cell = gy < 0 ? 'U' : 'D';
  if (S.scene !== 'main') cell = 'C';
  // mouth
  let mouth = S.forceMouth || 'cl';
  if (talk.active) { const k = (t - talk.t0) / talk.dur; if (k >= 1) stopTalk(); else mouth = V2M[talk.seq[clamp(Math.floor(k * talk.seq.length), 0, talk.seq.length - 1)]] || 'cl'; }
  if (faceScene && MF.scenes[faceScene]) {
    const fr = pickFrames(faceScene, expr, cell, mouth);
    if (fr) { const cur = slot.B || slot.A; const dur = !cur || fr.key !== cur.key ? (cell !== lastCell ? 0.16 : 0.22) : 0.055; wantFrames(fr, dur); lastCell = cell; }
  }
  if (slot.B) { slot.mix = Math.min(1, slot.mix + dt / slot.dur); if (slot.mix >= 1) { slot.A = slot.B; slot.B = null; slot.mix = 0; } }

  // warp state
  const tt = t - time0, breath = Math.sin(tt * 1.7), swayIdle = Math.sin(tt * 0.45);
  const nod = t < S.nodUntil ? Math.sin(tt * 9) * 0.011 : 0, shake = t < S.shakeUntil ? Math.sin(tt * 11) * 0.025 : 0;
  S.bounce = Math.max(0, S.bounce - dt / 0.4);
  sp.tilt.t = (sp.tilt.t > 0.001 || sp.tilt.t < -0.001 ? sp.tilt.t : 0);
  const talkNod = talk.active ? Math.sin(tt * 3.1) * 0.003 : 0;
  sp.sway.t = Math.sin(tt * 1.3) * 0.5 + (talk.active ? Math.sin(tt * 2.2) : 0) * 0.3;
  sp.look.t = clamp(gx, -1, 1);
  const st = { tilt: sp.tilt.step(dt) + swayIdle * 0.004 + shake + gx * 0.012, breath, sway: sp.sway.step(dt), press: sp.press.step(dt), tx: sp.tx.step(dt), ty: sp.ty.step(dt),
    hx: sp.hx.step(dt) + swayIdle * 0.0015 + gx * 0.004, hy: sp.hy.step(dt) * 0.004 + breath * 0.0012 + nod + talkNod - Math.sin(S.bounce * Math.PI) * 0.006 + gy * 0.002, look: sp.look.step(dt),
    bl: Math.max(S.blink, S.thinking ? 0 : 0), br: S.blink };
  st.bl = Math.max(S.blink, 0); st.br = Math.max(S.blink, S.wink > 0 ? 1 : 0);
  if (S.wink > 0) { st.bl = S.blink; }

  // the photo is never bent: no squash, sway, tilt or skin pull (those were the visible distortions)
  Object.assign(st, { tilt: 0, breath: 0, sway: 0, press: 0, tx: 0, ty: 0, hx: 0, hy: 0, look: 0 });
  S.squash = 1;
  // draw
  resize(); gl.viewport(0, 0, canvas.width, canvas.height); gl.clearColor(0.42, 0.46, 0.5, 1); gl.clear(gl.COLOR_BUFFER_BIT);
  const g = geomOf(faceScene && MF.scenes[faceScene] ? faceScene : 'main'); setGlobalUniforms(g, t, st);
  if (S.fade < 1 && S.fadeFrom) {
    const gf = geomOf(S.fadeFrom.scene === 'back' ? 'main' : S.fadeFrom.scene); setGlobalUniforms(gf, t, st);
    drawScene(S.fadeFrom.scene, S.fadeFrom.outfit, 1, gf, S.fadeFrom.scene !== 'back' && !!MF.scenes[S.fadeFrom.scene] || S.fadeFrom.scene === 'main', st);
    setGlobalUniforms(g, t, st);
    drawScene(S.scene, S.outfit, S.fade, g, !!faceScene && !!MF.scenes[faceScene], st);
  } else drawScene(S.scene, S.outfit, 1, g, !!faceScene && !!MF.scenes[faceScene], st);
}
let lastCell = 'C';

// ---------- UI: modes, chips, outfits ----------
document.querySelectorAll('.modes button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.modes button').forEach((x) => x.classList.toggle('on', x === b)); S.mode = b.dataset.mode; history.length = 0;
  if (S.mode === 'firm') act('hips'); else if (S.mode === 'normal') act('wave');
  say({ soft: 'היי, אני כאן. בקצב שלך.', normal: 'היי! מה קורה?', firm: 'טוב. מקשיבה. תדבר ברור.' }[S.mode], { soft: 'tender', normal: 'happy', firm: 'serious' }[S.mode]);
}));
document.querySelectorAll('.chips button[data-act]').forEach((b) => b.addEventListener('click', () => { act(b.dataset.act); navigator.vibrate?.(10); addLine('me', b.textContent); }));
function markPanel() { document.querySelectorAll('#outfitRow button').forEach((b) => b.classList.toggle('on', b.dataset.outfit === S.outfit)); }
function buildPanel() {
  const row = $('#outfitRow'); for (const [id, o] of Object.entries(MF.outfits)) { const b = document.createElement('button'); b.textContent = o.name; b.dataset.outfit = id; row.append(b); }
  row.addEventListener('click', (e) => { const id = e.target.dataset?.outfit; if (!id) return; setOutfit(id); setMood('happy', 2.5); quip(MF.outfits[id].name + '!', 1600); });
  $('#styleBtn').addEventListener('click', () => { const p = $('#styleBar'); p.hidden = !p.hidden; $('#styleBtn').classList.toggle('on', !p.hidden); });
  markPanel();
}

// ---------- chat ----------
const history = [];
function addLine(cls, text) { const p = document.createElement('p'); p.className = cls; p.textContent = text; log.append(p); log.scrollTop = log.scrollHeight; }
function say(text, mood = 'neutral') {
  addLine('her', text); bubble.hidden = false; bubble.textContent = text; setMood(mood, 3.5);
  const est = (text.length / 13) / (S.mode === 'firm' ? 1.1 : S.mode === 'soft' ? 0.92 : 1);
  if ($('#voice').checked && 'speechSynthesis' in window) {
    speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.lang = /[֐-׿]/.test(text) ? 'he-IL' : 'en-US';
    u.rate = S.mode === 'firm' ? 1.1 : S.mode === 'soft' ? 0.92 : 1; u.pitch = S.mode === 'firm' ? 0.85 : 1.1;
    u.onstart = () => startTalk(text, est); u.onboundary = (e) => { if (talk.active && e.charIndex != null) talk.t0 = now() - (e.charIndex / text.length) * talk.dur; };
    u.onend = u.onerror = () => { stopTalk(); bubble.hidden = true; }; speechSynthesis.speak(u);
  } else { startTalk(text, est); setTimeout(() => { stopTalk(); bubble.hidden = true; }, Math.min(7000, est * 1000 + 400)); }
}
const OFFLINE = { soft: ['אני שומעת אותך. ספר לי עוד?', 'זה נשמע חשוב. קח את הזמן.'], normal: ['חחח, אהבתי. ועוד?', 'מעניין! מה עוד עובר לך בראש?'], firm: ['לא שמעתי תירוץ. תתחיל לזוז.', 'עוד פעם. בלי להתבלבל.'] };
//ASK-START
async function ask(mode, messages) {
  const r = await fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode, messages }) });
  return r.json();
}
//ASK-END
async function send(text) {
  addLine('me', text); history.push({ role: 'user', content: text });
  const of = parseOutfit(text); if (of) { setOutfit(of); setMood('happy', 2.5); }
  const cmd = of ? null : parseCommand(text); if (cmd) act(cmd);
  setMood('neutral', 0.6);
  let out; S.thinking = true;
  try { out = await ask(S.mode, history.map((m, i) => (i === history.length - 1 && (cmd || of) ? { ...m, content: `${m.content}\n(The app already performed the action "${cmd || 'outfit ' + of}" on screen.)` } : m))); } catch { out = { offline: true }; }
  S.thinking = false;
  if (!out || out.offline || out.error) { const pool = OFFLINE[S.mode]; out = { mood: 'playful', reply: of ? 'איך זה נראה?' : cmd ? ({ flex: 'הנה, תראה!', smile: 'כזה?', turn: 'סיבוב!', wave: 'היי!', wink: 'קריצה!' }[cmd] || 'בטח!') : pool[Math.floor(Math.random() * pool.length)] }; }
  if (!cmd && !of && out.act) act(out.act);
  history.push({ role: 'assistant', content: out.reply }); say(out.reply, out.mood);
}
$('#text').addEventListener('input', () => { S.typingUntil = now() + 1.6; });
$('#form').addEventListener('submit', (e) => { e.preventDefault(); const t = $('#text').value.trim(); if (!t) return; $('#text').value = ''; send(t); });
const SR = window.SpeechRecognition || window.webkitSpeechRecognition; const mic = $('#mic');
if (!SR) mic.hidden = true; else { const rec = new SR(); rec.lang = 'he-IL'; rec.onresult = (e) => send(e.results[0][0].transcript); rec.onend = () => mic.classList.remove('rec'); mic.addEventListener('click', () => { speechSynthesis.cancel(); mic.classList.add('rec'); rec.start(); }); }

// ---------- boot ----------
(async () => {
  MF = await (await fetch(url('live/manifest.json'))).json();
  try { const o = localStorage.getItem('noa.outfit'); if (o && MF.outfits[o]) S.outfit = o; } catch {}
  buildPanel();
  const keep = loadTex('keep:' + S.outfit + '/main', baseUrl(S.outfit, 'main')); texCache.set(S.outfit + '/main', keep);
  // preload the neutral face frames so she is alive immediately
  loadTex('atlas:main:exp_neutral', url('live/' + MF.scenes.main.atlases.exp_neutral.file));
  await new Promise((r) => { const w = () => (texCache.get(S.outfit + '/main')?.ready ? r() : setTimeout(w, 30)); w(); });
  $('#loading')?.remove();
  for (const k of ['smile', 'tender', 'smirk']) if (MF.scenes.main.atlases['exp_' + k]) loadTex('atlas:main:exp_' + k, url('live/' + MF.scenes.main.atlases['exp_' + k].file));
  act('wave'); say('היי, אני נועה. תיגע בי, תדבר איתי, או תגיד "תעשי שרירים", "תחייכי", "תסתובבי" או "תלבשי בגד ים".', 'happy');
  requestAnimationFrame(frame);
})();
window.__noa = { act, say, startTalk, S, sp, slot, get MF() { return MF; }, setOutfit, showScene, texCache };

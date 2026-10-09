import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const $ = (s) => document.querySelector(s);
const canvas = $('#avatar'), stage = $('#stage'), bubble = $('#bubble'), log = $('#log');
const now = () => performance.now() / 1000;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// =====================================================================
//  Real-time 3D avatar: skinned GLB with ARKit blend shapes + visemes.
//  Everything is procedural: breathing, weight shift, saccades, blinks,
//  head/eye attention, lip-sync from text, poses by aiming arm bones,
//  turn-around, and touch that reacts to the body part you touch.
// =====================================================================
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
const scene = new THREE.Scene();
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 50);
const key = new THREE.DirectionalLight(0xfff0e0, 1.6); key.position.set(1.6, 2.6, 2.4); scene.add(key);
const rim = new THREE.DirectionalLight(0x9fc4ff, 1.1); rim.position.set(-2, 2, -2.2); scene.add(rim);
scene.add(new THREE.HemisphereLight(0xffffff, 0xb59a88, 0.7));
const fill = new THREE.DirectionalLight(0xffe6d6, 0.7); fill.position.set(-1.2, 1.2, 2.6); scene.add(fill);

function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stage); resize();

// ---------- springs ----------
class Spr {
  constructor(k = 60, d = 11, x = 0) { this.x = x; this.v = 0; this.t = x; this.k = k; this.d = d; }
  step(dt) { const a = (this.t - this.x) * this.k - this.v * this.d; this.v += a * dt; this.x += this.v * dt; return this.x; }
  kick(v) { this.v += v; }
}
class SprV {
  constructor(v, k = 50, d = 10) { this.x = v.clone(); this.v = V(0, 0, 0); this.t = v.clone(); this.k = k; this.d = d; }
  step(dt) { const a = this.t.clone().sub(this.x).multiplyScalar(this.k).addScaledVector(this.v, -this.d); this.v.addScaledVector(a, dt); this.x.addScaledVector(this.v, dt); return this.x; }
}

// ---------- avatar state ----------
let A = null;                 // loaded avatar (bones, meshes...)
const S = {
  mood: 'neutral', moodUntil: 0, mode: 'normal', speaking: false,
  ptr: { x: 0, y: 0, last: -99 }, glanceUntil: 0, glance: { x: 0, y: 0 }, nextGlance: 1,
  nextBlink: 2, blink: 0, blinkDir: 0, forceBlink: 0, wink: 0,
  pose: 'idle', poseSides: 'LR', poseUntil: 0, smileBoost: 0, laughUntil: 0, shakeUntil: 0, nodUntil: 0,
  turnTarget: 0, backUntil: 0, shrugT: 0, blush: 0, blushT: 0,
};
const sp = {
  hy: new Spr(45, 9), hp: new Spr(45, 9), hr: new Spr(45, 9),          // head yaw / pitch / roll offsets (reactions)
  ay: new Spr(30, 8), ap: new Spr(30, 8),                                // attention follow
  root: new Spr(26, 7), shrug: new Spr(70, 9), camD: new Spr(22, 8, 1.6), camY: new Spr(22, 8, 1.4),
};
const morphT = {}, morphC = {};   // target / current morph weights

// ---------- poses: directions of upper arm / forearm, in avatar space (left arm = +x side, right mirrors x) ----------
function mirror(v) { return V(-v.x, v.y, v.z); }
const POSE = {
  idle:   { U: V(0.20, -0.97, -0.02), F: V(0.10, -0.86, 0.50), fist: 0.15, cam: [1.6, 1.4] },
  flex:   { U: V(1.00, 0.10, 0.12), F: V(0.22, 1.00, 0.10), fist: 1, cam: [2.7, 1.3] },
  wave:   { U: V(0.85, 0.40, 0.12), F: V(0.20, 1.00, 0.12), fist: 0, cam: [2.2, 1.34] },
  hips:   { U: V(0.66, -0.72, -0.08), F: V(-0.55, -0.78, 0.30), fist: 0.6, cam: [2.2, 1.3] },
  serious: { U: V(0.14, -0.99, 0.0), F: V(0.05, -0.92, 0.38), fist: 0.5, cam: [1.55, 1.42] },
};
const bulge = { L: new Spr(40, 9), R: new Spr(40, 9) };
const arm = { L: { U: new SprV(POSE.idle.U, 55, 11), F: new SprV(POSE.idle.F, 55, 11), fist: new Spr(40, 9) },
              R: { U: new SprV(mirror(POSE.idle.U), 55, 11), F: new SprV(mirror(POSE.idle.F), 55, 11), fist: new Spr(40, 9) } };
function setPose(name, ms = 0, sides = 'LR') {
  S.pose = name; S.poseSides = sides; S.poseUntil = ms ? now() + ms : 0;
  for (const s of ['L', 'R']) {
    const p = sides.includes(s) ? POSE[name] : POSE.idle;
    arm[s].U.t.copy(s === 'L' ? p.U : mirror(p.U)); arm[s].F.t.copy(s === 'L' ? p.F : mirror(p.F));
    arm[s].fist.t = p.fist;
  }
  const c = POSE[name].cam; sp.camD.t = c[0]; sp.camY.t = c[1];
}

// ---------- face presets (ARKit names) ----------
const MOOD = {
  neutral:   { mouthSmile: 0.06, browInnerUp: 0.04 },
  happy:     { mouthSmileLeft: 0.45, mouthSmileRight: 0.45, cheekSquintLeft: 0.25, cheekSquintRight: 0.25, eyeSquintLeft: 0.15, eyeSquintRight: 0.15, browInnerUp: 0.1 },
  playful:   { mouthSmileLeft: 0.75, mouthSmileRight: 0.4, browOuterUpRight: 0.55, eyeSquintLeft: 0.25, cheekSquintLeft: 0.3, mouthDimpleLeft: 0.4 },
  surprised: { browInnerUp: 0.8, browOuterUpLeft: 0.8, browOuterUpRight: 0.8, eyeWideLeft: 0.7, eyeWideRight: 0.7, jawOpen: 0.3 },
  serious:   { browDownLeft: 0.55, browDownRight: 0.55, mouthPressLeft: 0.4, mouthPressRight: 0.4, eyeSquintLeft: 0.12, eyeSquintRight: 0.12 },
  sad:       { browInnerUp: 0.7, mouthFrownLeft: 0.6, mouthFrownRight: 0.6, eyeSquintLeft: 0.12, eyeSquintRight: 0.12, mouthShrugLower: 0.2 },
};
const setMood = (m, sec = 2.5) => { S.mood = m; S.moodUntil = now() + sec; };
const IDLE_MOOD = { soft: 'happy', normal: 'neutral', firm: 'serious' };

// ---------- loading ----------
const loader = new GLTFLoader();
const strip = (n) => n.replace(/^mixamorig[:_]?/i, '');
async function loadAvatar(buffer) {
  const gltf = await loader.parseAsync(buffer, '');
  if (A) { scene.remove(A.root); A.root.traverse((o) => { o.geometry?.dispose?.(); }); }
  const root = new THREE.Group(); root.add(gltf.scene); scene.add(root);
  const a = { root, model: gltf.scene, bones: {}, rest: {}, faces: [], meshes: [], skin: [] };
  gltf.scene.traverse((o) => {
    if (o.isBone) { a.bones[strip(o.name)] = o; }
    if (o.isSkinnedMesh || o.isMesh) {
      o.frustumCulled = false;
      if (/glasses/i.test(o.name)) o.visible = false;
      else a.meshes.push(o);
      if (o.morphTargetDictionary) a.faces.push(o);
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) { m.envMapIntensity = 1.0; if (/skin/i.test(m.name)) { a.skin.push(m); m.roughness = 0.62; } }
    }
  });
  for (const [n, b] of Object.entries(a.bones)) a.rest[n] = b.quaternion.clone();
  gltf.scene.updateMatrixWorld(true);
  const wp = (n) => a.bones[n].getWorldPosition(new THREE.Vector3());
  a.ipd = wp('LeftEye').distanceTo(wp('RightEye')) || 0.068;
  a.shoulderDir = {};
  for (const s of ['Left', 'Right']) a.shoulderDir[s] = wp(`${s}Arm`).sub(wp(`${s}Shoulder`)).normalize();
  A = a;
  for (const k of Object.keys(morphT)) delete morphT[k];
  setPose('idle');
  return a;
}
const b64ToBuf = (b64) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; };

// ---------- speech: text -> visemes ----------
const HE = { 'א': 'aa', 'ע': 'aa', 'ה': 'aa', 'י': 'I', 'ו': 'O', 'ב': 'PP', 'מ': 'PP', 'ם': 'PP', 'פ': 'PP', 'ף': 'FF', 'ש': 'SS', 'ס': 'SS', 'ז': 'SS', 'צ': 'SS', 'ץ': 'SS',
  'ד': 'DD', 'ת': 'DD', 'ט': 'DD', 'ל': 'DD', 'נ': 'nn', 'ן': 'nn', 'כ': 'kk', 'ך': 'kk', 'ק': 'kk', 'ג': 'kk', 'ח': 'kk', 'ר': 'RR' };
const EN = { a: 'aa', e: 'E', i: 'I', o: 'O', u: 'U', m: 'PP', b: 'PP', p: 'PP', f: 'FF', v: 'FF', s: 'SS', z: 'SS', d: 'DD', t: 'DD', l: 'DD', n: 'nn', k: 'kk', g: 'kk', c: 'kk', q: 'kk', r: 'RR', j: 'CH', h: 'aa', w: 'U', y: 'I', x: 'SS' };
const VOWELS = ['aa', 'E', 'O', 'aa', 'I'];
function visemeSeq(text) {
  const out = []; let vi = 0;
  for (const ch of text.toLowerCase()) {
    if (HE[ch]) { const v = HE[ch]; out.push({ v, w: 0.75 }); if (!['aa', 'I', 'O'].includes(v)) out.push({ v: VOWELS[vi++ % VOWELS.length], w: 0.6 }); }
    else if (EN[ch]) out.push({ v: EN[ch], w: 0.7 });
    else if (/[\s,.!?;:]/.test(ch)) out.push({ v: 'sil', w: 0.0 });
  }
  return out.length ? out : [{ v: 'sil', w: 0 }];
}
const talk = { seq: [], t0: 0, dur: 1, active: false, nextNod: 0 };
function startTalk(text, durSec) {
  talk.seq = visemeSeq(text); talk.t0 = now(); talk.dur = Math.max(0.8, durSec); talk.active = true; talk.nextNod = now();
  S.speaking = true;
}
function stopTalk() { talk.active = false; S.speaking = false; }

// ---------- actions ----------
const quip = (text, ms = 1500) => {
  if (S.speaking) return;
  bubble.hidden = false; bubble.textContent = text;
  clearTimeout(quip.t); quip.t = setTimeout(() => { if (!S.speaking) bubble.hidden = true; }, ms);
};
const ACT = {
  flex: () => { setPose('flex', 4.5); setMood('playful', 4.5); },
  flexL: () => { setPose('flex', 3.8, 'L'); setMood('playful', 3.8); },
  flexR: () => { setPose('flex', 3.8, 'R'); setMood('playful', 3.8); },
  smile: () => { S.smileBoost = now() + 4.5; setMood('happy', 4.5); },
  laugh: () => { S.laughUntil = now() + 3.6; setMood('happy', 3.6); },
  wave: () => { setPose('wave', 3.6, 'R'); setMood('happy', 3.6); },
  hips: () => { setPose('hips', 4.2); setMood('serious', 4.2); },
  serious: () => { setPose('serious', 4.2); setMood('serious', 4.2); },
  turn: () => { S.turnTarget = Math.PI; S.backUntil = now() + 6.5; sp.root.t = Math.PI; },
  front: () => { S.turnTarget = 0; S.backUntil = 0; sp.root.t = Math.round(sp.root.x / (2 * Math.PI)) * 2 * Math.PI; },
  spin: () => { sp.root.t = sp.root.x + 2 * Math.PI; setMood('happy', 2.5); },
  wink: () => { S.wink = 1; setMood('playful', 1.3); },
  blink: () => { S.forceBlink = 1; },
  surprised: () => setMood('surprised', 2.4),
  sad: () => setMood('sad', 3.2),
  tilt: () => { sp.hr.t = 0.28; setTimeout(() => (sp.hr.t = 0), 2200); setMood('playful', 2.2); },
  hair: () => { S.shakeUntil = now() + 1.0; sp.hr.kick(3); setMood('playful', 1.8); },
  shake: () => { S.shakeUntil = now() + 1.5; },
  nod: () => { S.nodUntil = now() + 1.5; setMood('happy', 1.5); },
  lookL: () => { S.glance = { x: -1, y: 0 }; S.glanceUntil = now() + 2.2; },
  lookR: () => { S.glance = { x: 1, y: 0 }; S.glanceUntil = now() + 2.2; },
  lookU: () => { S.glance = { x: 0, y: 1 }; S.glanceUntil = now() + 2.2; },
  lookD: () => { S.glance = { x: 0, y: -1 }; S.glanceUntil = now() + 2.2; },
  lookAtMe: () => { S.glance = { x: 0, y: 0 }; S.glanceUntil = now() + 2.5; },
};
const act = (n) => (ACT[n] ? (ACT[n](), true) : false);
const CMDS = [
  [/תסתובבי חזרה|תחזרי|פני אלי|תסתכלי עלי|תסתכלי אלי|turn back|face me|come back/, 'front'],
  [/סביב עצמך|spin|360/, 'spin'],
  [/תסתובבי|סיבוב|תסתובב|turn around|show me your back/, 'turn'],
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

// ---------- touch: raycast the body, work out which part you touched ----------
const ray = new THREE.Raycaster();
function worldPos(n) { return A.bones[n].getWorldPosition(new THREE.Vector3()); }
function segDist(p, a, b) { const ab = b.clone().sub(a), t = clamp(p.clone().sub(a).dot(ab) / ab.lengthSq(), 0, 1); return p.distanceTo(a.clone().addScaledVector(ab, t)); }
function regionOf(hit) {
  const name = hit.object.name, p = hit.point;
  if (/high-poly|Eye/i.test(name)) return { r: 'eyes', sx: p.x >= 0 ? 1 : -1 };
  if (/teeth|tongue/i.test(name)) return { r: 'mouth', sx: 0 };
  if (/hair|ponytail/i.test(name)) return { r: 'hair', sx: p.x >= 0 ? 1 : -1 };
  // head frame in eye-distance units (eyes are the origin; x to her left, y downward)
  const eL = worldPos('LeftEye'), eR = worldPos('RightEye'), mid = eL.clone().add(eR).multiplyScalar(0.5);
  const right = eL.clone().sub(eR).normalize(), up = mid.clone().sub(worldPos('Head')).normalize();
  const v = p.clone().sub(mid), x = v.dot(right) / A.ipd, y = -v.dot(up) / A.ipd, ax = Math.abs(x), sx = x < 0 ? -1 : 1;
  if (p.y > worldPos('Neck').y + 0.01 && y < 2.4) {
    if (ax >= 1.35) return { r: 'hair', sx };
    if (y < -0.55) return { r: 'forehead', sx };
    if (y < 0.3 && ax < 0.95) return { r: 'eyes', sx };
    if (y < 1.0 && ax < 0.4) return { r: 'nose', sx };
    if (y < 1.0) return { r: 'cheek', sx };
    if (y < 1.5) return ax < 0.85 ? { r: 'mouth', sx } : { r: 'cheek', sx };
    return { r: 'chin', sx };
  }
  const segs = [['arm', 1, 'LeftArm', 'LeftForeArm'], ['arm', 1, 'LeftForeArm', 'LeftHand'], ['arm', -1, 'RightArm', 'RightForeArm'], ['arm', -1, 'RightForeArm', 'RightHand'],
    ['shoulder', 1, 'LeftShoulder', 'LeftArm'], ['shoulder', -1, 'RightShoulder', 'RightArm'], ['neck', 0, 'Neck', 'Head'], ['torso', 0, 'Hips', 'Spine2'], ['torso', 0, 'Spine2', 'Neck']];
  let best = { d: 9, r: 'torso', sx: 0 };
  for (const [r, sx, a, b] of segs) { if (!A.bones[a] || !A.bones[b]) continue; const d = segDist(p, worldPos(a), worldPos(b)); if (d < best.d) best = { d, r, sx }; }
  if (/Bottom|Footwear|casualsuit/i.test(name) && p.y < worldPos('Hips').y) return { r: 'legs', sx: 0 };
  return { r: best.r, sx: best.sx };
}
function react({ r, sx }) {
  const n = now();
  switch (r) {
    case 'forehead': setMood('surprised', 0.9); sp.hp.kick(-2.2); S.glance = { x: 0, y: 1 }; S.glanceUntil = n + 1.2; quip('היי!'); break;
    case 'eyes': S.forceBlink = 1; setMood('playful', 1.1); sp.hp.kick(-1); quip('אוי!'); break;
    case 'nose': S.forceBlink = 1; setMood('happy', 1.4); sp.hp.kick(-3); S.blushT = 0.6; quip('בוּפּ!'); break;
    case 'cheek': setMood('happy', 1.8); sp.hr.kick(sx * 4); sp.hy.kick(sx * 3); S.blushT = 0.9; S.glance = { x: sx, y: 0 }; S.glanceUntil = n + 1.4; break;
    case 'mouth': setMood('playful', 1.6); sp.hy.kick(-(sx || 1) * 3); sp.hp.kick(2); S.blushT = 0.6; quip('חחח נו…'); break;
    case 'chin': setMood('happy', 1.5); sp.hp.kick(-2.5); break;
    case 'hair': sp.hr.kick(sx * 4); sp.hy.kick(sx * 3); setMood('playful', 1.5); break;
    case 'neck': setMood('happy', 1.5); S.shrugT = 1; setTimeout(() => (S.shrugT = 0), 700); S.blushT = 0.4; quip('מדגדג!'); break;
    case 'shoulder': S.shrugT = 1; setTimeout(() => (S.shrugT = 0), 600); setMood('happy', 1.4); S.glance = { x: sx, y: 0 }; S.glanceUntil = n + 1.3; break;
    case 'arm': act(sx > 0 ? 'flexL' : 'flexR'); quip('רוצה לראות?'); break;
    case 'torso': act('flex'); quip('חח, שרירים?'); break;
    case 'legs': setMood('playful', 1.5); S.glance = { x: 0, y: -1 }; S.glanceUntil = n + 1; quip('היי, אני כאן למעלה!'); break;
  }
}
let down = null, holdT = null;
function ndc(e) { const r = canvas.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -(((e.clientY - r.top) / r.height) * 2 - 1) }; }
function pick(e) {
  if (!A) return null;
  const p = ndc(e); ray.setFromCamera(new THREE.Vector2(p.x, p.y), camera);
  const hits = ray.intersectObjects(A.meshes.filter((m) => m.visible), false);
  return hits[0] || null;
}
stage.addEventListener('pointermove', (e) => {
  const p = ndc(e); S.ptr.x = p.x; S.ptr.y = p.y; S.ptr.last = now();
  if (!down) return;
  const dx = e.clientX - down.x, dy = e.clientY - down.y;
  if (!down.moved && Math.hypot(dx, dy) > 12) { down.moved = true; clearTimeout(holdT); }
  if (down.moved && down.body) { sp.root.t = down.rootT + dx * 0.012; S.backUntil = 0; }   // drag the body = spin her
});
stage.addEventListener('pointerdown', (e) => {
  stage.setPointerCapture(e.pointerId);
  window.DeviceOrientationEvent?.requestPermission?.().catch(() => {});
  const p = ndc(e); S.ptr.x = p.x; S.ptr.y = p.y; S.ptr.last = now();
  const hit = pick(e), reg = hit ? regionOf(hit) : null; S.lastRegion = reg ? reg.r : null;
  const headPart = reg && ['forehead', 'eyes', 'nose', 'cheek', 'mouth', 'chin', 'hair', 'neck'].includes(reg.r);
  down = { x: e.clientX, y: e.clientY, t: now(), moved: false, reg, rootT: sp.root.t, body: !headPart };
  navigator.vibrate?.(15);
  if (reg && headPart) react(reg);
  clearTimeout(holdT);
  holdT = setTimeout(() => { S.blushT = 1; setMood('happy', 3); navigator.vibrate?.(30); }, 700);
});
const release = () => {
  clearTimeout(holdT);
  if (down && !down.moved && down.reg && down.body) react(down.reg);     // body taps react on release so a drag can spin her instead
  if (down && down.moved && down.body) { S.turnTarget = sp.root.t; S.backUntil = now() + 4; }
  down = null; S.blushT = 0;
};
stage.addEventListener('pointerup', release);
stage.addEventListener('pointercancel', release);
stage.addEventListener('pointerleave', () => { if (!down) S.ptr.last = -99; });
window.addEventListener('deviceorientation', (e) => {
  if (now() - S.ptr.last < 2.5 || e.gamma == null) return;
  S.ptr.x = clamp(e.gamma / 30, -1, 1); S.ptr.y = clamp(-((e.beta || 45) - 45) / 30, -1, 1); S.ptr.last = now() - 1.9;
});

// ---------- per-frame update ----------
const qTmp = new THREE.Quaternion(), eTmp = new THREE.Euler();
function offset(name, x, y, z) {
  const b = A.bones[name]; if (!b) return;
  b.quaternion.copy(A.rest[name]).multiply(qTmp.setFromEuler(eTmp.set(x, y, z)));
}
function aim(bone, child, dirWorld) {
  const b = A.bones[bone], c = A.bones[child]; if (!b || !c) return;
  b.updateWorldMatrix(true, false); c.updateWorldMatrix(true, false);
  const cur = c.getWorldPosition(new THREE.Vector3()).sub(b.getWorldPosition(new THREE.Vector3())).normalize();
  const d = new THREE.Quaternion().setFromUnitVectors(cur, dirWorld.clone().normalize());
  const wq = b.getWorldQuaternion(new THREE.Quaternion()).premultiply(d);
  const pq = b.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
  b.quaternion.copy(wq.premultiply(pq));
  b.updateWorldMatrix(false, true);
}
const FINGERS = ['Index', 'Middle', 'Ring', 'Pinky'];
function setFingers(side, curl) {
  for (const f of FINGERS) for (let i = 1; i <= 3; i++) {
    const n = `${side}Hand${f}${i}`; const b = A.bones[n]; if (!b) continue;
    const amt = curl * (i === 1 ? 1.15 : 1.35) * (side === 'Left' ? 1 : -1);
    b.quaternion.copy(A.rest[n]).multiply(qTmp.setFromAxisAngle(V(0, 0, 1), amt));
  }
  for (let i = 1; i <= 3; i++) {
    const n = `${side}HandThumb${i}`; const b = A.bones[n]; if (!b) continue;
    b.quaternion.copy(A.rest[n]).multiply(qTmp.setFromAxisAngle(V(0, 1, 0), curl * 0.5 * (side === 'Left' ? 1 : -1)));
  }
}
function morph(n, v) { if (v > (morphT[n] || 0)) morphT[n] = v; }   // keep the strongest request this frame

let last = now();
const time0 = now();
function frame() {
  requestAnimationFrame(frame);
  const t = now(), dt = Math.min(0.05, t - last); last = t;
  if (!A) { renderer.render(scene, camera); return; }
  const tt = t - time0;

  // timers
  if (S.poseUntil && t > S.poseUntil) setPose('idle');
  if (S.backUntil && t > S.backUntil) { S.backUntil = 0; S.turnTarget = 0; sp.root.t = Math.round(sp.root.x / (2 * Math.PI)) * 2 * Math.PI; }
  if (t > S.moodUntil) S.mood = S.speaking ? 'happy' : IDLE_MOOD[S.mode];
  S.blush = lerp(S.blush, S.blushT, 1 - Math.exp(-dt * 3));

  // ---- attention: eyes lead, head follows ----
  const havePtr = t - S.ptr.last < 3;
  let gx = 0, gy = 0;
  if (t < S.glanceUntil) { gx = S.glance.x; gy = S.glance.y; }
  else if (havePtr) { gx = clamp(S.ptr.x * 1.1, -1, 1); gy = clamp((S.ptr.y - 0.3) * 1.2, -1, 1); }
  else {
    if (t > S.nextGlance) { S.glance = { x: (Math.random() - 0.5) * 1.1, y: (Math.random() - 0.5) * 0.5 }; if (Math.random() < 0.4) S.glance = { x: 0, y: 0 }; S.nextGlance = t + 0.8 + Math.random() * 2.6; }
    gx = S.glance.x; gy = S.glance.y;
  }
  const backFacing = Math.cos(sp.root.x) < 0;
  sp.ay.t = backFacing ? 0 : gx * 0.55; sp.ap.t = backFacing ? 0 : -gy * 0.3;

  // ---- blink ----
  S.nextBlink -= dt;
  if (S.nextBlink < 0) { S.blinkDir = 1; S.nextBlink = 2 + Math.random() * 4.5; if (Math.random() < 0.18) S.nextBlink = 0.25; }
  if (S.forceBlink) { S.blinkDir = 1; S.forceBlink = 0; }
  if (S.blinkDir === 1) { S.blink += dt / 0.07; if (S.blink >= 1) { S.blink = 1; S.blinkDir = -1; } }
  else if (S.blinkDir === -1) { S.blink -= dt / 0.12; if (S.blink <= 0) { S.blink = 0; S.blinkDir = 0; } }
  S.wink = Math.max(0, S.wink - dt / 0.9);

  // ---- face targets ----
  for (const k of Object.keys(morphT)) morphT[k] = 0;
  const m = MOOD[S.mood] || MOOD.neutral;
  for (const [k, v] of Object.entries(m)) morph(k, v);
  if (t < S.smileBoost) { morph('mouthSmileLeft', 0.8); morph('mouthSmileRight', 0.8); morph('cheekSquintLeft', 0.5); morph('cheekSquintRight', 0.5); morph('eyeSquintLeft', 0.3); morph('eyeSquintRight', 0.3); }
  if (t < S.laughUntil) { const l = 0.5 + 0.5 * Math.sin(t * 17); morph('jawOpen', 0.18 + 0.32 * l); morph('mouthSmileLeft', 0.95); morph('mouthSmileRight', 0.95); morph('eyeSquintLeft', 0.7); morph('eyeSquintRight', 0.7); morph('cheekSquintLeft', 0.7); morph('cheekSquintRight', 0.7); }
  morph('eyeBlinkLeft', S.blink); morph('eyeBlinkRight', Math.max(S.blink, S.wink > 0 ? 1 : 0));
  if (S.wink > 0) { morph('cheekSquintRight', 0.7); morph('mouthSmileRight', 0.8); }
  const ex = gx * 0.85, ey = gy * 0.7;
  if (!backFacing) {
    if (ex > 0) { morph('eyeLookOutLeft', ex); morph('eyeLookInRight', ex); } else { morph('eyeLookInLeft', -ex); morph('eyeLookOutRight', -ex); }
    if (ey > 0) { morph('eyeLookUpLeft', ey); morph('eyeLookUpRight', ey); } else { morph('eyeLookDownLeft', -ey); morph('eyeLookDownRight', -ey); }
  }
  // lip-sync
  let nodKick = 0;
  if (talk.active) {
    const k = (t - talk.t0) / talk.dur, i = Math.floor(k * talk.seq.length);
    if (k >= 1) stopTalk();
    else {
      const cur = talk.seq[clamp(i, 0, talk.seq.length - 1)];
      if (cur && cur.v !== 'sil') { const flutter = 0.82 + 0.18 * Math.sin(t * 31); morph('viseme_' + cur.v, cur.w * flutter); morph('jawOpen', cur.v === 'aa' ? 0.12 : 0.05); }
      else morph('viseme_sil', 0.2);
      if (cur && cur.v === 'sil' && t > talk.nextNod) { talk.nextNod = t + 0.35 + Math.random() * 0.5; nodKick = 1; }
    }
  }
  // apply morphs with smoothing
  const ks = 1 - Math.exp(-dt * 26);
  for (const mesh of A.faces) {
    const dict = mesh.morphTargetDictionary, inf = mesh.morphTargetInfluences;
    for (const name in dict) {
      const idx = dict[name], c = inf[idx], tgt = morphT[name] || 0;
      inf[idx] = c + (tgt - c) * ks;
    }
  }
  for (const mat of A.skin) mat.emissive.setRGB(0.28 * S.blush, 0.03 * S.blush, 0.06 * S.blush);

  // ---- body: breathing, weight shift, attention, reactions ----
  const breath = Math.sin(tt * 1.7), sway = Math.sin(tt * 0.45) + 0.4 * Math.sin(tt * 1.1);
  if (nodKick) sp.hp.kick(0.6);
  const nod = t < S.nodUntil ? Math.sin(tt * 9) * 0.22 : 0, shake = t < S.shakeUntil ? Math.sin(tt * 11) * 0.35 : 0;
  const idleY = Math.sin(tt * 0.7) * 0.05 + Math.sin(tt * 1.9) * 0.02, idleP = Math.sin(tt * 0.9 + 1) * 0.025, idleR = Math.sin(tt * 0.6 + 2) * 0.03;
  const yaw = sp.ay.step(dt) + sp.hy.step(dt) + idleY + shake, pitch = sp.ap.step(dt) + sp.hp.step(dt) + idleP + nod + (S.mood === 'serious' ? 0.04 : 0), roll = sp.hr.step(dt) + idleR + yaw * 0.12;
  offset('Hips', 0, 0, sway * 0.018);
  offset('Spine', breath * 0.004, yaw * 0.12, -sway * 0.012);
  offset('Spine1', breath * 0.006, yaw * 0.18, -sway * 0.008);
  offset('Spine2', breath * 0.012 + 0.01, yaw * 0.2, 0);
  offset('Neck', pitch * 0.35, yaw * 0.35, roll * 0.3);
  offset('Head', pitch * 0.65, yaw * 0.65, roll * 0.7);
  for (const s of ['Left', 'Right']) if (A.bones[`${s}Shoulder`]) A.bones[`${s}Shoulder`].quaternion.copy(A.rest[`${s}Shoulder`]);
  A.root.rotation.y = sp.root.step(dt);
  A.root.position.x = sway * 0.006; A.root.position.y = breath * 0.0015;
  A.root.updateMatrixWorld(true);

  // shrug: aim clavicles up a little, arms follow
  sp.shrug.t = S.shrugT + (S.mood === 'surprised' ? 0.6 : 0) + breath * 0.04;
  const sh = sp.shrug.step(dt), rq = A.root.getWorldQuaternion(new THREE.Quaternion());
  for (const s of ['Left', 'Right']) aim(`${s}Shoulder`, `${s}Arm`, A.shoulderDir[s].clone().add(V(0, sh * 0.5, 0)).applyQuaternion(rq));
  // arms: spring the aim directions, aim bones in world space
  for (const [side, s] of [['L', 'Left'], ['R', 'Right']]) {
    const a = arm[side];
    if (S.pose === 'wave' && side === 'R') a.F.t.set(-(0.2 + 0.55 * (0.5 + 0.5 * Math.sin(tt * 9))), 1, 0.12);
    const U = a.U.step(dt).clone().applyQuaternion(rq), F = a.F.step(dt).clone().applyQuaternion(rq);
    aim(`${s}Arm`, `${s}ForeArm`, U);
    aim(`${s}ForeArm`, `${s}Hand`, F);
    setFingers(s, a.fist.step(dt) * 1.25);
    // flexing: bicep swells (upper arm thickens, forearm counter-scaled so it stays normal)
    bulge[side].t = S.pose === 'flex' && S.poseSides.includes(side) ? 1 : 0;
    const bg = bulge[side].step(dt), u = 1 + 0.26 * bg, f = (1 + 0.12 * bg) / u;
    A.bones[`${s}Arm`]?.scale.set(u, 1, u); A.bones[`${s}ForeArm`]?.scale.set(f, 1, f);
  }

  // camera: dolly + a touch of parallax from the pointer
  const camD = sp.camD.step(dt), camY = sp.camY.step(dt);
  const px = havePtr ? S.ptr.x : 0, py = havePtr ? S.ptr.y : 0;
  camera.position.set(lerp(camera.position.x, px * 0.14, 0.05), camY + 0.14 + lerp(camera.position.y - camY - 0.14, py * 0.05, 0.05), camD);
  camera.lookAt(0, camY - 0.02, 0);
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

// ---------- modes + quick commands ----------
document.querySelectorAll('.modes button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.modes button').forEach((x) => x.classList.toggle('on', x === b));
  S.mode = b.dataset.mode;
  history.length = 0;
  if (S.mode === 'firm') act('hips'); else if (S.mode === 'normal') act('wave');
  say({ soft: 'היי, אני כאן. בקצב שלך.', normal: 'היי! מה קורה?', firm: 'טוב. מקשיבה. תדבר ברור.' }[S.mode],
    { soft: 'happy', normal: 'playful', firm: 'serious' }[S.mode]);
}));
document.querySelectorAll('.chips button').forEach((b) => b.addEventListener('click', () => { act(b.dataset.act); navigator.vibrate?.(10); addLine('me', b.textContent); }));

// ---------- chat ----------
const history = [];
function addLine(cls, text) { const p = document.createElement('p'); p.className = cls; p.textContent = text; log.append(p); log.scrollTop = log.scrollHeight; }
function say(text, mood = 'neutral') {
  addLine('her', text);
  bubble.hidden = false; bubble.textContent = text;
  setMood(mood, 3.5);
  const est = (text.length / 13) / (S.mode === 'firm' ? 1.1 : S.mode === 'soft' ? 0.92 : 1);
  if ($('#voice').checked && 'speechSynthesis' in window) {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = /[֐-׿]/.test(text) ? 'he-IL' : 'en-US';
    u.rate = S.mode === 'firm' ? 1.1 : S.mode === 'soft' ? 0.92 : 1;
    u.pitch = S.mode === 'firm' ? 0.85 : 1.1;
    u.onstart = () => startTalk(text, est);
    u.onboundary = (e) => { if (talk.active && e.charIndex != null) talk.t0 = now() - (e.charIndex / text.length) * talk.dur; };
    u.onend = u.onerror = () => { stopTalk(); bubble.hidden = true; };
    speechSynthesis.speak(u);
  } else {
    startTalk(text, est);
    setTimeout(() => { stopTalk(); bubble.hidden = true; }, Math.min(7000, est * 1000 + 400));
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
  if (cmd) act(cmd);
  setMood('neutral', 0.6);
  let out;
  try { out = await ask(S.mode, history.map((m, i) => (i === history.length - 1 && cmd ? { ...m, content: `${m.content}\n(The app already performed the action "${cmd}" on screen.)` } : m))); } catch { out = { offline: true }; }
  if (!out || out.offline || out.error) {
    const pool = OFFLINE[S.mode];
    out = { mood: 'playful', reply: cmd ? ({ flex: 'הנה, תראה!', smile: 'כזה?', turn: 'סיבוב!', wave: 'היי!', wink: 'קריצה!' }[cmd] || 'בטח!') : pool[Math.floor(Math.random() * pool.length)] };
  }
  if (!cmd && out.act) act(out.act);
  history.push({ role: 'assistant', content: out.reply });
  say(out.reply, out.mood);
}
$('#form').addEventListener('submit', (e) => { e.preventDefault(); const t = $('#text').value.trim(); if (!t) return; $('#text').value = ''; send(t); });

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

// ---------- your own avatar (GLB with ARKit blend shapes, e.g. Ready Player Me / Avaturn) ----------
const idb = {
  open: () => new Promise((res, rej) => { const r = indexedDB.open('noa', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }),
  async get(k) { const db = await this.open(); return new Promise((res) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(null); }); },
  async set(k, v) { const db = await this.open(); return new Promise((res) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); tx.oncomplete = () => res(); tx.onerror = () => res(); }); },
  async del(k) { const db = await this.open(); return new Promise((res) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').delete(k); tx.oncomplete = () => res(); tx.onerror = () => res(); }); },
};
const fileIn = $('#glb');
$('#loadAvatar').addEventListener('click', () => fileIn.click());
fileIn.addEventListener('change', async () => {
  const f = fileIn.files[0]; if (!f) return;
  try { const buf = await f.arrayBuffer(); await loadAvatar(buf); try { await idb.set('avatar', buf); } catch {} quip('האווטאר נטען!', 2000); }
  catch (e) { quip('הקובץ לא נטען. צריך GLB עם שלד והבעות פנים.', 3500); }
  fileIn.value = '';
});
async function defaultBuffer() { return DEFAULT_GLB ? b64ToBuf(DEFAULT_GLB()) : (await fetch('models/noa.glb')).arrayBuffer(); }
$('#resetAvatar').addEventListener('click', async () => { try { await idb.del('avatar'); } catch {} await loadAvatar(await defaultBuffer()); quip('חזרתי לדמות ברירת המחדל', 2000); });

//GLB-START
const DEFAULT_GLB = null;
//GLB-END
async function boot() {
  let buf = null;
  try { buf = await idb.get('avatar'); } catch {}
  try { await loadAvatar(buf || (await defaultBuffer())); }
  catch (e) { console.error(e); await loadAvatar(await defaultBuffer()); }
  $('#loading')?.remove();
  act('wave');
  say('היי, אני נועה. תיגע בי, גרור אותי לסיבוב, או תגיד "תעשי שרירים", "תחייכי" או "תסתובבי".', 'happy');
}
window.__noa = { act, S, sp, get A() { return A; }, setPose };
boot();

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
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 50);
const key = new THREE.DirectionalLight(0xfff0e0, 1.6); key.position.set(1.4, 1.9, 2.7); scene.add(key);
key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0004; key.shadow.normalBias = 0.012; key.shadow.radius = 4;
Object.assign(key.shadow.camera, { left: -1.1, right: 1.1, top: 2.0, bottom: 0.2, near: 0.5, far: 8 });
const rim = new THREE.DirectionalLight(0x9fc4ff, 1.1); rim.position.set(-2, 2, -2.2); scene.add(rim);
scene.add(new THREE.HemisphereLight(0xffffff, 0xb59a88, 0.7));
const fill = new THREE.DirectionalLight(0xffe6d6, 0.7); fill.position.set(-1.2, 1.2, 2.6); scene.add(fill);

const quality = { dpr: Math.min(devicePixelRatio || 1, navigator.maxTouchPoints > 1 ? 1.75 : 2), acc: 0, n: 0 };
if (navigator.maxTouchPoints > 1) key.shadow.mapSize.set(1024, 1024);
function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setPixelRatio(quality.dpr); renderer.setSize(w, h, false);
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
  turnTarget: 0, backUntil: 0, shrugT: 0, blush: 0, blushT: 0, muscle: 0.6, outfit: 'gym', thinking: false, typingUntil: 0, nextNodL: 0, listening: false, nextGesture: 14, nextBeat: 0, beatSide: 'R', hairColor: 0x1d120d, hairLen: 0.42,
};
const sp = {
  hy: new Spr(45, 9), hp: new Spr(45, 9), hr: new Spr(45, 9),          // head yaw / pitch / roll offsets (reactions)
  ay: new Spr(30, 8), ap: new Spr(30, 8),                                // attention follow
  root: new Spr(26, 7), shrug: new Spr(70, 9), camD: new Spr(22, 8, 1.6), camY: new Spr(22, 8, 1.4),
};
const hairSim = { sx: new Spr(38, 4.2), sz: new Spr(38, 4.2), prevYaw: 0, prevPitch: 0, prevRoot: 0, yawV: 0, pitchV: 0, rootV: 0 };
const morphT = {}, morphC = {};   // target / current morph weights

// ---------- poses: directions of upper arm / forearm, in avatar space (left arm = +x side, right mirrors x) ----------
function mirror(v) { return V(-v.x, v.y, v.z); }
const POSE = {
  idle:   { U: V(0.20, -0.97, -0.02), F: V(0.10, -0.86, 0.50), fist: 0.15, cam: [1.6, 1.4] },
  flex:   { U: V(1.00, 0.10, 0.12), F: V(0.22, 1.00, 0.10), fist: 1, cam: [2.7, 1.3] },
  wave:   { U: V(0.85, 0.40, 0.12), F: V(0.20, 1.00, 0.12), fist: 0, cam: [2.2, 1.34] },
  hips:   { U: V(0.66, -0.72, -0.08), F: V(-0.55, -0.78, 0.30), fist: 0.6, cam: [2.2, 1.3] },
  serious: { U: V(0.14, -0.99, 0.0), F: V(0.05, -0.92, 0.38), fist: 0.5, cam: [1.55, 1.42] },
  think:   { U: V(0.25, -0.55, 0.8), F: V(-0.6, 0.78, -0.18), fist: 0.5, cam: [1.55, 1.42] },
  hairtouch: { U: V(0.55, 0.55, 0.25), F: V(-0.95, 0.25, -0.1), fist: 0.1, cam: [1.55, 1.44] },
  stretch: { U: V(0.28, 1.0, 0.0), F: V(0.12, 1.0, 0.0), fist: 0.1, cam: [2.4, 1.45] },
  beat:    { U: V(0.22, -0.75, 0.38), F: V(0.1, -0.12, 0.95), fist: 0.25, cam: [1.6, 1.4] },
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


// ---------- skin: physical material + procedural abs definition ----------
const ABS_FS = `
varying vec3 vRestS, vBX, vBY; uniform float uMuscle;
float groove(float d, float w){ return exp(-d * d / (w * w)); }
float absH(vec2 p){
  float ax = abs(p.x), cap = 1.0 - smoothstep(0.045, 0.07, ax);
  float h = groove(p.x, 0.0042) * (1.0 - smoothstep(1.075, 1.095, p.y)) * smoothstep(1.075, 1.0, 2.0 * 1.075 - p.y) * 0.0 ;
  float line = groove(p.x, 0.0045) * smoothstep(1.075, 1.1, p.y) * (1.0 - smoothstep(1.245, 1.27, p.y));
  float rows = 0.0;
  for (int r = 0; r < 3; r++) rows += groove(p.y - (1.2 - float(r) * 0.044 + 0.021), 0.0045);
  rows *= cap * smoothstep(1.07, 1.1, p.y) * (1.0 - smoothstep(1.25, 1.27, p.y));
  float obl = (groove(ax - 0.074, 0.006) + 0.7 * groove(ax - 0.1, 0.006)) * smoothstep(1.1, 1.14, p.y) * (1.0 - smoothstep(1.24, 1.28, p.y));
  return -(line + rows + obl * 0.8); }
float absMask(vec3 r){ return smoothstep(1.02, 1.06, r.y) * (1.0 - smoothstep(1.27, 1.31, r.y)) * (1.0 - smoothstep(0.1, 0.13, abs(r.x))) * step(0.03, r.z); }`;
function makeSkin(src, a, color) {
  const m = new THREE.MeshPhysicalMaterial({ color: color || 0xffffff, map: src.map, normalMap: src.normalMap, roughness: 0.55, metalness: 0, sheen: 0.5, sheenColor: new THREE.Color(0xff9a80), sheenRoughness: 0.5, clearcoat: 0.12, clearcoatRoughness: 0.4, name: src.name });
  const u = { uMuscle: { value: 0.6 } }; m.userData.u = u;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uMuscle = u.uMuscle;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vRestS, vBX, vBY;').replace('#include <begin_vertex>', '#include <begin_vertex>\n  vRestS = position; vBX = normalize(normalMatrix * vec3(1.0, 0.0, 0.0)); vBY = normalize(normalMatrix * vec3(0.0, 1.0, 0.0));');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + ABS_FS)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  { float am = absMask(vRestS) * uMuscle;
    if (am > 0.01) { float e = 0.0012; float h0 = absH(vRestS.xy), hx = absH(vRestS.xy + vec2(e, 0.0)), hy = absH(vRestS.xy + vec2(0.0, e));
      vec2 gr = vec2(hx - h0, hy - h0) / e * 0.00055 * am;
      normal = normalize(normal - (vBX * gr.x + vBY * gr.y) * 9.0);
      diffuseColor.rgb *= 1.0 + 0.10 * am * h0; } }`);
  };
  return m;
}

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
      o.castShadow = o.receiveShadow = true;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) m.envMapIntensity = 1.0;
      if (!Array.isArray(o.material) && /^Human\.body$|skin|Wolf3D_(Head|Body)/i.test(o.material.name || '') && !/eye|teeth|tongue/i.test(o.name)) { o.material = makeSkin(o.material, a); a.skin.push(o.material); }
    }
  });
  const sk = a.meshes.find((m) => m.isSkinnedMesh); if (sk) { a.skeleton = sk.skeleton; a.bindMatrix = sk.bindMatrix; }
  a.photoFace = !!gltf.asset?.extras?.noaFace; a.skinColor = gltf.asset?.extras?.skinColor;
  for (const [n, b] of Object.entries(a.bones)) a.rest[n] = b.quaternion.clone();
  gltf.scene.updateMatrixWorld(true);
  const wp = (n) => a.bones[n].getWorldPosition(new THREE.Vector3());
  a.ipd = wp('LeftEye').distanceTo(wp('RightEye')) || 0.068;
  a.shoulderDir = {};
  for (const s of ['Left', 'Right']) a.shoulderDir[s] = wp(`${s}Arm`).sub(wp(`${s}Shoulder`)).normalize();
  if (a.photoFace && a.skeleton) {
    for (const m of a.meshes) if (/ponytail/i.test(m.name)) m.visible = false;
    a.hair = buildHair(a, { length: S.hairLen, color: S.hairColor }); a.model.add(a.hair);
    setupClothes(a);
  }
  A = a;
  if (a.clothes) applyOutfit(S.outfit);
  for (const k of Object.keys(morphT)) delete morphT[k];
  setPose('idle');
  return a;
}
const b64ToBuf = (b64) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; };


// ---------- long hair: procedural skinned shell (cap + curtain) with strand texture and sway ----------
const hairUniforms = { uSway: { value: new THREE.Vector3() } };
function strandTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 1024; const g = c.getContext('2d');
  const img = g.createImageData(512, 1024), d = img.data;
  const col = new Float32Array(512);
  for (let x = 0; x < 512; x++) col[x] = 0.55 + Math.random() * 0.45;
  for (let x = 0; x < 512; x++) {
    const strand = col[x] * (0.8 + 0.2 * Math.sin(x * 0.9)) * (0.85 + 0.15 * col[(x + 3) % 512]);
    const reach = 0.86 + Math.random() * 0.14;           // ragged tips
    for (let y = 0; y < 1024; y++) {
      const v = y / 1024, i = (y * 512 + x) * 4;
      const shade = strand * (0.72 + 0.28 * Math.sin(v * 38 + x * 0.21)) * (1 - 0.35 * Math.max(0, v - 0.7));
      d[i] = d[i + 1] = d[i + 2] = Math.max(0, Math.min(255, shade * 255));
      d[i + 3] = v < reach ? 255 : Math.max(0, 255 * (1 - (v - reach) / (1 - reach + 1e-4) * 3));
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.flipY = false; t.anisotropy = 8; return t;
}
let strandTex = null;
function buildHair(a, opts = {}) {
  const { length = 0.42, color = 0x1d120d } = opts;
  const C = V(0, 1.665, 0.06), R = V(0.103, 0.114, 0.122);
  const NP = 96, NC = 16, NK = 26;                    // columns, cap rows, curtain rows
  const pos = [], uv = [], idx = [], skinI = [], skinW = [], ah = [];
  const bi = (n) => a.skeleton.bones.indexOf(a.bones[n]);
  const bHead = bi('Head'), bNeck = bi('Neck'), bSpine = bi('Spine2');
  const sstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  const rows = NC + NK + 1;
  for (let j = 0; j < rows; j++) for (let i = 0; i <= NP; i++) {
    const phi = (i / NP) * Math.PI * 2 - Math.PI, t = Math.abs(phi);
    const thHL = (50 + 45 * sstep(0.2, 1.3, t) + 45 * sstep(1.3, 2.0, t)) * Math.PI / 180;
    let p, h = 0;
    if (j <= NC) {                                     // cap: crown -> hairline
      const th = (j / NC) * thHL, k = 1.035 + 0.05 * Math.sin(th);
      p = V(R.x * k * Math.sin(th) * Math.sin(phi), R.y * k * Math.cos(th), R.z * k * Math.sin(th) * Math.cos(phi));
      p.add(C);
    } else {                                           // curtain: hairline -> tip (only behind / beside the face)
      const e = V(R.x * 1.06 * Math.sin(thHL) * Math.sin(phi), R.y * 1.06 * Math.cos(thHL), R.z * 1.06 * Math.sin(thHL) * Math.cos(phi)).add(C);
      const open = sstep(1.5, 2.2, t);               // 0 in front (face opening) -> 1 at the back
      const kk = (j - NC) / NK; h = kk;
      const yTip = e.y - length * (0.16 + 0.84 * open), y = lerp(e.y, yTip, kk);
      const f = sstep(0, 1, kk);
      const W = lerp(0.088, 0.124, f), Dz = lerp(0.098, 0.114, f), zc = lerp(0.045, -0.04, sstep(0, 0.55, kk));
      const x = W * Math.sin(phi), z = zc + Dz * Math.cos(phi);
      const blend = sstep(0, 0.3, kk);
      p = V(lerp(e.x, x, blend), y, lerp(e.z, z, blend));
    }
    pos.push(p.x, p.y, p.z); uv.push(i / NP * 3, j <= NC ? (j / NC) * 0.12 : 0.12 + 0.88 * ((j - NC) / NK)); ah.push(h);
    const wh = j <= NC ? 1 : 1 - 0.85 * sstep(0, 0.85, h);
    const rest = 1 - wh;
    skinI.push(bHead, bNeck, bSpine, 0); skinW.push(wh, rest * 0.4, rest * 0.6, 0);
  }
  for (let j = 0; j < rows - 1; j++) for (let i = 0; i < NP; i++) {
    const a0 = j * (NP + 1) + i, a1 = a0 + 1, b0 = a0 + NP + 1, b1 = b0 + 1; idx.push(a0, b0, a1, a1, b0, b1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinI, 4)); geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinW, 4));
  geo.setAttribute('aH', new THREE.Float32BufferAttribute(ah, 1)); geo.setIndex(idx); geo.computeVertexNormals();
  strandTex ||= strandTexture();
  const mat = new THREE.MeshPhysicalMaterial({ color, map: strandTex, roughness: 0.42, metalness: 0, sheen: 0.6, sheenColor: new THREE.Color(0x6b4a3a), sheenRoughness: 0.4, side: THREE.DoubleSide, alphaTest: 0.4, alphaToCoverage: true, envMapIntensity: 1.2 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uSway = hairUniforms.uSway;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aH;\nuniform vec3 uSway;')
      .replace('#include <skinning_vertex>', '#include <skinning_vertex>\n  transformed += uSway * (aH * aH);');
  };
  const mesh = new THREE.SkinnedMesh(geo, mat); mesh.frustumCulled = false; mesh.name = 'LongHair';
  mesh.bind(a.skeleton, a.bindMatrix);
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}


// ---------- outfits: the suit mesh is split into top + bottom, cut / coloured / patterned in the shader ----------
const OUTFITS = {
  casual:  { name: 'יומיומי', top: { c1: '#d8588e', y: [1.03, 9], sleeve: 0.3, rough: 0.8 }, bottom: { c1: '#26324a', y: [0, 0.99], rough: 0.75 } },
  gym:     { name: 'כושר', top: { c1: '#ff2f92', c2: '#7a3cff', pat: 2, y: [1.2, 9], arm: 1, sleeve: 0.19, trim: '#ffffff', tw: 0.008, rough: 0.55, sheen: 0.4 }, bottom: { c1: '#0e0e14', c2: '#1f1f2c', y: [0, 0.99], pat: 2, trim: '#ff2f92', tw: 0.009, rough: 0.32, sheen: 0.5 } },
  run:     { name: 'ריצה', top: { c1: '#13e0c8', c2: '#0aa3d8', pat: 2, y: [1.27, 9], arm: 1, sleeve: 0.19, scoop: [1.4, 0.1, 18], trim: '#ffffff', tw: 0.007, rough: 0.5, sheen: 0.4 }, bottom: { c1: '#101018', y: [0.7, 0.99], trim: '#13e0c8', tw: 0.012, rough: 0.35, sheen: 0.5 } },
  beach:   { name: 'חוף', top: { c1: '#ff7a59', c2: '#ffd23f', c3: '#12b5a6', pat: 3, patScale: 24, y: [1.25, 1.4], sleeve: 0.172, trim: '#fff1c9', tw: 0.006, rough: 0.35, sheen: 0.3 }, bottom: { c1: '#0fb5ae', c2: '#ffd23f', c3: '#ff6b6b', pat: 3, patScale: 20, y: [0.66, 0.99], trim: '#fff1c9', tw: 0.01, rough: 0.5 } },
  tropic:  { name: 'טרופי', top: { c1: '#ffcf4a', c2: '#c98a0a', pat: 4, patScale: 160, y: [1.26, 1.44], sleeve: 0.17, scoop: [1.38, 0.12, 14], trim: '#fff6d0', tw: 0.006, rough: 0.28, metal: 0.65 }, bottom: { c1: '#00c2b8', c2: '#7affc9', pat: 4, patScale: 110, y: [0.85, 0.99], trim: '#ffcf4a', tw: 0.012, rough: 0.3, metal: 0.4 } },
  evening: { name: 'ערב', top: { c1: '#16121c', c2: '#3a1b4d', pat: 2, y: [1.03, 9], sleeve: 0.3, scoop: [1.36, 0.12, 12], trim: '#c9a24a', tw: 0.007, rough: 0.28, sheen: 0.6 }, bottom: { c1: '#16121c', c2: '#2c1c3a', pat: 2, y: [0, 0.99], rough: 0.28, sheen: 0.6 } },
};
const PATCH_FS_HEAD = `
varying vec3 vRest; uniform vec4 uClip, uArm, uPat, uScoop; uniform vec3 uC1, uC2, uC3, uTrim;
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }`;
function clothMaterial(src) {
  const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, normalMap: src.normalMap, roughness: 0.7, metalness: 0, side: THREE.DoubleSide, sheen: 0, sheenColor: new THREE.Color(0xffffff), sheenRoughness: 0.5 });
  if (m.normalMap) m.normalScale.set(1.2, 1.2);
  const u = { uClip: { value: new THREE.Vector4(0, 9, 9, 0) }, uArm: { value: new THREE.Vector4(-1, 0.16, 1.40, 1.27) }, uPat: { value: new THREE.Vector4(0, 20, 0, 0) },
    uScoop: { value: new THREE.Vector4(9, 0, 0, 0) }, uC1: { value: new THREE.Color() }, uC2: { value: new THREE.Color() }, uC3: { value: new THREE.Color() }, uTrim: { value: new THREE.Color() } };
  m.userData.u = u;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vRest;').replace('#include <begin_vertex>', '#include <begin_vertex>\n  vRest = position; transformed += normalize(objectNormal) * 0.0035;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + PATCH_FS_HEAD)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
  { float ax = abs(vRest.x);
    if (vRest.y < uClip.x || vRest.y > uClip.y || ax > uClip.z) discard;
    if (uArm.x > 0.0 && ax > uArm.x + (uArm.y - uArm.x) * smoothstep(uArm.z, uArm.w, vRest.y)) discard;
    if (uScoop.x < 5.0 && ax < uScoop.y && vRest.y > uScoop.x + uScoop.z * ax * ax) discard; }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
  { vec3 base = uC1; float pt = uPat.x;
    if (pt > 0.5 && pt < 1.5) { base = mix(uC1, uC2, step(0.5, fract(vRest.y * uPat.y))); }
    else if (pt > 1.5 && pt < 2.5) { base = mix(uC1, uC2, smoothstep(uClip.x, min(uClip.y, uClip.x + 0.3), vRest.y) * 0.9 + 0.1 * vn(vRest.xy * 40.0)); }
    else if (pt > 2.5 && pt < 3.5) { float n1 = vn(vRest.xy * uPat.y), n2 = vn(vRest.xy * uPat.y * 2.1 + 7.0);
      base = mix(uC1, uC2, smoothstep(0.42, 0.6, n1)); base = mix(base, uC3, smoothstep(0.55, 0.68, n2) * 0.85); }
    else if (pt > 3.5) { float sp = sin((vRest.x * 0.7 + vRest.y) * uPat.y) * 0.5 + 0.5; base = mix(uC1, uC2, smoothstep(0.3, 0.8, sp) * 0.7 + 0.3 * vn(vRest.xy * 90.0)); }
    float de = min(vRest.y - uClip.x, uClip.y - vRest.y);
    float tr = (1.0 - smoothstep(uPat.z * 0.55, uPat.z, de)) * step(0.0001, uPat.z);
    base = mix(base, uTrim, tr);
    base *= mix(0.78, 1.0, smoothstep(0.0, 0.006, de));
    diffuseColor.rgb = base; }`);
  };
  return m;
}
function setupClothes(a) {
  const suit = a.meshes.find((m) => /casualsuit/i.test(m.name)); if (!suit || !suit.geometry.index) return;
  const g = suit.geometry, idx = g.index.array, pos = g.attributes.position, top = [], bot = [];
  for (let i = 0; i < idx.length; i += 3) { const y = (pos.getY(idx[i]) + pos.getY(idx[i + 1]) + pos.getY(idx[i + 2])) / 3; (y > 1.0 ? top : bot).push(idx[i], idx[i + 1], idx[i + 2]); }
  const piece = (ind) => {
    const geo = new THREE.BufferGeometry(); for (const k of Object.keys(g.attributes)) geo.setAttribute(k, g.attributes[k]); geo.setIndex(ind);
    const mesh = new THREE.SkinnedMesh(geo, clothMaterial(suit.material)); mesh.bind(suit.skeleton, suit.bindMatrix); mesh.frustumCulled = false; mesh.castShadow = mesh.receiveShadow = true; suit.parent.add(mesh); return mesh;
  };
  suit.visible = false; a.meshes = a.meshes.filter((m) => m !== suit);
  a.clothes = { top: piece(top), bottom: piece(bot) }; a.meshes.push(a.clothes.top, a.clothes.bottom);
  // the body mesh has no faces under the original clothes, so a skin-toned copy of the suit fills the gap when an outfit shows skin
  const sc = a.skinColor || [0.7, 0.5, 0.4], skinMat = makeSkin({ name: 'under' }, a, new THREE.Color().setRGB(sc[0], sc[1], sc[2], THREE.SRGBColorSpace));
  skinMat.onBeforeCompile = ((orig) => (sh) => {
    orig(sh);
    // sleeves / trouser hems are wider than the limbs: shrink them toward the limb axis so the cuff hides inside the real arm / leg
    sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
  { vec3 p = transformed; float sg = p.x < 0.0 ? -1.0 : 1.0, ax = abs(p.x);
    if (p.y > 1.15 && ax > 0.2) { vec3 A = vec3(sg * 0.126, 1.438, -0.02), B = vec3(sg * 0.281, 1.219, -0.031), ab = B - A;
      float t = clamp(dot(p - A, ab) / dot(ab, ab), 0.0, 1.3); vec3 c = A + ab * t; p = c + (p - c) * (1.0 - 0.24 * smoothstep(0.3, 0.62, t)); }
    if (p.y < 0.2) { vec3 c = vec3(sg * max(0.07, ax * 0.9), p.y, 0.0); p.xz = c.xz + (p.xz - c.xz) * (1.0 - 0.35 * smoothstep(0.2, 0.05, p.y)); }
    transformed = p - normalize(objectNormal) * 0.002; }`);
  })(skinMat.onBeforeCompile);
  const geoAll = new THREE.BufferGeometry(); for (const k of Object.keys(g.attributes)) geoAll.setAttribute(k, g.attributes[k]); geoAll.setIndex(g.index);
  const under = new THREE.SkinnedMesh(geoAll, skinMat); under.bind(suit.skeleton, suit.bindMatrix); under.frustumCulled = false; under.castShadow = under.receiveShadow = true; suit.parent.add(under);
  a.under = under; a.skin.push(skinMat);
}
function applyOutfit(name) {
  if (!A || !A.clothes) return; const o = OUTFITS[name]; if (!o) return; S.outfit = name;
  for (const part of ['top', 'bottom']) {
    const d = o[part], m = A.clothes[part].material, u = m.userData.u;
    u.uClip.value.set(d.y[0], d.y[1], d.sleeve ?? 9, 0);
    u.uArm.value.set(d.arm ? 0.115 : -1, 0.16, 1.40, 1.27);
    u.uPat.value.set(d.pat ?? 0, d.patScale ?? 14, d.tw ?? 0, 0);
    u.uScoop.value.set(...(d.scoop ? [d.scoop[0], d.scoop[1], d.scoop[2], 0] : [9, 0, 0, 0]));
    u.uC1.value.set(d.c1); u.uC2.value.set(d.c2 || d.c1); u.uC3.value.set(d.c3 || d.c1); u.uTrim.value.set(d.trim || d.c1);
    m.roughness = d.rough ?? 0.7; m.metalness = d.metal ?? 0; m.sheen = d.sheen ?? 0; m.needsUpdate = true;
  }
}


// ---------- style panel: outfits, hair, muscle (remembered on this device) ----------
const HAIR_COLORS = [['#0f0b09', 'שחור'], ['#1d120d', 'חום כהה'], ['#3a2214', 'ערמוני'], ['#5a2412', 'ג׳ינג׳י'], ['#b88a4a', 'בלונד'], ['#c2336f', 'ורוד']];
const HAIR_LENS = [['ארוך', 0.42], ['בינוני', 0.26], ['קצר', 0.1]];
function setHair() {
  if (!A || !A.photoFace || !A.skeleton) return;
  if (A.hair) { A.model.remove(A.hair); A.hair.geometry.dispose(); }
  A.hair = buildHair(A, { length: S.hairLen, color: S.hairColor }); A.model.add(A.hair);
}
function saveStyle() { try { localStorage.setItem('noa.style', JSON.stringify({ o: S.outfit, hl: S.hairLen, hc: S.hairColor, m: S.muscle })); } catch {} }
function markPanel() {
  document.querySelectorAll('#outfitRow button').forEach((b) => b.classList.toggle('on', b.dataset.outfit === S.outfit));
  document.querySelectorAll('#hairLen button').forEach((b) => b.classList.toggle('on', +b.dataset.len === S.hairLen));
  document.querySelectorAll('#hairCol button').forEach((b) => b.classList.toggle('on', b.dataset.col === S.hairColor));
  $('#muscle').value = Math.round(S.muscle * 100);
}
function buildPanel() {
  const outfitRow = $('#outfitRow'), hairLen = $('#hairLen'), hairCol = $('#hairCol');
  for (const [k, o] of Object.entries(OUTFITS)) { const b = document.createElement('button'); b.textContent = o.name; b.dataset.outfit = k; outfitRow.append(b); }
  for (const [n, l] of HAIR_LENS) { const b = document.createElement('button'); b.textContent = n; b.dataset.len = l; hairLen.append(b); }
  for (const [c, n] of HAIR_COLORS) { const b = document.createElement('button'); b.className = 'sw'; b.title = n; b.dataset.col = c; b.style.background = c; hairCol.append(b); }
  outfitRow.addEventListener('click', (e) => { const k = e.target.dataset?.outfit; if (!k) return; applyOutfit(k); S.outfit = k; saveStyle(); markPanel(); setMood('happy', 2); S.glance = { x: 0, y: -0.5 }; S.glanceUntil = now() + 1; act('turn'); setTimeout(() => act('front'), 2300); });
  hairLen.addEventListener('click', (e) => { const l = +e.target.dataset?.len; if (!l) return; S.hairLen = l; setHair(); saveStyle(); markPanel(); act('hair'); });
  hairCol.addEventListener('click', (e) => { const c = e.target.dataset?.col; if (!c) return; S.hairColor = c; if (A?.hair) A.hair.material.color.set(c); saveStyle(); markPanel(); act('hair'); });
  $('#muscle').addEventListener('input', (e) => { S.muscle = e.target.value / 100; saveStyle(); });
  $('#styleBtn').addEventListener('click', () => { const p = $('#styleBar'); p.hidden = !p.hidden; $('#styleBtn').classList.toggle('on', !p.hidden); });
  try { const st = JSON.parse(localStorage.getItem('noa.style') || 'null'); if (st) { S.outfit = OUTFITS[st.o] ? st.o : S.outfit; S.hairLen = st.hl ?? S.hairLen; S.hairColor = st.hc ?? S.hairColor; S.muscle = st.m ?? S.muscle; } } catch {}
  markPanel();
}

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


function applyBody() {
  const m = S.muscle, B = A.bones, set = (n, x, y, z) => B[n] && B[n].scale.set(x, y, z);
  for (const [side, s] of [['L', 'Left'], ['R', 'Right']]) {
    const bg = bulge[side].x, u = 1 + 0.32 * m + 0.26 * bg, f = (1 + 0.17 * m + 0.12 * bg) / u, ul = 1 + 0.22 * m, ll = (1 + 0.12 * m) / ul;
    set(`${s}Arm`, u, 1, u); set(`${s}ForeArm`, f, 1, f); set(`${s}UpLeg`, ul, 1, ul); set(`${s}Leg`, ll, 1, ll);
  }
  const w = 1 - 0.07 * m, c = 1 + 0.11 * m;
  set('Spine', w, 1, 1); set('Spine1', 1 / w, 1, 1); set('Spine2', c, 1, 1); set('Neck', 1 / c, 1, 1);
  set('LeftShoulder', 1, 1 / c, 1); set('RightShoulder', 1, 1 / c, 1);
  for (const sk of A.skin) if (sk.userData.u) sk.userData.u.uMuscle.value = m * 1.25;
}

let last = now();
const time0 = now();
function frame() {
  requestAnimationFrame(frame);
  const t = now(), dt = Math.min(0.05, t - last); last = t;
  if (!A) { renderer.render(scene, camera); return; }
  // adaptive quality: slow devices drop resolution, then shadows
  quality.acc += dt; quality.n++;
  if (quality.n === 120) { const avg = quality.acc / quality.n; quality.acc = 0; quality.n = 0;
    if (avg > 0.036) { if (quality.dpr > 1.05) { quality.dpr = Math.max(1, quality.dpr - 0.5); resize(); } else if (renderer.shadowMap.enabled) { renderer.shadowMap.enabled = false; scene.traverse((o) => { if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach((m) => (m.needsUpdate = true)); } }); } } }
  const tt = t - time0;

  // timers
  if (S.poseUntil && t > S.poseUntil) setPose('idle');
  if (S.backUntil && t > S.backUntil) { S.backUntil = 0; S.turnTarget = 0; sp.root.t = Math.round(sp.root.x / (2 * Math.PI)) * 2 * Math.PI; }
  if (t > S.moodUntil) S.mood = S.speaking ? 'happy' : IDLE_MOOD[S.mode];
  S.listening = t < S.typingUntil || mic.classList.contains('rec');
  const free = S.pose === 'idle' && !S.speaking && !S.thinking && Math.cos(sp.root.x) > 0.9 && t > S.moodUntil;
  if (S.thinking && S.pose === 'idle') setPose('think', 0, 'R');
  else if (!S.thinking && S.pose === 'think') setPose('idle');
  if (free && !S.listening && t > S.nextGesture) {
    const g = ['hairtouch', 'stretch', 'shrug', 'look', 'hairtouch'][Math.floor(Math.random() * 5)];
    if (g === 'hairtouch') { setPose('hairtouch', 2.8, Math.random() < 0.5 ? 'L' : 'R'); setMood('playful', 2.8); }
    else if (g === 'stretch') { setPose('stretch', 2.2); setMood('happy', 2.2); }
    else if (g === 'shrug') { S.shrugT = 1; setTimeout(() => (S.shrugT = 0), 600); setMood('playful', 1.6); }
    else { S.glance = { x: (Math.random() < 0.5 ? -1 : 1) * 0.9, y: 0.1 }; S.glanceUntil = t + 1.4; }
    S.nextGesture = t + 12 + Math.random() * 14;
  }
  if (talk.active && S.pose === 'idle' && t > S.nextBeat) {        // hands move while she talks
    S.beatSide = Math.random() < 0.25 ? 'LR' : (S.beatSide === 'R' ? 'L' : 'R'); setPose('beat', 0.75, S.beatSide); S.nextBeat = t + 0.9 + Math.random() * 1.3; }
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
  if (S.thinking) { if (!S.thinkG || t > S.thinkG.until) S.thinkG = { x: -0.5 - Math.random() * 0.4, y: 0.35 + Math.random() * 0.3, until: t + 1.2 + Math.random() }; gx = S.thinkG.x; gy = S.thinkG.y; }
  else if (S.listening) { gx = clamp(gx * 0.3, -0.3, 0.3); gy = clamp(gy * 0.3, -0.2, 0.2); }
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
  if (S.thinking) { morph('browInnerUp', 0.4); morph('browOuterUpRight', 0.35); morph('mouthLeft', 0.3); morph('mouthPressLeft', 0.25); morph('eyeSquintRight', 0.15); }
  else if (S.listening) { morph('mouthSmileLeft', 0.18); morph('mouthSmileRight', 0.18); morph('browInnerUp', 0.12); if (t > S.nextNodL) { S.nextNodL = t + 2.2 + Math.random() * 2; sp.hp.kick(0.9); } }
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
  const yaw = sp.ay.step(dt) + sp.hy.step(dt) + idleY + shake, pitch = sp.ap.step(dt) + sp.hp.step(dt) + idleP + nod + (S.mood === 'serious' ? 0.04 : 0), roll = sp.hr.step(dt) + idleR + yaw * 0.12 + (S.thinking ? 0.08 : 0);
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
    bulge[side].t = S.pose === 'flex' && S.poseSides.includes(side) ? 1 : 0; bulge[side].step(dt);
  }
  applyBody();

  // hair sway: lags behind head / body motion
  if (A.hair) {
    const hv = hairSim; hv.yawV = (yaw - hv.prevYaw) / dt; hv.pitchV = (pitch - hv.prevPitch) / dt; hv.rootV = (sp.root.x - hv.prevRoot) / dt;
    hv.prevYaw = yaw; hv.prevPitch = pitch; hv.prevRoot = sp.root.x;
    hv.sx.t = -hv.yawV * 0.006 - hv.rootV * 0.010 + Math.sin(tt * 1.3) * 0.0035 + roll * 0.02; hv.sz.t = hv.pitchV * 0.004 + Math.sin(tt * 0.9 + 1) * 0.0025;
    hairUniforms.uSway.value.set(clamp(hv.sx.step(dt), -0.09, 0.09), 0, clamp(hv.sz.step(dt), -0.06, 0.06));
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
  let out; S.thinking = true;
  try { out = await ask(S.mode, history.map((m, i) => (i === history.length - 1 && cmd ? { ...m, content: `${m.content}\n(The app already performed the action "${cmd}" on screen.)` } : m))); } catch { out = { offline: true }; }
  S.thinking = false;
  if (!out || out.offline || out.error) {
    const pool = OFFLINE[S.mode];
    out = { mood: 'playful', reply: cmd ? ({ flex: 'הנה, תראה!', smile: 'כזה?', turn: 'סיבוב!', wave: 'היי!', wink: 'קריצה!' }[cmd] || 'בטח!') : pool[Math.floor(Math.random() * pool.length)] };
  }
  if (!cmd && out.act) act(out.act);
  history.push({ role: 'assistant', content: out.reply });
  say(out.reply, out.mood);
}
$('#text').addEventListener('input', () => { S.typingUntil = now() + 1.6; });
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
  buildPanel();
  let buf = null;
  try { buf = await idb.get('avatar'); } catch {}
  try { await loadAvatar(buf || (await defaultBuffer())); }
  catch (e) { console.error(e); await loadAvatar(await defaultBuffer()); }
  $('#loading')?.remove();
  const adv = !!A.clothes; $('#styleBtn').hidden = !adv;
  act('wave');
  say('היי, אני נועה. תיגע בי, גרור אותי לסיבוב, או תגיד "תעשי שרירים", "תחייכי" או "תסתובבי".', 'happy');
}
window.__noa = { act, S, sp, get A() { return A; }, setPose };
boot();

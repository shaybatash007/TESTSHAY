const $ = (s) => document.querySelector(s);
const NS = 'http://www.w3.org/2000/svg';
const svg = $('#avatar'), stage = $('#stage');
const head = $('#head'), body = $('#body'), hairBackG = $('#hairBackG');
const lockL = $('#lockL'), lockR = $('#lockR'), halo = $('#halo');
const mouth = $('#mouth'), inner = $('#inner'), browL = $('#browL'), browR = $('#browR');
const eyes = [$('#eyeL'), $('#eyeR')];
const blush = [$('#blushL'), $('#blushR')];
eyes.forEach((e) => (e.style.cssText = 'transform-box:fill-box;transform-origin:center'));

// ---------- mouth / brow shapes ----------
const LIP = '#c9475f', DARK = '#4a0f1a', TONGUE = '#d0626f';
const MOUTH = {
  neutral: { d: 'M177 310 Q188 303 200 307 Q212 303 223 310 Q212 322 200 323 Q188 322 177 310Z', fill: LIP },
  happy: { d: 'M170 302 Q200 348 230 302 Q200 314 170 302Z', fill: '#7a1f30', inner: 'M177 305 Q200 326 223 305 Q200 311 177 305Z', innerFill: '#fff' },
  playful: { d: 'M174 308 Q204 340 232 298 Q205 318 174 308Z', fill: '#7a1f30' },
  surprised: { d: 'M188 304 Q200 296 212 304 Q220 326 200 334 Q180 326 188 304Z', fill: DARK, inner: 'M192 322 Q200 316 208 322 Q200 332 192 322Z', innerFill: TONGUE },
  serious: { d: 'M180 311 Q200 313 220 311 Q200 318 180 311Z', fill: LIP },
  sad: { d: 'M178 319 Q200 303 222 319 Q200 311 178 319Z', fill: LIP },
};
const OPEN = { d: 'M180 304 Q200 298 220 304 Q226 330 200 336 Q174 330 180 304Z', fill: DARK, inner: 'M190 324 Q200 317 210 324 Q200 334 190 324Z', innerFill: TONGUE };
const BROWS = {
  neutral: ['M135 202 Q160 192 185 200', 'M215 200 Q240 192 265 202'],
  happy: ['M135 196 Q160 184 185 194', 'M215 194 Q240 184 265 196'],
  playful: ['M135 202 Q160 192 185 200', 'M215 190 Q240 176 265 190'],
  surprised: ['M135 184 Q160 172 185 182', 'M215 182 Q240 172 265 184'],
  serious: ['M135 194 L185 208', 'M215 208 L265 194'],
  sad: ['M135 208 L185 196', 'M215 196 L265 208'],
};

// ---------- arms (built in JS so both sides share one definition) ----------
function buildArm(side) {
  const g = document.createElementNS(NS, 'g');
  g.innerHTML = `
    <path d="M-20 0 C-26 30 -24 62 -15 100 L15 100 C24 62 26 30 20 0Z" fill="url(#armg)"/>
    <ellipse class="bicep" cx="0" cy="42" rx="17" ry="26" fill="#f4c9a6" opacity=".35"/>
    <ellipse cx="0" cy="38" rx="6" ry="14" fill="#fff" opacity=".12"/>
    <g class="fore" transform="translate(0 100)">
      <path d="M-15 0 C-19 28 -14 62 -10 90 L10 90 C14 62 19 28 15 0Z" fill="url(#armg)"/>
      <ellipse cx="0" cy="24" rx="12" ry="22" fill="#f4c9a6" opacity=".25"/>
      <circle cx="0" cy="0" r="14" fill="#d79a74"/>
      <ellipse cx="0" cy="100" rx="15" ry="14" fill="#e3ab85"/>
      <path d="M-8 94 L-8 106 M0 92 L0 108 M8 94 L8 106" stroke="#a9673f" stroke-opacity=".4" stroke-width="2" stroke-linecap="round"/>
    </g>
    <circle cx="0" cy="2" r="27" fill="url(#armg)"/>
    <ellipse cx="-4" cy="-4" rx="10" ry="7" fill="#fff" opacity=".16"/>`;
  $('#arms').append(g);
  return { g, fore: g.querySelector('.fore'), bicep: g.querySelector('.bicep'), s: side };
}
const arms = { L: buildArm(-1), R: buildArm(1) };   // L sits on screen-left
const SHOULDER = { L: [74, 422], R: [326, 422] };

// ---------- particles ----------
const parts = Array.from({ length: 16 }, () => {
  const c = document.createElementNS(NS, 'circle');
  const p = { c, x: Math.random() * 400, y: Math.random() * 600, r: 1 + Math.random() * 2.5, v: 4 + Math.random() * 8 };
  c.setAttribute('fill', '#ffb3d6'); c.setAttribute('opacity', (0.15 + Math.random() * 0.3).toFixed(2));
  $('#particles').append(c); return p;
});

// ---------- state ----------
const state = { mood: 'neutral', moodUntil: 0, speaking: false, mode: 'normal',
  gaze: { x: 0, y: 0, tx: 0, ty: 0 }, tilt: 0, ttilt: 0, bounce: 0, blink: 0, nextBlink: 1500, blush: 0,
  wink: 0, wave: 0, lastPointer: 0, lastTap: 0 };
const spring = (k = 0.14, d = 0.78) => ({ x: 0, v: 0, t: 0, k, d, step() { this.v = (this.v + (this.t - this.x) * this.k) * this.d; this.x += this.v; return this.x; } });
const pose = { L: { a: spring(), b: spring(), f: spring(0.2, 0.7) }, R: { a: spring(), b: spring(), f: spring(0.2, 0.7) } };
const flexUntil = { L: 0, R: 0 };
const hair = { sway: 0, v: 0, prevTilt: 0, prevBounce: 0 };

const IDLE_MOOD = { soft: 'happy', normal: 'neutral', firm: 'serious' };
const BASE_ARM = { soft: [9, -3], normal: [16, -6], firm: [28, -28] };   // [shoulder out, elbow]
const setMood = (m, ms = 2500) => { state.mood = m; state.moodUntil = performance.now() + ms; };
const flex = (side, ms = 2200) => { flexUntil[side] = performance.now() + ms; };

// ---------- pointer interaction ----------
function toSVG(e) {
  const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}
function aim(e) {
  const p = toSVG(e);
  state.gaze.tx = Math.max(-1.5, Math.min(1.5, (p.x - 200) / 200));
  state.gaze.ty = Math.max(-1.5, Math.min(1.5, (p.y - 250) / 250));
  state.lastPointer = performance.now();
}
let down = null, holdTimer = null;
stage.addEventListener('pointermove', (e) => {
  aim(e);
  if (down) {
    const p = toSVG(e);
    state.ttilt = Math.max(-1, Math.min(1, (p.x - 200) / 200)) * 10;
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 12) { clearTimeout(holdTimer); setMood('playful', 800); }
  }
});
stage.addEventListener('pointerdown', (e) => {
  stage.setPointerCapture(e.pointerId);
  window.DeviceOrientationEvent?.requestPermission?.().catch(() => {});
  down = { x: e.clientX, y: e.clientY };
  aim(e);
  const p = toSVG(e), now = performance.now();
  navigator.vibrate?.(15);
  state.bounce = 1;
  if (p.y < 350 && p.x > 88 && p.x < 312) {                 // head
    if (now - state.lastTap < 380) { state.wink = 1; setMood('playful', 1400); }       // double tap = wink
    else if (p.y < 150) setMood('surprised', 900);
    else setMood(Math.random() < 0.5 ? 'happy' : 'playful', 1600);
  } else if (p.y >= 350 && (p.x <= 88 || p.x >= 312)) {      // arm -> flex that bicep
    flex(p.x < 200 ? 'L' : 'R'); setMood('playful', 2200);
  } else {                                                    // torso -> flex both, abs tense
    flex('L', 2600); flex('R', 2600); setMood('happy', 2600);
  }
  state.lastTap = now;
  clearTimeout(holdTimer);
  holdTimer = setTimeout(() => { state.blush = 1; setMood('happy', 3000); navigator.vibrate?.(30); }, 700);
});
const release = () => { down = null; state.ttilt = 0; clearTimeout(holdTimer); };
stage.addEventListener('pointerup', release);
stage.addEventListener('pointercancel', release);
stage.addEventListener('pointerleave', () => { if (!down) { state.gaze.tx = 0; state.gaze.ty = 0; } });
// phone tilt = parallax gaze when no finger has moved recently
window.addEventListener('deviceorientation', (e) => {
  if (performance.now() - state.lastPointer < 2500 || e.gamma == null) return;
  state.gaze.tx = Math.max(-1, Math.min(1, e.gamma / 30));
  state.gaze.ty = Math.max(-1, Math.min(1, ((e.beta || 45) - 45) / 30));
});

// ---------- render loop ----------
const lerp = (a, b, k) => a + (b - a) * k;
let last = performance.now();
function frame(t) {
  const dt = Math.min(50, t - last); last = t;
  if (t > state.moodUntil) state.mood = state.speaking ? 'happy' : IDLE_MOOD[state.mode];
  const g = state.gaze;
  g.x = lerp(g.x, g.tx, 0.12); g.y = lerp(g.y, g.ty, 0.12);
  state.tilt = lerp(state.tilt, state.ttilt + g.x * 3, 0.1);
  state.bounce = Math.max(0, state.bounce - dt / 400);
  state.blush = Math.max(0, state.blush - dt / 4000);
  state.wink = Math.max(0, state.wink - dt / 700);
  state.wave = Math.max(0, state.wave - dt / 2600);

  const breath = Math.sin(t / 900);
  const sway = Math.sin(t / 2600);
  const hop = Math.sin(state.bounce * Math.PI) * -10;
  const shrug = state.mood === 'surprised' ? -5 : 0;

  // body: breathing, weight shift, little lean toward the touch
  body.setAttribute('transform', `translate(${sway * 2 + g.x * 2} ${breath * 2.2 + shrug}) rotate(${sway * 0.8 + g.x * 0.8} 200 600) translate(200 480) scale(${1 + breath * 0.006} ${1 + breath * 0.01}) translate(-200 -480)`);
  const headT = `translate(${g.x * 4 + sway * 2} ${breath * 2 + hop + g.y * 2 + shrug}) rotate(${state.tilt} 200 400)`;
  head.setAttribute('transform', headT);

  // hair: spring-driven sway from head movement + bounce
  hair.v += -(state.tilt - hair.prevTilt) * 0.9 - (state.bounce - hair.prevBounce) * 6 - hair.sway * 0.07;
  hair.v *= 0.9; hair.sway += hair.v;
  hair.prevTilt = state.tilt; hair.prevBounce = state.bounce;
  const idleHair = Math.sin(t / 1700) * 0.8;
  hairBackG.setAttribute('transform', `${headT} rotate(${hair.sway + idleHair} 200 150)`);
  lockL.setAttribute('transform', `${headT} rotate(${hair.sway * 1.7 + idleHair * 1.4} 112 250)`);
  lockR.setAttribute('transform', `${headT} rotate(${hair.sway * 1.7 - idleHair * 1.4} 288 250)`);

  // arms
  const [ba, bb] = BASE_ARM[state.mode];
  for (const side of ['L', 'R']) {
    const p = pose[side], arm = arms[side];
    const flexing = t < flexUntil[side];
    const talk = state.speaking ? Math.sin(t / 260 + (side === 'L' ? 0 : 2)) : 0;
    let a = ba + Math.sin(t / 1900 + (side === 'L' ? 0 : 1.5)) * 1.5 + talk * 6 + state.bounce * 8;
    let b = bb + talk * 10;
    if (flexing) { a = 74; b = 106; }
    if (side === 'R' && state.wave > 0) { a = 150; b = -10 + Math.sin(t / 110) * 28; }   // wave hello
    p.a.t = a; p.b.t = b; p.f.t = flexing ? 1 : 0;
    const A = p.a.step(), B = p.b.step(), F = p.f.step();
    const [sx, sy] = SHOULDER[side];
    arm.g.setAttribute('transform', `translate(${sx} ${sy + breath * 2 + shrug}) rotate(${-arm.s * A}) scale(0.92)`);
    arm.fore.setAttribute('transform', `translate(0 100) rotate(${-arm.s * B})`);
    arm.bicep.setAttribute('transform', `translate(0 42) scale(${1 + F * 0.4} ${1 + F * 0.22}) translate(0 -42)`);
    arm.bicep.setAttribute('opacity', 0.35 + F * 0.3);
  }

  // eyes
  const idleX = Math.sin(t / 2300) * 0.15, idleY = Math.cos(t / 3100) * 0.08;
  document.querySelectorAll('.iris,.pupil,.glint').forEach((el) => {
    el.setAttribute('transform', `translate(${(g.x + idleX) * 7} ${(g.y + idleY) * 5})`);
  });
  state.nextBlink -= dt;
  if (state.nextBlink < 0) { state.blink = 1; state.nextBlink = 1800 + Math.random() * 3500; }
  state.blink = Math.max(0, state.blink - dt / 140);
  const lid = state.mood === 'surprised' ? 1.15 : state.mood === 'serious' ? 0.82 : 1;
  const k = Math.max(0.08, lid * (1 - Math.sin(state.blink * Math.PI)));
  eyes[0].style.transform = `scaleY(${k})`;
  eyes[1].style.transform = `scaleY(${state.wink > 0 ? 0.08 : k})`;

  // mouth
  let m = MOUTH[state.mood] || MOUTH.neutral;
  if (state.speaking && Math.sin(t / 85) + Math.sin(t / 53) > 0) m = OPEN;
  mouth.setAttribute('d', m.d); mouth.setAttribute('fill', m.fill);
  inner.setAttribute('d', m.inner || ''); inner.setAttribute('fill', m.innerFill || 'none');
  const b = BROWS[state.mood] || BROWS.neutral;
  browL.setAttribute('d', b[0]); browR.setAttribute('d', b[1]);
  blush.forEach((el) => el.setAttribute('opacity', 0.22 + state.blush * 0.5));

  // ambience
  halo.setAttribute('opacity', 0.75 + Math.sin(t / 700) * 0.1 + (state.speaking ? 0.15 : 0));
  for (const p of parts) {
    p.y -= p.v * dt / 1000; p.x += Math.sin(t / 1500 + p.r) * 0.1;
    if (p.y < -5) { p.y = 605; p.x = Math.random() * 400; }
    p.c.setAttribute('cx', p.x); p.c.setAttribute('cy', p.y); p.c.setAttribute('r', p.r);
  }
  requestAnimationFrame(frame);
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

state.wave = 1;
say('היי, אני נועה. תיגע בי, תדבר איתי, תבחר מצב למעלה.', 'happy');

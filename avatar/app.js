const $ = (s) => document.querySelector(s);
const svg = $('#avatar'), stage = $('#stage');
const head = $('#head'), body = $('#body');
const mouth = $('#mouth'), browL = $('#browL'), browR = $('#browR');
const eyes = [$('#eyeL'), $('#eyeR')];
const blush = [$('#blushL'), $('#blushR')];
eyes.forEach((e) => (e.style.cssText = 'transform-box:fill-box;transform-origin:center'));

const MOUTH = {
  neutral: 'M178 310 Q200 318 222 310 Q200 314 178 310Z',
  happy: 'M172 304 Q200 342 228 304 Q200 316 172 304Z',
  playful: 'M176 308 Q204 336 232 298 Q205 318 176 308Z',
  surprised: 'M190 305 Q200 294 210 305 Q217 328 200 332 Q183 328 190 305Z',
  serious: 'M180 312 L220 312 L220 316 L180 316Z',
  sad: 'M178 319 Q200 300 222 319 Q200 309 178 319Z',
};
const OPEN = 'M182 304 Q200 300 218 304 Q222 330 200 336 Q178 330 182 304Z';
const BROWS = {
  neutral: ['M135 202 Q160 192 185 200', 'M215 200 Q240 192 265 202'],
  happy: ['M135 196 Q160 184 185 194', 'M215 194 Q240 184 265 196'],
  playful: ['M135 202 Q160 192 185 200', 'M215 190 Q240 176 265 190'],
  surprised: ['M135 184 Q160 172 185 182', 'M215 182 Q240 172 265 184'],
  serious: ['M135 194 L185 208', 'M215 208 L265 194'],
  sad: ['M135 208 L185 196', 'M215 196 L265 208'],
};

const state = { mood: 'neutral', moodUntil: 0, speaking: false, mode: 'normal',
  gaze: { x: 0, y: 0, tx: 0, ty: 0 }, tilt: 0, ttilt: 0, bounce: 0, blink: 0, nextBlink: 1500, blush: 0 };

const IDLE_MOOD = { soft: 'happy', normal: 'neutral', firm: 'serious' };
const setMood = (m, ms = 2500) => { state.mood = m; state.moodUntil = performance.now() + ms; };

// --- pointer interaction: eyes follow, touch reacts, drag tilts the head ---
let down = null, holdTimer = null;
function local(e) {
  const r = svg.getBoundingClientRect();
  return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
}
function aim(e) {
  const p = local(e);
  state.gaze.tx = (p.x - 0.5) * 2;
  state.gaze.ty = (p.y - 0.45) * 2;
}
stage.addEventListener('pointermove', (e) => {
  aim(e);
  if (down) {
    const p = local(e);
    state.ttilt = Math.max(-1, Math.min(1, (p.x - 0.5) * 2)) * 9;
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 12) { clearTimeout(holdTimer); setMood('playful', 800); }
  }
});
stage.addEventListener('pointerdown', (e) => {
  stage.setPointerCapture(e.pointerId);
  down = { x: e.clientX, y: e.clientY };
  aim(e);
  const p = local(e);
  navigator.vibrate?.(15);
  state.bounce = 1;
  if (p.y < 0.28) setMood('surprised', 900);       // forehead / hair
  else if (p.y < 0.55) setMood(Math.random() < 0.5 ? 'happy' : 'playful', 1600); // face
  else setMood('surprised', 1000);                 // shoulders
  clearTimeout(holdTimer);
  holdTimer = setTimeout(() => { state.blush = 1; setMood('happy', 3000); navigator.vibrate?.(30); }, 700);
});
const release = () => { down = null; state.ttilt = 0; clearTimeout(holdTimer); };
stage.addEventListener('pointerup', release);
stage.addEventListener('pointercancel', release);
stage.addEventListener('pointerleave', () => { state.gaze.tx = 0; state.gaze.ty = 0; });

// --- render loop ---
const lerp = (a, b, k) => a + (b - a) * k;
let last = performance.now(), curMoodKey = '';
function frame(t) {
  const dt = t - last; last = t;
  if (t > state.moodUntil) state.mood = state.speaking ? 'happy' : IDLE_MOOD[state.mode];
  const g = state.gaze;
  g.x = lerp(g.x, g.tx, 0.12); g.y = lerp(g.y, g.ty, 0.12);
  state.tilt = lerp(state.tilt, state.ttilt + g.x * 3, 0.1);
  state.bounce = Math.max(0, state.bounce - dt / 400);
  state.blush = Math.max(0, state.blush - dt / 4000);

  // idle drift so she feels alive even untouched
  const idleX = Math.sin(t / 2300) * 0.15, idleY = Math.cos(t / 3100) * 0.08;
  const breath = Math.sin(t / 900);
  body.setAttribute('transform', `translate(0 ${breath * 2.5})`);
  const hop = Math.sin(state.bounce * Math.PI) * -10;
  head.setAttribute('transform', `translate(${g.x * 4} ${breath * 2 + hop + g.y * 2}) rotate(${state.tilt} 200 400)`);

  document.querySelectorAll('.iris,.pupil,.glint').forEach((el) => {
    el.setAttribute('transform', `translate(${(g.x + idleX) * 7} ${(g.y + idleY) * 5})`);
  });

  state.nextBlink -= dt;
  if (state.nextBlink < 0) { state.blink = 1; state.nextBlink = 1800 + Math.random() * 3500; }
  state.blink = Math.max(0, state.blink - dt / 140);
  const lid = state.mood === 'surprised' ? 1.15 : state.mood === 'serious' ? 0.8 : 1;
  const k = Math.max(0.08, lid * (1 - Math.sin(state.blink * Math.PI)));
  eyes.forEach((e) => (e.style.transform = `scaleY(${k})`));

  let m = MOUTH[state.mood] || MOUTH.neutral;
  if (state.speaking && Math.sin(t / 85) + Math.sin(t / 53) > 0) m = OPEN;
  mouth.setAttribute('d', m);
  const b = BROWS[state.mood] || BROWS.neutral;
  browL.setAttribute('d', b[0]); browR.setAttribute('d', b[1]);
  blush.forEach((el) => el.setAttribute('opacity', 0.2 + state.blush * 0.5));
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// --- modes ---
document.querySelectorAll('.modes button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.modes button').forEach((x) => x.classList.toggle('on', x === b));
  state.mode = b.dataset.mode;
  history.length = 0;
  say({ soft: 'היי, אני כאן. בקצב שלך.', normal: 'היי! מה קורה?', firm: 'טוב. מקשיבה. תדבר ברור.' }[state.mode],
    { soft: 'happy', normal: 'playful', firm: 'serious' }[state.mode]);
}));

// --- chat ---
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

// --- voice input ---
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

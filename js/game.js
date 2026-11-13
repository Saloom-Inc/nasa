/* Leave It Behind — a 2D Moon mission game
   Plain canvas + JS, no build step. */
(() => {
'use strict';

const cv = document.getElementById('game');
const ctx = cv.getContext('2d');
const $ = id => document.getElementById(id);

// ---------- constants ----------
const BASE = 420;          // ground baseline in world units
const GRAV = 470;          // lunar-feel gravity
const JUMP = 300;
const SPEED = 150;
const LM_RANGE = 80;
const PICK_RANGE = 46;
const ZONE_RANGE = 44;

// ---------- view ----------
let S = 1, VW = 960, VH = 540, DPR = 1;
function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  const w = innerWidth, h = innerHeight;
  cv.width = Math.round(w * DPR); cv.height = Math.round(h * DPR);
  cv.style.width = w + 'px'; cv.style.height = h + 'px';
  S = Math.min(h / (isTouch ? 430 : 480), w / 640) * DPR;
  VW = cv.width / S; VH = cv.height / S;
  $('rotate').classList.toggle('hidden', !(isTouch && h > w && state === 'play'));
}
const isTouch = matchMedia('(pointer:coarse)').matches || 'ontouchstart' in window;
if (isTouch) document.body.classList.add('touch');

// ---------- persistence ----------
let progress = { unlocked: 1, best: {} };
try { const p = JSON.parse(localStorage.getItem('lib-progress')); if (p && p.best) progress = p; } catch (e) {}
function save() { try { localStorage.setItem('lib-progress', JSON.stringify(progress)); } catch (e) {} }

// ---------- audio ----------
let AC = null, muted = false;
try { muted = localStorage.getItem('lib-muted') === '1'; } catch (e) {}
function ac() { if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} } return AC; }
function tone(f, d = .12, type = 'sine', v = .07, slide = 0) {
  if (muted || !ac()) return;
  const t = AC.currentTime, o = AC.createOscillator(), g = AC.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, f + slide), t + d);
  g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(.0001, t + d);
  o.connect(g).connect(AC.destination); o.start(t); o.stop(t + d + .02);
}
function noise(d = 1.5, v = .12, lp = 600) {
  if (muted || !ac()) return;
  const len = AC.sampleRate * d, b = AC.createBuffer(1, len, AC.sampleRate), ch = b.getChannelData(0);
  for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const s = AC.createBufferSource(), f = AC.createBiquadFilter(), g = AC.createGain();
  s.buffer = b; f.type = 'lowpass'; f.frequency.value = lp; g.gain.value = v;
  s.connect(f).connect(g).connect(AC.destination); s.start();
}
const sfx = {
  pick: () => { tone(520, .08, 'triangle'); tone(780, .1, 'triangle', .05); },
  drop: () => tone(220, .1, 'triangle', .06, -80),
  load: () => { tone(440, .08, 'square', .04); setTimeout(() => tone(660, .12, 'square', .04), 70); },
  deploy: () => { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, .14, 'triangle', .06), i * 80)); },
  toss: () => tone(300, .18, 'sawtooth', .03, -180),
  warn: () => tone(880, .15, 'square', .05),
  fail: () => { tone(200, .5, 'sawtooth', .06, -120); noise(1.2, .1, 300); },
  launch: () => { noise(3.2, .18, 500); tone(90, 2.5, 'sawtooth', .04, 60); },
  jump: () => tone(300, .08, 'sine', .03, 120),
};

// ---------- input ----------
const keys = {}; const pressed = {};
const KEYMAP = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'jump', KeyW: 'jump', Space: 'jump', KeyE: 'act', Enter: 'act', KeyL: 'lift', Escape: 'pause', KeyP: 'pause' };
addEventListener('keydown', e => {
  if (e.code.startsWith('Digit')) { const n = +e.code.slice(5); if (n >= 1) pressed['n' + n] = true; }
  const k = KEYMAP[e.code]; if (!k) return;
  if (state === 'play' || k === 'pause') e.preventDefault();
  if (!keys[k]) pressed[k] = true; keys[k] = true;
});
addEventListener('keyup', e => { const k = KEYMAP[e.code]; if (k) keys[k] = false; });
document.querySelectorAll('#touch button').forEach(b => {
  const k = b.dataset.k;
  const on = e => { e.preventDefault(); ac(); if (!keys[k]) pressed[k] = true; keys[k] = true; b.classList.add('on'); };
  const off = e => { e.preventDefault(); keys[k] = false; b.classList.remove('on'); };
  b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off);
  b.addEventListener('pointerleave', off); b.addEventListener('pointercancel', off);
});
function take(k) { const v = pressed[k]; pressed[k] = false; return v; }

// ---------- rng ----------
function rng(seed) { let s = seed * 9301 + 49297; return () => (s = (s * 9301 + 49297) % 233280) / 233280; }

// ---------- world ----------
let M = null;            // mission def
let G = null;            // ground samples
let items = [], marks = [], parts = [], prints = [], stars = [], hills = [];
let P = null;            // player
let o2 = 0, camX = 0, camY = 0, t = 0;
let launch = null;
let state = 'menu';
let missionIndex = 0;
let lastPrompt = '';

function buildGround(m) {
  const n = Math.ceil(m.width / 4) + 2, arr = new Float32Array(n), r = rng(m.seed);
  const p1 = r() * 6, p2 = r() * 6, p3 = r() * 6;
  for (let i = 0; i < n; i++) {
    const x = i * 4;
    let y = BASE + 9 * Math.sin(x * .0043 + p1) + 5 * Math.sin(x * .011 + p2) + 2 * Math.sin(x * .05 + p3);
    for (const c of m.craters) {
      const d = Math.abs(x - c.x), rim = c.r * .4;
      if (d < c.r) y += c.depth * (1 - (d / c.r) ** 2);
      else if (d < c.r + rim) y -= c.depth * .22 * Math.sin(Math.PI * (d - c.r) / rim);
    }
    // flatten the landing site
    const dl = Math.abs(x - m.lm);
    if (dl < 200) { const k = dl < 130 ? 1 : 1 - (dl - 130) / 70; y = y * (1 - k) + BASE * k; }
    arr[i] = y;
  }
  return arr;
}
function gy(x) {
  if (!G) return BASE;
  const f = Math.max(0, Math.min(G.length - 2, x / 4)), i = Math.floor(f), k = f - i;
  return G[i] * (1 - k) + G[i + 1] * k;
}
function makeStars() {
  const r = rng(42); stars = [];
  for (let i = 0; i < 260; i++) stars.push({ x: r() * 2400, y: r() * 900 - 360, s: r() * 1.4 + .3, a: r() * .7 + .3, tw: r() * 6 });
  hills = [];
  for (let i = 0; i < 40; i++) hills.push({ x: i * 160 + r() * 80, w: 180 + r() * 220, h: 30 + r() * 60 });
}

function startMission(i) {
  missionIndex = i; M = MISSIONS[i]; G = buildGround(M);
  items = []; parts = []; prints = [];
  for (const d of M.items) {
    const it = Object.assign({}, d, { vx: 0, vy: 0, seen: false, flying: false });
    if (d.type === 'junk') { it.state = 'cabin'; it.x = M.lm; it.y = BASE; }
    else { it.state = 'ground'; it.y = gy(it.x); }
    items.push(it);
  }
  marks = M.landmarks.map(l => Object.assign({ used: false }, l));
  P = { x: M.lm + 40, y: BASE, vx: 0, vy: 0, on: true, face: 1, carry: null, walk: 0, stepAcc: 0, inLM: false };
  o2 = M.o2; launch = null; camX = P.x - VW / 2; camY = 0; lastWarn = 999;
  $('hudMission').textContent = `${M.name} · ${M.site}`;
  setState('play');
  toast(M.name, 'Your cabin is full of gear. Collect science, set up experiments, throw out what you don\'t need, then lift off.', '', 6);
  updateHUD(true);
}

// ---------- state / screens ----------
const SCREENS = ['menu', 'select', 'intro', 'how', 'about', 'pause', 'result'];
let prevScreen = 'menu';
function show(name) {
  SCREENS.forEach(s => $(s).classList.toggle('hidden', s !== name));
}
function setState(s) {
  state = s;
  const playing = s === 'play' || s === 'launch';
  $('hud').classList.toggle('hidden', !playing && s !== 'pause');
  $('touch').classList.toggle('hidden', !(isTouch && (s === 'play' || s === 'lab')));
  if (s !== 'play' && s !== 'lab') { $('prompt').classList.add('hidden'); } if (s !== 'play') $('cabin').classList.add('hidden');
  if (s === 'play' || s === 'launch' || s === 'lab') show(null);
  resize();
}

function renderMissionList() {
  $('missionList').innerHTML = MISSIONS.map((m, i) => {
    const locked = i + 1 > progress.unlocked, st = progress.best[m.id]?.stars || 0, sc = progress.best[m.id]?.score;
    return `<button class="mcard ${locked ? 'locked' : ''}" data-i="${i}" ${locked ? 'disabled' : ''}>
      <div class="mn">MISSION 0${i + 1}</div><h3>${m.name}</h3><div class="ms">${m.site}<br>${m.date.split('·')[0]}</div>
      <div class="mst">${[1, 2, 3].map(n => `<span class="${n <= st ? '' : 'off'}">★</span>`).join('')}${sc != null ? ` <span style="font-size:12px;color:#9aa3bb;letter-spacing:0">best ${sc}</span>` : ''}</div></button>`;
  }).join('');
  $('missionList').querySelectorAll('.mcard:not(.locked)').forEach(b => b.onclick = () => openIntro(+b.dataset.i));
}
function openIntro(i) {
  const m = MISSIONS[i]; missionIndex = i; M = m; G = buildGround(m); camX = m.lm - VW / 2;
  $('introDate').textContent = m.date; $('introTitle').textContent = `${m.name}: ${m.site}`;
  $('introBrief').textContent = m.brief; $('introTip').textContent = '💡 ' + m.tip;
  const sci = m.items.filter(x => x.type === 'sci').length + m.landmarks.filter(l => l.gives).length;
  const dep = m.items.filter(x => x.type === 'deploy');
  $('introGoals').innerHTML = `
    <li><i>🪨</i>Bring ${sci} science samples back to the lander</li>
    <li><i>📡</i>Set up: ${dep.map(d => d.name).join(', ')}</li>
    <li><i>⚖️</i>Lift off under ${m.cap} units of weight</li>
    <li><i>🫁</i>${Math.floor(m.o2 / 60)}:${String(m.o2 % 60).padStart(2, '0')} of oxygen</li>`;
  prevScreen = 'select'; show('intro');
}

$('btnPlay').onclick = () => { ac(); renderMissionList(); prevScreen = 'menu'; show('select'); };
$('btnHow').onclick = () => { prevScreen = 'menu'; show('how'); };
$('btnAbout').onclick = () => { prevScreen = 'menu'; show('about'); };
document.querySelectorAll('[data-back]').forEach(b => b.onclick = () => {
  const cur = SCREENS.find(s => !$(s).classList.contains('hidden'));
  if (cur === 'intro') { renderMissionList(); show('select'); }
  else if (cur === 'how' && state === 'pause') show('pause');
  else show('menu');
});
$('btnStart').onclick = () => { ac(); startMission(missionIndex); };
$('btnPause').onclick = () => togglePause();
$('btnResume').onclick = () => togglePause();
$('btnRestart').onclick = () => startMission(missionIndex);
$('btnQuit').onclick = () => { setState('menu'); toMenu(); };
$('btnRetry').onclick = () => startMission(missionIndex);
$('btnMenu').onclick = () => { setState('menu'); toMenu('select'); };
$('btnNext').onclick = () => { if (missionIndex + 1 < MISSIONS.length) openIntro(missionIndex + 1); else { setState('menu'); toMenu('select'); } };
$('btnMute').onclick = () => { muted = !muted; $('btnMute').textContent = muted ? '🔇' : '🔊'; try { localStorage.setItem('lib-muted', muted ? '1' : '0'); } catch (e) {} };
$('btnMute').textContent = muted ? '🔇' : '🔊';
$('btnLift').onclick = () => tryLaunch();

function toMenu(screen = 'menu') {
  M = MISSIONS[0]; G = buildGround(M); P = null; items = []; marks = M.landmarks.map(l => Object.assign({ used: false }, l));
  items = M.items.filter(d => d.type !== 'junk').map(d => Object.assign({}, d, { state: 'ground', y: 0 }));
  items.forEach(i => i.y = gy(i.x));
  renderMissionList(); show(screen);
}
function togglePause() {
  if (state === 'play') { setState('pause'); show('pause'); }
  else if (state === 'pause') { setState('play'); }
}

// ---------- toast & prompt ----------
let toastTimer = 0;
function toast(title, body, cls = '', secs = 5) {
  $('toastT').textContent = title; $('toastB').textContent = body;
  const el = $('toast'); el.className = cls; el.classList.remove('hidden');
  void el.offsetWidth; toastTimer = secs;
}
function setPrompt(html) {
  if (html === lastPrompt) return; lastPrompt = html;
  const el = $('prompt'); if (!html) { el.classList.add('hidden'); return; }
  el.innerHTML = html; el.classList.remove('hidden');
}
const K = isTouch ? '<kbd>E</kbd>' : '<kbd>E</kbd>';

// ---------- cabin ----------
function cabinItems() { return items.filter(i => i.state === 'cabin'); }
function load() { return cabinItems().reduce((a, i) => a + i.u, 0); }
let cabinSig = '';
function renderCabin(force) {
  const list = cabinItems(), sig = list.map(i => i.id).join(',') + load();
  if (!force && sig === cabinSig) return; cabinSig = sig;
  const l = load();
  $('cabinLoad').textContent = `${l} / ${M.cap}`; $('cabinLoad').classList.toggle('over', l > M.cap);
  $('cabinList').innerHTML = list.length ? list.map((it, n) => `
    <div class="citem ${it.type}"><span class="k">${n < 9 ? n + 1 : ''}</span>
    <span class="n">${it.name}<small>${it.u} units${it.type === 'sci' ? ' · science' : ''}</small></span>
    <button data-id="${it.id}">Throw out</button></div>`).join('') : '<div class="cempty">Cabin is empty.</div>';
  $('cabinList').querySelectorAll('button').forEach(b => b.onclick = () => tossOut(items.find(i => i.id === b.dataset.id)));
}
function tossOut(it) {
  if (!it || it.state !== 'cabin' || state !== 'play') return;
  it.state = 'ground'; it.flying = true;
  it.x = M.lm + 18; it.y = BASE - 70; it.vx = 70 + Math.random() * 90; it.vy = -140 - Math.random() * 60;
  sfx.toss();
  if (!it.seen && it.type === 'junk') { it.seen = true; toast(`Left on the Moon: ${it.name}`, it.fact, 'good'); }
  updateHUD(true);
}

// ---------- interaction ----------
function nearLM() { return Math.abs(P.x - M.lm) < LM_RANGE; }
function nearestItem() {
  let best = null, bd = PICK_RANGE;
  for (const it of items) {
    if (it.state !== 'ground' || it.flying) continue;
    const d = Math.abs(it.x - P.x); if (d < bd && Math.abs(it.y - P.y) < 50) { bd = d; best = it; }
  }
  return best;
}
function nearestMark() {
  let best = null, bd = 70;
  for (const m of marks) { const d = Math.abs(m.x - P.x); if (d < bd) { bd = d; best = m; } }
  return best;
}
function zoneHere(it) { return it && it.type === 'deploy' && Math.abs(P.x - it.zone) < ZONE_RANGE; }

function interact() {
  const c = P.carry;
  if (c) {
    if (zoneHere(c)) {
      c.state = 'deployed'; c.x = c.zone; c.y = gy(c.zone); P.carry = null; sfx.deploy();
      burst(c.x, c.y, 14, '#5ce1b9');
      toast(`${c.name} deployed`, c.fact, 'good', 6); updateHUD(true); return;
    }
    if (nearLM() && c.type === 'sci') {
      c.state = 'cabin'; P.carry = null; sfx.load();
      toast(`Loaded: ${c.name}`, `+${c.u} units in the cabin. ${load() > M.cap ? 'You are over the limit. Throw something out!' : ''}`, load() > M.cap ? 'bad' : '', 3);
      updateHUD(true); return;
    }
    if (nearLM() && c.type === 'deploy') { toast('Instruments don\'t fly home', `Science instruments only work if you set them up on the Moon. Take it to the ${c.zoneName}.`, 'bad', 4); return; }
    c.state = 'ground'; c.x = P.x + P.face * 14; c.y = gy(c.x); P.carry = null; sfx.drop(); return;
  }
  const it = nearestItem();
  if (it) {
    if (it.type === 'junk') { toast(`Left on the Moon: ${it.name}`, it.fact, '', 4); return; }
    it.state = 'carried'; P.carry = it; sfx.pick();
    if (!it.seen) { it.seen = true; toast(it.name, it.fact, it.type === 'deploy' ? 'good' : '', 6); }
    return;
  }
  const mk = nearestMark();
  if (mk) {
    if (mk.gives && !mk.used) {
      mk.used = true;
      const g = Object.assign({}, mk.gives, { state: 'carried', vx: 0, vy: 0, seen: true, x: P.x, y: P.y });
      items.push(g); P.carry = g; sfx.deploy(); burst(mk.x, gy(mk.x) - 10, 16, mk.kind === 'orange' ? '#ff9a3c' : '#c9ccd6');
      toast(g.name, g.fact, 'good', 7);
    } else toast(markTitle(mk), mk.fact, '', 6);
  }
}
function markTitle(mk) { return { flag: 'The flag', plaque: 'Lander plaque', surveyor: 'Surveyor 3', rover: 'Lunar Roving Vehicle', orange: 'Orange soil', boulder: 'Tracy\'s Rock' }[mk.kind] || ''; }

function computePrompt() {
  const c = P.carry;
  if (c) {
    if (zoneHere(c)) return `${K} Set up the ${c.name}`;
    if (nearLM() && c.type === 'sci') return `${K} Load ${c.name} into the cabin`;
    if (c.type === 'deploy') return `Carry it to the <b style="color:#5ce1b9">${c.zoneName}</b> · ${K} drop`;
    return `Carry it to the lander · ${K} drop`;
  }
  const it = nearestItem();
  if (it) return it.type === 'junk' ? `${it.name} · left on the Moon` : `${K} Pick up ${it.name}`;
  const mk = nearestMark();
  if (mk) return mk.gives && !mk.used ? `${K} ${mk.kind === 'surveyor' ? 'Cut off the camera' : mk.kind === 'orange' ? 'Scoop orange soil' : 'Chip off a sample'}` : `${K} Read: ${markTitle(mk)}`;
  if (nearLM()) return isTouch ? 'At the lander · tap LIFT OFF when ready' : 'At the lander · <kbd>1</kbd>–<kbd>9</kbd> throw out · <kbd>L</kbd> lift off';
  return '';
}

// ---------- launch ----------
function tryLaunch() {
  if (state !== 'play') return;
  if (!nearLM()) { toast('Get back to the lander', 'You need to be at the Lunar Module to lift off.', 'bad', 3); return; }
  if (P.carry) { const c = P.carry; if (c.type === 'sci') { c.state = 'cabin'; } else { c.state = 'ground'; c.x = P.x + 14; c.y = gy(c.x); } P.carry = null; }
  doLaunch(false);
}
function doLaunch(emergency) {
  if (P.carry) { const c = P.carry; c.state = 'ground'; c.x = P.x; c.y = gy(P.x); P.carry = null; }
  const over = load() > M.cap;
  launch = { t: 0, over, y: 0, vy: 0, emergency };
  setState('launch');
  $('cabin').classList.add('hidden'); setPrompt(''); $('toast').classList.add('hidden'); toastTimer = 0;
  if (over) sfx.fail(); else sfx.launch();
}
function finish() {
  const over = launch.over;
  const home = cabinItems();
  const deployed = items.filter(i => i.state === 'deployed');
  const maxSci = M.items.filter(i => i.type !== 'junk').reduce((a, i) => a + i.sci, 0) + M.landmarks.filter(l => l.gives).reduce((a, l) => a + l.gives.sci, 0);
  let score = 0, bonus = 0;
  if (!over) {
    score = home.filter(i => i.type === 'sci').reduce((a, i) => a + i.sci, 0) + deployed.reduce((a, i) => a + i.sci, 0);
    bonus = Math.floor(o2 / 5);
  }
  const pct = score / maxSci;
  const stars = over ? 0 : pct >= .95 ? 3 : pct >= .7 ? 2 : pct >= .35 ? 1 : 0;
  const total = score + bonus;
  const best = progress.best[M.id];
  if (!best || total > best.score) progress.best[M.id] = { score: total, stars: Math.max(stars, best?.stars || 0) };
  else if (stars > best.stars) best.stars = stars;
  if (stars >= 1) progress.unlocked = Math.max(progress.unlocked, missionIndex + 2);
  save();

  $('resEyebrow').textContent = `${M.name} · ${M.site}`;
  $('resTitle').textContent = over ? 'Liftoff failed.' : stars === 3 ? 'Perfect mission!' : stars === 2 ? 'Mission accomplished.' : stars === 1 ? 'You made it home.' : 'Home safe, science light.';
  $('resStars').innerHTML = [1, 2, 3].map(n => `<span class="${n <= stars ? '' : 'off'}">★</span>`).join('');
  $('resText').innerHTML = over
    ? `The ascent stage was <b>${load() - M.cap} units too heavy</b> to leave the Moon. Throw out more of what you don't need.`
    : `Science score <b>${score}</b> of ${maxSci}${bonus ? ` + oxygen bonus <b>${bonus}</b>` : ''} = <b>${total}</b>.${launch.emergency ? ' Your oxygen ran out, so Mission Control launched you early.' : ''}`;
  $('resHome').innerHTML = home.length ? home.map(i => `<li class="${i.type === 'sci' ? 'good' : 'bad'}">${i.name}<span>${i.type === 'sci' ? '+' + i.sci + ' sci' : 'dead weight'}</span></li>`).join('') : '<li>Nothing</li>';
  const left = items.filter(i => i.state === 'ground' || i.state === 'deployed');
  $('resMoon').innerHTML = left.length ? left.map(i => `<li class="${i.state === 'deployed' ? 'good' : i.type === 'sci' ? 'bad' : ''}">${i.name}<span>${i.state === 'deployed' ? '+' + i.sci + ' working' : i.type === 'sci' ? 'missed' : i.type === 'deploy' ? 'never set up' : 'left behind'}</span></li>`).join('') : '<li>Nothing</li>';
  $('resReal').textContent = M.outro;
  const hasNext = missionIndex + 1 < MISSIONS.length && progress.unlocked > missionIndex + 1;
  $('btnNext').classList.toggle('hidden', !hasNext);
  setState('result'); show('result');
}

// ---------- particles ----------
function burst(x, y, n, col) {
  for (let i = 0; i < n; i++) parts.push({ x, y, vx: (Math.random() - .5) * 140, vy: -Math.random() * 120, life: 1, col, s: 1.5 + Math.random() * 2 });
}
function dust(x, y, n = 6) {
  for (let i = 0; i < n; i++) parts.push({ x, y, vx: (Math.random() - .5) * 90, vy: -Math.random() * 50, life: .8, col: '#9a9ca6', s: 1 + Math.random() * 1.6 });
}

// ---------- HUD ----------
let lastWarn = 999;
function updateHUD(force) {
  const f = Math.max(0, o2 / M.o2);
  $('o2fill').style.width = f * 100 + '%'; $('o2fill').classList.toggle('low', o2 < 30);
  const s = Math.max(0, Math.ceil(o2)); $('o2txt').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const l = load(), max = Math.max(M.cap * 1.6, l);
  $('loadfill').style.width = Math.min(100, l / max * 100) + '%'; $('loadfill').classList.toggle('over', l > M.cap);
  $('loadcap').style.cssText = `position:absolute;top:-2px;bottom:-2px;width:2px;background:#fff;left:${M.cap / max * 100}%`;
  $('loadtxt').textContent = `${l}/${M.cap}`;
  if (force) renderCabin(true);
}

// ---------- update ----------
function update(dt) {
  t += dt;
  if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) $('toast').classList.add('hidden'); }

  if (take('pause') && (state === 'play' || state === 'pause')) { togglePause(); return; }
  if (state === 'menu' || state === 'result' || state === 'pause') {
    if (state === 'menu') camX = (camX + dt * 22) % Math.max(1, (M ? M.width : 2000) - VW);
    for (const k in pressed) pressed[k] = false;
    return;
  }
  if (state === 'launch') return updateLaunch(dt);
  if (state === 'lab') return updateLab(dt);

  // ---- play ----
  o2 -= dt;
  if (o2 < 30 && Math.ceil(o2) !== lastWarn && Math.ceil(o2) % 5 === 0) { lastWarn = Math.ceil(o2); sfx.warn(); if (lastWarn === 30) toast('Oxygen low!', 'Head back to the lander and lift off.', 'bad', 4); }
  if (o2 <= 0) { o2 = 0; toast('Oxygen out!', 'Emergency liftoff with whatever is on board.', 'bad', 4); doLaunch(true); return; }

  const dir = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  const heavy = P.carry ? Math.max(.55, 1 - P.carry.u / 45) : 1;
  const target = dir * SPEED * heavy;
  const acc = P.on ? 700 : 260;
  if (P.vx < target) P.vx = Math.min(target, P.vx + acc * dt); else if (P.vx > target) P.vx = Math.max(target, P.vx - acc * dt);
  if (dir) P.face = dir;
  if (take('jump') && P.on) { P.vy = -JUMP * (P.carry ? .85 : 1); P.on = false; sfx.jump(); dust(P.x, P.y, 5); }
  P.vy += GRAV * dt; P.x += P.vx * dt; P.y += P.vy * dt;
  P.x = Math.max(16, Math.min(M.width - 16, P.x));
  const g = gy(P.x);
  if (P.y >= g) {
    if (!P.on && P.vy > 120) { dust(P.x, g, 8); prints.push({ x: P.x - 4, f: P.face }, { x: P.x + 4, f: P.face }); }
    P.y = g; P.vy = 0; P.on = true;
  } else if (P.on && P.y < g - 3 && P.vy >= 0) { P.y = g; }
  else if (P.y < g - 1) P.on = false;
  if (P.on && Math.abs(P.vx) > 10) {
    P.walk += dt * Math.abs(P.vx) * .07; P.stepAcc += Math.abs(P.vx) * dt;
    if (P.stepAcc > 22) { P.stepAcc = 0; prints.push({ x: P.x, f: P.face }); if (prints.length > 900) prints.shift(); if (Math.random() < .5) dust(P.x, P.y, 2); }
  } else P.walk *= .9;

  if (take('act')) interact();
  if (take('lift')) tryLaunch();
  if (state !== 'play') return;
  if (nearLM()) for (let n = 1; n <= 9; n++) if (take('n' + n)) { const ci = cabinItems()[n - 1]; if (ci) tossOut(ci); }
  for (let n = 1; n <= 9; n++) pressed['n' + n] = false;
  pressed.jump = false;

  // items in flight
  for (const it of items) {
    if (it.state === 'carried') { it.x = P.x; it.y = P.y; continue; }
    if (it.flying) {
      it.vy += GRAV * dt; it.x += it.vx * dt; it.y += it.vy * dt;
      const gg = gy(it.x); if (it.y >= gg) { it.y = gg; it.flying = false; dust(it.x, gg, 6); }
    }
  }
  stepParts(dt);

  // camera
  const tx = P.x - VW / 2 + P.face * VW * .08;
  camX += (tx - camX) * Math.min(1, dt * 4);
  camX = Math.max(0, Math.min(M.width - VW, camX));
  if (M.width < VW) camX = (M.width - VW) / 2;
  camY += (0 - camY) * Math.min(1, dt * 3);

  // HUD
  const near = nearLM();
  $('cabin').classList.toggle('hidden', !near);
  if (isTouch && near) $('toast').classList.add('hidden');
  if (near) renderCabin();
  setPrompt(computePrompt());
  updateHUD();
}
function stepParts(dt) {
  for (const p of parts) { p.vy += GRAV * .5 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
  parts = parts.filter(p => p.life > 0);
}
function updateLaunch(dt) {
  const L = launch; L.t += dt; stepParts(dt);
  const ex = M.lm;
  if (L.t > .5) for (let i = 0; i < 3; i++) parts.push({ x: ex + (Math.random() - .5) * 16, y: BASE - 52 + L.y, vx: (Math.random() - .5) * 120, vy: 60 + Math.random() * 80, life: .7, col: Math.random() < .5 ? '#ffd28a' : '#ff8a3c', s: 2 + Math.random() * 2 });
  if (L.over) {
    if (L.t > .5 && L.t < 2.6) { L.y = -Math.abs(Math.sin(L.t * 30)) * 3; if (Math.random() < .3) dust(ex + (Math.random() - .5) * 80, BASE, 3); }
    else L.y = 0;
    if (L.t > 3) finish();
  } else {
    if (L.t > .6) { L.vy -= 90 * dt; L.y += L.vy * dt * 3; }
    if (L.t > .6 && L.t < 1.6) dust(ex + (Math.random() - .5) * 120, BASE, 4);
    camY = Math.max(0, -(L.y) - 200);
    camX += (M.lm - VW / 2 - camX) * Math.min(1, dt * 2);
    if (L.t > 4.2) {
      if (L.ct == null) $('hud').classList.add('hidden');
      L.ct = L.t - 4.2;
      if (!L.snd1 && L.ct > 4) { L.snd1 = 1; noise(5, .14, 900); tone(70, 4.5, 'sawtooth', .03, 40); }
      if (!L.snd2 && L.ct > 9.6) { L.snd2 = 1; tone(180, .25, 'square', .05, 200); noise(.4, .1, 2000); }
      if (!L.snd3 && L.ct > 15.1) { L.snd3 = 1; noise(1.6, .2, 1400); }
      stepCine(dt, L);
      if (!L.snd4 && L.ct > 18.3) { L.snd4 = 1; noise(4, .07, 220); }
      if (L.skip || L.ct > 26.5) startLab();
    }
  }
}


// ---------- return-to-Earth cinematic ----------
let cps = [];
const clouds = Array.from({ length: 18 }, (_, i) => ({ x: Math.random(), y: Math.random() * 1.6, w: 80 + Math.random() * 160, s: .6 + Math.random() * .8 }));
function stepCine(dt, L) {
  const ct = L.ct;
  for (const p of cps) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += (p.g || 0) * dt; p.life -= dt; }
  cps = cps.filter(p => p.life > 0);
  if (ct > 4 && ct < 9.4) {
    const k = Math.sin(Math.PI * Math.min(1, (ct - 4) / 5.4));
    for (let i = 0; i < 6 * k + 1; i++) cps.push({ x: VW * .5 - 26 + Math.random() * 20, y: VH * .5 + 22 + Math.random() * 10, vx: 260 + Math.random() * 260, vy: -260 - Math.random() * 260, life: .5 + Math.random() * .4, s: 2 + Math.random() * 4 * k, col: Math.random() < .5 ? '#fff1c2' : Math.random() < .5 ? '#ffb347' : '#ff5a2a' });
  }
  if (ct > 15.1 && !L.splashed) {
    L.splashed = true;
    for (let i = 0; i < 90; i++) cps.push({ x: VW * .5 + (Math.random() - .5) * 40, y: VH * .62, vx: (Math.random() - .5) * 320, vy: -120 - Math.random() * 280, g: 520, life: 1.6, s: 2 + Math.random() * 3, col: Math.random() < .5 ? '#ffffff' : '#bfe6ff' });
  }
}
function caption(title, sub) {
  ctx.textAlign = 'center';
  ctx.font = '500 14px Inter,sans-serif'; const w = Math.max(ctx.measureText(sub).width, title.length * 13) + 48;
  ctx.fillStyle = 'rgba(5,8,18,.62)'; ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(VW / 2 - w / 2, 46, w, 70, 16) : ctx.rect(VW / 2 - w / 2, 46, w, 70); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.95)'; ctx.font = '800 26px "Bricolage Grotesque",sans-serif';
  ctx.fillText(title, VW / 2, 78);
  ctx.fillStyle = 'rgba(220,226,240,.85)'; ctx.font = '500 14px Inter,sans-serif';
  ctx.fillText(sub, VW / 2, 102);
  ctx.fillStyle = 'rgba(255,255,255,.45)'; ctx.font = '500 11px "IBM Plex Mono",monospace';
  ctx.fillText(isTouch ? 'TAP TO SKIP' : 'PRESS ANY KEY TO SKIP', VW / 2, VH - 22);
}
function drawCapsule(x, y, ang, scale = 1, sm = false, shieldGlow = 0) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang); ctx.scale(scale, scale);
  if (sm) { // service module + engine
    ctx.fillStyle = '#c9ccd4'; ctx.fillRect(-14, 14, 28, 34);
    ctx.fillStyle = '#9fa3ad'; ctx.fillRect(-14, 24, 28, 3); ctx.fillRect(-14, 38, 28, 3);
    ctx.fillStyle = '#6d707b'; ctx.beginPath(); ctx.moveTo(-6, 48); ctx.lineTo(6, 48); ctx.lineTo(10, 60); ctx.lineTo(-10, 60); ctx.fill();
  }
  // command module cone
  const g = ctx.createLinearGradient(-18, 0, 18, 0);
  g.addColorStop(0, '#8f939d'); g.addColorStop(.45, '#f0f1f4'); g.addColorStop(1, '#a9adb7');
  ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(-4, -22); ctx.lineTo(4, -22); ctx.lineTo(18, 12); ctx.lineTo(-18, 12); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#1b2033'; ctx.fillRect(-7, -6, 5, 5); ctx.fillRect(3, -6, 5, 5);
  ctx.fillStyle = '#c3c6cf'; ctx.fillRect(-3, -26, 6, 4);
  // heat shield
  ctx.fillStyle = shieldGlow > 0 ? `rgb(${120 + 135 * shieldGlow},${70 + 120 * shieldGlow},${40 + 60 * shieldGlow})` : '#6b4a2b';
  ctx.beginPath(); ctx.moveTo(-18, 12); ctx.quadraticCurveTo(0, 20, 18, 12); ctx.closePath(); ctx.fill();
  ctx.restore();
}
function drawChute(cx, cy, r, open, tx, ty, sway) {
  ctx.strokeStyle = 'rgba(230,230,235,.7)'; ctx.lineWidth = 1;
  for (let i = -1; i <= 1; i += .5) { ctx.beginPath(); ctx.moveTo(cx + i * r * open, cy); ctx.lineTo(tx, ty); ctx.stroke(); }
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(sway);
  const w = r * open, h = r * .7 * (.4 + .6 * open);
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = i % 2 ? '#f4f4f6' : '#e2442f';
    const a0 = Math.PI + i * Math.PI / 6, a1 = a0 + Math.PI / 6;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.ellipse(0, 0, w, h, 0, a0, a1); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}
function drawCine(L) {
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.setTransform(S, 0, 0, S, 0, 0);
  const ct = L.ct, cm = M.cm || 'Command Module';
  if (ct >= 18) { drawCine2(ct - 18); return; }
  const fadeIn = Math.min(1, ct / .6);
  if (ct < 4) {
    // ---- cruise home ----
    const k = ct / 4;
    for (const s of stars) { const x = (s.x * .4 - ct * 30 * s.s) % VW; ctx.globalAlpha = s.a; ctx.fillStyle = '#fff'; ctx.fillRect((x + VW) % VW, (s.y + 400) % VH, s.s, s.s); }
    ctx.globalAlpha = 1;
    const mr = 110 * (1 - k) + 26, mx = VW * .2 - k * 60, my = VH * .62 + k * 40;
    const mg = ctx.createRadialGradient(mx - mr * .3, my - mr * .3, 2, mx, my, mr);
    mg.addColorStop(0, '#f1f2f5'); mg.addColorStop(.7, '#9a9eaa'); mg.addColorStop(1, '#4a4e5b');
    ctx.fillStyle = mg; ctx.beginPath(); ctx.arc(mx, my, mr, 0, 7); ctx.fill();
    drawEarth(VW * .74, VH * .42, 26 + k * 90);
    const sx = VW * .3 + k * VW * .3, sy = VH * .6 - k * VH * .12;
    if (ct < 1.2) for (let i = 0; i < 3; i++) cps.push({ x: sx - 30, y: sy + 8, vx: -120 - Math.random() * 80, vy: (Math.random() - .5) * 40, life: .4, s: 2 + Math.random() * 2, col: '#ffcf7a' });
    for (const p of cps) { ctx.globalAlpha = Math.max(0, p.life * 2); ctx.fillStyle = p.col; ctx.fillRect(p.x, p.y, p.s, p.s); } ctx.globalAlpha = 1;
    drawCapsule(sx, sy, Math.PI / 2 - .25, 1.1, true);
    caption(`Heading home in ${cm}`, 'After docking in lunar orbit, the trip back to Earth takes about 3 days.');
  } else if (ct < 9.4) {
    // ---- reentry ----
    const k = Math.min(1, (ct - 4) / 5.4), heat = Math.sin(Math.PI * k);
    const sky = ctx.createLinearGradient(0, 0, 0, VH);
    sky.addColorStop(0, '#02030a'); sky.addColorStop(.6, `rgb(${20 + 60 * heat},${18 + 20 * heat},${40})`); sky.addColorStop(1, `rgb(${60 + 140 * heat},${40 + 50 * heat},${60 - 20 * heat})`);
    ctx.fillStyle = sky; ctx.fillRect(0, 0, VW, VH);
    // Earth limb
    ctx.fillStyle = '#123a7a'; ctx.beginPath(); ctx.ellipse(VW / 2, VH + 900 - k * 120, VW * 1.4, 1000, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(120,190,255,.6)'; ctx.lineWidth = 6; ctx.stroke();
    // speed streaks
    ctx.strokeStyle = `rgba(255,200,140,${.15 + .35 * heat})`; ctx.lineWidth = 1.5;
    for (let i = 0; i < 26; i++) { const y = ((i * 53 + ct * 900) % (VH + 200)) - 100, x = (i * 97) % VW; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 60, y - 60); ctx.stroke(); }
    const shake = heat * 3, cx = VW * .5 + (Math.random() - .5) * shake, cy = VH * .5 + (Math.random() - .5) * shake;
    // plasma glow
    const pg = ctx.createRadialGradient(cx - 14, cy + 22, 2, cx - 14, cy + 22, 40 + 70 * heat);
    pg.addColorStop(0, `rgba(255,250,220,${.9 * heat})`); pg.addColorStop(.35, `rgba(255,160,60,${.7 * heat})`); pg.addColorStop(1, 'rgba(255,60,20,0)');
    ctx.fillStyle = pg; ctx.beginPath(); ctx.arc(cx - 14, cy + 22, 40 + 70 * heat, 0, 7); ctx.fill();
    for (const p of cps) { ctx.globalAlpha = Math.max(0, p.life); ctx.fillStyle = p.col; ctx.fillRect(p.x, p.y, p.s, p.s); } ctx.globalAlpha = 1;
    drawCapsule(cx, cy, .6, 1.5, false, heat);
    caption('Entering the atmosphere', `About 40,000 km/h. The heat shield faces temperatures near 2,700 °C.`);
  } else {
    // ---- parachutes & splashdown ----
    const k = (ct - 9.4) / 8.6;
    const sky = ctx.createLinearGradient(0, 0, 0, VH);
    sky.addColorStop(0, '#2d6fc4'); sky.addColorStop(1, '#a9d4f5');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, VW, VH);
    const descend = ct < 15.1;
    const SEA = VH * .62, e = Math.min(1, Math.max(0, (ct - 12.5) / 2.6)), ee = e * (2 - e);
    const seaY = ct < 12.5 ? VH + 50 : VH + 50 - (VH + 50 - SEA) * ee;
    // clouds rising = falling feeling
    for (const c of clouds) {
      const y = ((c.y * VH - (ct - 9.4) * 160 * c.s) % (VH * 1.6) + VH * 1.6) % (VH * 1.6) - VH * .3;
      if (y > seaY - 10) continue;
      ctx.fillStyle = 'rgba(255,255,255,.75)';
      ctx.beginPath(); ctx.ellipse(c.x * VW, y, c.w, c.w * .22, 0, 0, 7); ctx.ellipse(c.x * VW + c.w * .4, y - c.w * .1, c.w * .5, c.w * .2, 0, 0, 7); ctx.fill();
    }
    // ocean
    if (seaY < VH) {
      const sea = ctx.createLinearGradient(0, seaY, 0, VH);
      sea.addColorStop(0, '#1f6fa8'); sea.addColorStop(1, '#0b3558');
      ctx.fillStyle = sea; ctx.fillRect(0, seaY, VW, VH - seaY);
      ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.lineWidth = 1.5;
      for (let i = 0; i < 14; i++) { const y = seaY + 8 + i * 14, o = (ct * 30 + i * 37) % 60; ctx.beginPath(); for (let x = -60 + o; x < VW; x += 60) { ctx.moveTo(x, y); ctx.quadraticCurveTo(x + 15, y - 4, x + 30, y); } ctx.stroke(); }
      // recovery ship
      const shx = VW * .82, shy = seaY - 4;
      ctx.fillStyle = '#4a5260'; ctx.beginPath(); ctx.moveTo(shx - 70, shy); ctx.lineTo(shx + 70, shy); ctx.lineTo(shx + 60, shy + 10); ctx.lineTo(shx - 64, shy + 10); ctx.fill();
      ctx.fillRect(shx - 10, shy - 16, 20, 16); ctx.fillRect(shx - 2, shy - 28, 4, 12);
    }
    const sway = Math.sin(ct * 1.6) * .06;
    let capY = descend ? VH * .6 + (SEA - 20 - VH * .6) * e * e : SEA - 20 + Math.sin(ct * 3) * 2;
    const capX = VW * .5 + sway * 80;
    // chutes
    const drogue = ct < 10.6, mainOpen = Math.min(1, Math.max(0, (ct - 10.6) / .8));
    if (drogue) { drawChute(capX - 14, capY - 70, 14, Math.min(1, (ct - 9.4) * 2), capX, capY - 24, sway); drawChute(capX + 14, capY - 70, 14, Math.min(1, (ct - 9.4) * 2), capX, capY - 24, sway); }
    else if (descend) { [-48, 0, 48].forEach((dx, i) => drawChute(capX + dx * mainOpen, capY - 130 - (i === 1 ? 14 : 0), 40, mainOpen, capX, capY - 24, sway)); }
    else { const f = Math.max(0, 1 - (ct - 15.1) * .9); if (f > 0) { ctx.globalAlpha = f; [-60, 0, 60].forEach(dx => { ctx.fillStyle = '#e2442f'; ctx.beginPath(); ctx.ellipse(capX + dx + 80, seaY + 4, 34, 5, 0, 0, 7); ctx.fill(); }); ctx.globalAlpha = 1; } }
    drawCapsule(capX, capY, sway, 1.5, false, 0);
    for (const p of cps) { ctx.globalAlpha = Math.max(0, Math.min(1, p.life)); ctx.fillStyle = p.col; ctx.fillRect(p.x, p.y, p.s, p.s); } ctx.globalAlpha = 1;
    if (ct < 15.1) caption(drogue ? 'Drogue parachutes' : 'Three main parachutes open', 'Slowing from hundreds of km/h to a gentle splash.');
    else caption(`Splashdown! Welcome home, ${M.name}.`, `${cm} lands in the Pacific Ocean. The ${M.ship || 'recovery ship'} is on its way.`);
    if (ct > 17.2) { ctx.fillStyle = `rgba(5,7,13,${Math.min(1, (ct - 17.2) / .8)})`; ctx.fillRect(0, 0, VW, VH); }
  }
  if (fadeIn < 1) { ctx.fillStyle = `rgba(0,0,0,${1 - fadeIn})`; ctx.fillRect(0, 0, VW, VH); }
}


// ---------- recovery & flight to Houston ----------
function drawHeli(x, y, t2, scale = 1) {
  ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
  ctx.fillStyle = '#5a6578';
  ctx.beginPath(); ctx.ellipse(0, 0, 30, 13, 0, 0, 7); ctx.fill();
  ctx.fillRect(-62, -5, 40, 6);
  ctx.fillStyle = '#8fd0ff'; ctx.beginPath(); ctx.ellipse(18, -3, 11, 8, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#3d4554'; ctx.fillRect(-4, -18, 8, 6);
  ctx.strokeStyle = '#3d4554'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-14, 14); ctx.lineTo(16, 14); ctx.stroke();
  const r = 52 * Math.abs(Math.cos(t2 * 40));
  ctx.strokeStyle = 'rgba(40,46,58,.8)'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(-r, -19); ctx.lineTo(r, -19); ctx.stroke();
  ctx.strokeStyle = 'rgba(40,46,58,.7)'; ctx.lineWidth = 2; const tr = 9 * Math.abs(Math.sin(t2 * 50));
  ctx.beginPath(); ctx.moveTo(-62, -2 - tr); ctx.lineTo(-62, -2 + tr); ctx.stroke();
  ctx.restore();
}
function drawShip(x, y, sc) {
  ctx.save(); ctx.translate(x, y); ctx.scale(sc, sc);
  ctx.fillStyle = '#4a5260'; ctx.beginPath(); ctx.moveTo(-120, 0); ctx.lineTo(130, 0); ctx.lineTo(112, 18); ctx.lineTo(-108, 18); ctx.fill();
  ctx.fillStyle = '#5c6575'; ctx.fillRect(-120, -6, 250, 6);
  ctx.fillStyle = '#3d4452'; ctx.fillRect(40, -30, 26, 24); ctx.fillRect(50, -48, 6, 18);
  ctx.fillStyle = '#e6e8ee'; for (let i = -100; i < 30; i += 26) ctx.fillRect(i, -7, 12, 1.5);
  ctx.restore();
}
function drawPlane(x, y, sc) {
  ctx.save(); ctx.translate(x, y); ctx.scale(sc, sc);
  ctx.fillStyle = '#d9dde6';
  ctx.beginPath(); ctx.ellipse(0, 0, 60, 9, 0, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.moveTo(-6, -3); ctx.lineTo(-30, -38); ctx.lineTo(-18, -38); ctx.lineTo(16, -3); ctx.fill();
  ctx.beginPath(); ctx.moveTo(-6, 3); ctx.lineTo(-24, 22); ctx.lineTo(-14, 22); ctx.lineTo(14, 3); ctx.fill();
  ctx.beginPath(); ctx.moveTo(-48, -4); ctx.lineTo(-62, -26); ctx.lineTo(-54, -26); ctx.lineTo(-40, -4); ctx.fill();
  ctx.fillStyle = '#2b3550'; for (let i = 10; i < 50; i += 8) ctx.fillRect(i, -3, 4, 3);
  ctx.restore();
}
function drawCine2(u) {
  if (u < 4.5) {
    const k = u / 4.5;
    const sky = ctx.createLinearGradient(0, 0, 0, VH); sky.addColorStop(0, '#2d6fc4'); sky.addColorStop(1, '#a9d4f5');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, VW, VH);
    const SEA = VH * .7;
    const sea = ctx.createLinearGradient(0, SEA, 0, VH); sea.addColorStop(0, '#1f6fa8'); sea.addColorStop(1, '#0b3558');
    ctx.fillStyle = sea; ctx.fillRect(0, SEA, VW, VH - SEA);
    ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.lineWidth = 1.5;
    for (let i = 0; i < 10; i++) { const y = SEA + 8 + i * 14, o = (u * 30 + i * 37) % 60; ctx.beginPath(); for (let x = -60 + o; x < VW; x += 60) { ctx.moveTo(x, y); ctx.quadraticCurveTo(x + 15, y - 4, x + 30, y); } ctx.stroke(); }
    drawShip(VW * .78, SEA - 2, 1.3);
    // capsule bobbing with a raft
    const cx = VW * .2;
    ctx.fillStyle = '#e8b82c'; ctx.beginPath(); ctx.ellipse(cx + 34, SEA + 2, 22, 5, 0, 0, 7); ctx.fill();
    drawCapsule(cx, SEA - 18 + Math.sin(u * 3) * 2, Math.sin(u * 2) * .05, 1.2);
    // helicopter: hover over raft, lift crew, fly to ship
    const hx = k < .35 ? cx + 34 : cx + 34 + (VW * .78 - cx - 34) * ((k - .35) / .65) ** 1.3;
    const hy = SEA - 150 - (k > .35 ? Math.sin((k - .35) / .65 * Math.PI) * 40 : 0);
    const line = k < .35 ? 120 * Math.min(1, k / .2) : Math.max(0, 120 - (k - .35) * 600);
    ctx.strokeStyle = '#2b2f3a'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(hx, hy + 14); ctx.lineTo(hx, hy + 14 + line); ctx.stroke();
    if (k > .2) { ctx.fillStyle = '#e2442f'; ctx.fillRect(hx - 4, hy + 12 + line, 8, 9); }
    drawHeli(hx, hy, u, 1.1);
    caption('Recovery', `A helicopter lifts the crew out of the ocean and flies them to the ${M.ship || 'recovery ship'}.`);
  } else {
    const k = (u - 4.5) / 4;
    const sky = ctx.createLinearGradient(0, 0, 0, VH); sky.addColorStop(0, '#1b2350'); sky.addColorStop(.7, '#e0794a'); sky.addColorStop(1, '#f6b26b');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, VW, VH);
    ctx.fillStyle = 'rgba(255,220,150,.9)'; ctx.beginPath(); ctx.arc(VW * .25, VH * .72, 34, 0, 7); ctx.fill();
    ctx.fillStyle = '#2a2c3a'; ctx.fillRect(0, VH * .78, VW, VH * .22);
    for (let i = 0; i < 60; i++) { const x = ((i * 73 - u * 120) % (VW + 40) + VW + 40) % (VW + 40) - 20, y = VH * .8 + (i * 37) % (VH * .18); ctx.fillStyle = i % 3 ? 'rgba(255,214,120,.8)' : 'rgba(255,255,255,.6)'; ctx.fillRect(x, y, 2, 2); }
    for (const c of clouds.slice(0, 8)) { const x = ((c.x * VW - u * 60 * c.s) % (VW + 300) + VW + 300) % (VW + 300) - 150; ctx.fillStyle = 'rgba(255,200,170,.35)'; ctx.beginPath(); ctx.ellipse(x, VH * .3 + c.y * 60, c.w, c.w * .15, 0, 0, 7); ctx.fill(); }
    drawPlane(VW * .2 + k * VW * .55, VH * .42 - Math.sin(k * 3) * 12, 1.3);
    caption('Next stop: Houston', `${M.name}'s samples are flown to NASA's Lunar Receiving Laboratory.`);
  }
  const f = u < .5 ? 1 - u / .5 : u > 8 ? Math.min(1, (u - 8) / .5) : 0;
  if (f > 0) { ctx.fillStyle = `rgba(5,7,13,${f})`; ctx.fillRect(0, 0, VW, VH); }
}

// ---------- Lunar Receiving Laboratory (playable) ----------
const LAB_FLOOR = 400;
let lab = null;
function startLab() {
  if (state === 'lab' || state === 'result') return;
  const home = cabinItems().filter(i => i.type === 'sci');
  if (!home.length) { finish(); return; }
  const st = home.map((it, i) => ({ it, x: 420 + i * 230, done: false }));
  lab = { st, w: 420 + home.length * 230 + 340, exit: 420 + home.length * 230 + 120 };
  P = { x: 120, y: LAB_FLOOR, vx: 0, vy: 0, on: true, face: 1, carry: null, walk: 0, stepAcc: 0 };
  camX = 0; camY = 0; parts = []; lastPrompt = '';
  setState('lab');
  toast('Lunar Receiving Laboratory · Houston', M.labIntro || 'Hand each sample to the lab team.', '', 7);
}
function labNear() {
  let best = null, bd = 60;
  for (const s of lab.st) { const d = Math.abs(P.x - s.x); if (d < bd) { bd = d; best = s; } }
  return best;
}
function updateLab(dt) {
  const dir = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  const target = dir * 170;
  P.vx += Math.sign(target - P.vx) * Math.min(Math.abs(target - P.vx), 900 * dt);
  if (dir) P.face = dir;
  if (take('jump') && P.on) { P.vy = -380; P.on = false; sfx.jump(); }
  P.vy += 1300 * dt; P.x += P.vx * dt; P.y += P.vy * dt;
  P.x = Math.max(30, Math.min(lab.w - 30, P.x));
  if (P.y >= LAB_FLOOR) { P.y = LAB_FLOOR; P.vy = 0; P.on = true; }
  if (P.on && Math.abs(P.vx) > 10) P.walk += dt * Math.abs(P.vx) * .09; else P.walk *= .9;
  for (const k in pressed) if (k.startsWith('n') || k === 'lift' || k === 'pause') pressed[k] = false;
  const s = labNear(), atExit = Math.abs(P.x - lab.exit) < 60;
  if (take('act')) {
    if (s && !s.done) { s.done = true; sfx.deploy(); burst(s.x, LAB_FLOOR - 120, 16, '#5ce1b9'); toast(`Lab result: ${s.it.name}`, s.it.lab || s.it.fact, 'good', 8); }
    else if (s && s.done) toast(s.it.name, s.it.lab || s.it.fact, '', 6);
    else if (atExit) { finish(); return; }
  }
  stepParts(dt);
  camX += (P.x - VW / 2 - camX) * Math.min(1, dt * 4);
  camX = Math.max(0, Math.min(lab.w - VW, camX)); if (lab.w < VW) camX = (lab.w - VW) / 2;
  const left = lab.st.filter(x => !x.done).length;
  setPrompt(s ? (s.done ? `${s.it.name} · analysed ✓` : `<kbd>E</kbd> Hand over ${s.it.name}`)
    : atExit ? `<kbd>E</kbd> Go to the mission debrief${left ? ` (${left} sample${left > 1 ? 's' : ''} not handed in)` : ''}`
    : left ? `Walk to the lab stations · ${left} to go` : 'All samples handed in. Head to the debrief door →');
}
function drawLab() {
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#cfdad3'; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.setTransform(S, 0, 0, S, 0, 0);
  const off = VH - 540;
  ctx.save(); ctx.translate(-camX, off);
  const W = lab.w;
  // wall
  const wg = ctx.createLinearGradient(0, 0, 0, LAB_FLOOR); wg.addColorStop(0, '#b9cbc1'); wg.addColorStop(1, '#d9e4dd');
  ctx.fillStyle = wg; ctx.fillRect(-VW, -off - 10, W + VW * 2, LAB_FLOOR + off + 10);
  ctx.fillStyle = '#9fb2a8'; ctx.fillRect(-VW, LAB_FLOOR - 40, W + VW * 2, 40);
  // ceiling lights
  for (let x = 60; x < W; x += 180) { ctx.fillStyle = '#f7fbff'; ctx.fillRect(x, 30 - off * .0, 110, 8); ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.beginPath(); ctx.moveTo(x, 38); ctx.lineTo(x + 110, 38); ctx.lineTo(x + 140, 160); ctx.lineTo(x - 30, 160); ctx.fill(); }
  // windows
  for (let x = 160; x < W - 200; x += 460) { ctx.fillStyle = '#7a8b84'; ctx.fillRect(x - 4, 96, 128, 98); const sg = ctx.createLinearGradient(0, 100, 0, 190); sg.addColorStop(0, '#6fb0e8'); sg.addColorStop(1, '#cfe7f7'); ctx.fillStyle = sg; ctx.fillRect(x, 100, 120, 90); ctx.fillStyle = '#7a8b84'; ctx.fillRect(x + 58, 100, 4, 90); }
  // sign
  ctx.fillStyle = '#23324a'; ctx.fillRect(40, 66, 300, 54);
  ctx.fillStyle = '#ffffff'; ctx.textAlign = 'left'; ctx.font = '800 17px "Bricolage Grotesque",sans-serif'; ctx.fillText('LUNAR RECEIVING LABORATORY', 54, 90);
  ctx.fillStyle = '#ffb347'; ctx.font = '600 11px "IBM Plex Mono",monospace'; ctx.fillText('MANNED SPACECRAFT CENTER · HOUSTON', 54, 108);
  // floor
  for (let x = -VW; x < W + VW; x += 40) for (let r = 0; r < 4; r++) { ctx.fillStyle = (Math.floor(x / 40) + r) % 2 ? '#8e9696' : '#a9b0b0'; ctx.fillRect(x, LAB_FLOOR + r * 40, 40, 40); }
  ctx.fillStyle = '#6b7474'; ctx.fillRect(-VW, LAB_FLOOR, W + VW * 2, 3);
  // stations
  for (const s of lab.st) {
    const x = s.x, y = LAB_FLOOR;
    ctx.fillStyle = '#7d878f'; ctx.fillRect(x - 56, y - 50, 6, 50); ctx.fillRect(x + 50, y - 50, 6, 50);
    ctx.fillStyle = '#c5ccd3'; ctx.fillRect(x - 64, y - 150, 128, 100);
    ctx.fillStyle = '#9aa3ab'; ctx.fillRect(x - 64, y - 60, 128, 10);
    ctx.fillStyle = 'rgba(170,215,240,.55)'; ctx.fillRect(x - 54, y - 140, 108, 64);
    ctx.fillStyle = '#20242c'; ctx.beginPath(); ctx.arc(x - 24, y - 92, 11, 0, 7); ctx.arc(x + 24, y - 92, 11, 0, 7); ctx.fill();
    if (s.done) { ctx.save(); ctx.translate(x, y - 104); drawIcon(s.it.icon, false); ctx.restore(); }
    ctx.fillStyle = s.done ? '#5ce1b9' : (Math.sin(t * 4) > 0 ? '#ffb347' : '#8a6a2a'); ctx.beginPath(); ctx.arc(x, y - 160, 6, 0, 7); ctx.fill();
    ctx.fillStyle = '#23324a'; ctx.fillRect(x - 64, y - 46, 128, 20);
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.font = '600 10px "IBM Plex Mono",monospace'; ctx.fillText(s.it.name.toUpperCase().slice(0, 20), x, y - 32);
    // scientist
    const sx = x + 86;
    ctx.fillStyle = '#f4f5f7'; ctx.fillRect(sx - 9, y - 50, 18, 34);
    ctx.fillStyle = '#3d4452'; ctx.fillRect(sx - 7, y - 16, 5, 16); ctx.fillRect(sx + 2, y - 16, 5, 16);
    ctx.fillStyle = '#c9a47e'; ctx.beginPath(); ctx.arc(sx, y - 60, 9, 0, 7); ctx.fill();
    ctx.fillStyle = '#3a2f28'; ctx.beginPath(); ctx.arc(sx, y - 63, 9, Math.PI, 0); ctx.fill();
    ctx.fillStyle = '#9fd3f0'; ctx.fillRect(sx - 7, y - 62, 14, 4);
    if (s.done) { ctx.fillStyle = '#5ce1b9'; ctx.font = '800 14px "Bricolage Grotesque",sans-serif'; ctx.fillText('✓', sx, y - 76); }
  }
  // exit door
  const ex = lab.exit, allDone = lab.st.every(s => s.done);
  ctx.fillStyle = '#5b6470'; ctx.fillRect(ex - 44, LAB_FLOOR - 150, 88, 150);
  ctx.fillStyle = allDone ? '#2f5c4c' : '#3a4250'; ctx.fillRect(ex - 36, LAB_FLOOR - 142, 72, 142);
  ctx.fillStyle = '#ffb347'; ctx.beginPath(); ctx.arc(ex + 22, LAB_FLOOR - 70, 3, 0, 7); ctx.fill();
  ctx.fillStyle = allDone ? '#5ce1b9' : '#ffb347'; ctx.font = '700 11px "IBM Plex Mono",monospace'; ctx.textAlign = 'center';
  ctx.fillText('MISSION', ex, LAB_FLOOR - 168); ctx.fillText('DEBRIEF →', ex, LAB_FLOOR - 154);
  if (allDone) { ctx.globalAlpha = .25 + .2 * Math.sin(t * 4); ctx.fillStyle = '#5ce1b9'; ctx.fillRect(ex - 44, LAB_FLOOR - 150, 88, 150); ctx.globalAlpha = 1; }
  // player
  drawAstronaut();
  for (const p of parts) { ctx.globalAlpha = Math.max(0, p.life); ctx.fillStyle = p.col; ctx.fillRect(p.x, p.y, p.s, p.s); }
  ctx.globalAlpha = 1;
  ctx.restore();
}

// ---------- drawing ----------
function draw() {
  if (state === 'launch' && launch && launch.ct != null) { drawCine(launch); return; }
  if (state === 'lab') { drawLab(); return; }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#05070d'; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.setTransform(S, 0, 0, S, 0, 0);
  const off = VH - 540; // extra sky on tall screens

  // stars
  for (const s of stars) {
    let x = ((s.x - camX * .06) % 2400 + 2400) % 2400; if (x > VW) continue;
    const y = s.y + off * .6 + camY * .1; if (y < -4 || y > VH) continue;
    ctx.globalAlpha = s.a * (.75 + .25 * Math.sin(t * 1.5 + s.tw)); ctx.fillStyle = '#fff';
    ctx.fillRect(x, y, s.s, s.s);
  }
  ctx.globalAlpha = 1;
  // earth
  drawEarth(VW * .78 - camX * .02, 90 + off * .4 + camY * .15, 34);

  ctx.save(); ctx.translate(0, off + camY);
  // distant hills
  ctx.fillStyle = '#1a1d27';
  ctx.beginPath(); ctx.moveTo(0, BASE + 10);
  for (const h of hills) { const x = h.x - camX * .3; if (x > -h.w && x < VW + h.w) { ctx.lineTo(x - h.w / 2, BASE - 10); ctx.quadraticCurveTo(x, BASE - 10 - h.h * 2, x + h.w / 2, BASE - 10); } }
  ctx.lineTo(VW, BASE + 10); ctx.closePath(); ctx.fill();

  ctx.translate(-camX, 0);
  if (G) drawGround();
  if (M) {
    drawPrints(); drawZones();
    for (const m of marks) drawMark(m);
    drawLM();
    for (const it of items) if (it.state === 'ground' || it.state === 'deployed') drawItem(it, it.x, it.y, it.state === 'deployed');
    if (P && state !== 'launch' && state !== 'result') drawAstronaut();
    for (const p of parts) { ctx.globalAlpha = Math.max(0, p.life); ctx.fillStyle = p.col; ctx.fillRect(p.x, p.y, p.s, p.s); }
    ctx.globalAlpha = 1;
  }
  ctx.restore();
  if (state === 'play' && M) drawMinimap();
}
function drawEarth(x, y, r) {
  const g = ctx.createRadialGradient(x - r * .3, y - r * .3, r * .1, x, y, r);
  g.addColorStop(0, '#7fc3ff'); g.addColorStop(.6, '#2f6fd1'); g.addColorStop(1, '#173a7a');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  ctx.fillStyle = 'rgba(120,190,110,.85)';
  ctx.beginPath(); ctx.ellipse(x - 8, y - 6, 10, 7, .5, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.ellipse(x + 10, y + 8, 7, 11, -.3, 0, 7); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.55)';
  ctx.beginPath(); ctx.ellipse(x + 2, y - 18, 14, 3, 0, 0, 7); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.beginPath(); ctx.arc(x + r * .35, y + r * .1, r, -1.2, 1.9); ctx.fill();
}
function drawGround() {
  const x0 = Math.max(0, Math.floor(camX / 4) - 2), x1 = Math.min(G.length - 1, Math.ceil((camX + VW) / 4) + 2);
  const grd = ctx.createLinearGradient(0, BASE - 30, 0, BASE + 160);
  grd.addColorStop(0, '#b9bcc6'); grd.addColorStop(.25, '#8d909c'); grd.addColorStop(1, '#3b3e49');
  ctx.fillStyle = grd; ctx.beginPath(); ctx.moveTo(x0 * 4, 900);
  for (let i = x0; i <= x1; i++) ctx.lineTo(i * 4, G[i]);
  ctx.lineTo(x1 * 4, 900); ctx.closePath(); ctx.fill();
  // highlight edge
  ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1.5; ctx.beginPath();
  for (let i = x0; i <= x1; i++) i === x0 ? ctx.moveTo(i * 4, G[i]) : ctx.lineTo(i * 4, G[i]);
  ctx.stroke();
  // crater shadows & pebbles
  for (const c of M.craters) {
    if (c.x + c.r < camX || c.x - c.r > camX + VW) continue;
    ctx.fillStyle = 'rgba(30,32,42,.25)';
    ctx.beginPath(); ctx.ellipse(c.x - c.r * .15, gy(c.x) + 8, c.r * .7, 10, 0, 0, 7); ctx.fill();
  }
  const r = rng(M.seed + 5);
  for (let i = 0; i < M.width / 30; i++) {
    const x = r() * M.width, s = r() * 3 + 1, d = r() * 40;
    if (x < camX - 10 || x > camX + VW + 10) continue;
    ctx.fillStyle = r() < .5 ? '#6d707b' : '#a8abb5';
    ctx.beginPath(); ctx.ellipse(x, gy(x) + 6 + d, s * 1.4, s * .8, 0, 0, 7); ctx.fill();
  }
}
function drawPrints() {
  ctx.fillStyle = 'rgba(40,42,52,.45)';
  for (const p of prints) { if (p.x < camX - 10 || p.x > camX + VW + 10) continue; ctx.fillRect(p.x - 3, gy(p.x) + 1, 6, 2); }
}
function drawZones() {
  for (const it of items) {
    if (it.type !== 'deploy' || it.state === 'deployed') continue;
    const x = it.zone, y = gy(x), pulse = .5 + .5 * Math.sin(t * 3);
    ctx.strokeStyle = `rgba(92,225,185,${.45 + .4 * pulse})`; ctx.lineWidth = 2; ctx.setLineDash([5, 5]);
    ctx.beginPath(); ctx.ellipse(x, y + 2, 34, 8, 0, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = '#5ce1b9'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x + 30, y); ctx.lineTo(x + 30, y - 46); ctx.stroke();
    ctx.fillStyle = '#5ce1b9'; ctx.beginPath(); ctx.moveTo(x + 30, y - 46); ctx.lineTo(x + 44, y - 41); ctx.lineTo(x + 30, y - 36); ctx.fill();
    ctx.font = '600 10px "IBM Plex Mono",monospace'; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(92,225,185,.95)';
    ctx.fillText(it.zoneName.toUpperCase(), x, y + 24);
  }
}
function drawLM() {
  const x = M.lm, y = BASE, ay = launch ? launch.y : 0;
  // legs
  ctx.strokeStyle = '#c9a34a'; ctx.lineWidth = 3;
  [[-34, -62], [34, 62]].forEach(([a, b]) => { ctx.beginPath(); ctx.moveTo(x + a, y - 34); ctx.lineTo(x + b, y - 2); ctx.stroke(); });
  ctx.lineWidth = 2;
  [[-22, -50], [22, 50]].forEach(([a, b]) => { ctx.beginPath(); ctx.moveTo(x + a, y - 40); ctx.lineTo(x + b, y - 2); ctx.stroke(); });
  ctx.fillStyle = '#9a9ca6'; [-62, 62, -50, 50].forEach(b => { ctx.beginPath(); ctx.ellipse(x + b, y - 1, 7, 2.5, 0, 0, 7); ctx.fill(); });
  // ladder
  ctx.strokeStyle = '#8a7a52'; ctx.lineWidth = 1;
  for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.moveTo(x + 40 + i * 3.6, y - 30 + i * 6); ctx.lineTo(x + 46 + i * 3.6, y - 30 + i * 6); ctx.stroke(); }
  // descent stage (stays on the Moon)
  const g = ctx.createLinearGradient(x - 40, 0, x + 40, 0);
  g.addColorStop(0, '#8a6a1f'); g.addColorStop(.35, '#e6c25c'); g.addColorStop(.6, '#c79a33'); g.addColorStop(1, '#7a5b18');
  ctx.fillStyle = g; ctx.beginPath();
  ctx.moveTo(x - 40, y - 30); ctx.lineTo(x - 30, y - 50); ctx.lineTo(x + 30, y - 50); ctx.lineTo(x + 40, y - 30); ctx.lineTo(x + 30, y - 22); ctx.lineTo(x - 30, y - 22); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 1;
  for (let i = -24; i <= 24; i += 12) { ctx.beginPath(); ctx.moveTo(x + i, y - 48); ctx.lineTo(x + i, y - 24); ctx.stroke(); }
  // ascent stage
  ctx.save(); ctx.translate(0, ay);
  if (launch && launch.over && launch.t > .5 && launch.t < 2.6) ctx.translate((Math.random() - .5) * 3, 0);
  ctx.fillStyle = '#d6d8de'; ctx.beginPath();
  ctx.moveTo(x - 30, y - 51); ctx.lineTo(x - 34, y - 70); ctx.lineTo(x - 22, y - 92); ctx.lineTo(x + 10, y - 96); ctx.lineTo(x + 30, y - 84); ctx.lineTo(x + 32, y - 60); ctx.lineTo(x + 26, y - 51); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#a4a7b0'; ctx.beginPath(); ctx.moveTo(x + 6, y - 51); ctx.lineTo(x + 30, y - 84); ctx.lineTo(x + 32, y - 60); ctx.lineTo(x + 26, y - 51); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#1b2033'; ctx.beginPath(); ctx.moveTo(x - 24, y - 84); ctx.lineTo(x - 14, y - 90); ctx.lineTo(x - 12, y - 78); ctx.lineTo(x - 24, y - 74); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#1b2033'; ctx.fillRect(x - 6, y - 72, 12, 14); // hatch
  ctx.strokeStyle = '#d6d8de'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x + 12, y - 96); ctx.lineTo(x + 18, y - 110); ctx.stroke();
  ctx.fillStyle = '#eceef2'; ctx.beginPath(); ctx.arc(x + 18, y - 112, 6, Math.PI * .9, Math.PI * 2.1); ctx.fill();
  ctx.strokeStyle = '#a4a7b0'; ctx.beginPath(); ctx.moveTo(x - 30, y - 90); ctx.lineTo(x - 36, y - 104); ctx.stroke();
  ctx.restore();
  // label when near
  if (P && state === 'play' && nearLM()) {
    ctx.font = '600 10px "IBM Plex Mono",monospace'; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(255,179,71,.9)';
    ctx.fillText('LUNAR MODULE', x, y - 126);
  }
}
function drawMark(m) {
  const x = m.x, y = gy(x);
  if (x < camX - 120 || x > camX + VW + 120) return;
  if (m.kind === 'flag') {
    ctx.strokeStyle = '#cfd2da'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 58); ctx.lineTo(x + 30, y - 58); ctx.stroke();
    ctx.fillStyle = '#e8e8ee'; ctx.fillRect(x + 1, y - 57, 28, 18);
    ctx.fillStyle = '#c0392b'; for (let i = 0; i < 4; i++) ctx.fillRect(x + 1, y - 57 + i * 4.5, 28, 2.2);
    ctx.fillStyle = '#2c3e8f'; ctx.fillRect(x + 1, y - 57, 12, 9);
  } else if (m.kind === 'plaque') {
    ctx.fillStyle = '#b8bcc6'; ctx.fillRect(x - 5, y - 28, 10, 8);
  } else if (m.kind === 'surveyor') {
    ctx.strokeStyle = '#c3c6cf'; ctx.lineWidth = 2;
    [[-22, 0], [22, 0], [0, 4]].forEach(([dx]) => { ctx.beginPath(); ctx.moveTo(x, y - 22); ctx.lineTo(x + dx, y - 1); ctx.stroke(); });
    ctx.fillStyle = '#9fa3ad'; ctx.beginPath(); ctx.moveTo(x - 10, y - 30); ctx.lineTo(x + 10, y - 30); ctx.lineTo(x + 6, y - 18); ctx.lineTo(x - 6, y - 18); ctx.fill();
    ctx.strokeStyle = '#c3c6cf'; ctx.beginPath(); ctx.moveTo(x, y - 30); ctx.lineTo(x, y - 54); ctx.stroke();
    ctx.fillStyle = '#2a3a6a'; ctx.fillRect(x - 16, y - 58, 16, 9);
    ctx.fillStyle = '#e1e3e8'; ctx.beginPath(); ctx.arc(x + 6, y - 50, 6, Math.PI, Math.PI * 2); ctx.fill();
    if (!m.used) { ctx.fillStyle = '#5b5f6b'; ctx.fillRect(x + 8, y - 32, 8, 10); ctx.fillStyle = '#ffb347'; ctx.globalAlpha = .5 + .5 * Math.sin(t * 4); ctx.fillRect(x + 8, y - 32, 8, 10); ctx.globalAlpha = 1; }
    ctx.font = '600 10px "IBM Plex Mono",monospace'; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.fillText('SURVEYOR 3 · 1967', x, y + 22);
  } else if (m.kind === 'rover') {
    ctx.fillStyle = '#c9a34a'; ctx.fillRect(x - 28, y - 22, 56, 6);
    ctx.fillStyle = '#8b8e98'; ctx.fillRect(x - 10, y - 32, 4, 10); ctx.fillRect(x + 6, y - 32, 4, 10);
    ctx.strokeStyle = '#c3c6cf'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x + 22, y - 22); ctx.lineTo(x + 26, y - 44); ctx.stroke();
    ctx.fillStyle = '#e1e3e8'; ctx.beginPath(); ctx.arc(x + 26, y - 46, 7, Math.PI * .8, Math.PI * 2.2); ctx.fill();
    ctx.strokeStyle = '#3b3e49'; ctx.lineWidth = 3;
    [-20, 20].forEach(dx => { ctx.beginPath(); ctx.arc(x + dx, y - 8, 8, 0, 7); ctx.stroke(); });
    ctx.strokeStyle = '#9a9ca6'; ctx.lineWidth = 1; [-20, 20].forEach(dx => { ctx.beginPath(); ctx.arc(x + dx, y - 8, 5, 0, 7); ctx.stroke(); });
  } else if (m.kind === 'orange') {
    ctx.fillStyle = m.used ? '#c46d2a' : '#ff8f2e';
    ctx.beginPath(); ctx.ellipse(x, y + 2, 46, 6, 0, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,190,90,.6)'; ctx.beginPath(); ctx.ellipse(x - 10, y + 1, 18, 3, 0, 0, 7); ctx.fill();
    if (!m.used) { ctx.globalAlpha = .3 + .3 * Math.sin(t * 3); ctx.fillStyle = '#ffb347'; ctx.beginPath(); ctx.ellipse(x, y, 54, 10, 0, 0, 7); ctx.fill(); ctx.globalAlpha = 1; }
  } else if (m.kind === 'boulder') {
    const gr = ctx.createLinearGradient(x - 60, y - 90, x + 60, y);
    gr.addColorStop(0, '#c4c6ce'); gr.addColorStop(1, '#5d606b');
    ctx.fillStyle = gr; ctx.beginPath();
    ctx.moveTo(x - 70, y + 4); ctx.lineTo(x - 64, y - 46); ctx.lineTo(x - 30, y - 82); ctx.lineTo(x + 18, y - 90); ctx.lineTo(x + 58, y - 60); ctx.lineTo(x + 72, y + 4); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.2)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - 20, y - 70); ctx.lineTo(x + 6, y - 30); ctx.lineTo(x + 30, y - 40); ctx.stroke();
    if (!m.used) { ctx.fillStyle = '#ffb347'; ctx.globalAlpha = .5 + .5 * Math.sin(t * 4); ctx.beginPath(); ctx.arc(x - 50, y - 20, 4, 0, 7); ctx.fill(); ctx.globalAlpha = 1; }
  }
}
function drawItem(it, x, y, deployed) {
  ctx.save(); ctx.translate(x, y);
  const glow = it.state === 'ground' && it.type !== 'junk' && !it.flying;
  if (glow) {
    ctx.globalAlpha = .25 + .2 * Math.sin(t * 4 + x);
    ctx.fillStyle = it.type === 'deploy' ? '#5ce1b9' : '#ffffff';
    ctx.beginPath(); ctx.ellipse(0, -8, 16, 14, 0, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
  }
  drawIcon(it.icon, deployed);
  ctx.restore();
}
function drawIcon(k, deployed) {
  const c = ctx;
  switch (k) {
    case 'bag': c.fillStyle = '#eef0f4'; c.beginPath(); c.moveTo(-8, 0); c.lineTo(-9, -12); c.quadraticCurveTo(0, -18, 9, -12); c.lineTo(8, 0); c.closePath(); c.fill(); c.fillStyle = '#7a7d88'; c.fillRect(-4, -15, 8, 3); c.fillStyle = '#6d707b'; c.beginPath(); c.arc(-2, -6, 2.5, 0, 7); c.arc(3, -4, 2, 0, 7); c.fill(); break;
    case 'core': c.fillStyle = '#b0b4be'; c.save(); c.rotate(-.5); c.fillRect(-2.5, -20, 5, 22); c.fillStyle = '#6d707b'; c.fillRect(-2.5, -20, 5, 4); c.restore(); break;
    case 'film': c.fillStyle = '#1a1c22'; c.fillRect(-7, -12, 14, 12); c.fillStyle = '#c3c6cf'; c.fillRect(-7, -12, 14, 3); c.fillStyle = '#ffb347'; c.fillRect(-2, -7, 4, 4); break;
    case 'mirror':
      if (deployed) { c.fillStyle = '#8b8e98'; c.fillRect(-2, -10, 4, 10); c.save(); c.translate(0, -12); c.rotate(-.35); c.fillStyle = '#cfd2da'; c.fillRect(-16, -6, 32, 12); c.fillStyle = '#5a6a90'; for (let i = -13; i < 14; i += 4.5) for (let j = -4; j < 5; j += 4.5) { c.beginPath(); c.arc(i + 1, j + 1, 1.6, 0, 7); c.fill(); } c.restore(); }
      else { c.fillStyle = '#cfd2da'; c.fillRect(-11, -14, 22, 14); c.fillStyle = '#5a6a90'; for (let i = -8; i < 9; i += 4.5) for (let j = -11; j < -1; j += 4.5) { c.beginPath(); c.arc(i, j + 1, 1.4, 0, 7); c.fill(); } }
      break;
    case 'seis':
      c.fillStyle = '#d4a93c'; c.beginPath(); c.moveTo(-7, 0); c.lineTo(-5, -16); c.lineTo(5, -16); c.lineTo(7, 0); c.fill();
      c.fillStyle = '#c3c6cf'; c.fillRect(-4, -20, 8, 4);
      if (deployed) { c.fillStyle = '#2a3a6a'; c.fillRect(-24, -14, 16, 8); c.fillRect(8, -14, 16, 8); c.strokeStyle = '#c3c6cf'; c.lineWidth = 1; c.beginPath(); c.moveTo(0, -20); c.lineTo(0, -32); c.stroke(); c.fillStyle = '#5ce1b9'; c.globalAlpha = .5 + .5 * Math.sin(t * 6); c.beginPath(); c.arc(0, -33, 2, 0, 7); c.fill(); c.globalAlpha = 1; }
      break;
    case 'sws': c.fillStyle = '#c3c6cf'; c.fillRect(-8, -10, 16, 10); c.fillStyle = '#2a3a6a'; c.beginPath(); c.arc(0, -12, deployed ? 8 : 5, Math.PI, 0); c.fill(); if (deployed) { c.fillStyle = '#5ce1b9'; c.globalAlpha = .5 + .5 * Math.sin(t * 6); c.fillRect(-1, -24, 2, 4); c.globalAlpha = 1; } break;
    case 'heat': c.fillStyle = '#c3c6cf'; c.fillRect(-6, -10, 12, 10); c.fillStyle = '#d4a93c'; c.fillRect(-1.5, deployed ? -4 : -24, 3, deployed ? 20 : 14); if (deployed) { c.strokeStyle = '#8b8e98'; c.beginPath(); c.moveTo(6, -5); c.lineTo(22, -2); c.stroke(); c.fillStyle = '#5ce1b9'; c.globalAlpha = .5 + .5 * Math.sin(t * 6); c.beginPath(); c.arc(0, -13, 2, 0, 7); c.fill(); c.globalAlpha = 1; } break;
    case 'geo': c.fillStyle = '#c3c6cf'; c.fillRect(-8, -8, 16, 8); c.fillStyle = '#d4a93c'; c.fillRect(-6, -12, 12, 4); if (deployed) { c.fillStyle = '#9a9ca6'; [-30, -18, 18, 30].forEach(dx => { c.fillRect(dx - 2, -4, 4, 4); }); c.strokeStyle = '#6d707b'; c.beginPath(); c.moveTo(-30, -2); c.lineTo(30, -2); c.stroke(); } break;
    case 'pack': c.fillStyle = '#e6e8ee'; c.fillRect(-9, -18, 18, 18); c.fillStyle = '#b8bcc6'; c.fillRect(-9, -18, 18, 4); c.fillStyle = '#5b5f6b'; c.fillRect(-4, -11, 8, 3); break;
    case 'cam': c.fillStyle = '#c3c6cf'; c.fillRect(-8, -12, 16, 12); c.fillStyle = '#1a1c22'; c.beginPath(); c.arc(0, -6, 4, 0, 7); c.fill(); break;
    case 'boots': c.fillStyle = '#b8c0d4'; c.fillRect(-10, -10, 7, 10); c.fillRect(-10, -3, 11, 3); c.fillRect(3, -10, 7, 10); c.fillRect(3, -3, 11, 3); break;
    case 'trash': c.fillStyle = '#e6e8ee'; c.beginPath(); c.ellipse(0, -7, 8, 7, 0, 0, 7); c.fill(); c.fillStyle = '#9a9ca6'; c.fillRect(-2, -16, 4, 4); break;
    case 'tools': c.strokeStyle = '#c3c6cf'; c.lineWidth = 2.5; c.beginPath(); c.moveTo(-10, -2); c.lineTo(8, -16); c.stroke(); c.fillStyle = '#8b8e98'; c.fillRect(4, -20, 10, 5); break;
    case 'scam': c.fillStyle = '#5b5f6b'; c.fillRect(-7, -12, 14, 12); c.fillStyle = '#c3c6cf'; c.fillRect(-7, -12, 14, 3); c.fillStyle = '#1a1c22'; c.beginPath(); c.arc(0, -5, 3, 0, 7); c.fill(); break;
    case 'orange': c.fillStyle = '#eef0f4'; c.beginPath(); c.moveTo(-8, 0); c.lineTo(-9, -12); c.quadraticCurveTo(0, -18, 9, -12); c.lineTo(8, 0); c.closePath(); c.fill(); c.fillStyle = '#ff8f2e'; c.beginPath(); c.arc(-2, -6, 2.6, 0, 7); c.arc(3, -4, 2.2, 0, 7); c.arc(1, -9, 2, 0, 7); c.fill(); break;
    case 'chip': c.fillStyle = '#9fa3ad'; c.beginPath(); c.moveTo(-8, 0); c.lineTo(-6, -10); c.lineTo(4, -13); c.lineTo(9, -4); c.lineTo(6, 0); c.closePath(); c.fill(); break;
  }
}
function drawAstronaut() {
  const x = P.x, y = P.y, f = P.face, w = P.walk;
  const bob = P.on ? Math.abs(Math.sin(w)) * -3 : 0;
  ctx.save(); ctx.translate(x, y + bob); ctx.scale(f, 1);
  // legs
  const l1 = Math.sin(w) * 7, l2 = -l1;
  ctx.strokeStyle = '#e9ebf0'; ctx.lineWidth = 6; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-3, -16); ctx.lineTo(-3 + l1, -2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(3, -16); ctx.lineTo(3 + l2, -2); ctx.stroke();
  ctx.fillStyle = '#9fa3ad'; ctx.fillRect(-6 + l1, -3, 7, 3); ctx.fillRect(0 + l2, -3, 7, 3);
  // backpack
  ctx.fillStyle = '#cfd2da'; ctx.fillRect(-15, -38, 9, 22); ctx.fillStyle = '#a4a7b0'; ctx.fillRect(-15, -38, 9, 4);
  // torso
  ctx.fillStyle = '#f2f3f6'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-8, -40, 16, 26, 5) : ctx.rect(-8, -40, 16, 26); ctx.fill();
  ctx.fillStyle = '#c0392b'; ctx.fillRect(-2, -34, 6, 2);
  ctx.fillStyle = '#2c3e8f'; ctx.fillRect(-2, -30, 6, 4);
  // arm
  const carrying = !!P.carry;
  ctx.strokeStyle = '#e9ebf0'; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(2, -36);
  if (carrying) ctx.lineTo(13, -28); else ctx.lineTo(4 - l1 * .6, -20);
  ctx.stroke();
  // helmet
  ctx.fillStyle = '#f2f3f6'; ctx.beginPath(); ctx.arc(1, -48, 10, 0, 7); ctx.fill();
  const vg = ctx.createLinearGradient(0, -56, 10, -40);
  vg.addColorStop(0, '#ffd27a'); vg.addColorStop(.5, '#c98a2a'); vg.addColorStop(1, '#6a4310');
  ctx.fillStyle = vg; ctx.beginPath(); ctx.ellipse(4, -48, 6.5, 6, 0, 0, 7); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.beginPath(); ctx.ellipse(6, -51, 2, 1.2, -.5, 0, 7); ctx.fill();
  ctx.restore();
  if (P.carry) { ctx.save(); ctx.translate(x + f * 15, y + bob - 18); drawIcon(P.carry.icon, false); ctx.restore(); }
}
function drawMinimap() {
  const w = Math.min(320, VW * .4), x0 = (VW - w) / 2, y0 = 22, sx = w / M.width;
  ctx.fillStyle = 'rgba(8,11,20,.7)'; ctx.strokeStyle = 'rgba(60,70,100,.8)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x0 - 8, y0 - 10, w + 16, 22, 8) : ctx.rect(x0 - 8, y0 - 10, w + 16, 22); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + w, y0); ctx.stroke();
  ctx.fillStyle = '#ffb347'; ctx.fillRect(x0 + M.lm * sx - 3, y0 - 5, 6, 8);
  for (const it of items) {
    if (it.type === 'deploy' && it.state !== 'deployed') { ctx.strokeStyle = '#5ce1b9'; ctx.beginPath(); ctx.arc(x0 + it.zone * sx, y0, 3.5, 0, 7); ctx.stroke(); }
    if (it.state === 'ground' && it.type !== 'junk') { ctx.fillStyle = it.type === 'deploy' ? '#5ce1b9' : '#fff'; ctx.beginPath(); ctx.arc(x0 + it.x * sx, y0, 2.2, 0, 7); ctx.fill(); }
  }
  for (const m of marks) if (m.gives && !m.used) { ctx.fillStyle = '#ff8f2e'; ctx.beginPath(); ctx.arc(x0 + m.x * sx, y0, 3, 0, 7); ctx.fill(); }
  ctx.fillStyle = '#fff'; ctx.beginPath(); const px = x0 + P.x * sx; ctx.moveTo(px, y0 - 2); ctx.lineTo(px - 4, y0 - 9); ctx.lineTo(px + 4, y0 - 9); ctx.fill();
}

// ---------- loop ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(.033, (now - last) / 1000); last = now;
  update(dt); draw();
  requestAnimationFrame(frame);
}
function trySkip() { if (state === 'launch' && launch && !launch.over && launch.t > 4.4) launch.skip = true; }
addEventListener('keydown', trySkip);
cv.addEventListener('pointerdown', trySkip);
addEventListener('resize', resize);
addEventListener('blur', () => { for (const k in keys) keys[k] = false; if (state === 'play') togglePause(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') togglePause(); });

makeStars(); resize(); toMenu();
// expose for testing
window.__LIB = { get state() { return state; }, get P() { return P; }, get items() { return items; }, get o2() { return o2; }, startMission, MISSIONS };
requestAnimationFrame(frame);
})();

// Game controller: fixed-timestep loop, input, feel (hit-stop, shake, slow-mo),
// audio/haptics, saving, screens. The simulation itself lives in src/sim.

import './style.css';
import { BALL_D, generateLevel, isLargeCampaign, LARGE_PREFIX, type Level, MUTATOR_INFO } from './sim/levelgen';
import {
  ballPos,
  type Command,
  createGame,
  DT,
  type GameEvent,
  type GameState,
  POWER_NAMES,
  Power,
  isRolling,
  launcherAt,
  progress,
  railPoint,
  railProject,
  raycast,
  runIfInserted,
  snapshot,
  step,
  TICK_HZ,
  TUNING,
} from './sim/game';
import { BOT_PRESETS, decide } from './sim/bot';
import { assistAim, type Slot } from './sim/aim';
import { characterNoun } from './game/characters';
import { Rng } from './sim/rng';
import { pointAt, type Pt } from './sim/track';
import { computeLayout, type Layout, screenToWorld } from './game/layout';
import { BOLT_LIFE, Renderer, PALETTE, type ViewState } from './game/render';
import { Particles } from './game/fx';
import { FEEL, feedbackFor, shakeOffset, springAngle } from './game/feel';
import { Audio } from './game/audio';
import { Haptics } from './game/haptics';
import { UI } from './game/ui';
import {
  dailySeed,
  type EndlessRun,
  endlessSeed,
  freshSave,
  levelsUpdated,
  loadSave,
  parseLevelCode,
  type SaveData,
  starsFor,
  switchCampaign,
  writeSave,
} from './game/save';

type Mode = 'title' | 'playing' | 'paused' | 'result';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const renderer = new Renderer(canvas);
const fx = new Particles();
const audio = new Audio();
const haptics = new Haptics();
let save: SaveData = loadSave();

let mode: Mode = 'title';
let attract = true; // bot plays behind the title screen
let level: Level;
let st: GameState;
let layout: Layout;
let pending: Command[] = [];
let recording: [number, Command][] = [];
let acc = 0;
let hitstop = 0; // ms
let slowmo: { scale: number; left: number } | null = null;
let peakDanger = 0;
let resultTimer = -1;
/** Endless run being played (null in the campaign). */
let run: EndlessRun | null = null;
let lastHitBall = -1;
let heartT = 0;
let autosaveT = 0;
let botRng = new Rng(1);
const eventLog: { t: number; e: GameEvent }[] = [];
const feelLog: { tick: number; type: string; hitstop: number; trauma: number; flash: number; particles: number; sound: string | null }[] = [];

const view: ViewState = {
  time: 0,
  aimAngle: -Math.PI / 2,
  aimShot: -Math.PI / 2,
  aimActive: false,
  aimIdle: false,
  aimCancel: false,
  aimHit: null,
  aimWillPop: false,
  recoil: 0,
  trauma: 0,
  shake: { x: 0, y: 0, rot: 0 },
  flash: 0,
  danger: 0,
  ripples: new Map(),
  ripple0: null,
  shotTrails: new Map(),
  bolts: [],
  colorblind: false,
  showGuide: true,
  aimFrom: null,
  aimCoin: false,
  cursor: null,
  homing: [],
  sweep: null,
  bossDown: -1,
  spitAge: 9,
  banner: null,
  hue: 200,
};
/** Rail fights: the rail spot the player is aiming from. */
let railAimU = 0;
/** Trackpad aiming: the crosshair the finger moves (world coords). */
const padCursor: Pt = { x: 0, y: 0 };
let padLast: { x: number; y: number } | null = null;
const PAD_GAIN = 0.8;
let lastPointer = 'mouse';
/** End-of-level tally: track bonus counting up during the light sweep, then ace time. */
let tally: { sweep: number; ace: number; ticks: number; done: boolean; aceShown: boolean } | null = null;
let cascadeN = 0;
let stuns = 0;
let aimVel = 0;
let aimTarget = -Math.PI / 2;

// ------------------------------------------------------------------ level lifecycle

function hueFor(lvl: Level) {
  return [195, 165, 260, 215, 285, 140, 330, 20][lvl.index % 8] + ((lvl.seed % 20) - 10);
}

/** Generated cruise speed of the current level (Relaxed speed scales a copy of it). */
let baseSpeed = 0;
function applySpeed() {
  if (!level) return;
  level.speed = baseSpeed * (save.settings.relaxed && !attract ? 0.75 : 1);
}

function loadLevel(seed: string, index: number, state?: GameState) {
  level = generateLevel(seed, index);
  baseSpeed = level.speed;
  applySpeed();
  st = state ?? createGame(level);
  view.hue = hueFor(level);
  renderer.setLevel(level, view.hue);
  // Board size can differ per campaign (large marbles): re-fit to the screen.
  if (layout) resize();
  pending = [];
  recording = [];
  acc = 0;
  hitstop = 0;
  slowmo = null;
  peakDanger = 0;
  resultTimer = -1;
  fx.list.length = 0;
  view.ripples.clear();
  view.shotTrails.clear();
  view.bolts.length = 0;
  view.homing.length = 0;
  view.sweep = null;
  view.bossDown = -1;
  tally = null;
  cascadeN = 0;
  stuns = 0;
  view.banner = null;
  view.danger = 0;
  view.trauma = 0;
  view.flash = 0;
  aimTarget = level.rail ? Math.atan2(level.rail.n.y, level.rail.n.x) : aimAngleToward({ x: level.launcher.x, y: 0 });
  view.aimAngle = aimTarget;
  rawAim = aimTarget;
  if (level.rail) {
    railAimU = level.rail.len / 2;
    const p = railPoint(level.rail, railAimU);
    padCursor.x = p.x + level.rail.n.x * 320;
    padCursor.y = p.y + level.rail.n.y * 320;
  } else {
    // Start the crosshair a little above the launcher on screen (portrait boards are rotated).
    const up = layout?.portrait ? { x: -1, y: 0 } : { x: 0, y: -1 };
    padCursor.x = level.launcher.x + up.x * 200;
    padCursor.y = level.launcher.y + up.y * 200;
    if (save.settings.touchAim === 'pad') rawAim = aimTarget = aimAngleToward(padCursor);
  }
  aimSlot = null;
  aimLocked = false;
  hold = null;
  ui.resetHud();
}

function startLevel(index: number, fromSnapshot = false) {
  attract = false;
  run = null;
  if (fromSnapshot && save.snapshot) loadLevel(save.campaignSeed, save.snapshot.levelIndex, save.snapshot.state);
  else {
    loadLevel(save.campaignSeed, index);
    save.snapshot = null;
    writeSave(save);
  }
  beginPlay();
}

/** Endless: a fresh run (random seed, or today's daily seed). Board size follows the campaign. */
function startEndless(daily: boolean) {
  attract = false;
  const prefix = isLargeCampaign(save.campaignSeed) ? LARGE_PREFIX : '';
  run = { seed: prefix + (daily ? dailySeed() : endlessSeed()), daily, stage: 0, runScore: 0, snapshot: null };
  save.endless = run;
  writeSave(save);
  loadLevel(run.seed, 0);
  beginPlay();
}

function continueEndless() {
  if (!save.endless) return;
  attract = false;
  run = save.endless;
  loadLevel(run.seed, run.stage, run.snapshot ?? undefined);
  beginPlay();
}

/** Level-start banner: boss / mini-boss / level number, plus a note for twists and two chains. */
function levelBanner(): string[] {
  const label = run ? `Stage ${level.index + 1}` : `Level ${level.index + 1}`;
  const ace = `ace time ${mmss(level.ace)}`;
  if (level.boss === 'boss') view.banner = { text: 'BOSS FIGHT', sub: `${label} · ${level.name} · ${ace}`, t: 0, color: '#ff6b81' };
  else if (level.boss === 'mini') view.banner = { text: 'MINI-BOSS', sub: `${label} · ${level.name} · ${ace}`, t: 0, color: '#ffb36b' };
  else view.banner = { text: label, sub: `${level.name} · ${ace}`, t: 0, color: '#ffe08a' };
  const notes: string[] = [];
  if (level.bossFight?.kind === 'serpent') notes.push('Mini-boss! A serpent guards the skull — pop marbles to hurt it, or hit it while it rears up to spit');
  if (level.rail) notes.push(coarsePointer.matches ? 'Boss fight! Drag anywhere to slide · press FIRE to shoot (hold to keep firing) · dodge the rocks' : 'Boss fight! Move along your rail · click to shoot · pop marbles to hurt the boss · dodge its rocks');
  if (level.tracks.length > 1) notes.push('Two chains — watch both skulls!');
  for (const m of level.mutators) notes.push(`${MUTATOR_INFO[m].name}: ${MUTATOR_INFO[m].desc}`);
  return notes;
}

function mmss(sec: number) {
  return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
}

/** Boss fights on touch screens use their own controls: drag moves the frog, the Fire button shoots. */
const coarsePointer = matchMedia('(pointer: coarse)');
function railTouch() {
  return !!level?.rail && !attract && coarsePointer.matches;
}

function beginPlay() {
  mode = 'playing';
  document.body.classList.toggle('rail-touch', railTouch());
  ui.hide();
  ui.showHud(true);
  const notes = levelBanner();
  audio.unlock();
  requestWakeLock();
  if (notes.length) ui.toast(notes.join(' · '), level.rail ? 4200 : 2800);
  if (!save.tutorialSeen) {
    save.tutorialSeen = true;
    writeSave(save);
    const noun = characterNoun(save.settings.character);
    const touchHint =
      save.settings.touchAim === 'aimtap'
        ? `Drag to aim · tap to shoot · tap the ${noun} to swap`
        : save.settings.touchAim === 'tap'
          ? `Tap to shoot · tap the ${noun} to swap`
          : `Drag to aim · release to shoot · slide to ✕ to cancel · tap the ${noun} to swap`;
    ui.toast(matchMedia('(pointer: coarse)').matches ? touchHint : 'Move to aim · click (or hold) to shoot · right-click / Space to swap', 4800);
  }
}

function startAttract() {
  attract = true;
  loadLevel('attract-demo', 2 + Math.floor(Math.random() * 6));
  botRng = new Rng(7);
}

function toTitle() {
  mode = 'title';
  document.body.classList.remove('rail-touch');
  ui.showHud(false);
  ui.title(save);
  startAttract();
  releaseWakeLock();
}

function saveSnapshot() {
  if (attract || mode === 'title' || mode === 'result' || !st || st.phase !== 'playing') return;
  if (run) {
    run.stage = level.index;
    run.snapshot = JSON.parse(snapshot(st));
    save.endless = run;
  } else save.snapshot = { levelIndex: level.index, state: JSON.parse(snapshot(st)), savedAt: Date.now() };
  writeSave(save);
}

function pause() {
  if (mode !== 'playing') return;
  mode = 'paused';
  view.aimActive = false;
  saveSnapshot();
  ui.pause(save, level, run);
  releaseWakeLock();
}

/** Endless: a cleared stage rolls straight into the next; losing ends the run. */
function endlessStageDone(won: boolean, r: EndlessRun) {
  if (won) {
    r.runScore += st.score;
    r.stage = level.index + 1;
    r.snapshot = null;
    save.endless = r;
    writeSave(save);
    loadLevel(r.seed, r.stage);
    beginPlay();
    return;
  }
  mode = 'result';
  ui.showHud(false);
  const total = r.runScore + st.score;
  const stage = level.index + 1;
  let newBest = false;
  if (r.daily) {
    const day = r.seed.replace(/^(xl-)?daily-/, '');
    const prev = save.dailyBest?.day === day ? save.dailyBest : undefined;
    newBest = !prev || total > prev.score;
    if (newBest) save.dailyBest = { day, score: total, stage };
  } else {
    newBest = !save.endlessBest || total > save.endlessBest.score;
    if (newBest) save.endlessBest = { score: total, stage };
  }
  save.endless = null;
  writeSave(save);
  ui.endlessOver({ daily: r.daily, total, stage, newBest, best: (r.daily ? save.dailyBest?.score : save.endlessBest?.score) ?? total });
  releaseWakeLock();
}

/** Losses in a row per level (this session), to offer help when someone is stuck. */
const lossStreak = new Map<number, number>();

/** One helpful, specific tip after losing a level. */
function lossTip(): string {
  const s = st.stats;
  const coarse = matchMedia('(pointer: coarse)').matches;
  const noun = characterNoun(save.settings.character);
  if ((lossStreak.get(level.index) ?? 0) >= 2 && !save.settings.relaxed) return 'Stuck? Turn on <b>Relaxed speed</b> in Settings — chains roll 25% slower.';
  if (level.rail && stuns >= 2) return 'The yellow target follows you while the idol winds up, then turns <b>red and locks</b> — slide away before the rock lands.';
  if (level.bossFight?.kind === 'serpent') return 'Every marble you pop hurts the serpent — <b>combos</b> hurt it more. It swallows shots, but hit the <b>target ring while it rears up</b> to choke it: big damage and 3-5 power-ups along the chain.';
  if (level.rail && s.bossHits === 0) return 'Shoot through <b>gaps in the chain</b> to hit the boss directly — and every marble you pop hurts it.';
  if (level.tracks.length > 1) return 'Two chains: deal with whichever is <b>closer to its skull</b> first.';
  if (s.shots >= 8 && s.misses / s.shots > 0.3) return 'Missed shots fly off the board. The <b>ghost marble</b> shows exactly where a shot will land.';
  if (s.powers === 0) return 'Pop the marbles with a <b>white ring</b>: Slow and Reverse buy you time.';
  if (s.maxCombo === 0) return 'When both sides of a gap match, they <b>snap together</b> and pop again — a combo.';
  return coarse ? `No good match for this marble? <b>Tap your ${noun}</b> to swap to the next one.` : 'No good match for this marble? <b>Right-click</b> or press <b>Space</b> to swap.';
}

function finishLevel(won: boolean) {
  if (run) return endlessStageDone(won, run);
  mode = 'result';
  ui.showHud(false);
  const seconds = st.tick / TICK_HZ;
  const stars = won ? starsFor(peakDanger) : 0;
  const prev = save.best[level.index];
  if (won) {
    if (!prev || st.score > prev.score || stars > prev.stars) {
      save.best[level.index] = { score: Math.max(st.score, prev?.score ?? 0), stars: Math.max(stars, prev?.stars ?? 0), seconds };
    }
    save.unlocked = Math.max(save.unlocked, level.index + 1);
    save.totalScore += st.score;
  }
  save.snapshot = null;
  writeSave(save);
  if (won) lossStreak.delete(level.index);
  else lossStreak.set(level.index, (lossStreak.get(level.index) ?? 0) + 1);
  ui.result(won, st, level, stars, seconds, save.best[level.index]?.score ?? st.score, peakDanger, won ? '' : lossTip());
  releaseWakeLock();
}

// ------------------------------------------------------------------ UI wiring

const ui = new UI({
  play: (i) => startLevel(i),
  continueSnapshot: () => startLevel(0, true),
  resume: () => {
    mode = 'playing';
    ui.hide();
    audio.unlock();
    requestWakeLock();
  },
  restart: () => (run ? startEndless(run.daily) : startLevel(level.index)),
  endless: (daily) => startEndless(daily),
  continueEndless: () => continueEndless(),
  quit: () => {
    saveSnapshot();
    toTitle();
  },
  showLevels: () => {
    toTitle();
    ui.levels(save);
  },
  next: () => startLevel(level.index + 1),
  settingsChanged: (s) => {
    applySettings();
    writeSave(save);
    void s;
  },
  resetProgress: () => {
    const settings = save.settings;
    save = freshSave();
    save.settings = settings;
    writeSave(save);
    toTitle();
    ui.toast('Progress reset — new campaign ' + save.campaignSeed);
  },
  setLargeMarbles: (large) => {
    const base = save.campaignSeed.replace(/^xl-/, '');
    save = switchCampaign(save, large ? `xl-${base}` : base);
    writeSave(save);
    toTitle();
    ui.levels(save);
    ui.toast(large ? 'Large marbles: bigger marbles, own levels & progress' : 'Normal marbles');
  },
  newCampaign: (seed) => {
    const clean = seed.replace(/[^\w-]/g, '').slice(0, 40);
    if (!clean) return;
    const settings = save.settings;
    save = freshSave(clean);
    save.settings = settings;
    writeSave(save);
    ui.levels(save);
    ui.toast(`New campaign “${clean}”`);
  },
  unlockTo: (index, play) => {
    const before = save.unlocked;
    save.unlocked = Math.max(save.unlocked, index);
    save.snapshot = null;
    writeSave(save);
    if (play) startLevel(index);
    else {
      ui.levels(save);
      if (save.unlocked > before) ui.toast(`Unlocked up to level ${save.unlocked + 1}`);
    }
  },
  playCode: (code) => {
    const p = parseLevelCode(code);
    if (!p) return ui.toast('Level codes look like  jade-1234/12');
    if (p.seed !== save.campaignSeed) {
      const settings = save.settings;
      save = freshSave(p.seed);
      save.settings = settings;
    }
    save.unlocked = Math.max(save.unlocked, p.index);
    writeSave(save);
    startLevel(p.index);
  },
  install: () => void installPrompt?.prompt(),
  click: () => {
    audio.unlock();
    audio.play('ui');
  },
});

function applySettings() {
  const s = save.settings;
  audio.setVolumes(s.sfx, s.music);
  haptics.enabled = s.haptics;
  document.getElementById('tapzone')!.classList.toggle('hidden', !(haptics.iosTap && s.haptics));
  view.colorblind = s.colorblind;
  view.showGuide = s.guide;
  renderer.character = s.character;
  applySpeed();
  document.body.classList.toggle('lefty', s.leftHanded);
  document.body.classList.toggle('large-ui', s.largeUi);
  setUiScale();
}

/** Menus scale up on big screens (and with "Larger text & buttons"). */
function setUiScale() {
  const k = Math.max(1, Math.min(1.35, window.innerHeight / 820, window.innerWidth / 700)) * (save.settings.largeUi ? 1.15 : 1);
  document.documentElement.style.setProperty('--ui', k.toFixed(3));
}

// ------------------------------------------------------------------ layout

const safeProbe = document.getElementById('safe-probe') as HTMLElement;
function readInsets() {
  // Padding on a fixed probe resolves env(safe-area-inset-*) to real pixels.
  const cs = getComputedStyle(safeProbe);
  const px = (v: string) => parseFloat(v) || 0;
  return { top: px(cs.paddingTop), bottom: px(cs.paddingBottom), left: px(cs.paddingLeft), right: px(cs.paddingRight) };
}

function resize() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // Up to 3× so text and marbles are pixel-sharp on modern phones (iPhones are 3×).
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  layout = computeLayout(vw, vh, dpr, readInsets(), level ? { w: level.worldW, h: level.worldH } : undefined);
  canvas.style.width = `${vw}px`;
  canvas.style.height = `${vh}px`;
  renderer.setLayout(layout);
  placeCancelZone();
  setUiScale();
}

/** Keep the cancel target off the board: bottom bar in portrait, the side margin in landscape. */
function placeCancelZone() {
  const z = document.getElementById('cancel-zone');
  if (!z) return;
  if (layout.portrait) {
    z.classList.remove('compact');
    z.style.left = '';
    return;
  }
  z.classList.add('compact');
  z.style.left = `${Math.max(46, layout.board.x / 2)}px`;
}
window.addEventListener('resize', resize);
window.visualViewport?.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 300));
// iOS standalone apps often get their safe-area insets *after* load, with no resize event:
// watch the probe (its content box shrinks when insets appear) and re-layout.
let lastInsets = '';
new ResizeObserver(() => {
  const k = JSON.stringify(readInsets());
  if (k !== lastInsets) {
    lastInsets = k;
    resize();
  }
}).observe(safeProbe);

// ------------------------------------------------------------------ input

function aimAngleToward(w: Pt) {
  return Math.atan2(w.y - level.launcher.y, w.x - level.launcher.x);
}

function onLauncher(w: Pt) {
  const L = launcherAt(st, level);
  return Math.hypot(w.x - L.x, w.y - L.y) < 58;
}

interface TouchAim {
  id: number;
  sx: number;
  sy: number;
  onFrog: boolean;
  moved: boolean;
  /** A second finger touched down: this drag will not fire. */
  cancelled: boolean;
}
let touchStart: TouchAim | null = null;
/** Raw (unassisted) aim angle from the pointer, and its recent history for lift-off compensation. */
let rawAim = -Math.PI / 2;
const aimHistory: { t: number; a: number; u: number }[] = [];
let aimSlot: Slot | null = null;
/** Aim + tap mode: the aim stays set after lifting; the next tap fires along it. */
let aimLocked = false;
const LIFTOFF_MS = 70;

/**
 * Hold to keep shooting. Mouse and Tap mode fire on press and repeat while held;
 * Drag and Aim + tap start firing once a press is held still for HOLD_MS (a drag
 * cancels it, so dragging to aim still works). Repeats whenever the gun is ready.
 */
interface Hold {
  id: number;
  since: number;
  active: boolean;
  lastShot: number;
  shots: number;
}
let hold: Hold | null = null;
const HOLD_MS = 380;
const REPEAT_MS = 260;

function startHold(id: number, firedNow: boolean) {
  if (!save.settings.holdFire) return;
  const now = performance.now();
  hold = { id, since: now, active: false, lastShot: firedNow ? now : -1e9, shots: firedNow ? 1 : 0 };
}

/** Called every frame: fire along the current aim while a hold is active. */
function pumpHold() {
  if (!hold) return;
  if (mode !== 'playing' || attract || st.phase !== 'playing') {
    hold = null;
    return;
  }
  const now = performance.now();
  if (!hold.active) {
    if (now - hold.since < HOLD_MS) return;
    hold.active = true;
  }
  if (view.aimCancel || st.gun.cool > 0 || st.rail?.q || now - hold.lastShot < REPEAT_MS) return;
  if (pending.some((c) => c.type === 'fire')) return;
  fireAim();
  hold.lastShot = now;
  hold.shots++;
}

const stage = document.getElementById('stage') as HTMLElement;
const cancelZone = document.getElementById('cancel-zone') as HTMLElement;

function setRawAim(w: Pt) {
  rawAim = aimAngleToward(w);
  if (level.rail) railAimU = railProject(level.rail, w.x, w.y);
  aimHistory.push({ t: performance.now(), a: rawAim, u: railAimU });
  if (aimHistory.length > 24) aimHistory.shift();
}

/** Aim from ~70 ms before lift-off: fingers drift as they lift. */
function liftoffAim(): { a: number; u: number } {
  const now = performance.now();
  const cur = { a: rawAim, u: railAimU };
  for (let i = aimHistory.length - 1; i >= 0; i--) {
    const h = aimHistory[i];
    if (now - h.t >= LIFTOFF_MS) return now - h.t < 250 ? h : cur;
  }
  return aimHistory.length ? aimHistory[0] : cur;
}

/** Shoot along an aim: an angle from the launcher, or (boss fights) a spot on the rail. */
function fireAim(a = rawAim, u = railAimU) {
  const R = level.rail;
  if (R) {
    const p = railPoint(R, u);
    queueFire({ x: p.x + R.n.x * 300, y: p.y + R.n.y * 300 });
    return;
  }
  const s = shotAngle(a);
  aimTarget = s;
  fireAngle(s);
}

/** Boss fights: the frog follows the aim along its rail while the player is aiming. */
function pumpRail() {
  const R = level.rail;
  if (!R || !st.rail || attract || mode !== 'playing' || st.phase !== 'playing') return;
  if (!view.aimActive || Math.abs(railAimU - st.rail.tu) < 1 || pending.length) return;
  const p = railPoint(R, railAimU);
  pending.push({ type: 'move', x: p.x + R.n.x * 300, y: p.y + R.n.y * 300 });
}

/** Final shot direction for a raw angle: aim assist keeps it in the previewed slot. */
function shotAngle(raw: number): number {
  if (!save.settings.assist) return raw;
  return assistAim(st, level, raw, aimSlot).angle;
}

function fireAngle(a: number) {
  queueFire({ x: level.launcher.x + Math.cos(a) * 300, y: level.launcher.y + Math.sin(a) * 300 });
}

function inCancelZone(clientX: number, clientY: number): boolean {
  if (!cancelZone.classList.contains('show')) return false;
  const r = cancelZone.getBoundingClientRect();
  const pad = 22;
  return clientX > r.left - pad && clientX < r.right + pad && clientY > r.top - pad && clientY < r.bottom + pad;
}

function setCancelUi(show: boolean, armed: boolean, text = '✕ Cancel') {
  cancelZone.classList.toggle('show', show);
  cancelZone.classList.toggle('armed', armed);
  const compact = cancelZone.classList.contains('compact');
  cancelZone.textContent = compact ? (armed ? '✕ Release' : text.startsWith('✕ Cancelled') ? '✕ Lift' : '✕ Cancel') : armed ? '✕ Release to cancel' : text;
  view.aimCancel = show && armed;
}

function queueFire(w: Pt) {
  if (mode !== 'playing' || st.phase !== 'playing') return;
  if (Math.hypot(w.x - level.launcher.x, w.y - level.launcher.y) < 4) return;
  pending.push({ type: 'fire', x: w.x, y: w.y });
}
function queueSwap() {
  if (mode !== 'playing' || st.phase !== 'playing') return;
  pending.push({ type: 'swap' });
}

stage.addEventListener('contextmenu', (e) => e.preventDefault());
stage.addEventListener('pointerdown', (e) => {
  audio.unlock();
  lastPointer = e.pointerType;
  if (mode !== 'playing') return;
  const w = screenToWorld(layout, e.clientX, e.clientY);
  if (e.pointerType === 'mouse') {
    setRawAim(w);
    view.aimActive = true;
    if (e.button === 2) queueSwap();
    else if (e.button === 0) {
      if (onLauncher(w)) queueSwap();
      else {
        fireAim();
        startHold(e.pointerId, true);
      }
    }
    return;
  }
  // Boss fights: touching the board only moves the frog (the Fire button shoots); tap the frog to swap.
  if (level.rail) {
    if (touchStart && touchStart.id !== e.pointerId) return;
    document.body.classList.add('rail-touch'); // touch laptops: show the Fire button once touch is used
    stage.setPointerCapture(e.pointerId);
    const frog = onLauncher(w);
    touchStart = { id: e.pointerId, sx: e.clientX, sy: e.clientY, onFrog: frog, moved: false, cancelled: false };
    if (!frog) setRawAim(w);
    view.aimActive = true;
    return;
  }
  // A second finger while aiming cancels the shot.
  if (touchStart && touchStart.id !== e.pointerId) {
    if (hold?.id === touchStart.id) hold = null;
    if (save.settings.touchAim === 'aimtap' || save.settings.touchAim === 'pad') return; // lifting never fires in these modes
    if (!touchStart.cancelled && view.aimActive) {
      touchStart.cancelled = true;
      view.aimActive = false;
      setCancelUi(true, false, '✕ Cancelled — lift to retry');
      audio.play('cancel');
      haptics.pulse([8]);
    }
    return;
  }
  stage.setPointerCapture(e.pointerId);
  const frog = onLauncher(w);
  touchStart = { id: e.pointerId, sx: e.clientX, sy: e.clientY, onFrog: frog, moved: false, cancelled: false };
  aimHistory.length = 0;
  // Trackpad: the finger moves a crosshair from wherever it lands; a tap fires.
  if (save.settings.touchAim === 'pad') {
    padLast = { x: e.clientX, y: e.clientY };
    if (!frog) startHold(e.pointerId, false);
    return;
  }
  // Aim + tap: decide on lift — a drag sets the aim, a tap fires (a still hold rapid-fires).
  if (save.settings.touchAim === 'aimtap') {
    if (aimLocked && !frog) startHold(e.pointerId, false);
    return;
  }
  if (save.settings.touchAim === 'tap' && !frog) {
    setRawAim(w);
    if (!level.rail) view.aimAngle = shotAngle(rawAim);
    fireAim();
    startHold(e.pointerId, true);
    return;
  }
  if (!frog) {
    setRawAim(w);
    view.aimActive = true;
    setCancelUi(true, false);
    startHold(e.pointerId, false);
  }
});
stage.addEventListener('pointermove', (e) => {
  lastPointer = e.pointerType;
  if (mode !== 'playing') return;
  const w = screenToWorld(layout, e.clientX, e.clientY);
  if (e.pointerType === 'mouse') {
    setRawAim(w);
    view.aimActive = true;
    return;
  }
  if (!touchStart || touchStart.id !== e.pointerId || touchStart.cancelled) return;
  if (Math.hypot(e.clientX - touchStart.sx, e.clientY - touchStart.sy) > 10) touchStart.moved = true;
  if (level.rail) {
    if (!touchStart.onFrog || touchStart.moved) setRawAim(w);
    view.aimActive = true;
    return;
  }
  // Dragging before the hold kicks in means aiming, not rapid fire.
  if (touchStart.moved && hold && !hold.active && save.settings.touchAim !== 'tap') hold = null;
  if (save.settings.touchAim === 'pad') {
    // Relative: the crosshair moves with the finger (scaled down for precision).
    if (padLast) {
      const a = screenToWorld(layout, padLast.x, padLast.y);
      const b = screenToWorld(layout, e.clientX, e.clientY);
      padCursor.x = Math.max(12, Math.min(level.worldW - 12, padCursor.x + (b.x - a.x) * PAD_GAIN));
      padCursor.y = Math.max(12, Math.min(level.worldH - 12, padCursor.y + (b.y - a.y) * PAD_GAIN));
      padLast = { x: e.clientX, y: e.clientY };
      setRawAim(padCursor);
      view.aimActive = true;
    }
    return;
  }
  if (save.settings.touchAim === 'tap') {
    // Tap mode: while holding, slide to sweep the stream of shots.
    if (hold?.id === e.pointerId && !onLauncher(w)) setRawAim(w);
    return;
  }
  if (save.settings.touchAim === 'aimtap') {
    if (touchStart.moved && !(touchStart.onFrog && onLauncher(w))) {
      setRawAim(w);
      view.aimActive = true;
      aimLocked = true;
    }
    return;
  }
  if (save.settings.touchAim !== 'drag') return;
  const overFrog = onLauncher(w);
  const overZone = inCancelZone(e.clientX, e.clientY);
  if (touchStart.onFrog && !touchStart.moved) return;
  // Over the frog or the cancel pill: keep the last aim but show it as cancelled.
  if (!overFrog && !overZone) setRawAim(w);
  view.aimActive = true;
  const armed = overFrog || overZone;
  if (armed !== view.aimCancel) {
    audio.play('tick', armed ? -7 : 0);
    if (armed) haptics.pulse([6]);
  }
  setCancelUi(true, armed);
});
function endTouch(e: PointerEvent, interrupted: boolean) {
  if (e.pointerType === 'mouse' || !touchStart || touchStart.id !== e.pointerId) return;
  const w = screenToWorld(layout, e.clientX, e.clientY);
  const t = touchStart;
  touchStart = null;
  if (level.rail) {
    // Lifting never shoots in a boss fight; a tap on the frog swaps.
    if (t.onFrog && !t.moved && !interrupted && mode === 'playing') queueSwap();
    view.aimActive = true;
    return;
  }
  // A hold that already fired ends the stream; lifting doesn't add a shot.
  const held = hold?.id === e.pointerId && hold.shots > 0 && (hold.active || save.settings.touchAim === 'tap');
  if (hold?.id === e.pointerId) hold = null;
  const cancelled = interrupted || t.cancelled || view.aimCancel || inCancelZone(e.clientX, e.clientY);
  setCancelUi(false, false);
  if (mode !== 'playing') {
    view.aimActive = false;
    return;
  }
  padLast = null;
  if (t.onFrog && !t.moved) queueSwap();
  else if (save.settings.touchAim === 'pad') {
    if (!held && !t.moved && !interrupted) {
      haptics.tickNow();
      fireAim();
    }
    view.aimActive = true;
    return;
  } else if (save.settings.touchAim === 'aimtap') {
    if (held) {
      /* rapid fire already shot */
    } else if (!t.moved && !interrupted) {
      if (aimLocked) {
        // A real tap: on iPhone the invisible switch under the finger gives the haptic tick.
        haptics.tickNow();
        fireAim();
      } else {
        // First tap with no aim yet: aim there (no shot), so a tap never fires blind.
        setRawAim(w);
        aimLocked = true;
      }
    }
    view.aimActive = aimLocked;
    return;
  } else if (save.settings.touchAim === 'drag') {
    if (held) {
      /* rapid fire already shot */
    } else if (cancelled || onLauncher(w)) {
      if (!interrupted && !t.cancelled) audio.play('cancel');
    } else {
      // Haptic tick *inside* the lift-off handler, while the gesture still counts as user activation.
      haptics.tickNow();
      const h = liftoffAim();
      fireAim(h.a, h.u);
    }
  }
  view.aimActive = false;
}
stage.addEventListener('pointerup', (e) => endTouch(e, false));
window.addEventListener('pointerup', (e) => {
  if (e.pointerType === 'mouse' && hold?.id === e.pointerId) hold = null;
});
window.addEventListener('blur', () => (hold = null));
stage.addEventListener('pointercancel', (e) => endTouch(e, true));
stage.addEventListener('pointerleave', (e) => {
  if (e.pointerType === 'mouse') view.aimActive = false;
});

document.getElementById('hud-next')!.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  audio.unlock();
  queueSwap();
});
// Boss fights (touch): the Fire button shoots from the frog's spot; holding it keeps firing.
const fireBtn = document.getElementById('btn-fire')!;
fireBtn.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  audio.unlock();
  if (mode !== 'playing' || !level.rail || st.phase !== 'playing') return;
  fireBtn.setPointerCapture(e.pointerId);
  fireBtn.classList.add('down');
  fireAim();
  const now = performance.now();
  hold = { id: e.pointerId, since: now - HOLD_MS, active: true, lastShot: now, shots: 1 };
});
const fireUp = (e: PointerEvent) => {
  fireBtn.classList.remove('down');
  if (hold?.id === e.pointerId) hold = null;
};
fireBtn.addEventListener('pointerup', fireUp);
fireBtn.addEventListener('pointercancel', fireUp);
fireBtn.addEventListener('lostpointercapture', fireUp);
fireBtn.addEventListener('click', (e) => e.stopPropagation());
document.getElementById('btn-swap')!.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  audio.unlock();
  queueSwap();
});
document.getElementById('btn-help')!.addEventListener('click', () => {
  if (mode !== 'playing') return;
  audio.play('ui');
  mode = 'paused';
  view.aimActive = false;
  ui.powerups(() => {
    mode = 'playing';
    ui.hide();
  });
});
// Gear: adjust settings mid-game (pauses; Done resumes).
document.getElementById('btn-settings')!.addEventListener('click', () => {
  if (mode !== 'playing') return;
  audio.play('ui');
  mode = 'paused';
  view.aimActive = false;
  ui.settings(save, () => {
    mode = 'playing';
    ui.hide();
  }, true);
});
document.getElementById('btn-pause')!.addEventListener('click', () => {
  audio.play('ui');
  pause();
});

window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).tagName === 'INPUT') return;
  if (e.code === 'Escape' && mode !== 'playing' && ui.current && ui.current !== 'pause') {
    ui.back();
    return;
  }
  if (e.code === 'Escape' || e.code === 'KeyP') {
    if (mode === 'playing') pause();
    else if (mode === 'paused') {
      mode = 'playing';
      ui.hide();
    }
  } else if (mode === 'playing') {
    if (e.code === 'Space' || e.code === 'KeyS') {
      e.preventDefault();
      queueSwap();
    } else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight' || (level.rail && (e.code === 'ArrowUp' || e.code === 'ArrowDown'))) {
      const d = e.code === 'ArrowLeft' || e.code === 'ArrowUp' ? -1 : 1;
      if (level.rail) railAimU = Math.max(0, Math.min(level.rail.len, railAimU + d * 16));
      else rawAim += d * 0.03;
      view.aimActive = true;
    } else if (e.code === 'Enter' || (!level.rail && e.code === 'ArrowUp')) {
      fireAim();
    }
  }
});

// ------------------------------------------------------------------ events → feel

const POWER_HINTS = [
  '',
  'Bomb marble! Pop it in a match to blast everything nearby',
  'Slow marble! Pop it in a match to slow the chain',
  'Reverse marble! Pop it in a match to roll the chain back',
  'Lightning marble! Pop it in a match to strike every marble of its colour',
  'Wild marble! Pop it in a match and your next shot matches any colour',
  'Scorpion marble! Pop it in a match and a scorpion eats the 10 front marbles',
];
/** seenPowers bits past the power-ups, for one-time hints. */
const SEEN_COIN = 1 << 8;
/** First time each power-up appears on screen, explain it once (tap ? for details). */
function announcePowers() {
  const seen = save.seenPowers ?? 0;
  for (let ci = 0; ci < st.chains.length; ci++) {
    const tr = level.tracks[ci];
    for (const b of st.chains[ci].balls) {
      if (b.p && !(seen & (1 << b.p)) && b.s > tr.visibleFrom + 40) {
        save.seenPowers = seen | (1 << b.p);
        writeSave(save);
        ui.toast(`${POWER_HINTS[b.p]} · tap ? for all power-ups`, 4200);
        const p = pointAt(tr, b.s);
        fx.ring(p.x, p.y, '#fff', 20, 120, 0.8);
        return;
      }
    }
  }
}

function handleEvents(events: GameEvent[]) {
  const head = progress(st, level).head;
  for (const e of events) {
    if (!attract) eventLog.push({ t: st.tick, e });
    if (eventLog.length > 400) eventLog.shift();
    const fb = feedbackFor(e, { streak: st.streak, headProgress: head, reduceMotion: save.settings.reduceMotion });
    if (attract) {
      // Silent, gentle visuals only behind the menu.
      fb.hitstop = 0;
      fb.trauma *= 0.3;
      fb.flash = 0;
      fb.sound = null;
      fb.haptic = [];
      fb.slowmo = null;
    }
    if (!attract) feelLog.push({ tick: st.tick, type: e.type, hitstop: fb.hitstop, trauma: fb.trauma, flash: fb.flash, particles: fb.particles, sound: fb.sound });
    if (feelLog.length > 400) feelLog.shift();
    if (e.type === 'cascade') fb.pitch = Math.min(19, cascadeN++ * 0.3);
    hitstop = Math.max(hitstop, fb.hitstop);
    view.trauma = Math.min(FEEL.maxTrauma, view.trauma + fb.trauma);
    view.flash = Math.max(view.flash, fb.flash);
    audio.play(fb.sound, fb.pitch);
    haptics.pulse(fb.haptic);
    if (fb.slowmo) slowmo = { scale: fb.slowmo[0], left: fb.slowmo[1] / 1000 };

    switch (e.type) {
      case 'fire': {
        view.recoil = 1;
        const col = PALETTE[e.c];
        const mx = e.x + e.dx * 50;
        const my = e.y + e.dy * 50;
        for (let i = 0; i < fb.particles; i++) {
          const a = Math.atan2(e.dy, e.dx) + (fx.rand() - 0.5) * 0.9;
          const sp = 200 + fx.rand() * 300;
          fx.spawn({ k: 0, x: mx, y: my, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, max: 0.18 + fx.rand() * 0.12, size: 2, color: col.light, drag: 6 });
        }
        fx.ring(mx, my, col.light, 8, 160, 0.18);
        break;
      }
      case 'hit': {
        const col = PALETTE[e.c];
        fx.burst(e.x, e.y, col.base, col.light, fb.particles, 0.5);
        // Ripple through the chain from the impact point.
        let best = -1;
        let bestC = 0;
        let bd = Infinity;
        st.chains.forEach((ch, ci) => {
          for (const b of ch.balls) {
            const p = pointAt(level.tracks[ci], b.s);
            const d = Math.hypot(p.x - e.x, p.y - e.y);
            if (d < bd) {
              bd = d;
              best = b.s;
              bestC = ci;
            }
          }
        });
        view.ripple0 = { s: best, t: view.time, c: bestC };
        break;
      }
      case 'pop': {
        const col = PALETTE[e.c];
        const per = Math.max(4, Math.floor(fb.particles / e.balls.length));
        for (const b of e.balls) {
          fx.burst(b.x, b.y, col.base, col.light, per, 1 + e.combo * 0.15);
          fx.ring(b.x, b.y, col.light, 6, 240 + e.combo * 60, 0.32);
        }
        fx.text(e.x, e.y, `+${e.score}`, '#fff', 24 + e.combo * 4);
        if (e.combo > 0) {
          const words = ['', 'COMBO ×2', 'COMBO ×3!', 'AMAZING ×4!', 'INCREDIBLE ×5!!'];
          fx.text(e.x, e.y, words[Math.min(e.combo, 4)] || `COMBO ×${e.combo + 1}!!`, col.light, 28 + e.combo * 4, 1.2, -38);
        }
        if (e.gapBonus) fx.text(e.x, e.y, `GAP BONUS +${e.gapBonus}`, '#7cf7ff', 20, 1.2, 32);
        if (e.chainBonus) fx.text(e.x, e.y, `CHAIN ×${st.streak} +${e.chainBonus}`, '#ffd86b', 20, 1.2, e.gapBonus ? 58 : 32);
        if (fb.slowmo) fx.text(e.x, e.y, 'CLOSE CALL!', '#ff8fa3', 30, 1.3, e.combo > 0 ? -76 : -40);
        // Boss fights: each popped marble flies into the boss as a spark.
        if (level.bossFight && st.boss && !attract) {
          for (const [i, b] of e.balls.slice(0, 8).entries()) {
            const mx = (b.x + level.bossFight.x) / 2;
            const my = (b.y + level.bossFight.y) / 2;
            view.homing.push({ x: b.x, y: b.y, cx: mx + (fx.rand() - 0.5) * 420, cy: my + (fx.rand() - 0.5) * 420, t: -i * 0.04, color: col.light });
          }
        }
        break;
      }
      case 'cascade': {
        const col = PALETTE[e.c];
        fx.burst(e.x, e.y, col.base, col.light, 6, 1);
        if (cascadeN % 4 === 0) fx.ring(e.x, e.y, col.light, 6, 220, 0.3);
        break;
      }
      case 'eat': {
        const col = PALETTE[e.c];
        fx.burst(e.x, e.y, col.base, '#ffb347', 10, 0.9);
        break;
      }
      case 'coin': {
        fx.ring(e.x, e.y, '#ffd23f', 8, 260, 0.45);
        if (!attract && !((save.seenPowers ?? 0) & SEEN_COIN)) {
          save.seenPowers = (save.seenPowers ?? 0) | SEEN_COIN;
          writeSave(save);
          ui.toast(`Bonus coin! Shoot it before it vanishes for +${TUNING.coinValue}`, 3600);
        }
        break;
      }
      case 'coinGet': {
        fx.burst(e.x, e.y, '#ffcb2f', '#fff7c2', fb.particles, 1.3);
        fx.ring(e.x, e.y, '#fff1a8', 10, 520, 0.4);
        fx.text(e.x, e.y, `+${e.score}`, '#ffd23f', 34, 1.2, -30);
        break;
      }
      case 'coinGone':
        fx.burst(e.x, e.y, 'rgba(255,210,63,0.6)', '#fff', 6, 0.5);
        break;
      case 'bossHit': {
        fx.burst(e.x, e.y, '#ffb347', '#fff', fb.particles, 1.2);
        fx.ring(e.x, e.y, '#fff', 8, 400, 0.3);
        fx.text(e.x, e.y, `DIRECT HIT −${e.dmg}`, '#ffb347', 28, 1.1, -30);
        break;
      }
      case 'stun':
        stuns++;
        fx.ring(e.x, e.y, '#ff4d6a', 10, 380, 0.4);
        fx.burst(e.x, e.y, '#7a5a50', '#ffb36b', fb.particles, 1.2);
        fx.text(e.x, e.y, 'STUNNED!', '#ff8fa3', 30, 1.1, -50);
        break;
      case 'dodge':
        fx.burst(e.x, e.y, '#7a5a50', '#c9a089', fb.particles, 0.8);
        break;
      case 'choke':
        fx.burst(e.x, e.y, '#7dffcf', '#fff', fb.particles, 1);
        fx.text(e.x, e.y, e.at.length ? `CHOKED! +${e.at.length} POWER-UPS` : 'CHOKED!', '#7dffcf', 28, 1.4, -40);
        for (const p of e.at) {
          fx.ring(p.x, p.y, '#7dffcf', 10, 420, 0.5);
          fx.text(p.x, p.y, POWER_NAMES[p.power].toUpperCase(), '#7dffcf', 18, 1.2, -24);
        }
        break;
      case 'swallow':
        fx.burst(e.x, e.y, '#7dffb0', '#fff', fb.particles, 0.6);
        fx.text(e.x, e.y, 'GULP!', '#7dffb0', 24, 0.9, -30);
        break;
      case 'spit': {
        view.spitAge = 0;
        const col = PALETTE[e.c];
        fx.burst(e.x, e.y, col.base, '#7dffb0', fb.particles, 0.8);
        fx.ring(e.tx, e.ty, col.light, 6, 260, 0.3);
        break;
      }
      case 'bossDown': {
        view.bossDown = 0;
        view.banner = { text: level.bossFight?.kind === 'serpent' ? 'SERPENT SLAIN!' : 'BOSS DEFEATED!', t: 0, color: '#7dffcf' };
        fx.burst(e.x, e.y, '#ff6b81', '#ffd86b', fb.particles, 2);
        fx.ring(e.x, e.y, '#fff', 10, 1100, 0.6);
        fx.ring(e.x, e.y, '#ffd86b', 6, 800, 0.5);
        break;
      }
      case 'suck': {
        for (let i = 0; i < fb.particles; i++) fx.spawn({ k: 1, x: e.x, y: e.y, vx: (fx.rand() - 0.5) * 80, vy: (fx.rand() - 0.5) * 80, max: 0.3, size: 14, color: '#bdf', drag: 3 });
        break;
      }
      case 'contact': {
        fx.ring(e.x, e.y, e.matched ? '#fff' : 'rgba(255,255,255,0.5)', 10, e.matched ? 300 : 120, 0.25);
        if (e.matched) fx.burst(e.x, e.y, '#fff', '#fff', fb.particles, 0.6);
        break;
      }
      case 'power': {
        const label = POWER_NAMES[e.power].toUpperCase() + '!';
        if (e.power === Power.Lightning) {
          // Chain lightning: hop from the power marble to the nearest struck marble, and on.
          const col = PALETTE[e.c];
          const left = [...(e.zaps ?? [])];
          let from = { x: e.x, y: e.y };
          while (left.length) {
            let k = 0;
            for (let i = 1; i < left.length; i++) if (Math.hypot(left[i].x - from.x, left[i].y - from.y) < Math.hypot(left[k].x - from.x, left[k].y - from.y)) k = i;
            const to = left.splice(k, 1)[0];
            view.bolts.push({ pts: jagged(from, to), t: 0, color: col.light });
            fx.burst(to.x, to.y, col.base, '#fff', 8, 0.9);
            from = to;
          }
          fx.ring(e.x, e.y, '#fff3a0', 8, 700, 0.4);
          fx.text(e.x, e.y, `ZAP ×${(e.zaps?.length ?? 0) + 1}`, '#ffe14a', 38, 1.1, -34);
        } else if (e.power === Power.Wild) {
          fx.confetti(e.x, e.y, PALETTE.slice(0, 5).map((p) => p.base), 40);
          fx.ring(e.x, e.y, '#ff9df0', 10, 520, 0.5);
          fx.text(e.x, e.y, 'WILD SHOT!', '#ff9df0', 32, 1.2, -34);
        } else if (e.power === Power.Scorpion) {
          fx.ring(e.x, e.y, '#ffb347', 10, 520, 0.5);
          fx.text(e.x, e.y, 'SCORPION!', '#ffb347', 32, 1.2, -34);
        } else if (e.power === Power.Bomb) {
          fx.ring(e.x, e.y, '#ffd86b', 10, 900, 0.45);
          fx.ring(e.x, e.y, '#fff', 4, 600, 0.3);
          fx.burst(e.x, e.y, '#ff8a3d', '#ffe08a', fb.particles, 1.6);
          fx.text(e.x, e.y, 'BOOM!', '#ffd86b', 40, 1.1, -34);
        } else {
          const c = e.power === Power.Slow ? '#7cc4ff' : '#ffd86b';
          fx.ring(e.x, e.y, c, 10, 500, 0.5);
          fx.burst(e.x, e.y, c, '#fff', fb.particles, 0.8);
          fx.text(e.x, e.y, label, c, 30, 1.2, -34);
        }
        break;
      }
      case 'barFull':
        view.banner = { text: 'ZUMA!', sub: 'No more marbles — clear the rest', t: 0, color: '#ffd86b' };
        break;
      case 'lose':
        view.banner = { text: 'Oh no!', t: 0, color: '#ff8fa3' };
        break;
      case 'lost':
        if (attract) startAttract();
        else resultTimer = 0.6;
        break;
      case 'won': {
        if (attract) {
          startAttract();
          break;
        }
        view.banner = { text: run ? 'Stage clear!' : 'Level clear!', sub: run ? `Run score ${(run.runScore + st.score).toLocaleString()}` : undefined, t: 0, color: '#7dffcf' };
        const lc = launcherAt(st, level);
        fx.confetti(lc.x, lc.y, PALETTE.slice(0, 6).map((p) => p.base), fb.particles);
        resultTimer = 1.8;
        // Light sweep along the empty track, counting up the track bonus; then ace time.
        const b = st.bonus;
        if (b && b.sweep > 0) {
          const dur = Math.min(2, 0.5 + (b.sweep / (100 * TUNING.sweepPerPct)) * 1.8);
          view.sweep = { t: 0, dur, from: b.from };
          tally = { sweep: b.sweep, ace: b.ace, ticks: 0, done: false, aceShown: false };
          resultTimer = dur + (b.ace ? 1.9 : 1.2);
        } else if (b?.ace) {
          tally = { sweep: 0, ace: b.ace, ticks: 0, done: true, aceShown: false };
          view.sweep = { t: 0, dur: 0.01, from: b.from };
          resultTimer = 2.4;
        }
        break;
      }
    }
  }
}

// ------------------------------------------------------------------ main loop

let last = performance.now();
let fpsFrames = 0;
let fpsT = 0;
let fps = 0;
let drawMs = 0;
let simMs = 0;
let viewMs = 0;
let hudMs = 0;

function frame(now: number) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  fpsFrames++;
  fpsT += dt;
  if (fpsT >= 1) {
    fps = fpsFrames / fpsT;
    fpsFrames = 0;
    fpsT = 0;
  }
  if (document.hidden) return;
  view.time += dt;

  const s0 = performance.now();
  pumpHold();
  const simulate = attract || mode === 'playing';
  if (simulate) {
    let simDt = dt;
    if (hitstop > 0) {
      hitstop -= dt * 1000;
      simDt = 0;
    } else if (slowmo) {
      slowmo.left -= dt;
      simDt *= slowmo.scale;
      if (slowmo.left <= 0) slowmo = null;
    }
    acc += simDt;
    let steps = 0;
    while (acc >= DT && steps < 8) {
      acc -= DT;
      steps++;
      let cmds: Command[] = [];
      if (attract) {
        if (st.tick % 30 === 0 && !isRolling(st)) {
          cmds = decide(st, level, BOT_PRESETS.casual, botRng);
          const f = cmds.find((c) => c.type === 'fire');
          if (f && f.type === 'fire') aimTarget = aimAngleToward(f);
        }
      } else {
        cmds = pending;
        pending = [];
        for (const c of cmds) recording.push([st.tick + 1, c]);
      }
      const ev = step(st, level, cmds);
      if (ev.length) handleEvents(ev);
      if (hitstop > 0) {
        acc = 0;
        break;
      }
    }
    if (!attract && st.phase === 'playing') {
      const head = progress(st, level).head;
      peakDanger = Math.max(peakDanger, head);
      announcePowers();
    }
  }
  if (resultTimer > 0) {
    resultTimer -= dt;
    if (resultTimer <= 0) {
      resultTimer = -1;
      finishLevel(st.phase === 'won');
    }
  }

  simMs = simMs * 0.95 + (performance.now() - s0) * 0.05;
  const v0 = performance.now();
  updateView(dt);
  viewMs = viewMs * 0.95 + (performance.now() - v0) * 0.05;
  fx.update(dt * (slowmo ? slowmo.scale * 1.5 : 1));
  const d0 = performance.now();
  renderer.draw(st, view, fx);
  drawMs = drawMs * 0.95 + (performance.now() - d0) * 0.05;
  const h0 = performance.now();
  if (!attract && (mode === 'playing' || mode === 'paused')) ui.updateHud(st, level, run);
  hudMs = hudMs * 0.95 + (performance.now() - h0) * 0.05;

  // Autosave every few seconds
  if (!attract && mode === 'playing') {
    autosaveT += dt;
    if (autosaveT > 4) {
      autosaveT = 0;
      saveSnapshot();
    }
  }
}

/** A jagged lightning path between two points (cosmetic only). */
function jagged(a: Pt, b: Pt): Pt[] {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  const n = Math.max(3, Math.round(d / 26));
  const nx = -(b.y - a.y) / (d || 1);
  const ny = (b.x - a.x) / (d || 1);
  const pts: Pt[] = [a];
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const j = (Math.random() - 0.5) * Math.min(28, d * 0.25);
    pts.push({ x: a.x + (b.x - a.x) * t + nx * j, y: a.y + (b.y - a.y) * t + ny * j });
  }
  pts.push(b);
  return pts;
}

function updateView(dt: number) {
  for (const b of view.bolts) b.t += dt;
  while (view.bolts.length && view.bolts[0].t > BOLT_LIFE) view.bolts.shift();
  if (aimLocked && save.settings.touchAim === 'aimtap' && mode === 'playing' && !attract) view.aimActive = true;
  const pad = save.settings.touchAim === 'pad' && lastPointer !== 'mouse';
  if (pad && mode === 'playing' && !attract) view.aimActive = true;
  view.cursor = pad && !attract ? padCursor : null;
  pumpRail();
  if (view.bossDown >= 0) view.bossDown += dt;
  view.spitAge += dt;
  // Pop sparks flying into the boss
  for (let i = view.homing.length - 1; i >= 0; i--) {
    const h = view.homing[i];
    h.t += dt * 1.7;
    if (h.t >= 1) {
      view.homing.splice(i, 1);
      const B = level.bossFight;
      if (B) {
        fx.ring(B.x + (fx.rand() - 0.5) * 30, B.y + (fx.rand() - 0.5) * 30, h.color, 6, 160, 0.25);
        if (i % 3 === 0) audio.play('tick', 4 + fx.rand() * 4);
      }
    }
  }
  updateSweep(dt);
  // Aim spring
  [view.aimAngle, aimVel] = springAngle(view.aimAngle, aimVel, aimTarget, Math.min(dt, 1 / 30));
  view.recoil = Math.max(0, view.recoil - dt / FEEL.recoilReturn);
  view.trauma = Math.max(0, view.trauma - FEEL.traumaDecay * dt);
  view.shake = shakeOffset(view.trauma, view.time);
  view.flash = Math.max(0, view.flash - dt * 4);
  if (view.banner) {
    view.banner.t += dt;
    if (view.banner.t > 1.8) view.banner = null;
  }
  // Danger
  const head = st ? progress(st, level).head : 0;
  const targetDanger = st && st.phase === 'playing' && !attract ? Math.max(0, Math.min(1, (head - FEEL.dangerStart) / (0.97 - FEEL.dangerStart))) : 0;
  view.danger += (targetDanger - view.danger) * Math.min(1, dt * 4);
  if (view.danger > 0.05 && mode === 'playing') {
    heartT -= dt;
    if (heartT <= 0) {
      heartT = 1.15 - view.danger * 0.6;
      audio.play('heart');
      if (view.danger > 0.6) haptics.pulse([14]);
    }
  }
  audio.updateMusic(dt, attract || mode !== 'playing' ? 0 : view.danger);

  // Aim raycast + lock-on tick. The guide is always shown during play (along the last
  // aim) so players can see where the next marble will go before touching.
  view.aimIdle = mode === 'playing' && !attract;
  if (st && st.phase === 'playing' && (view.aimActive || view.aimIdle) && !attract) {
    // Preview exactly what the shot will do: aim assist + hysteresis around the raw pointer angle.
    let hit;
    const R = level.rail;
    if (R) {
      // Boss fights: straight across from the rail spot the frog is heading for.
      view.aimFrom = railPoint(R, railAimU);
      aimTarget = Math.atan2(R.n.y, R.n.x);
      hit = raycast(st, level, R.n.x, R.n.y, view.aimFrom);
    } else if (save.settings.assist) {
      view.aimFrom = null;
      const r = assistAim(st, level, rawAim, aimSlot);
      hit = r.hit;
      aimTarget = r.angle;
    } else {
      view.aimFrom = null;
      aimTarget = rawAim;
      hit = raycast(st, level, Math.cos(rawAim), Math.sin(rawAim));
    }
    aimSlot = hit ? { ballId: hit.ballId, front: hit.front } : null;
    view.aimShot = aimTarget;
    view.aimHit = hit;
    view.aimWillPop = !!hit && runIfInserted(st, hit, st.gun.cur, (st.gun.w & 1) === 1) >= 2;
    // Does the guide pass through the bonus coin (before reaching the chain)?
    view.aimCoin = false;
    if (st.coin) {
      const o = view.aimFrom ?? level.launcher;
      const dx = Math.cos(aimTarget);
      const dy = Math.sin(aimTarget);
      const t = (st.coin.x - o.x) * dx + (st.coin.y - o.y) * dy;
      const perp = Math.abs((st.coin.x - o.x) * dy - (st.coin.y - o.y) * dx);
      view.aimCoin = t > 0 && perp < TUNING.coinR + BALL_D * 0.3 && (!hit || t < hit.dist + TUNING.muzzle);
    }
    const id = hit ? hit.ballId : -1;
    // Tick only while actively aiming, not when the chain rolls under an idle guide.
    if (id !== lastHitBall && id >= 0 && !view.aimCancel && view.aimActive) {
      audio.play('tick', view.aimWillPop ? 7 : 0);
      if (touchStart) haptics.pulse([4]);
    }
    lastHitBall = id;
  } else if (attract) {
    view.aimHit = null;
  }

  // Ripples: a pulse travelling outward along the chain from the impact.
  view.ripples.clear();
  if (view.ripple0) {
    const age = view.time - view.ripple0.t;
    if (age > 0.6) view.ripple0 = null;
    else {
      const front = age * FEEL.ripple.speed;
      const fade = Math.exp(-age / FEEL.ripple.decay);
      for (const b of st.chains[view.ripple0.c]?.balls ?? []) {
        const d = Math.abs(b.s - view.ripple0.s);
        if (d > front + BALL_D * 2) continue;
        const w = Math.exp(-((d - front) * (d - front)) / (2 * BALL_D * BALL_D));
        view.ripples.set(b.id, FEEL.ripple.amp * w * fade);
      }
    }
  }
  // Shot trails
  const alive = new Set<number>();
  for (const sh of st.shots) {
    alive.add(sh.id);
    let tr = view.shotTrails.get(sh.id);
    if (!tr) view.shotTrails.set(sh.id, (tr = []));
    tr.push({ x: sh.x, y: sh.y });
    if (tr.length > 7) tr.shift();
  }
  for (const id of view.shotTrails.keys()) if (!alive.has(id)) view.shotTrails.delete(id);
}

/** End-of-level light sweep: tick up the track bonus as the light runs, then show ace time. */
function updateSweep(dt: number) {
  const sw = view.sweep;
  if (!sw) return;
  sw.t += dt;
  if (!tally) return;
  if (!tally.done) {
    const n = Math.floor(sw.t / 0.045);
    if (n > tally.ticks && sw.t < sw.dur) {
      tally.ticks = n;
      audio.play('count', Math.min(24, n * 0.6));
    }
    if (sw.t >= sw.dur) {
      tally.done = true;
      const tr = level.tracks[0];
      const end = pointAt(tr, tr.length);
      fx.text(end.x, end.y, `TRACK BONUS +${tally.sweep}`, '#fff2a8', 30, 1.6, -40);
      fx.ring(end.x, end.y, '#fff6c0', 10, 600, 0.5);
      audio.play('barfull');
      haptics.pulse([12, 30, 12]);
    }
  }
  if (tally.done && tally.ace && !tally.aceShown && sw.t >= sw.dur + 0.45) {
    tally.aceShown = true;
    const lc = launcherAt(st, level);
    fx.text(lc.x, lc.y, `ACE TIME! +${tally.ace}`, '#7dffcf', 36, 1.6, -70);
    fx.ring(lc.x, lc.y, '#7dffcf', 10, 700, 0.5);
    audio.play('ace');
    haptics.pulse([20, 30, 20, 30, 50]);
  }
  if (sw.t > sw.dur + 0.7 && tally.done && (!tally.ace || tally.aceShown)) view.sweep = sw.t > sw.dur + 0.6 ? null : sw;
}

// ------------------------------------------------------------------ platform glue

let wakeLock: { release(): Promise<void> } | null = null;
async function requestWakeLock() {
  try {
    const wl = (navigator as unknown as { wakeLock?: { request(t: string): Promise<{ release(): Promise<void> }> } }).wakeLock;
    if (wl && !wakeLock) wakeLock = await wl.request('screen');
  } catch {
    /* not supported / denied */
  }
}
function releaseWakeLock() {
  void wakeLock?.release().catch(() => {});
  wakeLock = null;
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    pause();
    saveSnapshot();
    audio.suspend();
  }
});
window.addEventListener('pagehide', saveSnapshot);

let installPrompt: (Event & { prompt(): Promise<void> }) | null = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e as Event & { prompt(): Promise<void> };
  ui.canInstall = true;
  if (mode === 'title') ui.title(save);
});

// ------------------------------------------------------------------ test hook (used by scripts/e2e.ts)

declare global {
  interface Window {
    __zuma: unknown;
  }
}
window.__zuma = {
  get mode() {
    return mode;
  },
  get attract() {
    return attract;
  },
  state: () => st,
  level: () => ({ index: level.index, seed: level.campaignSeed, launcher: level.launcher, length: level.tracks[0].length, chains: level.tracks.length, family: level.family, boss: level.boss, mutators: level.mutators, rail: level.rail ?? null, bossFight: level.bossFight ?? null, ace: level.ace }),
  launcherAt: () => launcherAt(st, level),
  layout: () => layout,
  view: () => ({ aimAngle: view.aimAngle, aimShot: view.aimShot, aimCancel: view.aimCancel, aimActive: view.aimActive, aimHit: view.aimHit, willPop: view.aimWillPop, trauma: view.trauma, danger: view.danger, aimFrom: view.aimFrom, cursor: view.cursor, sweep: !!view.sweep, aimCoin: view.aimCoin }),
  fps: () => fps,
  drawMs: () => drawMs,
  timings: () => ({ sim: simMs, view: viewMs, draw: drawMs, hud: hudMs }),
  /** Stress: spray particles everywhere (perf testing). */
  stress: (n = 300) => {
    for (let i = 0; i < n / 30; i++) fx.burst(200 + fx.rand() * 880, 100 + fx.rand() * 520, PALETTE[i % 6].base, PALETTE[i % 6].light, 30, 1);
  },
  events: () => eventLog.slice(),
  feel: () => feelLog.slice(),
  recording: () => recording.slice(),
  particles: () => fx.list.length,
  save: () => save,
  start: (i: number) => startLevel(i),
  /** Play any (seed, level) outside the campaign progress (tests / tools). */
  load: (seed: string, i: number) => {
    attract = false;
    run = null;
    loadLevel(seed, i);
    beginPlay();
  },
  run: () => run,
  levelSpeed: () => level.speed,
  fireAt: (wx: number, wy: number) => queueFire({ x: wx, y: wy }),
  swap: () => queueSwap(),
  pause,
  ballScreen: (i: number, chain = 0) => {
    const b = st.chains[chain]?.balls[i];
    if (!b) return null;
    const p = ballPos(level.tracks[chain], b);
    return { x: layout.a * p.x + layout.c * p.y + layout.e, y: layout.b * p.x + layout.d * p.y + layout.f, s: b.s, c: b.c };
  },
  worldToScreen: (x: number, y: number) => ({ x: layout.a * x + layout.c * y + layout.e, y: layout.b * x + layout.d * y + layout.f }),
  /** Drop the chain into a scripted test layout (frozen) for deterministic visual checks. */
  setup: (colors: number[], opts: { headGap?: number; power?: [number, number] } = {}) => {
    st.spawning = false;
    st.gun.cool = 0;
    // Chain 0 gets the scripted marbles; any other chain is emptied.
    st.chains.forEach((ch, ci) => {
      ch.rolling = false;
      ch.speed = 0;
      ch.stopT = 1e6;
      ch.pending = [];
      if (ci > 0) ch.balls = [];
    });
    const ch = st.chains[0];
    const headS = level.tracks[0].length - (opts.headGap ?? 500);
    ch.balls = colors.map((c, i) => ({ id: st.nextId++, c, s: headS - (colors.length - 1 - i) * BALL_D, p: 0 as Power, pt: 0, g: 1, ins: 1, ix: 0, iy: 0, clr: -1, combo: 0, suck: 0, rt: 0, rv: 0, gb: 0 }));
    if (opts.power) {
      ch.balls[opts.power[0]].p = opts.power[1] as Power;
      ch.balls[opts.power[0]].pt = 99;
    }
  },
};

// ------------------------------------------------------------------ boot

applySettings();
resize();
toTitle();
if (levelsUpdated) {
  writeSave(save);
  ui.toast('Levels got an update! Mini-boss serpents now live at the far end of the board, and swallow shots unless you hit them mid-spit', 5000);
}
requestAnimationFrame(frame);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true })).catch(() => {});
}

// Pure, deterministic Zuma simulation. No DOM, no rendering, no wall-clock.
//
// - Advances in fixed ticks (TICK_HZ). Inputs are commands applied at a tick.
// - State is plain JSON: snapshot/restore = JSON.stringify/parse.
// - Only IEEE-exact math (+ - * / sqrt) is used in the step, so replays match.
//
// Constants are ported from Zuma Deluxe (100 Hz, ~1 px per waypoint, r=16) to
// per-second units at our ball radius (r=18, ×1.125).

import { BALL_D, BALL_R, type Level } from './levelgen';
import { next as rngNext } from './rng';
import { inTunnel, pointAt, type Pt, tangentAt, type Track } from './track';

export const TICK_HZ = 120;
export const DT = 1 / TICK_HZ;

const K = BALL_R / 16; // Zuma px → our px
export const TUNING = {
  /** Roll-in deceleration toward cruise speed (Zuma: 0.1 px/frame²). */
  decel: 1000 * K,
  /** Acceleration back up to cruise after a stop (Zuma: 0.005 px/frame²). */
  accel: 50 * K,
  /** Fraction of track the roll-in covers before settling (Zuma: 40%). */
  rollIn: 0.36,
  /** Danger zone: last fraction of track where the chain slows to speed/slowFactor. */
  dangerFrac: 0.15,
  dangerBlendFrac: 0.12,
  slowFactor: 4,
  /** Magnet pull: initial speed and acceleration (Zuma: suck 10/8 px/frame, +1/8 per frame). */
  suckV0: 125 * K,
  suckAccel: 1250 * K,
  /** Knockback after a magnet contact: max(0.5, combo×1.5) px/frame for 0.3 s. */
  recoilBase: 50 * K,
  recoilPerCombo: 150 * K,
  recoilTime: 0.3,
  /** Pause the pusher after the rear-most ball clears / after recoil. */
  stopAfterRearClear: 0.4,
  stopAfterRecoil: 0.2,
  /** Ball clear (pop) duration before it is removed. Zuma: 0.4 s; snappier here. */
  clearTime: 0.26,
  /** Insertion animation (Zuma mergespeed 0.05 → 0.2 s). */
  insertTime: 0.15,
  /** Projectile speed px/s (Zuma 600; faster feels better on touch). */
  shotSpeed: 900,
  /** Seconds between shots. */
  cooldown: 0.24,
  /** Hit distance between projectile and ball centres. */
  hitDist: BALL_D * 0.92,
  muzzle: 46,
  /** Power-ups. */
  powerLife: 18,
  bombRadius: 122 * K,
  slowTime: 8,
  reverseTime: 3,
  reverseSpeed: 100 * K,
  /** When the bar fills with the chain past halfway: free reverse + slow. */
  barBackTime: 3,
  barSlowTime: 11,
  /** Seconds before a stuck level-start is forced to cruise. */
  rollInMax: 5,
};

/** Power-ups. 4 was Laser (aim beam + rapid fire) before Lightning replaced it. */
export const Power = { None: 0, Bomb: 1, Slow: 2, Reverse: 3, Lightning: 4 } as const;
export type Power = (typeof Power)[keyof typeof Power];
export const POWER_NAMES = ['', 'Bomb', 'Slow', 'Reverse', 'Lightning'];

export interface Ball {
  id: number;
  c: number; // colour index
  s: number; // arc distance
  p: Power;
  pt: number; // power time left
  /** 0..1 growth of the gap to the previous ball (insertion animation). */
  g: number;
  /** Insertion progress 0..1 for a freshly shot ball; 1 = settled. */
  ins: number;
  ix: number;
  iy: number;
  /** Clear timer; -1 = not clearing. */
  clr: number;
  /** Combo depth carried by magnet pulls. */
  combo: number;
  /** Magnet pull speed (backwards), 0 = none. */
  suck: number;
  /** Recoil time left and speed. */
  rt: number;
  rv: number;
  /** Pending gap bonus for a shot ball, paid when it settles into a match. */
  gb: number;
}

export interface Shot {
  id: number;
  c: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  gaps: number[]; // ids of balls whose gaps we flew through
  minGap: number;
}

export type Phase = 'playing' | 'losing' | 'lost' | 'won';

/** One chain of marbles on one track (levels can have several). */
export interface Chain {
  balls: Ball[]; // ordered by s ascending: [0] = rear (pusher), [n-1] = head
  pending: number[]; // colours of balls pushed back off the start (re-enter first)
  speed: number; // current pusher speed px/s
  rolling: boolean; // level-start roll-in phase
  stopT: number;
  lastColor: number;
}

export interface GameState {
  v: 2;
  campaignSeed: string;
  levelIndex: number;
  tick: number;
  phase: Phase;
  rngChain: number;
  rngGun: number;
  nextId: number;
  /** One per track; chains[i] runs on level.tracks[i]. */
  chains: Chain[];
  shots: Shot[];
  slowT: number;
  revT: number;
  spawning: boolean;
  barFull: boolean;
  score: number;
  streak: number; // consecutive matching shots
  gun: { cur: number; next: number; cool: number };
  loseV: number;
  stats: {
    shots: number;
    matches: number;
    popped: number;
    maxCombo: number;
    maxStreak: number;
    gapShots: number;
    powers: number;
    misses: number;
  };
}

export type Command = { type: 'fire'; x: number; y: number } | { type: 'swap' };

export type GameEvent =
  | { type: 'fire'; x: number; y: number; dx: number; dy: number; c: number }
  | { type: 'hit'; x: number; y: number; c: number; front: boolean }
  | { type: 'settle'; x: number; y: number; c: number }
  | { type: 'pop'; balls: { x: number; y: number; c: number; p: Power }[]; combo: number; score: number; x: number; y: number; c: number; gapBonus: number; chainBonus: number }
  | { type: 'suck'; x: number; y: number }
  | { type: 'contact'; x: number; y: number; combo: number; matched: boolean }
  | { type: 'power'; power: Power; x: number; y: number; c: number; zaps?: { x: number; y: number }[] }
  | { type: 'miss' }
  | { type: 'swap' }
  | { type: 'barFull' }
  | { type: 'lose' }
  | { type: 'lost' }
  | { type: 'won' }
  | { type: 'rollInDone' };

// ------------------------------------------------------------------ setup

export function createGame(level: Level): GameState {
  const st: GameState = {
    v: 2,
    campaignSeed: level.campaignSeed,
    levelIndex: level.index,
    tick: 0,
    phase: 'playing',
    rngChain: level.seed ^ 0xa5a5a5a5,
    rngGun: level.seed ^ 0x5a5a5a5a,
    nextId: 1,
    chains: [],
    shots: [],
    slowT: 0,
    revT: 0,
    spawning: true,
    barFull: false,
    score: 0,
    streak: 0,
    gun: { cur: 0, next: 0, cool: 0.6 },
    loseV: 0,
    stats: { shots: 0, matches: 0, popped: 0, maxCombo: 0, maxStreak: 0, gapShots: 0, powers: 0, misses: 0 },
  };
  // Roll-in: choose an initial speed that decelerates to cruise after covering rollIn × length.
  const v = level.speed;
  for (const tr of level.tracks) {
    const dist = tr.visibleFrom + (tr.length - tr.visibleFrom) * TUNING.rollIn;
    st.chains.push({ balls: [], pending: [], speed: Math.sqrt(v * v + 2 * TUNING.decel * dist), rolling: true, stopT: 0, lastColor: -1 });
  }
  st.gun.cur = randColor(st, level, 'gun');
  st.gun.next = randColor(st, level, 'gun');
  return st;
}

function rand(st: GameState, stream: 'chain' | 'gun'): number {
  if (stream === 'chain') {
    const [v, s] = rngNext(st.rngChain);
    st.rngChain = s;
    return v;
  }
  const [v, s] = rngNext(st.rngGun);
  st.rngGun = s;
  return v;
}

/** Colours currently on the board (bitmask). */
function presentMask(st: GameState): number {
  let m = 0;
  for (const ch of st.chains) {
    for (const b of ch.balls) if (b.clr < 0) m |= 1 << b.c;
    for (const c of ch.pending) m |= 1 << c;
  }
  return m;
}

/** Total marbles on the board. */
export function ballCount(st: GameState): number {
  let n = 0;
  for (const ch of st.chains) n += ch.balls.length;
  return n;
}

/** Any chain still in its level-start roll-in. */
export function isRolling(st: GameState): boolean {
  return st.chains.some((ch) => ch.rolling);
}

function randColor(st: GameState, level: Level, stream: 'chain' | 'gun', ch?: Chain): number {
  if (stream === 'gun') {
    const mask = presentMask(st);
    const opts: number[] = [];
    for (let c = 0; c < level.colors; c++) if (mask & (1 << c)) opts.push(c);
    if (opts.length === 0) for (let c = 0; c < level.colors; c++) opts.push(c);
    return opts[Math.floor(rand(st, 'gun') * opts.length)];
  }
  // Chain: repeat previous colour with the level's probability (Zuma: 41%), else a different colour.
  const last = ch!.lastColor;
  if (last >= 0 && rand(st, 'chain') < level.repeatChance) return last;
  let c = Math.floor(rand(st, 'chain') * (level.colors - (last >= 0 ? 1 : 0)));
  if (last >= 0 && c >= last) c++;
  return c;
}

function newBall(st: GameState, c: number, s: number): Ball {
  return { id: st.nextId++, c, s, p: Power.None, pt: 0, g: 1, ins: 1, ix: 0, iy: 0, clr: -1, combo: 0, suck: 0, rt: 0, rv: 0, gb: 0 };
}

const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
const gapOf = (b: Ball) => (b.g >= 1 ? BALL_D : BALL_D * easeOut(b.g));

// ------------------------------------------------------------------ step

export function step(st: GameState, level: Level, cmds: readonly Command[] = []): GameEvent[] {
  const ev: GameEvent[] = [];
  if (st.phase === 'lost' || st.phase === 'won') return ev;
  st.tick++;

  if (st.phase === 'losing') {
    stepLosing(st, level, ev);
    return ev;
  }

  for (const cmd of cmds) applyCommand(st, level, cmd, ev);

  // Timers
  st.gun.cool = Math.max(0, st.gun.cool - DT);
  st.slowT = Math.max(0, st.slowT - DT);
  st.revT = Math.max(0, st.revT - DT);
  st.chains.forEach((ch, ci) => {
    ch.stopT = Math.max(0, ch.stopT - DT);
    const vis = level.tracks[ci].visibleFrom;
    for (const b of ch.balls) {
      if (b.p !== Power.None && b.s > vis) {
        b.pt -= DT;
        if (b.pt <= 0) b.p = Power.None;
      }
    }
  });

  stepShots(st, level, ev);
  for (let ci = 0; ci < st.chains.length; ci++) stepChain(st, level, ci, ev);
  for (let ci = 0; ci < st.chains.length; ci++) stepClearing(st, level, ci, ev);
  maybeSpawnPower(st, level);
  rerollGun(st, level);

  // Bar
  if (!st.barFull && st.score >= barTarget(level)) {
    st.barFull = true;
    st.spawning = false;
    let past = false;
    st.chains.forEach((ch, ci) => {
      const tr = level.tracks[ci];
      ch.pending.length = 0;
      // Drop queued balls that are still off-screen in the entry tunnel.
      ch.balls = ch.balls.filter((b) => b.s >= tr.visibleFrom - BALL_D || b.clr >= 0);
      const head = ch.balls.length ? ch.balls[ch.balls.length - 1].s : 0;
      if (head > tr.length * 0.5) past = true;
    });
    if (past) {
      st.revT = Math.max(st.revT, TUNING.barBackTime);
      st.slowT = Math.max(st.slowT, TUNING.barSlowTime);
    }
    ev.push({ type: 'barFull' });
  }

  // Lose (any chain reaches its skull) / win (bar full and every chain cleared)
  const lostChain = st.chains.find((ch, ci) => {
    const n = ch.balls.length;
    return n > 0 && ch.balls[n - 1].s >= level.tracks[ci].length && !ch.balls.some((b) => b.clr >= 0 || b.suck > 0 || b.ins < 1);
  });
  if (lostChain) {
    st.phase = 'losing';
    st.loseV = Math.max(lostChain.speed, 200);
    st.shots.length = 0;
    ev.push({ type: 'lose' });
  } else if (st.barFull && ballCount(st) === 0 && st.shots.length === 0) {
    st.phase = 'won';
    ev.push({ type: 'won' });
  }
  return ev;
}

export function barTarget(level: Level): number {
  return level.target * 10;
}

function applyCommand(st: GameState, level: Level, cmd: Command, ev: GameEvent[]) {
  if (cmd.type === 'swap') {
    if (st.gun.cur !== st.gun.next) {
      const t = st.gun.cur;
      st.gun.cur = st.gun.next;
      st.gun.next = t;
      ev.push({ type: 'swap' });
    }
    return;
  }
  if (st.gun.cool > 0) return;
  const L = level.launcher;
  let dx = cmd.x - L.x;
  let dy = cmd.y - L.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1e-6) return;
  dx /= len;
  dy /= len;
  const speed = TUNING.shotSpeed;
  st.shots.push({
    id: st.nextId++,
    c: st.gun.cur,
    x: L.x + dx * TUNING.muzzle,
    y: L.y + dy * TUNING.muzzle,
    vx: dx * speed,
    vy: dy * speed,
    gaps: [],
    minGap: 1e9,
  });
  st.stats.shots++;
  ev.push({ type: 'fire', x: L.x, y: L.y, dx, dy, c: st.gun.cur });
  st.gun.cur = st.gun.next;
  st.gun.next = randColor(st, level, 'gun');
  st.gun.cool = TUNING.cooldown;
}

function rerollGun(st: GameState, level: Level) {
  if (ballCount(st) === 0) return;
  const mask = presentMask(st);
  if (!(mask & (1 << st.gun.cur))) st.gun.cur = randColor(st, level, 'gun');
  if (!(mask & (1 << st.gun.next))) st.gun.next = randColor(st, level, 'gun');
}

// ------------------------------------------------------------------ shots

const tmp: Pt = { x: 0, y: 0 };
const tmp2: Pt = { x: 0, y: 0 };

function hittable(b: Ball, track: Track) {
  return b.clr < 0 && b.ins >= 1 && b.s > track.visibleFrom + BALL_R * 0.5 && !inTunnel(track, b.s);
}

function stepShots(st: GameState, level: Level, ev: GameEvent[]) {
  const hd2 = TUNING.hitDist * TUNING.hitDist;
  for (let si = st.shots.length - 1; si >= 0; si--) {
    const sh = st.shots[si];
    const spd = Math.sqrt(sh.vx * sh.vx + sh.vy * sh.vy);
    const sub = Math.max(1, Math.ceil((spd * DT) / (BALL_R * 0.5)));
    let done = false;
    for (let k = 0; k < sub && !done; k++) {
      sh.x += (sh.vx * DT) / sub;
      sh.y += (sh.vy * DT) / sub;
      // Gap detection: flying between two balls separated by a gap.
      for (let ci = 0; ci < st.chains.length; ci++) {
       const balls = st.chains[ci].balls;
       const tr = level.tracks[ci];
       for (let i = 1; i < balls.length; i++) {
        const a = balls[i - 1];
        const b = balls[i];
        const gap = b.s - a.s - BALL_D;
        if (gap < 4 || !hittable(a, tr) || !hittable(b, tr)) continue;
        pointAt(tr, a.s, tmp);
        pointAt(tr, b.s, tmp2);
        const ex = tmp2.x - tmp.x;
        const ey = tmp2.y - tmp.y;
        const el2 = ex * ex + ey * ey;
        const t = ((sh.x - tmp.x) * ex + (sh.y - tmp.y) * ey) / el2;
        if (t <= 0 || t >= 1) continue;
        const px = tmp.x + ex * t - sh.x;
        const py = tmp.y + ey * t - sh.y;
        if (px * px + py * py < BALL_R * BALL_R && !sh.gaps.includes(b.id)) {
          sh.gaps.push(b.id);
          sh.minGap = Math.min(sh.minGap, gap);
        }
       }
      }
      // Collision with chain: swept circle test over this substep, earliest contact wins.
      // Same maths as raycast(), so the aim preview and the real shot always agree.
      const segX = (sh.vx * DT) / sub;
      const segY = (sh.vy * DT) / sub;
      const segL = Math.sqrt(segX * segX + segY * segY);
      const ux = segX / segL;
      const uy = segY / segL;
      const ox = sh.x - segX;
      const oy = sh.y - segY;
      let best = -1;
      let bestC = 0;
      let bestT = Infinity;
      for (let ci = 0; ci < st.chains.length; ci++) {
       const balls = st.chains[ci].balls;
       const tr = level.tracks[ci];
       for (let i = 0; i < balls.length; i++) {
        const b = balls[i];
        if (!hittable(b, tr)) continue;
        pointAt(tr, b.s, tmp);
        const fx = ox - tmp.x;
        const fy = oy - tmp.y;
        const c = fx * fx + fy * fy - hd2;
        let t: number;
        if (c <= 0) t = 0; // already overlapping at the start of the substep
        else {
          const bq = fx * ux + fy * uy;
          const disc = bq * bq - c;
          if (disc < 0) continue;
          t = -bq - Math.sqrt(disc);
          if (t < 0 || t > segL) continue;
        }
        if (t < bestT) {
          bestT = t;
          best = i;
          bestC = ci;
        }
       }
      }
      if (best >= 0) {
        sh.x = ox + ux * bestT;
        sh.y = oy + uy * bestT;
      }
      if (best >= 0) {
        insertShot(st, level, sh, bestC, best, ev);
        st.shots.splice(si, 1);
        done = true;
      } else if (sh.x < -60 || sh.x > level.worldW + 60 || sh.y < -60 || sh.y > level.worldH + 60) {
        st.shots.splice(si, 1);
        st.streak = 0;
        st.stats.misses++;
        ev.push({ type: 'miss' });
        done = true;
      }
    }
  }
}

/** Shared by the simulation and the aim preview: is the impact in front (toward the skull)? */
export function insertInFront(track: Track, ball: Ball, x: number, y: number): boolean {
  pointAt(track, ball.s, tmp);
  const t = tangentAt(track, ball.s);
  return (x - tmp.x) * t.x + (y - tmp.y) * t.y > 0;
}

function insertShot(st: GameState, level: Level, sh: Shot, ci: number, hitIdx: number, ev: GameEvent[]) {
  const balls = st.chains[ci].balls;
  const hit = balls[hitIdx];
  const front = insertInFront(level.tracks[ci], hit, sh.x, sh.y);
  const nb = newBall(st, sh.c, hit.s);
  nb.ins = 0;
  nb.ix = sh.x;
  nb.iy = sh.y;
  // Gap bonus info rides on the ball until it settles.
  nb.gb = sh.gaps.length ? gapBonus(sh) : 0;
  if (front) {
    nb.g = 0; // gap to the hit ball grows from 0 → D
    balls.splice(hitIdx + 1, 0, nb);
  } else {
    nb.g = 1;
    hit.g = 0; // the hit ball's gap to the new ball grows
    balls.splice(hitIdx, 0, nb);
  }
  ev.push({ type: 'hit', x: sh.x, y: sh.y, c: sh.c, front });
}

function gapBonus(sh: Shot): number {
  const g = Math.max(0, sh.minGap - 64 * K);
  let bonus = Math.floor(((300 - Math.min(g, 290)) * 500) / 300 / 10) * 10;
  bonus = Math.max(10, bonus);
  if (sh.gaps.length > 1) bonus *= sh.gaps.length;
  return bonus;
}

// ------------------------------------------------------------------ chain

/** How far the most advanced chain head is along its track (0..1). */
function headProgress(st: GameState, level: Level): number {
  let m = 0;
  st.chains.forEach((ch, ci) => {
    const n = ch.balls.length;
    if (n) m = Math.max(m, ch.balls[n - 1].s / level.tracks[ci].length);
  });
  return m;
}

function stepChain(st: GameState, level: Level, ci: number, ev: GameEvent[]) {
  const ch = st.chains[ci];
  const balls = ch.balls;
  const track = level.tracks[ci];
  const L = track.length;

  // Target pusher speed: cruise, slowed by danger zone and the Slow power-up.
  let target = level.speed;
  // The danger slowdown keys on the end of the chain connected to the pusher.
  let firstEnd = 0;
  for (let i = 0; i < balls.length; i++) {
    if (i > 0 && balls[i].s - balls[i - 1].s > BALL_D + 0.5) break;
    firstEnd = balls[i].s;
  }
  const danger = L * (1 - TUNING.dangerFrac);
  const blend = L * TUNING.dangerBlendFrac;
  if (firstEnd > danger) target /= TUNING.slowFactor;
  else if (firstEnd > danger - blend) {
    const f = (firstEnd - (danger - blend)) / blend;
    target = target * (1 - f) + (target / TUNING.slowFactor) * f;
  }
  if (st.slowT > 0) target /= TUNING.slowFactor;

  if (ch.rolling) {
    if (ch.speed <= target + 0.5 || st.tick > TUNING.rollInMax * TICK_HZ) {
      ch.rolling = false;
      if (!isRolling(st)) ev.push({ type: 'rollInDone' });
    }
  }
  if (ch.stopT > 0) ch.speed = 0;
  else if (ch.speed > target) ch.speed = Math.max(target, ch.speed - TUNING.decel * DT);
  else ch.speed = Math.min(target, ch.speed + (ch.rolling ? TUNING.decel : TUNING.accel) * DT);

  // Insertion growth.
  for (const b of balls) {
    if (b.g < 1) b.g = Math.min(1, b.g + DT / TUNING.insertTime);
  }

  // 1) Pusher moves the rear ball forward (unless reversing).
  if (balls.length && st.revT <= 0) balls[0].s += ch.speed * DT;
  // Forward constraint pass.
  for (let i = 1; i < balls.length; i++) {
    const min = balls[i - 1].s + gapOf(balls[i]);
    if (balls[i].s < min) balls[i].s = min;
  }

  // 2) Backward movers: reverse power on the head, magnet pulls, recoils.
  if (st.revT > 0 && balls.length) balls[balls.length - 1].s -= TUNING.reverseSpeed * DT;
  for (let i = balls.length - 1; i >= 1; i--) {
    const b = balls[i];
    if (b.suck > 0) {
      const d = b.suck * DT;
      b.suck += TUNING.suckAccel * DT;
      // Move b and everything touching it ahead.
      moveGroupBack(balls, i, d);
      const prev = balls[i - 1];
      if (b.s - prev.s <= gapOf(b)) {
        const fix = prev.s + gapOf(b) - b.s;
        moveGroupBack(balls, i, -fix);
        b.suck = 0;
        const combo = b.combo;
        const matched = checkMatch(st, level, ci, i, combo, ev, 0);
        pointAt(track, b.s, tmp);
        ev.push({ type: 'contact', x: tmp.x, y: tmp.y, combo, matched });
        if (matched) {
          // Knock the chain backwards — the Zuma combo shove.
          prev.rt = TUNING.recoilTime;
          prev.rv = Math.max(TUNING.recoilBase, combo * TUNING.recoilPerCombo);
          ch.stopT = Math.max(ch.stopT, TUNING.stopAfterRecoil);
        }
      }
    }
  }
  for (let i = 0; i < balls.length; i++) {
    const b = balls[i];
    if (b.rt > 0) {
      b.rt -= DT;
      moveGroupBack(balls, i, b.rv * DT);
    }
  }
  // Backward constraint pass (head → rear).
  for (let i = balls.length - 2; i >= 0; i--) {
    const max = balls[i + 1].s - gapOf(balls[i + 1]);
    if (balls[i].s > max) balls[i].s = max;
  }

  // Balls pushed back off the start return to the queue (re-enter in order).
  while (balls.length && balls[0].s < -BALL_D && balls[0].clr < 0) {
    const b = balls.shift()!;
    if (st.spawning) ch.pending.push(b.c);
  }

  // 3) Spawn new balls at the start.
  if (st.spawning && st.revT <= 0) {
    while (balls.length === 0 || balls[0].s >= BALL_D) {
      const s = balls.length ? balls[0].s - BALL_D : 0;
      let c: number;
      if (ch.pending.length) c = ch.pending.pop()!;
      else {
        c = randColor(st, level, 'chain', ch);
        ch.lastColor = c;
      }
      balls.unshift(newBall(st, c, s));
      if (balls.length > 400) break;
    }
  }

  // Settle inserted balls → match check.
  for (let i = 0; i < balls.length; i++) {
    const b = balls[i];
    if (b.ins < 1) {
      b.ins = Math.min(1, b.ins + DT / TUNING.insertTime);
      if (b.ins >= 1) {
        pointAt(track, b.s, tmp);
        ev.push({ type: 'settle', x: tmp.x, y: tmp.y, c: b.c });
        const gb = b.gb;
        b.gb = 0;
        const matched = checkMatch(st, level, ci, i, 0, ev, gb);
        if (matched) {
          st.streak++;
          st.stats.maxStreak = Math.max(st.stats.maxStreak, st.streak);
          if (gb) st.stats.gapShots++;
        } else if (!st.chains.some((o) => o.balls.some((x) => x.suck > 0))) {
          st.streak = 0;
        }
      }
    }
  }
}

/** Move ball i and every ball touching it ahead backwards by d (negative = forwards). */
function moveGroupBack(balls: Ball[], i: number, d: number) {
  let j = i;
  while (j + 1 < balls.length && balls[j + 1].s - balls[j].s <= gapOf(balls[j + 1]) + 0.5) j++;
  for (let k = i; k <= j; k++) balls[k].s -= d;
}

function touching(a: Ball, b: Ball) {
  return b.s - a.s <= gapOf(b) + 0.5;
}

/** Find the colour run through index i; if ≥3 start clearing. */
function checkMatch(st: GameState, level: Level, ci: number, i: number, combo: number, ev: GameEvent[], gb: number): boolean {
  const balls = st.chains[ci].balls;
  const track = level.tracks[ci];
  const b = balls[i];
  if (!b || b.clr >= 0 || b.ins < 1) return false;
  let lo = i;
  let hi = i;
  while (lo > 0 && balls[lo - 1].c === b.c && balls[lo - 1].clr < 0 && balls[lo - 1].ins >= 1 && touching(balls[lo - 1], balls[lo])) lo--;
  while (hi < balls.length - 1 && balls[hi + 1].c === b.c && balls[hi + 1].clr < 0 && balls[hi + 1].ins >= 1 && touching(balls[hi], balls[hi + 1])) hi++;
  const n = hi - lo + 1;
  if (n < 3) return false;
  let chainBonus = 0;
  if (combo === 0 && st.streak + 1 > 4) chainBonus = 10 * (st.streak + 1) + 50;
  const score = 100 * combo + 10 * n + gb + chainBonus;
  st.score += score;
  st.stats.matches++;
  st.stats.maxCombo = Math.max(st.stats.maxCombo, combo);
  const popped: { x: number; y: number; c: number; p: Power }[] = [];
  let sx = 0;
  let sy = 0;
  for (let k = lo; k <= hi; k++) {
    startClear(st, level, ci, balls[k], combo, ev);
    pointAt(track, balls[k].s, tmp);
    popped.push({ x: tmp.x, y: tmp.y, c: balls[k].c, p: balls[k].p });
    sx += tmp.x;
    sy += tmp.y;
  }
  ev.push({ type: 'pop', balls: popped, combo, score, x: sx / n, y: sy / n, c: b.c, gapBonus: gb, chainBonus });
  return true;
}

function startClear(st: GameState, level: Level, ci: number, b: Ball, combo: number, ev: GameEvent[]) {
  if (b.clr >= 0) return;
  b.clr = 0;
  b.combo = combo;
  b.suck = 0;
  st.stats.popped++;
  if (b.p !== Power.None) activatePower(st, level, ci, b, ev);
}

function activatePower(st: GameState, level: Level, ci: number, b: Ball, ev: GameEvent[]) {
  const p = b.p;
  b.p = Power.None;
  st.stats.powers++;
  pointAt(level.tracks[ci], b.s, tmp);
  const bx = tmp.x;
  const by = tmp.y;
  const pev: GameEvent & { type: 'power' } = { type: 'power', power: p, x: bx, y: by, c: b.c };
  ev.push(pev);
  if (p === Power.Slow) st.slowT = TUNING.slowTime;
  else if (p === Power.Reverse) st.revT = TUNING.reverseTime;
  else if (p === Power.Lightning) {
    // Every visible marble of the power marble's colour, on every track, is struck.
    const zaps: { x: number; y: number }[] = [];
    for (let oc = 0; oc < st.chains.length; oc++) {
      const tr = level.tracks[oc];
      for (const o of st.chains[oc].balls) {
        if (o.clr >= 0 || o.c !== b.c || o.s < tr.visibleFrom || inTunnel(tr, o.s)) continue;
        pointAt(tr, o.s, tmp);
        zaps.push({ x: tmp.x, y: tmp.y });
        startClear(st, level, oc, o, b.combo, ev);
      }
    }
    st.score += 10 * zaps.length;
    pev.zaps = zaps;
  } else if (p === Power.Bomb) {
    const r2 = TUNING.bombRadius * TUNING.bombRadius;
    let n = 0;
    // The blast hits marbles on every track in range.
    for (let oc = 0; oc < st.chains.length; oc++) {
      const tr = level.tracks[oc];
      for (const o of st.chains[oc].balls) {
        if (o.clr >= 0 || o.s < tr.visibleFrom || inTunnel(tr, o.s)) continue;
        pointAt(tr, o.s, tmp);
        const dx = tmp.x - bx;
        const dy = tmp.y - by;
        if (dx * dx + dy * dy < r2) {
          startClear(st, level, oc, o, b.combo, ev);
          n++;
        }
      }
    }
    st.score += 10 * n;
  }
}

function stepClearing(st: GameState, level: Level, ci: number, ev: GameEvent[]) {
  const ch = st.chains[ci];
  const balls = ch.balls;
  for (const b of balls) if (b.clr >= 0) b.clr += DT;
  for (let i = 0; i < balls.length; ) {
    if (balls[i].clr >= TUNING.clearTime) {
      let j = i;
      while (j < balls.length && balls[j].clr >= TUNING.clearTime) j++;
      const combo = balls[i].combo;
      const wasRear = i === 0;
      balls.splice(i, j - i);
      if (wasRear) ch.stopT = Math.max(ch.stopT, TUNING.stopAfterRearClear);
      const prev = balls[i - 1];
      const nxt = balls[i];
      if (prev && nxt && prev.c === nxt.c && prev.clr < 0 && nxt.clr < 0) {
        nxt.suck = TUNING.suckV0;
        nxt.combo = combo + 1;
        pointAt(level.tracks[ci], nxt.s, tmp);
        ev.push({ type: 'suck', x: tmp.x, y: tmp.y });
      }
    } else i++;
  }
}

function maybeSpawnPower(st: GameState, level: Level) {
  if (!st.spawning || ballCount(st) < 8) return;
  // Expected one power-up every ~(1/powerChance) seconds.
  if (rand(st, 'chain') >= level.powerChance * DT * 2) return;
  const cands: Ball[] = [];
  st.chains.forEach((ch, ci) => {
    const balls = ch.balls;
    for (let i = 1; i < balls.length - 1; i++) {
      const b = balls[i];
      if (b.p || b.clr >= 0 || b.s < level.tracks[ci].visibleFrom || inTunnel(level.tracks[ci], b.s)) continue;
      if (balls[i - 1].p || balls[i + 1].p) continue;
      cands.push(b);
    }
  });
  if (!cands.length) return;
  const b = cands[Math.floor(rand(st, 'chain') * cands.length)];
  b.p = (1 + Math.floor(rand(st, 'chain') * 4)) as Power;
  b.pt = TUNING.powerLife;
}

function stepLosing(st: GameState, level: Level, ev: GameEvent[]) {
  st.loseV += 900 * DT;
  st.chains.forEach((ch, ci) => {
    for (const b of ch.balls) b.s += st.loseV * DT;
    ch.balls = ch.balls.filter((b) => b.s < level.tracks[ci].length);
  });
  if (ballCount(st) === 0) {
    st.phase = 'lost';
    ev.push({ type: 'lost' });
  }
}

// ------------------------------------------------------------------ queries (used by UI, bot, tests)

export interface RayHit {
  /** Chain (track) index and ball index within that chain. */
  chain: number;
  index: number;
  ballId: number;
  x: number; // impact projectile centre
  y: number;
  front: boolean;
  dist: number;
}

/** Ray-cast from the launcher. Matches shot collision geometry (static chain). */
export function raycast(st: GameState, level: Level, dx: number, dy: number): RayHit | null {
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  dx /= len;
  dy /= len;
  const ox = level.launcher.x + dx * TUNING.muzzle;
  const oy = level.launcher.y + dy * TUNING.muzzle;
  const r = TUNING.hitDist;
  let best: RayHit | null = null;
  for (let ci = 0; ci < st.chains.length; ci++) {
   const balls = st.chains[ci].balls;
   const tr = level.tracks[ci];
   for (let i = 0; i < balls.length; i++) {
    const b = balls[i];
    if (!hittable(b, tr)) continue;
    pointAt(tr, b.s, tmp);
    const fx = ox - tmp.x;
    const fy = oy - tmp.y;
    const bq = fx * dx + fy * dy;
    const c = fx * fx + fy * fy - r * r;
    const disc = bq * bq - c;
    if (disc < 0) continue;
    const t = -bq - Math.sqrt(disc);
    if (t < 0) continue;
    if (!best || t < best.dist) {
      const x = ox + dx * t;
      const y = oy + dy * t;
      best = { chain: ci, index: i, ballId: b.id, x, y, front: insertInFront(tr, b, x, y), dist: t };
    }
   }
  }
  return best;
}

/** Ball centre on screen (track position, blended from the impact point while inserting). */
export function ballPos(track: Track, b: Ball, out: Pt = { x: 0, y: 0 }): Pt {
  pointAt(track, b.s, out);
  if (b.ins < 1) {
    const e = easeOut(b.ins);
    out.x = b.ix + (out.x - b.ix) * e;
    out.y = b.iy + (out.y - b.iy) * e;
  }
  return out;
}

export function progress(st: GameState, level: Level) {
  return {
    bar: Math.min(1, st.score / barTarget(level)),
    head: headProgress(st, level),
  };
}

export function snapshot(st: GameState): string {
  return JSON.stringify(st);
}

export function restore(json: string): GameState {
  return JSON.parse(json) as GameState;
}

/** Order-sensitive hash of the full state, for determinism tests. */
export function stateHash(st: GameState): string {
  const s = JSON.stringify(st);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/** Length of the same-colour run the new ball would join if inserted at this hit (excluding itself). */
export function runIfInserted(st: GameState, hit: RayHit, c: number): number {
  const balls = st.chains[hit.chain].balls;
  const behind = hit.front ? hit.index : hit.index - 1;
  const ahead = behind + 1;
  let run = 0;
  for (let i = behind; i >= 0 && balls[i].c === c && balls[i].clr < 0; i--) {
    if (i < behind && balls[i + 1].s - balls[i].s > BALL_D + 1) break;
    run++;
  }
  for (let i = ahead; i < balls.length && balls[i].c === c && balls[i].clr < 0; i++) {
    if (i > ahead && balls[i].s - balls[i - 1].s > BALL_D + 1) break;
    run++;
  }
  return run;
}

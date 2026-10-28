// Pure, deterministic Zuma simulation. No DOM, no rendering, no wall-clock.
//
// - Advances in fixed ticks (TICK_HZ). Inputs are commands applied at a tick.
// - State is plain JSON: snapshot/restore = JSON.stringify/parse.
// - Only IEEE-exact math (+ - * / sqrt) is used in the step, so replays match.
//
// Constants are ported from Zuma Deluxe (100 Hz, ~1 px per waypoint, r=16) to
// per-second units at our ball radius (r=18, ×1.125).

import { BALL_D, BALL_R, type Level, type Rail } from './levelgen';
import { COINS, type CoinLedger, type CoinSource, emptyLedger, type Mods, NO_MODS } from './items';
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
  /** Scorpion: runs back from the skull eating the front marbles. */
  scorpionSpeed: 520,
  scorpionEats: 10,
  /** Bonus coins: float for coinLife s; one every coinEvery..+coinJitter s. */
  coinLife: 6.5,
  coinFirst: 12,
  coinEvery: 17,
  coinJitter: 12,
  coinR: 22,
  coinValue: 300,
  /** End-of-level bonuses. */
  aceBonus: 1000,
  /** Points per 1% of track the chain never reached. */
  sweepPerPct: 10,
  /** Rail (boss fights): frog slide speed, boss attacks. */
  railSpeed: 1500,
  /** Rocks: the idol winds up (the target follows you), then lobs; it lands after rockFlight s. */
  bossWindup: 0.75,
  rockFlight: 1.45,
  bossShotHitR: 46,
  bossAttackEvery: 4.6,
  bossAttackEvery2: 3.4,
  bossFirstAttack: 6,
  stunTime: 1.2,
  bossDirectHit: 6,
  /** Mini-boss serpent: rears up, then spits a marble onto the front of the chain. */
  serpentWindup: 3,
  /** While it rears up its hitbox grows (radius x this), and a hit chokes it: big damage + a power-up. */
  serpentTargetK: 1.8,
  serpentChoke: 15,
  serpentEvery: 4,
  serpentEvery2: 2.5,
  serpentFirst: 8,
  /** Black hole: lasts this long, swallows at most this many marbles. */
  holeTime: 3.5,
  holeEats: 14,
  /** One marble every holeRate s, from within holeReach px of the vortex. */
  holeRate: 0.12,
  holeReach: BALL_D * 6,
  /** Magnet Shot: seconds, and how hard shots steer toward their colour (per second). */
  magnetTime: 8,
  magnetSteer: 9,
  /** Chameleon marbles change colour this often (seconds). */
  chameleonEvery: 2.5,
  /** Gem marbles: bonus score when popped. */
  gemScore: 150,
  /** No spitting once the head is past this fraction of the track. */
  serpentMercy: 0.86,
};

/** Power-ups. 4 was Laser (aim beam + rapid fire) before Lightning replaced it. */
export const Power = { None: 0, Bomb: 1, Slow: 2, Reverse: 3, Lightning: 4, Wild: 5, Scorpion: 6, ColorCloud: 7, BlackHole: 8, Magnet: 9 } as const;
export type Power = (typeof Power)[keyof typeof Power];
export const POWER_NAMES = ['', 'Bomb', 'Slow', 'Reverse', 'Lightning', 'Wild', 'Scorpion', 'Colour Cloud', 'Black Hole', 'Magnet'];
export const POWER_COUNT = 9;
/** Colour index used to draw a wild (rainbow) marble. */
export const WILD = 6;

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
  /** Wild: takes the colour of the best neighbour when it settles. */
  w?: 1;
  /** Spat by the serpent (its settling match doesn't count toward your streak). */
  sp?: 1;
  /** Armored: the first pop only cracks the armor. */
  a?: 1;
  /** Chameleon: changes colour every few seconds. */
  cm?: 1;
  /** Gem: pays bonus score and coins when popped. */
  gem?: 1;
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
  w?: 1;
  /** Pocket Bomb: explodes where it lands instead of joining the chain. */
  b?: 1;
}

/** A scorpion running back along chain ci from the skull, eating the front marbles. */
export interface Scorpion {
  ci: number;
  s: number;
  left: number;
}

/** A lobbed rock: flies from (x0, y0) to rail spot u, landing when t reaches 0 (of T). */
export interface Rock {
  id: number;
  u: number;
  t: number;
  T: number;
  x0: number;
  y0: number;
}

/** Boss state: the rail idol (every 10th level) or the skull serpent (mini-bosses). */
export interface BossState {
  hp: number;
  max: number;
  /** Seconds to the next wind-up. */
  t: number;
  /** Wind-up time left (0 = not winding up). The attack fires when it runs out. */
  wind: number;
  /** Hit flash timer. */
  hitT: number;
  dead: boolean;
  /** Attacks so far (the idol alternates hands). */
  n: number;
  /** Serpent: colour of the marble it's about to spit. */
  spitC: number;
  /** Idol: rocks in the air. */
  shots: Rock[];
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
  /** Furthest the head has reached (arc length). */
  peak: number;
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
  /** Part of the score that doesn't fill the bar (coins, end-of-level bonuses). */
  extra: number;
  streak: number; // consecutive matching shots
  /** w: wild bits (1 = current marble is wild, 2 = next); b: Pocket Bomb bits, same layout; after: Colour Scout's third marble. */
  gun: { cur: number; next: number; cool: number; w: number; b: number; after: number };
  /** Rail levels: frog position u along the rail, target tu, queued shot, stun time. */
  rail: { u: number; tu: number; q: boolean; stun: number } | null;
  boss: BossState | null;
  scorps: Scorpion[];
  coin: { x: number; y: number; t: number } | null;
  coinT: number;
  rngBonus: number;
  /** Boss beaten: the chain pops from the head back, one marble per tick per chain. */
  cascade: boolean;
  /** Set when the level is won. */
  bonus: { sweep: number; ace: number; seconds: number; from: number[] } | null;
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
    coins: number;
    bossHits: number;
  };
  /** Expedition items in effect (neutral outside Expedition). */
  mods: Mods;
  /** Coins earned this level (Expedition currency, separate from score). */
  coinsEarned: CoinLedger;
  /** Extra Life rescues left this level. */
  lives: number;
  /** Black holes: a vortex at arc position s on chain ci, swallowing marbles that reach it. */
  holes: { ci: number; s: number; t: number; left: number; n: number }[];
  /** Magnet Shot time left: shots curve toward a marble of their colour. */
  magnetT: number;
  /** Coin Rush: fraction of a coin carried to the next pop. */
  coinFrac: number;
  /** Opener: power marbles still to place as soon as the chain is in. */
  openerLeft: number;
  /** Second Wind: free Reverses left this level. */
  windLeft: number;
}

/** move: rail levels only — slide the frog toward the point's spot on the rail. */
export type Command = { type: 'fire'; x: number; y: number } | { type: 'swap' } | { type: 'move'; x: number; y: number };

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
  | { type: 'won'; sweep: number; ace: number }
  | { type: 'rollInDone' }
  | { type: 'coin'; x: number; y: number }
  | { type: 'coinGet'; x: number; y: number; score: number }
  | { type: 'coinGone'; x: number; y: number }
  | { type: 'eat'; x: number; y: number; c: number }
  | { type: 'bossHit'; x: number; y: number; dmg: number }
  | { type: 'bossWindup' }
  | { type: 'bossAttack'; x: number; y: number; tx: number; ty: number }
  | { type: 'swallow'; x: number; y: number }
  | { type: 'rescue'; x: number; y: number }
  | { type: 'wind'; x: number; y: number }
  | { type: 'crack'; x: number; y: number; c: number }
  | { type: 'gem'; x: number; y: number; score: number }
  | { type: 'choke'; x: number; y: number; at: { x: number; y: number; power: Power }[] }
  | { type: 'spit'; x: number; y: number; tx: number; ty: number; c: number }
  | { type: 'stun'; x: number; y: number }
  | { type: 'dodge'; x: number; y: number }
  | { type: 'bossDown'; x: number; y: number }
  | { type: 'cascade'; x: number; y: number; c: number };

// ------------------------------------------------------------------ setup

export function createGame(level: Level, mods: Mods = NO_MODS): GameState {
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
    extra: 0,
    streak: 0,
    gun: { cur: 0, next: 0, cool: 0.6, w: 0, b: mods.pocketBomb ? 1 : 0, after: -1 },
    rail: level.rail ? { u: level.rail.len / 2, tu: level.rail.len / 2, q: false, stun: 0 } : null,
    boss: level.bossFight
      ? { hp: level.bossFight.hp, max: level.bossFight.hp, t: level.bossFight.kind === 'serpent' ? TUNING.serpentFirst : TUNING.bossFirstAttack, wind: 0, hitT: 0, dead: false, n: 0, spitC: 0, shots: [] }
      : null,
    scorps: [],
    coin: null,
    coinT: TUNING.coinFirst / mods.coinSpawnMul,
    rngBonus: level.seed ^ 0x3c3c3c3c,
    cascade: false,
    bonus: null,
    loseV: 0,
    stats: { shots: 0, matches: 0, popped: 0, maxCombo: 0, maxStreak: 0, gapShots: 0, powers: 0, misses: 0, coins: 0, bossHits: 0 },
    mods: { ...mods },
    coinsEarned: emptyLedger(),
    lives: mods.lives,
    holes: [],
    magnetT: 0,
    coinFrac: 0,
    openerLeft: mods.opener ? 1 : 0,
    windLeft: mods.secondWind ? 1 : 0,
  };
  // Roll-in: choose an initial speed that decelerates to cruise after covering rollIn × length.
  const v = cruise(st, level);
  for (const tr of level.tracks) {
    const dist = tr.visibleFrom + (tr.length - tr.visibleFrom) * TUNING.rollIn;
    st.chains.push({ balls: [], pending: [], speed: Math.sqrt(v * v + 2 * TUNING.decel * dist), rolling: true, stopT: 0, lastColor: -1, peak: 0 });
  }
  st.gun.cur = randColor(st, level, 'gun');
  st.gun.next = randColor(st, level, 'gun');
  if (mods.scout) st.gun.after = randColor(st, level, 'gun');
  return st;
}

function rand(st: GameState, stream: 'chain' | 'gun' | 'bonus'): number {
  if (stream === 'bonus') {
    const [v, s] = rngNext(st.rngBonus);
    st.rngBonus = s;
    return v;
  }
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

/** Cruise speed with items applied. */
function cruise(st: GameState, level: Level): number {
  return level.speed * st.mods.speedMul;
}

/** Expedition coins: add to this level's ledger. */
function earn(st: GameState, src: CoinSource, n: number) {
  st.coinsEarned.by[src] += n;
  st.coinsEarned.total += n;
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
  st.magnetT = Math.max(0, st.magnetT - DT);
  // Second Wind: the first time a chain passes 90%, it rolls back like a Reverse.
  if (st.windLeft > 0 && headProgress(st, level) > 0.9) {
    st.windLeft--;
    st.revT = Math.max(st.revT, TUNING.reverseTime * st.mods.reverseTimeMul);
    // Effect at the head closest to its skull.
    let ci = 0;
    let best = -1;
    st.chains.forEach((ch, i) => {
      const n = ch.balls.length;
      const f = n ? ch.balls[n - 1].s / level.tracks[i].length : -1;
      if (f > best) (best = f), (ci = i);
    });
    const balls = st.chains[ci].balls;
    pointAt(level.tracks[ci], balls[balls.length - 1].s, tmp);
    ev.push({ type: 'wind', x: tmp.x, y: tmp.y });
  }
  // Chameleon marbles step to the next colour together.
  if (st.tick % Math.round(TUNING.chameleonEvery * TICK_HZ) === 0) {
    for (const ch of st.chains) for (const b of ch.balls) if (b.cm && b.clr < 0 && b.ins >= 1) b.c = (b.c + 1) % level.colors;
  }
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

  stepRail(st, level, ev);
  stepShots(st, level, ev);
  stepBoss(st, level, ev);
  for (let ci = 0; ci < st.chains.length; ci++) stepChain(st, level, ci, ev);
  stepScorpions(st, level, ev);
  stepHoles(st, level, ev);
  for (let ci = 0; ci < st.chains.length; ci++) stepClearing(st, level, ci, ev);
  if (st.boss && st.boss.hp <= 0 && !st.boss.dead) bossDefeated(st, level, ev);
  stepCascade(st, level, ev);
  stepCoin(st, level, ev);
  maybeSpawnPower(st, level);
  rerollGun(st, level);
  for (const ch of st.chains) if (ch.balls.length) ch.peak = Math.max(ch.peak, ch.balls[ch.balls.length - 1].s);

  // Bar (boss fights have the boss's health instead)
  if (!st.boss && !st.barFull && st.score - st.extra >= barTarget(level)) {
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
  if (lostChain && st.lives > 0) {
    // Extra Life: every chain is pushed back a quarter of its track instead.
    st.lives--;
    st.chains.forEach((ch, ci) => {
      const shift = level.tracks[ci].length * 0.25;
      const keep: Ball[] = [];
      for (const b of ch.balls) {
        b.s -= shift;
        if (b.s >= 0) keep.push(b);
        else ch.pending.push(b.c);
      }
      ch.balls = keep;
      ch.stopT = Math.max(ch.stopT, 1);
    });
    pointAt(level.tracks[st.chains.indexOf(lostChain)], level.tracks[st.chains.indexOf(lostChain)].length, tmp);
    ev.push({ type: 'rescue', x: tmp.x, y: tmp.y });
  } else if (lostChain) {
    st.phase = 'losing';
    st.loseV = Math.max(lostChain.speed, 200);
    st.shots.length = 0;
    st.scorps.length = 0;
    st.coin = null;
    if (st.boss) st.boss.shots.length = 0;
    ev.push({ type: 'lose' });
  } else if (st.barFull && ballCount(st) === 0 && st.shots.length === 0) {
    st.phase = 'won';
    st.coin = null;
    st.scorps.length = 0;
    const b = awardBonus(st, level);
    ev.push({ type: 'won', sweep: b.sweep, ace: b.ace });
  }
  return ev;
}

/**
 * End-of-level bonuses (Zuma style): points for every 1% of track the chain never
 * reached, and an ace-time bonus for clearing under the level's ace time.
 */
function awardBonus(st: GameState, level: Level) {
  let sum = 0;
  const from: number[] = [];
  st.chains.forEach((ch, ci) => {
    const tr = level.tracks[ci];
    const p = Math.min(tr.length, Math.max(ch.peak, tr.visibleFrom));
    sum += (tr.length - p) / (tr.length - tr.visibleFrom);
    from.push(p);
  });
  const pct = Math.round((sum / st.chains.length) * 100);
  const seconds = st.tick / TICK_HZ;
  const sweep = pct * TUNING.sweepPerPct;
  const ace = seconds <= level.ace ? TUNING.aceBonus : 0;
  st.bonus = { sweep, ace, seconds, from };
  if (ace) earn(st, 'ace', COINS.ace);
  if (st.chains.every((ch, ci) => ch.peak <= level.tracks[ci].length * 0.5)) earn(st, 'clean', COINS.clean);
  if (level.boss) earn(st, 'boss', COINS.boss);
  st.score += sweep + ace;
  st.extra += sweep + ace;
  return st.bonus;
}

export function barTarget(level: Level): number {
  return level.target * 10;
}

function applyCommand(st: GameState, level: Level, cmd: Command, ev: GameEvent[]) {
  if (cmd.type === 'swap') {
    const wc = st.gun.w & 1;
    const wn = (st.gun.w >> 1) & 1;
    const bc = st.gun.b & 1;
    const bn = (st.gun.b >> 1) & 1;
    if (st.gun.cur !== st.gun.next || wc !== wn || bc !== bn) {
      const t = st.gun.cur;
      st.gun.cur = st.gun.next;
      st.gun.next = t;
      st.gun.w = (wc << 1) | wn;
      st.gun.b = (bc << 1) | bn;
      ev.push({ type: 'swap' });
    }
    return;
  }
  if (st.rail && level.rail) {
    // Rail: slide to the point's spot on the rail; a fire command shoots on arrival.
    st.rail.tu = railProject(level.rail, cmd.x, cmd.y);
    if (cmd.type === 'fire') st.rail.q = true;
    return;
  }
  if (cmd.type === 'move' || st.gun.cool > 0) return;
  const L = level.launcher;
  let dx = cmd.x - L.x;
  let dy = cmd.y - L.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1e-6) return;
  dx /= len;
  dy /= len;
  fireShot(st, level, L.x, L.y, dx, dy, ev);
}

function fireShot(st: GameState, level: Level, lx: number, ly: number, dx: number, dy: number, ev: GameEvent[]) {
  const speed = TUNING.shotSpeed * st.mods.shotSpeedMul;
  const wild = (st.gun.w & 1) === 1;
  const bomb = (st.gun.b & 1) === 1;
  const sh: Shot = {
    id: st.nextId++,
    c: st.gun.cur,
    x: lx + dx * TUNING.muzzle,
    y: ly + dy * TUNING.muzzle,
    vx: dx * speed,
    vy: dy * speed,
    gaps: [],
    minGap: 1e9,
  };
  if (wild) sh.w = 1;
  if (bomb) sh.b = 1;
  st.shots.push(sh);
  st.stats.shots++;
  ev.push({ type: 'fire', x: lx, y: ly, dx, dy, c: wild ? WILD : st.gun.cur });
  st.gun.cur = st.gun.next;
  st.gun.w >>= 1;
  st.gun.b >>= 1;
  if (st.mods.scout) {
    st.gun.next = st.gun.after;
    st.gun.after = randColor(st, level, 'gun');
  } else st.gun.next = randColor(st, level, 'gun');
  // Rainbow: every Nth shot is Wild (shown on the marble before it's fired).
  const N = st.mods.wildEvery;
  if (N > 0 && (st.stats.shots + 1) % N === 0) st.gun.w |= 1;
  st.gun.cool = TUNING.cooldown;
}

// ------------------------------------------------------------------ rail + boss

export function railPoint(rail: Rail, u: number, out: Pt = { x: 0, y: 0 }): Pt {
  out.x = rail.a.x + rail.dir.x * u;
  out.y = rail.a.y + rail.dir.y * u;
  return out;
}

/** Spot on the rail nearest to a point (0..rail.len). */
export function railProject(rail: Rail, x: number, y: number): number {
  const u = (x - rail.a.x) * rail.dir.x + (y - rail.a.y) * rail.dir.y;
  return Math.max(0, Math.min(rail.len, u));
}

/** Where shots come from right now: the fixed launcher, or the frog's spot on the rail. */
export function launcherAt(st: GameState, level: Level, out: Pt = { x: 0, y: 0 }): Pt {
  if (st.rail && level.rail) return railPoint(level.rail, st.rail.u, out);
  out.x = level.launcher.x;
  out.y = level.launcher.y;
  return out;
}

function stepRail(st: GameState, level: Level, ev: GameEvent[]) {
  const r = st.rail;
  const R = level.rail;
  if (!r || !R) return;
  if (r.stun > 0) {
    r.stun = Math.max(0, r.stun - DT);
    r.q = false;
  }
  const d = r.tu - r.u;
  const mx = TUNING.railSpeed * DT;
  r.u = Math.abs(d) <= mx ? r.tu : r.u + (d > 0 ? mx : -mx);
  if (r.q && r.u === r.tu && st.gun.cool <= 0) {
    r.q = false;
    railPoint(R, r.u, tmpL);
    fireShot(st, level, tmpL.x, tmpL.y, R.n.x, R.n.y, ev);
  }
}

function stepBoss(st: GameState, level: Level, ev: GameEvent[]) {
  const b = st.boss;
  const B = level.bossFight;
  if (!b || !B) return;
  b.hitT = Math.max(0, b.hitT - DT);
  if (B.kind === 'serpent') return stepSerpent(st, level, b, ev);
  const r = st.rail;
  const R = level.rail;
  if (!r || !R) return;
  for (let i = b.shots.length - 1; i >= 0; i--) {
    const p = b.shots[i];
    p.t -= DT;
    if (p.t > 0) continue;
    // Landed on the rail: stuns the frog if it's still under it.
    b.shots.splice(i, 1);
    if (Math.abs(r.u - p.u) < TUNING.bossShotHitR) {
      r.stun = TUNING.stunTime;
      r.q = false;
      railPoint(R, r.u, tmpL);
      ev.push({ type: 'stun', x: tmpL.x, y: tmpL.y });
    } else {
      railPoint(R, p.u, tmpL);
      ev.push({ type: 'dodge', x: tmpL.x, y: tmpL.y });
    }
  }
  if (b.dead || isRolling(st)) return;
  const angry = b.hp * 2 <= b.max;
  if (b.wind > 0) {
    // Winding up: the target follows the frog; it locks when the rock leaves the hand.
    b.wind = Math.max(0, b.wind - DT);
    if (b.wind > 0) return;
    const targets = [r.u];
    // Below half health it sometimes throws a second rock from the other hand.
    if (angry && rand(st, 'bonus') < 0.5) {
      const side = r.u < R.len / 2 ? 1 : -1;
      targets.push(Math.max(20, Math.min(R.len - 20, r.u + side * 110)));
    }
    targets.forEach((u, k) => {
      const hand = idolHand(level, (b.n + k) % 2, tmp2);
      railPoint(R, u, tmpL);
      b.shots.push({ id: st.nextId++, u, t: TUNING.rockFlight, T: TUNING.rockFlight, x0: hand.x, y0: hand.y });
      ev.push({ type: 'bossAttack', x: hand.x, y: hand.y, tx: tmpL.x, ty: tmpL.y });
    });
    b.n++;
    return;
  }
  b.t -= DT;
  if (b.t > 0) return;
  b.t = (angry ? TUNING.bossAttackEvery2 : TUNING.bossAttackEvery) * (0.8 + 0.4 * rand(st, 'bonus'));
  b.wind = TUNING.bossWindup;
  ev.push({ type: 'bossWindup' });
}

/** Where the idol's throwing hand is (0 = toward the rail's start, 1 = its end). */
export function idolHand(level: Level, hand: number, out: Pt = { x: 0, y: 0 }): Pt {
  const B = level.bossFight!;
  const d = level.rail ? level.rail.dir : { x: 0, y: 1 };
  const sgn = hand === 0 ? -1 : 1;
  out.x = B.x + d.x * sgn * B.r * 1.55;
  out.y = B.y + d.y * sgn * B.r * 1.55;
  return out;
}

/** Mini-boss serpent: every few seconds it rears back, then spits a marble onto the front of chain 0. */
function stepSerpent(st: GameState, level: Level, b: BossState, ev: GameEvent[]) {
  if (b.dead || isRolling(st)) return;
  const angry = b.hp * 2 <= b.max;
  if (b.wind > 0) {
    b.wind = Math.max(0, b.wind - DT);
    if (b.wind === 0) serpentSpit(st, level, b, ev);
    return;
  }
  b.t -= DT;
  if (b.t > 0) return;
  b.t = (angry ? TUNING.serpentEvery2 : TUNING.serpentEvery) * (0.8 + 0.4 * rand(st, 'bonus'));
  b.wind = TUNING.serpentWindup + st.mods.serpentWindupAdd;
  b.spitC = Math.floor(rand(st, 'bonus') * level.colors);
  ev.push({ type: 'bossWindup' });
}

function serpentSpit(st: GameState, level: Level, b: BossState, ev: GameEvent[]) {
  // A burst: 2 marbles, 3 once it's below half health (the first is the one shown in its mouth).
  const count = b.hp * 2 <= b.max ? 3 : 2;
  const colors = [b.spitC];
  for (let k = 1; k < count; k++) colors.push(Math.floor(rand(st, 'bonus') * level.colors));
  if (serpentPush(st, level, colors, ev)) b.n++;
}

/** Push marbles out of the serpent's mouth onto the front of chain 0. False if it holds back. */
function serpentPush(st: GameState, level: Level, colors: number[], ev: GameEvent[]): boolean {
  const ch = st.chains[0];
  const tr = level.tracks[0];
  const B = level.bossFight!;
  const n = ch.balls.length;
  if (!n) return false;
  const head = ch.balls[n - 1];
  // It holds back when the chain is already close (no cheap losses) or mid-pop.
  if (head.clr >= 0 || head.ins < 1 || head.s < tr.visibleFrom || head.s > tr.length * TUNING.serpentMercy) return false;
  for (const c of colors) {
    const nb = newBall(st, c, head.s);
    nb.g = 0;
    nb.ins = 0;
    nb.ix = B.x;
    nb.iy = B.y;
    nb.sp = 1;
    ch.balls.push(nb);
  }
  pointAt(tr, head.s + BALL_D, tmpL);
  ev.push({ type: 'spit', x: B.x, y: B.y, tx: tmpL.x, ty: tmpL.y, c: colors[0] });
  return true;
}

/** Choked mid-spit: the spit is cancelled and it coughs 1-2 power-ups onto random marbles along chain 0. */
function serpentChoke(st: GameState, level: Level, ev: GameEvent[]) {
  st.boss!.wind = 0;
  const balls = st.chains[0].balls;
  const tr = level.tracks[0];
  const cands: Ball[] = [];
  for (let i = 0; i < balls.length; i++) {
    const b = balls[i];
    if (b.p || b.clr >= 0 || b.ins < 1 || b.s < tr.visibleFrom || inTunnel(tr, b.s)) continue;
    if (balls[i - 1]?.p || balls[i + 1]?.p) continue;
    cands.push(b);
  }
  const at: { x: number; y: number; power: Power }[] = [];
  for (let n = 1 + Math.floor(rand(st, 'bonus') * 2) + st.mods.chokeExtra; n > 0 && cands.length; n--) {
    const b = cands.splice(Math.floor(rand(st, 'bonus') * cands.length), 1)[0];
    b.p = level.powerPool[Math.floor(rand(st, 'bonus') * level.powerPool.length)] as Power;
    b.pt = TUNING.powerLife * st.mods.powerLifeMul;
    pointAt(tr, b.s, tmpL);
    at.push({ x: tmpL.x, y: tmpL.y, power: b.p });
  }
  ev.push({ type: 'choke', x: level.bossFight!.x, y: level.bossFight!.y, at });
}

function damageBoss(st: GameState, dmg: number) {
  const b = st.boss;
  if (!b || b.dead) return;
  b.hp = Math.max(0, b.hp - dmg);
  b.hitT = 0.2;
}

/** Boss beaten: no more marbles; the chain freezes and pops from the head back. */
function bossDefeated(st: GameState, level: Level, ev: GameEvent[]) {
  const b = st.boss!;
  b.dead = true;
  b.wind = 0;
  b.shots.length = 0;
  st.cascade = true;
  st.spawning = false;
  st.barFull = true;
  st.revT = 0;
  st.chains.forEach((ch, ci) => {
    const tr = level.tracks[ci];
    ch.pending.length = 0;
    ch.balls = ch.balls.filter((x) => x.s >= tr.visibleFrom - BALL_D || x.clr >= 0);
    ch.stopT = 1e6;
  });
  ev.push({ type: 'bossDown', x: level.bossFight!.x, y: level.bossFight!.y });
}

function stepCascade(st: GameState, level: Level, ev: GameEvent[]) {
  if (!st.cascade) return;
  st.chains.forEach((ch, ci) => {
    for (let i = ch.balls.length - 1; i >= 0; i--) {
      const b = ch.balls[i];
      if (b.clr >= 0) continue;
      b.p = Power.None;
      startClear(st, level, ci, b, 0, ev);
      st.score += 10;
      pointAt(level.tracks[ci], b.s, tmp);
      ev.push({ type: 'cascade', x: tmp.x, y: tmp.y, c: b.c });
      break;
    }
  });
}

// ------------------------------------------------------------------ scorpions + coins

function stepScorpions(st: GameState, level: Level, ev: GameEvent[]) {
  for (let k = st.scorps.length - 1; k >= 0; k--) {
    const sc = st.scorps[k];
    const tr = level.tracks[sc.ci];
    const balls = st.chains[sc.ci].balls;
    sc.s -= TUNING.scorpionSpeed * DT;
    for (let i = balls.length - 1; i >= 0 && sc.left > 0; i--) {
      const b = balls[i];
      if (b.clr >= 0) continue;
      if (b.s < sc.s - BALL_R) break;
      startClear(st, level, sc.ci, b, 0, ev);
      st.score += 10;
      sc.left--;
      pointAt(tr, b.s, tmp);
      ev.push({ type: 'eat', x: tmp.x, y: tmp.y, c: b.c });
    }
    if (sc.left <= 0 || sc.s < tr.visibleFrom) st.scorps.splice(k, 1);
  }
}

/** Black holes pull in the nearest marble around them, one at a time, until they close. */
function stepHoles(st: GameState, level: Level, ev: GameEvent[]) {
  for (let k = st.holes.length - 1; k >= 0; k--) {
    const h = st.holes[k];
    h.t -= DT;
    h.n -= DT;
    const tr = level.tracks[h.ci];
    if (h.n <= 0) {
      h.n = TUNING.holeRate;
      let best: Ball | null = null;
      let bd = TUNING.holeReach;
      for (const b of st.chains[h.ci]?.balls ?? []) {
        if (b.clr >= 0 || b.ins < 1 || b.s < tr.visibleFrom || inTunnel(tr, b.s)) continue;
        const d = b.s > h.s ? b.s - h.s : h.s - b.s;
        if (d < bd) {
          bd = d;
          best = b;
        }
      }
      if (best) {
        startClear(st, level, h.ci, best, 0, ev);
        st.score += 10;
        h.left--;
        pointAt(tr, best.s, tmp);
        ev.push({ type: 'eat', x: tmp.x, y: tmp.y, c: best.c });
      }
    }
    if (h.t <= 0 || h.left <= 0) st.holes.splice(k, 1);
  }
}

function stepCoin(st: GameState, level: Level, ev: GameEvent[]) {
  if (st.coin) {
    st.coin.t -= DT;
    if (st.coin.t <= 0) {
      ev.push({ type: 'coinGone', x: st.coin.x, y: st.coin.y });
      st.coin = null;
    }
    return;
  }
  if (isRolling(st) || st.barFull || st.cascade) return;
  st.coinT -= DT;
  if (st.coinT > 0) return;
  st.coinT = (TUNING.coinEvery + rand(st, 'bonus') * TUNING.coinJitter) / st.mods.coinSpawnMul;
  const p = coinSpot(st, level);
  if (!p) return;
  st.coin = { x: p.x, y: p.y, t: TUNING.coinLife };
  ev.push({ type: 'coin', x: p.x, y: p.y });
}

/** A random open spot for a coin: off the tracks, away from the launcher, in line of sight. */
function coinSpot(st: GameState, level: Level): Pt | null {
  const m = 70;
  const clear2 = BALL_D * 1.4 * (BALL_D * 1.4);
  for (let k = 0; k < 16; k++) {
    const x = Math.round(m + rand(st, 'bonus') * (level.worldW - 2 * m));
    const y = Math.round(m + rand(st, 'bonus') * (level.worldH - 2 * m));
    const R = level.rail;
    let from: Pt;
    if (R) {
      if ((x - R.a.x) * R.n.x + (y - R.a.y) * R.n.y < 150) continue;
      from = railPoint(R, railProject(R, x, y));
    } else {
      from = level.launcher;
      if ((x - from.x) * (x - from.x) + (y - from.y) * (y - from.y) < 140 * 140) continue;
    }
    const B = level.bossFight;
    if (B && (x - B.x) * (x - B.x) + (y - B.y) * (y - B.y) < (B.r + 80) * (B.r + 80)) continue;
    let ok = true;
    for (const tr of level.tracks) {
      for (let i = 0; i < tr.xs.length && ok; i += 6) {
        const dx = tr.xs[i] - x;
        const dy = tr.ys[i] - y;
        if (dx * dx + dy * dy < clear2) ok = false;
      }
    }
    if (!ok) continue;
    // Reachable: nothing in the way of a straight shot.
    const dx = x - from.x;
    const dy = y - from.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    const hit = raycast(st, level, dx, dy, from);
    if (hit && hit.dist < d - TUNING.muzzle) continue;
    return { x, y };
  }
  return null;
}

function rerollGun(st: GameState, level: Level) {
  if (ballCount(st) === 0) return;
  const mask = presentMask(st);
  if (!(mask & (1 << st.gun.cur))) st.gun.cur = randColor(st, level, 'gun');
  if (!(mask & (1 << st.gun.next))) st.gun.next = randColor(st, level, 'gun');
  if (st.mods.scout && !(mask & (1 << st.gun.after))) st.gun.after = randColor(st, level, 'gun');
}

// ------------------------------------------------------------------ shots

const tmp: Pt = { x: 0, y: 0 };
const tmp2: Pt = { x: 0, y: 0 };
const tmpL: Pt = { x: 0, y: 0 };

function hittable(b: Ball, track: Track) {
  return b.clr < 0 && b.ins >= 1 && b.s > track.visibleFrom + BALL_R * 0.5 && !inTunnel(track, b.s);
}

/** Magnet Shot: curve toward the nearest hittable marble of the shot's colour ahead of it. */
function steerShot(st: GameState, level: Level, sh: Shot, spd: number) {
  let best = 1e12;
  let tx = 0;
  let ty = 0;
  st.chains.forEach((ch, ci) => {
    const tr = level.tracks[ci];
    for (const b of ch.balls) {
      if (b.c !== sh.c || !hittable(b, tr)) continue;
      pointAt(tr, b.s, tmp);
      const dx = tmp.x - sh.x;
      const dy = tmp.y - sh.y;
      if (dx * sh.vx + dy * sh.vy <= 0) continue; // only ahead
      const d2 = dx * dx + dy * dy;
      if (d2 < best) {
        best = d2;
        tx = dx;
        ty = dy;
      }
    }
  });
  if (best > 450 * 450) return;
  const d = Math.sqrt(best);
  const k = Math.min(1, TUNING.magnetSteer * DT);
  const vx = sh.vx + ((tx / d) * spd - sh.vx) * k;
  const vy = sh.vy + ((ty / d) * spd - sh.vy) * k;
  const n = Math.sqrt(vx * vx + vy * vy);
  sh.vx = (vx / n) * spd;
  sh.vy = (vy / n) * spd;
}

function stepShots(st: GameState, level: Level, ev: GameEvent[]) {
  const hd2 = TUNING.hitDist * TUNING.hitDist;
  for (let si = st.shots.length - 1; si >= 0; si--) {
    const sh = st.shots[si];
    const spd = Math.sqrt(sh.vx * sh.vx + sh.vy * sh.vy);
    if (st.magnetT > 0 && !sh.w && !sh.b) steerShot(st, level, sh, spd);
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
      // Coins float above the board: a shot passing through collects it and flies on.
      const coin = st.coin;
      if (coin) {
        const cx = sh.x - coin.x;
        const cy = sh.y - coin.y;
        const cr = TUNING.coinR + BALL_R * 0.6;
        if (cx * cx + cy * cy < cr * cr) {
          st.coin = null;
          st.score += TUNING.coinValue;
          st.extra += TUNING.coinValue;
          st.stats.coins++;
          earn(st, 'floating', COINS.floating);
          ev.push({ type: 'coinGet', x: coin.x, y: coin.y, score: TUNING.coinValue });
        }
      }
      const B = level.bossFight;
      let bossHit = false;
      if (best < 0 && B && st.boss && !st.boss.dead) {
        const bx = sh.x - B.x;
        const by = sh.y - B.y;
        const br = (B.kind === 'serpent' && st.boss.wind > 0 ? B.r * TUNING.serpentTargetK : B.r) + BALL_R * 0.7;
        bossHit = bx * bx + by * by < br * br;
      }
      if (best >= 0) {
        insertShot(st, level, sh, bestC, best, ev);
        st.shots.splice(si, 1);
        done = true;
      } else if (bossHit && B!.kind === 'serpent' && st.boss!.wind <= 0) {
        // The serpent swallows marbles shot into its closed mouth and spits them back onto the chain.
        st.shots.splice(si, 1);
        st.streak = 0;
        st.stats.misses++;
        ev.push({ type: 'swallow', x: sh.x, y: sh.y });
        serpentPush(st, level, [sh.w ? Math.floor(rand(st, 'bonus') * level.colors) : sh.c], ev);
        done = true;
      } else if (bossHit) {
        // Serpent: only hittable while it rears up to spit. The hit chokes it: no spit, big damage, a power-up.
        const choke = B!.kind === 'serpent';
        const dmg = (choke ? TUNING.serpentChoke : TUNING.bossDirectHit) * st.mods.bossDirectMul;
        damageBoss(st, dmg);
        st.stats.bossHits++;
        ev.push({ type: 'bossHit', x: sh.x, y: sh.y, dmg });
        if (choke) serpentChoke(st, level, ev);
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
  if (sh.b) {
    // Pocket Bomb: it blows up where it lands instead of joining the chain.
    ev.push({ type: 'power', power: Power.Bomb, x: sh.x, y: sh.y, c: sh.c });
    st.stats.powers++;
    blast(st, level, sh.x, sh.y, 0, ev);
    return;
  }
  const balls = st.chains[ci].balls;
  const hit = balls[hitIdx];
  const front = insertInFront(level.tracks[ci], hit, sh.x, sh.y);
  const nb = newBall(st, sh.c, hit.s);
  nb.ins = 0;
  nb.ix = sh.x;
  nb.iy = sh.y;
  // Gap bonus info rides on the ball until it settles.
  nb.gb = sh.gaps.length ? gapBonus(sh) : 0;
  if (sh.w) nb.w = 1;
  if (front) {
    nb.g = 0; // gap to the hit ball grows from 0 → D
    balls.splice(hitIdx + 1, 0, nb);
  } else {
    nb.g = 1;
    hit.g = 0; // the hit ball's gap to the new ball grows
    balls.splice(hitIdx, 0, nb);
  }
  ev.push({ type: 'hit', x: sh.x, y: sh.y, c: sh.w ? WILD : sh.c, front });
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
  let target = cruise(st, level);
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
      const nb = newBall(st, c, s);
      // Special marbles (none on early levels, so their chains are unchanged).
      const sp = level.gemChance + level.armorChance + level.chameleonChance;
      if (sp > 0 && !ch.pending.length) {
        const r = rand(st, 'chain');
        if (r < level.gemChance) nb.gem = 1;
        else if (r < level.gemChance + level.armorChance) nb.a = 1;
        else if (r < sp) nb.cm = 1;
      }
      balls.unshift(nb);
      if (balls.length > 400) break;
    }
  }

  // Settle inserted balls → match check.
  for (let i = 0; i < balls.length; i++) {
    const b = balls[i];
    if (b.ins < 1) {
      b.ins = Math.min(1, b.ins + DT / TUNING.insertTime);
      if (b.ins >= 1) {
        if (b.w) {
          b.c = wildColor(balls, i);
          delete b.w;
        }
        pointAt(track, b.s, tmp);
        ev.push({ type: 'settle', x: tmp.x, y: tmp.y, c: b.c });
        const gb = b.gb;
        b.gb = 0;
        if (b.sp) {
          delete b.sp;
          checkMatch(st, level, ci, i, 0, ev, 0);
          continue;
        }
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

const live = (b: Ball) => b.clr < 0 && b.ins >= 1;

/** Run length through index i if balls[i] had colour c. */
function runAround(balls: Ball[], i: number, c: number): number {
  let n = 1;
  for (let k = i - 1; k >= 0 && balls[k].c === c && live(balls[k]) && touching(balls[k], balls[k + 1]); k--) n++;
  for (let k = i + 1; k < balls.length && balls[k].c === c && live(balls[k]) && touching(balls[k - 1], balls[k]); k++) n++;
  return n;
}

/** A wild marble takes whichever neighbour's colour makes the longer run (front wins ties). */
function wildColor(balls: Ball[], i: number): number {
  const b = balls[i];
  let best = b.c;
  let bestRun = 0;
  for (const j of [i + 1, i - 1]) {
    const o = balls[j];
    if (!o || !live(o) || !(j > i ? touching(b, o) : touching(o, b))) continue;
    const run = runAround(balls, i, o.c);
    if (run > bestRun) {
      bestRun = run;
      best = o.c;
    }
  }
  return best;
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
  if (combo > 0) earn(st, 'combos', COINS.comboStep * combo * st.mods.comboCoinMul);
  // Shockwave: big matches (5+) also pop the marble on each side.
  const extra = st.mods.shockwave && n >= 5 ? [lo - 1, hi + 1].filter((k) => balls[k] && hittable(balls[k], track)) : [];
  // Mark the whole run first, then fire its powers (so a power sees the run as already popping).
  const powered: Ball[] = [];
  for (const k of [...extra, ...Array.from({ length: n }, (_, j) => lo + j)]) {
    pointAt(track, balls[k].s, tmp);
    if (!balls[k].a) popped.push({ x: tmp.x, y: tmp.y, c: balls[k].c, p: balls[k].p });
    startClear(st, level, ci, balls[k], combo, ev, powered);
    sx += tmp.x;
    sy += tmp.y;
  }
  for (const pb of powered) activatePower(st, level, ci, pb, ev);
  st.score += 10 * extra.length;
  ev.push({ type: 'pop', balls: popped, combo, score, x: sx / (extra.length + n), y: sy / (extra.length + n), c: b.c, gapBonus: gb, chainBonus });
  return true;
}

/** Start popping a marble. With `defer`, a power marble is collected there instead of firing now. */
function startClear(st: GameState, level: Level, ci: number, b: Ball, combo: number, ev: GameEvent[], defer?: Ball[]) {
  if (b.clr >= 0) return;
  if (b.a && !st.cascade) {
    // Armored: this pop only cracks the armor.
    delete b.a;
    pointAt(level.tracks[ci], b.s, tmp);
    ev.push({ type: 'crack', x: tmp.x, y: tmp.y, c: b.c });
    return;
  }
  b.clr = 0;
  b.combo = combo;
  b.suck = 0;
  st.stats.popped++;
  // Boss fights: every popped marble hurts the boss (combos more).
  if (!st.cascade) {
    damageBoss(st, 1 + combo);
    // Coins for marbles the player popped (the boss-defeat cascade pays nothing).
    let c = COINS.pop;
    if (b.c === st.mods.luckyColor) c *= COINS.lucky;
    if (st.mods.dangerCoinMul !== 1 && headProgress(st, level) > COINS.dangerFrac) c *= st.mods.dangerCoinMul;
    if (st.mods.popCoinMul !== 1) {
      // Coin Rush: carry fractions so 1.5× pays 1, 2, 1, 2…
      st.coinFrac += c * st.mods.popCoinMul;
      c = Math.floor(st.coinFrac);
      st.coinFrac -= c;
    }
    if (c) earn(st, 'pops', c);
    if (b.gem) {
      st.score += TUNING.gemScore;
      earn(st, 'gems', COINS.gem);
      pointAt(level.tracks[ci], b.s, tmp);
      ev.push({ type: 'gem', x: tmp.x, y: tmp.y, score: TUNING.gemScore });
    }
  }
  if (b.p !== Power.None) {
    if (defer) defer.push(b);
    else activatePower(st, level, ci, b, ev);
  }
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
  if (p === Power.Slow) st.slowT = TUNING.slowTime * st.mods.slowTimeMul;
  else if (p === Power.Reverse) st.revT = TUNING.reverseTime * st.mods.reverseTimeMul;
  else if (p === Power.Wild) st.gun.w |= st.mods.wildShots > 1 ? 3 : st.gun.w & 1 ? 2 : 1;
  else if (p === Power.Scorpion) st.scorps.push({ ci, s: level.tracks[ci].length + BALL_D, left: TUNING.scorpionEats * st.mods.scorpionEatsMul });
  else if (p === Power.Magnet) st.magnetT = TUNING.magnetTime;
  else if (p === Power.BlackHole) st.holes.push({ ci, s: b.s, t: TUNING.holeTime, left: TUNING.holeEats, n: 0.15 });
  else if (p === Power.ColorCloud) {
    // The 4 marbles on each side take its colour, so the gap snaps shut into a big combo.
    const balls = st.chains[ci].balls;
    const tr = level.tracks[ci];
    const i = balls.indexOf(b);
    const pts: { x: number; y: number }[] = [];
    for (const dir of [-1, 1]) {
      let left = 4;
      for (let k = i + dir; k >= 0 && k < balls.length && left > 0; k += dir) {
        const o = balls[k];
        if (o.clr >= 0) continue;
        if (o.s < tr.visibleFrom || inTunnel(tr, o.s)) break;
        o.c = b.c;
        delete o.cm;
        left--;
        pointAt(tr, o.s, tmp);
        pts.push({ x: tmp.x, y: tmp.y });
      }
    }
    pev.zaps = pts;
  }
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
    // Lightning Rod: a second colour is struck too, in the front half of each track.
    if (st.mods.lightningRod) {
      let mask = 0;
      st.chains.forEach((ch, oc) => {
        const tr = level.tracks[oc];
        for (const o of ch.balls) if (o.clr < 0 && o.c !== b.c && o.s > tr.length * 0.5 && !inTunnel(tr, o.s)) mask |= 1 << o.c;
      });
      const cols: number[] = [];
      for (let c = 0; c < 8; c++) if (mask & (1 << c)) cols.push(c);
      if (cols.length) {
        const c2 = cols[Math.floor(rand(st, 'bonus') * cols.length)];
        for (let oc = 0; oc < st.chains.length; oc++) {
          const tr = level.tracks[oc];
          for (const o of st.chains[oc].balls) {
            if (o.clr >= 0 || o.c !== c2 || o.s <= tr.length * 0.5 || inTunnel(tr, o.s)) continue;
            pointAt(tr, o.s, tmp);
            zaps.push({ x: tmp.x, y: tmp.y });
            startClear(st, level, oc, o, b.combo, ev);
          }
        }
      }
    }
    st.score += 10 * zaps.length;
    pev.zaps = zaps;
  } else if (p === Power.Bomb) blast(st, level, bx, by, b.combo, ev);
}

/** Bomb blast at (x, y): pops every visible marble in range, on every track. */
function blast(st: GameState, level: Level, x: number, y: number, combo: number, ev: GameEvent[]) {
  const R = TUNING.bombRadius * st.mods.bombRadiusMul;
  const r2 = R * R;
  let n = 0;
  for (let oc = 0; oc < st.chains.length; oc++) {
    const tr = level.tracks[oc];
    for (const o of st.chains[oc].balls) {
      if (o.clr >= 0 || o.s < tr.visibleFrom || inTunnel(tr, o.s)) continue;
      pointAt(tr, o.s, tmp);
      const dx = tmp.x - x;
      const dy = tmp.y - y;
      if (dx * dx + dy * dy < r2) {
        startClear(st, level, oc, o, combo, ev);
        n++;
      }
    }
  }
  st.score += 10 * n;
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
  // Opener places its power marble right away; otherwise expect one every ~(1 / (2 * powerChance)) seconds.
  if (st.openerLeft <= 0 && rand(st, 'chain') >= level.powerChance * st.mods.powerChanceMul * DT * 2) return;
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
  b.p = level.powerPool[Math.floor(rand(st, 'chain') * level.powerPool.length)] as Power;
  b.pt = TUNING.powerLife * st.mods.powerLifeMul;
  if (st.openerLeft > 0) st.openerLeft--;
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

/** Ray-cast from the launcher (or `from`). Matches shot collision geometry (static chain). */
export function raycast(st: GameState, level: Level, dx: number, dy: number, from?: Pt): RayHit | null {
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  dx /= len;
  dy /= len;
  const o = from ?? launcherAt(st, level, tmpR);
  const ox = o.x + dx * TUNING.muzzle;
  const oy = o.y + dy * TUNING.muzzle;
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

const tmpR: Pt = { x: 0, y: 0 };

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
    bar: st.boss ? 1 - st.boss.hp / st.boss.max : Math.min(1, (st.score - st.extra) / barTarget(level)),
    head: headProgress(st, level),
  };
}

export function snapshot(st: GameState): string {
  return JSON.stringify(st);
}

export function restore(json: string): GameState {
  return normalizeState(JSON.parse(json) as GameState);
}

/** Fill in fields that snapshots saved before Expedition items existed don't have. */
export function normalizeState(st: GameState): GameState {
  st.mods = { ...NO_MODS, ...st.mods };
  st.coinsEarned ??= emptyLedger();
  st.lives ??= 0;
  st.gun.b ??= 0;
  st.gun.after ??= -1;
  st.holes ??= [];
  st.magnetT ??= 0;
  st.coinFrac ??= 0;
  st.openerLeft ??= 0;
  st.windLeft ??= 0;
  return st;
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
export function runIfInserted(st: GameState, hit: RayHit, c: number, wild = false): number {
  const balls = st.chains[hit.chain].balls;
  const behind = hit.front ? hit.index : hit.index - 1;
  const ahead = behind + 1;
  if (wild) {
    // A wild marble joins whichever neighbour makes the longer run.
    let best = 0;
    for (const j of [ahead, behind]) if (balls[j] && balls[j].clr < 0) best = Math.max(best, runIfInserted(st, hit, balls[j].c));
    return best;
  }
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

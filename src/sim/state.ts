// Simulation data: tick rate, tuning constants, power-up ids, and the plain-JSON state,
// command and event types. Split out of game.ts (which re-exports all of it).

import { BALL_D, BALL_R } from './levelgen';
import type { CoinLedger, Mods } from './items';

export const TICK_HZ = 120;
export const DT = 1 / TICK_HZ;

/** Zuma px → our px. */
export const K = BALL_R / 16;
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
  /** Brakes charm: the last fraction of the track it covers. */
  brakeFrac: 0.3,
  /** Fast-forward (player toggle): cruise speed multiplier outside the danger zone, and how much quicker it gets there. */
  ffFactor: 3,
  ffAccelMul: 6,
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
  /** Fast-forward toggled on by the player. */
  ff: boolean;
  spawning: boolean;
  barFull: boolean;
  score: number;
  /** Part of the score that doesn't fill the bar (coins, end-of-level bonuses). */
  extra: number;
  streak: number; // consecutive matching shots
  /** w: wild bits (1 = current marble is wild, 2 = next); b: Pocket Bomb bits, same layout. */
  gun: { cur: number; next: number; cool: number; w: number; b: number };
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
export type Command = { type: 'fire'; x: number; y: number } | { type: 'swap' } | { type: 'move'; x: number; y: number } | { type: 'ff'; on: boolean };

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

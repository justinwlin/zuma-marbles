// Game-feel model: maps simulation events to feedback. Pure functions so the
// tuning can be unit-tested (escalation, caps, latency) without a browser.

import { type GameEvent, Power } from '../sim/game';

export interface Feedback {
  /** Freeze simulation for this many ms (impact weight). */
  hitstop: number;
  /** Screen-shake trauma to add (0..1). Shake = trauma², decays over time. */
  trauma: number;
  /** White flash alpha. */
  flash: number;
  /** Vibration pattern (ms). */
  haptic: number[];
  /** Sound id + pitch in semitones. */
  sound: string | null;
  pitch: number;
  /** Particle budget for this event. */
  particles: number;
  /** Time-scale slow motion: [scale, ms]. */
  slowmo: [number, number] | null;
}

export const FEEL = {
  maxTrauma: 1,
  traumaDecay: 1.7, // per second
  maxShakePx: 16,
  maxHitstop: 120,
  recoilPx: 9,
  recoilReturn: 0.12, // s
  aimSpring: { stiffness: 520, damping: 2 * Math.sqrt(520) }, // critically damped
  ripple: { speed: 900, amp: 0.16, decay: 0.28 }, // chain wobble on impact
  dangerStart: 0.72, // head progress where danger feedback begins
  clutchProgress: 0.86, // pop while head is past this → slow-mo "clutch save"
};

const none = (): Feedback => ({ hitstop: 0, trauma: 0, flash: 0, haptic: [], sound: null, pitch: 0, particles: 0, slowmo: null });

export interface FeelContext {
  streak: number;
  headProgress: number;
  reduceMotion: boolean;
}

export function feedbackFor(e: GameEvent, ctx: FeelContext): Feedback {
  const f = none();
  switch (e.type) {
    case 'fire':
      f.sound = 'shoot';
      f.pitch = (e.c % 3) * 0.5;
      f.haptic = [6];
      f.trauma = 0.04;
      f.particles = 8;
      break;
    case 'hit':
      f.sound = 'clack';
      f.pitch = e.c;
      f.hitstop = 22;
      f.trauma = 0.1;
      f.haptic = [12];
      f.particles = 6;
      break;
    case 'pop': {
      const n = e.balls.length;
      const c = e.combo;
      f.sound = 'pop';
      // Each combo step / streak climbs the scale: players learn to chase the pitch.
      f.pitch = Math.min(c * 3 + Math.min(ctx.streak, 6), 16);
      f.hitstop = Math.min(34 + c * 20 + (n - 3) * 4, FEEL.maxHitstop);
      // Plain pops get a light kick; real shake is saved for combos and bombs.
      f.trauma = Math.min(0.12 + c * 0.16 + (n - 3) * 0.03, 0.75);
      f.flash = c >= 2 ? Math.min(0.08 * c, 0.3) : 0;
      f.haptic = c > 0 ? [22, 30, 22 + c * 8] : [20];
      f.particles = Math.min(n * (14 + c * 4), 160);
      if (ctx.headProgress > FEEL.clutchProgress) f.slowmo = [0.3, 380];
      break;
    }
    case 'suck':
      f.sound = 'magnet';
      f.particles = 4;
      break;
    case 'contact':
      f.sound = e.matched ? 'thunk' : 'clack';
      f.pitch = e.matched ? e.combo * 2 : -5;
      f.trauma = e.matched ? 0.1 + e.combo * 0.05 : 0.04;
      f.hitstop = e.matched ? 20 : 0;
      f.haptic = e.matched ? [16] : [6];
      f.particles = e.matched ? 10 : 3;
      break;
    case 'power':
      f.sound = ['', 'boom', 'slow', 'rewind', 'zap', 'wild', 'scorpion'][e.power];
      if (e.power === Power.Lightning) {
        f.hitstop = 80;
        f.trauma = 0.75;
        f.flash = 0.6;
        f.haptic = [20, 20, 35, 20, 60];
        f.particles = 90;
      } else if (e.power === Power.Bomb) {
        f.hitstop = 95;
        f.trauma = 0.9;
        f.flash = 0.55;
        f.haptic = [45, 25, 70];
        f.particles = 120;
      } else {
        f.trauma = 0.2;
        f.flash = 0.12;
        f.haptic = [15, 40, 15];
        f.particles = 40;
      }
      break;
    case 'miss':
      f.sound = 'whiff';
      break;
    case 'swap':
      f.sound = 'swap';
      f.haptic = [5];
      break;
    case 'barFull':
      f.sound = 'barfull';
      f.haptic = [20, 60, 20, 60, 40];
      f.flash = 0.15;
      break;
    case 'lose':
      f.sound = 'lose';
      f.haptic = [80, 60, 160];
      f.trauma = 0.6;
      break;
    case 'won':
      f.sound = 'win';
      f.haptic = [20, 40, 20, 40, 60];
      f.particles = 150;
      break;
    case 'coin':
      f.sound = 'coinAppear';
      f.particles = 10;
      break;
    case 'coinGet':
      f.sound = 'coin';
      f.hitstop = 30;
      f.trauma = 0.15;
      f.flash = 0.08;
      f.haptic = [10, 30, 10];
      f.particles = 30;
      break;
    case 'eat':
      f.sound = 'crunch';
      f.haptic = [8];
      f.particles = 10;
      break;
    case 'cascade':
      f.sound = 'pop';
      f.particles = 6;
      f.trauma = 0.03;
      break;
    case 'bossHit':
      f.sound = 'bossHit';
      f.hitstop = 50;
      f.trauma = 0.35;
      f.flash = 0.1;
      f.haptic = [25, 20, 25];
      f.particles = 40;
      break;
    case 'bossAttack':
      f.sound = 'bossThrow';
      f.trauma = 0.08;
      f.haptic = [10];
      break;
    case 'bossWindup':
      f.sound = 'windup';
      break;
    case 'swallow':
      f.sound = 'spit';
      f.trauma = 0.06;
      f.haptic = [8];
      f.particles = 8;
      break;
    case 'spit':
      f.sound = 'spit';
      f.trauma = 0.12;
      f.haptic = [12];
      f.particles = 14;
      break;
    case 'stun':
      f.sound = 'stun';
      f.hitstop = 60;
      f.trauma = 0.6;
      f.flash = 0.2;
      f.haptic = [60, 40, 60];
      f.particles = 24;
      break;
    case 'dodge':
      f.sound = 'thud';
      f.trauma = 0.25;
      f.hitstop = 25;
      f.haptic = [18];
      f.particles = 26;
      break;
    case 'bossDown':
      f.sound = 'bossDown';
      f.hitstop = 120;
      f.trauma = 1;
      f.flash = 0.7;
      f.haptic = [50, 30, 80, 30, 120];
      f.particles = 160;
      f.slowmo = [0.35, 700];
      break;
    case 'coinGone':
    case 'rollInDone':
    case 'settle':
    case 'lost':
      break;
  }
  if (ctx.reduceMotion) {
    f.trauma = 0;
    f.flash = Math.min(f.flash, 0.05);
    f.slowmo = null;
  }
  return f;
}

/** Shake offset in px for a trauma level (deterministic noise from time). */
export function shakeOffset(trauma: number, t: number, maxPx = FEEL.maxShakePx): { x: number; y: number; rot: number } {
  const k = trauma * trauma * maxPx * Math.SQRT1_2; // per-axis, so the diagonal stays ≤ maxPx
  return {
    x: k * (Math.sin(t * 61.3) * 0.6 + Math.sin(t * 23.1 + 1.7) * 0.4),
    y: k * (Math.sin(t * 57.7 + 0.5) * 0.6 + Math.sin(t * 19.3 + 2.9) * 0.4),
    rot: (k / maxPx) * 0.012 * Math.sin(t * 37.1),
  };
}

/** Critically damped spring step for angles (handles wrap-around). */
export function springAngle(cur: number, vel: number, target: number, dt: number): [number, number] {
  let d = target - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  const { stiffness, damping } = FEEL.aimSpring;
  const acc = stiffness * d - damping * vel;
  vel += acc * dt;
  cur += vel * dt;
  return [cur, vel];
}

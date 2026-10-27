// Infinite, deterministic level generation. A level is fully described by
// (campaignSeed, index): same inputs → identical track, colors and tuning on every device.

import { hash32, Rng } from './rng';
import { buildTrack, chaikin, type Pt, type Track, TRACK_STEP } from './track';

export const WORLD_W = 1280;
export const WORLD_H = 720;
export const BALL_R = 18;
export const BALL_D = BALL_R * 2;

export type TrackFamily = 'spiral' | 'lobes' | 'serpentine' | 'wave';

export interface LevelDef {
  campaignSeed: string;
  index: number;
  seed: number;
  family: TrackFamily;
  name: string;
  /** Dense smoothed polyline (world coords). Entry starts off-screen. */
  points: Pt[];
  launcher: Pt;
  colors: number; // number of distinct colors (≤ 6)
  /** Cruise speed in px/s. */
  speed: number;
  /** Balls that must be popped to fill the progress bar and stop spawning. */
  target: number;
  powerChance: number;
  /** Attempts the generator needed (debug/telemetry). */
  attempts: number;
}

export interface Level extends LevelDef {
  track: Track;
}

const NAMES_A = ['Azure', 'Ember', 'Jade', 'Violet', 'Golden', 'Crimson', 'Silver', 'Neon', 'Lunar', 'Solar', 'Coral', 'Frost'];
const NAMES_B = ['Spiral', 'Orbit', 'Coil', 'Bloom', 'Serpent', 'Cascade', 'Vortex', 'Loop', 'Halo', 'Drift', 'Ripple', 'Helix'];

export function levelSeed(campaignSeed: string, index: number): number {
  return hash32(`${campaignSeed}#${index}`);
}

/** Difficulty curve as a function of level index (0-based). */
export function difficulty(index: number) {
  const d = Math.max(0, index);
  return {
    colors: d < 3 ? 4 : d < 14 ? 5 : 6,
    // Rises quickly at first, then flattens so endless play stays fair.
    speed: 27 + 35 * (1 - Math.exp(-d / 14)),
    target: Math.min(70 + d * 6, 200),
    powerChance: d === 0 ? 0.03 : 0.05,
  };
}

export function generateLevel(campaignSeed: string, index: number): Level {
  const seed = levelSeed(campaignSeed, index);
  const rng = new Rng(seed);
  const diff = difficulty(index);
  const families: TrackFamily[] =
    index === 0 ? ['spiral'] : index < 3 ? ['spiral', 'lobes', 'wave'] : ['spiral', 'lobes', 'serpentine', 'wave'];

  let attempts = 0;
  let result: { points: Pt[]; launcher: Pt; family: TrackFamily } | null = null;
  while (attempts < 60 && !result) {
    attempts++;
    const family = rng.pick(families);
    const cand = GENERATORS[family](rng, index);
    if (validate(cand.points, cand.launcher)) result = { ...cand, family };
  }
  if (!result) {
    // Fallback that is always valid.
    const cand = GENERATORS.spiral(new Rng(seed ^ 0x9e3779b9), 0, true);
    result = { ...cand, family: 'spiral' };
  }

  const name = `${rng.pick(NAMES_A)} ${rng.pick(NAMES_B)}`;
  const track = buildTrack(result.points, { w: WORLD_W, h: WORLD_H });
  return {
    campaignSeed,
    index,
    seed,
    family: result.family,
    name,
    points: result.points,
    launcher: result.launcher,
    colors: diff.colors,
    speed: diff.speed,
    target: diff.target,
    powerChance: diff.powerChance,
    attempts,
    track,
  };
}

// ---------------------------------------------------------------- generators

type Gen = (rng: Rng, index: number, safe?: boolean) => { points: Pt[]; launcher: Pt };

const q = (v: number) => Math.round(v * 16) / 16;

/** Prepend an off-screen run-in so balls roll in from outside the board. */
function withEntry(raw: Pt[], len = 260): Pt[] {
  // Quantize to 1/16 px so sin/cos/pow differences between JS engines can't change the track.
  const pts = raw.map((p) => ({ x: q(p.x), y: q(p.y) }));
  const a = pts[0];
  // Head out from the start toward the nearest edge.
  const dl = a.x;
  const dr = WORLD_W - a.x;
  const dt = a.y;
  const db = WORLD_H - a.y;
  const m = Math.min(dl, dr, dt, db);
  let e: Pt;
  if (m === dl) e = { x: -len, y: a.y };
  else if (m === dr) e = { x: WORLD_W + len, y: a.y };
  else if (m === dt) e = { x: a.x, y: -len };
  else e = { x: a.x, y: WORLD_H + len };
  return [e, ...pts];
}

function spiralLike(rng: Rng, opts: { lobes: number; lobeAmp: number; turns: number; safe?: boolean }) {
  const cx = WORLD_W / 2 + (opts.safe ? 0 : rng.range(-60, 60));
  const cy = WORLD_H / 2 + (opts.safe ? 0 : rng.range(-25, 25));
  const dir = rng.chance(0.5) ? 1 : -1;
  const th0 = rng.range(0, Math.PI * 2);
  const axOut = Math.min(cx, WORLD_W - cx) - 46;
  const ayOut = Math.min(cy, WORLD_H - cy) - 40;
  const ayIn = rng.range(118, 140);
  const axIn = ayIn * rng.range(1.15, 1.45);
  const wobK = rng.int(2, 5);
  const wobA = opts.safe ? 0 : rng.range(0, 0.05);
  const wobP = rng.range(0, Math.PI * 2);
  const pts: Pt[] = [];
  const steps = Math.ceil(opts.turns * 180);
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const th = th0 + dir * u * opts.turns * Math.PI * 2;
    // Ease the radius so outer rings are spaced more like the inner ones.
    const k = Math.pow(u, 0.92);
    const lobe = 1 + opts.lobeAmp * Math.cos(opts.lobes * th) * (1 - u * 0.6);
    const wob = 1 + wobA * Math.sin(wobK * th + wobP);
    const ax = (axOut + (axIn - axOut) * k) * lobe * wob;
    const ay = (ayOut + (ayIn - ayOut) * k) * lobe * wob;
    pts.push({ x: cx + ax * Math.cos(th), y: cy + ay * Math.sin(th) });
  }
  // Outer-most point may touch the edge; clamp inside the board.
  for (const p of pts) {
    p.x = Math.min(WORLD_W - 30, Math.max(30, p.x));
    p.y = Math.min(WORLD_H - 30, Math.max(30, p.y));
  }
  return { points: chaikin(withEntry(pts), 2), launcher: { x: cx, y: cy } };
}

export const __GEN = {} as Record<TrackFamily, Gen>;
const GENERATORS: Record<TrackFamily, Gen> = {
  spiral(rng, index, safe) {
    const turns = safe ? 1.6 : rng.range(1.35, 2.05) + Math.min(index, 20) * 0.004;
    return spiralLike(rng, { lobes: 0, lobeAmp: 0, turns, safe });
  },
  lobes(rng) {
    return spiralLike(rng, { lobes: rng.int(3, 6), lobeAmp: rng.range(0.08, 0.16), turns: rng.range(1.3, 1.8) });
  },
  wave(rng) {
    return spiralLike(rng, { lobes: rng.int(6, 10), lobeAmp: rng.range(0.035, 0.06), turns: rng.range(1.4, 1.9) });
  },
  serpentine(rng) {
    // Horizontal rows above and below a central lane that holds the launcher.
    const left = rng.range(60, 120);
    const right = WORLD_W - rng.range(60, 120);
    const topRows = rng.int(1, 3);
    const botRows = rng.int(1, 3);
    const gap = rng.range(92, 110);
    // S-shape: bottom rows (outer → inner), up one side, top rows (inner → outer).
    // The launcher sits in the open lane between them.
    const way: Pt[] = [];
    const ys: number[] = [];
    for (let i = 0; i < botRows; i++) ys.push(WORLD_H - 52 - i * gap);
    for (let i = topRows - 1; i >= 0; i--) ys.push(52 + i * gap);
    let goRight = rng.chance(0.5);
    for (const ry of ys) {
      const a = goRight ? left : right;
      const b = goRight ? right : left;
      const amp = rng.range(0, 12);
      const ph = rng.range(0, 6);
      for (let k = 0; k <= 8; k++) {
        const x = a + ((b - a) * k) / 8;
        const edge = k === 0 || k === 8 ? 0 : 1;
        way.push({ x, y: ry + Math.sin(k * 0.9 + ph) * amp * edge });
      }
      goRight = !goRight;
    }
    const launcher = { x: WORLD_W / 2 + rng.range(-120, 120), y: WORLD_H / 2 + rng.range(-20, 20) };
    return { points: chaikin(withEntry(way), 5), launcher };
  },
};

// ---------------------------------------------------------------- validation

/** Rejects tracks whose parts overlap, leave the board, or crowd the launcher. */
export function validate(points: Pt[], launcher: Pt): boolean {
  const track = buildTrack(points, { w: WORLD_W, h: WORLD_H });
  const { xs, ys } = track;
  const n = xs.length;
  const visStart = Math.floor(track.visibleFrom / TRACK_STEP);
  const visLen = track.length - track.visibleFrom;
  if (visLen < 2000 || visLen > 6200) return false;
  // Coarse samples every ~half ball.
  const stride = Math.max(1, Math.floor(BALL_R / 2 / TRACK_STEP));
  const minSep = BALL_D * 2.25;
  const minSep2 = minSep * minSep;
  const arcSkip = Math.ceil((minSep * 1.8) / TRACK_STEP);
  for (let i = visStart; i < n; i += stride) {
    const x = xs[i];
    const y = ys[i];
    const entering = i * TRACK_STEP < track.visibleFrom + 140;
    if (!entering && (x < BALL_R || x > WORLD_W - BALL_R || y < BALL_R || y > WORLD_H - BALL_R)) return false;
    const lx = x - launcher.x;
    const ly = y - launcher.y;
    if (lx * lx + ly * ly < 92 * 92) return false;
    for (let j = i + arcSkip; j < n; j += stride) {
      const dx = xs[j] - x;
      const dy = ys[j] - y;
      if (dx * dx + dy * dy < minSep2) return false;
    }
  }
  return true;
}
Object.assign(__GEN, GENERATORS);

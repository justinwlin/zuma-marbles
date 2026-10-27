// Infinite, deterministic level generation. A level is fully described by
// (campaignSeed, index): same inputs → identical tracks, colors and tuning on every device.
//
// Difficulty runs in a sawtooth: blocks of 5 levels ramp up to a mini-boss (every 5th)
// or boss (every 10th), then the next block starts a little lower than that peak.
// Levels can have one or two chains, an off-centre launcher, and a twist (mutator).
// Endless runs (seed "endless-…" / "daily-…") ramp steadily and get a twist most stages.

import { hash32, Rng } from './rng';
import { buildTrack, chaikin, type Pt, type Track, TRACK_STEP } from './track';

/** Bump when generated levels change; saves made with an older generator drop their mid-level snapshot. */
export const GEN_VERSION = 7;

export const WORLD_W = 1280;
export const WORLD_H = 720;

/**
 * Large-marble campaigns (seed prefix "xl-") use a smaller board with the same marbles,
 * so when the board is scaled to fit the screen everything is LARGE_SCALE× bigger.
 * Physics stays in px; only the board shrinks — deterministic and shareable per campaign.
 */
export const LARGE_PREFIX = 'xl-';
export const LARGE_SCALE = 1.25;
export function isLargeCampaign(seed: string) {
  return seed.startsWith(LARGE_PREFIX);
}
export function worldFor(seed: string): { w: number; h: number } {
  return isLargeCampaign(seed) ? { w: Math.round(WORLD_W / LARGE_SCALE), h: Math.round(WORLD_H / LARGE_SCALE) } : { w: WORLD_W, h: WORLD_H };
}
/** Endless runs: "endless-<seed>" (random run) or "daily-YYYYMMDD" (same for everyone that day). */
export function isEndlessSeed(seed: string) {
  const s = isLargeCampaign(seed) ? seed.slice(LARGE_PREFIX.length) : seed;
  return s.startsWith('endless-') || s.startsWith('daily-');
}

// Board size for the level currently being generated (generation is synchronous).
let GW = WORLD_W;
let GH = WORLD_H;
export const BALL_R = 18;
export const BALL_D = BALL_R * 2;

export type TrackFamily =
  | 'spiral'
  | 'lobes'
  | 'wave'
  | 'square'
  | 'heart'
  | 'serpentine'
  | 'columns'
  | 'comb'
  | 'horseshoe'
  | 'figure8'
  | 'tunnelSpiral'
  | 'twinSpiral'
  | 'twinSerpentine'
  | 'twinColumns'
  | 'bossRail';

/** Typical visible length per chain (px, normal board), measured with scripts/gen-report.ts. */
export const FAMILY_LEN: Record<TrackFamily, number> = {
  spiral: 3200,
  lobes: 3000,
  wave: 3100,
  square: 3300,
  heart: 2300,
  serpentine: 3800,
  columns: 3500,
  comb: 4350,
  horseshoe: 5350,
  figure8: 3150,
  tunnelSpiral: 3400,
  twinSpiral: 2000,
  twinSerpentine: 2300,
  twinColumns: 1700,
  bossRail: 3800,
};

/**
 * Chain speed per family, evening out how hard each shape plays: bot win rates at levels
 * 9–23 ranged 42–94% by family before this, 67–77% after. Open shapes roll faster.
 */
export const FAMILY_SPEED: Partial<Record<TrackFamily, number>> = {
  figure8: 1.38,
  comb: 1.28,
  horseshoe: 1.15,
  serpentine: 1.12,
  square: 0.95,
  spiral: 0.96,
  columns: 0.82,
};

export const SINGLE_FAMILIES: TrackFamily[] = ['spiral', 'lobes', 'wave', 'square', 'heart', 'serpentine', 'columns', 'comb', 'horseshoe', 'figure8', 'tunnelSpiral'];
export const TWIN_FAMILIES: TrackFamily[] = ['twinSpiral', 'twinSerpentine', 'twinColumns'];

/** Level twists. surge = 3× power-ups; streaky = long same-colour runs. */
export type Mutator = 'surge' | 'streaky';
export const MUTATOR_INFO: Record<Mutator, { name: string; desc: string; color: string }> = {
  surge: { name: 'Power surge', desc: '3× power-ups', color: '#7fe3ff' },
  streaky: { name: 'Streaky', desc: 'Long runs of one colour — combo time', color: '#ffb36b' },
};
export type BossKind = 'mini' | 'boss' | null;

/** Boss fights: the launcher slides along a straight rail and shoots along n. */
export interface Rail {
  a: Pt;
  /** Unit vector along the rail. */
  dir: Pt;
  /** Unit normal: the direction shots travel. */
  n: Pt;
  len: number;
}
export interface BossDef {
  /** idol: the rail boss fight (every 10th level); serpent: the mini-boss living in chain 0's skull pit. */
  kind: 'idol' | 'serpent';
  x: number;
  y: number;
  r: number;
  hp: number;
}

export interface LevelDef {
  campaignSeed: string;
  index: number;
  seed: number;
  family: TrackFamily;
  name: string;
  /** One dense smoothed polyline per chain (world coords). Entries start off-screen. */
  paths: Pt[][];
  launcher: Pt;
  /** Launcher pushed away from the board centre. */
  offCentre: boolean;
  /** Where track 0 crosses itself (bridge over tunnel), if anywhere. */
  crossings?: Pt[];
  colors: number; // number of distinct colors (≤ 6)
  /** Cruise speed in px/s. */
  speed: number;
  /** Balls that must be popped to fill the progress bar and stop spawning. */
  target: number;
  powerChance: number;
  /** Chance a new chain ball repeats the previous colour (Zuma: 0.41). */
  repeatChance: number;
  mutators: Mutator[];
  boss: BossKind;
  /** Boss fight: frog on a rail, a boss with health at the far side. */
  rail?: Rail;
  bossFight?: BossDef;
  /** Clear the level within this many seconds for the ace-time bonus. */
  ace: number;
  endless: boolean;
  /** Attempts the generator needed (debug/telemetry). */
  attempts: number;
  /** Board size in px (smaller for large-marble campaigns). */
  worldW: number;
  worldH: number;
}

export interface Level extends LevelDef {
  /** tracks[i] carries chain i. */
  tracks: Track[];
}

const NAMES_A = ['Azure', 'Ember', 'Jade', 'Violet', 'Golden', 'Crimson', 'Silver', 'Neon', 'Lunar', 'Solar', 'Coral', 'Frost'];
const NAMES_B: Record<TrackFamily, string[]> = {
  spiral: ['Spiral', 'Vortex', 'Coil', 'Helix'],
  lobes: ['Bloom', 'Clover', 'Blossom', 'Petal'],
  wave: ['Ripple', 'Halo', 'Drift', 'Tide'],
  square: ['Temple', 'Maze', 'Ziggurat', 'Vault'],
  heart: ['Heart', 'Valentine', 'Locket', 'Sweetheart'],
  serpentine: ['Serpent', 'Cascade', 'Switchback', 'River'],
  columns: ['Pillars', 'Colonnade', 'Organ', 'Falls'],
  comb: ['Comb', 'Teeth', 'Fringe', 'Crown'],
  horseshoe: ['Horseshoe', 'Rainbow', 'Arch', 'Fan'],
  figure8: ['Infinity', 'Pretzel', 'Crossing', 'Overpass'],
  tunnelSpiral: ['Undercroft', 'Catacomb', 'Wellspring', 'Burrow'],
  twinSpiral: ['Twin Vortex', 'Galaxy', 'Yin-Yang', 'Double Helix'],
  twinSerpentine: ['Twin Rivers', 'Mirror', 'Crossroads', 'Gemini'],
  twinColumns: ['Twin Pillars', 'Gateway', 'Twin Falls', 'Canyon'],
  bossRail: ['Throne', 'Lair', 'Sanctum', 'Idol'],
};

export function levelSeed(campaignSeed: string, index: number): number {
  return hash32(`${campaignSeed}#${index}`);
}

export function bossKind(index: number): BossKind {
  return index % 10 === 9 ? 'boss' : index % 5 === 4 ? 'mini' : null;
}

/**
 * Effective difficulty for a level index (0-based). Campaign: sawtooth in blocks of 5
 * (each block starts 4 higher and climbs 1.6 per level, so a block's peak is above the
 * next block's start). Endless: a steady climb.
 */
export function effDifficulty(index: number, endless = false): number {
  const i = Math.max(0, index);
  if (endless) return i * 0.9;
  return Math.floor(i / 5) * 4 + (i % 5) * 1.6;
}

/** Tuning for a level index (0-based). */
export function difficulty(index: number, endless = false) {
  const i = Math.max(0, index);
  const d = effDifficulty(i, endless);
  const boss = bossKind(i);
  const t = {
    colors: d < 3.5 ? 4 : d < 13 ? 5 : 6,
    // Rises quickly at first, then flattens so endless play stays fair.
    speed: 27 + 35 * (1 - Math.exp(-d / 14)),
    target: Math.min(70 + d * 6, 200),
    powerChance: i === 0 ? 0.03 : 0.05,
    /** Desired track length relative to the family's typical length: shorter = harder. */
    lenRatio: 1.1 - 0.25 * (1 - Math.exp(-d / 16)),
  };
  // Tuned with scripts/balance.ts: bosses are clearly harder than their neighbours but beatable.
  if (boss === 'mini') {
    t.speed *= 1.05;
    t.target *= 1.2;
  } else if (boss === 'boss') {
    t.speed *= 1.06;
    t.target *= 1.3;
    t.colors = Math.max(t.colors, 5);
    t.powerChance *= 1.6;
  }
  // First levels: mid-length tracks (long spirals wind extra rings that block shots).
  if (i < 3) t.lenRatio = 1;
  return t;
}

/** Boss health per marble of the level's target. Tuned with scripts/balance.ts. */
export const BOSS_HP = 0.8;
/**
 * Mini-boss serpent health per marble of the level's target. It swallows shots, so pops are
 * nearly all of its damage; tuned with scripts/balance.ts.
 */
export const SERPENT_HP = 1.3;
/** Mini-bosses only use tracks that end out at the edge, so the serpent never sits next to the frog. */
const SERPENT_FAMILIES: TrackFamily[] = ['serpentine', 'columns', 'comb', 'figure8', 'tunnelSpiral', 'twinSerpentine', 'twinColumns'];
const SERPENT_MIN_DIST = 350;

/**
 * Ace time in seconds, rounded to 5 s. Fit to the good bot's clear times so that a bit
 * under half of its wins beat it: quick, accurate play earns it, average play doesn't.
 */
export function aceTime(target: number, o: { bossHp?: number; serpentHp?: number; twin?: boolean } = {}): number {
  const t = o.bossHp ? 12 + o.bossHp * 0.38 : o.serpentHp ? (5 + o.serpentHp * 0.26) * (o.twin ? 1.2 : 1) : (25 + target * 0.22) * (o.twin ? 1.2 : 1);
  return Math.round(t / 5) * 5;
}

export function generateLevel(campaignSeed: string, index: number): Level {
  const world = worldFor(campaignSeed);
  GW = world.w;
  GH = world.h;
  const ks = GH / WORLD_H;
  const endless = isEndlessSeed(campaignSeed);
  const seed = levelSeed(campaignSeed, index);
  const rng = new Rng(seed);
  const diff = difficulty(index, endless);
  const boss = bossKind(index);
  if (isLargeCampaign(campaignSeed)) {
    // Fewer marbles fit on the smaller board, so levels end sooner: ask for more score.
    // Tuned with scripts/balance.ts (PREFIX=xl-) to match normal win rates/durations.
    diff.target = diff.target * 1.5;
  }

  // Two chains: from level 8 on (stage 4 in endless), more often on bosses.
  const twinChance = index < (endless ? 3 : 7) ? 0 : boss === 'boss' ? 0.4 : boss === 'mini' ? 0.25 : endless ? 0.3 : 0.22;
  // Bosses are fights on a rail (always one chain).
  const fight = boss === 'boss';
  const twin = rng.chance(twinChance) && !fight;

  // Twists.
  const mutators: Mutator[] = [];
  const pool: Mutator[] = ['surge', 'streaky'];
  if (endless) {
    if (index >= 1 && rng.chance(0.6)) mutators.push(rng.pick(pool));
    if (index >= 9 && mutators.length && rng.chance(0.3)) mutators.push(mutators[0] === 'surge' ? 'streaky' : 'surge');
  } else if (index >= 5 && !boss && rng.chance(0.35)) mutators.push(rng.pick(pool));
  let repeatChance = 0.41;
  if (mutators.includes('surge')) diff.powerChance *= 3;
  if (mutators.includes('streaky')) repeatChance = 0.62;
  if (twin) {
    // Two chains bring twice the marbles on shorter tracks: each rolls slower and the
    // bar fills sooner (tuned with the bot to land near single-chain win rates).
    diff.speed *= 0.68;
    diff.target *= 0.75;
  }

  let families: TrackFamily[] = fight
    ? ['bossRail']
    : twin
    ? TWIN_FAMILIES
    : index === 0
      ? ['spiral']
      : index < 3
        ? ['spiral', 'lobes', 'wave', 'square']
        : index < 6
          ? ['spiral', 'lobes', 'wave', 'square', 'serpentine', 'columns', 'horseshoe']
          : SINGLE_FAMILIES;
  if (boss === 'mini') families = families.filter((f) => SERPENT_FAMILIES.includes(f));
  const offChance = index < 3 ? 0 : 0.35;

  // Pick a family, then generate a few valid candidates of it and keep the one whose
  // length best fits the difficulty (shorter tracks later). Families stay evenly mixed.
  let attempts = 0;
  let best: { cand: Cand; family: TrackFamily; err: number } | null = null;
  while (attempts < 90 && !best) {
    const family = rng.pick(families);
    const off = rng.chance(offChance);
    let found = 0;
    for (let k = 0; k < 12 && found < 3 && attempts < 90; k++) {
      attempts++;
      const cand = GENERATORS[family](rng, { index, off });
      const lens = validateLevel(cand.paths, cand.launcher, twin, undefined, cand.crossings, cand.rail);
      if (!lens) continue;
      if (boss === 'mini') {
        const p0 = cand.paths[0][cand.paths[0].length - 1];
        if (Math.hypot(p0.x - cand.launcher.x, p0.y - cand.launcher.y) < SERPENT_MIN_DIST * ks) continue;
      }
      found++;
      const avg = lens.reduce((a, b) => a + b, 0) / lens.length;
      const err = Math.abs(avg / (FAMILY_LEN[family] * ks) - diff.lenRatio);
      if (!best || err < best.err) best = { cand, family, err };
    }
  }
  if (!best) {
    // Fallback that is always valid.
    const cand = GENERATORS.spiral(new Rng(seed ^ 0x9e3779b9), { index: 0, off: false, safe: true });
    best = { cand, family: 'spiral', err: 0 };
  }

  const { cand, family } = best;
  diff.speed *= FAMILY_SPEED[family] ?? 1;
  const name = `${rng.pick(NAMES_A)} ${rng.pick(NAMES_B[family])}`;
  const tracks = cand.paths.map((p) => buildTrack(p, { w: GW, h: GH }));
  if (cand.crossings) addCrossings(tracks[0], cand.crossings, rng, cand.under ?? 'random');
  // Own rng stream, so adding tunnels leaves every other part of the level unchanged.
  if (!cand.rail && index >= 2) addTunnels(tracks, new Rng(seed ^ 0x7a11e1), index);
  const off = !cand.rail && Math.hypot(cand.launcher.x - GW / 2, cand.launcher.y - GH / 2) > 90 * ks;
  const target = Math.round(diff.target);
  // Boss health ≈ marbles to pop, a bit under a normal bar (direct hits and combos add up).
  let bossFight: BossDef | undefined;
  if (cand.boss) bossFight = { kind: 'idol', ...cand.boss, hp: Math.round(target * BOSS_HP) };
  else if (boss === 'mini') {
    // The serpent replaces chain 0's skull.
    const t0 = tracks[0];
    const n = t0.xs.length - 1;
    bossFight = { kind: 'serpent', x: t0.xs[n], y: t0.ys[n], r: 30, hp: Math.round(target * SERPENT_HP) };
  }
  return {
    campaignSeed,
    index,
    seed,
    family,
    name,
    paths: cand.paths,
    launcher: cand.launcher,
    offCentre: off,
    crossings: cand.crossings,
    colors: diff.colors,
    speed: diff.speed,
    target,
    powerChance: diff.powerChance,
    repeatChance,
    mutators,
    boss,
    rail: cand.rail,
    bossFight,
    ace: aceTime(target, { bossHp: bossFight?.kind === 'idol' ? bossFight.hp : undefined, serpentHp: bossFight?.kind === 'serpent' ? bossFight.hp : undefined, twin }),
    endless,
    attempts,
    worldW: GW,
    worldH: GH,
    tracks,
  };
}

// ---------------------------------------------------------------- generators

interface Cand {
  paths: Pt[][];
  launcher: Pt;
  /** Points where path 0 crosses itself (one pass bridges over the other). */
  crossings?: Pt[];
  /** Which pass runs under: the earlier one ('first') or chosen at random. */
  under?: 'first' | 'random';
  rail?: Rail;
  boss?: { x: number; y: number; r: number };
}
interface GenOpts {
  index: number;
  /** Push the launcher off-centre. */
  off: boolean;
  safe?: boolean;
}
type Gen = (rng: Rng, o: GenOpts) => Cand;
export type { Cand };

const q = (v: number) => Math.round(v * 16) / 16;

/** Prepend an off-screen run-in so balls roll in from outside the board. */
function withEntry(raw: Pt[], len = 260): Pt[] {
  // Quantize to 1/16 px so sin/cos/pow differences between JS engines can't change the track.
  const pts = raw.map((p) => ({ x: q(p.x), y: q(p.y) }));
  const a = pts[0];
  // Head out from the start toward the nearest edge.
  const dl = a.x;
  const dr = GW - a.x;
  const dt = a.y;
  const db = GH - a.y;
  const m = Math.min(dl, dr, dt, db);
  let e: Pt;
  if (m === dl) e = { x: -len, y: a.y };
  else if (m === dr) e = { x: GW + len, y: a.y };
  else if (m === dt) e = { x: a.x, y: -len };
  else e = { x: a.x, y: GH + len };
  return [e, ...pts];
}

const clampIn = (pts: Pt[]) => {
  for (const p of pts) {
    p.x = Math.min(GW - 30, Math.max(30, p.x));
    p.y = Math.min(GH - 30, Math.max(30, p.y));
  }
  return pts;
};

type Shape = 'ellipse' | 'square' | 'heart';

/** Unit outline point for an angle (x, y in about −1..1). */
function shapePt(shape: Shape, th: number, k = 0): Pt {
  const c = Math.cos(th);
  const s = Math.sin(th);
  if (shape === 'square') {
    // Superellipse: a rounded rectangle.
    const p = 0.45;
    return { x: Math.sign(c) * Math.pow(Math.abs(c), p), y: Math.sign(s) * Math.pow(Math.abs(s), p) };
  }
  if (shape === 'heart') {
    // Polar heart: a notch at the top and a point at the bottom (y grows downward on screen).
    // Star-shaped, so nested copies never cross; the notch is shallow enough to keep rings apart.
    const a = Math.atan2(s, c);
    const top = a + Math.PI / 2; // 0 at the top
    const wrap = (v: number) => Math.atan2(Math.sin(v), Math.cos(v));
    // Heart on the outer ring (shallow notch on top, sides narrowing to a point below),
    // easing to an ellipse inside so the notch can't reach the next ring.
    const h = Math.max(0, 1 - k * 1.1);
    const r = 1 - 0.15 * h * Math.exp(-(wrap(top) ** 2) / 0.06);
    const narrow = 1 - 0.42 * h * Math.pow(Math.max(0, s), 1.6);
    return { x: r * c * narrow, y: r * s };
  }
  return { x: c, y: s };
}

interface SpiralOpts {
  lobes: number;
  lobeAmp: number;
  turns: number;
  shape?: Shape;
  safe?: boolean;
  /** Launcher offset from the board centre; the spiral's centre drifts toward it as it winds in. */
  drift?: Pt;
  /** Cap on width/height so shapes like the heart don't stretch across the board. */
  maxAspect?: number;
  /** Fixed start angle (default random). */
  th0?: number;
  /** Twin arm: start half a turn round. */
  arm?: number;
  arms?: number;
}

function spiralArm(rng: Rng, o: SpiralOpts, base: { cx: number; cy: number; dir: number; th0: number; ayIn: number; axIn: number }): Pt[] {
  const { cx, cy, dir, ayIn, axIn } = base;
  const th0 = base.th0 + ((o.arm ?? 0) * Math.PI * 2) / (o.arms ?? 1);
  const ayOut = Math.min(cy, GH - cy) - 40;
  const axOut = Math.min(Math.min(cx, GW - cx) - 46, o.maxAspect ? ayOut * o.maxAspect : Infinity);
  let turns = o.turns;
  // Twin arms interleave: each needs room for the other between its own rings.
  if ((o.arms ?? 1) > 1) turns = Math.min(turns, (ayOut - ayIn) / (BALL_D * 4.7));
  // Small (large-marble) boards: never wind more turns than fit at ≥ 2.5 marbles apart.
  if (GH < WORLD_H && (o.arms ?? 1) === 1) {
    const maxTurns = (ayOut - ayIn) / (BALL_D * 2.5 * (1 + o.lobeAmp * 2));
    turns = Math.max(1.05, Math.min(turns, maxTurns));
  }
  const shape = o.shape ?? 'ellipse';
  const wobK = rng.int(2, 5);
  const wobA = o.safe || shape !== 'ellipse' ? 0 : rng.range(0, 0.05);
  const wobP = rng.range(0, Math.PI * 2);
  const dx = o.drift?.x ?? 0;
  const dy = o.drift?.y ?? 0;
  const pts: Pt[] = [];
  const steps = Math.ceil(turns * 180);
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const th = th0 + dir * u * turns * Math.PI * 2;
    // Ease the radius so outer rings are spaced more like the inner ones.
    const k = Math.pow(u, 0.92);
    const lobe = 1 + o.lobeAmp * Math.cos(o.lobes * th) * (1 - u * 0.6);
    const wob = 1 + wobA * Math.sin(wobK * th + wobP);
    const ax = (axOut + (axIn - axOut) * k) * lobe * wob;
    const ay = (ayOut + (ayIn - ayOut) * k) * lobe * wob;
    const sp = shapePt(shape, th, k);
    pts.push({ x: cx + dx * k + ax * sp.x, y: cy + dy * k + ay * sp.y });
  }
  return chaikin(withEntry(clampIn(pts)), 2);
}

function spiralLike(rng: Rng, o: SpiralOpts): Cand {
  const cx = GW / 2 + (o.safe ? 0 : rng.range(-60, 60));
  const cy = GH / 2 + (o.safe ? 0 : rng.range(-25, 25));
  const dir = rng.chance(0.5) ? 1 : -1;
  const th0 = o.th0 ?? rng.range(0, Math.PI * 2);
  const twin = (o.arms ?? 1) > 1;
  const ayIn = twin ? rng.range(104, 116) : rng.range(118, 140);
  const axIn = ayIn * (o.maxAspect ? Math.min(o.maxAspect, 1.1) : rng.range(1.15, 1.45));
  const base = { cx, cy, dir, th0, ayIn, axIn };
  const arms = o.arms ?? 1;
  const paths: Pt[][] = [];
  for (let a = 0; a < arms; a++) paths.push(spiralArm(rng, { ...o, arm: a, arms }, base));
  return { paths, launcher: { x: cx + (o.drift?.x ?? 0), y: cy + (o.drift?.y ?? 0) } };
}

/** Off-centre drift for spiral-type tracks. */
function drift(rng: Rng, o: GenOpts): Pt | undefined {
  if (!o.off) return undefined;
  const sx = rng.chance(0.5) ? 1 : -1;
  return { x: sx * rng.range(140, 260) * (GW / WORLD_W), y: rng.range(-40, 40) * (GH / WORLD_H) };
}

const turnK = () => 0.55 + 0.45 * (GH / WORLD_H);

/** Rows of a boustrophedon: alternate direction each row. */
function rows(rng: Rng, ys: number[], left: number, right: number, goRight: boolean, wobble = 12): Pt[] {
  const way: Pt[] = [];
  for (const ry of ys) {
    const a = goRight ? left : right;
    const b = goRight ? right : left;
    const amp = rng.range(0, wobble);
    const ph = rng.range(0, 6);
    for (let k = 0; k <= 8; k++) {
      const x = a + ((b - a) * k) / 8;
      const edge = k === 0 || k === 8 ? 0 : 1;
      way.push({ x, y: ry + Math.sin(k * 0.9 + ph) * amp * edge });
    }
    goRight = !goRight;
  }
  return way;
}

/** Vertical columns: alternate direction each column. */
function cols(xs: number[], top: number, bottom: number, goDown: boolean): Pt[] {
  const way: Pt[] = [];
  for (const cx of xs) {
    const a = goDown ? top : bottom;
    const b = goDown ? bottom : top;
    for (let k = 0; k <= 6; k++) way.push({ x: cx, y: a + ((b - a) * k) / 6 });
    goDown = !goDown;
  }
  return way;
}

export const __GEN = {} as Record<TrackFamily, Gen>;
const GENERATORS: Record<TrackFamily, Gen> = {
  spiral(rng, o) {
    const turns = (o.safe ? 1.6 : rng.range(1.35, 2.05) + Math.min(o.index, 20) * 0.004) * turnK();
    return spiralLike(rng, { lobes: 0, lobeAmp: 0, turns, safe: o.safe, drift: o.safe ? undefined : drift(rng, o) });
  },
  lobes(rng, o) {
    return spiralLike(rng, { lobes: rng.int(3, 6), lobeAmp: rng.range(0.08, 0.16), turns: rng.range(1.3, 1.8) * turnK(), drift: drift(rng, o) });
  },
  wave(rng, o) {
    return spiralLike(rng, { lobes: rng.int(6, 10), lobeAmp: rng.range(0.035, 0.06), turns: rng.range(1.4, 1.9) * turnK(), drift: drift(rng, o) });
  },
  square(rng, o) {
    return spiralLike(rng, { lobes: 0, lobeAmp: 0, turns: rng.range(1.3, 1.85) * turnK(), shape: 'square', drift: drift(rng, o) });
  },
  heart(rng, o) {
    return spiralLike(rng, { lobes: 0, lobeAmp: 0, turns: rng.range(1.3, 1.75) * turnK(), shape: 'heart', maxAspect: 1.35, th0: Math.PI / 2 + rng.range(-0.3, 0.3), drift: o.off ? { x: drift(rng, o)!.x * 0.6, y: 0 } : undefined });
  },
  serpentine(rng) {
    // Horizontal rows above and below a central lane that holds the launcher.
    const left = rng.range(60, 120);
    const right = GW - rng.range(60, 120);
    const topRows = rng.int(1, 3);
    const botRows = rng.int(1, 3);
    const gap = rng.range(92, 110);
    // S-shape: bottom rows (outer → inner), up one side, top rows (inner → outer).
    const ys: number[] = [];
    for (let i = 0; i < botRows; i++) ys.push(GH - 52 - i * gap);
    for (let i = topRows - 1; i >= 0; i--) ys.push(52 + i * gap);
    const way = rows(rng, ys, left, right, rng.chance(0.5));
    const launcher = { x: GW / 2 + rng.range(-120, 120), y: GH / 2 + rng.range(-20, 20) };
    return { paths: [chaikin(withEntry(way), 5)], launcher };
  },
  columns(rng) {
    // Vertical columns on both sides of an open lane; the launcher sits in the lane.
    const gap = rng.range(96, 116);
    const nl = rng.int(1, 4);
    const nr = rng.int(1, 4);
    const top = 50;
    const bottom = GH - 50;
    const xl: number[] = [];
    const xr: number[] = [];
    for (let i = 0; i < nl; i++) xl.push(60 + i * gap);
    for (let i = nr - 1; i >= 0; i--) xr.push(GW - 60 - i * gap);
    // Outer-left → inner-left, across the top/bottom of the lane, inner-right → outer-right.
    const way = cols([...xl, ...xr], top, bottom, rng.chance(0.5));
    const laneL = xl[xl.length - 1];
    const laneR = xr[0];
    const launcher = { x: (laneL + laneR) / 2 + rng.range(-40, 40), y: GH / 2 + rng.range(-30, 30) };
    return { paths: [chaikin(withEntry(way), 5)], launcher };
  },
  comb(rng) {
    // Long fingers hanging from the top edge, down one side, fingers rising from the bottom.
    const n = 2 * rng.int(2, 4); // even, so the top half ends at a finger tip
    const left = 70;
    const right = GW - 70;
    const sp = (right - left) / (n - 1);
    const reach = GH / 2 - rng.range(105, 130);
    const fromLeft = rng.chance(0.5);
    const xs: number[] = [];
    for (let i = 0; i < n; i++) xs.push(fromLeft ? left + i * sp : right - i * sp);
    // Top fingers (first one rises from its tip), then straight down the far side into
    // the bottom fingers, which end at a tip near the middle.
    const topHalf = cols(xs, 46, reach, false);
    const botHalf = cols([...xs].reverse(), GH - reach, GH - 46, true);
    const way = [...topHalf, ...botHalf];
    const launcher = { x: GW / 2 + rng.range(-80, 80), y: GH / 2 };
    return { paths: [chaikin(withEntry(way), 5)], launcher };
  },
  horseshoe(rng) {
    // Nested arches opening toward the launcher, which sits near one edge.
    const side = rng.int(0, 4); // 0 bottom, 1 top, 2 left, 3 right
    const ks = GH / WORLD_H;
    const gap = rng.range(96, 112);
    let F: Pt;
    let u: Pt; // toward the arches
    let v: Pt; // across
    let aOut: number;
    let bOut: number;
    if (side < 2) {
      F = { x: GW / 2 + rng.range(-80, 80), y: side === 0 ? GH - 120 * ks : 120 * ks };
      u = { x: 0, y: side === 0 ? -1 : 1 };
      v = { x: 1, y: 0 };
      aOut = (side === 0 ? F.y : GH - F.y) - 46;
      bOut = Math.min(F.x, GW - F.x) - 50;
    } else {
      F = { x: side === 2 ? 150 * ks : GW - 150 * ks, y: GH / 2 + rng.range(-30, 30) };
      u = { x: side === 2 ? 1 : -1, y: 0 };
      v = { x: 0, y: 1 };
      aOut = (side === 2 ? GW - F.x : F.x) - 50;
      bOut = Math.min(F.y, GH - F.y) - 44;
    }
    const n = Math.max(2, Math.min(5, Math.floor((Math.min(aOut, bOut) - 150) / gap) + 1));
    const way: Pt[] = [];
    let cw = rng.chance(0.5);
    for (let k = 0; k < n; k++) {
      const a = aOut - k * gap;
      const b = bOut - k * gap;
      const lim = Math.PI / 2 + 0.12;
      for (let j = 0; j <= 24; j++) {
        const phi = (cw ? -1 : 1) * (-lim + (2 * lim * j) / 24);
        const ca = Math.cos(phi);
        const sa = Math.sin(phi);
        way.push({ x: F.x + u.x * a * ca + v.x * b * sa, y: F.y + u.y * a * ca + v.y * b * sa });
      }
      cw = !cw;
    }
    return { paths: [chaikin(withEntry(clampIn(way)), 4)], launcher: F };
  },
  figure8(rng) {
    // A Lissajous ∞ (x = A sin t, y = B sin 2t) that crosses itself once in the middle;
    // the amplitude shrinks so it ends inside where it started instead of closing up.
    const cx = GW / 2 + rng.range(-30, 30);
    const cy = GH / 2;
    const A0 = Math.min(cx, GW - cx) - 52;
    const B0 = GH / 2 - 52;
    const A1 = A0 - rng.range(110, 150) * (GW / WORLD_W);
    const B1 = B0 - rng.range(40, 70) * (GH / WORLD_H);
    const flip = rng.chance(0.5) ? 1 : -1;
    const t0 = -Math.PI / 2;
    const t1 = (3 * Math.PI) / 2 - 0.3;
    const pts: Pt[] = [];
    const steps = 420;
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const t = t0 + (t1 - t0) * u;
      const A = A0 + (A1 - A0) * u;
      const B = B0 + (B1 - B0) * u;
      pts.push({ x: cx + A * Math.sin(t), y: cy + flip * B * Math.sin(2 * t) });
    }
    // Launcher above or below the crossing, between the lobes.
    const side = rng.chance(0.5) ? 1 : -1;
    const launcher = { x: cx, y: cy + side * B0 * rng.range(0.5, 0.6) };
    return { paths: [chaikin(withEntry(clampIn(pts)), 2)], launcher, crossings: [{ x: q(cx), y: q(cy) }] };
  },
  tunnelSpiral(rng) {
    // The chain comes in through a tunnel under the outer rings, surfaces beside the
    // launcher, and spirals outward to a skull near the edge.
    const cx = GW / 2 + rng.range(-40, 40);
    const cy = GH / 2 + rng.range(-15, 15);
    const dir = rng.chance(0.5) ? 1 : -1;
    const fromLeft = rng.chance(0.5);
    const ayIn = rng.range(120, 135);
    const axIn = ayIn * rng.range(1.25, 1.45);
    const ayOut = Math.min(cy, GH - cy) - 44;
    const axOut = Math.min(cx, GW - cx) - 60;
    const turns = Math.min(rng.range(1.25, 1.7), (ayOut - ayIn) / (BALL_D * 2.6)) * turnK();
    const th0 = fromLeft ? Math.PI : 0;
    const sx = fromLeft ? -1 : 1;
    // Straight tunnel in from the side edge to the inner ring.
    const entry: Pt[] = [];
    const ex = cx + sx * axIn;
    const edge = fromLeft ? -260 : GW + 260;
    for (let k = 0; k <= 12; k++) entry.push({ x: edge + ((ex - edge) * k) / 12, y: cy });
    const ring: Pt[] = [];
    const crossings: Pt[] = [];
    const steps = Math.ceil(turns * 180);
    for (let i = 1; i <= steps; i++) {
      const u = i / steps;
      const th = th0 + dir * u * turns * Math.PI * 2;
      const k = Math.pow(u, 1.05);
      ring.push({ x: cx + (axIn + (axOut - axIn) * k) * Math.cos(th), y: cy + (ayIn + (ayOut - ayIn) * k) * Math.sin(th) });
    }
    // Each full turn passes back over the tunnel.
    for (let n = 1; n <= Math.floor(turns); n++) {
      const u = n / turns;
      const k = Math.pow(u, 1.05);
      crossings.push({ x: q(cx + sx * (axIn + (axOut - axIn) * k)), y: q(cy) });
    }
    const pts = [...entry.map((p) => ({ x: q(p.x), y: q(p.y) })), ...ring.map((p) => ({ x: q(p.x), y: q(p.y) }))];
    return { paths: [chaikin(pts, 3)], launcher: { x: cx, y: cy }, crossings, under: 'first' as const };
  },
  twinSpiral(rng) {
    return spiralLike(rng, { lobes: 0, lobeAmp: 0, turns: rng.range(0.85, 1.12) * turnK(), arms: 2, shape: rng.chance(0.3) ? 'square' : 'ellipse' });
  },
  twinSerpentine(rng) {
    // One chain snakes down from the top, the other up from the bottom; launcher in the middle lane.
    const left = rng.range(60, 110);
    const right = GW - rng.range(60, 110);
    const n = 2;
    const gap = rng.range(94, 110);
    const topYs: number[] = [];
    const botYs: number[] = [];
    for (let i = 0; i < n; i++) {
      topYs.push(52 + i * gap);
      botYs.push(GH - 52 - i * gap);
    }
    const r = rng.chance(0.5);
    const mk = (ys: number[], goRight: boolean) => chaikin(withEntry(rows(rng, ys, left, right, goRight, 8)), 5);
    const launcher = { x: GW / 2 + rng.range(-100, 100), y: GH / 2 };
    return { paths: [mk(topYs, r), mk(botYs, !r)], launcher };
  },
  bossRail(rng) {
    // The frog slides along a rail on the right edge (the bottom on a portrait phone) and
    // shoots straight across. The chain snakes in from beside the boss, lane by lane
    // toward the rail, so the head — the dangerous end — is the most exposed.
    const ks = GH / WORLD_H;
    const kx = GW / WORLD_W;
    const xr = GW - 64 * kx;
    const rail: Rail = { a: { x: q(xr), y: q(70 * ks) }, dir: { x: 0, y: 1 }, n: { x: -1, y: 0 }, len: q(GH - 140 * ks) };
    const boss = { x: q(96 * kx), y: q(GH / 2), r: 54 };
    const n = rng.int(4, 7);
    const gap = rng.range(100, 118) * kx;
    const x1 = xr - rng.range(300, 340) * kx;
    const xs: number[] = [];
    for (let i = n - 1; i >= 0; i--) xs.push(x1 - i * gap);
    if (xs[0] < boss.x + boss.r + 60) return { paths: [[]], launcher: { x: xr, y: GH / 2 } };
    const top = 50 * ks;
    const bottom = GH - 50 * ks;
    let down = rng.chance(0.5);
    const way: Pt[] = [];
    for (const cx of xs) {
      const amp = rng.range(0, 14);
      const ph = rng.range(0, 6);
      const a = down ? top : bottom;
      const b = down ? bottom : top;
      for (let k = 0; k <= 10; k++) {
        const edge = k === 0 || k === 10 ? 0 : 1;
        way.push({ x: cx + Math.sin(k * 0.8 + ph) * amp * edge, y: a + ((b - a) * k) / 10 });
      }
      down = !down;
    }
    return { paths: [chaikin(withEntry(way), 5)], launcher: { x: rail.a.x, y: q(GH / 2) }, rail, boss };
  },
  twinColumns(rng) {
    // Left block feeds one chain, right block the other; launcher in the lane between.
    const gap = rng.range(100, 118);
    const n = rng.int(2, 4);
    const top = 50;
    const bottom = GH - 50;
    const xl: number[] = [];
    const xr: number[] = [];
    for (let i = 0; i < n; i++) {
      xl.push(60 + i * gap);
      xr.push(GW - 60 - i * gap);
    }
    const down = rng.chance(0.5);
    const launcher = { x: GW / 2 + rng.range(-60, 60), y: GH / 2 + rng.range(-30, 30) };
    return { paths: [chaikin(withEntry(cols(xl, top, bottom, down)), 5), chaikin(withEntry(cols(xr, top, bottom, !down)), 5)], launcher };
  },
};

// ---------------------------------------------------------------- validation

/** Rejects a track whose parts overlap, leave the board, or crowd the launcher. Returns its visible length. */
/** Radius around a crossing where the track may come close to itself. */
const CROSS_R = BALL_D * 3.2;

function checkPath(track: Track, launcher: Pt, minLen: number, maxLen: number, crossings: Pt[] = []): number | null {
  const nearCross = (x: number, y: number) => crossings.some((c) => (x - c.x) * (x - c.x) + (y - c.y) * (y - c.y) < CROSS_R * CROSS_R);
  const { xs, ys } = track;
  const n = xs.length;
  const visStart = Math.floor(track.visibleFrom / TRACK_STEP);
  const visLen = track.length - track.visibleFrom;
  if (visLen < minLen || visLen > maxLen) return null;
  // Coarse samples every ~half ball.
  const stride = Math.max(1, Math.floor(BALL_R / 2 / TRACK_STEP));
  const minSep = BALL_D * 2.25;
  const minSep2 = minSep * minSep;
  const arcSkip = Math.ceil((minSep * 1.8) / TRACK_STEP);
  for (let i = visStart; i < n; i += stride) {
    const x = xs[i];
    const y = ys[i];
    const entering = i * TRACK_STEP < track.visibleFrom + 140;
    if (!entering && (x < BALL_R || x > GW - BALL_R || y < BALL_R || y > GH - BALL_R)) return null;
    const lx = x - launcher.x;
    const ly = y - launcher.y;
    if (lx * lx + ly * ly < 92 * 92) return null;
    const iCross = crossings.length > 0 && nearCross(x, y);
    for (let j = i + arcSkip; j < n; j += stride) {
      const dx = xs[j] - x;
      const dy = ys[j] - y;
      if (dx * dx + dy * dy < minSep2 && !(iCross && nearCross(xs[j], ys[j]))) return null;
    }
  }
  return visLen;
}

/** Two tracks must keep the same clearance from each other as from themselves. */
function apart(a: Track, b: Track): boolean {
  const stride = Math.max(1, Math.floor(BALL_R / 2 / TRACK_STEP));
  const minSep = BALL_D * 2.25;
  const minSep2 = minSep * minSep;
  const sa = Math.max(0, Math.floor(a.visibleFrom / TRACK_STEP) - 40);
  const sb = Math.max(0, Math.floor(b.visibleFrom / TRACK_STEP) - 40);
  for (let i = sa; i < a.xs.length; i += stride) {
    for (let j = sb; j < b.xs.length; j += stride) {
      const dx = a.xs[i] - b.xs[j];
      const dy = a.ys[i] - b.ys[j];
      if (dx * dx + dy * dy < minSep2) return false;
    }
  }
  return true;
}

/** Validate every path of a level; returns visible lengths, or null if invalid. */
export function validateLevel(paths: Pt[][], launcher: Pt, twin: boolean, world?: { w: number; h: number }, crossings?: Pt[], rail?: Rail): number[] | null {
  if (paths.some((p) => p.length < 2)) return null;
  if (world) {
    GW = world.w;
    GH = world.h;
  }
  const ks = GH / WORLD_H;
  const tracks = paths.map((p) => buildTrack(p, { w: GW, h: GH }));
  const lens: number[] = [];
  for (const t of tracks) {
    const l = checkPath(t, launcher, (twin ? 1100 : 2000) * ks, twin ? 4200 : 6200, t === tracks[0] ? crossings : undefined);
    if (l === null) return null;
    // Rail levels: keep an open strip in front of the rail for shots and the boss's rocks.
    if (rail) for (let i = 0; i < t.xs.length; i += 4) if ((t.xs[i] - rail.a.x) * rail.n.x + (t.ys[i] - rail.a.y) * rail.n.y < 240 * (GW / WORLD_W)) return null;
    lens.push(l);
  }
  for (let i = 0; i < tracks.length; i++) for (let j = i + 1; j < tracks.length; j++) if (!apart(tracks[i], tracks[j])) return null;
  return lens;
}

/**
 * Mark a crossing as a bridge + tunnel: find the two passes through the crossing point;
 * one (chosen by the level's rng) runs under, hidden over a short stretch, the other is the bridge.
 */
/**
 * Standalone tunnels on any track shape: 1-2 covered stretches of 4-7 marbles in the middle
 * of the track. Kept clear of the entry, the last quarter (the danger zone stays visible),
 * bridges, and each other.
 */
function addTunnels(tracks: Track[], rng: Rng, index: number) {
  for (const tr of tracks) {
    if (!rng.chance(index < 6 ? 0.35 : 0.5)) continue;
    const taken = [...(tr.hidden ?? []), ...(tr.bridges ?? [])];
    const lo = tr.visibleFrom + (tr.length - tr.visibleFrom) * 0.15;
    const hi = tr.length * 0.72;
    const want = rng.chance(0.35) ? 2 : 1;
    const tunnels: [number, number][] = [];
    for (let k = 0; k < 12 && tunnels.length < want; k++) {
      const len = BALL_D * rng.range(4, 7);
      const s0 = rng.range(lo, hi - len);
      if (s0 < lo) break;
      const s1 = s0 + len;
      const pad = BALL_D * 4;
      if ([...taken, ...tunnels].some(([a, b]) => s0 < b + pad && s1 > a - pad)) continue;
      tunnels.push([q(s0), q(s1)]);
    }
    if (tunnels.length) tr.tunnels = tunnels.sort((a, b) => a[0] - b[0]);
  }
}

function addCrossings(track: Track, crossings: Pt[], rng: Rng, mode: 'first' | 'random') {
  const hidden: [number, number][] = [];
  const bridges: [number, number][] = [];
  for (const c of crossings) {
    // Local minima of distance to the crossing, at least a few marbles apart in arc length.
    const passes: { s: number; d: number }[] = [];
    for (let i = 1; i < track.xs.length - 1; i++) {
      const d = Math.hypot(track.xs[i] - c.x, track.ys[i] - c.y);
      if (d > BALL_R) continue;
      const s = i * TRACK_STEP;
      const last = passes[passes.length - 1];
      if (last && s - last.s < BALL_D * 4) {
        if (d < last.d) passes[passes.length - 1] = { s, d };
      } else passes.push({ s, d });
    }
    if (passes.length < 2) continue;
    const under = mode === 'first' ? 0 : rng.chance(0.5) ? 0 : 1;
    const su = passes[under].s;
    const so = passes[1 - under].s;
    hidden.push([su - BALL_D * 1.2, su + BALL_D * 1.2]);
    bridges.push([so - BALL_D * 2.4, so + BALL_D * 2.4]);
  }
  if (hidden.length) {
    track.hidden = hidden;
    track.bridges = bridges;
  }
}

/** Single-track check (kept for tests/tools). */
export function validate(points: Pt[], launcher: Pt, world?: { w: number; h: number }): boolean {
  return validateLevel([points], launcher, false, world) !== null;
}
Object.assign(__GEN, GENERATORS);

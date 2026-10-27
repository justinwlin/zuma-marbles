// A scripted player used by tests and the balance report. It plays through the
// same Command interface as a human, so whatever it can do, a person can.

import type { Level } from './levelgen';
import { type Command, type GameState, isRolling, progress, railPoint, raycast, runIfInserted, step, TICK_HZ, TUNING, type GameEvent } from './game';
import { pointAt, type Pt } from './track';
import { Rng } from './rng';

export interface BotOptions {
  /** Aim noise (degrees, std-dev-ish). */
  noiseDeg: number;
  /** Seconds between decisions (reaction time). */
  think: number;
  /** Candidate rays per decision. */
  rays: number;
  seed: number;
}

export const BOT_PRESETS: Record<string, BotOptions> = {
  casual: { noiseDeg: 1.6, think: 0.75, rays: 180, seed: 1 },
  good: { noiseDeg: 0.6, think: 0.4, rays: 360, seed: 2 },
  expert: { noiseDeg: 0.15, think: 0.25, rays: 720, seed: 3 },
};

interface Choice {
  x: number;
  y: number;
  value: number;
  swap: boolean;
}

/** Evaluate inserting colour c (or a wild marble) at the raycast hit. */
function evalShot(st: GameState, level: Level, c: number, dx: number, dy: number, wild = false, from: Pt = level.launcher): { value: number; x: number; y: number } | null {
  const hit = raycast(st, level, dx, dy, from);
  if (!hit) {
    // Rail fights: a clear line to the boss is a direct hit.
    const B = level.bossFight;
    if (B && st.boss && !st.boss.dead) {
      const t = (B.x - from.x) * dx + (B.y - from.y) * dy;
      const perp = Math.abs((B.x - from.x) * dy - (B.y - from.y) * dx);
      if (t > 0 && perp < B.r) return { value: 8, x: from.x + dx * 400, y: from.y + dy * 400 };
    }
    return null;
  }
  const balls = st.chains[hit.chain].balls;
  const track = level.tracks[hit.chain];
  // How centred the hit is: 0 = dead centre, 1 = grazing edge.
  const hb = pointAt(track, balls[hit.index].s);
  const ox = from.x;
  const oy = from.y;
  const perp = Math.abs((hb.x - ox) * dy - (hb.y - oy) * dx) / TUNING.hitDist;
  const run = runIfInserted(st, hit, c, wild);
  const L = track.length;
  const urgency = balls[hit.index].s / L;
  let value: number;
  if (run >= 2) value = 10 + run * 2 + urgency * 12 + (balls[hit.index].p ? 4 : 0);
  else if (run === 1) value = 2 - urgency * 3;
  else value = -urgency * 4;
  // Grazing shots are unreliable once the chain moves.
  if (perp > 0.65) value -= 8 * (perp - 0.65);
  return { value, x: ox + dx * 400, y: oy + dy * 400 };
}

export interface BotMemory {
  /** Tick since which no useful shot has been available. */
  idleSince: number;
}

export function decide(st: GameState, level: Level, opts: BotOptions, rng: Rng, mem: BotMemory = { idleSince: -1 }): Command[] {
  if (st.rail) return decideRail(st, level, opts, rng, mem);
  if (st.phase !== 'playing' || st.gun.cool > 0) return [];
  // Wait for earlier shots and pops to resolve, like a careful player.
  if (st.shots.length || st.chains.some((ch) => ch.balls.some((b) => b.ins < 1 || b.clr >= 0))) return [];
  let best: Choice | null = null;
  for (const swap of [false, true]) {
    const c = swap ? st.gun.next : st.gun.cur;
    const wild = ((swap ? st.gun.w >> 1 : st.gun.w) & 1) === 1;
    if (swap && c === st.gun.cur && st.gun.w !== 1 && st.gun.w !== 2) continue;
    for (let k = 0; k < opts.rays; k++) {
      const a = (k / opts.rays) * Math.PI * 2;
      const r = evalShot(st, level, c, Math.cos(a), Math.sin(a), wild);
      if (!r) continue;
      const v = r.value - (swap ? 0.5 : 0);
      if (!best || v > best.value) best = { ...r, value: v, swap };
    }
  }
  if (!best) return [];
  // No useful shot: hold fire for a moment rather than lengthening the chain.
  if (best.value <= 0) {
    if (mem.idleSince < 0) mem.idleSince = st.tick;
    if (st.tick - mem.idleSince < 1.5 * TICK_HZ) return [];
  }
  mem.idleSince = -1;
  // Aim noise: rotate the aim vector.
  const n = ((rng.float() + rng.float() + rng.float() - 1.5) * opts.noiseDeg * Math.PI) / 180;
  const dx = best.x - level.launcher.x;
  const dy = best.y - level.launcher.y;
  const x = level.launcher.x + dx * Math.cos(n) - dy * Math.sin(n);
  const y = level.launcher.y + dx * Math.sin(n) + dy * Math.cos(n);
  const cmds: Command[] = [];
  if (best.swap) cmds.push({ type: 'swap' });
  cmds.push({ type: 'fire', x, y });
  return cmds;
}

/** Rail fights: pick a spot on the rail (dodging the boss's rocks) and shoot straight across. */
function decideRail(st: GameState, level: Level, opts: BotOptions, rng: Rng, mem: BotMemory): Command[] {
  const R = level.rail!;
  const r = st.rail!;
  if (st.phase !== 'playing' || r.q) return [];
  const rocks = st.boss?.shots ?? [];
  const safe = (u: number) => rocks.every((p) => Math.abs(u - p.u) > TUNING.bossShotHitR + 16);
  const toward = (u: number): Command => {
    const p = railPoint(R, u);
    return { type: 'move', x: p.x + R.n.x * 400, y: p.y + R.n.y * 400 };
  };
  const busy = st.gun.cool > 0 || r.stun > 0 || st.shots.length > 0 || st.chains.some((ch) => ch.balls.some((b) => b.ins < 1 || b.clr >= 0));
  if (busy) {
    // Still step out of the way of an incoming rock.
    if (!safe(r.u)) {
      let bu = r.u;
      for (let d = 0; d < R.len; d += 8) {
        if (r.u + d <= R.len && safe(r.u + d)) { bu = r.u + d; break; }
        if (r.u - d >= 0 && safe(r.u - d)) { bu = r.u - d; break; }
      }
      if (bu !== r.tu) return [toward(bu)];
    }
    return [];
  }
  let best: (Choice & { u: number }) | null = null;
  const n = Math.max(40, Math.round(opts.rays / 3));
  const from: Pt = { x: 0, y: 0 };
  for (const swap of [false, true]) {
    const c = swap ? st.gun.next : st.gun.cur;
    const wild = ((swap ? st.gun.w >> 1 : st.gun.w) & 1) === 1;
    if (swap && c === st.gun.cur && st.gun.w !== 1 && st.gun.w !== 2) continue;
    for (let k = 0; k <= n; k++) {
      const u = (k / n) * R.len;
      if (!safe(u)) continue;
      railPoint(R, u, from);
      const e = evalShot(st, level, c, R.n.x, R.n.y, wild, from);
      if (!e) continue;
      const v = e.value - (swap ? 0.5 : 0) - Math.abs(u - r.u) * 0.002;
      if (!best || v > best.value) best = { ...e, value: v, swap, u };
    }
  }
  if (!best || best.value <= 0) {
    if (mem.idleSince < 0) mem.idleSince = st.tick;
    if (!best || st.tick - mem.idleSince < 1.5 * TICK_HZ) return safe(r.u) ? [] : [toward(R.len - r.u)];
  }
  mem.idleSince = -1;
  // Aim noise: a positional error along the rail.
  const err = (rng.float() + rng.float() + rng.float() - 1.5) * opts.noiseDeg * 8;
  const p = railPoint(R, Math.max(0, Math.min(R.len, best.u + err)));
  const cmds: Command[] = [];
  if (best.swap) cmds.push({ type: 'swap' });
  cmds.push({ type: 'fire', x: p.x + R.n.x * 400, y: p.y + R.n.y * 400 });
  return cmds;
}

export interface PlayResult {
  outcome: 'won' | 'lost' | 'timeout';
  seconds: number;
  score: number;
  stats: GameState['stats'];
  /** Recorded inputs: [tick, command] — replayable. */
  inputs: [number, Command][];
  events: Record<string, number>;
  /** Max head progress reached (0..1): how close the level came to being lost. */
  peakDanger: number;
}

export function playLevel(
  st: GameState,
  level: Level,
  opts: BotOptions,
  maxSeconds = 600,
  onEvents?: (ev: GameEvent[], st: GameState) => void,
): PlayResult {
  const rng = new Rng(opts.seed ^ level.seed);
  const inputs: [number, Command][] = [];
  const counts: Record<string, number> = {};
  const thinkTicks = Math.max(1, Math.round(opts.think * TICK_HZ));
  const mem: BotMemory = { idleSince: -1 };
  let peak = 0;
  while (st.phase !== 'won' && st.phase !== 'lost' && st.tick < maxSeconds * TICK_HZ) {
    let cmds: Command[] = [];
    if (st.tick % thinkTicks === 0 && !isRolling(st)) cmds = decide(st, level, opts, rng, mem);
    for (const c of cmds) inputs.push([st.tick + 1, c]);
    const ev = step(st, level, cmds);
    for (const e of ev) counts[e.type] = (counts[e.type] ?? 0) + 1;
    if (onEvents) onEvents(ev, st);
    peak = Math.max(peak, progress(st, level).head);
  }
  return {
    outcome: st.phase === 'won' ? 'won' : st.phase === 'lost' ? 'lost' : 'timeout',
    seconds: st.tick / TICK_HZ,
    score: st.score,
    stats: st.stats,
    inputs,
    events: counts,
    peakDanger: peak,
  };
}

/** Re-run recorded inputs from a fresh state. */
export function replay(st: GameState, level: Level, inputs: [number, Command][], untilTick: number) {
  let k = 0;
  while (k < inputs.length && inputs[k][0] <= st.tick) k++;
  while (st.tick < untilTick && st.phase !== 'won' && st.phase !== 'lost') {
    const cmds: Command[] = [];
    while (k < inputs.length && inputs[k][0] === st.tick + 1) cmds.push(inputs[k++][1]);
    step(st, level, cmds);
  }
  return st;
}

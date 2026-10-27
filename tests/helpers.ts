import { BALL_D, generateLevel, type Level } from '../src/sim/levelgen';
import { type Ball, type Command, createGame, type GameEvent, type GameState, step, TICK_HZ, Power } from '../src/sim/game';
import { pointAt } from '../src/sim/track';
import { type Mods, NO_MODS } from '../src/sim/items';

export function frozenGame(colors: number[], opts: { campaign?: string; index?: number; headGap?: number; mods?: Partial<Mods> } = {}) {
  const level = generateLevel(opts.campaign ?? 'test', opts.index ?? 0);
  const st = createGame(level, { ...NO_MODS, ...opts.mods });
  st.spawning = false;
  const ch = st.chains[0];
  ch.rolling = false;
  ch.speed = 0;
  ch.stopT = 1e6; // freeze the pusher
  st.gun.cool = 0;
  // Place the chain on the inner end of the track (closest to the launcher, unobstructed).
  const headS = level.tracks[0].length - (opts.headGap ?? 500);
  ch.balls = colors.map((c, i) => mkBall(st, c, headS - (colors.length - 1 - i) * BALL_D));
  return { level, st };
}

export function mkBall(st: GameState, c: number, s: number, p: Power = Power.None): Ball {
  return { id: st.nextId++, c, s, p, pt: p ? 99 : 0, g: 1, ins: 1, ix: 0, iy: 0, clr: -1, combo: 0, suck: 0, rt: 0, rv: 0, gb: 0 };
}

export function run(st: GameState, level: Level, seconds: number, cmds: Command[] = []): GameEvent[] {
  const all: GameEvent[] = [];
  const ticks = Math.round(seconds * TICK_HZ);
  for (let t = 0; t < ticks; t++) all.push(...step(st, level, t === 0 ? cmds : []));
  return all;
}

/** Fire command aimed straight at ball i (optionally offset along the track). */
export function aimAt(level: Level, st: GameState, i: number, alongTrack = 0): Command {
  const p = pointAt(level.tracks[0], st.chains[0].balls[i].s + alongTrack);
  return { type: 'fire', x: p.x, y: p.y };
}

/** Fire, then step until the shot lands; returns the hit event (state is left right after insertion). */
export function untilHit(st: GameState, level: Level, cmd: Command) {
  for (let t = 0; t < 4 * TICK_HZ; t++) {
    const ev = step(st, level, t === 0 ? [cmd] : []);
    const h = ev.find((e) => e.type === 'hit');
    if (h && h.type === 'hit') return h;
    if (ev.some((e) => e.type === 'miss')) return null;
  }
  return null;
}

// Programmatic game-feel checks: the "juice" is data, so we can assert on it.
import { describe, expect, it } from 'vitest';
import { FEEL, feedbackFor, shakeOffset, springAngle } from '../src/game/feel';
import { type GameEvent, createGame, step, TICK_HZ, TUNING, Power, progress } from '../src/sim/game';
import { generateLevel, BALL_D } from '../src/sim/levelgen';
import { BOT_PRESETS, playLevel } from '../src/sim/bot';
import { aimAt, frozenGame, run } from './helpers';

const ctx = { streak: 0, headProgress: 0.3, reduceMotion: false };
const pop = (combo: number, n = 3): GameEvent => ({ type: 'pop', balls: Array.from({ length: n }, () => ({ x: 0, y: 0, c: 0, p: Power.None })), combo, score: 0, x: 0, y: 0, c: 0, gapBonus: 0, chainBonus: 0 });

describe('feedback mapping', () => {
  it('every player-facing event gives audible feedback', () => {
    const evs: GameEvent[] = [
      { type: 'fire', x: 0, y: 0, dx: 1, dy: 0, c: 0 },
      { type: 'hit', x: 0, y: 0, c: 0, front: true },
      pop(0),
      { type: 'suck', x: 0, y: 0 },
      { type: 'contact', x: 0, y: 0, combo: 1, matched: true },
      { type: 'power', power: Power.Bomb, x: 0, y: 0 },
      { type: 'swap' },
      { type: 'barFull' },
      { type: 'lose' },
      { type: 'won' },
    ];
    for (const e of evs) expect(feedbackFor(e, ctx).sound, e.type).toBeTruthy();
  });

  it('impacts have weight: hits and pops freeze briefly and shake', () => {
    const hit = feedbackFor({ type: 'hit', x: 0, y: 0, c: 0, front: true }, ctx);
    expect(hit.hitstop).toBeGreaterThan(15);
    expect(hit.hitstop).toBeLessThan(50);
    const p = feedbackFor(pop(0), ctx);
    expect(p.hitstop).toBeGreaterThan(hit.hitstop);
    expect(p.trauma).toBeGreaterThan(hit.trauma);
    expect(p.particles).toBeGreaterThanOrEqual(30);
  });

  it('combos escalate pitch, hit-stop, shake and particles — monotonically', () => {
    let prev = feedbackFor(pop(0), ctx);
    for (let c = 1; c <= 4; c++) {
      const f = feedbackFor(pop(c), ctx);
      expect(f.pitch).toBeGreaterThan(prev.pitch);
      expect(f.hitstop).toBeGreaterThanOrEqual(prev.hitstop);
      expect(f.trauma).toBeGreaterThan(prev.trauma);
      expect(f.particles).toBeGreaterThanOrEqual(prev.particles);
      prev = f;
    }
  });

  it('everything is capped so huge cascades never become unreadable', () => {
    const f = feedbackFor(pop(20, 12), { ...ctx, streak: 50 });
    expect(f.hitstop).toBeLessThanOrEqual(FEEL.maxHitstop);
    expect(f.trauma).toBeLessThanOrEqual(0.75);
    expect(f.flash).toBeLessThanOrEqual(0.3);
    expect(f.pitch).toBeLessThanOrEqual(16);
    expect(f.particles).toBeLessThanOrEqual(160);
  });

  it('bomb is the biggest moment in the game', () => {
    const bomb = feedbackFor({ type: 'power', power: Power.Bomb, x: 0, y: 0 }, ctx);
    const bigPop = feedbackFor(pop(4, 6), ctx);
    expect(bomb.trauma).toBeGreaterThan(bigPop.trauma);
    expect(bomb.flash).toBeGreaterThan(bigPop.flash);
  });

  it('clutch pops near the skull trigger slow-motion', () => {
    expect(feedbackFor(pop(0), { ...ctx, headProgress: 0.9 }).slowmo).not.toBeNull();
    expect(feedbackFor(pop(0), { ...ctx, headProgress: 0.5 }).slowmo).toBeNull();
  });

  it('reduce-motion removes shake, flashes and slow-mo', () => {
    const r = { ...ctx, reduceMotion: true, headProgress: 0.95 };
    const f = feedbackFor({ type: 'power', power: Power.Bomb, x: 0, y: 0 }, r);
    expect(f.trauma).toBe(0);
    expect(f.flash).toBeLessThanOrEqual(0.05);
    expect(feedbackFor(pop(3), r).slowmo).toBeNull();
  });
});

describe('shake and aim spring dynamics', () => {
  it('shake decays to nothing within ~0.6 s and stays bounded', () => {
    expect(1 / FEEL.traumaDecay).toBeLessThan(0.65);
    let maxPx = 0;
    for (let t = 0; t < 3; t += 0.01) {
      const o = shakeOffset(1, t);
      maxPx = Math.max(maxPx, Math.hypot(o.x, o.y));
    }
    expect(maxPx).toBeLessThanOrEqual(FEEL.maxShakePx * 1.01);
    // Shake grows with trauma² so small events stay subtle.
    expect(Math.abs(shakeOffset(0.2, 1.3).x)).toBeLessThan(Math.abs(shakeOffset(1, 1.3).x) * 0.1 + 1e-9);
  });

  it('launcher aim is snappy and critically damped (no wobble)', () => {
    let a = 0;
    let v = 0;
    const target = Math.PI / 2;
    let settled = -1;
    let overshoot = 0;
    for (let i = 0; i < 120; i++) {
      [a, v] = springAngle(a, v, target, 1 / 120);
      overshoot = Math.max(overshoot, a - target);
      if (settled < 0 && Math.abs(target - a) < (1 * Math.PI) / 180) settled = i / 120;
    }
    expect(settled).toBeGreaterThan(0);
    expect(settled).toBeLessThan(0.35); // reaches within 1° fast
    expect(overshoot).toBeLessThan((0.5 * Math.PI) / 180);
  });

  it('aim spring takes the short way around', () => {
    let a = Math.PI - 0.1;
    let v = 0;
    for (let i = 0; i < 60; i++) [a, v] = springAngle(a, v, -Math.PI + 0.1, 1 / 120);
    expect(Math.abs(Math.cos(a) - Math.cos(-Math.PI + 0.1))).toBeLessThan(0.01);
    expect(Math.abs(a)).toBeGreaterThan(2.5); // never swung through 0
  });
});

describe('timing (input → feedback latency)', () => {
  it('fire feedback is on the very next tick; insertion settles in ~150 ms; pop is instant on settle', () => {
    const { level, st } = frozenGame([0, 1, 1, 2]);
    st.gun.cur = 1;
    const times: Record<string, number> = {};
    const cmd = aimAt(level, st, 2);
    for (let t = 0; t < 2 * TICK_HZ; t++) {
      for (const e of step(st, level, t === 0 ? [cmd] : [])) if (times[e.type] === undefined) times[e.type] = t / TICK_HZ;
    }
    expect(times.fire).toBe(0);
    expect(times.hit).toBeLessThan(0.6);
    expect(times.settle - times.hit).toBeCloseTo(TUNING.insertTime, 1);
    expect(times.pop).toBe(times.settle);
  });

  it('magnet pull closes a 3-ball gap in under half a second', () => {
    const { level, st } = frozenGame([3, 1, 1, 2, 2, 1, 3]);
    st.gun.cur = 2;
    const evs: { t: number; e: GameEvent }[] = [];
    const cmd = aimAt(level, st, 4);
    for (let t = 0; t < 3 * TICK_HZ; t++) for (const e of step(st, level, t === 0 ? [cmd] : [])) evs.push({ t: t / TICK_HZ, e });
    const suck = evs.find((x) => x.e.type === 'suck')!;
    const contact = evs.find((x) => x.e.type === 'contact')!;
    expect(contact.t - suck.t).toBeLessThan(0.5);
    expect(contact.t - suck.t).toBeGreaterThan(0.1); // visible, not instantaneous
  });

  it('level start: chain rolls into view quickly, then settles to cruise', () => {
    const level = generateLevel('feel', 0);
    const st = createGame(level);
    let visibleAt = -1;
    let doneAt = -1;
    for (let t = 0; t < 8 * TICK_HZ; t++) {
      const ev = step(st, level);
      const head = st.balls[st.balls.length - 1];
      if (visibleAt < 0 && head && head.s > level.track.visibleFrom + BALL_D) visibleAt = t / TICK_HZ;
      if (doneAt < 0 && ev.some((e) => e.type === 'rollInDone')) doneAt = t / TICK_HZ;
    }
    expect(visibleAt).toBeLessThan(1);
    expect(doneAt).toBeGreaterThan(1);
    expect(doneAt).toBeLessThan(5);
    expect(progress(st, level).head).toBeLessThan(0.6); // roll-in leaves the player room
  });
});

describe('whole-game feel budget', () => {
  it('a full level keeps freeze-frames and shake rare enough to stay fluid', () => {
    const level = generateLevel('alpha', 3);
    let hitstopMs = 0;
    let shakeEvents = 0;
    let pops = 0;
    const r = playLevel(createGame(level), level, BOT_PRESETS.good, 300, (ev, st) => {
      const head = progress(st, level).head;
      for (const e of ev) {
        const f = feedbackFor(e, { streak: st.streak, headProgress: head, reduceMotion: false });
        hitstopMs += f.hitstop;
        if (f.trauma > 0.15) shakeEvents++;
        if (e.type === 'pop') pops++;
      }
    });
    const seconds = r.seconds;
    expect(pops).toBeGreaterThan(10);
    // Under 5% of play time frozen, on average fewer than one big shake per 2 seconds.
    expect(hitstopMs / 1000 / seconds).toBeLessThan(0.05);
    expect(shakeEvents / seconds).toBeLessThan(0.5);
    // Rhythm: the player gets a pop every few seconds on average.
    expect(seconds / pops).toBeLessThan(5);
  });

  it('run() helper sanity', () => {
    const { level, st } = frozenGame([0]);
    expect(run(st, level, 0.1).length).toBe(0);
  });
});

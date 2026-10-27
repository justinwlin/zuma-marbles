import { describe, expect, it } from 'vitest';
import { BALL_D, generateLevel, validate, WORLD_H, WORLD_W } from '../src/sim/levelgen';
import { createGame, Power, raycast, restore, snapshot, stateHash, step, TICK_HZ, TUNING } from '../src/sim/game';
import { BOT_PRESETS, playLevel, replay } from '../src/sim/bot';
import { TRACK_STEP } from '../src/sim/track';
import { aimAt, frozenGame, mkBall, run, untilHit } from './helpers';

describe('level generation', () => {
  it('is deterministic for (campaign, index)', () => {
    const a = generateLevel('seed-x', 7);
    const b = generateLevel('seed-x', 7);
    expect(a.points).toEqual(b.points);
    expect(a.launcher).toEqual(b.launcher);
    expect(generateLevel('seed-y', 7).points).not.toEqual(a.points);
  });

  it('produces valid, non-overlapping tracks for many levels', () => {
    const fams = new Set<string>();
    for (let i = 0; i < 120; i++) {
      const lvl = generateLevel('bulk', i);
      fams.add(lvl.family);
      expect(validate(lvl.points, lvl.launcher)).toBe(true);
      expect(lvl.track.length - lvl.track.visibleFrom).toBeGreaterThan(2000);
      expect(lvl.launcher.x).toBeGreaterThan(0);
      expect(lvl.launcher.x).toBeLessThan(WORLD_W);
      expect(lvl.launcher.y).toBeLessThan(WORLD_H);
    }
    expect(fams.size).toBeGreaterThanOrEqual(4);
  });

  it('track lookup is uniform in arc length', () => {
    const { track } = generateLevel('uniform', 3);
    for (let i = 1; i < track.xs.length; i += 7) {
      const d = Math.hypot(track.xs[i] - track.xs[i - 1], track.ys[i] - track.ys[i - 1]);
      expect(d).toBeLessThanOrEqual(TRACK_STEP + 1e-3);
      expect(d).toBeGreaterThan(TRACK_STEP * 0.5);
    }
  });

  it('difficulty ramps with level index', () => {
    const a = generateLevel('ramp', 0);
    const b = generateLevel('ramp', 25);
    expect(b.colors).toBeGreaterThan(a.colors);
    expect(b.speed).toBeGreaterThan(a.speed);
  });
});

describe('shooting and matching', () => {
  it('inserting a third ball pops the run after the clear animation', () => {
    const { level, st } = frozenGame([0, 1, 1, 2, 3]);
    st.gun.cur = 1;
    const ev = run(st, level, 1.2, [aimAt(level, st, 2)]);
    expect(ev.some((e) => e.type === 'hit')).toBe(true);
    const pop = ev.find((e) => e.type === 'pop');
    expect(pop && pop.type === 'pop' && pop.balls.length).toBe(3);
    expect(st.balls.map((b) => b.c)).toEqual([0, 2, 3]);
    expect(st.score).toBe(30);
  });

  it('two of a kind does not pop', () => {
    const { level, st } = frozenGame([0, 1, 2, 3]);
    st.gun.cur = 1;
    run(st, level, 1, [aimAt(level, st, 1)]);
    expect(st.balls.length).toBe(5);
    expect(st.streak).toBe(0);
  });

  it('inserts in front of or behind the hit ball depending on impact side', () => {
    const sides = new Set<boolean>();
    for (let k = -8; k <= 8; k++) {
      const { level, st } = frozenGame([0, 0, 2, 0, 0]);
      st.gun.cur = 3;
      const cmd = aimAt(level, st, 2, (k / 8) * BALL_D * 0.6);
      const hit = raycast(st, level, cmd.type === 'fire' ? cmd.x - level.launcher.x : 0, cmd.type === 'fire' ? cmd.y - level.launcher.y : 0)!;
      untilHit(st, level, cmd);
      const idx = st.balls.findIndex((b) => b.id === hit.ballId);
      const newIdx = st.balls.findIndex((b) => b.c === 3);
      expect(newIdx).toBe(hit.front ? idx + 1 : idx - 1);
      sides.add(hit.front);
    }
    expect(sides.size).toBe(2);
  });

  it('balls stay exactly one diameter apart after insertion', () => {
    const { level, st } = frozenGame([0, 1, 2, 3, 0, 1]);
    st.gun.cur = 2;
    run(st, level, 0.8, [aimAt(level, st, 3)]);
    for (let i = 1; i < st.balls.length; i++) {
      expect(st.balls[i].s - st.balls[i - 1].s).toBeCloseTo(BALL_D, 3);
    }
  });
});

describe('gaps, magnet pull and combos', () => {
  it('matching colours across a gap pull together and chain a combo', () => {
    // [G R R | B B | R G]: completing BBB leaves R R _ R → magnet → RRR combo.
    const { level, st } = frozenGame([3, 1, 1, 2, 2, 1, 3]);
    st.gun.cur = 2;
    const ev = run(st, level, 3, [aimAt(level, st, 4)]);
    const pops = ev.filter((e) => e.type === 'pop');
    expect(pops.length).toBe(2);
    expect(ev.some((e) => e.type === 'suck')).toBe(true);
    const contact = ev.find((e) => e.type === 'contact');
    expect(contact && contact.type === 'contact' && contact.matched).toBe(true);
    expect(st.stats.maxCombo).toBe(1);
    // GG remain (combo 2 would need a third G)
    expect(st.balls.map((b) => b.c)).toEqual([3, 3]);
    // 30 (BBB) + 100*1 + 30 (RRR)
    expect(st.score).toBe(160);
  });

  it('non-matching gap: the front part stops while the rear keeps moving', () => {
    const { level, st } = frozenGame([0, 1, 1, 2, 3]);
    st.stopT = 0;
    level.speed = 60;
    st.gun.cur = 1;
    run(st, level, 0.8, [aimAt(level, st, 2)]);
    const frontS = st.balls[st.balls.length - 1].s;
    run(st, level, 1);
    expect(st.balls[st.balls.length - 1].s).toBeCloseTo(frontS, 5);
    expect(st.balls[0].s).toBeGreaterThan(0);
  });

  it('magnet pull accelerates (Zuma suck curve)', () => {
    const { level, st } = frozenGame([1, 1, 2, 1]);
    st.balls.splice(2, 1); // hole between the 1-1 and the lone 1
    st.balls[2].s += 200;
    st.balls[2].suck = TUNING.suckV0;
    const s0 = st.balls[2].s;
    run(st, level, 0.1);
    const d1 = s0 - st.balls[2].s;
    const s1 = st.balls[2].s;
    run(st, level, 0.1);
    const d2 = s1 - st.balls[2].s;
    expect(d2).toBeGreaterThan(d1 * 1.5);
  });
});

describe('power-ups', () => {
  it('bomb clears everything in radius when matched', () => {
    const { level, st } = frozenGame([0, 2, 3, 1, 1, 0, 2, 3, 0]);
    st.balls[4].p = Power.Bomb;
    st.balls[4].pt = 99;
    st.gun.cur = 1;
    const ev = run(st, level, 1.2, [aimAt(level, st, 3)]);
    expect(ev.some((e) => e.type === 'power' && e.power === Power.Bomb)).toBe(true);
    expect(st.balls.length).toBeLessThan(5);
  });

  it('slow, reverse and laser set their timers', () => {
    for (const [p, key] of [
      [Power.Slow, 'slowT'],
      [Power.Reverse, 'revT'],
      [Power.Aim, 'aimT'],
    ] as const) {
      const { level, st } = frozenGame([0, 1, 1, 2]);
      st.balls[1].p = p;
      st.balls[1].pt = 99;
      st.gun.cur = 1;
      run(st, level, 0.6, [aimAt(level, st, 2)]);
      expect(st[key]).toBeGreaterThan(0);
    }
  });

  it('reverse moves the head backwards', () => {
    const { level, st } = frozenGame([0, 1, 2, 3, 0, 1]);
    st.revT = 1;
    const s0 = st.balls[5].s;
    run(st, level, 0.5);
    expect(st.balls[5].s).toBeLessThan(s0 - 40);
  });
});

describe('gun', () => {
  it('only offers colours that are on the board', () => {
    const { level, st } = frozenGame([2, 2, 3, 3]);
    st.gun.cur = 0;
    st.gun.next = 1;
    step(st, level);
    expect([2, 3]).toContain(st.gun.cur);
    expect([2, 3]).toContain(st.gun.next);
  });

  it('respects fire cooldown', () => {
    const { level, st } = frozenGame([0, 1, 2]);
    st.gun.cool = 0;
    const f = aimAt(level, st, 1);
    step(st, level, [f]);
    step(st, level, [f]);
    expect(st.stats.shots).toBe(1);
  });
});

describe('win, lose and determinism', () => {
  it('losing: chain reaching the skull ends the level', () => {
    const level = generateLevel('lose', 4);
    const st = createGame(level);
    for (let t = 0; t < 600 * TICK_HZ && st.phase !== 'lost'; t++) step(st, level);
    expect(st.phase).toBe('lost');
  });

  it('a decent player can win the first level', () => {
    const level = generateLevel('alpha', 0);
    const r = playLevel(createGame(level), level, BOT_PRESETS.good);
    expect(r.outcome).toBe('won');
  });

  it('same seed + same inputs = identical state', () => {
    const level = generateLevel('det', 2);
    const a = playLevel(createGame(level), level, BOT_PRESETS.casual, 40);
    const st2 = replay(createGame(level), level, a.inputs, Math.round(a.seconds * TICK_HZ));
    const st1 = createGame(level);
    replay(st1, level, a.inputs, Math.round(a.seconds * TICK_HZ));
    expect(stateHash(st2)).toBe(stateHash(st1));
    expect(st1.score).toBe(a.score);
  });

  it('save mid-level, load, continue = same as never saving', () => {
    const level = generateLevel('save', 1);
    const rec = playLevel(createGame(level), level, BOT_PRESETS.casual, 45);
    const end = Math.round(rec.seconds * TICK_HZ);
    const straight = replay(createGame(level), level, rec.inputs, end);
    const half = replay(createGame(level), level, rec.inputs, Math.floor(end / 2));
    const loaded = restore(snapshot(half));
    // Level is regenerated from (campaignSeed, index) exactly as a fresh session would.
    const level2 = generateLevel(loaded.campaignSeed, loaded.levelIndex);
    replay(loaded, level2, rec.inputs, end);
    expect(stateHash(loaded)).toBe(stateHash(straight));
  });
});

describe('aim preview honesty (targeting feel)', () => {
  it('the ball the preview highlights is the ball the shot hits', () => {
    const level = generateLevel('aim', 3);
    const st = createGame(level);
    // Let the chain roll in and settle.
    for (let t = 0; t < 6 * TICK_HZ; t++) step(st, level);
    let checked = 0;
    let agree = 0;
    for (let k = 0; k < 90; k++) {
      const a = (k / 90) * Math.PI * 2;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      const hit = raycast(st, level, dx, dy);
      if (!hit) continue;
      const trial = restore(snapshot(st));
      trial.stopT = 1e6; // freeze so the chain doesn't move while the shot flies
      trial.gun.cool = 0;
      const h = untilHit(trial, level, { type: 'fire', x: level.launcher.x + dx * 300, y: level.launcher.y + dy * 300 });
      if (!h) continue;
      checked++;
      const nb = trial.balls.findIndex((b) => b.c === st.gun.cur && !st.balls.some((o) => o.id === b.id));
      const neighbours = [trial.balls[nb - 1]?.id, trial.balls[nb + 1]?.id];
      if (neighbours.includes(hit.ballId) && h.front === hit.front) agree++;
    }
    expect(checked).toBeGreaterThan(20);
    expect(agree / checked).toBeGreaterThanOrEqual(0.97);
  });
});

it('mkBall helper produces a valid ball', () => {
  const { st } = frozenGame([0]);
  expect(mkBall(st, 1, 10).clr).toBe(-1);
});

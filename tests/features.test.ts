import { describe, expect, it } from 'vitest';
import { BALL_D, generateLevel } from '../src/sim/levelgen';
import { createGame, launcherAt, Power, progress, railPoint, restore, snapshot, stateHash, step, TICK_HZ, TUNING } from '../src/sim/game';
import { BOT_PRESETS, playLevel, replay } from '../src/sim/bot';
import { aimAt, frozenGame, run } from './helpers';

describe('wild marble', () => {
  it('takes the colour of the neighbour that makes the longer run, and pops it', () => {
    const { level, st } = frozenGame([2, 1, 1, 4, 3]);
    st.gun.w = 1;
    st.gun.cur = 3;
    const ev = run(st, level, 1, [aimAt(level, st, 1)]);
    const pop = ev.find((e) => e.type === 'pop');
    expect(pop && pop.type === 'pop' && pop.c).toBe(1);
    expect(pop && pop.type === 'pop' ? pop.balls.length : 0).toBe(3);
    expect(st.chains[0].balls.some((b) => b.w)).toBe(false);
  });

  it('is triggered by the Wild power-up, survives a swap, and is used by the next shot', () => {
    const { level, st } = frozenGame([0, 1, 1, 2, 3]);
    st.chains[0].balls[1].p = Power.Wild;
    st.chains[0].balls[1].pt = 99;
    st.gun.cur = 1;
    run(st, level, 0.6, [aimAt(level, st, 2)]);
    expect(st.gun.w & 1).toBe(1);
    run(st, level, 0.05, [{ type: 'swap' }]);
    expect(st.gun.w).toBe(2);
    run(st, level, 0.05, [{ type: 'swap' }]);
    expect(st.gun.w).toBe(1);
    st.gun.cool = 0;
    const ev = run(st, level, 0.05, [aimAt(level, st, 0)]);
    expect(ev.some((e) => e.type === 'fire')).toBe(true);
    expect(st.gun.w).toBe(0);
  });
});

describe('scorpion', () => {
  it('runs back from the skull and eats the 10 front marbles', () => {
    const colors = Array.from({ length: 16 }, (_, i) => i % 2);
    const { level, st } = frozenGame(colors);
    const rear = st.chains[0].balls.slice(0, 6).map((b) => b.id);
    st.scorps.push({ ci: 0, s: level.tracks[0].length + BALL_D, left: TUNING.scorpionEats });
    const ev = run(st, level, 3);
    expect(ev.filter((e) => e.type === 'eat').length).toBe(10);
    expect(st.chains[0].balls.map((b) => b.id)).toEqual(rear);
    expect(st.scorps.length).toBe(0);
  });

  it('is released by the Scorpion power-up', () => {
    const { level, st } = frozenGame([3, 2, 3, 0, 1, 1, 2, 3, 2, 3]);
    st.chains[0].balls[4].p = Power.Scorpion;
    st.chains[0].balls[4].pt = 99;
    st.gun.cur = 1;
    const ev = run(st, level, 3, [aimAt(level, st, 5)]);
    expect(ev.some((e) => e.type === 'power' && e.power === Power.Scorpion)).toBe(true);
    expect(ev.filter((e) => e.type === 'eat').length).toBeGreaterThanOrEqual(5);
  });
});

describe('bonus coins', () => {
  it('appear in open space, pay out when shot through, and do not fill the bar', () => {
    const level = generateLevel('coins', 3);
    const st = createGame(level);
    let coinEv = null;
    for (let t = 0; t < 60 * TICK_HZ && !coinEv; t++) coinEv = step(st, level).find((e) => e.type === 'coin') ?? null;
    expect(coinEv).not.toBeNull();
    const c = st.coin!;
    // Clear of every track
    for (const tr of level.tracks) for (let i = 0; i < tr.xs.length; i++) expect(Math.hypot(tr.xs[i] - c.x, tr.ys[i] - c.y)).toBeGreaterThan(BALL_D * 1.3);
    const bar0 = progress(st, level).bar;
    const score0 = st.score;
    st.gun.cool = 0;
    const ev: string[] = [];
    for (let t = 0; t < TICK_HZ && st.coin; t++) for (const e of step(st, level, t === 0 ? [{ type: 'fire', x: c.x, y: c.y }] : [])) ev.push(e.type);
    expect(ev).toContain('coinGet');
    expect(st.stats.coins).toBe(1);
    expect(st.score - score0).toBeGreaterThanOrEqual(TUNING.coinValue);
    expect(st.extra).toBe(TUNING.coinValue);
    expect(progress(st, level).bar).toBeLessThan(bar0 + 0.05);
  });

  it('vanish after their lifetime', () => {
    const level = generateLevel('coins', 3);
    const st = createGame(level);
    st.coin = { x: 600, y: 360, t: 0.5 };
    const ev = run(st, level, 0.6);
    expect(ev.some((e) => e.type === 'coinGone')).toBe(true);
    expect(st.coin).toBeNull();
  });
});

describe('end-of-level bonuses', () => {
  it('pay a track bonus for the unreached track and an ace bonus for a fast clear', () => {
    const { level, st } = frozenGame([0, 0, 2], { headGap: 900 });
    st.barFull = true;
    st.gun.cur = 2;
    st.chains[0].balls[0].c = 2;
    st.chains[0].balls[1].c = 2;
    const before = st.score;
    const ev = run(st, level, 1.5, [aimAt(level, st, 1)]);
    const won = ev.find((e) => e.type === 'won');
    expect(won && won.type === 'won').toBeTruthy();
    if (!won || won.type !== 'won') return;
    expect(won.ace).toBe(TUNING.aceBonus);
    // The head never got closer than ~900 px from the skull.
    const tr = level.tracks[0];
    const pct = Math.round(((tr.length - st.chains[0].peak) / (tr.length - tr.visibleFrom)) * 100);
    expect(won.sweep).toBe(pct * TUNING.sweepPerPct);
    expect(won.sweep).toBeGreaterThan(0);
    expect(st.score - before).toBeGreaterThanOrEqual(won.sweep + won.ace);
    expect(st.bonus?.from[0]).toBeCloseTo(st.chains[0].peak);
  });

  it('no ace bonus after the ace time', () => {
    const { level, st } = frozenGame([2, 2], { headGap: 900 });
    st.barFull = true;
    st.gun.cur = 2;
    st.tick = Math.round((level.ace + 1) * TICK_HZ);
    const ev = run(st, level, 1.5, [aimAt(level, st, 1)]);
    const won = ev.find((e) => e.type === 'won');
    expect(won && won.type === 'won' ? won.ace : -1).toBe(0);
  });

  it('every level has a sensible ace time', () => {
    for (let i = 0; i < 40; i++) {
      const l = generateLevel('ace', i);
      expect(l.ace % 5).toBe(0);
      expect(l.ace).toBeGreaterThanOrEqual(30);
      expect(l.ace).toBeLessThanOrEqual(130);
    }
  });
});

describe('boss fights (frog on a rail)', () => {
  const bossLevel = (seed = 'boss') => generateLevel(seed, 9);

  it('every 10th level is a rail fight with one chain, clear of the rail', () => {
    for (const seed of ['b1', 'b2', 'b3', 'xl-b4', 'endless-b5']) {
      for (const i of [9, 19, 29]) {
        const l = generateLevel(seed, i);
        expect(l.boss).toBe('boss');
        expect(l.rail).toBeTruthy();
        expect(l.bossFight!.hp).toBeGreaterThan(50);
        expect(l.tracks.length).toBe(1);
        const R = l.rail!;
        const tr = l.tracks[0];
        for (let k = 0; k < tr.xs.length; k += 3) {
          expect((tr.xs[k] - R.a.x) * R.n.x + (tr.ys[k] - R.a.y) * R.n.y).toBeGreaterThan(200);
          expect(Math.hypot(tr.xs[k] - l.bossFight!.x, tr.ys[k] - l.bossFight!.y)).toBeGreaterThan(l.bossFight!.r + BALL_D);
        }
      }
    }
    expect(generateLevel('b1', 8).rail).toBeUndefined();
    expect(generateLevel('b1', 4).rail).toBeUndefined();
  });

  it('the frog slides to the aimed spot and shoots straight across from there', () => {
    const level = bossLevel();
    const st = createGame(level);
    const R = level.rail!;
    const p = railPoint(R, 60);
    run(st, level, 0.5, [{ type: 'move', x: p.x - 300, y: p.y }]);
    expect(st.rail!.u).toBeCloseTo(60, 5);
    expect(launcherAt(st, level).y).toBeCloseTo(p.y, 5);
    const q = railPoint(R, 300);
    st.gun.cool = 0;
    let fire = null;
    for (let t = 0; t < TICK_HZ && !fire; t++) fire = step(st, level, t === 0 ? [{ type: 'fire', x: q.x - 300, y: q.y }] : []).find((e) => e.type === 'fire') ?? null;
    expect(fire && fire.type === 'fire').toBeTruthy();
    if (fire && fire.type === 'fire') {
      expect(fire.y).toBeCloseTo(q.y, 5);
      expect(fire.dx).toBeCloseTo(R.n.x, 9);
      expect(fire.dy).toBeCloseTo(R.n.y, 9);
    }
  });

  it('popping marbles and direct hits hurt the boss; at 0 health the chain pops and the level is won', () => {
    const level = bossLevel();
    const st = createGame(level);
    const hp0 = st.boss!.hp;
    // A shot along an empty lane hits the boss directly.
    st.chains[0].balls = [];
    st.spawning = false;
    const B = level.bossFight!;
    const u = B.y - level.rail!.a.y;
    run(st, level, 0.3, [{ type: 'move', x: B.x, y: B.y }]);
    expect(st.rail!.u).toBeCloseTo(u, 5);
    st.gun.cool = 0;
    const ev = run(st, level, 2, [{ type: 'fire', x: B.x, y: B.y }]);
    expect(ev.some((e) => e.type === 'bossHit')).toBe(true);
    expect(st.boss!.hp).toBe(hp0 - TUNING.bossDirectHit);
    // Beaten: no more marbles, the chain on screen cascades away and the level is won.
    const st2 = createGame(level);
    for (let t = 0; t < 12 * TICK_HZ; t++) step(st2, level);
    expect(st2.chains[0].balls.length).toBeGreaterThan(10);
    st2.boss!.hp = 0;
    const evs: string[] = [];
    for (let t = 0; t < 15 * TICK_HZ && st2.phase === 'playing'; t++) for (const e of step(st2, level)) evs.push(e.type);
    expect(evs).toContain('bossDown');
    expect(evs).toContain('cascade');
    expect(st2.phase).toBe('won');
  });

  it('a boss rock stuns the frog if it is still there when it lands, not if it moved', () => {
    const level = bossLevel();
    for (const dodge of [false, true]) {
      const st = createGame(level);
      for (let t = 0; t < 14 * TICK_HZ && !st.boss!.shots.length; t++) step(st, level);
      expect(st.boss!.shots.length).toBeGreaterThan(0);
      if (dodge) {
        const away = st.rail!.u > level.rail!.len / 2 ? 20 : level.rail!.len - 20;
        const p = railPoint(level.rail!, away);
        step(st, level, [{ type: 'move', x: p.x, y: p.y }]);
      }
      const evs: string[] = [];
      for (let t = 0; t < 6 * TICK_HZ && st.boss!.shots.length; t++) for (const e of step(st, level)) evs.push(e.type);
      expect(evs.includes('stun')).toBe(!dodge);
      expect(evs.includes('dodge')).toBe(dodge);
      if (!dodge) expect(st.rail!.stun).toBeGreaterThan(0);
    }
  });

  it('a stunned frog cannot shoot', () => {
    const level = bossLevel();
    const st = createGame(level);
    st.rail!.stun = 1;
    st.gun.cool = 0;
    const ev = run(st, level, 0.5, [{ type: 'fire', x: 100, y: 300 }]);
    expect(ev.some((e) => e.type === 'fire')).toBe(false);
  });

  it('the bot can beat boss fights, and replays of a fight are exact', () => {
    let wins = 0;
    for (const seed of ['bf1', 'bf2', 'bf3', 'bf4']) {
      const level = generateLevel(seed, 9);
      if (playLevel(createGame(level), level, BOT_PRESETS.good).outcome === 'won') wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(2);
    const level = bossLevel('bf-replay');
    const a = playLevel(createGame(level), level, BOT_PRESETS.good, 50);
    const end = Math.round(a.seconds * TICK_HZ);
    const s1 = replay(createGame(level), level, a.inputs, end);
    const half = replay(createGame(level), level, a.inputs, Math.floor(end / 2));
    const s2 = replay(restore(snapshot(half)), level, a.inputs, end);
    expect(stateHash(s1)).toBe(stateHash(s2));
    expect(s1.score).toBe(a.score);
  });
});

describe('power-up spawn mix', () => {
  it('all six power-ups show up', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 12 && seen.size < 6; i++) {
      const level = generateLevel('mix', 6 + i);
      const st = createGame(level);
      for (let t = 0; t < 60 * TICK_HZ && st.phase === 'playing'; t++) {
        step(st, level);
        if (t % 30 === 0) for (const ch of st.chains) for (const b of ch.balls) if (b.p) seen.add(b.p);
      }
    }
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('mini-boss serpent', () => {
  const mini = (seed = 'snake') => generateLevel(seed, 4);

  it('every mini-boss level has a serpent in chain 0\'s skull pit', () => {
    for (const seed of ['s1', 's2', 'xl-s3', 'endless-s4']) {
      for (const i of [4, 14, 24]) {
        const l = generateLevel(seed, i);
        expect(l.boss).toBe('mini');
        expect(l.bossFight?.kind).toBe('serpent');
        const t0 = l.tracks[0];
        expect(l.bossFight!.x).toBeCloseTo(t0.xs[t0.xs.length - 1], 6);
        expect(l.bossFight!.y).toBeCloseTo(t0.ys[t0.ys.length - 1], 6);
        expect(l.rail).toBeUndefined();
      }
    }
    expect(generateLevel('s1', 9).bossFight?.kind).toBe('idol');
    expect(generateLevel('s1', 3).bossFight).toBeUndefined();
  });

  it('winds up, then spits a marble onto the front of the chain', () => {
    const level = mini();
    const st = createGame(level);
    for (let t = 0; t < 8 * TICK_HZ; t++) step(st, level);
    st.boss!.t = 0.001;
    const head0 = st.chains[0].balls[st.chains[0].balls.length - 1];
    const n0 = st.chains[0].balls.length;
    const evs: string[] = [];
    for (let t = 0; t < TICK_HZ; t++) for (const e of step(st, level)) evs.push(e.type);
    expect(evs).toContain('bossWindup');
    expect(evs).toContain('spit');
    const balls = st.chains[0].balls;
    expect(balls.length).toBeGreaterThanOrEqual(n0); // spat marble added (spawns may add more at the back)
    // The new marble sits in front of the old head.
    const idx = balls.findIndex((b) => b.id === head0.id);
    expect(idx).toBeLessThan(balls.length - 1);
    expect(balls[balls.length - 1].s).toBeGreaterThan(head0.s);
  });

  it('holds back when the chain is already near the skull', () => {
    const { level, st } = frozenGame([0, 1, 2, 3], { campaign: 'snake', index: 4, headGap: 60 });
    expect(st.boss?.max).toBeGreaterThan(0);
    st.boss!.t = 0.001;
    const ev = run(st, level, 1);
    expect(ev.some((e) => e.type === 'spit')).toBe(false);
    expect(st.chains[0].balls.length).toBe(4);
  });

  it('popping marbles hurts it; slaying it clears the level', () => {
    const { level, st } = frozenGame([0, 1, 1, 2, 3, 0, 2], { campaign: 'snake', index: 4 });
    const hp0 = st.boss!.hp;
    st.gun.cur = 1;
    run(st, level, 1, [aimAt(level, st, 2)]);
    expect(st.boss!.hp).toBe(hp0 - 3);
    st.boss!.hp = 0;
    const evs: string[] = [];
    for (let t = 0; t < 5 * TICK_HZ && st.phase === 'playing'; t++) for (const e of step(st, level)) evs.push(e.type);
    expect(evs).toContain('bossDown');
    expect(st.phase).toBe('won');
  });

  it('the bot can beat mini-bosses, and replays are exact', () => {
    let wins = 0;
    for (const seed of ['m1', 'm2', 'm3', 'm4']) {
      const level = generateLevel(seed, 4);
      if (playLevel(createGame(level), level, BOT_PRESETS.good).outcome === 'won') wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(2);
    const level = mini('m-replay');
    const a = playLevel(createGame(level), level, BOT_PRESETS.good, 40);
    const s1 = replay(createGame(level), level, a.inputs, Math.round(a.seconds * TICK_HZ));
    expect(s1.score).toBe(a.score);
    expect(stateHash(s1)).toBe(stateHash(replay(createGame(level), level, a.inputs, Math.round(a.seconds * TICK_HZ))));
  });
});

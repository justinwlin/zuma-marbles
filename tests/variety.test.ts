import { describe, expect, it } from 'vitest';
import { generateLevel, INTRO, variety } from '../src/sim/levelgen';
import { createGame, Power, step, TICK_HZ, TUNING } from '../src/sim/game';
import { aimAt, frozenGame, run } from './helpers';

const popsIn = (ev: ReturnType<typeof run>) => ev.filter((e) => e.type === 'pop').reduce((n, e) => n + (e.type === 'pop' ? e.balls.length : 0), 0);

describe('introduction schedule', () => {
  it('new power-ups and marbles arrive one at a time, rare first, then common', () => {
    const v0 = variety(0);
    expect(new Set(v0.powerPool)).toEqual(new Set([1, 2, 3, 4, 5, 6]));
    expect(v0.gemChance + v0.armorChance + v0.chameleonChance).toBe(0);
    const count = (i: number, p: number) => variety(i).powerPool.filter((x) => x === p).length;
    expect(count(INTRO.colorCloud - 1, 7)).toBe(0);
    expect(count(INTRO.colorCloud, 7)).toBe(1); // rare at first
    expect(count(INTRO.colorCloud + 10, 7)).toBe(2); // as common as the rest later
    expect(count(INTRO.blackHole, 8)).toBe(1);
    expect(count(INTRO.magnet, 9)).toBe(1);
    expect(variety(INTRO.armor - 1).armorChance).toBe(0);
    expect(variety(INTRO.armor).armorChance).toBeGreaterThan(0);
    expect(variety(INTRO.armor + 60).armorChance).toBeGreaterThan(variety(INTRO.armor).armorChance * 2);
    expect(variety(INTRO.chameleon).chameleonChance).toBeGreaterThan(0);
    expect(variety(INTRO.gem).gemChance).toBeGreaterThan(0);
  });

  it('later levels spawn special marbles; early levels never do', () => {
    const specials = (i: number) => {
      const level = generateLevel('variety', i);
      const st = createGame(level);
      let n = 0;
      const seen = new Set<number>();
      for (let t = 0; t < 40 * TICK_HZ && st.phase === 'playing'; t++) {
        step(st, level);
        for (const ch of st.chains) for (const b of ch.balls) if ((b.a || b.cm || b.gem) && !seen.has(b.id)) (seen.add(b.id), n++);
      }
      return n;
    };
    expect(specials(2)).toBe(0);
    expect(specials(35)).toBeGreaterThan(0);
  });
});

describe('new power-ups', () => {
  const fire = (colors: number[], power: Power, i: number, seconds = 3) => {
    const { level, st } = frozenGame(colors);
    st.chains[0].balls[i].p = power;
    st.chains[0].balls[i].pt = 99;
    st.gun.cur = colors[i];
    return { level, st, ev: run(st, level, seconds, [aimAt(level, st, i)]) };
  };

  it('Colour Cloud: the 4 marbles on each side take its colour and snap into a combo', () => {
    const colors = [3, 0, 1, 0, 1, 2, 2, 1, 0, 1, 0, 3];
    const { ev } = fire(colors, Power.ColorCloud, 5);
    const p = ev.find((e) => e.type === 'power' && e.power === Power.ColorCloud);
    expect(p && p.type === 'power' ? p.zaps?.length : 0).toBe(8);
    expect(popsIn(ev)).toBeGreaterThanOrEqual(3 + 8);
    expect(ev.some((e) => e.type === 'pop' && e.combo > 0)).toBe(true);
  });

  it('Black Hole: pulls in the marbles around it one by one, then closes', () => {
    const colors = Array.from({ length: 20 }, (_, i) => [3, 1][i % 2]);
    colors.splice(9, 2, 2, 2);
    const { ev, st } = fire(colors, Power.BlackHole, 9, TUNING.holeTime + 0.5);
    expect(ev.filter((e) => e.type === 'eat').length).toBeGreaterThanOrEqual(8);
    expect(st.holes.length).toBe(0);
  });

  it('Magnet: shots curve toward a marble of their colour', () => {
    const turn = (magnet: boolean) => {
      const { level, st } = frozenGame([0, 0, 0, 0, 0, 0]);
      st.gun.cur = 0;
      if (magnet) st.magnetT = TUNING.magnetTime;
      const target = aimAt(level, st, 3) as { type: 'fire'; x: number; y: number };
      // Aim 200 px to the side of the chain.
      const L = level.launcher;
      const dx = target.x - L.x;
      const dy = target.y - L.y;
      const n = Math.hypot(dx, dy);
      run(st, level, 1 / TICK_HZ, [{ type: 'fire', x: target.x - (dy / n) * 200, y: target.y + (dx / n) * 200 }]);
      const a0 = Math.atan2(st.shots[0].vy, st.shots[0].vx);
      run(st, level, 8 / TICK_HZ);
      return st.shots[0] ? Math.abs(Math.atan2(st.shots[0].vy, st.shots[0].vx) - a0) : 0;
    };
    expect(turn(false)).toBe(0);
    expect(turn(true)).toBeGreaterThan(0.05);
  });

  it('a power-up appears in the HUD pool only from its level on', () => {
    expect(generateLevel('pool', 0).powerPool).not.toContain(7);
    expect(generateLevel('pool', INTRO.magnet).powerPool).toContain(9);
  });
});

describe('special marbles', () => {
  it('Armored: the first match cracks it, the second pops it', () => {
    const { level, st } = frozenGame([0, 1, 1, 1, 2, 3]);
    st.chains[0].balls[2].a = 1;
    const armoredId = st.chains[0].balls[2].id;
    st.gun.cur = 1;
    const ev = run(st, level, 1, [aimAt(level, st, 2)]);
    expect(ev.some((e) => e.type === 'crack')).toBe(true);
    expect(popsIn(ev)).toBe(3); // four 1s matched, the armored one survived
    const survivor = st.chains[0].balls.find((b) => b.id === armoredId)!;
    expect(survivor).toBeDefined();
    expect(survivor.a).toBeUndefined();
  });

  it('Armored marbles also survive one bomb', () => {
    const colors = Array.from({ length: 12 }, (_, i) => i % 4);
    const { level, st } = frozenGame(colors, { mods: { pocketBomb: true } });
    st.chains[0].balls.forEach((b) => (b.a = 1));
    const ev = run(st, level, 1, [aimAt(level, st, 6)]);
    expect(ev.filter((e) => e.type === 'crack').length).toBeGreaterThan(0);
    expect(st.chains[0].balls.length).toBe(colors.length);
  });

  it('Chameleon: changes colour on a fixed beat', () => {
    const { level, st } = frozenGame([0, 1, 2, 3]);
    const b = st.chains[0].balls[1];
    b.cm = 1;
    const c0 = b.c;
    run(st, level, TUNING.chameleonEvery + 0.05);
    expect(b.c).toBe((c0 + 1) % level.colors);
  });

  it('Gem: pays bonus score and coins when popped', () => {
    const { level, st } = frozenGame([0, 1, 1, 2, 3]);
    st.chains[0].balls[2].gem = 1;
    st.gun.cur = 1;
    const ev = run(st, level, 1, [aimAt(level, st, 2)]);
    expect(ev.some((e) => e.type === 'gem')).toBe(true);
    expect(st.coinsEarned.by.gems).toBe(10);
    expect(st.score).toBeGreaterThanOrEqual(30 + TUNING.gemScore);
  });
});

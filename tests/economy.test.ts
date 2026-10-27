import { describe, expect, it } from 'vitest';
import { generateLevel } from '../src/sim/levelgen';
import { createGame, Power, progress, stateHash, step, TICK_HZ, TUNING } from '../src/sim/game';
import { ITEMS, NO_MODS } from '../src/sim/items';
import { activeItems, bossPicks, priceAt, gain, miniPicks, modsForStage, newEco, reroll, rerollCost, reserve, sellCharm, settleStage, shopOffers } from '../src/sim/economy';
import { checkUnlocks, LevelTracker, newMeta } from '../src/sim/achievements';
import { runExpedition } from '../src/sim/expedition';
import { BOT_PRESETS } from '../src/sim/bot';
import { pointAt } from '../src/sim/track';
import { aimAt, frozenGame, run } from './helpers';

const popsIn = (ev: ReturnType<typeof run>) => ev.filter((e) => e.type === 'pop').reduce((n, e) => n + (e.type === 'pop' ? e.balls.length : 0), 0);

describe('neutral mods', () => {
  it('a game with no items is identical to the game without the item system', () => {
    const level = generateLevel('neutral', 3);
    const a = createGame(level);
    const b = createGame(level, NO_MODS);
    for (let t = 0; t < 10 * TICK_HZ; t++) {
      step(a, level);
      step(b, level);
    }
    expect(stateHash(a)).toBe(stateHash(b));
  });
});

describe('coins', () => {
  it('pay 1 per popped marble', () => {
    const { level, st } = frozenGame([0, 1, 1, 2, 3, 0, 2]);
    st.gun.cur = 1;
    run(st, level, 1, [aimAt(level, st, 2)]);
    expect(st.coinsEarned.by.pops).toBe(3);
    expect(st.coinsEarned.total).toBe(3);
  });

  it('Lucky Colour pays triple for its colour', () => {
    const { level, st } = frozenGame([0, 1, 1, 2, 3, 0, 2], { mods: { luckyColor: 1 } });
    st.gun.cur = 1;
    run(st, level, 1, [aimAt(level, st, 2)]);
    expect(st.coinsEarned.by.pops).toBe(9);
  });

  it('Daredevil doubles pops while the chain is deep in the track', () => {
    const { level, st } = frozenGame([0, 1, 1, 2, 3, 0, 2], { headGap: 80, mods: { dangerCoinMul: 2 } });
    expect(progress(st, level).head).toBeGreaterThan(0.75);
    st.gun.cur = 1;
    run(st, level, 1, [aimAt(level, st, 2)]);
    expect(st.coinsEarned.by.pops).toBe(6);
  });

  it('shooting a floating coin pays 25', () => {
    const { level, st } = frozenGame([0, 1, 2, 3]);
    const target = pointAt(level.tracks[0], st.chains[0].balls[2].s);
    st.coin = { x: (level.launcher.x + target.x) / 2, y: (level.launcher.y + target.y) / 2, t: 5 };
    run(st, level, 1, [{ type: 'fire', x: target.x, y: target.y }]);
    expect(st.coinsEarned.by.floating).toBe(25);
  });

  it('beating a boss pays 100 and its defeat cascade pays nothing', () => {
    const { level, st } = frozenGame([0, 1, 1, 2, 3, 0, 2], { campaign: 'snake', index: 4 });
    st.boss!.hp = 0;
    for (let t = 0; t < 5 * TICK_HZ && st.phase === 'playing'; t++) step(st, level);
    expect(st.phase).toBe('won');
    expect(st.coinsEarned.by.pops).toBe(0);
    expect(st.coinsEarned.by.boss).toBe(100);
    expect(st.coinsEarned.by.ace).toBe(50);
  });
});

describe('items', () => {
  it('Slowpoke: chains cruise 20% slower', () => {
    const level = generateLevel('slow', 3);
    const a = createGame(level);
    const b = createGame(level, { ...NO_MODS, speedMul: 0.8 });
    for (let t = 0; t < 12 * TICK_HZ; t++) {
      step(a, level);
      step(b, level);
    }
    expect(b.chains[0].peak).toBeLessThan(a.chains[0].peak);
  });

  it('Extra Life: a chain reaching the skull is pushed back instead of losing', () => {
    const { level, st } = frozenGame([0, 1, 2, 3], { headGap: 0, mods: { lives: 1 } });
    const head0 = st.chains[0].balls[3].s;
    const ev = run(st, level, 0.1);
    expect(ev.some((e) => e.type === 'rescue')).toBe(true);
    expect(st.phase).toBe('playing');
    expect(st.lives).toBe(0);
    expect(st.chains[0].balls[3].s).toBeCloseTo(head0 - level.tracks[0].length * 0.25, 0);
    // No second rescue
    st.chains[0].balls.forEach((b, i) => (b.s = level.tracks[0].length - (3 - i) * 36));
    run(st, level, 0.1);
    expect(st.phase).not.toBe('playing');
  });

  it('Power Surge and Long Fuse: more power marbles, and they last twice as long', () => {
    const level = generateLevel('pow', 3);
    const count = (mods = NO_MODS) => {
      const st = createGame(level, mods);
      let maxLife = 0;
      for (let t = 0; t < 25 * TICK_HZ; t++) {
        step(st, level);
        for (const b of st.chains[0].balls) if (b.p) maxLife = Math.max(maxLife, b.pt);
      }
      return { n: st.stats.powers + st.chains[0].balls.filter((b) => b.p).length, maxLife };
    };
    const base = count();
    const surge = count({ ...NO_MODS, powerChanceMul: 4 });
    expect(surge.n).toBeGreaterThan(base.n);
    expect(count({ ...NO_MODS, powerChanceMul: 4, powerLifeMul: 2 }).maxLife).toBeGreaterThan(TUNING.powerLife);
  });

  it('Pocket Bomb: the first shot is a bomb that blows up where it lands', () => {
    const colors = [0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3];
    const { level, st } = frozenGame(colors, { mods: { pocketBomb: true } });
    expect(st.gun.b).toBe(1);
    const ev = run(st, level, 1, [aimAt(level, st, 8)]);
    expect(ev.some((e) => e.type === 'power' && e.power === Power.Bomb)).toBe(true);
    expect(ev.some((e) => e.type === 'hit')).toBe(false);
    expect(st.chains[0].balls.length).toBeLessThan(colors.length - 3);
    expect(st.gun.b).toBe(0);
  });

  it('Bomber: bombs blast wider', () => {
    const colors = Array.from({ length: 20 }, (_, i) => i % 4);
    const popped = (mul: number) => {
      const { level, st } = frozenGame(colors, { mods: { pocketBomb: true, bombRadiusMul: mul } });
      run(st, level, 1, [aimAt(level, st, 10)]);
      return colors.length - st.chains[0].balls.length;
    };
    expect(popped(1.5)).toBeGreaterThan(popped(1));
  });

  it('Shockwave: a match of 5+ also pops the marble on each side', () => {
    const { level, st } = frozenGame([0, 2, 1, 1, 1, 1, 3, 0], { mods: { shockwave: true } });
    st.gun.cur = 1;
    const ev = run(st, level, 1, [aimAt(level, st, 3)]);
    expect(popsIn(ev)).toBe(7);
    const plain = frozenGame([0, 2, 1, 1, 1, 1, 3, 0]);
    plain.st.gun.cur = 1;
    expect(popsIn(run(plain.st, plain.level, 1, [aimAt(plain.level, plain.st, 3)]))).toBe(5);
  });

  it('Quick Draw: shots fly 25% faster', () => {
    const { level, st } = frozenGame([0, 1, 2, 3], { mods: { shotSpeedMul: 1.25 } });
    run(st, level, 1 / TICK_HZ, [{ type: 'fire', x: level.launcher.x, y: -500 }]);
    const sh = st.shots[0];
    expect(Math.hypot(sh.vx, sh.vy)).toBeCloseTo(TUNING.shotSpeed * 1.25, 3);
  });

  it('Rainbow: every Nth shot is Wild, shown before it is fired', () => {
    const { level, st } = frozenGame([0, 1, 2, 3], { mods: { wildEvery: 3 } });
    const away = { type: 'fire' as const, x: level.launcher.x, y: -2000 };
    run(st, level, 0.4, [away]);
    expect(st.gun.w & 1).toBe(0);
    run(st, level, 0.4, [away]);
    expect(st.gun.w & 1).toBe(1);
  });

  it('Colour Scout: the marble after next becomes the next one', () => {
    const { level, st } = frozenGame([0, 1, 2, 3], { mods: { scout: true } });
    const after = st.gun.after;
    expect(after).toBeGreaterThanOrEqual(0);
    run(st, level, 0.1, [{ type: 'fire', x: level.launcher.x, y: -2000 }]);
    expect(st.gun.next).toBe(after);
  });

  it('Lightning Rod: lightning also strikes a second colour', () => {
    const colors = [1, 0, 1, 0, 2, 2, 0, 1, 0, 1];
    const popped = (rod: boolean) => {
      const { level, st } = frozenGame(colors, { mods: { lightningRod: rod } });
      st.chains[0].balls[4].p = Power.Lightning;
      st.chains[0].balls[4].pt = 99;
      st.gun.cur = 2;
      run(st, level, 1, [aimAt(level, st, 4)]);
      return colors.length + 1 - st.chains[0].balls.length;
    };
    expect(popped(false)).toBe(3);
    expect(popped(true)).toBeGreaterThan(3);
  });

  it('Boss Breaker and Snake Charmer: double choke damage, a longer rear-up, more power-ups', () => {
    const level = generateLevel('snake', 4);
    const colors = Array.from({ length: 14 }, (_, i) => i % 4);
    const { st } = frozenGame(colors, { campaign: 'snake', index: 4, headGap: level.tracks[0].length * 0.6, mods: { bossDirectMul: 2, chokeExtra: 2, serpentWindupAdd: 1 } });
    st.boss!.t = 0.001;
    run(st, level, 0.05);
    expect(st.boss!.wind).toBeGreaterThan(TUNING.serpentWindup);
    st.boss!.t = 100;
    const B = level.bossFight!;
    const ev = run(st, level, 1.5, [{ type: 'fire', x: B.x, y: B.y }]);
    const hit = ev.find((e) => e.type === 'bossHit');
    expect(hit && hit.type === 'bossHit' ? hit.dmg : 0).toBe(TUNING.serpentChoke * 2);
    const choke = ev.find((e) => e.type === 'choke');
    expect(choke && choke.type === 'choke' ? choke.at.length : 0).toBeGreaterThanOrEqual(5);
  });

  it('Scavenger: floating coins come twice as often', () => {
    const level = generateLevel('coin', 3);
    expect(createGame(level, { ...NO_MODS, coinSpawnMul: 2 }).coinT).toBe(createGame(level).coinT / 2);
  });
});

describe('run economy', () => {
  const seed = 'endless-eco';
  const all = ['shockwave', 'bomber', 'quickDraw', 'rainbow', 'scout', 'slowpoke', 'powerSurge', 'pocketBomb', 'longFuse'] as const;

  it('buying charms: coins, slots, replacing sells for half', () => {
    const P = (id: keyof typeof ITEMS) => priceAt(id, 9);
    expect(P('shockwave')).toBe(Math.round((ITEMS.shockwave.price * 1.2) / 25) * 25); // world 2 prices
    const eco = newEco();
    eco.coins = 5000;
    expect(gain(eco, 'shockwave', seed, 9)).toBeNull();
    expect(eco.coins).toBe(5000 - P('shockwave'));
    expect(gain(eco, 'shockwave', seed, 9)).toBe('owned');
    expect(gain(eco, 'bomber', seed, 9)).toBeNull();
    expect(gain(eco, 'scout', seed, 9, { free: true })).toBeNull();
    expect(gain(eco, 'quickDraw', seed, 9)).toBe('slots');
    const before = eco.coins;
    expect(gain(eco, 'quickDraw', seed, 9, { replace: 0 })).toBeNull(); // Shockwave out for half its price
    expect(eco.coins).toBe(before + Math.floor(P('shockwave') / 2) - P('quickDraw'));
    expect(eco.charms.map((c) => c.id)).toEqual(['bomber', 'scout', 'quickDraw']);
    const c0 = eco.coins;
    sellCharm(eco, 1); // free charm sells for nothing
    expect(eco.coins).toBe(c0);
    eco.coins = 100;
    expect(gain(eco, 'rainbow', seed, 9)).toBe('coins');
  });

  it('boosts last until the next boss is beaten', () => {
    const eco = newEco();
    eco.coins = 5000;
    gain(eco, 'slowpoke', seed, 9); // shop after boss 9 → levels 10-19
    gain(eco, 'longFuse', seed, 4, { free: true }); // mini-boss pick after 4 → levels 5-9
    expect(eco.boosts.map((b) => b.until)).toEqual([19, 9]);
    expect(modsForStage(eco, 12).speedMul).toBe(0.8);
    expect(modsForStage(eco, 12).powerLifeMul).toBe(1);
    expect(modsForStage(eco, 7).powerLifeMul).toBe(2);
    const st = createGame(generateLevel(seed, 19));
    settleStage(eco, st, 19, true);
    expect(eco.boosts).toEqual([]);
    expect(activeItems(eco, 20)).toEqual([]);
  });

  it('3 boost slots at most', () => {
    const eco = newEco();
    eco.coins = 5000;
    for (const id of ['slowpoke', 'powerSurge', 'pocketBomb'] as const) expect(gain(eco, id, seed, 9)).toBeNull();
    expect(gain(eco, 'longFuse', seed, 9)).toBe('slots');
  });

  it('Extra Life is spent for the rest of its world', () => {
    const eco = newEco();
    eco.coins = 1000;
    gain(eco, 'extraLife', seed, 9);
    expect(modsForStage(eco, 12).lives).toBe(1);
    const st = createGame(generateLevel(seed, 12), modsForStage(eco, 12));
    st.lives = 0;
    settleStage(eco, st, 12, true);
    expect(modsForStage(eco, 15).lives).toBe(0);
  });

  it('coins from a level are banked', () => {
    const eco = newEco();
    const st = createGame(generateLevel(seed, 3));
    st.coinsEarned.total = 123;
    settleStage(eco, st, 3, true);
    expect(eco.coins).toBe(123);
  });

  it('offers are seeded: same run, same offers; rerolls change them; owned items are excluded', () => {
    const a = newEco();
    const b = newEco();
    expect(shopOffers(a, seed, 9, [...all])).toEqual(shopOffers(b, seed, 9, [...all]));
    expect(shopOffers(a, seed, 9, [...all])).not.toEqual(shopOffers(a, 'endless-other', 9, [...all]));
    a.coins = 1000;
    reroll(a);
    expect(a.coins).toBe(950);
    expect(rerollCost(a)).toBe(75);
    a.coins = 1000;
    gain(a, 'shockwave', seed, 9);
    expect(shopOffers(a, seed, 9, [...all]).charms).not.toContain('shockwave');
    expect(bossPicks(a, seed, 9, [...all])).not.toContain('shockwave');
    expect(miniPicks(a, seed, 4, [...all]).length).toBe(2);
  });

  it('reserve holds a charm for the next shop', () => {
    const eco = newEco();
    eco.coins = 1000;
    expect(reserve(eco, 'rainbow')).toBeNull();
    expect(eco.coins).toBe(950);
    const offers = shopOffers(eco, seed, 19, [...all]);
    expect(offers.reserved).toBe('rainbow');
    expect(offers.charms).not.toContain('rainbow');
    eco.coins = 5000;
    expect(gain(eco, 'rainbow', seed, 19)).toBeNull();
    expect(eco.reserved).toBeNull();
  });
});

describe('unlocks', () => {
  it('start with the starter pool and unlock items once when earned', () => {
    const meta = newMeta();
    expect(meta.unlocked).not.toContain('luckyColor');
    const t = new LevelTracker();
    t.feed([{ type: 'pop', balls: Array.from({ length: 50 }, () => ({ x: 0, y: 0, c: 2, p: 0 })), combo: 3, score: 0, x: 0, y: 0, c: 2, gapBonus: 0, chainBonus: 0 }]);
    const level = generateLevel('endless-u', 4);
    const fresh = checkUnlocks(meta, t, level, { won: true, peakDanger: 0.5 });
    expect(fresh.sort()).toEqual(['comboKing', 'luckyColor', 'snakeCharmer']);
    expect(checkUnlocks(meta, t, level, { won: true, peakDanger: 0.5 })).toEqual([]);
  });

  it('floating coins count across levels', () => {
    const meta = newMeta();
    const level = generateLevel('endless-u', 2);
    for (let i = 0; i < 10; i++) {
      const t = new LevelTracker();
      t.feed([{ type: 'coinGet', x: 0, y: 0, score: 300 }]);
      const fresh = checkUnlocks(meta, t, level, { won: true, peakDanger: 0.2 });
      expect(fresh.includes('scavenger')).toBe(i === 9);
    }
  });
});

describe('expedition simulator', () => {
  it('a simulated run is exactly reproducible', () => {
    const go = () => runExpedition({ seed: 'endless-repro', bot: BOT_PRESETS.good, policy: 'greedy', maxStages: 11 });
    const a = go();
    const b = go();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.log.length).toBeGreaterThan(0);
  });
});

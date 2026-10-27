import { describe, expect, it } from 'vitest';
import { dailySeed, freshSave, levelCode, loadSave, parseLevelCode, starsFor, writeSave } from '../src/game/save';
import { GEN_VERSION } from '../src/sim/levelgen';
import { generateLevel } from '../src/sim/levelgen';
import { createGame, restore, snapshot, step, stateHash } from '../src/sim/game';

class MemStorage {
  m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
}

describe('save data', () => {
  it('round-trips progress, settings and a mid-level snapshot', () => {
    const mem = new MemStorage() as unknown as Storage;
    const d = freshSave('jade-1234');
    const lvl = generateLevel(d.campaignSeed, 4);
    const st = createGame(lvl);
    for (let i = 0; i < 500; i++) step(st, lvl);
    d.unlocked = 4;
    d.best[3] = { score: 1234, stars: 2, seconds: 80 };
    d.settings.colorblind = true;
    d.snapshot = { levelIndex: 4, state: JSON.parse(snapshot(st)), savedAt: 1 };
    writeSave(d, mem);
    const back = loadSave(mem);
    expect(back.unlocked).toBe(4);
    expect(back.best[3].stars).toBe(2);
    expect(back.settings.colorblind).toBe(true);
    expect(stateHash(restore(JSON.stringify(back.snapshot!.state)))).toBe(stateHash(st));
  });

  it('corrupted storage falls back to a fresh save instead of crashing', () => {
    const mem = new MemStorage() as unknown as Storage;
    mem.setItem('zuma-marbles.save.v1', '{not json');
    expect(loadSave(mem).unlocked).toBe(0);
  });

  it('level codes are shareable and parse back', () => {
    const code = levelCode('ember-42', 11);
    expect(code).toBe('ember-42/12');
    expect(parseLevelCode(code)).toEqual({ seed: 'ember-42', index: 11 });
    expect(parseLevelCode('nonsense')).toBeNull();
    // Same code → same level for anyone.
    const p = parseLevelCode(code)!;
    expect(generateLevel(p.seed, p.index).paths).toEqual(generateLevel('ember-42', 11).paths);
  });

  it('stars reward keeping the chain away from the skull', () => {
    expect(starsFor(0.3)).toBe(3);
    expect(starsFor(0.6)).toBe(2);
    expect(starsFor(0.95)).toBe(1);
  });
});

describe('campaign switching', () => {
  it('keeps each campaign’s progress and in-progress level', async () => {
    const { switchCampaign } = await import('../src/game/save');
    let d = freshSave('jade-1');
    d.unlocked = 5;
    d.best[2] = { score: 900, stars: 3, seconds: 40 };
    d = switchCampaign(d, 'xl-jade-1');
    expect(d.campaignSeed).toBe('xl-jade-1');
    expect(d.unlocked).toBe(0);
    expect(d.best).toEqual({});
    d.unlocked = 2;
    d = switchCampaign(d, 'jade-1');
    expect(d.unlocked).toBe(5);
    expect(d.best[2].stars).toBe(3);
    d = switchCampaign(d, 'xl-jade-1');
    expect(d.unlocked).toBe(2);
    expect(Object.keys(d.archive ?? {})).toEqual(['jade-1']);
  });

  it('a save from the old level generator keeps progress but drops stale mid-level snapshots', () => {
    const mem = new MemStorage() as unknown as Storage;
    const old = freshSave('jade-1234') as ReturnType<typeof freshSave>;
    delete old.gen; // saves before v2 had no generator version
    old.unlocked = 12;
    old.best[11] = { score: 900, stars: 3, seconds: 60 };
    old.totalScore = 5000;
    old.snapshot = { levelIndex: 12, state: {} as never, savedAt: 1 };
    old.archive = { 'xl-jade-1234': { unlocked: 3, best: {}, totalScore: 10, snapshot: { levelIndex: 3, state: {} as never, savedAt: 1 } } };
    writeSave(old, mem);
    const back = loadSave(mem);
    expect(back.unlocked).toBe(12);
    expect(back.best[11].stars).toBe(3);
    expect(back.totalScore).toBe(5000);
    expect(back.snapshot).toBeNull();
    expect(back.archive!['xl-jade-1234'].snapshot).toBeNull();
    expect(back.archive!['xl-jade-1234'].unlocked).toBe(3);
    expect(back.gen).toBe(GEN_VERSION);
    // Current saves are left alone.
    const cur = freshSave('a');
    cur.snapshot = { levelIndex: 0, state: {} as never, savedAt: 1 };
    writeSave(cur, mem);
    expect(loadSave(mem).snapshot).not.toBeNull();
  });

  it('daily seed is the same all day', () => {
    expect(dailySeed(new Date(2026, 9, 27, 1))).toBe('daily-20261027');
    expect(dailySeed(new Date(2026, 9, 27, 23))).toBe('daily-20261027');
  });
});

import { describe, expect, it } from 'vitest';
import { BALL_D, bossKind, difficulty, effDifficulty, FAMILY_LEN, generateLevel, isEndlessSeed, TWIN_FAMILIES, validateLevel, WORLD_H, WORLD_W } from '../src/sim/levelgen';
import { createGame, Power, raycast, restore, snapshot, stateHash, step, TICK_HZ, TUNING } from '../src/sim/game';
import { BOT_PRESETS, playLevel, replay } from '../src/sim/bot';
import { inTunnel, TRACK_STEP } from '../src/sim/track';
import { aimAt, frozenGame, mkBall, run, untilHit } from './helpers';

describe('level generation', () => {
  it('is deterministic for (campaign, index)', () => {
    const a = generateLevel('seed-x', 7);
    const b = generateLevel('seed-x', 7);
    expect(a.paths).toEqual(b.paths);
    expect(a.launcher).toEqual(b.launcher);
    expect(a.mutators).toEqual(b.mutators);
    expect(generateLevel('seed-y', 7).paths).not.toEqual(a.paths);
  });

  it('produces valid, non-overlapping tracks for many levels', () => {
    const fams = new Set<string>();
    for (let i = 0; i < 120; i++) {
      const lvl = generateLevel('bulk', i);
      fams.add(lvl.family);
      expect(validateLevel(lvl.paths, lvl.launcher, lvl.paths.length > 1, undefined, lvl.crossings)).not.toBeNull();
      expect(lvl.tracks.length).toBe(lvl.paths.length);
      for (const t of lvl.tracks) expect(t.length - t.visibleFrom).toBeGreaterThan(lvl.tracks.length > 1 ? 1100 : 2000);
      expect(lvl.launcher.x).toBeGreaterThan(0);
      expect(lvl.launcher.x).toBeLessThan(WORLD_W);
      expect(lvl.launcher.y).toBeLessThan(WORLD_H);
    }
    expect(fams.size).toBeGreaterThanOrEqual(10);
  });

  it('track lookup is uniform in arc length', () => {
    const track = generateLevel('uniform', 3).tracks[0];
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

describe('difficulty shape (sawtooth, bosses, twists, two chains)', () => {
  it('runs in a sawtooth: each block of 5 climbs, the next starts lower than the peak but higher than before', () => {
    for (let b = 0; b < 6; b++) {
      const s0 = effDifficulty(b * 5);
      for (let k = 1; k < 5; k++) expect(effDifficulty(b * 5 + k)).toBeGreaterThan(effDifficulty(b * 5 + k - 1));
      const next = effDifficulty(b * 5 + 5);
      expect(next).toBeLessThan(effDifficulty(b * 5 + 4));
      expect(next).toBeGreaterThan(s0);
    }
  });

  it('mini-boss every 5th level, boss every 10th, and they are tougher than the level before', () => {
    expect([4, 9, 14, 19, 24, 29].map(bossKind)).toEqual(['mini', 'boss', 'mini', 'boss', 'mini', 'boss']);
    expect(bossKind(0)).toBeNull();
    expect(bossKind(7)).toBeNull();
    for (const i of [4, 9, 14, 19, 29]) {
      // Base tuning (two-chain levels then trade speed/length for the second chain).
      const a = difficulty(i - 1);
      const b = difficulty(i);
      expect(generateLevel('boss', i).boss).toBe(bossKind(i));
      expect(b.target).toBeGreaterThan(a.target);
      expect(b.speed).toBeGreaterThan(a.speed);
      expect(b.colors).toBeGreaterThanOrEqual(a.colors);
    }
  });

  it('twists change the tuning they promise', () => {
    let surge = 0;
    let streaky = 0;
    for (let i = 0; i < 80; i++) {
      const l = generateLevel('twists', i);
      if (i < 5) expect(l.mutators).toEqual([]);
      if (l.boss) expect(l.mutators).toEqual([]);
      if (l.mutators.includes('streaky')) {
        streaky++;
        expect(l.repeatChance).toBeCloseTo(0.62);
      } else expect(l.repeatChance).toBeCloseTo(0.41);
      if (l.mutators.includes('surge')) {
        surge++;
        expect(l.powerChance).toBeGreaterThanOrEqual(0.15 - 1e-9);
      }
    }
    expect(surge).toBeGreaterThan(3);
    expect(streaky).toBeGreaterThan(3);
  });

  it('two-chain levels appear (not only on bosses), with tracks kept apart', () => {
    let twins = 0;
    let twinNormal = 0;
    const fams = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const l = generateLevel('twin', i);
      if (i < 7) expect(l.tracks.length).toBe(1);
      if (l.tracks.length === 2) {
        twins++;
        if (!l.boss) twinNormal++;
        fams.add(l.family);
        expect(TWIN_FAMILIES).toContain(l.family);
        expect(validateLevel(l.paths, l.launcher, true)).not.toBeNull();
      }
    }
    expect(twins).toBeGreaterThan(12);
    expect(twinNormal).toBeGreaterThan(6);
    expect(fams.size).toBe(3);
  });

  it('later levels get shorter tracks for their shape (harder)', () => {
    const avg = (from: number) => {
      let sum = 0;
      let n = 0;
      for (let c = 0; c < 12; c++)
        for (let i = from; i < from + 4; i++) {
          const l = generateLevel(`len-${c}`, i);
          for (const t of l.tracks) sum += (t.length - t.visibleFrom) / FAMILY_LEN[l.family];
          n += l.tracks.length;
        }
      return sum / n;
    };
    expect(avg(40)).toBeLessThan(avg(5) - 0.05);
  });

  it('some levels move the launcher off-centre', () => {
    let off = 0;
    for (let i = 3; i < 60; i++) if (generateLevel('off', i).offCentre) off++;
    expect(off).toBeGreaterThan(8);
  });

  it('endless runs are seeded, deterministic, and twist most stages', () => {
    expect(isEndlessSeed('endless-abc')).toBe(true);
    expect(isEndlessSeed('daily-20261027')).toBe(true);
    expect(isEndlessSeed('xl-daily-20261027')).toBe(true);
    expect(isEndlessSeed('jade-1234')).toBe(false);
    expect(generateLevel('daily-20261027', 6).paths).toEqual(generateLevel('daily-20261027', 6).paths);
    let tw = 0;
    let stacked = 0;
    for (let i = 1; i < 40; i++) {
      const l = generateLevel('endless-abc', i);
      expect(l.endless).toBe(true);
      if (l.mutators.length) tw++;
      if (l.mutators.length === 2) stacked++;
    }
    expect(tw).toBeGreaterThan(15);
    expect(stacked).toBeGreaterThan(0);
    // Endless difficulty never dips.
    for (let i = 1; i < 30; i++) expect(effDifficulty(i, true)).toBeGreaterThan(effDifficulty(i - 1, true));
  });
});

describe('figure-8 and tunnel tracks', () => {
  const find = (fam: string) => {
    for (let c = 0; c < 20; c++)
      for (let i = 6; i < 80; i++) {
        const l = generateLevel(`cross-${c}`, i);
        if (l.family === fam) return l;
      }
    throw new Error(`no ${fam}`);
  };

  it('crossing tracks get a bridge and a hidden tunnel stretch, and still validate', () => {
    for (const fam of ['figure8', 'tunnelSpiral']) {
      const l = find(fam);
      const t = l.tracks[0];
      expect(t.hidden?.length).toBeGreaterThan(0);
      expect(t.bridges?.length).toBe(t.hidden!.length);
      // The tunnel and the bridge over it are different passes of the same track.
      for (let k = 0; k < t.hidden!.length; k++) {
        const [h0, h1] = t.hidden![k];
        const [b0, b1] = t.bridges![k];
        expect(h1 < b0 || b1 < h0).toBe(true);
      }
    }
  });

  it('any track shape can get standalone tunnels: mid-track, apart, and hiding their marbles', () => {
    const fams = new Set<string>();
    for (let c = 0; c < 20; c++) for (let i = 0; i < 30; i++) {
      const l = generateLevel(`tun-${c}`, i);
      l.tracks.forEach((t) => {
        if (!t.tunnels) return;
        fams.add(l.family);
        expect(i).toBeGreaterThanOrEqual(2);
        expect(l.rail).toBeUndefined();
        for (const [a, b] of t.tunnels) {
          expect(a).toBeGreaterThan(t.visibleFrom);
          expect(b).toBeLessThan(t.length * 0.72 + 1);
          expect(b - a).toBeGreaterThanOrEqual(BALL_D * 4 - 1);
          expect(inTunnel(t, (a + b) / 2)).toBe(true);
          for (const [h0, h1] of [...(t.hidden ?? []), ...(t.bridges ?? [])]) expect(b < h0 || a > h1).toBe(true);
        }
        for (let k = 1; k < t.tunnels.length; k++) expect(t.tunnels[k][0]).toBeGreaterThan(t.tunnels[k - 1][1]);
      });
    }
    expect(fams.size).toBeGreaterThanOrEqual(10);
  });

  it('tunnel spirals run the tunnel under the rings (the earlier pass is hidden)', () => {
    const t = find('tunnelSpiral').tracks[0];
    for (let k = 0; k < t.hidden!.length; k++) expect(t.hidden![k][0]).toBeLessThan(t.bridges![k][0]);
  });

  it('marbles in a tunnel cannot be hit; marbles on the bridge can', () => {
    const level = find('figure8');
    const t = level.tracks[0];
    const st = createGame(level);
    const ch = st.chains[0];
    ch.rolling = false;
    ch.stopT = 1e6;
    st.spawning = false;
    const [h0, h1] = t.hidden![0];
    const [b0, b1] = t.bridges![0];
    ch.balls = [mkBall(st, 0, (h0 + h1) / 2), mkBall(st, 1, (b0 + b1) / 2)].sort((a, b) => a.s - b.s);
    // Aim straight at the crossing: the ray must hit the bridge marble, never the hidden one.
    const p = { x: t.xs[Math.round((h0 + h1) / 4)], y: t.ys[Math.round((h0 + h1) / 4)] };
    const hit = raycast(st, level, p.x - level.launcher.x, p.y - level.launcher.y);
    expect(hit).not.toBeNull();
    expect(ch.balls[hit!.index].c).toBe(1);
  });
});

describe('two chains', () => {
  const twinLevel = () => {
    for (let i = 7; i < 200; i++) {
      const l = generateLevel('twin-sim', i);
      if (l.tracks.length === 2) return l;
    }
    throw new Error('no twin level');
  };

  it('both chains roll in and either reaching its skull loses', () => {
    const level = twinLevel();
    const st = createGame(level);
    for (let t = 0; t < 3 * TICK_HZ; t++) step(st, level);
    expect(st.chains.length).toBe(2);
    expect(st.chains[0].balls.length).toBeGreaterThan(5);
    expect(st.chains[1].balls.length).toBeGreaterThan(5);
    // Freeze chain 0, push chain 1's head to its end.
    st.chains[0].stopT = 1e6;
    const c1 = st.chains[1];
    const L = level.tracks[1].length;
    c1.balls.forEach((b, i) => (b.s = L + 2 - (c1.balls.length - 1 - i) * BALL_D));
    let lost = false;
    for (let t = 0; t < 5 * TICK_HZ && !lost; t++) lost = step(st, level).some((e) => e.type === 'lose');
    expect(lost).toBe(true);
  });

  it('winning needs every chain cleared, and shots can hit either chain', () => {
    const level = twinLevel();
    const st = createGame(level);
    for (let t = 0; t < 3 * TICK_HZ; t++) step(st, level);
    // Some ray hits chain 1.
    let hit1 = false;
    for (let k = 0; k < 360 && !hit1; k++) hit1 = raycast(st, level, Math.cos((k * Math.PI) / 180), Math.sin((k * Math.PI) / 180))?.chain === 1;
    expect(hit1).toBe(true);
    st.score = 1e9; // fill the bar
    step(st, level);
    expect(st.barFull).toBe(true);
    st.chains[0].balls = [];
    for (let t = 0; t < 10; t++) step(st, level);
    expect(st.phase).toBe('playing'); // chain 1 still has marbles
    st.chains[1].balls = [];
    step(st, level);
    expect(st.phase).toBe('won');
  });

  it('bot plays a two-chain level deterministically (replay matches)', () => {
    const level = twinLevel();
    const a = playLevel(createGame(level), level, BOT_PRESETS.good, 60);
    const st = replay(createGame(level), level, a.inputs, Math.round(a.seconds * TICK_HZ));
    expect(st.score).toBe(a.score);
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
    expect(st.chains[0].balls.map((b) => b.c)).toEqual([0, 2, 3]);
    expect(st.score).toBe(30);
  });

  it('two of a kind does not pop', () => {
    const { level, st } = frozenGame([0, 1, 2, 3]);
    st.gun.cur = 1;
    run(st, level, 1, [aimAt(level, st, 1)]);
    expect(st.chains[0].balls.length).toBe(5);
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
      const idx = st.chains[0].balls.findIndex((b) => b.id === hit.ballId);
      const newIdx = st.chains[0].balls.findIndex((b) => b.c === 3);
      expect(newIdx).toBe(hit.front ? idx + 1 : idx - 1);
      sides.add(hit.front);
    }
    expect(sides.size).toBe(2);
  });

  it('balls stay exactly one diameter apart after insertion', () => {
    const { level, st } = frozenGame([0, 1, 2, 3, 0, 1]);
    st.gun.cur = 2;
    run(st, level, 0.8, [aimAt(level, st, 3)]);
    for (let i = 1; i < st.chains[0].balls.length; i++) {
      expect(st.chains[0].balls[i].s - st.chains[0].balls[i - 1].s).toBeCloseTo(BALL_D, 3);
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
    expect(st.chains[0].balls.map((b) => b.c)).toEqual([3, 3]);
    // 30 (BBB) + 100*1 + 30 (RRR)
    expect(st.score).toBe(160);
  });

  it('non-matching gap: the front part stops while the rear keeps moving', () => {
    const { level, st } = frozenGame([0, 1, 1, 2, 3]);
    st.chains[0].stopT = 0;
    level.speed = 60;
    st.gun.cur = 1;
    run(st, level, 0.8, [aimAt(level, st, 2)]);
    const frontS = st.chains[0].balls[st.chains[0].balls.length - 1].s;
    run(st, level, 1);
    expect(st.chains[0].balls[st.chains[0].balls.length - 1].s).toBeCloseTo(frontS, 5);
    expect(st.chains[0].balls[0].s).toBeGreaterThan(0);
  });

  it('magnet pull accelerates (Zuma suck curve)', () => {
    const { level, st } = frozenGame([1, 1, 2, 1]);
    st.chains[0].balls.splice(2, 1); // hole between the 1-1 and the lone 1
    st.chains[0].balls[2].s += 200;
    st.chains[0].balls[2].suck = TUNING.suckV0;
    const s0 = st.chains[0].balls[2].s;
    run(st, level, 0.1);
    const d1 = s0 - st.chains[0].balls[2].s;
    const s1 = st.chains[0].balls[2].s;
    run(st, level, 0.1);
    const d2 = s1 - st.chains[0].balls[2].s;
    expect(d2).toBeGreaterThan(d1 * 1.5);
  });
});

describe('power-ups', () => {
  it('bomb clears everything in radius when matched', () => {
    const { level, st } = frozenGame([0, 2, 3, 1, 1, 0, 2, 3, 0]);
    st.chains[0].balls[4].p = Power.Bomb;
    st.chains[0].balls[4].pt = 99;
    st.gun.cur = 1;
    const ev = run(st, level, 1.2, [aimAt(level, st, 3)]);
    expect(ev.some((e) => e.type === 'power' && e.power === Power.Bomb)).toBe(true);
    expect(st.chains[0].balls.length).toBeLessThan(5);
  });

  it('lightning strikes every visible marble of its colour, even far away', () => {
    // Colour 2 marbles spread along the chain; the lightning marble is one of the matched 1s.
    const { level, st } = frozenGame([2, 0, 1, 1, 3, 2, 0, 3, 2, 0, 2]);
    st.chains[0].balls[2].p = Power.Lightning;
    st.chains[0].balls[2].pt = 99;
    st.chains[0].balls[2].c = 2;
    st.chains[0].balls[3].c = 2;
    st.gun.cur = 2;
    const ev = run(st, level, 0.8, [aimAt(level, st, 3)]);
    const p = ev.find((e) => e.type === 'power');
    expect(p && p.type === 'power' && p.power).toBe(Power.Lightning);
    // Every colour-2 marble is gone or clearing.
    expect(st.chains[0].balls.filter((b) => b.c === 2 && b.clr < 0).length).toBe(0);
    expect(p && p.type === 'power' ? p.zaps!.length : 0).toBeGreaterThanOrEqual(4);
  });

  it('slow and reverse set their timers', () => {
    for (const [p, key] of [
      [Power.Slow, 'slowT'],
      [Power.Reverse, 'revT'],
    ] as const) {
      const { level, st } = frozenGame([0, 1, 1, 2]);
      st.chains[0].balls[1].p = p;
      st.chains[0].balls[1].pt = 99;
      st.gun.cur = 1;
      run(st, level, 0.6, [aimAt(level, st, 2)]);
      expect(st[key]).toBeGreaterThan(0);
    }
  });

  it('reverse moves the head backwards', () => {
    const { level, st } = frozenGame([0, 1, 2, 3, 0, 1]);
    st.revT = 1;
    const s0 = st.chains[0].balls[5].s;
    run(st, level, 0.5);
    expect(st.chains[0].balls[5].s).toBeLessThan(s0 - 40);
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

  it('a decent player wins most first levels', () => {
    let wins = 0;
    for (const seed of ['alpha', 'beta', 'gamma', 'delta', 'eps', 'zeta', 'eta', 'theta', 'iota', 'kappa']) {
      const level = generateLevel(seed, 0);
      if (playLevel(createGame(level), level, BOT_PRESETS.good).outcome === 'won') wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(7);
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
      trial.chains[0].stopT = 1e6; // freeze so the chain doesn't move while the shot flies
      trial.gun.cool = 0;
      const h = untilHit(trial, level, { type: 'fire', x: level.launcher.x + dx * 300, y: level.launcher.y + dy * 300 });
      if (!h) continue;
      checked++;
      const nb = trial.chains[0].balls.findIndex((b) => b.c === st.gun.cur && !st.chains[0].balls.some((o) => o.id === b.id));
      const neighbours = [trial.chains[0].balls[nb - 1]?.id, trial.chains[0].balls[nb + 1]?.id];
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

describe('generator stability (golden)', () => {
  it('existing campaigns keep producing identical levels', async () => {
    const { createHash } = await import('node:crypto');
    const h = createHash('sha1');
    for (let i = 0; i < 40; i++) {
      const l = generateLevel('jade-1234', i);
      h.update(JSON.stringify([l.paths, l.colors, l.speed, l.target, l.mutators, l.repeatChance, l.tracks.map((t) => t.tunnels ?? [])]));
    }
    // If this changes, every saved campaign and shared level code changes too:
    // bump GEN_VERSION (saves then drop stale mid-level snapshots) and update the hash.
    expect(h.digest('hex').slice(0, 12)).toBe('144014b0f521');
  });

  it('large-marble campaigns use a smaller board with valid, varied tracks', () => {
    const fams = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const l = generateLevel('xl-jade-1234', i);
      expect(l.worldW).toBe(1024);
      expect(l.worldH).toBe(576);
      expect(validateLevel(l.paths, l.launcher, l.paths.length > 1, { w: l.worldW, h: l.worldH }, l.crossings)).not.toBeNull();
      fams.add(l.family);
    }
    expect(fams.size).toBeGreaterThanOrEqual(8);
    expect(generateLevel('jade-1234', 0).worldW).toBe(1280);
  });
});

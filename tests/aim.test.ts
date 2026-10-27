import { describe, expect, it } from 'vitest';
import { assistAim, ASSIST_MAX, type Slot } from '../src/sim/aim';
import { createGame, raycast, restore, snapshot, step, TICK_HZ } from '../src/sim/game';
import { generateLevel } from '../src/sim/levelgen';
import { untilHit } from './helpers';

function settledGame(seed: string, idx: number) {
  const level = generateLevel(seed, idx);
  const st = createGame(level);
  for (let t = 0; t < 6 * TICK_HZ; t++) step(st, level);
  st.chains[0].stopT = 1e6; // freeze for geometric checks
  return { level, st };
}

/** Did a shot fired at angle a land in slot s? (fires in a cloned, frozen state) */
function landsIn(st: ReturnType<typeof createGame>, level: ReturnType<typeof generateLevel>, a: number, s: Slot) {
  const trial = restore(snapshot(st));
  trial.gun.cool = 0;
  const lx = level.launcher.x;
  const ly = level.launcher.y;
  const before = new Set(trial.chains[0].balls.map((b) => b.id));
  const h = untilHit(trial, level, { type: 'fire', x: lx + Math.cos(a) * 300, y: ly + Math.sin(a) * 300 });
  if (!h) return false;
  const i = trial.chains[0].balls.findIndex((b) => !before.has(b.id));
  const nb = [trial.chains[0].balls[i - 1]?.id, trial.chains[0].balls[i + 1]?.id];
  return nb.includes(s.ballId) && h.front === s.front;
}

describe('aim assist', () => {
  const cases = [
    ['aimA', 2],
    ['aimB', 5],
    ['aimC', 6],
  ] as const;

  it('never moves the aim more than the cap, and keeps the slot the player pointed at', () => {
    for (const [seed, idx] of cases) {
      const { level, st } = settledGame(seed, idx);
      for (let k = 0; k < 240; k++) {
        const raw = (k / 240) * Math.PI * 2;
        const rawHit = raycast(st, level, Math.cos(raw), Math.sin(raw));
        const r = assistAim(st, level, raw);
        expect(Math.abs(r.angle - raw)).toBeLessThanOrEqual(ASSIST_MAX + 1e-9);
        if (rawHit) {
          expect(r.hit?.ballId).toBe(rawHit.ballId);
          expect(r.hit?.front).toBe(rawHit.front);
        }
      }
    }
  });

  it('assisted shots land in the previewed slot (WYSIWYG targeting)', () => {
    let n = 0;
    let ok = 0;
    for (const [seed, idx] of cases) {
      const { level, st } = settledGame(seed, idx);
      for (let k = 0; k < 60; k++) {
        const raw = (k / 60) * Math.PI * 2 + 0.013;
        const r = assistAim(st, level, raw);
        if (!r.hit) continue;
        n++;
        if (landsIn(st, level, r.angle, { ballId: r.hit.ballId, front: r.hit.front })) ok++;
      }
    }
    expect(n).toBeGreaterThan(40);
    expect(ok / n).toBeGreaterThanOrEqual(0.99);
  });

  it('assisted aim tolerates finger wobble better than raw aim', () => {
    // Perturb the final angle by ±0.6° (lift-off jitter) and count slot changes.
    let rawStable = 0;
    let asStable = 0;
    let n = 0;
    const wob = (0.6 * Math.PI) / 180;
    for (const [seed, idx] of cases) {
      const { level, st } = settledGame(seed, idx);
      for (let k = 0; k < 180; k++) {
        const raw = (k / 180) * Math.PI * 2;
        const rh = raycast(st, level, Math.cos(raw), Math.sin(raw));
        if (!rh) continue;
        const r = assistAim(st, level, raw);
        n++;
        const same = (a: number, s: { ballId: number; front: boolean }) => {
          const h = raycast(st, level, Math.cos(a), Math.sin(a));
          return !!h && h.ballId === s.ballId && h.front === s.front;
        };
        if (same(raw - wob, rh) && same(raw + wob, rh)) rawStable++;
        if (same(r.angle - wob, r.hit!) && same(r.angle + wob, r.hit!)) asStable++;
      }
    }
    console.log(`wobble ±0.6°: raw stable ${((rawStable / n) * 100).toFixed(0)}%, assisted ${((asStable / n) * 100).toFixed(0)}%`);
    expect(asStable / n).toBeGreaterThan(rawStable / n + 0.1);
  });

  it('hysteresis: a tiny wobble across a slot boundary keeps the previous target', () => {
    const { level, st } = settledGame('aimA', 2);
    // Find a boundary where the raw slot changes between two close angles.
    let found = false;
    for (let k = 0; k < 3600 && !found; k++) {
      const a = (k / 3600) * Math.PI * 2;
      const b = a + (0.1 * Math.PI) / 180;
      const ha = raycast(st, level, Math.cos(a), Math.sin(a));
      const hb = raycast(st, level, Math.cos(b), Math.sin(b));
      if (!ha || !hb || (ha.ballId === hb.ballId && ha.front === hb.front)) continue;
      found = true;
      const first = assistAim(st, level, a);
      const prev = { ballId: first.hit!.ballId, front: first.hit!.front };
      const second = assistAim(st, level, b, prev);
      expect(second.hit?.ballId).toBe(prev.ballId);
      expect(second.hit?.front).toBe(prev.front);
    }
    expect(found).toBe(true);
  });
});

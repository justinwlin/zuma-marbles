// Aim assist: turn a raw aim angle (finger/mouse) into a shot that reliably
// lands in the insertion slot the preview shows.
//
// 1. Slot lock: find the range of angles that land in the slot the player is
//    pointing at and aim at its middle (max ±3.5°), so wobble can't change the slot.
// 2. Hysteresis: if the previously selected slot is still reachable within a
//    small tolerance, keep it, so the target doesn't flicker between neighbours.
//
// Pure and deterministic — the shot is still an ordinary fire command.

import { type GameState, raycast, type RayHit } from './game';
import type { Level } from './levelgen';

export interface Slot {
  ballId: number;
  front: boolean;
}

export interface AssistResult {
  angle: number;
  hit: RayHit | null;
  /** True when the angle was adjusted. */
  assisted: boolean;
}

const DEG = Math.PI / 180;
/** Max angular correction applied by the assist. */
export const ASSIST_MAX = 3.5 * DEG;
/** Hysteresis tolerance for keeping the previous slot. */
export const STICKY = 0.9 * DEG;

const STEP = 0.1 * DEG;

function hitAt(st: GameState, level: Level, a: number): RayHit | null {
  return raycast(st, level, Math.cos(a), Math.sin(a));
}

function sameSlot(h: RayHit | null, s: Slot): boolean {
  return !!h && h.ballId === s.ballId && h.front === s.front;
}

/**
 * Scan angles around the raw aim, find the contiguous angular interval that lands
 * in the target slot, and aim at its middle (clamped). The middle is the direction
 * that tolerates the most finger wobble / lift-off jitter.
 */
export function assistAim(st: GameState, level: Level, raw: number, prev: Slot | null = null): AssistResult {
  const N = Math.ceil((ASSIST_MAX + STICKY) / STEP);
  const hits: (RayHit | null)[] = [];
  for (let i = -N; i <= N; i++) hits.push(hitAt(st, level, raw + i * STEP));
  const at = (i: number) => hits[i + N];
  const rawHit = at(0);
  let target: Slot | null = null;
  let seed = 0;
  // Hysteresis: keep the previous slot if it is reachable within STICKY of the raw aim.
  if (prev && !sameSlot(rawHit, prev)) {
    const k = Math.round(STICKY / STEP);
    for (let d = 1; d <= k && !target; d++) {
      for (const i of [-d, d]) {
        if (sameSlot(at(i), prev)) {
          target = prev;
          seed = i;
          break;
        }
      }
    }
  }
  if (!target) {
    if (!rawHit) return { angle: raw, hit: null, assisted: false };
    target = { ballId: rawHit.ballId, front: rawHit.front };
  }
  let lo = seed;
  let hi = seed;
  while (lo - 1 >= -N && sameSlot(at(lo - 1), target)) lo--;
  while (hi + 1 <= N && sameSlot(at(hi + 1), target)) hi++;
  const mid = ((lo + hi) / 2) * STEP;
  const off = Math.max(-ASSIST_MAX, Math.min(ASSIST_MAX, mid));
  const angle = raw + off;
  const hit = hitAt(st, level, angle);
  if (!sameSlot(hit, target)) return { angle: raw + seed * STEP, hit: at(seed), assisted: seed !== 0 };
  return { angle, hit, assisted: off !== 0 };
}

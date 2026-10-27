// Deterministic PRNG. State is a single uint32 so it serializes with the game state.

export function hash32(str: string): number {
  // FNV-1a followed by an avalanche mix.
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** mulberry32 step: returns [value in [0,1), nextState]. */
export function next(state: number): [number, number] {
  const s = (state + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, s];
}

/** Mutable wrapper for generator code; read `.state` back out to persist it. */
export class Rng {
  constructor(public state: number) {}
  float(): number {
    const [v, s] = next(this.state);
    this.state = s;
    return v;
  }
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.float();
  }
  int(lo: number, hiExclusive: number): number {
    return lo + Math.floor(this.float() * (hiExclusive - lo));
  }
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(0, arr.length)];
  }
  chance(p: number): boolean {
    return this.float() < p;
  }
}

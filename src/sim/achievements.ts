// Unlocks: achievements that add items to the Expedition shop pool, Binding of Isaac style.
// A LevelTracker is fed each step's events (the same way in the game and the simulator);
// after the level, checkUnlocks() compares it and lifetime progress against the rules.

import { type GameEvent, Power, POWER_COUNT } from './game';
import { type ItemId, STARTER_ITEMS } from './items';
import type { Level } from './levelgen';
import type { RunEco } from './economy';

export interface MetaProgress {
  unlocked: ItemId[];
  /** Lifetime counters. */
  coinsShot: number;
  /** Bit per power-up type ever triggered (bit p = Power p). */
  powersSeen?: number;
  /** Best value reached for each goal (capped at its target), for the goals screen. */
  best?: Partial<Record<ItemId, number>>;
}

export function newMeta(): MetaProgress {
  return { unlocked: STARTER_ITEMS.slice(), coinsShot: 0 };
}

/** Saved progress from an older version: add starter items that were introduced since. */
export function withStarters(meta: MetaProgress): MetaProgress {
  for (const id of STARTER_ITEMS) if (!meta.unlocked.includes(id)) meta.unlocked.push(id);
  return meta;
}

/** Per-level facts the rules need. */
export class LevelTracker {
  colourPops: number[] = [0, 0, 0, 0, 0, 0, 0, 0];
  maxCombo = 0;
  chokes = 0;
  coinsShot = 0;
  powers = 0;
  wilds = 0;
  /** Bit per power-up type triggered this level. */
  powerTypes = 0;
  cracks = 0;
  feed(events: readonly GameEvent[]) {
    for (const e of events) {
      if (e.type === 'pop') {
        for (const b of e.balls) this.colourPops[b.c] = (this.colourPops[b.c] ?? 0) + 1;
        this.maxCombo = Math.max(this.maxCombo, e.combo);
      } else if (e.type === 'choke') this.chokes++;
      else if (e.type === 'power') {
        this.powers++;
        this.powerTypes |= 1 << e.power;
        if (e.power === Power.Wild) this.wilds++;
      } else if (e.type === 'crack') this.cracks++;
      else if (e.type === 'coinGet') this.coinsShot++;
    }
  }
}

export interface UnlockRule {
  id: ItemId;
  /** Shown on the collection and goals screens while locked. */
  hint: string;
  /** The goal is met when its value reaches this. */
  target: number;
}

export const UNLOCKS: UnlockRule[] = [
  { id: 'snakeCharmer', hint: 'Beat a serpent', target: 1 },
  { id: 'bossBreaker', hint: 'Beat a boss', target: 1 },
  { id: 'extraLife', hint: 'Reach world 3 (clear stage 20)', target: 20 },
  { id: 'luckyColor', hint: 'Pop 50 marbles of one colour in one level', target: 50 },
  { id: 'comboKing', hint: 'Make a combo chain of 4 pops', target: 4 },
  { id: 'daredevil', hint: 'Win a level with the chain past 90% of the track', target: 1 },
  { id: 'lightningRod', hint: 'Choke a serpent 6 times in one fight', target: 6 },
  { id: 'scavenger', hint: 'Shoot 10 floating coins', target: 10 },
  { id: 'rewinder', hint: 'Trigger 8 power-ups in one level', target: 8 },
  { id: 'doubleWild', hint: 'Use 3 Wild power-ups in one level', target: 3 },
  { id: 'aceHunter', hint: 'Beat the ace time on 5 levels in one run', target: 5 },
  { id: 'headStart', hint: 'Win a level without any chain passing halfway', target: 1 },
  { id: 'opener', hint: 'Trigger every type of power-up (across runs)', target: POWER_COUNT },
  { id: 'secondWind', hint: 'Crack 5 armored marbles in one level', target: 5 },
  { id: 'coinRush', hint: 'Bank 2,000 coins in one run', target: 2000 },
  { id: 'colourCut', hint: 'Clear stage 20 without buying a boost', target: 20 },
];

/** Set bits among power types 1..POWER_COUNT. */
function powerTypesSeen(bits: number): number {
  let n = 0;
  for (let p = 1; p <= POWER_COUNT; p++) if (bits & (1 << p)) n++;
  return n;
}

/** After a level: adds any newly earned unlocks to `meta`, records goal progress, and returns the new unlocks. */
export function checkUnlocks(meta: MetaProgress, t: LevelTracker, level: Level, r: { won: boolean; peakDanger: number }, run?: RunEco): ItemId[] {
  meta.coinsShot += t.coinsShot;
  meta.powersSeen = (meta.powersSeen ?? 0) | t.powerTypes;
  const stage = r.won ? level.index + 1 : 0;
  const value: Record<string, number> = {
    snakeCharmer: +(r.won && level.bossFight?.kind === 'serpent'),
    bossBreaker: +(r.won && level.bossFight?.kind === 'idol'),
    extraLife: stage,
    luckyColor: Math.max(...t.colourPops),
    // combo counts the chained pops after the first, so 3 = a chain of 4 pops
    comboKing: t.maxCombo + 1,
    daredevil: +(r.won && r.peakDanger > 0.9),
    lightningRod: t.chokes,
    scavenger: meta.coinsShot,
    rewinder: t.powers,
    doubleWild: t.wilds,
    aceHunter: run?.aces ?? 0,
    headStart: +(r.won && r.peakDanger < 0.5),
    opener: powerTypesSeen(meta.powersSeen),
    secondWind: t.cracks,
    coinRush: run?.earned ?? 0,
    // Runs saved before this was tracked (undefined) do not count.
    colourCut: run?.boughtBoost === false ? stage : 0,
  };
  const best = (meta.best ??= {});
  for (const u of UNLOCKS) best[u.id] = Math.max(best[u.id] ?? 0, Math.min(value[u.id] ?? 0, u.target));
  const fresh = UNLOCKS.filter((u) => (value[u.id] ?? 0) >= u.target && !meta.unlocked.includes(u.id)).map((u) => u.id);
  meta.unlocked.push(...fresh);
  return fresh;
}

// Unlocks: achievements that add items to the Expedition shop pool, Binding of Isaac style.
// A LevelTracker is fed each step's events (the same way in the game and the simulator);
// after the level, checkUnlocks() compares it and lifetime progress against the rules.

import { type GameEvent, Power } from './game';
import { type ItemId, STARTER_ITEMS } from './items';
import type { Level } from './levelgen';

export interface MetaProgress {
  unlocked: ItemId[];
  /** Lifetime counters. */
  coinsShot: number;
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
  feed(events: readonly GameEvent[]) {
    for (const e of events) {
      if (e.type === 'pop') {
        for (const b of e.balls) this.colourPops[b.c] = (this.colourPops[b.c] ?? 0) + 1;
        this.maxCombo = Math.max(this.maxCombo, e.combo);
      } else if (e.type === 'choke') this.chokes++;
      else if (e.type === 'power') {
        this.powers++;
        if (e.power === Power.Wild) this.wilds++;
      }
      else if (e.type === 'coinGet') this.coinsShot++;
    }
  }
}

export interface UnlockRule {
  id: ItemId;
  /** Shown on the collection screen while locked. */
  hint: string;
}

export const UNLOCKS: UnlockRule[] = [
  { id: 'snakeCharmer', hint: 'Beat a serpent' },
  { id: 'bossBreaker', hint: 'Beat a boss' },
  { id: 'extraLife', hint: 'Reach world 3' },
  { id: 'luckyColor', hint: 'Pop 50 marbles of one colour in one level' },
  { id: 'comboKing', hint: 'Make a combo chain of 4 pops' },
  { id: 'daredevil', hint: 'Win a level with the chain past 90% of the track' },
  { id: 'lightningRod', hint: 'Choke a serpent 6 times in one fight' },
  { id: 'scavenger', hint: 'Shoot 10 floating coins' },
  { id: 'rewinder', hint: 'Trigger 8 power-ups in one level' },
  { id: 'doubleWild', hint: 'Use 3 Wild power-ups in one level' },
];

/** After a level: adds any newly earned unlocks to `meta` and returns them. */
export function checkUnlocks(meta: MetaProgress, t: LevelTracker, level: Level, r: { won: boolean; peakDanger: number }): ItemId[] {
  meta.coinsShot += t.coinsShot;
  const earned: Record<string, boolean> = {
    snakeCharmer: r.won && level.bossFight?.kind === 'serpent',
    bossBreaker: r.won && level.bossFight?.kind === 'idol',
    extraLife: r.won && level.index >= 19,
    luckyColor: Math.max(...t.colourPops) >= 50,
    // combo counts the chained pops after the first, so 3 = a chain of 4 pops
    comboKing: t.maxCombo >= 3,
    daredevil: r.won && r.peakDanger > 0.9,
    lightningRod: t.chokes >= 6,
    scavenger: meta.coinsShot >= 10,
    rewinder: t.powers >= 8,
    doubleWild: t.wilds >= 3,
  };
  const fresh = UNLOCKS.filter((u) => earned[u.id] && !meta.unlocked.includes(u.id)).map((u) => u.id);
  meta.unlocked.push(...fresh);
  return fresh;
}

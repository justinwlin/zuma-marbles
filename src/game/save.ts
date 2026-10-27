// Persistence: campaign progress, settings, and a mid-level snapshot so closing
// the tab (or the PWA being killed on a phone) resumes exactly where you were.

import type { GameState } from '../sim/game';

export interface Settings {
  sfx: number;
  music: number;
  haptics: boolean;
  reduceMotion: boolean;
  colorblind: boolean;
  guide: boolean;
  /** Touch aiming: 'drag' = drag to aim, release to fire; 'tap' = tap fires at point. */
  touchAim: 'drag' | 'tap';
  /** Nudge shots into the previewed slot (±3.5°). */
  assist: boolean;
}

export interface LevelRecord {
  score: number;
  stars: number;
  seconds: number;
}

export interface SaveData {
  v: 1;
  campaignSeed: string;
  /** Highest level index unlocked (0-based). */
  unlocked: number;
  best: Record<number, LevelRecord>;
  totalScore: number;
  settings: Settings;
  /** In-progress level. */
  snapshot: { levelIndex: number; state: GameState; savedAt: number } | null;
  tutorialSeen: boolean;
  /** Bitmask of power-up types the player has been told about. */
  seenPowers?: number;
}

const KEY = 'zuma-marbles.save.v1';

export const DEFAULT_SETTINGS: Settings = {
  sfx: 0.8,
  music: 0.4,
  haptics: true,
  reduceMotion: false,
  colorblind: false,
  guide: true,
  touchAim: 'drag',
  assist: true,
};

export function randomSeed(): string {
  const words = ['jade', 'ember', 'orbit', 'lotus', 'comet', 'quartz', 'tide', 'nova', 'aztec', 'coral', 'ivory', 'zephyr'];
  const w = words[Math.floor(Math.random() * words.length)];
  return `${w}-${Math.floor(Math.random() * 9000 + 1000)}`;
}

export function freshSave(seed = randomSeed()): SaveData {
  return { v: 1, campaignSeed: seed, unlocked: 0, best: {}, totalScore: 0, settings: { ...DEFAULT_SETTINGS }, snapshot: null, tutorialSeen: false };
}

export function loadSave(storage: Storage = localStorage): SaveData {
  try {
    const raw = storage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw) as SaveData;
      if (d && d.v === 1 && typeof d.campaignSeed === 'string') {
        d.settings = { ...DEFAULT_SETTINGS, ...d.settings };
        d.best ??= {};
        return d;
      }
    }
  } catch {
    /* corrupted save → start fresh */
  }
  return freshSave();
}

export function writeSave(d: SaveData, storage: Storage = localStorage) {
  try {
    storage.setItem(KEY, JSON.stringify(d));
  } catch {
    /* quota / private mode: ignore */
  }
}

/** Stars: clear = 1; never let the chain past 70% = 2; past 45% = 3. */
export function starsFor(peakDanger: number): number {
  return peakDanger < 0.45 ? 3 : peakDanger < 0.7 ? 2 : 1;
}

/** Shareable level code: "<campaignSeed>/<level number>". */
export function levelCode(seed: string, index: number) {
  return `${seed}/${index + 1}`;
}

export function parseLevelCode(code: string): { seed: string; index: number } | null {
  const m = code.trim().match(/^([\w-]{1,40})\/(\d{1,6})$/);
  if (!m) return null;
  return { seed: m[1], index: Math.max(0, Number(m[2]) - 1) };
}

// Persistence: campaign progress, settings, and a mid-level snapshot so closing
// the tab (or the PWA being killed on a phone) resumes exactly where you were.

import type { GameState } from '../sim/game';
import { GEN_VERSION } from '../sim/levelgen';
import type { CharacterId } from './characters';

export interface Settings {
  sfx: number;
  music: number;
  haptics: boolean;
  reduceMotion: boolean;
  colorblind: boolean;
  guide: boolean;
  /**
   * Touch aiming: 'drag' = drag to aim, release to fire; 'aimtap' = drag to aim, tap to fire
   * (a real tap, so iPhones give a haptic tick per shot); 'tap' = tap fires at the point.
   */
  touchAim: 'drag' | 'aimtap' | 'tap';
  /** Nudge shots into the previewed slot (±3.5°). */
  assist: boolean;
  /** Press and hold (without dragging) to keep shooting. */
  holdFire: boolean;
  /** Launcher character. */
  character: CharacterId;
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
  /** Progress of campaigns you switched away from, keyed by campaign seed. */
  archive?: Record<string, CampaignProgress>;
  /** Level generator version the snapshots were made with. */
  gen?: number;
  /** Endless run in progress (one life; score carries across stages). */
  endless?: EndlessRun | null;
  endlessBest?: { score: number; stage: number };
  /** Best daily run, per day ("YYYYMMDD"). Only today's is kept. */
  dailyBest?: { day: string; score: number; stage: number };
}

export interface EndlessRun {
  seed: string;
  daily: boolean;
  /** Stage index (0-based) currently being played. */
  stage: number;
  /** Score banked from cleared stages. */
  runScore: number;
  snapshot: GameState | null;
}

/** Endless seeds: a daily one everybody shares, or a random one. */
export function dailySeed(d = new Date()): string {
  return `daily-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}
export function endlessSeed(): string {
  return `endless-${Math.floor(Math.random() * 1e8).toString(36)}`;
}

export interface CampaignProgress {
  unlocked: number;
  best: Record<number, LevelRecord>;
  totalScore: number;
  snapshot: SaveData['snapshot'];
}

/** Switch to another campaign, keeping each campaign's progress (and in-progress level). */
export function switchCampaign(d: SaveData, seed: string): SaveData {
  if (seed === d.campaignSeed) return d;
  const archive = { ...(d.archive ?? {}) };
  archive[d.campaignSeed] = { unlocked: d.unlocked, best: d.best, totalScore: d.totalScore, snapshot: d.snapshot };
  const next = archive[seed] ?? { unlocked: 0, best: {}, totalScore: 0, snapshot: null };
  delete archive[seed];
  return { ...d, campaignSeed: seed, unlocked: next.unlocked, best: next.best, totalScore: next.totalScore, snapshot: next.snapshot, archive };
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
  holdFire: true,
  character: 'frog',
};

export function randomSeed(): string {
  const words = ['jade', 'ember', 'orbit', 'lotus', 'comet', 'quartz', 'tide', 'nova', 'aztec', 'coral', 'ivory', 'zephyr'];
  const w = words[Math.floor(Math.random() * words.length)];
  return `${w}-${Math.floor(Math.random() * 9000 + 1000)}`;
}

export function freshSave(seed = randomSeed()): SaveData {
  return { v: 1, campaignSeed: seed, unlocked: 0, best: {}, totalScore: 0, settings: { ...DEFAULT_SETTINGS }, snapshot: null, tutorialSeen: false, gen: GEN_VERSION };
}

export function loadSave(storage: Storage = localStorage): SaveData {
  try {
    const raw = storage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw) as SaveData;
      if (d && d.v === 1 && typeof d.campaignSeed === 'string') {
        d.settings = { ...DEFAULT_SETTINGS, ...d.settings };
        d.best ??= {};
        migrateGen(d);
        return d;
      }
    }
  } catch {
    /* corrupted save → start fresh */
  }
  return freshSave();
}

/** Set when loading a save made with an older level generator (show a one-time notice). */
export let levelsUpdated = false;

/**
 * New generator → the same level numbers now have different tracks. Progress (unlocked
 * level, stars) is kept; mid-level snapshots belong to the old tracks, so they are dropped.
 */
export function migrateGen(d: SaveData) {
  if ((d.gen ?? 1) >= GEN_VERSION) return;
  d.snapshot = null;
  for (const k of Object.keys(d.archive ?? {})) d.archive![k].snapshot = null;
  d.endless = null;
  d.gen = GEN_VERSION;
  levelsUpdated = true;
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

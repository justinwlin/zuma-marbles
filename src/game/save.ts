// Persistence: campaign progress, settings, and a mid-level snapshot so closing
// the tab (or the PWA being killed on a phone) resumes exactly where you were.

import type { MetaProgress } from '../sim/achievements';
import type { Receipt, RunEco } from '../sim/economy';
import type { GameState } from '../sim/game';
import type { ItemId } from '../sim/items';
import { GEN_VERSION, isLargeCampaign, LARGE_PREFIX } from '../sim/levelgen';
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
   * (a real tap, so iPhones give a haptic tick per shot); 'tap' = tap fires at the point;
   * 'pad' = trackpad: drag anywhere to move a crosshair (relative, finer), tap to fire.
   */
  touchAim: 'drag' | 'aimtap' | 'tap' | 'pad';
  /** Nudge shots into the previewed slot (±3.5°). */
  assist: boolean;
  /** Press and hold (without dragging) to keep shooting. */
  holdFire: boolean;
  /** Launcher character. */
  character: CharacterId;
  /** Accessibility: chains roll at 75% speed. */
  relaxed: boolean;
  /** Swap button on the left (portrait phones), cancel target on the right. */
  leftHanded: boolean;
  /** Larger menu text and HUD buttons. */
  largeUi: boolean;
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
  /** Expedition unlocks and lifetime progress. */
  meta?: MetaProgress;
}

export interface EndlessRun {
  seed: string;
  daily: boolean;
  /** Stage index (0-based) currently being played. */
  stage: number;
  /** Score banked from cleared stages. */
  runScore: number;
  snapshot: GameState | null;
  /** Coins and items for this run. */
  eco?: RunEco;
  /** A free pick or the shop still to show before `stage` starts (survives closing the app). */
  pending?: 'mini' | 'boss' | 'shop' | 'retry' | 'next' | null;
  /** The stage just cleared, for the between-stage page. */
  last?: StageSummary | null;
  /** Lost the current stage: its score (counted if the run ends here). */
  lostScore?: number;
  /** Paid retries so far this run. */
  retries?: number;
  /** The serpent's trader screen, drawn once so closing the app can't re-roll it. */
  trader?: TraderVisit | null;
}

/** What the between-stage page shows about the stage just cleared. */
export interface StageSummary {
  stage: number;
  score: number;
  seconds: number;
  ace: boolean;
  coins: number;
  coinsBy: Record<string, number>;
}

/** One visit to the trader after a serpent: the free boosts, what's for sale, and what was taken. */
export interface TraderVisit {
  free: ItemId[];
  buy: ItemId[];
  /** The free boost taken (null = not yet). */
  took: ItemId | null;
  bought: ItemId[];
  /** One per item in `bought`, so a purchase can be undone until Continue (missing in older saves). */
  receipts?: Receipt[];
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

/**
 * Phones start on large marbles: a save nobody has played yet (and that never switched
 * marble size) moves to the large-marble version of its campaign on small screens.
 */
export function largeOnPhones(d: SaveData, smallScreen: boolean): SaveData {
  const untouched = d.unlocked === 0 && !Object.keys(d.best).length && !d.totalScore && !d.archive && !d.endless && !d.endlessBest && !d.snapshot;
  if (!smallScreen || !untouched || isLargeCampaign(d.campaignSeed)) return d;
  return { ...d, campaignSeed: LARGE_PREFIX + d.campaignSeed };
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
  relaxed: false,
  leftHanded: false,
  largeUi: false,
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
      // Colour Scout was replaced by Brakes: owned or unlocked Scouts become Brakes.
      const d = JSON.parse(raw.replace(/"scout"/g, '"brakes"')) as SaveData;
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

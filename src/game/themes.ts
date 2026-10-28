// World themes: every 10 levels (one boss cycle) gets its own look and music key, so
// climbing feels like travelling. Purely cosmetic: nothing here touches the sim.

import type { MusicKey } from './audio';

/** Background decoration drawn into the cached board background. */
export type Decor = 'fireflies' | 'sand' | 'snow' | 'embers' | 'bubbles' | 'grid';

export interface WorldTheme {
  name: string;
  /** Base hue for the backdrop, board panel and track glow. */
  hue: number;
  decor: Decor;
  key: MusicKey;
}

export const WORLD_THEMES: WorldTheme[] = [
  { name: 'Jungle Temple', hue: 140, decor: 'fireflies', key: { root: 220, scale: [0, 2, 4, 7, 9], prog: [0, 5, -3, 7] } },
  { name: 'Desert Ruins', hue: 32, decor: 'sand', key: { root: 196, scale: [0, 1, 4, 7, 8], prog: [0, 1, 0, -2] } },
  { name: 'Ice Cavern', hue: 195, decor: 'snow', key: { root: 233, scale: [0, 2, 3, 7, 8], prog: [0, -4, -2, -5] } },
  { name: 'Volcano', hue: 8, decor: 'embers', key: { root: 175, scale: [0, 3, 7, 8, 11], prog: [0, -4, -5, -1] } },
  { name: 'Deep Sea', hue: 215, decor: 'bubbles', key: { root: 185, scale: [0, 2, 4, 6, 9], prog: [0, 2, 0, -5] } },
  { name: 'Neon City', hue: 290, decor: 'grid', key: { root: 208, scale: [0, 2, 3, 7, 9], prog: [0, -2, -4, -2] } },
];

/** Worlds are 10 levels long (levels 1–10 are world 1, and so on), cycling through the themes. */
export function worldIndex(levelIndex: number): number {
  return Math.floor(levelIndex / 10);
}

export function themeFor(levelIndex: number): WorldTheme {
  return WORLD_THEMES[worldIndex(levelIndex) % WORLD_THEMES.length];
}

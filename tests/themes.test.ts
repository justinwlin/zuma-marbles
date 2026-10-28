import { describe, expect, it } from 'vitest';
import { themeFor, WORLD_THEMES, worldIndex } from '../src/game/themes';

describe('world themes', () => {
  it('one theme per 10 levels, the boss level belongs to its world, and they cycle', () => {
    expect(worldIndex(0)).toBe(0);
    expect(worldIndex(9)).toBe(0);
    expect(worldIndex(10)).toBe(1);
    expect(themeFor(9)).toBe(themeFor(0));
    expect(themeFor(10)).not.toBe(themeFor(0));
    expect(themeFor(10 * WORLD_THEMES.length)).toBe(themeFor(0));
  });

  it('every theme has a 5-note scale and a 4-chord progression (pops on the beat rely on it)', () => {
    for (const t of WORLD_THEMES) {
      expect(t.key.scale).toHaveLength(5);
      expect(t.key.prog).toHaveLength(4);
    }
  });
});

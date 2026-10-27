// Balance report: bot presets play generated levels headlessly.
// Usage: npm run sim -- [campaignSeed] [levels] [preset...]
import { generateLevel } from '../src/sim/levelgen';
import { createGame } from '../src/sim/game';
import { BOT_PRESETS, playLevel } from '../src/sim/bot';

const seed = process.argv[2] ?? 'alpha';
const levels = Number(process.argv[3] ?? 10);
const presets = process.argv.slice(4).length ? process.argv.slice(4) : Object.keys(BOT_PRESETS);

console.log(`campaign=${seed}`);
for (let i = 0; i < levels; i++) {
  const lvl = generateLevel(seed, i);
  const len = Math.round(lvl.tracks[0].length - lvl.tracks[0].visibleFrom);
  const row = [`L${String(i + 1).padStart(2)} ${lvl.family.padEnd(10)} len=${len} col=${lvl.colors} v=${lvl.speed.toFixed(0)} tries=${lvl.attempts}`];
  for (const p of presets) {
    const t0 = performance.now();
    const r = playLevel(createGame(lvl), lvl, BOT_PRESETS[p]);
    const ms = performance.now() - t0;
    row.push(`${p}:${r.outcome[0].toUpperCase()} ${r.seconds.toFixed(0)}s peak=${(r.peakDanger * 100).toFixed(0)}% combo=${r.stats.maxCombo} gap=${r.stats.gapShots} pw=${r.stats.powers} (${ms.toFixed(0)}ms)`);
  }
  console.log(row.join(' | '));
}

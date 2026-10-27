// Win-rate table across many campaigns. Usage: npx tsx scripts/balance.ts [campaigns] [levels...]
import { generateLevel } from '../src/sim/levelgen';
import { createGame } from '../src/sim/game';
import { BOT_PRESETS, playLevel } from '../src/sim/bot';

const N = Number(process.argv[2] ?? 8);
const levels = process.argv.slice(3).length ? process.argv.slice(3).map(Number) : [0, 1, 2, 4, 7, 10, 15, 20, 30, 50];
console.log('level | ' + Object.keys(BOT_PRESETS).map((p) => `${p} win% / avg s`).join(' | '));
for (const L of levels) {
  const cells: string[] = [];
  for (const [name, opts] of Object.entries(BOT_PRESETS)) {
    let wins = 0;
    let secs = 0;
    for (let c = 0; c < N; c++) {
      const lvl = generateLevel(`${process.env.PREFIX ?? ''}bal-${c}`, L);
      const r = playLevel(createGame(lvl), lvl, opts);
      if (r.outcome === 'won') wins++;
      secs += r.seconds;
    }
    cells.push(`${name} ${String(Math.round((wins / N) * 100)).padStart(3)}% / ${(secs / N).toFixed(0)}s`);
  }
  console.log(`L${String(L + 1).padStart(3)} | ${cells.join(' | ')}`);
}

// Level generator report: families, twin/boss/mutator mix, attempts, lengths, timing.
// Usage: npx tsx scripts/gen-report.ts [prefix] [count]
import { __GEN, generateLevel, validateLevel, worldFor, type TrackFamily } from '../src/sim/levelgen';
import { Rng } from '../src/sim/rng';

const prefix = process.argv[2] ?? '';
const N = Number(process.argv[3] ?? 200);
const fam: Record<string, number> = {};
let twin = 0;
let off = 0;
let fallbacks = 0;
let attempts = 0;
const t0 = performance.now();
let worst = 0;
for (let c = 0; c < 4; c++) {
  for (let i = 0; i < N / 4; i++) {
    const s = performance.now();
    const l = generateLevel(`${prefix}rep-${c}`, i);
    worst = Math.max(worst, performance.now() - s);
    fam[l.family] = (fam[l.family] ?? 0) + 1;
    if (l.tracks.length > 1) twin++;
    if (l.offCentre) off++;
    if (l.attempts >= 90) fallbacks++;
    attempts += l.attempts;
  }
}
console.log(`${N} levels in ${(performance.now() - t0).toFixed(0)} ms (worst ${worst.toFixed(0)} ms), avg attempts ${(attempts / N).toFixed(1)}, fallbacks ${fallbacks}`);
console.log(`twin ${twin}, off-centre ${off}`);
console.log(fam);
// Per-family validity rate.
const world = worldFor(`${prefix}x`);
for (const f of Object.keys(__GEN) as TrackFamily[]) {
  let ok = 0;
  const rng = new Rng(123);
  const lens: number[] = [];
  for (let k = 0; k < 60; k++) {
    const cand = __GEN[f](rng, { index: 10, off: k % 2 === 0 });
    const r = validateLevel(cand.paths, cand.launcher, cand.paths.length > 1, { w: world.w, h: world.h }, (cand as { crossings?: { x: number; y: number }[] }).crossings);
    if (r) {
      ok++;
      lens.push(Math.round(r.reduce((a, b) => a + b, 0) / r.length));
    }
  }
  lens.sort((a, b) => a - b);
  console.log(`${f.padEnd(15)} valid ${String(ok).padStart(2)}/60  len ${lens[0] ?? '-'}..${lens[lens.length - 1] ?? '-'}`);
}

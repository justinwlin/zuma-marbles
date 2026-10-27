// Contact sheet of generator candidates (green = valid, red = rejected) for visual review.
// Usage: npx tsx scripts/gen-sheet.ts out.png [family,...] [xl]
import { chromium } from 'playwright';
import { __GEN, validateLevel, WORLD_W, WORLD_H, LARGE_SCALE, type TrackFamily } from '../src/sim/levelgen';
import { Rng } from '../src/sim/rng';
import { browserPath } from './browser';

const out = process.argv[2] ?? 'gen-sheet.png';
const fams = (process.argv[3] ? process.argv[3].split(',') : Object.keys(__GEN)) as TrackFamily[];
const xl = process.argv[4] === 'xl';
const W = xl ? Math.round(WORLD_W / LARGE_SCALE) : WORLD_W;
const H = xl ? Math.round(WORLD_H / LARGE_SCALE) : WORLD_H;
const PER = 6;
let svgs = '';
for (const f of fams) {
  const rng = new Rng(7);
  for (let k = 0; k < PER; k++) {
    const cand = __GEN[f](rng, { index: 10, off: k % 2 === 1 });
    const ok = validateLevel(cand.paths, cand.launcher, cand.paths.length > 1, { w: W, h: H }, (cand as { crossings?: { x: number; y: number }[] }).crossings);
    const cols = ['#4f8', '#4cf'];
    const paths = cand.paths
      .map((p, i) => `<polyline fill="none" stroke="${ok ? cols[i] : '#f55'}" stroke-width="36" stroke-opacity="0.35" stroke-linejoin="round" points="${p.map((q) => `${q.x.toFixed(0)},${q.y.toFixed(0)}`).join(' ')}"/>`)
      .join('');
    svgs += `<div style="position:relative"><svg viewBox="-20 -20 ${W + 40} ${H + 40}" width="320" style="background:#111"><rect x="0" y="0" width="${W}" height="${H}" fill="none" stroke="#555"/>${paths}<circle cx="${cand.launcher.x}" cy="${cand.launcher.y}" r="92" fill="none" stroke="#ff0" stroke-dasharray="6 6"/><circle cx="${cand.launcher.x}" cy="${cand.launcher.y}" r="30" fill="#ff0"/></svg><span style="position:absolute;left:6px;top:4px;color:#fff;font:12px sans-serif">${f} ${ok ? ok.map((l) => Math.round(l)).join('/') : '✗'}</span></div>`;
  }
}
const browser = await chromium.launch({ executablePath: browserPath() });
const page = await browser.newPage({ viewport: { width: 320 * PER, height: 400 } });
await page.setContent(`<body style="margin:0;background:#000;display:grid;grid-template-columns:repeat(${PER},320px);gap:2px">${svgs}</body>`);
await page.waitForTimeout(200);
await page.screenshot({ path: out, fullPage: true });
await browser.close();

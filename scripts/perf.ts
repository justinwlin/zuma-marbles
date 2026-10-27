// Render performance under CPU throttling (simulates a mid-range phone).
// Usage: npx tsx scripts/perf.ts [url] [throttle=4]
import { chromium } from 'playwright';
import { browserPath } from './browser';

const url = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:5173/';
const rate = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 4);
const browser = await chromium.launch({ executablePath: browserPath() });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
await page.goto(url);
await page.waitForTimeout(500);
const cdp = await ctx.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate });
const ev = (js: string) => page.evaluate(`(() => { const z = window.__zuma; ${js} })()`);
await ev('z.start(5)');
await page.waitForTimeout(500);
// Long chain with power-ups, plus heavy particles.
await ev(`z.setup(Array.from({length: 110}, (_, i) => (i * 7) % 5), { headGap: 300, power: [50, 2] }); z.state().chains[0].stopT = 0;`);
const results: Record<string, { fps: number; draw: number }> = {};
for (const [name, js] of [
  ['idle chain', ''],
  ['particle storm', 'z.stress(400)'],
] as const) {
  if (js) await ev(js);
  await page.waitForTimeout(1500);
  results[name] = (await ev('return { fps: z.fps(), draw: z.drawMs() }')) as { fps: number; draw: number };
  if (js) for (let i = 0; i < 3; i++) (await ev(js), await page.waitForTimeout(300));
  if (js) results[name] = (await ev('return { fps: z.fps(), draw: z.drawMs() }')) as { fps: number; draw: number };
}
console.log('breakdown ms', JSON.stringify(await ev('const t = z.timings(); return Object.fromEntries(Object.entries(t).map(([k, v]) => [k, +v.toFixed(2)]))')));
for (const [k, v] of Object.entries(results)) console.log(`${k.padEnd(16)} fps ${v.fps.toFixed(0).padStart(3)}  draw ${v.draw.toFixed(2)} ms  (cpu ×${rate})`);
await browser.close();

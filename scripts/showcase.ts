// Captures frame sequences of key feel moments for visual review.
// Usage: npx tsx scripts/showcase.ts [phone|desktop]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { browserPath } from './browser';

const prof = process.argv[2] ?? 'phone';
const OUT = 'e2e-out/showcase';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: browserPath() });
const ctx = await browser.newContext(prof === 'phone' ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto(process.argv[3] ?? 'http://localhost:5173/');
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForTimeout(800);
type Any = any; // eslint-disable-line
const z = (fn: string) => page.evaluate(`(() => { const z = window.__zuma; ${fn} })()`) as Promise<Any>;
const snap = async (name: string) => page.screenshot({ path: `${OUT}/${prof}-${name}.png` });

await z('z.start(0)');
await page.waitForTimeout(500);
// Combo: G R R B B R G — shoot B into the B pair → BBB pops → R magnet → RRR combo.
await z(`z.setup([3,1,1,2,2,1,3,0,0,4], { headGap: 700 }); z.state().gun.cur = 2;`);
const b = await z('return z.ballScreen(4)');
await page.mouse.move(b.x, b.y);
await page.waitForTimeout(200);
await z(`const s = z.state(); const p = z.level().launcher; const t = z.ballScreen(4); const L = z.layout();
  const wx = L.portrait ? (t.y - L.f)/L.scale : (t.x - L.e)/L.scale; const wy = L.portrait ? (L.e - t.x)/L.scale : (t.y - L.f)/L.scale; z.fireAt(wx, wy);`);
for (const ms of [60, 120, 160, 140, 120, 150, 200, 250]) {
  await page.waitForTimeout(ms);
  await snap(`combo-${String(Date.now()).slice(-5)}`);
}
// Bomb
await page.waitForTimeout(800);
await z(`z.setup([0,2,3,1,1,0,2,3,0,4,4,2], { headGap: 900, power: [4, 1] }); z.state().gun.cur = 1;`);
await page.waitForTimeout(100);
await z(`const t = z.ballScreen(3); const L = z.layout();
  const wx = L.portrait ? (t.y - L.f)/L.scale : (t.x - L.e)/L.scale; const wy = L.portrait ? (L.e - t.x)/L.scale : (t.y - L.f)/L.scale; z.fireAt(wx, wy);`);
for (const ms of [250, 90, 90, 120, 200]) {
  await page.waitForTimeout(ms);
  await snap(`bomb-${String(Date.now()).slice(-5)}`);
}
// Danger: chain right by the skull
await z(`z.setup([0,1,2,3,0,1,2,3,0,1,2,3,0,1], { headGap: 60, power: [6, 2] });`);
await page.waitForTimeout(700);
await snap('danger');
// Win → result
await z(`const s = z.state(); s.barFull = true; s.balls = []; s.spawning = false;`);
await page.waitForTimeout(700);
await snap('win');
await page.waitForTimeout(2300);
await snap('result');
await page.locator('[data-a=levels]').click();
await page.waitForTimeout(400);
await snap('levels');
await page.locator('[data-a=back]').click();
await page.locator('[data-a=settings]').click();
await page.waitForTimeout(300);
await snap('settings');
await browser.close();
console.log('saved to', OUT);

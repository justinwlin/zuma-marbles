// Screenshots of boss fights, coins, wild/scorpion, the end-of-level sweep and trackpad aiming.
// Usage: npx tsx scripts/feature-shots.ts [baseUrl] → e2e-out/feat-<profile>-<name>.png
import { chromium, type BrowserContextOptions, type Page } from 'playwright';
import { mkdirSync } from 'node:fs';
import { browserPath } from './browser';

const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:5173/';
mkdirSync('e2e-out', { recursive: true });
const profiles: Record<string, BrowserContextOptions> = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
};
const browser = await chromium.launch({ executablePath: browserPath() });

async function fresh(page: Page, settings: Record<string, unknown> = {}) {
  await page.goto(base);
  await page.evaluate((settings) => {
    localStorage.clear();
    localStorage.setItem('zuma-marbles.save.v1', JSON.stringify({ v: 1, gen: 4, campaignSeed: 'feat', unlocked: 30, best: {}, totalScore: 0, settings, snapshot: null, tutorialSeen: true, seenPowers: 0x1ff }));
  }, settings);
  await page.reload();
  await page.waitForFunction(() => (window as any).__zuma?.mode === 'title');
}

for (const [name, opts] of Object.entries(profiles)) {
  const page = await (await browser.newContext(opts)).newPage();
  const shot = (s: string) => page.screenshot({ path: `e2e-out/feat-${name}-${s}.png` });
  await fresh(page);

  // Boss fight
  await page.evaluate(() => (window as any).__zuma.load('feat', 9));
  await page.waitForTimeout(1200);
  await shot('boss-banner');
  await page.waitForTimeout(6500);
  await shot('boss-fight');
  await page.evaluate(() => {
    const z = (window as any).__zuma;
    const s = z.state();
    s.boss.hp = Math.floor(s.boss.max * 0.4);
    s.gun.w = 1;
    s.coinT = 0.01;
  });
  await page.waitForTimeout(1600);
  await shot('boss-angry');
  await page.evaluate(() => {
    const s = (window as any).__zuma.state();
    s.boss.hp = 0;
  });
  await page.waitForTimeout(450);
  await shot('boss-down');
  await page.waitForTimeout(4500);
  await shot('boss-result');

  // Normal level: coin, wild marble, scorpion
  await page.evaluate(() => (window as any).__zuma.load('feat', 6));
  await page.waitForTimeout(6000);
  await page.evaluate(() => {
    const z = (window as any).__zuma;
    const s = z.state();
    s.coinT = 0.01;
    s.gun.w = 3;
    const L = z.level().length;
    s.scorps.push({ ci: 0, s: L + 40, left: 10 });
  });
  await page.waitForTimeout(1000);
  await shot('coin-wild-scorpion');

  // End-of-level light sweep and result
  await page.evaluate(() => {
    const s = (window as any).__zuma.state();
    s.barFull = true;
    s.spawning = false;
    s.chains.forEach((c: any) => (c.balls = []));
  });
  await page.waitForTimeout(700);
  await shot('sweep');
  await page.waitForTimeout(4000);
  await shot('result');

  if (name === 'phone') {
    await fresh(page, { touchAim: 'pad' });
    await page.evaluate(() => (window as any).__zuma.load('feat', 3));
    await page.waitForTimeout(4000);
    // Drag from the lower part of the screen: the crosshair moves by the finger's motion.
    const cdp = await page.context().newCDPSession(page);
    const touch = async (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number) =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
    await touch('touchStart', 200, 700);
    for (let i = 1; i <= 10; i++) await touch('touchMove', 200 + i * 6, 700 - i * 8);
    await page.waitForTimeout(300);
    await shot('trackpad');
    await touch('touchEnd', 260, 620);
    const v = await page.evaluate(() => (window as any).__zuma.view());
    console.log('trackpad cursor', JSON.stringify(v.cursor));
  }
}
await browser.close();
console.log('done');

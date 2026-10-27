// Screenshot every menu screen on a phone and a desktop for UI review.
// Usage: npx tsx scripts/ui-shots.ts [baseUrl] → e2e-out/ui-<profile>-<screen>.png
import { chromium, type BrowserContextOptions } from 'playwright';
import { mkdirSync } from 'node:fs';
import { browserPath } from './browser';

const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:5173/';
mkdirSync('e2e-out', { recursive: true });
const profiles: Record<string, BrowserContextOptions> = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
};
const browser = await chromium.launch({ executablePath: browserPath() });
for (const [name, opts] of Object.entries(profiles)) {
  const page = await (await browser.newContext(opts)).newPage();
  await page.goto(base);
  await page.evaluate(() => {
    localStorage.clear();
    const best: Record<number, unknown> = {};
    for (let i = 0; i < 11; i++) best[i] = { score: 1000 + i * 100, stars: (i % 3) + 1, seconds: 60 };
    localStorage.setItem('zuma-marbles.save.v1', JSON.stringify({ v: 1, gen: 2, campaignSeed: 'ui-demo', unlocked: 11, best, totalScore: 15000, settings: {}, snapshot: null, tutorialSeen: true, endlessBest: { score: 12345, stage: 7 } }));
  });
  await page.reload();
  await page.waitForFunction(() => (window as any).__zuma?.mode === 'title');
  await page.waitForTimeout(1200);
  const shot = (s: string) => page.screenshot({ path: `e2e-out/ui-${name}-${s}.png` });
  await shot('title');
  await page.locator('[data-a=levels]').click();
  await page.waitForTimeout(300);
  await shot('levels');
  await page.locator('[data-a=back]').click();
  await page.locator('[data-a=endless]').click();
  await page.waitForTimeout(300);
  await shot('endless');
  await page.locator('[data-a=back]').click();
  await page.locator('[data-a=settings]').first().click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `e2e-out/ui-${name}-settings.png`, fullPage: true });
  await page.locator('[data-a=back]').click();
  await page.locator('[data-a=help]').click();
  await page.waitForTimeout(300);
  await shot('help');
  await page.locator('[data-a=back]').click();
  await page.locator('[data-a=play]').click();
  await page.waitForTimeout(3500);
  await shot('play');
  await page.locator('#btn-pause').click();
  await page.waitForTimeout(300);
  await shot('pause');
  await page.locator('[data-a=resume]').click();
  await page.evaluate(() => {
    const s = (window as any).__zuma.state();
    s.score = 99999;
  });
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const s = (window as any).__zuma.state();
    s.chains.forEach((c: any) => (c.balls = []));
  });
  await page.waitForTimeout(3200);
  await shot('result');
  // A loss, for the tip.
  await page.locator('[data-a=next]').click();
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    const z = (window as any).__zuma;
    const L = z.level().length;
    const c = z.state().chains[0];
    c.balls.forEach((b: any, i: number, a: any[]) => (b.s = L + 2 - (a.length - 1 - i) * 36));
  });
  await page.waitForTimeout(3500);
  await shot('lost');
}
await browser.close();

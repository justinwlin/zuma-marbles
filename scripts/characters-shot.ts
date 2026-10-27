// Visual check of every launcher character, picked through the real Settings UI.
// Usage: npx tsx scripts/characters-shot.ts  (dev server on :5173) → e2e-out/char-*.png
import { chromium } from 'playwright';
import { browserPath } from './browser';
const browser = await chromium.launch({ executablePath: browserPath() });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://localhost:5173/');
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForTimeout(600);
await page.locator('[data-a=play]').click();
await page.waitForTimeout(3500);
await page.locator('#btn-settings').click();
await page.waitForTimeout(300);
await page.screenshot({ path: 'e2e-out/settings.png' });
for (const id of ['frog', 'calico', 'fox', 'penguin']) {
  await page.locator(`[data-a=char][data-v=${id}]`).click();
  await page.locator('[data-screen=settings] [data-a=back]').click();
  await page.waitForTimeout(400);
  const c = await page.evaluate(() => { const z = (window as unknown as { __zuma: any }).__zuma; const l = z.level().launcher; return z.worldToScreen(l.x, l.y); });
  await page.screenshot({ path: `e2e-out/char-${id}.png`, clip: { x: c.x - 70, y: c.y - 70, width: 140, height: 140 } });
  console.log(id, 'mode', await page.evaluate(() => (window as unknown as { __zuma: any }).__zuma.mode), 'saved', await page.evaluate(() => (window as unknown as { __zuma: any }).__zuma.save().settings.character));
  await page.locator('#btn-settings').click();
  await page.waitForTimeout(250);
}
console.log('errors', errors);
await browser.close();

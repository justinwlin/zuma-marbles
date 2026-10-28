// Quick check: the music's bass and drum layers fade in as the chain nears the skull.
import { chromium } from 'playwright';
import { browserPath } from './browser';

const browser = await chromium.launch({ executablePath: browserPath(), args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(process.env.BASE ?? 'http://localhost:5174/');
await page.waitForFunction(() => (window as any).__zuma?.mode === 'title');
await page.mouse.click(5, 5);
await page.evaluate(() => (window as any).__zuma.load('music-check', 3));
await page.waitForTimeout(1500);
const calm = await page.evaluate(() => (window as any).__zuma.music());
await page.keyboard.press('KeyF');
let tense = calm;
for (let i = 0; i < 90 && tense.drums < 0.5; i++) {
  await page.waitForTimeout(500);
  tense = await page.evaluate(() => (window as any).__zuma.music());
}
console.log('calm', JSON.stringify(calm));
console.log('tense', JSON.stringify(tense));
console.log('errors', errors.length ? errors : 'none');
await browser.close();

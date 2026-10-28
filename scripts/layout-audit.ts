// Responsive check of every menu screen on every device profile: reports screens whose
// content overflows the viewport (sideways ever, or vertically where it should fit) and
// saves a screenshot of each. Usage: npx tsx scripts/layout-audit.ts [baseUrl] [--only=phone,desktop]
//   → e2e-out/layout/<profile>-<screen>.png
import { chromium, type BrowserContextOptions, type Page } from 'playwright';
import { mkdirSync } from 'node:fs';
import { browserPath } from './browser';

const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:5173/';
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',');
mkdirSync('e2e-out/layout', { recursive: true });

const PROFILES: Record<string, BrowserContextOptions> = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  smallPhone: { viewport: { width: 360, height: 640 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  phoneLandscape: { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  tablet: { viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  laptop: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 },
};

/** Screens that should fit without scrolling. Long reference screens (help, settings) may scroll. */
const MUST_FIT = new Set(['title', 'endless', 'pause', 'result', 'pick', 'shop', 'collection', 'goals', 'unlock', 'trader', 'stage-clear']);

interface Row {
  profile: string;
  screen: string;
  overX: number;
  overY: number;
}
const rows: Row[] = [];

async function measure(page: Page, profile: string, screen: string) {
  await page.waitForTimeout(450); // let the pop-in animation settle
  const m = await page.evaluate(() => {
    const el = document.querySelector('[data-screen]') as HTMLElement | null;
    if (!el) return null;
    // Widest / tallest descendant vs the viewport (catches cards spilling sideways too).
    let right = 0;
    for (const c of el.querySelectorAll<HTMLElement>('*')) right = Math.max(right, c.getBoundingClientRect().right);
    return { overX: Math.max(0, Math.round(right - innerWidth)), overY: Math.max(0, el.scrollHeight - el.clientHeight) };
  });
  if (!m) return;
  rows.push({ profile, screen, ...m });
  await page.screenshot({ path: `e2e-out/layout/${profile}-${screen}.png` });
}

const click = async (page: Page, sel: string) => {
  await page.locator(sel).first().click();
  await page.waitForTimeout(250);
};

const browser = await chromium.launch({ executablePath: browserPath() });
for (const [name, opts] of Object.entries(PROFILES)) {
  if (only && !only.includes(name)) continue;
  // No service worker: its first install can reload the page mid-audit.
  const page = await (await browser.newContext({ ...opts, serviceWorkers: 'block' })).newPage();
  await page.goto(base);
  await page.evaluate(() => {
    localStorage.clear();
    const best: Record<number, unknown> = {};
    for (let i = 0; i < 24; i++) best[i] = { score: 1000 + i * 100, stars: (i % 3) + 1, seconds: 60 };
    localStorage.setItem('zuma-marbles.save.v1', JSON.stringify({ v: 1, gen: 99, campaignSeed: 'layout-demo', unlocked: 24, best, totalScore: 15000, settings: {}, snapshot: null, tutorialSeen: true, endlessBest: { score: 12345, stage: 7 } }));
  });
  await page.reload();
  await page.waitForFunction(() => (window as any).__zuma?.mode === 'title');
  await page.waitForTimeout(800);
  await measure(page, name, 'title');
  await click(page, '[data-a=levels]');
  await measure(page, name, 'levels');
  await click(page, '[data-a=back]');
  await click(page, '[data-a=settings]');
  await measure(page, name, 'settings');
  await click(page, '[data-a=back]');
  await click(page, '[data-a=help]');
  await measure(page, name, 'help');
  await click(page, '[data-a=pw]');
  await measure(page, name, 'powerups');
  await click(page, '[data-a=back]');
  await click(page, '[data-a=back]');
  await click(page, '[data-a=endless]');
  await measure(page, name, 'endless');
  await click(page, '[data-a=collection]');
  await measure(page, name, 'collection');
  await click(page, '[data-a=goals]');
  await measure(page, name, 'goals');
  // In a run: pause, the between-stage page, the serpent trader, then the boss pick and the shop (driven through the test hooks).
  await page.evaluate(() => (window as any).__zuma.expedition(2, 2600));
  await page.waitForTimeout(2500);
  await page.evaluate(() => (window as any).__zuma.pause());
  await measure(page, name, 'pause');
  await click(page, '[data-a=resume]');
  await page.evaluate(() => (window as any).__zuma.winNow());
  await page.waitForFunction(() => document.querySelector('[data-screen=stage-clear]'), null, { timeout: 15000 });
  await measure(page, name, 'stage-clear');
  await page.evaluate(() => (window as any).__zuma.expedition(4, 2600));
  await page.waitForTimeout(2500);
  await page.evaluate(() => (window as any).__zuma.winNow());
  await page.waitForFunction(() => document.querySelector('[data-screen=trader]'), null, { timeout: 15000 });
  await measure(page, name, 'trader');
  await page.evaluate(() => (window as any).__zuma.expedition(9, 2600));
  await page.waitForTimeout(2500);
  await page.evaluate(() => (window as any).__zuma.winNow());
  await page.waitForFunction(() => document.querySelector('[data-screen=pick]'), null, { timeout: 15000 });
  await click(page, '[data-a=take]');
  await measure(page, name, 'pick');
  await click(page, '[data-a=confirm]');
  await measure(page, name, 'shop');
  // Campaign result screen
  await page.evaluate(() => {
    const z = (window as any).__zuma;
    z.start(2);
  });
  await page.waitForTimeout(2500);
  await page.evaluate(() => (window as any).__zuma.winNow());
  await page.waitForFunction(() => document.querySelector('[data-screen=result]'), null, { timeout: 15000 });
  await measure(page, name, 'result');
  await page.close();
}
await browser.close();

let bad = 0;
for (const r of rows) {
  const fail = r.overX > 0 || (MUST_FIT.has(r.screen) && r.overY > 0);
  if (fail) bad++;
  const note = r.overX > 0 ? `spills ${r.overX}px sideways` : r.overY > 0 ? `scrolls ${r.overY}px${MUST_FIT.has(r.screen) ? '' : ' (ok)'}` : 'fits';
  console.log(`${fail ? '✗' : '✓'} ${r.profile.padEnd(15)} ${r.screen.padEnd(11)} ${note}`);
}
console.log(`\n${rows.length} screens checked, ${bad} problems. Screenshots in e2e-out/layout/`);
process.exit(bad ? 1 : 0);

// Renders the link-preview card (public/og.png, 1200×630) from the real game: a live board on
// the right and the title-screen logo on the left. Run against a preview server:
//   npx vite build && npx vite preview --port 5174 & npx tsx scripts/og-image.ts http://localhost:5174/
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { browserPath } from './browser';

const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:5174/';
const SEED = process.env.OG_SEED ?? 'og-card';
const LEVEL = Number(process.env.OG_LEVEL ?? 6);

const browser = await chromium.launch({ executablePath: browserPath() });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
await page.goto(base);
await page.evaluate(() => {
  localStorage.setItem('zuma-marbles.save.v1', JSON.stringify({ v: 1, gen: 99, campaignSeed: 'og', unlocked: 0, best: {}, totalScore: 0, settings: {}, snapshot: null, tutorialSeen: true }));
});
await page.reload();
await page.waitForFunction(() => (window as any).__zuma?.mode === 'title');
await page.waitForTimeout(900);
// Keep the title logo (with its coloured marbles), then start a level behind it.
const logo = await page.evaluate(() => document.querySelector('[data-screen=title] .logo')!.outerHTML);
await page.evaluate(([seed, i]) => (window as any).__zuma.load(seed, i), [SEED, LEVEL] as const);
await page.waitForTimeout(Number(process.env.OG_WAIT ?? 11000));
await page.evaluate((logo) => {
  for (const id of ['hud', 'toast', 'cancel-zone']) document.getElementById(id)?.style.setProperty('display', 'none');
  document.querySelectorAll<HTMLElement>('.screen').forEach((s) => (s.style.display = 'none'));
  const card = document.createElement('div');
  card.innerHTML = `
    <div style="position:fixed;inset:0;background:linear-gradient(90deg,rgba(5,10,18,.96) 0%,rgba(5,10,18,.88) 34%,rgba(5,10,18,.25) 62%,rgba(5,10,18,0) 80%);"></div>
    <div style="position:fixed;left:70px;top:0;bottom:0;width:470px;display:flex;flex-direction:column;justify-content:center;align-items:center;font-family:inherit;">
      <div class="og-logo">${logo}</div>
      <div style="margin-top:6px;font-size:27px;font-weight:800;color:#fff;text-align:center;line-height:1.25;text-shadow:0 2px 12px rgba(0,0,0,.6)">Pop marbles. Chain combos.<br>Beat the serpent.</div>
      <div style="margin-top:16px;font-size:18px;font-weight:700;color:rgba(255,255,255,.7);letter-spacing:.5px">Free · plays in your browser · no download</div>
    </div>`;
  const st = document.createElement('style');
  st.textContent = '.og-logo .logo{animation:none;margin-bottom:12px}.og-logo .logo .z{font-size:132px}.og-logo .logo .m{font-size:32px}.og-logo .marbles span{width:24px;height:24px;animation:none}';
  document.head.appendChild(st);
  document.body.appendChild(card);
}, logo);
await page.waitForTimeout(300);
await page.screenshot({ path: 'public/og.png' });
await browser.close();
// Downscale the 2× capture to the standard 1200×630.
execSync('sips -z 630 1200 public/og.png >/dev/null');
console.log('wrote public/og.png');

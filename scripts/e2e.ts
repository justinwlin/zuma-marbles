// End-to-end checks in a real browser across device profiles.
// Usage: npm run e2e -- [baseUrl] [--only=phone,desktop]
//
// For each profile: title screen renders, a level starts, the board fits the
// viewport (rotated on portrait), HUD doesn't cover the board, real touch/mouse
// input aims + fires, a scripted match pops with feedback (hit-stop, shake,
// particles, sound), no console errors, frame rate is sane. Screenshots land in e2e-out/.

import { chromium, type Page, type BrowserContextOptions } from 'playwright';
import { mkdirSync } from 'node:fs';
import { browserPath } from './browser';

const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:5173/';
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',');
const OUT = 'e2e-out';
mkdirSync(OUT, { recursive: true });

const PROFILES: Record<string, BrowserContextOptions> = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Mobile Safari/537.36' },
  smallPhone: { viewport: { width: 360, height: 640 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  phoneLandscape: { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  tablet: { viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  laptop: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 },
};

type Z = {
  mode: string;
  state(): { balls: { s: number; c: number; clr: number }[]; gun: { cur: number; cool: number }; phase: string; score: number; stats: { shots: number; matches: number } };
  layout(): { portrait: boolean; vw: number; vh: number; board: { x: number; y: number; w: number; h: number }; scale: number };
  level(): { launcher: { x: number; y: number } };
  view(): { aimActive: boolean; aimHit: unknown; willPop: boolean; trauma: number };
  events(): { t: number; e: { type: string } }[];
  feel(): { type: string; hitstop: number; trauma: number; particles: number; sound: string | null }[];
  fps(): number;
  particles(): number;
  start(i: number): void;
  setup(colors: number[], opts?: object): void;
  ballScreen(i: number): { x: number; y: number } | null;
  worldToScreen(x: number, y: number): { x: number; y: number };
};

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

async function touchDrag(page: Page, pts: { x: number; y: number }[]) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pts[0].x, y: pts[0].y, id: 1 }] });
  for (const p of pts.slice(1)) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p.x, y: p.y, id: 1 }] });
    await page.waitForTimeout(16);
  }
  return async () => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
}

async function runProfile(name: string, opts: BrowserContextOptions) {
  console.log(`\n▶ ${name} ${opts.viewport!.width}×${opts.viewport!.height}${opts.hasTouch ? ' touch' : ''}`);
  const browser = await chromium.launch({ executablePath: browserPath(), args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(base);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => (window as unknown as { __zuma?: Z }).__zuma?.mode === 'title');
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${OUT}/${name}-1-title.png` });
  const startBtn = page.locator('[data-a=play]');
  check('title has Start button', await startBtn.isVisible());
  await startBtn.click();
  await page.waitForTimeout(400);
  check('enters play mode', (await page.evaluate(() => (window as unknown as { __zuma: Z }).__zuma.mode)) === 'playing');
  await page.waitForTimeout(3600);
  await page.screenshot({ path: `${OUT}/${name}-2-play.png` });

  const L = await page.evaluate(() => (window as unknown as { __zuma: Z }).__zuma.layout());
  const vp = opts.viewport!;
  check('portrait orientation detection', L.portrait === vp.height > vp.width * 1.05, `portrait=${L.portrait}`);
  const b = L.board;
  check('board fits viewport', b.x >= -0.5 && b.y >= -0.5 && b.x + b.w <= vp.width + 0.5 && b.y + b.h <= vp.height + 0.5, `${b.w.toFixed(0)}×${b.h.toFixed(0)} @${b.x.toFixed(0)},${b.y.toFixed(0)}`);
  const usage = (b.w * b.h) / (vp.width * vp.height);
  check('board uses the screen well', usage > (L.portrait ? 0.5 : 0.55), `${(usage * 100).toFixed(0)}% of viewport`);
  check('ball size is touch-readable', 36 * L.scale >= (opts.hasTouch ? 15 : 18), `ball ⌀ ${(36 * L.scale).toFixed(1)} css px`);
  const hudBottom = await page.evaluate(() => {
    const r = document.querySelector('.hud-top')!.getBoundingClientRect();
    const bar = document.querySelector('.bar')!.getBoundingClientRect();
    return { top: r.bottom, barBottom: bar.bottom };
  });
  check('top HUD does not cover the board', hudBottom.barBottom <= b.y + 4, `bar bottom ${hudBottom.barBottom.toFixed(0)} vs board top ${b.y.toFixed(0)}`);
  if (opts.hasTouch && L.portrait && vp.height / vp.width >= 1.95) {
    const sw = await page.locator('#btn-swap').boundingBox();
    check('swap button below board', !!sw && sw.y >= b.y + b.h - 6, sw ? `swap top ${sw.y.toFixed(0)} board bottom ${(b.y + b.h).toFixed(0)}` : 'missing');
    check('swap button is thumb-sized', !!sw && sw.height >= 44, sw ? `${sw.height.toFixed(0)}px` : '');
  }

  // ---- Scripted match: freeze a known chain, aim with real input, fire.
  await page.evaluate(() => (window as unknown as { __zuma: Z }).__zuma.setup([0, 1, 1, 2, 3, 3, 1, 4], { power: [1, 1] }));
  await page.evaluate(() => {
    const z = (window as unknown as { __zuma: Z }).__zuma;
    (z.state() as unknown as { gun: { cur: number; next: number } }).gun.cur = 1;
  });
  await page.waitForTimeout(100);
  const target = await page.evaluate(() => (window as unknown as { __zuma: Z }).__zuma.ballScreen(2));
  const lc = await page.evaluate(() => {
    const z = (window as unknown as { __zuma: Z }).__zuma;
    const l = z.level().launcher;
    return z.worldToScreen(l.x, l.y);
  });
  const shotsBefore = await page.evaluate(() => (window as unknown as { __zuma: Z }).__zuma.state().stats.shots);
  if (opts.hasTouch) {
    // Drag from a neutral point toward the target, hold so the guide shows, then release.
    const start = { x: (lc.x + target!.x) / 2 + 30, y: (lc.y + target!.y) / 2 + 30 };
    const pts = Array.from({ length: 8 }, (_, i) => ({ x: start.x + ((target!.x - start.x) * (i + 1)) / 8, y: start.y + ((target!.y - start.y) * (i + 1)) / 8 }));
    const release = await touchDrag(page, [start, ...pts]);
    await page.waitForTimeout(350);
    const v = await page.evaluate(() => (window as unknown as { __zuma: Z }).__zuma.view());
    check('touch drag shows aim guide', v.aimActive && !!v.aimHit);
    check('aim preview predicts a pop', v.willPop);
    await page.screenshot({ path: `${OUT}/${name}-3-aim.png` });
    await release();
  } else {
    await page.mouse.move(target!.x - 40, target!.y - 40);
    await page.mouse.move(target!.x, target!.y, { steps: 6 });
    await page.waitForTimeout(350);
    const v = await page.evaluate(() => (window as unknown as { __zuma: Z }).__zuma.view());
    check('mouse hover shows aim guide', v.aimActive && !!v.aimHit);
    check('aim preview predicts a pop', v.willPop);
    await page.screenshot({ path: `${OUT}/${name}-3-aim.png` });
    await page.mouse.down();
    await page.mouse.up();
  }
  await page.waitForTimeout(260);
  await page.screenshot({ path: `${OUT}/${name}-4-pop.png` });
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => {
    const z = (window as unknown as { __zuma: Z }).__zuma;
    return { shots: z.state().stats.shots, matches: z.state().stats.matches, events: z.events().map((e) => e.e.type), feel: z.feel(), score: z.state().score };
  });
  check('real input fired exactly one shot', after.shots === shotsBefore + 1, `${after.shots - shotsBefore} shots`);
  check('shot produced a match', after.matches >= 1, `score ${after.score}`);
  const popFeel = after.feel.find((f) => f.type === 'pop');
  check('pop has hit-stop, shake, particles and sound', !!popFeel && popFeel.hitstop > 0 && popFeel.trauma > 0 && popFeel.particles > 0 && !!popFeel.sound);
  check('bomb power-up triggered by match', after.events.includes('power'));
  await page.screenshot({ path: `${OUT}/${name}-5-after.png` });

  // ---- Natural play for a few seconds → frame rate.
  await page.evaluate(() => (window as unknown as { __zuma: Z }).__zuma.start(0));
  await page.waitForTimeout(3500);
  const fps = await page.evaluate(() => (window as unknown as { __zuma: Z }).__zuma.fps());
  check('frame rate (headless, software GL)', fps > 25, `${fps.toFixed(0)} fps`);

  // ---- Pause → menu → continue restores the snapshot.
  await page.evaluate(() => (window as unknown as { __zuma: Z }).__zuma.state());
  await page.locator('#btn-pause').click();
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/${name}-6-pause.png` });
  const tickAtPause = await page.evaluate(() => (window as unknown as { __zuma: Z }).__zuma.state() as unknown as { tick: number });
  await page.locator('[data-a=quit]').click();
  await page.waitForTimeout(300);
  check('continue offered after quitting mid-level', await page.locator('[data-a=continue]').isVisible());
  await page.locator('[data-a=continue]').click();
  await page.waitForTimeout(100);
  const resumed = await page.evaluate(() => (window as unknown as { __zuma: Z }).__zuma.state() as unknown as { tick: number });
  check('snapshot resumes where it left off', resumed.tick >= tickAtPause.tick && resumed.tick - tickAtPause.tick < 30, `paused@${tickAtPause.tick} resumed@${resumed.tick}`);

  check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
}

for (const [name, opts] of Object.entries(PROFILES)) {
  if (only && !only.includes(name)) continue;
  await runProfile(name, opts);
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall e2e checks passed');
process.exit(failures ? 1 : 0);

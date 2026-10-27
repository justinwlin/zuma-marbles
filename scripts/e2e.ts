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
  // Record vibration calls with the event they happened in (sync-in-gesture matters on iOS).
  // (String, not a function: tsx would inject helpers the page doesn't have.)
  await page.addInitScript(`
    window.__vib = [];
    let cur = '';
    for (const t of ['pointerup', 'pointerdown', 'touchend']) {
      window.addEventListener(t, () => { cur = t; }, true);
      window.addEventListener(t, () => setTimeout(() => { cur = ''; }, 0), true);
    }
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: (p) => { window.__vib.push({ p, ev: cur }); return true; } });
  `);
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(base);
  // Fixed campaign so level layouts (and any failure) are reproducible. Override with E2E_SEED.
  await page.evaluate((seed) => {
    localStorage.clear();
    localStorage.setItem('zuma-marbles.save.v1', JSON.stringify({ v: 1, campaignSeed: seed, unlocked: 0, best: {}, totalScore: 0, settings: {}, snapshot: null, tutorialSeen: false }));
  }, process.env.E2E_SEED ?? 'e2e-fixed');
  await page.reload();
  await page.waitForFunction(() => (window as unknown as { __zuma?: Z }).__zuma?.mode === 'title');
  // The seeded save has no generator version (like every save before levels v2).
  check('old saves get a one-time "levels updated" notice', ((await page.locator('#toast.show').textContent()) ?? '').includes('Levels got an update'));
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
  if (opts.hasTouch && L.portrait) {
    // Every portrait phone: the swap button sits below the board, never on the marbles.
    const sw = await page.locator('#btn-swap').boundingBox();
    const tall = vp.height / vp.width >= 1.95;
    check('swap button below board', !!sw && sw.y >= b.y + b.h - 2, sw ? `swap top ${sw.y.toFixed(0)} board bottom ${(b.y + b.h).toFixed(0)}` : 'missing');
    check('swap button is thumb-sized', !!sw && sw.height >= (tall ? 44 : 38), sw ? `${sw.height.toFixed(0)}px` : '');
  }

  if (!opts.hasTouch && !L.portrait) {
    // Desktop: the current/next chip in the top bar is visible, readable, and swaps on click.
    const chip = await page.locator('#hud-next').boundingBox();
    check('desktop shows the next-marble chip', !!chip && chip.height >= 36, chip ? `${chip.width.toFixed(0)}×${chip.height.toFixed(0)}` : 'hidden');
    const g0 = await page.evaluate(() => {
      const s = (window as unknown as { __zuma: Z }).__zuma.state() as unknown as { gun: { cur: number; next: number } };
      if (s.gun.cur === s.gun.next) s.gun.next = (s.gun.cur + 1) % 4;
      return { ...s.gun };
    });
    await page.locator('#hud-next').click();
    await page.waitForTimeout(150);
    const g1 = await page.evaluate(() => ({ ...((window as unknown as { __zuma: Z }).__zuma.state() as unknown as { gun: { cur: number; next: number } }).gun }));
    check('clicking the chip swaps marbles', g1.cur === g0.next && g1.next === g0.cur, `${JSON.stringify(g0)} → ${JSON.stringify(g1)}`);
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

  // ---- Cancel gestures (touch) and the power-ups sheet.
  if (opts.hasTouch) {
    await page.evaluate(() => (window as unknown as { __zuma: Z }).__zuma.setup([0, 1, 2, 3, 0, 1, 2, 3], {}));
    await page.waitForTimeout(100);
    const shots0 = await page.evaluate(() => (window as unknown as { __zuma: Z }).__zuma.state().stats.shots);
    const tgt = (await page.evaluate(() => (window as unknown as { __zuma: Z }).__zuma.ballScreen(3)))!;
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', pts: { x: number; y: number; id: number }[]) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    // 1) drag toward a ball, then slide onto the ✕ pill and release → no shot
    await touch('touchStart', [{ x: tgt.x, y: tgt.y + 40, id: 1 }]);
    await touch('touchMove', [{ x: tgt.x, y: tgt.y, id: 1 }]);
    await page.waitForTimeout(120);
    const zone = await page.locator('#cancel-zone').boundingBox();
    check('cancel pill appears while aiming', !!zone && (await page.locator('#cancel-zone.show').count()) === 1);
    const zx = zone!.x + zone!.width / 2;
    const zy = zone!.y + zone!.height / 2;
    for (let i = 1; i <= 6; i++) await touch('touchMove', [{ x: tgt.x + ((zx - tgt.x) * i) / 6, y: tgt.y + ((zy - tgt.y) * i) / 6, id: 1 }]);
    await page.waitForTimeout(150);
    const armed = await page.evaluate(() => (window as unknown as { __zuma: Z }).__zuma.view() as unknown as { aimCancel: boolean });
    check('over the pill the guide turns into "cancel"', armed.aimCancel && (await page.locator('#cancel-zone.armed').count()) === 1);
    await page.screenshot({ path: `${OUT}/${name}-7-cancel.png` });
    await touch('touchEnd', []);
    await page.waitForTimeout(400);
    let shots = await page.evaluate(() => (window as unknown as { __zuma: Z }).__zuma.state().stats.shots);
    check('releasing on ✕ cancels the shot', shots === shots0, `${shots - shots0} shots`);
    check('pill hides after release', (await page.locator('#cancel-zone.show').count()) === 0);
    // 2) second finger cancels
    await touch('touchStart', [{ x: tgt.x, y: tgt.y + 40, id: 1 }]);
    await touch('touchMove', [{ x: tgt.x, y: tgt.y, id: 1 }]);
    await page.waitForTimeout(80);
    await touch('touchStart', [{ x: tgt.x, y: tgt.y, id: 1 }, { x: 40, y: 200, id: 2 }]);
    await page.waitForTimeout(80);
    await touch('touchEnd', [{ x: tgt.x, y: tgt.y, id: 1 }]);
    await touch('touchEnd', []);
    await page.waitForTimeout(400);
    shots = await page.evaluate(() => (window as unknown as { __zuma: Z }).__zuma.state().stats.shots);
    check('a second finger cancels the shot', shots === shots0, `${shots - shots0} shots`);
    // 3) a normal drag still fires after cancels
    await touch('touchStart', [{ x: tgt.x, y: tgt.y + 40, id: 1 }]);
    await touch('touchMove', [{ x: tgt.x, y: tgt.y, id: 1 }]);
    await page.waitForTimeout(120);
    await touch('touchEnd', []);
    await page.waitForTimeout(300);
    shots = await page.evaluate(() => (window as unknown as { __zuma: Z }).__zuma.state().stats.shots);
    check('normal drag still fires afterwards', shots === shots0 + 1);
    const vib = await page.evaluate(() => (window as unknown as { __vib: { p: unknown; ev: string }[] }).__vib);
    check('drag-release vibrates inside the lift-off event', vib.some((v) => v.ev === 'pointerup' && v.p === 12), `${vib.filter((v) => v.ev === 'pointerup').length} in-gesture calls`);
  }
  await page.locator('#btn-help').click();
  await page.waitForTimeout(300);
  check('? opens the power-ups sheet and pauses', (await page.locator('[data-screen=powerups]').count()) === 1 && (await page.evaluate(() => (window as unknown as { __zuma: Z }).__zuma.mode)) === 'paused');
  check('sheet shows 9 power-up icons', (await page.locator('.powers-sheet img').count()) === 9);
  await page.screenshot({ path: `${OUT}/${name}-8-powerups.png` });
  await page.locator('[data-screen=powerups] [data-a=back]').click();
  await page.waitForTimeout(200);
  check('closing the sheet resumes play', (await page.evaluate(() => (window as unknown as { __zuma: Z }).__zuma.mode)) === 'playing');

  // ---- In-game settings: gear pauses, character change persists, resume.
  await page.locator('#btn-settings').click();
  await page.waitForTimeout(250);
  check('gear opens settings mid-game and pauses', (await page.locator('[data-screen=settings]').count()) === 1 && (await page.evaluate(() => (window as unknown as { __zuma: Z }).__zuma.mode)) === 'paused');
  check('settings shows 4 characters', (await page.locator('.char').count()) === 4);
  await page.locator('[data-a=char][data-v=calico]').click();
  await page.locator('[data-screen=settings] [data-a=back]').click();
  await page.waitForTimeout(250);
  const ch = await page.evaluate(() => {
    const z = (window as unknown as { __zuma: Z & { save(): { settings: { character: string } } } }).__zuma;
    return { mode: z.mode, character: z.save().settings.character, stored: JSON.parse(localStorage.getItem('zuma-marbles.save.v1') ?? '{}').settings?.character };
  });
  check('character change applies, persists and play resumes', ch.mode === 'playing' && ch.character === 'calico' && ch.stored === 'calico', JSON.stringify(ch));

  // ---- Accessibility settings: Relaxed speed slows the chain 25%, left-handed moves the swap button,
  // a tap on the row (not just the switch) toggles, Escape closes the menu.
  const speedOf = () => page.evaluate(() => (window as unknown as { __zuma: { levelSpeed(): number } }).__zuma.levelSpeed());
  const sp0 = await speedOf();
  await page.locator('#btn-settings').click();
  await page.waitForTimeout(200);
  await page.locator('.setting:has([data-k=relaxed]) label').click();
  if (opts.hasTouch) await page.locator('[data-k=leftHanded]').click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  const sp1 = await speedOf();
  check('Relaxed speed (row tap) slows the chain to 75%', Math.abs(sp1 / sp0 - 0.75) < 0.01, `${sp0.toFixed(1)} → ${sp1.toFixed(1)} px/s`);
  check('Escape closes in-game settings and resumes', (await page.evaluate(() => (window as unknown as { __zuma: Z }).__zuma.mode)) === 'playing');
  if (opts.hasTouch && vp.height > vp.width) {
    const sw = await page.locator('#btn-swap').boundingBox();
    check('left-handed puts the swap button on the left', !!sw && sw.x + sw.width / 2 < vp.width / 2, sw ? `swap centre x ${(sw.x + sw.width / 2).toFixed(0)}` : '');
  }
  await page.locator('#btn-settings').click();
  await page.waitForTimeout(200);
  await page.locator('[data-k=relaxed]').click();
  if (opts.hasTouch) await page.locator('[data-k=leftHanded]').click();
  await page.locator('[data-screen=settings] [data-a=back]').click();
  await page.waitForTimeout(200);
  check('turning Relaxed off restores the speed', Math.abs((await speedOf()) - sp0) < 0.01);
  await page.screenshot({ path: `${OUT}/${name}-9-calico.png` });

  // ---- Aim + tap mode (touch): drag sets the aim without firing; a tap fires along it.
  if (opts.hasTouch) {
    await page.locator('#btn-settings').click();
    await page.waitForTimeout(200);
    await page.locator('[data-a=aim][data-v=aimtap]').click();
    await page.locator('[data-screen=settings] [data-a=back]').click();
    await page.waitForTimeout(200);
    await page.evaluate(() => (window as unknown as { __zuma: Z }).__zuma.setup([0, 1, 2, 3, 0, 1, 2, 3], {}));
    await page.waitForTimeout(100);
    const s0 = await page.evaluate(() => (window as unknown as { __zuma: Z }).__zuma.state().stats.shots);
    const tg = (await page.evaluate(() => (window as unknown as { __zuma: Z }).__zuma.ballScreen(3)))!;
    const cdp2 = await page.context().newCDPSession(page);
    const t2 = (type: 'touchStart' | 'touchMove' | 'touchEnd', pts: { x: number; y: number; id: number }[]) => cdp2.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    await t2('touchStart', [{ x: tg.x + 30, y: tg.y + 60, id: 1 }]);
    for (let i = 1; i <= 5; i++) await t2('touchMove', [{ x: tg.x + 30 - 6 * i, y: tg.y + 60 - 12 * i, id: 1 }]);
    await t2('touchEnd', []);
    await page.waitForTimeout(300);
    let st2 = await page.evaluate(() => ({ shots: (window as unknown as { __zuma: Z }).__zuma.state().stats.shots, aim: (window as unknown as { __zuma: Z }).__zuma.view().aimActive }));
    check('aim+tap: dragging sets the aim without shooting', st2.shots === s0 && st2.aim, JSON.stringify(st2));
    await page.evaluate(() => ((window as unknown as { __vib: unknown[] }).__vib.length = 0));
    await t2('touchStart', [{ x: 60, y: 300, id: 1 }]);
    await t2('touchEnd', []);
    await page.waitForTimeout(300);
    st2 = await page.evaluate(() => ({ shots: (window as unknown as { __zuma: Z }).__zuma.state().stats.shots, aim: (window as unknown as { __zuma: Z }).__zuma.view().aimActive }));
    const vib2 = await page.evaluate(() => (window as unknown as { __vib: { ev: string }[] }).__vib);
    check('aim+tap: a tap fires along the set aim (guide stays)', st2.shots === s0 + 1 && st2.aim, JSON.stringify(st2));
    check('aim+tap: the firing tap vibrates in-gesture', vib2.some((v) => v.ev === 'pointerup'));
    await page.screenshot({ path: `${OUT}/${name}-10-aimtap.png` });
    // back to drag mode for the remaining checks
    await page.locator('#btn-settings').click();
    await page.waitForTimeout(200);
    await page.locator('[data-a=aim][data-v=drag]').click();
    await page.locator('[data-screen=settings] [data-a=back]').click();
    await page.waitForTimeout(200);
  }

  // ---- Hold to keep shooting: a still press rapid-fires; a drag still fires once.
  {
    const long = Array.from({ length: 60 }, (_, i) => i % 4);
    const shotsNow = () => page.evaluate(() => (window as unknown as { __zuma: Z }).__zuma.state().stats.shots);
    await page.evaluate((c) => (window as unknown as { __zuma: Z }).__zuma.setup(c, {}), long);
    await page.waitForTimeout(150);
    const hb = (await page.evaluate(() => (window as unknown as { __zuma: Z }).__zuma.ballScreen(20)))!;
    let h0 = await shotsNow();
    if (opts.hasTouch) {
      const cdp3 = await page.context().newCDPSession(page);
      const t3 = (type: 'touchStart' | 'touchMove' | 'touchEnd', pts: { x: number; y: number; id: number }[]) => cdp3.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
      await t3('touchStart', [{ x: hb.x, y: hb.y, id: 1 }]);
      await page.waitForTimeout(1500);
      const during = (await shotsNow()) - h0;
      await t3('touchEnd', []);
      await page.waitForTimeout(100);
      const lifted = (await shotsNow()) - h0;
      await page.waitForTimeout(700);
      const total = (await shotsNow()) - h0;
      check('hold: a still press keeps shooting', during >= 3, `${during} shots in 1.5 s`);
      check('hold: shooting stops when the finger lifts', total === lifted, `${lifted} at lift, ${total} after 0.7 s`);
      // A drag followed by a pause is aiming, not rapid fire: exactly one shot on release.
      h0 = await shotsNow();
      // Start 40 px from the marble toward the screen centre, so the touch lands on the board, not the HUD.
      const ox = hb.x > vp.width / 2 ? -40 : 40;
      const oy = hb.y > vp.height / 2 ? -40 : 40;
      await t3('touchStart', [{ x: hb.x + ox, y: hb.y + oy, id: 1 }]);
      for (let i = 1; i <= 4; i++) await t3('touchMove', [{ x: hb.x + ox - (ox / 4) * i, y: hb.y + oy - (oy / 4) * i, id: 1 }]);
      await page.waitForTimeout(900);
      await t3('touchEnd', []);
      await page.waitForTimeout(300);
      check('hold: drag-then-pause still fires once', (await shotsNow()) - h0 === 1, `${(await shotsNow()) - h0} shots`);
    } else {
      await page.mouse.move(hb.x, hb.y);
      await page.mouse.down();
      await page.waitForTimeout(1500);
      await page.mouse.up();
      await page.waitForTimeout(300);
      const n = (await shotsNow()) - h0;
      check('hold: holding the mouse button keeps shooting', n >= 4, `${n} shots in 1.5 s`);
      h0 = await shotsNow();
      await page.mouse.down();
      await page.mouse.up();
      await page.waitForTimeout(400);
      check('hold: a click still fires once', (await shotsNow()) - h0 === 1, `${(await shotsNow()) - h0} shots`);
    }
  }

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

  // ---- Large-marble campaign: phones start on it; the Levels toggle switches, marbles render 50% bigger.
  type ZC = Z & { save(): { campaignSeed: string; unlocked: number } };
  const seedNow = () => page.evaluate(() => (window as unknown as { __zuma: ZC }).__zuma.save().campaignSeed);
  const phone = Math.min(vp.width, vp.height) < 600;
  check(phone ? 'phones start on large marbles' : 'desktops start on normal marbles', (await seedNow()).startsWith('xl-') === phone);
  const scaleFor = async (large: boolean) => {
    await page.locator('#btn-pause').click();
    await page.waitForTimeout(200);
    await page.locator('[data-a=quit]').click();
    await page.waitForTimeout(200);
    await page.locator('[data-a=levels]').click();
    await page.waitForTimeout(200);
    await page.locator(`[data-a=size][data-v="${large ? 1 : 0}"]`).click();
    await page.waitForTimeout(300);
    await page.locator('[data-a=lv]').first().click();
    await page.waitForTimeout(3500);
    return page.evaluate(() => (window as unknown as { __zuma: Z }).__zuma.layout().scale);
  };
  const normalScale = await scaleFor(false);
  const unlockedBefore = await page.evaluate(() => (window as unknown as { __zuma: ZC }).__zuma.save().unlocked);
  const bigScale = await scaleFor(true);
  check('large toggle switches to an xl- campaign', (await seedNow()).startsWith('xl-'));
  check('large campaign marbles render ~50% bigger', Math.abs(bigScale / normalScale - 1.5) < 0.05, `⌀ ${(36 * normalScale).toFixed(1)} → ${(36 * bigScale).toFixed(1)} css px`);
  const bL = await page.evaluate(() => (window as unknown as { __zuma: Z }).__zuma.layout().board);
  check('large board still fits the screen', bL.x >= -0.5 && bL.y >= -0.5 && bL.x + bL.w <= vp.width + 0.5 && bL.y + bL.h <= vp.height + 0.5);
  await page.screenshot({ path: `${OUT}/${name}-11-large.png` });
  await page.locator('#btn-pause').click();
  await page.waitForTimeout(200);
  await page.locator('[data-a=quit]').click();
  await page.waitForTimeout(200);
  await page.locator('[data-a=levels]').click();
  await page.waitForTimeout(200);
  await page.locator('[data-a=size][data-v="0"]').click();
  await page.waitForTimeout(300);
  const back = await page.evaluate(() => (window as unknown as { __zuma: Z & { save(): { campaignSeed: string; unlocked: number } } }).__zuma.save());
  check('switching back restores the normal campaign progress', !back.campaignSeed.startsWith('xl-') && back.unlocked === unlockedBefore);

  // ---- Skipping ahead: the locked card unlocks levels; pause can skip the current one.
  type ZS = Omit<Z, 'level'> & { save(): { unlocked: number }; level(): { index: number } };
  const unlocked = () => page.evaluate(() => (window as unknown as { __zuma: ZS }).__zuma.save().unlocked);
  const u0 = await unlocked();
  await page.locator('[data-a=unlock]').click();
  await page.waitForTimeout(200);
  check('tapping the locked level offers to unlock', (await page.locator('[data-screen=unlock]').count()) === 1);
  await page.locator('[data-a=five]').click();
  await page.waitForTimeout(300);
  check('"Unlock next 5" unlocks five levels', (await unlocked()) === u0 + 5 && (await page.locator('[data-screen=levels]').count()) === 1, `${u0} → ${await unlocked()}`);
  await page.locator('[data-a=unlock]').click();
  await page.locator('[data-a=one]').click();
  await page.waitForTimeout(500);
  const lv1 = await page.evaluate(() => (window as unknown as { __zuma: ZS }).__zuma.level().index);
  check('"Unlock & play" starts the newly unlocked level', lv1 === u0 + 6 && (await unlocked()) === u0 + 6, `level ${lv1 + 1}`);
  await page.locator('#btn-pause').click();
  await page.waitForTimeout(200);
  await page.locator('[data-a=skip]').click();
  await page.waitForTimeout(500);
  const lv2 = await page.evaluate(() => (window as unknown as { __zuma: ZS }).__zuma.level().index);
  check('pause → skip moves on to the next level', lv2 === lv1 + 1 && (await unlocked()) === lv1 + 1, `level ${lv2 + 1}`);
  await page.locator('#btn-pause').click();
  await page.waitForTimeout(200);
  await page.locator('[data-a=quit]').click();
  await page.waitForTimeout(200);
  await page.locator('[data-a=levels]').click();
  await page.waitForTimeout(200);

  // ---- Endless: title → Endless → Daily run; a cleared stage rolls into the next; losing ends the run.
  type ZE = Omit<Z, 'level'> & { run(): { stage: number; runScore: number } | null; load(seed: string, i: number): void; level(): { length: number; chains: number; boss: string | null; seed: string } };
  await page.locator('[data-a=back]').click();
  await page.waitForTimeout(200);
  await page.locator('[data-a=endless]').click();
  await page.waitForTimeout(200);
  check('endless screen offers random and daily runs', (await page.locator('[data-a=random]').isVisible()) && (await page.locator('[data-a=daily]').isVisible()));
  await page.screenshot({ path: `${OUT}/${name}-12-endless.png` });
  await page.locator('[data-a=daily]').click();
  await page.waitForTimeout(800);
  const e1 = await page.evaluate(() => ({ hud: document.getElementById('hud-level')!.textContent, seed: (window as unknown as { __zuma: ZE }).__zuma.level().seed }));
  check('daily run starts at stage 1 with the daily seed', e1.hud === 'Stage 1' && /^daily-\d{8}$/.test(e1.seed), JSON.stringify(e1));
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const s = (window as unknown as { __zuma: ZE }).__zuma.state() as unknown as { score: number };
    s.score = 5000;
  });
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    const s = (window as unknown as { __zuma: ZE }).__zuma.state() as unknown as { chains: { balls: unknown[] }[]; shots: unknown[] };
    s.chains.forEach((c) => (c.balls = []));
    s.shots = [];
  });
  await page.waitForTimeout(4800);
  const e2 = await page.evaluate(() => ({ hud: document.getElementById('hud-level')!.textContent, score: Number(document.getElementById('hud-score')!.textContent!.replace(/\D/g, '')), mode: (window as unknown as { __zuma: ZE }).__zuma.mode }));
  check('a cleared stage rolls straight into the next, score carried', e2.hud === 'Stage 2' && e2.score >= 5000 && e2.mode === 'playing', JSON.stringify(e2));
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const z = (window as unknown as { __zuma: ZE }).__zuma;
    const L = z.level().length;
    const c = (z.state() as unknown as { chains: { balls: { s: number }[] }[] }).chains[0];
    c.balls.forEach((b, i, a) => (b.s = L + 2 - (a.length - 1 - i) * 36));
  });
  await page.waitForFunction(() => (window as unknown as { __zuma: ZE }).__zuma.mode === 'result', null, { timeout: 8000 }).catch(() => {});
  const over = await page.locator('[data-screen=result] h2').textContent().catch(() => '');
  check('losing ends the run with a run-over screen', over === 'Run over', String(over));
  await page.screenshot({ path: `${OUT}/${name}-13-runover.png` });
  await page.locator('[data-a=quit]').click();
  await page.waitForTimeout(300);
  check('no run left in progress after it ends', (await page.evaluate(() => (window as unknown as { __zuma: ZE & { save(): { endless?: unknown } } }).__zuma.save().endless)) == null);

  // ---- Two chains: both roll in, shots can land in the second chain.
  await page.evaluate(() => (window as unknown as { __zuma: ZE }).__zuma.load('e2e-fixed', 13));
  await page.waitForTimeout(3500);
  const tc = await page.evaluate(() => {
    const z = (window as unknown as { __zuma: ZE }).__zuma;
    const s = z.state() as unknown as { chains: { balls: unknown[] }[] };
    return { chains: z.level().chains, n0: s.chains[0].balls.length, n1: s.chains[1]?.balls.length ?? 0 };
  });
  check('two-chain level: both chains roll in', tc.chains === 2 && tc.n0 > 5 && tc.n1 > 5, JSON.stringify(tc));
  await page.screenshot({ path: `${OUT}/${name}-14-twin.png` });
  const before1 = tc.n1;
  const tgt1 = await page.evaluate(() => {
    const z = (window as unknown as { __zuma: ZE }).__zuma;
    const s = z.state() as unknown as { chains: { balls: unknown[] }[] };
    (s as unknown as { gun: { cool: number } }).gun.cool = 0;
    for (const ch of s.chains) (ch as unknown as { stopT: number }).stopT = 1e6;
    // The second-chain marble closest to the launcher (clear line of fire, away from HUD buttons).
    const zz = z as unknown as { ballScreen(i: number, c: number): { x: number; y: number } | null };
    const L = (z as unknown as { level(): { launcher: { x: number; y: number } } }).level().launcher;
    const lp = z.worldToScreen(L.x, L.y);
    let best: { x: number; y: number } | null = null;
    for (let i = 0; i < s.chains[1].balls.length; i++) {
      const p = zz.ballScreen(i, 1);
      if (p && (!best || Math.hypot(p.x - lp.x, p.y - lp.y) < Math.hypot(best.x - lp.x, best.y - lp.y))) best = p;
    }
    return best;
  });
  if (tgt1) {
    if (opts.hasTouch) {
      const up = await touchDrag(page, [tgt1, tgt1]);
      await up();
    } else await page.mouse.click(tgt1.x, tgt1.y);
  }
  await page.waitForTimeout(700);
  const after1 = await page.evaluate(() => {
    const s = (window as unknown as { __zuma: ZE }).__zuma.state() as unknown as { chains: { balls: { clr: number }[] }[]; stats: { shots: number; matches: number } };
    return { n1: s.chains[1].balls.length, matches: s.stats.matches };
  });
  check('a shot at the second chain lands in it', after1.n1 !== before1 || after1.matches > 0, `${before1} → ${after1.n1} marbles`);
  // Boss banner
  await page.evaluate(() => (window as unknown as { __zuma: ZE }).__zuma.load('e2e-fixed', 9));
  await page.waitForTimeout(450);
  check('boss level announces itself', (await page.evaluate(() => (window as unknown as { __zuma: ZE }).__zuma.level().boss)) === 'boss' && (await page.locator('#hud-name').textContent())!.startsWith('BOSS'));
  await page.screenshot({ path: `${OUT}/${name}-15-boss.png` });
  check('boss fight: HUD bar shows the boss health', ((await page.locator('#hud-bar-label').textContent()) ?? '').startsWith('BOSS'));
  // Boss fight: the frog slides along its rail to where you aim and shoots straight across.
  const rail = await page.evaluate(() => {
    const z = (window as any).__zuma;
    const l = z.level();
    const s = z.state();
    s.gun.cool = 0;
    // A point across the board, a third of the way along the rail.
    const u = l.rail.len * 0.3;
    const wx = l.rail.a.x + l.rail.dir.x * u + l.rail.n.x * 500;
    const wy = l.rail.a.y + l.rail.dir.y * u + l.rail.n.y * 500;
    return { u, scr: z.worldToScreen(wx, wy), shots: s.stats.shots };
  });
  if (opts.hasTouch) {
    // Touch: dragging only moves the frog — no shot, no cancel pill — and the Fire button shoots.
    const end = await touchDrag(page, [{ x: rail.scr.x + 20, y: rail.scr.y + 20 }, { x: rail.scr.x + 10, y: rail.scr.y + 10 }, rail.scr]);
    await page.waitForTimeout(250);
    const pill = await page.locator('#cancel-zone.show').count();
    await end();
    await page.waitForTimeout(400);
    const moved = await page.evaluate(() => {
      const s = (window as any).__zuma.state();
      return { u: s.rail.u, shots: s.stats.shots };
    });
    check('boss fight (touch): dragging moves the frog without shooting', Math.abs(moved.u - rail.u) < 4 && moved.shots === rail.shots, `u ${moved.u.toFixed(1)} vs ${rail.u.toFixed(1)}, ${moved.shots - rail.shots} shots`);
    check('boss fight (touch): no cancel pill while moving', pill === 0);
    // A plain tap elsewhere also just moves.
    const tapPt = await page.evaluate(() => {
      const z = (window as any).__zuma;
      const l = z.level();
      const u = l.rail.len * 0.75;
      return { u, scr: z.worldToScreen(l.rail.a.x + l.rail.dir.x * u + l.rail.n.x * 400, l.rail.a.y + l.rail.dir.y * u + l.rail.n.y * 400) };
    });
    const endTap = await touchDrag(page, [tapPt.scr]);
    await endTap();
    await page.waitForTimeout(500);
    const tapped = await page.evaluate(() => {
      const s = (window as any).__zuma.state();
      return { u: s.rail.u, shots: s.stats.shots };
    });
    check('boss fight (touch): a tap moves the frog without shooting', Math.abs(tapped.u - tapPt.u) < 4 && tapped.shots === rail.shots, `u ${tapped.u.toFixed(1)} vs ${tapPt.u.toFixed(1)}, ${tapped.shots - rail.shots} shots`);
    const fire = await page.locator('#btn-fire').boundingBox();
    check('boss fight (touch): a big Fire button is on screen', !!fire && fire.width >= 48 && fire.x >= 0 && fire.y + fire.height <= vp.height, fire ? `${fire.width.toFixed(0)}px at ${fire.x.toFixed(0)},${fire.y.toFixed(0)}` : 'hidden');
    await page.evaluate(() => ((window as any).__zuma.state().gun.cool = 0));
    if (fire) {
      const endFire = await touchDrag(page, [{ x: fire.x + fire.width / 2, y: fire.y + fire.height / 2 }]);
      await endFire();
    }
    await page.waitForTimeout(500);
    rail.u = tapPt.u;
    await page.screenshot({ path: `${OUT}/${name}-15b-boss-fire.png` });
  } else {
    await page.mouse.move(rail.scr.x, rail.scr.y);
    await page.waitForTimeout(250);
    await page.mouse.down();
    await page.mouse.up();
  }
  await page.waitForTimeout(500);
  const railAfter = await page.evaluate(() => {
    const s = (window as any).__zuma.state();
    return { u: s.rail.u, shots: s.stats.shots };
  });
  check('boss fight: the frog slides to the aimed spot on its rail', Math.abs(railAfter.u - rail.u) < 4, `u ${railAfter.u.toFixed(1)} vs ${rail.u.toFixed(1)}`);
  check('boss fight: and fires from there', railAfter.shots === rail.shots + 1, `${railAfter.shots - rail.shots} shots`);

  // ---- Trackpad aiming (touch): a drag anywhere moves the crosshair without firing; a tap fires.
  if (opts.hasTouch) {
    await page.evaluate(() => (window as any).__zuma.load('e2e-fixed', 2));
    await page.waitForTimeout(300);
    await page.locator('#btn-settings').click();
    await page.waitForTimeout(200);
    await page.locator('[data-a=aim][data-v=pad]').click();
    await page.locator('[data-screen=settings] [data-a=back]').click();
    await page.waitForTimeout(200);
    await page.evaluate(() => (window as any).__zuma.setup([0, 1, 2, 3, 0, 1, 2, 3], {}));
    const p0 = await page.evaluate(() => {
      const z = (window as any).__zuma;
      return { cur: z.view().cursor, shots: z.state().stats.shots };
    });
    const L = await page.evaluate(() => (window as any).__zuma.layout());
    const sx = L.board.x + L.board.w * 0.5;
    const sy = L.board.y + L.board.h * 0.8;
    const endPad = await touchDrag(page, [{ x: sx, y: sy }, { x: sx + 10, y: sy - 10 }, { x: sx + 20, y: sy - 20 }, { x: sx + 30, y: sy - 30 }]);
    await endPad();
    await page.waitForTimeout(300);
    const p1 = await page.evaluate(() => {
      const z = (window as any).__zuma;
      return { cur: z.view().cursor, shots: z.state().stats.shots, gun: z.state().gun.cool };
    });
    const moved = p0.cur && p1.cur ? Math.hypot(p1.cur.x - p0.cur.x, p1.cur.y - p0.cur.y) : 0;
    check('trackpad: a drag moves the crosshair by the finger motion (scaled)', moved > 20 && moved < (42 / L.scale) * 1.1, `${moved.toFixed(1)} world px`);
    check('trackpad: dragging does not shoot', p1.shots === p0.shots);
    const endTap = await touchDrag(page, [{ x: sx, y: sy }]);
    await endTap();
    await page.waitForTimeout(300);
    check('trackpad: a tap shoots', (await page.evaluate(() => (window as any).__zuma.state().stats.shots)) === p0.shots + 1);
    await page.screenshot({ path: `${OUT}/${name}-16-trackpad.png` });
    await page.locator('#btn-settings').click();
    await page.waitForTimeout(200);
    await page.locator('[data-a=aim][data-v=drag]').click();
    await page.locator('[data-screen=settings] [data-a=back]').click();
  }

  check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
}

/** iPhone in standalone PWA mode: notch + home indicator, with insets arriving *after* load (iOS quirk). */
async function runNotch() {
  const name = 'iphoneNotch';
  console.log(`\n▶ ${name} 390×844 touch, safe-area 59/34 applied after load`);
  const browser = await chromium.launch({ executablePath: browserPath() });
  const ctx = await browser.newContext(PROFILES.phone);
  const page = await ctx.newPage();
  await page.goto(base);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(500);
  await page.locator('[data-a=play]').click();
  await page.waitForTimeout(1500);
  const before = await page.evaluate(() => (window as unknown as { __zuma: Z }).__zuma.layout().board);
  const cdp = await ctx.newCDPSession(page);
  try {
    await cdp.send('Emulation.setSafeAreaInsetsOverride' as never, { insets: { top: 59, bottom: 34, left: 0, right: 0 } } as never);
  } catch (e) {
    check('safe-area emulation available', false, String(e));
    await browser.close();
    return;
  }
  await page.waitForTimeout(600); // no resize event fires — the probe observer must catch it
  const L = await page.evaluate(() => (window as unknown as { __zuma: Z }).__zuma.layout());
  const hud = await page.evaluate(() => {
    const bar = document.querySelector('.bar')!.getBoundingClientRect();
    const btn = document.querySelector('#btn-pause')!.getBoundingClientRect();
    const sw = document.querySelector('#btn-swap')!.getBoundingClientRect();
    return { barBottom: bar.bottom, btnTop: btn.top, swapBottom: sw.bottom };
  });
  check('layout reacts to late safe-area insets', L.board.y > before.y + 30, `board top ${before.y.toFixed(0)} → ${L.board.y.toFixed(0)}`);
  check('HUD sits below the notch', hud.btnTop >= 59, `pause top ${hud.btnTop.toFixed(0)}`);
  check('HUD does not overlap the board', hud.barBottom <= L.board.y + 2, `bar bottom ${hud.barBottom.toFixed(0)} vs board ${L.board.y.toFixed(0)}`);
  check('board clears the home indicator', L.board.y + L.board.h <= 844 - 34 + 1);
  check('swap button clears the home indicator', hud.swapBottom <= 844 - 34 + 1, `swap bottom ${hud.swapBottom.toFixed(0)}`);
  check('canvas renders at device resolution (3×)', (await page.evaluate(() => (document.getElementById('game') as HTMLCanvasElement).width)) === 390 * 3);
  await page.screenshot({ path: `${OUT}/${name}-play.png` });
  await browser.close();
}

for (const [name, opts] of Object.entries(PROFILES)) {
  if (only && !only.includes(name)) continue;
  await runProfile(name, opts);
}
if (!only || only.includes('iphoneNotch')) await runNotch();
console.log(failures ? `\n${failures} check(s) failed` : '\nall e2e checks passed');
process.exit(failures ? 1 : 0);

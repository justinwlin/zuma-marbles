// Verifies the production build is an installable, offline-capable PWA.
// Usage: npm run build && npm run pwa-check
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { browserPath } from './browser';

const PORT = 4179;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { stdio: 'ignore' });
const url = `http://127.0.0.1:${PORT}/`;
let failures = 0;
const check = (n: string, ok: boolean, d = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${n}${d ? ` — ${d}` : ''}`);
  if (!ok) failures++;
};
try {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(url)).ok) break;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  const browser = await chromium.launch({ executablePath: browserPath() });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(url);
  const cdp = await ctx.newCDPSession(page);
  const man = (await cdp.send('Page.getAppManifest')) as { url: string; errors: unknown[]; data?: string };
  const m = JSON.parse(man.data ?? '{}');
  check('manifest linked and parses', !!man.data && man.errors.length === 0, man.url);
  check('manifest: name, standalone/fullscreen, icons 192+512, maskable', !!m.name && ['fullscreen', 'standalone'].includes(m.display) && m.icons?.some((i: { sizes: string }) => i.sizes === '192x192') && m.icons?.some((i: { sizes: string }) => i.sizes === '512x512') && m.icons?.some((i: { purpose?: string }) => i.purpose === 'maskable'));
  const sw = await page.evaluate(async () => {
    const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 8000))]);
    return !!reg;
  });
  check('service worker active', sw);
  // Give workbox a moment to finish precaching, then check installability.
  await page.waitForTimeout(1500);
  const inst = (await cdp.send('Page.getInstallabilityErrors')) as { installabilityErrors: { errorId: string }[] };
  // 'in-incognito' is an artifact of Playwright's throwaway browser profile, not of the app.
  const errs = inst.installabilityErrors.map((e) => e.errorId).filter((e) => e !== 'in-incognito');
  check('Chrome reports no installability errors', errs.length === 0, errs.join(','));
  for (const icon of m.icons ?? []) {
    const r = await page.request.get(new URL(icon.src, man.url).toString());
    check(`icon ${icon.src} served`, r.ok());
  }
  // Offline: cold reload must still boot to the title screen.
  await ctx.setOffline(true);
  await page.reload();
  const ok = await page
    .waitForFunction(() => (window as unknown as { __zuma?: { mode: string } }).__zuma?.mode === 'title', null, { timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  check('boots offline from the service-worker cache', ok);
  await page.locator('[data-a=play]').click();
  await page.waitForTimeout(800);
  check('plays offline', (await page.evaluate(() => (window as unknown as { __zuma: { mode: string } }).__zuma.mode)) === 'playing');
  await browser.close();
} finally {
  server.kill();
}
console.log(failures ? `${failures} PWA check(s) failed` : 'PWA checks passed');
process.exit(failures ? 1 : 0);

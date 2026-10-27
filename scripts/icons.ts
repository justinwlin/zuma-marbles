// Renders public/icons/icon.svg to the PNG sizes the PWA manifest and iOS need.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { browserPath } from './browser';

const svg = readFileSync('public/icons/icon.svg', 'utf8');
const browser = await chromium.launch({ executablePath: browserPath() });
const page = await browser.newPage();
for (const [name, size, pad] of [
  ['icon-192.png', 192, 0],
  ['icon-512.png', 512, 0],
  ['apple-touch-icon.png', 180, 0],
  ['icon-maskable-512.png', 512, 0.12],
] as const) {
  await page.setViewportSize({ width: size, height: size });
  const inner = Math.round(size * (1 - pad * 2));
  await page.setContent(`<body style="margin:0;background:#050a12;display:grid;place-items:center;width:${size}px;height:${size}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</body>`);
  await page.screenshot({ path: `public/icons/${name}` });
}
await browser.close();
console.log('icons written');

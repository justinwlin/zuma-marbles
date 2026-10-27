// Combine screenshots into one grid image (for quick visual review).
// Usage: npx tsx scripts/montage.ts out.png cols width file...
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { browserPath } from './browser';

const [out, cols, w, ...files] = process.argv.slice(2);
const imgs = files.map((f) => `<img src="data:image/png;base64,${readFileSync(f).toString('base64')}" style="width:${w}px;display:block">`).join('');
const browser = await chromium.launch({ executablePath: browserPath() });
const page = await browser.newPage({ viewport: { width: Number(cols) * Number(w), height: 400 } });
await page.setContent(`<body style="margin:0;background:#000;display:grid;grid-template-columns:repeat(${cols},${w}px)">${imgs}</body>`);
await page.waitForTimeout(200);
await page.screenshot({ path: out, fullPage: true });
await browser.close();

import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Use whichever Playwright Chromium is installed (CI/pods may have a different build). */
export function browserPath(): string | undefined {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const root = join(homedir(), '.cache', 'ms-playwright');
  if (!existsSync(root)) return undefined;
  const dirs = readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse();
  for (const d of dirs) {
    const p = join(root, d, 'chrome-linux64', 'chrome');
    if (existsSync(p)) return p;
    const p2 = join(root, d, 'chrome-linux', 'chrome');
    if (existsSync(p2)) return p2;
  }
  return undefined;
}

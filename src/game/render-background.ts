// Static backdrop pieces drawn into the cached background: the world theme's decoration
// and the boss-fight rail. Split out of render.ts.

import type { Level } from '../sim/levelgen';
import { railPoint } from '../sim/game';
import type { Decor } from './themes';

/** The frog's rail: a groove with sleepers and end stops. */
/** The world theme's backdrop decoration (screen pixels, under the board). Seeded per level, so it is stable. */
export function drawDecor(g: CanvasRenderingContext2D, decor: Decor, w: number, h: number, k: number, seed: number) {
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const dot = (x: number, y: number, r: number, fill: string) => {
    g.fillStyle = fill;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  };
  const glow = (x: number, y: number, r: number, rgb: string, a: number) => {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(${rgb},${a})`);
    gr.addColorStop(1, `rgba(${rgb},0)`);
    dot(x, y, r, gr as unknown as string);
  };
  switch (decor) {
    case 'fireflies':
      for (let i = 0; i < 70; i++) {
        const x = rnd() * w, y = rnd() * h;
        glow(x, y, (6 + rnd() * 8) * k, '200,255,120', 0.12 + rnd() * 0.18);
        dot(x, y, (0.8 + rnd()) * k, `rgba(230,255,170,${0.35 + rnd() * 0.4})`);
      }
      break;
    case 'sand':
      // Dune ridges and drifting grains.
      g.lineWidth = 1.5 * k;
      for (let i = 0; i < 9; i++) {
        const y = (i + 0.5 + rnd() * 0.4) * (h / 9);
        g.strokeStyle = `rgba(255,210,150,${0.04 + rnd() * 0.05})`;
        g.beginPath();
        for (let x = 0; x <= w; x += 24 * k) g.lineTo(x, y + Math.sin(x / (90 * k) + i) * 10 * k);
        g.stroke();
      }
      for (let i = 0; i < 180; i++) dot(rnd() * w, rnd() * h, rnd() * 1.3 * k, `rgba(255,220,170,${0.05 + rnd() * 0.16})`);
      break;
    case 'snow':
      for (let i = 0; i < 140; i++) {
        const r = (0.6 + rnd() * 2.2) * k;
        dot(rnd() * w, rnd() * h, r, `rgba(235,248,255,${0.08 + rnd() * 0.3})`);
      }
      break;
    case 'embers':
      for (let i = 0; i < 90; i++) {
        const x = rnd() * w, y = h * (0.3 + 0.7 * rnd());
        glow(x, y, (4 + rnd() * 7) * k, '255,120,40', 0.1 + rnd() * 0.2);
        dot(x, y, (0.7 + rnd()) * k, `rgba(255,190,90,${0.3 + rnd() * 0.45})`);
      }
      break;
    case 'bubbles':
      g.lineWidth = 1.2 * k;
      for (let i = 0; i < 60; i++) {
        g.strokeStyle = `rgba(170,225,255,${0.08 + rnd() * 0.2})`;
        g.beginPath();
        g.arc(rnd() * w, rnd() * h, (2 + rnd() * 7) * k, 0, Math.PI * 2);
        g.stroke();
      }
      // Light shafts from above.
      for (let i = 0; i < 4; i++) {
        const x = rnd() * w;
        const sh = g.createLinearGradient(0, 0, 0, h);
        sh.addColorStop(0, 'rgba(150,210,255,0.07)');
        sh.addColorStop(1, 'rgba(150,210,255,0)');
        g.fillStyle = sh;
        g.beginPath();
        g.moveTo(x - 30 * k, 0);
        g.lineTo(x + 30 * k, 0);
        g.lineTo(x + 140 * k, h);
        g.lineTo(x + 20 * k, h);
        g.fill();
      }
      break;
    case 'grid': {
      // A perspective floor grid in the lower half and a few bright pixels above it.
      const hz = h * 0.55;
      g.lineWidth = 1 * k;
      g.strokeStyle = 'rgba(255,90,230,0.10)';
      for (let i = 0; i <= 16; i++) {
        const t = i / 16;
        g.beginPath();
        g.moveTo(w / 2 + (t - 0.5) * w * 0.4, hz);
        g.lineTo(w / 2 + (t - 0.5) * w * 3, h);
        g.stroke();
      }
      for (let i = 1; i < 10; i++) {
        const y = hz + (h - hz) * (i / 10) ** 1.8;
        g.strokeStyle = `rgba(90,220,255,${0.05 + 0.07 * (i / 10)})`;
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(w, y);
        g.stroke();
      }
      for (let i = 0; i < 80; i++) dot(rnd() * w, rnd() * hz, rnd() * 1.4 * k, `rgba(255,255,255,${0.05 + rnd() * 0.2})`);
      break;
    }
  }
}

export function drawRail(g: CanvasRenderingContext2D, level: Level, hue: number) {
  const R = level.rail!;
  const a = R.a;
  const b = railPoint(R, R.len);
  g.lineCap = 'round';
  g.strokeStyle = `hsla(${hue}, 70%, 60%, 0.18)`;
  g.lineWidth = 60;
  g.beginPath();
  g.moveTo(a.x, a.y);
  g.lineTo(b.x, b.y);
  g.stroke();
  // Sleepers
  g.strokeStyle = `hsla(${hue}, 30%, 40%, 0.55)`;
  g.lineWidth = 5;
  for (let u = 0; u <= R.len; u += 26) {
    const p = railPoint(R, u);
    g.beginPath();
    g.moveTo(p.x - R.n.x * 22, p.y - R.n.y * 22);
    g.lineTo(p.x + R.n.x * 22, p.y + R.n.y * 22);
    g.stroke();
  }
  // Two rails
  for (const off of [-13, 13]) {
    g.strokeStyle = `hsla(${hue}, 60%, 80%, 0.55)`;
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(a.x + R.n.x * off, a.y + R.n.y * off);
    g.lineTo(b.x + R.n.x * off, b.y + R.n.y * off);
    g.stroke();
  }
  g.fillStyle = `hsla(${hue}, 70%, 75%, 0.6)`;
  for (const p of [a, b]) {
    g.beginPath();
    g.arc(p.x, p.y, 9, 0, Math.PI * 2);
    g.fill();
  }
}

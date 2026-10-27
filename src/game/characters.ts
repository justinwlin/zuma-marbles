// Launcher characters, drawn procedurally in local space: facing +x (the aim),
// origin at the centre, the current marble sits in the mouth at x = MOUTH_X.
// Everything is vector paths so they stay crisp at any size and cost no assets.

import { BALL_R } from '../sim/levelgen';

export type CharacterId = 'frog' | 'calico' | 'fox' | 'penguin';

export const CHARACTERS: { id: CharacterId; name: string }[] = [
  { id: 'frog', name: 'Frog' },
  { id: 'calico', name: 'Calico Cat' },
  { id: 'fox', name: 'Fox' },
  { id: 'penguin', name: 'Penguin' },
];

export const MOUTH_X = 32;

/** Short noun for instructions ("tap the cat to swap"). */
export function characterNoun(id: CharacterId): string {
  return { frog: 'frog', calico: 'cat', fox: 'fox', penguin: 'penguin' }[id] ?? 'launcher';
}

export interface CharacterPose {
  /** Seconds, for idle animation. */
  t: number;
  /** 0 = eyes open, 1 = closed. */
  blink: number;
  /** 0..1 recoil kick (ears/tail flick). */
  recoil: number;
}

/** Natural blink: a quick close every few seconds, offset so it doesn't feel mechanical. */
export function blinkAt(t: number): number {
  const period = 3.7;
  const p = (t + Math.sin(t * 0.37) * 0.6) % period;
  if (p > 0.16) return 0;
  return Math.sin((p / 0.16) * Math.PI);
}

type G = CanvasRenderingContext2D;

function ellipse(g: G, x: number, y: number, rx: number, ry: number, fill: string | CanvasGradient, rot = 0) {
  g.fillStyle = fill;
  g.beginPath();
  g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  g.fill();
}

function mouth(g: G, color = '#1a0d0a') {
  ellipse(g, MOUTH_X, 0, BALL_R + 3, BALL_R + 3, color);
}

/** Top-down eye: white, iris, pupil (round or slit), glint. Blink squashes it. */
function eye(g: G, x: number, y: number, r: number, iris: string, slit: boolean, blink: number) {
  const ry = Math.max(0.6, r * (1 - blink));
  ellipse(g, x, y, r, ry, '#fbfffd');
  if (blink > 0.7) {
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(x - r, y);
    g.lineTo(x + r, y);
    g.stroke();
    return;
  }
  g.save();
  g.beginPath();
  g.ellipse(x, y, r, ry, 0, 0, Math.PI * 2);
  g.clip();
  ellipse(g, x + r * 0.25, y, r * 0.72, r * 0.72, iris);
  if (slit) ellipse(g, x + r * 0.3, y, r * 0.5, r * 0.16, '#0b0b0b');
  else ellipse(g, x + r * 0.3, y, r * 0.4, r * 0.4, '#0b0b0b');
  ellipse(g, x + r * 0.05, y - r * 0.32, r * 0.18, r * 0.18, '#fff');
  g.restore();
}

/** Curvy tail behind the body, swaying. Drawn as a thick stroke with optional tip colour. */
function tail(g: G, pose: CharacterPose, width: number, color: string, tip: string | null, len = 34, bands: string | null = null) {
  const sway = Math.sin(pose.t * 2.3) * 12 + pose.recoil * 10;
  const p0 = { x: -34, y: 0 };
  const c1 = { x: -34 - len * 0.6, y: sway * 0.6 };
  const p1 = { x: -34 - len, y: sway + 10 };
  g.lineCap = 'round';
  g.lineWidth = width;
  g.strokeStyle = color;
  g.beginPath();
  g.moveTo(p0.x, p0.y);
  g.quadraticCurveTo(c1.x, c1.y, p1.x, p1.y);
  g.stroke();
  if (bands) {
    g.setLineDash([5, 7]);
    g.strokeStyle = bands;
    g.stroke();
    g.setLineDash([]);
  }
  if (tip) {
    // Last ~30% of the curve in the tip colour.
    g.strokeStyle = tip;
    g.beginPath();
    const q = (u: number) => ({
      x: (1 - u) * (1 - u) * p0.x + 2 * (1 - u) * u * c1.x + u * u * p1.x,
      y: (1 - u) * (1 - u) * p0.y + 2 * (1 - u) * u * c1.y + u * u * p1.y,
    });
    const a = q(0.7);
    g.moveTo(a.x, a.y);
    for (let u = 0.75; u <= 1.001; u += 0.05) {
      const b = q(u);
      g.lineTo(b.x, b.y);
    }
    g.stroke();
  }
}

/** Triangle ear: base centred at (x,y), pointing outward/backward by `dir` (±1 for side). */
function ear(g: G, x: number, y: number, side: number, outer: string, inner: string | null, flick: number, size = 1) {
  g.save();
  g.translate(x, y);
  g.rotate(side * (0.35 + flick * 0.35));
  g.fillStyle = outer;
  g.beginPath();
  g.moveTo(9 * size, 0);
  g.lineTo(-11 * size, 0);
  g.lineTo(-6 * size, side * -19 * size);
  g.closePath();
  g.fill();
  if (inner) {
    g.fillStyle = inner;
    g.beginPath();
    g.moveTo(5 * size, side * -2);
    g.lineTo(-8 * size, side * -2);
    g.lineTo(-5 * size, side * -14 * size);
    g.closePath();
    g.fill();
  }
  g.restore();
}

function whiskers(g: G, x: number, color: string) {
  g.strokeStyle = color;
  g.lineWidth = 1.4;
  g.lineCap = 'round';
  for (const s of [-1, 1]) {
    for (const k of [-1, 0, 1]) {
      g.beginPath();
      g.moveTo(x, s * 13);
      g.quadraticCurveTo(x + 4, s * (24 + k * 2), x + 2 + k * 6, s * (36 + k * 1));
      g.stroke();
    }
  }
}

// ------------------------------------------------------------------ characters

function frog(g: G, pose: CharacterPose) {
  const body = g.createRadialGradient(-8, -10, 4, 0, 0, 46);
  body.addColorStop(0, '#5ce0b0');
  body.addColorStop(0.6, '#1f8f6c');
  body.addColorStop(1, '#0b3b33');
  g.fillStyle = body;
  g.beginPath();
  g.ellipse(-4, 0, 42, 38, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#1a7a5c';
  g.beginPath();
  g.moveTo(8, -24);
  g.quadraticCurveTo(46, -22, 50, 0);
  g.quadraticCurveTo(46, 22, 8, 24);
  g.closePath();
  g.fill();
  mouth(g, '#082a24');
  g.fillStyle = 'rgba(255,255,255,0.10)';
  for (const [x, y, r] of [
    [-26, -14, 6],
    [-30, 10, 5],
    [-14, 20, 4],
  ]) {
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  for (const sy of [-1, 1]) eye(g, -2, sy * 22, 10, '#173d2f', false, pose.blink);
}

function calico(g: G, pose: CharacterPose) {
  const WHITE = '#fbf6ee';
  const ORANGE = '#f0953a';
  const BLACK = '#2a2420';
  // Tail: orange with dark bands, white tip.
  tail(g, pose, 10, ORANGE, WHITE, 36, BLACK);
  // Body (behind the head) with patches.
  g.save();
  g.beginPath();
  g.ellipse(-20, 0, 26, 25, 0, 0, Math.PI * 2);
  g.clip();
  ellipse(g, -20, 0, 26, 25, WHITE);
  ellipse(g, -30, -12, 16, 12, ORANGE, 0.4);
  ellipse(g, -14, 15, 13, 10, BLACK, -0.3);
  ellipse(g, -36, 12, 8, 7, ORANGE);
  g.restore();
  // Ears: one orange, one black (classic calico), pink insides.
  ear(g, -6, -22, 1, ORANGE, '#f6b3b8', pose.recoil);
  ear(g, -6, 22, -1, BLACK, '#e9a0a6', pose.recoil);
  // Head with patches.
  g.save();
  g.beginPath();
  g.ellipse(4, 0, 30, 29, 0, 0, Math.PI * 2);
  g.clip();
  ellipse(g, 4, 0, 30, 29, WHITE);
  ellipse(g, -6, -15, 20, 15, ORANGE, 0.2);
  ellipse(g, -2, 17, 15, 12, BLACK, -0.2);
  ellipse(g, 14, -20, 7, 6, BLACK);
  g.restore();
  // Soft head shading
  const sh = g.createRadialGradient(-4, -8, 6, 4, 0, 32);
  sh.addColorStop(0, 'rgba(255,255,255,0.15)');
  sh.addColorStop(1, 'rgba(0,0,0,0.18)');
  ellipse(g, 4, 0, 30, 29, sh);
  // Cheeks around the marble
  ellipse(g, 24, -12, 9, 7, WHITE);
  ellipse(g, 24, 12, 9, 7, WHITE);
  mouth(g, '#3b1d1d');
  whiskers(g, 24, 'rgba(255,255,255,0.85)');
  // Eyes (green, round pupils) and pink nose.
  eye(g, 8, -12, 7.5, '#8bd450', false, pose.blink);
  eye(g, 8, 12, 7.5, '#8bd450', false, pose.blink);
  g.fillStyle = '#f08a9a';
  g.beginPath();
  g.moveTo(17, -3.5);
  g.lineTo(17, 3.5);
  g.lineTo(12, 0);
  g.closePath();
  g.fill();
}

function fox(g: G, pose: CharacterPose) {
  const ORANGE = '#f07a2a';
  const CREAM = '#fff4e6';
  tail(g, pose, 15, ORANGE, CREAM, 34);
  ellipse(g, -20, 0, 25, 23, '#e46f22');
  ear(g, -4, -22, 1, ORANGE, '#3a2018', pose.recoil, 1.15);
  ear(g, -4, 22, -1, ORANGE, '#3a2018', pose.recoil, 1.15);
  ellipse(g, 4, 0, 29, 28, ORANGE);
  // Pointy muzzle toward the marble, cream cheeks.
  g.fillStyle = CREAM;
  g.beginPath();
  g.moveTo(0, -24);
  g.quadraticCurveTo(30, -26, 46, 0);
  g.quadraticCurveTo(30, 26, 0, 24);
  g.quadraticCurveTo(14, 0, 0, -24);
  g.fill();
  mouth(g, '#2a130b');
  eye(g, 6, -12, 7, '#7a4a12', false, pose.blink);
  eye(g, 6, 12, 7, '#7a4a12', false, pose.blink);
}

function penguin(g: G, pose: CharacterPose) {
  // Flippers wiggle with recoil.
  for (const s of [-1, 1]) ellipse(g, -16, s * 30, 18, 7, '#1d2433', s * (0.5 + pose.recoil * 0.4 + Math.sin(pose.t * 3) * 0.05));
  const body = g.createRadialGradient(-10, -10, 6, -4, 0, 44);
  body.addColorStop(0, '#3b4660');
  body.addColorStop(1, '#141a26');
  g.fillStyle = body;
  g.beginPath();
  g.ellipse(-4, 0, 40, 34, 0, 0, Math.PI * 2);
  g.fill();
  // White face mask
  ellipse(g, 10, -10, 15, 13, '#f7f9ff');
  ellipse(g, 10, 10, 15, 13, '#f7f9ff');
  // Orange beak around the marble
  ellipse(g, MOUTH_X - 2, 0, BALL_R + 6, BALL_R + 5, '#ffa21f');
  mouth(g, '#3a1a05');
  eye(g, 10, -11, 6.5, '#23324a', false, pose.blink);
  eye(g, 10, 11, 6.5, '#23324a', false, pose.blink);
  // Cheek blush
  g.globalAlpha = 0.35;
  ellipse(g, 20, -20, 4, 3, '#ff7a9a');
  ellipse(g, 20, 20, 4, 3, '#ff7a9a');
  g.globalAlpha = 1;
}

const DRAW: Record<CharacterId, (g: G, pose: CharacterPose) => void> = { frog, calico, fox, penguin };

export function drawCharacter(g: G, id: CharacterId, pose: CharacterPose) {
  (DRAW[id] ?? frog)(g, pose);
}

const thumbCache = new Map<string, string>();
/** Thumbnail (facing up) for menus, with a marble in its mouth. */
export function characterThumb(id: CharacterId, marble: (g: G, x: number, y: number, r: number) => void): string {
  const hit = thumbCache.get(id);
  if (hit) return hit;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 160;
  const g = cv.getContext('2d')!;
  g.translate(80, 92);
  g.scale(1.25, 1.25);
  g.rotate(-Math.PI / 2);
  drawCharacter(g, id, { t: 0.4, blink: 0, recoil: 0 });
  marble(g, MOUTH_X + 6, 0, BALL_R * 0.72);
  const url = cv.toDataURL();
  thumbCache.set(id, url);
  return url;
}

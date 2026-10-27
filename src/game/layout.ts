// Maps the fixed landscape world (1280×720) onto any screen. On portrait screens
// the board is rotated 90° so a phone held upright uses its full height; the
// simulation never knows, so levels stay identical across devices.

import { WORLD_H, WORLD_W } from '../sim/levelgen';
import type { Pt } from '../sim/track';

export interface Layout {
  portrait: boolean;
  /** CSS px. */
  vw: number;
  vh: number;
  dpr: number;
  /** World → CSS px scale. */
  scale: number;
  /** CSS-px affine: screen = [a c e; b d f] · world. */
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
  /** Board rectangle on screen (CSS px). */
  board: { x: number; y: number; w: number; h: number };
}

export interface Insets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export function computeLayout(vw: number, vh: number, dpr: number, insets: Insets, world: { w: number; h: number } = { w: WORLD_W, h: WORLD_H }): Layout {
  const portrait = vh > vw * 1.05;
  // Space reserved for HUD bars (CSS px), on top of device safe areas.
  // Tall phones (≥ ~19.5:9) get a roomy bottom bar; shorter phones a slim one with a
  // compact swap button, so no button ever sits on top of the marbles.
  const tall = vh / vw >= 1.95;
  const hudTop = (portrait ? (tall ? 56 : 50) : 50) + insets.top;
  const hudBottom = (portrait ? (tall ? 92 : 54) : 8) + insets.bottom;
  const availW = vw - insets.left - insets.right - (portrait ? 8 : 16);
  const availH = vh - hudTop - hudBottom;
  const bw = portrait ? world.h : world.w;
  const bh = portrait ? world.w : world.h;
  const scale = Math.max(0.1, Math.min(availW / bw, availH / bh));
  const w = bw * scale;
  const h = bh * scale;
  const x = insets.left + (vw - insets.left - insets.right - w) / 2;
  const y = hudTop + (availH - h) / 2;
  let a: number, b: number, c: number, d: number, e: number, f: number;
  if (portrait) {
    // world x → screen y (down), world y → screen -x: rotate 90° clockwise.
    a = 0;
    b = scale;
    c = -scale;
    d = 0;
    e = x + world.h * scale;
    f = y;
  } else {
    a = scale;
    b = 0;
    c = 0;
    d = scale;
    e = x;
    f = y;
  }
  return { portrait, vw, vh, dpr, scale, a, b, c, d, e, f, board: { x, y, w, h } };
}

export function worldToScreen(L: Layout, p: Pt, out: Pt = { x: 0, y: 0 }): Pt {
  const x = L.a * p.x + L.c * p.y + L.e;
  const y = L.b * p.x + L.d * p.y + L.f;
  out.x = x;
  out.y = y;
  return out;
}

export function screenToWorld(L: Layout, sx: number, sy: number): Pt {
  if (L.portrait) return { x: (sy - L.f) / L.scale, y: (L.e - sx) / L.scale };
  return { x: (sx - L.e) / L.scale, y: (sy - L.f) / L.scale };
}

/** Apply the world transform (with an extra screen-space shake offset) to a context. */
export function applyWorld(ctx: CanvasRenderingContext2D, L: Layout, shake = { x: 0, y: 0, rot: 0 }) {
  const k = L.dpr;
  ctx.setTransform(L.a * k, L.b * k, L.c * k, L.d * k, (L.e + shake.x) * k, (L.f + shake.y) * k);
  if (shake.rot) {
    const cx = L.board.x + L.board.w / 2;
    const cy = L.board.y + L.board.h / 2;
    const w = screenToWorld(L, cx, cy);
    ctx.translate(w.x, w.y);
    ctx.rotate(shake.rot);
    ctx.translate(-w.x, -w.y);
  }
}

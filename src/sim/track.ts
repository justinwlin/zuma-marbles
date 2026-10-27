// A track is a polyline resampled at uniform arc length, so a ball's position is
// just its distance `s` along the track. That keeps ball spacing exact on curves.

export interface Pt {
  x: number;
  y: number;
}

export const TRACK_STEP = 2; // px between lookup samples

export interface Track {
  xs: Float32Array;
  ys: Float32Array;
  /** Total length in px. */
  length: number;
  /** Arc distance where the track first becomes visible (entry tunnel ends). */
  visibleFrom: number;
  /** Arc ranges [s0, s1] where the track runs under a bridge: marbles there are hidden and can't be hit. */
  hidden?: [number, number][];
  /** Arc ranges [s0, s1] that form a bridge over another part of the track (drawn on top). */
  bridges?: [number, number][];
  /** Arc ranges [s0, s1] covered by a standalone tunnel: marbles there are hidden and can't be hit. */
  tunnels?: [number, number][];
}

/** Is arc distance s hidden (under a bridge or in a tunnel)? */
export function inTunnel(track: Track, s: number): boolean {
  for (const h of [track.hidden, track.tunnels]) if (h) for (const [a, b] of h) if (s > a && s < b) return true;
  return false;
}

export function chaikin(points: Pt[], iterations = 4, closedEnds = true): Pt[] {
  let pts = points;
  for (let it = 0; it < iterations; it++) {
    const out: Pt[] = [];
    if (closedEnds) out.push(pts[0]);
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      out.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      out.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    if (closedEnds) out.push(pts[pts.length - 1]);
    pts = out;
  }
  return pts;
}

/** Resample a dense polyline at uniform arc length. */
export function buildTrack(points: Pt[], bounds: { w: number; h: number }): Track {
  const cum: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    cum.push(cum[i - 1] + Math.sqrt(dx * dx + dy * dy));
  }
  const total = cum[cum.length - 1];
  const n = Math.floor(total / TRACK_STEP) + 1;
  const xs = new Float32Array(n);
  const ys = new Float32Array(n);
  let j = 0;
  for (let k = 0; k < n; k++) {
    const d = k * TRACK_STEP;
    while (j < points.length - 2 && cum[j + 1] < d) j++;
    const seg = cum[j + 1] - cum[j] || 1;
    const t = Math.min(1, Math.max(0, (d - cum[j]) / seg));
    xs[k] = points[j].x + (points[j + 1].x - points[j].x) * t;
    ys[k] = points[j].y + (points[j + 1].y - points[j].y) * t;
  }
  const length = (n - 1) * TRACK_STEP;
  let visibleFrom = 0;
  const m = 4; // margin; a sample counts as visible once it is inside the board
  for (let k = 0; k < n; k++) {
    if (xs[k] > m && xs[k] < bounds.w - m && ys[k] > m && ys[k] < bounds.h - m) {
      visibleFrom = k * TRACK_STEP;
      break;
    }
  }
  return { xs, ys, length, visibleFrom };
}

/** Position at arc distance s. Clamps to the ends (s<0 extrapolates off the start). */
export function pointAt(track: Track, s: number, out: Pt = { x: 0, y: 0 }): Pt {
  const n = track.xs.length;
  if (s <= 0) {
    // Extrapolate backwards along the first segment so queued balls sit off-screen.
    const dx = track.xs[1] - track.xs[0];
    const dy = track.ys[1] - track.ys[0];
    const f = s / TRACK_STEP;
    out.x = track.xs[0] + dx * f;
    out.y = track.ys[0] + dy * f;
    return out;
  }
  const f = s / TRACK_STEP;
  const i = Math.floor(f);
  if (i >= n - 1) {
    out.x = track.xs[n - 1];
    out.y = track.ys[n - 1];
    return out;
  }
  const t = f - i;
  out.x = track.xs[i] + (track.xs[i + 1] - track.xs[i]) * t;
  out.y = track.ys[i] + (track.ys[i + 1] - track.ys[i]) * t;
  return out;
}

/** Unit tangent (direction of travel) at s. */
export function tangentAt(track: Track, s: number): Pt {
  const n = track.xs.length;
  let i = Math.floor(Math.max(0, s) / TRACK_STEP);
  i = Math.min(Math.max(i, 0), n - 2);
  const a = Math.max(0, i - 2);
  const b = Math.min(n - 1, i + 3);
  const dx = track.xs[b] - track.xs[a];
  const dy = track.ys[b] - track.ys[a];
  const l = Math.sqrt(dx * dx + dy * dy) || 1;
  return { x: dx / l, y: dy / l };
}

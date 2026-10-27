// Pooled particles (world space) and floating text (screen space).

export const PK = { Spark: 0, Glow: 1, Shard: 2, Ring: 3, Text: 4, Confetti: 5 } as const;
export type PK = (typeof PK)[keyof typeof PK];

export interface Particle {
  k: PK;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  grow: number;
  color: string;
  rot: number;
  vr: number;
  drag: number;
  gravity: number;
  text?: string;
  /** Text only: font size px, and screen-space vertical offset (px). */
  fs?: number;
  oy?: number;
}

const MAX = 900;

export class Particles {
  list: Particle[] = [];
  private pool: Particle[] = [];
  /** Deterministic-ish noise so tests are stable; visuals don't need crypto randomness. */
  private seed = 1;
  rand() {
    this.seed = (this.seed * 16807) % 2147483647;
    return (this.seed - 1) / 2147483646;
  }

  spawn(p: Partial<Particle> & { k: PK; x: number; y: number }): Particle | null {
    if (this.list.length >= MAX) return null;
    const o = this.pool.pop() ?? ({} as Particle);
    o.k = p.k;
    o.x = p.x;
    o.y = p.y;
    o.vx = p.vx ?? 0;
    o.vy = p.vy ?? 0;
    o.life = 0;
    o.max = p.max ?? 0.5;
    o.size = p.size ?? 4;
    o.grow = p.grow ?? 0;
    o.color = p.color ?? '#fff';
    o.rot = p.rot ?? 0;
    o.vr = p.vr ?? 0;
    o.drag = p.drag ?? 3;
    o.gravity = p.gravity ?? 0;
    o.text = p.text;
    o.fs = p.fs;
    o.oy = p.oy ?? 0;
    this.list.push(o);
    return o;
  }

  burst(x: number, y: number, color: string, light: string, n: number, power = 1) {
    for (let i = 0; i < n; i++) {
      const a = this.rand() * Math.PI * 2;
      const sp = (120 + this.rand() * 420) * power;
      const r = this.rand();
      if (r < 0.55) {
        this.spawn({ k: PK.Spark, x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, max: 0.25 + this.rand() * 0.35, size: 2 + this.rand() * 2.5, color: r < 0.2 ? '#fff' : light, drag: 4.5 });
      } else if (r < 0.85) {
        this.spawn({ k: PK.Shard, x, y, vx: Math.cos(a) * sp * 0.6, vy: Math.sin(a) * sp * 0.6, max: 0.45 + this.rand() * 0.4, size: 3 + this.rand() * 4, color, rot: a, vr: (this.rand() - 0.5) * 20, drag: 3 });
      } else {
        this.spawn({ k: PK.Glow, x, y, vx: Math.cos(a) * sp * 0.25, vy: Math.sin(a) * sp * 0.25, max: 0.35 + this.rand() * 0.3, size: 10 + this.rand() * 12, color: light, drag: 2 });
      }
    }
  }

  ring(x: number, y: number, color: string, size: number, grow: number, max = 0.4) {
    this.spawn({ k: PK.Ring, x, y, size, grow, max, color });
  }

  /** Text: x,y in world; drawn in screen space so it is never rotated. */
  text(x: number, y: number, text: string, color: string, fs = 22, max = 0.9, oy = 0) {
    this.spawn({ k: PK.Text, x, y, text, color, fs, max, drag: 0, oy });
  }

  confetti(x: number, y: number, colors: string[], n: number) {
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (this.rand() - 0.5) * 2.2;
      const sp = 300 + this.rand() * 500;
      this.spawn({ k: PK.Confetti, x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, max: 1.6 + this.rand(), size: 5 + this.rand() * 5, color: colors[i % colors.length], rot: this.rand() * 6, vr: (this.rand() - 0.5) * 14, drag: 1.4, gravity: 520 });
    }
  }

  update(dt: number) {
    const L = this.list;
    for (let i = L.length - 1; i >= 0; i--) {
      const p = L[i];
      p.life += dt;
      if (p.life >= p.max) {
        L[i] = L[L.length - 1];
        L.pop();
        this.pool.push(p);
        continue;
      }
      const dr = Math.exp(-p.drag * dt);
      p.vx *= dr;
      p.vy = p.vy * dr + p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      p.size += p.grow * dt;
    }
  }
}

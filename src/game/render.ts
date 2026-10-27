// Canvas 2D renderer. Static layers (background, track, launcher pad) are cached
// per layout; marbles use pre-rendered rolling sprite frames per colour.

import { BALL_D, BALL_R, type Level } from '../sim/levelgen';
import { type Ball, ballPos, type GameState, Power, type RayHit, TUNING } from '../sim/game';
import { pointAt, type Pt, tangentAt } from '../sim/track';
import { applyWorld, type Layout, worldToScreen } from './layout';
import { type Particles, PK } from './fx';
import { FEEL } from './feel';
import { blinkAt, type CharacterId, drawCharacter, MOUTH_X } from './characters';

export const PALETTE = [
  { base: '#ff3b5c', light: '#ffa3b4', dark: '#7a0820', glyph: 'circle' },
  { base: '#ffbe1f', light: '#ffe9a3', dark: '#8a4a00', glyph: 'triangle' },
  { base: '#22df8c', light: '#a6ffd6', dark: '#035e35', glyph: 'square' },
  { base: '#3a8bff', light: '#b0d2ff', dark: '#0a2a78', glyph: 'diamond' },
  { base: '#b45cff', light: '#e6c2ff', dark: '#45108a', glyph: 'star' },
  { base: '#eef2ff', light: '#ffffff', dark: '#6f7899', glyph: 'cross' },
];

const FRAMES = 12;

export interface ViewState {
  time: number;
  aimAngle: number;
  /** Direction the shot will actually travel (after aim assist). */
  aimShot: number;
  aimActive: boolean;
  /** Show the guide along the last aim even when the player isn't aiming right now. */
  aimIdle: boolean;
  /** Finger is over a cancel target: show the guide as 'will not fire'. */
  aimCancel: boolean;
  aimHit: RayHit | null;
  aimWillPop: boolean;
  recoil: number; // 0..1
  trauma: number;
  shake: { x: number; y: number; rot: number };
  flash: number;
  danger: number; // 0..1
  /** Per-ball ripple pulses: id → {t0, strength}. */
  ripples: Map<number, number>;
  ripple0: { s: number; t: number } | null;
  shotTrails: Map<number, Pt[]>;
  colorblind: boolean;
  showGuide: boolean;
  banner: { text: string; sub?: string; t: number; color: string } | null;
  hue: number;
}

export class Renderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  L!: Layout;
  level!: Level;
  private bg: HTMLCanvasElement | null = null;
  private sprites: HTMLCanvasElement[][] = [];
  private hi!: HTMLCanvasElement;
  private shadow!: HTMLCanvasElement;
  private spritePx = 0;
  private bgKey = '';

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
  }

  setLayout(L: Layout) {
    this.L = L;
    const w = Math.round(L.vw * L.dpr);
    const h = Math.round(L.vh * L.dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const px = Math.ceil((BALL_D + 4) * L.scale * L.dpr);
    if (px !== this.spritePx) {
      this.spritePx = px;
      this.buildSprites();
    }
    this.bgKey = '';
  }

  setLevel(level: Level, hue: number) {
    this.level = level;
    this.bgKey = '';
    this.hue = hue;
  }
  hue = 200;
  character: CharacterId = 'frog';

  // ------------------------------------------------------------ sprites

  private buildSprites() {
    const px = this.spritePx;
    const R = (px / 2) * (BALL_D / (BALL_D + 4)); // ball radius in sprite px
    this.sprites = PALETTE.map((col) => {
      const frames: HTMLCanvasElement[] = [];
      for (let f = 0; f < FRAMES; f++) {
        const cv = document.createElement('canvas');
        cv.width = cv.height = px;
        const g = cv.getContext('2d')!;
        g.translate(px / 2, px / 2);
        // Body
        const grad = g.createRadialGradient(-R * 0.3, -R * 0.3, R * 0.1, 0, 0, R);
        grad.addColorStop(0, col.light);
        grad.addColorStop(0.45, col.base);
        grad.addColorStop(1, col.dark);
        g.fillStyle = grad;
        g.beginPath();
        g.arc(0, 0, R, 0, Math.PI * 2);
        g.fill();
        // Rolling bands: meridians at longitude θ appear at x = R·sinθ·cosφ.
        g.save();
        g.beginPath();
        g.arc(0, 0, R, 0, Math.PI * 2);
        g.clip();
        const phase = (f / FRAMES) * Math.PI;
        for (const base of [phase, phase + Math.PI]) {
          const a0 = wrap(base - 0.32);
          const a1 = wrap(base + 0.32);
          drawBand(g, R, a0, a1, 'rgba(255,255,255,0.28)');
          drawBand(g, R, wrap(base + Math.PI / 2 - 0.08), wrap(base + Math.PI / 2 + 0.08), 'rgba(0,0,0,0.18)');
        }
        g.restore();
        // Rim shading
        const rim = g.createRadialGradient(0, 0, R * 0.6, 0, 0, R);
        rim.addColorStop(0, 'rgba(0,0,0,0)');
        rim.addColorStop(1, 'rgba(0,0,0,0.38)');
        g.fillStyle = rim;
        g.beginPath();
        g.arc(0, 0, R, 0, Math.PI * 2);
        g.fill();
        frames.push(cv);
      }
      return frames;
    });
    // Fixed specular highlight (screen-aligned light from top-left).
    const hi = document.createElement('canvas');
    hi.width = hi.height = px;
    const g = hi.getContext('2d')!;
    g.translate(px / 2, px / 2);
    const sp = g.createRadialGradient(-R * 0.38, -R * 0.42, 0, -R * 0.38, -R * 0.42, R * 0.55);
    sp.addColorStop(0, 'rgba(255,255,255,0.95)');
    sp.addColorStop(0.25, 'rgba(255,255,255,0.45)');
    sp.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = sp;
    g.beginPath();
    g.arc(0, 0, R, 0, Math.PI * 2);
    g.fill();
    // Bounce light on the lower right rim.
    g.strokeStyle = 'rgba(255,255,255,0.22)';
    g.lineWidth = R * 0.12;
    g.beginPath();
    g.arc(0, 0, R * 0.86, Math.PI * 0.1, Math.PI * 0.55);
    g.stroke();
    this.hi = hi;
    // Contact shadow
    const sh = document.createElement('canvas');
    sh.width = sh.height = px;
    const s = sh.getContext('2d')!;
    const sg = s.createRadialGradient(px / 2, px / 2, R * 0.2, px / 2, px / 2, R * 1.05);
    sg.addColorStop(0, 'rgba(0,0,0,0.55)');
    sg.addColorStop(1, 'rgba(0,0,0,0)');
    s.fillStyle = sg;
    s.fillRect(0, 0, px, px);
    this.shadow = sh;
  }

  private glows = new Map<string, HTMLCanvasElement>();
  /** Soft radial glow in a colour, cached (64×64). */
  glowSprite(color: string): HTMLCanvasElement {
    let c = this.glows.get(color);
    if (!c) {
      c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d')!;
      const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, color);
      gr.addColorStop(0.35, color);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.globalAlpha = 0.55;
      g.fillStyle = gr;
      g.fillRect(0, 0, 64, 64);
      this.glows.set(color, c);
    }
    return c;
  }

  // ------------------------------------------------------------ static background

  private buildBackground() {
    const L = this.L;
    const lvl = this.level;
    const key = `${L.vw}x${L.vh}@${L.dpr}:${lvl.campaignSeed}:${lvl.index}`;
    if (key === this.bgKey && this.bg) return;
    this.bgKey = key;
    const cv = this.bg ?? document.createElement('canvas');
    cv.width = this.canvas.width;
    cv.height = this.canvas.height;
    const g = cv.getContext('2d')!;
    const k = L.dpr;
    const hue = this.hue;
    // Screen background
    g.setTransform(1, 0, 0, 1, 0, 0);
    const bgr = g.createRadialGradient(cv.width / 2, cv.height * 0.45, 0, cv.width / 2, cv.height / 2, Math.max(cv.width, cv.height) * 0.75);
    bgr.addColorStop(0, `hsl(${hue}, 45%, 14%)`);
    bgr.addColorStop(0.6, `hsl(${hue + 20}, 50%, 7%)`);
    bgr.addColorStop(1, `hsl(${hue + 30}, 55%, 3%)`);
    g.fillStyle = bgr;
    g.fillRect(0, 0, cv.width, cv.height);
    // Stars / dust
    let seed = lvl.seed || 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    for (let i = 0; i < 160; i++) {
      g.fillStyle = `rgba(255,255,255,${0.04 + rnd() * 0.18})`;
      const r = rnd() * 1.6 * k;
      g.beginPath();
      g.arc(rnd() * cv.width, rnd() * cv.height, r, 0, Math.PI * 2);
      g.fill();
    }

    applyWorld(g, L);
    // Board panel
    g.save();
    roundRect(g, -6, -6, lvl.worldW + 12, lvl.worldH + 12, 28);
    const panel = g.createLinearGradient(0, 0, lvl.worldW, lvl.worldH);
    panel.addColorStop(0, `hsla(${hue}, 40%, 18%, 0.55)`);
    panel.addColorStop(1, `hsla(${hue + 40}, 40%, 10%, 0.55)`);
    g.fillStyle = panel;
    g.fill();
    g.strokeStyle = `hsla(${hue}, 70%, 70%, 0.12)`;
    g.lineWidth = 2;
    g.stroke();
    g.clip();
    // Concentric temple rings around the launcher
    const lc = lvl.launcher;
    for (let r = 70; r < 900; r += 46) {
      g.strokeStyle = `hsla(${hue}, 60%, 70%, ${0.05 * Math.max(0, 1 - r / 900)})`;
      g.lineWidth = r % 92 === 70 % 92 ? 2 : 1;
      g.beginPath();
      g.arc(lc.x, lc.y, r, 0, Math.PI * 2);
      g.stroke();
    }
    // Track
    const tr = lvl.track;
    const path = new Path2D();
    path.moveTo(tr.xs[0], tr.ys[0]);
    for (let i = 1; i < tr.xs.length; i += 2) path.lineTo(tr.xs[i], tr.ys[i]);
    path.lineTo(tr.xs[tr.xs.length - 1], tr.ys[tr.ys.length - 1]);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.shadowColor = `hsla(${hue}, 90%, 60%, 0.55)`;
    g.shadowBlur = 26 * L.scale * k;
    g.strokeStyle = `hsla(${hue}, 80%, 55%, 0.16)`;
    g.lineWidth = BALL_D + 22;
    g.stroke(path);
    g.shadowBlur = 0;
    g.strokeStyle = '#04070e';
    g.lineWidth = BALL_D + 12;
    g.stroke(path);
    g.strokeStyle = `hsla(${hue}, 60%, 75%, 0.22)`;
    g.lineWidth = BALL_D + 8;
    g.stroke(path);
    g.strokeStyle = `hsl(${hue}, 45%, 9%)`;
    g.lineWidth = BALL_D + 3;
    g.stroke(path);
    g.setLineDash([2, 14]);
    g.strokeStyle = `hsla(${hue}, 80%, 75%, 0.25)`;
    g.lineWidth = 2;
    g.stroke(path);
    g.setLineDash([]);
    // End pit
    const end = pointAt(tr, tr.length);
    const pit = g.createRadialGradient(end.x, end.y, 0, end.x, end.y, BALL_R * 2.1);
    pit.addColorStop(0, '#000');
    pit.addColorStop(0.7, '#05030a');
    pit.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = pit;
    g.beginPath();
    g.arc(end.x, end.y, BALL_R * 2.1, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(255,190,90,0.55)';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(end.x, end.y, BALL_R * 1.6, 0, Math.PI * 2);
    g.stroke();
    // Launcher pad
    const pad = g.createRadialGradient(lc.x, lc.y, 10, lc.x, lc.y, 64);
    pad.addColorStop(0, `hsla(${hue}, 30%, 30%, 0.9)`);
    pad.addColorStop(1, `hsla(${hue}, 30%, 12%, 0.0)`);
    g.fillStyle = pad;
    g.beginPath();
    g.arc(lc.x, lc.y, 64, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = `hsla(${hue}, 70%, 75%, 0.35)`;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(lc.x, lc.y, 54, 0, Math.PI * 2);
    g.stroke();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      g.beginPath();
      g.moveTo(lc.x + Math.cos(a) * 54, lc.y + Math.sin(a) * 54);
      g.lineTo(lc.x + Math.cos(a) * 60, lc.y + Math.sin(a) * 60);
      g.stroke();
    }
    g.restore();
    this.bg = cv;
  }

  // ------------------------------------------------------------ frame

  draw(st: GameState, v: ViewState, fx: Particles) {
    const L = this.L;
    const g = this.ctx;
    const lvl = this.level;
    this.buildBackground();
    g.setTransform(1, 0, 0, 1, 0, 0);
    const sx = v.shake.x * L.dpr;
    const sy = v.shake.y * L.dpr;
    g.drawImage(this.bg!, sx, sy);

    applyWorld(g, L, v.shake);

    // Slow / reverse / laser board tints
    if (st.slowT > 0 || st.revT > 0) {
      g.fillStyle = st.slowT > 0 ? 'rgba(80,160,255,0.07)' : 'rgba(255,200,80,0.06)';
      g.fillRect(0, 0, lvl.worldW, lvl.worldH);
    }

    // Aim guide (under the balls)
    if (v.showGuide && (v.aimActive || v.aimIdle) && st.phase === 'playing') this.drawAim(st, v);

    // Balls
    const pos: Pt = { x: 0, y: 0 };
    const vis = lvl.track.visibleFrom - BALL_R;
    const rot = L.portrait ? -Math.PI / 2 : 0;
    // Shadows pass
    for (const b of st.balls) {
      if (b.s < vis) continue;
      ballPos(lvl, b, pos);
      const sc = this.ballScale(b, v);
      this.blit(this.shadow, pos.x + 3, pos.y + 5, 0, sc * 1.05);
    }
    // Magnet arcs between attracting ends
    for (let i = 1; i < st.balls.length; i++) {
      const b = st.balls[i];
      if (b.suck <= 0) continue;
      const a = pointAt(lvl.track, st.balls[i - 1].s);
      const p = pointAt(lvl.track, b.s);
      const col = PALETTE[b.c];
      const flick = 0.5 + 0.5 * Math.sin(v.time * 40);
      g.beginPath();
      g.moveTo(a.x, a.y);
      const mx = (a.x + p.x) / 2 + Math.sin(v.time * 30) * 6;
      const my = (a.y + p.y) / 2 + Math.cos(v.time * 27) * 6;
      g.quadraticCurveTo(mx, my, p.x, p.y);
      // Glow = wide translucent stroke under a thin bright one (shadowBlur is slow on phones).
      g.strokeStyle = col.base;
      g.globalAlpha = 0.25 * flick;
      g.lineWidth = 10;
      g.stroke();
      g.strokeStyle = col.light;
      g.globalAlpha = 0.5 + 0.5 * flick;
      g.lineWidth = 3;
      g.stroke();
      g.globalAlpha = 1;
    }
    for (const b of st.balls) {
      if (b.s < vis) continue;
      ballPos(lvl, b, pos);
      this.drawBall(b, pos, v, rot);
    }

    // Projectiles with trails
    for (const sh of st.shots) {
      const trail = v.shotTrails.get(sh.id);
      const col = PALETTE[sh.c];
      if (trail && trail.length > 1) {
        for (let i = 1; i < trail.length; i++) {
          const t = i / trail.length;
          g.strokeStyle = col.light;
          g.globalAlpha = t * 0.45;
          g.lineWidth = BALL_D * 0.9 * t;
          g.lineCap = 'round';
          g.beginPath();
          g.moveTo(trail[i - 1].x, trail[i - 1].y);
          g.lineTo(trail[i].x, trail[i].y);
          g.stroke();
        }
        g.globalAlpha = 1;
      }
      const ang = Math.atan2(sh.vy, sh.vx);
      this.drawMarble(sh.c, sh.x, sh.y, ang, v.time * 30, 1, rot, 1.18, 0.88);
    }

    this.drawLauncher(st, v, rot);

    // Particles (world)
    this.drawParticles(fx, false);

    // ---- screen space
    g.setTransform(L.dpr, 0, 0, L.dpr, v.shake.x * L.dpr, v.shake.y * L.dpr);
    this.drawSkull(v);
    this.drawParticles(fx, true);
    g.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
    // Danger vignette
    if (v.danger > 0) {
      const pulse = 0.65 + 0.35 * Math.sin(v.time * (5 + v.danger * 7));
      const a = 0.42 * v.danger * pulse;
      const vg = g.createRadialGradient(L.vw / 2, L.vh / 2, Math.min(L.vw, L.vh) * 0.35, L.vw / 2, L.vh / 2, Math.max(L.vw, L.vh) * 0.75);
      vg.addColorStop(0, 'rgba(255,0,40,0)');
      vg.addColorStop(1, `rgba(255,20,50,${a})`);
      g.fillStyle = vg;
      g.fillRect(0, 0, L.vw, L.vh);
    }
    if (v.banner) this.drawBanner(v);
    if (v.flash > 0.001) {
      g.fillStyle = `rgba(255,255,255,${Math.min(0.8, v.flash)})`;
      g.fillRect(0, 0, L.vw, L.vh);
    }
  }

  private ballScale(b: Ball, v: ViewState): number {
    let sc = 1;
    if (b.clr >= 0) {
      const t = b.clr / TUNING.clearTime;
      sc = 1 + 0.35 * Math.sin(Math.min(1, t) * Math.PI * 0.5) - (t > 0.6 ? (t - 0.6) * 2.2 : 0);
    }
    const r = v.ripples.get(b.id);
    if (r !== undefined) sc += r;
    return Math.max(0.05, sc);
  }

  private drawBall(b: Ball, pos: Pt, v: ViewState, rot: number) {
    const lvl = this.level;
    const g = this.ctx;
    const tan = tangentAt(lvl.track, b.s);
    const ang = Math.atan2(tan.y, tan.x);
    const sc = this.ballScale(b, v);
    let alpha = 1;
    if (b.clr >= 0) alpha = Math.max(0, 1 - Math.max(0, b.clr / TUNING.clearTime - 0.5) * 2);
    g.globalAlpha = alpha;
    this.drawMarble(b.c, pos.x, pos.y, ang, b.s / BALL_R, sc, rot);
    if (b.clr >= 0) {
      // White-hot flash as it pops.
      const t = b.clr / TUNING.clearTime;
      g.globalAlpha = Math.max(0, 0.9 - t * 1.4);
      g.fillStyle = '#fff';
      g.beginPath();
      g.arc(pos.x, pos.y, BALL_R * sc, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
    if (v.colorblind && b.clr < 0) this.drawGlyph(b.c, pos.x, pos.y, rot, sc);
    if (b.p !== Power.None && b.clr < 0) {
      const blink = b.pt < 3 ? (Math.sin(v.time * 18) > 0 ? 1 : 0.25) : 1;
      g.globalAlpha = blink;
      const pr = BALL_R * (1.25 + 0.12 * Math.sin(v.time * 6));
      g.beginPath();
      g.arc(pos.x, pos.y, pr, 0, Math.PI * 2);
      g.strokeStyle = 'rgba(255,255,255,0.25)';
      g.lineWidth = 8;
      g.stroke();
      g.strokeStyle = '#fff';
      g.lineWidth = 2.5;
      g.stroke();
      this.drawPowerIcon(b.p, pos.x, pos.y, BALL_R * 0.62, rot);
      g.globalAlpha = 1;
    }
  }

  /** Draw a marble sprite. roll = rolling angle in radians, ang = travel direction. */
  drawMarble(c: number, x: number, y: number, ang: number, roll: number, sc: number, rot: number, stretchX = 1, stretchY = 1) {
    const g = this.ctx;
    const frames = this.sprites[c];
    if (!frames) return;
    const f = (((Math.floor((roll / Math.PI) * FRAMES) % FRAMES) + FRAMES) % FRAMES) | 0;
    const size = (BALL_D + 4) * sc;
    g.save();
    g.translate(x, y);
    g.rotate(ang);
    g.scale(stretchX, stretchY);
    g.drawImage(frames[f], -size / 2, -size / 2, size, size);
    g.restore();
    // Highlight stays fixed relative to the screen light.
    g.save();
    g.translate(x, y);
    g.rotate(rot);
    g.drawImage(this.hi, -size / 2, -size / 2, size, size);
    g.restore();
  }

  private blit(img: HTMLCanvasElement, x: number, y: number, ang: number, sc: number) {
    const g = this.ctx;
    const size = (BALL_D + 4) * sc;
    if (ang) {
      g.save();
      g.translate(x, y);
      g.rotate(ang);
      g.drawImage(img, -size / 2, -size / 2, size, size);
      g.restore();
    } else g.drawImage(img, x - size / 2, y - size / 2, size, size);
  }

  private drawGlyph(c: number, x: number, y: number, rot: number, sc: number) {
    const g = this.ctx;
    const r = BALL_R * 0.42 * sc;
    g.save();
    g.translate(x, y);
    g.rotate(rot);
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.lineWidth = 1.5;
    g.beginPath();
    const kind = PALETTE[c].glyph;
    if (kind === 'circle') g.arc(0, 0, r * 0.8, 0, Math.PI * 2);
    else if (kind === 'triangle') {
      g.moveTo(0, -r);
      g.lineTo(r * 0.9, r * 0.7);
      g.lineTo(-r * 0.9, r * 0.7);
      g.closePath();
    } else if (kind === 'square') g.rect(-r * 0.7, -r * 0.7, r * 1.4, r * 1.4);
    else if (kind === 'diamond') {
      g.moveTo(0, -r);
      g.lineTo(r, 0);
      g.lineTo(0, r);
      g.lineTo(-r, 0);
      g.closePath();
    } else if (kind === 'star') {
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rr = i % 2 ? r * 0.45 : r;
        g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      g.closePath();
    } else {
      const w = r * 0.35;
      g.rect(-w, -r, w * 2, r * 2);
      g.rect(-r, -w, r * 2, w * 2);
    }
    g.fill();
    g.stroke();
    g.restore();
  }

  drawPowerIcon(p: Power, x: number, y: number, r: number, rot: number) {
    const g = this.ctx;
    g.save();
    g.translate(x, y);
    g.rotate(rot);
    g.fillStyle = 'rgba(10,10,20,0.75)';
    g.beginPath();
    g.arc(0, 0, r * 1.15, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#fff';
    g.fillStyle = '#fff';
    g.lineWidth = r * 0.22;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath();
    if (p === Power.Bomb) {
      g.arc(0, r * 0.12, r * 0.55, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.moveTo(r * 0.3, -r * 0.35);
      g.quadraticCurveTo(r * 0.6, -r * 0.9, r * 0.9, -r * 0.7);
      g.stroke();
      g.fillStyle = '#ffcc33';
      g.beginPath();
      g.arc(r * 0.9, -r * 0.72, r * 0.18, 0, Math.PI * 2);
      g.fill();
    } else if (p === Power.Slow) {
      g.arc(0, 0, r * 0.7, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.moveTo(0, -r * 0.45);
      g.lineTo(0, 0);
      g.lineTo(r * 0.35, r * 0.2);
      g.stroke();
    } else if (p === Power.Reverse) {
      for (const dx of [-0.42, 0.22]) {
        g.beginPath();
        g.moveTo((dx + 0.3) * r, -r * 0.5);
        g.lineTo(dx * r - r * 0.1, 0);
        g.lineTo((dx + 0.3) * r, r * 0.5);
        g.stroke();
      }
    } else if (p === Power.Aim) {
      g.arc(0, 0, r * 0.6, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.moveTo(0, -r * 0.95);
      g.lineTo(0, -r * 0.3);
      g.moveTo(0, r * 0.95);
      g.lineTo(0, r * 0.3);
      g.moveTo(-r * 0.95, 0);
      g.lineTo(-r * 0.3, 0);
      g.moveTo(r * 0.95, 0);
      g.lineTo(r * 0.3, 0);
      g.stroke();
    }
    g.restore();
  }

  private drawAim(st: GameState, v: ViewState) {
    const g = this.ctx;
    const lc = this.level.launcher;
    const dx = Math.cos(v.aimShot);
    const dy = Math.sin(v.aimShot);
    const ox = lc.x + dx * TUNING.muzzle;
    const oy = lc.y + dy * TUNING.muzzle;
    const hit = v.aimHit;
    const dist = hit ? hit.dist : 1600;
    const col = PALETTE[st.gun.cur];
    if (v.aimCancel) {
      // Greyed, dashed guide with an ✕: releasing now will not shoot.
      const end = Math.min(dist, 260);
      g.setLineDash([8, 10]);
      g.strokeStyle = 'rgba(200,210,230,0.45)';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(ox, oy);
      g.lineTo(ox + dx * end, oy + dy * end);
      g.stroke();
      g.setLineDash([]);
      const ex = ox + dx * (end + 16);
      const ey = oy + dy * (end + 16);
      g.strokeStyle = '#ff5a76';
      g.lineWidth = 4;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(ex - 9, ey - 9);
      g.lineTo(ex + 9, ey + 9);
      g.moveTo(ex + 9, ey - 9);
      g.lineTo(ex - 9, ey + 9);
      g.stroke();
      return;
    }
    const laser = st.aimT > 0;
    if (laser) {
      g.beginPath();
      g.moveTo(ox, oy);
      g.lineTo(ox + dx * dist, oy + dy * dist);
      g.strokeStyle = col.base;
      g.globalAlpha = 0.3;
      g.lineWidth = 14;
      g.stroke();
      g.strokeStyle = col.light;
      g.globalAlpha = 0.85;
      g.lineWidth = 4;
      g.stroke();
      g.lineWidth = 1.5;
      g.strokeStyle = '#fff';
      g.stroke();
      g.globalAlpha = 1;
    } else {
      const spacing = 24;
      const off = (v.time * 90) % spacing;
      const maxD = hit ? dist : 520;
      for (let d = off; d < maxD; d += spacing) {
        const fade = hit ? 0.9 : Math.max(0, 1 - d / maxD);
        g.globalAlpha = 0.55 * fade;
        g.fillStyle = col.light;
        g.beginPath();
        g.arc(ox + dx * d, oy + dy * d, 3.4, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
    }
    if (!hit) return;
    const target = st.balls[hit.index];
    if (!target) return;
    const tp = pointAt(this.level.track, target.s);
    const pulse = 0.5 + 0.5 * Math.sin(v.time * 12);
    // Target ring
    g.strokeStyle = v.aimWillPop ? col.light : 'rgba(255,255,255,0.75)';
    g.lineWidth = v.aimWillPop ? 3.5 : 2;
    g.globalAlpha = 0.6 + 0.4 * pulse;
    g.beginPath();
    g.arc(tp.x, tp.y, BALL_R + 4 + pulse * 2, 0, Math.PI * 2);
    g.stroke();
    // Ghost marble in the slot it would take
    const gs = target.s + (hit.front ? BALL_D * 0.5 : -BALL_D * 0.5);
    const gp = pointAt(this.level.track, gs);
    const n = tangentAt(this.level.track, gs);
    // Push the ghost out of the track slightly toward the shooter so it reads as "incoming".
    const side = (lc.x - gp.x) * -n.y + (lc.y - gp.y) * n.x > 0 ? 1 : -1;
    const gx = gp.x - n.y * side * BALL_R * 0.55;
    const gy = gp.y + n.x * side * BALL_R * 0.55;
    g.globalAlpha = v.aimWillPop ? 0.75 : 0.42;
    const gsz = v.aimWillPop ? 0.85 + pulse * 0.12 : 0.78;
    this.drawMarble(st.gun.cur, gx, gy, 0, 0, gsz, this.L.portrait ? -Math.PI / 2 : 0);
    g.globalAlpha = 1;
    if (v.aimWillPop) {
      g.strokeStyle = '#fff';
      g.globalAlpha = 0.35 * pulse;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(gx, gy, BALL_R * 1.25, 0, Math.PI * 2);
      g.stroke();
      g.globalAlpha = 1;
    }
  }

  private drawLauncher(st: GameState, v: ViewState, rot: number) {
    const g = this.ctx;
    const lc = this.level.launcher;
    const a = v.aimAngle;
    const rec = v.recoil * FEEL.recoilPx;
    const cx = lc.x - Math.cos(a) * rec;
    const cy = lc.y - Math.sin(a) * rec;
    const cur = PALETTE[st.gun.cur];
    g.save();
    g.translate(cx, cy);
    g.rotate(a);
    // Glow in current colour (cached sprite; shadowBlur is slow on phones)
    g.drawImage(this.glowSprite(cur.base), -76, -76, 152, 152);
    drawCharacter(g, this.character, { t: v.time, blink: blinkAt(v.time), recoil: v.recoil });
    g.restore();
    // Current ball in the mouth (slides forward as cooldown recovers)
    const load = 1 - Math.min(1, st.gun.cool / TUNING.cooldown);
    const md = MOUTH_X - rec + load * 2;
    const scale = 0.55 + 0.45 * easeOutBack(load);
    this.drawMarble(st.gun.cur, cx + Math.cos(a) * md, cy + Math.sin(a) * md, a, v.time * 2, scale, rot);
    // Next ball on the back
    const nd = -30;
    this.drawMarble(st.gun.next, cx + Math.cos(a) * nd, cy + Math.sin(a) * nd, a, 0, 0.52, rot);
  }

  private drawSkull(v: ViewState) {
    const g = this.ctx;
    const tr = this.level.track;
    const end = worldToScreen(this.L, pointAt(tr, tr.length));
    const s = this.L.scale * 1.15;
    const jaw = v.danger * 7;
    g.save();
    g.translate(end.x, end.y);
    g.scale(s, s);
    // Glow
    if (v.danger > 0) {
      g.globalAlpha = Math.min(1, v.danger * 1.4);
      g.drawImage(this.glowSprite('#ff2840'), -44, -46, 88, 88);
      g.globalAlpha = 1;
    }
    g.fillStyle = '#efe3c6';
    g.beginPath();
    g.arc(0, -4, 17, Math.PI * 0.85, Math.PI * 2.15);
    g.lineTo(9, 9);
    g.lineTo(-9, 9);
    g.closePath();
    g.fill();
    // Jaw
    g.beginPath();
    g.roundRect(-9, 9 + jaw, 18, 8, 3);
    g.fill();
    g.fillStyle = '#1a0f0a';
    for (let i = -6; i <= 6; i += 4) g.fillRect(i - 0.8, 9 + jaw, 1.6, 4);
    // Eyes
    const eye = v.danger > 0 ? `rgba(255,${Math.round(80 - 60 * v.danger)},40,1)` : '#1a0f0a';
    g.fillStyle = eye;
    g.beginPath();
    g.arc(-6.5, -3, 4.6, 0, Math.PI * 2);
    g.arc(6.5, -3, 4.6, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#1a0f0a';
    g.beginPath();
    g.moveTo(0, 2);
    g.lineTo(-2.4, 6.5);
    g.lineTo(2.4, 6.5);
    g.closePath();
    g.fill();
    g.restore();
  }

  private drawParticles(fx: Particles, screen: boolean) {
    const g = this.ctx;
    const L = this.L;
    for (const p of fx.list) {
      const isText = p.k === PK.Text;
      if (isText !== screen) continue;
      const t = p.life / p.max;
      const a = 1 - t;
      switch (p.k) {
        case PK.Spark: {
          g.strokeStyle = p.color;
          g.globalAlpha = a;
          g.lineWidth = p.size;
          g.lineCap = 'round';
          g.beginPath();
          g.moveTo(p.x, p.y);
          g.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03);
          g.stroke();
          break;
        }
        case PK.Glow: {
          g.globalAlpha = a * 0.6;
          g.drawImage(this.glowSprite(p.color), p.x - p.size, p.y - p.size, p.size * 2, p.size * 2);
          break;
        }
        case PK.Shard:
        case PK.Confetti: {
          g.globalAlpha = p.k === PK.Confetti ? Math.min(1, a * 3) : a;
          g.fillStyle = p.color;
          g.save();
          g.translate(p.x, p.y);
          g.rotate(p.rot);
          const w = p.size;
          if (p.k === PK.Confetti) g.fillRect(-w / 2, -w / 4, w, w / 2 + Math.abs(Math.sin(p.rot * 2)) * w * 0.4);
          else {
            g.beginPath();
            g.moveTo(0, -w);
            g.lineTo(w * 0.6, w * 0.5);
            g.lineTo(-w * 0.6, w * 0.5);
            g.closePath();
            g.fill();
          }
          g.restore();
          break;
        }
        case PK.Ring: {
          g.strokeStyle = p.color;
          g.globalAlpha = a * 0.9;
          g.lineWidth = 2 + 6 * a;
          g.beginPath();
          g.arc(p.x, p.y, Math.max(0.1, p.size), 0, Math.PI * 2);
          g.stroke();
          break;
        }
        case PK.Text: {
          // p.x/p.y are world coords of the origin; vy drifts in screen space.
          const sp = worldToScreen(L, p);
          const pop = t < 0.15 ? easeOutBack(t / 0.15) : 1;
          const fs = (p.fs ?? 22) * pop * Math.max(0.75, Math.min(1.2, L.scale * 1.6));
          g.globalAlpha = t > 0.7 ? (1 - t) / 0.3 : 1;
          g.font = `900 ${fs}px "Baloo 2", system-ui, -apple-system, Segoe UI, sans-serif`;
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          const yy = sp.y + (p.oy ?? 0) * Math.max(0.75, Math.min(1.2, L.scale * 1.6)) - t * 46;
          g.lineWidth = Math.max(3, fs * 0.18);
          g.strokeStyle = 'rgba(0,0,0,0.6)';
          g.strokeText(p.text!, sp.x, yy);
          g.fillStyle = p.color;
          g.fillText(p.text!, sp.x, yy);
          break;
        }
      }
    }
    g.globalAlpha = 1;
  }

  private drawBanner(v: ViewState) {
    const g = this.ctx;
    const L = this.L;
    const b = v.banner!;
    const t = b.t;
    if (t > 1.8) return;
    const inT = Math.min(1, t / 0.25);
    const out = t > 1.4 ? (t - 1.4) / 0.4 : 0;
    const s = easeOutBack(inT) * (1 - out * 0.2);
    const cx = L.board.x + L.board.w / 2;
    const cy = L.board.y + L.board.h * 0.42;
    const fs = Math.min(64, L.vw / 9);
    g.save();
    g.globalAlpha = 1 - out;
    g.translate(cx, cy);
    g.scale(s, s);
    g.font = `900 ${fs}px "Baloo 2", system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = fs * 0.16;
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    g.strokeText(b.text, 0, 0);
    g.fillStyle = b.color;
    g.shadowColor = b.color;
    g.shadowBlur = 24;
    g.fillText(b.text, 0, 0);
    g.shadowBlur = 0;
    if (b.sub) {
      g.font = `700 ${fs * 0.36}px system-ui, sans-serif`;
      g.fillStyle = '#fff';
      g.lineWidth = 4;
      g.strokeText(b.sub, 0, fs * 0.72);
      g.fillText(b.sub, 0, fs * 0.72);
    }
    g.restore();
  }
}

// ------------------------------------------------------------ helpers

const iconCache = new Map<number, string>();
/** Power-up icon on a marble, as a data URL for DOM menus. */
export function powerIconUrl(p: Power, color = 3): string {
  let url = iconCache.get(p * 10 + color);
  if (url) return url;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 96;
  const g = cv.getContext('2d')!;
  const col = PALETTE[color];
  const gr = g.createRadialGradient(36, 34, 4, 48, 48, 44);
  gr.addColorStop(0, col.light);
  gr.addColorStop(0.5, col.base);
  gr.addColorStop(1, col.dark);
  g.fillStyle = gr;
  g.beginPath();
  g.arc(48, 48, 44, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#fff';
  g.lineWidth = 3;
  g.stroke();
  Renderer.prototype.drawPowerIcon.call({ ctx: g } as unknown as Renderer, p, 48, 48, 28, 0);
  url = cv.toDataURL();
  iconCache.set(p * 10 + color, url);
  return url;
}

function wrap(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** Band between longitudes a0..a1 (visible hemisphere is |θ| < π/2). */
function drawBand(g: CanvasRenderingContext2D, R: number, a0: number, a1: number, fill: string) {
  const lo = Math.max(-Math.PI / 2, a0);
  const hi = Math.min(Math.PI / 2, a1);
  if (a1 < a0 || hi <= lo) return;
  g.fillStyle = fill;
  g.beginPath();
  const N = 18;
  for (let i = 0; i <= N; i++) {
    const phi = -Math.PI / 2 + (i / N) * Math.PI;
    g.lineTo(R * Math.sin(hi) * Math.cos(phi), R * Math.sin(phi));
  }
  for (let i = N; i >= 0; i--) {
    const phi = -Math.PI / 2 + (i / N) * Math.PI;
    g.lineTo(R * Math.sin(lo) * Math.cos(phi), R * Math.sin(phi));
  }
  g.closePath();
  g.fill();
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

export function easeOutBack(t: number) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

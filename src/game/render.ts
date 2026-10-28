// Canvas 2D renderer. Static layers (background, track, launcher pad) are cached
// per layout; marbles use pre-rendered rolling sprite frames per colour.

import { BALL_D, BALL_R, type Level } from '../sim/levelgen';
import { type Ball, ballPos, type GameState, idolHand, launcherAt, Power, railPoint, type RayHit, TUNING, WILD } from '../sim/game';
import { pointAt, type Pt, tangentAt, type Track } from '../sim/track';
import { applyWorld, type Layout, worldToScreen } from './layout';
import { type Particles, PK } from './fx';
import { FEEL } from './feel';
import { blinkAt, type CharacterId, drawCharacter, MOUTH_X } from './characters';

export const PALETTE = [
  { base: '#ff3b5c', light: '#ffa3b4', dark: '#7a0820', glyph: 'circle' },
  { base: '#ffbe1f', light: '#ffe9a3', dark: '#8a4a00', glyph: 'triangle' },
  { base: '#22df8c', light: '#a6ffd6', dark: '#035e35', glyph: 'square' },
  // Blue is a light sky blue and purple a deep violet, so they stay apart for everyone
  // (blue/purple ΔE 49 → 89; under deuteranopia 3 → 31).
  { base: '#1cb0ff', light: '#a9e4ff', dark: '#063f7a', glyph: 'diamond' },
  { base: '#9a3cff', light: '#d6b3ff', dark: '#33087a', glyph: 'star' },
  { base: '#eef2ff', light: '#ffffff', dark: '#6f7899', glyph: 'cross' },
  // WILD (6): a rainbow marble from the Wild power-up.
  { base: '#ff9df0', light: '#ffffff', dark: '#5a2a8a', glyph: 'wild' },
];
const RAINBOW = ['#ff3b5c', '#ffbe1f', '#22df8c', '#1cb0ff', '#9a3cff', '#ff3b5c'];

const FRAMES = 12;
export const BOLT_LIFE = 0.45;

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
  ripple0: { s: number; t: number; c: number } | null;
  shotTrails: Map<number, Pt[]>;
  /** Lightning strikes: jagged polylines that flicker and fade (world coords). */
  bolts: { pts: Pt[]; t: number; color: string }[];
  colorblind: boolean;
  showGuide: boolean;
  /** Rail fights: the guide starts here (the spot the frog is heading for). */
  aimFrom: Pt | null;
  /** The guide passes through the bonus coin. */
  aimCoin: boolean;
  /** Trackpad aiming: the crosshair (world coords). */
  cursor: Pt | null;
  /** Sparks flying from pops to the boss (t: 0..1). */
  homing: { x: number; y: number; cx: number; cy: number; t: number; color: string }[];
  /** End-of-level light sweep along each track from `from` to the skull. */
  sweep: { t: number; dur: number; from: number[] } | null;
  /** Seconds since the boss was beaten (-1 while it's alive). */
  bossDown: number;
  /** Seconds since the serpent last spat (drives its lunge). */
  spitAge: number;
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
        if (col.glyph === 'wild') {
          // Rainbow swirl that turns as it rolls.
          const cg = g.createConicGradient((f / FRAMES) * Math.PI * 2, 0, 0);
          RAINBOW.forEach((c, i) => cg.addColorStop(i / (RAINBOW.length - 1), c));
          g.fillStyle = cg;
          g.beginPath();
          g.arc(0, 0, R, 0, Math.PI * 2);
          g.fill();
          const soft = g.createRadialGradient(-R * 0.3, -R * 0.3, R * 0.05, 0, 0, R);
          soft.addColorStop(0, 'rgba(255,255,255,0.85)');
          soft.addColorStop(0.5, 'rgba(255,255,255,0.1)');
          soft.addColorStop(1, 'rgba(40,0,60,0.35)');
          g.fillStyle = soft;
          g.fill();
        } else {
          const grad = g.createRadialGradient(-R * 0.3, -R * 0.3, R * 0.1, 0, 0, R);
          grad.addColorStop(0, col.light);
          grad.addColorStop(0.45, col.base);
          grad.addColorStop(1, col.dark);
          g.fillStyle = grad;
          g.beginPath();
          g.arc(0, 0, R, 0, Math.PI * 2);
          g.fill();
        }
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
    // Concentric temple rings around the launcher (around the boss in a boss fight)
    const lc = lvl.bossFight ?? lvl.launcher;
    for (let r = 70; r < 900; r += 46) {
      g.strokeStyle = `hsla(${hue}, 60%, 70%, ${0.05 * Math.max(0, 1 - r / 900)})`;
      g.lineWidth = r % 92 === 70 % 92 ? 2 : 1;
      g.beginPath();
      g.arc(lc.x, lc.y, r, 0, Math.PI * 2);
      g.stroke();
    }
    // Tracks (a second chain's track glows in a shifted hue so the two read apart)
    lvl.tracks.forEach((tr, ti) => {
      const th = hue + ti * 70;
      const path = new Path2D();
      path.moveTo(tr.xs[0], tr.ys[0]);
      for (let i = 1; i < tr.xs.length; i += 2) path.lineTo(tr.xs[i], tr.ys[i]);
      path.lineTo(tr.xs[tr.xs.length - 1], tr.ys[tr.ys.length - 1]);
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.shadowColor = `hsla(${th}, 90%, 60%, 0.55)`;
      g.shadowBlur = 26 * L.scale * k;
      g.strokeStyle = `hsla(${th}, 80%, 55%, ${lvl.tracks.length > 1 ? 0.22 : 0.16})`;
      g.lineWidth = BALL_D + 22;
      g.stroke(path);
      g.shadowBlur = 0;
      g.strokeStyle = '#04070e';
      g.lineWidth = BALL_D + 12;
      g.stroke(path);
      g.strokeStyle = `hsla(${th}, 60%, 75%, 0.22)`;
      g.lineWidth = BALL_D + 8;
      g.stroke(path);
      g.strokeStyle = `hsl(${th}, 45%, 9%)`;
      g.lineWidth = BALL_D + 3;
      g.stroke(path);
      g.setLineDash([2, 14]);
      g.strokeStyle = `hsla(${th}, 80%, 75%, 0.25)`;
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
    });
    if (lvl.rail) {
      this.drawRail(g, hue);
      g.restore();
      this.bg = cv;
      return;
    }
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

  /** The frog's rail: a groove with sleepers and end stops. */
  private drawRail(g: CanvasRenderingContext2D, hue: number) {
    const R = this.level.rail!;
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

    if (v.sweep) this.drawSweep(v);
    if (st.coin) this.drawCoin(st.coin, v);
    // Aim guide (under the balls)
    if (v.showGuide && (v.aimActive || v.aimIdle) && st.phase === 'playing') this.drawAim(st, v);

    // Black holes sit under the marbles they swallow.
    for (const h of st.holes) this.drawHole(lvl.tracks[h.ci], h, v);
    // Balls
    const pos: Pt = { x: 0, y: 0 };
    const rot = L.portrait ? -Math.PI / 2 : 0;
    // Marbles on a bridge are drawn after the bridge deck; everything else (including
    // marbles rolling through a tunnel) goes underneath it.
    const onBridge = (tr: Track, b: Ball) => !!tr.bridges && b.ins >= 1 && tr.bridges.some(([a, c]) => b.s > a && b.s < c);
    // Shadows pass
    st.chains.forEach((ch, ci) => {
      const tr = lvl.tracks[ci];
      const vis = tr.visibleFrom - BALL_R;
      for (const b of ch.balls) {
        if (b.s < vis || onBridge(tr, b)) continue;
        ballPos(tr, b, pos);
        const sc = this.ballScale(b, v);
        this.blit(this.shadow, pos.x + 3, pos.y + 5, 0, sc * 1.05);
      }
    });
    // Magnet arcs between attracting ends
    st.chains.forEach((ch, ci) => {
     const tr = lvl.tracks[ci];
     for (let i = 1; i < ch.balls.length; i++) {
      const b = ch.balls[i];
      if (b.suck <= 0) continue;
      const a = pointAt(tr, ch.balls[i - 1].s);
      const p = pointAt(tr, b.s);
      const col = PALETTE[b.c] ?? PALETTE[0];
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
    });
    st.chains.forEach((ch, ci) => {
      const tr = lvl.tracks[ci];
      const vis = tr.visibleFrom - BALL_R;
      for (const b of ch.balls) {
        if (b.s < vis || onBridge(tr, b)) continue;
        ballPos(tr, b, pos);
        this.drawBall(b, pos, v, rot, tr);
      }
    });
    // Tunnels cover the marbles rolling through them.
    for (const tr of lvl.tracks) for (const [a, c] of tr.tunnels ?? []) this.drawTunnel(tr, a, c);
    // Bridges, then the marbles crossing them.
    lvl.tracks.forEach((tr, ti) => {
      if (!tr.bridges) return;
      for (const [a, c] of tr.bridges) this.drawBridge(tr, a, c, this.hue + ti * 70);
      for (const b of st.chains[ti]?.balls ?? []) {
        if (!onBridge(tr, b)) continue;
        ballPos(tr, b, pos);
        const sc = this.ballScale(b, v);
        this.blit(this.shadow, pos.x + 3, pos.y + 5, 0, sc * 1.05);
        this.drawBall(b, pos, v, rot, tr);
      }
    });

    for (const sc of st.scorps) this.drawScorpion(lvl.tracks[sc.ci], sc.s, v);
    if (lvl.bossFight && st.boss) this.drawBoss(st, v);

    // Projectiles with trails
    for (const sh of st.shots) {
      const trail = v.shotTrails.get(sh.id);
      const col = PALETTE[sh.w ? WILD : sh.c];
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
      this.drawMarble(sh.w ? WILD : sh.c, sh.x, sh.y, ang, v.time * 30, 1, rot, 1.18, 0.88);
      if (sh.b) this.drawBombMark(sh.x, sh.y, BALL_R, v);
      if (st.magnetT > 0 && !sh.w && !sh.b) g.drawImage(this.glowSprite('#ff5a6a'), sh.x - 34, sh.y - 34, 68, 68);
    }

    this.drawLauncher(st, v, rot);
    if (st.boss) this.drawRocks(st, v);
    this.drawBolts(v);
    this.drawHoming(v);
    if (v.cursor && st.phase === 'playing') this.drawCursor(v.cursor, v);

    // Particles (world)
    this.drawParticles(fx, false);

    // ---- screen space
    g.setTransform(L.dpr, 0, 0, L.dpr, v.shake.x * L.dpr, v.shake.y * L.dpr);
    this.drawSkull(v, st);
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

  private drawBall(b: Ball, pos: Pt, v: ViewState, rot: number, track: Track) {
    const g = this.ctx;
    const tan = tangentAt(track, b.s);
    const ang = Math.atan2(tan.y, tan.x);
    const sc = this.ballScale(b, v);
    let alpha = 1;
    if (b.clr >= 0) alpha = Math.max(0, 1 - Math.max(0, b.clr / TUNING.clearTime - 0.5) * 2);
    g.globalAlpha = alpha;
    this.drawMarble(b.w ? WILD : b.c, pos.x, pos.y, ang, b.s / BALL_R, sc, rot);
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
    if (b.clr < 0 && (b.a || b.cm || b.gem)) this.drawSpecial(b, pos, sc, v);
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

  /** Armored plates, a chameleon's shifting ring, or a gem's sparkle over a marble. */
  private drawSpecial(b: Ball, pos: Pt, sc: number, v: ViewState) {
    const g = this.ctx;
    const r = BALL_R * sc;
    g.save();
    g.translate(pos.x, pos.y);
    if (b.a) {
      // Steel band with rivets: it takes two pops.
      g.strokeStyle = 'rgba(20,24,30,0.9)';
      g.lineWidth = r * 0.42;
      g.beginPath();
      g.arc(0, 0, r * 0.8, 0, Math.PI * 2);
      g.stroke();
      g.strokeStyle = '#c9d2dc';
      g.lineWidth = r * 0.26;
      g.stroke();
      g.fillStyle = '#5b6672';
      for (let k = 0; k < 6; k++) {
        const a = (k * Math.PI) / 3 + Math.PI / 6;
        g.beginPath();
        g.arc(Math.cos(a) * r * 0.8, Math.sin(a) * r * 0.8, r * 0.09, 0, Math.PI * 2);
        g.fill();
      }
    }
    if (b.cm) {
      // Rotating rainbow dashes: its colour will change.
      g.rotate(v.time * 2.5);
      const cg = g.createConicGradient(0, 0, 0);
      RAINBOW.forEach((c, i) => cg.addColorStop(i / (RAINBOW.length - 1), c));
      g.strokeStyle = cg;
      g.lineWidth = r * 0.22;
      g.setLineDash([r * 0.45, r * 0.3]);
      g.beginPath();
      g.arc(0, 0, r * 1.08, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
    }
    if (b.gem) {
      // A cut gem shine, twinkling.
      const tw = 0.6 + 0.4 * Math.sin(v.time * 5 + b.id);
      g.fillStyle = `rgba(255,255,255,${0.75 * tw})`;
      g.beginPath();
      g.moveTo(0, -r * 0.62);
      g.lineTo(r * 0.42, -r * 0.1);
      g.lineTo(0, r * 0.55);
      g.lineTo(-r * 0.42, -r * 0.1);
      g.closePath();
      g.fill();
      g.strokeStyle = `rgba(255,240,170,${tw})`;
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(0, 0, r * 1.05, 0, Math.PI * 2);
      g.stroke();
    }
    g.restore();
  }

  /** Black hole: a swirling vortex on the track that swallows marbles. */
  private drawHole(tr: Track, h: { s: number; t: number }, v: ViewState) {
    const g = this.ctx;
    const p = pointAt(tr, h.s);
    const life = Math.min(1, h.t / 0.4, (TUNING.holeTime - h.t + 0.05) / 0.25);
    const R = BALL_R * 1.6 * life;
    g.save();
    g.translate(p.x, p.y);
    g.drawImage(this.glowSprite('#a35bff'), -R * 2.4, -R * 2.4, R * 4.8, R * 4.8);
    const grad = g.createRadialGradient(0, 0, 0, 0, 0, R);
    grad.addColorStop(0, '#000');
    grad.addColorStop(0.6, '#12002a');
    grad.addColorStop(1, 'rgba(120,60,255,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(0, 0, R, 0, Math.PI * 2);
    g.fill();
    g.rotate(-v.time * 6);
    g.strokeStyle = 'rgba(200,160,255,0.8)';
    g.lineWidth = 2;
    for (let k = 0; k < 3; k++) {
      g.rotate((Math.PI * 2) / 3);
      g.beginPath();
      g.arc(R * 0.35, 0, R * 0.55, Math.PI * 0.9, Math.PI * 1.6);
      g.stroke();
    }
    g.restore();
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
    if (kind === 'wild') {
      g.restore();
      return;
    }
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

  /** A raised stretch of track: drop shadow onto the track below, bright rails, the usual groove. */
  private drawBridge(tr: Track, s0: number, s1: number, hue: number) {
    const g = this.ctx;
    const path = new Path2D();
    const p0 = pointAt(tr, s0);
    path.moveTo(p0.x, p0.y);
    for (let s = s0 + 4; s <= s1; s += 4) {
      const p = pointAt(tr, s);
      path.lineTo(p.x, p.y);
    }
    g.save();
    g.lineCap = 'butt';
    g.lineJoin = 'round';
    g.translate(4, 7);
    g.strokeStyle = 'rgba(0,0,0,0.5)';
    g.lineWidth = BALL_D + 26;
    g.stroke(path);
    g.translate(-4, -7);
    g.strokeStyle = `hsla(${hue}, 70%, 78%, 0.75)`;
    g.lineWidth = BALL_D + 18;
    g.stroke(path);
    g.strokeStyle = '#04070e';
    g.lineWidth = BALL_D + 11;
    g.stroke(path);
    g.strokeStyle = `hsl(${hue}, 40%, 14%)`;
    g.lineWidth = BALL_D + 3;
    g.stroke(path);
    g.setLineDash([2, 14]);
    g.strokeStyle = `hsla(${hue}, 80%, 75%, 0.3)`;
    g.lineWidth = 2;
    g.stroke(path);
    g.restore();
  }

  /** A rocky tunnel over the track from s0 to s1, with a dark mouth at each end. */
  private drawTunnel(tr: Track, s0: number, s1: number) {
    const g = this.ctx;
    const path = new Path2D();
    const p0 = pointAt(tr, s0);
    path.moveTo(p0.x, p0.y);
    for (let s = s0 + 4; s <= s1; s += 4) {
      const p = pointAt(tr, s);
      path.lineTo(p.x, p.y);
    }
    g.save();
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.translate(4, 7);
    g.strokeStyle = 'rgba(0,0,0,0.5)';
    g.lineWidth = BALL_D + 24;
    g.stroke(path);
    g.translate(-4, -7);
    g.strokeStyle = '#6b5a48';
    g.lineWidth = BALL_D + 20;
    g.stroke(path);
    g.strokeStyle = '#3a2e24';
    g.lineWidth = BALL_D + 12;
    g.stroke(path);
    g.setLineDash([5, 11]);
    g.strokeStyle = 'rgba(160,135,105,0.45)';
    g.lineWidth = 4;
    g.stroke(path);
    g.setLineDash([]);
    // Mouths: a dark opening facing along the track at each end
    for (const [s, dir] of [[s0, -1], [s1, 1]] as const) {
      const p = pointAt(tr, s);
      const t = tangentAt(tr, s);
      g.save();
      g.translate(p.x, p.y);
      g.rotate(Math.atan2(t.y, t.x) + (dir < 0 ? Math.PI : 0));
      g.fillStyle = '#050403';
      g.beginPath();
      g.ellipse(2, 0, BALL_R * 0.55, BALL_R * 1.15, 0, -Math.PI / 2, Math.PI / 2);
      g.fill();
      g.strokeStyle = '#8a765f';
      g.lineWidth = 3;
      g.beginPath();
      g.ellipse(2, 0, BALL_R * 0.55, BALL_R * 1.15, 0, -Math.PI / 2, Math.PI / 2);
      g.stroke();
      g.restore();
    }
    g.restore();
  }

  /** Lightning: a glow pass, a coloured core and a white-hot centre line, flickering as it fades. */
  private drawBolts(v: ViewState) {
    const g = this.ctx;
    for (const b of v.bolts) {
      const life = 1 - b.t / BOLT_LIFE;
      if (life <= 0 || b.pts.length < 2) continue;
      const flick = 0.55 + 0.45 * Math.sin(b.t * 90);
      g.save();
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.beginPath();
      g.moveTo(b.pts[0].x, b.pts[0].y);
      for (let i = 1; i < b.pts.length; i++) g.lineTo(b.pts[i].x, b.pts[i].y);
      g.strokeStyle = b.color;
      g.globalAlpha = 0.35 * life * flick;
      g.lineWidth = 16;
      g.stroke();
      g.globalAlpha = 0.9 * life;
      g.lineWidth = 5;
      g.stroke();
      g.strokeStyle = '#fff';
      g.lineWidth = 2;
      g.stroke();
      g.restore();
    }
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
    } else if (p === Power.Lightning) {
      // Bolt
      g.fillStyle = '#ffe14a';
      g.moveTo(r * 0.18, -r * 0.95);
      g.lineTo(-r * 0.5, r * 0.12);
      g.lineTo(-r * 0.02, r * 0.12);
      g.lineTo(-r * 0.2, r * 0.95);
      g.lineTo(r * 0.52, -r * 0.18);
      g.lineTo(r * 0.04, -r * 0.18);
      g.closePath();
      g.fill();
    } else if (p === Power.Wild) {
      // Rainbow ring around a white star
      const cg = g.createConicGradient(0, 0, 0);
      RAINBOW.forEach((c, i) => cg.addColorStop(i / (RAINBOW.length - 1), c));
      g.strokeStyle = cg;
      g.lineWidth = r * 0.3;
      g.arc(0, 0, r * 0.72, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rr = i % 2 ? r * 0.18 : r * 0.42;
        g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      g.closePath();
      g.fill();
    } else if (p === Power.Scorpion) {
      drawScorpionShape(g, r * 0.95, 0, '#ffb347');
    } else if (p === Power.ColorCloud) {
      // Three puffs in rainbow colours
      [[-0.38, 0.1, '#ff6b8a'], [0.36, 0.1, '#6bc7ff'], [0, -0.28, '#ffe14a']].forEach(([dx, dy, c]) => {
        g.fillStyle = c as string;
        g.beginPath();
        g.arc((dx as number) * r, (dy as number) * r, r * 0.42, 0, Math.PI * 2);
        g.fill();
      });
    } else if (p === Power.BlackHole) {
      g.fillStyle = '#000';
      g.arc(0, 0, r * 0.5, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#c9a0ff';
      g.lineWidth = r * 0.16;
      for (let k = 0; k < 3; k++) {
        g.beginPath();
        g.arc(0, 0, r * (0.62 + k * 0.001), (k * Math.PI * 2) / 3, (k * Math.PI * 2) / 3 + 1.4);
        g.stroke();
      }
    } else if (p === Power.Magnet) {
      // Horseshoe magnet
      g.strokeStyle = '#ff5a6a';
      g.lineWidth = r * 0.34;
      g.lineCap = 'butt';
      g.arc(0, -r * 0.05, r * 0.5, Math.PI, 0, true);
      g.stroke();
      g.fillStyle = '#e8eef5';
      g.fillRect(-r * 0.67, -r * 0.1, r * 0.34, r * 0.32);
      g.fillRect(r * 0.33, -r * 0.1, r * 0.34, r * 0.32);
    }
    g.restore();
  }

  /** A scorpion scuttling backwards along the track (head toward the chain). */
  private drawScorpion(tr: Track, s: number, v: ViewState) {
    if (s > tr.length + BALL_D * 2) return;
    const g = this.ctx;
    const p = pointAt(tr, Math.min(s, tr.length));
    const t = tangentAt(tr, Math.min(s, tr.length));
    g.save();
    g.translate(p.x, p.y);
    g.rotate(Math.atan2(-t.y, -t.x) + Math.PI / 2);
    g.drawImage(this.glowSprite('#ffb347'), -50, -50, 100, 100);
    drawScorpionShape(g, BALL_R * 1.7, v.time, '#ffb347', true);
    g.restore();
  }

  /** Bonus coin: spins, glows, blinks before it vanishes; a ring counts down its life. */
  private drawCoin(c: { x: number; y: number; t: number }, v: ViewState) {
    const g = this.ctx;
    const R = TUNING.coinR;
    if (c.t < 1.6 && Math.sin(v.time * 22) < -0.2) return;
    const appear = Math.min(1, (TUNING.coinLife - c.t) / 0.25);
    const bob = Math.sin(v.time * 3) * 3;
    g.save();
    g.translate(c.x, c.y + bob);
    g.drawImage(this.glowSprite(v.aimCoin ? '#fff6a0' : '#ffd23f'), -R * 2.6, -R * 2.6, R * 5.2, R * 5.2);
    // Life ring
    g.strokeStyle = 'rgba(255,230,140,0.55)';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(0, 0, R + 9, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * c.t) / TUNING.coinLife);
    g.stroke();
    // A slow wobble rather than a full spin, so it always reads as a coin.
    const sx = (0.55 + 0.45 * Math.abs(Math.cos(v.time * 2.2))) * easeOutBack(appear);
    g.scale(sx, easeOutBack(appear));
    const gr = g.createRadialGradient(-R * 0.3, -R * 0.35, 2, 0, 0, R);
    gr.addColorStop(0, '#fff7c2');
    gr.addColorStop(0.5, '#ffcb2f');
    gr.addColorStop(1, '#a86200');
    g.fillStyle = gr;
    g.beginPath();
    g.arc(0, 0, R, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#7a4300';
    g.lineWidth = 2.5;
    g.beginPath();
    g.arc(0, 0, R * 0.72, 0, Math.PI * 2);
    g.stroke();
    // Embossed star
    g.fillStyle = '#fff1a8';
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 ? R * 0.22 : R * 0.5;
      g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    g.closePath();
    g.fill();
    g.restore();
  }

  /** Light running along the empty track to the skull, leaving a glowing trail. */
  private drawSweep(v: ViewState) {
    const g = this.ctx;
    const sw = v.sweep!;
    const k = Math.min(1, sw.t / sw.dur);
    const e = 1 - Math.pow(1 - k, 2);
    const fade = sw.t > sw.dur ? Math.max(0, 1 - (sw.t - sw.dur) / 0.6) : 1;
    this.level.tracks.forEach((tr, ti) => {
      const from = sw.from[ti] ?? tr.length;
      const to = from + (tr.length - from) * e;
      if (to - from < 2) return;
      g.save();
      g.lineCap = 'round';
      g.lineJoin = 'round';
      const path = new Path2D();
      const p0 = pointAt(tr, from);
      path.moveTo(p0.x, p0.y);
      for (let s = from + 6; s < to; s += 6) {
        const p = pointAt(tr, s);
        path.lineTo(p.x, p.y);
      }
      const pe = pointAt(tr, to);
      path.lineTo(pe.x, pe.y);
      g.globalAlpha = 0.35 * fade;
      g.strokeStyle = '#fff2a8';
      g.lineWidth = BALL_D + 6;
      g.stroke(path);
      g.globalAlpha = 0.8 * fade;
      g.strokeStyle = '#ffffff';
      g.lineWidth = 5;
      g.stroke(path);
      if (k < 1) {
        g.globalAlpha = 1;
        g.drawImage(this.glowSprite('#fff6c0'), pe.x - 60, pe.y - 60, 120, 120);
        g.fillStyle = '#fff';
        g.beginPath();
        g.arc(pe.x, pe.y, 9, 0, Math.PI * 2);
        g.fill();
      }
      g.restore();
    });
  }

  /** Pop sparks curving into the boss. */
  private drawHoming(v: ViewState) {
    const g = this.ctx;
    const B = this.level.bossFight;
    if (!B) return;
    for (const h of v.homing) {
      const t = Math.min(1, h.t);
      const u = 1 - t;
      const x = u * u * h.x + 2 * u * t * h.cx + t * t * B.x;
      const y = u * u * h.y + 2 * u * t * h.cy + t * t * B.y;
      g.globalAlpha = 0.9;
      g.drawImage(this.glowSprite(h.color), x - 16, y - 16, 32, 32);
      g.fillStyle = '#fff';
      g.beginPath();
      g.arc(x, y, 3.5, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  }

  /** Boss creature: the stone idol (rail fights) or the skull serpent (mini-bosses). */
  private drawBoss(st: GameState, v: ViewState) {
    if (this.level.bossFight!.kind === 'serpent') this.drawSerpent(st, v);
    else this.drawIdol(st, v);
  }

  /**
   * The stone idol, drawn upright on screen: a carved sun-mask with a rotating halo, a
   * glowing forehead gem, eyes that follow your frog, cracks that spread as it weakens,
   * and two floating stone hands that wind up and lob molten rocks.
   */
  private drawIdol(st: GameState, v: ViewState) {
    const g = this.ctx;
    const L = this.L;
    const lvl = this.level;
    const B = lvl.bossFight!;
    const b = st.boss!;
    const dead = b.dead;
    const angry = b.hp * 2 <= b.max;
    const hurt = 1 - b.hp / b.max;
    const sp = worldToScreen(L, B);
    const shake = b.hitT > 0 ? Math.sin(v.time * 90) * 5 * (b.hitT / 0.2) : 0;
    const k = L.scale * (B.r / 54) * 1.05;
    const wind = b.wind > 0 ? 1 - b.wind / TUNING.bossWindup : 0;
    const glow = angry ? '#ff3a3a' : '#5ff4ff';
    let alpha = 1;
    let crumble = 0;
    if (dead) {
      crumble = Math.max(0, v.bossDown) / 1.4;
      if (crumble >= 1) return;
      alpha = 1 - crumble;
    }
    // Hands first (behind the head where they overlap)
    for (let hand = 0; hand < 2; hand++) {
      const active = b.wind > 0 && (hand === b.n % 2 || angry);
      const hp = worldToScreen(L, idolHand(lvl, hand));
      this.drawIdolHand(hp.x - sp.x, hp.y - sp.y, sp, k, v, hand, active ? wind : 0, angry, alpha, crumble, shake);
    }
    g.save();
    g.setTransform(L.dpr, 0, 0, L.dpr, (v.shake.x + shake) * L.dpr, v.shake.y * L.dpr);
    g.translate(sp.x, sp.y + Math.sin(v.time * 1.6) * 3 * k);
    g.scale(k, k);
    g.globalAlpha = alpha;
    if (dead) {
      g.translate(Math.sin(v.time * 70) * 6 * (1 - crumble), crumble * 40);
      g.rotate(crumble * 0.25);
    }
    // Halo: rotating sun rays
    g.save();
    g.rotate(v.time * (angry ? 0.9 : 0.35));
    const rays = 14;
    for (let i = 0; i < rays; i++) {
      g.rotate((Math.PI * 2) / rays);
      g.fillStyle = i % 2 ? (angry ? 'rgba(255,90,60,0.55)' : 'rgba(255,200,90,0.5)') : angry ? 'rgba(160,20,30,0.55)' : 'rgba(200,120,40,0.45)';
      g.beginPath();
      g.moveTo(-9, -52);
      g.lineTo(0, -88 - (i % 2 ? 0 : 10) - wind * 10);
      g.lineTo(9, -52);
      g.closePath();
      g.fill();
    }
    g.restore();
    g.drawImage(this.glowSprite(angry ? '#ff2a3a' : '#7a5cff'), -120, -120, 240, 240);
    // Ear plugs
    for (const sx of [-1, 1]) {
      const eg = g.createRadialGradient(sx * 56, -2, 2, sx * 56, 0, 16);
      eg.addColorStop(0, '#f7d27a');
      eg.addColorStop(1, '#8a5a1a');
      g.fillStyle = eg;
      g.beginPath();
      g.arc(sx * 56, 0, 15, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(0,0,0,0.45)';
      g.beginPath();
      g.arc(sx * 56, 0, 6, 0, Math.PI * 2);
      g.fill();
    }
    // Head: a carved shield-shaped stone mask
    const face = new Path2D();
    face.moveTo(-46, -50);
    face.quadraticCurveTo(0, -64, 46, -50);
    face.quadraticCurveTo(54, -10, 44, 22);
    face.quadraticCurveTo(30, 56, 0, 62);
    face.quadraticCurveTo(-30, 56, -44, 22);
    face.quadraticCurveTo(-54, -10, -46, -50);
    face.closePath();
    const stone = g.createLinearGradient(-40, -60, 40, 60);
    stone.addColorStop(0, angry ? '#b0706a' : '#a7a3c4');
    stone.addColorStop(0.5, angry ? '#7a3a3c' : '#6d6a90');
    stone.addColorStop(1, angry ? '#3a1216' : '#2e2b4a');
    g.fillStyle = stone;
    g.fill(face);
    g.save();
    g.clip(face);
    // Carved bands with a zig-zag frieze across the brow
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(-50, -40);
    g.lineTo(50, -40);
    g.moveTo(-50, -30);
    g.lineTo(50, -30);
    g.stroke();
    g.strokeStyle = angry ? 'rgba(255,140,90,0.55)' : 'rgba(255,215,120,0.55)';
    g.lineWidth = 2;
    g.beginPath();
    for (let x = -48; x <= 48; x += 8) g.lineTo(x, (x / 8) % 2 ? -32 : -38);
    g.stroke();
    // Rim light
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.lineWidth = 6;
    g.stroke(face);
    // Cracks spread as it takes damage
    const cracks = [
      [-30, -48, -22, -30, -28, -14],
      [34, -44, 26, -26, 34, -8],
      [-40, 10, -26, 18, -30, 36],
      [40, 8, 28, 22, 34, 40],
      [-8, 40, 0, 30, 8, 44],
      [10, -56, 4, -44, 12, -36],
      [-46, -10, -34, -4, -40, 8],
    ];
    const nc = Math.floor(hurt * cracks.length + (dead ? cracks.length : 0));
    for (let i = 0; i < Math.min(nc, cracks.length); i++) {
      const c = cracks[i];
      g.strokeStyle = angry ? 'rgba(255,120,40,0.9)' : 'rgba(20,10,30,0.8)';
      g.lineWidth = angry ? 2.5 : 2;
      g.beginPath();
      g.moveTo(c[0], c[1]);
      g.lineTo(c[2], c[3]);
      g.lineTo(c[4], c[5]);
      g.stroke();
    }
    g.restore();
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.lineWidth = 3;
    g.stroke(face);
    // Forehead gem
    const gemPulse = 0.75 + 0.25 * Math.sin(v.time * 4) + wind * 0.5;
    g.drawImage(this.glowSprite(glow), -22 * gemPulse, -66 - 22 * gemPulse + 14, 44 * gemPulse, 44 * gemPulse);
    g.fillStyle = angry ? '#ff5050' : '#7ff8ff';
    g.beginPath();
    g.moveTo(0, -60);
    g.lineTo(9, -48);
    g.lineTo(0, -36);
    g.lineTo(-9, -48);
    g.closePath();
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.beginPath();
    g.moveTo(0, -57);
    g.lineTo(4, -50);
    g.lineTo(0, -46);
    g.closePath();
    g.fill();
    // Eyes: angled sockets with irises that track the frog
    const lc = launcherAt(st, lvl);
    const ls = worldToScreen(L, lc);
    let lx = ls.x - sp.x;
    let ly = ls.y - sp.y;
    const ld = Math.hypot(lx, ly) || 1;
    lx = (lx / ld) * 4;
    ly = (ly / ld) * 3;
    for (const sx of [-1, 1]) {
      g.fillStyle = '#0b0610';
      g.beginPath();
      g.moveTo(sx * 8, -22);
      g.quadraticCurveTo(sx * 22, angry ? -16 : -24, sx * 36, -20 + (angry ? -6 : 0));
      g.quadraticCurveTo(sx * 26, -4, sx * 10, -8);
      g.closePath();
      g.fill();
      if (!dead) {
        g.drawImage(this.glowSprite(glow), sx * 22 - 16 + lx, -30 + ly, 32, 32);
        g.fillStyle = glow;
        g.beginPath();
        g.arc(sx * 22 + lx, -14 + ly, 4.5 + wind * 1.5, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#fff';
        g.beginPath();
        g.arc(sx * 22 + lx - 1.5, -15.5 + ly, 1.5, 0, Math.PI * 2);
        g.fill();
      }
    }
    // Nose ridge
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.beginPath();
    g.moveTo(0, -10);
    g.lineTo(7, 10);
    g.lineTo(-7, 10);
    g.closePath();
    g.fill();
    // Cheek runes
    g.strokeStyle = angry ? 'rgba(255,90,60,0.8)' : 'rgba(110,240,255,0.65)';
    g.lineWidth = 2;
    for (const sx of [-1, 1]) {
      g.beginPath();
      g.moveTo(sx * 30, 2);
      g.lineTo(sx * 38, 10);
      g.lineTo(sx * 30, 18);
      g.moveTo(sx * 36, 2);
      g.lineTo(sx * 42, 8);
      g.stroke();
    }
    // Mouth: the jaw drops during the wind-up, with molten light inside
    const open = dead ? 3 : 6 + wind * 12 + Math.max(0, Math.sin(v.time * 2)) * 2;
    const mg = g.createLinearGradient(0, 22, 0, 30 + open);
    mg.addColorStop(0, '#1a0508');
    mg.addColorStop(1, angry || wind > 0 ? '#ff6a1a' : '#401018');
    g.fillStyle = mg;
    g.beginPath();
    g.roundRect(-24, 24, 48, 6 + open, 6);
    g.fill();
    g.fillStyle = '#e9dcc0';
    for (let i = -20; i <= 14; i += 8.5) {
      g.beginPath();
      g.moveTo(i, 24);
      g.lineTo(i + 6, 24);
      g.lineTo(i + 3, 31);
      g.closePath();
      g.fill();
      g.beginPath();
      g.moveTo(i, 30 + open);
      g.lineTo(i + 6, 30 + open);
      g.lineTo(i + 3, 23 + open);
      g.closePath();
      g.fill();
    }
    // Embers when angry
    if (angry && !dead) {
      for (let i = 0; i < 8; i++) {
        const t = (v.time * 0.6 + i / 8) % 1;
        const ex = Math.sin(i * 12.9 + v.time) * 50;
        g.globalAlpha = alpha * (1 - t);
        g.fillStyle = i % 2 ? '#ffb347' : '#ff5a3a';
        g.beginPath();
        g.arc(ex, 50 - t * 140, 2.2, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = alpha;
    }
    if (b.hitT > 0) {
      g.globalAlpha = (b.hitT / 0.2) * 0.85;
      g.fillStyle = '#fff';
      g.fill(face);
      g.globalAlpha = 1;
    }
    g.restore();
    if (!dead) this.drawBossBar(sp, 74 * k + 10, b.hp / b.max, angry);
  }

  /** A floating stone hand. During the wind-up it rises and a molten rock forms in it. */
  private drawIdolHand(dx: number, dy: number, sp: Pt, k: number, v: ViewState, hand: number, wind: number, angry: boolean, alpha: number, crumble: number, shake: number) {
    const g = this.ctx;
    const L = this.L;
    g.save();
    g.setTransform(L.dpr, 0, 0, L.dpr, (v.shake.x + shake * 0.5) * L.dpr, v.shake.y * L.dpr);
    const bob = Math.sin(v.time * 2.2 + hand * 2) * 4 * k;
    const lift = wind * 26 * k;
    g.translate(sp.x + dx, sp.y + dy + bob - lift + crumble * 60 * k);
    g.scale(k * (hand ? -1 : 1), k);
    g.rotate(-0.2 - wind * 0.5);
    g.globalAlpha = alpha * (1 - crumble);
    const hg = g.createLinearGradient(-18, -24, 18, 20);
    hg.addColorStop(0, angry ? '#a0605a' : '#9a96b8');
    hg.addColorStop(1, angry ? '#3a1216' : '#3a3858');
    g.fillStyle = hg;
    g.beginPath();
    g.roundRect(-16, -12, 30, 30, 9);
    g.fill();
    // Fingers
    for (let i = 0; i < 4; i++) {
      g.beginPath();
      g.roundRect(-15 + i * 7.5, -26 - (i === 1 || i === 2 ? 4 : 0), 6.5, 18, 3);
      g.fill();
    }
    g.beginPath();
    g.roundRect(12, -4, 12, 7, 3);
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.45)';
    g.lineWidth = 2;
    g.beginPath();
    g.roundRect(-16, -12, 30, 30, 9);
    g.stroke();
    // Glowing rune on the palm
    g.strokeStyle = angry ? '#ff7a4a' : '#7ff8ff';
    g.globalAlpha = alpha * (0.5 + 0.5 * Math.sin(v.time * 3 + hand));
    g.beginPath();
    g.arc(-1, 3, 6, 0, Math.PI * 2);
    g.stroke();
    g.globalAlpha = alpha;
    if (wind > 0) {
      // Molten rock forming above the hand
      const r = 6 + wind * 12;
      g.drawImage(this.glowSprite('#ff8a2a'), -r * 3, -40 - r * 3, r * 6, r * 6);
      const rg = g.createRadialGradient(-3, -43, 1, 0, -40, r);
      rg.addColorStop(0, '#fff6b0');
      rg.addColorStop(0.4, '#ff9a2e');
      rg.addColorStop(1, '#8a2208');
      g.fillStyle = rg;
      g.beginPath();
      g.arc(0, -40, r, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }

  /** Health bar under a boss, screen space. */
  private drawBossBar(sp: Pt, below: number, frac: number, angry: boolean) {
    const g = this.ctx;
    const L = this.L;
    const w = 120 * Math.max(0.7, L.scale * 1.4);
    const h = 9;
    const bx = sp.x - w / 2;
    const by = sp.y + below;
    g.save();
    g.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.beginPath();
    g.roundRect(bx - 2, by - 2, w + 4, h + 4, 6);
    g.fill();
    g.fillStyle = angry ? '#ff4d6a' : '#ffb347';
    g.beginPath();
    g.roundRect(bx, by, Math.max(0.01, w * frac), h, 4);
    g.fill();
    g.restore();
  }

  /**
   * The mini-boss serpent, coiled in chain 0's skull pit and facing back up the track.
   * Bone-plated head with horns, glowing slit eyes, a flicking forked tongue; it rears
   * back before spitting (the marble glows in its mouth) and lunges as it spits.
   */
  private drawSerpent(st: GameState, v: ViewState) {
    const g = this.ctx;
    const lvl = this.level;
    const B = lvl.bossFight!;
    const b = st.boss!;
    const tr = lvl.tracks[0];
    const dead = b.dead;
    const angry = b.hp * 2 <= b.max;
    let alpha = 1;
    let crumble = 0;
    if (dead) {
      crumble = Math.max(0, v.bossDown) / 1.2;
      if (crumble >= 1) return;
      alpha = 1 - crumble;
    }
    const t = tangentAt(tr, tr.length);
    const ang = Math.atan2(-t.y, -t.x);
    const wind = b.wind > 0 ? 1 - b.wind / (TUNING.serpentWindup + st.mods.serpentWindupAdd) : 0;
    // Rears back while winding up, lunges right after spitting.
    const sinceSpit = b.wind > 0 ? 9 : v.spitAge;
    const lunge = sinceSpit < 0.25 ? Math.sin((sinceSpit / 0.25) * Math.PI) : 0;
    const reach = 22 - wind * 14 + lunge * 16 + Math.sin(v.time * 2.4) * 2;
    const hungry = Math.min(1, v.danger * 1.6);
    const shake = b.hitT > 0 ? Math.sin(v.time * 90) * 4 * (b.hitT / 0.2) : 0;
    g.save();
    g.globalAlpha = alpha;
    g.translate(B.x + shake, B.y);
    g.drawImage(this.glowSprite(angry ? '#ff3a4a' : '#3dff9a'), -100, -100, 200, 200);
    // Health ring around the pit
    if (!dead) {
      g.strokeStyle = 'rgba(0,0,0,0.6)';
      g.lineWidth = 8;
      g.beginPath();
      g.arc(0, 0, 54, 0, Math.PI * 2);
      g.stroke();
      g.strokeStyle = angry ? '#ff4d6a' : '#ffb347';
      g.lineWidth = 5;
      g.beginPath();
      g.arc(0, 0, 54, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (b.hp / b.max));
      g.stroke();
    }
    // Rearing up = open target: a pulsing reticle the size of its (bigger) hitbox
    if (!dead && b.wind > 0) {
      const R = B.r * TUNING.serpentTargetK + BALL_R * 0.7;
      const pulse = 0.5 + 0.5 * Math.sin(v.time * 14);
      g.save();
      g.strokeStyle = `rgba(125,255,207,${0.55 + pulse * 0.45})`;
      g.lineWidth = 3 + pulse * 2;
      g.setLineDash([10, 7]);
      g.lineDashOffset = -v.time * 40;
      g.beginPath();
      g.arc(0, 0, R, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 2;
        g.beginPath();
        g.moveTo(Math.cos(a) * (R + 4), Math.sin(a) * (R + 4));
        g.lineTo(Math.cos(a) * (R + 14), Math.sin(a) * (R + 14));
        g.stroke();
      }
      g.restore();
    }
    g.rotate(ang);
    g.scale(1.55, 1.55);
    // Coiled body around the pit: banded scales
    const seg = 16;
    for (let i = seg; i >= 0; i--) {
      const a = Math.PI * 0.35 + (i / seg) * Math.PI * 1.55 + Math.sin(v.time * 1.5) * 0.05;
      const rr = 24 - i * 0.4;
      const x = Math.cos(a) * rr * (1 - crumble * 0.5);
      const y = Math.sin(a) * rr;
      const w = 9.5 - i * 0.25;
      g.fillStyle = i % 3 === 0 ? '#e8b84a' : angry ? '#7a2a3a' : '#1f7a4a';
      g.beginPath();
      g.arc(x, y, w, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.12)';
      g.beginPath();
      g.arc(x - 2, y - 2, w * 0.5, 0, Math.PI * 2);
      g.fill();
    }
    // Neck from the coil to the head
    g.strokeStyle = angry ? '#7a2a3a' : '#1f7a4a';
    g.lineWidth = 15;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(10, 14);
    g.quadraticCurveTo(reach * 0.4, 8, reach, 0);
    g.stroke();
    g.strokeStyle = '#e8b84a';
    g.lineWidth = 4;
    g.setLineDash([3, 6]);
    g.stroke();
    g.setLineDash([]);
    // Head (local +x = toward the chain), drawn big with a dark outline so it reads at a glance
    g.translate(reach, 0);
    g.scale(1.3, 1.3);
    g.shadowColor = 'rgba(0,0,0,0.85)';
    g.shadowBlur = 6;
    const jaw = dead ? 0.1 : Math.min(1, 0.15 + hungry * 0.35 + wind * 0.6 + lunge * 0.8);
    // Lower jaw
    g.save();
    g.rotate(jaw * 0.45);
    g.fillStyle = angry ? '#5a1a26' : '#165a36';
    g.beginPath();
    g.moveTo(-6, 2);
    g.quadraticCurveTo(14, 12, 30, 3);
    g.lineTo(28, 0);
    g.lineTo(-6, 0);
    g.closePath();
    g.fill();
    g.fillStyle = '#fff6e0';
    for (const fx of [22, 14]) {
      g.beginPath();
      g.moveTo(fx, 3);
      g.lineTo(fx + 3, 3);
      g.lineTo(fx + 1.5, -3);
      g.closePath();
      g.fill();
    }
    g.restore();
    // Glow in the mouth: the marble it's about to spit
    if (wind > 0) {
      const col = PALETTE[b.spitC] ?? PALETTE[0];
      g.drawImage(this.glowSprite(col.base), 10 - 18, -18 + 4, 36, 36);
      this.drawMarble(b.spitC, 16, 3, 0, 0, 0.35 + wind * 0.25, 0);
    }
    // Forked tongue, flicking
    const flick = (v.time * 1.3) % 2.2;
    if (!dead && flick < 0.35) {
      const out = Math.sin((flick / 0.35) * Math.PI) * 18;
      g.strokeStyle = '#ff3b6a';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(26, 2);
      g.lineTo(26 + out, 2);
      g.lineTo(30 + out, -2);
      g.moveTo(26 + out, 2);
      g.lineTo(30 + out, 6);
      g.stroke();
    }
    // Upper head: bone plate
    g.save();
    g.rotate(-jaw * 0.2);
    const hp = new Path2D();
    hp.moveTo(-10, -12);
    hp.quadraticCurveTo(8, -18, 26, -8);
    hp.quadraticCurveTo(34, -3, 32, 1);
    hp.lineTo(-8, 3);
    hp.quadraticCurveTo(-14, -4, -10, -12);
    hp.closePath();
    g.fillStyle = angry ? '#7a2a3a' : '#25915a';
    g.fill(hp);
    g.shadowBlur = 0;
    g.strokeStyle = 'rgba(0,0,0,0.7)';
    g.lineWidth = 1.5;
    g.stroke(hp);
    const bone = g.createLinearGradient(0, -16, 0, 0);
    bone.addColorStop(0, '#fff3d6');
    bone.addColorStop(1, '#bfae86');
    g.fillStyle = bone;
    g.beginPath();
    g.moveTo(-8, -11);
    g.quadraticCurveTo(8, -17, 24, -8);
    g.quadraticCurveTo(12, -5, -6, -3);
    g.closePath();
    g.fill();
    // Horns sweeping back
    g.fillStyle = '#efe3c6';
    for (const sy of [-1, 1]) {
      g.beginPath();
      g.moveTo(-4, -8 + sy * 2);
      g.quadraticCurveTo(-18, -14 + sy * 8, -24, -6 + sy * 10);
      g.quadraticCurveTo(-14, -8 + sy * 4, -2, -4 + sy * 2);
      g.closePath();
      g.fill();
    }
    // Eye with a slit pupil (glows red when hungry or hurt)
    const eye = angry || hungry > 0.5 ? '#ff3a2a' : '#ffe14a';
    g.drawImage(this.glowSprite(eye), 6 - 10, -14 - 10, 20, 20);
    g.fillStyle = eye;
    g.beginPath();
    g.ellipse(8, -7, 4.5, 3, -0.2, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#120806';
    g.beginPath();
    g.ellipse(8.5, -7, dead ? 3 : 1, 2.6, 0, 0, Math.PI * 2);
    g.fill();
    // Nostril
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.beginPath();
    g.arc(27, -3, 1.4, 0, Math.PI * 2);
    g.fill();
    g.restore();
    if (b.hitT > 0) {
      g.globalAlpha = (b.hitT / 0.2) * 0.8;
      g.fillStyle = '#fff';
      g.beginPath();
      g.arc(10, -3, 22, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }

  /**
   * Idol rocks: a target on the rail that follows your frog during the wind-up, then
   * locks and closes in as the lobbed rock comes down (shadow under it, fiery tail).
   */
  private drawRocks(st: GameState, v: ViewState) {
    const g = this.ctx;
    const R = this.level.rail;
    const b = st.boss!;
    if (!R || !st.rail) return;
    const reticle = (x: number, y: number, rad: number, color: string, spin: number, fill: number) => {
      g.save();
      g.translate(x, y);
      g.fillStyle = color.replace('1)', `${fill})`);
      g.beginPath();
      g.arc(0, 0, rad, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = color;
      g.lineWidth = 3;
      g.rotate(spin);
      for (let i = 0; i < 4; i++) {
        g.rotate(Math.PI / 2);
        g.beginPath();
        g.arc(0, 0, rad, -0.45, 0.45);
        g.stroke();
      }
      g.restore();
    };
    if (b.wind > 0 && !b.dead) {
      const w = 1 - b.wind / TUNING.bossWindup;
      const p = railPoint(R, st.rail.u);
      reticle(p.x, p.y, TUNING.bossShotHitR * (1.6 - w * 0.4), 'rgba(255,214,90,1)', v.time * 3, 0.08 + w * 0.12);
    }
    const up = this.L.portrait ? { x: -1, y: 0 } : { x: 0, y: -1 };
    for (const r of b.shots) {
      const t = railPoint(R, r.u);
      const k = 1 - r.t / r.T;
      // Locked target closes in until impact
      reticle(t.x, t.y, TUNING.bossShotHitR * (1 + (1 - k) * 0.9), 'rgba(255,60,80,1)', -v.time * 4, 0.12 + k * 0.25);
      const gx = r.x0 + (t.x - r.x0) * k;
      const gy = r.y0 + (t.y - r.y0) * k;
      const dist = Math.hypot(t.x - r.x0, t.y - r.y0);
      const h = Math.sin(k * Math.PI) * Math.min(220, dist * 0.35);
      // Shadow on the ground
      g.fillStyle = `rgba(0,0,0,${0.15 + k * 0.3})`;
      g.beginPath();
      g.ellipse(gx, gy, 10 + k * 8, 6 + k * 5, 0, 0, Math.PI * 2);
      g.fill();
      const size = 1 + Math.sin(k * Math.PI) * 0.6;
      // Fiery tail
      for (let i = 1; i <= 6; i++) {
        const kk = Math.max(0, k - i * 0.03);
        const tx = r.x0 + (t.x - r.x0) * kk + up.x * Math.sin(kk * Math.PI) * Math.min(220, dist * 0.35);
        const ty = r.y0 + (t.y - r.y0) * kk + up.y * Math.sin(kk * Math.PI) * Math.min(220, dist * 0.35);
        g.globalAlpha = 0.55 - i * 0.08;
        const s2 = (40 - i * 4) * size;
        g.drawImage(this.glowSprite(i < 3 ? '#ffb347' : '#ff4a1a'), tx - s2 / 2, ty - s2 / 2, s2, s2);
      }
      g.globalAlpha = 1;
      const rx = gx + up.x * h;
      const ry = gy + up.y * h;
      g.drawImage(this.glowSprite('#ff9a3d'), rx - 42 * size, ry - 42 * size, 84 * size, 84 * size);
      g.save();
      g.translate(rx, ry);
      g.scale(size, size);
      g.rotate(v.time * 7);
      const rg = g.createRadialGradient(-4, -4, 2, 0, 0, 18);
      rg.addColorStop(0, '#fff3b0');
      rg.addColorStop(0.35, '#ff9a2e');
      rg.addColorStop(1, '#8a2208');
      g.fillStyle = rg;
      g.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const rr = 15 + (i % 2 ? 3 : -1);
        g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      g.closePath();
      g.fill();
      g.strokeStyle = '#3a1004';
      g.lineWidth = 2.5;
      g.stroke();
      // Glowing cracks on the rock
      g.strokeStyle = '#ffe08a';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(-8, -3);
      g.lineTo(0, 1);
      g.lineTo(6, -6);
      g.moveTo(0, 1);
      g.lineTo(2, 9);
      g.stroke();
      g.restore();
    }
  }

  /** Trackpad crosshair. */
  private drawCursor(p: Pt, v: ViewState) {
    const g = this.ctx;
    const r = 15 + Math.sin(v.time * 5) * 1.5;
    g.save();
    g.translate(p.x, p.y);
    g.strokeStyle = 'rgba(0,0,0,0.5)';
    g.lineWidth = 6;
    this.crossPath(g, r);
    g.stroke();
    g.strokeStyle = '#fff';
    g.lineWidth = 2.5;
    this.crossPath(g, r);
    g.stroke();
    g.restore();
  }
  private crossPath(g: CanvasRenderingContext2D, r: number) {
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      g.moveTo(dx * r * 0.45, dy * r * 0.45);
      g.lineTo(dx * r * 1.5, dy * r * 1.5);
    }
  }

  private drawAim(st: GameState, v: ViewState) {
    const g = this.ctx;
    const lc = v.aimFrom ?? this.level.launcher;
    const dx = Math.cos(v.aimShot);
    const dy = Math.sin(v.aimShot);
    const ox = lc.x + dx * TUNING.muzzle;
    const oy = lc.y + dy * TUNING.muzzle;
    const hit = v.aimHit;
    const dist = hit ? hit.dist : 1600;
    const wild = (st.gun.w & 1) === 1;
    const col = PALETTE[wild ? WILD : st.gun.cur];
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
    {
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
    const target = st.chains[hit.chain]?.balls[hit.index];
    if (!target) return;
    const htr = this.level.tracks[hit.chain];
    const tp = pointAt(htr, target.s);
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
    const gp = pointAt(htr, gs);
    const n = tangentAt(htr, gs);
    // Push the ghost out of the track slightly toward the shooter so it reads as "incoming".
    const side = (lc.x - gp.x) * -n.y + (lc.y - gp.y) * n.x > 0 ? 1 : -1;
    const gx = gp.x - n.y * side * BALL_R * 0.55;
    const gy = gp.y + n.x * side * BALL_R * 0.55;
    g.globalAlpha = v.aimWillPop ? 0.75 : 0.42;
    const gsz = v.aimWillPop ? 0.85 + pulse * 0.12 : 0.78;
    this.drawMarble(wild ? WILD : st.gun.cur, gx, gy, 0, 0, gsz, this.L.portrait ? -Math.PI / 2 : 0);
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
    const lc = launcherAt(st, this.level);
    const a = v.aimAngle;
    const rec = v.recoil * FEEL.recoilPx;
    const cx = lc.x - Math.cos(a) * rec;
    const cy = lc.y - Math.sin(a) * rec;
    const curC = st.gun.w & 1 ? WILD : st.gun.cur;
    const nextC = st.gun.w & 2 ? WILD : st.gun.next;
    const cur = PALETTE[curC];
    const stun = st.rail?.stun ?? 0;
    const R = this.level.rail;
    if (R && st.rail && Math.abs(st.rail.tu - st.rail.u) > 4) {
      // Where the frog is sliding to
      const t = railPoint(R, st.rail.tu);
      g.strokeStyle = 'rgba(255,255,255,0.45)';
      g.lineWidth = 3;
      g.beginPath();
      g.arc(t.x, t.y, 20, 0, Math.PI * 2);
      g.stroke();
    }
    g.save();
    g.translate(cx, cy);
    g.rotate(a);
    // Glow in current colour (cached sprite; shadowBlur is slow on phones)
    g.drawImage(this.glowSprite(cur.base), -76, -76, 152, 152);
    if (stun > 0) g.globalAlpha = 0.55 + 0.25 * Math.sin(v.time * 30);
    drawCharacter(g, this.character, { t: v.time, blink: stun > 0 ? 1 : blinkAt(v.time), recoil: v.recoil });
    g.globalAlpha = 1;
    g.restore();
    if (stun > 0) {
      // Dizzy stars
      for (let i = 0; i < 3; i++) {
        const ang = v.time * 6 + (i * Math.PI * 2) / 3;
        const sx = cx + Math.cos(ang) * 30;
        const sy = cy + Math.sin(ang) * 30;
        g.fillStyle = '#ffe14a';
        g.beginPath();
        for (let j = 0; j < 10; j++) {
          const aa = -Math.PI / 2 + (j * Math.PI) / 5;
          const rr = j % 2 ? 3 : 7;
          g.lineTo(sx + Math.cos(aa) * rr, sy + Math.sin(aa) * rr);
        }
        g.closePath();
        g.fill();
      }
    }
    // Current ball in the mouth (slides forward as cooldown recovers)
    const load = 1 - Math.min(1, st.gun.cool / TUNING.cooldown);
    const md = MOUTH_X - rec + load * 2;
    const scale = 0.55 + 0.45 * easeOutBack(load);
    this.drawMarble(curC, cx + Math.cos(a) * md, cy + Math.sin(a) * md, a, v.time * 2, scale, rot);
    if (st.gun.b & 1) this.drawBombMark(cx + Math.cos(a) * md, cy + Math.sin(a) * md, BALL_R * scale, v);
    // Next ball on the back: big enough to read at a glance, with a ring so it reads as "next".
    const nd = -36;
    const nx = cx + Math.cos(a) * nd;
    const ny = cy + Math.sin(a) * nd;
    const g2 = this.ctx;
    g2.beginPath();
    g2.arc(nx, ny, BALL_R * 0.86, 0, Math.PI * 2);
    g2.fillStyle = 'rgba(5,10,18,0.55)';
    g2.fill();
    g2.strokeStyle = 'rgba(255,255,255,0.7)';
    g2.lineWidth = 2;
    g2.stroke();
    this.drawMarble(nextC, nx, ny, a, 0, 0.72, rot);
    if (st.gun.b & 2) this.drawBombMark(nx, ny, BALL_R * 0.72, v);
  }

  /** Pocket Bomb: a black bomb with a sparking fuse over a marble. */
  private drawBombMark(x: number, y: number, r: number, v: ViewState) {
    const g = this.ctx;
    g.fillStyle = '#16161c';
    g.beginPath();
    g.arc(x, y, r * 0.78, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.25)';
    g.beginPath();
    g.arc(x - r * 0.25, y - r * 0.25, r * 0.22, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#c9a36a';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x + r * 0.45, y - r * 0.55);
    g.quadraticCurveTo(x + r * 0.9, y - r * 1.0, x + r * 0.7, y - r * 1.25);
    g.stroke();
    const flick = 0.6 + 0.4 * Math.sin(v.time * 40);
    g.fillStyle = `rgba(255,${170 + Math.round(60 * flick)},60,1)`;
    g.beginPath();
    g.arc(x + r * 0.7, y - r * 1.25, r * 0.22 * (0.8 + flick * 0.4), 0, Math.PI * 2);
    g.fill();
  }

  private drawSkull(v: ViewState, st: GameState) {
    // The serpent lives in chain 0's pit; the skull shows again once it's gone.
    const serpent = this.level.bossFight?.kind === 'serpent' && st.boss && (!st.boss.dead || v.bossDown < 1);
    this.level.tracks.forEach((tr, i) => {
      if (serpent && i === 0) return;
      this.drawSkullAt(v, worldToScreen(this.L, pointAt(tr, tr.length)));
    });
  }

  private drawSkullAt(v: ViewState, end: Pt) {
    const g = this.ctx;
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

/** Scorpion, facing up (−y), size ~r. t animates the legs and tail. */
function drawScorpionShape(g: CanvasRenderingContext2D, r: number, t: number, color: string, outline = false) {
  if (outline) {
    // Dark outline pass so it stands out against marbles and the track.
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.9)';
    g.shadowBlur = 0;
    for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) {
      g.save();
      g.translate(dx, dy);
      drawScorpionShape(g, r, t, '#3a1a00');
      g.restore();
    }
    g.restore();
  }
  g.save();
  g.lineCap = 'round';
  g.strokeStyle = color;
  g.fillStyle = color;
  // Legs
  g.lineWidth = r * 0.09;
  for (let i = 0; i < 3; i++) {
    const y = -r * 0.1 + i * r * 0.22;
    const w = Math.sin(t * 24 + i * 2) * r * 0.08;
    for (const sx of [-1, 1]) {
      g.beginPath();
      g.moveTo(sx * r * 0.2, y);
      g.lineTo(sx * r * 0.55, y - r * 0.1 + w * sx);
      g.lineTo(sx * r * 0.68, y + r * 0.08 + w * sx);
      g.stroke();
    }
  }
  // Claws
  g.lineWidth = r * 0.12;
  for (const sx of [-1, 1]) {
    g.beginPath();
    g.moveTo(sx * r * 0.18, -r * 0.35);
    g.quadraticCurveTo(sx * r * 0.5, -r * 0.55, sx * r * 0.36, -r * 0.82);
    g.stroke();
    g.beginPath();
    g.arc(sx * r * 0.36, -r * 0.88, r * 0.12, 0, Math.PI * 2);
    g.fill();
  }
  // Body
  g.beginPath();
  g.ellipse(0, -r * 0.15, r * 0.26, r * 0.32, 0, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.ellipse(0, r * 0.28, r * 0.2, r * 0.22, 0, 0, Math.PI * 2);
  g.fill();
  // Tail curling over the back
  g.lineWidth = r * 0.14;
  const wag = Math.sin(t * 8) * 0.15;
  g.beginPath();
  g.moveTo(0, r * 0.45);
  g.bezierCurveTo(r * (0.05 + wag), r * 0.95, r * (0.55 + wag), r * 0.75, r * (0.35 + wag), r * 0.25);
  g.stroke();
  g.fillStyle = '#fff3c4';
  g.beginPath();
  g.arc(r * (0.33 + wag), r * 0.2, r * 0.09, 0, Math.PI * 2);
  g.fill();
  // Eyes
  g.fillStyle = '#1a0a00';
  g.beginPath();
  g.arc(-r * 0.09, -r * 0.36, r * 0.05, 0, Math.PI * 2);
  g.arc(r * 0.09, -r * 0.36, r * 0.05, 0, Math.PI * 2);
  g.fill();
  g.restore();
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

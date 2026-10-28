// Boss creatures: the stone idol (rail boss fights), the skull serpent (mini-bosses), and
// the idol's molten rocks. Split out of render.ts; drawn through the Renderer's canvas.

import { BALL_R } from '../sim/levelgen';
import { type GameState, idolHand, launcherAt, railPoint, TUNING } from '../sim/game';
import { type Pt, tangentAt } from '../sim/track';
import { worldToScreen } from './layout';
import { PALETTE, type Renderer, type ViewState } from './render';

/** Boss creature: the stone idol (rail fights) or the skull serpent (mini-bosses). */
export function drawBoss(rd: Renderer, st: GameState, v: ViewState) {
  if (rd.level.bossFight!.kind === 'serpent') drawSerpent(rd, st, v);
  else drawIdol(rd, st, v);
}

/**
 * The stone idol, drawn upright on screen: a carved sun-mask with a rotating halo, a
 * glowing forehead gem, eyes that follow your frog, cracks that spread as it weakens,
 * and two floating stone hands that wind up and lob molten rocks.
 */
function drawIdol(rd: Renderer, st: GameState, v: ViewState) {
  const g = rd.ctx;
  const L = rd.L;
  const lvl = rd.level;
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
    drawIdolHand(rd, hp.x - sp.x, hp.y - sp.y, sp, k, v, hand, active ? wind : 0, angry, alpha, crumble, shake);
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
  g.drawImage(rd.glowSprite(angry ? '#ff2a3a' : '#7a5cff'), -120, -120, 240, 240);
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
  g.drawImage(rd.glowSprite(glow), -22 * gemPulse, -66 - 22 * gemPulse + 14, 44 * gemPulse, 44 * gemPulse);
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
      g.drawImage(rd.glowSprite(glow), sx * 22 - 16 + lx, -30 + ly, 32, 32);
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
  if (!dead) drawBossBar(rd, sp, 74 * k + 10, b.hp / b.max, angry);
}

/** A floating stone hand. During the wind-up it rises and a molten rock forms in it. */
function drawIdolHand(rd: Renderer, dx: number, dy: number, sp: Pt, k: number, v: ViewState, hand: number, wind: number, angry: boolean, alpha: number, crumble: number, shake: number) {
  const g = rd.ctx;
  const L = rd.L;
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
    g.drawImage(rd.glowSprite('#ff8a2a'), -r * 3, -40 - r * 3, r * 6, r * 6);
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
function drawBossBar(rd: Renderer, sp: Pt, below: number, frac: number, angry: boolean) {
  const g = rd.ctx;
  const L = rd.L;
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
function drawSerpent(rd: Renderer, st: GameState, v: ViewState) {
  const g = rd.ctx;
  const lvl = rd.level;
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
  g.drawImage(rd.glowSprite(angry ? '#ff3a4a' : '#3dff9a'), -100, -100, 200, 200);
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
    g.drawImage(rd.glowSprite(col.base), 10 - 18, -18 + 4, 36, 36);
    rd.drawMarble(b.spitC, 16, 3, 0, 0, 0.35 + wind * 0.25, 0);
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
  g.drawImage(rd.glowSprite(eye), 6 - 10, -14 - 10, 20, 20);
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
export function drawRocks(rd: Renderer, st: GameState, v: ViewState) {
  const g = rd.ctx;
  const R = rd.level.rail;
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
  const up = rd.L.portrait ? { x: -1, y: 0 } : { x: 0, y: -1 };
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
      g.drawImage(rd.glowSprite(i < 3 ? '#ffb347' : '#ff4a1a'), tx - s2 / 2, ty - s2 / 2, s2, s2);
    }
    g.globalAlpha = 1;
    const rx = gx + up.x * h;
    const ry = gy + up.y * h;
    g.drawImage(rd.glowSprite('#ff9a3d'), rx - 42 * size, ry - 42 * size, 84 * size, 84 * size);
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

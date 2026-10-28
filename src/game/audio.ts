// Procedural sound effects and ambient music on Web Audio. No asset files, so the
// PWA stays tiny and works offline. The context unlocks on the first user gesture.

import { buildVoices, type Voice } from './audio-voices';

/** A musical key: root note, a 5-note scale (plucks and beat-synced pops), and a 4-chord progression in semitones. */
export interface MusicKey {
  root: number;
  scale: number[];
  prog: number[];
}
export const DEFAULT_KEY: MusicKey = { root: 196, scale: [0, 3, 5, 7, 10], prog: [0, -4, -2, -5] };
/** Major pentatonic for the "clear" mood once the bar is full. */
const CLEAR_SCALE = [0, 2, 4, 7, 9];

/** Music layers that fade in as the lead chain travels: bass from ~50% of the track, drums from ~75%. */
const LAYERS = { bass: [0.45, 0.55], drums: [0.7, 0.8] } as const;
const ramp = (x: number, [a, b]: readonly [number, number]) => Math.max(0, Math.min(1, (x - a) / (b - a)));

export class Audio {
  ctx: AudioContext | null = null;
  master!: GainNode;
  sfx!: GainNode;
  music!: GainNode;
  comp!: DynamicsCompressorNode;
  noiseBuf!: AudioBuffer;
  sfxVol = 0.8;
  musicVol = 0.35;
  private musicTimer = 0;
  private musicStep = 0;
  /** Music grid for beat-synced pops: when the last step was scheduled, its length, and its chord root. */
  private stepT = -1;
  private stepLen = 0.42;
  private chordRoot = 196;
  private key: MusicKey = DEFAULT_KEY;
  /** Smoothed lead-chain progress driving the layers: rises quickly, falls slowly, so layers don't flicker. */
  private heat = 0;
  /** Bass and drums drop out until this time (a "release" after a big combo or a Reverse). */
  private calmUntil = 0;
  private clear = false;
  private layer!: { bass: GainNode; drums: GainNode };
  private voices: Record<string, Voice> = {};
  private last: Record<string, number> = {};

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const c = this.ctx;
      this.comp = c.createDynamicsCompressor();
      this.comp.threshold.value = -14;
      this.comp.ratio.value = 4;
      this.master = c.createGain();
      this.sfx = c.createGain();
      this.music = c.createGain();
      this.sfx.connect(this.comp);
      this.music.connect(this.comp);
      this.layer = { bass: c.createGain(), drums: c.createGain() };
      for (const g of Object.values(this.layer)) {
        g.gain.value = 0;
        g.connect(this.music);
      }
      this.comp.connect(this.master);
      this.master.connect(c.destination);
      this.setVolumes(this.sfxVol, this.musicVol);
      const len = c.sampleRate;
      this.noiseBuf = c.createBuffer(1, len, c.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      let s = 1234567;
      for (let i = 0; i < len; i++) {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        d[i] = (s / 0x7fffffff) * 2 - 1;
      }
      this.voices = buildVoices(this.tone.bind(this), this.noise.bind(this));
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setVolumes(sfx: number, music: number) {
    this.sfxVol = sfx;
    this.musicVol = music;
    if (!this.ctx) return;
    this.sfx.gain.value = sfx;
    this.music.gain.value = music * 0.5;
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  play(id: string | null, pitch = 0) {
    if (!id || !this.ctx || this.ctx.state !== 'running') return;
    const v = this.voices[id];
    if (!v) return;
    const now = this.ctx.currentTime;
    // Avoid machine-gun stacking of identical sounds in the same frame.
    if ((this.last[id] ?? -1) > now - 0.025) return;
    this.last[id] = now;
    if (id === 'pop' && this.musicLive(now)) return this.popOnBeat(now, pitch);
    v(now, pitch + (Math.random() - 0.5) * 0.3);
  }

  /** Is the music playing right now (so there's a beat to lock to)? */
  private musicLive(now: number) {
    return this.musicVol > 0 && this.stepT > 0 && now - this.stepT < this.stepLen * 2;
  }

  /**
   * A pop that plays with the music: the click lands instantly (so the hit still feels
   * immediate), the chime waits for the next 16th note (<= a quarter step, ~0.1 s) and is
   * pitched in the current chord. Combo steps climb the scale, so combos play an arpeggio.
   */
  private popOnBeat(now: number, pitch: number) {
    const semitones = (p: number) => Math.pow(2, p / 12);
    this.noise(now, 0.12, 0.25, 'bandpass', 5000, 1200, 1.5);
    const grid = this.stepLen / 4;
    const t = this.stepT + Math.max(0, Math.ceil((now - this.stepT) / grid)) * grid;
    const scale = this.clear ? CLEAR_SCALE : this.key.scale;
    const deg = Math.round(pitch / 2);
    const f = this.chordRoot * 2 * semitones(scale[deg % 5] + 12 * Math.floor(deg / 5));
    this.tone(t, 'sine', f * 2, f, 0.12, 0.45);
    this.tone(t + 0.01, 'triangle', f * 3, f * 1.5, 0.18, 0.18);
    this.tone(t + 0.05, 'sine', f * 4, f * 4.2, 0.22, 0.06);
  }

  // ---- primitives
  private env(g: GainNode, t: number, a: number, peak: number, dec: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
  }
  private tone(t: number, type: OscillatorType, f0: number, f1: number, dur: number, peak: number, dest: AudioNode = this.sfx, a = 0.004) {
    const c = this.ctx!;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    this.env(g, t, a, peak, dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + a + dur + 0.05);
  }
  private noise(t: number, dur: number, peak: number, filter: BiquadFilterType, f0: number, f1: number, q = 1, dest: AudioNode = this.sfx) {
    const c = this.ctx!;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const bq = c.createBiquadFilter();
    bq.type = filter;
    bq.Q.value = q;
    bq.frequency.setValueAtTime(f0, t);
    bq.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    this.env(g, t, 0.003, peak, dur);
    src.connect(bq).connect(g).connect(dest);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  /** For tests: the music's mood right now. */
  musicState() {
    return { heat: this.heat, clear: this.clear, root: this.key.root, bass: this.layer?.bass.gain.value ?? 0, drums: this.layer?.drums.gain.value ?? 0 };
  }

  /** Change key (world themes). Takes effect on the next step. */
  setKey(key: MusicKey) {
    this.key = key;
  }

  /** Drop the bass and drums for about a bar, then let them come back (a big combo or a Reverse). */
  release() {
    if (this.ctx) this.calmUntil = this.ctx.currentTime + this.stepLen * 8;
  }

  /**
   * Generative music, called every frame. A pad and pentatonic plucks always play; a bassline
   * and drums fade in as the lead chain travels (`head`, 0..1 of the track), and the tempo
   * picks up with `danger`. `clear` (the bar is full) switches to a major scale.
   */
  updateMusic(dt: number, m: { danger: number; head: number; clear: boolean }) {
    if (!this.ctx || this.ctx.state !== 'running' || this.musicVol <= 0) return;
    this.heat += (m.head - this.heat) * Math.min(1, dt * (m.head > this.heat ? 2 : 0.4));
    this.clear = m.clear;
    this.musicTimer -= dt;
    if (this.musicTimer > 0) return;
    const heat = this.heat;
    const clear = m.clear;
    const beat = 0.42 - m.danger * 0.12;
    this.musicTimer += beat;
    const t = this.ctx.currentTime + 0.02;
    const semitones = (p: number) => Math.pow(2, p / 12);
    const scale = clear ? CLEAR_SCALE : this.key.scale;
    const root = this.key.root * semitones(this.key.prog[Math.floor(this.musicStep / 16) % 4]);
    const k = this.musicStep % 16;
    this.stepT = t;
    this.stepLen = beat;
    this.chordRoot = root;

    const calm = t < this.calmUntil;
    const bass = calm ? 0 : ramp(heat, LAYERS.bass);
    const drums = calm ? 0 : ramp(heat, LAYERS.drums);
    this.layer.bass.gain.setTargetAtTime(bass, t, 0.3);
    this.layer.drums.gain.setTargetAtTime(drums, t, 0.3);

    if (k % 4 === 0) this.tone(t, 'sine', root / 2, root / 2, beat * 3.6, 0.25, this.music, 0.08); // pad
    if (k % 2 === 0 || m.danger > 0.6) {
      const n = scale[(this.musicStep * 5 + (k >> 1)) % scale.length] + (k % 8 === 6 ? 12 : 0);
      this.tone(t, 'triangle', root * semitones(n), root * semitones(n), 0.35, 0.09 + m.danger * 0.05, this.music);
    }
    // Layers are only scheduled while audible (or fading), to keep the node count down.
    if (bass > 0.01 || this.layer.bass.gain.value > 0.01) {
      const walk = [0, 0, 12, 0, 7, 0, 12, 5][k % 8];
      if (k % 2 === 0) this.tone(t, 'triangle', (root / 2) * semitones(walk), (root / 2) * semitones(walk), beat * 0.9, 0.3, this.layer.bass, 0.01);
    }
    if (drums > 0.01 || this.layer.drums.gain.value > 0.01) {
      if (k % 4 === 0) this.tone(t, 'sine', 150, 45, 0.16, 0.7, this.layer.drums, 0.002); // kick
      if (k % 8 === 4) this.noise(t, 0.12, 0.3, 'bandpass', 1800, 900, 0.8, this.layer.drums); // snare
      if (k % 2 === 1) this.noise(t, 0.03, 0.14, 'highpass', 7000, 6000, 0.7, this.layer.drums); // hat
    }
    this.musicStep++;
  }
}

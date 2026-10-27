// Procedural sound effects and ambient music on Web Audio. No asset files, so the
// PWA stays tiny and works offline. The context unlocks on the first user gesture.

type Voice = (t: number, pitch: number) => void;

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
      this.buildVoices();
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
    v(now, pitch + (Math.random() - 0.5) * 0.3);
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

  private buildVoices() {
    const st = (p: number) => Math.pow(2, p / 12);
    this.voices = {
      shoot: (t, p) => {
        this.noise(t, 0.09, 0.35, 'bandpass', 2400 * st(p), 600, 2);
        this.tone(t, 'triangle', 520 * st(p), 160, 0.1, 0.25);
      },
      clack: (t, p) => {
        this.tone(t, 'sine', 1300 * st(p * 0.7), 900, 0.05, 0.4);
        this.noise(t, 0.03, 0.3, 'highpass', 3000, 2000, 0.7);
      },
      pop: (t, p) => {
        const f = 440 * st(p);
        this.tone(t, 'sine', f * 2, f, 0.12, 0.45);
        this.tone(t + 0.01, 'triangle', f * 3, f * 1.5, 0.18, 0.18);
        this.noise(t, 0.12, 0.25, 'bandpass', 5000, 1200, 1.5);
        // Sparkle tail
        this.tone(t + 0.05, 'sine', f * 4, f * 4.2, 0.22, 0.06);
      },
      magnet: (t) => {
        this.noise(t, 0.35, 0.18, 'bandpass', 300, 1800, 4);
      },
      thunk: (t, p) => {
        this.tone(t, 'sine', 220 * st(p), 70, 0.16, 0.6);
        this.noise(t, 0.05, 0.3, 'lowpass', 1800, 300, 1);
      },
      boom: (t) => {
        this.tone(t, 'sine', 120, 30, 0.7, 0.9);
        this.noise(t, 0.6, 0.7, 'lowpass', 3000, 80, 0.8);
        this.noise(t, 0.15, 0.4, 'highpass', 4000, 1500, 0.5);
      },
      slow: (t) => {
        this.tone(t, 'sawtooth', 600, 120, 0.6, 0.12);
        this.tone(t, 'sine', 300, 80, 0.7, 0.25);
      },
      rewind: (t) => {
        for (let i = 0; i < 5; i++) this.tone(t + i * 0.06, 'square', 900 - i * 120, 700 - i * 120, 0.05, 0.08);
        this.noise(t, 0.4, 0.15, 'bandpass', 3000, 400, 3);
      },
      zap: (t) => {
        // Crackle + a falling electric whine + a thunder tail.
        for (let i = 0; i < 6; i++) this.noise(t + i * 0.035, 0.05, 0.35, 'highpass', 6000, 2500, 0.7);
        this.tone(t, 'sawtooth', 2200, 180, 0.35, 0.14);
        this.tone(t + 0.02, 'square', 1400, 90, 0.25, 0.06);
        this.noise(t + 0.08, 0.7, 0.45, 'lowpass', 900, 60, 0.8);
      },
      whiff: (t) => this.noise(t, 0.12, 0.08, 'bandpass', 1200, 400, 1),
      swap: (t) => {
        this.tone(t, 'sine', 700, 1050, 0.06, 0.2);
      },
      barfull: (t) => {
        [0, 4, 7, 12].forEach((n, i) => this.tone(t + i * 0.09, 'triangle', 523 * st(n), 523 * st(n), 0.3, 0.25));
      },
      win: (t) => {
        [0, 4, 7, 12, 16, 19, 24].forEach((n, i) => this.tone(t + i * 0.08, 'triangle', 392 * st(n), 392 * st(n), 0.35, 0.22));
      },
      lose: (t) => {
        [0, -3, -7, -12].forEach((n, i) => this.tone(t + i * 0.18, 'sawtooth', 330 * st(n), 300 * st(n), 0.35, 0.12));
        this.noise(t, 1.2, 0.3, 'lowpass', 800, 60, 1);
      },
      heart: (t) => {
        this.tone(t, 'sine', 70, 40, 0.12, 0.6);
        this.tone(t + 0.16, 'sine', 65, 38, 0.1, 0.4);
      },
      tick: (t, p) => this.tone(t, 'sine', 1800 * st(p), 1700, 0.018, 0.08),
      ui: (t) => this.tone(t, 'sine', 880, 990, 0.05, 0.15),
      cancel: (t) => {
        this.tone(t, 'sine', 520, 260, 0.12, 0.18);
        this.noise(t, 0.08, 0.08, 'lowpass', 900, 300, 1);
      },
      count: (t, p) => this.tone(t, 'square', 1200 * st(p), 1200 * st(p), 0.02, 0.05),
      coinAppear: (t) => {
        this.tone(t, 'sine', 1568, 1568, 0.08, 0.12);
        this.tone(t + 0.07, 'sine', 2093, 2093, 0.14, 0.1);
      },
      coin: (t) => {
        // Classic two-note coin + sparkle
        this.tone(t, 'square', 988, 988, 0.07, 0.12);
        this.tone(t + 0.07, 'square', 1319, 1319, 0.28, 0.12);
        for (let i = 0; i < 4; i++) this.tone(t + 0.1 + i * 0.05, 'sine', 2637 * st(i * 2), 2637 * st(i * 2), 0.08, 0.05);
      },
      crunch: (t, p) => {
        this.noise(t, 0.07, 0.4, 'bandpass', 1800 * st(p), 700, 1.5);
        this.tone(t, 'square', 180, 90, 0.05, 0.1);
      },
      wild: (t) => {
        [0, 4, 7, 11, 14, 19].forEach((n, i) => this.tone(t + i * 0.045, 'triangle', 660 * st(n), 660 * st(n), 0.16, 0.14));
      },
      scorpion: (t) => {
        for (let i = 0; i < 8; i++) this.noise(t + i * 0.03, 0.025, 0.25, 'highpass', 4000, 3000, 1);
        this.tone(t, 'sawtooth', 300, 900, 0.25, 0.08);
      },
      bossHit: (t) => {
        this.tone(t, 'sine', 160, 50, 0.3, 0.7);
        this.noise(t, 0.2, 0.45, 'lowpass', 2500, 200, 1);
        this.tone(t + 0.02, 'sawtooth', 110, 70, 0.35, 0.12);
      },
      bossThrow: (t) => {
        this.noise(t, 0.35, 0.2, 'bandpass', 400, 1400, 2);
        this.tone(t, 'sawtooth', 90, 140, 0.3, 0.1);
      },
      stun: (t) => {
        this.tone(t, 'sine', 120, 40, 0.4, 0.7);
        this.noise(t, 0.3, 0.5, 'lowpass', 1500, 100, 1);
        for (let i = 0; i < 4; i++) this.tone(t + 0.15 + i * 0.08, 'sine', 1800 - i * 200, 1500 - i * 200, 0.07, 0.07);
      },
      thud: (t) => {
        this.tone(t, 'sine', 90, 40, 0.18, 0.4);
        this.noise(t, 0.12, 0.2, 'lowpass', 900, 150, 1);
      },
      bossDown: (t) => {
        this.tone(t, 'sine', 90, 25, 1.2, 0.9);
        this.noise(t, 1.1, 0.7, 'lowpass', 2500, 60, 0.8);
        [0, 4, 7, 12, 16, 19, 24].forEach((n, i) => this.tone(t + 0.35 + i * 0.07, 'triangle', 392 * st(n), 392 * st(n), 0.3, 0.2));
      },
      ace: (t) => {
        [0, 7, 12, 16, 19, 24].forEach((n, i) => this.tone(t + i * 0.06, 'square', 523 * st(n), 523 * st(n), 0.22, 0.09));
        this.tone(t + 0.36, 'triangle', 523 * st(24), 523 * st(24), 0.6, 0.16);
      },
    };
  }

  /** Simple generative ambient: pentatonic plucks over a pad. Call every frame. */
  updateMusic(dt: number, intensity: number) {
    if (!this.ctx || this.ctx.state !== 'running' || this.musicVol <= 0) return;
    this.musicTimer -= dt;
    if (this.musicTimer > 0) return;
    const beat = 0.42 - intensity * 0.12;
    this.musicTimer += beat;
    const t = this.ctx.currentTime + 0.02;
    const scale = [0, 3, 5, 7, 10, 12, 15];
    const prog = [0, -4, -2, -5];
    const root = 196 * Math.pow(2, prog[Math.floor(this.musicStep / 16) % 4] / 12);
    const k = this.musicStep % 16;
    if (k % 4 === 0) {
      // Pad / bass
      this.tone(t, 'sine', root / 2, root / 2, beat * 3.6, 0.25, this.music, 0.08);
    }
    if (k % 2 === 0 || intensity > 0.6) {
      const n = scale[(this.musicStep * 5 + (k >> 1)) % scale.length];
      this.tone(t, 'triangle', root * Math.pow(2, n / 12), root * Math.pow(2, n / 12), 0.35, 0.09 + intensity * 0.05, this.music);
    }
    this.musicStep++;
  }
}

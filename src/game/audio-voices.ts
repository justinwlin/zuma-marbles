// The sound-effect catalogue: every named voice, built from two synth primitives (a pitched
// oscillator and filtered noise) supplied by the Audio class. Split out of audio.ts.

export type Voice = (t: number, pitch: number) => void;
export type ToneFn = (t: number, type: OscillatorType, f0: number, f1: number, dur: number, peak: number, dest?: AudioNode, a?: number) => void;
export type NoiseFn = (t: number, dur: number, peak: number, filter: BiquadFilterType, f0: number, f1: number, q?: number, dest?: AudioNode) => void;

export function buildVoices(tone: ToneFn, noise: NoiseFn): Record<string, Voice> {
  const semitones = (p: number) => Math.pow(2, p / 12);
  return {
    shoot: (t, p) => {
      noise(t, 0.09, 0.35, 'bandpass', 2400 * semitones(p), 600, 2);
      tone(t, 'triangle', 520 * semitones(p), 160, 0.1, 0.25);
    },
    clack: (t, p) => {
      tone(t, 'sine', 1300 * semitones(p * 0.7), 900, 0.05, 0.4);
      noise(t, 0.03, 0.3, 'highpass', 3000, 2000, 0.7);
    },
    pop: (t, p) => {
      const f = 440 * semitones(p);
      tone(t, 'sine', f * 2, f, 0.12, 0.45);
      tone(t + 0.01, 'triangle', f * 3, f * 1.5, 0.18, 0.18);
      noise(t, 0.12, 0.25, 'bandpass', 5000, 1200, 1.5);
      // Sparkle tail
      tone(t + 0.05, 'sine', f * 4, f * 4.2, 0.22, 0.06);
    },
    magnet: (t) => {
      noise(t, 0.35, 0.18, 'bandpass', 300, 1800, 4);
    },
    thunk: (t, p) => {
      tone(t, 'sine', 220 * semitones(p), 70, 0.16, 0.6);
      noise(t, 0.05, 0.3, 'lowpass', 1800, 300, 1);
    },
    boom: (t) => {
      tone(t, 'sine', 120, 30, 0.7, 0.9);
      noise(t, 0.6, 0.7, 'lowpass', 3000, 80, 0.8);
      noise(t, 0.15, 0.4, 'highpass', 4000, 1500, 0.5);
    },
    slow: (t) => {
      tone(t, 'sawtooth', 600, 120, 0.6, 0.12);
      tone(t, 'sine', 300, 80, 0.7, 0.25);
    },
    rewind: (t) => {
      for (let i = 0; i < 5; i++) tone(t + i * 0.06, 'square', 900 - i * 120, 700 - i * 120, 0.05, 0.08);
      noise(t, 0.4, 0.15, 'bandpass', 3000, 400, 3);
    },
    zap: (t) => {
      // Crackle + a falling electric whine + a thunder tail.
      for (let i = 0; i < 6; i++) noise(t + i * 0.035, 0.05, 0.35, 'highpass', 6000, 2500, 0.7);
      tone(t, 'sawtooth', 2200, 180, 0.35, 0.14);
      tone(t + 0.02, 'square', 1400, 90, 0.25, 0.06);
      noise(t + 0.08, 0.7, 0.45, 'lowpass', 900, 60, 0.8);
    },
    whiff: (t) => noise(t, 0.12, 0.08, 'bandpass', 1200, 400, 1),
    swap: (t) => {
      tone(t, 'sine', 700, 1050, 0.06, 0.2);
    },
    barfull: (t) => {
      [0, 4, 7, 12].forEach((n, i) => tone(t + i * 0.09, 'triangle', 523 * semitones(n), 523 * semitones(n), 0.3, 0.25));
    },
    win: (t) => {
      [0, 4, 7, 12, 16, 19, 24].forEach((n, i) => tone(t + i * 0.08, 'triangle', 392 * semitones(n), 392 * semitones(n), 0.35, 0.22));
    },
    lose: (t) => {
      [0, -3, -7, -12].forEach((n, i) => tone(t + i * 0.18, 'sawtooth', 330 * semitones(n), 300 * semitones(n), 0.35, 0.12));
      noise(t, 1.2, 0.3, 'lowpass', 800, 60, 1);
    },
    heart: (t) => {
      tone(t, 'sine', 70, 40, 0.12, 0.6);
      tone(t + 0.16, 'sine', 65, 38, 0.1, 0.4);
    },
    tick: (t, p) => tone(t, 'sine', 1800 * semitones(p), 1700, 0.018, 0.08),
    ui: (t) => tone(t, 'sine', 880, 990, 0.05, 0.15),
    cancel: (t) => {
      tone(t, 'sine', 520, 260, 0.12, 0.18);
      noise(t, 0.08, 0.08, 'lowpass', 900, 300, 1);
    },
    count: (t, p) => tone(t, 'square', 1200 * semitones(p), 1200 * semitones(p), 0.02, 0.05),
    coinAppear: (t) => {
      tone(t, 'sine', 1568, 1568, 0.08, 0.12);
      tone(t + 0.07, 'sine', 2093, 2093, 0.14, 0.1);
    },
    coin: (t) => {
      // Classic two-note coin + sparkle
      tone(t, 'square', 988, 988, 0.07, 0.12);
      tone(t + 0.07, 'square', 1319, 1319, 0.28, 0.12);
      for (let i = 0; i < 4; i++) tone(t + 0.1 + i * 0.05, 'sine', 2637 * semitones(i * 2), 2637 * semitones(i * 2), 0.08, 0.05);
    },
    crunch: (t, p) => {
      noise(t, 0.07, 0.4, 'bandpass', 1800 * semitones(p), 700, 1.5);
      tone(t, 'square', 180, 90, 0.05, 0.1);
    },
    wild: (t) => {
      [0, 4, 7, 11, 14, 19].forEach((n, i) => tone(t + i * 0.045, 'triangle', 660 * semitones(n), 660 * semitones(n), 0.16, 0.14));
    },
    scorpion: (t) => {
      for (let i = 0; i < 8; i++) noise(t + i * 0.03, 0.025, 0.25, 'highpass', 4000, 3000, 1);
      tone(t, 'sawtooth', 300, 900, 0.25, 0.08);
    },
    bossHit: (t) => {
      tone(t, 'sine', 160, 50, 0.3, 0.7);
      noise(t, 0.2, 0.45, 'lowpass', 2500, 200, 1);
      tone(t + 0.02, 'sawtooth', 110, 70, 0.35, 0.12);
    },
    bossThrow: (t) => {
      noise(t, 0.35, 0.2, 'bandpass', 400, 1400, 2);
      tone(t, 'sawtooth', 90, 140, 0.3, 0.1);
    },
    stun: (t) => {
      tone(t, 'sine', 120, 40, 0.4, 0.7);
      noise(t, 0.3, 0.5, 'lowpass', 1500, 100, 1);
      for (let i = 0; i < 4; i++) tone(t + 0.15 + i * 0.08, 'sine', 1800 - i * 200, 1500 - i * 200, 0.07, 0.07);
    },
    windup: (t) => {
      // Low rising rumble + charge whine
      tone(t, 'sawtooth', 60, 140, 0.6, 0.12);
      noise(t, 0.6, 0.18, 'bandpass', 200, 900, 3);
      tone(t + 0.1, 'sine', 300, 900, 0.5, 0.05);
    },
    spit: (t) => {
      noise(t, 0.18, 0.4, 'bandpass', 2500, 700, 2);
      tone(t, 'sine', 500, 180, 0.12, 0.3);
      noise(t + 0.05, 0.25, 0.15, 'highpass', 5000, 3000, 1);
    },
    thud: (t) => {
      // Rock impact: heavy thump + debris crackle
      tone(t, 'sine', 110, 35, 0.35, 0.7);
      noise(t, 0.3, 0.45, 'lowpass', 1600, 120, 1);
      for (let i = 0; i < 4; i++) noise(t + 0.05 + i * 0.04, 0.04, 0.15, 'highpass', 3500, 2500, 1);
    },
    bossDown: (t) => {
      tone(t, 'sine', 90, 25, 1.2, 0.9);
      noise(t, 1.1, 0.7, 'lowpass', 2500, 60, 0.8);
      [0, 4, 7, 12, 16, 19, 24].forEach((n, i) => tone(t + 0.35 + i * 0.07, 'triangle', 392 * semitones(n), 392 * semitones(n), 0.3, 0.2));
    },
    ace: (t) => {
      [0, 7, 12, 16, 19, 24].forEach((n, i) => tone(t + i * 0.06, 'square', 523 * semitones(n), 523 * semitones(n), 0.22, 0.09));
      tone(t + 0.36, 'triangle', 523 * semitones(24), 523 * semitones(24), 0.6, 0.16);
    },
  };
}

// Vibration on Android/Chrome via navigator.vibrate. iOS Safari has no Vibration
// API; toggling a hidden <input type="checkbox" switch> produces a system haptic
// tick on iOS 17.4+/18 (best effort — Apple may change this).

export class Haptics {
  enabled = true;
  private label: HTMLLabelElement | null = null;
  private lastAt = 0;
  private readonly canVibrate = typeof navigator !== 'undefined' && 'vibrate' in navigator;

  constructor() {
    if (this.canVibrate || typeof document === 'undefined') return;
    const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (!isIOS) return;
    const label = document.createElement('label');
    label.setAttribute('aria-hidden', 'true');
    label.style.cssText = 'position:fixed;left:-100px;top:0;width:1px;height:1px;opacity:0;pointer-events:none;';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    label.appendChild(input);
    document.body.appendChild(label);
    this.label = label;
  }

  pulse(pattern: number[]) {
    if (!this.enabled || !pattern.length) return;
    const now = performance.now();
    if (now - this.lastAt < 30) return;
    this.lastAt = now;
    if (this.canVibrate) {
      try {
        navigator.vibrate(pattern);
      } catch {
        /* ignore */
      }
    } else if (this.label) {
      // One tick per pulse in the pattern (on/off pairs), capped.
      const ticks = Math.min(3, Math.ceil(pattern.length / 2));
      for (let i = 0; i < ticks; i++) setTimeout(() => this.label?.click(), i * 70);
    }
  }
}

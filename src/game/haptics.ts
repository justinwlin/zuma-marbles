// Vibration on Android/Chrome via navigator.vibrate (full patterns).
// iOS Safari has no Vibration API. A *real finger tap* on an <input type="checkbox" switch>
// gives a system haptic tick; since iOS 26 scripted toggles are ignored, so index.html puts
// invisible switches under the board (tap shots, frog-tap swap) and the swap button.
// The scripted path below is kept for older iOS (17.4–18.x) where it still works.

export class Haptics {
  enabled = true;
  private label: HTMLLabelElement | null = null;
  private lastAt = 0;
  private readonly canVibrate = typeof navigator !== 'undefined' && 'vibrate' in navigator;
  /** iOS without the Vibration API: haptics come from real taps on invisible switches (see index.html). */
  readonly iosTap: boolean = !this.canVibrate && typeof navigator !== 'undefined' && (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

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

  /**
   * Immediate single tick. Call synchronously from a pointerup/touchend handler: that event is
   * a user activation, which is the only context iOS might honour a scripted switch toggle in
   * (drag-release never produces the real tap that the invisible switches rely on).
   */
  tickNow() {
    if (!this.enabled) return;
    this.lastAt = performance.now();
    if (this.canVibrate) {
      try {
        navigator.vibrate(12);
      } catch {
        /* ignore */
      }
    } else if (this.label) {
      const input = this.label.querySelector('input');
      input?.click();
    }
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

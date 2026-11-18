import { OneEuro, tiltDelta } from './logic';

type IOSOrientation = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<'granted' | 'denied'> };

const screenAngle = () => screen.orientation?.angle ?? ((window as unknown as { orientation?: number }).orientation ?? 0);

/** Aims by tilting the phone/tablet. `cursor` is in viewport pixels. */
export class TiltAim {
  cursor = { x: innerWidth / 2, y: innerHeight / 2 };
  /** degrees of tilt that move the reticle from the centre to the screen edge */
  range = 18;
  ok = false;
  onMove: (() => void) | null = null;
  private ref: { beta: number; gamma: number } | null = null;
  private fx = new OneEuro(1.5, 0.02);
  private fy = new OneEuro(1.5, 0.02);
  private last: { beta: number; gamma: number } | null = null;

  static supported() {
    return typeof DeviceOrientationEvent !== 'undefined';
  }

  /** Must be called synchronously from a tap on iOS (permission prompt). */
  static requestPermission(): Promise<boolean> {
    const D = (typeof DeviceOrientationEvent !== 'undefined' ? DeviceOrientationEvent : undefined) as IOSOrientation | undefined;
    if (!D) return Promise.resolve(false);
    if (typeof D.requestPermission !== 'function') return Promise.resolve(true);
    return D.requestPermission().then((r) => r === 'granted', () => false);
  }

  private handler = (e: DeviceOrientationEvent) => {
    if (e.beta == null || e.gamma == null) return;
    this.ok = true;
    this.last = { beta: e.beta, gamma: e.gamma };
    if (!this.ref) this.ref = { ...this.last };
    const d = tiltDelta(e.beta, e.gamma, this.ref, screenAngle());
    const t = performance.now();
    const k = 1 / Math.max(4, this.range);
    const nx = Math.max(-1, Math.min(1, this.fx.filter(d.x * k, t)));
    const ny = Math.max(-1, Math.min(1, this.fy.filter(d.y * k, t)));
    this.cursor = { x: innerWidth * (0.5 + nx / 2), y: innerHeight * (0.5 + ny / 2) };
    this.onMove?.();
  };

  /** Resolves false if no orientation events arrive (desktop, denied, unsupported). */
  start(): Promise<boolean> {
    this.stop();
    this.ref = null;
    this.ok = false;
    window.addEventListener('deviceorientation', this.handler);
    return new Promise((res) => {
      const t0 = performance.now();
      const check = () => {
        if (this.ok) res(true);
        else if (performance.now() - t0 > 1500) res(false);
        else setTimeout(check, 100);
      };
      check();
    });
  }

  /** The current pose becomes "aim at the centre". */
  recenter() {
    if (this.last) this.ref = { ...this.last };
    this.fx.reset();
    this.fy.reset();
  }

  stop() {
    window.removeEventListener('deviceorientation', this.handler);
  }
}

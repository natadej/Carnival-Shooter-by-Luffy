import type { FaceLandmarker, NormalizedLandmark } from '@mediapipe/tasks-vision';
import { applyLinear, DEFAULT_WINK, OneEuro, WinkDetector, type WinkConfig } from './logic';
import { videoFaces } from './vision';
import { clamp, type Pt } from './util';

export type EyeSide = 'left' | 'right';
export type Channel = 'L' | 'R';

export interface Calibration {
  mean: number[];
  std: number[];
  wx: number[];
  wy: number[];
  channel: Channel;
  eye: EyeSide;
  wink: WinkConfig;
}

export interface EyeFrame {
  ok: boolean;
  t: number;
  feat: number[];
  blinkL: number;
  blinkR: number;
}

const CAL_KEY = 'cs.calib.v1';

export function loadCalibration(): Calibration | null {
  try {
    const c = JSON.parse(localStorage.getItem(CAL_KEY) || 'null') as Calibration | null;
    return c && Array.isArray(c.wx) ? c : null;
  } catch {
    return null;
  }
}

export function saveCalibration(c: Calibration) {
  localStorage.setItem(CAL_KEY, JSON.stringify(c));
}

function irisFeature(lm: NormalizedLandmark[], c1: number, c2: number, top: number, bot: number): Pt {
  const a = lm[c1];
  const b = lm[c2];
  const ctr = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const iris = [lm[468], lm[473]].reduce((p, q) => (Math.hypot(q.x - ctr.x, q.y - ctr.y) < Math.hypot(p.x - ctr.x, p.y - ctr.y) ? q : p));
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const L2 = dx * dx + dy * dy || 1e-6;
  const t = ((iris.x - a.x) * dx + (iris.y - a.y) * dy) / L2;
  const lidMid = (lm[top].y + lm[bot].y) / 2;
  return { x: t - 0.5, y: (iris.y - lidMid) / Math.sqrt(L2) };
}

export function features(lm: NormalizedLandmark[], m: number[] | undefined): number[] {
  let yaw = 0;
  let pitch = 0;
  if (m && m.length >= 16) {
    yaw = Math.atan2(m[8], m[10]);
    pitch = Math.atan2(-m[9], Math.hypot(m[8], m[10]));
  } else {
    const nose = lm[1];
    const l = lm[234];
    const r = lm[454];
    yaw = (nose.x - (l.x + r.x) / 2) / Math.abs(r.x - l.x || 1e-3);
    pitch = (nose.y - (lm[10].y + lm[152].y) / 2) / Math.abs(lm[152].y - lm[10].y || 1e-3);
  }
  const A = irisFeature(lm, 33, 133, 159, 145);
  const B = irisFeature(lm, 362, 263, 386, 374);
  return [yaw, pitch, (A.x + B.x) / 2, (A.y + B.y) / 2, lm[1].x, lm[1].y];
}

export class EyeTracker {
  readonly video = document.createElement('video');
  private stream: MediaStream | null = null;
  private lm: FaceLandmarker | null = null;
  private raf = 0;
  private lastVideoT = -1;
  private fx = new OneEuro();
  private fy = new OneEuro();
  private history: { t: number; x: number; y: number }[] = [];
  private detector = new WinkDetector();
  frame: EyeFrame = { ok: false, t: 0, feat: [], blinkL: 0, blinkR: 0 };
  calib: Calibration | null = loadCalibration();
  eye: EyeSide = 'right';
  /** cursor in viewport px */
  cursor: Pt = { x: innerWidth / 2, y: innerHeight / 2 };
  listeners = new Set<(f: EyeFrame) => void>();
  onWink: ((at: Pt) => void) | null = null;

  constructor() {
    this.video.playsInline = true;
    this.video.muted = true;
    this.video.autoplay = true;
    this.setCalibration(this.calib);
  }

  get running() {
    return !!this.stream;
  }

  setSmoothing(v: number) {
    this.fx.minCutoff = this.fy.minCutoff = 3.2 - v * 2.8;
  }

  setCalibration(c: Calibration | null) {
    this.calib = c;
    this.detector = new WinkDetector(c?.wink ?? DEFAULT_WINK);
  }

  /** Which blendshape channel belongs to the chosen eye. */
  channel(): Channel {
    if (this.calib && this.calib.eye === this.eye) return this.calib.channel;
    return this.eye === 'left' ? 'L' : 'R';
  }

  async start(): Promise<void> {
    if (this.stream) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
    this.video.srcObject = this.stream;
    await this.video.play();
    this.lm = await videoFaces();
    this.loop();
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.frame = { ...this.frame, ok: false };
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const v = this.video;
    if (!this.lm || v.readyState < 2 || v.currentTime === this.lastVideoT) return;
    this.lastVideoT = v.currentTime;
    const now = performance.now();
    let res;
    try {
      res = this.lm.detectForVideo(v, now);
    } catch (e) {
      console.warn(e);
      return;
    }
    const lm = res.faceLandmarks[0];
    if (!lm || lm.length < 478) {
      this.frame = { ok: false, t: now, feat: [], blinkL: 0, blinkR: 0 };
      this.emit();
      return;
    }
    const cats = res.faceBlendshapes[0]?.categories ?? [];
    const get = (n: string) => cats.find((c) => c.categoryName === n)?.score ?? 0;
    this.frame = {
      ok: true,
      t: now,
      feat: features(lm, res.facialTransformationMatrixes?.[0]?.data),
      blinkL: get('eyeBlinkLeft'),
      blinkR: get('eyeBlinkRight'),
    };
    this.updateCursor();
    this.emit();
  };

  /** Normalised 0..1 gaze for the given features (uncalibrated: head pose only). */
  gaze(feat: number[]): Pt {
    const c = this.calib;
    if (c) {
      const z = feat.map((v, i) => (v - c.mean[i]) / (c.std[i] || 1));
      return { x: applyLinear(c.wx, z), y: applyLinear(c.wy, z) };
    }
    return { x: 0.5 - feat[0] * 2.2, y: 0.5 + feat[1] * 2.6 };
  }

  private updateCursor() {
    const f = this.frame;
    const g = this.gaze(f.feat);
    const x = this.fx.filter(clamp(g.x, -0.05, 1.05) * innerWidth, f.t);
    const y = this.fy.filter(clamp(g.y, -0.05, 1.05) * innerHeight, f.t);
    this.cursor = { x: clamp(x, 0, innerWidth), y: clamp(y, 0, innerHeight) };
    this.history.push({ t: f.t, ...this.cursor });
    while (this.history.length && f.t - this.history[0].t > 800) this.history.shift();
    const ch = this.channel();
    const chosen = ch === 'L' ? f.blinkL : f.blinkR;
    const other = ch === 'L' ? f.blinkR : f.blinkL;
    if (this.detector.update(chosen, other, f.t)) this.onWink?.(this.cursorAt(f.t - 220));
  }

  get winking() {
    return this.detector.closed;
  }

  /** Cursor position at time t (used so closing an eye doesn't nudge the aim). */
  cursorAt(t: number): Pt {
    for (let i = this.history.length - 1; i >= 0; i--) if (this.history[i].t <= t) return this.history[i];
    return this.history[0] ?? this.cursor;
  }

  private emit() {
    this.listeners.forEach((l) => l(this.frame));
  }
}

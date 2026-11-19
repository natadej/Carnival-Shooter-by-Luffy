/** Pure game/tracking logic (unit tested). */

export const SHOTS_PER_ROUND = 5;
export const HITS_TO_WIN = 3;

export interface RoundState {
  level: number;
  shotsLeft: number;
  hits: number;
  heads: number;
  pending: number;
  /** run score, carried across rounds */
  score: number;
  /** consecutive hits, carried across rounds */
  combo: number;
  /** points of the most recent hit (for floaters) */
  lastPoints: number;
}

export const newRound = (level: number, score = 0, combo = 0): RoundState => ({
  level,
  shotsLeft: SHOTS_PER_ROUND,
  hits: 0,
  heads: 0,
  pending: 0,
  score,
  combo,
  lastPoints: 0,
});

export const MAX_COMBO_MULT = 3;
export const comboMult = (combo: number) => Math.min(MAX_COMBO_MULT, 1 + 0.5 * Math.max(0, combo - 1));
export const hitPoints = (level: number, head: boolean, combo: number) => Math.round((head ? 150 : 100) * level * comboMult(combo));
export const perfectBonus = (level: number) => 500 * level;
/** Upper bound of a legit run score after clearing `level` rounds (mirrored by the leaderboard DB check). */
export const maxScore = (level: number) => 2750 * ((level * (level + 1)) / 2);

export function canShoot(r: RoundState): boolean {
  return r.shotsLeft > 0;
}

export function fire(r: RoundState): RoundState {
  if (!canShoot(r)) return r;
  return { ...r, shotsLeft: r.shotsLeft - 1, pending: r.pending + 1 };
}

export function land(r: RoundState, hit: boolean, head = false): RoundState {
  const pending = Math.max(0, r.pending - 1);
  if (!hit) return { ...r, pending, combo: 0, lastPoints: 0 };
  const combo = r.combo + 1;
  const pts = hitPoints(r.level, head, combo);
  const hits = r.hits + 1;
  const bonus = hits === SHOTS_PER_ROUND ? perfectBonus(r.level) : 0;
  return { ...r, pending, hits, heads: r.heads + (head ? 1 : 0), combo, score: r.score + pts + bonus, lastPoints: pts };
}

export type Outcome = 'playing' | 'win' | 'perfect' | 'lose';

export function outcome(r: RoundState): Outcome {
  if (r.shotsLeft > 0 || r.pending > 0) {
    // can no longer reach the target: end early only when all shots are spent
    return 'playing';
  }
  if (r.hits >= SHOTS_PER_ROUND) return 'perfect';
  return r.hits >= HITS_TO_WIN ? 'win' : 'lose';
}

/** Belt speed multiplier: ramps quickly early, then keeps creeping up. */
export function speedFor(level: number): number {
  const l = Math.min(35, Math.max(0, level - 1));
  return Math.min(5, 1 + 0.28 * l - 0.004 * l * l);
}

/** Belt speed wobble at higher levels so targets surge and brake. */
export function surge(level: number, t: number, row: number): number {
  if (level < 3) return 1;
  const amp = Math.min(0.5, 0.12 * (level - 2));
  return 1 + amp * Math.sin(t * (0.9 + 0.25 * row) + row * 2.1);
}

const wrap180 = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;

/**
 * Converts device orientation (deg) into screen-space tilt deltas relative to a reference pose.
 * `angle` is screen.orientation.angle (0, 90, 180, 270). Returns {x: right+, y: down+} in degrees.
 */
export function tiltDelta(beta: number, gamma: number, ref: { beta: number; gamma: number }, angle: number): { x: number; y: number } {
  const db = wrap180(beta - ref.beta);
  const dg = wrap180(gamma - ref.gamma);
  switch (((angle % 360) + 360) % 360) {
    case 90:
      return { x: db, y: -dg };
    case 180:
      return { x: -dg, y: -db };
    case 270:
      return { x: -db, y: dg };
    default:
      return { x: dg, y: db };
  }
}

/** Fires once per deliberate wink of the chosen eye; ignores normal two-eye blinks. */
export interface WinkConfig {
  /** blendshape value at/above which the chosen eye counts as closed */
  close: number;
  /** minimum (chosen - other) difference */
  diff: number;
  holdMs: number;
  cooldownMs: number;
}

export const DEFAULT_WINK: WinkConfig = { close: 0.5, diff: 0.3, holdMs: 70, cooldownMs: 380 };

export class WinkDetector {
  private since = -1;
  private armed = true;
  private last = -Infinity;
  closed = false;

  constructor(public cfg: WinkConfig = DEFAULT_WINK) {}

  /** `chosen`/`other` are 0..1 blink scores. Returns true on the frame the shot should fire. */
  update(chosen: number, other: number, t: number): boolean {
    const winking = chosen >= this.cfg.close && chosen - other >= this.cfg.diff;
    this.closed = winking;
    if (chosen < this.cfg.close * 0.7) this.armed = true;
    if (!winking) {
      this.since = -1;
      return false;
    }
    if (this.since < 0) this.since = t;
    if (this.armed && t - this.since >= this.cfg.holdMs && t - this.last >= this.cfg.cooldownMs) {
      this.armed = false;
      this.last = t;
      return true;
    }
    return false;
  }
}

/** Derive wink thresholds from calibration samples (eyes open vs. chosen eye shut). */
export function winkFromSamples(open: { c: number; o: number }[], shut: { c: number; o: number }[]): WinkConfig {
  const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const openC = avg(open.map((s) => s.c));
  const shutC = avg(shut.map((s) => s.c));
  const shutDiff = avg(shut.map((s) => s.c - s.o));
  const openDiff = avg(open.map((s) => s.c - s.o));
  if (shutC - openC < 0.15) return DEFAULT_WINK;
  return {
    ...DEFAULT_WINK,
    close: openC + (shutC - openC) * 0.55,
    diff: Math.max(0.12, openDiff + (shutDiff - openDiff) * 0.5),
  };
}

/** Ridge least squares: returns weights w (features + bias) minimising |Xw - y|^2 + l|w|^2. */
export function fitLinear(X: number[][], y: number[], lambda = 1e-3): number[] {
  const n = X[0].length + 1;
  const A = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const b = new Array<number>(n).fill(0);
  for (let r = 0; r < X.length; r++) {
    const row = [...X[r], 1];
    for (let i = 0; i < n; i++) {
      b[i] += row[i] * y[r];
      for (let j = 0; j < n; j++) A[i][j] += row[i] * row[j];
    }
  }
  for (let i = 0; i < n - 1; i++) A[i][i] += lambda * X.length;
  // Gaussian elimination with partial pivoting
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    [b[c], b[p]] = [b[p], b[c]];
    const d = A[c][c] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = A[r][c] / d;
      if (!f) continue;
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  return b.map((v, i) => v / (A[i][i] || 1e-12));
}

export const applyLinear = (w: number[], x: number[]) => x.reduce((s, v, i) => s + v * w[i], w[w.length - 1]);

/** One-Euro filter for smooth but responsive cursor motion. */
export class OneEuro {
  private x: number | null = null;
  private dx = 0;
  private t = 0;
  constructor(
    public minCutoff = 1.2,
    public beta = 0.004,
    public dCutoff = 1,
  ) {}
  private alpha(cut: number, dt: number) {
    const tau = 1 / (2 * Math.PI * cut);
    return 1 / (1 + tau / dt);
  }
  reset() {
    this.x = null;
  }
  filter(v: number, tMs: number): number {
    if (this.x === null) {
      this.x = v;
      this.t = tMs;
      return v;
    }
    const dt = Math.max(1e-3, (tMs - this.t) / 1000);
    this.t = tMs;
    const ad = this.alpha(this.dCutoff, dt);
    this.dx = ad * ((v - this.x) / dt) + (1 - ad) * this.dx;
    const a = this.alpha(this.minCutoff + this.beta * Math.abs(this.dx), dt);
    this.x = a * v + (1 - a) * this.x;
    return this.x;
  }
}

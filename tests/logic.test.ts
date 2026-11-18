import { describe, expect, it } from 'vitest';
import { applyLinear, canShoot, fire, fitLinear, land, newRound, outcome, OneEuro, WinkDetector, winkFromSamples } from '../src/logic';

describe('round rules', () => {
  it('needs 3 of 5 to win', () => {
    let r = newRound(1);
    for (let i = 0; i < 5; i++) r = land(fire(r), i < 3);
    expect(outcome(r)).toBe('win');
    expect(canShoot(r)).toBe(false);
  });
  it('2 of 5 loses, 5 of 5 is perfect', () => {
    let r = newRound(1);
    for (let i = 0; i < 5; i++) r = land(fire(r), i < 2);
    expect(outcome(r)).toBe('lose');
    let p = newRound(1);
    for (let i = 0; i < 5; i++) p = land(fire(p), true, i === 0);
    expect(outcome(p)).toBe('perfect');
    expect(p.heads).toBe(1);
  });
  it('waits for corks in flight and ignores a 6th shot', () => {
    let r = newRound(1);
    for (let i = 0; i < 6; i++) r = fire(r);
    expect(r.shotsLeft).toBe(0);
    expect(r.pending).toBe(5);
    expect(outcome(r)).toBe('playing');
  });
});

describe('wink detector', () => {
  it('fires once per wink of the chosen eye, after the hold time', () => {
    const d = new WinkDetector({ close: 0.5, diff: 0.3, holdMs: 60, cooldownMs: 300 });
    expect(d.update(0.8, 0.1, 0)).toBe(false);
    expect(d.update(0.8, 0.1, 70)).toBe(true);
    expect(d.update(0.8, 0.1, 140)).toBe(false);
    d.update(0.1, 0.1, 200);
    expect(d.update(0.8, 0.1, 600)).toBe(false);
    expect(d.update(0.8, 0.1, 700)).toBe(true);
  });
  it('ignores normal blinks with both eyes', () => {
    const d = new WinkDetector({ close: 0.5, diff: 0.3, holdMs: 60, cooldownMs: 300 });
    for (let t = 0; t < 300; t += 30) expect(d.update(0.9, 0.85, t)).toBe(false);
  });
  it('derives thresholds from samples', () => {
    const cfg = winkFromSamples(
      Array(10).fill({ c: 0.1, o: 0.1 }),
      Array(10).fill({ c: 0.9, o: 0.3 }),
    );
    expect(cfg.close).toBeCloseTo(0.54, 2);
    expect(cfg.diff).toBeCloseTo(0.3, 2);
  });
});

describe('gaze regression', () => {
  it('recovers a linear mapping', () => {
    const X: number[][] = [];
    const y: number[] = [];
    for (let i = 0; i < 50; i++) {
      const a = Math.sin(i);
      const b = Math.cos(i * 1.7);
      X.push([a, b]);
      y.push(0.5 + 0.3 * a - 0.2 * b);
    }
    const w = fitLinear(X, y, 0);
    expect(applyLinear(w, [0.2, -0.4])).toBeCloseTo(0.5 + 0.06 + 0.08, 4);
  });
  it('smooths jitter', () => {
    const f = new OneEuro(1, 0);
    let out = 0;
    for (let i = 0; i < 60; i++) out = f.filter(100 + (i % 2 ? 10 : -10), i * 16);
    expect(Math.abs(out - 100)).toBeLessThan(6);
  });
});

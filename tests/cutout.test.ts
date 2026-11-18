import { describe, expect, it } from 'vitest';
import { fillHoles, floodKeep } from '../src/cutout';

const grid = (rows: string[]) => Uint8Array.from(rows.join('').split('').map((c) => (c === '#' ? 1 : 0)));

describe('mask helpers', () => {
  it('keeps only the region connected to the seed', () => {
    const m = grid(['##..#', '##..#', '.....']);
    const out = floodKeep(m, 5, 3, 0, 0);
    expect([...out]).toEqual([...grid(['##...', '##...', '.....'])]);
  });
  it('fills enclosed holes', () => {
    const m = grid(['.....', '.###.', '.#.#.', '.###.', '.....']);
    expect(fillHoles(m, 5, 5)[12]).toBe(1);
  });
});

export interface Pt {
  x: number;
  y: number;
}

export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
export const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];

export function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const x = c.getContext('2d', { willReadFrequently: true });
  if (!x) throw new Error('no 2d context');
  return x;
}

/** Distance from p to segment ab. */
export function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / l2, 0, 1) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function toBlob(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'));
}

export async function blobToCanvas(b: Blob): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(b);
  const c = canvas(bmp.width, bmp.height);
  ctx2d(c).drawImage(bmp, 0, 0);
  bmp.close();
  return c;
}

export function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
}

export function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (s: number) => ((n >> s) & 255) * f;
  return rgbToHex(ch(16), ch(8), ch(0));
}

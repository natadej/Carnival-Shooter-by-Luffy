import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import { randomColors, type CharacterData, type HeadImg, type LimbKey, type PartImg, type TorsoImg } from './character';
import { photoFaces, photoPoses, SEG, segment, type CategoryMask } from './vision';
import { canvas, clamp, ctx2d, dist, rgbToHex, segDist, uid, type Pt } from './util';

const MAX_SIDE = 1400;

const OVAL = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
  172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
];

export interface FaceGeom {
  c: Pt;
  w: number;
  h: number;
  roll: number;
  chin: Pt;
  mouth: Pt;
  mouthW: number;
  oval: Pt[] | null;
}

export async function loadImageFile(file: Blob): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const s = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const c = canvas(bmp.width * s, bmp.height * s);
  ctx2d(c).drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c;
}

const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

export function faceGeom(lm: Pt[]): FaceGeom {
  return {
    c: mid(lm[10], lm[152]),
    w: dist(lm[234], lm[454]),
    h: dist(lm[10], lm[152]),
    roll: Math.atan2(lm[263].y - lm[33].y, lm[263].x - lm[33].x),
    chin: lm[152],
    mouth: mid(lm[13], lm[14]),
    mouthW: dist(lm[61], lm[291]),
    oval: OVAL.map((i) => lm[i]),
  };
}

/** Face geometry from a manual tap: centre + face width. */
export function manualGeom(c: Pt, w: number): FaceGeom {
  const h = w * 1.25;
  return {
    c,
    w,
    h,
    roll: 0,
    chin: { x: c.x, y: c.y + h / 2 },
    mouth: { x: c.x, y: c.y + h * 0.3 },
    mouthW: w * 0.38,
    oval: null,
  };
}

/** Resample a category mask to w*h with nearest neighbour. */
function classesAt(m: CategoryMask | null, w: number, h: number): Uint8Array | null {
  if (!m) return null;
  if (m.w === w && m.h === h) return m.data;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(m.h - 1, Math.floor((y * m.h) / h));
    for (let x = 0; x < w; x++) out[y * w + x] = m.data[sy * m.w + Math.min(m.w - 1, Math.floor((x * m.w) / w))];
  }
  return out;
}

function polygonMask(poly: Pt[], w: number, h: number): Uint8Array {
  const c = canvas(w, h);
  const g = ctx2d(c);
  g.fillStyle = '#fff';
  g.beginPath();
  poly.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
  g.closePath();
  g.fill();
  const d = g.getImageData(0, 0, w, h).data;
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4 + 3] > 127 ? 1 : 0;
  return out;
}

/** Keep only pixels of `m` 4-connected to the seed. */
export function floodKeep(m: Uint8Array, w: number, h: number, sx: number, sy: number): Uint8Array {
  const out = new Uint8Array(w * h);
  let seed = clamp(Math.round(sy), 0, h - 1) * w + clamp(Math.round(sx), 0, w - 1);
  if (!m[seed]) {
    // nearest set pixel to the seed
    let best = -1;
    let bd = Infinity;
    for (let i = 0; i < m.length; i++) {
      if (!m[i]) continue;
      const d = (i % w - sx) ** 2 + (Math.floor(i / w) - sy) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    if (best < 0) return out;
    seed = best;
  }
  const stack = [seed];
  out[seed] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    const n = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w];
    for (const j of n) {
      if (j >= 0 && j < m.length && m[j] && !out[j]) {
        out[j] = 1;
        stack.push(j);
      }
    }
  }
  return out;
}

/** Fill enclosed holes (e.g. eyes or glasses missed by the segmenter). */
export function fillHoles(m: Uint8Array, w: number, h: number): Uint8Array {
  const outside = new Uint8Array(w * h);
  const stack: number[] = [];
  const push = (i: number) => {
    if (!m[i] && !outside[i]) {
      outside[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (i >= w) push(i - w);
    if (i < w * (h - 1)) push(i + w);
  }
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = outside[i] ? 0 : 1;
  return out;
}

function maskToCutout(src: HTMLCanvasElement, m: Uint8Array): HTMLCanvasElement {
  const w = src.width;
  const h = src.height;
  const mc = canvas(w, h);
  const mg = ctx2d(mc);
  const id = mg.createImageData(w, h);
  for (let i = 0; i < m.length; i++) {
    if (m[i]) {
      id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = 255;
      id.data[i * 4 + 3] = 255;
    }
  }
  mg.putImageData(id, 0, 0);
  const out = canvas(w, h);
  const og = ctx2d(out);
  og.filter = 'blur(0.7px)';
  og.drawImage(mc, 0, 0);
  og.filter = 'none';
  og.globalCompositeOperation = 'source-in';
  og.drawImage(src, 0, 0);
  return out;
}

function bbox(m: Uint8Array, w: number, h: number) {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (m[y * w + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

function crop(c: HTMLCanvasElement, x0: number, y0: number, w: number, h: number): HTMLCanvasElement {
  const out = canvas(w, h);
  ctx2d(out).drawImage(c, -x0, -y0);
  return out;
}

function avgColor(px: Uint8ClampedArray, idx: number[]): string | null {
  if (idx.length < 20) return null;
  const vals = idx.map((i) => [px[i * 4], px[i * 4 + 1], px[i * 4 + 2]]);
  vals.sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));
  const mid = vals.slice(Math.floor(vals.length * 0.25), Math.ceil(vals.length * 0.75));
  const s = mid.reduce((a, v) => [a[0] + v[0], a[1] + v[1], a[2] + v[2]], [0, 0, 0]);
  return rgbToHex(s[0] / mid.length, s[1] / mid.length, s[2] / mid.length);
}

interface HeadResult {
  head: HeadImg;
  /** source px per head px */
  srcPerPx: number;
  skin: string | null;
  shirt: string | null;
}

/** Cut the head (face + hair) out upright, using the multiclass segmenter on a face-centred crop. */
export async function extractHead(src: HTMLCanvasElement, g: FaceGeom): Promise<HeadResult> {
  const S = Math.max(g.w, g.h) * 3;
  const N = Math.round(clamp(S, 160, 512));
  const k = N / S;
  const ctr = { x: g.c.x, y: g.c.y - g.h * 0.12 };
  const th = -g.roll;
  const cos = Math.cos(th);
  const sin = Math.sin(th);
  const T = (p: Pt): Pt => {
    const dx = p.x - ctr.x;
    const dy = p.y - ctr.y;
    return { x: (dx * cos - dy * sin) * k + N / 2, y: (dx * sin + dy * cos) * k + N / 2 };
  };
  const C = canvas(N, N);
  const cg = ctx2d(C);
  cg.setTransform(k * cos, k * sin, -k * sin, k * cos, N / 2 - k * (cos * ctr.x - sin * ctr.y), N / 2 - k * (sin * ctr.x + cos * ctr.y));
  cg.drawImage(src, 0, 0);
  cg.setTransform(1, 0, 0, 1, 0, 0);

  const c = T(g.c);
  const chin = T(g.chin);
  const mouth = T(g.mouth);
  const w = g.w * k;
  const h = g.h * k;
  const cls = classesAt(await segment(C), N, N);
  const oval = g.oval ? polygonMask(g.oval.map(T), N, N) : null;

  const ey = c.y - 0.1 * h;
  const cand = new Uint8Array(N * N);
  const skinIdx: number[] = [];
  const shirtIdx: number[] = [];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const ry = y < ey ? 1.05 * h : 0.95 * h;
      const inRegion = ((x - c.x) / (0.95 * w)) ** 2 + ((y - ey) / ry) ** 2 <= 1;
      const k2 = cls ? cls[i] : -1;
      if (k2 === SEG.FACE_SKIN) skinIdx.push(i);
      if (k2 === SEG.CLOTHES && y > chin.y + 0.25 * h && Math.abs(x - c.x) < w) shirtIdx.push(i);
      if (!inRegion) continue;
      const belowChin = y > chin.y + 0.04 * h;
      let on: boolean;
      if (!cls) on = true;
      else if (k2 === SEG.HAIR) on = true;
      else if (k2 === SEG.FACE_SKIN || k2 === SEG.OTHER) on = !belowChin;
      else on = false;
      if (oval && oval[i]) on = true;
      cand[i] = on ? 1 : 0;
    }
  }
  let m = floodKeep(cand, N, N, c.x, c.y);
  m = fillHoles(m, N, N);
  const area = m.reduce((a, v) => a + v, 0);
  if (area < w * h * 0.5) {
    // segmentation failed: fall back to a soft ellipse around the face
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++)
        m[y * N + x] = ((x - c.x) / (0.62 * w)) ** 2 + ((y - (c.y - 0.08 * h)) / (0.62 * h)) ** 2 <= 1 ? 1 : 0;
  }
  const cut = maskToCutout(C, m);
  const bb = bbox(m, N, N)!;
  const pad = 3;
  const x0 = Math.max(0, bb.x0 - pad);
  const y0 = Math.max(0, bb.y0 - pad);
  const img = crop(cut, x0, y0, Math.min(N, bb.x1 + pad) - x0, Math.min(N, bb.y1 + pad) - y0);
  const px = cg.getImageData(0, 0, N, N).data;
  return {
    head: {
      img,
      chin: { x: chin.x - x0, y: Math.min(chin.y, bb.y1) - y0 },
      mouth: { x: mouth.x - x0, y: mouth.y - y0 },
      mouthW: g.mouthW * k,
      faceW: w,
    },
    srcPerPx: 1 / k,
    skin: avgColor(px, skinIdx),
    shirt: avgColor(px, shirtIdx),
  };
}

interface PosePt extends Pt {
  vis: number;
}

const LEFT_CHAIN = [11, 13, 15, 23, 25, 27];
const RIGHT_CHAIN = [12, 14, 16, 24, 26, 28];

function matchPose(poses: NormalizedLandmark[][], g: FaceGeom, W: number, H: number): PosePt[] | null {
  let best: PosePt[] | null = null;
  let bd = Infinity;
  for (const p of poses) {
    const pts = p.map((l) => ({ x: l.x * W, y: l.y * H, vis: l.visibility ?? 1 }));
    const d = dist(pts[0], g.c);
    if (d < g.w * 0.8 && d < bd) {
      bd = d;
      best = pts;
    }
  }
  return best;
}

interface BodyResult {
  torso: TorsoImg;
  limbs: Partial<Record<LimbKey, PartImg>>;
  /** source px per body px */
  srcPerPx: number;
  pants: string | null;
  skin: string | null;
}

function bakePart(
  B: HTMLCanvasElement,
  px: Uint8ClampedArray,
  labels: Int8Array,
  id: number,
  A: Pt,
  E: Pt,
  up: boolean,
  extra: Pt[] = [],
): { part: PartImg; extra: Pt[] } | null {
  const w = B.width;
  const h = B.height;
  const alpha = (up ? -Math.PI / 2 : Math.PI / 2) - Math.atan2(E.y - A.y, E.x - A.x);
  const ca = Math.cos(alpha);
  const sa = Math.sin(alpha);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let n = 0;
  const tmp = canvas(w, h);
  const tg = ctx2d(tmp);
  const id2 = tg.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (labels[i] !== id) continue;
      n++;
      const dx = x - A.x;
      const dy = y - A.y;
      const rx = dx * ca - dy * sa;
      const ry = dx * sa + dy * ca;
      if (rx < minX) minX = rx;
      if (rx > maxX) maxX = rx;
      if (ry < minY) minY = ry;
      if (ry > maxY) maxY = ry;
      id2.data[i * 4] = px[i * 4];
      id2.data[i * 4 + 1] = px[i * 4 + 1];
      id2.data[i * 4 + 2] = px[i * 4 + 2];
      id2.data[i * 4 + 3] = 255;
    }
  }
  if (n < 40) return null;
  tg.putImageData(id2, 0, 0);
  const pad = 2;
  const out = canvas(maxX - minX + pad * 2 + 1, maxY - minY + pad * 2 + 1);
  const og = ctx2d(out);
  const ox = -minX + pad;
  const oy = -minY + pad;
  og.setTransform(ca, sa, -sa, ca, ox - (ca * A.x - sa * A.y), oy - (sa * A.x + ca * A.y));
  og.drawImage(tmp, 0, 0);
  const tr = (p: Pt): Pt => {
    const dx = p.x - A.x;
    const dy = p.y - A.y;
    return { x: dx * ca - dy * sa + ox, y: dx * sa + dy * ca + oy };
  };
  return { part: { img: out, ax: ox, ay: oy, len: dist(A, E) }, extra: extra.map(tr) };
}

/** Cut the body into puppet parts using pose landmarks + person segmentation. */
async function extractBody(src: HTMLCanvasElement, P: PosePt[], g: FaceGeom): Promise<BodyResult | null> {
  const W = src.width;
  const H = src.height;
  const V = (i: number) => P[i].vis > 0.5 && P[i].x > -2 && P[i].y > -2 && P[i].x < W + 2 && P[i].y < H + 2;
  if (!(V(11) && V(12) && V(23) && V(24))) return null;
  const [Lc, Rc] = P[11].x <= P[12].x ? [LEFT_CHAIN, RIGHT_CHAIN] : [RIGHT_CHAIN, LEFT_CHAIN];
  const shW = dist(P[11], P[12]);
  if (shW < 20) return null;
  const armOk = (c: number[]) => V(c[0]) && V(c[1]) && V(c[2]);
  const legOk = (c: number[]) => V(c[3]) && V(c[4]) && V(c[5]);

  const used = [11, 12, 23, 24];
  for (const c of [Lc, Rc]) {
    if (armOk(c)) used.push(c[1], c[2]);
    if (legOk(c)) used.push(c[4], c[5]);
  }
  const m0 = shW * 0.7;
  let x0 = Math.min(...used.map((i) => P[i].x), g.c.x - g.w) - m0;
  let x1 = Math.max(...used.map((i) => P[i].x), g.c.x + g.w) + m0;
  let y0 = g.c.y - g.h;
  let y1 = Math.max(...used.map((i) => P[i].y)) + m0;
  x0 = clamp(x0, 0, W);
  x1 = clamp(x1, 0, W);
  y0 = clamp(y0, 0, H);
  y1 = clamp(y1, 0, H);
  const kb = Math.min(1, 720 / Math.max(x1 - x0, y1 - y0));
  const bw = Math.round((x1 - x0) * kb);
  const bh = Math.round((y1 - y0) * kb);
  if (bw < 40 || bh < 40) return null;
  const B = canvas(bw, bh);
  const bg = ctx2d(B);
  bg.drawImage(src, x0, y0, x1 - x0, y1 - y0, 0, 0, bw, bh);
  const T = (p: Pt): Pt => ({ x: (p.x - x0) * kb, y: (p.y - y0) * kb });
  const Q = (i: number) => T(P[i]);
  const cls = classesAt(await segment(B), bw, bh);
  if (!cls) return null;

  const fc = T(g.c);
  const fw = g.w * kb;
  const chin = T(g.chin);
  const cand = new Uint8Array(bw * bh);
  for (let y = 0; y < bh; y++)
    for (let x = 0; x < bw; x++) {
      const i = y * bw + x;
      const k2 = cls[i];
      const inHead = Math.abs(x - fc.x) < fw * 0.75 && y < chin.y;
      cand[i] = !inHead && (k2 === SEG.BODY_SKIN || k2 === SEG.CLOTHES || k2 === SEG.OTHER) ? 1 : 0;
    }
  const sL = Q(Lc[0]);
  const sR = Q(Rc[0]);
  const hL = Q(Lc[3]);
  const hR = Q(Rc[3]);
  const shMid = mid(sL, sR);
  const hipMid = mid(hL, hR);
  const mask = floodKeep(cand, bw, bh, (shMid.x + hipMid.x) / 2, (shMid.y + hipMid.y) / 2);

  const s = shW * kb;
  const ext = (a: Pt, b: Pt, f: number): Pt => ({ x: b.x + (b.x - a.x) * f, y: b.y + (b.y - a.y) * f });
  interface Bone {
    id: number;
    key: LimbKey | 'torso';
    a: Pt;
    b: Pt;
    r: number;
  }
  const bones: Bone[] = [{ id: 0, key: 'torso', a: hipMid, b: shMid, r: s * 0.42 }];
  const addArm = (c: number[], ua: LimbKey, fa: LimbKey) => {
    if (!armOk(c)) return;
    const S1 = Q(c[0]);
    const E1 = Q(c[1]);
    const W1 = Q(c[2]);
    bones.push({ id: bones.length, key: ua, a: S1, b: E1, r: s * 0.13 });
    bones.push({ id: bones.length, key: fa, a: E1, b: ext(E1, W1, 0.3), r: s * 0.12 });
  };
  const addLeg = (c: number[], th: LimbKey, sn: LimbKey) => {
    if (!legOk(c)) return;
    const H1 = Q(c[3]);
    const K1 = Q(c[4]);
    const A1 = Q(c[5]);
    bones.push({ id: bones.length, key: th, a: H1, b: K1, r: s * 0.18 });
    bones.push({ id: bones.length, key: sn, a: K1, b: ext(K1, A1, 0.22), r: s * 0.15 });
  };
  addArm(Lc, 'uaL', 'faL');
  addArm(Rc, 'uaR', 'faR');
  addLeg(Lc, 'thL', 'snL');
  addLeg(Rc, 'thR', 'snR');
  const haveLegs = legOk(Lc) || legOk(Rc);

  const labels = new Int8Array(bw * bh).fill(-1);
  for (let y = 0; y < bh; y++)
    for (let x = 0; x < bw; x++) {
      const i = y * bw + x;
      if (!mask[i]) continue;
      const p = { x, y };
      let best = -1;
      let bd = Infinity;
      for (const b of bones) {
        const d = segDist(p, b.a, b.b) - b.r;
        if (d < bd) {
          bd = d;
          best = b.id;
        }
      }
      if (bd > s * 0.5) continue;
      if (best === 0 && !haveLegs && y > hipMid.y + s * 0.15) continue;
      labels[i] = best;
    }

  const px = bg.getImageData(0, 0, bw, bh).data;
  const neck = { x: shMid.x + (chin.x - shMid.x) * 0.6, y: shMid.y + (chin.y - shMid.y) * 0.6 };
  const tb = bakePart(B, px, labels, 0, hipMid, shMid, true, [neck, sL, sR, hL, hR]);
  if (!tb) return null;
  const torso: TorsoImg = {
    ...tb.part,
    neck: tb.extra[0],
    shL: tb.extra[1],
    shR: tb.extra[2],
    hipL: tb.extra[3],
    hipR: tb.extra[4],
  };
  const limbs: Partial<Record<LimbKey, PartImg>> = {};
  for (const b of bones.slice(1)) {
    const r = bakePart(B, px, labels, b.id, b.a, b.b, false);
    if (r) limbs[b.key as LimbKey] = r.part;
  }
  const pantsIdx: number[] = [];
  const skinIdx: number[] = [];
  for (let i = 0; i < labels.length; i++) {
    const bk = labels[i] >= 0 ? bones[labels[i]].key : null;
    if (!bk) continue;
    if ((bk === 'thL' || bk === 'thR') && cls[i] === SEG.CLOTHES) pantsIdx.push(i);
    if (cls[i] === SEG.BODY_SKIN) skinIdx.push(i);
  }
  return { torso, limbs, srcPerPx: 1 / kb, pants: avgColor(px, pantsIdx), skin: avgColor(px, skinIdx) };
}

export async function buildCharacter(src: HTMLCanvasElement, g: FaceGeom, pose: PosePt[] | null, name: string): Promise<CharacterData> {
  const hr = await extractHead(src, g);
  const body = pose ? await extractBody(src, pose, g).catch((e) => (console.warn(e), null)) : null;
  const colors = randomColors(hr.skin ?? body?.skin ?? undefined);
  if (hr.shirt) colors.shirt = hr.shirt;
  if (body?.pants) colors.pants = body.pants;
  return {
    id: uid(),
    name,
    createdAt: Date.now(),
    head: hr.head,
    colors,
    torso: body?.torso,
    limbs: body?.limbs ?? {},
    headToBody: body ? hr.srcPerPx / body.srcPerPx : undefined,
  };
}

/** Find every face in a photo and turn each into a character. */
export async function detectFriends(src: HTMLCanvasElement, nameFor: (i: number) => string): Promise<CharacterData[]> {
  const [fl, pl] = await Promise.all([photoFaces(), photoPoses()]);
  const W = src.width;
  const H = src.height;
  const faces = fl.detect(src).faceLandmarks.map((f) => faceGeom(f.map((p) => ({ x: p.x * W, y: p.y * H }))));
  faces.sort((a, b) => a.c.x - b.c.x);
  let poses: NormalizedLandmark[][] = [];
  try {
    const pr = pl.detect(src);
    poses = pr.landmarks;
    pr.close?.();
  } catch (e) {
    console.warn('pose failed', e);
  }
  // small faces in full-body shots: zoom into each unmatched pose's head and retry
  for (const pose of poses) {
    const px = (i: number) => ({ x: pose[i].x * W, y: pose[i].y * H });
    const nose = px(0);
    const sw = dist(px(11), px(12));
    const ew = dist(px(7), px(8));
    const est = Math.max(ew * 1.25, sw * 0.5, 12);
    if (faces.some((f) => dist(f.c, nose) < Math.max(f.w, est))) continue;
    if (pose[0].visibility !== undefined && pose[0].visibility < 0.5) continue;
    const side = est * 3;
    const sx = clamp(nose.x - side / 2, 0, W - 1);
    const sy = clamp(nose.y - side / 2, 0, H - 1);
    const cw = Math.min(side, W - sx);
    const chh = Math.min(side, H - sy);
    const k = 512 / Math.max(cw, chh);
    const crop = document.createElement('canvas');
    crop.width = Math.round(cw * k);
    crop.height = Math.round(chh * k);
    crop.getContext('2d')!.drawImage(src, sx, sy, cw, chh, 0, 0, crop.width, crop.height);
    const lm = fl.detect(crop).faceLandmarks[0];
    faces.push(
      lm
        ? faceGeom(lm.map((p) => ({ x: sx + (p.x * crop.width) / k, y: sy + (p.y * crop.height) / k })))
        : manualGeom(nose, est),
    );
  }
  faces.sort((a, b) => a.c.x - b.c.x);
  const out: CharacterData[] = [];
  for (let i = 0; i < faces.length; i++) {
    const g = faces[i];
    if (g.w < 10) continue;
    out.push(await buildCharacter(src, g, matchPose(poses, g, W, H), nameFor(out.length)));
  }
  return out;
}

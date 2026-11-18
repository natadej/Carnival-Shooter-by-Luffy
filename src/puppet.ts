import type { PartImg, RuntimeChar } from './character';
import type { Pt } from './util';

/** Angles are canvas rotations (radians, + = clockwise) applied to a limb hanging straight down. */
export interface Pose {
  x: number;
  y: number;
  rot: number;
  lean: number;
  head: number;
  hs: number;
  aL: number;
  eL: number;
  aR: number;
  eR: number;
  lL: number;
  kL: number;
  lR: number;
  kR: number;
  tongue: number;
  sq: number;
  flip: boolean;
}

export const rest = (): Pose => ({
  x: 0, y: 0, rot: 0, lean: 0, head: 0, hs: 1,
  aL: 0.15, eL: 0.1, aR: -0.15, eR: -0.1,
  lL: 0.04, kL: 0, lR: -0.04, kR: 0,
  tongue: 0, sq: 1, flip: false,
});

const TAU = Math.PI * 2;
const sin = Math.sin;
const cos = Math.cos;

export type AnimName =
  | 'run' | 'dance' | 'floss' | 'jacks' | 'taunt' | 'hips' | 'chicken' | 'laugh' | 'moonwalk' | 'wave' | 'hurt' | 'idle';

export const MOVE_ANIMS: AnimName[] = ['run', 'moonwalk', 'dance', 'chicken', 'jacks'];
export const STOP_ANIMS: AnimName[] = ['taunt', 'floss', 'hips', 'dance', 'chicken', 'wave', 'jacks'];

export function animate(name: AnimName, t: number): Pose {
  const p = rest();
  switch (name) {
    case 'run': {
      const f = TAU * 2.6 * t;
      const s = sin(f);
      p.lL = 0.7 * s;
      p.lR = -0.7 * s;
      p.kL = s < 0 ? -0.9 * -s : 0;
      p.kR = s > 0 ? 0.9 * s : 0;
      p.aL = -0.8 * s;
      p.eL = 1.1;
      p.aR = 0.8 * s;
      p.eR = 1.1;
      p.y = -0.1 * Math.abs(cos(f));
      p.lean = 0.12;
      p.head = 0.08 * sin(f * 2);
      break;
    }
    case 'moonwalk': {
      const f = TAU * 1.4 * t;
      const s = sin(f);
      p.lL = 0.25 * Math.max(0, s);
      p.kL = -0.6 * Math.max(0, s);
      p.lR = 0.25 * Math.max(0, -s);
      p.kR = -0.6 * Math.max(0, -s);
      p.aL = 0.3 * s;
      p.aR = 0.3 * s;
      p.eL = 0.5;
      p.eR = -0.5;
      p.lean = -0.1;
      p.head = -0.15 + 0.1 * sin(f * 2);
      break;
    }
    case 'dance': {
      const f = TAU * 1.7 * t;
      const s = sin(f);
      p.lean = 0.14 * s;
      p.x = 0.07 * s;
      p.y = -0.07 * Math.abs(s);
      p.aL = 2.5 + 0.35 * sin(f * 2);
      p.eL = 0.5 * sin(f * 2 + 1);
      p.aR = -2.5 + 0.35 * sin(f * 2 + Math.PI);
      p.eR = -0.5 * sin(f * 2 + 1);
      p.kL = -0.2 - 0.2 * Math.abs(s);
      p.kR = 0.2 + 0.2 * Math.abs(s);
      p.head = -0.18 * s;
      break;
    }
    case 'floss': {
      const f = TAU * 2.2 * t;
      const s = sin(f);
      p.aL = 0.25 + 0.75 * s;
      p.aR = -0.25 + 0.75 * s;
      p.eL = 0.15;
      p.eR = -0.15;
      p.x = -0.1 * s;
      p.lean = -0.18 * s;
      p.head = 0.12 * s;
      break;
    }
    case 'jacks': {
      const f = TAU * 1.5 * t;
      const k = (1 - cos(f)) / 2;
      p.aL = 0.2 + 2.7 * k;
      p.aR = -(0.2 + 2.7 * k);
      p.eL = 0.2 * k;
      p.eR = -0.2 * k;
      p.lL = 0.05 + 0.38 * k;
      p.lR = -(0.05 + 0.38 * k);
      p.y = -0.22 * Math.abs(sin(f));
      p.hs = 1 + 0.05 * k;
      break;
    }
    case 'taunt': {
      const f = TAU * 1.3 * t;
      const w = 0.3 * sin(TAU * 6 * t);
      p.aL = 2.1;
      p.eL = 1.35 + w;
      p.aR = -2.1;
      p.eR = -1.35 - w;
      p.head = 0.22 * sin(f);
      p.lean = 0.08 * sin(f);
      p.tongue = 1;
      p.kL = -0.25;
      p.kR = 0.25;
      p.y = -0.03 * Math.abs(sin(f * 2));
      break;
    }
    case 'hips': {
      const f = TAU * 3 * t;
      const s = sin(f);
      p.x = 0.13 * s;
      p.rot = 0.05 * s;
      p.lean = -0.12 * s;
      p.aL = 0.75;
      p.eL = -2.2;
      p.aR = -0.75;
      p.eR = 2.2;
      p.kL = -0.3;
      p.kR = 0.3;
      p.head = 0.18 * s;
      p.tongue = 0.6;
      break;
    }
    case 'chicken': {
      const f = TAU * 2.8 * t;
      const flap = Math.max(0, sin(f));
      p.aL = 0.35 + 0.7 * flap;
      p.eL = 2.6;
      p.aR = -(0.35 + 0.7 * flap);
      p.eR = -2.6;
      p.head = 0.25 * sin(f / 2);
      p.y = -0.05 * flap;
      p.kL = -0.35;
      p.kR = 0.35;
      p.lL = 0.15;
      p.lR = -0.15;
      break;
    }
    case 'laugh': {
      const f = TAU * 7 * t;
      p.aR = -1.6;
      p.eR = -0.1;
      p.aL = 0.4;
      p.eL = -1.7;
      p.lean = -0.12;
      p.y = -0.03 * Math.abs(sin(f));
      p.hs = 1 + 0.06 * sin(f);
      p.head = -0.15;
      p.tongue = 0.4;
      break;
    }
    case 'wave': {
      const f = TAU * 2.5 * t;
      p.aR = -2.6;
      p.eR = -0.5 + 0.6 * sin(f);
      p.aL = 0.75;
      p.eL = -2.2;
      p.head = 0.15 * sin(f / 2);
      p.x = 0.04 * sin(f / 2);
      break;
    }
    case 'hurt': {
      p.aL = 2.9;
      p.aR = -2.9;
      p.eL = 0.3;
      p.eR = -0.3;
      p.lL = 0.35;
      p.lR = -0.35;
      p.head = 0.3 * sin(TAU * 4 * t);
      break;
    }
    case 'idle': {
      p.y = -0.02 * Math.abs(sin(TAU * t));
      p.head = 0.05 * sin(TAU * 0.7 * t);
      break;
    }
  }
  return p;
}

export interface Capsule {
  a: Pt;
  b: Pt;
  r: number;
  head?: boolean;
}

interface Rig {
  s: number;
  neck: Pt;
  shL: Pt;
  shR: Pt;
  hipL: Pt;
  hipR: Pt;
  ua: number;
  fa: number;
  th: number;
  sn: number;
  headScale: number;
}

const CARTOON = { ua: 0.46, fa: 0.42, th: 0.46, sn: 0.44 };

const rigCache = new WeakMap<RuntimeChar, Rig>();

function rigFor(c: RuntimeChar): Rig {
  let r = rigCache.get(c);
  if (r) return r;
  const t = c.torso;
  const L = c.limbs;
  if (t) {
    const s = 1 / t.len;
    const rel = (p: Pt): Pt => ({ x: (p.x - t.ax) * s, y: (p.y - t.ay) * s });
    const len = (p: PartImg | undefined, q: PartImg | undefined, d: number) => (p && q ? ((p.len + q.len) / 2) * s : d);
    const nat = c.head.faceW * (c.data.headToBody ?? 1) * s;
    r = {
      s,
      neck: rel(t.neck),
      shL: rel(t.shL),
      shR: rel(t.shR),
      hipL: rel(t.hipL),
      hipR: rel(t.hipR),
      ua: len(L.uaL, L.uaR, CARTOON.ua),
      fa: len(L.faL, L.faR, CARTOON.fa),
      th: len(L.thL, L.thR, CARTOON.th),
      sn: len(L.snL, L.snR, CARTOON.sn),
      headScale: Math.max(nat * 1.45, 0.55) / c.head.faceW,
    };
  } else {
    r = {
      s: 1,
      neck: { x: 0, y: -0.86 },
      shL: { x: -0.33, y: -0.74 },
      shR: { x: 0.33, y: -0.74 },
      hipL: { x: -0.17, y: -0.04 },
      hipR: { x: 0.17, y: -0.04 },
      ...CARTOON,
      headScale: 1.05 / c.head.faceW,
    };
  }
  rigCache.set(c, r);
  return r;
}

/** Height from feet to hip joint, used to stand the puppet on the ground. */
export function legHeight(c: RuntimeChar): number {
  const r = rigFor(c);
  return r.th + r.sn + 0.05 + Math.max(r.hipL.y, r.hipR.y);
}

const INK = '#2b1b10';

function capsule(g: CanvasRenderingContext2D, len: number, w: number, color: string) {
  g.lineCap = 'round';
  g.strokeStyle = INK;
  g.lineWidth = w + 0.07;
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(0, len);
  g.stroke();
  g.strokeStyle = color;
  g.lineWidth = w;
  g.stroke();
}

function blob(g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, color: string) {
  g.fillStyle = color;
  g.strokeStyle = INK;
  g.lineWidth = 0.05;
  g.beginPath();
  g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  g.fill();
  g.stroke();
}

function img(g: CanvasRenderingContext2D, p: PartImg, s: number) {
  g.save();
  g.scale(s, s);
  g.drawImage(p.img, -p.ax, -p.ay);
  g.restore();
}

/**
 * Draws a puppet whose feet are at the current origin and whose size is 1 unit = torso length.
 * Returns hit capsules in canvas pixel space.
 */
export function drawPuppet(g: CanvasRenderingContext2D, c: RuntimeChar, p: Pose, hits?: Capsule[]): void {
  const r = rigFor(c);
  const col = c.data.colors;
  const L = c.limbs;
  const record = (a: Pt, b: Pt, rad: number, head = false) => {
    if (!hits) return;
    const m = g.getTransform();
    const A = m.transformPoint(a);
    const B = m.transformPoint(b);
    const sc = Math.hypot(m.a, m.b);
    hits.push({ a: { x: A.x, y: A.y }, b: { x: B.x, y: B.y }, r: rad * sc, head });
  };

  g.save();
  if (p.flip) g.scale(-1, 1);
  g.translate(p.x, p.y - legHeight(c));
  g.rotate(p.rot);
  g.scale(1, p.sq);

  const leg = (hip: Pt, a: number, k: number, th: 'thL' | 'thR', sn: 'snL' | 'snR') => {
    g.save();
    g.translate(hip.x, hip.y);
    g.rotate(a);
    const T = L[th];
    if (T) img(g, T, r.s);
    else capsule(g, r.th, 0.22, col.pants);
    record({ x: 0, y: 0 }, { x: 0, y: r.th }, 0.13);
    g.translate(0, r.th);
    g.rotate(k);
    const S = L[sn];
    if (S) img(g, S, r.s);
    else {
      capsule(g, r.sn, 0.2, col.pants);
      blob(g, (hip.x < 0 ? -1 : 1) * 0.05, r.sn + 0.04, 0.15, 0.08, col.shoes);
    }
    record({ x: 0, y: 0 }, { x: 0, y: r.sn }, 0.12);
    g.restore();
  };
  leg(r.hipL, p.lL, p.kL, 'thL', 'snL');
  leg(r.hipR, p.lR, p.kR, 'thR', 'snR');

  g.rotate(p.lean);
  if (c.torso) {
    g.fillStyle = col.shirt;
    g.beginPath();
    g.moveTo(r.shL.x * 0.85, r.shL.y * 0.95);
    g.lineTo(r.shR.x * 0.85, r.shR.y * 0.95);
    g.lineTo(r.hipR.x * 0.9, r.hipR.y);
    g.lineTo(r.hipL.x * 0.9, r.hipL.y);
    g.fill();
    img(g, c.torso, r.s);
  } else {
    g.fillStyle = col.pants;
    g.strokeStyle = INK;
    g.lineWidth = 0.05;
    g.beginPath();
    g.roundRect(-0.26, -0.22, 0.52, 0.3, 0.08);
    g.fill();
    g.stroke();
    g.fillStyle = col.shirt;
    g.beginPath();
    g.moveTo(-0.36, -0.7);
    g.quadraticCurveTo(0, -0.9, 0.36, -0.7);
    g.lineTo(0.3, -0.12);
    g.quadraticCurveTo(0, -0.04, -0.3, -0.12);
    g.closePath();
    g.fill();
    g.stroke();
  }
  record({ x: 0, y: r.neck.y * 0.85 }, { x: 0, y: -0.05 }, Math.abs(r.shR.x - r.shL.x) * 0.5);

  const arm = (sh: Pt, a: number, e: number, ua: 'uaL' | 'uaR', fa: 'faL' | 'faR') => {
    g.save();
    g.translate(sh.x, sh.y);
    g.rotate(a);
    const U = L[ua];
    if (U) img(g, U, r.s);
    else capsule(g, r.ua, 0.19, col.shirt);
    record({ x: 0, y: 0 }, { x: 0, y: r.ua }, 0.11);
    g.translate(0, r.ua);
    g.rotate(e);
    const F = L[fa];
    if (F) img(g, F, r.s);
    else {
      capsule(g, r.fa, 0.15, col.skin);
      blob(g, 0, r.fa + 0.03, 0.09, 0.09, col.skin);
    }
    record({ x: 0, y: 0 }, { x: 0, y: r.fa }, 0.1);
    g.restore();
  };
  arm(r.shL, p.aL, p.eL, 'uaL', 'faL');
  arm(r.shR, p.aR, p.eR, 'uaR', 'faR');

  const h = c.head;
  g.translate(r.neck.x, r.neck.y);
  g.rotate(p.head);
  const hsc = r.headScale * p.hs;
  g.scale(hsc, hsc * (2 - p.hs));
  g.drawImage(h.img, -h.chin.x, -h.chin.y + h.faceW * 0.04);
  const hc = { x: h.img.width / 2 - h.chin.x, y: h.img.height / 2 - h.chin.y };
  record(hc, hc, Math.min(h.img.width, h.img.height) * 0.45, true);
  if (p.tongue > 0) {
    const mx = h.mouth.x - h.chin.x;
    const my = h.mouth.y - h.chin.y + h.faceW * 0.04;
    const tw = h.mouthW * 0.42;
    const tl = h.mouthW * 0.75 * p.tongue;
    g.fillStyle = '#ff5c8a';
    g.strokeStyle = INK;
    g.lineWidth = h.faceW * 0.02;
    g.beginPath();
    g.moveTo(mx - tw, my);
    g.lineTo(mx - tw, my + tl - tw);
    g.arc(mx, my + tl - tw, tw, Math.PI, 0, true);
    g.lineTo(mx + tw, my);
    g.closePath();
    g.fill();
    g.stroke();
    g.beginPath();
    g.moveTo(mx, my + tw * 0.3);
    g.lineTo(mx, my + tl - tw * 0.8);
    g.stroke();
  }
  g.restore();
}

export function hitTest(caps: Capsule[], p: Pt, slack: number): { hit: boolean; head: boolean } {
  let hit = false;
  for (const c of caps) {
    const dx = c.b.x - c.a.x;
    const dy = c.b.y - c.a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((p.x - c.a.x) * dx + (p.y - c.a.y) * dy) / l2)) : 0;
    const d = Math.hypot(p.x - (c.a.x + t * dx), p.y - (c.a.y + t * dy));
    if (d <= c.r + slack) {
      if (c.head) return { hit: true, head: true };
      hit = true;
    }
  }
  return { hit, head: false };
}

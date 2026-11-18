import { canvas, ctx2d, pick, shade, type Pt } from './util';

export type LimbKey = 'uaL' | 'faL' | 'uaR' | 'faR' | 'thL' | 'snL' | 'thR' | 'snR';
export const LIMBS: LimbKey[] = ['uaL', 'faL', 'uaR', 'faR', 'thL', 'snL', 'thR', 'snR'];

/** A body part image baked so its bone points straight down from (ax, ay). */
export interface PartImg {
  img: HTMLCanvasElement;
  ax: number;
  ay: number;
  len: number;
}

/** Torso baked upright: hip centre at (ax, ay), neck straight above. */
export interface TorsoImg extends PartImg {
  neck: Pt;
  shL: Pt;
  shR: Pt;
  hipL: Pt;
  hipR: Pt;
}

export interface HeadImg {
  img: HTMLCanvasElement;
  chin: Pt;
  mouth: Pt;
  mouthW: number;
  faceW: number;
}

export interface Colors {
  shirt: string;
  pants: string;
  skin: string;
  shoes: string;
}

export interface CharacterData {
  id: string;
  name: string;
  createdAt: number;
  builtin?: boolean;
  head: HeadImg;
  colors: Colors;
  /** Present when the photo showed the upper body. */
  torso?: TorsoImg;
  limbs: Partial<Record<LimbKey, PartImg>>;
  /** Head px -> torso px factor for photo bodies. */
  headToBody?: number;
}

export const SHIRTS = ['#ff5a5f', '#ffb400', '#00a699', '#3d7eff', '#a659ff', '#ff7ab6', '#2ec4b6', '#ff8c42'];
export const PANTS = ['#2f4b8a', '#3a3a5a', '#6b4f2a', '#1f6f5c', '#7a2e5a'];

export function randomColors(skin = '#f2c29b'): Colors {
  return { shirt: pick(SHIRTS), pants: pick(PANTS), skin, shoes: '#3b2a20' };
}

/** Sticker-style outline + a light "cartoon" colour boost. */
export function outlined(img: HTMLCanvasElement, px: number, color = '#2b1b10'): HTMLCanvasElement {
  const out = canvas(img.width + px * 2, img.height + px * 2);
  const o = ctx2d(out);
  const sil = canvas(img.width, img.height);
  const s = ctx2d(sil);
  s.drawImage(img, 0, 0);
  s.globalCompositeOperation = 'source-in';
  s.fillStyle = color;
  s.fillRect(0, 0, sil.width, sil.height);
  const steps = 16;
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    o.drawImage(sil, px + Math.cos(a) * px, px + Math.sin(a) * px);
  }
  o.filter = 'saturate(1.3) contrast(1.08)';
  o.drawImage(img, px, px);
  o.filter = 'none';
  return out;
}

const shift = (p: Pt, d: number): Pt => ({ x: p.x + d, y: p.y + d });

export interface RuntimeChar {
  data: CharacterData;
  head: HeadImg;
  torso?: TorsoImg;
  limbs: Partial<Record<LimbKey, PartImg>>;
}

export function prepare(data: CharacterData): RuntimeChar {
  const hp = Math.max(3, Math.round(data.head.img.width / 45));
  const head: HeadImg = {
    ...data.head,
    img: outlined(data.head.img, hp),
    chin: shift(data.head.chin, hp),
    mouth: shift(data.head.mouth, hp),
  };
  let torso: TorsoImg | undefined;
  const bp = data.torso ? Math.max(3, Math.round(data.torso.len / 35)) : 3;
  if (data.torso) {
    const t = data.torso;
    torso = {
      img: outlined(t.img, bp),
      ax: t.ax + bp,
      ay: t.ay + bp,
      len: t.len,
      neck: shift(t.neck, bp),
      shL: shift(t.shL, bp),
      shR: shift(t.shR, bp),
      hipL: shift(t.hipL, bp),
      hipR: shift(t.hipR, bp),
    };
  }
  const limbs: Partial<Record<LimbKey, PartImg>> = {};
  for (const k of LIMBS) {
    const p = data.limbs[k];
    if (p) limbs[k] = { img: outlined(p.img, bp), ax: p.ax + bp, ay: p.ay + bp, len: p.len };
  }
  return { data, head, torso, limbs };
}

interface Look {
  name: string;
  skin: string;
  hair: string;
  style: 'spiky' | 'bob' | 'bun' | 'curly' | 'cap' | 'pigtails';
  shirt: string;
  pants: string;
}

const LOOKS: Look[] = [
  { name: 'น้องโจ๊ก', skin: '#f6cfa8', hair: '#2b1d14', style: 'spiky', shirt: '#ff5a5f', pants: '#2f4b8a' },
  { name: 'น้องแพรว', skin: '#f2c29b', hair: '#4a2a17', style: 'pigtails', shirt: '#ff7ab6', pants: '#3a3a5a' },
  { name: 'น้องต้น', skin: '#d9a273', hair: '#1a1a1a', style: 'cap', shirt: '#3d7eff', pants: '#6b4f2a' },
  { name: 'น้องมายด์', skin: '#f8d8b8', hair: '#7a4a24', style: 'bob', shirt: '#ffb400', pants: '#1f6f5c' },
  { name: 'น้องบอส', skin: '#c68c5a', hair: '#141414', style: 'curly', shirt: '#00a699', pants: '#3a3a5a' },
  { name: 'น้องฟ้า', skin: '#f3c9a0', hair: '#24160e', style: 'bun', shirt: '#a659ff', pants: '#2f4b8a' },
];

function drawCartoonHead(look: Look): HeadImg {
  const W = 220;
  const H = 240;
  const c = canvas(W, H);
  const g = ctx2d(c);
  const cx = W / 2;
  const cy = 130;
  const r = 78;
  g.lineJoin = 'round';
  const hair = look.hair;
  // back hair
  g.fillStyle = hair;
  if (look.style === 'bob') {
    g.beginPath();
    g.ellipse(cx, cy - 6, r + 14, r + 12, 0, Math.PI, 0);
    g.lineTo(cx + r + 14, cy + 40);
    g.lineTo(cx - r - 14, cy + 40);
    g.fill();
  }
  if (look.style === 'pigtails') {
    for (const s of [-1, 1]) {
      g.beginPath();
      g.ellipse(cx + s * (r + 18), cy + 4, 22, 34, s * 0.4, 0, Math.PI * 2);
      g.fill();
    }
  }
  if (look.style === 'bun') {
    g.beginPath();
    g.arc(cx, cy - r - 12, 28, 0, Math.PI * 2);
    g.fill();
  }
  // ears + face
  g.fillStyle = look.skin;
  for (const s of [-1, 1]) {
    g.beginPath();
    g.arc(cx + s * r * 0.98, cy + 8, 16, 0, Math.PI * 2);
    g.fill();
  }
  g.beginPath();
  g.ellipse(cx, cy, r, r * 1.02, 0, 0, Math.PI * 2);
  g.fill();
  // fringe
  g.fillStyle = hair;
  g.beginPath();
  if (look.style === 'spiky') {
    g.moveTo(cx - r - 4, cy - 4);
    for (let i = 0; i <= 8; i++) {
      const a = Math.PI + (i / 8) * Math.PI;
      const rr = i % 2 ? r + 28 : r + 2;
      g.lineTo(cx + Math.cos(a) * rr, cy - 10 + Math.sin(a) * rr);
    }
    g.lineTo(cx + r + 4, cy - 4);
    g.quadraticCurveTo(cx, cy - r * 0.55, cx - r - 4, cy - 4);
  } else if (look.style === 'curly') {
    for (let i = 0; i <= 9; i++) {
      const a = Math.PI * 1.05 + (i / 9) * Math.PI * 0.9;
      g.moveTo(cx + Math.cos(a) * r + 20, cy - 12 + Math.sin(a) * r);
      g.arc(cx + Math.cos(a) * r, cy - 12 + Math.sin(a) * r, 22, 0, Math.PI * 2);
    }
  } else if (look.style === 'cap') {
    g.fillStyle = look.shirt;
    g.ellipse(cx, cy - 26, r + 6, r * 0.8, 0, Math.PI, 0);
    g.fill();
    g.beginPath();
    g.ellipse(cx + 40, cy - 26, 66, 14, 0, 0, Math.PI * 2);
  } else {
    g.ellipse(cx, cy - 16, r + 6, r * 0.78, 0, Math.PI, 0);
    g.quadraticCurveTo(cx + r * 0.3, cy - r * 0.35, cx - r - 6, cy - 16);
  }
  g.fill();
  // eyes
  for (const s of [-1, 1]) {
    g.fillStyle = '#fff';
    g.beginPath();
    g.ellipse(cx + s * 28, cy + 10, 15, 18, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#1b1b1b';
    g.beginPath();
    g.arc(cx + s * 28 + 3, cy + 13, 8, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(cx + s * 28 + 6, cy + 9, 3, 0, Math.PI * 2);
    g.fill();
  }
  // cheeks
  g.fillStyle = 'rgba(255,110,110,0.35)';
  for (const s of [-1, 1]) {
    g.beginPath();
    g.ellipse(cx + s * 50, cy + 36, 13, 8, 0, 0, Math.PI * 2);
    g.fill();
  }
  // cheeky grin
  const my = cy + 46;
  g.fillStyle = '#7a1f1f';
  g.beginPath();
  g.moveTo(cx - 26, my - 4);
  g.quadraticCurveTo(cx, my + 30, cx + 26, my - 4);
  g.closePath();
  g.fill();
  g.fillStyle = '#fff';
  g.fillRect(cx - 16, my - 3, 32, 6);
  return { img: c, chin: { x: cx, y: cy + r * 1.02 }, mouth: { x: cx, y: my + 6 }, mouthW: 52, faceW: r * 2 };
}

export function builtinCharacters(): CharacterData[] {
  return LOOKS.map((look, i) => ({
    id: 'builtin-' + i,
    name: look.name,
    createdAt: 0,
    builtin: true,
    head: drawCartoonHead(look),
    colors: { shirt: look.shirt, pants: look.pants, skin: look.skin, shoes: shade(look.pants, 0.5) },
    limbs: {},
  }));
}

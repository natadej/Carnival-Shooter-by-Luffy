import type { RuntimeChar } from './character';
import { animate, drawPuppet, hitTest, MOVE_ANIMS, STOP_ANIMS, type AnimName, type Capsule } from './puppet';
import { canShoot, fire, land, newRound, outcome, speedFor, HITS_TO_WIN, SHOTS_PER_ROUND, type Outcome, type RoundState } from './logic';
import { say, sfx } from './audio';
import { canvas, clamp, pick, rand, type Pt } from './util';

export const TAUNTS = [
  'แบร่~ ยิงไม่โดนหรอก!',
  'อยู่นี่จ้า~',
  'ช้าไปนะจ๊ะ!',
  'ฝีมือแค่นี้เหรอ?',
  'จับฉันให้ได้สิ~',
  'ลาลาล๊า~',
  'บู้ววว~',
  'แหยะๆๆ',
  'มาเลย มาเลย!',
  'เล็งตรงนี้สิ!',
  'ก้นฉันสวยมั้ย?',
  'ยิงโดนเลี้ยงไอติม!',
  'แม่นแค่ไหนเชียว~',
];
const MISS = ['ฮ่าๆๆ พลาด!', 'วืดดด~', 'โดนแต่อากาศ!', 'เล็งดีๆ สิ!', 'ขำกลิ้ง!', 'ไม่โดนนน~'];
const OUCH = ['โอ๊ยยย!', 'เจ็บนะ!', 'ไม่ยุติธรรม!', 'โดนจนได้!', 'แงงง~', 'จำไว้เลย!'];

type Mode = 'move' | 'down' | 'rise' | 'peekUp' | 'peekHold' | 'peekDown';

interface Row {
  y: number;
  scale: number;
  dir: number;
  speed: number;
  belt: number;
}

interface Target {
  row: Row | null;
  ch: RuntimeChar;
  x: number;
  mode: Mode;
  modeT: number;
  anim: AnimName;
  animT: number;
  nextAnim: number;
  phase: number;
  caps: Capsule[];
  bubble: { text: string; t: number } | null;
  peekY: number;
}

interface Cork {
  from: Pt;
  to: Pt;
  t: number;
  dur: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
  star?: boolean;
}

interface Floater {
  x: number;
  y: number;
  text: string;
  t: number;
  color: string;
  size: number;
}

export interface RoundResult {
  outcome: Exclude<Outcome, 'playing'>;
  hits: number;
  heads: number;
  level: number;
}

export interface GameOptions {
  attract?: boolean;
  level?: number;
  slack?: number;
  onRoundEnd?: (r: RoundResult) => void;
}

const FONT = '"Mitr", "Kanit", system-ui, sans-serif';

export class Game {
  readonly el: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private W = 0;
  private H = 0;
  private U = 30;
  private dpr = 1;
  private bg: HTMLCanvasElement | null = null;
  private rows: Row[] = [];
  private lastW = 0;
  private targets: Target[] = [];
  private peekers: Target[] = [];
  private queue: RuntimeChar[] = [];
  private corks: Cork[] = [];
  private parts: Particle[] = [];
  private floaters: Floater[] = [];
  private raf = 0;
  private last = 0;
  private time = 0;
  private recoil = 0;
  private nextPeek = 4;
  private ended = false;
  private introT = 0;
  round: RoundState;
  aim: Pt = { x: 0, y: 0 };
  showAim = true;
  eyeAim = false;
  winkHint = '';

  constructor(
    private chars: RuntimeChar[],
    private opts: GameOptions = {},
  ) {
    this.el = document.createElement('canvas');
    this.el.className = 'game-canvas';
    const g = this.el.getContext('2d');
    if (!g) throw new Error('no canvas');
    this.g = g;
    this.round = newRound(opts.level ?? 1);
    this.el.addEventListener('pointermove', (e) => {
      if (!this.eyeAim) this.aim = this.local(e);
    });
    this.el.addEventListener('pointerdown', (e) => {
      if (this.opts.attract) return;
      const p = this.local(e);
      if (!this.eyeAim) this.aim = p;
      this.shoot(this.eyeAim ? this.aim : p);
    });
  }

  private local(e: PointerEvent): Pt {
    const r = this.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  /** Converts a viewport point (e.g. eye cursor) to canvas space. */
  fromViewport(p: Pt): Pt {
    const r = this.el.getBoundingClientRect();
    return { x: p.x - r.left, y: p.y - r.top };
  }

  mount(parent: HTMLElement) {
    parent.appendChild(this.el);
    this.resize();
    this.populate();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.el.remove();
  }

  resize() {
    const r = this.el.getBoundingClientRect();
    this.W = Math.max(200, r.width);
    this.H = Math.max(200, r.height);
    this.dpr = Math.min(2, devicePixelRatio || 1);
    this.el.width = Math.round(this.W * this.dpr);
    this.el.height = Math.round(this.H * this.dpr);
    this.U = clamp(Math.min(this.H * 0.062, this.W * 0.045), 14, 60);
    const top = this.H * 0.2;
    const span = this.counterTop() - top;
    const prev = this.rows;
    const oldW = prev.length ? this.lastW : this.W;
    this.rows = [0.78, 0.89, 1].map((scale, i) => {
      const y = top + span * [0.36, 0.67, 0.97][i];
      const r = prev[i];
      // keep row objects stable: targets hold references to their row
      if (r) return Object.assign(r, { y, scale });
      return { y, scale, dir: i % 2 ? -1 : 1, speed: 0, belt: 0 };
    });
    if (oldW !== this.W) for (const t of this.targets) t.x *= this.W / oldW;
    this.lastW = this.W;
    this.setSpeeds();
    this.bg = this.paintBackground();
    if (!this.aim.x) this.aim = { x: this.W / 2, y: this.H / 2 };
  }

  private setSpeeds() {
    const sp = speedFor(this.round.level) * (this.opts.attract ? 0.7 : 1);
    const f = [1.25, 1, 0.82];
    this.rows.forEach((r, i) => (r.speed = this.W * 0.06 * sp * f[i]));
  }

  private counterTop() {
    return this.H * (this.opts.attract ? 0.93 : 0.84);
  }

  private nextChar(): RuntimeChar {
    if (!this.queue.length) this.queue = [...this.chars].sort(() => Math.random() - 0.5);
    return this.queue.pop()!;
  }

  private spacing(row: Row) {
    return this.U * row.scale * 3.4;
  }

  private populate() {
    this.targets = [];
    const n = this.chars.length;
    this.rows.forEach((row, ri) => {
      const sp = this.spacing(row);
      const span = this.W + sp * 2;
      const count = Math.max(2, Math.min(Math.floor(span / sp), Math.ceil(n / 3) + 2));
      const step = span / count;
      for (let i = 0; i < count; i++) this.targets.push(this.makeTarget(row, -sp + i * step + ri * step * 0.33));
    });
  }

  private makeTarget(row: Row | null, x: number): Target {
    const anim = pick(row ? MOVE_ANIMS : STOP_ANIMS);
    return {
      row,
      ch: this.nextChar(),
      x,
      mode: row ? 'move' : 'peekUp',
      modeT: 0,
      anim,
      animT: 0,
      nextAnim: rand(2, 5),
      phase: Math.random() * 10,
      caps: [],
      bubble: null,
      peekY: 1,
    };
  }

  setLevel(level: number) {
    this.round = newRound(level);
    this.ended = false;
    this.introT = 0;
    this.corks = [];
    this.setSpeeds();
    if (Math.random() < 0.5) this.rows.forEach((r) => (r.dir *= -1));
  }

  shoot(at: Pt) {
    if (this.opts.attract || this.ended || this.introT < 1.1 || !canShoot(this.round)) return;
    this.round = fire(this.round);
    const from = this.muzzle();
    const d = Math.hypot(at.x - from.x, at.y - from.y);
    this.corks.push({ from, to: { ...at }, t: 0, dur: clamp(d / (this.H * 3.2), 0.1, 0.22) });
    this.recoil = 1;
    sfx.pop();
  }

  private gunBase(): Pt {
    return { x: this.W / 2, y: this.H + this.U * 0.6 };
  }

  private gunAngle() {
    const b = this.gunBase();
    return Math.atan2(this.aim.y - b.y, this.aim.x - b.x);
  }

  private muzzle(): Pt {
    const b = this.gunBase();
    const a = this.gunAngle();
    const L = this.U * 5.2;
    return { x: b.x + Math.cos(a) * L, y: b.y + Math.sin(a) * L };
  }

  private resolve(c: Cork) {
    const p = c.to;
    const slack = this.opts.slack ?? 6;
    const order = [...this.peekers, ...[...this.targets].sort((a, b) => (b.row?.scale ?? 0) - (a.row?.scale ?? 0))];
    for (const t of order) {
      if (t.mode !== 'move' && t.mode !== 'peekHold' && t.mode !== 'peekUp') continue;
      if (!t.row && p.y > this.counterTop()) continue;
      const r = hitTest(t.caps, p, slack);
      if (r.hit) {
        this.round = land(this.round, true, r.head);
        t.mode = 'down';
        t.modeT = 0;
        t.bubble = null;
        this.burst(p.x, p.y, r.head);
        this.floaters.push({ x: p.x, y: p.y - 10, text: r.head ? 'เฮดช็อต!!' : 'โป๊ก!', t: 0, color: r.head ? '#ffd23f' : '#fff', size: r.head ? 1.3 : 1 });
        if (r.head) sfx.head();
        sfx.hit();
        return;
      }
    }
    this.round = land(this.round, false);
    sfx.miss();
    for (let i = 0; i < 10; i++)
      this.parts.push({ x: p.x, y: p.y, vx: rand(-60, 60), vy: rand(-80, 10), life: 0, max: rand(0.3, 0.6), color: '#c9b79c', size: rand(2, 5) });
    this.floaters.push({ x: p.x, y: p.y, text: 'วืด!', t: 0, color: '#fff', size: 0.8 });
    const near = this.targets
      .filter((t) => t.mode === 'move')
      .sort((a, b) => Math.abs(a.x - p.x) - Math.abs(b.x - p.x))
      .slice(0, 3);
    near.forEach((t, i) => {
      t.anim = 'laugh';
      t.animT = 0;
      t.nextAnim = 1.6;
      if (i === 0) {
        const text = pick(MISS);
        t.bubble = { text, t: 0 };
        say(text);
      }
    });
    sfx.laugh();
  }

  private burst(x: number, y: number, big: boolean) {
    const colors = ['#ffd23f', '#ff5a5f', '#3d7eff', '#00d1b2', '#fff'];
    for (let i = 0; i < (big ? 30 : 18); i++) {
      const a = Math.random() * Math.PI * 2;
      const s = rand(80, big ? 320 : 220);
      this.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60, life: 0, max: rand(0.4, 0.9), color: pick(colors), size: rand(4, 9), star: true });
    }
  }

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.update(dt);
    this.draw();
  };

  private update(dt: number) {
    this.time += dt;
    this.introT += dt;
    this.recoil = Math.max(0, this.recoil - dt * 6);
    for (const r of this.rows) r.belt = (r.belt + r.dir * r.speed * dt) % 40;
    const lvl = this.round.level;
    for (const t of this.targets) {
      const row = t.row!;
      t.modeT += dt;
      t.animT += dt;
      if (t.bubble && (t.bubble.t += dt) > 2.2) t.bubble = null;
      if (t.mode === 'move' || t.mode === 'rise') {
        t.x += row.dir * row.speed * dt;
        const sp = this.spacing(row);
        if (row.dir > 0 && t.x > this.W + sp) this.wrap(t, t.x - this.W - sp * 2);
        if (row.dir < 0 && t.x < -sp) this.wrap(t, t.x + this.W + sp * 2);
      }
      if (t.mode === 'down' && t.modeT > 1.6) {
        t.mode = 'rise';
        t.modeT = 0;
        t.anim = 'hurt';
        t.animT = 0;
        t.nextAnim = 1.2;
        t.bubble = { text: pick(OUCH), t: 0 };
      }
      if (t.mode === 'rise' && t.modeT > 0.4) t.mode = 'move';
      if (t.mode === 'move' && (t.nextAnim -= dt) <= 0) {
        const stop = Math.random() < 0.55;
        t.anim = pick(stop ? STOP_ANIMS : MOVE_ANIMS);
        t.animT = 0;
        t.nextAnim = rand(2.2, 4.5);
        const talking = this.targets.filter((o) => o.bubble).length;
        if ((t.anim === 'taunt' || t.anim === 'hips' || t.anim === 'wave' || Math.random() < 0.25) && talking < 3 && t.x > 0 && t.x < this.W) {
          const text = Math.random() < 0.25 ? `${t.ch.data.name} หลบเก่งนะจะบอกให้!` : pick(TAUNTS);
          t.bubble = { text, t: 0 };
          if (!this.opts.attract && Math.random() < 0.35) say(text);
        }
      }
    }
    // pop-up peekers from behind the counter
    if (!this.opts.attract && lvl >= 2) {
      this.nextPeek -= dt;
      if (this.nextPeek <= 0 && this.peekers.length < Math.min(3, lvl - 1)) {
        const p = this.makeTarget(null, rand(this.W * 0.12, this.W * 0.88));
        p.bubble = { text: pick(TAUNTS), t: 0 };
        this.peekers.push(p);
        this.nextPeek = rand(3, 7) / Math.sqrt(lvl);
      }
    }
    for (const p of this.peekers) {
      p.modeT += dt;
      p.animT += dt;
      if (p.bubble && (p.bubble.t += dt) > 2) p.bubble = null;
      if (p.mode === 'peekUp') {
        p.peekY = Math.max(0, 1 - p.modeT / 0.3);
        if (p.modeT > 0.3) ((p.mode = 'peekHold'), (p.modeT = 0));
      } else if (p.mode === 'peekHold' && p.modeT > Math.max(1, 2.4 - lvl * 0.15)) {
        p.mode = 'peekDown';
        p.modeT = 0;
      } else if (p.mode === 'peekDown') p.peekY = Math.min(1, p.modeT / 0.25);
      else if (p.mode === 'down') p.peekY = Math.min(1, p.modeT / 0.5);
    }
    this.peekers = this.peekers.filter((p) => !((p.mode === 'peekDown' && p.modeT > 0.25) || (p.mode === 'down' && p.modeT > 0.6)));

    for (const c of this.corks) c.t += dt;
    for (const c of this.corks.filter((c) => c.t >= c.dur)) this.resolve(c);
    this.corks = this.corks.filter((c) => c.t < c.dur);
    for (const p of this.parts) {
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 500 * dt;
    }
    this.parts = this.parts.filter((p) => p.life < p.max);
    for (const f of this.floaters) f.t += dt;
    this.floaters = this.floaters.filter((f) => f.t < 1.1);

    if (!this.opts.attract && !this.ended) {
      const o = outcome(this.round);
      if (o !== 'playing') {
        this.ended = true;
        const r = this.round;
        setTimeout(() => this.opts.onRoundEnd?.({ outcome: o, hits: r.hits, heads: r.heads, level: r.level }), 900);
      }
    }
  }

  private wrap(t: Target, x: number) {
    t.x = x;
    t.ch = this.nextChar();
    t.mode = 'move';
    t.bubble = null;
  }

  // ---------- drawing ----------

  private paintBackground(): HTMLCanvasElement {
    const c = canvas(this.W * this.dpr, this.H * this.dpr);
    const g = c.getContext('2d')!;
    g.scale(this.dpr, this.dpr);
    const { W, H } = this;
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#2a1458');
    sky.addColorStop(1, '#5b2a86');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
    // back wall planks
    const wallTop = H * 0.13;
    for (let x = 0, i = 0; x < W; x += 46, i++) {
      g.fillStyle = i % 2 ? '#1f6f5c' : '#23806a';
      g.fillRect(x, wallTop, 46, H);
    }
    g.fillStyle = 'rgba(0,0,0,0.18)';
    for (let x = 0; x < W; x += 46) g.fillRect(x, wallTop, 3, H);
    // painted stars / bullseyes on the wall
    for (let i = 0; i < 14; i++) {
      const x = ((i * 137) % 100) / 100 * W;
      const y = wallTop + (((i * 71) % 100) / 100) * (H * 0.6);
      g.globalAlpha = 0.12;
      g.fillStyle = '#fff';
      g.beginPath();
      for (let k = 0; k < 10; k++) {
        const r = k % 2 ? 9 : 22;
        const a = (k / 10) * Math.PI * 2 - Math.PI / 2;
        g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      }
      g.fill();
      g.globalAlpha = 1;
    }
    // awning
    const aw = H * 0.11;
    const stripe = Math.max(36, W / 16);
    for (let x = 0, i = 0; x < W + stripe; x += stripe, i++) {
      g.fillStyle = i % 2 ? '#fff4e0' : '#e63946';
      g.fillRect(x, 0, stripe, aw);
      g.beginPath();
      g.arc(x + stripe / 2, aw, stripe / 2, 0, Math.PI);
      g.fill();
    }
    g.fillStyle = 'rgba(0,0,0,0.15)';
    g.fillRect(0, aw - 6, W, 6);
    // side posts
    for (const x of [0, W - H * 0.03]) {
      g.fillStyle = '#8a4b22';
      g.fillRect(x, aw, H * 0.03, H);
    }
    // sign
    if (!this.opts.attract) {
      g.font = `bold ${Math.round(H * 0.045)}px ${FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = '#ffd23f';
      g.strokeStyle = '#5a1d00';
      g.lineWidth = 5;
      g.strokeText('ยิงเป้าแก๊งเพื่อน', W / 2, aw * 0.5);
      g.fillText('ยิงเป้าแก๊งเพื่อน', W / 2, aw * 0.5);
    }
    return c;
  }

  private drawRowShelf(row: Row) {
    const g = this.g;
    const h = this.U * 0.45 * row.scale;
    g.fillStyle = '#7a4a24';
    g.fillRect(0, row.y, this.W, h);
    g.fillStyle = '#9c6332';
    g.fillRect(0, row.y, this.W, h * 0.35);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    for (let x = (row.belt % 40) - 40; x < this.W; x += 40) g.fillRect(x, row.y + h * 0.45, 14, h * 0.4);
  }

  private drawTarget(t: Target, baseY: number, scale: number) {
    const g = this.g;
    const k = this.U * scale;
    t.caps = [];
    g.save();
    g.translate(t.x, baseY);
    // carnival stick + base
    g.fillStyle = '#5a3a1a';
    g.fillRect(-k * 0.06, -k * 0.1, k * 0.12, k * 0.2);
    g.fillStyle = '#ffd23f';
    g.beginPath();
    g.ellipse(0, 0, k * 0.55, k * 0.12, 0, 0, Math.PI * 2);
    g.fill();
    if (t.mode === 'down') {
      const f = Math.min(1, t.modeT / 0.3);
      g.scale(1, Math.max(0.08, Math.cos(f * 1.45)));
    } else if (t.mode === 'rise') {
      g.scale(1, Math.max(0.08, Math.sin((t.modeT / 0.4) * Math.PI / 2)));
    }
    g.scale(k, k);
    const pose = animate(t.mode === 'down' ? 'hurt' : t.anim, t.animT + t.phase);
    const dir = t.row?.dir ?? 1;
    if (t.anim === 'run' || t.anim === 'chicken') pose.flip = dir < 0;
    if (t.anim === 'moonwalk') pose.flip = dir > 0;
    drawPuppet(g, t.ch, pose, t.mode === 'down' ? undefined : t.caps);
    // caps come out in backing-store pixels; game logic works in CSS pixels
    const d = this.dpr;
    for (const c of t.caps) {
      c.a = { x: c.a.x / d, y: c.a.y / d };
      c.b = { x: c.b.x / d, y: c.b.y / d };
      c.r /= d;
    }
    g.restore();
    if (t.mode === 'down' && t.modeT < 1.6) this.drawDizzy(t.x, baseY - k * 1.2, k);
  }

  private drawDizzy(x: number, y: number, k: number) {
    const g = this.g;
    for (let i = 0; i < 3; i++) {
      const a = this.time * 5 + (i * Math.PI * 2) / 3;
      this.star(x + Math.cos(a) * k * 0.7, y + Math.sin(a) * k * 0.2, k * 0.16, '#ffd23f');
    }
    g.globalAlpha = 1;
  }

  private star(x: number, y: number, r: number, color: string) {
    const g = this.g;
    g.fillStyle = color;
    g.strokeStyle = '#5a3a00';
    g.lineWidth = Math.max(1, r * 0.15);
    g.beginPath();
    for (let k = 0; k < 10; k++) {
      const rr = k % 2 ? r * 0.45 : r;
      const a = (k / 10) * Math.PI * 2 - Math.PI / 2;
      g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    g.closePath();
    g.fill();
    g.stroke();
  }

  private bubble(x: number, y: number, text: string, t: number) {
    const g = this.g;
    const s = Math.min(1, t * 6);
    const fs = Math.round(clamp(this.U * 0.5, 12, 22));
    g.font = `600 ${fs}px ${FONT}`;
    const w = g.measureText(text).width + fs;
    const h = fs * 1.7;
    const bx = clamp(x - w / 2, 4, this.W - w - 4);
    const by = Math.max(4, y - h - fs * 0.6);
    g.save();
    g.translate(x, by + h);
    g.scale(s, s);
    g.translate(-x, -(by + h));
    g.fillStyle = '#fff';
    g.strokeStyle = '#2b1b10';
    g.lineWidth = 2.5;
    g.beginPath();
    g.roundRect(bx, by, w, h, h / 2);
    g.moveTo(x - 6, by + h - 1);
    g.lineTo(x, by + h + fs * 0.55);
    g.lineTo(x + 7, by + h - 1);
    g.fill();
    g.stroke();
    g.fillStyle = '#2b1b10';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, bx + w / 2, by + h / 2 + 1);
    g.restore();
  }

  private headTop(t: Target): Pt | null {
    const h = t.caps.find((c) => c.head);
    return h ? { x: h.a.x, y: h.a.y - h.r } : null;
  }

  private drawCounter() {
    const g = this.g;
    const y = this.counterTop();
    const grd = g.createLinearGradient(0, y, 0, this.H);
    grd.addColorStop(0, '#b5722f');
    grd.addColorStop(1, '#6b3d17');
    g.fillStyle = grd;
    g.fillRect(0, y, this.W, this.H - y);
    g.fillStyle = '#d9934a';
    g.fillRect(0, y, this.W, this.U * 0.35);
    g.fillStyle = 'rgba(0,0,0,0.15)';
    for (let x = 0; x < this.W; x += 90) g.fillRect(x, y + this.U * 0.35, 4, this.H);
  }

  private drawLights() {
    const g = this.g;
    const aw = this.H * 0.11;
    const n = Math.ceil(this.W / 34);
    for (let i = 0; i <= n; i++) {
      const on = (Math.floor(this.time * 3) + i) % 3 !== 0;
      g.fillStyle = on ? '#fff59d' : '#9e8f4a';
      if (on) {
        g.shadowColor = '#ffeb3b';
        g.shadowBlur = 10;
      }
      g.beginPath();
      g.arc(i * 34 + 10, aw + this.U * 0.55, 4.5, 0, Math.PI * 2);
      g.fill();
      g.shadowBlur = 0;
    }
  }

  private drawGun() {
    const g = this.g;
    const b = this.gunBase();
    const a = this.gunAngle();
    const U = this.U;
    g.save();
    g.translate(b.x, b.y);
    g.rotate(a);
    g.translate(-this.recoil * U * 0.6, 0);
    // stock
    g.fillStyle = '#8a4b22';
    g.strokeStyle = '#2b1b10';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(-U * 1.2, -U * 0.55);
    g.lineTo(U * 2.4, -U * 0.32);
    g.lineTo(U * 2.4, U * 0.32);
    g.lineTo(-U * 1.2, U * 0.75);
    g.closePath();
    g.fill();
    g.stroke();
    // barrel
    g.fillStyle = '#6d7b8a';
    g.beginPath();
    g.roundRect(U * 1.6, -U * 0.2, U * 3.6, U * 0.4, U * 0.1);
    g.fill();
    g.stroke();
    g.fillStyle = '#d9a35b';
    g.beginPath();
    g.roundRect(U * 5.0, -U * 0.24, U * 0.3, U * 0.48, U * 0.08);
    g.fill();
    g.stroke();
    g.restore();
    if (this.recoil > 0.6) {
      const m = this.muzzle();
      g.fillStyle = 'rgba(255,255,255,0.8)';
      g.beginPath();
      g.arc(m.x, m.y, U * 0.5 * this.recoil, 0, Math.PI * 2);
      g.fill();
    }
  }

  private drawCorks() {
    const g = this.g;
    for (const c of this.corks) {
      const f = c.t / c.dur;
      const x = c.from.x + (c.to.x - c.from.x) * f;
      const y = c.from.y + (c.to.y - c.from.y) * f - Math.sin(f * Math.PI) * this.U * 0.5;
      const r = this.U * (0.32 - 0.2 * f);
      g.fillStyle = '#d9a35b';
      g.strokeStyle = '#5a3a1a';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
  }

  private drawAim() {
    const g = this.g;
    const { x, y } = this.aim;
    const r = this.U * 0.7;
    g.save();
    g.strokeStyle = this.eyeAim ? '#00e5ff' : '#ff3b3b';
    g.lineWidth = 3;
    g.shadowColor = 'rgba(0,0,0,0.6)';
    g.shadowBlur = 4;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.moveTo(x - r * 1.5, y);
    g.lineTo(x - r * 0.4, y);
    g.moveTo(x + r * 0.4, y);
    g.lineTo(x + r * 1.5, y);
    g.moveTo(x, y - r * 1.5);
    g.lineTo(x, y - r * 0.4);
    g.moveTo(x, y + r * 0.4);
    g.lineTo(x, y + r * 1.5);
    g.stroke();
    g.fillStyle = g.strokeStyle;
    g.beginPath();
    g.arc(x, y, 3, 0, Math.PI * 2);
    g.fill();
    if (this.eyeAim) {
      // little eye icon so players know the reticle follows their gaze
      g.fillStyle = '#fff';
      g.beginPath();
      g.ellipse(x + r * 1.3, y - r * 1.3, r * 0.45, r * 0.28, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#00838f';
      g.beginPath();
      g.arc(x + r * 1.3, y - r * 1.3, r * 0.18, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }

  private drawHud() {
    const g = this.g;
    const U = this.U;
    const r = this.round;
    const pad = 10;
    const y = this.H * 0.11 + U * 1.3;
    g.save();
    // corks left
    const cs = clamp(U * 0.42, 9, 18);
    const totalW = SHOTS_PER_ROUND * cs * 2.6;
    let x = pad + cs * 1.4;
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.beginPath();
    g.roundRect(pad, y - cs * 1.4, totalW + cs, cs * 2.8, cs * 1.4);
    g.fill();
    for (let i = 0; i < SHOTS_PER_ROUND; i++) {
      g.globalAlpha = i < r.shotsLeft ? 1 : 0.25;
      g.fillStyle = '#d9a35b';
      g.strokeStyle = '#5a3a1a';
      g.lineWidth = 2;
      g.beginPath();
      g.roundRect(x - cs * 0.7, y - cs, cs * 1.4, cs * 2, cs * 0.4);
      g.fill();
      g.stroke();
      x += cs * 2.6;
    }
    g.globalAlpha = 1;
    // hits vs goal
    const hx = this.W - pad - cs * 1.4;
    const n = Math.max(HITS_TO_WIN, r.hits);
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.beginPath();
    g.roundRect(hx - (n - 1) * cs * 2.6 - cs * 1.4, y - cs * 1.4, (n - 1) * cs * 2.6 + cs * 2.8, cs * 2.8, cs * 1.4);
    g.fill();
    for (let i = 0; i < n; i++) {
      const sx = hx - (n - 1 - i) * cs * 2.6;
      if (i < r.hits) this.star(sx, y, cs * 1.1, i < HITS_TO_WIN ? '#ffd23f' : '#ff7ab6');
      else {
        g.strokeStyle = '#fff';
        g.setLineDash([4, 3]);
        g.lineWidth = 2;
        g.beginPath();
        g.arc(sx, y, cs * 0.9, 0, Math.PI * 2);
        g.stroke();
        g.setLineDash([]);
      }
    }
    g.font = `600 ${Math.round(cs * 1.1)}px ${FONT}`;
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.fillText(`รอบ ${r.level}`, this.W / 2, y + cs * 0.4);
    // intro banner
    if (this.introT < 1.8) {
      const a = this.introT < 1.4 ? 1 : 1 - (this.introT - 1.4) / 0.4;
      g.globalAlpha = a;
      const fs = Math.round(clamp(U * 0.9, 18, 44));
      g.font = `700 ${fs}px ${FONT}`;
      g.lineWidth = 6;
      g.strokeStyle = '#5a1d00';
      g.fillStyle = '#ffd23f';
      const t1 = `รอบที่ ${r.level}`;
      const t2 = `ยิงให้โดน ${HITS_TO_WIN} ใน ${SHOTS_PER_ROUND} นัด!`;
      g.strokeText(t1, this.W / 2, this.H * 0.42);
      g.fillText(t1, this.W / 2, this.H * 0.42);
      g.font = `600 ${Math.round(fs * 0.6)}px ${FONT}`;
      g.strokeText(t2, this.W / 2, this.H * 0.42 + fs);
      g.fillStyle = '#fff';
      g.fillText(t2, this.W / 2, this.H * 0.42 + fs);
      if (this.winkHint) {
        g.strokeText(this.winkHint, this.W / 2, this.H * 0.42 + fs * 1.8);
        g.fillText(this.winkHint, this.W / 2, this.H * 0.42 + fs * 1.8);
      }
      g.globalAlpha = 1;
    }
    g.restore();
  }

  private draw() {
    const g = this.g;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (this.bg) g.drawImage(this.bg, 0, 0, this.W, this.H);
    this.drawLights();
    this.rows.forEach((row) => {
      this.drawRowShelf(row);
      for (const t of this.targets) if (t.row === row) this.drawTarget(t, row.y, row.scale);
    });
    const ct = this.counterTop();
    const pk = this.U * 3.4;
    for (const p of this.peekers) this.drawTarget(p, ct + p.peekY * pk + this.U * 0.3, 1.05);
    this.drawCounter();
    for (const t of [...this.targets, ...this.peekers]) {
      if (!t.bubble) continue;
      const top = this.headTop(t);
      if (top && top.y < ct) this.bubble(top.x, top.y, t.bubble.text, t.bubble.t);
    }
    if (!this.opts.attract) {
      this.drawGun();
      this.drawCorks();
    }
    for (const p of this.parts) {
      g.globalAlpha = 1 - p.life / p.max;
      if (p.star) this.star(p.x, p.y, p.size, p.color);
      else {
        g.fillStyle = p.color;
        g.beginPath();
        g.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.globalAlpha = 1;
    for (const f of this.floaters) {
      const fs = Math.round(clamp(this.U * 0.8, 16, 40) * f.size * (1 + f.t * 0.3));
      g.globalAlpha = 1 - f.t / 1.1;
      g.font = `700 ${fs}px ${FONT}`;
      g.textAlign = 'center';
      g.lineWidth = 5;
      g.strokeStyle = '#2b1b10';
      g.fillStyle = f.color;
      g.strokeText(f.text, f.x, f.y - f.t * 50);
      g.fillText(f.text, f.x, f.y - f.t * 50);
    }
    g.globalAlpha = 1;
    if (!this.opts.attract) {
      if (this.showAim) this.drawAim();
      this.drawHud();
    }
  }
}

import '@fontsource/mitr/400.css';
import '@fontsource/mitr/600.css';
import '@fontsource/mitr/700.css';
import './style.css';
import './cartoon.css';
import { cartoonArt, inComparison, previewScene } from './art';
import { builtinCharacters, prepare, type CharacterData, type RuntimeChar } from './character';
import { buildCharacter, detectFriends, loadImageFile, manualGeom } from './cutout';
import { deleteFriend, loadFriends, renameFriend, saveFriend } from './store';
import { Game, type RoundResult } from './game';
import { animate, drawPuppet, STOP_ANIMS } from './puppet';
import { EyeTracker, saveCalibration, type EyeSide } from './eyes';
import { runCalibration } from './calibrate';
import { setMusic, setSound, setVoice, sfx, startMusic, stopMusic } from './audio';
import { pick } from './util';
import { TiltAim } from './tilt';
import { activeGroup, addGroup, forgetFriend, inPlay, parseGroups, removeGroup, renameGroup, setMember, type GroupState } from './groups';
import { isGlobal, rankOf, submitScore, topScores, cleanName, type ScoreEntry } from './leaderboard';

interface Settings {
  control: 'touch' | 'eye' | 'tilt';
  eye: EyeSide;
  smooth: number;
  tiltRange: number;
  player: string;
  sound: boolean;
  music: boolean;
  voice: boolean;
}

const SKEY = 'cs.settings.v1';
document.body.classList.toggle('cartoon', cartoonArt);
const PKEY = 'cs.prizes.v1';
const BKEY = 'cs.best.v1';
let best: { score: number; level: number } = JSON.parse(localStorage.getItem(BKEY) || '{"score":0,"level":0}');
const settings: Settings = { control: 'touch', eye: 'right', smooth: 0.6, tiltRange: 18, player: '', sound: true, music: true, voice: true, ...JSON.parse(localStorage.getItem(SKEY) || '{}') };
// Embedded art comparisons must not request a camera or play two soundtracks.
if (inComparison) Object.assign(settings, { control: 'touch', sound: false, music: false, voice: false });
const saveSettings = () => {
  localStorage.setItem(SKEY, JSON.stringify(settings));
  applySettings();
};
const prizes: string[] = JSON.parse(localStorage.getItem(PKEY) || '[]');
const PRIZES = ['🧸', '🎈', '🍭', '🦄', '🐻', '🍦', '🎁', '🐶', '🐱', '🪀', '🚀', '🦖'];
const BIG_PRIZES = ['🏆', '👑', '🐉', '🎠'];

const tracker = new EyeTracker();
const tilt = new TiltAim();
function applySettings() {
  setSound(settings.sound);
  setMusic(settings.music);
  setVoice(settings.voice);
  tracker.eye = settings.eye;
  tracker.setSmoothing(settings.smooth);
  tilt.range = settings.tiltRange;
}
applySettings();

let friends: CharacterData[] = [];
const GKEY = 'cs.groups.v1';
let groups: GroupState = parseGroups(localStorage.getItem(GKEY));
const saveGroups = (s: GroupState) => {
  groups = s;
  localStorage.setItem(GKEY, JSON.stringify(s));
};
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
let runtime = new Map<string, RuntimeChar>();
const builtins = builtinCharacters().map(prepare);

function rt(c: CharacterData): RuntimeChar {
  let r = runtime.get(c.id);
  if (!r) {
    r = prepare(c);
    runtime.set(c.id, r);
  }
  return r;
}

function cast(): RuntimeChar[] {
  const mine = inPlay(groups, friends).map(rt);
  if (mine.length >= 4) return mine;
  return [...mine, ...builtins.slice(0, 6 - mine.length)];
}

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <div id="stage"></div>
  <div id="screen"></div>`;
const stage = app.querySelector<HTMLDivElement>('#stage')!;
const screen = app.querySelector<HTMLDivElement>('#screen')!;
let game: Game | null = null;
let cleanupScreen: (() => void) | null = null;

function setGame(g: Game | null) {
  game?.destroy();
  game = g;
  if (g) g.mount(stage);
}

addEventListener('resize', () => game?.resize());

function show(html: string, cls: string) {
  cleanupScreen?.();
  cleanupScreen = null;
  screen.className = cls;
  screen.innerHTML = html;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const CONTROL_LABEL = { touch: 'แตะจอ 👆', eye: 'ยิงด้วยตา 👁️', tilt: 'เอียงเครื่อง 📱' } as const;

// ---------------- home ----------------
function home() {
  stopEyes();
  setGame(new Game(cast(), { attract: true }));
  const n = inPlay(groups, friends).length;
  const groupPick = groups.groups.length
    ? `<label class="group-pick">เล่นกับ <select id="group">
        <option value="">ทุกคน (${friends.length})</option>
        ${groups.groups.map((g) => `<option value="${g.id}" ${g.id === groups.active ? 'selected' : ''}>${esc(g.name)} (${inPlay({ ...groups, active: g.id }, friends).length})</option>`).join('')}
      </select></label>`
    : '';
  show(
    `<div class="panel home">
      <h1>ยิงเป้า<span>แก๊งเพื่อน</span></h1>
      <p class="sub">ยิงจุกก๊อก 5 นัด โดน 3 นัดไปต่อ · ยิ่งผ่านยิ่งเร็ว!</p>
      ${best.score ? `<p class="best">สถิติของคุณ <b>${best.score.toLocaleString()}</b> แต้ม · รอบ ${best.level}</p>` : ''}
      ${groupPick}
      <button class="btn primary big" id="play">เริ่มยิง! 🎯</button>
      <button class="btn" id="board">อันดับ${isGlobal ? 'โลก 🌏' : ' 🏆'}</button>
      <button class="btn" id="friends">แก๊งเพื่อน (${n}) 📸</button>
      <button class="btn" id="settings">ตั้งค่า ⚙️ · ${CONTROL_LABEL[settings.control]}</button>
      ${prizes.length ? `<div class="shelf" title="รางวัลที่ได้">${prizes.slice(-24).join('')}</div>` : ''}
      ${n === 0 ? '<p class="hint">ยังไม่มีรูปเพื่อน กด "แก๊งเพื่อน" เพื่ออัพโหลดรูปได้เลย</p>' : ''}
    </div>`,
    'screen home-screen',
  );
  screen.querySelector('#play')!.addEventListener('click', () => (sfx.click(), play(1)));
  screen.querySelector('#friends')!.addEventListener('click', () => (sfx.click(), friendsScreen()));
  screen.querySelector('#board')!.addEventListener('click', () => (sfx.click(), boardDialog()));
  screen.querySelector<HTMLSelectElement>('#group')?.addEventListener('change', (e) => {
    saveGroups({ ...groups, active: (e.target as HTMLSelectElement).value || null });
    home();
  });
  screen.querySelector('#settings')!.addEventListener('click', () => (sfx.click(), settingsDialog(home)));
  if (cartoonArt) {
    const hero = document.createElement('div');
    hero.className = 'hero-sticker';
    hero.setAttribute('aria-hidden', 'true');
    hero.innerHTML = '<div class="hero-label">แก๊งนี้…<br>มีแต่ตัวตึง!</div><canvas width="500" height="280"></canvas><small>ชวนเพื่อนมาเป็นเป้ากันเถอะ!</small>';
    screen.appendChild(hero);
    const ctx = hero.querySelector('canvas')!.getContext('2d')!;
    for (let i = 0; i < 3; i++) {
      ctx.save();
      ctx.translate(100 + i * 150, 260 - (i === 1 ? 18 : 0));
      ctx.scale(72, 72);
      drawPuppet(ctx, builtins[i], animate(i === 1 ? 'wave' : 'dance', .3 + i));
      ctx.restore();
    }
  }
}

// ---------------- friends ----------------
function friendsScreen() {
  stopEyes();
  setGame(null);
  show(
    `<div class="friends">
      <header>
        <button class="btn small" id="back">← กลับ</button>
        <h2>แก๊งเพื่อน</h2>
        <span class="count"></span>
      </header>
      <div class="group-bar"></div>
      <div class="add-row">
        <label class="btn primary">+ อัพโหลดรูปเพื่อน<input type="file" accept="image/*" multiple id="files" hidden></label>
        <label class="btn">📷 ถ่ายรูป<input type="file" accept="image/*" capture="environment" id="cam" hidden></label>
      </div>
      <p class="tip">รูปหน้าชัดๆ หรือรูปเต็มตัวก็ได้ (รูปหมู่ก็ได้ จะแยกทุกคนให้) · รูปเต็มตัวจะได้ใส่ชุดตามรูปจริง · ทุกอย่างประมวลผลในเครื่อง ไม่ส่งรูปไปไหน</p>
      <div class="status"></div>
      <div class="grid"></div>
    </div>`,
    'screen friends-screen',
  );
  const grid = screen.querySelector<HTMLDivElement>('.grid')!;
  const status = screen.querySelector<HTMLDivElement>('.status')!;
  const count = screen.querySelector<HTMLSpanElement>('.count')!;
  screen.querySelector('#back')!.addEventListener('click', home);
  const cards = new Map<string, { c: HTMLCanvasElement; ch: RuntimeChar; anim: (typeof STOP_ANIMS)[number] }>();

  const bar = screen.querySelector<HTMLDivElement>('.group-bar')!;
  const renderBar = () => {
    const g = activeGroup(groups);
    bar.innerHTML = `<div class="chips">
        <button class="chip ${g ? '' : 'on'}" data-g="">ทุกคน (${friends.length})</button>
        ${groups.groups.map((x) => `<button class="chip ${x.id === groups.active ? 'on' : ''}" data-g="${x.id}">${esc(x.name)} (${inPlay({ ...groups, active: x.id }, friends).length})</button>`).join('')}
        <button class="chip add" id="newg">+ สร้างกลุ่มใหม่</button>
      </div>
      ${
        g
          ? `<div class="group-tools">
          <input id="gname" value="${esc(g.name)}" maxlength="24" aria-label="ชื่อกลุ่ม">
          <button class="btn small" id="pick">👥 เลือกเพื่อนเข้ากลุ่ม</button>
          <button class="btn small" id="delg">🗑 ลบกลุ่ม</button>
        </div>
        <p class="tip">เล่นกลุ่มนี้ = เห็นแค่เพื่อนในกลุ่มนี้ · รูปที่อัพโหลดตอนนี้จะเข้ากลุ่มนี้ · บันทึกให้อัตโนมัติ</p>`
          : groups.groups.length
            ? ''
            : '<p class="tip">มีเพื่อนหลายแก๊ง? กด "สร้างกลุ่มใหม่" แล้วเลือกกลุ่มก่อนเล่น เพื่อนต่างกลุ่มจะไม่ปนกัน</p>'
      }`;
    bar.querySelectorAll<HTMLButtonElement>('[data-g]').forEach((b) =>
      b.addEventListener('click', () => {
        sfx.click();
        saveGroups({ ...groups, active: b.dataset.g || null });
        render();
      }),
    );
    bar.querySelector('#newg')!.addEventListener('click', async () => {
      sfx.click();
      const name = await askName('สร้างกลุ่มใหม่', `กลุ่ม ${groups.groups.length + 1}`);
      if (!name) return;
      saveGroups(addGroup(groups, newId(), name));
      render();
    });
    if (!g) return;
    const gname = bar.querySelector<HTMLInputElement>('#gname')!;
    gname.addEventListener('change', () => {
      saveGroups(renameGroup(groups, g.id, gname.value.trim().slice(0, 24) || g.name));
      renderBar();
    });
    bar.querySelector('#pick')!.addEventListener('click', () => pickMembers(g.id, render));
    bar.querySelector('#delg')!.addEventListener('click', () => {
      if (!confirm(`ลบกลุ่ม "${g.name}" ? (รูปเพื่อนไม่หาย)`)) return;
      saveGroups(removeGroup(groups, g.id));
      render();
    });
  };

  const render = () => {
    renderBar();
    const inGroup = !!activeGroup(groups);
    const list = inPlay(groups, friends);
    count.textContent = `${list.length} คน`;
    grid.innerHTML = '';
    cards.clear();
    if (!list.length)
      grid.innerHTML = inGroup
        ? '<p class="empty">กลุ่มนี้ยังไม่มีเพื่อน อัพโหลดรูปใหม่ หรือกด "เลือกเพื่อนเข้ากลุ่ม"</p>'
        : '<p class="empty">ยังไม่มีเพื่อนเลย อัพโหลดรูปได้ไม่จำกัด!</p>';
    for (const f of [...list].reverse()) {
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `<canvas width="160" height="200"></canvas>
        <input value="${esc(f.name)}" maxlength="24" aria-label="ชื่อ">
        <div class="tags">${f.torso ? '<span>ชุดจริง</span>' : '<span>หัวการ์ตูน</span>'}</div>
        <button class="del" title="${inGroup ? 'เอาออกจากกลุ่ม' : 'ลบ'}">✕</button>`;
      const input = card.querySelector('input')!;
      input.addEventListener('change', async () => {
        f.name = input.value.trim() || f.name;
        await renameFriend(f.id, f.name);
      });
      card.querySelector('.del')!.addEventListener('click', async () => {
        const g = activeGroup(groups);
        if (g) {
          saveGroups(setMember(groups, g.id, f.id, false));
          render();
          return;
        }
        if (!confirm(`ลบ ${f.name} ? (จะหายจากทุกกลุ่ม)`)) return;
        await deleteFriend(f.id);
        saveGroups(forgetFriend(groups, f.id));
        friends = friends.filter((x) => x.id !== f.id);
        runtime.delete(f.id);
        render();
      });
      grid.appendChild(card);
      cards.set(f.id, { c: card.querySelector('canvas')!, ch: rt(f), anim: pick(STOP_ANIMS) });
    }
  };
  render();

  let raf = 0;
  const t0 = performance.now();
  const tick = () => {
    raf = requestAnimationFrame(tick);
    const t = (performance.now() - t0) / 1000;
    for (const { c, ch, anim } of cards.values()) {
      const g = c.getContext('2d')!;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, c.width, c.height);
      g.translate(c.width / 2, c.height - 12);
      g.scale(52, 52);
      drawPuppet(g, ch, animate(anim, t));
    }
  };
  tick();
  cleanupScreen = () => cancelAnimationFrame(raf);

  const handle = async (files: FileList | null) => {
    if (!files?.length) return;
    const list = [...files];
    let added = 0;
    for (let i = 0; i < list.length; i++) {
      status.innerHTML = `<span class="spin"></span> กำลังหาหน้าเพื่อน… (${i + 1}/${list.length})${i === 0 ? '<br><small>ครั้งแรกต้องโหลดสมอง AI สักครู่</small>' : ''}`;
      try {
        const src = await loadImageFile(list[i]);
        let found = await detectFriends(src, (k) => `เพื่อน ${friends.length + added + k + 1}`);
        if (!found.length) {
          const m = await manualPick(src);
          if (m) found = [await buildCharacter(src, manualGeom(m.c, m.w), null, `เพื่อน ${friends.length + added + 1}`)];
        }
        for (const c of found) {
          await saveFriend(c);
          friends.push(c);
          if (groups.active) saveGroups(setMember(groups, groups.active, c.id, true));
          added++;
        }
        render();
      } catch (e) {
        console.error(e);
        status.textContent = 'มีรูปที่อ่านไม่ได้ ลองรูปอื่นนะ';
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    status.innerHTML = added ? `เพิ่มเพื่อนแล้ว ${added} คน! แตะชื่อเพื่อเปลี่ยนชื่อได้` : 'ไม่พบหน้าในรูป ลองรูปที่เห็นหน้าชัดๆ นะ';
  };
  for (const id of ['#files', '#cam']) {
    const inp = screen.querySelector<HTMLInputElement>(id)!;
    inp.addEventListener('change', () => {
      void handle(inp.files).then(() => (inp.value = ''));
    });
  }
}

function askName(title: string, value: string): Promise<string | null> {
  return new Promise((res) => {
    const d = document.createElement('div');
    d.className = 'modal';
    d.innerHTML = `<form class="panel ask">
      <h3>${esc(title)}</h3>
      <input maxlength="24" required value="${esc(value)}" aria-label="ชื่อกลุ่ม">
      <div class="row"><button type="button" class="btn" id="cancel">ยกเลิก</button><button class="btn primary">💾 บันทึก</button></div>
    </form>`;
    document.body.appendChild(d);
    const inp = d.querySelector('input')!;
    inp.select();
    const done = (v: string | null) => (d.remove(), res(v));
    d.querySelector('#cancel')!.addEventListener('click', () => done(null));
    d.querySelector('form')!.addEventListener('submit', (e) => {
      e.preventDefault();
      done(inp.value.trim().slice(0, 24) || null);
    });
  });
}

/** Tick which existing friends belong to a group. */
function pickMembers(groupId: string, onClose: () => void) {
  const g = groups.groups.find((x) => x.id === groupId);
  if (!g) return;
  const d = document.createElement('div');
  d.className = 'modal';
  d.innerHTML = `<div class="panel members">
    <h3>เพื่อนในกลุ่ม "${esc(g.name)}"</h3>
    <p class="small-note">แตะเพื่อเลือก/เอาออก · เพื่อนหนึ่งคนอยู่ได้หลายกลุ่ม</p>
    <div class="pick-grid">${
      friends.length
        ? [...friends].reverse().map((f) => `<label><input type="checkbox" value="${f.id}" ${g.members.includes(f.id) ? 'checked' : ''}><img alt=""><span>${esc(f.name)}</span></label>`).join('')
        : '<p class="small-note">ยังไม่มีรูปเพื่อน อัพโหลดก่อนนะ</p>'
    }</div>
    <div class="row"><button class="btn small" id="all">เลือกทั้งหมด</button><button class="btn small" id="none">ไม่เลือกเลย</button><button class="btn primary" id="done">เสร็จ</button></div>
  </div>`;
  const byId = new Map(friends.map((f) => [f.id, f]));
  d.querySelectorAll<HTMLLabelElement>('.pick-grid label').forEach((l) => {
    const f = byId.get(l.querySelector('input')!.value)!;
    l.querySelector('img')!.src = f.head.img.toDataURL();
  });
  const boxes = [...d.querySelectorAll<HTMLInputElement>('input[type=checkbox]')];
  const apply = () => boxes.forEach((b) => saveGroups(setMember(groups, groupId, b.value, b.checked)));
  boxes.forEach((b) => b.addEventListener('change', apply));
  const setAll = (v: boolean) => {
    boxes.forEach((b) => (b.checked = v));
    apply();
  };
  d.querySelector('#all')!.addEventListener('click', () => setAll(true));
  d.querySelector('#none')!.addEventListener('click', () => setAll(false));
  d.querySelector('#done')!.addEventListener('click', () => {
    d.remove();
    onClose();
  });
  document.body.appendChild(d);
}

/** When no face is detected: let the player tap the face and size the circle. */
function manualPick(src: HTMLCanvasElement): Promise<{ c: { x: number; y: number }; w: number } | null> {
  return new Promise((res) => {
    const d = document.createElement('div');
    d.className = 'modal';
    d.innerHTML = `<div class="panel manual">
      <h3>หาหน้าไม่เจอ 🙈</h3>
      <p>แตะที่หน้าเพื่อน แล้วปรับขนาดวงกลมให้พอดีหน้า</p>
      <div class="manual-wrap"><canvas></canvas></div>
      <input type="range" min="0.03" max="0.6" step="0.005" value="0.18">
      <div class="row"><button class="btn" data-a="skip">ข้าม</button><button class="btn primary" data-a="ok">ใช้หน้านี้</button></div>
    </div>`;
    document.body.appendChild(d);
    const c = d.querySelector('canvas')!;
    const range = d.querySelector<HTMLInputElement>('input')!;
    const maxW = Math.min(innerWidth * 0.8, 520);
    const maxH = innerHeight * 0.5;
    const s = Math.min(maxW / src.width, maxH / src.height);
    c.width = src.width * s;
    c.height = src.height * s;
    let pt = { x: src.width / 2, y: src.height * 0.35 };
    const draw = () => {
      const g = c.getContext('2d')!;
      g.drawImage(src, 0, 0, c.width, c.height);
      const r = (+range.value * Math.max(src.width, src.height) * s) / 2;
      g.strokeStyle = '#ffd23f';
      g.lineWidth = 4;
      g.setLineDash([8, 6]);
      g.beginPath();
      g.ellipse(pt.x * s, pt.y * s, r, r * 1.25, 0, 0, Math.PI * 2);
      g.stroke();
    };
    draw();
    c.addEventListener('pointerdown', (e) => {
      const b = c.getBoundingClientRect();
      pt = { x: ((e.clientX - b.left) / b.width) * src.width, y: ((e.clientY - b.top) / b.height) * src.height };
      draw();
    });
    range.addEventListener('input', draw);
    d.querySelectorAll<HTMLButtonElement>('[data-a]').forEach((b) =>
      b.addEventListener('click', () => {
        d.remove();
        res(b.dataset.a === 'ok' ? { c: pt, w: +range.value * Math.max(src.width, src.height) } : null);
      }),
    );
  });
}

// ---------------- settings ----------------
function settingsDialog(onClose: () => void) {
  const d = document.createElement('div');
  d.className = 'modal';
  const seg = (name: string, opts: [string, string][], val: string) =>
    `<div class="seg" data-k="${name}">${opts.map(([v, l]) => `<button class="${v === val ? 'on' : ''}" data-v="${v}">${l}</button>`).join('')}</div>`;
  d.innerHTML = `<div class="panel settings">
    <h3>ตั้งค่า</h3>
    <label>วิธียิง</label>
    ${seg('control', [['touch', '👆 แตะจอ'], ['tilt', '📱 เอียงเครื่อง'], ['eye', '👁️ กระพริบตา']], settings.control)}
    <div class="tilt-opts">
      <p class="small-note">เอียงมือถือ/iPad เพื่อเล็ง แตะตรงไหนก็ได้บนจอเพื่อยิง · กด 🎯 ในเกมเพื่อตั้งศูนย์ใหม่</p>
      <label>ความไวการเอียง <small>(ไวมาก = เอียงนิดเดียวก็ถึงขอบจอ)</small></label>
      <input type="range" min="8" max="35" step="1" value="${43 - settings.tiltRange}" id="tiltRange">
    </div>
    <div class="eye-opts">
      <label>ตาที่ใช้ยิง (หลับตาข้างนี้ = ยิง)</label>
      ${seg('eye', [['left', '😉 ตาซ้าย'], ['right', 'ตาขวา 😜']], settings.eye)}
      <label>ความนิ่งของเป้า <small>(นิ่งมาก = สั่นน้อยแต่ตามช้า)</small></label>
      <input type="range" min="0" max="1" step="0.05" value="${settings.smooth}" id="smooth">
      <button class="btn" id="calib">🎯 Calibrate สายตา</button>
      <p class="small-note" id="calib-state">${tracker.calib ? 'Calibrate แล้ว ✔' : 'ยังไม่ได้ Calibrate'}</p>
    </div>
    <label>เสียง</label>
    <div class="toggles">
      <label><input type="checkbox" id="sound" ${settings.sound ? 'checked' : ''}> เอฟเฟกต์</label>
      <label><input type="checkbox" id="music" ${settings.music ? 'checked' : ''}> เพลงงานวัด</label>
      <label><input type="checkbox" id="voice" ${settings.voice ? 'checked' : ''}> เสียงพูดแซว</label>
    </div>
    <button class="btn primary" id="close">เสร็จ</button>
  </div>`;
  document.body.appendChild(d);
  const eyeOpts = d.querySelector<HTMLDivElement>('.eye-opts')!;
  const tiltOpts = d.querySelector<HTMLDivElement>('.tilt-opts')!;
  const sync = () => {
    eyeOpts.style.display = settings.control === 'eye' ? '' : 'none';
    tiltOpts.style.display = settings.control === 'tilt' ? '' : 'none';
  };
  d.querySelector<HTMLInputElement>('#tiltRange')!.addEventListener('input', (e) => {
    settings.tiltRange = 43 - +(e.target as HTMLInputElement).value;
    saveSettings();
  });
  sync();
  d.querySelectorAll<HTMLDivElement>('.seg').forEach((s) =>
    s.querySelectorAll<HTMLButtonElement>('button').forEach((b) =>
      b.addEventListener('click', () => {
        sfx.click();
        s.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
        (settings as unknown as Record<string, string>)[s.dataset.k!] = b.dataset.v!;
        saveSettings();
        sync();
      }),
    ),
  );
  d.querySelector<HTMLInputElement>('#smooth')!.addEventListener('input', (e) => {
    settings.smooth = +(e.target as HTMLInputElement).value;
    saveSettings();
  });
  for (const k of ['sound', 'music', 'voice'] as const)
    d.querySelector<HTMLInputElement>('#' + k)!.addEventListener('change', (e) => {
      settings[k] = (e.target as HTMLInputElement).checked;
      saveSettings();
    });
  d.querySelector('#calib')!.addEventListener('click', async () => {
    d.style.display = 'none';
    await calibrate();
    d.querySelector('#calib-state')!.textContent = tracker.calib ? 'Calibrate แล้ว ✔' : 'ยังไม่ได้ Calibrate';
    d.style.display = '';
  });
  d.querySelector('#close')!.addEventListener('click', () => {
    d.remove();
    onClose();
  });
}

async function calibrate(): Promise<boolean> {
  const c = await runCalibration(tracker, settings.eye);
  if (c) {
    saveCalibration(c);
    tracker.setCalibration(c);
  }
  return !!c;
}

// ---------------- play ----------------
let eyeHud: HTMLDivElement | null = null;
let eyeListener: (() => void) | null = null;

function stopEyes() {
  if (eyeListener) tracker.listeners.delete(eyeListener);
  eyeListener = null;
  tracker.onWink = null;
  eyeHud?.remove();
  eyeHud = null;
  tracker.stop();
  tilt.stop();
  tilt.onMove = null;
}

async function play(level: number) {
  // iOS only shows the motion permission prompt when asked synchronously inside the tap
  const tiltPerm = settings.control === 'tilt' ? TiltAim.requestPermission() : null;
  const eyeMode = settings.control === 'eye';
  if (eyeMode && !tracker.calib) {
    if (!(await calibrate())) {
      settings.control = 'touch';
      saveSettings();
    }
  }
  const useEyes = settings.control === 'eye';
  const g = new Game(cast(), { level, slack: useEyes ? 16 : 9, onRoundEnd: (r) => result(r) });
  const useTilt = settings.control === 'tilt';
  g.eyeAim = useEyes || useTilt;
  g.aimIcon = useEyes ? 'eye' : useTilt ? 'tilt' : '';
  g.winkHint = useEyes ? `หลับตา${settings.eye === 'left' ? 'ซ้าย' : 'ขวา'}เพื่อยิง 😉` : useTilt ? 'เอียงเครื่องเล็ง แตะจอยิง 📱' : '';
  setGame(g);
  show(
    `<div class="hud-buttons">
      <button class="btn small" id="quit">⏸ เมนู</button>
      ${useEyes ? '<button class="btn small" id="recal">🎯 Calibrate</button>' : ''}
      ${useTilt ? '<button class="btn small" id="recenter">🎯 ตั้งศูนย์</button>' : ''}
    </div>`,
    'screen play-screen',
  );
  screen.querySelector('#quit')!.addEventListener('click', home);
  if (settings.music) startMusic();
  cleanupScreen = () => stopMusic();
  if (useEyes) {
    screen.querySelector('#recal')!.addEventListener('click', async () => {
      await calibrate();
      await startEyes(g);
    });
    await startEyes(g);
  } else if (useTilt) {
    stopEyes();
    screen.querySelector('#recenter')!.addEventListener('click', (e) => {
      e.stopPropagation();
      tilt.recenter();
    });
    await startTilt(g, tiltPerm!);
  } else stopEyes();
}

async function startTilt(g: Game, perm: Promise<boolean>) {
  const ok = (await perm) && (await tilt.start());
  if (!ok) {
    alert('เครื่องนี้อ่านการเอียงไม่ได้ (หรือไม่ได้อนุญาต) เปลี่ยนเป็นโหมดแตะจอนะ');
    settings.control = 'touch';
    saveSettings();
    g.eyeAim = false;
    g.aimIcon = '';
    g.winkHint = '';
    screen.querySelector('#recenter')?.remove();
    return;
  }
  tilt.onMove = () => {
    if (game !== g) return;
    g.aim = g.fromViewport(tilt.cursor);
    g.showAim = true;
  };
}

async function startEyes(g: Game) {
  try {
    await tracker.start();
  } catch (e) {
    console.warn(e);
    alert('เปิดกล้องไม่ได้ เปลี่ยนเป็นโหมดแตะจอนะ');
    settings.control = 'touch';
    saveSettings();
    g.eyeAim = false;
    return;
  }
  if (!eyeHud) {
    eyeHud = document.createElement('div');
    eyeHud.className = 'eye-hud';
    eyeHud.innerHTML = '<div class="bars"><i class="bl"></i><i class="br"></i></div><div class="face-state"></div>';
    document.body.appendChild(eyeHud);
  }
  eyeHud.prepend(tracker.video);
  const bl = eyeHud.querySelector<HTMLElement>('.bl')!;
  const br = eyeHud.querySelector<HTMLElement>('.br')!;
  const fs = eyeHud.querySelector<HTMLElement>('.face-state')!;
  if (eyeListener) tracker.listeners.delete(eyeListener);
  eyeListener = () => {
    const f = tracker.frame;
    g.aim = g.fromViewport(tracker.cursor);
    g.showAim = f.ok;
    // mirrored preview: the subject's left eye shows on the right
    bl.style.height = `${f.blinkR * 100}%`;
    br.style.height = `${f.blinkL * 100}%`;
    fs.textContent = f.ok ? (tracker.winking ? 'ยิง!' : 'เห็นหน้าแล้ว') : 'มองไม่เห็นหน้า';
    fs.classList.toggle('bad', !f.ok);
  };
  tracker.listeners.add(eyeListener);
  tracker.onWink = (p) => game === g && g.shoot(g.fromViewport(p));
}

function result(r: RoundResult) {
  const win = r.outcome !== 'lose';
  if (!win) return gameOver(r);
  const prize = pick(r.outcome === 'perfect' ? BIG_PRIZES : PRIZES);
  prizes.push(prize);
  localStorage.setItem(PKEY, JSON.stringify(prizes));
  sfx.win();
  const d = document.createElement('div');
  d.className = 'modal result';
  d.innerHTML = `<div class="panel">
    <h2>${r.outcome === 'perfect' ? 'แม่นสุดๆ! 5/5 🔥' : 'ผ่านรอบ ' + r.level + '! 🎉'}</h2>
    <p class="score">ยิงโดน <b>${r.hits}</b> / 5 นัด${r.heads ? ` · เฮดช็อต ${r.heads}` : ''}</p>
    <p class="total">${r.score.toLocaleString()} <small>แต้ม</small></p>
    ${r.combo >= 2 ? `<p class="combo">🔥 คอมโบ ${r.combo} ต่อเนื่องไปรอบหน้า!</p>` : ''}
    <div class="prize">${prize}</div>
    <div class="row">
      <button class="btn" data-a="home">เมนู</button>
      <button class="btn primary" data-a="next">รอบ ${r.level + 1} (เร็วขึ้น!) →</button>
    </div>
  </div>`;
  document.body.appendChild(d);
  d.querySelectorAll<HTMLButtonElement>('[data-a]').forEach((b) =>
    b.addEventListener('click', () => {
      d.remove();
      if (b.dataset.a === 'home') home();
      else if (game) game.setLevel(r.level + 1);
    }),
  );
}

function gameOver(r: RoundResult) {
  sfx.lose();
  const isBest = r.score > best.score;
  if (isBest) {
    best = { score: r.score, level: r.level };
    localStorage.setItem(BKEY, JSON.stringify(best));
  }
  const d = document.createElement('div');
  d.className = 'modal result';
  d.innerHTML = `<div class="panel">
    <h2>จบเกม! 😆</h2>
    <p class="score">รอบ ${r.level} ยิงโดน <b>${r.hits}</b> / 5 นัด · เพื่อนๆ หัวเราะเยาะแล้ว!</p>
    <p class="total">${r.score.toLocaleString()} <small>แต้ม</small></p>
    <p class="best">${isBest && r.score ? '🎉 สถิติใหม่ของคุณ!' : `สถิติของคุณ ${best.score.toLocaleString()}`}</p>
    ${
      r.score > 0
        ? `<form class="submit"><input id="pname" maxlength="20" placeholder="ชื่อของคุณ" value="${esc(settings.player)}" required>
           <button class="btn primary small">ส่งคะแนน${isGlobal ? 'ขึ้นอันดับโลก 🌏' : ' 🏆'}</button></form>
           <p class="small-note rank-msg"></p>`
        : ''
    }
    <div class="row">
      <button class="btn" data-a="home">เมนู</button>
      <button class="btn" data-a="board">อันดับ</button>
      <button class="btn primary" data-a="again">เล่นใหม่ ↺</button>
    </div>
  </div>`;
  document.body.appendChild(d);
  const form = d.querySelector<HTMLFormElement>('form.submit');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = cleanName(d.querySelector<HTMLInputElement>('#pname')!.value);
    if (!name) return;
    settings.player = name;
    saveSettings();
    const msg = d.querySelector<HTMLElement>('.rank-msg')!;
    form.querySelector('button')!.disabled = true;
    msg.textContent = 'กำลังส่ง...';
    try {
      await submitScore({ name, score: r.score, level: r.level });
      const rank = await rankOf(r.score).catch(() => null);
      form.remove();
      msg.textContent = rank ? `ได้อันดับที่ ${rank}${isGlobal ? ' ของโลก' : ''}! 🏅` : 'ส่งแล้ว!';
    } catch (err) {
      console.warn(err);
      form.querySelector('button')!.disabled = false;
      msg.textContent = 'ส่งไม่สำเร็จ ลองใหม่อีกครั้งนะ (ต้องต่อเน็ต)';
    }
  });
  d.querySelectorAll<HTMLButtonElement>('[data-a]').forEach((b) =>
    b.addEventListener('click', () => {
      if (b.dataset.a === 'board') return boardDialog();
      d.remove();
      if (b.dataset.a === 'home') home();
      else if (game) game.setLevel(1, false);
    }),
  );
}

async function boardDialog() {
  const d = document.createElement('div');
  d.className = 'modal board';
  d.innerHTML = `<div class="panel">
    <h3>${isGlobal ? 'อันดับโลก 🌏' : 'อันดับในเครื่องนี้ 🏆'}</h3>
    <ol class="scores"><li class="small-note">กำลังโหลด...</li></ol>
    <button class="btn primary" id="close">ปิด</button>
  </div>`;
  document.body.appendChild(d);
  d.querySelector('#close')!.addEventListener('click', () => d.remove());
  const ol = d.querySelector('ol')!;
  let list: ScoreEntry[] = [];
  try {
    list = await topScores(50);
  } catch (e) {
    console.warn(e);
    ol.innerHTML = '<li class="small-note">โหลดอันดับไม่ได้ (ต้องต่อเน็ต)</li>';
    return;
  }
  ol.innerHTML = list.length
    ? list
        .map(
          (e, i) =>
            `<li class="${e.name === settings.player ? 'me' : ''}"><span class="medal">${['🥇', '🥈', '🥉'][i] ?? i + 1}</span><span class="nm">${esc(e.name)}</span><span class="lv">รอบ ${e.level}</span><b>${e.score.toLocaleString()}</b></li>`,
        )
        .join('')
    : '<li class="small-note">ยังไม่มีใครส่งคะแนน เป็นคนแรกเลย!</li>';
}

// Canvas scenery is cached, so explicitly load the Thai font subset before
// painting it. DOM text repaints when fonts arrive; a cached canvas does not.
Promise.all([
  loadFriends().then((f) => (friends = f)).catch((e) => console.warn(e)),
  Promise.all([400, 600, 700].map(weight => document.fonts.load(`${weight} 24px "Mitr"`, 'ยิงเป้าแก๊งเพื่อน')))
    .catch((e) => console.warn(e)),
])
  .finally(() => {
    home();
    // Preview-only deep links make identical main screens easy to compare.
    if (previewScene === 'play') void play(1);
    if (previewScene === 'friends') friendsScreen();
    if (previewScene === 'settings') settingsDialog(home);
    if (!inComparison) {
      const nav = document.createElement('nav');
      nav.className = 'art-switch';
      nav.setAttribute('aria-label', 'เปรียบเทียบภาพตัวอย่าง');
      const url = (art: string) => {
        const p = new URLSearchParams(location.search);
        p.set('art', art);
        return `?${p}`;
      };
      nav.innerHTML = `<span>ART PREVIEW</span><a href="${url('original')}" ${!cartoonArt ? 'aria-current="page"' : ''}>ภาพเดิม</a><a href="${url('cartoon')}" ${cartoonArt ? 'aria-current="page"' : ''}>การ์ตูน</a><a href="./compare.html">เทียบคู่ ↗</a>`;
      document.body.appendChild(nav);
    }
  });

import '@fontsource/mitr/400.css';
import '@fontsource/mitr/600.css';
import '@fontsource/mitr/700.css';
import './style.css';
import { builtinCharacters, prepare, type CharacterData, type RuntimeChar } from './character';
import { buildCharacter, detectFriends, loadImageFile, manualGeom } from './cutout';
import { deleteFriend, loadFriends, renameFriend, saveFriend } from './store';
import { Game, type RoundResult } from './game';
import { animate, drawPuppet, STOP_ANIMS } from './puppet';
import { EyeTracker, saveCalibration, type EyeSide } from './eyes';
import { runCalibration } from './calibrate';
import { setMusic, setSound, setVoice, sfx, startMusic, stopMusic } from './audio';
import { pick } from './util';

interface Settings {
  control: 'touch' | 'eye';
  eye: EyeSide;
  smooth: number;
  sound: boolean;
  music: boolean;
  voice: boolean;
}

const SKEY = 'cs.settings.v1';
const PKEY = 'cs.prizes.v1';
const settings: Settings = { control: 'touch', eye: 'right', smooth: 0.6, sound: true, music: true, voice: true, ...JSON.parse(localStorage.getItem(SKEY) || '{}') };
const saveSettings = () => {
  localStorage.setItem(SKEY, JSON.stringify(settings));
  applySettings();
};
const prizes: string[] = JSON.parse(localStorage.getItem(PKEY) || '[]');
const PRIZES = ['🧸', '🎈', '🍭', '🦄', '🐻', '🍦', '🎁', '🐶', '🐱', '🪀', '🚀', '🦖'];
const BIG_PRIZES = ['🏆', '👑', '🐉', '🎠'];

const tracker = new EyeTracker();
function applySettings() {
  setSound(settings.sound);
  setMusic(settings.music);
  setVoice(settings.voice);
  tracker.eye = settings.eye;
  tracker.setSmoothing(settings.smooth);
}
applySettings();

let friends: CharacterData[] = [];
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
  const mine = friends.map(rt);
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

// ---------------- home ----------------
function home() {
  stopEyes();
  setGame(new Game(cast(), { attract: true }));
  const n = friends.length;
  show(
    `<div class="panel home">
      <h1>ยิงเป้า<span>แก๊งเพื่อน</span></h1>
      <p class="sub">ยิงจุกก๊อก 5 นัด โดน 3 นัดรับรางวัล!</p>
      <button class="btn primary big" id="play">เริ่มยิง! 🎯</button>
      <button class="btn" id="friends">แก๊งเพื่อน (${n}) 📸</button>
      <button class="btn" id="settings">ตั้งค่า ⚙️ · ${settings.control === 'eye' ? 'ยิงด้วยตา 👁️' : 'แตะจอ 👆'}</button>
      ${prizes.length ? `<div class="shelf" title="รางวัลที่ได้">${prizes.slice(-24).join('')}</div>` : ''}
      ${n === 0 ? '<p class="hint">ยังไม่มีรูปเพื่อน กด "แก๊งเพื่อน" เพื่ออัพโหลดรูปได้เลย</p>' : ''}
    </div>`,
    'screen home-screen',
  );
  screen.querySelector('#play')!.addEventListener('click', () => (sfx.click(), play(1)));
  screen.querySelector('#friends')!.addEventListener('click', () => (sfx.click(), friendsScreen()));
  screen.querySelector('#settings')!.addEventListener('click', () => (sfx.click(), settingsDialog(home)));
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

  const render = () => {
    count.textContent = `${friends.length} คน`;
    grid.innerHTML = '';
    cards.clear();
    if (!friends.length) grid.innerHTML = '<p class="empty">ยังไม่มีเพื่อนเลย อัพโหลดรูปได้ไม่จำกัด!</p>';
    for (const f of [...friends].reverse()) {
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `<canvas width="160" height="200"></canvas>
        <input value="${esc(f.name)}" maxlength="24" aria-label="ชื่อ">
        <div class="tags">${f.torso ? '<span>ชุดจริง</span>' : '<span>หัวการ์ตูน</span>'}</div>
        <button class="del" title="ลบ">✕</button>`;
      const input = card.querySelector('input')!;
      input.addEventListener('change', async () => {
        f.name = input.value.trim() || f.name;
        await renameFriend(f.id, f.name);
      });
      card.querySelector('.del')!.addEventListener('click', async () => {
        if (!confirm(`ลบ ${f.name} ?`)) return;
        await deleteFriend(f.id);
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
    ${seg('control', [['touch', '👆 แตะจอ / เมาส์'], ['eye', '👁️ กระพริบตา']], settings.control)}
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
  const sync = () => (eyeOpts.style.display = settings.control === 'eye' ? '' : 'none');
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
}

async function play(level: number) {
  const eyeMode = settings.control === 'eye';
  if (eyeMode && !tracker.calib) {
    if (!(await calibrate())) {
      settings.control = 'touch';
      saveSettings();
    }
  }
  const useEyes = settings.control === 'eye';
  const g = new Game(cast(), { level, slack: useEyes ? 16 : 9, onRoundEnd: (r) => result(r) });
  g.eyeAim = useEyes;
  g.winkHint = useEyes ? `หลับตา${settings.eye === 'left' ? 'ซ้าย' : 'ขวา'}เพื่อยิง 😉` : '';
  setGame(g);
  show(
    `<div class="hud-buttons">
      <button class="btn small" id="quit">⏸ เมนู</button>
      ${useEyes ? '<button class="btn small" id="recal">🎯 Calibrate</button>' : ''}
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
  } else stopEyes();
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
  const prize = win ? pick(r.outcome === 'perfect' ? BIG_PRIZES : PRIZES) : '';
  if (win) {
    prizes.push(prize);
    localStorage.setItem(PKEY, JSON.stringify(prizes));
    sfx.win();
  } else sfx.lose();
  const d = document.createElement('div');
  d.className = 'modal result';
  d.innerHTML = `<div class="panel">
    <h2>${r.outcome === 'perfect' ? 'แม่นสุดๆ! 5/5 🔥' : win ? 'ชนะแล้ว! 🎉' : 'อีกนิดเดียว! 😆'}</h2>
    <p class="score">ยิงโดน <b>${r.hits}</b> / 5 นัด${r.heads ? ` · เฮดช็อต ${r.heads}` : ''}</p>
    ${win ? `<div class="prize">${prize}</div><p>ได้รางวัลแล้ว!</p>` : '<p>ต้องโดนอย่างน้อย 3 นัดนะ เพื่อนๆ กำลังหัวเราะเยาะอยู่เลย!</p>'}
    <div class="row">
      <button class="btn" data-a="home">เมนู</button>
      <button class="btn primary" data-a="next">${win ? `รอบต่อไป (เร็วขึ้น!) →` : 'ลองใหม่'}</button>
    </div>
  </div>`;
  document.body.appendChild(d);
  d.querySelectorAll<HTMLButtonElement>('[data-a]').forEach((b) =>
    b.addEventListener('click', () => {
      d.remove();
      if (b.dataset.a === 'home') home();
      else if (game) game.setLevel(win ? r.level + 1 : r.level);
    }),
  );
}

loadFriends()
  .then((f) => (friends = f))
  .catch((e) => console.warn(e))
  .finally(home);

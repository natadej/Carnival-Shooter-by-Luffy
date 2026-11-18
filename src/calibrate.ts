import { fitLinear, winkFromSamples, applyLinear } from './logic';
import type { Calibration, EyeFrame, EyeSide, EyeTracker } from './eyes';
import { sfx } from './audio';

const POINTS = [
  [0.5, 0.5], [0.1, 0.1], [0.5, 0.1], [0.9, 0.1], [0.9, 0.5], [0.9, 0.9], [0.5, 0.9], [0.1, 0.9], [0.1, 0.5],
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const eyeName = (e: EyeSide) => (e === 'left' ? 'ซ้าย' : 'ขวา');

function collect(tr: EyeTracker, ms: number): Promise<EyeFrame[]> {
  return new Promise((res) => {
    const out: EyeFrame[] = [];
    const l = (f: EyeFrame) => f.ok && out.push({ ...f, feat: [...f.feat] });
    tr.listeners.add(l);
    setTimeout(() => {
      tr.listeners.delete(l);
      res(out);
    }, ms);
  });
}

/** Full-screen calibration: look at 9 dots, then wink the chosen eye. Resolves null if cancelled. */
export async function runCalibration(tr: EyeTracker, eye: EyeSide): Promise<Calibration | null> {
  const root = document.createElement('div');
  root.className = 'calib';
  root.innerHTML = `
    <div class="calib-msg"></div>
    <div class="calib-dot"><span></span></div>
    <div class="calib-cursor"></div>
    <div class="calib-actions"></div>
    <button class="btn small calib-cancel">ยกเลิก</button>`;
  document.body.appendChild(root);
  const msg = root.querySelector<HTMLDivElement>('.calib-msg')!;
  const dot = root.querySelector<HTMLDivElement>('.calib-dot')!;
  const cursor = root.querySelector<HTMLDivElement>('.calib-cursor')!;
  const actions = root.querySelector<HTMLDivElement>('.calib-actions')!;
  const preview = tr.video;
  preview.classList.add('calib-preview');
  root.appendChild(preview);
  let cancelled = false;
  root.querySelector('.calib-cancel')!.addEventListener('click', () => (cancelled = true));
  const cleanup = () => {
    preview.classList.remove('calib-preview');
    preview.remove();
    root.remove();
  };
  const say = (html: string) => (msg.innerHTML = html);

  try {
    say('กำลังเปิดกล้อง…');
    await tr.start();
    // wait for a face
    say('หันหน้าเข้าหาจอ ให้เห็นหน้าชัดๆ<br><small>วางมือถือ/แท็บเล็ตให้นิ่ง ห่างหน้าประมาณ 1 ศอก</small>');
    while (!cancelled && !tr.frame.ok) await sleep(150);
    await sleep(600);
    if (cancelled) return null;

    const X: number[][] = [];
    const yx: number[] = [];
    const yy: number[] = [];
    dot.style.display = 'block';
    for (let i = 0; i < POINTS.length; i++) {
      if (cancelled) return null;
      const [px, py] = POINTS[i];
      say(`มองที่จุดสีเหลือง (${i + 1}/${POINTS.length})<br><small>หันหน้าและกลอกตาไปที่จุดได้เลย</small>`);
      dot.style.left = `${px * 100}%`;
      dot.style.top = `${py * 100}%`;
      dot.classList.remove('go');
      void dot.offsetWidth;
      dot.classList.add('go');
      await sleep(800);
      const fr = await collect(tr, 1100);
      sfx.click();
      for (const f of fr) {
        X.push(f.feat);
        yx.push(px);
        yy.push(py);
      }
    }
    dot.style.display = 'none';
    if (X.length < 30) {
      say('มองไม่เห็นหน้าชัดพอ ลองใหม่ในที่สว่างขึ้นนะ');
      await sleep(2200);
      return null;
    }
    const n = X[0].length;
    const mean = Array.from({ length: n }, (_, j) => X.reduce((s, r) => s + r[j], 0) / X.length);
    const std = Array.from({ length: n }, (_, j) => Math.sqrt(X.reduce((s, r) => s + (r[j] - mean[j]) ** 2, 0) / X.length) || 1);
    const Z = X.map((r) => r.map((v, j) => (v - mean[j]) / std[j]));
    const wx = fitLinear(Z, yx, 0.02);
    const wy = fitLinear(Z, yy, 0.02);

    // wink calibration
    say('ลืมตาทั้งสองข้าง มองตรงๆ ค้างไว้…');
    await sleep(500);
    const open = await collect(tr, 1000);
    say(`<b>หลับตา${eyeName(eye)}</b> ค้างไว้ (ลืมตาอีกข้าง) 😉`);
    await sleep(900);
    const shut = await collect(tr, 1200);
    const avg = (a: number[]) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
    const riseL = avg(shut.map((f) => f.blinkL)) - avg(open.map((f) => f.blinkL));
    const riseR = avg(shut.map((f) => f.blinkR)) - avg(open.map((f) => f.blinkR));
    const channel = riseL >= riseR ? 'L' : 'R';
    const pickC = (f: EyeFrame) => ({ c: channel === 'L' ? f.blinkL : f.blinkR, o: channel === 'L' ? f.blinkR : f.blinkL });
    const wink = winkFromSamples(open.map(pickC), shut.map(pickC));
    const cal: Calibration = { mean, std, wx, wy, channel, eye, wink };
    const err = avg(Z.map((z, i) => Math.hypot(applyLinear(wx, z) - yx[i], applyLinear(wy, z) - yy[i])));

    // try-out
    tr.setCalibration(cal);
    tr.eye = eye;
    cursor.style.display = 'block';
    say(`เสร็จแล้ว! ลองมองไปรอบๆ เป้าจะตามสายตา<br><small>หลับตา${eyeName(eye)}เพื่อลองยิง · ความแม่น ${Math.max(0, Math.round(100 - err * 200))}%</small>`);
    const move = () => {
      cursor.style.transform = `translate(${tr.cursor.x}px, ${tr.cursor.y}px)`;
    };
    tr.listeners.add(move);
    const prevWink = tr.onWink;
    tr.onWink = (p) => {
      sfx.pop();
      const ring = document.createElement('div');
      ring.className = 'calib-ring';
      ring.style.left = `${p.x}px`;
      ring.style.top = `${p.y}px`;
      root.appendChild(ring);
      setTimeout(() => ring.remove(), 600);
    };
    const choice = await new Promise<'ok' | 'redo'>((res) => {
      actions.innerHTML = '<button class="btn" data-a="redo">ทำใหม่</button><button class="btn primary" data-a="ok">ใช้ค่านี้</button>';
      actions.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => res(b.dataset.a as 'ok' | 'redo')));
      const iv = setInterval(() => cancelled && (clearInterval(iv), res('redo')), 200);
    });
    tr.listeners.delete(move);
    tr.onWink = prevWink;
    if (choice === 'redo') {
      cleanup();
      return cancelled ? null : await runCalibration(tr, eye);
    }
    return cal;
  } catch (e) {
    console.warn(e);
    say('เปิดกล้องไม่ได้ 😢 ต้องอนุญาตให้ใช้กล้องก่อนนะ');
    await sleep(2500);
    return null;
  } finally {
    cleanup();
  }
}

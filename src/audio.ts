let ac: AudioContext | null = null;
let enabled = true;
let musicOn = true;
let musicTimer = 0;

export function setSound(on: boolean) {
  enabled = on;
}

export function setMusic(on: boolean) {
  musicOn = on;
  if (!on) stopMusic();
}

function ctx(): AudioContext | null {
  if (!enabled) return null;
  ac ??= new AudioContext();
  if (ac.state === 'suspended') void ac.resume();
  return ac;
}

function tone(freq: number, dur: number, type: OscillatorType, vol: number, slide = 0, when = 0) {
  const a = ctx();
  if (!a) return;
  const t = a.currentTime + when;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur: number, vol: number, hp = 800) {
  const a = ctx();
  if (!a) return;
  const n = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, n, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 2;
  const s = a.createBufferSource();
  s.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = hp;
  const g = a.createGain();
  g.gain.value = vol;
  s.connect(f).connect(g).connect(a.destination);
  s.start();
}

export const sfx = {
  pop() {
    noise(0.08, 0.5, 1200);
    tone(520, 0.08, 'square', 0.12, -300);
  },
  hit() {
    tone(260, 0.35, 'triangle', 0.35, 500);
    tone(900, 0.12, 'square', 0.08, -500, 0.02);
  },
  head() {
    tone(660, 0.12, 'square', 0.15);
    tone(990, 0.2, 'square', 0.15, 0, 0.1);
  },
  miss() {
    noise(0.12, 0.25, 300);
    tone(180, 0.18, 'sine', 0.15, -60);
  },
  laugh() {
    for (let i = 0; i < 4; i++) tone(560 - i * 40, 0.09, 'triangle', 0.08, 120, i * 0.11);
  },
  win() {
    [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.22, 'square', 0.12, 0, i * 0.13));
  },
  lose() {
    [392, 330, 262].forEach((f, i) => tone(f, 0.3, 'triangle', 0.15, -20, i * 0.22));
  },
  click() {
    tone(800, 0.05, 'square', 0.06);
  },
};

const MELODY = [523, 0, 659, 0, 784, 784, 659, 0, 698, 0, 587, 0, 659, 523, 0, 0, 392, 0, 523, 0, 659, 659, 587, 0, 523, 0, 494, 0, 523, 0, 0, 0];
const BASS = [131, 196, 131, 196, 175, 220, 131, 196];

export function startMusic() {
  if (!musicOn || musicTimer) return;
  let step = 0;
  const beat = 0.16;
  musicTimer = window.setInterval(() => {
    if (!enabled) return;
    const m = MELODY[step % MELODY.length];
    if (m) tone(m, beat * 0.9, 'square', 0.03);
    if (step % 4 === 0) tone(BASS[(step / 4) % BASS.length], beat * 1.6, 'triangle', 0.06);
    if (step % 4 === 2) noise(0.03, 0.05, 4000);
    step++;
  }, beat * 1000);
}

export function stopMusic() {
  clearInterval(musicTimer);
  musicTimer = 0;
}

let voiceOn = true;
let lastSpeak = 0;
export function setVoice(on: boolean) {
  voiceOn = on;
}

export function say(text: string) {
  if (!voiceOn || !enabled || !('speechSynthesis' in window)) return;
  const now = performance.now();
  if (now - lastSpeak < 2500 || speechSynthesis.speaking) return;
  lastSpeak = now;
  const u = new SpeechSynthesisUtterance(text.replace(/[~!]/g, ''));
  u.lang = 'th-TH';
  u.pitch = 1.7;
  u.rate = 1.15;
  u.volume = 0.8;
  const th = speechSynthesis.getVoices().find((v) => v.lang.startsWith('th'));
  if (th) u.voice = th;
  speechSynthesis.speak(u);
}

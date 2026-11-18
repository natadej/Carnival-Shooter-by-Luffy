/**
 * Global leaderboard backed by a Supabase table (see supabase/schema.sql).
 * Without configuration it falls back to a per-device leaderboard in localStorage.
 */
export interface ScoreEntry {
  name: string;
  score: number;
  level: number;
  created_at?: string;
}

const URL_ = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, '') ?? '';
const KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '';
const LKEY = 'cs.scores.v1';
export const isGlobal = !!(URL_ && KEY);

const headers = () => ({ apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' });

function local(): ScoreEntry[] {
  return JSON.parse(localStorage.getItem(LKEY) || '[]');
}

function saveLocal(e: ScoreEntry) {
  const l = [...local(), { ...e, created_at: new Date().toISOString() }].sort((a, b) => b.score - a.score).slice(0, 50);
  localStorage.setItem(LKEY, JSON.stringify(l));
}

export const cleanName = (s: string) => s.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 20);

export async function submitScore(e: ScoreEntry): Promise<void> {
  const entry = { name: cleanName(e.name) || 'นักแม่นปืน', score: Math.floor(e.score), level: Math.floor(e.level) };
  saveLocal(entry);
  if (!isGlobal) return;
  const r = await fetch(`${URL_}/rest/v1/scores`, { method: 'POST', headers: { ...headers(), Prefer: 'return=minimal' }, body: JSON.stringify(entry) });
  if (!r.ok) throw new Error(`submit failed: ${r.status}`);
}

export async function topScores(limit = 50): Promise<ScoreEntry[]> {
  if (!isGlobal) return local().slice(0, limit);
  const r = await fetch(`${URL_}/rest/v1/scores?select=name,score,level,created_at&order=score.desc,created_at.asc&limit=${limit}`, { headers: headers() });
  if (!r.ok) throw new Error(`load failed: ${r.status}`);
  return r.json();
}

/** 1-based global rank a score would have. */
export async function rankOf(score: number): Promise<number | null> {
  if (!isGlobal) return local().filter((e) => e.score > score).length + 1;
  const r = await fetch(`${URL_}/rest/v1/scores?select=score&score=gt.${Math.floor(score)}`, { method: 'HEAD', headers: { ...headers(), Prefer: 'count=exact' } });
  const m = r.headers.get('content-range')?.match(/\/(\d+)/);
  return m ? +m[1] + 1 : null;
}

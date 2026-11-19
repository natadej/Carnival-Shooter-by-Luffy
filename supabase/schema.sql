-- Run once in Supabase: Dashboard → SQL Editor → New query → paste → Run
create table if not exists public.scores (
  id bigint generated always as identity primary key,
  name text not null check (char_length(name) between 1 and 20),
  score integer not null check (score >= 0),
  level integer not null check (level between 1 and 500),
  created_at timestamptz not null default now(),
  -- mirrors maxScore() in src/logic.ts so impossible scores are rejected
  constraint plausible_score check (score <= 2750 * level * (level + 1) / 2)
);
create index if not exists scores_score_idx on public.scores (score desc);

alter table public.scores enable row level security;
drop policy if exists "anyone can read" on public.scores;
create policy "anyone can read" on public.scores for select using (true);
drop policy if exists "anyone can submit" on public.scores;
create policy "anyone can submit" on public.scores for insert with check (true);

revoke all on public.scores from anon, authenticated;
grant select on public.scores to anon, authenticated;
grant insert (name, score, level) on public.scores to anon, authenticated;

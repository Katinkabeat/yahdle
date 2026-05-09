-- ============================================================
-- Yahdle — Solo daily results + streak support
--
-- Mirrors Snibble's `sn_daily_feeds` pattern: one row per user
-- per Atlantic-time calendar day. Streak is computed client-side
-- by walking dates backward (see src/hooks/useStreak.js).
--
-- Solo-only. Multiplayer results are tracked separately.
-- ============================================================

create table if not exists public.yahdle_solo_results (
  user_id      uuid not null references auth.users(id) on delete cascade,
  play_date    date not null,                 -- Atlantic-time YYYY-MM-DD
  score        int  not null default 0,
  completed_at timestamptz not null default now(),
  primary key (user_id, play_date)
);

create index if not exists yahdle_solo_results_user_idx
  on public.yahdle_solo_results(user_id);

alter table public.yahdle_solo_results enable row level security;

create policy "yahdle_solo_results read own" on public.yahdle_solo_results
  for select using (auth.uid() = user_id);
create policy "yahdle_solo_results insert own" on public.yahdle_solo_results
  for insert with check (auth.uid() = user_id);
create policy "yahdle_solo_results update own" on public.yahdle_solo_results
  for update using (auth.uid() = user_id);

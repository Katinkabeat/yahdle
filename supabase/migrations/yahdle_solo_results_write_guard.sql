-- ============================================================
-- Yahdle — server-side write guard for solo daily results (c237)
--
-- Closes the "midnight daily-reveal" loophole. The daily leaderboard
-- deliberately ungates past days (the c92 decision) — so once local
-- midnight (America/Halifax) passes, yesterday's board is readable by
-- everyone. The hole was on the WRITE side: yahdle_solo_results was
-- written by a direct client upsert whose play_date came straight from
-- the route param, guarded only by a "write your own rows" RLS policy
-- with NO check that play_date is actually today. A player who left
-- yesterday's puzzle open past midnight could submit a padded score
-- onto yesterday's board.
--
-- Unlike Snibble (which persists words incrementally and can protect a
-- cross-midnight finisher), Yahdle stores nothing until the game is
-- finished — it only ever writes the final score, all at once. So a
-- "yesterday" write after midnight is indistinguishable from padding.
-- The only airtight close is STRICT today-only: past days are immutable.
-- A player who finishes a puzzle after its day has ended isn't recorded;
-- the client shows a "this daily closed at midnight" note (see
-- SoloGamePage.jsx) rather than silently failing.
--
-- Mirrors Snibble's sn_daily_feeds_write_guard: the RPC is the only
-- writer, the direct-write RLS policies are dropped. Every Yahdle write
-- is a completion (terminal), so a single record RPC suffices — there's
-- no separate finalize step.
-- ============================================================

create or replace function public.yahdle_record_daily_solo(
  p_play_date date,
  p_score     int
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (timezone('America/Halifax', now()))::date;
  v_uid   uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'yahdle_record_daily_solo: not authenticated';
  end if;

  -- The guard. A solo result may only be recorded for the current
  -- Atlantic day. Past days are immutable (no after-midnight padding);
  -- future days can't be pre-seeded.
  if p_play_date <> v_today then
    raise exception 'yahdle_record_daily_solo: play_date % is not today (%); past/future writes are not allowed', p_play_date, v_today;
  end if;

  insert into public.yahdle_solo_results (user_id, play_date, score, completed_at)
  values (v_uid, p_play_date, coalesce(p_score, 0), now())
  on conflict (user_id, play_date) do update set
    score        = excluded.score,
    completed_at = coalesce(public.yahdle_solo_results.completed_at, now());
end;
$$;

revoke all on function public.yahdle_record_daily_solo(date, int) from public;
grant execute on function public.yahdle_record_daily_solo(date, int) to authenticated;

-- Lock the table to the RPC. Reads stay per-user (read own). No delete
-- policy exists, so deletes remain blocked by default.
drop policy if exists "yahdle_solo_results insert own" on public.yahdle_solo_results;
drop policy if exists "yahdle_solo_results update own" on public.yahdle_solo_results;

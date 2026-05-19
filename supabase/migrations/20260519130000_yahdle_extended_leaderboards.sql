-- ============================================================
-- Yahdle — Extended solo leaderboards (card c92)
--
-- Replaces yahdle_daily_leaderboard(date) with:
--   yahdle_solo_leaderboard(p_timeframe, p_date)  — top 10 for the window
--   yahdle_solo_my_rank(p_timeframe, p_date)      — caller's rank + score
--
-- p_timeframe: 'day' | 'week' | 'month' | 'all'
-- p_date: anchor date supplied by the client (Halifax-local today, or
--   any past day when on the Day tab with the date stepper). For
--   non-day timeframes the window is computed relative to p_date,
--   which lets the server stay timezone-agnostic.
--
-- For Day: score is the single daily score. Tie-break: completed_at ASC.
-- For Week/Month/All: score is SUM(score) over the window per user.
--   Tie-break: latest play in window ASC (earlier = wins).
-- ============================================================

-- Migration is purely additive: yahdle_daily_leaderboard stays alive so
-- the live site keeps working until the new client code is deployed.
-- A follow-up migration (yahdle_drop_daily_leaderboard.sql) drops it
-- once StatsPage.jsx is live on the new RPCs.

-- ── 1. Solo leaderboard ──────────────────────────────────────
create or replace function public.yahdle_solo_leaderboard(
  p_timeframe text,
  p_date      date default current_date
)
returns table (
  user_id      uuid,
  username     text,
  avatar_hue   int,
  score        int,
  completed_at timestamptz
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_start date;
  v_end   date;  -- exclusive
begin
  case p_timeframe
    when 'day'   then v_start := p_date;                            v_end := p_date + 1;
    when 'week'  then v_start := date_trunc('week',  p_date)::date; v_end := v_start + 7;
    when 'month' then v_start := date_trunc('month', p_date)::date; v_end := (v_start + interval '1 month')::date;
    when 'all'   then v_start := null;                              v_end := null;
    else raise exception 'Invalid p_timeframe: %', p_timeframe;
  end case;

  if p_timeframe = 'day' then
    return query
      select r.user_id, p.username, p.avatar_hue, r.score, r.completed_at
      from public.yahdle_solo_results r
      join public.profiles p on p.id = r.user_id
      where r.play_date = p_date
      order by r.score desc, r.completed_at asc
      limit 10;
  else
    return query
      select
        r.user_id,
        p.username,
        p.avatar_hue,
        sum(r.score)::int         as score,
        max(r.completed_at)       as completed_at
      from public.yahdle_solo_results r
      join public.profiles p on p.id = r.user_id
      where (v_start is null or r.play_date >= v_start)
        and (v_end   is null or r.play_date <  v_end)
      group by r.user_id, p.username, p.avatar_hue
      order by sum(r.score) desc, max(r.completed_at) asc
      limit 10;
  end if;
end;
$$;

revoke all on function public.yahdle_solo_leaderboard(text, date) from public;
grant execute on function public.yahdle_solo_leaderboard(text, date) to authenticated;

-- ── 2. My rank for the active window ─────────────────────────
create or replace function public.yahdle_solo_my_rank(
  p_timeframe text,
  p_date      date default current_date
)
returns table (rank int, score int)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_start date;
  v_end   date;
begin
  if v_uid is null then return; end if;

  case p_timeframe
    when 'day'   then v_start := p_date;                            v_end := p_date + 1;
    when 'week'  then v_start := date_trunc('week',  p_date)::date; v_end := v_start + 7;
    when 'month' then v_start := date_trunc('month', p_date)::date; v_end := (v_start + interval '1 month')::date;
    when 'all'   then v_start := null;                              v_end := null;
    else raise exception 'Invalid p_timeframe: %', p_timeframe;
  end case;

  if p_timeframe = 'day' then
    return query
      with ranked as (
        select
          r.user_id            as uid,
          r.score              as user_score,
          rank() over (order by r.score desc, r.completed_at asc) as rk
        from public.yahdle_solo_results r
        where r.play_date = p_date
      )
      select rk::int, user_score::int
      from ranked
      where uid = v_uid;
  else
    return query
      with totals as (
        select
          r.user_id            as uid,
          sum(r.score)::int    as total_score,
          max(r.completed_at)  as latest
        from public.yahdle_solo_results r
        where (v_start is null or r.play_date >= v_start)
          and (v_end   is null or r.play_date <  v_end)
        group by r.user_id
      ),
      ranked as (
        select
          uid,
          total_score,
          rank() over (order by total_score desc, latest asc) as rk
        from totals
      )
      select rk::int, total_score::int
      from ranked
      where uid = v_uid;
  end if;
end;
$$;

revoke all on function public.yahdle_solo_my_rank(text, date) from public;
grant execute on function public.yahdle_solo_my_rank(text, date) to authenticated;

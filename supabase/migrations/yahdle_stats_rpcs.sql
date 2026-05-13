-- ============================================================
-- Yahdle — Stats RPCs (card #46)
--
--   yahdle_daily_leaderboard(date)  — ranked solo daily results
--   yahdle_my_mp_stats()            — 1v1 multiplayer aggregates
--
-- Both SECDEF so they can read across users / bypass per-user RLS.
-- Daily streak lives elsewhere (already shown in the lobby) so it is
-- intentionally not duplicated here.
-- ============================================================

-- ── 1. Daily leaderboard ─────────────────────────────────────
drop function if exists public.yahdle_daily_leaderboard(date);

create or replace function public.yahdle_daily_leaderboard(p_date date)
returns table (
  user_id      uuid,
  username     text,
  avatar_hue   int,
  score        int,
  completed_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select
    r.user_id,
    p.username,
    p.avatar_hue,
    r.score,
    r.completed_at
  from public.yahdle_solo_results r
  join public.profiles p on p.id = r.user_id
  where r.play_date = p_date
  order by r.score desc, r.completed_at asc;
$$;

revoke all on function public.yahdle_daily_leaderboard(date) from public;
grant execute on function public.yahdle_daily_leaderboard(date) to authenticated;

-- ── 2. My multiplayer stats ──────────────────────────────────
-- Returns 1v1 (and future N-player) aggregates for the calling user.
-- All counts/sums limited to FINISHED games to keep stats stable.
drop function if exists public.yahdle_my_mp_stats();

create or replace function public.yahdle_my_mp_stats()
returns table (
  games_played       int,
  wins               int,
  losses             int,
  ties               int,
  best_score         int,
  avg_score          numeric,
  category_bests     jsonb
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  return query
  with my_finished as (
    select pl.total_score, pl.scores
    from public.yahdle_players pl
    join public.yahdle_games   g on g.id = pl.game_id
    where pl.user_id = v_uid
      and g.status = 'finished'
  ),
  per_cat as (
    select
      cat.key                              as category_id,
      max((cat.value->>'score')::int)      as best
    from my_finished mf,
         lateral jsonb_each(mf.scores) cat
    where (cat.value->>'score') is not null
    group by cat.key
  ),
  totals as (
    select
      coalesce(sum(m.wins),   0)::int as w,
      coalesce(sum(m.losses), 0)::int as l,
      coalesce(sum(m.ties),   0)::int as t
    from public.yahdle_matchups m
    where m.player_id = v_uid
  )
  select
    (select count(*) from my_finished)::int                                  as games_played,
    totals.w                                                                 as wins,
    totals.l                                                                 as losses,
    totals.t                                                                 as ties,
    coalesce((select max(total_score) from my_finished), 0)::int             as best_score,
    coalesce((select round(avg(total_score)::numeric, 1) from my_finished),
             0::numeric)                                                     as avg_score,
    coalesce(
      (select jsonb_object_agg(category_id, best) from per_cat),
      '{}'::jsonb
    )                                                                        as category_bests
  from totals;
end;
$$;

revoke all on function public.yahdle_my_mp_stats() from public;
grant execute on function public.yahdle_my_mp_stats() to authenticated;

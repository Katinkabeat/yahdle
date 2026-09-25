-- ============================================================
-- Yahdle — Test Accounts group (card c332)
--
-- Members of the shared "test-accounts" group (public.sq_is_test_account /
-- public.sq_test_account_ids, already live) get these carve-outs:
--
--   1. Solo leaderboard/rank never surface a member's result. Excluded in
--      both the 'day' and window branches of yahdle_solo_leaderboard and
--      yahdle_solo_my_rank, plus the legacy yahdle_daily_leaderboard(date)
--      (kept alive but unused by the client — StatsPage.jsx calls the
--      extended pair). A member calling yahdle_solo_my_rank for themself
--      now gets an empty result — their row is excluded from the ranked
--      CTE, so there's no rank to report, which is correct.
--
--   2. Any multiplayer game with a member seated is dropped from BOTH
--      seated players' stats (games, wins, losses, ties, best, average):
--        - yahdle_finalize_game (live N-player version, last touched by
--          yahdle_forfeit_continue.sql) skips writing yahdle_matchups
--          entirely when any seated player (winner, loser, or forfeiter)
--          is a member. Everything else — game status, winner_user_id,
--          is_tie, per-player is_winner — is untouched, so the game still
--          shows correctly in the lobby; it just never becomes a stat.
--        - yahdle_my_mp_stats() additionally excludes, belt-and-braces:
--          games with a member seated from the games/best/avg CTE
--          (my_finished), and matchup rows against a member opponent from
--          the win/loss/tie totals (covers any matchup row written before
--          this migration, or by a path other than finalize_game).
--        - yahdle_record_matchup (legacy 2-player helper — no longer
--          called by the live finalize/forfeit/claim paths, but still
--          directly executable) now early-returns a no-op if either
--          player is a member.
--
--   3. Members can replay the daily as often as they like; a finished
--      replay OVERWRITES that day's result. yahdle_record_daily_solo's
--      existing ON CONFLICT DO UPDATE already overwrites the score on
--      every call (no write-guard to lift here, unlike Rungles/Snibble) —
--      the only gap was completed_at, which stayed pinned to the first
--      play via COALESCE. For a member it's now refreshed to now() on
--      every write, so it reflects the latest run; non-members keep the
--      original COALESCE (first completed_at wins). Membership is
--      re-checked server-side on every call, never trusting the client —
--      see SoloGamePage.jsx for the client-side replay UX that clears
--      local/session storage and lets the normal finish path record again.
-- ============================================================

-- ── 1. Solo leaderboard — exclude members ─────────────────────
CREATE OR REPLACE FUNCTION public.yahdle_solo_leaderboard(p_timeframe text, p_date date DEFAULT CURRENT_DATE)
 RETURNS TABLE(user_id uuid, username text, avatar_hue integer, score integer, completed_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
        and not public.sq_is_test_account(r.user_id)  -- c332
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
        and not public.sq_is_test_account(r.user_id)  -- c332
      group by r.user_id, p.username, p.avatar_hue
      order by sum(r.score) desc, max(r.completed_at) asc
      limit 10;
  end if;
end;
$function$;

-- ── 2. My rank — same exclusion, identical tie-break ──────────
CREATE OR REPLACE FUNCTION public.yahdle_solo_my_rank(p_timeframe text, p_date date DEFAULT CURRENT_DATE)
 RETURNS TABLE(rank integer, score integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
          and not public.sq_is_test_account(r.user_id)  -- c332: a member never
          -- occupies a rank slot; if the caller IS a member this also means
          -- `uid = v_uid` below matches nothing, so they get an empty result.
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
          and not public.sq_is_test_account(r.user_id)  -- c332
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
$function$;

-- ── 3. Legacy daily leaderboard — likely uncalled, kept alive ──
CREATE OR REPLACE FUNCTION public.yahdle_daily_leaderboard(p_date date)
 RETURNS TABLE(user_id uuid, username text, avatar_hue integer, score integer, completed_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    r.user_id,
    p.username,
    p.avatar_hue,
    r.score,
    r.completed_at
  from public.yahdle_solo_results r
  join public.profiles p on p.id = r.user_id
  where r.play_date = p_date
    and not public.sq_is_test_account(r.user_id)  -- c332
  order by r.score desc, r.completed_at asc;
$function$;

-- ── 4. Multiplayer stats — exclude games/matchups with a member ──
CREATE OR REPLACE FUNCTION public.yahdle_my_mp_stats()
 RETURNS TABLE(games_played integer, wins integer, losses integer, ties integer, best_score integer, avg_score numeric, category_bests jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      -- c332: drop any game with a member seated (any seat, not just mine)
      -- from games/best/avg entirely.
      and not exists (
        select 1 from public.yahdle_players pl2
        where pl2.game_id = pl.game_id
          and public.sq_is_test_account(pl2.user_id)
      )
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
      -- c332 belt-and-braces: yahdle_finalize_game no longer writes
      -- matchup rows for a member-seated game, but skip any opponent who
      -- is a member here too, in case a row predates this migration or
      -- was written by a path other than finalize_game.
      and not public.sq_is_test_account(m.opponent_id)
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
$function$;

-- ── 5. Finalize game — skip matchup writes when a member is seated ──
CREATE OR REPLACE FUNCTION public.yahdle_finalize_game(p_game_id uuid, p_forced_losers uuid[] DEFAULT '{}'::uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_max     int;
  v_winners int;
  v_winner  uuid;
  a record; b record;
begin
  select max(total_score) into v_max
    from public.yahdle_players
   where game_id = p_game_id and not forfeited and not (user_id = any(p_forced_losers));

  update public.yahdle_players
     set is_winner = (v_max is not null and total_score = v_max
                      and not forfeited and not (user_id = any(p_forced_losers)))
   where game_id = p_game_id;

  select count(*) into v_winners from public.yahdle_players where game_id = p_game_id and is_winner;
  select user_id into v_winner from public.yahdle_players where game_id = p_game_id and is_winner limit 1;

  update public.yahdle_games
     set status = 'finished', finished_at = now(),
         winner_user_id = case when v_winners = 1 then v_winner else null end,
         is_tie = (v_winners > 1)
   where id = p_game_id;

  -- c332: if ANY seated player (winner, loser, or forfeiter) is a
  -- test-account member, this game is ignored for stats on both/all
  -- sides — skip the matchup writes entirely. Status/winner/is_tie above
  -- are untouched, so the game still shows correctly in the lobby.
  if exists (
    select 1 from public.yahdle_players
    where game_id = p_game_id and public.sq_is_test_account(user_id)
  ) then
    return;
  end if;

  -- Pairwise matchups: top-group players record a win vs everyone,
  -- everyone else (incl. forfeiters) records a loss. Never ties.
  for a in select user_id, is_winner from public.yahdle_players where game_id = p_game_id loop
    for b in select user_id from public.yahdle_players where game_id = p_game_id and user_id <> a.user_id loop
      insert into public.yahdle_matchups (player_id, opponent_id, wins, losses, ties)
      values (a.user_id, b.user_id, case when a.is_winner then 1 else 0 end, case when a.is_winner then 0 else 1 end, 0)
      on conflict (player_id, opponent_id) do update set
        wins = yahdle_matchups.wins + excluded.wins,
        losses = yahdle_matchups.losses + excluded.losses,
        updated_at = now();
    end loop;
  end loop;
end;
$function$;

-- ── 6. Legacy pairwise matchup helper — no-op for a member seat ──
-- No longer called by the live finalize/forfeit/claim paths (they all
-- route through yahdle_finalize_game above), but it's still directly
-- executable, so belt-and-braces: early-return without writing anything
-- if either player is a member.
CREATE OR REPLACE FUNCTION public.yahdle_record_matchup(p_player_a uuid, p_player_b uuid, p_winner uuid, p_tie boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  a_win int := case when p_tie then 0 when p_winner = p_player_a then 1 else 0 end;
  a_los int := case when p_tie then 0 when p_winner = p_player_b then 1 else 0 end;
  a_tie int := case when p_tie then 1 else 0 end;
begin
  -- c332: either seat a member → no-op, no matchup rows written.
  if public.sq_is_test_account(p_player_a) or public.sq_is_test_account(p_player_b) then
    return;
  end if;

  insert into public.yahdle_matchups (player_id, opponent_id, wins, losses, ties)
  values (p_player_a, p_player_b, a_win, a_los, a_tie)
  on conflict (player_id, opponent_id) do update set
    wins = yahdle_matchups.wins + excluded.wins,
    losses = yahdle_matchups.losses + excluded.losses,
    ties = yahdle_matchups.ties + excluded.ties,
    updated_at = now();

  insert into public.yahdle_matchups (player_id, opponent_id, wins, losses, ties)
  values (p_player_b, p_player_a, a_los, a_win, a_tie)
  on conflict (player_id, opponent_id) do update set
    wins = yahdle_matchups.wins + excluded.wins,
    losses = yahdle_matchups.losses + excluded.losses,
    ties = yahdle_matchups.ties + excluded.ties,
    updated_at = now();
end;
$function$;

-- ── 7. Daily solo write — refresh completed_at on a member replay ──
CREATE OR REPLACE FUNCTION public.yahdle_record_daily_solo(p_play_date date, p_score integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_today date := (timezone('America/Halifax', now()))::date;
  v_uid   uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'yahdle_record_daily_solo: not authenticated';
  end if;
  if p_play_date <> v_today then
    raise exception 'yahdle_record_daily_solo: play_date % is not today (%); past/future writes are not allowed', p_play_date, v_today;
  end if;
  insert into public.yahdle_solo_results (user_id, play_date, score, completed_at)
  values (v_uid, p_play_date, coalesce(p_score, 0), now())
  on conflict (user_id, play_date) do update set
    score        = excluded.score,
    -- c332: a test-account member can replay the daily as often as they
    -- like; each finished replay overwrites the row AND refreshes
    -- completed_at to the latest run. Non-members keep the original
    -- behaviour — completed_at is pinned to the first play.
    completed_at = case
      when public.sq_is_test_account(v_uid) then now()
      else coalesce(public.yahdle_solo_results.completed_at, now())
    end;
end;
$function$;

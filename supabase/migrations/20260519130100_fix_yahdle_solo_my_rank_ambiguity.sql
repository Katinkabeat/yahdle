-- ============================================================
-- Yahdle — Fix column ambiguity in yahdle_solo_my_rank
--
-- The previous version aliased CTE columns as `score` / `user_id`,
-- which collided with the function's RETURNS TABLE column names
-- ("column reference 'score' is ambiguous"). Rename CTE columns to
-- `user_score` / `uid` so the final SELECT's column names are
-- unambiguous against the OUT params.
-- ============================================================

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

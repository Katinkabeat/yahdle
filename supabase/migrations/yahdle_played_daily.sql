-- ============================================================
-- Yahdle — played_daily check function for the hub daily-reminder
-- registry. Returns true iff the user has a yahdle_solo_results
-- row for the given Atlantic-date ymd.
-- ============================================================

create or replace function public.yahdle_played_daily(uid uuid, ymd date)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.yahdle_solo_results
    where user_id = uid and play_date = ymd
  );
$$;

grant execute on function public.yahdle_played_daily(uuid, date)
  to authenticated, service_role;

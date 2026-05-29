-- ============================================================
-- Yahdle — N-player rematch fix (card c136 regression)
--
-- The original yahdle_rematch (yahdle_multiplayer_rpcs.sql) called
-- yahdle_create_game(v_opponent) with a single uuid. The N-player
-- migration (yahdle_nplayer_engine.sql) DROPPED that overload and
-- replaced it with yahdle_create_game(uuid[], int), so rematch now
-- errors at runtime: "function public.yahdle_create_game(uuid) does
-- not exist".
--
-- Rewritten to be N-player aware: re-invite the same set of opponents
-- at the same player count. The caller becomes the creator (seat 0)
-- and a fresh coin flip / auto-start happens once everyone joins.
-- Idempotent.
-- ============================================================
create or replace function public.yahdle_rematch(
  p_game_id uuid
) returns uuid language plpgsql security definer as $$
declare
  v_uid    uuid := auth.uid();
  v_game   record;
  v_others uuid[];
  v_n      int;
begin
  select * into v_game from public.yahdle_games where id = p_game_id;
  if not found or v_game.status <> 'finished' then
    raise exception 'Original game not finished';
  end if;
  if not exists (
    select 1 from public.yahdle_players where game_id = p_game_id and user_id = v_uid
  ) then
    raise exception 'Not a participant';
  end if;

  -- Same opponents, same player count. Caller is seated as creator.
  select array_agg(user_id) into v_others
    from public.yahdle_players
   where game_id = p_game_id and user_id <> v_uid;

  v_n := coalesce(array_length(v_others, 1), 0) + 1;

  return public.yahdle_create_game(v_others, v_n);
end;
$$;

grant execute on function public.yahdle_rematch(uuid) to authenticated;

-- c239 follow-up: only start the 12h nudge cooldown once the push actually
-- delivers. Previously yahdle_nudge stamped last_nudged_at up-front, so a
-- failed push (dead subscription / cold-start timeout) locked the game for
-- 12h — and the nudger's retries then hit "Already nudged recently" instead
-- of a real retry. Now eligibility and stamping are separate calls: the
-- client stamps (yahdle_mark_nudged) ONLY after the push succeeds.

-- yahdle_nudge: validate eligibility + return who to notify. No longer stamps.
create or replace function public.yahdle_nudge(
  p_game_id uuid
) returns uuid language plpgsql security definer as $$
declare
  v_uid      uuid := auth.uid();
  v_game     record;
  v_me       record;
  v_target   uuid;
  v_cooldown constant interval := interval '12 hours';
begin
  select * into v_game from public.yahdle_games where id = p_game_id;
  if not found or v_game.status <> 'active' then raise exception 'Game not active'; end if;

  select * into v_me from public.yahdle_players where game_id = p_game_id and user_id = v_uid;
  if not found then raise exception 'Not a participant'; end if;
  if v_me.player_index = v_game.current_player_idx then
    raise exception 'It is your turn — nothing to nudge';
  end if;

  if v_game.last_activity_at > now() - v_cooldown then
    raise exception 'Too soon — give them time to move';
  end if;
  if v_game.last_nudged_at is not null and v_game.last_nudged_at > now() - v_cooldown then
    raise exception 'Already nudged recently';
  end if;

  select user_id into v_target from public.yahdle_players
   where game_id = p_game_id and player_index = v_game.current_player_idx;
  return v_target;
end;
$$;

-- yahdle_mark_nudged: stamp the 12h cooldown. Called by the client only after
-- the nudge push has been delivered, so a failed send never locks the game.
-- Re-checks the same eligibility gate (participant, not the current player) so
-- it can't be used to stamp a cooldown out of context.
create or replace function public.yahdle_mark_nudged(
  p_game_id uuid
) returns void language plpgsql security definer as $$
declare
  v_uid uuid := auth.uid();
begin
  if not exists (
    select 1
      from public.yahdle_players p
      join public.yahdle_games   g on g.id = p.game_id
     where p.game_id = p_game_id
       and p.user_id = v_uid
       and g.status = 'active'
       and p.player_index <> g.current_player_idx
  ) then
    raise exception 'Not eligible to mark nudged';
  end if;
  update public.yahdle_games set last_nudged_at = now() where id = p_game_id;
end;
$$;

grant execute on function public.yahdle_nudge(uuid)       to authenticated;
grant execute on function public.yahdle_mark_nudged(uuid) to authenticated;

-- Yahdle "nudge" — lets a waiting player remind the current player that
-- it's their turn. Mirrors Wordy's nudge feature.
--
-- Cooldown is enforced server-side: a nudge only fires when the current
-- turn has been idle for > 12h (last_activity_at, the turn-start proxy)
-- AND no nudge has gone out in the last 12h (last_nudged_at). Updating
-- last_nudged_at on yahdle_games does NOT bump last_activity_at — that
-- trigger only fires on yahdle_players / yahdle_turn_state writes — so the
-- turn-age gate stays accurate.

alter table public.yahdle_games
  add column if not exists last_nudged_at timestamptz;

-- Stamps last_nudged_at and returns the user_id to notify (the current
-- player). Raises on ineligibility so the client can surface the reason.
-- SECDEF because there is no direct UPDATE policy on yahdle_games.
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
  select * into v_game from public.yahdle_games where id = p_game_id for update;
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

  update public.yahdle_games set last_nudged_at = now() where id = p_game_id;

  select user_id into v_target from public.yahdle_players
   where game_id = p_game_id and player_index = v_game.current_player_idx;
  return v_target;
end;
$$;

grant execute on function public.yahdle_nudge(uuid) to authenticated;

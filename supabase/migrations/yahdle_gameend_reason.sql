-- Yahdle — end_reason marker for game-end push (c188).
--
-- Yahdle ALREADY pushes on game finish (on_yahdle_game_finished trigger +
-- the game_finished handler). The only gap was that a claim-inactive-win and
-- a voluntary forfeit were indistinguishable on the row, so a claimed-against
-- player got told "You forfeited the game." This adds the end_reason marker
-- (matching the unified SQ contract) so the edge fn can word each correctly.
-- No trigger change needed — the existing trigger already posts row_to_json(NEW),
-- which now carries end_reason.

ALTER TABLE public.yahdle_games
  ADD COLUMN IF NOT EXISTS end_reason TEXT;

-- ── Forfeit: stamp end_reason='forfeit' ───────────────────────
create or replace function public.yahdle_forfeit_game(p_game_id uuid)
returns void language plpgsql security definer as $$
declare
  v_uid uuid := auth.uid(); v_game record; v_me record; v_active int;
begin
  select * into v_game from public.yahdle_games where id = p_game_id for update;
  if not found or v_game.status <> 'active' then raise exception 'Game not active'; end if;
  select * into v_me from public.yahdle_players where game_id = p_game_id and user_id = v_uid;
  if not found then raise exception 'Not a participant'; end if;
  if v_me.forfeited then raise exception 'You already left this game'; end if;

  update public.yahdle_players set forfeited = true, is_winner = false where id = v_me.id;
  update public.yahdle_turn_state set faces='{}', builder='[]'::jsonb, rolls_used=0, updated_at=now()
   where game_id = p_game_id and user_id = v_uid;
  update public.yahdle_games set forfeit_user_id = v_uid, end_reason = 'forfeit', last_activity_at = now() where id = p_game_id;

  select count(*) into v_active from public.yahdle_players where game_id = p_game_id and not forfeited;

  if v_active <= 1 then
    perform public.yahdle_finalize_game(p_game_id);   -- last one standing wins
  elsif v_me.player_index = v_game.current_player_idx then
    perform public.yahdle_advance_turn(p_game_id);    -- it was my turn → hand off
  end if;
end;
$$;
grant execute on function public.yahdle_forfeit_game(uuid) to authenticated;

-- ── Claim inactive: stamp end_reason='claim' ──────────────────
create or replace function public.yahdle_claim_inactive_win(p_game_id uuid)
returns void language plpgsql security definer as $$
declare
  v_uid uuid := auth.uid(); v_game record; v_me record; v_stalled record; v_active int;
begin
  select * into v_game from public.yahdle_games where id = p_game_id for update;
  if not found or v_game.status <> 'active' then raise exception 'Game not active'; end if;
  select * into v_me from public.yahdle_players where game_id = p_game_id and user_id = v_uid;
  if not found or v_me.forfeited then raise exception 'Not an active participant'; end if;
  if v_me.player_index = v_game.current_player_idx then raise exception 'It is your turn — you cannot claim'; end if;
  if v_game.last_activity_at > now() - interval '7 days' then raise exception 'Opponent still has time'; end if;

  select * into v_stalled from public.yahdle_players
   where game_id = p_game_id and player_index = v_game.current_player_idx;
  update public.yahdle_players set forfeited = true, is_winner = false where id = v_stalled.id;
  update public.yahdle_turn_state set faces='{}', builder='[]'::jsonb, rolls_used=0, updated_at=now()
   where game_id = p_game_id and user_id = v_stalled.user_id;
  update public.yahdle_games set forfeit_user_id = v_stalled.user_id, end_reason = 'claim', last_activity_at = now() where id = p_game_id;

  select count(*) into v_active from public.yahdle_players where game_id = p_game_id and not forfeited;
  if v_active <= 1 then
    perform public.yahdle_finalize_game(p_game_id);
  else
    perform public.yahdle_advance_turn(p_game_id);    -- skip past the booted player
  end if;
end;
$$;
grant execute on function public.yahdle_claim_inactive_win(uuid) to authenticated;

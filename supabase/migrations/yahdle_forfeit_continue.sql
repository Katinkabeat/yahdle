-- ============================================================
-- Yahdle — forfeit-continue (c136 follow-up)
--
-- Change: in a 3–4 player game, a forfeit no longer ends the game.
-- The forfeiter is marked out (a loss, recorded at game end), their
-- seat is skipped in the turn rotation, and the rest play on. Only when
-- ≤1 active player remains does the game finish (last one standing wins
-- — preserves 2-player behavior: a forfeit there ends it). The 7-day
-- "claim inactive" path works the same way: it boots just the idle
-- current player (a loss) and lets the others continue.
--
-- Adds yahdle_players.forfeited. finalize/advance now treat forfeited
-- players as out. Idempotent + safe to re-run.
-- ============================================================

alter table public.yahdle_players
  add column if not exists forfeited boolean not null default false;

-- ── Finalize: winner = top score among players still in it ───
create or replace function public.yahdle_finalize_game(
  p_game_id       uuid,
  p_forced_losers uuid[] default '{}'
) returns void language plpgsql security definer as $$
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
$$;

-- ── Advance turn: skip forfeited seats ──────────────────────
create or replace function public.yahdle_advance_turn(p_game_id uuid)
returns void language plpgsql security definer as $$
declare
  v_game record; v_n int; v_total int := public.yahdle_total_turns();
  v_cur record; v_next_idx int; v_next_filled int; v_all_done boolean;
  i int; v_cand int; v_found boolean;
begin
  select * into v_game from public.yahdle_games where id = p_game_id for update;
  v_n := v_game.max_players;

  -- Reset the player who just played (the seat current_player_idx points at).
  select * into v_cur from public.yahdle_players
   where game_id = p_game_id and player_index = v_game.current_player_idx;
  if found then
    update public.yahdle_turn_state
       set faces='{}', builder='[]'::jsonb, rolls_used=0, updated_at=now()
     where game_id = p_game_id and user_id = v_cur.user_id;
  end if;

  -- Done when every NON-forfeited player has filled all 12 categories.
  -- (bool_and over zero active rows is null → also finish.)
  select bool_and((select count(*) from jsonb_object_keys(p.scores)) >= v_total)
    into v_all_done
    from public.yahdle_players p where p.game_id = p_game_id and not p.forfeited;
  if v_all_done is not false then
    perform public.yahdle_finalize_game(p_game_id);
    return;
  end if;

  -- Hand to the next NON-forfeited seat.
  v_found := false;
  for i in 1 .. v_n loop
    v_cand := (v_game.current_player_idx + i) % v_n;
    perform 1 from public.yahdle_players
      where game_id = p_game_id and player_index = v_cand and not forfeited;
    if found then v_next_idx := v_cand; v_found := true; exit; end if;
  end loop;
  if not v_found then
    perform public.yahdle_finalize_game(p_game_id);
    return;
  end if;

  select (select count(*) from jsonb_object_keys(p.scores))
    into v_next_filled
    from public.yahdle_players p
   where p.game_id = p_game_id and p.player_index = v_next_idx;

  update public.yahdle_games
     set current_player_idx = v_next_idx,
         current_turn       = v_next_filled + 1,
         last_activity_at   = now()
   where id = p_game_id;
end;
$$;

-- ── Forfeit: mark out, others continue (≤1 left → finish) ────
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
  update public.yahdle_games set forfeit_user_id = v_uid, last_activity_at = now() where id = p_game_id;

  select count(*) into v_active from public.yahdle_players where game_id = p_game_id and not forfeited;

  if v_active <= 1 then
    perform public.yahdle_finalize_game(p_game_id);   -- last one standing wins
  elsif v_me.player_index = v_game.current_player_idx then
    perform public.yahdle_advance_turn(p_game_id);    -- it was my turn → hand off
  end if;
end;
$$;
grant execute on function public.yahdle_forfeit_game(uuid) to authenticated;

-- ── Claim inactive: boot the idle current player, others continue ──
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
  update public.yahdle_games set forfeit_user_id = v_stalled.user_id, last_activity_at = now() where id = p_game_id;

  select count(*) into v_active from public.yahdle_players where game_id = p_game_id and not forfeited;
  if v_active <= 1 then
    perform public.yahdle_finalize_game(p_game_id);
  else
    perform public.yahdle_advance_turn(p_game_id);    -- skip past the booted player
  end if;
end;
$$;
grant execute on function public.yahdle_claim_inactive_win(uuid) to authenticated;

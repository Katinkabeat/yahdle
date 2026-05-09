-- ============================================================
-- Yahdle — Multiplayer RPCs (v1)
--
-- All game state mutations go through SECURITY DEFINER functions
-- so the server owns RNG, turn advancement, scoring validation,
-- and matchup updates. Direct table writes are blocked by RLS.
--
-- Category fit (12 different rules) is trusted to the client to
-- keep this file tractable. Server still verifies: word can be
-- spelled from current dice, category isn't already filled, score
-- matches the deterministic letter-value sum, it's actually your
-- turn. So the worst-case "cheat" is banking a word in a category
-- it doesn't fit — visible to the opponent in the popup.
-- ============================================================

-- ── 0. Constants & helpers ───────────────────────────────────

-- Yahdle dice config (must match src/lib/dice.js).
-- Concentrated 18-letter alphabet, 8 faces per die, 6 dice.
create or replace function public.yahdle_dice_faces()
returns text[][] language sql immutable as $$
  select array[
    array['A','E','I','T','R','N','L','D'],
    array['A','E','O','T','R','S','N','H'],
    array['A','I','U','T','S','N','L','M'],
    array['A','E','O','U','R','S','L','C'],
    array['E','I','O','U','T','R','P','B'],
    array['E','I','O','S','N','L','W','G']
  ]::text[][]
$$;

create or replace function public.yahdle_die_count()
returns int language sql immutable as $$ select 6 $$;

create or replace function public.yahdle_total_turns()
returns int language sql immutable as $$ select 12 $$;

create or replace function public.yahdle_rolls_per_turn()
returns int language sql immutable as $$ select 3 $$;

-- Scrabble letter values (must match src/lib/scoring.js LETTER_VALUES).
create or replace function public.yahdle_letter_value(p_ch text)
returns int language sql immutable as $$
  select case upper(p_ch)
    when 'A' then 1 when 'B' then 3 when 'C' then 3 when 'D' then 2
    when 'E' then 1 when 'F' then 4 when 'G' then 2 when 'H' then 4
    when 'I' then 1 when 'J' then 8 when 'K' then 5 when 'L' then 1
    when 'M' then 3 when 'N' then 1 when 'O' then 1 when 'P' then 3
    when 'Q' then 10 when 'R' then 1 when 'S' then 1 when 'T' then 1
    when 'U' then 1 when 'V' then 4 when 'W' then 4 when 'X' then 8
    when 'Y' then 4 when 'Z' then 10
    else 0
  end
$$;

create or replace function public.yahdle_word_score(p_word text)
returns int language plpgsql immutable as $$
declare
  total int := 0;
  ch    text;
begin
  for i in 1 .. char_length(p_word) loop
    ch := substr(p_word, i, 1);
    total := total + public.yahdle_letter_value(ch);
  end loop;
  return total;
end;
$$;

-- Verify the word can be spelled from the supplied face array,
-- consuming each die at most once. Mirrors isSpellableFromFaces.
create or replace function public.yahdle_is_spellable(
  p_word  text,
  p_faces text[]
) returns boolean language plpgsql immutable as $$
declare
  remaining text[] := array(select upper(unnest(p_faces)));
  ch        text;
  idx       int;
begin
  if char_length(p_word) > coalesce(array_length(p_faces, 1), 0) then
    return false;
  end if;
  for i in 1 .. char_length(p_word) loop
    ch := upper(substr(p_word, i, 1));
    idx := array_position(remaining, ch);
    if idx is null then return false; end if;
    remaining[idx] := '_';   -- consume
  end loop;
  return true;
end;
$$;

-- Roll a single die using server-side random(). Returns the chosen face.
create or replace function public.yahdle_roll_one_die(p_die_idx int)
returns text language plpgsql volatile as $$
declare
  faces  text[];
  n_faces int;
begin
  faces   := (public.yahdle_dice_faces())[p_die_idx + 1];
  n_faces := array_length(faces, 1);
  return faces[1 + floor(random() * n_faces)::int];
end;
$$;

-- ── 1. Create / accept / decline ─────────────────────────────

create or replace function public.yahdle_create_game(
  p_invited_user_id uuid
) returns uuid language plpgsql security definer as $$
declare
  v_game_id uuid;
  v_uid     uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if p_invited_user_id is null or p_invited_user_id = v_uid then
    raise exception 'Invalid opponent';
  end if;

  insert into public.yahdle_games (created_by, invited_user_id, status)
  values (v_uid, p_invited_user_id, 'waiting')
  returning id into v_game_id;

  -- Creator is player_index 0 by default; coin flip happens at accept.
  insert into public.yahdle_players (game_id, user_id, player_index)
  values (v_game_id, v_uid, 0);

  insert into public.yahdle_turn_state (game_id, user_id)
  values (v_game_id, v_uid);

  return v_game_id;
end;
$$;

grant execute on function public.yahdle_create_game(uuid) to authenticated;

create or replace function public.yahdle_accept_invite(
  p_game_id uuid
) returns void language plpgsql security definer as $$
declare
  v_uid       uuid := auth.uid();
  v_game      record;
  v_first_idx int;
begin
  select * into v_game from public.yahdle_games where id = p_game_id for update;
  if not found then raise exception 'Game not found'; end if;
  if v_game.status <> 'waiting' then raise exception 'Game already started or finished'; end if;
  if v_game.invited_user_id is null or v_game.invited_user_id <> v_uid then
    raise exception 'Not your invite';
  end if;

  -- Coin flip for who plays first.
  v_first_idx := floor(random() * 2)::int;

  insert into public.yahdle_players (game_id, user_id, player_index)
  values (p_game_id, v_uid, 1);

  insert into public.yahdle_turn_state (game_id, user_id)
  values (p_game_id, v_uid);

  update public.yahdle_games
  set status             = 'active',
      joined_at          = now(),
      current_player_idx = v_first_idx,
      current_turn       = 1,
      last_activity_at   = now()
  where id = p_game_id;
end;
$$;

grant execute on function public.yahdle_accept_invite(uuid) to authenticated;

create or replace function public.yahdle_decline_invite(
  p_game_id uuid
) returns void language plpgsql security definer as $$
declare
  v_uid uuid := auth.uid();
begin
  delete from public.yahdle_games
  where id = p_game_id
    and status = 'waiting'
    and invited_user_id = v_uid;
  if not found then raise exception 'Invite not found'; end if;
end;
$$;

grant execute on function public.yahdle_decline_invite(uuid) to authenticated;

-- Creator cancels their own pending invite before opponent accepts.
create or replace function public.yahdle_cancel_invite(
  p_game_id uuid
) returns void language plpgsql security definer as $$
begin
  delete from public.yahdle_games
  where id = p_game_id
    and status = 'waiting'
    and created_by = auth.uid();
  if not found then raise exception 'Invite not found or already started'; end if;
end;
$$;

grant execute on function public.yahdle_cancel_invite(uuid) to authenticated;

-- ── 2. Internal helpers: whose turn / load player ────────────

create or replace function public.yahdle_assert_my_turn(
  p_game_id uuid
) returns record language plpgsql security definer as $$
declare
  v_uid    uuid := auth.uid();
  v_game   record;
  v_player record;
  v_state  record;
  result   record;
begin
  select * into v_game from public.yahdle_games where id = p_game_id for update;
  if not found then raise exception 'Game not found'; end if;
  if v_game.status <> 'active' then raise exception 'Game not active'; end if;

  select * into v_player from public.yahdle_players where game_id = p_game_id and user_id = v_uid;
  if not found then raise exception 'Not a participant'; end if;
  if v_player.player_index <> v_game.current_player_idx then
    raise exception 'Not your turn';
  end if;

  select * into v_state from public.yahdle_turn_state where game_id = p_game_id and user_id = v_uid;
  if not found then raise exception 'Turn state missing'; end if;

  select v_game as game, v_player as player, v_state as state into result;
  return result;
end;
$$;

-- ── 3. Roll dice ─────────────────────────────────────────────

create or replace function public.yahdle_roll_dice(
  p_game_id uuid
) returns text[] language plpgsql security definer as $$
declare
  v_uid     uuid := auth.uid();
  v_state   record;
  v_game    record;
  v_player  record;
  v_faces   text[];
  v_builder jsonb;
  v_keep    boolean[];
  v_n       int := public.yahdle_die_count();
  i         int;
  builder_die int;
  arr       jsonb;
begin
  select * into v_game from public.yahdle_games where id = p_game_id for update;
  if not found then raise exception 'Game not found'; end if;
  if v_game.status <> 'active' then raise exception 'Game not active'; end if;

  select * into v_player from public.yahdle_players where game_id = p_game_id and user_id = v_uid;
  if not found or v_player.player_index <> v_game.current_player_idx then
    raise exception 'Not your turn';
  end if;

  select * into v_state from public.yahdle_turn_state where game_id = p_game_id and user_id = v_uid for update;
  if v_state.rolls_used >= public.yahdle_rolls_per_turn() then
    raise exception 'No rolls remaining this turn';
  end if;

  -- Determine which dice keep their face (those parked in the builder).
  v_keep := array_fill(false, array[v_n]);
  v_builder := v_state.builder;
  for i in 0 .. coalesce(jsonb_array_length(v_builder), 0) - 1 loop
    builder_die := (v_builder -> i ->> 'dieIdx')::int;
    if builder_die between 0 and v_n - 1 then
      v_keep[builder_die + 1] := true;
    end if;
  end loop;

  -- Roll un-kept dice; preserve kept dice's existing face.
  v_faces := coalesce(v_state.faces, array_fill(null::text, array[v_n]));
  if coalesce(array_length(v_faces, 1), 0) <> v_n then
    v_faces := array_fill(null::text, array[v_n]);
  end if;

  for i in 1 .. v_n loop
    if not v_keep[i] then
      v_faces[i] := public.yahdle_roll_one_die(i - 1);
    end if;
  end loop;

  update public.yahdle_turn_state
  set faces      = v_faces,
      rolls_used = v_state.rolls_used + 1,
      updated_at = now()
  where game_id = p_game_id and user_id = v_uid;

  return v_faces;
end;
$$;

grant execute on function public.yahdle_roll_dice(uuid) to authenticated;

-- ── 4. Park / unpark / swap ──────────────────────────────────

create or replace function public.yahdle_park_die(
  p_game_id uuid,
  p_die_idx int
) returns void language plpgsql security definer as $$
declare
  v_uid     uuid := auth.uid();
  v_state   record;
  v_game    record;
  v_player  record;
  v_letter  text;
  v_n       int := public.yahdle_die_count();
  i         int;
  exists_in_builder boolean := false;
begin
  select * into v_game from public.yahdle_games where id = p_game_id;
  if v_game.status <> 'active' then raise exception 'Game not active'; end if;

  select * into v_player from public.yahdle_players where game_id = p_game_id and user_id = v_uid;
  if v_player.player_index <> v_game.current_player_idx then
    raise exception 'Not your turn';
  end if;

  if p_die_idx < 0 or p_die_idx >= v_n then
    raise exception 'Bad die index';
  end if;

  select * into v_state from public.yahdle_turn_state where game_id = p_game_id and user_id = v_uid for update;

  -- die must be rolled
  v_letter := v_state.faces[p_die_idx + 1];
  if v_letter is null then raise exception 'Die not rolled yet'; end if;

  -- not already in builder
  for i in 0 .. coalesce(jsonb_array_length(v_state.builder), 0) - 1 loop
    if (v_state.builder -> i ->> 'dieIdx')::int = p_die_idx then
      exists_in_builder := true;
    end if;
  end loop;
  if exists_in_builder then raise exception 'Die already in word'; end if;
  if jsonb_array_length(v_state.builder) >= v_n then raise exception 'Word full'; end if;

  update public.yahdle_turn_state
  set builder = v_state.builder || jsonb_build_array(jsonb_build_object('letter', v_letter, 'dieIdx', p_die_idx)),
      updated_at = now()
  where game_id = p_game_id and user_id = v_uid;
end;
$$;

grant execute on function public.yahdle_park_die(uuid, int) to authenticated;

create or replace function public.yahdle_unpark_die(
  p_game_id uuid,
  p_builder_idx int
) returns void language plpgsql security definer as $$
declare
  v_uid    uuid := auth.uid();
  v_state  record;
  v_game   record;
  v_player record;
  v_new    jsonb;
  v_len    int;
begin
  select * into v_game from public.yahdle_games where id = p_game_id;
  if v_game.status <> 'active' then raise exception 'Game not active'; end if;

  select * into v_player from public.yahdle_players where game_id = p_game_id and user_id = v_uid;
  if v_player.player_index <> v_game.current_player_idx then
    raise exception 'Not your turn';
  end if;

  select * into v_state from public.yahdle_turn_state where game_id = p_game_id and user_id = v_uid for update;

  v_len := coalesce(jsonb_array_length(v_state.builder), 0);
  if p_builder_idx < 0 or p_builder_idx >= v_len then
    raise exception 'Bad builder index';
  end if;

  v_new := v_state.builder - p_builder_idx;

  update public.yahdle_turn_state
  set builder = v_new,
      updated_at = now()
  where game_id = p_game_id and user_id = v_uid;
end;
$$;

grant execute on function public.yahdle_unpark_die(uuid, int) to authenticated;

create or replace function public.yahdle_swap_letters(
  p_game_id uuid,
  p_idx_a   int,
  p_idx_b   int
) returns void language plpgsql security definer as $$
declare
  v_uid    uuid := auth.uid();
  v_state  record;
  v_game   record;
  v_player record;
  v_a      jsonb;
  v_b      jsonb;
  v_len    int;
begin
  select * into v_game from public.yahdle_games where id = p_game_id;
  if v_game.status <> 'active' then raise exception 'Game not active'; end if;

  select * into v_player from public.yahdle_players where game_id = p_game_id and user_id = v_uid;
  if v_player.player_index <> v_game.current_player_idx then
    raise exception 'Not your turn';
  end if;

  select * into v_state from public.yahdle_turn_state where game_id = p_game_id and user_id = v_uid for update;
  v_len := coalesce(jsonb_array_length(v_state.builder), 0);

  if p_idx_a < 0 or p_idx_a >= v_len or p_idx_b < 0 or p_idx_b >= v_len or p_idx_a = p_idx_b then
    raise exception 'Bad swap indices';
  end if;

  v_a := v_state.builder -> p_idx_a;
  v_b := v_state.builder -> p_idx_b;

  update public.yahdle_turn_state
  set builder = jsonb_set(jsonb_set(v_state.builder, array[p_idx_a::text], v_b), array[p_idx_b::text], v_a),
      updated_at = now()
  where game_id = p_game_id and user_id = v_uid;
end;
$$;

grant execute on function public.yahdle_swap_letters(uuid, int, int) to authenticated;

-- ── 5. Score / take-zero / advance turn ──────────────────────

-- Internal: advance turn + finalize if game complete.
create or replace function public.yahdle_advance_turn(
  p_game_id uuid
) returns void language plpgsql security definer as $$
declare
  v_game        record;
  v_my_player   record;
  v_other_player record;
  v_my_done     boolean;
  v_other_done  boolean;
  v_total_turns int := public.yahdle_total_turns();
begin
  select * into v_game from public.yahdle_games where id = p_game_id for update;

  -- Reset current player's turn state for next time.
  select * into v_my_player from public.yahdle_players
   where game_id = p_game_id and player_index = v_game.current_player_idx;

  update public.yahdle_turn_state
  set faces = '{}', builder = '[]'::jsonb, rolls_used = 0, updated_at = now()
  where game_id = p_game_id and user_id = v_my_player.user_id;

  -- Check if both players have filled all 12 categories.
  v_my_done := (select count(*) from jsonb_object_keys(v_my_player.scores)) >= v_total_turns;
  select * into v_other_player from public.yahdle_players
   where game_id = p_game_id and player_index = (1 - v_game.current_player_idx);
  v_other_done := (select count(*) from jsonb_object_keys(v_other_player.scores)) >= v_total_turns;

  if v_my_done and v_other_done then
    perform public.yahdle_finalize_game(p_game_id);
    return;
  end if;

  -- Otherwise hand turn to other player; bump current_turn iff they
  -- haven't played this turn yet (i.e., we just played the second seat
  -- of this turn number).
  update public.yahdle_games
  set current_player_idx = 1 - v_game.current_player_idx,
      current_turn       = case
        when (select count(*) from jsonb_object_keys(v_other_player.scores)) < v_game.current_turn
          then v_game.current_turn  -- they still owe this turn
        else v_game.current_turn + 1
      end,
      last_activity_at   = now()
  where id = p_game_id;
end;
$$;

create or replace function public.yahdle_finalize_game(
  p_game_id uuid
) returns void language plpgsql security definer as $$
declare
  v_p0     record;
  v_p1     record;
  v_winner uuid;
  v_tie    boolean := false;
begin
  select * into v_p0 from public.yahdle_players where game_id = p_game_id and player_index = 0;
  select * into v_p1 from public.yahdle_players where game_id = p_game_id and player_index = 1;

  if v_p0.total_score > v_p1.total_score then
    v_winner := v_p0.user_id;
    update public.yahdle_players set is_winner = true  where id = v_p0.id;
    update public.yahdle_players set is_winner = false where id = v_p1.id;
  elsif v_p1.total_score > v_p0.total_score then
    v_winner := v_p1.user_id;
    update public.yahdle_players set is_winner = true  where id = v_p1.id;
    update public.yahdle_players set is_winner = false where id = v_p0.id;
  else
    v_tie := true;
    -- Tie = both winners
    update public.yahdle_players set is_winner = true where game_id = p_game_id;
  end if;

  update public.yahdle_games
  set status         = 'finished',
      finished_at    = now(),
      winner_user_id = v_winner,
      is_tie         = v_tie
  where id = p_game_id;

  perform public.yahdle_record_matchup(v_p0.user_id, v_p1.user_id, v_winner, v_tie);
end;
$$;

create or replace function public.yahdle_record_matchup(
  p_player_a uuid,
  p_player_b uuid,
  p_winner   uuid,
  p_tie      boolean
) returns void language plpgsql security definer as $$
declare
  a_win int := case when p_tie then 0 when p_winner = p_player_a then 1 else 0 end;
  a_los int := case when p_tie then 0 when p_winner = p_player_b then 1 else 0 end;
  a_tie int := case when p_tie then 1 else 0 end;
begin
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
$$;

create or replace function public.yahdle_score_category(
  p_game_id     uuid,
  p_category_id text,
  p_word        text
) returns void language plpgsql security definer as $$
declare
  v_uid     uuid := auth.uid();
  v_game    record;
  v_player  record;
  v_state   record;
  v_score   int;
  v_word    text := upper(p_word);
  v_builder text := '';
  i         int;
begin
  select * into v_game from public.yahdle_games where id = p_game_id for update;
  if not found or v_game.status <> 'active' then raise exception 'Game not active'; end if;

  select * into v_player from public.yahdle_players where game_id = p_game_id and user_id = v_uid for update;
  if not found or v_player.player_index <> v_game.current_player_idx then
    raise exception 'Not your turn';
  end if;
  if v_player.scores ? p_category_id then
    raise exception 'Category already filled';
  end if;

  select * into v_state from public.yahdle_turn_state where game_id = p_game_id and user_id = v_uid;

  -- Word must equal the builder's letters in order.
  for i in 0 .. coalesce(jsonb_array_length(v_state.builder), 0) - 1 loop
    v_builder := v_builder || upper(v_state.builder -> i ->> 'letter');
  end loop;
  if v_builder = '' or v_builder <> v_word then
    raise exception 'Word does not match dice builder';
  end if;

  -- Word must be spellable from the current dice (defence in depth).
  if not public.yahdle_is_spellable(v_word, v_state.faces) then
    raise exception 'Word not spellable from rolled dice';
  end if;

  v_score := public.yahdle_word_score(v_word);

  update public.yahdle_players
  set scores        = scores || jsonb_build_object(p_category_id, v_score),
      total_score   = total_score + v_score,
      last_word     = v_word,
      last_category = p_category_id,
      last_score    = v_score
  where id = v_player.id;

  perform public.yahdle_advance_turn(p_game_id);
end;
$$;

grant execute on function public.yahdle_score_category(uuid, text, text) to authenticated;

create or replace function public.yahdle_take_zero(
  p_game_id     uuid,
  p_category_id text
) returns void language plpgsql security definer as $$
declare
  v_uid    uuid := auth.uid();
  v_game   record;
  v_player record;
begin
  select * into v_game from public.yahdle_games where id = p_game_id for update;
  if not found or v_game.status <> 'active' then raise exception 'Game not active'; end if;

  select * into v_player from public.yahdle_players where game_id = p_game_id and user_id = v_uid for update;
  if not found or v_player.player_index <> v_game.current_player_idx then
    raise exception 'Not your turn';
  end if;
  if v_player.scores ? p_category_id then
    raise exception 'Category already filled';
  end if;

  update public.yahdle_players
  set scores        = scores || jsonb_build_object(p_category_id, 0),
      last_word     = null,
      last_category = p_category_id,
      last_score    = 0
  where id = v_player.id;

  perform public.yahdle_advance_turn(p_game_id);
end;
$$;

grant execute on function public.yahdle_take_zero(uuid, text) to authenticated;

-- ── 6. Forfeit / claim inactive win ──────────────────────────

create or replace function public.yahdle_forfeit_game(
  p_game_id uuid
) returns void language plpgsql security definer as $$
declare
  v_uid       uuid := auth.uid();
  v_game      record;
  v_me        record;
  v_opponent  record;
begin
  select * into v_game from public.yahdle_games where id = p_game_id for update;
  if not found or v_game.status <> 'active' then raise exception 'Game not active'; end if;

  select * into v_me from public.yahdle_players where game_id = p_game_id and user_id = v_uid;
  if not found then raise exception 'Not a participant'; end if;

  select * into v_opponent from public.yahdle_players where game_id = p_game_id and user_id <> v_uid;

  update public.yahdle_players set is_winner = false where id = v_me.id;
  update public.yahdle_players set is_winner = true  where id = v_opponent.id;

  update public.yahdle_games
  set status          = 'finished',
      finished_at     = now(),
      winner_user_id  = v_opponent.user_id,
      forfeit_user_id = v_uid
  where id = p_game_id;

  perform public.yahdle_record_matchup(v_opponent.user_id, v_uid, v_opponent.user_id, false);
end;
$$;

grant execute on function public.yahdle_forfeit_game(uuid) to authenticated;

create or replace function public.yahdle_claim_inactive_win(
  p_game_id uuid
) returns void language plpgsql security definer as $$
declare
  v_uid       uuid := auth.uid();
  v_game      record;
  v_me        record;
  v_opponent  record;
begin
  select * into v_game from public.yahdle_games where id = p_game_id for update;
  if not found or v_game.status <> 'active' then raise exception 'Game not active'; end if;

  select * into v_me from public.yahdle_players where game_id = p_game_id and user_id = v_uid;
  if not found then raise exception 'Not a participant'; end if;
  if v_me.player_index = v_game.current_player_idx then
    raise exception 'It is your turn — you cannot claim';
  end if;
  if v_game.last_activity_at > now() - interval '7 days' then
    raise exception 'Opponent still has time';
  end if;

  select * into v_opponent from public.yahdle_players where game_id = p_game_id and user_id <> v_uid;

  update public.yahdle_players set is_winner = true  where id = v_me.id;
  update public.yahdle_players set is_winner = false where id = v_opponent.id;

  update public.yahdle_games
  set status          = 'finished',
      finished_at     = now(),
      winner_user_id  = v_uid,
      forfeit_user_id = v_opponent.user_id
  where id = p_game_id;

  perform public.yahdle_record_matchup(v_uid, v_opponent.user_id, v_uid, false);
end;
$$;

grant execute on function public.yahdle_claim_inactive_win(uuid) to authenticated;

-- ── 7. Rematch ───────────────────────────────────────────────
-- Spawns a new game with same opponent + creator (fresh coin flip
-- happens on accept). Just a thin wrapper around create_game.
create or replace function public.yahdle_rematch(
  p_game_id uuid
) returns uuid language plpgsql security definer as $$
declare
  v_uid       uuid := auth.uid();
  v_game      record;
  v_opponent  uuid;
begin
  select * into v_game from public.yahdle_games where id = p_game_id;
  if not found or v_game.status <> 'finished' then
    raise exception 'Original game not finished';
  end if;
  if v_uid not in (v_game.created_by, v_game.invited_user_id) then
    raise exception 'Not a participant';
  end if;
  v_opponent := case when v_uid = v_game.created_by then v_game.invited_user_id else v_game.created_by end;
  return public.yahdle_create_game(v_opponent);
end;
$$;

grant execute on function public.yahdle_rematch(uuid) to authenticated;

-- ── 8. pending_for ───────────────────────────────────────────
-- Hub bell counter — must match the shape sq_pending_for expects:
--   TABLE(count int, label text, url text)
-- One row per logical bucket; sq_pending_for groups them by game_id.
drop function if exists public.yahdle_pending_for(uuid);
create or replace function public.yahdle_pending_for(uid uuid)
returns table(count int, label text, url text)
language sql security definer stable as $$
  with invites as (
    select count(*)::int as n from public.yahdle_games
    where status = 'waiting' and invited_user_id = uid
  ),
  turn as (
    select count(*)::int as n
    from public.yahdle_games g
    join public.yahdle_players p on p.game_id = g.id and p.user_id = uid
    where g.status = 'active' and p.player_index = g.current_player_idx
  )
  select n, 'Your turn'::text, '/yahdle/'::text from turn where n > 0
  union all
  select n, 'Invite'::text, '/yahdle/'::text from invites where n > 0
$$;

grant execute on function public.yahdle_pending_for(uuid) to authenticated;

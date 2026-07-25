-- ============================================================
-- Yahdle — make the rematch handshake terminal
--
-- Bug: yahdle_decline_rematch cleared rematch_requested_by back to
-- NULL, which is indistinguishable from "nobody ever asked". Re-opening
-- the finished game therefore showed the plain Rematch button again to
-- BOTH players, so a declined rematch could be re-requested forever
-- (and each request fires a push at the opponent). Accept had the
-- mirror problem client-side: rematch_requested_by was never cleared,
-- so the accepter re-opening the old board still saw Accept / Decline.
--
-- Fix: a rematch is resolved EXACTLY ONCE per finished game.
--   • accepted  -> rematch_new_game_id is not null   (already the case)
--   • declined  -> rematch_declined_at  is not null  (new)
-- Either terminal state kills every rematch control on that board for
-- both players. Cancel-by-the-requester counts as a decline: it's the
-- same RPC, and leaving it re-requestable would just re-open the
-- request/cancel/request push-spam loop. Players who change their mind
-- start a fresh game from the lobby.
--
-- Run order: after yahdle_rematch_handshake.sql. Idempotent.
-- ============================================================

-- ── 1. Schema delta ──────────────────────────────────────────
alter table public.yahdle_games
  add column if not exists rematch_declined_at timestamptz;

-- ── 2. Request: refuse once the rematch is resolved ──────────
create or replace function public.yahdle_request_rematch(
  p_game_id uuid
) returns void language plpgsql security definer as $$
declare
  v_uid  uuid := auth.uid();
  v_game record;
begin
  select * into v_game from public.yahdle_games where id = p_game_id for update;
  if not found or v_game.status <> 'finished' then
    raise exception 'Original game not finished';
  end if;
  if coalesce(v_game.max_players, 2) <> 2 then
    raise exception 'Rematch handshake only supports 2-player games';
  end if;
  if not exists (
    select 1 from public.yahdle_players where game_id = p_game_id and user_id = v_uid
  ) then
    raise exception 'Not a participant';
  end if;
  if v_game.rematch_new_game_id is not null then
    raise exception 'Rematch already started';
  end if;
  -- Terminal: declined/cancelled once, never re-askable on this board.
  if v_game.rematch_declined_at is not null then
    raise exception 'Rematch already declined';
  end if;
  -- First click wins: a different requester already holds the slot.
  if v_game.rematch_requested_by is not null and v_game.rematch_requested_by <> v_uid then
    raise exception 'Your opponent already requested a rematch';
  end if;

  update public.yahdle_games
     set rematch_requested_by = v_uid
   where id = p_game_id;
end;
$$;
grant execute on function public.yahdle_request_rematch(uuid) to authenticated;

-- ── 3. Accept: refuse a declined request ─────────────────────
-- Unchanged apart from the declined guard — a decline that lands
-- between the opponent's screen render and their Accept tap must not
-- resurrect the request.
create or replace function public.yahdle_accept_rematch(
  p_game_id uuid
) returns uuid language plpgsql security definer as $$
declare
  v_uid       uuid := auth.uid();
  v_game      record;
  v_requester uuid;
  v_new_id    uuid;
  v_first     int;
begin
  select * into v_game from public.yahdle_games where id = p_game_id for update;
  if not found or v_game.status <> 'finished' then
    raise exception 'Original game not finished';
  end if;
  if coalesce(v_game.max_players, 2) <> 2 then
    raise exception 'Rematch handshake only supports 2-player games';
  end if;
  -- Already accepted (double tap / second device) — hand back the same game.
  if v_game.rematch_new_game_id is not null then
    return v_game.rematch_new_game_id;
  end if;
  if v_game.rematch_declined_at is not null then
    raise exception 'Rematch already declined';
  end if;

  v_requester := v_game.rematch_requested_by;
  if v_requester is null then
    raise exception 'No open rematch request';
  end if;
  if v_requester = v_uid then
    raise exception 'You requested the rematch — waiting on your opponent';
  end if;
  if not exists (
    select 1 from public.yahdle_players where game_id = p_game_id and user_id = v_uid
  ) then
    raise exception 'Not a participant';
  end if;

  -- Fresh game: requester is creator (seat 0), accepter seat 1. Goes
  -- active immediately with a new coin flip — no second invite step.
  v_first := floor(random() * 2)::int;
  insert into public.yahdle_games
    (created_by, invited_user_id, invited_user_ids, max_players, status,
     joined_at, current_player_idx, current_turn, last_activity_at)
  values
    (v_requester, v_uid, array[v_uid], 2, 'active',
     now(), v_first, 1, now())
  returning id into v_new_id;

  insert into public.yahdle_players (game_id, user_id, player_index)
  values (v_new_id, v_requester, 0), (v_new_id, v_uid, 1);

  insert into public.yahdle_turn_state (game_id, user_id)
  values (v_new_id, v_requester), (v_new_id, v_uid);

  -- Back-link so the requester's open GameOver screen sees it via
  -- realtime and navigates into the new game.
  update public.yahdle_games
     set rematch_new_game_id = v_new_id
   where id = p_game_id;

  return v_new_id;
end;
$$;
grant execute on function public.yahdle_accept_rematch(uuid) to authenticated;

-- ── 4. Decline / cancel: stamp the terminal marker ───────────
-- Either participant may resolve it (the recipient declines, or the
-- requester cancels) and either way it's final for this board. Still no
-- notification on decline. Idempotent: a second decline is a no-op that
-- keeps the original timestamp rather than erroring, so a double tap
-- across two devices doesn't surface a red toast.
create or replace function public.yahdle_decline_rematch(
  p_game_id uuid
) returns void language plpgsql security definer as $$
declare
  v_uid  uuid := auth.uid();
  v_game record;
begin
  select * into v_game from public.yahdle_games where id = p_game_id for update;
  if not found then raise exception 'Game not found'; end if;
  if not exists (
    select 1 from public.yahdle_players where game_id = p_game_id and user_id = v_uid
  ) then
    raise exception 'Not a participant';
  end if;
  if v_game.rematch_new_game_id is not null then
    raise exception 'Rematch already started';
  end if;
  if v_game.rematch_declined_at is not null then
    return;
  end if;

  update public.yahdle_games
     set rematch_requested_by = null,
         rematch_declined_at  = now()
   where id = p_game_id;
end;
$$;
grant execute on function public.yahdle_decline_rematch(uuid) to authenticated;

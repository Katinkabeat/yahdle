-- ============================================================
-- Yahdle — single-rematch accept handshake (card c165)
--
-- Replaces the unilateral rematch (both players could each fire a
-- fresh invite, spawning two parallel games) with a
-- one-open-request-per-game handshake for 1v1 games:
--   • First player to click Rematch CLAIMS the request
--     (yahdle_games.rematch_requested_by). A row lock makes the
--     "first click wins" race resolve server-side.
--   • The OTHER player accepts -> a fresh game is created already
--     ACTIVE with both players seated + a new coin flip (no second
--     invite/accept step), and its id is written back onto the
--     finished game (rematch_new_game_id) so the requester's open
--     GameOver screen auto-navigates in via realtime.
--   • Either player can clear the request (decline / cancel). Decline
--     does NOT notify the requester (intentional — it's an in-the-
--     moment screen action).
-- Identical for win / loss / tie — whoever clicks first owns it.
--
-- 2-player only: N-player finished games (not creatable via the
-- current lobby UI) keep the legacy unilateral yahdle_rematch.
--
-- Run order: after yahdle_nplayer_engine.sql + yahdle_push_triggers.sql.
-- Idempotent: safe to re-run.
-- ============================================================

-- ── 1. Schema deltas ─────────────────────────────────────────
alter table public.yahdle_games
  add column if not exists rematch_requested_by uuid
    references auth.users(id) on delete set null;

alter table public.yahdle_games
  add column if not exists rematch_new_game_id uuid
    references public.yahdle_games(id) on delete set null;

-- ── 2. Refine the invite push trigger ────────────────────────
-- The accept RPC inserts the rematch game already ACTIVE (with
-- invited_user_id set). The old trigger fired game_invited on ANY
-- insert with an invitee, which would push a stale "you're invited"
-- to the requester. An invite push only ever makes sense for a
-- waiting game, so gate on status — this also no-ops the rematch
-- insert cleanly.
drop trigger if exists on_yahdle_game_invited on public.yahdle_games;
create trigger on_yahdle_game_invited
after insert on public.yahdle_games
for each row
when (NEW.invited_user_id is not null and NEW.status = 'waiting')
execute function public.yahdle_notify_game_invited();

-- ── 3. Request a rematch (claim the single open slot) ────────
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

-- ── 4. Accept a rematch (the other player) ───────────────────
-- Spawns the fresh game already active with both seats filled and a
-- new coin flip, then back-links it onto the finished game. Returns
-- the new game id. Idempotent on double-accept.
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

-- ── 5. Decline / cancel the open request ─────────────────────
-- Either participant may clear it (the recipient declines, or the
-- requester cancels). No notification is sent on decline.
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

  update public.yahdle_games
     set rematch_requested_by = null
   where id = p_game_id;
end;
$$;
grant execute on function public.yahdle_decline_rematch(uuid) to authenticated;

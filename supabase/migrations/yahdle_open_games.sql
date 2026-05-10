-- ============================================================
-- Yahdle — Open games (matchmaking)
--
-- Adds a second creation path: instead of inviting a specific
-- friend, create an "open" game (invited_user_id null) that any
-- other authenticated user can join from the lobby.
--
-- The 24h expiry for open games already exists in
-- yahdle_set_game_expiry (yahdle_invite_expiry.sql) — keeps stale
-- open games from cluttering the lobby.
--
-- Changes:
--   1. yahdle_create_game: allow null p_invited_user_id (open game)
--      and cap one open game per user at a time.
--   2. New yahdle_join_open_game RPC: any user can join, sets
--      invited_user_id = joiner so the existing RLS, pending_for,
--      and opponent_joined push trigger keep working as-is.
--   3. New RLS policy: anyone authenticated can SELECT a waiting
--      open game so the lobby can list them. Once joined, the row
--      flips to active + invited_user_id set, and the existing
--      "read participant" policy takes over.
--   4. yahdle_list_open_games: lobby helper returning open games
--      not created by me, with creator profile info.
-- ============================================================

-- ── 1. Allow null opponent in create_game ────────────────────
create or replace function public.yahdle_create_game(
  p_invited_user_id uuid
) returns uuid language plpgsql security definer as $$
declare
  v_game_id    uuid;
  v_uid        uuid := auth.uid();
  v_open_count int;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if p_invited_user_id = v_uid then
    raise exception 'Invalid opponent';
  end if;

  -- Cap: one open game waiting per creator (prevents lobby spam).
  if p_invited_user_id is null then
    select count(*) into v_open_count
    from public.yahdle_games
    where created_by = v_uid
      and status = 'waiting'
      and invited_user_id is null;
    if v_open_count > 0 then
      raise exception 'You already have an open game waiting for someone to join';
    end if;
  end if;

  insert into public.yahdle_games (created_by, invited_user_id, status)
  values (v_uid, p_invited_user_id, 'waiting')
  returning id into v_game_id;

  insert into public.yahdle_players (game_id, user_id, player_index)
  values (v_game_id, v_uid, 0);

  insert into public.yahdle_turn_state (game_id, user_id)
  values (v_game_id, v_uid);

  return v_game_id;
end;
$$;

grant execute on function public.yahdle_create_game(uuid) to authenticated;

-- ── 2. Join an open game ─────────────────────────────────────
create or replace function public.yahdle_join_open_game(
  p_game_id uuid
) returns void language plpgsql security definer as $$
declare
  v_uid       uuid := auth.uid();
  v_game      record;
  v_first_idx int;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_game from public.yahdle_games where id = p_game_id for update;
  if not found then
    raise exception 'Game not found';
  end if;
  if v_game.status <> 'waiting' then
    raise exception 'Game already started or finished';
  end if;
  if v_game.invited_user_id is not null then
    raise exception 'Not an open game';
  end if;
  if v_game.created_by = v_uid then
    raise exception 'Cannot join your own game';
  end if;

  -- Coin flip for first player (matches accept_invite).
  v_first_idx := floor(random() * 2)::int;

  insert into public.yahdle_players (game_id, user_id, player_index)
  values (p_game_id, v_uid, 1);

  insert into public.yahdle_turn_state (game_id, user_id)
  values (p_game_id, v_uid);

  update public.yahdle_games
  set status             = 'active',
      invited_user_id    = v_uid,
      joined_at          = now(),
      current_player_idx = v_first_idx,
      current_turn       = 1,
      last_activity_at   = now()
  where id = p_game_id;
end;
$$;

grant execute on function public.yahdle_join_open_game(uuid) to authenticated;

-- ── 3. RLS: open waiting games are publicly readable ─────────
drop policy if exists "yahdle_games read open" on public.yahdle_games;
create policy "yahdle_games read open" on public.yahdle_games
  for select using (
    status = 'waiting' and invited_user_id is null
  );

-- ── 4. List helper for the lobby ─────────────────────────────
drop function if exists public.yahdle_list_open_games();
create or replace function public.yahdle_list_open_games()
returns table(
  id                 uuid,
  created_by         uuid,
  created_at         timestamptz,
  expires_at         timestamptz,
  creator_username   text,
  creator_avatar_hue int
) language sql security definer stable as $$
  select
    g.id,
    g.created_by,
    g.created_at,
    g.expires_at,
    p.username,
    p.avatar_hue
  from public.yahdle_games g
  join public.profiles p on p.id = g.created_by
  where g.status = 'waiting'
    and g.invited_user_id is null
    and g.created_by <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
    and g.expires_at > now()
  order by g.created_at desc
  limit 50;
$$;

grant execute on function public.yahdle_list_open_games() to authenticated;

-- ============================================================
-- Yahdle — N-player engine (card c136)
--
-- Lifts the hardwired 1v1 cap to 2–4 players by porting Wordy's
-- N-player pattern: a max_players target, an invited_user_ids[]
-- array for multi-friend invites, modulo turn rotation, auto-start
-- when the game fills, and a top-score-group-wins finalize.
--
-- Additive + behavior-preserving for live 2-player games:
--   • max_players defaults to 2; existing rows read as 2-player.
--   • turn advance (idx+1) % max_players == the old (1 - idx) for 2 seats.
--   • finalize's top-score group == the old higher-score winner, EXCEPT
--     a 1v1 tie now records a WIN for BOTH players (was a tie) — the one
--     deliberate gameplay change in c136. Ties are no longer written.
--   • invited_user_id (singular) is KEPT and mirrored from the first
--     invitee so the existing lobby query, RLS, and push triggers keep
--     working until the lobby UI moves to the array (next slice).
--
-- Run order: after yahdle_multiplayer_schema.sql, _rpcs.sql,
-- yahdle_open_games.sql, yahdle_invite_expiry.sql.
-- Idempotent: safe to re-run.
-- ============================================================

-- ── 1. Schema deltas (idempotent) ────────────────────────────
alter table public.yahdle_games
  add column if not exists max_players int not null default 2;

alter table public.yahdle_games
  add column if not exists invited_user_ids uuid[];

-- Backfill the array from the singular column for in-flight games.
update public.yahdle_games
   set invited_user_ids = array[invited_user_id]
 where invited_user_id is not null
   and invited_user_ids is null;

do $$ begin
  alter table public.yahdle_games
    add constraint yahdle_games_max_players_chk check (max_players between 2 and 4);
exception when duplicate_object then null; end $$;

-- Relax current_player_idx: was inline CHECK (in (0,1)). Drop whatever
-- check references that column (auto-named), then add the N-player bound.
do $$
declare r record;
begin
  for r in
    select conname from pg_constraint
     where conrelid = 'public.yahdle_games'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%current_player_idx%'
  loop execute format('alter table public.yahdle_games drop constraint %I', r.conname); end loop;
end $$;
do $$ begin
  alter table public.yahdle_games
    add constraint yahdle_games_current_player_idx_chk
    check (current_player_idx >= 0 and current_player_idx < max_players);
exception when duplicate_object then null; end $$;

-- Relax player_index: was inline CHECK (in (0,1)). (unique(game_id,
-- player_index) is contype 'u', untouched by the check-only sweep.)
do $$
declare r record;
begin
  for r in
    select conname from pg_constraint
     where conrelid = 'public.yahdle_players'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%player_index%'
  loop execute format('alter table public.yahdle_players drop constraint %I', r.conname); end loop;
end $$;
do $$ begin
  alter table public.yahdle_players
    add constraint yahdle_players_player_index_chk check (player_index between 0 and 3);
exception when duplicate_object then null; end $$;

-- ── 1b. RLS: every participant can read the game + all players ──
-- The original policies only covered created_by / invited_user_id, which
-- would lock players 3–4 out of their own game (they can't read the game
-- row or the other players' scores). A SECURITY DEFINER membership check
-- reads yahdle_players directly, avoiding games<->players policy recursion.
create or replace function public.yahdle_is_participant(p_game_id uuid, p_uid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.yahdle_players
     where game_id = p_game_id and user_id = p_uid
  );
$$;
revoke all on function public.yahdle_is_participant(uuid, uuid) from public;
grant execute on function public.yahdle_is_participant(uuid, uuid) to authenticated;

drop policy if exists "yahdle_games read participant" on public.yahdle_games;
create policy "yahdle_games read participant" on public.yahdle_games
  for select using (
    auth.uid() = created_by
    or auth.uid() = invited_user_id
    or auth.uid() = any(coalesce(invited_user_ids, '{}'))
    or public.yahdle_is_participant(id, auth.uid())
  );

drop policy if exists "yahdle_players read participant" on public.yahdle_players;
create policy "yahdle_players read participant" on public.yahdle_players
  for select using ( public.yahdle_is_participant(game_id, auth.uid()) );

-- ── 2. Create game (N players + multi-invite) ────────────────
-- Replaces the single-invitee yahdle_create_game(uuid).
drop function if exists public.yahdle_create_game(uuid);
create or replace function public.yahdle_create_game(
  p_invited_user_ids uuid[] default null,
  p_max_players      int    default 2
) returns uuid language plpgsql security definer as $$
declare
  v_game_id    uuid;
  v_uid        uuid := auth.uid();
  v_open_count int;
  v_invited    uuid[] := coalesce(p_invited_user_ids, '{}');
  v_first      uuid;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if p_max_players < 2 or p_max_players > 4 then raise exception 'Invalid player count'; end if;
  if v_uid = any(v_invited) then raise exception 'Invalid opponent'; end if;
  if coalesce(array_length(v_invited, 1), 0) >= p_max_players then
    raise exception 'Too many invitees for this player count';
  end if;

  -- Cap one fully-open game (no invitees) waiting per creator.
  if coalesce(array_length(v_invited, 1), 0) = 0 then
    select count(*) into v_open_count from public.yahdle_games
     where created_by = v_uid and status = 'waiting'
       and coalesce(array_length(invited_user_ids, 1), 0) = 0;
    if v_open_count > 0 then
      raise exception 'You already have an open game waiting for someone to join';
    end if;
  end if;

  -- Legacy singular column points at the first invitee so the existing
  -- lobby/push keep working for that player during the transition.
  v_first := case when coalesce(array_length(v_invited, 1), 0) = 0 then null else v_invited[1] end;

  insert into public.yahdle_games (created_by, invited_user_id, invited_user_ids, max_players, status)
  values (v_uid, v_first, nullif(v_invited, '{}'), p_max_players, 'waiting')
  returning id into v_game_id;

  insert into public.yahdle_players (game_id, user_id, player_index) values (v_game_id, v_uid, 0);
  insert into public.yahdle_turn_state (game_id, user_id) values (v_game_id, v_uid);

  return v_game_id;
end;
$$;
grant execute on function public.yahdle_create_game(uuid[], int) to authenticated;

-- ── 3. Join (unified: open or invited) + auto-start ──────────
-- Single entry point. Invitees may always take a seat; a non-invitee
-- may only take a seat that isn't reserved for a still-absent invitee
-- (port of Wordy's slot reservation). Auto-starts when the seats fill.
create or replace function public.yahdle_join_game(
  p_game_id uuid
) returns void language plpgsql security definer as $$
declare
  v_uid     uuid := auth.uid();
  v_game    record;
  v_count   int;
  v_pending int;
  v_idx     int;
  v_invited uuid[];
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  select * into v_game from public.yahdle_games where id = p_game_id for update;
  if not found then raise exception 'Game not found'; end if;
  if v_game.status <> 'waiting' then raise exception 'Game already started or finished'; end if;

  perform 1 from public.yahdle_players where game_id = p_game_id and user_id = v_uid;
  if found then raise exception 'Already in this game'; end if;

  select count(*) into v_count from public.yahdle_players where game_id = p_game_id;
  if v_count >= v_game.max_players then raise exception 'Game is full'; end if;

  v_invited := coalesce(v_game.invited_user_ids, '{}');

  if not (v_uid = any(v_invited)) then
    -- reserved seats = invitees who haven't joined yet.
    select count(*) into v_pending
      from unnest(v_invited) iu
     where not exists (
       select 1 from public.yahdle_players p
        where p.game_id = p_game_id and p.user_id = iu);
    if (v_count + v_pending) >= v_game.max_players then
      raise exception 'No open seats — remaining seats are reserved for invited players';
    end if;
  end if;

  v_idx := v_count;  -- next 0-based player_index
  insert into public.yahdle_players (game_id, user_id, player_index) values (p_game_id, v_uid, v_idx);
  insert into public.yahdle_turn_state (game_id, user_id) values (p_game_id, v_uid);

  -- Keep the legacy singular column pointing at a real opponent.
  update public.yahdle_games
     set invited_user_id = coalesce(invited_user_id, v_uid),
         last_activity_at = now()
   where id = p_game_id;

  -- Auto-start when every seat is filled.
  if v_idx + 1 >= v_game.max_players then
    update public.yahdle_games
       set status             = 'active',
           joined_at          = now(),
           current_player_idx = floor(random() * v_game.max_players)::int,
           current_turn       = 1,
           last_activity_at   = now()
     where id = p_game_id;
  end if;
end;
$$;
grant execute on function public.yahdle_join_game(uuid) to authenticated;

-- Back-compat wrappers so the current client keeps working unchanged.
create or replace function public.yahdle_join_open_game(p_game_id uuid)
returns void language plpgsql security definer as $$
begin perform public.yahdle_join_game(p_game_id); end; $$;
grant execute on function public.yahdle_join_open_game(uuid) to authenticated;

create or replace function public.yahdle_accept_invite(p_game_id uuid)
returns void language plpgsql security definer as $$
declare v_game record;
begin
  select * into v_game from public.yahdle_games where id = p_game_id;
  if not found then raise exception 'Game not found'; end if;
  if not (auth.uid() = any(coalesce(v_game.invited_user_ids, '{}'))
          or auth.uid() = v_game.invited_user_id) then
    raise exception 'Not your invite';
  end if;
  perform public.yahdle_join_game(p_game_id);
end; $$;
grant execute on function public.yahdle_accept_invite(uuid) to authenticated;

-- ── 4. Advance turn (modulo over N) ──────────────────────────
create or replace function public.yahdle_advance_turn(
  p_game_id uuid
) returns void language plpgsql security definer as $$
declare
  v_game        record;
  v_n           int;
  v_total       int := public.yahdle_total_turns();
  v_cur         record;
  v_next_idx    int;
  v_next_filled int;
  v_all_done    boolean;
begin
  select * into v_game from public.yahdle_games where id = p_game_id for update;
  v_n := v_game.max_players;

  -- Reset the player who just played.
  select * into v_cur from public.yahdle_players
   where game_id = p_game_id and player_index = v_game.current_player_idx;
  update public.yahdle_turn_state
     set faces = '{}', builder = '[]'::jsonb, rolls_used = 0, updated_at = now()
   where game_id = p_game_id and user_id = v_cur.user_id;

  -- Done when every player has filled all 12 categories.
  select bool_and((select count(*) from jsonb_object_keys(p.scores)) >= v_total)
    into v_all_done
    from public.yahdle_players p where p.game_id = p_game_id;

  if v_all_done then
    perform public.yahdle_finalize_game(p_game_id);
    return;
  end if;

  -- Hand to the next seat. current_turn tracks the about-to-play
  -- player's progress, which is correct for any (random) starting seat.
  v_next_idx := (v_game.current_player_idx + 1) % v_n;
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

-- ── 5. Finalize (top-score group wins; quitters forced to lose) ─
-- p_forced_losers are excluded from the winner group regardless of
-- score (used by forfeit / claim-inactive). With no forced losers this
-- is the normal end-of-game tally.
drop function if exists public.yahdle_finalize_game(uuid);
create or replace function public.yahdle_finalize_game(
  p_game_id       uuid,
  p_forced_losers uuid[] default '{}'
) returns void language plpgsql security definer as $$
declare
  v_max     int;
  v_winners int;
  v_winner  uuid;
  a record;
  b record;
begin
  -- Highest total among players who didn't quit.
  select max(total_score) into v_max
    from public.yahdle_players
   where game_id = p_game_id and not (user_id = any(p_forced_losers));

  update public.yahdle_players
     set is_winner = (total_score = v_max and not (user_id = any(p_forced_losers)))
   where game_id = p_game_id;

  select count(*) into v_winners
    from public.yahdle_players where game_id = p_game_id and is_winner;
  select user_id into v_winner
    from public.yahdle_players where game_id = p_game_id and is_winner limit 1;

  update public.yahdle_games
     set status         = 'finished',
         finished_at     = now(),
         winner_user_id  = case when v_winners = 1 then v_winner else null end,
         is_tie          = (v_winners > 1)
   where id = p_game_id;

  -- Pairwise matchups (port of Wordy's model): each player records a
  -- WIN vs every opponent if they're in the top group, else a LOSS.
  -- A 1v1 tie => both are top => both record a win (c136). Never ties.
  for a in select user_id, is_winner from public.yahdle_players where game_id = p_game_id loop
    for b in select user_id from public.yahdle_players
              where game_id = p_game_id and user_id <> a.user_id loop
      insert into public.yahdle_matchups (player_id, opponent_id, wins, losses, ties)
      values (a.user_id, b.user_id,
              case when a.is_winner then 1 else 0 end,
              case when a.is_winner then 0 else 1 end, 0)
      on conflict (player_id, opponent_id) do update set
        wins   = yahdle_matchups.wins   + excluded.wins,
        losses = yahdle_matchups.losses + excluded.losses,
        updated_at = now();
    end loop;
  end loop;
end;
$$;

-- ── 6. Forfeit / claim-inactive (N-player via forced loser) ──
create or replace function public.yahdle_forfeit_game(
  p_game_id uuid
) returns void language plpgsql security definer as $$
declare
  v_uid  uuid := auth.uid();
  v_game record;
begin
  select * into v_game from public.yahdle_games where id = p_game_id for update;
  if not found or v_game.status <> 'active' then raise exception 'Game not active'; end if;
  perform 1 from public.yahdle_players where game_id = p_game_id and user_id = v_uid;
  if not found then raise exception 'Not a participant'; end if;

  -- Forfeiter loses; best remaining total wins.
  perform public.yahdle_finalize_game(p_game_id, array[v_uid]);

  update public.yahdle_games set forfeit_user_id = v_uid where id = p_game_id;
end;
$$;
grant execute on function public.yahdle_forfeit_game(uuid) to authenticated;

create or replace function public.yahdle_claim_inactive_win(
  p_game_id uuid
) returns void language plpgsql security definer as $$
declare
  v_uid     uuid := auth.uid();
  v_game    record;
  v_me      record;
  v_stalled uuid;
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

  -- The stalled current player loses; best remaining total wins.
  select user_id into v_stalled from public.yahdle_players
   where game_id = p_game_id and player_index = v_game.current_player_idx;

  perform public.yahdle_finalize_game(p_game_id, array[v_stalled]);

  update public.yahdle_games set forfeit_user_id = v_stalled where id = p_game_id;
end;
$$;
grant execute on function public.yahdle_claim_inactive_win(uuid) to authenticated;

-- ── 7. Open-game lobby list (now surfaces seats remaining) ───
-- Lists waiting games the caller can join: not created by them, not
-- already joined, and with at least one seat that isn't reserved for a
-- still-absent invitee. Adds max_players + seats filled for display.
drop function if exists public.yahdle_list_open_games();
create or replace function public.yahdle_list_open_games()
returns table(
  id                 uuid,
  created_by         uuid,
  created_at         timestamptz,
  expires_at         timestamptz,
  creator_username   text,
  creator_avatar_hue int,
  max_players        int,
  players_joined     int
) language sql security definer stable as $$
  with me as (select coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid) as uid)
  select
    g.id, g.created_by, g.created_at, g.expires_at,
    p.username, p.avatar_hue, g.max_players,
    (select count(*)::int from public.yahdle_players pl where pl.game_id = g.id) as players_joined
  from public.yahdle_games g
  join public.profiles p on p.id = g.created_by
  cross join me
  where g.status = 'waiting'
    and g.created_by <> me.uid
    and g.expires_at > now()
    and not exists (select 1 from public.yahdle_players pl where pl.game_id = g.id and pl.user_id = me.uid)
    -- a free, non-reserved seat exists for a non-invited joiner
    and (
      (select count(*) from public.yahdle_players pl where pl.game_id = g.id)
      + (select count(*) from unnest(coalesce(g.invited_user_ids, '{}')) iu
          where not exists (select 1 from public.yahdle_players pl
                             where pl.game_id = g.id and pl.user_id = iu))
    ) < g.max_players
  order by g.created_at desc
  limit 50;
$$;
grant execute on function public.yahdle_list_open_games() to authenticated;

-- Open waiting games stay publicly readable so the lobby can list them.
-- (Now includes partially-filled multi-player games.)
drop policy if exists "yahdle_games read open" on public.yahdle_games;
create policy "yahdle_games read open" on public.yahdle_games
  for select using (status = 'waiting');

-- ── 8. pending_for: invite bucket honors the invitee array ───
drop function if exists public.yahdle_pending_for(uuid);
create or replace function public.yahdle_pending_for(uid uuid)
returns table(count int, label text, url text)
language sql security definer stable as $$
  with invites as (
    select count(*)::int as n from public.yahdle_games
     where status = 'waiting'
       and (uid = any(coalesce(invited_user_ids, '{}')) or invited_user_id = uid)
       and not exists (select 1 from public.yahdle_players p
                        where p.game_id = yahdle_games.id and p.user_id = uid)
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

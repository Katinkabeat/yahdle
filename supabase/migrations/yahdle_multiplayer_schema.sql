-- ============================================================
-- Yahdle — Multiplayer schema (v1)
--
-- Strict-alternation, 12-turn-each Yahtzee-style head-to-head.
-- Each player has their own dice + scorecard; server owns RNG +
-- mid-turn state so refresh-cheating is impossible and resume-mid-turn
-- works across devices.
--
-- Tables:
--   yahdle_games        : one row per game
--   yahdle_players      : one row per player per game (scorecard, total)
--   yahdle_turn_state   : in-progress turn state for each player
--                         (faces, parked dice, builder, rolls used)
--   yahdle_matchups     : per-pair W/L/T (Wordy-style)
--
-- Status enum: waiting (invite sent) → active (both joined) →
-- finished (one winner / tie / forfeit / claim / admin close).
-- Matches the values the admin-close migration already assumes.
-- ============================================================

-- ── 1. yahdle_games ──────────────────────────────────────────
create table if not exists public.yahdle_games (
  id                  uuid        primary key default gen_random_uuid(),
  status              text        not null default 'waiting'
                                  check (status in ('waiting','active','finished')),
  created_by          uuid        not null references auth.users(id) on delete cascade,
  invited_user_id     uuid        references auth.users(id) on delete cascade,
  current_player_idx  int         not null default 0
                                  check (current_player_idx in (0, 1)),
  current_turn        int         not null default 1
                                  check (current_turn between 1 and 12),
  winner_user_id      uuid        references auth.users(id),
  forfeit_user_id     uuid        references auth.users(id),
  is_tie              boolean     not null default false,
  created_at          timestamptz not null default now(),
  joined_at           timestamptz,
  finished_at         timestamptz,
  last_activity_at    timestamptz not null default now(),
  expires_at          timestamptz not null default (now() + interval '7 days')
);

create index if not exists yahdle_games_status_idx          on public.yahdle_games(status);
create index if not exists yahdle_games_created_by_idx      on public.yahdle_games(created_by);
create index if not exists yahdle_games_invited_user_idx    on public.yahdle_games(invited_user_id);
create index if not exists yahdle_games_last_activity_idx   on public.yahdle_games(last_activity_at desc);

-- ── 2. yahdle_players ────────────────────────────────────────
-- scores is a jsonb of {category_id: score} for filled categories only
-- (unfilled categories absent from the object). last_word/last_score
-- reflect this player's most recent scored turn (for the opponent popup).
create table if not exists public.yahdle_players (
  id              uuid    primary key default gen_random_uuid(),
  game_id         uuid    not null references public.yahdle_games(id) on delete cascade,
  user_id         uuid    not null references auth.users(id)          on delete cascade,
  player_index    int     not null check (player_index in (0, 1)),
  scores          jsonb   not null default '{}'::jsonb,
  total_score     int     not null default 0,
  last_word       text,
  last_category   text,
  last_score      int,
  is_winner       boolean not null default false,
  joined_at       timestamptz default now(),
  unique (game_id, user_id),
  unique (game_id, player_index)
);

create index if not exists yahdle_players_user_idx on public.yahdle_players(user_id);

-- ── 3. yahdle_turn_state ─────────────────────────────────────
-- Mid-turn snapshot for resume + cross-device. Written by the roll/
-- park/unpark/swap RPCs, cleared (back to defaults) by the score RPC
-- when the turn ends.
--
-- faces        : current dice faces (length = DIE_COUNT, null if not yet rolled this turn)
-- builder      : array of {letter, dieIdx} in tap order
-- rolls_used   : 0, 1, 2, or 3 (3 = no more re-rolls allowed)
create table if not exists public.yahdle_turn_state (
  game_id      uuid    not null references public.yahdle_games(id) on delete cascade,
  user_id      uuid    not null references auth.users(id)          on delete cascade,
  faces        text[]  not null default '{}',
  builder      jsonb   not null default '[]'::jsonb,
  rolls_used   int     not null default 0 check (rolls_used between 0 and 3),
  updated_at   timestamptz not null default now(),
  primary key (game_id, user_id)
);

-- ── 4. yahdle_matchups ───────────────────────────────────────
-- Per-pair W/L/T totals. One row per (player, opponent) ordered pair.
create table if not exists public.yahdle_matchups (
  player_id    uuid    not null references auth.users(id) on delete cascade,
  opponent_id  uuid    not null references auth.users(id) on delete cascade,
  wins         int     not null default 0,
  losses       int     not null default 0,
  ties         int     not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (player_id, opponent_id)
);

-- ── 5. RLS ───────────────────────────────────────────────────
alter table public.yahdle_games       enable row level security;
alter table public.yahdle_players     enable row level security;
alter table public.yahdle_turn_state  enable row level security;
alter table public.yahdle_matchups    enable row level security;

-- Drop policies first so re-running this script is safe.
drop policy if exists "yahdle_games read participant"     on public.yahdle_games;
drop policy if exists "yahdle_games insert as creator"    on public.yahdle_games;
drop policy if exists "yahdle_games update via rpc"       on public.yahdle_games;
drop policy if exists "yahdle_players read participant"   on public.yahdle_players;
drop policy if exists "yahdle_players insert via rpc"     on public.yahdle_players;
drop policy if exists "yahdle_players update via rpc"     on public.yahdle_players;
drop policy if exists "yahdle_turn_state read own"        on public.yahdle_turn_state;
drop policy if exists "yahdle_turn_state write via rpc"   on public.yahdle_turn_state;
drop policy if exists "yahdle_matchups read own"          on public.yahdle_matchups;
drop policy if exists "yahdle_matchups write via rpc"     on public.yahdle_matchups;

-- Games: readable to participants; insert as creator. All updates go
-- through SECDEF RPCs (no direct UPDATE policy) to keep game logic
-- server-side.
create policy "yahdle_games read participant" on public.yahdle_games
  for select using (
    auth.uid() = created_by or auth.uid() = invited_user_id
  );

create policy "yahdle_games insert as creator" on public.yahdle_games
  for insert with check (auth.uid() = created_by);

-- Players: readable to participants. No direct INSERT/UPDATE — done
-- via SECDEF create/accept RPCs.
create policy "yahdle_players read participant" on public.yahdle_players
  for select using (
    exists (
      select 1 from public.yahdle_games g
      where g.id = yahdle_players.game_id
        and (g.created_by = auth.uid() or g.invited_user_id = auth.uid())
    )
  );

-- Turn state: each player can only ever read their own (opponent's
-- mid-turn faces are private — reveal only via scored result).
create policy "yahdle_turn_state read own" on public.yahdle_turn_state
  for select using (auth.uid() = user_id);

-- Matchups: each player reads their own row.
create policy "yahdle_matchups read own" on public.yahdle_matchups
  for select using (auth.uid() = player_id);

-- ── 6. last_activity_at trigger ──────────────────────────────
-- Keeps yahdle_games.last_activity_at fresh on any related write so
-- "Claim win after 7 days" can use it directly.
create or replace function public.yahdle_touch_game_activity()
returns trigger language plpgsql security definer as $$
begin
  update public.yahdle_games
  set last_activity_at = now()
  where id = coalesce(new.game_id, old.game_id);
  return coalesce(new, old);
end;
$$;

drop trigger if exists yahdle_players_touch_activity     on public.yahdle_players;
drop trigger if exists yahdle_turn_state_touch_activity  on public.yahdle_turn_state;

create trigger yahdle_players_touch_activity
  after insert or update on public.yahdle_players
  for each row execute function public.yahdle_touch_game_activity();

create trigger yahdle_turn_state_touch_activity
  after insert or update on public.yahdle_turn_state
  for each row execute function public.yahdle_touch_game_activity();

-- ── 7. Realtime publication ──────────────────────────────────
-- Required so MultiplayerCard + MultiGamePage receive live updates.
alter publication supabase_realtime add table public.yahdle_games;
alter publication supabase_realtime add table public.yahdle_players;
-- yahdle_turn_state intentionally NOT published — opponent must not
-- see your mid-turn dice. Each player polls/refreshes their own row.

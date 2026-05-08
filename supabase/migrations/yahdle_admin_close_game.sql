-- ============================================================
-- Yahdle — Admin close-game support
--
-- Run in Supabase → SQL Editor → New Query, ONCE the yahdle_games
-- table exists. Reuses the shared `public.admins` table (managed
-- from the SQ hub) for the permission check — no per-game admins
-- table needed.
--
-- This adds four pieces:
--   1. closed_by_admin BOOLEAN, closed_by UUID, close_reason TEXT
--      columns on yahdle_games
--   2. yahdle_admin_close_game(uuid, text) RPC — soft-closes a
--      game with no winner attribution; reason is REQUIRED
--   3. yahdle_admin_list_open_games() RPC — lists open + active
--      games for the admin panel UI
--   4. yahdle_admin_list_closed_games() RPC — lists recently
--      closed games with the closing admin's name + reason
--
-- If your game's table is named differently (e.g. yahdle_matches),
-- find/replace `yahdle_games` below before running.
-- ============================================================

-- ── 1. closed_by_admin / closed_by / close_reason columns ─────
alter table public.yahdle_games
  add column if not exists closed_by_admin boolean not null default false,
  add column if not exists closed_by       uuid    references auth.users(id),
  add column if not exists close_reason    text;

-- ── 2. yahdle_admin_close_game ──────────────────────────────
-- SECURITY DEFINER bypasses RLS so the admin can close games they
-- aren't a player in. Permission check enforced inside. Reason
-- is REQUIRED — empty/null raises an exception so the admin UI
-- must collect a reason before calling this RPC.
--
-- IMPORTANT: adjust the status values in the WHERE / SET clauses
-- below to match your game's status enum. The defaults assume
-- 'waiting' / 'active' / 'finished' (matches Wordy). Common
-- variants:
--   * Rungles uses 'complete' instead of 'finished'
--   * Snibble uses 'open' / 'in_progress' / 'completed'
create or replace function public.yahdle_admin_close_game(
  p_game_id uuid,
  p_reason  text
)
returns void language plpgsql security definer as $$
declare
  v_reason text := nullif(btrim(p_reason), '');
begin
  if v_reason is null then
    raise exception 'A reason is required to close a game';
  end if;

  if not exists (
    select 1 from public.admins
    where user_id = auth.uid()
      and 'close_games' = any(permissions)
  ) then
    raise exception 'Unauthorized: you do not have the close_games permission';
  end if;

  update public.yahdle_games
  set status          = 'finished',
      finished_at     = now(),
      closed_by_admin = true,
      closed_by       = auth.uid(),
      close_reason    = v_reason
  where id = p_game_id
    and status in ('waiting', 'active');

  if not found then
    raise exception 'Game not found or is already closed';
  end if;
end;
$$;

grant execute on function public.yahdle_admin_close_game(uuid, text) to authenticated;

-- ── 3. yahdle_admin_list_open_games ─────────────────────────
-- Returns waiting/active games for the admin Close Games panel.
-- Joins through your players table to surface usernames; rename
-- yahdle_players + the join column if your schema differs.
create or replace function public.yahdle_admin_list_open_games()
returns table (
  id           uuid,
  status       text,
  created_at   timestamptz,
  player_names text[]
) language sql security definer stable as $$
  select
    g.id,
    g.status,
    g.created_at,
    coalesce(
      array_agg(p.username order by gp.player_index)
        filter (where p.username is not null),
      array[]::text[]
    ) as player_names
  from public.yahdle_games g
  left join public.yahdle_players gp on gp.game_id = g.id
  left join public.profiles        p  on p.id = gp.user_id
  where g.status in ('waiting', 'active')
  group by g.id
  order by g.created_at desc
$$;

grant execute on function public.yahdle_admin_list_open_games() to authenticated;

-- ── 4. yahdle_admin_list_closed_games ──────────────────────
-- Returns recently closed games with closing admin's username +
-- reason. Used by the admin panel's "Recently Closed" history view.
create or replace function public.yahdle_admin_list_closed_games(p_limit int default 50)
returns table (
  id              uuid,
  finished_at     timestamptz,
  close_reason    text,
  closed_by_name  text,
  player_names    text[]
) language sql security definer stable as $$
  select
    g.id,
    g.finished_at,
    g.close_reason,
    cb.username as closed_by_name,
    coalesce(
      array_agg(p.username order by gp.player_index)
        filter (where p.username is not null),
      array[]::text[]
    ) as player_names
  from public.yahdle_games g
  left join public.yahdle_players gp on gp.game_id = g.id
  left join public.profiles        p  on p.id = gp.user_id
  left join public.profiles        cb on cb.id = g.closed_by
  where g.closed_by_admin = true
  group by g.id, g.finished_at, g.close_reason, cb.username
  order by g.finished_at desc
  limit p_limit
$$;

grant execute on function public.yahdle_admin_list_closed_games(int) to authenticated;

-- ============================================================
-- Yahdle — Invite expiry
--
-- Aligned with the SQ standard (Wordy / Rungles):
--   • invited_user_id null  (open game)    → 7 days
--   • invited_user_id set   (friend invite) → 1 day
-- Snibble uses 3 days for friend invites; Yahdle's 12-turn alternation
-- matches Wordy/Rungles pace so the 1-day window applies.
-- ============================================================

create or replace function public.yahdle_set_game_expiry()
returns trigger language plpgsql as $$
begin
  if new.expires_at is null or tg_op = 'INSERT' then
    if new.invited_user_id is null then
      new.expires_at := coalesce(new.created_at, now()) + interval '7 days';
    else
      new.expires_at := coalesce(new.created_at, now()) + interval '1 day';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists yahdle_set_game_expiry on public.yahdle_games;
create trigger yahdle_set_game_expiry
  before insert on public.yahdle_games
  for each row execute function public.yahdle_set_game_expiry();

-- Cleanup helper: any 'waiting' game past its expires_at gets dropped.
-- Idempotent + safe to call from the lobby on every load (cheap because
-- it's filtered by status + indexed expires_at — adding an index now
-- since we'll query it).
create index if not exists yahdle_games_expires_at_idx
  on public.yahdle_games(expires_at)
  where status = 'waiting';

create or replace function public.yahdle_expire_stale_invites()
returns int language plpgsql security definer as $$
declare
  n int;
begin
  delete from public.yahdle_games
  where status = 'waiting'
    and expires_at < now();
  get diagnostics n = row_count;
  return n;
end;
$$;

grant execute on function public.yahdle_expire_stale_invites() to authenticated;
